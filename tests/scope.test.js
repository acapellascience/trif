'use strict';
// Run scope (helper/lib/scope.js, mirrored in extension/lib.js) and held mods (helper/lib/held.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scopeFor, hostInScope, patternInScope, outOfScope } = require('../helper/lib/scope');
const { updateHeld, approveHeld, rejectHeld, lastRun, loadHeld, loadAllowed, reviewItems, reviewMod } = require('../helper/lib/held');
const { snapshot } = require('../helper/lib/runs');
const { scanMods } = require('../helper/lib/mods');
const { tempDir } = require('./fake-extension');

test('scopeFor: registrable domain, with common two-label suffixes and shared hosting', () => {
  const cases = {
    'x.com': 'x.com', 'www.x.com': 'x.com', 'en.wikipedia.org': 'wikipedia.org', 'a.b.c.example.com': 'example.com',
    'news.bbc.co.uk': 'bbc.co.uk', 'www.amazon.co.jp': 'amazon.co.jp', 'tim.github.io': 'tim.github.io',
    'x.tim.github.io': 'tim.github.io', 'localhost': 'localhost', '127.0.0.1': '127.0.0.1', 'X.COM.': 'x.com',
    'example.com:8080': 'example.com',
  };
  for (const [host, scope] of Object.entries(cases)) assert.equal(scopeFor(host), scope, host);
});

const PATTERNS = [
  ['https://x.com/*', 'x.com', true],
  ['*://*.x.com/*', 'x.com', true],
  ['*://api.x.com:8443/v1/*', 'x.com', true],
  ['https://notx.com/*', 'x.com', false],
  ['https://x.com.evil.net/*', 'x.com', false],
  ['<all_urls>', 'x.com', false],
  ['*://*/*', 'x.com', false],
  ['*://*.com/*', 'x.com', false],
  ['file:///*', 'x.com', false],
  ['https://twitter.com/*', 'x.com', false],
  ['nonsense', 'x.com', false],
];

test('patternInScope / hostInScope', () => {
  for (const [p, scope, want] of PATTERNS) assert.equal(patternInScope(p, scope), want, p);
  assert.equal(hostInScope('www.x.com', 'x.com'), true);
  assert.equal(hostInScope('evilx.com', 'x.com'), false);
  assert.equal(hostInScope('x.com', ''), false);
  assert.deepEqual(outOfScope({ matches: ['https://x.com/*', 'https://twitter.com/*'] }, 'x.com'), ['https://twitter.com/*']);
});

test('applyStartOff: preinstalled mods are switched off once, then the switch is the user\'s', async () => {
  const { applyStartOff } = await import('../extension/lib.js');
  const mods = [{ id: 'x.com/detox-timeline', startOff: true }, { id: 'a.com/mine' }];
  let r = applyStartOff(mods, { 'b.com/old': true }, {});
  assert.deepStrictEqual(r, { disabled: { 'b.com/old': true, 'x.com/detox-timeline': true }, startedOff: { 'x.com/detox-timeline': true }, changed: true });
  // The user switched it on: it stays on.
  const disabled = {};
  r = applyStartOff(mods, disabled, r.startedOff);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.disabled, disabled);
});

test('the extension agrees with the helper on patterns', async () => {
  const lib = await import('../extension/lib.js');
  for (const [p, scope, want] of PATTERNS) assert.equal(lib.patternInScope(p, scope), want, p);
  assert.equal(lib.urlInScope('https://www.x.com/home', 'x.com'), true);
  assert.equal(lib.urlInScope('chrome://settings', 'x.com'), false);
  assert.equal(lib.urlInScope('https://bank.com/', 'x.com'), false);
  assert.equal(lib.modInScope({ matches: ['https://x.com/*'] }, 'x.com'), true);
  assert.equal(lib.modInScope({ matches: [] }, 'x.com'), false);
});

function makeWs() {
  const home = tempDir();
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir };
}
const write = (ws, rel, text) => fs.writeFileSync(path.join(ws.modsDir, rel), text);
const header = (...matches) => `// ==WebMod==\n${matches.map((m) => `// @match ${m}\n`).join('')}// ==/WebMod==\n`;

