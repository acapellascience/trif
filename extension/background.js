// TRIF service worker: talks to the native helper, keeps chrome.userScripts in sync with the mods
// folder, executes page commands from the `trif` CLI, and relays agent runs between the side
// panel and the helper. See docs/PROTOCOL.md.

import {
  SETTINGS_URL, SETUP_COMMAND, USER_SCRIPTS_OFF, FIREFOX, BROWSER, userScriptsAvailable, syncUserScripts, resolveTab, lastFocusedNormalWindow, tabInfo,
  normalizeUrl, normalizeSite, hostMatchesSite, buildRunCode, buildPollCode, parseRunEnvelope, pageGuard,
  firstInjectionResult, withTimeout, filterRequests, nextBackoff, chromeVersion, toolLine,
  normalizeDisabled, modAppliesTo, urlInScope, modInScope, applyStartOff, applyAbsorbed, findRenames, carryRenames, renameInOrder, modSites,
  normalizeOffSites, offSiteName, offOnSite, hostInScope, withOffSites, scopeFor, normalizeSitesOn, siteOnFor, sitesInUse, limitToSites, applyStartSites, switchSite, fromOtherBrowser, timedUserScripts, capChat,
} from './lib.js';
import { runtimeCode } from './runtime.js';
import { sweepPage } from './sweep.js';
import { captureScreenshot, stitchShots, isCopyWindow } from './screenshot.js';

const HOST = 'com.webmods.helper';
const VERSION = chrome.runtime.getManifest().version;
const CHROME = chromeVersion(navigator.userAgent);
// Safari's helper outlives the connection to it (the Safari bridge keeps the host and queues its messages,
// helper/safari-bridge.js): Safari unloads the background when it's idle, and a run goes on meanwhile. So
// there a lost connection or a restarted background doesn't end a run; after reconnecting, the helper says
// which runs are still going (agent.running) and the others are finished.
const PERSISTENT_HOST = !!chrome.runtime.getURL?.('')?.startsWith('safari-web-extension:');
const LOAD_TIMEOUT = 30000;
const NOT_CONNECTED = `The TRIF helper isn't connected. Run \`${SETUP_COMMAND}\` in a terminal (needs Node 18+), then restart ${BROWSER}.`;

const state = {
  port: null,
  connected: false,      // true once the helper has sent us something on the current port
  connectedAt: 0,
  helperError: null,     // last disconnect reason (shown on the onboarding page)
  update: null,          // the helper's update summary (helper/lib/update.js), for the panel's notice
  backoff: 0,
  retryTimer: null,
  userScripts: null,     // null until first checked
  mods: [],              // last `mods` message (persisted)
  recording: [],         // hostnames being recorded (persisted)
  disabled: {},          // mod id → true for mods the user switched off (persisted as `disabled`)
  offSites: {},          // mod id → sites it's switched off on, for mods on several sites (persisted)
  sitesOn: [],           // registrable domains TRIF is on for; off everywhere else (persisted)
  sitesOffered: [],      // sites the helper said to start on that were turned on once already (persisted)
  startedOff: {},        // mod id → true for mods already switched off once: preinstalled, or from another browser (persisted)
  absorbed: {},          // mod id → true for retired shipped mods whose switch was carried over (persisted)
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

/**
 * Writes to chrome.storage.local, saying what failed if it can't (a full quota rejects every write).
 * Switch state (sitesOn, disabled, offSites, recording) is saved with this *before* it changes in
 * memory: if the write fails, nothing changes, rather than mods running while the panel (which reads
 * storage) says they're off, until the next service worker start puts back what was stored.
 */
//
// Storage that keeps failing for another reason than being full (Safari's "Disk I/O error", seen in pairs
// after many writes) is `broken` after STORAGE_BROKEN_AFTER failures in a row: the panel shows one banner,
// the warning is logged once, and switch changes (`switches: true`) apply in memory for the session
// instead of failing. A write that works again clears it.
const STORAGE_BROKEN_AFTER = 3;
const storageHealth = { failures: 0, broken: false, warned: false };
async function save(items, { switches = false } = {}) {
  try {
    await chrome.storage.local.set(items);
    storageHealth.failures = 0;
    if (storageHealth.broken) { storageHealth.broken = false; notifyPanels(); }
  } catch (e) {
    if (!/quota/i.test(errMsg(e))) {
      storageHealth.failures++;
      if (storageHealth.failures >= STORAGE_BROKEN_AFTER && !storageHealth.broken) {
        storageHealth.broken = true;
        if (!storageHealth.warned) {
          storageHealth.warned = true;
          log('warn', `${BROWSER}'s extension storage keeps failing (${errMsg(e)}): switch changes last until ${BROWSER} quits`);
        }
        notifyPanels();
      }
      if (storageHealth.broken && switches) return; // kept in memory (the caller changes state after this)
    }
    throw new Error(`couldn't save to ${BROWSER}'s extension storage (${errMsg(e)}); nothing was changed`);
  }
}

// What last went into storage as `mods`, so the same list isn't written again on every sync.
let savedModsJson = null;

// `applied` (script id → hash last registered: a shortcut for the next sync) lives in session storage,
// which outlasts a restarted worker but not the browser, and isn't worth a write to local storage on
// every sync. Without session storage, in memory: the next worker re-registers everything.
const sessionStore = chrome.storage?.session;
function saveApplied(applied) {
  sessionStore?.set({ applied }).catch?.(() => {});
}

// ---- startup ------------------------------------------------------------------------------------

const ready = chrome.storage.local.get(null).then(async (s) => {
  if (Array.isArray(s.mods)) state.mods = s.mods;
  if (Array.isArray(s.recording)) state.recording = s.recording;
  state.disabled = normalizeDisabled(s.disabled);
  state.offSites = normalizeOffSites(s.offSites);
  state.startedOff = normalizeDisabled(s.startedOff);
  state.absorbed = normalizeDisabled(s.absorbed);
  state.sitesOffered = normalizeSitesOn(s.sitesOffered);
  if (Array.isArray(s.sitesOn)) state.sitesOn = normalizeSitesOn(s.sitesOn);
  else {
    // First start since TRIF has to be turned on per site: keep it on where it's already in use.
    const chats = Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('chat:')).map(([k, v]) => [k.slice(5), v]));
    state.sitesOn = sitesInUse(state.mods, state.disabled, chats);
    await save({ sitesOn: state.sitesOn }).catch((e) => console.warn('[TRIF]', errMsg(e)));
  }
  state.installId = typeof s.installId === 'string' && s.installId ? s.installId : crypto.randomUUID();
  if (state.installId !== s.installId) await save({ installId: state.installId }).catch((e) => console.warn('[TRIF]', errMsg(e)));
  savedModsJson = Array.isArray(s.mods) ? JSON.stringify(s.mods) : null;
  try {
    const sess = sessionStore ? await sessionStore.get('applied') : {};
    if (sess && sess.applied && typeof sess.applied === 'object') state.applied = sess.applied;
  } catch { /* no session storage: re-register everything */ }
  // (Kept in local storage before 0.2.0.)
  if ('applied' in s) chrome.storage.local.remove('applied').catch(() => {});
  await cleanStaleRuns(s);
}).catch((e) => console.error('[TRIF] failed to read storage', e));

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
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })?.catch?.((e) => console.warn('[TRIF] setPanelBehavior failed', e));
  } catch (e) {
    console.warn('[TRIF] setPanelBehavior failed', e);
  }
}

