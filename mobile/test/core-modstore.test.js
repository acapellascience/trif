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
  // part 2: changes
  for (const [o, m, src, now, ch, w] of cases.add) { assert.deepStrictEqual(plain(S.add(o, m, src, now, ch)), w, `${where} add ${src} ${JSON.stringify(o)}`); n++; }
  for (const [ids, id, b, w] of cases.undoAdd) { assert.deepStrictEqual(plain(S.undoAdd(ids, id, b)), w, `${where} undoAdd ${ids} ${b}`); n++; }
  for (const [t, by, now, w] of cases.remove) { assert.deepStrictEqual(plain(S.remove(t, by, now)), w, `${where} remove ${t.length} ${by}`); n++; }
  for (const [l, ids, t, w] of cases.undoDelete) { assert.deepStrictEqual(plain(S.undoDelete(l, ids, t)), w, `${where} undoDelete ${l} ${ids} ${t}`); n++; }
  for (const [e, t, ids, l, w] of cases.restoreDeleted) { assert.deepStrictEqual(plain(S.restoreDeleted(e, t, ids, l)), w, `${where} restoreDeleted ${e} ${ids} ${l}`); n++; }
  for (const [c, now, w] of cases.reject) { assert.deepStrictEqual(plain(S.reject(c, now)), w, `${where} reject`); n++; }
  for (const [c, src, now, w] of cases.restore) { assert.deepStrictEqual(plain(S.restore(c, src, now)), w, `${where} restore ${src}`); n++; }
  return n;
}

test('core/mod-store.js gives the iPhone\'s answers', () => {
  assert.ok(run(require(path.join(CORE, 'mod-store.js')), 'module') > 900);
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
  // (Tim, 11-18: a restore while an edit waits keeps the approved version running, as another edit there does)
  assert.equal(S.ranAfter(true, { ...v3, ran: true }, 'restore'), 'ran');
  assert.equal(S.ranAfter(true, v3, 'restore'), null);
  assert.equal(S.ranAfter(true, v2, 'restore'), 'current');
  // (an edit that runs on another site asks for that site only)
  const e = { ...ok, matches: ['*://*.a.com/*', '*://b.com/*'] };
  const edit = { ...e, allowed: S.seeded(ok), extraNeeds: S.changeNeeds(e, ok) };
  assert.deepStrictEqual(S.waiting(edit).map((n) => n.key), ['match:*://b.com/*']);
  // (becoming a free mod asks)
  assert.deepStrictEqual(S.changeNeeds({ ...ok, tier: 'free', needs: [] }, ok).map((n) => n.key), ['tier:free']);
});

test('core/mod-store.js: Android\'s stories (ModStoreTest.kt addingAndImporting, deletingAndRecentlyDeleted)', () => {
  const S = require(path.join(CORE, 'mod-store.js'));
  const DAY = 86400000;
  let now = 1763400000000;
  const free = { tier: 'style', site: 'a.com', matches: [], needs: [], extraNeeds: [], allowed: {}, ran: false };
  // (from the chat: on; an import: off, marked import)
  assert.deepStrictEqual(S.add(null, { ...free, on: true }, 'chat', now, true), { source: 'chat', on: true, newOff: null });
  assert.deepStrictEqual(S.add(null, { ...free, on: true }, 'import', now, true), { source: 'import', on: false, newOff: 'import' });
  // (a new version: the one before in History; an import of it is off and marked updated)
  const a = { ...free, on: true, newOff: null, history: [] };
  now += 1000;
  const a2 = S.add(a, { ...free, on: true }, 'import', now, true);
  assert.deepStrictEqual([a2.on, a2.newOff, a2.history, a2.version.source, a2.version.stamp], [false, 'update', [-1], 'import', String(now)]);
  // (the same code again adds no history; History keeps 30 days)
  const kept = { ...a, history: [a2.version] };
  assert.deepStrictEqual(S.add(kept, free, 'chat', now, false).history, [0]);
  assert.deepStrictEqual(S.add(kept, free, 'chat', now + 31 * DAY, true).history, [-1]);
  // (deleted by you: Undo; by the computer: none; Recently deleted keeps 30 days)
  assert.deepStrictEqual(S.remove([], 'you', now), { undo: true, keep: [] });
  assert.deepStrictEqual(S.remove([{ at: now - 31 * DAY }, { at: now - DAY }], 'computer', now), { undo: false, keep: [1] });
  assert.deepStrictEqual(S.undoDelete('a.com/A', ['a.com/B'], ['a.com/A']), { append: true, drop: 0 });
  assert.equal(S.undoDelete(null, [], []), null);
  // (put back; not while one with its id is here)
  const trash = [{ id: 'a.com/A@1', modId: 'a.com/A' }];
  assert.deepStrictEqual(S.restoreDeleted('a.com/A@1', trash, ['a.com/B'], null), { index: 0, clearLast: false });
  assert.equal(S.restoreDeleted('a.com/A@1', trash, ['a.com/A'], null), null);
  assert.equal(S.restoreDeleted('gone@1', trash, [], null), null);
  // (Don't allow a new mod: deleted; a change: the version before back, the change in History as undo)
  assert.equal(S.reject({ ran: false, history: [] }, now), null);
  assert.equal(S.reject({ ran: true, history: [{ at: now }] }, now).version.source, 'undo');
});

test('gen/core.js: TrifCore.modStore in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.modStore', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("modStore.allow", JSON.stringify([[{"key":"k","fact":"","lines":["b","a","b"]}], {}]))', ctx), '{"k":["a","b"]}');
});
