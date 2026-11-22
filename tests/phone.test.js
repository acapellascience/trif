'use strict';
// The phone view's parts that need no browser (extension/phone.js, phone-page.js; docs/MOBILE-EDIT.md): its
// rules, its window's bounds and fit, the page script's profile matching phone.js's, resolveTab finding the
// phone's tab, tab locks leaving its rules alone, what the agent is told, and the @device header. The real
// thing in a browser: tests/phone-browser.test.js, phone-window-browser.test.js, phone-helper-browser.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.join(__dirname, '..', 'extension');
const load = (f) => import(pathToFileURL(path.join(EXT, f)).href);

test('phoneRules: an iPhone user agent and no client hints on every request of that tab, the marker on its documents', async () => {
  const { phoneRules, PHONE, CLIENT_HINTS, ALL_TYPES, MARK } = await load('phone.js');
  const [req, res] = phoneRules(42, [1000000, 1000001]);
  assert.deepEqual(req.condition, { tabIds: [42], resourceTypes: ALL_TYPES });
  assert.ok(req.condition.resourceTypes.includes('main_frame'), 'the page itself (a rule without resourceTypes skips it)');
  assert.deepEqual(req.action.requestHeaders[0], { header: 'user-agent', operation: 'set', value: PHONE.ua });
  assert.deepEqual(req.action.requestHeaders.slice(1).map((h) => [h.header, h.operation]), CLIENT_HINTS.map((h) => [h, 'remove']));
  assert.deepEqual(res.condition, { tabIds: [42], resourceTypes: ['main_frame', 'sub_frame'] });
  assert.deepEqual(res.action.responseHeaders, [{ header: 'server-timing', operation: 'append', value: MARK }]);
  const ff = phoneRules(1, [1, 2], { types: ALL_TYPES.filter((t) => t !== 'webbundle') });
  assert.ok(!ff[0].condition.resourceTypes.includes('webbundle'));
});

test('phoneBounds: the phone\'s page area when the screen has room, shorter when it hasn\'t, beside nothing off screen', async () => {
  const { phoneBounds, PHONE } = await load('phone.js');
  const frame = { width: 0, height: 62 };
  const big = { left: 0, top: 25, width: 2560, height: 1415 };
  assert.deepEqual(phoneBounds({ frame, screen: big, home: { left: 100, top: 60 } }), { width: 402, height: 780 + 62, left: 100, top: 25 });
  // a 13" MacBook Air with the Dock: 1470 x 956, 30 for the menu bar, 70 for the Dock
  const air = { left: 0, top: 30, width: 1470, height: 856 };
  assert.deepEqual(phoneBounds({ frame, screen: air, home: { left: 0, top: 30 } }), { width: 402, height: 842, left: 0, top: 30 });
  const short = { left: 0, top: 30, width: 1280, height: 640 };
  assert.equal(phoneBounds({ frame, screen: short }).height, 640, 'as tall as fits');
  const tiny = { left: 0, top: 30, width: 1280, height: 400 };
  assert.equal(phoneBounds({ frame, screen: tiny }).height, PHONE.minHeight + 62, 'never under the minimum');
  // the user's window far right: the phone stays on the screen
  assert.equal(phoneBounds({ frame, screen: air, home: { left: 1400, top: 30 } }).left, 1470 - 402);
  // no screen known: the user's window's corner, or nothing
  assert.deepEqual(phoneBounds({ frame, home: { left: 5, top: 6 } }), { width: 402, height: 842, left: 5, top: 6 });
  assert.deepEqual(phoneBounds({}), { width: 402, height: 780 });
});

// A browser for fitPhoneWindow: a window whose page is the window less its frame, except that after the tab
// moves in, and after each resize, the page still says its old size for `lag` looks (CI, a busy runner: the
// window sized from one such look left a 776 x 813 page).
function fakeWindow({ frame, win, stale, lag, refuse = false, minWidth = 0, x = null, sidePanel = null }) {
  const w = { ...win };
  let page = { ...stale };
  let since = 0;
  const updates = [];
  const chrome = {
    windows: {
      get: async () => ({ ...w }),
      update: async (id, b) => { updates.push(b); if (refuse) return { ...w }; Object.assign(w, b); if (w.width < minWidth) w.width = minWidth; since = 0; return { ...w }; },
    },
    scripting: {
      executeScript: async () => {
        if (since++ >= lag) page = { w: w.width - frame.width, h: w.height - frame.height };
        return [{ result: x == null ? { ...page } : { ...page, x } }];
      },
    },
    ...(sidePanel ? { sidePanel } : {}),
  };
  return { chrome, w, updates };
}

