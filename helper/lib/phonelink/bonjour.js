'use strict';
// The phone link's announcer (docs/PHONE-LINK.md section 5): while the listener is up, one child process,
//
//   dns-sd -R "<computer's name>" _trif._tcp local <port> v=1 id=<the computer's key id>
//
// so the paired phone can find the computer on the Wi-Fi. No listener, no child: the record exists only while
// the link is on and someone is paired or pairing (the store's `listen`, which the listener follows). The
// record carries the name, the port and the key's short id, never the key.
//
// macOS: `/usr/bin/dns-sd`, built in. Windows: TRIF's own trif-dnssd.exe (win/dnssd.js), built once by Windows'
// C# compiler, which takes the same arguments and calls Windows' DNS-SD API (Windows 10 1809 and later): the
// same record, so the phone finds a Windows computer unchanged. It holds the record until its standard input
// closes, then takes it back (being killed would leave it to time out): so there the child is ended by closing
// its input, and killed only if it doesn't go. TRIF_DNS_SD names another binary (a .js runs with this Node),
// which is how the tests keep the real one, and so Tim's Wi-Fi, out of it. Elsewhere (Linux) `status().error`
// is 'unsupported' and nothing is started (section 9).

const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const BIN = '/usr/bin/dns-sd';
const TYPE = '_trif._tcp';
const DOMAIN = 'local';
const TXT_VERSION = 'v=1';
const LABEL_MAX = 63; // (a DNS-SD instance name: 63 bytes of UTF-8 at most)
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30000;
const SETTLED_MS = 60000; // (a child that lived this long starts the pauses over)
const KILL_GRACE_MS = 2000;

/** The name as an instance name: whole characters, 63 bytes at most. */
function instanceName(name) {
  let out = '';
  for (const ch of String(typeof name === 'string' ? name : '')) {
    if (Buffer.byteLength(out + ch) > LABEL_MAX) break;
    out += ch;
  }
  return out.trim() || 'TRIF';
}

/** dns-sd's arguments for a record (an array: the name is one argument whatever is in it, no shell). */
function recordArgs({ name, port, id }) {
  return ['-R', instanceName(name), TYPE, DOMAIN, String(port), TXT_VERSION, `id=${id}`];
}

/** The pause before the nth start in a row that follows a death: 1 s, 2 s, 4 s … 30 s. */
function pause(failures, base = RETRY_MS, max = RETRY_MAX_MS) {
  return Math.min(max, base * 2 ** Math.min(Math.max(failures, 1) - 1, 20));
}

const same = (a, b) => (!a && !b) || (!!a && !!b && a.name === b.name && a.port === b.port && a.id === b.id);
const alive = (child) => child.exitCode === null && child.signalCode === null;

/**
 * new Announcer(store, server, {env, log, platform}): after start(), the record follows the listener (the
 * server's 'listening' and 'stopped') and the store (a new key is a new id). stop() ends it. An EventEmitter:
 * 'change' whenever status() would answer differently.
 */
class Announcer extends EventEmitter {
  constructor(store, server, { env = process.env, log = () => {}, platform = process.platform, binDir = null, retryMs = RETRY_MS, retryMaxMs = RETRY_MAX_MS, settledMs = SETTLED_MS } = {}) {
    super();
    this.store = store;
    this.server = server;
    this.log = log;
    this.env = env;
    this.win = platform === 'win32';
    this.binDir = binDir; // (Windows: where trif-dnssd.exe is built, the workspace's bin folder)
    this.bin = (env && env.TRIF_DNS_SD) || (this.win ? null : BIN);
    this.supported = platform === 'darwin' || this.win;
    this.retryMs = retryMs;
    this.retryMaxMs = retryMaxMs;
    this.settledMs = settledMs;
    this.started = false;
    this.record = null; // (the record wanted now: {name, port, id})
    this.child = null;
    this.running = false;
    this.error = this.supported ? null : 'unsupported';
    this.failures = 0;
    this.timer = null;
    this.dying = new Set(); // (children told to stop, not gone yet)
    this.complained = false;
    this.onSync = () => this.sync();
    this.onExit = () => this._killAll();
  }

  /** Follows the listener and the store from now on. */
  start() {
    if (this.started) return this;
    this.started = true;
    this.server.on('listening', this.onSync);
    this.server.on('stopped', this.onSync);
    this.store.on('change', this.onSync);
    process.on('exit', this.onExit); // (the child never outlives the helper)
    this.sync();
    return this;
  }

  /** Stops following and ends the child. */
  stop() {
    if (!this.started) return;
    this.started = false;
    this.server.removeListener('listening', this.onSync);
    this.server.removeListener('stopped', this.onSync);
    this.store.removeListener('change', this.onSync);
    process.removeListener('exit', this.onExit);
    this._end();
    this._changed();
  }

