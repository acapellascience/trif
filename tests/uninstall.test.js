'use strict';
// `trif uninstall` (helper/lib/uninstall.js, docs/NO-NODE.md): a real setup in a temp workspace (its
// browsers and LaunchAgents under a fake home folder, never the real ones), then uninstall: what goes, what
// stays (mods, private folder; another workspace's manifest), --all and its confirmation, running helpers.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, runCli, tempDir, privDir, waitFor } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { SERVICE } = require('../helper/lib/agentkeys');
const P = require('../helper/lib/paths');

const MAC = process.platform === 'darwin';
const fakeHome = (home) => path.join(home, 'fakehome');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const chromeManifest = (home) => path.join(fakeHome(home), MAC ? 'Library/Application Support/Google/Chrome' : '.config/google-chrome', 'NativeMessagingHosts', `${P.HOST_NAME}.json`);
const braveManifest = (home) => path.join(fakeHome(home), MAC ? 'Library/Application Support/BraveSoftware/Brave-Browser' : '.config/BraveSoftware/Brave-Browser', 'NativeMessagingHosts', `${P.HOST_NAME}.json`);
const safariPlist = (home) => path.join(fakeHome(home), 'Library', 'LaunchAgents', 'com.timsrobot.trif.safari-bridge.plist');

async function installed(env = {}) {
  const home = tempDir('uninst-');
  const binDir = path.join(home, 'usrbin');
  fs.mkdirSync(binDir);
  const r = await runCli(['setup', '--copy', '--browser', MAC ? 'chrome,safari' : 'chrome', '--bin-dir', binDir, '--no-examples', '--no-wait'], { home, env, timeout: 60000 });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  // TRIF's own Node as setup leaves it (setup downloads it only with pins: tests/setup-runtime.test.js).
  fs.mkdirSync(path.join(home, 'runtime', 'node-v24.0.0-test', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sites', 'example.com', 'mine.js'), '// @name mine\n');
  fs.writeFileSync(path.join(privDir(home), 'phones.json'), '{}\n');
  return { home, binDir };
}

test('uninstall: removes manifests, the Safari agent, the CLI link, bin, app and runtime; keeps mods, private folder and another workspace\'s manifest', async () => {
  const { home, binDir } = await installed();
  assert.ok(exists(chromeManifest(home)) && exists(path.join(binDir, 'trif')) && exists(path.join(home, 'app')));
  if (MAC) assert.ok(exists(safariPlist(home)));
  // Brave's manifest from another TRIF workspace (a git checkout's, say): not this one's to remove.
  fs.mkdirSync(path.dirname(braveManifest(home)), { recursive: true });
  const other = JSON.stringify({ name: P.HOST_NAME, path: '/elsewhere/.trif/bin/trif-host', type: 'stdio' });
  fs.writeFileSync(braveManifest(home), other);

  const r = await runCli(['uninstall', '--bin-dir', binDir], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Removed TRIF's helper, CLI and browser connections/);
  assert.match(r.stdout, /kept .*Brave-Browser.*another TRIF \(\/elsewhere/);
  for (const p of [chromeManifest(home), path.join(binDir, 'trif'), path.join(home, 'bin'), path.join(home, 'app'), path.join(home, 'runtime'), safariPlist(home)]) {
    assert.equal(exists(p), false, `${p} should be gone`);
  }
  assert.equal(fs.readFileSync(braveManifest(home), 'utf8'), other);
  assert.ok(exists(path.join(home, 'sites', 'example.com', 'mine.js')));
  assert.ok(exists(path.join(home, 'AGENTS.md')));
  assert.ok(exists(path.join(`${home}-private`, 'phones.json')));
  assert.ok(!exists(path.join(home, '.app.lock')), 'the install lock is released');

  // Setup again puts it back, mods and settings untouched.
  const again = await runCli(['setup', '--copy', '--browser', 'chrome', '--bin-dir', binDir, '--no-examples', '--no-wait'], { home, timeout: 60000 });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.ok(exists(chromeManifest(home)) && exists(path.join(home, 'bin', 'trif')));
  assert.ok(exists(path.join(home, 'sites', 'example.com', 'mine.js')) && exists(path.join(`${home}-private`, 'phones.json')));
});

test('uninstall --all: needs --yes without a terminal; then removes keys, the private folder, mailboxes and the workspace', async () => {
  const kcDir = tempDir('uninst-kc-');
  const kc = makeFakeKeychain(kcDir);
  const { home, binDir } = await installed(kc.env);
  const r0 = await runCli(['uninstall', '--all', '--bin-dir', binDir], { home, env: kc.env });
  assert.equal(r0.code, 1);
  assert.match(r0.stderr, /add --yes to confirm/);
  assert.ok(exists(path.join(home, 'app')) && exists(chromeManifest(home)), 'nothing removed without --yes');

  const k = await runCli(['agent', 'key', '--set-key'], { home, env: kc.env, input: 'sk-ant-test-0123456789abcdef\n' });
  assert.equal(k.code, 0, k.stdout + k.stderr);
  assert.ok(kc.items()[`${SERVICE}\u0000anthropic`]);
  fs.mkdirSync(path.join(home, 'boxes', 'run-1'), { recursive: true });

  const r = await runCli(['uninstall', '--all', '--yes', '--bin-dir', binDir, '--json'], { home, env: kc.env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.keys, ['anthropic']);
  assert.equal(kc.items()[`${SERVICE}\u0000anthropic`], undefined);
  assert.equal(kc.argvText().includes('sk-ant-test'), false);
  for (const p of [home, `${home}-private`, chromeManifest(home), path.join(binDir, 'trif')]) assert.equal(exists(p), false, `${p} should be gone`);
});

test('uninstall --all keeps a mods folder set outside the workspace', async () => {
  const { home, binDir } = await installed();
  const mods = path.join(tempDir('uninst-mods-'), 'my-mods');
  fs.mkdirSync(path.join(mods, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(mods, 'x.com', 'a.js'), '// a\n');
  const cfgFile = path.join(`${home}-private`, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, modsDir: mods }));
  const r = await runCli(['uninstall', '--all', '--yes', '--bin-dir', binDir], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /is outside the workspace and is still there/);
  assert.ok(exists(path.join(mods, 'x.com', 'a.js')));
  assert.equal(exists(home), false);
});

test('uninstall stops the running helpers, and refuses a folder that isn\'t a workspace', async () => {
  const { home, binDir } = await installed();
  const ext = new FakeExtension({ home });
  ext.hello();
  await waitFor(() => fs.readdirSync(home).some((n) => /^helper-\d+\.sock$/.test(n)), { message: 'the helper\'s socket' });
  const r = await runCli(['uninstall', '--bin-dir', binDir], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const gone = await Promise.race([ext.exited, new Promise((res) => setTimeout(() => res(null), 8000))]);
  assert.ok(gone, 'the helper exited');
  assert.equal(fs.readdirSync(home).some((n) => /^helper(-\d+)?\.sock$/.test(n)), false);

  const notOne = tempDir('uninst-not-');
  fs.writeFileSync(path.join(notOne, 'precious.txt'), 'x');
  const bad = await runCli(['uninstall', '--all', '--yes'], { home: notOne });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /doesn't look like a TRIF workspace/);
  assert.ok(exists(path.join(notOne, 'precious.txt')));
});
