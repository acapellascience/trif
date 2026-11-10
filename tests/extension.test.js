// Extension tests: mod syncing against a chrome.userScripts mock, tab selection, `run` code
// building, and the page runtime (serializer, log/error attribution, network recorder) evaluated in
// a vm context with a fake window/fetch/XMLHttpRequest.
const assert = require('node:assert');
const vm = require('node:vm');
const { test, before } = require('node:test');
const { waitFor } = require('./fake-extension');

let lib, rt;
before(async () => {
  lib = await import('../extension/lib.js');
  rt = await import('../extension/runtime.js');
});

const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const quietConsole = { log() {}, warn() {}, error() {}, info() {} };

// ---- chrome.userScripts mock --------------------------------------------------------------------

function mockUserScripts() {
  const scripts = [];
  const calls = [];
  const validate = (s) => {
    if (typeof s.id !== 'string' || s.id.startsWith('_')) throw new Error(`Invalid ID '${s.id}'.`);
    if (!Array.isArray(s.matches) || !s.matches.length) throw new Error(`Script '${s.id}' must specify matches.`);
    for (const m of s.matches) if (m !== '<all_urls>' && !/^(\*|https?|file):\/\//.test(m)) throw new Error(`Invalid match pattern '${m}'`);
  };
  return {
    scripts,
    calls,
    async getScripts() { return structuredClone(scripts); },
    async register(list) {
      calls.push(['register', list.map((s) => s.id)]);
      for (const s of list) {
        validate(s);
        if (scripts.some((x) => x.id === s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
      }
      scripts.push(...structuredClone(list));
    },
    async update(list) {
      calls.push(['update', list.map((s) => s.id)]);
      for (const s of list) {
        const i = scripts.findIndex((x) => x.id === s.id);
        if (i < 0) throw new Error(`Script with ID '${s.id}' does not exist.`);
        validate({ ...scripts[i], ...s });
        scripts[i] = { ...scripts[i], ...structuredClone(s) };
      }
    },
    async unregister(filter) {
      calls.push(['unregister', filter?.ids ?? 'all']);
      if (!filter) scripts.length = 0;
      else for (const id of filter.ids) { const i = scripts.findIndex((x) => x.id === id); if (i >= 0) scripts.splice(i, 1); }
    },
  };
}

const mod = (id, extra = {}) => ({
  id, site: id.split('/')[0], file: `/w/sites/${id}.js`, name: id, description: '',
  matches: [`*://${id.split('/')[0]}/*`], excludes: [], runAt: 'document_start', code: `/* ${id} */`, hash: 'h1', ...extra,
});

test('no page is ever marked, timsrobot.com included; a home page marker left by a development build goes', async () => {
  const us = mockUserScripts();
  await us.register([{ id: 'trif-home', matches: ['*://timsrobot.com/*'], js: [{ code: 'document.documentElement.setAttribute("data-trif", "on");' }], runAt: 'document_start', world: 'MAIN' }]);
  const r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('timsrobot.com/fireworks')], runtimeCode: 'RT', sitesOn: ['x.com', 'timsrobot.com'] });
  assert.deepStrictEqual(us.scripts.map((s) => s.id), ['webmods-runtime', 'x.com/a', 'timsrobot.com/fireworks']);
  assert.deepStrictEqual(r.registered, ['x.com/a', 'timsrobot.com/fireworks']);
  assert.ok(!us.scripts.some((s) => s.js.some((j) => j.code.includes('data-trif'))), 'nothing marks pages');
});

test('first sync registers the runtime first, then each mod, wrapped and in the MAIN world', async () => {
  const us = mockUserScripts();
  const res = await lib.syncUserScripts(us, {
    mods: [mod('x.com/a', { runAt: 'document_idle', excludes: ['*://x.com/settings*'] }), mod('y.com/b', { runAt: 'document-end' })],
    runtimeCode: rt.runtimeCode([]),
  });
  assert.deepStrictEqual(res.registered, ['x.com/a', 'y.com/b']);
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a', 'y.com/b']);
  const [runtime, a, b] = us.scripts;
  assert.deepStrictEqual(runtime.matches, ['*://x.com/*', '*://y.com/*'], 'the runtime only goes where mods run');
  assert.strictEqual(runtime.runAt, 'document_start');
  assert.strictEqual(runtime.world, 'MAIN');
  assert.strictEqual(a.world, 'MAIN');
  assert.strictEqual(a.runAt, 'document_idle');
  assert.deepStrictEqual(a.excludeMatches, ['*://x.com/settings*']);
  assert.strictEqual(b.runAt, 'document_end');
  assert.strictEqual(a.js[0].code, lib.wrapModCode('x.com/a', '/* x.com/a */'));
  assert.ok(!lib.RUNTIME_ID.startsWith('_'));
  assert.strictEqual(res.applied['x.com/a'], 'h1');
});

test('the runtime follows the mods and recorded sites; with neither, nothing is registered', async () => {
  const us = mockUserScripts();
  const runtimeCode = rt.runtimeCode(['news.com']);
  let r = await lib.syncUserScripts(us, { mods: [], runtimeCode, recording: ['news.com'] });
  assert.deepStrictEqual(us.scripts.map((s) => [s.id, s.matches]), [[lib.RUNTIME_ID, ['*://*.news.com/*', '*://news.com/*']]]);
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode, recording: ['news.com'], applied: r.applied });
  assert.strictEqual(r.reset, true, 'new matches: re-registered, runtime first');
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a']);
  assert.deepStrictEqual(us.scripts[0].matches, ['*://*.news.com/*', '*://news.com/*', '*://x.com/*']);
  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode, recording: ['news.com'], applied: r.applied });
  assert.deepStrictEqual(us.calls, [], 'unchanged: untouched');
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode, recording: ['news.com'], applied: r.applied, disabled: { 'x.com/a': true } });
  r = await lib.syncUserScripts(us, { mods: [], runtimeCode: rt.runtimeCode([]), applied: r.applied });
  assert.deepStrictEqual(us.scripts, []);
  assert.deepStrictEqual(r.applied, {});
});

test('unchanged mods are skipped by hash; changed are updated; missing unregistered; new appended', async () => {
  const us = mockUserScripts();
  const runtimeCode = rt.runtimeCode([]);
  let r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode });
  us.calls.length = 0;

  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode, applied: r.applied });
  assert.deepStrictEqual(us.calls, []);
  assert.deepStrictEqual(r.registered, ['x.com/a', 'x.com/b']);

  r = await lib.syncUserScripts(us, {
    mods: [mod('x.com/a', { hash: 'h2', code: 'changed()' }), mod('x.com/c')], runtimeCode, applied: r.applied,
  });
  assert.deepStrictEqual(us.calls, [['unregister', ['x.com/b']], ['update', ['x.com/a']], ['register', ['x.com/c']]]);
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a', 'x.com/c']);
  assert.match(us.scripts[1].js[0].code, /changed\(\)/);
  assert.deepStrictEqual(r.applied, { [lib.RUNTIME_ID]: lib.quickHash(runtimeCode + '\n' + JSON.stringify(['*://x.com/*'])), 'x.com/a': 'h2', 'x.com/c': 'h1' });
});

test('a lost hash map updates existing scripts instead of re-registering', async () => {
  const us = mockUserScripts();
  const runtimeCode = rt.runtimeCode([]);
  await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode });
  us.calls.length = 0;
  await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode, applied: {} });
  assert.deepStrictEqual(us.calls, [['update', ['x.com/a']]]);
});

test('a runtime change (recording set) re-registers everything with the runtime first', async () => {
  const us = mockUserScripts();
  let r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode: rt.runtimeCode([]) });
  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode: rt.runtimeCode(['x.com']), applied: r.applied });
  assert.strictEqual(r.reset, true);
  assert.deepStrictEqual(us.calls, [['unregister', 'all'], ['register', [lib.RUNTIME_ID]], ['register', ['x.com/a', 'x.com/b']]], 'the mods in one call, after the runtime');
  assert.match(us.scripts[0].js[0].code, /const RECORDING = \["x.com"\]/);
});

test('mods registered without the runtime (or before it) trigger a full re-register', async () => {
  const us = mockUserScripts();
  await us.register([lib.modToUserScript(mod('x.com/a'))]);
  us.calls.length = 0;
  await lib.syncUserScripts(us, { mods: [mod('x.com/a')], runtimeCode: rt.runtimeCode([]), applied: { 'x.com/a': 'h1' } });
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a']);
  assert.deepStrictEqual(us.calls[0], ['unregister', 'all']);
});

test('one bad mod is reported without blocking the others; duplicates are rejected', async () => {
  const us = mockUserScripts();
  const r = await lib.syncUserScripts(us, {
    mods: [mod('x.com/bad', { matches: ['not a pattern'] }), mod('x.com/good'), mod('x.com/good')],
    runtimeCode: rt.runtimeCode([]),
  });
  assert.deepStrictEqual(r.registered, ['x.com/good']);
  assert.strictEqual(r.errors.length, 2);
  const bad = r.errors.find((e) => e.id === 'x.com/bad');
  assert.match(bad.error, /Invalid match pattern/);
  assert.match(r.errors.find((e) => e.id === 'x.com/good').error, /duplicate/);
  assert.ok(!('x.com/bad' in r.applied));
});

test('mods register in one call; when that fails part way (a browser that keeps the ones before), each is retried on its own', async () => {
  const us = mockUserScripts();
  const atomic = us.register.bind(us);
  us.register = async (list) => { for (const s of list) await atomic([s]); }; // registers until the bad one throws
  const mods = [mod('x.com/a'), mod('x.com/bad', { matches: ['not a pattern'] }), mod('x.com/c')];
  const r = await lib.syncUserScripts(us, { mods, runtimeCode: rt.runtimeCode([]) });
  assert.deepStrictEqual(r.registered, ['x.com/a', 'x.com/c']);
  assert.deepStrictEqual(r.errors.map((e) => e.id), ['x.com/bad']);
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a', 'x.com/c']);
  // Two changed and one new: one update call, one register call.
  const us2 = mockUserScripts();
  const r1 = await lib.syncUserScripts(us2, { mods: [mod('x.com/a'), mod('x.com/c')], runtimeCode: rt.runtimeCode([]) });
  us2.calls.length = 0;
  const r2 = await lib.syncUserScripts(us2, { mods: [mod('x.com/a', { hash: 'h2' }), mod('x.com/c', { hash: 'h2' }), mod('x.com/d')], runtimeCode: rt.runtimeCode([]), applied: r1.applied });
  assert.deepStrictEqual(r2.registered, ['x.com/a', 'x.com/c', 'x.com/d']);
  assert.deepStrictEqual(us2.calls, [['update', ['x.com/a', 'x.com/c']], ['register', ['x.com/d']]]);
});

test('sync skips switched-off mods, unregisters newly switched-off ones, re-registers them when switched on', async () => {
  const us = mockUserScripts();
  const runtimeCode = rt.runtimeCode([]);
  let r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode, disabled: { 'x.com/b': true } });
  assert.deepStrictEqual(r.registered, ['x.com/a']);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a']);

  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode, applied: r.applied, disabled: { 'x.com/a': true } });
  assert.deepStrictEqual(us.calls, [['unregister', ['x.com/a']], ['register', ['x.com/b']]]);
  assert.deepStrictEqual(r.registered, ['x.com/b']);
  assert.ok(!('x.com/a' in r.applied));

  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode, applied: r.applied, disabled: {} });
  assert.deepStrictEqual(us.calls, [['register', ['x.com/a']]]);
  assert.deepStrictEqual(r.registered, ['x.com/a', 'x.com/b']);

  // a full re-register (runtime change) leaves switched-off mods out too
  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode: rt.runtimeCode(['x.com']), applied: r.applied, disabled: { 'x.com/a': true, 'gone.com/stale': true } });
  assert.deepStrictEqual(us.calls, [['unregister', 'all'], ['register', [lib.RUNTIME_ID]], ['register', ['x.com/b']]]);

  assert.deepStrictEqual(lib.normalizeDisabled({ 'x.com/a': true, 'x.com/b': false, 'x.com/c': 'yes' }), { 'x.com/a': true });
  assert.deepStrictEqual(lib.normalizeDisabled(null), {});
  assert.deepStrictEqual(lib.normalizeDisabled(['x.com/a']), {});
});

test('run-at mapping', () => {
  assert.strictEqual(lib.normalizeRunAt('document_end'), 'document_end');
  assert.strictEqual(lib.normalizeRunAt('document-idle'), 'document_idle');
  assert.strictEqual(lib.normalizeRunAt(undefined), 'document_start');
  assert.strictEqual(lib.normalizeRunAt('whenever'), 'document_start');
});

test('userScriptsAvailable detects the "Allow User Scripts" switch', () => {
  assert.strictEqual(lib.userScriptsAvailable({}), false);
  assert.strictEqual(lib.userScriptsAvailable({ userScripts: { getScripts() { throw new Error('off'); } } }), false);
  assert.strictEqual(lib.userScriptsAvailable({ userScripts: { getScripts: () => Promise.reject(new Error('x')) } }), true);
  assert.strictEqual(lib.userScriptsAvailable({ get userScripts() { throw new Error('off'); } }), false);
  // It asks for no script in particular: every script with its code, on every message, cost Firefox gigabytes.
  const asked = [];
  assert.strictEqual(lib.userScriptsAvailable({ userScripts: { getScripts: (f) => { asked.push(f); return Promise.resolve([]); } } }), true);
  assert.ok(Array.isArray(asked[0]?.ids) && asked[0].ids.length === 1, JSON.stringify(asked));
});

test('syncUserScripts with the ids it left registered (known) doesn\'t fetch the scripts; after a failure it does', async () => {
  const us = mockUserScripts();
  let fetched = 0;
  const get = us.getScripts;
  us.getScripts = async (f) => { fetched++; return get(f); };
  const runtimeCode = rt.runtimeCode([]);
  let r = await lib.syncUserScripts(us, { mods: [mod('x.com/a'), mod('x.com/b')], runtimeCode });
  assert.strictEqual(fetched, 1);
  assert.deepStrictEqual(r.known, [lib.RUNTIME_ID, 'x.com/a', 'x.com/b']);
  us.calls.length = 0;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a', { hash: 'h2' }), mod('x.com/c')], runtimeCode, applied: r.applied, known: r.known });
  assert.strictEqual(fetched, 1, 'not fetched again');
  assert.deepStrictEqual(us.calls, [['unregister', ['x.com/b']], ['update', ['x.com/a']], ['register', ['x.com/c']]]);
  assert.deepStrictEqual(r.known, [lib.RUNTIME_ID, 'x.com/a', 'x.com/c']);
  // A mod that won't register: unsure what's there, so the next sync asks.
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a', { hash: 'h2' }), mod('x.com/bad', { matches: ['nope'] })], runtimeCode, applied: r.applied, known: r.known });
  assert.strictEqual(r.known, null);
  assert.deepStrictEqual(r.errors.map((e) => e.id), ['x.com/bad']);
  const before = fetched;
  r = await lib.syncUserScripts(us, { mods: [mod('x.com/a', { hash: 'h2' })], runtimeCode, applied: r.applied, known: r.known });
  assert.strictEqual(fetched, before + 1);
  assert.deepStrictEqual(us.scripts.map((s) => s.id), [lib.RUNTIME_ID, 'x.com/a']);
  // Nothing to register: none known.
  r = await lib.syncUserScripts(us, { mods: [], runtimeCode, applied: r.applied, known: r.known });
  assert.deepStrictEqual(r.known, []);
  assert.deepStrictEqual(us.scripts, []);
});

test('fillSameMods puts the code back from the mods it had, by id and hash', () => {
  const had = [{ id: 'a', hash: 'h1', code: 'A' }, { id: 'b', hash: 'h1', code: 'B' }];
  assert.deepStrictEqual(lib.fillSameMods([{ id: 'a', hash: 'h1', same: true, name: 'n' }, { id: 'b', hash: 'h2', code: 'B2' }], had),
    { mods: [{ id: 'a', hash: 'h1', name: 'n', code: 'A' }, { id: 'b', hash: 'h2', code: 'B2' }] });
  assert.deepStrictEqual(lib.fillSameMods([{ id: 'a', hash: 'h2', same: true }, { id: 'c', hash: 'h1', same: true }], had), { missing: ['a', 'c'] });
  assert.deepStrictEqual(lib.fillSameMods(undefined, had), { mods: [] });
});

test('modsStoragePlan writes the mods that changed and the list, removes the gone ones and the old `mods`', () => {
  const a = mod('x.com/a');
  const b = mod('x.com/b', { hash: 'hb' });
  let st = lib.modsStorageState({ mods: [a] });
  assert.deepStrictEqual(lib.storedMods({ mods: [a] }), [a]);
  let p = lib.modsStoragePlan([a, b], st);
  assert.deepStrictEqual(Object.keys(p.set).sort(), ['mod:x.com/a', 'mod:x.com/b', 'modIds']);
  assert.deepStrictEqual(p.remove, ['mods']);
  st = p.stored;
  assert.deepStrictEqual(lib.modsStoragePlan([a, b], st), { set: {}, remove: [], stored: st });
  // The header changed (same hash, held now): written again. The code alone is covered by the hash.
  p = lib.modsStoragePlan([a, { ...b, held: { site: 'y.com' } }], st);
  assert.deepStrictEqual(Object.keys(p.set), ['mod:x.com/b']);
  p = lib.modsStoragePlan([{ ...b, held: { site: 'y.com' } }], p.stored);
  assert.deepStrictEqual(p.set, { modIds: ['x.com/b'] });
  assert.deepStrictEqual(p.remove, ['mod:x.com/a']);
  // Read back the way the background does at startup.
  const items = { modIds: ['x.com/b', 'x.com/gone'], 'mod:x.com/b': b };
  assert.deepStrictEqual(lib.storedMods(items), [b]);
  assert.deepStrictEqual(lib.modsStoragePlan([b], lib.modsStorageState(items)).set, { modIds: ['x.com/b'] });
});

// ---- tabs ---------------------------------------------------------------------------------------

const TABS = [
  { id: 1, windowId: 10, index: 0, active: true, url: 'https://x.com/home', title: 'X' },
  { id: 2, windowId: 10, index: 1, active: false, url: 'https://news.ycombinator.com/', title: 'HN' },
  { id: 3, windowId: 20, index: 0, active: false, url: 'https://x.com/settings', title: 'X settings' },
  { id: 4, windowId: 20, index: 1, active: true, url: 'https://example.com/', title: 'Example' },
];

test('tab selection: id, url substring, /regex/, default active tab', () => {
  assert.strictEqual(lib.selectTab(TABS, 20, { tab: 2 }).id, 2);
  assert.strictEqual(lib.selectTab(TABS, 20, { tab: '1' }).id, 1);
  assert.throws(() => lib.selectTab(TABS, 20, { tab: 99 }), /no tab with id 99/);
  // first match in the last-focused window wins, then any window
  assert.strictEqual(lib.selectTab(TABS, 20, { url: 'x.com' }).id, 3);
  assert.strictEqual(lib.selectTab(TABS, 10, { url: 'x.com' }).id, 1);
  assert.strictEqual(lib.selectTab(TABS, 20, { url: 'ycombinator' }).id, 2);
  assert.strictEqual(lib.selectTab(TABS, 10, { url: '/settings$/' }).id, 3);
  assert.strictEqual(lib.selectTab(TABS, 10, { url: '/EXAMPLE/i' }).id, 4);
  assert.throws(() => lib.selectTab(TABS, 10, { url: 'nope.org' }), /no tab whose URL matches nope.org/);
  assert.throws(() => lib.selectTab(TABS, 10, { url: '/(/' }), /invalid url regex/);
  assert.strictEqual(lib.selectTab(TABS, 20, {}).id, 4);
  assert.strictEqual(lib.selectTab(TABS, 10, {}).id, 1);
  assert.strictEqual(lib.selectTab(TABS, undefined, {}).id, 1);
  assert.throws(() => lib.selectTab([], 10, {}), /no active tab/);
});

test('tab selection for a scoped run: only its site\'s tabs, and errors name no other tab', () => {
  const scope = 'x.com';
  // the focused window's active tab is example.com: the run gets its own site's tab instead
  assert.strictEqual(lib.selectTab(TABS, 20, { scope }).id, 1);
  assert.strictEqual(lib.selectTab(TABS, 20, { scope, tab: 3 }).id, 3);
  for (const args of [{ tab: 2 }, { tab: 4 }, { url: 'ycombinator' }, { url: '/^https:\\/\\/news/' }]) {
    let err;
    try { lib.selectTab(TABS, 20, { scope, ...args }); } catch (e) { err = e; }
    assert.ok(err, JSON.stringify(args));
    assert.match(err.message, /on x\.com/);
    assert.doesNotMatch(err.message, /example\.com|news\.ycombinator\.com|is on /, 'nothing about other tabs');
  }
  assert.throws(() => lib.selectTab(TABS.filter((t) => !t.url.includes('x.com')), 20, { scope }), /no tab is open on x\.com/);
});

test('resolveTab queries normal windows and the last-focused window', async () => {
  const queries = [];
  const chromeMock = {
    tabs: { query: async (q) => { queries.push(q); return [...TABS].reverse(); } },
    windows: { getLastFocused: async (q) => { queries.push(q); return { id: 20 }; } },
  };
  assert.strictEqual((await lib.resolveTab(chromeMock, { url: 'x.com' })).id, 3);
  assert.deepStrictEqual(queries, [{ windowType: 'normal' }, { windowTypes: ['normal'] }]);
  chromeMock.windows.getLastFocused = async () => { throw new Error('No last-focused window'); };
  assert.strictEqual((await lib.resolveTab(chromeMock, {})).id, 1);
});

test('lastFocusedNormalWindow: no deprecated windowTypes in Firefox, and only normal windows', async () => {
  const queries = [];
  let win = { id: 7, type: 'normal' };
  const chromeMock = { windows: { getLastFocused: async (q) => { queries.push(q); return win; } } };
  assert.strictEqual((await lib.lastFocusedNormalWindow(chromeMock, true)).id, 7);
  assert.strictEqual((await lib.lastFocusedNormalWindow(chromeMock, false)).id, 7);
  assert.deepStrictEqual(queries, [{}, { windowTypes: ['normal'] }]);
  win = { id: 8, type: 'popup' };
  assert.strictEqual(await lib.lastFocusedNormalWindow(chromeMock, true), null);
  chromeMock.windows.getLastFocused = async () => { throw new Error('No last-focused window'); };
  assert.strictEqual(await lib.lastFocusedNormalWindow(chromeMock, true), null);
});

