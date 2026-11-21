'use strict';
// The phone view's window and TRIF's side panel in it, in a real browser (split from tests/phone-browser.test.js,
// whose first comment says what the test pages and the harness are): the window route as a person uses it (the
// toolbar's side panel, the 📱 menu, Back to desktop; the hint without a gesture), a window with only the phone's
// tab made the phone's, and a side panel's first paint in the phone window. Headless Chrome for Testing
// (tests/cdp-page.js: one browser at a time, the memory guard), with TRIF_BROWSER_TESTS=1 or in CI; skipped
// otherwise. PHONE_SHOTS=<dir> also saves screenshots there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { browserTestsSkip, launch } = require('./cdp-page');
const { servePhonePages, extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The window route as a person uses it (11-18): TRIF's side panel opened from the toolbar, its 📱 menu's Switch to
// phone view clicked (trusted clicks: the click's gesture is what lets this panel open the side panel in the new
// window), the phone's side panel beside the page with the banner and without the stand-in navigation bar, the
// page's width said when the browser keeps it wider than 390; Back to desktop from the phone's own side panel. Then
// without the gesture (a script's click): the window opens at phone width, the desktop panel says to click TRIF's
// button there, and that click (the toolbar's) opens TRIF beside the phone and ends the hint.
// PHONE_SHOTS=<dir> saves the screenshots: the phone page and the panel beside it, and one picture of both.
test('the phone view\'s window from the side panel\'s menu: the side panel beside the phone, Back to desktop; the hint without a gesture', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.allowUserScripts().catch(() => {});
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const { phoneTab, homeWin } = await h.E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, width: 1200, height: 860 });
      await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));
    const panels = async () => (await browser.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page' && x.url.endsWith('/sidepanel.html')).map((x) => x.targetId);
    const known = new Set(await panels());
    const attach = async (targetId) => {
      const sid = await browser._attach(targetId);
      const ev = async (expr, gesture = false) => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: gesture }, sid);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      const click = async (selector) => {
        const [x, y] = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
      };
      const shot = async (file) => {
        const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
        if (process.env.PHONE_SHOTS) { fs.mkdirSync(process.env.PHONE_SHOTS, { recursive: true }); fs.writeFileSync(require('path').join(process.env.PHONE_SHOTS, file), Buffer.from(data, 'base64')); }
        return data;
      };
      return { sid, ev, click, shot };
    };
    // a side panel that came since `seen` (the toolbar's, or the one the menu opened in the phone window)
    const newPanel = async (what) => {
      const id = await waitFor(what, async () => (await panels()).find((t) => !known.has(t)));
      known.add(id);
      const p = await attach(id);
      await waitFor(`${what} loaded`, () => p.ev('document.readyState === "complete" && !document.getElementById("phone-btn").hidden'));
      return { ...p, targetId: id };
    };
    const toolbar = async (url) => {
      const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      const t = targetInfos.find((x) => x.type === 'tab' && x.url === url);
      await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: t.targetId });
    };
    await toolbar(pages.url('/detect'));
    const desk = await newPanel('the side panel');
    // Switch to phone view: two trusted clicks (the 📱 button, the menu's item)
    await desk.click('#phone-btn');
    await waitFor('the menu', () => desk.ev('!document.getElementById("phone-menu").hidden'));
    await desk.click('#phone-menu-view');
    const st = await waitFor('the phone view, its side panel there', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((x) => x.phone && x.panel && x.width && x.page?.marked && x), 30000);
    assert.equal(st.route, 'window');
    const phone = await newPanel('the phone window\'s side panel');
    assert.equal(await h.E((id) => chrome.tabs.get(id).then((t) => t.windowId), phoneTab), st.window);
    await waitFor('the page at its width', async () => (await h.page(phoneTab, 'innerWidth')) === st.width);
    const BANNER = `(() => ({ banner: !document.getElementById('phone-note').hidden, nav: !document.getElementById('phone-nav').hidden, width: document.getElementById('phone-width').hidden ? null : document.getElementById('phone-width').textContent, text: document.getElementById('phone-note-text').textContent }))()`;
    const b = await waitFor('the banner, with the page\'s width when it isn\'t the phone\'s', async () => { const x = await phone.ev(BANNER); return x.banner && (st.width <= 392 || x.width) && x; });
    assert.equal(b.nav, false, 'no stand-in navigation bar: the window has the browser\'s address bar');
    assert.match(b.text, /^Phone view: 127\.0\.0\.1 sees an iPhone\./);
    if (st.width > 392) assert.equal(b.width, `This page is ${st.width} px wide, wider than an iPhone’s 390: the browser won’t make this window narrower.`);
    else assert.equal(b.width, null);
    assert.equal(await desk.ev('document.getElementById("phone-hint").hidden'), true, 'the side panel opened there: no hint');
    // the screenshots: the phone's page, the side panel beside it, and the two side by side (headless draws no
    // browser toolbar: the address bar above them isn't in the picture)
    await h.page(phoneTab, 'document.readyState === "complete"');
    await sleep(600);
    const { data: pagePng } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, (await h.target(phoneTab)).sid);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 386, height: 750, deviceScaleFactor: 1, mobile: false }, phone.sid);
    await sleep(300);
    const panelPng = await phone.shot('window-route-panel.png');
    if (process.env.PHONE_SHOTS) {
      fs.writeFileSync(require('path').join(process.env.PHONE_SHOTS, 'window-route-page.png'), Buffer.from(pagePng, 'base64'));
      const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank' });
      const bs = await browser._attach(targetId);
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: st.width + 386 + 1, height: 750, deviceScaleFactor: 1, mobile: false }, bs);
      const { frameTree } = await browser.cdp.send('Page.getFrameTree', {}, bs);
      await browser.cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<body style="margin:0;display:flex;align-items:flex-start;gap:1px;background:#999"><img style="width:${st.width}px" src="data:image/png;base64,${pagePng}"><img style="width:386px" src="data:image/png;base64,${panelPng}"></body>` }, bs);
      await sleep(600);
      const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, bs);
      fs.writeFileSync(require('path').join(process.env.PHONE_SHOTS, 'window-route.png'), Buffer.from(data, 'base64'));
      await browser.cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await browser.cdp.send('Emulation.clearDeviceMetricsOverride', {}, phone.sid);
    // Back to desktop, from the phone's side panel (Tim, 11-20: "can we instead expand back out and keep the
    // sidebar?"): the phone window expanded back out to the user's window's size, the tab in it, and the same side
    // panel still open there, now the desktop view's
    const homeSize = await h.E((id) => chrome.windows.get(id).then((w) => [w.left, w.top, w.width, w.height]), homeWin);
    await phone.click('#phone-btn');
    await waitFor('the phone menu', () => phone.ev('!document.getElementById("phone-menu").hidden'));
    assert.equal(await phone.ev('document.getElementById("phone-menu-view").textContent'), 'Back to desktop');
    await phone.click('#phone-menu-view');
    await waitFor('back to desktop', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((x) => !x.phone));
    assert.equal(await h.E((id) => chrome.tabs.get(id).then((t) => t.windowId), phoneTab), st.window, 'the tab still in its window');
    await waitFor('expanded back out', async () => JSON.stringify(await h.E((id) => chrome.windows.get(id).then((w) => [w.left, w.top, w.width, w.height]), st.window)) === JSON.stringify(homeSize));
    await sleep(1500);
    assert.deepEqual(await h.E((id) => chrome.windows.get(id).then((w) => [w.left, w.top, w.width, w.height]), st.window), homeSize, 'and stays so (no fitting of the phone window after it)');
    assert.ok((await panels()).includes(phone.targetId), 'the same side panel, still open');
    await waitFor('the side panel the desktop view\'s', () => phone.ev('!document.body.classList.contains("phone-view") && document.getElementById("phone-note").hidden && document.getElementById("phone-btn").dataset.on === "false"'));
    await waitFor('a desktop page beside it', async () => (await h.page(phoneTab, 'document.readyState === "complete" && window.__seen && !window.__seen.uaPhone && innerWidth')) > 600)
      .catch(async (e) => { console.error('DEBUG', JSON.stringify(await h.page(phoneTab, 'JSON.stringify({ r: document.readyState, s: window.__seen, w: innerWidth })').catch((x) => x.message)), JSON.stringify(await h.E((id) => chrome.windows.get(id), st.window))); throw e; });
    // (the tab home again, for what follows: the window it leaves, with no tab, closes)
    await h.E(([tab, win]) => chrome.tabs.move(tab, { windowId: win, index: 0 }), [phoneTab, homeWin]);
    await waitFor('the phone window gone', () => h.E((id) => chrome.windows.get(id).then(() => false, () => true), st.window));

    // Without the click's gesture (a script's click): the window opens, the desktop panel says to click TRIF's button there
    await h.E(([tab, win]) => chrome.tabs.update(tab, { active: true }).then(() => chrome.windows.update(win, { focused: true })), [phoneTab, homeWin]);
    await waitFor('the desktop panel on the page again', () => desk.ev('!document.getElementById("phone-btn").hidden && document.getElementById("phone-btn").dataset.on === "false"'));
    await sleep(6000); // (the earlier clicks' activation over: about five seconds in Chrome)
    await desk.ev('document.getElementById("phone-btn").click(), document.getElementById("phone-menu-view").click(), 0');
    const hint = await waitFor('the hint', () => desk.ev('!document.getElementById("phone-hint").hidden && document.getElementById("phone-hint-text").textContent'), 30000)
      .catch(async (e) => { console.error('DEBUG', JSON.stringify(await h.ask({ type: 'phone.state', tabId: phoneTab })), await desk.ev('JSON.stringify({ on: document.getElementById("phone-btn").dataset.on, dis: document.getElementById("phone-btn").disabled })')); throw e; });
    assert.equal(hint, 'The phone view is in a window of its own. Click TRIF’s button there to open TRIF beside the phone.');
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 640, deviceScaleFactor: 2, mobile: false }, desk.sid);
    await desk.shot('window-route-hint.png');
    await browser.cdp.send('Emulation.clearDeviceMetricsOverride', {}, desk.sid);
    const st2 = await h.ask({ type: 'phone.state', tabId: phoneTab });
    assert.deepEqual([st2.route, st2.panel], ['window', false]);
    console.log(`# without the side panel: a ${st2.width} px page`);
    // the toolbar button in the phone window: TRIF's side panel there, the page refitted, the hint gone
    await toolbar(pages.url('/detect'));
    await newPanel('the side panel from the phone window\'s toolbar');
    await waitFor('the hint gone', () => desk.ev('document.getElementById("phone-hint").hidden'), 15000);
    await waitFor('the phone\'s width with the panel', async () => { const x = await h.ask({ type: 'phone.state', tabId: phoneTab }); return x.panel && x.width === st.width; }, 15000);
    await h.ask({ type: 'phone.close', tabId: phoneTab });
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});

