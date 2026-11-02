'use strict';
// Tests for agent runs: helper/lib/agents/*, helper/lib/runs.js, the agent.* commands in host.js,
// `webmods agent`, and the agent bits of setup/doctor. Uses a fake `claude` executable; never the real one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, runCli, writeMod, tempDir, waitFor, sleep } = require('./fake-extension');
const claude = require('../helper/lib/agents/claude');
const codex = require('../helper/lib/agents/codex');
const agents = require('../helper/lib/agents');
const { diffSnapshots } = require('../helper/lib/runs');
const { redact } = require('../helper/lib/logins');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

// ------------------------------------------------------------------ fake agent

// A fake Claude Code. Behaviour comes from words in the prompt (its env is sanitized, so env vars
// can't steer it): NOTLOGGEDIN, CRASH, SLEEP, STUBBORN (ignores SIGTERM), EDIT (changes a mod file),
// EVIL (writes a mod for its site and one for <all_urls>).
// Every call is dumped to <dir>/calls/<time>-<pid>.json with argv, env and cwd.
// `auth status --json` says logged in once <dir>/logged-in exists; `auth login` prints the sign-in
// lines, dumps its env to <dir>/login-env.json, reads one line and logs in if it's GOODCODE (anything
// else: "Invalid code: <code>" on stderr, exit 1).
const FAKE_CLAUDE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const flag = path.join(__dirname, 'logged-in');
if (argv[0] === 'auth' && argv[1] === 'status') {
  const yes = fs.existsSync(flag);
  console.log(JSON.stringify({ loggedIn: yes, authMethod: yes ? 'claude.ai' : 'none' }, null, 2));
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'login') {
  fs.writeFileSync(path.join(__dirname, 'login-env.json'), JSON.stringify({ argv, env: process.env, cwd: process.cwd(), pid: process.pid }));
  process.stdout.write('Opening browser to sign in\u2026\\n');
  process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake&state=SECRETSTATE&code_challenge=CHALLENGE\\n");
  process.stdout.write('Paste code here if prompted > ');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    const nl = buf.indexOf('\\n');
    if (nl === -1) return;
    const code = buf.slice(0, nl).trim();
    if (code === 'GOODCODE') { fs.writeFileSync(flag, 'yes'); process.stdout.write('\\nLogin successful.\\n', () => process.exit(0)); return; }
    process.stderr.write('Invalid code: ' + code + '\\n', () => process.exit(1));
  });
  process.stdin.on('end', () => process.exit(2));
  return;
}
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const prompt = argv.includes('--') ? argv[argv.indexOf('--') + 1] : '';
const calls = path.join(__dirname, 'calls');
fs.mkdirSync(calls, { recursive: true });
fs.writeFileSync(path.join(calls, Date.now() + '-' + process.pid + '.json'), JSON.stringify({ argv, env: process.env, cwd: process.cwd(), pid: process.pid, prompt }));
const session = opt('--resume') || 'sess-new-1';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [] });
if (prompt.includes('NOTLOGGEDIN')) {
  say({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } });
  say({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: session, total_cost_usd: 0 });
  process.exit(1);
}
if (prompt.includes('CRASH')) {
  process.stderr.write('starting up\\nTypeError: boom went the fake agent\\n');
  process.exit(3);
}
if (prompt.includes('STUBBORN')) process.on('SIGTERM', () => {});
if (prompt.includes('SLEEP') || prompt.includes('STUBBORN')) {
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Thinking hard' }] } });
  setInterval(() => {}, 1000);
  return;
}
say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hiding the banner now.' }] } });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'webmods reload --tab 12' } }] } });
say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'reloaded' }] } });
if (prompt.includes('EDIT')) {
  const file = path.join(process.cwd(), 'sites', 'example.com', 'fake.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// edited ' + Date.now() + Math.random());
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }] } });
}
if (prompt.includes('HIDDEN')) {
  // A mod for every site, where a looser snapshot once didn't look (node_modules).
  const dir = path.join(process.cwd(), 'sites', 'node_modules');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hidden.js'), '// ==WebMod==\\n// @match *://*/*\\n// ==/WebMod==\\n// ' + Date.now());
}
if (prompt.includes('EVIL')) {
  // One mod inside the run's site, one that reaches every site (gets held).
  const dir = path.join(process.cwd(), 'sites', 'example.com');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'good.js'), '// fine ' + Date.now());
  fs.writeFileSync(path.join(dir, 'evil.js'), '// ==WebMod==\\n// @match <all_urls>\\n// ==/WebMod==\\n// ' + Date.now());
}
process.stdout.write('not json at all\\n');
say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done: the banner is hidden.' }] } });
say({ type: 'result', subtype: 'success', is_error: false, result: 'Done: the banner is hidden.', session_id: session, total_cost_usd: 0.0123 });
`;

// A workspace whose recorded PATH holds only the fake claude.
function makeHome({ fake = true, config = {} } = {}) {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  if (fake) {
    fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
  }
  const cfg = { ...config, env: { PATH: bin, ...(config.env || {}) } };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(cfg));
  return { home, bin };
}

function calls(bin) {
  const dir = path.join(bin, 'calls');
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return []; }
  return names.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
}
function callFor(bin, word) { return calls(bin).find((c) => c.prompt.includes(word)); }

function startHost(home, env = {}) {
  const ext = new FakeExtension({ home, env: { WEBMODS_AGENT_KILL_GRACE_MS: '400', ...env } });
  cleanups.push(() => ext.close());
  return ext;
}

let reqN = 0;
// Ask the helper something as the extension would; resolves the response message.
async function extRequest(ext, cmd, args = {}) {
  const id = `e${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}

function eventsOf(ext, runId) {
  return ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
}
function waitDone(ext, runId, timeout = 8000) {
  return ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout }).then((m) => m.event);
}

function sockRequest(sock, msg, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error('socket request timed out')); }, timeout);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify(msg) + '\n'));
    s.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, nl))); }
    });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const START = { site: 'example.com', url: 'https://example.com/page', tabId: 12 };

// ------------------------------------------------------------------ adapters (pure)

