'use strict';
// Tests for updates to the mods WebMods ships (helper/lib/preinstalled.js): unchanged copies replaced,
// edited ones offered the new version, the user's choices, the history of shipped versions, and how it
// reaches the helper's mods messages and the CLI. Everything in temp folders.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FakeExtension, runCli, tempDir, waitFor, REPO } = require('./fake-extension');
const S = require('../helper/lib/preinstalled');
const { listTrash } = require('../helper/lib/trash');
const { runLimits } = require('../helper/lib/runs');
const { shippedHistory } = require('../scripts/shipped-history');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const LIST = [{ id: 'x.com/plain-x', on: true }, { id: 'x.com/punk-fonts', on: false }];
const mod = (version, body = 'one') => `// ==WebMod==\n// @name Plain\n// @source webmods\n// @version ${version}\n// ==/WebMod==\n// ${body}\n`;

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

// A workspace and an examples folder (with its shipped-history.json) to update it from.
function world({ history = {} } = {}) {
  const root = tempDir();
  const home = path.join(root, 'ws');
  const examples = path.join(root, 'examples', 'sites');
  fs.mkdirSync(path.join(examples, 'x.com'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'examples', 'shipped-history.json'), JSON.stringify(history));
  const ws = { home, modsDir: path.join(home, 'sites'), screenshots: path.join(home, 'screenshots') };
  return {
    root, home, examples, ws,
    ship(id, code) { fs.writeFileSync(path.join(examples, `${id}.js`), code); },
    mine(id) { try { return fs.readFileSync(path.join(ws.modsDir, `${id}.js`), 'utf8'); } catch { return null; } },
    edit(id, code) { fs.writeFileSync(path.join(ws.modsDir, `${id}.js`), code); },
    setup() {
      S.preinstallMods(home, ws.modsDir, examples, LIST, []);
      return S.updateShippedMods(home, ws.modsDir, examples, LIST);
    },
    rec(id) { return S.loadPreinstalled(home).shipped[id]; },
  };
}

test('first setup records what it shipped and keeps a copy as the merge base', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.ship('x.com/punk-fonts', '// not marked as shipped\n');
  const r = w.setup();
  assert.deepStrictEqual(r, { updated: [], waiting: [] });
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(1)), version: '1' });
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(1));
  // Only mods marked @source webmods are managed.
  assert.strictEqual(w.rec('x.com/punk-fonts'), undefined);
  assert.ok(fs.existsSync(path.join(w.ws.modsDir, 'x.com', 'punk-fonts.js')));
});

test('unchanged copies get the new version silently; switches carry over (same id, startOff untouched)', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.ship('x.com/punk-fonts', mod(1, 'punk'));
  w.setup();
  const before = S.loadPreinstalled(w.home);
  w.ship('x.com/plain-x', mod(2, 'two'));
  const r = w.setup();
  assert.deepStrictEqual(r.updated, [{ id: 'x.com/plain-x', version: '2', from: '1' }]);
  assert.strictEqual(w.mine('x.com/plain-x'), mod(2, 'two'));
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(2, 'two')), version: '2' });
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(2, 'two'));
  const after = S.loadPreinstalled(w.home);
  assert.deepStrictEqual([after.offered, after.startOff], [before.offered, before.startOff]);
  // No temp files left where the scanner looks.
  assert.deepStrictEqual(fs.readdirSync(path.join(w.ws.modsDir, 'x.com')).sort(), ['plain-x.js', 'punk-fonts.js']);
  // Again with nothing new: nothing happens.
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
});