// Switching to the phone view, as Tim did 11-19 (real Chrome, google.com): "it resizes the window but doesn't
// reopen the panel. then when you open the panel it stays on desktop site for like a second before suddenly
// switching". Two causes: (1) the tab alone in its window: moving it into a window of its own closed its old
// window, and the side panel in it that was to open TRIF's side panel in the new one (now that window itself is
// made the phone's, its side panel staying open); (2) a panel drew its site before it knew the tab was in the
// phone view (the background's answer looked into the page first, slow while the page is busy), so its first
// paint was the desktop view (now the quick answer comes first, sidepanel.js setTab).
// What a panel shows, frame by frame: its title (the site) and whether it's in the phone view, each change once.
const PANEL_FRAMES = `(() => { if (window.__frames) return; window.__frames = []; const look = () => { const s = document.getElementById('site'); if (!s || !document.body) return; const f = { t: Math.round(performance.now()), site: s.textContent, phone: document.body.classList.contains('phone-view'), note: !document.getElementById('phone-note').hidden }; const l = window.__frames.at(-1); if (!l || l.site !== f.site || l.phone !== f.phone || l.note !== f.note) window.__frames.push(f); }; const tick = () => { look(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`;
const panelHelpers = (browser) => {
  const panels = async () => (await browser.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page' && x.url.endsWith('/sidepanel.html')).map((x) => x.targetId);
  const attach = async (targetId, sid) => {
    sid = sid || await browser._attach(targetId);
    const ev = async (expr) => {
      const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const click = async (selector) => {
      const [x, y] = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
    };
    return { targetId, sid, ev, click, frames: () => ev('window.__frames') };
  };
  const toolbar = async (url) => {
    const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const t = targetInfos.find((x) => x.type === 'tab' && x.url === url);
    await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: t.targetId });
  };
  // The next side panel to open, its frames recorded from its first paint: it starts paused (CDP's
  // waitForDebuggerOnStart) until the recorder is in, before any of its own scripts.
  const nextPanel = async (open) => {
    let on = true;
    const got = new Promise((resolve) => {
      browser.cdp.on(async (m) => {
        if (!on || m.method !== 'Target.attachedToTarget' || !m.params.waitingForDebugger) return;
        const { sessionId } = m.params;
        let page = false;
        try {
          await browser.cdp.send('Page.enable', {}, sessionId);
          await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PANEL_FRAMES }, sessionId);
          page = true;
        } catch { /* not a page */ }
        await browser.cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
        if (page) resolve({ targetId: m.params.targetInfo.targetId, sessionId });
      });
    });
    await browser.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    try {
      await open();
      const { targetId, sessionId } = await Promise.race([got, sleep(15000).then(() => { throw new Error('no side panel opened'); })]);
      await waitFor('the recorded panel loaded', async () => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: 'location.href.endsWith("/sidepanel.html") && document.readyState === "complete" && !!window.__frames', returnByValue: true }, sessionId);
        return r.result?.value === true;
      });
      // (a session of its own: turning auto-attach off, below, ends the one it came with)
      on = false;
      await browser.cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      const sid = await browser._attach(targetId);
      return attach(targetId, sid);
    } finally {
      on = false;
      await browser.cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    }
  };
  return { panels, attach, toolbar, nextPanel };
};
// (a site's frames: from the first with its name in the title; `flips`: how often the view changed after that)
const siteFrames = (frames, site) => {
  const f = (frames || []).filter((x) => x.site === site);
  return { first: f[0], flips: f.slice(1).filter((x, i) => x.phone !== f[i].phone).length, all: f };
};

