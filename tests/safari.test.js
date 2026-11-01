'use strict';
// Safari: the adapter (extension/safari.js) standing in for chrome.userScripts and native messaging,
// the Safari build (one classic background script), the helper's Safari bridge, and setup's login item.

const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const { test, before } = require('node:test');
const { runCli, tempDir, waitFor, sleep, REPO } = require('./fake-extension');
const { createBridge, PORT } = require('../helper/safari-bridge');
const { safariManifest, bundleClassic } = require('../scripts/build-extension');
const { safariAgentContent } = require('../helper/lib/setup');

// ---- a stand-in for Safari's extension APIs ------------------------------------------------------

const listeners = {};
const injected = [];
let failInjection = null;
const storage = {};
const sockets = [];
let nativeReply = async () => ({ token: 'the-key' });
const nativeCalls = [];

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    sockets.push(this);
  }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.onclose?.(); }
}

function event(name) {
  return { addListener: (f) => { (listeners[name] = listeners[name] || []).push(f); }, removeListener() {}, hasListener() { return false; } };
}

const fakeChrome = {
  runtime: Object.preventExtensions({
    getURL: (p) => `safari-web-extension://ABC/${p}`, id: 'dev.webmods.app.extension (X)',
    getManifest: () => ({ version: '0.0.0' }), lastError: undefined, onMessage: event('runtime.onMessage'),
    sendNativeMessage: (app, msg) => { nativeCalls.push([app, msg]); return nativeReply(); },
  }),
  storage: {
    local: {
      get: async (key) => (key === null ? { ...storage } : { [key]: storage[key] }),
      set: async (obj) => { Object.assign(storage, JSON.parse(JSON.stringify(obj))); },
    },
  },
  scripting: {
    executeScript: async (details) => {
      if (failInjection && failInjection(details)) throw new Error('SyntaxError: Unexpected token');
      injected.push({ ...details, source: String(details.func) });
      return [{ frameId: 0, result: 'ok' }];
    },
  },
  webNavigation: { onCommitted: event('onCommitted'), onDOMContentLoaded: event('onDOMContentLoaded'), onCompleted: event('onCompleted') },
  action: { onClicked: event('action.onClicked') },
  windows: { onRemoved: event('windows.onRemoved'), create: async () => ({ id: 7 }), update: async () => ({}) },
};
Object.preventExtensions(fakeChrome); // like Safari's: an extension can't add to it

let safari;
let lib;
before(async () => {
  globalThis.chrome = fakeChrome;
  globalThis.self = { addEventListener() {} };
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => ({});
  safari = await import('../extension/safari.js');
  lib = await import('../extension/lib.js');
});

const us = () => safari.bundledChrome.userScripts;
const mod = (id, code, extra = {}) => ({ id, matches: ['https://x.com/*'], js: [{ code }], runAt: 'document_start', world: 'MAIN', ...extra });

// ---- the adapter ---------------------------------------------------------------------------------

test('Safari adapter: a function that Safari would inject as the given source', () => {
  const f = safari.asInjectable('return 1 + 1;');
  assert.equal(f.toString(), 'function () {\nreturn 1 + 1;\n}');
  assert.equal(String(f), 'function () {\nreturn 1 + 1;\n}');
});

test('Safari adapter: chrome.userScripts stand-in registers, updates, lists and unregisters like Chrome', async () => {
  await us().unregister();
  await us().register([mod('a', '1'), mod('b', '2')]);
  await assert.rejects(us().register([mod('a', '3')]), /Duplicate script ID 'a'/);
  await assert.rejects(us().update([mod('zzz', '3')]), /Nonexistent script ID 'zzz'/);
  await us().update([{ id: 'b', js: [{ code: '22' }] }]);
  assert.deepEqual((await us().getScripts()).map((s) => [s.id, s.js[0].code, s.runAt]), [['a', '1', 'document_start'], ['b', '22', 'document_start']]);
  assert.deepEqual((await us().getScripts({ ids: ['b'] })).map((s) => s.id), ['b']);
  assert.deepEqual(storage.safariUserScripts.map((s) => s.id), ['a', 'b'], 'kept in storage for when Safari restarts the background');
  await us().unregister({ ids: ['a'] });
  assert.deepEqual((await us().getScripts()).map((s) => s.id), ['b']);
  await us().unregister();
  assert.deepEqual(await us().getScripts(), []);
});

