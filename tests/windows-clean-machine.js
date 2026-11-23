#!/usr/bin/env node
'use strict';
// The clean-machine test on Windows (docs/NO-NODE.md, step 12; the macOS/Linux one is
// tests/clean-machine.test.js): TRIF on a Windows computer with no Node. Everything TRIF runs gets a PATH of
// Windows' own folders alone (checked: `where node` finds nothing) and a scratch user profile whose name has
// a space, letters outside ASCII and a % in it. This script itself runs on whatever Node started it.
//
//   A. install.ps1 (filled in by release.js installScriptWindows) the way a person runs it,
//      `& ([scriptblock]::Create((irm <url>))) <setup's options>` in Windows PowerShell, against a local
//      server holding `npm pack`-shaped builds of this checkout and the real pinned node.exe .zip (downloaded
//      once from nodejs.org into a cache, checksum-checked); then trif.cmd help and doctor on TRIF's own
//      Node, the helper started as a browser starts it (on that node.exe), `trif status` over its pipe; in CI
//      a program on that node.exe inside a run's fence (an AppContainer); `trif update --install` from a
//      signed local feed (a test release key); `trif uninstall --all --yes`, and nothing of TRIF left.
//   B. the upgrade: a Node-based install as people have it before this (`node cli.js setup --copy` with the
//      computer's Node, from git ref TRIF_UPGRADE_FROM or --from-dir), updated to this build by its own
//      updater; the new setup fetches TRIF's own Node and moves the wrappers onto it; the mods and settings
//      stay; then with no Node on PATH, doctor and the helper still work; `trif uninstall` keeps the mods.
//
// Where it writes: on GitHub Actions (GITHUB_ACTIONS=true), the runner's real HKCU keys, the user's Path
// and Credential Manager, as a person's install does. Anywhere else (--safe, the default off CI) nothing
// outside its scratch folder: the registry under HKCU\Software\TRIF-clean-<pid> (TRIF_REG_ROOT), PowerShell's
// keyring and PATH steps through tests/fake-powershell.js, `--no-link`, and no fence (it makes AppContainer
// profiles); so it can run on a person's Windows next to their own TRIF without touching it.
//
//   node tests/windows-clean-machine.js [--safe] [--from-dir <old source tree>] [--keep]
// Prints PASS/FAIL per check, INFO lines with sizes and timings; exits 1 if anything failed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

if (process.platform !== 'win32') { console.error('windows-clean-machine: Windows only'); process.exit(2); }

const REPO = path.resolve(__dirname, '..');
const R = require('../helper/lib/runtime');
const rel = require('../scripts/release');
const launchers = require('../helper/lib/win/launchers');
const { compareVersions } = require('../helper/lib/update');
const { encode, Decoder } = require('../helper/lib/framing');
const { makeFakePowerShell } = require('./fake-powershell');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const SAFE = argv.includes('--safe') || process.env.GITHUB_ACTIONS !== 'true';
const KEEP = argv.includes('--keep');
const KEY = R.platformKey();
const SYS = process.env.SystemRoot || 'C:\\Windows';
const sys32 = (f) => path.join(SYS, 'System32', f);
const TAR = sys32('tar.exe');
const POWERSHELL = sys32('WindowsPowerShell\\v1.0\\powershell.exe');
const NO_NODE_PATH = [sys32(''), SYS, sys32('Wbem'), sys32('WindowsPowerShell\\v1.0')].map((d) => d.replace(/\\$/, '')).join(';');

