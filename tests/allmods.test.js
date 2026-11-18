'use strict';
// The All mods page without a browser: its model (extension/allmods-model.js: entries, grouping, search, filters,
// tags, times), and what it asks the helper for (helper lib/trash.js trashList, lib/share.js exportMods, and the
// host's mod.trash, mod.exportMany and the mods' changedAt). The page itself, in a browser: allmods-browser.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, writeMod, FakeExtension } = require('./fake-extension');
const { deleteMod, trashList } = require('../helper/lib/trash');
const share = require('../helper/lib/share');
const { scanMods } = require('../helper/lib/mods');

const load = () => import('../extension/allmods-model.js');

const MODS = [
  { id: 'x.com/hide-trends', name: 'Hide Trends', description: 'No trending box', rules: true },
  { id: 'x.com/mute-words', name: 'Mute Words', description: 'Hides posts with words you pick', sandboxed: true, broken: [{ fp: 'a', message: 'oops' }] },
  { id: 'all-sites/readable', name: 'Readable Width', description: 'Comfortable text', rules: true },
  { id: 'google.com/plain', name: 'Plain Results', description: 'Ten blue links', rules: true, newOff: 'update', changedAt: 1000 },
  { id: 'google.com/keys', name: 'search keys', description: 'Arrow keys', sandboxed: true, held: { by: 'outside', hash: 'h' } },
  { id: 'reddit.com/old', name: 'Old Layout', description: 'Compact posts', rules: true, pending: { by: 'agent', hash: 'p' } },
  { id: 'reddit.com/cj', name: 'Clicky', description: '', sandboxed: true, broken: [{ fp: 'b', message: 'stopped', clickjack: true }] },
  { id: 'reddit.com/quiet', name: 'Quiet', description: '', broken: [{ fp: 'c', message: 'nothing', quiet: true }], update: { version: '3' } },
  { id: 'phone~x.com/thumb', name: 'Thumb Nav', description: 'Tabs within reach', rules: true },
  { id: 'Amazon.com/simple', name: 'Simple', description: '', rules: true },
];
const STATUS = { sitesOn: ['x.com', 'google.com', 'reddit.com'], blockedSites: ['reddit.com'], access: { all: true, origins: [] }, mods: MODS };

test('entries: tier, on (a held mod isn\'t), waiting, errors, clickjack, may be broken, updated, update, phone, every site', async () => {
  const M = await load();
  const e = Object.fromEntries(M.entriesOf(MODS, { disabled: { 'google.com/plain': true, 'google.com/keys': false }, offSites: { 'all-sites/readable': ['x.com'] } }).map((x) => [x.id, x]));
  assert.equal(e['x.com/hide-trends'].tier, 'style');
  assert.equal(e['x.com/mute-words'].tier, 'boxed');
  assert.equal(e['reddit.com/quiet'].tier, 'free');
  assert.equal(e['google.com/keys'].on, false, 'held: not running, whatever its switch');
  assert.equal(e['google.com/keys'].switchOn, true);
  assert.equal(e['google.com/plain'].on, false);
  assert.equal(e['x.com/mute-words'].errors, 1);
  assert.equal(e['reddit.com/cj'].clickjack, true);
  assert.equal(e['reddit.com/quiet'].quiet, true);
  assert.equal(e['google.com/plain'].updated, true);
  assert.equal(e['reddit.com/quiet'].update, true);
  assert.equal(e['reddit.com/old'].pending, true);
  assert.equal(e['reddit.com/old'].waiting, true);
  assert.equal(e['phone~x.com/thumb'].phone, true);
  assert.equal(e['phone~x.com/thumb'].site, 'x.com');
  assert.equal(e['all-sites/readable'].every, true);
  assert.deepEqual(e['all-sites/readable'].offOn, ['x.com']);
  assert.equal(e['google.com/plain'].changedAt, 1000);
  assert.equal(e['x.com/hide-trends'].changedAt, null);
  assert.equal(M.entriesOf([{ id: 'no-slash' }, null]).length, 0);
});

