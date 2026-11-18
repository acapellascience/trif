'use strict';
// mobile/shared/core/site.js and quick-ask.js (a look-only mod added at once, Undo puts things back: Tim, 11-18) against
// site-cases.json and quick-ask-cases.json, the answers the iPhone's Site.of, QuickAsk.lookOnly and ClaudePane's
// quickDeliver / quickUndo gave before the move (mobile/test/quickask.test.js holds the Swift to them). Also through the
// generated mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const site = JSON.parse(fs.readFileSync(path.join(CORE, 'site-cases.json'), 'utf8'));
const quick = JSON.parse(fs.readFileSync(path.join(CORE, 'quick-ask-cases.json'), 'utf8'));

function run(S, Q, where) {
  for (const [h, want] of site.of) assert.equal(S.of(h), want, `${where} of ${JSON.stringify(h)}`);
  for (const [h, s, want] of site.hostIsIn) assert.equal(S.hostIsIn(h, s), want, `${where} hostIsIn ${h} ${s}`);
  for (const [s, want] of site.chat) assert.equal(S.chat(s), want, `${where} chat ${s}`);
  for (const [m, s, want] of quick.lookOnly) assert.equal(Q.lookOnly(m, s), want, `${where} lookOnly ${m.name} on ${s}`);
  for (const [c, s, want] of quick.sort) assert.deepStrictEqual(JSON.parse(JSON.stringify(Q.sort(c.offered, s))), want, `${where} sort ${c.name} on ${s}`);
  for (const [st, ap, want] of quick.undo) assert.deepStrictEqual(JSON.parse(JSON.stringify(Q.undo(st, ap))), want, `${where} undo ${st}`);
}

test('core/site.js and core/quick-ask.js give the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'site.js')), require(path.join(CORE, 'quick-ask.js')), 'module');
  assert.ok(site.of.length + quick.lookOnly.length + quick.sort.length > 150);
});

test('gen/core.js: TrifCore.site and TrifCore.quickAsk in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.site', ctx), vm.runInContext('TrifCore.quickAsk', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("quickAsk.sort", JSON.stringify([[], "phone~m.x.com"]))', ctx), '{"site":"x.com","look":[],"rest":[],"state":"replied"}');
});
