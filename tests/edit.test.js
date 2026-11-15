'use strict';
// The code card's Edit (helper/lib/edit.js, the helper's mod.save and mod.undoEdit): an edit checked as
// `trif check` checks a file, with the line of what's wrong; saved only when nothing is and the file is still the
// version it started from; the version before in History; judged as any change, plus what an edit adds (held.js
// editNeeds); Undo right after Save. In the browsers: tests/e2e/scenario.js codeEditCheck.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, tempDir } = require('./fake-extension');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, loadHeld, loadEdits, editsFile } = require('../helper/lib/held');
const history = require('../helper/lib/history');
const { checkText, saveEdit, undoEdit, fileHash, jsonErrorLine } = require('../helper/lib/edit');

const header = (lines, body) => `// ==WebMod==\n${lines.map((l) => `// ${l}`).join('\n')}\n// ==/WebMod==\n${body}\n`;

function makeWs() {
  const home = tempDir('trif-edit-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'x.com'), { recursive: true });
  updateHeld(ws, [], []); // (the first sync: nothing yet)
  return ws;
}
const fileOf = (ws, id) => path.join(ws.modsDir, `${id}.js`);
const sync = (ws) => updateHeld(ws, scanMods(ws.modsDir).mods, []);
// A mod the user has, as TRIF last let it run
function have(ws, id, text) {
  fs.writeFileSync(fileOf(ws, id), text);
  const held = sync(ws);
  if (held[id]) { approveHeld(ws.home, id); sync(ws); }
  assert.equal(sync(ws)[id], undefined);
}
const save = (ws, id, text) => saveEdit(ws, { id, text, base: fileHash(fs.readFileSync(fileOf(ws, id), 'utf8')) });

test('an edit is checked as trif check checks a file, with the line of what is wrong', () => {
  const o = { site: 'x.com', file: '/w/sites/x.com/a.js' };
  const bad = checkText(header(['@name A', '@match https://x.com/*'], 'const a = 1;\nconst b = ;'), o);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].line, 6);
  assert.match(bad.errors[0].message, /Unexpected token/);
  // (a boxed mod's code runs in an async function: a top-level await is fine, and its lines are the file's)
  assert.equal(checkText(header(['@name A', '@match https://x.com/*', '@boxed'], 'await trif.sleep(1);\ntrif.hide(".a");'), o).ok, true);
  assert.equal(checkText(header(['@name A', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");\nconst = 2;\ntrif.hide(".b");'), o).errors[0].line, 7);
  const json = checkText(header(['@name A', '@match https://x.com/*', '@style'], '{\n "css": "a{}",\n "hide": [".x",]\n}'), o);
  assert.equal(json.ok, false);
  assert.equal(json.errors[0].line, 8);
  assert.match(json.errors[0].message, /^the rules aren't valid JSON/);
  const css = checkText(header(['@name A', '@match https://x.com/*', '@style'], '{\n "hide": [".a"],\n "css": "a { background: url(https://e.x/a.png) }"\n}'), o);
  assert.equal(css.ok, false);
  assert.equal(css.errors[0].line, 8);
  assert.match(css.errors[0].message, /^"css": /);
  const power = checkText(header(['@name A', '@match https://x.com/*', '@boxed', '@powers nope'], 'trif.hide(".a")'), o);
  assert.equal(power.errors[0].line, 5);
  assert.match(power.errors[0].message, /"nope" isn't a power/);
  assert.equal(checkText(header(['@name A', '@style', '@boxed'], '{}'), o).errors[0].line, 3);
  assert.equal(checkText('// ==WebMod==\n// @name A\nconst a = 1;', o).errors[0].line, 1);
  // (a boxed mod: what the sandbox would refuse, by line; not saved)
  const lint = checkText(header(['@name A', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");\ndocument.querySelector("b").click();'), o);
  assert.equal(lint.ok, false);
  assert.deepEqual([...new Set(lint.lint.flatMap((l) => l.lines))], [7]);
  // (a free mod may use the page; a style section's problem is on its line)
  assert.equal(checkText(header(['@name A', '@match https://x.com/*'], 'document.title = "x";'), o).ok, true);
  const section = checkText('// ==WebMod==\n// @name A\n// ==/WebMod==\n// ==Style==\n// { "css": "a {",\n// ==/Style==\ndocument.title = 1;\n', o);
  assert.equal(section.ok, false);
  assert.equal(section.errors[0].line, 5);
  assert.equal(jsonErrorLine('{\n "a": 1\n "b": 2\n}'), 3);
  assert.equal(jsonErrorLine('{"a": [1, 2]}'), null);
});

test('a saved edit: the version before in History, a change elsewhere runs at once, Undo puts it back', () => {
  const ws = makeWs();
  const id = 'x.com/sender';
  const v1 = header(['@name Sender', '@match https://x.com/*'], "fetch('/a', { method: 'POST' });\ndocument.title = 'x';");
  have(ws, id, v1);
  // (unchanged: nothing saved)
  assert.deepEqual(save(ws, id, v1), { ok: true, saved: false, id, hash: fileHash(v1) });
  // an edit elsewhere in it (and a new @name: only the name shown; the id stays the file's)
  const v2 = v1.replace("'x'", "'y'").replace('@name Sender', '@name Renamed');
  const r = save(ws, id, v2);
  assert.equal(r.ok, true);
  assert.equal(r.saved, true);
  assert.equal(r.hash, fileHash(v2));
  assert.equal(fs.readFileSync(fileOf(ws, id), 'utf8'), v2);
  const [kept] = history.listHistory(ws, id);
  assert.equal(kept.stamp, r.stamp);
  assert.equal(kept.source, 'edit');
  assert.equal(history.entryText(ws, id, r.stamp), v1);
  const mods = scanMods(ws.modsDir).mods;
  assert.deepEqual(mods.map((m) => [m.id, m.name]), [[id, 'Renamed']]);
  assert.deepEqual(updateHeld(ws, mods, []), {});
  // Undo right after Save: the version before back, the edit kept in History as "before an undo"
  assert.deepEqual(undoEdit(ws, { id, stamp: r.stamp, hash: r.hash }), { id, restored: r.stamp });
  assert.equal(fs.readFileSync(fileOf(ws, id), 'utf8'), v1);
  assert.equal(history.listHistory(ws, id)[0].source, 'undo');
  assert.equal(history.entryText(ws, id, history.listHistory(ws, id)[0].stamp), v2);
  assert.deepEqual(sync(ws), {});
  // (an Undo once the file changed again: refused, History has it)
  const r2 = save(ws, id, v2);
  fs.writeFileSync(fileOf(ws, id), v2 + '// meanwhile\n');
  assert.throws(() => undoEdit(ws, { id, stamp: r2.stamp, hash: r2.hash }), /changed again since you saved it/);
});

test('nothing broken is saved, and nothing over a change made meanwhile', () => {
  const ws = makeWs();
  const id = 'x.com/a';
  const v1 = header(['@name A', '@match https://x.com/*'], 'document.title = 1;');
  have(ws, id, v1);
  const base = fileHash(v1);
  const broken = saveEdit(ws, { id, text: v1.replace('= 1;', '= ;'), base });
  assert.equal(broken.ok, false);
  assert.equal(broken.check.errors[0].line, 5);
  assert.equal(fs.readFileSync(fileOf(ws, id), 'utf8'), v1);
  assert.deepEqual(history.listHistory(ws, id), []);
  // another editor (or an agent) changed it since the edit started: not saved, the other change kept
  fs.writeFileSync(fileOf(ws, id), v1 + '// theirs\n');
  assert.deepEqual(saveEdit(ws, { id, text: v1.replace('1;', '2;'), base }), { ok: false, conflict: true, id });
  assert.match(fs.readFileSync(fileOf(ws, id), 'utf8'), /theirs/);
  // (only a mod's own file, by its id; not a link)
  assert.throws(() => saveEdit(ws, { id: '../etc/passwd', text: 'x', base }), /isn't a mod id/);
  assert.throws(() => saveEdit(ws, { id: 'x.com/none', text: 'x', base }), /there's no mod x\.com\/none/);
  fs.symlinkSync(fileOf(ws, id), fileOf(ws, 'x.com/link'));
  assert.throws(() => saveEdit(ws, { id: 'x.com/link', text: v1, base: fileHash(v1 + '// theirs\n') }), /is a link/);
  // (a file whose lines end in \r\n keeps them)
  const crlf = v1.replace(/\n/g, '\r\n');
  fs.writeFileSync(fileOf(ws, 'x.com/crlf'), crlf);
  assert.equal(saveEdit(ws, { id: 'x.com/crlf', text: v1.replace('1;', '2;'), base: fileHash(crlf) }).saved, true);
  assert.equal(fs.readFileSync(fileOf(ws, 'x.com/crlf'), 'utf8'), crlf.replace('1;', '2;'));
});

test('a saved edit waits for what it adds: a power, a line using one, another site while it can act, becoming a free mod', () => {
  const ws = makeWs();
  const id = 'x.com/sender';
  const v1 = header(['@name Sender', '@match https://x.com/*'], "fetch('/a', { method: 'POST' });\ndocument.title = 'x';");
  have(ws, id, v1);
  // a new line that sends: waits, "You edited it" (by 'edit'), the version before running meanwhile
  save(ws, id, v1.replace("document.title = 'x';", "fetch('/b', { method: 'POST' });"));
  let held = sync(ws);
  assert.deepEqual(held[id].needs, ['sends']);
  assert.equal(held[id].by, 'edit');
  assert.match(held[id].facts[0], /a line that does this is new or changed/);
  // (Undo while it waits: the version before back, nothing waits)
  const r0 = history.listHistory(ws, id)[0];
  undoEdit(ws, { id, stamp: r0.stamp, hash: fileHash(fs.readFileSync(fileOf(ws, id), 'utf8')) });
  assert.deepEqual(sync(ws), {});
  // a @match for another site, while it can send: waits for that, in held.js's words
  save(ws, id, v1.replace('// @match https://x.com/*', '// @match https://x.com/*\n// @match https://bank.example/*'));
  held = sync(ws);
  assert.deepEqual(held[id].needs, ['match:https://bank.example/*']);
  assert.deepEqual(held[id].facts, ['runs on https://bank.example/*, outside x.com']);
  approveHeld(ws.home, id);
  assert.deepEqual(sync(ws), {});
  // (allowed once: an edit that keeps it doesn't ask again; a subdomain of its site never asks)
  save(ws, id, fs.readFileSync(fileOf(ws, id), 'utf8').replace("'x'", "'z'").replace('// @match https://x.com/*', '// @match https://x.com/*\n// @match https://pro.x.com/*'));
  assert.deepEqual(sync(ws), {});
  // a boxed mod without powers can't act wherever it runs: another site doesn't ask
  const box = 'x.com/box';
  const b1 = header(['@name Box', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");');
  have(ws, box, b1);
  save(ws, box, b1.replace('// @match https://x.com/*', '// @match https://other.example/*'));
  assert.deepEqual(sync(ws), {});
  // a new power asks for it
  const b2 = fs.readFileSync(fileOf(ws, box), 'utf8');
  save(ws, box, b2.replace('// @boxed', '// @boxed\n// @powers keys'));
  held = sync(ws);
  assert.deepEqual(held[box].needs, ['power:keys']); // (other.example: the version before ran there)
  // (Don't allow: the version before back)
  require('../helper/lib/held').rejectHeld(ws, box, held[box].hash);
  assert.equal(fs.readFileSync(fileOf(ws, box), 'utf8'), b2);
  assert.deepEqual(sync(ws), {});
  // becoming a free mod (even one TRIF reads nothing in) asks, in the iPhone's words
  save(ws, box, b2.replace('// @boxed\n', '').replace('trif.hide(".a");', 'document.title = "free";'));
  held = sync(ws);
  assert.deepEqual(held[box].needs, ['tier:free']);
  assert.deepEqual(held[box].facts, ['is now a free mod, so it can do anything the page can do']);
  assert.equal(held[box].by, 'edit');
  // (the same change from anywhere else, an editor or the user's terminal agent, is judged as before: an
  // outside change, which only its code's powers make wait)
  const free = 'x.com/free';
  have(ws, free, b1);
  fs.writeFileSync(fileOf(ws, free), b1.replace('// @boxed\n', '').replace('trif.hide(".a");', 'document.title = "free";'));
  assert.equal(sync(ws)[free], undefined);
  // (the mark goes with the edit: once the file is something else, after a minute's grace)
  assert.ok(loadEdits(ws.home)[box]);
  const e = JSON.parse(fs.readFileSync(editsFile(ws.home), 'utf8'));
  e[box].at = Date.now() - 120000;
  fs.writeFileSync(editsFile(ws.home), JSON.stringify(e));
  fs.writeFileSync(fileOf(ws, box), b2);
  sync(ws);
  assert.equal(loadEdits(ws.home)[box], undefined);
  assert.equal(loadHeld(ws.home)[box], undefined);
});

test('the helper: mod.code gives the version, mod.save saves and syncs (held or not), refuses a conflict, mod.undoEdit undoes', async (t) => {
  const home = tempDir('trif-edit-h-');
  fs.mkdirSync(path.join(home, 'sites', 'x.com'), { recursive: true });
  const file = path.join(home, 'sites', 'x.com', 'a.js');
  const v1 = header(['@name A', '@match https://x.com/*'], 'document.title = 1;');
  fs.writeFileSync(file, v1);
  const ext = new FakeExtension({ home });
  t.after(() => ext.close());
  ext.hello();
  await ext.nextMods((mods) => mods.some((m) => m.id === 'x.com/a'));
  let n = 0;
  const ask = async (cmd, args) => { const id = `e${++n}`; ext.send({ type: 'request', id, cmd, args }); return ext.next((m) => m.type === 'response' && m.id === id); };
  const code = (await ask('mod.code', { id: 'x.com/a' })).result;
  assert.equal(code.base, fileHash(v1));
  // runs at once
  let r = await ask('mod.save', { id: 'x.com/a', text: v1.replace('1;', '2;'), base: code.base });
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.result, stamp: typeof r.result.stamp }, { ok: true, saved: true, id: 'x.com/a', stamp: 'string', hash: fileHash(v1.replace('1;', '2;')), held: false, pending: false });
  await ext.nextMods((mods) => mods.some((m) => m.id === 'x.com/a' && /= 2;/.test(m.code) && !m.held && !m.pending));
  // waits: a line that sends; the version before is what's sent meanwhile, the change pending
  const v3 = v1.replace('1;', "2;\nfetch('/x', { method: 'POST' });");
  r = await ask('mod.save', { id: 'x.com/a', text: v3, base: r.result.hash });
  assert.equal(r.result.held, true);
  assert.equal(r.result.pending, true);
  const sent = await ext.nextMods((mods) => mods.some((m) => m.id === 'x.com/a' && m.pending));
  const a = sent.find((m) => m.id === 'x.com/a');
  assert.equal(a.pending.by, 'edit');
  assert.match(a.code, /= 2;/);
  assert.doesNotMatch(a.code, /fetch/);
  // a conflict: refused, nothing written
  const stale = await ask('mod.save', { id: 'x.com/a', text: v1, base: code.base });
  assert.deepEqual(stale.result, { ok: false, conflict: true, id: 'x.com/a' });
  // broken: the check, nothing written
  const broken = await ask('mod.save', { id: 'x.com/a', text: v3.replace('fetch(', 'fetch(('), base: r.result.hash });
  assert.equal(broken.result.ok, false);
  assert.equal(broken.result.check.errors[0].line, 6);
  assert.equal(fs.readFileSync(file, 'utf8'), v3);
  // Undo
  const u = await ask('mod.undoEdit', { id: 'x.com/a', stamp: r.result.stamp, hash: r.result.hash });
  assert.equal(u.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), v1.replace('1;', '2;'));
  await ext.nextMods((mods) => mods.some((m) => m.id === 'x.com/a' && !m.pending && !m.held && /= 2;/.test(m.code)));
});