test('groups: every site first, then sites A to Z (any case), mods by name; phone mods in a section of their own', async () => {
  const M = await load();
  const entries = M.entriesOf(MODS);
  const sections = M.groupEntries(entries, { stateOf: (s) => M.siteStateOf(s, STATUS) });
  assert.deepEqual(sections.map((s) => s.key), ['desktop', 'phone']);
  assert.deepEqual(sections[0].groups.map((g) => g.site), ['all-sites', 'Amazon.com', 'google.com', 'reddit.com', 'x.com']);
  assert.deepEqual(sections[1].groups.map((g) => g.key), ['phone~x.com']);
  assert.deepEqual(sections[0].groups.find((g) => g.site === 'google.com').entries.map((e) => e.name), ['Plain Results', 'search keys']);
  assert.deepEqual(Object.fromEntries(sections[0].groups.map((g) => [g.site, g.state])), { 'all-sites': null, 'Amazon.com': 'off', 'google.com': 'on', 'reddit.com': 'blocked', 'x.com': 'on' });
  // (no phone mods: no phone section)
  assert.deepEqual(M.groupEntries(entries.filter((e) => !e.phone)).map((s) => s.key), ['desktop']);
  // (a site without the browser's access)
  assert.equal(M.siteStateOf('x.com', { ...STATUS, access: { all: false, origins: [] } }), 'disconnected');
  assert.equal(M.siteStateOf('all-sites', STATUS), null);
  // (a sensitive host's own site)
  assert.equal(M.siteStateOf('mail.google.com', { ...STATUS, sitesOn: ['mail.google.com'] }, (s) => s), 'on');
});

test('search: every word in the name, description, site, its name or id; or the code (mods.search\'s ids)', async () => {
  const M = await load();
  const e = M.entriesOf(MODS);
  const hit = (q, opts) => e.filter((x) => M.matchesSearch(x, q, opts)).map((x) => x.id);
  assert.deepEqual(hit('trends'), ['x.com/hide-trends']);
  assert.deepEqual(hit('HIDES posts'), ['x.com/mute-words']);
  assert.deepEqual(hit('reddit.com'), ['reddit.com/old', 'reddit.com/cj', 'reddit.com/quiet']);
  assert.deepEqual(hit('twitter', { siteName: (s) => (s === 'x.com' ? 'X (Twitter)' : '') }), ['x.com/hide-trends', 'x.com/mute-words', 'phone~x.com/thumb']);
  assert.deepEqual(hit('trends compact'), [], 'every word');
  assert.deepEqual(hit('posts compact'), ['reddit.com/old']);
  assert.deepEqual(hit('fetch(', { codeIds: new Set(['reddit.com/cj']) }), ['reddit.com/cj']);
  assert.equal(hit('').length, MODS.length);
  assert.equal(hit('   ').length, MODS.length);
  // mods.search: in a style mod's rules as written, any other's code, any case
  assert.deepEqual(M.modsMatching([{ id: 'a/x', code: 'const FETCH = 1' }, { id: 'a/y', rules: true, text: '{"css": "fetch"}', code: 'nothing' }, { id: 'a/z', code: 'other' }], 'Fetch'), ['a/x', 'a/y']);
  assert.deepEqual(M.modsMatching([{ id: 'a/x', code: 'x' }], '  '), []);
});