ready.then(() => {
  checkUserScripts();
  serial(applyMods).catch(() => {}); // re-apply persisted mods without waiting for the helper
  connect();
  closeLeftoverProbes();
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
    // A fresh hello keeps the helper's view of the switch (shown by `trif doctor`) current.
    post({ type: 'hello', version: VERSION, userScripts: now, chrome: CHROME, browser: BROWSER, installId: state.installId });
    if (now) serial(applyMods).then(reportApplied, () => {});
    notifyPanels();
  }
  return now;
}

const isEnabled = (id) => state.disabled[id] !== true;

async function applyMods() {
  try { return await applyModsNow(); } finally { chrome.userScripts?.markSynced?.(); } // (Safari's stand-in: safari.js)
}

async function applyModsNow() {
  if (!checkUserScripts()) {
    state.lastApply = { registered: [], errors: state.mods.filter((m) => isEnabled(m.id)).map((m) => ({ id: m.id, error: USER_SCRIPTS_OFF })) };
    return state.lastApply;
  }
  try {
    const res = await syncUserScripts(timedUserScripts(chrome.userScripts), {
      mods: state.mods, runtimeCode: runtimeCode(state.recording), applied: state.applied, disabled: state.disabled,
      offSites: state.offSites, recording: state.recording, sitesOn: state.sitesOn,
    });
    state.applied = res.applied;
    state.lastApply = { registered: res.registered, errors: res.errors };
    // Only a shortcut for the next sync (unsaved, the next worker re-registers everything).
    saveApplied(state.applied);
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
    if (!state.connected) { state.connected = true; state.connectedAt = Date.now(); state.helperError = null; notifyPanels(); settleOrphans(); }
    checkUserScripts();
    onHelperMessage(msg).catch((e) => log('error', `handling ${msg?.type}: ${errMsg(e)}`));
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'the helper exited';
    console.warn('[TRIF] helper disconnected:', reason);
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
  try { state.port.postMessage(msg); } catch (e) { console.warn('[TRIF] postMessage failed', e); }
}

function log(level, message) {
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[TRIF]', message);
  post({ type: 'log', level, message });
}

// Commands that load a page: they wait for the mods the helper sent before them to be registered, so a
// mod written just before (an agent's write, then `trif reload`) runs on the page they load.
const LOADS_PAGE = new Set(['reload', 'navigate', 'open']);
let modsApplied = Promise.resolve(); // the last mods message, until it's applied

async function onHelperMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'mods') {
    const applying = onModsMessage(msg);
    modsApplied = applying.catch(() => {});
    return applying;
  }
  if (msg.type === 'request') {
    if (LOADS_PAGE.has(msg.cmd)) await modsApplied;
    try {
      const result = await runCommand(msg.cmd, msg.args || {});
      post({ type: 'response', id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (e) {
      post({ type: 'response', id: msg.id, ok: false, error: errMsg(e) });
    }
    return;
  }
  return onOtherHelperMessage(msg);
}

async function onModsMessage(msg) {
  const before = state.mods;
  state.mods = Array.isArray(msg.mods) ? msg.mods : [];
  // A mod's id is its file name: a file renamed on disk comes back as a new mod. Same code in the same
  // site folder: the same mod, which keeps its switches and its place in the panel (before the first-time
  // switch-offs below, which would otherwise take it for a new one).
  const renames = findRenames(before, state.mods);
  if (renames.length) {
    const moved = carryRenames(renames, { disabled: state.disabled, offSites: state.offSites, startedOff: state.startedOff });
    state.disabled = moved.disabled;
    state.offSites = moved.offSites;
    state.startedOff = moved.startedOff;
    const order = await chrome.storage.local.get('modOrder').then((s) => renameInOrder(s.modOrder, renames), () => ({ changed: false }));
    await save({ disabled: state.disabled, offSites: state.offSites, startedOff: state.startedOff, ...(order.changed ? { modOrder: order.modOrder } : {}) })
      .catch((e) => log('warn', errMsg(e)));
    log('info', `renamed: ${renames.map((r) => `${r.from} -> ${r.to}`).join(', ')} (switches kept)`);
  }
  // Preinstalled mods, and mods made from another browser, arrive switched off the first time (before
  // they're ever registered).
  // These two take effect even if they can't be saved: then they're applied again, the same way, on
  // the next start (startedOff and sitesOffered weren't saved either), so memory and storage agree in
  // effect. And a failed write mustn't stop the mods from being applied.
  const off = applyStartOff(state.mods, state.disabled, state.startedOff, state.installId);
  if (off.changed) {
    state.disabled = off.disabled;
    state.startedOff = off.startedOff;
    await save({ disabled: state.disabled, startedOff: state.startedOff }).catch((e) => log('warn', errMsg(e)));
  }
  // Sites setup starts TRIF on for (the preinstalled mods' sites), each turned on once.
  const sites = applyStartSites(state.sitesOn, state.sitesOffered, msg.sitesOn);
  if (sites.changed) {
    state.sitesOn = sites.sitesOn;
    state.sitesOffered = sites.offered;
    await save({ sitesOn: state.sitesOn, sitesOffered: state.sitesOffered }).catch((e) => log('warn', errMsg(e)));
    notifyPanels();
  }
  // A shipped mod folded into another one hands that one its switch, once (on if either was on).
  const ab = applyAbsorbed(state.mods, state.disabled, state.offSites, state.absorbed);
  if (ab.changed) {
    state.disabled = ab.disabled;
    state.offSites = ab.offSites;
    state.absorbed = ab.absorbed;
    await save({ disabled: state.disabled, offSites: state.offSites, absorbed: state.absorbed }).catch((e) => log('warn', errMsg(e)));
  }
  const modsJson = JSON.stringify(state.mods);
  if (modsJson !== savedModsJson) {
    await save({ mods: state.mods }).then(() => { savedModsJson = modsJson; }, (e) => log('warn', errMsg(e)));
  }
  reportApplied(await serial(applyMods));
}

async function onOtherHelperMessage(msg) {
  if (msg.type === 'response') {
    const p = state.pending.get(msg.id);
    if (!p) return;
    state.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'the helper reported an error'));
  } else if (msg.type === 'agentEvent') {
    await onAgentEvent(msg.runId, msg.event);
  } else if (msg.type === 'update') {
    state.update = msg.update && typeof msg.update === 'object' ? msg.update : null;
    notifyPanels();
  } else if (msg.type === 'updated') {
    // Shown by the panel after the reload that follows ("TRIF updated to …").
    await chrome.storage.local.set({ updated: { from: String(msg.from ?? ''), to: String(msg.to ?? ''), notes: String(msg.notes ?? ''), at: Date.now() } });
  } else if (msg.type === 'reload') {
    // The helper installed a new version (or found one installed): reload onto it. Chrome reads the
    // unpacked extension's files again; either browser starts the new helper on reconnect.
    console.log('[TRIF] reloading:', msg.reason);
    setTimeout(() => chrome.runtime.reload(), 100);
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
    p.reject(new Error(`the TRIF helper disconnected (${reason})`));
    state.pending.delete(id);
  }
  for (const runId of [...state.runs.keys()]) {
    if (PERSISTENT_HOST) { state.runs.get(runId).orphan = true; continue; } // settled on reconnecting (settleOrphans)
    onAgentEvent(runId, { kind: 'error', message: `The TRIF helper disconnected while the agent was working (${reason}).` });
    onAgentEvent(runId, { kind: 'done', ok: false, result: '', costUsd: null, changedFiles: [], sessionId: null });
  }
  for (const loginId of [...state.logins]) {
    onAgentEvent(loginId, { kind: 'error', message: `The TRIF helper disconnected during the login (${reason}).` });
    onAgentEvent(loginId, { kind: 'done', ok: false, login: true });
  }
  notifyPanels();
}

