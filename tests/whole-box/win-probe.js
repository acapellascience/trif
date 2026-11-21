#!/usr/bin/env node
'use strict';
// SPIKE (docs/WHOLE-BOX.md): the whole Claude Code process (not only `trif`) inside an AppContainer on
// Windows, with TRIF's fence launcher (fence.cs here is helper/lib/win/fence.cs from the windows branch,
// ea8205e, unchanged). Exploration on GitHub's windows-latest: prints what each attempt got and exits 1
// only if a secret got out of a run in the box. Claude Code talks to a stand-in for Anthropic's API on
// this computer (no account, no paid call), with the loosest flags it has (every tool allowed,
// --dangerously-skip-permissions): what an organization's managed settings could at most give.
//
// For each container flavor (a plain AppContainer, and a less-privileged one with registryRead, both with
// internetClient, the network capability Claude Code would need to reach Anthropic itself):
//   claude --version; a run without a loopback exemption (can it reach a server on this computer, TRIF's
//   key proxy?); the same run with one (CheckNetIsolation, an administrator's step); node in the
//   container connecting to the internet (internetClient has no host list).
// Refuses to run outside GitHub Actions: it makes AppContainer profiles, entries and loopback exemptions.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { startFakeAnthropic } = require('../fake-anthropic-server');

if (process.platform !== 'win32') { console.error('win-probe: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true') { console.error('win-probe: runs on GitHub Actions only'); process.exit(2); }

const SECRET = `SECRET-${crypto.randomBytes(4).toString('hex')}`;
const sys = (n) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', n);
let escaped = false;
const show = (title, text) => console.log(`\n--- ${title}\n${String(text || '').trim().slice(0, 4000)}`);

function build(dir) {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const exe = path.join(dir, 'trif-fence.exe');
  const r = spawnSync(csc, ['/nologo', '/o+', '/r:System.Web.Extensions.dll', `/out:${exe}`, path.join(__dirname, 'fence.cs')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`csc: ${r.stdout}${r.stderr}`);
  return exe;
}

// Where npm put Claude Code, and what starts it: its own .exe if the package has one, else node + cli.js.
function findClaude() {
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).stdout.trim();
  const pkg = path.join(root, '@anthropic-ai', 'claude-code');
  const list = [];
  const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2 && e.name !== 'node_modules') walk(p, depth + 1); else list.push(p); } };
  walk(pkg, 0);
  show('the package', list.filter((p) => /\.(exe|js|json)$/i.test(p)).map((p) => `${p} ${fs.statSync(p).size}`).join('\n'));
  const exe = list.find((p) => /claude\.exe$/i.test(p));
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  if (exe) return { pkg, version, argv: [exe] };
  return { pkg, version, argv: [process.execPath, '--preserve-symlinks', '--preserve-symlinks-main', path.join(pkg, 'cli.js')] };
}

function layout() {
  const base = path.join(os.homedir(), `wbx-${crypto.randomBytes(3).toString('hex')}`); // inside the profile folder, as a real one
  const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
  const L = {
    base,
    secret: w(path.join(os.homedir(), `wbx-secret-${path.basename(base)}.txt`), `${SECRET} home`),
    liveMod: w(path.join(base, 'live', 'sites', 'x.com', 'live.user.js'), `// ${SECRET} live`),
    stage: path.join(base, 'stage'),
    own: w(path.join(base, 'stage', 'sites', 'x.com', 'a.user.js'), '// COPY-OK'),
    otherSite: w(path.join(base, 'stage', 'sites', 'other.com', 'b.user.js'), '// other'),
    cfg: path.join(base, 'cfg'), tmp: path.join(base, 'tmp'), box: path.join(base, 'box'),
  };
  for (const d of [L.cfg, L.tmp, L.box]) fs.mkdirSync(d, { recursive: true });
  w(path.join(L.box, 'mcp-echo.js'), fs.readFileSync(path.join(__dirname, 'mcp-echo.js')));
  return L;
}

