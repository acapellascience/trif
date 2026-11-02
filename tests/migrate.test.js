'use strict';
// Moving a workspace from before 0.2.0 (WebMods) from ~/.webmods to ~/.trif: helper/lib/migrate.js, and
// `trif setup` doing it. Everything in temp home folders (HOME=<temp>/fakehome for the CLI; homedir for
// migrateHome itself), never the real one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { tempDir, testEnv, REPO } = require('./fake-extension');
const P = require('../helper/lib/paths');
const { migrateHome, MARKER } = require('../helper/lib/migrate');

// A ~/.webmods as 0.1.x left it: mods, settings, trash, an app copy and wrappers.
function oldWorkspace(dir) {
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('sites/x.com/mine.js', '// my mod\n');
  w('sites/x.com/plain-x.js', '// edited plain x\n');
  w('config.json', '{"autoUpdate":true}\n');
  w('instructions.md', 'talk like a caveman\n');
  w('preinstalled.json', '{"offered":["x.com/plain-x"]}\n');
  w('held.json', '{}\n');
  w('.shipped/x.com/plain-x.js', '// shipped\n');
  w('trash/x.com/old.js', '// deleted\n');
  w('runs/r1.jsonl', '{}\n');
  w('AGENTS.md', 'old guide\n');
  w('app/package.json', '{"version":"0.1.2"}\n');
  w('bin/webmods', '#!/bin/sh\n');
  return dir;
}

const read = (f) => fs.readFileSync(f, 'utf8');
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

test('migrate: nothing to do on a new install', () => {
  const h = tempDir();
  const m = migrateHome({ homedir: h });
  assert.equal(m.how, 'none');
  assert.ok(!fs.existsSync(path.join(h, '.trif')));
});

test('migrate: ~/.webmods moves to ~/.trif and becomes a link to it; a rerun does nothing', () => {
  const h = tempDir();
  oldWorkspace(path.join(h, '.webmods'));
  const m = migrateHome({ homedir: h });
  assert.equal(m.how, 'moved', JSON.stringify(m));
  assert.equal(read(path.join(h, '.trif', 'sites', 'x.com', 'mine.js')), '// my mod\n');
  assert.equal(read(path.join(h, '.trif', 'config.json')), '{"autoUpdate":true}\n');
  assert.equal(read(path.join(h, '.trif', 'trash', 'x.com', 'old.js')), '// deleted\n');
  assert.ok(fs.existsSync(path.join(h, '.trif', MARKER)));
  assert.ok(isLink(path.join(h, '.webmods')));
  assert.equal(fs.readlinkSync(path.join(h, '.webmods')), '.trif', 'relative link');
  // Old paths still lead to the same files.
  assert.equal(read(path.join(h, '.webmods', 'sites', 'x.com', 'mine.js')), '// my mod\n');
  assert.equal(migrateHome({ homedir: h }).how, 'already');
  assert.ok(isLink(path.join(h, '.webmods')));
});

