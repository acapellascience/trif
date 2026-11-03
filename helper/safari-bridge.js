#!/usr/bin/env node
'use strict';
// The TRIF helper's bridge for Safari. Safari's native messaging only reaches an extension's own Mac
// app, so the Safari extension (extension/safari.js) connects here instead, with a WebSocket to
// 127.0.0.1:47615, and gets a host.js, spoken to in the usual native-messaging frames on its stdin and
// stdout (docs/PROTOCOL.md). The bridge itself only relays. `trif setup --browser safari` installs it
// as a login item (a launchd agent), so it's always running.
//
// Only TRIF's Safari extension may connect. A browser always sends the page's origin with a WebSocket
// handshake and a web page can't change it, so only a Safari extension gets past the origin check, and of
// those only TRIF has the key (?token=, the contents of safari-token in the private folder, written by setup): the
// extension gets it from its own Mac app, which no other extension can message. (A Safari extension's
// origin is random and changes, so it can't be checked for itself.)
//
// Safari unloads an extension's background after half a minute or so with nothing to do, which closes
// the WebSocket. In Chrome that would mean the host exits (its stdin closes), ending any agent run, so
// here the host outlives the connection: its messages wait in a queue, and when the background wakes
// and reconnects (it sends a fresh hello) it gets the same host and the queue. A host with no connection
// for an idle period, and no agent run going, is stopped.
//
// Usage: node helper/safari-bridge.js [--port N]   (logs to helper.log in the private folder, and to the terminal if any)

const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { encode, Decoder, ByteQueue } = require('./lib/framing');

const PORT = 47615;
const ALLOWED_ORIGIN = /^safari-web-extension:\/\/[0-9A-Fa-f-]+$/;
const MAX_MESSAGE = 256 * 1024 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HOST_IDLE_MS = 30 * 60 * 1000;
const QUEUE_MAX = 2000; // messages kept for a disconnected extension (oldest dropped)
const PING_MS = 20000;