test('updateHeld: holds only changed out-of-scope mods; an edit outside the run releases; approval allows what was found', () => {
  const ws = makeWs();
  write(ws, 'x.com/old-wide.js', header('<all_urls>') + '// there before the run');
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/inside.js', '// default matches: x.com');
  write(ws, 'x.com/wide.js', header('https://x.com/*', '<all_urls>'));
  const scopes = [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }];

  let held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(Object.keys(held), ['x.com/wide']);
  assert.equal(held['x.com/wide'].reason, 'runs on <all_urls>, outside x.com');
  assert.deepEqual(held['x.com/wide'].needs, ['match:<all_urls>']);
  assert.equal(held['x.com/wide'].runId, 'r1');
  assert.deepEqual(Object.keys(loadHeld(ws.home)), ['x.com/wide']);

  // Without runs to check, the hold persists while the file is unchanged...
  held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(Object.keys(held), ['x.com/wide']);
  // ...and an edit once its run is over (the user's) releases it.
  write(ws, 'x.com/wide.js', header('https://x.com/*', '<all_urls>') + '// user edit');
  held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(held, {});
  assert.equal(fs.existsSync(path.join(ws.home, 'held.json')), false);

  // Held again by the run; while it's going, its own edits keep it held (worked out again).
  updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  write(ws, 'x.com/wide.js', header('https://x.com/*', '<all_urls>') + '// the run edits it again');
  assert.deepEqual(Object.keys(updateHeld(ws, scanMods(ws.modsDir).mods, scopes)), ['x.com/wide']);
  // Approval: what was found is allowed for that mod, and the hold goes.
  approveHeld(ws.home, 'x.com/wide');
  assert.equal(loadHeld(ws.home)['x.com/wide'], undefined);
  assert.deepEqual(loadAllowed(ws.home)['x.com/wide'].powers, ['match:<all_urls>']);
  assert.throws(() => approveHeld(ws.home, 'x.com/wide'), /isn't held/);
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, scopes), {});
  // A free mod for every site was allowed as the version the user saw: a run's later edit waits again
  // (a run works for one site, and this runs on all of them)...
  write(ws, 'x.com/wide.js', header('<all_urls>') + '// changed again');
  held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(held['x.com/wide'].needs, ['match:<all_urls>']);
  assert.equal(held['x.com/wide'].reason, 'runs on <all_urls>, outside x.com: your agent changed it since you allowed that');
  approveHeld(ws.home, 'x.com/wide');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, scopes), {});
  // ...the user's own edit, once the run is over, doesn't...
  write(ws, 'x.com/wide.js', header('<all_urls>') + '// the user changed it');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  // ...and one that adds a power is held for that too.
  write(ws, 'x.com/wide.js', header('<all_urls>') + 'fetch("/x", { method: "POST" })');
  held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(held['x.com/wide'].needs, ['sends', 'match:<all_urls>']);
  assert.match(held['x.com/wide'].facts[0], /send requests or messages from the page as you \(it uses fetch\)/);
});

test('updateHeld: only a free mod for every site waits again when a run changes it; another domain, a style mod and a boxed mod don\'t', () => {
  const ws = makeWs();
  const before = snapshot(ws.modsDir, ws.home);
  const scopes = [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }];
  const files = {
    'x.com/two-domains.js': (body) => header('https://x.com/*', 'https://twitter.com/*') + body,
    'x.com/style-all.js': (body) => `// ==WebMod==\n// @match *://*/*\n// @style\n// ==/WebMod==\n{ "css": "body { margin: ${body.length}px }" }`,
    'x.com/boxed-all.js': (body) => `// ==WebMod==\n// @match *://*/*\n// @boxed\n// ==/WebMod==\n${body}`,
    'x.com/free-all.js': (body) => header('*://*/*') + body,
  };
  for (const [f, make] of Object.entries(files)) write(ws, f, make('// one'));
  let held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(Object.keys(held).sort(), ['x.com/boxed-all', 'x.com/free-all', 'x.com/style-all', 'x.com/two-domains']);
  for (const id of Object.keys(held)) approveHeld(ws.home, id);
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, scopes), {});
  for (const [f, make] of Object.entries(files)) write(ws, f, make('// two, longer'));
  held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(Object.keys(held), ['x.com/free-all']);
  assert.match(held['x.com/free-all'].reason, /your agent changed it since you allowed that/);
});