test('Safari adapter: Safari\'s own chrome object is left alone; the background gets a copy with the stand-ins', () => {
  assert.equal(fakeChrome.userScripts, undefined);
  assert.equal(safari.bundledChrome.storage, fakeChrome.storage);
  assert.equal(safari.bundledChrome.runtime.id, fakeChrome.runtime.id);
  assert.equal(typeof safari.bundledChrome.runtime.connectNative, 'function');
  assert.equal(lib.userScriptsAvailable(safari.bundledChrome), true);
});

test('Safari adapter: page code is the runtime then the matching mods, each in its own try, once per document', () => {
  const list = [
    mod('webmods-runtime', 'log.push("runtime")', { matches: ['<all_urls>'] }),
    mod('one', 'log.push("one"); throw new Error("boom")'),
    mod('later', 'log.push("idle")', { runAt: 'document_idle' }),
    mod('two', 'log.push("two")', { excludeMatches: ['https://x.com/settings*'] }),
    mod('elsewhere', 'log.push("elsewhere")', { matches: ['https://instagram.com/*'] }),
  ];
  const code = safari.pageCode(list, 'https://x.com/home', 'document_start');
  const run = (src) => {
    const ctx = { log: [], document: {}, location: { origin: 'https://x.com' }, console: { error() {} } };
    vm.runInNewContext(`(function () {\n${src}\n})(); (function () {\n${src}\n})();`, ctx);
    return ctx.log;
  };
  assert.deepEqual(run(code), ['runtime', 'one', 'two'], 'in order, past a failing mod, and not twice');
  assert.deepEqual(run(safari.pageCode(list, 'https://x.com/settings/account', 'document_start')), ['runtime', 'one']);
  assert.deepEqual(run(safari.pageCode(list, 'https://x.com/home', 'document_idle')), ['idle']);
  assert.equal(safari.pageCode(list, 'https://example.com/', 'document_idle'), '');
  // the tab moved on to another site before the code landed: nothing runs
  const ctx = { log: [], document: {}, location: { origin: 'https://accounts.google.com' }, console: { error() {} } };
  vm.runInNewContext(`(function () {\n${code}\n})();`, ctx);
  assert.deepEqual(ctx.log, []);
});

test('Safari adapter: mods go into each page as it commits, in the top frame, in the page\'s world', async () => {
  await us().unregister();
  await us().register([mod('webmods-runtime', 'RUNTIME()', { matches: ['<all_urls>'] }), mod('m', 'MOD()')]);
  injected.length = 0;
  for (const f of listeners.onCommitted) f({ tabId: 3, frameId: 1, url: 'https://x.com/home' });
  for (const f of listeners.onCommitted) f({ tabId: 3, frameId: 0, url: 'https://x.com/home' });
  await waitFor(() => injected.length === 1);
  const [one] = injected;
  assert.deepEqual(one.target, { tabId: 3, frameIds: [0] });
  assert.equal(one.world, 'MAIN');
  assert.equal(one.injectImmediately, true);
  assert.ok(one.source.indexOf('RUNTIME()') < one.source.indexOf('MOD()'), one.source);
  await us().unregister();
});

test('Safari adapter: when the page code doesn\'t parse, every other script still runs, one at a time', async () => {
  await us().unregister();
  await us().register([mod('webmods-runtime', 'log.push("runtime")', { matches: ['<all_urls>'] }), mod('one', 'log.push("one")'),
    mod('bad', 'BAD('), mod('two', 'log.push("two")')]);
  injected.length = 0;
  failInjection = ({ func }) => String(func).includes('BAD(');
  try {
    for (const f of listeners.onCommitted) f({ tabId: 4, frameId: 0, url: 'https://x.com/' });
    await waitFor(() => injected.length === 3);
    await sleep(50);
    // run what was injected, in order, in one page
    const page = { log: [], document: {}, location: { origin: 'https://x.com' }, console: { error() {} } };
    vm.createContext(page);
    for (const { source } of injected) vm.runInContext(`(${source})()`, page);
    assert.deepEqual(page.log, ['runtime', 'one', 'two']);
  } finally {
    failInjection = null;
    await us().unregister();
  }
});

test('Safari adapter: userScripts.execute runs an expression in the page and returns its result', async () => {
  injected.length = 0;
  const r = await us().execute({ target: { tabId: 9 }, world: 'MAIN', js: [{ code: '(() => "hi")()' }] });
  assert.equal(lib.firstInjectionResult(r), 'ok');
  assert.equal(injected[0].source, 'function () {\nreturn (\n(() => "hi")()\n);\n}');
});

