'use strict';
// mobile/shared/core/chat-offers.js (what a chat may offer: Tim, 11-17) against chat-offers-cases.json, the answers the
// iPhone's ChatOffers.swift gave before the move (mobile/test/chatoffers.test.js holds the Swift, calling through, to
// them). Also through the generated mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'chat-offers-cases.json'), 'utf8'));

function run(C, where) {
  assert.equal(C.LIMIT, cases.limit, `${where} limit`);
  for (const [code, norm, key] of cases.key) {
    assert.equal(C.normalise(code), norm, `${where} normalise ${JSON.stringify(code).slice(0, 60)}`);
    assert.equal(C.key(code), key, `${where} key ${JSON.stringify(code).slice(0, 60)}`);
  }
  for (const n of cases.note) {
    let entries = [];
    for (const [code, o, at] of n.steps) entries = C.note(entries, code, o, at) || entries;
    assert.deepEqual(entries, n.entries, `${where} note ${JSON.stringify(n.steps)}`);
    assert.deepEqual(['a', 'b', 'pasted'].map((c) => C.outcome(entries, c)), n.outcomes, `${where} outcomes ${JSON.stringify(n.steps)}`);
  }
  let big = [];
  for (let i = 0; i < 520; i++) big = C.note(big, `code ${i}`, 'offered', i);
  big = C.note(big, 'code 30', 'offered', 1000);
  const L = cases.noteLimit;
  assert.deepEqual([big.length, big[0].key, big[big.length - 1].key, C.outcome(big, 'code 0'), C.outcome(big, 'code 519')],
    [L.count, L.first, L.last, L['code 0'], L['code 519']], `${where} limit`);
  const known = (list) => list.map((m) => ({ id: m.id, key: C.key(m.code), history: C.keys(m.history) }));
  for (const s of cases.skip) {
    const a = { key: C.key(s.code), installed: known(s.installed), deleted: known(s.deleted), queued: known(s.queued), entries: s.entries };
    assert.equal(C.skip(a), s.want, `${where} skip ${JSON.stringify(s.code).slice(0, 40)} → ${s.want}`);
  }
}

test('core/chat-offers.js gives the iPhone\'s answers', () => {
  const C = require(path.join(CORE, 'chat-offers.js'));
  run(C, 'module');
  assert.equal(C.note([], 'x', 'nonsense', 1), null, 'an unknown outcome changes nothing');
  assert.equal(C.key('\ud800'), C.key('�'), 'a lone surrogate counts as U+FFFD');
});

test('gen/core.js: TrifCore.chatOffers in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.chatOffers', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("chatOffers.key", JSON.stringify(["a"]))', ctx), JSON.stringify(cases.key.find((k) => k[0] === 'a')[2]));
});
