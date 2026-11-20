#!/usr/bin/env node
'use strict';
// Serves the probe pages (mobile/shared/pages) with each page's own headers (pages.json), for the Safari
// probe: Safari in the iOS Simulator reaches this Mac as localhost; a real iPhone on the same Wi-Fi reaches
// it by the Mac's .local name. The browser probe app carries the same pages inside it and doesn't need this.
//
//   node mobile/serve.js [port]        (default 8377)
//
// /trif-install is the address a "mod link" would have, and /trif-probe-canary is what the network checks
// ask for: each request for it is printed, so a blocked one is the one that never shows up here. chat.html (and
// /chat/<id>) is a stand-in chat for the browser probe's chat in the Simulator (TrifProbe's -chathome).

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PAGES = path.join(__dirname, 'shared', 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function handler(log = console.log) {
  const conversations = {};
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
    // (what the browser says it is: the user agent it sent and its page's navigator, platform and width, for Request
    // Desktop Website; `?nometa` drops the width=device-width viewport, as a desktop-only site has none)
    if (name === 'agent') {
      const sent = String(req.headers['user-agent'] || '').replace(/[<>&"]/g, '');
      const meta = url.searchParams.has('nometa') ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">';
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      return res.end(`<!doctype html><meta charset="utf-8">${meta}<title>Agent check</title><body style="font: 16px -apple-system, sans-serif; margin: 12px">
<h2 id="mode"></h2><p>sent: <span id="sent">${sent}</span></p><p>navigator: <span id="nav"></span></p><p id="more"></p>
<p style="width: 900px; background: #eee">A 900px wide bar.</p>
<script>
const mob = /Mobile|iPhone/.test(navigator.userAgent), w = document.documentElement.clientWidth;
document.getElementById('mode').textContent = (mob ? 'MOBILE' : 'DESKTOP') + ' · ' + w + 'px';
document.getElementById('nav').textContent = navigator.userAgent;
document.getElementById('more').textContent = 'host ' + location.host + ' · platform ' + navigator.platform + ' · innerWidth ' + innerWidth;
window.__agent = { host: location.host, sent: ${JSON.stringify(sent)}, nav: navigator.userAgent, platform: navigator.platform, width: w };
</script>`);
    }
    // (the stand-in chat's files: a mod file to download (stand-in-file/<name>.js), which comes to TRIF only when
    // the person taps its link)
    const fileMatch = /^stand-in-file\/([\w-]+)\.js$/.exec(name);
    if (fileMatch) {
      const title = fileMatch[1].replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const css = fileMatch[1].includes('feed') || fileMatch[1].includes('calmer') ? '.feed-item h2 { color: #1f8a5b }' : '.cookie-consent { outline: 3px solid #f91880 }';
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileMatch[1]}.js"`, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(`// ==WebMod==\n// @name        ${title}\n// @description Made by the stand-in chat\n// @match       http://localhost/*\n// @style\n// ==/WebMod==\n${JSON.stringify({ css }, null, 2)}\n`);
    }
    // (a signed-out chat, as claude.ai sends one to its sign-in page: `?signedout` on the chat's address goes to /login,
    // a page with no message box and its Log in buttons: the quick ask's "Sign in to … first")
    if (url.searchParams.has('signedout') && (name === 'chat.html' || name === 'new' || /^(chat|c)\/[\w-]+$/.test(name))) {
      res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (name === 'login') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Log in (stand-in)</title>
<body style="font: 17px/1.5 -apple-system, sans-serif; padding: 40px 20px; text-align: center"><h1>Log in (stand-in)</h1>
<p>Signed out: there's no message box here.</p><p><button style="font: inherit; padding: 10px 18px">Continue with Google</button></p>
<p><input type="email" placeholder="Enter your email" style="font: inherit; padding: 8px"></p><p><button style="font: inherit; padding: 10px 18px">Log in</button></p>`);
    }
    // (the stand-in chat's `?keep`: its conversations kept here, by address, as a service keeps them on its servers (a
    // page's own storage can be lost when the app is killed): POST adds an exchange, GET gives them all)
    const kept = /^standin-conv\/((?:chat|c)\/[\w-]+)$/.exec(name);
    if (kept) {
      const key = kept[1];
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => { try { (conversations[key] = conversations[key] || []).push(JSON.parse(body)); } catch (e) {} res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(conversations[key] || []));
    }
    if (/^c\/[\w:-]+$/.test(name)) name = 'chat.html'; // (and ChatGPT's provisional /c/local-chatgpt:<uuid>, 11-20)
    // (the stand-in chat's conversations, /chat/<id>, as claude.ai's are: the one page, chat.html)
    if (/^chat\/[\w-]+$/.test(name)) name = 'chat.html';
    // (and claude.ai's new-chat page, /new: a chat there gets /chat/<id> at its first send)
    if (name === 'new') name = 'chat.html';
    // (and a project's page, /project/<id>, as claude.ai's: its message box starts a chat in the project)
    if (/^project\/[\w-]+$/.test(name)) name = 'chat.html';
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
