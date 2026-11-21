'use strict';
// Settings' "Run chats in TRIF's full sandbox" (helper/lib/wholeboxsetting.js, docs/WHOLE-BOX-PROGRESS.md step
// 1b): off by default; on, it downloads TRIF's pinned Claude Code in the background with its progress sent to
// the panel; a failed download says why and can be tried again; only the side panel can switch it, on or off.
// The download itself: claudepin.test.js. A run with it on: TRIF_WHOLE_BOX=1 tests/run-sandbox.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createWholeBoxSetting, isOn } = require('../helper/lib/wholeboxsetting');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-wbs-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => { const d = path.join(tmpRoot, `${name}-${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const tick = () => new Promise((r) => setImmediate(r));

// A stand-in claudepin: ensurePinned resolves (or fails) when the test says, telling progress as asked.
function fakePin({ key = 'darwin-arm64' } = {}) {
  const f = { installed: false, calls: 0, pruned: 0, pending: null };
  f.cp = {
    pinsInUse: () => ({ version: '2.1.999' }),
    platformKey: (platform) => (platform === 'darwin' ? key : null),
    installedPinned: () => (f.installed ? { bin: '/x/claude', dir: '/x', version: '2.1.999', key } : null),
    ensurePinned: (home, { onProgress }) => { f.calls++; return new Promise((resolve, reject) => { f.pending = { resolve, reject, onProgress }; }); },
    prunePinned: () => { f.pruned++; return []; },
  };
  f.finish = () => { f.installed = true; f.pending.resolve({ version: '2.1.999', fetched: true }); };
  f.fail = (m) => f.pending.reject(new Error(m));
  return f;
}
// A stand-in for the sign-in's keyring (claudetoken.js) and the saved API key (agentkeys.js): never a real keychain.
function fakeSignIn() {
  const k = { token: false, key: false, removed: 0 };
  k.ct = { hasToken: async () => ({ stored: k.token, error: null }), removeToken: async () => { k.removed++; const had = k.token; k.token = false; return { removed: had }; } };
  k.hasKey = async () => ({ stored: k.key });
  return k;
}
function setting(f, extra = {}) {
  const ws = { home: fresh('home'), config: {} };
  const k = extra.signIn || fakeSignIn();
  const sent = [];
  const writes = [];
  const s = createWholeBoxSetting({ getWorkspace: () => ws, setConfigKey: (home, k, v) => writes.push([k, v]), onChange: (st) => sent.push(st),
    cp: f.cp, platform: 'darwin', arch: 'arm64', everyMs: 0, ct: k.ct, hasKey: k.hasKey, ...extra });
  return { s, ws, sent, writes, k };
}

test('off by default; on: the config key, a background download with its progress, then ready (older copies pruned)', async () => {
  const f = fakePin();
  const { s, ws, sent, writes } = setting(f);
  assert.deepStrictEqual(s.status(), { available: true, on: false, pin: 'missing', version: '2.1.999', signedIn: null, token: false, key: false });
  s.start();
  assert.strictEqual(f.calls, 0, 'off: nothing downloaded');
  const st = s.set(true);
  assert.deepStrictEqual(writes, [['wholeBox', true]]);
  assert.strictEqual(isOn(ws), true);
  assert.deepStrictEqual([st.on, st.pin, st.got, st.total], [true, 'downloading', 0, 0], 'answers at once');
  f.pending.onProgress(1000, 4000);
  assert.deepStrictEqual([sent.at(-1).pin, sent.at(-1).got, sent.at(-1).total], ['downloading', 1000, 4000]);
  s.retry(); // (on, and downloading: the same download)
  assert.strictEqual(f.calls, 1);
  f.finish();
  await tick(); await tick();
  assert.deepStrictEqual(sent.at(-1), { available: true, on: true, pin: 'ready', version: '2.1.999', signedIn: false, token: false, key: false });
  assert.strictEqual(f.pruned, 1);
  // off: the key removed, the copy kept
  assert.deepStrictEqual(s.set(false), { available: true, on: false, pin: 'ready', version: '2.1.999', signedIn: false, token: false, key: false });
  assert.deepStrictEqual(writes.at(-1), ['wholeBox', undefined]);
  assert.strictEqual(isOn(ws), false);
});

