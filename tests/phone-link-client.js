'use strict';
// A stand-in phone for the phone link's tests (docs/PHONE-LINK.md "Proof"): the same Noise and frames as the
// iPhone app, as the initiator, over a TCP connection to the helper's listener. Not a test file itself.
//
//   const phone = await PhoneClient.connect({ port, computerKey, keys, name, pair });
//   phone.answer                      the handshake's answer ({v, name, paired})
//   await phone.request({t: 'ping'})  → the message that repeats the request's id
//   await phone.next((m) => …)        → the next message that fits (kept ones first)
//   phone.send(obj), phone.close(), await phone.closed → {bytes} (how many bytes the computer ever sent)
//   phone.onTool = (request) => ({text, shot, error}) | null    answers each `tool.request` (the app's read_page,
//                                     try_mod, screenshot) with a `tool.result`; null: no answer. Every request
//                                     is in phone.tools, answered or not
//
// connect() rejects with `e.code === 'closed'` and `e.bytes` when the computer closes before answering the
// handshake (what an unpaired phone sees: bytes is 0), and with the socket's error when nothing listens.

const net = require('net');
const { Handshake, generateKeyPair } = require('../helper/lib/phonelink/noise');
const { packet, PacketReader, seal, Assembler } = require('../helper/lib/phonelink/frames');

class PhoneClient {
  constructor(socket, keys) {
    this.socket = socket;
    this.keys = keys;
    this.bytes = 0;
    this.answer = null;
    this.firstMessage = null; // (the handshake's first message as sent: for replay tests)
    this.kept = [];
    this.waiters = [];
    this.nextId = 1;
    this.onTool = null;
    this.tools = [];
    this.isClosed = false;
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve; });
  }

  /**
   * host: 127.0.0.1 by default. computerKey: the computer's public key (the QR's). keys: the phone's key pair
   * (made new when not given). name: the phone's. pair: the QR's secret, when pairing. payload: the first
   * message's whole payload instead (for tests of bad ones).
   */
  static connect({ host = '127.0.0.1', port, computerKey, keys = generateKeyPair(), name = 'Test iPhone', pair, payload } = {}) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const phone = new PhoneClient(socket, keys);
      const reader = new PacketReader();
      const hs = new Handshake({ initiator: true, s: keys, rs: computerKey });
      let ciphers = null;
      let assembler = null;
      socket.on('connect', () => {
        const said = payload !== undefined ? payload : { v: 1, name, ...(pair ? { pair } : {}) };
        phone.firstMessage = packet(hs.writeMessage(Buffer.from(typeof said === 'string' ? said : JSON.stringify(said))));
        socket.write(phone.firstMessage);
      });
      socket.on('data', (chunk) => {
        phone.bytes += chunk.length;
        for (const message of reader.push(chunk)) {
          if (!ciphers) {
            phone.answer = JSON.parse(hs.readMessage(Buffer.from(message)).toString('utf8'));
            ciphers = hs.split();
            phone.cipher = ciphers.send;
            assembler = new Assembler(ciphers.receive);
            resolve(phone);
            continue;
          }
          const msg = assembler.push(message);
          if (msg) phone._got(msg);
        }
      });
      // (a reset is a close too: 'close' follows and says so)
      socket.on('error', (e) => { if (!ciphers && e.code !== 'ECONNRESET' && e.code !== 'EPIPE') reject(e); });
      socket.on('close', () => {
        phone.isClosed = true;
        phone.resolveClosed({ bytes: phone.bytes });
        for (const w of phone.waiters.splice(0)) w.reject(Object.assign(new Error('the computer closed the connection'), { code: 'closed' }));
        if (!ciphers) reject(Object.assign(new Error('closed before the handshake was answered'), { code: 'closed', bytes: phone.bytes }));
      });
    });
  }

  _got(msg) {
    if (msg.t === 'tool.request' && this.onTool) {
      this.tools.push(msg);
      const answer = this.onTool(msg);
      if (answer && !this.isClosed) this.send({ t: 'tool.result', id: msg.id, ...answer });
      return;
    }
    const i = this.waiters.findIndex((w) => w.fits(msg));
    if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
    else this.kept.push(msg);
  }

  send(obj) { for (const p of seal(this.cipher, obj)) this.socket.write(p); }

  /** Writes bytes as they are (a broken or copied message). */
  raw(bytes) { this.socket.write(bytes); }

  next(fits = () => true, { timeout = 5000 } = {}) {
    const i = this.kept.findIndex(fits);
    if (i >= 0) return Promise.resolve(this.kept.splice(i, 1)[0]);
    if (this.isClosed) return Promise.reject(Object.assign(new Error('the computer closed the connection'), { code: 'closed' }));
    return new Promise((resolve, reject) => {
      const w = { fits, resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } };
      const timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error('no such message in time')); }, timeout);
      this.waiters.push(w);
    });
  }

  request(obj, opts) {
    const id = `q${this.nextId++}`;
    this.send({ ...obj, id });
    return this.next((m) => m.id === id, opts);
  }

  close() { this.socket.destroy(); return this.closed; }
}

module.exports = { PhoneClient };