let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!ok) failed++;
  return ok;
}
const info = (s) => console.log(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(200); }
}
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const t0 = () => process.hrtime.bigint();
const msSince = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);
function du(p) {
  let n = 0;
  try { const st = fs.lstatSync(p); if (!st.isDirectory()) return st.size; for (const f of fs.readdirSync(p)) n += du(path.join(p, f)); } catch { /* gone */ }
  return n;
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

// cmd.exe /d /s /c ""file" args", as Command Prompt or a browser runs a .cmd/.bat.
function cmdArgs(file, args) { return ['/d', '/s', '/c', `""${file}" ${args.map((a) => (/[\s"&|<>^%]/.test(a) ? `"${a}"` : a)).join(' ')}"`]; }
function runCmd(file, args, env, { timeout = 300000 } = {}) {
  return new Promise((resolve) => {
    const t = t0();
    const c = spawn(sys32('cmd.exe'), cmdArgs(file, args), { env, windowsVerbatimArguments: true, windowsHide: true });
    let out = '';
    c.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    c.stderr.setEncoding('utf8').on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\n(timed out)'; spawnSync(sys32('taskkill.exe'), ['/PID', String(c.pid), '/T', '/F']); }, timeout);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: msSince(t) }); });
  });
}
function powershell(script, env, { timeout = 600000 } = {}) {
  const full = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ${script}`;
  const t = t0();
  const r = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { env, encoding: 'utf8', timeout, windowsHide: true });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`, ms: msSince(t) };
}
function regDefault(key, env) {
  const r = powershell(`$k = Get-Item -LiteralPath 'Registry::${key.replace(/^HKCU\\/, 'HKEY_CURRENT_USER\\').replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if ($k) { [Console]::Out.Write([string]$k.GetValue('')) }`, env);
  return r.code === 0 && r.out.trim() ? r.out.trim() : null;
}
function processPath(pid, env) {
  const r = powershell(`$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { [Console]::Out.Write($p.Path) }`, env);
  return r.out.trim();
}

// A package shaped like `npm pack`'s (package/… in a .tgz), of `root` at `version`, trusting `releaseKey` (a
// PEM) in place of the real one when given. Packed with Windows' tar.exe: no npm needed.
function pack(S, version, releaseKey, root = REPO) {
  const stage = path.join(S, `stage-${version}`);
  const dir = path.join(stage, 'package');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const f of pkg.files) {
    fs.cpSync(path.join(root, f.replace(/\/$/, '')), path.join(dir, f.replace(/\/$/, '')), { recursive: true, filter: (p) => !p.split(path.sep).includes('node_modules') });
  }
  for (const f of ['README.md', 'LICENSE']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...pkg, version, scripts: {} }, null, 2));
  if (releaseKey) fs.writeFileSync(path.join(dir, 'helper', 'lib', 'release-key.js'), `'use strict';\nmodule.exports = ${JSON.stringify(releaseKey)};\n`);
  const out = path.join(S, 'files', `timsrobot-${version}.tgz`);
  execFileSync(TAR, ['-czf', out, '-C', stage, 'package']);
  return out;
}

// The real pinned .zip for this computer, from a cache (downloaded from nodejs.org when missing).
async function nodeArchive() {
  const pin = R.PINS.archives[KEY][0];
  const dir = process.env.TRIF_TEST_NODE_CACHE || path.join(os.tmpdir(), 'trif-node-archives');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, pin.file);
  if (!fs.existsSync(file) || sha(file) !== pin.sha256) {
    const t = t0();
    const data = await require('../helper/lib/update').fetchUrl(R.PINS.base + pin.file, { maxBytes: 100 * 1024 * 1024, timeoutMs: 300000 });
    fs.writeFileSync(`${file}.part`, data);
    fs.renameSync(`${file}.part`, file);
    info(`downloaded ${pin.file} (${mb(data.length)}) in ${msSince(t)} ms`);
  }
  if (sha(file) !== pin.sha256) throw new Error(`${file} isn't the pinned archive`);
  return { pin, file };
}

// A static file server in its own process (install.ps1 and TRIF run synchronously from here).
function serve(dir) {
  const src = `const http=require('http'),fs=require('fs'),path=require('path');
    const s=http.createServer((q,r)=>{const f=path.join(${JSON.stringify(dir)},path.basename(q.url.split('?')[0]));
      fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200,f.endsWith('.ps1')?{'Content-Type':'text/plain; charset=utf-8'}:{});r.end(d);}});});
    s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  return new Promise((resolve) => child.stdout.once('data', (d) => resolve({ base: `http://127.0.0.1:${String(d).trim()}/`, stop: () => child.kill() })));
}

