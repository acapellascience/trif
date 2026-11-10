'use strict';
// The power combinations table (helper/lib/combinations.js): every pair and triple of the menu, each with a
// warning or a reason; docs/POWER-COMBINATIONS.md written out from it; the sandbox's page-wide rules in step
// with it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../helper/lib/combinations');
const bp = require('../helper/lib/boxpowers');

test('the table covers every pair (66) and triple (220) of the twelve powers, once each, in the menu\'s order', () => {
  assert.deepEqual(C.POWERS, bp.NAMES);
  const want = [];
  const P = C.POWERS;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    want.push(`${P[i]}+${P[j]}`);
    for (let k = j + 1; k < P.length; k++) want.push(`${P[i]}+${P[j]}+${P[k]}`);
  }
  const keys = Object.keys(C.COMBINATIONS);
  assert.equal(keys.filter((k) => k.split('+').length === 2).length, 66);
  assert.equal(keys.filter((k) => k.split('+').length === 3).length, 220);
  assert.deepEqual([...keys].sort(), [...want].sort());
  for (const [k, v] of Object.entries(C.COMBINATIONS)) {
    if (typeof v === 'object') assert.ok(C.WARNINGS[v.warn], `${k}: ${v.warn} isn't a warning`);
    else assert.ok(typeof v === 'string' && v.length > 20, `${k}: a reason, in words`);
  }
  // (every warning is used; the ranks are 1..n)
  assert.deepEqual(Object.keys(C.WARNINGS).filter((w) => !Object.values(C.COMBINATIONS).some((v) => v.warn === w)), []);
  assert.deepEqual(Object.values(C.WARNINGS).map((w) => w.rank).sort((a, b) => a - b), Object.keys(C.WARNINGS).map((_, i) => i + 1));
});

test('the table\'s reasoning: a read with any way out warns; acts that combine warn; a triple says "no more than its pairs" only when a pair warns', () => {
  const warn = (k) => (typeof C.COMBINATIONS[k] === 'object' ? C.COMBINATIONS[k].warn : null);
  for (const r of C.READS) {
    for (const out of ['write-drafts', 'click', 'media', 'sound']) assert.ok(warn(C.keyOf([r, out])), `${r}+${out} warns`);
    for (const other of C.POWERS.filter((p) => !['write-drafts', 'click', 'media', 'sound'].includes(p) && p !== r)) assert.equal(warn(C.keyOf([r, other])), null, `${r}+${other}`);
  }
  assert.equal(warn('click+write-drafts'), 'post-for-you');
  assert.equal(warn('go-to+click'), 'go-and-click');
  for (const [k, v] of Object.entries(C.COMBINATIONS)) {
    const p = k.split('+');
    if (p.length !== 3 || typeof v === 'object') continue;
    const pairWarns = [[p[0], p[1]], [p[0], p[2]], [p[1], p[2]]].some((x) => warn(C.keyOf(x)));
    assert.equal(/^no more than its pairs/.test(v), pairWarns, k);
  }
});

test('docs/POWER-COMBINATIONS.md is the table written out', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'POWER-COMBINATIONS.md'), 'utf8');
  assert.equal(doc, C.toMarkdown(), 'regenerate it: node -e "process.stdout.write(require(\'./helper/lib/combinations\').toMarkdown())" > docs/POWER-COMBINATIONS.md');
  for (const k of Object.keys(C.COMBINATIONS)) assert.ok(doc.includes(`| ${k.split('+').map((x) => `\`${x}\``).join(' + ')} |`), k);
});

test('the sandbox\'s page-wide rules (ACT_PARTNERS) follow the table: an act is refused beside another mod\'s power that makes a warned pair with it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const m = /const ACT_PARTNERS = (\{[^;]+\});/.exec(src);
  assert.ok(m, 'ACT_PARTNERS in sandbox.js');
  const partners = JSON.parse(m[1].replace(/'/g, '"').replace(/([{,]\s*)([\w-]+):/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1'));
  // the acts whose warned partners the sandbox can see on the page (sound: not enforced across mods,
  // docs/SAFE-MODS.md says why; write-drafts as click's partner: once a draft was written, clickOk; click with
  // go-to: on go-to's side)
  const enforced = { 'write-drafts': [], click: ['write-drafts', 'go-to'], media: [], 'go-to': [] };
  for (const [act, extra] of Object.entries(enforced)) {
    const fromTable = C.POWERS.filter((p) => p !== act && typeof C.COMBINATIONS[C.keyOf([act, p])] === 'object' && !extra.includes(p))
      .filter((p) => !(act === 'write-drafts' && p === 'click'));
    assert.deepEqual([...partners[act]].sort(), fromTable.sort(), act);
  }
});
