'use strict';
// A run's own working folder (helper/lib/stage.js, docs/STAGING.md): the run writes its copy of the
// workspace, never the mods folder; the helper copies its changes over as they're saved, and which changes
// are the run's is what it copied. Unit tests of the copy, then runs through the helper with a stand-in agent.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Stage, ownFolder } = require('../helper/lib/stage');
const { FakeExtension, tempDir, privDir, waitFor, sleep, runCli, writeMod } = require('./fake-extension');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const put = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const read = (f) => fs.readFileSync(f, 'utf8');
const head = (match, body = '') => `// ==WebMod==\n// @match ${match}\n// ==/WebMod==\n${body}`;

// A workspace with mods for the run's site (x.com, and a part of it), another site's, all-sites/, a
// sensitive site of its own (mail.x.com), files, the guides and .shipped/; and a stage made from it.
function setup({ scope = 'x.com', splits = ['mail.x.com'] } = {}) {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  put(path.join(home, 'AGENTS.md'), '# guide');
  put(path.join(home, 'CLAUDE.md'), '@AGENTS.md');
  put(path.join(home, 'instructions.md'), 'be brief');
  put(path.join(home, 'allowed.json'), '{}');
  put(path.join(home, '.shipped', 'x.com', 'tidy.js'), '// shipped');
  put(path.join(sites, 'x.com', 'tidy.js'), head('https://x.com/*', '// tidy\n'));
  put(path.join(sites, 'x.com', 'files', 'beep.mp3'), 'BEEP');
  put(path.join(sites, 'x.com', '_notes.md'), 'notes');
  put(path.join(sites, 'pro.x.com', 'pro.js'), head('https://pro.x.com/*'));
  put(path.join(sites, 'mail.x.com', 'inbox.js'), head('https://mail.x.com/*'));
  put(path.join(sites, 'y.com', 'other.js'), head('https://y.com/*'));
  put(path.join(sites, 'y.com', 'files', 'big.bin'), 'Y-FILE');
  put(path.join(sites, 'all-sites', 'dark.js'), head('*://*/*'));
  put(path.join(sites, 'x.com', 'CLAUDE.md'), 'planted instructions');
  fs.mkdirSync(path.join(sites, 'empty.org'));
  fs.symlinkSync(path.join(home, 'allowed.json'), path.join(sites, 'x.com', 'link.js'));
  const outside = put(path.join(home, 'secret.txt'), 'SECRET');
  const ws = { home, modsDir: sites };
  const box = path.join(home, 'boxes');
  fs.mkdirSync(box);
  const warnings = [];
  const logger = { info() {}, warn: (m) => warnings.push(m) };
  const stage = new Stage({ ws, dir: path.join(box, 'r1.ws'), scope, splits, liveReal: fs.realpathSync(sites), settings: '{"permissions":{}}\n', logger }).create();
  return { home, sites, ws, stage, outside, warnings, s: (...p) => path.join(stage.sites, ...p), l: (...p) => path.join(sites, ...p) };
}

test('stage: the run\'s copy has the guides, .shipped and every site folder; another site\'s files/, links and instruction files stay out', () => {
  const { stage, s } = setup();
  assert.equal(read(path.join(stage.dir, 'AGENTS.md')), '# guide');
  assert.equal(read(path.join(stage.dir, 'CLAUDE.md')), '@AGENTS.md');
  assert.equal(read(path.join(stage.dir, 'instructions.md')), 'be brief');
  assert.equal(read(path.join(stage.dir, '.claude', 'settings.json')), '{"permissions":{}}\n');
  assert.equal(read(path.join(stage.dir, '.shipped', 'x.com', 'tidy.js')), '// shipped');
  assert.ok(!fs.existsSync(path.join(stage.dir, 'allowed.json')), 'TRIF\'s state files aren\'t in it');
  for (const f of [['x.com', 'tidy.js'], ['x.com', 'files', 'beep.mp3'], ['x.com', '_notes.md'], ['pro.x.com', 'pro.js'], ['mail.x.com', 'inbox.js'], ['y.com', 'other.js'], ['all-sites', 'dark.js']]) {
    assert.ok(fs.lstatSync(s(...f)).isFile(), f.join('/'));
  }
  assert.ok(fs.statSync(s('empty.org')).isDirectory(), 'an empty site folder too');
  assert.ok(!fs.existsSync(s('y.com', 'files')), 'another site\'s files');
  assert.ok(!fs.existsSync(s('x.com', 'CLAUDE.md')), 'instructions planted in the mods folder');
  assert.ok(!fs.existsSync(s('x.com', 'link.js')), 'a link');
  assert.deepEqual([...stage.otherAtStart].sort(), ['empty.org', 'mail.x.com', 'y.com']);
  assert.ok(ownFolder('pro.x.com', 'x.com', ['mail.x.com']) && ownFolder('all-sites', 'x.com') && !ownFolder('mail.x.com', 'x.com', ['mail.x.com']));
  // (a sensitive site's own run: its folder is the run's, the parent's isn't)
  assert.ok(ownFolder('mail.x.com', 'mail.x.com', ['mail.x.com']) && !ownFolder('x.com', 'mail.x.com', ['mail.x.com']));
});

