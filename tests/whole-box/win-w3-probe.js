#!/usr/bin/env node
'use strict';
// Whole box step 9b' (Tim's pick W3, 11-21): TRIF's full sandbox on Windows reaches TRIF's relay and key
// proxy and nothing else, after ONE administrator step (helper/lib/winbox.js: the loopback exemption for
// TRIF's one container + firewall rules naming it). GitHub's windows-latest only (the runner is an
// administrator, so the step runs without Windows' prompt: winbox.setup({already: true})). Strict: exits 1
// if anything the design says must hold doesn't.
//
//   1. the container's SID: winbox.containerSid (JS) = what Windows derives (fence.cs `sid`)
//   2. before the step: the box can't reach TRIF's ports (no exemption)
//   3. the step (winbox.setup); status ready (the exemption, every firewall profile on, the rules as made,
//      in the active store)
//   4. node in the box: 127.0.0.1 at the relay's and the key proxy's ports open; every other port on
//      127.0.0.1 and this computer's own address, TRIF's ports on its own address and on ::1, UDP, the
//      internet: closed
//   5. two runs in the one container: each reads its own folder, not the other's (fence.cs runCapability)
//   6. the pinned claude.exe in the box: a normal run on the stand-in API at the key proxy's port (Read,
//      Write, the trif MCP tool; a secret elsewhere and another site's folder refused); the real
//      api.anthropic.com through TRIF's relay on its port (401 for a made-up token)
//   7. (what we learn) the firewall turned off: does the box reach other ports then? status says firewallOff
//   8. winbox.remove: status not ready, TRIF's ports closed to the box again
//
// Round 11: TRIF's own WFP filters (helper/lib/win/wfp.cs) in the same step, for what the firewall rules
// don't hold (round 10: loopback). Status reads them back (the compiled wfp.exe, no administrator). Also
// learned: with the filters, are the firewall rules still needed (the rules out; then the firewall off)?

const fs = require('fs');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { startFakeAnthropic } = require('../fake-anthropic-server');
const relay = require('../../helper/lib/relay');
const winbox = require('../../helper/lib/winbox');

