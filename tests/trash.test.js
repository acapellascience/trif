'use strict';
// Tests for deleting mods (helper/lib/trash.js): the trash, restore, emptying old entries, and
// `webmods delete` / `webmods restore` without a helper. The helper's mod.delete / mod.restore (panel and
// agent runs, run scope) are in agents.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runCli, writeMod, tempDir } = require('./fake-extension');
const { deleteMod, restoreMod, listTrash, emptyTrash, TrashError } = require('../helper/lib/trash');

const MOD = (match) => `// ==WebMod==\n// @name Test\n${match ? `// @match ${match}\n` : ''}// ==/WebMod==\nconsole.log(1);\n`;
const wsFor = (home) => ({ home, modsDir: path.join(home, 'sites') });
const DAY = 24 * 60 * 60 * 1000;

test('deleteMod moves the file to the trash; restoreMod puts the newest copy back', () => {
  const home = tempDir();
  const ws = wsFor(home);
  const file = writeMod(home, 'x.com', 'quiet.js', MOD());
  const r = deleteMod(ws, 'x.com/quiet', { now: Date.UTC(2026, 9, 30, 13, 58, 2, 123) });
  assert.deepStrictEqual({ id: r.id, file: r.file }, { id: 'x.com/quiet', file });
  assert.equal(r.trashed, path.join(home, 'trash', 'x.com', 'quiet@20261030T135802123Z.js'));
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(r.trashed, 'utf8'), MOD());

  // Deleted again later: restore takes the newer copy.
  writeMod(home, 'x.com', 'quiet.js', MOD('*://x.com/*'));
  deleteMod(ws, 'x.com/quiet.js', { now: Date.UTC(2026, 9, 30, 14) });
  assert.deepStrictEqual(listTrash(ws).map((t) => [t.id, t.deletedAt]),
    [['x.com/quiet', Date.UTC(2026, 9, 30, 14)], ['x.com/quiet', Date.UTC(2026, 9, 30, 13, 58, 2, 123)]]);
  assert.deepStrictEqual(restoreMod(ws, 'x.com/quiet'), { id: 'x.com/quiet', file });
  assert.equal(fs.readFileSync(file, 'utf8'), MOD('*://x.com/*'));

  // A mod with that id exists again: restore refuses rather than overwrite it.
  assert.throws(() => restoreMod(ws, 'x.com/quiet'), (e) => e instanceof TrashError && /exists again/.test(e.message));
  assert.throws(() => restoreMod(ws, 'x.com/nope'), /isn't in the trash/);
});

test('deleteMod only touches mod files', () => {
  const home = tempDir();
  const ws = wsFor(home);
  writeMod(home, 'x.com', '_private.js', MOD());
  fs.writeFileSync(path.join(home, 'config.json'), '{}');
  for (const id of ['x.com/missing', '../config', 'x.com/../../config', 'x.com/_private', '_x/y', 'x.com', 'a/b/c', '']) {
    assert.throws(() => deleteMod(ws, id), TrashError, id);
  }
  assert.ok(fs.existsSync(path.join(home, 'sites', 'x.com', '_private.js')));
  assert.ok(fs.existsSync(path.join(home, 'config.json')));
});

test('a scope limits delete and restore to mods that stay inside it', () => {
  const home = tempDir();
  const ws = wsFor(home);
  writeMod(home, 'example.com', 'local.js', MOD());   // default @match: example.com and its subdomains
  writeMod(home, 'example.com', 'wide.js', MOD('*://*/*'));
  assert.throws(() => deleteMod(ws, 'example.com/wide', { scope: 'example.com' }), /can only delete mods that stay on example\.com/);
  assert.throws(() => deleteMod(ws, 'example.com/local', { scope: 'other.org' }), /can only delete/);
  deleteMod(ws, 'example.com/local', { scope: 'example.com' });
  deleteMod(ws, 'example.com/wide');
  assert.throws(() => restoreMod(ws, 'example.com/wide', { scope: 'example.com' }), /can only restore/);
  restoreMod(ws, 'example.com/local', { scope: 'example.com' });
  assert.ok(fs.existsSync(path.join(home, 'sites', 'example.com', 'local.js')));
});

test('emptyTrash removes entries older than 30 days; deleting empties it too', () => {
  const home = tempDir();
  const ws = wsFor(home);
  const now = Date.UTC(2026, 9, 30);
  writeMod(home, 'a.com', 'old.js', MOD());
  writeMod(home, 'a.com', 'recent.js', MOD());
  deleteMod(ws, 'a.com/old', { now: now - 31 * DAY });
  deleteMod(ws, 'a.com/recent', { now: now - 29 * DAY });
  fs.writeFileSync(path.join(home, 'trash', 'a.com', 'notes.txt'), 'not a trash entry');
  assert.equal(emptyTrash(ws, { now }), 1);
  assert.deepStrictEqual(listTrash(ws).map((t) => t.id), ['a.com/recent']);
  assert.ok(fs.existsSync(path.join(home, 'trash', 'a.com', 'notes.txt')));

  writeMod(home, 'a.com', 'other.js', MOD());
  deleteMod(ws, 'a.com/other', { now: now + 2 * DAY });   // recent is now 31 days old
  assert.deepStrictEqual(listTrash(ws).map((t) => t.id), ['a.com/other']);
});

test('webmods delete / restore work without a helper', async () => {
  const home = tempDir();
  const file = writeMod(home, 'x.com', 'quiet.js', MOD());
  let r = await runCli(['restore'], { home });
  assert.equal(r.stdout, 'the trash is empty\n');
  r = await runCli(['delete', 'x.com/quiet'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^deleted x\.com\/quiet: it's in the trash for 30 days \(webmods restore x\.com\/quiet brings it back\)/);
  assert.equal(fs.existsSync(file), false);
  r = await runCli(['restore', '--json'], { home });
  assert.deepStrictEqual(JSON.parse(r.stdout).trash.map((t) => t.id), ['x.com/quiet']);
  r = await runCli(['restore', 'x.com/quiet'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(file));
  r = await runCli(['delete', 'x.com/missing'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^webmods delete: there's no mod x\.com\/missing/);
});
