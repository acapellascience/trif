'use strict';
// docs/WHOLE-BOX.md step 7: TRIF's full sandbox under an organization that forces Claude Code's own sandbox
// on. That sandbox can't start inside TRIF's box, so such a run gets no Bash and the `trif` tool instead
// (helper/mcp.js, with no launcher: already in the box). The parts, without a real Claude Code; the real
// run is tests/run-sandbox.test.js on CI (TRIF_WHOLE_BOX=1, TRIF_TEST_MANAGED=sandbox-on…).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const managed = require('../helper/lib/agents/claude-managed');
const claude = require('../helper/lib/agents/claude');
const agents = require('../helper/lib/agents');
const mcp = require('../helper/mcp');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trif-noshell-'));

test('managed settings: a forced sandbox is noticed; MCP allowlists and denylists that leave out TRIF\'s trif tool are named', () => {
  const e = (s) => managed.effects(s, { platform: 'darwin' });
  assert.deepStrictEqual([e({}).forcesSandbox, e({}).mcpBlocks], [false, []]);
  assert.equal(e({ sandbox: { enabled: true, failIfUnavailable: true } }).forcesSandbox, true);
  assert.equal(e({ sandbox: { enabled: false } }).forcesSandbox, false);
  assert.deepStrictEqual(e({ sandbox: { enabled: true } }).loosens, [], 'forcing it on loosens nothing');
  assert.equal(e({ allowedMcpServers: [{ serverName: 'github' }] }).mcpBlocks.length, 1);
  assert.equal(e({ allowedMcpServers: [] }).mcpBlocks.length, 1, 'an empty allowlist allows none');
  assert.deepStrictEqual(e({ allowedMcpServers: [{ serverName: 'github' }, { serverName: 'trif' }] }).mcpBlocks, []);
  assert.equal(e({ allowManagedMcpServersOnly: true }).mcpBlocks.length, 1);
  assert.deepStrictEqual(e({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'trif' }] }).mcpBlocks, []);
  assert.match(e({ deniedMcpServers: [{ serverName: 'trif' }] }).mcpBlocks.join(), /deny TRIF’s `trif` tool/);
  assert.deepStrictEqual(e({ deniedMcpServers: [{ serverName: 'other' }] }).mcpBlocks, []);
  // Across sources: one forcing it, another denying the tool.
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
  fs.writeFileSync(path.join(dir, 'remote-settings.json'), JSON.stringify({ deniedMcpServers: [{ serverName: 'trif' }] }));
  const pre = managed.check({ dir, platform: 'darwin' });
  assert.equal(pre.sources.length, 2, `both sources read: ${JSON.stringify(pre)}`);
  assert.equal(pre.forcesSandbox, true);
  assert.equal(pre.mcpBlocks.length, 1);
  assert.deepStrictEqual(pre.breaks, [], 'not a break for runs with a shell');
  assert.match(claude.noShellBrokenMessage(pre), /^Your organization's Claude Code settings require Claude Code's own sandbox, which can't start inside TRIF's full sandbox, and deny TRIF’s `trif` tool, which would take its place, so this chat can't run in TRIF's full sandbox\. /);
});

