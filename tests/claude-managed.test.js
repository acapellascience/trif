'use strict';
// Claude Code's managed settings (an organization's policy) against TRIF's side-panel runs
// (agents/claude-managed.js, claude.js preflight, runs.js): which settings loosen TRIF's limits (a run
// stops unless the user chose "Use Claude Code anyway"), which only break runs (stopped, with why), and
// which change nothing. Fixture files in scratch folders ($TRIF_CLAUDE_MANAGED_DIR, or `dir`): never the
// real system paths. Fake agents only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, tempDir, privDir } = require('./fake-extension');
const managed = require('../helper/lib/agents/claude-managed');
const claude = require('../helper/lib/agents/claude');
const consent = require('../helper/lib/withoutsandbox');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

/** A scratch managed-settings folder: {file: settings} (names under managed-settings.d/ too). */
function fixture(files) {
  const dir = tempDir('cm-');
  for (const [name, value] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}
const check = (files, opts = {}) => managed.check({ dir: fixture(files), platform: 'darwin', ...opts });

test('claude-managed: the system paths, and the test folder used instead of them in tests', () => {
  assert.equal(managed.systemDir('darwin'), '/Library/Application Support/ClaudeCode');
  assert.equal(managed.systemDir('linux'), '/etc/claude-code');
  assert.ok(process.env.TRIF_CLAUDE_MANAGED_DIR && !process.env.TRIF_CLAUDE_MANAGED_DIR.startsWith('/Library'), 'tests never read the real ones');
  const none = managed.check({ dir: fixture({}) });
  assert.deepEqual([none.loosens, none.breaks, none.sources], [[], [], []]);
});

test('claude-managed: settings that loosen TRIF\'s limits', () => {
  const cases = [
    [{ sandbox: { enabled: false } }, /turn Claude Code’s sandbox off/],
    [{ sandbox: { filesystem: { disabled: true } } }, /limits on files/],
    [{ sandbox: { allowUnsandboxedCommands: true } }, /outside the sandbox/],
    [{ sandbox: { excludedCommands: ['trif'] } }, /run `trif` outside the sandbox/],
    [{ sandbox: { excludedCommands: ['ls:*', 'docker'] } }, /run `ls:\*` outside/],
    [{ sandbox: { excludedCommands: ['*'] } }, /`\*` outside/],
    [{ sandbox: { autoAllowBashIfSandboxed: true } }, /any command in the sandbox/],
    [{ sandbox: { network: { allowedDomains: ['github.com'] } } }, /reach github\.com on the network/],
    [{ sandbox: { network: { allowedDomains: ['a.com', 'b.com'] } } }, /reach 2 websites/],
    [{ sandbox: { network: { allowUnixSockets: ['/var/run/docker.sock'] } } }, /connections on this computer/],
    [{ sandbox: { network: { allowLocalBinding: true } } }, /connections on this computer/],
    [{ sandbox: { filesystem: { allowWrite: ['~/'] } } }, /write more folders/],
    [{ sandbox: { filesystem: { allowRead: ['~/Documents'] } } }, /read more folders/],
    [{ permissions: { allow: ['Bash'] } }, /allow `Bash` without asking/],
    [{ permissions: { allow: ['Bash(npm test:*)', 'Read(//Users/**)', 'mcp__github', 'Edit'] } }, /allow `Bash\(npm test:\*\)`, `Read\(\/\/Users\/\*\*\)`, `mcp__github` and 1 more/],
    [{ permissions: { additionalDirectories: ['/srv'] } }, /file tools into more folders/],
    [{ permissions: { defaultMode: 'bypassPermissions' } }, /bypassPermissions mode/],
    [{ permissions: { defaultMode: 'acceptEdits' } }, /acceptEdits mode/],
  ];
  for (const [settings, want] of cases) {
    const r = check({ 'managed-settings.json': settings });
    assert.equal(r.breaks.length, 0, JSON.stringify(settings));
    assert.equal(r.loosens.length, 1, `${JSON.stringify(settings)}: ${JSON.stringify(r.loosens)}`);
    assert.match(r.loosens[0], want, JSON.stringify(settings));
  }
  // failIfUnavailable false: nothing on macOS, whose sandbox is always there; on Linux it can be missing.
  assert.deepEqual(check({ 'managed-settings.json': { sandbox: { failIfUnavailable: false } } }).loosens, []);
  assert.match(check({ 'managed-settings.json': { sandbox: { failIfUnavailable: false } } }, { platform: 'linux' }).loosens[0], /when it can’t start/);
});

test('claude-managed: settings that only break runs, and ones that change nothing', () => {
  const breaks = [
    [{ allowManagedPermissionRulesOnly: true }, /ignore every permission rule but theirs/],
    [{ permissions: { defaultMode: 'plan' } }, /plan mode/],
    [{ sandbox: { filesystem: { allowManagedReadPathsOnly: true } } }, /`trif` can’t run/],
  ];
  for (const [settings, want] of breaks) {
    const r = check({ 'managed-settings.json': settings });
    assert.deepEqual(r.loosens, [], JSON.stringify(settings));
    assert.equal(r.breaks.length, 1, JSON.stringify(settings));
    assert.match(r.breaks[0], want);
  }
  // Nothing: tools runs don't have (WebFetch, WebSearch: left out by --tools, and denied by TRIF), what
  // only restricts, the organization's own commands, a sandbox on.
  const r = check({ 'managed-settings.json': {
    permissions: { allow: ['WebFetch', 'WebSearch', 'WebFetch(domain:github.com)', 'Task'], deny: ['Bash(curl:*)'], defaultMode: 'default', disableBypassPermissionsMode: 'disable' },
    sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, excludedCommands: ['docker', 'git:*'], network: { allowManagedDomainsOnly: true } },
    allowManagedHooksOnly: true, hooks: { PreToolUse: [] }, apiKeyHelper: '/usr/local/bin/key', env: { HTTPS_PROXY: 'http://proxy:8080' }, model: 'opus',
  } });
  assert.deepEqual([r.loosens, r.breaks], [[], []]);
});

