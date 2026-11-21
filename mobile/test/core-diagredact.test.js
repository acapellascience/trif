'use strict';
// mobile/shared/core/diagnostics-redact.js (security batch 11-20: diagnostics without browsing history) against
// diagnostics-redact-cases.json, as a module and through the generated mobile/shared/gen/core.js as the app calls it
// (TrifCore.call("diagnosticsRedact.all", …)); and what must never get through, on made-up lines of every kind.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'diagnostics-redact-cases.json'), 'utf8'));

function run(R, where) {
  for (const [kind, text, want] of cases.lines) assert.equal(R.line(kind, text, cases.own), want, `${where} ${kind}: ${text}`);
  assert.deepStrictEqual(R.all(cases.lines.map((x) => [x[0], x[1]]), cases.own), cases.lines.map((x) => x[2]), `${where} all`);
}

test('core/diagnostics-redact.js gives the cases\' answers', () => {
  run(require(path.join(CORE, 'diagnostics-redact.js')), 'module');
});

test('gen/core.js: TrifCore.diagnosticsRedact, through TrifCore.call as the app calls it', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.diagnosticsRedact', ctx), 'gen');
  const got = JSON.parse(vm.runInContext(`TrifCore.call("diagnosticsRedact.all", ${JSON.stringify(JSON.stringify([[['icon', 'https://x.com/a?b']], []]))})`, ctx));
  assert.deepStrictEqual(got, ['https://x.com']);
});

test('nothing of a path, query, fragment, sensitive host, cookie name or mod log words gets through', () => {
  const R = require(path.join(CORE, 'diagnostics-redact.js'));
  const secret = 'zq7secretword';
  const hosts = ['example.com', 'en.wikipedia.org', 'www.youtube.com', 'news.bbc.co.uk'];
  const sensitive = ['mail.google.com', 'secure.chase.com', 'www.paypal.com', 'online.mybank.example'];
  const kinds = ['icon', 'link', 'chat', 'mods', 'fullscreen', 'hang', 'site access', 'pickup', 'quick ask'];
  for (const kind of kinds) {
    for (const h of hosts) {
      for (const tail of [`/${secret}`, `/a/${secret}/b`, `/?q=${secret}`, `/#${secret}`, `/p?x=1&y=${secret}#z`, `/${secret}.`]) {
        const out = R.line(kind, `went to https://${h}${tail} then http://${h}${tail}, (https://${h}${tail})`, ['mybank.example']);
        assert.ok(!out.includes(secret), `${kind}: ${out}`);
        assert.ok(out.includes(h), `${kind} keeps the site: ${out}`);
      }
    }
    for (const h of sensitive) {
      const out = R.line(kind, `on ${h} and https://${h}/inbox?id=${secret} and ${h}/mod-x`, ['mybank.example']);
      assert.ok(!out.includes(h.replace(/^www\./, '')) && !out.includes(secret), `${kind}: ${out}`);
      assert.ok(out.includes('a sensitive site'), out);
    }
  }
  // (cookies: totals only)
  const c = R.line('cookies', `launch: 9 cookies: ${secret}.com 4, x.com 5`, []);
  assert.ok(!c.includes(secret) && !c.includes('x.com'), c);
  const n = R.line('cookie names', `launch, x.com: ${secret} (.x.com, until 2027-01-01 10:00), b (.x.com, this run only)`, []);
  assert.ok(!n.includes(secret) && /2 cookie names/.test(n), n);
  const ch = R.line('cookie changes', `added ${secret} (.x.com, this run only), removed b (.x.com)`, []);
  assert.equal(ch, '1 added, 0 replaced, 1 removed');
  // (a mod's own log: never its words, never the page's path)
  const m = R.line('mod log', `x.com/feed on x.com/${secret}: warn: ${secret} in the page`, []);
  assert.ok(!m.includes(secret), m);
  // (ids: a conversation's, a tab's, a container's: the last 8 only)
  const id = '3f2a9c1e-1b2c-4d5e-8f90-1234567890ab';
  const i = R.line('pickup', `conversation ${id} of tab ${id.toUpperCase()}`, []);
  assert.ok(!i.includes('3f2a9c1e') && i.includes('…567890ab') && i.includes('…567890AB'), i);
  // (TRIF's own stand-ins keep everything)
  assert.equal(R.line('x', 'http://localhost:8377/chat.html?gpt&keep', []), 'http://localhost:8377/chat.html?gpt&keep');
  assert.equal(R.line('x', 'http://127.0.0.1:8378/feed.html#a', []), 'http://127.0.0.1:8378/feed.html#a');
});
