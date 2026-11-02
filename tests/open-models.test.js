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
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "Ollama (TRIF)", base_url = "http://127.0.0.1:11434/v1", wire_api = "responses", supports_websockets = false, stream_idle_timeout_ms = 900000, request_max_retries = 1, stream_max_retries = 1 }');
  assert.ok(c.args.includes('model_provider="trif-open"') && c.args.includes('web_search="disabled"'));
  assert.ok(!c.args.some((a) => a.startsWith('shell_environment_policy')));
  assert.deepEqual(c.args.slice(-4), ['-m', 'gpt-oss:20b', '--', 'P']);

  om = oss.resolve({ provider: 'lmstudio', model: 'qwen/qwen3-coder-30b' });
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /name = "LM Studio \(TRIF\)", base_url = "http:\/\/127\.0\.0\.1:1234\/v1"/);
  assert.deepEqual(c.args.slice(-4), ['-m', 'qwen/qwen3-coder-30b', '--', 'P']);

  // OpenRouter: Codex gets no key and no key variable: its base_url is the run's key proxy (prepare).
  om = { ...oss.resolve({ provider: 'openrouter' }, null, 'qwen/qwen3-coder'), proxyUrl: 'http://127.0.0.1:5555/0123abcd/v1' };
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "OpenRouter (TRIF)", base_url = "http://127.0.0.1:5555/0123abcd/v1", wire_api = "responses", supports_websockets = false }');
  assert.ok(!c.args.some((a) => /env_key/.test(a)));
  // (Codex snapshots the user's login shell for its commands' environment: the variable stays out of it.)
  assert.ok(c.args.includes('shell_environment_policy.exclude=["OPENROUTER_API_KEY"]'));
  assert.deepEqual(c.args.slice(-4), ['-m', 'qwen/qwen3-coder', '--', 'P']);

  // Custom URL, its own key variable, resuming: exec options before `resume`.
  om = oss.resolve({ provider: 'custom', baseUrl: 'https://llm.example.com/v1/', keyEnv: 'MY_LLM_KEY', model: 'big-model' });
  c = oss.command({ bin: 'codex', prompt: '-P', sessionId: 'th1', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /base_url = "https:\/\/llm\.example\.com\/v1", wire_api = "responses", supports_websockets/);
  assert.deepEqual(c.args.slice(-6), ['-m', 'big-model', 'resume', 'th1', '--', '-P']);
  assert.ok(c.args.indexOf('model_provider="trif-open"') < c.args.indexOf('resume'));
  // The plain Codex option is untouched by all this.
  const plain = require('../helper/lib/agents/codex').command({ bin: 'codex', prompt: 'P', ...LIMITS });
  assert.ok(!plain.args.some((a) => /trif-open|web_search/.test(a)));
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
  fs.writeFileSync(shell, `#!/bin/sh\necho "Welcome back! fortune: ${'x'.repeat(10)}"\nTTEST_SHELL_KEY='${FAKE_KEY}'; export TTEST_SHELL_KEY\n[ "$1 $2 $3" = "-l -i -c" ] || exit 9\n/bin/sh -c "$4"\necho trailing noise\n`);
  fs.chmodSync(shell, 0o755);
  shellenv.forget();
  let r = await shellenv.lookupEnvVar('TTEST_SHELL_KEY', { env: {}, shell });
  assert.deepEqual(r, { value: FAKE_KEY, source: 'shell', error: null });
  r = await shellenv.lookupEnvVar('TTEST_SHELL_KEY', { env: { TTEST_SHELL_KEY: 'from-env-value' }, shell });
  assert.deepEqual(r, { value: 'from-env-value', source: 'helper', error: null });
  r = await shellenv.lookupEnvVar('TTEST_UNSET_VAR', { env: {}, shell });
  assert.equal(r.value, null);
  assert.match(r.error, /isn't set in your shell/);
  r = await shellenv.lookupEnvVar('X; rm -rf ~', { env: {}, shell });
  assert.match(r.error, /isn't a valid environment variable name/);
  const slow = path.join(dir, 'slowshell');
  fs.writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
  fs.chmodSync(slow, 0o755);
  r = await shellenv.lookupEnvVar('TTEST_SLOW', { env: {}, shell: slow, timeout: 300 });
  assert.match(r.error, /took more than/);
  assert.equal(shellenv.redactSecrets(`a ${FAKE_KEY} b ${FAKE_KEY}`, [FAKE_KEY]), 'a [redacted] b [redacted]');
  assert.equal(shellenv.redactSecrets('short ab', ['ab']), 'short ab'); // too short to be a key
});

// A fake codex: `--version`; `exec` dumps argv and env to <dir>/calls, asks its base_url for /models (the
// key proxy, whose stand-in upstream echoes the Authorization header it got) and plays a run that leaks
// what came back on stdout and stderr, to check the helper redacts it.
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
const base = (/base_url = "([^"]+)"/.exec(prov) || [])[1] || '';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
(async () => {
  let got = '';
  try { const r = await fetch(base + '/models'); got = (await r.json()).auth || ''; } catch (e) { got = 'unreachable ' + e.message; }
  say({ type: 'thread.started', thread_id: 'th-oss-1' });
  say({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Model metadata for \`x\` not found. Defaulting to fallback metadata' } });
  say({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'leaking ' + got } });
  process.stderr.write('debug: auth header ' + got + '\\n');
  if (argv.some((a) => a.includes('-P-FAIL'))) process.exit(1);
  say({ type: 'turn.completed', usage: {} });
})();
`;

function makeHome(config = {}) {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX);
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...config, env: { ...(config.env || {}), PATH: bin } }));
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
  r = await extRequest(ext, 'agent.openModel.set', { provider: 'openrouter', keyEnv: 'TTEST_KEY' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.openModel, { provider: 'openrouter', model: '', baseUrl: '', keyEnv: 'TTEST_KEY' });
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

test('helper: the key never reaches Codex (no env, no argv): the run\'s key proxy adds it, closes after; never in logs or events', async () => {
  const srv = await startFakeModelServer({ echoAuth: true });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome({ openModel: { provider: 'custom', baseUrl: `${srv.url}/v1`, keyEnv: 'TTEST_KEY' }, env: { OPENAI_API_KEY: 'sk-config-openai-0123456789' } });
  const ext = startHost(home, { TTEST_KEY: FAKE_KEY }); // as if Chrome had been started from the terminal
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', model: 'qwen/qwen3-coder', prompt: 'hide the banner' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true);
  assert.equal(done.sessionId, 'th-oss-1');
  const call = lastCall(bin);
  assert.ok(!JSON.stringify(call).includes(FAKE_KEY), 'not in Codex\'s env or argv');
  assert.equal(call.env.TTEST_KEY, undefined);
  assert.equal(call.env.OPENAI_API_KEY, undefined, 'config.json\'s keys for the other agents aren\'t passed to this one');
  assert.ok(!call.argv.some((a) => /env_key/.test(a)));
  assert.ok(call.argv.includes('shell_environment_policy.exclude=["TTEST_KEY"]'));
  const base = /base_url = "([^"]+)"/.exec(providerToml(call.argv))[1];
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1$/);
  assert.deepEqual(call.argv.slice(call.argv.indexOf('-m'), call.argv.indexOf('-m') + 2), ['-m', 'qwen/qwen3-coder']);
  // The proxy added the key on the way to the provider.
  const viaProxy = srv.requests.filter((x) => x.url === '/v1/models');
  assert.equal(viaProxy.length, 1);
  assert.equal(viaProxy[0].headers.authorization, `Bearer ${FAKE_KEY}`);
  const evs = eventsOf(ext, r.result.runId);
  assert.ok(!JSON.stringify(evs).includes(FAKE_KEY));
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'leaking Bearer [redacted]'), JSON.stringify(evs));
  assert.ok(!evs.some((e) => e.kind === 'error'), 'the metadata warning is dropped');
  const log = fs.readFileSync(path.join(home, 'runs', `${r.result.runId}.jsonl`), 'utf8');
  assert.ok(!log.includes(FAKE_KEY));
  assert.match(log, /"webmods":"openModel","provider":"custom","model":"qwen\/qwen3-coder".*"keyProxy":true/);
  assert.match(log, /Bearer \[redacted\]/);
  assert.ok(!fs.readFileSync(path.join(home, 'helper.log'), 'utf8').includes(FAKE_KEY));
  // Closed once the run ended.
  await waitFor(async () => { try { await fetch(`${base}/models`); return false; } catch { return true; } });

  // A failing run: the stderr tail in the error is redacted too. A per-run provider override is honoured.
  const r2 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: '-P-FAIL', openModel: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', keyEnv: 'TTEST_KEY' }, model: 'm1' });
  const d2 = await waitDone(ext, r2.result.runId);
  assert.equal(d2.ok, false);
  assert.match(fs.readFileSync(path.join(home, 'runs', `${r2.result.runId}.jsonl`), 'utf8'), /"webmods":"openModel","provider":"custom","model":"m1","baseUrl":"http:\/\/127\.0\.0\.1:9\/v1"/);
  assert.match(providerToml(lastCall(bin).argv), /base_url = "http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1"/); // (through its own proxy)
  assert.ok(!JSON.stringify(eventsOf(ext, r2.result.runId)).includes(FAKE_KEY));
  assert.ok(!fs.readFileSync(path.join(home, 'runs', `${r2.result.runId}.jsonl`), 'utf8').includes(FAKE_KEY));
});

