'use strict';
// mobile/shared/core/mod-store.js, part 1: holds and Allow (Tim, 11-18: both phones run the mod store's rules from one
// file), against mod-store-cases.json, the answers the iPhone's Mods.swift gave before the move (mobile/test/
// modstore.test.js holds the Swift to them), and the branch android's ModStoreTest.kt stories. Also through the generated
// mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'mod-store-cases.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));

function run(S, where) {
  let n = 0;
  for (const [m, w, ap, se, ra, rr] of cases.mods) {
    const at = `${where} ${JSON.stringify(m)}`;
    assert.deepStrictEqual(plain(S.waiting(m)), w, `waiting ${at}`);
    assert.equal(S.held(m), w.length > 0, `held ${at}`);
    assert.deepStrictEqual(plain(S.approve(m)), ap, `approve ${at}`);
    assert.deepStrictEqual(plain(S.seeded(m)), se, `seeded ${at}`);
    assert.equal(S.ranAfter(true, m, 'add'), ra, `ranAfter add ${at}`);
    assert.equal(S.ranAfter(true, m, 'restore'), rr, `ranAfter restore ${at}`);
    n++;
  }
  for (const [ns, al, w] of cases.allow) { assert.deepStrictEqual(plain(S.allow(ns, al)), w, `${where} allow`); n++; }
  for (const [m, o, w] of cases.changeNeeds) { assert.deepStrictEqual(plain(S.changeNeeds(m, o)), w, `${where} changeNeeds ${m.tier} ${m.matches} from ${o.tier} on ${o.site}`); n++; }
  for (const [h, m, how, w] of cases.ranAfter) { assert.equal(S.ranAfter(h, m, how), w, `${where} ranAfter ${h} ${how}`); n++; }
  return n;
}

test('core/mod-store.js gives the iPhone\'s answers', () => {
  assert.ok(run(require(path.join(CORE, 'mod-store.js')), 'module') > 300);
});

test('core/mod-store.js: Android\'s stories (ModStoreTest.kt holdsWaitForAllow, editsAndRestores)', () => {
  const S = require(path.join(CORE, 'mod-store.js'));
  const need = (key, ...lines) => ({ key, fact: key, lines });
  // (new and held: Allow allows what it waits for)
  const h = { tier: 'boxed', site: 'a.com', matches: ['*://*.a.com/*'], needs: [need('power:net', 'l1')], extraNeeds: [], allowed: {}, ran: false };
  assert.ok(S.held(h));
  const ok = { ...h, allowed: S.approve(h) };
  assert.deepStrictEqual(ok.allowed, { 'power:net': ['l1'] });
  assert.ok(!S.held(ok));
  // (a later version needing nothing more runs; one needing more waits, the one before runs)
  const v2 = { ...ok, needs: [need('power:net', 'l1')] };
  assert.ok(!S.held(v2));
  const v3 = { ...v2, needs: [need('power:net', 'l1', 'l2')] };
  assert.ok(S.held(v3));
  assert.equal(S.ranAfter(S.held(v3), v2, 'add'), 'current');
  assert.equal(S.ranAfter(true, { ...v3, ran: true }, 'add'), 'ran');
  // (an edit that runs on another site asks for that site only)
  const e = { ...ok, matches: ['*://*.a.com/*', '*://b.com/*'] };
  const edit = { ...e, allowed: S.seeded(ok), extraNeeds: S.changeNeeds(e, ok) };
  assert.deepStrictEqual(S.waiting(edit).map((n) => n.key), ['match:*://b.com/*']);
  // (becoming a free mod asks)
  assert.deepStrictEqual(S.changeNeeds({ ...ok, tier: 'free', needs: [] }, ok).map((n) => n.key), ['tier:free']);
});

test('gen/core.js: TrifCore.modStore in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.modStore', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("modStore.allow", JSON.stringify([[{"key":"k","fact":"","lines":["b","a","b"]}], {}]))', ctx), '{"k":["a","b"]}');
});
