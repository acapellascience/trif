#!/usr/bin/env node
'use strict';
// The Tune Composer's dev page without X: a mock X page (tests/dev/tune-composer.html) with the mod
// (examples/sites/x.com/tune-composer.js) loaded as a plain script.
//
//   node tests/dev/serve.js [port]      (default 8793) then open http://localhost:<port>/
//
// / goes to /settings/profile (the mock Edit profile, with the composer's "♪ Tune" button beside Save, opened
// at once; ?closed leaves it closed). Any other page path (/home, …) is the same mock without the dialog:
// Alt+Shift+T opens the composer there. /mod/tune-composer.js is the mod, read fresh on every load.

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEV = __dirname;
const MOD = path.join(DEV, '..', '..', 'examples', 'sites', 'x.com', 'tune-composer.js');
const PAGE = path.join(DEV, 'tune-composer.html');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.argv[2] || process.env.PORT || 8793);

function fileFor(pathname) {
  if (pathname === '/mod/tune-composer.js') return MOD;
  if (pathname.startsWith('/dev/')) {
    const f = path.resolve(DEV, '.' + pathname.slice(4));
    return f.startsWith(DEV + path.sep) ? f : null;
  }
  return path.extname(pathname) ? null : PAGE;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400).end(); return; }
  if (url.pathname === '/') { res.writeHead(302, { Location: '/settings/profile' }).end(); return; }
  const file = fileFor(decodeURIComponent(url.pathname));
  fs.readFile(file || '', (err, body) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Tune Composer dev page on http://localhost:${port}/`));