test('helper: no key, Ollama down or the model missing: the run fails fast with the fix, Codex never starts', async () => {
  const srv = await startFakeModelServer({ models: ['llama3:8b'] });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome({ openModel: { provider: 'openrouter', keyEnv: 'TTEST_NEVER_SET_KEY' } });
  const ext = startHost(home);
  let r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x' });
  let d = await waitDone(ext, r.result.runId);
  assert.equal(d.ok, false);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /TTEST_NEVER_SET_KEY isn't set .*export TTEST_NEVER_SET_KEY=/);
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
  res = await runCli(['agent', 'open-model', '--provider', 'openrouter', '--key-env', 'TTEST_KEY', '--model', 'z-ai/glm-5.3'], { home, env: { TTEST_KEY: FAKE_KEY } });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /key in {4}TTEST_KEY: set \(in this environment; not shown\)/);
  assert.ok(!res.stdout.includes(FAKE_KEY));
  res = await runCli(['agent', 'open-model', '--key-env', 'sk-or-v1-abcdef0123'], { home });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /NAME of the environment variable/);

  const ws = (openModel) => ({ config: { openModel } });
  const lookup = async (name, { env }) => (env[name] ? { value: env[name], source: 'helper' } : { value: null, error: 'not set' });
  let c = await oss.doctorChecks(ws({ provider: 'openrouter', keyEnv: 'TTEST_KEY' }), { env: { TTEST_KEY: FAKE_KEY }, lookup });
  assert.deepEqual(c.map((x) => x.status), ['ok']);
  assert.match(c[0].title, /TTEST_KEY is set/);
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

