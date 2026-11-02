'use strict';
// Tests for mods made in one browser starting off in the others (helper/lib/origins.js): attribution
// rules, run markers in <home>/active-runs, and two hosts on one workspace agreeing on a new mod's origin.
// The extension side (applyStartOff, install id) is in extension.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { FakeExtension, writeMod, tempDir, waitFor, sleep } = require('./fake-extension');
const { loadOrigins, recordOrigins, markRunActive, markRunEnded, activeRuns, ENDED_GRACE_MS } = require('../helper/lib/origins');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

const originsFile = (home) => path.join(home, 'origins.json');
const readOriginsRaw = (home) => fs.readFileSync(originsFile(home), 'utf8');

async function deadPid() {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  return child.pid;
}

// ------------------------------------------------------------------ recordOrigins

test('recordOrigins: a run on the mod\'s site wins, then the helper\'s own run, then any other', () => {
  const home = tempDir();
  const runs = [
    { by: 'A', browser: 'Chrome', site: 'a.com', own: true },
    { by: 'B', browser: 'Firefox', site: 'x.com' },
  ];
  assert.equal(recordOrigins(home, ['x.com/new', 'www.x.com/w', 'm.x.com/sub', 'other.org/z'], runs, 1000), true);
  assert.deepStrictEqual(loadOrigins(home), {
    'x.com/new': { by: 'B', browser: 'Firefox', at: 1000 },     // site match beats own
    'www.x.com/w': { by: 'B', browser: 'Firefox', at: 1000 },   // www. ignored
    'm.x.com/sub': { by: 'B', browser: 'Firefox', at: 1000 },   // subdomain of the run's site
    'other.org/z': { by: 'A', browser: 'Chrome', at: 1000 },    // no site match: own run
  });
  // No own run and no site match: the first other run.
  recordOrigins(home, ['zzz.com/q'], [{ by: 'C', browser: 'Edge', site: 'c.com' }, { by: 'D', browser: 'Arc', site: 'd.com' }], 2000);
  assert.deepStrictEqual(loadOrigins(home)['zzz.com/q'], { by: 'C', browser: 'Edge', at: 2000 });
});

test('recordOrigins: no run drops a stale entry; nothing new or unchanged leaves the file alone', () => {
  const home = tempDir();
  recordOrigins(home, ['x.com/a', 'x.com/b'], [{ by: 'B', browser: 'Firefox', site: 'x.com' }], 1000);
  const before = readOriginsRaw(home);
  const mtime = fs.statSync(originsFile(home)).mtimeMs;
  assert.equal(recordOrigins(home, [], [{ by: 'Z', site: 'x.com' }]), false);
  assert.equal(recordOrigins(home, ['x.com/a'], [{ by: 'B', browser: 'Firefox', site: 'x.com' }], 5000), false, 'same origin: unchanged');
  assert.equal(readOriginsRaw(home), before);
  assert.equal(fs.statSync(originsFile(home)).mtimeMs, mtime);
  // A mod recreated (same id) with no run going, e.g. by a terminal agent: no origin any more.
  assert.equal(recordOrigins(home, ['x.com/a'], []), true);
  assert.deepStrictEqual(Object.keys(loadOrigins(home)), ['x.com/b']);
  assert.equal(recordOrigins(home, ['x.com/nothing'], []), false, 'no run, no entry: unchanged');
  // Recreated by another browser's run: the origin moves to it.
  assert.equal(recordOrigins(home, ['x.com/b'], [{ by: 'A', browser: 'Chrome', site: 'x.com' }], 6000), true);
  assert.deepStrictEqual(loadOrigins(home)['x.com/b'], { by: 'A', browser: 'Chrome', at: 6000 });
});

test('loadOrigins: missing or junk file and bad entries are ignored', () => {
  const home = tempDir();
  assert.deepStrictEqual(loadOrigins(home), {});
  fs.writeFileSync(originsFile(home), 'not json');
  assert.deepStrictEqual(loadOrigins(home), {});
  fs.writeFileSync(originsFile(home), JSON.stringify({ 'x.com/ok': { by: 'A', browser: 'Chrome', at: 5 }, 'x.com/nobody': { browser: 'Chrome' }, 'x.com/num': { by: 3 }, 'x.com/null': null }));
  assert.deepStrictEqual(loadOrigins(home), { 'x.com/ok': { by: 'A', browser: 'Chrome', at: 5 } });
});

