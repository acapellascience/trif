'use strict';
// extension/tablock.js against a stand-in browser: declarativeNetRequest session rules, scripting in the
// isolated world (where the marker lives), storage.session.
const test = require('node:test');
const assert = require('node:assert');

function fakeChrome({ dropTabIds = false, failScripting = false } = {}) {
  const rules = new Map();
  const icons = new Map(); // tabId -> the 16 px icon set for that tab (chrome.action.setIcon)
  const iconCalls = [];
  const docs = new Map(); // tabId -> {marker} (the isolated world of the tab's current document)
  const store = {};
  const chrome = {
    rules, docs, icons, iconCalls,
    action: {
      async setIcon({ tabId, path }) {
        iconCalls.push(tabId);
        if (tabId === 404) throw new Error('No tab with id: 404');
        icons.set(tabId, path[16]);
      },
    },
    declarativeNetRequest: {
      async updateSessionRules({ addRules = [], removeRuleIds = [] }) {
        for (const id of removeRuleIds) rules.delete(id);
        for (const r of addRules) {
          const kept = JSON.parse(JSON.stringify(r));
          if (dropTabIds) delete kept.condition.tabIds; // (a browser that ignores the condition)
          rules.set(r.id, kept);
        }
      },
      async getSessionRules() { return [...rules.values()]; },
    },
    scripting: {
      async executeScript({ target, func, args }) {
        if (failScripting) throw new Error('Cannot access contents of the page');
        const doc = docs.get(target.tabId) || {};
        docs.set(target.tabId, doc);
        const window = doc;
        const prevWindow = globalThis.window;
        globalThis.window = window;
        window.addEventListener = () => {};
        try { return [{ result: func(...args) }]; } finally { globalThis.window = prevWindow; }
      },
    },
    storage: { session: { async get(k) { return { [k]: store[k] }; }, async set(o) { Object.assign(store, o); } } },
    newDocument(tabId) { docs.set(tabId, {}); },
  };
  return chrome;
}

const load = () => import('../extension/tablock.js');

test('a locked tab: its changing requests and sockets are blocked, for that tab only', async () => {
  const { createTabLocks, lockRules, WRITE_METHODS } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  await locks.lock(7, 'x.com');
  assert.ok(locks.isLocked(7));
  const rules = [...chrome.rules.values()];
  assert.equal(rules.length, 4);
  for (const r of rules) { assert.deepEqual(r.condition.tabIds, [7]); assert.equal(r.action.type, 'block'); }
  // every kind of request but page loads (no list: browsers name them differently), page loads, sockets
  assert.deepEqual(rules[0].condition.requestMethods, WRITE_METHODS);
  assert.equal(rules[0].condition.resourceTypes, undefined);
  assert.deepEqual(rules[1].condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rules[1].condition.requestMethods, WRITE_METHODS);
  assert.deepEqual(rules[2].condition.resourceTypes, ['websocket']);
  assert.ok(!rules[2].condition.requestMethods, 'sockets are blocked whatever the method');
  // going to, or asking, another site: blocked whatever the method; the site itself stays reachable
  assert.deepEqual(rules[3].condition.excludedRequestDomains, ['x.com']);
  for (const t of ['main_frame', 'sub_frame', 'xmlhttprequest']) assert.ok(rules[3].condition.resourceTypes.includes(t), t);
  for (const t of ['image', 'script', 'stylesheet', 'font']) assert.ok(!rules[3].condition.resourceTypes.includes(t), `${t} still loads`);
  assert.equal(lockRules(1, [5, 6, 7, 8], 'x.com')[0].id, 5);
  // the same tab again: still one lock
  await locks.lock(7, 'x.com');
  assert.equal(chrome.rules.size, 4);
  assert.deepEqual(locks.list().map((l) => l.tabId), [7]);
});

test('the lock lasts as long as the page: a check on the same page keeps it, a new page unlocks', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  await locks.lock(3, 'x.com');
  await locks.check(3); // (pushState, a same-document change: the marker is still there)
  assert.ok(locks.isLocked(3));
  chrome.newDocument(3); // a reload: a new document, no marker
  await locks.check(3);
  assert.ok(!locks.isLocked(3));
  assert.equal(chrome.rules.size, 0);
});

test('a page TRIF can\'t script stays locked; closing the tab unlocks it', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  await locks.lock(4, 'x.com');
  chrome.scripting.executeScript = async () => { throw new Error('Cannot access a chrome:// URL'); };
  await locks.check(4);
  assert.ok(locks.isLocked(4));
  await locks.unlock(4, 'closed');
  assert.equal(chrome.rules.size, 0);
});

