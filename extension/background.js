// TRIF service worker: talks to the native helper, keeps chrome.userScripts in sync with the mods
// folder, executes page commands from the `trif` CLI, and relays agent runs between the side
// panel and the helper. See docs/PROTOCOL.md.

import {
  SETTINGS_URL, SETUP_COMMAND, USER_SCRIPTS_OFF, FIREFOX, BROWSER, userScriptsAvailable, syncUserScripts, resolveTab, lastFocusedNormalWindow, tabInfo,
  normalizeUrl, normalizeSite, hostMatchesSite, buildRunCode, buildPollCode, parseRunEnvelope, pageGuard,
  firstInjectionResult, withTimeout, filterRequests, nextBackoff, chromeVersion, toolLine,
  normalizeDisabled, modAppliesTo, urlInScope, modInScope, applyStartOff, applyAbsorbed, findRenames, carryRenames, renameInOrder, normalizeModOrder, modSites,
  normalizeOffSites, offSiteName, offOnSite, hostInScope, withOffSites, normalizeGroupsOff, switchGroup, offSitesFor, GROUPS, scopeFor, normalizeSitesOn, siteOnFor, sitesInUse, limitToSites, applyStartSites, switchSite, fromOtherBrowser, timedUserScripts, capChat,
  ALL_ACCESS, readAccess, activeSites, hasSiteAccess, siteOrigins, siteState, siteRefusal, siteModeOf,
  FEATURES, ModsParts, fillSameMods, storedMods, modsStorageState, modsStoragePlan, normalizeStarter, applyReadded, normalizeReadded,
  applyNewMods, normalizeStartsOff, normalizeNewOff, MOD_GROUPS, modGroup, sandboxFallback, inSandboxWorld, SAFARI,
} from './lib.js';
import { SANDBOX_WORLD, SANDBOX_CSP, SETTINGS_MAX } from './sandbox.js';
import { runtimeCode } from './runtime.js';
import { sweepPage } from './sweep.js';
import { captureScreenshot, stitchShots, isCopyWindow } from './screenshot.js';
import { createTabLocks } from './tablock.js';

const HOST = 'com.webmods.helper';
const VERSION = chrome.runtime.getManifest().version;
const CHROME = chromeVersion(navigator.userAgent);
// Safari's helper outlives the connection to it (the Safari bridge keeps the host and queues its messages,
// helper/safari-bridge.js): Safari unloads the background when it's idle, and a run goes on meanwhile. So
// there a lost connection or a restarted background doesn't end a run; after reconnecting, the helper says
// which runs are still going (agent.running) and the others are finished.
const PERSISTENT_HOST = !!chrome.runtime.getURL?.('')?.startsWith('safari-web-extension:');
// Whether the browser's OK per site is TRIF's to ask for and check: not in Safari (lib.js SITE_ACCESS, worked
// out here from this background's own URL, as above).
const SITE_ACCESS = !chrome.runtime.getURL?.('')?.startsWith('safari-web-extension:');
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
  groupsOff: {},         // site → groups ('rules', 'sandboxed', 'page') switched off there (persisted; lib.js "Groups")
  sitesOn: [],           // registrable domains TRIF is on for; off everywhere else (persisted)
  sitesOffered: [],      // sites the helper said to start on that were turned on once already (persisted)
  access: ALL_ACCESS,    // what the browser gives TRIF (readAccess): a site in sitesOn counts only with it
  siteMode: null,        // 'permissive' (<all_urls>) or 'restrictive' (per site), as last chosen or seen (persisted)
  blockedSites: [],      // sites the user blocked in TRIF: nothing from TRIF touches them (persisted)
  panelWindows: new Map(), // side panel port -> the window it's in (Chrome), so the toolbar button can close it
  paused: false,         // every mod paused in this browser, each mod's own switch left as it is (persisted)
  startedOff: {},        // mod id → true for mods already switched off once: preinstalled, or from another browser (persisted)
  absorbed: {},          // mod id → true for retired shipped mods whose switch was carried over (persisted)
  readded: {},           // mod id → stamp: Tim's mods deleted and added again, switched as listed once per stamp (persisted)
  startsOff: [],         // groups ('rules', 'sandboxed', 'page') whose new mods start off: Settings' "New mods start" (persisted; lib.js applyNewMods)
  canSandbox: null,      // whether this browser hosts TRIF's sandbox world (sandboxWorld); null until known
  unsandboxedOk: {},     // mod id → hash: sandboxed mods the user allowed to run as page scripts, in a browser without the sandbox (persisted; lib.js sandboxFallback)
  seenMods: null,        // mod id → true for every mod this browser has seen; null: not stored yet (persisted)
  autoUpdated: null,     // mod id → stamp of the last new version of a shipped mod TRIF put in place by itself, once seen (persisted)
  newOff: {},            // mod id → 'new' | 'update': switched off because new mods of its group start off, until switched on (persisted)
  defaultOrder: {},      // site → mod ids: the panel's order for its shipped mods until the user drags them (from the helper; persisted)
  starter: null,         // Tim's mods, site by site, from the helper (helper/lib/preinstalled.js starterOffer): {chosen, sites: [{site, name, choice, suggested, mods}]}
  installId: null,       // random id of this install (persisted): the helper records it as the origin of mods made here
  applied: {},           // script id → hash last registered (persisted)
  known: null,           // the script ids the last sync left registered (syncUserScripts `known`); null: ask the browser
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

// Tabs a side-panel agent ran code in: requests that change things are blocked there until the page is a
// new one (tablock.js, docs/SECURITY.md). The panel shows it, with a Reload button.
const tabLocks = createTabLocks({ chrome, log: (m) => console.log(`[TRIF] ${m}`), changed: () => notifyPanels() });
chrome.tabs.onUpdated?.addListener((tabId, info) => { if (info.status === 'complete' || info.url) tabLocks.check(tabId).catch(() => {}); });
chrome.tabs.onRemoved?.addListener((tabId) => { tabLocks.unlock(tabId, 'closed').catch(() => {}); });
chrome.tabs.onReplaced?.addListener((added, removed) => { tabLocks.unlock(removed, 'replaced').catch(() => {}); tabLocks.check(added).catch(() => {}); });
chrome.tabs.onCreated?.addListener((tab) => { tabLocks.opened(tab).catch(() => {}); });

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

