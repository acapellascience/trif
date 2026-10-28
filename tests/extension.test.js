// Extension tests: mod syncing against a chrome.userScripts mock, tab selection, `run` code
// building, and the page runtime (serializer, log/error attribution, network recorder) evaluated in
// a vm context with a fake window/fetch/XMLHttpRequest.
const assert = require('node:assert');
const vm = require('node:vm');
const { test, before } = require('node:test');

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
  assert.deepStrictEqual(runtime.matches, ['<all_urls>']);
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
  assert.deepStrictEqual(r.applied, { [lib.RUNTIME_ID]: lib.quickHash(runtimeCode), 'x.com/a': 'h2', 'x.com/c': 'h1' });
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
  assert.deepStrictEqual(us.calls, [['unregister', 'all'], ['register', [lib.RUNTIME_ID]], ['register', ['x.com/a']], ['register', ['x.com/b']]]);
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

test('runtime: webmods.log attributes sync logs and async logs (via the stack)', async () => {
  const page = makePage();
  const W = loadRuntime(page);
  runMod(page, 'x.com/a', 'webmods.log("hello", {n: 1}); setTimeout(() => webmods.warn("later"), 0);');
  runMod(page, 'x.com/b', 'webmods.error("from b")');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(plain(W.logs.map((l) => [l.mod, l.level, l.args])), [
    ['x.com/a', 'log', ['hello', '{"n":1}']],
    ['x.com/b', 'error', ['from b']],
    ['x.com/a', 'warn', ['later']],
  ]);
  // with no mod frame on the stack, falls back to the current mod
  page.webmods.log('outside');
  assert.strictEqual(W.logs.at(-1).mod, 'x.com/b');
});

test('runtime: window error / unhandledrejection events are attributed by stack', () => {
  const page = makePage();
  const W = loadRuntime(page);
  runMod(page, 'news.ycombinator.com/late', 'window.makeErr = () => new Error("late")');
  page.__listeners.error[0]({ error: page.makeErr(), filename: 'https://site/app.js' });
  page.__listeners.unhandledrejection[0]({ reason: page.makeErr() });
  page.__listeners.error[0]({ error: new Error('site error'), filename: 'https://site/app.js' });
  page.__listeners.error[0]({ error: null, message: 'Script error.', filename: 'webmods://x.com/z.js' });
  assert.deepStrictEqual(plain(W.errors.map((e) => [e.mod, e.message])), [
    ['news.ycombinator.com/late', 'late'], ['news.ycombinator.com/late', 'late'], ['x.com/z', 'Script error.'],
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

test('recorder: caps bodies and entries; inactive on other hosts', async () => {
  const big = 'z'.repeat(2 * 1024 * 1024 + 1000);
  const page = makePage('x.com', { fetch: async () => fakeResponse(big, { type: 'text/plain' }) });
  const W = loadRuntime(page, ['x.com']);
  for (let i = 0; i < 305; i++) await page.fetch('/r' + i);
  await settle();
  assert.strictEqual(W.requests.length, 300);
  assert.strictEqual(W.requests[0].i, 5);
  assert.ok(W.requests[0].responseText.length < big.length);
  assert.match(W.requests[0].responseText, /truncated/);
  assert.strictEqual(W.requests[0].size, big.length);

  const origFetch = async () => fakeResponse('');
  const XHR = makeXHRClass();
  const openBefore = XHR.prototype.open;
  const other = makePage('notx.com', { fetch: origFetch, XMLHttpRequest: XHR });
  const W2 = loadRuntime(other, ['x.com']);
  assert.strictEqual(W2.recording, false);
  assert.strictEqual(other.fetch, origFetch);
  assert.strictEqual(XHR.prototype.open, openBefore);
});
