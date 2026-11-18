'use strict';
// Phone sync's core (helper/lib/phonelink/sync.js; docs/PHONE-SYNC.md sections 2-4): ids and their refusals,
// revisions, the phone's list, the three-way rule (every row, the first sync with no base), a conflict's sibling,
// and the base file. No network, no mods touched.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./fake-extension');
const S = require('../helper/lib/phonelink/sync');

const cleanups = [];
test.after(() => { for (const c of cleanups) c(); });

const r = (s) => S.rev(s);
const map = (o) => new Map(Object.entries(o));

test('ids: a phone mod id becomes a file in a phone twin, and nothing else', () => {
  assert.deepStrictEqual(S.parseId('example.com/hide-ads'), { id: 'example.com/hide-ads', site: 'example.com', name: 'hide-ads', folder: 'phone~example.com', file: 'hide-ads.js' });
  assert.strictEqual(S.parseId('m.example.co.uk/Big Text').folder, 'phone~m.example.co.uk');
  assert.strictEqual(S.parseId('all-sites/dark').folder, 'phone~all-sites');
  for (const bad of ['', 'example.com', '/x', 'example.com/', 'example.com/a/b', '../x/y', 'example.com/..', 'example.com/.hidden', 'example.com/_x',
    'Example.com/x', 'localhost/x', 'phone~example.com/x', 'example..com/x', '-a.com/x', '[::1]/x', 'a.com/x\\y', 'a.com/x:y',
    'a.com/x\n', 'a.com/x‮', 'a.com/ends.', 'a.com/' + 'n'.repeat(121), 'all-sites2/x', 'sites/x', 'example.com/a\0b', 42, null, {}]) {
    assert.throws(() => S.parseId(bad), (e) => e instanceof S.SyncError && e.code === 'bad-mod', JSON.stringify(bad));
  }
  assert.strictEqual(S.idOf('phone~example.com', 'hide-ads.js'), 'example.com/hide-ads');
  assert.strictEqual(S.idOf('example.com', 'hide-ads.js'), null, 'a desktop folder');
  assert.strictEqual(S.idOf('phone~example.com', 'hide-ads.css'), null);
  assert.strictEqual(S.idOf('phone~example.com', '_draft.js'), null);
  assert.strictEqual(S.idOf('all-sites', 'x.js'), null);
});