// What storage holds of the mods (lib.js modsStorageState), so only what changed is written.
let storedModsState = { ids: null, keys: new Map(), legacy: false };

// `applied` (script id → hash last registered: a shortcut for the next sync) lives in session storage,
// which outlasts a restarted worker but not the browser, and isn't worth a write to local storage on
// every sync. Without session storage, in memory: the next worker re-registers everything.
const sessionStore = chrome.storage?.session;
function saveApplied(applied) {
  sessionStore?.set({ applied }).catch?.(() => {});
}

// ---- startup ------------------------------------------------------------------------------------

const ready = chrome.storage.local.get(null).then(async (s) => {
  state.mods = storedMods(s);
  if (Array.isArray(s.recording)) state.recording = s.recording;
  state.disabled = normalizeDisabled(s.disabled);
  state.offSites = normalizeOffSites(s.offSites);
  state.groupsOff = normalizeGroupsOff(s.groupsOff);
  state.startedOff = normalizeDisabled(s.startedOff);
  state.absorbed = normalizeDisabled(s.absorbed);
  state.readded = normalizeReadded(s.readded);
  state.startsOff = normalizeStartsOff(s.startsOff);
  state.seenMods = s.seenMods && typeof s.seenMods === 'object' ? normalizeDisabled(s.seenMods) : null;
  state.autoUpdated = s.autoUpdated && typeof s.autoUpdated === 'object' ? normalizeReadded(s.autoUpdated) : null;
  state.newOff = normalizeNewOff(s.newOff);
  state.unsandboxedOk = normalizeReadded(s.unsandboxedOk);
  state.defaultOrder = normalizeModOrder(s.defaultOrder);
  state.sitesOffered = normalizeSitesOn(s.sitesOffered);
  state.siteMode = s.siteMode === 'permissive' || s.siteMode === 'restrictive' ? s.siteMode : null;
  state.blockedSites = normalizeSitesOn(s.blockedSites);
  state.paused = s.paused === true;
  if (Array.isArray(s.sitesOn)) state.sitesOn = normalizeSitesOn(s.sitesOn);
  else {
    // First start since TRIF has to be turned on per site: keep it on where it's already in use.
    const chats = Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('chat:')).map(([k, v]) => [k.slice(5), v]));
    state.sitesOn = sitesInUse(state.mods, state.disabled, chats);
    await save({ sitesOn: state.sitesOn }).catch((e) => console.warn('[TRIF]', errMsg(e)));
  }
  state.installId = typeof s.installId === 'string' && s.installId ? s.installId : crypto.randomUUID();
  if (state.installId !== s.installId) await save({ installId: state.installId }).catch((e) => console.warn('[TRIF]', errMsg(e)));
  storedModsState = modsStorageState(s);
  try {
    const sess = sessionStore ? await sessionStore.get('applied') : {};
    if (sess && sess.applied && typeof sess.applied === 'object') state.applied = sess.applied;
  } catch { /* no session storage: re-register everything */ }
  // (Kept in local storage before 0.2.0.)
  if ('applied' in s) chrome.storage.local.remove('applied').catch(() => {});
  await refreshAccess();
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
  // A locked page back from the back/forward cache (its marker, in our isolated world: tablock.js)
  if (msg?.type === 'tabLock.restored' && sender.tab?.id != null) {
    // (the site from the page's own address, not from the message)
    const url = sender.url || sender.tab.url || '';
    tabLocks.restored(sender.tab.id, msg.token, scopeFor(hostOf(url)), url).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: errMsg(e) }));
    return true;
  }
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
} else if (chrome.sidePanel) {
  // Chrome: the toolbar button opens the side panel from here rather than by itself
  // (openPanelOnActionClick), because only a click that reaches the extension gives it activeTab on that
  // tab, which is what lets `trif screenshot` capture it without access to every site (screenshot.js).
  // A second click closes it again, as Chrome's own handling did. Both calls must come from the click
  // itself, so nothing is awaited before them.
  chrome.action.onClicked.addListener((tab) => {
    const windowId = tab?.windowId;
    const open = [...state.panelWindows.values()].includes(windowId);
    const call = open && chrome.sidePanel.close ? chrome.sidePanel.close({ windowId }) : chrome.sidePanel.open({ windowId });
    call?.catch?.((e) => console.warn('[TRIF] the side panel didn\'t open', e));
  });
}
// Optional permissions: Firefox's userScripts (the setup page or the panel asks for it), and in every
// browser the sites the user lets TRIF work on, which they can also take back in the browser's settings.
if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => ready.then(onPermissionsChanged));
  chrome.permissions.onRemoved.addListener(() => ready.then(onPermissionsChanged));
}

/** The toolbar icon opens the side panel: in Chrome, from action.onClicked above (the setting persists). */
function setPanelBehavior() {
  if (FIREFOX) return;
  try {
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false })?.catch?.((e) => console.warn('[TRIF] setPanelBehavior failed', e));
  } catch (e) {
    console.warn('[TRIF] setPanelBehavior failed', e);
  }
}

// ---- site access --------------------------------------------------------------------------------
// See "site access" in lib.js: the sites TRIF works on are the ones it's on for that the browser gives
// it. Everything that touches a page goes by onSites(), never by sitesOn alone.

const onSites = () => activeSites(state.sitesOn, state.access).filter((s) => !state.blockedSites.includes(s));
const stateOf = (site) => siteState(site, { sitesOn: state.sitesOn, access: state.access, blocked: state.blockedSites });

/** Read what the browser gives TRIF again. Returns whether the sites TRIF works on changed. */
async function refreshAccess() {
  const before = JSON.stringify(onSites());
  try { state.access = await readAccess(chrome, SITE_ACCESS); } catch (e) {
    // The browser keeps enforcing its own access either way; TRIF just can't tell which sites it has.
    console.warn('[TRIF] couldn\'t read the site permissions:', errMsg(e));
    state.access = ALL_ACCESS;
  }
  // The mode follows the grant: <all_urls> is permissive (an update from when it was required too); losing
  // it (the user took it back in the browser's settings) is restrictive.
  const mode = SITE_ACCESS ? siteModeOf(state.siteMode, state.access) : null;
  if (mode && mode !== state.siteMode) {
    state.siteMode = mode;
    await save({ siteMode: mode }).catch((e) => console.warn('[TRIF]', errMsg(e)));
  }
  return JSON.stringify(onSites()) !== before;
}

