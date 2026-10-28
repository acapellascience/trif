// WebMods service worker: talks to the native helper, keeps chrome.userScripts in sync with the mods
// folder, and executes page commands from the `webmods` CLI. See docs/PROTOCOL.md.

import {
  SETTINGS_URL, USER_SCRIPTS_OFF, userScriptsAvailable, syncUserScripts, resolveTab, tabInfo,
  normalizeUrl, normalizeSite, hostMatchesSite, buildRunCode, buildPollCode, parseRunEnvelope,
  firstInjectionResult, withTimeout, filterRequests, nextBackoff, chromeVersion,
} from './lib.js';
import { runtimeCode } from './runtime.js';

const HOST = 'com.webmods.helper';
const VERSION = chrome.runtime.getManifest().version;
const CHROME = chromeVersion(navigator.userAgent);
const LOAD_TIMEOUT = 30000;

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
  applied: {},           // script id → hash last registered (persisted)
  lastApply: { registered: [], errors: [] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e) => String(e?.message ?? e);

// ---- startup ------------------------------------------------------------------------------------

const ready = chrome.storage.local.get(['mods', 'recording', 'applied']).then((s) => {
  if (Array.isArray(s.mods)) state.mods = s.mods;
  if (Array.isArray(s.recording)) state.recording = s.recording;
  if (s.applied && typeof s.applied === 'object') state.applied = s.applied;
}).catch((e) => console.error('[webmods] failed to read storage', e));

// Listeners must be registered synchronously at the top level of a service worker.
chrome.runtime.onStartup.addListener(() => { ready.then(() => { checkUserScripts(); connect(); }); });
chrome.runtime.onInstalled.addListener((details) => {
  ready.then(() => serial(applyMods)).catch(() => {});
  if (details.reason === 'install') openOnboarding();
});
chrome.action.onClicked.addListener(() => openOnboarding());
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  ready.then(() => onPageMessage(msg)).then(sendResponse, (e) => sendResponse({ error: errMsg(e) }));
  return true;
});

ready.then(() => {
  checkUserScripts();
  serial(applyMods).catch(() => {}); // re-apply persisted mods without waiting for the helper
  connect();
});

// Mod syncing and recording changes run one at a time.
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
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
    post({ type: 'hello', version: VERSION, userScripts: now, chrome: CHROME });
    if (now) serial(applyMods).then(reportApplied, () => {});
  }
  return now;
}

async function applyMods() {
  if (!checkUserScripts()) {
    state.lastApply = { registered: [], errors: state.mods.map((m) => ({ id: m.id, error: USER_SCRIPTS_OFF })) };
    return state.lastApply;
  }
  try {
    const res = await syncUserScripts(chrome.userScripts, {
      mods: state.mods, runtimeCode: runtimeCode(state.recording), applied: state.applied,
    });
    state.applied = res.applied;
    state.lastApply = { registered: res.registered, errors: res.errors };
    await chrome.storage.local.set({ applied: state.applied });
    for (const e of res.errors) log('error', `mod ${e.id}: ${e.error}`);
  } catch (e) {
    state.applied = {}; // unknown state: force a full re-register next time
    state.lastApply = { registered: [], errors: state.mods.map((m) => ({ id: m.id, error: errMsg(e) })) };
    log('error', `applying mods failed: ${errMsg(e)}`);
  }
  return state.lastApply;
}

