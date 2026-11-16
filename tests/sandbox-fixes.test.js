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

// Stand-ins are their mod's (78f9558): every way TRIF hands a mod an element knows which mod it's for, from
// the mod's own api, not from whatever was running (the conversions' mods act in timers, intervals, frames,
// observers and after awaits). The same in real SES: tests/sandbox-browser.test.js.
test('boxed: a mod\'s elements and powers work in its timers, intervals, frames, observers and after awaits', async () => {
  const { sandboxPage } = require('./sandbox-harness');
  const p = await sandboxPage({ body: [{ tag: 'button', attrs: { id: 'b' } }, { tag: 'section', attrs: { id: 's' } }] });
  p.run('x.com/later', `
    const t = (what, fn) => { try { fn(); trif.log(what, 'ok'); } catch (e) { trif.log(what, String(e.message)); } };
    await null;
    t('after an await', () => page.find('#s').attr('id'));
    Promise.resolve().then(() => t('in a then', () => page.find('#s').parent.tag));
    setTimeout(() => t('in a timer', () => page.find('#b').click()), 0);
    const h = setInterval(() => { clearInterval(h); t('in an interval', () => page.find('#b').click()); }, 1);
    requestAnimationFrame(() => t('in a frame', () => page.body.find('#s').closest('body').tag));
    trif.observe('section', (el) => t('in observe', () => el.parent.find('#b').attr('id')));
    await new Promise((r) => setTimeout(r, 5));
    t('after a timer await', () => page.find('#b').click());`, { powers: ['click'], args: { click: ['the button: #b'] } });
  await new Promise((r) => setTimeout(r, 40));
  const logs = p.G.__trifSandbox.logs.filter((l) => l.mod === 'x.com/later').map((l) => [...l.args].join(' '));
  for (const what of ['after an await', 'in a then', 'in a timer', 'in an interval', 'in a frame', 'in observe', 'after a timer await']) assert.ok(logs.includes(`${what} ok`), `${what}: ${JSON.stringify(logs)} ${JSON.stringify(p.errors())}`);
  assert.equal(p.el('b').clicks, 3);
  assert.deepEqual(p.errors(), []);
});