// ------------------------------------------------------------------ run markers

test('activeRuns: live runs, just-ended runs within the grace period, dead helpers\' markers removed', async () => {
  const home = tempDir();
  markRunActive(home, { runId: 'r1', by: 'A', browser: 'Chrome', site: 'x.com' });
  markRunActive(home, { runId: 'r2', by: 'B', browser: 'Firefox', site: 'y.com' });
  const dir = path.join(home, 'active-runs');
  const m1 = JSON.parse(fs.readFileSync(path.join(dir, 'r1.json'), 'utf8'));
  assert.equal(m1.pid, process.pid);
  assert.equal(m1.endedAt, null);
  assert.deepStrictEqual(activeRuns(home).map((r) => r.runId).sort(), ['r1', 'r2']);

  markRunEnded(home, 'r1');
  const ended = JSON.parse(fs.readFileSync(path.join(dir, 'r1.json'), 'utf8')).endedAt;
  assert.equal(typeof ended, 'number');
  assert.deepStrictEqual(activeRuns(home, { now: ended + ENDED_GRACE_MS - 1 }).map((r) => r.runId).sort(), ['r1', 'r2'], 'still within the grace period');
  assert.deepStrictEqual(activeRuns(home, { now: ended + ENDED_GRACE_MS + 1 }).map((r) => r.runId), ['r2'], 'ended: dropped from results');
  assert.ok(fs.existsSync(path.join(dir, 'r1.json')), 'but kept on disk for a while');
  markRunEnded(home, 'never-marked'); // no marker: no-op, no throw

  // A live (not ended) marker whose helper died is removed.
  const dead = await deadPid();
  fs.writeFileSync(path.join(dir, 'r3.json'), JSON.stringify({ runId: 'r3', by: 'C', browser: 'Edge', site: 'z.com', pid: dead, startedAt: Date.now(), endedAt: null }));
  assert.deepStrictEqual(activeRuns(home).map((r) => r.runId).sort(), ['r1', 'r2']);
  assert.ok(!fs.existsSync(path.join(dir, 'r3.json')));
  // Same through the alive option: every pid dead removes the live r2 too (r1 has ended, so it stays on disk).
  activeRuns(home, { alive: () => false });
  assert.ok(!fs.existsSync(path.join(dir, 'r2.json')));
  assert.ok(fs.existsSync(path.join(dir, 'r1.json')));
  // Junk files are skipped.
  fs.writeFileSync(path.join(dir, 'junk.json'), '{');
  assert.doesNotThrow(() => activeRuns(home));
  assert.deepStrictEqual(activeRuns(tempDir()), [], 'no active-runs folder');
});

// ------------------------------------------------------------------ hosts

// A fake Claude Code for these tests: "NEWMOD <site>/<name>" writes that mod; "WAIT" holds the run until
// <bin>/go exists. Ends with a result line like the real one.
const FAKE_CLAUDE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const i = argv.indexOf('--');
const prompt = i === -1 ? '' : argv[i + 1];
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 'sess-o', cwd: process.cwd(), tools: [] });
const m = /NEWMOD (\\S+)\\/(\\S+)/.exec(prompt);
if (m) {
  const file = path.join(process.cwd(), 'sites', m[1], m[2] + '.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// made by a run ' + Date.now());
}
const finish = () => { say({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'sess-o', total_cost_usd: 0 }); process.exit(0); };
if (prompt.includes('WAIT')) {
  const go = path.join(__dirname, 'go');
  const t = setInterval(() => { if (fs.existsSync(go)) { clearInterval(t); finish(); } }, 50);
} else finish();
`;

function makeHome() {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  return { home, bin };
}

function startHost(home) {
  const ext = new FakeExtension({ home, env: { TRIF_AGENT_KILL_GRACE_MS: '400' } });
  cleanups.push(() => ext.close());
  return ext;
}

let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `o${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
}

function waitDone(ext, runId) {
  return ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout: 30000 }).then((m) => m.event);
}

const modIn = (mods, id) => (mods || []).find((m) => m.id === id);