test('migrate: both folders there: merged, ~/.trif wins conflicts, the other copy kept aside', () => {
  const h = tempDir();
  oldWorkspace(path.join(h, '.webmods'));
  const t = path.join(h, '.trif');
  fs.mkdirSync(path.join(t, 'sites', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(t, 'sites', 'x.com', 'plain-x.js'), '// plain x edited in .trif\n');
  fs.writeFileSync(path.join(t, 'sites', 'x.com', 'new.js'), '// only in trif\n');
  fs.writeFileSync(path.join(t, 'instructions.md'), 'talk like a caveman\n'); // identical: no conflict
  fs.writeFileSync(path.join(t, 'AGENTS.md'), 'new guide\n'); // setup's own: no conflict
  const m = migrateHome({ homedir: h });
  assert.equal(m.how, 'merged', JSON.stringify(m));
  assert.equal(read(path.join(t, 'sites', 'x.com', 'mine.js')), '// my mod\n', 'only in .webmods: moved in');
  assert.equal(read(path.join(t, 'sites', 'x.com', 'new.js')), '// only in trif\n');
  assert.equal(read(path.join(t, 'sites', 'x.com', 'plain-x.js')), '// plain x edited in .trif\n', ".trif's wins");
  assert.equal(read(path.join(t, 'config.json')), '{"autoUpdate":true}\n');
  assert.equal(read(path.join(t, 'AGENTS.md')), 'new guide\n');
  const kept = fs.readdirSync(t).filter((n) => n.startsWith('old-webmods-'));
  assert.equal(kept.length, 1, 'the conflicting copy is kept');
  assert.equal(read(path.join(t, kept[0], 'sites', 'x.com', 'plain-x.js')), '// edited plain x\n');
  assert.ok(!fs.existsSync(path.join(t, kept[0], 'instructions.md')), 'identical files are not kept twice');
  assert.match(m.notes.join('\n'), /sites\/x\.com\/plain-x\.js/);
  assert.ok(isLink(path.join(h, '.webmods')));
  assert.equal(migrateHome({ homedir: h }).how, 'already');
});

test('migrate: both there and nothing conflicts: no leftovers folder', () => {
  const h = tempDir();
  fs.mkdirSync(path.join(h, '.webmods', 'sites', 'a.com'), { recursive: true });
  fs.writeFileSync(path.join(h, '.webmods', 'sites', 'a.com', 'a.js'), '1');
  fs.mkdirSync(path.join(h, '.trif'));
  const m = migrateHome({ homedir: h });
  assert.equal(m.how, 'merged');
  assert.deepEqual(fs.readdirSync(path.join(h, '.trif')).filter((n) => n.startsWith('old-webmods-')), []);
  assert.equal(read(path.join(h, '.trif', 'sites', 'a.com', 'a.js')), '1');
});

test('migrate: ~/.webmods a link to a folder elsewhere: ~/.trif links there too', () => {
  const h = tempDir();
  const elsewhere = oldWorkspace(path.join(h, 'Dropbox', 'mods'));
  fs.symlinkSync(elsewhere, path.join(h, '.webmods'));
  const m = migrateHome({ homedir: h });
  assert.equal(m.how, 'linked');
  assert.equal(fs.realpathSync(path.join(h, '.trif')), fs.realpathSync(elsewhere));
  assert.ok(isLink(path.join(h, '.webmods')), 'left as it is');
  assert.equal(migrateHome({ homedir: h }).how, 'already');
});

test('migrate: a dangling ~/.webmods link is pointed at ~/.trif; a stray file is left alone', () => {
  const h = tempDir();
  fs.mkdirSync(path.join(h, '.trif'));
  fs.symlinkSync(path.join(h, 'gone'), path.join(h, '.webmods'));
  assert.equal(migrateHome({ homedir: h }).how, 'relinked');
  assert.equal(fs.realpathSync(path.join(h, '.webmods')), fs.realpathSync(path.join(h, '.trif')));

  const h2 = tempDir();
  fs.writeFileSync(path.join(h2, '.webmods'), 'not a folder');
  const m = migrateHome({ homedir: h2 });
  assert.equal(m.how, 'skipped');
  assert.equal(read(path.join(h2, '.webmods')), 'not a folder');
});

test('migrate: waits while another live process installs in ~/.webmods, but not for its own updater', () => {
  const h = tempDir();
  oldWorkspace(path.join(h, '.webmods'));
  // A live process (this test's parent) holding the old folder's install lock.
  fs.writeFileSync(path.join(h, '.webmods', '.app.lock'), `${process.ppid}\ntok123\n`);
  const busy = migrateHome({ homedir: h, env: {} });
  assert.equal(busy.how, 'skipped');
  assert.match(busy.error, /another install/);
  assert.ok(!fs.existsSync(path.join(h, '.trif')));
  // The updater that holds it passes its token down (an older one as WEBMODS_INSTALL_LOCK).
  const m = migrateHome({ homedir: h, env: { WEBMODS_INSTALL_LOCK: 'tok123' } });
  assert.equal(m.how, 'moved');
  assert.ok(fs.existsSync(path.join(h, '.trif', '.app.lock')), 'the lock moves with the folder');
});

test('paths: the default workspace is ~/.trif, or an unmoved ~/.webmods; ~/.webmods given means the default', () => {
  const h = tempDir();
  const old = process.env.HOME;
  const saved = { TRIF_HOME: process.env.TRIF_HOME, WEBMODS_HOME: process.env.WEBMODS_HOME };
  delete process.env.TRIF_HOME;
  delete process.env.WEBMODS_HOME;
  process.env.HOME = h;
  try {
    assert.equal(P.resolveHome(), path.join(h, '.trif'));
    fs.mkdirSync(path.join(h, '.webmods'));
    assert.equal(P.resolveHome(), path.join(h, '.webmods'), 'not moved yet: keep using it');
    assert.equal(P.resolveHome(path.join(h, '.webmods')), path.join(h, '.webmods'));
    migrateHome({ homedir: h });
    assert.equal(P.resolveHome(), path.join(h, '.trif'));
    assert.equal(P.resolveHome(path.join(h, '.webmods')), path.join(h, '.trif'), 'an older updater passes --home ~/.webmods');
    process.env.WEBMODS_HOME = path.join(h, '.webmods');
    assert.equal(P.resolveHome(), path.join(h, '.trif'));
    process.env.WEBMODS_HOME = path.join(h, 'custom');
    assert.equal(P.resolveHome(), path.join(h, 'custom'), 'WEBMODS_HOME still works');
    process.env.TRIF_HOME = path.join(h, 'custom2');
    assert.equal(P.resolveHome(), path.join(h, 'custom2'), 'TRIF_HOME wins');
    assert.equal(P.workspace().cliWrapper, path.join(h, 'custom2', 'bin', 'trif'));
  } finally {
    process.env.HOME = old;
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ------------------------------------------------------------------ through `trif setup`

// The CLI with HOME=<root>/fakehome and no TRIF_HOME/WEBMODS_HOME: the default workspace in that home.
function setupEnv(root, extra = {}) {
  const env = testEnv(root);
  delete env.TRIF_HOME;
  delete env.WEBMODS_HOME;
  return { ...env, ...extra };
}

function cliSetup(root, args = [], extra = {}) {
  fs.mkdirSync(path.join(root, 'fakehome'), { recursive: true });
  const cli = path.join(REPO, 'helper', 'cli.js');
  const argv = [cli, 'setup', '--copy', '--no-link', '--no-examples', '--native-dir', path.join(root, 'native'), ...args];
  return new Promise((resolve) => {
    execFile(process.execPath, argv, { env: setupEnv(root, extra), timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

test('setup: an upgrade from 0.1.x moves the workspace, rewrites manifests and wrappers, keeps the old command', async () => {
  const root = tempDir();
  const fake = path.join(root, 'fakehome');
  oldWorkspace(path.join(fake, '.webmods'));
  const r = await cliSetup(root, ['--home', path.join(fake, '.webmods')], { WEBMODS_HOME: path.join(fake, '.webmods') });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /moved .*\.webmods -> .*\.trif/);
  const t = path.join(fake, '.trif');
  assert.ok(isLink(path.join(fake, '.webmods')));
  assert.equal(read(path.join(t, 'sites', 'x.com', 'mine.js')), '// my mod\n');
  const man = JSON.parse(read(path.join(root, 'native', 'com.webmods.helper.json')));
  assert.equal(man.path, path.join(t, 'bin', 'trif-host'));
  for (const w of ['trif', 'webmods', 'trif-host', 'webmods-host']) {
    const text = read(path.join(t, 'bin', w));
    assert.ok(!/TRIF_HOME|WEBMODS_HOME/.test(text), `${w}: the default workspace needs no TRIF_HOME`);
  }
  assert.match(read(path.join(t, 'AGENTS.md')), /`trif`/);
  // Both commands, by the new and the old path, reach the moved workspace.
  for (const cli of [path.join(t, 'bin', 'trif'), path.join(fake, '.webmods', 'bin', 'webmods')]) {
    const { spawnSync } = require('child_process');
    const m = spawnSync(cli, ['mods'], { env: setupEnv(root), encoding: 'utf8' });
    assert.equal(m.status, 0, m.stderr);
    assert.match(m.stdout, /x\.com\/mine/);
    assert.ok(m.stdout.includes(path.join(t, 'sites')), m.stdout);
  }
  const again = await cliSetup(root);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.doesNotMatch(again.stdout, /moved/);
});

test('setup: a workspace elsewhere (TRIF_HOME) stays put, and ~/.webmods is not touched', async () => {
  const root = tempDir();
  const fake = path.join(root, 'fakehome');
  oldWorkspace(path.join(fake, '.webmods'));
  const custom = path.join(root, 'ws');
  const r = await cliSetup(root, [], { TRIF_HOME: custom });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(custom, 'sites')));
  assert.ok(!isLink(path.join(fake, '.webmods')));
  assert.ok(!fs.existsSync(path.join(fake, '.trif')));
  assert.match(read(path.join(custom, 'bin', 'trif')), /TRIF_HOME:=/);
});

test('run limits: the ~/.webmods link to the workspace is not denied, the real path is what is allowed', () => {
  const h = tempDir();
  oldWorkspace(path.join(h, '.webmods'));
  migrateHome({ homedir: h });
  fs.mkdirSync(path.join(h, 'Documents'));
  const old = process.env.HOME;
  process.env.HOME = h;
  try {
    const { runLimits } = require('../helper/lib/runs');
    const ws = P.workspace(path.join(h, '.webmods')); // as an older helper would name it
    assert.equal(ws.home, path.join(h, '.trif'));
    const box = path.join(h, 'Library', 'Caches', 'TRIF', 'boxes', 'r1');
    fs.mkdirSync(box, { recursive: true });
    const lim = runLimits(ws, { scope: 'x.com', box, screenshots: path.join(ws.home, 'screenshots', 'x.com') });
    assert.equal(lim.workspace, fs.realpathSync(path.join(h, '.trif')));
    assert.ok(lim.readable.includes(fs.realpathSync(path.join(h, '.trif'))));
    assert.ok(lim.denied.includes(path.join(h, 'Documents')));
    assert.ok(!lim.denied.includes(path.join(h, '.webmods')), 'denying the link would deny the workspace');
    assert.ok(!lim.denied.includes(path.join(h, '.trif')));
  } finally {
    process.env.HOME = old;
  }
});