test('stage: the run\'s changes reach the mods folder as facts (written), its other sites\' and refused ones don\'t', () => {
  const { home, stage, s, l, outside, warnings } = setup();
  put(s('x.com', 'new.js'), head('https://x.com/*', '// new\n'));
  fs.appendFileSync(s('x.com', 'tidy.js'), '// edited by the run\n');
  put(s('all-sites', 'dark.js'), head('*://*/*', '// darker\n'));
  put(s('x.com', 'files', 'made.txt'), 'made');
  put(s('y.com', 'sneaky.js'), head('https://y.com/*')); // (read-only to the sandboxes; refused here too)
  put(s('x.com', 'AGENTS.md'), 'for the next run'); // (instructions)
  put(s('loose.js'), 'directly in sites/');
  put(s('fresh.org', 'a.js'), head('https://fresh.org/*')); // (a new folder for another site: copied, held as today)
  fs.linkSync(outside, s('x.com', 'hard.js')); // (a hard link to a file the run may not read)
  const r = stage.sync();
  const rel = (...p) => path.join('sites', ...p);
  assert.deepEqual(r.pushed.sort(), [rel('all-sites', 'dark.js'), rel('fresh.org', 'a.js'), rel('x.com', 'files', 'made.txt'), rel('x.com', 'new.js'), rel('x.com', 'tidy.js')]);
  assert.match(read(l('x.com', 'tidy.js')), /edited by the run/);
  assert.match(read(l('all-sites', 'dark.js')), /darker/);
  assert.equal(read(l('fresh.org', 'a.js')), head('https://fresh.org/*'));
  for (const f of [['y.com', 'sneaky.js'], ['x.com', 'AGENTS.md'], ['loose.js'], ['x.com', 'hard.js']]) assert.ok(!fs.existsSync(l(...f)), f.join('/'));
  assert.deepEqual(r.refused.sort(), [rel('loose.js'), rel('x.com', 'AGENTS.md'), rel('y.com', 'sneaky.js')]);
  assert.ok(warnings.some((w) => /sites\/x\.com\/hard\.js not copied to the mods folder: a file with more than one name/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some((w) => /sites\/y\.com\/sneaky\.js not copied to the mods folder: y\.com is another site's folder/.test(w)), warnings.join('\n'));
  // What the run wrote, by its hash: held.js's fact of whose a change is.
  const sha = (f) => require('crypto').createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  assert.equal(stage.written.get(rel('x.com', 'new.js')), sha(l('x.com', 'new.js')));
  assert.ok(!stage.written.has(rel('y.com', 'sneaky.js')));
  // A file of the copy swapped for a hard link isn't read, nor taken as deleted.
  fs.unlinkSync(s('x.com', '_notes.md'));
  fs.linkSync(outside, s('x.com', '_notes.md'));
  stage.sync();
  assert.equal(read(l('x.com', '_notes.md')), 'notes');
  // Nothing more the next time; the file the run deleted it made itself just goes.
  assert.deepEqual(stage.sync().pushed, []);
  fs.unlinkSync(s('x.com', 'new.js'));
  assert.deepEqual(stage.sync().pushed, [rel('x.com', 'new.js')]);
  assert.ok(!fs.existsSync(l('x.com', 'new.js')));
  assert.ok(!stage.written.has(rel('x.com', 'new.js')));
  // One that was there goes to the trash, as `trif delete`; another file to trash/<site>/files/.
  fs.unlinkSync(s('x.com', 'tidy.js'));
  fs.unlinkSync(s('x.com', 'files', 'beep.mp3'));
  stage.sync();
  assert.ok(!fs.existsSync(l('x.com', 'tidy.js')));
  assert.ok(fs.readdirSync(path.join(home, 'trash', 'x.com')).some((n) => /^tidy@\w+\.js$/.test(n)));
  assert.equal(read(path.join(home, 'trash', 'x.com', 'files', 'beep.mp3')), 'BEEP');
  // A mod for every site it may change but not delete (it also runs elsewhere): back in its copy.
  fs.writeFileSync(l('all-sites', 'keep.js'), head('*://*/*'));
  stage.sync(); // (brought into the copy)
  fs.unlinkSync(s('all-sites', 'keep.js'));
  const r2 = stage.sync();
  assert.deepEqual(r2.pushed, []);
  assert.ok(fs.existsSync(l('all-sites', 'keep.js')));
  assert.ok(fs.existsSync(s('all-sites', 'keep.js')), 'put back in the copy');
});

test('stage: changes in the mods folder come into the copy; the run\'s edit over someone else\'s keeps theirs in history', () => {
  const { home, stage, s, l } = setup();
  // The user edits a mod the run hasn't touched: the copy follows, and it isn't the run's.
  fs.writeFileSync(l('x.com', 'tidy.js'), head('https://x.com/*', '// the user\'s\n'));
  fs.writeFileSync(l('x.com', 'restored.js'), head('https://x.com/*')); // (a trif restore, an import)
  fs.writeFileSync(l('y.com', 'other.js'), head('https://y.com/*', '// y edited\n'));
  fs.unlinkSync(l('pro.x.com', 'pro.js')); // (a trif delete, done by the helper)
  const r = stage.sync({ touch: true });
  assert.deepEqual(r.pushed, []);
  assert.equal(read(s('x.com', 'tidy.js')), read(l('x.com', 'tidy.js')));
  assert.ok(fs.existsSync(s('x.com', 'restored.js')));
  assert.match(read(s('y.com', 'other.js')), /y edited/);
  assert.ok(!fs.existsSync(s('pro.x.com', 'pro.js')));
  assert.equal(stage.written.size, 0);
  assert.ok(stage.touched.has(path.join('sites', 'pro.x.com', 'pro.js')), 'its own delete counts as its change');
  // Both changed since: the run's version goes in, the user's is kept in history.
  fs.writeFileSync(l('x.com', 'tidy.js'), head('https://x.com/*', '// the user again\n'));
  fs.writeFileSync(s('x.com', 'tidy.js'), head('https://x.com/*', '// the run\'s\n'));
  stage.sync();
  assert.match(read(l('x.com', 'tidy.js')), /the run's/);
  const hist = path.join(home, 'history', 'x.com');
  assert.ok(fs.readdirSync(hist).filter((n) => n.endsWith('.js')).some((n) => /the user again/.test(read(path.join(hist, n)))));
});

test('stage: a folder of the copy swapped for a link is never read or written through; after close, nothing is read', () => {
  const { home, stage, s, l, warnings } = setup();
  // The run swaps its x.com folder for a link to a folder it can't read: the helper doesn't follow it (to
  // the helper the folder's files are gone: deleted, so the mod is in the trash, as `trif delete` would).
  const away = path.join(home, 'away');
  put(path.join(away, 'tidy.js'), 'SECRET MOD-LOOKING TEXT');
  fs.rmSync(s('x.com'), { recursive: true });
  fs.symlinkSync(away, s('x.com'));
  stage.sync();
  const all = (dir) => fs.readdirSync(dir, { recursive: true }).map((n) => path.join(dir, n)).filter((f) => fs.lstatSync(f).isFile());
  assert.ok(!all(l()).concat(all(path.join(home, 'trash'))).some((f) => /SECRET/.test(read(f))));
  // (and what comes into the mods folder isn't written through it)
  fs.writeFileSync(l('x.com', 'tidy.js'), head('https://x.com/*', '// changed\n'));
  stage.sync();
  assert.equal(read(path.join(away, 'tidy.js')), 'SECRET MOD-LOOKING TEXT');
  assert.ok(warnings.some((w) => /couldn't bring sites\/x\.com\/tidy\.js into the run's copy: x\.com isn't a folder/.test(w)), warnings.join('\n'));
  // Closed: the copy is gone, and a write there afterwards (a process the run left behind) goes nowhere.
  stage.close();
  put(s('..', 'sites', 'late.js'), 'late');
  put(path.join(stage.sites, 'x2.com', 'late.js'), head('https://x2.com/*'));
  assert.deepEqual(stage.sync(), { pushed: [], pulled: [], refused: [] });
  assert.ok(!fs.existsSync(l('x2.com')));
});

// ------------------------------------------------------------------ through the helper

// A stand-in Claude Code: LATE leaves a process that writes a mod into its working folder 1.5 s after the
// agent has ended, from a session of its own (as Claude Code starts its commands, and as any command can
// make itself: setsid); SAVE writes a mod into its working folder and waits.
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(__dirname, 'call.json'), JSON.stringify({ cwd: process.cwd(), env: process.env }));
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 's1' });
const mod = (site, name, body) => { const f = path.join(process.cwd(), 'sites', site, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
if (prompt.includes('LATE')) {
  const { spawn } = require('child_process');
  const code = 'setTimeout(() => { const fs = require("fs"), p = require("path"); const f = process.argv[1]; fs.mkdirSync(p.dirname(f), { recursive: true }); fs.writeFileSync(f, "// ==WebMod==\\\\n// @match <all_urls>\\\\n// ==/WebMod==\\\\nfetch(1)\\\\n"); }, 1500)';
  spawn(process.execPath, ['-e', code, path.join(process.cwd(), 'sites', 'example.com', 'late.js')], { detached: true, stdio: 'ignore', cwd: '/' }).unref();
  mod('example.com', 'early.js', '// ==WebMod==\\n// @match https://example.com/*\\n// ==/WebMod==\\n// early\\n');
}
if (prompt.includes('SAVE')) {
  mod('example.com', 'saved.js', '// ==WebMod==\\n// @match https://example.com/*\\n// ==/WebMod==\\n// saved\\n');
  setInterval(() => {}, 1000);
  return;
}
say({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1', total_cost_usd: 0 });
`;

function home() {
  const h = tempDir();
  const bin = path.join(h, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(h, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(privDir(h), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  return { home: h, bin };
}
function host(h) {
  const ext = new FakeExtension({ home: h, env: { TRIF_AGENT_KILL_GRACE_MS: '400' } });
  cleanups.push(() => ext.close());
  return ext;
}
let n = 0;
async function ask(ext, cmd, args = {}) {
  const id = `s${++n}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
const START = { agent: 'claude', site: 'example.com', url: 'https://example.com/page', tabId: 12 };
const done = (ext, runId, timeout = 8000) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout }).then((m) => m.event);

test('a run: a process it leaves behind, out of its group, writes into its working folder after it ended: that goes nowhere', async () => {
  const { home: h, bin } = home();
  const ext = host(h);
  await ext.waitForSocket();
  const r = await ask(ext, 'agent.start', { ...START, prompt: 'LATE' });
  const d = await done(ext, r.result.runId);
  const { cwd } = JSON.parse(fs.readFileSync(path.join(bin, 'call.json'), 'utf8'));
  assert.deepEqual(d.changedFiles, [path.join('sites', 'example.com', 'early.js')]);
  assert.ok(fs.existsSync(path.join(h, 'sites', 'example.com', 'early.js')), 'what it wrote while it ran is in the mods folder');
  await sleep(2500);
  assert.ok(fs.existsSync(path.join(cwd, 'sites', 'example.com', 'late.js')), 'the late write happened (into a folder nothing reads)');
  assert.ok(!fs.existsSync(path.join(h, 'sites', 'example.com', 'late.js')), 'the late write never reached the mods folder');
  fs.rmSync(cwd, { recursive: true, force: true });
  assert.ok(!fs.readFileSync(path.join(privDir(h), 'helper.log'), 'utf8').includes('late.js'));
});

test('a run: a mod saved in its working folder reaches the browser while it runs, is the run\'s (held for its match), and its trif delete shows in its copy at once', async () => {
  const { home: h, bin } = home();
  writeMod(h, 'example.com', 'old.js', '// ==WebMod==\n// @match https://example.com/*\n// ==/WebMod==\n// old\n');
  const ext = host(h);
  ext.hello();
  await ext.waitForSocket();
  const r = await ask(ext, 'agent.start', { ...START, prompt: 'SAVE' });
  const call = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(bin, 'call.json'), 'utf8')); } catch { return null; } }, { message: 'the agent to start' });
  const lastMods = () => [...ext.messages].reverse().find((m) => m.type === 'mods')?.mods || [];
  await waitFor(() => lastMods().some((m) => m.id === 'example.com/saved'), { message: 'the saved mod to reach the browser' });
  // The run's own new broad mod: written in its copy, held on its account (by: agent, for its match).
  writeMod(call.cwd, 'example.com', 'wide.js', '// ==WebMod==\n// @match <all_urls>\n// ==/WebMod==\n// the run\'s\n');
  await waitFor(() => lastMods().find((m) => m.id === 'example.com/wide')?.held, { message: 'the run\'s broad mod to be held' });
  assert.equal(lastMods().find((m) => m.id === 'example.com/wide').held.by, 'agent');
  // The same written straight into the mods folder meanwhile (not by the run: it can't) isn't the run's.
  writeMod(h, 'example.com', 'user.js', '// ==WebMod==\n// @match <all_urls>\n// ==/WebMod==\n// the user\'s\n');
  await waitFor(() => lastMods().some((m) => m.id === 'example.com/user'), { message: 'the user\'s mod' });
  assert.equal(lastMods().find((m) => m.id === 'example.com/user').held, undefined, 'outside a run, a match is the user\'s to choose');
  await waitFor(() => fs.existsSync(path.join(call.cwd, 'sites', 'example.com', 'user.js')), { message: 'the user\'s mod in the run\'s copy too' });
  // trif delete, through the mailbox: done by the helper in the mods folder, and gone from the copy by the time it answers.
  const env = { TRIF_RUN_TOKEN: call.env.TRIF_RUN_TOKEN, TRIF_RUN_BOX: call.env.TRIF_RUN_BOX, TRIF_RUN_MODS_DIR: call.env.TRIF_RUN_MODS_DIR, TRIF_RUN_LIVE_MODS_DIR: call.env.TRIF_RUN_LIVE_MODS_DIR };
  const res = await runCli(['delete', 'example.com/old'], { home: h, env });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(!fs.existsSync(path.join(h, 'sites', 'example.com', 'old.js')));
  assert.ok(!fs.existsSync(path.join(call.cwd, 'sites', 'example.com', 'old.js')), 'gone from the copy when the answer came');
  // trif check and trif new in the run read and write its copy.
  const chk = await runCli(['check', 'example.com/saved'], { home: h, env });
  assert.equal(chk.code, 0, chk.stderr);
  assert.match(chk.stdout, new RegExp(`${path.join(call.cwd, 'sites', 'example.com', 'saved.js').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} parses`));
  const nw = await runCli(['new', 'example.com', 'from-cli', '--style'], { home: h, env });
  assert.equal(nw.code, 0, nw.stderr);
  assert.ok(fs.existsSync(path.join(call.cwd, 'sites', 'example.com', 'from-cli.js')));
  await waitFor(() => fs.existsSync(path.join(h, 'sites', 'example.com', 'from-cli.js')), { message: 'trif new\'s mod in the mods folder' });
  await ask(ext, 'agent.stop', { runId: r.result.runId });
  const d = await done(ext, r.result.runId);
  const rel = (f) => path.join('sites', 'example.com', f);
  assert.deepEqual(d.changedFiles, [rel('from-cli.js'), rel('old.js'), rel('saved.js'), rel('wide.js')], 'the run\'s, not the user\'s');
  assert.deepEqual((d.held || []).map((x) => x.id), ['example.com/wide']);
  assert.ok(!fs.existsSync(call.cwd), 'its working folder is gone');
});

