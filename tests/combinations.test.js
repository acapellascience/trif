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

test('the table covers every pair (210) and triple (1330) of the 21 powers, once each, in the menu\'s order', () => {
  assert.deepEqual(C.POWERS, bp.NAMES);
  const want = [];
  const P = C.POWERS;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    want.push(`${P[i]}+${P[j]}`);
    for (let k = j + 1; k < P.length; k++) want.push(`${P[i]}+${P[j]}+${P[k]}`);
  }
  const keys = Object.keys(C.COMBINATIONS);
  assert.equal(keys.filter((k) => k.split('+').length === 2).length, 210);
  assert.equal(keys.filter((k) => k.split('+').length === 3).length, 1330);
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
  // (the ways out; image-variants, site-storage and edit-uploads are reads as well, so they warn with the other
  // reads, as a way out of them)
  const OUTS = ['write-drafts', 'click', 'media', 'sound', 'edit-uploads', 'page-events', 'image-variants', 'preload', 'site-storage', 'block-events', 'embeds'];
  for (const r of C.READS) {
    for (const out of OUTS.filter((o) => o !== r && !(r === 'image-variants' && o === 'preload'))) assert.ok(warn(C.keyOf([r, out])), `${r}+${out} warns`);
    // (site-storage with go-to is an act pair, below: something left for a page's code, then the user taken there)
    for (const other of C.POWERS.filter((p) => !OUTS.includes(p) && p !== r && !(OUTS.includes(r) && C.READS.includes(p)) && !(r === 'site-storage' && p === 'go-to'))) assert.equal(warn(C.keyOf([r, other])), null, `${r}+${other}`);
  }
  assert.equal(warn('image-variants+preload'), null);
  assert.equal(warn('click+write-drafts'), 'post-for-you');
  assert.equal(warn('go-to+click'), 'go-and-click');
  // (0.3's acts: what posts or acts for you together)
  assert.equal(warn('block-events+click'), 'block-and-click');
  assert.equal(warn('page-events+write-drafts'), 'post-for-you');
  assert.equal(warn('click+edit-uploads'), 'post-for-you');
  assert.equal(warn('page-events+edit-uploads'), 'post-for-you');
  assert.equal(warn('go-to+page-events'), 'go-and-signal');
  assert.equal(warn('site-storage+page-events+write-drafts'), 'read-post-for-you');
  assert.equal(warn('local-fonts+click+edit-uploads'), 'read-post-for-you');
  assert.equal(warn('go-to+page-events+write-drafts'), 'go-post-for-you');
  // (the review's fixes, docs/COMBO-FIXES-STRINGS.md: F1 what it keeps in the site's storage; F4 the pictures
  // you attach as a read; F5 which of your actions the page sees; F6 a rewrite with an act; F8 which video;
  // F9 keeping your clicks and signalling in their place)
  for (const r of ['read-drafts', 'keys', 'site-data', 'page-data', 'local-fonts']) assert.equal(warn(C.keyOf([r, 'site-storage'])), 'read-into-storage', `${r}+site-storage`);
  for (const [k, w] of Object.entries({
    'media+edit-uploads': 'read-through-media', 'preload+edit-uploads': 'read-through-pictures', 'sound+edit-uploads': 'read-into-sound', 'write-drafts+edit-uploads': 'read-into-post',
    'embeds+edit-uploads': 'read-through-videos', 'block-events+edit-uploads': 'read-decides-blocks', 'keys+block-events': 'read-decides-blocks', 'site-data+embeds': 'read-through-videos',
    'rewrite-requests+click': 'click-and-rewrite', 'rewrite-requests+page-events': 'signal-and-rewrite', 'block-events+page-events': 'block-and-signal',
    'click+write-drafts+edit-uploads': 'read-post-for-you', 'page-events+write-drafts+edit-uploads': 'read-post-for-you',
  })) assert.equal(warn(k), w, k);
  // (and the other way: edit-uploads reading the very picture it posts is its pair's warning, not a triple's)
  assert.equal(warn('page-events+click+edit-uploads'), null);
  assert.match(C.COMBINATIONS['page-events+click+edit-uploads'], /^no more than its pairs/);
  assert.equal(warn('go-to+edit-uploads'), null);
  // (the conversion run's four: block-events with go-to; block-events with page-events (F9, above); go-to with
  // site-storage, warned as go-to with page-events is; sound across mods: the page-wide rules, below)
  assert.equal(warn('go-to+block-events'), 'block-and-go');
  assert.equal(warn('site-storage+go-to'), 'go-and-signal');
  assert.equal(warn('block-events+page-events'), 'block-and-signal');
  assert.deepEqual(C.POWERS.filter((o) => o !== 'go-to' && warn(C.keyOf(['go-to', o]))).sort(), ['block-events', 'click', 'page-events', 'site-storage']);
  // (what each 0.3 act warns with, and nothing else: a rewrite only with an act; an embed only with a read;
  // keeping events only with a read, click or page-events; site-storage with a read or a way out)
  const warnsWith = (p) => C.POWERS.filter((o) => o !== p && warn(C.keyOf([p, o]))).sort();
  assert.deepEqual(warnsWith('rewrite-requests'), ['click', 'page-events']);
  assert.deepEqual(warnsWith('embeds'), [...C.READS].sort());
  assert.deepEqual(warnsWith('block-events'), [...C.READS, 'click', 'page-events', 'go-to'].sort());
  assert.deepEqual(warnsWith('site-storage'), [...C.READS, ...OUTS, 'go-to'].filter((p) => p !== 'site-storage').filter((p, i, a) => a.indexOf(p) === i).sort());
  // (F10: go-to's reason says what the widened power takes)
  for (const r of ['read-drafts', 'keys', 'site-data', 'page-data', 'local-fonts', 'edit-uploads']) assert.match(C.COMBINATIONS[C.keyOf([r, 'go-to'])], /the header's, with the header's words in a query, or links the page shows/);
  assert.ok(!Object.values(C.COMBINATIONS).some((v) => typeof v === 'string' && v.includes('fixed paths, or links')));
  // (the twelve of 0.2 keep their table)
  assert.equal(C.COMBINATIONS['read-drafts+sound'].warn, 'read-into-sound');
  for (const [k, v] of Object.entries(C.COMBINATIONS)) {
    const p = k.split('+');
    if (p.length !== 3 || typeof v === 'object') continue;
    const pairWarns = [[p[0], p[1]], [p[0], p[2]], [p[1], p[2]]].some((x) => warn(C.keyOf(x)));
    assert.equal(/^no more than its pairs/.test(v), pairWarns, k);
  }
});