test('Claude Code with no shell: no Bash among its tools nor its rules, the trif tool allowed, its server the only one; with a shell, as before', () => {
  const server = { command: '/n/node', args: ['/t/helper/mcp.js', '/b/r1.agent/trif-tool.json'] };
  const c = claude.command({ bin: '/p/claude', prompt: 'p', workspace: '/b/r1.ws', agentDir: '/b/r1.agent', mcp: server, wholeBox: true });
  const after = (flag) => { const i = c.args.indexOf(flag); const out = []; for (let j = i + 1; j < c.args.length && !c.args[j].startsWith('--'); j++) out.push(c.args[j]); return out; };
  assert.deepStrictEqual(after('--tools'), ['Read,Edit,Write,Glob,Grep']);
  assert.deepStrictEqual(after('--allowedTools'), ['Read(//b/r1.ws/**)', 'Edit(//b/r1.ws/sites/**)', 'mcp__trif__trif']);
  assert.ok(!c.args.some((a) => /^Bash/.test(a)));
  assert.ok(c.args.includes('--strict-mcp-config'));
  assert.deepStrictEqual(after('--mcp-config'), ['/b/r1.agent/mcp.json']);
  const files = Object.fromEntries(c.files.map((f) => [path.basename(f.path), f.content]));
  assert.deepStrictEqual(JSON.parse(files['mcp.json']), { mcpServers: { trif: server } });
  assert.equal(JSON.parse(files['settings.json']).sandbox.enabled, false, 'Claude Code\'s own sandbox off in the box, as with a shell (the organization\'s setting outranks it)');
  const withShell = claude.command({ bin: '/p/claude', prompt: 'p', workspace: '/b/r1.ws', agentDir: '/b/r1.agent', wholeBox: true });
  assert.ok(withShell.args.includes('Read,Edit,Write,Glob,Grep,Bash') && !withShell.args.includes('--mcp-config') && withShell.args.includes('Bash(trif:*)'));
  assert.equal(withShell.files.length, 1);
  // Its steps read as a shell's would: "trif check sites/x.com/a.js".
  const got = [];
  claude.parse(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__trif__trif', input: { args: ['check', 'sites/x.com/a.js'] } }] } }), (e) => got.push(e), { workspace: '/b/r1.ws' });
  assert.deepStrictEqual(got, [{ kind: 'tool', name: 'Bash', summary: 'trif check sites/x.com/a.js' }]);
  // What the run is told.
  assert.match(agents.contextText({ url: 'https://x.com/', scope: 'x.com', noShell: true }), /There is no shell in this chat\. Wherever AGENTS\.md says to run `trif <words>`, call the `trif` tool.*own file tools.*no `ls`, `cd` or `cat`\.$/);
  assert.ok(!/no shell/.test(agents.contextText({ url: 'https://x.com/', scope: 'x.com' })));
});

function client(config) {
  const input = new PassThrough();
  const output = new PassThrough();
  const got = [];
  let buf = '';
  output.setEncoding('utf8');
  output.on('data', (d) => { buf += d; for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { got.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  mcp.serve(config, { input, output });
  let n = 0;
  return {
    async call(method, params) {
      const id = ++n;
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      const t0 = Date.now();
      for (;;) {
        const m = got.find((x) => x.id === id);
        if (m) return m;
        if (Date.now() - t0 > 20000) throw new Error(`no answer to ${method}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    close: () => input.end(),
  };
}

test('the trif tool with no launcher (macOS, already in the box): its words reach TRIF\'s command as they are, with the run\'s variables, in its working folder; failures and bad input said so', async () => {
  const dir = temp();
  const work = path.join(dir, 'r1.ws');
  fs.mkdirSync(work);
  const cli = path.join(dir, 'cli.js');
  fs.writeFileSync(cli, 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => { const a = process.argv.slice(2); process.stdout.write(JSON.stringify({ args: a, stdin: s, cwd: process.cwd(), box: process.env.TRIF_RUN_BOX || null })); if (a[0] === "fail") { process.stderr.write("trif: no such thing\\n"); process.exit(3); } });');
  const config = { node: process.execPath, cli, version: '9.9.9', env: { TRIF_RUN_BOX: path.join(dir, 'r1') }, cwd: work };
  assert.deepStrictEqual(mcp.readConfig((() => { const f = path.join(dir, 'c.json'); fs.writeFileSync(f, JSON.stringify(config)); return f; })()).cli, cli, 'a config with no launcher is fine');
  assert.throws(() => mcp.readConfig((() => { const f = path.join(dir, 'd.json'); fs.writeFileSync(f, JSON.stringify({ ...config, launcher: { file: '/x' } })); return f; })()), /no spec/, 'a launcher needs its spec');
  const c = client(config);
  try {
    const init = await c.call('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, 'trif');
    const list = await c.call('tools/list', {});
    assert.deepStrictEqual(list.result.tools.map((t) => t.name), ['trif'], 'no file tools: Claude Code has its own');
    const odd = ['run', '--tab', '12', 'a b; $(touch x) | "q"', '*'];
    const r = await c.call('tools/call', { name: 'trif', arguments: { args: odd, stdin: 'from stdin' } });
    assert.equal(r.result.isError, false, JSON.stringify(r));
    const seen = JSON.parse(r.result.content[0].text);
    assert.deepStrictEqual(seen.args, odd, 'each word one argument, no shell');
    assert.equal(seen.stdin, 'from stdin');
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(work));
    assert.equal(seen.box, path.join(dir, 'r1'));
    assert.ok(!fs.existsSync(path.join(work, 'x')) && !fs.existsSync('x'));
    const bad = await c.call('tools/call', { name: 'trif', arguments: { args: ['fail'] } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /no such thing[\s\S]*\(exit status 3\)/);
    const wrong = await c.call('tools/call', { name: 'trif', arguments: { args: 'status' } });
    assert.match(wrong.result.content[0].text, /must be a list of words/);
    const other = await c.call('tools/call', { name: 'read_file', arguments: { path: 'x' } });
    assert.equal(other.error.code, -32602, 'no file tools without `files`');
  } finally { c.close(); }
});

// docs/WHOLE-BOX.md step 7a (Tim 11-21): in TRIF's full sandbox, settings that only loosen Claude Code's rules
// are logged, never asked about; settings that let runs use any command get no shell (the run's sign-in
// token is in its environment); settings that break runs still stop them.
test('managed settings: which ones let a run use any command (no shell in TRIF\'s full sandbox)', () => {
  const e = (s) => managed.effects(s, { platform: 'darwin' }).anyCommand;
  const allow = (...rules) => e({ permissions: { allow: rules } });
  assert.deepStrictEqual(e({}), []);
  assert.deepStrictEqual(allow('Bash'), ['allow `Bash` without asking']);
  assert.deepStrictEqual(allow('Bash(*)'), ['allow `Bash(*)` without asking']);
  assert.equal(allow('Bash(git:*)').length, 1, 'any other command (git runs any other through its aliases)');
  assert.equal(allow('Bash(trif && env)').length, 1, 'shell operators, whatever the first word');
  assert.equal(allow('Bash(trif $(env))').length, 1);
  assert.deepStrictEqual(allow('Bash(trif:*)', 'Bash(ls *)', 'Bash(cd:*)', 'Bash(webmods status)'), [], 'TRIF\'s own commands');
  assert.deepStrictEqual(allow('Read(//**)', 'Edit(//**)', 'Write(//**)', 'Glob', 'Grep', 'mcp__x__y'), [], 'not commands');
  assert.equal(e({ permissions: { defaultMode: 'bypassPermissions' } }).length, 1);
  assert.equal(e({ permissions: { defaultMode: 'auto' } }).length, 1);
  assert.deepStrictEqual(e({ permissions: { defaultMode: 'acceptEdits' } }), [], 'acceptEdits approves file commands only');
  assert.deepStrictEqual(e({ sandbox: { enabled: false, autoAllowBashIfSandboxed: true, excludedCommands: ['*'] } }), [], 'Claude Code\'s sandbox settings: off in the box anyway');
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)'], defaultMode: 'bypassPermissions' } }));
  fs.writeFileSync(path.join(dir, 'remote-settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)'] } }));
  const pre = managed.check({ dir, platform: 'darwin' });
  assert.deepStrictEqual(pre.anyCommand, ['allow `Bash(*)` without asking', 'approve Claude Code’s actions by themselves (bypassPermissions mode)'], 'both sources, no duplicates');
  assert.match(claude.noShellBrokenMessage({ ...pre, mcpBlocks: ['deny TRIF’s `trif` tool'] }), /^Your organization's Claude Code settings let Claude Code run any command, so in TRIF's full sandbox this chat gets TRIF's `trif` tool in place of a shell, but they also deny TRIF’s `trif` tool, so this chat can't run in TRIF's full sandbox\. Turning off/);
});

test('runs.js in TRIF\'s full sandbox: loosening settings are logged, not asked about, and the chat isn\'t marked; any command → no shell; the trif tool taken away → stopped; outside the box, asked as before', () => {
  const { Runs } = require('../helper/lib/runs');
  const go = (settings, { wholeBox = true } = {}) => {
    const dir = temp();
    fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify(settings));
    let asked = 0;
    const runs = new Runs({ getWorkspace: () => dir, withoutSandbox: { allowed: () => { asked++; return true; }, consents: () => ({}), guard: () => [] } });
    const out = { events: [], spawned: false, finished: false };
    runs._emit = (run, ev) => out.events.push(ev);
    runs._finish = () => { out.finished = true; };
    runs._kill = () => {};
    runs._spawn = () => { out.spawned = true; };
    const adapter = { ...claude, prepare: undefined, preflight: () => managed.check({ dir, platform: 'darwin' }) };
    const run = { id: 'r1', agent: 'claude', adapter, ws: dir, wholeBox, logFile: path.join(dir, 'run.jsonl'), state: {} };
    runs._withAgent(run, { available: true, path: '/p/claude' }, {});
    const log = fs.existsSync(run.logFile) ? fs.readFileSync(run.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    return { ...out, asked, run, log };
  };
  // Only loosening (sandbox off, more folders, acceptEdits): a shell, no question, not marked, logged.
  const loose = go({ sandbox: { enabled: false }, permissions: { additionalDirectories: ['/'], defaultMode: 'acceptEdits', allow: ['Read(//**)'] } });
  assert.deepStrictEqual([loose.spawned, loose.asked, !!loose.run.noShell, !!loose.run.withoutSandbox], [true, 0, false, false]);
  assert.ok(!loose.events.some((x) => x.kind === 'sandbox' || x.kind === 'error'), JSON.stringify(loose.events));
  const note = loose.log.find((x) => x.webmods === 'orgSettings');
  assert.ok(note && note.loosens.length === 4 && /managed-settings\.json/.test(note.from), JSON.stringify(loose.log));
  // Any command (the loosest settings CI writes): no shell, still no question.
  const any = go({ permissions: { allow: ['Read(//**)', 'Bash(*)'], defaultMode: 'bypassPermissions', additionalDirectories: ['/'] }, sandbox: { enabled: false } });
  assert.deepStrictEqual([any.spawned, any.asked, any.run.noShell, !!any.run.withoutSandbox], [true, 0, true, false]);
  assert.match(any.log.find((x) => x.webmods === 'noShell').why, /^managed settings allow `Bash\(\*\)` without asking; approve Claude Code’s actions by themselves \(bypassPermissions mode\)$/);
  assert.ok(any.log.some((x) => x.webmods === 'orgSettings'));
  // Any command and the trif tool taken away: stopped, saying why.
  const blocked = go({ permissions: { allow: ['Bash'] }, deniedMcpServers: [{ serverName: 'trif' }] });
  assert.deepStrictEqual([blocked.spawned, blocked.finished, blocked.asked], [false, true, 0]);
  assert.match(blocked.events.find((x) => x.kind === 'error').message, /let Claude Code run any command.*deny TRIF’s `trif` tool/);
  // Settings that break runs still stop them, in the box too.
  const plan = go({ permissions: { defaultMode: 'plan' } });
  assert.deepStrictEqual([plan.spawned, plan.finished], [false, true]);
  assert.match(plan.events.find((x) => x.kind === 'error').message, /plan mode/);
  // Outside the box: the consent is asked for (here given), the chat marked, a shell as before.
  const today = go({ permissions: { allow: ['Bash(*)'] } }, { wholeBox: false });
  assert.deepStrictEqual([today.spawned, today.asked, !!today.run.noShell, today.run.withoutSandbox], [true, 1, false, true]);
  assert.ok(today.events.some((x) => x.kind === 'sandbox' && x.trif === false));
});