test('url, site and request helpers', () => {
  assert.strictEqual(lib.normalizeUrl('example.com/x'), 'https://example.com/x');
  assert.strictEqual(lib.normalizeUrl('http://a.b'), 'http://a.b');
  assert.strictEqual(lib.normalizeUrl('about:blank'), 'about:blank');
  assert.throws(() => lib.normalizeUrl(''), /missing URL/);
  assert.strictEqual(lib.normalizeSite('https://X.com/home?x'), 'x.com');
  assert.strictEqual(lib.normalizeSite('localhost:3000'), 'localhost');
  assert.ok(lib.hostMatchesSite('mobile.x.com', 'x.com'));
  assert.ok(!lib.hostMatchesSite('notx.com', 'x.com'));
  const entries = Array.from({ length: 60 }, (_, i) => ({ i, url: i % 2 ? `https://x.com/api/${i}` : `https://x.com/img/${i}` }));
  assert.strictEqual(lib.filterRequests(entries).length, 50);
  assert.strictEqual(lib.filterRequests(entries).at(-1).i, 59);
  assert.deepStrictEqual(lib.filterRequests(entries, { filter: 'api/5', limit: 3 }).map((e) => e.i), [55, 57, 59]);
  assert.deepStrictEqual(lib.filterRequests(entries, { limit: 0 }), []);
  assert.throws(() => lib.filterRequests(entries, { filter: '(' }), /invalid filter regex/);
  assert.deepStrictEqual([0, 1000, 2000, 16000, 30000].map(lib.nextBackoff), [1000, 2000, 4000, 30000, 30000]);
  assert.strictEqual(lib.chromeVersion('Mozilla/5.0 ... Chrome/156.0.0.0 Safari/537.36'), '156.0.0.0');
  assert.strictEqual(lib.chromeVersion('Mozilla/5.0 (Macintosh; rv:159.0) Gecko/20100101 Firefox/159.0'), '159.0');
  assert.strictEqual(lib.chromeVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15'), '27.2');
});

// ---- run ----------------------------------------------------------------------------------------

function makePage(hostname = 'x.com', extra = {}) {
  const listeners = {};
  const ctx = {
    location: { hostname, href: `https://${hostname}/` }, console: quietConsole, clearTimeout, URL, URLSearchParams,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (ms > 1000) t.unref(); return t; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    ...extra,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ctx.__listeners = listeners;
  return ctx;
}

async function runInPage(page, code, expression) {
  const out = await vm.runInContext(lib.buildRunCode(code, expression, 'run-1'), page);
  assert.strictEqual(typeof out, 'string');
  return lib.parseRunEnvelope(out);
}

test('run: expressions, function bodies, await, errors', async () => {
  const page = makePage();
  page.document = { title: 'Home' };
  assert.deepStrictEqual(await runInPage(page, 'document.title', true), { value: 'Home' });
  assert.deepStrictEqual(await runInPage(page, '({a: 1, b: undefined}) // trailing comment', true), { value: { a: 1, b: null } });
  assert.deepStrictEqual(await runInPage(page, 'const x = await Promise.resolve(2);\nreturn x * 21;', false), { value: 42 });
  assert.deepStrictEqual(await runInPage(page, 'let y = 1;', false), { value: null });
  await assert.rejects(runInPage(page, 'throw new TypeError("nope")', false), (e) => /TypeError: nope/.test(e.message) && /at /.test(e.message));
  await assert.rejects(runInPage(page, 'Promise.reject("plain")', true), /Uncaught plain/);
  assert.throws(() => vm.runInContext(lib.buildRunCode('(((', true, 'r'), page), (e) => e.name === 'SyntaxError');
});

test('run and page commands check the document they meet: a tab that went elsewhere since the check is refused', async () => {
  // buildRunCode's guard, run in the page: the page the code meets, not the one checked before.
  const page = makePage('evil.example.net');
  let out = await vm.runInContext(lib.buildRunCode('window.ran = 1', false, 'g1', { scope: 'example.com', sitesOn: ['example.com', 'evil.example.net'] }), page);
  assert.throws(() => lib.parseRunEnvelope(out), /went to evil\.example\.net before TRIF reached it, and this agent run is limited to example\.com/);
  assert.strictEqual(page.ran, undefined, 'the code never ran');
  out = await vm.runInContext(lib.buildRunCode('2', true, 'g2', { scope: null, sitesOn: ['example.com'] }), page);
  assert.throws(() => lib.parseRunEnvelope(out), /TRIF is off there/);
  const ok = makePage('www.example.com');
  out = await vm.runInContext(lib.buildRunCode('3', true, 'g3', { scope: 'example.com', sitesOn: ['example.com'] }), ok);
  assert.deepStrictEqual(lib.parseRunEnvelope(out), { value: 3 });
  // pageGuard (injected before the other page commands): marks the document only when it may act.
  const g = makePage('www.example.com');
  assert.strictEqual(vm.runInContext(`(${lib.pageGuard})('example.com', ['example.com'], 'tok')`, g), null);
  assert.strictEqual(g.__trifPageGuard, 'tok');
  const bad = makePage('evil.example.net');
  assert.match(vm.runInContext(`(${lib.pageGuard})('example.com', ['example.com'], 'tok')`, bad), /limited to example\.com/);
  assert.strictEqual(bad.__trifPageGuard, undefined);
});

test('run: the envelope is stored for polling and the poll code consumes it', async () => {
  const page = makePage();
  await vm.runInContext(lib.buildRunCode('7', true, 'abc'), page);
  const polled = vm.runInContext(lib.buildPollCode('abc'), page);
  assert.deepStrictEqual(lib.parseRunEnvelope(polled), { value: 7 });
  assert.strictEqual(vm.runInContext(lib.buildPollCode('abc'), page), null);
});

test('firstInjectionResult', () => {
  assert.strictEqual(lib.firstInjectionResult([{ result: '{"ok":true}' }]), '{"ok":true}');
  assert.strictEqual(lib.firstInjectionResult([{ result: {} }]), null);
  assert.throws(() => lib.firstInjectionResult([]), /not injected/);
  assert.throws(() => lib.firstInjectionResult([{ error: 'Cannot access a chrome:// URL' }]), /chrome:\/\//);
});

test('withTimeout', async () => {
  await assert.rejects(lib.withTimeout(new Promise(() => {}), 20, 'timed out after 20ms'), /timed out after 20ms/);
  assert.strictEqual(await lib.withTimeout(Promise.resolve(1), 20, 'x'), 1);
});

// ---- serializer ---------------------------------------------------------------------------------

test('safeStringify handles awkward values', () => {
  const s = (v, cap) => JSON.parse(rt.safeStringify(v, cap));
  assert.strictEqual(s(undefined), null);
  assert.deepStrictEqual(s([1, undefined, () => 1]), [1, null, '[Function anonymous]']);
  function named() {}
  assert.strictEqual(s(named), '[Function named]');
  const a = { name: 'a' }; a.self = a;
  assert.deepStrictEqual(s(a), { name: 'a', self: '[Circular]' });
  const shared = { v: 1 };
  assert.deepStrictEqual(s({ x: shared, y: shared }), { x: { v: 1 }, y: { v: 1 } });
  assert.deepStrictEqual(s(new Map([['k', new Set([1, 2])]])), [['k', [1, 2]]]);
  const err = s(new RangeError('bad'));
  assert.strictEqual(err.name, 'RangeError');
  assert.strictEqual(err.message, 'bad');
  assert.match(err.stack, /RangeError: bad/);
  assert.strictEqual(s(10n), '10n');
  assert.strictEqual(s(NaN), 'NaN');
  assert.strictEqual(s(new Date(0)), '1970-01-01T00:00:00.000Z');
  assert.deepStrictEqual(s({ get boom() { throw new Error('nope'); } }), { boom: '[Thrown: nope]' });
  const el = { nodeType: 1, nodeName: 'DIV', outerHTML: '<div>' + 'x'.repeat(3000) + '</div>' };
  assert.strictEqual(s(el).length, 2000);
  assert.strictEqual(s({ nodeType: 3, nodeName: '#text', textContent: 'hi' }), 'hi');
  const nodeList = { length: 1, 0: { nodeType: 1, nodeName: 'P', outerHTML: '<p></p>' }, item() {}, *[Symbol.iterator]() { yield this[0]; } };
  assert.deepStrictEqual(s(nodeList), ['<p></p>']);
  const win = { location: { href: 'https://x.com/' } }; win.window = win;
  assert.strictEqual(s(win), '[Window https://x.com/]');
  assert.deepStrictEqual(s(new Uint8Array([1, 2])), [1, 2]);
  assert.strictEqual(s(Promise.resolve()), '[Promise]');
  const big = s('y'.repeat(500), 100);
  assert.ok(big.startsWith('"yyy'));
  assert.match(big, /truncated: result was 502 chars/);
  const deep = {}; let cur = deep; for (let i = 0; i < 100; i++) cur = cur.next = {};
  assert.match(rt.safeStringify(deep), /Max depth/);
});

test('formatError', () => {
  assert.match(rt.formatError(new Error('m')), /^Error: m\n\s+at /);
  assert.strictEqual(rt.formatError({ name: 'X', message: 'y' }), 'X: y');
  assert.strictEqual(rt.formatError(5), 'Uncaught 5');
});

// ---- page runtime -------------------------------------------------------------------------------

function loadRuntime(page, recording = []) {
  vm.runInContext(rt.runtimeCode(recording), page);
  return page.__webmods;
}

const runMod = (page, id, code) => vm.runInContext(lib.wrapModCode(id, code), page);
// Values created in the vm realm have foreign prototypes; normalize before deepStrictEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('runtime: mod wrapper records top-level errors with the mod id', () => {
  const page = makePage();
  const W = loadRuntime(page);
  assert.deepStrictEqual([W.errors.length, W.logs.length, W.recording], [0, 0, false]);
  runMod(page, 'x.com/boom', 'throw new Error("kaboom")');
  runMod(page, 'x.com/fine', 'window.ran = true');
  assert.strictEqual(page.ran, true);
  assert.strictEqual(W.errors.length, 1);
  assert.strictEqual(W.errors[0].mod, 'x.com/boom');
  assert.strictEqual(W.errors[0].message, 'kaboom');
  assert.strictEqual(W.current, 'x.com/fine');
  // running the runtime twice keeps the first instance
  loadRuntime(page);
  assert.strictEqual(page.__webmods, W);
});

test('runtime: trif.log attributes sync logs and async logs (via the stack)', async () => {
  const page = makePage();
  const W = loadRuntime(page);
  runMod(page, 'x.com/a', 'trif.log("hello", {n: 1}); setTimeout(() => trif.warn("later"), 0);');
  runMod(page, 'x.com/b', 'trif.error("from b")');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(plain(W.logs.map((l) => [l.mod, l.level, l.args])), [
    ['x.com/a', 'log', ['hello', '{"n":1}']],
    ['x.com/b', 'error', ['from b']],
    ['x.com/a', 'warn', ['later']],
  ]);
  // with no mod frame on the stack, falls back to the current mod
  page.trif.log('outside');
  assert.strictEqual(W.logs.at(-1).mod, 'x.com/b');
  // Mods from before 0.2.0 call it window.webmods: the same object, still there.
  assert.strictEqual(page.webmods, page.trif);
  runMod(page, 'x.com/old', 'webmods.warn("old name")');
  assert.deepStrictEqual([W.logs.at(-1).mod, W.logs.at(-1).level], ['x.com/old', 'warn']);
});

test('runtime: window error / unhandledrejection events are attributed by stack', () => {
  const page = makePage();
  const W = loadRuntime(page);
  runMod(page, 'news.ycombinator.com/late', 'window.makeErr = () => new Error("late")');
  page.__listeners.error[0]({ error: page.makeErr(), filename: 'https://site/app.js' });
  page.__listeners.unhandledrejection[0]({ reason: page.makeErr() });
  page.__listeners.error[0]({ error: new Error('site error'), filename: 'https://site/app.js' });
  page.__listeners.error[0]({ error: null, message: 'Script error.', filename: 'webmods://x.com/z.js' });
  page.__listeners.error[0]({ error: null, message: 'Script error.', filename: 'trif://x.com/t.js' });
  assert.deepStrictEqual(plain(W.errors.map((e) => [e.mod, e.message])), [
    ['news.ycombinator.com/late', 'late'], ['news.ycombinator.com/late', 'late'], ['x.com/z', 'Script error.'], ['x.com/t', 'Script error.'],
  ]);
});

function fakeResponse(body, { status = 200, type = 'application/json' } = {}) {
  let used = false;
  return {
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    get bodyUsed() { return used; },
    async text() { if (used) throw new TypeError('body used'); used = true; return body; },
    clone() { return fakeResponse(body, { status, type }); },
  };
}

function makeXHRClass() {
  return class FakeXHR {
    constructor() { this.listeners = {}; this.responseType = ''; this.status = 0; this.responseText = ''; }
    open(m, u) { this.m = m; this.u = u; return 'opened'; }
    send(b) {
      this.sent = b;
      setTimeout(() => {
        this.status = 201;
        this.responseText = '{"saved":true}';
        for (const f of this.listeners.loadend || []) f();
      }, 0);
      return 'sent';
    }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    getResponseHeader() { return 'application/json; charset=utf-8'; }
  };
}

test('recorder: fetch is recorded without consuming the body or changing the promise', async () => {
  let lastPromise;
  const page = makePage('api.x.com', {
    fetch(input, init) {
      if (String(input).includes('fail')) return (lastPromise = Promise.reject(new TypeError('Failed to fetch')));
      const type = String(input).endsWith('.png') ? 'image/png' : 'application/json';
      return (lastPromise = Promise.resolve(fakeResponse(String(input).endsWith('.png') ? '\x89PNG' : '{"a":1}', { type })));
    },
  });
  const W = loadRuntime(page, ['x.com']);
  assert.strictEqual(W.recording, true);
  assert.notStrictEqual(page.fetch.name, '');

  const p = page.fetch('/api/data', { method: 'post', body: 'q=1' });
  assert.strictEqual(p, lastPromise);
  const res = await p;
  assert.strictEqual(await res.text(), '{"a":1}'); // original body still readable
  await page.fetch('https://cdn.x.com/i.png');
  await page.fetch('/u', { body: new Uint8Array([1]) });
  await assert.rejects(page.fetch('/fail'), /Failed to fetch/);
  await settle();

  const [data, img, bin, failed] = W.requests;
  assert.deepStrictEqual(
    { i: data.i, type: data.type, method: data.method, url: data.url, status: data.status, requestBody: data.requestBody, responseText: data.responseText, size: data.size },
    { i: 0, type: 'fetch', method: 'POST', url: 'https://api.x.com/api/data', status: 200, requestBody: 'q=1', responseText: '{"a":1}', size: 7 },
  );
  assert.strictEqual(img.status, 200);
  assert.match(img.responseText, /^\[binary/);
  assert.strictEqual(bin.requestBody, '[binary]');
  assert.strictEqual(failed.status, 0);
  assert.strictEqual(typeof data.time, 'number');
});

test('recorder: XHR behaviour is unchanged and requests are recorded', async () => {
  const XHR = makeXHRClass();
  const page = makePage('x.com', { XMLHttpRequest: XHR });
  const W = loadRuntime(page, ['x.com']);
  const xhr = new page.XMLHttpRequest();
  assert.ok(xhr instanceof XHR);
  assert.strictEqual(xhr.open('PUT', '/save'), 'opened');
  assert.strictEqual(xhr.send('{"x":1}'), 'sent');
  assert.strictEqual(xhr.sent, '{"x":1}');
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(W.requests.length, 1);
  const e = W.requests[0];
  assert.deepStrictEqual([e.type, e.method, e.url, e.status, e.requestBody, e.responseText], ['xhr', 'PUT', 'https://x.com/save', 201, '{"x":1}', '{"saved":true}']);
});

test('recorder: caps bodies, entries and the total kept; inactive on other hosts', async () => {
  const big = 'z'.repeat(2 * 1024 * 1024 + 1000);
  const page = makePage('x.com', { fetch: async () => fakeResponse(big, { type: 'text/plain' }) });
  const W = loadRuntime(page, ['x.com']);
  for (let i = 0; i < 305; i++) await page.fetch('/r' + i);
  await settle();
  assert.strictEqual(W.requests.length, 300);
  assert.strictEqual(W.requests[0].i, 5);
  const last = W.requests.at(-1);
  assert.ok(last.responseText.length < big.length);
  assert.match(last.responseText, /truncated/);
  assert.strictEqual(last.size, big.length);
  // 300 bodies of 2 MB is more than the recorder keeps: the oldest are dropped, their entries kept.
  const kept = W.requests.reduce((n, e) => n + (/^\[dropped/.test(e.responseText) ? 0 : e.responseText.length), 0);
  assert.ok(kept <= 32 * 1024 * 1024, `kept ${kept}`);
  assert.match(W.requests[0].responseText, /^\[dropped: the recorder keeps at most/);
  assert.strictEqual(W.requests[0].size, big.length);
  assert.ok(W.requests.filter((e) => !/^\[dropped/.test(e.responseText)).length >= 14);

  const origFetch = async () => fakeResponse('');
  const XHR = makeXHRClass();
  const openBefore = XHR.prototype.open;
  const other = makePage('notx.com', { fetch: origFetch, XMLHttpRequest: XHR });
  const W2 = loadRuntime(other, ['x.com']);
  assert.strictEqual(W2.recording, false);
  assert.strictEqual(other.fetch, origFetch);
  assert.strictEqual(XHR.prototype.open, openBefore);
});

// A Response whose body is a stream of `chunks` (or endless), counting what's read and whether the
// reader was cancelled.
function streamResponse({ type, chunk = 'x'.repeat(64 * 1024), chunks = Infinity }) {
  const stats = { reads: 0, cancelled: false, cloned: 0 };
  const make = () => ({
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    body: {
      getReader() {
        let n = 0;
        return {
          async read() { stats.reads++; return n++ < chunks ? { done: false, value: new TextEncoder().encode(chunk) } : { done: true }; },
          async cancel() { stats.cancelled = true; },
        };
      },
    },
    async text() { throw new Error('text() would buffer the whole stream'); },
    clone() { stats.cloned++; return make(); },
  });
  return { res: make(), stats };
}

test('recorder: reads streamed bodies only up to the cap, and leaves event streams alone', async () => {
  const endless = streamResponse({ type: 'application/x-ndjson' });
  const sse = streamResponse({ type: 'text/event-stream; charset=utf-8' });
  const small = streamResponse({ type: 'application/json', chunk: '{"ü":1}', chunks: 2 });
  const responses = { '/feed': endless.res, '/events': sse.res, '/small': small.res };
  const page = makePage('x.com', { fetch: async (u) => responses[u], TextDecoder, TextEncoder });
  const W = loadRuntime(page, ['x.com']);
  for (const u of Object.keys(responses)) await page.fetch(u);
  await settle(50);

  const [feed, events, json] = W.requests;
  assert.strictEqual(endless.stats.cancelled, true, 'stopped reading the endless stream');
  assert.ok(endless.stats.reads <= 2 * 1024 * 1024 / (64 * 1024) + 1, `${endless.stats.reads} reads`);
  assert.strictEqual(feed.responseText.indexOf('\n…[truncated'), 2 * 1024 * 1024, 'the first 2 MB kept');
  assert.match(feed.responseText, /\[truncated: longer than 2097152 bytes\]$/);
  assert.strictEqual(feed.size, null);

  assert.strictEqual(sse.stats.cloned, 0, 'an event stream is never cloned or read');
  assert.match(events.responseText, /^\[stream: text\/event-stream/);
  assert.strictEqual(events.status, 200);

  assert.strictEqual(json.responseText, '{"ü":1}{"ü":1}');
  assert.strictEqual(small.stats.cancelled, false);
});

// ---- match patterns -----------------------------------------------------------------------------

test('matchesPattern follows Chrome match-pattern rules', () => {
  const yes = (p, u) => assert.ok(lib.matchesPattern(p, u), `${p} should match ${u}`);
  const no = (p, u) => assert.ok(!lib.matchesPattern(p, u), `${p} should not match ${u}`);
  // scheme: * is http or https only
  yes('*://x.com/*', 'https://x.com/home');
  yes('*://x.com/*', 'http://x.com/');
  no('*://x.com/*', 'ftp://x.com/');
  no('*://x.com/*', 'file:///x.com/');
  yes('https://x.com/*', 'https://x.com/a');
  no('https://x.com/*', 'http://x.com/a');
  // host: exact, *.domain (domain itself and subdomains), *
  no('*://x.com/*', 'https://www.x.com/');
  no('*://x.com/*', 'https://notx.com/');
  yes('*://*.x.com/*', 'https://x.com/');
  yes('*://*.x.com/*', 'https://mobile.api.x.com/');
  no('*://*.x.com/*', 'https://notx.com/');
  yes('*://*/*', 'https://anything.example/');
  yes('https://X.COM/*', 'https://x.com/');
  // path glob, matched against path + query; fragments ignored
  yes('*://x.com/*/status/*', 'https://x.com/jack/status/20');
  no('*://x.com/*/status/*', 'https://x.com/jack');
  yes('*://x.com/settings*', 'https://x.com/settings/account');
  no('*://x.com/settings*', 'https://x.com/home?next=/settings');
  yes('*://x.com/search?q=*', 'https://x.com/search?q=cats');
  yes('*://x.com/', 'https://x.com/#frag');
  no('*://x.com/', 'https://x.com/home');
  yes('*://x.com/a*b*b', 'https://x.com/abb');
  no('*://x.com/a*b*c', 'https://x.com/acb');
  // ports: none in the pattern = any port
  yes('http://localhost/*', 'http://localhost:3000/app');
  yes('http://localhost:3000/*', 'http://localhost:3000/');
  no('http://localhost:3000/*', 'http://localhost:4000/');
  yes('https://x.com:443/*', 'https://x.com/');
  yes('http://localhost:*/*', 'http://localhost:8080/');
  yes('http://[::1]/*', 'http://[::1]:8000/');
  // <all_urls>, file
  yes('<all_urls>', 'https://x.com/');
  yes('<all_urls>', 'file:///Users/me/a.html');
  no('<all_urls>', 'chrome://extensions/');
  no('<all_urls>', 'chrome-extension://abc/page.html');
  yes('file:///Users/*', 'file:///Users/me/a.html');
  // invalid patterns and URLs never match
  no('x.com', 'https://x.com/');
  no('*://x.com', 'https://x.com/');
  no('*://x*.com/*', 'https://xy.com/');
  no('*://x.com/*', 'not a url');
  no(undefined, 'https://x.com/');
});

test('modAppliesTo honours matches and excludes', () => {
  const m = { matches: ['*://x.com/*', '*://twitter.com/*'], excludes: ['*://x.com/settings*'] };
  assert.ok(lib.modAppliesTo(m, 'https://x.com/home'));
  assert.ok(lib.modAppliesTo(m, 'https://twitter.com/home'));
  assert.ok(!lib.modAppliesTo(m, 'https://x.com/settings/privacy'));
  assert.ok(!lib.modAppliesTo(m, 'https://example.com/'));
  assert.ok(!lib.modAppliesTo({}, 'https://x.com/'));
});

test('siteForUrl and toolLine', () => {
  assert.strictEqual(lib.siteForUrl('https://www.x.com/home'), 'x.com');
  assert.strictEqual(lib.siteForUrl('https://News.YCombinator.com/'), 'news.ycombinator.com');
  assert.strictEqual(lib.siteForUrl('http://localhost:3000/'), 'localhost');
  assert.strictEqual(lib.siteForUrl('chrome://newtab/'), null);
  assert.strictEqual(lib.siteForUrl('file:///a.html'), null);
  assert.strictEqual(lib.siteForUrl(''), null);
  assert.strictEqual(lib.toolLine('Bash', 'trif reload --tab 12'), 'ran trif reload --tab 12');
  assert.strictEqual(lib.toolLine('Edit', 'sites/x.com/hide-reposts.js'), 'edited sites/x.com/hide-reposts.js');
  assert.strictEqual(lib.toolLine('TodoWrite', ''), 'TodoWrite');
  assert.strictEqual(lib.toolLine('Bash', 'a\n  b'), 'ran a b');
});

test('isLoginUrl: only https sign-in pages on claude.com, claude.ai, anthropic.com and their subdomains', () => {
  for (const ok of [
    'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y',
    'https://claude.ai/oauth/authorize', 'https://console.anthropic.com/login', 'https://platform.claude.com/oauth/code/callback',
    'https://CLAUDE.AI/x', 'https://a.b.anthropic.com/',
  ]) assert.ok(lib.isLoginUrl(ok), ok);
  for (const bad of [
    'http://claude.com/cai/oauth/authorize', 'https://claude.com.evil.com/', 'https://evilclaude.com/', 'https://notanthropic.com/',
    'https://evil.com/?r=https://claude.com/', 'https://claude.com@evil.com/', 'https://user:pw@claude.com/', 'https://claude.com:8443/',
    'javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'claude.com/cai', '', null, undefined, 42,
  ]) assert.ok(!lib.isLoginUrl(bad), String(bad));
});

// ---- markdown -----------------------------------------------------------------------------------

test('markdown: escapes everything before formatting', async () => {
  const { renderMarkdown, escapeHtml } = await import('../extension/markdown.js');
  assert.strictEqual(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  const evil = renderMarkdown('<script>alert(1)</script> <img src=x onerror="alert(1)"> **<b>bold</b>**');
  assert.ok(!/<script|<img|<b>/i.test(evil), evil);
  assert.match(evil, /&lt;script&gt;/);
  assert.match(evil, /<strong>&lt;b&gt;bold&lt;\/b&gt;<\/strong>/);
  // code spans and blocks stay literal
  assert.strictEqual(renderMarkdown('use `<div onclick=x>` here'), '<p>use <code>&lt;div onclick=x&gt;</code> here</p>');
  assert.strictEqual(renderMarkdown('Usage\n\n| Category | Tokens |\n|----------|--------|\n| **System** | 3.4k |\n| <b>x</b> | 1 |\n\nafter'),
    '<p>Usage</p><table><thead><tr><th>Category</th><th>Tokens</th></tr></thead><tbody><tr><td><strong>System</strong></td><td>3.4k</td></tr>' +
    '<tr><td>&lt;b&gt;x&lt;/b&gt;</td><td>1</td></tr></tbody></table><p>after</p>');
  assert.strictEqual(renderMarkdown('| not a table |'), '<p>| not a table |</p>', 'a row without a separator stays text');
  assert.strictEqual(renderMarkdown('```html\n<p>**not bold**</p>\n```'), '<pre><code>&lt;p&gt;**not bold**&lt;/p&gt;</code></pre>');
  assert.strictEqual(renderMarkdown('```\nunclosed <x>'), '<pre><code>unclosed &lt;x&gt;</code></pre>');
  // only http(s)/mailto links; quotes can't break out of href
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('<a'));
  assert.ok(!renderMarkdown('[x](data:text/html,hi)').includes('<a'));
  const q = renderMarkdown('[x](https://e.com/"onmouseover="alert(1))');
  assert.ok(!/onmouseover="/.test(q) && !/<a [^>]*"alert/.test(q), q);
  assert.match(q, /<a href="https:\/\/e\.com\/" target="_blank" rel="noopener noreferrer">/);
  assert.strictEqual(
    renderMarkdown('see [the docs](https://e.com/a?b=1&c=2).'),
    '<p>see <a href="https://e.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">the docs</a>.</p>',
  );
  assert.strictEqual(
    renderMarkdown('go to https://e.com/x.'),
    '<p>go to <a href="https://e.com/x" target="_blank" rel="noopener noreferrer">https://e.com/x</a>.</p>',
  );
  // placeholder characters in the input can't forge saved fragments
  assert.ok(!renderMarkdown('\u00010\u0002 `a`').startsWith('<p><code>'));
});

test('markdown: paragraphs, lists, headings, emphasis', async () => {
  const { renderMarkdown } = await import('../extension/markdown.js');
  assert.strictEqual(renderMarkdown('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  assert.strictEqual(renderMarkdown('- a\n- **b**\n  more\n\n1. x\n2. y'),
    '<ul><li>a</li><li><strong>b</strong><br>more</li></ul><ol><li>x</li><li>y</li></ol>');
  assert.strictEqual(renderMarkdown('3. c'), '<ol start="3"><li>c</li></ol>');
  assert.strictEqual(renderMarkdown('## Done'), '<h4>Done</h4>');
  assert.strictEqual(renderMarkdown('*it* and 2*3*4'), '<p><em>it</em> and 2*3*4</p>');
  assert.strictEqual(renderMarkdown('> note'), '<blockquote>note</blockquote>');
  assert.strictEqual(renderMarkdown(''), '');
});

// ---- background: side panel relay ---------------------------------------------------------------

function chromeEvent() {
  const fns = [];
  return {
    fns,
    addListener: (f) => fns.push(f),
    removeListener: (f) => { const i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); },
    emit: (...a) => fns.map((f) => f(...a)),
  };
}

function mockPort(name) {
  const port = { name, sent: [], onMessage: chromeEvent(), onDisconnect: chromeEvent() };
  port.postMessage = (m) => { if (port.closed) throw new Error('Attempting to use a disconnected port object'); port.sent.push(structuredClone(m)); };
  port.disconnect = () => { port.closed = true; };
  return port;
}

let bgCount = 0;
// TRIF is on for the test sites unless a test says otherwise (storage.sitesOn), or migrate: true
// leaves sitesOn out, as for someone updating from before sites had to be turned on.
const TEST_SITES_ON = ['example.com', 'x.com', 'y.com', 'z.com'];
// `granted`: the origins the browser gives TRIF (chrome.permissions); <all_urls> unless a test says
// otherwise, as for someone who installed TRIF when it was required. `permissions: false` leaves the API out.
async function loadBackground({ storage = {}, tabs = [], migrate = false, safari = false, windows = {}, scripting = {}, granted = ['<all_urls>'], permissions = true } = {}) {
  const store = structuredClone(migrate || 'sitesOn' in storage ? storage : { sitesOn: TEST_SITES_ON, ...storage });
  const ctl = { full: false, io: false, writes: [] }; // full: every storage write fails, like a full quota; io: like Safari's "Disk I/O error"; writes: the keys of each write
  const natives = [];
  const panelBehavior = [];
  const created = [];
  const reloaded = [];
  const onUpdated = chromeEvent();
  const panelCalls = [];
  const perms = {
    origins: [...granted], removed: [],
    onAdded: chromeEvent(), onRemoved: chromeEvent(),
    async getAll() { return { origins: [...perms.origins], permissions: [] }; },
    async remove({ origins = [] }) { perms.removed.push(origins); perms.origins = perms.origins.filter((o) => !origins.includes(o)); return true; },
    /** As the user allowing (or the settings page taking back) origins: the list changes, then the event. */
    grant(origins) { perms.origins = [...new Set([...perms.origins, ...origins])]; perms.onAdded.emit({ origins }); },
    revoke(origins) { perms.origins = perms.origins.filter((o) => !origins.includes(o)); perms.onRemoved.emit({ origins }); },
  };
  const chromeMock = {
    runtime: {
      id: lib.EXTENSION_ID, lastError: undefined,
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (p) => (safari ? `safari-web-extension://ABC-123/${p}` : `chrome-extension://${lib.EXTENSION_ID}/${p}`),
      onStartup: chromeEvent(), onInstalled: chromeEvent(), onMessage: chromeEvent(), onConnect: chromeEvent(),
      connectNative: () => { const p = mockPort('native'); natives.push(p); return p; },
    },
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return structuredClone(store);
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = structuredClone(store[k]);
          return out;
        },
        async set(obj) {
          if (ctl.full) throw new Error('QUOTA_BYTES quota exceeded');
          if (ctl.io) throw new Error('Disk I/O error');
          ctl.writes.push(Object.keys(obj));
          Object.assign(store, structuredClone(obj));
        },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
    userScripts: mockUserScripts(),
    tabs: {
      query: async () => structuredClone(tabs), create: async (o) => { created.push(o); return { id: 99, ...o }; },
      update: async () => ({}), get: async (id) => structuredClone(tabs.find((t) => t.id === id) || {}), onUpdated,
      reload: async (id) => { reloaded.push(id); setImmediate(() => onUpdated.emit(id, { status: 'complete' })); },
    },
    windows: { update: async () => ({}), getLastFocused: async () => ({ id: 1 }), ...windows },
    sidePanel: {
      setPanelBehavior: async (o) => { panelBehavior.push(o); },
      open: (o) => { panelCalls.push(['open', o]); return Promise.resolve(); },
      close: (o) => { panelCalls.push(['close', o]); return Promise.resolve(); },
    },
    scripting,
    action: { onClicked: chromeEvent() },
    ...(permissions ? { permissions: perms } : {}),
  };
  globalThis.chrome = chromeMock;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Chrome/156.0.0.0' }, configurable: true, writable: true });
  const realConsole = { warn: console.warn, error: console.error, log: console.log };
  Object.assign(console, quietConsole);
  await import(`../extension/background.js?instance=${++bgCount}`);
  await settle(20);
  const native = natives[0];
  native.emit = (m) => native.onMessage.emit(m);
  const connectPanel = () => {
    const p = mockPort('panel');
    p.sender = { id: lib.EXTENSION_ID, url: `chrome-extension://${lib.EXTENSION_ID}/sidepanel.html` };
    chromeMock.runtime.onConnect.emit(p);
    p.ask = async (msg) => {
      const reqId = Math.random();
      p.onMessage.emit({ ...msg, reqId });
      for (let i = 0; i < 200; i++) {
        const r = p.sent.find((m) => m.type === 'reply' && m.reqId === reqId);
        if (r) return r;
        await tick();
      }
      throw new Error(`no reply to ${msg.type}`);
    };
    return p;
  };
  const restore = () => Object.assign(console, realConsole);
  /** Send a native request like the helper does for a CLI page command; resolves the response. */
  native.call = async (cmd, args = {}) => {
    const id = `h-${Math.random()}`;
    native.emit({ type: 'request', id, cmd, args });
    for (let i = 0; i < 400; i++) {
      const r = native.sent.find((m) => m.type === 'response' && m.id === id);
      if (r) return r;
      await tick();
    }
    throw new Error(`no response to ${cmd}`);
  };
  return { chrome: chromeMock, store, ctl, natives, native, connectPanel, panelBehavior, panelCalls, perms, created, reloaded, restore };
}

/** Answer the extension's next native request for `cmd` like the helper would. */
async function answerNative(native, cmd, result, ok = true) {
  let req;
  for (let i = 0; i < 200 && !(req = native.sent.find((m) => m.type === 'request' && m.cmd === cmd && !m.answered)); i++) await tick();
  assert.ok(req, `expected a native ${cmd} request`);
  req.answered = true;
  native.emit(ok ? { type: 'response', id: req.id, ok: true, result } : { type: 'response', id: req.id, ok: false, error: result });
  return req;
}

test('background: copy windows a screenshot left open (crash, restart) are closed on start, found by id or by URL and bounds', async () => {
  const removed = [];
  const bounds = { left: 780, top: 25, width: 1200, height: 860 };
  const wins = [
    { id: 3, ...bounds, tabs: [{ url: 'https://example.com/page' }] }, // restored after a restart: a new id
    { id: 7, left: 0, top: 0, width: 800, height: 600, tabs: [{ url: 'https://mail.example.com/' }] }, // the user's, with the old id
  ];
  const bg = await loadBackground({
    storage: { copyWindows: [{ id: 7, urls: ['https://example.com/page'], bounds, at: Date.now() - 5000 }, { id: 9, urls: ['https://old/'], bounds, at: Date.now() - 2 * 86400000 }] },
    windows: { getAll: async () => structuredClone(wins), remove: async (id) => { removed.push(id); } },
  });
  try {
    await waitFor(() => removed.length === 1 && !('copyWindows' in bg.store));
    assert.deepStrictEqual(removed, [3], 'the copy window, not the user\'s window that now has its old id');
  } finally { bg.restore(); }
});

test('background: a page command whose tab went to another page between the check and the reading gets no result', async () => {
  const tabs = [{ id: 5, windowId: 1, active: true, url: 'https://example.com/a' }];
  let navigated = false;
  let navigate = true;
  const calls = [];
  const executeScript = async ({ func }) => {
    calls.push(func.name || 'anonymous');
    if (func.name === 'pageGuard') return [{ result: null }];
    if (/__trifPageGuard === t/.test(String(func))) return [{ result: !navigated }];
    navigated = navigate; // the page navigates while the command reads it
    return [{ result: { url: 'https://example.com/a', text: 'page text' } }];
  };
  const bg = await loadBackground({ tabs, scripting: { executeScript } });
  try {
    const r = await bg.native.call('text', { tab: 5, scope: 'example.com' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /went to another page while TRIF was working in it/);
    assert.strictEqual(calls[0], 'pageGuard');
    navigated = false;
    navigate = false;
    const again = await bg.native.call('text', { tab: 5, scope: 'example.com' });
    assert.strictEqual(again.ok, true, again.error);
    assert.strictEqual(again.result.text, 'page text');
  } finally { bg.restore(); }
});

test('background: sweep --scroll is refused on the tab the user is looking at, unless forced', async () => {
  const tabs = [{ id: 5, windowId: 1, active: true, url: 'https://example.com/a' }, { id: 6, windowId: 1, active: false, url: 'https://example.com/b' }];
  const bg = await loadBackground({ tabs, windows: { get: async () => ({ id: 1, focused: true, state: 'normal' }) } });
  try {
    let r = await bg.native.call('sweep', { tab: 5, selector: 'a', scroll: true });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /--scroll scrolls the tab itself.*the tab the user is looking at.*--force/);
    for (const args of [{ tab: 5, selector: 'a', scroll: true, force: true }, { tab: 6, selector: 'a', scroll: true }, { tab: 5, selector: 'a' }]) {
      r = await bg.native.call('sweep', args);
      assert.doesNotMatch(String(r.error || ''), /--scroll/, JSON.stringify(args));
    }
  } finally { bg.restore(); }
});

test('background: trif reload right after new mods waits for them to be registered, so they run on that load', async () => {
  const tabs = [{ id: 5, windowId: 1, active: true, url: 'https://x.com/home' }];
  const bg = await loadBackground({ tabs });
  try {
    const registeredAtReload = [];
    const reload = bg.chrome.tabs.reload;
    bg.chrome.tabs.reload = async (id, o) => { registeredAtReload.push(bg.chrome.userScripts.scripts.map((x) => x.id)); return reload(id, o); };
    // The helper sends the mods, then (an agent's `trif reload`) the reload, back to back.
    bg.native.emit({ type: 'mods', mods: [mod('x.com/fresh')] });
    const r = await bg.native.call('reload', { tab: 5 });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(registeredAtReload.length, 1);
    assert.ok(registeredAtReload[0].some((id) => id.includes('x.com/fresh')), `registered at the reload: ${registeredAtReload[0]}`);
  } finally { bg.restore(); }
});

test('background: install opens onboarding; the toolbar button opens the side panel itself (for activeTab), and closes it', async () => {
  const bg = await loadBackground();
  try {
    bg.chrome.runtime.onInstalled.emit({ reason: 'install' });
    await settle(10);
    assert.deepStrictEqual(bg.panelBehavior.at(-1), { openPanelOnActionClick: false });
    assert.strictEqual(bg.created.at(-1).url, `chrome-extension://${lib.EXTENSION_ID}/onboarding.html`);
    bg.chrome.runtime.onInstalled.emit({ reason: 'update' });
    await settle(10);
    assert.strictEqual(bg.created.length, 1);
    bg.chrome.runtime.onStartup.emit();
    assert.strictEqual(bg.panelBehavior.length, 3);
    assert.strictEqual(bg.chrome.action.onClicked.fns.length, 1);
    // Opened from the click, synchronously (it must come from the user's gesture).
    bg.chrome.action.onClicked.emit({ id: 5, windowId: 2 });
    assert.deepStrictEqual(bg.panelCalls, [['open', { windowId: 2 }]]);
    // A side panel in window 2 says so; the next click there closes it; another window's opens.
    const panel = bg.connectPanel();
    panel.onMessage.emit({ type: 'panel.window', windowId: 2 });
    bg.chrome.action.onClicked.emit({ id: 5, windowId: 2 });
    bg.chrome.action.onClicked.emit({ id: 8, windowId: 3 });
    assert.deepStrictEqual(bg.panelCalls.slice(1), [['close', { windowId: 2 }], ['open', { windowId: 3 }]]);
    panel.onDisconnect.emit();
    bg.chrome.action.onClicked.emit({ id: 5, windowId: 2 });
    assert.deepStrictEqual(bg.panelCalls.at(-1), ['open', { windowId: 2 }]);
  } finally { bg.restore(); }
});

test('background: panel status includes helper state and mods with match patterns', async () => {
  const mods = [mod('x.com/detox-timeline', { name: 'Detox Timeline', matches: ['*://x.com/*'], excludes: ['*://x.com/settings*'] })];
  const bg = await loadBackground({ storage: { mods } });
  try {
    const panel = bg.connectPanel();
    let r = await panel.ask({ type: 'status' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.result.helper.connected, false);
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    assert.ok(panel.sent.some((m) => m.type === 'statusChanged'));
    r = await panel.ask({ type: 'status' });
    assert.strictEqual(r.result.helper.connected, true);
    assert.strictEqual(r.result.userScripts, true);
    const [m] = r.result.mods;
    assert.deepStrictEqual([m.id, m.name, m.file, m.matches, m.excludes, m.registered],
      ['x.com/detox-timeline', 'Detox Timeline', '/w/sites/x.com/detox-timeline.js', ['*://x.com/*'], ['*://x.com/settings*'], true]);
    assert.deepStrictEqual(r.result.runs, []);
  } finally { bg.restore(); }
});

test('background: Pause all mods registers nothing (each switch kept); resuming brings them back', async () => {
  const mods = [mod('x.com/a', { matches: ['*://x.com/*'] })];
  const bg = await loadBackground({ storage: { mods, sitesOn: ['x.com'] } });
  try {
    const panel = bg.connectPanel();
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    let r = await panel.ask({ type: 'status' });
    assert.strictEqual(r.result.mods[0].registered, true);
    assert.strictEqual(r.result.paused, false);
    await panel.ask({ type: 'mods.pause', paused: true });
    r = await panel.ask({ type: 'status' });
    assert.deepStrictEqual([r.result.paused, r.result.mods[0].registered, r.result.mods[0].enabled], [true, false, true]);
    assert.strictEqual(bg.store.paused, true);
    await panel.ask({ type: 'mods.pause', paused: false });
    r = await panel.ask({ type: 'status' });
    assert.deepStrictEqual([r.result.paused, r.result.mods[0].registered], [false, true]);
  } finally { bg.restore(); }
});

test('background: a group switched off on a site (panel) is kept, shown in status, and its mods leave that site', async () => {
  const mods = [mod('x.com/page'), mod('x.com/calm', { rules: true })];
  const bg = await loadBackground({ storage: { mods, sitesOn: ['x.com'] } });
  try {
    const panel = bg.connectPanel();
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    let r = await panel.ask({ type: 'mods.group', site: 'x.com', group: 'page', enabled: false });
    assert.deepStrictEqual(r.result.groupsOff, { 'x.com': ['page'] });
    assert.deepStrictEqual(bg.store.groupsOff, { 'x.com': ['page'] });
    r = await panel.ask({ type: 'status' });
    assert.deepStrictEqual(r.result.groupsOff, { 'x.com': ['page'] });
    assert.deepStrictEqual(r.result.mods.map((m) => [m.id, m.rules, m.enabled]), [['x.com/page', false, true], ['x.com/calm', true, true]]);
    await panel.ask({ type: 'mods.group', site: 'x.com', group: 'page', enabled: true });
    r = await panel.ask({ type: 'status' });
    assert.deepStrictEqual(r.result.groupsOff, {});
  } finally { bg.restore(); }
});

test('background: agent.start becomes a native request; agentEvents reach panels and the chat', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const other = bg.connectPanel();
    const replyP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 12, url: 'https://x.com/home', prompt: 'hide reposts', agent: 'claude', model: 'opus' });
    const req = await answerNative(bg.native, 'agent.start', { runId: 'r1' });
    assert.deepStrictEqual(req.args, { site: 'x.com', url: 'https://x.com/home', tabId: 12, prompt: 'hide reposts', agent: 'claude', model: 'opus' });
    assert.match(req.id, /^ext-/);
    const reply = await replyP;
    assert.deepStrictEqual([reply.ok, reply.result], [true, { runId: 'r1' }]);
    await settle(10);
    assert.deepStrictEqual(bg.store['chat:x.com'].run.runId, 'r1');
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.map((m) => [m.role, m.text]), [['user', 'hide reposts']]);

    const events = [
      { kind: 'session', sessionId: 's-1' },
      { kind: 'tool', name: 'Bash', summary: 'trif reload --tab 12' },
      { kind: 'tool', name: 'Edit', summary: 'sites/x.com/hide-reposts.js' },
      { kind: 'text', text: 'Done: reposts are hidden.' },
      { kind: 'done', ok: true, result: 'Done: reposts are hidden.', costUsd: 0.12, changedFiles: ['sites/x.com/hide-reposts.js'], sessionId: 's-1' },
    ];
    for (const event of events) bg.native.emit({ type: 'agentEvent', runId: 'r1', event });
    await settle(30);
    for (const p of [panel, other]) {
      assert.deepStrictEqual(p.sent.filter((m) => m.type === 'agentEvent').map((m) => [m.runId, m.event.kind]),
        events.map((e) => ['r1', e.kind]));
    }
    const chat = bg.store['chat:x.com'];
    assert.deepStrictEqual(chat.messages.map((m) => [m.role, m.text]), [
      ['user', 'hide reposts'], ['tool', 'ran trif reload --tab 12'], ['tool', 'edited sites/x.com/hide-reposts.js'],
      ['assistant', 'Done: reposts are hidden.'],
    ]);
    assert.strictEqual(chat.sessionId, 's-1');
    assert.strictEqual(chat.agent, 'claude');
    assert.strictEqual(chat.run, null);
    assert.deepStrictEqual([chat.last.ok, chat.last.changedFiles, chat.last.costUsd], [true, ['sites/x.com/hide-reposts.js'], 0.12]);

    // the next message resumes the session
    const second = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 12, url: 'https://x.com/home', prompt: 'also likes', sessionId: 's-1', agent: 'claude' });
    const req2 = await answerNative(bg.native, 'agent.start', { runId: 'r2' });
    assert.strictEqual(req2.args.sessionId, 's-1');
    await second;
    // stop → native agent.stop; done without error → a muted "stopped" line
    const stopP = panel.ask({ type: 'agent.stop', runId: 'r2' });
    const stopReq = await answerNative(bg.native, 'agent.stop', { stopped: true });
    assert.deepStrictEqual(stopReq.args, { runId: 'r2' });
    assert.deepStrictEqual((await stopP).result, { stopped: true });
    bg.native.emit({ type: 'agentEvent', runId: 'r2', event: { kind: 'done', ok: false, result: '', changedFiles: [] } });
    await settle(20);
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.slice(-2).map((m) => [m.role, m.text]), [['user', 'also likes'], ['tool', 'stopped']]);
  } finally { bg.restore(); }
});