test('revisions: the bytes, as they are', () => {
  assert.strictEqual(r('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  assert.notStrictEqual(r('a\n'), r('a\r\n'));
  assert.strictEqual(r(Buffer.from('é')), r('é'));
});

test('the phone\'s list: bad rows skipped with why, capitals-only twins kept once, limits', () => {
  const { revs, skipped } = S.readManifest([
    { id: 'example.com/a', rev: r('a') },
    { id: '../etc/passwd', rev: r('x') },
    { id: 'example.com/b', rev: 'nope' },
    { id: 'example.com/A', rev: r('A') },
    null,
  ]);
  assert.deepStrictEqual([...revs.keys()], ['example.com/a']);
  assert.deepStrictEqual(skipped.map((s) => s.id), ['../etc/passwd', 'example.com/b', 'example.com/A', '']);
  assert.match(skipped[2].why, /capitals/);
  assert.throws(() => S.readManifest('x'), (e) => e.code === 'bad-request');
  assert.throws(() => S.readManifest(Array.from({ length: S.MAX_MODS + 1 }, (_, i) => ({ id: `a.com/m${i}`, rev: r(String(i)) }))), (e) => e.code === 'too-big');
});

test('the three-way rule: every row of section 4', () => {
  const [b, p, c] = [r('base'), r('phone'), r('computer')];
  const out = S.plan({
    phone: map({ 'a.com/same': b, 'a.com/both-same': p, 'a.com/computer-edit': b, 'a.com/computer-del': b, 'a.com/phone-edit': p, 'a.com/phone-new': p, 'a.com/edit-beats-cdel': p, 'a.com/conflict': p }),
    computer: map({ 'a.com/same': b, 'a.com/both-same': p, 'a.com/computer-edit': c, 'a.com/phone-edit': b, 'a.com/phone-del': b, 'a.com/computer-new': c, 'a.com/edit-beats-pdel': c, 'a.com/conflict': c }),
    base: { 'a.com/same': b, 'a.com/both-same': b, 'a.com/computer-edit': b, 'a.com/computer-del': b, 'a.com/phone-edit': b, 'a.com/phone-del': b, 'a.com/edit-beats-pdel': b, 'a.com/edit-beats-cdel': b, 'a.com/conflict': b, 'a.com/both-gone': b },
  });
  assert.deepStrictEqual(out.agreed, { 'a.com/both-same': p, 'a.com/same': b });
  assert.deepStrictEqual(out.gone, ['a.com/both-gone']);
  assert.deepStrictEqual(out.remove, ['a.com/computer-del']);
  assert.deepStrictEqual(out.trash, ['a.com/phone-del']);
  assert.deepStrictEqual(out.want, [{ id: 'a.com/conflict', conflict: true }, { id: 'a.com/edit-beats-cdel', back: true }, { id: 'a.com/phone-edit' }, { id: 'a.com/phone-new' }]);
  assert.deepStrictEqual(out.give, [
    { id: 'a.com/computer-edit', rev: c },
    { id: 'a.com/computer-new', rev: c },
    { id: 'a.com/conflict-from-computer', conflict: 'a.com/conflict' },
    { id: 'a.com/edit-beats-pdel', rev: c, back: true },
  ]);
  assert.deepStrictEqual(out.conflicts, [{ id: 'a.com/conflict', sibling: 'a.com/conflict-from-computer', rev: c }]);
});

test('the first sync (no base) joins the two sets: nothing is lost', () => {
  const out = S.plan({
    phone: map({ 'a.com/only-phone': r('1'), 'a.com/same': r('s'), 'a.com/apart': r('p') }),
    computer: map({ 'a.com/only-computer': r('2'), 'a.com/same': r('s'), 'a.com/apart': r('c') }),
  });
  assert.deepStrictEqual(out.want.map((w) => w.id), ['a.com/apart', 'a.com/only-phone']);
  assert.deepStrictEqual(out.give.map((g) => g.id), ['a.com/apart-from-computer', 'a.com/only-computer']);
  assert.deepStrictEqual(out.agreed, { 'a.com/same': r('s') });
  assert.deepStrictEqual([out.remove, out.trash], [[], []]);
});

test('left alone: a twin with a run working is later, a mod too big is skipped, and their base stays', () => {
  const out = S.plan({
    phone: map({ 'a.com/x': r('p'), 'a.com/big': r('b') }),
    computer: map({}),
    base: { 'a.com/x': r('old') },
    leave: new Map([['a.com/x', 'later'], ['a.com/big', 'too-big']]),
  });
  assert.deepStrictEqual(out.later, ['a.com/x']);
  assert.deepStrictEqual(out.skipped, [{ id: 'a.com/big', why: 'too-big' }]);
  for (const k of ['want', 'give', 'remove', 'trash', 'conflicts', 'gone']) assert.deepStrictEqual(out[k], [], k);
});

test('a conflict\'s sibling: a free name beside it, any case, and its @name says where it came from', () => {
  assert.strictEqual(S.siblingId('a.com/x', ['a.com/x']), 'a.com/x-from-computer');
  assert.strictEqual(S.siblingId('a.com/x', ['a.com/X-From-Computer']), 'a.com/x-from-computer-2');
  const long = S.siblingId(`a.com/${'n'.repeat(120)}`, []);
  assert.ok(S.parseId(long).name.length <= S.NAME_MAX);
  // (two conflicts whose siblings would collide get different ones)
  const out = S.plan({ phone: map({ 'a.com/x': r('p') }), computer: map({ 'a.com/x': r('c'), 'a.com/x-from-computer': r('old') }) });
  assert.strictEqual(out.conflicts[0].sibling, 'a.com/x-from-computer-2');

  const code = '// ==WebMod==\r\n// @name   Big text  \r\n// @match https://a.com/*\r\n// ==/WebMod==\r\n// @name not this\r\nx();\r\n';
  assert.strictEqual(S.renameHeader(code), code.replace('Big text  ', 'Big text (from your computer)  '));
  assert.strictEqual(S.renameHeader('// @name outside\nx()'), '// @name outside\nx()', 'no header: as it is');
  const noName = '// ==WebMod==\n// @match https://a.com/*\n// ==/WebMod==\n';
  assert.strictEqual(S.renameHeader(noName), noName);
});

test('the base: per phone, private, and nothing in it taken on trust', () => {
  const dir = tempDir('trif-sync-'); cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const phone = '0123456789abcdef';
  assert.deepStrictEqual(S.loadBase(dir, phone), {});
  S.saveBase(dir, phone, { 'a.com/x': r('x') }, 5);
  const file = S.basePath(dir, phone);
  assert.strictEqual(file, path.join(dir, 'phone-link', 'sync', `${phone}.json`));
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepStrictEqual(S.loadBase(dir, phone), { 'a.com/x': r('x') });
  fs.writeFileSync(file, JSON.stringify({ v: 1, base: { 'a.com/x': r('x'), '../y/z': r('y'), 'a.com/bad': 'short' } }));
  assert.deepStrictEqual(S.loadBase(dir, phone), { 'a.com/x': r('x') });
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(S.loadBase(dir, phone), {});
  assert.throws(() => S.basePath(dir, '../../x'), (e) => e.code === 'bad-request');
  assert.strictEqual(S.deleteBase(dir, phone), true);
  assert.strictEqual(fs.existsSync(file), false);
});

// ---- beside the text: the switches (D12) and the approval hint (D13)

const sw = (on, off = [], at = 0) => ({ on, off, at });

test('switches: what the wire carries, read strictly; a key without the time', () => {
  assert.deepStrictEqual(S.readSwitch({ on: true, off: ['b.com', 'a.com', 'a.com', 'Bad Site', 5], at: 12.7 }), { on: true, off: ['a.com', 'b.com'], at: 12 });
  assert.deepStrictEqual(S.readSwitch({ on: false }), { on: false, off: [], at: 0 });
  for (const bad of [null, {}, { on: 'yes' }, 'on', []]) assert.strictEqual(S.readSwitch(bad), null);
  assert.strictEqual(S.readSwitch({ on: true, at: -5 }).at, 0);
  assert.strictEqual(S.switchKey(sw(true, ['a.com'], 1)), S.switchKey(sw(true, ['a.com'], 99)));
  assert.notStrictEqual(S.switchKey(sw(true)), S.switchKey(sw(false)));
  assert.notStrictEqual(S.switchKey(sw(true)), S.switchKey(sw(true, ['a.com'])));
});

test('switches: the three-way rule, every case (section 4b), and an older side that can\'t say', () => {
  const on = sw(true, [], 100), off = sw(false, [], 200), offEarly = sw(false, [], 50), part = sw(true, ['m.a.com'], 300);
  const k = S.switchKey;
  const out = S.planSwitches({
    ids: ['a.com/same', 'a.com/phone-changed', 'a.com/computer-changed', 'a.com/both-later-phone', 'a.com/both-later-computer', 'a.com/both-same-time',
      'a.com/no-base-later-computer', 'a.com/new-on-phone', 'a.com/new-on-computer', 'a.com/old-app', 'a.com/old-extension', 'a.com/neither', 'a.com/site-switch'],
    phone: map({
      'a.com/same': on, 'a.com/phone-changed': off, 'a.com/computer-changed': on, 'a.com/both-later-phone': sw(false, [], 900), 'a.com/both-later-computer': sw(false, [], 100),
      'a.com/both-same-time': sw(false, [], 500), 'a.com/no-base-later-computer': offEarly, 'a.com/new-on-phone': null, 'a.com/new-on-computer': on,
      'a.com/old-extension': on, 'a.com/neither': null, 'a.com/site-switch': part,
    }),
    computer: map({
      'a.com/same': sw(true, [], 7), 'a.com/phone-changed': on, 'a.com/computer-changed': off, 'a.com/both-later-phone': sw(true, ['x.com'], 800), 'a.com/both-later-computer': sw(true, ['x.com'], 800),
      'a.com/both-same-time': sw(true, ['x.com'], 500), 'a.com/no-base-later-computer': on, 'a.com/new-on-phone': off, 'a.com/new-on-computer': null,
      'a.com/old-app': on, 'a.com/neither': null, 'a.com/site-switch': on,
    }),
    base: { 'a.com/same': k(on), 'a.com/phone-changed': k(on), 'a.com/computer-changed': k(on), 'a.com/both-later-phone': k(on), 'a.com/both-later-computer': k(on), 'a.com/both-same-time': k(on), 'a.com/site-switch': k(on) },
  });
  assert.deepStrictEqual(out.agreed, { 'a.com/same': k(on) }, 'the same switch: in sync, whatever the times');
  assert.deepStrictEqual(out.toComputer, [
    { id: 'a.com/both-later-phone', ...sw(false, [], 900) }, // (both changed: the phone's later)
    { id: 'a.com/both-same-time', ...sw(false, [], 500) }, // (the same time: the phone's)
    { id: 'a.com/new-on-computer', ...on }, // (D8 the other way: a mod new to the computer takes the phone's switch)
    { id: 'a.com/phone-changed', ...off }, // (only the phone changed: whatever the times)
    { id: 'a.com/site-switch', ...part }, // (a per-site switch is a change too)
  ]);
  assert.deepStrictEqual(out.toPhone, [
    { id: 'a.com/both-later-computer', ...sw(true, ['x.com'], 800) },
    { id: 'a.com/computer-changed', ...off },
    { id: 'a.com/new-on-phone', ...off }, // (D8: a mod new to the phone arrives with the computer's switch)
    { id: 'a.com/no-base-later-computer', ...on }, // (no base, as the first sync after an update: the later wins)
  ]);
  // (the same time and no base, as the first sync after an update: a fresh off (a new mod from outside, never
  // switched) yields to the other side; otherwise the phone's)
  const tie = S.planSwitches({
    ids: ['a.com/p-fresh', 'a.com/c-fresh', 'a.com/both-plain'],
    phone: map({ 'a.com/p-fresh': S.readSwitch({ on: false, fresh: true }), 'a.com/c-fresh': sw(true), 'a.com/both-plain': sw(false) }),
    computer: map({ 'a.com/p-fresh': sw(true), 'a.com/c-fresh': S.readSwitch({ on: false, fresh: true }), 'a.com/both-plain': sw(true) }),
  });
  assert.deepStrictEqual(tie.toPhone, [{ id: 'a.com/p-fresh', ...sw(true) }]);
  assert.deepStrictEqual(tie.toComputer, [{ id: 'a.com/both-plain', ...sw(false) }, { id: 'a.com/c-fresh', ...sw(true) }]);
  assert.strictEqual(S.readSwitch({ on: true, fresh: true }).fresh, undefined, 'only an off can be fresh');
  assert.strictEqual(S.readSwitch({ on: false, at: 5, fresh: true }).fresh, undefined, 'a switched one isn\'t');
  // (an app or an extension that sends no switches: those mods are left as they are on both sides)
  for (const id of ['a.com/old-app', 'a.com/old-extension', 'a.com/neither']) {
    assert.ok(![...out.toPhone, ...out.toComputer].some((x) => x.id === id) && !(id in out.agreed), id);
  }
});

test('the switches\' base: kept beside the files\' base, read strictly, and an older helper\'s file has none', () => {
  const dir = tempDir('trif-sync-'); cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const phone = '0123456789abcdef';
  S.saveBase(dir, phone, { 'a.com/x': r('x') }, 5);
  assert.deepStrictEqual(S.loadSwitchBase(dir, phone), {});
  S.saveBase(dir, phone, { 'a.com/x': r('x') }, 6, { 'a.com/x': 'on|', '../bad': 'on|', 'a.com/y': 'maybe' });
  assert.deepStrictEqual(S.loadSwitchBase(dir, phone), { 'a.com/x': 'on|' });
  // (saving the files' base alone keeps the switches' as they are; an older helper's loadBase reads its own part)
  S.saveBase(dir, phone, { 'a.com/x': r('x2') }, 7);
  assert.deepStrictEqual(S.loadSwitchBase(dir, phone), { 'a.com/x': 'on|' });
  assert.deepStrictEqual(S.loadBase(dir, phone), { 'a.com/x': r('x2') });
});

test('the approval hint: the very revision, and nothing beyond what was allowed there; one sync key for it all', () => {
  const rev = r('code');
  const hint = S.readHint({ rev, tier: 'boxed', powers: ['click', 'keys', 'click', 'BAD!'] });
  assert.deepStrictEqual(hint, { rev, tier: 'boxed', powers: ['click', 'keys'] });
  for (const bad of [null, { rev: 'short', tier: 'boxed' }, { rev, tier: 'super' }]) assert.strictEqual(S.readHint(bad), null);
  assert.strictEqual(S.hintFits(hint, { rev, tier: 'boxed', powers: ['click'] }), true, 'the same code, fewer powers');
  assert.strictEqual(S.hintFits(hint, { rev, tier: 'style', powers: [] }), true, 'a lower tier');
  assert.strictEqual(S.hintFits(hint, { rev: r('changed'), tier: 'boxed', powers: ['click'] }), false, 'changed code: the normal card');
  assert.strictEqual(S.hintFits(hint, { rev, tier: 'boxed', powers: ['click', 'go-to'] }), false, 'more powers: the normal card');
  assert.strictEqual(S.hintFits(hint, { rev, tier: 'free', powers: [] }), false, 'a higher tier: the normal card');
  assert.strictEqual(S.hintFits(null, { rev, tier: 'style' }), false);
  assert.strictEqual(S.syncKey('a.com/x'), 'a.com/x');
  assert.strictEqual(S.keyOfModId('phone~a.com/x'), 'a.com/x');
  assert.strictEqual(S.keyOfModId('a.com/x'), null, 'a desktop mod has no sync key');
  assert.strictEqual(S.modIdOfKey('a.com/x'), 'phone~a.com/x');
});
