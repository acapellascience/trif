'use strict';
// Open models through Codex (experimental): helper/lib/agents/codex-oss.js, helper/lib/keyring.js (the API
// key in the system keyring: a stand-in `security`/`secret-tool` here, tests/fake-keychain.js, never the
// real Keychain) and their plumbing (agent.openModel[.setKey], agent.start's prepare step, the key proxy,
// redaction, doctor, `trif agent open-model`).
// A fake `codex` for the helper tests; the last test runs the REAL Codex (when installed) against a
// stand-in model server (tests/fake-model-server.js), with TRIF's real permission profile and a scratch
// HOME (so no OpenAI login, nothing of the user's). It applies macOS's sandbox, which may fail inside
// another sandbox; TRIF_TEST_NO_REAL_CODEX=1 skips it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, runCli, tempDir, waitFor, CLI_JS, privDir } = require('./fake-extension');
const { startFakeModelServer } = require('./fake-model-server');
const oss = require('../helper/lib/agents/codex-oss');
const keyring = require('../helper/lib/keyring');
const { makeFakeKeychain } = require('./fake-keychain');
const { findExecutable, versionOf, redactSecrets } = require('../helper/lib/agents/util');

// In this process too (oss.settings, prepare, doctorChecks called directly): a stand-in keychain.
const KC = makeFakeKeychain(path.join(tempDir(), 'kc'));
process.env.TRIF_KEYCHAIN_BIN = KC.bin;
const kcEnv = KC.env;

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const LIMITS = { readable: ['/h'], writable: ['/h/sites'], readOnly: [], denied: ['/h/config.json'] };
const FAKE_KEY = 'fake-test-key-0123456789abcdef'; // a made-up value, for checking where it does and doesn't go
const EXCLUDE = 'shell_environment_policy.exclude=["*_API_KEY", "*_API_TOKEN", "*_ACCESS_TOKEN", "*_AUTH_TOKEN", "*_SECRET_KEY"]';

function argAfter(args, flag, pred) {
  for (let i = 0; i < args.length - 1; i++) if (args[i] === flag && pred(args[i + 1])) return args[i + 1];
  return null;
}
const providerToml = (args) => argAfter(args, '-c', (v) => v.startsWith('model_providers.trif-open='));

// ------------------------------------------------------------------ command lines (pure)

