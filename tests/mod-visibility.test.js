'use strict';
// "Chats on other sites can read this site's mods" (helper/lib/visibility.js, docs/STAGING.md "Other sites'
// mods"): on by default, off by default for a sensitive site. A site that's off isn't in another site's run
// at all: not in its working folder (stage.js), denied where it is in the workspace (runs.js hiddenPaths),
// and not in what `trif status`, `trif mods`, `trif restore` and `trif history` tell the run. What a run
// needs for its own site stays: its folders, the sites it's part of, all-sites/, its phone twin.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { hiddenFrom, cleanVisibility, patternMatches, readableByOthers } = require('../helper/lib/visibility');
const { Stage } = require('../helper/lib/stage');
const { FakeExtension, tempDir, privDir, waitFor, runCli, writeMod } = require('./fake-extension');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const put = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const head = (match, body = '') => `// ==WebMod==\n// @match ${match}\n// ==/WebMod==\n${body}`;
// (a few of TRIF's sensitive patterns: agentsites.js SENSITIVE_DEFAULT)
const SENSITIVE = ['mail.google.com', 'chase.com', '*bank*', 'paypal.com'];
const SPLITS = ['mail.google.com'];
const vis = (o = {}) => ({ hidden: [], shown: [], sensitive: SENSITIVE, ...o });

test('visibility: the patterns as agentsites.js has them; the user\'s choice over the sensitive list', () => {
  assert.ok(patternMatches('chase.com', 'chase.com') && patternMatches('chase.com', 'secure.chase.com'));
  assert.ok(!patternMatches('mail.google.com', 'google.com'));
  assert.ok(patternMatches('*bank*', 'mybank.com') && patternMatches('*.bank', 'example.bank') && !patternMatches('*bank*', 'example.com'));
  const v = cleanVisibility(vis({ hidden: ['Y.com', 'www.z.com', 'not a site'], shown: ['paypal.com'] }));
  assert.deepEqual(v.hidden, ['y.com', 'z.com']);
  assert.equal(readableByOthers('y.com', v), false, 'the user set it off');
  assert.equal(readableByOthers('example.com', v), true, 'on by default');
  assert.equal(readableByOthers('chase.com', v), false, 'off by default for a sensitive site');
  assert.equal(readableByOthers('paypal.com', v), true, 'the user turned a sensitive one on');
  assert.equal(cleanVisibility(undefined), null);
  assert.equal(readableByOthers('chase.com', null), true, 'a run without visibility (an older extension): as before');
});

test('visibility: what a run hides, by where it runs (own site, the site it\'s part of, all-sites/, phone twins kept)', () => {
  // A run on example.com: sensitive sites hidden (their phone twins and www. folders with them), ordinary ones not.
  let hide = hiddenFrom({ scope: 'example.com', splits: SPLITS, visibility: vis() });
  for (const n of ['chase.com', 'phone~chase.com', 'www.chase.com', 'mail.google.com', 'phone~mail.google.com', 'mybank.com', 'paypal.com']) assert.equal(hide(n), true, n);
  for (const n of ['example.com', 'phone~example.com', 'all-sites', 'google.com', 'y.com', 'phone~y.com', 'www.instagram.com']) assert.equal(hide(n), false, n);
  // A run on google.com: its sensitive part, mail.google.com, is another site's: hidden.
  hide = hiddenFrom({ scope: 'google.com', splits: SPLITS, visibility: vis() });
  assert.equal(hide('mail.google.com'), true);
  assert.equal(hide('google.com'), false);
  // A run on mail.google.com (a sensitive site itself): its own folder and twin, and google.com, whose mods
  // run there, even with google.com set off; other sensitive sites still hidden, ordinary ones not.
  hide = hiddenFrom({ scope: 'mail.google.com', splits: SPLITS, visibility: vis({ hidden: ['google.com'] }) });
  for (const n of ['mail.google.com', 'phone~mail.google.com', 'google.com', 'phone~google.com', 'all-sites', 'y.com']) assert.equal(hide(n), false, n);
  assert.equal(hide('chase.com'), true);
  // A phone view's run (phone~chase.com): the desktop folder of its own site too.
  hide = hiddenFrom({ scope: 'phone~chase.com', splits: SPLITS, visibility: vis() });
  assert.equal(hide('chase.com'), false);
  assert.equal(hide('phone~chase.com'), false);
  assert.equal(hide('paypal.com'), true);
  // The user's choices: an ordinary site off, a sensitive one on.
  hide = hiddenFrom({ scope: 'example.com', splits: SPLITS, visibility: vis({ hidden: ['y.com'], shown: ['chase.com'] }) });
  assert.equal(hide('y.com'), true);
  assert.equal(hide('phone~y.com'), true);
  assert.equal(hide('chase.com'), false);
  // No visibility: nothing hidden.
  hide = hiddenFrom({ scope: 'example.com', splits: SPLITS });
  assert.equal(hide('chase.com'), false);
});

