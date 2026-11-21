'use strict';
// Real `trif` commands in the real sandbox of a side-panel run: the real helper starts a real Claude Code
// and a real Codex run, exactly as the side panel does (runs.js runLimits, agents/claude.js and codex.js:
// their command lines, settings, permission profile, environment, working folder and mailbox), and a
// stand-in model (no paid call) has each agent run, in its own sandbox, the `trif` commands a run uses.
// None may fail for want of a file (EPERM, EACCES, ENOENT): once every `trif` in a run crashed because
// sitecombos.js read extension/pagewide.js at start, which runs couldn't (runs.js CODE_ITEMS; fixed in
// 57e4e44), and no test noticed. What runs must not get (the private folder, config.json, the keychain,
// TRIF's other files, other sites' mods, the network) is refused, and by whom is checked too.
//
// The layout is the strictest a real one has: TRIF as a git checkout inside the home folder (as a
// developer's), where everything of TRIF's but CODE_ITEMS is denied to runs. (An npm install's code is in
// ~/.trif/app, which runs read whole; and the other real-agent tests run this checkout from outside their
// stand-in home folder, where nothing of it is denied: neither noticed the bug.) A scratch home folder
// with the package's files copied into it (package.json "files", plus a .git), a workspace made by the
// copy's own `trif setup`, the private folder, mailboxes and keychain where they are on a Mac. Never the
// real ~/.trif, keychain or browsers. macOS, with Claude Code / Codex installed; skipped otherwise (CI).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { FakeExtension } = require('./fake-extension');
const { startFakeAnthropic } = require('./fake-anthropic-server');
const { startFakeModelServer } = require('./fake-model-server');
const { makeFakeKeychain } = require('./fake-keychain');
const keys = require('../helper/lib/agentkeys');
const { findExecutable, versionOf } = require('../helper/lib/agents/util');

const REPO = path.join(__dirname, '..');
const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

function realClaude() {
  if (process.env.TRIF_TEST_NO_REAL_CLAUDE) return null;
  const file = findExecutable('claude', [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '').split(path.delimiter)]);
  if (!file) return null;
  const v = versionOf(file, { PATH: '/usr/bin:/bin', HOME: process.env.HOME });
  return v && !require('../helper/lib/agents/claude').tooOld(v) ? fs.realpathSync(file) : null;
}
function realCodex() {
  if (process.env.TRIF_TEST_NO_REAL_CODEX) return null;
  const file = findExecutable('codex', ['/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '').split(path.delimiter)]);
  if (!file) return null;
  const v = versionOf(file, { PATH: '/usr/bin:/bin', HOME: process.env.HOME });
  return v && !require('../helper/lib/agents/codex').tooOld(v) ? file : null;
}
const MAC = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
const CLAUDE = MAC ? realClaude() : null;
const CODEX = MAC ? realCodex() : null;
const skipWhy = (bin, name) => (!MAC ? 'macOS only (the run sandboxes are Seatbelt there; Linux runs are untested here)' : !bin ? `needs ${name} installed (not on CI)` : false);

const MANAGED_TEST = process.env.TRIF_TEST_MANAGED || ''; // (CI only: sandbox-on, sandbox-on-no-mcp, loosen, loosen-shell, gateway)
const SECRET = `secret-${crypto.randomBytes(8).toString('hex')}`; // in every file runs must not read
const KEY = `sk-ant-fake-${crypto.randomBytes(12).toString('hex')}`;
const OAI_KEY = `sk-fake-${crypto.randomBytes(12).toString('hex')}`;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A short scratch folder (the helper's socket path is limited to ~104 bytes) in the user's own temporary
// folder on macOS, never under /tmp, which runs are denied (it's the helper's temporary folder here:
// FakeExtension passes it no TMPDIR), whatever the shell's TMPDIR is.
function scratch() {
  let base = os.tmpdir();
  if (process.platform === 'darwin') { try { base = spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).stdout.trim() || base; } catch { /* as is */ } }
  return fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(base), 'trs-')));
}