// ------------------------------------------------------------------ the key proxy (keyproxy.js)

test('key proxy: adds the key, streams, passes status and headers; refuses other paths, browsers and hosts; closes', async () => {
  const http = require('http');
  const { startKeyProxy } = require('../helper/lib/keyproxy');
  // A stand-in provider: /v1/responses streams three events with pauses; /v1/models answers 401 when asked.
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/api/v1/models') {
        res.writeHead(req.headers['x-want'] === '401' ? 401 : 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'x-request-id': 'r1' });
        return res.end('{"data":[]}');
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const tick = () => { res.write(`data: ${i}\n\n`); if (++i < 3) setTimeout(tick, 150); else res.end(); };
      tick();
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));
  const statuses = [];
  const proxy = await startKeyProxy({ target: `http://127.0.0.1:${upstream.address().port}/api/v1`, key: FAKE_KEY, onStatus: (s) => statuses.push(s) });
  cleanups.push(() => proxy.close());
  assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1$/);
  assert.ok(!proxy.url.includes(FAKE_KEY));

  // Streaming: the first event arrives before the upstream has finished.
  const t0 = Date.now();
  const r = await fetch(`${proxy.url}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer from-codex' }, body: '{"model":"m"}' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  const reader = r.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /data: 0/);
  assert.ok(Date.now() - t0 < 250, 'the first event came through at once');
  let rest = '';
  for (;;) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
  assert.match(rest, /data: 2/);
  const sent = seen.find((x) => x.url === '/api/v1/responses');
  assert.equal(sent.headers.authorization, `Bearer ${FAKE_KEY}`); // the proxy's key, not the client's
  assert.equal(sent.body, '{"model":"m"}');

  // Status and headers through; no CORS headers; a 401 is reported (codex-oss forgets the cached key).
  const m = await fetch(`${proxy.url}/models`, { headers: { 'x-want': '401' } });
  assert.equal(m.status, 401);
  assert.equal(m.headers.get('x-request-id'), 'r1');
  assert.equal(m.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(statuses, [200, 401]);

  // Refused, and never forwarded: outside the secret prefix, a wrong prefix, other paths and methods,
  // anything a browser sends (Origin, Sec-Fetch-*), another Host (DNS rebinding).
  const forwarded = seen.length;
  const port = proxy.port;
  const raw = (pathname, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    q.on('error', reject);
    q.end();
  });
  const prefix = new URL(proxy.url).pathname; // /<hex>/v1
  assert.equal(await raw('/v1/models'), 404);
  assert.equal(await raw(`/${'0'.repeat(32)}/v1/models`), 404);
  assert.equal(await raw(`${prefix}x/models`), 404);
  assert.equal(await raw(`${prefix}/keys`), 404);
  assert.equal(await raw(`${prefix}/../models`), 404);
  assert.equal(await raw(`${prefix}/models`, { method: 'DELETE' }), 404);
  assert.equal(await raw(`${prefix}/responses`, { method: 'POST', headers: { origin: 'https://evil.example' } }), 403);
  assert.equal(await raw(`${prefix}/responses`, { method: 'POST', headers: { origin: 'null' } }), 403);
  assert.equal(await raw(`${prefix}/models`, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } }), 403);
  assert.equal(await raw(`${prefix}/models`, { headers: { 'sec-fetch-dest': 'image' } }), 403);
  assert.equal(await raw(`${prefix}/models`, { headers: { host: `evil.example:${port}` } }), 403);
  assert.equal(seen.length, forwarded, 'nothing refused reached the provider');
  assert.equal(proxy.stats.refused, 11);
  assert.equal(await raw(`${prefix}/models`), 200); // and still works

  await proxy.close();
  await assert.rejects(fetch(`${proxy.url}/models`));
});

test('codex-oss prepare: a proxy only with a key; a 401 forgets the cached key; the run closes it; checks look again', async () => {
  const srv = await startFakeModelServer({ models: ['llama3:8b'] });
  cleanups.push(() => srv.close());
  const forgot = [];
  const lookup = async (name, { env }) => (env[name] ? { value: env[name], source: 'helper' } : { value: null, error: 'not set' });
  const prep = await oss.prepare({ ws: { config: { openModel: { provider: 'custom', baseUrl: `${srv.url}/v1`, keyEnv: 'TTEST_KEY', model: 'm' } } }, env: { TTEST_KEY: FAKE_KEY }, lookup, forget: (n) => forgot.push(n) });
  assert.deepEqual(prep.env, {});
  assert.ok(prep.unsetEnv.includes('TTEST_KEY') && prep.unsetEnv.includes('OPENAI_API_KEY') && prep.unsetEnv.includes('ANTHROPIC_API_KEY'));
  assert.deepEqual(prep.secrets, [FAKE_KEY]);
  assert.equal(prep.state.openModel.baseUrl, `${srv.url}/v1`); // (messages name the real server)
  const proxied = prep.options.openModel.proxyUrl;
  cleanups.push(() => prep.cleanup());
  assert.match(proxied, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1$/);
  assert.ok(!JSON.stringify(oss.command({ bin: 'codex', prompt: 'P', ...LIMITS, ...prep.options }).args).includes(FAKE_KEY));
  const ok = await fetch(`${proxied}/models`);
  assert.equal(ok.status, 200);
  assert.deepEqual(forgot, []);
  await prep.cleanup();
  await assert.rejects(fetch(`${proxied}/models`));
  // A 401 from the provider: the key is looked up afresh next time.
  const http = require('http');
  const refusing = http.createServer((req, res) => { req.resume(); res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"No auth credentials found"}}'); });
  await new Promise((r) => refusing.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => refusing.close(() => r())));
  const p2 = await oss.prepare({ ws: { config: { openModel: { provider: 'custom', baseUrl: `http://127.0.0.1:${refusing.address().port}/v1`, keyEnv: 'TTEST_KEY', model: 'm' } } }, env: { TTEST_KEY: FAKE_KEY }, lookup, forget: (n) => forgot.push(n) });
  assert.equal((await fetch(`${p2.options.openModel.proxyUrl}/responses`, { method: 'POST', body: '{}' })).status, 401);
  assert.deepEqual(forgot, ['TTEST_KEY']);
  await p2.cleanup();
  // No key (a local server): no proxy, nothing to clean up.
  const p3 = await oss.prepare({ ws: { config: { openModel: { provider: 'ollama', baseUrl: `${srv.url}/v1` } } }, env: {}, lookup });
  assert.equal(p3.cleanup, null);
  assert.equal(p3.options.openModel.proxyUrl, undefined);
  // Checks (doctor, the panel's key check) look past the 10-minute cache.
  const fresh = [];
  const spy = async (name, opts) => { fresh.push(!!opts.fresh); return { value: 'v', source: 'shell' }; };
  await oss.settings({ config: { openModel: { provider: 'openrouter' } } }, { check: true, lookup: spy });
  await oss.doctorChecks({ config: { openModel: { provider: 'openrouter' } } }, { lookup: spy });
  assert.deepEqual(fresh, [true, true]);
  // The panel's "nothing leaves it" goes by effective.local: an Ollama on another computer isn't local.
  assert.equal((await oss.settings({ config: { openModel: { provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434/v1' } } })).effective.local, false);
  assert.equal((await oss.settings({ config: { openModel: { provider: 'ollama' } } })).effective.local, true);
});

test('local means loopback; no key over plain http to another computer; well-known variables refused as the key name', () => {
  assert.equal(oss.resolve({ provider: 'ollama' }).local, true);
  assert.equal(oss.resolve({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }).local, true);
  assert.equal(oss.resolve({ provider: 'lmstudio', baseUrl: 'http://[::1]:1234/v1' }).local, true);
  const far = oss.resolve({ provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434/v1' });
  assert.deepEqual([far.local, far.server, far.error], [false, true, null]); // still an Ollama, just not "on this computer"
  assert.equal(oss.resolve({ provider: 'ollama', baseUrl: 'http://127.0.0.1.evil.com/v1' }).local, false);
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'https://x.com/v1' }).local, false);
  // A key over http to another computer: refused; https, or http on this computer: fine.
  assert.match(oss.resolve({ provider: 'custom', baseUrl: 'http://llm.example.com/v1', keyEnv: 'MY_KEY', model: 'm' }).error, /must start with https:\/\//);
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'https://llm.example.com/v1', keyEnv: 'MY_KEY', model: 'm' }).error, null);
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', keyEnv: 'MY_KEY', model: 'm' }).error, null);
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'http://llm.example.com/v1', model: 'm' }).error, null); // no key: the user's call
  const home = tempDir();
  oss.saveSettings(home, { provider: 'custom', baseUrl: 'http://llm.example.com/v1', model: 'm' });
  assert.throws(() => oss.saveSettings(home, { keyEnv: 'MY_KEY' }), /https:\/\//);
  oss.saveSettings(home, { baseUrl: 'https://llm.example.com/v1', keyEnv: 'MY_KEY' });
  assert.throws(() => oss.saveSettings(home, { baseUrl: 'http://llm.example.com/v1' }), /https:\/\//);
  // Key names: not the system's, the shell's, the loader's or TRIF's own.
  for (const n of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'PWD', 'LANG', 'LC_ALL', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'NODE_OPTIONS', 'TRIF_RUN_TOKEN', 'WEBMODS_HOME', 'CODEX_HOME', 'SSH_AUTH_SOCK', 'path']) {
    assert.match(shellenv.keyNameProblem(n), /not an API key's/, n);
    assert.throws(() => oss.saveSettings(home, { keyEnv: n }), /not an API key's/, n);
    assert.equal(oss.normalize({ provider: 'custom', keyEnv: n }).keyEnv, '', n);
  }
  for (const n of ['OPENROUTER_API_KEY', 'MY_LLM_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'PATHWAY_KEY']) assert.equal(shellenv.keyNameProblem(n), '', n);
  assert.equal(oss.resolve({ provider: 'openrouter', keyEnv: 'HOME' }).keyEnv, 'OPENROUTER_API_KEY'); // a stored bad name: the provider's
});

test('the default model: what a run with none picked uses, listed and run alike (local: an installed one)', async () => {
  const tags = (names) => async () => ({ ok: true, json: async () => ({ models: names.map((name) => ({ name })) }) });
  // The provider default installed: it.
  let r = await oss.listModels({ config: { openModel: { provider: 'ollama' } }, fetchImpl: tags(['llama3:8b', 'gpt-oss:20b']) });
  assert.equal(r.default, 'gpt-oss:20b');
  // Not installed: the first installed recommended model, else the first installed.
  r = await oss.listModels({ config: { openModel: { provider: 'ollama' } }, fetchImpl: tags(['llama3:8b', 'qwen3-coder:30b', 'devstral:24b']) });
  assert.equal(r.default, 'qwen3-coder:30b');
  r = await oss.listModels({ config: { openModel: { provider: 'ollama' } }, fetchImpl: tags(['mistral', 'llama3:8b']) });
  assert.equal(r.default, 'llama3:8b');
  // A stored model: that one, installed or not (prepare says to pull it).
  r = await oss.listModels({ config: { openModel: { provider: 'ollama', model: 'gemma4:9b' } }, fetchImpl: tags(['llama3:8b']) });
  assert.equal(r.default, 'gemma4:9b');
  // prepare runs the same one.
  const ws = { config: { openModel: { provider: 'ollama' } } };
  let p = await oss.prepare({ ws, fetchImpl: tags(['llama3:8b', 'qwen3-coder:30b']) });
  assert.equal(p.options.openModel.model, 'qwen3-coder:30b');
  assert.equal(oss.command({ bin: 'codex', prompt: 'P', ...LIMITS, ...p.options }).args.slice(-4)[1], 'qwen3-coder:30b');
  p = await oss.prepare({ ws, model: 'llama3:8b', fetchImpl: tags(['llama3:8b', 'gpt-oss:20b']) });
  assert.equal(p.options.openModel.model, 'llama3:8b');
  await assert.rejects(oss.prepare({ ws, model: 'gemma4:9b', fetchImpl: tags(['llama3:8b']) }), /ollama pull gemma4:9b/);
  // LM Studio alike; OpenRouter and custom: what resolve says.
  r = await oss.listModels({ config: { openModel: { provider: 'lmstudio' } }, fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'mistral-7b' }, { id: 'qwen/qwen3-coder-30b' }] }) }) });
  assert.equal(r.default, 'qwen/qwen3-coder-30b');
  r = await oss.listModels({ config: { openModel: { provider: 'openrouter', model: 'z-ai/glm-5.3' } } });
  assert.equal(r.default, 'z-ai/glm-5.3');
  r = await oss.listModels({ config: { openModel: { provider: 'custom', baseUrl: 'https://x.com/v1' } } });
  assert.equal(r.default, null);
});

