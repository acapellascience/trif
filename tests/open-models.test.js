'use strict';
// Open models through Codex (experimental): helper/lib/agents/codex-oss.js, helper/lib/shellenv.js and
// their plumbing (agent.openModel, agent.start's prepare step, redaction, doctor, `trif agent open-model`).
// A fake `codex` for the helper tests; the last test runs the REAL Codex (when installed) against a
// stand-in model server (tests/fake-model-server.js), with TRIF's real permission profile and a scratch
// HOME (so no OpenAI login, nothing of the user's). It applies macOS's sandbox, which may fail inside
// another sandbox; TRIF_TEST_NO_REAL_CODEX=1 skips it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, runCli, tempDir, waitFor, CLI_JS } = require('./fake-extension');
const { startFakeModelServer } = require('./fake-model-server');
const oss = require('../helper/lib/agents/codex-oss');
const shellenv = require('../helper/lib/shellenv');
const { findExecutable, versionOf } = require('../helper/lib/agents/util');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const LIMITS = { readable: ['/h'], writable: ['/h/sites'], readOnly: [], denied: ['/h/config.json'] };
const FAKE_KEY = 'fake-test-key-0123456789abcdef'; // a made-up value, for checking where it does and doesn't go

function argAfter(args, flag, pred) {
  for (let i = 0; i < args.length - 1; i++) if (args[i] === flag && pred(args[i + 1])) return args[i + 1];
  return null;
}
const providerToml = (args) => argAfter(args, '-c', (v) => v.startsWith('model_providers.trif-open='));

// ------------------------------------------------------------------ command lines (pure)

test('command: local Ollama, LM Studio, OpenRouter (key by name), custom URL with resume', () => {
  // Ollama: a custom provider at 127.0.0.1:11434/v1, no key, no --oss (it would pull missing models).
  let om = oss.resolve({ provider: 'ollama' });
  let c = oss.command({ bin: '/x/codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.equal(c.file, '/x/codex');
  assert.ok(!c.args.includes('--oss') && !c.args.includes('--local-provider'));
  assert.ok(c.args.includes('--ignore-user-config') && c.args.includes('--ignore-rules') && c.args.includes('default_permissions="trif-run"'));
  assert.match(c.args.find((a) => a.startsWith('permissions=')), /network = \{ enabled = false \}/);
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "Ollama (TRIF)", base_url = "http://127.0.0.1:11434/v1", wire_api = "responses", stream_idle_timeout_ms = 900000, request_max_retries = 1, stream_max_retries = 1 }');
  assert.ok(c.args.includes('model_provider="trif-open"') && c.args.includes('web_search="disabled"'));
  assert.ok(!c.args.some((a) => a.startsWith('shell_environment_policy')));
  assert.deepEqual(c.args.slice(-4), ['-m', 'gpt-oss:20b', '--', 'P']);

  om = oss.resolve({ provider: 'lmstudio', model: 'qwen/qwen3-coder-30b' });
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /name = "LM Studio \(TRIF\)", base_url = "http:\/\/127\.0\.0\.1:1234\/v1"/);
  assert.deepEqual(c.args.slice(-4), ['-m', 'qwen/qwen3-coder-30b', '--', 'P']);

  // OpenRouter: the key's variable NAME only; Codex is told not to pass it on to commands.
  om = oss.resolve({ provider: 'openrouter' }, null, 'qwen/qwen3-coder');
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "OpenRouter (TRIF)", base_url = "https://openrouter.ai/api/v1", wire_api = "responses", env_key = "OPENROUTER_API_KEY" }');
  assert.ok(c.args.includes('shell_environment_policy.exclude=["OPENROUTER_API_KEY"]'));
  assert.deepEqual(c.args.slice(-4), ['-m', 'qwen/qwen3-coder', '--', 'P']);

  // Custom URL, its own key variable, resuming: exec options before `resume`.
  om = oss.resolve({ provider: 'custom', baseUrl: 'https://llm.example.com/v1/', keyEnv: 'MY_LLM_KEY', model: 'big-model' });
  c = oss.command({ bin: 'codex', prompt: '-P', sessionId: 'th1', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /base_url = "https:\/\/llm\.example\.com\/v1", wire_api = "responses", env_key = "MY_LLM_KEY"/);
  assert.deepEqual(c.args.slice(-6), ['-m', 'big-model', 'resume', 'th1', '--', '-P']);
  assert.ok(c.args.indexOf('model_provider="trif-open"') < c.args.indexOf('resume'));
  // The plain Codex option is untouched by all this.
  const plain = require('../helper/lib/agents/codex').command({ bin: 'codex', prompt: 'P', ...LIMITS });
  assert.ok(!plain.args.some((a) => /trif-open|web_search|shell_environment_policy/.test(a)));
});

