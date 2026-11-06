'use strict';
// Chrome for Testing, driven over the Chrome DevTools Protocol (raw WebSocket, no dependencies), in a
// throwaway profile, connected to the scratch helper only.
//
// Isolation. Chrome reads per-user native messaging manifests from <user data dir>/NativeMessagingHosts.
// The driver starts Chrome with --user-data-dir=<scratch HOME>/Library/Application Support/Google/Chrome,
// exactly where `trif setup --browser chrome` (run with HOME=<scratch>) writes its manifest, so the
// profile, the manifest and the helper are all in the scratch home; your real profile and manifest
// aren't read. (The system-wide /Library/Google/Chrome/NativeMessagingHosts is still consulted; TRIF
// never writes there.) Branded Chrome 137+ ignores --load-extension, hence Chrome for Testing.
//
// "Allow User Scripts": the per-extension switch on chrome://extensions (Chrome 138+). The driver
// flips it the way that page does, with chrome.developerPrivate.updateExtensionConfiguration
// ({userScriptsAccess: true}) evaluated in chrome://extensions, after turning on developer mode in the
// profile's Preferences.
//
// Site access. TRIF's sites are optional host permissions, which Chrome only grants through its own prompt,
// and nothing in automation can answer that prompt (no flag, CDP command or developerPrivate call does it
// for optional host permissions; checked in Chrome for Testing 156). So the driver loads a copy of the
// extension whose manifest makes the sites the suite turns TRIF on for *required* host permissions
// (`siteAccess`, by default SITE_ACCESS_HOSTS): to TRIF that's the same as a user who allowed those sites
// (permissions.request for them says yes without a prompt; removing them is refused, which TRIF ignores),
// and every other site (localhost, amazon.com, instagram.com) stays without access. `siteAccess: 'all'`
// makes <all_urls> required instead: a user who installed TRIF when it was. The copy is in the scratch
// home, next to the profile.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sleep, waitFor, freePort, killMatching } = require('./util');

const EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
// The sites the suite turns TRIF on for (scenario.js, homepage.js): each with its subdomains, as TRIF asks.
const SITE_ACCESS_HOSTS = ['127.0.0.1', 'x.com', 'google.com', 'timsrobot.com'];

/** A copy of the extension in `to` with the test manifest described above. Returns `to`. */
function testExtension(from, to, siteAccess = SITE_ACCESS_HOSTS) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const file = path.join(to, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  // (as the extension asks for a site: lib.js siteOrigins, one pattern, just the address for an IP)
  m.host_permissions = siteAccess === 'all' ? ['<all_urls>'] : siteAccess.map((h) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) ? `*://${h}/*` : `*://*.${h}/*`));
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return to;
}