test('no lock, no code: a browser that drops the per-tab condition, or a page that can\'t be marked', async () => {
  const { createTabLocks } = await load();
  let chrome = fakeChrome({ dropTabIds: true });
  let locks = createTabLocks({ chrome });
  await assert.rejects(locks.lock(1, 'x.com'), /can't block requests for one tab/);
  assert.equal(chrome.rules.size, 0, 'and it leaves no rule that would block every tab');
  chrome = fakeChrome({ failScripting: true });
  locks = createTabLocks({ chrome });
  await assert.rejects(locks.lock(1, 'x.com'), /Cannot access/);
  assert.equal(chrome.rules.size, 0);
  assert.ok(!locks.isLocked(1));
});

test('tabs a locked tab opens are locked while it is', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  await locks.lock(10, 'x.com');
  await locks.opened({ id: 11, openerTabId: 10 });
  await locks.opened({ id: 12, openerTabId: 99 }); // (opened by a tab that isn't locked)
  assert.ok(locks.isLocked(11));
  assert.ok(!locks.isLocked(12));
  chrome.newDocument(11);
  await locks.check(11); // its own new page, but its opener's code can still reach it
  assert.ok(locks.isLocked(11));
  chrome.newDocument(10);
  await locks.check(10);
  assert.ok(!locks.isLocked(10));
  // (unlocking the opener checks the tabs it opened: the popup's page was marked while its opener was
  // locked, so it stays locked until a page of its own)
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(locks.isLocked(11));
  chrome.newDocument(11);
  await locks.check(11);
  assert.ok(!locks.isLocked(11));
});

test('a page back from the back/forward cache locks its tab again', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  await locks.restored(5, 'tok', 'x.com', 'https://x.com/home');
  assert.ok(locks.isLocked(5));
  assert.equal(chrome.rules.size, 4);
  assert.equal(locks.list()[0].url, 'https://x.com/home');
});

test('a locked tab\'s toolbar icon is the paused robot, for that tab only, until it unlocks', async () => {
  const { createTabLocks, ICONS } = await load();
  const fs = require('fs');
  const path = require('path');
  for (const p of [...Object.values(ICONS.normal), ...Object.values(ICONS.paused)]) assert.ok(fs.existsSync(path.join(__dirname, '..', 'extension', p)), p);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.action.default_icon, ICONS.normal, 'unlocking puts back the default icon');
  const chrome = fakeChrome();
  const changed = [];
  const locks = createTabLocks({ chrome, changed: (tabId) => changed.push(tabId) });
  await locks.lock(3, 'x.com');
  assert.equal(chrome.icons.get(3), 'icons/robot-paused-16.png');
  assert.deepEqual(changed, [3]);
  await locks.check(8); // (another tab, never locked: its icon is left alone)
  assert.ok(!chrome.icons.has(8));
  // a new page in the tab while the lock stays (Firefox drops a tab's own icon then): paused again
  chrome.icons.delete(3);
  chrome.scripting.executeScript = async () => { throw new Error('Cannot access contents of the page'); };
  await locks.check(3);
  assert.equal(chrome.icons.get(3), 'icons/robot-paused-16.png');
  // a reload: unlocked, the normal robot
  const script = fakeChrome().scripting.executeScript;
  chrome.scripting.executeScript = script;
  chrome.newDocument(3);
  await locks.check(3);
  assert.ok(!locks.isLocked(3));
  assert.equal(chrome.icons.get(3), 'icons/robot-16.png');
  assert.deepEqual(changed, [3, 3]);
  // the tabs a locked tab opens show it too; a closed tab gets no call; a gone tab's error is swallowed
  await locks.lock(10, 'x.com');
  await locks.opened({ id: 11, openerTabId: 10 });
  assert.equal(chrome.icons.get(11), 'icons/robot-paused-16.png');
  const calls10 = () => chrome.iconCalls.filter((id) => id === 10).length;
  const before = calls10();
  await locks.unlock(10, 'closed');
  assert.equal(calls10(), before);
  await locks.restored(404, 'tok', 'x.com', 'https://x.com/');
  assert.ok(locks.isLocked(404));
  // a browser without per-tab icons: locking still works
  const bare = fakeChrome();
  delete bare.action;
  await createTabLocks({ chrome: bare }).lock(1, 'x.com');
});

test('the paused icons are scripts/render-icon.js\'s: two white bars for eyes, sharp at 16 px', () => {
  const fs = require('fs');
  const path = require('path');
  const zlib = require('zlib');
  const { renderPaused } = require('../scripts/render-icon.js');
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(__dirname, '..', 'extension', 'icons', `robot-paused-${size}.png`);
    assert.ok(fs.readFileSync(file).equals(renderPaused(size)), `run node scripts/render-icon.js (robot-paused-${size}.png)`);
  }
  // the 16 px icon's middle row (render-icon writes one IDAT, filter 0 rows of RGBA): bar, gap, bar
  const png = renderPaused(16);
  const at = png.indexOf('IDAT');
  const raw = zlib.inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
  const px = (x, y) => [...raw.subarray(y * 65 + 1 + x * 4, y * 65 + 1 + x * 4 + 4)];
  const bar = [0xff, 0xff, 0xff, 255], face = [0x18, 0x18, 0x1a, 255];
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11].map((x) => px(x, 8)), [face, bar, bar, face, face, bar, bar, face]);
  // 6 px tall (rows 5 to 10; their corners a little rounded), face above and below
  for (const y of [6, 7, 8, 9]) assert.deepEqual(px(5, y), bar, `row ${y}`);
  for (const y of [5, 10]) assert.ok(px(5, y)[1] > 200 && px(5, y)[0] > 200, `row ${y}`);
  for (const y of [4, 11]) assert.deepEqual(px(5, y), face, `row ${y}`);
});
