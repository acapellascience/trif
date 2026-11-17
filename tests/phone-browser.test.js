'use strict';
// The phone view ("Edit for mobile": extension/phone.js, phone-page.js; docs/MOBILE-EDIT.md) in a real browser:
// TRIF's own extension (a copy with the test pages' host as a granted site), a tab of a local page that tells a
// phone from a desktop the ways sites do (tests/phone-pages.js), the panel's phone.open on it. Checks the
// phone tab is seen as an iPhone by the server (user agent, no client hints, the m. redirect) and by the page
// (navigator, touch, matchMedia, the screen; in a frame too), that a press is a touch, that TRIF can still
// capture it (activeTab came along), that the agent's commands find it, that another tab of the same page
// stays a desktop one, and that Back to desktop and closing the window undo everything.
// Headless Chrome for Testing (tests/cdp-page.js: one browser at a time, the memory guard), with
// TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise. PHONE_SHOTS=<dir> also saves screenshots there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { browserTestsSkip, launch } = require('./cdp-page');
const { servePhonePages, extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the phone view: the site sees an iPhone in that tab only, and Back to desktop undoes it', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}', '--enable-unsafe-extension-debugging'] });
  try {
    const h = await harness(browser);
    const { E, page, ask } = h;
    await ask({ type: 'site.set', site: '127.0.0.1', on: true });
    // the user's window: the page twice (one becomes the phone, the other stays as it is)
    const { phoneTab, homeWin } = await E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, width: 1200, height: 860 });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));
    assert.equal(await page(phoneTab, 'window.__seen.uaPhone'), false, 'a desktop page to start with');
    // TRIF's toolbar button on that tab, as the user opens the panel: activeTab, which the phone keeps
    const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const tabTarget = targetInfos.find((t) => t.type === 'tab' && t.url === pages.url('/detect'));
    await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: tabTarget.targetId });
    await sleep(500);
    await h.shot(phoneTab, 'desktop-before.png');
    const deskTab = await E(([url, windowId]) => chrome.tabs.create({ windowId, url, active: false }).then((t) => t.id), [pages.url('/detect'), homeWin]);

    const opened = await ask({ type: 'phone.open', tabId: phoneTab, screen: { left: 0, top: 25, width: 1470, height: 931 } });
    assert.ok(Number.isInteger(opened.window));
    assert.deepEqual(opened.viewport, { w: 390, h: 750 }, 'the page area is the phone\'s');
    const st = await waitFor('the phone page marked', async () => { const x = await ask({ type: 'phone.state', tabId: phoneTab }); return x.page?.marked && x; });
    assert.deepEqual([st.phone, st.device, st.window, st.rules, st.script, st.page.marked], [true, 'iPhone', opened.window, 2, true, true], 'what the panel logs');
    const win = await E((id) => chrome.windows.get(id, { populate: true }).then((w) => ({ type: w.type, tabs: w.tabs.map((t) => t.id) })), opened.window);
    assert.deepEqual(win, { type: 'popup', tabs: [phoneTab] }, 'the tab itself moved into a popup window');
    // the panel window beside it, following it
    const panelWin = await waitFor('the panel window', () => E((id) => chrome.windows.getAll({ populate: true }).then((ws) => ws.find((w) => w.tabs?.[0]?.url?.includes(`sidepanel.html?window=${id}&fallback=1`))?.id || null), opened.window));
    assert.ok(panelWin);

    await waitFor('the phone page', () => page(phoneTab, 'window.__seen && window.__fetchHeaders && document.readyState === "complete"'));
    const seen = await page(phoneTab, 'window.__seen');
    assert.equal(seen.uaPhone, true, 'navigator.userAgent: an iPhone');
    assert.match(seen.ua, /iPhone OS 18_5/);
    assert.equal(seen.uaData, false, 'no userAgentData (Safari has none)');
    assert.equal(seen.platform, 'iPhone');
    assert.equal(seen.vendor, 'Apple Computer, Inc.');
    assert.equal(seen.touchPoints, 5);
    assert.equal(seen.ontouchstart, true);
    assert.equal(seen.touchEvent, true, 'document.createEvent("TouchEvent") works');
    assert.equal(seen.coarse, true); assert.equal(seen.fine, false);
    assert.equal(seen.hoverNone, true); assert.equal(seen.anyHover, false); assert.equal(seen.both, false);
    assert.equal(seen.orientation, true);
    assert.deepEqual(seen.screen, [390, 844]);
    assert.deepEqual(seen.viewport, [390, 750]);
    assert.equal(await page(phoneTab, 'document.getElementById("server").textContent'), 'phone', 'the server saw an iPhone, without client hints');
    assert.equal(await page(phoneTab, 'getComputedStyle(document.getElementById("layout"), "::after").content'), '"phone"', 'the CSS width query matches');
    const fh = await page(phoneTab, 'window.__fetchHeaders');
    assert.match(fh['user-agent'], /iPhone/, "the page's fetch: an iPhone's user agent");
    assert.deepEqual(Object.keys(fh).filter((k) => k.startsWith('sec-ch-ua')), [], 'and no client hints');
    assert.match(await page(phoneTab, 'document.querySelector("iframe").contentWindow.document.body.textContent'), /^Frame: iPhone, touch 5/, 'a frame too');
    // a press is a touch, and a mouse passing over isn't a hover
    await h.click(phoneTab, '#pad');
    await sleep(300);
    const touches = await page(phoneTab, 'window.__touches');
    // (click is a pointer event too: a finger's, as in Safari)
    for (const want of ['pointerdown:touch', 'touchstart', 'mousedown', 'touchend', 'click:touch']) assert.ok(touches.includes(want), `${want} in ${touches}`);
    assert.ok(!touches.some((t) => t.startsWith('mouseover')), `no hover: ${touches}`);
    assert.ok(touches.indexOf('touchstart') < touches.indexOf('mousedown') && touches.indexOf('touchend') < touches.indexOf('click:touch'));
    await h.shot(phoneTab, 'phone-detect.png');

    // TRIF can still capture it (activeTab came with the tab): what `trif screenshot` uses
    const cap = await E((id) => chrome.tabs.captureVisibleTab(id, { format: 'png' }).then((d) => d.length, (e) => `ERR ${e.message}`), opened.window);
    assert.equal(typeof cap, 'number', `captureVisibleTab of the phone window: ${cap}`);

    // the other tab of the same page is still a desktop one
    await E((id) => chrome.tabs.reload(id), deskTab);
    await waitFor('the desktop tab', () => page(deskTab, 'window.__seen && document.readyState === "complete"'));
    const desk = await page(deskTab, 'window.__seen');
    assert.equal(desk.uaPhone, false); assert.equal(desk.uaData, true); assert.equal(desk.touchPoints, 0); assert.equal(desk.coarse, false);
    assert.equal(await page(deskTab, 'document.getElementById("server").textContent'), 'desktop');

    // the m. sites' redirect
    await E(([id, url]) => chrome.tabs.update(id, { url }), [phoneTab, pages.url('/site')]);
    await waitFor('the redirect', () => E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && t.url.endsWith('/m/site')), phoneTab));
    await waitFor('the mobile page', () => page(phoneTab, 'window.__seen && window.__seen.uaPhone && document.readyState === "complete"'));
    await h.shot(phoneTab, 'phone-m-redirect.png');
    await E(([id, url]) => chrome.tabs.update(id, { url }), [deskTab, pages.url('/site')]);
    await waitFor('the desktop redirect', () => E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && t.url.endsWith('/desktop/site')), deskTab));

    // Back to desktop: the tab where it was, a desktop page again, the rules and the page script gone
    await E(([id, url]) => chrome.tabs.update(id, { url }), [phoneTab, pages.url('/detect')]);
    await waitFor('the page again', () => page(phoneTab, 'window.__seen && document.readyState === "complete"'));
    const back = await ask({ type: 'phone.close', tabId: phoneTab });
    assert.equal(back.back, true);
    const where = await E((id) => chrome.tabs.get(id).then((t) => ({ windowId: t.windowId, index: t.index })), phoneTab);
    assert.deepEqual(where, { windowId: homeWin, index: 0 }, 'back in its window, where it was');
    await waitFor('the desktop page', () => page(phoneTab, 'window.__seen && document.readyState === "complete" && !window.__seen.uaPhone'));
    assert.equal(await page(phoneTab, 'window.__seen.touchPoints'), 0);
    assert.deepEqual(await E(() => chrome.declarativeNetRequest.getSessionRules().then((r) => r.filter((x) => x.id >= 1e6).length)), 0);
    assert.deepEqual(await E(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.length)), 0);
    await waitFor('the panel window to close', () => E((id) => chrome.windows.get(id).then(() => false, () => true), panelWin));

    // Closing the phone window instead: its tab goes with it, and so do the rules
    const again = await ask({ type: 'phone.open', tabId: deskTab, screen: null });
    await E((id) => chrome.windows.remove(id), again.window);
    await waitFor('the rules to go', () => E(() => chrome.declarativeNetRequest.getSessionRules().then((r) => !r.some((x) => x.id >= 1e6))));
    assert.deepEqual(await ask({ type: 'phone.state', tabId: deskTab }), { phone: false });
    assert.deepEqual(await E(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.length)), 0);
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});

