#!/usr/bin/env node
'use strict';
// The Windows smoke test: TRIF set up for real on a Windows computer, the way a user does, and the helper
// started the way Chrome starts it. Run by .github/workflows/windows.yml on a throwaway windows-latest
// runner. It writes to the real HKEY_CURRENT_USER (the browsers' native messaging keys, the user's
// Path) and to Credential Manager, so it refuses to run anywhere but GitHub Actions on Windows, unless
// given --yes-this-computer.
//
//   1. a scratch user profile (USERPROFILE, LOCALAPPDATA, APPDATA in a temp folder: os.homedir() reads
//      USERPROFILE on Windows), then `node helper/cli.js setup --copy --browser chrome,edge,firefox`
//   2. checks: wrappers in ~\.trif\bin, manifests in %LOCALAPPDATA%\TRIF\NativeMessagingHosts, each
//      browser's HKCU key naming its manifest (reg.exe query), ~\.trif\bin on the user's Path
//   3. starts trif-host.bat through `cmd.exe /d /c` with the extension's origin, as Chrome does, says
//      hello over native messaging, waits for helper.pipe, runs `trif.cmd status --json` and `trif doctor`
//      through cmd.exe (the CLI reaching the helper over its named pipe)
//   4. Credential Manager: a key saved, read back, checked and removed through keyring.js
//   5. closes the helper's stdin like a browser quitting: it must exit and remove its markers
// Prints PASS/FAIL per check; exits 1 if anything failed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const { encode, Decoder } = require(path.join(REPO, 'helper', 'lib', 'framing'));

if (process.platform !== 'win32') { console.error('windows-smoke: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--yes-this-computer')) {
  console.error('windows-smoke: this writes to the real HKCU registry, the user Path and Credential Manager.\nIt runs on GitHub Actions; elsewhere pass --yes-this-computer.');
  process.exit(2);
}

let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!ok) failed++;
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); }
}