test('settings: resolve (defaults, a run\'s own choice, model), validation; never a key', () => {
  assert.deepEqual(oss.normalize(undefined), { provider: 'ollama', model: '', baseUrl: '', keyEnv: '' });
  assert.deepEqual(oss.normalize({ provider: 'nope', model: 'two words', baseUrl: 'ftp://x', keyEnv: 'sk-or-v1-abc' }), { provider: 'ollama', model: '', baseUrl: '', keyEnv: '' });
  assert.equal(oss.normalize({ baseUrl: 'https://user:pw@x.com/v1' }).baseUrl, '');
  const stored = { provider: 'openrouter', model: 'z-ai/glm-5.3' };
  assert.equal(oss.resolve(stored).model, 'z-ai/glm-5.3');
  assert.equal(oss.resolve(stored, null, 'qwen/qwen3-coder').model, 'qwen/qwen3-coder');
  // A chat's own choice (agent.start openModel): another provider starts from that provider's defaults.
  const r = oss.resolve(stored, { provider: 'ollama' });
  assert.deepEqual([r.provider, r.model, r.baseUrl, r.keyEnv, r.local], ['ollama', 'gpt-oss:20b', 'http://127.0.0.1:11434/v1', '', true]);
  assert.equal(oss.resolve(stored, { keyEnv: 'OTHER_KEY' }).model, 'z-ai/glm-5.3');
  assert.match(oss.resolve({ provider: 'custom' }).error, /no server address/);

  const home = tempDir();
  oss.saveSettings(home, { provider: 'openrouter', model: 'qwen/qwen3-coder', keyEnv: 'OPENROUTER_API_KEY' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).openModel, { provider: 'openrouter', model: 'qwen/qwen3-coder', keyEnv: 'OPENROUTER_API_KEY' });
  assert.throws(() => oss.saveSettings(home, { keyEnv: 'sk-or-v1-0123456789abcdef' }), /NAME of the environment variable/);
  assert.throws(() => oss.saveSettings(home, { provider: 'evil' }), /unknown provider/);
  assert.throws(() => oss.saveSettings(home, { baseUrl: 'file:///etc/passwd' }), /http\(s\) URL/);
  // Switching provider drops the old one's model and key name.
  oss.saveSettings(home, { provider: 'ollama' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).openModel, { provider: 'ollama' });
});

// ------------------------------------------------------------------ model lists (no network)

