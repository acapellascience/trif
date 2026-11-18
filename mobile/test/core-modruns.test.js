'use strict';
// mobile/shared/core/match.js and mod-store.js part 3 (what runs: switches, tiers off, Pause all, @match) against
// mod-runs-cases.json, the answers the iPhone's Mods.swift gave before the move (mobile/test/modruns.test.js holds the
// Swift to them), and the branch android's ModStoreTest.kt stories (matchPatterns, switchesTiersAndPause). Also through
// the generated mobile/shared/gen/core.js, as the apps load it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'mod-runs-cases.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));
const R = cases.mods;

function run(M, S, where) {
  let n = 0;
  const { patterns, urls, one } = cases.match;
  urls.forEach(([url, parts], u) => patterns.forEach((p, i) => {
    assert.equal(M.one(p, parts), one[u][i] === '1', `${where} one ${JSON.stringify(p)} ${JSON.stringify(url)}`); n++;
  }));
  for (const [r, a] of cases.isOn) { cases.isOnSites.forEach((s, i) => assert.equal(S.isOn(R[r], s), a[i], `${where} isOn ${r} ${s}`)); n++; }
  for (const [r, to, s, a] of cases.setOn) {
    const got = S.setOn(R[r], to, s);
    assert.deepStrictEqual([got.on, got.offSites], [a.on, a.offSites], `${where} setOn ${r} ${to} ${s}`);
    // (recorded: the mark was there only on mods switched off)
    if (!R[r].on) assert.equal(got.clearNewOff, a.clearNewOff, `${where} setOn clearNewOff ${r} ${to}`);
    n++;
  }
  for (const [r, a] of cases.off) { cases.groupsChoices.forEach((g, i) => assert.deepStrictEqual(plain(S.off(R[r], g)), a[i], `${where} off ${r} ${i}`)); n++; }
  for (const [l, g, p, a] of cases.running) {
    cases.runUrls.forEach(([url, parts], i) => assert.deepStrictEqual(plain(S.running(l.map((r) => R[r]), { paused: p, groupsOff: g, url: parts })), a[i], `${where} running ${l} ${url}`));
    n++;
  }
  for (const [g, t, on, s, a] of cases.setGroup) { assert.deepStrictEqual(plain(S.setGroup(g, t, on, s)), a, `${where} setGroup ${t} ${on} ${s}`); n++; }
  return n;
}

test('core/match.js and mod-store.js part 3 give the iPhone\'s answers', () => {
  assert.ok(run(require(path.join(CORE, 'match.js')), require(path.join(CORE, 'mod-store.js')), 'module') > 4000);
});

test('Android\'s stories (ModStoreTest.kt matchPatterns, switchesTiersAndPause)', () => {
  const M = require(path.join(CORE, 'match.js')), S = require(path.join(CORE, 'mod-store.js'));
  const parts = Object.fromEntries(cases.match.urls);
  const m = (p, u) => M.any([p], parts[u]);
  assert.ok(m('https://x.com/*', 'https://x.com/a?b=1'));
  assert.ok(m('https://x.com/*', 'https://X.com'));
  assert.ok(!m('https://x.com/*', 'http://x.com/'));
  assert.ok(m('*://*.x.com/*', 'http://m.x.com:8080/p#frag'));
  assert.ok(m('*://*.x.com/*', 'https://x.com/'));
  assert.ok(!m('*://*.x.com/*', 'https://notx.com/'));
  assert.ok(!m('*://*/*', 'ftp://x.com/'));
  assert.ok(m('<all_urls>', 'http://localhost:8477/a'));
  assert.ok(!m('<all_urls>', 'about:blank'));
  assert.ok(m('https://x.com/a.b/*', 'https://x.com/a.b/c'));
  assert.ok(!m('https://x.com/a.b/*', 'https://x.com/aXb/c'));
  assert.ok(m('https://x.com/%E2%9C%93*', 'https://x.com/%E2%9C%93/x'));
  assert.ok(m('https://x.com/search?q=*', 'https://x.com/search?q=cats'));
  assert.ok(!m('https://x.com/home', 'https://x.com/home/more'));
  assert.ok(!m('https://*x.com/*', 'https://ax.com/'));
  // (switches, tiers, Pause all)
  const base = { needs: [], extraNeeds: [], allowed: {}, ran: false, on: true, offSites: [], excludes: [] };
  const a = (p) => ({ scheme: 'https', host: p, path: '/' });
  let M1 = { ...base, tier: 'boxed', site: 'a.com', sites: ['a.com', 'b.com'], matches: ['*://a.com/*', '*://b.com/*'] };
  const F = { ...base, tier: 'free', site: 'a.com', sites: ['a.com'], matches: ['*://a.com/*'] };
  const at = (host, groupsOff = {}, paused = false) => S.running([M1, F], { paused, groupsOff, url: a(host) }).map(([i]) => i);
  assert.deepStrictEqual(at('a.com'), [0, 1]);
  M1 = { ...M1, ...S.setOn(M1, false, 'b.com') };
  assert.ok(M1.on); assert.deepStrictEqual(M1.offSites, ['b.com']);
  assert.deepStrictEqual(at('b.com'), []); assert.deepStrictEqual(at('a.com'), [0, 1]);
  assert.ok(!S.isOn(M1, 'b.com')); assert.ok(S.isOn(M1, 'a.com'));
  let g = S.setGroup({}, 'free', false, 'a.com');
  assert.deepStrictEqual(at('a.com', g), [0]);
  assert.deepStrictEqual([S.off(M1, g), S.off(F, g)], [['b.com'], ['a.com']]);
  g = S.setGroup(g, 'free', true, 'a.com');
  assert.deepStrictEqual(plain(g), {});
  assert.deepStrictEqual(at('a.com', g, true), []);
  // (a mod for one site: the switch is the whole mod's)
  assert.deepStrictEqual(S.setOn(F, false, 'a.com'), { on: false, offSites: [], clearNewOff: false });
});

test('gen/core.js: TrifCore.match and modStore part 3 in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.match', ctx), vm.runInContext('TrifCore.modStore', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("modStore.setGroup", JSON.stringify([{"a.com":["style"]}, "style", true, "a.com"]))', ctx), '{}');
});
