'use strict';
// How noticeable a mod is, and its row's chip (extension/modlevel.js).
const test = require('node:test');
const assert = require('node:assert');
const load = () => import('../extension/modlevel.js');

test('a boxed mod\'s level comes from its powers, never its header; unknown powers count for nothing', async () => {
  const { modLevel } = await load();
  assert.equal(modLevel({ sandboxed: true, powers: ['sound'] }), 0);
  assert.equal(modLevel({ sandboxed: true, powers: ['sound', 'site-data'] }), 1);
  assert.equal(modLevel({ sandboxed: true, powers: ['block-events'] }), 1);
  assert.equal(modLevel({ sandboxed: true, powers: ['site-data', 'rewrite-requests'] }), 2);
  assert.equal(modLevel({ sandboxed: true, powers: ['sound'], risk: { tier: 2 } }), 0, 'its header doesn\'t count');
  assert.equal(modLevel({ sandboxed: true, powers: ['a-power-from-next-year', 'constructor'] }), 0);
  assert.equal(modLevel({ sandboxed: true }), 0);
});

test('a free or style mod\'s level is its @risk, raised (never lowered) by what TRIF read', async () => {
  const { modLevel } = await load();
  assert.equal(modLevel({}), 0);
  assert.equal(modLevel({ risk: { tier: 1 } }), 1);
  assert.equal(modLevel({ risk: { tier: 2 }, found: [] }), 2);
  assert.equal(modLevel({ risk: { tier: 0 }, found: ['sends'] }), 1);
  assert.equal(modLevel({ risk: { tier: 2 }, found: ['sends'] }), 2);
  assert.equal(modLevel({ found: ['something-new:x', 'hidden'] }), 0);
});

test('the chip: words, colour by the highest concern, and the hover', async () => {
  const { modChip } = await load();
  assert.equal(modChip({ name: 'x' }, 'x.com'), null);
  assert.equal(modChip({ sandboxed: true, powers: [] }, 'x.com'), null);
  assert.deepEqual((({ text, tone }) => [text, tone])(modChip({ risk: { tier: 1 } }, 'x.com')), ['noticeable', 'muted']);
  assert.deepEqual((({ text, tone }) => [text, tone])(modChip({ risk: { tier: 2 } }, 'x.com')), ['changes requests', 'amber']);
  assert.deepEqual((({ text, tone }) => [text, tone])(modChip({ sandboxed: true, powers: ['sound', 'controls'] }, 'x.com')), ['2 powers', 'green']);
  const one = modChip({ sandboxed: true, powers: ['site-data'], powerInfo: { facts: [{ power: 'site-data', fact: 'can see and filter what x.com sends this page' }], warnings: [] } }, 'x.com');
  assert.deepEqual([one.text, one.tone], ['1 power · noticeable', 'green']);
  assert.match(one.title, /^site-data can see and filter what x\.com sends this page\nNoticeable: x\.com could tell something's different \(what it sends isn't all shown\)\.$/);
  const warned = modChip({ sandboxed: true, powers: ['read-drafts', 'sound'], powerInfo: { facts: [], warnings: ['together, it can play what you type'] } }, 'x.com');
  assert.deepEqual([warned.text, warned.tone], ['2 powers', 'amber']);
  assert.match(warned.title, /Together, it can play what you type/);
  assert.deepEqual((({ text, tone }) => [text, tone])(modChip({ sandboxed: true, powers: ['a', 'b', 'c', 'rewrite-requests'] }, 'x.com')), ['4 powers · changes requests', 'amber']);
  // a power with no words yet: its name
  assert.equal(modChip({ sandboxed: true, powers: ['a-power-from-next-year'] }, 'x.com').title, 'a-power-from-next-year');
});

test('the helper gives the panel each power\'s words and the combination warnings', () => {
  const { powerInfo } = require('../helper/lib/boxpowers');
  const info = powerInfo({ site: 'x.com', powers: ['read-drafts', 'sound'] });
  assert.deepEqual(info.facts.map((f) => f.power), ['read-drafts', 'sound']);
  assert.match(info.facts[0].fact, /read what you type/);
  assert.ok(info.warnings.length >= 1 && /^together, it /.test(info.warnings[0]), JSON.stringify(info.warnings));
  assert.deepEqual(powerInfo({ site: 'x.com', powers: ['sound'] }).warnings, []);
});