test('Safari adapter: syncUserScripts works against the stand-in (runtime first, then mods)', async () => {
  await us().unregister();
  const mods = [{ id: 'x.com/plain', matches: ['https://x.com/*'], code: 'PLAIN()', hash: 'h1' }];
  const res = await lib.syncUserScripts(lib.timedUserScripts(us()), { mods, runtimeCode: 'RUNTIME()', applied: {}, disabled: {}, offSites: {}, recording: [], sitesOn: null });
  assert.deepEqual(res.registered, ['x.com/plain']);
  const code = safari.pageCode(await us().getScripts(), 'https://x.com/home', 'document_start');
  assert.ok(code.indexOf('RUNTIME()') >= 0 && code.indexOf('RUNTIME()') < code.indexOf('PLAIN()'), code);
  await us().unregister();
});

test('Safari adapter: connectNative is a port over a WebSocket to the bridge, with the key from the app', async () => {
  const before = sockets.length;
  const port = safari.bundledChrome.runtime.connectNative('com.webmods.helper');
  port.postMessage({ type: 'hello' });
  await waitFor(() => sockets.length > before, { message: 'the WebSocket' });
  const ws = sockets.at(-1);
  assert.equal(ws.url, `ws://127.0.0.1:${PORT}/?token=the-key`);
  assert.deepEqual(nativeCalls.at(-1), ['dev.webmods.app', { type: 'token' }]);
  assert.deepEqual(ws.sent, [], 'held until the socket opens');
  ws.onopen();
  assert.deepEqual(ws.sent, [{ type: 'hello' }]);
  const got = [];
  port.onMessage.addListener((m) => got.push(m));
  ws.onmessage({ data: '{"type":"mods","mods":[]}' });
  ws.onmessage({ data: 'not json' });
  assert.deepEqual(got, [{ type: 'mods', mods: [] }]);
  let gone = 0;
  port.onDisconnect.addListener(() => gone++);
  ws.onclose();
  ws.onclose();
  assert.equal(gone, 1);
  assert.throws(() => port.postMessage({}), /disconnected port/);
});

test('Safari adapter: without a key from the app, the port disconnects (and asks again next time)', async () => {
  // The previous test's socket closed after opening, so the key is still remembered; a refused one isn't.
  const p1 = safari.bundledChrome.runtime.connectNative('com.webmods.helper');
  await waitFor(() => sockets.at(-1).url.endsWith('the-key'));
  let gone1 = 0;
  p1.onDisconnect.addListener(() => gone1++);
  sockets.at(-1).onclose(); // refused before opening
  assert.equal(gone1, 1);

  const before = sockets.length;
  nativeReply = async () => ({ error: "couldn't read /Users/x/.webmods/safari-token" });
  try {
    const p2 = safari.bundledChrome.runtime.connectNative('com.webmods.helper');
    let gone2 = 0;
    p2.onDisconnect.addListener(() => gone2++);
    await waitFor(() => gone2 === 1, { message: 'a disconnect' });
    assert.equal(sockets.length, before, 'no socket without a key');
  } finally {
    nativeReply = async () => ({ token: 'the-key' });
  }
});

// ---- the Safari build ----------------------------------------------------------------------------

test('Safari build: manifest has the adapter\'s background page and no Chrome-only parts', () => {
  const m = safariManifest(JSON.parse(fs.readFileSync(path.join(REPO, 'extension/manifest.json'), 'utf8')));
  assert.deepEqual(m.background, { scripts: ['safari-background.js'], persistent: false });
  assert.equal(m.side_panel, undefined);
  assert.equal(m.key, undefined);
  assert.ok(m.permissions.includes('webNavigation') && m.permissions.includes('scripting'));
  assert.ok(m.permissions.includes('nativeMessaging'), "to ask the app for the bridge's key");
  for (const p of ['userScripts', 'sidePanel']) assert.ok(!m.permissions.includes(p), p);
});

test('Safari build: the background is one classic script that starts against Safari-like APIs', () => {
  const src = bundleClassic(path.join(REPO, 'extension'), 'safari-background.js');
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.ok(src.indexOf('// ---- safari.js') < src.indexOf('// ---- background.js'), 'the adapter before the background');
  new vm.Script(src); // parses as a classic script

  const seen = [];
  const ns = () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : /^on[A-Z]/.test(k) ? event(`bundle.${String(k)}`) : ['local', 'session'].includes(k) ? ns() : async () => []) });
  const runtime = Object.preventExtensions({
    getURL: (p) => `safari-web-extension://ABC/${p}`, getManifest: () => ({ version: '0.0.0' }), id: 'X',
    onMessage: event('b'), onConnect: event('b'), onInstalled: event('b'), onStartup: event('b'),
    sendNativeMessage: async () => ({ token: 'k' }),
  });
  const chrome = new Proxy({ runtime }, { get: (t, k) => (k in t ? t[k] : (t[k] = ns())) });
  const errors = [];
  const ctx = {
    chrome, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, structuredClone,
    navigator: { userAgent: 'Version/27.2 Safari/605.1.15' }, crypto: crypto.webcrypto,
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    fetch: async (url, opts) => { if (/startup-error/.test(url)) errors.push(opts.body); return {}; },
    WebSocket: class { constructor(url) { seen.push(url); } send() {} close() {} },
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.addEventListener = () => {};
  vm.runInNewContext(src, ctx);
  return waitFor(() => seen.length > 0, { message: 'a connection to the bridge' }).then(() => {
    assert.deepEqual(seen, [`ws://127.0.0.1:${PORT}/?token=k`]);
    assert.deepEqual(errors.filter((e) => /failed to start/.test(e)), []);
  });
});

