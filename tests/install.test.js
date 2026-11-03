'use strict';
// Tests for installing TRIF: the npm package, copy vs link installs, allowed_origins for every
// extension ID, and the matching doctor checks. Everything runs in temp dirs (--home, --native-dir).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFile, spawn, spawnSync } = require('child_process');
const { runCli, tempDir, testEnv, REPO, privDir } = require('./fake-extension');
const P = require('../helper/lib/paths');
const { installApp, chooseMode, cleanPath, loadSafariAgent } = require('../helper/lib/setup');
const L = require('../helper/lib/lock');
const { preinstallMods, loadPreinstalled, PREINSTALLED, SITES_ON } = require('../helper/lib/preinstalled');
const { checkWrapperScript } = require('../helper/lib/doctor');
const { browserTable } = require('../helper/lib/browsers');

const DEV_ORIGIN = 'chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/';
const OTHER_ID = 'abcdefghijklmnopabcdefghijklmnop';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wrapperScript(file) {
  const m = fs.readFileSync(file, 'utf8').match(/exec "[^"]+" "([^"]+)" "\$@"\n$/);
  assert.ok(m, `not a wrapper: ${file}`);
  return m[1];
}

function readManifest(native) {
  return JSON.parse(fs.readFileSync(path.join(native, 'com.webmods.helper.json'), 'utf8'));
}

// Run a cli.js other than the repo's (e.g. one inside an installed copy).
function runOtherCli(cliJs, args, home, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliJs, ...args], { env: testEnv(home, env), timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

// A package folder like npm's (no .git): what `npx trif` runs from.
function fakePackage(root) {
  const pkg = path.join(root, 'pkg', 'node_modules', 'trif');
  const r = installApp(REPO, pkg);
  assert.equal(r.how, 'created');
  assert.ok(!fs.existsSync(path.join(pkg, '.git')));
  return pkg;
}

// ------------------------------------------------------------------ package and version

test('package: npm metadata, files allowlist and one version everywhere', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'trif');
  assert.deepEqual(pkg.bin, { trif: 'helper/cli.js', webmods: 'helper/cli.js' }, '`webmods` stays an alias');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.engines.node, '>=18');
  for (const f of ['helper/', 'extension/', 'examples/', 'docs/PROTOCOL.md']) assert.ok(pkg.files.includes(f), f);
  for (const f of pkg.files) assert.ok(!/^(\.keys|tests|dist)\b/.test(f), `${f} must not be published`);
  assert.ok(!pkg.private, 'publishable');
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version, 'extension/manifest.json version must match package.json');
  assert.equal(P.VERSION, pkg.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'helper', 'package.json'), 'utf8')).version, undefined, 'no second version');
  assert.match(fs.readFileSync(path.join(REPO, 'helper', 'cli.js'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
});

test('mode: a git checkout links, anything else copies; flags win', () => {
  const root = tempDir();
  assert.equal(chooseMode(undefined, REPO), fs.existsSync(path.join(REPO, '.git')) ? 'link' : 'copy');
  assert.equal(chooseMode(undefined, root), 'copy');
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n'); // a worktree's .git is a file
  assert.equal(chooseMode(undefined, root), 'link');
  assert.equal(chooseMode('copy', root), 'copy');
  assert.equal(chooseMode('link', path.join(root, 'nope')), 'link');
});

test('cleanPath drops the folders npx adds for its own run', () => {
  const p = ['/Users/a/.npm/_npx/1234/node_modules/.bin', '/usr/local/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin', '/opt/homebrew/bin', '/usr/bin'].join(path.delimiter);
  assert.equal(cleanPath(p), ['/opt/homebrew/bin', '/usr/bin'].join(path.delimiter));
});

// ------------------------------------------------------------------ copy vs link

test('setup --copy: copies helper/extension/examples into <home>/app and points everything there', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  const native = path.join(root, 'native');
  const args = ['setup', '--copy', '--home', ws, '--native-dir', native, '--no-link'];
  let r = await runCli(args, { home: path.join(root, 'unused') });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const app = path.join(ws, 'app');
  for (const f of ['package.json', 'helper/host.js', 'helper/cli.js', 'helper/workspace/AGENTS.md', 'helper/templates/mod.js',
    'extension/manifest.json', 'examples/sites', 'examples/shipped-history.json']) {
    assert.ok(fs.existsSync(path.join(app, f)), f);
  }
  for (const f of ['tests', '.keys', '.git', 'docs']) assert.ok(!fs.existsSync(path.join(app, f)), `${f} not copied`);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(app, 'helper', 'host.js'));
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif')), path.join(app, 'helper', 'cli.js'));
  assert.equal(fs.statSync(path.join(app, 'helper', 'cli.js')).mode & 0o777, fs.statSync(path.join(REPO, 'helper', 'cli.js')).mode & 0o777);
  assert.equal(fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(app, 'helper', 'workspace', 'AGENTS.md'), 'utf8'));
  assert.match(r.stdout, new RegExp(`app {11}${esc(app)} \\(v${esc(P.VERSION)}, created, copied from`));
  assert.match(r.stdout, new RegExp(`choose ${esc(path.join(app, 'extension'))}\n`));
  assert.match(r.stdout, /Web Store listing will replace this step/);
  assert.deepEqual(readManifest(native).allowed_origins, [DEV_ORIGIN]);

  // The CLI wrapper runs the copy (its examples, its template).
  const viaWrapper = await new Promise((resolve) => {
    execFile(path.join(ws, 'bin', 'trif'), ['new', 'example.com', 'hello'], { env: { PATH: process.env.PATH, HOME: root } }, (e, so, se) => resolve({ e, so, se }));
  });
  assert.equal(viaWrapper.e, null, viaWrapper.se);
  assert.ok(fs.existsSync(path.join(ws, 'sites', 'example.com', 'hello.js')));

  // Re-run: identical files are left alone (no swap under a running helper).
  const before = fs.statSync(app).ino;
  r = await runCli(args, { home: path.join(root, 'unused') });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /unchanged, copied from/);
  assert.equal(fs.statSync(app).ino, before);

  // A changed (or stray) file means a fresh copy is swapped in.
  fs.writeFileSync(path.join(app, 'helper', 'host.js'), '// broken');
  fs.writeFileSync(path.join(app, 'stray.txt'), 'x');
  r = await runCli(args, { home: path.join(root, 'unused') });
  assert.match(r.stdout, /updated, copied from/);
  assert.equal(fs.readFileSync(path.join(app, 'helper', 'host.js'), 'utf8'), fs.readFileSync(path.join(REPO, 'helper', 'host.js'), 'utf8'));
  assert.ok(!fs.existsSync(path.join(app, 'stray.txt')));
  assert.deepEqual(fs.readdirSync(ws).filter((n) => n.startsWith('.app.')), [], 'no temp folders left');

  // doctor is happy with a copy install (no "not this copy" warning) even when run from the repo.
  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, new RegExp(`ok {4}host wrapper .* -> ${esc(path.join(app, 'helper', 'host.js'))} \\(installed copy`));
  assert.doesNotMatch(r.stdout, /not this copy/);
  assert.match(r.stdout, /ok {4}.*native host manifest/);
  assert.match(r.stdout, new RegExp(`Load unpacked from ${esc(path.join(app, 'extension'))}`));
});