// ---- page commands ------------------------------------------------------------------------------

// A side-panel agent run's requests carry args.scope (the helper sets it from the run's token): they
// may only touch tabs and URLs on that site. See docs/PROTOCOL.md "Run scope". And no request, from a
// run or a terminal, touches a site TRIF is off for (see "sites TRIF is on for" in lib.js).
function checkScopeUrl(url, scope, what) {
  if (scope && !urlInScope(url, scope)) {
    throw new Error(`${what} is on ${hostOf(url) || url || 'a page'}, and this agent run is limited to ${scope}` +
      ' (it was started from the side panel on that site; the user can start another chat on the other site)');
  }
  if (!siteOnFor(url, state.sitesOn)) {
    const host = hostOf(url);
    throw new Error(host && /^https?:/.test(url)
      ? `TRIF is off on ${scopeFor(host)}: nothing from TRIF runs there or reads it until the user turns it on (the side panel on that site has the switch)`
      : `${what} isn't a web page (${url || 'no URL'}); TRIF only works on http and https pages`);
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
  async status(args) {
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
        if (!limitToSites(m, state.sitesOn)) o.sitesOff = true; // every site it's for is off
        if (m.held) o.held = m.held;
        if (errors.has(m.id) && errors.get(m.id) !== USER_SCRIPTS_OFF) o.error = errors.get(m.id);
        return o;
      }),
      recording: state.recording, sitesOn: state.sitesOn,
      ...(args && (args.tab !== undefined || args.url !== undefined) ? { page: await modsOnPage(args) } : {}),
    };
  },

  async tabs(args) {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
    return tabs.filter((t) => {
      const url = t.url || t.pendingUrl || '';
      return (!args.scope || urlInScope(url, args.scope)) && siteOnFor(url, state.sitesOn);
    }).map(tabInfo);
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
      let out = await execute(buildRunCode(args.code, !!args.expression, runId, { scope: args.scope || null, sitesOn: state.sitesOn }));
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
      const win = await lastFocusedNormalWindow(chrome);
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
    }, [], args);
  },

  // Every instance of a kind of thing (extension/sweep.js), in the isolated world like `text`: works with
  // user scripts off, and page globals can't fool it.
  async sweep(args) {
    const tab = await scopedTab(args);
    // --scroll scrolls the tab itself: not the one the user is looking at, unless forced.
    if (args.scroll && !args.force && tab.active) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win && win.focused && win.state !== 'minimized') {
        throw new Error("--scroll scrolls the tab itself (to the bottom and back), and that's the tab the user is looking at. " +
          'Sweep without --scroll (what has loaded so far), or add --force if scrolling it is fine');
      }
    }
    const opts = {};
    for (const k of ['selector', 'text', 'color', 'tolerance', 'limit', 'budget', 'scroll']) if (args[k] !== undefined) opts[k] = args[k];
    const r = await pageCall(tab.id, 'ISOLATED', sweepPage, [opts], args);
    if (!r || typeof r !== 'object') throw new Error('the sweep returned nothing (the page may have navigated meanwhile)');
    if (r.error) throw new Error(r.error);
    return r;
  },

  // TRIF never switches tabs or focuses windows to capture one: several agents can be working at once
  // while the user browses. A tab that isn't showing is captured by Firefox as it is; Chrome, only with
  // `copy`, captures a fresh copy in a window of its own (extension/screenshot.js), and says so in `note`.
  async screenshot(args) {
    const tab = await scopedTab(args);
    const timeout = Number(args.timeout) > 4000 ? Number(args.timeout) - 3000 : 45000;
    return captureScreenshot(chrome, tab, { full: !!args.full, copy: !!args.copy, force: !!args.force, timeout }, {
      browser: BROWSER,
      pageCall: (tabId, func, a = []) => pageCall(tabId, 'ISOLATED', func, a),
      stitch: stitchShots,
      onProbe: rememberProbe,
      checkUrl: (url) => checkScopeUrl(url, args.scope, 'the copy'),
    });
  },

  // `changed` and `site` let the helper switch recording off again when the agent run that switched it
  // on ends (host.js). Switching off is allowed on a site TRIF is off for: it only records less.
  async record(args) {
    const site = normalizeSite(args.site);
    const on = !(args.on === false || args.on === 'off');
    if (on || args.scope) checkScopeUrl(`https://${site}/`, args.scope, site);
    const set = new Set(state.recording);
    const was = set.has(site);
    if (on) set.add(site); else set.delete(site);
    const recording = [...set].sort();
    if (was !== on) {
      await save({ recording }, { switches: true });
      state.recording = recording;
      if (checkUserScripts()) reportApplied(await serial(applyMods));
    }
    return { recording: state.recording, site, changed: was !== on };
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
    }, [], args);
    if (!r) throw new Error(state.recording.some((s) => hostMatchesSite(hostOf(tab.url || ''), s)) ? noRuntime() : notRecording(hostOf(tab.url || '')));
    if (!r.recording) throw new Error(notRecording(r.host));
    return filterRequests(r.entries, args);
  },

  async request(args) {
    requireUserScripts();
    const i = Number(args.i);
    if (!Number.isInteger(i)) throw new Error('missing request number i (see `trif requests`)');
    const tab = await scopedTab(args);
    const r = await pageCall(tab.id, 'MAIN', (n) => {
      const w = window.__webmods;
      if (!w || !Array.isArray(w.requests)) return { missing: true };
      const e = w.requests.find((x) => x.i === n);
      return { recording: !!w.recording, host: location.hostname, entry: e ? { method: e.method, url: e.url, status: e.status, requestBody: e.requestBody, responseText: e.responseText } : null };
    }, [i], args);
    if (r.missing) throw new Error(noRuntime());
    if (!r.recording) throw new Error(notRecording(r.host));
    if (!r.entry) throw new Error(`no request ${i} in this page (recorded requests reset on every page load; see \`trif requests\`)`);
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
    if (!mod) throw new Error(`no mod ${id} (run \`trif status\` to list mods)`);
    const site = args.site == null || args.site === '' ? null : offSiteName(args.site);
    if (args.site != null && args.site !== '' && !site) throw new Error(`"${args.site}" isn't a site (use a hostname like twitter.com)`);
    if (args.scope && !(site ? hostInScope(site, args.scope) : modInScope(mod, args.scope))) {
      throw new Error(`${site ? `${site} is` : `${id} runs`} outside ${args.scope}, and this agent run is limited to ${args.scope}`);
    }
    // Switching a mod that's off on "for this site" turns an all-sites mod on everywhere (switchSite):
    // from a run limited to one site, that's the user's call.
    if (args.scope && args.enabled && !isEnabled(id) && !modInScope(mod, args.scope) && modSites(mod).everywhere) {
      throw new Error(`${id} runs on every site, and it's switched off; only the user can switch it on (in the side panel), because this agent run is limited to ${args.scope}`);
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

// `status --url`: the mods that run on a tab's page (on, not held, not off on its site, its site on),
// so an agent can see what its change will meet.
async function modsOnPage(args) {
  const tab = await scopedTab(args);
  const url = tab.url || tab.pendingUrl || '';
  const mods = state.mods.filter((m) => isEnabled(m.id) && !m.held && limitToSites(m, state.sitesOn) && modAppliesTo(withOffSites(m, state.offSites[m.id]), url));
  return { tab: tab.id, url, mods: mods.map((m) => ({ id: m.id, name: m.name || m.id, runAt: m.runAt || 'document_start' })) };
}

// Windows a screenshot opened for a copy of a page (extension/screenshot.js), kept in local storage (it
// survives the browser quitting or crashing mid-capture, when a restored copy window would stay open) as
// {id, urls, bounds, at}, and closed on the next start: by id, or after a restart (new ids) the window with
// one tab at one of those URLs at those bounds (isCopyWindow). Forgotten after a day.
const COPY_WINDOWS_KEY = 'copyWindows';
const COPY_WINDOW_KEEP_MS = 24 * 60 * 60 * 1000;
let copyWindowsChain = Promise.resolve();
function rememberProbe(windowId, open, info = {}) {
  copyWindowsChain = copyWindowsChain.then(async () => {
    const list = (await chrome.storage.local.get(COPY_WINDOWS_KEY))[COPY_WINDOWS_KEY] || [];
    const rest = list.filter((r) => r && r.id !== windowId);
    const next = open ? [...rest, { id: windowId, urls: info.urls || [], bounds: info.bounds || {}, at: Date.now() }] : rest;
    if (next.length) await chrome.storage.local.set({ [COPY_WINDOWS_KEY]: next });
    else await chrome.storage.local.remove(COPY_WINDOWS_KEY);
  }).catch(() => { /* storage unavailable: nothing to close next time */ });
  return copyWindowsChain;
}

async function closeLeftoverProbes() {
  try {
    const list = ((await chrome.storage.local.get(COPY_WINDOWS_KEY))[COPY_WINDOWS_KEY] || []).filter((r) => r && Date.now() - (r.at || 0) < COPY_WINDOW_KEEP_MS);
    if (!list.length) { await chrome.storage.local.remove(COPY_WINDOWS_KEY); return; }
    const wins = await chrome.windows.getAll({ populate: true });
    const left = [];
    for (const rec of list) {
      const win = wins.find((w) => w.id === rec.id && isCopyWindow(w, rec)) || wins.find((w) => isCopyWindow(w, rec));
      if (win) await chrome.windows.remove(win.id).catch(() => {});
      else if (Date.now() - (rec.at || 0) < 60 * 1000) left.push(rec); // (still being restored, perhaps)
    }
    if (left.length) await chrome.storage.local.set({ [COPY_WINDOWS_KEY]: left });
    else await chrome.storage.local.remove(COPY_WINDOWS_KEY);
  } catch { /* nothing to close */ }
}

async function setSwitchState(id, { disabled, offSites }) {
  const next = { ...state.disabled };
  if (disabled) next[id] = true; else delete next[id];
  const nextOff = { ...state.offSites };
  if (offSites.length) nextOff[id] = offSites; else delete nextOff[id];
  await save({ disabled: next, offSites: nextOff }, { switches: true });
  state.disabled = next;
  state.offSites = nextOff;
}

/** After a switch: reload the selected (or active) tab if `mod` runs on it. Returns the tab id or null; never throws. */
// With onlyIfRunning, only when the mod runs on the tab's page: not switched off (everywhere or on that
// site) and not held. Deleting or restoring a mod that's off changes nothing on the page.
async function reloadIfApplies(mod, args, { onlyIfRunning = false } = {}) {
  try {
    const tab = await scopedTab(args);
    const url = tab.url || tab.pendingUrl || '';
    if (!modAppliesTo(mod, url)) return null;
    if (onlyIfRunning && (!isEnabled(mod.id) || mod.held || offOnSite(state.offSites, mod.id, new URL(url).hostname))) return null;
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
  }, [key], args);
  if (list) return list;
  // The runtime only runs where a mod that's on does (or on a recorded site): no such mod, nothing to report.
  const url = tab.url || tab.pendingUrl || '';
  if (!state.mods.some((m) => isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, state.offSites[m.id]), url))) return [];
  throw new Error(noRuntime());
}

