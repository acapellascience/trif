'use strict';
// The phone view's run held to the site's phone twin, sites/phone~<site>/ (docs/MOBILE-EDIT.md "Phone mods"):
// what reaches the mods folder from its working folder (stage.js ownFolder, ownTwin), the folders its sandbox
// lets it write (runs.js runLimits), what its `trif delete` and `trif restore` may touch (trash.js), a sensitive
// site's twin as its own folder; then the same through the real helper with a stand-in agent. And the phone
// view's group switches, its own (extension/lib.js). The phone link's runs (branch phone-link, stage.js
// `twinOnly`) are held the same way.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// A home folder of this process's own (os.homedir(): runLimits' denies), never the user's.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phone-scope-'));
process.env.HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.HOME);

const { Stage, ownFolder, ownTwin } = require('../helper/lib/stage');
const { runLimits } = require('../helper/lib/runs');
const trash = require('../helper/lib/trash');
const { FakeExtension, tempDir, privDir, waitFor, runCli, writeMod } = require('./fake-extension');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
  fs.rmSync(TMP, { recursive: true, force: true });
});

const put = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const read = (f) => fs.readFileSync(f, 'utf8');
const head = (match, body = '') => `// ==WebMod==\n// @match ${match}\n// ==/WebMod==\n${body}`;
const rel = (...p) => path.join('sites', ...p);

test('ownFolder: a phone scope\'s own folder is its phone twin only, a sensitive site\'s too; desktop scopes as before', () => {
  const G = ['mail.google.com'];
  for (const [name, scope, splits, own] of [
    ['phone~x.com', 'phone~x.com', [], true],
    ['phone~api.x.com', 'phone~x.com', [], true], // (a part of the site)
    ['phone~www.x.com', 'phone~x.com', [], true],
    ['x.com', 'phone~x.com', [], false], // (the site's desktop folder: to read)
    ['all-sites', 'phone~x.com', [], false],
    ['phone~y.com', 'phone~x.com', [], false],
    ['y.com', 'phone~x.com', [], false],
    ['phone~mail.google.com', 'phone~mail.google.com', G, true], // (it was another site's: phone~phone~mail.google.com)
    ['phone~inbox.mail.google.com', 'phone~mail.google.com', G, true],
    ['mail.google.com', 'phone~mail.google.com', G, false],
    ['phone~google.com', 'phone~mail.google.com', G, false],
    ['phone~mail.google.com', 'phone~google.com', G, false], // (a site of its own, to google.com's phone view too)
    ['phone~docs.google.com', 'phone~google.com', G, true],
    // desktop scopes: unchanged
    ['x.com', 'x.com', [], true],
    ['all-sites', 'x.com', [], true],
    ['phone~x.com', 'x.com', [], false],
    ['mail.google.com', 'mail.google.com', G, true],
    ['google.com', 'mail.google.com', G, false],
    ['mail.google.com', 'google.com', G, false],
  ]) {
    assert.equal(ownFolder(name, scope, splits), own, `ownFolder(${name}, ${scope})`);
    if (scope.startsWith('phone~')) assert.equal(ownTwin(name, scope, splits), own, `ownTwin(${name}, ${scope})`);
  }
  assert.equal(ownTwin('phone~x.com', 'x.com'), false, 'ownTwin: never for a desktop scope');
});

// A workspace: the site's desktop mods (or none yet), its phone twin, all-sites/, another site and its twin.
function setup({ scope = 'phone~x.com', splits = [], desktop = true } = {}) {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  if (desktop) put(path.join(sites, 'x.com', 'tidy.js'), head('https://x.com/*', '// desktop\n'));
  put(path.join(sites, 'phone~x.com', 'bar.js'), head('https://x.com/*', '// phone\n'));
  put(path.join(sites, 'phone~x.com', 'files', 'icon.png'), 'PNG');
  put(path.join(sites, 'all-sites', 'dark.js'), head('*://*/*'));
  put(path.join(sites, 'y.com', 'other.js'), head('https://y.com/*'));
  put(path.join(sites, 'phone~y.com', 'other.js'), head('https://y.com/*'));
  put(path.join(sites, 'mail.google.com', 'inbox.js'), head('https://mail.google.com/*'));
  put(path.join(sites, 'phone~mail.google.com', 'inbox.js'), head('https://mail.google.com/*', '// phone inbox\n'));
  put(path.join(sites, 'phone~mail.google.com', 'files', 'tone.mp3'), 'TONE');
  put(path.join(sites, 'phone~google.com', 'search.js'), head('https://www.google.com/*'));
  const ws = { home, modsDir: sites };
  const box = path.join(home, 'boxes');
  fs.mkdirSync(box);
  const warnings = [];
  const stage = new Stage({ ws, dir: path.join(box, 'r1.ws'), scope, splits, liveReal: fs.realpathSync(sites), logger: { info() {}, warn: (m) => warnings.push(m) } }).create();
  return { home, sites, ws, stage, warnings, s: (...p) => path.join(stage.sites, ...p), l: (...p) => path.join(sites, ...p) };
}

