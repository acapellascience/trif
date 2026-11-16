#!/usr/bin/env node
'use strict';
// The Windows browser check: a real browser on a real Windows computer loads the real extension, and the
// extension reaches the helper the way it does for a user. Run by .github/workflows/windows.yml on a
// throwaway windows-latest runner, after tests/windows-smoke.js (which starts the helper itself, standing
// in for the browser). Here nothing stands in for anything:
//
//   1. a scratch user profile; `node helper/cli.js setup --copy --no-link --browser chrome,chromium`
//      (the manifests, and the real HKCU keys naming them: that's where a browser looks on Windows)
//   2. Chrome for Testing (TRIF_E2E_CHROME; branded Chrome ignores --load-extension) starts headless with
//      a throwaway profile and the unpacked extension setup copied to ~\.trif\app\extension
//   3. the extension's service worker starts, calls connectNative, and Chrome finds the manifest through
//      the registry and runs trif-host.bat through cmd.exe: the helper names its pipe in helper.pipe
//   4. `trif.cmd status --json` over that pipe: the helper says which extension said hello (its version,
//      the browser), and a page command goes to the extension and back; `trif doctor` agrees
//   5. the browser quits: the helper exits and removes helper.pipe
//
// It writes to the real HKEY_CURRENT_USER, so it refuses to run anywhere but GitHub Actions on Windows,
// unless given --yes-this-computer. Options: --headful (a window, not headless), --unicode (the scratch
// profile folder has a space, letters outside ASCII and a % in its name), --browser edge|brave with --bin
// <its program> (another Chromium browser, set up as `trif setup --browser <it>` does: its own registry
// key). Prints PASS/FAIL per check; exits 1 if anything failed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
const HOST = 'NativeMessagingHosts\\com.webmods.helper';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const BROWSER = arg('--browser') || 'chrome';
// What setup is asked for, the keys it then leaves (removed at the end), and doctor's line for the browser.
const KINDS = {
  chrome: { setup: 'chrome,chromium', keys: [`HKCU\\Software\\Google\\Chrome\\${HOST}`, `HKCU\\Software\\Chromium\\${HOST}`], doctor: /^ok {4}Google Chrome: native host manifest$/m, says: /Chrom/i },
  edge: { setup: 'edge', keys: [`HKCU\\Software\\Microsoft\\Edge\\${HOST}`], doctor: /^ok {4}Microsoft Edge: native host manifest$/m, says: /Edge/i },
  brave: { setup: 'brave', keys: [`HKCU\\Software\\BraveSoftware\\Brave-Browser\\${HOST}`, `HKCU\\Software\\Google\\Chrome\\${HOST}`], doctor: /^ok {4}Brave: native host manifest$/m, says: /Brave/i },
};
const KIND = KINDS[BROWSER];
if (!KIND) { console.error(`windows-browser: --browser ${Object.keys(KINDS).join('|')}`); process.exit(2); }
const HOST_KEYS = KIND.keys;

if (process.platform !== 'win32') { console.error('windows-browser: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--yes-this-computer')) {
  console.error('windows-browser: this writes to the real HKCU registry (the browsers\' native messaging keys).\nIt runs on GitHub Actions; elsewhere pass --yes-this-computer.');
  process.exit(2);
}
const HEADFUL = process.argv.includes('--headful');
const UNICODE = process.argv.includes('--unicode');

let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!ok) failed++;
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000, every = 200) {
  const end = Date.now() + ms;
  for (;;) { let v = null; try { v = await fn(); } catch { /* not yet */ } if (v) return v; if (Date.now() > end) return null; await sleep(every); }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const reg = (args) => spawnSync(path.join(process.env.SystemRoot, 'System32', 'reg.exe'), args, { encoding: 'utf8' });
// A .cmd the way Command Prompt runs it: cmd.exe /d /s /c ""file" args".
function runCmd(file, args, env, timeout = 60000) {
  return new Promise((resolve) => {
    const c = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`], { env, windowsVerbatimArguments: true });
    let stdout = '';
    let stderr = '';
    c.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    c.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const t = setTimeout(() => c.kill(), timeout);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}
const tail = (file, n = 40) => { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n'); } catch (e) { return `(${e.code || e.message})`; } };

// The DevTools protocol over its WebSocket (Node 22's own WebSocket): send(method, params, sessionId).
class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.waiting = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => { this.ws = ws; resolve(this); };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const w = m.id !== undefined && this.waiting.get(m.id);
        if (!w) return;
        this.waiting.delete(m.id);
        if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result);
      };
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.waiting.set(id, { resolve, reject, method });
      setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${method}: timed out`)); }, 30000);
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

