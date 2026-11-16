'use strict';
// The phone view's parts that need no browser (extension/phone.js, phone-page.js; docs/MOBILE-EDIT.md): its
// rules, its window's bounds, the page script's profile matching phone.js's, resolveTab finding the phone's
// tab, tab locks leaving its rules alone, what the agent is told, and the @device header. The real thing in a
// browser: tests/phone-browser.test.js.

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
  assert.deepEqual(phoneBounds({ frame, screen: big, home: { left: 100, top: 60 } }), { width: 390, height: 750 + 62, left: 100, top: 25 });
  // a 13" MacBook Air with the Dock: 1470 x 956, 30 for the menu bar, 70 for the Dock
  const air = { left: 0, top: 30, width: 1470, height: 856 };
  assert.deepEqual(phoneBounds({ frame, screen: air, home: { left: 0, top: 30 } }), { width: 390, height: 812, left: 0, top: 30 });
  const short = { left: 0, top: 30, width: 1280, height: 640 };
  assert.equal(phoneBounds({ frame, screen: short }).height, 640, 'as tall as fits');
  const tiny = { left: 0, top: 30, width: 1280, height: 400 };
  assert.equal(phoneBounds({ frame, screen: tiny }).height, PHONE.minHeight + 62, 'never under the minimum');
  // the user's window far right: the phone stays on the screen
  assert.equal(phoneBounds({ frame, screen: air, home: { left: 1400, top: 30 } }).left, 1470 - 390);
  // no screen known: the user's window's corner, or nothing
  assert.deepEqual(phoneBounds({ frame, home: { left: 5, top: 6 } }), { width: 390, height: 812, left: 5, top: 6 });
  assert.deepEqual(phoneBounds({}), { width: 390, height: 750 });
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

test('the agent is told the tab is the phone view, and how a phone mod differs', () => {
  const agents = require('../helper/lib/agents');
  const text = agents.contextText({ url: 'https://x.com/home', tabId: 7, scope: 'x.com', browser: 'Chrome', phone: { device: 'iPhone', width: 390 } });
  assert.match(text, /Tab 7 is TRIF's phone view/);
  assert.match(text, /@device phone/);
  assert.match(text, /Phone mods" in AGENTS\.md/);
  assert.doesNotMatch(agents.contextText({ url: 'https://x.com/home', tabId: 7, scope: 'x.com', browser: 'Chrome' }), /phone view/);
  assert.match(agents.reminderText({ url: 'https://x.com/home', tabId: 7, phone: { device: 'iPhone' } }), /phone view \(iPhone\)/);
  const guide = fs.readFileSync(path.join(__dirname, '..', 'helper', 'workspace', 'AGENTS.md'), 'utf8');
  assert.match(guide, /^### Phone mods$/m);
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