test('background: a run that needs a login leaves one plain line in the chat, not an error; the message stays', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 12, url: 'https://x.com/home', prompt: 'hide reposts', agent: 'claude', sessionId: 's-0' });
    await answerNative(bg.native, 'agent.start', { runId: 'r1' });
    await startP;
    await settle(10);
    const message = 'Claude Code needs you to log in again.';
    for (const event of [
      { kind: 'session', sessionId: 's-0' },
      { kind: 'error', reason: 'login', message, agent: 'claude' },
      { kind: 'done', ok: false, result: 'Failed to authenticate: OAuth session expired and could not be refreshed', costUsd: 0, changedFiles: [], sessionId: 's-0', error: { kind: 'login', agent: 'claude', message } },
    ]) bg.native.emit({ type: 'agentEvent', runId: 'r1', event });
    await settle(30);
    let chat = bg.store['chat:x.com'];
    assert.deepStrictEqual(chat.messages.map((m) => [m.role, m.text]), [['user', 'hide reposts'], ['login', message]]);
    assert.strictEqual(chat.run, null);
    assert.strictEqual(chat.sessionId, 's-0');
    assert.strictEqual(panel.sent.filter((m) => m.type === 'agentEvent').at(-1).event.error.kind, 'login', 'the panel gets the kind');

    // A done saying so without the error event first (it's the done that counts): the same one line.
    const againP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 12, url: 'https://x.com/home', prompt: 'again', agent: 'claude' });
    await answerNative(bg.native, 'agent.start', { runId: 'r2' });
    await againP;
    bg.native.emit({ type: 'agentEvent', runId: 'r2', event: { kind: 'done', ok: false, result: null, changedFiles: [], sessionId: null, error: { kind: 'login', agent: 'claude', message } } });
    await settle(30);
    chat = bg.store['chat:x.com'];
    assert.deepStrictEqual(chat.messages.slice(2).map((m) => [m.role, m.text]), [['user', 'again'], ['login', message]]);
  } finally { bg.restore(); }
});