test('filters: on or off, tier, waiting, errors, site where TRIF is off; counts; all of them must hold', async () => {
  const M = await load();
  const sections = M.groupEntries(M.entriesOf(MODS, { disabled: { 'google.com/plain': true } }), { stateOf: (s) => M.siteStateOf(s, STATUS) });
  const ids = (filters, query = '') => M.visibleSections(sections, { filters, query }).sections.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id))).sort();
  assert.deepEqual(ids({ state: 'off' }), ['google.com/keys', 'google.com/plain']);
  assert.deepEqual(ids({ tier: 'boxed' }), ['google.com/keys', 'reddit.com/cj', 'x.com/mute-words']);
  assert.deepEqual(ids({ waiting: true }), ['google.com/keys', 'reddit.com/old']);
  assert.deepEqual(ids({ errors: true }), ['reddit.com/cj', 'reddit.com/quiet', 'x.com/mute-words']);
  assert.deepEqual(ids({ siteOff: true }), ['Amazon.com/simple', 'reddit.com/cj', 'reddit.com/old', 'reddit.com/quiet']);
  assert.deepEqual(ids({ siteOff: true, tier: 'style' }), ['Amazon.com/simple', 'reddit.com/old']);
  assert.deepEqual(ids({ errors: true }, 'clicky'), ['reddit.com/cj']);
  const v = M.visibleSections(sections, { filters: { waiting: true } });
  assert.equal(v.shown, 2);
  assert.equal(v.total, MODS.length);
  assert.deepEqual(v.sections.map((s) => s.key), ['desktop'], 'a section with nothing left goes');
  assert.deepEqual(M.filterCounts(sections), { on: 8, off: 2, style: 6, boxed: 3, free: 1, waiting: 2, errors: 3, siteOff: 4 });
  assert.deepEqual(M.normalizeFilters({ state: 'maybe', tier: 'huge', waiting: 'yes', errors: true }), { state: 'all', tier: 'all', waiting: false, errors: true, siteOff: false });
  assert.equal(M.filterCount({ state: 'on', errors: true }), 2);
  assert.equal(M.filterCount(M.NO_FILTERS), 0);
});

test('a row\'s tags, the panel\'s words, most urgent first; when it changed; a site\'s address', async () => {
  const M = await load();
  const tags = Object.fromEntries(M.entriesOf(MODS, { disabled: { 'google.com/plain': true } }).map((e) => [e.id, M.statusTags(e).map((t) => t.text)]));
  assert.deepEqual(tags['google.com/keys'], ['waiting for your OK']);
  assert.deepEqual(tags['reddit.com/old'], ['change waiting for your OK']);
  assert.deepEqual(tags['x.com/mute-words'], ['error']);
  assert.deepEqual(tags['reddit.com/cj'], ['stopped a click']);
  assert.deepEqual(tags['reddit.com/quiet'], ['may be broken', 'update available']);
  assert.deepEqual(tags['google.com/plain'], ['updated']);
  assert.deepEqual(tags['x.com/hide-trends'], []);
  const two = M.statusTags({ errors: 2 }).map((t) => t.text);
  assert.deepEqual(two, ['2 errors']);
  const now = Date.UTC(2026, 10, 18, 12);
  assert.equal(M.changedWords(now - 10 * 1000, now), 'just now');
  assert.equal(M.changedWords(now - 5 * 60 * 1000, now), '5 min ago');
  assert.equal(M.changedWords(now - 3 * 3600 * 1000, now), '3 h ago');
  assert.equal(M.changedWords(now - 30 * 3600 * 1000, now), 'yesterday');
  assert.equal(M.changedWords(now - 4 * 86400 * 1000, now), '4 days ago');
  assert.equal(M.changedWords(Date.UTC(2026, 9, 12, 12), now), '12 Oct');
  assert.equal(M.changedWords(Date.UTC(2025, 9, 12, 12), now), '12 Oct 2025');
  assert.equal(M.changedWords(null, now), '');
  assert.equal(M.siteUrl('x.com'), 'https://x.com/');
  assert.equal(M.siteUrl('localhost'), 'http://localhost/');
  assert.equal(M.siteUrl('127.0.0.1'), 'http://127.0.0.1/');
  assert.equal(M.siteUrl('all-sites'), null);
});

const MOD = (name, description = '') => `// ==WebMod==\n// @name ${name}\n${description ? `// @description ${description}\n` : ''}// ==/WebMod==\nconsole.log(1);\n`;