test('claude adapter: command flags, resume and model', () => {
  const limits = { workspace: '/h', readOnly: ['/h/sites/y.com'], denied: ['/Users/u/.ssh', '/Users/u/Desktop', '/h/config.json', '/h/runs'],
    home: '/Users/u', readable: ['/h', '/app'], privateFiles: ['/h/config.json', '/h/runs'],
    box: '/c/boxes/r1', screenshots: '/h/screenshots/x.com', otherScreenshots: ['/h/screenshots/y.com'] };
  const c = claude.command({ bin: '/x/claude', prompt: 'hi', context: 'CTX', ...limits });
  assert.equal(c.file, '/x/claude');
  const settings = JSON.parse(c.args[c.args.indexOf('--settings') + 1]);
  assert.deepEqual(c.args.filter((a, i) => c.args[i - 1] !== '--settings'), ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default',
    '--setting-sources', 'project', '--strict-mcp-config', '--settings',
    '--allowedTools', 'Read(./**)', 'Glob', 'Grep', 'Edit(./sites/**)', 'Bash(webmods:*)', 'Bash(cd:*)', 'Bash(ls:*)',
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Read(./config.json)', 'Read(./safari-token)', 'Read(./helper.log*)', 'Read(./runs/*.jsonl)',
    'Read(./screenshots/*.png)', '--append-system-prompt', 'CTX', '--', 'hi']);
  // The run's sandbox: fails closed, no way out of it, no network, the run's reads and writes.
  const sb = settings.sandbox;
  assert.deepEqual([sb.enabled, sb.failIfUnavailable, sb.allowUnsandboxedCommands, sb.autoAllowBashIfSandboxed], [true, true, false, false]);
  assert.deepEqual(sb.network, { allowedDomains: [], strictAllowlist: true });
  // The whole home folder, reopened where the run may read: not each item in it (Claude Code looks inside
  // each listed folder, and macOS asked the user about Desktop, Documents and the like).
  assert.deepEqual(sb.filesystem.denyRead, ['/Users/u', '/h/config.json', '/h/runs']);
  assert.deepEqual(sb.filesystem.allowRead, ['/h', '/app', '/c/boxes/r1', '/h/screenshots/x.com']);
  assert.ok(!JSON.stringify(settings).includes('Desktop'));
  assert.deepEqual(sb.filesystem.allowWrite, ['/c/boxes/r1', '/h/screenshots/x.com']);
  for (const p of ['/h/held.json', '/h/preinstalled.json', '/h/runs', '/h/sites/y.com']) assert.ok(sb.filesystem.denyWrite.includes(p), p);
  assert.deepEqual(settings.permissions.deny, ['Edit(./sites/y.com/**)', 'Read(./screenshots/y.com/**)']);
  assert.equal(claude.tooOld('2.1.284 (Claude Code)'), true);
  assert.equal(claude.tooOld('2.1.312 (Claude Code)'), false);
  const r = claude.command({ bin: '/x/claude', prompt: 'hi', context: 'CTX', sessionId: 's1', model: 'opus' });
  assert.deepEqual(r.args.slice(-6), ['--resume', 's1', '--model', 'opus', '--', 'hi']);
  // A message that looks like an option is still the message.
  const f = claude.command({ bin: '/x/claude', prompt: '--dangerously-skip-permissions hide ads' });
  assert.deepEqual(f.args.slice(-2), ['--', '--dangerously-skip-permissions hide ads']);
  assert.ok(!f.args.slice(0, -1).includes('--dangerously-skip-permissions hide ads'));
});

test('claude adapter: parses init, text, tools, result; maps "Not logged in"', () => {
  const ev = [];
  const emit = (e) => ev.push(e);
  const st = { workspace: '/ws' };
  claude.parse(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }), emit, st);
  claude.parse(JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Hello' }, { type: 'text', text: '  ' },
    { type: 'tool_use', name: 'Bash', input: { command: 'webmods reload\n --tab 3' } },
    { type: 'tool_use', name: 'Write', input: { file_path: '/ws/sites/a.com/m.js' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/elsewhere/x' } },
  ] } }), emit, st);
  claude.parse('garbage', emit, st);
  claude.parse(JSON.stringify({ type: 'result', is_error: false, subtype: 'success', result: 'ok!', total_cost_usd: 0.5, session_id: 'abc' }), emit, st);
  assert.deepEqual(ev, [
    { kind: 'session', sessionId: 'abc' },
    { kind: 'text', text: 'Hello' },
    { kind: 'tool', name: 'Bash', summary: 'webmods reload --tab 3' },
    { kind: 'tool', name: 'Write', summary: 'sites/a.com/m.js' },
    { kind: 'tool', name: 'Read', summary: '/elsewhere/x' },
    { kind: 'done', ok: true, result: 'ok!', costUsd: 0.5, sessionId: 'abc' },
  ]);
  ev.length = 0;
  claude.parse(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login', session_id: 's' }), emit, st);
  assert.equal(ev[0].kind, 'error');
  assert.equal(ev[0].message, "Claude Code isn't logged in: run `claude` in a terminal and log in (type /login)");
  assert.equal(ev[1].kind, 'done');
  assert.equal(ev[1].ok, false);
  ev.length = 0;
  claude.parse(JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', session_id: 's' }), emit, st);
  assert.match(ev[0].message, /error_max_turns/);
});

test('codex adapter: command, resume, JSONL events', () => {
  const c = codex.command({ bin: '/x/codex', prompt: 'P', model: 'gpt-5', readable: ['/h', '/app'], writable: ['/h/sites', '/h/screenshots/x.com', '/h/runs/r1.box'], readOnly: ['/h/sites/y.com'], denied: ['/Users/u/.ssh', '/h/config.json', '/h/runs'] });
  assert.equal(c.args[0], 'exec');
  assert.ok(c.args.includes('--json') && c.args.includes('--skip-git-repo-check'));
  assert.deepEqual(c.args.slice(-4), ['-m', 'gpt-5', '--', 'P']);
  // The site limit is a permission profile the OS enforces; nothing that would replace it is loaded.
  assert.ok(!c.args.includes('--sandbox'), 'the legacy --sandbox would override the profile');
  assert.ok(c.args.includes('--ignore-user-config') && c.args.includes('--ignore-rules'));
  assert.ok(c.args.includes('approval_policy="never"'));
  assert.ok(c.args.includes('default_permissions="webmods-run"'));
  // No network: `webmods` reaches the helper through the run's mailbox.
  assert.equal(c.args.find((a) => a.startsWith('permissions=')),
    'permissions={ webmods-run = { extends = ":workspace", filesystem = { ":workspace_roots" = { "." = "read" }, "/Users/u/.ssh" = "deny", "/h/config.json" = "deny", "/h/runs" = "deny", "/h" = "read", "/app" = "read", "/h/sites" = "write", "/h/screenshots/x.com" = "write", "/h/runs/r1.box" = "write", "/h/sites/y.com" = "read" }, network = { enabled = false } } }');
  assert.equal(codex.tooOld('codex-cli 0.137.9'), true);
  assert.equal(codex.tooOld('0.166.0'), false);
  assert.equal(codex.tooOld(null), false);
  const r = codex.command({ bin: '/x/codex', prompt: 'P', sessionId: 'th1' });
  assert.deepEqual(r.args.slice(-4), ['resume', 'th1', '--', 'P']);

  const ev = [];
  const emit = (e) => ev.push(e);
  const st = { workspace: '/ws' };
  const line = (o) => codex.parse(JSON.stringify(o), emit, st);
  line({ type: 'thread.started', thread_id: 'th1' });
  line({ type: 'turn.started' });
  line({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'webmods tabs', status: 'in_progress' } });
  line({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'webmods tabs', exit_code: 0, status: 'completed' } });
  line({ type: 'item.started', item: { id: 'i2', type: 'file_change', changes: [] } });
  line({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: '/ws/sites/a.com/m.js', kind: 'add' }] } });
  line({ type: 'item.completed', item: { id: 'i3', type: 'reasoning', text: 'hmm' } });
  line({ type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'All done.' } });
  line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } });
  assert.deepEqual(ev, [
    { kind: 'session', sessionId: 'th1' },
    { kind: 'tool', name: 'Bash', summary: 'webmods tabs' },
    { kind: 'tool', name: 'Edit', summary: 'sites/a.com/m.js' },
    { kind: 'text', text: 'All done.' },
    { kind: 'done', ok: true, result: 'All done.', costUsd: null, sessionId: 'th1' },
  ]);
  ev.length = 0;
  line({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } });
  assert.match(ev[0].message, /Codex isn't logged in/);
  assert.equal(ev[1].ok, false);
});

test('context text names the URL and tab; diffSnapshots catches edits, adds and deletes', () => {
  const t = agents.contextText({ url: 'https://x.com/home', tabId: 7 });
  assert.match(t, /looking at https:\/\/x\.com\/home \(tab 7\): pass `--tab 7`/);
  assert.match(t, /Follow AGENTS\.md/);
  assert.match(t, /webmods disable\/enable/);
  assert.match(t, /`webmods status` shows which are on/);
  assert.match(agents.reminderText({ url: 'https://x.com/', tabId: 7 }), /x\.com.*--tab 7/);
  const before = new Map([['sites/a', '1'], ['sites/b', '2'], ['sites/c', '3']]);
  const after = new Map([['sites/a', '1'], ['sites/b', 'X'], ['sites/d', '4']]);
  assert.deepEqual(diffSnapshots(before, after), ['sites/b', 'sites/c', 'sites/d']);
});

// ------------------------------------------------------------------ host: agent.* commands

test('agent.list: finds the fake claude on the recorded PATH, codex missing', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.list');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.default, 'claude');
  const c = r.result.agents.find((a) => a.id === 'claude');
  assert.deepEqual(c, {
    id: 'claude', name: 'Claude Code', path: path.join(bin, 'claude'), available: true, version: '9.9.9', note: '',
    canLogin: true, loginFix: claude.loginFix, loggedIn: false,
  });
  const x = r.result.agents.find((a) => a.id === 'codex');
  assert.equal(x.available, false);
  assert.equal(x.note, 'not found');
  assert.equal(x.loggedIn, null);
  assert.equal(x.canLogin, false);
  // Same over the socket.
  await ext.waitForSocket();
  const s = await sockRequest(ext.sock, { id: 'l', cmd: 'agent.list' });
  assert.equal(s.ok, true);
  assert.equal(s.result.agents[0].path, path.join(bin, 'claude'));
  // Unknown extension requests get an error response.
  const bad = await extRequest(ext, 'agent.fly');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown command/);
});

test('agent.start: runId first, then session/text/tool events, one done with changedFiles and sessionId', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'EDIT hide the banner', agent: 'claude' });
  assert.equal(r.ok, true, r.error);
  assert.match(r.result.runId, /^r[0-9a-z]+$/);
  const runId = r.result.runId;
  const done = await waitDone(ext, runId);
  const respIdx = ext.messages.indexOf(r);
  const firstEv = ext.messages.findIndex((m) => m.type === 'agentEvent' && m.runId === runId);
  assert.ok(respIdx < firstEv, 'response before the first event');
  await sleep(200);
  const evs = eventsOf(ext, runId);
  assert.deepEqual(evs.slice(0, -1), [
    { kind: 'session', sessionId: 'sess-new-1' },
    { kind: 'text', text: 'Hiding the banner now.' },
    { kind: 'tool', name: 'Bash', summary: 'webmods reload --tab 12' },
    { kind: 'tool', name: 'Edit', summary: 'sites/example.com/fake.js' },
    { kind: 'text', text: 'Done: the banner is hidden.' },
  ]);
  assert.equal(evs.filter((e) => e.kind === 'done').length, 1);
  assert.deepEqual(done, { kind: 'done', ok: true, result: 'Done: the banner is hidden.', costUsd: 0.0123, changedFiles: ['sites/example.com/fake.js'], sessionId: 'sess-new-1' });

  // The agent got the contract's flags, cwd and context.
  const call = callFor(bin, 'EDIT');
  assert.equal(call.cwd, home);
  const a = call.argv;
  assert.equal(a[a.indexOf('--') + 1], 'EDIT hide the banner');
  for (const f of ['--output-format', 'stream-json', '--verbose', '--strict-mcp-config']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'default');
  assert.equal(JSON.parse(a[a.indexOf('--settings') + 1]).sandbox.enabled, true);
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project');
  const ctx = a[a.indexOf('--append-system-prompt') + 1];
  assert.match(ctx, /https:\/\/example\.com\/page \(tab 12\)/);
  assert.ok(!a.includes('--resume'));

  // Raw output kept.
  const raw = fs.readFileSync(path.join(home, 'runs', `${runId}.jsonl`), 'utf8');
  assert.match(raw, /"subtype":"init"/);
  assert.match(raw, /not json at all/);
  assert.match(raw, /"webmods":"done"/);
});

test('agent.start with sessionId passes --resume; unchanged files give empty changedFiles', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'RESUMEME again', sessionId: 'sess-old-9', model: 'sonnet' });
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true);
  assert.equal(done.sessionId, 'sess-old-9');
  assert.deepEqual(done.changedFiles, []);
  const a = callFor(bin, 'RESUMEME').argv;
  assert.equal(a[a.indexOf('--resume') + 1], 'sess-old-9');
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
});

test('agent env is sanitized: no inherited CLAUDE*/ANTHROPIC_*/CODEX_*, API key only from config', async () => {
  const { home, bin } = makeHome({ config: { env: { ANTHROPIC_API_KEY: 'from-config', SOMETHING_ELSE: 'no' } } });
  const ext = startHost(home, {
    CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ANTHROPIC_BASE_URL: 'https://evil', ANTHROPIC_API_KEY: 'inherited',
    CODEX_HOME: '/tmp/codex', OPENAI_API_KEY: 'inherited-openai', SECRET_TOKEN: 's3cret', LANG: 'en_CA.UTF-8',
  });
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'ENVDUMP' });
  await waitDone(ext, r.result.runId);
  const env = callFor(bin, 'ENVDUMP').env;
  const leaked = Object.keys(env).filter((k) => /^(CLAUDE|ANTHROPIC_|CODEX_)/.test(k) && k !== 'ANTHROPIC_API_KEY');
  assert.deepEqual(leaked, []);
  assert.equal(env.ANTHROPIC_API_KEY, 'from-config');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.SECRET_TOKEN, undefined);
  assert.equal(env.SOMETHING_ELSE, undefined);
  assert.equal(env.TERM, 'dumb');
  assert.equal(env.LANG, 'en_CA.UTF-8');
  assert.equal(env.HOME, path.join(home, 'fakehome'));
  assert.equal(env.WEBMODS_HOME, home);
  // The run reaches this host (and so this browser) through its own mailbox, not a socket; no socket path.
  assert.equal(path.dirname(env.WEBMODS_RUN_BOX), path.join(home, 'boxes'));
  assert.match(path.basename(env.WEBMODS_RUN_BOX), /^r[a-z0-9]+$/);
  assert.equal(env.WEBMODS_RUN_SCREENSHOTS, path.join(home, 'screenshots', 'example.com'));
  assert.ok(/^[0-9a-f]{32}$/.test(env.WEBMODS_RUN_TOKEN));
  assert.equal(env.WEBMODS_SOCK, undefined);
  assert.deepEqual(env.PATH.split(':').slice(0, 2), [path.join(home, 'bin'), bin]);
});