let fixture = null;
let fixturePinned = null; // (TRIF_WHOLE_BOX: the pinned Claude Code folder in the workspace)
async function setup() {
  if (fixture) return fixture;
  const S = scratch();
  cleanups.push(() => fs.rmSync(S, { recursive: true, force: true }));
  const home = path.join(S, 'home');
  // TRIF as a git checkout in the home folder: what npm ships (package.json "files"), and a .git.
  const code = path.join(home, 'src', 'trif');
  fs.mkdirSync(code, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  for (const f of ['package.json', ...pkg.files]) {
    const from = path.join(REPO, f.replace(/\/$/, ''));
    fs.cpSync(from, path.join(code, f.replace(/\/$/, '')), { recursive: true, filter: (p) => !p.split(path.sep).includes('node_modules') });
  }
  fs.mkdirSync(path.join(code, '.git'));
  fs.writeFileSync(path.join(code, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(code, '.git', 'config'), `[credential]\n\thelper = ${SECRET}\n`);
  // Agents where they are installed, outside the home folder; the keychain (a stand-in) inside it.
  const agentBin = path.join(S, 'agentbin');
  fs.mkdirSync(agentBin);
  if (CLAUDE) fs.symlinkSync(CLAUDE, path.join(agentBin, 'claude'));
  if (CODEX) fs.symlinkSync(CODEX, path.join(agentBin, 'codex'));
  const keychainDir = path.join(home, 'Library', 'Keychains', 'trif-test');
  const kc = makeFakeKeychain(keychainDir);
  const PATH = `${agentBin}:/usr/bin:/bin`;
  const env = {
    HOME: home, PATH, TRIF_HOME: path.join(home, '.trif'), // (the default workspace: ~/.trif)
    TRIF_DEFAULT_AGENT_DIRS: '', TRIF_UPDATE_DELAY: '2000000000', TRIF_NO_LAUNCHCTL: '1',
    TRIF_BOX_ROOT: path.join(home, 'Library', 'Caches', 'TRIF', 'boxes'), // (where they are by default)
    TRIF_CLAUDE_MANAGED_DIR: path.join(S, 'no-claude-managed'), ...kc.env,
  };
  // (TRIF_TEST_MANAGED, CI: the runner's real managed settings, which Claude Code reads, are what the
  // helper sees too: copied into the folder it reads instead of the system's)
  if (MANAGED_TEST) {
    fs.mkdirSync(env.TRIF_CLAUDE_MANAGED_DIR);
    fs.copyFileSync('/Library/Application Support/ClaudeCode/managed-settings.json', path.join(env.TRIF_CLAUDE_MANAGED_DIR, 'managed-settings.json'));
  }
  // The workspace, by the copy's own setup (non-interactive: no browser opened, no wait, no CLI link).
  const r = spawnSync(process.execPath, [path.join(code, 'helper', 'cli.js'), 'setup', '--link', '--no-link', '--no-examples', '--native-dir', path.join(S, 'native')],
    { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `trif setup: ${r.stdout}\n${r.stderr}`);
  const ws = path.join(home, '.trif');
  const priv = path.join(home, 'Library', 'Application Support', 'TRIF');
  assert.ok(fs.existsSync(path.join(ws, 'bin', 'trif')), r.stdout);
  assert.ok(fs.existsSync(path.join(priv, 'config.json')), r.stdout);
  // config.json: what setup wrote, and something no run may read.
  const cfgFile = path.join(priv, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  // (TRIF_WHOLE_BOX=1, docs/WHOLE-BOX.md: the same tests with the whole agent in TRIF's full sandbox, switched on
  // as Settings does: config.json "wholeBox", helper/lib/wholeboxsetting.js)
  fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, env: { ...(cfg.env || {}), PATH }, secret: SECRET, ...(process.env.TRIF_WHOLE_BOX ? { wholeBox: true } : {}) }));
  fs.writeFileSync(path.join(keychainDir, 'login.keychain-db'), SECRET);
  // Another site's mods: read-only to runs (the sandbox's doing, runs.js runLimits readOnly).
  fs.mkdirSync(path.join(ws, 'sites', 'other.net'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'sites', 'other.net', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://other.net/*\n// ==/WebMod==\n');
  // TRIF's full sandbox runs TRIF's pinned Claude Code (claudepin.js), never the one on PATH: on CI the real
  // pin, installed by `node helper/lib/claudepin.js ensure <dir>` (TRIF_TEST_CLAUDE_PIN_HOME); else a
  // stand-in pin of the Claude Code installed here, recorded as claudepin does (its version, its SHA-256).
  if (process.env.TRIF_WHOLE_BOX && CLAUDE) {
    const cp = require('../helper/lib/claudepin');
    const key = `${process.platform}-${process.arch}`;
    let from;
    let name;
    if (process.env.TRIF_TEST_CLAUDE_PIN_HOME) {
      from = cp.installedPinned(process.env.TRIF_TEST_CLAUDE_PIN_HOME).dir;
      name = path.basename(from);
    } else {
      const v = versionOf(CLAUDE, { PATH: '/usr/bin:/bin', HOME: home });
      env.TRIF_CLAUDE_CODE_PIN = path.join(S, 'claude-pin.json');
      fs.writeFileSync(env.TRIF_CLAUDE_CODE_PIN, JSON.stringify({ version: v, packages: { [key]: { name: 'stand-in' } } }));
      from = path.join(S, 'pin-src');
      fs.mkdirSync(from);
      fs.copyFileSync(CLAUDE, path.join(from, 'claude'));
      fs.writeFileSync(path.join(from, cp.MARK), JSON.stringify({ version: v, binSha256: crypto.createHash('sha256').update(fs.readFileSync(CLAUDE)).digest('hex') }));
      name = cp.dirName(key, { version: v });
    }
    const to = path.join(ws, 'runtime', name);
    fs.mkdirSync(to, { recursive: true });
    // (a hard link where it can be: the binary is 364 MB)
    for (const n of fs.readdirSync(from)) { try { fs.linkSync(path.join(from, n), path.join(to, n)); } catch { fs.copyFileSync(path.join(from, n), path.join(to, n)); } }
    // Nothing on PATH is used: the agents folder's claude is a stand-in that would say so.
    fs.unlinkSync(path.join(agentBin, 'claude'));
    fs.writeFileSync(path.join(agentBin, 'claude'), '#!/bin/sh\necho "the user\'s own claude was started" >&2\nexit 3\n', { mode: 0o755 });
    fixturePinned = to;
  }
  await keys.setAgentKey('claude', KEY, { env: kc.env });
  await keys.setAgentKey('codex', OAI_KEY, { env: kc.env });
  // Stand-in models: each POST takes the next step of its script (filled in by each test).
  const anthropicScript = [];
  const anthropic = await startFakeAnthropic({ script: anthropicScript });
  cleanups.push(() => anthropic.close());
  const openaiScript = [];
  const openai = await startFakeModelServer({ script: openaiScript });
  cleanups.push(() => openai.close());
  // The real helper (the copy's), with a stand-in extension.
  const ext = new FakeExtension({ home: ws, hostJs: path.join(code, 'helper', 'host.js'), env: {
    ...env, TRIF_ANTHROPIC_URL: anthropic.url, TRIF_OPENAI_URL: `${openai.url}/v1`, TRIF_AGENT_TIMEOUT_MS: '100000', TRIF_AGENT_KILL_GRACE_MS: '400',
  } });
  cleanups.push(() => ext.close());
  const tabs = [{ id: 12, windowId: 1, active: true, url: 'https://example.com/page', title: 'Example' }, { id: 13, windowId: 1, active: false, url: 'https://example.org/page', title: 'Example org' }];
  ext.handlers = {
    tabs: () => tabs,
    status: () => ({ userScripts: true, chrome: '140.0.0.0', version: pkg.version, mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [] }),
    reload: (a) => ({ url: (tabs.find((t) => t.id === (a.tab ?? a.tabId)) || tabs[0]).url }),
    errors: () => [],
    logs: () => [{ mod: 'example.com/probe', level: 'log', args: ['hello'], time: Date.now() }],
  };
  // As the extension does: say which mods it registered after each set (trif verify waits for it).
  const onMessage = ext._onMessage.bind(ext);
  ext._onMessage = (m) => {
    onMessage(m);
    if (m.type === 'mods' && Array.isArray(m.mods)) ext.send({ type: 'modsApplied', registered: m.mods.map((x) => x.id), errors: [] });
  };
  ext.hello();
  await ext.waitForSocket(10000);
  fixture = { home, code, ws, priv, keychainDir, kc, ext, anthropic, openai, anthropicScript, openaiScript };
  return fixture;
}

let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `s${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
async function runAgent(f, { agent, site, tabId, model, extra = {} }) {
  const r = await extRequest(f.ext, 'agent.start', { agent, site, url: `https://${site}/page`, tabId, prompt: 'probe the sandbox', ...(model ? { model } : {}), ...extra });
  assert.equal(r.ok, true, r.error);
  const done = await f.ext.next((m) => m.type === 'agentEvent' && m.runId === r.result.runId && m.event.kind === 'done', { timeout: 100000 });
  const events = f.ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === r.result.runId).map((m) => m.event);
  return { runId: r.result.runId, done: done.event, events };
}
const helperLog = (f) => { try { return fs.readFileSync(path.join(f.priv, 'helper.log'), 'utf8').split('\n').slice(-30).join('\n'); } catch { return '(no helper.log)'; } };

// The `trif` commands a run uses, for its own site. Each must work in the run's sandbox.
const trifCommands = (site) => [
  'trif status',
  'trif tabs',
  `trif new ${site} probe --style`,
  `trif check ${site}/probe`,
  `trif verify ${site}/probe`,
  'trif explain',
  'trif explain boxed-mods',
  'trif errors',
  'trif logs',
  'trif mods',
  'trif help new',
  'trif doctor',
  'trif report',
];
// What a missing or refused file looks like in a command's output (node's errors, the shell's, a sandbox's).
const FILE_TROUBLE = /\bEPERM\b|\bEACCES\b|\bENOENT\b|operation not permitted|permission denied|no such file|cannot find module/i;

function report(results, extra = '') {
  return results.map((x) => `$ ${x.cmd}\n[exit ${x.code}]\n${String(x.out).slice(0, 1500)}`).join('\n----\n') + (extra ? `\n====\n${extra}` : '');
}

function checkTrif(results, info) {
  for (const x of results) {
    assert.ok(!FILE_TROUBLE.test(x.out), `\`${x.cmd}\` ran into a file it couldn't read in the run's sandbox (a file the helper reads that runs.js CODE_ITEMS doesn't let runs read?):\n${x.out}\n\n${info}`);
    assert.equal(x.code, 0, `\`${x.cmd}\` failed in the run's sandbox:\n${x.out}\n\n${info}`);
  }
  const by = (c) => results.find((x) => x.cmd.startsWith(c)).out;
  assert.match(by('trif tabs'), /example\.com\/page/, info);
  assert.match(by('trif new'), /probe\.js/, info);
  assert.match(by('trif check'), /^ok: /m, info);
  assert.match(by('trif verify'), /== check[\s\S]*reloaded https:\/\/[\s\S]*== errors[\s\S]*== logs/, info);
  assert.match(by('trif explain boxed-mods'), /\w/, info);
}

// Who refuses what, by what each says: the sandbox (Seatbelt: EPERM), the agent's own rules, `trif`'s.
const BY = {
  sandbox: /operation not permitted|\bEPERM\b/i,
  claude: /was blocked|haven't granted|requested permissions|not allowed/i,
  trif: /not available inside a side-panel agent run|inside a side-panel agent run, files are read only in/,
  curl: /curl: \(7\)/, // (couldn't connect)
};

function checkRefused(named, refused, info) {
  for (const [i, x] of refused.entries()) {
    const got = named[i];
    assert.notEqual(got.code, 0, `\`${got.cmd}\` should have been refused:\n${info}`);
    assert.ok(!got.out.includes(SECRET) && !/^CONNECTED$/m.test(got.out), `\`${got.cmd}\` got through:\n${info}`);
    assert.match(got.out, BY[x.by], `\`${got.cmd}\` should have been refused (${x.by === 'sandbox' ? 'by the sandbox' : x.by === 'claude' ? "by Claude Code's rules" : 'by trif'}):\n${info}`);
  }
}

test('Claude Code: real `trif` commands work in a side-panel run\'s sandbox; the private folder, config.json, the keychain and TRIF\'s other files stay out of reach', { skip: skipWhy(CLAUDE, 'Claude Code') }, async () => {
  const f = await setup();
  const site = 'example.com';
  const commands = trifCommands(site);
  // (a run's shell commands are only `trif`, `ls` and `cd`, and Claude Code itself refuses an `ls` or `cd`
  // outside the run's working folder, and a Read outside the workspace; `trif` refuses files outside the
  // run's mods; so the sandbox shows itself in what `trif` would write elsewhere: another site's folder)
  const refused = [
    { cmd: `ls ${q(f.priv)}`, by: 'claude' },
    { cmd: `cd ${q(f.priv)}`, by: 'claude' },
    { tool: 'Read', input: { file_path: path.join(f.priv, 'config.json') }, by: 'claude' },
    { cmd: `ls ${q(path.join(f.code, 'extension'))}`, by: 'claude' },
    { cmd: `trif check ${q(path.join(f.priv, 'config.json'))}`, by: 'trif' },
    { cmd: `trif check ${q(path.join(f.keychainDir, 'login.keychain-db'))}`, by: 'trif' },
    { cmd: `trif check ${q(path.join(f.code, '.git', 'config'))}`, by: 'trif' },
    { cmd: 'trif agent key --agent claude', by: 'trif' },
    { cmd: 'trif new other.net probe --style', by: 'sandbox' },
  ];
  const steps = [...commands.map((c) => ({ bash: c })), ...refused.map((x) => (x.tool ? { tool: x.tool, input: x.input } : { bash: x.cmd })), { say: 'Done: probed.' }];
  setScript(f.anthropicScript, steps);
  const { done, events } = await runAgent(f, { agent: 'claude', site, tabId: 12 });
  const results = claudeResults(f.anthropic);
  const labels = [...commands, ...refused.map((x) => x.cmd || `${x.tool} ${x.input.file_path}`)];
  const named = results.map((x, i) => ({ ...x, cmd: labels[i] || '?' }));
  const info = report(named, `events: ${JSON.stringify(events).slice(0, 2000)}\nhelper.log:\n${helperLog(f)}`);
  assert.equal(done.ok, true, info);
  assert.equal(results.length, labels.length, `every step ran:\n${info}`);
  checkTrif(named.slice(0, commands.length), info);
  checkRefused(named.slice(commands.length), refused, info);
  assert.ok(!fs.existsSync(path.join(f.ws, 'sites', 'other.net', 'probe.js')));
  assert.ok(!JSON.stringify(f.anthropic.requests.map((x) => x.body)).includes(SECRET), `something secret reached the model:\n${info}`);
});

test('Claude Code in TRIF\'s full sandbox: without TRIF\'s pinned copy (missing, or changed) the run stops and says so; the user\'s own is never started', { skip: !process.env.TRIF_WHOLE_BOX ? 'TRIF_WHOLE_BOX=1 only' : skipWhy(CLAUDE, 'Claude Code') }, async () => {
  const f = await setup();
  const asked = f.anthropic.requests.length;
  const hidden = `${fixturePinned}.away`;
  fs.renameSync(fixturePinned, hidden);
  try {
    const { done, events } = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
    const info = `events: ${JSON.stringify(events)}\nhelper.log:\n${helperLog(f)}`;
    assert.equal(done.ok, false, info);
    assert.ok(events.some((e) => e.kind === 'error' && /TRIF's own copy of Claude Code isn't downloaded yet/.test(e.message)), info);
    assert.doesNotMatch(JSON.stringify(events) + helperLog(f), /the user's own claude was started/, info);
    // (step 4: the panel's card, never a fallback by itself)
    assert.ok(events.some((e) => e.kind === 'error' && e.reason === 'boxUnavailable' && e.why === 'missing'), info);
    assert.deepStrictEqual(done.error && [done.error.kind, done.error.why], ['boxUnavailable', 'missing'], info);
    // The person's choice on that card, "Run this chat with the older protection": the user's own Claude
    // Code (here the agents folder's stand-in, which says it was started), not TRIF's box.
    const older = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12, extra: { olderProtection: true } });
    const olderInfo = `events: ${JSON.stringify(older.events)}\nhelper.log:\n${helperLog(f)}`;
    assert.match(JSON.stringify(older.events), /the user's own claude was started/, olderInfo);
    assert.ok(older.done.olderProtection && !older.events.some((e) => e.reason === 'boxUnavailable'), olderInfo);
    assert.ok(runLog(f, older.runId).some((x) => x.webmods === 'olderProtection'), olderInfo);
  } finally { fs.renameSync(hidden, fixturePinned); }
  // changed since it was downloaded (its record says another SHA-256): not started either
  const markFile = path.join(fixturePinned, require('../helper/lib/claudepin').MARK);
  const mark = fs.readFileSync(markFile, 'utf8');
  fs.unlinkSync(markFile); // (a hard link on CI: a new file, not the shared one)
  fs.writeFileSync(markFile, JSON.stringify({ ...JSON.parse(mark), binSha256: '0'.repeat(64) }));
  try {
    const { done, events } = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
    const info = `events: ${JSON.stringify(events)}\nhelper.log:\n${helperLog(f)}`;
    assert.equal(done.ok, false, info);
    assert.ok(events.some((e) => e.kind === 'error' && /TRIF's own copy of Claude Code wasn't started: it has changed since it was downloaded\./.test(e.message)), info);
  } finally { fs.unlinkSync(markFile); fs.writeFileSync(markFile, mark); }
  assert.equal(f.anthropic.requests.length, asked, 'no model call');
});

// Step 6b (docs/WHOLE-BOX-PROGRESS.md): Claude Code's own login is out of the box's reach, so a boxed run signs
// in with a saved API key (the key proxy: the tests above) or the token `claude setup-token` gives (the
// keyring; claudetoken.js prepareBoxed). A stand-in token, a stand-in keychain, a stand-in Anthropic.
test('Claude Code in TRIF\'s full sandbox, signed in with setup-token\'s token: no sign-in → "sign in" (mode token); the token → a run; refused → "sign in again"', { skip: !process.env.TRIF_WHOLE_BOX ? 'TRIF_WHOLE_BOX=1 only' : skipWhy(CLAUDE, 'Claude Code') }, async () => {
  const f = await setup();
  const ct = require('../helper/lib/claudetoken');
  const TOKEN = 'sk-ant-oat01-' + 'Stand_in-boxed-'.repeat(5) + 'AA';
  await keys.removeAgentKey('claude', { env: f.kc.env });
  try {
    // Neither an API key nor a token: the run stops before Claude Code starts, as a sign-in for the box.
    let asked = f.anthropic.requests.length;
    let r = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
    let info = `events: ${JSON.stringify(r.events)}\nhelper.log:\n${helperLog(f)}`;
    assert.equal(r.done.ok, false, info);
    assert.deepStrictEqual(r.done.error && [r.done.error.kind, r.done.error.mode, r.done.error.refused], ['login', 'token', false], info);
    assert.ok(r.events.some((e) => e.kind === 'error' && e.reason === 'login' && e.mode === 'token' && /need you to sign in to Claude Code for TRIF first/.test(e.message)), info);
    assert.equal(f.anthropic.requests.length, asked, 'no model call');
    // The token in the keyring: the run signs in with it (Bearer, no API key), and it's nowhere else.
    await ct.storeToken(TOKEN, { env: f.kc.env });
    setScript(f.anthropicScript, [{ say: 'Signed in, boxed.' }]);
    asked = f.anthropic.requests.length;
    r = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
    info = `events: ${JSON.stringify(r.events).slice(0, 3000)}\nhelper.log:\n${helperLog(f)}`;
    assert.equal(r.done.ok, true, info);
    const calls = f.anthropic.requests.slice(asked).filter((x) => x.method === 'POST' && /\/v1\/messages/.test(x.url));
    assert.ok(calls.length, `a model call:\n${info}`);
    for (const c of calls) {
      assert.equal(c.headers.authorization, `Bearer ${TOKEN}`, info);
      assert.equal(c.headers['x-api-key'], undefined, 'no API key with it');
    }
    const logs = fs.readdirSync(f.priv).filter((n) => /\.(log|jsonl)$/.test(n)).map((n) => fs.readFileSync(path.join(f.priv, n), 'utf8')).join('\n');
    assert.ok(!JSON.stringify(r.events).includes(TOKEN) && !logs.includes(TOKEN), 'the token in no event, no log');
    // Anthropic refuses it (expired, revoked): "sign in again", mode token, and Settings hears of it.
    setScript(f.anthropicScript, [{ status: 401, message: 'OAuth token has expired' }]);
    const since = f.ext.messages.length;
    r = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
    info = `events: ${JSON.stringify(r.events).slice(0, 3000)}\nhelper.log:\n${helperLog(f)}`;
    assert.equal(r.done.ok, false, info);
    assert.deepStrictEqual(r.done.error && [r.done.error.kind, r.done.error.mode, r.done.error.refused], ['login', 'token', true], info);
    assert.match(r.done.error.message, /refused TRIF's full sandbox sign-in/, info);
    const wb = await f.ext.next((m) => m.type === 'wholeBox' && m.wholeBox.refused, { timeout: 10000, since });
    assert.deepStrictEqual([wb.wholeBox.signedIn, wb.wholeBox.token], [false, true]);
    // Sign out (Settings): the token leaves the keyring.
    const out = await extRequest(f.ext, 'wholeBox.signOut');
    assert.equal(out.ok, true, out.error);
    assert.deepStrictEqual([out.result.signedIn, out.result.token], [false, false]);
    assert.deepStrictEqual(await ct.readToken({ env: f.kc.env }), { value: null, error: null });
  } finally {
    await ct.removeToken({ env: f.kc.env }).catch(() => {});
    await keys.setAgentKey('claude', KEY, { env: f.kc.env });
    setScript(f.anthropicScript, [{ say: 'ok' }]);
  }
});

// docs/WHOLE-BOX.md step 7: an organization forcing Claude Code's own sandbox on (CI writes the runner's real
// managed settings), which can't start inside TRIF's box. The run gets no Bash and the `trif` tool instead.
// Step 7a (Tim 11-21): the same with the loosest settings (TRIF_TEST_MANAGED=loosen: Bash(*), bypass mode, every
// folder, Claude Code's sandbox off), which let a run use any command: no shell either, and no question.
const NO_SHELL_SKIP = !process.env.TRIF_WHOLE_BOX || !(MANAGED_TEST.startsWith('sandbox-on') || MANAGED_TEST === 'loosen') ? 'TRIF_WHOLE_BOX=1 with TRIF_TEST_MANAGED=sandbox-on… or loosen only (CI)' : skipWhy(CLAUDE, 'Claude Code');
// (the run's own log, <private>/runs/<id>.jsonl)
const runLog = (f, runId) => { try { return fs.readFileSync(path.join(f.priv, 'runs', `${runId}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }); } catch { return []; } };
// In TRIF's full sandbox an organization's loosening settings are never asked about: no "Use Claude Code
// anyway" card, no "no TRIF sandbox" mark; they're in the run's log.
function notAsked(f, runId, events, info) {
  assert.ok(!events.some((e) => e.kind === 'sandbox' || (e.kind === 'error' && e.reason === 'sandbox')), `asked, or marked "no TRIF sandbox":\n${info}`);
  const note = runLog(f, runId).find((x) => x.webmods === 'orgSettings');
  assert.ok(note && note.loosens.length && /managed-settings\.json/.test(note.from), `the organization's settings in the run's log:\n${JSON.stringify(runLog(f, runId)).slice(0, 2000)}`);
}
// Step 3: what the box refused, read from Seatbelt's reports (boxrefusals.js), is in the run's log; printed
// too, so CI shows what a run that worked was refused along the way (what a failed run's error would name).
// (3b: what every boxed run is refused, boxrefusals.js ROUTINE, is kept apart, `routine`: never in `refused`)
const USUAL = /notification_center|CFUserTextEncoding|GlobalPreferences|libxcrun|cc-socks|com\.apple\.(analyticsd|SecurityServer|securityd\.xpc|FSEvents)|claude-cli-nodejs/;
function boxSaw(f, runId, expected, info) {
  const line = runLog(f, runId).find((x) => x.webmods === 'boxRefused');
  console.log(`# the box refused (run ${runId}): ${JSON.stringify(line || null)}`);
  assert.ok(line && !line.unwatched, `the box's refusals watched:\n${JSON.stringify(line)}\n${info}`);
  const seen = [...line.refused, ...(line.routine || [])];
  for (const re of expected) assert.ok(seen.some((w) => re.test(w)), `${re} among the box's refusals: ${JSON.stringify(line)}`);
  assert.deepStrictEqual(line.refused.filter((w) => USUAL.test(w)), [], `what every run is refused, apart (routine): ${JSON.stringify(line)}`);
  return line;
}
test('Claude Code in TRIF\'s full sandbox, no shell: managed settings force its own sandbox on (or let it run any command), so the run has no Bash and every `trif` command works through the trif tool, still boxed', { skip: NO_SHELL_SKIP || (!['sandbox-on', 'loosen'].includes(MANAGED_TEST) && 'TRIF_TEST_MANAGED=sandbox-on or loosen only') }, async () => {
  const f = await setup();
  const site = 'example.com';
  const commands = trifCommands(site);
  const words = (c) => c.split(' ').slice(1); // (the commands above have no quoted words)
  const refused = [
    { tool: 'Bash', input: { command: 'trif status', description: 'probe' }, by: /no such tool|not available|unknown tool|isn't available|does not exist/i },
    { tool: 'mcp__trif__trif', input: { args: ['new', 'other.net', 'probe', '--style'] }, by: BY.sandbox },
    { tool: 'mcp__trif__trif', input: { args: ['check', path.join(f.priv, 'config.json')] }, by: BY.trif },
    { tool: 'Read', input: { file_path: path.join(f.priv, 'config.json') }, by: /operation not permitted|EPERM|was blocked|haven't granted|requested permissions|not allowed/i },
  ];
  const steps = [...commands.map((c) => ({ tool: 'mcp__trif__trif', input: { args: words(c) } })), ...refused.map((x) => ({ tool: x.tool, input: x.input })), { say: 'Done: probed.' }];
  setScript(f.anthropicScript, steps);
  const { runId, done, events } = await runAgent(f, { agent: 'claude', site, tabId: 12 });
  const results = claudeResults(f.anthropic);
  const labels = [...commands, ...refused.map((x) => `${x.tool} ${JSON.stringify(x.input)}`)];
  const named = results.map((x, i) => ({ ...x, cmd: labels[i] || '?' }));
  const info = report(named, `events: ${JSON.stringify(events).slice(0, 3000)}\nhelper.log:\n${helperLog(f)}`);
  assert.equal(done.ok, true, info);
  assert.equal(results.length, labels.length, `every step ran:\n${info}`);
  checkTrif(named.slice(0, commands.length), info);
  for (const [i, x] of refused.entries()) {
    const got = named[commands.length + i];
    assert.notEqual(got.code, 0, `${got.cmd} should have been refused:\n${info}`);
    assert.ok(!got.out.includes(SECRET), `${got.cmd} got through:\n${info}`);
    assert.match(got.out, x.by, `${got.cmd}:\n${info}`);
  }
  assert.ok(!fs.existsSync(path.join(f.ws, 'sites', 'other.net', 'probe.js')));
  // What the model was offered: no Bash, the trif tool; told there's no shell.
  const offered = f.anthropic.requests.filter((r) => r.body && Array.isArray(r.body.tools)).flatMap((r) => r.body.tools.map((t) => t.name));
  assert.ok(offered.includes('mcp__trif__trif') && !offered.includes('Bash'), `tools offered: ${[...new Set(offered)].join(', ')}`);
  assert.ok(JSON.stringify(f.anthropic.requests.map((r) => r.body && r.body.system)).includes('There is no shell in this chat'), 'told there is no shell');
  // The panel's steps read as they do with a shell: "trif status", not mcp__trif__trif.
  assert.ok(events.some((e) => e.kind === 'tool' && e.name === 'Bash' && e.summary === 'trif status'), info);
  assert.ok(!JSON.stringify(f.anthropic.requests.map((x) => x.body)).includes(SECRET), `something secret reached the model:\n${info}`);
  const noShell = runLog(f, runId).find((x) => x.webmods === 'noShell');
  assert.match((noShell || {}).why || '', MANAGED_TEST === 'loosen' ? /allow `Bash\(\*\)` without asking/ : /force Claude Code's sandbox on/, info);
  if (MANAGED_TEST === 'loosen') notAsked(f, runId, events, info);
  boxSaw(f, runId, [/^writing .*other\.net/], info);
});

test('Claude Code in TRIF\'s full sandbox, managed settings that only loosen its rules (Claude Code\'s sandbox off, every folder, acceptEdits, no other commands): not asked, a shell, still boxed', { skip: !process.env.TRIF_WHOLE_BOX || MANAGED_TEST !== 'loosen-shell' ? 'TRIF_WHOLE_BOX=1 with TRIF_TEST_MANAGED=loosen-shell only (CI)' : skipWhy(CLAUDE, 'Claude Code') }, async () => {
  const f = await setup();
  const site = 'example.com';
  const commands = trifCommands(site);
  // (every folder is Claude Code's to read and write now: what stops these is TRIF's box)
  const refused = [
    { cmd: `ls ${q(f.priv)}`, by: /operation not permitted|EPERM|was blocked|haven't granted|requested permissions|not allowed/i },
    { tool: 'Read', input: { file_path: path.join(f.priv, 'config.json') }, by: BY.sandbox },
    { tool: 'Write', input: { file_path: path.join(f.priv, 'probe.txt'), content: 'x' }, by: BY.sandbox },
    { tool: 'Read', input: { file_path: path.join(f.keychainDir, 'login.keychain-db') }, by: BY.sandbox },
    { cmd: 'trif new other.net probe --style', by: BY.sandbox },
  ];
  const steps = [...commands.map((c) => ({ bash: c })), ...refused.map((x) => (x.tool ? { tool: x.tool, input: x.input } : { bash: x.cmd })), { say: 'Done: probed.' }];
  setScript(f.anthropicScript, steps);
  const { runId, done, events } = await runAgent(f, { agent: 'claude', site, tabId: 12 });
  const results = claudeResults(f.anthropic);
  const labels = [...commands, ...refused.map((x) => x.cmd || `${x.tool} ${x.input.file_path}`)];
  const named = results.map((x, i) => ({ ...x, cmd: labels[i] || '?' }));
  const info = report(named, `events: ${JSON.stringify(events).slice(0, 3000)}\nhelper.log:\n${helperLog(f)}`);
  assert.equal(done.ok, true, info);
  assert.equal(results.length, labels.length, `every step ran:\n${info}`);
  checkTrif(named.slice(0, commands.length), info);
  for (const [i, x] of refused.entries()) {
    const got = named[commands.length + i];
    assert.notEqual(got.code, 0, `${got.cmd} should have been refused:\n${info}`);
    assert.ok(!got.out.includes(SECRET), `${got.cmd} got through:\n${info}`);
    assert.match(got.out, x.by, `${got.cmd}:\n${info}`);
  }
  assert.ok(!fs.existsSync(path.join(f.priv, 'probe.txt')) && !fs.existsSync(path.join(f.ws, 'sites', 'other.net', 'probe.js')));
  const offered = f.anthropic.requests.filter((r) => r.body && Array.isArray(r.body.tools)).flatMap((r) => r.body.tools.map((t) => t.name));
  assert.ok(offered.includes('Bash') && !offered.includes('mcp__trif__trif'), `a shell: ${[...new Set(offered)].join(', ')}`);
  assert.ok(!runLog(f, runId).some((x) => x.webmods === 'noShell'), info);
  notAsked(f, runId, events, info);
  // (not every refusal is reported: round 5's CI had none for the Write; boxrefusals.js)
  boxSaw(f, runId, [/^reading .*config\.json/, /^reading .*login\.keychain-db/, /^writing .*other\.net/], info);
  assert.ok(!JSON.stringify(f.anthropic.requests.map((x) => x.body)).includes(SECRET), `something secret reached the model:\n${info}`);
});

// Step 3b: a run the box makes fail, for real. An organization's settings send Claude Code to a host of
// their own (an LLM gateway: here an address nobody answers on, 192.0.2.1, TEST-NET), which the box doesn't
// let it reach (step 5 will, through the relay, for hosts those settings name). The run fails, and its
// error names that connection and nothing every run is refused.
test('Claude Code in TRIF\'s full sandbox, managed settings sending it to another host (an LLM gateway): the box makes the run fail, and the error says what it refused', { skip: !process.env.TRIF_WHOLE_BOX || MANAGED_TEST !== 'gateway' ? 'TRIF_WHOLE_BOX=1 with TRIF_TEST_MANAGED=gateway only (CI)' : skipWhy(CLAUDE, 'Claude Code') }, async () => {
  const f = await setup();
  setScript(f.anthropicScript, [{ say: 'Done: the model was reached (it should not have been).' }]);
  const started = Date.now();
  const { runId, done, events } = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
  const info = `events: ${JSON.stringify(events).slice(0, 4000)}\nhelper.log:\n${helperLog(f)}`;
  console.log(`# the failed run (${Date.now() - started} ms): ${JSON.stringify(events.filter((e) => e.kind === 'error' || e.kind === 'done')).slice(0, 3000)}`);
  assert.equal(done.ok, false, info);
  assert.equal(f.anthropic.requests.length, 0, `the stand-in model was reached:\n${info}`);
  const err = events.find((e) => e.kind === 'error' && e.reason === 'box');
  assert.ok(err, `an error naming what the box refused:\n${info}`);
  // (Seatbelt's report names the port, not always the address: "remote:*:80", CI round 6)
  assert.match(err.message, /^TRIF's full sandbox refused .*a connection to (port 80|192\.0\.2\.1:80) \(claude\)/, info);
  assert.doesNotMatch(err.message, USUAL, `what every run is refused isn't named:\n${info}`);
  assert.ok((done.boxRefused || []).some((w) => /a connection to (port 80|192\.0\.2\.1:80)/.test(w)), info);
  assert.ok(events.indexOf(err) < events.indexOf(done), 'before done');
  const line = boxSaw(f, runId, [/a connection to (port 80|192\.0\.2\.1:80)/], info);
  assert.ok((line.routine || []).length, `what every run is refused, in the log: ${JSON.stringify(line)}`);
  assert.ok(!done.error || done.error.kind !== 'login', `not a login error:\n${info}`);
});

test('Claude Code in TRIF\'s full sandbox, no shell, and managed settings that take the trif tool away: the run stops before Claude Code starts, saying why', { skip: NO_SHELL_SKIP || (MANAGED_TEST !== 'sandbox-on-no-mcp' && 'TRIF_TEST_MANAGED=sandbox-on-no-mcp only') }, async () => {
  const f = await setup();
  const asked = f.anthropic.requests.length;
  const { done, events } = await runAgent(f, { agent: 'claude', site: 'example.com', tabId: 12 });
  const info = `events: ${JSON.stringify(events)}\nhelper.log:\n${helperLog(f)}`;
  assert.equal(done.ok, false, info);
  assert.ok(events.some((e) => e.kind === 'error' && /require Claude Code's own sandbox.*can't run in TRIF's full sandbox/.test(e.message)), info);
  assert.equal(f.anthropic.requests.length, asked, 'no model call');
});

test('Codex: real `trif` commands work in a side-panel run\'s sandbox; the private folder, config.json, the keychain, TRIF\'s other files and the network stay out of reach', { skip: skipWhy(CODEX, 'Codex') }, async () => {
  const f = await setup();
  const site = 'example.org';
  const commands = trifCommands(site);
  const node = process.execPath;
  // (Codex runs any command: the sandbox alone stops these, but `trif agent key`, which `trif` refuses)
  const refused = [
    { cmd: `cat ${q(path.join(f.priv, 'config.json'))}`, by: 'sandbox' },
    { cmd: `ls ${q(f.priv)}`, by: 'sandbox' },
    { cmd: `cat ${q(path.join(f.keychainDir, 'login.keychain-db'))}`, by: 'sandbox' },
    { cmd: `cat ${q(path.join(f.keychainDir, 'items.json'))}`, by: 'sandbox' },
    { cmd: `cat ${q(path.join(f.code, '.git', 'config'))}`, by: 'sandbox' },
    { cmd: `cat ${q(path.join(f.code, 'extension', 'manifest.json'))}`, by: 'sandbox' },
    { cmd: 'trif agent key --agent codex', by: 'trif' },
    { cmd: 'trif new other.net probe --style', by: 'sandbox' },
    // The network: not even the model's stand-in on 127.0.0.1, nor the helper's socket.
    { cmd: `curl -sS -m 5 ${f.openai.url}/api/version`, by: 'curl' },
    { cmd: `${q(node)} -e ${q("require('net').connect(process.argv[1]).on('connect',()=>{console.log('CONNECTED');process.exit(0)}).on('error',(e)=>{console.log('socket: '+e.message);process.exit(1)})")} ${q(path.join(f.ws, 'helper.sock'))}`, by: 'sandbox' },
  ];
  // (each command's output and exit status in one stream: 2>&1, then the status on a line of its own)
  const wrap = (c) => `${c} 2>&1; echo "[exit=$?]"`;
  setScript(f.openaiScript, [...commands.map((c) => ({ run: wrap(c) })), ...refused.map((x) => ({ run: wrap(x.cmd) })), { say: 'Done: probed.' }]);
  // (a model of its own name: Codex offers its shell tool to a model it has no catalog entry for)
  const { done, events } = await runAgent(f, { agent: 'codex', site, tabId: 13, model: 'stand-in' });
  const outs = f.openai.toolOutputs();
  const labels = [...commands, ...refused.map((x) => x.cmd)];
  const named = outs.map((o, i) => {
    const m = /\[exit=(\d+)\]\s*$/.exec(o);
    return { cmd: labels[i] || '?', code: m ? Number(m[1]) : -1, out: o };
  });
  const first = f.openai.requests.find((x) => x.method === 'POST' && x.body);
  const offered = first && Array.isArray(first.body.tools) ? first.body.tools.map((t) => t && (t.name || t.type)) : [];
  const info = report(named, `model: ${first && first.body.model}, tools offered: ${offered.join(', ')}\nevents: ${JSON.stringify(events).slice(0, 2000)}\nhelper.log:\n${helperLog(f)}`);
  assert.equal(done.ok, true, info);
  assert.equal(outs.length, labels.length, `every step ran:\n${info}`);
  checkTrif(named.slice(0, commands.length), info);
  checkRefused(named.slice(commands.length), refused, info);
  assert.ok(!fs.existsSync(path.join(f.ws, 'sites', 'other.net', 'probe.js')));
  assert.ok(!JSON.stringify(f.openai.requests.map((x) => x.body)).includes(SECRET), `something secret reached the model:\n${info}`);
});

// (the stand-ins keep the script array they were started with: a test's own steps go into it)
function setScript(script, steps) {
  script.length = 0;
  script.push(...steps);
}

// Claude Code's tool results, in order: {code: 0 or 1 (is_error), out}.
function claudeResults(api) {
  const last = [...api.requests].reverse().find((r) => r.body && Array.isArray(r.body.messages) && r.body.stream);
  if (!last) return [];
  const out = [];
  for (const m of last.body.messages) {
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (!c || c.type !== 'tool_result') continue;
      const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : JSON.stringify(c.content);
      out.push({ code: c.is_error ? 1 : 0, out: text });
    }
  }
  return out;
}