if (process.platform !== 'win32') { console.error('win-w3-probe: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true') { console.error('win-w3-probe: runs on GitHub Actions only (it changes the firewall)'); process.exit(2); }

const SECRET = `SECRET-${crypto.randomBytes(4).toString('hex')}`;
const sys = (n) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', n);
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const NODE_IN = [process.execPath, '--preserve-symlinks', '--preserve-symlinks-main'];
const show = (title, text) => console.log(`\n--- ${title}\n${String(text || '').trim().slice(0, 5000)}`);
const verdict = {};
const learned = {};
let escaped = false;

function compile(src, out, refs = [], flags = []) {
  const file = path.isAbsolute(src) ? src : path.join(__dirname, src);
  const r = spawnSync(csc, ['/nologo', '/o+', ...flags, ...refs.map((x) => `/r:${x}`), `/out:${out}`, file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`csc ${src}: ${r.stdout}${r.stderr}`);
  return out;
}

function findClaude() {
  if (process.env.WBX_CLAUDE_BIN) return { dir: path.dirname(process.env.WBX_CLAUDE_BIN), argv: [process.env.WBX_CLAUDE_BIN] };
  throw new Error('WBX_CLAUDE_BIN: TRIF\'s pinned claude.exe (the workflow installs it)');
}

const base = path.join(os.homedir(), `wb3-${crypto.randomBytes(3).toString('hex')}`);
const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const secretFile = w(path.join(os.homedir(), `wb3-secret-${path.basename(base)}.txt`), `${SECRET} home`);

// One run's folders (as the helper would make them) and its spec: TRIF's one container, the run's own
// capability.
function runLayout(id, claude) {
  const R = path.join(base, id);
  const L = {
    id, stage: path.join(R, 'stage'), cfg: path.join(R, 'cfg'), tmp: path.join(R, 'tmp'), box: path.join(R, 'box'),
  };
  L.own = w(path.join(L.stage, 'sites', 'x.com', 'a.user.js'), `// COPY-OK ${id}`);
  w(path.join(L.stage, 'sites', 'other.com', 'b.user.js'), '// other');
  for (const d of [L.cfg, L.tmp, L.box]) fs.mkdirSync(d, { recursive: true });
  for (const f of ['mcp-echo.js', 'win-inside.js']) fs.copyFileSync(path.join(__dirname, f), path.join(L.box, f));
  const env = {
    SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive, windir: process.env.windir, ComSpec: sys('cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: [sys(''), path.dirname(process.execPath)].join(';'), TEMP: L.tmp, TMP: L.tmp,
    USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, HOMEDRIVE: process.env.HOMEDRIVE, HOMEPATH: process.env.HOMEPATH,
    CLAUDE_CONFIG_DIR: L.cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const grant = [
    { path: claude.dir, rights: 'r', to: 'capability', optional: true },
    { path: path.dirname(process.execPath), rights: 'r', to: 'capability', optional: true },
    { path: R, rights: 'stat' },
    { path: L.stage, rights: 'r' },
    { path: path.join(L.stage, 'sites'), rights: 'r+mkdir', inherit: false },
    { path: path.join(L.stage, 'sites'), rights: 'rw', inherit: 'only' },
    { path: L.cfg, rights: 'rw' }, { path: L.tmp, rights: 'rw' }, { path: L.box, rights: 'rw' },
    { path: 'C:\\Program Files\\ClaudeCode', rights: 'r', to: 'capability', optional: true },
  ].filter((g) => fs.existsSync(g.path));
  const spec = {
    name: winbox.CONTAINER, runCapability: `trif.run.${id}`, lpac: true, capability: 'trifWholeBoxShared', capabilities: ['registryRead', winbox.NET_CAPABILITY],
    cwd: L.stage, env, job: true, grant, readonly: [path.join(L.stage, 'sites', 'other.com')],
  };
  L.spec = path.join(base, `${id}.json`);
  fs.writeFileSync(L.spec, JSON.stringify(spec));
  return L;
}

function setCaps(L, extra) {
  const sp = JSON.parse(fs.readFileSync(L.spec, 'utf8'));
  sp.capabilities = ['registryRead', ...extra];
  fs.writeFileSync(L.spec, JSON.stringify(sp));
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

function echoTcp(port, host) {
  const hits = [];
  const s = net.createServer((c) => { hits.push(c.remoteAddress); c.on('data', (d) => c.write(`ECHO ${d}`)); c.on('error', () => {}); });
  return new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, host, () => resolve({ port: s.address().port, host, hits, close: () => new Promise((r) => s.close(() => r())) })); });
}
function echoUdp(host) {
  const s = dgram.createSocket('udp4');
  const hits = [];
  s.on('message', (m, r) => { hits.push(r.address); s.send(`ECHO ${m}`, r.port, r.address); });
  return new Promise((resolve) => s.bind(0, host, () => resolve({ port: s.address().port, hits, close: () => s.close() })));
}
function hostAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

async function inside(fence, L, targets, title) {
  const r = await fenceExec(fence, L.spec, [...NODE_IN, path.join(L.box, 'win-inside.js')], { timeout: 120000, env: { WBN_TARGETS: JSON.stringify(targets) } });
  show(`${title} (exit ${r.code}, ${r.ms} ms)`, r.stdout + r.stderr);
  try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return {}; }
}

const ps = (script) => winbox.runPs(script);
const claudeArgs = (mcp, extra = []) => ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', mcp,
  '--tools', 'Read,Edit,Write,Glob,Grep', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'mcp__trif__trif',
  '--dangerously-skip-permissions', '--add-dir', os.homedir(), ...extra];
function parseStream(stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { init: lines.find((m) => m.type === 'system' && m.subtype === 'init'), result: lines.find((m) => m.type === 'result') };
}

