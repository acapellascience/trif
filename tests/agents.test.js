'use strict';
// Tests for agent runs: helper/lib/agents/*, helper/lib/runs.js, the agent.* commands in host.js,
// `webmods agent`, and the agent bits of setup/doctor. Uses a fake `claude` executable; never the real one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, runCli, tempDir, waitFor, sleep } = require('./fake-extension');
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
// can't steer it): NOTLOGGEDIN, CRASH, SLEEP, STUBBORN (ignores SIGTERM), EDIT (changes a mod file).
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
const prompt = opt('-p') || '';
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
  const c = claude.command({ bin: '/x/claude', prompt: 'hi', context: 'CTX' });
  assert.equal(c.file, '/x/claude');
  assert.deepEqual(c.args, ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--setting-sources', 'project', '--strict-mcp-config', '--append-system-prompt', 'CTX']);
  const r = claude.command({ bin: '/x/claude', prompt: 'hi', context: 'CTX', sessionId: 's1', model: 'opus' });
  assert.deepEqual(r.args.slice(-4), ['--resume', 's1', '--model', 'opus']);
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

test('codex adapter (experimental): command, resume, JSONL events', () => {
  const c = codex.command({ bin: '/x/codex', prompt: 'P', model: 'gpt-5' });
  assert.equal(c.args[0], 'exec');
  assert.ok(c.args.includes('--json') && c.args.includes('--skip-git-repo-check'));
  assert.deepEqual(c.args.slice(-3), ['-m', 'gpt-5', 'P']);
  const r = codex.command({ bin: '/x/codex', prompt: 'P', sessionId: 'th1' });
  assert.deepEqual(r.args.slice(-3), ['resume', 'th1', 'P']);

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
  assert.match(agents.reminderText({ url: 'https://x.com/', tabId: 7 }), /x\.com.*--tab 7/);
  const before = new Map([['sites/a', '1'], ['sites/b', '2'], ['sites/c', '3']]);
  const after = new Map([['sites/a', '1'], ['sites/b', 'X'], ['sites/d', '4']]);
  assert.deepEqual(diffSnapshots(before, after), ['sites/b', 'sites/c', 'sites/d']);
});

// ------------------------------------------------------------------ host: agent.* commands

test('agent.list: finds the fake claude on the recorded PATH, codex missing (experimental)', async () => {
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
  assert.match(x.note, /experimental/);
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
  assert.equal(a[a.indexOf('-p') + 1], 'EDIT hide the banner');
  for (const f of ['--output-format', 'stream-json', '--verbose', '--strict-mcp-config']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'acceptEdits');
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
  assert.ok(!fs.existsSync(path.join(home, 'runs')) || !fs.readdirSync(path.join(home, 'runs')).some((f) => fs.readFileSync(path.join(home, 'runs', f), 'utf8').includes('GOODCODE')));
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
  assert.match(r.stdout, /^codex +Codex: not found +experimental; not found$/m);

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
  assert.equal(a[a.indexOf('-p') + 1], 'EDIT the banner');
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
      allow: ['Read(./**)', 'Glob', 'Grep', 'Bash(webmods *)', 'Bash(node --test *)', 'Bash(node --check *)', 'Bash(ls *)', 'Bash(cd *)'],
      deny: ['WebFetch', 'WebSearch'],
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
  assert.match(r.stdout, /^- {5}Codex \(experimental\): not found/m);

  // Agent on the terminal's PATH but not the recorded one.
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ env: { PATH: '/usr/bin' } }));
  r = await runCli(['doctor', '--native-dir', path.join(root, 'native')], { home: ws, env: { PATH: termPath } });
  assert.match(r.stdout, /warn {2}Claude Code is at .*fakebin\/claude, but the helper won't find it there/);
  assert.match(r.stdout, /fix: run webmods setup in this terminal/);
});
