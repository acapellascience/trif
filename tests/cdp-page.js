'use strict';
// Headless Chrome for Testing for the unit suite's few real-browser tests (tests/sandbox-browser.test.js,
// tests/css-browser.test.js, mobile/test/smoke.js), driven over the DevTools protocol with the e2e's own
// pieces (tests/e2e/lib/chrome.js findChrome and Cdp): no Playwright, no dependency. It offers what those
// tests use, with the meaning Playwright gave it: goto waits for the load event, addScriptTag is a real
// <script> in the page's own world (so what it throws is a page error), evaluate is awaited and returned
// by value, click is a trusted mouse click at the element's centre, fill types as a paste does.
//
// When. Only with TRIF_BROWSER_TESTS=1 or CI set (browserTestsSkip()): `npm test` runs often on a Mac that
// also runs the e2e and much else, so a browser never starts there unasked. And one at a time: a launch
// waits for any other test browser from here to close (a lock in the temp folder), each runs `nice`, and a
// watchdog closes it if a process of it passes 1.5 GB (or all of them 4 GB). close() always ends the
// process, and so does this process exiting.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile, spawnSync } = require('child_process');
const { Cdp, findChrome } = require('./e2e/lib/chrome');
const { sleep, waitFor, killMatching } = require('./e2e/lib/util');

const LOCK = path.join(os.tmpdir(), 'trif-cdp-page.lock');
const ONE_MB = 1024; // (ps rss is in KB)
const MAX_ONE = 1536 * ONE_MB;
const MAX_ALL = 4096 * ONE_MB;

/** false when the browser tests may run here, or why they're skipped (for node:test's `skip`). */
function browserTestsSkip() {
  const ci = process.env.CI && !/^(0|false)$/i.test(process.env.CI);
  if (process.env.TRIF_BROWSER_TESTS !== '1' && !ci) return 'a real-browser test: set TRIF_BROWSER_TESTS=1 to run it';
  if (!findChrome()) return 'no Chrome for Testing here (TRIF_E2E_CHROME, or tests/e2e/.browsers: docs/TESTING.md)';
  return false;
}

/** The id Chrome gives an unpacked extension in `dir`: from its manifest's key, or else from its path. */
function extensionId(dir) {
  let key = null;
  try { key = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).key; } catch { /* none */ }
  const hash = crypto.createHash('sha256').update(key ? Buffer.from(key, 'base64') : fs.realpathSync(dir)).digest('hex');
  return [...hash.slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function takeLock(timeoutMs = 10 * 60000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0;
      try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch { /* being written, or gone */ }
      // (a lock whose owner is gone is stale; one without a pid file yet is someone's mkdir a moment ago)
      if (pid && !alive(pid)) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; }
      if (Date.now() > end) throw new Error(`another test browser held ${LOCK} for ${timeoutMs / 1000} s`);
      await sleep(500);
    }
  }
}

function dropLock() {
  try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* not ours */ }
}

/**
 * Starts headless Chrome for Testing in a new temporary profile. opts: { extension (a folder to load as an
 * unpacked extension), args (more switches) }. Returns a Browser; close() it in a finally.
 */
async function launch(opts = {}) {
  const bin = findChrome();
  if (!bin) throw new Error('Chrome for Testing not found: set TRIF_E2E_CHROME (docs/TESTING.md)');
  await takeLock();
  const browser = new Browser();
  try {
    await browser._start(bin, opts);
  } catch (e) {
    await browser.close();
    throw e;
  }
  return browser;
}

