'use strict';
// Stable mod ids and renaming (docs/PHONE-SYNC.md 2a, D17; Tim 2026-11-18): helper/lib/modid.js held to the cases the
// iPhone's shared core is held to (tests/fixtures/mod-id-cases.json); the reader keeps the id (mods.js), one id to a
// folder; renames found by id (both findRenames); Rename in the code card (lib/rename.js): the file follows, what the
// helper keeps by the mod's id moves, nothing waits; an edit and an import give an id; export → import is the same mod.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tempDir } = require('./fake-extension');
const MI = require('../helper/lib/modid');
const { parseHeader, buildMod, scanMods, findRenames } = require('../helper/lib/mods');
const { renameMod, moveKeys } = require('../helper/lib/rename');
const held = require('../helper/lib/held');
const { saveEdit, fileHash } = require('../helper/lib/edit');
const { importMod } = require('../helper/lib/share');

const cases = require('./fixtures/mod-id-cases.json');
const U1 = '11111111-aaaa-4bbb-8ccc-000000000001';

test('modid.js: every case of the shared fixture', () => {
  for (const [v, ok] of cases.ids) assert.equal(MI.isId(v), ok, v);
  for (const [k, c] of Object.entries(cases.texts)) {
    assert.deepEqual(MI.readMeta(c.text), c.meta, k);
    assert.equal(MI.bodyText(c.text), c.body, k);
    assert.equal(MI.metaText(c.text), c.metaText, k);
    assert.deepEqual(MI.revs(c.text), c.revs, k);
    const sha = (x) => crypto.createHash('sha256').update(Buffer.from(x, 'utf8')).digest('hex');
    assert.deepEqual(c.revs, { body: sha(c.body), meta: sha(c.metaText) }, `${k}: the revs are the SHA-256 of the two texts`);
  }
  for (const w of cases.withMeta) assert.equal(MI.withMeta(cases.texts[w.text].text, w.set), w.out, `${w.text} ${JSON.stringify(w.set)}`);
  for (const [n, out] of cases.slugs) assert.equal(MI.slug(n), out, n);
  for (const [n, taken, own, out] of cases.files) assert.equal(MI.fileFor(n, taken, own), out, n);
  for (const [n, why] of cases.names) assert.equal(MI.checkName(n), why, n);
  assert.ok(MI.isId(MI.newId()) && MI.newId() !== MI.newId());
});

test('the reader keeps the id, apart from the hash; one id to a folder; renames found by id', async () => {
  const text = `// ==WebMod==\n// @name A\n// @id ${U1}\n// ==/WebMod==\nx();\n`;
  assert.equal(parseHeader(text).uid, U1);
  assert.match(parseHeader('// ==WebMod==\n// @id Bad Id\n// ==/WebMod==\n').warnings[0], /@id should be/);
  const m = buildMod({ site: 'a.com', file: 'a.js', code: text }).mod;
  assert.equal(m.uid, U1);
  const home = tempDir('wm-modid-');
  const sites = path.join(home, 'sites', 'a.com');
  fs.mkdirSync(sites, { recursive: true });
  fs.writeFileSync(path.join(sites, 'a.js'), text);
  fs.writeFileSync(path.join(sites, 'b.js'), text.replace('@name A', '@name B'));
  const { mods, warnings } = scanMods(path.join(home, 'sites'));
  assert.equal(mods.find((x) => x.id === 'a.com/a').uid, U1);
  assert.equal(mods.find((x) => x.id === 'a.com/b').uid, undefined, 'a copied file: the first by name keeps the id');
  assert.ok(warnings.some((w) => w.id === 'a.com/b' && /same @id/.test(w.warning)));
  // renamed (its @name changed too, so its code isn't the same): found by its id, in the same folder only
  const prev = [{ id: 'a.com/a', site: 'a.com', uid: U1, code: 'one' }, { id: 'a.com/c', site: 'a.com', code: 'same' }];
  const next = [{ id: 'a.com/quiet', site: 'a.com', uid: U1, code: 'two' }, { id: 'a.com/d', site: 'a.com', code: 'same' }];
  assert.deepEqual(findRenames(prev, next), [{ from: 'a.com/a', to: 'a.com/quiet' }, { from: 'a.com/c', to: 'a.com/d' }]);
  assert.deepEqual(findRenames(prev, [{ id: 'b.com/quiet', site: 'b.com', uid: U1, code: 'two' }]), [], 'another folder: another mod');
  // (a first rename gives the mod its id: the same code but for its @name and @id lines)
  const before = [{ id: 'a.com/x', site: 'a.com', code: '// ==WebMod==\n// @name X\n// ==/WebMod==\nbody();\n' }];
  const after = [{ id: 'a.com/y', site: 'a.com', uid: U1, code: `// ==WebMod==\n// @name Y\n// @id ${U1}\n// ==/WebMod==\nbody();\n` }];
  assert.deepEqual(findRenames(before, after), [{ from: 'a.com/x', to: 'a.com/y' }]);
  const lib = await import('../extension/lib.js');
  assert.deepEqual(lib.findRenames(before, after), [{ from: 'a.com/x', to: 'a.com/y' }]);
  assert.deepEqual(lib.findRenames(prev, next), [{ from: 'a.com/a', to: 'a.com/quiet' }, { from: 'a.com/c', to: 'a.com/d' }]);
  fs.rmSync(home, { recursive: true, force: true });
});

function workspace() {
  const home = tempDir('wm-rename-');
  const ws = { home, modsDir: path.join(home, 'sites'), private: `${home}-private` };
  fs.mkdirSync(path.join(ws.modsDir, 'example.com'), { recursive: true });
  return ws;
}
const FREE = (name, extra = '') => `// ==WebMod==\n// @name ${name}\n// @match https://example.com/*\n${extra}// ==/WebMod==\nfetch('https://example.com/api', { method: 'POST' });\n`;

