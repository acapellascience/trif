'use strict';
// The iPhone app's mod reader (mobile/shared/gen/mods.js: the helper's own buildMod, rules, powers and code reading,
// bundled by mobile/prepare.js with stand-ins for Node's built-ins) and the Mods tab's shared pieces
// (gen/panel-kit.js). Both are run here the way the phone runs them: with no Node globals and, for the reader, no
// URL (JavaScriptCore has none).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const helperMods = require('../helper/lib/mods');

const GEN = path.join(__dirname, '..', 'mobile', 'shared', 'gen');
function reader() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(GEN, 'mods.js'), 'utf8'), ctx);
  return ctx.__trifMods;
}
const header = (lines, body) => `// ==WebMod==\n${lines.map((l) => `// ${l}`).join('\n')}\n// ==/WebMod==\n${body}`;

test('the phone reads a mod as the helper does: id, tier, hash', () => {
  const M = reader();
  const style = header(['@name Hide the cookie box', '@match https://*.example.com/*', '@style'], '{"hide": [".cookie"]}');
  const r = M.readMod(style, { file: 'hide-cookie.js' });
  assert.equal(r.error, undefined);
  assert.equal(r.id, 'example.com/hide-cookie');
  assert.equal(r.tier, 'style');
  assert.equal(r.world, 'trif');
  assert.equal(r.hash, helperMods.buildMod({ site: 'example.com', file: 'hide-cookie.js', code: style }).mod.hash);
  assert.deepEqual(JSON.parse(JSON.stringify(r.needs)), []);
});

test('an import never keeps @source / @version, and names the mod by its file', () => {
  const M = reader();
  const r = M.readMod(header(['@name X', '@match https://x.com/*', '@source trif', '@version 9'], 'void 0;'), { file: 'x.com-thing.js' });
  assert.equal(r.id, 'x.com/x-com-thing');
  assert.doesNotMatch(r.code, /@source|@version/);
});