function noRuntime() {
  return 'the TRIF runtime is not running in this tab (the page was loaded before TRIF was ready, or it is a page extensions cannot access). Reload the tab and try again.';
}

function notRecording(host) {
  const site = state.recording.find((s) => hostMatchesSite(host, s));
  return site
    ? `recording of ${site} was turned on after this page loaded: reload the tab (\`trif reload\`) and try again.`
    : `not recording ${host}. Run \`trif record ${host} on\`, then reload the tab.`;
}

/** Run `func` in the tab's top frame with chrome.scripting and return its (JSON-able) result. */
async function pageCall(tabId, world, func, args = [], guard = null) {
  if (!guard) return rawPageCall(tabId, world, func, args);
  // guard {scope}: the tab was checked (scopedTab), but it may have gone elsewhere since. So the document
  // is checked again from inside (pageGuard: the run's scope, TRIF on there) and marked, the command runs,
  // and its result counts only if the mark is still there (the same document).
  const token = crypto.randomUUID();
  const why = await rawPageCall(tabId, 'ISOLATED', pageGuard, [guard.scope || null, state.sitesOn, token]);
  if (why) throw new Error(why);
  const result = await rawPageCall(tabId, world, func, args);
  const same = await rawPageCall(tabId, 'ISOLATED', (t) => window.__trifPageGuard === t, [token]).catch(() => false);
  if (!same) throw new Error('the tab went to another page while TRIF was working in it; try again');
  return result;
}