function spec(L, claude, { name, lpac, extraEnv = {} }) {
  const env = {
    SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive, windir: process.env.windir, ComSpec: sys('cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: [sys(''), path.dirname(process.execPath), 'C:\\Program Files\\Git\\cmd'].join(';'), TEMP: L.tmp, TMP: L.tmp,
    USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, HOMEDRIVE: process.env.HOMEDRIVE, HOMEPATH: process.env.HOMEPATH,
    CLAUDE_CONFIG_DIR: L.cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...extraEnv,
  };
  return {
    name, lpac, capability: 'trifWholeBoxSpike', capabilities: [...(lpac ? ['registryRead'] : []), 'internetClient'], cwd: L.stage, env, job: true,
    grant: [
      { path: claude.pkg, rights: 'r', to: 'capability', optional: true },
      { path: path.dirname(process.execPath), rights: 'r', to: 'capability', optional: true },
      { path: L.stage, rights: 'r' },
      { path: path.join(L.stage, 'sites'), rights: 'r+mkdir', inherit: false },
      { path: path.join(L.stage, 'sites'), rights: 'rw', inherit: 'only' },
      { path: L.cfg, rights: 'rw' }, { path: L.tmp, rights: 'rw' }, { path: L.box, rights: 'rw' },
      // (an organization's managed settings, readable so its policies apply: C:\Program Files is readable to
      // a plain AppContainer already, not to a less-privileged one)
      { path: 'C:\\Program Files\\ClaudeCode', rights: 'r', to: 'capability', optional: true },
    ],
    readonly: [path.join(L.stage, 'sites', 'other.com')],
  };
}

function specFiltered(...a) {
  const s = spec(...a);
  s.grant = s.grant.filter((g) => fs.existsSync(g.path));
  return s;
}

function fenceRun(fence, specFile, argv, { stdin = '', timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(fence, ['exec', specFile, '--', ...argv], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => { spawnSync(sys('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F']); }, timeout);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
    child.stdin.end(stdin);
  });
}

async function headless(fence, specFile, L, claude, label) {
  const steps = [
    { tool: 'Read', input: { file_path: L.own } },
    { tool: 'Read', input: { file_path: L.secret } },
    { tool: 'Read', input: { file_path: L.liveMod } },
    { tool: 'Glob', input: { pattern: '*', path: os.homedir() } },
    { tool: 'Grep', input: { pattern: 'SECRET', path: os.homedir(), output_mode: 'content' } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'x.com', 'new.user.js'), content: '// new' } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'other.com', 'evil.user.js'), content: '// evil' } },
    { tool: 'Write', input: { file_path: path.join(os.homedir(), `wbx-planted-${label}.txt`), content: 'planted' } },
    { tool: 'Write', input: { file_path: path.join(L.cfg, 'settings.json'), content: '{}' } },
    { bash: 'echo bash-ok' },
    { tool: 'mcp__trif__trif', input: { args: ['status'] } },
    { say: 'done' },
  ];
  const api = await startFakeAnthropic({ script: steps });
  const mcp = path.join(L.box, 'mcp.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { trif: { command: process.execPath, args: ['--preserve-symlinks', '--preserve-symlinks-main', path.join(L.box, 'mcp-echo.js')] } } }));
  const s = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  s.env.ANTHROPIC_BASE_URL = api.url;
  s.env.ANTHROPIC_API_KEY = 'trif-stand-in-key';
  fs.writeFileSync(specFile, JSON.stringify(s));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', mcp,
    '--tools', 'Read,Edit,Write,Glob,Grep,Bash', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'mcp__trif__trif',
    '--dangerously-skip-permissions', '--add-dir', os.homedir(), '--model', 'claude-haiku-stand-in'];
  const r = await fenceRun(fence, specFile, [...claude.argv, ...args], { stdin: 'probe' });
  const lines = r.stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines.find((m) => m.type === 'system' && m.subtype === 'init');
  const result = lines.find((m) => m.type === 'result');
  const got = api.toolResults();
  console.log(`\n>>> ${label}: exit ${r.code} in ${r.ms} ms; requests to the stand-in: ${api.requests.length}`);
  if (init) console.log(`tools: ${(init.tools || []).join(', ')}; mcp: ${JSON.stringify(init.mcp_servers || [])}`);
  steps.slice(0, -1).forEach((st, i) => console.log(`  ${(st.bash || `${st.tool} ${JSON.stringify(st.input).slice(0, 120)}`).padEnd(70)} -> ${String(got[i] === undefined ? '(no result)' : got[i]).replace(/\s+/g, ' ').slice(0, 220)}${String(got[i] || '').includes(SECRET) ? '   <== SECRET GOT OUT' : ''}`));
  if (got.some((x) => String(x).includes(SECRET))) escaped = true;
  if (fs.existsSync(path.join(L.stage, 'sites', 'other.com', 'evil.user.js')) || fs.existsSync(path.join(os.homedir(), `wbx-planted-${label}.txt`))) { escaped = true; console.log('  <== A WRITE GOT OUT'); }
  console.log(`  own site written: ${fs.existsSync(path.join(L.stage, 'sites', 'x.com', 'new.user.js'))}`);
  if (result) console.log(`  result: ${JSON.stringify({ subtype: result.subtype, is_error: result.is_error, result: String(result.result || '').slice(0, 200) })}`);
  else show('stdout (no result line)', r.stdout.slice(-1500));
  if (r.stderr.trim()) show('stderr', r.stderr.slice(-2000));
  await api.close();
  return { ok: !!(result && !result.is_error), requests: api.requests.length };
}

