'use strict';
// Firefox, driven over WebDriver BiDi, in a throwaway profile, connected to the scratch helper only.
//
// Isolation. Firefox looks for native messaging manifests in ~/Library/Application Support/Mozilla
// /NativeMessagingHosts, and on macOS it finds ~ from the system (NSHomeDirectory), not $HOME, so
// starting it with HOME=<scratch> doesn't move that folder (checked: Services.dirsvc's
// XREUserNativeManifests stays /Users/<you>/Library/Application Support/Mozilla). So before the add-on
// is installed, the driver (with MOZ_REMOTE_ALLOW_SYSTEM_ACCESS, in the browser's own chrome context)
// replaces NativeManifests' lookup with one that only reads the scratch home's folder: the real one,
// and the system one, are never consulted, so this Firefox can't start your real helper. The helper it
// starts inherits Firefox's environment (HOME=<scratch>, or what the harness's shim sets).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Bidi } = require('./bidi');
const { sleep, waitFor, freePort, killMatching } = require('./util');

const FIREFOX_BIN = process.env.TRIF_E2E_FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
const ADDON_ID = 'webmods@webmods.ext';
const ADDON_UUID = '7e2e7e2e-1111-4222-8333-444455556666';

const USER_JS = (extra = '') => `
user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [ADDON_ID]: ADDON_UUID }))});
user_pref("extensions.webextOptionalPermissionPrompts", false);
user_pref("extensions.update.enabled", false);
user_pref("extensions.update.autoUpdateDefault", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("browser.newtabpage.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("app.update.disabledForTesting", true);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("network.dns.forceResolve", "127.0.0.1");
user_pref("network.proxy.type", 0);
user_pref("devtools.console.stdout.content", false);
${extra}`;

class FirefoxDriver {
  /**
   * opts: { profile, home (scratch HOME for Firefox), nativeDir (the scratch Mozilla folder, holding
   *         NativeMessagingHosts/), extensionDir (unpacked Firefox build), headless, results }
   */
  constructor(opts) {
    this.opts = opts;
    this.name = 'Firefox';
    this.origin = `moz-extension://${ADDON_UUID}`;
    this.consoleEvents = [];
  }

