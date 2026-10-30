// WebMods service worker: talks to the native helper, keeps chrome.userScripts in sync with the mods
// folder, executes page commands from the `webmods` CLI, and relays agent runs between the side
// panel and the helper. See docs/PROTOCOL.md.

import {
  SETTINGS_URL, USER_SCRIPTS_OFF, FIREFOX, BROWSER, userScriptsAvailable, syncUserScripts, resolveTab, tabInfo,
  normalizeUrl, normalizeSite, hostMatchesSite, buildRunCode, buildPollCode, parseRunEnvelope,
  firstInjectionResult, withTimeout, filterRequests, nextBackoff, chromeVersion, toolLine,
  normalizeDisabled, modAppliesTo, urlInScope, modInScope, applyStartOff,
  normalizeOffSites, offSiteName, hostInScope, withOffSites, switchSite, fromOtherBrowser, timedUserScripts,
} from './lib.js';
import { runtimeCode } from './runtime.js';

const HOST = 'com.webmods.helper';
const VERSION = chrome.runtime.getManifest().version;
const CHROME = chromeVersion(navigator.userAgent);
const LOAD_TIMEOUT = 30000;
const CHAT_MAX = 500;          // messages kept per site
const NOT_CONNECTED = `The WebMods helper isn't connected. Run \`npx webmods setup\` in a terminal (needs Node 18+), then restart ${BROWSER}.`;

const state = {
  port: null,
  connected: false,      // true once the helper has sent us something on the current port
  connectedAt: 0,
  helperError: null,     // last disconnect reason (shown on the onboarding page)
  backoff: 0,
  retryTimer: null,
  userScripts: null,     // null until first checked
  mods: [],              // last `mods` message (persisted)
  recording: [],         // hostnames being recorded (persisted)
  disabled: {},          // mod id → true for mods the user switched off (persisted as `disabled`)
  offSites: {},          // mod id → sites it's switched off on, for mods on several sites (persisted)
  startedOff: {},        // mod id → true for mods already switched off once: preinstalled, or from another browser (persisted)
  installId: null,       // random id of this install (persisted): the helper records it as the origin of mods made here
  applied: {},           // script id → hash last registered (persisted)
  lastApply: { registered: [], errors: [] },
  requestSeq: 0,
  pending: new Map(),    // our native request id → {resolve, reject, timer}
  runs: new Map(),       // runId → {runId, site, agent, tabId, stopping, errored, texts}
  starting: 0,           // agent.start requests awaiting their response
  early: new Map(),      // runId → events that arrived before its agent.start response (defensive)
  logins: new Set(),     // loginIds of agent logins in progress (see agent.login)
  panels: new Set(),     // connected side panel ports
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e) => String(e?.message ?? e);

// ---- startup ------------------------------------------------------------------------------------

const ready = chrome.storage.local.get(null).then(async (s) => {
  if (Array.isArray(s.mods)) state.mods = s.mods;
  if (Array.isArray(s.recording)) state.recording = s.recording;
  state.disabled = normalizeDisabled(s.disabled);
  state.offSites = normalizeOffSites(s.offSites);
  state.startedOff = normalizeDisabled(s.startedOff);
  state.installId = typeof s.installId === 'string' && s.installId ? s.installId : crypto.randomUUID();
  if (state.installId !== s.installId) await chrome.storage.local.set({ installId: state.installId });
  if (s.applied && typeof s.applied === 'object') state.applied = s.applied;
  await cleanStaleRuns(s);
}).catch((e) => console.error('[webmods] failed to read storage', e));

// Listeners must be registered synchronously at the top level of a service worker.
chrome.runtime.onStartup.addListener(() => {
  setPanelBehavior();
  ready.then(() => { checkUserScripts(); connect(); });
});
chrome.runtime.onInstalled.addListener((details) => {
  setPanelBehavior();
  ready.then(() => serial(applyMods)).catch(() => {});
  if (details.reason === 'install') openOnboarding().catch(() => {});
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  ready.then(() => onPageMessage(msg)).then(sendResponse, (e) => sendResponse({ error: errMsg(e) }));
  return true;
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel' || port.sender?.id !== chrome.runtime.id) return;
  onPanelConnect(port);
});
if (FIREFOX) {
  // Firefox has a sidebar instead of the side panel; the toolbar button toggles it (toggle() must run
  // synchronously in the click handler).
  chrome.action.onClicked.addListener(() => { (globalThis.browser ?? chrome).sidebarAction.toggle(); });
  // Its userScripts permission is optional: the setup page or the panel asks for it.
  chrome.permissions.onAdded.addListener(() => ready.then(checkUserScripts));
  chrome.permissions.onRemoved.addListener(() => ready.then(checkUserScripts));
}