// A workspace: the run's site (example.com) and its twin, an ordinary site (y.com), sensitive ones (chase.com
// and its twin, mail.google.com under google.com), all-sites/, history and trash for some of them.
function workspace() {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  put(path.join(sites, 'example.com', 'mine.js'), head('https://example.com/*'));
  put(path.join(sites, 'phone~example.com', 'small.js'), head('https://example.com/*'));
  put(path.join(sites, 'y.com', 'other.js'), head('https://y.com/*', '// ordinary\n'));
  put(path.join(sites, 'chase.com', 'balance.js'), head('https://chase.com/*', '// SENSITIVE-CHASE\n'));
  put(path.join(sites, 'chase.com', 'files', 'statement.pdf'), 'PDF');
  put(path.join(sites, 'phone~chase.com', 'tiny.js'), head('https://chase.com/*', '// SENSITIVE-CHASE-PHONE\n'));
  put(path.join(sites, 'mail.google.com', 'inbox.js'), head('https://mail.google.com/*', '// SENSITIVE-MAIL\n'));
  put(path.join(sites, 'google.com', 'search.js'), head('https://www.google.com/*'));
  put(path.join(sites, 'all-sites', 'dark.js'), head('*://*/*'));
  put(path.join(home, 'history', 'chase.com', 'balance@20261101T000000000Z.js'), '// old SENSITIVE-CHASE\n');
  put(path.join(home, 'history', 'y.com', 'other@20261101T000000000Z.js'), '// old\n');
  put(path.join(home, 'trash', 'chase.com', 'gone@20261101T000000000Z.js'), '// SENSITIVE-CHASE trashed\n');
  put(path.join(home, 'trash', 'y.com', 'gone@20261101T000000000Z.js'), head('https://y.com/*'));
  put(path.join(home, 'held.json'), '{"chase.com/balance":{"site":"chase.com"}}');
  return { home, sites };
}
function stageFor({ home, sites }, { scope = 'example.com', visibility = vis(), name = 'r1' } = {}) {
  const box = path.join(home, 'boxes');
  fs.mkdirSync(box, { recursive: true });
  return new Stage({ ws: { home, modsDir: sites }, dir: path.join(box, `${name}.ws`), scope, splits: SPLITS, visibility, liveReal: fs.realpathSync(sites), settings: null }).create();
}