// The browsers set up, and each one's key (Edge's own: Edge is on every Windows, and the browser most
// people there have).
const HOST_KEYS = [
  ['chrome', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper'],
  ['edge', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.webmods.helper'],
  ['firefox', 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.webmods.helper'],
];
const reg = (args) => spawnSync(path.join(process.env.SystemRoot, 'System32', 'reg.exe'), args, { encoding: 'utf8' });
// What the registry holds, read independently of TRIF's own code and whatever the letters: Windows
// PowerShell, answering in UTF-8 (reg.exe prints in the console's code page).
function powershell(script) {
  const exe = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const full = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ${script}`;
  const r = spawnSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0 ? String(r.stdout || '') : null;
}
function regDefault(key) {
  const v = powershell(`$k = Get-Item -LiteralPath 'Registry::${key.replace(/^HKCU\\/, 'HKEY_CURRENT_USER\\')}' -ErrorAction SilentlyContinue; if ($k) { [Console]::Out.Write([string]$k.GetValue('')) }`);
  return v ? v.trim() : null;
}

// Runs a .cmd/.bat the way Command Prompt would: cmd.exe /d /s /c ""file" args".
function cmdLine(file, args) { return ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`]; }
// (Asynchronous: this script answers the helper's requests to "the extension" meanwhile.)
function runCmd(file, args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.env.ComSpec || 'cmd.exe', cmdLine(file, args), { env, windowsVerbatimArguments: true });
    let stdout = '';
    let stderr = '';
    c.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    c.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const t = setTimeout(() => c.kill(), 60000);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}

(async () => {
  // A profile folder like many people's: a space, letters outside ASCII (an accent, and ones no Western
  // code page has) and a percent sign. Everything below must work in it: the wrappers (cmd.exe reads a
  // .bat in the console's code page), the registry values, the user's Path, the manifests.
  const profile = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-smoke-'))), 'Zo\u00eb \u7528\u6237 100%');
  fs.mkdirSync(profile);
  const env = {
    ...process.env,
    USERPROFILE: profile,
    LOCALAPPDATA: path.join(profile, 'AppData', 'Local'),
    APPDATA: path.join(profile, 'AppData', 'Roaming'),
    TRIF_UPDATE_DELAY: '2000000000',
  };
  delete env.HOME;
  delete env.TRIF_HOME;
  for (const d of [env.LOCALAPPDATA, env.APPDATA]) fs.mkdirSync(d, { recursive: true });
  const home = path.join(profile, '.trif');
  console.log(`profile ${profile}`);

  // 1. setup
  const s = spawnSync(process.execPath, [path.join(REPO, 'helper', 'cli.js'), 'setup', '--copy', '--browser', 'chrome,edge,firefox'], { env, encoding: 'utf8', timeout: 300000 });
  console.log(s.stdout);
  if (!check(s.status === 0, 'setup --copy --browser chrome,edge,firefox exits 0', s.stderr)) { process.exitCode = 1; }

  // 2. what setup made
  const bin = path.join(home, 'bin');
  const bat = path.join(bin, 'trif-host.bat');
  const cmd = path.join(bin, 'trif.cmd');
  check(fs.existsSync(bat) && fs.readFileSync(bat, 'utf8').startsWith('@echo off\r\n'), 'trif-host.bat starts with @echo off');
  check(fs.existsSync(cmd), 'trif.cmd');
  check(fs.existsSync(path.join(bin, 'trif')), 'trif (for Git Bash)');
  check(fs.existsSync(path.join(home, 'app', 'helper', 'host.js')), 'the copy in ~\\.trif\\app');
  for (const [b, key] of HOST_KEYS) {
    const manifest = path.join(env.LOCALAPPDATA, 'TRIF', 'NativeMessagingHosts', b, 'com.webmods.helper.json');
    check(fs.existsSync(manifest), `${b}: manifest ${manifest}`);
    const v = regDefault(key);
    check(v && v.toLowerCase() === manifest.toLowerCase(), `${b}: ${key} names it`, `it says ${v}`);
    try { check(JSON.parse(fs.readFileSync(manifest, 'utf8')).path === bat, `${b}: the manifest runs trif-host.bat`); } catch (e) { check(false, `${b}: manifest readable`, e.message); }
  }
  const userPath = powershell("[Console]::Out.Write([string][Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment').GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames))") || '';
  check(userPath.toLowerCase().includes(bin.toLowerCase()), '~\\.trif\\bin is on the user\'s Path', userPath);

  check(/^[\x00-\x7f]*$/.test(fs.readFileSync(bat, 'utf8')) && /^[\x00-\x7f]*$/.test(fs.readFileSync(cmd, 'utf8')), 'the wrappers are plain ASCII, whatever the profile folder is called');
  // (For the record, not a check: what cmd.exe makes of such a path written into a .bat as it is, in UTF-8,
  // without and with `chcp 65001` first. It's why the wrappers name their files from %~dp0.)
  {
    const probeJs = path.join(profile, 'probe.js');
    fs.writeFileSync(probeJs, 'process.stdout.write("PROBE-RAN");');
    for (const [name, lines] of [['as it is', []], ['after chcp 65001', ['chcp 65001 >nul 2>&1']]]) {
      const probe = path.join(os.tmpdir(), `trif-probe-${Date.now()}.bat`);
      fs.writeFileSync(probe, ['@echo off', ...lines, `"${process.execPath}" "${probeJs.replace(/%/g, '%%')}"`, ''].join('\r\n'));
      const r = await runCmd(probe, [], env);
      console.log(`INFO  a .bat naming ${probeJs} in UTF-8, ${name}: ${r.stdout.includes('PROBE-RAN') ? 'runs' : `doesn't run (${(r.stderr || r.stdout).trim().split(/\r?\n/)[0] || `exit ${r.status}`})`}`);
      fs.rmSync(probe, { force: true });
    }
  }

  // 3. the helper, started as Chrome starts it
  const origin = 'chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/';
  const host = spawn(process.env.ComSpec || 'cmd.exe', cmdLine(bat, [origin, '--parent-window=0']), { env, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: true });
  const messages = [];
  let bad = 0;
  host.stdout.on('data', (d) => decoder.push(d));
  const decoder = new Decoder((m) => messages.push(m), () => { bad++; });
  let stderr = '';
  host.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((r) => host.on('exit', (code) => r(code)));
  host.stdin.write(encode({ type: 'hello', version: require(path.join(REPO, 'package.json')).version, userScripts: true, chrome: '140.0.0.0', browser: 'Chrome' }));
  host.on('error', (e) => check(false, 'start trif-host.bat', e.message));
  // Answer the helper's page requests like the extension would (status asks for "status").
  setInterval(() => {
    for (const m of messages.splice(0)) {
      if (m.type === 'request') host.stdin.write(encode({ type: 'response', id: m.id, ok: true, result: { tabs: [], userScripts: true } }));
    }
  }, 50).unref();

  const markerFile = path.join(home, 'helper.pipe');
  const pipe = await waitFor(() => { try { return fs.readFileSync(markerFile, 'utf8').trim(); } catch { return null; } });
  check(pipe && /^\\\\\.\\pipe\\trif-[0-9a-f]{32}$/.test(pipe), 'the helper names its pipe in helper.pipe', `${pipe}\n${stderr}`);
  check(bad === 0, 'nothing but native messaging on the helper\'s stdout');
  const t0 = Date.now();
  const st = await runCmd(cmd, ['status', '--json'], env);
  let status = null;
  try { status = JSON.parse(st.stdout); } catch { /* below */ }
  check(st.status === 0 && status && status.helper && status.helper.extension && status.helper.extension.browser === 'Chrome', 'trif.cmd status reaches the helper over the pipe', `${st.status}\n${st.stdout}\n${st.stderr}`);
  check(status && status.extension && !status.error, 'and a page command goes through to the extension and back', st.stdout);
  check(Date.now() - t0 < 8000, `trif.cmd status took ${Date.now() - t0} ms`);
  const doc = await runCmd(cmd, ['doctor'], env);
  console.log(doc.stdout);
  for (const want of [/^ok {4}host wrapper .*trif-host\.bat/m, /^ok {4}Google Chrome: native host manifest$/m, /^ok {4}Microsoft Edge: native host manifest$/m, /^ok {4}Firefox: native host manifest$/m, /^ok {4}helper running/m, /^ok {4}the fence for chats from the panel can be built here/m]) {
    check(want.test(doc.stdout), `trif doctor: ${want}`);
  }

  // 4. Credential Manager, through keyring.js (the helper's own code)
  const keyring = require(path.join(REPO, 'helper', 'lib', 'keyring'));
  const KEY = `sk-smoke-${Date.now()}-0123456789abcdef`;
  const service = 'TRIF smoke test';
  try {
    await keyring.setKey('smoke', KEY, { service });
    const got = await keyring.getKey('smoke', { service });
    check(got.value === KEY, 'Credential Manager: the key saved reads back', JSON.stringify({ ...got, value: got.value ? '(something else)' : null }));
    check((await keyring.hasKey('smoke', { service })).stored === true, 'Credential Manager: hasKey');
    check((await keyring.removeKey('smoke', { service })).removed === true, 'Credential Manager: removed');
    check((await keyring.getKey('smoke', { service })).value === null, 'Credential Manager: gone');
  } catch (e) {
    check(false, 'Credential Manager round trip', e.message);
  }

  // 5. the browser quits
  host.stdin.end();
  const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
  check(code !== 'timeout', 'the helper exits when its stdin closes', String(code));
  check(!fs.existsSync(markerFile), 'and removes helper.pipe');
  if (code === 'timeout') host.kill();

  for (const [, key] of HOST_KEYS) reg(['delete', key, '/f']);
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