/** The toolbar icon opens the side panel (the setting persists, so this only needs to run occasionally). */
function setPanelBehavior() {
  if (FIREFOX) return;
  try {
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })?.catch?.((e) => console.warn('[webmods] setPanelBehavior failed', e));
  } catch (e) {
    console.warn('[webmods] setPanelBehavior failed', e);
  }
}

ready.then(() => {
  checkUserScripts();
  serial(applyMods).catch(() => {}); // re-apply persisted mods without waiting for the helper
  connect();
});

// Mod syncing and recording changes run one at a time. If one hasn't finished after QUEUE_STALL_MS (a
// browser call that never answers), it's logged and the queue moves on instead of freezing every switch.
const QUEUE_STALL_MS = 30000;
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn);
  let timer;
  const stalled = new Promise((resolve) => {
    timer = setTimeout(() => {
      log('warn', `a mod sync hasn't finished after ${QUEUE_STALL_MS / 1000}s; not waiting for it`);
      resolve();
    }, QUEUE_STALL_MS);
  });
  queue = Promise.race([p.catch(() => {}), stalled]).finally(() => clearTimeout(timer));
  return p;
}

// ---- user scripts -------------------------------------------------------------------------------

/** Re-check the "Allow User Scripts" switch; re-apply mods when it was just turned on. */
function checkUserScripts() {
  const now = userScriptsAvailable(chrome);
  const before = state.userScripts;
  state.userScripts = now;
  if (before !== null && before !== now) {
    log(now ? 'info' : 'warn', now ? 'user scripts were turned on' : 'user scripts were turned off');
    // A fresh hello keeps the helper's view of the switch (shown by `webmods doctor`) current.
    post({ type: 'hello', version: VERSION, userScripts: now, chrome: CHROME, browser: BROWSER, installId: state.installId });
    if (now) serial(applyMods).then(reportApplied, () => {});
    notifyPanels();
  }
  return now;
}

const isEnabled = (id) => state.disabled[id] !== true;

async function applyMods() {
  if (!checkUserScripts()) {
    state.lastApply = { registered: [], errors: state.mods.filter((m) => isEnabled(m.id)).map((m) => ({ id: m.id, error: USER_SCRIPTS_OFF })) };
    return state.lastApply;
  }
  try {
    const res = await syncUserScripts(timedUserScripts(chrome.userScripts), {
      mods: state.mods, runtimeCode: runtimeCode(state.recording), applied: state.applied, disabled: state.disabled,
      offSites: state.offSites, recording: state.recording,
    });
    state.applied = res.applied;
    state.lastApply = { registered: res.registered, errors: res.errors };
    await chrome.storage.local.set({ applied: state.applied });
    for (const e of res.errors) log('error', `mod ${e.id}: ${e.error}`);
  } catch (e) {
    state.applied = {}; // unknown state: force a full re-register next time
    state.lastApply = { registered: [], errors: state.mods.filter((m) => isEnabled(m.id)).map((m) => ({ id: m.id, error: errMsg(e) })) };
    log('error', `applying mods failed: ${errMsg(e)}`);
  }
  return state.lastApply;
}

function reportApplied(res) {
  post({ type: 'modsApplied', registered: res.registered, errors: res.errors });
  notifyPanels();
}

function requireUserScripts() {
  if (!checkUserScripts()) throw new Error(USER_SCRIPTS_OFF);
}

// ---- native messaging ---------------------------------------------------------------------------

function connect() {
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
  if (state.port) return;
  let port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    state.helperError = errMsg(e);
    scheduleReconnect();
    return;
  }
  state.port = port;
  port.onMessage.addListener((msg) => {
    if (!state.connected) { state.connected = true; state.connectedAt = Date.now(); state.helperError = null; notifyPanels(); }
    checkUserScripts();
    onHelperMessage(msg).catch((e) => log('error', `handling ${msg?.type}: ${errMsg(e)}`));
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'the helper exited';
    console.warn('[webmods] helper disconnected:', reason);
    if (state.connected && Date.now() - state.connectedAt > 10000) state.backoff = 0;
    state.port = null;
    state.connected = false;
    state.helperError = reason;
    helperGone(reason);
    scheduleReconnect();
  });
  // After storage is read, so the hello carries the install id.
  ready.then(() => { if (state.port === port) post({ type: 'hello', version: VERSION, userScripts: checkUserScripts(), chrome: CHROME, browser: BROWSER, installId: state.installId }); });
}

function scheduleReconnect() {
  state.backoff = nextBackoff(state.backoff);
  clearTimeout(state.retryTimer);
  state.retryTimer = setTimeout(connect, state.backoff);
}

function post(msg) {
  if (!state.port) return;
  try { state.port.postMessage(msg); } catch (e) { console.warn('[webmods] postMessage failed', e); }
}

