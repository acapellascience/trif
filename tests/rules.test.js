'use strict';
// helper/lib/rules.js: rules mods are data, run by TRIF's own code; nothing in them loads, sends or runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const rules = require('../helper/lib/rules');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld } = require('../helper/lib/held');
const { modSnapshot } = require('../helper/lib/runs');

const ok = (spec) => rules.checkRules(spec);
const bad = (spec, re) => assert.throws(() => rules.checkRules(spec), re);

test('rules: what\'s allowed', () => {
  const s = ok({
    css: 'a { color: red; background: url(data:image/png;base64,AA) } b::after { content: "url(https://x.example)" }',
    hide: ['[data-testid=placementTracking]', 'aside a[href*="promo"]'],
    replace: [{ in: 'article', find: 'Grok', with: 'the robot' }, { find: 'x\\d+', regex: true, caseless: true, with: '' }],
    filter: [{ items: 'article', hideIfText: 'Promoted' }, { items: 'li', hideIfRegex: 'sponsored|ad' }, { items: 'li', hideIfHas: '.badge' }],
  });
  assert.equal(s.hide.length, 2);
  assert.equal(s.replace[0].in, 'article');
  assert.equal(s.replace[1].in, 'body');
});

test('rules: nothing that loads from an address, closes a rule, hangs the page, or isn\'t a rule', () => {
  bad({ css: 'a { background: url(https://evil.example/x) }' }, /only data:/);
  bad({ css: 'a { background: URL( "https://evil.example/x") }' }, /only data:/);
  bad({ css: 'a { --x: url(//evil.example) }' }, /only data:/);
  bad({ css: '@import "https://evil.example/x.css";' }, /@import/);
  bad({ css: 'a { background: image-set("https://evil.example/x.png" 1x) }' }, /image-set/);
  bad({ css: 'a { background: u\\72l(https://evil.example) }' }, /backslash/);
  bad({ css: 'a { behavior: url(x.htc) }' }, /runs code|only data/);
  bad({ css: 'a { color: red' + '/* never closed' }, /unclosed comment/);
  bad({ hide: ['a } body { background: url(https://evil.example)'] }, /can't be in a selector/);
  bad({ hide: ['a { x }'] }, /can't be in a selector/);
  bad({ filter: [{ items: 'li', hideIfRegex: '(a+)+$' }] }, /nested repeats/);
  bad({ filter: [{ items: 'li' }] }, /exactly one of/);
  bad({ replace: [{ find: '', with: 'x' }] }, /find must be text/);
  bad({ script: 'fetch(1)' }, /unknown rule "script"/);
  bad({ replace: [{ find: 'a', with: 'b', onmatch: 'x' }] }, /unknown key "onmatch"/);
});

test('rules: the code is TRIF\'s, with the rules as data, and it compiles', () => {
  const code = rules.rulesCode(ok({ hide: ['.ad'], css: 'a { color: red }' }), 'x.com/a');
  assert.match(code, /TRIF rules mod "x\.com\/a"/);
  assert.doesNotThrow(() => new vm.Script(code));
  // whatever the strings, they only ever appear inside the JSON data
  const sneaky = rules.rulesCode(ok({ replace: [{ find: 'a', with: '"); fetch("https://evil.example"); ("' }] }), 'x.com/b');
  assert.doesNotThrow(() => new vm.Script(sneaky));
  assert.equal(sneaky.split('fetch(').length, 2, 'only inside the data, as text');
});

function makeWs() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-rules-'));
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir };
}
const header = '// ==WebMod==\n// @name Hide promos\n// @match https://x.com/*\n// @rules\n// ==/WebMod==\n';

test('rules mods in the scanner: TRIF\'s code runs, a bad one is an error (not sent), and one never waits, whoever wrote it', () => {
  const ws = makeWs();
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'promos.js'), header + '{ "hide": [".promo"], "filter": [{ "items": "article", "hideIfText": "Promoted" }] }\n');
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'bad.js'), header + '{ "css": "a { background: url(https://evil.example) }" }\n');
  const { mods, problems } = scanMods(ws.modsDir);
  assert.deepEqual(mods.map((m) => m.id), ['x.com/promos']);
  assert.equal(mods[0].rules, true);
  assert.match(mods[0].code, /TRIF rules mod/);
  assert.match(mods[0].text, /"hide"/);
  assert.match(problems.find((p) => p.id === 'x.com/bad').error, /only data:/);
  // written by a side-panel run: not held (it can't do anything that would need the user's OK)
  updateHeld(ws, [], []); // (first sync: nothing yet)
  const before = modSnapshot(ws.modsDir, ws.home);
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'promos.js'), header + '{ "hide": [".promo", ".ad"] }\n');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]), {});
});