async function onPermissionsChanged() {
  if (FIREFOX) checkUserScripts();
  if (!(await refreshAccess())) { notifyPanels(); return; }
  // A site taken away stops like a site switched off: its mods, its runs, its page commands.
  for (const r of state.runs.values()) {
    if (!siteOnFor(`https://${r.site}/`, onSites()) && !r.stopping) { r.stopping = true; helperRequest('agent.stop', { runId: r.runId }, 10000).catch(() => {}); }
  }
  if (checkUserScripts()) reportApplied(await serial(applyMods));
  notifyPanels();
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
    // (Firefox drops every user script when its permission goes: the next sync asks what's registered.)
    state.known = null;
    log(now ? 'info' : 'warn', now ? 'user scripts were turned on' : 'user scripts were turned off');
    // A fresh hello keeps the helper's view of the switch (shown by `trif doctor`) current.
    post({ type: 'hello', version: VERSION, userScripts: now, chrome: CHROME, browser: BROWSER, installId: state.installId, features: FEATURES });
    if (now && !SAFARI) state.canSandbox = null; // (TRIF's world configured again: sandboxWorld)
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
  // (sandboxed mods as this browser runs them: lib.js sandboxFallback)
  await sandboxWorld();
  state.mods = sandboxFallback(state.mods, { canSandbox: state.canSandbox !== false, allowed: state.unsandboxedOk });
  if (!checkUserScripts()) {
    state.known = null;
    state.lastApply = { registered: [], errors: state.mods.filter((m) => isEnabled(m.id)).map((m) => ({ id: m.id, error: USER_SCRIPTS_OFF })) };
    return state.lastApply;
  }
  try {
    const res = await syncUserScripts(timedUserScripts(chrome.userScripts), {
      // (paused: as if TRIF were on for no site, so nothing registers; each switch stays as it is)
      mods: state.mods, runtimeCode: runtimeCode(state.recording), applied: state.applied, disabled: state.disabled,
      offSites: state.offSites, groupsOff: state.groupsOff, recording: state.recording, sitesOn: state.paused ? [] : onSites(), known: state.known,
    });
    state.applied = res.applied;
    state.known = res.known;
    state.lastApply = { registered: res.registered, errors: res.errors };
    // Only a shortcut for the next sync (unsaved, the next worker re-registers everything).
    saveApplied(state.applied);
    for (const e of res.errors) log('error', `mod ${e.id}: ${e.error}`);
  } catch (e) {
    state.applied = {}; // unknown state: force a full re-register next time
    state.known = null;
    state.lastApply = { registered: [], errors: state.mods.filter((m) => isEnabled(m.id)).map((m) => ({ id: m.id, error: errMsg(e) })) };
    log('error', `applying mods failed: ${errMsg(e)}`);
  }
  return state.lastApply;
}

// ---- TRIF's sandbox world (sandbox.js) --------------------------------------------------------------
// Configured once per background start (the browser keeps it until the extension updates; configuring again
// is harmless): its own CSP, which lets nothing connect anywhere, and messaging, which only TRIF's own code in
// that world reaches (sandbox.js captures it before any mod runs; mods' compartments never see `chrome`), for
// the mods' settings (onUserScriptMessage, below). Safari has no such world (its userScripts is TRIF's
// adapter, safari.js); a browser whose userScripts has no configureWorld neither: there, sandboxed mods wait
// for the user's OK to run as page scripts (lib.js sandboxFallback).
let sandboxSetup = null;
function sandboxWorld() {
  if (state.canSandbox !== null) return Promise.resolve(state.canSandbox);
  if (sandboxSetup) return sandboxSetup;
  sandboxSetup = (async () => {
    if (SAFARI) { state.canSandbox = false; return false; }
    // (user scripts off: chrome.userScripts isn't usable then, so nothing is known yet; asked again once they're on)
    if (!checkUserScripts()) return null;
    if (typeof chrome.userScripts?.configureWorld !== 'function') { state.canSandbox = false; return false; }
    try {
      await chrome.userScripts.configureWorld({ worldId: SANDBOX_WORLD, csp: SANDBOX_CSP, messaging: true });
      state.canSandbox = true;
    } catch (e) {
      if (!checkUserScripts()) return null; // (switched off meanwhile)
      log('warn', `TRIF's sandbox world: ${errMsg(e)} (sandboxed mods wait for your OK to run as page scripts)`);
      state.canSandbox = false;
    }
    return state.canSandbox;
  })().finally(() => { sandboxSetup = null; });
  return sandboxSetup;
}

// The mods' settings (sandbox.js trif.settings): per mod and per site, in chrome.storage.local
// `sandboxSettings` = {"<mod id>": {"<site>": {"<key>": <JSON text>}}}. The site is the one the sender's page
// is on (the browser says), not what the message says, so a mod can't carry what it read on one site to
// another through its settings; the mod is the one TRIF's code in the world says (mods can't send).
const SETTINGS_SITES_MAX = 200; // sites kept per mod (the oldest written go first)
chrome.runtime.onUserScriptMessage?.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.trifSandbox !== 'string') return false;
  if (sender && sender.userScriptWorldId !== undefined && sender.userScriptWorldId !== SANDBOX_WORLD) return false;
  (async () => {
    await ready;
    let host = '';
    try { host = new URL(sender?.url || sender?.origin || '').hostname; } catch { /* none */ }
    const site = scopeFor(host);
    const mod = String(msg.mod ?? ''), key = String(msg.key ?? '');
    if (!site || !mod || !key || key.length > 100 || !state.mods.some((m) => m.id === mod && m.sandboxed)) return { ok: false, error: 'not a sandboxed mod here' };
    const all = (await chrome.storage.local.get('sandboxSettings')).sandboxSettings;
    const store = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    if (msg.trifSandbox === 'settings.get') {
      const text = store[mod]?.[site]?.[key];
      try { return { ok: true, value: typeof text === 'string' ? JSON.parse(text) : null }; } catch { return { ok: true, value: null }; }
    }
    if (msg.trifSandbox === 'settings.save') {
      const json = String(msg.json ?? '');
      if (json.length > SETTINGS_MAX) return { ok: false, error: `settings can take up to ${SETTINGS_MAX / 1024} KB` };
      try { JSON.parse(json); } catch { return { ok: false, error: 'not JSON' }; }
      const sites = { ...(store[mod] || {}) };
      const here = { ...(sites[site] || {}), [key]: json };
      delete sites[site];
      sites[site] = here; // (last written last)
      const names = Object.keys(sites);
      for (const old of names.slice(0, Math.max(0, names.length - SETTINGS_SITES_MAX))) delete sites[old];
      if (JSON.stringify(here).length > SETTINGS_MAX * 4) return { ok: false, error: 'too many settings on this site' };
      await save({ sandboxSettings: { ...store, [mod]: sites } });
      return { ok: true };
    }
    return { ok: false, error: 'unknown' };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: errMsg(e) }));
  return true;
});

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
  ready.then(() => { if (state.port === port) post({ type: 'hello', version: VERSION, userScripts: checkUserScripts(), chrome: CHROME, browser: BROWSER, installId: state.installId, features: FEATURES }); });
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
// A set too big for one native message comes in parts, applied only once the last is in (never half a set).
const modsParts = new ModsParts();