test('shellenv: done once the end marker is out, though a background job holds the output; its process group is killed', async () => {
  const dir = tempDir();
  const shell = path.join(dir, 'bgshell');
  const pidFile = path.join(dir, 'bg.pid');
  // A profile that starts a job in the background holding stdout (like a slow `nvm` or an update check).
  fs.writeFileSync(shell, `#!/bin/sh\nsleep 20 &\necho $! > '${pidFile}'\nTTEST_BG_KEY='${FAKE_KEY}'; export TTEST_BG_KEY\n/bin/sh -c "$4"\n`);
  fs.chmodSync(shell, 0o755);
  shellenv.forget();
  const t0 = Date.now();
  const r = await shellenv.lookupEnvVar('TTEST_BG_KEY', { env: {}, shell, timeout: 10000 });
  assert.deepEqual(r, { value: FAKE_KEY, source: 'shell', error: null });
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { timeout: 3000, message: 'the background job to be killed' });
  // A refused name never reaches the shell.
  assert.match((await shellenv.lookupEnvVar('NODE_OPTIONS', { env: {}, shell })).error, /not an API key's/);
});

test('panel: when the open model\'s provider changes, every stored codex-oss model pick goes', async () => {
  const lib = await import('../extension/lib.js');
  const snapshots = new Map([['c.com', { agent: '', models: { 'codex-oss': 'gpt-oss:20b', codex: 'gpt-5' } }]]);
  const r = lib.withoutModel({
    settings: { agent: 'codex-oss', models: { 'codex-oss': 'qwen/qwen3-coder', claude: 'opus' } },
    picks: { 'a.com': { agent: 'codex-oss', models: { 'codex-oss': 'z-ai/glm-5.3' } }, 'b.com': { agent: 'claude', models: { claude: 'sonnet' } } },
    snapshots,
  }, 'codex-oss');
  assert.deepEqual(r.settings, { agent: 'codex-oss', models: { claude: 'opus' } });
  assert.deepEqual(r.picks, { 'a.com': { agent: 'codex-oss', models: {} }, 'b.com': { agent: 'claude', models: { claude: 'sonnet' } } });
  assert.deepEqual(snapshots.get('c.com').models, { codex: 'gpt-5' });
});