test('a failed download says why; Try again downloads again; a helper starting with it on fetches a missing copy', async () => {
  const f = fakePin();
  const { s, ws, sent } = setting(f);
  ws.config.wholeBox = true; // (switched on before this helper started)
  s.start();
  assert.strictEqual(f.calls, 1, 'started: the missing copy is fetched');
  f.fail('https://registry.npmjs.org/… answered HTTP 503');
  await tick(); await tick();
  assert.deepStrictEqual(sent.at(-1), { available: true, on: true, pin: 'failed', version: '2.1.999', error: 'https://registry.npmjs.org/… answered HTTP 503', signedIn: false, token: false, key: false });
  s.retry();
  assert.strictEqual(f.calls, 2);
  assert.strictEqual(s.status().pin, 'downloading');
  f.finish();
  await tick(); await tick();
  assert.strictEqual(s.status().pin, 'ready');
  s.start();
  assert.strictEqual(f.calls, 2, 'there: not fetched again');
  // (off, Try again does nothing)
  s.set(false);
  f.installed = false;
  s.retry();
  assert.strictEqual(f.calls, 2);
});

test('progress is sent at most every everyMs while downloading (the last always)', async () => {
  const f = fakePin();
  const { s, sent } = setting(f, { everyMs: 60000 });
  s.set(true);
  const before = sent.length;
  for (let i = 1; i <= 50; i++) f.pending.onProgress(i * 1000, 50000);
  assert.strictEqual(sent.length, before, 'held back');
  f.finish();
  await tick(); await tick();
  assert.strictEqual(sent.at(-1).pin, 'ready');
});

