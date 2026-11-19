'use strict';
// Local pages that tell a phone from a desktop in the ways sites do (docs/MOBILE-EDIT.md "How sites tell"), for
// tests/phone-browser.test.js and scripts/phone-shots.js: the server's own answer from the user agent and client
// hints (as Instagram's and Google's servers do), a redirect to a mobile address (the m. sites), and the
// page's own JavaScript and CSS checks. Each page shows its verdicts in big type, for the screenshots.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOBILE_UA = /iPhone|iPad|Android.+Mobile|Mobile Safari/i;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function detectPage(req, title) {
  const ua = req.headers['user-agent'] || '';
  const hints = Object.keys(req.headers).filter((h) => h.startsWith('sec-ch-ua'));
  const server = MOBILE_UA.test(ua) && !hints.length ? 'phone' : MOBILE_UA.test(ua) || req.headers['sec-ch-ua-mobile'] === '?1' ? 'phone (with client hints)' : 'desktop';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body { font: 15px -apple-system, system-ui, sans-serif; margin: 0; padding: 12px; background: #f6f7f9; color: #111; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 7px 10px; margin: 4px 0; border-radius: 8px; background: #fff; }
  .row b { font-weight: 600; }
  .phone { color: #0a7a2f; } .desktop { color: #b3261e; }
  #layout::after { content: "desktop"; color: #b3261e; font-weight: 600; }
  @media (max-width: 500px) { #layout::after { content: "phone"; color: #0a7a2f; } }
  #css-pointer::after { content: "fine (a mouse)"; color: #b3261e; font-weight: 600; }
  @media (pointer: coarse) { #css-pointer::after { content: "coarse"; color: #0a7a2f; } }
  .wide { display: none; } @media (min-width: 900px) { .wide { display: block; } }
  #pad { height: 90px; margin-top: 8px; border-radius: 12px; background: #dde3ea; display: flex; align-items: center; justify-content: center; user-select: none; }
  iframe { width: 100%; height: 70px; border: 0; }
</style>
<script>
  // (what the page's own scripts see, as they run first in <head>)
  window.__seen = {
    ua: navigator.userAgent, uaPhone: /iPhone|Android.+Mobile/.test(navigator.userAgent), uaData: 'userAgentData' in navigator,
    platform: navigator.platform, vendor: navigator.vendor, touchPoints: navigator.maxTouchPoints, ontouchstart: 'ontouchstart' in window,
    touchEvent: (() => { try { document.createEvent('TouchEvent'); return true; } catch { return false; } })(),
    coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, hoverNone: matchMedia('(hover: none)').matches,
    anyHover: matchMedia('(any-hover: hover)').matches, both: matchMedia('(hover: hover) and (pointer: fine)').matches,
    orientation: typeof window.orientation !== 'undefined', screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
  };
</script></head><body>
<h1>${esc(title)}</h1>
<div class="row"><span>Server (user agent, client hints)</span><b class="${server === 'desktop' ? 'desktop' : 'phone'}" id="server">${server}</b></div>
<div class="row"><span>Layout (CSS width)</span><b id="layout"></b></div>
<div id="checks"></div>
<div class="row"><span>CSS pointer query</span><b id="css-pointer"></b></div>
<p class="wide">This line only shows on a wide screen.</p>
<div id="pad">Press here</div>
<iframe src="/frame" title="frame"></iframe>
<script>
  const s = window.__seen, rows = [
    ['navigator.userAgent', s.uaPhone ? 'iPhone' : 'desktop', s.uaPhone],
    ['navigator.userAgentData', s.uaData ? 'there (Chrome)' : 'none (Safari)', !s.uaData],
    ['maxTouchPoints', String(s.touchPoints), s.touchPoints > 0],
    ['ontouchstart / TouchEvent', s.ontouchstart && s.touchEvent ? 'yes' : 'no', s.ontouchstart && s.touchEvent],
    ['matchMedia pointer', s.coarse ? 'coarse' : 'fine', s.coarse && !s.fine],
    ['matchMedia hover', s.hoverNone ? 'none' : 'hover', s.hoverNone && !s.anyHover && !s.both],
    ['window.orientation', s.orientation ? 'there' : 'none', s.orientation],
    ['screen', s.screen.join(' × '), s.screen[0] <= 500],
  ];
  document.getElementById('checks').innerHTML = rows.map(([k, v, ok]) => '<div class="row"><span>' + k + '</span><b class="' + (ok ? 'phone' : 'desktop') + '">' + v + '</b></div>').join('');
  window.__touches = [];
  const pad = document.getElementById('pad');
  for (const t of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'click', 'mouseover']) pad.addEventListener(t, (e) => { window.__touches.push(t + (e.pointerType ? ':' + e.pointerType : '')); pad.textContent = 'Last: ' + t; });
  fetch('/echo').then((r) => r.json()).then((h) => { window.__fetchHeaders = h; });
</script>
</body></html>`;
}

/** Serves the pages on 127.0.0.1:`port` (0: any). Resolves {server, port, url(path), requests}. */
function servePhonePages(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ path: url.pathname, ua: req.headers['user-agent'] || '', hints: Object.keys(req.headers).filter((h) => h.startsWith('sec-ch-ua')) });
    // (a site with a service worker, as X has: /sw/ pages register one that answers every request in its scope
    // by fetching it itself, so the browser's request comes from the worker, not the tab; /swc/ one that keeps
    // the first copy of each page and serves that, as an app shell cache does)
    if (url.pathname === '/sw/sw.js' || url.pathname === '/swc/sw.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(url.pathname.startsWith('/swc/')
        ? "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));\n" +
          "self.addEventListener('fetch', (e) => { if (e.request.mode !== 'navigate') return; e.respondWith(caches.open('pages').then(async (c) => (await c.match(e.request.url)) || fetch(e.request).then((r) => { c.put(e.request.url, r.clone()); return r; }))); });"
        : "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));\n" +
          "self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));");
      return;
    }
    if (url.pathname === '/echo') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.headers)); return; }
    if (url.pathname === '/frame') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><body style="margin:0;font:13px sans-serif"><script>document.body.textContent = "Frame: " + (/iPhone/.test(navigator.userAgent) ? "iPhone" : "desktop") + ", touch " + navigator.maxTouchPoints; window.__frame = {ua: navigator.userAgent, touch: navigator.maxTouchPoints};</script>');
      return;
    }
    // (the m. sites' way: the server sends a phone to another address)
    if (url.pathname === '/site') {
      const phone = MOBILE_UA.test(req.headers['user-agent'] || '');
      res.statusCode = 302;
      res.setHeader('location', phone ? '/m/site' : '/desktop/site');
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/html');
    // (Accept-CH: a site asking for more hints, as Google's does; the phone view must not send them either)
    res.setHeader('accept-ch', 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List');
    const title = url.pathname.startsWith('/m/') ? 'Mobile site (m.)' : url.pathname.startsWith('/desktop/') ? 'Desktop site' : url.pathname.startsWith('/sw') ? 'With a service worker' : 'Phone or desktop?';
    let html = detectPage(req, title);
    if (/^\/swc?\//.test(url.pathname)) html = html.replace('</body>', `<script>navigator.serviceWorker.register('${url.pathname.startsWith('/swc/') ? '/swc/' : '/sw/'}sw.js').then(() => navigator.serviceWorker.ready).then(() => { window.__sw = true; });</script></body>`);
    res.end(html);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    resolve({ server, port: p, url: (path = '/') => `http://127.0.0.1:${p}${path}`, requests });
  }));
}

