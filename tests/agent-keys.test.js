'use strict';
// API keys for plain Claude Code and Codex runs (helper/lib/agentkeys.js): kept in the keyring (a fake
// one here, never the real Keychain), moved there from config.json, and sent by a per-run key proxy so
// the agent never has them. Fake agents, a stand-in Anthropic API (tests/fake-anthropic-server.js) and,
// when Claude Code is installed, a real Claude Code run against the stand-in (no tokens spent).

const test = require('./posix-only')('fake agents are #!/bin/sh scripts, helpers on Unix sockets');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FakeExtension, runCli, tempDir, privDir, waitFor, CLI_JS } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { startFakeAnthropic } = require('./fake-anthropic-server');
const { startFakeModelServer } = require('./fake-model-server');
const keys = require('../helper/lib/agentkeys');
const keyring = require('../helper/lib/keyring');

const ANT_KEY = 'sk-ant-fake-0123456789abcdef0123'; // made up: checked for where it does and doesn't go
const OAI_KEY = 'sk-fake-openai-0123456789abcdef';

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

// A fake agent (claude or codex): dumps its argv, env and stdin, then calls the API its env or argv points
// at the way the real one would (Anthropic: POST <ANTHROPIC_BASE_URL>/v1/messages with x-api-key; Codex:
// GET <provider base_url>/models with no key of its own) and says what came back.
function fakeAgent(kind) {
  return `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log(${JSON.stringify(kind === 'claude' ? '9.9.9 (Claude Code)' : 'codex-cli 0.166.0')}); process.exit(0); }
if (argv[0] === 'auth' || argv[0] === 'login') { console.log(${JSON.stringify(kind === 'claude' ? '{"loggedIn": false, "authMethod": "none"}' : 'Not logged in')}); process.exit(${kind === 'claude' ? 0 : 1}); }
const prompt = (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();
fs.mkdirSync(path.join(__dirname, 'calls'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'calls', Date.now() + '-' + process.pid + '.json'), JSON.stringify({ argv, env: process.env, prompt }));
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
(async () => {
  let got = '';
  try {
    if (${JSON.stringify(kind)} === 'claude') {
      const r = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'm', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
      got = 'status ' + r.status;
    } else {
      const prov = argv.find((a) => a.startsWith('model_providers.trif-openai=')) || '';
      const base = (/base_url = "([^"]+)"/.exec(prov) || [])[1] || '';
      const r = await fetch(base + '/models');
      got = 'status ' + r.status + ' auth ' + ((await r.json()).auth || '');
    }
  } catch (e) { got = 'unreachable ' + e.message; }
  if (${JSON.stringify(kind)} === 'claude') {
    say({ type: 'system', subtype: 'init', session_id: 's1' });
    say({ type: 'result', subtype: 'success', is_error: false, result: 'api ' + got, session_id: 's1', total_cost_usd: 0 });
  } else {
    say({ type: 'thread.started', thread_id: 't1' });
    say({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'api ' + got } });
    say({ type: 'turn.completed', usage: {} });
  }
})();
`;
}

