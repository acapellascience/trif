'use strict';
// Side-panel runs on Windows (docs/WINDOWS.md "The sandbox"), what's around the fence, on any system: the
// spec the helper gives the launcher, the `trif` tool's server (helper/mcp.js), the file tools done inside
// the fence (lib/win/fenced-files.js), Claude Code's command without a shell, and a run from start to end
// with a stand-in for the launcher (tests/fake-fence.js) and for the agent. The fence itself is attacked for
// real on windows-latest: tests/windows-fence/run.js, tests/windows-run.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');
const { tempDir, privDir, waitFor, testEnv, windowsShims } = require('./fake-extension');
// (never the computer's own agents: setup and the agents' list look along PATH)
process.env.PATH = testEnv(tempDir('wq-')).PATH;
if (process.env.TRIF_DEFAULT_AGENT_DIRS === undefined) process.env.TRIF_DEFAULT_AGENT_DIRS = '';
const fence = require('../helper/lib/win/fence');
const mcp = require('../helper/mcp');
const claude = require('../helper/lib/agents/claude');
const P = require('../helper/lib/paths');
const { Runs } = require('../helper/lib/runs');

const FAKE_FENCE = path.join(__dirname, 'fake-fence.js');

// ------------------------------------------------------------------ the spec

test('the fence\'s spec: a less-privileged container with registryRead; the run\'s folders name the run, TRIF\'s code and node the capability; other sites read-only; the environment is whole', () => {
  const limits = {
    workspace: 'C:\\b\\r1.ws', modsDir: 'C:\\b\\r1.ws\\sites', box: 'C:\\b\\r1', tmp: 'C:\\b\\r1\\tmp', screenshots: 'C:\\p\\screenshots\\x.com',
    lockedDirs: [{ real: 'C:\\b\\r1.ws\\sites\\y.com', link: false }, { real: 'C:\\elsewhere\\z.com', link: true }, { real: 'C:\\elsewhere\\q.com', link: false }],
  };
  const env = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Zo\u00eb', LOCALAPPDATA: 'C:\\Users\\Zo\u00eb\\AppData\\Local', SECRET_TOKEN: 'never', ANTHROPIC_API_KEY: 'never' };
  const spec = fence.specFor({ runId: 'rabc123', limits, code: ['C:\\t\\helper', 'C:\\t\\package.json'], node: 'C:\\n\\node.exe', runEnv: { TRIF_RUN_BOX: 'C:\\b\\r1', TRIF_RUN_TOKEN: 'tok' }, env });
  assert.equal(spec.name, 'trif.run.rabc123');
  assert.equal(spec.lpac, true);
  assert.deepEqual(spec.capabilities, ['registryRead'], 'and nothing that opens the network');
  assert.equal(spec.capability, fence.CAPABILITY);
  assert.equal(spec.cwd, 'C:\\b\\r1.ws');
  const g = (p, rights) => spec.grant.filter((x) => x.path === p && (!rights || x.rights === rights));
  assert.deepEqual(g('C:\\t\\helper')[0], { path: 'C:\\t\\helper', rights: 'r', to: 'capability', optional: true });
  assert.deepEqual(g('C:\\n\\node.exe')[0], { path: 'C:\\n\\node.exe', rights: 'r', to: 'capability', inherit: false, optional: true });
  assert.deepEqual(g('C:\\b\\r1.ws'), [{ path: 'C:\\b\\r1.ws', rights: 'r' }], 'its working folder: to read');
  assert.deepEqual(g('C:\\b\\r1.ws\\sites'), [{ path: 'C:\\b\\r1.ws\\sites', rights: 'r+mkdir', inherit: false }, { path: 'C:\\b\\r1.ws\\sites', rights: 'rw', inherit: 'only' }]);
  assert.deepEqual(g('C:\\b\\r1', 'rw').length, 1);
  assert.deepEqual(g('C:\\p\\screenshots\\x.com', 'rw').length, 1);
  assert.ok(!spec.grant.some((x) => x.rights === 'rw' && x.to === 'capability'), 'nothing every run may write');
  // (only real folders inside its copy's sites\\: a link, or a folder elsewhere, isn't touched)
  assert.deepEqual(spec.readonly, process.platform === 'win32' ? ['C:\\b\\r1.ws\\sites\\y.com'] : spec.readonly);
  assert.ok(!spec.deny, 'no deny entries: Windows ignores them for an AppContainer');
  // the environment: Windows' basics, the run's own variables, nothing else of the helper's
  assert.equal(spec.env.TRIF_RUN_TOKEN, 'tok');
  assert.equal(spec.env.TEMP, 'C:\\b\\r1\\tmp');
  assert.equal(spec.env.PATH, 'C:\\Windows\\System32');
  assert.equal(spec.env.USERPROFILE, 'C:\\Users\\Zo\u00eb');
  assert.ok(!('SECRET_TOKEN' in spec.env) && !('ANTHROPIC_API_KEY' in spec.env));
  assert.equal(fence.containerName('r1/../x y'), 'trif.run.r1..xy');
  assert.deepEqual(fence.NODE_FLAGS, ['--preserve-symlinks', '--preserve-symlinks-main']);
});

