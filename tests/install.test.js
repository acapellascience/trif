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
const { preinstallMods, loadPreinstalled, PREINSTALLED, SITES_ON, starterSites, starterChoices, chooseNoStarter, installStarter, starterOffer, resolveSites, updateShippedMods: updateShipped } = require('../helper/lib/preinstalled');
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

// A package folder like npm's (no .git): what `npx timsrobot` runs from.
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
  assert.equal(pkg.name, 'timsrobot');
  assert.deepEqual(pkg.bin, { timsrobot: 'helper/cli.js', trif: 'helper/cli.js', webmods: 'helper/cli.js' }, '`npx timsrobot` runs the bin named like the package; `webmods` stays an alias');
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
  const args = ['setup', '--verbose', '--copy', '--home', ws, '--native-dir', native, '--no-link'];
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
  assert.equal(fs.readFileSync(path.join(ws, 'TECHNIQUES.md'), 'utf8'), fs.readFileSync(path.join(app, 'helper', 'workspace', 'TECHNIQUES.md'), 'utf8'));
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
  r = await runOtherCli(path.join(ws, 'app', 'helper', 'cli.js'), ['setup', '--verbose', '--home', ws, '--native-dir', native, '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /app {11}.* \(v[^,]+, running from it\)/);
  r = await runOtherCli(path.join(ws, 'app', 'helper', 'cli.js'), ['doctor', '--native-dir', native], ws);
  assert.match(r.stdout, /ok {4}host wrapper .*installed copy/);
  assert.doesNotMatch(r.stdout, /not this copy|FAIL {2}.*native host/);
});

test('setup --link: wrappers run the package where it is; warns when that is not a git checkout', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  let r = await runCli(['setup', '--verbose', '--link', '--home', ws, '--native-dir', path.join(root, 'native'), '--no-link'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(REPO, 'helper', 'host.js'));
  assert.ok(!fs.existsSync(path.join(ws, 'app')));
  assert.match(r.stdout, /linked: the wrappers run this folder/);

  const pkg = fakePackage(root);
  r = await runOtherCli(path.join(pkg, 'helper', 'cli.js'), ['setup', '--verbose', '--link', '--home', ws, '--native-dir', path.join(root, 'native'), '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'trif-host')), path.join(pkg, 'helper', 'host.js'));
  assert.match(r.stdout, /isn't a git checkout/);

  const both = await runCli(['setup', '--verbose', '--copy', '--link', '--home', ws, '--no-link'], { home: ws });
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
  const r = await runCli(['setup', '--verbose', '--copy', '--home', home, '--native-dir', path.join(home, 'native'), '--no-link', '--no-examples'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAILED to update .*another TRIF install is in progress.*kept the existing copy/);
  assert.equal(fs.readFileSync(path.join(app, 'package.json'), 'utf8'), '{"changed": true}');
});

test('Safari bridge agent: restarted in place when loaded, loaded afresh when changed, later and detached from inside the bridge', () => {
  const calls = [];
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);
  const uid = process.getuid();
  const target = `gui/${uid}/com.timsrobot.trif.safari-bridge`;
  const legacyTarget = `gui/${uid}/dev.webmods.safari-bridge`;
  // loaded: whether the agent is loaded; legacy: whether the one from before 0.2.0 is. A bootout unloads
  // its service (even one that reports failing) unless lingers says how many prints still find it.
  const fake = (loaded, fail, legacy = false, lingers = 0) => {
    const up = { [target]: loaded, [legacyTarget]: legacy };
    let left = 0;
    return (args) => {
      calls.push(args);
      if (args[0] === 'print') {
        if (up[args[1]] && left > 0 && --left === 0) up[args[1]] = false;
        return { status: up[args[1]] ? 0 : 113 };
      }
      if (args[0] === 'bootout') { if (lingers) left = lingers; else up[args[1]] = false; }
      return fail === args[0] ? { status: 5, stderr: 'Bootstrap failed: 5: Input/output error\n' } : { status: 0 };
    };
  };
  const prints = [['print', target], ['print', legacyTarget]];
  const bootstrap = ['bootstrap', `gui/${uid}`, '/p.plist'];

  assert.deepEqual(loadSafariAgent('/p.plist', { changed: false, env: {}, run: fake(true), sleep }), { error: null, later: false });
  assert.deepEqual(calls.splice(0), [...prints, ['kickstart', '-k', target]]);

  // After a bootout, the bootstrap waits until launchctl no longer finds the service.
  loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(true), sleep });
  assert.deepEqual(calls.splice(0), [...prints, ['bootout', target], ['print', target], bootstrap]);
  assert.deepEqual(sleeps.splice(0), []);
  loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(true, null, false, 3), sleep });
  assert.deepEqual(calls.splice(0), [...prints, ['bootout', target], ['print', target], ['print', target], ['print', target], bootstrap]);
  assert.deepEqual(sleeps.splice(0), [200, 200]);
  // ... but not forever: about 5 s, then the bootstrap is tried anyway.
  assert.deepEqual(loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(true, null, false, 1000), sleep }), { error: null, later: false });
  assert.equal(sleeps.splice(0).reduce((a, b) => a + b, 0), 5000);
  assert.deepEqual(calls.splice(0).at(-1), bootstrap);

  loadSafariAgent('/p.plist', { changed: false, env: {}, run: fake(false), sleep });
  assert.deepEqual(calls.splice(0), [...prints, bootstrap]);

  // A bootstrap failing with error 5 (it raced the bootout) is tried again a second later ...
  {
    let n = 0;
    const base = fake(true);
    const flaky = (args) => (args[0] === 'bootstrap' && ++n === 1 ? (calls.push(args), { status: 5, stderr: 'Bootstrap failed: 5: Input/output error\n' }) : base(args));
    assert.deepEqual(loadSafariAgent('/p.plist', { changed: true, env: {}, run: flaky, sleep }), { error: null, later: false });
    assert.deepEqual(calls.splice(0), [...prints, ['bootout', target], ['print', target], bootstrap, bootstrap]);
    assert.deepEqual(sleeps.splice(0), [1000]);
  }
  // ... up to 5 tries in all, then the error is reported.
  assert.match(loadSafariAgent('/p.plist', { env: {}, run: fake(false, 'bootstrap'), sleep }).error, /Bootstrap failed: 5: Input\/output error/);
  assert.equal(calls.splice(0).filter((a) => a[0] === 'bootstrap').length, 5);
  assert.deepEqual(sleeps.splice(0), [1000, 1000, 1000, 1000]);
  // Another error isn't retried.
  const r122 = loadSafariAgent('/p.plist', { env: {}, sleep, run: (args) => (calls.push(args), args[0] === 'print' ? { status: 113 } : { status: 122, stderr: 'Bootstrap failed: 122: Path had bad ownership/permissions\n' }) });
  assert.match(r122.error, /122/);
  assert.equal(calls.splice(0).filter((a) => a[0] === 'bootstrap').length, 1);
  assert.deepEqual(sleeps.splice(0), []);

  // An upgrade from 0.1.x: the old agent is stopped first (it holds the port), and its failing doesn't matter.
  const r0 = loadSafariAgent('/p.plist', { changed: true, env: {}, run: fake(false, 'bootout', true), sleep });
  assert.deepEqual(r0, { error: null, later: false });
  assert.deepEqual(calls.splice(0), [...prints, ['bootout', legacyTarget], ['print', legacyTarget], bootstrap]);

  // Inside a host the bridge started (an update installed from Safari): nothing now, a detached script later.
  const scripts = [];
  const r = loadSafariAgent('/p p.plist', { changed: true, env: { TRIF_SAFARI_BRIDGE: '123' }, run: fake(true), runDetached: (s) => scripts.push(s), sleep });
  assert.deepEqual(r, { error: null, later: true });
  assert.deepEqual(calls.splice(0), prints);
  assert.equal(scripts.length, 1);
  const waitGone = (t) => `i=0; while [ $i -lt 25 ] && "launchctl" "print" "${t}" >/dev/null 2>&1; do sleep 0.2; i=$((i+1)); done`;
  const retry = (plist) => `i=1; until "launchctl" "bootstrap" "gui/${uid}" "${plist}"; do [ $? -eq 5 ] && [ $i -lt 5 ] || break; sleep 1; i=$((i+1)); done`;
  assert.equal(scripts[0], `sleep 3; "launchctl" "bootout" "${target}"; ${waitGone(target)}; ${retry('/p p.plist')}`);
  // An older bridge (0.1.x, updating to this version) says so as WEBMODS_SAFARI_BRIDGE.
  const r2 = loadSafariAgent('/p.plist', { changed: true, env: { WEBMODS_SAFARI_BRIDGE: '9' }, run: fake(false, null, true), runDetached: (s) => scripts.push(s), sleep });
  assert.deepEqual(r2, { error: null, later: true });
  assert.equal(scripts[1], `sleep 3; "launchctl" "bootout" "${legacyTarget}"; ${waitGone(legacyTarget)}; ${retry('/p.plist')}`);
  calls.splice(0);
  assert.deepEqual(sleeps, []);
});