test('updateHeld: what the code does decides, not what its header says', () => {
  const ws = makeWs();
  const before = snapshot(ws.modsDir, ws.home);
  // A header claiming it only renders, over code that posts and clicks
  write(ws, 'x.com/liar.js', '// ==WebMod==\n// @risk 0 render-only\n// @description Makes the timeline prettier\n// ==/WebMod==\n' +
    'document.querySelector("[data-testid=tweetButton]").click(); fetch("/i/api/graphql/x/CreateTweet", { method: "POST" })');
  write(ws, 'x.com/pretty.js', '// ==WebMod==\n// @risk 0 render-only\n// ==/WebMod==\ndocument.body.style.background = "pink"');
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepEqual(Object.keys(held), ['x.com/liar']);
  assert.deepEqual(held['x.com/liar'].needs, ['sends', 'acts']);
  // the agent's words are kept apart, as its claim
  assert.equal(held['x.com/liar'].claim, 'render-only');
  // and before 0.3.0's allowed.json, an approved hold becomes allowed powers
  const ws2 = makeWs();
  write(ws2, 'x.com/wide.js', header('<all_urls>'));
  const m = scanMods(ws2.modsDir).mods[0];
  fs.writeFileSync(path.join(ws2.home, 'held.json'), JSON.stringify({ 'x.com/wide': { hash: m.hash, scope: 'x.com', approved: true } }));
  assert.deepEqual(updateHeld(ws2, scanMods(ws2.modsDir).mods, []), {});
  assert.deepEqual(loadAllowed(ws2.home)['x.com/wide'].powers, ['match:<all_urls>']);
});

test('updateHeld: a run can\'t rewrite what an allowed mod sends; edits elsewhere in it run straight away', () => {
  const ws = makeWs();
  const code = (url, color) => `document.body.style.color = "${color}";\nfetch("${url}", { method: "POST" });\n`;
  write(ws, 'x.com/poster.js', code('/i/api/mute', 'red'));
  // the user looked at it and said it's fine (or allowed it once)
  reviewMod(ws.home, scanMods(ws.modsDir).mods[0]);
  let before = snapshot(ws.modsDir, ws.home);
  // a run changes only its colour: nothing new, it runs
  write(ws, 'x.com/poster.js', code('/i/api/mute', 'blue'));
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]), {});
  // a run changes what it sends: held, and the card says it's a new or changed line
  before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/poster.js', code('/i/api/graphql/x/CreateTweet', 'blue'));
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r2', site: 'x.com', scope: 'x.com', before }]);
  assert.deepEqual(held['x.com/poster'].needs, ['sends']);
  assert.match(held['x.com/poster'].facts[0], /a line that does this is new or changed/);
  // allowed: that line is fine from now on
  approveHeld(ws.home, 'x.com/poster');
  before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/poster.js', code('/i/api/graphql/x/CreateTweet', 'green'));
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r3', site: 'x.com', scope: 'x.com', before }]), {});
  // an edit from outside a run (the terminal, a pasted file) is held the same way
  write(ws, 'x.com/poster.js', code('/i/api/other', 'green'));
  const outside = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(outside['x.com/poster'].needs, ['sends']);
  assert.equal(outside['x.com/poster'].by, 'outside');
});