test('background: agent.list is forwarded; failures are replied and recorded', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const listP = panel.ask({ type: 'agent.list' });
    await answerNative(bg.native, 'agent.list', { agents: [{ id: 'claude', name: 'Claude Code', available: true }], default: 'claude' });
    assert.strictEqual((await listP).result.default, 'claude');

    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'hi' });
    await answerNative(bg.native, 'agent.start', 'already working on x.com', false);
    const r = await startP;
    assert.deepStrictEqual([r.ok, r.error], [false, 'already working on x.com']);
    await settle(10);
    const chat = bg.store['chat:x.com'];
    assert.deepStrictEqual(chat.messages.map((m) => [m.role, m.text]), [['user', 'hi'], ['error', 'already working on x.com']]);
    assert.strictEqual(chat.run, null);
  } finally { bg.restore(); }
});

test('background: helper disconnect mid-run synthesizes error then done for the panel', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'go' });
    await answerNative(bg.native, 'agent.start', { runId: 'r9' });
    await startP;
    bg.native.emit({ type: 'agentEvent', runId: 'r9', event: { kind: 'text', text: 'Looking…' } });
    const pendingList = panel.ask({ type: 'agent.list' });
    await settle(10);
    bg.native.onDisconnect.emit();
    const list = await pendingList;
    assert.strictEqual(list.ok, false);
    assert.match(list.error, /disconnected/);
    await settle(20);
    const evs = panel.sent.filter((m) => m.type === 'agentEvent' && m.runId === 'r9').map((m) => m.event);
    assert.deepStrictEqual(evs.map((e) => e.kind), ['text', 'error', 'done']);
    assert.match(evs[1].message, /disconnected/);
    assert.strictEqual(evs[2].ok, false);
    const chat = bg.store['chat:x.com'];
    assert.strictEqual(chat.run, null);
    assert.deepStrictEqual(chat.messages.map((m) => m.role), ['user', 'assistant', 'error']);
    // not connected: start fails without reaching a helper
    const r = await panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'again' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /timsrobot setup/);
  } finally { bg.restore(); }
});

test('background: New chat clears the record and drops later events of the old run', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'go' });
    await answerNative(bg.native, 'agent.start', { runId: 'r5' });
    await startP;
    const clearP = panel.ask({ type: 'chat.clear', site: 'x.com' });
    await answerNative(bg.native, 'agent.stop', { stopped: true });
    assert.strictEqual((await clearP).ok, true);
    assert.ok(!('chat:x.com' in bg.store));
    bg.native.emit({ type: 'agentEvent', runId: 'r5', event: { kind: 'text', text: 'late' } });
    bg.native.emit({ type: 'agentEvent', runId: 'r5', event: { kind: 'done', ok: false } });
    await settle(20);
    assert.ok(!('chat:x.com' in bg.store));
    assert.strictEqual(panel.sent.filter((m) => m.type === 'agentEvent').length, 2);
  } finally { bg.restore(); }
});

test('background: agent.login / loginCode / loginCancel are relayed; login events reach panels but not the chat', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const loginP = panel.ask({ type: 'agent.login', agent: 'claude' });
    const req = await answerNative(bg.native, 'agent.login', { loginId: 'l1' });
    assert.deepStrictEqual(req.args, { agent: 'claude' });
    assert.deepStrictEqual((await loginP).result, { loginId: 'l1' });

    const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s';
    bg.native.emit({ type: 'agentEvent', runId: 'l1', event: { kind: 'login', url } });
    await settle(10);
    assert.deepStrictEqual(panel.sent.filter((m) => m.type === 'agentEvent').map((m) => [m.runId, m.event]), [['l1', { kind: 'login', url }]]);

    const codeP = panel.ask({ type: 'agent.loginCode', loginId: 'l1', code: 'abc#def' });
    const codeReq = await answerNative(bg.native, 'agent.loginCode', { sent: true });
    assert.deepStrictEqual(codeReq.args, { loginId: 'l1', code: 'abc#def' });
    assert.deepStrictEqual((await codeP).result, { sent: true });
    bg.native.emit({ type: 'agentEvent', runId: 'l1', event: { kind: 'done', ok: true, login: true } });
    await settle(10);
    assert.deepStrictEqual(panel.sent.filter((m) => m.type === 'agentEvent').at(-1).event, { kind: 'done', ok: true, login: true });
    assert.deepStrictEqual(Object.keys(bg.store).filter((k) => k.startsWith('chat:')), []);

    // Cancel, and a failure from the helper comes back as a failed reply.
    const p2 = panel.ask({ type: 'agent.login' });
    const req2 = await answerNative(bg.native, 'agent.login', { loginId: 'l2' });
    assert.deepStrictEqual(req2.args, {});
    await p2;
    const cancelP = panel.ask({ type: 'agent.loginCancel', loginId: 'l2' });
    const cancelReq = await answerNative(bg.native, 'agent.loginCancel', { cancelled: true });
    assert.deepStrictEqual(cancelReq.args, { loginId: 'l2' });
    assert.deepStrictEqual((await cancelP).result, { cancelled: true });
    bg.native.emit({ type: 'agentEvent', runId: 'l2', event: { kind: 'done', ok: false, login: true, cancelled: true } });
    const p3 = panel.ask({ type: 'agent.login', agent: 'codex' });
    await answerNative(bg.native, 'agent.login', "Codex can't log in from the side panel: run `codex login` in a terminal", false);
    const r3 = await p3;
    assert.deepStrictEqual([r3.ok, r3.error], [false, "Codex can't log in from the side panel: run `codex login` in a terminal"]);

    // The helper going away mid-login ends it for the panel.
    const p4 = panel.ask({ type: 'agent.login', agent: 'claude' });
    await answerNative(bg.native, 'agent.login', { loginId: 'l4' });
    await p4;
    bg.native.onDisconnect.emit();
    await settle(20);
    const evs = panel.sent.filter((m) => m.type === 'agentEvent' && m.runId === 'l4').map((m) => m.event);
    assert.deepStrictEqual(evs.map((e) => e.kind), ['error', 'done']);
    assert.match(evs[0].message, /disconnected during the login/);
    assert.deepStrictEqual(evs[1], { kind: 'done', ok: false, login: true });
    assert.strictEqual(panel.sent.filter((m) => m.type === 'agentEvent' && m.runId === 'l2').length, 1, 'finished logins are not re-ended');
  } finally { bg.restore(); }
});

test('background: runs left in storage by a previous service worker are marked interrupted', async () => {
  const bg = await loadBackground({ storage: { 'chat:x.com': { sessionId: 's', agent: 'claude', messages: [{ role: 'user', text: 'go', time: 1 }], run: { runId: 'old', startedAt: 1 }, last: null } } });
  try {
    const chat = bg.store['chat:x.com'];
    assert.strictEqual(chat.run, null);
    assert.strictEqual(chat.sessionId, 's');
    assert.deepStrictEqual(chat.messages.map((m) => m.role), ['user', 'error']);
    assert.match(chat.messages[1].text, /Interrupted/);
  } finally { bg.restore(); }
});

test('background (Safari): a run left in storage is taken up again, and settled by agent.running', async () => {
  const stale = (runId) => ({ sessionId: 's', agent: 'claude', messages: [{ role: 'user', text: 'go', time: 1 }], run: { runId, startedAt: 1 }, last: null });
  const bg = await loadBackground({ safari: true, storage: { 'chat:x.com': stale('going'), 'chat:y.com': stale('gone') } });
  try {
    // Safari unloaded the background mid-run; the helper (the bridge's host) kept going.
    assert.strictEqual(bg.store['chat:x.com'].run.runId, 'going');
    assert.strictEqual(bg.store['chat:y.com'].run.runId, 'gone');
    // The first message from the helper: the background asks which runs are still going.
    bg.native.emit({ type: 'agentEvent', runId: 'going', event: { kind: 'text', text: 'Still here.' } });
    const req = await answerNative(bg.native, 'agent.running', { runIds: ['going'] });
    assert.deepStrictEqual(req.args, {});
    await settle(20);
    const gone = bg.store['chat:y.com'];
    assert.strictEqual(gone.run, null);
    assert.match(gone.messages.at(-1).text, /stopped while TRIF was away/);
    // The live one carries on, and finishes normally.
    assert.strictEqual(bg.store['chat:x.com'].run.runId, 'going');
    bg.native.emit({ type: 'agentEvent', runId: 'going', event: { kind: 'done', ok: true, result: 'Done.', changedFiles: [] } });
    await settle(20);
    const chat = bg.store['chat:x.com'];
    assert.strictEqual(chat.run, null);
    assert.deepStrictEqual(chat.messages.map((m) => [m.role, m.text]), [['user', 'go'], ['assistant', 'Still here.']]);
  } finally { bg.restore(); }
});

test('background (Safari): a lost connection mid-run keeps the run; reconnecting settles it', async () => {
  const bg = await loadBackground({ safari: true });
  try {
    const panel = bg.connectPanel();
    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'go' });
    await answerNative(bg.native, 'agent.start', { runId: 'r9' });
    await startP;
    bg.native.emit({ type: 'agentEvent', runId: 'r9', event: { kind: 'text', text: 'Looking…' } });
    await settle(10);
    bg.native.onDisconnect.emit();
    await settle(20);
    // Not ended: no error or done for the panel, and the chat still shows it running.
    assert.deepStrictEqual(panel.sent.filter((m) => m.type === 'agentEvent' && m.runId === 'r9').map((m) => m.event.kind), ['text']);
    assert.strictEqual(bg.store['chat:x.com'].run.runId, 'r9');
    // The background reconnects (after its backoff); the helper says the run is still going, then it ends.
    // (Earlier tests' backgrounds reconnect through the same mock too: the new connection is the one that
    // asks agent.running once the helper speaks.)
    let native = null;
    await waitFor(async () => {
      for (const p of bg.natives.slice(1)) {
        if (!p.greeted) { p.greeted = true; p.onMessage.emit({ type: 'mods', mods: [] }); }
      }
      await settle(5);
      native = bg.natives.slice(1).find((p) => p.sent.some((m) => m.type === 'request' && m.cmd === 'agent.running'));
      return !!native;
    }, { timeout: 5000, message: 'a new connection asking agent.running' });
    native.emit = (m) => native.onMessage.emit(m);
    await answerNative(native, 'agent.running', { runIds: ['r9'] });
    await settle(10);
    assert.strictEqual(bg.store['chat:x.com'].run.runId, 'r9');
    native.emit({ type: 'agentEvent', runId: 'r9', event: { kind: 'done', ok: true, result: 'Done.', changedFiles: [] } });
    await settle(20);
    assert.strictEqual(bg.store['chat:x.com'].run, null);
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.map((m) => m.role), ['user', 'assistant']);
  } finally { bg.restore(); }
});

// ---- mod switches -------------------------------------------------------------------------------

const SWITCH_TABS = [
  { id: 5, windowId: 1, index: 0, active: true, url: 'https://x.com/home', title: 'X' },
  { id: 6, windowId: 1, index: 1, active: false, url: 'https://z.com/', title: 'Z' },
];
const scriptIds = (bg) => bg.chrome.userScripts.scripts.map((s) => s.id);

test('background: mod.enable switches a mod off and on, persists it, and reloads the tab only when the mod runs there', async () => {
  const mods = [mod('x.com/a'), mod('y.com/b')];
  const bg = await loadBackground({ storage: { mods }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/a', 'y.com/b']);

    // CLI path: native request, default target = the active tab (x.com), which x.com/a runs on
    let r = await bg.native.call('mod.enable', { id: 'x.com/a', enabled: false, wait: true });
    assert.deepStrictEqual([r.ok, r.result], [true, { id: 'x.com/a', enabled: false, reloaded: 5 }]);
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/a': true });
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'y.com/b']);
    assert.deepStrictEqual(bg.reloaded, [5]);
    assert.ok(bg.native.sent.some((m) => m.type === 'modsApplied' && !m.registered.includes('x.com/a')));
    assert.ok(bg.native.sent.every((m) => m.type !== 'modsApplied' || !m.errors.some((e) => e.id === 'x.com/a')));

    // status reports enabled per mod
    r = await bg.native.call('status');
    assert.deepStrictEqual(r.result.mods, [
      { id: 'x.com/a', registered: false, enabled: false },
      { id: 'y.com/b', registered: true, enabled: true },
    ]);
    const panel = bg.connectPanel();
    const st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual(st.mods.map((m) => [m.id, m.enabled, m.registered]), [['x.com/a', false, false], ['y.com/b', true, true]]);

    // the helper resending mods (a reconnect, a file change) keeps it off
    bg.native.emit({ type: 'mods', mods: [mod('x.com/a', { hash: 'h2', code: 'edited()' }), mod('y.com/b')] });
    await settle(20);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'y.com/b']);

    // a mod that doesn't run on the target tab: no reload
    r = await bg.native.call('mod.enable', { id: 'y.com/b', enabled: false, tab: 5 });
    assert.deepStrictEqual(r.result, { id: 'y.com/b', enabled: false, reloaded: null });
    assert.deepStrictEqual(bg.reloaded, [5]);
    assert.deepStrictEqual(scriptIds(bg), [], 'no mods on: no runtime either');

    // panel path: switch x.com/a back on for the panel's tab
    let reply = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: true, tab: 5 });
    assert.deepStrictEqual([reply.ok, reply.result], [true, { id: 'x.com/a', enabled: true, reloaded: 5 }]);
    assert.deepStrictEqual(bg.store.disabled, { 'y.com/b': true });
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/a']);
    assert.match(bg.chrome.userScripts.scripts[1].js[0].code, /edited\(\)/);
    assert.deepStrictEqual(bg.reloaded, [5, 5]);
    assert.ok(panel.sent.some((m) => m.type === 'statusChanged'));
    // a tab the mod doesn't run on, and a tab that's gone: applied, nothing reloaded
    reply = await panel.ask({ type: 'mod.enable', id: 'y.com/b', enabled: true, tab: 6 });
    assert.deepStrictEqual(reply.result, { id: 'y.com/b', enabled: true, reloaded: null });
    reply = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 404 });
    assert.deepStrictEqual(reply.result, { id: 'x.com/a', enabled: false, reloaded: null });
    assert.deepStrictEqual(bg.reloaded, [5, 5]);

    // bad requests
    r = await bg.native.call('mod.enable', { id: 'nope.com/x', enabled: false });
    assert.deepStrictEqual([r.ok, r.error], [false, 'no mod nope.com/x (run `trif status` to list mods)']);
    r = await bg.native.call('mod.enable', { id: 'x.com/a', enabled: 'no' });
    assert.match(r.error, /enabled must be true or false/);
    r = await bg.native.call('mod.enable', { enabled: true });
    assert.match(r.error, /missing mod id/);
  } finally { bg.restore(); }
});

test('background: when storage is full, switches fail and change nothing, and mods are still applied', async () => {
  const mods = [mod('x.com/a'), mod('y.com/b')];
  const bg = await loadBackground({ storage: { mods }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    bg.ctl.full = true;
    const panel = bg.connectPanel();
    let r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 5 });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /couldn't save to Chrome's extension storage \(QUOTA_BYTES quota exceeded\); nothing was changed/);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/a', 'y.com/b'], 'still running, as the panel still says');
    assert.strictEqual((await bg.native.call('status')).result.mods[0].enabled, true);
    assert.deepStrictEqual(bg.reloaded, []);

    r = await panel.ask({ type: 'site.set', site: 'x.com', on: false, tab: 5 });
    assert.strictEqual(r.ok, false);
    assert.ok((await panel.ask({ type: 'status' })).result.sitesOn.includes('x.com'));
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/a', 'y.com/b']);

    r = await bg.native.call('record', { site: 'x.com', on: true });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual((await bg.native.call('status')).result.recording, []);

    // A changed mod from the helper is applied even though it can't be cached.
    bg.native.emit({ type: 'mods', mods: [mod('x.com/a', { hash: 'h2', code: 'edited()' }), mod('y.com/b')] });
    await settle(20);
    assert.match(bg.chrome.userScripts.scripts.find((x) => x.id === 'x.com/a').js[0].code, /edited\(\)/);

    bg.ctl.full = false;
    r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 5 });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/a': true });
  } finally { bg.restore(); }
});

test('background: storage that keeps failing (Safari\'s I/O error): one banner, one warning, switches kept in memory', async () => {
  const mods = [mod('x.com/a'), mod('y.com/b')];
  const bg = await loadBackground({ storage: { mods }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    bg.ctl.io = true;
    const panel = bg.connectPanel();
    // The first failures still change nothing, as before.
    let r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 5 });
    assert.strictEqual(r.ok, false);
    r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 5 });
    assert.strictEqual(r.ok, false);
    assert.notStrictEqual((await panel.ask({ type: 'status' })).result.storageBroken, true);
    // Then storage counts as broken: switches work for the session, and the panel is told.
    r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: false, tab: 5 });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'y.com/b']);
    const st = (await panel.ask({ type: 'status' })).result;
    assert.strictEqual(st.storageBroken, true);
    assert.deepStrictEqual(st.disabled, { 'x.com/a': true });
    r = await panel.ask({ type: 'site.set', site: 'y.com', on: false, tab: 5 });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(!(await panel.ask({ type: 'status' })).result.sitesOn.includes('y.com'));
    const warnings = bg.native.sent.filter((m) => m.type === 'log' && /storage keeps failing/.test(m.message));
    assert.strictEqual(warnings.length, 1, 'logged once');
    // Working again: the banner goes.
    bg.ctl.io = false;
    r = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: true, tab: 5 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual((await panel.ask({ type: 'status' })).result.storageBroken, undefined);
  } finally { bg.restore(); }
});

test('background: a run\'s events are written to its chat in batches, not one write each; done writes at once', async () => {
  const bg = await loadBackground();
  try {
    const panel = bg.connectPanel();
    const startP = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'go' });
    await answerNative(bg.native, 'agent.start', { runId: 'rb' });
    await startP;
    await settle(10);
    const before = bg.ctl.writes.filter((k) => k.includes('chat:x.com')).length;
    for (let i = 0; i < 30; i++) bg.native.emit({ type: 'agentEvent', runId: 'rb', event: { kind: 'tool', name: 'Bash', summary: `trif text ${i}` } });
    await settle(40);
    assert.strictEqual(bg.ctl.writes.filter((k) => k.includes('chat:x.com')).length, before, 'nothing written yet: batched');
    bg.native.emit({ type: 'agentEvent', runId: 'rb', event: { kind: 'done', ok: true, result: 'ok', changedFiles: [] } });
    await settle(40);
    const chatWrites = bg.ctl.writes.filter((k) => k.includes('chat:x.com')).length - before;
    assert.ok(chatWrites <= 2, `${chatWrites} writes`);
    const chat = bg.store['chat:x.com'];
    assert.strictEqual(chat.messages.filter((m) => m.role === 'tool').length, 30);
    assert.strictEqual(chat.run, null);
    // And without a done, the batch is written after a moment.
    const p2 = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 1, url: 'https://x.com/', prompt: 'again' });
    await answerNative(bg.native, 'agent.start', { runId: 'rc' });
    await p2;
    bg.native.emit({ type: 'agentEvent', runId: 'rc', event: { kind: 'text', text: 'Looking…' } });
    await waitFor(() => bg.store['chat:x.com'].messages.some((m) => m.text === 'Looking…'), { timeout: 3000 });
  } finally { bg.restore(); }
});

test('background: `applied` stays out of local storage (session storage), and an unchanged mods list isn\'t written again', async () => {
  const mods = [mod('x.com/a'), mod('x.com/b')];
  const bg = await loadBackground({ storage: { modIds: ['x.com/a', 'x.com/b'], 'mod:x.com/a': mods[0], 'mod:x.com/b': mods[1], applied: { old: 'x' } } });
  const modWrites = () => bg.ctl.writes.filter((k) => k.some((x) => x === 'mods' || x === 'modIds' || x.startsWith('mod:')));
  try {
    await settle(10);
    assert.ok(!('applied' in bg.store), 'the old local copy is removed');
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    assert.ok(!bg.ctl.writes.some((k) => k.includes('applied')));
    assert.strictEqual(modWrites().length, 0, 'same list as stored: not written');
    // A change writes that mod only.
    bg.native.emit({ type: 'mods', mods: [mod('x.com/a', { hash: 'h9', code: 'new()' }), mods[1]] });
    await settle(20);
    assert.deepStrictEqual(modWrites(), [['mod:x.com/a']]);
    assert.strictEqual(bg.store['mod:x.com/a'].code, 'new()');
    // One gone: the list, and its key removed.
    bg.native.emit({ type: 'mods', mods: [mods[1]] });
    await settle(20);
    assert.deepStrictEqual(modWrites().at(-1), ['modIds']);
    assert.ok(!('mod:x.com/a' in bg.store));
    assert.deepStrictEqual(bg.store.modIds, ['x.com/b']);
  } finally { bg.restore(); }
});

test('background: mods stored all in one key (0.2.4) are read, then stored one per key', async () => {
  const mods = [mod('x.com/a'), mod('x.com/b', { hash: 'hb' })];
  const bg = await loadBackground({ storage: { mods } });
  try {
    await settle(10);
    // Applied from storage before the helper says anything.
    await waitFor(() => bg.chrome.userScripts.scripts.length === 3);
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    assert.ok(!('mods' in bg.store));
    assert.deepStrictEqual(bg.store.modIds, ['x.com/a', 'x.com/b']);
    assert.deepStrictEqual(bg.store['mod:x.com/b'], mods[1]);
  } finally { bg.restore(); }
});

test('background: a mod sent without its code (same) takes it from the set before; one it doesn\'t have asks for them all', async () => {
  const bg = await loadBackground();
  try {
    await settle(10);
    const a = mod('x.com/a', { code: 'big()' });
    const b = mod('x.com/b', { hash: 'hb', code: 'b1()' });
    bg.native.emit({ type: 'mods', mods: [a, b] });
    await waitFor(() => bg.native.sent.some((m) => m.type === 'modsApplied'));
    const same = (m) => ({ ...m, code: undefined, same: true });
    bg.native.emit({ type: 'mods', mods: [same(a), { ...b, hash: 'hb2', code: 'b2()' }] });
    await waitFor(() => bg.native.sent.filter((m) => m.type === 'modsApplied').length === 2);
    const code = (id) => bg.chrome.userScripts.scripts.find((s) => s.id === id).js[0].code;
    assert.match(code('x.com/a'), /big\(\)/);
    assert.match(code('x.com/b'), /b2\(\)/);
    assert.strictEqual(bg.store['mod:x.com/a'].code, 'big()', 'stored with its code');
    assert.ok(!('same' in bg.store['mod:x.com/a']));
    // Not the hash it has: nothing changes, and the helper is asked for every mod again.
    bg.native.emit({ type: 'mods', mods: [same({ ...a, hash: 'other' })] });
    await waitFor(() => bg.native.sent.some((m) => m.type === 'modsResend'));
    assert.match(bg.native.sent.find((m) => m.type === 'modsResend').reason, /missing 1 mod/);
    await settle(20);
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.map((s) => s.id).sort(), ['webmods-runtime', 'x.com/a', 'x.com/b']);
    assert.match(code('x.com/a'), /big\(\)/);
  } finally { bg.restore(); }
});

