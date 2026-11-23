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
// (This file and tests/phone-window-browser.test.js, tests/phone-helper-browser.test.js were one until 11-21: on CI
// its eleven browsers, one at a time behind the other files' under cdp-page.js's lock, passed npm test's 180 s a file.)

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

    // (the window route, 11-18: an ordinary window, TRIF's side panel opened in it from the panel's click)
    const opened = await h.openPhone(phoneTab, { left: 0, top: 25, width: 1470, height: 931 });
    assert.ok(Number.isInteger(opened.window));
    assert.equal(opened.route, 'window');
    assert.equal(opened.panel, true, 'TRIF\'s side panel is there, beside the page');
    const W = opened.viewport.w;
    assert.equal(opened.viewport.h, 780, 'the page area is the phone\'s height');
    // the page's width: the phone's, or as narrow as the browser lets this window go with its side panel (headless
    // Chrome 156: a 792 px window, a 406 px page)
    const winW = () => E((id) => chrome.windows.get(id).then((w) => w.width), opened.window);
    const pageW = () => page(phoneTab, 'innerWidth');
    if (W !== 402) {
      const before = await winW();
      await E(([id, width]) => chrome.windows.update(id, { width }), [opened.window, before - 20]);
      await sleep(800);
      assert.equal(await winW(), before, `a ${W} px page: the window can't go narrower`);
      assert.ok(W > 402 && W < 500, `${W}: a phone's width, near enough`);
    }
    console.log(`# the phone view's page: ${W} x ${opened.viewport.h} in a ${await winW()} px window with the side panel`);
    // The person widens the window: its width corrected back (the page's resize listener, phone.js watchSize)
    await waitFor('the page\'s size watched', () => page(phoneTab, 'document.readyState === "complete"'));
    await sleep(500);
    await E((id) => chrome.windows.update(id, { width: 1100 }), opened.window);
    await waitFor('the width corrected', async () => (await pageW()) === W && (await winW()) < 1100, 15000);
    // The side panel closed: the window goes as narrow as it can without it; opened again (a click), back to the phone's
    const closed = await E((id) => chrome.sidePanel.close({ windowId: id }).then(() => true, (e) => e.message), opened.window);
    if (closed === true) {
      await waitFor('narrowed without the panel', async () => (await winW()) <= 520 && (await pageW()) <= 520, 15000);
      console.log(`# without the side panel: a ${await pageW()} px page in a ${await winW()} px window`);
      const g = await browser.cdp.send('Runtime.evaluate', { expression: `chrome.sidePanel.open({ windowId: ${opened.window} }).then(() => true, (e) => e.message)`, awaitPromise: true, returnByValue: true, userGesture: true }, h.panelSid);
      assert.equal(g.result.value, true);
      await waitFor('the phone\'s width again, with the panel', async () => (await pageW()) === W, 15000);
    } else console.log(`# sidePanel.close: ${closed}`);
    const st = await waitFor('the phone page marked, its width as measured last', async () => { const x = await ask({ type: 'phone.state', tabId: phoneTab }); return x.page?.marked && x.width === W && x; });
    assert.deepEqual([st.phone, st.device, st.window, st.route, st.width, st.panel, st.rules, st.script, st.page.marked], [true, 'iPhone', opened.window, 'window', W, true, 2, true, true], 'what the panel logs');
    const win = await E((id) => chrome.windows.get(id, { populate: true }).then((w) => ({ type: w.type, tabs: w.tabs.map((t) => t.id) })), opened.window);
    assert.deepEqual(win, { type: 'normal', tabs: [phoneTab] }, 'the tab itself moved into an ordinary window of its own');
    assert.equal(await E((id) => chrome.windows.getAll({ populate: true }).then((ws) => ws.filter((w) => w.tabs?.[0]?.url?.includes(`sidepanel.html?window=${id}`)).length), opened.window), 0, 'no panel window: the side panel instead');

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
    assert.deepEqual(seen.screen, [402, 874]);
    assert.deepEqual(seen.viewport, [W, 780]);
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

    // Back to desktop (11-20): the phone window expanded back out to the user's window's size, the tab and its side
    // panel still in it; a desktop page again, the rules and the page script gone
    await E(([id, url]) => chrome.tabs.update(id, { url }), [phoneTab, pages.url('/detect')]);
    await waitFor('the page again', () => page(phoneTab, 'window.__seen && document.readyState === "complete"'));
    const homeSize = await E((id) => chrome.windows.get(id).then((w) => [w.width, w.height]), homeWin);
    const back = await ask({ type: 'phone.close', tabId: phoneTab });
    assert.equal(back.back, true);
    assert.equal(back.window, opened.window);
    assert.equal(await E((id) => chrome.tabs.get(id).then((t) => t.windowId), phoneTab), opened.window, 'still in its window');
    await waitFor('expanded back out', async () => JSON.stringify(await E((id) => chrome.windows.get(id).then((w) => [w.width, w.height]), opened.window)) === JSON.stringify(homeSize));
    await waitFor('the desktop page', () => page(phoneTab, 'window.__seen && document.readyState === "complete" && !window.__seen.uaPhone'));
    assert.equal(await page(phoneTab, 'window.__seen.touchPoints'), 0);
    assert.deepEqual(await E(() => chrome.declarativeNetRequest.getSessionRules().then((r) => r.filter((x) => x.id >= 1e6).length)), 0);
    assert.deepEqual(await E(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.length)), 0);
    await E((id) => chrome.windows.remove(id), opened.window);

    // Closing the phone window instead: its tab goes with it, and so do the rules
    const again = await h.openPhone(deskTab, null, { panel: false });
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
      await h.openPhone(tabId, null);
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
    await h.openPhone(phoneTab, null);
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
// desktop's mods, their count and files.
test('the phone view\'s panel lists the phone twin\'s mods and files, the desktop panel the desktop\'s', { skip, timeout: 900000 }, async () => {
  const { buildMod } = require('../helper/lib/mods');
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    // (each as the background's status lists mods: uiStatus)
    const mod = (site, name, match) => {
      const m = buildMod({ site, file: `/w/sites/${site}/${name}.js`, code: `// ==WebMod==\n// @name ${name}\n// @match ${match}\n// ==/WebMod==\ndocument.documentElement.dataset.m = ${JSON.stringify(name)};\n` }).mod;
      return { id: m.id, name: m.name, description: '', site: m.site, file: m.file, matches: m.matches, excludes: [], registered: false, enabled: true, error: null, held: null, pending: null, review: null, risk: null, from: null, source: null, sourceChanged: false, version: null, update: null, rules: false, sandboxed: false, unsandboxed: false, powers: [], powerInfo: null, siteReach: null, found: [], newOff: null, chatWaiting: false, imported: false, fixUndo: false, broken: [] };
    };
    const mods = [mod('127.0.0.1', 'desk-one', '*://127.0.0.1/*'), mod('127.0.0.1', 'desk-two', '*://127.0.0.1/*'), mod('all-sites', 'everywhere', '*://*/*'), mod('phone~example.com', 'elsewhere', '*://example.com/*')];
    const files = { '127.0.0.1': ['a.png', 'b.png', 'c.mp3', 'd.txt', 'e.json'].map((name, i) => ({ name, size: 10, at: 1000 - i })) };
    const stub = `(() => {
      const FILES = ${JSON.stringify(files)};
      const MODS = ${JSON.stringify(mods)};
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
      return async (expr) => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
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
    const deskWant = { phone: false, box: true, count: '(3)', rows: ['127.0.0.1/desk-one', '127.0.0.1/desk-two', 'all-sites/everywhere'], files: 'Files (5)', asked: '127.0.0.1' };
    await waitFor('the desktop panel\'s list', async () => JSON.stringify(await desk(LIST)) === JSON.stringify(deskWant)).catch(async (e) => { console.error(JSON.stringify(await desk(LIST))); throw e; });
    assert.deepEqual(await desk(DROP), [{ name: 'dropped.js', site: '', phone: false }], 'the desktop panel\'s import: a desktop mod');
    assert.deepEqual(await desk(PASTE), [{ name: 'pasted.js', site: '', phone: false }], 'a pasted one too');
    assert.deepEqual(await desk(OFFER), { imports: [{ name: 'offered.js', site: '', phone: false }], done: 'added' }, 'and one from Downloads');
    // the phone view: its own panel window, the phone twin's (no mods yet, no files). (From the desktop panel's menu:
    // a panel window's, so the popup route, as in Arc, and the phone's panel in a window beside it)
    await desk('document.getElementById("phone-btn").click(), document.getElementById("phone-menu-view").click(), 0');
    const opened = await waitFor('the phone window', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((x) => x.phone && x));
    assert.equal(opened.route, 'popup');
    await waitFor('the phone page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    const phone = await panelOf(`?window=${opened.window}&fallback=1`);
    const phoneWant = { phone: true, box: false, count: '(0)', rows: [], files: null, asked: 'phone~127.0.0.1' };
    await waitFor('the phone panel\'s list', async () => JSON.stringify(await phone(LIST)) === JSON.stringify(phoneWant)).catch(async (e) => { console.error(JSON.stringify(await phone(LIST))); throw e; });
    await sleep(1500); // (and it stays so: nothing of the desktop's comes back with a later status)
    assert.deepEqual(await phone(LIST), phoneWant);
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

// The phone view's panel (11-18): its navigation bar (the phone window is a popup with no address bar of its own:
// back, forward, reload and an address, for the phone tab, while the page keeps the phone's size); the phone line
// (Connect a phone with none paired; Syncing with {phone}, Sync now and what that sync did); the bar's phone menu
// (Switch to phone view / Back to desktop, Sync with phone), by keyboard too; light and dark. The helper's
// phoneLink.* answers are a stub's (the relay through another browser's helper is tests/phone-link-host.test.js').
// PHONE_SHOTS=<dir> saves the screenshots.
test('the phone view\'s panel: its navigation bar, the phone line and the phone menu', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  // (the address field's search goes to Google: never reached from here, its address is what's checked)
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}', '--host-resolver-rules=MAP www.google.com ~NOTFOUND'] });
  const QR = 'trif://pair?v=1&k=q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA&s=Zm9vYmFyYmF6cXV1eHF1dXV4&n=Study%20Mac';
  try {
    const h = await harness(browser);
    await h.allowUserScripts().catch(() => {}); // (no "Mods are paused" in the shots)
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    // (the helper as the panel sees it: connected; its phoneLink.* answers from window.__link)
    const stub = `(() => {
      window.__link = { status: { on: false, sync: true, id: null, name: 'Study Mac', port: 0, phones: [], pairing: null, listen: false, here: true, listening: false, announce: null }, told: [] };
      window.__asked = [];
      const rt = chrome.runtime;
      const connect = rt.connect.bind(rt);
      rt.connect = (...a) => {
        const port = connect(...a);
        const fns = [];
        const status = new Set();
        port.onMessage.addListener((m) => {
          if (m && m.type === 'reply' && status.has(m.reqId) && m.ok && m.result && m.result.helper) m.result.helper.connected = true;
          for (const fn of fns) fn(m);
        });
        port.onMessage.addListener = (fn) => { fns.push(fn); };
        window.__news = (st) => { window.__link.status = st; for (const fn of fns) fn({ type: 'phoneLink', status: st }); };
        const post = port.postMessage.bind(port);
        port.postMessage = (msg) => {
          const answer = (result) => { const r = { type: 'reply', reqId: msg.reqId, ok: true, result }; setTimeout(() => { for (const fn of fns) fn(r); }, 0); };
          if (msg && typeof msg.type === 'string' && msg.type.startsWith('phoneLink.')) {
            window.__asked.push(msg.type);
            const L = window.__link;
            if (msg.type === 'phoneLink.on') L.status = { ...L.status, on: true, id: 'c0ffee0123456789' };
            if (msg.type === 'phoneLink.pair.start') return answer({ qr: ${JSON.stringify(QR)}, expires: Date.now() + 300000, ...L.status, pairing: { expires: Date.now() + 300000 } });
            if (msg.type === 'phoneLink.syncNow') return answer({ told: L.told, ...L.status });
            return answer(L.status);
          }
          if (msg && msg.type === 'status') status.add(msg.reqId);
          post(msg);
        };
        return port;
      };
    })();`;
    const panelOf = async (query) => {
      const t = await waitFor(`the panel ${query}`, async () => (await browser.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes(`/sidepanel.html${query}`)));
      const sid = await browser._attach(t.targetId);
      await browser.cdp.send('Page.enable', {}, sid);
      await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub }, sid);
      await browser.cdp.send('Page.reload', {}, sid);
      await sleep(800);
      const ev = async (expr) => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      // (typing as a person does: a click in the field, the text, Enter)
      const type = async (selector, text) => {
        const [x, y] = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        for (const t of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }, sid);
        await browser.cdp.send('Input.insertText', { text }, sid);
        for (const t of ['keyDown', 'keyUp']) await browser.cdp.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(t === 'keyDown' ? { text: '\r' } : {}) }, sid);
      };
      const key = async (k, code = k, keyCode = 0) => {
        // (Enter with its text, as a real key press: the button's click comes from it)
        for (const type of ['keyDown', 'keyUp']) await browser.cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }, sid);
      };
      const shot = async (file, dark = false) => {
        if (!process.env.PHONE_SHOTS) return;
        await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sid);
        await sleep(200);
        const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
        fs.mkdirSync(process.env.PHONE_SHOTS, { recursive: true });
        fs.writeFileSync(require('path').join(process.env.PHONE_SHOTS, file), Buffer.from(data, 'base64'));
        await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sid);
      };
      // (a panel's size, as a side panel or the phone's panel window: the shots' and the layout's)
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 640, deviceScaleFactor: 2, mobile: false }, sid);
      return { ev, key, type, shot, sid };
    };
    const { phoneTab, homeWin } = await h.E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, width: 1200, height: 860 });
      await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));

    // The desktop panel: the phone button opens the menu (Switch to phone view, Sync with phone)
    await h.E((id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?window=${id}&fallback=1`), focused: false }), homeWin);
    const desk = await panelOf(`?window=${homeWin}&fallback=1`);
    await waitFor('the phone button', () => desk.ev('!document.getElementById("phone-btn").hidden'));
    assert.deepEqual(await desk.ev(`(() => { const b = document.getElementById('phone-btn'); return [b.title, b.getAttribute('aria-label'), b.getAttribute('aria-haspopup'), b.getAttribute('aria-expanded'), document.getElementById('phone-note').hidden, document.getElementById('phone-sync').hidden]; })()`),
      ['Phone view and sync with phone', 'Phone view and sync with phone', 'menu', 'false', true, true]);
    // (by keyboard: the button focused, Enter opens it on its first item, arrows move, Escape closes it back on the button)
    await desk.ev('document.getElementById("phone-btn").focus()');
    await desk.key('Enter', 'Enter', 13);
    const MENU = `(() => ({ open: !document.getElementById('phone-menu').hidden, expanded: document.getElementById('phone-btn').getAttribute('aria-expanded'), items: [...document.querySelectorAll('#phone-menu [role=menuitem]')].map((b) => b.textContent), focus: document.activeElement.id }))()`;
    assert.deepEqual(await desk.ev(MENU), { open: true, expanded: 'true', items: ['Switch to phone view', 'Sync with phone'], focus: 'phone-menu-view' });
    await desk.key('ArrowDown', 'ArrowDown', 40);
    assert.equal((await desk.ev(MENU)).focus, 'phone-menu-sync');
    await desk.key('ArrowDown', 'ArrowDown', 40);
    assert.equal((await desk.ev(MENU)).focus, 'phone-menu-view', 'around again');
    await desk.shot('menu-desktop-light.png');
    await desk.shot('menu-desktop-dark.png', true);
    await desk.key('Escape', 'Escape', 27);
    assert.deepEqual(await desk.ev(MENU), { open: false, expanded: 'false', items: ['Switch to phone view', 'Sync with phone'], focus: 'phone-btn' });
    // (a click outside closes it too)
    await desk.ev('document.getElementById("phone-btn").click()');
    assert.equal((await desk.ev(MENU)).open, true);
    await desk.ev('document.body.click()');
    assert.equal((await desk.ev(MENU)).open, false);

    // Sync with phone, no phone paired: Settings open at Connect a phone, with the code
    await desk.ev('document.getElementById("phone-btn").click(); document.getElementById("phone-menu-sync").click()');
    await waitFor('the code', () => desk.ev('!!document.querySelector("#phone-link .pl-qr") && !document.getElementById("settings").hidden'));
    assert.deepEqual(await desk.ev('window.__asked.filter((t) => t !== "phoneLink.status")'), ['phoneLink.on', 'phoneLink.pair.start']);
    await desk.shot('sync-with-phone-none-paired-light.png');
    await desk.ev('[...document.querySelectorAll("#phone-link button")].find((b) => b.textContent === "Cancel").click(); document.getElementById("settings-btn").click()');
    // Paired: Sync now, then what that sync did, under the bar with its ×
    const PHONE = { id: 'a1b2c3d4e5f60718', name: 'Tim’s iPhone', pairedAt: Date.now(), lastSeen: Date.now(), online: true, synced: null };
    const paired = { on: true, sync: true, id: 'c0ffee0123456789', name: 'Study Mac', port: 50123, phones: [PHONE], pairing: null, listen: true, here: true, listening: true, announce: null, browser: 'Firefox' };
    await desk.ev(`window.__news(${JSON.stringify(paired)}); window.__link.told = ['${PHONE.id}']; 0`);
    await desk.ev('document.getElementById("phone-btn").click(); document.getElementById("phone-menu-sync").click()');
    const LINE = `(() => { const p = document.getElementById('phone-sync'); return { shown: !p.hidden, text: document.getElementById('phone-sync-text').textContent, acts: [...p.querySelectorAll('#phone-sync-acts button')].map((b) => b.textContent), close: !document.getElementById('phone-sync-close').hidden }; })()`;
    await waitFor('asking', async () => (await desk.ev(LINE)).text === 'Asking Tim’s iPhone to sync…');
    await desk.ev(`window.__news(${JSON.stringify({ ...paired, phones: [{ ...PHONE, synced: { at: Date.now() + 1000, fromPhone: 2, toPhone: 1, waiting: 1, conflicts: [], skipped: 0 } }] })}); 0`);
    assert.deepEqual(await desk.ev(LINE), { shown: true, text: 'Synced with Tim’s iPhone: 2 from the phone, 1 to it, 1 waiting for your OK.', acts: ['Phone settings'], close: true });
    await desk.shot('sync-result-desktop-light.png');
    await desk.shot('sync-result-desktop-dark.png', true);
    await desk.ev('document.getElementById("phone-sync-close").click()');
    assert.equal((await desk.ev(LINE)).shown, false, 'closed');
    // A sync the phone started (Tim, 11-19: toasts after every switch were noise): no toast, even when it moved mods
    const TOAST = `(() => { const t = document.getElementById('toast'); return t.hidden ? null : { text: t.textContent, fixed: getComputedStyle(t).position, events: getComputedStyle(t).pointerEvents }; })()`;
    assert.equal(await desk.ev(TOAST), null);
    await desk.ev(`window.__news(${JSON.stringify({ ...paired, phones: [{ ...PHONE, synced: { at: Date.now() + 5000, fromPhone: 1, toPhone: 0, waiting: 0, conflicts: [], skipped: 0 } }] })}); 0`);
    await sleep(300);
    assert.equal(await desk.ev(TOAST), null, 'the phone\'s own sync: no toast');
    // A sync started here whose line isn't showing (the line hidden as if elsewhere): the toast, and a click closes it
    await desk.ev('document.getElementById("phone-btn").click(); document.getElementById("phone-menu-sync").click()');
    await waitFor('the line again', async () => (await desk.ev(LINE)).shown && (await desk.ev('window.__asked.filter((t) => t === "phoneLink.syncNow").length')) === 2);
    await sleep(200);
    await desk.ev('document.getElementById("phone-sync").hidden = true; 0');
    await desk.ev(`window.__news(${JSON.stringify({ ...paired, phones: [{ ...PHONE, synced: { at: Date.now() + 9000, fromPhone: 1, toPhone: 0, waiting: 0, conflicts: [], skipped: 0 } }] })}); 0`);
    assert.deepEqual(await desk.ev(TOAST), { text: 'Synced with Tim’s iPhone · 1 from the phone, 0 to it', fixed: 'fixed', events: 'auto' });
    await desk.shot('synced-toast-light.png');
    await desk.shot('synced-toast-dark.png', true);
    await desk.ev('document.getElementById("toast").click(); 0');
    assert.equal(await desk.ev(TOAST), null, 'a click closes it at once');
    await desk.ev('document.getElementById("phone-sync-close").click(); 0');

    // Switch to phone view, from the menu: the phone's own panel window
    await desk.ev('document.getElementById("phone-btn").click(); document.getElementById("phone-menu-view").click()');
    const opened = await waitFor('the phone window', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((s) => s.phone && s.page?.marked && s));
    await waitFor('the phone page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    const phone = await panelOf(`?window=${opened.window}&fallback=1`);
    await waitFor('the phone banner', () => phone.ev('!document.getElementById("phone-note").hidden'));
    // (the phone line, none paired: Connect a phone, no text)
    await waitFor('the phone line', async () => (await phone.ev(LINE)).shown);
    assert.deepEqual(await phone.ev(LINE), { shown: true, text: '', acts: ['Connect a phone'], close: false });
    // (the navigation bar: the phone tab's address)
    const NAV = `(() => ({ url: document.getElementById('phone-nav-url').value, buttons: [...document.querySelectorAll('#phone-nav button')].map((b) => b.getAttribute('aria-label')) }))()`;
    await waitFor('the address', async () => (await phone.ev(NAV)).url === pages.url('/detect'));
    assert.deepEqual((await phone.ev(NAV)).buttons, ['Back', 'Forward', 'Reload']);
    await phone.shot('phone-view-nav-none-paired-light.png');
    await phone.shot('phone-view-nav-none-paired-dark.png', true);
    // (Connect a phone from the banner: the code)
    await phone.ev('document.querySelector("#phone-sync .phone-sync-connect").click()');
    await waitFor('the code in the phone panel', () => phone.ev('!!document.querySelector("#phone-link .pl-qr")'));
    await phone.shot('phone-view-connect-code-light.png');
    await phone.ev('[...document.querySelectorAll("#phone-link button")].find((b) => b.textContent === "Cancel").click(); document.getElementById("settings-btn").click()');
    // (paired: Syncing with {phone}, Sync now, and how it went)
    await phone.ev(`window.__news(${JSON.stringify(paired)}); window.__link.told = ['${PHONE.id}']; 0`);
    assert.deepEqual(await phone.ev(LINE), { shown: true, text: 'Syncing with Tim’s iPhone.', acts: ['Sync now'], close: false });
    await phone.shot('phone-view-syncing-light.png');
    await phone.shot('phone-view-syncing-dark.png', true);
    await phone.ev('document.querySelector("#phone-sync .phone-sync-syncNow").click()');
    await waitFor('asking', async () => (await phone.ev(LINE)).text === 'Asking Tim’s iPhone to sync…');
    await phone.ev(`window.__news(${JSON.stringify({ ...paired, phones: [{ ...PHONE, synced: { at: Date.now() + 1000, fromPhone: 0, toPhone: 3, waiting: 0, conflicts: [], skipped: 0 } }] })}); 0`);
    assert.deepEqual(await phone.ev(LINE), { shown: true, text: 'Synced with Tim’s iPhone: 0 from the phone, 3 to it.', acts: ['Phone settings'], close: false });
    await phone.shot('phone-view-synced-light.png');
    // (the menu in the phone view: Back to desktop first)
    await phone.ev('document.getElementById("phone-btn").click()');
    assert.deepEqual((await phone.ev(MENU)).items, ['Back to desktop', 'Sync with phone']);
    await phone.shot('menu-phone-view-light.png');
    await phone.shot('menu-phone-view-dark.png', true);
    await phone.key('Escape', 'Escape', 27);

    // The navigation bar drives the phone tab: an address, back, forward, reload; the page stays the phone's size
    const at = () => h.E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' ? t.url : null), phoneTab);
    // (a press on the page first, as a person's: Chrome's back skips a page nobody touched, "Cannot find a next page
    // in history", as its own back button does)
    await h.click(phoneTab, 'body');
    // (typed, as Tim did 11-18: a click in the field, the address, Enter)
    assert.equal(await phone.ev('document.getElementById("phone-nav").hidden'), false, 'the popup route has the bar');
    await phone.type('#phone-nav-url', `127.0.0.1:${pages.port}/second`);
    await waitFor('the typed address', async () => (await at()) === pages.url('/second'));
    await waitFor('the field follows', async () => (await phone.ev(NAV)).url === pages.url('/second'));
    await waitFor('the second page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    await h.click(phoneTab, 'body');
    await phone.ev('document.getElementById("phone-nav-back").click()');
    await waitFor('back', async () => (await at()) === pages.url('/detect'));
    await phone.ev('document.getElementById("phone-nav-forward").click()');
    await waitFor('forward', async () => (await at()) === pages.url('/second'));
    const loads = () => pages.requests.filter((r) => r.path === '/second').length;
    const before = loads();
    await phone.ev('document.getElementById("phone-nav-reload").click()');
    await waitFor('reload', async () => loads() > before && (await at()) === pages.url('/second'));
    await waitFor('the phone page again', () => h.page(phoneTab, 'document.readyState === "complete" && window.__seen && window.__seen.uaPhone'));
    assert.equal(await h.page(phoneTab, 'innerWidth'), 402, 'the page keeps the phone\'s width: the bar is in the panel');
    // (a search, typed: Google's results page for it, Safari's default on an iPhone; never reached here)
    const anyUrl = () => h.E((id) => chrome.tabs.get(id).then((t) => t.pendingUrl || t.url), phoneTab);
    await phone.type('#phone-nav-url', 'cat videos');
    await waitFor('the search', async () => (await anyUrl()) === 'https://www.google.com/search?q=cat%20videos');
    await h.E(([id, url]) => chrome.tabs.update(id, { url }), [phoneTab, pages.url('/second')]);
    await waitFor('back on the page', async () => (await at()) === pages.url('/second'));
    // (not a phone tab: refused)
    const other = await h.E((id) => chrome.tabs.create({ windowId: id, url: 'about:blank', active: false }).then((t) => t.id), homeWin);
    await assert.rejects(h.ask({ type: 'phone.nav', tabId: other, go: 'back' }), /isn't in the phone view/);
    await assert.rejects(h.ask({ type: 'phone.nav', tabId: phoneTab, go: 'url', url: '   ' }), /nothing to go to/);
    // (Back to desktop from the menu)
    await phone.ev('document.getElementById("phone-btn").click(); document.getElementById("phone-menu-view").click()');
    await waitFor('back to desktop', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((s) => !s.phone));
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});
