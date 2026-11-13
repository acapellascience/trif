'use strict';
// Fixes from the November 2026 review (docs/SECURITY.md "Review fixes"): each test is one way a wall didn't
// hold, kept shut.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const mods = require('../helper/lib/mods');
const rules = require('../helper/lib/rules');
const pc = require('../helper/lib/pathcheck');
const bp = require('../helper/lib/boxpowers');
const { sandboxPage } = require('./sandbox-harness');

const ext = (f) => import(pathToFileURL(path.join(__dirname, '..', 'extension', f)).href);
const LS = '\u2028', PS = '\u2029';

function workspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-hard-'));
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir };
}

// ---- names ---------------------------------------------------------------------------------------------

test('names: a site folder or mod file with a line break, control character or direction mark in its name is no mod', () => {
  const { modsDir } = workspace();
  fs.writeFileSync(path.join(modsDir, 'x.com', 'fine.js'), '1;');
  fs.writeFileSync(path.join(modsDir, 'x.com', 'my mod (2).js'), '1;'); // (people name their own files)
  for (const bad of [`a${LS}b`, `a${PS}b`, 'a\nb', 'a\rb', 'a\u0085b', 'a\u202eb', 'a\ufeffb']) fs.writeFileSync(path.join(modsDir, 'x.com', `${bad}.js`), '1;');
  fs.mkdirSync(path.join(modsDir, `evil${LS}.example`));
  fs.writeFileSync(path.join(modsDir, `evil${LS}.example`, 'm.js'), '1;');
  const scanned = mods.scanMods(modsDir);
  assert.deepEqual(scanned.mods.map((m) => m.id).sort(), ['x.com/fine', 'x.com/my mod (2)']);
  assert.equal(scanned.warnings.length, 8);
  for (const w of scanned.warnings) { assert.match(w.warning, /^ignored: the (file|folder) has a line break/); assert.ok(!pc.unsafeName(path.basename(w.file)), 'shown without the character'); }
  assert.equal(mods.listModFiles(modsDir).length, 2);
});

test('names: an id goes into a script\'s name (sourceURL) only as plain characters, whatever the helper sent', async () => {
  const { scriptName, sandboxModCode, sandboxPageCode } = await ext('sandbox.js');
  const { wrapModCode } = await ext('lib.js');
  assert.equal(scriptName('x.com/detox-timeline'), 'x.com/detox-timeline');
  assert.equal(scriptName('all-sites/dark_mode.v2'), 'all-sites/dark_mode.v2');
  for (const brk of [LS, PS, '\n', '\r']) {
    const id = `x.com/a${brk}globalThis.__ran = 1;({})`;
    for (const code of [sandboxModCode(id, '1;', []), sandboxPageCode(id, '1;', []), wrapModCode(id, '1;')]) {
      const last = code.split(/[\n\r\u2028\u2029]/).pop();
      assert.match(last, /^\/\/# sourceURL=trif(-sandbox)?:\/\/[\w.\-/%]+\.js$/, 'the comment is the last line, with nothing after it');
    }
    // and run, nothing in the name runs
    for (const code of [sandboxModCode(id, '1;', []), wrapModCode(id, '1;')]) {
      const g = {};
      g.window = g; g.globalThis = g;
      vm.runInNewContext(code, g);
      assert.equal(g.__ran, undefined);
    }
  }
  // a style mod's id sits in a comment too
  const code = rules.rulesCode(rules.checkRules({ hide: ['.ad'] }), `x.com/a${LS}globalThis.__ran = 1;`);
  const g = { document: { createElement: () => ({}), head: { append() {} }, documentElement: {} } };
  vm.runInNewContext(code, g);
  assert.equal(g.__ran, undefined);
});

// ---- CSS -----------------------------------------------------------------------------------------------

/** The extension's cssScan (inside sandbox.js's runtime, which runs in the page): its source, run here. */
function extensionCssScan() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const a = src.indexOf('const cssScan = (css) => {');
  const b = src.indexOf('  const cssOk = (css) => {');
  assert.ok(a > 0 && b > a);
  return vm.runInNewContext(`(() => { ${src.slice(a, b)}; return cssScan; })()`);
}

const { CANARY, cssCases } = require('./css-cases');
const CSS_CASES = cssCases(CANARY);