test('background: record says whether it changed anything; switching off works on a site that\'s off', async () => {
  const bg = await loadBackground({ storage: { sitesOn: ['x.com', 'bank.com'] } });
  try {
    let r = await bg.native.call('record', { site: 'bank.com', on: true });
    assert.deepStrictEqual(r.result, { recording: ['bank.com'], site: 'bank.com', changed: true });
    r = await bg.native.call('record', { site: 'bank.com', on: true });
    assert.strictEqual(r.result.changed, false);
    const panel = bg.connectPanel();
    await panel.ask({ type: 'site.set', site: 'bank.com', on: false });
    r = await bg.native.call('record', { site: 'bank.com', on: true });
    assert.match(r.error, /TRIF is off on bank\.com/);
    r = await bg.native.call('record', { site: 'bank.com', on: false });
    assert.deepStrictEqual(r.result, { recording: [], site: 'bank.com', changed: true });
    assert.deepStrictEqual(bg.store.recording, []);
    // A run still can't switch off another site's recording.
    r = await bg.native.call('record', { site: 'bank.com', on: false, scope: 'x.com' });
    assert.match(r.error, /limited to x\.com/);
  } finally { bg.restore(); }
});

test('capChat: each message\'s text and each chat\'s size are capped, oldest messages going first', () => {
  const long = 'z'.repeat(lib.CHAT_TEXT_MAX + 500);
  let chat = lib.capChat({ messages: [{ role: 'assistant', text: long, time: 1 }, { role: 'tool', text: 'ok', time: 2 }] });
  assert.strictEqual(chat.messages[0].text.slice(0, lib.CHAT_TEXT_MAX), long.slice(0, lib.CHAT_TEXT_MAX));
  assert.match(chat.messages[0].text, /shortened: 500 more characters not kept\]$/);
  assert.deepStrictEqual(chat.messages[1], { role: 'tool', text: 'ok', time: 2 });

  const many = Array.from({ length: 200 }, (_, i) => ({ role: 'assistant', text: `${i} ${'y'.repeat(lib.CHAT_TEXT_MAX - 10)}`, time: i }));
  chat = lib.capChat({ messages: many });
  assert.ok(JSON.stringify(chat.messages).length <= lib.CHAT_BYTES_MAX);
  assert.ok(chat.messages.length > 10);
  assert.strictEqual(chat.messages.at(-1).time, 199, 'the newest kept');
  assert.strictEqual(lib.capChat({ messages: Array.from({ length: 600 }, (_, i) => ({ role: 'user', text: 'a', time: i })) }).messages.length, lib.CHAT_MAX);
});

test('background: switched-off mods stay off after a service worker restart; stale ids are ignored', async () => {
  const mods = [mod('x.com/a'), mod('y.com/b')];
  const bg = await loadBackground({ storage: { mods, disabled: { 'x.com/a': true, 'gone.com/old': true } } });
  try {
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'y.com/b']);
    const st = (await bg.native.call('status')).result;
    assert.deepStrictEqual(st.mods.map((m) => [m.id, m.enabled]), [['x.com/a', false], ['y.com/b', true]]);
  } finally { bg.restore(); }
});

test('background: a switch that fails to apply is reverted and reported', async () => {
  const mods = [mod('x.com/a'), mod('y.com/b')];
  const bg = await loadBackground({ storage: { mods, disabled: { 'x.com/a': true } }, tabs: SWITCH_TABS });
  try {
    const us = bg.chrome.userScripts;
    const register = us.register;
    us.register = async (list) => {
      if (list.some((s) => s.id === 'x.com/a')) throw new Error("Invalid match pattern 'nope'");
      return register.call(us, list);
    };
    const panel = bg.connectPanel();
    const reply = await panel.ask({ type: 'mod.enable', id: 'x.com/a', enabled: true, tab: 5 });
    assert.strictEqual(reply.ok, false);
    assert.strictEqual(reply.error, "couldn't turn x.com/a on: Invalid match pattern 'nope'");
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/a': true });
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'y.com/b']);
    assert.deepStrictEqual(bg.reloaded, []);
    const st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual(st.mods.map((m) => [m.id, m.enabled, m.error]), [['x.com/a', false, null], ['y.com/b', true, null]]);
  } finally { bg.restore(); }
});

// A few DOM methods, enough for modswitch.js.
function fakeDoc() {
  const make = (tag) => {
    const attrs = new Map();
    const listeners = {};
    const e = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, className: '', title: '', type: '',
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      append: (...c) => e.children.push(...c),
      addEventListener: (t, f) => (listeners[t] ||= []).push(f),
      click: () => (listeners.click || []).forEach((f) => f()),
    };
    return e;
  };
  return { createElement: make };
}

test('mod switch: accessible, optimistic, one change at a time, reverts with a short error, follows live updates', async () => {
  const ms = await import('../extension/modswitch.js');
  let changes = 0;
  ms.onSwitchChange(() => changes++);
  const calls = [];
  let settleApply;
  const apply = (id, enabled) => { calls.push([id, enabled]); return new Promise((res, rej) => { settleApply = { res, rej }; }); };
  const b = ms.modSwitch(fakeDoc(), { id: 'x.com/a', enabled: true, labelId: 'mod-name-1', apply });
  const root = { querySelectorAll: (sel) => { assert.strictEqual(sel, '[role="switch"][data-mod]'); return [b]; } };
  assert.deepStrictEqual([b.tagName, b.type, b.getAttribute('role'), b.getAttribute('aria-checked'), b.getAttribute('aria-labelledby')],
    ['BUTTON', 'button', 'switch', 'true', 'mod-name-1']);
  assert.match(b.title, /^On/);
  assert.strictEqual(b.children[0].getAttribute('aria-hidden'), 'true');

  // optimistic: the new state shows before the background answers
  b.click();
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  assert.strictEqual(b.getAttribute('aria-busy'), 'true');
  assert.deepStrictEqual(calls, [['x.com/a', false]]);
  assert.strictEqual(ms.shownEnabled('x.com/a', true), false);
  ms.syncSwitches(root, () => true); // a status refresh mid-flight doesn't undo it
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  b.click(); // ignored while in flight
  assert.strictEqual(calls.length, 1);
  settleApply.res({ id: 'x.com/a', enabled: false });
  await settle();
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  assert.strictEqual(b.getAttribute('aria-busy'), null);
  assert.strictEqual(ms.shownEnabled('x.com/a', true), true);
  assert.ok(changes >= 2);

  // live: chrome.storage.local `disabled` changed elsewhere (an agent ran `trif enable x.com/a`)
  ms.syncSwitches(root, (id) => ms.enabledIn({}, id));
  assert.strictEqual(b.getAttribute('aria-checked'), 'true');
  ms.syncSwitches(root, (id) => ms.enabledIn({ 'x.com/a': true }, id));
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  ms.syncSwitches(root, (id) => ms.enabledIn(undefined, id));
  assert.strictEqual(b.getAttribute('aria-checked'), 'true');

  // failure: flips back, short error
  b.click();
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  settleApply.rej(new Error("couldn't turn x.com/a off: Invalid match pattern 'nope'"));
  await settle();
  assert.strictEqual(b.getAttribute('aria-checked'), 'true');
  assert.strictEqual(ms.switchError('x.com/a'), "Couldn’t switch it off: Invalid match pattern 'nope'");
  // trying again clears the error
  b.click();
  assert.strictEqual(ms.switchError('x.com/a'), null);
  settleApply.res({});
  await settle();
  assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  ms.onSwitchChange(null);
});

test('modSites: hosts a mod names, and whether it runs everywhere', () => {
  assert.deepEqual(lib.modSites({ matches: ['https://x.com/*', 'https://twitter.com/*'] }),
    { everywhere: false, sites: ['x.com', 'twitter.com'] });
  assert.deepEqual(lib.modSites({ matches: ['*://www.instagram.com/*', '*://*.instagram.com/*'] }),
    { everywhere: false, sites: ['instagram.com'] });
  assert.deepEqual(lib.modSites({ matches: ['*://x.com/*', '*://mobile.x.com:8080/*'] }),
    { everywhere: false, sites: ['x.com'] });
  assert.equal(lib.modSites({ matches: ['<all_urls>'] }).everywhere, true);
  assert.equal(lib.modSites({ matches: ['*://*/*', 'https://x.com/*'] }).everywhere, true);
  assert.deepEqual(lib.modSites({ matches: ['file:///*', 'nonsense'] }), { everywhere: false, sites: [] });
});

test('per-site switches: switchSite, offOnSite, withOffSites, normalizeOffSites, isMultiSite', () => {
  const px = { matches: ['https://x.com/*', 'https://twitter.com/*'] };
  const all = { matches: ['*://*/*'] };
  assert.equal(lib.isMultiSite(px), true);
  assert.equal(lib.isMultiSite(all), true);
  assert.equal(lib.isMultiSite({ matches: ['*://x.com/*', '*://*.x.com/*'] }), false);

  // off on one site, then the other: the whole mod goes off and the list clears
  let st = lib.switchSite(px, { disabled: false, offSites: [] }, 'https://www.Twitter.com/home', false);
  assert.deepEqual(st, { disabled: false, offSites: ['twitter.com'] });
  assert.deepEqual(lib.switchSite(px, st, 'twitter.com', false), st, 'already off there');
  assert.deepEqual(lib.switchSite(px, st, 'x.com', false), { disabled: true, offSites: [] });
  // on on one site while the whole mod is off: on there only
  assert.deepEqual(lib.switchSite(px, { disabled: true, offSites: [] }, 'x.com', true), { disabled: false, offSites: ['twitter.com'] });
  assert.deepEqual(lib.switchSite(px, st, 'twitter.com', true), { disabled: false, offSites: [] });
  // a mod for every site: never goes off as a whole from site switches; on while off comes on everywhere but the list
  st = lib.switchSite(all, { disabled: false, offSites: [] }, 'bank.com', false);
  assert.deepEqual(st, { disabled: false, offSites: ['bank.com'] });
  assert.deepEqual(lib.switchSite(all, { disabled: true, offSites: ['bank.com'] }, 'news.com', true), { disabled: false, offSites: ['bank.com'] });
  // a parent domain's entry covers subdomains; switching a subdomain on removes it
  assert.deepEqual(lib.switchSite(all, { disabled: false, offSites: ['wikipedia.org'] }, 'en.wikipedia.org', false),
    { disabled: false, offSites: ['wikipedia.org'] });
  assert.deepEqual(lib.switchSite(all, { disabled: false, offSites: ['wikipedia.org', 'bank.com'] }, 'en.wikipedia.org', true),
    { disabled: false, offSites: ['bank.com'] });
  assert.throws(() => lib.switchSite(all, { disabled: false }, 'not a site', false), /isn't a site/);

  assert.equal(lib.offOnSite({ a: ['wikipedia.org'] }, 'a', 'en.wikipedia.org'), true);
  assert.equal(lib.offOnSite({ a: ['en.wikipedia.org'] }, 'a', 'wikipedia.org'), false);
  assert.equal(lib.offOnSite({}, 'a', 'x.com'), false);

  assert.deepEqual(lib.withOffSites({ id: 'a', excludes: ['https://x.com/settings*'], hash: 'h' }, ['twitter.com', '10.0.0.1']), {
    id: 'a', hash: 'h|off:twitter.com,10.0.0.1',
    excludes: ['https://x.com/settings*', '*://twitter.com/*', '*://*.twitter.com/*', '*://10.0.0.1/*'],
  });
  const same = { id: 'a', excludes: [] };
  assert.equal(lib.withOffSites(same, undefined), same);

  assert.deepEqual(lib.normalizeOffSites({ a: ['www.X.com', 'x.com', 'bad site', 3], b: [], c: 'nope' }), { a: ['x.com'] });
});

test('background: mod.enable with site switches a multi-site mod on one site, via excludes', async () => {
  const px = mod('x.com/p', { matches: ['https://x.com/*', 'https://twitter.com/*'] });
  const bg = await loadBackground({ storage: { mods: [px] }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods: [px] });
    await settle(20);
    const script = () => bg.chrome.userScripts.scripts.find((s) => s.id === 'x.com/p');

    let r = await bg.native.call('mod.enable', { id: 'x.com/p', enabled: false, site: 'twitter.com', tab: 6 });
    assert.deepStrictEqual(r.result, { id: 'x.com/p', enabled: false, site: 'twitter.com', offSites: ['twitter.com'], modEnabled: true, reloaded: null });
    assert.deepStrictEqual(bg.store.offSites, { 'x.com/p': ['twitter.com'] });
    assert.deepStrictEqual(script().excludeMatches, ['*://twitter.com/*', '*://*.twitter.com/*']);
    let st = (await bg.native.call('status')).result;
    assert.deepStrictEqual(st.mods, [{ id: 'x.com/p', registered: true, enabled: true, offSites: ['twitter.com'] }]);

    // the panel, on x.com: off there too, which was the last site, so the whole mod goes off
    const panel = bg.connectPanel();
    let reply = await panel.ask({ type: 'mod.enable', id: 'x.com/p', enabled: false, site: 'x.com', tab: 5 });
    assert.deepStrictEqual(reply.result, { id: 'x.com/p', enabled: false, site: 'x.com', offSites: [], modEnabled: false, reloaded: 5 });
    assert.deepStrictEqual([bg.store.disabled, bg.store.offSites], [{ 'x.com/p': true }, {}]);
    assert.equal(script(), undefined);

    // back on, on x.com only
    reply = await panel.ask({ type: 'mod.enable', id: 'x.com/p', enabled: true, site: 'x.com', tab: 5 });
    assert.deepStrictEqual([bg.store.disabled, bg.store.offSites], [{}, { 'x.com/p': ['twitter.com'] }]);
    assert.deepStrictEqual(script().excludeMatches, ['*://twitter.com/*', '*://*.twitter.com/*']);

    // the whole-mod switch leaves the list alone
    await bg.native.call('mod.enable', { id: 'x.com/p', enabled: false });
    await bg.native.call('mod.enable', { id: 'x.com/p', enabled: true });
    assert.deepStrictEqual(bg.store.offSites, { 'x.com/p': ['twitter.com'] });

    // a run scoped to x.com: its own site with site, not the other one, and not the whole mod
    r = await bg.native.call('mod.enable', { id: 'x.com/p', enabled: false, site: 'x.com', scope: 'x.com' });
    assert.equal(r.ok, true);
    r = await bg.native.call('mod.enable', { id: 'x.com/p', enabled: true, site: 'twitter.com', scope: 'x.com' });
    assert.match(r.error, /twitter\.com is outside x\.com/);
    r = await bg.native.call('mod.enable', { id: 'x.com/p', enabled: true, scope: 'x.com' });
    assert.match(r.error, /x\.com\/p runs outside x\.com/);
    r = await bg.native.call('mod.enable', { id: 'x.com/p', enabled: true, site: '%%' });
    assert.match(r.error, /isn't a site/);
  } finally { bg.restore(); }
});

test('background: a scoped run can\'t switch on an all-sites mod that\'s off (that would turn it on everywhere)', async () => {
  const all = mod('all/e', { matches: ['<all_urls>'] });
  const bg = await loadBackground({ storage: { mods: [all], disabled: { 'all/e': true } }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods: [all] });
    await settle(20);
    let r = await bg.native.call('mod.enable', { id: 'all/e', enabled: true, site: 'x.com', scope: 'x.com' });
    assert.match(r.error, /runs on every site, and it's switched off; only the user can switch it on/);
    assert.deepStrictEqual(bg.store.disabled, { 'all/e': true });
    // switching it off on its own site is fine, and so is the user turning it on
    r = await bg.native.call('mod.enable', { id: 'all/e', enabled: false, site: 'x.com', scope: 'x.com' });
    assert.equal(r.ok, true);
    r = await bg.native.call('mod.enable', { id: 'all/e', enabled: true, site: 'x.com' });
    assert.equal(r.ok, true, r.error);
  } finally { bg.restore(); }
});

test('background: per-site offs survive a service worker restart', async () => {
  const px = mod('x.com/p', { matches: ['https://x.com/*', 'https://twitter.com/*'] });
  const bg = await loadBackground({ storage: { mods: [px], offSites: { 'x.com/p': ['twitter.com'] } } });
  try {
    const s = bg.chrome.userScripts.scripts.find((x) => x.id === 'x.com/p');
    assert.deepStrictEqual(s.excludeMatches, ['*://twitter.com/*', '*://*.twitter.com/*']);
  } finally { bg.restore(); }
});

// ---- mods made in another browser ---------------------------------------------------------------

test('fromOtherBrowser: only a mod whose origin is another install', () => {
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a', origin: { by: 'B', browser: 'Firefox' } }, 'A'), true);
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a', origin: { by: 'A', browser: 'Chrome' } }, 'A'), false);
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a' }, 'A'), false);
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a', origin: { by: '' } }, 'A'), false);
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a', origin: { by: 42 } }, 'A'), false);
  assert.strictEqual(lib.fromOtherBrowser({ id: 'x.com/a', origin: { by: 'B' } }, null), false, 'no install id: nothing is foreign');
  assert.strictEqual(lib.fromOtherBrowser(null, 'A'), false);
});

test('applyStartOff: a mod made in another browser is switched off once; own and origin-less mods are left alone', () => {
  const mods = [
    { id: 'x.com/theirs', origin: { by: 'B', browser: 'Firefox' } },
    { id: 'x.com/mine', origin: { by: 'A', browser: 'Chrome' } },
    { id: 'x.com/plain' },
  ];
  let r = lib.applyStartOff(mods, { 'old.com/x': true }, {}, 'A');
  assert.deepStrictEqual(r, { disabled: { 'old.com/x': true, 'x.com/theirs': true }, startedOff: { 'x.com/theirs': true }, changed: true });
  // The user switched it on here: it stays on.
  const disabled = {};
  const again = lib.applyStartOff(mods, disabled, r.startedOff, 'A');
  assert.strictEqual(again.changed, false);
  assert.strictEqual(again.disabled, disabled);
  // Without an install id nothing counts as foreign (preinstalled startOff still applies).
  r = lib.applyStartOff([...mods, { id: 'x.com/pre', startOff: true }], {}, {}, null);
  assert.deepStrictEqual(r.disabled, { 'x.com/pre': true });
  assert.strictEqual(lib.applyStartOff(mods, {}, {}).changed, false, 'old 3-argument call: no foreign switching');
});

test('applyNewMods: with a group set to start off, its new mods arrive off, by source; the other group, and mods already here, untouched', () => {
  const page = (id, extra) => ({ id, ...extra });
  const rules = (id, extra) => ({ id, rules: true, ...extra });
  const here = { 'x.com/old': true, 'x.com/oldrules': true };
  const mods = [
    page('x.com/old'), rules('x.com/oldrules'),
    page('x.com/terminal'), // a terminal agent's, or a file dropped in: no origin
    page('x.com/other', { origin: { by: 'B', browser: 'Firefox' } }), // another browser's panel
    page('x.com/mine', { origin: { by: 'A', browser: 'Chrome' } }), // this browser's own panel chat
    page('x.com/held', { held: { facts: ['can send requests'] } }), // waits for the user's OK anyway
    rules('x.com/style'),
    page('x.com/tims', { startOff: true }), // Tim's, shipped off: off already
  ];
  const go = (startsOff, extra = {}) => lib.applyNewMods(mods, { disabled: { 'x.com/tims': true }, seen: here, autoUpdated: {}, newOff: {}, startsOff, installId: 'A', ...extra });
  // Page scripts start off: the new page scripts from anywhere but here, not held ones, not rules.
  let r = go(['page']);
  assert.deepStrictEqual(r.disabled, { 'x.com/tims': true, 'x.com/terminal': true, 'x.com/other': true });
  assert.deepStrictEqual(r.newOff, { 'x.com/terminal': 'new', 'x.com/other': 'new' });
  assert.deepStrictEqual(Object.keys(r.seen).sort(), mods.map((m) => m.id).sort());
  // Once: seen now, so the user's switch after that is theirs.
  const again = lib.applyNewMods(mods, { disabled: {}, seen: r.seen, autoUpdated: r.autoUpdated, newOff: r.newOff, startsOff: ['page'], installId: 'A' });
  assert.strictEqual(again.changed, false);
  // Rules start off: only the new rules mod.
  assert.deepStrictEqual(go(['rules']).newOff, { 'x.com/style': 'new' });
  // Both: everything new that isn't this browser's own or held.
  assert.deepStrictEqual(Object.keys(go(['rules', 'page']).newOff).sort(), ['x.com/other', 'x.com/style', 'x.com/terminal']);
  // Neither (the default): seen, nothing switched.
  r = go([]);
  assert.deepStrictEqual([r.disabled, r.newOff], [{ 'x.com/tims': true }, {}]);
  // Without an install id, nothing counts as this browser's own.
  assert.ok('x.com/mine' in lib.applyNewMods(mods, { seen: here, autoUpdated: {}, startsOff: ['page'] }).newOff);
});

test('applyNewMods: a browser that never stored what it saw takes its mods as seen; updates TRIF made itself and Tim\'s mods got back arrive again', () => {
  // From before this existed: nothing switched, everything remembered (stamps too).
  let r = lib.applyNewMods([{ id: 'x.com/a', autoUpdated: 's1' }, { id: 'x.com/b' }], { seen: null, autoUpdated: null, startsOff: ['page'] });
  assert.deepStrictEqual(r, { disabled: {}, seen: { 'x.com/a': true, 'x.com/b': true }, autoUpdated: { 'x.com/a': 's1' }, newOff: {}, changed: true });
  // A new version TRIF put in place by itself: off, as an update, once per stamp.
  r = lib.applyNewMods([{ id: 'x.com/a', autoUpdated: 's2' }, { id: 'x.com/b' }], { seen: r.seen, autoUpdated: r.autoUpdated, startsOff: ['page'] });
  assert.deepStrictEqual([r.disabled, r.newOff, r.autoUpdated], [{ 'x.com/a': true }, { 'x.com/a': 'update' }, { 'x.com/a': 's2' }]);
  // With page scripts starting on, the stamp is only remembered.
  const on = lib.applyNewMods([{ id: 'x.com/a', autoUpdated: 's3' }], { seen: r.seen, autoUpdated: r.autoUpdated, startsOff: [] });
  assert.deepStrictEqual([on.disabled, on.autoUpdated['x.com/a']], [{}, 's3']);
  // One of Tim's mods the user deleted and got back (a new `readded` stamp) arrives again.
  const back = lib.applyNewMods([{ id: 'x.com/b', readded: 'r1' }], { seen: { 'x.com/b': true }, autoUpdated: {}, startsOff: ['page'], readded: {} });
  assert.deepStrictEqual(back.newOff, { 'x.com/b': 'new' });
  assert.strictEqual(lib.applyNewMods([{ id: 'x.com/b', readded: 'r1' }], { seen: { 'x.com/b': true }, autoUpdated: {}, startsOff: ['page'], readded: { 'x.com/b': 'r1' } }).changed, false);
  // A mod that's gone takes its reason with it.
  const gone = lib.applyNewMods([], { seen: { 'x.com/b': true }, autoUpdated: {}, newOff: { 'x.com/b': 'new' }, startsOff: ['page'] });
  assert.deepStrictEqual(gone.newOff, {});
  assert.deepStrictEqual(lib.normalizeStartsOff(['page', 'page', 'nope', 'rules']), ['rules', 'page']);
  assert.deepStrictEqual(lib.normalizeStartsOff('page'), []);
  assert.deepStrictEqual(lib.normalizeNewOff({ a: 'new', b: 'update', c: true }), { a: 'new', b: 'update' });
});

test('background: new mods start on or off by group (Settings); an agent run can\'t switch one on, the user can, and that clears why it was off', async () => {
  const tabs = [{ id: 5, windowId: 1, active: true, url: 'https://x.com/home' }];
  const bg = await loadBackground({ storage: { sitesOn: ['x.com'], installId: 'A', mods: [mod('x.com/old')], modIds: ['x.com/old'] }, tabs });
  try {
    const panel = bg.connectPanel();
    bg.native.emit({ type: 'mods', mods: [mod('x.com/old')] });
    await settle(20);
    assert.deepStrictEqual(bg.store.seenMods, { 'x.com/old': true }, 'what was there is seen, nothing switched');
    assert.deepStrictEqual((await panel.ask({ type: 'status' })).result.startsOff, []);
    // The user sets page scripts to start off.
    const set = await panel.ask({ type: 'mods.startsOff', group: 'page', off: true });
    assert.deepStrictEqual(set.result, { startsOff: ['page'] });
    assert.deepStrictEqual(bg.store.startsOff, ['page']);
    assert.match((await panel.ask({ type: 'mods.startsOff', group: 'nope', off: true })).error, /unknown group/);
    // A terminal agent's page script and a rules mod arrive; and one this browser's panel chat made.
    bg.native.emit({ type: 'mods', mods: [mod('x.com/old'), mod('x.com/new'), mod('x.com/style', { rules: true }), mod('x.com/chat', { origin: { by: 'A', browser: 'Chrome' } })] });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/new': true });
    assert.deepStrictEqual(bg.store.newOff, { 'x.com/new': 'new' });
    assert.ok(!scriptIds(bg).includes('x.com/new'), 'never registered');
    assert.ok(scriptIds(bg).includes('x.com/style') && scriptIds(bg).includes('x.com/chat') && scriptIds(bg).includes('x.com/old'));
    const st = (await panel.ask({ type: 'status' })).result;
    assert.strictEqual(st.mods.find((m) => m.id === 'x.com/new').newOff, 'new');
    assert.strictEqual(st.mods.find((m) => m.id === 'x.com/style').newOff, null);
    const cli = (await bg.native.call('status')).result;
    assert.deepStrictEqual(cli.startsOff, ['page']);
    assert.strictEqual(cli.mods.find((m) => m.id === 'x.com/new').newOff, 'new');
    // A side-panel run (scoped) can't switch it on; the user can.
    const refused = await bg.native.call('mod.enable', { id: 'x.com/new', enabled: true, scope: 'x.com' });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.error, /new and switched off until the user looks at it[\s\S]*only the user can switch it on/);
    assert.ok(!scriptIds(bg).includes('x.com/new'));
    const on = await panel.ask({ type: 'mod.enable', id: 'x.com/new', enabled: true });
    assert.ok(on.ok, on.error);
    assert.ok(scriptIds(bg).includes('x.com/new'));
    assert.deepStrictEqual(bg.store.newOff, {});
    // Off again later: the user's own switch, not "new".
    await panel.ask({ type: 'mod.enable', id: 'x.com/new', enabled: false });
    assert.strictEqual((await panel.ask({ type: 'status' })).result.mods.find((m) => m.id === 'x.com/new').newOff, null);
    // Back to on: new page scripts start on again; mods already here keep their switches.
    await panel.ask({ type: 'mods.startsOff', group: 'page', off: false });
    bg.native.emit({ type: 'mods', mods: [mod('x.com/old'), mod('x.com/new'), mod('x.com/style', { rules: true }), mod('x.com/chat', { origin: { by: 'A' } }), mod('x.com/later')] });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/new': true });
    assert.ok(scriptIds(bg).includes('x.com/later'));
  } finally {
    bg.restore();
  }
});