function reportApplied(res) {
  post({ type: 'modsApplied', registered: res.registered, errors: res.errors });
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
    if (!state.connected) { state.connected = true; state.connectedAt = Date.now(); state.helperError = null; }
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
    scheduleReconnect();
  });
  post({ type: 'hello', version: VERSION, userScripts: checkUserScripts(), chrome: CHROME });
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
    await chrome.storage.local.set({ mods: state.mods });
    reportApplied(await serial(applyMods));
  } else if (msg.type === 'request') {
    try {
      const result = await runCommand(msg.cmd, msg.args || {});
      post({ type: 'response', id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (e) {
      post({ type: 'response', id: msg.id, ok: false, error: errMsg(e) });
    }
  }
}

// ---- page commands ------------------------------------------------------------------------------

const commands = {
  async status() {
    await serial(() => {}); // let pending mod syncs finish first
    let ids = new Set();
    if (checkUserScripts()) {
      try { ids = new Set((await chrome.userScripts.getScripts()).map((s) => s.id)); } catch { /* switched off meanwhile */ }
    }
    const errors = new Map(state.lastApply.errors.map((e) => [e.id, e.error]));
    return {
      userScripts: state.userScripts, chrome: CHROME, version: VERSION,
      mods: state.mods.map((m) => {
        const o = { id: m.id, registered: ids.has(m.id) };
        if (errors.has(m.id) && errors.get(m.id) !== USER_SCRIPTS_OFF) o.error = errors.get(m.id);
        return o;
      }),
      recording: state.recording,
    };
  },

  async tabs() {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
    return tabs.map(tabInfo);
  },

  async run(args) {
    requireUserScripts();
    if (typeof args.code !== 'string') throw new Error('missing code');
    const tab = await resolveTab(chrome, args);
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
    const tab = await resolveTab(chrome, args);
    return loadAndReport(tab.id, () => chrome.tabs.reload(tab.id, { bypassCache: !!args.hard }));
  },

  async navigate(args) {
    const url = normalizeUrl(args.to);
    const tab = await resolveTab(chrome, args);
    return loadAndReport(tab.id, () => chrome.tabs.update(tab.id, { url }));
  },

  async open(args) {
    const url = normalizeUrl(args.to);
    const waiter = loadWaiter();
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      let tab;
      if (win) {
        tab = await chrome.tabs.create({ url, active: true, windowId: win.id });
      } else {
        tab = (await chrome.windows.create({ url, focused: true })).tabs[0];
      }
      await waiter.wait(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { id: t.id, url: t.url };
    } finally {
      waiter.stop();
    }
  },

  async text(args) {
    const tab = await resolveTab(chrome, args);
    // Isolated world via chrome.scripting: works even when user scripts are off and can't be
    // fooled by page globals.
    return pageCall(tab.id, 'ISOLATED', () => {
      const root = document.body || document.documentElement;
      return { url: location.href, title: document.title, text: String((root && root.innerText) || '').slice(0, 200000) };
    });
  },

  async screenshot(args) {
    const tab = await resolveTab(chrome, args);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(250); // let the newly activated tab paint
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
  },

  async record(args) {
    const site = normalizeSite(args.site);
    const set = new Set(state.recording);
    if (args.on === false || args.on === 'off') set.delete(site); else set.add(site);
    state.recording = [...set].sort();
    await chrome.storage.local.set({ recording: state.recording });
    if (checkUserScripts()) reportApplied(await serial(applyMods));
    return { recording: state.recording };
  },

  async requests(args) {
    requireUserScripts();
    const tab = await resolveTab(chrome, args);
    const r = await pageCall(tab.id, 'MAIN', () => {
      const w = window.__webmods;
      if (!w || !Array.isArray(w.requests)) return null;
      return {
        recording: !!w.recording, host: location.hostname,
        entries: w.requests.map((e) => ({ i: e.i, method: e.method, url: e.url, status: e.status, type: e.type, size: e.size, time: e.time })),
      };
    });
    if (!r) throw new Error(noRuntime());
    if (!r.recording) throw new Error(notRecording(r.host));
    return filterRequests(r.entries, args);
  },

  async request(args) {
    requireUserScripts();
    const i = Number(args.i);
    if (!Number.isInteger(i)) throw new Error('missing request number i (see `webmods requests`)');
    const tab = await resolveTab(chrome, args);
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

  async logs(args) {
    return runtimeList(args, 'logs');
  },
};

async function runCommand(cmd, args) {
  await ready;
  const fn = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
  if (!fn) throw new Error(`unknown command: ${cmd}`);
  return fn(args);
}

async function runtimeList(args, key) {
  requireUserScripts();
  const tab = await resolveTab(chrome, args);
  const list = await pageCall(tab.id, 'MAIN', (k) => {
    const w = window.__webmods;
    return w && Array.isArray(w[k]) ? w[k].slice() : null;
  }, [key]);
  if (!list) throw new Error(noRuntime());
  return list;
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
    case 'status': {
      if (!state.port && !state.retryTimer) connect();
      const s = await commands.status();
      const errors = new Map(state.lastApply.errors.map((e) => [e.id, e.error]));
      return {
        helper: { connected: state.connected, error: state.connected ? null : state.helperError },
        userScripts: s.userScripts, settingsUrl: SETTINGS_URL, version: VERSION, chrome: CHROME,
        recording: s.recording,
        mods: state.mods.map((m, i) => ({
          id: m.id, name: m.name || m.id, description: m.description || '', site: m.site,
          matches: m.matches || [], registered: s.mods[i].registered,
          error: errors.get(m.id) === USER_SCRIPTS_OFF ? null : errors.get(m.id) || null,
        })),
      };
    }
    default:
      throw new Error(`unknown message ${msg?.type}`);
  }
}
