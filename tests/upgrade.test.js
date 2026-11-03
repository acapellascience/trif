'use strict';
// A real upgrade: the updater of the last WebMods release (v0.1.2, from git), as installed by that
// release's own setup in a scratch home, installs a package built from this checkout, the way a user's
// panel "Update" button does it. Then the migration's results are checked: the move to ~/.trif and the
// link left behind, TRIF's private files out of the workspace, the user's mod kept, the new wrappers, and
// the shipped mods: renamed ones updated, the ones folded into another retired (to the trash if unchanged).
// Skipped when the tag isn't there (a shallow clone).

const test = require('./posix-only')('the v0.1.2 updater, which never ran on Windows');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tempDir, REPO } = require('./fake-extension');

const TAG = 'v0.1.2';
const hasTag = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${TAG}^{commit}`], { cwd: REPO, encoding: 'utf8' }).status === 0;

// Runs the old updater (in <home>/.webmods/app) with a feed signed by a test key, serving `tgz`.
const PROBE = `'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [tgzFile, version] = process.argv.slice(2);
const appDir = path.join(process.env.HOME, '.webmods', 'app');
const U = require(path.join(appDir, 'helper/lib/update.js'));
const P = require(path.join(appDir, 'helper/lib/paths.js'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const tgz = fs.readFileSync(tgzFile);
const feed = Buffer.from(JSON.stringify({ version, published: '2026-11-03', notes: 'n', package: { url: 'https://example.invalid/trif.tgz', sha256: crypto.createHash('sha256').update(tgz).digest('hex'), size: tgz.length } }));
const sig = crypto.sign(null, feed, privateKey).toString('base64');
const fetch = async (url) => (url.endsWith('.sig') ? Buffer.from(sig) : url.endsWith('.tgz') ? tgz : feed);
U.install(P.workspace(), { root: appDir, fetch, publicKey, browsers: ['chrome'] }).then(
  (r) => console.log(JSON.stringify({ ok: true, from: r.from, to: r.to, warning: r.warning || null, output: r.output })),
  (e) => console.log(JSON.stringify({ ok: false, error: e.message })));
`;

function scratchEnv(home) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(TRIF|WEBMODS)_/.test(k) || /_API_KEY$/i.test(k)) delete env[k];
  return {
    ...env, HOME: home, TRIF_NO_LAUNCHCTL: '1', WEBMODS_NO_LAUNCHCTL: '1', TRIF_DEFAULT_AGENT_DIRS: '', WEBMODS_DEFAULT_AGENT_DIRS: '',
    TRIF_UPDATE_DELAY: '2000000000', WEBMODS_UPDATE_DELAY: '2000000000',
    TRIF_KEYCHAIN_BIN: path.join(home, 'no-keychain', 'security'), // never the real Keychain
    npm_config_update_notifier: 'false',
  };
}

const bumpVersion = (v) => { const [a, b] = v.split('.').map(Number); return `${a}.${b + 1}.0`; };

test(`upgrade: the ${TAG} updater installs this checkout's package; everything moves where it should`, { skip: !hasTag && `no git tag ${TAG}`, timeout: 300000 }, () => {
  const root = tempDir('wm-up-');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const env = scratchEnv(home);
  const sh = (file, args, opts = {}) => {
    const r = spawnSync(file, args, { encoding: 'utf8', env, cwd: root, timeout: 180000, ...opts });
    assert.equal(r.status, 0, `${file} ${args.join(' ')}:\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };

  // The old release, installed by its own setup, as a 0.1.2 user has it.
  const old = path.join(root, 'old');
  fs.mkdirSync(old);
  sh('git', ['archive', '-o', path.join(root, 'old.tar'), TAG], { cwd: REPO });
  sh('/usr/bin/tar', ['-xf', path.join(root, 'old.tar'), '-C', old]);
  sh(process.execPath, [path.join(old, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--browser', 'chrome'], { cwd: home });
  const legacy = path.join(home, '.webmods');
  assert.ok(fs.existsSync(path.join(legacy, 'app', 'helper', 'lib', 'update.js')));
  fs.mkdirSync(path.join(legacy, 'sites', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'sites', 'example.com', 'mine.js'), '// ==WebMod==\n// @match https://example.com/*\n// ==/WebMod==\nconsole.log("mine");\n');
  fs.appendFileSync(path.join(legacy, 'helper.log'), 'an old helper was here\n');
  // A shipped mod 0.2.0 folds into another one, edited by the user (hide-ai-mode is left as shipped).
  const google = path.join(legacy, 'sites', 'www.google.com');
  assert.ok(fs.existsSync(path.join(google, 'hide-ai-mode.js')));
  fs.appendFileSync(path.join(google, 'hide-sponsored.js'), '// the user changed this\n');

  // This checkout, packed at a newer version (as the next release would be).
  const src = path.join(root, 'src');
  for (const item of [...JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).files, 'package.json', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(REPO, item), path.join(src, item), { recursive: true });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  const version = bumpVersion(pkg.version);
  pkg.version = version;
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const man = JSON.parse(fs.readFileSync(path.join(src, 'extension', 'manifest.json'), 'utf8'));
  man.version = version;
  fs.writeFileSync(path.join(src, 'extension', 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
  fs.mkdirSync(path.join(root, 'pkg'));
  const packed = JSON.parse(sh('npm', ['pack', '--json', '--pack-destination', path.join(root, 'pkg')], { cwd: src, env: { ...env, npm_config_cache: path.join(root, 'npm-cache') } }));
  const tgz = path.join(root, 'pkg', packed[0].filename);

  // The old updater installs it.
  fs.writeFileSync(path.join(root, 'probe.js'), PROBE);
  const out = sh(process.execPath, [path.join(root, 'probe.js'), tgz, version], { cwd: home });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.from, '0.1.2');
  assert.equal(r.to, version);
  const info = `setup's output:\n${r.output}`;

  // ~/.webmods moved to ~/.trif, a link left behind; the app copy is the new version.
  const trif = path.join(home, '.trif');
  assert.ok(fs.lstatSync(trif).isDirectory(), info);
  assert.ok(fs.lstatSync(legacy).isSymbolicLink(), info);
  assert.equal(fs.realpathSync(legacy), fs.realpathSync(trif));
  assert.equal(JSON.parse(fs.readFileSync(path.join(trif, 'app', 'package.json'), 'utf8')).version, version);
  // The user's mod is kept.
  assert.match(fs.readFileSync(path.join(trif, 'sites', 'example.com', 'mine.js'), 'utf8'), /console\.log\("mine"\)/);
  // TRIF's private files left the workspace, into the private folder.
  const priv = os.platform() === 'darwin' ? path.join(home, 'Library', 'Application Support', 'TRIF') : path.join(home, '.local', 'state', 'trif');
  for (const f of ['config.json', 'helper.log', 'runs', 'screenshots']) assert.ok(!fs.existsSync(path.join(trif, f)), `${f} still in the workspace\n${info}`);
  const cfg = JSON.parse(fs.readFileSync(path.join(priv, 'config.json'), 'utf8'));
  assert.ok(cfg.env && cfg.env.PATH, 'the recorded PATH came along');
  assert.deepEqual(cfg.modsDirReal, { path: path.join(trif, 'sites'), real: fs.realpathSync(path.join(trif, 'sites')) });
  assert.match(fs.readFileSync(path.join(priv, 'helper.log'), 'utf8'), /an old helper was here/);
  // The new wrappers, under both names, and the native host manifest pointing at the new place.
  for (const w of ['trif', 'trif-host', 'webmods', 'webmods-host']) assert.ok(fs.existsSync(path.join(trif, 'bin', w)), `bin/${w}\n${info}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.webmods.helper.json'), 'utf8'));
  assert.equal(manifest.path, path.join(trif, 'bin', 'trif-host'));
  // The new trif works on the moved workspace.
  const mods = sh(path.join(trif, 'bin', 'trif'), ['mods'], { cwd: home });
  assert.match(mods, /example\.com\/mine/);

  // The shipped mods. Unchanged copies are the new versions (renamed: Timeline Detox; merged: AI Banisher,
  // Just Results); the unchanged copy of a mod folded into another is in the trash; the edited one stays.
  const sites = path.join(trif, 'sites');
  for (const id of ['x.com/plain-x', 'www.instagram.com/following-only-feed', 'www.google.com/hide-ai-in-results', 'www.google.com/hide-extra-sections']) {
    assert.strictEqual(fs.readFileSync(path.join(sites, `${id}.js`), 'utf8'), fs.readFileSync(path.join(REPO, 'examples', 'sites', `${id}.js`), 'utf8'), `${id}\n${info}`);
  }
  assert.match(fs.readFileSync(path.join(sites, 'x.com', 'plain-x.js'), 'utf8'), /@name +Timeline Detox\n/);
  assert.match(fs.readFileSync(path.join(sites, 'www.google.com', 'hide-ai-in-results.js'), 'utf8'), /@name +AI Banisher\n/);
  assert.ok(!fs.existsSync(path.join(sites, 'www.google.com', 'hide-ai-mode.js')), `hide-ai-mode.js is still there\n${info}`);
  assert.deepStrictEqual(fs.readdirSync(path.join(trif, 'trash', 'www.google.com')).map((f) => f.replace(/@.*/, '')), ['hide-ai-mode']);
  assert.match(fs.readFileSync(path.join(sites, 'www.google.com', 'hide-sponsored.js'), 'utf8'), /the user changed this/);
  const pre = JSON.parse(fs.readFileSync(path.join(trif, 'preinstalled.json'), 'utf8'));
  assert.deepStrictEqual(pre.shipped['www.google.com/hide-sponsored'], { retired: { into: 'www.google.com/hide-extra-sections', kept: true } });
  assert.strictEqual(pre.shipped['www.google.com/hide-ai-mode'].retired.into, 'www.google.com/hide-ai-in-results');
  assert.ok(pre.offered.includes('www.google.com/hide-ai-mode'), 'still counted as offered: never offered again');
});