test('edited copies are never overwritten: the new version waits, kept beside the base', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2, 'two'));
  const r = w.setup();
  assert.deepStrictEqual(r, { updated: [], waiting: [{ id: 'x.com/plain-x', version: '2' }] });
  assert.strictEqual(w.mine('x.com/plain-x'), mod(1, 'mine'));
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(1)), version: '1', pending: { hash: sha1(mod(2, 'two')), version: '2' } });
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(1));
  assert.strictEqual(fs.readFileSync(S.newFile(w.home, 'x.com/plain-x'), 'utf8'), mod(2, 'two'));
  // Still waiting on the next setup; the user making it identical settles it.
  assert.deepStrictEqual(w.setup().waiting, [{ id: 'x.com/plain-x', version: '2' }]);
  w.edit('x.com/plain-x', mod(2, 'two'));
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(2, 'two')), version: '2' });
  assert.ok(!fs.existsSync(S.newFile(w.home, 'x.com/plain-x')));
});

test('a deleted shipped mod stays deleted', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  fs.unlinkSync(path.join(w.ws.modsDir, 'x.com', 'plain-x.js'));
  w.ship('x.com/plain-x', mod(2));
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  assert.strictEqual(w.mine('x.com/plain-x'), null);
});

test('workspaces from before the record: copies matching any shipped version are updated, others wait', () => {
  const old = '// ==WebMod==\n// @name Plain\n// ==/WebMod==\n// old, unlabelled\n';
  const w = world({ history: { 'x.com/plain-x': [sha1('// older still\n'), sha1(old)] } });
  // What setup used to leave: offered, copied, no record.
  fs.mkdirSync(path.join(w.ws.modsDir, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(w.ws.modsDir, 'x.com', 'plain-x.js'), old);
  fs.writeFileSync(path.join(w.ws.modsDir, 'x.com', 'punk-fonts.js'), '// punk, changed by the user\n');
  fs.writeFileSync(path.join(w.home, 'preinstalled.json'), JSON.stringify({ offered: ['x.com/plain-x', 'x.com/punk-fonts'], startOff: ['x.com/punk-fonts'], sitesOn: ['x.com'] }));
  w.ship('x.com/plain-x', mod(1));
  w.ship('x.com/punk-fonts', mod(1, 'punk'));
  const r = w.setup();
  assert.deepStrictEqual(r.updated, [{ id: 'x.com/plain-x', version: '1', from: null }]);
  assert.strictEqual(w.mine('x.com/plain-x'), mod(1));
  // Edited (matches no shipped version): left alone, offered, with no known base.
  assert.deepStrictEqual(r.waiting, [{ id: 'x.com/punk-fonts', version: '1' }]);
  assert.strictEqual(w.mine('x.com/punk-fonts'), '// punk, changed by the user\n');
  assert.deepStrictEqual(w.rec('x.com/punk-fonts'), { hash: null, version: null, pending: { hash: sha1(mod(1, 'punk')), version: '1' } });
  assert.ok(!fs.existsSync(S.baseFile(w.home, 'x.com/punk-fonts')));
  assert.match(S.mergeRequest(w.ws, 'x.com/punk-fonts').prompt, /isn't available/);
  // The rest of preinstalled.json is kept.
  assert.deepStrictEqual(S.loadPreinstalled(w.home).startOff, ['x.com/punk-fonts']);
});

test('the user\'s own file under a shipped name is never managed', () => {
  const w = world();
  fs.mkdirSync(path.join(w.ws.modsDir, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(w.ws.modsDir, 'x.com', 'plain-x.js'), '// mine from the start\n');
  w.ship('x.com/plain-x', mod(1));
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { own: true });
  w.ship('x.com/plain-x', mod(2));
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  assert.strictEqual(w.mine('x.com/plain-x'), '// mine from the start\n');
});

test('pendingUpdates: what the panel and the CLI show', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2));
  w.setup();
  const asMod = (code) => ({ id: 'x.com/plain-x', code });
  assert.deepStrictEqual(S.pendingUpdates(w.home, [asMod(mod(1, 'mine'))]), { 'x.com/plain-x': { version: '2', from: '1', modified: true } });
  // Back to what was shipped: nothing of the user's would be lost.
  assert.deepStrictEqual(S.pendingUpdates(w.home, [asMod(mod(1))]), { 'x.com/plain-x': { version: '2', from: '1', modified: false } });
  assert.deepStrictEqual(S.pendingUpdates(w.home, [asMod(mod(2))]), {});
});

