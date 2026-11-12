'use strict';
// Sensitive sites, each a site of its own (extension/lib.js "sensitive sites"; Tim, 2026-11-11): the scope
// split, their state, which mods run there, the upgrade's plan, the mods box's fold, and the helper's side
// (a run's scope and folder, the free-mod hold on Off sites, Keep TRIF on there's copies). The background's
// part: tests/extension.test.js ("sensitive sites"); the panel in the browsers: tests/e2e/scenario.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./fake-extension');
const scope = require('../helper/lib/scope');
const { runLimits, modSnapshot } = require('../helper/lib/runs');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, loadAllowed, loadHeld, allowPowers } = require('../helper/lib/held');
const { splitSensitive } = require('../helper/lib/split');
const { deleteMod } = require('../helper/lib/trash');
const P = require('../helper/lib/paths');

const lib = () => import('../extension/lib.js');

test('the scope split: a sensitive host under a registrable domain is a site of its own; a sensitive registrable domain already is; patterns split at their label', async () => {
  const L = await lib();
  const m = L.sensitiveSites();
  for (const [h, want] of [
    ['mail.google.com', 'mail.google.com'], ['inbox.mail.google.com', 'mail.google.com'], ['www.google.com', 'google.com'], ['maps.google.com', 'google.com'],
    ['outlook.live.com', 'outlook.live.com'], ['live.com', 'live.com'], ['www.paypal.com', 'paypal.com'], ['dashboard.stripe.com', 'dashboard.stripe.com'],
    ['stripe.com', 'stripe.com'], ['secure.netbank.example.com', 'netbank.example.com'], ['online.bankofamerica.com', 'bankofamerica.com'],
    ['x.example.bank', 'example.bank'], ['barclays.co.uk', 'barclays.co.uk'], ['news.bbc.co.uk', 'bbc.co.uk'],
  ]) assert.equal(m.scopeOf(h), want, h);
  assert.equal(m.isSensitive('mail.google.com'), true);
  assert.equal(m.isSensitive('google.com'), false);
  assert.equal(m.isSensitive('paypal.com'), true);
  assert.equal(m.whyOf('mail.google.com'), 'email');
  assert.ok(m.splits.includes('mail.google.com') && m.splits.includes('outlook.live.com') && !m.splits.includes('paypal.com'), m.splits.join());
  // (a pattern's host is one of its own once TRIF knows of it)
  assert.ok(!m.splits.includes('netbank.example.com'));
  assert.ok(L.sensitiveSites({ hosts: ['netbank.example.com'] }).splits.includes('netbank.example.com'));
  // the user's list (Settings): theirs instead of TRIF's
  const mine = L.sensitiveSites({ list: [{ pattern: 'drive.google.com', why: 'my files' }] });
  assert.equal(mine.scopeOf('mail.google.com'), 'google.com');
  assert.equal(mine.scopeOf('drive.google.com'), 'drive.google.com');
  // (several match: the one that covers most)
  assert.equal(L.sensitiveSites({ list: [{ pattern: 'google.com' }, { pattern: 'mail.google.com' }] }).scopeOf('mail.google.com'), 'google.com');
  // a host the upgrade is asking about stays part of its parent until answered
  const pending = L.sensitiveSites({ pending: ['mail.google.com'] });
  assert.equal(pending.scopeOf('mail.google.com'), 'google.com');
  assert.ok(!pending.splits.includes('mail.google.com'));
  // what TRIF can block from the start: the list's own hosts
  assert.ok(L.sensitiveListSites().includes('mail.google.com') && L.sensitiveListSites().includes('paypal.com') && !L.sensitiveListSites().some((x) => x.includes('*')));
  // the run's site on the panel
  assert.equal(L.siteOnFor('https://mail.google.com/', ['google.com'], m), null);
  assert.equal(L.siteOnFor('https://maps.google.com/', ['google.com'], m), 'google.com');
  assert.equal(L.siteOnFor('https://mail.google.com/', ['google.com', 'mail.google.com'], m), 'mail.google.com');
  assert.equal(L.siteOnFor('https://mail.google.com/', ['google.com']), 'google.com', '(without the model: as before)');
  // stored lists keep the host as it is
  assert.deepEqual(L.normalizeSiteList(['mail.google.com', 'WWW.X.com', 'x.com', 'bad site', 3]), ['mail.google.com', 'x.com']);
});