test('agent.stop kills the run (SIGTERM, then SIGKILL for a stubborn agent); done says stopped', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  for (const word of ['SLEEP', 'STUBBORN']) {
    const r = await extRequest(ext, 'agent.start', { ...START, prompt: `${word} forever` });
    const runId = r.result.runId;
    await ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'text');
    const t0 = Date.now();
    const s = await extRequest(ext, 'agent.stop', { runId });
    assert.deepEqual(s.result, { stopped: true });
    const done = await waitDone(ext, runId);
    assert.equal(done.ok, false);
    assert.equal(done.stopped, true);
    assert.equal(done.sessionId, 'sess-new-1');
    if (word === 'STUBBORN') assert.ok(Date.now() - t0 >= 350, 'waited for the SIGKILL grace');
    const pid = callFor(bin, word).pid;
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { message: `${word} agent gone` });
    // No error event for a stop the user asked for.
    assert.equal(eventsOf(ext, runId).filter((e) => e.kind === 'error').length, 0);
  }
  const unknown = await extRequest(ext, 'agent.stop', { runId: 'nope' });
  assert.equal(unknown.ok, false);
});

test('one run per site: a second start for a busy site fails; another site is fine', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  const a = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP one' });
  assert.equal(a.ok, true);
  const b = await extRequest(ext, 'agent.start', { ...START, url: 'https://www.example.com/other', site: 'www.example.com', prompt: 'SLEEP two' });
  assert.equal(b.ok, false);
  assert.equal(b.error, 'already working on example.com');
  const c = await extRequest(ext, 'agent.start', { site: 'other.org', url: 'https://other.org/', tabId: 3, prompt: 'SLEEP three' });
  assert.equal(c.ok, true, c.error);
  await ext.waitForSocket();
  const ping = await sockRequest(ext.sock, { id: 'p', cmd: 'ping' });
  assert.deepEqual(ping.result.runs.map((r) => r.site).sort(), ['example.com', 'other.org']);
  await extRequest(ext, 'agent.stop', { runId: a.result.runId });
  await waitDone(ext, a.result.runId);
  const d = await extRequest(ext, 'agent.start', { ...START, prompt: 'quick one' });
  assert.equal(d.ok, true, 'site is free again after done');
  await waitDone(ext, d.result.runId);
  await extRequest(ext, 'agent.stop', { runId: c.result.runId });
  await waitDone(ext, c.result.runId);
  const missing = await extRequest(ext, 'agent.start', { ...START, prompt: '' });
  assert.match(missing.error, /missing prompt/);
  const bad = await extRequest(ext, 'agent.start', { ...START, prompt: 'x', agent: 'gemini' });
  assert.match(bad.error, /unknown agent "gemini"/);
});

