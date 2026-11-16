#!/usr/bin/env node
'use strict';
// What the coding agents themselves do on Windows, tried for real on a windows-latest runner (docs/WINDOWS.md
// "The sandbox"). Exploration: it prints what it finds and never fails the job.
//
//   Claude Code   started as TRIF starts it, against a stand-in for Anthropic's API (no account, no paid
//                 call) that asks for one Bash command: how the command is run (which shell), and what a
//                 CLAUDE_CODE_SHELL_PREFIX program is handed, since that's where a fence would go.
//   Codex         `codex sandbox` (no model): its own Windows sandbox, each kind it has, with TRIF's
//                 permission profile, running the same probe as the AppContainer prototype.
//
// Windows only, GitHub Actions only (or --yes-this-computer).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

if (process.platform !== 'win32') { console.error('windows-fence agents: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--yes-this-computer')) { console.error('windows-fence agents: runs on GitHub Actions; elsewhere pass --yes-this-computer.'); process.exit(2); }

const REPO = path.resolve(__dirname, '..', '..');
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const sys = (n) => path.join(SYSROOT, 'System32', n);
const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const show = (label, text, max = 3000) => console.log(`--- ${label}\n${String(text || '').trim().slice(0, max)}\n`);
const { findExecutable } = require(path.join(REPO, 'helper', 'lib', 'agents', 'util'));

function which(name) {
  const dirs = String(process.env.PATH || '').split(';').filter(Boolean);
  return findExecutable(name, dirs, { platform: 'win32' });
}
// A .cmd shim (npm's) can't be spawned by itself: through cmd.exe, as the helper would have to.
function runTool(file, args, opts = {}) {
  const viaCmd = /\.(cmd|bat)$/i.test(file);
  const q = (a) => (/[\s"&|<>^()%!]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
  const r = viaCmd
    ? spawnSync(process.env.ComSpec || sys('cmd.exe'), ['/d', '/s', '/c', `"${[file, ...args].map(q).join(' ')}"`], { encoding: 'utf8', timeout: 180000, windowsVerbatimArguments: true, ...opts })
    : spawnSync(file, args, { encoding: 'utf8', timeout: 180000, ...opts });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), error: r.error ? r.error.message : null };
}