test('updateHeld: any new or changed mod that can do something not allowed waits, whoever wrote it; mods there at first keep running, to review', () => {
  const ws = makeWs();
  write(ws, 'x.com/old-poster.js', 'fetch("/x", { method: "POST" })');
  write(ws, 'x.com/plain.js', 'document.body.style.color = "red"');
  // the first time: what's there is the user's, as it is: nothing held, the poster to review
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  assert.deepEqual(Object.keys(reviewItems(ws.home, scanMods(ws.modsDir).mods)), ['x.com/old-poster']);
  // a new mod pasted in (no run) that clicks: held, as from outside
  write(ws, 'x.com/pasted.js', 'document.querySelector("button").click()');
  let held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(Object.keys(held), ['x.com/pasted']);
  assert.equal(held['x.com/pasted'].by, 'outside');
  assert.equal(held['x.com/pasted'].runId, null);
  assert.equal(held['x.com/pasted'].site, 'x.com');
  // a plain edit to a plain mod: runs
  write(ws, 'x.com/plain.js', 'document.body.style.color = "blue"');
  assert.deepEqual(Object.keys(updateHeld(ws, scanMods(ws.modsDir).mods, [])), ['x.com/pasted']);
  // the old poster, edited: held now (it was grandfathered as it was, not for anything)
  write(ws, 'x.com/old-poster.js', 'fetch("/y", { method: "POST" })');
  assert.deepEqual(Object.keys(updateHeld(ws, scanMods(ws.modsDir).mods, [])).sort(), ['x.com/old-poster', 'x.com/pasted']);
  // allowed: it runs, and stays allowed as it is
  approveHeld(ws.home, 'x.com/pasted');
  held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(Object.keys(held), ['x.com/old-poster']);
  // its own @match is the user's to choose outside a run, and a header saying risk 2 is only a claim
  write(ws, 'x.com/wide.js', header('<all_urls>') + '// @risk 2 says so\ndocument.body.style.color = "red"');
  assert.deepEqual(Object.keys(updateHeld(ws, scanMods(ws.modsDir).mods, [])), ['x.com/old-poster']);
  // gone: dropped
  fs.unlinkSync(path.join(ws.modsDir, 'x.com/old-poster.js'));
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
});

test('reviewItems: mods the user has that can act, until "Looks right"; shipped mods start from their shipped version', () => {
  const ws = makeWs();
  write(ws, 'x.com/poster.js', 'fetch("/x", { method: "POST" })');
  write(ws, 'x.com/plain.js', 'document.body.style.color = "red"');
  write(ws, 'x.com/shipped.js', '// ==WebMod==\n// @source trif\n// @version 1\n// ==/WebMod==\nel.click()');
  fs.mkdirSync(path.join(ws.home, '.shipped', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(ws.home, '.shipped', 'x.com', 'shipped.js'), '// ==WebMod==\n// @source trif\n// @version 1\n// ==/WebMod==\nel.click()');
  let mods = scanMods(ws.modsDir).mods;
  let items = reviewItems(ws.home, mods);
  assert.deepEqual(Object.keys(items), ['x.com/poster']);
  assert.deepEqual(items['x.com/poster'].needs, ['sends']);
  reviewMod(ws.home, mods.find((m) => m.id === 'x.com/poster'));
  assert.deepEqual(reviewItems(ws.home, mods), {});
  // the user's edit of the shipped mod is only reviewed for what it adds
  write(ws, 'x.com/shipped.js', '// ==WebMod==\n// @source trif\n// @version 1\n// ==/WebMod==\nel.click(); location.href = "/home"');
  mods = scanMods(ws.modsDir).mods;
  items = reviewItems(ws.home, mods);
  assert.deepEqual(items['x.com/shipped'].needs, ['navigates']);
});

test('updateHeld: a change in a folder the run couldn\'t write (`locked`) isn\'t the run\'s', () => {
  const ws = makeWs();
  fs.mkdirSync(path.join(ws.modsDir, 'chatgpt.com'));
  write(ws, 'x.com/rainbow.js', header('https://x.com/*'));
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/rainbow.js', header('https://x.com/*', 'https://twitter.com/*') + '// edited by a run on x.com');
  write(ws, 'chatgpt.com/wide.js', header('<all_urls>'));
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'chatgpt.com', scope: 'chatgpt.com', before, locked: [path.join('sites', 'x.com')] }]);
  assert.deepEqual(Object.keys(held), ['chatgpt.com/wide']);
  // runLimits says which folders those are, relative to the workspace.
  const { runLimits } = require('../helper/lib/runs');
  const box = tempDir();
  assert.deepEqual(runLimits(ws, { scope: 'chatgpt.com', box, screenshots: box }).locked, [path.join('sites', 'x.com')]);
});

