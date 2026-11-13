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
  assert.equal(chrome.icons.get(3), 'icons/robot-16.png');
  assert.deepEqual(changed, [3]);
  await locks.check(8); // (another tab, never locked: its icon is left alone)
  assert.ok(!chrome.icons.has(8));
  // a new page in the tab while the lock stays (Firefox drops a tab's own icon then): paused again
  chrome.icons.delete(3);
  chrome.scripting.executeScript = async () => { throw new Error('Cannot access contents of the page'); };
  await locks.check(3);
  assert.equal(chrome.icons.get(3), 'icons/robot-16.png');
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
  assert.equal(chrome.icons.get(11), 'icons/robot-16.png');
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
    const file = path.join(__dirname, '..', 'extension', 'icons', `robot-paused-white-${size}.png`);
    assert.ok(fs.readFileSync(file).equals(renderPaused(size)), `run node scripts/render-icon.js (robot-paused-white-${size}.png)`);
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
  const { createTabLocks, siteRules, WRITE_METHODS, CROSS_SITE_TYPES, SUBRESOURCE_TYPES } = await load();
  const chrome = fakeChrome({ tabs: [{ id: 7, url: 'https://x.com/home' }, { id: 8, url: 'https://news.example/' }] });
  chrome.domains.set(7, ['x.com', 'abs.twimg.com']);
  const locks = createTabLocks({ chrome });
  await locks.lock(7, 'x.com');
  const site = [...chrome.rules.values()].filter((r) => r.condition.initiatorDomains);
  assert.equal(site.length, 5);
  // (in any tab and in none: no tab condition at all)
  for (const r of site) { assert.deepEqual(r.condition.initiatorDomains, ['x.com']); assert.equal(r.condition.tabIds, undefined); assert.equal(r.condition.excludedTabIds, undefined); }
  assert.deepEqual(site[0].condition.requestMethods, WRITE_METHODS); // writes
  assert.deepEqual(site[1].condition.resourceTypes, ['main_frame']); // form posts
  assert.deepEqual(site[2].condition.resourceTypes, ['websocket']);
  // another site, any tab or none: a page (a popup, a window found by name, a link out), a frame, fetch, XHR
  assert.deepEqual(site[3].condition.resourceTypes, CROSS_SITE_TYPES);
  assert.ok(site[3].condition.resourceTypes.includes('main_frame') && site[3].condition.resourceTypes.includes('sub_frame'));
  assert.deepEqual(site[3].condition.excludedRequestDomains, ['x.com']);
  // pictures and the rest: only from the site and what its pages already used
  assert.deepEqual(site[4].condition.resourceTypes, SUBRESOURCE_TYPES);
  assert.deepEqual(site[4].condition.excludedRequestDomains, ['x.com', 'abs.twimg.com']);
  assert.deepEqual(siteRules([1, 2, 3, 4, 5], 'x.com')[4].condition.excludedRequestDomains, ['x.com']);
  // unlocked: the site's rules go too
  chrome.newDocument(7);
  await locks.check(7);
  assert.equal(chrome.rules.size, 0);
  // a browser that drops the initiator condition would block every site's requests: no lock, no code
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
  for (const id of [2, 3]) assert.equal(chrome.icons.get(id), 'icons/robot-16.png');
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

