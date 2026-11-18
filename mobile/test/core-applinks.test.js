'use strict';
// mobile/shared/core/app-links.js (links that aren't web pages: Tim, 11-18) against app-links-cases.json, the answers the
// iPhone's AppLinks.swift gave before the move (mobile/test/applinks.test.js holds the Swift, calling through, to them).
// Also through the generated mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'app-links-cases.json'), 'utf8'));
const scheme = (url) => (url.match(/^([A-Za-z][A-Za-z0-9+.-]*):/) || [])[1] || '';

function run(L, where) {
  for (const [url, want] of cases.kind) assert.equal(L.kind(scheme(url), cases.own), want, `${where} kind ${url}`);
  for (const [a, want] of cases.decide) assert.equal(L.decide(a), want, `${where} decide ${JSON.stringify(a)}`);
  for (const [a, want] of cases.isTap) assert.equal(L.isTap(a), want, `${where} isTap ${JSON.stringify(a)}`);
  for (const [url, want] of cases.logged) assert.equal(L.logged(scheme(url)), want, `${where} logged ${url}`);
}

test('core/app-links.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'app-links.js')), 'module');
  assert.equal(require(path.join(CORE, 'app-links.js')).kind('', []), 'never', 'no scheme');
});

test('gen/core.js: TrifCore.appLinks in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.appLinks', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("appLinks.decide", JSON.stringify([{ tapped: false, mainFrame: true, askedThisLoad: false, asking: false }]))', ctx), '"ask"');
});
