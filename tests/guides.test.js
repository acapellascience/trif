'use strict';
// The guides TRIF owns in the workspace (AGENTS.md, TECHNIQUES.md, BOXED.md, CLAUDE.md) follow the helper's
// own helper/workspace/ (lib/guides.js): at helper start, before each run is staged, and in `trif setup`;
// only those files, only when they differ; a hand edit is replaced but said in the log (and kept in the
// private folder). `trif doctor` says when they're out of date.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FakeExtension, tempDir, privDir, waitFor, runCli, REPO } = require('./fake-extension');
const { syncGuides, staleGuides, GUIDES } = require('../helper/lib/guides');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const read = (f) => fs.readFileSync(f, 'utf8');
const SOURCES = path.join(REPO, 'helper', 'workspace');

// A helper folder of its own (helper/workspace/ with the four guides) and a workspace with its private folder.
function world() {
  const root = tempDir();
  const helperDir = path.join(root, 'helper');
  fs.mkdirSync(path.join(helperDir, 'workspace'), { recursive: true });
  for (const n of GUIDES) fs.writeFileSync(path.join(helperDir, 'workspace', n), `# ${n} v1\n`);
  const home = path.join(root, 'ws');
  fs.mkdirSync(path.join(home, 'sites', 'x.com'), { recursive: true });
  const ws = { home, private: path.join(root, 'ws-private') };
  const lines = [];
  const logger = { info: (l) => lines.push(['info', l]), warn: (l) => lines.push(['warn', l]) };
  return { root, helperDir, home, ws, lines, logger, src: (n, t) => fs.writeFileSync(path.join(helperDir, 'workspace', n), t) };
}

test('syncGuides: stale and missing guides refreshed, the user\'s files untouched, unchanged ones not rewritten', () => {
  const { helperDir, home, ws, lines, logger, src } = world();
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# old guide\n');
  fs.writeFileSync(path.join(home, 'instructions.md'), 'my own rules\n');
  fs.writeFileSync(path.join(home, 'sites', 'x.com', 'a.js'), '// a mod\n');
  const r = syncGuides(ws, helperDir, { logger });
  assert.deepEqual(r.written.sort(), [...GUIDES].sort());
  assert.deepEqual(r.edited, [], 'no record yet: an older TRIF\'s guide, not a hand edit');
  for (const n of GUIDES) assert.equal(read(path.join(home, n)), `# ${n} v1\n`);
  assert.equal(read(path.join(home, 'instructions.md')), 'my own rules\n');
  assert.equal(read(path.join(home, 'sites', 'x.com', 'a.js')), '// a mod\n');
  assert.ok(lines.some(([k, l]) => k === 'info' && /guides: refreshed .*AGENTS\.md/.test(l)));
  assert.deepEqual(staleGuides(home, helperDir), []);

  // Unchanged: nothing written, nothing said (also past the quick check).
  const before = GUIDES.map((n) => fs.statSync(path.join(home, n)));
  lines.length = 0;
  assert.deepEqual(syncGuides(ws, helperDir, { logger }).written, []);
  assert.deepEqual(syncGuides(ws, helperDir, { logger, force: true }).written, []);
  GUIDES.forEach((n, i) => {
    const st = fs.statSync(path.join(home, n));
    assert.equal(st.ino, before[i].ino, `${n} not replaced`);
    assert.equal(st.mtimeMs, before[i].mtimeMs, `${n} not rewritten`);
  });
  assert.deepEqual(lines, []);

  // A new version of one guide (a git checkout moved): that one alone.
  src('BOXED.md', '# BOXED.md v2: the load power\n');
  assert.deepEqual(staleGuides(home, helperDir), [{ name: 'BOXED.md', why: 'out of date' }]);
  assert.deepEqual(syncGuides(ws, helperDir, { logger }).written, ['BOXED.md']);
  assert.equal(read(path.join(home, 'BOXED.md')), '# BOXED.md v2: the load power\n');
  assert.equal(read(path.join(home, 'instructions.md')), 'my own rules\n');

  // CLAUDE.md when the helper has none: setup's default.
  fs.rmSync(path.join(helperDir, 'workspace', 'CLAUDE.md'));
  syncGuides(ws, helperDir, { logger });
  assert.equal(read(path.join(home, 'CLAUDE.md')), '@AGENTS.md\n@instructions.md\n');
});

test('syncGuides: a guide edited by hand since TRIF wrote it is replaced, said in the log, and kept', () => {
  const { helperDir, home, ws, lines, logger } = world();
  syncGuides(ws, helperDir, { logger });
  fs.writeFileSync(path.join(home, 'TECHNIQUES.md'), '# my notes in the wrong place\n');
  lines.length = 0;
  const r = syncGuides(ws, helperDir, { logger });
  assert.deepEqual(r.written, ['TECHNIQUES.md']);
  assert.deepEqual(r.edited, ['TECHNIQUES.md']);
  assert.equal(read(path.join(home, 'TECHNIQUES.md')), '# TECHNIQUES.md v1\n');
  const warn = lines.find(([k]) => k === 'warn');
  assert.ok(warn && /TECHNIQUES\.md had been changed since TRIF last wrote it; replaced/.test(warn[1]), JSON.stringify(lines));
  assert.equal(read(path.join(ws.private, 'replaced-guides', 'TECHNIQUES.md')), '# my notes in the wrong place\n');
});