async function netProbe(fence, specFile, L) {
  const probe = path.join(L.box, 'net.js');
  fs.writeFileSync(probe, `const net=require('net');const t=(h,p)=>new Promise(r=>{const s=net.connect(p,h);s.setTimeout(5000,()=>{s.destroy();r('timeout')});s.on('connect',()=>{s.destroy();r('connected')});s.on('error',e=>r(e.code))});
(async()=>{const dns=require('dns');const o={};o['1.1.1.1:443']=await t('1.1.1.1',443);o['example.com:443']=await t('example.com',443);o['dns']=await new Promise(r=>dns.lookup('api.anthropic.com',(e,a)=>r(e?e.code:'resolved '+a)));o['fs ~']=(()=>{try{return require('fs').readdirSync(require('os').homedir()).length+' entries'}catch(e){return e.code}})();console.log(JSON.stringify(o))})()`);
  const r = await fenceRun(fence, specFile, [process.execPath, '--preserve-symlinks', '--preserve-symlinks-main', probe], { timeout: 30000 });
  show('node in the container (internetClient): the internet, names, the home folder', r.stdout + r.stderr);
}

(async () => {
  const L = layout();
  const fence = build(L.base);
  const claude = findClaude();
  console.log(`Claude Code ${claude.version}: ${claude.argv.join(' ')}`);
  const t0 = Date.now();
  spawnSync(claude.argv[0], [...claude.argv.slice(1), '--version'], { encoding: 'utf8' });
  console.log(`claude --version outside the box: ${Date.now() - t0} ms`);
  for (const flavor of [{ name: 'trif.wbx.plain', lpac: false }, { name: 'trif.wbx.lpac', lpac: true }]) {
    console.log(`\n================ ${flavor.name} (${flavor.lpac ? 'less-privileged + registryRead' : 'plain AppContainer'} + internetClient)`);
    const specFile = path.join(L.base, `${flavor.name}.json`);
    fs.writeFileSync(specFile, JSON.stringify(specFiltered(L, claude, flavor)));
    const prep = spawnSync(fence, ['prepare', specFile], { encoding: 'utf8' });
    if (prep.status !== 0) { show('prepare failed', prep.stdout + prep.stderr); continue; }
    const sid = spawnSync(fence, ['sid', flavor.name], { encoding: 'utf8' }).stdout.trim();
    const v = await fenceRun(fence, specFile, [...claude.argv, '--version'], { timeout: 60000 });
    show(`claude --version in the box (${v.ms} ms, exit ${v.code})`, v.stdout + v.stderr);
    await netProbe(fence, specFile, L);
    if (!process.env.WBX_SKIP_NO_LOOPBACK) await headless(fence, specFile, L, claude, `${flavor.name}, no loopback exemption`);
    const ex = spawnSync(sys('CheckNetIsolation.exe'), ['LoopbackExempt', '-a', `-p=${sid}`], { encoding: 'utf8' });
    show('CheckNetIsolation LoopbackExempt -a (needs an administrator)', `${ex.status} ${ex.stdout}${ex.stderr}`);
    await headless(fence, specFile, L, claude, `${flavor.name}, loopback exempt`);
    spawnSync(sys('CheckNetIsolation.exe'), ['LoopbackExempt', '-d', `-p=${sid}`], { encoding: 'utf8' });
    for (const f of fs.readdirSync(L.cfg)) console.log(`  config folder: ${f}`);
    spawnSync(fence, ['cleanup', specFile], { encoding: 'utf8' });
  }
  try { fs.rmSync(L.secret, { force: true }); } catch { /* gone */ }
  console.log(escaped ? '\nA SECRET OR A WRITE GOT OUT OF THE BOX' : '\nnothing got out of the box');
  process.exit(escaped ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