const REG_ROOTS = []; // (safe mode's scratch registry roots, removed at the end)

// The computer: a scratch profile, PATH with Windows' folders alone, no node; nothing of this process's
// Node (NODE_*, npm_*) or of a TRIF it may have (TRIF_*).
function computer(S, name) {
  const profile = path.join(S, name);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(path|home)$|^(trif_|webmods_|node_|npm_|nvm_|volta_|fnm_)/i.test(k)) env[k] = v;
  Object.assign(env, {
    PATH: NO_NODE_PATH, USERPROFILE: profile, HOMEDRIVE: profile.slice(0, 2), HOMEPATH: profile.slice(2),
    LOCALAPPDATA: path.join(profile, 'AppData', 'Local'), APPDATA: path.join(profile, 'AppData', 'Roaming'),
    TEMP: path.join(profile, 'AppData', 'Local', 'Temp'), TMP: path.join(profile, 'AppData', 'Local', 'Temp'),
    TRIF_UPDATE_DELAY: '2000000000', TRIF_DEFAULT_AGENT_DIRS: '',
  });
  for (const d of [env.LOCALAPPDATA, env.APPDATA, env.TEMP]) fs.mkdirSync(d, { recursive: true });
  // (Edge's profile folder, so setup's default picks it as a person's would)
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default'), { recursive: true });
  let ps = null;
  if (SAFE) {
    ps = makeFakePowerShell(path.join(S, `${name}-ps`));
    const root = `HKCU\\Software\\TRIF-clean-${process.pid}-${REG_ROOTS.length}`;
    REG_ROOTS.push(root);
    Object.assign(env, { TRIF_REG_ROOT: root, TRIF_POWERSHELL_BIN: ps.bin, TRIF_KEYCHAIN_BIN: ps.bin });
  }
  const ws = path.join(profile, '.trif');
  return { profile, env, ws, ps, priv: path.join(env.LOCALAPPDATA, 'TRIF'), bin: path.join(ws, 'bin') };
}
const regRoot = (c) => c.env.TRIF_REG_ROOT || 'HKCU\\Software';
const hostKey = (c, sub) => `${regRoot(c)}\\${sub}\\NativeMessagingHosts\\com.webmods.helper`;
const BROWSER_KEYS = { chrome: 'Google\\Chrome', edge: 'Microsoft\\Edge' };

function wrapperNode(c, name) {
  const file = path.join(c.bin, name);
  const p = launchers.parseLauncher(fs.readFileSync(file, 'utf8'), { file, profile: c.profile });
  return p && p.node;
}

// The helper, started as Chrome starts it (cmd.exe running trif-host.bat with the origin), told hello.
async function startHelper(c, version) {
  const bat = path.join(c.bin, 'trif-host.bat');
  const host = spawn(sys32('cmd.exe'), cmdArgs(bat, ['chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/', '--parent-window=0']), { env: c.env, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: true, windowsHide: true });
  const messages = [];
  const decoder = new Decoder((m) => messages.push(m), () => {});
  host.stdout.on('data', (d) => decoder.push(d));
  let stderr = '';
  host.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((r) => host.on('exit', (code) => r(code)));
  host.stdin.write(encode({ type: 'hello', version, userScripts: true, chrome: '157.0.0.0', browser: 'Chrome' }));
  const timer = setInterval(() => {
    for (const m of messages.splice(0)) if (m.type === 'request') host.stdin.write(encode({ type: 'response', id: m.id, ok: true, result: { tabs: [], userScripts: true } }));
  }, 50);
  const marker = await waitFor(() => fs.readdirSync(c.ws).find((n) => /^helper-\d+\.pipe$/.test(n)));
  const pid = marker ? Number(/\d+/.exec(marker)[0]) : null;
  return {
    pid, stderr: () => stderr,
    async stop() {
      host.stdin.end();
      clearInterval(timer);
      const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
      if (code === 'timeout') spawnSync(sys32('taskkill.exe'), ['/PID', String(host.pid), '/T', '/F']);
      return code;
    },
  };
}