function makeHome(config = {}) {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  for (const k of ['claude', 'codex']) { fs.writeFileSync(path.join(bin, k), fakeAgent(k)); fs.chmodSync(path.join(bin, k), 0o755); }
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ ...config, env: { ...(config.env || {}), PATH: bin } }));
  return { home, bin };
}
const lastCall = (bin) => { const d = path.join(bin, 'calls'); const n = fs.readdirSync(d).sort(); return JSON.parse(fs.readFileSync(path.join(d, n[n.length - 1]), 'utf8')); };
let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `k${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
const waitDone = (ext, runId, timeout = 20000) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout }).then((m) => m.event);
const eventsOf = (ext, runId) => ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
function startHost(home, env) {
  const ext = new FakeExtension({ home, env });
  cleanups.push(() => ext.close());
  return ext;
}
const START = { site: 'example.com', url: 'https://example.com/page', tabId: 12 };
const readConfig = (home) => JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8'));

test('migrateKeys: config.json\'s API keys move to the keyring, then leave config.json; a saved one wins; no keyring: left', async () => {
  const { home } = makeHome({ env: { ANTHROPIC_API_KEY: ANT_KEY, OPENAI_API_KEY: OAI_KEY, OTHER: 'x' }, autoUpdate: true });
  const kc = makeFakeKeychain(path.join(tempDir(), 'kc'));
  const old = process.env.TRIF_HOME;
  process.env.TRIF_HOME = home;
  try {
    const r = await keys.migrateKeys(home, { env: kc.env });
    assert.deepEqual(r.moved.sort(), ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    assert.deepEqual(r.left, []);
    const cfg = readConfig(home);
    assert.equal(cfg.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(cfg.env.OPENAI_API_KEY, undefined);
    assert.equal(cfg.env.OTHER, 'x');
    assert.equal(cfg.autoUpdate, true, 'the rest of config.json is kept');
    assert.equal((await keyring.getKey('anthropic', { service: keys.SERVICE, env: kc.env })).value, ANT_KEY);
    assert.equal((await keyring.getKey('openai', { service: keys.SERVICE, env: kc.env })).value, OAI_KEY);
    assert.ok(!kc.argvText().includes(ANT_KEY) && !kc.argvText().includes(OAI_KEY), 'never in the keyring tool\'s argv');
    assert.ok(!JSON.stringify(r).includes(ANT_KEY));
    // Again: nothing to do. A key saved later (trif agent key) beats an old one put back in config.json.
    assert.deepEqual((await keys.migrateKeys(home, { env: kc.env })).moved, []);
    await keys.setAgentKey('claude', 'sk-ant-newer-key-0123456789', { env: kc.env });
    fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-stale-key-0123456789' } }));
    await keys.migrateKeys(home, { env: kc.env });
    assert.equal((await keyring.getKey('anthropic', { service: keys.SERVICE, env: kc.env })).value, 'sk-ant-newer-key-0123456789');
    assert.equal(readConfig(home).env.ANTHROPIC_API_KEY, undefined);
    // No keyring at all: left where it is, and still used (through the proxy).
    fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { OPENAI_API_KEY: OAI_KEY } }));
    const none = { TRIF_KEYCHAIN_BIN: 'not-absolute' };
    const left = await keys.migrateKeys(home, { env: none });
    assert.equal(left.left[0].name, 'OPENAI_API_KEY');
    assert.match(left.notes[0], /left OPENAI_API_KEY in config\.json/);
    assert.equal(readConfig(home).env.OPENAI_API_KEY, OAI_KEY);
    const k = await keys.agentKey('codex', { config: readConfig(home), env: none });
    assert.deepEqual([k.value, k.source], [OAI_KEY, 'config']);
  } finally {
    if (old === undefined) delete process.env.TRIF_HOME; else process.env.TRIF_HOME = old;
  }
});

test('Claude Code with a saved key: the run\'s key proxy adds it; Claude Code gets a placeholder and the proxy\'s address, never the key', async () => {
  const api = await startFakeAnthropic();
  cleanups.push(() => api.close());
  const { home, bin } = makeHome({ env: { ANTHROPIC_API_KEY: ANT_KEY } }); // as before 0.2.0
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  const ext = startHost(home, { ...kc.env, TRIF_ANTHROPIC_URL: api.url });
  // The helper moved the key to the keyring when it started.
  await waitFor(() => readConfig(home).env.ANTHROPIC_API_KEY === undefined, { message: 'the key leaving config.json' });
  assert.equal(kc.items()[`${keys.SERVICE}\u0000anthropic`] !== undefined, true);
  // agent.list: a saved key counts as logged in.
  const list = await extRequest(ext, 'agent.list');
  assert.equal(list.result.agents.find((a) => a.id === 'claude').loggedIn, true);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'hide the banner' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true, JSON.stringify(eventsOf(ext, r.result.runId)));
  assert.equal(done.result, 'api status 200');
  const call = lastCall(bin);
  assert.ok(!JSON.stringify(call).includes(ANT_KEY), 'not in Claude Code\'s env, argv or stdin');
  assert.equal(call.env.ANTHROPIC_API_KEY, keys.PLACEHOLDER);
  assert.match(call.env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  assert.equal(call.prompt.trim(), 'hide the banner');
  const post = api.requests.find((x) => x.method === 'POST');
  assert.equal(post.headers['x-api-key'], ANT_KEY, 'the proxy put the real key in');
  assert.equal(post.url, '/v1/messages');
  // Never in the run's log or the helper's; the proxy closed with the run.
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'runs', `${r.result.runId}.jsonl`), 'utf8').includes(ANT_KEY));
  assert.match(fs.readFileSync(path.join(privDir(home), 'runs', `${r.result.runId}.jsonl`), 'utf8'), /"webmods":"apiKey","account":"anthropic","source":"keyring","keyProxy":true/);
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes(ANT_KEY));
  await waitFor(async () => { try { await fetch(`${call.env.ANTHROPIC_BASE_URL}/v1/models`); return false; } catch { return true; } }, { message: 'the proxy closing' });
  // No key: Claude Code's own login, nothing set.
  await keys.removeAgentKey('claude', { env: kc.env });
  const r2 = await extRequest(ext, 'agent.start', { ...START, prompt: 'again' });
  await waitDone(ext, r2.result.runId);
  const c2 = lastCall(bin);
  assert.equal(c2.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(c2.env.ANTHROPIC_BASE_URL, undefined);
});

test('Codex with a saved key: a provider of its own at the run\'s key proxy (bearer); no key variable; profile keys excluded', async () => {
  const srv = await startFakeModelServer({ echoAuth: true });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome();
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  await keys.setAgentKey('codex', OAI_KEY, { env: kc.env });
  const ext = startHost(home, { ...kc.env, TRIF_OPENAI_URL: `${srv.url}/v1` });
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex', prompt: 'hide the banner' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true, JSON.stringify(eventsOf(ext, r.result.runId)));
  const call = lastCall(bin);
  assert.ok(!JSON.stringify(call).includes(OAI_KEY));
  assert.equal(call.env.OPENAI_API_KEY, undefined);
  const prov = call.argv.find((a) => a.startsWith('model_providers.trif-openai='));
  assert.match(prov, /base_url = "http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1", wire_api = "responses"/);
  assert.ok(call.argv.includes('model_provider="trif-openai"'));
  assert.ok(call.argv.some((a) => a.startsWith('shell_environment_policy.exclude=')));
  assert.equal(srv.requests.find((x) => x.url === '/v1/models').headers.authorization, `Bearer ${OAI_KEY}`);
  const evs = eventsOf(ext, r.result.runId);
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'api status 200 auth Bearer [redacted]'), JSON.stringify(evs));
  // Without a key, plain Codex: its own login, no provider of TRIF's (the exclude stays).
  await keys.removeAgentKey('codex', { env: kc.env });
  const r2 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex', prompt: 'again' });
  await waitDone(ext, r2.result.runId);
  const c2 = lastCall(bin);
  assert.ok(!c2.argv.some((a) => /trif-openai/.test(a)));
  assert.ok(c2.argv.some((a) => a.startsWith('shell_environment_policy.exclude=')));
});

test('`trif agent key`: --set-key from stdin (never argv), status, --remove-key; refused in a run; doctor says where it is', async () => {
  const { home } = makeHome({ env: { GITHUB_TOKEN: 'ghp_x' } });
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  let r = await runCli(['agent', 'key', '--agent', 'codex', '--set-key', OAI_KEY], { home, env: kc.env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /never put a key on the command line/);
  assert.ok(!r.stderr.includes(OAI_KEY));
  r = await runCli(['agent', 'key', '--agent', 'codex', '--set-key'], { home, env: kc.env, input: `${OAI_KEY}\n` });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Saved the OpenAI API key/);
  assert.match(r.stdout, /an OpenAI API key is saved in .* \(not shown\)/);
  assert.ok(!r.stdout.includes(OAI_KEY) && !kc.argvText().includes(OAI_KEY));
  r = await runCli(['agent', 'key', '--agent', 'claude'], { home, env: kc.env });
  assert.match(r.stdout, /no Anthropic API key saved: runs use Claude Code's own login/);
  r = await runCli(['agent', 'key', '--agent', 'gemini'], { home, env: kc.env });
  assert.equal(r.code, 1);
  r = await runCli(['agent', 'key', '--agent', 'codex'], { home, env: { ...kc.env, TRIF_RUN_TOKEN: 'x', TRIF_RUN_BOX: path.join(home, 'nobox') } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not available inside a side-panel agent run/);
  r = await runCli(['doctor'], { home, env: kc.env });
  assert.match(r.stdout, /ok {4}Codex: an OpenAI API key is saved in .* \(not shown\); runs send it through a key proxy/);
  assert.match(r.stdout, /config\.json env has GITHUB_TOKEN, which TRIF doesn't use/);
  assert.ok(!r.stdout.includes(OAI_KEY));
  r = await runCli(['agent', 'key', '--agent', 'codex', '--remove-key'], { home, env: kc.env });
  assert.match(r.stdout, /Removed the OpenAI API key/);
  assert.deepEqual(kc.items(), {});
  // A key still in config.json (no keyring to move it to): doctor warns.
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: ANT_KEY } }));
  r = await runCli(['doctor'], { home, env: { TRIF_KEYCHAIN_BIN: 'none' } });
  assert.match(r.stdout, /warn {2}Claude Code: the Anthropic API key is still in config\.json \(ANTHROPIC_API_KEY\)/);
  assert.ok(!r.stdout.includes(ANT_KEY));
});

test('setup moves config.json\'s API keys to the keyring and says so', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: ANT_KEY, PATH: '/usr/bin' } })); // 0.2.0: in the workspace
  const kc = makeFakeKeychain(path.join(root, 'kc'));
  const r = await runCli(['setup', '--verbose', '--native-dir', path.join(root, 'native'), '--no-link', '--no-examples'], { home: ws, env: kc.env });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /moved ANTHROPIC_API_KEY from config\.json into .*key proxy/);
  assert.ok(!r.stdout.includes(ANT_KEY));
  assert.ok(!fs.existsSync(path.join(ws, 'config.json')));
  assert.equal(readConfig(ws).env.ANTHROPIC_API_KEY, undefined);
  assert.equal((await keyring.getKey('anthropic', { service: keys.SERVICE, env: kc.env })).value, ANT_KEY);
});

// ------------------------------------------------------------------ real Claude Code, stand-in API

function realClaude() {
  const dirs = [path.join(require('os').homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const d of dirs) {
    const f = path.join(d, 'claude');
    if (!fs.existsSync(f)) continue;
    const v = spawnSync(f, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (v.status === 0 && !require('../helper/lib/agents/claude').tooOld(v.stdout)) return f;
  }
  return null;
}

test('real Claude Code + stand-in API: the key proxy works, the private folder and the message stay out of reach', { skip: (process.platform !== 'darwin' || !realClaude()) && 'needs Claude Code on macOS (and a shell without another sandbox)' }, async () => {
  const claudeBin = realClaude();
  const home = tempDir();
  const bin = path.join(home, 'agentbin');
  fs.mkdirSync(bin);
  fs.symlinkSync(claudeBin, path.join(bin, 'claude'));
  fs.writeFileSync(path.join(bin, 'trif'), `#!/bin/sh\nexec '${process.execPath}' '${CLI_JS}' "$@"\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  const MESSAGE = `probe-${require('crypto').randomBytes(10).toString('hex')}`;
  const priv = privDir(home);
  fs.writeFileSync(path.join(priv, 'config.json'), JSON.stringify({ env: { PATH: `${bin}:/usr/bin:/bin` }, secret: 'CONFIG-SECRET' }));
  const kc = makeFakeKeychain(path.join(tempDir(), 'kc'));
  await keys.setAgentKey('claude', ANT_KEY, { env: kc.env });
  const api = await startFakeAnthropic({ script: [
    { bash: `ls ${priv}` },
    { tool: 'Read', input: { file_path: path.join(priv, 'config.json') } },
    { tool: 'Read', input: { file_path: path.join(priv.toUpperCase(), 'CONFIG.JSON') } },
    { bash: `trif tabs` },
    { say: 'Done: probed.' },
  ] });
  cleanups.push(() => api.close());
  // HOME: a throwaway one (Claude Code keeps its sessions there), with the real one's login not needed.
  const canary = `canary-${require('crypto').randomBytes(10).toString('hex')}`; // in the helper's environment: the watch must see it
  const ext = startHost(home, { ...kc.env, TRIF_ANTHROPIC_URL: api.url, TRIF_AGENT_TIMEOUT_MS: '100000', TTEST_CANARY: canary });
  ext.handlers.tabs = () => [{ id: 12, url: 'https://example.com/page', title: 'Example', active: true }];
  ext.hello();
  await ext.waitForSocket();
  // Read every same-user process's arguments and environment (sysctl KERN_PROCARGS2, as any program of the
  // user's can, sandboxed or not) over and over while the run goes: neither the message nor the key.
  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
  const scans = [];
  let watching = true;
  const scanOnce = () => new Promise((resolve) => {
    const c = require('child_process').spawn('python3', ['-I', path.join(__dirname, 'procargs-probe.py'), sha(ANT_KEY), String(ANT_KEY.length), sha(canary), String(canary.length), sha(MESSAGE), String(MESSAGE.length)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let o = '';
    c.stdout.on('data', (d) => { o += d; });
    c.on('close', () => { const m = /scanned=(\d+) key=(\d+) canary=(\d+) prompt=(\d+)/.exec(o); if (m) scans.push(m.slice(1).map(Number)); resolve(); });
    c.on('error', () => resolve());
  });
  const watcher = (async () => { while (watching) await scanOnce(); })();
  try {
    const r = await extRequest(ext, 'agent.start', { ...START, prompt: MESSAGE });
    assert.equal(r.ok, true, r.error);
    const done = await waitDone(ext, r.result.runId, 100000);
    const evs = eventsOf(ext, r.result.runId);
    const out = api.toolResults().join('\n----\n');
    const info = `events: ${JSON.stringify(evs).slice(0, 3000)}\nresults:\n${out.slice(0, 3000)}`;
    assert.equal(done.ok, true, info);
    const posts = api.requests.filter((x) => x.method === 'POST' && x.body && x.body.stream);
    assert.ok(posts.length >= 5, info);
    assert.ok(posts.every((x) => x.headers['x-api-key'] === ANT_KEY), 'every request got the key from the proxy');
    assert.ok(JSON.stringify(posts[0].body.messages).includes(MESSAGE), 'the message reached the model (from stdin)');
    // ls of the private folder, and its config.json by Claude Code's Read tool (in another case too):
    // refused, by its permission rules (outside the run's folders) or the sandbox.
    const results = api.toolResults();
    assert.equal(results.length, 4, info);
    for (const t of results.slice(0, 3)) assert.match(t, /blocked|Operation not permitted|denied|not allowed|permission/i, info);
    assert.ok(!out.includes('CONFIG-SECRET'), info);
    assert.match(out, /example\.com\/page/, info); // trif tabs, through the mailbox
  } finally {
    watching = false;
    await watcher;
  }
  assert.ok(scans.length >= 1, 'the scan ran');
  assert.ok(scans.every(([n]) => n > 10) && scans.some(([, , c]) => c >= 1), `the scan could read other processes' environments: ${JSON.stringify(scans)}`);
  assert.ok(scans.every(([, k, , p]) => k === 0 && p === 0), `the key or the message showed up in some process's arguments or environment: ${JSON.stringify(scans)}`);
});
