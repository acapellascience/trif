'use strict';
// By hand: the phone view (extension/phone.js) in headless Firefox, through TRIF's Firefox build (run
// `node scripts/build-extension.js firefox` first), a copy granting 127.0.0.1, the local pages of
// tests/phone-pages.js and the panel's phone.open, phone.settle and phone.close. Prints what the page and the
// server saw, and the phone window's sizes. Takes tests/cdp-page.js's lock (one test browser at a time) and kills
// its Firefox over 1.5 GB. TRIF_E2E_FIREFOX picks the Firefox (Tim's: Firefox Developer Edition).
//
//   node tests/phone-firefox.js [screenshot.png]
//
// The window route (11-18): an ordinary window; Firefox's sidebar can't be opened in it from the panel (the
// sidebar opens only from a click, in the window clicked in), so the window first fits a page with no sidebar,
// and the person's click on TRIF's button there opens it. That click is stood in for by Firefox's own
// SidebarController.show in that window (what sidebarAction.toggle runs); the page's resize then has TRIF fit
// the window again, to 390 beside the sidebar. A screenshot argument also saves the whole phone window, the
// browser's toolbar and address bar included (drawSnapshot of the browser window), and the page alone.
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
    const win = out.open.ok && out.open.ok.window;
    // (no sidebar from here: the panel's click can't open it in another window)
    out.settle = await ask({ type: 'phone.settle', tabId, panel: false });
    const sizes = async () => ff.eval(panel, `async (w, id) => { const x = await chrome.windows.get(w); const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => [innerWidth, innerHeight] }); return { window: [x.width, x.height], type: x.type, page: r.result, sidebar: await browser.sidebarAction.isOpen({ windowId: w }) }; }`, [win, tabId]);
    await sleep(1500);
    out.noSidebar = await sizes();
    // the person's click on TRIF's button in the phone window: its sidebar there (Firefox's own call for it)
    const SB = 'webmods_webmods_ext-sidebar-action';
    out.sidebarShown = await ff.chrome(`async (sb) => { const w = Services.wm.getMostRecentWindow('navigator:browser'); await w.SidebarController.show(sb); return w.SidebarController.isOpen; }`, [SB]);
    let fitted = null;
    for (let i = 0; i < 40; i++) { await sleep(250); const z = await sizes(); if (z.sidebar && z.page[0] === 390) { fitted = z; break; } }
    out.withSidebar = fitted || { notFitted: await sizes() };
    out.state = await ask({ type: 'phone.state', tabId });
    // the person widens the window: corrected back
    out.widened = (await ff.eval(panel, `async (w) => (await chrome.windows.update(w, { width: 1100 })).width`, [win]));
    let back = null;
    for (let i = 0; i < 40; i++) { await sleep(250); const z = await sizes(); if (z.page[0] === 390 && z.window[0] < 1100) { back = z; break; } }
    out.afterWiden = back || { notCorrected: await sizes() };
    out.windows = await ff.eval(panel, `async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, type: w.type, w: w.width, h: w.height, tabs: w.tabs.map((t) => t.url.slice(0, 60)) }))`);
    const ctx = await ff.findPage((u) => u.startsWith(pages.url('/detect')));
    out.seen = await ff.eval(ctx, `async () => ({ seen: window.__seen, server: document.getElementById('server').textContent, fetchUa: window.__fetchHeaders && window.__fetchHeaders['user-agent'], frame: document.querySelector('iframe').contentDocument?.body?.textContent })`);
    if (process.argv[2]) {
      // the whole phone window as Firefox draws it: the toolbar and address bar, the page, TRIF's sidebar
      const png = await ff.chrome(`async () => {
        const w = Services.wm.getMostRecentWindow('navigator:browser');
        const r = w.document.documentElement.getBoundingClientRect();
        const bmp = await w.browsingContext.currentWindowGlobal.drawSnapshot(new w.DOMRect(0, 0, r.width, r.height), 2, 'white');
        const c = w.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
        return c.toDataURL('image/png');
      }`).catch((e) => `ERR ${e.message}`);
      if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) fs.writeFileSync(path.resolve(process.argv[2]).replace(/(\.png)?$/, '-window.png'), Buffer.from(png.slice(22), 'base64'));
      else out.windowShot = png;
    }
    out.rules = await ff.eval(panel, `async () => (await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id)`);
    out.capture = await ff.eval(panel, `async (w) => { try { return (await chrome.tabs.captureVisibleTab(w, { format: 'png' })).length; } catch (e) { return 'ERR ' + e.message; } }`, [out.open.ok && out.open.ok.window]);
    if (process.argv[2]) await ff.screenshot(ctx, path.resolve(process.argv[2]));
    // phone.nav (the popup route's bar, which Firefox doesn't get; the background takes it for any phone tab)
    const urlNow = () => ff.eval(panel, `async (id) => { const t = await chrome.tabs.get(id); return t.status === 'complete' ? t.url : null; }`, [tabId]);
    const until = async (want) => { for (let i = 0; i < 40; i++) { const u = await urlNow(); if (u === want) return u; await sleep(250); } return `${await urlNow()} (wanted ${want})`; };
    // the browser's own address bar in the phone window: typed there, the page still the phone's
    out.urlbar = await ff.chrome(`async (u) => { const w = Services.wm.getMostRecentWindow('navigator:browser'); w.gURLBar.focus(); w.gURLBar.value = u; w.gURLBar.handleCommand(); return true; }`, [`127.0.0.1:${pages.port}/second`]).catch((e) => String(e));
    out.urlbarAt = await until(pages.url('/second'));
    await sleep(800);
    out.urlbarPhone = await ff.eval(await ff.findPage((u) => u.startsWith(pages.url('/second'))), `async () => ({ ua: window.__seen && window.__seen.uaPhone, touch: window.__seen && window.__seen.touchPoints, w: innerWidth })`);
    await ask({ type: 'phone.nav', tabId, go: 'url', url: pages.url('/detect') });
    await until(pages.url('/detect'));
    out.nav = {};
    out.nav.url = [await ask({ type: 'phone.nav', tabId, go: 'url', url: `127.0.0.1:${pages.port}/second` }), await until(pages.url('/second'))];
    out.nav.back = [await ask({ type: 'phone.nav', tabId, go: 'back' }), await until(pages.url('/detect'))];
    out.nav.forward = [await ask({ type: 'phone.nav', tabId, go: 'forward' }), await until(pages.url('/second'))];
    out.nav.reload = [await ask({ type: 'phone.nav', tabId, go: 'reload' }), await until(pages.url('/second'))];
    await sleep(1000);
    const navCtx = await ff.findPage((u) => u.startsWith(pages.url('/second')));
    out.nav.stillPhone = await ff.eval(navCtx, `async () => ({ ua: window.__seen && window.__seen.uaPhone, w: innerWidth })`);
    await ask({ type: 'phone.nav', tabId, go: 'url', url: pages.url('/detect') });
    await until(pages.url('/detect'));
    out.close = await ask({ type: 'phone.close', tabId });
    await sleep(2500);
    const ctx2 = await ff.findPage((u) => u.startsWith(pages.url('/detect')));
    out.after = await ff.eval(ctx2, `async () => ({ ua: window.__seen.uaPhone, touch: window.__seen.touchPoints })`);
    out.windowsAfter = await ff.eval(panel, `async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ type: w.type, tabs: w.tabs.length }))`);
    out.rulesAfter = await ff.eval(panel, `async () => (await chrome.declarativeNetRequest.getSessionRules()).length`);
    // The tab alone in its window (11-19): that window made the phone's, its sidebar staying open; Back to
    // desktop gives it its size back
    const lone = await ff.eval(panel, `async (u) => { const w = await chrome.windows.create({ url: u, focused: true, width: 1200, height: 860 }); return { win: w.id, tab: w.tabs[0].id }; }`, [pages.url('/detect')]);
    await sleep(2000);
    out.lone = { sidebar: await ff.chrome(`async (sb) => { const w = Services.wm.getMostRecentWindow('navigator:browser'); await w.SidebarController.show(sb); return w.SidebarController.isOpen; }`, [SB]) };
    await sleep(1000);
    const loneSize = () => ff.eval(panel, `async (w, id) => { const x = await chrome.windows.get(w); const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => innerWidth }); return { window: [x.left, x.top, x.width, x.height], page: r.result, sidebar: await browser.sidebarAction.isOpen({ windowId: w }) }; }`, [lone.win, lone.tab]);
    out.lone.before = await loneSize();
    out.lone.open = await ask({ type: 'phone.open', tabId: lone.tab, screen: { left: 0, top: 25, width: 1470, height: 931 } });
    out.lone.settle = await ask({ type: 'phone.settle', tabId: lone.tab, panel: true });
    await sleep(1500);
    out.lone.phone = await loneSize();
    out.lone.close = await ask({ type: 'phone.close', tabId: lone.tab });
    await sleep(1500);
    out.lone.after = await loneSize();
    out.problems = (await ff.consoleProblems()).filter((p) => /phone|scripting|declarativeNetRequest|Server/i.test(p.text)).slice(0, 8);
  } catch (e) { out.error = e.stack; } finally {
    console.log(JSON.stringify(out, null, 1));
    await ff.stop().catch(() => {}); clearInterval(guard); pages.server.close(); dropLock(); fs.rmSync(dir, { recursive: true, force: true });
  }
})();