// ---- the bridge ----------------------------------------------------------------------------------

// A host that answers in native-messaging frames: echo → echoed (with its pid); later → late, after a while.
const FAKE_HOST = `
const { encode, Decoder } = require(${JSON.stringify(path.join(REPO, 'helper/lib/framing'))});
const send = (m) => process.stdout.write(encode(m));
const d = new Decoder((m) => {
  if (m.type === 'echo') send({ type: 'echoed', x: m.x, pid: process.pid });
  if (m.type === 'later') setTimeout(() => send({ type: 'late', pid: process.pid }), 300);
});
process.stdin.on('data', (c) => d.push(c));
process.stdin.on('end', () => process.exit(0));
`;

/** A minimal WebSocket client that can set its Origin (browsers can't, which is the point). */
function wsConnect(port, origin, key = 'k') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: key === null ? '/' : `/?token=${encodeURIComponent(key)}`,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), ...(origin ? { Origin: origin } : {}) },
    });
    req.on('response', (res) => resolve({ refused: res.statusCode }));
    req.on('error', reject);
    req.on('upgrade', (res, socket, head) => {
      const messages = [];
      let buf = head;
      const parse = () => {
        while (buf.length >= 2) {
          let len = buf[1] & 0x7f;
          let at = 2;
          if (len === 126) { len = buf.readUInt16BE(2); at = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); at = 10; }
          if (buf.length < at + len) return;
          if ((buf[0] & 0x0f) === 1) messages.push(JSON.parse(buf.subarray(at, at + len).toString('utf8')));
          buf = buf.subarray(at + len);
        }
      };
      socket.on('data', (c) => { buf = Buffer.concat([buf, c]); parse(); });
      parse();
      resolve({
        messages,
        send(msg) {
          const data = Buffer.from(JSON.stringify(msg));
          const mask = crypto.randomBytes(4);
          const head2 = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length]) : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 255]);
          const body = Buffer.from(data.map((b, i) => b ^ mask[i & 3]));
          socket.write(Buffer.concat([head2, mask, body]));
        },
        close() { socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0])); },
      });
    });
    req.end();
  });
}