test('trashList: each mod\'s newest copy, newest first, with its name and description, and whether it\'s back in its folder', () => {
  const home = tempDir();
  const ws = { home, modsDir: path.join(home, 'sites') };
  writeMod(home, 'x.com', 'quiet.js', MOD('Quiet', 'Old words'));
  deleteMod(ws, 'x.com/quiet', { now: Date.UTC(2026, 10, 1) });
  writeMod(home, 'x.com', 'quiet.js', MOD('Quiet', 'New words'));
  deleteMod(ws, 'x.com/quiet', { now: Date.UTC(2026, 10, 2) });
  writeMod(home, 'all-sites', 'wide.js', MOD('Wide'));
  deleteMod(ws, 'all-sites/wide', { now: Date.UTC(2026, 10, 3) });
  writeMod(home, 'all-sites', 'wide.js', MOD('Wide again'));
  fs.mkdirSync(path.join(home, 'trash', 'y.com'), { recursive: true });
  fs.writeFileSync(path.join(home, 'trash', 'y.com', 'bare@20261101T000000000Z.js'), 'no header at all');
  assert.deepEqual(trashList(ws), [
    { id: 'all-sites/wide', deletedAt: Date.UTC(2026, 10, 3), name: 'Wide', description: '', exists: true },
    { id: 'x.com/quiet', deletedAt: Date.UTC(2026, 10, 2), name: 'Quiet', description: 'New words', exists: false },
    { id: 'y.com/bare', deletedAt: Date.UTC(2026, 10, 1), name: 'bare', description: '', exists: false },
  ]);
  assert.equal(trashList(ws, { limit: 1 }).length, 1);
  assert.deepEqual(trashList({ home: tempDir(), modsDir: '/nowhere' }), []);
});

test('exportMods: any sites\' mods into one "TRIF mods" folder as <site>-<mod>.js; unknown ids refused', () => {
  const home = tempDir();
  const ws = { home, modsDir: path.join(home, 'sites') };
  writeMod(home, 'x.com', 'a.js', MOD('A'));
  writeMod(home, 'all-sites', 'b.js', MOD('B'));
  const list = scanMods(ws.modsDir).mods;
  const to = path.join(home, 'out');
  const r = share.exportMods(ws, list, ['x.com/a', 'all-sites/b', 'x.com/a'], { to });
  assert.equal(path.basename(r.dir), 'TRIF mods');
  assert.deepEqual(r.ids, ['x.com/a', 'all-sites/b']);
  assert.deepEqual(fs.readdirSync(r.dir).sort(), ['all-sites-b.js', 'x.com-a.js']);
  assert.equal(fs.readFileSync(path.join(r.dir, 'x.com-a.js'), 'utf8'), MOD('A'));
  assert.equal(path.basename(share.exportMods(ws, list, ['x.com/a'], { to }).dir), 'TRIF mods 2');
  assert.throws(() => share.exportMods(ws, list, ['x.com/a', 'x.com/nope'], { to }), /no mod x\.com\/nope/);
  assert.throws(() => share.exportMods(ws, list, [], { to }), /no mods to export/);
});

test('host: each mod comes with when its file changed; mod.trash and mod.exportMany for the All mods page', async (t) => {
  const home = tempDir();
  const out = tempDir();
  writeMod(home, 'x.com', 'a.js', MOD('A'));
  writeMod(home, 'all-sites', 'b.js', MOD('B'));
  const when = new Date(Date.UTC(2026, 9, 30, 12));
  fs.utimesSync(path.join(home, 'sites', 'x.com', 'a.js'), when, when);
  const ext = new FakeExtension({ home, env: { TRIF_CHOOSE_FOLDER: out, TRIF_REVEAL_CMD: '/usr/bin/true' } });
  t.after(() => ext.close());
  const mods = await ext.nextMods((ms) => ms.length === 2);
  assert.equal(mods.find((m) => m.id === 'x.com/a').changedAt, when.getTime());
  let n = 0;
  const ask = async (cmd, args) => {
    const id = `am${++n}`;
    ext.send({ type: 'request', id, cmd, args });
    return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 10000 });
  };
  let r = await ask('mod.exportMany', { ids: ['x.com/a', 'all-sites/b'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.ids, ['x.com/a', 'all-sites/b']);
  assert.deepEqual(fs.readdirSync(path.join(out, r.result.dir)).sort(), ['all-sites-b.js', 'x.com-a.js']);
  r = await ask('mod.delete', { id: 'x.com/a' });
  assert.equal(r.ok, true, r.error);
  r = await ask('mod.trash', {});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.trash.map((x) => [x.id, x.name, x.exists]), [['x.com/a', 'A', false]]);
});