test('claude-managed: managed-settings.d drop-ins merge in order over the file; every source counts; broken files are reported', () => {
  // The drop-in turns the sandbox off after the file turned it on (later wins); lists combine.
  const r = check({
    'managed-settings.json': { sandbox: { enabled: true, network: { allowedDomains: ['a.com'] } } },
    'managed-settings.d/10-net.json': { sandbox: { network: { allowedDomains: ['b.com'] } } },
    'managed-settings.d/20-off.json': { sandbox: { enabled: false } },
    'managed-settings.d/.hidden.json': { permissions: { allow: ['Bash'] } },
    'managed-settings.d/notes.txt': 'not json',
  });
  assert.deepEqual(r.loosens, ['turn Claude Code’s sandbox off', 'let commands reach 2 websites on the network']);
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0], /managed-settings\.json, .*10-net\.json, .*20-off\.json$/);
  // A drop-in alone (no managed-settings.json) counts.
  assert.equal(check({ 'managed-settings.d/x.json': { sandbox: { enabled: false } } }).loosens.length, 1);
  // Server-managed settings (Claude Code's cache), wrapped or not, and the files: each on its own.
  const both = check({ 'remote-settings.json': { settings: { permissions: { allow: ['Bash'] } } }, 'managed-settings.json': { allowManagedPermissionRulesOnly: true } });
  assert.equal(both.loosens.length, 1);
  assert.equal(both.breaks.length, 1);
  assert.equal(check({ 'remote-settings.json': { sandbox: { enabled: false } } }).loosens.length, 1);
  // Broken: reported (Claude Code itself won't start with one), not taken as allowing anything.
  const bad = check({ 'managed-settings.json': '{ nope', 'managed-settings.d/a.json': '[1]', 'managed-settings.d/b.json': '' });
  assert.equal(bad.errors.length, 2, JSON.stringify(bad.errors));
  assert.deepEqual(bad.loosens, []);
  assert.deepEqual(managed.merge({ a: [1], b: { c: 1, d: 2 } }, { a: [1, 2], b: { d: 3 } }), { a: [1, 2], b: { c: 1, d: 3 } });
});

