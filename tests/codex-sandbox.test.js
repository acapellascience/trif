'use strict';
// An organization's Codex settings can refuse TRIF's permission profile (codex.js sandboxOverridden,
// runs.js _checkSandbox). Without the user's consent such a run is stopped; with it (a click in the side
// panel: helper/lib/withoutsandbox.js, host.js agent.withoutSandbox) it goes on, marked; and when the
// organization's profile turns out to stop the run's work (`trif` can't reach the helper, writes to sites/
// refused), it's ended with why. Fake agents only, in a scratch home.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, tempDir, privDir } = require('./fake-extension');
const codex = require('../helper/lib/agents/codex');
const codexOss = require('../helper/lib/agents/codex-oss');
const consent = require('../helper/lib/withoutsandbox');
const { Runs } = require('../helper/lib/runs');

const SAID = 'Configured value for permission_profile is disallowed by requirements; falling back from trif-run to required value CodexStandard';

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

test("codex: an organization's override of TRIF's profile is recognised, ordinary noise isn't", () => {
  assert.equal(codex.sandboxOverridden(SAID), true);
  assert.equal(codex.sandboxOverridden(`{"type":"error","message":"${SAID}"}`), true);
  for (const s of ['Reconnecting... 2/5 (stream disconnected)', 'Falling back from WebSockets to HTTPS transport.', '', null]) {
    assert.equal(codex.sandboxOverridden(s), false, String(s));
  }
  const m = codex.sandboxOverriddenMessage(SAID);
  assert.match(m, /stopped the run/);
  assert.match(m, /CodexStandard/);
  // The open-model agent is the same Codex: the same check.
  assert.equal(codexOss.sandboxOverridden(SAID), true);
  assert.equal(codexOss.settingsName, 'Codex');
});

// A Runs with stand-ins for what _checkSandbox uses; `allowed`: the agents with consent.
function bareRuns(allowed = []) {
  const emitted = [];
  const r = new Runs({ getWorkspace: () => ({}), logger: { warn() {}, info() {} }, onEvent: (id, ev) => emitted.push(ev),
    withoutSandbox: { allowed: (a) => allowed.includes(a), consents: () => ({}), guard: () => [] } });
  r.killed = 0;
  r._kill = () => { r.killed++; };
  r._log = () => {};
  return { r, emitted, run: (adapter = codex) => ({ id: 'r1', agent: adapter.id, adapter, secrets: [], doneSent: false }) };
}