test('applyAbsorbed: a retired shipped mod hands its switch to the mod it went into, once: on if either was on', () => {
  const INTO = 'www.google.com/hide-ai-in-results';
  const OLD = 'www.google.com/hide-ai-mode';
  const mods = [{ id: INTO, absorbs: [OLD] }, { id: 'x.com/plain' }];
  const carry = (disabled, offSites = {}) => lib.applyAbsorbed(mods, disabled, offSites, {});
  // Only the old one was on: the merged one comes on.
  assert.deepStrictEqual(carry({ [INTO]: true, 'x.com/plain': true }),
    { disabled: { 'x.com/plain': true }, offSites: {}, absorbed: { [OLD]: true }, changed: true });
  // Both off: stays off. Old one off, merged one on: stays on. Both on: on.
  assert.deepStrictEqual(carry({ [INTO]: true, [OLD]: true }).disabled, { [INTO]: true, [OLD]: true });
  assert.deepStrictEqual(carry({ [OLD]: true }).disabled, { [OLD]: true });
  assert.deepStrictEqual(carry({}).disabled, {});
  // Per site: on wherever either was on.
  assert.deepStrictEqual(carry({}, { [INTO]: ['google.com', 'google.ca'], [OLD]: ['google.com'] }).offSites,
    { [INTO]: ['google.com'], [OLD]: ['google.com'] });
  assert.deepStrictEqual(carry({ [INTO]: true }, { [OLD]: ['google.ca'] }).offSites, { [OLD]: ['google.ca'], [INTO]: ['google.ca'] });
  assert.deepStrictEqual(carry({}, { [INTO]: ['google.ca'] }).offSites, {});
  // Once: after that the switch is the user's.
  const disabled = { [INTO]: true };
  const again = lib.applyAbsorbed(mods, disabled, {}, { [OLD]: true });
  assert.strictEqual(again.changed, false);
  assert.strictEqual(again.disabled, disabled);
  // The old one back (restored from the trash): only remembered; each keeps its own switch.
  const back = lib.applyAbsorbed([...mods, { id: OLD }], { [INTO]: true }, {}, {});
  assert.deepStrictEqual(back, { disabled: { [INTO]: true }, offSites: {}, absorbed: { [OLD]: true }, changed: true });
  assert.strictEqual(lib.applyAbsorbed([{ id: 'a/b' }], {}, {}, {}).changed, false);
});

test('background: a retired shipped mod\'s switch carries over to the mod it went into, once', async () => {
  const INTO = 'www.google.com/hide-extra-sections';
  const OLD = 'www.google.com/hide-sponsored';
  // The user had switched the merged one off and kept the old one on.
  const bg = await loadBackground({ storage: { sitesOn: ['google.com'], disabled: { [INTO]: true }, mods: [mod(INTO), mod(OLD)] } });
  try {
    bg.native.emit({ type: 'mods', mods: [mod(INTO, { absorbs: [OLD] })] });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, {});
    assert.deepStrictEqual(bg.store.absorbed, { [OLD]: true });
    assert.ok(scriptIds(bg).includes(INTO));
    // Switched off again: stays off.
    const r = await bg.native.call('mod.enable', { id: INTO, enabled: false });
    assert.strictEqual(r.ok, true, r.error);
    bg.native.emit({ type: 'mods', mods: [mod(INTO, { absorbs: [OLD], hash: 'h2' })] });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, { [INTO]: true });
  } finally { bg.restore(); }
});

test('findRenames / carryRenames: a mod renamed on disk keeps its switches (off, off on a site) and isn\'t new again', () => {
  const m = (id, code) => mod(id, { code });
  const prev = [m('x.com/wobble', 'W'), m('x.com/keep', 'K'), m('x.com/edited', 'E'), m('y.com/moved', 'M')];
  const next = [m('x.com/keep', 'K'), m('x.com/jelly', 'W'), m('x.com/edited2', 'E changed'), m('z.com/moved', 'M'), m('x.com/copy', 'K')];
  // Same code, same site folder: renamed. Edited as well, moved to another site, or a copy: not.
  const renames = lib.findRenames(prev, next);
  assert.deepStrictEqual(renames, [{ from: 'x.com/wobble', to: 'x.com/jelly' }]);
  assert.deepStrictEqual(lib.findRenames(next, next), []);
  assert.deepStrictEqual(lib.findRenames([], next), [], 'nothing before (first start)');
  assert.deepStrictEqual(lib.findRenames([{ id: 'x.com/a', site: 'x.com' }], [{ id: 'x.com/b', site: 'x.com' }]), [], 'no code: no guess');
  // Off stays off and dead entries go; the new id counts as already seen, so it isn't switched off as new.
  const before = { disabled: { 'x.com/wobble': true, 'x.com/keep': true }, offSites: {}, startedOff: { 'x.com/keep': true } };
  const r = lib.carryRenames(renames, before);
  assert.deepStrictEqual(r, { disabled: { 'x.com/keep': true, 'x.com/jelly': true }, offSites: {}, startedOff: { 'x.com/keep': true, 'x.com/jelly': true }, changed: true });
  assert.deepStrictEqual(before.disabled, { 'x.com/wobble': true, 'x.com/keep': true }, 'pure');
  // On stays on (a stale entry under the new name doesn't switch it off); per-site offs move too.
  assert.deepStrictEqual(lib.carryRenames(renames, { disabled: { 'x.com/jelly': true }, offSites: { 'x.com/wobble': ['x.com'] } }),
    { disabled: {}, offSites: { 'x.com/jelly': ['x.com'] }, startedOff: { 'x.com/jelly': true }, changed: true });
  // A swap keeps both.
  const swap = lib.carryRenames([{ from: 'x.com/a', to: 'x.com/b' }, { from: 'x.com/b', to: 'x.com/a' }], { disabled: { 'x.com/a': true } });
  assert.deepStrictEqual(swap.disabled, { 'x.com/b': true });
  const same = { disabled: {} };
  assert.strictEqual(lib.carryRenames([], same).changed, false);
});

test('orderMods / moveId / setModOrder: the panel\'s own order, per site, new mods last, gone ones skipped', () => {
  const ids = (list) => list.map((x) => x.id);
  const mods = ['a', 'b', 'c', 'd'].map((x) => mod(`x.com/${x}`));
  assert.deepStrictEqual(ids(lib.orderMods(mods, undefined)), ['x.com/a', 'x.com/b', 'x.com/c', 'x.com/d'], 'no order saved: as they come');
  assert.notStrictEqual(lib.orderMods(mods, []), mods, 'a copy');
  // Saved c, a; b and d are new since: after, as they came. A gone id (x.com/z) is skipped.
  assert.deepStrictEqual(ids(lib.orderMods(mods, ['x.com/c', 'x.com/z', 'x.com/a'])), ['x.com/c', 'x.com/a', 'x.com/b', 'x.com/d']);
  // One brought back from the trash takes its old place.
  assert.deepStrictEqual(ids(lib.orderMods([mods[0], mods[3]], ['x.com/d', 'x.com/c', 'x.com/a'])), ['x.com/d', 'x.com/a']);

  const list = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(lib.moveId(list, 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(lib.moveId(list, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepStrictEqual(lib.moveId(list, 'b', 99), ['a', 'c', 'd', 'b'], 'clamped');
  assert.deepStrictEqual(lib.moveId(list, 'b', -5), ['b', 'a', 'c', 'd'], 'clamped');
  assert.strictEqual(lib.moveId(list, 'b', 1), list, 'no move: the same array');
  assert.strictEqual(lib.moveId(list, 'zz', 0), list, 'not there');

  const natural = ['x.com/a', 'x.com/b'];
  const saved = lib.setModOrder({ 'y.com': ['y.com/q'] }, 'x.com', ['x.com/b', 'x.com/a'], natural);
  assert.deepStrictEqual(saved, { 'y.com': ['y.com/q'], 'x.com': ['x.com/b', 'x.com/a'] });
  // Back to the order they come in anyway: the entry goes (new mods come in where they would again).
  assert.deepStrictEqual(lib.setModOrder(saved, 'x.com', natural, natural), { 'y.com': ['y.com/q'] });
  assert.deepStrictEqual(lib.normalizeModOrder({ a: ['x', 'x', 3, ''], b: [], c: 'no', d: ['y'] }), { a: ['x'], d: ['y'] });
  assert.deepStrictEqual(lib.normalizeModOrder(null), {});
  assert.deepStrictEqual(lib.normalizeModOrder(['x']), {});
});

test('orderMods: a site\'s shipped default order first (the rest after, as they come), and the user\'s own order over it', () => {
  const ids = (list) => list.map((x) => x.id);
  const mods = ['fireworks', 'gravity', 'jelly', 'mine', 'tagline'].map((x) => mod(`timsrobot.com/${x}`));
  const shipped = ['timsrobot.com/tagline', 'timsrobot.com/jelly', 'timsrobot.com/gravity', 'timsrobot.com/fireworks', 'timsrobot.com/neon'];
  // (As the panel does it: the default order, then the user's over that.)
  const natural = lib.orderMods(mods, shipped);
  assert.deepStrictEqual(ids(natural), [...shipped.slice(0, 4), 'timsrobot.com/mine'], 'shipped order, the user\'s own mod after, one they deleted skipped');
  assert.deepStrictEqual(ids(lib.orderMods(natural, undefined)), ids(natural), 'until the user drags');
  const theirs = ['timsrobot.com/mine', 'timsrobot.com/fireworks'];
  assert.deepStrictEqual(ids(lib.orderMods(natural, theirs)),
    ['timsrobot.com/mine', 'timsrobot.com/fireworks', 'timsrobot.com/tagline', 'timsrobot.com/jelly', 'timsrobot.com/gravity']);
  // Dragged back into the default order: the user's entry goes, and the default applies again.
  assert.deepStrictEqual(lib.setModOrder({ 'timsrobot.com': theirs }, 'timsrobot.com', ids(natural), ids(natural)), {});
});

test('background: TRIF on for timsrobot.com registers its mods, and nothing that marks the page', async () => {
  const bg = await loadBackground({ storage: { sitesOn: ['x.com'], mods: [mod('x.com/a'), mod('timsrobot.com/fireworks', { matches: ['https://timsrobot.com/*'] })] } });
  try {
    await settle(30);
    const panel = bg.connectPanel();
    const on = await panel.ask({ type: 'site.set', site: 'timsrobot.com', on: true });
    assert.strictEqual(on.ok, true, on.error);
    await settle(30);
    assert.ok(scriptIds(bg).includes('timsrobot.com/fireworks'));
    assert.ok(!scriptIds(bg).includes('trif-home'));
    assert.ok(!bg.chrome.userScripts.scripts.some((x) => x.js.some((j) => String(j.code).includes('data-trif'))));
  } finally { bg.restore(); }
});

test('background: the helper\'s default order for shipped mods is kept in storage for the panel, and replaced when it changes', async () => {
  const order = { 'timsrobot.com': ['timsrobot.com/b', 'timsrobot.com/a'] };
  const bg = await loadBackground();
  try {
    bg.native.emit({ type: 'mods', mods: [mod('timsrobot.com/a'), mod('timsrobot.com/b')], defaultOrder: { ...order, junk: 'no' } });
    await settle(30);
    assert.deepStrictEqual(bg.store.defaultOrder, order);
    assert.ok(!('modOrder' in bg.store), 'the user\'s own order isn\'t written');
    // A helper from before (no defaultOrder): none.
    bg.native.emit({ type: 'mods', mods: [mod('timsrobot.com/a')] });
    await settle(30);
    assert.deepStrictEqual(bg.store.defaultOrder, {});
  } finally { bg.restore(); }
});

test('renameInOrder: a renamed mod keeps its place in every site\'s order', () => {
  const order = { 'x.com': ['x.com/c', 'x.com/wobble', 'all-sites/glow'], 'y.com': ['all-sites/glow', 'y.com/a'] };
  const r = lib.renameInOrder(order, [{ from: 'x.com/wobble', to: 'x.com/jelly' }, { from: 'all-sites/glow', to: 'all-sites/shine' }]);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.modOrder, { 'x.com': ['x.com/c', 'x.com/jelly', 'all-sites/shine'], 'y.com': ['all-sites/shine', 'y.com/a'] });
  assert.deepStrictEqual(order['x.com'], ['x.com/c', 'x.com/wobble', 'all-sites/glow'], 'pure');
  assert.strictEqual(lib.renameInOrder(order, [{ from: 'z.com/q', to: 'z.com/r' }]).changed, false);
  assert.deepStrictEqual(lib.renameInOrder(order, [{ from: 'x.com/c', to: 'x.com/wobble' }, { from: 'x.com/wobble', to: 'x.com/c' }]).modOrder['x.com'],
    ['x.com/wobble', 'x.com/c', 'all-sites/glow'], 'a swap');
});

test('background: a mod file renamed on disk keeps its switch, its per-site switches and its place in the panel', async () => {
  const W = 'x.com/wobble';
  const J = 'x.com/jelly';
  const G = 'all-sites/glow';
  const glow = (id) => mod(id, { site: 'all-sites', matches: ['*://*/*'], code: 'GLOW' });
  const bg = await loadBackground({ storage: {
    sitesOn: ['x.com', 'y.com'], disabled: { [W]: true }, offSites: { [G]: ['y.com'] }, startedOff: {},
    modOrder: { 'x.com': [G, W, 'x.com/other'] },
    mods: [mod(W, { code: 'WOBBLE' }), mod('x.com/other'), glow(G)],
  } });
  try {
    // Renamed (in an editor, by an agent's mv…); the new one is also marked startOff, as a shipped mod would be.
    bg.native.emit({ type: 'mods', mods: [mod(J, { code: 'WOBBLE', startOff: true }), mod('x.com/other'), glow('all-sites/shine')] });
    await settle(40);
    assert.deepStrictEqual(bg.store.disabled, { [J]: true }, 'still off, under its new name; no dead entry');
    assert.deepStrictEqual(bg.store.offSites, { 'all-sites/shine': ['y.com'] }, 'still off on y.com');
    assert.deepStrictEqual(bg.store.modOrder, { 'x.com': ['all-sites/shine', J, 'x.com/other'] });
    assert.ok(!scriptIds(bg).includes(J), 'off: not registered');
    assert.ok(scriptIds(bg).includes('all-sites/shine') && !scriptIds(bg).includes(G));
    // Its switch is the user's: on again, it stays on (the startOff above was already spent by the rename).
    const r = await bg.native.call('mod.enable', { id: J, enabled: true });
    assert.strictEqual(r.ok, true, r.error);
    bg.native.emit({ type: 'mods', mods: [mod(J, { code: 'WOBBLE', startOff: true, hash: 'h2' }), mod('x.com/other'), glow('all-sites/shine')] });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, {});
    // The panel's status has the new file name.
    const reply = await bg.connectPanel().ask({ type: 'status' });
    assert.ok(reply.ok, JSON.stringify(reply));
    assert.deepStrictEqual(reply.result.mods.map((m) => [m.id, m.file, m.enabled]),
      [[J, '/w/sites/x.com/jelly.js', true], ['x.com/other', '/w/sites/x.com/other.js', true], ['all-sites/shine', '/w/sites/all-sites/shine.js', true]]);
  } finally { bg.restore(); }
});

test('background: the hello carries an install id that persists across a service worker restart', async () => {
  // Every hello on this instance's native ports (an earlier test's background may reconnect onto the
  // newest chrome mock under load, so natives[0] isn't necessarily ours).
  const hellos = (bg) => bg.natives.flatMap((p) => p.sent).filter((m) => m.type === 'hello').map((m) => m.installId);
  const bg = await loadBackground();
  let id;
  try {
    id = bg.store.installId;
    assert.match(String(id), /^[0-9a-f-]{36}$/);
    assert.ok(hellos(bg).includes(id), 'the hello carries the stored install id');
  } finally { bg.restore(); }
  const bg2 = await loadBackground({ storage: { installId: id } });
  try {
    assert.strictEqual(bg2.store.installId, id, 'kept, not regenerated');
    assert.ok(hellos(bg2).includes(id));
  } finally { bg2.restore(); }
});

test('background: a mod made in another browser arrives switched off, once; the panel says where it came from', async () => {
  const mods = [
    mod('x.com/theirs', { origin: { by: 'other-install', browser: 'Firefox' } }),
    mod('x.com/mine', { origin: { by: 'me', browser: 'Chrome' } }),
    mod('x.com/plain'),
  ];
  const bg = await loadBackground({ storage: { installId: 'me' }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, { 'x.com/theirs': true });
    assert.deepStrictEqual(bg.store.startedOff, { 'x.com/theirs': true });
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/mine', 'x.com/plain']);
    const panel = bg.connectPanel();
    let st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual(st.mods.map((m) => [m.id, m.enabled, m.from]),
      [['x.com/theirs', false, 'Firefox'], ['x.com/mine', true, null], ['x.com/plain', true, null]]);

    // The user switches it on here; the next mods message doesn't switch it off again.
    const r = await bg.native.call('mod.enable', { id: 'x.com/theirs', enabled: true });
    assert.strictEqual(r.ok, true, r.error);
    bg.native.emit({ type: 'mods', mods: mods.map((m) => ({ ...m, hash: 'h2' })) });
    await settle(30);
    assert.deepStrictEqual(bg.store.disabled, {});
    assert.ok(scriptIds(bg).includes('x.com/theirs'));
    st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual(st.mods.find((m) => m.id === 'x.com/theirs').enabled, true);
  } finally { bg.restore(); }
});

test('background: deleting from the panel leaves a chat line with Undo; restoring says how its switch is', async () => {
  const bg = await loadBackground({ storage: { disabled: { 'x.com/quiet': true }, offSites: { 'all-sites/dark': ['bank.com'] } } });
  try {
    const panel = bg.connectPanel();
    let p = panel.ask({ type: 'mod.delete', id: 'x.com/quiet', site: 'x.com' });
    await answerNative(bg.native, 'mod.delete', { id: 'x.com/quiet', deleted: true });
    assert.strictEqual((await p).ok, true);
    await settle(10);
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.map((m) => [m.role, m.text, m.undo, m.undone]),
      [['mod', 'quiet.js was deleted.', 'x.com/quiet', undefined]]);

    p = panel.ask({ type: 'mod.restore', id: 'x.com/quiet', site: 'x.com' });
    await answerNative(bg.native, 'mod.restore', { id: 'x.com/quiet', restored: true });
    assert.strictEqual((await p).ok, true);
    await settle(10);
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.map((m) => [m.text, m.undone]),
      [['quiet.js was deleted.', true], ['quiet.js was restored (off, as before).', undefined]]);

    p = panel.ask({ type: 'mod.delete', id: 'all-sites/dark', site: 'x.com' });
    await answerNative(bg.native, 'mod.delete', { id: 'all-sites/dark', deleted: true });
    await p;
    p = panel.ask({ type: 'mod.restore', id: 'all-sites/dark', site: 'x.com' });
    await answerNative(bg.native, 'mod.restore', { id: 'all-sites/dark', restored: true });
    await p;
    await settle(10);
    assert.strictEqual(bg.store['chat:x.com'].messages.at(-1).text, 'dark.js was restored (on except on bank.com, as before).');
  } finally { bg.restore(); }
});