test('the whole site, completely: its other tabs get the agent\'s tab\'s rules, new ones too, and a window of another site it reaches can only be sent to the site', async () => {
  const { createTabLocks, lockRules } = await load();
  const tabs = [
    { id: 1, url: 'https://x.com/home' },        // the agent's code runs here
    { id: 2, url: 'https://x.com/messages' },    // another tab of the site, open before
    { id: 3, url: 'https://news.example/' },     // another site's tab (a window x.com's code may find by name)
  ];
  const chrome = fakeChrome({ tabs });
  chrome.domains.set(1, ['x.com', 'abs.twimg.com']);
  chrome.domains.set(2, ['x.com', 'video.twimg.com']);
  const logged = [];
  const locks = createTabLocks({ chrome, log: (m) => logged.push(m) });
  await locks.lock(1, 'x.com');
  const rulesOf = (id) => [...chrome.rules.values()].filter((r) => r.condition.tabIds?.[0] === id);
  const shape = (rs) => rs.map((r) => ({ ...r.condition, tabIds: undefined }));
  const siteDomains = ['x.com', 'abs.twimg.com', 'video.twimg.com'];
  // tab 2: the same five rules as the agent's tab (the sites the site's pages used, both tabs')
  assert.equal(rulesOf(2).length, 5);
  assert.deepEqual(shape(rulesOf(2)), shape(lockRules(2, [1, 2, 3, 4, 5], 'x.com', siteDomains)));
  assert.ok(rulesOf(2).some((r) => r.condition.resourceTypes?.includes('main_frame') && r.condition.excludedRequestDomains?.[0] === 'x.com'), 'no navigation to another site from it');
  assert.ok(rulesOf(2).some((r) => r.condition.resourceTypes?.includes('xmlhttprequest')), 'no fetch to another site from it');
  assert.ok(rulesOf(2).some((r) => r.condition.resourceTypes?.includes('image') && !r.condition.excludedRequestDomains.includes('evil.example')), 'no image beacon to another site from it');
  // another site's tab: no rules of its own (the user's own), but the site's rules cover what x.com starts there
  assert.equal(rulesOf(3).length, 0);
  assert.ok(!locks.isLocked(3));
  const toOther = [...chrome.rules.values()].find((r) => r.condition.initiatorDomains && r.condition.resourceTypes?.includes('main_frame') && r.condition.excludedRequestDomains);
  assert.ok(toOther && !toOther.condition.tabIds && !toOther.condition.excludedTabIds, 'x.com can\'t send any tab to another site');
  // a tab of the site opened during the lock: the site's list, not what its page has loaded by the time TRIF sees it
  chrome.tabList.push({ id: 4, url: 'https://x.com/explore' });
  chrome.domains.set(4, ['x.com', 'evil.example']);
  await locks.opened({ id: 4, url: 'https://x.com/explore' });
  assert.equal(rulesOf(4).length, 5);
  assert.deepEqual(rulesOf(4).find((r) => r.condition.resourceTypes?.includes('image')).condition.excludedRequestDomains, siteDomains);
  // a tab one of the site's other tabs opens: locked with the site, while blank too; let go once it's elsewhere
  chrome.tabList.push({ id: 5, url: 'about:blank', openerTabId: 2 });
  await locks.opened({ id: 5, url: '', openerTabId: 2 });
  assert.equal(locks.list().find((l) => l.tabId === 5)?.kind, 'site');
  assert.equal(rulesOf(5).length, 5);
  await locks.check(5);
  assert.ok(locks.isLocked(5), 'still blank: still locked');
  chrome.tabList.find((t) => t.id === 5).url = 'https://news.example/x';
  await locks.check(5);
  assert.ok(!locks.isLocked(5));
  assert.equal(rulesOf(5).length, 0);
  // the other tab sent to another site (blocked: the browser's blocked page, which is that address): let go, its rules too
  chrome.tabList.find((t) => t.id === 4).url = 'https://evil.example/?d=secret';
  await locks.check(4);
  assert.ok(!locks.isLocked(4));
  assert.equal(rulesOf(4).length, 0);
  // agent code in tab 2 now: a lock of its own, its earlier rules replaced, not doubled
  await locks.lock(2, 'x.com');
  assert.equal(locks.list().find((l) => l.tabId === 2).kind, 'code');
  assert.equal(rulesOf(2).length, 5);
  // the last tab with agent code unlocks: every rule goes
  chrome.newDocument(1); await locks.check(1);
  chrome.newDocument(2); await locks.check(2);
  assert.deepEqual(locks.list(), []);
  assert.equal(chrome.rules.size, 0);
  // the site's rules saved and loaded again (a service worker restart) keep the other tabs' rules
  const c2 = fakeChrome({ tabs: [{ id: 1, url: 'https://x.com/a' }, { id: 2, url: 'https://x.com/b' }] });
  await createTabLocks({ chrome: c2 }).lock(1, 'x.com');
  const again = createTabLocks({ chrome: c2 });
  await again.ready;
  assert.deepEqual(again.list().map((l) => [l.tabId, l.kind]), [[1, 'code'], [2, 'site']]);
  assert.equal(c2.rules.size, 15);
  c2.newDocument(1); await again.check(1);
  assert.equal(c2.rules.size, 0);
});