test('a sensitive site\'s state: blocked, off (the parent\'s access covers it), on, or disconnected without access', async () => {
  const L = await lib();
  const parent = L.normalizeAccess({ origins: L.siteOrigins('google.com') });
  assert.equal(L.siteState('mail.google.com', { sitesOn: ['google.com'], access: parent, blocked: ['mail.google.com'] }), 'blocked');
  assert.equal(L.siteState('mail.google.com', { sitesOn: ['google.com'], access: parent, blocked: [] }), 'off', 'google.com on doesn\'t turn it on');
  assert.equal(L.siteState('mail.google.com', { sitesOn: ['mail.google.com'], access: parent, blocked: [] }), 'on');
  assert.equal(L.siteState('google.com', { sitesOn: ['google.com'], access: parent, blocked: ['mail.google.com'] }), 'on', 'blocking it leaves its parent');
  assert.equal(L.siteState('mail.google.com', { sitesOn: ['mail.google.com'], access: L.normalizeAccess({ origins: [] }), blocked: [] }), 'disconnected');
  // its own access is its own origin, not its parent's
  assert.deepEqual(L.siteOrigins('mail.google.com'), ['*://*.mail.google.com/*']);
  assert.equal(L.hasSiteAccess(L.normalizeAccess({ origins: L.siteOrigins('mail.google.com') }), 'google.com'), false);
  assert.match(L.siteRefusal('mail.google.com', 'blocked'), /^mail\.google\.com is blocked in TRIF/);
});

test('which mods run on a sensitive site: only its own, and they run only there; the parent\'s and all-sites mods skip it', async () => {
  const L = await lib();
  const m = L.sensitiveSites();
  const on = ['google.com', 'mail.google.com', 'x.com', 'paypal.com'];
  const mod = (id, matches) => ({ id, matches, hash: 'h' });
  const parent = L.limitToSites(mod('google.com/dark', ['*://*.google.com/*']), on, m);
  assert.deepEqual(parent.matches, ['*://*.google.com/*']);
  assert.deepEqual(parent.excludes, ['*://*.mail.google.com/*', '*://mail.google.com/*']);
  assert.match(parent.hash, /\|apart:/, 'it re-registers when the sites apart change');
  assert.equal(L.limitToSites(mod('google.com/gmail', ['*://mail.google.com/*']), on, m), null, 'a parent\'s mod for the host: nowhere');
  const own = L.limitToSites(mod('mail.google.com/calm', ['*://*.google.com/*', '*://www.google.com/*']), on, m);
  assert.deepEqual(own.matches, ['*://*.mail.google.com/*', '*://mail.google.com/*'], 'its own mod: only there');
  assert.equal(own.excludes, undefined);
  const all = L.limitToSites(mod('all-sites/big', ['*://*/*']), on, m);
  assert.deepEqual(all.usedSites, ['google.com', 'x.com'], 'all-sites mods skip sensitive sites (paypal.com too)');
  assert.deepEqual(all.excludes, ['*://*.mail.google.com/*', '*://mail.google.com/*']);
  assert.ok(L.limitToSites(mod('paypal.com/a', ['*://*.paypal.com/*']), on, m), 'a sensitive registrable domain\'s own mod');
  assert.equal(L.limitToSites(mod('x.com/pp', ['*://*.x.com/*', '*://paypal.com/*']), ['paypal.com'], m), null, 'another site\'s mod naming it: not there');
  // only mail.google.com on: google.com's mods don't run anywhere, its own do
  assert.equal(L.limitToSites(mod('google.com/dark', ['*://*.google.com/*']), ['mail.google.com'], m), null);
  // the runtime skips the sites apart no registered mod runs on
  assert.deepEqual(L.runtimeExcludes([parent, all], [], m), ['*://*.mail.google.com/*', '*://mail.google.com/*']);
  assert.deepEqual(L.runtimeExcludes([parent, own], [], m), []);
  assert.deepEqual(L.runtimeExcludes([parent], []), []);
  // a run's code meeting a site apart (lib.js pageGuard, as the page runs it)
  const guard = (href, ...a) => { const g = globalThis.location; globalThis.location = { href }; try { return L.pageGuard(...a); } finally { globalThis.location = g; } };
  assert.equal(guard('https://maps.google.com/', 'google.com', ['google.com'], null, ['mail.google.com']), null);
  assert.match(guard('https://mail.google.com/', 'google.com', ['google.com'], null, ['mail.google.com']), /a site of its own, and this agent run is limited to google\.com/);
});

