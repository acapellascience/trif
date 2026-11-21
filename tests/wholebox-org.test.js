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
    ['env HTTPS_PROXY', 'a proxy of their own, in place of TRIF\'s relay'],
  ]);
  assert.deepStrictEqual(n.files, [script, '/bin/echo']);
  assert.deepStrictEqual(managed.orgNetwork({}), { relay: [], ports: [], notes: [], files: [] });
  assert.deepStrictEqual(managed.orgNetwork({ env: 'x', hooks: [1] }), { relay: [], ports: [], notes: [], files: [] });
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