test('locked folders: a linked site folder gets Edit deny rules by its workspace path and its real path; only protected folders are exempt', () => {
  const { runLimits } = require('../helper/lib/runs');
  const claude = require('../helper/lib/agents/claude');
  const codex = require('../helper/lib/agents/codex');
  const ws = makeWs();
  const elsewhere = tempDir();
  fs.mkdirSync(path.join(ws.modsDir, 'chatgpt.com'));
  fs.symlinkSync(elsewhere, path.join(ws.modsDir, 'other.com'));
  const box = tempDir();
  const lim = runLimits(ws, { scope: 'x.com', box, screenshots: box });
  const realMods = fs.realpathSync(ws.modsDir);
  // (the link is denied to the run, but isn't a folder "the run couldn't write": what it names is wherever it
  // leads, so a mod reached through it is never passed off as someone else's)
  assert.deepEqual(lim.locked.sort(), [path.join('sites', 'chatgpt.com')]);
  assert.deepEqual(lim.lockedDirs.map((d) => [path.basename(d.rel), d.link]).sort(), [['chatgpt.com', false], ['other.com', true]]);
  const c = claude.command({ bin: '/x/claude', prompt: 'P', ...lim });
  const deny = JSON.parse(c.files[0].content).permissions.deny;
  for (const p of [path.join(realMods, 'other.com'), fs.realpathSync(elsewhere), path.join(realMods, 'chatgpt.com')]) {
    assert.ok(deny.includes(`Edit(/${p}/**)`), p);
  }
  assert.deepEqual(c.locked.sort(), lim.locked.sort());
  assert.deepEqual(codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).locked.sort(), lim.locked.sort());
  // A folder that is a link out of the mods folder isn't made read-only (that would open where it leads)
  // but isn't writable either: still protected.
  assert.ok(!lim.readOnly.includes(fs.realpathSync(elsewhere)));
  // Without the read-only list, nothing else is protected: no other folder is exempt from holding.
  assert.deepEqual(codex.command({ bin: '/x/codex', prompt: 'P', ...lim, readOnly: [] }).locked, []);
});

test('held mods: a locked folder named in another case is the same folder (APFS)', { skip: !fs.existsSync(os.tmpdir().toUpperCase()) }, () => {
  const ws = makeWs();
  fs.mkdirSync(path.join(ws.modsDir, 'other.com'));
  write(ws, 'other.com/a.js', '// ==WebMod==\n// @match *://other.com/*\n// ==/WebMod==\n1');
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'other.com/a.js', '// ==WebMod==\n// @match *://other.com/*\n// ==/WebMod==\n2');
  const { mods } = scanMods(ws.modsDir);
  // Locked as sites/OTHER.COM (another spelling of the same folder): not the run's change, not held.
  assert.deepStrictEqual(Object.keys(updateHeld(ws, mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before, locked: [path.join('sites', 'OTHER.COM')] }])), []);
  // Not locked: the run changed a mod for another site: held.
  assert.deepStrictEqual(Object.keys(updateHeld(ws, mods, [{ runId: 'r2', site: 'x.com', scope: 'x.com', before, locked: [] }])), ['other.com/a']);
});