test('use the new version: the user\'s copy goes to the trash; restore brings it back and offers the update again', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2));
  w.setup();
  const r = S.useNewVersion(w.ws, 'x.com/plain-x');
  assert.strictEqual(r.version, '2');
  assert.strictEqual(w.mine('x.com/plain-x'), mod(2));
  assert.strictEqual(fs.readFileSync(r.trashed, 'utf8'), mod(1, 'mine'));
  assert.deepStrictEqual(listTrash(w.ws).map((t) => t.id), ['x.com/plain-x']);
  assert.strictEqual(w.rec('x.com/plain-x').hash, sha1(mod(2)));
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(2));
  assert.ok(!fs.existsSync(S.newFile(w.home, 'x.com/plain-x')));
  assert.throws(() => S.useNewVersion(w.ws, 'x.com/plain-x'), /no new WebMods version/);
  // A setup in between doesn't spoil the undo.
  w.setup();

  // Undo (the panel's, or `webmods restore`).
  S.restoreMod(w.ws, 'x.com/plain-x');
  assert.strictEqual(w.mine('x.com/plain-x'), mod(1, 'mine'));
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(1)), version: '1', pending: { hash: sha1(mod(2)), version: '2' } });
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(1));
  assert.strictEqual(fs.readFileSync(S.newFile(w.home, 'x.com/plain-x'), 'utf8'), mod(2));
  assert.deepStrictEqual(fs.readdirSync(path.join(w.ws.modsDir, 'x.com')), ['plain-x.js'], 'nothing left aside');

  // Once the new version is edited, restore is the plain one again (refuses to overwrite).
  S.useNewVersion(w.ws, 'x.com/plain-x');
  w.edit('x.com/plain-x', mod(2, 'edited after'));
  assert.throws(() => S.restoreMod(w.ws, 'x.com/plain-x'), /exists again/);
});

test('keep mine: that version isn\'t offered again; a later one is', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2));
  w.setup();
  assert.deepStrictEqual(S.keepMine(w.ws, 'x.com/plain-x'), { id: 'x.com/plain-x', version: '2' });
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(1)), version: '1', declined: sha1(mod(2)) });
  assert.ok(!fs.existsSync(S.newFile(w.home, 'x.com/plain-x')));
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  assert.deepStrictEqual(S.pendingUpdates(w.home, [{ id: 'x.com/plain-x', code: mod(1, 'mine') }]), {});
  w.ship('x.com/plain-x', mod(3));
  assert.deepStrictEqual(w.setup().waiting, [{ id: 'x.com/plain-x', version: '3' }]);
  assert.strictEqual(w.mine('x.com/plain-x'), mod(1, 'mine'));
  assert.strictEqual(w.rec('x.com/plain-x').pending.version, '3');
});

test('merge: the prompt points at the three files; resolving makes the new version the base', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2));
  w.setup();
  const m = S.mergeRequest(w.ws, 'x.com/plain-x');
  assert.strictEqual(m.hash, sha1(mod(2)));
  assert.match(m.prompt, /user's copy \(edit this file, and only this one\): sites\/x\.com\/plain-x\.js/);
  assert.match(m.prompt, /new version from WebMods \(read only\): \.shipped\/x\.com\/plain-x\.new\.js/);
  assert.match(m.prompt, /shipped before \(version 1\).*: \.shipped\/x\.com\/plain-x\.js/);
  assert.strictEqual(S.resolveMerge(w.home, 'x.com/plain-x', 'some other version'), false);
  w.edit('x.com/plain-x', mod(2, 'merged'));
  assert.strictEqual(S.resolveMerge(w.home, 'x.com/plain-x', m.hash), true);
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(2)), version: '2' });
  assert.strictEqual(fs.readFileSync(S.baseFile(w.home, 'x.com/plain-x'), 'utf8'), mod(2));
  // Merged copies are edited copies: the next version waits for the user again.
  assert.deepStrictEqual(w.setup(), { updated: [], waiting: [] });
  w.ship('x.com/plain-x', mod(3));
  assert.deepStrictEqual(w.setup().waiting, [{ id: 'x.com/plain-x', version: '3' }]);
});

