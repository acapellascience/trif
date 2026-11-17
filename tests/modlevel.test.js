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

test('the row icons: one per power with what it does for this mod, then how noticeable; warnings turn powers amber', async () => {
  const { modIcons } = await load();
  // a free mod: the chip and infinity always (one icon, two pictures), then the eye where something was found;
  // a style mod: nothing
  const free = modIcons({ name: 'x' }, 'x.com');
  assert.deepEqual(free.map((i) => [i.key, i.tone, i.keys]), [['free', 'muted', ['cpu', 'infinity']]]);
  assert.equal(free[0].title, 'Runs as code, with no limits');
  assert.deepEqual(modIcons({ name: 'x', rules: { hide: ['a'] } }, 'x.com'), []);
  assert.deepEqual(modIcons({ risk: { tier: 1 } }, 'x.com').map((i) => [i.key, i.tone]), [['free', 'muted'], ['noticeable', 'muted']]);
  assert.deepEqual(modIcons({ risk: { tier: 2 } }, 'x.com').map((i) => [i.key, i.tone]), [['free', 'muted'], ['changes-requests', 'muted']]);
  const one = modIcons({ sandboxed: true, powers: ['site-data'], powerInfo: { facts: [{ power: 'site-data', fact: 'can see and filter what x.com sends this page' }], warnings: [] } }, 'x.com');
  assert.deepEqual(one.map((i) => [i.key, i.tone]), [['site-data', 'muted'], ['noticeable', 'muted']]);
  assert.equal(one[0].title, 'Filters what the site sends');
  assert.equal(one[1].title, 'Noticeable to the site');
  const warned = modIcons({ sandboxed: true, powers: ['read-drafts', 'sound'], powerInfo: { facts: [], warnings: ['together, it can play what you type'] } }, 'x.com');
  // (the warnings about powers together are in the code card's Details, not on the icons: Tim, 11-13)
  assert.deepEqual(warned.map((i) => [i.key, i.tone, i.title]), [['read-drafts', 'muted', 'Reads what you type'], ['sound', 'muted', 'Plays sounds']]);
  const migrate = modIcons({ sandboxed: true, powers: [], powerInfo: { facts: [{ power: 'migrate', fact: 'brings over its old settings from what this site keeps under: a (once)' }], warnings: [] } }, 'x.com');
  assert.deepEqual(migrate.map((i) => i.key), ['@migrate']);
});

test('every power TRIF knows, @migrate and both levels have a row icon (extension/icons.js)', async () => {
  const { ICONS } = await import('../extension/icons.js');
  const { NAMES } = require('../helper/lib/boxpowers');
  const names = Array.isArray(NAMES) ? NAMES : [...NAMES];
  const { ICON_LABELS } = await load();
  for (const p of [...names, '@migrate', 'noticeable', 'changes-requests']) {
    assert.ok(Array.isArray(ICONS[p]) && ICONS[p].length, `no icon for ${p}`);
    assert.ok(ICON_LABELS[p], `no hover words for ${p}`);
  }
});