async function helperChecks(c, label, version) {
  const h = await startHelper(c, version);
  check(!!h.pid, `${label}: the helper started by trif-host.bat (as a browser starts it) writes its pipe marker`, h.stderr());
  const rt = R.installedNode(c.ws);
  const p = h.pid ? processPath(h.pid, c.env) : '';
  check(rt && p.toLowerCase() === rt.toLowerCase(), `${label}: the helper runs on TRIF's own node.exe`, `${p}\nruntime: ${rt}`);
  const st = await runCmd(path.join(c.bin, 'trif.cmd'), ['status', '--json'], c.env, { timeout: 60000 });
  let status = null;
  try { status = JSON.parse(st.out.slice(st.out.indexOf('{'))); } catch { /* below */ }
  check(st.code === 0 && status && status.helper && status.helper.extension, `${label}: trif.cmd status reaches it over its pipe`, st.out);
  return h;
}

function doctorChecks(d, label) {
  check(d.out.includes(`TRIF's own Node v${R.PINS.version} (`), `${label}: doctor says TRIF runs on its own Node v${R.PINS.version}`, d.out);
  check(!/not its own|damaged|system Node|still on/i.test(d.out), `${label}: doctor has no runtime warning`, d.out);
  check(/^ok {4}host wrapper .*trif-host\.bat/m.test(d.out), `${label}: doctor's host wrapper line is ok`, d.out);
}

function feedFor(S, srv, version, tgz, privateKey) {
  const feed = rel.latestFeed({ version, published: '2026-11-23', signed: new Date().toISOString(), notes: 'Test build.', url: `${srv.base}${path.basename(tgz)}`, sha256: sha(tgz), size: fs.statSync(tgz).size });
  fs.writeFileSync(path.join(S, 'files', 'latest.json'), feed);
  fs.writeFileSync(path.join(S, 'files', 'latest.json.sig'), rel.signBytes(feed, privateKey.export({ type: 'pkcs8', format: 'pem' })));
}
function setConfig(c, extra) {
  const f = path.join(c.priv, 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none yet */ }
  fs.writeFileSync(f, JSON.stringify({ ...cfg, ...extra }, null, 2));
}
const appVersion = (c) => { try { return JSON.parse(fs.readFileSync(path.join(c.ws, 'app', 'package.json'), 'utf8')).version; } catch { return null; } };
const MINE = '// ==WebMod==\n// @name Keep\n// @match https://mine.test/*\n// ==/WebMod==\n';

async function uninstallChecks(c, { all }) {
  const keys = Object.values(BROWSER_KEYS).map((k) => hostKey(c, k));
  const u = await runCmd(path.join(c.bin, 'trif.cmd'), ['uninstall', ...(all ? ['--all', '--yes'] : []), '--verbose'], c.env, { timeout: 120000 });
  check(u.code === 0, `trif uninstall${all ? ' --all --yes' : ''} exits 0`, u.out);
  check(!/batch file cannot be found/i.test(u.out), "cmd.exe doesn't lose trif.cmd under it (\"The batch file cannot be found.\")", u.out);
  const t = t0();
  const gone = await waitFor(() => (all ? !exists(c.ws) : !exists(c.bin) && !exists(path.join(c.ws, 'runtime'))), 60000);
  check(gone, `${all ? 'the workspace' : 'bin and runtime'} removed once the command ended`, fs.existsSync(c.ws) ? fs.readdirSync(c.ws).join(', ') : '');
  if (gone) info(`removed ${msSince(t)} ms after the command ended`);
  check(!exists(path.join(c.ws, 'app')), 'the app folder removed');
  for (const k of keys) check(!regDefault(k, c.env), `${k} removed`);
  for (const b of ['chrome', 'edge']) check(!exists(path.join(c.priv, 'NativeMessagingHosts', b, 'com.webmods.helper.json')), `${b}'s manifest removed`);
  if (all) check(!exists(c.priv), 'the private folder removed');
  else {
    check(exists(path.join(c.ws, 'sites', 'mine.test', 'keep.js')), 'the mods kept');
    check(exists(path.join(c.priv, 'config.json')), 'the settings kept');
  }
  if (!SAFE) {
    const up = powershell("[Console]::Out.Write([string][Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment').GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames))", c.env).out;
    check(!up.toLowerCase().includes(c.bin.toLowerCase()), "~\\.trif\\bin taken off the user's Path", up);
  }
}