// Tim's x.com (2026-11-16): a site with a service worker, visited before. The worker answers the tab's page with
// its own request, which belongs to no tab, so the tab's rules never saw it: the desktop page, no marker, no
// touch. The phone view loads past the worker (a hard reload), and loads again past it when the worker serves
// a later page (a plain reload here); a worker that keeps a copy of the desktop page (an app shell) too.
test('the phone view on a site whose service worker serves its pages (as X\'s does)', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    for (const kind of ['sw', 'swc']) {
      const tabId = await h.E((u) => chrome.windows.create({ url: u, width: 1200, height: 800 }).then((w) => w.tabs[0].id), pages.url(`/${kind}/detect`));
      await waitFor('the worker', () => h.page(tabId, 'window.__sw === true'));
      await h.E((id) => chrome.tabs.reload(id), tabId);
      await waitFor('the page under its worker', () => h.page(tabId, 'document.readyState === "complete" && !!navigator.serviceWorker.controller'));
      assert.equal(await h.page(tabId, 'document.getElementById("server").textContent'), 'desktop');
      await h.ask({ type: 'phone.open', tabId, screen: null });
      const seen = () => h.page(tabId, `document.readyState === 'complete' && window.__fetchHeaders && ({ server: document.getElementById('server').textContent, uaPhone: window.__seen.uaPhone, touch: window.__seen.touchPoints, marked: performance.getEntriesByType('navigation')[0].serverTiming.some((x) => x.name === 'trif-phone'), fetchUa: window.__fetchHeaders['user-agent'] })`);
      const s1 = await waitFor('the phone page', seen);
      assert.deepEqual({ ...s1, fetchUa: /iPhone/.test(s1.fetchUa) }, { server: 'phone', uaPhone: true, touch: 5, marked: true, fetchUa: true }, `${kind}: past the worker`);
      // a plain reload: the worker serves it again, without the rules; TRIF loads it again past the worker
      await h.E((id) => chrome.tabs.reload(id), tabId);
      await sleep(800);
      const s2 = await waitFor('the phone page again', async () => { const x = await seen(); return x && x.marked && x; }, 20000);
      assert.deepEqual([s2.server, s2.uaPhone, s2.touch], ['phone', true, 5], `${kind}: after a plain reload`);
      await h.ask({ type: 'phone.close', tabId });
      await h.E((id) => chrome.tabs.get(id).then((t) => chrome.windows.remove(t.windowId)), tabId);
    }
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});