test('the phone view from a window with only that tab: the window becomes the phone\'s, its side panel stays open in the phone view; Back to desktop gives the window back', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.allowUserScripts().catch(() => {});
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const P = panelHelpers(browser);
    const { phoneTab, homeWin } = await h.E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, left: 40, top: 60, width: 1200, height: 860 });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));
    const before = await h.E((id) => chrome.windows.get(id).then((w) => ({ left: w.left, top: w.top, width: w.width, height: w.height })), homeWin);
    const desk = await P.nextPanel(() => P.toolbar(pages.url('/detect')));
    await waitFor('the panel on the page', () => desk.ev('!document.getElementById("phone-btn").hidden'));
    const firstDesk = siteFrames(await desk.frames(), '127.0.0.1');
    assert.equal(firstDesk.first.phone, false, 'a desktop tab: the desktop view');
    // Switch to phone view: the 📱 button and the menu's item, trusted clicks
    await desk.click('#phone-btn');
    await waitFor('the menu', () => desk.ev('!document.getElementById("phone-menu").hidden'));
    await desk.ev('window.__frames.length = 0');
    await desk.click('#phone-menu-view');
    const st = await waitFor('the phone view, TRIF\'s side panel beside it', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((x) => x.phone && x.panel && x.width && x.page?.marked && x), 30000)
      .catch(async (e) => { console.error('DEBUG', JSON.stringify(await h.ask({ type: 'phone.state', tabId: phoneTab })), JSON.stringify(await P.panels())); throw e; });
    assert.equal(st.window, homeWin, 'its own window, made the phone\'s: no new window');
    assert.equal(await h.E((id) => chrome.tabs.get(id).then((t) => t.windowId), phoneTab), homeWin);
    assert.ok((await P.panels()).includes(desk.targetId), 'the same side panel, still open');
    await waitFor('the panel in the phone view', () => desk.ev('document.body.classList.contains("phone-view") && !document.getElementById("phone-note").hidden'));
    await waitFor('the page at the phone\'s width', async () => (await h.page(phoneTab, 'innerWidth')) === st.width);
    assert.ok(st.width < 500, `a phone's width: ${st.width}`);
    const win = await h.E((id) => chrome.windows.get(id), homeWin);
    assert.ok(win.width < before.width, `the window narrower: ${win.width}`);
    assert.equal(win.left, before.left, 'where it was');
    let f = siteFrames(await desk.frames(), '127.0.0.1');
    assert.equal(f.flips, 1, `desktop to phone once, never back: ${JSON.stringify(f.all)}`);
    assert.equal(f.all.at(-1).phone, true);
    assert.equal(await desk.ev('document.getElementById("phone-hint").hidden'), true, 'no hint: TRIF is beside the phone');
    // Back to desktop: the window its size again, where it was; the panel the desktop's, once
    await desk.ev('window.__frames.length = 0');
    await desk.click('#phone-btn');
    await waitFor('the phone menu', () => desk.ev('!document.getElementById("phone-menu").hidden'));
    assert.equal(await desk.ev('document.getElementById("phone-menu-view").textContent'), 'Back to desktop');
    await desk.click('#phone-menu-view');
    await waitFor('back to desktop', () => h.ask({ type: 'phone.state', tabId: phoneTab }).then((x) => !x.phone));
    await waitFor('the window as it was', async () => { const w = await h.E((id) => chrome.windows.get(id).then((x) => ({ left: x.left, top: x.top, width: x.width, height: x.height })), homeWin); return JSON.stringify(w) === JSON.stringify(before); });
    await waitFor('the desktop page', () => h.page(phoneTab, 'window.__seen && document.readyState === "complete" && !window.__seen.uaPhone'));
    await waitFor('the panel the desktop\'s', () => desk.ev('!document.body.classList.contains("phone-view")'));
    await sleep(1500);
    assert.deepEqual(await h.E((id) => chrome.windows.get(id).then((x) => ({ left: x.left, top: x.top, width: x.width, height: x.height })), homeWin), before, 'and stays so');
    assert.ok((await P.panels()).includes(desk.targetId), 'the same side panel, still open');
    f = siteFrames(await desk.frames(), '127.0.0.1');
    assert.equal(f.flips, 1, `phone to desktop once, never back: ${JSON.stringify(f.all)}`);
    assert.equal(f.all.at(-1).phone, false);
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});