test('syncGuides: no workspace yet, or a guide that isn\'t a file: left alone', () => {
  const { helperDir, home, ws, logger, lines } = world();
  fs.rmSync(home, { recursive: true });
  assert.deepEqual(syncGuides(ws, helperDir, { logger }).written, []);
  assert.equal(fs.existsSync(home), false);
  fs.mkdirSync(path.join(home, 'AGENTS.md'), { recursive: true });
  const r = syncGuides(ws, helperDir, { logger });
  assert.ok(fs.statSync(path.join(home, 'AGENTS.md')).isDirectory());
  assert.equal(r.errors.length, 1);
  assert.ok(lines.some(([k, l]) => k === 'warn' && /couldn't refresh AGENTS\.md/.test(l)));
});

// A stand-in Claude Code: notes the run's folder and stays alive.
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
fs.readFileSync(0, 'utf8');
const dir = path.join(__dirname, 'calls');
fs.mkdirSync(dir, { recursive: true });
const box = path.basename(String(process.env.TRIF_RUN_BOX));
fs.writeFileSync(path.join(dir, box + '.json'), JSON.stringify({ cwd: process.cwd(), boxed: fs.readFileSync(path.join(process.cwd(), 'BOXED.md'), 'utf8') }));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }) + '\\n');
setInterval(() => {}, 1000);
`;

let n = 0;
async function ask(ext, cmd, args = {}) {
  const id = `q${++n}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
}

test('the helper refreshes stale guides when it starts and before a run is staged; instructions.md untouched', { timeout: 120000 }, async () => {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), FAKE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# hours-old guide\n');
  fs.writeFileSync(path.join(home, 'BOXED.md'), '# hours-old boxed guide\n');
  fs.writeFileSync(path.join(home, 'instructions.md'), 'my own rules\n');

  const ext = new FakeExtension({ home, env: { TRIF_AGENT_KILL_GRACE_MS: '400', TRIF_AGENT_TIMEOUT_MS: '170000' } });
  cleanups.push(() => ext.close());
  ext.handlers = {
    tabs: (args) => ({ scope: args.scope ?? null, agentRun: args.agentRun ?? null }),
    status: () => ({ userScripts: true, chrome: '140.0.0.0', version: '0.1.0', mods: [], recording: [], sitesOn: [] }),
  };
  ext.hello();
  await ext.waitForSocket();
  for (const g of GUIDES) assert.equal(read(path.join(home, g)), read(path.join(SOURCES, g)), `${g} at start`);
  assert.equal(read(path.join(home, 'instructions.md')), 'my own rules\n');
  const log = read(path.join(privDir(home), 'helper.log'));
  assert.match(log, /guides: refreshed .*AGENTS\.md/);

  // Old again while the helper runs (as a checkout a guide moved under would be, seen the other way round):
  // the run gets the helper's version, in the workspace and in its own copy.
  fs.writeFileSync(path.join(home, 'BOXED.md'), '# hours-old boxed guide\n');
  const r = await ask(ext, 'agent.start', { agent: 'claude', prompt: 'probe', site: 'example.com', url: 'https://example.com/', tabId: 7 });
  assert.ok(r.ok, `agent.start: ${r.error}`);
  const call = await waitFor(() => { try { return JSON.parse(read(path.join(bin, 'calls', `${r.result.runId}.json`))); } catch { return null; } }, { timeout: 30000, message: 'the stand-in agent' });
  assert.equal(read(path.join(home, 'BOXED.md')), read(path.join(SOURCES, 'BOXED.md')));
  assert.equal(call.boxed, read(path.join(SOURCES, 'BOXED.md')), 'the run\'s copy');
  assert.equal(read(path.join(home, 'instructions.md')), 'my own rules\n');
  assert.match(read(path.join(privDir(home), 'helper.log')), /had been changed since TRIF last wrote it; replaced/);
});

test('doctor: a line when the workspace guides are out of date, ok when they aren\'t', async () => {
  const root = tempDir();
  const home = path.join(root, 'ws');
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  for (const g of GUIDES) fs.copyFileSync(path.join(SOURCES, g), path.join(home, g));
  fs.writeFileSync(path.join(home, 'BOXED.md'), '# old\n');
  fs.rmSync(path.join(home, 'TECHNIQUES.md'));
  const native = path.join(root, 'native');
  const r = await runCli(['doctor', '--native-dir', native], { home });
  assert.match(r.stdout, /warn {2}workspace guides out of date with .*: TECHNIQUES\.md \(missing\), BOXED\.md \(out of date\)/);
  assert.match(r.stdout, /restart your browser \(the helper refreshes them when it starts/);
  for (const g of ['BOXED.md', 'TECHNIQUES.md']) fs.copyFileSync(path.join(SOURCES, g), path.join(home, g));
  const ok = await runCli(['doctor', '--native-dir', native], { home });
  assert.match(ok.stdout, /^ok {4}workspace guides up to date/m);
});
