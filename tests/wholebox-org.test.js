'use strict';
// TRIF's full sandbox and an organization's policies (docs/WHOLE-BOX-PROGRESS.md step 5): what its managed
// settings name on the network (claude-managed.js orgNetwork) reaches the box's run, through TRIF's relay or
// as a port on this computer; hook scripts are readable in the box; the rest is noted. Stand-in settings in
// a scratch folder (CLAUDE_MANAGED_DIR's test form), never this computer's. The real thing on CI:
// tests/whole-box.test.js with TRIF_TEST_MANAGED=org.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const managed = require('../helper/lib/agents/claude-managed');
const claude = require('../helper/lib/agents/claude');
const wb = require('../helper/lib/wholebox');

const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wbo-')));

test('orgNetwork: https endpoints → the relay, this computer → a port, plain http elsewhere and their own proxies → noted; hook scripts', () => {
  const dir = temp();
  const script = path.join(dir, 'audit hook.sh');
  fs.writeFileSync(script, '#!/bin/sh\n');
  const n = managed.orgNetwork({
    env: {
      ANTHROPIC_BASE_URL: 'https://llm-gateway.corp.example/anthropic',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://otel.corp.example:4318/v1/metrics',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://collector.corp.example:4318',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'not a url',
      HTTPS_PROXY: 'http://proxy.corp.example:8080',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"${script}" --audit` }, { type: 'http', url: 'https://audit.corp.example/hook' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: '/no/such/script.sh; /bin/echo hi' }, { type: 'http', url: 'http://localhost:9000/hook' }] }],
      Bad: 'not a list',
    },
  });
  assert.deepStrictEqual(n.relay, [
    { host: 'llm-gateway.corp.example', port: 443, from: 'env ANTHROPIC_BASE_URL' },
    { host: 'otel.corp.example', port: 4318, from: 'env OTEL_EXPORTER_OTLP_METRICS_ENDPOINT' },
    { host: 'audit.corp.example', port: 443, from: 'hooks PreToolUse' },
  ]);
  assert.deepStrictEqual(n.ports, [{ port: 4318, from: 'env OTEL_EXPORTER_OTLP_ENDPOINT' }, { port: 9000, from: 'hooks SessionStart' }]);
  assert.deepStrictEqual(n.notes.map((x) => [x.from, x.why]), [
    ['env OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'plain http to another computer'],
    ['env OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'not a URL'],
  ]);
  // (their own proxy: a stop, round 8)
  assert.deepStrictEqual(n.stops, [{ kind: 'proxy', from: 'env HTTPS_PROXY', url: 'proxy.corp.example:8080', local: false }]);
  assert.deepStrictEqual(n.files, [script, '/bin/echo']);
  const none = { relay: [], ports: [], notes: [], files: [], stops: [], signIn: [] };
  assert.deepStrictEqual(managed.orgNetwork({}), none);
  assert.deepStrictEqual(managed.orgNetwork({ env: 'x', hooks: [1] }), none);
});

test('orgNetwork (round 8): every proxy variable stops a boxed run, one on this computer too; NO_PROXY noted', () => {
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const n = managed.orgNetwork({ env: { [k]: 'http://127.0.0.1:9000' } });
    assert.deepStrictEqual(n.stops, [{ kind: 'proxy', from: `env ${k}`, url: '127.0.0.1:9000', local: true }], k);
  }
  assert.deepStrictEqual(managed.orgNetwork({ env: { HTTPS_PROXY: 'socks5 nonsense' } }).stops[0].url, '(not a URL)');
  assert.deepStrictEqual(managed.orgNetwork({ env: { NO_PROXY: '.corp.example' } }).notes.map((x) => x.from), ['env NO_PROXY']);
  assert.match(claude.boxOrgMessage([{ kind: 'proxy', url: 'proxy.corp.example:8080', local: false }]), /through their own proxy \(proxy\.corp\.example:8080\), which TRIF's full sandbox can't let it reach/);
  assert.match(claude.boxOrgMessage([{ kind: 'proxy', url: '127.0.0.1:9000', local: true }]), /a proxy on this computer \(127\.0\.0\.1:9000\)/);
});

test('orgNetwork (round 8): their own sign-in (apiKeyHelper, a key in env, a cloud provider): its hosts through the relay; credentials only from the settings themselves', () => {
  const dir = temp();
  const helper = path.join(dir, 'get key.sh');
  fs.writeFileSync(helper, '#!/bin/sh\necho sk-ant-api03-made-up\n');
  let n = managed.orgNetwork({ apiKeyHelper: `"${helper}"`, env: { ANTHROPIC_API_KEY: 'x' } });
  assert.deepStrictEqual(n.signIn.map((x) => x.kind), ['apiKeyHelper', 'key']);
  assert.deepStrictEqual(n.files, [helper]);
  assert.deepStrictEqual(n.stops, []);
  // Bedrock: the region's hosts; keys in their env work; else this computer's sign-in (~/.aws): a stop
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'eu-west-1', AWS_BEARER_TOKEN_BEDROCK: 'made-up' } });
  assert.deepStrictEqual(n.relay.map((x) => x.host), ['bedrock-runtime.eu-west-1.amazonaws.com', 'bedrock.eu-west-1.amazonaws.com']);
  assert.deepStrictEqual(n.stops, []);
  assert.deepStrictEqual(n.signIn.map((x) => x.kind), ['bedrock']);
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: 'true', AWS_REGION: 'us-east-1' } });
  assert.deepStrictEqual(n.stops.map((x) => [x.kind, x.provider]), [['cloudSignIn', 'bedrock']]);
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' }, awsCredentialExport: `'${helper}' --json` });
  assert.deepStrictEqual(n.stops, []);
  assert.deepStrictEqual(n.files, [helper]);
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_SHARED_CREDENTIALS_FILE: '/x/creds' } });
  assert.deepStrictEqual(n.stops.map((x) => [x.from, x.why]), [['env AWS_SHARED_CREDENTIALS_FILE', 'a credentials file']]);
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1;evil.com', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1' } });
  assert.deepStrictEqual(n.relay, []);
  assert.deepStrictEqual(n.notes.map((x) => x.why), ['not a region']);
  // a base URL of theirs replaces the runtime host (it's an endpoint: the relay already has it)
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock-gw.corp.example', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1' } });
  assert.deepStrictEqual(n.relay.map((x) => x.host), ['bedrock-gw.corp.example', 'bedrock.us-east-1.amazonaws.com']);
  // Vertex: the region's host (global: aiplatform.googleapis.com; per-model regions too); gcloud's sign-in: a stop
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_VERTEX: '1', CLOUD_ML_REGION: 'global', VERTEX_REGION_CLAUDE_HAIKU_4_5: 'europe-west1', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1' } });
  assert.deepStrictEqual(n.relay.map((x) => x.host), ['aiplatform.googleapis.com', 'europe-west1-aiplatform.googleapis.com']);
  assert.deepStrictEqual(n.stops, []);
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_VERTEX: '1', GOOGLE_APPLICATION_CREDENTIALS: '/etc/sa.json' } });
  assert.deepStrictEqual(n.relay.map((x) => x.host), ['us-east5-aiplatform.googleapis.com']);
  assert.deepStrictEqual(n.stops.map((x) => x.why), ['a credentials file', 'sign-in from this computer (gcloud)']);
  assert.deepStrictEqual(n.files, [], 'a credentials file is never opened to the box');
  // Foundry: the resource's host; its key in their env, or a stop
  n = managed.orgNetwork({ env: { CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'Corp-AI', ANTHROPIC_FOUNDRY_API_KEY: 'k' } });
  assert.deepStrictEqual(n.relay.map((x) => x.host), ['corp-ai.services.ai.azure.com']);
  assert.deepStrictEqual(n.stops, []);
  assert.strictEqual(managed.orgNetwork({ env: { CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'a.b' } }).relay.length, 0);
  assert.match(claude.boxOrgMessage([{ kind: 'cloudSignIn', provider: 'bedrock', why: 'sign-in from this computer (~/.aws)' }]), /sign Claude Code in to Amazon Bedrock with this computer's own sign-in for it, which TRIF's full sandbox doesn't open/);
  assert.match(claude.boxOrgMessage([{ kind: 'cloudSignIn', provider: 'vertex', from: 'env GOOGLE_APPLICATION_CREDENTIALS', why: 'a credentials file' }]), /Google Vertex AI with a credentials file \(GOOGLE_APPLICATION_CREDENTIALS\)/);
});

test('runs.js in TRIF\'s full sandbox (round 8): their own proxy → nothing starts, the card offering the older protection; their own sign-in → no TRIF sign-in asked', async () => {
  const { Runs } = require('../helper/lib/runs');
  const ct = require('../helper/lib/claudetoken');
  const real = ct.prepareBoxed;
  try {
    for (const [settings, why] of [[{ env: { HTTPS_PROXY: 'http://proxy.corp.example:8080' } }, 'orgProxy'], [{ env: { CLAUDE_CODE_USE_VERTEX: '1' } }, 'orgSignIn']]) {
      const dir = temp();
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify(settings));
      const runs = new Runs({ getWorkspace: () => dir, withoutSandbox: { allowed: () => true, consents: () => ({}), guard: () => [] } });
      const events = [];
      let finished = false;
      let prepared = false;
      runs.onEvent = (id, e) => events.push(e);
      runs._finish = () => { finished = true; };
      runs._spawn = () => { throw new Error('must not start'); };
      runs._watchBox = () => Promise.resolve();
      ct.prepareBoxed = async () => { prepared = true; return {}; };
      const adapter = { ...claude, prepare: async () => ({}), preflight: () => managed.check({ dir, platform: 'darwin' }) };
      const run = { id: 'r2', agent: 'claude', adapter, ws: dir, wholeBox: true, logFile: path.join(dir, 'run.jsonl'), state: {}, secrets: [] };
      runs._withAgent(run, { available: true, path: '/p/claude' }, {});
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(finished && !prepared, why);
      const card = events.find((e) => e.reason === 'boxUnavailable');
      assert.strictEqual(card && card.why, why);
      assert.strictEqual(run.boxUnavailable, why);
      const log = fs.readFileSync(run.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(log.find((x) => x.webmods === 'orgNetwork').stops.length);
      assert.ok(log.find((x) => x.webmods === 'boxUnavailable'));
    }
    // an apiKeyHelper of theirs: the boxed prepare is told, so it asks for no TRIF sign-in
    const dir = temp();
    fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ apiKeyHelper: '/bin/echo made-up' }));
    const runs = new Runs({ getWorkspace: () => dir, withoutSandbox: { allowed: () => true, consents: () => ({}), guard: () => [] } });
    let opts = null;
    let spawned = false;
    runs._emit = () => {};
    runs._finish = () => {};
    runs._spawn = () => { spawned = true; };
    runs._watchBox = () => Promise.resolve();
    ct.prepareBoxed = async (o) => { opts = o; return { state: { signIn: 'organization' } }; };
    const adapter = { ...claude, prepare: async () => ({}), preflight: () => managed.check({ dir, platform: 'darwin' }) };
    const run = { id: 'r3', agent: 'claude', adapter, ws: dir, wholeBox: true, logFile: path.join(dir, 'run.jsonl'), state: {} };
    runs._withAgent(run, { available: true, path: '/p/claude' }, {});
    for (let i = 0; i < 20 && !spawned; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(spawned && opts.orgSignIn === true);
    const log = fs.readFileSync(run.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(log.find((x) => x.webmods === 'signIn'), { webmods: 'signIn', kind: 'organization', source: 'managed settings' });
  } finally { ct.prepareBoxed = real; }
});

test('check(): every source\'s network together; the relay takes those hosts; the box opens those ports and scripts', async () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.corp.example' } }));
  fs.mkdirSync(path.join(dir, 'managed-settings.d'));
  fs.writeFileSync(path.join(dir, 'managed-settings.d', '10-local.json'), JSON.stringify({ env: { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://localhost:4318' } }));
  const pre = managed.check({ dir, platform: 'darwin' });
  // (a drop-in's env merges over the file's: both endpoints)
  assert.deepStrictEqual(pre.network.relay.map((x) => [x.host, x.port]), [['otel.corp.example', 443]]);
  assert.deepStrictEqual(pre.network.ports.map((x) => x.port), [4318]);
  assert.deepStrictEqual(pre.loosens, []);
  // the relay: their host on their port, nothing else of theirs
  const relay = require('../helper/lib/relay');
  const r = await wb.startProxy({ hosts: [], allow: pre.network.relay, connect: () => { throw new Error('no internet here'); }, lookup: async () => [] });
  await r.close();
  assert.ok(wb.hostAllowed('api.anthropic.com:443') && !wb.hostAllowed('otel.corp.example:443'));
  assert.ok(relay.ruleFor(relay.normRules(pre.network.relay), 'otel.corp.example', 443));
  // the box: the port on this computer, the scripts readable
  const root = temp();
  const L = { workspace: path.join(root, 'ws'), box: path.join(root, 'box'), tmp: path.join(root, 'tmp'), writable: [path.join(root, 'ws', 'sites', 'example.com')], readable: [], modsDir: path.join(root, 'ws', 'sites') };
  const w = wb.wrap({ file: '/bin/echo', args: [], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:5555' } }, { limits: L, profileFile: path.join(root, 'box.sb'), platform: 'darwin', ports: [4318, 'x', 70000], extraRead: ['/opt/corp/audit.sh'] });
  assert.match(w.profile, /\(allow network-outbound \(remote tcp "localhost:5555"\)\)/);
  assert.match(w.profile, /\(allow network-outbound \(remote tcp "localhost:4318"\)\)/);
  assert.doesNotMatch(w.profile, /localhost:70000|localhost:NaN/);
  assert.match(w.profile, /\(subpath "\/opt\/corp\/audit\.sh"\)/);
});

test('runs.js in TRIF\'s full sandbox: an organization\'s network in the run\'s log, its hosts given to the relay, its ports and scripts to the box', async () => {
  const { Runs } = require('../helper/lib/runs');
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.corp.example:4318', ANTHROPIC_BASE_URL: 'http://192.0.2.1:80' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/bin/sh -c true' }] }] },
  }));
  const runs = new Runs({ getWorkspace: () => dir, withoutSandbox: { allowed: () => true, consents: () => ({}), guard: () => [] } });
  let spawned = null;
  runs._emit = () => {};
  runs._finish = () => {};
  runs._spawn = (run, found, env) => { spawned = env; };
  runs._watchBox = () => Promise.resolve();
  // (the boxed prepare's own tests: tests/claudetoken.test.js; here what runs.js hands it)
  const ct = require('../helper/lib/claudetoken');
  const real = ct.prepareBoxed;
  let given = null;
  ct.prepareBoxed = async (o) => { given = o.allow; return { env: { HTTPS_PROXY: 'http://127.0.0.1:1' } }; };
  try {
    const adapter = { ...claude, prepare: async () => ({}), preflight: () => managed.check({ dir, platform: 'darwin' }) };
    const run = { id: 'r1', agent: 'claude', adapter, ws: dir, wholeBox: true, logFile: path.join(dir, 'run.jsonl'), state: {} };
    runs._withAgent(run, { available: true, path: '/p/claude' }, {});
    for (let i = 0; i < 20 && !spawned; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(spawned, 'the run went on');
    assert.deepStrictEqual(given.map((x) => [x.host, x.port]), [['otel.corp.example', 4318]]);
    assert.deepStrictEqual(run.orgNetwork.files, ['/bin/sh']);
    const log = fs.readFileSync(run.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const note = log.find((x) => x.webmods === 'orgNetwork');
    assert.deepStrictEqual(note.relay, ['otel.corp.example:4318 (env OTEL_EXPORTER_OTLP_ENDPOINT)']);
    assert.deepStrictEqual(note.notes.map((x) => [x.url, x.why]), [['http://192.0.2.1', 'plain http to another computer']]);
  } finally { ct.prepareBoxed = real; }
});

test('races (old against full sandbox): a run\'s done line keeps its tokens and times (claude.js usageOf)', () => {
  assert.deepStrictEqual(claude.usageOf({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 'x' }, num_turns: 3, duration_ms: 4200, duration_api_ms: 3900 }),
    { input: 10, output: 5, cacheRead: 100, turns: 3, ms: 4200, apiMs: 3900 });
  assert.strictEqual(claude.usageOf({}), null);
  assert.strictEqual(claude.usageOf(null), null);
});