class Browser {
  async _start(bin, { extension, args = [] }) {
    this.extensionId = extension ? extensionId(extension) : null;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-cdp-page-'));
    const profile = path.join(this.dir, 'profile');
    const argv = [
      '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--disable-sync', '--disable-component-update', '--disable-background-networking',
      '--password-store=basic', '--use-mock-keychain', '--window-size=1280,720',
      ...(extension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'] : []),
      ...args,
      'about:blank',
    ];
    const log = fs.openSync(path.join(this.dir, 'chrome.log'), 'w');
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(TRIF|WEBMODS)_/.test(k)) delete env[k];
    this.proc = spawn('/usr/bin/nice', ['-n', '10', bin, ...argv], { env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    this.proc.on('error', () => {});
    this.exited = new Promise((r) => this.proc.once('exit', r));
    // (whatever happens to this process, its browser goes with it)
    this._onExit = () => this._killNow();
    this._onSignal = (sig) => { this._killNow(); process.kill(process.pid, sig); };
    process.once('exit', this._onExit);
    process.once('SIGINT', this._onSignal);
    process.once('SIGTERM', this._onSignal);
    this._guard = setInterval(() => this._checkMemory(), 2000);
    this._guard.unref();

    const portFile = path.join(profile, 'DevToolsActivePort');
    const [port, wsPath] = await waitFor('Chrome\'s DevToolsActivePort', () => {
      if (this.proc.exitCode !== null) throw new Error(`Chrome exited (${this.proc.exitCode}): ${this.logTail()}`);
      const lines = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').split('\n') : [];
      return lines.length >= 2 && lines[1] ? lines : null;
    }, { timeoutMs: 30000, intervalMs: 100 });
    this.pages = new Map(); // sessionId -> Page
    this.cdp = await new Cdp(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`).connect();
    this.cdp.on((m) => { const p = m.sessionId && this.pages.get(m.sessionId); if (p) p._event(m); });
  }

  logTail() {
    try { return fs.readFileSync(path.join(this.dir, 'chrome.log'), 'utf8').slice(-2000); } catch { return ''; }
  }

  _checkMemory() {
    if (!this.dir) return;
    execFile('/bin/ps', ['-axo', 'rss=,command='], { maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      if (err || this.closed) return;
      let max = 0, sum = 0;
      for (const line of out.split('\n')) {
        if (!line.includes(this.dir)) continue;
        const rss = parseInt(line, 10) || 0;
        max = Math.max(max, rss); sum += rss;
      }
      if (max > MAX_ONE || sum > MAX_ALL) {
        this.guardTripped = `the test browser used ${Math.round(max / ONE_MB)} MB in one process (${Math.round(sum / ONE_MB)} MB in all): closed by the memory guard`;
        console.error(this.guardTripped);
        this._killNow();
      }
    });
  }

  _killNow() {
    if (this.proc && this.proc.exitCode === null) { try { this.proc.kill('SIGKILL'); } catch { /* gone */ } }
    if (this.dir) spawnSync('/usr/bin/pkill', ['-KILL', '-f', this.dir]);
    dropLock();
  }

  async _attach(targetId) {
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    return sessionId;
  }

  /** A new tab, its page ready to drive. */
  async newPage() {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = await this._attach(targetId);
    const page = new Page(this, targetId, sessionId);
    this.pages.set(sessionId, page);
    await page._init();
    return page;
  }

  /** The service worker of the extension loaded at launch (waits for it to start). Chrome's own built-in
   *  extensions have workers too, so it's told by the extension's id. */
  async serviceWorker({ timeoutMs = 20000 } = {}) {
    if (!this.extensionId) throw new Error('no extension was loaded at launch');
    const origin = `chrome-extension://${this.extensionId}/`;
    const t = await waitFor(`the service worker of ${origin}`, async () => {
      const { targetInfos } = await this.cdp.send('Target.getTargets');
      return targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(origin));
    }, { timeoutMs });
    const worker = new Worker(this, t.url, await this._attach(t.targetId));
    // (the target shows up as the worker starts, before its script has run: past 'parsed', it has)
    await waitFor('the extension\'s service worker to run its script', async () => (await worker.evaluate(() => self.serviceWorker && self.serviceWorker.state)) !== 'parsed', { timeoutMs, intervalMs: 50 });
    return worker;
  }

  /** Ends the browser, every process of it, and its profile; safe to call twice, and after a failed start. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._guard);
    if (this.cdp) {
      try { await this.cdp.send('Browser.close', {}, undefined, 5000); } catch { /* ending it anyway */ }
      this.cdp.close();
    }
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM');
      await Promise.race([this.exited, sleep(5000)]);
    }
    if (this.dir) {
      await killMatching(this.dir);
      fs.rmSync(this.dir, { recursive: true, force: true });
    }
    dropLock();
    process.removeListener('exit', this._onExit);
    process.removeListener('SIGINT', this._onSignal);
    process.removeListener('SIGTERM', this._onSignal);
    if (this.guardTripped) throw new Error(this.guardTripped);
  }
}

// The text to evaluate for `fn` (a function, called with `arg`, or an expression as text), as Playwright's.
function expressionFor(fn, arg) {
  if (typeof fn !== 'function') return String(fn);
  return `(${fn.toString()})(${arg === undefined ? 'undefined' : JSON.stringify(arg)})`;
}

async function evaluateIn(browser, sessionId, fn, arg, timeoutMs = 60000) {
  const r = await browser.cdp.send('Runtime.evaluate', { expression: expressionFor(fn, arg), awaitPromise: true, returnByValue: true, userGesture: true }, sessionId, timeoutMs);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`in the page: ${(d.exception && d.exception.description) || d.text}`);
  }
  return r.result.value;
}

class Worker {
  constructor(browser, url, sessionId) { this.browser = browser; this._url = url; this.sessionId = sessionId; }
  url() { return this._url; }
  /** Runs `fn(arg)` (or the expression) in the worker; awaited, the result by value. */
  evaluate(fn, arg) { return evaluateIn(this.browser, this.sessionId, fn, arg); }
}

class Page {
  constructor(browser, targetId, sessionId) {
    this.browser = browser;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.handlers = { pageerror: [] };
    this.loaded = new Set(); // loader ids whose main-frame load event fired
    this.loads = 0;
  }