test('the upgrade\'s plan: a new user\'s sensitive sites are blocked; one the user\'s mods reach is asked about; one in use is left; once each', async () => {
  const L = await lib();
  const hosts = L.sensitiveListSites();
  const mod = (id, matches) => ({ id, matches });
  // a new user: every one blocked, all recorded as done
  let p = L.sensitivePlan({ hosts });
  assert.ok(p.block.includes('mail.google.com') && p.block.includes('paypal.com'));
  assert.deepEqual(p.ask, []);
  assert.deepEqual([...p.done].sort(), [...hosts].sort());
  // TRIF on for google.com, one of its mods reaching mail.google.com: asked, with the parent's mods that match it
  const mods = [mod('google.com/dark', ['*://*.google.com/*']), mod('google.com/maps', ['*://maps.google.com/*']), mod('www.google.com/x', ['*://www.google.com/*', '*://mail.google.com/inbox/*']), mod('all-sites/big', ['<all_urls>'])];
  p = L.sensitivePlan({ hosts, mods, sitesOn: ['google.com'] });
  assert.deepEqual(p.ask, [{ host: 'mail.google.com', parent: 'google.com', why: 'email', mods: ['google.com/dark', 'www.google.com/x'], allSites: ['all-sites/big'] }]);
  assert.ok(!p.block.includes('mail.google.com') && p.done.includes('mail.google.com'));
  // the parent off, or its only reaching mod switched off: nothing reaches it, so blocked
  assert.ok(L.sensitivePlan({ hosts, mods, sitesOn: [] }).block.includes('mail.google.com'));
  assert.ok(L.sensitivePlan({ hosts, mods: [mods[0]], disabled: { 'google.com/dark': true }, sitesOn: ['google.com'] }).block.includes('mail.google.com'));
  // mods in its own folder: asked, whatever's on
  p = L.sensitivePlan({ hosts: ['mail.google.com'], mods: [mod('mail.google.com/calm', ['*://mail.google.com/*'])] });
  assert.deepEqual(p.ask.map((x) => [x.host, x.mods]), [['mail.google.com', []]]);
  // a sensitive registrable domain that's on, or has mods of its own: left as it is
  p = L.sensitivePlan({ hosts: ['paypal.com', 'chase.com'], mods: [mod('chase.com/a', ['*://chase.com/*'])], sitesOn: ['paypal.com'] });
  assert.deepEqual([p.block, p.ask, p.done], [[], [], ['paypal.com', 'chase.com']]);
  // done, asked about or blocked already: skipped
  p = L.sensitivePlan({ hosts: ['mail.google.com', 'paypal.com', 'chase.com'], done: ['mail.google.com'], pending: ['paypal.com'], blocked: ['chase.com'] });
  assert.deepEqual([p.block, p.ask, p.done], [[], [], []]);
  // a wildcard pattern's host, as a tab shows it
  p = L.sensitivePlan({ hosts: ['secure.netbank.example.com'] });
  assert.deepEqual(p.block, ['netbank.example.com']);
  // (what storage keeps of the question)
  assert.deepEqual(L.normalizePending([{ host: 'Mail.Google.com', why: 'email', mods: ['google.com/a', 3] }, { host: 'mail.google.com' }, null]),
    [{ host: 'mail.google.com', parent: 'google.com', why: 'email', mods: ['google.com/a'], allSites: [] }]);
});

