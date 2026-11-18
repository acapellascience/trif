'use strict';
// mobile/shared/core/speech-text.js (the microphone's words only ever grow, Tim 11-18) against speech-text-cases.json,
// the answers the iPhone's SpeechText.swift gave before the move (mobile/test/speechtext.test.js holds the Swift to
// them). Also through the generated mobile/shared/gen/core.js, and a random walk (the committed words only grow by `added`,
// kept trimmed).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'speech-text-cases.json'), 'utf8'));

function run(T, where) {
  for (const [s, want] of cases.clean) assert.equal(T.clean(s), want, `${where} clean ${JSON.stringify(s)}`);
  for (const [s, want] of cases.norm) assert.equal(T.norm(s), want, `${where} norm ${JSON.stringify(s)}`);
  for (const [a, b, want] of cases.join) assert.equal(T.join(a, b), want, `${where} join ${JSON.stringify([a, b])}`);
  for (const [p, n, want] of cases.isFresh) assert.equal(T.isFresh(p, n), want, `${where} isFresh ${JSON.stringify([p, n])}`);
  for (const r of cases.runs) {
    let st = T.start(), committed = '';
    r.events.forEach((e, i) => {
      st = JSON.parse(JSON.stringify(T.apply(st, e)));
      committed += st.added;
      const w = r.states[i];
      assert.deepStrictEqual({ committed, said: st.said, live: st.live, taskSaid: st.taskSaid, restarts: st.restarts, text: committed + st.tail },
        { committed: w.committed, said: w.committed !== '', live: w.live, taskSaid: w.taskSaid, restarts: w.restarts, text: T.join(w.committed, w.live) }, `${where} ${JSON.stringify(r.events.slice(0, i + 1))}`);
    });
  }
}

test('core/speech-text.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'speech-text.js')), 'module');
  assert.ok(cases.runs.length > 150 && cases.isFresh.some(([, , w]) => w) && cases.runs.some((r) => r.states.some((s) => s.restarts > 0)));
});

test('gen/core.js: TrifCore.speechText in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.speechText', ctx), 'gen');
  const st = JSON.parse(vm.runInContext('TrifCore.call("speechText.apply", JSON.stringify([{said: true, live: "", taskSaid: "Make the header blue.", restarts: 0}, ["partial", "Make the header blue, and bigger"]]))', ctx));
  assert.deepStrictEqual(st, { added: '', said: true, live: 'and bigger', taskSaid: 'Make the header blue.', restarts: 0, tail: ' and bigger' });
});

test('a random walk: added words keep the committed ones trimmed, `said` follows them', () => {
  const T = require(path.join(CORE, 'speech-text.js'));
  const vocab = ['make', 'the', 'header', 'blue', 'and', 'bigger', 'please', 'Make', 'The,', 'café', 'café', ' ', 'ΟΔΟΣ'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const phrase = () => Array.from({ length: rnd(8) }, () => vocab[rnd(vocab.length)]).join(' ');
  const kinds = ['volatile', 'final', 'partial', 'partial', 'segment', 'newTask'];
  for (let i = 0; i < 1000; i++) {
    let st = T.start(), committed = '';
    for (let j = 0; j < 40; j++) {
      const k = kinds[rnd(kinds.length)];
      st = T.apply(st, k === 'newTask' ? [k] : [k, phrase()]);
      committed += st.added;
      assert.equal(st.said, committed !== '');
      assert.ok(!/^\s|\s$/.test(committed));
    }
  }
});

test('the odd event or state answers safely', () => {
  const T = require(path.join(CORE, 'speech-text.js'));
  assert.deepStrictEqual(T.apply(null, ['partial', 'hi']), { added: '', said: false, live: 'hi', taskSaid: '', restarts: 0, tail: 'hi' });
  assert.deepStrictEqual(T.apply({ said: true, live: 'b', taskSaid: '', restarts: 1 }, ['what']), { added: '', said: true, live: 'b', taskSaid: '', restarts: 1, tail: ' b' });
});
