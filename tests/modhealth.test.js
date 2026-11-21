'use strict';
// Mods that break (extension/modhealth.js): fingerprints, new errors per version, Ignore, "may be broken",
// what a fix run is asked. The background's side: tests/extension.test.js ("mods that break").

const test = require('node:test');
const assert = require('node:assert');

test('a fingerprint: the mod, its file\'s line, the message without numbers and quoted parts', async () => {
  const H = await import('../extension/modhealth.js');
  assert.strictEqual(H.normalizeMessage('Cannot read properties of null (reading \'textContent\') at item 42'), 'Cannot read properties of null (reading …) at item #');
  assert.strictEqual(H.normalizeMessage('x is not a function'), 'x is not a function');
  // a page script's frame: the wrapper puts the file's first line on line 2
  const page = { mod: 'x.com/a', message: 'boom 1', stack: 'Error: boom 1\n    at trif://x.com/a.js:13:9\n    at foo (https://x.com/main.js:1:1)' };
  assert.strictEqual(H.errorLine(page, 'x.com/a'), 12);
  // a boxed mod's: the file's own lines
  assert.strictEqual(H.errorLine({ ...page, stack: 'TypeError: boom\n    at trif-sandbox://x.com/a.js:7:3', sandboxed: true }, 'x.com/a'), 7);
  assert.strictEqual(H.errorLine({ stack: 'no frames' }, 'x.com/a'), 0);
  assert.strictEqual(H.fingerprint(page), 'x.com/a|12|boom #');
  assert.strictEqual(H.fingerprint({ ...page, message: 'boom 2' }), H.fingerprint(page));
});

test('new errors: once per fingerprint and version; a new version starts fresh; Ignore hides one for that version', async () => {
  const H = await import('../extension/modhealth.js');
  const health = {};
  const mod = { id: 'x.com/a', hash: 'h1' };
  const mods = new Map([[mod.id, mod]]);
  const err = (message, line = 5) => ({ mod: mod.id, message, stack: `Error\n at trif://x.com/a.js:${line + 1}:1`, time: 1 });
  let fresh = H.recordErrors(health, mods, [err('bad 1'), err('bad 2'), err('other')]);
  assert.deepStrictEqual(fresh.map((f) => f.fp), ['x.com/a|5|bad #', 'x.com/a|5|other']);
  assert.strictEqual(H.recordErrors(health, mods, [err('bad 3')]).length, 0);
  assert.strictEqual(H.openErrors(health, mod).find((e) => e.fp === 'x.com/a|5|bad #').count, 3);
  // (another mod's errors: not this one's)
  assert.strictEqual(H.recordErrors(health, mods, [{ mod: 'y.com/b', message: 'x' }]).length, 0);
  H.dismiss(health, mod, 'x.com/a|5|other');
  assert.deepStrictEqual(H.openErrors(health, mod).map((e) => e.fp), ['x.com/a|5|bad #']);
  assert.strictEqual(H.recordErrors(health, mods, [err('other')]).length, 0); // (seen: not new again)
  // a fixed or updated mod: a new hash, a fresh start
  const v2 = { id: 'x.com/a', hash: 'h2' };
  assert.deepStrictEqual(H.openErrors(health, v2), []);
  fresh = H.recordErrors(health, new Map([[v2.id, v2]]), [err('bad 1')]);
  assert.strictEqual(fresh.length, 1);
});

test('may be broken: matched on a page, then nothing on three loads of it in a row; a match clears it', async () => {
  const H = await import('../extension/modhealth.js');
  const health = {};
  const mod = { id: 'x.com/s', hash: 'h' };
  const page = 'https://x.com/home';
  // (never matched there: not its page)
  for (let i = 0; i < 5; i++) assert.strictEqual(H.recordMatches(health, mod, 'https://x.com/other', false), null);
  assert.strictEqual(H.recordMatches(health, mod, page, true), null);
  assert.strictEqual(H.recordMatches(health, mod, page, false), null);
  assert.strictEqual(H.recordMatches(health, mod, page, false), null);
  const flag = H.recordMatches(health, mod, page, false);
  assert.deepStrictEqual({ fp: flag.fp, quiet: flag.quiet }, { fp: `x.com/s|quiet|${page}`, quiet: true });
  assert.strictEqual(H.recordMatches(health, mod, page, false), null); // (once)
  assert.strictEqual(H.openErrors(health, mod)[0].quiet, true);
  H.recordMatches(health, mod, page, true);
  assert.deepStrictEqual(H.openErrors(health, mod), []);
});