// Two hosts on one workspace whose extensions said hello as Chrome (install A) and Firefox (install B).
async function twoBrowsers() {
  const { home, bin } = makeHome();
  writeMod(home, 'x.com', 'before.js', '// existed before the helpers started');
  const a = startHost(home);
  a.hello({ browser: 'Chrome', installId: 'A' });
  await a.waitForSocket(15000);
  const b = startHost(home);
  b.hello({ browser: 'Firefox', chrome: '159.0', installId: 'B' });
  await b.waitForSocket(15000, b.ownSock);
  // Both have scanned once (with their hello), so later files count as new.
  await a.nextMods((mods) => !!modIn(mods, 'x.com/before'), { timeout: 15000 });
  await b.nextMods((mods) => !!modIn(mods, 'x.com/before'), { timeout: 15000 });
  await sleep(300);
  return { home, bin, a, b };
}

test('two browsers: a mod made by A\'s run carries origin A in both helpers\' mods; others get none', async () => {
  const { home, bin, a, b } = await twoBrowsers();
  assert.equal(modIn(a.lastMods(), 'x.com/before').origin, undefined, 'mods from before the helpers started have no origin');
  assert.equal(modIn(b.lastMods(), 'x.com/before').origin, undefined);

  // A's side panel runs an agent on x.com that makes a new mod.
  const sinceA = a.messages.length;
  const sinceB = b.messages.length;
  const r = await extRequest(a, 'agent.start', { site: 'x.com', url: 'https://x.com/home', tabId: 4, prompt: 'NEWMOD x.com/rainbow WAIT' });
  assert.equal(r.ok, true, r.error);
  const runId = r.result.runId;

  // While it runs, A's marker is in active-runs.
  const marker = path.join(home, 'active-runs', `${runId}.json`);
  await waitFor(() => fs.existsSync(marker), { timeout: 15000, message: 'run marker' });
  const mk = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.deepStrictEqual([mk.by, mk.browser, mk.site, mk.pid, mk.endedAt], ['A', 'Chrome', 'x.com', a.child.pid, null]);

  const want = { by: 'A', browser: 'Chrome' };
  const modsA = await a.nextMods((mods) => !!modIn(mods, 'x.com/rainbow'), { since: sinceA, timeout: 20000 });
  const modsB = await b.nextMods((mods) => !!modIn(mods, 'x.com/rainbow'), { since: sinceB, timeout: 20000 });
  assert.deepStrictEqual(modIn(modsA, 'x.com/rainbow').origin, want, 'the helper that ran it');
  assert.deepStrictEqual(modIn(modsB, 'x.com/rainbow').origin, want, 'the other browser\'s helper agrees');
  assert.deepStrictEqual(loadOrigins(home)['x.com/rainbow'].by, 'A');

  fs.writeFileSync(path.join(bin, 'go'), '');
  await waitDone(a, runId);
  await waitFor(() => typeof JSON.parse(fs.readFileSync(marker, 'utf8')).endedAt === 'number', { timeout: 10000, message: 'marker endedAt' });

  // Wait out the grace period, then a mod written with no run anywhere (terminal agent, by hand) has no origin.
  await sleep(ENDED_GRACE_MS + 500);
  const s2a = a.messages.length;
  const s2b = b.messages.length;
  writeMod(home, 'x.com', 'by-hand.js', '// written in an editor');
  const handA = await a.nextMods((mods) => !!modIn(mods, 'x.com/by-hand'), { since: s2a, timeout: 20000 });
  const handB = await b.nextMods((mods) => !!modIn(mods, 'x.com/by-hand'), { since: s2b, timeout: 20000 });
  assert.equal(modIn(handA, 'x.com/by-hand').origin, undefined);
  assert.equal(modIn(handB, 'x.com/by-hand').origin, undefined);
  assert.equal(loadOrigins(home)['x.com/by-hand'], undefined);
  // The run's mod keeps its origin.
  assert.deepStrictEqual(modIn(handB, 'x.com/rainbow').origin, want);
});

test('a run on a host whose extension sent no install id isn\'t marked', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  ext.hello({ browser: 'Chrome' });
  await ext.waitForSocket(15000);
  const r = await extRequest(ext, 'agent.start', { site: 'x.com', url: 'https://x.com/', tabId: 1, prompt: 'NEWMOD x.com/anon WAIT' });
  assert.equal(r.ok, true, r.error);
  await waitFor(() => fs.existsSync(path.join(home, 'sites', 'x.com', 'anon.js')), { timeout: 15000, message: 'mod written' });
  await sleep(300);
  let names = [];
  try { names = fs.readdirSync(path.join(home, 'active-runs')); } catch { /* none */ }
  assert.deepStrictEqual(names, []);
  fs.writeFileSync(path.join(bin, 'go'), '');
  await waitDone(ext, r.result.runId);
});