(async () => {
  const chromeBin = arg('--bin') || process.env.TRIF_E2E_CHROME;
  if (!check(!!chromeBin && fs.existsSync(chromeBin), `the browser (${BROWSER}): ${chromeBin || 'TRIF_E2E_CHROME not set'}`)) process.exit(1);
  // (before anything is set up: none of the keys this run will leave is there from something else)
  for (const key of HOST_KEYS) reg(['delete', key, '/f']);

  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-browser-')));
  const profile = path.join(base, UNICODE ? 'Zoë 用户 100%' : 'Test User');
  fs.mkdirSync(profile);
  const env = { ...process.env, USERPROFILE: profile, LOCALAPPDATA: path.join(profile, 'AppData', 'Local'), APPDATA: path.join(profile, 'AppData', 'Roaming'), TRIF_UPDATE_DELAY: '2000000000' };
  for (const k of Object.keys(env)) if (/^(TRIF_HOME|WEBMODS_HOME|HOME)$/i.test(k)) delete env[k];
  for (const d of [env.LOCALAPPDATA, env.APPDATA]) fs.mkdirSync(d, { recursive: true });
  const home = path.join(profile, '.trif');
  const privateDir = path.join(env.LOCALAPPDATA, 'TRIF');
  const version = require(path.join(REPO, 'package.json')).version;
  console.log(`profile ${profile}${HEADFUL ? ' (headful)' : ''}`);

  // 1. setup, as a user runs it (PATH left alone: --no-link)
  const s = spawnSync(process.execPath, [path.join(REPO, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--browser', KIND.setup], { env, encoding: 'utf8', timeout: 300000 });
  if (!check(s.status === 0, `setup --copy --no-link --browser ${KIND.setup} exits 0`, `${s.stdout}\n${s.stderr}`)) process.exit(1);
  const extensionDir = path.join(home, 'app', 'extension');
  const cmd = path.join(home, 'bin', 'trif.cmd');
  check(fs.existsSync(path.join(extensionDir, 'manifest.json')), `the extension folder setup names: ${extensionDir}`);
  check(!fs.existsSync(path.join(home, 'helper.pipe')), 'no helper yet');
  // --drop-key N: one of the keys setup wrote is taken away again, to see which one the browser reads.
  if (arg('--drop-key') !== null) {
    const dropped = HOST_KEYS[Number(arg('--drop-key'))];
    reg(['delete', dropped, '/f']);
    console.log(`      (removed ${dropped}; left: ${HOST_KEYS.filter((k) => k !== dropped && reg(['query', k, '/ve']).status === 0).join(', ') || 'none'})`);
  }

  // 2. the browser, with the unpacked extension
  const userDataDir = path.join(base, 'chrome-profile');
  const port = await freePort();
  const args = [
    ...(HEADFUL ? [] : ['--headless=new']), '--mute-audio',
    `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, `--load-extension=${extensionDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update', '--disable-background-networking',
    '--window-size=1280,900', 'about:blank',
  ];
  const chromeLog = path.join(base, 'chrome.log');
  const logFd = fs.openSync(chromeLog, 'w');
  const chrome = spawn(chromeBin, args, { env, stdio: ['ignore', logFd, logFd] });
  const chromeExited = new Promise((r) => chrome.on('exit', (code) => r(code)));
  let cdp = null;
  try {
    const ver = await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/version`); return r.ok ? r.json() : null; }, 45000);
    if (!check(!!ver, 'Chrome started (its DevTools endpoint answers)', tail(chromeLog))) throw new Error('no browser');
    console.log(`      ${ver.Browser}`);
    cdp = await new Cdp(ver.webSocketDebuggerUrl).connect();

    // 3. the extension's service worker, and through it the helper
    const worker = await waitFor(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${EXTENSION_ID}/`));
    }, 30000);
    check(!!worker, `the extension loaded: its service worker runs (${worker ? worker.url : 'none'})`, tail(chromeLog));
    const pipe = await waitFor(() => { try { return fs.readFileSync(path.join(home, 'helper.pipe'), 'utf8').trim(); } catch { return null; } }, 30000);
    const startedByBrowser = check(!!pipe && /^\\\\\.\\pipe\\trif-[0-9a-f]{32}$/.test(pipe), 'the browser started the helper (registry key -> manifest -> trif-host.bat): helper.pipe names its pipe',
      `helper.pipe: ${pipe}\n--- chrome.log\n${tail(chromeLog)}\n--- helper.log\n${tail(path.join(privateDir, 'helper.log'))}`);
    if (worker && !startedByBrowser) {
      // What the extension itself says went wrong (its service worker's console has it too).
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
        const r = await cdp.send('Runtime.evaluate', { expression: 'new Promise((res) => { const p = chrome.runtime.connectNative("com.webmods.helper"); p.onDisconnect.addListener(() => res("disconnected: " + (chrome.runtime.lastError && chrome.runtime.lastError.message))); p.onMessage.addListener((m) => res("message: " + JSON.stringify(m).slice(0, 200))); setTimeout(() => res("nothing within 8 s"), 8000); })', awaitPromise: true, returnByValue: true }, sessionId);
        console.log(`      connectNative from the service worker: ${r.result && r.result.value}`);
      } catch (e) { console.log(`      (couldn't ask the service worker: ${e.message})`); }
    }

    // 4. the CLI, over the pipe, to the helper and on to the extension
    const st = await waitFor(async () => {
      const r = await runCmd(cmd, ['status', '--json'], env);
      let j = null;
      try { j = JSON.parse(r.stdout); } catch { /* below */ }
      return j && j.helper && j.helper.extension ? { r, j } : null;
    }, 30000, 1000);
    if (check(!!st, 'trif.cmd status: the helper has the extension\'s hello', (await runCmd(cmd, ['status', '--json'], env)).stdout)) {
      const x = st.j.helper.extension;
      console.log(`      hello: ${JSON.stringify(x)}`);
      check(x.version === version, `the extension that said hello is this one (${x.version})`, `expected ${version}`);
      check(KIND.says.test(String(x.browser || '')), `it says which browser it's in (${x.browser})`);
      check(st.j.extension && !st.j.error, 'a page command goes helper -> extension -> helper (status asks the extension for its tabs)', JSON.stringify(st.j).slice(0, 600));
    }
    const doc = await runCmd(cmd, ['doctor'], env);
    console.log(doc.stdout);
    for (const want of [/^ok {4}host wrapper .*trif-host\.bat/m, KIND.doctor, /^ok {4}helper running/m, /^ok {4}extension v\S+ on /m]) {
      check(want.test(doc.stdout), `trif doctor: ${want}`);
    }
    const hlog = tail(path.join(privateDir, 'helper.log'), 200);
    check(/host \S+ starting/.test(hlog) && !/\bERROR\b/.test(hlog), 'the helper\'s log: started, no errors', hlog);
  } catch (e) {
    check(false, 'the browser check ran to its end', e.stack || e.message);
  } finally {
    // 5. the browser quits
    try { if (cdp) await cdp.send('Browser.close').catch(() => {}); } catch { /* gone */ }
    if (cdp) cdp.close();
    const code = await Promise.race([chromeExited, sleep(15000).then(() => 'timeout')]);
    if (code === 'timeout') { try { spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(chrome.pid), '/T', '/F']); } catch { /* gone */ } }
    const gone = await waitFor(() => !fs.existsSync(path.join(home, 'helper.pipe')), 15000);
    check(!!gone, 'the browser quit: the helper exited and removed helper.pipe');
    for (const key of HOST_KEYS) reg(['delete', key, '/f']);
  }
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