test('fitPhoneWindow: the page area is the phone\'s, also when the page still says its old window\'s size for a while', async () => {
  const { fitPhoneWindow } = await load('phone.js');
  const screen = { left: 0, top: 25, width: 1470, height: 931 };
  const frame = { width: 0, height: 84 };
  const win = { left: 0, top: 25, width: 1280, height: 720 };
  for (const lag of [0, 1, 3, 6]) {
    const b = fakeWindow({ frame, win, stale: { w: 894, h: 657 }, lag });
    const size = await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, screen, pause: 1 });
    assert.deepEqual(size, { w: 402, h: 780 }, `lag ${lag}`);
    assert.deepEqual([b.w.width, b.w.height], [402, 864], `lag ${lag}: the window`);
    if (lag === 0) assert.equal(b.updates.length, 1, 'one resize when the page has the window\'s size right away');
  }
  // a window the browser won't resize: no endless asking, the page as it is
  const b = fakeWindow({ frame, win, stale: { w: 1280, h: 636 }, lag: 0, refuse: true });
  assert.deepEqual(await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, screen, pause: 1 }), { w: 1280, h: 636 });
  assert.equal(b.updates.length, 1);
  // a page that can't be measured yet (the tab still moving)
  const none = { windows: { get: async () => win }, scripting: { executeScript: async () => { throw new Error('moving'); } } };
  assert.equal(await fitPhoneWindow({ chrome: none, tabId: 1, windowId: 2, screen, pause: 1 }), null);
});

// The window route (11-18): an ordinary window with TRIF's side panel beside the page. Its "frame" is the panel
// and the toolbar: measured the same way, so the page comes out at the phone's width whatever the panel's width. Corrected
// later (the panel or the window resized) in width alone, where the window is; as narrow as the browser lets it.
// Tim, 11-22: dragging the panel's edge toward the page and then seeing the window grow out the other side, the
// panel shooting off, felt wrong. With the panel on the page's right the window's right edge stays put and it grows
// or shrinks on the page's side; with it on the left (Chrome's setting, Firefox's sidebar), the left edge.
test('fitPhoneWindow widthOnly: the window grows on the page\'s side, the panel staying where it was dragged', async () => {
  const { fitPhoneWindow } = await load('phone.js');
  const moved = { left: 300, top: 80, width: 776, height: 700 };
  const fit = (b) => fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, pause: 1, widthOnly: true });
  // Chrome, panel on the right (no getLayout: Chrome's default side): the left edge moves out by the 76 px
  let b = fakeWindow({ frame: { width: 450, height: 87 }, win: moved, stale: { w: 326, h: 613 }, lag: 0, sidePanel: {} });
  assert.deepEqual(await fit(b), { w: 402, h: 613 });
  assert.deepEqual(b.updates, [{ width: 852, left: 224 }]);
  assert.equal(b.w.left + b.w.width, 300 + 776, 'the right edge, the panel\'s, where it was');
  // ... and in when the panel is made narrower
  b = fakeWindow({ frame: { width: 336, height: 87 }, win: moved, stale: { w: 440, h: 613 }, lag: 0, sidePanel: { getLayout: async () => ({ side: 'right' }) } });
  assert.deepEqual(await fit(b), { w: 402, h: 613 });
  assert.deepEqual([b.w.left, b.w.width], [338, 738]);
  // Chrome's side panel moved to the left in its settings: the left edge stays, as before
  b = fakeWindow({ frame: { width: 450, height: 87 }, win: moved, stale: { w: 326, h: 613 }, lag: 0, sidePanel: { getLayout: async () => ({ side: 'left' }) } });
  await fit(b);
  assert.deepEqual(b.updates, [{ width: 852 }]);
  // Firefox (no sidePanel): the side from where the page starts in its window
  b = fakeWindow({ frame: { width: 450, height: 87 }, win: moved, stale: { w: 326, h: 613 }, lag: 0, x: 0 });
  await fit(b);
  assert.deepEqual(b.updates, [{ width: 852, left: 224 }], 'sidebar on the right');
  b = fakeWindow({ frame: { width: 450, height: 87 }, win: moved, stale: { w: 326, h: 613 }, lag: 0, x: 450 });
  await fit(b);
  assert.deepEqual(b.updates, [{ width: 852 }], 'sidebar on the left');
  // Chrome's minimum (792 with its side panel): a narrower width it won't take mustn't move the window either
  b = fakeWindow({ frame: { width: 386, height: 87 }, win: { left: 100, top: 25, width: 792, height: 837 }, stale: { w: 406, h: 750 }, lag: 0, minWidth: 792, sidePanel: {} });
  assert.deepEqual(await fit(b), { w: 406, h: 750 });
  assert.deepEqual([b.w.left, b.w.width], [100, 792]);
});