test('setup from a package that is not a git checkout copies by default; re-running from the copy keeps it', async () => {
  const root = tempDir();
  const pkg = fakePackage(root);
  const ws = path.join(root, 'ws');
  const native = path.join(root, 'native');
  let r = await runOtherCli(path.join(pkg, 'helper', 'cli.js'), ['setup', '--json', '--home', ws, '--native-dir', native, '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'copy');
  assert.equal(out.app, path.join(ws, 'app'));
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(ws, 'app', 'helper', 'host.js'));

  // The package folder can go away (npm cleans its npx cache): the install keeps working.
  fs.rmSync(path.join(root, 'pkg'), { recursive: true, force: true });
  r = await runOtherCli(path.join(ws, 'app', 'helper', 'cli.js'), ['setup', '--home', ws, '--native-dir', native, '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /app {11}.* \(v[^,]+, running from it\)/);
  r = await runOtherCli(path.join(ws, 'app', 'helper', 'cli.js'), ['doctor', '--native-dir', native], ws);
  assert.match(r.stdout, /ok {4}host wrapper .*installed copy/);
  assert.doesNotMatch(r.stdout, /not this copy|FAIL {2}.*native host/);
});

test('setup --link: wrappers run the package where it is; warns when that is not a git checkout', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  let r = await runCli(['setup', '--link', '--home', ws, '--native-dir', path.join(root, 'native'), '--no-link'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(REPO, 'helper', 'host.js'));
  assert.ok(!fs.existsSync(path.join(ws, 'app')));
  assert.match(r.stdout, /linked: the wrappers run this folder/);

  const pkg = fakePackage(root);
  r = await runOtherCli(path.join(pkg, 'helper', 'cli.js'), ['setup', '--link', '--home', ws, '--native-dir', path.join(root, 'native'), '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(pkg, 'helper', 'host.js'));
  assert.match(r.stdout, /isn't a git checkout/);

  const both = await runCli(['setup', '--copy', '--link', '--home', ws, '--no-link'], { home: ws });
  assert.equal(both.code, 1);
  assert.match(both.stderr, /--copy or --link, not both/);
});

test('installApp: a failed copy leaves a working install alone', () => {
  const root = tempDir();
  const app = path.join(root, 'ws', 'app');
  installApp(REPO, app);
  const hostBefore = fs.readFileSync(path.join(app, 'helper', 'host.js'), 'utf8');

  // Source missing a required file: refused before touching anything.
  const broken = path.join(root, 'broken');
  fs.mkdirSync(path.join(broken, 'helper'), { recursive: true });
  fs.writeFileSync(path.join(broken, 'package.json'), '{}');
  assert.throws(() => installApp(broken, app), /host\.js is missing/);
  assert.equal(fs.readFileSync(path.join(app, 'helper', 'host.js'), 'utf8'), hostBefore);

  // Failing half way through the copy (an unreadable file): temp copy removed, app untouched.
  if (process.getuid && process.getuid() !== 0) {
    const src = path.join(root, 'src');
    installApp(REPO, src);
    fs.writeFileSync(path.join(src, 'helper', 'host.js'), '// new version');
    const locked = path.join(src, 'helper', 'lib', 'locked.js');
    fs.writeFileSync(locked, 'x');
    fs.chmodSync(locked, 0);
    try {
      assert.throws(() => installApp(src, app), /EACCES|permission/i);
    } finally {
      fs.chmodSync(locked, 0o644);
    }
    assert.equal(fs.readFileSync(path.join(app, 'helper', 'host.js'), 'utf8'), hostBefore);
    assert.deepEqual(fs.readdirSync(path.dirname(app)).filter((n) => n !== 'app'), []);
  }
});

// A pid that was running a moment ago and isn't now.
function deadPid() {
  return spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim() * 1;
}

// A process that stays alive until killed; another install "running" in it.
function livePid(cleanup) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  cleanup(() => child.kill());
  return child.pid;
}

test('install lock: one holder at a time; a dead or old holder is taken over; a child with the token holds it', (t) => {
  const home = tempDir();
  const app = path.join(home, 'app');
  const file = L.lockPath(app);
  assert.equal(file, path.join(home, '.app.lock'));

  const a = L.acquireInstallLock(app);
  assert.equal(a.held, false);
  assert.throws(() => L.acquireInstallLock(app), L.LockBusy, 'held by this very process');
  // The new version's setup, run with the token, counts as holding it, and doesn't release it.
  const child = L.acquireInstallLock(app, { env: { [L.LOCK_ENV]: a.token } });
  assert.equal(child.held, true);
  child.release();
  assert.ok(fs.existsSync(file));
  assert.throws(() => L.acquireInstallLock(app, { env: { [L.LOCK_ENV]: 'not-the-token' } }), L.LockBusy);
  a.release();
  assert.equal(fs.existsSync(file), false);

  // Another live process holds it: busy, naming it.
  const other = livePid((f) => t.after(f));
  fs.writeFileSync(file, `${other}\nsometoken\n`);
  assert.throws(() => L.acquireInstallLock(app), new RegExp(`in progress \\(process ${other}\\)`));
  // A holder whose lock was taken over (it hung past the age limit) doesn't remove the new holder's.
  const c = L.acquireInstallLock(path.join(home, 'other-app'));
  fs.writeFileSync(L.lockPath(path.join(home, 'other-app')), `${other}\nsometoken\n`);
  c.release();
  assert.ok(fs.existsSync(L.lockPath(path.join(home, 'other-app'))));

  // Its process died: stale, taken over.
  fs.writeFileSync(file, `${deadPid()}\nsometoken\n`);
  const b = L.acquireInstallLock(app);
  assert.equal(L.readLock(file).pid, process.pid);
  b.release();

  // A live pid, but the lock is older than any install takes (the pid was reused): stale.
  fs.writeFileSync(file, `${other}\nsometoken\n`);
  const old = new Date(Date.now() - L.LOCK_MAX_AGE_MS - 60000);
  fs.utimesSync(file, old, old);
  L.acquireInstallLock(app).release();

  // An empty lock file just made (its owner hasn't written its pid yet) is not stale.
  fs.writeFileSync(file, '');
  assert.throws(() => L.acquireInstallLock(app), L.LockBusy);
  fs.rmSync(file);
});

test('installApp: never touches another live install\'s folders or swaps while it holds the lock', async (t) => {
  const home = tempDir();
  const app = path.join(home, 'app');
  const other = livePid((f) => t.after(f));
  const dead = deadPid();
  for (const name of [`.app.new-${other}`, `.app.old-${other}`, `.app.new-${dead}`, `.app.old-${dead}`]) {
    fs.mkdirSync(path.join(home, name, 'helper'), { recursive: true });
  }
  assert.equal(installApp(REPO, app).how, 'created');
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith('.app.')).sort(), [`.app.new-${other}`, `.app.old-${other}`],
    'leftovers of a dead process removed, a live one\'s kept');
  assert.equal(fs.existsSync(L.lockPath(app)), false, 'lock released');

  // Another process is installing: refused, app untouched.
  fs.writeFileSync(path.join(home, '.app.lock'), `${other}\ntok\n`);
  fs.writeFileSync(path.join(app, 'package.json'), '{"changed": true}');
  assert.throws(() => installApp(REPO, app), /another TRIF install is in progress/);
  assert.equal(fs.readFileSync(path.join(app, 'package.json'), 'utf8'), '{"changed": true}');

  // setup says so and keeps the existing copy.
  const r = await runCli(['setup', '--copy', '--home', home, '--native-dir', path.join(home, 'native'), '--no-link', '--no-examples'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAILED to update .*another TRIF install is in progress.*kept the existing copy/);
  assert.equal(fs.readFileSync(path.join(app, 'package.json'), 'utf8'), '{"changed": true}');
});

test('Safari bridge agent: restarted in place when loaded, loaded afresh when changed, later and detached from inside the bridge', () => {
  const calls = [];
  const uid = process.getuid();
  const target = `gui/${uid}/com.timsrobot.trif.safari-bridge`;
  const legacyTarget = `gui/${uid}/dev.webmods.safari-bridge`;
  // loaded: whether the agent is loaded; legacy: whether the one from before 0.2.0 is.
  const fake = (loaded, fail, legacy = false) => (args) => {
    calls.push(args);
    if (args[0] === 'print') return { status: (args[1] === legacyTarget ? legacy : loaded) ? 0 : 113 };
    return fail === args[0] ? { status: 5, stderr: 'Bootstrap failed: 5: Input/output error\n' } : { status: 0 };
  };
  const prints = [['print', target], ['print', legacyTarget]];

  assert.deepEqual(loadSafariAgent('/p.plist', { changed: false, env: {}, run: fake(true) }), { error: null, later: false });
  assert.deepEqual(calls.splice(0), [...prints, ['kickstart', '-k', target]]);

  loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(true) });
  assert.deepEqual(calls.splice(0), [...prints, ['bootout', target], ['bootstrap', `gui/${uid}`, '/p.plist']]);

  loadSafariAgent('/p.plist', { changed: false, env: {}, run: fake(false) });
  assert.deepEqual(calls.splice(0), [...prints, ['bootstrap', `gui/${uid}`, '/p.plist']]);

  assert.match(loadSafariAgent('/p.plist', { env: {}, run: fake(false, 'bootstrap') }).error, /Input\/output error/);
  calls.splice(0);

  // An upgrade from 0.1.x: the old agent is stopped first (it holds the port), and its failing doesn't matter.
  const r0 = loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(false, 'bootout', true) });
  assert.deepEqual(r0, { error: null, later: false });
  assert.deepEqual(calls.splice(0), [...prints, ['bootout', legacyTarget], ['bootstrap', `gui/${uid}`, '/p.plist']]);

  // Inside a host the bridge started (an update installed from Safari): nothing now, a detached script later.
  const scripts = [];
  const r = loadSafariAgent('/p p.plist', { changed: true, env: { TRIF_SAFARI_BRIDGE: '123' }, run: fake(true), runDetached: (s) => scripts.push(s) });
  assert.deepEqual(r, { error: null, later: true });
  assert.deepEqual(calls.splice(0), prints);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], `sleep 3; "launchctl" "bootout" "${target}"; "launchctl" "bootstrap" "gui/${uid}" "/p p.plist"`);
  // An older bridge (0.1.x, updating to this version) says so as WEBMODS_SAFARI_BRIDGE.
  const r2 = loadSafariAgent('/p.plist', { changed: true, env: { WEBMODS_SAFARI_BRIDGE: '9' }, run: fake(false, null, true), runDetached: (s) => scripts.push(s) });
  assert.deepEqual(r2, { error: null, later: true });
  assert.equal(scripts[1], `sleep 3; "launchctl" "bootout" "${legacyTarget}"; "launchctl" "bootstrap" "gui/${uid}" "/p.plist"`);
  calls.splice(0);
});

