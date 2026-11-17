'use strict';
// "Paste a mod…" in the side panel (sidepanel.js pasteCard): the pasted text is imported as a file named after
// its @name, as the helper names a mod (helper/lib/share.js nameOf), so the mod's id is the same either way. The
// panel itself: tests/e2e/scenario.js shareCheck.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const share = require('../helper/lib/share');

test('a pasted mod\'s name: its @name in kebab-case, as an imported file\'s, or pasted-mod', async () => {
  const { pastedModName } = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'lib.js')).href);
  const mod = (name) => `// ==WebMod==\n${name === null ? '' : `// @name ${name}\n`}// @match https://x.com/*\n// @style\n// ==/WebMod==\n{ "hide": ["a"] }\n`;
  assert.equal(pastedModName(mod('Calmer timeline')), 'calmer-timeline.js');
  assert.equal(pastedModName(mod('  Café: Ünïcode & more!  ')), 'cafe-u-ni-code-more.js');
  assert.equal(pastedModName(mod(null)), 'pasted-mod.js');
  assert.equal(pastedModName(mod('!!!')), 'pasted-mod.js');
  assert.equal(pastedModName(''), 'pasted-mod.js');
  assert.equal(pastedModName(mod('x'.repeat(100))), `${'x'.repeat(60)}.js`);
  // (and the helper files it under that name: the same id a file of it would get)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-paste-'));
  for (const name of ['Calmer timeline', 'Café: Ünïcode & more!']) {
    const text = mod(name);
    const r = share.importMod({ home, modsDir: path.join(home, 'sites') }, { text, name: pastedModName(text) });
    assert.equal(r.id, `x.com/${pastedModName(text).replace(/\.js$/, '')}`);
  }
});

test('the paste card is the panel\'s, reachable only from its menu: nothing a page sends opens it', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.html'), 'utf8');
  assert.match(html, /<button id="paste-mod" class="btn menu-item" type="button" role="menuitem">Paste a mod…<\/button>/);
  const calls = [...js.matchAll(/pasteCard\(\)/g)].length;
  assert.equal(calls, 2, 'defined once, called once (from the menu item)');
  assert.match(js, /ui\.pasteMod\?\.addEventListener\('click', async \(\) => \{\n {2}ui\.modsMenu\.hidden = true;\n {2}const text = await pasteCard\(\);/);
});