test('fitPhoneWindow in an ordinary window: the side panel measured as part of the frame; widthOnly; the browser\'s minimum', async () => {
  const { fitPhoneWindow } = await load('phone.js');
  const screen = { left: 0, top: 25, width: 1470, height: 931 };
  const panel = { width: 386, height: 87 };
  let b = fakeWindow({ frame: panel, win: { left: 0, top: 25, width: 1280, height: 720 }, stale: { w: 894, h: 633 }, lag: 1 });
  assert.deepEqual(await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, screen, pause: 1 }), { w: 402, h: 780 });
  assert.deepEqual([b.w.width, b.w.height], [788, 867]);
  // (the person dragged the panel wider: the page is narrower; the window moved and made taller is left so)
  const moved = { left: 300, top: 80, width: 776, height: 700 };
  b = fakeWindow({ frame: { width: 450, height: 87 }, win: moved, stale: { w: 326, h: 613 }, lag: 0 });
  assert.deepEqual(await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, pause: 1, widthOnly: true }), { w: 402, h: 613 });
  assert.deepEqual(b.updates, [{ width: 852 }], 'the width alone');
  assert.deepEqual([b.w.left, b.w.top, b.w.height], [300, 80, 700]);
  // (Chrome won't make it narrower than 792 with its side panel, headless 156: the page is 406, and it stops asking)
  b = fakeWindow({ frame: panel, win: { left: 0, top: 25, width: 1000, height: 837 }, stale: { w: 614, h: 750 }, lag: 0, minWidth: 792 });
  assert.deepEqual(await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, pause: 1, widthOnly: true }), { w: 406, h: 750 });
  assert.equal(b.updates.length, 2, 'asked, then asked once more, then left');
  // (a maximized window is the person's: left as it is)
  b = fakeWindow({ frame: panel, win: { left: 0, top: 25, width: 1470, height: 931, state: 'maximized' }, stale: { w: 1084, h: 844 }, lag: 0 });
  assert.deepEqual(await fitPhoneWindow({ chrome: b.chrome, tabId: 1, windowId: 2, pause: 1, widthOnly: true }), { w: 1084, h: 844 });
  assert.equal(b.updates.length, 0);
});

test('phoneRoute: an ordinary window where there is a side panel or sidebar; the popup in a browser without one (Arc)', async () => {
  const { phoneRoute } = await load('phone.js');
  assert.equal(phoneRoute({ sidePanel: true }), 'window', 'Chrome');
  assert.equal(phoneRoute({ firefox: true }), 'window', 'Firefox: its sidebar');
  assert.equal(phoneRoute({ sidePanel: true, panelInWindow: true }), 'popup', 'Arc: a Chrome whose side panel never showed');
  assert.equal(phoneRoute({ sidePanel: true, fromPanelWindow: true }), 'popup', 'asked from a panel window: such a browser');
  assert.equal(phoneRoute({ sidePanel: false }), 'popup', 'a Chromium without chrome.sidePanel');
  assert.equal(phoneRoute(), 'popup');
});