async function rawPageCall(tabId, world, func, args = []) {
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
  const live = new Map(s.mods.map((m) => [m.id, m])); // (by id: never another mod's state)
  return {
    helper: { connected: state.connected, error: state.connected ? null : state.helperError },
    userScripts: s.userScripts, settingsUrl: SETTINGS_URL, version: VERSION, chrome: CHROME, browser: BROWSER,
    recording: s.recording, sitesOn: state.sitesOn, update: state.connected ? state.update : null,
    mods: state.mods.map((m) => ({
      id: m.id, name: m.name || m.id, description: m.description || '', site: m.site, file: m.file || '',
      matches: m.matches || [], excludes: m.excludes || [], registered: !!live.get(m.id)?.registered, enabled: live.get(m.id)?.enabled ?? isEnabled(m.id),
      error: errors.get(m.id) === USER_SCRIPTS_OFF ? null : errors.get(m.id) || null,
      held: m.held || null, risk: m.risk || null,
      from: fromOtherBrowser(m, state.installId) ? (m.origin.browser || 'another browser') : null,
      source: m.source || null, version: m.version || null, update: m.update || null,
    })),
    runs: [...state.runs.values()].map((r) => ({ runId: r.runId, site: r.site })),
    // Storage stopped working: the panel can't read switches from it, so they come from here.
    ...(storageHealth.broken ? { storageBroken: true, disabled: state.disabled, offSites: state.offSites } : {}),
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

// The listed string fields of a panel message (open model settings), nothing else.
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (typeof obj[k] === 'string') out[k] = obj[k];
  return out;
}

async function onPanelMessage(msg) {
  switch (msg?.type) {
    case 'status': return uiStatus();
    case 'agent.list': return helperRequest('agent.list', {}, 20000);
    case 'agent.models': return helperRequest('agent.models', { agent: String(msg.agent ?? ''), fresh: !!msg.fresh }, 30000);
    case 'agent.openModel': return helperRequest('agent.openModel', {}, 20000);
    case 'agent.openModel.set': return helperRequest('agent.openModel.set', pick(msg, ['provider', 'model', 'baseUrl']), 10000);
    // The API key goes straight to the helper (which keeps it in the system keyring): never stored or logged here.
    case 'agent.openModel.setKey': return helperRequest('agent.openModel.setKey', pick(msg, ['key']), 60000);
    case 'agent.openModel.removeKey': return helperRequest('agent.openModel.removeKey', {}, 60000);
    case 'instructions.get': return helperRequest('instructions.get', {}, 10000);
    case 'instructions.set': return helperRequest('instructions.set', { text: String(msg.text ?? '') }, 10000);
    case 'agent.start': return startAgent(msg);
    case 'agent.stop': return stopAgent(msg.runId);
    case 'agent.login': return startLogin(msg);
    case 'agent.loginCode': return helperRequest('agent.loginCode', { loginId: String(msg.loginId ?? ''), code: String(msg.code ?? '') }, 10000);
    case 'agent.loginCancel': return helperRequest('agent.loginCancel', { loginId: String(msg.loginId ?? '') }, 10000);
    case 'chat.clear': return clearChat(msg.site);
    case 'site.set': return setSiteOn(msg);
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
    // From the panel's trash icon and the Undo on the chat line that follows it. The mod stops (or starts)
    // running once the helper re-sends the mods; the tab is reloaded if it runs there.
    case 'mod.delete': {
      const mod = state.mods.find((m) => m.id === msg.id);
      const r = await helperRequest('mod.delete', { id: String(msg.id ?? '') }, 10000);
      if (msg.site) {
        await updateChat(normalizeSite(msg.site), (chat) => {
          chat.messages.push({ role: 'mod', text: `${modFileName(r.id)} was deleted.`, undo: r.id, time: Date.now() });
        });
      }
      if (mod && msg.tab !== undefined) { await serial(() => {}); await reloadIfApplies(mod, { tab: msg.tab }, { onlyIfRunning: true }); }
      return r;
    }
    case 'mod.restore': {
      const r = await helperRequest('mod.restore', { id: String(msg.id ?? '') }, 10000);
      if (msg.site) {
        await updateChat(normalizeSite(msg.site), (chat) => {
          const line = chat.messages.findLast((m) => m.undo === r.id && !m.undone);
          if (line) line.undone = true;
          chat.messages.push({ role: 'mod', text: `${modFileName(r.id)} was restored (${switchState(r.id)}, as before).`, time: Date.now() });
        });
      }
      await serial(() => {});
      const mod = state.mods.find((m) => m.id === r.id);
      if (mod && msg.tab !== undefined) await reloadIfApplies(mod, { tab: msg.tab }, { onlyIfRunning: true });
      return r;
    }
    // A new version of a shipped mod the user changed: "Use the new version" (theirs goes to the trash, with
    // an Undo on the chat line, as for a delete) or "Keep mine". "Merge with my agent" is an agent.start.
    case 'mod.update': {
      const choice = msg.choice === 'new' ? 'new' : 'mine';
      const r = await helperRequest('mod.update', { id: String(msg.id ?? ''), choice }, 10000);
      if (choice === 'new' && msg.site) {
        await updateChat(normalizeSite(msg.site), (chat) => {
          chat.messages.push({
            role: 'mod', time: Date.now(), ...(r.trashed ? { undo: r.id } : {}),
            text: `${modFileName(r.id)} is now ${r.version ? `version ${r.version}` : 'the new version'} from TRIF${r.trashed ? '; yours is in the trash.' : '.'}`,
          });
        });
      }
      if (choice === 'new' && msg.tab !== undefined) {
        await serial(() => {});
        const mod = state.mods.find((m) => m.id === r.id);
        if (mod) await reloadIfApplies(mod, { tab: msg.tab }, { onlyIfRunning: true });
      }
      return r;
    }
    case 'update.check': return helperRequest('update.check', { force: true }, 60000);
    case 'update.install': return helperRequest('update.install', {}, 180000);
    case 'update.setAuto': return helperRequest('update.setAuto', { on: !!msg.on }, 10000);
    case 'update.dismiss': return chrome.storage.local.remove('updated');
    case 'report.build': {
      const mods = (Array.isArray(msg.mods) ? msg.mods : []).slice(0, 40).map((m) => ({
        id: String(m?.id ?? ''), enabled: m?.enabled !== false, registered: !!m?.registered, error: m?.error ? String(m.error) : null,
      }));
      return helperRequest('report.build', { site: String(msg.site ?? ''), siteOn: !!msg.siteOn, mods }, 60000);
    }
    default: return onPageMessage(msg);
  }
}

async function startAgent(msg) {
  const site = normalizeSite(msg.site);
  const prompt = String(msg.prompt ?? '').trim();
  if (!prompt) throw new Error('empty message');
  if (!siteOnFor(`https://${site}/`, state.sitesOn)) throw new Error(`TRIF is off on ${scopeFor(site)}: turn it on first`);
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
  if (msg.openModel && typeof msg.openModel === 'object') args.openModel = pick(msg.openModel, ['provider', 'model', 'baseUrl']); // a chat's own open-model choice
  if (msg.merge) args.merge = String(msg.merge); // merge the new version of this shipped mod (the helper adds how)
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

// The panel's switch for the site it's showing (the registrable domain: x.com covers m.x.com). Off stops
// everything there: its mods, chats in progress, and page commands. Mod switches are kept for next time.
async function setSiteOn(msg) {
  const site = scopeFor(normalizeSite(msg.site));
  if (!site) throw new Error('missing site');
  const on = msg.on !== false;
  const set = new Set(state.sitesOn);
  if (on) set.add(site); else set.delete(site);
  const sitesOn = [...set].sort();
  await save({ sitesOn }, { switches: true });
  state.sitesOn = sitesOn;
  if (!on) {
    for (const r of state.runs.values()) {
      if (hostInScope(r.site, site)) { r.stopping = true; helperRequest('agent.stop', { runId: r.runId }, 10000).catch(() => {}); }
    }
  }
  // Reload the tab if a mod starts or stops running on it.
  const tab = msg.tab !== undefined ? await chrome.tabs.get(msg.tab).catch(() => null) : null;
  const url = tab ? tab.url || tab.pendingUrl || '' : '';
  const runsThere = url && state.mods.some((m) => isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, state.offSites[m.id]), url));
  if (checkUserScripts()) reportApplied(await serial(applyMods));
  if (runsThere) await chrome.tabs.reload(tab.id).catch(() => {});
  notifyPanels();
  return { site, on, sitesOn: state.sitesOn };
}