test('runs can read .shipped (to merge) but not write it', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  const real = (p) => fs.realpathSync(p);
  const shipped = real(path.join(w.home, S.SHIPPED_DIR));
  fs.mkdirSync(w.ws.screenshots, { recursive: true });
  const box = path.join(w.root, 'box');
  fs.mkdirSync(box);
  const l = runLimits(w.ws, { scope: 'x.com', box, screenshots: w.ws.screenshots });
  const under = (p, dirs) => dirs.some((d) => p === d || p.startsWith(d + path.sep));
  assert.ok(under(shipped, l.readable));
  assert.ok(!under(shipped, l.denied));
  assert.ok(!under(shipped, l.writable));
  assert.ok(require('../helper/lib/agents/claude').runSettings({ workspace: real(w.home) }).sandbox.filesystem.denyWrite.includes(shipped));
});

test('shipped-history.json: every version of each example from git, the current one included', { skip: !fs.existsSync(path.join(REPO, '.git')) && 'not a git checkout' }, () => {
  const checkedIn = JSON.parse(fs.readFileSync(path.join(REPO, 'examples', 'shipped-history.json'), 'utf8'));
  const fresh = shippedHistory(REPO);
  for (const { id } of S.PREINSTALLED) {
    assert.ok(Array.isArray(checkedIn[id]) && checkedIn[id].length, id);
    // Only ever grows: nothing in the checked-in list that git doesn't know.
    for (const h of checkedIn[id]) assert.ok(fresh[id].includes(h), `${id} ${h}`);
  }
});

// ------------------------------------------------------------------ setup, helper and CLI