test('phone-page.js says what phone.js PHONE says', async () => {
  const { PHONE, MARK } = await load('phone.js');
  const src = fs.readFileSync(path.join(EXT, 'phone-page.js'), 'utf8');
  assert.ok(src.includes(`ua: '${PHONE.ua}'`));
  assert.ok(src.includes(`platform: '${PHONE.platform}'`));
  assert.ok(src.includes(`screen: { width: ${PHONE.screen.width}, height: ${PHONE.screen.height} }`));
  assert.ok(src.includes(`const MARK = '${MARK}'`));
  // a classic script (registerContentScripts files aren't modules)
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
});

test('the page script leaves a page without the marker alone', async () => {
  const src = fs.readFileSync(path.join(EXT, 'phone-page.js'), 'utf8');
  const vm = require('vm');
  const defined = [];
  const sandbox = {
    performance: { getEntriesByType: () => [{ serverTiming: [{ name: 'cdn-cache' }] }] },
    location: { protocol: 'https:', href: 'https://x.com/' },
    Object: { ...Object, defineProperty: (...a) => { defined.push(a[1]); return Object.defineProperty(...a); } },
  };
  sandbox.window = sandbox; sandbox.top = sandbox;
  vm.runInNewContext(src, sandbox);
  assert.deepEqual(defined, []);
});

test('resolveTab finds a tab of the phone view\'s windows (popups), and only those', async () => {
  const { resolveTab } = await load('lib.js');
  const tabs = [
    { id: 1, windowId: 10, index: 0, active: true, url: 'https://x.com/home' },
    { id: 2, windowId: 20, index: 0, active: true, url: 'https://x.com/home' }, // the phone's
    { id: 3, windowId: 30, index: 0, active: true, url: 'https://x.com/other' }, // another popup
  ];
  const chromeApi = {
    tabs: { query: async (q) => (q.windowType === 'normal' ? tabs.filter((t) => t.windowId === 10) : tabs.filter((t) => t.windowId === q.windowId)) },
    windows: { getLastFocused: async () => ({ id: 10, type: 'normal' }) },
  };
  assert.equal((await resolveTab(chromeApi, { tab: 2 }, [20])).id, 2);
  await assert.rejects(resolveTab(chromeApi, { tab: 2 }), /no tab with id 2/);
  await assert.rejects(resolveTab(chromeApi, { tab: 3 }, [20]), /no tab with id 3/);
  assert.equal((await resolveTab(chromeApi, {}, [20])).id, 1, 'without --tab: the user\'s window first, as before');
});

test('tab locks leave the phone view\'s rules alone (foreign), and count their own ids without them', async () => {
  const { createTabLocks } = await load('tablock.js');
  const { isPhoneRule } = await load('phone.js');
  let rules = [{ id: 3, condition: {} }, { id: 1000000, condition: {} }, { id: 1000001, condition: {} }];
  const removed = [];
  const chromeApi = {
    storage: { session: { get: async () => ({}), set: async () => {} } },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => { removed.push(...removeRuleIds); rules = rules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    },
  };
  const locks = createTabLocks({ chrome: chromeApi, foreign: isPhoneRule });
  await locks.ready?.catch?.(() => {});
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(removed, [3], 'only its own stray rule');
  assert.deepEqual(rules.map((r) => r.id), [1000000, 1000001]);
});

