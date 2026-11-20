'use strict';
// mobile/shared/core/site-access.js (Tim 11-20: per-site opt-in on the phones) against site-access-cases.json: the
// connected sites, sensitive matching with patterns and each sensitive host a site of its own (as desktop's
// extension/lib.js sensitiveHit), the upgrade rule, and a sensitive site's adds. Also through the generated
// mobile/shared/gen/core.js, as the apps load it, and the list kept in step with extension/agentsites.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'site-access-cases.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));

function run(A, where) {
  for (const [h, own, want] of cases.scope) assert.equal(A.scope(h, own), want, `${where} scope ${h} ${JSON.stringify(own)}`);
  for (const [c, h, own, want] of cases.card) assert.deepStrictEqual(plain(A.card(c, h, own)), want, `${where} card ${h}`);
  for (const [c, h, own, want] of cases.connected) assert.equal(A.connected(c, h, own), want, `${where} connected ${h} in ${c}`);
  for (const [c, h, own, want] of cases.connect) assert.deepStrictEqual(plain(A.connect(c, h, own)), want, `${where} connect ${h}`);
  for (const [c, h, own, want] of cases.disconnect) assert.deepStrictEqual(plain(A.disconnect(c, h, own)), want, `${where} disconnect ${h}`);
  for (const [t, want] of cases.cleanPattern) assert.equal(A.cleanPattern(t), want, `${where} cleanPattern ${JSON.stringify(t)}`);
  for (const [input, want] of cases.upgrade) assert.deepStrictEqual(plain(A.upgrade(input)), want, `${where} upgrade ${JSON.stringify(input)}`);
  for (const [f, want] of cases.sensitiveAdd) assert.deepStrictEqual(plain(A.sensitiveAdd(f)), want, `${where} sensitiveAdd ${JSON.stringify(f)}`);
}

test('core/site-access.js gives the cases\' answers', () => {
  run(require(path.join(CORE, 'site-access.js')), 'module');
});

test('gen/core.js: TrifCore.siteAccess in a bare context (JavaScriptCore\'s view), through TrifCore.call', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.siteAccess', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("siteAccess.scope", JSON.stringify(["inbox.mail.google.com", []]))', ctx), '"mail.google.com"');
});

test('the sensitive list is desktop\'s (extension/agentsites.js), and matches as desktop\'s does', async () => {
  const desk = await import(pathToFileURL(path.join(__dirname, '..', '..', 'extension', 'agentsites.js')).href);
  const A = require(path.join(CORE, 'site-access.js'));
  assert.deepStrictEqual(A.list([]).map((x) => [x.pattern, x.why]), desk.SENSITIVE_DEFAULT.map((x) => [x[0], x[1]]));
  const hosts = ['mail.google.com', 'a.b.netbank.co.uk', 'bankofexample.com', 'x.bank', 'www.x.bank', 'chase.com', 'secure.chase.com', 'x.com', 'example.com',
    'shop.bank.example', 'banking-app.io', 'docs.google.com', 'my.gov.au', 'login.gov', 'web.whatsapp.com', 'news.bbc.co.uk'];
  for (const h of hosts) for (const [p] of desk.SENSITIVE_DEFAULT) assert.equal(A.patternMatches(p, h), desk.patternMatches(p, h), `${p} on ${h}`);
});

test('scope agrees with desktop\'s sensitiveHit (extension/lib.js) on the cases\' hosts', async () => {
  let lib;
  try { lib = await import(pathToFileURL(path.join(__dirname, '..', '..', 'extension', 'lib.js')).href); } catch { return; }
  if (typeof lib.sensitiveHit !== 'function') return;
  const A = require(path.join(CORE, 'site-access.js'));
  for (const [h, own] of cases.scope) {
    if (own.length) continue;
    const d = lib.sensitiveHit(h);
    const mine = A.hit(h, []);
    assert.equal(mine ? mine.scope : null, d ? d.scope : null, `sensitive scope of ${h}`);
  }
});