function findChrome() {
  if (process.env.TRIF_E2E_CHROME) return process.env.TRIF_E2E_CHROME;
  const candidates = [
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ];
  // @puppeteer/browsers' layout: <dir>/chrome/mac_arm-<version>/chrome-mac-arm64/Google Chrome for Testing.app
  for (const base of [path.join(__dirname, '..', '.browsers'), path.join(process.env.HOME || '', '.cache', 'puppeteer')]) {
    try {
      for (const v of fs.readdirSync(path.join(base, 'chrome'))) {
        for (const plat of ['chrome-mac-arm64', 'chrome-mac-x64']) {
          candidates.push(path.join(base, 'chrome', v, plat, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
        }
      }
    } catch { /* none */ }
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.waiting = new Map();
    this.listeners = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => { this.ws = ws; resolve(this); };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onclose = () => { for (const w of this.waiting.values()) w.reject(new Error('connection closed')); this.waiting.clear(); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== undefined && this.waiting.has(m.id)) {
          const w = this.waiting.get(m.id);
          this.waiting.delete(m.id);
          clearTimeout(w.timer);
          if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result);
        } else if (m.method) {
          for (const fn of this.listeners) { try { fn(m); } catch { /* ignore */ } }
        }
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

  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

class ChromeDriver {
  /** opts: { userDataDir, home (scratch HOME for Chrome and so the helper), extensionDir, headless, env, hosts (more to resolve to 127.0.0.1) } */
  constructor(opts) {
    this.opts = opts;
    this.name = 'Chrome';
    this.origin = `chrome-extension://${EXTENSION_ID}`;
    this.sessions = new Map(); // targetId -> sessionId
    this.problems = [];
  }

  async start() {
    const bin = findChrome();
    if (!bin) throw new Error('Chrome for Testing not found: set TRIF_E2E_CHROME to its binary (…/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing)');
    const { userDataDir, home, headless = true } = this.opts;
    const extensionDir = testExtension(this.opts.extensionDir, path.join(path.dirname(userDataDir), 'TRIF-e2e-extension'), this.opts.siteAccess);
    this.siteAccess = this.opts.siteAccess || SITE_ACCESS_HOSTS;
    // Developer mode on, before Chrome first reads the profile (needed for the user scripts switch).
    const prefsDir = path.join(userDataDir, 'Default');
    fs.mkdirSync(prefsDir, { recursive: true });
    const prefsFile = path.join(prefsDir, 'Preferences');
    let prefs = {};
    try { prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { /* new */ }
    prefs.extensions = { ...(prefs.extensions || {}), ui: { ...((prefs.extensions || {}).ui || {}), developer_mode: true } };
    prefs.browser = { ...(prefs.browser || {}), check_default_browser: false, has_seen_welcome_page: true };
    fs.writeFileSync(prefsFile, JSON.stringify(prefs));
    this.port = await freePort();
    const args = [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${this.port}`,
      `--load-extension=${extensionDir}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update',
      '--disable-background-networking', '--password-store=basic', '--use-mock-keychain',
      `--host-resolver-rules=MAP x.com 127.0.0.1, MAP *.x.com 127.0.0.1, MAP www.google.com 127.0.0.1${(this.opts.hosts || []).map((h) => `, MAP ${h} 127.0.0.1`).join('')}`,
      '--ignore-certificate-errors',
      '--window-size=1280,900',
      'about:blank',
    ];
    // A screen bigger than the windows (headless defaults to 800x600, smaller than the 1280x900 windows), so
    // windows are placed as on a real display: `trif screenshot`'s copy window goes against its right edge.
    // (headless: no sound out of the speakers either; the mods' Web Audio still runs)
    if (headless) args.unshift('--headless=new', '--mute-audio', '--screen-info={0,0 2560x1440}');
    const env = { ...process.env, HOME: home };
    for (const k of Object.keys(env)) if (/^(TRIF|WEBMODS)_/.test(k)) delete env[k];
    Object.assign(env, this.opts.env || {});
    const log = fs.openSync(path.join(path.dirname(userDataDir), 'chrome.log'), 'w');
    this.proc = spawn(bin, args, { env, stdio: ['ignore', log, log] });
    const ver = await waitFor('Chrome\'s DevTools endpoint', async () => {
      const r = await fetch(`http://127.0.0.1:${this.port}/json/version`).catch(() => null);
      return r && r.ok ? r.json() : null;
    }, { timeoutMs: 30000 });
    this.version = ver.Browser;
    this.cdp = await new Cdp(ver.webSocketDebuggerUrl).connect();
    this.cdp.on((m) => this._onEvent(m));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
  }

  _onEvent(m) {
    const p = m.params || {};
    if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
      this.problems.push({ level: p.type === 'warning' ? 'warn' : 'error', text: (p.args || []).map((a) => a.value ?? a.description ?? '').join(' '), source: this._urlOf(m.sessionId), from: 'console' });
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      this.problems.push({ level: 'error', text: (d.exception && d.exception.description) || d.text, source: this._urlOf(m.sessionId), from: 'exception' });
    } else if (m.method === 'Log.entryAdded' && (p.entry.level === 'error' || p.entry.level === 'warning')) {
      this.problems.push({ level: p.entry.level === 'warning' ? 'warn' : 'error', text: p.entry.text, source: p.entry.url || this._urlOf(m.sessionId), from: 'log' });
    } else if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') {
      const t = p.targetInfo;
      // Follow the extension's own contexts (service worker, panel, setup page) for console problems.
      if (t && t.url.startsWith(this.origin) && !this.sessions.has(t.targetId) && ['service_worker', 'page'].includes(t.type)) {
        this._attach(t.targetId).catch(() => {});
      }
    }
  }

  _urlOf(sessionId) {
    for (const [tid, sid] of this.sessions) if (sid === sessionId) return this.targetUrls?.get(tid) || tid;
    return '';
  }

  async _attach(targetId) {
    if (this.sessions.has(targetId)) return this.sessions.get(targetId);
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessions.set(targetId, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
    await this.cdp.send('Log.enable', {}, sessionId).catch(() => {});
    return sessionId;
  }

  async targets() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    this.targetUrls = new Map(targetInfos.map((t) => [t.targetId, t.url]));
    return targetInfos;
  }

  /** Nothing to do: the manifest is in <user data dir>/NativeMessagingHosts already. Returns where. */
  async isolateNativeMessaging() {
    return { dirs: [path.join(this.opts.userDataDir, 'NativeMessagingHosts')] };
  }

  /** Loaded by --load-extension at start; checks it's there. */
  async installExtension() {
    await waitFor('the TRIF service worker', async () => (await this.targets()).find((t) => t.type === 'service_worker' && t.url.startsWith(this.origin)), { timeoutMs: 20000 });
    return EXTENSION_ID;
  }

  /**
   * Clicks TRIF's toolbar button on the tab `ctx` shows, as Extensions.triggerAction does: TRIF's
   * action.onClicked opens the side panel, and Chrome gives TRIF activeTab on that tab.
   */
  async clickToolbarButton(ctx) {
    const { targetInfos } = await this.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const page = (await this.targets()).find((t) => t.targetId === ctx);
    const tab = targetInfos.find((t) => t.type === 'tab' && page && t.url === page.url);
    if (!tab) throw new Error(`no tab target for ${page ? page.url : ctx}`);
    await this.cdp.send('Extensions.triggerAction', { id: EXTENSION_ID, targetId: tab.targetId });
  }

  /** Turns on "Allow User Scripts" for TRIF, as the switch on chrome://extensions does. */
  async grantUserScripts() { return this.setUserScripts(true); }

  /** Turns user scripts off for TRIF again, as the switch on chrome://extensions does. */
  async revokeUserScripts() { return this.setUserScripts(false); }

  async setUserScripts(on) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: `chrome://extensions/?id=${EXTENSION_ID}` });
    const sid = await this._attach(targetId);
    await sleep(1000);
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: `new Promise((resolve, reject) => {
        if (!chrome.developerPrivate) return reject(new Error('no chrome.developerPrivate'));
        chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(EXTENSION_ID)}, userScriptsAccess: ${on} }, () => {
          const err = chrome.runtime.lastError; if (err) return reject(new Error(err.message));
          chrome.developerPrivate.getExtensionInfo(${JSON.stringify(EXTENSION_ID)}, (info) => resolve(JSON.stringify({ userScriptsAccess: info.userScriptAccess || info.userScriptsAccess || null, keys: Object.keys(info).filter((k) => /user/i.test(k)) })));
        });
      })`,
      awaitPromise: true, returnByValue: true,
    }, sid);
    await this.cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    this.sessions.delete(targetId);
    if (r.exceptionDetails) throw new Error(`couldn't switch ${on ? 'on' : 'off'} user scripts: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return `developerPrivate: ${r.result.value}`;
  }

  // ---- pages

  async contexts() {
    return (await this.targets()).filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url }));
  }

  async findPage(test, { timeoutMs = 20000 } = {}) {
    const ok = typeof test === 'function' ? test : (u) => u.includes(test);
    return waitFor(`a page matching ${test}`, async () => {
      const c = (await this.contexts()).find((x) => ok(x.url));
      return c ? c.id : null;
    }, { timeoutMs });
  }

  async openTab(url) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url });
    await this._attach(targetId);
    await sleep(500);
    return targetId;
  }

  async navigate(ctx, url) {
    const sid = await this._attach(ctx);
    await this.cdp.send('Page.navigate', { url }, sid);
    await sleep(500);
  }

  async eval(ctx, fnSource, args = [], { timeoutMs = 60000, userActivation = false } = {}) {
    const sid = await this._attach(ctx);
    const expression = `(async () => { const __r = await (${fnSource})(...${JSON.stringify(args)}); return JSON.stringify(__r === undefined ? null : __r); })()`;
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: userActivation }, sid, timeoutMs);
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    const v = r.result && r.result.value;
    return v === undefined || v === null ? null : JSON.parse(v);
  }

  async click(ctx, selector) {
    const sid = await this._attach(ctx);
    const [x, y] = await this.eval(ctx, `async (sel) => {
      let el = document.querySelector(sel);
      if (!el) throw new Error('no element ' + sel);
      el.scrollIntoView({ block: 'center' });
      // Wait for the layout to settle (a notice appearing above can move the element mid-click), and for
      // nothing to cover the element's centre. A list re-rendered meanwhile (the side panel relists its mods
      // when TRIF comes on) replaces the element and can scroll it back out of view: find it and scroll to it again.
      const rect = () => JSON.stringify(el.getBoundingClientRect());
      for (let i = 0, last = rect(); i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150));
        el = document.querySelector(sel) || el;
        const now = rect();
        const c = el.getBoundingClientRect();
        const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        if (now === last && hit && (hit === el || el.contains(hit))) break;
        if (!hit || (hit !== el && !el.contains(hit))) el.scrollIntoView({ block: 'center' });
        last = now;
      }
      const b = el.getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2];
    }`, [selector]);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, sid);
    }
  }

  /** A trusted press of `key` ('Escape') in the page `ctx`. */
  async key(ctx, key) {
    const sid = await this._attach(ctx);
    const codes = { Escape: 27 };
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key] || 0 }, sid);
    }
  }

  /** Moves the mouse off whatever it last clicked (to the bottom left corner), so nothing shows hovered. */
  async pointerAway(ctx) {
    const sid = await this._attach(ctx);
    const h = await this.eval(ctx, 'async () => innerHeight');
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: h - 1 }, sid);
  }

  async screenshot(ctx, file) {
    const sid = await this._attach(ctx);
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async consoleProblems() {
    return this.problems.slice();
  }

  async stop() {
    try { await this.cdp.send('Browser.close', {}, undefined, 5000); } catch { /* closing anyway */ }
    try { this.cdp.close(); } catch { /* ignore */ }
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => this.proc.once('exit', r)), sleep(5000)]);
    }
    await killMatching(this.opts.userDataDir);
  }
}

module.exports = { ChromeDriver, EXTENSION_ID, SITE_ACCESS_HOSTS, findChrome };