test('runs: without consent, a run whose sandbox was overridden is stopped with why, and never reports success', () => {
  const { r, emitted, run: mk } = bareRuns();
  const run = mk();
  assert.equal(r._checkSandbox(run, 'ordinary output'), false);
  assert.equal(r._checkSandbox(run, SAID), true);
  assert.equal(r.killed, 1);
  assert.equal(run.agentDone.ok, false);
  assert.equal(emitted[0].kind, 'error');
  assert.equal(emitted[0].reason, 'sandbox', 'the panel shows its choice card for it');
  assert.equal(emitted[0].agent, 'codex');
  assert.match(emitted[0].message, /organization's Codex settings/);
  assert.equal(r._checkSandbox(run, SAID), false, 'only once');
  assert.ok(!run.withoutSandbox);
});

test('runs: with consent for that agent, the run goes on with one "sandbox" event; consent is per agent', () => {
  const { r, emitted, run: mk } = bareRuns(['codex']);
  const run = mk();
  assert.equal(r._checkSandbox(run, SAID), true, 'the line itself stays out of the chat');
  assert.equal(r._checkSandbox(run, SAID), true);
  assert.equal(r.killed, 0);
  assert.equal(run.withoutSandbox, true);
  assert.equal(run.agentDone, undefined);
  assert.deepEqual(emitted, [{ kind: 'sandbox', trif: false, agent: 'codex', name: 'Codex', settingsName: 'Codex' }]);
  // Consent for codex isn't consent for codex-oss.
  const other = mk(codexOss);
  assert.equal(r._checkSandbox(other, SAID), true);
  assert.equal(other.sandboxRefused, true);
  assert.equal(emitted.at(-1).reason, 'sandbox');
});

test('runs: a run allowed without the sandbox whose organization blocks its work is ended once, plainly', () => {
  const blocked = [
    { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'trif mods', exit_code: 1, status: 'failed',
      aggregated_output: "error: can't reach the helper through /Users/u/Library/Caches/TRIF/boxes/r1: EPERM (has the agent run ended?)" } },
    { type: 'item.completed', item: { id: 'c2', type: 'file_change', status: 'failed', changes: [{ path: '/Users/u/.trif/sites/x.com/a.js', kind: 'add' }] } },
    { type: 'item.completed', item: { id: 'c3', type: 'command_execution', command: 'cat > sites/x.com/a.js', status: 'failed', aggregated_output: 'zsh: operation not permitted: sites/x.com/a.js' } },
    { type: 'item.completed', item: { id: 'c4', type: 'agent_message', text: "I can't save the mod: the workspace is read-only." } },
  ];
  for (const line of blocked) assert.ok(codex.orgBlocked(JSON.stringify(line)), JSON.stringify(line));
  for (const line of [
    { type: 'item.completed', item: { id: 'c5', type: 'command_execution', command: 'trif mods', status: 'completed', aggregated_output: '2 mods' } },
    { type: 'item.completed', item: { id: 'c6', type: 'command_execution', command: 'ls /etc', status: 'failed', aggregated_output: 'ls: /etc/x: Permission denied' } },
    { type: 'turn.completed' },
  ]) assert.equal(codex.orgBlocked(JSON.stringify(line)), null, JSON.stringify(line));

  const { r, emitted, run: mk } = bareRuns(['codex']);
  const run = mk();
  run.state = {};
  r._checkSandbox(run, SAID);
  r._onLine(run, JSON.stringify(blocked[0]));
  r._onLine(run, JSON.stringify(blocked[1]));
  r._onLine(run, JSON.stringify({ type: 'turn.completed', usage: {} }));
  const errors = emitted.filter((e) => e.kind === 'error');
  assert.equal(errors.length, 1, 'once per run');
  assert.equal(errors[0].reason, 'orgBlocked');
  assert.equal(errors[0].message, "Your company's Codex settings don't let Codex write mods or reach TRIF from the side panel, so chats can't work with this login. Use Claude Code or a personal Codex login in TRIF, or work with Codex in a terminal in ~/.trif.");
  assert.equal(r.killed, 1);
  assert.equal(run.agentDone.ok, false, "a turn.completed after it doesn't make it a success");
  // A run under TRIF's own sandbox isn't judged this way (its refusals are TRIF's own limits).
  const plain = mk();
  plain.state = {};
  r._onLine(plain, JSON.stringify(blocked[0]));
  assert.ok(!plain.orgBlocked);
});

// ---- through the helper, with a fake Codex

// A fake `codex` that says what an organization's requirements make Codex say, then (if still alive a
// moment later) answers. `mode` in a file beside it: 'ok' (works), 'blocked' (its `trif` can't reach the
// helper). Each run leaves a file in calls/.
function fakeCodex() {
  return `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('codex-cli 0.166.0'); process.exit(0); }
if (argv[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
try { fs.readFileSync(0, 'utf8'); } catch {}
fs.mkdirSync(path.join(__dirname, 'calls'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'calls', Date.now() + '-' + process.pid), '');
const mode = (() => { try { return fs.readFileSync(path.join(__dirname, 'mode'), 'utf8').trim(); } catch { return 'ok'; } })();
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stderr.write(${JSON.stringify(SAID)} + '\\n');
setTimeout(() => {
  say({ type: 'thread.started', thread_id: 't1' });
  if (mode === 'blocked') say({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'trif mods', exit_code: 1, status: 'failed', aggregated_output: "error: can't reach the helper through " + process.env.TRIF_RUN_BOX + ': EPERM (has the agent run ended?)' } });
  setTimeout(() => {
    say({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'made the mod' } });
    say({ type: 'turn.completed', usage: {} });
  }, mode === 'ok' ? 0 : 1500);
}, 800);
`;
}