async function claudeCode(base) {
  console.log('\n================ Claude Code');
  const bin = which('claude');
  if (!bin) { console.log('claude not found on PATH'); return; }
  console.log(`claude: ${bin}`);
  show('claude --version', runTool(bin, ['--version']).stdout);
  const { startFakeAnthropic } = require(path.join(REPO, 'tests', 'fake-anthropic-server'));
  const work = path.join(base, 'claude-ws');
  put(path.join(work, 'sites', 'x.com', 'a.js'), '// a');
  put(path.join(work, 'AGENTS.md'), '# guide');
  const log = path.join(base, 'prefix.log');
  // The prefix program: a sh script (Claude Code's Bash tool is Git Bash here) that writes down what it was
  // handed, then runs it.
  const prefix = path.join(base, 'prefix.sh');
  fs.writeFileSync(prefix, `#!/bin/sh\n{ printf 'ARGC %s\\n' "$#"; i=0; for a in "$@"; do i=$((i+1)); printf 'ARG%s <<%s>>\\n' "$i" "$a"; done; printf 'CWD %s\\n' "$(pwd)"; printf 'SHELL0 %s\\n' "$0"; } >> '${log.replace(/\\/g, '/')}'\neval "$@"\n`);
  // What Claude Code's own file tools do with TRIF's rules on Windows (they run outside any fence, on a Mac
  // too: only its permission rules hold them): a secret elsewhere in the home folder, by several spellings.
  const CANARY = `CANARY-${rand(8)}`;
  const outside = path.join(base, 'home', 'secret.txt');
  put(outside, `${CANARY} home`);
  put(path.join(work, 'held.json'), '{}');
  try { fs.symlinkSync(path.join(base, 'home'), path.join(work, 'sites', 'x.com', 'j'), 'junction'); } catch (e) { console.log(`(no junction: ${e.message})`); }
  const short = (() => { // the 8.3 spelling of the secret's path, if this volume has one
    const r = spawnSync(sys('cmd.exe'), ['/d', '/c', `for %I in ("${outside}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true });
    return String(r.stdout || '').trim() || outside;
  })();
  console.log(`secret: ${outside}\n8.3 spelling: ${short}`);
  const mcpLog = path.join(base, 'mcp.log');
  const mcpConfig = path.join(base, 'mcp.json');
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { trif: { command: process.execPath, args: [path.join(__dirname, 'mcp-echo.js'), mcpLog] } } }));
  // The MCP server again, this time started inside the fence (an AppContainer: tests/windows-fence/fence.cs):
  // Claude Code starts the launcher, the launcher starts node in the container, their pipes joined.
  const { build } = require('./build');
  const fenceExe = build(path.join(base, 'bin'));
  const fenced = path.join(base, 'fenced');
  fs.cpSync(__dirname, path.join(fenced, 'app'), { recursive: true });
  fs.mkdirSync(path.join(fenced, 'node'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(fenced, 'node', 'node.exe'));
  fs.mkdirSync(path.join(fenced, 'box', 'tmp'), { recursive: true });
  const fencedSpec = path.join(base, 'fenced-spec.json');
  fs.writeFileSync(fencedSpec, JSON.stringify({
    name: `trif.run.${rand()}`, capability: 'trifRunCode.agents', revoke: true, cwd: path.join(fenced, 'box'),
    env: { SystemRoot: SYSROOT, SystemDrive: process.env.SystemDrive || 'C:', windir: SYSROOT, ComSpec: sys('cmd.exe'), PATH: path.join(SYSROOT, 'System32'), TEMP: path.join(fenced, 'box', 'tmp'), TMP: path.join(fenced, 'box', 'tmp'), USERPROFILE: path.join(fenced, 'box'), APPDATA: path.join(fenced, 'box', 'tmp'), LOCALAPPDATA: path.join(fenced, 'box', 'tmp') },
    grant: [{ path: path.join(fenced, 'app'), rights: 'r', to: 'capability' }, { path: path.join(fenced, 'node'), rights: 'r', to: 'capability' }, { path: path.join(fenced, 'box'), rights: 'rw' }],
    command: `"${path.join(fenced, 'node', 'node.exe')}" --preserve-symlinks --preserve-symlinks-main "${path.join(fenced, 'app', 'mcp-echo.js')}" -`,
  }));
  const fencedConfig = path.join(base, 'mcp-fenced.json');
  fs.writeFileSync(fencedConfig, JSON.stringify({ mcpServers: { trif: { command: fenceExe, args: ['run', fencedSpec] } } }));
  const tcp = require('net').createServer((c) => c.destroy());
  await new Promise((r) => tcp.listen(0, '127.0.0.1', r));
  const tcpPort = tcp.address().port;
  const fileRules = ['--allowedTools', 'Read(./**)', 'Edit(./sites/**)'];
  const shots = path.join(base, 'shots');
  put(path.join(shots, 'shot.txt'), 'SHOT-OK');
  put(path.join(work, 'sites', 'y.com', 'other.js'), '// other');
  const shotsDrive = shots.replace(/\\/g, '/');
  const shotsPosix = '/' + shotsDrive[0].toLowerCase() + shotsDrive.slice(2);
  for (const [label, extraEnv, script, extraArgs] of [
    ['no prefix: which shell runs a command', {}, [{ bash: 'echo shell-ok; uname -s; pwd' }, { say: 'done' }], ['--allowedTools', 'Bash(echo:*)', 'Bash(cd:*)', 'Bash(ls:*)', 'Bash(uname:*)', 'Bash(pwd:*)']],
    ['with CLAUDE_CODE_SHELL_PREFIX', { CLAUDE_CODE_SHELL_PREFIX: prefix.replace(/\\/g, '/') }, [{ bash: 'echo prefixed-ok && pwd' }, { bash: 'cd sites && ls' }, { say: 'done' }], ['--allowedTools', 'Bash(echo:*)', 'Bash(cd:*)', 'Bash(ls:*)', 'Bash(pwd:*)']],
    ['a command outside the allowed ones, and tricks in an allowed one', {}, [{ bash: `type "${outside}"` }, { bash: `cat "${outside.replace(/\\/g, '/')}"` }, { bash: `ls $(cat "${outside.replace(/\\/g, '/')}")` }, { bash: `ls; cat "${outside.replace(/\\/g, '/')}"` }, { bash: `ls > "${path.join(base, 'home', 'planted.txt').replace(/\\/g, '/')}"` }, { bash: `ls "${path.join(base, 'home').replace(/\\/g, '/')}"` }, { say: 'done' }], ['--allowedTools', 'Bash(cd:*)', 'Bash(ls:*)']],
    ['its file tools, with Read(./**) and Edit(./sites/**) alone', {}, [
      { tool: 'Read', input: { file_path: path.join(work, 'AGENTS.md') } },
      { tool: 'Read', input: { file_path: outside } },
      { tool: 'Read', input: { file_path: short } },
      { tool: 'Read', input: { file_path: outside.toUpperCase() } },
      { tool: 'Read', input: { file_path: outside.replace(/\\/g, '/') } },
      { tool: 'Read', input: { file_path: `\\\\?\\${outside}` } },
      { tool: 'Read', input: { file_path: path.join(work, 'sites', 'x.com', 'j', 'secret.txt') } },
      { tool: 'Read', input: { file_path: `${path.join(work, 'sites')}\\..\\..\\home\\secret.txt` } },
      { tool: 'Glob', input: { pattern: '**/secret.txt', path: path.join(base, 'home') } },
      { tool: 'Grep', input: { pattern: 'CANARY', path: path.join(base, 'home'), output_mode: 'content' } },
      { tool: 'Grep', input: { pattern: 'CANARY', path: path.join(work, 'sites'), output_mode: 'content' } },
      { tool: 'Write', input: { file_path: path.join(work, 'sites', 'x.com', 'new.js'), content: '// new' } },
      { tool: 'Write', input: { file_path: path.join(work, 'held.json'), content: '{"planted":1}' } },
      { tool: 'Write', input: { file_path: `${path.join(work, 'sites', 'x.com')}\\..\\..\\held.json`, content: '{"planted":2}' } },
      { tool: 'Write', input: { file_path: path.join(work, 'SITES', 'X.COM', 'upper.js'), content: '// upper' } },
      { tool: 'Write', input: { file_path: path.join(work, 'sites', 'x.com', 'j', 'planted.txt'), content: 'planted' } },
      { tool: 'Write', input: { file_path: path.join(base, 'home', 'planted2.txt'), content: 'planted' } },
      { say: 'done' }], fileRules],
    // How a rule names a folder outside the working folder on Windows (the run's screenshots folder): each
    // spelling alone, then a read of a file there.
    ...[['/' + shotsPosix + '/**', 'two slashes, c/Users/… (//c/Users/…)'], [shotsPosix + '/**', 'one slash, /c/Users/…'], ['//' + shotsDrive + '/**', 'two slashes, C:/Users/…'], ['/' + shotsDrive + '/**', 'one slash, C:/Users/…'], [shotsDrive + '/**', 'C:/Users/…'], [shots + '\\**', 'C:\\Users\\…']]
      .map(([rule, label]) => [`a rule for a folder elsewhere, spelled with ${label}: Read(${rule})`, {}, [{ tool: 'Read', input: { file_path: path.join(shots, 'shot.txt') } }, { tool: 'Read', input: { file_path: outside } }, { say: 'done' }], ['--allowedTools', 'Read(./**)', `Read(${rule})`]]),
    // And a deny inside an allow, relative: another site's folder.
    ['Edit(./sites/**) allowed, Edit(./sites/y.com/**) denied', {}, [{ tool: 'Write', input: { file_path: path.join(work, 'sites', 'y.com', 'planted.js'), content: '// planted' } }, { tool: 'Write', input: { file_path: path.join(work, 'sites', 'Y.COM', 'planted2.js'), content: '// planted' } }, { tool: 'Write', input: { file_path: path.join(work, 'sites', 'x.com', 'ok.js'), content: '// ok' } }, { tool: 'Write', input: { file_path: path.join(work, 'sites', 'x.com', 'CLAUDE.md'), content: 'planted' } }, { say: 'done' }], ['--allowedTools', 'Read(./**)', 'Edit(./sites/**)', '--disallowedTools', 'Edit(./sites/y.com/**)', 'Edit(./sites/**/CLAUDE.md)', 'WebFetch']],
    ['no Bash at all; TRIF\'s commands as an MCP tool', {}, [{ tool: 'mcp__trif__trif', input: { args: ['status', '--json'] } }, { bash: 'echo should-not-run' }, { say: 'done' }], ['--mcp-config', mcpConfig, '--allowedTools', 'mcp__trif__trif', '--tools', 'Read,Edit,Write,Glob,Grep']],
    ['the same, with the MCP server inside the AppContainer fence', {}, [{ tool: 'mcp__trif__trif', input: { args: ['status'] } }, { tool: 'mcp__trif__trif', input: { args: ['try', outside, String(tcpPort)] } }, { say: 'done' }], ['--mcp-config', fencedConfig, '--allowedTools', 'mcp__trif__trif', '--tools', 'Read,Edit,Write,Glob,Grep']],
  ]) {
    const api = await startFakeAnthropic({ script });
    const cfg = path.join(base, `claude-config-${rand()}`);
    fs.mkdirSync(cfg, { recursive: true });
    const env = { ...process.env, ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: 'trif-stand-in-key', CLAUDE_CONFIG_DIR: cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...extraEnv };
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT)$/.test(k)) delete env[k];
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--setting-sources', 'project', '--strict-mcp-config',
      ...(extraArgs.includes('--tools') ? [] : ['--tools', 'Read,Edit,Write,Glob,Grep,Bash']), '--disable-slash-commands', ...extraArgs, '--model', 'claude-haiku-stand-in'];
    const r = await new Promise((resolve) => {
      const viaCmd = /\.(cmd|bat)$/i.test(bin);
      const child = viaCmd ? spawn(process.env.ComSpec || sys('cmd.exe'), ['/d', '/s', '/c', `""${bin}" ${args.map((a) => (/[\s()*:,]/.test(a) ? `"${a}"` : a)).join(' ')}"`], { cwd: work, env, windowsVerbatimArguments: true })
        : spawn(bin, args, { cwd: work, env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const t = setTimeout(() => { try { spawnSync(sys('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F']); } catch { /* gone */ } }, 120000);
      child.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
      child.on('error', (e) => { clearTimeout(t); resolve({ status: null, stdout, stderr: stderr + e.message }); });
      child.stdin.end('run the command');
    });
    console.log(`\n>>> ${label}: exit ${r.status}; requests to the stand-in: ${api.requests.length}`);
    const init = r.stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const sysInit = init.find((m) => m.type === 'system' && m.subtype === 'init');
    if (sysInit) console.log(`tools offered: ${(sysInit.tools || []).join(', ')}\ncwd: ${sysInit.cwd}; permissionMode: ${sysInit.permissionMode}; version: ${sysInit.claude_code_version || ''}`);
    const results = api.toolResults();
    const asked = script.filter((x) => x.bash !== undefined || x.tool !== undefined).map((x) => (x.bash !== undefined ? `Bash: ${x.bash}` : `${x.tool}: ${JSON.stringify(x.input)}`));
    console.log(asked.map((q, i) => `  asked   ${q.slice(0, 300)}\n  got     ${String(results[i] === undefined ? '(no result)' : results[i]).replace(/\s+/g, ' ').slice(0, 300)}${String(results[i] || '').includes('CANARY') ? '   <== THE CANARY' : ''}`).join('\n'));
    const result = init.find((m) => m.type === 'result');
    if (result) show('result', JSON.stringify({ subtype: result.subtype, is_error: result.is_error, result: String(result.result || '').slice(0, 300), denials: result.permission_denials }));
    else show('stdout (no result line)', r.stdout.slice(-1500));
    if (r.stderr.trim()) show('stderr', r.stderr.slice(-1500));
    await api.close();
  }
  tcp.close();
  console.log(`afterwards: held.json = ${fs.readFileSync(path.join(work, 'held.json'), 'utf8')}; planted outside: ${['planted.txt', 'planted2.txt'].filter((n) => fs.existsSync(path.join(base, 'home', n))).join(', ') || 'nothing'}; sites/x.com: ${fs.readdirSync(path.join(work, 'sites', 'x.com')).join(', ')}`);
  show('the MCP server\'s log', fs.existsSync(mcpLog) ? fs.readFileSync(mcpLog, 'utf8') : '(never started)', 2500);
  show('what the prefix program was handed (prefix.log)', fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '(nothing: the prefix was never run)', 6000);
}

function codexProfile(layout) {
  const { permissionsToml } = (() => {
    // (codex.js keeps permissionsToml to itself: the same table, from its command())
    const codex = require(path.join(REPO, 'helper', 'lib', 'agents', 'codex'));
    const c = codex.command({ bin: 'codex', prompt: 'x', readable: layout.readable, writable: layout.writable, readOnly: layout.readOnly, denied: layout.denied, tmp: layout.tmp });
    const i = c.args.findIndex((a) => a.startsWith('permissions='));
    return { permissionsToml: c.args[i] };
  })();
  return permissionsToml;
}

async function codex(base, where = 'inside the user\'s profile folder') {
  console.log(`\n================ Codex, its files ${where}: ${base}`);
  const bin = which('codex');
  if (!bin) { console.log('codex not found on PATH'); return; }
  console.log(`codex: ${bin}`);
  show('codex --version', runTool(bin, ['--version']).stdout);
  // (whether its shell can be switched off, as Claude Code's Bash can: what it calls its features)
  if (!where.startsWith('outside')) show('codex features list (those about its shell, tools and sandboxes)', (runTool(bin, ['features', 'list']).stdout || '').split(/\r?\n/).filter((l) => /shell|exec|tool|sandbox|mxc|unified|apply_patch|mcp/i.test(l)).join('\n'), 8000);
  // The same layout as run.js, smaller: a working folder, a mailbox, a secret elsewhere, the private folder.
  const CANARY = `CANARY-${rand(8)}`;
  const home = path.join(base, 'cx', 'home');
  put(path.join(home, 'secret.txt'), `${CANARY} home`);
  const priv = path.join(base, 'cx', 'private');
  put(path.join(priv, 'config.json'), `${CANARY} private`);
  const stage = path.join(base, 'cx', 'boxes', 'r1.ws');
  put(path.join(stage, 'AGENTS.md'), '# guide');
  put(path.join(stage, 'sites', 'x.com', 'own.js'), '// own');
  put(path.join(stage, 'sites', 'y.com', 'other.js'), '// other');
  const box = path.join(base, 'cx', 'boxes', 'r1');
  fs.mkdirSync(path.join(box, 'tmp'), { recursive: true });
  const app = path.join(base, 'cx', 'app');
  fs.cpSync(__dirname, path.join(app, 'fence-test'), { recursive: true });
  const probe = path.join(app, 'fence-test', 'probe.js');
  const profileCanary = path.join(os.homedir(), `trif-fence-canary-${rand()}.txt`);
  fs.writeFileSync(profileCanary, `${CANARY} profile`);
  const net = require('net');
  let hits = 0;
  const server = net.createServer((s) => { hits++; s.destroy(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ops = [
    { id: 'read its working folder', expect: 'allow', op: 'read', path: path.join(stage, 'AGENTS.md') },
    { id: 'write a mod for its site', expect: 'allow', op: 'write', path: path.join(stage, 'sites', 'x.com', 'new.js') },
    { id: 'write its mailbox', expect: 'allow', op: 'write', path: path.join(box, 'req.json') },
    { id: 'read a file elsewhere in the home folder (listed as denied)', expect: 'deny', op: 'read', path: path.join(home, 'secret.txt') },
    { id: 'read TRIF\'s private folder (listed as denied)', expect: 'deny', op: 'read', path: path.join(priv, 'config.json') },
    { id: 'read a file in the real profile folder (listed as denied)', expect: 'deny', op: 'read', path: profileCanary },
    { id: 'list the real profile folder (not listed)', expect: 'info', op: 'list', path: os.homedir() },
    { id: 'change another site\'s mod (read-only)', expect: 'deny', op: 'append', path: path.join(stage, 'sites', 'y.com', 'other.js') },
    { id: 'change the guide', expect: 'deny', op: 'append', path: path.join(stage, 'AGENTS.md') },
    { id: 'write elsewhere in the home folder', expect: 'deny', op: 'write', path: path.join(home, 'planted.txt') },
    { id: 'write the real profile folder', expect: 'deny', op: 'write', path: path.join(os.homedir(), `trif-fence-planted-${rand()}.txt`) },
    { id: 'connect to the internet (1.1.1.1:443)', expect: 'deny', op: 'tcp', host: '1.1.1.1', port: 443 },
    { id: 'look up a name (example.com)', expect: 'deny', op: 'dns', host: 'example.com' },
    { id: 'connect to a server on this computer (127.0.0.1)', expect: 'deny', op: 'tcp', host: '127.0.0.1', port },
    { id: 'who it is (whoami /groups)', expect: 'info', op: 'whoami' },
  ];
  const cfgFile = path.join(box, 'probe.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ops }));
  const nodeDir = path.dirname(process.execPath);
  const permissions = codexProfile({ readable: [stage, app, nodeDir], writable: [path.join(stage, 'sites'), box], readOnly: [path.join(stage, 'sites', 'y.com')], denied: [home, priv, profileCanary], tmp: path.join(box, 'tmp') });
  show('TRIF\'s permission profile for this layout', permissions, 1500);
  const codexHome = path.join(base, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const env = { ...process.env, CODEX_HOME: codexHome };
  for (const kind of ['unelevated', 'elevated', 'mxc']) {
    if (kind !== 'elevated' && where.startsWith('outside')) continue;
    console.log(`\n>>> windows.sandbox = "${kind}"`);
    if (kind === 'elevated') {
      const s = runTool(bin, ['sandbox', 'setup', '--elevated', '--current-user'], { env, timeout: 240000 });
      show('codex sandbox setup --elevated --current-user', `exit ${s.status}\n${s.stdout}\n${s.stderr}`, 2000);
    }
    const args = ['-c', `windows.sandbox="${kind}"`, '-c', 'default_permissions="trif-run"', '-c', permissions, 'sandbox', '-P', 'trif-run', '-C', stage, '--', process.execPath, probe, cfgFile];
    const r = runTool(bin, args, { env, cwd: stage });
    const m = /FENCE-PROBE (\{.*\})/.exec(r.stdout);
    if (!m) { show(`the probe didn't finish (exit ${r.status})`, `${r.stdout.slice(-1500)}\n${r.stderr.slice(-2500)}\n${r.error || ''}`, 4000); continue; }
    const got = JSON.parse(m[1]);
    for (const o of ops) {
      const res = got[o.id] || { ok: false, why: 'not run' };
      const through = !!res.ok;
      const verdict = o.expect === 'info' ? 'info' : (o.expect === 'allow') === through ? 'PASS' : 'FAIL';
      const detail = through ? (res.got !== undefined ? String(res.got).replace(/\s+/g, ' ').slice(0, o.op === 'whoami' ? 1500 : 100) : '') : String(res.why || '').slice(0, 100);
      console.log(`  ${verdict.padEnd(4)} ${through ? 'got through' : 'refused    '}  ${o.id}${detail ? `  — ${detail}` : ''}`);
    }
    console.log(`  (outside) the server on this computer saw ${hits} connection(s)`);
    hits = 0;
    for (const f of [path.join(stage, 'sites', 'x.com', 'new.js'), path.join(box, 'req.json')]) fs.rmSync(f, { force: true });
    if (r.stderr.trim()) show('stderr', r.stderr, 1200);
  }
  server.close();
  fs.rmSync(profileCanary, { force: true });
}

// Codex without its shell: which tools it has under which settings (`codex debug prompt-input`: no model),
// then real runs against a stand-in model that calls an MCP tool, apply_patch and the shell.
async function codexTools(base) {
  console.log('\n================ Codex: its tools, and a run without its shell');
  const bin = which('codex');
  if (!bin) { console.log('codex not found on PATH'); return; }
  const codexAdapter = require(path.join(REPO, 'helper', 'lib', 'agents', 'codex'));
  const work = path.join(base, 'cxt', 'ws');
  put(path.join(work, 'AGENTS.md'), '# guide');
  put(path.join(work, 'held.json'), '{}');
  put(path.join(work, 'sites', 'x.com', 'a.js'), '// a');
  put(path.join(work, 'sites', 'y.com', 'other.js'), '// other');
  const box = path.join(base, 'cxt', 'box');
  fs.mkdirSync(path.join(box, 'tmp'), { recursive: true });
  const outside = put(path.join(base, 'cxt', 'home', 'secret.txt'), 'CANARY outside');
  const codexHome = path.join(base, 'cxt', 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const env = { ...process.env, CODEX_HOME: codexHome };
  const toml = (v) => JSON.stringify(String(v));
  const c = codexAdapter.command({ bin, prompt: 'hi', readable: [work], writable: [path.join(work, 'sites'), box], readOnly: [path.join(work, 'sites', 'y.com')], denied: [path.join(base, 'cxt', 'home')], tmp: path.join(box, 'tmp') });
  const trifConfig = [];
  for (let i = 0; i < c.args.length; i++) if (c.args[i] === '-c') trifConfig.push('-c', c.args[i + 1]);
  const mcp = ['-c', `mcp_servers.trif={ command = ${toml(process.execPath)}, args = [${toml(path.join(__dirname, 'mcp-echo.js'))}, "-"] }`];
  const all = (runTool(bin, ['features', 'list'], { env }).stdout || '').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3);
  console.log(`features on by default: ${all.filter((p) => p[p.length - 1] === 'true').map((p) => p[0]).join(', ')}`);
  const toolsOf = (config) => {
    const r = runTool(bin, ['debug', 'prompt-input', ...config, 'hi'], { env, cwd: work, timeout: 120000 });
    if (r.status !== 0) return { error: `${r.stderr.trim().slice(-400)} ${r.error || ''}` };
    let input;
    try { input = JSON.parse(r.stdout); } catch (e) { return { error: `not JSON: ${r.stdout.slice(0, 300)}` }; }
    const tools = [];
    for (const item of input.filter((x) => x.type === 'additional_tools')) for (const ns of item.tools || []) for (const t of ns.tools || [ns]) tools.push(t);
    return { tools, web: /web_search/.test(r.stdout) };
  };
  const variants = [
    ['as TRIF starts it today', trifConfig],
    ['features.shell_tool=false', [...trifConfig, '-c', 'features.shell_tool=false']],
    ['shell_tool=false, the trif MCP server', [...trifConfig, '-c', 'features.shell_tool=false', ...mcp]],
    ['shell_tool=false, MCP, and every switch that might take the rest away', [...trifConfig, '-c', 'features.shell_tool=false', ...mcp,
      ...['features.code_mode_host=false', 'features.sleep_tool=false', 'features.goals=false', 'features.multi_agent=false', 'features.collab=false', 'features.apply_patch_tool=false', 'include_apply_patch_tool=false', 'tools.view_image=false', 'features.view_image_tool=false', 'features.unified_exec=false', 'features.request_user_input=false'].flatMap((x) => ['-c', x])]],
  ];
  let trifTool = null;
  for (const [label, config] of variants) {
    const t = toolsOf(config);
    if (t.error) { console.log(`\n>>> ${label}: ${t.error}`); continue; }
    console.log(`\n>>> ${label}: ${t.tools.map((x) => `${x.name || '?'}(${x.type || '?'})`).join(', ')}${t.web ? '  [web_search mentioned]' : ''}`);
    for (const x of t.tools) {
      if (/trif/i.test(String(x.name)) && !trifTool) { trifTool = x.name; show(`the MCP tool as Codex offers it (${x.name})`, JSON.stringify(x).slice(0, 700)); }
      if (x.name === 'apply_patch' && label.startsWith('as TRIF')) show('apply_patch as offered', JSON.stringify(x).slice(0, 500));
      if (x.name === 'exec' && label.startsWith('features.shell_tool')) show('exec as offered without the shell (the tools it can call)', [...String(x.description || '').matchAll(/^### `([\w]+)`/gm)].map((m) => m[1]).join(', ') || JSON.stringify(x).slice(0, 400));
    }
  }
  // Real runs, the stand-in model asking for each thing in turn.
  const { startFakeModelServer } = require(path.join(REPO, 'tests', 'fake-model-server'));
  const patch = (file, text) => `*** Begin Patch\n*** Add File: ${file}\n+${text}\n*** End Patch\n`;
  const steps = [
    { call: { name: trifTool || 'mcp__trif__trif', arguments: { args: ['status'] } } },
    { custom: { name: 'apply_patch', input: patch('sites/x.com/new.js', '// new') } },
    { custom: { name: 'apply_patch', input: patch('held.json.planted', 'planted in the workspace root') } },
    { custom: { name: 'apply_patch', input: patch('sites/y.com/planted.js', '// planted in another site') } },
    { custom: { name: 'apply_patch', input: patch(path.join(base, 'cxt', 'home', 'planted.txt'), 'planted outside') } },
    { run: `type "${outside}"` },
    { say: 'done' },
  ];
  for (const [label, extra] of [
    ['no shell, MCP, TRIF\'s profile, Codex\'s sandbox as it comes', []],
    ['the same, windows.sandbox="unelevated"', ['-c', 'windows.sandbox="unelevated"']],
  ]) {
    const api = await startFakeModelServer({ script: steps.map((x) => ({ ...x })), models: ['standin'] });
    const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', ...trifConfig, '-c', 'features.shell_tool=false', ...mcp, ...extra,
      '-c', `model_providers.standin={ name = "Stand-in", base_url = ${toml(`${api.url}/v1`)}, wire_api = "responses" }`, '-c', 'model_provider="standin"', '-m', 'standin', '-'];
    const r = runTool(bin, args, { env, cwd: work, input: 'do the steps', timeout: 180000 });
    console.log(`\n>>> ${label}: exit ${r.status}; requests to the stand-in: ${api.requests.length}`);
    const asked = steps.filter((x) => !x.say).map((x) => (x.call ? `${x.call.name} ${JSON.stringify(x.call.arguments)}` : x.custom ? `apply_patch ${x.custom.input.split('\n')[1]}` : `shell: ${x.run}`));
    const outs = api.toolOutputs();
    console.log(asked.map((q, i) => `  asked   ${q.slice(0, 200)}\n  got     ${String(outs[i] === undefined ? '(no result)' : outs[i]).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n'));
    const events = r.stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    show('what Codex reported', events.filter((e) => e.type === 'item.completed' || e.type === 'error' || e.type === 'turn.failed').map((e) => JSON.stringify(e.item || e).slice(0, 260)).join('\n'), 3500);
    if (r.stderr.trim()) show('stderr', r.stderr.slice(-1200));
    console.log(`  afterwards: sites/x.com: ${fs.readdirSync(path.join(work, 'sites', 'x.com')).join(', ')}; sites/y.com: ${fs.readdirSync(path.join(work, 'sites', 'y.com')).join(', ')}; planted in the root: ${fs.existsSync(path.join(work, 'held.json.planted'))}; planted outside: ${fs.existsSync(path.join(base, 'cxt', 'home', 'planted.txt'))}`);
    for (const f of [path.join(work, 'sites', 'x.com', 'new.js'), path.join(work, 'held.json.planted'), path.join(work, 'sites', 'y.com', 'planted.js'), path.join(base, 'cxt', 'home', 'planted.txt')]) fs.rmSync(f, { force: true });
    await api.close();
  }
}

(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-agents-')));
  console.log(`scratch ${base}`);
  console.log(spawnSync(sys('cmd.exe'), ['/d', '/c', 'ver'], { encoding: 'utf8' }).stdout.trim());
  try { await claudeCode(base); } catch (e) { console.log(`Claude Code: ${e.stack || e.message}`); }
  try { await codexTools(base); } catch (e) { console.log(`Codex's tools: ${e.stack || e.message}`); }
  try { await codex(base); } catch (e) { console.log(`Codex: ${e.stack || e.message}`); }
  // (and somewhere that isn't in anyone's profile folder: the runner's own temp folder, on D:)
  if (process.env.RUNNER_TEMP) { try { await codex(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'trif-agents-')), 'outside any profile folder'); } catch (e) { console.log(`Codex: ${e.stack || e.message}`); } }
  process.exit(0);
})();
