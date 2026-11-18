#!/usr/bin/env node
'use strict';
// The probe pages for the Android emulator: mobile/shared/pages (with their headers) plus this folder's
// pages/, on two ports so there's a second site for the cross-site frame. The emulator reaches both through
// `adb reverse` as its own 127.0.0.1:8477 and localhost:8478 (two sites). Not 10.0.2.2: Android 17 refuses
// local-network addresses to apps without the local network permission (ERR_LOCAL_NETWORK_PERMISSION_MISSING).
//
//   node mobile/android-probe/serve.js
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { handler } = require('../serve.js');

const OWN = path.join(__dirname, 'pages');
const CLIP = path.join(__dirname, 'build', 'clip.mp4'); // made by run-c.js with ffmpeg (60 s, silent audio track)

// Part C1: a WebSocket that echoes text frames (just enough of RFC 6455 for the probe, no npm)
function upgrade(req, socket, log) {
  log(`WS ${req.socket.localPort} ${req.url}`);
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on('data', (b) => {
    if ((b[0] & 0x0f) !== 1) return socket.end(); // text frames only; anything else (close) ends it
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { len = b.readUInt16BE(2); off = 4; }
    const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len)).map((x, i) => x ^ mask[i % 4]);
    const text = 'echo:' + data.toString();
    log(`WS message ${data.toString()}`);
    socket.write(Buffer.concat([Buffer.from([0x81, Buffer.byteLength(text)]), Buffer.from(text)]));
  });
  socket.on('error', () => {});
}

function start(ports = [8477, 8478], log = () => {}) {
  const shared = handler(log);
  const both = (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    log(`${req.method} ${req.socket.localPort} ${req.url}`);
    if (name === 'echo' && req.method === 'POST') { // Part C1: what the server got, so the page can compare
      const parts = []; req.on('data', (c) => parts.push(c));
      return req.on('end', () => { const body = Buffer.concat(parts).toString(); log(`POST body ${body}`); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ method: req.method, body })); });
    }
    if (name === 'clip.mp4' && fs.existsSync(CLIP)) { // Part C2, with byte ranges (Chrome's media player asks for them)
      const size = fs.statSync(CLIP).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (!m) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(CLIP).pipe(res); }
      const a = m[1] ? Number(m[1]) : 0, z = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': z - a + 1, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(CLIP, { start: a, end: z }).pipe(res);
    }
    const file = path.join(OWN, name);
    if (/^[\w.-]+$/.test(name) && fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    return shared(req, res);
  };
  return ports.map((p) => { const srv = http.createServer(both); srv.on('upgrade', (req, socket) => upgrade(req, socket, log)); return srv.listen(p, '0.0.0.0'); });
}

if (require.main === module) { start(undefined, console.log); console.log('serving on 8477 and 8478'); }
module.exports = { start };