test('background: a shipped mod\'s new version: status carries it; use it (chat line with Undo), keep mine, merge as a run', async () => {
  const mods = [mod('x.com/detox-timeline', { source: 'trif', version: '1', update: { version: '2', from: '1', modified: true } })];
  const bg = await loadBackground({ storage: { mods } });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    const panel = bg.connectPanel();
    const st = (await panel.ask({ type: 'status' })).result;
    const m = st.mods.find((x) => x.id === 'x.com/detox-timeline');
    assert.deepStrictEqual([m.source, m.version, m.update], ['trif', '1', { version: '2', from: '1', modified: true }]);

    let p = panel.ask({ type: 'mod.update', id: 'x.com/detox-timeline', choice: 'new', site: 'x.com' });
    let req = await answerNative(bg.native, 'mod.update', { id: 'x.com/detox-timeline', choice: 'new', version: '2', trashed: true });
    assert.deepStrictEqual(req.args, { id: 'x.com/detox-timeline', choice: 'new' });
    assert.strictEqual((await p).ok, true);
    await settle(10);
    assert.deepStrictEqual(bg.store['chat:x.com'].messages.map((x) => [x.role, x.text, x.undo]),
      [['mod', 'detox-timeline.js is now version 2 from TRIF; yours is in the trash.', 'x.com/detox-timeline']]);

    p = panel.ask({ type: 'mod.update', id: 'x.com/detox-timeline', choice: 'mine', site: 'x.com' });
    req = await answerNative(bg.native, 'mod.update', { id: 'x.com/detox-timeline', choice: 'mine', version: '2' });
    assert.deepStrictEqual(req.args, { id: 'x.com/detox-timeline', choice: 'mine' });
    await p;
    await settle(10);
    assert.strictEqual(bg.store['chat:x.com'].messages.length, 1, 'keeping mine adds no line');

    p = panel.ask({ type: 'agent.start', site: 'x.com', tabId: 12, url: 'https://x.com/home', prompt: 'Merge the new version', merge: 'x.com/detox-timeline' });
    req = await answerNative(bg.native, 'agent.start', { runId: 'r9' });
    assert.strictEqual(req.args.merge, 'x.com/detox-timeline');
    await p;
  } finally { bg.restore(); }
});

test('background: deleting or restoring reloads the tab only when the mod runs there (on, not off on the site)', async () => {
  const mods = [mod('x.com/on'), mod('x.com/off'), mod('x.com/offhere')];
  const bg = await loadBackground({ storage: { mods, disabled: { 'x.com/off': true }, offSites: { 'x.com/offhere': ['x.com'] } }, tabs: SWITCH_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    const panel = bg.connectPanel();
    const roundTrip = async (id) => {
      let p = panel.ask({ type: 'mod.delete', id, site: 'x.com', tab: 5 });
      await answerNative(bg.native, 'mod.delete', { id, deleted: true });
      await p;
      p = panel.ask({ type: 'mod.restore', id, site: 'x.com', tab: 5 });
      await answerNative(bg.native, 'mod.restore', { id, restored: true });
      await p;
      await settle(10);
    };
    await roundTrip('x.com/off');
    await roundTrip('x.com/offhere');
    assert.deepStrictEqual(bg.reloaded, []);
    await roundTrip('x.com/on');
    assert.deepStrictEqual(bg.reloaded, [5, 5]);
  } finally { bg.restore(); }
});

// ------------------------------------------------------------------ sites TRIF is on for

test('scopeFor matches the helper\'s', async () => {
  const { scopeFor } = require('../helper/lib/scope');
  for (const h of ['x.com', 'www.x.com', 'm.x.com', 'news.bbc.co.uk', 'user.github.io', 'a.b.user.github.io', 'localhost', '127.0.0.1', 'X.COM.', 'shop.example.com:8080']) {
    assert.strictEqual(lib.scopeFor(h), scopeFor(h), h);
  }
});

test('siteOnFor, sitesInUse and limitToSites', () => {
  const on = ['bbc.co.uk', 'x.com'];
  assert.strictEqual(lib.siteOnFor('https://m.x.com/a', on), 'x.com');
  assert.strictEqual(lib.siteOnFor('https://notx.com/', on), null);
  assert.strictEqual(lib.siteOnFor('file:///Users/x.com', on), null);
  assert.deepStrictEqual(lib.sitesInUse(
    [mod('www.x.com/a'), mod('off.com/b'), mod('all-sites/dark'), mod('held.com/c', { held: { reason: 'r' } })],
    { 'off.com/b': true },
    { 'news.bbc.co.uk': { messages: [{ role: 'user' }] }, 'empty.com': { messages: [] } }), ['bbc.co.uk', 'x.com']);

  const wide = { id: 'all-sites/d', hash: 'h', matches: ['*://*/*', '<all_urls>', 'https://x.com/home*', '*://*.co.uk/*', '*://evil.com/*', 'file:///*', '*://localhost:3000/*'] };
  assert.deepStrictEqual(lib.limitToSites(wide, on), { ...wide, hash: 'h|sites:bbc.co.uk,x.com',
    matches: ['*://*.bbc.co.uk/*', '*://*.x.com/*', '*://bbc.co.uk/*', '*://x.com/*', 'https://x.com/home*'] });
  assert.strictEqual(lib.limitToSites(mod('bank.com/a'), on), null);
  assert.strictEqual(lib.limitToSites(wide, []), null);
  assert.deepStrictEqual(lib.limitToSites(mod('m.x.com/a', { matches: ['*://m.x.com/*'] }), on).matches, ['*://m.x.com/*']);
  // An exact host never covers another site, even a subdomain of it.
  assert.strictEqual(lib.limitToSites({ matches: ['*://co.uk/*'] }, on), null);
});

test('syncUserScripts with sitesOn: mods and the runtime only on those sites; recording too', async () => {
  const us = mockUserScripts();
  const r = await lib.syncUserScripts(us, {
    mods: [mod('x.com/a'), mod('bank.com/b'), mod('all-sites/dark', { matches: ['*://*/*'] })],
    runtimeCode: rt.runtimeCode([]), recording: ['news.com', 'x.com'], sitesOn: ['x.com'],
  });
  assert.deepStrictEqual(r.registered, ['x.com/a', 'all-sites/dark']);
  assert.deepStrictEqual(us.scripts.map((s) => [s.id, s.matches]), [
    [lib.RUNTIME_ID, ['*://*.x.com/*', '*://x.com/*']],
    ['x.com/a', ['*://x.com/*']],
    ['all-sites/dark', ['*://*.x.com/*', '*://x.com/*']],
  ]);
  const none = mockUserScripts();
  await lib.syncUserScripts(none, { mods: [mod('x.com/a')], runtimeCode: rt.runtimeCode([]), recording: ['x.com'], sitesOn: [] });
  assert.deepStrictEqual(none.scripts, []);
});

const GATE_TABS = [
  { id: 5, windowId: 1, index: 0, active: true, url: 'https://x.com/home', title: 'X' },
  { id: 6, windowId: 1, index: 1, active: false, url: 'https://bank.com/', title: 'Bank' },
];

test('background: page commands and chats only reach sites TRIF is on for', async () => {
  const bg = await loadBackground({ storage: { sitesOn: ['x.com'] }, tabs: GATE_TABS });
  try {
    let r = await bg.native.call('tabs');
    assert.deepStrictEqual(r.result.map((t) => t.id), [5]);
    for (const [cmd, args] of [['text', { tab: 6 }], ['reload', { tab: 6 }], ['open', { to: 'https://bank.com/' }], ['navigate', { tab: 5, to: 'bank.com' }], ['record', { site: 'bank.com' }]]) {
      r = await bg.native.call(cmd, args);
      assert.strictEqual(r.ok, false, cmd);
      assert.match(r.error, /TRIF is off on bank\.com/, cmd);
    }
    const panel = bg.connectPanel();
    r = await panel.ask({ type: 'agent.start', site: 'bank.com', tabId: 6, url: 'https://bank.com/', prompt: 'hi' });
    assert.deepStrictEqual([r.ok, r.error], [false, 'TRIF is off on bank.com: turn it on first']);
    assert.strictEqual(bg.natives[0].sent.some((m) => m.cmd === 'agent.start'), false);
  } finally { bg.restore(); }
});

test('background: the panel\'s site switch turns a site on and off, applying mods and reloading if one runs there', async () => {
  const mods = [mod('bank.com/a'), mod('all-sites/dark', { matches: ['*://*/*'] })];
  const bg = await loadBackground({ storage: { mods, sitesOn: [] }, tabs: GATE_TABS });
  try {
    bg.native.emit({ type: 'mods', mods });
    await settle(20);
    assert.deepStrictEqual(scriptIds(bg), []);
    const panel = bg.connectPanel();
    let r = await panel.ask({ type: 'site.set', site: 'www.bank.com', on: true, tab: 6 });
    assert.deepStrictEqual(r.result, { site: 'bank.com', on: true, sitesOn: ['bank.com'] });
    assert.deepStrictEqual(bg.store.sitesOn, ['bank.com']);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'bank.com/a', 'all-sites/dark']);
    assert.deepStrictEqual(bg.reloaded, [6]);
    r = await panel.ask({ type: 'site.set', site: 'bank.com', on: false, tab: 6 });
    assert.deepStrictEqual(bg.store.sitesOn, []);
    assert.deepStrictEqual(scriptIds(bg), []);
    assert.deepStrictEqual(bg.reloaded, [6, 6]);
    await panel.ask({ type: 'site.set', site: 'x.com', on: true, tab: 5 });
    assert.deepStrictEqual(bg.reloaded, [6, 6, 5], 'the all-sites mod now runs on x.com');
  } finally { bg.restore(); }
});

test('background: updating from before sites had to be turned on keeps TRIF on where it was in use', async () => {
  const bg = await loadBackground({ migrate: true, storage: {
    mods: [mod('x.com/a'), mod('off.com/b'), mod('all-sites/dark', { matches: ['*://*/*'] })],
    disabled: { 'off.com/b': true },
    'chat:news.bbc.co.uk': { messages: [{ role: 'user', text: 'hi', time: 1 }] },
  } });
  try {
    await settle(10);
    assert.deepStrictEqual(bg.store.sitesOn, ['bbc.co.uk', 'x.com']);
  } finally { bg.restore(); }
});

test('applyStartSites turns each offered site on once', () => {
  let r = lib.applyStartSites(['x.com'], [], ['www.google.com', 'x.com']);
  assert.deepStrictEqual(r, { sitesOn: ['google.com', 'x.com'], offered: ['google.com', 'x.com'], changed: true });
  // The user turned google.com off: offered again, it stays off.
  r = lib.applyStartSites(['x.com'], r.offered, ['google.com', 'x.com']);
  assert.deepStrictEqual(r, { sitesOn: ['x.com'], offered: ['google.com', 'x.com'], changed: false });
  assert.strictEqual(lib.applyStartSites([], [], undefined).changed, false);
});

test('background: the helper\'s start sites are turned on once, and mods for them registered', async () => {
  const mods = [mod('www.google.com/a', { matches: ['*://www.google.com/*'] })];
  const bg = await loadBackground({ storage: { sitesOn: [] } });
  try {
    bg.native.emit({ type: 'mods', mods, sitesOn: ['google.com', 'x.com'] });
    await settle(20);
    assert.deepStrictEqual(bg.store.sitesOn, ['google.com', 'x.com']);
    assert.deepStrictEqual(bg.store.sitesOffered, ['google.com', 'x.com']);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'www.google.com/a']);
    const panel = bg.connectPanel();
    await panel.ask({ type: 'site.set', site: 'google.com', on: false });
    bg.native.emit({ type: 'mods', mods, sitesOn: ['google.com', 'x.com'] });
    await settle(20);
    assert.deepStrictEqual(bg.store.sitesOn, ['x.com'], 'turned off by the user: stays off');
  } finally { bg.restore(); }
});

test('normalizeStarter: Tim\'s mods by site, cleaned up; siteNames', () => {
  assert.strictEqual(lib.normalizeStarter(null), null);
  assert.strictEqual(lib.normalizeStarter({ sites: 3 }), null);
  const r = lib.normalizeStarter({ chosen: false, sites: [
    { site: 'www.google.com', name: 'Google', choice: 'added', suggested: true, mods: [{ id: 'www.google.com/a', name: 'A', description: 'does a', on: 1, choice: 'skipped' }] },
    { site: 'google.com', name: 'Again', mods: [{ id: 'www.google.com/b' }] }, // (the same site twice: the first)
    { site: 'x.com', choice: 'maybe', mods: [] }, // (no mods: left out)
    { site: 'timsrobot.com', note: 'for TRIF’s own demo', mods: [{ id: 'timsrobot.com/r', name: '', description: 7 }], choice: 'none' },
    'junk',
  ] });
  assert.deepStrictEqual(r, { chosen: true, sites: [
    { site: 'google.com', name: 'Google', note: '', choice: 'added', suggested: true, mods: [{ id: 'www.google.com/a', name: 'A', description: 'does a', on: true, choice: 'skipped' }] },
    { site: 'timsrobot.com', name: 'timsrobot.com', note: 'for TRIF’s own demo', choice: 'none', suggested: false, mods: [{ id: 'timsrobot.com/r', name: 'timsrobot.com/r', description: '', on: false, choice: null }] },
  ] });
  assert.deepStrictEqual(['', 'X', 'X and Google', 'X, Google and Amazon'], [[], ['X'], ['X', 'Google'], ['X', 'Google', 'Amazon']].map(lib.siteNames));
});

test('applyReadded: one of Tim\'s mods deleted and added again is switched as listed, once per stamp', () => {
  const mods = [mod('x.com/a', { readded: 's1', startOff: true }), mod('x.com/b', { readded: 's1' }), mod('x.com/c')];
  let r = lib.applyReadded(mods, { 'x.com/b': true }, {});
  assert.deepStrictEqual(r, { disabled: { 'x.com/a': true }, readded: { 'x.com/a': 's1', 'x.com/b': 's1' }, changed: true });
  // After that the switch is the user's: the same stamp changes nothing; a new one switches it again.
  const again = lib.applyReadded(mods, {}, r.readded);
  assert.strictEqual(again.changed, false);
  r = lib.applyReadded([mod('x.com/a', { readded: 's2', startOff: true })], {}, r.readded);
  assert.deepStrictEqual(r.disabled, { 'x.com/a': true });
  assert.deepStrictEqual(lib.normalizeReadded({ a: 's', b: 3, c: null }), { a: 's' });
});

test('background: Tim\'s mods by site come with the mods; the panel\'s choice goes to the helper, and a site\'s tab reloads when one now runs there', async () => {
  const tabs = [{ id: 5, windowId: 1, active: true, url: 'https://x.com/home' }];
  const bg = await loadBackground({ storage: { sitesOn: [] }, tabs });
  try {
    const panel = bg.connectPanel();
    const starter = (choice) => ({ chosen: !!choice, sites: [{ site: 'x.com', name: 'X', note: '', choice, suggested: true, mods: [{ id: 'x.com/a', name: 'A', description: '', on: true, choice: choice === 'added' ? 'added' : null }] }] });
    assert.strictEqual((await panel.ask({ type: 'status' })).result.starter, null, 'not connected yet: unknown');
    bg.native.emit({ type: 'mods', mods: [], sitesOn: [], starter: starter(null) });
    await settle(20);
    assert.deepStrictEqual((await panel.ask({ type: 'status' })).result.starter, starter(null));
    assert.ok(panel.sent.some((m) => m.type === 'statusChanged'));
    // "Add Tim's mods for X" on x.com's panel: the helper sends the mods (with the site to turn on), then answers.
    const asked = panel.ask({ type: 'shipped.install', sites: ['www.x.com', 'x.com'], tab: 5, others: 'nope' });
    let req;
    for (let i = 0; i < 200 && !(req = bg.native.sent.find((m) => m.type === 'request' && m.cmd === 'shipped.install')); i++) await tick();
    assert.deepStrictEqual(req.args, { sites: ['x.com'] }, 'scopes, once; `others` only as "none"');
    bg.native.emit({ type: 'mods', mods: [mod('x.com/a', { matches: ['https://x.com/*'] })], sitesOn: ['x.com'], starter: starter('added') });
    await answerNative(bg.native, 'shipped.install', { added: ['x.com/a'], sitesOn: ['x.com'], starter: starter('added') });
    const r = await asked;
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(bg.store.sitesOn, ['x.com']);
    assert.deepStrictEqual(bg.reloaded, [5], 'the tab, where the mod runs now');
    assert.strictEqual((await panel.ask({ type: 'status' })).result.starter.sites[0].choice, 'added');
    // The setup page's "Add these": the ticked mods (ids only; the rest none), and "Start with none": no tab, nothing reloads.
    const these = panel.ask({ type: 'shipped.install', ids: ['amazon.com/simple-home', 'amazon.com/simple-home', '../etc', 7], sites: ['x.com'], others: 'none' });
    const req2 = await answerNative(bg.native, 'shipped.install', { added: [], sitesOn: [] });
    assert.deepStrictEqual(req2.args, { ids: ['amazon.com/simple-home'], others: 'none' }, 'mod ids, once; nothing that isn\'t one');
    assert.strictEqual((await these).ok, true);
    const none = panel.ask({ type: 'shipped.none' });
    await answerNative(bg.native, 'shipped.none', { starter: starter('none') });
    assert.strictEqual((await none).ok, true);
    assert.deepStrictEqual(bg.reloaded, [5]);
  } finally { bg.restore(); }
});

test('agent and model per site chat: each site its own pick; the default is the last pick; a panel holds what it first saw', () => {
  // The old single setting carries over as the default (and the even older `model` as Claude Code's).
  assert.deepEqual(lib.normalizeSettings({ agent: 'codex', model: 'opus' }), { agent: 'codex', models: { claude: 'opus' } });
  assert.deepEqual(lib.normalizeSettings(null), { agent: '', models: {} });
  assert.deepEqual(lib.normalizePicks({ 'x.com': { agent: 'codex', models: { codex: 'sol' } }, bad: 3, '': {} }), { 'x.com': { agent: 'codex', models: { codex: 'sol' } } });
  const global = { agent: 'claude', models: { claude: 'opus' } };
  const picks = { 'chatgpt.com': { agent: 'codex', models: { codex: 'astra' } }, 'x.com': { agent: 'codex', models: { codex: 'sol' } } };
  const panelA = new Map();
  const panelB = new Map();
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelA, global, site: 'x.com' }), { agent: 'codex', models: { codex: 'sol' } });
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelA, global, site: 'chatgpt.com' }), { agent: 'codex', models: { codex: 'astra' } });
  // A site without a pick: the default, as this panel first saw it...
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelA, global, site: 'github.com' }), global);
  // ...so a pick in another panel (which also becomes the default) doesn't change what this one shows.
  const global2 = { agent: 'codex', models: { codex: 'sol', claude: 'opus' } };
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelA, global: global2, site: 'github.com' }), global);
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelB, global: global2, site: 'github.com' }), lib.normalizeSettings(global2), 'a panel opening now starts from the new default');
  global.models.claude = 'haiku';
  assert.equal(lib.siteSettings({ picks, snapshots: panelA, global, site: 'github.com' }).models.claude, 'opus', 'a copy, not the default itself');
  // No site (chrome://extensions): the default itself.
  assert.deepEqual(lib.siteSettings({ picks, snapshots: panelA, global: global2, site: null }), lib.normalizeSettings(global2));
});

// ---- site access: the browser's OK for each site TRIF is on for ---------------------------------

test('site access: a site needs its domain and subdomains, http and https; <all_urls> or any host covers all', () => {
  // One pattern a site: *.x.com covers x.com itself too, so the browser's prompt lists the site once.
  assert.deepStrictEqual(lib.siteOrigins('x.com'), ['*://*.x.com/*']);
  assert.deepStrictEqual(lib.siteOrigins('127.0.0.1'), ['*://127.0.0.1/*'], 'an IP: just the address');
  assert.deepStrictEqual(lib.originsFor(['x.com', 'bbc.co.uk', 'x.com']), ['*://*.x.com/*', '*://*.bbc.co.uk/*']);
  const one = lib.normalizeAccess({ origins: ['*://*.x.com/*', '*://127.0.0.1/*'] });
  assert.ok(lib.hasSiteAccess(one, 'x.com') && lib.hasSiteAccess(one, '127.0.0.1'), 'the one pattern is enough, for a domain and an IP');
  assert.ok(!lib.hasSiteAccess(lib.normalizeAccess({ origins: ['*://x.com/*'] }), 'x.com'), 'the bare domain alone misses its subdomains');
  const acc = (origins) => lib.normalizeAccess({ origins, permissions: ['tabs'] });
  assert.deepStrictEqual(acc(['<all_urls>']), { origins: ['<all_urls>'], all: true, allUrls: true });
  assert.deepStrictEqual(acc(['*://*/*']), { origins: ['*://*/*'], all: true, allUrls: false }, 'every site, but not <all_urls> itself (screenshots)');
  assert.strictEqual(acc(['https://*/*']).all, false, 'https only');
  assert.strictEqual(acc(['https://*/*', 'http://*/*']).all, true);
  assert.deepStrictEqual(acc(undefined), { origins: [], all: false, allUrls: false });

  const site = acc(['*://x.com/*', '*://*.x.com/*', 'https://bank.com/*', '*://*.news.com/*', '*://a.com:8080/*']);
  assert.strictEqual(lib.hasSiteAccess(site, 'x.com'), true);
  assert.strictEqual(lib.hasSiteAccess(site, 'bank.com'), false, 'https only, and no subdomains');
  assert.strictEqual(lib.hasSiteAccess(site, 'news.com'), true, '*.news.com covers news.com itself');
  assert.strictEqual(lib.hasSiteAccess(site, 'a.com'), false, 'one port is not the site');
  assert.strictEqual(lib.hasSiteAccess(site, 'notx.com'), false);
  assert.strictEqual(lib.hasSiteAccess(acc(['*://x.com/*']), 'x.com'), false, 'without its subdomains');
  assert.strictEqual(lib.hasSiteAccess(acc(['*://x.com/path*', '*://*.x.com/path*']), 'x.com'), false, 'part of a site');
  assert.strictEqual(lib.hasSiteAccess(acc(['*://*.co.uk/*']), 'bbc.co.uk'), true);
  assert.strictEqual(lib.hasSiteAccess(acc(['<all_urls>']), 'anything.org'), true);
  assert.strictEqual(lib.hasSiteAccess(null, 'x.com'), false);
  assert.deepStrictEqual(lib.activeSites(['bank.com', 'x.com'], site), ['x.com']);
  assert.deepStrictEqual(lib.sitesWithoutAccess(['bank.com', 'x.com'], site), ['bank.com']);
});

test('readAccess: chrome.permissions.getAll, or everything where TRIF doesn\'t check (Safari, no API)', async () => {
  const api = { permissions: { getAll: async () => ({ origins: ['*://x.com/*', '*://*.x.com/*'], permissions: [] }) } };
  assert.deepStrictEqual(await lib.readAccess(api, true), { origins: ['*://*.x.com/*', '*://x.com/*'], all: false, allUrls: false });
  assert.strictEqual((await lib.readAccess(api, false)).all, true, 'Safari');
  assert.strictEqual((await lib.readAccess({}, true)).allUrls, true, 'no chrome.permissions');
});

const PER_SITE = (...sites) => lib.originsFor(sites);