test('Rename: the @name line, an id, the file following, what the helper keeps by its id moved; nothing waits', () => {
  const ws = workspace();
  const f = path.join(ws.modsDir, 'example.com', 'calmer-feed.js');
  fs.writeFileSync(f, FREE('Calmer feed'));
  // a free mod that sends, the user's (seen.json's first look), with an allowed power and a history entry
  held.updateHeld(ws, scanMods(ws.modsDir).mods, []);
  fs.writeFileSync(path.join(ws.home, 'allowed.json'), JSON.stringify({ 'example.com/calmer-feed': { powers: ['sends'], at: 1 } }));
  fs.mkdirSync(path.join(ws.home, 'history', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(ws.home, 'history', 'example.com', 'calmer-feed@20261118T120000000Z.js'), 'old');
  const r = renameMod(ws, { id: 'example.com/calmer-feed', name: 'Quiet feed' });
  assert.deepEqual([r.id, r.from, r.renamed], ['example.com/quiet-feed', 'example.com/calmer-feed', true]);
  assert.ok(!fs.existsSync(f));
  const text = fs.readFileSync(path.join(ws.modsDir, 'example.com', 'quiet-feed.js'), 'utf8');
  const meta = MI.readMeta(text);
  assert.equal(meta.name, 'Quiet feed');
  assert.ok(MI.isId(meta.uid), 'it got a stable id');
  assert.equal(MI.bodyText(text), MI.bodyText(FREE('Calmer feed')), 'nothing else in it changed');
  const json = (n) => JSON.parse(fs.readFileSync(path.join(ws.home, n), 'utf8'));
  assert.ok(json('allowed.json')['example.com/quiet-feed'] && !json('allowed.json')['example.com/calmer-feed']);
  assert.ok(json('seen.json')['example.com/quiet-feed']);
  assert.ok(fs.existsSync(path.join(ws.home, '.ran', 'example.com', 'quiet-feed.js')));
  assert.deepEqual(fs.readdirSync(path.join(ws.home, 'history', 'example.com')), ['quiet-feed@20261118T120000000Z.js']);
  const h = held.updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.equal(h['example.com/quiet-feed'], undefined, 'a rename never waits for an OK');
  // again: moveKeys is idempotent (the scan sees the rename too)
  assert.equal(moveKeys(ws, [{ from: 'example.com/calmer-feed', to: 'example.com/quiet-feed' }]), 0);
  // a name another mod's file has: -2; the same id kept; a name that can't be one
  fs.writeFileSync(path.join(ws.modsDir, 'example.com', 'other.js'), FREE('Other'));
  const r2 = renameMod(ws, { id: 'example.com/quiet-feed', name: 'Other' });
  assert.equal(r2.id, 'example.com/other-2');
  assert.equal(MI.readMeta(fs.readFileSync(path.join(ws.modsDir, 'example.com', 'other-2.js'), 'utf8')).uid, meta.uid);
  assert.throws(() => renameMod(ws, { id: 'example.com/other-2', name: '  ' }), /empty/);
  assert.throws(() => renameMod(ws, { id: 'example.com/other-2', name: 'a\nb' }), /one line/);
  assert.throws(() => renameMod(ws, { id: 'example.com/nope', name: 'X' }), /no mod/);
  // its capitals only: the same file, the name changed
  const r3 = renameMod(ws, { id: 'example.com/other-2', name: 'other 2' });
  assert.equal(r3.id, 'example.com/other-2');
  assert.equal(MI.readMeta(fs.readFileSync(path.join(ws.modsDir, 'example.com', 'other-2.js'), 'utf8')).name, 'other 2');
  fs.rmSync(ws.home, { recursive: true, force: true });
});

test('an edit saved in the code card gets an id; an import keeps one (the same mod), or gets one', () => {
  const ws = workspace();
  const f = path.join(ws.modsDir, 'example.com', 'a.js');
  const t0 = FREE('A');
  fs.writeFileSync(f, t0);
  const r = saveEdit(ws, { id: 'example.com/a', text: t0.replace('POST', 'PUT'), base: fileHash(t0) });
  assert.ok(r.saved);
  const uid = MI.readMeta(fs.readFileSync(f, 'utf8')).uid;
  assert.ok(MI.isId(uid));
  // an export of it, renamed on the way, imported back: the same mod, at its own file
  const exported = MI.withMeta(fs.readFileSync(f, 'utf8'), { name: 'Shared A' });
  const back = importMod(ws, { text: exported, site: 'example.com' });
  assert.deepEqual(back, { exists: 'example.com/a', site: 'example.com', name: 'a' }, 'asked as the mod it is');
  const replaced = importMod(ws, { text: exported, site: 'example.com', choice: 'replace' });
  assert.equal(replaced.id, 'example.com/a');
  assert.equal(MI.readMeta(fs.readFileSync(f, 'utf8')).uid, uid);
  // kept as a copy: a mod of its own, a new id
  const copy = importMod(ws, { text: exported, site: 'example.com', choice: 'copy' });
  assert.notEqual(MI.readMeta(fs.readFileSync(copy.file, 'utf8')).uid, uid);
  // a file without one gets one
  const fresh = importMod(ws, { text: FREE('Fresh'), site: 'example.com' });
  assert.ok(MI.isId(MI.readMeta(fs.readFileSync(fresh.file, 'utf8')).uid));
  fs.rmSync(ws.home, { recursive: true, force: true });
});