test('stage: a hidden site isn\'t in the run\'s copy at all, nor followed into it; what the run needs is', () => {
  const w = workspace();
  const stage = stageFor(w);
  const has = (...p) => fs.existsSync(path.join(stage.sites, ...p));
  for (const f of [['example.com', 'mine.js'], ['phone~example.com', 'small.js'], ['y.com', 'other.js'], ['google.com', 'search.js'], ['all-sites', 'dark.js']]) assert.ok(has(...f), f.join('/'));
  for (const d of ['chase.com', 'phone~chase.com', 'mail.google.com']) assert.ok(!has(d), `${d}: not even its folder`);
  assert.deepEqual([...stage.hiddenNames].sort(), ['chase.com', 'mail.google.com', 'phone~chase.com']);
  // Changed in the mods folder meanwhile: still not brought in.
  put(path.join(w.sites, 'chase.com', 'new.js'), head('https://chase.com/*'));
  assert.deepEqual(stage.sync().pulled, []);
  assert.ok(!has('chase.com'));
  // The run writing a hidden site's folder in its copy: refused, as another site's.
  put(path.join(stage.sites, 'chase.com', 'balance.js'), head('https://chase.com/*', '// overwritten\n'));
  const r = stage.sync();
  assert.deepEqual(r.pushed, []);
  assert.deepEqual(r.refused, [path.join('sites', 'chase.com', 'balance.js')]);
  assert.match(fs.readFileSync(path.join(w.sites, 'chase.com', 'balance.js'), 'utf8'), /SENSITIVE-CHASE/);
  stage.close();
  // Toggling: the next run after the user turns chase.com on has it (to read), after turning y.com off not y.com.
  const next = stageFor(w, { visibility: vis({ shown: ['chase.com'], hidden: ['y.com'] }), name: 'r2' });
  assert.ok(fs.existsSync(path.join(next.sites, 'chase.com', 'balance.js')));
  assert.ok(!fs.existsSync(path.join(next.sites, 'chase.com', 'files')), 'another site\'s files/ stay out, as before');
  assert.ok(!fs.existsSync(path.join(next.sites, 'y.com')));
  next.close();
  // A run on the sensitive site itself: its own folders, files/ too, and the ordinary sites' mods.
  const own = stageFor(w, { scope: 'chase.com', name: 'r3' });
  for (const f of [['chase.com', 'balance.js'], ['chase.com', 'files', 'statement.pdf'], ['phone~chase.com', 'tiny.js'], ['y.com', 'other.js'], ['example.com', 'mine.js']]) assert.ok(fs.existsSync(path.join(own.sites, ...f)), f.join('/'));
  assert.ok(!fs.existsSync(path.join(own.sites, 'mail.google.com')));
  own.close();
  // A run on mail.google.com: google.com's mods (they run there) and its own.
  const mail = stageFor(w, { scope: 'mail.google.com', name: 'r4', visibility: vis({ hidden: ['google.com'] }) });
  assert.ok(fs.existsSync(path.join(mail.sites, 'google.com', 'search.js')) && fs.existsSync(path.join(mail.sites, 'mail.google.com', 'inbox.js')));
  assert.ok(!fs.existsSync(path.join(mail.sites, 'chase.com')));
  mail.close();
});

test('runLimits: what a run hides is denied where it is in the workspace too (Seatbelt: Codex; Claude Code\'s Read rules)', () => {
  const w = workspace();
  const stage = stageFor(w);
  const { runLimits, hiddenPaths } = require('../helper/lib/runs');
  const claude = require('../helper/lib/agents/claude');
  const codex = require('../helper/lib/agents/codex');
  const P = require('../helper/lib/paths');
  const ws = { ...P.workspace(w.home), modsDir: w.sites };
  const box = path.join(w.home, 'boxes', 'r1');
  fs.mkdirSync(box);
  const lim = runLimits(ws, { scope: 'example.com', splits: SPLITS, box, screenshots: box, stage });
  const real = (...p) => path.join(fs.realpathSync(w.home), ...p);
  const want = [real('sites'), real('sites', 'chase.com'), real('sites', 'phone~chase.com'), real('sites', 'mail.google.com'), real('history', 'chase.com'), real('trash', 'chase.com'), real('held.json')];
  for (const p of want) assert.ok(lim.hidden.includes(p) && lim.denied.includes(p), p);
  for (const p of [real('history', 'y.com'), real('trash', 'y.com'), real('sites', 'y.com')]) assert.ok(!lim.hidden.includes(p), p);
  assert.ok(lim.readOnly.includes(path.join(stage.sites, 'y.com')), 'an ordinary site\'s mods: read-only in the copy, as before');
  const perm = codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).args.find((a) => a.startsWith('permissions='));
  for (const p of [real('sites'), real('history', 'chase.com'), real('held.json')]) assert.ok(perm.includes(`${JSON.stringify(p)} = "deny"`), perm);
  const settings = JSON.parse(claude.command({ bin: '/x/claude', prompt: 'P', ...lim }).files[0].content);
  for (const p of [real('sites', 'chase.com'), real('trash', 'chase.com')]) {
    assert.ok(settings.permissions.deny.includes(`Read(/${p}/**)`), p);
    assert.ok(settings.sandbox.filesystem.denyRead.includes(p), p);
  }
  stage.close();
  // A run that hides nothing (no sensitive site with mods, nothing set off): the workspace as before.
  const plain = stageFor(w, { visibility: vis({ shown: ['chase.com', 'mail.google.com'] }), name: 'r5' });
  assert.deepEqual(hiddenPaths(ws, fs.realpathSync(w.sites), plain), []);
  const lim2 = runLimits(ws, { scope: 'example.com', splits: SPLITS, box, screenshots: box, stage: plain });
  assert.ok(!lim2.denied.includes(real('sites')));
  plain.close();
});

