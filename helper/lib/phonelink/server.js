'use strict';
// The phone link's listener (docs/PHONE-LINK.md "The wire"): the one network door into the helper.
//
//   - No listener unless the store says so (`store.status().listen`: the link is on, and a phone is paired or a
//     pairing window is open) and the computer's key is there. Everything else: no socket bound at all.
//   - A connection's first message is the phone's Noise IK message. One that doesn't arrive in time, doesn't
//     decrypt, isn't from a paired key (or, while a window is open, doesn't carry its secret) gets the socket
//     destroyed with not one byte written (rule 2). Only then is the handshake answered.
//   - A session counts once its first transport message decrypts: that proves the other side holds the phone's
//     key now (a copied first message played again gets the handshake's answer, which it can't read, and is
//     closed a few seconds later without having touched the real phone's session or its "last seen").
//   - One session per phone: a proven new one closes that phone's older ones (the app came back from suspension).
//   - On the store's 'change': the listener starts or stops to match, and sessions of phones that aren't paired
//     any more are closed.
//
// What a session may ask is whatever is registered with `handle(type, fn)`; `hello` and `ping` are here. Runs
// come with remote.js. Nothing here names a folder, a file or a mod (rule 5).
//
// The log gets no key, no secret and no line per refused connection (anyone on the Wi-Fi could fill it):
// `stats` counts them.

const net = require('net');
const { EventEmitter } = require('events');
const { Handshake, keyId } = require('./noise');
const { cleanName } = require('./store');
const { packet, PacketReader, seal, Assembler } = require('./frames');

const VERSION = 1;
const FIRST_MESSAGE_MS = 5000; // (for the handshake's first message, and then for the first transport message)
const IDLE_MS = 120000; // (the app pings; a phone that went quiet is a dead connection)
const MAX_CONNECTIONS = 8;
const KEPT_TRIES = 8; // (the kept port, KEPT_PAUSE_MS apart while it's busy, before any port: _listen)
const KEPT_PAUSE_MS = 250;
const MAX_WAITING = 32 * 1024 * 1024; // (unsent bytes to one phone: beyond this it isn't reading)

const text = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')).slice(0, max).join('') : '');
const size = (v) => (Number.isFinite(v) && v > 0 && v < 100000 ? Math.round(v) : 0);

/** A paired phone's open, encrypted connection. Emits 'close' once. */
class Session extends EventEmitter {
  constructor(socket, phone, key, cipher) {
    super();
    this.socket = socket;
    this.phone = { id: phone.id, name: phone.name };
    this.key = key; // (the phone's public key)
    this.cipher = cipher; // (this side's `send`)
    this.proven = false;
    this.open = true;
    this.hello = null; // ({app, device}: what the app said about itself)
  }

  /** Sends one message. False when the session is closed (or was closed for this: the phone isn't reading). */
  send(obj) {
    if (!this.open) return false;
    let packets;
    try { packets = seal(this.cipher, obj); } catch (e) {
      if (/too big/.test(e.message)) throw e; // (the caller's to answer: nothing was sent, the cipher didn't move)
      this.close();
      return false;
    }
    for (const p of packets) this.socket.write(p);
    if (this.socket.writableLength > MAX_WAITING) { this.close(); return false; }
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.emit('close');
  }
}

class Server extends EventEmitter {
  /**
   * store: the phone link's Store. Options:
   *   version: TRIF's, for `hello`.            log: (line) => void.
   *   host, port: where to listen. By default every interface, and the port kept in the store (else the
   *     system's choice, then kept). Tests: 127.0.0.1 and 0.
   *   hello: (session) => more fields for the `hello` answer ({agent, pending}: remote.js).
   *   firstMessageMs, idleMs, maxConnections: the limits above.
   * Emits 'session' (a proven Session), 'listening' (port) and 'stopped'.
   */
  constructor(store, opts = {}) {
    super();
    this.store = store;
    this.version = String(opts.version || '');
    this.log = typeof opts.log === 'function' ? opts.log : () => {};
    this.host = opts.host;
    this.port = opts.port;
    this.helloMore = typeof opts.hello === 'function' ? opts.hello : () => ({});
    this.firstMessageMs = opts.firstMessageMs || FIRST_MESSAGE_MS;
    this.idleMs = opts.idleMs || IDLE_MS;
    this.maxConnections = opts.maxConnections || MAX_CONNECTIONS;
    this.listener = null;
    this.keys = null;
    this.sockets = new Set();
    this.sessions = new Set(); // (proven ones)
    this.handlers = new Map();
    this.stats = { refused: 0, sessions: 0 };
    this.started = false;
    this.queue = Promise.resolve();
    this.onChange = () => { this.sync().catch(() => {}); };
    this.handle('ping', () => ({ t: 'pong' }));
    this.handle('hello', (session, msg) => {
      const d = msg.device && typeof msg.device === 'object' ? msg.device : {};
      session.hello = { app: text(msg.app, 40), device: { name: cleanName(d.name, ''), width: size(d.width), height: size(d.height) } };
      return { agent: null, pending: [], ...this.helloMore(session), t: 'hello', v: VERSION, version: this.version, name: this.store.name };
    });
  }