test('errors: not logged in, crash with stderr tail, agent missing, 15-minute limit (shortened)', async () => {
  const { home } = makeHome();
  const ext = startHost(home);

  let r = await extRequest(ext, 'agent.start', { ...START, prompt: 'NOTLOGGEDIN please' });
  let done = await waitDone(ext, r.result.runId);
  let errs = eventsOf(ext, r.result.runId).filter((e) => e.kind === 'error');
  assert.deepEqual(errs, [{ kind: 'error', message: "Claude Code isn't logged in: run `claude` in a terminal and log in (type /login)" }]);
  assert.equal(eventsOf(ext, r.result.runId).filter((e) => e.kind === 'text').length, 0, 'no "Not logged in" chat text');
  assert.equal(done.ok, false);
  assert.equal(done.sessionId, null, "a logged-out run's empty session isn't kept");
  assert.equal(done.discardSession, undefined);
  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'NOTLOGGEDIN on resume', sessionId: 'sess-keep' });
  done = await waitDone(ext, r.result.runId);
  assert.equal(done.sessionId, 'sess-keep');

  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'CRASH now' });
  done = await waitDone(ext, r.result.runId);
  errs = eventsOf(ext, r.result.runId).filter((e) => e.kind === 'error');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /Claude Code exited with code 3/);
  assert.match(errs[0].message, /TypeError: boom went the fake agent/);
  assert.equal(done.ok, false);
  assert.equal(done.sessionId, 'sess-new-1');

  const limited = startHost(home, { WEBMODS_AGENT_TIMEOUT_MS: '1500' });
  r = await extRequest(limited, 'agent.start', { ...START, prompt: 'SLEEP until the limit' });
  done = await waitDone(limited, r.result.runId);
  errs = eventsOf(limited, r.result.runId).filter((e) => e.kind === 'error');
  assert.match(errs[0].message, /was stopped after/);
  assert.equal(done.ok, false);

  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'hi', agent: 'codex' });
  done = await waitDone(ext, r.result.runId);
  errs = eventsOf(ext, r.result.runId).filter((e) => e.kind === 'error');
  assert.match(errs[0].message, /Codex isn't installed/);
  assert.deepEqual(done, { kind: 'done', ok: false, result: null, costUsd: null, changedFiles: [], sessionId: null });
});

test('run logs are pruned to the last 50', async () => {
  const { home } = makeHome();
  const runs = path.join(home, 'runs');
  fs.mkdirSync(runs);
  const old = Date.now() / 1000 - 3600;
  for (let i = 0; i < 60; i++) {
    const f = path.join(runs, `old${i}.jsonl`);
    fs.writeFileSync(f, '{}\n');
    fs.utimesSync(f, old + i, old + i);
  }
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'prune' });
  await waitDone(ext, r.result.runId);
  const left = fs.readdirSync(runs).filter((f) => f.endsWith('.jsonl'));
  assert.equal(left.length, 50);
  assert.ok(left.includes(`${r.result.runId}.jsonl`));
  assert.ok(!left.includes('old0.jsonl') && left.includes('old59.jsonl'));
});

test('helper shutdown kills a running agent', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'STUBBORN at shutdown' });
  await ext.next((m) => m.type === 'agentEvent' && m.runId === r.result.runId && m.event.kind === 'text');
  const pid = callFor(bin, 'STUBBORN').pid;
  await ext.close();
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { message: 'agent killed with the helper' });
});

// ------------------------------------------------------------------ logging in

const LOGIN_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=fake&state=SECRETSTATE&code_challenge=CHALLENGE';
function loginEnv(bin) { return JSON.parse(fs.readFileSync(path.join(bin, 'login-env.json'), 'utf8')); }
function helperLog(home) { try { return fs.readFileSync(path.join(home, 'helper.log'), 'utf8'); } catch { return ''; } }
async function startLogin(ext, args = { agent: 'claude' }) {
  const r = await extRequest(ext, 'agent.login', args);
  assert.equal(r.ok, true, r.error);
  const loginId = r.result.loginId;
  const ev = await ext.next((m) => m.type === 'agentEvent' && m.runId === loginId && m.event.kind === 'login');
  return { loginId, url: ev.event.url, response: r };
}

test('claude login output parsing and redaction (pure)', () => {
  assert.equal(claude.parseLoginLine('Opening browser to sign in…'), null);
  assert.deepEqual(claude.parseLoginLine(`If the browser didn't open, visit: ${LOGIN_URL}`), { kind: 'login', url: LOGIN_URL });
  assert.equal(claude.parseLoginLine('Paste code here if prompted > '), null);
  assert.deepEqual(claude.parseLoginLine('Paste code here if prompted > Login successful.'), { kind: 'text', text: 'Login successful.' });
  assert.deepEqual(claude.parseLoginLine('Something else'), { kind: 'text', text: 'Something else' });
  assert.equal(redact(`visit: ${LOGIN_URL} now`), 'visit: https://claude.com/cai/oauth/authorize?… now');
  assert.equal(redact('Invalid code: abc#123', ['abc#123']), 'Invalid code: [code]');
  assert.equal(codex.login, null);
});

test('agent.login: URL event, code, done ok; agent.list then says loggedIn (cached); nothing secret in helper.log', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home, {
    CLAUDECODE: '1', ANTHROPIC_BASE_URL: 'https://evil', BROWSER: '/Applications/Evil.app',
  });
  let list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents.find((a) => a.id === 'claude').loggedIn, false);

  const { loginId, url, response } = await startLogin(ext);
  assert.match(loginId, /^l[0-9a-z]+$/);
  assert.ok(ext.messages.indexOf(response) < ext.messages.findIndex((m) => m.type === 'agentEvent' && m.runId === loginId), 'response first');
  assert.equal(url, LOGIN_URL);
  const le = loginEnv(bin);
  assert.deepEqual(le.argv, ['auth', 'login']);
  assert.equal(le.cwd, home);
  assert.equal(le.env.BROWSER, '/usr/bin/true');
  assert.deepEqual(Object.keys(le.env).filter((k) => /^(CLAUDE|ANTHROPIC_)/.test(k)), []);
  await ext.waitForSocket();
  assert.equal((await sockRequest(ext.sock, { id: 'p', cmd: 'ping' })).result.login.loginId, loginId);

  const sent = await extRequest(ext, 'agent.loginCode', { loginId, code: '  GOODCODE \n' });
  assert.deepEqual(sent.result, { sent: true });
  const done = await waitDone(ext, loginId);
  assert.deepEqual(done, { kind: 'done', ok: true, login: true });
  assert.deepEqual(eventsOf(ext, loginId).map((e) => e.kind), ['login', 'text', 'done']);
  assert.equal(eventsOf(ext, loginId)[1].text, 'Login successful.');

  list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents.find((a) => a.id === 'claude').loggedIn, true);
  // Cached for 30 s: logging out behind its back doesn't show yet.
  fs.unlinkSync(path.join(bin, 'logged-in'));
  list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents.find((a) => a.id === 'claude').loggedIn, true);
  // ...but a run that finds it logged out forgets the cache.
  const run = await extRequest(ext, 'agent.start', { ...START, prompt: 'NOTLOGGEDIN again' });
  await waitDone(ext, run.result.runId);
  list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents.find((a) => a.id === 'claude').loggedIn, false);

  const log = helperLog(home);
  assert.match(log, /sign-in URL https:\/\/claude\.com\/cai\/oauth\/authorize\?…/);
  assert.match(log, /code sent/);
  assert.ok(!log.includes('GOODCODE'), 'code not logged');
  assert.ok(!log.includes('SECRETSTATE') && !log.includes('CHALLENGE'), 'URL query not logged');
  assert.ok(!fs.existsSync(path.join(home, 'runs')) || !fs.readdirSync(path.join(home, 'runs')).filter((f) => f.endsWith('.jsonl')).some((f) => fs.readFileSync(path.join(home, 'runs', f), 'utf8').includes('GOODCODE')));
  assert.equal((await sockRequest(ext.sock, { id: 'p2', cmd: 'ping' })).result.login, null);
});