test('the mods box: mods for other pages of the site fold into one line, in their order; held ones stay', async () => {
  const L = await lib();
  const mods = [
    { id: 'google.com/search', matches: ['*://www.google.com/search*'] }, { id: 'google.com/maps', matches: ['*://maps.google.com/*'] },
    { id: 'google.com/all', matches: ['*://*.google.com/*'] }, { id: 'google.com/held', matches: ['*://maps.google.com/*'], held: { reason: 'x' } },
    { id: 'google.com/dark-maps', matches: ['*://*.google.com/*'], excludes: ['*://www.google.com/*'] },
  ];
  const { here, other } = L.splitForPage(mods, 'https://www.google.com/search?q=x');
  assert.deepEqual(here.map((m) => m.id), ['google.com/search', 'google.com/all', 'google.com/held']);
  assert.deepEqual(other.map((m) => m.id), ['google.com/maps', 'google.com/dark-maps']);
  assert.deepEqual(L.splitForPage(mods, '').here.map((m) => m.id), ['google.com/held']);
});

// ---- the helper's side ----------------------------------------------------------------------------------

test('a run\'s scope: the host the extension sends when it\'s part of the site; folders by scopeOf', () => {
  assert.equal(scope.runScope('mail.google.com', 'mail.google.com'), 'mail.google.com');
  assert.equal(scope.runScope('inbox.mail.google.com', 'mail.google.com'), 'mail.google.com');
  assert.equal(scope.runScope('mail.google.com', undefined), 'google.com', '(an older extension: as before)');
  assert.equal(scope.runScope('mail.google.com', 'x.com'), 'google.com', 'never another site');
  assert.equal(scope.runScope('mail.google.com', 'com'), 'google.com');
  assert.equal(scope.runScope('www.google.com', 'google.com'), 'google.com');
  assert.equal(scope.scopeOf('mail.google.com', ['mail.google.com']), 'mail.google.com');
  assert.equal(scope.scopeOf('google.com', ['mail.google.com']), 'google.com');
  assert.equal(scope.scopeOf('mail.google.com', []), 'google.com');
  assert.deepEqual(scope.cleanSplits(['mail.google.com', 'google.com', 'WWW.Outlook.live.com', '../x', 'a b']), ['mail.google.com', 'outlook.live.com']);
});

function withHome(h, fn) {
  const old = process.env.HOME;
  process.env.HOME = h;
  try { return fn(); } finally { process.env.HOME = old; }
}
function runHome() {
  const h = fs.realpathSync(tempDir('trif-sens-'));
  const trif = path.join(h, '.trif');
  const box = path.join(h, 'Library', 'Caches', 'TRIF', 'boxes', 'r1');
  for (const d of ['google.com', 'mail.google.com', 'maps.google.com', 'x.com'].map((s) => path.join(trif, 'sites', s))) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(box, { recursive: true });
  const ws = withHome(h, () => P.workspace(trif));
  return { h, ws, box };
}