async function clearChat(site) {
  const s = normalizeSite(site);
  for (const r of state.runs.values()) {
    if (r.site === s) { r.stopping = true; helperRequest('agent.stop', { runId: r.runId }, 10000).catch(() => {}); }
  }
  await chatSerial(s, () => {
    const p = pendingChats.get(s);
    if (p) { clearTimeout(p.timer); pendingChats.delete(s); }
    return chrome.storage.local.remove(chatKey(s));
  });
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
  }, { batch: event.kind !== 'done' });
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
const modFileName = (id) => `${String(id).split('/').pop()}.js`;

// A mod's switches in words: "on", "off", "on except on bank.com".
function switchState(id) {
  if (!isEnabled(id)) return 'off';
  const off = state.offSites[id];
  return Array.isArray(off) && off.length ? `on except on ${off.join(', ')}` : 'on';
}

// While a run is going, its events change the chat many times a second; each change written at once
// rewrote the whole chat record every time (and Safari's storage gave out under that). So `batch` changes
// are kept in memory (pendingChats) and written CHAT_BATCH_MS later, together; any other change, a run's
// `done` included, writes at once, with whatever was waiting.
const CHAT_BATCH_MS = 500;
const pendingChats = new Map(); // site -> {chat, timer}

function flushChat(site) {
  return chatSerial(site, async () => {
    const p = pendingChats.get(site);
    if (!p) return;
    pendingChats.delete(site);
    clearTimeout(p.timer);
    await save({ [chatKey(site)]: p.chat }).catch((e) => log('warn', errMsg(e)));
  });
}