test('command: local Ollama, LM Studio, OpenRouter (through the key proxy), custom URL with resume', () => {
  // Ollama: a custom provider at 127.0.0.1:11434/v1, no key, no --oss (it would pull missing models).
  let om = oss.resolve({ provider: 'ollama' });
  let c = oss.command({ bin: '/x/codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.equal(c.file, '/x/codex');
  assert.ok(!c.args.includes('--oss') && !c.args.includes('--local-provider'));
  assert.ok(c.args.includes('--ignore-user-config') && c.args.includes('--ignore-rules') && c.args.includes('default_permissions="trif-run"'));
  assert.match(c.args.find((a) => a.startsWith('permissions=')), /network = \{ enabled = false \}/);
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "Ollama (TRIF)", base_url = "http://127.0.0.1:11434/v1", wire_api = "responses", supports_websockets = false, stream_idle_timeout_ms = 900000, request_max_retries = 1, stream_max_retries = 1 }');
  assert.ok(c.args.includes('model_provider="trif-open"') && c.args.includes('web_search="disabled"'));
  // (API key variables a shell profile may still export: kept from the commands, whatever the provider.)
  assert.ok(c.args.includes(EXCLUDE));
  assert.deepEqual(c.args.slice(-3), ['-m', 'gpt-oss:20b', '-']);

  om = oss.resolve({ provider: 'lmstudio', model: 'qwen/qwen3-coder-30b' });
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /name = "LM Studio \(TRIF\)", base_url = "http:\/\/127\.0\.0\.1:1234\/v1"/);
  assert.deepEqual(c.args.slice(-3), ['-m', 'qwen/qwen3-coder-30b', '-']);

  // OpenRouter: Codex gets no key and no key variable: its base_url is the run's key proxy (prepare).
  om = { ...oss.resolve({ provider: 'openrouter' }, null, 'qwen/qwen3-coder'), proxyUrl: 'http://127.0.0.1:5555/0123abcd/v1' };
  c = oss.command({ bin: 'codex', prompt: 'P', openModel: om, ...LIMITS });
  assert.equal(providerToml(c.args), 'model_providers.trif-open={ name = "OpenRouter (TRIF)", base_url = "http://127.0.0.1:5555/0123abcd/v1", wire_api = "responses", supports_websockets = false }');
  assert.ok(!c.args.some((a) => /env_key/.test(a)));
  assert.ok(c.args.includes(EXCLUDE));
  assert.deepEqual(c.args.slice(-3), ['-m', 'qwen/qwen3-coder', '-']);

  // Custom URL, resuming: exec options before `resume`.
  om = oss.resolve({ provider: 'custom', baseUrl: 'https://llm.example.com/v1/', model: 'big-model' });
  c = oss.command({ bin: 'codex', prompt: '-P', sessionId: 'th1', openModel: om, ...LIMITS });
  assert.match(providerToml(c.args), /base_url = "https:\/\/llm\.example\.com\/v1", wire_api = "responses", supports_websockets/);
  assert.deepEqual(c.args.slice(-5), ['-m', 'big-model', 'resume', 'th1', '-']);
  assert.equal(c.stdin, `${oss.modelNote(om)}\n\n-P`, 'the message on stdin (after which model this is), never in argv');
  assert.ok(c.args.indexOf('model_provider="trif-open"') < c.args.indexOf('resume'));
  // Every message says which model this is, and who serves it.
  assert.equal(oss.modelNote(om), "(This chat's model is big-model, served by llm.example.com. Codex CLI is only the program running it: its built-in instructions are written for OpenAI's models. Asked which model you are, that's the answer: big-model.)");
  assert.match(oss.modelNote(oss.resolve({ provider: 'openrouter' }, null, 'moonshotai/kimi-k2')), /^\(This chat's model is moonshotai\/kimi-k2, served by OpenRouter\. /);
  assert.match(oss.modelNote(oss.resolve({ provider: 'ollama' })), /model is gpt-oss:20b, running on this computer in Ollama\./);
  // The plain Codex option is untouched by all this.
  const plain = require('../helper/lib/agents/codex').command({ bin: 'codex', prompt: 'P', ...LIMITS });
  assert.ok(!plain.args.some((a) => /trif-open|web_search/.test(a)));
});

test('settings: resolve (defaults, a run\'s own choice, model), keyring accounts, validation; never a key', () => {
  assert.deepEqual(oss.normalize(undefined), { provider: 'ollama', model: '', baseUrl: '' });
  assert.deepEqual(oss.normalize({ provider: 'nope', model: 'two words', baseUrl: 'ftp://x', keyEnv: 'OPENROUTER_API_KEY' }), { provider: 'ollama', model: '', baseUrl: '' });
  assert.equal(oss.normalize({ baseUrl: 'https://user:pw@x.com/v1' }).baseUrl, '');
  const stored = { provider: 'openrouter', model: 'z-ai/glm-5.3' };
  assert.equal(oss.resolve(stored).model, 'z-ai/glm-5.3');
  assert.equal(oss.resolve(stored, null, 'qwen/qwen3-coder').model, 'qwen/qwen3-coder');
  // A chat's own choice (agent.start openModel): another provider starts from that provider's defaults.
  const r = oss.resolve(stored, { provider: 'ollama' });
  assert.deepEqual([r.provider, r.model, r.baseUrl, r.keyAccount, r.local], ['ollama', 'gpt-oss:20b', 'http://127.0.0.1:11434/v1', '', true]);
  assert.equal(oss.resolve(stored, { provider: 'openrouter' }).model, 'z-ai/glm-5.3'); // the same provider: the stored model stays
  assert.match(oss.resolve({ provider: 'custom' }).error, /no server address/);
  // The keyring account: one per hosted provider, per server for custom ones; none for local servers.
  assert.deepEqual([oss.resolve(stored).keyAccount, oss.resolve(stored).keyRequired], ['openrouter', true]);
  assert.deepEqual([oss.resolve({ provider: 'custom', baseUrl: 'https://LLM.example.com:8443/v1' }).keyAccount, oss.resolve({ provider: 'custom', baseUrl: 'https://x.com/v1' }).keyRequired], ['custom:llm.example.com:8443', false]);
  assert.equal(oss.resolve({ provider: 'custom' }).keyAccount, '');
  assert.equal(oss.resolve({ provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434/v1' }).keyAccount, '');

  const home = tempDir();
  // An old config's keyEnv: ignored, and gone after the next save.
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ openModel: { provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY' } }));
  oss.saveSettings(home, { provider: 'openrouter', model: 'qwen/qwen3-coder', keyEnv: 'OTHER' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).openModel, { provider: 'openrouter', model: 'qwen/qwen3-coder' });
  assert.throws(() => oss.saveSettings(home, { provider: 'evil' }), /unknown provider/);
  assert.throws(() => oss.saveSettings(home, { baseUrl: 'file:///etc/passwd' }), /http\(s\) URL/);
  // Switching provider drops the old one's model and key name.
  oss.saveSettings(home, { provider: 'ollama' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).openModel, { provider: 'ollama' });
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
  assert.match(or('unexpected status 401 Unauthorized: No auth credentials found'), /OpenRouter wants an API key \(401\): paste your OpenRouter API key in the side panel’s Settings .*trif agent open-model --set-key/);
  const orKeyed = oss.friendlyFor({ ...oss.resolve({ provider: 'openrouter' }), keyed: true });
  assert.match(orKeyed('unexpected status 401 Unauthorized'), /OpenRouter refused the API key \(401\): check it, or make a new one/);
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
  assert.match(ev[0].message, /wants an API key/);
  assert.equal(ev[1].kind, 'done');
});

// ------------------------------------------------------------------ the key: in the keyring, nowhere else

test('keyring: macOS `security` (written through -i on stdin, as hex: never in argv), Linux secret-tool, none; keys checked', async () => {
  const dir = tempDir();
  const mac = makeFakeKeychain(path.join(dir, 'mac'));
  const o = { env: mac.env };
  assert.deepEqual(keyring.backend(o), { kind: 'security', bin: mac.bin, name: 'your Mac’s Keychain' });
  assert.deepEqual(keyring.backend({ env: {}, platform: 'darwin' }).bin, '/usr/bin/security');
  assert.deepEqual(await keyring.hasKey('openrouter', o), { stored: false, error: null });
  assert.deepEqual(await keyring.getKey('openrouter', o), { value: null, error: null });
  await keyring.setKey('openrouter', `  ${FAKE_KEY}\n`, o); // (pasted with blanks around it)
  assert.deepEqual(mac.items(), { 'TRIF open model key\u0000openrouter': FAKE_KEY });
  assert.deepEqual(await keyring.getKey('openrouter', o), { value: FAKE_KEY, error: null });
  assert.deepEqual(await keyring.hasKey('openrouter', o), { stored: true, error: null });
  await keyring.setKey('openrouter', 'second-key-0123456789', o); // replaced (-U)
  assert.equal((await keyring.getKey('openrouter', o)).value, 'second-key-0123456789');
  // What each call's command line was: the write is `security -i` (the command on its stdin).
  const calls = mac.argv();
  assert.ok(calls.some((a) => a.length === 1 && a[0] === '-i'));
  assert.ok(calls.some((a) => a.join(' ') === 'find-generic-password -s TRIF open model key -a openrouter -w'));
  assert.ok(calls.some((a) => a.join(' ') === 'find-generic-password -s TRIF open model key -a openrouter'), 'the check: no -w, nothing decrypted');
  for (const k of [FAKE_KEY, 'second-key-0123456789', Buffer.from(FAKE_KEY).toString('hex')]) assert.ok(!mac.argvText().includes(k), 'never in an argv');
  assert.deepEqual(await keyring.removeKey('openrouter', o), { removed: true });
  assert.deepEqual(await keyring.removeKey('openrouter', o), { removed: false });
  assert.deepEqual(mac.items(), {});
  const before = mac.argv().length;
  // Keys and accounts: checked, and the key is never quoted back.
  for (const bad of ['', 'short', 'has space in it 0123', 'quote"in-it-0123456', 'back\\slash-0123456', 'two\nlines-0123456789', 'é-unicode-0123456789']) {
    await assert.rejects(keyring.setKey('openrouter', bad, o), (e) => {
      assert.match(e.message, /no key given|doesn't look like an API key/);
      if (bad.length >= 8) assert.ok(!e.message.includes(bad.trim()), e.message);
      return true;
    });
  }
  assert.equal(keyring.keyProblem('sk-or-v1-0123456789abcdefABCDEF_xyz'), '');
  await assert.rejects(keyring.setKey('evil"account', FAKE_KEY, o), /bad keyring account/);
  assert.equal(mac.argv().length, before, 'refused before the keyring is asked');
  // Linux: secret-tool, the key on its stdin.
  const lin = makeFakeKeychain(path.join(dir, 'lin'), { kind: 'secret-tool' });
  const l = { env: lin.env };
  assert.equal(keyring.backend(l).kind, 'secret-tool');
  assert.deepEqual(await keyring.hasKey('custom:llm.example.com', l), { stored: false, error: null });
  await keyring.setKey('custom:llm.example.com', FAKE_KEY, l);
  assert.deepEqual(await keyring.getKey('custom:llm.example.com', l), { value: FAKE_KEY, error: null });
  assert.ok(lin.argv().some((a) => a[0] === 'store' && a.includes('--label=TRIF open model key (custom:llm.example.com)')));
  assert.ok(!lin.argvText().includes(FAKE_KEY));
  assert.deepEqual(await keyring.removeKey('custom:llm.example.com', l), { removed: true });
  // No keyring (Linux without secret-tool): no fallback, a clear message.
  assert.equal(keyring.backend({ env: {}, platform: 'win32' }), null);
  const none = await keyring.getKey('openrouter', { env: {}, platform: 'win32' });
  assert.equal(none.value, null);
  assert.match(none.error, /need a system keyring/);
  assert.match(keyring.noKeyring({ platform: 'linux' }), /secret-tool .*libsecret-tools/);
  await assert.rejects(keyring.setKey('openrouter', FAKE_KEY, { env: {}, platform: 'win32' }), /need a system keyring/);
  // A keyring tool that fails: its complaint, never the key.
  const broken = path.join(dir, 'broken-security');
  fs.writeFileSync(broken, `#!/bin/sh\necho "security: something went wrong: $(cat)" >&2\nexit 3\n`);
  fs.chmodSync(broken, 0o755);
  await assert.rejects(keyring.setKey('openrouter', FAKE_KEY, { env: { TRIF_KEYCHAIN_BIN: broken } }), (e) => {
    assert.match(e.message, /couldn't save the key in your Mac’s Keychain: security: something went wrong/);
    assert.ok(!e.message.includes(FAKE_KEY) && !e.message.includes(Buffer.from(FAKE_KEY).toString('hex')), e.message);
    return true;
  });
  // Redaction (runs.js).
  assert.equal(redactSecrets(`a ${FAKE_KEY} b ${FAKE_KEY}`, [FAKE_KEY]), 'a [redacted] b [redacted]');
  assert.equal(redactSecrets('short ab', ['ab']), 'short ab'); // too short to be a key
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
const prompt = argv[argv.length - 1] === '-' ? fs.readFileSync(0, 'utf8') : ''; // (the message comes on stdin)
fs.writeFileSync(path.join(calls, Date.now() + '-' + process.pid + '.json'), JSON.stringify({ argv, env: process.env, prompt }));
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
  if (prompt.includes('-P-FAIL')) process.exit(1);
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
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ ...config, env: { ...(config.env || {}), PATH: bin } }));
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

test('helper: codex-oss listed (experimental, never the default); settings and the API key through agent.openModel*; refused from a run', async () => {
  const { home } = makeHome();
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  const ext = startHost(home, kc.env);
  let r = await extRequest(ext, 'agent.list');
  const a = r.result.agents.find((x) => x.id === 'codex-oss');
  assert.equal(a.name, 'Open model (via Codex)');
  assert.equal(a.available, true);
  assert.equal(a.experimental, true);
  assert.equal(r.result.default, 'codex');
  r = await extRequest(ext, 'agent.openModel.set', { provider: 'openrouter' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.openModel, { provider: 'openrouter', model: '', baseUrl: '' });
  assert.equal(r.result.effective.model, 'openai/gpt-oss-120b');
  assert.equal(r.result.hasKey, false);
  assert.deepEqual(r.result.key, { account: 'openrouter', stored: false, keyring: 'your Mac’s Keychain', error: null });
  // The key: into the keyring, never echoed back.
  r = await extRequest(ext, 'agent.openModel.setKey', { key: FAKE_KEY });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.hasKey, true);
  assert.ok(!JSON.stringify(r).includes(FAKE_KEY), 'not in the answer');
  assert.deepEqual(kc.items(), { 'TRIF open model key\u0000openrouter': FAKE_KEY });
  assert.equal((await extRequest(ext, 'agent.openModel')).result.hasKey, true);
  // A bad one: refused, and the error doesn't quote it.
  r = await extRequest(ext, 'agent.openModel.setKey', { key: 'not a key 0123456789' });
  assert.equal(r.ok, false);
  assert.match(r.error, /doesn't look like an API key/);
  assert.ok(!r.error.includes('not a key'));
  // Never in config.json, an argv or the helper's log.
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8').includes(FAKE_KEY));
  assert.ok(!kc.argvText().includes(FAKE_KEY));
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes(FAKE_KEY));
  assert.match(fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8'), /API key saved in the keyring \(openrouter\)/);
  r = await extRequest(ext, 'agent.openModel.removeKey');
  assert.equal(r.result.hasKey, false);
  assert.deepEqual(kc.items(), {});
  // Local servers take no key; a custom server's key is per server, and not for http:// to another computer.
  await extRequest(ext, 'agent.openModel.set', { provider: 'ollama' });
  r = await extRequest(ext, 'agent.openModel.setKey', { key: FAKE_KEY });
  assert.match(r.error, /runs without an API key/);
  r = await extRequest(ext, 'agent.openModel.set', { provider: 'custom', baseUrl: 'http://llm.example.com/v1' });
  assert.equal(r.result.effective.keyAccount, 'custom:llm.example.com');
  r = await extRequest(ext, 'agent.openModel.setKey', { key: FAKE_KEY });
  assert.match(r.error, /must start with https:\/\//);
  await extRequest(ext, 'agent.openModel.set', { baseUrl: 'https://llm.example.com/v1' });
  r = await extRequest(ext, 'agent.openModel.setKey', { key: FAKE_KEY });
  assert.equal(r.result.hasKey, true);
  assert.deepEqual(Object.keys(kc.items()), ['TRIF open model key\u0000custom:llm.example.com']);
  await extRequest(ext, 'agent.openModel.set', { provider: 'openrouter' });
  r = await extRequest(ext, 'agent.models', { agent: 'codex-oss' });
  assert.equal(r.result.models[0].id, 'openai/gpt-oss-120b');
  // The panel's per-chat choice: agent.models for another provider than the stored one.
  r = await extRequest(ext, 'agent.models', { agent: 'codex-oss', openModel: { provider: 'custom', baseUrl: 'https://llm.example.com/v1' } });
  assert.deepEqual(r.result.models, []);
  assert.match(r.result.note, /llm\.example\.com/);
  // A run can't read or change them (config.json is private from runs too; host.js refuses agent.* with a run token).
  await ext.waitForSocket();
  let res = await runCli(['agent', 'open-model', '--provider', 'ollama'], { home, env: { TRIF_RUN_TOKEN: 'x', TRIF_RUN_BOX: path.join(home, 'nobox') } });
  assert.notEqual(res.code, 0);
  res = await runCli(['agent', 'open-model', '--set-key'], { home, env: { ...kc.env, TRIF_RUN_TOKEN: 'x', TRIF_RUN_BOX: path.join(home, 'nobox') }, input: 'evil-key-0123456789\n' });
  assert.notEqual(res.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).openModel.provider, 'openrouter');
  assert.ok(!JSON.stringify(kc.items()).includes('evil-key'));
});

test('helper: the key never reaches Codex (no env, no argv): read from the keyring, the run\'s key proxy adds it, closes after; never in logs or events', async () => {
  const srv = await startFakeModelServer({ echoAuth: true });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome({ openModel: { provider: 'custom', baseUrl: `${srv.url}/v1` }, env: { OPENAI_API_KEY: 'sk-config-openai-0123456789' } });
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  await keyring.setKey(`custom:${new URL(srv.url).host}`, FAKE_KEY, { env: kc.env });
  const ext = startHost(home, kc.env);
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', model: 'qwen/qwen3-coder', prompt: 'hide the banner' });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId);
  assert.equal(done.ok, true);
  assert.equal(done.sessionId, 'th-oss-1');
  const call = lastCall(bin);
  assert.ok(!JSON.stringify(call).includes(FAKE_KEY), 'not in Codex\'s env or argv');
  assert.match(call.prompt, /hide the banner$/, 'the message on stdin');
  assert.ok(!call.argv.some((a) => a.includes('hide the banner')), 'not in argv');
  assert.equal(call.env.OPENAI_API_KEY, undefined, 'config.json\'s keys for the other agents aren\'t passed to this one');
  assert.equal(call.env.TRIF_KEYCHAIN_BIN, undefined);
  assert.ok(!call.argv.some((a) => /env_key/.test(a)));
  assert.ok(call.argv.includes(EXCLUDE));
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
  const log = fs.readFileSync(path.join(privDir(home), 'runs', `${r.result.runId}.jsonl`), 'utf8');
  assert.ok(!log.includes(FAKE_KEY));
  assert.match(log, /"webmods":"openModel","provider":"custom","model":"qwen\/qwen3-coder".*"key":"keyring","keyProxy":true/);
  assert.match(log, /Bearer \[redacted\]/);
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes(FAKE_KEY));
  assert.ok(!kc.argvText().includes(FAKE_KEY), 'nor in the keyring tool\'s argv');
  // Closed once the run ended.
  await waitFor(async () => { try { await fetch(`${base}/models`); return false; } catch { return true; } });

  // A failing run: the stderr tail in the error is redacted too. A per-run provider override is honoured
  // (a server without a saved key: no proxy, the address as is).
  const r2 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: '-P-FAIL', openModel: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1' }, model: 'm1' });
  const d2 = await waitDone(ext, r2.result.runId);
  assert.equal(d2.ok, false);
  assert.match(fs.readFileSync(path.join(privDir(home), 'runs', `${r2.result.runId}.jsonl`), 'utf8'), /"webmods":"openModel","provider":"custom","model":"m1","baseUrl":"http:\/\/127\.0\.0\.1:9\/v1","key":null,"keyProxy":false/);
  assert.match(providerToml(lastCall(bin).argv), /base_url = "http:\/\/127\.0\.0\.1:9\/v1"/);
  // The same server with a key: through its own proxy, and the key still redacted from what failed.
  await keyring.setKey('custom:127.0.0.1:9', FAKE_KEY, { env: kc.env });
  const r3 = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: '-P-FAIL', openModel: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1' }, model: 'm1' });
  const d3 = await waitDone(ext, r3.result.runId);
  assert.equal(d3.ok, false);
  assert.match(providerToml(lastCall(bin).argv), /base_url = "http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1"/);
  assert.ok(!JSON.stringify(eventsOf(ext, r3.result.runId)).includes(FAKE_KEY));
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'runs', `${r3.result.runId}.jsonl`), 'utf8').includes(FAKE_KEY));
});

test('helper: no key, Ollama down or the model missing: the run fails fast with the fix, Codex never starts', async () => {
  const srv = await startFakeModelServer({ models: ['llama3:8b'] });
  cleanups.push(() => srv.close());
  const { home, bin } = makeHome({ openModel: { provider: 'openrouter' } });
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  const ext = startHost(home, { ...kc.env, OPENROUTER_API_KEY: 'from-env-never-used-0123' }); // (the environment is never read for keys)
  let r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x' });
  let d = await waitDone(ext, r.result.runId);
  assert.equal(d.ok, false);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /no OpenRouter API key yet: paste your OpenRouter API key in the side panel’s Settings .*trif agent open-model --set-key/);
  // No keyring at all (here: the tool is missing): said so, no fallback.
  const ext2 = startHost(makeHome({ openModel: { provider: 'openrouter' } }).home);
  r = await extRequest(ext2, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x' });
  d = await waitDone(ext2, r.result.runId);
  assert.match(eventsOf(ext2, r.result.runId).find((e) => e.kind === 'error').message, /couldn't read the key from your Mac’s Keychain/);
  r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x', openModel: { provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1' } });
  d = await waitDone(ext, r.result.runId);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /Ollama isn't running \(nothing answers at http:\/\/127\.0\.0\.1:9\/v1\)/);
  r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x', model: 'gpt-oss:20b', openModel: { provider: 'ollama', baseUrl: `${srv.url}/v1` } });
  d = await waitDone(ext, r.result.runId);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /gpt-oss:20b isn't installed in Ollama: run `ollama pull gpt-oss:20b`/);
  // A saved key for a custom server at http:// on another computer: never sent.
  await keyring.setKey('custom:llm.example.com', FAKE_KEY, { env: kc.env });
  r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: 'x', model: 'm', openModel: { provider: 'custom', baseUrl: 'http://llm.example.com/v1' } });
  d = await waitDone(ext, r.result.runId);
  assert.match(eventsOf(ext, r.result.runId).find((e) => e.kind === 'error').message, /must start with https:\/\//);
  assert.ok(!fs.existsSync(path.join(bin, 'calls')), 'codex never ran');
  // The model picker lists what that server has.
  const m = await extRequest(ext, 'agent.models', { agent: 'codex-oss', openModel: { provider: 'ollama', baseUrl: `${srv.url}/v1` } });
  assert.deepEqual(m.result.models.map((x) => x.id), ['llama3:8b']);
});

test('`trif agent open-model`: --set-key from stdin (never argv), --remove-key; --key-env gone; doctor: key saved or missing (never shown), key variables in the environment', async () => {
  const srv = await startFakeModelServer({ models: ['gpt-oss:20b'] });
  cleanups.push(() => srv.close());
  const { home } = makeHome();
  const kc = makeFakeKeychain(path.join(home, 'kc'));
  const env = kc.env;
  let res = await runCli(['agent', 'open-model'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /provider {2}ollama .*not set up yet/);
  assert.doesNotMatch(res.stdout, /API key/);
  // A local server has no key: removing one (as the README's uninstall steps do) is fine, not an error.
  res = await runCli(['agent', 'open-model', '--remove-key'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /^There was no API key saved\.$/m);
  res = await runCli(['agent', 'open-model', '--provider', 'openrouter', '--model', 'z-ai/glm-5.3'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /API key {3}none yet: trif agent open-model --set-key/);
  res = await runCli(['agent', 'open-model', '--set-key'], { home, env, input: `${FAKE_KEY}\n` });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Saved the OpenRouter API key in your Mac’s Keychain/);
  assert.match(res.stdout, /API key {3}saved in your Mac’s Keychain \(not shown\)/);
  assert.ok(!res.stdout.includes(FAKE_KEY) && !res.stderr.includes(FAKE_KEY));
  assert.deepEqual(kc.items(), { 'TRIF open model key\u0000openrouter': FAKE_KEY });
  assert.ok(!kc.argvText().includes(FAKE_KEY), 'never in the keyring tool\'s argv');
  res = await runCli(['agent', 'open-model', '--json'], { home, env });
  const j = JSON.parse(res.stdout);
  assert.equal(j.hasKey, true);
  assert.ok(!res.stdout.includes(FAKE_KEY));
  // A key on the command line: refused, not echoed (and not saved).
  res = await runCli(['agent', 'open-model', '--set-key', 'sk-or-v1-onthecommandline0123'], { home, env });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /never put a key on the command line/);
  assert.ok(!res.stderr.includes('onthecommandline') && !res.stdout.includes('onthecommandline'));
  assert.equal(kc.items()['TRIF open model key\u0000openrouter'], FAKE_KEY);
  res = await runCli(['agent', 'open-model', '--set-key'], { home, env, input: 'bad key with spaces\n' });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /doesn't look like an API key/);
  res = await runCli(['agent', 'open-model', '--key-env', 'OPENROUTER_API_KEY'], { home, env });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /--key-env is gone/);

  // Doctor's checks (in this process, the stand-in keychain).
  const ws = (openModel) => ({ config: { openModel } });
  let c = await oss.doctorChecks(ws({ provider: 'openrouter' }), { env });
  assert.deepEqual(c.map((x) => [x.status, x.title]), [['ok', 'OpenRouter key: saved in your Mac’s Keychain (not shown)']]);
  // ... and through `trif doctor`.
  res = await runCli(['doctor'], { home, env });
  assert.match(res.stdout, /OpenRouter key: saved in your Mac’s Keychain \(not shown\)/);
  assert.ok(!res.stdout.includes(FAKE_KEY));
  res = await runCli(['agent', 'open-model', '--remove-key'], { home, env });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Removed the API key/);
  assert.deepEqual(kc.items(), {});
  c = await oss.doctorChecks(ws({ provider: 'openrouter' }), { env });
  assert.equal(c[0].status, 'warn');
  assert.equal(c[0].title, 'OpenRouter key: missing, so runs can\'t reach OpenRouter');
  assert.equal(c[0].fix, 'set it in the side panel\'s Settings, or with trif agent open-model --set-key');
  // Key variables in the doctor's environment: named (presence only), with the fix.
  res = await runCli(['doctor'], { home, env: { ...env, OPENROUTER_API_KEY: 'sk-or-v1-exported0123456789', MY_SERVICE_API_KEY: 'x0123456789' } });
  assert.match(res.stdout, /API key variables set in this environment: MY_SERVICE_API_KEY, OPENROUTER_API_KEY/);
  assert.match(res.stdout, /remove the export lines from your shell profile/);
  assert.ok(!res.stdout.includes('exported0123456789'));
  assert.equal(oss.keyVarsCheck({ PATH: '/bin', HOME: '/h' }), null);
  assert.equal(oss.keyVarsCheck({ OPENAI_API_KEY: '' }), null);
  assert.match(oss.keyVarsCheck({ HF_TOKEN: 'x' }).title, /variable set in this environment: HF_TOKEN\. Every program/);
  // A custom server: "none saved" is fine.
  c = await oss.doctorChecks(ws({ provider: 'custom', baseUrl: 'https://llm.example.com/v1', model: 'm' }), { env });
  assert.deepEqual([c[0].status, c[0].title], ['info', 'API key for llm.example.com: none saved (fine if https://llm.example.com/v1 needs none; set one in the side panel\'s Settings or with trif agent open-model --set-key)']);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: `${srv.url}/v1` }), { env });
  assert.deepEqual(c.map((x) => [x.status, x.title.replace(/.*: /, '')]), [['ok', 'Ollama is running (1 model installed)']]);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: `${srv.url}/v1`, model: 'qwen3-coder:30b' }), { env });
  assert.deepEqual([c[0].status, c[0].fix], ['warn', 'ollama pull qwen3-coder:30b']);
  c = await oss.doctorChecks(ws({ provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1' }), { env });
  assert.match(c[0].title, /Ollama isn't reachable/);
  assert.match(c[0].fix, /ollama serve/);
  c = await oss.doctorChecks(ws(undefined), {});
  assert.equal(c[0].status, 'info');
  c = await oss.doctorChecks(ws({ provider: 'ollama' }), { codexVersion: '0.120.0', fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }) }) });
  assert.match(c[0].title, /too old/);
});