test('agent.login: bad code fails (redacted), cancel, one login at a time, bad requests, codex unsupported, time limit', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);

  // Bad code: done not ok, the error carries the CLI's output with the code masked.
  let { loginId } = await startLogin(ext);
  await extRequest(ext, 'agent.loginCode', { loginId, code: 'BADCODE123' });
  let done = await waitDone(ext, loginId);
  assert.deepEqual(done, { kind: 'done', ok: false, login: true });
  const errs = eventsOf(ext, loginId).filter((e) => e.kind === 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, 'Logging in to Claude Code failed: Invalid code: [code]');
  assert.ok(!JSON.stringify(eventsOf(ext, loginId)).includes('BADCODE123'));
  assert.equal((await extRequest(ext, 'agent.list')).result.agents[0].loggedIn, false);

  // Cancel: the process goes, done says cancelled, no error.
  ({ loginId } = await startLogin(ext));
  const pid = loginEnv(bin).pid;
  const c = await extRequest(ext, 'agent.loginCancel', { loginId });
  assert.deepEqual(c.result, { cancelled: true });
  done = await waitDone(ext, loginId);
  assert.deepEqual(done, { kind: 'done', ok: false, login: true, cancelled: true });
  assert.equal(eventsOf(ext, loginId).filter((e) => e.kind === 'error').length, 0);
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { message: 'login process gone' });

  // A second login replaces the first.
  const first = await startLogin(ext);
  const second = await startLogin(ext);
  assert.notEqual(first.loginId, second.loginId);
  assert.equal((await waitDone(ext, first.loginId)).cancelled, true);
  const stale = await extRequest(ext, 'agent.loginCode', { loginId: first.loginId, code: 'GOODCODE' });
  assert.match(stale.error, /no login in progress/);
  const empty = await extRequest(ext, 'agent.loginCode', { loginId: second.loginId, code: '  ' });
  assert.match(empty.error, /missing code/);
  const multi = await extRequest(ext, 'agent.loginCode', { loginId: second.loginId, code: 'a\nb' });
  assert.match(multi.error, /doesn't look like a login code/);
  await extRequest(ext, 'agent.loginCancel', { loginId: second.loginId });
  await waitDone(ext, second.loginId);
  assert.match((await extRequest(ext, 'agent.loginCancel', { loginId: second.loginId })).error, /no login in progress/);

  const cx = await extRequest(ext, 'agent.login', { agent: 'codex' });
  assert.match(cx.error, /^Codex can't log in from the side panel: run `codex login` in a terminal$/);
  assert.match((await extRequest(ext, 'agent.login', { agent: 'gemini' })).error, /unknown agent/);

  const log = helperLog(home);
  assert.ok(!log.includes('BADCODE123'), 'bad code not logged');
  assert.ok(!log.includes('SECRETSTATE'), 'URL query not logged');

  const limited = startHost(home, { WEBMODS_LOGIN_TIMEOUT_MS: '1500' });
  const r = await extRequest(limited, 'agent.login', {});
  done = await waitDone(limited, r.result.loginId);
  assert.equal(done.ok, false);
  assert.match(eventsOf(limited, r.result.loginId).find((e) => e.kind === 'error').message, /stopped after/);
});

test('agent.login without the agent installed fails right away', async () => {
  const { home } = makeHome({ fake: false });
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.login', { agent: 'claude' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Claude Code isn't installed/);
  const list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents[0].loggedIn, null);
});

// ------------------------------------------------------------------ CLI

