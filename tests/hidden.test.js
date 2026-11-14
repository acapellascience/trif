'use strict';
// "Hide this" (the right-click menu): the site's one "Hidden on <site>" style mod (helper/lib/hidden.js),
// as hide.add and hide.remove write it, and what the scanner and held.js make of it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const hidden = require('../helper/lib/hidden');
const { scanMods } = require('../helper/lib/mods');
const { needsOf } = require('../helper/lib/held');
const { tempDir, writeMod } = require('./fake-extension');

const wsOf = (home) => ({ home, modsDir: path.join(home, 'sites') });
const fileOf = (ws, site) => path.join(ws.modsDir, site, 'hidden.js');

test('hide.add: the first hide makes "Hidden on <site>", a style mod with one rule; more are appended, once each', () => {
  const ws = wsOf(tempDir('trif-hidden-'));
  let r = hidden.hideAdd(ws, { site: 'www.X.com', selector: 'body > div:nth-of-type(2) > aside' });
  assert.deepStrictEqual([r.id, r.name, r.created, r.added, r.hide], ['x.com/hidden', 'Hidden on x.com', true, true, ['body > div:nth-of-type(2) > aside']]);
  const text = fs.readFileSync(fileOf(ws, 'x.com'), 'utf8');
  assert.match(text, /^\/\/ ==WebMod==\n\/\/ @name {8}Hidden on x\.com\n\/\/ @match {7}\*:\/\/x\.com\/\*\n\/\/ @match {7}\*:\/\/\*\.x\.com\/\*\n\/\/ @style\n\/\/ ==\/WebMod==\n\{\n {2}"hide": \[\n/);
  r = hidden.hideAdd(ws, { site: 'x.com', selector: 'div[data-testid="placementTracking"]' });
  assert.deepStrictEqual([r.created, r.added, r.hide.length], [false, true, 2]);
  r = hidden.hideAdd(ws, { site: 'x.com', selector: 'div[data-testid="placementTracking"]' });
  assert.deepStrictEqual([r.added, r.hide.length], [false, 2]);
  // one rule per line, as a person would read it
  assert.match(fs.readFileSync(fileOf(ws, 'x.com'), 'utf8'), /"hide": \[\n {4}"body > div:nth-of-type\(2\) > aside",\n {4}"div\[data-testid=\\"placementTracking\\"\]"\n {2}\]/);
  // the scanner reads it as a style mod: its rules as data, TRIF's code; nothing for held.js to ask about
  const { mods, problems } = scanMods(ws.modsDir);
  assert.deepStrictEqual(problems, []);
  const m = mods.find((x) => x.id === 'x.com/hidden');
  assert.ok(m && m.rules, 'a style mod');
  assert.strictEqual(m.name, 'Hidden on x.com');
  assert.deepStrictEqual(m.matches, ['*://x.com/*', '*://*.x.com/*']);
  assert.match(m.code, /display: none !important/);
  assert.deepStrictEqual(needsOf(m, null), [], 'never held');
  assert.deepStrictEqual(needsOf(m, 'x.com'), [], 'never held, a run on the site going or not');
});

test('hide.add with replace (Wider, All N like it, Everywhere): the one rule changes in place, in one write', () => {
  const ws = wsOf(tempDir('trif-hidden-'));
  hidden.hideAdd(ws, { site: 'x.com', selector: 'a.one' });
  hidden.hideAdd(ws, { site: 'x.com', selector: 'span.icon' });
  let r = hidden.hideAdd(ws, { site: 'x.com', selector: 'div.card > span.icon', replace: 'a.one' });
  assert.deepStrictEqual(r.hide, ['div.card > span.icon', 'span.icon']);
  r = hidden.hideAdd(ws, { site: 'x.com', selector: 'span.icon', replace: 'div.card > span.icon' }); // (to one that's there: no double)
  assert.deepStrictEqual(r.hide, ['span.icon']);
  r = hidden.hideAdd(ws, { site: 'x.com', selector: 'b.x', replace: 'not.there' }); // (a replace that's gone: appended)
  assert.deepStrictEqual(r.hide, ['span.icon', 'b.x']);
});

test('hide.remove (Undo): the rule goes; the last one takes the empty mod with it; other rules stay', () => {
  const ws = wsOf(tempDir('trif-hidden-'));
  hidden.hideAdd(ws, { site: 'x.com', selector: 'a.one' });
  hidden.hideAdd(ws, { site: 'x.com', selector: 'b.two' });
  let r = hidden.hideRemove(ws, { site: 'x.com', selector: 'a.one' });
  assert.deepStrictEqual([r.removed, r.deleted, r.hide], [true, false, ['b.two']]);
  assert.deepStrictEqual(hidden.hideRemove(ws, { site: 'x.com', selector: 'a.one' }).removed, false);
  r = hidden.hideRemove(ws, { site: 'x.com', selector: 'b.two' });
  assert.deepStrictEqual([r.removed, r.deleted], [true, true]);
  assert.ok(!fs.existsSync(fileOf(ws, 'x.com')));
  assert.deepStrictEqual(hidden.hideRemove(ws, { site: 'x.com', selector: 'b.two' }), { id: 'x.com/hidden', site: 'x.com', name: 'Hidden on x.com', file: fileOf(ws, 'x.com'), hide: [], removed: false, deleted: false });
  // edited since (CSS added, renamed by the user): kept as it is, only the list changes
  hidden.hideAdd(ws, { site: 'x.com', selector: 'a.one' });
  const f = fileOf(ws, 'x.com');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Hidden on x.com', 'My hiding').replace('{\n  "hide"', '{\n  "css": "a { color: red }",\n  "hide"'));
  hidden.hideAdd(ws, { site: 'x.com', selector: 'b.two' });
  r = hidden.hideRemove(ws, { site: 'x.com', selector: 'a.one' });
  r = hidden.hideRemove(ws, { site: 'x.com', selector: 'b.two' });
  assert.deepStrictEqual([r.deleted, r.hide], [false, []]);
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /@name +My hiding/);
  assert.match(text, /"css": "a \{ color: red \}"/);
});

test('hide.add refuses: the whole page, what a style mod can\'t have, a bad site, a hidden.js that isn\'t a style mod', () => {
  const home = tempDir('trif-hidden-');
  const ws = wsOf(home);
  for (const sel of ['html', 'body', ':root', 'html > body', 'body:nth-of-type(1)', ' BODY ']) assert.throws(() => hidden.hideAdd(ws, { site: 'x.com', selector: sel }), /whole page/, sel);
  for (const sel of ['a { color: red } b', 'a;b', '@import x', 'a\\62', 'input[value="x"]', '', 'x'.repeat(1001)]) assert.throws(() => hidden.hideAdd(ws, { site: 'x.com', selector: sel }), hidden.HiddenError, sel);
  assert.throws(() => hidden.hideAdd(ws, { site: '../etc', selector: 'a' }), /isn't a site/);
  assert.throws(() => hidden.hideAdd(ws, { site: 'all-sites', selector: 'a' }), /isn't a site/);
  assert.ok(!fs.existsSync(path.join(ws.modsDir, 'x.com')), 'nothing written');
  // (quotes may hold what a rule can't: they're a string)
  assert.ok(hidden.hideAdd(ws, { site: 'x.com', selector: 'div[aria-label="a; b {c}"]' }).added);
  writeMod(home, 'y.com', 'hidden.js', '// ==WebMod==\n// @name Mine\n// @match *://y.com/*\n// ==/WebMod==\nalert(1);\n');
  assert.throws(() => hidden.hideAdd(ws, { site: 'y.com', selector: 'a' }), /isn't a style mod/);
  assert.match(fs.readFileSync(fileOf(ws, 'y.com'), 'utf8'), /alert\(1\)/);
});
