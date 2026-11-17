'use strict';
// The phone link's store (docs/PHONE-LINK.md "Keys and pairing"): the computer's key, whether the link is on, the
// paired phones, and the pairing window. No network here: server.js asks this who may connect.
//
//   the computer's private key   the system keyring (keyring.js, service "TRIF phone link", account "computer"),
//                                base64url, and nowhere else: not in the file, a log, an error or an argv
//   <private>/phone-link.json    { on, publicKey, port, phones: [{ id, name, key, pairedAt, lastSeen }] }, mode 600,
//                                written whole (a temp file, then rename). Public keys only. In the private folder,
//                                which no run can read.
//   the pairing window           in memory only: a 16-byte secret, 5 minutes, one phone, closed after 5 wrong tries
//
// A new install has no file and no key: the link is off (rule 1). A file that doesn't read as one is the same as
// none: off, no phones. The file is read again at each question, so two helpers agree on who is paired; the
// pairing window belongs to the helper that opened it (the one that owns the link, host.js).
//
// Emits 'change' when anything server.js or the panel would act on changes: on/off, a phone added or removed,
// the window opened or closed (by itself too, when its time is up).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const keyring = require('../keyring');
const { privateDir } = require('../paths');
const { generateKeyPair, publicFromPrivate, keyId, DHLEN } = require('./noise');

const FILE = 'phone-link.json';
const SERVICE = 'TRIF phone link';
const ACCOUNT = 'computer';
const SECRET_BYTES = 16;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;
const NAME_MAX = 60;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
/** 32 bytes from base64url, or null. (Only the canonical spelling: one key, one string.) */
function key32(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const buf = Buffer.from(text, 'base64url');
  return buf.length === DHLEN && b64(buf) === text ? buf : null;
}

/**
 * A name as it will be shown (as text): one line, no control characters, 60 characters at most (as a reader counts
 * them: an emoji stays whole). A longer one is cut at the last space in its second half, else mid-word, then "…".
 */
