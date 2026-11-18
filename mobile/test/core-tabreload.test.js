'use strict';
// mobile/shared/core/tab-reload.js (which tabs load again when the mods change, Tim 11-18) and desktop.js (Request
// Desktop Website's per-site memory) against tab-reload-cases.json and desktop-cases.json, the answers the iPhone's
// Browser.select / refreshIfStale / desktopKey / requestDesktop gave before the move (mobile/test/tabreload.test.js
// holds the Swift to them). Also through the generated mobile/shared/gen/core.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const R = JSON.parse(fs.readFileSync(path.join(CORE, 'tab-reload-cases.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(CORE, 'desktop-cases.json'), 'utf8'));

function runReload(T, where) {
  for (const [f, want] of R.shown) assert.equal(T.shown(f), want, `${where} shown ${JSON.stringify(f)}`);
  for (const [f, want] of R.loaded) assert.equal(T.loaded(f), want, `${where} loaded ${JSON.stringify(f)}`);
  for (const [f, want] of R.stale) assert.equal(T.stale(f.loaded, f.now), want, `${where} stale ${JSON.stringify(f)}`);
  for (const [f, want] of R.refresh) assert.equal(T.refresh(f), want, `${where} refresh ${JSON.stringify(f)}`);
  for (const [f, want] of R.recheck) assert.equal(T.recheck(f), want, `${where} recheck ${JSON.stringify(f)}`);
}
function runDesktop(K, where) {
  for (const [h, want] of D.key) assert.equal(K.key(h), want, `${where} key ${h}`);
  for (const [f, want] of D.wants) assert.equal(K.wants(f.kept, f.host), want, `${where} wants ${JSON.stringify(f)}`);
  for (const [f, want] of D.set) assert.deepStrictEqual(JSON.parse(JSON.stringify(K.set(f.kept, f.host, f.on))), want, `${where} set ${JSON.stringify(f)}`);
  for (const [f, want] of D.can) assert.equal(K.can(f.scheme, f.host), want, `${where} can ${JSON.stringify(f)}`);
}

test('core/tab-reload.js and core/desktop.js give the iPhone\'s answers', () => {
  runReload(require(path.join(CORE, 'tab-reload.js')), 'module');
  runDesktop(require(path.join(CORE, 'desktop.js')), 'module');
  for (const a of ['later', 'keep', 'ask', 'next']) assert.ok(R.refresh.some(([, w]) => w === a), a);
  for (const a of ['playing', 'keep', 'reload']) assert.ok(R.recheck.some(([, w]) => w === a), a);
  assert.ok(D.wants.some(([, w]) => w) && D.set.length > 100);
});

test('gen/core.js: TrifCore.tabReload and TrifCore.desktop in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  runReload(vm.runInContext('TrifCore.tabReload', ctx), 'gen');
  runDesktop(vm.runInContext('TrifCore.desktop', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("tabReload.refresh", JSON.stringify([{pending: false, started: true, hasPage: true, reloading: false, loaded: "a:1", now: "", evenPlaying: false}]))', ctx), '"ask"');
  assert.equal(vm.runInContext('TrifCore.call("desktop.set", JSON.stringify([["b.org"], "WWW.A.org", true]))', ctx), '["a.org","b.org"]');
});
