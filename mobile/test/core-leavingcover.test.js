'use strict';
// mobile/shared/core/leaving-cover.js (the leaving cover's "icon use" decision, Tim 11-18) against
// leaving-cover-cases.json, the answers the iPhone's LeavingCover.reason / willEnterForeground gave before the move
// (mobile/test/leavingcover.test.js holds the Swift to them). Also through the generated mobile/shared/gen/core.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'leaving-cover-cases.json'), 'utf8'));

function run(L, where) {
  for (const [f, want] of cases.reason) assert.deepStrictEqual(JSON.parse(JSON.stringify(L.reason(f))), want, `${where} reason ${JSON.stringify(f)}`);
  for (const [s, want] of cases.arrived) assert.equal(L.arrived(s), want, `${where} arrived ${s}`);
}

test('core/leaving-cover.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'leaving-cover.js')), 'module');
  assert.ok(cases.reason.length > 500 && cases.reason.some(([, w]) => w && w.iconTab) && cases.arrived.length > 10);
});

test('gen/core.js: TrifCore.leavingCover in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.leavingCover', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("leavingCover.reason", JSON.stringify([{fullScreen: true, host: "m.facebook.com", tab: "A", iconTabs: {"facebook.com": "A"}, arrivedByIcon: false}]))', ctx), '{"iconTab":"facebook.com"}');
});

test('an icon site named like an Object member is no icon tab', () => {
  const L = require(path.join(CORE, 'leaving-cover.js'));
  assert.equal(L.reason({ fullScreen: true, host: 'constructor', tab: 'A', iconTabs: {}, arrivedByIcon: false }), null);
});
