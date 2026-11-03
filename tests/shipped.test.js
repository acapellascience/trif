'use strict';
// Tests for updates to the mods TRIF ships (helper/lib/preinstalled.js): unchanged copies replaced,
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
  assert.throws(() => S.useNewVersion(w.ws, 'x.com/plain-x'), /no new TRIF version/);
  // A setup in between doesn't spoil the undo.
  w.setup();

  // Undo (the panel's, or `trif restore`).
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
  assert.match(m.prompt, /user's copy \(the only file to edit, later\): sites\/x\.com\/plain-x\.js/);
  assert.match(m.prompt, /new version from TRIF \(read only\): \.shipped\/x\.com\/plain-x\.new\.js/);
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

test('mergeSettled: waiting until the user\'s copy changed and has the new @version; then merged', () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.setup();
  w.edit('x.com/plain-x', mod(1, 'mine'));
  w.ship('x.com/plain-x', mod(2));
  w.setup();
  const m = S.mergeRequest(w.ws, 'x.com/plain-x');
  assert.deepStrictEqual([m.version, m.before], ['2', sha1(mod(1, 'mine'))]);
  assert.strictEqual(S.mergeSettled(w.ws, 'x.com/plain-x', m), 'waiting', 'the proposal changed nothing');
  w.edit('x.com/plain-x', mod(1, 'mine, tweaked'));
  assert.strictEqual(S.mergeSettled(w.ws, 'x.com/plain-x', m), 'waiting', 'changed, but not to the new version');
  w.edit('x.com/plain-x', mod(2, 'mine and two'));
  assert.strictEqual(S.mergeSettled(w.ws, 'x.com/plain-x', m), 'merged');
  assert.deepStrictEqual(w.rec('x.com/plain-x'), { hash: sha1(mod(2)), version: '2' });
  assert.strictEqual(S.mergeSettled(w.ws, 'x.com/plain-x', m), 'gone', 'nothing left to settle');
  // Kept theirs meanwhile: gone too.
  w.ship('x.com/plain-x', mod(3));
  w.setup();
  const m3 = S.mergeRequest(w.ws, 'x.com/plain-x');
  S.keepMine(w.ws, 'x.com/plain-x');
  w.edit('x.com/plain-x', mod(3, 'x'));
  assert.strictEqual(S.mergeSettled(w.ws, 'x.com/plain-x', m3), 'gone');
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

test('RETIRED: each retired mod is gone from the examples, and the mod it went into is shipped at that version or later', () => {
  const history = S.loadHistory(path.join(REPO, 'examples', 'sites'));
  const { parseHeader } = require('../helper/lib/mods');
  const ids = S.PREINSTALLED.map((p) => p.id);
  for (const { id, into, since } of S.RETIRED) {
    assert.ok(!ids.includes(id), `${id} isn't offered any more`);
    assert.ok(!fs.existsSync(path.join(REPO, 'examples', 'sites', `${id}.js`)), `${id} isn't shipped any more`);
    assert.ok(Array.isArray(history[id]) && history[id].length, `${id}: its shipped versions are still known (unchanged copies are recognised by them)`);
    assert.ok(ids.includes(into), `${into} is offered`);
    const v = parseHeader(fs.readFileSync(path.join(REPO, 'examples', 'sites', `${into}.js`), 'utf8')).version;
    assert.ok(Number(v) >= Number(since), `${into} is version ${v}, at least ${since}`);
  }
  assert.deepStrictEqual(S.RETIRED.map((r) => [r.id, r.into]), [
    ['www.google.com/hide-ai-mode', 'www.google.com/hide-ai-in-results'],
    ['www.google.com/hide-sponsored', 'www.google.com/hide-extra-sections'],
  ]);
});

// ------------------------------------------------------------------ setup, helper and CLI

test('setup says what it updated and what waits; the helper and the CLI show the waiting update', async () => {
  const w = world();
  w.ship('x.com/plain-x', mod(1));
  w.ship('x.com/punk-fonts', mod(1, 'punk'));
  const env = { TRIF_EXAMPLES_DIR: w.examples };
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

  // trif mods / mod-update, without the browser.
  r = await runCli(['mods'], { home: w.home });
  assert.match(r.stdout, /x\.com\/punk-fonts[\s\S]*update available \(you've changed it\): version 2: trif mod-update x\.com\/punk-fonts/);
  assert.match(r.stdout, /from TRIF, version 2/);
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
  r = await runCli(['mod-update', 'x.com/punk-fonts', '--keep'], { home: w.home, env: { TRIF_RUN_TOKEN: 'x' } });
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
  const r = await runCli(['setup', '--native-dir', path.join(root, 'native'), '--no-link', '--link'], { home, env: { TRIF_EXAMPLES_DIR: path.join(root, 'examples', 'sites') } });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /updated to the new version: x\.com\/plain-x \(version \d+\)/);
  assert.strictEqual(fs.readFileSync(path.join(home, 'sites', 'x.com', 'plain-x.js'), 'utf8'), fs.readFileSync(path.join(REPO, 'examples', 'sites', 'x.com', 'plain-x.js'), 'utf8'));
});

// ------------------------------------------------------------------ retired mods (folded into another)

// Two shipped mods, `old` folded into `into` (at its version 2), as RETIRED says for the real ones.
const INTO = 'www.google.com/hide-ai-in-results';
const OLD = 'www.google.com/hide-ai-mode';
const RLIST = [{ id: INTO, on: true }, { id: OLD, on: true }];
const RETIRE = [{ id: OLD, into: INTO, since: '2' }];
const gmod = (name, version, body = name) => `// ==WebMod==\n// @name ${name}\n// @source webmods\n// @version ${version}\n// ==/WebMod==\n// ${body}\n`;
const RES1 = gmod('Hide AI in Results', 1);
const MODE1 = gmod('Hide AI Mode', 1);
const BANISH2 = gmod('AI Banisher', 2);

// A workspace set up while both were shipped (version 1); `release()` ships the merged one and
// retires the other (its example goes, as in the repo; its history stays).
function retireWorld() {
  const w = world();
  fs.mkdirSync(path.join(w.examples, 'www.google.com'), { recursive: true });
  const history = {};
  const ship = (id, code) => { w.ship(id, code); (history[id] = history[id] || []).push(sha1(code)); writeHistory(); };
  const writeHistory = () => fs.writeFileSync(path.join(w.root, 'examples', 'shipped-history.json'), JSON.stringify(history));
  ship(INTO, RES1);
  ship(OLD, MODE1);
  let list = RLIST;
  let retire = [];
  return {
    ...w,
    ship,
    release() {
      ship(INTO, BANISH2);
      fs.unlinkSync(path.join(w.examples, `${OLD}.js`));
      list = [{ id: INTO, on: true }];
      retire = RETIRE;
    },
    setup() {
      const pre = S.preinstallMods(w.home, w.ws.modsDir, w.examples, list, []);
      const up = S.updateShippedMods(w.home, w.ws.modsDir, w.examples, list);
      return { pre, ...up, ...S.retireShippedMods(w.ws, w.examples, retire) };
    },
    trashed() { return listTrash(w.ws).map((t) => t.id); },
  };
}

test('retired: an unchanged copy goes to the trash once the mod it went into has the new version', () => {
  const w = retireWorld();
  w.setup();
  const before = S.loadPreinstalled(w.home);
  w.release();
  const r = w.setup();
  assert.deepStrictEqual(r.updated, [{ id: INTO, version: '2', from: '1' }]);
  assert.deepStrictEqual(r.kept, []);
  assert.strictEqual(r.removed.length, 1);
  assert.deepStrictEqual({ ...r.removed[0], trashed: path.basename(r.removed[0].trashed) },
    { id: OLD, into: INTO, was: 'Hide AI Mode', name: 'AI Banisher', trashed: w.rec(OLD).retired.trashed });
  assert.strictEqual(w.mine(INTO), BANISH2);
  assert.strictEqual(w.mine(OLD), null);
  assert.deepStrictEqual(w.trashed(), [OLD]);
  assert.strictEqual(fs.readFileSync(r.removed[0].trashed, 'utf8'), MODE1, 'in the trash as it was');
  assert.deepStrictEqual(w.rec(OLD), { retired: { into: INTO, trashed: path.basename(r.removed[0].trashed) } });
  assert.ok(!fs.existsSync(S.baseFile(w.home, OLD)), 'its merge base is gone');
  // offered and startOff as they were: the retired id is never offered again, the merged one keeps its id.
  const after = S.loadPreinstalled(w.home);
  assert.deepStrictEqual([after.offered, after.startOff], [before.offered, before.startOff]);
  // The browsers are told, so they can carry the switch over.
  assert.deepStrictEqual(S.absorbedIds(w.home), { [INTO]: [OLD] });
  // Nothing more on the next setup; it doesn't come back.
  assert.deepStrictEqual(w.setup(), { pre: { added: [], on: [], sites: [] }, updated: [], waiting: [], removed: [], kept: [] });
  assert.strictEqual(w.mine(OLD), null);
});

test('retired: an edited copy is never touched, and setup says so once', () => {
  const w = retireWorld();
  w.setup();
  w.edit(OLD, gmod('Hide AI Mode', 1, 'mine'));
  w.release();
  const r = w.setup();
  assert.deepStrictEqual(r.removed, []);
  assert.deepStrictEqual(r.kept, [{ id: OLD, into: INTO, was: 'Hide AI Mode', name: 'AI Banisher' }]);
  assert.strictEqual(w.mine(OLD), gmod('Hide AI Mode', 1, 'mine'));
  assert.deepStrictEqual(w.trashed(), []);
  assert.deepStrictEqual(w.rec(OLD), { retired: { into: INTO, kept: true } });
  assert.deepStrictEqual(S.absorbedIds(w.home), {}, 'both still there: no switch to carry over');
  assert.deepStrictEqual(w.setup().kept, [], 'said once');
  assert.strictEqual(w.mine(OLD), gmod('Hide AI Mode', 1, 'mine'));
});

test('retired: a new version that was waiting on the old mod isn\'t offered any more', () => {
  const w = retireWorld();
  w.setup();
  w.edit(OLD, gmod('Hide AI Mode', 1, 'mine'));
  w.ship(OLD, gmod('Hide AI Mode', 1, 'a fix'));
  w.setup();
  assert.ok(w.rec(OLD).pending);
  assert.ok(fs.existsSync(S.newFile(w.home, OLD)));
  w.release();
  w.setup();
  assert.deepStrictEqual(w.rec(OLD), { retired: { into: INTO, kept: true } });
  assert.ok(!fs.existsSync(S.newFile(w.home, OLD)));
  assert.deepStrictEqual(S.pendingUpdates(w.home, [{ id: OLD, code: w.mine(OLD) }]), {});
  assert.throws(() => S.useNewVersion(w.ws, OLD), /no new TRIF version/);
});

test('retired: a copy matching an older shipped version counts as unchanged; one deleted before is just recorded', () => {
  const w = retireWorld();
  w.setup();
  // An older version, from before the record (as in shipped-history.json).
  const older = '// hide-ai-mode as an older TRIF shipped it\n';
  w.ship(OLD, older);
  w.ship(OLD, MODE1);
  w.edit(OLD, older);
  w.release();
  assert.deepStrictEqual(w.setup().removed.map((m) => m.id), [OLD]);

  const w2 = retireWorld();
  w2.setup();
  fs.unlinkSync(path.join(w2.ws.modsDir, `${OLD}.js`));
  w2.release();
  const r = w2.setup();
  assert.deepStrictEqual([r.removed, r.kept], [[], []]);
  assert.deepStrictEqual(w2.rec(OLD), { retired: { into: INTO } });
  assert.deepStrictEqual(S.absorbedIds(w2.home), {});
});

test('retired: while the mod it went into doesn\'t do its job yet (edited, deleted, the user\'s own), the old copy stays', () => {
  // Edited, the new version waiting: the old one stays until the user takes it.
  const w = retireWorld();
  w.setup();
  w.edit(INTO, gmod('Hide AI in Results', 1, 'mine'));
  w.release();
  let r = w.setup();
  assert.deepStrictEqual(r.waiting, [{ id: INTO, version: '2' }]);
  assert.deepStrictEqual([r.removed, r.kept], [[], []]);
  assert.strictEqual(w.mine(OLD), MODE1);
  assert.strictEqual(w.rec(OLD).retired, undefined);
  // Keep mine: still the old one's job.
  S.keepMine(w.ws, INTO);
  assert.deepStrictEqual(w.setup().removed, []);
  assert.strictEqual(w.mine(OLD), MODE1);

  // Deleted by the user: the old copy keeps doing its part, and the merged one isn't offered again.
  const w2 = retireWorld();
  w2.setup();
  fs.unlinkSync(path.join(w2.ws.modsDir, `${INTO}.js`));
  w2.release();
  r = w2.setup();
  assert.deepStrictEqual([r.pre.added, r.removed], [[], []]);
  assert.strictEqual(w2.mine(INTO), null);
  assert.strictEqual(w2.mine(OLD), MODE1);

  // The user's own file under the merged one's name: not ours, so neither is its job.
  const w3 = retireWorld();
  fs.mkdirSync(path.join(w3.ws.modsDir, 'www.google.com'), { recursive: true });
  fs.writeFileSync(path.join(w3.ws.modsDir, `${INTO}.js`), '// mine from the start\n');
  w3.setup();
  w3.release();
  assert.deepStrictEqual(w3.setup().removed, []);
  assert.strictEqual(w3.mine(OLD), MODE1);
  // And the user's own file under the retired name is never touched either.
  const w4 = retireWorld();
  fs.mkdirSync(path.join(w4.ws.modsDir, 'www.google.com'), { recursive: true });
  fs.writeFileSync(path.join(w4.ws.modsDir, `${OLD}.js`), '// my own hide-ai-mode\n');
  w4.setup();
  w4.release();
  r = w4.setup();
  assert.deepStrictEqual([r.removed, r.kept], [[], []]);
  assert.strictEqual(w4.mine(OLD), '// my own hide-ai-mode\n');
  assert.deepStrictEqual(w4.rec(OLD), { own: true });
});

test('retired: taking the new version (use it, or a merge) retires the old copy then; Undo brings both back', () => {
  const w = retireWorld();
  w.setup();
  w.edit(INTO, gmod('Hide AI in Results', 1, 'mine'));
  w.release();
  w.setup();
  // Use the new version. It retires with the real RETIRED list (which has this pair) and the examples
  // TRIF_EXAMPLES_DIR names, as setup's tests do.
  assert.ok(S.RETIRED.some((x) => x.id === OLD && x.into === INTO), 'the test mirrors the real RETIRED entry');
  process.env.TRIF_EXAMPLES_DIR = w.examples;
  try {
    S.useNewVersion(w.ws, INTO);
  } finally { delete process.env.TRIF_EXAMPLES_DIR; }
  assert.strictEqual(w.mine(INTO), BANISH2);
  assert.strictEqual(w.mine(OLD), null);
  assert.deepStrictEqual(w.trashed().sort(), [INTO, OLD].sort());
  assert.ok(w.rec(OLD).retired.trashed);
  assert.deepStrictEqual(w.rec(INTO).replaced.retired, [{ id: OLD, rec: { hash: sha1(MODE1), version: '1' } }]);
  // Undo: the user's copy back, the update offered again, and the old mod back as it was.
  S.restoreMod(w.ws, INTO);
  assert.strictEqual(w.mine(INTO), gmod('Hide AI in Results', 1, 'mine'));
  assert.strictEqual(w.mine(OLD), MODE1);
  assert.deepStrictEqual(w.rec(OLD), { hash: sha1(MODE1), version: '1' });
  assert.strictEqual(w.rec(INTO).pending.version, '2');
  assert.deepStrictEqual(S.absorbedIds(w.home), {});
  assert.deepStrictEqual(w.trashed(), []);
  // And setup leaves it there again (the merged mod is waiting, not taken).
  assert.deepStrictEqual(w.setup().removed, []);

  // A merge settled the same way.
  process.env.TRIF_EXAMPLES_DIR = w.examples;
  try {
    const m = S.mergeRequest(w.ws, INTO);
    w.edit(INTO, gmod('AI Banisher', 2, 'mine and two'));
    assert.strictEqual(S.mergeSettled(w.ws, INTO, m), 'merged');
  } finally { delete process.env.TRIF_EXAMPLES_DIR; }
  assert.strictEqual(w.mine(OLD), null);
  assert.deepStrictEqual(S.absorbedIds(w.home), { [INTO]: [OLD] });
});

test('retired: the helper sends `absorbs` on the mod it went into; setup says what happened', async () => {
  const w = retireWorld();
  w.edit = (id, code) => { fs.mkdirSync(path.dirname(path.join(w.ws.modsDir, `${id}.js`)), { recursive: true }); fs.writeFileSync(path.join(w.ws.modsDir, `${id}.js`), code); };
  const env = { TRIF_EXAMPLES_DIR: w.examples };
  const args = ['setup', '--home', w.home, '--native-dir', path.join(w.root, 'native'), '--no-link', '--link'];
  // Set up with the real RETIRED list: hide-ai-mode into hide-ai-in-results, hide-sponsored into
  // hide-extra-sections (version 2 of each).
  const SPON = 'www.google.com/hide-sponsored';
  const EXTRA = 'www.google.com/hide-extra-sections';
  w.ship(SPON, gmod('Hide Sponsored Results', 1));
  w.ship(EXTRA, gmod('Results Only', 1));
  fs.writeFileSync(path.join(w.home, 'preinstalled.json'), JSON.stringify({ offered: [INTO, OLD, SPON, EXTRA], startOff: [], sitesOn: [] }));
  for (const id of [INTO, OLD, SPON, EXTRA]) w.edit(id, fs.readFileSync(path.join(w.examples, `${id}.js`)));
  let r = await runCli(args, { home: w.home, env });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  // The release: both merged mods at version 2, the retired examples gone; the user had edited hide-sponsored.
  w.release();
  w.ship(EXTRA, gmod('Just Results', 2));
  fs.unlinkSync(path.join(w.examples, `${SPON}.js`));
  w.edit(SPON, gmod('Hide Sponsored Results', 1, 'mine'));
  r = await runCli(args, { home: w.home, env });
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Hide AI Mode is now part of AI Banisher: the old copy is in the trash \(trif restore www\.google\.com\/hide-ai-mode brings it back\)/);
  assert.match(r.stdout, /Hide Sponsored Results \(www\.google\.com\/hide-sponsored\) is now part of Just Results\. You changed your copy, so it's left as it is: it\n +keeps running, without updates\. Delete it if Just Results does what you need\./);
  r = await runCli(args, { home: w.home, env });
  assert.doesNotMatch(r.stdout, /is now part of/, 'said once');

  const ext = new FakeExtension({ home: w.home });
  cleanups.push(() => ext.close());
  const mods = await ext.nextMods((ms) => ms.some((m) => m.id === INTO));
  assert.deepStrictEqual(mods.find((m) => m.id === INTO).absorbs, [OLD]);
  assert.strictEqual(mods.find((m) => m.id === EXTRA).absorbs, undefined, 'the edited one is still there');
  assert.ok(mods.some((m) => m.id === SPON));
  assert.ok(!mods.some((m) => m.id === OLD));
});