function updateChat(site, fn, { batch = false } = {}) {
  return chatSerial(site, async () => {
    const key = chatKey(site);
    const waiting = pendingChats.get(site);
    const stored = waiting ? waiting.chat : (await chrome.storage.local.get(key))[key];
    const chat = { ...emptyChat(), ...(stored && typeof stored === 'object' ? stored : {}) };
    if (!Array.isArray(chat.messages)) chat.messages = [];
    if (fn(chat) === false) return chat;
    capChat(chat);
    if (batch) {
      if (waiting) waiting.chat = chat;
      else pendingChats.set(site, { chat, timer: setTimeout(() => flushChat(site), CHAT_BATCH_MS) });
      return chat;
    }
    if (waiting) { clearTimeout(waiting.timer); pendingChats.delete(site); }
    await save({ [key]: chat });
    return chat;
  });
}

/**
 * Runs that were going when the connection was lost (or the background restarted), on a helper that
 * outlives it: ask which are still going, finish the rest. A helper without agent.running finishes them all.
 */
async function settleOrphans() {
  const orphans = [...state.runs.values()].filter((r) => r.orphan);
  if (!orphans.length) return;
  let live;
  try { live = new Set((await helperRequest('agent.running', {}, 10000))?.runIds || []); } catch { live = new Set(); }
  for (const r of orphans) {
    if (state.runs.get(r.runId) !== r) continue; // its done arrived meanwhile (queued by the bridge)
    if (live.has(r.runId)) { r.orphan = false; continue; }
    onAgentEvent(r.runId, { kind: 'error', message: 'The agent stopped while TRIF was away (the helper restarted, or the run ended and its last messages were lost).' });
    onAgentEvent(r.runId, { kind: 'done', ok: false, result: '', costUsd: null, changedFiles: [], sessionId: null });
  }
}

/**
 * On service worker start no run can be live here: mark runs left in storage as interrupted. Except with a
 * helper that outlives the background (PERSISTENT_HOST, Safari): there a started run is taken up again,
 * and settled once the helper answers (settleOrphans).
 */
async function cleanStaleRuns(all) {
  const fixes = {};
  for (const [key, chat] of Object.entries(all || {})) {
    if (!key.startsWith('chat:') || !chat?.run) continue;
    if (PERSISTENT_HOST && chat.run.runId) {
      state.runs.set(chat.run.runId, { runId: chat.run.runId, site: key.slice(5), agent: chat.agent ?? undefined, tabId: undefined, stopping: false, errored: false, texts: 0, orphan: true });
      continue;
    }
    const messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
    messages.push({ role: 'error', text: 'Interrupted: TRIF restarted while the agent was working.', time: Date.now() });
    fixes[key] = { ...chat, messages, run: null };
  }
  if (Object.keys(fixes).length) await chrome.storage.local.set(fixes);
}
