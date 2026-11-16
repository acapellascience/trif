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
    assert.deepEqual(await ask({ type: 'phone.state', tabId: phoneTab }), { phone: true, device: 'iPhone', window: opened.window });
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