function makeHome() {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'codex'), fakeCodex(), { mode: 0o755 });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  return { home, bin };
}
let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `s${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
const eventsOf = (ext, runId) => ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
const waitDone = (ext, runId) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout: 20000 }).then((m) => m.event);
const START = { site: 'example.com', url: 'https://example.com/', tabId: 3, agent: 'codex', prompt: 'hide the banner' };
const config = (home) => JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8'));

function socketRequest(sock, req) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sock);
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', (d) => { buf += d; const nl = buf.indexOf('\n'); if (nl >= 0) { c.destroy(); resolve(JSON.parse(buf.slice(0, nl))); } });
    c.on('error', reject);
    c.write(JSON.stringify(req) + '\n');
  });
}

test('helper: no consent stops the run (the choice card\'s event); "Use Codex anyway" stores it privately; the same message then goes on, marked; Stop allowing removes it', async () => {
  const { home } = makeHome();
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  ext.hello();

  // No consent: stopped before the fake answers, with the card's event and done.error.
  const r1 = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d1 = await waitDone(ext, r1);
  assert.equal(d1.ok, false);
  assert.deepEqual(d1.error, { kind: 'sandbox', agent: 'codex' });
  const ev1 = eventsOf(ext, r1);
  const card = ev1.find((e) => e.kind === 'error');
  assert.equal(card.reason, 'sandbox');
  assert.equal(card.settingsName, 'Codex');
  assert.ok(!ev1.some((e) => e.kind === 'text' || e.kind === 'sandbox'), JSON.stringify(ev1));
  assert.equal(config(home).withoutSandbox, undefined, 'nothing stored');

  // "Use Codex anyway": in config.json in the private folder, never the workspace.
  const allow = await extRequest(ext, 'agent.withoutSandbox', { agent: 'codex', allow: true });
  assert.equal(allow.ok, true, allow.error);
  assert.deepEqual(allow.result.agents, ['codex']);
  assert.ok(config(home).withoutSandbox.codex.at);
  assert.ok(!fs.readdirSync(home).includes('config.json'));
  const list = (await extRequest(ext, 'agent.list')).result.agents;
  assert.equal(list.find((a) => a.id === 'codex').withoutSandbox, true);
  assert.ok(!list.find((a) => a.id === 'claude').withoutSandbox);

  // The same message again: goes on, with the marker, and finishes.
  const r2 = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d2 = await waitDone(ext, r2);
  assert.equal(d2.ok, true, JSON.stringify(eventsOf(ext, r2)));
  assert.equal(d2.withoutSandbox, true);
  const ev2 = eventsOf(ext, r2);
  assert.deepEqual(ev2.filter((e) => e.kind === 'sandbox'), [{ kind: 'sandbox', trif: false, agent: 'codex', name: 'Codex', settingsName: 'Codex' }]);
  assert.ok(ev2.some((e) => e.kind === 'text' && e.text === 'made the mod'));
  assert.ok(!ev2.some((e) => e.kind === 'error'), JSON.stringify(ev2));
  assert.match(fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8'), /runs under the organization's settings, not TRIF's sandbox/);

  // Stop allowing: gone, and the next run is stopped again.
  const off = await extRequest(ext, 'agent.withoutSandbox', { agent: 'codex', allow: false });
  assert.deepEqual(off.result.agents, []);
  assert.equal(config(home).withoutSandbox, undefined);
  const r3 = (await extRequest(ext, 'agent.start', START)).result.runId;
  assert.equal((await waitDone(ext, r3)).error.kind, 'sandbox');
});

test('helper: agent.withoutSandbox is refused from the socket (the terminal, `trif` in a run, with a token or not) and from a run\'s mailbox', async () => {
  const { home, bin } = makeHome();
  fs.writeFileSync(path.join(bin, 'mode'), 'slow');
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  ext.hello();
  await ext.waitForSocket();
  for (const req of [{ id: 1, cmd: 'agent.withoutSandbox', args: { agent: 'codex', allow: true } }, { id: 2, cmd: 'agent.withoutSandbox', args: { agent: 'claude', allow: true }, token: 'whatever' }]) {
    const r = await socketRequest(ext.sock, req);
    assert.equal(r.ok, false);
    assert.match(r.error, /only a click in TRIF's side panel/);
  }
  // From a live run's mailbox (what `trif` inside the run uses): the same refusal.
  consent.setAllowed(home, 'codex', true); // (so the fake run stays alive a moment)
  const runId = (await extRequest(ext, 'agent.start', { ...START, prompt: 'x' })).result.runId;
  const box = path.join(home, 'boxes', runId);
  for (let i = 0; i < 100 && !fs.existsSync(box); i++) await new Promise((res) => setTimeout(res, 20));
  assert.ok(fs.existsSync(box), 'the run has a mailbox');
  consent.setAllowed(home, 'codex', false);
  fs.writeFileSync(path.join(box, 'q1.req'), JSON.stringify({ id: 'q1', cmd: 'agent.withoutSandbox', args: { agent: 'claude', allow: true } }));
  let res = null;
  for (let i = 0; i < 100 && !res; i++) { try { res = JSON.parse(fs.readFileSync(path.join(box, 'q1.res'), 'utf8')); } catch { await new Promise((r) => setTimeout(r, 20)); } }
  assert.ok(res, 'answered');
  assert.equal(res.ok, false);
  assert.match(res.error, /only a click in TRIF's side panel/);
  await waitDone(ext, runId);
  assert.equal(config(home).withoutSandbox, undefined, 'nothing stored by any of them');
  // A bad agent or value from the panel: refused too, nothing stored.
  assert.equal((await extRequest(ext, 'agent.withoutSandbox', { agent: 'other', allow: true })).ok, false);
  assert.equal((await extRequest(ext, 'agent.withoutSandbox', { agent: 'codex', allow: 'yes' })).ok, false);
  assert.equal(config(home).withoutSandbox, undefined);
});

test('helper: with consent, a run the organization\'s profile keeps from reaching TRIF is ended with why, once', async () => {
  const { home, bin } = makeHome();
  fs.writeFileSync(path.join(bin, 'mode'), 'blocked');
  consent.setAllowed(home, 'codex', true);
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  ext.hello();
  const runId = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d = await waitDone(ext, runId);
  assert.equal(d.ok, false);
  const ev = eventsOf(ext, runId);
  const errors = ev.filter((e) => e.kind === 'error');
  assert.equal(errors.length, 1, JSON.stringify(ev));
  assert.equal(errors[0].reason, 'orgBlocked');
  assert.match(errors[0].message, /^Your company's Codex settings don't let Codex write mods or reach TRIF/);
  assert.ok(!ev.some((e) => e.kind === 'text'), 'ended before its reply');
});

test('consent: per agent, only known agents, and one a run without the sandbox slipped in is taken out after it', () => {
  const home = tempDir();
  privDir(home);
  assert.deepEqual(consent.consents(home), {});
  consent.setAllowed(home, 'codex', true);
  assert.equal(consent.allowed(home, 'codex'), true);
  assert.equal(consent.allowed(home, 'codex-oss'), false);
  assert.equal(consent.allowed(home, 'claude'), false);
  assert.throws(() => consent.setAllowed(home, '__proto__', true));
  const before = consent.consents(home);
  // A run under an organization's settings that could write the private folder adds one for claude.
  const file = path.join(privDir(home), 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.withoutSandbox.claude = { at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(cfg));
  assert.deepEqual(consent.guard(home, before), ['claude']);
  assert.deepEqual(Object.keys(consent.consents(home)), ['codex']);
  // One stored from the panel meanwhile stays.
  consent.setAllowed(home, 'codex-oss', true);
  assert.deepEqual(consent.guard(home, before), []);
  assert.deepEqual(Object.keys(consent.consents(home)).sort(), ['codex', 'codex-oss']);
  consent.setAllowed(home, 'codex', false);
  consent.setAllowed(home, 'codex-oss', false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).withoutSandbox, undefined);
});

test("runs' sandboxes deny the private folder (where the consent is) in the normal case: Codex's profile and Claude Code's", () => {
  const claude = require('../helper/lib/agents/claude');
  const { runLimits } = require('../helper/lib/runs');
  const P = require('../helper/lib/paths');
  const h = fs.realpathSync(tempDir());
  const trif = path.join(h, '.trif');
  fs.mkdirSync(path.join(trif, 'sites'), { recursive: true });
  const box = path.join(h, 'Library', 'Caches', 'TRIF', 'boxes', 'r1');
  fs.mkdirSync(box, { recursive: true });
  const old = process.env.HOME;
  process.env.HOME = h;
  try {
    const ws = P.workspace(trif);
    const cfg = path.join(ws.private, 'config.json');
    const shots = path.join(ws.private, 'screenshots', 'x.com');
    const lim = runLimits(ws, { scope: 'x.com', box, screenshots: shots });
    const inside = (p, d) => p === d || p.startsWith(d + path.sep);
    const realCfg = path.join(lim.privateDir, 'config.json');
    assert.ok(lim.denied.includes(lim.privateDir));
    assert.ok(!lim.readable.some((r) => inside(realCfg, r)), 'config.json is in nothing readable');
    assert.ok(!lim.writable.some((w) => inside(realCfg, w)), 'nor anything writable');
    assert.ok(lim.writable.filter((w) => inside(w, lim.privateDir)).every((w) => inside(w, path.join(lim.privateDir, 'screenshots'))), 'only the run\'s screenshots folder in it');
    const perm = codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).args.find((a) => a.startsWith('permissions='));
    assert.ok(perm.includes(`${JSON.stringify(lim.privateDir)} = "deny"`));
    assert.ok(!perm.includes(`${JSON.stringify(realCfg)} = "write"`));
    const settings = JSON.parse(claude.command({ bin: '/x/claude', prompt: 'P', ...lim }).files[0].content);
    assert.ok(settings.sandbox.filesystem.denyRead.includes(lim.privateDir));
    assert.ok(!settings.sandbox.filesystem.allowWrite.some((w) => inside(realCfg, w)));
    assert.ok(!inside(realCfg, lim.workspace) && !inside(cfg, ws.home), 'not in the workspace, which Claude Code\'s commands may write in part');
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  } finally { process.env.HOME = old; }
});