// A program on TRIF's own node.exe inside a run's fence (lib/win/fence.js: an AppContainer that may read
// that one file). CI only: it makes an AppContainer profile.
function fenceCheck(c) {
  const app = path.join(c.ws, 'app');
  const box = path.join(c.profile, 'fence-box');
  const work = path.join(c.profile, 'fence-work');
  for (const d of [box, path.join(box, 'tmp'), path.join(work, 'sites')]) fs.mkdirSync(d, { recursive: true });
  const probe = `
    const path = require('path'); const fs = require('fs'); const { spawnSync } = require('child_process');
    const fence = require(${JSON.stringify(path.join(app, 'helper', 'lib', 'win', 'fence.js'))});
    const P = require(${JSON.stringify(path.join(app, 'helper', 'lib', 'paths.js'))});
    const l = fence.launcher(P.workspace(${JSON.stringify(c.ws)}));
    if (l.error) { console.log('NO-LAUNCHER ' + l.error); process.exit(0); }
    const spec = fence.specFor({ runId: 'cm' + process.pid, limits: { workspace: ${JSON.stringify(work)}, modsDir: ${JSON.stringify(path.join(work, 'sites'))}, box: ${JSON.stringify(box)}, lockedDirs: [] }, code: [${JSON.stringify(app)}], node: process.execPath });
    const file = path.join(${JSON.stringify(box)}, 'spec.json');
    fs.writeFileSync(file, JSON.stringify(spec));
    const prep = fence.prepare(l, file);
    if (prep) { console.log('PREPARE ' + prep); process.exit(0); }
    const [exe, args] = fence.execCommand(l, file, [process.execPath, '-e', 'process.stdout.write("IN-FENCE " + process.version + " " + process.execPath)']);
    const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    console.log('RESULT ' + r.status + ' ' + (r.stdout || '') + ' ' + (r.stderr || '').slice(0, 400));
    fence.cleanup(l, file);`;
  const rt = R.installedNode(c.ws);
  const r = spawnSync(rt, ['-e', probe], { env: c.env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  check(new RegExp(`RESULT 0 IN-FENCE v${R.PINS.version.replace(/\./g, '\\.')} `).test(out), "inside a run's fence (an AppContainer), TRIF's own node.exe runs", out);
}

(async () => {
  if (!KEY) { check(false, `a runtime for win32-${process.arch} in helper/runtime.json`); process.exit(1); }
  info(`mode: ${SAFE ? 'safe (nothing outside the scratch folder)' : 'CI (the runner\'s real HKCU keys, Path and Credential Manager)'}; ${KEY}; this script on ${process.version}`);
  const S = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-cm-')));
  fs.mkdirSync(path.join(S, 'files'));
  const node = await nodeArchive();
  fs.copyFileSync(node.file, path.join(S, 'files', node.pin.file));
  const srv = await serve(path.join(S, 'files'));
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const k = crypto.generateKeyPairSync('ed25519');
  const pub = k.publicKey.export({ type: 'spki', format: 'pem' });
  try {
    // ------------------------------------------------------------------ A. install.ps1 on a computer with no Node
    {
      console.log('\n>>> A. install.ps1, then trif, the helper, an update and uninstall --all, with no Node on PATH');
      const OLD = '0.1.0';
      const oldTgz = pack(S, OLD, pub);
      const newTgz = pack(S, pkgVersion, null);
      const c = computer(S, 'Zo\u00eb \u7528\u6237 100%');
      const where = spawnSync(sys32('where.exe'), ['node'], { env: c.env, encoding: 'utf8' });
      check(where.status !== 0, 'no node on the PATH TRIF gets', where.stdout);
      const script = rel.installScriptWindows(fs.readFileSync(path.join(REPO, 'scripts', 'install.ps1'), 'utf8'), {
        version: OLD, packageUrl: `https://example.test/${path.basename(oldTgz)}`, packageSha256: sha(oldTgz), pins: R.PINS,
      }).replace(/^ {2}\$PackageUrl = .*$/m, `  $PackageUrl = '${srv.base}${path.basename(oldTgz)}'`)
        .replace(/^ {2}\$NodeBase = .*$/m, `  $NodeBase = '${srv.base}'`);
      fs.writeFileSync(path.join(S, 'files', 'install.ps1'), script);
      const setupArgs = ['--browser', 'chrome,edge', '--no-examples', ...(SAFE ? ['--no-link'] : [])];
      const r = powershell(`& ([scriptblock]::Create((irm ${srv.base}install.ps1))) ${setupArgs.join(' ')}`, c.env);
      info(`install.ps1 (local server, the real .zip): ${r.ms} ms`);
      check(r.code === 0 && !/TRIF install:/.test(r.out), 'install.ps1 runs to the end', r.out);
      const rt = R.installedNode(c.ws);
      check(rt && rt.toLowerCase() === path.join(c.ws, 'runtime', `node-v${R.PINS.version}-${KEY}`, 'node.exe').toLowerCase(), `TRIF's own node.exe in ~\\.trif\\runtime\\node-v${R.PINS.version}-${KEY}`, `${rt}\n${r.out}`);
      if (rt) check(JSON.stringify(fs.readdirSync(path.dirname(rt)).sort()) === JSON.stringify(['.trif-runtime.json', 'LICENSE', 'node.exe']), 'only node.exe and its licence kept (and the record)', fs.readdirSync(path.dirname(rt)).join(', '));
      check(!fs.readdirSync(c.env.TEMP).some((n) => n.startsWith('trif-install-')), "install.ps1's temporary folder is gone", fs.readdirSync(c.env.TEMP).join(', '));
      check(appVersion(c) === OLD, `the app installed (${OLD})`, appVersion(c));
      for (const w of ['trif-host.bat', 'trif.cmd']) {
        const n = wrapperNode(c, w);
        check(rt && n && n.toLowerCase() === rt.toLowerCase(), `${w} names TRIF's own node.exe`, n);
        check(/%~dp0\.\.\\runtime\\node-v/.test(fs.readFileSync(path.join(c.bin, w), 'utf8')), `${w} names it from its own folder (ASCII, whatever the profile is called)`);
      }
      for (const [b, sub] of Object.entries(BROWSER_KEYS)) {
        const manifest = path.join(c.priv, 'NativeMessagingHosts', b, 'com.webmods.helper.json');
        const v = regDefault(hostKey(c, sub), c.env);
        check(v && v.toLowerCase() === manifest.toLowerCase(), `${b}: ${hostKey(c, sub)} names its manifest`, v);
      }
      if (rt) info(`on disk: runtime ${mb(du(path.join(c.ws, 'runtime')))}, app ${mb(du(path.join(c.ws, 'app')))}; package ${mb(fs.statSync(oldTgz).size)}`);

      const times = [];
      for (let i = 0; i < 3; i++) { const h = await runCmd(path.join(c.bin, 'trif.cmd'), ['help'], c.env); times.push(h.ms); if (i === 0) check(h.code === 0, 'trif.cmd help', h.out); }
      info(`trif.cmd help on TRIF's own Node: ${times.join(', ')} ms`);
      doctorChecks(await runCmd(path.join(c.bin, 'trif.cmd'), ['doctor'], c.env), 'A');
      const h = await helperChecks(c, 'A', OLD);
      check((await h.stop()) !== 'timeout', 'A: the helper ends when its browser closes its end');
      if (!SAFE) fenceCheck(c);

      // The update, from a signed local feed: kept mods and settings, still on its own Node.
      fs.mkdirSync(path.join(c.ws, 'sites', 'mine.test'), { recursive: true });
      fs.writeFileSync(path.join(c.ws, 'sites', 'mine.test', 'keep.js'), MINE);
      setConfig(c, { updateFeed: `${srv.base}latest.json`, keepMe: 'yes' });
      feedFor(S, srv, pkgVersion, newTgz, k.privateKey);
      const u = await runCmd(path.join(c.bin, 'trif.cmd'), ['update', '--install'], c.env, { timeout: 700000 });
      info(`trif update --install (local server): ${u.ms} ms`);
      check(u.code === 0 && u.out.includes(`${OLD} -> ${pkgVersion}`), `trif update --install: ${OLD} -> ${pkgVersion}`, u.out);
      check(appVersion(c) === pkgVersion, `the app is ${pkgVersion} now`, appVersion(c));
      check(R.installedNode(c.ws) === rt, 'the same runtime, not fetched again');
      check((wrapperNode(c, 'trif.cmd') || '').toLowerCase() === String(rt).toLowerCase(), 'trif.cmd still names it');
      check(exists(path.join(c.ws, 'sites', 'mine.test', 'keep.js')), 'the mod kept');
      check(JSON.parse(fs.readFileSync(path.join(c.priv, 'config.json'), 'utf8')).keepMe === 'yes', 'the setting kept');
      check((await runCmd(path.join(c.bin, 'trif.cmd'), ['help'], c.env)).code === 0, 'trif.cmd help after the update');

      await uninstallChecks(c, { all: true });
    }

    // ------------------------------------------------------------------ B. the upgrade from a Node-based install
    {
      const from = opt('--from-dir');
      const ref = process.env.TRIF_UPGRADE_FROM || '014da14';
      let src = from ? path.resolve(from) : null;
      if (!src) {
        src = path.join(S, 'from');
        fs.mkdirSync(src);
        const arch = path.join(S, 'from.tar');
        const g = spawnSync('git', ['-C', REPO, 'archive', '-o', arch, ref], { encoding: 'utf8' });
        if (g.status !== 0) { info(`B skipped: no git ref ${ref} here (${(g.stderr || '').trim()})`); src = null; } else execFileSync(TAR, ['-xf', arch, '-C', src]);
      }
      if (src) {
        console.log(`\n>>> B. a Node-based install (${from ? src : ref}) updates to this build and ends on TRIF's own Node`);
        const OLD = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
        const NEW = OLD.replace(/\d+$/, (n) => String(Number(n) + 1));
        check(compareVersions(NEW, OLD) > 0, `${NEW} is newer than ${OLD}`);
        const oldTgz = pack(S, OLD, pub, src);
        const newTgz = pack(S, NEW, null);
        const c = computer(S, 'B profile');
        // The computer as it is before this: its own Node on PATH (a folder holding node.exe alone).
        const sysBin = path.join(S, 'sysnode');
        fs.mkdirSync(sysBin);
        fs.copyFileSync(process.execPath, path.join(sysBin, 'node.exe'));
        const withNode = { ...c.env, PATH: `${sysBin};${NO_NODE_PATH}` };
        const pkgDir = path.join(S, 'npx');
        fs.mkdirSync(pkgDir);
        execFileSync(TAR, ['-xzf', oldTgz, '-C', pkgDir]);
        const s = spawnSync(path.join(sysBin, 'node.exe'), [path.join(pkgDir, 'package', 'helper', 'cli.js'), 'setup', '--copy', '--browser', 'chrome,edge', '--no-examples', ...(SAFE ? ['--no-link'] : [])], { env: withNode, encoding: 'utf8', timeout: 300000, windowsHide: true });
        check(s.status === 0, `${OLD} set up on the computer's Node`, `${s.stdout}${s.stderr}`);
        check(!R.installedNode(c.ws), 'no runtime yet');
        check((wrapperNode(c, 'trif.cmd') || '').toLowerCase() === path.join(sysBin, 'node.exe').toLowerCase(), "trif.cmd names the computer's Node", wrapperNode(c, 'trif.cmd'));
        fs.mkdirSync(path.join(c.ws, 'sites', 'mine.test'), { recursive: true });
        fs.writeFileSync(path.join(c.ws, 'sites', 'mine.test', 'keep.js'), MINE);
        setConfig(c, { updateFeed: `${srv.base}latest.json`, keepMe: 'yes' });
        const phone = path.join(c.priv, 'phone-link.json');
        fs.writeFileSync(phone, JSON.stringify({ on: false, phones: [{ id: 'p1', name: "Tim's phone", key: 'AAAA' }] }));
        const phoneBefore = fs.readFileSync(phone, 'utf8');

        // (the real pins, served from here: the old updater gives its environment to the new setup)
        const pinsFile = path.join(S, 'pins.json');
        fs.writeFileSync(pinsFile, JSON.stringify({ ...R.PINS, base: srv.base, archives: { [KEY]: [node.pin] } }));
        feedFor(S, srv, NEW, newTgz, k.privateKey);
        const u = await runCmd(path.join(c.bin, 'trif.cmd'), ['update', '--install'], { ...withNode, TRIF_RUNTIME: pinsFile }, { timeout: 700000 });
        info(`upgrade (the old updater; the runtime fetched from a local server): ${u.ms} ms`);
        check(u.code === 0 && u.out.includes(`${OLD} -> ${NEW}`), `the ${OLD} updater installs ${NEW}`, u.out);
        const rt = R.installedNode(c.ws);
        check(!!rt, "the new setup fetched TRIF's own Node", u.out);
        for (const w of ['trif-host.bat', 'trif.cmd']) check(rt && (wrapperNode(c, w) || '').toLowerCase() === rt.toLowerCase(), `${w} names TRIF's own node.exe now`, wrapperNode(c, w));
        check(exists(path.join(c.ws, 'sites', 'mine.test', 'keep.js')), 'the mod kept');
        check(JSON.parse(fs.readFileSync(path.join(c.priv, 'config.json'), 'utf8')).keepMe === 'yes', 'the setting kept');
        check(fs.readFileSync(phone, 'utf8') === phoneBefore, 'the phone link file kept byte for byte');
        for (const [b, sub] of Object.entries(BROWSER_KEYS)) check(!!regDefault(hostKey(c, sub), c.env), `${b}'s registry key still there`);

        // The computer's Node goes away.
        fs.rmSync(sysBin, { recursive: true, force: true });
        check(!exists(sysBin), "the computer's Node removed");
        doctorChecks(await runCmd(path.join(c.bin, 'trif.cmd'), ['doctor'], c.env), 'B');
        const h = await helperChecks(c, 'B', NEW);
        check((await h.stop()) !== 'timeout', 'B: the helper ends when its browser closes its end');
        await uninstallChecks(c, { all: false });
      }
    }
  } finally {
    srv.stop();
    for (const root of REG_ROOTS) spawnSync(sys32('reg.exe'), ['delete', root, '/f'], { windowsHide: true });
    if (!KEEP) { await sleep(2000); try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) { info(`left ${S}: ${e.message}`); } }
  }
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