/** Whether a handshake may become a helper connection: from a Safari extension, bringing `key`. */
function allowed(req, key) {
  if (!ALLOWED_ORIGIN.test(String(req.headers.origin || '')) || req.headers.upgrade?.toLowerCase() !== 'websocket'
    || typeof req.headers['sec-websocket-key'] !== 'string' || !key) return false;
  let given;
  try { given = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') || ''; } catch { return false; }
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

/** One WebSocket frame from the server (never masked). */
function wsFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}
const textFrame = (msg) => wsFrame(0x1, Buffer.from(JSON.stringify(msg), 'utf8'));
const CLOSE_FRAME = wsFrame(0x8, Buffer.alloc(0));

/**
 * Reads client frames (always masked) from `push`ed chunks. Calls onText(string) for each whole text
 * message, onClose() for a close frame or a protocol error (unmasked, or a message over `max`, counting
 * all its fragments); answers pings itself through `send`. Bytes are joined once per frame,
 * when the whole frame has arrived, not on every chunk.
 */
class WsReader {
  constructor({ onText, onClose, send, max = MAX_MESSAGE }) {
    Object.assign(this, { onText, onClose, send, max });
    this.queue = new ByteQueue();
    this.frame = null; // the current frame's header, once read: { fin, opcode, len, at }
    this.parts = [];
    this.partsLength = 0;
    this.closed = false;
  }

  push(chunk) {
    if (this.closed) return;
    this.queue.push(chunk);
    for (;;) {
      if (!this.frame) {
        if (this.queue.length < 2) return;
        const head = this.queue.peek(Math.min(this.queue.length, 10));
        const fin = (head[0] & 0x80) !== 0;
        const opcode = head[0] & 0x0f;
        const masked = (head[1] & 0x80) !== 0;
        let len = head[1] & 0x7f;
        let at = 2;
        if (len === 126) { if (head.length < 4) return; len = head.readUInt16BE(2); at = 4; }
        else if (len === 127) { if (head.length < 10) return; len = Number(head.readBigUInt64BE(2)); at = 10; }
        const data = opcode === 0x0 || opcode === 0x1;
        if (!masked || len > this.max || (data && this.partsLength + len > this.max)) { this.fail(); return; }
        this.frame = { fin, opcode, len, at };
      }
      const { fin, opcode, len, at } = this.frame;
      if (this.queue.length < at + 4 + len) return;
      const bytes = this.queue.take(at + 4 + len);
      this.frame = null;
      const mask = bytes.subarray(at, at + 4);
      const data = Buffer.from(bytes.subarray(at + 4));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      if (opcode === 0x8) { this.fail(); return; }
      if (opcode === 0x9) { this.send(wsFrame(0xA, data)); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.parts.push(data);
        this.partsLength += data.length;
        if (fin) {
          const text = Buffer.concat(this.parts, this.partsLength).toString('utf8');
          this.parts = [];
          this.partsLength = 0;
          this.onText(text);
        }
      }
    }
  }

  fail() {
    this.closed = true;
    this.queue.clear();
    this.parts = [];
    this.onClose();
  }
}

/**
 * The bridge's HTTP server (not yet listening). opts:
 *   hostCommand(origin) → [file, ...args]   how to start a host (default: this node, host.js)
 *   log                                     { info, warn, error } (default: discard)
 *   idleMs                                  how long a host may go without a connection (HOST_IDLE_MS)
 *   runActive()                             whether an agent run is going (keeps an idle host)
 *   token()                                 the key connections must bring (read for each one), or null
 * Returns { server, hosts } (hosts: origin → { child, socket, queue, idleTimer }).
 */
function createBridge(opts = {}) {
  const hostCommand = opts.hostCommand || ((origin) => [process.execPath, path.join(__dirname, 'host.js'), origin + '/']);
  const log = opts.log || { info() {}, warn() {}, error() {} };
  const idleMs = opts.idleMs ?? HOST_IDLE_MS;
  const runActive = opts.runActive || (() => false);
  const token = opts.token || (() => null);
  const hosts = new Map();

  function hostFor(origin) {
    const existing = hosts.get(origin);
    if (existing) return existing;
    const [file, ...args] = hostCommand(origin);
    // TRIF_SAFARI_BRIDGE tells an update's setup, run inside this host, that restarting the bridge
    // would kill it (setup.js loadSafariAgent).
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TRIF_SAFARI_BRIDGE: String(process.pid) } });
    const h = { child, socket: null, queue: [], idleTimer: null };
    hosts.set(origin, h);
    log.info(`safari bridge: host ${child.pid} started for ${origin}`);
    const decoder = new Decoder((msg) => {
      const frame = textFrame(msg);
      if (h.socket && !h.socket.destroyed) h.socket.write(frame);
      else { h.queue.push(frame); if (h.queue.length > QUEUE_MAX) h.queue.shift(); }
    }, (e) => {
      log.warn(`safari bridge: bad frame from host ${child.pid}: ${e.message}`);
      // Out of step with the host: nothing it says can be read any more, so stop it (the next
      // connection starts a new one).
      if (e.fatal) child.kill();
    });
    child.stdout.on('data', (chunk) => decoder.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (e) => log.error(`safari bridge: couldn't start the host: ${e.message}`));
    child.on('exit', (code, signal) => {
      log.info(`safari bridge: host ${child.pid} exited ${signal || code}`);
      clearTimeout(h.idleTimer);
      if (hosts.get(origin) === h) hosts.delete(origin);
      if (h.socket) h.socket.end(CLOSE_FRAME);
    });
    return h;
  }

  function idleCheck(h) {
    clearTimeout(h.idleTimer);
    h.idleTimer = setTimeout(() => {
      if (h.socket) return;
      if (runActive()) { idleCheck(h); return; }
      log.info(`safari bridge: host ${h.child.pid} unused for ${Math.round(idleMs / 60000)} min; stopping it`);
      try { h.child.stdin.end(); } catch {}
    }, idleMs);
    h.idleTimer.unref?.();
  }

  function connection(req, socket) {
    const origin = req.headers.origin;
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);

    const h = hostFor(origin);
    if (h.socket && h.socket !== socket) h.socket.end(CLOSE_FRAME); // a connection Safari has given up on
    h.socket = socket;
    clearTimeout(h.idleTimer);
    for (const frame of h.queue.splice(0)) socket.write(frame);

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearInterval(ping);
      try { socket.end(CLOSE_FRAME); } catch {}
      if (h.socket === socket) { h.socket = null; idleCheck(h); } // the host keeps running: see the top
    };
    const send = (frame) => { if (!socket.destroyed) socket.write(frame); };
    const reader = new WsReader({
      send,
      onClose: close,
      onText: (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (!done && h.child.exitCode === null) h.child.stdin.write(encode(msg));
      },
    });
    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('close', close);
    socket.on('error', close);
    const ping = setInterval(() => send(wsFrame(0x9, Buffer.alloc(0))), PING_MS); // keeps idle connections open
  }

  const server = http.createServer((req, res) => {
    // From the extension: its background's warnings and errors (/log), or why it failed to start.
    if (req.method === 'POST' && (req.url === '/log' || req.url === '/startup-error') && ALLOWED_ORIGIN.test(String(req.headers.origin || ''))) {
      let body = '';
      req.on('data', (c) => { if (body.length < 20000) body += c; });
      req.on('end', () => {
        log.warn(req.url === '/log' ? `safari extension: ${body.slice(0, 20000)}` : `the Safari extension failed to start: ${body.slice(0, 20000)}`);
        res.end();
      });
      return;
    }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('TRIF helper for Safari: WebSocket only.\n');
  });
  server.on('upgrade', (req, socket) => {
    const key = token();
    if (!allowed(req, key)) {
      log.warn(`safari bridge: refused a connection from ${req.headers.origin || 'no origin'}${key ? '' : ' (no key yet: run trif setup --browser safari)'}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    connection(req, socket);
  });
  return { server, hosts };
}

const CODE_CHECK_MS = 30000;

/**
 * Whether the bridge should exit to restart on new code: its code is newer than when it started, no host
 * has a connection (Safari's background is away) and no agent run is going.
 */
function shouldRestart({ hosts, runActive, startedCode, stamp }) {
  if ([...hosts.values()].some((h) => h.socket && !h.socket.destroyed)) return false;
  if (runActive()) return false;
  return stamp() > startedCode;
}

/** Whether any agent run is going (host.js lists them in <home>/active-runs). */
function agentRunActive(home) {
  try { return fs.readdirSync(path.join(home, 'active-runs')).some((f) => f.endsWith('.json')); } catch { return false; }
}

function main() {
  const P = require('./lib/paths');
  const { createLogger } = require('./lib/log');
  // (The key and the log are in the private folder since 0.2.0: move them there if no helper has yet.)
  try { const w = P.workspace(); require('./lib/migrate').migratePrivate(w.home, { privateDir: w.private }); } catch { /* the helper will */ }
  const ws = P.workspace();
  const file = createLogger(ws.log);
  const tty = process.stdout.isTTY;
  const log = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (msg) => {
    file[level](msg);
    if (tty) console.log(`${new Date().toISOString()} ${msg}`);
  }]));
  const at = process.argv.indexOf('--port');
  const port = at > 0 ? Number(process.argv[at + 1]) : PORT;
  const token = () => { try { return fs.readFileSync(ws.safariToken, 'utf8').trim() || null; } catch { return null; } };
  const runActive = () => agentRunActive(ws.home);
  const { server, hosts } = createBridge({ log, runActive, token });
  // Like host.js: when TRIF's code changes on disk (an update), the bridge exits once nothing is connected
  // and no agent run is going, and launchd (KeepAlive) starts it again on the new code.
  const { codeStamp } = require('./lib/helpers');
  const startedCode = codeStamp(__dirname);
  const codeCheck = setInterval(() => {
    if (!shouldRestart({ hosts, runActive, startedCode, stamp: () => codeStamp(__dirname) })) return;
    log.info('safari bridge: its code changed on disk; exiting so launchd starts it on the new code');
    clearInterval(codeCheck);
    for (const h of hosts.values()) { try { h.child.stdin.end(); } catch {} }
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  }, CODE_CHECK_MS);
  codeCheck.unref?.();
  server.on('error', (e) => {
    log.error(`safari bridge: ${e.code === 'EADDRINUSE' ? `port ${port} is in use (is the bridge already running?)` : e.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => log.info(`safari bridge: listening on 127.0.0.1:${port}`));
}

if (require.main === module) main();
module.exports = { createBridge, allowed, wsFrame, WsReader, agentRunActive, shouldRestart, ALLOWED_ORIGIN, PORT };