test('not on this computer yet (Windows, Linux, or no pin for it): unavailable, and it can\'t be switched on', () => {
  for (const extra of [{ platform: 'win32' }, { platform: 'linux' }]) {
    const f = fakePin();
    const { s, ws } = setting(f, extra);
    ws.config.wholeBox = true; // (a config.json copied from a Mac: still not on here)
    assert.deepStrictEqual([s.status().available, s.status().on], [false, false], extra.platform);
    s.start();
    assert.strictEqual(f.calls, 0);
    assert.throws(() => s.set(true), /isn't available on this computer yet/);
  }
  const f = fakePin({ key: null });
  f.cp.platformKey = () => null;
  assert.strictEqual(setting(f).s.status().available, false, 'no pin for this Mac');
  const broken = fakePin();
  broken.cp.pinsInUse = () => { throw new Error('no pin file'); };
  assert.strictEqual(setting(broken).s.status().available, false, 'no pin file: unavailable, not a crash');
});

// The helper: the switch's state on hello, the panel's alone (never a terminal's or a run's socket), and a
// real background download (claudepin, from a stand-in registry: a fake tarball, no signature check).
test('the helper: sent on hello; only the extension\'s connection switches it; on, it downloads with progress and says ready', async (t) => {
  const net = require('net');
  const { FakeExtension, privDir } = require('./fake-extension');
  const cp = require('../helper/lib/claudepin');
  const key = `${process.platform}-${process.arch}`;
  const src = fresh('src');
  fs.mkdirSync(path.join(src, 'package'));
  fs.writeFileSync(path.join(src, 'package', cp.binName()), '#!/bin/sh\necho "2.1.999 (Claude Code)"\n#' + crypto.randomBytes(1 << 20).toString('base64'), { mode: 0o755 });
  spawnSync('tar', ['-czf', path.join(src, 'pkg.tgz'), '-C', src, 'package']);
  const body = fs.readFileSync(path.join(src, 'pkg.tgz'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const pinFile = path.join(fresh('pin'), 'claude-code.json');
  fs.writeFileSync(pinFile, JSON.stringify({ version: '2.1.999', packages: { [key]: { name: 'x', tarball: `http://127.0.0.1:${server.address().port}/x.tgz`,
    integrity: `sha512-${crypto.createHash('sha512').update(body).digest('base64')}` } } }));
  const home = fresh('trif-home');
  const ext = new FakeExtension({ home, env: { TRIF_CLAUDE_CODE_PIN: pinFile } });
  t.after(() => ext.close());
  let id = 0;
  const ask = async (cmd, args = {}) => { const i = `w${++id}`; ext.send({ type: 'request', id: i, cmd, args }); return ext.next((m) => m.type === 'response' && m.id === i, { timeout: 15000 }); };
  const sockAsk = (msg) => new Promise((resolve, reject) => {
    const s = net.connect(ext.sock); let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => s.write(`${JSON.stringify(msg)}\n`));
    s.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i !== -1) { s.destroy(); resolve(JSON.parse(buf.slice(0, i))); } });
    s.on('error', reject);
  });
  ext.hello();
  const first = await ext.next((m) => m.type === 'wholeBox', { timeout: 10000 });
  const mac = process.platform === 'darwin';
  assert.deepStrictEqual([first.wholeBox.available, first.wholeBox.on, first.wholeBox.pin], [mac, false, 'missing']);
  await ext.waitForSocket();
  for (const cmd of ['wholeBox.set', 'wholeBox.retry', 'wholeBox.status', 'wholeBox.signOut']) {
    for (const extra of [{}, { token: 'a-run' }]) {
      const r = await sockAsk({ id: 's', cmd, args: { on: false }, ...extra });
      assert.strictEqual(r.ok, false, cmd);
      assert.match(r.error, /only a click in TRIF's side panel can change this \(Settings: Run chats in TRIF's full sandbox\)/);
    }
  }
  if (!mac) {
    const r = await ask('wholeBox.set', { on: true });
    assert.match(r.error || '', /isn't available on this computer yet/);
    return;
  }
  const bad = await ask('wholeBox.set', { on: 'yes' });
  assert.match(bad.error || '', /on must be true or false/);
  const since = ext.messages.length;
  const on = await ask('wholeBox.set', { on: true });
  assert.deepStrictEqual([on.result.on, on.result.pin], [true, 'downloading']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).wholeBox, true);
  const ready = await ext.next((m) => m.type === 'wholeBox' && m.wholeBox.pin === 'ready', { timeout: 20000, since });
  // (its sign-in: the stand-in extension's keychain doesn't exist, so: not signed in, and why)
  assert.deepStrictEqual({ ...ready.wholeBox, signInError: !!ready.wholeBox.signInError }, { available: true, on: true, pin: 'ready', version: '2.1.999', signedIn: false, token: false, key: false, signInError: true });
  const progress = ext.messages.slice(since).filter((m) => m.type === 'wholeBox' && m.wholeBox.got);
  assert.ok(progress.every((m) => m.wholeBox.total === body.length), 'the size, with the progress');
  assert.ok(cp.installedPinned(home, { env: { TRIF_CLAUDE_CODE_PIN: pinFile } }), 'installed in the workspace');
  const off = await ask('wholeBox.set', { on: false });
  assert.deepStrictEqual([off.result.on, off.result.pin], [false, 'ready'], 'off: the copy kept');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).wholeBox, undefined);
});

test('the sign-in (step 6b): a saved API key or the setup-token token; a refused token says so until the next sign-in; Sign out removes it', async () => {
  const f = fakePin();
  const { s, sent, k } = setting(f);
  f.installed = true;
  s.set(true);
  await tick(); await tick();
  assert.deepStrictEqual([sent.at(-1).signedIn, sent.at(-1).token, sent.at(-1).key], [false, false, false], 'checked when switched on: none');
  k.token = true;
  let st = await s.refreshSignIn();
  assert.deepStrictEqual([st.signedIn, st.token, st.refused], [true, true, undefined]);
  st = s.noteRefused();
  assert.deepStrictEqual([st.signedIn, st.refused], [false, true], 'a boxed run\'s token refused: sign in again');
  assert.strictEqual(sent.at(-1).refused, true, 'sent to the panel');
  st = await s.refreshSignIn();
  assert.deepStrictEqual([st.signedIn, st.refused], [false, true], 'still, until a sign-in');
  st = await s.signedIn();
  assert.deepStrictEqual([st.signedIn, st.refused], [true, undefined], 'a new sign-in');
  k.key = true;
  s.noteRefused();
  st = await s.refreshSignIn();
  assert.strictEqual(st.signedIn, true, 'a saved API key: runs use it (the key proxy) whatever the token');
  k.key = false;
  st = await s.signOut();
  assert.deepStrictEqual([k.removed, st.signedIn, st.token, st.refused], [1, false, false, undefined]);
});
