'use strict';
// One headless Chrome for Testing for one measurement run: its own throwaway profile, started under
// tests/perf/memguard.sh (which kills it, and only it, if it grows past 1.5 GB a process or 4 GB in all) and
// `nice`, always --headless=new --mute-audio (the game and Rainbow Rave play music). Driven over CDP.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { sleep, freePort, run } = require('../../e2e/lib/util');
const { findChrome } = require('../../e2e/lib/chrome');

class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.waiting = new Map(); this.listeners = new Set(); }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => { this.ws = ws; resolve(this); };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onclose = () => { for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error('connection closed')); } this.waiting.clear(); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== undefined && this.waiting.has(m.id)) {
          const w = this.waiting.get(m.id);
          this.waiting.delete(m.id); clearTimeout(w.timer);
          if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result);
        } else if (m.method) for (const fn of this.listeners) { try { fn(m); } catch { /* ignore */ } }
      };
    });
  }
  send(method, params = {}, sessionId, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method}: timed out`)); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/** Chrome for Testing processes that aren't ours (another agent's test browser): their pids. */
function foreignChromes(ownMarker) {
  const r = run('/bin/ps', ['-axo', 'pid=,command=']);
  // (the program itself, by its path: not a shell or editor whose command line just mentions the name)
  const isChrome = (cmd) => /^\/\S.*\/Google Chrome for Testing(?: Helper[^/]*)?\.app\/Contents\/MacOS\//.test(cmd);
  return r.stdout.split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .filter(([, , cmd]) => isChrome(cmd) && !(ownMarker && cmd.includes(ownMarker)))
    .map(([, pid]) => Number(pid));
}
/** Waits (up to `maxMs`) until no other test browser is running, so runs never overlap with one. */
async function waitForQuiet(log, maxMs = 30 * 60 * 1000) {
  const end = Date.now() + maxMs;
  let said = false;
  for (;;) {
    const others = foreignChromes(null);
    if (!others.length) return;
    if (Date.now() > end) throw new Error(`another test browser has been running for ${maxMs / 60000} min (pids ${others.slice(0, 5).join(' ')})`);
    if (!said) { log(`  (waiting: another Chrome for Testing is running, pids ${others.slice(0, 5).join(' ')})`); said = true; }
    await sleep(5000);
  }
}

// (if this process is stopped mid-run, its browser goes with it: matched by its own profile folder)
const live = new Set();
const cleanUp = () => { for (const prof of live) { try { require('child_process').spawnSync('/usr/bin/pkill', ['-9', '-f', prof]); } catch { /* gone */ } } };
process.on('exit', cleanUp);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanUp(); process.exit(130); });

class Browser {
  /** opts: {width, height, dpr, workDir, extraArgs} */
  constructor(opts) { this.opts = opts; }
  async start() {
    // (a worktree has no tests/e2e/.browsers of its own: the main checkout's, next to it, is used then)
    const MAIN = path.join(os.homedir(), 'WebMods', 'tests', 'e2e', '.browsers', 'chrome', 'mac_arm-156.0.8078.80', 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    const bin = process.env.TRIF_E2E_CHROME || findChrome() || (fs.existsSync(MAIN) ? MAIN : null);
    if (!bin) throw new Error('Chrome for Testing not found (tests/e2e/.browsers: see tests/e2e/README)');
    this.port = await freePort();
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xflyer-perf-profile-'));
    live.add(this.profile);
    const { width, height, dpr } = this.opts;
    const args = [
      '--headless=new', '--mute-audio',
      `--user-data-dir=${this.profile}`, `--remote-debugging-port=${this.port}`,
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update', '--disable-extensions',
      '--disable-background-networking', '--password-store=basic', '--use-mock-keychain',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--host-resolver-rules=MAP x.com 127.0.0.1, MAP *.x.com 127.0.0.1, MAP * ~NOTFOUND',
      '--ignore-certificate-errors',
      `--window-size=${width},${height}`, `--force-device-scale-factor=${dpr}`, '--screen-info={0,0 2560x1440}',
      ...(this.opts.extraArgs || []),
      'about:blank',
    ];
    const guard = path.join(__dirname, '..', 'memguard.sh');
    const logFile = path.join(this.opts.workDir, 'chrome.log');
    const out = fs.openSync(logFile, 'w');
    this.proc = spawn('/bin/bash', [guard, '/usr/bin/nice', '-n', '10', bin, ...args], { stdio: ['ignore', out, out] });
    fs.closeSync(out); // (the browser has its own copy)
    this.exited = new Promise((r) => this.proc.on('exit', r));
    let ver;
    for (let i = 0; i < 100 && !ver; i++) {
      await sleep(150);
      try { ver = await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json(); } catch { /* not yet */ }
    }
    if (!ver) throw new Error(`Chrome didn't start (see ${logFile})`);
    this.version = ver.Browser;
    this.cdp = await new Cdp(ver.webSocketDebuggerUrl).connect();
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    this.sid = sessionId;
    // (headless keeps some of the window for its frame: the window grown until the page itself is width × height)
    const { windowId } = await this.browserSend('Browser.getWindowForTarget', { targetId: page.targetId });
    for (let i = 0; i < 3; i++) {
      const [iw, ih] = await this.eval('[innerWidth, innerHeight]');
      if (iw === width && ih === height) break;
      const { bounds } = await this.browserSend('Browser.getWindowBounds', { windowId });
      await this.browserSend('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + width - iw, height: bounds.height + height - ih } });
      await sleep(200);
    }
    return this;
  }
  send(method, params, timeoutMs) { return this.cdp.send(method, params, this.sid, timeoutMs); }
  browserSend(method, params, timeoutMs) { return this.cdp.send(method, params, undefined, timeoutMs); }
  async eval(expr, { timeoutMs = 60000, awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async close() {
    try { await this.browserSend('Browser.close', {}, 5000); } catch { /* closing anyway */ }
    this.cdp?.close();
    await Promise.race([this.exited, sleep(5000)]);
    try { this.proc.kill('SIGKILL'); } catch { /* gone */ }
    // (and anything of ours still up: matched by our own profile folder only)
    run('/usr/bin/pkill', ['-9', '-f', this.profile]);
    await sleep(300);
    fs.rmSync(this.profile, { recursive: true, force: true });
    live.delete(this.profile);
  }
}

module.exports = { Browser, Cdp, waitForQuiet, foreignChromes };
