'use strict';
// SPIKE (docs/WHOLE-BOX.md): the whole agent process in TRIF's own Seatbelt box (helper/lib/wholebox.js).
//   1. the profile and the allowlist proxy, anywhere;
//   2. macOS: a node program in the box tries what a run's file tools and commands could (any program in
//      the box gets the same answers as Claude Code's own Read/Write/Grep, which are code in the same
//      process): the staged copy readable, its own site writable, nothing else;
//   3. macOS with Claude Code installed: the real Claude Code, in the box, with the loosest settings it
//      has (every tool allowed, --dangerously-skip-permissions, its own sandbox off: more than any
//      organization's managed settings can give), driven by a stand-in model (no account, no paid call,
//      a scratch config folder, never the user's ~/.claude or login), tries to read and write outside
//      the copy: the system refuses. The same run without the box reads it all (the control).
// (The full side-panel run, every `trif` command, in the box: TRIF_WHOLE_BOX=1 tests/run-sandbox.test.js.)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const wb = require('../helper/lib/wholebox');
const claude = require('../helper/lib/agents/claude');
const { startFakeAnthropic } = require('./fake-anthropic-server');
const { findExecutable } = require('../helper/lib/agents/util');

const mac = process.platform === 'darwin';
const SECRET = 'SECRET-whole-box-7f3a';

