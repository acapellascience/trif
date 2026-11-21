#!/usr/bin/env node
'use strict';
// SPIKE, whole-box step 9 (docs/WHOLE-BOX-PROGRESS.md): can Claude Code in TRIF's AppContainer reach TRIF's
// relay with NO administrator step (no loopback exemption) and NO internetClient (the whole internet)?
// The idea: a named pipe whose security names the run's container (pipe-bridge.cs, outside, carries it to
// the relay's port), and inside the container a small shim (box-shim.js) that gives Claude Code a TCP port
// of the container's own to use as its proxy. GitHub's windows-latest only.
//
// The container is the one TRIF's fence makes for a run: less-privileged (lpac) + registryRead, and no
// network capability at all. Then:
//   1. node inside: its own loopback (same process; another process in the same container), the pipes
//      (Node's default security; ours without the container; ours with it, without and with the low label),
//      a port on this computer (127.0.0.1, its own address), and the internet: what opens.
//   2. the same with privateNetworkClientServer (a capability without an administrator): this computer's
//      own address on the network?
//   3. Claude Code (the pinned claude.exe when WBX_CLAUDE_BIN names it, else npm's) in the box, its API a
//      stand-in on this computer reached through shim → pipe → bridge: a normal run (Read, Write, the trif
//      MCP tool), and the box holding (a secret elsewhere, another site).
//   4. WBX_REAL_RELAY=1: the same Claude Code, signed in with a made-up setup-token token, HTTPS_PROXY →
//      shim → pipe → bridge → TRIF's relay → the real api.anthropic.com (401 expected). And a control: its
//      HTTPS_PROXY straight at the relay's 127.0.0.1 port (no pipe): refused, so no exemption is in play.
// Prints what each got; exits 1 if anything got out of the box, and with WBX_STRICT=1 also if the pipe path
// didn't carry the runs. Refuses to run outside GitHub Actions (it makes AppContainer profiles and entries).

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { startFakeAnthropic } = require('../fake-anthropic-server');
const relay = require('../../helper/lib/relay');