  /**
   * What a session may ask: fn(session, msg) → the answer (an object; `t: 'ok'` and the request's `id` are
   * filled in), or nothing for no answer. May be async. A throw is answered as an `error` (`e.code` or
   * `bad-request`).
   */
  handle(type, fn) { this.handlers.set(type, fn); }

  /** Follows the store from now on: resolves once the listener matches it. */
  start() {
    if (!this.started) { this.started = true; this.store.on('change', this.onChange); }
    return this.sync();
  }

  /** Stops following the store, closes the listener and every connection. */
  stop() {
    if (this.started) { this.started = false; this.store.removeListener('change', this.onChange); }
    const step = this.queue.then(() => this._close());
    this.queue = step.catch(() => {});
    return step;
  }

  /** The listener made to match the store, one change at a time. Resolves the port, or 0 when not listening. */
  sync() {
    const step = this.queue.then(() => this._sync());
    this.queue = step.catch(() => {});
    return step;
  }

  /** {address, port} while listening, else null. */
  address() {
    const a = this.listener && this.listener.address();
    return a ? { address: a.address, port: a.port } : null;
  }

  async _sync() {
    if (!this.started) return 0;
    let keys = null;
    try { if (this.store.status().listen) keys = await this.store.keys(); } catch { keys = null; }
    // (the store may have changed while the keyring answered: off wins)
    if (!keys || !this.started || !this.store.status().listen) { await this._close(); return 0; }
    if (this.keys && !this.keys.publicKey.equals(keys.publicKey)) this._closeConnections(); // (a new key: nobody is paired to it)
    this.keys = keys;
    for (const socket of this.sockets) {
      // (removed phones; connections still in the handshake are judged when their message comes)
      if (socket.session && !this.store.isPaired(socket.session.key)) this._drop(socket);
    }
    if (!this.listener) await this._listen();
    return this.address() ? this.address().port : 0;
  }

  async _listen() {
    const kept = this.store.status().port;
    // (the kept port a few times over 2 s: when another browser's helper hands the link over, its listener closes
    // a moment after this one starts, and the phones find the same port again)
    const wanted = this.port !== undefined ? [this.port] : kept ? [...Array(KEPT_TRIES).fill(kept), 0] : [0];
    let last;
    for (const [i, port] of wanted.entries()) {
      if (i > 0 && port === kept && last && last.code === 'EADDRINUSE') await new Promise((r) => setTimeout(r, KEPT_PAUSE_MS));
      else if (i > 0 && port === kept) continue;
      const listener = net.createServer({ allowHalfOpen: false }, (socket) => this._connection(socket));
      listener.maxConnections = this.maxConnections; // (the system's side of the same limit)
      try {
        await new Promise((resolve, reject) => {
          listener.once('error', reject);
          listener.listen({ port, host: this.host }, () => { listener.removeListener('error', reject); resolve(); });
        });
      } catch (e) { last = e; continue; } // (the kept port is someone else's now: any port)
      if (!this.started) { listener.close(); return; } // (stopped while it waited for the kept port)
      listener.on('error', (e) => { this.log(`phone link: the listener stopped (${e.code || e.message})`); this._close().catch(() => {}); });
      this.listener = listener;
      const got = listener.address().port;
      try { this.store.setPort(got); } catch { /* the record's port changes next time, no more */ }
      this.log(`phone link: listening on port ${got}`);
      this.emit('listening', got);
      return;
    }
    this.log(`phone link: couldn't listen (${(last && (last.code || last.message)) || 'unknown'})`);
  }

  async _close() {
    this._closeConnections();
    this.keys = null;
    const listener = this.listener;
    if (!listener) return;
    this.listener = null;
    await new Promise((resolve) => listener.close(() => resolve()));
    this.log('phone link: not listening');
    this.emit('stopped');
  }

  _closeConnections() {
    for (const socket of [...this.sockets]) this._drop(socket);
  }

