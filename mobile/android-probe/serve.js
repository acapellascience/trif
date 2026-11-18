#!/usr/bin/env node
'use strict';
// The probe pages for the Android emulator: mobile/shared/pages (with their headers) plus this folder's
// pages/, on two ports so there's a second site for the cross-site frame. The emulator reaches both through
// `adb reverse` as its own 127.0.0.1:8477 and localhost:8478 (two sites). Not 10.0.2.2: Android 17 refuses
// local-network addresses to apps without the local network permission (ERR_LOCAL_NETWORK_PERMISSION_MISSING).
//
//   node mobile/android-probe/serve.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { handler } = require('../serve.js');

const OWN = path.join(__dirname, 'pages');
function start(ports = [8477, 8478], log = () => {}) {
  const shared = handler(log);
  const both = (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    log(`${req.method} ${req.socket.localPort} ${req.url}`);
    const file = path.join(OWN, name);
    if (/^[\w.-]+$/.test(name) && fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    return shared(req, res);
  };
  return ports.map((p) => http.createServer(both).listen(p, '0.0.0.0'));
}

if (require.main === module) { start(undefined, console.log); console.log('serving on 8477 and 8478'); }
module.exports = { start };