test('a fix run is asked with the mod\'s file, the error and its stack, and its recent logs', async () => {
  const H = await import('../extension/modhealth.js');
  const p = H.fixPrompt({ mod: 'x.com/a', name: 'Hider', site: 'x.com', url: 'https://x.com/home', error: { message: 'boom', stack: 'Error: boom\n    at trif://x.com/a.js:3:1', line: 2 }, logs: [{ level: 'warn', text: 'no posts yet' }] });
  for (const want of ['"Hider" (x.com/a, the file sites/x.com/a.js)', 'on https://x.com/home, at line 2', 'boom', 'trif://x.com/a.js:3:1', '- warn: no posts yet', 'Fix the mod']) assert.ok(p.includes(want), want);
  const q = H.fixPrompt({ mod: 'x.com/s', name: 'S', site: 'x.com', error: { quiet: true }, logs: [] });
  assert.match(q, /may be broken on x\.com: nothing it looks for is on the page any more/);
});

test('a style mod\'s selectors: hide, filter, replace\'s in, and its CSS rules; not html, body, :root or *', () => {
  const r = require('../helper/lib/rules');
  assert.deepStrictEqual(r.selectorsOf({ css: '#title { color: red } .a:hover, .b::before{x:1} @media (x){ .c {y:1} } body{} @keyframes k { from {a:1} 50% {a:2} }', hide: ['.ad'], filter: [{ items: 'article' }], replace: [{ in: 'body' }, { in: '#main' }] }),
    ['.ad', 'article', '#main', '#title', '.a', '.b', '.c']);
});

test('a click the clickjacking guard stopped: kept as the mod\'s error, marked clickjack, the same fingerprint on any control', async () => {
  const { recordErrors, openErrors } = await import('../extension/modhealth.js');
  const health = {};
  const mods = new Map([['x.com/a', { id: 'x.com/a', hash: 'h' }]]);
  const e = (what) => ({ mod: 'x.com/a', kind: 'clickjack', why: 'faded', stack: '', time: 1, message: `TRIF stopped a click on the page's "${what}": this mod's style made it nearly transparent, and without the mod it shows, so the click would have landed on it unseen.` });
  const fresh = recordErrors(health, mods, [e('<button#del> Delete')]);
  assert.strictEqual(fresh.length, 1);
  assert.strictEqual(fresh[0].clickjack, true);
  assert.deepStrictEqual(recordErrors(health, mods, [e('<a#x> Log out')]), []);
  assert.deepStrictEqual(openErrors(health, { id: 'x.com/a', hash: 'h' }).map((x) => [x.clickjack, x.count]), [[true, 2]]);
  // (an ordinary error isn't one)
  assert.strictEqual(recordErrors(health, mods, [{ mod: 'x.com/a', message: 'boom', stack: '', time: 2 }])[0].clickjack, undefined);
});

test('comes and goes: a streak with nothing, then a match, and that page is never flagged again for that version; a new version starts fresh', async () => {
  const H = await import('../extension/modhealth.js');
  const health = {};
  const mod = { id: 'google.com/promos', hash: 'h1' };
  const page = 'https://www.google.com/';
  const miss = (n, m = mod) => { let f = null; for (let i = 0; i < n; i++) f = H.recordMatches(health, m, page, false) || f; return f; };
  H.recordMatches(health, mod, page, true);
  // (one load with nothing, then a match: a slow page, not a pattern)
  assert.strictEqual(miss(1), null);
  H.recordMatches(health, mod, page, true);
  assert.ok(!health[mod.id].pages[page].comesAndGoes);
  // two with nothing, then back: it comes and goes there
  assert.strictEqual(miss(2), null);
  H.recordMatches(health, mod, page, true);
  assert.strictEqual(health[mod.id].pages[page].comesAndGoes, true);
  assert.strictEqual(miss(20), null);
  assert.deepStrictEqual(H.openErrors(health, mod), []);
  // (another page of the same mod: still checked)
  H.recordMatches(health, mod, 'https://www.google.com/webhp', true);
  for (let i = 0; i < 2; i++) assert.strictEqual(H.recordMatches(health, mod, 'https://www.google.com/webhp', false), null);
  assert.ok(H.recordMatches(health, mod, 'https://www.google.com/webhp', false), 'another page is flagged as before');
  // a raised flag, then a match: comes and goes too
  const other = { id: 'google.com/other', hash: 'o1' };
  H.recordMatches(health, other, page, true);
  assert.ok(miss(3, other));
  H.recordMatches(health, other, page, true);
  assert.deepStrictEqual(H.openErrors(health, other), []);
  assert.strictEqual(miss(10, other), null);
  // a new version of the mod: checked again
  const v2 = { id: 'google.com/promos', hash: 'h2' };
  H.recordMatches(health, v2, page, true);
  const f = miss(3, v2);
  assert.deepStrictEqual([f?.fp, f?.quiet], [`google.com/promos|quiet|${page}`, true]);
});

