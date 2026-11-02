'use strict';
// Run scope (helper/lib/scope.js, mirrored in extension/lib.js) and held mods (helper/lib/held.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scopeFor, hostInScope, patternInScope, outOfScope } = require('../helper/lib/scope');
const { updateHeld, approveHeld, loadHeld } = require('../helper/lib/held');
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
  const mods = [{ id: 'x.com/plain-x', startOff: true }, { id: 'a.com/mine' }];
  let r = applyStartOff(mods, { 'b.com/old': true }, {});
  assert.deepStrictEqual(r, { disabled: { 'b.com/old': true, 'x.com/plain-x': true }, startedOff: { 'x.com/plain-x': true }, changed: true });
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

test('updateHeld: holds only changed out-of-scope mods; releases on edit or approval', () => {
  const ws = makeWs();
  write(ws, 'x.com/old-wide.js', header('<all_urls>') + '// there before the run');
  const before = snapshot(ws.modsDir, ws.home);
  write(ws, 'x.com/inside.js', '// default matches: x.com');
  write(ws, 'x.com/wide.js', header('https://x.com/*', '<all_urls>'));
  const scopes = [{ runId: 'r1', site: 'x.com', scope: 'x.com', before }];

  let held = updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.deepEqual(Object.keys(held), ['x.com/wide']);
  assert.equal(held['x.com/wide'].reason, 'it matches <all_urls>, outside x.com');
  assert.equal(held['x.com/wide'].runId, 'r1');
  assert.deepEqual(Object.keys(loadHeld(ws.home)), ['x.com/wide']);

  // Without runs to check, the hold persists while the file is unchanged...
  held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(Object.keys(held), ['x.com/wide']);
  // ...and an edit outside any run releases it.
  write(ws, 'x.com/wide.js', header('https://x.com/*', '<all_urls>') + '// user edit');
  held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(held, {});
  assert.equal(fs.existsSync(path.join(ws.home, 'held.json')), false);

  // Approval.
  updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
  assert.ok(loadHeld(ws.home)['x.com/wide']);
  approveHeld(ws.home, 'x.com/wide');
  assert.equal(loadHeld(ws.home)['x.com/wide'].approved, true);
  assert.throws(() => approveHeld(ws.home, 'x.com/wide'), /isn't held/);
  // Approved stays approved even while the run still counts (approving mid-run, or just after it)...
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, scopes), {});
  // ...until the run changes the mod again.
  write(ws, 'x.com/wide.js', header('<all_urls>') + '// changed again');
  assert.deepEqual(Object.keys(updateHeld(ws, scanMods(ws.modsDir).mods, scopes)), ['x.com/wide']);
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
  assert.deepEqual(lim.locked.sort(), [path.join('sites', 'chatgpt.com'), path.join('sites', 'other.com')]);
  const c = claude.command({ bin: '/x/claude', prompt: 'P', ...lim });
  const deny = JSON.parse(c.args[c.args.indexOf('--settings') + 1]).permissions.deny;
  for (const p of [path.join(realMods, 'other.com'), fs.realpathSync(elsewhere), path.join(realMods, 'chatgpt.com')]) {
    assert.ok(deny.includes(`Edit(/${p}/**)`), p);
  }
  assert.deepEqual(c.locked.sort(), lim.locked.sort());
  assert.deepEqual(codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).locked.sort(), lim.locked.sort());
  // An adapter that says nothing about it protects nothing: no folder is exempt from holding.
  assert.deepEqual(codex.command({ bin: '/x/codex', prompt: 'P', ...lim, readOnly: [] }).locked, []);
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
  assert.strictEqual(held['x.com/two'].reason, 'it changes what the site receives (risk 2: loads more in the background)');
});
