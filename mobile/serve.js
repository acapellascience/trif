#!/usr/bin/env node
'use strict';
// Serves the probe pages (mobile/shared/pages) with each page's own headers (pages.json), for the Safari
// probe: Safari in the iOS Simulator reaches this Mac as localhost; a real iPhone on the same Wi-Fi reaches
// it by the Mac's .local name. The browser probe app carries the same pages inside it and doesn't need this.
//
//   node mobile/serve.js [port]        (default 8377)
//
// /trif-install is the address a "mod link" would have, and /trif-probe-canary is what the network checks
// ask for: each request for it is printed, so a blocked one is the one that never shows up here.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PAGES = path.join(__dirname, 'shared', 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function handler(log = console.log) {
  const headers = JSON.parse(fs.readFileSync(path.join(PAGES, 'pages.json'), 'utf8'));
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    let name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (name === 'trif-probe-canary') {
      log(`canary asked for: ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end('canary');
    }
    if (name === 'trif-install') name = 'install.html';
    if (name === '') {
      const list = Object.keys(headers).map((f) => `<li><a href="${f}">${f}</a>${headers[f]['Content-Security-Policy'] ? ' (strict policy)' : ''}</li>`).join('');
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TRIF probe pages</title><body style="font: 18px/1.6 -apple-system, sans-serif; padding: 16px"><h1>TRIF probe pages</h1><ul>${list}<li><a href="trif-install#hide=.cookie-consent">a mod link</a></li></ul>`);
    }
    const file = path.join(PAGES, name);
    if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(headers[name] || {}) });
    res.end(fs.readFileSync(file));
  };
}

function main() {
  const port = Number(process.argv[2]) || 8377;
  http.createServer(handler()).listen(port, '0.0.0.0', () => {
    console.log('TRIF probe pages:');
    console.log(`  in the iOS Simulator:  http://localhost:${port}/`);
    console.log(`  on an iPhone (same Wi-Fi):  http://${os.hostname().replace(/\.local$/, '')}.local:${port}/`);
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`                              http://${a.address}:${port}/`);
  });
}

if (require.main === module) main();
module.exports = { handler, PAGES };