function log(level, message) {
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[webmods]', message);
  post({ type: 'log', level, message });
}

async function onHelperMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'mods') {
    state.mods = Array.isArray(msg.mods) ? msg.mods : [];
    // Preinstalled mods, and mods made from another browser, arrive switched off the first time (before
    // they're ever registered).
    const off = applyStartOff(state.mods, state.disabled, state.startedOff, state.installId);
    if (off.changed) {
      state.disabled = off.disabled;
      state.startedOff = off.startedOff;
      await chrome.storage.local.set({ disabled: state.disabled, startedOff: state.startedOff });
    }
    await chrome.storage.local.set({ mods: state.mods });
    reportApplied(await serial(applyMods));
  } else if (msg.type === 'request') {
    try {
      const result = await runCommand(msg.cmd, msg.args || {});
      post({ type: 'response', id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (e) {
      post({ type: 'response', id: msg.id, ok: false, error: errMsg(e) });
    }
  } else if (msg.type === 'response') {
    const p = state.pending.get(msg.id);
    if (!p) return;
    state.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'the helper reported an error'));
  } else if (msg.type === 'agentEvent') {
    await onAgentEvent(msg.runId, msg.event);
  }
}

/** Send a native `request` to the helper (the reverse of CLI page commands) and await its `response`. */
function helperRequest(cmd, args = {}, timeout = 30000) {
  if (!state.port) return Promise.reject(new Error(NOT_CONNECTED));
  const id = `ext-${++state.requestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`the helper didn't answer ${cmd} within ${timeout / 1000} s`));
    }, timeout);
    state.pending.set(id, { resolve, reject, timer });
    try {
      state.port.postMessage({ type: 'request', id, cmd, args });
    } catch (e) {
      state.pending.delete(id);
      clearTimeout(timer);
      reject(new Error(`${NOT_CONNECTED} (${errMsg(e)})`));
    }
  });
}

/** The helper went away: fail pending requests and finish in-flight runs for the panel. */
function helperGone(reason) {
  for (const [id, p] of state.pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`the WebMods helper disconnected (${reason})`));
    state.pending.delete(id);
  }
  for (const runId of [...state.runs.keys()]) {
    onAgentEvent(runId, { kind: 'error', message: `The WebMods helper disconnected while the agent was working (${reason}).` });
    onAgentEvent(runId, { kind: 'done', ok: false, result: '', costUsd: null, changedFiles: [], sessionId: null });
  }
  for (const loginId of [...state.logins]) {
    onAgentEvent(loginId, { kind: 'error', message: `The WebMods helper disconnected during the login (${reason}).` });
    onAgentEvent(loginId, { kind: 'done', ok: false, login: true });
  }
  notifyPanels();
}

// ---- page commands ------------------------------------------------------------------------------