test('the agent is told the chat is the phone view: its own folder, the desktop mods to read, rebuilt for the phone', () => {
  const agents = require('../helper/lib/agents');
  const text = agents.contextText({ url: 'https://x.com/home', tabId: 7, scope: 'phone~x.com', browser: 'Chrome', phone: { device: 'iPhone', width: 390 } });
  assert.match(text, /This chat is in TRIF's phone view/);
  assert.match(text, /Tab 7 is a window 390 px wide/);
  assert.match(text, /sites\/phone~x\.com\/ \(`trif new phone~x\.com <name>`\), the only folder you can write/);
  assert.match(text, /desktop mods in sites\/x\.com\/ are there to read/);
  assert.match(text, /without assuming the same selectors/);
  assert.match(text, /limited to x\.com's phone view/);
  assert.match(text, /sites\/x\.com\/files\//);
  assert.doesNotMatch(agents.contextText({ url: 'https://x.com/home', tabId: 7, scope: 'x.com', browser: 'Chrome' }), /phone view/);
  assert.match(agents.reminderText({ url: 'https://x.com/home', tabId: 7, phone: { device: 'iPhone' } }), /phone view \(iPhone\): phone mods only/);
  const guide = fs.readFileSync(path.join(__dirname, '..', 'helper', 'workspace', 'AGENTS.md'), 'utf8');
  assert.match(guide, /^### Phone mods$/m);
  assert.match(guide, /read it for the idea, then build it again/);
});

test('@device phone is read from the header', () => {
  const mods = require('../helper/lib/mods');
  const h = mods.parseHeader('// ==WebMod==\n// @name A\n// @device phone\n// ==/WebMod==\n');
  assert.equal(h.device, 'phone');
  assert.equal(mods.parseHeader('// ==WebMod==\n// @device tablet\n// ==/WebMod==\n').warnings.length, 1);
  assert.equal('device' in mods.parseHeader('// ==WebMod==\n// @name A\n// ==/WebMod==\n'), false);
});

test('Send to iPhone: a copy named as Export names it, to AirDrop, else shown in its folder', async () => {
  const os = require('os');
  const tophone = require('../helper/lib/tophone');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-tophone-'));
  try {
    const modsDir = path.join(home, 'sites');
    fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
    const file = path.join(modsDir, 'x.com', 'bottom-bar.js');
    fs.writeFileSync(file, '// ==WebMod==\n// @device phone\n// ==/WebMod==\n');
    const list = [{ id: 'x.com/bottom-bar', file }];
    const env = { TRIF_PHONE_OUTBOX: path.join(home, 'out'), TRIF_AIRDROP: 'shown' };
    const r = await tophone.sendToPhone({ modsDir }, list, 'x.com/bottom-bar', { env });
    assert.equal(r.how, 'airdrop');
    assert.equal(path.basename(r.file), 'x.com-bottom-bar.js');
    assert.equal(fs.readFileSync(r.file, 'utf8'), fs.readFileSync(file, 'utf8'));
    assert.ok(r.file.startsWith(env.TRIF_PHONE_OUTBOX));
    const none = await tophone.sendToPhone({ modsDir }, list, 'x.com/bottom-bar', { env: { ...env, TRIF_AIRDROP: 'none' } });
    assert.deepEqual([none.how, none.airdrop], ['folder', false]);
    assert.equal((await tophone.sendToPhone({ modsDir }, list, 'x.com/bottom-bar', { env: { ...env, TRIF_AIRDROP: 'noshow' } })).how, 'folder');
    assert.throws(() => tophone.copyForPhone({ modsDir }, list, 'x.com/other', { env }), /no mod/);
    assert.equal(tophone.airdropCommand('/f.js', 'linux'), null);
    assert.equal(tophone.airdropCommand('/f.js', 'darwin')[0], 'osascript');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// ---- the phone view as a TRIF of its own: phone mods in sites/phone~<site>/ (docs/MOBILE-EDIT.md)

test('scope: a phone twin is a site of its own for folders and runs, on its site\'s pages (helper and extension agree)', async () => {
  const scope = require('../helper/lib/scope');
  const lib = await load('lib.js');
  for (const S of [scope, lib]) {
    assert.equal(S.scopeFor('phone~x.com'), 'phone~x.com');
    assert.equal(S.scopeFor('phone~www.bbc.co.uk'), 'phone~bbc.co.uk');
    assert.notEqual(S.scopeFor('phone~x.com'), S.scopeFor('x.com'));
    assert.equal(S.hostInScope('api.x.com', 'phone~x.com'), true, 'its pages are the site\'s');
    assert.equal(S.hostInScope('x.com', 'phone~notx.com'), false);
    assert.equal(S.patternInScope('*://*.x.com/*', 'phone~x.com'), true, 'so a phone mod for the site isn\'t held as reaching other sites');
  }
  assert.equal(scope.scopeOf('phone~mail.google.com', ['mail.google.com']), 'phone~mail.google.com');
  assert.equal(scope.scopeOf('phone~docs.google.com', ['mail.google.com']), 'phone~google.com');
  assert.equal(scope.runScope('x.com', 'phone~x.com'), 'phone~x.com');
  assert.equal(scope.runScope('api.x.com', 'phone~x.com'), 'phone~x.com');
  assert.equal(scope.runScope('x.com', 'x.com'), 'x.com');
  const sens = lib.sensitiveSites({});
  assert.equal(sens.scopeOf('phone~x.com'), 'phone~x.com');
  assert.equal(lib.isPhoneMod({ id: 'phone~x.com/a' }), true);
  assert.equal(lib.isPhoneMod({ id: 'x.com/a' }), false);
});

test('phone mods: their folder\'s @match is the site\'s, marked phone; desktop ones aren\'t', () => {
  const mods = require('../helper/lib/mods');
  assert.deepEqual(mods.defaultMatches('phone~x.com'), ['*://x.com/*', '*://*.x.com/*']);
  const p = mods.buildMod({ site: 'phone~x.com', file: '/w/sites/phone~x.com/a.js', code: '// x' }).mod;
  assert.equal(p.id, 'phone~x.com/a');
  assert.equal(p.phone, true);
  assert.deepEqual(p.matches, ['*://x.com/*', '*://*.x.com/*']);
  assert.equal('phone' in mods.buildMod({ site: 'x.com', file: '/w/sites/x.com/a.js', code: '// x' }).mod, false);
});

test('the gate: desktop mods never run in the phone tab, phone mods only there (every kind of mod)', async () => {
  const lib = await load('lib.js');
  const vm = require('vm');
  const run = (code, phone) => {
    const ctx = { ran: [], window: {}, console, performance: { getEntriesByType: () => [{ serverTiming: phone ? [{ name: 'cdn' }, { name: 'trif-phone' }] : [{ name: 'cdn' }] }] } };
    ctx.globalThis = ctx;
    vm.runInNewContext(code, ctx);
    return ctx.ran.length;
  };
  for (const kind of [{}, { sandboxed: true }, { sandboxed: true, unsandboxed: true }]) {
    for (const [id, phoneMod] of [['x.com/a', false], ['phone~x.com/a', true]]) {
      const us = lib.modToUserScript({ id, matches: ['*://x.com/*'], code: 'ran.push(1)', ...kind });
      for (const js of us.js) {
        assert.ok(js.code.startsWith(lib.phoneGate(phoneMod, '')), `${id} ${JSON.stringify(kind)}: gated`);
        // (the gate itself, on its own: whether what follows runs)
        const gateOnly = lib.phoneGate(phoneMod, 'ran.push(1);');
        assert.equal(run(gateOnly, true), phoneMod ? 1 : 0, `${id} in the phone tab`);
        assert.equal(run(gateOnly, false), phoneMod ? 0 : 1, `${id} in a desktop tab`);
      }
    }
  }
  // a free mod's whole wrapper, run: its code runs only where it belongs
  const free = (id) => lib.modToUserScript({ id, matches: ['*://x.com/*'], code: 'ran.push(1)' }).js[0].code;
  assert.equal(run(free('x.com/a'), false), 1);
  assert.equal(run(free('x.com/a'), true), 0);
  assert.equal(run(free('phone~x.com/a'), true), 1);
  assert.equal(run(free('phone~x.com/a'), false), 0);
});

test('a run from the phone view writes only its phone twin\'s folder; the desktop mods are there to read', () => {
  const os = require('os');
  const { runLimits } = require('../helper/lib/runs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-ws-'));
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-private-'));
  try {
    const modsDir = path.join(home, 'sites');
    for (const d of ['x.com', 'phone~x.com', 'all-sites', 'other.example']) fs.mkdirSync(path.join(modsDir, d), { recursive: true });
    fs.writeFileSync(path.join(modsDir, 'x.com', 'hide-reposts.js'), '// the desktop one');
    const ws = { home, modsDir, private: priv };
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-box-'));
    const phone = runLimits(ws, { scope: 'phone~x.com', box, screenshots: box });
    assert.deepEqual([...phone.locked].sort(), ['all-sites', 'other.example', 'x.com'].map((d) => path.join('sites', d)), 'the phone run: every desktop folder read-only');
    const desk = runLimits(ws, { scope: 'x.com', box, screenshots: box });
    assert.deepEqual([...desk.locked].sort(), ['other.example', 'phone~x.com'].map((d) => path.join('sites', d)), 'a desktop run: the phone twin read-only');
    // (read-only, not hidden: the run's readable folders include the workspace, the desktop mods in it)
    assert.ok(phone.readable.some((r) => modsDir.startsWith(r) || fs.realpathSync(modsDir).startsWith(r)));
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(priv, { recursive: true, force: true }); }
});

test('phone mods made before the phone folder (@device phone in a desktop folder) move to it, once', () => {
  const os = require('os');
  const { movePhoneMods } = require('../helper/lib/phonemods');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-move-'));
  try {
    const modsDir = path.join(home, 'sites');
    const priv = path.join(home, 'private');
    const put = (rel, text) => { const f = path.join(modsDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    const phoneMod = '// ==WebMod==\n// @name Bottom bar\n// @device phone\n// ==/WebMod==\n';
    put('x.com/bottom-bar.js', phoneMod);
    put('x.com/desk.js', '// ==WebMod==\n// @name Desk\n// ==/WebMod==\n');
    put('phone~x.com/bottom-bar.js', '// already there');
    const r = movePhoneMods(modsDir, priv);
    assert.deepEqual(r.moved, [{ from: 'x.com/bottom-bar', to: 'phone~x.com/bottom-bar-2' }]);
    assert.equal(fs.readFileSync(path.join(modsDir, 'phone~x.com', 'bottom-bar-2.js'), 'utf8'), phoneMod);
    assert.ok(fs.existsSync(path.join(modsDir, 'x.com', 'desk.js')));
    assert.equal(fs.readFileSync(path.join(modsDir, 'phone~x.com', 'bottom-bar.js'), 'utf8'), '// already there', 'nothing overwritten');
    put('x.com/later.js', phoneMod);
    assert.deepEqual(movePhoneMods(modsDir, priv), { moved: [], skipped: true }, 'once');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Export and Send to iPhone take phone mods from the phone folder', async () => {
  const os = require('os');
  const share = require('../helper/lib/share');
  const tophone = require('../helper/lib/tophone');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-share-'));
  try {
    const modsDir = path.join(home, 'sites');
    fs.mkdirSync(path.join(modsDir, 'phone~x.com'), { recursive: true });
    const file = path.join(modsDir, 'phone~x.com', 'bar.js');
    fs.writeFileSync(file, '// a phone mod');
    const list = [{ id: 'phone~x.com/bar', file }];
    const site = share.exportSite({ modsDir }, list, 'phone~x.com', { to: path.join(home, 'out') });
    assert.deepEqual(site.ids, ['phone~x.com/bar']);
    assert.equal(path.basename(site.dir), 'phone~x.com mods');
    const r = await tophone.sendToPhone({ modsDir }, list, 'phone~x.com/bar', { env: { TRIF_PHONE_OUTBOX: path.join(home, 'outbox'), TRIF_AIRDROP: 'shown' } });
    assert.equal(fs.readFileSync(r.file, 'utf8'), '// a phone mod');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('navTarget: the phone view\'s address field: an address as typed, a bare host on https (http for localhost), anything else searched', async () => {
  const { navTarget, SEARCH } = await load('phone.js');
  for (const [typed, want] of [
    ['', null], ['   ', null],
    ['x.com', 'https://x.com/'], ['  x.com/home?f=live  ', 'https://x.com/home?f=live'], ['m.facebook.com', 'https://m.facebook.com/'],
    ['https://x.com/i/flow', 'https://x.com/i/flow'], ['HTTP://Example.com', 'http://example.com/'],
    ['localhost:3000', 'http://localhost:3000/'], ['127.0.0.1:8080/x', 'http://127.0.0.1:8080/x'], ['[::1]:3000', 'http://[::1]:3000/'],
    ['dark mode for x', `${SEARCH}dark%20mode%20for%20x`], ['foo', `${SEARCH}foo`],
    // (never another scheme: searched for, as text)
    ['javascript:alert(1)', `${SEARCH}javascript%3Aalert(1)`], ['file:///etc/hosts', `${SEARCH}file%3A%2F%2F%2Fetc%2Fhosts`],
    ['chrome://settings', `${SEARCH}chrome%3A%2F%2Fsettings`], ['data:text/html,hi', `${SEARCH}data%3Atext%2Fhtml%2Chi`],
  ]) assert.equal(navTarget(typed), want, typed);
  assert.ok(navTarget('a'.repeat(5000)).length < 2200, 'cut to 2 KB');
});
