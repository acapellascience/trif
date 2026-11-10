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
