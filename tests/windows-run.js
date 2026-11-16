#!/usr/bin/env node
'use strict';
// A real side-panel run on Windows, fenced, end to end (docs/WINDOWS.md "The sandbox"). Run by
// .github/workflows/windows-fence.yml on a windows-latest runner; what tests/run-sandbox.test.js is on a Mac.
//
//   - TRIF set up in a scratch profile folder by its own `setup --copy` (no registry: --native-dir);
//   - the real helper (the copy's), with a stand-in for the extension on its native messaging end;
//   - the real Claude Code (from npm), talking to a stand-in for Anthropic's API through the helper's key
//     proxy: a made-up API key in the real Windows Credential Manager, no account, no paid call. The
//     stand-in asks for exactly the tool calls scripted here;
//   - or, with `codex` as an argument, the real Codex the same way (a stand-in for OpenAI's API): no shell
//     and none of its own tools that touch the computer, `trif` and TRIF's file tools from helper/mcp.js
//     (agents/codex.js windowsConfig). Codex isn't offered in the panel on Windows until this is green
//     (platform.js windowsRunAgents), so this run switches it on for itself;
//   - the helper builds the fence's launcher with Windows' own C# compiler, makes the run's AppContainer,
//     and starts Claude Code without a shell, with `trif` as a tool (helper/mcp.js).
//
// Checked: every `trif` command a run uses works through the tool, inside the fence; a mod written in the
// run's working folder reaches the mods folder and the browser; and nothing gets out: not through the
// tool (odd arguments, another site's tab, a file elsewhere), not through Claude Code's own file tools,
// not through a shell (there is none), and not from a program started in the run's own container while
// the run is going (a secret, the private folder, the live workspace, this computer's servers, the key in
// Credential Manager). Prints PASS/FAIL per check; exits 1 if anything failed.
//
// It saves a made-up key under TRIF's name in Credential Manager (and removes it), so it refuses to run
// outside GitHub Actions unless given --yes-this-computer.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') { console.error('windows-run: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--yes-this-computer')) {
  console.error('windows-run: this saves a made-up key in Windows Credential Manager and makes AppContainer profiles.\nIt runs on GitHub Actions; elsewhere pass --yes-this-computer.');
  process.exit(2);
}

const REPO = path.resolve(__dirname, '..');
const { FakeExtension } = require('./fake-extension');
const { startFakeAnthropic } = require('./fake-anthropic-server');
const { startFakeModelServer } = require('./fake-model-server');
const { buildSpy } = require('./windows-fence/build');
const { findExecutable } = require(path.join(REPO, 'helper', 'lib', 'agents', 'util'));
const keys = require(path.join(REPO, 'helper', 'lib', 'agentkeys'));
const fence = require(path.join(REPO, 'helper', 'lib', 'win', 'fence'));

const AGENT = process.argv.includes('codex') ? 'codex' : 'claude';
const CX = AGENT === 'codex';
const NAME = CX ? 'Codex' : 'Claude Code';
const SECRET = `CANARY-${crypto.randomBytes(8).toString('hex')}`;
const KEY = `${CX ? 'sk-standin-' : 'sk-ant-standin-'}${crypto.randomBytes(8).toString('hex')}`;
const CRED = `TRIF API key/${keys.AGENT_KEYS[AGENT].account}`;
// Codex's tools that reach nothing on the computer (its sub-agents' and questions' tools are looked at
// before they're added here).
const CODEX_HARMLESS = ['update_plan',
  // the resources of the run's MCP servers: there is one server, TRIF's (--ignore-user-config), and it has none
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  // a question for the user: there's nobody to ask in a run (`codex exec`)
  'request_user_input',
  // the session's own goal: words Codex keeps for itself
  'get_goal', 'create_goal', 'update_goal'];
// (multi_agent_v1.*, its sub-agents: not here until what one starts with has been seen; below)
let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${String(detail).slice(0, 3000).split('\n').join('\n      ')}` : ''}`);
  if (!ok) failed++;
  return !!ok;
}
// The tools in requests to the stand-in model, as Codex lists them (a namespace's inside it): a.b, sorted.
const offeredTo = (bodies) => [...new Set(bodies.filter((b) => b && Array.isArray(b.tools)).flatMap((b) => b.tools.flatMap((t) => (Array.isArray(t.tools) ? t.tools.map((x) => `${t.name}.${x.name}`) : [t.name || t.type]))))].sort();
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const MOD = '// ==WebMod==\n// @name Hello\n// @match https://example.com/*\n// ==/WebMod==\ndocument.title = "hello";\n';