// A side-panel agent run's requests carry args.scope (the helper sets it from the run's token): they
// may only touch tabs and URLs on that site. See docs/PROTOCOL.md "Run scope".
function checkScopeUrl(url, scope, what) {
  if (scope && !urlInScope(url, scope)) {
    throw new Error(`${what} is on ${hostOf(url) || url || 'a page'}, and this agent run is limited to ${scope}` +
      ' (it was started from the side panel on that site; the user can start another chat on the other site)');
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

async function scopedTab(args) {
  const tab = await resolveTab(chrome, args);
  checkScopeUrl(tab.url || tab.pendingUrl || '', args.scope, `tab ${tab.id}`);
  return tab;
}

const commands = {
  async status() {
    // Let pending mod syncs finish first, but answer within a few seconds even if one is stuck.
    await Promise.race([serial(() => {}), sleep(3000)]);
    let ids = new Set();
    if (checkUserScripts()) {
      try { ids = new Set((await timedUserScripts(chrome.userScripts).getScripts()).map((s) => s.id)); } catch { /* switched off meanwhile, or stuck */ }
    }
    const errors = new Map(state.lastApply.errors.map((e) => [e.id, e.error]));
    return {
      userScripts: state.userScripts, chrome: CHROME, browser: BROWSER, version: VERSION,
      mods: state.mods.map((m) => {
        const o = { id: m.id, registered: ids.has(m.id), enabled: isEnabled(m.id) };
        if (state.offSites[m.id]) o.offSites = state.offSites[m.id];
        if (m.held) o.held = m.held;
        if (errors.has(m.id) && errors.get(m.id) !== USER_SCRIPTS_OFF) o.error = errors.get(m.id);
        return o;
      }),
      recording: state.recording,
    };
  },

  async tabs(args) {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
    return tabs.filter((t) => !args.scope || urlInScope(t.url || t.pendingUrl || '', args.scope)).map(tabInfo);
  },

  async run(args) {
    requireUserScripts();
    if (typeof args.code !== 'string') throw new Error('missing code');
    const tab = await scopedTab(args);
    const timeout = Number(args.timeout) > 0 ? Number(args.timeout) : 10000;
    const runId = crypto.randomUUID();
    let timedOut = false;
    const execute = async (code) => firstInjectionResult(await chrome.userScripts.execute({
      target: { tabId: tab.id }, world: 'MAIN', injectImmediately: true, js: [{ code }],
    }));
    const work = (async () => {
      let out = await execute(buildRunCode(args.code, !!args.expression, runId));
      // Fallback in case execute didn't wait for the promise: poll the stored envelope.
      while (out === null && !timedOut) {
        await sleep(100);
        out = await execute(buildPollCode(runId));
      }
      return out === null ? null : parseRunEnvelope(out);
    })();
    try {
      return await withTimeout(work, timeout, `timed out after ${timeout}ms`);
    } finally {
      timedOut = true;
    }
  },

  async reload(args) {
    const tab = await scopedTab(args);
    return loadAndReport(tab.id, () => chrome.tabs.reload(tab.id, { bypassCache: !!args.hard }));
  },

  async navigate(args) {
    const url = normalizeUrl(args.to);
    checkScopeUrl(url, args.scope, 'that URL');
    const tab = await scopedTab(args);
    return loadAndReport(tab.id, () => chrome.tabs.update(tab.id, { url }));
  },

  async open(args) {
    const url = normalizeUrl(args.to);
    checkScopeUrl(url, args.scope, 'that URL');
    const waiter = loadWaiter();
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      let tab;
      if (win) {
        // In the background: agents work while the user is looking at something else.
        tab = await chrome.tabs.create({ url, active: false, windowId: win.id });
      } else {
        tab = (await chrome.windows.create({ url, focused: false })).tabs[0];
      }
      await waiter.wait(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { id: t.id, url: t.url };
    } finally {
      waiter.stop();
    }
  },

  async text(args) {
    const tab = await scopedTab(args);
    // Isolated world via chrome.scripting: works even when user scripts are off and can't be
    // fooled by page globals.
    return pageCall(tab.id, 'ISOLATED', () => {
      const root = document.body || document.documentElement;
      return { url: location.href, title: document.title, text: String((root && root.innerText) || '').slice(0, 200000) };
    });
  },

  // Only the tab showing in its window can be captured, and WebMods never switches tabs or focuses
  // windows to get one: several agents can be working at once while the user browses.
  async screenshot(args) {
    const tab = await scopedTab(args);
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!tab.active || !win || win.state === 'minimized') {
      throw new Error("that tab isn't showing (WebMods doesn't switch tabs while the user is browsing); " +
        'inspect it with `webmods text` or `webmods run` instead, or try again when it is in front');
    }
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
  },

  async record(args) {
    const site = normalizeSite(args.site);
    checkScopeUrl(`https://${site}/`, args.scope, site);
    const set = new Set(state.recording);
    if (args.on === false || args.on === 'off') set.delete(site); else set.add(site);
    state.recording = [...set].sort();
    await chrome.storage.local.set({ recording: state.recording });
    if (checkUserScripts()) reportApplied(await serial(applyMods));
    return { recording: state.recording };
  },

  async requests(args) {
    requireUserScripts();
    const tab = await scopedTab(args);
    const r = await pageCall(tab.id, 'MAIN', () => {
      const w = window.__webmods;
      if (!w || !Array.isArray(w.requests)) return null;
      return {
        recording: !!w.recording, host: location.hostname,
        entries: w.requests.map((e) => ({ i: e.i, method: e.method, url: e.url, status: e.status, type: e.type, size: e.size, time: e.time })),
      };
    });
    if (!r) throw new Error(state.recording.some((s) => hostMatchesSite(hostOf(tab.url || ''), s)) ? noRuntime() : notRecording(hostOf(tab.url || '')));
    if (!r.recording) throw new Error(notRecording(r.host));
    return filterRequests(r.entries, args);
  },

  async request(args) {
    requireUserScripts();
    const i = Number(args.i);
    if (!Number.isInteger(i)) throw new Error('missing request number i (see `webmods requests`)');
    const tab = await scopedTab(args);
    const r = await pageCall(tab.id, 'MAIN', (n) => {
      const w = window.__webmods;
      if (!w || !Array.isArray(w.requests)) return { missing: true };
      const e = w.requests.find((x) => x.i === n);
      return { recording: !!w.recording, host: location.hostname, entry: e ? { method: e.method, url: e.url, status: e.status, requestBody: e.requestBody, responseText: e.responseText } : null };
    }, [i]);
    if (r.missing) throw new Error(noRuntime());
    if (!r.recording) throw new Error(notRecording(r.host));
    if (!r.entry) throw new Error(`no request ${i} in this page (recorded requests reset on every page load; see \`webmods requests\`)`);
    return r.entry;
  },

  async errors(args) {
    return runtimeList(args, 'errors');
  },

  /**
   * Switch a mod on or off: everywhere, or with `site` on that site only (switchSite in lib.js). The
   * state lives in chrome.storage.local `disabled` and `offSites`; the mod file is never touched. Then
   * reload the target tab (selector, else the active tab) if the mod runs on it, so the change shows
   * (`wait: true` waits for the load, like `reload`). If registering/unregistering fails, the previous
   * state is restored and the error thrown. A scoped run may switch a mod on its own site with `site`.
   */
  async 'mod.enable'(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) throw new Error('missing mod id');
    if (typeof args.enabled !== 'boolean') throw new Error('enabled must be true or false');
    const mod = state.mods.find((m) => m.id === id);
    if (!mod) throw new Error(`no mod ${id} (run \`webmods status\` to list mods)`);
    const site = args.site == null || args.site === '' ? null : offSiteName(args.site);
    if (args.site != null && args.site !== '' && !site) throw new Error(`"${args.site}" isn't a site (use a hostname like twitter.com)`);
    if (args.scope && !(site ? hostInScope(site, args.scope) : modInScope(mod, args.scope))) {
      throw new Error(`${site ? `${site} is` : `${id} runs`} outside ${args.scope}, and this agent run is limited to ${args.scope}`);
    }
    const enabled = args.enabled;
    const res = await serial(async () => {
      const before = { disabled: !isEnabled(id), offSites: state.offSites[id] || [] };
      const after = site ? switchSite(mod, before, site, enabled) : { disabled: !enabled, offSites: before.offSites };
      await setSwitchState(id, after);
      const r = await applyMods();
      const failure = r.errors.find((e) => e.id === id && e.error !== USER_SCRIPTS_OFF);
      if (failure) {
        await setSwitchState(id, before);
        await applyMods();
      }
      return { failure, after };
    });
    reportApplied(state.lastApply);
    if (res.failure) throw new Error(`couldn't turn ${id} ${enabled ? 'on' : 'off'}${site ? ` on ${site}` : ''}: ${res.failure.error}`);
    const siteInfo = site ? { site, offSites: res.after.offSites, modEnabled: !res.after.disabled } : {};
    return { id, enabled, ...siteInfo, reloaded: await reloadIfApplies(mod, args) };
  },

  async logs(args) {
    return runtimeList(args, 'logs');
  },
};