test('CLI: agent run streams events and prints a summary; agent list with and without the helper', async () => {
  const { home, bin } = makeHome();
  let r = await runCli(['agent', 'list'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^claude +Claude Code 9\\.9\\.9 +${bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/claude +default$`, 'm'));
  assert.match(r.stdout, /^codex +Codex: not found +not found$/m);

  r = await runCli(['agent', 'run', '--url', 'https://example.com/', '--tab', '12', 'x'], { home });
  assert.equal(r.code, 2, 'no helper');

  const ext = startHost(home);
  ext.hello();
  await ext.waitForSocket();
  r = await runCli(['agent', 'list', '--json'], { home });
  assert.equal(JSON.parse(r.stdout).default, 'claude');

  r = await runCli(['agent', 'run', '--url', 'example.com/page', '--tab', '12', 'EDIT', 'the', 'banner'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, [
    'Hiding the banner now.',
    '',
    '  [Bash] webmods reload --tab 12',
    '  [Edit] sites/example.com/fake.js',
    'Done: the banner is hidden.',
    '',
    'done: ok ($0.0123)',
    'session: sess-new-1   (continue: webmods agent run --session sess-new-1 --url https://example.com/page "...")',
    'changed: sites/example.com/fake.js',
    '',
  ].join('\n'));
  const a = calls(bin).pop().argv;
  assert.equal(a[a.indexOf('--') + 1], 'EDIT the banner');
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /https:\/\/example\.com\/page \(tab 12\)/);
  // The extension saw the same run.
  assert.ok(ext.messages.some((m) => m.type === 'agentEvent' && m.event.kind === 'done'));

  // --session resumes; --json prints one event per line.
  r = await runCli(['agent', 'run', '--url', 'https://example.com/', '--session', 'sess-old', '--json', 'again'], { home });
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.match(lines[0].runId, /^r/);
  assert.deepEqual(lines[1], { kind: 'session', sessionId: 'sess-old' });
  assert.equal(lines[lines.length - 1].kind, 'done');
  assert.equal(lines[lines.length - 1].sessionId, 'sess-old');

  // Without --url it asks Chrome for the tab's URL.
  ext.handlers.tabs = () => [{ id: 5, active: true, url: 'https://news.example.org/x', title: 't' }, { id: 6, active: false, url: 'https://b.com/', title: 'b' }];
  r = await runCli(['agent', 'run', 'TABLESS'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(callFor(bin, 'TABLESS').argv.join(' '), /news\.example\.org\/x \(tab 5\)/);
  r = await runCli(['agent', 'run', '--tab', '6', 'TAB6'], { home });
  assert.match(callFor(bin, 'TAB6').argv.join(' '), /https:\/\/b\.com\/ \(tab 6\)/);

  // Failures exit 1 with the error on stderr.
  r = await runCli(['agent', 'run', '--url', 'https://example.com/', 'NOTLOGGEDIN'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /error: Claude Code isn't logged in/);
  assert.match(r.stdout, /done: failed/);
  r = await runCli(['agent', 'run', '--url', 'https://example.com/'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing prompt/);
});

test('CLI: agent login prints the URL, reads the code from stdin, reports the result', async () => {
  const { home, bin } = makeHome();
  let r = await runCli(['agent', 'login'], { home, input: 'GOODCODE\n' });
  assert.equal(r.code, 2, 'no helper');
  const ext = startHost(home);
  ext.hello();
  await ext.waitForSocket();

  r = await runCli(['agent', 'login'], { home, input: 'NOPE-CODE\n' });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /Open this page in your browser and sign in:/);
  assert.ok(r.stdout.includes(`  ${LOGIN_URL}\n`));
  assert.match(r.stdout, /Not logged in\.\n$/);
  assert.match(r.stderr, /error: Logging in to Claude Code failed: Invalid code: \[code\]/);

  r = await runCli(['agent', 'login'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no code given/);
  assert.match(r.stdout, /Login cancelled\.\n$/);

  r = await runCli(['agent', 'login', '--agent', 'claude'], { home, input: 'GOODCODE\n' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Then paste the code it shows here: Checking…\nLogged in\.\n$/);
  assert.ok(fs.existsSync(path.join(bin, 'logged-in')));
  r = await runCli(['agent', 'list'], { home });
  assert.doesNotMatch(r.stdout, /not logged in/);

  r = await runCli(['agent', 'login', '--agent', 'codex'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /can't log in from the side panel/);
  assert.ok(!helperLog(home).includes('NOPE-CODE') && !helperLog(home).includes('GOODCODE'));
});

test('CLI: agent run on a busy site fails fast', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  const busy = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP busy' });
  await ext.waitForSocket();
  const r = await runCli(['agent', 'run', '--url', 'https://example.com/', 'hello'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already working on example\.com/);
  await extRequest(ext, 'agent.stop', { runId: busy.result.runId });
  await waitDone(ext, busy.result.runId);
});

// ------------------------------------------------------------------ setup and doctor

test('setup records PATH (merging config.json) and writes .claude/settings.json; doctor reports agents', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ modsDir: 'sites', env: { ANTHROPIC_API_KEY: 'k', PATH: '/old' } }));
  const fakeBin = path.join(root, 'fakebin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'claude'), FAKE_CLAUDE);
  fs.chmodSync(path.join(fakeBin, 'claude'), 0o755);
  const termPath = `${fakeBin}:/usr/bin:/bin`;
  let r = await runCli(['setup', '--native-dir', path.join(root, 'native'), '--no-link'], { home: ws, env: { PATH: termPath } });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(ws, 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { modsDir: 'sites', env: { ANTHROPIC_API_KEY: 'k', PATH: termPath } });
  const settings = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings, {
    permissions: {
      allow: ['Read(./**)', 'Glob', 'Grep', 'Edit(./sites/**)', 'Bash(webmods:*)', 'Bash(cd:*)', 'Bash(ls:*)'],
      deny: ['WebFetch', 'WebSearch', 'Read(./config.json)', 'Read(./safari-token)', 'Read(./helper.log*)', 'Read(./runs/*.jsonl)',
        'Read(./screenshots/*.png)'],
    },
  });
  assert.match(r.stdout, new RegExp(`agents +claude \\(${fakeBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/claude\\), codex not found`));

  // Overwritten on every setup; a broken config.json is left alone.
  fs.writeFileSync(path.join(ws, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash"]}}');
  fs.writeFileSync(path.join(ws, 'config.json'), '{ broken');
  r = await runCli(['setup', '--native-dir', path.join(root, 'native'), '--no-link'], { home: ws, env: { PATH: termPath } });
  assert.match(r.stdout, /couldn't record PATH for agents: .*not valid JSON/);
  assert.equal(fs.readFileSync(path.join(ws, 'config.json'), 'utf8'), '{ broken');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8')), settings);
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ env: { PATH: termPath } }));

  r = await runCli(['doctor', '--native-dir', path.join(root, 'native')], { home: ws });
  assert.match(r.stdout, /^ok {4}Claude Code 9\.9\.9 \(.*fakebin\/claude\)$/m);
  assert.match(r.stdout, /^warn {2}Claude Code isn't logged in, so the side panel can't use it$/m);
  assert.match(r.stdout, /fix: run `claude` in a terminal and log in/);
  assert.match(r.stdout, /^- {5}Codex: not found \(optional\)$/m);

  // Agent on the terminal's PATH but not the recorded one.
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ env: { PATH: '/usr/bin' } }));
  r = await runCli(['doctor', '--native-dir', path.join(root, 'native')], { home: ws, env: { PATH: termPath } });
  assert.match(r.stdout, /warn {2}Claude Code is at .*fakebin\/claude, but the helper won't find it there/);
  assert.match(r.stdout, /fix: run webmods setup in this terminal/);
});

// ------------------------------------------------------------------ merging a new version of a shipped mod

// A workspace where WebMods shipped example.com/plain version 1, the user changed it, and version 2 waits.
function homeWithPendingUpdate() {
  const { home, bin } = makeHome();
  const sha1 = (s) => require('crypto').createHash('sha1').update(s).digest('hex');
  const v = (n, body) => `// ==WebMod==\n// @source webmods\n// @version ${n}\n// ==/WebMod==\n// ${body}\n`;
  writeMod(home, 'example.com', 'plain.js', v(1, 'mine'));
  fs.mkdirSync(path.join(home, '.shipped', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(home, '.shipped', 'example.com', 'plain.js'), v(1, 'one'));
  fs.writeFileSync(path.join(home, '.shipped', 'example.com', 'plain.new.js'), v(2, 'two'));
  fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify({
    offered: ['example.com/plain'], startOff: [], sitesOn: [],
    shipped: { 'example.com/plain': { hash: sha1(v(1, 'one')), version: '1', pending: { hash: sha1(v(2, 'two')), version: '2' } } },
  }));
  return { home, bin, newHash: sha1(v(2, 'two')) };
}

test('merge run: the agent gets the three files; a run that finishes well settles the update', async () => {
  const { home, bin, newHash } = homeWithPendingUpdate();
  const ext = startHost(home);
  const first = await ext.nextMods((ms) => ms.length === 1);
  assert.deepEqual(first[0].update, { version: '2', from: '1', modified: true });

  // A failed run leaves it waiting.
  let r = await extRequest(ext, 'agent.start', { ...START, prompt: 'CRASH while merging', merge: 'example.com/plain' });
  assert.equal(r.ok, true, r.error);
  assert.equal((await waitDone(ext, r.result.runId)).ok, false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(home, 'preinstalled.json'), 'utf8')).shipped['example.com/plain'].pending);

  // Only from the mod's own site.
  r = await extRequest(ext, 'agent.start', { site: 'other.org', url: 'https://other.org/', tabId: 3, prompt: 'merge', merge: 'example.com/plain' });
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't a mod for other\.org/);

  const since = ext.messages.length;
  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'Merge the new version, keeping my changes.', merge: 'example.com/plain' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true);
  const call = callFor(bin, 'keeping my changes');
  assert.match(call.prompt, /^Merge the new version, keeping my changes\.\n\n/);
  assert.match(call.prompt, /edit this file, and only this one\): sites\/example\.com\/plain\.js/);
  assert.match(call.prompt, /\(read only\): \.shipped\/example\.com\/plain\.new\.js/);
  assert.match(call.prompt, /\(version 1\), which the user's copy started from \(read only\): \.shipped\/example\.com\/plain\.js/);
  const rec = JSON.parse(fs.readFileSync(path.join(home, 'preinstalled.json'), 'utf8')).shipped['example.com/plain'];
  assert.deepEqual(rec, { hash: newHash, version: '2' });
  assert.ok(!fs.existsSync(path.join(home, '.shipped', 'example.com', 'plain.new.js')));
  // The mods went out again without the update, before the run's done.
  const doneIdx = ext.messages.findIndex((m) => m.type === 'agentEvent' && m.event.kind === 'done' && m.runId === r.result.runId);
  const modsIdx = ext.messages.findIndex((m, i) => i >= since && m.type === 'mods' && !m.mods[0].update);
  assert.ok(modsIdx !== -1 && modsIdx < doneIdx);
  // Nothing left to merge.
  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'again', merge: 'example.com/plain' });
  assert.match(r.error, /no new WebMods version/);
});

test('merge run: choosing what happens to the update is the user\'s, not the run\'s', async () => {
  const { home, bin } = homeWithPendingUpdate();
  const ext = startHost(home);
  await ext.waitForSocket();
  await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP' });
  const call = await waitFor(() => callFor(bin, 'SLEEP'), { message: 'the agent to start' });
  const token = call.env.WEBMODS_RUN_TOKEN;
  for (const [choice, cmd] of [['new', 'mod.update'], ['mine', 'mod.update']]) {
    const res = await sockRequest(ext.sock, { id: choice, cmd, args: { id: 'example.com/plain', choice }, token });
    assert.equal(res.ok, false);
    assert.match(res.error, /only the user can choose what happens with a new version/);
  }
  const res = await sockRequest(ext.sock, { id: 'm', cmd: 'agent.start', args: { ...START, prompt: 'x', merge: 'example.com/plain' }, token });
  assert.equal(res.ok, false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(home, 'preinstalled.json'), 'utf8')).shipped['example.com/plain'].pending, 'still waiting');
  // The user can, from the extension.
  const r = await extRequest(ext, 'mod.update', { id: 'example.com/plain', choice: 'new' });
  assert.deepEqual(r.result, { id: 'example.com/plain', choice: 'new', version: '2', trashed: true });
  assert.match(fs.readFileSync(path.join(home, 'sites', 'example.com', 'plain.js'), 'utf8'), /\/\/ two/);
  // And Undo (mod.restore) brings theirs back, with the update offered again.
  const u = await extRequest(ext, 'mod.restore', { id: 'example.com/plain' });
  assert.equal(u.ok, true, u.error);
  assert.match(fs.readFileSync(path.join(home, 'sites', 'example.com', 'plain.js'), 'utf8'), /\/\/ mine/);
  await waitFor(() => (ext.lastMods() || []).some((m) => m.update && m.update.version === '2'), { message: 'the update offered again' });
});

// ------------------------------------------------------------------ run scope and held mods