(async () => {
  const agentBin = findExecutable(AGENT, String(process.env.PATH || '').split(';').filter(Boolean), { platform: 'win32' });
  if (!check(!!agentBin, `${NAME} is installed (${agentBin || 'not on PATH'})`)) process.exit(1);

  // ---- a scratch profile folder, and TRIF set up in it as a user would have it
  const S = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-run-')));
  const home = path.join(S, 'Test User');
  const local = path.join(home, 'AppData', 'Local');
  const env = { ...process.env, USERPROFILE: home, LOCALAPPDATA: local, APPDATA: path.join(home, 'AppData', 'Roaming'), TRIF_UPDATE_DELAY: '2000000000', TRIF_DEFAULT_AGENT_DIRS: '' };
  for (const k of Object.keys(env)) if (/^(TRIF_HOME|WEBMODS_HOME|HOME)$/i.test(k)) delete env[k];
  for (const d of [local, env.APPDATA]) fs.mkdirSync(d, { recursive: true });
  const setup = spawnSync(process.execPath, [path.join(REPO, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--no-examples', '--native-dir', path.join(S, 'native')], { env, encoding: 'utf8', timeout: 300000 });
  if (!check(setup.status === 0, 'trif setup --copy in a scratch profile folder', `${setup.stdout}\n${setup.stderr}`)) process.exit(1);
  const ws = path.join(home, '.trif');
  const priv = path.join(local, 'TRIF');
  const code = path.join(ws, 'app');
  // What no run may see: a secret elsewhere in the home folder, one in TRIF's settings; another site's mods.
  const secretFile = put(path.join(home, 'Documents', 'secret.txt'), `${SECRET} home`);
  const outsideImage = path.join(home, 'Documents', 'photo.png'); // (a real one-pixel picture)
  fs.writeFileSync(outsideImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const cfgFile = path.join(priv, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')), secret: `${SECRET} settings` }));
  put(path.join(ws, 'sites', 'other.net', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://other.net/*\n// ==/WebMod==\n');
  // The made-up API key, in the real Credential Manager, saved as `trif agent key` saves one.
  let savedKey = false;
  try {
    if ((await keys.hasAgentKey(AGENT, {})).stored) throw new Error(`this computer already has an ${keys.AGENT_KEYS[AGENT].name} key saved by TRIF: not touching it`);
    await keys.setAgentKey(AGENT, KEY, {});
    savedKey = true;
  } catch (e) { check(false, 'a made-up API key saved in Credential Manager', e.message); process.exit(1); }

  // ---- servers on this computer: the stand-in API (reached through the helper's key proxy), and one more
  // that a run must not reach
  const script = [];
  let pick = null; // (Codex's sub-agents, below: steps chosen by who's asking)
  // (Codex: a model name it doesn't know, so it calls its tools directly and lists them in each request)
  const api = CX ? await startFakeModelServer({ script, models: ['standin'], pick: (j) => (pick ? pick(j) : null) }) : await startFakeAnthropic({ script });
  let localHits = 0;
  const localServer = net.createServer((s) => { localHits++; s.destroy(); });
  await new Promise((r) => localServer.listen(0, '127.0.0.1', r));
  const localPort = localServer.address().port;

  // ---- the real helper, with a stand-in extension
  const ext = new FakeExtension({ home: ws, hostJs: path.join(code, 'helper', 'host.js'), env: {
    ...env, PATH: process.env.PATH, TRIF_HOME: '', TRIF_BOX_ROOT: '', TRIF_KEYCHAIN_BIN: '', TRIF_FENCE_BIN: '' /* (the real fence, not the unit tests' stand-in) */, TRIF_CLAUDE_MANAGED_DIR: path.join(S, 'no-claude-managed'),
    ...(CX ? { TRIF_OPENAI_URL: `${api.url}/v1`, TRIF_WINDOWS_CODEX_RUNS: '1' } : { TRIF_ANTHROPIC_URL: api.url }), TRIF_AGENT_TIMEOUT_MS: '240000', TRIF_AGENT_KILL_GRACE_MS: '400',
  } });
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const tabs = [{ id: 12, windowId: 1, active: true, url: 'https://example.com/page', title: 'Example' }, { id: 13, windowId: 1, active: false, url: 'https://other.net/page', title: 'Other' }];
  // While the run is going (its first `trif status` asks the extension, which is this): programs started in
  // the run's own container, by the launcher and the spec the helper made for it.
  const inside = {};
  let probed = false;
  const boxes = path.join(local, 'TRIF-Cache', 'boxes');
  const probeRunsContainer = () => {
    if (probed) return;
    probed = true;
    try {
      const agentDir = fs.readdirSync(boxes).find((n) => n.endsWith('.agent'));
      const runId = agentDir.slice(0, -'.agent'.length);
      const specFile = path.join(boxes, agentDir, 'fence.json');
      const exe = path.join(ws, 'bin', fs.readdirSync(path.join(ws, 'bin')).find((n) => /^trif-fence-[0-9a-f]+\.exe$/.test(n)));
      inside.spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
      const spy = buildSpy(path.join(boxes, runId)); // (in the run's mailbox, which its container may read)
      const exec = (argv) => { const r = spawnSync(exe, ['exec', specFile, '--', ...argv], { encoding: 'utf8', timeout: 60000, windowsHide: true }); return `${r.stdout || ''}${r.stderr || ''}`.trim(); };
      const node = inside.spec.grant.find((g) => /node\.exe$/i.test(g.path)).path;
      const js = (body) => exec([node, '-e', `(async () => { ${body} })().then((v) => console.log('OUT', v), (e) => console.log('REFUSED', e.code || e.message))`]);
      const read = (f) => js(`return require('fs').readFileSync(${JSON.stringify(f)}, 'utf8').slice(0, 80)`);
      inside.own = read(path.join(inside.spec.cwd, 'AGENTS.md'));
      inside.secret = read(secretFile);
      inside.settings = read(cfgFile);
      inside.liveState = read(path.join(ws, 'AGENTS.md'));
      inside.liveMods = js(`require('fs').writeFileSync(${JSON.stringify(path.join(ws, 'sites', 'example.com-planted.js'))}, 'x'); return 'written'`);
      inside.otherSite = js(`require('fs').writeFileSync(${JSON.stringify(path.join(inside.spec.cwd, 'sites', 'other.net', 'planted.js'))}, 'x'); return 'written'`);
      inside.guide = js(`require('fs').appendFileSync(${JSON.stringify(path.join(inside.spec.cwd, 'AGENTS.md'))}, 'x'); return 'written'`);
      inside.ownSite = js(`const f = ${JSON.stringify(path.join(inside.spec.cwd, 'sites', 'example.com', 'from-inside.txt'))}; require('fs').mkdirSync(require('path').dirname(f), { recursive: true }); require('fs').writeFileSync(f, 'x'); return 'written'`);
      inside.loopback = js(`return await new Promise((res, rej) => { const s = require('net').connect({ host: '127.0.0.1', port: ${localPort} }); s.setTimeout(3000, () => rej(new Error('timeout'))); s.on('connect', () => res('connected')); s.on('error', rej); })`);
      inside.proxy = js(`const u = new URL(${JSON.stringify(api.url)}); return await new Promise((res, rej) => { const s = require('net').connect({ host: u.hostname, port: Number(u.port) }); s.setTimeout(3000, () => rej(new Error('timeout'))); s.on('connect', () => res('connected')); s.on('error', rej); })`);
      inside.internet = js(`return await new Promise((res, rej) => { const s = require('net').connect({ host: '1.1.1.1', port: 443 }); s.setTimeout(4000, () => rej(new Error('timeout'))); s.on('connect', () => res('connected')); s.on('error', rej); })`);
      inside.dns = js(`return await new Promise((res, rej) => { require('dns').lookup('example.com', (e, a) => (e ? rej(e) : res(a))); setTimeout(() => rej(new Error('timeout')), 6000); })`);
      inside.cred = exec([spy, 'cred', CRED]);
      inside.helperProcess = exec([spy, 'cmdline', String(ext.child.pid)]);
      inside.clip = exec([spy, 'clip']);
      inside.credOutside = String(spawnSync(spy, ['cred', CRED], { encoding: 'utf8' }).stdout || '').trim();
    } catch (e) { inside.error = e.stack || e.message; }
  };
  ext.handlers = {
    tabs: () => tabs,
    // (a moment after answering: the probe takes a few seconds, and the run is still going then)
    status: () => { setImmediate(probeRunsContainer); return { userScripts: true, chrome: '140.0.0.0', version: pkg.version, mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [] }; },
    reload: (a) => ({ url: (tabs.find((t) => t.id === (a.tab ?? a.tabId)) || tabs[0]).url }),
    // (as the extension does for a run's request, which the helper marks with the run's site: a tab of
    // another site is refused)
    text: (a) => { const t = tabs.find((x) => x.id === (a.tab ?? a.tabId)) || tabs[0]; if (a.scope && !new URL(t.url).hostname.endsWith(a.scope)) throw new Error(`this agent run is limited to ${a.scope}: tab ${t.id} is on ${new URL(t.url).hostname}`); return { text: 'the page\'s text' }; },
    errors: () => [],
    logs: () => [{ mod: 'example.com/probe', level: 'log', args: ['hello'], time: Date.now() }],
  };
  const onMessage = ext._onMessage.bind(ext);
  ext._onMessage = (m) => {
    onMessage(m);
    if (m.type === 'mods' && Array.isArray(m.mods)) ext.send({ type: 'modsApplied', registered: m.mods.map((x) => x.id), errors: [] });
  };
  ext.hello();
  const helperLog = () => { try { return fs.readFileSync(path.join(priv, 'helper.log'), 'utf8').split('\n').slice(-40).join('\n'); } catch { return '(no helper.log)'; } };
  let ok = true;
  try { await ext.waitForSocket(20000); } catch (e) { ok = check(false, 'the helper started', `${e.message}\n${ext.stderr}\n${helperLog()}`); }

  // ---- what the stand-in model asks for, in order
  // (Codex is offered an MCP server's tools as a namespace: mcp__trif, tool trif)
  const tool = (name, args) => ({ call: { namespace: 'mcp__trif', name, arguments: args } });
  const trif = (...args) => (CX ? tool('trif', { args }) : { tool: 'mcp__trif__trif', input: { args } });
  const plant = (file) => ({ custom: { name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${file}\n+// planted\n*** End Patch\n` } });
  const BY = {
    files: /this chat can't|nothing there|not permitted|EPERM|EACCES/i,
    codex: /unsupported call|unsupported custom tool|rejected|blocked|not (allowed|available|supported|found)|denied|unknown|no such/i,
    trif: /^trif: |usage: trif|not available inside a side-panel agent run|inside a side-panel agent run|limited to|isn't one of this run's|unknown|no such|\(exit status [1-9]/im,
    claude: /was blocked|haven't granted|requested permissions|not allowed|denied by your permission settings|outside/i,
    notool: /No such tool available|not available|denied|permission/i,
    any: /\w/,
  };
  let steps = [];
  let refusals = [];
  // (filled in once the run has started and its working folder is known: `copy` is a path in it)
  const plan = (stage) => {
  const copy = (...p) => path.join(stage, ...p);
  steps = [
    // every command a run uses, through the tool
    ['status', trif('status'), /helper|extension|mods?/i],
    ['tabs', trif('tabs'), /example\.com\/page/],
    ['new', trif('new', 'example.com', 'probe', '--style'), /probe\.js/],
    ['check', trif('check', 'example.com/probe'), /^ok: /m],
    ['verify', trif('verify', 'example.com/probe'), /== check[\s\S]*reloaded https:\/\/[\s\S]*== errors[\s\S]*== logs/],
    ['explain', trif('explain'), /\w/],
    ['explain boxed-mods', trif('explain', 'boxed-mods'), /\w/],
    ['errors', trif('errors'), null],
    ['logs', trif('logs'), null],
    ['mods', trif('mods'), /example\.com\/probe/],
    ['help new', trif('help', 'new'), /\w/],
    ['doctor', trif('doctor'), null],
    // a mod saved in the run's working folder: with Claude Code's own Write tool, or (Codex) TRIF's write_file
    CX ? ['write a mod (TRIF\'s write_file)', tool('write_file', { path: 'sites/example.com/hello.js', content: MOD }), /^wrote sites\/example\.com\/hello\.js/m]
      : ['write a mod', { tool: 'Write', input: { file_path: copy('sites', 'example.com', 'hello.js'), content: MOD } }, /created successfully|updated/i],
    ['check the mod', trif('check', 'example.com/hello'), /^ok: /m],
    ['mods again', trif('mods'), /example\.com\/hello/],
    ...(CX ? [
      ['read_file', tool('read_file', { path: 'sites/example.com/hello.js' }), /@name Hello/],
      ['read_file: the guide', tool('read_file', { path: 'AGENTS.md', limit: 20 }), /\w/],
      ['edit_file', tool('edit_file', { path: 'sites/example.com/hello.js', old: '"hello";', new: '"hello";' }), /^changed sites\/example\.com\/hello\.js/m],
      ['list_files', tool('list_files', { path: 'sites', depth: 2 }), /sites\/example\.com\/hello\.js[\s\S]*sites\/other\.net\/keep\.js/],
      ['search_files', tool('search_files', { pattern: '@name', path: 'sites/example.com' }), /sites\/example\.com\/hello\.js:2: /],
    ] : []),
    ['run code with standard input', CX ? tool('trif', { args: ['check', '-'], stdin: 'let a = 1;\n' }) : { tool: 'mcp__trif__trif', input: { args: ['check', '-'], stdin: 'let a = 1;\n' } }, null],
  ];
  refusals = [
    // through the tool: its words are arguments, never commands; another site's tab; a file elsewhere
    ['the tool: words that would be a second command in a shell (they\'re only words)', trif('status', '&', 'type', secretFile), 'any'],
    ['the tool: a word with a command in it', trif('status', `$(type "${secretFile}")`, '`whoami`', '| more'), 'any'],
    ['the tool: another site\'s tab', trif('text', '--tab', '13'), 'trif'],
    ['the tool: check a file elsewhere', trif('check', secretFile), 'trif'],
    ['the tool: a command that isn\'t for runs', trif('agent', 'key', '--agent', AGENT), 'trif'],
    ['the tool: another workspace', trif('--home', path.join(home, 'Documents'), 'status'), 'any'],
    ...(CX ? [
    // TRIF's file tools, done inside the fence
    ['read_file: a file elsewhere in the home folder', tool('read_file', { path: secretFile }), 'files'],
    ['read_file: TRIF\'s settings', tool('read_file', { path: cfgFile }), 'files'],
    ['read_file: the live workspace', tool('read_file', { path: path.join(ws, 'AGENTS.md') }), 'files'],
    ['read_file: out of the working folder by ..', tool('read_file', { path: path.join('..', '..', '..', 'TRIF', 'config.json') }), 'files'],
    ['search_files: the home folder', tool('search_files', { pattern: 'CANARY', path: home }), 'any'],
    ['list_files: a folder elsewhere in the home folder', tool('list_files', { path: path.join(home, 'Documents') }), 'files'],
    ['view_image: a picture elsewhere in the home folder', tool('view_image', { path: outsideImage }), 'files'],
    ['write_file: another site\'s folder', tool('write_file', { path: 'sites/other.net/planted.js', content: '// planted' }), 'files'],
    ['edit_file: another site\'s mod', tool('edit_file', { path: 'sites/other.net/keep.js', old: 'Keep', new: 'Kept' }), 'files'],
    ['write_file: the guide', tool('write_file', { path: 'AGENTS.md', content: 'planted' }), 'files'],
    ['write_file: a file agents read as instructions, in its own site\'s folder', tool('write_file', { path: 'sites/example.com/CLAUDE.md', content: 'planted' }), 'files'],
    ['write_file: the live mods folder', tool('write_file', { path: path.join(ws, 'sites', 'example.com', 'direct.js'), content: '// direct' }), 'files'],
    // Codex's own tools: none that touches the computer
    ['Codex\'s apply_patch, in its own site\'s folder', plant('sites/example.com/patched.js'), 'codex'],
    ['Codex\'s apply_patch, elsewhere in the home folder', plant(path.join(home, 'Documents', 'patched.txt')), 'codex'],
    ['a shell command (shell)', { run: `type "${secretFile}"` }, 'codex'],
    ['a shell command (exec_command)', { call: { name: 'exec_command', arguments: { cmd: `type "${secretFile}"` } } }, 'codex'],
    ['a shell command (shell_command)', { call: { name: 'shell_command', arguments: { command: `type "${secretFile}"` } } }, 'codex'],
    ['Codex\'s own view_image, a picture elsewhere in the home folder', { call: { name: 'view_image', arguments: { path: outsideImage } } }, 'codex'],
    ] : [
    // Claude Code's own file tools
    ['Read a file elsewhere in the home folder', { tool: 'Read', input: { file_path: secretFile } }, 'claude'],
    ['Read TRIF\'s settings', { tool: 'Read', input: { file_path: cfgFile } }, 'claude'],
    ['Read the live workspace', { tool: 'Read', input: { file_path: path.join(ws, 'AGENTS.md') } }, 'claude'],
    ['Grep the home folder', { tool: 'Grep', input: { pattern: 'CANARY', path: home, output_mode: 'content' } }, 'claude'],
    ['Write another site\'s folder', { tool: 'Write', input: { file_path: copy('sites', 'other.net', 'planted.js'), content: '// planted' } }, 'claude'],
    ['Write the guide', { tool: 'Write', input: { file_path: copy('AGENTS.md'), content: 'planted' } }, 'claude'],
    ['Write a file agents read as instructions, in its own site\'s folder', { tool: 'Write', input: { file_path: copy('sites', 'example.com', 'CLAUDE.md'), content: 'planted' } }, 'claude'],
    ['Write the live mods folder', { tool: 'Write', input: { file_path: path.join(ws, 'sites', 'example.com', 'direct.js'), content: '// direct' } }, 'claude'],
    // no shell
    ['a shell command', { bash: `type "${secretFile}"` }, 'notool'],
    ['a web page', { tool: 'WebFetch', input: { url: 'https://example.com/', prompt: 'x' } }, 'notool'],
    ]),
  ];
  script.length = 0;
  script.push(...steps.map((x) => x[1]), ...refusals.map((x) => x[1]), { say: 'done' });
  };

  // ---- the run
  let run = null;
  if (ok) {
    let n = 0;
    const request = async (cmd, args) => { const id = `s${++n}`; ext.send({ type: 'request', id, cmd, args }); return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 60000 }); };
    const listed = await request('agent.list', {});
    const agents = (listed.result && listed.result.agents) || [];
    const c = agents.find((a) => a.id === AGENT);
    check(!!c && c.available, `agent.list: ${NAME} is available for panel chats on Windows (${c ? `${c.path} ${c.version || ''}` : 'not listed'})`, JSON.stringify(agents));
    for (const a of agents.filter((x) => x.id !== AGENT && x.path)) console.log(`      (${a.name}: ${a.available ? 'available' : `not available: ${a.note}`})`);
    const started = await request('agent.start', { agent: AGENT, site: 'example.com', url: 'https://example.com/page', tabId: 12, prompt: 'do the steps', model: CX ? 'standin' : 'claude-haiku-stand-in' });
    if (check(started.ok === true, 'agent.start', started.error)) {
      plan(path.join(boxes, `${started.result.runId}.ws`));
      const done = await ext.next((m) => m.type === 'agentEvent' && m.runId === started.result.runId && m.event.kind === 'done', { timeout: 300000 }).catch((e) => ({ event: { ok: false, error: e.message } }));
      const events = ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === started.result.runId).map((m) => m.event);
      run = { runId: started.result.runId, done: done.event, events };
    }
  }
  // (a tool's answer comes back as text, or as a list of text parts)
  const parts = (list) => list.map((p) => (p && p.text) || '').join('\n');
  const results = (CX ? api.toolOutputs() : api.toolResults()).map((r) => { try { const j = JSON.parse(r); return Array.isArray(j) ? parts(j) : j && Array.isArray(j.content) ? parts(j.content) : r; } catch { return r; } });
  const info = () => `--- the run's events\n${run ? run.events.map((e) => JSON.stringify(e).slice(0, 300)).join('\n').slice(-3000) : '(no run)'}\n--- helper.log\n${helperLog()}`;
  if (run) {
    check(run.done.ok === true, `the run finished: ${NAME}, with no shell, the trif tool and the fence`, `${JSON.stringify(run.done)}\n${info()}`);
    check(results.length === steps.length + refusals.length, `every step got an answer (${results.length} of ${steps.length + refusals.length})`, info());
    console.log('\n  the trif commands a run uses, through the tool, inside the fence:');
    const TROUBLE = /\bEPERM\b|\bEACCES\b|operation not permitted|permission denied|cannot find module|trif-fence:/i;
    steps.forEach(([name, , want], i) => {
      const out = String(results[i] === undefined ? '(no answer)' : results[i]);
      const good = results[i] !== undefined && !TROUBLE.test(out) && !/\(exit status [1-9]/.test(out) && (!want || want.test(out));
      check(good || name === 'run code with standard input', `  ${name}`, out);
      if (name === 'run code with standard input' && !good) console.log(`      (it said: ${out.replace(/\s+/g, ' ').slice(0, 200)})`);
    });
    console.log('\n  what must be refused:');
    refusals.forEach(([name, , by], i) => {
      const out = String(results[steps.length + i] === undefined ? '(no answer)' : results[steps.length + i]);
      check(results[steps.length + i] !== undefined && !out.includes(SECRET) && BY[by].test(out), `  ${name}`, out);
      console.log(`      ${out.replace(/\s+/g, ' ').slice(0, 170)}`);
    });
    // what the run changed, and didn't
    console.log('');
    check(fs.existsSync(path.join(ws, 'sites', 'example.com', 'hello.js')) && fs.readFileSync(path.join(ws, 'sites', 'example.com', 'hello.js'), 'utf8') === MOD, 'the mod it wrote in its working folder is in the mods folder', info());
    check(!!(ext.lastMods() || []).find((m) => m.id === 'example.com/hello'), 'and reached the browser');
    check(fs.existsSync(path.join(ws, 'sites', 'example.com', 'probe.js')), 'so did the mod `trif new` made, from inside the fence');
    check(fs.readdirSync(path.join(ws, 'sites', 'other.net')).join() === 'keep.js', 'another site\'s folder is as it was');
    check(fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8').length > 100 && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'CLAUDE.md')) && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'direct.js')) && !fs.existsSync(path.join(ws, 'sites', 'example.com-planted.js')) && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'patched.js')), 'the guides and the mods folder hold nothing planted');
    check(!fs.existsSync(path.join(home, 'Documents', 'shot.png')) && !fs.existsSync(path.join(home, 'Documents', 'patched.txt')), 'nothing was saved elsewhere in the home folder');
    const requests = JSON.stringify(api.requests.map((q) => q.body));
    check(!requests.includes(SECRET), 'no secret reached the model');
    check(!requests.includes(KEY) && !JSON.stringify(run.events).includes(KEY) && !helperLog().includes(KEY), 'the API key is in no request body, event or log');
    check(api.requests.some((q) => (CX ? q.headers.authorization === `Bearer ${KEY}` : q.headers['x-api-key'] === KEY)), 'the key proxy added the key (from Credential Manager) to the requests');
    if (CX) {
      // What Codex offered the model: TRIF's tools (a namespace's are listed inside it) and nothing that
      // touches the computer. A list of what's known, so a tool a new Codex adds fails here until looked at.
      const offered = offeredTo(api.requests.map((q) => q.body));
      const mine = ['trif', 'read_file', 'write_file', 'edit_file', 'list_files', 'search_files', 'view_image'];
      const known = (t) => mine.some((n) => t === `mcp__trif.${n}` || t === `mcp__trif__${n}`) || CODEX_HARMLESS.includes(t);
      check(offered.every(known) && mine.every((n) => offered.includes(`mcp__trif.${n}`) || offered.includes(`mcp__trif__${n}`)), `the tools Codex had: ${offered.join(', ')}`, `not looked at yet: ${offered.filter((t) => !known(t)).join(', ')}`);
      for (const q of api.requests) { if (q.body && Array.isArray(q.body.tools)) { console.log(`      (as it listed them: ${JSON.stringify(q.body.tools.map((t) => ({ type: t.type, name: t.name, tools: Array.isArray(t.tools) ? t.tools.map((x) => x.name) : undefined }))).slice(0, 1500)})`); break; } }
    }
    const tools = CX ? [] : [...new Set(api.requests.filter((q) => q.body && Array.isArray(q.body.tools)).flatMap((q) => q.body.tools.map((t) => t.name)))].sort();
    // (DeferredToolPlaceholder: Claude Code's own stand-in for a tool whose description it sends later; shown below)
    const extra = tools.filter((t) => !['Edit', 'Glob', 'Grep', 'Read', 'Write', 'mcp__trif__trif', 'DeferredToolPlaceholder'].includes(t));
    if (!CX) check(extra.length === 0 && ['Edit', 'Glob', 'Grep', 'Read', 'Write', 'mcp__trif__trif'].every((t) => tools.includes(t)), `the tools Claude Code had: ${tools.join(', ')}`);
    for (const q of CX ? [] : api.requests) { const d = q.body && Array.isArray(q.body.tools) && q.body.tools.find((t) => t.name === 'DeferredToolPlaceholder'); if (d) { console.log(`      DeferredToolPlaceholder: ${JSON.stringify(d).slice(0, 500)}`); break; } }

    // ---- programs started in the run's own container, while it was going
    console.log('\n  from a program in the run\'s own container (the helper\'s launcher and spec), while the run was going:');
    if (inside.error || !inside.spec) check(false, '  the run\'s container could be probed', inside.error || 'the run never asked the extension for its status');
    else {
      console.log(`      container ${inside.spec.name}; lpac ${inside.spec.lpac}; capabilities ${inside.spec.capability}, ${(inside.spec.capabilities || []).join(', ')}`);
      const refused = (v) => /REFUSED|ERROR|CRED-ERROR/.test(String(v)) && !String(v).includes(SECRET) && !String(v).includes(KEY);
      check(/OUT # /.test(inside.own) || /OUT/.test(inside.own), `  reads its working folder (${String(inside.own).slice(0, 60)})`);
      check(/OUT written/.test(inside.ownSite), `  writes its own site's folder (${inside.ownSite})`);
      for (const [k, what] of [['secret', 'a file elsewhere in the home folder'], ['settings', 'TRIF\'s settings in the private folder'], ['liveState', 'the live workspace'], ['liveMods', 'writing the live mods folder'],
        ['otherSite', 'writing another site\'s folder in its copy'], ['guide', 'writing the guide in its copy'], ['loopback', 'a server on this computer (127.0.0.1)'], ['proxy', 'the model\'s address (the stand-in API) on this computer'],
        ['internet', 'the internet (1.1.1.1:443)'], ['dns', 'a name lookup (example.com)']]) {
        check(refused(inside[k]), `  refused: ${what} (${String(inside[k]).replace(/\s+/g, ' ').slice(0, 80)})`);
      }
      check(inside.credOutside.includes(`CRED[${KEY.slice(0, 10)}`) || inside.credOutside.includes(KEY), '  (outside the container the same program reads the API key in Credential Manager)', inside.credOutside.replace(KEY, '<the key>'));
      check(/CRED-ERROR/.test(inside.cred) && !inside.cred.includes(KEY), `  refused: the API key in Credential Manager (${inside.cred.replace(/\s+/g, ' ').slice(0, 80)})`);
      check(/OPEN-LIMITED-ERROR|WMI-ERROR/.test(inside.helperProcess) && !/KERNEL\[/.test(inside.helperProcess), `  refused: the helper's command line (${inside.helperProcess.replace(/\s+/g, ' ').slice(0, 80)})`);
      check(/CLIPBOARD-ERROR|no answer/.test(inside.clip), `  refused: the clipboard (${inside.clip.replace(/\s+/g, ' ').slice(0, 80)})`);
    }
    await new Promise((r) => setTimeout(r, 500));
    check(localHits === 0, `the server on this computer heard nothing from the run (${localHits})`);
    // ---- afterwards: the fence is taken down
    await new Promise((r) => setTimeout(r, 3000));
    const left = fs.existsSync(boxes) ? fs.readdirSync(boxes) : [];
    check(left.length === 0, `afterwards the run's mailbox, working folder and own folder are gone (${left.join(', ') || 'nothing left'})`);
    const exe = path.join(ws, 'bin', fs.readdirSync(path.join(ws, 'bin')).find((n) => /^trif-fence-[0-9a-f]+\.exe$/.test(n)));
    const sid = inside.spec ? String(spawnSync(exe, ['sid', inside.spec.name], { encoding: 'utf8' }).stdout || '').trim() : '';
    const shots = path.join(priv, 'screenshots', 'example.com');
    const sddl = (d) => String(spawnSync(exe, ['sddl', d], { encoding: 'utf8' }).stdout || '');
    if (sid) spawnSync(exe, ['delete', inside.spec.name]); // (asking for its SID made the profile again)
    check(!!sid && fs.existsSync(shots) && !sddl(shots).includes(sid) && !sddl(path.join(ws, 'sites')).includes(sid), 'and its entries are off the screenshots folder and the mods folder');
    check(/agent run \S+: fenced \(trif\.run\./.test(helperLog()), 'the helper\'s log says the run was fenced', helperLog());
  }

  // ---- Codex's sub-agents: what does one start with? (For information until it's been read: the tools a
  // sub-agent is offered, and what each of its attempts came to. Nothing may get out either way.)
  if (CX && run && run.done.ok === true) {
    console.log('\n  a sub-agent of Codex\'s (multi_agent_v1.spawn_agent), in a second run:');
    const first = api.requests.find((q) => q.body && Array.isArray(q.body.tools));
    const ns = first && first.body.tools.find((t) => t.name === 'multi_agent_v1');
    console.log(`      (its tools, as Codex describes them: ${JSON.stringify(ns || null).slice(0, 4000)})`);
    const before = api.requests.length;
    const child = [];
    let childStep = 0;
    let spawned = false;
    let waited = 0;
    let spawnOut = '';
    const attacks = [
      { run: `type "${secretFile}"` },
      { call: { name: 'exec_command', arguments: { cmd: `type "${secretFile}"` } } },
      { custom: { name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${path.join(home, 'Documents', 'patched-by-child.txt')}\n+// planted\n*** End Patch\n` } },
      { custom: { name: 'apply_patch', input: '*** Begin Patch\n*** Add File: sites/example.com/patched-by-child.js\n+// planted\n*** End Patch\n' } },
      { call: { name: 'view_image', arguments: { path: outsideImage } } },
      { call: { namespace: 'mcp__trif', name: 'read_file', arguments: { path: secretFile } } },
      { call: { namespace: 'mcp__trif', name: 'write_file', arguments: { path: 'sites/other.net/planted-by-child.js', content: '// planted' } } },
      { call: { namespace: 'mcp__trif', name: 'trif', arguments: { args: ['text', '--tab', '13'] } } },
      { say: 'child done' },
    ];
    const outputs = (j) => (Array.isArray(j && j.input) ? j.input : []).filter((i) => i && (i.type === 'function_call_output' || i.type === 'custom_tool_call_output')).map((i) => (typeof i.output === 'string' ? i.output : JSON.stringify(i.output)));
    pick = (j) => {
      const input = Array.isArray(j && j.input) ? j.input : [];
      // (the parent's requests carry its call to spawn_agent from then on; a sub-agent's don't)
      if (spawned && !input.some((i) => i && i.type === 'function_call' && i.name === 'spawn_agent')) { child.push(j); return attacks[Math.min(childStep++, attacks.length - 1)]; }
      if (!spawned) { spawned = true; return { call: { namespace: 'multi_agent_v1', name: 'spawn_agent', arguments: { message: 'do the steps' } } }; }
      spawnOut = outputs(j)[0] || '';
      const id = (/"(?:agent_id|id|agent_path|thread_id|target)"\s*:\s*"([^"]+)"/.exec(spawnOut) || [])[1];
      if (id && waited++ < 4) return { call: { namespace: 'multi_agent_v1', name: 'wait_agent', arguments: { targets: [id], ids: [id], timeout_ms: 60000 } } };
      return { say: 'done' };
    };
    const id = 'sub1';
    ext.send({ type: 'request', id, cmd: 'agent.start', args: { agent: AGENT, site: 'example.com', url: 'https://example.com/page', tabId: 12, prompt: 'start a helper', model: 'standin' } });
    const started = await ext.next((m) => m.type === 'response' && m.id === id, { timeout: 60000 });
    if (check(started.ok === true, '  a second run started', started.error)) {
      const done = await ext.next((m) => m.type === 'agentEvent' && m.runId === started.result.runId && m.event.kind === 'done', { timeout: 300000 }).catch((e) => ({ event: { ok: false, error: e.message } }));
      console.log(`      the run ended: ${JSON.stringify(done.event).slice(0, 300)}`);
      console.log(`      spawn_agent answered: ${String(spawnOut).replace(/\s+/g, ' ').slice(0, 600)}`);
      const parentOut = outputs(([...api.requests].reverse().find((q) => q.body && Array.isArray(q.body.input) && !child.includes(q.body)) || {}).body);
      parentOut.slice(1).forEach((o) => console.log(`      wait_agent answered: ${String(o).replace(/\s+/g, ' ').slice(0, 400)}`));
      console.log(`      requests from a sub-agent: ${child.length}; the tools it was offered: ${offeredTo(child).join(', ') || '(none listed)'}`);
      outputs(child[child.length - 1]).forEach((o, i) => console.log(`      its attempt ${i + 1} (${JSON.stringify(attacks[i].call || attacks[i].custom || attacks[i]).slice(0, 90)}): ${String(o).replace(/\s+/g, ' ').slice(0, 220)}`));
    }
    pick = null;
    const later = JSON.stringify(api.requests.slice(before).map((q) => q.body));
    check(!later.includes(SECRET), '  no secret reached the model from that run or its sub-agent');
    check(!fs.existsSync(path.join(home, 'Documents', 'patched-by-child.txt')) && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'patched-by-child.js')) && fs.readdirSync(path.join(ws, 'sites', 'other.net')).join() === 'keep.js', '  and nothing was planted');
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ---- tidy up
  await ext.close().catch(() => {});
  await api.close();
  localServer.close();
  if (savedKey) { try { await keys.removeAgentKey(AGENT, {}); } catch (e) { console.log(`(the made-up key couldn't be removed: ${e.message})`); } }
  try { fs.rmSync(S, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* left in the temp folder */ }
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