test('@migrate counts as site-storage for the combinations a hold lists (F7), but not toward "many powers"', () => {
  const keys = (m) => bp.powerNeeds({ site: 'x.com', ...m }).map((n) => n.key);
  assert.ok(keys({ powers: ['keys'], powerArgs: { migrate: ['local:old'] } }).includes('power:together:keys+site-storage'));
  assert.ok(!keys({ powers: ['keys'], powerArgs: {} }).some((k) => /together/.test(k)));
  assert.ok(keys({ powers: ['click'], powerArgs: { migrate: ['local:old'] } }).includes('power:together:site-storage+click'));
  assert.deepEqual(keys({ powers: ['controls'], powerArgs: { migrate: ['local:old'] } }).filter((k) => /together/.test(k)), []);
  // (three declared powers and @migrate: their lines, not the many-powers sentence)
  const three = bp.powerNeeds({ site: 'x.com', powers: ['keys', 'sound', 'controls'], powerArgs: { migrate: ['local:old'] } });
  assert.ok(!three.some((n) => /together:many/.test(n.key)));
  assert.ok(three.some((n) => n.key === 'power:together:keys+site-storage' && n.fact));
  // (the sandbox counts it so too: apiFor's combo)
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  assert.match(src, /self\.combo = new Set\(\[\.\.\.self\.powers, \.\.\.\(Array\.isArray\(self\.args\.migrate\) && self\.args\.migrate\.length \? \['site-storage'\] : \[\]\)\]\)/);
  assert.match(src, /for \(const p of self\.combo\) inPlay\.add\(p\)/);
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
  // the acts whose warned partners the sandbox can see on the page, and those enforced elsewhere (sound: not
  // enforced across mods, docs/SAFE-MODS.md says why; write-drafts as click's partner: once a draft was
  // written, clickOk; click with go-to: on go-to's side, and on the page go-to lands on, arrivedOk;
  // page-events beside a draft or a picture another mod changed, as click: signalOk, clickOk)
  // (a read that's also a way out (image-variants, site-storage, edit-uploads): as a read, on the side of the
  // act it's with)
  // (sound: only beside a mod it shares a `mods` channel with, soundOk; block-events with go-to, on go-to's side,
  // whichever form the block takes)
  const AS_READ = ['write-drafts', 'click', 'media', 'sound', 'page-events', 'preload', 'embeds', 'block-events'];
  const enforced = {
    'write-drafts': ['page-events'], click: ['write-drafts', 'go-to'], media: [], 'go-to': [],
    'page-events': ['write-drafts', 'go-to'], 'edit-uploads': AS_READ, 'image-variants': AS_READ.filter((p) => p !== 'preload'), preload: [],
    'site-storage': AS_READ, 'block-events': ['click', 'page-events', 'go-to'], embeds: [], sound: [],
  };
  assert.deepEqual(Object.keys(partners).sort(), Object.keys(enforced).sort());
  for (const [act, extra] of Object.entries(enforced)) {
    const fromTable = C.POWERS.filter((p) => p !== act && typeof C.COMBINATIONS[C.keyOf([act, p])] === 'object' && !extra.includes(p))
      .filter((p) => !(act === 'write-drafts' && p === 'click'));
    assert.deepEqual([...partners[act]].sort(), fromTable.sort(), act);
  }
  // (the checks are where the acts are: site-storage's writes, block-events' function form, an embed made and
  // clicked; edit-uploads as a read by the mods handed a picture; go-to's mark on the page it lands on)
  const count = (re) => (src.match(re) || []).length;
  assert.equal(count(/partnersOk\(self, 'site-storage'\)/g), 2);
  assert.equal(count(/partnersOk\(b\.api, 'block-events'\)/g), 1);
  assert.equal(count(/partnersOk\(self, 'embeds'\)/g), 2);
  assert.match(src, /if \(p === 'edit-uploads'\) \{ if \(uploadReaders\.size\)/);
  assert.match(src, /uploadReaders\.add\(u\.api\.mod\)/);
  assert.match(src, /arrivedOk\(api, 'click'/);
  assert.match(src, /arrivedOk\(api, 'page-events'/);
});

test('docs/SAFE-MODS.md\'s counts are the table\'s (F12)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SAFE-MODS.md'), 'utf8');
  const e = Object.entries(C.COMBINATIONS);
  const pairs = e.filter(([k, v]) => k.split('+').length === 2 && typeof v === 'object').length;
  const own = e.filter(([k, v]) => k.split('+').length === 3 && typeof v === 'object').length;
  const shown = e.filter(([, v]) => typeof v === 'string' && /^no more than its pairs/.test(v)).length;
  assert.ok(doc.includes(`Every pair (${C.PAIRS}) and\ntriple (${C.TRIPLES}) of the ${C.POWERS.length} powers`), 'the pairs and triples');
  assert.ok(doc.includes(`Counts: ${pairs} of ${C.PAIRS} pairs warn; ${own} of ${C.TRIPLES} triples have their own warning; ${shown} more show their pairs'.`), `Counts: ${pairs} of ${C.PAIRS} pairs warn; ${own} of ${C.TRIPLES} triples have their own warning; ${shown} more show their pairs'.`);
});