  send(method, params, timeoutMs) { return this.browser.cdp.send(method, params, this.sessionId, timeoutMs); }

  async _init() {
    await this.send('Page.enable');
    await this.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await this.send('Runtime.enable');
    this.frameId = (await this.send('Page.getFrameTree')).frameTree.frame.id;
  }

  _event(m) {
    const p = m.params || {};
    if (m.method === 'Page.lifecycleEvent' && p.name === 'load' && p.frameId === this.frameId) {
      this.loaded.add(p.loaderId);
      this.loads++;
    } else if (m.method === 'Runtime.exceptionThrown') {
      // (as Playwright's pageerror: an Error with the thrown error's message, for uncaught errors and rejections)
      const d = p.exceptionDetails || {};
      const ex = d.exception || {};
      let message = ex.description || d.text || '';
      if (ex.className && ex.subtype === 'error') message = message.split(/\n\s+at /)[0].replace(new RegExp(`^${ex.className}: `), '');
      else if (ex.type === 'string' || ex.type === 'number' || ex.type === 'boolean') message = String(ex.value);
      const err = new Error(message);
      for (const fn of this.handlers.pageerror) { try { fn(err); } catch { /* the listener's */ } }
    }
  }

  /** on('pageerror', fn): fn(Error) for each uncaught error in the page. */
  on(event, fn) {
    if (!this.handlers[event]) throw new Error(`no ${event} event here`);
    this.handlers[event].push(fn);
    return this;
  }

  /** Goes to `url` and waits for its load event. */
  async goto(url, { timeoutMs = 30000 } = {}) {
    const r = await this.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`${url}: ${r.errorText}`);
    if (r.loaderId) await waitFor(`${url} to load`, () => this.loaded.has(r.loaderId), { timeoutMs, intervalMs: 20 });
  }

  /** Reloads, and waits for the load event. */
  async reload({ timeoutMs = 30000 } = {}) {
    const before = this.loads;
    await this.send('Page.reload');
    await waitFor('the reload', () => this.loads > before, { timeoutMs, intervalMs: 20 });
  }

  /** Runs `fn(arg)` (or the expression, as text) in the page's own world; awaited, the result by value. */
  evaluate(fn, arg) { return evaluateIn(this.browser, this.sessionId, fn, arg); }

  /** A <script> with `content` (or the file at `path`) appended to the page: it runs in the page's world. */
  async addScriptTag({ content, path: file }) {
    if (file) content = `${fs.readFileSync(file, 'utf8')}\n//# sourceURL=${file.replace(/\n/g, '')}`;
    await this.evaluate((text) => {
      const s = document.createElement('script');
      s.textContent = text;
      (document.head || document.documentElement).appendChild(s);
    }, content);
  }

  /** `content` runs in the page's world before its own scripts, on every load from now on. */
  async addInitScript({ content }) {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: content });
  }

  waitForTimeout(ms) { return sleep(ms); }

  /** Waits until `fn(arg)` is truthy in the page; returns it. */
  waitForFunction(fn, arg, { timeoutMs = 30000 } = {}) {
    return waitFor(`${String(fn).slice(0, 80)} in the page`, () => this.evaluate(fn, arg), { timeoutMs, intervalMs: 50 });
  }

  /**
   * A trusted left click at the centre of the element `selector` finds, once it's there, in view, still,
   * and what's at that point (tests/e2e/lib/chrome.js click, which this is).
   */
  async click(selector, { timeoutMs = 10000 } = {}) {
    await this.waitForFunction((s) => !!document.querySelector(s), selector, { timeoutMs });
    const [x, y] = await this.evaluate(async (sel) => {
      let el = document.querySelector(sel);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = () => JSON.stringify(el.getBoundingClientRect());
      for (let i = 0, last = rect(); i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150));
        el = document.querySelector(sel) || el;
        const now = rect();
        const c = el.getBoundingClientRect();
        const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        if (now === last && hit && (hit === el || el.contains(hit))) break;
        if (!hit || (hit !== el && !el.contains(hit))) el.scrollIntoView({ block: 'center', inline: 'center' });
        last = now;
      }
      const b = el.getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2];
    }, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
  }

  /** Puts `value` in the field `selector` finds, as Playwright's fill: focus, select all, type it in one go. */
  async fill(selector, value, { timeoutMs = 10000 } = {}) {
    await this.waitForFunction((s) => !!document.querySelector(s), selector, { timeoutMs });
    await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.focus();
      if (typeof el.select === 'function') el.select();
      else { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); }
    }, selector);
    if (value) await this.send('Input.insertText', { text: value });
    else for (const type of ['rawKeyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  }

  async close() {
    this.browser.pages.delete(this.sessionId);
    await this.browser.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

module.exports = { browserTestsSkip, launch, findChrome };