test('profile: deny by default, the copy and own site only, ports on this computer only', () => {
  const p = wb.macProfile({ read: ['/r'], write: ['/w'], readOnly: ['/w/other.com'], sites: '/w', configDir: '/c', ports: [4321] });
  assert.match(p, /^\(version 1\)\n\(deny default\)/);
  assert.match(p, /\(allow file-read\* \(subpath "\/r"\) \(subpath "\/w"\) \(subpath "\/c"\)\)/);
  assert.match(p, /\(deny file-write\* \(subpath "\/w\/other\.com"\)\)/);
  assert.match(p, /\(allow network-outbound \(remote tcp "localhost:4321"\)\)/);
  assert.doesNotMatch(p, /network\*|network-outbound \(remote ip|mDNSResponder|SecurityServer|launchservices|appleevent/i);
  assert.match(wb.macProfile({ keychain: true }), /com\.apple\.SecurityServer/);
  // the deny rules come after the allows (later rules win)
  assert.ok(p.indexOf('(deny file-write* (subpath "/w/other.com"))') > p.indexOf('(allow file-write*'));
});

test('localPorts: only proxies on this computer', () => {
  assert.deepEqual(wb.localPorts({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:5555', HTTPS_PROXY: 'http://localhost:6666', OPENAI_BASE_URL: 'https://api.openai.com/v1' }).sort(), [5555, 6666]);
  assert.deepEqual(wb.localPorts({}), []);
});

test('allowlist proxy: tunnels to Anthropic on 443 only', async () => {
  assert.ok(wb.hostAllowed('api.anthropic.com:443'));
  for (const h of ['api.anthropic.com:80', 'evil.com:443', 'api.anthropic.com.evil.com:443', 'api.anthropic.com', '127.0.0.1:443']) assert.ok(!wb.hostAllowed(h), h);
  // a stand-in upstream for api.anthropic.com (never the internet)
  const up = net.createServer((s) => s.end('UPSTREAM-HELLO')).listen(0, '127.0.0.1');
  await new Promise((r) => up.once('listening', r));
  const proxy = await wb.startProxy({ connect: () => net.connect(up.address().port, '127.0.0.1') });
  const ask = (target) => new Promise((resolve) => {
    const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let out = '';
    s.on('data', (d) => { out += d; });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
  });
  assert.match(await ask('api.anthropic.com:443'), /200 Connection established[\s\S]*UPSTREAM-HELLO/);
  assert.match(await ask('example.com:443'), /^HTTP\/1\.1 403/);
  assert.match(await ask('api.anthropic.com:22'), /^HTTP\/1\.1 403/);
  await proxy.close();
  up.close();
});

// A scratch layout as a staged run sees it (runs.js runLimits with stage): a home folder with secrets, the
// live workspace and private folder, the run's copy, box, screenshots and temporary folders.
function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wbx-')));
  const d = (...p) => { const x = path.join(root, ...p); fs.mkdirSync(x, { recursive: true }); return x; };
  const w = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const home = d('home');
  const live = d('home', '.trif');
  const stage = d('box', 'run1.ws');
  const L = {
    root, home, live, stage,
    secret: w(path.join(home, '.ssh', 'id_ed25519'), `${SECRET} ssh\n`),
    liveMod: w(path.join(live, 'sites', 'example.com', 'live.user.js'), `// ${SECRET} live\n`),
    liveBin: w(path.join(live, 'bin', 'trif'), '#!/bin/sh\necho trif-shim\n'),
    priv: w(path.join(root, 'private', 'config.json'), `{"secret":"${SECRET} private"}`),
    other: w(path.join(root, 'elsewhere', 'notes.txt'), `${SECRET} elsewhere\n`),
    guide: w(path.join(stage, 'AGENTS.md'), 'the guide\n'),
    own: w(path.join(stage, 'sites', 'example.com', 'a.user.js'), '// own mod COPY-OK\n'),
    otherSite: w(path.join(stage, 'sites', 'other.com', 'b.user.js'), '// other site\n'),
    cfg: d('private', 'agent-config', 'claude'),
    box: d('box', 'run1'), shots: d('private', 'screenshots', 'example.com'), agentTmp: d('atmp'),
  };
  fs.mkdirSync(path.join(L.box, 'tmp'));
  L.limits = {
    workspace: stage, home, readable: [live, stage], writable: [path.join(stage, 'sites'), L.shots, L.box], readOnly: [path.join(stage, 'sites', 'other.com')],
    lockedDirs: [{ literal: path.join(stage, 'sites', 'other.com'), real: path.join(stage, 'sites', 'other.com'), rel: 'sites/other.com' }],
    modsDir: path.join(stage, 'sites'), box: L.box, screenshots: L.shots, tmp: path.join(L.box, 'tmp'), agentTmp: L.agentTmp,
    privateDir: path.join(root, 'private'), staged: true, liveWorkspace: live, liveMods: path.join(live, 'sites'), wholeBox: true,
  };
  return L;
}

// What a program in the box can do: each attempt -> 'ok' or the error code.
const PROBE = `
const fs = require('fs'), net = require('net'), dns = require('dns'), { spawnSync } = require('child_process');
const [L, port] = [JSON.parse(process.argv[2]), Number(process.argv[3])];
const out = {};
const t = (k, fn) => { try { const v = fn(); out[k] = v === undefined ? 'ok' : v; } catch (e) { out[k] = e.code || e.message; } };
t('read own mod', () => fs.readFileSync(L.own, 'utf8').includes('COPY-OK') ? 'ok' : 'wrong');
t('read guide', () => fs.readFileSync(L.guide, 'utf8') && 'ok');
t('read other site (copy)', () => fs.readFileSync(L.otherSite, 'utf8') && 'ok');
t('write own site', () => fs.writeFileSync(L.stage + '/sites/example.com/new.user.js', '//'));
t('new site folder', () => fs.mkdirSync(L.stage + '/sites/new.net'));
t('write box tmp', () => fs.writeFileSync(L.box + '/tmp/x', 'x'));
t('write config', () => fs.writeFileSync(L.cfg + '/.claude.json', '{}'));
t('read ssh key', () => fs.readFileSync(L.secret, 'utf8'));
t('list home', () => fs.readdirSync(L.home).join(','));
t('read live mod', () => fs.readFileSync(L.liveMod, 'utf8'));
t('read private', () => fs.readFileSync(L.priv, 'utf8'));
t('read elsewhere', () => fs.readFileSync(L.other, 'utf8'));
t('read real home', () => fs.readdirSync(require('os').homedir()).join(','));
t('write other site', () => fs.writeFileSync(L.otherSite, 'evil'));
t('write guide', () => fs.writeFileSync(L.guide, 'evil'));
t('write CLAUDE.md in site', () => fs.writeFileSync(L.stage + '/sites/example.com/CLAUDE.md', 'evil'));
t('write .claude in site', () => fs.mkdirSync(L.stage + '/sites/example.com/.claude'));
t('write config settings', () => fs.writeFileSync(L.cfg + '/settings.json', '{}'));
t('write live mods', () => fs.writeFileSync(L.live + '/sites/example.com/x.user.js', 'evil'));
t('write live bin', () => fs.writeFileSync(L.liveBin, 'evil'));
t('write /tmp', () => fs.writeFileSync('/tmp/wbx-escape', 'x'));
t('nested sandbox-exec', () => { const r = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/bin/cat', L.secret], { encoding: 'utf8' }); return r.stdout.includes('SECRET') ? 'escaped' : 'refused:' + (r.stderr || '').trim(); });
t('cat via shell', () => { const r = spawnSync('/bin/sh', ['-c', 'cat "$0"', L.secret], { encoding: 'utf8' }); return r.stdout.includes('SECRET') ? 'escaped' : 'refused:' + r.stderr.trim(); });
t('security CLI', () => { const r = spawnSync('/usr/bin/security', ['list-keychains'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() ? 'listed' : 'refused:' + r.status; });
const conn = (host, p) => new Promise((res) => { const s = net.connect(p, host); s.on('connect', () => { s.destroy(); res('ok'); }); s.on('error', (e) => res(e.code)); });
(async () => {
  out['connect allowed port'] = await conn('127.0.0.1', port);
  out['connect other local port'] = await conn('127.0.0.1', port + 1);
  out['connect 1.1.1.1:443'] = await conn('1.1.1.1', 443);
  out['dns lookup'] = await new Promise((res) => dns.lookup('example.com', (e) => res(e ? e.code : 'ok')));
  process.stdout.write(JSON.stringify(out));
})();
`;

test('macOS: a program in the box reads only the copy and writes only its own site', { skip: !mac && 'macOS only' }, async () => {
  const L = layout();
  const listening = net.createServer((s) => s.end()).listen(0, '127.0.0.1');
  await new Promise((r) => listening.once('listening', r));
  const port = listening.address().port;
  const probe = path.join(L.root, 'probe', 'probe.js');
  fs.mkdirSync(path.dirname(probe));
  fs.writeFileSync(probe, PROBE);
  const nodeDir = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
  const w = wb.wrap({ file: fs.realpathSync(process.execPath), args: [probe, JSON.stringify(L), String(port)], env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } },
    { limits: L.limits, configDir: L.cfg, profileFile: path.join(L.root, 'box.sb'), extraRead: [nodeDir, path.dirname(probe)] });
  const r = spawnSync(w.file, w.args, { env: { PATH: '/usr/bin:/bin', HOME: L.home }, encoding: 'utf8', timeout: 30000 });
  listening.close();
  let got;
  try { got = JSON.parse(r.stdout); } catch { assert.fail(`probe: ${r.stdout}\n${r.stderr}`); }
  const info = JSON.stringify(got, null, 1);
  for (const k of ['read own mod', 'read guide', 'read other site (copy)', 'write own site', 'new site folder', 'write box tmp', 'write config', 'connect allowed port']) assert.equal(got[k], 'ok', `${k}: ${info}`);
  for (const k of ['read ssh key', 'list home', 'read live mod', 'read private', 'read elsewhere', 'read real home', 'write other site', 'write guide',
    'write CLAUDE.md in site', 'write .claude in site', 'write config settings', 'write live mods', 'write live bin', 'write /tmp']) assert.equal(got[k], 'EPERM', `${k}: ${info}`);
  assert.match(got['nested sandbox-exec'], /^refused:.*sandbox_apply: Operation not permitted/, info);
  assert.match(got['cat via shell'], /^refused:.*Operation not permitted/, info);
  assert.notEqual(got['security CLI'], 'listed', info);
  for (const k of ['connect other local port', 'connect 1.1.1.1:443']) assert.equal(got[k], 'EPERM', `${k}: ${info}`);
  assert.notEqual(got['dns lookup'], 'ok', info);
  assert.ok(!fs.existsSync('/tmp/wbx-escape'));
  assert.equal(fs.readFileSync(L.otherSite, 'utf8'), '// other site\n');
});

// ---------------------------------------------------------------- the real Claude Code, loosest settings
// (CI: TRIF's pinned Claude Code, the one boxed runs use, installed by `node helper/lib/claudepin.js ensure <dir>`)
const pinned = mac && process.env.TRIF_TEST_CLAUDE_PIN_HOME ? require('../helper/lib/claudepin').installedPinned(process.env.TRIF_TEST_CLAUDE_PIN_HOME) : null;
const claudeBin = pinned ? pinned.bin : mac && !process.env.TRIF_TEST_NO_REAL_CLAUDE && findExecutable('claude', [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '').split(path.delimiter)]);

// Everything Claude Code can be told to allow: its own sandbox off, every tool allowed, no asking, the
// home folder as an extra working folder. More than an organization's managed settings can loosen.
function loosest(c, L) {
  const permissive = { sandbox: { enabled: false }, permissions: { allow: ['Read(//**)', 'Edit(//**)', 'Write(//**)', 'Bash(*)', 'Glob', 'Grep'], deny: [], defaultMode: 'bypassPermissions', additionalDirectories: [L.root] } };
  for (const f of c.files) if (f.path.endsWith('settings.json')) f.content = JSON.stringify(permissive);
  fs.mkdirSync(path.join(L.stage, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(L.stage, '.claude', 'settings.json'), JSON.stringify(permissive));
  const i = c.args.indexOf('--allowedTools');
  const j = c.args.indexOf('--disallowedTools');
  const args = [...c.args.slice(0, i), '--allowedTools', 'Read(//**)', 'Edit(//**)', 'Write(//**)', 'Bash(*)', 'Glob', 'Grep', ...c.args.slice(j + 2), '--dangerously-skip-permissions', '--add-dir', L.root];
  return args.map((a, k) => (args[k - 1] === '--permission-mode' ? 'bypassPermissions' : a));
}

async function runClaude(L, { boxed, script = null }) {
  const steps = script || [
    { tool: 'Read', input: { file_path: L.own } },
    { tool: 'Read', input: { file_path: L.secret } },
    { tool: 'Read', input: { file_path: L.liveMod } },
    { tool: 'Read', input: { file_path: L.priv } },
    { tool: 'Grep', input: { pattern: 'SECRET', path: L.root, output_mode: 'content' } },
    { tool: 'Glob', input: { pattern: '**/*', path: L.home } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'example.com', 'new.user.js'), content: '// new\n' } },
    { tool: 'Write', input: { file_path: path.join(L.stage, 'sites', 'other.com', 'evil.user.js'), content: '// evil\n' } },
    { tool: 'Write', input: { file_path: path.join(L.live, 'sites', 'example.com', 'evil.user.js'), content: '// evil\n' } },
    { bash: `cat ${L.secret}` },
    { bash: '/usr/bin/curl -s -m 5 -o /dev/null -w "%{http_code}" https://example.com/ || echo no-network' },
    { say: 'done' },
  ];
  const fake = await startFakeAnthropic({ script: steps });
  const agentDir = path.join(L.root, boxed ? 'agent-boxed' : 'agent-open');
  fs.mkdirSync(agentDir);
  const c = claude.command({ bin: claudeBin, prompt: 'probe', agentDir, model: 'claude-haiku-stand-in', ...L.limits, wholeBox: boxed });
  const args = loosest(c, L);
  for (const f of c.files) fs.writeFileSync(f.path, f.content);
  const env = { HOME: L.home, USER: os.userInfo().username, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TERM: 'dumb', ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_API_KEY: 'placeholder',
    CLAUDE_CONFIG_DIR: L.cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...c.env };
  let cmd = { file: c.file, args, env };
  if (boxed) cmd = wb.wrap(cmd, { limits: L.limits, configDir: L.cfg, profileFile: path.join(agentDir, 'box.sb'), extraRead: [agentDir, path.dirname(path.dirname(fs.realpathSync(process.execPath)))] }); // (and node, if this Claude Code is npm's node script)
  const t0 = Date.now();
  const res = await new Promise((resolve) => {
    const child = spawn(cmd.file, cmd.args, { cwd: L.stage, env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end('probe');
  });
  const results = fake.toolResults();
  await fake.close();
  return { ...res, results, ms: Date.now() - t0, labels: steps.slice(0, -1).map((s) => s.bash || `${s.tool} ${s.input.file_path || s.input.path}`) };
}

test('macOS, real Claude Code with its loosest settings: outside the copy, the system refuses', { skip: !claudeBin && 'Claude Code not installed (or not macOS)' }, async () => {
  // The control: the same loosest run without the box gets every secret (so the box is what refuses).
  const open = await runClaude(layout(), { boxed: false });
  const openInfo = open.labels.map((l, i) => `${l}\n  -> ${String(open.results[i]).slice(0, 300)}`).join('\n') + `\n${open.err.slice(-1500)}`;
  assert.equal(open.results.length, open.labels.length, openInfo);
  for (const i of [1, 2, 3, 4, 9]) assert.ok(open.results[i].includes(SECRET), `control: ${open.labels[i]} should get through without the box:\n${openInfo}`);

  const L = layout();
  const boxed = await runClaude(L, { boxed: true });
  const info = boxed.labels.map((l, i) => `${l}\n  -> ${String(boxed.results[i]).slice(0, 300)}`).join('\n') + `\nexit ${boxed.code}\n${boxed.err.slice(-1500)}`;
  assert.equal(boxed.results.length, boxed.labels.length, info);
  const result = boxed.out.split('\n').map((x) => { try { return JSON.parse(x); } catch { return null; } }).find((m) => m && m.type === 'result');
  assert.ok(result && !result.is_error, `the run finished:\n${info}`);
  assert.match(boxed.results[0], /COPY-OK/, info); // its own mod, in the copy
  assert.ok(boxed.results.every((r) => !r.includes(SECRET)), `a secret got through:\n${info}`);
  for (const i of [1, 2, 3]) assert.match(boxed.results[i], /EPERM|operation not permitted/i, `${boxed.labels[i]}:\n${info}`);
  assert.ok(fs.existsSync(path.join(L.stage, 'sites', 'example.com', 'new.user.js')), info); // its own site
  assert.ok(!fs.existsSync(path.join(L.stage, 'sites', 'other.com', 'evil.user.js')), info);
  assert.ok(!fs.existsSync(path.join(L.live, 'sites', 'example.com', 'evil.user.js')), info);
  assert.match(boxed.results[9], /Operation not permitted/i, info);
  assert.doesNotMatch(boxed.results[10], /^\s*200\s*$/, info);
  console.log(`# without the box: ${open.ms} ms; in the box: ${boxed.ms} ms (the whole run, stand-in model)`);
  console.log(info.split('\n').map((x) => `# ${x}`).join('\n'));
});

// On CI only (.github/workflows/whole-box.yml writes the real managed-settings.json in /Library/Application
// Support/ClaudeCode with sudo, on GitHub's runner, never on anyone's computer): TRIF_TEST_MANAGED says which.
//   loosen      every tool allowed, bypassPermissions, Claude Code's sandbox off, the whole disk as a
//               working folder: test 5 above must still hold (and its control shows the settings loosen)
//   sandbox-on  the organization forces Claude Code's own command sandbox on (and no unsandboxed retry):
//               in TRIF's box it can't start (a sandboxed process can't apply another), so commands fail
//               closed; the file tools are still fenced
const managed = process.env.TRIF_TEST_MANAGED || '';
test('CI, managed settings force Claude Code\'s sandbox on: in the box, commands fail closed, file tools stay fenced', { skip: (managed !== 'sandbox-on' || !claudeBin) && 'only with TRIF_TEST_MANAGED=sandbox-on (CI)' }, async () => {
  const L = layout();
  const r = await runClaude(L, { boxed: true, script: [{ tool: 'Read', input: { file_path: L.secret } }, { bash: 'echo bash-ok' }, { bash: `cat ${L.secret}` }, { tool: 'Read', input: { file_path: L.own } }, { say: 'done' }] });
  const info = r.labels.map((l, i) => `${l}\n  -> ${String(r.results[i]).slice(0, 400)}`).join('\n') + `\nexit ${r.code}\n${r.err.slice(-1500)}`;
  console.log(info.split('\n').map((x) => `# ${x}`).join('\n'));
  assert.ok(r.results.every((x) => !String(x).includes(SECRET)), info);
  assert.match(String(r.results[3]), /COPY-OK/, info);
});