if (process.platform !== 'win32') { console.error('win-net-probe: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true') { console.error('win-net-probe: runs on GitHub Actions only'); process.exit(2); }

const SECRET = `SECRET-${crypto.randomBytes(4).toString('hex')}`;
const sys = (n) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', n);
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
// (node in an lpac container can't lstat C:\, which resolving a script's real path does: these skip it)
const NODE_IN = [process.execPath, '--preserve-symlinks', '--preserve-symlinks-main'];
const show = (title, text) => console.log(`\n--- ${title}\n${String(text || '').trim().slice(0, 5000)}`);
let escaped = false;
const verdict = {};

function compile(src, out, refs = []) {
  const r = spawnSync(csc, ['/nologo', '/o+', ...refs.map((x) => `/r:${x}`), `/out:${out}`, path.join(__dirname, src)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`csc ${src}: ${r.stdout}${r.stderr}`);
  return out;
}

function findClaude() {
  if (process.env.WBX_CLAUDE_BIN) return { dir: path.dirname(process.env.WBX_CLAUDE_BIN), argv: [process.env.WBX_CLAUDE_BIN], which: 'TRIF\'s pin' };
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).stdout.trim();
  const pkg = path.join(root, '@anthropic-ai', 'claude-code');
  const exe = [path.join(pkg, 'bin', 'claude.exe')].find((p) => fs.existsSync(p));
  if (!exe) throw new Error(`no claude.exe in ${pkg}`);
  return { dir: pkg, argv: [exe], which: 'npm\'s' };
}

function layout() {
  const base = path.join(os.homedir(), `wbn-${crypto.randomBytes(3).toString('hex')}`);
  const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
  const L = {
    base,
    secret: w(path.join(os.homedir(), `wbn-secret-${path.basename(base)}.txt`), `${SECRET} home`),
    stage: path.join(base, 'stage'),
    own: w(path.join(base, 'stage', 'sites', 'x.com', 'a.user.js'), '// COPY-OK'),
    other: w(path.join(base, 'stage', 'sites', 'other.com', 'b.user.js'), '// other'),
    cfg: path.join(base, 'cfg'), tmp: path.join(base, 'tmp'), box: path.join(base, 'box'), bin: path.join(base, 'bin'),
  };
  for (const d of [L.cfg, L.tmp, L.box, L.bin]) fs.mkdirSync(d, { recursive: true });
  for (const f of ['mcp-echo.js', 'box-shim.js', 'win-inside.js']) fs.copyFileSync(path.join(__dirname, f), path.join(L.box, f));
  return L;
}

function makeSpec(L, claude, { name, capabilities = [] }) {
  const env = {
    SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive, windir: process.env.windir, ComSpec: sys('cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: [sys(''), path.dirname(process.execPath), 'C:\\Program Files\\Git\\cmd'].join(';'), TEMP: L.tmp, TMP: L.tmp,
    USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, HOMEDRIVE: process.env.HOMEDRIVE, HOMEPATH: process.env.HOMEPATH,
    CLAUDE_CONFIG_DIR: L.cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const grant = [
    { path: claude.dir, rights: 'r', to: 'capability', optional: true },
    { path: path.dirname(process.execPath), rights: 'r', to: 'capability', optional: true },
    { path: L.stage, rights: 'r' },
    { path: path.join(L.stage, 'sites'), rights: 'r+mkdir', inherit: false },
    { path: path.join(L.stage, 'sites'), rights: 'rw', inherit: 'only' },
    { path: L.cfg, rights: 'rw' }, { path: L.tmp, rights: 'rw' }, { path: L.box, rights: 'rw' },
    { path: 'C:\\Program Files\\ClaudeCode', rights: 'r', to: 'capability', optional: true },
  ].filter((g) => fs.existsSync(g.path));
  return { name, lpac: true, capability: 'trifWholeBoxNet', capabilities: ['registryRead', ...capabilities], cwd: L.stage, env, job: true, grant, readonly: [path.join(L.stage, 'sites', 'other.com')] };
}

function fenceExec(fence, specFile, argv, { stdin = '', timeout = 120000, env = {} } = {}) {
  const s = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const runSpec = path.join(path.dirname(specFile), `exec-${crypto.randomBytes(3).toString('hex')}.json`);
  fs.writeFileSync(runSpec, JSON.stringify({ ...s, env: { ...s.env, ...env } }));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(fence, ['exec', runSpec, '--', ...argv], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => { spawnSync(sys('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F']); }, timeout);
    child.on('close', (code) => { clearTimeout(t); fs.rmSync(runSpec, { force: true }); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
    child.stdin.end(stdin);
  });
}

// A bridge: a pipe with our own security carried to `port` on 127.0.0.1. Resolves {name, lines(), close()}.
function startBridge(exe, sid, label, port) {
  const name = `trif-wbn-${crypto.randomBytes(12).toString('hex')}`;
  const child = spawn(exe, [name, sid, label, String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`bridge didn't start: ${lines.join(' | ')}`)), 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        lines.push(line);
        if (line.startsWith('listening ')) { clearTimeout(t); resolve({ name: `\\\\.\\pipe\\${name}`, lines: () => lines.slice(), close: () => { child.stdin.end(); setTimeout(() => child.kill(), 500); } }); }
      }
    });
    child.stderr.on('data', (d) => lines.push(`stderr: ${String(d).trim()}`));
    child.on('exit', (c) => { clearTimeout(t); lines.push(`exit ${c}`); reject(new Error(`bridge ended: ${lines.join(' | ')}`)); });
  });
}

function echoServer(host) {
  const hits = [];
  const s = net.createServer((c) => { hits.push(c.remoteAddress); c.on('data', (d) => c.write(`ECHO ${d}`)); c.on('error', () => {}); });
  return new Promise((r) => s.listen(0, host, () => r({ port: s.address().port, hits, close: () => s.close() })));
}