test('a boxed mod waits for its powers and their combinations, not its soft ones', () => {
  const M = reader();
  const r = M.readMod(header(['@name Keys', '@match https://x.com/*', '@boxed', '@powers keys, sound'], 'trif.hide(".a");'), {});
  const keys = r.needs.map((n) => n.key);
  assert.ok(keys.includes('power:keys'));
  assert.ok(!keys.includes('power:sound'));
  assert.ok(keys.some((k) => k.startsWith('power:together:')));
  assert.match(r.script, /__trifSandbox\.run\("x\.com\/keys"/);
  assert.equal(M.waiting(r.needs, M.allow(r.needs, {})).length, 0);
  const none = M.readMod(header(['@name Plain', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");'), {});
  assert.equal(none.needs.length, 0);
});

test('a free mod waits for what its code can do; a changed line that uses it asks again', () => {
  const M = reader();
  const a = M.readMod(header(['@name Sender', '@match https://x.com/*'], "fetch('/a');"), {});
  assert.ok(a.needs.some((n) => n.key === 'sends'));
  const allowed = M.allow(a.needs, {});
  const same = M.readMod(header(['@name Sender', '@match https://x.com/*', '@description now with words'], "fetch('/a');"), {});
  assert.equal(M.waiting(same.needs, allowed).length, 0);
  const changed = M.readMod(header(['@name Sender', '@match https://x.com/*'], "fetch('/b');"), {});
  assert.equal(M.waiting(changed.needs, allowed).length, 1);
  const quiet = M.readMod(header(['@name Quiet', '@match https://x.com/*'], 'document.title = "x";'), {});
  assert.equal(quiet.needs.length, 0);
});

test('match patterns without a URL of the platform’s, and a mod for several sites kept under the page’s', () => {
  const M = reader();
  assert.equal(M.appliesTo('http://localhost:8377/plain.html', ['http://localhost/*'], []), true);
  assert.equal(M.appliesTo('https://en.wikipedia.org/wiki/X', ['*://*.wikipedia.org/*'], ['*://*.wikipedia.org/wiki/X']), false);
  assert.equal(M.matchesUrl('https://x.com/home', ['<all_urls>']), true);
  const two = header(['@name Both', '@match https://x.com/*', '@match https://twitter.com/*', '@style'], '{"hide": [".a"]}');
  assert.equal(M.readMod(two, { here: 'twitter.com' }).site, 'twitter.com');
  assert.equal(M.readMod(header(['@name All', '@match <all_urls>', '@style'], '{"hide": [".a"]}'), {}).site, 'all-sites');
  assert.match(M.readMod('nothing here', {}).error, /no \/\/ ==WebMod== header/);
});

test('the Mods tab’s shared pieces load as one plain script', () => {
  const ctx = vm.createContext({ location: { href: 'file:///mods.html' } });
  vm.runInContext(fs.readFileSync(path.join(GEN, 'panel-kit.js'), 'utf8'), ctx);
  const P = ctx.__trifPanel;
  assert.equal(P.ROBOT.filter((p) => p.cls === 'eye').length, 2);
  assert.ok(P.term('tiers', 'boxed-mods'));
  const icons = P.modIcons({ sandboxed: true, powers: ['keys', 'sound'] }, 'x.com');
  assert.deepEqual(icons.map((i) => i.key), ['keys', 'sound', 'noticeable'].filter((k) => k !== 'noticeable' || P.modLevel({ sandboxed: true, powers: ['keys', 'sound'] })));
});

test('an edit is checked as trif check checks a file, with the line of what is wrong', () => {
  const M = reader();
  // (a syntax error's line is JavaScriptCore's to give: the phone has it; here only the message is sure)
  const bad = M.checkMod(header(['@name A', '@match https://x.com/*'], 'const a = 1;\nconst b = ;'), {});
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /Unexpected token|Unexpected/);
  const json = M.checkMod(header(['@name A', '@match https://x.com/*', '@style'], '{\n "css": "a{}",\n "hide": [".x",]\n}'), {});
  assert.equal(json.ok, false);
  assert.equal(json.errors[0].line, 8);
  assert.match(json.errors[0].message, /^the rules aren't valid JSON/);
  const css = M.checkMod(header(['@name A', '@match https://x.com/*', '@style'], '{"css": "a { background: url(https://e.x/a.png) }"}'), {});
  assert.equal(css.ok, false);
  assert.equal(css.errors[0].line, 6);
  const power = M.checkMod(header(['@name A', '@match https://x.com/*', '@boxed', '@powers nope'], 'trif.hide(".a")'), {});
  assert.equal(power.errors[0].line, 5);
  const lint = M.checkMod(header(['@name A', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");\ndocument.querySelector("b").click();'), {});
  assert.equal(lint.ok, false);
  assert.deepEqual([...new Set(lint.lint.flatMap((l) => l.lines))], [7]);
  assert.equal(M.checkMod(header(['@name A', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");'), {}).ok, true);
  assert.equal(M.checkMod('const a = 1;', {}).errors[0].line, 1);
  assert.equal(M.jsonErrorLine('{\n "a": 1\n "b": 2\n}'), 3);
  assert.equal(M.jsonErrorLine('{"a": [1, 2]}'), null);
});

test('a saved edit waits only for what it adds: a power, or a line that uses one', () => {
  const M = reader();
  const v1 = M.readMod(header(['@name Sender', '@match https://x.com/*'], "fetch('/a');\ndocument.title = 'x';"), {});
  const allowed = M.allow(v1.needs, {});
  // (an edit elsewhere in it: runs)
  const v2 = M.readMod(header(['@name Sender', '@match https://x.com/*'], "fetch('/a');\ndocument.title = 'y';"), {});
  assert.equal(M.waiting(v2.needs, allowed).length, 0);
  // (a new line that sends: asks)
  const v3 = M.readMod(header(['@name Sender', '@match https://x.com/*'], "fetch('/a');\nfetch('/b');"), {});
  assert.deepEqual(M.waiting(v3.needs, allowed).map((n) => n.key), ['sends']);
  // (a boxed mod given a power: asks for it; the same powers again: doesn't)
  const b1 = M.readMod(header(['@name Box', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");'), {});
  const b2 = M.readMod(header(['@name Box', '@match https://x.com/*', '@boxed', '@powers keys'], 'trif.hide(".a");'), {});
  assert.deepEqual(M.waiting(b2.needs, M.allow(b1.needs, {})).map((n) => n.key), ['power:keys']);
  const b3 = M.readMod(header(['@name Box', '@match https://x.com/*', '@boxed', '@powers keys'], 'trif.hide(".b");'), {});
  assert.equal(M.waiting(b3.needs, M.allow(b2.needs, {})).length, 0);
  // (its id stays its file's when its @name changes: the app reads an edit with the file's name)
  assert.equal(M.readMod(header(['@name Renamed', '@match https://x.com/*', '@boxed'], 'trif.hide(".a");'), { file: 'box.js', site: 'x.com' }).id, 'x.com/box');
});