  /** Closes a connection, saying nothing. */
  _drop(socket) {
    clearTimeout(socket.plTimer);
    this.sockets.delete(socket);
    if (socket.session) { this.sessions.delete(socket.session); socket.session.close(); }
    socket.destroy();
  }

  _refuse(socket) {
    this.stats.refused++;
    this._drop(socket);
  }

  _timer(socket, ms, refuse) {
    clearTimeout(socket.plTimer);
    socket.plTimer = setTimeout(() => (refuse ? this._refuse(socket) : this._drop(socket)), ms);
    if (socket.plTimer.unref) socket.plTimer.unref();
  }

  _connection(socket) {
    socket.on('error', () => {}); // ('close' follows)
    if (!this.keys || this.sockets.size >= this.maxConnections) { this.stats.refused++; socket.destroy(); return; }
    this.sockets.add(socket);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
    socket.session = null;
    const reader = new PacketReader();
    let assembler = null;
    this._timer(socket, this.firstMessageMs, true);
    socket.on('close', () => this._drop(socket));
    socket.on('data', (chunk) => {
      let messages;
      try { messages = reader.push(chunk); } catch { this._refuse(socket); return; }
      for (const message of messages) {
        if (socket.destroyed || !this.sockets.has(socket)) return;
        if (!socket.session) {
          const made = this._handshake(socket, message);
          if (!made) { this._refuse(socket); return; }
          assembler = new Assembler(made.receive);
          this._timer(socket, this.firstMessageMs, true); // (now prove it: a transport message, soon)
          continue;
        }
        const session = socket.session;
        let msg;
        try { msg = assembler.push(message); } catch { if (session.proven) this._drop(socket); else this._refuse(socket); return; }
        if (!session.proven) this._proven(socket, session);
        this._timer(socket, this.idleMs, false);
        if (msg) this._message(session, msg);
      }
    });
  }

  /**
   * The phone's first message. Null (say nothing, close) unless it decrypts and comes from a paired phone, or
   * carries the open pairing window's secret. Otherwise the handshake's answer is written and the session made:
   * {receive}, the cipher for what the phone sends next.
   */
  _handshake(socket, message) {
    let hs;
    let phone = null;
    try {
      hs = new Handshake({ initiator: false, s: this.keys });
      const said = JSON.parse(hs.readMessage(Buffer.from(message)).toString('utf8'));
      if (!said || typeof said !== 'object' || Array.isArray(said) || said.v !== VERSION) return null;
      // (A paired phone whose pairing answer got lost comes again with the used secret: it is paired, let it in.)
      if (typeof said.pair === 'string' && said.pair) phone = this.store.pairTry(hs.rs, said.pair, said.name);
      if (!phone) phone = this.store.isPaired(hs.rs);
      if (!phone || phone.id !== keyId(hs.rs)) return null;
    } catch { return null; }
    let ciphers;
    try {
      const answer = hs.writeMessage(Buffer.from(JSON.stringify({ v: VERSION, name: this.store.name, paired: true })));
      ciphers = hs.split();
      socket.write(packet(answer));
    } catch { return null; }
    socket.session = new Session(socket, phone, Buffer.from(hs.rs), ciphers.send);
    return { receive: ciphers.receive };
  }

  /** The other side holds the phone's key now: this is the phone's session, and its older ones go. */
  _proven(socket, session) {
    session.proven = true;
    for (const other of [...this.sockets]) {
      if (other !== socket && other.session && other.session.phone.id === session.phone.id) this._drop(other);
    }
    this.sessions.add(session);
    this.stats.sessions++;
    try { this.store.seen(session.phone.id); } catch { /* the list's "last seen" is a nicety */ }
    this.emit('session', session);
  }

  _message(session, msg) {
    const id = typeof msg.id === 'string' || Number.isInteger(msg.id) ? msg.id : undefined;
    const answer = (obj) => { if (obj && session.open) session.send(id === undefined ? obj : { ...obj, id }); };
    const failed = (e) => answer({ t: 'error', code: (e && typeof e.code === 'string' && e.code) || 'bad-request', message: text(e && e.message, 300) });
    const fn = typeof msg.t === 'string' ? this.handlers.get(msg.t) : null;
    if (!fn) { failed(new Error('not something this computer answers')); return; }
    let out;
    try { out = fn(session, msg); } catch (e) { failed(e); return; }
    Promise.resolve(out).then((obj) => {
      if (obj && typeof obj === 'object') answer({ t: 'ok', ...obj });
    }, failed).catch(() => session.close());
  }
}

module.exports = { Server, Session, VERSION, FIRST_MESSAGE_MS, IDLE_MS, MAX_CONNECTIONS };