function cleanName(name, fallback) {
  const s = String(typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = characters(s);
  if (chars.length <= NAME_MAX) return s || fallback;
  let keep = chars.slice(0, NAME_MAX - 1);
  const space = keep.lastIndexOf(' ');
  if (space >= NAME_MAX / 2) keep = keep.slice(0, space);
  return keep.join('').trim() + '\u2026';
}

/** The Mac's own name (System Settings, General, About), as its other Bonjour records give it. */
function macName() {
  return execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * This computer's name for the QR code, the handshake and the Bonjour record: the Mac's own name, else the
 * host name without ".local".
 */
function computerName({ platform = process.platform, read = macName } = {}) {
  let name = '';
  if (platform === 'darwin') { try { name = read(); } catch { name = ''; } }
  return cleanName(name, '') || cleanName(os.hostname().replace(/\.(local|lan|home)$/i, ''), 'Computer');
}

// The QR code's text: 271 bytes at most (extension/qr.js: version 10 at level L, the largest code the panel
// draws). Everything in it but the name has a fixed length, so a long name is what is cut: the code is for
// finding and trusting the computer, and the phone shows the whole name once paired (`hello` gives it).
const QR_TEXT_MAX = 271;
const CUT = encodeURIComponent('\u2026');
const encoded = (s) => { try { return encodeURIComponent(s); } catch { return ''; } }; // (half a surrogate pair: left out)
function characters(s) {
  try { return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment); } catch { return Array.from(s); }
}

/**
 * A name as the QR code's text carries it, percent-encoded, in `room` bytes at most: whole when it fits, else
 * its start (whole characters as a reader sees them: an emoji of several code points stays whole or goes) and "…".
 */
function qrName(name, room) {
  const parts = characters(String(name)).map(encoded);
  const whole = parts.join('');
  if (whole.length <= room) return whole;
  let out = '';
  for (const part of parts) {
    if (out.length + part.length + CUT.length > room) break;
    out += part;
  }
  return CUT.length <= room ? out.replace(/(%20)+$/, '') + CUT : '';
}

const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** What the file says, with nothing in it taken on trust: ids are made from the keys again, bad rows dropped. */
function parse(text) {
  const empty = { on: false, publicKey: null, port: 0, phones: [] };
  let raw;
  try { raw = JSON.parse(text); } catch { return empty; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const publicKey = key32(raw.publicKey) ? raw.publicKey : null;
  const phones = [];
  const seen = new Set();
  for (const p of Array.isArray(raw.phones) ? raw.phones : []) {
    const key = p && typeof p === 'object' ? key32(p.key) : null;
    if (!key) continue;
    const id = keyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    phones.push({ id, name: cleanName(p.name, 'iPhone'), key: p.key, pairedAt: time(p.pairedAt), lastSeen: time(p.lastSeen) });
  }
  return {
    on: raw.on === true && !!publicKey, // (no key, no link)
    publicKey,
    port: Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? raw.port : 0,
    phones: publicKey ? phones : [], // (phones are paired to a key)
  };
}

class Store extends EventEmitter {
  /**
   * home: the workspace (the store is in its private folder).
   * env: for the keyring (tests: TRIF_KEYCHAIN_BIN). now: the clock, in ms. name: this computer's name.
   */
  constructor(home, { env = process.env, now = Date.now, name = computerName() } = {}) {
    super();
    this.file = path.join(privateDir(home, { env }), FILE);
    this.env = env;
    this.now = now;
    this.name = cleanName(name, 'Computer');
    this.window = null; // {secret: Buffer, expires: ms, tries, timer}
    this.queue = Promise.resolve(); // (turning on, one at a time)
  }

  // ------------------------------------------------------------ the file

  read() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { text = ''; }
    return parse(text);
  }

  write(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      fs.chmodSync(tmp, 0o600); // (whatever the umask, and if the temp file was already there)
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* wasn't made */ }
      throw e;
    }
  }

  // ------------------------------------------------------------ on, off, the key

  /**
   * What the panel shows and server.js acts on. Never the secret, never the private key.
   * listen: whether a listener should be up: the link is on, and a phone is paired or one may pair now.
   */
  status() {
    const s = this.read();
    const pairing = this.pairing();
    return {
      on: s.on,
      id: s.publicKey ? keyId(key32(s.publicKey)) : null,
      name: this.name,
      port: s.port,
      phones: s.phones.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
      pairing,
      listen: s.on && (s.phones.length > 0 || !!pairing),
    };
  }

  /**
   * Turns the link on. The first time (or when the key is gone from the keyring, or isn't the file's), makes the
   * computer's key pair: the phones paired to the old key are dropped, since they can't reach the new one.
   * Resolves {on: true, created}. Throws when the key can't be kept (no keyring) or the keyring can't be read
   * just now: the link stays as it was.
   */
  setOn(on) {
    const step = this.queue.then(() => (on ? this._turnOn() : this._turnOff()));
    this.queue = step.catch(() => {});
    return step;
  }

  async _turnOn() {
    const s = this.read();
    // (A keyring that couldn't be read, e.g. locked, is not a key that's gone: no new key, no phones dropped.)
    const kept = await this._privateKey({ orThrow: true });
    if (kept && s.publicKey && b64(publicFromPrivate(kept)) === s.publicKey) {
      if (!s.on) { this.write({ ...s, on: true }); this.emit('change'); }
      return { on: true, created: false };
    }
    const pair = generateKeyPair();
    try {
      await keyring.setKey(ACCOUNT, b64(pair.privateKey), { service: SERVICE, env: this.env });
    } catch (e) {
      // (keyring.js's errors never hold the key; its "no keyring" one is worded for API keys)
      throw new Error(keyring.backend({ env: this.env }) ? `couldn't keep this computer's phone link key: ${e.message}` : 'the phone link needs a system keyring to keep this computer\'s key in (the macOS Keychain, or a Secret Service on Linux)');
    }
    this._closeWindow();
    this.write({ on: true, publicKey: b64(pair.publicKey), port: s.port, phones: [] });
    this.emit('change');
    return { on: true, created: true };
  }

  async _turnOff() {
    const s = this.read();
    const had = this._closeWindow();
    if (s.on) this.write({ ...s, on: false });
    if (s.on || had) this.emit('change');
    return { on: false };
  }

  async _privateKey({ orThrow = false } = {}) {
    if (!keyring.backend({ env: this.env })) return null;
    const k = await keyring.getKey(ACCOUNT, { service: SERVICE, env: this.env });
    if (k.error && orThrow) throw new Error(`couldn't read this computer's phone link key: ${k.error}`);
    return key32(k.value);
  }

  /**
   * The computer's key pair, for the listener: {publicKey, privateKey} (Buffers), or null when the link is off
   * or the keyring's key isn't the file's (turn the link on again to make a new one). For server.js alone.
   */
  async keys() {
    const s = this.read();
    if (!s.on) return null;
    const privateKey = await this._privateKey();
    if (!privateKey) return null;
    const publicKey = Buffer.from(publicFromPrivate(privateKey));
    return b64(publicKey) === s.publicKey ? { publicKey, privateKey } : null;
  }

  /** The port the system gave the listener, kept so the Bonjour record seldom changes. */
  setPort(port) {
    const s = this.read();
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || s.port === port || !s.publicKey) return;
    this.write({ ...s, port });
  }

  // ------------------------------------------------------------ the pairing window

  /**
   * Opens the pairing window (a new one replaces an open one's secret): {secret, qr, expires}. `qr` is the text
   * of the QR code; it and the secret go to the panel that asked and nowhere else (no file, no log).
   * Throws when the link is off.
   */
  pairStart() {
    const s = this.read();
    if (!s.on) throw new Error('the phone link is off');
    this._closeWindow();
    const secret = crypto.randomBytes(SECRET_BYTES);
    const expires = this.now() + WINDOW_MS;
    const timer = setTimeout(() => { if (this.window && this.window.secret === secret) this.pairStop(); }, WINDOW_MS);
    if (timer.unref) timer.unref();
    this.window = { secret, expires, tries: 0, timer };
    this.emit('change');
    const text = b64(secret);
    const head = `trif://pair?v=1&k=${s.publicKey}&s=${text}&n=`;
    return { secret: text, qr: head + qrName(this.name, QR_TEXT_MAX - head.length), expires };
  }

  /** Closes the window (the panel's Settings closed, or its time is up). */
  pairStop() {
    if (this._closeWindow()) this.emit('change');
  }

  /** {expires} while a phone may pair, else null. */
  pairing() {
    if (this.window && this.now() >= this.window.expires) this.pairStop();
    return this.window ? { expires: this.window.expires } : null;
  }

  _closeWindow() {
    if (!this.window) return false;
    clearTimeout(this.window.timer);
    this.window = null;
    return true;
  }

  /**
   * A phone's first message carried a pairing secret. phoneKey: its public key (32 bytes, from the handshake,
   * so the phone holds the private key); secret: what it sent (base64url); name: what it calls itself.
   * The phone's row when the secret is the open window's (the phone is now paired, the window closed), else
   * null: no window, its time is up, or a wrong secret (the fifth wrong one closes the window). The caller says
   * nothing to the phone either way but the handshake's answer on success.
   */
  pairTry(phoneKey, secret, name) {
    if (!Buffer.isBuffer(phoneKey) || phoneKey.length !== DHLEN) return null;
    if (!this.pairing()) return null;
    const s = this.read();
    if (!s.on) { this.pairStop(); return null; }
    // Compared in constant time, through a hash so that lengths don't matter (and nothing is learnt from them).
    const digest = (v) => crypto.createHash('sha256').update(v).digest();
    const given = typeof secret === 'string' ? secret : '';
    if (!crypto.timingSafeEqual(digest(Buffer.from(given, 'utf8')), digest(Buffer.from(b64(this.window.secret), 'utf8')))) {
      if (++this.window.tries >= MAX_TRIES) this.pairStop();
      return null;
    }
    const id = keyId(phoneKey);
    const at = new Date(this.now()).toISOString();
    const phone = { id, name: cleanName(name, 'iPhone'), key: b64(phoneKey), pairedAt: at, lastSeen: at };
    this.write({ ...s, phones: [...s.phones.filter((p) => p.id !== id), phone] }); // (pairing again: the new name)
    this._closeWindow();
    this.emit('change');
    return { ...phone };
  }

  // ------------------------------------------------------------ the paired phones

  /** The paired phone with this public key (32 bytes), or null. Nobody is paired while the link is off. */
  isPaired(phoneKey) {
    if (!Buffer.isBuffer(phoneKey) || phoneKey.length !== DHLEN) return null;
    const s = this.read();
    if (!s.on) return null;
    const text = b64(phoneKey);
    // (public keys: nothing secret in how long the comparison takes)
    const phone = s.phones.find((p) => p.key === text);
    return phone ? { ...phone } : null;
  }

  /** A paired phone connected: its row's lastSeen. */
  seen(id) {
    const s = this.read();
    const phone = s.phones.find((p) => p.id === id);
    if (!phone) return;
    phone.lastSeen = new Date(this.now()).toISOString();
    this.write(s);
  }

  /** The paired phones: [{id, name, pairedAt, lastSeen}]. */
  list() {
    return this.status().phones;
  }

  /**
   * Removes a phone by id: its row (without the key), or null when there's none. The caller closes its sessions
   * and deletes its kept results (server.js, remote.js: on 'change').
   */
  remove(id) {
    const s = this.read();
    const phone = s.phones.find((p) => p.id === id);
    if (!phone) return null;
    this.write({ ...s, phones: s.phones.filter((p) => p.id !== id) });
    this.emit('change');
    return { id: phone.id, name: phone.name };
  }
}

module.exports = { Store, FILE, SERVICE, ACCOUNT, WINDOW_MS, MAX_TRIES, NAME_MAX, QR_TEXT_MAX, cleanName, qrName, computerName, parse };