test('a side panel opened in the phone window (TRIF\'s button there, while its page is busy): its first paint is the phone view', { skip, timeout: 900000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}'] });
  try {
    const h = await harness(browser);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const P = panelHelpers(browser);
    const { phoneTab, homeWin } = await h.E(async (url) => {
      const w = await chrome.windows.create({ url, focused: true, width: 1200, height: 860 });
      await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, pages.url('/detect'));
    // the phone view without TRIF's side panel in its window (no click's gesture: the hint's case)
    const opened = await h.openPhone(phoneTab, { left: 0, top: 25, width: 1470, height: 931 }, { panel: false });
    assert.notEqual(opened.window, homeWin);
    await waitFor('the phone page', () => h.page(phoneTab, 'window.__seen && window.__seen.uaPhone && document.readyState === "complete"'));
    // the page busy for a while (as a heavy site's is as it loads): a look into it waits for that
    const busy = () => h.E((id) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: () => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 2500); }, 50); } }), phoneTab);
    await busy();
    const phone = await P.nextPanel(() => P.toolbar(pages.url('/detect')));
    await waitFor('the panel drew the site', async () => siteFrames(await phone.frames(), '127.0.0.1').first);
    await sleep(3500);
    const f = siteFrames(await phone.frames(), '127.0.0.1');
    assert.equal(f.first.phone, true, `the first paint with the site is the phone view: ${JSON.stringify(f.all)}`);
    assert.equal(f.first.note, true, 'with its line');
    assert.equal(f.flips, 0, `and stays so: ${JSON.stringify(f.all)}`);
    // the reverse: Back to desktop (the window expands back out, its side panel staying: the desktop view, once),
    // then TRIF's panel opened on the tab, home again, while its page is busy: the desktop view from the start
    await phone.ev('window.__frames.length = 0');
    await h.ask({ type: 'phone.close', tabId: phoneTab });
    assert.equal(await h.E((id) => chrome.tabs.get(id).then((t) => t.windowId), phoneTab), opened.window);
    await waitFor('the desktop page', () => h.page(phoneTab, 'window.__seen && document.readyState === "complete" && !window.__seen.uaPhone'));
    await sleep(1500);
    const back = siteFrames(await phone.frames(), '127.0.0.1');
    assert.deepEqual([back.all.at(-1)?.phone, back.flips], [false, 1], `the phone window's side panel, the desktop view's: ${JSON.stringify(back.all)}`);
    await h.E(([tab, win]) => chrome.tabs.move(tab, { windowId: win, index: 0 }), [phoneTab, homeWin]);
    await h.E(([tab, win]) => chrome.tabs.update(tab, { active: true }).then(() => chrome.windows.update(win, { focused: true })), [phoneTab, homeWin]);
    await busy();
    const desk = await P.nextPanel(() => P.toolbar(pages.url('/detect')));
    await waitFor('the desktop panel drew the site', async () => siteFrames(await desk.frames(), '127.0.0.1').first);
    await sleep(3000);
    const d = siteFrames(await desk.frames(), '127.0.0.1');
    assert.equal(d.first.phone, false, `the desktop view: ${JSON.stringify(d.all)}`);
    assert.equal(d.flips, 0, JSON.stringify(d.all));
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});
