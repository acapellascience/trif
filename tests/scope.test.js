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