// ------------------------------------------------------------------ the key proxy (keyproxy.js)

test('key proxy: a kept-alive connection the provider closed meanwhile is retried once on a new one, with the same body', async () => {
  const net = require('net');
  const { startKeyProxy } = require('../helper/lib/keyproxy');
  // A provider that answers the first request on a connection and drops the connection at the second
  // (as when its keep-alive timeout passed just as the next request went out).
  const bodies = [];
  let conns = 0;
  const upstream = net.createServer((sock) => {
    conns++;
    let buf = '';
    let n = 0;
    sock.on('data', (d) => {
      buf += d;
      for (;;) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const len = Number((/content-length: (\d+)/i.exec(buf.slice(0, end)) || [])[1] || 0);
        if (buf.length < end + 4 + len) return;
        const body = buf.slice(end + 4, end + 4 + len);
        buf = buf.slice(end + 4 + len);
        if (++n === 2) { sock.destroy(); return; }
        bodies.push(body);
        sock.write(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\nconnection: keep-alive\r\n\r\n{}`);
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => upstream.close(() => r())));
  const proxy = await startKeyProxy({ target: `http://127.0.0.1:${upstream.address().port}/v1`, key: FAKE_KEY });
  cleanups.push(() => proxy.close());
  for (const b of ['{"n":1}', '{"n":2}']) {
    const r = await fetch(`${proxy.url}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
  }
  assert.deepEqual(bodies, ['{"n":1}', '{"n":2}']);
  assert.equal(proxy.stats.retried, 1);
  assert.equal(conns, 2);
});

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

test('codex-oss prepare: a proxy only with a saved key, read afresh each run; the run closes it; settings say whether one is saved', async () => {
  const srv = await startFakeModelServer({ models: ['llama3:8b'] });
  cleanups.push(() => srv.close());
  const kc = makeFakeKeychain(path.join(tempDir(), 'kc'));
  const env = kc.env;
  const account = `custom:${new URL(srv.url).host}`;
  await keyring.setKey(account, FAKE_KEY, { env });
  const wsFor = (openModel) => ({ config: { openModel } });
  const prep = await oss.prepare({ ws: wsFor({ provider: 'custom', baseUrl: `${srv.url}/v1`, model: 'm' }), env });
  assert.deepEqual(prep.env, {});
  assert.ok(prep.unsetEnv.includes('OPENAI_API_KEY') && prep.unsetEnv.includes('ANTHROPIC_API_KEY'));
  assert.deepEqual(prep.secrets, [FAKE_KEY]);
  assert.equal(prep.state.openModel.baseUrl, `${srv.url}/v1`); // (messages name the real server)
  const proxied = prep.options.openModel.proxyUrl;
  cleanups.push(() => prep.cleanup());
  assert.match(proxied, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/v1$/);
  assert.ok(!JSON.stringify(oss.command({ bin: 'codex', prompt: 'P', ...LIMITS, ...prep.options }).args).includes(FAKE_KEY));
  const ok = await fetch(`${proxied}/models`);
  assert.equal(ok.status, 200);
  await prep.cleanup();
  await assert.rejects(fetch(`${proxied}/models`));
  // Read afresh: a key replaced, then removed, counts for the next run at once.
  await keyring.setKey(account, 'replaced-key-0123456789', { env });
  const p2 = await oss.prepare({ ws: wsFor({ provider: 'custom', baseUrl: `${srv.url}/v1`, model: 'm' }), env });
  assert.deepEqual(p2.secrets, ['replaced-key-0123456789']);
  await p2.cleanup();
  await keyring.removeKey(account, { env });
  const p3 = await oss.prepare({ ws: wsFor({ provider: 'custom', baseUrl: `${srv.url}/v1`, model: 'm' }), env });
  assert.deepEqual([p3.secrets, p3.cleanup, p3.options.openModel.proxyUrl], [[], null, undefined]); // a custom server may need none
  // A 401 through the proxy is logged (without the key).
  const http = require('http');
  const refusing = http.createServer((req, res) => { req.resume(); res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"No auth credentials found"}}'); });
  await new Promise((r) => refusing.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => refusing.close(() => r())));
  await keyring.setKey(`custom:127.0.0.1:${refusing.address().port}`, FAKE_KEY, { env });
  const warned = [];
  const p4 = await oss.prepare({ ws: wsFor({ provider: 'custom', baseUrl: `http://127.0.0.1:${refusing.address().port}/v1`, model: 'm' }), env, logger: { warn: (m) => warned.push(m), info() {} } });
  assert.equal((await fetch(`${p4.options.openModel.proxyUrl}/responses`, { method: 'POST', body: '{}' })).status, 401);
  assert.deepEqual(warned, ['open model: the model server refused the API key (401)']);
  await p4.cleanup();
  // No key (a local server): no proxy, the keyring isn't asked.
  const calls = kc.argv().length;
  const p5 = await oss.prepare({ ws: wsFor({ provider: 'ollama', baseUrl: `${srv.url}/v1` }), env });
  assert.equal(p5.cleanup, null);
  assert.equal(p5.options.openModel.proxyUrl, undefined);
  assert.equal(kc.argv().length, calls);
  // settings: hasKey, never the key.
  let st = await oss.settings(wsFor({ provider: 'openrouter' }), { env });
  assert.deepEqual([st.hasKey, st.key], [false, { account: 'openrouter', stored: false, keyring: 'your Mac’s Keychain', error: null }]);
  await keyring.setKey('openrouter', FAKE_KEY, { env });
  st = await oss.settings(wsFor({ provider: 'openrouter' }), { env });
  assert.equal(st.hasKey, true);
  assert.ok(!JSON.stringify(st).includes(FAKE_KEY));
  assert.equal((await oss.settings(wsFor({ provider: 'ollama' }), { env })).key, undefined);
  // The panel's "nothing leaves it" goes by effective.local: an Ollama on another computer isn't local.
  assert.equal((await oss.settings(wsFor({ provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434/v1' }))).effective.local, false);
  assert.equal((await oss.settings(wsFor({ provider: 'ollama' }))).effective.local, true);
});

test('local means loopback; no key over plain http to another computer', () => {
  assert.equal(oss.resolve({ provider: 'ollama' }).local, true);
  assert.equal(oss.resolve({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }).local, true);
  assert.equal(oss.resolve({ provider: 'lmstudio', baseUrl: 'http://[::1]:1234/v1' }).local, true);
  const far = oss.resolve({ provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434/v1' });
  assert.deepEqual([far.local, far.server, far.error], [false, true, null]); // still an Ollama, just not "on this computer"
  assert.equal(oss.resolve({ provider: 'ollama', baseUrl: 'http://127.0.0.1.evil.com/v1' }).local, false);
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'https://x.com/v1' }).local, false);
  // A key over http to another computer: refused; https, or http on this computer: fine.
  assert.match(oss.insecureKey({ baseUrl: 'http://llm.example.com/v1' }), /must start with https:\/\//);
  assert.equal(oss.insecureKey({ baseUrl: 'https://llm.example.com/v1' }), '');
  assert.equal(oss.insecureKey({ baseUrl: 'http://127.0.0.1:8080/v1' }), '');
  assert.equal(oss.resolve({ provider: 'custom', baseUrl: 'http://llm.example.com/v1', model: 'm' }).error, null); // no key: the user's call
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
  assert.equal(oss.command({ bin: 'codex', prompt: 'P', ...LIMITS, ...p.options }).args.slice(-2)[0], 'qwen3-coder:30b');
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

test('real Codex + stand-in model: model requests get through (the key proxy adds the keyring\'s key), the agent\'s commands get no network, no config.json, no key anywhere (procargs), no profile key variables; trif works', { skip: !realCodex() && 'needs Codex 0.138+ (and a shell without another sandbox)' }, async () => {
  const cx = realCodex();
  // Its own made-up key: earlier tests' helpers (still running) hold FAKE_KEY in their environment.
  const KEY = `fake-real-key-${require('crypto').randomBytes(12).toString('hex')}`;
  const home = tempDir();
  const bin = path.join(home, 'agentbin');
  fs.mkdirSync(bin);
  fs.symlinkSync(cx.file, path.join(bin, 'codex'));
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sites', 'other.org'), { recursive: true });
  // The key is in the keyring (a stand-in for /usr/bin/security), as after the user saved it in the panel.
  const kc = makeFakeKeychain(path.join(tempDir(), 'kc')); // (outside the workspace, like the real one)
  // A key variable some (fake) shell profile still exports: the sandbox keeps the agent's login shell out
  // of the profiles, and the exclude globs keep it out of the environment Codex builds from its own
  // (unsandboxed) snapshot of that shell: without them, the commands get it (seen with Codex 0.166).
  const LEFTOVER = `leftover-${require('crypto').randomBytes(12).toString('hex')}`;
  const fakehome = path.join(home, 'fakehome');
  fs.mkdirSync(fakehome);
  for (const f of ['.zshenv', '.zprofile', '.zshrc']) fs.writeFileSync(path.join(fakehome, f), `export TTEST_OR_API_KEY='${LEFTOVER}'\n`);
  // A value the helper's own environment does hold: the procargs probe must find it, to show it works.
  const canary = `canary-${require('crypto').randomBytes(12).toString('hex')}`;
  // The user's message: on Codex's stdin, never in its argv (other processes could read it).
  const MESSAGE = `probe-${require('crypto').randomBytes(12).toString('hex')}`;
  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
  const probe = path.join(home, 'procargs-probe.py');
  fs.copyFileSync(path.join(__dirname, 'procargs-probe.py'), probe);
  const q = (s) => `'${s}'`;
  const node = process.execPath;
  const script = [
    { run: `${q(node)} ${q(CLI_JS)} tabs` },
    // (2>&1: curl's error and its output in one stream, in the order curl wrote them.)
    { run: 'curl -sS -m 5 -o /dev/null -w "%{http_code}" https://example.com 2>&1; echo " curl=$?"' },
    { run: 'LOCAL' }, // filled in below: curl to the model server itself
    { run: `cat ${q(path.join(privDir(home), 'config.json'))}; echo " cat=$?"` },
    { run: `echo '// mine' > ${q(path.join(home, 'sites', 'example.com', 'oss-probe.js'))} && echo WROTE-OWN` },
    { run: `echo x > ${q(path.join(home, 'sites', 'other.org', 'oss-probe.js'))}; echo " other=$?"` },
    { run: 'echo "key=[$TTEST_OR_API_KEY]"; env | grep -c TTEST_OR_API_KEY' },
    // Every same-user process's argv and environment (KERN_PROCARGS2, which the sandbox allows): no key.
    { run: `python3 -I ${q(probe)} ${sha(KEY)} ${KEY.length} ${sha(canary)} ${canary.length} ${sha(MESSAGE)} ${MESSAGE.length}` },
    { say: 'Done: probed.' },
  ];
  const srv = await startFakeModelServer({ script });
  cleanups.push(() => srv.close());
  script[2] = { run: `curl -sS -m 5 ${srv.url}/api/version 2>&1; echo " local=$?"` };
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: `${bin}:/usr/bin:/bin` }, openModel: { provider: 'custom', baseUrl: `${srv.url}/v1`, model: 'stand-in' }, secret: 'CONFIG-SECRET' }));
  await keyring.setKey(`custom:${new URL(srv.url).host}`, KEY, { env: kc.env });
  const ext = startHost(home, { ...kc.env, TTEST_CANARY: canary, TRIF_AGENT_TIMEOUT_MS: '100000' });
  ext.handlers.tabs = () => [{ id: 12, url: 'https://example.com/page', title: 'Example', active: true }];
  ext.hello();
  const r = await extRequest(ext, 'agent.start', { ...START, agent: 'codex-oss', prompt: MESSAGE });
  assert.equal(r.ok, true, r.error);
  const done = await waitDone(ext, r.result.runId, 100000);
  const evs = eventsOf(ext, r.result.runId);
  const out = srv.toolOutputs().join('\n----\n');
  const logTail = () => { try { return fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').split('\n').slice(-25).join('\n'); } catch { return '(no helper.log)'; } };
  const info = `events: ${JSON.stringify(evs).slice(0, 3000)}\nrequests to the model server: ${srv.requests.length} (POST ${srv.requests.filter((x) => x.method === 'POST').length} of ${script.length} steps)\noutputs:\n${out.slice(0, 4000)}\nhelper.log:\n${logTail()}`;
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
  const scan = /procargs scanned=(\d+) key=(\d+) canary=(\d+) prompt=(\d+)/.exec(out);
  assert.ok(scan, info);
  assert.ok(Number(scan[1]) > 10, info); // it could read other processes
  assert.ok(Number(scan[3]) >= 1, `the probe should find the canary in the helper's environment: ${info}`);
  assert.equal(scan[2], '0', `the key is in some process's argv or environment: ${info}`);
  assert.equal(scan[4], '0', `the user's message is in some process's argv: ${info}`);
  assert.ok(posts[0].body.input.some((i) => JSON.stringify(i).includes(MESSAGE)), 'the message did reach the model');
  assert.ok(!out.includes(KEY) && !out.includes(LEFTOVER));
  assert.ok(!kc.argvText().includes(KEY));
  assert.deepEqual(done.changedFiles, ['sites/example.com/oss-probe.js']);
  assert.ok(evs.some((e) => e.kind === 'text' && e.text === 'Done: probed.'));
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'runs', `${r.result.runId}.jsonl`), 'utf8').includes(KEY));
  assert.ok(!fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes(KEY));

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