async function setSwitchState(id, { disabled, offSites }) {
  const next = { ...state.disabled };
  if (disabled) next[id] = true; else delete next[id];
  const nextOff = { ...state.offSites };
  if (offSites.length) nextOff[id] = offSites; else delete nextOff[id];
  state.disabled = next;
  state.offSites = nextOff;
  await chrome.storage.local.set({ disabled: next, offSites: nextOff });
}

/** After a switch: reload the selected (or active) tab if `mod` runs on it. Returns the tab id or null; never throws. */
async function reloadIfApplies(mod, args) {
  try {
    const tab = await scopedTab(args);
    if (!modAppliesTo(mod, tab.url || tab.pendingUrl || '')) return null;
    if (args.wait) await loadAndReport(tab.id, () => chrome.tabs.reload(tab.id)).catch(() => {});
    else await chrome.tabs.reload(tab.id);
    return tab.id;
  } catch {
    return null;
  }
}

async function runCommand(cmd, args) {
  await ready;
  const fn = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
  if (!fn) throw new Error(`unknown command: ${cmd}`);
  return fn(args);
}

async function runtimeList(args, key) {
  requireUserScripts();
  const tab = await scopedTab(args);
  const list = await pageCall(tab.id, 'MAIN', (k) => {
    const w = window.__webmods;
    return w && Array.isArray(w[k]) ? w[k].slice() : null;
  }, [key]);
  if (list) return list;
  // The runtime only runs where a mod that's on does (or on a recorded site): no such mod, nothing to report.
  const url = tab.url || tab.pendingUrl || '';
  if (!state.mods.some((m) => isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, state.offSites[m.id]), url))) return [];
  throw new Error(noRuntime());
}

function noRuntime() {
  return 'the WebMods runtime is not running in this tab (the page was loaded before WebMods was ready, or it is a page extensions cannot access). Reload the tab and try again.';
}

function notRecording(host) {
  const site = state.recording.find((s) => hostMatchesSite(host, s));
  return site
    ? `recording of ${site} was turned on after this page loaded: reload the tab (\`webmods reload\`) and try again.`
    : `not recording ${host}. Run \`webmods record ${host} on\`, then reload the tab.`;
}