test('stage: the sandboxes write the run\'s copy, never the mods folder; Claude Code\'s rules are rooted in the copy', () => {
  const { home, sites, stage } = setup();
  const { runLimits } = require('../helper/lib/runs');
  const claude = require('../helper/lib/agents/claude');
  const codex = require('../helper/lib/agents/codex');
  const P = require('../helper/lib/paths');
  const ws = { ...P.workspace(home), modsDir: sites };
  const box = path.join(home, 'boxes', 'r1');
  fs.mkdirSync(box);
  const lim = runLimits(ws, { scope: 'x.com', splits: ['mail.x.com'], box, screenshots: box, stage });
  const live = fs.realpathSync(sites);
  assert.equal(lim.writable[0], stage.sites);
  assert.ok(!lim.writable.includes(live));
  assert.equal(lim.workspace, stage.dir);
  assert.ok(lim.readable.includes(stage.dir));
  assert.deepEqual(lim.readOnly.sort(), ['empty.org', 'mail.x.com', 'y.com'].map((n) => path.join(stage.sites, n)));
  // Claude Code: its commands may write the copy's sites/, never the mods folder or TRIF's state files.
  const c = claude.command({ bin: '/x/claude', prompt: 'P', ...lim });
  const settings = JSON.parse(c.files[0].content);
  const fsb = settings.sandbox.filesystem;
  assert.ok(fsb.allowWrite.includes(stage.sites));
  assert.ok(!fsb.allowWrite.some((p) => p === live || p.startsWith(live + path.sep)));
  for (const p of [live, path.join(fs.realpathSync(home), 'allowed.json'), path.join(fs.realpathSync(home), 'held.json')]) assert.ok(fsb.denyWrite.includes(p), p);
  assert.ok(fsb.allowRead.includes(stage.dir));
  assert.ok(c.args.includes(`Edit(/${stage.sites}/**)`) && c.args.includes(`Read(/${stage.dir}/**)`), c.args.join(' '));
  assert.ok(settings.permissions.deny.includes(`Edit(/${path.join(stage.sites, 'y.com')}/**)`));
  assert.ok(settings.permissions.deny.includes(`Edit(/${stage.sites}/**/AGENTS.md)`));
  // Codex: the copy's sites/ writable, the mods folder not.
  const perm = codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).args.find((a) => a.startsWith('permissions='));
  assert.ok(perm.includes(`${JSON.stringify(stage.sites)} = "write"`), perm);
  assert.ok(perm.includes(`${JSON.stringify(path.join(stage.sites, 'y.com'))} = "read"`), perm);
  assert.ok(!perm.includes(`${JSON.stringify(live)} = "write"`), perm);
});

test('claude afterRun: the empty folder Claude Code made for a run\'s working folder goes; one with a session stays', () => {
  const claude = require('../helper/lib/agents/claude');
  const h = tempDir();
  const projects = path.join(h, '.claude', 'projects');
  const a = '/Users/u/Library/Caches/TRIF/boxes/rA.ws';
  const b = '/Users/u/Library/Caches/TRIF/boxes/rB.ws';
  const enc = (p) => path.join(projects, p.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(path.join(enc(a), 'memory'), { recursive: true });
  put(path.join(enc(b), 's1.jsonl'), '{}');
  fs.mkdirSync(path.join(enc(b), 'memory'));
  claude.afterRun({ workingDir: a, home: h });
  claude.afterRun({ workingDir: b, home: h });
  assert.ok(!fs.existsSync(enc(a)));
  assert.ok(fs.existsSync(path.join(enc(b), 's1.jsonl')));
  assert.equal(path.basename(enc(a)), '-Users-u-Library-Caches-TRIF-boxes-rA-ws');
});
