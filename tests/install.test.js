'use strict';
// Tests for installing WebMods: the npm package, copy vs link installs, allowed_origins for every
// extension ID, and the matching doctor checks. Everything runs in temp dirs (--home, --native-dir).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { runCli, tempDir, testEnv, REPO } = require('./fake-extension');
const P = require('../helper/lib/paths');
const { installApp, chooseMode, cleanPath } = require('../helper/lib/setup');
const { preinstallMods, loadPreinstalled } = require('../helper/lib/preinstalled');
const { checkWrapperScript } = require('../helper/lib/doctor');

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

// A package folder like npm's (no .git): what `npx webmods` runs from.
function fakePackage(root) {
  const pkg = path.join(root, 'pkg', 'node_modules', 'webmods');
  const r = installApp(REPO, pkg);
  assert.equal(r.how, 'created');
  assert.ok(!fs.existsSync(path.join(pkg, '.git')));
  return pkg;
}

// ------------------------------------------------------------------ package and version

test('package: npm metadata, files allowlist and one version everywhere', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'webmods');
  assert.deepEqual(pkg.bin, { webmods: 'helper/cli.js' });
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
    'extension/manifest.json', 'examples/sites']) {
    assert.ok(fs.existsSync(path.join(app, f)), f);
  }
  for (const f of ['tests', '.keys', '.git', 'docs']) assert.ok(!fs.existsSync(path.join(app, f)), `${f} not copied`);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'webmods-host')), path.join(app, 'helper', 'host.js'));
  assert.equal(wrapperScript(path.join(ws, 'bin', 'webmods')), path.join(app, 'helper', 'cli.js'));
  assert.equal(fs.statSync(path.join(app, 'helper', 'cli.js')).mode & 0o777, fs.statSync(path.join(REPO, 'helper', 'cli.js')).mode & 0o777);
  assert.equal(fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(app, 'helper', 'workspace', 'AGENTS.md'), 'utf8'));
  assert.match(r.stdout, new RegExp(`app {11}${esc(app)} \\(v${esc(P.VERSION)}, created, copied from`));
  assert.match(r.stdout, new RegExp(`choose ${esc(path.join(app, 'extension'))}\n`));
  assert.match(r.stdout, /Web Store listing will replace this step/);
  assert.deepEqual(readManifest(native).allowed_origins, [DEV_ORIGIN]);

  // The CLI wrapper runs the copy (its examples, its template).
  const viaWrapper = await new Promise((resolve) => {
    execFile(path.join(ws, 'bin', 'webmods'), ['new', 'example.com', 'hello'], { env: { PATH: process.env.PATH, HOME: root } }, (e, so, se) => resolve({ e, so, se }));
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
  assert.equal(wrapperScript(path.join(ws, 'bin', 'webmods-host')), path.join(ws, 'app', 'helper', 'host.js'));

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
  assert.equal(wrapperScript(path.join(ws, 'bin', 'webmods-host')), path.join(REPO, 'helper', 'host.js'));
  assert.ok(!fs.existsSync(path.join(ws, 'app')));
  assert.match(r.stdout, /linked: the wrappers run this folder/);

  const pkg = fakePackage(root);
  r = await runOtherCli(path.join(pkg, 'helper', 'cli.js'), ['setup', '--link', '--home', ws, '--native-dir', path.join(root, 'native'), '--no-link'], ws);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(wrapperScript(path.join(ws, 'bin', 'webmods-host')), path.join(pkg, 'helper', 'host.js'));
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
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ extensionIds: [OTHER_ID, 'not-an-id'] }));
  let r = await runCli(['setup', '--native-dir', native, '--no-link'], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  const all = P.extensionOrigins({ extensionIds: [OTHER_ID] });
  assert.ok(all.includes(DEV_ORIGIN) && all.includes(`chrome-extension://${OTHER_ID}/`));
  assert.deepEqual(readManifest(native).allowed_origins, all);
  assert.match(r.stdout, /ignored config\.json extensionIds entries .*"not-an-id"/);
  // setup keeps extensionIds when it records PATH.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ws, 'config.json'), 'utf8')).extensionIds, [OTHER_ID, 'not-an-id']);

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
  assert.match(old.title, /is v0\.0\.1-old, but this webmods is v/);
  assert.match(old.fix, /setup --copy/);
  assert.match(checkWrapperScript('/Users/a/.npm/_npx/123/node_modules/webmods/helper/host.js', ws).title, /npx cache/);
  assert.match(checkWrapperScript('/somewhere/else/helper/host.js', ws).title, /not this copy/);
});

test('preinstalled mods: Plain X and the Instagram mods once, marked to start off; never over the user\'s file, never back after deleting it', async () => {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const examples = path.join(REPO, 'examples', 'sites');
  const plainx = path.join(sites, 'x.com', 'plain-x.js');
  const ids = ['x.com/plain-x', 'www.instagram.com/following-only-feed', 'www.instagram.com/hide-reposts', 'www.instagram.com/hide-ai-content', 'www.instagram.com/desaturate'];
  assert.deepStrictEqual(preinstallMods(home, sites, examples), ids);
  for (const id of ids) assert.ok(fs.existsSync(path.join(sites, `${id}.js`)), id);
  assert.strictEqual(fs.readFileSync(plainx, 'utf8'), fs.readFileSync(path.join(examples, 'x.com', 'plain-x.js'), 'utf8'));
  assert.deepStrictEqual(loadPreinstalled(home), { offered: ids, startOff: ids });
  fs.unlinkSync(plainx);
  assert.deepStrictEqual(preinstallMods(home, sites, examples), [], 'deleted: not brought back');
  assert.strictEqual(fs.existsSync(plainx), false);

  const home2 = tempDir();
  const own = path.join(home2, 'sites', 'x.com', 'plain-x.js');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '// mine');
  assert.deepStrictEqual(preinstallMods(home2, path.join(home2, 'sites'), examples), ids.slice(1));
  assert.strictEqual(fs.readFileSync(own, 'utf8'), '// mine');
  assert.deepStrictEqual(loadPreinstalled(home2), { offered: ids, startOff: ids.slice(1) }, 'the user\'s own file isn\'t switched off');

  // Through setup, and --no-examples.
  const home3 = tempDir();
  let r = await runCli(['setup', '--native-dir', path.join(home3, 'native'), '--no-link'], { home: home3 });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /preinstalled x\.com\/plain-x, www\.instagram\.com\/following-only-feed.*switched off/);
  assert.ok(fs.existsSync(path.join(home3, 'sites', 'x.com', 'plain-x.js')));
  const home4 = tempDir();
  r = await runCli(['setup', '--native-dir', path.join(home4, 'native'), '--no-link', '--no-examples'], { home: home4 });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(fs.existsSync(path.join(home4, 'sites', 'x.com')), false);
});