// ------------------------------------------------------------------ the real Codex, a stand-in model

function realCodex() {
  if (process.env.TRIF_TEST_NO_REAL_CODEX) return null;
  const file = findExecutable('codex', ['/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '').split(path.delimiter)]);
  if (!file) return null;
  const v = versionOf(file, { PATH: '/usr/bin:/bin', HOME: process.env.HOME });
  return require('../helper/lib/agents/codex').tooOld(v) ? null : { file, version: v };
}

test('real Codex + stand-in model: model requests get through (the key proxy adds the key), the agent\'s commands get no network, no config.json, no key anywhere (procargs); trif works', { skip: !realCodex() && 'needs Codex 0.138+ (and a shell without another sandbox)' }, async () => {
  const cx = realCodex();
  // Its own made-up key: earlier tests' helpers (still running) hold FAKE_KEY in their environment.
  const KEY = `fake-real-key-${require('crypto').randomBytes(12).toString('hex')}`;
  const home = tempDir();
  const bin = path.join(home, 'agentbin');
  fs.mkdirSync(bin);
  fs.symlinkSync(cx.file, path.join(bin, 'codex'));
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sites', 'other.org'), { recursive: true });
  // The key in the (fake) home's shell profiles too: the sandbox keeps the agent's login shell out of them,
  // and shell_environment_policy.exclude keeps it out of the environment Codex builds from its own
  // (unsandboxed) snapshot of that shell: without it, the commands get the key (seen with Codex 0.166).
  const fakehome = path.join(home, 'fakehome');
  fs.mkdirSync(fakehome);
  for (const f of ['.zshenv', '.zprofile', '.zshrc']) fs.writeFileSync(path.join(fakehome, f), `export TTEST_KEY='${KEY}'\n`);
  // The helper finds the key the way it does when Chrome starts it: through the login shell (a stand-in
  // here), not in its own environment, which (like any same-user process's) the agent's commands could read.
  const keyShell = path.join(home, 'keyshell');
  fs.writeFileSync(keyShell, `#!/bin/sh\nTTEST_KEY='${KEY}'; export TTEST_KEY\n/bin/sh -c "$4"\n`);
  fs.chmodSync(keyShell, 0o755);
  // A value the helper's own environment does hold: the procargs probe must find it, to show it works.
  const canary = `canary-${require('crypto').randomBytes(12).toString('hex')}`;
  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
  const probe = path.join(home, 'procargs-probe.py');
  fs.copyFileSync(path.join(__dirname, 'procargs-probe.py'), probe);
  const q = (s) => `'${s}'`;
  const node = process.execPath;
  const script = [
    { run: `${q(node)} ${q(CLI_JS)} tabs` },
    { run: 'curl -sS -m 5 -o /dev/null -w "%{http_code}" https://example.com; echo " curl=$?"' },
    { run: 'LOCAL' }, // filled in below: curl to the model server itself
    { run: `cat ${q(path.join(home, 'config.json'))}; echo " cat=$?"` },
    { run: `echo '// mine' > ${q(path.join(home, 'sites', 'example.com', 'oss-probe.js'))} && echo WROTE-OWN` },
    { run: `echo x > ${q(path.join(home, 'sites', 'other.org', 'oss-probe.js'))}; echo " other=$?"` },
    { run: 'echo "key=[$TTEST_KEY]"; env | grep -c TTEST_KEY' },
    // Every same-user process's argv and environment (KERN_PROCARGS2, which the sandbox allows): no key.
    { run: `python3 -I ${q(probe)} ${sha(KEY)} ${KEY.length} ${sha(canary)} ${canary.length}` },
    { say: 'Done: probed.' },
  ];
  const srv = await startFakeModelServer({ script });
  cleanups.push(() => srv.close());
  script[2] = { run: `curl -sS -m 5 ${srv.url}/api/version; echo " local=$?"` };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ env: { PATH: `${bin}:/usr/bin:/bin` }, openModel: { provider: 'custom', baseUrl: `${srv.url}/v1`, keyEnv: 'TTEST_KEY', model: 'stand-in' }, secret: 'CONFIG-SECRET' }));
  shellenv.forget();
  const ext = startHost(home, { TRIF_KEY_SHELL: keyShell, TTEST_CANARY: canary, TRIF_AGENT_TIMEOUT_MS: '100000' });
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
  assert.ok(posts.every((x) => x.headers.authorization === `Bearer ${KEY}`));
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
  const scan = /procargs scanned=(\d+) key=(\d+) canary=(\d+)/.exec(out);
  assert.ok(scan, info);
  assert.ok(Number(scan[1]) > 10, info); // it could read other processes
  assert.ok(Number(scan[3]) >= 1, `the probe should find the canary in the helper's environment: ${info}`);
  assert.equal(scan[2], '0', `the key is in some process's argv or environment: ${info}`);
  assert.ok(!out.includes(KEY));
  assert.deepEqual(done.changedFiles, ['sites/example.com/oss-probe.js']);
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'Done: probed.'));
  assert.ok(!fs.readFileSync(path.join(home, 'runs', `${r.result.runId}.jsonl`), 'utf8').includes(KEY));
  assert.ok(!fs.readFileSync(path.join(home, 'helper.log'), 'utf8').includes(KEY));

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
