'use strict';
// By hand: the phone view (extension/phone.js) in headless Firefox, through TRIF's Firefox build (run
// `node scripts/build-extension.js firefox` first), a copy granting 127.0.0.1, the local pages of
// tests/phone-pages.js and the panel's phone.open and phone.close. Prints what the page and the server saw.
// Takes tests/cdp-page.js's lock (one test browser at a time) and kills its Firefox over 1.5 GB.
//
//   node tests/phone-firefox.js [screenshot.png]
// (Checked 2026-11-16 with Firefox 159: everything but the capture, which needs activeTab from a toolbar click.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const W = path.join(__dirname, '..');
const { FirefoxDriver, ADDON_ID, ADDON_UUID } = require(W + '/tests/e2e/lib/firefox');
const { servePhonePages } = require(W + '/tests/phone-pages');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = path.join(os.tmpdir(), 'trif-cdp-page.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function takeLock() { for (;;) { try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); return; } catch (e) { let pid = 0; try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch {} if (pid && !alive(pid)) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; } await sleep(1000); } } }
const dropLock = () => { try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
(async () => {
  await takeLock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-ff-phone-'));
  const ext = path.join(dir, 'ext'); fs.cpSync(W + '/dist/firefox', ext, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); m.host_permissions = ['*://127.0.0.1/*']; fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true }); fs.mkdirSync(path.join(dir, 'native', 'NativeMessagingHosts'), { recursive: true });
  const ff = new FirefoxDriver({ profile: path.join(dir, 'profile'), home: path.join(dir, 'home'), nativeDir: path.join(dir, 'native'), extensionDir: ext, headless: true });
  const guard = setInterval(() => execFile('/bin/ps', ['-axo', 'rss=,command='], (e, out) => { if (e) return; let max = 0; for (const l of out.split('\n')) if (l.includes(dir)) max = Math.max(max, parseInt(l, 10) || 0); if (max > 1536 * 1024) { console.error('memory guard: ' + max); try { execFileSync('/usr/bin/pkill', ['-KILL', '-f', dir]); } catch {} process.exit(2); } }), 2000);
  const pages = await servePhonePages();
  const out = {};
  try {
    await ff.start(); out.version = ff.version;
    await ff.isolateNativeMessaging();
    await ff.installExtension();
    await ff.chrome(`async (id) => { const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs'); await ExtensionPermissions.add(id, { permissions: [], origins: ['*://127.0.0.1/*'] }); }`, [ADDON_ID]);
    const pageCtx = await ff.openTab(pages.url('/detect'));
    const panel = await ff.openTab(`moz-extension://${ADDON_UUID}/sidepanel.html`);
    await sleep(1500);
    const ask = (msg) => ff.eval(panel, `async (msg) => new Promise((resolve) => { const port = chrome.runtime.connect({ name: 'panel' }); port.onMessage.addListener((m) => { if (m.type === 'reply' && m.reqId === 1) { port.disconnect(); resolve(m.ok ? { ok: m.result } : { error: m.error }); } }); port.postMessage({ ...msg, reqId: 1 }); })`, [msg]);
    out.siteSet = await ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const tabId = await ff.eval(panel, `async (u) => (await chrome.tabs.query({})).find((t) => (t.url || '').startsWith(u))?.id`, [pages.url('/detect')]);
    out.before = await ff.eval(pageCtx, `async () => window.__seen.uaPhone`);
    out.open = await ask({ type: 'phone.open', tabId, screen: { left: 0, top: 25, width: 1470, height: 931 } });
    await sleep(3000);
    out.windows = await ff.eval(panel, `async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, type: w.type, w: w.width, h: w.height, tabs: w.tabs.map((t) => t.url.slice(0, 60)) }))`);
    const ctx = await ff.findPage((u) => u.startsWith(pages.url('/detect')));
    out.seen = await ff.eval(ctx, `async () => ({ seen: window.__seen, server: document.getElementById('server').textContent, fetchUa: window.__fetchHeaders && window.__fetchHeaders['user-agent'], frame: document.querySelector('iframe').contentDocument?.body?.textContent })`);
    out.rules = await ff.eval(panel, `async () => (await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id)`);
    out.capture = await ff.eval(panel, `async (w) => { try { return (await chrome.tabs.captureVisibleTab(w, { format: 'png' })).length; } catch (e) { return 'ERR ' + e.message; } }`, [out.open.ok && out.open.ok.window]);
    if (process.argv[2]) await ff.screenshot(ctx, path.resolve(process.argv[2]));
    // The navigation bar's phone.nav (11-18): an address, back, forward, reload, in the phone tab
    const urlNow = () => ff.eval(panel, `async (id) => { const t = await chrome.tabs.get(id); return t.status === 'complete' ? t.url : null; }`, [tabId]);
    const until = async (want) => { for (let i = 0; i < 40; i++) { const u = await urlNow(); if (u === want) return u; await sleep(250); } return `${await urlNow()} (wanted ${want})`; };
    out.nav = {};
    out.nav.url = [await ask({ type: 'phone.nav', tabId, go: 'url', url: `127.0.0.1:${pages.port}/second` }), await until(pages.url('/second'))];
    out.nav.back = [await ask({ type: 'phone.nav', tabId, go: 'back' }), await until(pages.url('/detect'))];
    out.nav.forward = [await ask({ type: 'phone.nav', tabId, go: 'forward' }), await until(pages.url('/second'))];
    out.nav.reload = [await ask({ type: 'phone.nav', tabId, go: 'reload' }), await until(pages.url('/second'))];
    await sleep(1000);
    const navCtx = await ff.findPage((u) => u.startsWith(pages.url('/second')));
    out.nav.stillPhone = await ff.eval(navCtx, `async () => ({ ua: window.__seen && window.__seen.uaPhone, w: innerWidth })`);
    // (the phone's panel window: its banner with the bar; a screenshot of it as a second argument's sibling)
    try {
      const pctx = await ff.findPage((u) => u.includes('sidepanel.html?window='));
      out.nav.panel = await ff.eval(pctx, `async () => { for (let i = 0; i < 40 && document.getElementById('phone-note').hidden; i++) await new Promise((r) => setTimeout(r, 250)); return { banner: !document.getElementById('phone-note').hidden, url: document.getElementById('phone-nav-url').value, menu: [...document.querySelectorAll('#phone-menu [role=menuitem]')].map((b) => b.textContent) }; }`);
      if (process.argv[2]) await ff.screenshot(pctx, path.resolve(process.argv[2]).replace(/(\.png)?$/, '-panel.png'));
    } catch (e) { out.nav.panel = `no panel window: ${e.message}`; }
    await ask({ type: 'phone.nav', tabId, go: 'url', url: pages.url('/detect') });
    await until(pages.url('/detect'));
    out.close = await ask({ type: 'phone.close', tabId });
    await sleep(2500);
    const ctx2 = await ff.findPage((u) => u.startsWith(pages.url('/detect')));
    out.after = await ff.eval(ctx2, `async () => ({ ua: window.__seen.uaPhone, touch: window.__seen.touchPoints })`);
    out.windowsAfter = await ff.eval(panel, `async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ type: w.type, tabs: w.tabs.length }))`);
    out.rulesAfter = await ff.eval(panel, `async () => (await chrome.declarativeNetRequest.getSessionRules()).length`);
    out.problems = (await ff.consoleProblems()).filter((p) => /phone|scripting|declarativeNetRequest|Server/i.test(p.text)).slice(0, 8);
  } catch (e) { out.error = e.stack; } finally {
    console.log(JSON.stringify(out, null, 1));
    await ff.stop().catch(() => {}); clearInterval(guard); pages.server.close(); dropLock(); fs.rmSync(dir, { recursive: true, force: true });
  }
})();