test('CSS: the helper and the extension read CSS the same way, as a browser does', () => {
  const scanE = extensionCssScan();
  for (const css of CSS_CASES) {
    const h = rules.cssScan(css), e = scanE(css);
    assert.deepEqual(JSON.parse(JSON.stringify(e)), JSON.parse(JSON.stringify(h)), css);
  }
  // strings end at line breaks; a url()'s text is its address
  assert.match(rules.cssScan('a { --x: "\n" }').error, /isn't closed on its line/);
  assert.deepEqual(rules.cssScan('a{b:url( data:,x )}').urls, ['data:,x']);
  assert.deepEqual(rules.cssScan('a{b:url("data:,/*")} c{d:e}').urls, ['data:,/*']);
  assert.match(rules.cssScan('a{b:url(data:,/*)}').error, /\/\*/);
  assert.equal(rules.cssScan('a::after { content: "url(x)" }').urls.length, 0, 'inside a string it loads nothing');
});

test('CSS: a style mod\'s CSS with the canary\'s address anywhere a browser would load it is refused', () => {
  for (const css of CSS_CASES) {
    const problem = rules.checkCss(css);
    if (!css.includes('canary.example')) continue;
    assert.ok(problem, `refused: ${JSON.stringify(css)}`);
  }
  assert.equal(rules.checkCss('a::after { content: "two \\\nlines" }'), null);
  assert.equal(rules.checkCss('a { background: url("data:image/png;base64,AAAA") }'), null);
  // selectors: the same reading, and nothing that reads a field
  assert.match(rules.checkSelector('a[title="\n"], html'), /isn't closed on its line/);
  assert.match(rules.checkSelector('input[value^="a"]'), /value attribute/);
  assert.match(rules.checkSelector('input:autofill'), /autofill/);
  assert.match(rules.checkCss('input[value^="a"] { color: red }'), /value attribute/);
  assert.equal(rules.checkSelector('[data-testid="value"]'), null);
});

test('CSS: text replacement skips editors by what the browser says, not by how the attribute is spelled', () => {
  const src = rules.rulesRuntime.toString();
  assert.match(src, /isContentEditable/);
  assert.match(src, /designMode === 'on'/);
  assert.doesNotMatch(src, /\[contenteditable=true\]/);
});

// ---- boxed mods: a stand-in is its mod's -----------------------------------------------------------------

test('boxed: a mod has its own powers and no other mod\'s, also after an await, whatever its functions are called', async () => {
  const p = await sandboxPage({ body: [{ tag: 'button', attrs: { id: 'b' } }] });
  const grant = { powers: ['click'], args: { click: ['the button: #b'] } };
  p.run('x.com/clicker', 'await null; page.find("#b").click();', grant);
  await p.tick();
  assert.equal(p.el('b').clicks, 1, 'its own power works after an await');
  // another mod, with no powers, in every way it runs: at the top, after an await, in a timer, in a function
  // named like the clicker's script (the stack used to say which mod was running)
  p.run('x.com/plain', `
    const tries = [];
    const go = () => { try { page.find('#b').click(); tries.push('clicked'); } catch (e) { tries.push(String(e.message)); } };
    go();
    await null; go();
    const named = { ['trif-sandbox://x.com/clicker.js:1:1']() { go(); } };
    named['trif-sandbox://x.com/clicker.js:1:1']();
    await new Promise((r) => setTimeout(r, 0)); go();
    trif.log(JSON.stringify(tries));`);
  await p.tick();
  assert.equal(p.el('b').clicks, 1, 'no click from the mod without the power');
  const logged = p.G.__trifSandbox.logs.find((l) => l.mod === 'x.com/plain');
  const tries = JSON.parse(logged.args[0]);
  assert.equal(tries.length, 4);
  for (const t of tries) assert.match(t, /needs the click power/);
});

test('boxed: each mod gets its own stand-in for an element, and a stand-in keeps working for its mod only', async () => {
  const p = await sandboxPage({ body: [{ tag: 'button', attrs: { id: 'b' } }] });
  p.run('x.com/one', 'const a = page.find("#b"), b = page.find("#b"); trif.log(String(a === b), String(a.parent === page.body), a.tag);');
  await p.tick();
  assert.deepEqual([...p.G.__trifSandbox.logs.find((l) => l.mod === 'x.com/one').args], ['true', 'true', 'button']); // (an array of the page's realm)
  // an object TRIF didn't make, or a method taken off a stand-in and called on something else, has no mod
  p.run('x.com/two', `
    const el = page.find('#b');
    const click = Object.getPrototypeOf(el).click;
    const out = [];
    for (const self of [{}, Object.create(Object.getPrototypeOf(el)), null]) { try { click.call(self); out.push('ran'); } catch (e) { out.push(String(e.message)); } }
    trif.log(JSON.stringify(out));`);
  await p.tick();
  const out = JSON.parse(p.G.__trifSandbox.logs.find((l) => l.mod === 'x.com/two').args[0]);
  for (const t of out) assert.match(t, /isn't an element TRIF gave you/);
});

// ---- rewrite-requests -----------------------------------------------------------------------------------

test('rewrite-requests: a path names the request\'s own fields, never __proto__, prototype or constructor', async () => {
  const meta = { id: 'x.com/m', site: 'x.com', matches: ['*://x.com/*'] };
  assert.doesNotThrow(() => bp.parsePowersWithArgs(['rewrite-requests HomeTimeline variables.enableRanking=false'], meta));
  for (const path of ['__proto__.method=DELETE', 'variables.__proto__.x=true', 'constructor.prototype.x=1', 'a.prototype.b=1']) {
    assert.throws(() => bp.parsePowersWithArgs([`rewrite-requests HomeTimeline ${path}`], meta), /__proto__, prototype or constructor/, path);
  }
  // and the page's side refuses them whoever sends the rules (any code in the page can send that event)
  const { pageBridge } = await ext('runtime.js');
  const listeners = {};
  const sent = [];
  const document = { addEventListener: (t, fn) => { listeners[t] = fn; }, dispatchEvent: () => true, documentElement: {} };
  const window = { fetch: async (input, init) => { sent.push({ input: String(input), init }); return {}; }, XMLHttpRequest: null };
  const g = { window, document, history: {}, location: { href: 'https://x.com/home', origin: 'https://x.com' }, Element: function () {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, URL, Request: class {}, Response: class {}, Object, JSON, WeakMap, WeakSet, Map, Set, Array, Number, String, RegExp, MutationObserver: class { observe() {} } };
  g.Element.prototype = {};
  vm.createContext(g);
  vm.runInContext(`(${pageBridge.toString()})()`, g);
  listeners['trif:rewrite-rules']({ detail: JSON.stringify([{ mod: 'x.com/m', op: 'Home', sets: [['variables.__proto__.polluted', 'true'], ['constructor.prototype.polluted', 'true'], ['variables.ok', 'true']] }]) });
  await g.window.fetch('https://x.com/i/api/Home', { method: 'POST', body: JSON.stringify({ variables: { a: 1 } }) });
  assert.equal(vm.runInContext('({}).polluted', g), undefined);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(JSON.parse(sent[0].init.body), { variables: { a: 1, ok: true } });
});