test('claude: the messages say what the organization\'s settings do', () => {
  const pre = { loosens: ['turn Claude Code’s sandbox off', 'let commands reach github.com on the network'], breaks: ['keep Claude Code in plan mode, where it can’t write mods'] };
  assert.equal(claude.withoutSandboxMessage(pre).split(', which')[0], "Your organization's Claude Code settings turn Claude Code’s sandbox off and let commands reach github.com on the network");
  assert.match(claude.brokenMessage(pre), /plan mode, where it can’t write mods, so chats with Claude Code can't work in TRIF's side panel\. Try another agent, or work with Claude Code in a terminal in ~\/\.trif\.$/);
  assert.match(claude.withoutSandboxMessage(pre), /A personal Claude Code login, or another agent, works with TRIF's sandbox\.$/);
  assert.equal(claude.orgBlockedMessage(), "Your company's Claude Code settings don't let Claude Code write mods or reach TRIF from the side panel, so chats can't work with them. Use a personal Claude Code login, try another agent, or work with Claude Code in a terminal in ~/.trif.");
  // No other agent by name.
  for (const t of [claude.withoutSandboxMessage(pre), claude.brokenMessage(pre), claude.orgBlockedMessage()]) assert.doesNotMatch(t, /Codex/, t);
  // Under the organization's settings, a tool result saying `trif` can't reach the helper.
  const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: "error: can't reach the helper through /b/r1: EACCES (has the agent run ended?)" }] } });
  assert.equal(claude.orgBlocked(line), 'helper');
  assert.equal(claude.orgBlocked(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'EROFS: read-only file system, open \'/u/.trif/sites/x.com/a.js\'' }] }] } })), 'write');
  assert.equal(claude.orgBlocked(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '3 mods' }] } })), null);
});

// ---- through the helper, with a fake Claude Code

function fakeClaude() {
  return `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('2.1.319 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log('{"loggedIn": true, "authMethod": "claude.ai"}'); process.exit(0); }
try { fs.readFileSync(0, 'utf8'); } catch {}
fs.mkdirSync(path.join(__dirname, 'calls'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'calls', Date.now() + '-' + process.pid), '');
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 's1' });
say({ type: 'result', subtype: 'success', is_error: false, result: 'made the mod', session_id: 's1', total_cost_usd: 0 });
`;
}

function makeHome(managedFiles) {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), fakeClaude(), { mode: 0o755 });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  const ext = new FakeExtension({ home, env: { TRIF_CLAUDE_MANAGED_DIR: fixture(managedFiles) } });
  cleanups.push(() => ext.close());
  ext.hello();
  return { home, bin, ext, calls: () => { try { return fs.readdirSync(path.join(bin, 'calls')).length; } catch { return 0; } } };
}
let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `c${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
const eventsOf = (ext, runId) => ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
const waitDone = (ext, runId) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done', { timeout: 20000 }).then((m) => m.event);
const START = { site: 'example.com', url: 'https://example.com/', tabId: 3, agent: 'claude', prompt: 'hide the banner' };

test('helper: Claude Code under managed settings that loosen TRIF\'s limits: stopped before it starts, the card; consent for claude (not codex) lets it go on, marked', async () => {
  const { home, ext, calls } = makeHome({ 'managed-settings.json': { sandbox: { enabled: false } } });
  consent.setAllowed(home, 'codex', true); // another agent's consent: not this one's
  const r1 = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d1 = await waitDone(ext, r1);
  assert.deepEqual([d1.ok, d1.error], [false, { kind: 'sandbox', agent: 'claude' }]);
  const card = eventsOf(ext, r1).find((e) => e.kind === 'error');
  assert.equal(card.reason, 'sandbox');
  assert.equal(card.settingsName, 'Claude Code');
  assert.deepEqual(card.why, ['turn Claude Code’s sandbox off']);
  assert.equal(calls(), 0, 'Claude Code never started');

  assert.equal((await extRequest(ext, 'agent.withoutSandbox', { agent: 'claude', allow: true })).ok, true);
  const r2 = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d2 = await waitDone(ext, r2);
  assert.equal(d2.ok, true, JSON.stringify(eventsOf(ext, r2)));
  assert.deepEqual(eventsOf(ext, r2).filter((e) => e.kind === 'sandbox'), [{ kind: 'sandbox', trif: false, agent: 'claude', name: 'Claude Code', settingsName: 'Claude Code' }]);
  assert.equal(calls(), 1);
});

test('helper: Claude Code under managed settings that only break runs: stopped with what they do, no card, no consent offered', async () => {
  const { home, ext, calls } = makeHome({ 'managed-settings.json': { allowManagedPermissionRulesOnly: true } });
  consent.setAllowed(home, 'claude', true); // even with it: the run couldn't work
  const r = (await extRequest(ext, 'agent.start', START)).result.runId;
  const d = await waitDone(ext, r);
  assert.equal(d.ok, false);
  assert.ok(!d.error, JSON.stringify(d));
  const errs = eventsOf(ext, r).filter((e) => e.kind === 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].reason, undefined);
  assert.match(errs[0].message, /^Your organization's Claude Code settings ignore every permission rule but theirs/);
  assert.equal(calls(), 0);
});