// ---- driving TRIF's extension in tests/cdp-page.js's browser

/** A copy of extension/ whose manifest grants `hosts` (as the user's Connect would). */
function extensionCopy(hosts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-ext-'));
  fs.cpSync(path.join(__dirname, '..', 'extension'), dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.host_permissions = hosts;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

/** Drives one browser: the service worker, a panel page's port, and pages by tab id. */
async function harness(browser) {
  const sw = await browser.serviceWorker();
  const E = (fn, arg) => sw.evaluate(fn, arg);
  const sessions = new Map();
  const target = async (tabId) => {
    for (let i = 0; i < 60; i++) {
      const { targetInfos } = await browser.cdp.send('Target.getTargets');
      // (a tab's page target: told apart by a marker set from the worker in that tab)
      // (every web page target: a tab's URL and its target's can differ for a moment, during a redirect)
      const t = targetInfos.filter((x) => x.type === 'page' && /^https?:/.test(x.url));
      for (const x of t) {
        const sid = sessions.get(x.targetId) || await browser._attach(x.targetId);
        sessions.set(x.targetId, sid);
        const mark = `m${tabId}`;
        await E(([id, m]) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: (k) => { document.documentElement.dataset.trifTestTab = k; }, args: [m] }), [tabId, mark]).catch(() => {});
        const r = await browser.cdp.send('Runtime.evaluate', { expression: 'document.documentElement.dataset.trifTestTab', returnByValue: true }, sid);
        if (r.result.value === mark) return { targetId: x.targetId, sid };
      }
      await sleep(200);
    }
    throw new Error(`no page target for tab ${tabId}`);
  };
  const page = async (tabId, expr) => {
    const { sid } = await target(tabId);
    const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  // A panel page (sidepanel.html: the background takes the phone view's messages only from it)
  const panelTab = await E(() => chrome.windows.create({ url: chrome.runtime.getURL('sidepanel.html'), focused: false }).then((w) => w.tabs[0].id));
  let panelSid = null;
  for (let i = 0; i < 50 && !panelSid; i++) {
    const { targetInfos } = await browser.cdp.send('Target.getTargets');
    const t = targetInfos.find((x) => x.type === 'page' && x.url.endsWith('/sidepanel.html'));
    if (t) panelSid = await browser._attach(t.targetId); else await sleep(200);
  }
  // (the target can be the window's first blank page a moment longer, without chrome.runtime: "Cannot read
  // properties of undefined (reading 'connect')", CI: until the panel page itself has loaded)
  for (let i = 0; i < 100; i++) {
    const r = await browser.cdp.send('Runtime.evaluate', { expression: 'location.protocol === "chrome-extension:" && document.readyState === "complete" && typeof chrome?.runtime?.connect === "function"', returnByValue: true }, panelSid).catch(() => null);
    if (r?.result?.value === true) break;
    await sleep(100);
  }
  // (defined again whenever it's missing: the page can still be loading when it's first defined, which wipes it:
  // "window.__ask is not a function", CI on the phone-link branch)
  const ASK = `(window.__ask || (window.__ask = (msg) => new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'panel' });
      port.onMessage.addListener((m) => { if (m.type === 'reply' && m.reqId === 1) { port.disconnect(); m.ok ? resolve(m.result) : reject(new Error(m.error)); } });
      port.postMessage({ ...msg, reqId: 1 });
    })))`;
  const ask = async (msg) => {
    const r = await browser.cdp.send('Runtime.evaluate', { expression: `${ASK}(${JSON.stringify(msg)})`, awaitPromise: true, returnByValue: true }, panelSid, 60000);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (tabId, file) => {
    if (!process.env.PHONE_SHOTS) return;
    const { sid } = await target(tabId);
    const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.mkdirSync(process.env.PHONE_SHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.PHONE_SHOTS, file), Buffer.from(data, 'base64'));
  };
  const click = async (tabId, selector) => {
    const { sid } = await target(tabId);
    const r = await browser.cdp.send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`, returnByValue: true }, sid);
    const [x, y] = r.result.value;
    await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 30, y }, sid);
    await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid);
    for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }, sid);
  };
  // "Allow User Scripts", as the user turns it on in chrome://extensions, through that page's own API
  // (developerPrivate), as the e2e does. (Its addHostPermission doesn't give an extension's optional hosts: it
  // answers yes and changes nothing, checked in Chrome 156. So a site's access comes from extensionCopy.)
  const extensionsPage = async (expr) => {
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: `chrome://extensions/?id=${browser.extensionId}` });
    const sid = await browser._attach(targetId);
    await sleep(1000);
    const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
    await browser.cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const id = JSON.stringify(browser.extensionId);
  const allowUserScripts = () => extensionsPage(`new Promise((res, rej) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${id}, userScriptsAccess: true }, () => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(true)))`);
  // The phone view as the panel opens it (sidepanel.js openPhone): phone.open; in the window route, TRIF's side
  // panel opened in the new window from this panel page within a click's gesture (CDP's userGesture: what the
  // 📱 menu's click gives the real panel), unless `panel: false`; then phone.settle. One result: {window, route,
  // viewport, panel}.
  const openPhone = async (tabId, screen = null, { panel = true } = {}) => {
    const r = await ask({ type: 'phone.open', tabId, screen });
    if (r.route !== 'window' || r.already) return r;
    let opened = false;
    if (panel) {
      const g = await browser.cdp.send('Runtime.evaluate', { expression: `chrome.sidePanel.open({ windowId: ${r.window} }).then(() => true, (e) => 'ERR ' + e.message)`, awaitPromise: true, returnByValue: true, userGesture: true }, panelSid);
      opened = g.result?.value === true;
      if (!opened) throw new Error(`the side panel didn't open in the phone window: ${JSON.stringify(g.result?.value ?? g.exceptionDetails)}`);
    }
    return { ...r, ...(await ask({ type: 'phone.settle', tabId, panel: opened })) };
  };
  return { sw, E, page, ask, shot, click, target, panelTab, allowUserScripts, openPhone, panelSid };
}

const waitFor = async (what, fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
};

module.exports = { servePhonePages, MOBILE_UA, extensionCopy, harness, waitFor };