test('model lists: Ollama /api/tags and LM Studio /v1/models parsed, recommended first; OpenRouter curated', async () => {
  assert.deepEqual(oss.parseModelList({ models: [{ name: 'a:1' }, { model: 'b' }, {}] }), ['a:1', 'b']);
  assert.deepEqual(oss.parseModelList({ data: [{ id: 'openai/gpt-oss-20b' }] }), ['openai/gpt-oss-20b']);
  assert.deepEqual(oss.parseModelList(null), []);
  const order = oss.orderLocal(['llama3:8b', 'devstral:24b', 'gpt-oss:20b', 'qwen3-coder:30b', 'gpt-oss:120b', 'mistral']);
  assert.deepEqual(order.map((m) => m.id), ['gpt-oss:20b', 'gpt-oss:120b', 'qwen3-coder:30b', 'devstral:24b', 'llama3:8b', 'mistral']);
  assert.deepEqual(order.map((m) => m.description), ['Recommended', 'Recommended', 'Recommended', 'Recommended', '', '']);
  assert.equal(oss.orderLocal(['qwen/qwen3-coder-30b-a3b-instruct'])[0].description, 'Recommended'); // LM Studio's naming

  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url === 'http://127.0.0.1:11434/api/tags') return { ok: true, json: async () => ({ models: [{ name: 'llama3:8b' }, { name: 'gpt-oss:20b' }] }) };
    if (url === 'http://127.0.0.1:1234/v1/models') return { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-oss-20b' }] }) };
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  };
  let r = await oss.listModels({ config: { openModel: { provider: 'ollama' } }, fetchImpl });
  assert.deepEqual(r.models.map((m) => m.id), ['gpt-oss:20b', 'llama3:8b']);
  assert.equal(r.default, 'gpt-oss:20b');
  assert.equal(r.custom, true);
  r = await oss.listModels({ config: { openModel: { provider: 'lmstudio' } }, fetchImpl });
  assert.deepEqual(r.models.map((m) => m.id), ['openai/gpt-oss-20b']);
  r = await oss.listModels({ config: { openModel: { provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1' } }, fetchImpl });
  assert.match(r.error, /Ollama isn't running at http:\/\/127\.0\.0\.1:9\/v1 \(ECONNREFUSED\)/);
  r = await oss.listModels({ config: {}, openModel: { provider: 'ollama' }, fetchImpl: async () => ({ ok: true, json: async () => ({ models: [] }) }) });
  assert.match(r.note, /No models installed in Ollama yet: run `ollama pull gpt-oss:20b`/);
  // OpenRouter: the short list, without the network.
  const before = seen.length;
  r = await oss.listModels({ config: { openModel: { provider: 'openrouter' } }, fetchImpl: () => { throw new Error('no network in tests'); } });
  assert.deepEqual(r.models.map((m) => m.id), ['openai/gpt-oss-120b', 'qwen/qwen3-coder', 'deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'moonshotai/kimi-k2.7-code']);
  assert.equal(r.default, 'openai/gpt-oss-120b');
  assert.equal(seen.length, before);
});

test('errors in the user\'s terms; Codex\'s metadata warning is dropped', () => {
  const or = oss.friendlyFor(oss.resolve({ provider: 'openrouter' }));
  assert.equal(or('Model metadata for `x` not found. Defaulting to fallback metadata'), null);
  assert.match(or('unexpected status 401 Unauthorized: No auth credentials found'), /OpenRouter refused the key in OPENROUTER_API_KEY/);
  assert.match(or('Missing environment variable: `OPENROUTER_API_KEY`.'), /OPENROUTER_API_KEY isn't set: add `export OPENROUTER_API_KEY=<your key>`/);
  assert.match(or('unexpected status 402 Payment Required: Insufficient credits'), /out of credit/);
  const ol = oss.friendlyFor(oss.resolve({ provider: 'ollama', model: 'qwen3-coder:30b' }));
  assert.match(ol('unexpected status 404 Not Found: model "qwen3-coder:30b" not found, try pulling it first'), /run `ollama pull qwen3-coder:30b`/);
  assert.match(ol('error sending request for url (http://127.0.0.1:11434/v1/responses): Connection refused'), /Ollama isn't running .* `ollama serve`/);
  assert.equal(ol('something else'), 'something else');
  // Through the parser: an error item becomes the friendly text, the warning disappears.
  const ev = [];
  const st = { friendly: or };
  oss.parse(JSON.stringify({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Model metadata for `m` not found.' } }), (e) => ev.push(e), st);
  oss.parse(JSON.stringify({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } }), (e) => ev.push(e), st);
  assert.equal(ev.length, 2);
  assert.match(ev[0].message, /refused the key/);
  assert.equal(ev[1].kind, 'done');
});

// ------------------------------------------------------------------ the key: from the shell, never written

test('shellenv: the helper\'s env first, else the login shell (past its noise); bad names refused; redaction', async () => {
  const dir = tempDir();
  const shell = path.join(dir, 'fakeshell');
  // Called as <shell> -l -i -c <script>: prints a banner like a chatty profile, exports the key, runs the script.
  fs.writeFileSync(shell, `#!/bin/sh\necho "Welcome back! fortune: ${'x'.repeat(10)}"\nTRIF_T_SHELL_KEY='${FAKE_KEY}'; export TRIF_T_SHELL_KEY\n[ "$1 $2 $3" = "-l -i -c" ] || exit 9\n/bin/sh -c "$4"\necho trailing noise\n`);
  fs.chmodSync(shell, 0o755);
  shellenv.forget();
  let r = await shellenv.lookupEnvVar('TRIF_T_SHELL_KEY', { env: {}, shell });
  assert.deepEqual(r, { value: FAKE_KEY, source: 'shell', error: null });
  r = await shellenv.lookupEnvVar('TRIF_T_SHELL_KEY', { env: { TRIF_T_SHELL_KEY: 'from-env-value' }, shell });
  assert.deepEqual(r, { value: 'from-env-value', source: 'helper', error: null });
  r = await shellenv.lookupEnvVar('TRIF_T_UNSET_VAR', { env: {}, shell });
  assert.equal(r.value, null);
  assert.match(r.error, /isn't set in your shell/);
  r = await shellenv.lookupEnvVar('X; rm -rf ~', { env: {}, shell });
  assert.match(r.error, /isn't a valid environment variable name/);
  const slow = path.join(dir, 'slowshell');
  fs.writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
  fs.chmodSync(slow, 0o755);
  r = await shellenv.lookupEnvVar('TRIF_T_SLOW', { env: {}, shell: slow, timeout: 300 });
  assert.match(r.error, /took more than/);
  assert.equal(shellenv.redactSecrets(`a ${FAKE_KEY} b ${FAKE_KEY}`, [FAKE_KEY]), 'a [redacted] b [redacted]');
  assert.equal(shellenv.redactSecrets('short ab', ['ab']), 'short ab'); // too short to be a key
});

// A fake codex: `--version`; `exec` dumps argv and env to <dir>/calls, and plays a run that leaks the key
// it got (by the provider's env_key) on stdout and stderr, to check the helper redacts it.
const FAKE_CODEX = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('codex-cli 0.166.0'); process.exit(0); }
const calls = path.join(__dirname, 'calls');
fs.mkdirSync(calls, { recursive: true });
fs.writeFileSync(path.join(calls, Date.now() + '-' + process.pid + '.json'), JSON.stringify({ argv, env: process.env }));
const prov = argv.find((a) => a.startsWith('model_providers.trif-open=')) || '';
const m = /env_key = "([A-Za-z_0-9]+)"/.exec(prov);
const key = m ? process.env[m[1]] || '' : '';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'thread.started', thread_id: 'th-oss-1' });
say({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Model metadata for \`x\` not found. Defaulting to fallback metadata' } });
say({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'leaking ' + key } });
process.stderr.write('debug: auth header Bearer ' + key + '\\n');
if (argv.some((a) => a.includes('-P-FAIL'))) process.exit(1);
say({ type: 'turn.completed', usage: {} });
`;

function makeHome(config = {}) {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX);
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...config, env: { PATH: bin } }));
  return { home, bin };
}
function lastCall(bin) {
  const dir = path.join(bin, 'calls');
  const names = fs.readdirSync(dir).sort();
  return JSON.parse(fs.readFileSync(path.join(dir, names[names.length - 1]), 'utf8'));
}
let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `o${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
const eventsOf = (ext, runId) => ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
const waitDone = (ext, runId, timeout = 15000) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout }).then((m) => m.event);
function startHost(home, env = {}) {
  const ext = new FakeExtension({ home, env });
  cleanups.push(() => ext.close());
  return ext;
}
const START = { site: 'example.com', url: 'https://example.com/page', tabId: 12 };

test('helper: codex-oss listed (experimental, never the default); settings through agent.openModel; refused from a run', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  let r = await extRequest(ext, 'agent.list');
  const a = r.result.agents.find((x) => x.id === 'codex-oss');
  assert.equal(a.name, 'Open model (via Codex)');
  assert.equal(a.available, true);
  assert.equal(a.experimental, true);
  assert.equal(r.result.default, 'codex');
  r = await extRequest(ext, 'agent.openModel.set', { provider: 'openrouter', keyEnv: 'TRIF_T_KEY' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.openModel, { provider: 'openrouter', model: '', baseUrl: '', keyEnv: 'TRIF_T_KEY' });
  assert.equal(r.result.effective.model, 'openai/gpt-oss-120b');
  r = await extRequest(ext, 'agent.openModel.set', { keyEnv: FAKE_KEY.replace(/-/g, '-') });
  assert.equal(r.ok, false);
  assert.match(r.error, /NAME of the environment variable/);
  assert.ok(!fs.readFileSync(path.join(home, 'config.json'), 'utf8').includes(FAKE_KEY));
  r = await extRequest(ext, 'agent.models', { agent: 'codex-oss' });
  assert.equal(r.result.models[0].id, 'openai/gpt-oss-120b');
  // The panel's per-chat choice: agent.models for another provider than the stored one.
  r = await extRequest(ext, 'agent.models', { agent: 'codex-oss', openModel: { provider: 'custom', baseUrl: 'https://llm.example.com/v1' } });
  assert.deepEqual(r.result.models, []);
  assert.match(r.result.note, /llm\.example\.com/);
  // A run can't read or change them (config.json is private from runs too).
  await ext.waitForSocket();
  const res = await runCli(['agent', 'open-model', '--provider', 'ollama'], { home, env: { TRIF_RUN_TOKEN: 'x', TRIF_RUN_BOX: path.join(home, 'nobox') } });
  assert.notEqual(res.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).openModel.provider, 'openrouter');
});

test('helper: the key goes to Codex\'s env only (not argv, not the agent\'s commands), and never into logs or events', async () => {
  const { home, bin } = makeHome({ openModel: { provider: 'openrouter', keyEnv: 'TRIF_T_KEY' } });
  const ext = startHost(home, { TRIF_T_KEY: FAKE_KEY }); // as if Chrome had been started from the terminal
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', model: 'qwen/qwen3-coder', prompt: 'hide the banner' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true);
  assert.equal(done.sessionId, 'th-oss-1');
  const call = lastCall(bin);
  assert.equal(call.env.TRIF_T_KEY, FAKE_KEY);
  assert.ok(!call.argv.some((a) => a.includes(FAKE_KEY)));
  assert.ok(call.argv.includes('shell_environment_policy.exclude=["TRIF_T_KEY"]'));
  assert.deepEqual(call.argv.slice(call.argv.indexOf('-m'), call.argv.indexOf('-m') + 2), ['-m', 'qwen/qwen3-coder']);
  const evs = eventsOf(ext, r.result.runId);
  assert.ok(!JSON.stringify(evs).includes(FAKE_KEY));
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'leaking [redacted]'));
  assert.ok(!evs.some((e) => e.kind === 'error'), 'the metadata warning is dropped');
  const log = fs.readFileSync(path.join(home, 'runs', `${r.result.runId}.jsonl`), 'utf8');
  assert.ok(!log.includes(FAKE_KEY));
  assert.match(log, /"webmods":"openModel","provider":"openrouter","model":"qwen\/qwen3-coder"/);
  assert.match(log, /Bearer \[redacted\]/);
  assert.ok(!fs.readFileSync(path.join(home, 'helper.log'), 'utf8').includes(FAKE_KEY));

  // A failing run: the stderr tail in the error is redacted too. A per-run provider override is honoured.
  const r2 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: '-P-FAIL', openModel: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', keyEnv: 'TRIF_T_KEY' }, model: 'm1' });
  const d2 = await waitDone(ext, r2.result.runId);
  assert.equal(d2.ok, false);
  assert.match(providerToml(lastCall(bin).argv), /base_url = "http:\/\/127\.0\.0\.1:9\/v1"/);
  assert.ok(!JSON.stringify(eventsOf(ext, r2.result.runId)).includes(FAKE_KEY));
  assert.ok(!fs.readFileSync(path.join(home, 'runs', `${r2.result.runId}.jsonl`), 'utf8').includes(FAKE_KEY));
});

test('helper: no key, Ollama down or the model missing: the run fails fast with the fix, Codex never starts', async () => {
  const srv = await startFakeModelServer({ models: ['llama3:8b'] });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome({ openModel: { provider: 'openrouter', keyEnv: 'TRIF_T_NEVER_SET_KEY' } });
  const ext = startHost(home);
  let r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x' });
  let d = await waitDone(ext, r.result.runId);
  assert.equal(d.ok, false);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /TRIF_T_NEVER_SET_KEY isn't set .*export TRIF_T_NEVER_SET_KEY=/);
  r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x', openModel: { provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1' } });
  d = await waitDone(ext, r.result.runId);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /Ollama isn't running \(nothing answers at http:\/\/127\.0\.0\.1:9\/v1\)/);
  r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x', model: 'gpt-oss:20b', openModel: { provider: 'ollama', baseUrl: `${srv.url}/v1` } });
  d = await waitDone(ext, r.result.runId);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /gpt-oss:20b isn't installed in Ollama: run `ollama pull gpt-oss:20b`/);
  assert.ok(!fs.existsSync(path.join(bin, 'calls')), 'codex never ran');
  // The model picker lists what that server has.
  const m = await extRequest(ext, 'agent.models', { agent: 'codex-oss', openModel: { provider: 'ollama', baseUrl: `${srv.url}/v1` } });
  assert.deepEqual(m.result.models.map((x) => x.id), ['llama3:8b']);
});

test('doctor and `trif agent open-model`: provider, key found or not (never shown), Ollama reachable, model installed', async () => {
  const srv = await startFakeModelServer({ models: ['gpt-oss:20b'] });
  cleanups.push(() => srv.close());
  const { home } = makeHome();
  let res = await runCli(['agent', 'open-model'], { home });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /provider {2}ollama .*not set up yet/);
  res = await runCli(['agent', 'open-model', '--provider', 'openrouter', '--key-env', 'TRIF_T_KEY', '--model', 'z-ai/glm-5.3'], { home, env: { TRIF_T_KEY: FAKE_KEY } });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /key in {4}TRIF_T_KEY: set \(in this environment; not shown\)/);
  assert.ok(!res.stdout.includes(FAKE_KEY));
  res = await runCli(['agent', 'open-model', '--key-env', 'sk-or-v1-abcdef0123'], { home });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /NAME of the environment variable/);

  const ws = (openModel) => ({ config: { openModel } });
  const lookup = async (name, { env }) => (env[name] ? { value: env[name], source: 'helper' } : { value: null, error: 'not set' });
  let c = await oss.doctorChecks(ws({ provider: 'openrouter', keyEnv: 'TRIF_T_KEY' }), { env: { TRIF_T_KEY: FAKE_KEY }, lookup });
  assert.deepEqual(c.map((x) => x.status), ['ok']);
  assert.match(c[0].title, /TRIF_T_KEY is set/);
  assert.ok(!JSON.stringify(c).includes(FAKE_KEY));
  c = await oss.doctorChecks(ws({ provider: 'openrouter' }), { env: {}, lookup });
  assert.equal(c[0].status, 'warn');
  assert.match(c[0].fix, /export OPENROUTER_API_KEY=/);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: `${srv.url}/v1` }), { env: {}, lookup });
  assert.deepEqual(c.map((x) => [x.status, x.title.replace(/.*: /, '')]), [['ok', 'Ollama is running (1 model installed)']]);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: `${srv.url}/v1`, model: 'qwen3-coder:30b' }), { env: {}, lookup });
  assert.deepEqual([c[0].status, c[0].fix], ['warn', 'ollama pull qwen3-coder:30b']);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1' }), { env: {}, lookup });
  assert.match(c[0].title, /Ollama isn't reachable/);
  assert.match(c[0].fix, /ollama serve/);
  c = await oss.doctorChecks(ws(undefined), {});
  assert.equal(c[0].status, 'info');
  c = await oss.doctorChecks(ws({ provider: 'ollama' }), { codexVersion: '0.120.0', fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }) }) });
  assert.match(c[0].title, /too old/);
});

// ------------------------------------------------------------------ the real Codex, a stand-in model

function realCodex() {
  if (process.env.TRIF_TEST_NO_REAL_CODEX) return null;
  const file = findExecutable('codex', ['/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '').split(path.delimiter)]);
  if (!file) return null;
  const v = versionOf(file, { PATH: '/usr/bin:/bin', HOME: process.env.HOME });
  return require('../helper/lib/agents/codex').tooOld(v) ? null : { file, version: v };
}

test('real Codex + stand-in model: model requests get through, the agent\'s commands get no network, no config.json, no key; trif works', { skip: !realCodex() && 'needs Codex 0.138+ (and a shell without another sandbox)' }, async () => {
  const cx = realCodex();
  const home = tempDir();
  const bin = path.join(home, 'agentbin');
  fs.mkdirSync(bin);
  fs.symlinkSync(cx.file, path.join(bin, 'codex'));
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sites', 'other.org'), { recursive: true });
  // The key in the (fake) home's shell profiles too: the sandbox keeps the agent's login shell out of them.
  const fakehome = path.join(home, 'fakehome');
  fs.mkdirSync(fakehome);
  for (const f of ['.zshenv', '.zprofile', '.zshrc']) fs.writeFileSync(path.join(fakehome, f), `export TRIF_T_KEY='${FAKE_KEY}'\n`);
  const q = (s) => `'${s}'`;
  const node = process.execPath;
  const script = [
    { run: `${q(node)} ${q(CLI_JS)} tabs` },
    { run: 'curl -sS -m 5 -o /dev/null -w "%{http_code}" https://example.com; echo " curl=$?"' },
    { run: 'LOCAL' }, // filled in below: curl to the model server itself
    { run: `cat ${q(path.join(home, 'config.json'))}; echo " cat=$?"` },
    { run: `echo '// mine' > ${q(path.join(home, 'sites', 'example.com', 'oss-probe.js'))} && echo WROTE-OWN` },
    { run: `echo x > ${q(path.join(home, 'sites', 'other.org', 'oss-probe.js'))}; echo " other=$?"` },
    { run: 'echo "key=[$TRIF_T_KEY]"; env | grep -c TRIF_T_KEY' },
    { say: 'Done: probed.' },
  ];
  const srv = await startFakeModelServer({ script });
  cleanups.push(() => srv.close());
  script[2] = { run: `curl -sS -m 5 ${srv.url}/api/version; echo " local=$?"` };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ env: { PATH: `${bin}:/usr/bin:/bin` }, openModel: { provider: 'custom', baseUrl: `${srv.url}/v1`, keyEnv: 'TRIF_T_KEY', model: 'stand-in' }, secret: 'CONFIG-SECRET' }));
  const ext = startHost(home, { TRIF_T_KEY: FAKE_KEY, TRIF_AGENT_TIMEOUT_MS: '100000' });
  ext.handlers.tabs = () => [{ id: 12, url: 'https://example.com/page', title: 'Example', active: true }];
  ext.hello();
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'probe' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId, 100000);
  const evs = eventsOf(ext, r.result.runId);
  const out = srv.toolOutputs().join('\n----\n');
  const info = `events: ${JSON.stringify(evs).slice(0, 3000)}\noutputs:\n${out.slice(0, 4000)}`;
  assert.equal(done.ok, true, info);
  // Codex's own requests reached the model server, with the key.
  const posts = srv.requests.filter((x) => x.method === 'POST');
  assert.equal(posts.length, script.length, info);
  assert.ok(posts.every((x) => x.headers.authorization === `Bearer ${FAKE_KEY}`));
  assert.equal(posts[0].body.model, 'stand-in');
  assert.ok(!posts[0].body.tools.some((t) => t.type === 'web_search'), 'no hosted web search tool');
  // What the agent's commands could do:
  assert.match(out, /example\.com\/page/, info); // trif tabs, through the mailbox
  assert.match(out, /curl: \(6\)[^\n]*\n000 curl=6/, info); // no DNS, no internet
  assert.match(out, /curl: \(7\)[^\n]*\n local=7/, info); // not even the model server on 127.0.0.1
  assert.match(out, /config\.json: Operation not permitted/, info);
  assert.match(out, /^ cat=1$/m, info);
  assert.ok(!out.includes('CONFIG-SECRET'));
  assert.match(out, /WROTE-OWN/, info);
  assert.equal(fs.readFileSync(path.join(home, 'sites', 'example.com', 'oss-probe.js'), 'utf8'), '// mine\n');
  assert.match(out, /operation not permitted[^\n]*other\.org/i, info); // (stderr and stdout can come in either order)
  assert.match(out, /^ other=1$/m, info);
  assert.ok(!fs.existsSync(path.join(home, 'sites', 'other.org', 'oss-probe.js')));
  assert.match(out, /key=\[\]\n0/, info);
  assert.ok(!out.includes(FAKE_KEY));
  assert.deepEqual(done.changedFiles, ['sites/example.com/oss-probe.js']);
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'Done: probed.'));
  assert.ok(!fs.readFileSync(path.join(home, 'runs', `${r.result.runId}.jsonl`), 'utf8').includes(FAKE_KEY));
  assert.ok(!fs.readFileSync(path.join(home, 'helper.log'), 'utf8').includes(FAKE_KEY));

  // Resuming the conversation works with the same provider.
  const before = srv.requests.length;
  script.length = 0;
  script.push({ say: 'Second turn.' });
  const r2 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'again', sessionId: done.sessionId });
  const d2 = await waitDone(ext, r2.result.runId, 100000);
  assert.equal(d2.ok, true, JSON.stringify(eventsOf(ext, r2.result.runId)));
  assert.equal(d2.sessionId, done.sessionId);
  await waitFor(() => srv.requests.length > before);
});