test('the page-wide rules at work (sandbox.js partnersOk, run here): each new rule refuses beside the other mod\'s power, and lets an act through when the acting mod asked for that power too or nothing in play makes the pair', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const from = src.indexOf('  const ACT_PARTNERS = {'), to = src.indexOf('  // go-to across a page load');
  assert.ok(from > 0 && to > from, 'ACT_PARTNERS to partnersOk in sandbox.js');
  const vm = require('vm');
  const page = () => vm.runInNewContext(`const fail = (why) => { throw new TypeError('TRIF sandbox: ' + why); }; const channels = new Map(), apis = new Map();\n${src.slice(from, to)}\n({ partnersOk, soundOk, inPlay, uploadReaders, channels, apis })`);
  const api = (mod, powers, migrate) => ({ mod, powers: new Set(powers), combo: new Set([...powers, ...(migrate ? ['site-storage'] : [])]) });
  // (act, the acting mod's powers, another mod's power in play, refused?)
  const cases = [
    // F1: site-storage's writes beside a read
    ['site-storage', ['site-storage'], 'keys', true], ['site-storage', ['site-storage', 'keys'], 'keys', false], ['site-storage', ['site-storage'], 'sound', false], ['site-storage', ['site-storage'], 'controls', false],
    ['site-storage', ['site-storage'], 'image-variants', true], ['click', ['click'], 'site-storage', true],
    // F5: block-events' function form beside a read
    ['block-events', ['block-events'], 'read-drafts', true], ['block-events', ['block-events', 'read-drafts'], 'read-drafts', false], ['block-events', ['block-events'], 'click', false],
    // F6: a click or a signal beside a rewrite
    ['click', ['click'], 'rewrite-requests', true], ['click', ['click', 'rewrite-requests'], 'rewrite-requests', false],
    ['page-events', ['page-events'], 'rewrite-requests', true], ['page-events', ['page-events', 'rewrite-requests'], 'rewrite-requests', false],
    // F8: an embed beside a read
    ['embeds', ['embeds'], 'page-data', true], ['embeds', ['embeds', 'page-data'], 'page-data', false], ['embeds', ['embeds'], 'click', false],
    // F9: a signal beside keeping the user's clicks
    ['page-events', ['page-events'], 'block-events', true], ['page-events', ['page-events', 'block-events'], 'block-events', false],
    // (the conversion run's: go-to beside keeping the user's clicks, or beside something left in the site's
    // storage; and site-storage's writes beside go-to)
    ['go-to', ['go-to'], 'block-events', true], ['go-to', ['go-to', 'block-events'], 'block-events', false],
    ['go-to', ['go-to'], 'site-storage', true], ['go-to', ['go-to', 'site-storage'], 'site-storage', false],
    ['site-storage', ['site-storage'], 'go-to', true], ['site-storage', ['site-storage', 'go-to'], 'go-to', false],
    // (and as before)
    ['media', ['media'], 'keys', true], ['media', ['media'], 'click', false],
  ];
  for (const [act, powers, other, refused] of cases) {
    const p = page();
    p.inPlay.add(other);
    for (const x of powers) p.inPlay.add(x);
    const run = () => p.partnersOk(api(`me`, powers), act);
    if (refused) assert.throws(run, new RegExp(`while another boxed mod here has the ${other} power`), `${act} with ${powers} beside ${other}`);
    else assert.doesNotThrow(run, `${act} with ${powers} beside ${other}`);
  }
  // F4: edit-uploads as a read, by the mods handed a picture, not by every mod with the power
  for (const act of ['write-drafts', 'click', 'media', 'page-events', 'image-variants', 'preload', 'site-storage', 'block-events', 'embeds']) {
    const p = page();
    p.inPlay.add('edit-uploads');
    assert.doesNotThrow(() => p.partnersOk(api('me', [act]), act), `${act} beside an upload editor that was handed nothing`);
    p.uploadReaders.add('editor');
    assert.throws(() => p.partnersOk(api('me', [act]), act), /since another boxed mod here was handed a picture the user attached \(edit-uploads\)/, `${act} beside a mod handed a picture`);
    assert.doesNotThrow(() => p.partnersOk(api('me', [act, 'edit-uploads']), act), `${act} with edit-uploads itself`);
  }
  { const p = page(); p.uploadReaders.add('editor'); assert.doesNotThrow(() => p.partnersOk(api('me', ['edit-uploads']), 'edit-uploads')); assert.doesNotThrow(() => p.partnersOk(api('me', ['go-to']), 'go-to')); }
  // F7: @migrate counts as site-storage, for its own acts and beside others'
  { const p = page(); p.inPlay.add('site-storage'); assert.throws(() => p.partnersOk(api('me', ['click']), 'click'), /site-storage power/); assert.doesNotThrow(() => p.partnersOk(api('me', ['click'], true), 'click')); }
  // sound across mods: refused beside a reading mod it shares a `mods` channel with, not beside one it doesn't
  {
    const p = page();
    const reg = (id, powers, migrate) => { const a = api(id, powers, migrate); p.apis.set(id, a); for (const x of a.combo) p.inPlay.add(x); return a; };
    const snd = reg('snd', ['sound', 'mods']); reg('reader', ['keys', 'mods']); reg('quiet', ['read-drafts']);
    assert.doesNotThrow(() => p.soundOk(snd), 'beside reads, no channel');
    p.channels.set('c', new Set([{ mod: 'snd' }, { mod: 'quiet' }]));
    assert.throws(() => p.soundOk(snd), /playing sound is off on this page while it shares a channel \(mods\) with another boxed mod here that has the read-drafts power/);
    p.channels.set('c', new Set([{ mod: 'snd' }]));
    p.channels.set('d', new Set([{ mod: 'reader' }]));
    assert.doesNotThrow(() => p.soundOk(snd), 'each on a channel of its own');
    p.channels.get('d').add({ mod: 'snd' });
    assert.throws(() => p.soundOk(snd), /the keys power/);
    assert.doesNotThrow(() => p.soundOk(reg('snd2', ['sound', 'mods', 'keys'])), 'a sound mod that has the read itself');
    const m = page(); m.apis.set('snd', api('snd', ['sound'])); m.apis.set('old', api('old', ['mods'], true)); m.channels.set('c', new Set([{ mod: 'snd' }, { mod: 'old' }]));
    assert.throws(() => m.soundOk(m.apis.get('snd')), /site-storage power/, '@migrate counts as site-storage');
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8'), /const live = \(\) => \{ if \(!offline\) soundOk\(self\); \};/);
});