test('the launcher: a stand-in when told (tests); where it\'s built otherwise, named after its source; no compiler, no fence', () => {
  assert.deepEqual(fence.launcher({ home: 'x' }, { env: { TRIF_FENCE_BIN: FAKE_FENCE } }), { file: process.execPath, prefix: [FAKE_FENCE], error: null });
  assert.match(path.basename(fence.launcherFile({ home: path.join('C:', 'h'), bin: path.join('C:', 'h', 'bin') })), /^trif-fence-[0-9a-f]{12}\.exe$/);
  assert.equal(fence.cscPath({ env: { SystemRoot: 'C:\\Windows' }, exists: (f) => f.includes('Framework64') }), 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe');
  assert.equal(fence.cscPath({ env: {}, exists: () => false }), null);
  const home = tempDir('wl-');
  const r = fence.launcher({ home, bin: path.join(home, 'bin') }, { env: { SystemRoot: path.join(home, 'no-windows') } });
  assert.equal(r.file, null);
  assert.match(r.error, /C# compiler .* isn't on this computer/);
  assert.ok(fs.readFileSync(fence.SOURCE, 'utf8').includes('PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES'));
});

// ------------------------------------------------------------------ Claude Code without a shell

test('Claude Code on Windows: no Bash among its tools, the trif tool, rules relative to the run\'s copy, the screenshots folder as //c/…; nothing for a sandbox it doesn\'t have', () => {
  assert.equal(claude.windowsRulePath('C:\\Users\\Tim B\\AppData\\Local\\TRIF\\screenshots\\x.com'), '//c/Users/Tim B/AppData/Local/TRIF/screenshots/x.com');
  assert.throws(() => claude.windowsRulePath('\\\\server\\share\\x'), /can't name/);
  const c = claude.command({ bin: 'C:\\npm\\claude.cmd', prompt: 'hide it', agentDir: path.join('C:', 'b', 'r1.agent'), context: 'CTX', workspace: 'C:\\b\\r1.ws',
    lockedDirs: [{ literal: 'C:\\b\\r1.ws\\sites\\y.com', real: 'C:\\b\\r1.ws\\sites\\y.com', rel: 'sites/y.com' }], screenshots: 'D:\\p\\screenshots\\x.com',
    fence: { mcp: { command: 'C:\\n\\node.exe', args: ['C:\\t\\helper\\mcp.js', 'C:\\b\\r1.agent\\trif-tool.json'] } } });
  const after = (flag) => { const i = c.args.indexOf(flag); const out = []; for (let j = i + 1; j < c.args.length && !c.args[j].startsWith('--'); j++) out.push(c.args[j]); return out; };
  assert.deepEqual(after('--tools'), ['Read,Edit,Write,Glob,Grep']);
  assert.ok(!c.args.join(' ').includes('Bash'), 'no shell anywhere in the command');
  assert.deepEqual(after('--allowedTools'), ['Read(./**)', 'Edit(./sites/**)', 'mcp__trif__trif', 'Read(//d/p/screenshots/x.com/**)']);
  const denied = after('--disallowedTools');
  for (const want of ['WebFetch', 'WebSearch', 'Edit(./sites/y.com/**)', 'Edit(./sites/CLAUDE.md)', 'Edit(./sites/**/CLAUDE.md)', 'Edit(./sites/**/AGENTS.md)', 'Edit(./sites/**/.claude/**)']) assert.ok(denied.includes(want), want);
  assert.ok(c.args.includes('--strict-mcp-config'), 'the trif server and no other');
  const files = Object.fromEntries(c.files.map((f) => [path.basename(f.path), f.content]));
  assert.deepEqual(JSON.parse(files['mcp.json']), { mcpServers: { trif: { command: 'C:\\n\\node.exe', args: ['C:\\t\\helper\\mcp.js', 'C:\\b\\r1.agent\\trif-tool.json'] } } });
  assert.deepEqual(JSON.parse(files['settings.json']), { permissions: { deny: ['WebFetch', 'WebSearch'] } }, 'no sandbox settings, and no relative rule in a file (read from the file\'s folder)');
  assert.equal(c.stdin, 'hide it');
  // elsewhere, as before: Bash for trif, in Claude Code's own sandbox
  const mac = claude.command({ bin: '/x/claude', prompt: 'p', workspace: '/w', box: '/b', screenshots: '/s', home: '/h' });
  assert.ok(mac.args.includes('Read,Edit,Write,Glob,Grep,Bash') && !mac.args.includes('--mcp-config'));
  assert.equal(JSON.parse(mac.files[0].content).sandbox.enabled, true);
});

// ------------------------------------------------------------------ Codex without a shell

test('Codex on Windows: no profile and no shell; read-only, so its own apply_patch is refused; no view_image of its own; the trif server approved, with time for its tools; the token printed by Node', () => {
  const codex = require('../helper/lib/agents/codex');
  const mcpServer = { command: 'C:\\n\\node.exe', args: ['C:\\t\\helper\\mcp.js', 'C:\\b\\r1.agent\\trif-tool.json'] };
  const c = codex.command({ bin: 'C:\\npm\\codex.cmd', prompt: 'hide it', agentDir: 'C:\\b\\r1.agent', readable: ['C:\\b\\r1.ws'], writable: ['C:\\b\\r1.ws\\sites'], denied: ['C:\\Users\\t'], tmp: 'C:\\b\\r1\\tmp',
    lockedDirs: [{ literal: 'C:\\b\\r1.ws\\sites\\y.com', real: 'C:\\b\\r1.ws\\sites\\y.com', rel: 'sites/y.com' }, { literal: 'C:\\b\\r1.ws\\sites\\l.com', real: 'D:\\elsewhere', rel: 'sites/l.com', link: true }],
    fence: { mcp: mcpServer } });
  const config = c.args.filter((a, i) => c.args[i - 1] === '-c');
  assert.ok(!config.some((x) => /^(default_permissions|permissions)=/.test(x)), 'no permission profile: no session starts with one there');
  assert.ok(config.includes('sandbox_mode="read-only"') && config.includes('approval_policy="never"'));
  for (const f of ['shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'view_image']) assert.ok(config.includes(`features.${f}=false`), f);
  assert.ok(config.includes('web_search="disabled"') && config.includes('features.apps=false'), 'and what\'s off everywhere');
  assert.ok(!config.some((x) => /^shell_environment_policy\.set=/.test(x)), 'no temporary folder for commands there are none of');
  const server = config.find((x) => x.startsWith('mcp_servers.trif='));
  assert.equal(server, 'mcp_servers.trif={ command = "C:\\\\n\\\\node.exe", args = ["C:\\\\t\\\\helper\\\\mcp.js", "C:\\\\b\\\\r1.agent\\\\trif-tool.json"], default_tools_approval_mode = "approve", startup_timeout_sec = 30, tool_timeout_sec = 330 }');
  assert.equal(config.filter((x) => x.startsWith('mcp_servers.')).length, 1, 'that server and no other (--ignore-user-config)');
  assert.ok(c.args.includes('--ignore-user-config') && c.args.includes('--ignore-rules'));
  assert.deepEqual(c.locked, ['sites/y.com'], 'the fence holds other sites\' folders');
  assert.equal(c.stdin, 'hide it');
  assert.equal(codex.fencedFiles, true);
  // the key proxy's token: a file Node prints, there being no /bin/cat
  assert.equal(codex.proxyAuth('C:\\b\\r1.agent', 'win32'), `auth = { command = ${JSON.stringify(process.execPath)}, args = [${JSON.stringify(path.join(__dirname, '..', 'helper', 'lib', 'win', 'print-file.js'))}, ${JSON.stringify(codex.tokenFile('C:\\b\\r1.agent'))}] }`);
  assert.match(codex.proxyAuth('/b/r1.agent', 'darwin'), /command = "\/bin\/cat"/);
  const dir = tempDir('pf-');
  fs.writeFileSync(path.join(dir, 'token'), 'tok-123');
  assert.equal(require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'helper', 'lib', 'win', 'print-file.js'), path.join(dir, 'token')], { encoding: 'utf8' }).stdout, 'tok-123');
  // elsewhere, as before: its profile, its shell
  const mac = codex.command({ bin: '/x/codex', prompt: 'p', readable: ['/w'], writable: ['/w/sites'], tmp: '/b/tmp' });
  const macConfig = mac.args.filter((a, i) => mac.args[i - 1] === '-c');
  assert.ok(macConfig.includes('default_permissions="trif-run"') && !macConfig.some((x) => /^(sandbox_mode|mcp_servers|features\.shell_tool)/.test(x)));
  // what the run is told: the file tools by name
  const agents = require('../helper/lib/agents');
  assert.match(agents.contextText({ url: 'https://x.com/', scope: 'x.com', noShell: 'files' }), /no shell in this chat.*call the `trif` tool.*read_file, write_file, edit_file, list_files and search_files tools beside it/);
  assert.match(agents.contextText({ url: 'https://x.com/', scope: 'x.com', noShell: true }), /with your own file tools, with paths relative/);
  assert.ok(!/no shell/.test(agents.contextText({ url: 'https://x.com/', scope: 'x.com' })));
  // not from the panel until its real run is green on CI: only the test that proves it switches it on
  const platform = require('../helper/lib/platform');
  assert.deepEqual(platform.windowsRunAgents({}), ['claude']);
  assert.deepEqual(platform.windowsRunAgents({ TRIF_WINDOWS_CODEX_RUNS: '1' }), ['claude', 'codex']);
});

// ------------------------------------------------------------------ the trif tool's server

function client(config, opts) {
  const input = new PassThrough();
  const output = new PassThrough();
  const got = [];
  let buf = '';
  output.setEncoding('utf8');
  output.on('data', (d) => { buf += d; for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { got.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  mcp.serve(config, { input, output, ...opts });
  let n = 0;
  return {
    got,
    notify: (method, params) => input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
    async call(method, params) {
      const id = ++n;
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return waitFor(() => got.find((m) => m.id === id), { timeout: 20000, message: `an answer to ${method}` });
    },
  };
}

// A workspace-like folder, a spec for it, and a config whose launcher is the stand-in and whose "cli" says
// what it was started with.
function toolSetup({ files = false } = {}) {
  const dir = tempDir('wt-');
  const work = path.join(dir, 'r1.ws');
  fs.mkdirSync(path.join(work, 'sites', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(work, 'sites', 'x.com', 'a.js'), '// a\nlet first = 1;\n');
  const cli = path.join(dir, 'cli.js');
  fs.writeFileSync(cli, 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => { const a = process.argv.slice(2); process.stdout.write(JSON.stringify({ args: a, stdin: s, cwd: process.cwd(), box: process.env.TRIF_RUN_BOX || null, leaked: process.env.LEAK || null })); if (a[0] === "fail") { process.stderr.write("trif: no such thing\\n"); process.exit(3); } if (a[0] === "slow") setTimeout(() => {}, 60000); });');
  const spec = path.join(dir, 'fence.json');
  fs.writeFileSync(spec, JSON.stringify({ name: 'trif.run.t1', cwd: work, env: { TRIF_RUN_BOX: path.join(dir, 'r1') } }));
  const config = { launcher: { file: process.execPath, prefix: [FAKE_FENCE] }, spec, node: process.execPath, nodeFlags: [], cli, version: '9.9.9',
    ...(files ? { files: path.join(__dirname, '..', 'helper', 'lib', 'win', 'fenced-files.js') } : {}) };
  return { dir, work, config, spec };
}

test('the trif tool: MCP over a line each; its words reach TRIF\'s command as they are, one argument each, inside the fence; what it printed comes back', async () => {
  const { work, config, spec } = toolSetup();
  process.env.LEAK = 'of the server\'s own environment';
  const c = client(config);
  const init = await c.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test' } });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.serverInfo.name, 'trif');
  c.notify('notifications/initialized');
  const list = await c.call('tools/list');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['trif'], 'one tool, unless the agent has no file tools of its own');
  assert.match(list.result.tools[0].description, /no shell in this chat/);
  assert.deepEqual(list.result.tools[0].inputSchema.required, ['args']);
  // words that would mean something to a shell are words
  const words = ['status', '--tab', '12', 'a b', '&', 'type secret', '$(whoami)', '`id`', '| more', '> out.txt', 'q"uote', 'back\\slash\\', '%PATH%', ''];
  const r = await c.call('tools/call', { name: 'trif', arguments: { args: words, stdin: 'from the agent\n' } });
  assert.equal(r.result.isError, false, JSON.stringify(r.result));
  const said = JSON.parse(r.result.content[0].text);
  assert.deepEqual(said.args, words);
  assert.equal(said.stdin, 'from the agent\n');
  assert.equal(fs.realpathSync(said.cwd), fs.realpathSync(work), 'in the run\'s working folder');
  assert.equal(said.box, JSON.parse(fs.readFileSync(spec, 'utf8')).env.TRIF_RUN_BOX, 'with the spec\'s environment');
  assert.equal(said.leaked, null, 'and nothing of the server\'s own');
  assert.match(fs.readFileSync(`${spec}.calls`, 'utf8'), /^exec \[/, 'through the launcher');
  // a command that fails: what it said, and that it failed
  const bad = await c.call('tools/call', { name: 'trif', arguments: { args: ['fail'] } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /trif: no such thing\n\(exit status 3\)$/);
  // what isn't a list of words is refused before anything starts
  for (const [input, why] of [[{}, /must be a list of words/], [{ args: 'status' }, /must be a list of words/], [{ args: ['a', 3] }, /must be text/], [{ args: ['a\0b'] }, /can't be passed/],
    [{ args: Array(300).fill('x') }, /too many words/], [{ args: ['x'], stdin: 5 }, /`stdin` must be text/]]) {
    const x = await c.call('tools/call', { name: 'trif', arguments: input });
    assert.equal(x.result.isError, true);
    assert.match(x.result.content[0].text, why);
  }
  assert.equal((await c.call('tools/call', { name: 'bash', arguments: { command: 'dir' } })).error.code, -32602, 'no other tool');
  assert.equal((await c.call('resources/list')).error.code, -32601);
  assert.deepEqual((await c.call('ping')).result, {});
  delete process.env.LEAK;
});

test('the trif tool: a command that never ends is stopped, and said so', async () => {
  const { config } = toolSetup();
  const c = client({ ...config, timeoutMs: 800 });
  const r = await c.call('tools/call', { name: 'trif', arguments: { args: ['slow'] } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /trif: stopped after 1 s$/);
});

test('file tools for an agent with none of its own (Codex on Windows): read, write, edit, list, search and look at a picture, each done inside the fence, in the run\'s working folder', async () => {
  const { work, config, spec } = toolSetup({ files: true });
  const c = client(config);
  await c.call('initialize', {});
  const names = (await c.call('tools/list')).result.tools.map((t) => t.name);
  assert.deepEqual(names, ['trif', 'read_file', 'write_file', 'edit_file', 'list_files', 'search_files', 'view_image']);
  const call = async (name, args) => { const r = await c.call('tools/call', { name, arguments: args }); return { text: r.result.content[0].text, bad: r.result.isError }; };
  assert.deepEqual(await call('read_file', { path: 'sites/x.com/a.js' }), { text: '// a\nlet first = 1;\n', bad: false });
  assert.deepEqual(await call('write_file', { path: 'sites/x.com/new/b.js', content: '// b\nlet two = 2;\nlet again = 2;\n' }), { text: 'wrote sites/x.com/new/b.js (33 bytes)', bad: false });
  assert.equal(fs.readFileSync(path.join(work, 'sites', 'x.com', 'new', 'b.js'), 'utf8'), '// b\nlet two = 2;\nlet again = 2;\n');
  assert.deepEqual(await call('edit_file', { path: 'sites/x.com/new/b.js', old: 'two = 2', new: 'two = 22' }), { text: 'changed sites/x.com/new/b.js', bad: false });
  assert.match((await call('edit_file', { path: 'sites/x.com/new/b.js', old: 'let', new: 'var' })).text, /`old` is there 2 times: give more of the text around it, or pass all: true/);
  assert.match((await call('edit_file', { path: 'sites/x.com/new/b.js', old: 'nowhere', new: 'x' })).text, /`old` isn't in the file as given/);
  assert.deepEqual(await call('edit_file', { path: 'sites/x.com/new/b.js', old: 'let', new: 'var', all: true }), { text: 'changed sites/x.com/new/b.js (2 places)', bad: false });
  assert.deepEqual(await call('list_files', { path: 'sites', depth: 3 }), { text: 'sites/x.com/\nsites/x.com/a.js\nsites/x.com/new/\nsites/x.com/new/b.js', bad: false });
  assert.deepEqual(await call('search_files', { pattern: 'first', path: 'sites' }), { text: 'sites/x.com/a.js:2: let first = 1;', bad: false });
  assert.deepEqual(await call('search_files', { pattern: 'nothing-like-it' }), { text: 'no matches', bad: false });
  assert.deepEqual(await call('read_file', { path: 'sites/x.com/gone.js' }), { text: 'sites/x.com/gone.js: nothing there', bad: true });
  assert.equal((await call('search_files', { pattern: '(' })).bad, true);
  // a long file comes in parts
  fs.writeFileSync(path.join(work, 'long.txt'), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
  assert.equal((await call('read_file', { path: 'long.txt', offset: 10, limit: 2 })).text, 'line 10\nline 11\n[… 50 lines in all: pass offset and limit for the rest]');
  assert.ok(fs.readFileSync(`${spec}.calls`, 'utf8').split('\n').filter((l) => l.startsWith('exec ')).length >= 10, 'every one through the launcher');
  // a picture (a screenshot, by the full path `trif screenshot` printed) comes back as a picture
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const shot = path.join(work, 'shot.png');
  fs.writeFileSync(shot, png);
  const seen = await c.call('tools/call', { name: 'view_image', arguments: { path: shot } });
  assert.deepEqual(seen.result, { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }], isError: false });
  assert.deepEqual(await call('view_image', { path: 'long.txt' }), { text: 'long.txt: not a picture this can show (.png, .jpg, .gif, .webp)', bad: true });
  assert.deepEqual(await call('view_image', { path: 'gone.png' }), { text: 'gone.png: nothing there', bad: true });
  // (what it may open is the fence's to say, on Windows: here the words it uses when the fence says no)
  const files = require('../helper/lib/win/fenced-files');
  assert.equal(files.handle({ op: 'nope' }).ok, false);
  // files agents read as instructions aren't written, by any spelling Windows takes for one
  for (const p of ['sites/x.com/CLAUDE.md', 'sites/x.com/agents.md', 'sites/AGENTS.override.md', 'sites/x.com/.claude/settings.json', 'sites/x.com/.CODEX/config.toml', 'sites/x.com/CLAUDE.md.', 'sites/x.com/claude.md::$DATA', 'sites/x.com/CLAUDE.local.md ']) {
    assert.deepEqual(await call('write_file', { path: p, content: 'planted' }), { text: `${p}: this chat can't write files that agents read as instructions`, bad: true }, p);
  }
  assert.equal((await call('edit_file', { path: 'sites/x.com/AGENTS.md', old: 'a', new: 'b' })).text, 'sites/x.com/AGENTS.md: this chat can\'t write files that agents read as instructions');
  assert.ok(!fs.existsSync(path.join(work, 'sites', 'x.com', 'CLAUDE.md')) && !fs.existsSync(path.join(work, 'sites', 'x.com', '.claude')));
  assert.equal(files.instructionFile(path.join(process.cwd(), 'sites', 'x.com', 'claude-notes.md')), false);
});

// ------------------------------------------------------------------ a run, with stand-ins

const FAKE_CLAUDE = `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('2.1.999 (Claude Code)'); process.exit(0); }
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const read = (f) => { try { return f ? fs.readFileSync(f, 'utf8') : null; } catch (e) { return 'UNREADABLE ' + e.code; } };
const mcpFile = opt('--mcp-config');
const mcpConfig = JSON.parse(read(mcpFile) || '{}');
const out = { argv, cwd: process.cwd(), settings: read(opt('--settings')), context: read(opt('--append-system-prompt-file')), mcp: mcpConfig, token: process.env.TRIF_RUN_TOKEN || null };
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 's1', cwd: process.cwd(), tools: [] });
// As Claude Code would: start the trif tool's server and ask it to run a command.
const srv = mcpConfig.mcpServers && mcpConfig.mcpServers.trif;
const done = () => {
  fs.writeFileSync(path.join(__dirname, 'call.json'), JSON.stringify(out));
  fs.mkdirSync(path.join(process.cwd(), 'sites', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'sites', 'example.com', 'made.js'), '// made by the run\\n');
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1', total_cost_usd: 0 });
};
if (!srv) { done(); return; }
const child = require('child_process').spawn(srv.command, srv.args, { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.id === 1) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trif', arguments: { args: ['help', 'check'] } } }) + '\\n');
    if (m.id === 2) { out.tool = m.result; child.stdin.end(); done(); }
  }
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\\n');
`;

test('a run on Windows (stand-ins for the launcher and the agent): fenced before the agent starts, the agent given no shell and the trif tool, TRIF\'s real command run through it, the fence taken down after', async () => {
  const home = tempDir('wr-');
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites', 'other.net'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sites', 'other.net', 'keep.js'), '// keep');
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# guide');
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  windowsShims(home);
  const log = path.join(home, 'fence.log');
  const saved = { ...process.env };
  Object.assign(process.env, { TRIF_FENCE_BIN: FAKE_FENCE, TRIF_FAKE_FENCE_LOG: log, TRIF_BOX_ROOT: path.join(home, 'boxes'), TRIF_KEYCHAIN_BIN: path.join(home, 'no-keychain', 'security'), TRIF_CLAUDE_MANAGED_DIR: path.join(home, 'no-managed') });
  try {
    const events = [];
    const runs = new Runs({ getWorkspace: () => P.workspace(home), platform: 'win32', onEvent: (id, e) => events.push(e) });
    const { runId } = runs.start({ agent: 'claude', prompt: 'make it so', site: 'example.com', url: 'https://example.com/' });
    const done = await waitFor(() => events.find((e) => e.kind === 'done'), { timeout: 60000, message: `the run to end (${JSON.stringify(events)})` });
    assert.equal(done.ok, true, JSON.stringify(events));
    const call = JSON.parse(fs.readFileSync(path.join(bin, 'call.json'), 'utf8'));
    // the agent: no shell, the tool
    assert.ok(call.argv.includes('Read,Edit,Write,Glob,Grep') && !call.argv.join(' ').includes('Bash'));
    assert.ok(call.argv.includes('mcp__trif__trif') && call.argv.includes('--mcp-config') && call.argv.includes('--strict-mcp-config'));
    assert.deepEqual(JSON.parse(call.settings), { permissions: { deny: ['WebFetch', 'WebSearch'] } });
    assert.match(call.context, /There is no shell in this chat\. Wherever AGENTS\.md says to run `trif <words>`, call the `trif` tool/);
    assert.match(path.basename(call.cwd), new RegExp(`^${runId}\\.ws$`), 'in its own copy of the workspace');
    assert.equal(path.basename(call.mcp.mcpServers.trif.args[0]), 'mcp.js');
    // TRIF's real command, through the tool and the launcher
    assert.equal(call.tool.isError, false, JSON.stringify(call.tool));
    assert.match(call.tool.content[0].text, /trif check/);
    // the fence: made before anything of the agent's ran, used for the command, taken down after
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines[0], `prepare trif.run.${runId}`);
    // (the command itself went through the launcher too: the tool's server has no other way to start it)
    assert.equal(lines[lines.length - 1], `cleanup trif.run.${runId}`);
    // and the helper copied what the run made in its copy into the mods folder
    assert.equal(fs.readFileSync(path.join(home, 'sites', 'example.com', 'made.js'), 'utf8'), '// made by the run\n');
    await waitFor(() => !fs.existsSync(path.join(home, 'boxes', `${runId}.agent`)), { message: 'the run\'s own folder to go' });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('a run on Windows without a fence doesn\'t start: no launcher, no agent', async () => {
  const home = tempDir('wn-');
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  windowsShims(home);
  const saved = { ...process.env };
  // (a launcher that says no to `prepare`)
  const refusing = path.join(home, 'refusing-fence.js');
  fs.writeFileSync(refusing, 'process.stderr.write("trif-fence: no containers today\\n"); process.exit(125);');
  Object.assign(process.env, { TRIF_FENCE_BIN: refusing, TRIF_BOX_ROOT: path.join(home, 'boxes'), TRIF_KEYCHAIN_BIN: path.join(home, 'no-keychain', 'security'), TRIF_CLAUDE_MANAGED_DIR: path.join(home, 'no-managed') });
  try {
    const events = [];
    const runs = new Runs({ getWorkspace: () => P.workspace(home), platform: 'win32', onEvent: (id, e) => events.push(e) });
    runs.start({ agent: 'claude', prompt: 'make it so', site: 'example.com', url: 'https://example.com/' });
    const done = await waitFor(() => events.find((e) => e.kind === 'done'), { timeout: 30000, message: 'the run to end' });
    assert.equal(done.ok, false);
    assert.match(events.find((e) => e.kind === 'error').message, /TRIF's fence for this run couldn't be made \(no containers today\)/);
    assert.ok(!fs.existsSync(path.join(bin, 'call.json')), 'the agent never started');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the launcher\'s source builds where there\'s a C# compiler (Windows only)', { skip: process.platform !== 'win32' && 'needs Windows\' csc.exe' }, () => {
  const home = tempDir('wb-');
  const r = fence.launcher({ home, bin: path.join(home, 'bin') }, { env: { ...process.env, TRIF_FENCE_BIN: '' } });
  assert.equal(r.error, null);
  assert.ok(fs.statSync(r.file).size > 8000);
  assert.equal(spawnSync(r.file, [], { encoding: 'utf8' }).status, 125, 'no command: usage');
  assert.deepEqual(fence.launcher({ home, bin: path.join(home, 'bin') }, { env: { ...process.env, TRIF_FENCE_BIN: '' } }), r, 'built once');
});
