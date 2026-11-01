#!/usr/bin/env node
'use strict';
// The WebMods helper's bridge for Safari. Safari's native messaging only reaches an extension's own Mac
// app, so the Safari extension (extension/safari.js) connects here instead, with a WebSocket to
// 127.0.0.1:47615, and gets a host.js, spoken to in the usual native-messaging frames on its stdin and
// stdout (docs/PROTOCOL.md). The bridge itself only relays.
//
// Safari unloads an extension's background after half a minute or so with nothing to do, which closes
// the WebSocket. In Chrome that would mean the host exits (its stdin closes), ending any agent run, so
// here the host outlives the connection: its messages wait in a queue, and when the background wakes
// and reconnects (it sends a fresh hello) it gets the same host and the queue. A host with no connection
// for HOST_IDLE_MS, and no agent run going, is stopped.
//
// Only Safari extension pages may connect. A browser always sends the page's origin with a WebSocket
// handshake and a web page can't change it, so a website can't reach the helper this way.
//
// Usage: node helper/safari-bridge.js [--port N]   (WEBMODS_HOME etc. pass through to host.js)

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { encode, Decoder } = require('./lib/framing');

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 47615;
const HOST_JS = path.join(__dirname, 'host.js');
const ALLOWED_ORIGIN = /^safari-web-extension:\/\/[0-9A-Fa-f-]+$/;
const MAX_MESSAGE = 256 * 1024 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HOST_IDLE_MS = 30 * 60 * 1000;
const QUEUE_MAX = 2000; // messages kept for a disconnected extension (oldest dropped)

const log = (...args) => console.log(new Date().toISOString(), ...args);

/** Whether a handshake may become a helper connection. */
function allowed(req) {
  return ALLOWED_ORIGIN.test(String(req.headers.origin || '')) && req.headers.upgrade?.toLowerCase() === 'websocket'
    && typeof req.headers['sec-websocket-key'] === 'string';
}

/** One WebSocket frame from the server (never masked). */
function wsFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

/**
 * Reads client frames (always masked) from `push`ed chunks. Calls onText(string) for each whole text
 * message, onClose() for a close frame or a protocol error; answers pings itself through `send`.
 */
class WsReader {
  constructor({ onText, onClose, send }) {
    Object.assign(this, { onText, onClose, send });
    this.buf = Buffer.alloc(0);
    this.parts = [];
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = (this.buf[0] & 0x80) !== 0;
      const opcode = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      if (!masked || len > MAX_MESSAGE) { this.onClose(); return; }
      if (this.buf.length < at + 4 + len) return;
      const mask = this.buf.subarray(at, at + 4);
      const data = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      if (opcode === 0x8) { this.onClose(); return; }
      if (opcode === 0x9) { this.send(wsFrame(0xA, data)); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.parts.push(data);
        if (fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.onText(text); }
      }
    }
  }
}

const hosts = new Map(); // origin → { child, socket, queue, idleTimer }

/** The host for an extension origin: the running one, or a new one. */
function hostFor(origin) {
  const existing = hosts.get(origin);
  if (existing) return existing;
  const child = spawn(process.execPath, [HOST_JS, origin + '/'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const h = { child, socket: null, queue: [], idleTimer: null };
  hosts.set(origin, h);
  log(`host ${child.pid} started for ${origin}`);
  const decoder = new Decoder((msg) => {
    const frame = wsFrame(0x1, Buffer.from(JSON.stringify(msg), 'utf8'));
    if (h.socket && !h.socket.destroyed) h.socket.write(frame);
    else { h.queue.push(frame); if (h.queue.length > QUEUE_MAX) h.queue.shift(); }
  }, (e) => log('host frame error:', e.message));
  child.stdout.on('data', (chunk) => decoder.push(chunk));
  child.stdin.on('error', () => {});
  child.on('exit', (code, signal) => {
    log(`host ${child.pid} exited ${signal || code}`);
    clearTimeout(h.idleTimer);
    if (hosts.get(origin) === h) hosts.delete(origin);
    if (h.socket) h.socket.end(wsFrame(0x8, Buffer.alloc(0)));
  });
  return h;
}

/** Stop a host left without a connection for HOST_IDLE_MS, unless an agent run is going. */
function idleCheck(origin, h) {
  clearTimeout(h.idleTimer);
  h.idleTimer = setTimeout(() => {
    if (h.socket) return;
    if (agentRunActive()) { idleCheck(origin, h); return; }
    log(`host ${h.child.pid} idle; stopping it`);
    try { h.child.stdin.end(); } catch {}
  }, HOST_IDLE_MS);
  h.idleTimer.unref?.();
}

/** Whether any agent run is going (host.js lists them in <home>/active-runs). */
function agentRunActive() {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = path.join(process.env.WEBMODS_HOME || path.join(os.homedir(), '.webmods'), 'active-runs');
  try { return fs.readdirSync(dir).some((f) => !f.startsWith('.')); } catch { return false; }
}

function connection(req, socket) {
  const origin = req.headers.origin;
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const h = hostFor(origin);
  if (h.socket && h.socket !== socket) h.socket.end(wsFrame(0x8, Buffer.alloc(0))); // a stale connection
  h.socket = socket;
  clearTimeout(h.idleTimer);
  log(`connected ${origin} to host ${h.child.pid}${h.queue.length ? `; ${h.queue.length} queued messages` : ''}`);
  for (const frame of h.queue.splice(0)) socket.write(frame);

  let done = false;
  const close = (why) => {
    if (done) return;
    done = true;
    clearInterval(ping);
    try { socket.end(wsFrame(0x8, Buffer.alloc(0))); } catch {}
    if (h.socket === socket) {
      h.socket = null;
      log(`disconnected (${why}); host ${h.child.pid} keeps running`);
      idleCheck(origin, h);
    }
  };
  const send = (frame) => { if (!socket.destroyed) socket.write(frame); };
  const reader = new WsReader({
    send,
    onClose: () => close('the extension disconnected'),
    onText: (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (!done && h.child.exitCode === null) h.child.stdin.write(encode(msg));
    },
  });
  socket.on('data', (chunk) => reader.push(chunk));
  socket.on('close', () => close('socket closed'));
  socket.on('error', () => close('socket error'));

  // Keeps idle connections (and anything between) from timing out.
  const ping = setInterval(() => send(wsFrame(0x9, Buffer.alloc(0))), 20000);
}

function main() {
  const server = http.createServer((req, res) => {
    // From the extension: its background's warnings and errors (/log), or why it failed to start.
    if (req.method === 'POST' && (req.url === '/log' || req.url === '/startup-error')) {
      let body = '';
      req.on('data', (c) => { if (body.length < 20000) body += c; });
      req.on('end', () => { log(req.url === '/log' ? `extension ${body}` : `the Safari extension failed to start: ${body}`); res.end(); });
      return;
    }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebMods helper for Safari: WebSocket only.\n');
  });
  server.on('upgrade', (req, socket) => {
    if (!allowed(req)) {
      log(`refused a connection from ${req.headers.origin || 'no origin'}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    connection(req, socket);
  });
  server.on('error', (e) => {
    console.error(`safari-bridge: ${e.code === 'EADDRINUSE' ? `port ${PORT} is in use (is the bridge already running?)` : e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => log(`WebMods Safari bridge listening on 127.0.0.1:${PORT}`));
}

if (require.main === module) main();
module.exports = { allowed, wsFrame, WsReader, ALLOWED_ORIGIN };