// ------------------------------------------------------------------ extension IDs

test('extensionIds: dev ID first, Web Store IDs, valid config IDs; bad ones reported', () => {
  assert.equal(P.DEV_EXTENSION_ID, 'iaablflfafmonebdomeikadolkgdbkhe');
  assert.ok(Array.isArray(P.STORE_EXTENSION_IDS));
  const { ids, invalid } = P.extensionIds({ extensionIds: [OTHER_ID, ' ' + OTHER_ID, 'nope', 42, P.DEV_EXTENSION_ID] });
  assert.deepEqual(ids, [P.DEV_EXTENSION_ID, ...P.STORE_EXTENSION_IDS, OTHER_ID]);
  assert.deepEqual(invalid, ['nope', 42]);
  assert.deepEqual(P.extensionIds({ extensionIds: 'x' }).invalid, ['x']);
  assert.deepEqual(P.extensionOrigins({}), [P.DEV_EXTENSION_ID, ...P.STORE_EXTENSION_IDS].map((id) => `chrome-extension://${id}/`));
});

test('setup writes every extension ID into allowed_origins; doctor flags a manifest missing any', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  const native = path.join(root, 'native');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(privDir(ws), 'config.json'), JSON.stringify({ extensionIds: [OTHER_ID, 'not-an-id'] }));
  let r = await runCli(['setup', '--native-dir', native, '--no-link'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const all = P.extensionOrigins({ extensionIds: [OTHER_ID] });
  assert.ok(all.includes(DEV_ORIGIN) && all.includes(`chrome-extension://${OTHER_ID}/`));
  assert.deepEqual(readManifest(native).allowed_origins, all);
  assert.match(r.stdout, /ignored config\.json extensionIds entries .*"not-an-id"/);
  // setup keeps extensionIds when it records PATH.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(privDir(ws), 'config.json'), 'utf8')).extensionIds, [OTHER_ID, 'not-an-id']);

  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, /ok {4}.*native host manifest/);
  assert.match(r.stdout, /warn {2}config\.json extensionIds has entries that aren't extension IDs: "not-an-id"/);

  // A manifest that only lists the dev ID (e.g. written before the ID was added) fails.
  const mf = path.join(native, 'com.webmods.helper.json');
  const m = readManifest(native);
  m.allowed_origins = [DEV_ORIGIN];
  fs.writeFileSync(mf, JSON.stringify(m));
  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`FAIL {2}.*allowed_origins doesn't include chrome-extension://${OTHER_ID}/`));
  assert.doesNotMatch(r.stdout, new RegExp(`doesn't include [^\\n]*${esc(DEV_ORIGIN)}`));

  // Extra origins beyond ours are fine.
  m.allowed_origins = [...all, 'chrome-extension://pppppppppppppppppppppppppppppppp/'];
  fs.writeFileSync(mf, JSON.stringify(m));
  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, /ok {4}.*native host manifest/);
});