test('a genuinely broken mod is still flagged after three loads; a hide-only one after ten loads over three days', async () => {
  const H = await import('../extension/modhealth.js');
  const DAY = 24 * 60 * 60 * 1000;
  assert.deepStrictEqual([H.QUIET_LOADS, H.HIDE_QUIET_LOADS, H.HIDE_QUIET_DAYS], [3, 10, 3]);
  const health = {};
  const page = 'https://x.com/home';
  const broken = { id: 'x.com/restyle', hash: 'b' };
  H.recordMatches(health, broken, page, true, 0);
  assert.strictEqual(H.recordMatches(health, broken, page, false, 1), null);
  assert.strictEqual(H.recordMatches(health, broken, page, false, 2), null);
  assert.ok(H.recordMatches(health, broken, page, false, 3)?.quiet);
  // hide-only: ten loads in a row isn't enough inside three days...
  const hider = { id: 'x.com/hide-promo', hash: 'p' };
  const opts = { hideOnly: true };
  H.recordMatches(health, hider, page, true, 0, opts);
  const t0 = 1000;
  for (let i = 0; i < 12; i++) assert.strictEqual(H.recordMatches(health, hider, page, false, t0 + i * 60000, opts), null, `load ${i + 1}, within the hour`);
  // ...and three days isn't enough without ten loads
  const hider2 = { id: 'x.com/hide-banner', hash: 'q' };
  H.recordMatches(health, hider2, page, true, 0, opts);
  for (let i = 0; i < 9; i++) assert.strictEqual(H.recordMatches(health, hider2, page, false, t0 + i * DAY, opts), null, `load ${i + 1}, a day apart`);
  assert.ok(H.recordMatches(health, hider2, page, false, t0 + 9 * DAY, opts)?.quiet, 'the tenth load, nine days on');
  // the first hider: three days after its streak began
  assert.ok(H.recordMatches(health, hider, page, false, t0 + 3 * DAY, opts)?.quiet);
  assert.strictEqual(H.recordMatches(health, hider, page, false, t0 + 4 * DAY, opts), null, '(once)');
  // (a match in between starts the streak, and its three days, again)
  const hider3 = { id: 'x.com/hide-x', hash: 'r' };
  H.recordMatches(health, hider3, page, true, 0, opts);
  H.recordMatches(health, hider3, page, false, t0, opts);
  H.recordMatches(health, hider3, page, true, t0 + DAY, opts);
  for (let i = 1; i <= 10; i++) assert.strictEqual(H.recordMatches(health, hider3, page, false, t0 + 2 * DAY + i, opts), null);
});

