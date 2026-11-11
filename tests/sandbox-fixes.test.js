'use strict';
// Regression tests for the bugs found converting the user's mods to boxed mods (branch crossmod, job 1), the
// helper's side: `trif check` for a mod with only @migrate (1), the rules mods' CSS check (3) and the lint (11).
// The sandbox's own fixes (2, 4-10) are tried in the browsers: tests/e2e/scenario.js sandboxFixesCheck.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld } = require('../helper/lib/held');
const { sandboxLint } = require('../helper/lib/sandboxlint');
const { checkCss } = require('../helper/lib/rules');
const { runCli, writeMod, tempDir } = require('./fake-extension');

const header = (extra = '') => `// ==WebMod==\n// @name Bouncer\n// @match https://x.com/*\n// @boxed\n${extra}// ==/WebMod==\n`;

test('bug 1: trif check says a boxed mod with only @migrate waits for the user\'s OK once, as held.js holds it', async () => {
  const home = tempDir();
  const file = writeMod(home, 'x.com', 'old-zoom.js', header('// @migrate localStorage rrRave.zoom\n') + 'const s = await trif.settings(\'rrRave.zoom\', {});\n');
  const r = await runCli(['check', file], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /never waits/);
  assert.match(r.stdout, /brings over its old settings from the site's storage once \(@migrate\)/);
  assert.match(r.stdout, /It waits for the user's OK once/);
  assert.match(r.stdout, /- it brings over its old settings from what this site keeps under: rrRave\.zoom \(once\)/);
  // (and held.js does hold it: what check says is true)
  const ws = { home, modsDir: path.join(home, 'sites') };
  fs.writeFileSync(path.join(home, 'seen.json'), '{}\n');
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(held['x.com/old-zoom'].needs, ['power:migrate:local:rrRave.zoom']);
  // (a boxed mod with nothing at all still never waits)
  const calm = writeMod(home, 'x.com', 'calm.js', header() + 'trif.hide(".ad");\n');
  assert.match((await runCli(['check', calm], { home })).stdout, /never waits for the user's OK/);
});

test('bug 3: the CSS check matches whole property names (overscroll-behavior is fine; behavior isn\'t)', () => {
  assert.equal(checkCss('body { overscroll-behavior: contain; scroll-behavior: smooth }'), null);
  assert.equal(checkCss('.a{overscroll-behavior-y:none}'), null);
  assert.match(checkCss('a { behavior: url(x.htc) }'), /runs code|url\(\)/);
  assert.match(checkCss('a{behavior:x}'), /runs code/);
  assert.match(checkCss('a { -ms-behavior: x }'), /runs code/);
  assert.match(checkCss('behavior: x'), /runs code/);
  // (the sandbox's own check is the same expression: extension/sandbox.js cssOk)
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  assert.match(src, /\(\?<!\[\\w-\]\)\(\?:-ms-\)\?behavior\\s\*:/);
  assert.doesNotMatch(src, /\|behavior\\s\*:\//);
});

test('bug 11: the lint counts every name a const, let or var declares (const a = 1, b = 2)', () => {
  const what = (code) => sandboxLint(code).map((l) => l.what);
  assert.deepEqual(what('const a = 1, location = 2; location;'), []);
  assert.deepEqual(what('let x = f(1, 2), document = page; document.find;'), []);
  assert.deepEqual(what('var a = { b: 1, c: [2, 3] }, history = [], { navigator } = o, [screen, open] = p; history.push(navigator, screen, open);'), []);
  assert.deepEqual(what('const f = (a, b) => a + b, crypto = 3; crypto;'), []);
  // (a comma after the declaration ends isn't one: the name is still the page's)
  assert.deepEqual(what('const a = 1; f(a, document);'), ['document']);
  assert.deepEqual(what('for (const k of list) g(k, window);'), ['window']);
});