test('a box run locks nothing: only a page-world run calls lock (background.js run)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'extension', 'background.js'), 'utf8');
  const run = src.slice(src.indexOf('  async run(args) {'), src.indexOf('  async reload(args) {'));
  const box = run.indexOf("if (args.world === 'box')"), boxed = run.indexOf('return boxedRun('), locking = run.indexOf('tabLocks.lock(');
  assert.ok(box > 0 && boxed > box && locking > boxed, 'the box run returns before the lock');
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

test('an agent\'s navigation: the tab\'s page loads are kept to its site while it loads; no rule, no navigation', async () => {
  const { createTabLocks } = await load();
  const chrome = fakeChrome();
  const locks = createTabLocks({ chrome });
  const release = await locks.guardNavigation(9, 'x.com');
  const rules = [...chrome.rules.values()];
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition, { tabIds: [9], resourceTypes: ['main_frame'], excludedRequestDomains: ['x.com'] });
  assert.equal(rules[0].action.type, 'block');
  assert.ok(!locks.isLocked(9), 'not a lock: the page can still post, as no agent code ran there');
  // it stays a moment after the load, then goes
  release(30);
  assert.equal(chrome.rules.size, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(chrome.rules.size, 0);
  // again on the same tab: one rule, the old one gone; the tab closing takes it
  await locks.guardNavigation(9, 'x.com');
  const again = await locks.guardNavigation(9, 'x.com');
  assert.equal(chrome.rules.size, 1);
  await locks.closed(9);
  assert.equal(chrome.rules.size, 0);
  again(0); // (nothing left to release: harmless)
  // released at once
  const r2 = await locks.guardNavigation(4, 'google.com');
  await r2(0);
  assert.equal(chrome.rules.size, 0);
  // a browser that drops the per-tab condition would keep every tab on the site: refused, nothing left behind
  const broken = fakeChrome({ dropTabIds: true });
  await assert.rejects(createTabLocks({ chrome: broken }).guardNavigation(9, 'x.com'), /can't keep one tab's page loads to a site/);
  assert.equal(broken.rules.size, 0);
});

test('methods: unnamed ones ("other") are blocked too; a browser that won\'t take that name gets the named ones', async () => {
  const { createTabLocks, WRITE_METHODS, NAMED_WRITE_METHODS } = await load();
  assert.ok(WRITE_METHODS.includes('other') && !NAMED_WRITE_METHODS.includes('other'));
  for (const m of ['get', 'head', 'options']) assert.ok(!WRITE_METHODS.includes(m), `${m}: the page has to load`);
  const chrome = fakeChrome({ tabs: [{ id: 7, url: 'https://x.com/home' }] });
  const add = chrome.declarativeNetRequest.updateSessionRules;
  chrome.declarativeNetRequest.updateSessionRules = async (o) => {
    if ((o.addRules || []).some((r) => (r.condition.requestMethods || []).includes('other'))) throw new Error("Value 'other' is not a request method");
    return add(o);
  };
  const logged = [];
  const locks = createTabLocks({ chrome, log: (m) => logged.push(m) });
  await locks.lock(7, 'x.com');
  assert.ok(locks.isLocked(7));
  const withMethods = [...chrome.rules.values()].filter((r) => r.condition.requestMethods);
  assert.equal(withMethods.length, 4, 'the tab\'s two and the site\'s two');
  for (const r of withMethods) assert.deepEqual(r.condition.requestMethods, NAMED_WRITE_METHODS);
  assert.ok(logged.some((m) => /don't take the method "other"/.test(m)));
});

test('the tab that opened a locked one, on the same site, is locked as a tab with agent code too: until it shows a new page', async () => {
  const { createTabLocks } = await load();
  const tabs = [
    { id: 1, url: 'https://x.com/home' },                      // opened 2
    { id: 2, url: 'https://x.com/post/1', openerTabId: 1 },    // opened 3: the agent's code runs here
    { id: 3, url: 'https://x.com/post/2', openerTabId: 2 },
    { id: 4, url: 'https://x.com/explore' },                   // another tab of the site, no opener link
    { id: 5, url: 'https://news.example/', openerTabId: 9 },
    { id: 9, url: 'https://x.com/links' },
  ];
  const chrome = fakeChrome({ tabs });
  const logged = [];
  const locks = createTabLocks({ chrome, log: (m) => logged.push(m) });
  await locks.lock(3, 'x.com');
  const kinds = Object.fromEntries(locks.list().map((l) => [l.tabId, l.kind]));
  assert.deepEqual(kinds, { 1: 'code', 2: 'code', 3: 'code', 4: 'site', 9: 'site' });
  for (const id of [1, 2, 3]) assert.equal([...chrome.rules.values()].filter((r) => r.condition.tabIds?.[0] === id).length, 5, `tab ${id}: its own rules`);
  assert.ok(logged.some((m) => /locked tab 2 too: it opened tab 3/.test(m)) && logged.some((m) => /locked tab 1 too: it opened tab 2/.test(m)));
  // the agent's tab reloads: unlocked. Its opener still has the page the code could reach: locked, and the site with it
  chrome.newDocument(3);
  await locks.check(3);
  assert.ok(!locks.isLocked(3));
  assert.ok(locks.isLocked(2) && locks.isLocked(1) && locks.isLocked(4), 'the site stays locked while an opener keeps its page');
  chrome.newDocument(2); await locks.check(2);
  chrome.newDocument(1); await locks.check(1);
  assert.deepEqual(locks.list(), []);
  assert.equal(chrome.rules.size, 0);
  // an opener on another site isn't locked; one that can't be found is logged, and the lock holds
  const c2 = fakeChrome({ tabs: [{ id: 5, url: 'https://x.com/a', openerTabId: 9 }, { id: 9, url: 'https://news.example/' }, { id: 6, url: 'https://x.com/b', openerTabId: 77 }] });
  const l2 = createTabLocks({ chrome: c2 });
  await l2.lock(5, 'x.com');
  await l2.lock(6, 'x.com');
  assert.deepEqual(l2.list().map((l) => [l.tabId, l.kind]).sort(), [[5, 'code'], [6, 'code']]);
});