/** Run `func` in the tab's top frame with chrome.scripting and return its (JSON-able) result. */
async function pageCall(tabId, world, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  const r = results?.[0];
  if (!r) throw new Error('could not access the page (it may be a page extensions cannot access, like chrome:// or the Web Store)');
  if (r.error) throw new Error(errMsg(r.error));
  return r.result;
}

/** Watches tabs.onUpdated from before a navigation starts, so a fast load can't be missed. */
function loadWaiter() {
  const done = new Set();
  const waiting = new Map();
  const listener = (tabId, info) => {
    if (info.status !== 'complete') return;
    done.add(tabId);
    waiting.get(tabId)?.();
  };
  chrome.tabs.onUpdated.addListener(listener);
  return {
    wait(tabId) {
      const p = new Promise((resolve) => { if (done.has(tabId)) resolve(); else waiting.set(tabId, resolve); });
      return withTimeout(p, LOAD_TIMEOUT, `timed out after ${LOAD_TIMEOUT / 1000} s waiting for the page to load`);
    },
    stop() { chrome.tabs.onUpdated.removeListener(listener); },
  };
}

async function loadAndReport(tabId, trigger) {
  const waiter = loadWaiter();
  try {
    await trigger();
    await waiter.wait(tabId);
    const t = await chrome.tabs.get(tabId);
    return { url: t.url };
  } finally {
    waiter.stop();
  }
}

// ---- onboarding page ----------------------------------------------------------------------------