test('@risk header: parsed into {tier, why}; a panel run\'s tier-2 mod is held, tier 0 and 1 aren\'t', () => {
  const ws = makeWs();
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/zero.js', '// ==WebMod==\n// @risk 0 render-only\n// ==/WebMod==\n');
  write(ws, 'x.com/one.js', '// ==WebMod==\n// @risk 1 (hides ads)\n// ==/WebMod==\n');
  write(ws, 'x.com/two.js', '// ==WebMod==\n// @risk 2: loads more in the background\n// ==/WebMod==\n');
  write(ws, 'x.com/bad.js', '// ==WebMod==\n// @risk high\n// ==/WebMod==\n');
  write(ws, 'x.com/none.js', '// no header');
  const { mods, warnings } = scanMods(ws.modsDir);
  const risk = Object.fromEntries(mods.map((m) => [m.id, m.risk]));
  assert.deepStrictEqual(risk, {
    'x.com/bad': null, 'x.com/none': null, 'x.com/one': { tier: 1, why: 'hides ads' },
    'x.com/two': { tier: 2, why: 'loads more in the background' }, 'x.com/zero': { tier: 0, why: 'render-only' },
  });
  assert.ok(warnings.some((w) => w.id === 'x.com/bad' && /@risk should start with 0, 1 or 2/.test(w.warning)));
  const held = updateHeld(ws, mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepStrictEqual(Object.keys(held), ['x.com/two']);
  assert.strictEqual(held['x.com/two'].reason, 'says it changes what the site receives (risk 2)');
  assert.strictEqual(held['x.com/two'].claim, 'loads more in the background');
});

test('updateHeld: a change is judged on what it adds to the version that already ran', () => {
  const ws = makeWs();
  const v1 = 'const x = document.createElement(tagFromSomewhere); el.setAttribute(attr, v);\n// "script" and "onload" are in here\nfetch("/a", { method: "POST" });\n';
  write(ws, 'x.com/mine.js', v1);
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {}); // (there first: as it is)
  // an edit elsewhere (a comment, CSS): runs, though the mod could already do things never reviewed
  write(ws, 'x.com/mine.js', v1 + 'document.body.style.color = "red";\n');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  // an edit that adds a line that sends: held, for that
  write(ws, 'x.com/mine.js', v1 + 'document.body.style.color = "red";\nfetch("/b", { method: "POST" });\n');
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(held['x.com/mine'].needs, ['sends']);
});

test('all-sites/ is writable from a run (its changes wait for the user\'s OK); every other site stays locked', () => {
  const { runLimits } = require('../helper/lib/runs');
  const ws = makeWs();
  for (const d of ['all-sites', 'chatgpt.com']) fs.mkdirSync(path.join(ws.modsDir, d));
  const box = tempDir();
  const lim = runLimits(ws, { scope: 'x.com', box, screenshots: box });
  assert.deepEqual(lim.locked.sort(), [path.join('sites', 'chatgpt.com')]);
  assert.ok(!lim.readOnly.some((p) => p.endsWith(`${path.sep}all-sites`)));
});

test('a waiting change to a mod that ran: the version before is what runs; Don\'t allow puts it back; Allow only for the version looked at', () => {
  const ws = makeWs();
  fs.mkdirSync(path.join(ws.modsDir, 'all-sites'));
  const v1 = header('*://*/*') + 'document.documentElement.style.background = "#111";\n';
  const v2 = header('*://*/*') + 'document.documentElement.style.background = "#333";\n';
  write(ws, 'all-sites/dark.js', v1);
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {}); // (ran, as it was)
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'all-sites/dark.js', v2); // a run on x.com edits it
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }]);
  assert.deepEqual(held['all-sites/dark'].needs, ['match:*://*/*']);
  assert.equal(lastRun(ws.home, 'all-sites/dark'), v1, 'the version before keeps running');
  // Allow for a version that isn't the one looked at: refused
  assert.throws(() => approveHeld(ws.home, 'all-sites/dark', 'not-that-one'), /changed again since you looked/);
  // Don't allow: v1 back, v2 kept in history
  const r = rejectHeld(ws, 'all-sites/dark', held['all-sites/dark'].hash);
  assert.equal(r.restored, 'previous');
  assert.equal(fs.readFileSync(path.join(ws.modsDir, 'all-sites/dark.js'), 'utf8'), v1);
  assert.equal(fs.readFileSync(require('../helper/lib/history').listHistory(ws, 'all-sites/dark')[0].file, 'utf8'), v2);
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  // a new mod a run wrote, not allowed: to the trash
  const before2 = snapshot(ws.modsDir, ws.home);
  write(ws, 'all-sites/new.js', header('*://*/*'));
  updateHeld(ws, scanMods(ws.modsDir).mods, [{ runId: 'r2', site: 'x.com', scope: 'x.com', before: before2 }]);
  assert.equal(lastRun(ws.home, 'all-sites/new'), null);
  assert.equal(rejectHeld(ws, 'all-sites/new').restored, 'removed');
  assert.equal(fs.existsSync(path.join(ws.modsDir, 'all-sites/new.js')), false);
});