async function startBridge(opts = {}) {
  const logged = [];
  const log = { info: (m) => logged.push(m), warn: (m) => logged.push(m), error: (m) => logged.push(m) };
  const { server, hosts } = createBridge({ hostCommand: () => [process.execPath, '-e', FAKE_HOST], log, token: () => 'k', ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stop = async () => {
    for (const h of hosts.values()) h.child.kill();
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
  };
  return { port, hosts, logged, stop };
}

const ORIGIN = 'safari-web-extension://17CE7838-D949-4005-BDF4-071D3DD007CD';

test('Safari bridge: refuses connections that aren\'t from a Safari extension', async () => {
  const b = await startBridge();
  try {
    assert.deepEqual(await wsConnect(b.port, 'https://evil.example'), { refused: 403 });
    assert.deepEqual(await wsConnect(b.port, null), { refused: 403 });
    assert.deepEqual(await wsConnect(b.port, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'), { refused: 403 });
    assert.equal(b.hosts.size, 0, 'no host started');
  } finally { await b.stop(); }
});

test('Safari bridge: refuses a Safari extension without the key (another extension than WebMods)', async () => {
  const b = await startBridge();
  try {
    assert.deepEqual(await wsConnect(b.port, ORIGIN, null), { refused: 403 });
    assert.deepEqual(await wsConnect(b.port, ORIGIN, 'kk'), { refused: 403 });
    assert.deepEqual(await wsConnect(b.port, ORIGIN, ''), { refused: 403 });
    assert.equal(b.hosts.size, 0);
  } finally { await b.stop(); }
  const none = await startBridge({ token: () => null }); // setup hasn't made a key yet
  try {
    assert.deepEqual(await wsConnect(none.port, ORIGIN, ''), { refused: 403 });
    assert.ok(none.logged.some((l) => /no key yet/.test(l)));
  } finally { await none.stop(); }
});

test('Safari bridge: relays to a host, and the host outlives a disconnect (Safari napping the background)', async () => {
  const b = await startBridge();
  try {
    const c1 = await wsConnect(b.port, ORIGIN);
    c1.send({ type: 'echo', x: 1 });
    await waitFor(() => c1.messages.length === 1);
    const pid = c1.messages[0].pid;
    assert.deepEqual(c1.messages[0], { type: 'echoed', x: 1, pid });

    c1.send({ type: 'later' });
    await sleep(50);
    c1.close();
    await waitFor(() => [...b.hosts.values()].every((h) => !h.socket), { message: 'disconnect noticed' });
    await sleep(400); // 'late' arrives while nobody's connected

    const c2 = await wsConnect(b.port, ORIGIN);
    await waitFor(() => c2.messages.length === 1, { message: 'the queued message' });
    assert.deepEqual(c2.messages[0], { type: 'late', pid }, 'same host, message kept');
    c2.send({ type: 'echo', x: 2 });
    await waitFor(() => c2.messages.length === 2);
    assert.equal(c2.messages[1].pid, pid);
  } finally { await b.stop(); }
});

test('Safari bridge: stops a host left unused, unless an agent run is going', async () => {
  let running = true;
  const b = await startBridge({ idleMs: 150, runActive: () => running });
  try {
    const c = await wsConnect(b.port, ORIGIN);
    c.send({ type: 'echo', x: 1 });
    await waitFor(() => c.messages.length === 1);
    c.close();
    await sleep(500);
    assert.equal(b.hosts.size, 1, 'kept while a run is going');
    running = false;
    await waitFor(() => b.hosts.size === 0, { message: 'the idle host stopped' });
  } finally { await b.stop(); }
});

test('Safari bridge: logs the extension\'s errors, but only from a Safari extension', async () => {
  const b = await startBridge();
  const post = (origin, body) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: b.port, path: '/log', method: 'POST', headers: { Origin: origin } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end(body);
  });
  try {
    assert.equal(await post(ORIGIN, 'error: something broke'), 200);
    assert.equal(await post('https://evil.example', 'error: spam'), 426);
    assert.ok(b.logged.some((l) => l.includes('something broke')));
    assert.ok(!b.logged.some((l) => l.includes('spam')));
  } finally { await b.stop(); }
});

// ---- setup ---------------------------------------------------------------------------------------

test('Safari setup: the bridge\'s login item runs the bridge with this node, for this workspace', () => {
  const xml = safariAgentContent('/opt/node & co/bin/node', '/W/app/helper/safari-bridge.js', '/custom <home>');
  assert.match(xml, /<key>Label<\/key><string>dev\.webmods\.safari-bridge<\/string>/);
  assert.match(xml, /<string>\/opt\/node &amp; co\/bin\/node<\/string><string>\/W\/app\/helper\/safari-bridge\.js<\/string>/);
  assert.match(xml, /<key>WEBMODS_HOME<\/key><string>\/custom &lt;home&gt;<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
});

test('setup --browser safari installs the bridge\'s login item and gives Safari\'s next steps', { skip: process.platform !== 'darwin' }, async () => {
  const home = tempDir();
  const r = await runCli(['setup', '--browser', 'safari', '--no-link', '--no-examples'], { home });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const plist = path.join(home, 'fakehome', 'Library', 'LaunchAgents', 'dev.webmods.safari-bridge.plist');
  const xml = fs.readFileSync(plist, 'utf8');
  assert.match(xml, /helper\/safari-bridge\.js<\/string>/);
  const next = r.stdout.slice(r.stdout.indexOf('Next steps:'));
  assert.match(next, /Open WebMods\.app/);
  assert.match(next, /Allow unsigned extensions/);
  assert.doesNotMatch(next, /chrome:\/\/extensions|Load unpacked|\.xpi/);
  assert.doesNotMatch(r.stdout, /native host/, 'no native messaging manifest for Safari');
  const tokenFile = path.join(home, 'safari-token');
  const key = fs.readFileSync(tokenFile, 'utf8').trim();
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600, 'only you can read the key');
  const again = await runCli(['setup', '--browser', 'safari', '--no-link', '--no-examples'], { home });
  assert.equal(again.code, 0);
  assert.equal(fs.readFileSync(tokenFile, 'utf8').trim(), key, 'kept on re-running setup');
});