// ------------------------------------------------------------------ through the helper

// A stand-in Claude Code that writes down how it was started and waits (the test runs `trif` as the run would).
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(__dirname, 'call.json'), JSON.stringify({ cwd: process.cwd(), env: process.env }));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }) + '\\n');
setInterval(() => {}, 1000);
`;

test('a run on example.com: trif mods, status, restore and history say nothing of a hidden site; an ordinary site\'s mods are there to read', async () => {
  const h = tempDir();
  const bin = path.join(h, 'fakebin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), FAKE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(privDir(h), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  writeMod(h, 'example.com', 'mine.js', head('https://example.com/*'));
  writeMod(h, 'y.com', 'other.js', head('https://y.com/*'));
  writeMod(h, 'chase.com', 'balance.js', head('https://chase.com/*', '// SENSITIVE\n'));
  writeMod(h, 'phone~chase.com', 'tiny.js', head('https://chase.com/*'));
  writeMod(h, 'mail.google.com', 'inbox.js', head('https://mail.google.com/*'));
  put(path.join(h, 'trash', 'chase.com', 'gone@20261101T000000000Z.js'), head('https://chase.com/*'));
  put(path.join(h, 'trash', 'y.com', 'old@20261101T000000000Z.js'), head('https://y.com/*'));
  put(path.join(h, 'history', 'chase.com', 'balance@20261101T000000000Z.js'), '// before');
  const ext = new FakeExtension({ home: h, env: { TRIF_AGENT_KILL_GRACE_MS: '400' } });
  cleanups.push(() => ext.close());
  ext.handlers = {
    // (every site's, as the extension's status has them: the helper takes out what the run may not see)
    status: () => ({
      userScripts: true, version: '0', mods: [
        { id: 'example.com/mine', registered: true, enabled: true },
        { id: 'y.com/other', registered: true, enabled: false },
        { id: 'chase.com/balance', registered: true, enabled: true },
        { id: 'phone~chase.com/tiny', registered: true, enabled: true },
        { id: 'mail.google.com/inbox', registered: true, enabled: true },
        { id: 'all-sites/dark', registered: true, enabled: true, offSites: ['chase.com', 'y.com'] },
      ],
      sitesOn: ['chase.com', 'example.com', 'mail.google.com', 'y.com'], disconnected: ['chase.com'], blockedSites: ['paypal.com'], sensitiveBlocked: ['paypal.com'],
      groupsOff: { 'chase.com': ['rules'], 'y.com': ['rules'] }, recording: ['chase.com'], access: { all: false, allUrls: false, origins: ['*://*.chase.com/*', '*://*.y.com/*'] },
    }),
  };
  ext.hello();
  await ext.waitForSocket();
  let n = 0;
  const ask = (cmd, args = {}) => { const id = `v${++n}`; ext.send({ type: 'request', id, cmd, args }); return ext.next((m) => m.type === 'response' && m.id === id); };
  const r = await ask('agent.start', { agent: 'claude', site: 'example.com', url: 'https://example.com/page', tabId: 12, prompt: 'look', splits: SPLITS, visibility: vis() });
  assert.equal(r.ok, true, r.error);
  const call = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(bin, 'call.json'), 'utf8')); } catch { return null; } }, { message: 'the agent to start' });
  const env = { TRIF_RUN_TOKEN: call.env.TRIF_RUN_TOKEN, TRIF_RUN_BOX: call.env.TRIF_RUN_BOX, TRIF_RUN_MODS_DIR: call.env.TRIF_RUN_MODS_DIR, TRIF_RUN_LIVE_MODS_DIR: call.env.TRIF_RUN_LIVE_MODS_DIR };
  const SECRET_SITES = /chase\.com|mail\.google\.com/;
  // trif mods: its copy's, the ordinary site's among them, no hidden one.
  const mods = await runCli(['mods', '--json'], { home: h, env });
  assert.equal(mods.code, 0, mods.stderr);
  const ids = JSON.parse(mods.stdout).mods.map((m) => m.id).sort();
  assert.deepEqual(ids, ['example.com/mine', 'y.com/other']);
  // Reading an ordinary site's mod by the mods folder's path: the same file in the copy.
  const chk = await runCli(['check', path.join(h, 'sites', 'y.com', 'other.js')], { home: h, env });
  assert.equal(chk.code, 0, chk.stderr);
  // A hidden one: nothing there to read.
  const chk2 = await runCli(['check', path.join(h, 'sites', 'chase.com', 'balance.js')], { home: h, env });
  assert.notEqual(chk2.code, 0);
  assert.ok(!/SENSITIVE/.test(chk2.stdout + chk2.stderr));
  // trif status: the extension's lists without the hidden sites.
  const st = await runCli(['status', '--json'], { home: h, env });
  assert.equal(st.code, 0, st.stderr);
  const ext2 = JSON.parse(st.stdout).extension;
  assert.deepEqual(ext2.mods.map((m) => m.id).sort(), ['all-sites/dark', 'example.com/mine', 'y.com/other']);
  assert.deepEqual(ext2.mods.find((m) => m.id === 'all-sites/dark').offSites, ['y.com']);
  assert.deepEqual(ext2.sitesOn, ['example.com', 'y.com']);
  assert.deepEqual(ext2.disconnected, []);
  assert.deepEqual(ext2.blockedSites, []);
  assert.deepEqual(Object.keys(ext2.groupsOff), ['y.com']);
  assert.deepEqual(ext2.recording, []);
  assert.deepEqual(ext2.access.origins, ['*://*.y.com/*']);
  const stText = await runCli(['status'], { home: h, env });
  assert.ok(!SECRET_SITES.test(stText.stdout), stText.stdout);
  // trif restore (the trash) and trif history: only sites in its copy.
  const tr = await runCli(['restore', '--json'], { home: h, env });
  assert.equal(tr.code, 0, tr.stderr);
  assert.deepEqual(JSON.parse(tr.stdout).trash.map((t) => t.id), ['y.com/old']);
  const hi = await runCli(['history', 'chase.com/balance', '--json'], { home: h, env });
  assert.deepEqual(JSON.parse(hi.stdout).entries, []);
  // The user's own terminal (no run): everything, as before.
  const mine = await runCli(['restore', '--json'], { home: h });
  assert.deepEqual(JSON.parse(mine.stdout).trash.map((t) => t.id).sort(), ['chase.com/gone', 'y.com/old']);
  const mySt = await runCli(['status', '--json'], { home: h });
  assert.ok(JSON.parse(mySt.stdout).extension.mods.some((m) => m.id === 'chase.com/balance'));
  await ask('agent.stop', { runId: r.result.runId });
  await ext.next((m) => m.type === 'agentEvent' && m.runId === r.result.runId && m.event.kind === 'done', { timeout: 8000 });
});

test('a run without visibility of its own (the terminal, a phone): as the browsers last said (switches.json)', async () => {
  const sc = require('../helper/lib/sitecombos');
  const h = tempDir();
  sc.saveSwitches(h, 'chrome:1', [], [], SPLITS, vis({ hidden: ['y.com'] }));
  sc.saveSwitches(h, 'firefox:2', [], [], SPLITS, vis({ shown: ['y.com', 'chase.com'] }));
  const v = sc.visibilityOf(h);
  assert.deepEqual(v.hidden, ['y.com'], 'hidden in one browser: hidden');
  assert.deepEqual(v.shown, ['chase.com']);
  assert.deepEqual(v.sensitive, [...SENSITIVE].sort());
  // (an entry saved without it keeps the one before)
  sc.saveSwitches(h, 'chrome:1', ['a/b'], [], SPLITS);
  assert.deepEqual(sc.visibilityOf(h).hidden, ['y.com']);
  assert.equal(sc.visibilityOf(tempDir()), null);
});