function defaultPipe() {
  const name = `\\\\.\\pipe\\trif-wbn-default-${crypto.randomBytes(8).toString('hex')}`;
  const hits = [];
  const s = net.createServer((c) => { hits.push(1); c.on('data', (d) => c.write(`ECHO ${d}`)); c.on('error', () => {}); });
  return new Promise((r) => s.listen(name, () => r({ name, hits, close: () => s.close() })));
}

function hostAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

async function insideProbe(fence, specFile, L, targets, title) {
  const r = await fenceExec(fence, specFile, [...NODE_IN, path.join(L.box, 'win-inside.js')], { timeout: 90000, env: { WBN_TARGETS: JSON.stringify(targets) } });
  show(`${title} (exit ${r.code}, ${r.ms} ms)`, r.stdout + r.stderr);
  try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return {}; }
}

const claudeArgs = (mcp, extra = []) => ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', mcp,
  '--tools', 'Read,Edit,Write,Glob,Grep', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'mcp__trif__trif',
  '--dangerously-skip-permissions', '--add-dir', os.homedir(), ...extra];

function parseStream(stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { init: lines.find((m) => m.type === 'system' && m.subtype === 'init'), result: lines.find((m) => m.type === 'result') };
}

async function standInRun(fence, bridgeExe, specFile, L, claude, sid) {
  const steps = [
    { tool: 'Read', input: { file_path: L.own } },
    { tool: 'Read', input: { file_path: L.secret } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'x.com', 'new.user.js'), content: '// new' } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'other.com', 'evil.user.js'), content: '// evil' } },
    { tool: 'Write', input: { file_path: path.join(os.homedir(), 'wbn-planted.txt'), content: 'planted' } },
    { tool: 'mcp__trif__trif', input: { args: ['status'] } },
    { say: 'done' },
  ];
  const api = await startFakeAnthropic({ script: steps });
  const port = Number(new URL(api.url).port);
  const b = await startBridge(bridgeExe, sid, 'low', port);
  const mcp = path.join(L.box, 'mcp.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { trif: { command: NODE_IN[0], args: [...NODE_IN.slice(1), path.join(L.box, 'mcp-echo.js')] } } }));
  const r = await fenceExec(fence, specFile, [...NODE_IN, path.join(L.box, 'box-shim.js'), ...claude.argv, ...claudeArgs(mcp, ['--model', 'claude-haiku-stand-in'])],
    { stdin: 'probe', env: { TRIF_SHIM_PIPE: b.name, ANTHROPIC_BASE_URL: 'http://{SHIM}', ANTHROPIC_API_KEY: 'trif-stand-in-key' } });
  const { init, result } = parseStream(r.stdout);
  const got = api.toolResults();
  console.log(`\n>>> the stand-in API through shim → pipe → bridge: exit ${r.code} in ${r.ms} ms; requests: ${api.requests.length}`);
  if (init) console.log(`tools: ${(init.tools || []).join(', ')}; mcp: ${JSON.stringify(init.mcp_servers || [])}`);
  steps.slice(0, -1).forEach((st, i) => console.log(`  ${`${st.tool} ${JSON.stringify(st.input).slice(0, 110)}`.padEnd(120)} -> ${String(got[i] === undefined ? '(no result)' : got[i]).replace(/\s+/g, ' ').slice(0, 200)}${String(got[i] || '').includes(SECRET) ? '   <== SECRET GOT OUT' : ''}`));
  if (got.some((x) => String(x).includes(SECRET))) escaped = true;
  if (fs.existsSync(path.join(L.stage, 'sites', 'other.com', 'evil.user.js')) || fs.existsSync(path.join(os.homedir(), 'wbn-planted.txt'))) { escaped = true; console.log('  <== A WRITE GOT OUT'); }
  const ownWritten = fs.existsSync(path.join(L.stage, 'sites', 'x.com', 'new.user.js'));
  console.log(`  own site written: ${ownWritten}; bridge: ${b.lines().filter((l) => !l.startsWith('listening')).slice(0, 12).join(' | ')}`);
  if (result) console.log(`  result: ${JSON.stringify({ subtype: result.subtype, is_error: result.is_error, result: String(result.result || '').slice(0, 200) })}`);
  else show('stdout (no result line)', r.stdout.slice(-1500));
  if (r.stderr.trim()) show('stderr', r.stderr.slice(-2000));
  b.close();
  await api.close();
  verdict['stand-in run through the pipe'] = !!(result && !result.is_error && api.requests.length && ownWritten && String(got[0] || '').includes('COPY-OK'));
}