  /**
   * {running, error, record}. error: null; 'unsupported' (not a Mac or Windows); 'missing' (dns-sd couldn't be started:
   * the phone can't find the computer); 'failing' (it keeps dying; it is started again after a pause).
   */
  status() {
    return { running: this.running, error: this.error, record: this.record ? { ...this.record, name: instanceName(this.record.name) } : null };
  }

  /** The record made to match the listener: nothing to do when it already does. */
  sync() {
    const want = this.started ? this._wanted() : null;
    if (same(want, this.record)) return;
    this._end();
    this.record = want;
    if (want && this.supported) this._spawn();
    this._changed();
  }

  _wanted() {
    const at = this.server.address();
    if (!at || !at.port) return null;
    let id = null;
    try { id = this.store.status().id; } catch { id = null; }
    if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return null;
    return { name: this.store.name, port: at.port, id };
  }

  /** What to start: {file, prefix}, or null (said why: _missing). */
  _program() {
    if (!this.bin) {
      const built = require('../win/dnssd').program(this.binDir || path.join(require('os').tmpdir(), 'trif-bin'), { env: this.env });
      if (!built.file) { this._missing(new Error(built.error)); return null; }
      this.bin = built.file;
    }
    return /\.js$/i.test(this.bin) ? { file: process.execPath, prefix: [this.bin] } : { file: this.bin, prefix: [] };
  }

  _spawn() {
    const record = this.record;
    const prog = this._program();
    if (!prog) return;
    let child;
    // (Windows: its input open, which it holds the record until; nothing shown)
    try { child = spawn(prog.file, [...prog.prefix, ...recordArgs(record)], { stdio: [this.win ? 'pipe' : 'ignore', 'ignore', 'ignore'], windowsHide: true }); } catch (e) { this._missing(e); return; }
    if (child.stdin) child.stdin.on('error', () => { /* gone already */ });
    const began = Date.now();
    this.child = child;
    child.once('spawn', () => {
      if (this.child !== child) return;
      this.running = true;
      this.error = null;
      this.log(`phone link: announcing on port ${record.port}`);
      this._changed();
    });
    child.once('error', (e) => {
      if (this.child !== child) return;
      this.child = null;
      this.running = false;
      this._missing(e);
      this._changed();
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return; // (ended by us, or already counted as missing)
      this.child = null;
      this.running = false;
      this.failures = Date.now() - began >= this.settledMs ? 1 : this.failures + 1;
      const wait = pause(this.failures, this.retryMs, this.retryMaxMs);
      this.error = 'failing';
      this.log(`phone link: the announcer stopped (${signal || `exit ${code}`}), again in ${Math.round(wait / 100) / 10} s`);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.started && this.record === record && !this.child) this._spawn();
      }, wait);
      this.timer.unref();
      this._changed();
    });
  }

  /** dns-sd isn't there (or can't be run): said once, not tried again until the record changes. */
  _missing(e) {
    this.error = 'missing';
    if (this.complained) return;
    this.complained = true;
    this.log(`phone link: can't announce, ${this.bin || 'the announcer'} didn't start (${(e && (e.code || e.message)) || 'unknown'}): a phone won't find this computer`);
  }

  /** No record: the child ended, no start waiting. */
  _end() {
    clearTimeout(this.timer);
    this.timer = null;
    this.failures = 0;
    this.record = null;
    this.running = false;
    if (this.error !== 'unsupported') this.error = null;
    const child = this.child;
    this.child = null;
    if (!child || !alive(child)) return;
    this.dying.add(child);
    const hard = setTimeout(() => { if (alive(child)) { try { child.kill('SIGKILL'); } catch { /* gone */ } } }, KILL_GRACE_MS);
    hard.unref();
    child.once('exit', () => { clearTimeout(hard); this.dying.delete(child); });
    if (this.win) { try { child.stdin.end(); } catch { /* gone */ } return; } // (it takes the record back, then exits)
    try { child.kill('SIGTERM'); } catch { /* gone */ }
  }

  /** At the helper's exit: nothing of ours is left behind. */
  _killAll() {
    for (const child of [this.child, ...this.dying]) {
      if (!child || !alive(child)) continue;
      // (Windows: its input closes with this process, and it takes the record back; killed, it couldn't)
      if (this.win) { try { child.stdin.end(); } catch { /* gone */ } continue; }
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }
  }

  _changed() {
    const now = JSON.stringify(this.status());
    if (now === this.last) return;
    this.last = now;
    this.emit('change');
  }
}

module.exports = { Announcer, BIN, TYPE, DOMAIN, LABEL_MAX, instanceName, recordArgs, pause };
