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
const { buildSpy } = require('./windows-fence/build');
const { findExecutable } = require(path.join(REPO, 'helper', 'lib', 'agents', 'util'));
const keys = require(path.join(REPO, 'helper', 'lib', 'agentkeys'));
const fence = require(path.join(REPO, 'helper', 'lib', 'win', 'fence'));

const SECRET = `CANARY-${crypto.randomBytes(8).toString('hex')}`;
const KEY = `sk-ant-standin-${crypto.randomBytes(8).toString('hex')}`;
let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${String(detail).slice(0, 3000).split('\n').join('\n      ')}` : ''}`);
  if (!ok) failed++;
  return !!ok;
}
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const MOD = '// ==WebMod==\n// @name Hello\n// @match https://example.com/*\n// ==/WebMod==\ndocument.title = "hello";\n';

(async () => {
  const claude = findExecutable('claude', String(process.env.PATH || '').split(';').filter(Boolean), { platform: 'win32' });
  if (!check(!!claude, `Claude Code is installed (${claude || 'not on PATH'})`)) process.exit(1);

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
  const cfgFile = path.join(priv, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')), secret: `${SECRET} settings` }));
  put(path.join(ws, 'sites', 'other.net', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://other.net/*\n// ==/WebMod==\n');
  // The made-up API key, in the real Credential Manager, saved as `trif agent key` saves one.
  let savedKey = false;
  try {
    if ((await keys.hasAgentKey('claude', {})).stored) throw new Error('this computer already has an Anthropic key saved by TRIF: not touching it');
    await keys.setAgentKey('claude', KEY, {});
    savedKey = true;
  } catch (e) { check(false, 'a made-up API key saved in Credential Manager', e.message); process.exit(1); }

  // ---- servers on this computer: the stand-in API (reached through the helper's key proxy), and one more
  // that a run must not reach
  const script = [];
  const anthropic = await startFakeAnthropic({ script });
  let localHits = 0;
  const localServer = net.createServer((s) => { localHits++; s.destroy(); });
  await new Promise((r) => localServer.listen(0, '127.0.0.1', r));
  const localPort = localServer.address().port;

  // ---- the real helper, with a stand-in extension
  const ext = new FakeExtension({ home: ws, hostJs: path.join(code, 'helper', 'host.js'), env: {
    ...env, PATH: process.env.PATH, TRIF_HOME: '', TRIF_BOX_ROOT: '', TRIF_KEYCHAIN_BIN: '', TRIF_CLAUDE_MANAGED_DIR: path.join(S, 'no-claude-managed'),
    TRIF_ANTHROPIC_URL: anthropic.url, TRIF_AGENT_TIMEOUT_MS: '240000', TRIF_AGENT_KILL_GRACE_MS: '400',
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
      inside.proxy = js(`const u = new URL(${JSON.stringify(anthropic.url)}); return await new Promise((res, rej) => { const s = require('net').connect({ host: u.hostname, port: Number(u.port) }); s.setTimeout(3000, () => rej(new Error('timeout'))); s.on('connect', () => res('connected')); s.on('error', rej); })`);
      inside.internet = js(`return await new Promise((res, rej) => { const s = require('net').connect({ host: '1.1.1.1', port: 443 }); s.setTimeout(4000, () => rej(new Error('timeout'))); s.on('connect', () => res('connected')); s.on('error', rej); })`);
      inside.dns = js(`return await new Promise((res, rej) => { require('dns').lookup('example.com', (e, a) => (e ? rej(e) : res(a))); setTimeout(() => rej(new Error('timeout')), 6000); })`);
      inside.cred = exec([spy, 'cred', 'TRIF API key/anthropic']);
      inside.helperProcess = exec([spy, 'cmdline', String(ext.child.pid)]);
      inside.clip = exec([spy, 'clip']);
      inside.credOutside = String(spawnSync(spy, ['cred', 'TRIF API key/anthropic'], { encoding: 'utf8' }).stdout || '').trim();
    } catch (e) { inside.error = e.stack || e.message; }
  };
  ext.handlers = {
    tabs: () => tabs,
    // (a moment after answering: the probe takes a few seconds, and the run is still going then)
    status: () => { setImmediate(probeRunsContainer); return { userScripts: true, chrome: '140.0.0.0', version: pkg.version, mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [] }; },
    reload: (a) => ({ url: (tabs.find((t) => t.id === (a.tab ?? a.tabId)) || tabs[0]).url }),
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
  const trif = (...args) => ({ tool: 'mcp__trif__trif', input: { args } });
  const BY = {
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
    // a mod saved with Claude Code's own Write tool, in the run's working folder
    ['write a mod', { tool: 'Write', input: { file_path: copy('sites', 'example.com', 'hello.js'), content: MOD } }, /created successfully|updated/i],
    ['check the mod', trif('check', 'example.com/hello'), /^ok: /m],
    ['mods again', trif('mods'), /example\.com\/hello/],
    ['run code with standard input', { tool: 'mcp__trif__trif', input: { args: ['check', '-'], stdin: 'let a = 1;\n' } }, null],
  ];
  refusals = [
    // through the tool: its words are arguments, never commands; another site's tab; a file elsewhere
    ['the tool: words that would be a second command in a shell', trif('status', '&', 'type', secretFile), 'trif'],
    ['the tool: a word with a command in it', trif('status', `$(type "${secretFile}")`, '`whoami`', '| more'), 'trif'],
    ['the tool: another site\'s tab', trif('text', '--tab', '13'), 'trif'],
    ['the tool: a screenshot saved outside the run\'s folder', trif('screenshot', '-o', path.join(home, 'Documents', 'shot.png')), 'trif'],
    ['the tool: check a file elsewhere', trif('check', secretFile), 'trif'],
    ['the tool: a command that isn\'t for runs', trif('agent', 'key', '--agent', 'claude'), 'trif'],
    ['the tool: another workspace', trif('--home', path.join(home, 'Documents'), 'status'), 'any'],
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
    const c = agents.find((a) => a.id === 'claude');
    check(!!c && c.available, `agent.list: Claude Code is available for panel chats on Windows (${c ? `${c.path} ${c.version || ''}` : 'not listed'})`, JSON.stringify(agents));
    for (const a of agents.filter((x) => x.id !== 'claude' && x.path)) console.log(`      (${a.name}: ${a.available ? 'available' : `not available: ${a.note}`})`);
    const started = await request('agent.start', { agent: 'claude', site: 'example.com', url: 'https://example.com/page', tabId: 12, prompt: 'do the steps', model: 'claude-haiku-stand-in' });
    if (check(started.ok === true, 'agent.start', started.error)) {
      plan(path.join(boxes, `${started.result.runId}.ws`));
      const done = await ext.next((m) => m.type === 'agentEvent' && m.runId === started.result.runId && m.event.kind === 'done', { timeout: 300000 }).catch((e) => ({ event: { ok: false, error: e.message } }));
      const events = ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === started.result.runId).map((m) => m.event);
      run = { runId: started.result.runId, done: done.event, events };
    }
  }
  const results = anthropic.toolResults();
  const info = () => `--- the run's events\n${run ? run.events.map((e) => JSON.stringify(e).slice(0, 300)).join('\n').slice(-3000) : '(no run)'}\n--- helper.log\n${helperLog()}`;
  if (run) {
    check(run.done.ok === true, 'the run finished: Claude Code, with no shell, the trif tool and the fence', `${JSON.stringify(run.done)}\n${info()}`);
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
    check(fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8').length > 100 && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'CLAUDE.md')) && !fs.existsSync(path.join(ws, 'sites', 'example.com', 'direct.js')) && !fs.existsSync(path.join(ws, 'sites', 'example.com-planted.js')), 'the guides and the mods folder hold nothing planted');
    check(!fs.existsSync(path.join(home, 'Documents', 'shot.png')), 'nothing was saved elsewhere in the home folder');
    const requests = JSON.stringify(anthropic.requests.map((q) => q.body));
    check(!requests.includes(SECRET), 'no secret reached the model');
    check(!requests.includes(KEY) && !JSON.stringify(run.events).includes(KEY) && !helperLog().includes(KEY), 'the API key is in no request body, event or log');
    check(anthropic.requests.some((q) => q.headers['x-api-key'] === KEY), 'the key proxy added the key (from Credential Manager) to the requests');
    const tools = [...new Set(anthropic.requests.filter((q) => q.body && Array.isArray(q.body.tools)).flatMap((q) => q.body.tools.map((t) => t.name)))].sort();
    check(tools.join() === ['Edit', 'Glob', 'Grep', 'Read', 'Write', 'mcp__trif__trif'].join(), `the tools Claude Code had: ${tools.join(', ')}`);

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
      check(/CRED\[sk-ant-standin/.test(inside.credOutside) || inside.credOutside.includes(KEY), '  (outside the container the same program reads the API key in Credential Manager)', inside.credOutside.replace(KEY, '<the key>'));
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

  // ---- tidy up
  await ext.close().catch(() => {});
  await anthropic.close();
  localServer.close();
  if (savedKey) { try { await keys.removeAgentKey('claude', {}); } catch (e) { console.log(`(the made-up key couldn't be removed: ${e.message})`); } }
  try { fs.rmSync(S, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* left in the temp folder */ }
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
