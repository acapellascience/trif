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
  fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, env: { ...(cfg.env || {}), PATH }, secret: SECRET }));
  fs.writeFileSync(path.join(keychainDir, 'login.keychain-db'), SECRET);
  // Another site's mods: read-only to runs (the sandbox's doing, runs.js runLimits readOnly).
  fs.mkdirSync(path.join(ws, 'sites', 'other.net'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'sites', 'other.net', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://other.net/*\n// ==/WebMod==\n');
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
  fixture = { home, code, ws, priv, keychainDir, ext, anthropic, openai, anthropicScript, openaiScript };
  return fixture;
}

let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `s${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
async function runAgent(f, { agent, site, tabId, model }) {
  const r = await extRequest(f.ext, 'agent.start', { agent, site, url: `https://${site}/page`, tabId, prompt: 'probe the sandbox', ...(model ? { model } : {}) });
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