test('run scope: the run token limits webmods requests to the run\'s site; agent commands refused; ends with the run', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  ext.handlers.tabs = (args) => ({ scope: args.scope ?? null });
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { site: 'en.example.co.uk', url: 'https://en.example.co.uk/x', tabId: 3, prompt: 'SLEEP' });
  const runId = r.result.runId;
  const call = await waitFor(() => callFor(bin, 'SLEEP'), { message: 'the agent to start' });
  const token = call.env.WEBMODS_RUN_TOKEN;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.match(call.argv[call.argv.indexOf('--append-system-prompt') + 1], /limited to example\.co\.uk/);

  // The helper overrides whatever scope the client sends; without a token nothing is scoped.
  let res = await sockRequest(ext.sock, { id: 'a', cmd: 'tabs', args: { scope: 'evil.com' }, token });
  assert.deepEqual(res.result, { scope: 'example.co.uk' });
  res = await sockRequest(ext.sock, { id: 'b', cmd: 'tabs', args: {} });
  assert.deepEqual(res.result, { scope: null });
  for (const cmd of ['agent.start', 'agent.list', 'agent.login', 'instructions.set', 'mod.approve']) {
    res = await sockRequest(ext.sock, { id: cmd, cmd, args: { id: 'example.com/x', prompt: 'hi', site: 'evil.com' }, token });
    assert.equal(res.ok, false, cmd);
  }
  assert.match(res.error, /only the user can approve/);
  res = await sockRequest(ext.sock, { id: 'c', cmd: 'tabs', args: {}, token: 'not-a-token' });
  assert.equal(res.ok, false);

  await extRequest(ext, 'agent.stop', { runId });
  await waitDone(ext, runId);
  res = await sockRequest(ext.sock, { id: 'd', cmd: 'tabs', args: {}, token });
  assert.match(res.error, /run has ended/);
});

test('run mailbox: whatever a request in it says, it\'s the run\'s; links aren\'t followed; agent commands refused', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  ext.handlers.tabs = (args) => ({ scope: args.scope ?? null });
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP' });
  const call = await waitFor(() => callFor(bin, 'SLEEP'), { message: 'the agent to start' });
  const box = call.env.WEBMODS_RUN_BOX;
  assert.equal(fs.statSync(box).mode & 0o777, 0o700);

  // The CLI, with only the mailbox (no token): still the run's, limited to its site.
  let res = await runCli(['tabs', '--json'], { home, env: { WEBMODS_RUN_BOX: box } });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { scope: 'example.com' });

  // A hand-written request with someone else's token and a scope of its own: the run's anyway.
  const raw = (name, msg) => {
    fs.writeFileSync(path.join(box, `${name}.tmp`), JSON.stringify(msg) + '\n');
    fs.renameSync(path.join(box, `${name}.tmp`), path.join(box, `${name}.req`));
  };
  const answer = (name) => waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(box, `${name}.res`), 'utf8')); } catch { return null; } }, { message: `the answer to ${name}` });
  raw('forged', { id: 'f', cmd: 'tabs', args: { scope: 'evil.com' }, token: 'not-a-token' });
  assert.deepEqual((await answer('forged')).result, { scope: 'example.com' });
  raw('agent', { id: 'g', cmd: 'agent.start', args: { site: 'evil.com', url: 'https://evil.com/', prompt: 'hi' } });
  assert.match((await answer('agent')).error, /isn't available inside an agent run/);
  raw('arr', { id: 'h', cmd: 'tabs', args: ['x'] });
  assert.deepEqual((await answer('arr')).result, { scope: 'example.com' });

  // A request that's a link to another file isn't read (the agent could point it anywhere).
  const outside = path.join(home, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ id: 's', cmd: 'tabs', args: {} }));
  fs.symlinkSync(outside, path.join(box, 'link.req'));
  assert.deepEqual(await answer('link'), { id: null, ok: false, error: 'unreadable request' });
  assert.ok(fs.existsSync(outside));

  await extRequest(ext, 'agent.stop', { runId: r.result.runId });
  await waitDone(ext, r.result.runId);
  await waitFor(() => !fs.existsSync(box), { timeout: 5000, message: 'the mailbox removed' });
  res = await runCli(['tabs'], { home, env: { WEBMODS_RUN_BOX: box } });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /has the agent run ended/);
});

test('recording a run switched on goes off when that run ends; the user\'s own recording stays', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const recording = new Set(['user.com']); // the user switched this on from a terminal
  const offs = [];
  ext.handlers.record = (args) => {
    const on = args.on !== false;
    const changed = recording.has(args.site) !== on;
    if (on) recording.add(args.site); else { recording.delete(args.site); offs.push({ site: args.site, scope: args.scope ?? null }); }
    return { recording: [...recording].sort(), site: args.site, changed };
  };
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP' });
  const call = await waitFor(() => callFor(bin, 'SLEEP'), { message: 'the agent to start' });
  const env = { WEBMODS_RUN_TOKEN: call.env.WEBMODS_RUN_TOKEN, WEBMODS_RUN_BOX: call.env.WEBMODS_RUN_BOX };
  for (const site of ['example.com', 'm.example.com', 'user.com']) {
    const res = await runCli(['record', site, 'on'], { home, env });
    assert.equal(res.code, 0, res.stderr);
  }
  assert.deepEqual([...recording].sort(), ['example.com', 'm.example.com', 'user.com']);

  await extRequest(ext, 'agent.stop', { runId: r.result.runId });
  await waitDone(ext, r.result.runId);
  await waitFor(() => offs.length === 2, { message: 'recording switched off' });
  assert.deepEqual(offs.sort((a, b) => a.site.localeCompare(b.site)), [{ site: 'example.com', scope: null }, { site: 'm.example.com', scope: null }]);
  assert.deepEqual([...recording], ['user.com'], 'already on before the run: left on');
  assert.match(helperLog(home), /recording on example\.com off: run r\w+ that switched it on has ended/);
});

test('held mods: a mod in a folder a looser snapshot skipped (node_modules) is held too', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'HIDDEN' });
  const done = await waitDone(ext, r.result.runId);
  assert.deepEqual(done.held, [{ id: 'node_modules/hidden', reason: 'it matches *://*/*, outside example.com' }]);
});

test('held mods: a run\'s mod that matches other sites is held (not registered) until approved', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'EVIL' });
  const done = await waitDone(ext, r.result.runId);
  assert.deepEqual(done.held, [{ id: 'example.com/evil', reason: 'it matches <all_urls>, outside example.com' }]);
  const lastMods = () => [...ext.messages].reverse().find((m) => m.type === 'mods').mods;
  const byId = (id) => lastMods().find((m) => m.id === id);
  assert.deepEqual(byId('example.com/evil').held, { site: 'example.com', reason: 'it matches <all_urls>, outside example.com' });
  assert.equal(byId('example.com/good').held, undefined);
  const stored = JSON.parse(fs.readFileSync(path.join(home, 'held.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored), ['example.com/evil']);

  // Still held after the run (and a resync); `webmods mods` says so.
  await sleep(300);
  let out = await runCli(['mods'], { home });
  assert.match(out.stdout, /HELD: a side-panel agent wrote it while working on example\.com/);

  const ok = await extRequest(ext, 'mod.approve', { id: 'example.com/evil' });
  assert.deepEqual(ok.result, { id: 'example.com/evil', approved: true });
  await waitFor(() => byId('example.com/evil') && !byId('example.com/evil').held, { message: 'mods re-sent without the hold' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'held.json'), 'utf8'))['example.com/evil'].approved, true);
  const again = await extRequest(ext, 'mod.approve', { id: 'example.com/evil' });
  assert.match(again.error, /isn't held/);
});

test('held mods: editing a held mod yourself releases it; `webmods approve` refuses inside a run', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  await ext.waitForSocket();
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'EVIL' });
  await waitDone(ext, r.result.runId);
  await sleep(10500); // past the just-finished window: later edits aren't the run's
  fs.appendFileSync(path.join(home, 'sites', 'example.com', 'evil.js'), '\n// the user edited this\n');
  await waitFor(() => !fs.existsSync(path.join(home, 'held.json')), { message: 'the hold to be released' });
  const res = await runCli(['approve', 'example.com/evil'], { home, env: { WEBMODS_RUN_TOKEN: 'x' } });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /not available inside a side-panel agent run/);
});