test('Safari bridge agent: the detached script waits out the bootout and retries a bootstrap failing with 5', { skip: process.platform === 'win32' }, () => {
  // A fake launchctl on PATH: print finds the service twice more after the bootout; bootstrap fails
  // with 5 twice, then works. The script's leading "sleep 3" is dropped to keep the test quick.
  const dir = tempDir();
  const log = path.join(dir, 'log');
  fs.writeFileSync(path.join(dir, 'launchctl'), `#!/bin/sh
echo "$*" >> "${log}"
n() { c=$(cat "${dir}/$1" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "${dir}/$1"; echo $c; }
case "$1" in
  print) [ $(n print) -le 2 ] && exit 0; exit 113 ;;
  bootstrap) [ $(n bootstrap) -le 2 ] && { echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; }; exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
  const uid = process.getuid();
  const t = `gui/${uid}/com.timsrobot.trif.safari-bridge`;
  let script;
  loadSafariAgent('/p.plist', { changed: true, env: { TRIF_SAFARI_BRIDGE: '1' }, run: (a) => ({ status: a[1] === t ? 0 : 113 }), runDetached: (s) => { script = s; } });
  const r = spawnSync('/bin/sh', ['-c', script.replace(/^sleep 3; /, '')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    `bootout ${t}`, `print ${t}`, `print ${t}`, `print ${t}`,
    `bootstrap gui/${uid} /p.plist`, `bootstrap gui/${uid} /p.plist`, `bootstrap gui/${uid} /p.plist`,
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
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
  let r = await runCli(['setup', '--verbose', '--native-dir', native, '--no-link'], { home: ws });
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

// Rainbow Rave for Google, Amazon and Instagram waits for a later release: not shipped, not packaged.
test('the other sites\' Rainbow Raves aren\'t shipped in 0.2.0 (X\'s is), and aren\'t in the package', () => {
  const ids = PREINSTALLED.map((p) => p.id);
  for (const s of ['www.google.com', 'amazon.com', 'www.instagram.com']) {
    assert.ok(!ids.includes(`${s}/rainbow-rave`), s);
    assert.ok(!fs.existsSync(path.join(REPO, 'examples', 'sites', s, 'rainbow-rave.js')), s);
    assert.ok(fs.existsSync(path.join(REPO, 'unreleased', 'sites', s, 'rainbow-rave.js')), `${s}: kept for later`);
  }
  assert.ok(ids.includes('x.com/rainbow-rave'));
  const files = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).files;
  assert.ok(!files.some((f) => f.startsWith('unreleased')), 'unreleased/ isn\'t packaged');
});


test('TRIF\'s own home page: two shipped mods that drive its demo, off, TRIF not started there, no default order', () => {
  const { DEFAULT_ORDER } = require('../helper/lib/preinstalled');
  assert.deepStrictEqual(PREINSTALLED.filter((p) => p.id.startsWith('timsrobot.com/')),
    [{ id: 'timsrobot.com/skip-to-sandbox', on: false }, { id: 'timsrobot.com/random-mods', on: false }]);
  assert.ok(!SITES_ON.some((s) => /timsrobot/.test(s)));
  assert.ok(!DEFAULT_ORDER['timsrobot.com']);
  // Each default order lists shipped mods of its own site, each once.
  for (const [site, ids] of Object.entries(DEFAULT_ORDER)) {
    assert.deepStrictEqual([...new Set(ids)], ids, site);
    for (const id of ids) assert.ok(id.startsWith(`${site}/`) && PREINSTALLED.some((p) => p.id === id), `${site}: ${id}`);
  }
  // Just those two: the demo's own mods live in site/demo/mods, not here.
  assert.deepStrictEqual(fs.readdirSync(path.join(REPO, 'examples', 'sites', 'timsrobot.com')).sort(), ['random-mods.js', 'skip-to-sandbox.js']);
});

test('setup leaves home page mods already in a workspace alone (copies an earlier build put there, or the user\'s own)', () => {
  const examples = path.join(REPO, 'examples', 'sites');
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const dir = path.join(sites, 'timsrobot.com');
  fs.mkdirSync(dir, { recursive: true });
  const files = { 'fireworks.js': '// ==WebMod==\n// @name Click Fireworks\n// @source trif\n// @version 1\n// ==/WebMod==\n', 'mine.js': '// my own\n' };
  for (const [f, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), code);
  const ids = PREINSTALLED.map((p) => p.id);
  const pre = { offered: [...ids, 'timsrobot.com/fireworks'], startOff: ['timsrobot.com/fireworks'], sitesOn: SITES_ON,
    shipped: { 'timsrobot.com/fireworks': { version: '1' } } };
  fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify(pre));
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] });
  const { updateShippedMods } = require('../helper/lib/preinstalled');
  updateShippedMods(home, sites, examples);
  for (const [f, code] of Object.entries(files)) assert.strictEqual(fs.readFileSync(path.join(dir, f), 'utf8'), code, `${f} untouched`);
  const st = loadPreinstalled(home);
  assert.ok(st.startOff.includes('timsrobot.com/fireworks'), 'its switch stays as it was');
  assert.deepStrictEqual(st.shipped['timsrobot.com/fireworks'], { version: '1' });
});

test('preinstalled mods: each once, switched on or off as listed; the start sites once; never over the user\'s file, never back after deleting it', async () => {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const examples = path.join(REPO, 'examples', 'sites');
  const plainx = path.join(sites, 'x.com', 'detox-timeline.js');
  const ids = PREINSTALLED.map((p) => p.id);
  const off = PREINSTALLED.filter((p) => !p.on).map((p) => p.id);
  assert.deepStrictEqual(off, ['x.com/rainbow-rave', 'www.instagram.com/desaturate', 'www.google.com/dvd-logo', 'x.com/follow-status', 'x.com/space-shooter', 'www.instagram.com/three-column-feed', 'timsrobot.com/skip-to-sandbox', 'timsrobot.com/random-mods', 'x.com/profile-styler', 'x.com/post-styler', 'x.com/style-encoder']);
  assert.deepStrictEqual(SITES_ON, ['google.com', 'x.com', 'amazon.com', 'instagram.com']);
  for (const id of ids) assert.ok(fs.existsSync(path.join(examples, `${id}.js`)), `examples has ${id}`);
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] }, 'no site added: nothing');
  assert.strictEqual(fs.existsSync(sites), false);
  let r = preinstallMods(home, sites, examples, undefined, undefined, { add: 'all' });
  assert.deepStrictEqual(r, { added: ids, on: ids.filter((id) => !off.includes(id)), sites: SITES_ON });
  for (const id of ids) assert.ok(fs.existsSync(path.join(sites, `${id}.js`)), id);
  assert.strictEqual(fs.readFileSync(plainx, 'utf8'), fs.readFileSync(path.join(examples, 'x.com', 'detox-timeline.js'), 'utf8'));
  const { shipped, ...rest } = loadPreinstalled(home);
  const all = Object.fromEntries(starterSites().map((x) => [x, 'added']));
  assert.deepStrictEqual(rest, { starter: all, skipped: [], readded: {}, offered: ids, startOff: off, sitesOn: SITES_ON });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, 'preinstalled.json'), 'utf8')).starter, all, 'the choice is in the file');
  assert.deepStrictEqual(shipped, {}, 'recorded by updateShippedMods, not here');
  fs.unlinkSync(plainx);
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] }, 'deleted: not brought back');
  assert.strictEqual(fs.existsSync(plainx), false);

  const home2 = tempDir();
  const own = path.join(home2, 'sites', 'x.com', 'rainbow-rave.js');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '// mine');
  r = preinstallMods(home2, path.join(home2, 'sites'), examples, undefined, undefined, { add: 'all' });
  assert.deepStrictEqual(r.added, ids.filter((id) => id !== 'x.com/rainbow-rave'));
  assert.strictEqual(fs.readFileSync(own, 'utf8'), '// mine');
  assert.deepStrictEqual(loadPreinstalled(home2).startOff, ['www.instagram.com/desaturate', 'www.google.com/dvd-logo', 'x.com/follow-status', 'x.com/space-shooter', 'www.instagram.com/three-column-feed', 'timsrobot.com/skip-to-sandbox', 'timsrobot.com/random-mods', 'x.com/profile-styler', 'x.com/post-styler', 'x.com/style-encoder'], 'the user\'s own file isn\'t switched off');
  assert.deepStrictEqual(loadPreinstalled(home2).shipped, { 'x.com/rainbow-rave': { own: true } }, 'nor ever updated');

  // Through setup: a new workspace gets none until the user chooses (the setup page), unless --examples.
  const home5 = tempDir();
  let res = await runCli(['setup', '--verbose', '--native-dir', path.join(home5, 'native'), '--no-link'], { home: home5 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.match(res.stdout, /^mods {10}Tim's mods: none until you choose them, site by site, on the setup page in your browser \(or trif setup --examples\)$/m);
  assert.strictEqual(fs.existsSync(path.join(home5, 'sites', 'x.com')), false, 'nothing of Tim\'s on disk');
  assert.deepStrictEqual(loadPreinstalled(home5), { starter: {}, skipped: [], readded: {}, offered: [], startOff: [], sitesOn: [], shipped: {} });
  const home3 = tempDir();
  res = await runCli(['setup', '--verbose', '--native-dir', path.join(home3, 'native'), '--no-link', '--examples'], { home: home3 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.deepStrictEqual(starterChoices(home3), all);
  assert.match(res.stdout, /preinstalled, on: www\.google\.com\/hide-ai-in-results, /);
  assert.match(res.stdout, /preinstalled, off until you switch them on in the side panel: x\.com\/rainbow-rave, www\.instagram\.com\/desaturate, www\.google\.com\/dvd-logo/);
  assert.match(res.stdout, /TRIF starts on for google\.com, x\.com, amazon\.com, instagram\.com/);
  assert.ok(fs.existsSync(path.join(home3, 'sites', 'x.com', 'detox-timeline.js')));
  // A new workspace gets the merged Google mods, never the ones folded into them (preinstalled.js RETIRED).
  assert.deepStrictEqual(fs.readdirSync(path.join(home3, 'sites', 'www.google.com')).sort(), ['dvd-logo.js', 'hide-ai-in-results.js', 'hide-extra-sections.js']);
  assert.ok(!loadPreinstalled(home3).offered.some((id) => /hide-ai-mode|hide-sponsored/.test(id)));
  assert.doesNotMatch(res.stdout, /is now part of/);
  // A later setup (an update) keeps them coming, without --examples, and says nothing about choosing.
  res = await runCli(['setup', '--verbose', '--native-dir', path.join(home3, 'native'), '--no-link'], { home: home3 });
  assert.doesNotMatch(res.stdout, /Tim's mods: none until|Tim's mods not added/);
  // --no-examples: none, remembered; a later setup doesn't add them, and says where to.
  const home4 = tempDir();
  res = await runCli(['setup', '--verbose', '--native-dir', path.join(home4, 'native'), '--no-link', '--no-examples'], { home: home4 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(fs.existsSync(path.join(home4, 'sites', 'x.com')), false);
  assert.deepStrictEqual(starterChoices(home4), Object.fromEntries(starterSites().map((x) => [x, 'none'])));
  res = await runCli(['setup', '--verbose', '--native-dir', path.join(home4, 'native'), '--no-link'], { home: home4 });
  assert.match(res.stdout, /^mods {10}Tim's mods not added for Google, X, Amazon, Instagram and timsrobot\.com: Settings in the side panel adds them \(or trif setup --examples google\.com,x\.com,amazon\.com,instagram\.com,timsrobot\.com\)$/m);
  assert.strictEqual(fs.existsSync(path.join(home4, 'sites', 'x.com')), false);
  // --examples with sites: those sites' (by scope, folder or name), nothing else; TRIF on for them.
  res = await runCli(['setup', '--verbose', '--native-dir', path.join(home4, 'native'), '--no-link', '--examples', 'X,www.google.com'], { home: home4 });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.match(res.stdout, /TRIF starts on for google\.com, x\.com \(/);
  assert.deepStrictEqual(fs.readdirSync(path.join(home4, 'sites')).sort(), ['www.google.com', 'x.com']);
  assert.deepStrictEqual(loadPreinstalled(home4).sitesOn, ['google.com', 'x.com']);
  assert.deepStrictEqual(starterChoices(home4), { 'google.com': 'added', 'x.com': 'added', 'amazon.com': 'none', 'instagram.com': 'none', 'timsrobot.com': 'none' });
  res = await runCli(['setup', '--native-dir', path.join(home4, 'native'), '--no-link', '--examples', '--no-examples'], { home: home4 });
  assert.notStrictEqual(res.code, 0);
  assert.match(res.stderr, /use --examples or --no-examples, not both/);
  res = await runCli(['setup', '--native-dir', path.join(home4, 'native'), '--no-link', '--examples', 'facebook.com'], { home: home4 });
  assert.notStrictEqual(res.code, 0);
  assert.match(res.stderr, /Tim has no mods for facebook\.com: the sites are google\.com, x\.com, amazon\.com, instagram\.com, timsrobot\.com/);
  res = await runCli(['setup', '--native-dir', path.join(home4, 'native'), '--no-link', '--examples='], { home: home4 });
  assert.notStrictEqual(res.code, 0);
});

test('Tim\'s mods by id (shipped.install {ids}): those of a site are added (off ones still off); the rest left out, never brought in by updates, offered until added', () => {
  const examples = path.join(REPO, 'examples', 'sites');
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const of = (site) => PREINSTALLED.map((p) => p.id).filter((id) => id.split('/')[0].replace(/^www\./, '') === site);
  // X without Rainbow Rave, all of Google's; the rest none.
  const ticked = [...of('x.com').filter((id) => id !== 'x.com/rainbow-rave'), ...of('google.com')];
  assert.throws(() => installStarter(home, sites, examples, [], { ids: [...ticked, 'x.com/evil'] }), /x\.com\/evil isn't one of Tim's mods/);
  assert.ok(!fs.existsSync(sites), 'nothing added when one id is wrong');
  const r = installStarter(home, sites, examples, [], { ids: ticked, othersNone: true });
  assert.deepStrictEqual(r.added.sort(), [...ticked].sort());
  assert.deepStrictEqual(r.sites, ['google.com', 'x.com']);
  assert.ok(!fs.existsSync(path.join(sites, 'x.com', 'rainbow-rave.js')), 'left out: not on disk');
  assert.ok(fs.existsSync(path.join(sites, 'x.com', 'space-shooter.js')));
  const st = loadPreinstalled(home);
  assert.ok(st.startOff.includes('x.com/space-shooter') && st.startOff.includes('x.com/follow-status'), 'ticked mods that start off still start off');
  assert.deepStrictEqual(st.skipped, ['x.com/rainbow-rave']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, 'preinstalled.json'), 'utf8')).skipped, ['x.com/rainbow-rave'], 'recorded in the file');
  assert.deepStrictEqual(starterChoices(home), { 'x.com': 'added', 'google.com': 'added', 'amazon.com': 'none', 'instagram.com': 'none', 'timsrobot.com': 'none' });
  // Settings offers it: the site is added, that mod isn't.
  let x = starterOffer(home, examples).sites.find((s) => s.site === 'x.com');
  assert.deepStrictEqual(x.mods.map((m) => [m.id, m.choice]), [['x.com/detox-timeline', 'added'], ['x.com/follow-status', 'added'], ['x.com/profile-styler', 'added'], ['x.com/post-styler', 'added'], ['x.com/style-encoder', 'added'], ['x.com/space-shooter', 'added'], ['x.com/rainbow-rave', 'skipped']]);
  // Later setups and updates never bring it in; a new mod for X still comes (off).
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] });
  updateShipped(home, sites, examples);
  assert.ok(!fs.existsSync(path.join(sites, 'x.com', 'rainbow-rave.js')));
  const ex2 = tempDir();
  fs.cpSync(examples, ex2, { recursive: true });
  fs.writeFileSync(path.join(ex2, 'x.com', 'new-one.js'), '// ==WebMod==\n// @name New\n// @source trif\n// @version 1\n// ==/WebMod==\n');
  assert.deepStrictEqual(preinstallMods(home, sites, ex2, [...PREINSTALLED, { id: 'x.com/new-one', on: false }]).added, ['x.com/new-one']);
  // Adding X again (Settings' "Add the rest", or x.com's link) brings the one left out, switched off as listed.
  const again = installStarter(home, sites, examples, ['x.com']);
  assert.deepStrictEqual(again.added, ['x.com/rainbow-rave']);
  assert.ok(loadPreinstalled(home).startOff.includes('x.com/rainbow-rave'));
  assert.deepStrictEqual(loadPreinstalled(home).skipped, []);
  x = starterOffer(home, examples).sites.find((s) => s.site === 'x.com');
  assert.ok(x.mods.every((m) => m.choice === 'added'));
  // Per mod, later: one of a site not added yet adds that site with just that mod.
  const r2 = installStarter(home, sites, examples, [], { ids: ['amazon.com/simple-home'] });
  assert.deepStrictEqual([r2.added, r2.sites], [['amazon.com/simple-home'], ['amazon.com']]);
  assert.deepStrictEqual(loadPreinstalled(home).skipped, ['amazon.com/simple-shopping']);
});

test('Tim\'s mods: one the user deleted stays gone (updates too), Settings offers it, and adding the site brings it back fresh, switched as listed', () => {
  const examples = path.join(REPO, 'examples', 'sites');
  const home = tempDir();
  const sites = path.join(home, 'sites');
  installStarter(home, sites, examples, ['x.com'], { othersNone: true });
  const rr = path.join(sites, 'x.com', 'rainbow-rave.js');
  fs.writeFileSync(rr, fs.readFileSync(rr, 'utf8') + '// the user changed it\n');
  updateShipped(home, sites, examples);
  fs.unlinkSync(rr); // deleted in the panel
  const choice = (h = home) => Object.fromEntries(starterOffer(h, examples, undefined, undefined, { modsDir: path.join(h, 'sites') }).sites.find((s) => s.site === 'x.com').mods.map((m) => [m.id, m.choice]));
  assert.strictEqual(choice()['x.com/rainbow-rave'], 'deleted');
  assert.strictEqual(choice()['x.com/detox-timeline'], 'added');
  assert.deepStrictEqual(preinstallMods(home, sites, examples).added, [], 'setup doesn\'t bring it back');
  updateShipped(home, sites, examples);
  assert.ok(!fs.existsSync(rr));
  // "Add the rest" (or the site's link): a fresh copy, off as listed, recorded for updates; the browsers switch it once per stamp.
  const r = installStarter(home, sites, examples, ['x.com']);
  assert.deepStrictEqual([r.added, r.on], [['x.com/rainbow-rave'], []]);
  assert.strictEqual(fs.readFileSync(rr, 'utf8'), fs.readFileSync(path.join(examples, 'x.com', 'rainbow-rave.js'), 'utf8'));
  const st = loadPreinstalled(home);
  assert.ok(st.startOff.includes('x.com/rainbow-rave'));
  assert.match(st.readded['x.com/rainbow-rave'], /^\d{4}-/);
  assert.strictEqual(st.shipped['x.com/rainbow-rave'].hash, require('crypto').createHash('sha1').update(fs.readFileSync(rr)).digest('hex'));
  assert.strictEqual(choice()['x.com/rainbow-rave'], 'added');
  // A mod that starts on comes back on (no startOff).
  fs.unlinkSync(path.join(sites, 'x.com', 'detox-timeline.js'));
  assert.deepStrictEqual(installStarter(home, sites, examples, ['x.com']).on, ['x.com/detox-timeline']);
  assert.ok(!loadPreinstalled(home).startOff.includes('x.com/detox-timeline'));

  // From before 0.2.5: deleted on purpose then. Setup leaves it gone; Settings just offers it.
  const old = tempDir();
  installStarter(old, path.join(old, 'sites'), examples, 'all');
  const pre = JSON.parse(fs.readFileSync(path.join(old, 'preinstalled.json'), 'utf8'));
  delete pre.starter;
  fs.writeFileSync(path.join(old, 'preinstalled.json'), JSON.stringify(pre));
  fs.unlinkSync(path.join(old, 'sites', 'x.com', 'follow-status.js'));
  assert.deepStrictEqual(preinstallMods(old, path.join(old, 'sites'), examples).added, []);
  assert.strictEqual(choice(old)['x.com/follow-status'], 'deleted');
  assert.ok(!fs.existsSync(path.join(old, 'sites', 'x.com', 'follow-status.js')));
});

test('Tim\'s mods, site by site: added ones get their mods, new ones and updates; the others nothing; a workspace from before the choice counts as added', () => {
  const examples = path.join(REPO, 'examples', 'sites');
  const home = tempDir();
  const sites = path.join(home, 'sites');
  assert.deepStrictEqual(resolveSites('x.com, www.google.com,Instagram,x'), ['x.com', 'google.com', 'instagram.com']);
  assert.throws(() => resolveSites('example.com'), /Tim has no mods for example\.com/);
  // What the setup page shows: every site, ticked to start where TRIF starts on, each with its mods.
  let offer = starterOffer(home, examples);
  assert.strictEqual(offer.chosen, false);
  assert.deepStrictEqual(offer.sites.map((x) => [x.site, x.name, x.suggested, x.choice]), [
    ['google.com', 'Google', true, null], ['x.com', 'X', true, null], ['amazon.com', 'Amazon', true, null],
    ['instagram.com', 'Instagram', true, null], ['timsrobot.com', 'timsrobot.com', false, null]]);
  assert.deepStrictEqual(offer.sites.flatMap((x) => x.mods.map((m) => m.id)).sort(), PREINSTALLED.map((p) => p.id).sort(), 'every mod, from PREINSTALLED');
  assert.deepStrictEqual(offer.sites.find((x) => x.site === 'x.com').mods.map((m) => [m.name, m.on]),
    [['Detox Timeline', true], ['Follow Status', false], ['Profile Styler', false], ['Post Styler', false], ['Style Encoder', false], ['X-Flyer', false], ['Rainbow Rave', false]], 'X\'s in the panel\'s order');
  assert.ok(offer.sites.every((x) => x.mods.every((m) => m.name && typeof m.description === 'string')));
  assert.match(offer.sites.find((x) => x.site === 'timsrobot.com').note, /demo/);

  // "Add these" with X and Google ticked: theirs, TRIF on for them, none recorded for the rest.
  const r = installStarter(home, sites, examples, ['x.com', 'google.com'], { othersNone: true });
  const of = (site) => PREINSTALLED.map((p) => p.id).filter((id) => id.split('/')[0].replace(/^www\./, '') === site);
  assert.deepStrictEqual(r.added.sort(), [...of('x.com'), ...of('google.com')].sort());
  assert.deepStrictEqual(r.sites, ['google.com', 'x.com']);
  assert.deepStrictEqual(fs.readdirSync(sites).sort(), ['www.google.com', 'x.com']);
  assert.deepStrictEqual(starterChoices(home), { 'x.com': 'added', 'google.com': 'added', 'amazon.com': 'none', 'instagram.com': 'none', 'timsrobot.com': 'none' });
  assert.ok(loadPreinstalled(home).shipped['x.com/detox-timeline']?.hash, 'recorded for updates');
  offer = starterOffer(home, examples);
  assert.strictEqual(offer.chosen, true);
  assert.deepStrictEqual(offer.sites.filter((x) => x.choice === 'added').map((x) => x.site), ['google.com', 'x.com']);
  // A later setup (preinstallMods without `add`): nothing for the sites not added.
  assert.deepStrictEqual(preinstallMods(home, sites, examples), { added: [], on: [], sites: [] });
  // A new shipped mod for an added site comes (as listed: off); one for a site not added doesn't.
  const later = [...PREINSTALLED, { id: 'x.com/new-one', on: false }, { id: 'amazon.com/new-one', on: false }];
  const ex2 = tempDir();
  fs.cpSync(examples, ex2, { recursive: true });
  for (const id of ['x.com/new-one', 'amazon.com/new-one']) fs.writeFileSync(path.join(ex2, `${id}.js`), '// ==WebMod==\n// @name New\n// @source trif\n// @version 1\n// ==/WebMod==\n');
  assert.deepStrictEqual(preinstallMods(home, sites, ex2, later), { added: ['x.com/new-one'], on: [], sites: [] });
  assert.ok(loadPreinstalled(home).startOff.includes('x.com/new-one'));
  // Settings' Add, later: that site's mods and TRIF on for it; "none" never undoes it.
  const r2 = installStarter(home, sites, examples, ['amazon.com']);
  assert.deepStrictEqual([r2.added, r2.sites], [of('amazon.com'), ['amazon.com']]);
  assert.strictEqual(chooseNoStarter(home)['amazon.com'], 'added');
  // timsrobot.com isn't in SITES_ON: its mods come, TRIF isn't turned on for it.
  const r3 = installStarter(home, sites, examples, ['timsrobot.com']);
  assert.deepStrictEqual([r3.added, r3.sites], [of('timsrobot.com'), []]);

  // A workspace from before the choice (0.2.4: setup copied every site's): every site it has counts as
  // added, and keeps getting updates and new mods; a site that's new since (timsrobot.com) isn't added.
  const old = tempDir();
  const oldIds = PREINSTALLED.map((p) => p.id).filter((id) => !id.startsWith('timsrobot.com/'));
  fs.writeFileSync(path.join(old, 'preinstalled.json'), JSON.stringify({ offered: oldIds, startOff: [], sitesOn: SITES_ON }));
  assert.deepStrictEqual(starterChoices(old), { 'google.com': 'added', 'x.com': 'added', 'amazon.com': 'added', 'instagram.com': 'added' });
  assert.strictEqual(starterOffer(old, examples).chosen, true, 'the setup page doesn\'t ask again');
  assert.deepStrictEqual(starterOffer(old, examples).sites.filter((x) => x.choice !== 'added').map((x) => x.site), ['timsrobot.com'], 'offered in Settings');
  assert.deepStrictEqual(preinstallMods(old, path.join(old, 'sites'), ex2, later).added, ['x.com/new-one', 'amazon.com/new-one']);
  assert.ok(!fs.existsSync(path.join(old, 'sites', 'timsrobot.com')));
  assert.strictEqual(chooseNoStarter(old)['x.com'], 'added');
  // Written back with the record (and still read the same).
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(old, 'preinstalled.json'), 'utf8')).starter,
    { 'google.com': 'added', 'x.com': 'added', 'amazon.com': 'added', 'instagram.com': 'added', 'timsrobot.com': 'none' });
  updateShipped(old, path.join(old, 'sites'), examples);
});

// ------------------------------------------------------------------ Firefox

test('setup --browser firefox writes a manifest with allowed_extensions; doctor checks it', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const r = await runCli(['setup', '--verbose', '--browser', 'chrome,firefox', '--no-link'], { home: ws });
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
  assert.match(r.stdout, /Firefox: if it was running before this setup, quit it completely and reopen it\. Then open this\n {5}link in Firefox to install the TRIF add-on:\n {7}https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/trif-firefox\.xpi\n/);

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

test('setup prints a short summary by default, every detail with --verbose (-v); problems either way', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  const args = ['setup', '--browser', 'chrome,firefox', '--no-link'];
  const r = await runCli(args, { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const top = r.stdout.slice(0, r.stdout.indexOf('Next steps:'));
  assert.match(top, new RegExp(`^✓ TRIF ${esc(P.VERSION)} (installed|linked to .*) in .*\n`, 'm'));
  assert.doesNotMatch(top, /Added Tim's mods/, 'not without the user\'s choice');
  assert.match(top, /^✓ Set up for Google Chrome and Firefox$/m);
  // No agent on this test's PATH: a problem, so it shows.
  assert.match(top, /No coding agent found: install Claude Code/);
  assert.doesNotMatch(r.stdout, /host wrapper|CLI wrapper|native host|com\.webmods\.helper|AGENTS\.md refreshed|preinstalled, on:|extension IDs|private {7}/);
  const v = await runCli([...args, '-v'], { home: ws });
  assert.match(v.stdout, /host wrapper {2}/);
  assert.match(v.stdout, /native host {3}Firefox: .*com\.webmods\.helper\.json/);
  assert.doesNotMatch(v.stdout, /^✓ /m);
  assert.match(v.stdout, /No coding agent found/);
  assert.match(v.stdout, /Next steps:/);
  const x = await runCli([...args, '--examples', 'x.com'], { home: ws });
  assert.match(x.stdout, /^✓ Added Tim's mods for X \(TRIF starts on for x\.com\)$/m);
});

test('setup calls the panel what the browser does: the sidebar in Firefox', async () => {
  const r = await runCli(['setup', '--verbose', '--browser', 'firefox', '--no-link', '--examples'], { home: tempDir() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /off until you switch them on in the sidebar: /);
  assert.doesNotMatch(r.stdout, /side panel/);
});

test('setup for Firefox alone gives only Firefox\'s next steps', async () => {
  const ws = tempDir();
  const r = await runCli(['setup', '--verbose', '--browser', 'firefox', '--no-link', '--no-examples'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const next = r.stdout.slice(r.stdout.indexOf('Next steps:'));
  assert.match(next, /1\. If Firefox was already running before this setup, quit it completely and reopen it\.\n {2}2\. Open this link in Firefox to install the TRIF add-on, and click Add:/);
  assert.ok(next.includes(`       ${require('../helper/lib/update').firefoxAddonUrl()}\n`), 'the latest release\'s add-on');
  assert.match(next, /"Allow user scripts"/);
  assert.doesNotMatch(next, /chrome:\/\/extensions|Load unpacked/);
});

// ---- after setup, at a terminal: waiting for the browser (lib/setupwait.js)

test('setup\'s wait: what it waits for, per browser set up (none for Safari)', () => {
  const { waitingFor } = require('../helper/lib/setupwait');
  const t = (key) => browserTable('/H', 'darwin').find((b) => b.key === key);
  assert.deepEqual(waitingFor([t('chrome')]), { name: 'Chrome', how: 'drag the folder onto chrome://extensions' });
  assert.deepEqual(waitingFor([t('firefox')]), { name: 'Firefox', how: 'open the add-on link' });
  assert.equal(waitingFor([t('chrome'), t('firefox')]).name, 'Chrome or Firefox');
  assert.equal(waitingFor([t('brave')]).name, 'Brave');
  assert.equal(waitingFor([t('safari')]), null);
  assert.equal(waitingFor([{ key: 'custom', label: 'custom' }]), null);
});

test('setup\'s wait: "Waiting…", then "✓ Connected" and the next step, then user scripts; Ctrl-C and the timeout stop it', async () => {
  const { waitForBrowser } = require('../helper/lib/setupwait');
  const chrome = browserTable('/H', 'darwin').find((b) => b.key === 'chrome');
  const firefox = browserTable('/H', 'darwin').find((b) => b.key === 'firefox');
  const run = async (states, extra = {}) => {
    const lines = [];
    let i = 0;
    let clock = 0;
    const res = await waitForBrowser({ targets: [chrome], print: (l) => lines.push(l), probe: async () => states[Math.min(i++, states.length - 1)],
      sleep: async (ms) => { clock += ms; }, now: () => clock, trif: '~/.trif/bin/trif', ...extra });
    return { res, lines: lines.filter(Boolean) };
  };
  const off = { connected: false, userScripts: false, browser: null };
  const noScripts = { connected: true, userScripts: false, browser: 'Chrome' };
  const on = { connected: true, userScripts: true, browser: 'Chrome' };
  let r = await run([off, off, noScripts, noScripts, on]);
  assert.equal(r.res, 'done');
  assert.deepEqual(r.lines, [
    'Waiting for Chrome: drag the folder onto chrome://extensions… (Ctrl-C to skip)',
    '✓ Connected (Chrome)',
    'Now flip “Allow User Scripts” on the TRIF setup tab that just opened.',
    '✓ User scripts on. Open any website, click the TRIF icon, and ask for a change.',
  ]);
  // Connected with user scripts on already (setup run again): nothing to wait for.
  r = await run([on]);
  assert.deepEqual([r.res, r.lines], ['connected', []]);
  // Firefox's words for the next step.
  r = await run([off, { connected: true, userScripts: false, browser: 'Firefox' }, { connected: true, userScripts: true, browser: 'Firefox' }], { targets: [firefox] });
  assert.equal(r.lines[0], 'Waiting for Firefox: open the add-on link… (Ctrl-C to skip)');
  assert.equal(r.lines[2], 'Now click “Allow user scripts” on the TRIF setup tab that just opened, then Allow.');
  // Never connects: stops with a way to find out why.
  r = await run([off], { timeoutMs: 5000 });
  assert.equal(r.res, 'timeout');
  assert.equal(r.lines.at(-1), 'Stopped waiting for Chrome. The steps above still work; if it doesn\'t connect, run: ~/.trif/bin/trif doctor');
  // Ctrl-C.
  let stop = null;
  let n = 0;
  r = await run([off], { onStop: (fn) => { stop = fn; }, probe: async () => { if (++n === 3) stop(); return off; } });
  assert.equal(r.res, 'skipped');
});

test('setup doesn\'t wait when it isn\'t at a terminal', async () => {
  const r = await runCli(['setup', '--browser', 'chrome', '--no-link', '--no-examples'], { home: tempDir() });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Waiting for/);
});

test('setup opens chrome://extensions in Chrome (macOS, Chrome installed), quietly not otherwise', () => {
  const { openChromeExtensions } = require('../helper/lib/setup');
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; };
  const chromeAt = (p) => p === '/Applications/Google Chrome.app';
  assert.deepEqual(openChromeExtensions({ run, exists: chromeAt, platform: 'darwin', home: '/H' }), { command: ['open', ['-a', 'Google Chrome', 'chrome://extensions']], opened: true });
  assert.deepEqual(calls, [['open', '-a', 'Google Chrome', 'chrome://extensions']]);
  // In ~/Applications too.
  assert.equal(openChromeExtensions({ run, exists: (p) => p === '/H/Applications/Google Chrome.app', platform: 'darwin', home: '/H' }).opened, true);
  // No Chrome, not a Mac, or `open` failing: nothing (the printed steps say how to get there).
  calls.length = 0;
  assert.equal(openChromeExtensions({ run, exists: () => false, platform: 'darwin', home: '/H' }).opened, false);
  assert.equal(openChromeExtensions({ run, exists: chromeAt, platform: 'linux', home: '/H' }).opened, false);
  assert.deepEqual(calls, []);
  assert.equal(openChromeExtensions({ run: () => ({ status: 1 }), exists: chromeAt, platform: 'darwin', home: '/H' }).opened, false);
  assert.equal(openChromeExtensions({ run: () => { throw new Error('ENOENT'); }, exists: chromeAt, platform: 'darwin', home: '/H' }).opened, false);
});

test('setup at a terminal shows the extension folder and opens chrome://extensions (through `open`, stubbed here)', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  const stubs = path.join(root, 'stubs');
  fs.mkdirSync(stubs);
  const log = path.join(root, 'open.log');
  for (const name of ['open', 'pbcopy']) {
    fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\ncat > /dev/null\n`, { mode: 0o755 });
  }
  // A terminal, as far as setup can tell.
  const tty = path.join(root, 'tty.js');
  fs.writeFileSync(tty, 'process.stdout.isTTY = true;\n');
  const r = await new Promise((resolve) => execFile(process.execPath, ['-r', tty, path.join(REPO, 'helper', 'cli.js'), 'setup', '--browser', 'chrome', '--no-link', '--no-examples', '--no-wait'],
    { env: testEnv(ws, { PATH: `${stubs}${path.delimiter}${testEnv(ws).PATH}` }), timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout, stderr })));
  assert.equal(r.code, 0, r.stderr);
  if (process.platform !== 'darwin') return;
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /^open -R .*\/extension$/m);
  const chrome = fs.existsSync('/Applications/Google Chrome.app') || fs.existsSync(path.join(ws, 'fakehome', 'Applications', 'Google Chrome.app'));
  if (chrome) {
    assert.match(calls, /^open -a Google Chrome chrome:\/\/extensions$/m);
    assert.match(r.stdout, /on the chrome:\/\/extensions tab that just opened in Chrome/);
  } else {
    assert.doesNotMatch(calls, /chrome:\/\/extensions/);
  }
  assert.doesNotMatch(r.stdout, /Waiting for/);
});

test('Tim\'s mods: a single choice from a development build before 0.2.5 ("added" or "none") reads as that choice for every site', () => {
  for (const c of ['added', 'none']) {
    const home = tempDir();
    fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify({ starter: c, offered: [], startOff: [], sitesOn: [] }));
    assert.deepStrictEqual(starterChoices(home), Object.fromEntries(starterSites().map((x) => [x, c])));
  }
});