  async start() {
    const { profile, home, headless = true } = this.opts;
    fs.rmSync(profile, { recursive: true, force: true });
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'user.js'), USER_JS());
    this.port = await freePort();
    const args = ['--no-remote', '--new-instance', '--profile', profile, '--remote-debugging-port', String(this.port)];
    if (headless) args.unshift('--headless');
    const env = { ...process.env, HOME: home, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', MOZ_CRASHREPORTER_DISABLE: '1', MOZ_HEADLESS_WIDTH: '1280', MOZ_HEADLESS_HEIGHT: '900' };
    for (const k of Object.keys(env)) if (/^(TRIF|WEBMODS)_/.test(k)) delete env[k];
    Object.assign(env, this.opts.env || {});
    const log = fs.openSync(path.join(path.dirname(profile), 'firefox.log'), 'w');
    this.proc = spawn(FIREFOX_BIN, args, { env, stdio: ['ignore', log, log] });
    this.bidi = new Bidi(`ws://127.0.0.1:${this.port}/session`);
    await this.bidi.connect(30000);
    await this.bidi.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: 'ignore' } } } });
    await this.bidi.send('session.subscribe', { events: ['log.entryAdded'] });
    this.bidi.on('log.entryAdded', (e) => this.consoleEvents.push(e));
    this.version = await this.chrome(`async () => Services.appinfo.version`);
  }

  /** Runs a function in the browser's chrome (privileged) context. */
  async chrome(fnSource, args = []) {
    if (!this.chromeContext) {
      const { contexts } = await this.bidi.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
      if (!contexts.length) throw new Error('no chrome context (is MOZ_REMOTE_ALLOW_SYSTEM_ACCESS set?)');
      this.chromeContext = contexts[0].context;
    }
    return this.bidi.call(this.chromeContext, fnSource, args);
  }

  /** Makes NativeManifests read only `dir`/NativeMessagingHosts. Returns the folders it now searches. */
  async isolateNativeMessaging() {
    const dir = this.opts.nativeDir;
    return this.chrome(`async (dir) => {
      const { NativeManifests } = ChromeUtils.importESModule('resource://gre/modules/NativeManifests.sys.mjs');
      await NativeManifests.init();
      NativeManifests._lookup = (type, name, context) => NativeManifests._tryPaths(type, name, [dir], context);
      NativeManifests.__trifE2e = dir;
      return { dirs: [dir], real: Services.dirsvc.get('XREUserNativeManifests', Ci.nsIFile).path };
    }`, [dir]);
  }

  async installExtension() {
    const r = await this.bidi.send('webExtension.install', { extensionData: { type: 'path', path: this.opts.extensionDir } });
    if (r.extension !== ADDON_ID) throw new Error(`installed ${r.extension}, expected ${ADDON_ID}`);
    return r.extension;
  }

  /** Grants the optional userScripts permission the way the panel's button does (prompts are off in this profile). */
  async grantUserScripts(ctx) {
    // The setup page's "Allow user scripts" button (#settings), clicked for real: Firefox only lets
    // permissions.request run from a user's click.
    try {
      await this.click(ctx, '#settings');
      const ok = await waitFor('the userScripts permission', () => this.bidi.call(ctx, `async () => chrome.permissions.contains({ permissions: ['userScripts'] })`), { timeoutMs: 8000 });
      if (ok) return 'granted by clicking "Allow user scripts" on the setup page';
    } catch { /* fall back below */ }
    // Fallback: grant it from the browser's side.
    await this.chrome(`async (id) => {
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      await ExtensionPermissions.add(id, { permissions: ['userScripts'], origins: [] });
    }`, [ADDON_ID]);
    return 'granted through ExtensionPermissions (permissions.request said no)';
  }

  /** Takes the userScripts permission away again, from an extension page `ctx` (the add-on giving it up). */
  async revokeUserScripts(ctx) {
    const removed = await this.bidi.call(ctx, `async () => chrome.permissions.remove({ permissions: ['userScripts'] })`);
    if (!removed) throw new Error('permissions.remove said no');
    return 'removed with permissions.remove';
  }

  // ---- pages

  async contexts() {
    const { contexts } = await this.bidi.send('browsingContext.getTree', { maxDepth: 0 });
    return contexts.map((c) => ({ id: c.context, url: c.url }));
  }

  /** The first top-level page whose URL satisfies `test` (a substring or a function). */
  async findPage(test, { timeoutMs = 20000 } = {}) {
    const ok = typeof test === 'function' ? test : (u) => u.includes(test);
    return waitFor(`a page matching ${test}`, async () => {
      const c = (await this.contexts()).find((x) => ok(x.url));
      return c ? c.id : null;
    }, { timeoutMs });
  }

  async openTab(url) {
    const { context } = await this.bidi.send('browsingContext.create', { type: 'tab' });
    await this.bidi.send('browsingContext.navigate', { context, url, wait: 'complete' }).catch(() => {});
    return context;
  }

  async navigate(ctx, url) {
    await this.bidi.send('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
  }

  eval(ctx, fnSource, args = [], opts) { return this.bidi.call(ctx, fnSource, args, opts); }

  /** A trusted click on the centre of the element `selector` matches. */
  async click(ctx, selector) {
    const pos = await this.bidi.call(ctx, `async (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('no element ' + sel);
      el.scrollIntoView({ block: 'center' });
      // Wait for the layout to settle (a notice appearing above can move the element mid-click), and for
      // nothing to cover the element's centre.
      const rect = () => JSON.stringify(el.getBoundingClientRect());
      for (let i = 0, last = rect(); i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const now = rect();
        const c = el.getBoundingClientRect();
        const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        if (now === last && hit && (hit === el || el.contains(hit))) break;
        last = now;
      }
      const b = el.getBoundingClientRect();
      return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    }`, [selector]);
    await this.bidi.send('input.performActions', {
      context: ctx,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: pos[0], y: pos[1] }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ] }],
    });
    await this.bidi.send('input.releaseActions', { context: ctx }).catch(() => {});
  }

  /** Moves the mouse off whatever it last clicked (to the bottom left corner), so nothing shows hovered. */
  async pointerAway(ctx) {
    const h = await this.bidi.call(ctx, 'async () => innerHeight');
    await this.bidi.send('input.performActions', {
      context: ctx,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: 1, y: h - 1 }] }],
    });
    await this.bidi.send('input.releaseActions', { context: ctx }).catch(() => {});
  }

  async screenshot(ctx, file) {
    const { data } = await this.bidi.send('browsingContext.captureScreenshot', { context: ctx });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  /** Warnings and errors from the add-on (background, panel, setup page) and from pages, since start. */
  async consoleProblems() {
    const out = [];
    // Everything Firefox's console service has, which includes the add-on's background page.
    const msgs = await this.chrome(`async () => Services.console.getMessageArray().map((m) => {
      let e = null; try { e = m.QueryInterface(Ci.nsIScriptError); } catch {}
      if (e) return { level: (e.flags & 1) || /Warning processing/.test(e.errorMessage) ? 'warn' : 'error', text: e.errorMessage, source: e.sourceName || '', category: e.category || '' };
      return { level: 'info', text: m.message, source: '', category: '' };
    })`).catch((e) => [{ level: 'error', text: `couldn't read the console: ${e.message}`, source: 'harness' }]);
    for (const m of msgs) {
      const ours = m.source.startsWith(this.origin) || /trif:\/\/|webmods:\/\/|\[TRIF\]|webmods@webmods\.ext|com\.webmods\.helper|NativeMessaging|native manifest/i.test(m.text + ' ' + m.source);
      if (ours && m.level !== 'info') out.push({ ...m, from: 'console' });
    }
    for (const e of this.consoleEvents) {
      if (e.level === 'warn' || e.level === 'error') {
        out.push({ level: e.level === 'warn' ? 'warn' : 'error', text: e.text, source: (e.source && e.source.context) || '', from: 'page' });
      }
    }
    return out;
  }

  async stop() {
    try { await this.bidi.send('session.end', {}, 5000); } catch { /* closing anyway */ }
    try { this.bidi.close(); } catch { /* ignore */ }
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => this.proc.once('exit', r)), sleep(5000)]);
    }
    await killMatching(this.opts.profile);
  }
}

module.exports = { FirefoxDriver, ADDON_ID, ADDON_UUID };