async function openOnboarding() {
  const url = chrome.runtime.getURL('onboarding.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function onPageMessage(msg) {
  switch (msg?.type) {
    case 'reconnect':
      state.backoff = 0;
      connect();
      return { ok: true };
    case 'status':
      return uiStatus();
    case 'mod.enable': {
      const args = { id: msg.id, enabled: msg.enabled };
      if (msg.tab !== undefined) args.tab = msg.tab;
      if (msg.site) args.site = msg.site;
      return commands['mod.enable'](args);
    }
    default:
      throw new Error(`unknown message ${msg?.type}`);
  }
}

/** Status for the onboarding page and the side panel. */
async function uiStatus() {
  if (!state.port && !state.retryTimer) connect();
  const s = await commands.status();
  const errors = new Map(state.lastApply.errors.map((e) => [e.id, e.error]));
  return {
    helper: { connected: state.connected, error: state.connected ? null : state.helperError },
    userScripts: s.userScripts, settingsUrl: SETTINGS_URL, version: VERSION, chrome: CHROME, browser: BROWSER,
    recording: s.recording,
    mods: state.mods.map((m, i) => ({
      id: m.id, name: m.name || m.id, description: m.description || '', site: m.site, file: m.file || '',
      matches: m.matches || [], excludes: m.excludes || [], registered: s.mods[i].registered, enabled: s.mods[i].enabled,
      error: errors.get(m.id) === USER_SCRIPTS_OFF ? null : errors.get(m.id) || null,
      held: m.held || null, risk: m.risk || null,
      from: fromOtherBrowser(m, state.installId) ? (m.origin.browser || 'another browser') : null,
    })),
    runs: [...state.runs.values()].map((r) => ({ runId: r.runId, site: r.site })),
  };
}

// ---- side panel ---------------------------------------------------------------------------------
//
// Panels talk over a `panel` port. Requests carry a `reqId` and get `{type:"reply", reqId, ok,
// result|error}`; every native agentEvent is relayed as `{type:"agentEvent", runId, event}`; and
// `{type:"statusChanged"}` tells panels to ask for status again. The background also writes each
// run's transcript into `chat:<site>` (so a run survives the panel being closed, and every panel
// showing the site sees the same chat via storage.onChanged).

function onPanelConnect(port) {
  state.panels.add(port);
  port.onDisconnect.addListener(() => state.panels.delete(port));
  port.onMessage.addListener((msg) => {
    ready.then(() => onPanelMessage(msg)).then(
      (result) => reply(port, msg, { ok: true, result: result === undefined ? null : result }),
      (e) => reply(port, msg, { ok: false, error: errMsg(e) }),
    );
  });
}

function reply(port, msg, r) {
  if (msg?.reqId === undefined) return;
  try { port.postMessage({ type: 'reply', reqId: msg.reqId, ...r }); } catch { /* panel closed */ }
}

function broadcast(msg) {
  for (const port of state.panels) {
    try { port.postMessage(msg); } catch { state.panels.delete(port); }
  }
}

function notifyPanels() {
  broadcast({ type: 'statusChanged' });
}

async function onPanelMessage(msg) {
  switch (msg?.type) {
    case 'status': return uiStatus();
    case 'agent.list': return helperRequest('agent.list', {}, 20000);
    case 'instructions.get': return helperRequest('instructions.get', {}, 10000);
    case 'instructions.set': return helperRequest('instructions.set', { text: String(msg.text ?? '') }, 10000);
    case 'agent.start': return startAgent(msg);
    case 'agent.stop': return stopAgent(msg.runId);
    case 'agent.login': return startLogin(msg);
    case 'agent.loginCode': return helperRequest('agent.loginCode', { loginId: String(msg.loginId ?? ''), code: String(msg.code ?? '') }, 10000);
    case 'agent.loginCancel': return helperRequest('agent.loginCancel', { loginId: String(msg.loginId ?? '') }, 10000);
    case 'chat.clear': return clearChat(msg.site);
    case 'chat.note': {
      // A line from the panel itself (a slash command's answer), shown like a tool line.
      const site = normalizeSite(msg.site);
      await updateChat(site, (chat) => { chat.messages.push({ role: 'tool', text: String(msg.text ?? ''), time: Date.now() }); });
      return { ok: true };
    }
    case 'mod.approve': {
      const r = await helperRequest('mod.approve', { id: String(msg.id ?? '') }, 10000);
      if (msg.tab !== undefined) {
        await serial(() => {}); // the helper re-sent the mods before answering: let them register first
        const mod = state.mods.find((m) => m.id === r.id);
        if (mod) await reloadIfApplies(mod, { tab: msg.tab });
      }
      return r;
    }
    case 'mod.delete': {
      // The mod stops running once the helper re-sends the mods; reload the tab it was running on.
      const mod = state.mods.find((m) => m.id === msg.id);
      const r = await helperRequest('mod.delete', { id: String(msg.id ?? '') }, 10000);
      if (mod && msg.tab !== undefined) { await serial(() => {}); await reloadIfApplies(mod, { tab: msg.tab }); }
      return r;
    }
    case 'mod.restore': {
      const r = await helperRequest('mod.restore', { id: String(msg.id ?? '') }, 10000);
      if (msg.tab !== undefined) {
        await serial(() => {});
        const mod = state.mods.find((m) => m.id === r.id);
        if (mod) await reloadIfApplies(mod, { tab: msg.tab });
      }
      return r;
    }
    default: return onPageMessage(msg);
  }
}

async function startAgent(msg) {
  const site = normalizeSite(msg.site);
  const prompt = String(msg.prompt ?? '').trim();
  if (!prompt) throw new Error('empty message');
  const agent = msg.agent ? String(msg.agent) : undefined;
  const tabId = Number.isInteger(msg.tabId) ? msg.tabId : undefined;
  const startedAt = Date.now();
  await updateChat(site, (chat) => {
    if (chat.run) throw new Error(`already working on ${site}`);
    chat.messages.push({ role: 'user', text: prompt, time: startedAt });
    chat.run = { runId: null, startedAt };
    chat.last = null;
  });
  const args = { site, url: String(msg.url ?? ''), tabId, prompt, agent };
  if (msg.sessionId) args.sessionId = String(msg.sessionId);
  if (msg.model) args.model = String(msg.model);
  let runId;
  state.starting++;
  try {
    ({ runId } = (await helperRequest('agent.start', args)) || {});
    if (!runId) throw new Error('the helper did not return a run id');
  } catch (e) {
    if (--state.starting === 0) state.early.clear();
    await updateChat(site, (chat) => {
      chat.messages.push({ role: 'error', text: errMsg(e), time: Date.now() });
      chat.run = null;
    }).catch(() => {});
    throw e;
  }
  // Registered synchronously after the response, before the next native message is handled.
  state.runs.set(runId, { runId, site, agent, tabId, stopping: false, errored: false, texts: 0 });
  const early = state.early.get(runId) || [];
  state.early.delete(runId);
  if (--state.starting === 0) state.early.clear();
  await updateChat(site, (chat) => {
    if (chat.run && chat.run.startedAt === startedAt) chat.run.runId = runId;
  });
  for (const event of early) onAgentEvent(runId, event, false);
  notifyPanels();
  return { runId };
}

async function stopAgent(runId) {
  const run = state.runs.get(runId);
  if (run) run.stopping = true;
  return helperRequest('agent.stop', { runId }, 10000);
}

/** Log the agent in: the helper runs its login command; events arrive under the loginId (the panel opens the URL). */
async function startLogin(msg) {
  const args = msg.agent ? { agent: String(msg.agent) } : {};
  const r = await helperRequest('agent.login', args);
  if (!r?.loginId) throw new Error('the helper did not return a login id');
  state.logins.add(r.loginId);
  return { loginId: r.loginId };
}

async function clearChat(site) {
  const s = normalizeSite(site);
  for (const r of state.runs.values()) {
    if (r.site === s) { r.stopping = true; helperRequest('agent.stop', { runId: r.runId }, 10000).catch(() => {}); }
  }
  await chatSerial(s, () => chrome.storage.local.remove(chatKey(s)));
  return { cleared: true };
}

async function onAgentEvent(runId, event, relay = true) {
  if (relay) broadcast({ type: 'agentEvent', runId, event });
  if (event?.login) { if (event.kind === 'done') state.logins.delete(runId); return; }
  if (state.logins.has(runId)) return; // login events concern the panel only
  const run = state.runs.get(runId);
  if (!run && state.starting > 0 && state.early.size < 20) {
    // The helper answers agent.start before launching, so this shouldn't happen; keep it anyway.
    const list = state.early.get(runId) || [];
    if (list.length < 200) list.push(event);
    state.early.set(runId, list);
  }
  if (!run || !event || typeof event !== 'object') return;
  if (event.kind === 'done') state.runs.delete(runId);
  if (event.kind === 'error') run.errored = true;
  if (event.kind === 'text' && String(event.text ?? '').trim()) run.texts++;
  const time = Date.now();
  await updateChat(run.site, (chat) => {
    if (chat.run?.runId !== runId) return false; // the chat was cleared meanwhile
    const push = (role, text) => chat.messages.push({ role, text: String(text), time });
    switch (event.kind) {
      case 'session':
        if (event.sessionId) { chat.sessionId = String(event.sessionId); chat.agent = run.agent ?? chat.agent ?? null; }
        break;
      case 'text':
        if (String(event.text ?? '').trim()) push('assistant', event.text);
        break;
      case 'tool':
        push('tool', toolLine(event.name, event.summary));
        break;
      case 'error':
        push('error', event.message || 'Something went wrong.');
        break;
      case 'done': {
        if (event.sessionId) { chat.sessionId = String(event.sessionId); chat.agent = run.agent ?? chat.agent ?? null; }
        if (event.ok && !run.texts && String(event.result ?? '').trim()) push('assistant', event.result);
        if (!event.ok && !run.errored) {
          if (run.stopping) push('tool', 'stopped');
          else push('error', String(event.result ?? '').trim() || 'The agent stopped without finishing.');
        }
        for (const h of Array.isArray(event.held) ? event.held : []) {
          push('error', `${h.id} is on hold: ${h.reason}. It won't run until you allow it (in Mods above).`);
        }
        chat.last = {
          runId, ok: !!event.ok, time,
          changedFiles: Array.isArray(event.changedFiles) ? event.changedFiles : [],
          costUsd: typeof event.costUsd === 'number' ? event.costUsd : null,
        };
        chat.run = null;
        break;
      }
      default:
        return false;
    }
  });
  if (event.kind === 'done') notifyPanels();
}

// ---- chat storage -------------------------------------------------------------------------------

const chatKey = (site) => `chat:${site}`;
const chatQueues = new Map();

function emptyChat() {
  return { sessionId: null, agent: null, messages: [], run: null, last: null };
}

/** Run `fn` after earlier chat updates for the same site (read-modify-write must not interleave). */
function chatSerial(site, fn) {
  const p = (chatQueues.get(site) || Promise.resolve()).then(fn);
  const tail = p.catch(() => {});
  chatQueues.set(site, tail);
  tail.then(() => { if (chatQueues.get(site) === tail) chatQueues.delete(site); });
  return p;
}

/** Read chat:<site>, let `fn` mutate it (return false to skip writing), write it back. */
function updateChat(site, fn) {
  return chatSerial(site, async () => {
    const key = chatKey(site);
    const stored = (await chrome.storage.local.get(key))[key];
    const chat = { ...emptyChat(), ...(stored && typeof stored === 'object' ? stored : {}) };
    if (!Array.isArray(chat.messages)) chat.messages = [];
    if (fn(chat) === false) return chat;
    if (chat.messages.length > CHAT_MAX) chat.messages = chat.messages.slice(-CHAT_MAX);
    await chrome.storage.local.set({ [key]: chat });
    return chat;
  });
}

/** On service worker start no run can be live: mark runs left in storage as interrupted. */
async function cleanStaleRuns(all) {
  const fixes = {};
  for (const [key, chat] of Object.entries(all || {})) {
    if (!key.startsWith('chat:') || !chat?.run) continue;
    const messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
    messages.push({ role: 'error', text: 'Interrupted: WebMods restarted while the agent was working.', time: Date.now() });
    fixes[key] = { ...chat, messages, run: null };
  }
  if (Object.keys(fixes).length) await chrome.storage.local.set(fixes);
}