test('not broken (trif not-broken): the flag goes and the page comes and goes; without a page, every page flagged', async () => {
  const H = await import('../extension/modhealth.js');
  const health = {};
  const mod = { id: 'phone~google.com/hide-google-promos', hash: 'h' };
  const a = 'https://www.google.com/';
  const b = 'https://www.google.com/search';
  for (const pg of [a, b]) { H.recordMatches(health, mod, pg, true); for (let i = 0; i < 3; i++) H.recordMatches(health, mod, pg, false); }
  assert.strictEqual(H.openErrors(health, mod).length, 2);
  assert.deepStrictEqual(H.markNotBroken(health, mod, a), [`${mod.id}|quiet|${a}`]);
  assert.deepStrictEqual(H.openErrors(health, mod).map((e) => e.page), [b]);
  for (let i = 0; i < 10; i++) assert.strictEqual(H.recordMatches(health, mod, a, false), null);
  // without a page: every page it's flagged on
  assert.deepStrictEqual(H.markNotBroken(health, mod), [`${mod.id}|quiet|${b}`]);
  assert.deepStrictEqual(H.openErrors(health, mod), []);
  assert.deepStrictEqual(H.markNotBroken(health, mod), [], 'nothing flagged: nothing to clear');
  // (a page it isn't flagged on yet: marked all the same)
  const c = 'https://www.google.com/imghp';
  H.markNotBroken(health, mod, c);
  H.recordMatches(health, mod, c, true);
  for (let i = 0; i < 5; i++) assert.strictEqual(H.recordMatches(health, mod, c, false), null);
  // (a new version: fresh)
  const v2 = { ...mod, hash: 'h2' };
  H.recordMatches(health, v2, a, true);
  for (let i = 0; i < 2; i++) H.recordMatches(health, v2, a, false);
  assert.ok(H.recordMatches(health, v2, a, false));
});

test('a "may be broken" fix run is told how to say nothing is broken, for the flag\'s page', async () => {
  const H = await import('../extension/modhealth.js');
  const p = H.fixPrompt({ mod: 'phone~google.com/hide-google-promos', name: 'Hide Google promos', site: 'google.com', url: 'https://www.google.com/?hl=en', error: { quiet: true, page: 'https://www.google.com/' }, logs: [] });
  assert.match(p, /If nothing is broken \(.*come and go\), don't change the mod\. Run `trif not-broken phone~google\.com\/hide-google-promos https:\/\/www\.google\.com\/` so TRIF stops flagging it there, and tell me what you found\./);
  // (no flag page: the tab's address without its query; neither: the mod alone)
  assert.match(H.fixPrompt({ mod: 'x.com/s', name: 'S', site: 'x.com', url: 'https://x.com/home?x=1', error: { quiet: true } }), /`trif not-broken x\.com\/s https:\/\/x\.com\/home`/);
  assert.match(H.fixPrompt({ mod: 'x.com/s', name: 'S', site: 'x.com', error: { quiet: true } }), /`trif not-broken x\.com\/s`/);
  // (a new error's prompt: nothing about it)
  assert.doesNotMatch(H.fixPrompt({ mod: 'x.com/a', name: 'A', site: 'x.com', error: { message: 'boom' } }), /not-broken/);
});

test('a style mod that only hides: a hide list, and CSS rules that only set display: none; not filters, replaces or other CSS', () => {
  const r = require('../helper/lib/rules');
  const spec = (o) => ({ css: '', hide: [], replace: [], filter: [], ...o });
  assert.strictEqual(r.hidesOnly(spec({ hide: ['#belowsb div.yp:has(promo-middle-slot)', 'promo-middle-slot'] })), true);
  assert.strictEqual(r.hidesOnly(spec({ css: '/* x */ .a, .b { display: none !important; } @media (max-width: 600px) { .c { display:none } }' })), true);
  assert.strictEqual(r.hidesOnly(spec({ hide: ['.ad'], css: '.a { display: none; color: red }' })), false);
  assert.strictEqual(r.hidesOnly(spec({ hide: ['.ad'], css: '.a { visibility: hidden }' })), false);
  assert.strictEqual(r.hidesOnly(spec({ hide: ['.ad'], filter: [{ items: 'article', hideIfText: 'Promoted' }] })), false);
  assert.strictEqual(r.hidesOnly(spec({ hide: ['.ad'], replace: [{ in: '#main', from: 'a', to: 'b' }] })), false);
  assert.strictEqual(r.hidesOnly(spec({ hide: ['.ad'], css: '@font-face { font-family: x }' })), false);
  assert.strictEqual(r.hidesOnly(spec({})), false);
  // (TRIF's mod list says so: helper/lib/mods.js)
  const { buildMod } = require('../helper/lib/mods');
  const style = (json) => buildMod({ site: 'phone~google.com', file: '/w/sites/phone~google.com/p.js', code: `// ==WebMod==\n// @name P\n// @match https://www.google.com/*\n// @style\n// ==/WebMod==\n${json}\n` }).mod;
  assert.strictEqual(style('{ "hide": ["promo-middle-slot"] }').hideOnly, true);
  assert.strictEqual(style('{ "hide": ["promo-middle-slot"], "css": "#x { color: red }" }').hideOnly, undefined);
});