test('claude adapter: /compact shows progress, not the replayed messages; command output becomes text', () => {
  const lines = [
    { type: 'system', subtype: 'status', status: 'compacting', session_id: 's' },
    { type: 'system', subtype: 'status', status: null, compact_result: 'success', session_id: 's' },
    { type: 'system', subtype: 'init', session_id: 's' },
    { type: 'system', subtype: 'compact_boundary', session_id: 's', compact_metadata: { trigger: 'manual' } },
    { type: 'user', message: { role: 'user', content: 'This session is being continued from a previous conversation…' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'an old reply, replayed' }] } },
    { type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' } },
    { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's' },
  ];
  const events = [];
  const state = {};
  for (const l of lines) claude.parse(JSON.stringify(l), (e) => events.push(e), state);
  assert.deepStrictEqual(events.map((e) => e.kind + ':' + (e.name || e.text || '')), [
    'tool:compacting the conversation', 'tool:compacted the conversation', 'session:', 'done:',
  ]);
  const out = [];
  claude.parse(JSON.stringify({ type: 'user', message: { content: '<local-command-stdout>Total cost: $0.01</local-command-stdout>' } }), (e) => out.push(e), {});
  assert.deepStrictEqual(out, [{ kind: 'text', text: 'Total cost: $0.01' }]);
});

test('instructions: saved and read through the helper, never from a run; claude gets them via CLAUDE.md, not the context', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  await ext.waitForSocket();
  let r = await extRequest(ext, 'instructions.get', {});
  assert.deepEqual(r.result, { text: '', file: path.join(home, 'instructions.md'), max: 4000 });
  r = await extRequest(ext, 'instructions.set', { text: '  Talk like a caveman.\r\nNo risk talk.\n\n' });
  assert.equal(r.result.text, 'Talk like a caveman.\nNo risk talk.');
  assert.equal(fs.readFileSync(path.join(home, 'instructions.md'), 'utf8'), 'Talk like a caveman.\nNo risk talk.\n');
  assert.equal((await extRequest(ext, 'instructions.get', {})).result.text, 'Talk like a caveman.\nNo risk talk.');
  r = await extRequest(ext, 'instructions.set', { text: 'x'.repeat(4001) });
  assert.match(r.error, /limited to 4000 characters/);
  r = await extRequest(ext, 'instructions.set', { text: 3 });
  assert.match(r.error, /must be text/);

  // claude reads instructions.md through the workspace's CLAUDE.md: not repeated in its context
  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP caveman' });
  const call = await waitFor(() => callFor(bin, 'SLEEP caveman'), { message: 'the agent to start' });
  assert.doesNotMatch(call.argv[call.argv.indexOf('--append-system-prompt') + 1], /caveman/);
  const res = await sockRequest(ext.sock, { id: 'i', cmd: 'instructions.set', args: { text: 'evil' }, token: call.env.WEBMODS_RUN_TOKEN });
  assert.match(res.error, /isn't available inside an agent run/);
  await extRequest(ext, 'agent.stop', { runId: r.result.runId });
  await waitDone(ext, r.result.runId);

  r = await extRequest(ext, 'instructions.set', { text: '   ' });
  assert.equal(r.result.text, '');
  assert.ok(!fs.existsSync(path.join(home, 'instructions.md')));
});

test('instructionsContext: for agents that don\'t read CLAUDE.md', () => {
  const { instructionsContext } = require('../helper/lib/instructions');
  assert.equal(instructionsContext(''), '');
  assert.match(instructionsContext('Talk like a caveman.'), /^\n\nThe user's own instructions for every run \(instructions\.md;.*\):\nTalk like a caveman\.$/s);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'helper', 'workspace', 'CLAUDE.md'), 'utf8'), /^@instructions\.md$/m);
});

// ------------------------------------------------------------------ deleting mods

test('mod.delete / mod.restore: from the panel any mod; from a run only mods inside its scope', async () => {
  const { home, bin } = makeHome();
  const local = writeMod(home, 'example.com', 'local.js', '// ==WebMod==\n// @name Local\n// ==/WebMod==\n');
  const wide = writeMod(home, 'example.com', 'wide.js', '// ==WebMod==\n// @name Wide\n// @match *://*/*\n// ==/WebMod==\n');
  const ext = startHost(home);
  await ext.waitForSocket();
  await ext.nextMods((mods) => mods.length === 2);

  // The panel: the mod goes to the trash and the extension is sent the mods without it, then back.
  let r = await extRequest(ext, 'mod.delete', { id: 'example.com/wide' });
  assert.deepStrictEqual(r.result, { id: 'example.com/wide', deleted: true });
  assert.equal(fs.existsSync(wide), false);
  assert.deepStrictEqual(ext.lastMods().map((m) => m.id), ['example.com/local']);
  r = await extRequest(ext, 'mod.restore', { id: 'example.com/wide' });
  assert.equal(r.result.restored, true);
  assert.deepStrictEqual(ext.lastMods().map((m) => m.id).sort(), ['example.com/local', 'example.com/wide']);

  // A run on example.com: `webmods delete` goes through the helper, which holds it to the scope.
  r = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLEEP' });
  const call = await waitFor(() => callFor(bin, 'SLEEP'), { message: 'the agent to start' });
  // As the agent would: through the run's mailbox (its sandbox has no socket).
  const env = { WEBMODS_RUN_TOKEN: call.env.WEBMODS_RUN_TOKEN, WEBMODS_RUN_BOX: call.env.WEBMODS_RUN_BOX };
  let res = await runCli(['delete', 'example.com/wide'], { home, env });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /can only delete mods that stay on example\.com; example\.com\/wide also runs on \*:\/\/\*\/\*/);
  assert.ok(fs.existsSync(wide));
  res = await runCli(['delete', 'example.com/local'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(fs.existsSync(local), false);
  res = await runCli(['restore', 'example.com/local'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(fs.existsSync(local));
  await extRequest(ext, 'agent.stop', { runId: r.result.runId });
  await waitDone(ext, r.result.runId);
});

test('agent.models: Codex lists the account\'s catalog (picker models, best first); Claude Code offers its aliases', async () => {
  const { home, bin } = makeHome();
  // A fake codex whose `debug models` prints a catalog like the real one (padded past 64 KB, as the real
  // one is with each model's instructions).
  const catalog = { models: [
    { slug: 'hidden-review', display_name: 'Review', visibility: 'hide', priority: 1 },
    { slug: 'gpt-older', display_name: 'GPT-Older', description: 'Older.', visibility: 'list', priority: 9, base_instructions: 'x'.repeat(70000) },
    { slug: 'gpt-best', display_name: 'GPT-Best', description: 'Best.', visibility: 'list', priority: 2 },
  ] };
  fs.writeFileSync(path.join(bin, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.166.0"; exit 0; fi\nif [ "$1 $2" = "debug models" ]; then /bin/cat "${bin}/catalog.json"; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  const ext = startHost(home);
  await ext.waitForSocket();
  let r = await extRequest(ext, 'agent.models', { agent: 'codex' });
  assert.equal(r.ok, true, r.error);
  assert.deepStrictEqual(r.result.models.map((m) => [m.id, m.name, m.description]), [['gpt-best', 'GPT-Best', 'Best.'], ['gpt-older', 'GPT-Older', 'Older.']]);
  assert.equal(r.result.default, 'gpt-best');
  assert.equal(r.result.custom, false);
  r = await extRequest(ext, 'agent.models', { agent: 'claude' });
  assert.deepStrictEqual(r.result.models.map((m) => m.id), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.equal(r.result.custom, true);
  assert.match(r.result.note, /can't say which models/);
  r = await extRequest(ext, 'agent.models', { agent: 'nope' });
  assert.match(r.error, /unknown agent/);
  // Too old for permission profiles: not offered at all.
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\necho "codex-cli 0.120.0"\n');
  r = await extRequest(ext, 'agent.list', {});
  const cx = r.result.agents.find((a) => a.id === 'codex');
  assert.equal(cx.available, false);
  assert.match(cx.note, /too old for WebMods \(it needs 0\.138\.0 or newer\)/);
});

test('a run is told which browser it was started from', () => {
  const agents = require('../helper/lib/agents');
  assert.match(agents.contextText({ url: 'https://x.com/', tabId: 3, scope: 'x.com', browser: 'Safari' }), /in the user's Safari\./);
  assert.match(agents.contextText({ url: 'https://x.com/', browser: 'Firefox' }), /in the user's Firefox\./);
  assert.match(agents.contextText({ url: 'https://x.com/' }), /in the user's browser\./);
});
