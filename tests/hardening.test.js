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

// ---- the helper: who wrote a mod, and where the helper writes ------------------------------------------------

const { runLimits, snapshot, instructionFiles } = require('../helper/lib/runs');
const held = require('../helper/lib/held');
const trash = require('../helper/lib/trash');
const http = require('http');

function fullWorkspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-hard-ws-'));
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir, private: fs.mkdtempSync(path.join(os.tmpdir(), 'trif-hard-private-')) };
}
const put = (ws, rel, text) => { const f = path.join(ws.modsDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

test('holds: a site folder that is a link is never a folder "the run couldn\'t write": a mod reached through it is the run\'s', () => {
  const ws = fullWorkspace();
  fs.mkdirSync(path.join(ws.modsDir, 'other.example'));
  // (a link in the mods folder to a folder of the run's own site: another site's name, the run's own files)
  fs.mkdirSync(path.join(ws.modsDir, 'x.com', 'sub'));
  fs.symlinkSync(path.join(ws.modsDir, 'x.com', 'sub'), path.join(ws.modsDir, 'third.example'));
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-hard-box-'));
  const lim = runLimits(ws, { scope: 'x.com', box, screenshots: box });
  assert.deepEqual(lim.locked, [path.join('sites', 'other.example')]);
  const before = snapshot(ws.modsDir, ws.home);
  put(ws, 'x.com/sub/n.js', '// a mod for third.example, written in the run\'s own folder');
  const scanned = mods.scanMods(ws.modsDir).mods;
  assert.ok(scanned.some((m) => m.id === 'third.example/n'));
  // even if a run's record still listed the link as locked (an older helper's), a link is never exempt
  for (const locked of [lim.locked, [path.join('sites', 'other.example'), path.join('sites', 'third.example')]]) {
    const h = held.updateHeld(ws, scanned, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before, locked }]);
    assert.ok(h['third.example/n'], 'held');
    assert.match(h['third.example/n'].reason, /outside x\.com/);
    assert.equal(h['third.example/n'].runId, 'r1');
  }
});

test('trash: a chat\'s delete and restore don\'t follow a site folder that is a link', () => {
  const ws = fullWorkspace();
  const victim = put(ws, 'other.example/keep.js', '// another site\'s mod');
  fs.symlinkSync(path.join(ws.modsDir, 'other.example'), path.join(ws.modsDir, 'm.x.com'));
  assert.throws(() => trash.deleteMod(ws, 'm.x.com/keep', { scope: 'x.com' }), /is a link/);
  assert.ok(fs.existsSync(victim));
  // restore: the run's own trashed mod can't land in another site's folder through a link put where its folder was
  put(ws, 'sub.x.com/mine.js', '// the run\'s own');
  trash.deleteMod(ws, 'sub.x.com/mine', { scope: 'x.com' });
  fs.rmdirSync(path.join(ws.modsDir, 'sub.x.com'));
  fs.symlinkSync(path.join(ws.modsDir, 'other.example'), path.join(ws.modsDir, 'sub.x.com'));
  assert.throws(() => trash.restoreMod(ws, 'sub.x.com/mine', { scope: 'x.com' }), /is a link/);
  assert.deepEqual(fs.readdirSync(path.join(ws.modsDir, 'other.example')), ['keep.js']);
  assert.equal(trash.listTrash(ws).length, 1, 'still in the trash');
  // the user's own terminal (no scope) is theirs
  assert.doesNotThrow(() => trash.deleteMod(ws, 'm.x.com/keep', {}));
});

test('holds: when working them out fails, nothing new runs and what ran keeps running', () => {
  const ws = fullWorkspace();
  put(ws, 'x.com/old.js', '// was there');
  held.updateHeld(ws, mods.scanMods(ws.modsDir).mods, []); // (seen as it is)
  put(ws, 'x.com/new.js', 'fetch("/x", { method: "POST" })');
  put(ws, 'x.com/old.js', '// changed');
  put(ws, 'x.com/same.js', '// new, harmless');
  const scanned = mods.scanMods(ws.modsDir).mods;
  const h = held.heldOnError(ws, scanned, {}, new Error('boom'));
  assert.deepEqual(Object.keys(h).sort(), ['x.com/new', 'x.com/old', 'x.com/same']);
  assert.match(h['x.com/new'].reason, /couldn't be checked .*boom/);
  // one that is the version TRIF last let run isn't held
  held.updateHeld(ws, scanned.filter((m) => m.id !== 'x.com/new'), []);
  assert.deepEqual(Object.keys(held.heldOnError(ws, scanned, {}, new Error('boom'))), ['x.com/new']);
});

test('runs: files agents read as instructions are moved out of the mods folder before a run starts', () => {
  const ws = fullWorkspace();
  put(ws, 'CLAUDE.md', 'planted');
  put(ws, 'x.com/AGENTS.md', 'planted');
  put(ws, 'x.com/deep/er/claude.md', 'planted');
  put(ws, 'x.com/.claude/settings.json', '{}');
  put(ws, 'x.com/mod.js', '1;');
  put(ws, 'x.com/README.md', 'notes are fine');
  const moved = instructionFiles(ws);
  assert.equal(moved.length, 4);
  for (const f of ['CLAUDE.md', 'x.com/AGENTS.md', 'x.com/deep/er/claude.md', 'x.com/.claude']) assert.ok(!fs.existsSync(path.join(ws.modsDir, f)), f);
  assert.ok(fs.existsSync(path.join(ws.modsDir, 'x.com', 'mod.js')) && fs.existsSync(path.join(ws.modsDir, 'x.com', 'README.md')));
  assert.equal(fs.readdirSync(path.join(ws.home, 'trash', '_instructions')).length, 4, 'kept, in the trash');
  assert.deepEqual(trash.listTrash(ws), [], 'not listed as deleted mods');
  assert.deepEqual(instructionFiles(ws), []);
});

test('key proxy: a path with dot segments, encoded or not, isn\'t passed on', async () => {
  const { startKeyProxy } = require('../helper/lib/keyproxy');
  const seen = [];
  const upstream = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const proxy = await startKeyProxy({ target: `http://127.0.0.1:${upstream.address().port}/api/v1`, key: 'k' });
  // (the path as written: a URL parser would resolve the dots before sending)
  const u = new URL(proxy.url);
  const get = (p) => new Promise((resolve, reject) => { http.get({ host: u.hostname, port: u.port, path: u.pathname + p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject); });
  try {
    assert.equal(await get('/models'), 200);
    assert.equal(await get('/models?after=a/../b'), 200, 'a query is the provider\'s to read');
    for (const p of ['/models/../../../other', '/models/..%2f..%2fother', '/models/%2e%2e/other', '/models/./x', '/models//x', '/models/..']) assert.equal(await get(p), 404, p);
    assert.deepEqual(seen, ['/api/v1/models', '/api/v1/models?after=a/../b']);
  } finally { proxy.close(); upstream.close(); }
});