test('stage, phone view (phone~x.com): only its phone twin\'s files reach the mods folder, not all-sites/, a desktop folder or a new one', () => {
  const { stage, s, l, warnings } = setup();
  assert.equal(read(s('phone~x.com', 'files', 'icon.png')), 'PNG', 'its twin\'s files/ are in its copy');
  assert.ok(fs.existsSync(s('x.com', 'tidy.js')), 'the desktop mods are there to read');
  put(s('phone~x.com', 'new.js'), head('https://x.com/*', '// new phone mod\n'));
  fs.appendFileSync(s('phone~x.com', 'bar.js'), '// edited\n');
  put(s('phone~x.com', 'files', 'made.txt'), 'made');
  put(s('phone~api.x.com', 'api.js'), head('https://api.x.com/*')); // (a part of its site's twin: its own)
  put(s('all-sites', 'sneaky.js'), head('*://*/*'));
  fs.appendFileSync(s('all-sites', 'dark.js'), '// darker\n');
  put(s('x.com', 'desk.js'), head('https://x.com/*'));
  fs.appendFileSync(s('x.com', 'tidy.js'), '// changed from the phone view\n');
  put(s('fresh.org', 'a.js'), head('https://fresh.org/*')); // (a new folder for another site)
  put(s('phone~new.org', 'a.js'), head('https://new.org/*')); // (a new twin of another site)
  put(s('phone~y.com', 'other.js'), head('https://y.com/*', '// changed\n'));
  fs.unlinkSync(s('x.com', 'tidy.js')); // (its copy of a desktop mod deleted: not in the mods folder)
  const r = stage.sync();
  assert.deepEqual(r.pushed.sort(), [rel('phone~api.x.com', 'api.js'), rel('phone~x.com', 'bar.js'), rel('phone~x.com', 'files', 'made.txt'), rel('phone~x.com', 'new.js')]);
  assert.deepEqual(r.refused.sort(), [rel('all-sites', 'dark.js'), rel('all-sites', 'sneaky.js'), rel('fresh.org', 'a.js'), rel('phone~new.org', 'a.js'), rel('phone~y.com', 'other.js'), rel('x.com', 'desk.js'), rel('x.com', 'tidy.js')]);
  for (const f of [['all-sites', 'sneaky.js'], ['x.com', 'desk.js'], ['fresh.org', 'a.js'], ['phone~new.org', 'a.js']]) assert.ok(!fs.existsSync(l(...f)), f.join('/'));
  assert.equal(read(l('all-sites', 'dark.js')), head('*://*/*'));
  assert.equal(read(l('x.com', 'tidy.js')), head('https://x.com/*', '// desktop\n'), 'the desktop mod as it was');
  assert.ok(fs.existsSync(s('x.com', 'tidy.js')), 'and back in its copy');
  assert.equal(read(l('phone~y.com', 'other.js')), head('https://y.com/*'));
  assert.match(read(l('phone~x.com', 'bar.js')), /edited/);
  assert.ok(warnings.some((w) => /sites\/x\.com\/desk\.js not copied to the mods folder: a phone view's run writes its phone twin's folder only \(sites\/phone~x\.com\/\), not x\.com\//.test(w)), warnings.join('\n'));
  // (a refused new folder never becomes one of its own: the next change there is refused too)
  fs.appendFileSync(s('fresh.org', 'a.js'), '// again\n');
  assert.deepEqual(stage.sync().pushed, []);
  assert.ok(!fs.existsSync(l('fresh.org')));
});

test('stage, phone view: the site\'s desktop folder not made yet is refused too (it was taken for a new folder)', () => {
  const { stage, s, l } = setup({ desktop: false });
  put(s('x.com', 'first.js'), head('https://x.com/*'));
  put(s('www.x.com', 'second.js'), head('https://x.com/*'));
  const r = stage.sync();
  assert.deepEqual(r.pushed, []);
  assert.deepEqual(r.refused.sort(), [rel('www.x.com', 'second.js'), rel('x.com', 'first.js')]);
  assert.ok(!fs.existsSync(l('x.com')) && !fs.existsSync(l('www.x.com')));
});

test('stage, phone view of a sensitive site (phone~mail.google.com): its twin is its own folder, files/ too; google.com\'s twin isn\'t', () => {
  const { stage, s, l } = setup({ scope: 'phone~mail.google.com', splits: ['mail.google.com'] });
  assert.equal(read(s('phone~mail.google.com', 'files', 'tone.mp3')), 'TONE', 'its twin\'s files/ in its copy');
  put(s('phone~mail.google.com', 'new.js'), head('https://mail.google.com/*'));
  put(s('phone~mail.google.com', 'files', 'made.txt'), 'made');
  put(s('phone~google.com', 'sneaky.js'), head('https://www.google.com/*'));
  put(s('mail.google.com', 'desk.js'), head('https://mail.google.com/*'));
  const r = stage.sync();
  assert.deepEqual(r.pushed.sort(), [rel('phone~mail.google.com', 'files', 'made.txt'), rel('phone~mail.google.com', 'new.js')]);
  assert.deepEqual(r.refused.sort(), [rel('mail.google.com', 'desk.js'), rel('phone~google.com', 'sneaky.js')]);
  assert.ok(fs.existsSync(l('phone~mail.google.com', 'new.js')));
  // google.com's phone view: mail.google.com's twin is another site's
  const g = setup({ scope: 'phone~google.com', splits: ['mail.google.com'] });
  put(g.s('phone~mail.google.com', 'sneaky.js'), head('https://mail.google.com/*'));
  put(g.s('phone~google.com', 'ok.js'), head('https://www.google.com/*'));
  const r2 = g.stage.sync();
  assert.deepEqual(r2.pushed, [rel('phone~google.com', 'ok.js')]);
  assert.deepEqual(r2.refused, [rel('phone~mail.google.com', 'sneaky.js')]);
});

test('runLimits, phone view of a sensitive site: its twin writable, every other folder read-only', () => {
  const home = tempDir();
  const priv = tempDir();
  const modsDir = path.join(home, 'sites');
  for (const d of ['mail.google.com', 'phone~mail.google.com', 'google.com', 'phone~google.com', 'all-sites', 'x.com']) fs.mkdirSync(path.join(modsDir, d), { recursive: true });
  const ws = { home, modsDir, private: priv };
  const box = tempDir();
  const lockedOf = (scope) => [...runLimits(ws, { scope, splits: ['mail.google.com'], box, screenshots: box }).locked].sort();
  const all = (...ds) => ds.map((d) => path.join('sites', d)).sort();
  assert.deepEqual(lockedOf('phone~mail.google.com'), all('all-sites', 'google.com', 'mail.google.com', 'phone~google.com', 'x.com'), 'its own twin isn\'t locked (it was: it failed closed)');
  assert.deepEqual(lockedOf('phone~google.com'), all('all-sites', 'google.com', 'mail.google.com', 'phone~mail.google.com', 'x.com'));
  assert.deepEqual(lockedOf('mail.google.com'), all('google.com', 'phone~google.com', 'phone~mail.google.com', 'x.com'), 'a desktop run as before');
  assert.deepEqual(lockedOf('google.com'), all('mail.google.com', 'phone~google.com', 'phone~mail.google.com', 'x.com'));
});

test('trash: a phone view\'s run deletes and restores only its phone twin\'s mods', () => {
  const home = tempDir();
  const modsDir = path.join(home, 'sites');
  const ws = { home, modsDir };
  put(path.join(modsDir, 'x.com', 'tidy.js'), head('https://x.com/*'));
  put(path.join(modsDir, 'phone~x.com', 'bar.js'), head('https://x.com/*'));
  put(path.join(modsDir, 'phone~mail.google.com', 'inbox.js'), head('https://mail.google.com/*'));
  put(path.join(modsDir, 'phone~google.com', 'search.js'), head('https://www.google.com/*'));
  const phone = { scope: 'phone~x.com', splits: [] };
  assert.throws(() => trash.deleteMod(ws, 'x.com/tidy', phone), /can only delete mods of phone~x\.com; x\.com\/tidy is another site's/);
  assert.ok(fs.existsSync(path.join(modsDir, 'x.com', 'tidy.js')));
  assert.equal(trash.deleteMod(ws, 'phone~x.com/bar', phone).id, 'phone~x.com/bar');
  assert.equal(trash.restoreMod(ws, 'phone~x.com/bar', phone).id, 'phone~x.com/bar');
  // a desktop mod in the trash: not the phone view's to bring back
  trash.deleteMod(ws, 'x.com/tidy', { scope: 'x.com' });
  assert.throws(() => trash.restoreMod(ws, 'x.com/tidy', phone), /can only restore mods of phone~x\.com/);
  assert.ok(!fs.existsSync(path.join(modsDir, 'x.com', 'tidy.js')));
  // and a desktop run, a phone mod (as before)
  assert.throws(() => trash.deleteMod(ws, 'phone~x.com/bar', { scope: 'x.com' }), /another site's/);
  // a sensitive site's twin: its own (it was refused), not google.com's phone view's
  const G = ['mail.google.com'];
  assert.throws(() => trash.deleteMod(ws, 'phone~mail.google.com/inbox', { scope: 'phone~google.com', splits: G }), /another site's/);
  assert.throws(() => trash.deleteMod(ws, 'phone~google.com/search', { scope: 'phone~mail.google.com', splits: G }), /another site's/);
  assert.equal(trash.deleteMod(ws, 'phone~mail.google.com/inbox', { scope: 'phone~mail.google.com', splits: G }).id, 'phone~mail.google.com/inbox');
  assert.equal(trash.deleteMod(ws, 'phone~google.com/search', { scope: 'phone~google.com', splits: G }).id, 'phone~google.com/search');
});

// ---- the same through the helper: a run from the phone view (the background's agent.start for a phone chat:
// site, scope phone~<site>, phone), with a stand-in Claude Code that writes everywhere and waits.
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(__dirname, 'call.json'), JSON.stringify({ cwd: process.cwd(), env: process.env }));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }) + '\\n');
const put = (p, body) => { const f = path.join(process.cwd(), 'sites', p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
const head = (m) => '// ==WebMod==\\n// @match ' + m + '\\n// ==/WebMod==\\n';
const site = fs.readFileSync(path.join(__dirname, 'site'), 'utf8');
put('phone~' + site + '/mine.js', head('https://' + site + '/*') + '// the phone view\\'s\\n');
put('phone~' + site + '/files/note.txt', 'note');
put(site + '/desk.js', head('https://' + site + '/*'));
put('all-sites/everywhere.js', head('*://*/*'));
put('fresh.org/a.js', head('https://fresh.org/*'));
fs.writeFileSync(path.join(__dirname, 'wrote'), '1');
setInterval(() => {}, 1000);
`;

function helperHome(site) {
  const h = tempDir();
  const bin = path.join(h, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(h, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(bin, 'site'), site); // (the site the stand-in writes for)
  fs.writeFileSync(path.join(privDir(h), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  return { home: h, bin };
}
let n = 0;
async function ask(ext, cmd, args = {}) {
  const id = `p${++n}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}

for (const { site, splits, desktopFolder } of [
  { site: 'example.com', splits: [], desktopFolder: true },
  { site: 'example.com', splits: [], desktopFolder: false },
  { site: 'mail.example.com', splits: ['mail.example.com'], desktopFolder: true },
]) {
  test(`a phone view's run on ${site}${desktopFolder ? '' : ' (no desktop folder yet)'}: only its twin reaches the mods folder, and its trif delete takes only its twin's mods`, { timeout: 60000 }, async () => {
    const { home: h, bin } = helperHome(site);
    const twin = `phone~${site}`;
    if (desktopFolder) writeMod(h, site, 'old.js', head(`https://${site}/*`, '// desktop\n'));
    writeMod(h, twin, 'bar.js', head(`https://${site}/*`, '// phone\n'));
    const ext = new FakeExtension({ home: h, env: { TRIF_AGENT_KILL_GRACE_MS: '400' } });
    cleanups.push(() => ext.close());
    ext.hello();
    await ext.waitForSocket();
    const r = await ask(ext, 'agent.start', { agent: 'claude', site, scope: twin, splits, url: `https://${site}/home`, tabId: 12, phone: { device: 'iPhone', width: 390 }, prompt: 'make a phone mod' });
    assert.ok(r.ok, r.error);
    const runId = r.result.runId;
    const call = await waitFor(() => fs.existsSync(path.join(bin, 'wrote')) && JSON.parse(read(path.join(bin, 'call.json'))), { timeout: 20000, message: 'the stand-in to write' });
    await waitFor(() => fs.existsSync(path.join(h, 'sites', twin, 'mine.js')), { timeout: 10000, message: 'its twin\'s mod in the mods folder' });
    const env = { TRIF_RUN_TOKEN: call.env.TRIF_RUN_TOKEN, TRIF_RUN_BOX: call.env.TRIF_RUN_BOX, TRIF_RUN_MODS_DIR: call.env.TRIF_RUN_MODS_DIR, TRIF_RUN_LIVE_MODS_DIR: call.env.TRIF_RUN_LIVE_MODS_DIR };
    if (desktopFolder) {
      const del = await runCli(['delete', `${site}/old`], { home: h, env });
      assert.notEqual(del.code, 0, 'trif delete of a desktop mod from the phone view: refused');
      assert.match(del.stderr + del.stdout, new RegExp(`can only delete mods of ${twin.replace(/\./g, '\\.')}`));
      assert.ok(fs.existsSync(path.join(h, 'sites', site, 'old.js')), 'the desktop mod is still there');
    }
    const ok = await runCli(['delete', `${twin}/bar`], { home: h, env });
    assert.equal(ok.code, 0, ok.stderr);
    assert.ok(!fs.existsSync(path.join(h, 'sites', twin, 'bar.js')), 'its own phone mod: deleted');
    await ask(ext, 'agent.stop', { runId });
    const d = (await ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout: 15000 })).event;
    assert.deepEqual([...d.changedFiles].sort(), [rel(twin, 'bar.js'), rel(twin, 'files', 'note.txt'), rel(twin, 'mine.js')]);
    assert.equal(read(path.join(h, 'sites', twin, 'files', 'note.txt')), 'note', 'its twin\'s files/ too');
    for (const f of [[site, 'desk.js'], ['all-sites', 'everywhere.js'], ['fresh.org', 'a.js']]) assert.ok(!fs.existsSync(path.join(h, 'sites', ...f)), `${f.join('/')} never reached the mods folder`);
    if (!desktopFolder) assert.ok(!fs.existsSync(path.join(h, 'sites', site)), 'no desktop folder made');
  });
}

// ---- the phone view's group switches (Style, Boxed, Free mods): the phone twin's own

test('groups: the phone view\'s switch (phone~x.com) switches the site\'s phone mods only, the site\'s only its other mods', async () => {
  const lib = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'lib.js')).href);
  let g = lib.switchGroup({}, 'phone~x.com', 'page', false);
  assert.deepEqual(g, { 'phone~x.com': ['page'] });
  assert.equal(lib.groupOffOn(g, 'page', 'phone~x.com'), true);
  assert.equal(lib.groupOffOn(g, 'page', 'phone~api.x.com'), true);
  assert.equal(lib.groupOffOn(g, 'page', 'x.com'), false, 'the desktop panel\'s switch stays on');
  assert.deepEqual(lib.offSitesFor({ id: 'phone~x.com/a' }, {}, g), ['x.com'], 'a phone mod: off on its site\'s pages');
  assert.deepEqual(lib.offSitesFor({ id: 'x.com/a' }, {}, g), [], 'a desktop mod: still on');
  g = lib.switchGroup(g, 'www.x.com', 'rules', false);
  assert.deepEqual(lib.offSitesFor({ id: 'x.com/a', rules: true }, {}, g), ['x.com']);
  assert.deepEqual(lib.offSitesFor({ id: 'phone~x.com/a', rules: true }, {}, g), [], 'the desktop switch: not the phone view\'s mods');
  assert.equal(lib.groupOffOn(g, 'rules', 'phone~x.com'), false);
  // an all-sites mod is a desktop one: its group off on x.com from the desktop panel
  assert.deepEqual(lib.offSitesFor({ id: 'all-sites/a', rules: true }, {}, g), ['x.com']);
  // what storage may hold: cleaned up as before, a twin's entry kept
  assert.deepEqual(lib.normalizeGroupsOff({ 'phone~www.X.com': ['page', 'nope'], 'phone~': ['page'], 'phone~a b': ['page'], 'y.com': ['rules'] }), { 'phone~x.com': ['page'], 'y.com': ['rules'] });
  assert.throws(() => lib.switchGroup({}, 'phone~', 'page', false), /isn't a site/);
  // registered as the site's excludes, never as a "phone~" host
  const reg = lib.withOffSites({ id: 'phone~x.com/a', matches: ['*://x.com/*'] }, lib.offSitesFor({ id: 'phone~x.com/a' }, {}, { 'phone~x.com': ['page'] }));
  assert.ok(reg.excludes.length && reg.excludes.every((p) => !p.includes('phone~')), JSON.stringify(reg.excludes));
});