(async () => {
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const fence = compile('fence.cs', path.join(bin, 'trif-fence.exe'), ['System.Web.Extensions.dll']);
  process.env.TRIF_WFP_EXE = compile(winbox.WFP_CS, path.join(bin, 'trif-wfp.exe'), [], ['/platform:x64']);
  const wfp = (...a) => spawnSync(process.env.TRIF_WFP_EXE, a, { encoding: 'utf8' }).stdout.trim();
  show('wfp status before anything', wfp('status'));
  const claude = findClaude();
  console.log(`claude.exe: ${claude.argv[0]}: ${(spawnSync(claude.argv[0], ['--version'], { encoding: 'utf8' }).stdout || '').trim()}`);

  // 1
  const sid = winbox.containerSid(winbox.CONTAINER);
  const winSid = spawnSync(fence, ['sid', winbox.CONTAINER], { encoding: 'utf8' }).stdout.trim();
  console.log(`container ${winbox.CONTAINER}: JS ${sid}, Windows ${winSid}`);
  verdict['the container\'s SID as Windows derives it'] = sid === winSid;
  for (const n of ['trif.run.a', 'trifWholeBoxShared']) {
    const want = winbox.capabilitySid(n);
    console.log(`capability ${n}: ${want}`);
  }

  show('firewall profiles (as the runner has them)', ps('Get-NetFirewallProfile -PolicyStore ActiveStore | Format-Table Name, Enabled, DefaultOutboundAction, AllowLocalFirewallRules | Out-String').stdout);
  const offAtStart = /False/.test(ps('(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { $_.Enabled }) -join ","').stdout);
  learned['the runner\'s firewall was off at the start'] = offAtStart;
  if (offAtStart) ps('Set-NetFirewallProfile -All -Enabled True');
  show('excluded TCP port ranges', spawnSync(sys('netsh.exe'), ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { encoding: 'utf8' }).stdout);
  const ports = winbox.choosePorts(winbox.excludedPorts(), winbox.busyPorts());
  console.log(`TRIF's ports: ${JSON.stringify(ports)}`);
  if (!ports) throw new Error('no free ports');

  const A = runLayout('a', claude);
  const B = runLayout('b', claude);
  for (const L of [A, B]) {
    const prep = spawnSync(fence, ['prepare', L.spec], { encoding: 'utf8' });
    if (prep.status !== 0) throw new Error(`prepare ${L.id}: ${prep.stdout}${prep.stderr}`);
  }
  const host = hostAddress();
  const srv = {
    relay: await echoTcp(ports.relay, '127.0.0.1'),
    keyProxy: await echoTcp(ports.keyProxy, '127.0.0.1'),
    other: await echoTcp(0, '0.0.0.0'),
    relayHost: host ? await echoTcp(ports.relay, host).catch((e) => ({ error: e.code })) : null,
    relay6: await echoTcp(ports.relay, '::1').catch((e) => ({ error: e.code })),
    udp: await echoUdp('127.0.0.1'),
  };
  console.log(`listeners: ${JSON.stringify(Object.fromEntries(Object.entries(srv).map(([k, v]) => [k, v && (v.error || `${v.host || ''}:${v.port}`)])))}; this computer's address ${host}`);
  const targets = {
    'TRIF\'s relay port, 127.0.0.1': { port: ports.relay, host: '127.0.0.1' },
    'TRIF\'s key proxy port, 127.0.0.1': { port: ports.keyProxy, host: '127.0.0.1' },
    'another port, 127.0.0.1': { port: srv.other.port, host: '127.0.0.1' },
    ...(host ? { [`another port, ${host}`]: { port: srv.other.port, host } } : {}),
    ...(host && srv.relayHost && !srv.relayHost.error ? { [`TRIF's relay port, ${host}`]: { port: ports.relay, host } } : {}),
    ...(!srv.relay6.error ? { 'TRIF\'s relay port, ::1': { port: ports.relay, host: '::1' } } : {}),
    'UDP, 127.0.0.1': { udp: srv.udp.port, host: '127.0.0.1' },
    'the internet, 1.1.1.1:443': { port: 443, host: '1.1.1.1' },
    'its own folder': { read: A.own },
    'the other run\'s folder': { read: B.own },
    'a secret in the home folder': { read: secretFile },
  };
  const mustBeClosed = Object.keys(targets).filter((k) => !/^TRIF's (relay|key proxy) port, 127\.0\.0\.1$/.test(k) && !/folder$/.test(k) && k !== 'a secret in the home folder');
  const holds = (o, tag) => {
    for (const k of mustBeClosed) {
      if (o[k] === 'echo ok') { escaped = true; console.log(`  <== THE BOX REACHED ${k} ${tag}`); }
    }
    if (String(o['the other run\'s folder'] || '').startsWith('read') || String(o['a secret in the home folder'] || '').startsWith('read')) { escaped = true; console.log(`  <== A READ GOT OUT ${tag}`); }
  };

  // 2
  const before = winbox.status();
  console.log(`status before the step: ${JSON.stringify(before)}`);
  verdict['status before the step: not ready (no exemption, no rules, no filters)'] = !before.ready && before.problems.includes('notExempt') && before.problems.includes('rulesMissing') && before.problems.includes('filtersMissing');
  let o = await inside(fence, A, targets, 'run a, before the administrator step');
  holds(o, '(before)');
  verdict['before the step: TRIF\'s relay port closed to the box'] = o['TRIF\'s relay port, 127.0.0.1'] !== 'echo ok';

  // (learned: which network capability the exemption needs; the exemption alone, no rules)
  const few = (t) => Object.fromEntries(['TRIF\'s relay port, 127.0.0.1', 'another port, 127.0.0.1', 'the internet, 1.1.1.1:443'].map((k) => [k, t[k]]));
  for (const caps of [[], ['privateNetworkClientServer'], ['internetClient']]) {
    setCaps(A, caps);
    spawnSync(sys('CheckNetIsolation.exe'), ['LoopbackExempt', '-a', `-p=${sid}`], { encoding: 'utf8' });
    const x = await inside(fence, A, few(targets), `the exemption only, no rules; capabilities: ${caps.join(', ') || 'none'}`);
    for (const [k, v] of Object.entries(x)) if (!/^loopback/.test(k)) learned[`exemption only, ${caps.join('+') || 'no capability'}: ${k}`] = v;
    spawnSync(sys('CheckNetIsolation.exe'), ['LoopbackExempt', '-d', `-p=${sid}`], { encoding: 'utf8' });
  }
  setCaps(A, [winbox.NET_CAPABILITY]);

  // 3
  const set = winbox.setup({ already: true, dir: base, ports });
  console.log(`\nwinbox.setup: ${JSON.stringify(set)}`);
  verdict['winbox.setup: ok, the ports as chosen, status ready'] = set.ok && set.status.ready && JSON.stringify(set.ports) === JSON.stringify(ports);
  show('the rules as Windows has them', ps(`Get-NetFirewallRule -Group '${winbox.RULE_GROUP}' -PolicyStore ActiveStore | ForEach-Object { $_.Name; ($_ | Get-NetFirewallPortFilter | Format-List Protocol, RemotePort | Out-String).Trim(); ($_ | Get-NetFirewallAddressFilter).RemoteAddress -join ' '; ($_ | Get-NetFirewallApplicationFilter).Package }`).stdout);
  show('TRIF\'s WFP filters (wfp status)', wfp('status'));
  show('CheckNetIsolation LoopbackExempt -s', spawnSync(sys('CheckNetIsolation.exe'), ['LoopbackExempt', '-s'], { encoding: 'utf8' }).stdout);
  // status as the person runs it, before every boxed run: no administrator. (runas /trustlevel:0x20000, Windows'
  // "Basic User": the Administrators group deny-only; no account or password)
  const lowDir = path.join(base, 'low');
  fs.mkdirSync(lowDir, { recursive: true });
  const lowOut = path.join(lowDir, 'status.json');
  const lowCmd = w(path.join(lowDir, 'status.cmd'), [
    '@echo off',
    `set "TRIF_WFP_EXE=${process.env.TRIF_WFP_EXE}"`,
    `"${process.execPath}" "${path.join(__dirname, '..', '..', 'helper', 'lib', 'winbox.js')}" status > "${lowOut}.tmp" 2>&1`,
    `whoami /groups | findstr /i "S-1-5-32-544" >> "${lowOut}.groups" 2>&1`,
    `move /y "${lowOut}.tmp" "${lowOut}" > nul`,
  ].join('\r\n'));
  spawnSync(sys('runas.exe'), ['/trustlevel:0x20000', `cmd /c "${lowCmd}"`], { encoding: 'utf8', timeout: 30000 });
  for (let i = 0; i < 60 && !fs.existsSync(lowOut); i++) await new Promise((r) => setTimeout(r, 500));
  const lowText = fs.existsSync(lowOut) ? fs.readFileSync(lowOut, 'utf8') : '(nothing)';
  show('status without an administrator (Basic User)', lowText);
  show('  its Administrators group', fs.existsSync(`${lowOut}.groups`) ? fs.readFileSync(`${lowOut}.groups`, 'utf8') : '(none)');
  let low = null;
  try { low = JSON.parse(lowText.trim().split(/\r?\n/).pop()); } catch { /* none */ }
  verdict['status without an administrator: ready, the filters read'] = !!(low && low.ready && low.ports && low.ports.relay === ports.relay);
  learned['the status run was not an administrator (Administrators deny-only)'] = fs.existsSync(`${lowOut}.groups`) && /Deny only/i.test(fs.readFileSync(`${lowOut}.groups`, 'utf8'));

  const again = winbox.setup({ already: true, dir: base }); // (no ports given: the rules' own, though TRIF's ports are busy now)
  verdict['winbox.setup a second time: the same ports, ready'] = again.ok && again.status.ready && JSON.stringify(again.ports) === JSON.stringify(ports);

  // 4, 5
  o = await inside(fence, A, targets, 'run a, after the step');
  holds(o, '(after)');
  verdict['after: TRIF\'s relay port open to the box'] = o['TRIF\'s relay port, 127.0.0.1'] === 'echo ok';
  verdict['after: TRIF\'s key proxy port open to the box'] = o['TRIF\'s key proxy port, 127.0.0.1'] === 'echo ok';
  for (const k of mustBeClosed) verdict[`after: closed: ${k}`] = o[k] !== 'echo ok';
  verdict['run a reads its own folder'] = String(o['its own folder'] || '').startsWith('read');
  verdict['run a can\'t read run b\'s folder (same container)'] = !String(o['the other run\'s folder'] || '').startsWith('read');
  const ob = await inside(fence, B, { 'its own folder': { read: B.own }, 'the other run\'s folder': { read: A.own } }, 'run b, after the step');
  verdict['run b reads its own folder, not run a\'s'] = String(ob['its own folder'] || '').startsWith('read') && !String(ob['the other run\'s folder'] || '').startsWith('read');
  if (String(ob['the other run\'s folder'] || '').startsWith('read')) escaped = true;
  console.log(`the echo listeners heard: ${JSON.stringify(Object.fromEntries(Object.entries(srv).map(([k, v]) => [k, v && v.hits ? v.hits.length : null])))}`);

  // (learned: the rules with internetClient in place of NET_CAPABILITY: do they close the internet too?)
  setCaps(A, ['internetClient']);
  const xi = await inside(fence, A, { ...few(targets), 'example.com:443': { port: 443, host: 'example.com' } }, 'the step done; capability internetClient instead');
  for (const [k, v] of Object.entries(xi)) if (!/^loopback/.test(k)) learned[`rules + internetClient: ${k}`] = v;
  setCaps(A, [winbox.NET_CAPABILITY]);

  // 6: the stand-in API on the key proxy's port (an API-key run's ANTHROPIC_BASE_URL), then the real relay
  await srv.keyProxy.close();
  const steps = [
    { tool: 'Read', input: { file_path: A.own } },
    { tool: 'Read', input: { file_path: secretFile } },
    { tool: 'Read', input: { file_path: B.own } },
    { tool: 'Write', input: { file_path: path.join(A.stage, 'sites', 'x.com', 'new.user.js'), content: '// new' } },
    { tool: 'Write', input: { file_path: path.join(A.stage, 'sites', 'other.com', 'evil.user.js'), content: '// evil' } },
    { tool: 'Write', input: { file_path: path.join(os.homedir(), 'wb3-planted.txt'), content: 'planted' } },
    { tool: 'mcp__trif__trif', input: { args: ['status'] } },
    { say: 'done' },
  ];
  const api = await startFakeAnthropic({ script: steps, port: ports.keyProxy });
  const mcp = path.join(A.box, 'mcp.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { trif: { command: NODE_IN[0], args: [...NODE_IN.slice(1), path.join(A.box, 'mcp-echo.js')] } } }));
  let r = await fenceExec(fence, A.spec, [...claude.argv, ...claudeArgs(mcp, ['--model', 'claude-haiku-stand-in'])], { stdin: 'probe', env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${ports.keyProxy}`, ANTHROPIC_API_KEY: 'trif-stand-in-key' } });
  let p = parseStream(r.stdout);
  const got = api.toolResults();
  console.log(`\n>>> claude.exe in TRIF's container, the stand-in API at the key proxy's port: exit ${r.code} in ${r.ms} ms; requests ${api.requests.length}`);
  if (p.init) console.log(`tools: ${(p.init.tools || []).join(', ')}; mcp: ${JSON.stringify(p.init.mcp_servers || [])}`);
  steps.slice(0, -1).forEach((st, i) => console.log(`  ${`${st.tool} ${JSON.stringify(st.input).slice(0, 110)}`.padEnd(120)} -> ${String(got[i] === undefined ? '(no result)' : got[i]).replace(/\s+/g, ' ').slice(0, 200)}${String(got[i] || '').includes(SECRET) ? '   <== SECRET GOT OUT' : ''}`));
  if (got.some((x) => String(x).includes(SECRET)) || String(got[2] || '').includes('COPY-OK b')) escaped = true;
  if (fs.existsSync(path.join(A.stage, 'sites', 'other.com', 'evil.user.js')) || fs.existsSync(path.join(os.homedir(), 'wb3-planted.txt'))) { escaped = true; console.log('  <== A WRITE GOT OUT'); }
  const ownWritten = fs.existsSync(path.join(A.stage, 'sites', 'x.com', 'new.user.js'));
  if (p.result) console.log(`  result: ${JSON.stringify({ is_error: p.result.is_error, result: String(p.result.result || '').slice(0, 200) })}`);
  else show('stdout (no result line)', r.stdout.slice(-1500));
  if (r.stderr.trim()) show('stderr', r.stderr.slice(-1500));
  verdict['a normal run in the box (stand-in API): its own mod read and written, the trif tool'] = !!(p.result && !p.result.is_error) && String(got[0] || '').includes('COPY-OK a') && ownWritten && String(got[6] || '').includes('mcp-trif-ok');
  await api.close();

  await srv.relay.close();
  const rl = await relay.start({ port: ports.relay });
  const token = `sk-ant-oat01-${'MadeUpForCI'.repeat(8)}AA`;
  fs.writeFileSync(path.join(A.box, 'mcp-none.json'), JSON.stringify({ mcpServers: {} }));
  r = await fenceExec(fence, A.spec, [...claude.argv, ...claudeArgs(path.join(A.box, 'mcp-none.json'))], { stdin: 'Say hi.', timeout: 90000, env: { CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CODE_MAX_RETRIES: '0', HTTPS_PROXY: `http://127.0.0.1:${ports.relay}` } });
  p = parseStream(r.stdout);
  console.log(`\n>>> claude.exe in TRIF's container → TRIF's relay on ${ports.relay} → api.anthropic.com (a made-up token): exit ${r.code} in ${r.ms} ms`);
  console.log(`  relay saw: ${JSON.stringify(rl.seen)}`);
  console.log(`  result: ${p.result ? JSON.stringify({ is_error: p.result.is_error, result: String(p.result.result || '').slice(0, 300) }) : '(none)'}`);
  if (!p.result) show('stdout', r.stdout.slice(-1500));
  if (r.stderr.trim()) show('stderr', r.stderr.slice(-1500));
  verdict['the real Anthropic through TRIF\'s relay at its fixed port (401 for the made-up token)'] = rl.seen.some((x) => x.target === 'api.anthropic.com:443' && x.allowed && x.down > 0) && /401|OAuth|authenticat|invalid/i.test(`${r.stdout}\n${r.stderr}`);
  await rl.close();

  // 7a (learned): with TRIF's filters, are the firewall rules still needed? The rules out, the exemption and
  // the filters kept; then the firewall off as well.
  const srvRelay1 = await echoTcp(ports.relay, '127.0.0.1');
  const srvKey1 = await echoTcp(ports.keyProxy, '127.0.0.1');
  const wide = Object.fromEntries(Object.entries(targets).filter(([k]) => !/folder$|secret/.test(k)));
  ps(`Get-NetFirewallRule -Group '${winbox.RULE_GROUP}' | Remove-NetFirewallRule`);
  const noRules = await inside(fence, A, wide, 'the filters and the exemption, no firewall rules');
  for (const [k, v] of Object.entries(noRules)) if (!/^loopback/.test(k)) learned[`filters, no rules: ${k}`] = v;
  ps('Set-NetFirewallProfile -All -Enabled False');
  const noFw = await inside(fence, A, wide, 'the filters and the exemption, no rules, the firewall off');
  for (const [k, v] of Object.entries(noFw)) if (!/^loopback/.test(k)) learned[`filters, no rules, firewall off: ${k}`] = v;
  ps('Set-NetFirewallProfile -All -Enabled True');
  const wfpOnly = (o2) => o2['TRIF\'s relay port, 127.0.0.1'] === 'echo ok' && o2['TRIF\'s key proxy port, 127.0.0.1'] === 'echo ok' && mustBeClosed.every((k) => !(k in o2) || o2[k] !== 'echo ok');
  learned['THE FILTERS ALONE HOLD (no rules)'] = wfpOnly(noRules);
  learned['THE FILTERS ALONE HOLD (no rules, the firewall off)'] = wfpOnly(noFw);
  await srvRelay1.close();
  await srvKey1.close();
  const back = winbox.setup({ already: true, dir: base, ports });
  verdict['setup again after the rules were taken out: ready'] = back.ok && back.status.ready;

  // 7: what the firewall being off does (the runner only; put back after)
  ps('Set-NetFirewallProfile -All -Enabled False');
  const off = winbox.status();
  console.log(`\nstatus with the firewall off: ${JSON.stringify(off)}`);
  verdict['status with the firewall off: not ready (firewallOff)'] = !off.ready && off.problems.includes('firewallOff');
  const srvRelay2 = await echoTcp(ports.relay, '127.0.0.1');
  o = await inside(fence, A, { 'another port, 127.0.0.1': targets['another port, 127.0.0.1'], 'TRIF\'s relay port, 127.0.0.1': targets['TRIF\'s relay port, 127.0.0.1'], 'the internet, 1.1.1.1:443': targets['the internet, 1.1.1.1:443'] }, 'run a, the firewall off');
  learned['firewall off: another port on 127.0.0.1 reachable'] = o['another port, 127.0.0.1'];
  learned['firewall off: the relay port reachable'] = o['TRIF\'s relay port, 127.0.0.1'];
  learned['firewall off: the internet reachable'] = o['the internet, 1.1.1.1:443'];
  ps('Set-NetFirewallProfile -All -Enabled True');

  // 8
  const rem = winbox.remove({ already: true, dir: base });
  console.log(`\nwinbox.remove: ${JSON.stringify(rem)}`);
  verdict['winbox.remove: the exemption, the rules and the filters gone'] = rem.ok && rem.status.problems.includes('notExempt') && rem.status.problems.includes('rulesMissing') && rem.status.problems.includes('filtersMissing');
  show('wfp status after remove', wfp('status'));
  o = await inside(fence, A, { 'TRIF\'s relay port, 127.0.0.1': targets['TRIF\'s relay port, 127.0.0.1'] }, 'run a, after winbox.remove');
  verdict['after remove: TRIF\'s relay port closed to the box again'] = o['TRIF\'s relay port, 127.0.0.1'] !== 'echo ok';
  await srvRelay2.close();

  for (const L of [A, B]) spawnSync(fence, ['cleanup', L.spec], { encoding: 'utf8' });
  verdict['cleanup keeps the one container'] = spawnSync(fence, ['delete', winbox.CONTAINER], { encoding: 'utf8' }).status === 0;
  for (const s of [srv.other, srv.relayHost, srv.relay6]) if (s && s.close) await s.close();
  srv.udp.close();
  for (const f of [secretFile, path.join(os.homedir(), 'wb3-planted.txt')]) fs.rmSync(f, { force: true });

  show('LEARNED (not checked)', Object.entries(learned).map(([k, x]) => `${String(x).padEnd(10)} ${k}`).join('\n'));
  show('VERDICT', Object.entries(verdict).map(([k, x]) => `${String(x).padEnd(6)} ${k}`).join('\n'));
  const short = Object.entries(verdict).filter(([, x]) => x !== true).map(([k]) => k);
  console.log(escaped ? '\nSOMETHING GOT PAST THE BOX' : '\nnothing got out of the box');
  if (short.length) console.log(`\nNOT SHOWN: ${short.join('; ')}`);
  process.exit(escaped || short.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