test('setup says what it updated and what waits; the helper and the CLI show the waiting update', async () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.ship('x.com/punk-fonts', mod(1, 'punk'));
  const env = { WEBMODS_EXAMPLES_DIR: w.examples };
  const args = ['setup', '--home', w.home, '--native-dir', path.join(w.root, 'native'), '--no-link', '--link'];
  let r = await runCli(args, { home: w.home, env });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  w.ship('x.com/plain-x', mod(2));
  w.ship('x.com/punk-fonts', mod(2, 'punk'));
  w.edit('x.com/punk-fonts', mod(1, 'my punk'));
  r = await runCli(args, { home: w.home, env });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /updated to the new version: x\.com\/plain-x \(version 2\)/);
  assert.match(r.stdout, /new version waiting, not installed because you changed these: x\.com\/punk-fonts \(version 2\)/);

  // webmods mods / mod-update, without the browser.
  r = await runCli(['mods'], { home: w.home });
  assert.match(r.stdout, /x\.com\/punk-fonts[\s\S]*update available \(you've changed it\): version 2: webmods mod-update x\.com\/punk-fonts/);
  assert.match(r.stdout, /from WebMods, version 2/);
  r = await runCli(['mods', '--json'], { home: w.home });
  const listed = JSON.parse(r.stdout).mods;
  assert.deepStrictEqual(listed.find((m) => m.id === 'x.com/punk-fonts').update, { version: '2', from: '1', modified: true });
  assert.strictEqual(listed.find((m) => m.id === 'x.com/plain-x').update, undefined);
  r = await runCli(['mod-update', 'x.com/punk-fonts'], { home: w.home });
  assert.match(r.stdout, /the new version: +.*\.shipped\/x\.com\/punk-fonts\.new\.js/);

  // The helper's mods message carries it, and drops it once the user chose.
  const ext = new FakeExtension({ home: w.home });
  cleanups.push(() => ext.close());
  const mods = await ext.nextMods((ms) => ms.length === 2);
  const punk = mods.find((m) => m.id === 'x.com/punk-fonts');
  assert.deepStrictEqual(punk.update, { version: '2', from: '1', modified: true });
  assert.deepStrictEqual([punk.source, punk.version], ['webmods', '1']);
  assert.strictEqual(mods.find((m) => m.id === 'x.com/plain-x').update, undefined);
  await ext.waitForSocket();
  r = await runCli(['status'], { home: w.home });
  assert.match(r.stdout, /x\.com\/punk-fonts .*update available \(you've changed it\): version 2/);

  // Inside a side-panel run the choice isn't the agent's.
  r = await runCli(['mod-update', 'x.com/punk-fonts', '--keep'], { home: w.home, env: { WEBMODS_RUN_TOKEN: 'x' } });
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /not available inside a side-panel agent run/);

  const since = ext.messages.length;
  const id = 'u1';
  ext.send({ type: 'request', id, cmd: 'mod.update', args: { id: 'x.com/punk-fonts', choice: 'mine' } });
  const resp = await ext.next((m) => m.type === 'response' && m.id === id);
  assert.deepStrictEqual(resp.result, { id: 'x.com/punk-fonts', choice: 'mine', version: '2' });
  await ext.nextMods((ms) => ms.some((m) => m.id === 'x.com/punk-fonts' && !m.update), { since });

  // A setup elsewhere (another browser's update) is noticed without any mod file changing.
  w.ship('x.com/punk-fonts', mod(3, 'punk'));
  r = await runCli(args, { home: w.home, env });
  await ext.nextMods((ms) => ms.some((m) => m.id === 'x.com/punk-fonts' && m.update && m.update.version === '3'), { since, timeout: 8000 });

  // Use the new version through the CLI; restore puts the user's copy back.
  r = await runCli(['mod-update', 'x.com/punk-fonts', '--use-new'], { home: w.home });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /is now version 3; your copy is in the trash/);
  assert.strictEqual(w.mine('x.com/punk-fonts'), mod(3, 'punk'));
  r = await runCli(['restore', 'x.com/punk-fonts'], { home: w.home });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(w.mine('x.com/punk-fonts'), mod(1, 'my punk'));
  await waitFor(() => (ext.lastMods() || []).some((m) => m.id === 'x.com/punk-fonts' && m.update && m.update.version === '3'), { message: 'the update offered again' });
});

test('the repo\'s own examples: a legacy workspace with unchanged copies gets them updated by setup', async () => {
  // As 0.1.1 left a workspace: every preinstalled mod copied as it was then, no record.
  const home = tempDir();
  const history = S.loadHistory(path.join(REPO, 'examples', 'sites'));
  const ids = S.PREINSTALLED.map((p) => p.id);
  fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify({ offered: ids, startOff: [], sitesOn: S.SITES_ON }));
  const legacy = '// a version of plain-x WebMods once shipped\n';
  history['x.com/plain-x'].push(sha1(legacy));
  // Point setup at a copy of the examples whose history includes that version.
  const root = tempDir();
  fs.cpSync(path.join(REPO, 'examples'), path.join(root, 'examples'), { recursive: true });
  fs.writeFileSync(path.join(root, 'examples', 'shipped-history.json'), JSON.stringify(history));
  fs.mkdirSync(path.join(home, 'sites', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sites', 'x.com', 'plain-x.js'), legacy);
  const r = await runCli(['setup', '--native-dir', path.join(root, 'native'), '--no-link', '--link'], { home, env: { WEBMODS_EXAMPLES_DIR: path.join(root, 'examples', 'sites') } });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /updated to the new version: x\.com\/plain-x \(version \d+\)/);
  assert.strictEqual(fs.readFileSync(path.join(home, 'sites', 'x.com', 'plain-x.js'), 'utf8'), fs.readFileSync(path.join(REPO, 'examples', 'sites', 'x.com', 'plain-x.js'), 'utf8'));
});