// ------------------------------------------------------------------ doctor's wrapper-script check

test('doctor: which host.js the wrapper may run', () => {
  const root = tempDir();
  const ws = P.workspace(path.join(root, 'ws'));
  const appHost = path.join(ws.appDir, 'helper', 'host.js');
  assert.equal(checkWrapperScript(P.HOST_JS, ws), null, 'this copy (link install)');
  assert.equal(checkWrapperScript(appHost, ws), null, 'the installed copy, version unknown');
  fs.mkdirSync(ws.appDir, { recursive: true });
  fs.writeFileSync(path.join(ws.appDir, 'package.json'), JSON.stringify({ version: P.VERSION }));
  assert.equal(checkWrapperScript(appHost, ws), null, 'the installed copy, same version');
  fs.writeFileSync(path.join(ws.appDir, 'package.json'), JSON.stringify({ version: '0.0.1-old' }));
  const old = checkWrapperScript(appHost, ws);
  assert.equal(old.status, 'warn');
  assert.match(old.title, /is v0\.0\.1-old, but this trif is v/);
  assert.match(old.fix, /setup --copy/);
  assert.match(checkWrapperScript('/Users/a/.npm/_npx/123/node_modules/trif/helper/host.js', ws).title, /npx cache/);
  assert.match(checkWrapperScript('/somewhere/else/helper/host.js', ws).title, /not this copy/);
});