async function onHelperMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'modsPart') {
    const r = modsParts.push(msg);
    if (r.superseded !== undefined) log('info', `mods set ${r.superseded} was replaced by a newer one before it was complete`);
    if (r.error) {
      log('error', r.error);
      post({ type: 'modsResend', reason: r.error });
    }
    if (!r.message) return;
    msg = r.message;
  }
  if (msg.type === 'mods') {
    const dropped = modsParts.reset();
    if (dropped !== null) log('info', `mods set ${dropped} was replaced by a newer one before it was complete`);
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
  // (Before any await: mods sent without their code take it from the set before this one, in order.)
  const filled = fillSameMods(msg.mods, before);
  if (filled.missing) {
    log('error', `mods sent as already here aren't: ${filled.missing.slice(0, 5).join(', ')}${filled.missing.length > 5 ? '…' : ''}; asked for them all`);
    post({ type: 'modsResend', reason: `missing ${filled.missing.length} mod(s) sent without their code` });
    return;
  }
  state.mods = sandboxFallback(filled.mods, { canSandbox: (await sandboxWorld()) !== false, allowed: state.unsandboxedOk });
  // A mod's id is its file name: a file renamed on disk comes back as a new mod. Same code in the same
  // site folder: the same mod, which keeps its switches and its place in the panel (before the first-time
  // switch-offs below, which would otherwise take it for a new one).
  const renames = findRenames(before, state.mods);
  if (renames.length) {
    const moved = carryRenames(renames, { disabled: state.disabled, offSites: state.offSites, startedOff: state.startedOff });
    state.disabled = moved.disabled;
    state.offSites = moved.offSites;
    state.startedOff = moved.startedOff;
    if (state.seenMods) state.seenMods = { ...state.seenMods, ...Object.fromEntries(renames.map((r) => [r.to, true])) };
    const newOff = { ...state.newOff };
    for (const { from, to } of renames) if (newOff[from]) { newOff[to] = newOff[from]; delete newOff[from]; }
    state.newOff = newOff;
    const order = await chrome.storage.local.get('modOrder').then((s) => renameInOrder(s.modOrder, renames), () => ({ changed: false }));
    await save({ disabled: state.disabled, offSites: state.offSites, startedOff: state.startedOff, newOff: state.newOff, ...(state.seenMods ? { seenMods: state.seenMods } : {}), ...(order.changed ? { modOrder: order.modOrder } : {}) })
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
  // One of Tim's mods the user deleted and got back: switched as Tim set it, once (not as it was).
  const readdedBefore = state.readded;
  const re = applyReadded(state.mods, state.disabled, state.readded);
  if (re.changed) {
    state.disabled = re.disabled;
    state.readded = re.readded;
    await save({ disabled: state.disabled, readded: state.readded }).catch((e) => log('warn', errMsg(e)));
  }
  // New mods (and new versions of shipped mods TRIF put in place itself) of a group set to start off
  // arrive switched off, before they're ever registered (Settings' "New mods start"; lib.js applyNewMods).
  const nw = applyNewMods(state.mods, { disabled: state.disabled, seen: state.seenMods, autoUpdated: state.autoUpdated, newOff: state.newOff,
    startsOff: state.startsOff, installId: state.installId, readded: readdedBefore });
  if (nw.changed) {
    const switched = Object.keys(nw.newOff).filter((id) => !state.newOff[id]);
    state.disabled = nw.disabled;
    state.seenMods = nw.seen;
    state.autoUpdated = nw.autoUpdated;
    state.newOff = nw.newOff;
    await save({ disabled: state.disabled, seenMods: state.seenMods, autoUpdated: state.autoUpdated, newOff: state.newOff }).catch((e) => log('warn', errMsg(e)));
    if (switched.length) log('info', `new, so off until switched on: ${switched.join(', ')}`);
  }
  // Sites setup starts TRIF on for (the preinstalled mods' sites), each turned on once.
  const sites = applyStartSites(state.sitesOn, state.sitesOffered, msg.sitesOn);
  if (sites.changed) {
    state.sitesOn = sites.sitesOn;
    state.sitesOffered = sites.offered;
    await save({ sitesOn: state.sitesOn, sitesOffered: state.sitesOffered }).catch((e) => log('warn', errMsg(e)));
    notifyPanels();
  }
  // Tim's mods, site by site: which the user added, and what each site's are (the setup page, Settings).
  const starter = normalizeStarter(msg.starter);
  if (JSON.stringify(starter) !== JSON.stringify(state.starter)) {
    state.starter = starter;
    notifyPanels();
  }
  // The order the side panel starts a site's shipped mods in (the panel reads it from storage).
  const defaultOrder = normalizeModOrder(msg.defaultOrder);
  if (JSON.stringify(defaultOrder) !== JSON.stringify(state.defaultOrder)) {
    state.defaultOrder = defaultOrder;
    await save({ defaultOrder }).catch((e) => log('warn', errMsg(e)));
  }
  // A shipped mod folded into another one hands that one its switch, once (on if either was on).
  const ab = applyAbsorbed(state.mods, state.disabled, state.offSites, state.absorbed);
  if (ab.changed) {
    state.disabled = ab.disabled;
    state.offSites = ab.offSites;
    state.absorbed = ab.absorbed;
    await save({ disabled: state.disabled, offSites: state.offSites, absorbed: state.absorbed }).catch((e) => log('warn', errMsg(e)));
  }
  const plan = modsStoragePlan(state.mods, storedModsState);
  if (Object.keys(plan.set).length || plan.remove.length) {
    try {
      if (Object.keys(plan.set).length) await save(plan.set);
      if (plan.remove.length) await chrome.storage.local.remove(plan.remove);
      storedModsState = plan.stored;
    } catch (e) {
      log('warn', errMsg(e));
    }
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
  if (!siteOnFor(url, onSites())) {
    const host = hostOf(url);
    if (!host || !/^https?:/.test(url)) throw new Error(`${what} isn't a web page (${url || 'no URL'}); TRIF only works on http and https pages`);
    const site = siteOnFor(url, [...state.blockedSites, ...state.sitesOn]) || scopeFor(host);
    throw new Error(siteRefusal(site, stateOf(site)) || siteRefusal(site, 'off'));
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
    // What the last sync registered, not getScripts(): that hands back every mod's code, a copy of all of
    // them for each `trif status` (agents and the e2e suite ask often). Only this extension registers its
    // scripts, and every sync makes them match the list exactly.
    const ids = new Set(checkUserScripts() ? state.lastApply.registered : []);
    const errors = new Map(state.lastApply.errors.map((e) => [e.id, e.error]));
    return {
      userScripts: state.userScripts, chrome: CHROME, browser: BROWSER, version: VERSION,
      mods: state.mods.map((m) => {
        const o = { id: m.id, registered: ids.has(m.id), enabled: isEnabled(m.id) };
        if (state.offSites[m.id]) o.offSites = state.offSites[m.id];
        if (!limitToSites(m, onSites())) o.sitesOff = true; // every site it's for is off (or without access)
        if (m.held) o.held = m.held;
        if (m.sandboxed) o.sandboxed = inSandboxWorld(m) ? true : 'page'; // ('page': this browser runs it as a page script)
        if (state.newOff[m.id] && !isEnabled(m.id)) o.newOff = state.newOff[m.id];
        if (errors.has(m.id) && errors.get(m.id) !== USER_SCRIPTS_OFF) o.error = errors.get(m.id);
        return o;
      }),
      recording: state.recording, sitesOn: state.sitesOn, ...siteLists(), ...(state.paused ? { paused: true } : {}),
      ...(Object.keys(state.groupsOff).length ? { groupsOff: state.groupsOff } : {}),
      ...(state.startsOff.length ? { startsOff: state.startsOff } : {}),
      ...(state.canSandbox === false ? { sandbox: false } : {}),
      ...(args && (args.tab !== undefined || args.url !== undefined) ? { page: await modsOnPage(args) } : {}),
    };
  },

  async tabs(args) {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
    return tabs.filter((t) => {
      const url = t.url || t.pendingUrl || '';
      return (!args.scope || urlInScope(url, args.scope)) && siteOnFor(url, onSites());
    }).map(tabInfo);
  },

  async run(args) {
    requireUserScripts();
    if (typeof args.code !== 'string') throw new Error('missing code');
    const tab = await scopedTab(args);
    // A side-panel agent's code (args.scope): lock the tab first, so nothing it does can post, send or
    // change anything as the user (tablock.js). No lock, no code.
    if (args.scope) {
      try { await tabLocks.lock(tab.id, args.scope, null, tab.url || ''); } catch (e) {
        throw new Error(`TRIF couldn't lock tab ${tab.id} against sending requests (${errMsg(e)}), so it won't run agent code there`);
      }
    }
    const timeout = Number(args.timeout) > 0 ? Number(args.timeout) : 10000;
    const runId = crypto.randomUUID();
    let timedOut = false;
    const execute = async (code) => firstInjectionResult(await chrome.userScripts.execute({
      target: { tabId: tab.id }, world: 'MAIN', injectImmediately: true, js: [{ code }],
    }));
    const work = (async () => {
      let out = await execute(buildRunCode(args.code, !!args.expression, runId, { scope: args.scope || null, sitesOn: onSites() }));
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

  // Close a tab (an agent's own, from `trif open`): it must be named (no "the active tab" default), and
  // not the one the user is looking at, unless forced. (The helper also closes a run's opened tabs when
  // the run ends.)
  async close(args) {
    if (args.tab === undefined && args.url === undefined) throw new Error('say which tab to close: --tab <id> (from trif tabs or trif open) or --url <part of its address>');
    const tab = await scopedTab(args);
    if (!args.force && tab.active) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win && win.focused && win.state !== 'minimized') {
        throw new Error("that's the tab the user is looking at; leave it open, or add --force if closing it is what they want");
      }
    }
    await chrome.tabs.remove(tab.id);
    return { id: tab.id, url: tab.url || '' };
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
      browser: BROWSER, allUrls: state.access.allUrls,
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
    // (--page: the page's own errors, the ones no mod threw)
    return runtimeList(args, args.page ? 'pageErrors' : 'errors');
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
    // A mod switched off because new mods of its group start off (lib.js applyNewMods) waits for the user to
    // look at it: an agent run can't switch it on.
    if (args.scope && args.enabled && state.newOff[id]) {
      throw new Error(`${id} is new and switched off until the user looks at it (their setting: new ${{ rules: 'rules', sandboxed: 'sandboxed mods' }[modGroup(mod)] || 'page scripts'} start off); only the user can switch it on, in the side panel or with trif enable in their terminal`);
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
    // Switched on: no longer off for being new.
    if (enabled && state.newOff[id]) {
      const { [id]: _, ...rest } = state.newOff;
      state.newOff = rest;
      await save({ newOff: state.newOff }).catch((e) => log('warn', errMsg(e)));
      notifyPanels();
    }
    const siteInfo = site ? { site, offSites: res.after.offSites, modEnabled: !res.after.disabled } : {};
    return { id, enabled, ...siteInfo, reloaded: await reloadIfApplies(mod, args) };
  },

  async logs(args) {
    return runtimeList(args, 'logs');
  },
};

// `status --url`: the mods that run on a tab's page (on, not held, not off on its site, its site on),
// so an agent can see what its change will meet.
/** For status: the mode, the sites on but disconnected, the block list, and what the browser gives TRIF. */
function siteLists() {
  return {
    siteMode: SITE_ACCESS ? state.siteMode : null,
    disconnected: state.sitesOn.filter((s) => stateOf(s) === 'disconnected'), // on, but not connected (yet, or any more)
    blockedSites: state.blockedSites,
    access: { all: state.access.all, allUrls: state.access.allUrls, origins: state.access.origins },
  };
}

async function modsOnPage(args) {
  const tab = await scopedTab(args);
  const url = tab.url || tab.pendingUrl || '';
  const mods = state.mods.filter((m) => isEnabled(m.id) && !m.held && limitToSites(m, onSites()) && modAppliesTo(withOffSites(m, offSitesFor(m, state.offSites, state.groupsOff)), url));
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
  // (and the sandboxed mods', kept in TRIF's world: sandbox.js)
  const sbx = await sandboxList(tab, key);
  if (list && sbx.length) return [...list, ...sbx].sort((a, b) => (a.time || 0) - (b.time || 0));
  if (list) return list;
  if (sbx.length) return sbx;
  // The runtime only runs where a mod that's on does (or on a recorded site): no such mod, nothing to report.
  const url = tab.url || tab.pendingUrl || '';
  if (!state.mods.some((m) => isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, offSitesFor(m, state.offSites, state.groupsOff)), url))) return [];
  throw new Error(noRuntime());
}

/** A sandboxed mod's errors or logs (`key`) in the tab's page, from TRIF's world (sandbox.js keeps them there). */
async function sandboxList(tab, key) {
  if (state.canSandbox !== true || (key !== 'errors' && key !== 'logs') || typeof chrome.userScripts?.execute !== 'function') return [];
  const url = tab.url || tab.pendingUrl || '';
  if (!state.mods.some((m) => inSandboxWorld(m) && isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, offSitesFor(m, state.offSites, state.groupsOff)), url))) return [];
  try {
    const out = firstInjectionResult(await chrome.userScripts.execute({
      target: { tabId: tab.id }, world: 'USER_SCRIPT', worldId: SANDBOX_WORLD, injectImmediately: true,
      js: [{ code: `(() => { const s = globalThis.__trifSandbox; return s && Array.isArray(s[${JSON.stringify(key)}]) ? JSON.stringify(s[${JSON.stringify(key)}]) : null; })()` }],
    }));
    const list = typeof out === 'string' ? JSON.parse(out) : null;
    return Array.isArray(list) ? list : [];
  } catch (e) { log('warn', `sandboxed mods' ${key}: ${errMsg(e)}`); return []; }
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
  const why = await rawPageCall(tabId, 'ISOLATED', pageGuard, [guard.scope || null, onSites(), token]);
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
    case 'mods.group': {
      // A group's switch on a site (the panel's "Rules" / "Page scripts"): its mods stop running on that
      // site (or start again), each mod's own switch left as it is. Panel only: an agent run can't change it.
      state.groupsOff = switchGroup(state.groupsOff, String(msg.site ?? ''), String(msg.group ?? ''), msg.enabled === true);
      await save({ groupsOff: state.groupsOff });
      await serial(applyMods).then(reportApplied).catch((e) => log('warn', errMsg(e)));
      if (msg.tab !== undefined) await chrome.tabs.reload(Number(msg.tab)).catch(() => {});
      notifyPanels();
      return { groupsOff: state.groupsOff };
    }
    case 'mods.startsOff': {
      // Settings' "New mods start": a group's new mods on (as always) or off (lib.js applyNewMods). From
      // here on only: mods already here keep their switches. Panel only: an agent run can't change it.
      const group = String(msg.group ?? '');
      if (!MOD_GROUPS.includes(group)) throw new Error(`unknown group ${group}`);
      const off = new Set(state.startsOff);
      if (msg.off === true) off.add(group); else off.delete(group);
      const startsOff = normalizeStartsOff([...off]);
      await save({ startsOff });
      state.startsOff = startsOff;
      notifyPanels();
      return { startsOff };
    }
    case 'mods.pause': {
      // Settings' "Pause all mods": nothing runs in this browser until it's off again
      state.paused = msg.paused === true;
      await save({ paused: state.paused });
      await serial(applyMods).then(reportApplied).catch((e) => log('warn', errMsg(e)));
      if (msg.tab !== undefined) await chrome.tabs.reload(Number(msg.tab)).catch(() => {});
      notifyPanels();
      return { paused: state.paused };
    }
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
    recording: s.recording, sitesOn: state.sitesOn, siteMode: s.siteMode, disconnected: s.disconnected, blockedSites: s.blockedSites, access: s.access, siteAccess: SITE_ACCESS, paused: state.paused,
    starter: state.connected ? state.starter : null, update: state.connected ? state.update : null,
    mods: state.mods.map((m) => ({
      id: m.id, name: m.name || m.id, description: m.description || '', site: m.site, file: m.file || '',
      matches: m.matches || [], excludes: m.excludes || [], registered: !!live.get(m.id)?.registered, enabled: live.get(m.id)?.enabled ?? isEnabled(m.id),
      error: errors.get(m.id) === USER_SCRIPTS_OFF ? null : errors.get(m.id) || null,
      held: m.held || null, pending: m.pending || null, review: m.held || m.pending ? null : m.review || null, risk: m.risk || null,
      from: fromOtherBrowser(m, state.installId) ? (m.origin.browser || 'another browser') : null,
      source: m.source || null, version: m.version || null, update: m.update || null, rules: !!m.rules, sandboxed: !!m.sandboxed, unsandboxed: !!m.unsandboxed,
      newOff: state.newOff[m.id] && !(live.get(m.id)?.enabled ?? isEnabled(m.id)) ? state.newOff[m.id] : null,
    })),
    startsOff: state.startsOff, canSandbox: state.canSandbox !== false,
    runs: [...state.runs.values()].map((r) => ({ runId: r.runId, site: r.site })),
    lockedTabs: tabLocks.list(),
    groupsOff: state.groupsOff,
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
  port.onDisconnect.addListener(() => { state.panels.delete(port); state.panelWindows.delete(port); });
  port.onMessage.addListener((msg) => {
    // A side panel says which window it's in (for the toolbar button's second click, which closes it).
    if (msg?.type === 'panel.window') { if (Number.isInteger(msg.windowId)) state.panelWindows.set(port, msg.windowId); return; }
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
    case 'site.disconnect': return disconnectSite(msg);
    case 'site.block': return setBlocked(msg);
    case 'site.mode': return setSiteMode(msg);
    case 'chat.note': {
      // A line from the panel itself (a slash command's answer), shown like a tool line.
      const site = normalizeSite(msg.site);
      await updateChat(site, (chat) => { chat.messages.push({ role: 'tool', text: String(msg.text ?? ''), time: Date.now() }); });
      return { ok: true };
    }
    case 'mod.code': {
      // "Show code" on a held mod or one to review: the file as the helper has it (capped)
      return helperRequest('mod.code', { id: String(msg.id ?? '') }, 10000);
    }
    case 'mod.review': {
      // "Looks right" on a mod TRIF found can do more than restyle (the helper allows what it found)
      return helperRequest('mod.review', { id: String(msg.id ?? '') }, 10000);
    }
    case 'mod.diff': {
      // "Show what changed" on a change waiting for the user's OK
      return helperRequest('mod.diff', { id: String(msg.id ?? '') }, 15000);
    }
    case 'mod.reject': {
      // "Don't allow": the helper puts the version before back (or, for a new mod, moves it to the trash)
      const r = await helperRequest('mod.reject', { id: String(msg.id ?? ''), ...(typeof msg.hash === 'string' ? { hash: msg.hash } : {}) }, 10000);
      await serial(() => {});
      const mod = state.mods.find((m) => m.id === r.id);
      if (mod && msg.tab !== undefined) await reloadIfApplies(mod, { tab: msg.tab }, { onlyIfRunning: true });
      return r;
    }
    case 'mod.approve': {
      // A sandboxed mod waiting because this browser can't sandbox it (lib.js sandboxFallback): allowed here,
      // in this browser, to run as a page script, this version only. Panel only.
      const sbx = state.mods.find((m) => m.id === msg.id && m.held && m.held.by === 'sandbox');
      if (sbx) {
        if (typeof msg.hash === 'string' && msg.hash !== sbx.held.hash) throw new Error(`${sbx.id} changed again since you looked at it: look at what's waiting now`);
        state.unsandboxedOk = { ...state.unsandboxedOk, [sbx.id]: sbx.held.hash };
        await save({ unsandboxedOk: state.unsandboxedOk });
        await serial(applyMods).then(reportApplied);
        const mod = state.mods.find((m) => m.id === sbx.id);
        if (mod && msg.tab !== undefined) await reloadIfApplies(mod, { tab: msg.tab });
        return { id: sbx.id, approved: true };
      }
      const r = await helperRequest('mod.approve', { id: String(msg.id ?? ''), ...(typeof msg.hash === 'string' ? { hash: msg.hash } : {}) }, 10000);
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
    case 'mod.undo': {
      // "Undo these changes" on the chat line after a run: each mod back to what it was before it
      const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String).slice(0, 20);
      const done = [];
      for (const id of ids) done.push(await helperRequest('mod.undo', { id }, 10000));
      if (msg.site) {
        await updateChat(normalizeSite(msg.site), (chat) => {
          const line = chat.messages.findLast((m) => Array.isArray(m.undoChange) && !m.undone && m.undoChange.join() === ids.join());
          if (line) line.undone = true;
          chat.messages.push({ role: 'mod', text: `Undone: ${done.map((r) => `${modFileName(r.id)}${r.restored === 'removed' ? ' (new: in the trash)' : ''}`).join(', ')}.`, time: Date.now() });
        });
      }
      await serial(() => {});
      for (const r of done) {
        const mod = state.mods.find((m) => m.id === r.id);
        if (mod && msg.tab !== undefined) await reloadIfApplies(mod, { tab: msg.tab });
      }
      return { undone: done };
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
    // Tim's mods, the user's choice (the setup page, Settings, a site's panel): the helper copies them in
    // (or records none) and sends the mods again, with the sites to turn on. From a site's panel (`tab`),
    // the tab reloads if one of them runs there now.
    case 'shipped.install': {
      // The setup page's ticked mods (`ids`), or the sites to add every mod of (Settings, a site's link).
      const ids = Array.isArray(msg.ids) ? [...new Set(msg.ids.map(String).filter((x) => /^\w[\w.-]*\/\w[\w.-]*$/.test(x)))].slice(0, 200) : null;
      const sites = [...new Set((Array.isArray(msg.sites) ? msg.sites : []).map((x) => scopeFor(String(x))).filter(Boolean))].slice(0, 50);
      const r = await helperRequest('shipped.install', { ...(ids ? { ids } : { sites }), ...(msg.others === 'none' ? { others: 'none' } : {}) }, 60000);
      await modsApplied;
      if (msg.tab !== undefined) {
        const tab = await chrome.tabs.get(msg.tab).catch(() => null);
        const url = tab ? tab.url || tab.pendingUrl || '' : '';
        const added = new Set(r?.added || []);
        const runs = (m) => added.has(m.id) && isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, state.offSites[m.id]), url);
        if (url && siteOnFor(url, state.sitesOn) && state.mods.some(runs)) await chrome.tabs.reload(tab.id).catch(() => {});
      }
      notifyPanels();
      return r;
    }
    case 'shipped.none': {
      const r = await helperRequest('shipped.none', {}, 10000);
      await modsApplied;
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
  if (!siteOnFor(`https://${site}/`, onSites())) {
    const scope = siteOnFor(`https://${site}/`, [...state.blockedSites, ...state.sitesOn]) || scopeFor(site);
    const st = stateOf(scope);
    throw new Error(st === 'blocked' ? `${scope} is blocked in TRIF` : st === 'disconnected' ? `TRIF is disconnected on ${scope}: connect it first` : `TRIF is off on ${scope}: turn it on first`);
  }
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
// On needs the browser's access to the site first (the panel asks for it, from the click): without it
// the site stays off. Off keeps that access, so turning it on again is instant (a quick before and after);
// "Disconnect" (disconnectSite) gives it back.
async function setSiteOn(msg) {
  const site = scopeFor(normalizeSite(msg.site));
  if (!site) throw new Error('missing site');
  const on = msg.on !== false;
  if (on && state.blockedSites.includes(site)) throw new Error(`${site} is blocked in TRIF: unblock it first.`);
  if (on) {
    await refreshAccess(); // (the grant may be newer than permissions.onAdded)
    if (!hasSiteAccess(state.access, site)) throw new Error(`TRIF is disconnected on ${site}: ${BROWSER} didn't give it access.`);
  }
  const set = new Set(state.sitesOn);
  if (on) set.add(site); else set.delete(site);
  const sitesOn = [...set].sort();
  await save({ sitesOn }, { switches: true });
  state.sitesOn = sitesOn;
  if (!on) stopRunsOn(site);
  await afterSiteChange(msg.tab);
  return { site, on, sitesOn: state.sitesOn };
}

function stopRunsOn(site) {
  for (const r of state.runs.values()) {
    if (hostInScope(r.site, site) && !r.stopping) { r.stopping = true; helperRequest('agent.stop', { runId: r.runId }, 10000).catch(() => {}); }
  }
}

// Mods applied again; the tab reloaded if a mod starts or stops running on it.
async function afterSiteChange(tabId) {
  const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const url = tab ? tab.url || tab.pendingUrl || '' : '';
  const runsThere = url && state.mods.some((m) => isEnabled(m.id) && !m.held && modAppliesTo(withOffSites(m, offSitesFor(m, state.offSites, state.groupsOff)), url));
  if (checkUserScripts()) reportApplied(await serial(applyMods));
  if (runsThere) await chrome.tabs.reload(tab.id).catch(() => {});
  notifyPanels();
}

// "Disconnect from <site>" (restrictive): off, and the site's access given back, so it's disconnected.
// With <all_urls> (permissive) one site can't be given back (Chrome keeps the whole grant): the panel offers
// restrictive mode instead (site.mode), and blocking is TRIF's own way to keep off one site.
async function disconnectSite(msg) {
  const site = scopeFor(normalizeSite(msg.site));
  if (!site) throw new Error('missing site');
  if (!SITE_ACCESS) throw new Error(`${BROWSER} decides which sites TRIF can work on, in its own settings`);
  if (state.access.all) throw new Error(`TRIF is permissive (every site), so one site can't be disconnected: switch to restrictive mode first`);
  await giveBack(site, msg.tab);
  await refreshAccess();
  if (hasSiteAccess(state.access, site)) throw new Error(`couldn't disconnect TRIF from ${site}: ${BROWSER} still gives it access`);
  notifyPanels();
  return { site, disconnected: true };
}

// The site off (out of sitesOn), its runs stopped, and its own access given back (not <all_urls>).
async function giveBack(site, tabId) {
  if (state.sitesOn.includes(site)) {
    const sitesOn = state.sitesOn.filter((s) => s !== site);
    await save({ sitesOn }, { switches: true });
    state.sitesOn = sitesOn;
  }
  stopRunsOn(site);
  if (SITE_ACCESS) await Promise.resolve().then(() => chrome.permissions.remove({ origins: siteOrigins(site) })).catch(() => {});
  await afterSiteChange(tabId);
}

// TRIF's block list (chrome.storage.local `blockedSites`): only from the panel, i.e. the user. Blocking a site
// turns it off and gives its own access back; unblocking leaves it off (or disconnected, without access).
async function setBlocked(msg) {
  const site = scopeFor(normalizeSite(msg.site));
  if (!site) throw new Error('missing site');
  const blocked = msg.blocked !== false;
  const list = normalizeSitesOn(blocked ? [...state.blockedSites, site] : state.blockedSites.filter((s) => s !== site));
  await save({ blockedSites: list }, { switches: true });
  state.blockedSites = list;
  if (blocked) await giveBack(site, msg.tab);
  await refreshAccess();
  if (!blocked) await afterSiteChange(undefined);
  notifyPanels();
  return { site, blocked, blockedSites: state.blockedSites };
}

// The site mode, from the setup page or Settings. Permissive comes from the browser's grant (the page asks
// for <all_urls> from the click; permissions.onAdded follows it), so this records restrictive: chosen, or
// the permissive prompt declined. From permissive, every site's access goes (so every site is disconnected
// until it's connected again), with no prompt.
async function setSiteMode(msg) {
  if (!SITE_ACCESS) throw new Error(`${BROWSER} decides which sites TRIF can work on, in its own settings`);
  if (msg.mode === 'restrictive') {
    if (state.access.all && state.access.origins.length) {
      await Promise.resolve().then(() => chrome.permissions.remove({ origins: state.access.origins })).catch((e) => log('warn', `couldn't give the sites back: ${errMsg(e)}`));
    }
    await save({ siteMode: 'restrictive' });
    state.siteMode = 'restrictive';
  }
  // (Runs on the sites that lost their access stop here or in onPermissionsChanged, whichever sees it first.)
  if (await refreshAccess()) {
    for (const r of state.runs.values()) if (!siteOnFor(`https://${r.site}/`, onSites())) stopRunsOn(r.site);
    if (checkUserScripts()) reportApplied(await serial(applyMods));
  }
  notifyPanels();
  return { siteMode: state.siteMode };
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
        // The agent's login is gone or expired: one plain line, not an error (the panel shows its login
        // notice for it), and at most one per run.
        if (event.reason === 'login') {
          if (!run.loginSaid) { run.loginSaid = true; push('login', event.message || 'Your agent needs you to log in again.'); }
        } else push('error', event.message || 'Something went wrong.');
        break;
      case 'done': {
        if (event.sessionId) { chat.sessionId = String(event.sessionId); chat.agent = run.agent ?? chat.agent ?? null; }
        if (event.ok && !run.texts && String(event.result ?? '').trim()) push('assistant', event.result);
        if (!event.ok && event.error?.kind === 'login') {
          if (!run.loginSaid) push('login', event.error.message || 'Your agent needs you to log in again.');
        } else if (!event.ok && !run.errored) {
          if (run.stopping) push('tool', 'stopped');
          else push('error', String(event.result ?? '').trim() || 'The agent stopped without finishing.');
        }
        // What the run changed can be undone (the helper kept the versions before: lib/history.js)
        const undoable = Array.isArray(event.undoable) ? event.undoable.filter((id) => typeof id === 'string').slice(0, 20) : [];
        if (undoable.length) {
          chat.messages.push({ role: 'mod', text: `Changed ${undoable.map(modFileName).join(', ')}.`, undoChange: undoable, time });
        }
        for (const h of Array.isArray(event.held) ? event.held : []) {
          push('error', `${h.id} is on hold: TRIF found that it ${(Array.isArray(h.facts) && h.facts.length ? h.facts : [h.reason]).join('; it ')}. It won't run until you allow it (in Mods above).`);
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