async function realRelayRun(fence, bridgeExe, specFile, L, claude, sid) {
  const token = `sk-ant-oat01-${'MadeUpForCI'.repeat(8)}AA`;
  const base = { CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CODE_MAX_RETRIES: '0' };
  const mcp = path.join(L.box, 'mcp-none.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: {} }));
  for (const how of ['control: HTTPS_PROXY at the relay\'s 127.0.0.1 port, no pipe', 'shim → pipe → bridge → relay']) {
    const r0 = await relay.start();
    const viaPipe = how.startsWith('shim');
    const b = viaPipe ? await startBridge(bridgeExe, sid, 'low', r0.port) : null;
    const argv = viaPipe ? [...NODE_IN, path.join(L.box, 'box-shim.js'), ...claude.argv] : claude.argv;
    const env = { ...base, HTTPS_PROXY: viaPipe ? 'http://{SHIM}' : `http://127.0.0.1:${r0.port}`, ...(viaPipe ? { TRIF_SHIM_PIPE: b.name } : {}) };
    const r = await fenceExec(fence, specFile, [...argv, ...claudeArgs(mcp)], { stdin: 'Say hi.', env, timeout: 90000 });
    const { result } = parseStream(r.stdout);
    const api = r0.seen.filter((x) => x.target === 'api.anthropic.com:443' && x.allowed);
    console.log(`\n>>> the real network, ${how}: exit ${r.code} in ${r.ms} ms`);
    console.log(`  relay saw: ${JSON.stringify(r0.seen)}`);
    if (b) console.log(`  bridge: ${b.lines().filter((l) => !l.startsWith('listening')).slice(0, 12).join(' | ')}`);
    console.log(`  result: ${result ? JSON.stringify({ subtype: result.subtype, is_error: result.is_error, result: String(result.result || '').slice(0, 300) }) : '(none)'}`);
    if (!result) show('stdout', r.stdout.slice(-1500));
    if (r.stderr.trim()) show('stderr', r.stderr.slice(-1500));
    const answered = /401|OAuth|authenticat|invalid/i.test(`${r.stdout}\n${r.stderr}`);
    if (viaPipe) verdict['the real Anthropic through the pipe and the relay (401 for the made-up token)'] = api.some((x) => x.down > 0) && answered;
    else verdict['control: the relay\'s port straight from the box is refused'] = !api.length;
    if (b) b.close();
    await r0.close();
  }
}

(async () => {
  const L = layout();
  const fence = compile('fence.cs', path.join(L.bin, 'trif-fence.exe'), ['System.Web.Extensions.dll']);
  const bridgeExe = compile('pipe-bridge.cs', path.join(L.bin, 'trif-pipe-bridge.exe'));
  const claude = findClaude();
  const v = spawnSync(claude.argv[0], ['--version'], { encoding: 'utf8' });
  console.log(`Claude Code (${claude.which}): ${claude.argv[0]}: ${(v.stdout || v.stderr || '').trim()}`);

  const echo = await echoServer('127.0.0.1');
  const echoAll = await echoServer('0.0.0.0');
  const dpipe = await defaultPipe();
  const host = hostAddress();

  const flavors = [
    { name: `trif.wbn.${crypto.randomBytes(3).toString('hex')}`, capabilities: [], title: 'lpac + registryRead, no network capability (TRIF\'s run container)' },
    { name: `trif.wbn.p${crypto.randomBytes(3).toString('hex')}`, capabilities: ['privateNetworkClientServer'], title: 'the same + privateNetworkClientServer' },
  ];
  for (const fl of flavors) {
    console.log(`\n================ ${fl.title}`);
    const specFile = path.join(L.base, `${fl.name}.json`);
    fs.writeFileSync(specFile, JSON.stringify(makeSpec(L, claude, fl)));
    const prep = spawnSync(fence, ['prepare', specFile], { encoding: 'utf8' });
    if (prep.status !== 0) { show('prepare failed', prep.stdout + prep.stderr); continue; }
    const sid = spawnSync(fence, ['sid', fl.name], { encoding: 'utf8' }).stdout.trim();
    console.log(`container SID ${sid}`);
    const bNoSid = await startBridge(bridgeExe, '-', 'low', echo.port);
    const bNoLabel = await startBridge(bridgeExe, sid, 'none', echo.port);
    const bLow = await startBridge(bridgeExe, sid, 'low', echo.port);
    const targets = {
      'pipe, Node\'s default security': dpipe.name,
      'pipe, ours, the container not named (low label)': bNoSid.name,
      'pipe, ours, the container named, no label': bNoLabel.name,
      'pipe, ours, the container named + low label': bLow.name,
      'this computer, 127.0.0.1': { port: echo.port, host: '127.0.0.1' },
      ...(host ? { [`this computer, its own address ${host}`]: { port: echoAll.port, host } } : {}),
      'the internet, 1.1.1.1:443': { port: 443, host: '1.1.1.1' },
    };
    const o = await insideProbe(fence, specFile, L, targets, `node in the container: ${fl.title}`);
    for (const b of [bNoSid, bNoLabel, bLow]) b.close();
    if (!fl.capabilities.length) {
      verdict['container\'s own loopback (another process)'] = o['loopback, another process'] === 'echo ok';
      verdict['pipe with the container named + low label'] = o['pipe, ours, the container named + low label'] === 'echo ok';
      verdict['127.0.0.1 outside stays closed'] = o['this computer, 127.0.0.1'] !== 'echo ok';
      verdict['the internet stays closed'] = o['the internet, 1.1.1.1:443'] !== 'echo ok';
      if (o['this computer, 127.0.0.1'] === 'echo ok' || o['the internet, 1.1.1.1:443'] === 'echo ok') { escaped = true; console.log('  <== A WAY OUT WITHOUT THE PIPE'); }
      await standInRun(fence, bridgeExe, specFile, L, claude, sid);
      if (process.env.WBX_REAL_RELAY) await realRelayRun(fence, bridgeExe, specFile, L, claude, sid);
    } else {
      verdict['privateNetworkClientServer: this computer\'s own address'] = host ? o[`this computer, its own address ${host}`] : 'no address';
    }
    spawnSync(fence, ['cleanup', specFile], { encoding: 'utf8' });
  }
  console.log(`\nthe echo server outside heard: 127.0.0.1 ${echo.hits.length}, all addresses ${echoAll.hits.length}; Node's default pipe ${dpipe.hits.length}`);
  for (const s of [echo, echoAll, dpipe]) s.close();
  try { fs.rmSync(L.secret, { force: true }); fs.rmSync(path.join(os.homedir(), 'wbn-planted.txt'), { force: true }); } catch { /* gone */ }
  show('VERDICT', Object.entries(verdict).map(([k, x]) => `${String(x).padEnd(6)} ${k}`).join('\n'));
  console.log(escaped ? '\nA SECRET, A WRITE OR A WAY OUT GOT PAST THE BOX' : '\nnothing got out of the box');
  const need = ['container\'s own loopback (another process)', 'pipe with the container named + low label', 'stand-in run through the pipe', ...(process.env.WBX_REAL_RELAY ? ['the real Anthropic through the pipe and the relay (401 for the made-up token)', 'control: the relay\'s port straight from the box is refused'] : [])];
  const short = need.filter((k) => verdict[k] !== true);
  if (process.env.WBX_STRICT && short.length) console.log(`\nSTRICT: not shown: ${short.join('; ')}`);
  process.exit(escaped || (process.env.WBX_STRICT && short.length) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
