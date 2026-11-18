'use strict';
// The sites' own unread counts, read from their page titles (Tim, 11-18: "unread counts instead of notifications"):
// mobile/shared/core/unread-count.js (both phone apps' rule; Android's to use) against mobile/shared/core/unread-count-cases.json, and
// on macOS the iPhone's UnreadTitle.swift (swiftc with mobile/test/unreadcount-check/main.swift) giving the very same
// answers, on the cases and on random titles made of the pieces that matter.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readCount, countText } = require('../shared/core/unread-count');

const HERE = __dirname;
const CASES = require('../shared/core/unread-count-cases.json');

test('unread-count.js: the cases', () => {
  for (const [title, count, plus, rest] of CASES) {
    const got = readCount(title);
    if (count === null) assert.equal(got, null, `no count in ${JSON.stringify(title)}`);
    else assert.deepEqual(got, { count, plus, title: rest }, JSON.stringify(title));
  }
  assert.equal(countText(3, false), '3');
  assert.equal(countText(20, true), '20+');
  assert.equal(countText(1234, false), '999+');
});

test('unread-count.js: a year in a film title is never a count', () => {
  for (const t of ['Dune: Part Two (2024) - IMDb', '(2024) Dune trailer - YouTube', 'Best of (2024)', 'Nosferatu (2024 film) - Wikipedia']) {
    assert.equal(readCount(t), null, t);
  }
});

// (random titles from the pieces the rule looks at, so the two sides are compared where they could differ)
function randomTitles(n) {
  const bits = ['(3)', '(20+)', '(2024)', '(1,234)', '(1.000)', '(0)', '( 4 )', 'Inbox', 'INBOX', 'inbox', 'Sandbox', '(5 unread)', '(9+ unread)',
    'Home', '/', 'X', '-', ' - ', '–', '—', '|', '•', '·', ':', ' ', '  ', '\u00a0', '\u202f', '\u3000', '\t', 'Gmail', 'tim@example.com',
    'é', '日本', '(', ')', '+', '12', '٣', '(٣)', 'Dune', 'film', 'Yahoo Mail', '$1', '\\',
    'Inbox (5)', 'inbox(12)', 'Inbox\u00a0(3+)', 'xInbox (4)', 'Inbox (1,024)', '(7 unread)', '(1,234\u00a0unread)', '(2 Unread)'];
  let seed = 11;
  const rand = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const out = [];
  for (let i = 0; i < n; i++) {
    let t = '';
    for (let j = 0, len = 1 + rand(8); j < len; j++) t += bits[rand(bits.length)] + (rand(3) ? '' : ' ');
    out.push(t);
  }
  return out;
}

test('UnreadTitle.swift gives the same answers as unread-count.js', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-unreadcount-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'UnreadTitle.swift'), path.join(HERE, 'unreadcount-check', 'main.swift'), '-o', bin],
      { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    const titles = [...CASES.map((c) => c[0]), ...randomTitles(3000)];
    const swift = execFileSync(bin, { input: titles.map((t) => JSON.stringify(t)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n');
    assert.equal(swift.length, titles.length);
    // (the random titles reach every branch: counts at the start, Inbox, unread, and none)
    const kinds = { start: 0, inbox: 0, unread: 0, none: 0 };
    const n = (t, r) => (t.match(r) || []).length;
    for (const t of titles) {
      const r = readCount(t);
      kinds[!r ? 'none' : n(r.title, /unread\)/gi) < n(t, /unread\)/gi) ? 'unread' : n(r.title, /inbox\s*\(/gi) < n(t, /inbox\s*\(/gi) ? 'inbox' : 'start']++;
    }
    for (const k of Object.keys(kinds)) assert.ok(kinds[k] > 50, `random titles: ${JSON.stringify(kinds)}`);
    titles.forEach((t, i) => {
      const js = readCount(t);
      const want = js ? { count: js.count, plus: js.plus, text: countText(js.count, js.plus), title: js.title } : null;
      assert.deepStrictEqual(JSON.parse(swift[i]), want, `${JSON.stringify(t)}: Swift ${swift[i]}, JavaScript ${JSON.stringify(want)}`);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gen/core.js: TrifCore.unreadCount in a bare context (JavaScriptCore\'s view) gives the same answers', () => {
  const vm = require('vm');
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(HERE, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  const U = vm.runInContext('TrifCore.unreadCount', ctx);
  for (const [title] of CASES) assert.equal(JSON.stringify(U.readCount(title)), JSON.stringify(readCount(title)), JSON.stringify(title));
  assert.equal(vm.runInContext('TrifCore.call("unreadCount.readCount", JSON.stringify(["(3) Home / X"]))', ctx), '{"count":3,"plus":false,"title":"Home / X"}');
});
