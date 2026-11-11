'use strict';
// extension/tablock.js against a stand-in browser: declarativeNetRequest session rules, scripting in the
// isolated world (where the marker lives), storage.session.
const test = require('node:test');
const assert = require('node:assert');

function fakeChrome({ dropTabIds = false, failScripting = false, dropInitiator = false, tabs = [] } = {}) {
  const rules = new Map();
  const icons = new Map(); // tabId -> the 16 px icon set for that tab (chrome.action.setIcon)
  const iconCalls = [];
  const docs = new Map(); // tabId -> {marker} (the isolated world of the tab's current document)
  const store = {};
  // The site's stored state as the fingerprint sees it (one site in these tests), what clearData cleared,
  // the sites a page had loaded from, the tabs, and reloads.
  const data = { caches: 'c0', serviceWorkers: 'w0', localStorage: 'l0', sessionStorage: 's0', indexedDB: 'i0', cookies: 'k0' };
  const cleared = [];
  const domains = new Map();
  const tabList = tabs.map((t) => ({ ...t }));
  const reloads = [];
  const chrome = {
    rules, docs, icons, iconCalls, data, cleared, domains, tabList, reloads, runtime: {},
    action: {
      setIcon({ tabId, path }, done) { // (the callback form, as tablock.js calls it)
        iconCalls.push(tabId);
        if (tabId === 404) { chrome.runtime.lastError = { message: 'No tab with id: 404' }; done(); delete chrome.runtime.lastError; return; }
        icons.set(tabId, path[16]);
        done();
      },
    },
    declarativeNetRequest: {
      async updateSessionRules({ addRules = [], removeRuleIds = [] }) {
        for (const id of removeRuleIds) rules.delete(id);
        for (const r of addRules) {
          const kept = JSON.parse(JSON.stringify(r));
          if (dropTabIds) delete kept.condition.tabIds; // (a browser that ignores the condition)
          if (dropInitiator) delete kept.condition.initiatorDomains;
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
        // what the page's own APIs would say, by the function's name
        if (func.name === 'loadedDomains') return [{ result: domains.get(target.tabId) || [] }];
        if (func.name === 'fingerprint') return [{ result: { ...data } }];
        if (func.name === 'clearData') { for (const p of args[0]) { data[p] = 'cleared'; cleared.push(p); } return [{ result: args[0] }]; }
        const window = doc;
        const prevWindow = globalThis.window;
        globalThis.window = window;
        window.addEventListener = () => {};
        try { return [{ result: func(...args) }]; } finally { globalThis.window = prevWindow; }
      },
    },
    tabs: {
      async query() { return tabList.map((t) => ({ ...t })); },
      async get(id) { const t = tabList.find((x) => x.id === id); if (!t) throw new Error(`No tab with id: ${id}`); return { ...t }; },
      async reload(id, o) { reloads.push([id, o]); docs.set(id, {}); },
    },
    storage: { session: { async get(k) { return { [k]: store[k] }; }, async set(o) { Object.assign(store, JSON.parse(JSON.stringify(o))); } } },
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
  const rules = [...chrome.rules.values()].filter((r) => r.condition.tabIds?.[0] === 7);
  assert.equal(rules.length, 5);
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
  for (const t of ['image', 'script', 'stylesheet', 'font']) assert.ok(!rules[3].condition.resourceTypes.includes(t), `${t}: the next rule's`);
  // images, scripts, styles, fonts, media: only from the site (and, below, what the page already used)
  assert.deepEqual(rules[4].condition.resourceTypes, ['image', 'script', 'stylesheet', 'font', 'media']);
  assert.deepEqual(rules[4].condition.excludedRequestDomains, ['x.com']);
  assert.equal(lockRules(1, [5, 6, 7, 8, 9], 'x.com')[0].id, 5);
  // the same tab again: still one lock (its 5 rules, and the site's 5)
  await locks.lock(7, 'x.com');
  assert.equal(chrome.rules.size, 10);
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
  assert.equal(chrome.rules.size, 10);
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

test('TL-1: images, scripts, styles, fonts and media only from the sites the page already used', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  chrome.domains.set(7, ['x.com', 'abs.twimg.com', 'pbs.twimg.com']);
  await createTabLocks({ chrome }).lock(7, 'x.com');
  const sub = [...chrome.rules.values()].find((r) => r.condition.tabIds?.[0] === 7 && r.condition.resourceTypes?.includes('image'));
  assert.deepEqual(sub.condition.excludedRequestDomains, ['x.com', 'abs.twimg.com', 'pbs.twimg.com']);
  // a tab it opens: the same list
  const c2 = fakeChrome();
  c2.domains.set(1, ['x.com', 'cdn.example']);
  const l2 = createTabLocks({ chrome: c2 });
  await l2.lock(1, 'x.com');
  await l2.opened({ id: 2, openerTabId: 1 });
  const sub2 = [...c2.rules.values()].find((r) => r.condition.tabIds?.[0] === 2 && r.condition.resourceTypes?.includes('image'));
  assert.deepEqual(sub2.condition.excludedRequestDomains, ['x.com', 'cdn.example']);
});

test('TL-2, TL-5: while a tab of the site is locked, what the site starts is blocked everywhere, workers and new tabs too', async () => {
  const { createTabLocks, siteRules, WRITE_METHODS } = await load();
  const chrome = fakeChrome({ tabs: [{ id: 7, url: 'https://x.com/home' }, { id: 8, url: 'https://news.example/' }] });
  chrome.domains.set(7, ['x.com', 'abs.twimg.com']);
  const locks = createTabLocks({ chrome });
  await locks.lock(7, 'x.com');
  const site = [...chrome.rules.values()].filter((r) => r.condition.initiatorDomains);
  assert.equal(site.length, 5);
  for (const r of site) { assert.deepEqual(r.condition.initiatorDomains, ['x.com']); assert.ok(!r.condition.tabIds || r.condition.tabIds[0] === -1); }
  assert.deepEqual(site[0].condition.requestMethods, WRITE_METHODS); // writes, any tab or none
  assert.deepEqual(site[1].condition.resourceTypes, ['main_frame']); // form posts
  assert.deepEqual(site[2].condition.resourceTypes, ['websocket']);
  // no tab: only the site and what it already used
  assert.deepEqual(site[3].condition.tabIds, [-1]);
  assert.deepEqual(site[3].condition.excludedRequestDomains, ['x.com', 'abs.twimg.com']);
  // a tab that wasn't open when the lock started, sent elsewhere by the site: blocked; the open ones not
  assert.deepEqual(site[4].condition.resourceTypes, ['main_frame']);
  assert.deepEqual(site[4].condition.excludedRequestDomains, ['x.com']);
  assert.deepEqual(site[4].condition.excludedTabIds, [7, 8]);
  assert.equal(siteRules([1, 2, 3, 4, 5], 'x.com')[4].condition.excludedTabIds, undefined, 'no tabs open: no empty list');
  // unlocked: the site's rules go too
  chrome.newDocument(7);
  await locks.check(7);
  assert.equal(chrome.rules.size, 0);
  // a browser that drops the initiator condition would block every site's writes: no lock, no code
  const c2 = fakeChrome({ dropInitiator: true });
  const l2 = createTabLocks({ chrome: c2 });
  await assert.rejects(l2.lock(1, 'x.com'), /can't block requests a site starts/);
  assert.equal(c2.rules.size, 0);
  assert.ok(!l2.isLocked(1));
});

test('TL-4: the site\'s other tabs are locked with it (and new ones), until the last tab with agent code unlocks', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome({ tabs: [{ id: 1, url: 'https://x.com/home' }, { id: 2, url: 'https://x.com/messages' }, { id: 3, url: 'https://mobile.x.com/' }, { id: 4, url: 'https://news.example/' }] });
  const changed = [];
  const locks = createTabLocks({ chrome, changed: (id) => changed.push(id) });
  await locks.lock(1, 'x.com');
  assert.deepEqual(locks.list().map((l) => [l.tabId, l.kind]), [[1, 'code'], [2, 'site'], [3, 'site']]);
  assert.equal(locks.list()[1].from, 1, 'the panel can show the tab with the code');
  for (const id of [2, 3]) assert.equal(chrome.icons.get(id), 'icons/robot-paused-16.png');
  assert.ok(!chrome.icons.has(4));
  // a tab of the site opened now: locked; one that leaves the site: unlocked
  chrome.tabList.push({ id: 5, url: 'https://x.com/explore' });
  await locks.seen({ id: 5, url: 'https://x.com/explore' });
  assert.ok(locks.isLocked(5));
  await locks.seen({ id: 4, url: 'https://news.example/b' });
  assert.ok(!locks.isLocked(4));
  chrome.tabList.find((t) => t.id === 3).url = 'https://news.example/';
  await locks.check(3);
  assert.ok(!locks.isLocked(3));
  assert.equal(chrome.icons.get(3), 'icons/robot-16.png');
  // agent code in a second tab of the site: a lock of its own; the site stays locked until both unlock
  await locks.lock(2, 'x.com');
  assert.equal(locks.list().find((l) => l.tabId === 2).kind, 'code');
  chrome.newDocument(1);
  await locks.check(1);
  assert.ok(!locks.isLocked(1));
  assert.ok(locks.isLocked(5), 'tab 2 still has agent code: the site stays locked');
  chrome.newDocument(2);
  await locks.check(2);
  assert.deepEqual(locks.list(), []);
  assert.equal(chrome.rules.size, 0);
  assert.equal(chrome.icons.get(5), 'icons/robot-16.png');
});

test('TL-3: what was left in the site\'s storage, compared on the new page before unlocking', async () => {
  const { createTabLocks } = await load();
  // caches or service workers changed: cleared, reloaded past the cache, then unlocked
  let chrome = fakeChrome();
  let notes = [];
  let locks = createTabLocks({ chrome, noted: (...a) => notes.push(a) });
  await locks.lock(1, 'x.com');
  chrome.data.caches = 'poisoned';
  chrome.data.serviceWorkers = 'poisoned';
  chrome.newDocument(1);
  await locks.check(1);
  assert.ok(locks.isLocked(1), 'still locked while it clears');
  assert.deepEqual(chrome.cleared, ['caches', 'serviceWorkers']);
  assert.deepEqual(chrome.reloads, [[1, { bypassCache: true }]]);
  await locks.check(1); // (the reloaded page: the cleared parts aren't counted again)
  assert.ok(!locks.isLocked(1));
  assert.deepEqual(notes, []);
  // localStorage (or IndexedDB, cookies) changed: a note, and it unlocks as usual, nothing cleared
  chrome = fakeChrome();
  notes = [];
  locks = createTabLocks({ chrome, noted: (...a) => notes.push(a) });
  await locks.lock(1, 'x.com');
  chrome.data.localStorage = 'changed';
  chrome.data.cookies = 'changed';
  chrome.newDocument(1);
  await locks.check(1);
  assert.ok(!locks.isLocked(1));
  assert.deepEqual(notes, [[1, 'x.com', ['localStorage', 'cookies']]]);
  assert.deepEqual(chrome.cleared, []);
  // both: cleared and reloaded, and the note once
  chrome = fakeChrome();
  notes = [];
  locks = createTabLocks({ chrome, noted: (...a) => notes.push(a) });
  await locks.lock(1, 'x.com');
  chrome.data.caches = 'poisoned';
  chrome.data.indexedDB = 'changed';
  chrome.newDocument(1);
  await locks.check(1);
  await locks.check(1);
  assert.ok(!locks.isLocked(1));
  assert.deepEqual(notes, [[1, 'x.com', ['indexedDB']]]);
  // a part it couldn't read (null) isn't counted as a change
  chrome = fakeChrome();
  locks = createTabLocks({ chrome });
  chrome.data.caches = null;
  await locks.lock(1, 'x.com');
  chrome.data.caches = 'something';
  chrome.newDocument(1);
  await locks.check(1);
  assert.ok(!locks.isLocked(1));
});

test('TL-3: the page\'s save guard refuses saves with the agent\'s code on the stack; the site\'s own pass', async () => {
  const vm = require('vm');
  const { leakGuard, SAVE_REFUSED } = await load();
  const { buildRunCode } = await import('../extension/lib.js');
  // a page with just enough: Storage, a localStorage on the window, and the realm's own Error and Proxy
  const ctx = vm.createContext({ DOMException });
  vm.runInContext(`
    class Storage { constructor() { Object.defineProperty(this, '_m', { value: {} }); }
      setItem(k, v) { this._m[k] = String(v); } getItem(k) { return k in this._m ? this._m[k] : null; }
      removeItem(k) { delete this._m[k]; } clear() { for (const k of Object.keys(this._m)) delete this._m[k]; } }
    const store = new Storage();
    Object.defineProperty(globalThis, 'localStorage', { get() { return store; }, configurable: true, enumerable: true });
    globalThis.Storage = Storage;
    globalThis.siteSaves = (k) => localStorage.setItem(k, 'site');
    globalThis.window = globalThis;
  `, ctx);
  vm.runInContext(`(${leakGuard})()`, ctx);
  // the site's own code: saved
  vm.runInContext('siteSaves("a"); localStorage.b = "named"', ctx);
  assert.equal(vm.runInContext('localStorage.getItem("a")', ctx), 'site');
  // the agent's run code (tagged): refused, directly, through the site's function, by a named property,
  // and after an await
  const agent = async (code) => JSON.parse(await vm.runInContext(buildRunCode(code, false, 'run-1', null, { tag: true }), ctx));
  for (const code of ['localStorage.setItem("x", 1)', 'siteSaves("y")', 'localStorage.z = 1', 'await 0; localStorage.removeItem("a")', 'Error.stackTraceLimit = 0; localStorage.setItem("w", 1)']) {
    const out = await agent(code);
    assert.ok(!out.ok && out.error.includes(SAVE_REFUSED), `${code}: ${JSON.stringify(out)}`);
  }
  assert.equal(vm.runInContext('localStorage.getItem("a") + "," + localStorage.getItem("x") + "," + localStorage.getItem("y")', ctx), 'site,null,null');
  // untagged (a terminal's trif run, or the page's): not refused
  assert.deepEqual(JSON.parse(await vm.runInContext(buildRunCode('localStorage.setItem("t", 1)', false, 'run-2'), ctx)).ok, true);
  assert.doesNotMatch(buildRunCode('1', true, 'r'), /sourceURL/);
  assert.match(buildRunCode('1', true, 'r-1', null, { tag: true }), /\n\/\/# sourceURL=trif-run-r-1\.js$/);
});

test('a saved lock from before site locks (the old shape) still loads', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: [1, 2, 3, 4].map((id) => ({ id, condition: { tabIds: [3] }, action: { type: 'block' } })) });
  await chrome.storage.session.set({ tabLocks: { 3: { token: 't', ids: [1, 2, 3, 4], site: 'x.com', url: '', since: 1, parent: null } } });
  const locks = createTabLocks({ chrome });
  await locks.ready;
  assert.deepEqual(locks.list().map((l) => [l.tabId, l.kind]), [[3, 'code']]);
});