test('siteState / siteRefusal / siteModeOf: on, off, disconnected, blocked, in the panel\'s words; the mode follows the grant', () => {
  const access = lib.normalizeAccess({ origins: PER_SITE('x.com', 'off.com') });
  const ctx = { sitesOn: ['x.com', 'gone.com'], access, blocked: ['bank.com'] };
  assert.deepStrictEqual(['x.com', 'off.com', 'gone.com', 'new.com', 'bank.com'].map((x) => lib.siteState(x, ctx)),
    ['on', 'off', 'disconnected', 'disconnected', 'blocked']);
  assert.strictEqual(lib.siteState('bank.com', { ...ctx, access: lib.ALL_ACCESS, sitesOn: ['bank.com'] }), 'blocked', 'whatever the access');
  assert.strictEqual(lib.siteState('anything.org', { access: lib.ALL_ACCESS }), 'off', 'permissive: never disconnected');
  assert.strictEqual(lib.siteRefusal('x.com', 'on'), null);
  assert.match(lib.siteRefusal('a.com', 'off'), /^TRIF is off on a\.com: .*turns it on/);
  assert.match(lib.siteRefusal('a.com', 'disconnected'), /^TRIF is disconnected on a\.com: .*until the user connects it/);
  assert.match(lib.siteRefusal('a.com', 'blocked'), /^a\.com is blocked in TRIF: .*only the user can unblock it/);
  assert.strictEqual(lib.siteModeOf(null, lib.ALL_ACCESS), 'permissive', 'an update that kept <all_urls>');
  assert.strictEqual(lib.siteModeOf('permissive', access), 'restrictive', '<all_urls> taken back');
  assert.strictEqual(lib.siteModeOf('restrictive', access), 'restrictive');
  assert.strictEqual(lib.siteModeOf(null, access), null, 'not chosen yet');
});

test('background: restrictive: a site without the browser\'s access is disconnected (on or not): no mods, no page commands, no chats, said why', async () => {
  const mods = [mod('x.com/a'), mod('bank.com/b'), mod('all-sites/dark', { matches: ['*://*/*'] })];
  const bg = await loadBackground({ storage: { mods, sitesOn: ['bank.com', 'x.com'] }, tabs: GATE_TABS, granted: PER_SITE('x.com') });
  try {
    await settle(20);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'x.com/a', 'all-sites/dark']);
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.find((s) => s.id === 'all-sites/dark').matches, ['*://*.x.com/*', '*://x.com/*']);
    let r = await bg.native.call('tabs');
    assert.deepStrictEqual(r.result.map((t) => t.id), [5]);
    r = await bg.native.call('text', { tab: 6 });
    assert.strictEqual(r.error, lib.siteRefusal('bank.com', 'disconnected'));
    r = await bg.native.call('status');
    assert.deepStrictEqual([r.result.sitesOn, r.result.disconnected, r.result.blockedSites, r.result.access.all, r.result.siteMode], [['bank.com', 'x.com'], ['bank.com'], [], false, null]);
    assert.strictEqual(r.result.mods.find((m) => m.id === 'bank.com/b').sitesOff, true);
    const panel = bg.connectPanel();
    const st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual([st.sitesOn, st.disconnected, st.siteAccess, st.access.origins], [['bank.com', 'x.com'], ['bank.com'], true, PER_SITE('x.com')]);
    r = await panel.ask({ type: 'agent.start', site: 'bank.com', tabId: 6, url: 'https://bank.com/', prompt: 'hi' });
    assert.deepStrictEqual([r.ok, r.error], [false, 'TRIF is disconnected on bank.com: connect it first']);
    // A run's guard in the page has only the sites TRIF works on.
    let guard = null;
    bg.chrome.scripting.executeScript = async ({ func, args }) => { if (func.name === 'pageGuard') guard = args[1]; return [{ result: 'stop here' }]; };
    await bg.native.call('text', { tab: 5 });
    assert.deepStrictEqual(guard, ['x.com']);
  } finally { bg.restore(); }
});

test('background: restrictive: Connect needs the browser\'s OK; off keeps it (on again asks nothing); Disconnect gives it back; taken back in the browser, it stops', async () => {
  const mods = [mod('bank.com/a')];
  const bg = await loadBackground({ storage: { mods, sitesOn: [], siteMode: 'restrictive' }, tabs: GATE_TABS, granted: [] });
  try {
    const panel = bg.connectPanel();
    // A first visit: disconnected.
    assert.strictEqual((await bg.native.call('text', { tab: 6 })).error, lib.siteRefusal('bank.com', 'disconnected'));
    // No OK (the user said no to the browser's prompt): nothing saved.
    let r = await panel.ask({ type: 'site.set', site: 'bank.com', on: true, tab: 6 });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(bg.store.sitesOn, []);
    // Connect: the panel asked and the user said yes (the grant can land before permissions.onAdded is handled).
    bg.perms.origins = PER_SITE('bank.com');
    r = await panel.ask({ type: 'site.set', site: 'bank.com', on: true, tab: 6 });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'bank.com/a']);
    // Off: the access stays, so on again needs nothing from the browser.
    await panel.ask({ type: 'site.set', site: 'bank.com', on: false, tab: 6 });
    assert.deepStrictEqual([bg.perms.removed, bg.perms.origins, scriptIds(bg)], [[], PER_SITE('bank.com'), []]);
    assert.strictEqual((await bg.native.call('text', { tab: 6 })).error, lib.siteRefusal('bank.com', 'off'));
    assert.strictEqual((await panel.ask({ type: 'site.set', site: 'bank.com', on: true, tab: 6 })).ok, true);
    // Disconnect: off, and the access given back.
    r = await panel.ask({ type: 'site.disconnect', site: 'bank.com', tab: 6 });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual([bg.store.sitesOn, bg.perms.removed, bg.perms.origins, scriptIds(bg)], [[], [PER_SITE('bank.com')], [], []]);
    assert.strictEqual((await bg.native.call('text', { tab: 6 })).error, lib.siteRefusal('bank.com', 'disconnected'));
    // Connected again, then taken back in chrome://extensions: mods go, runs there stop, the panel hears of it.
    bg.perms.origins = PER_SITE('bank.com');
    await panel.ask({ type: 'site.set', site: 'bank.com', on: true, tab: 6 });
    const start = panel.ask({ type: 'agent.start', site: 'bank.com', tabId: 6, url: 'https://bank.com/', prompt: 'hi' });
    await answerNative(bg.native, 'agent.start', { runId: 'r1' });
    assert.strictEqual((await start).ok, true);
    panel.sent.length = 0;
    bg.perms.revoke(PER_SITE('bank.com'));
    await settle(30);
    assert.deepStrictEqual(scriptIds(bg), []);
    assert.ok(bg.natives[0].sent.some((m) => m.cmd === 'agent.stop' && m.args.runId === 'r1'), 'the run there is stopped');
    assert.ok(panel.sent.some((m) => m.type === 'statusChanged'));
    assert.deepStrictEqual([bg.store.sitesOn, (await panel.ask({ type: 'status' })).result.disconnected], [['bank.com'], ['bank.com']]);
    bg.perms.grant(PER_SITE('bank.com'));
    await settle(30);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'bank.com/a']);
  } finally { bg.restore(); }
});

test('background: the mode follows the grant: <all_urls> is permissive (an update too); restrictive from the panel gives every site back, no prompt', async () => {
  const bg = await loadBackground({ storage: { mods: [mod('bank.com/a')], sitesOn: ['bank.com'] }, tabs: GATE_TABS, granted: ['<all_urls>', ...PER_SITE('x.com')] });
  try {
    await settle(20);
    assert.strictEqual(bg.store.siteMode, 'permissive', 'kept <all_urls> from an update: permissive');
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'bank.com/a']);
    const panel = bg.connectPanel();
    // Permissive: a single site can't be disconnected (blocking is TRIF's way there).
    let r = await panel.ask({ type: 'site.disconnect', site: 'bank.com' });
    assert.deepStrictEqual([r.ok, r.error], [false, "TRIF is permissive (every site), so one site can't be disconnected: switch to restrictive mode first"]);
    r = await panel.ask({ type: 'site.mode', mode: 'restrictive' });
    assert.deepStrictEqual(r.result, { siteMode: 'restrictive' });
    assert.deepStrictEqual([bg.perms.origins, bg.store.siteMode, scriptIds(bg)], [[], 'restrictive', []]);
    const st = (await panel.ask({ type: 'status' })).result;
    assert.deepStrictEqual([st.siteMode, st.disconnected, st.access.all], ['restrictive', ['bank.com'], false]);
    // Permissive again: the page's prompt said yes; the mode follows.
    bg.perms.grant(['<all_urls>']);
    await settle(30);
    assert.deepStrictEqual([bg.store.siteMode, scriptIds(bg)], ['permissive', [lib.RUNTIME_ID, 'bank.com/a']]);
    // Declined at setup: the page records restrictive (nothing to give back).
    const bg2 = await loadBackground({ storage: { sitesOn: [] }, granted: [] });
    try {
      const p2 = bg2.connectPanel();
      assert.strictEqual((await p2.ask({ type: 'status' })).result.siteMode, null);
      await p2.ask({ type: 'site.mode', mode: 'restrictive' });
      assert.deepStrictEqual([bg2.store.siteMode, bg2.perms.removed], ['restrictive', []]);
    } finally { bg2.restore(); }
  } finally { bg.restore(); }
});

test('background: the block list keeps TRIF off a site whatever its access: mods, page commands, screenshots, runs, turning on', async () => {
  const mods = [mod('bank.com/a'), mod('all-sites/dark', { matches: ['*://*/*'] })];
  for (const granted of [['<all_urls>'], PER_SITE('bank.com', 'x.com')]) {
    const bg = await loadBackground({ storage: { mods, sitesOn: ['bank.com', 'x.com'] }, tabs: GATE_TABS, granted });
    try {
      await settle(20);
      const panel = bg.connectPanel();
      let r = await panel.ask({ type: 'site.block', site: 'www.bank.com', blocked: true, tab: 6 });
      assert.strictEqual(r.ok, true, r.error);
      assert.deepStrictEqual([bg.store.blockedSites, bg.store.sitesOn], [['bank.com'], ['x.com']]);
      assert.deepStrictEqual(bg.perms.removed, [PER_SITE('bank.com')], 'its own access (a no-op under <all_urls>)');
      assert.ok(!scriptIds(bg).includes('bank.com/a'));
      assert.deepStrictEqual(bg.chrome.userScripts.scripts.find((s) => s.id === 'all-sites/dark').matches, ['*://*.x.com/*', '*://x.com/*']);
      for (const cmd of ['text', 'screenshot']) assert.strictEqual((await bg.native.call(cmd, { tab: 6 })).error, lib.siteRefusal('bank.com', 'blocked'));
      r = await panel.ask({ type: 'agent.start', site: 'bank.com', tabId: 6, url: 'https://bank.com/', prompt: 'hi' });
      assert.deepStrictEqual([r.ok, r.error], [false, 'bank.com is blocked in TRIF']);
      r = await panel.ask({ type: 'site.set', site: 'bank.com', on: true, tab: 6 });
      assert.deepStrictEqual([r.ok, r.error], [false, 'bank.com is blocked in TRIF: unblock it first.']);
      const st = (await bg.native.call('status')).result;
      assert.deepStrictEqual([st.blockedSites, st.disconnected], [['bank.com'], []]);
      // Unblocked: off (permissive) or disconnected (restrictive, its access went), as any site.
      await panel.ask({ type: 'site.block', site: 'bank.com', blocked: false });
      assert.deepStrictEqual(bg.store.blockedSites, []);
      const want = granted.includes('<all_urls>') ? 'TRIF is off on bank.com' : 'TRIF is disconnected on bank.com';
      assert.ok((await bg.native.call('text', { tab: 6 })).error.startsWith(want));
    } finally { bg.restore(); }
  }
});

test('background: sites setup turns on are disconnected until connected, then on; screenshots know whether TRIF has <all_urls>', async () => {
  const mods = [mod('www.google.com/a', { matches: ['*://www.google.com/*'] })];
  const bg = await loadBackground({ storage: { sitesOn: [] }, granted: [], tabs: [{ id: 5, windowId: 1, index: 0, active: true, url: 'https://www.google.com/' }],
    windows: { get: async () => ({ id: 1, state: 'normal' }) } });
  try {
    bg.native.emit({ type: 'mods', mods, sitesOn: ['google.com', 'x.com'] });
    await settle(20);
    assert.deepStrictEqual(bg.store.sitesOn, ['google.com', 'x.com']);
    assert.deepStrictEqual(scriptIds(bg), [], 'not connected yet: nothing registered');
    const panel = bg.connectPanel();
    assert.deepStrictEqual((await panel.ask({ type: 'status' })).result.disconnected, ['google.com', 'x.com']);
    // Connect on google.com: on at once (its mods run).
    bg.perms.grant(PER_SITE('google.com'));
    await settle(30);
    assert.deepStrictEqual(scriptIds(bg), [lib.RUNTIME_ID, 'www.google.com/a']);
    assert.deepStrictEqual((await panel.ask({ type: 'status' })).result.disconnected, ['x.com']);
    // A site's own access isn't enough for Chrome's captureVisibleTab: the screenshot says what to do.
    bg.chrome.tabs.captureVisibleTab = async () => { throw new Error("Either the '<all_urls>' or 'activeTab' permission is required."); };
    const r = await bg.native.call('screenshot', { tab: 5 });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /only after the user clicks the TRIF toolbar button on it/);
  } finally { bg.restore(); }
});

test('background (Safari): TRIF doesn\'t check site access (Safari asks per site itself)', async () => {
  const bg = await loadBackground({ safari: true, storage: { mods: [mod('bank.com/a')], sitesOn: ['bank.com'] }, granted: [] });
  try {
    await settle(20);
    assert.deepStrictEqual(scriptIds(bg).filter((id) => id !== lib.RUNTIME_ID), ['bank.com/a']);
  } finally { bg.restore(); }
});

// ---- mods sets in parts -------------------------------------------------------------------------

// A mods message cut into modsPart messages the way the helper does (helper/lib/mods.js modsParts).
function partsOf(msg, set, size = 50) {
  const json = JSON.stringify(msg);
  const out = [];
  for (let i = 0; i * size < json.length; i++) out.push(json.slice(i * size, (i + 1) * size));
  return out.map((data, i) => ({ type: 'modsPart', set, i, n: out.length, data }));
}

test('ModsParts: joins a set in order; a broken sequence is dropped with an error; a new set supersedes', () => {
  const msg = { type: 'mods', mods: [mod('x.com/a'), mod('x.com/b', { code: '"quotes" \\ é 😀' })], sitesOn: ['x.com'] };
  const parts = partsOf(msg, 's1', 40);
  assert.ok(parts.length > 3);
  const p = new lib.ModsParts();
  for (const part of parts.slice(0, -1)) assert.deepStrictEqual(p.push(part), {});
  assert.deepStrictEqual(p.push(parts.at(-1)), { message: msg });
  // Missing a part: dropped, and the rest of that set too.
  assert.match(p.push(parts[0]) && p.push(parts[2]).error, /got part 3 of \d+ after part 1/);
  assert.deepStrictEqual(p.push(parts[3]), {}, 'the rest of a dropped set is ignored: one error is enough');
  assert.deepStrictEqual(p.push(parts[0]), {}, 'its start again: a new try');
  for (const part of parts.slice(1, -1)) p.push(part);
  assert.deepStrictEqual(p.push(parts.at(-1)), { message: msg });
  // Without its start.
  assert.match(new lib.ModsParts().push(parts[1]).error, /part 2 of \d+ of mods set s1 came without the parts before it/);
  // Malformed.
  for (const bad of [{ ...parts[0], i: -1 }, { ...parts[0], n: 0 }, { ...parts[0], data: 5 }, { ...parts[0], set: '' }, { ...parts[0], i: 9, n: 3 }, null]) {
    assert.match(new lib.ModsParts().push(bad).error, /malformed/);
  }
  // Text that doesn't parse, or isn't a mods message.
  assert.match(new lib.ModsParts().push({ type: 'modsPart', set: 1, i: 0, n: 1, data: '{"type":"mo' }).error, /doesn't parse/);
  assert.match(new lib.ModsParts().push({ type: 'modsPart', set: 1, i: 0, n: 1, data: '{"type":"other"}' }).error, /isn't a mods message/);
  // A newer set's first part drops an unfinished older one, which is then ignored.
  const newer = partsOf({ ...msg, sitesOn: [] }, 's2', 40);
  const q = new lib.ModsParts();
  q.push(parts[0]); q.push(parts[1]);
  assert.deepStrictEqual(q.push(newer[0]), { superseded: 's1' });
  assert.deepStrictEqual(q.push(parts[2]), {}, 'the old set is gone, its parts ignored');
  for (const part of newer.slice(1, -1)) q.push(part);
  assert.ok(q.push(newer.at(-1)).message);
  const r = new lib.ModsParts();
  r.push(parts[0]);
  r.push(newer[0]);
  for (const part of newer.slice(1, -1)) r.push(part);
  assert.deepStrictEqual(r.push(newer.at(-1)).message.sitesOn, []);
  // The helper's own cutting (quotes, backslashes, text past ASCII, emoji) joins back to the same message.
  const { modsParts } = require('../helper/lib/mods');
  const big = { type: 'mods', mods: [mod('x.com/big', { code: `"\\ é 😀 \u2028`.repeat(200000) })], sitesOn: ['x.com'], defaultOrder: {} };
  const helperParts = modsParts(JSON.stringify(big), 'h-1').map((m) => JSON.parse(JSON.stringify(m)));
  assert.ok(helperParts.length > 2);
  const h = new lib.ModsParts();
  for (const part of helperParts.slice(0, -1)) assert.deepStrictEqual(h.push(part), {});
  assert.deepStrictEqual(h.push(helperParts.at(-1)), { message: big });
  // reset (a whole mods message came) says what it dropped.
  r.push(parts[0]);
  assert.strictEqual(r.reset(), 's1');
  assert.strictEqual(r.reset(), null);
});

test('background: hello says it takes mods in parts; a set in parts is applied once, whole, only after its last part', async () => {
  const bg = await loadBackground();
  try {
    await settle(10);
    const hello = bg.native.sent.find((m) => m.type === 'hello');
    assert.deepStrictEqual(hello.features, ['modsParts', 'modsSame']);
    const mods = [mod('x.com/a', { code: 'a()'.repeat(50) }), mod('x.com/b', { hash: 'hb' }), mod('y.com/c', { hash: 'hc' })];
    const parts = partsOf({ type: 'mods', mods, sitesOn: [] }, 's1', 100);
    for (const part of parts.slice(0, -1)) bg.native.emit(part);
    await settle(20);
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.map((s) => s.id), [], 'nothing until the last part');
    assert.ok(!bg.native.sent.some((m) => m.type === 'modsApplied'));
    bg.native.emit(parts.at(-1));
    await waitFor(() => bg.native.sent.some((m) => m.type === 'modsApplied'));
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.map((s) => s.id).sort(), ['webmods-runtime', 'x.com/a', 'x.com/b', 'y.com/c']);
    assert.deepStrictEqual(bg.store.modIds, ['x.com/a', 'x.com/b', 'y.com/c']);

    // A broken set changes nothing, is logged, and asks the helper to send it again.
    const next = partsOf({ type: 'mods', mods: [mod('x.com/a')], sitesOn: [] }, 's2', 100);
    bg.native.emit(next[0]);
    bg.native.emit(next[2]);
    await settle(20);
    const resend = bg.native.sent.find((m) => m.type === 'modsResend');
    assert.match(resend.reason, /mods set s2: got part 3 of \d+ after part 1/);
    assert.ok(bg.native.sent.some((m) => m.type === 'log' && m.level === 'error' && /mods set s2/.test(m.message)));
    for (const part of next.slice(3)) bg.native.emit(part);
    await settle(20);
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.map((s) => s.id).sort(), ['webmods-runtime', 'x.com/a', 'x.com/b', 'y.com/c'], 'the last whole set stays');

    // An unfinished set is superseded by a whole mods message (an older helper, or a set that fits).
    bg.native.emit(next[0]);
    bg.native.emit({ type: 'mods', mods: [mod('x.com/a')] });
    await waitFor(() => bg.chrome.userScripts.scripts.length === 2);
    for (const part of next.slice(1)) bg.native.emit(part);
    await settle(20);
    assert.strictEqual(bg.native.sent.filter((m) => m.type === 'modsResend').length, 1, 'one request per broken set; the rest of a superseded one is ignored');
    assert.deepStrictEqual(bg.chrome.userScripts.scripts.map((s) => s.id).sort(), ['webmods-runtime', 'x.com/a']);
  } finally { bg.restore(); }
});

const fs = require('node:fs');
const path = require('node:path');
test('panel markup: Settings is a labelled region with a heading; the instructions box\'s note is announced', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.html'), 'utf8');
  assert.match(html, /<section id="settings"[^>]*aria-labelledby="settings-title"/);
  assert.match(html, /<h2 id="settings-title"[^>]*>Settings<\/h2>/);
  assert.match(html, /<textarea id="instructions"[^>]*aria-describedby="instructions-note"/);
  assert.match(html, /<p id="instructions-note"[^>]*role="status"/);
  // each mod's name is a heading (heading navigation goes mod to mod)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8'), /const name = el\('h3', 'mod-name'\)/);
});

test('runtime: errors no mod threw are the page\'s own, kept apart (trif errors --page)', () => {
  const page = makePage();
  const W = loadRuntime(page);
  const fire = (type, ev) => { for (const fn of page.__listeners[type] || []) fn(ev); };
  fire('error', { error: new Error('Unexpected token } in JSON'), filename: 'https://x.com/app.js', lineno: 12 });
  fire('error', { error: Object.assign(new Error('from a mod'), { stack: 'Error: from a mod\n    at trif://x.com/boom.js:1:1' }), filename: 'trif://x.com/boom.js' });
  fire('unhandledrejection', { reason: 'nope' });
  assert.deepStrictEqual(plain(W.errors.map((e) => e.mod)), ['x.com/boom']);
  assert.deepStrictEqual(plain(W.pageErrors.map((e) => [e.message, e.source])), [['Unexpected token } in JSON', 'https://x.com/app.js:12'], ['nope', '']]);
});

test('groups: switched off per site, page scripts and rules apart; registration leaves those sites out', async () => {
  let g = lib.switchGroup({}, 'www.X.com', 'page', false);
  assert.deepStrictEqual(g, { 'x.com': ['page'] });
  assert.strictEqual(lib.groupOffOn(g, 'page', 'm.x.com'), true);
  assert.strictEqual(lib.groupOffOn(g, 'rules', 'x.com'), false);
  assert.deepStrictEqual(lib.switchGroup(g, 'x.com', 'page', true), {});
  assert.deepStrictEqual(lib.normalizeGroupsOff({ 'X.com': ['page', 'bogus'], '': ['page'], 'y.com': 'page' }), { 'x.com': ['page'] });
  assert.throws(() => lib.switchGroup({}, 'x.com', 'sandboxed', false), /isn't a group/);
  // a page script for every site and a rules mod: with page scripts off on x.com, only the page script
  // leaves x.com out (its own switched-off sites kept)
  const us = mockUserScripts();
  const page = mod('all-sites/dark', { matches: ['*://*/*'] });
  const rules = mod('x.com/calm', { rules: true });
  await lib.syncUserScripts(us, { mods: [page, rules], runtimeCode: 'RT', offSites: { 'all-sites/dark': ['y.com'] }, groupsOff: g });
  const byId = Object.fromEntries(us.scripts.map((s) => [s.id, s]));
  assert.deepStrictEqual(byId['all-sites/dark'].excludeMatches.sort(), ['*://*.x.com/*', '*://*.y.com/*', '*://x.com/*', '*://y.com/*']);
  assert.deepStrictEqual(byId['x.com/calm'].excludeMatches, []);
});