test('the sandbox: a run on mail.google.com can\'t write sites/google.com/, and a google.com run can\'t write sites/mail.google.com/', () => {
  const { h, ws, box } = runHome();
  const sites = fs.realpathSync(ws.modsDir);
  const lim = (s) => withHome(h, () => runLimits(ws, { scope: s, splits: ['mail.google.com'], box, screenshots: path.join(ws.private, 'screenshots', s) }));
  const mail = lim('mail.google.com');
  assert.ok(mail.readOnly.includes(path.join(sites, 'google.com')), mail.readOnly.join());
  assert.ok(mail.readOnly.includes(path.join(sites, 'maps.google.com')));
  assert.ok(!mail.readOnly.includes(path.join(sites, 'mail.google.com')), 'its own folder it may write');
  assert.ok(mail.locked.includes(path.join('sites', 'google.com')));
  const google = lim('google.com');
  assert.ok(google.readOnly.includes(path.join(sites, 'mail.google.com')), google.readOnly.join());
  assert.ok(!google.readOnly.includes(path.join(sites, 'google.com')) && !google.readOnly.includes(path.join(sites, 'maps.google.com')));
  // (without the split, as before: one site)
  const before = withHome(h, () => runLimits(ws, { scope: 'google.com', box, screenshots: path.join(ws.private, 'screenshots', 'google.com') }));
  assert.ok(!before.readOnly.includes(path.join(sites, 'mail.google.com')));
  // trif delete from a google.com run: not a mod of mail.google.com's folder, whatever its @match
  fs.writeFileSync(path.join(ws.modsDir, 'mail.google.com', 'calm.js'), '// ==WebMod==\n// @match *://*.google.com/*\n// ==/WebMod==\n');
  assert.throws(() => deleteMod(ws, 'mail.google.com/calm', { scope: 'google.com', splits: ['mail.google.com'] }), /another site's/);
  fs.writeFileSync(path.join(ws.modsDir, 'google.com', 'dark.js'), '// ==WebMod==\n// @match *://*.google.com/*\n// ==/WebMod==\n');
  assert.throws(() => deleteMod(ws, 'google.com/dark', { scope: 'mail.google.com', splits: ['mail.google.com'] }), /another site's|only delete mods that stay/);
});

test('on a site whose agent level is Off, a free mod a run writes is held, refused; style and boxed mods aren\'t', () => {
  const home = tempDir('trif-sens-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'mail.google.com'), { recursive: true });
  updateHeld(ws, [], []); // (the first sync)
  const before = modSnapshot(ws.modsDir, ws.home);
  const w = (n, text) => fs.writeFileSync(path.join(ws.modsDir, 'mail.google.com', n), text);
  w('free.js', '// ==WebMod==\n// @name Free\n// ==/WebMod==\ndocument.title = "x";\n');
  w('style.js', '// ==WebMod==\n// @name Style\n// @style\n// ==/WebMod==\n{ "hide": [".ads"] }\n');
  w('boxed.js', '// ==WebMod==\n// @name Boxed\n// @boxed\n// ==/WebMod==\ntrif.hide(".ads");\n');
  const mods = scanMods(ws.modsDir).mods;
  assert.equal(mods.length, 3, JSON.stringify(scanMods(ws.modsDir).problems));
  const off = [{ runId: 'r1', site: 'mail.google.com', scope: 'mail.google.com', agentLevel: 'off', before }];
  let held = updateHeld(ws, mods, off);
  assert.deepEqual(Object.keys(held), ['mail.google.com/free']);
  assert.deepEqual(held['mail.google.com/free'].needs, ['agent-off-free']);
  assert.equal(held['mail.google.com/free'].reason, 'is a free mod, and "Agent on this site" is Off for mail.google.com: there your agent may only make style mods and boxed mods');
  // still held once the run is over (until the user allows it, changes the level, or edits it themselves)
  assert.deepEqual(Object.keys(updateHeld(ws, mods, [])), ['mail.google.com/free']);
  // the same run at another level: not held for this
  const home2 = tempDir('trif-sens-');
  const ws2 = { home: home2, modsDir: path.join(home2, 'sites') };
  fs.mkdirSync(path.join(ws2.modsDir, 'x.com'), { recursive: true });
  updateHeld(ws2, [], []);
  const b2 = modSnapshot(ws2.modsDir, ws2.home);
  fs.writeFileSync(path.join(ws2.modsDir, 'x.com', 'free.js'), '// ==WebMod==\n// @name Free\n// ==/WebMod==\ndocument.title = "x";\n');
  assert.deepEqual(updateHeld(ws2, scanMods(ws2.modsDir).mods, [{ runId: 'r2', site: 'x.com', scope: 'x.com', agentLevel: 'look', before: b2 }]), {});
  // the user's Allow lets it run
  approveHeld(home, 'mail.google.com/free');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
});

test('Keep TRIF on there: the parent\'s mods copied into the host\'s folder, names kept (a clash keeps both), with what was allowed, seen and held', () => {
  const home = tempDir('trif-sens-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  for (const d of ['google.com', 'www.google.com', 'mail.google.com', 'x.com']) fs.mkdirSync(path.join(ws.modsDir, d), { recursive: true });
  const text = (n, extra = '') => `// ==WebMod==\n// @name ${n}\n// @match *://*.google.com/*\n// ==/WebMod==\n${extra}`;
  fs.writeFileSync(path.join(ws.modsDir, 'google.com', 'dark.js'), text('Dark'));
  fs.writeFileSync(path.join(ws.modsDir, 'google.com', 'sender.js'), text('Sender', 'fetch("/x", { method: "POST" });\n'));
  fs.writeFileSync(path.join(ws.modsDir, 'www.google.com', 'calm.js'), text('Calm'));
  fs.writeFileSync(path.join(ws.modsDir, 'mail.google.com', 'dark.js'), text('Dark (mine)'));
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'other.js'), text('Other'));
  updateHeld(ws, scanMods(ws.modsDir).mods, []); // (the user's mods as they are)
  allowPowers(home, 'google.com/sender', ['send']);
  const before = fs.readFileSync(path.join(ws.modsDir, 'google.com', 'dark.js'), 'utf8');
  const r = splitSensitive(ws, 'mail.google.com', ['google.com/dark', 'google.com/sender', 'www.google.com/calm', 'x.com/other', 'mail.google.com/dark', 'google.com/../x', 'google.com/gone']);
  assert.deepEqual(r.copies, [
    { from: 'google.com/dark', to: 'mail.google.com/dark-2' },
    { from: 'google.com/sender', to: 'mail.google.com/sender' },
    { from: 'www.google.com/calm', to: 'mail.google.com/calm' },
  ], 'other sites\', the host\'s own, paths and missing ones skipped');
  assert.equal(fs.readFileSync(path.join(ws.modsDir, 'mail.google.com', 'dark-2.js'), 'utf8'), before, 'a copy, the same file');
  assert.match(fs.readFileSync(path.join(ws.modsDir, 'mail.google.com', 'dark.js'), 'utf8'), /Dark \(mine\)/, 'theirs kept');
  assert.equal(fs.readFileSync(path.join(ws.modsDir, 'google.com', 'dark.js'), 'utf8'), before, 'the original stays');
  assert.deepEqual(loadAllowed(home)['mail.google.com/sender'].powers, loadAllowed(home)['google.com/sender'].powers, 'what was allowed, carried');
  const seen = JSON.parse(fs.readFileSync(path.join(home, 'seen.json'), 'utf8'));
  assert.ok(seen['mail.google.com/calm'] && seen['mail.google.com/dark-2']);
  // the next sync: the copies run (nothing new to allow), and each is a mod of its own from then on
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  fs.appendFileSync(path.join(ws.modsDir, 'mail.google.com', 'dark-2.js'), '// mine now\n');
  assert.equal(fs.readFileSync(path.join(ws.modsDir, 'google.com', 'dark.js'), 'utf8'), before);
  // a hold goes with it
  const held = loadHeld(home);
  held['google.com/dark'] = { hash: 'x', site: 'google.com', reason: 'r', facts: ['r'], needs: ['send'] };
  require('../helper/lib/held').saveHeld(home, held);
  const r2 = splitSensitive(ws, 'mail.google.com', ['google.com/dark']);
  assert.deepEqual(r2.copies, [{ from: 'google.com/dark', to: 'mail.google.com/dark-3' }]);
  assert.equal(loadHeld(home)['mail.google.com/dark-3'].site, 'mail.google.com');
  // never a registrable domain, never nonsense
  assert.throws(() => splitSensitive(ws, 'google.com', []), /can be a site of its own/);
  assert.throws(() => splitSensitive(ws, '../etc', []), /can be a site of its own/);
});
