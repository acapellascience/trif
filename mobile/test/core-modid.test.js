'use strict';
// mobile/shared/core/mod-id.js (stable mod ids and renames: docs/PHONE-SYNC.md 2a, Tim 11-18) against mod-id-cases.json,
// a copy of the desktop's tests/fixtures/mod-id-cases.json (branch phone-link): the desktop's helper/lib/modid.js gives
// these answers, so both sides agree on every id, name, file and part revision. The revisions are SHA-256 (node's
// crypto here, CryptoKit in the app) of the core's bodyText and metaText. Also through the generated
// mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'mod-id-cases.json'), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(String(s), 'utf8')).digest('hex');
// (a value from another context compares by its JSON)
const plain = (v) => JSON.parse(JSON.stringify(v));

function run(M, where) {
  for (const [v, want] of cases.ids) assert.equal(M.isId(v), want, `${where} isId ${JSON.stringify(v)}`);
  for (const [k, c] of Object.entries(cases.texts)) {
    assert.deepEqual(plain(M.readMeta(c.text)), c.meta, `${where} readMeta ${k}`);
    assert.equal(M.bodyText(c.text), c.body, `${where} bodyText ${k}`);
    assert.equal(M.metaText(c.text), c.metaText, `${where} metaText ${k}`);
    assert.deepEqual({ body: sha(M.bodyText(c.text)), meta: sha(M.metaText(c.text)) }, c.revs, `${where} revs ${k}`);
    const p = plain(M.parts(c.text));
    assert.deepEqual(p, { ...c.meta, body: c.body, meta: c.metaText }, `${where} parts ${k}`);
  }
  for (const w of cases.withMeta) assert.equal(M.withMeta(cases.texts[w.text].text, w.set), w.out, `${where} withMeta ${w.text} ${JSON.stringify(w.set)}`);
  for (const [name, want] of cases.slugs) assert.equal(M.slug(name), want, `${where} slug ${name}`);
  for (const [name, taken, own, want] of cases.files) assert.equal(M.fileFor(name, taken, own), want, `${where} fileFor ${name} ${JSON.stringify(taken)} ${own}`);
  for (const [name, want] of cases.names) assert.equal(M.checkName(name), want, `${where} checkName ${JSON.stringify(name).slice(0, 30)}`);
}

test('core/mod-id.js gives the desktop\'s answers (mod-id-cases.json)', () => {
  const M = require(path.join(CORE, 'mod-id.js'));
  run(M, 'module');
  // (the apps pass null for a part they leave as it is: JSON has no undefined)
  const t = cases.texts.withId.text;
  assert.equal(M.withMeta(t, { name: null, uid: null }), t, 'null leaves both as they are');
  assert.equal(M.withMeta(t, {}), t, 'nothing set: the same text');
  assert.equal(M.checkName(7), 'a name is text');
});

test('mod-id-cases.json is the desktop\'s fixture, unchanged (when the phone-link worktree is here)', { skip: !fs.existsSync(path.join(require('os').homedir(), 'WebMods-worktrees', 'phone-link', 'tests', 'fixtures', 'mod-id-cases.json')) && 'no phone-link worktree' }, () => {
  const theirs = fs.readFileSync(path.join(require('os').homedir(), 'WebMods-worktrees', 'phone-link', 'tests', 'fixtures', 'mod-id-cases.json'), 'utf8');
  assert.equal(fs.readFileSync(path.join(CORE, 'mod-id-cases.json'), 'utf8'), theirs);
});

test('gen/core.js: TrifCore.modId in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.modId', ctx), 'gen');
  const c = cases.texts.plain;
  assert.equal(vm.runInContext(`TrifCore.call("modId.metaText", ${JSON.stringify(JSON.stringify([c.text]))})`, ctx), JSON.stringify(c.metaText));
  assert.equal(vm.runInContext(`TrifCore.call("modId.withMeta", ${JSON.stringify(JSON.stringify([c.text, { name: 'Quiet feed', uid: null }]))})`, ctx),
    JSON.stringify(cases.withMeta[0].out), 'a call with null for the part kept');
});