// TRIF as installed: no site in its manifest (optional <all_urls>, a site given by the panel's Connect). Without
// the site's access, the phone view refuses rather than open a window where nothing is faked. (Chrome won't let
// a test answer its permission prompt, so the access itself comes from the manifest in the tests above: Chrome
// keeps both the same way, as the extension's granted explicit hosts.)
test('the phone view, TRIF as installed, on a site without access: refused, nothing moved', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const browser = await launch({ extension: require('path').join(__dirname, '..', 'extension'), args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    assert.deepEqual(await h.E(() => chrome.permissions.getAll().then((p) => p.origins)), [], 'the real manifest: no site');
    const tabId = await h.E((u) => chrome.windows.create({ url: u }).then((w) => w.tabs[0].id), pages.url('/detect'));
    await sleep(800);
    await assert.rejects(h.ask({ type: 'phone.open', tabId, screen: null }), /isn't on for 127\.0\.0\.1/);
    assert.deepEqual(await h.ask({ type: 'phone.state', tabId }), { phone: false });
    assert.equal(await h.E(() => chrome.declarativeNetRequest.getSessionRules().then((r) => r.length)), 0);
    assert.equal(await h.E(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.length)), 0);
  } finally {
    await browser.close();
    pages.server.close();
  }
});

// The phone view is a TRIF of its own: in its tab only phone mods run, and phone mods nowhere else. The mods are
// registered here as TRIF registers them (lib.js modToUserScript: the free mod's wrapper and its gate, in the
// page's world; and a script in a user script world, as boxed mods are, with the same gate).
test('desktop mods never run in the phone view, phone mods only there', { skip, timeout: 900000 }, async () => {
  const lib = await import(require('url').pathToFileURL(require('path').join(__dirname, '..', 'extension', 'lib.js')).href);
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.allowUserScripts();
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const mark = (who) => `(document.documentElement.dataset.ran = (document.documentElement.dataset.ran || '') + ${JSON.stringify(who + ' ')})`;
    const scripts = [
      lib.modToUserScript({ id: '127.0.0.1/desk', matches: ['*://127.0.0.1/*'], code: mark('desktop') }),
      lib.modToUserScript({ id: 'phone~127.0.0.1/bar', matches: ['*://127.0.0.1/*'], code: mark('phone') }),
      { id: 'phone-world', matches: ['*://127.0.0.1/*'], runAt: 'document_start', world: 'USER_SCRIPT', worldId: 'phone-test', js: [{ code: lib.phoneGate(true, mark('phone-world')) }] },
      { id: 'desk-world', matches: ['*://127.0.0.1/*'], runAt: 'document_start', world: 'USER_SCRIPT', worldId: 'phone-test', js: [{ code: lib.phoneGate(false, mark('desktop-world')) }] },
    ];
    await h.E((list) => chrome.userScripts.register(list), scripts);
    const { phoneTab, deskTab } = await h.E(async (u) => {
      const w = await chrome.windows.create({ url: u, width: 1200, height: 800 });
      const d = await chrome.tabs.create({ windowId: w.id, url: u, active: false });
      return { phoneTab: w.tabs[0].id, deskTab: d.id };
    }, pages.url('/detect'));
    await waitFor('the pages', async () => (await h.page(phoneTab, 'document.readyState === "complete"')) && h.page(deskTab, 'document.readyState === "complete"'));
    const ran = (tab) => h.page(tab, '(document.documentElement.dataset.ran || "").trim().split(" ").sort().join(" ")');
    assert.equal(await ran(phoneTab), 'desktop desktop-world', 'before the phone view: a desktop tab');
    await h.ask({ type: 'phone.open', tabId: phoneTab, screen: null });
    await waitFor('the phone page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    assert.equal(await ran(phoneTab), 'phone phone-world', 'the phone view: phone mods only');
    await h.E((id) => chrome.tabs.reload(id), deskTab);
    await waitFor('the desktop page', () => h.page(deskTab, 'document.readyState === "complete" && !!window.__seen'));
    assert.equal(await ran(deskTab), 'desktop desktop-world', 'a desktop tab of the same page meanwhile: desktop mods only');
    await h.ask({ type: 'phone.close', tabId: phoneTab });
    await waitFor('back to desktop', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && !window.__seen.uaPhone'));
    assert.equal(await ran(phoneTab), 'desktop desktop-world', 'back to desktop: desktop mods again');
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});

// The phone view's panel is the phone twin's own (Tim, 11-16: on X the phone window's panel said "Mods on this site
// (12)" and "Files (5)", the desktop's, with no phone mods yet). No helper here, so the panel page gets the mods
// in the background's status replies (as its uiStatus lists them) and is told it's connected, and answers
// files.list itself, by site (the panel's requests as sent); the phone view itself is the background's. The
// phone panel: no rows, no count left over, no files; the desktop panel, before and after Back to desktop: the
// desktop's mods, their count and files. An empty site, desktop (the panel loaded with no mods or files: the
// stub's sessionStorage stubEmpty) and the phone view: the box's header alone, "(0)" and its ⋯, which opens
// the menu for a real click, Import and Paste on top (Tim, 11-16: a fresh site had no way to paste its first mod).
test('the phone view\'s panel lists the phone twin\'s mods and files, the desktop panel the desktop\'s', { skip, timeout: 900000 }, async () => {
  const { buildMod } = require('../helper/lib/mods');
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.allowUserScripts(); // (as the user has it: no "Mods are paused" over the panels in the screenshots)
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    // (each as the background's status lists mods: uiStatus)
    const mod = (site, name, match) => {
      const m = buildMod({ site, file: `/w/sites/${site}/${name}.js`, code: `// ==WebMod==\n// @name ${name}\n// @match ${match}\n// ==/WebMod==\ndocument.documentElement.dataset.m = ${JSON.stringify(name)};\n` }).mod;
      return { id: m.id, name: m.name, description: '', site: m.site, file: m.file, matches: m.matches, excludes: [], registered: false, enabled: true, error: null, held: null, pending: null, review: null, risk: null, from: null, source: null, sourceChanged: false, version: null, update: null, rules: false, sandboxed: false, unsandboxed: false, powers: [], powerInfo: null, siteReach: null, found: [], newOff: null, chatWaiting: false, imported: false, fixUndo: false, broken: [] };
    };
    const mods = [mod('127.0.0.1', 'desk-one', '*://127.0.0.1/*'), mod('127.0.0.1', 'desk-two', '*://127.0.0.1/*'), mod('all-sites', 'everywhere', '*://*/*'), mod('phone~example.com', 'elsewhere', '*://example.com/*')];
    const files = { '127.0.0.1': ['a.png', 'b.png', 'c.mp3', 'd.txt', 'e.json'].map((name, i) => ({ name, size: 10, at: 1000 - i })) };
    const stub = `(() => {
      const EMPTY = sessionStorage.getItem('stubEmpty') === '1';
      const FILES = EMPTY ? {} : ${JSON.stringify(files)};
      const MODS = EMPTY ? [] : ${JSON.stringify(mods)};
      window.__filesAsked = [];
      window.__imports = [];
      const rt = chrome.runtime;
      const connect = rt.connect.bind(rt);
      rt.connect = (...a) => {
        const port = connect(...a);
        const fns = [];
        const status = new Set();
        port.onMessage.addListener((m) => {
          if (m && m.type === 'reply' && status.has(m.reqId) && m.ok && m.result && m.result.helper) {
            m.result.helper.connected = true;
            m.result.mods = MODS;
            m.result.downloads = window.__offer ? { on: true, state: 'watching', offer: window.__offer } : { on: false, state: 'off' };
          }
          for (const fn of fns) fn(m);
        });
        port.onMessage.addListener = (fn) => { fns.push(fn); };
        window.__poke = () => { for (const fn of fns) fn({ type: 'statusChanged' }); }; // (as the background's broadcast)
        const post = port.postMessage.bind(port);
        port.postMessage = (msg) => {
          if (msg && msg.type === 'files.list') {
            window.__filesAsked.push(msg.site);
            const r = { type: 'reply', reqId: msg.reqId, ok: true, result: { site: msg.site, files: FILES[msg.site] || [] } };
            setTimeout(() => { for (const fn of fns) fn(r); }, 0);
            return;
          }
          const answer = (result) => { const r = { type: 'reply', reqId: msg.reqId, ok: true, result }; setTimeout(() => { for (const fn of fns) fn(r); }, 0); };
          if (msg && msg.type === 'agent.list') return answer({ agents: [{ id: 'claude', name: 'Claude Code', available: true, loggedIn: true }], default: 'claude' }); // (an agent, as the user has: no "Couldn't list coding agents" in the screenshots)
          if (msg && msg.type === 'downloads.take') return answer({ name: 'offered.js', text: '// ==WebMod==\\n// @match *://127.0.0.1/*\\n// ==/WebMod==\\nx();\\n' });
          if (msg && msg.type === 'downloads.done') { window.__offer = null; window.__offerDone = msg.how; return answer({ on: true, state: 'watching' }); }
          if (msg && msg.type === 'mod.import') {
            window.__imports.push({ name: msg.name, site: msg.site, phone: msg.phone === true });
            const r = { type: 'reply', reqId: msg.reqId, ok: true, result: { id: 'stub/imported' } };
            setTimeout(() => { for (const fn of fns) fn(r); }, 0);
            return;
          }
          if (msg && msg.type === 'status') status.add(msg.reqId);
          post(msg);
        };
        return port;
      };
    })();`;
    // A panel window's page, by its address, with the stub in place before its own scripts (loaded again).
    const panelOf = async (query) => {
      const t = await waitFor(`the panel ${query}`, async () => (await browser.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes(`/sidepanel.html${query}`)));
      const sid = await browser._attach(t.targetId);
      await browser.cdp.send('Page.enable', {}, sid);
      await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub }, sid);
      await browser.cdp.send('Page.reload', {}, sid);
      await sleep(500);
      const run = async (expr) => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      // (a real click, at the element's middle, as the user's: what's on top there gets it)
      run.click = async (selector) => {
        const [x, y] = await run(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
        await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid);
        for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }, sid);
      };
      run.shot = async (file) => {
        if (!process.env.PHONE_SHOTS) return;
        const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
        fs.mkdirSync(process.env.PHONE_SHOTS, { recursive: true });
        fs.writeFileSync(require('path').join(process.env.PHONE_SHOTS, file), Buffer.from(data, 'base64'));
      };
      return run;
    };
    // An empty site's box: shown, its header alone (no list area, grip or triangle), the ⋯ there
    const BOX = `(() => {
      const box = document.getElementById('mods'), more = document.getElementById('mods-more');
      const shown = (e) => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
      const sum = box.querySelector('summary').getBoundingClientRect(), b = box.getBoundingClientRect();
      return { shown: shown(box), empty: box.classList.contains('no-mods'), count: document.getElementById('mods-count').textContent,
        more: shown(more), list: shown(document.getElementById('mod-list')), grip: shown(document.getElementById('mods-grip')),
        marker: getComputedStyle(box.querySelector('summary')).listStyleType, compact: b.height - sum.height <= 24, problem: document.body.dataset.problem || '' };
    })()`;
    const boxWant = { shown: true, empty: true, count: '(0)', more: true, list: false, grip: false, marker: 'none', compact: true, problem: '' };
    // The ⋯ clicked: the menu open, Import and Paste each the element on top at its middle. An empty site's opens
    // inside the box (rows under the header, the box grown round them: nothing of the chat around or under it);
    // a site with mods keeps its popup. Then closed again.
    const MENU = `(() => {
      const menu = document.getElementById('mods-menu'), box = document.getElementById('mods');
      const top = (id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; };
      const m = menu.getBoundingClientRect(), b = box.getBoundingClientRect();
      return { open: !menu.hidden && document.getElementById('mods-more').getAttribute('aria-expanded') === 'true',
        items: [...menu.querySelectorAll('.menu-item')].filter((x) => !x.hidden).map((x) => x.textContent),
        onTop: top('import-mod') && top('paste-mod'), boxStill: box.classList.contains('no-mods'),
        inline: getComputedStyle(menu).position === 'static' && m.top >= b.top && m.bottom <= b.bottom && m.left >= b.left && m.right <= b.right };
    })()`;
    const menuWant = { open: true, items: ['Import mod…', 'Paste a mod…'], onTop: true, boxStill: true, inline: true };
    const emptyBox = async (panel, name) => {
      await waitFor(`${name}: the empty box`, async () => JSON.stringify(await panel(BOX)) === JSON.stringify(boxWant)).catch(async (e) => { console.error(JSON.stringify(await panel(BOX))); throw e; });
      await panel.shot(`empty-site-${name}.png`);
      await panel.click('#mods-more');
      await waitFor(`${name}: the menu`, async () => JSON.stringify(await panel(MENU)) === JSON.stringify(menuWant)).catch(async (e) => { console.error(JSON.stringify(await panel(MENU))); throw e; });
      await panel.shot(`empty-site-${name}-menu.png`);
      await panel.click('#mods-count'); // (the header itself, beside the ⋯: the menu closes, the box neither opens nor closes)
      await waitFor(`${name}: the menu closed`, async () => (await panel('document.getElementById("mods-menu").hidden')) === true);
      assert.deepEqual(await panel(BOX), boxWant, `${name}: the box as it was`);
    };
    const LIST = `(() => ({
      phone: document.body.classList.contains('phone-view'),
      box: !document.getElementById('mods').hidden,
      count: document.getElementById('mods-count').textContent,
      rows: [...document.querySelectorAll('#mod-list li[data-mod]')].map((li) => li.dataset.mod).sort(),
      files: document.getElementById('site-files-box').hidden ? null : document.getElementById('site-files-summary').textContent,
      asked: window.__filesAsked.at(-1) || null,
    }))()`;
    // A mod file dropped on a panel (its import): what the panel asks the background for
    const DROP = `(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['// ==WebMod==\\n// @match *://127.0.0.1/*\\n// ==/WebMod==\\nx();\\n'], 'dropped.js', { type: 'text/javascript' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 50 && !window.__imports.length; i++) await new Promise((r) => setTimeout(r, 100));
      return window.__imports.splice(0);
    })()`;
    // Paste a mod… (the Mods ⋯ menu): the card, the text, Add
    const PASTE = `(async () => {
      document.getElementById('paste-mod').click();
      const area = await (async () => { for (let i = 0; i < 50; i++) { const a = document.querySelector('#paste-ask textarea'); if (a) return a; await new Promise((r) => setTimeout(r, 100)); } throw new Error('no paste card'); })();
      area.value = '// ==WebMod==\\n// @name Pasted\\n// @match *://127.0.0.1/*\\n// ==/WebMod==\\nx();\\n';
      area.dispatchEvent(new Event('input'));
      [...document.querySelectorAll('#paste-ask button')].find((b) => b.textContent === 'Add').click();
      for (let i = 0; i < 50 && !window.__imports.length; i++) await new Promise((r) => setTimeout(r, 100));
      return window.__imports.splice(0);
    })()`;
    // A mod file in Downloads, offered (the background's status): its card's Add
    const OFFER = `(async () => {
      window.__offer = { id: 'o1', name: 'Offered', file: 'offered.js', from: 'example.com', description: '', can: [], kind: 'style' };
      window.__poke();
      const add = await (async () => { for (let i = 0; i < 50; i++) { const b = [...document.querySelectorAll('#download-offer button')].find((x) => x.textContent === 'Add'); if (b && !document.getElementById('download-offer').hidden) return b; await new Promise((r) => setTimeout(r, 100)); } throw new Error('no Downloads card'); })();
      add.click();
      for (let i = 0; i < 50 && !window.__offerDone; i++) await new Promise((r) => setTimeout(r, 100));
      const done = window.__offerDone;
      window.__offerDone = null;
      return { imports: window.__imports.splice(0), done };
    })()`;
    const { phoneTab, homeWin } = await h.E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, width: 1200, height: 860 });
      await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false }); // (the window stays while the tab is the phone)
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));
    // the desktop panel first: the desktop mods and files
    await h.E((id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?window=${id}&fallback=1`), focused: false }), homeWin);
    const desk = await panelOf(`?window=${homeWin}&fallback=1`);
    // (first as a fresh site: no mods, no files)
    await desk('sessionStorage.setItem("stubEmpty", "1"), location.reload(), 0');
    await sleep(800);
    await waitFor('the empty desktop panel', async () => (await desk('document.readyState === "complete" && document.getElementById("mods-count").textContent')) === '(0)');
    await emptyBox(desk, 'desktop');
    assert.deepEqual(await desk(PASTE), [{ name: 'pasted.js', site: '', phone: false }], 'the empty desktop panel: Paste a mod…');
    await desk('sessionStorage.removeItem("stubEmpty"), location.reload(), 0');
    await sleep(800);
    const deskWant = { phone: false, box: true, count: '(3)', rows: ['127.0.0.1/desk-one', '127.0.0.1/desk-two', 'all-sites/everywhere'], files: 'Files (5)', asked: '127.0.0.1' };
    await waitFor('the desktop panel\'s list', async () => JSON.stringify(await desk(LIST)) === JSON.stringify(deskWant)).catch(async (e) => { console.error(JSON.stringify(await desk(LIST))); throw e; });
    // (a site with mods: its ⋯ still a popup over the list, Import, Paste and Export on top)
    await desk.shot('site-with-mods.png');
    await desk.click('#mods-more');
    const withMods = { open: true, items: ['Import mod…', 'Paste a mod…', 'Export all mods for 127.0.0.1'], onTop: true, boxStill: false, inline: false };
    await waitFor('the menu over the list', async () => JSON.stringify(await desk(MENU)) === JSON.stringify(withMods)).catch(async (e) => { console.error(JSON.stringify(await desk(MENU))); throw e; });
    await desk.shot('site-with-mods-menu.png');
    await desk.click('#mods-more'); // (the ⋯ again: closed)
    await waitFor('the list\'s menu closed', async () => (await desk('document.getElementById("mods-menu").hidden')) === true);
    assert.deepEqual(await desk(DROP), [{ name: 'dropped.js', site: '', phone: false }], 'the desktop panel\'s import: a desktop mod');
    assert.deepEqual(await desk(PASTE), [{ name: 'pasted.js', site: '', phone: false }], 'a pasted one too');
    assert.deepEqual(await desk(OFFER), { imports: [{ name: 'offered.js', site: '', phone: false }], done: 'added' }, 'and one from Downloads');
    // the phone view: its own panel window, the phone twin's (no mods yet, no files)
    const opened = await h.ask({ type: 'phone.open', tabId: phoneTab, screen: { left: 0, top: 25, width: 1470, height: 931 } });
    await waitFor('the phone page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    const phone = await panelOf(`?window=${opened.window}&fallback=1`);
    const phoneWant = { phone: true, box: true, count: '(0)', rows: [], files: null, asked: 'phone~127.0.0.1' };
    await waitFor('the phone panel\'s list', async () => JSON.stringify(await phone(LIST)) === JSON.stringify(phoneWant)).catch(async (e) => { console.error(JSON.stringify(await phone(LIST))); throw e; });
    await sleep(1500); // (and it stays so: nothing of the desktop's comes back with a later status)
    assert.deepEqual(await phone(LIST), phoneWant);
    await emptyBox(phone, 'phone');
    assert.deepEqual(await phone(DROP), [{ name: 'dropped.js', site: '', phone: true }], 'the phone panel\'s import: a phone mod (the helper writes it in the twin)');
    assert.deepEqual(await phone(PASTE), [{ name: 'pasted.js', site: '', phone: true }], 'a pasted one too');
    assert.deepEqual(await phone(OFFER), { imports: [{ name: 'offered.js', site: '', phone: true }], done: 'added' }, 'and one from Downloads');
    // Back to desktop (from the phone's panel): the tab in its window again, its panel the desktop's
    await phone('document.getElementById("phone-back").click(), 0');
    await waitFor('back to desktop', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && !window.__seen.uaPhone'));
    await h.E(([tab, win]) => chrome.tabs.update(tab, { active: true }).then(() => chrome.windows.update(win, { focused: true })), [phoneTab, homeWin]);
    await waitFor('the desktop panel again', async () => JSON.stringify(await desk(LIST)) === JSON.stringify(deskWant)).catch(async (e) => { console.error(JSON.stringify(await desk(LIST))); throw e; });
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});