test('preinstalled mods: each once, switched on or off as listed; the start sites once; never over the user\'s file, never back after deleting it', async () => {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const examples = path.join(REPO, 'examples', 'sites');
  const plainx = path.join(sites, 'x.com', 'plain-x.js');
  const ids = PREINSTALLED.map((p) => p.id);
  const off = PREINSTALLED.filter((p) => !p.on).map((p) => p.id);
  assert.deepStrictEqual(off, ['x.com/punk-fonts', 'x.com/rainbow-rave', 'www.instagram.com/desaturate', 'www.google.com/dvd-logo']);
  assert.deepStrictEqual(SITES_ON, ['google.com', 'x.com', 'amazon.com', 'instagram.com']);
  for (const id of ids) assert.ok(fs.existsSync(path.join(examples, `${id}.js`)), `examples has ${id}`);
  let r = preinstallMods(home, sites, examples);
  assert.deepStrictEqual(r, { added: ids, on: ids.filter((id) => !off.includes(id)), sites: SITES_ON });
  for (const id of ids) assert.ok(fs.existsSync(path.join(sites, `${id}.js`)), id);
  assert.strictEqual(fs.readFileSync(plainx, 'utf8'), fs.readFileSync(path.join(examples, 'x.com', 'plain-x.js'), 'utf8'));
  const { shipped, ...rest } = loadPreinstalled(home);
  assert.deepStrictEqual(rest, { offered: ids, startOff: off, sitesOn: SITES_ON });
  assert.deepStrictEqual(shipped, {}, 'recorded by updateShippedMods, not here');
  fs.unlinkSync(plainx);
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] }, 'deleted: not brought back');
  assert.strictEqual(fs.existsSync(plainx), false);

  const home2 = tempDir();
  const own = path.join(home2, 'sites', 'x.com', 'rainbow-rave.js');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '// mine');
  r = preinstallMods(home2, path.join(home2, 'sites'), examples);
  assert.deepStrictEqual(r.added, ids.filter((id) => id !== 'x.com/rainbow-rave'));
  assert.strictEqual(fs.readFileSync(own, 'utf8'), '// mine');
  assert.deepStrictEqual(loadPreinstalled(home2).startOff, ['x.com/punk-fonts', 'www.instagram.com/desaturate', 'www.google.com/dvd-logo'], 'the user\'s own file isn\'t switched off');
  assert.deepStrictEqual(loadPreinstalled(home2).shipped, { 'x.com/rainbow-rave': { own: true } }, 'nor ever updated');

  // Through setup, and --no-examples.
  const home3 = tempDir();
  let res = await runCli(['setup', '--native-dir', path.join(home3, 'native'), '--no-link'], { home: home3 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.match(res.stdout, /preinstalled, on: www\.google\.com\/hide-ai-in-results, /);
  assert.match(res.stdout, /preinstalled, off until you switch them on in the side panel: x\.com\/punk-fonts, x\.com\/rainbow-rave, www\.instagram\.com\/desaturate, www\.google\.com\/dvd-logo/);
  assert.match(res.stdout, /TRIF starts on for google\.com, x\.com, amazon\.com, instagram\.com/);
  assert.ok(fs.existsSync(path.join(home3, 'sites', 'x.com', 'plain-x.js')));
  const home4 = tempDir();
  res = await runCli(['setup', '--native-dir', path.join(home4, 'native'), '--no-link', '--no-examples'], { home: home4 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(fs.existsSync(path.join(home4, 'sites', 'x.com')), false);
});

// ------------------------------------------------------------------ Firefox

test('setup --browser firefox writes a manifest with allowed_extensions; doctor checks it', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const r = await runCli(['setup', '--browser', 'chrome,firefox', '--no-link'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const fakehome = path.join(ws, 'fakehome');
  const fxDir = process.platform === 'darwin'
    ? path.join(fakehome, 'Library/Application Support/Mozilla/NativeMessagingHosts')
    : path.join(fakehome, '.mozilla/native-messaging-hosts');
  const fx = readManifest(fxDir);
  assert.deepEqual(fx.allowed_extensions, [P.FIREFOX_EXTENSION_ID]);
  assert.equal(fx.allowed_origins, undefined);
  assert.equal(fx.path, path.join(ws, 'bin', 'trif-host'));
  const chrome = browserTable(fakehome).find((b) => b.key === 'chrome');
  assert.deepEqual(readManifest(chrome.nativeDir).allowed_origins, [DEV_ORIGIN]);
  assert.match(r.stdout, /Firefox: open this link in Firefox to install the TRIF add-on:\n {7}https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/trif-firefox\.xpi\n/);

  let d = await runCli(['doctor'], { home: ws });
  assert.match(d.stdout, /ok {4}Firefox: native host manifest/);
  fs.writeFileSync(path.join(fxDir, 'com.webmods.helper.json'), JSON.stringify({ ...fx, allowed_extensions: ['other@example.com'] }));
  d = await runCli(['doctor'], { home: ws });
  assert.match(d.stdout, new RegExp(`FAIL {2}Firefox: .*allowed_extensions doesn't include ${esc(P.FIREFOX_EXTENSION_ID)}`));
});

test('browserTable: Firefox has one native host folder for every profile', () => {
  const mac = browserTable('/H', 'darwin').find((b) => b.key === 'firefox');
  assert.equal(mac.nativeDir, '/H/Library/Application Support/Mozilla/NativeMessagingHosts');
  assert.equal(mac.firefox, true);
  const linux = browserTable('/H', 'linux').find((b) => b.key === 'firefox');
  assert.equal(linux.nativeDir, '/H/.mozilla/native-messaging-hosts');
  assert.equal(browserTable('/H', 'darwin').find((b) => b.key === 'chrome').firefox, false);
});

test('build-extension firefox: sidebar, background scripts, optional userScripts, gecko id', async () => {
  const r = await new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'scripts/build-extension.js'), 'firefox'],
    { timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout, stderr })));
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'dist/firefox/manifest.json'), 'utf8'));
  assert.deepEqual(m.background, { scripts: ['background.js'], type: 'module' });
  assert.equal(m.sidebar_action.default_panel, 'sidepanel.html');
  assert.equal(m.side_panel, undefined);
  assert.equal(m.key, undefined);
  assert.ok(!m.permissions.includes('userScripts') && !m.permissions.includes('sidePanel'));
  assert.deepEqual(m.optional_permissions, ['userScripts']);
  assert.equal(m.browser_specific_settings.gecko.id, P.FIREFOX_EXTENSION_ID);
});

test('setup\'s next steps give the trif command that works from this terminal: ~/.trif/bin/trif until it\'s on PATH', async () => {
  const root = tempDir();
  const ws = path.join(root, '.trif');
  const args = ['setup', '--browser', 'chrome', '--no-link', '--no-examples'];
  const off = await runCli(args, { home: ws, env: { HOME: root } });
  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, /is not on your PATH/);
  assert.match(off.stdout.slice(off.stdout.indexOf('Next steps:')), /Check everything with: ~\/\.trif\/bin\/trif doctor\n/);
  const on = await runCli(args, { home: ws, env: { HOME: root, PATH: `${path.join(ws, 'bin')}${path.delimiter}${testEnv(ws).PATH}` } });
  assert.equal(on.code, 0, on.stderr);
  assert.doesNotMatch(on.stdout, /is not on your PATH/);
  assert.match(on.stdout.slice(on.stdout.indexOf('Next steps:')), /Check everything with: trif doctor\n/);
});

test('setup for Firefox alone gives only Firefox\'s next steps', async () => {
  const ws = tempDir();
  const r = await runCli(['setup', '--browser', 'firefox', '--no-link', '--no-examples'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const next = r.stdout.slice(r.stdout.indexOf('Next steps:'));
  assert.match(next, /1\. Open this link in Firefox to install the TRIF add-on, and click Add:/);
  assert.ok(next.includes(`       ${require('../helper/lib/update').firefoxAddonUrl()}\n`), 'the latest release\'s add-on');
  assert.match(next, /"Allow user scripts"/);
  assert.doesNotMatch(next, /chrome:\/\/extensions|Load unpacked/);
});
