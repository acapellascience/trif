// Side panel: chat with your coding agent about the site in the active tab. Follows the active tab
// of its window. The background relays agent runs to the helper and writes each run's transcript to
// chrome.storage.local `chat:<site>`; this page renders that record and reacts to storage changes.
// See docs/PROTOCOL.md, "Side panel and agent runs".

import { siteForUrl, modAppliesTo, modSites, isMultiSite, offOnSite, normalizeOffSites, scopeFor, hostInScope, limitToSites, withOffSites, modGroup, GROUPS, GROUP_NAMES, groupWord, groupOffOn, offSitesFor, normalizeGroupsOff, FIREFOX, BROWSER, SETUP_COMMAND,
  SITE_ACCESS, siteOrigins, siteState, hasSiteAccess,
  normalizeModOrder, orderMods, moveId, setModOrder,
  normalizeSettings, normalizePicks, siteSettings, withoutModel, panelQuery, panelWindowBounds, rememberScreen } from './lib.js';
import { setMarkdown, unwrapMarkdown } from './markdown.js';
import { createLogin } from './login.js';
import { agentLevel, agentSiteOf, sensitiveList } from './agentsites.js';
import { modChip, levelWords, modLevel, powerLines } from './modlevel.js';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';
import { mountOpenModel, renderOpenModel, openModelKeyMissing, watchOpenModel } from './openmodel.js';

const $ = (sel) => document.querySelector(sel);
const chatKey = (site) => `chat:${site}`;
const emptyChat = () => ({ sessionId: null, agent: null, messages: [], run: null, last: null });

const ui = {
  modsMore: document.getElementById('mods-more'), modsMenu: document.getElementById('mods-menu'), importMod: document.getElementById('import-mod'), exportSite: document.getElementById('export-site'),
  siteFilesBox: document.getElementById('site-files-box'), siteFilesSummary: document.getElementById('site-files-summary'),
  importFile: document.getElementById('import-file'), siteFiles: document.getElementById('site-files'), dropOverlay: document.getElementById('drop-overlay'), dropText: document.getElementById('drop-text'),
  agentLevel: document.getElementById('agent-level'), agentSiteNote: document.getElementById('agent-site-note'),
  agentSitesList: document.getElementById('agent-sites-list'), agentSitesEmpty: document.getElementById('agent-sites-empty'),
  sensitiveSites: document.getElementById('sensitive-sites'), sensitiveSave: document.getElementById('sensitive-save'),
  sensitiveReset: document.getElementById('sensitive-reset'), sensitiveNote: document.getElementById('sensitive-note'),
  waitingBadge: document.getElementById('waiting-badge'),
  dot: $('#dot'), site: $('#site'), barRobot: $('#bar-robot'), siteSwitch: $('#site-switch'), newChat: $('#new-chat'), settingsBtn: $('#settings-btn'),
  gate: $('#gate'), gateTitle: $('#gate-title'), gateWhy: $('#gate-why'), gateBtn: $('#gate-btn'), gateErr: $('#gate-err'), gateNote: $('#gate-note'),
  gateLinks: $('#gate-links'), gateBlock: $('#gate-block'), gateDisconnect: $('#gate-disconnect'),
  modeNote: $('#mode-note'), accessNote: $('#access-note'), accessNoteOk: $('#access-note-ok'),
  blockedList: $('#blocked-list'), blockedEmpty: $('#blocked-empty'),
  onBreak: $('#on-break'),
  chatMods: $('#chat-mods'),
  landing: $('#landing'), landingIcon: $('#landing-icon'), gateIcon: $('#gate-icon'), landingVersion: $('#landing-version'), landingNote: $('#landing-note'),
  settings: $('#settings'), agent: $('#agent'), agentNote: $('#agent-note'), withoutSandbox: $('#without-sandbox'), model: $('#model'),
  using: $('#using'), modelCustomRow: $('#model-custom-row'), modelCustom: $('#model-custom'), modelNote: $('#model-note'),
  instructions: $('#instructions'), instructionsNote: $('#instructions-note'),
  autoUpdate: $('#auto-update'), pauseAll: $('#pause-all'), pausedAll: $('#paused-all'), updateNote: $('#update-note'), update: $('#update'),
  starter: $('#starter'), starterList: $('#starter-list'), starterErr: $('#starter-err'),
  siteStarter: $('#site-starter'), siteStarterLink: $('#site-starter-link'), siteStarterErr: $('#site-starter-err'),
  notice: $('#notice'), paused: $('#paused'), tabLock: $('#tab-lock'), mods: $('#mods'), modsCount: $('#mods-count'), modList: $('#mod-list'), modsReviewNote: $('#mods-review-note'), modsLive: $('#mods-live'),
  chat: $('#chat'), empty: $('#empty'), messages: $('#messages'), working: $('#working'),

  noSandbox: $('#no-sandbox'),
  composer: $('#composer'), input: $('#input'), send: $('#send'), stop: $('#stop'),
};

const view = {
  windowId: null,
  tab: null,                 // {id, url}
  site: null,
  chat: emptyChat(),
  status: null,              // background status (helper, userScripts, mods…)
  agents: null,              // agent.list result, or null when unknown
  agentsError: null,
  settings: { agent: '', models: {} }, // the default agent settings (models: agent id -> model, '' = its default)
  picks: {},                 // chrome.storage.local `sitePicks`: each site chat's own agent and model (lib.js)
  snapshots: new Map(),      // site -> the default this panel first saw for it, until the site has a pick
  modelLists: {},            // agent id -> agent.models result (what that agent offers)
  modelOther: {},            // agent id -> true while "Other…" is picked but nothing typed yet
  rendered: { site: null, count: 0, first: null },
  modsOpenFor: null,         // set once the mods <details> open state has been restored
  modRows: new Map(),        // mod id -> {key, li}: each row is rebuilt only when its own mod changes
  modErrors: new Map(),      // mod id -> {message, timer}: why a row's button (merge, delete…) failed, shown a while
  merging: new Set(),        // mod ids whose "Merge with my agent" is starting a run
  disabled: {},              // chrome.storage.local `disabled`: mods switched off (by anyone: panel, agent, CLI)
  offSites: {},              // chrome.storage.local `offSites`: mods switched off on some of their sites
  modOrder: {},              // chrome.storage.local `modOrder`: the order the user dragged each site's mods into (lib.js)
  defaultOrder: {},          // chrome.storage.local `defaultOrder`: each site's order for its shipped mods until then (from the helper)
  modNatural: [],            // the ids of the mods listed, in the order they come before the user's (what an unsaved order is)
  myRuns: new Map(),         // runs this panel started: runId -> {prompt, tabId} for a message sent from the box, else null
  updated: null,             // chrome.storage.local `updated`: {from, to, notes, at} after an update's reload
  updateBusy: null,          // 'checking' | 'installing' while the panel waits on the helper
  updateError: null,
};

// A mod row being dragged into another place (see "reordering"): {li, pointerId, startY, y, started, ids, grabDy, frame, dirty}.
let modDrag = null;
const DRAG_PX = 4;  // how far a press moves before it picks the row up
const EDGE_PX = 28; // how near the list's top or bottom edge it scrolls

// ---- background port ----------------------------------------------------------------------------

let port = null;
let reqSeq = 0;
const pending = new Map();
// A panel window (?window=<id>) follows the tabs of that browser window, not its own: Safari's, and in
// Chromium browsers without a side panel (Arc) the background's (&fallback=1; lib.js "the panel in a window").
const { openedFor: OPENED_FOR, fallback: FALLBACK } = panelQuery(location.search);
let ownWindowId = null; // the fallback's own window

function connectPort() {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener(onPortMessage);
  sayWindow();
  port.onDisconnect.addListener(() => {
    port = null;
    for (const p of pending.values()) p.reject(new Error('lost connection to the TRIF service worker'));
    pending.clear();
    setTimeout(() => { if (!port) connectPort(); refreshStatus(); }, 500); // the service worker restarted
  });
}

// A side panel says which window it's in as soon as it can: that's how the background knows the toolbar
// click opened it (else it opens the fallback), and closes it on the next click. The fallback says so too,
// with its own window.
function sayWindow() {
  if (view.windowId === null || (OPENED_FOR && !FALLBACK)) return;
  try { port?.postMessage({ type: 'panel.window', windowId: view.windowId, ...(FALLBACK ? { own: ownWindowId } : {}) }); } catch { /* reconnects */ }
}

/**
 * The fallback panel window: closes with the browser window it follows (or at once, restored after a
 * restart with that window gone), and moves beside it when the screen has room, which only the page can
 * see (`screen`); the screen is kept in `panelScreens` so the next one opens there.
 */
async function setUpPanelWindow() {
  const own = await chrome.windows.getCurrent().catch(() => null);
  ownWindowId = own?.id ?? null;
  const close = () => (ownWindowId !== null ? chrome.windows.remove(ownWindowId) : Promise.reject()).catch(() => window.close());
  chrome.windows.onRemoved.addListener((id) => { if (id === OPENED_FOR) close(); });
  const target = await chrome.windows.get(OPENED_FOR).catch(() => null);
  if (!target) { close(); return; }
  const here = { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight };
  const screens = rememberScreen((await chrome.storage.local.get('panelScreens').catch(() => ({}))).panelScreens, here);
  chrome.storage.local.set({ panelScreens: screens }).catch(() => {});
  const want = panelWindowBounds(target, screens);
  if (own && ['left', 'top', 'width', 'height'].some((k) => typeof want[k] === 'number' && Math.abs(want[k] - own[k]) > 2)) {
    chrome.windows.update(ownWindowId, want).catch(() => {});
  }
}

/** A new tab, in the browser window the panel follows (from a panel window, not in that). */
function openTab(props) {
  return chrome.tabs.create({ ...props, ...(FALLBACK ? { windowId: OPENED_FOR } : {}) });
}

function request(msg) {
  if (!port) connectPort();
  const reqId = ++reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    try { port.postMessage({ ...msg, reqId }); } catch (e) { pending.delete(reqId); reject(e); }
  });
}

function onPortMessage(msg) {
  if (msg?.type === 'reply') {
    const p = pending.get(msg.reqId);
    if (!p) return;
    pending.delete(msg.reqId);
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'error'));
  } else if (msg?.type === 'agentEvent') {
    if (login.onAgentEvent(msg, (runId) => view.myRuns.has(runId))) return;
    // The transcript arrives through storage; only our own runs matter here.
    if (!view.myRuns.has(msg.runId)) return;
    if (msg.event?.kind === 'done') {
      const sent = view.myRuns.get(msg.runId);
      view.myRuns.delete(msg.runId);
      refreshStatus();
      if (!msg.event.ok) loadAgents(); // maybe "not logged in": refresh loggedIn
      // The agent needs logging in: the message goes back in the box, to send again once logged in.
      if (msg.event.error?.kind === 'login' && sent) restoreDraft(sent);
    }
  } else if (msg?.type === 'statusChanged') {
    refreshStatusSoon();
  } else if (msg?.type === 'agentAsk') {
    showAgentAsk(msg.id, msg.site);
  } else if (msg?.type === 'agentAskDone') {
    if (agentAsk.id === msg.id) closeAgentAsk();
  }
}

// ---- status and agents --------------------------------------------------------------------------

let statusTimer = null;
function refreshStatusSoon() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(refreshStatus, 100);
}

async function refreshStatus() {
  try {
    const wasConnected = !!view.status?.helper?.connected;
    view.status = await request({ type: 'status' });
    if (view.status.helper.connected && (!wasConnected || !view.agents)) loadAgents();
    // Storage stopped working: switches can't be read from it, so they come with the status.
    if (view.status.storageBroken) {
      view.disabled = view.status.disabled || {};
      view.offSites = normalizeOffSites(view.status.offSites);
    }
  } catch (e) {
    console.warn('[TRIF] status failed', e);
  }
  render();
}

async function loadAgents() {
  try {
    view.agents = await request({ type: 'agent.list' });
    view.agentsError = null;
    watchOpenModel(currentAgent().id, true, true); // its key may have been saved from a terminal meanwhile
  } catch (e) {
    view.agents = null;
    view.agentsError = String(e?.message ?? e);
  }
  renderSettings();
  render();
}

/** This site chat's agent settings ({agent, models}): see "agent and model per site chat" in lib.js. */
const chatSettings = () => siteSettings({ picks: view.picks, snapshots: view.snapshots, global: view.settings, site: view.site });

/** The agent a new run here would use: this chat's choice, else the helper's default. */
function currentAgent() {
  const list = view.agents?.agents || [];
  const id = chatSettings().agent || view.agents?.default || '';
  return { id, info: list.find((a) => a.id === id) || null, list };
}

// ---- tab following ------------------------------------------------------------------------------

async function init() {
  // Settings' "see the code" for Tim's mods: the code as this version shipped it (the release's tag).
  const src = document.getElementById('starter-source');
  if (src) src.href = `https://github.com/acapellascience/trif/tree/v${chrome.runtime.getManifest().version}/examples/sites`;
  connectPort();
  view.windowId = OPENED_FOR || (await chrome.windows.getCurrent()).id;
  if (FALLBACK) await setUpPanelWindow();
  sayWindow();
  const stored = await chrome.storage.local.get(['settings', 'sitePicks', 'disabled', 'offSites', 'updated', 'modOrder', 'defaultOrder', 'defaultModelsReset']);
  view.updated = stored.updated || null;
  view.settings = normalizeSettings(stored.settings);
  // Once (0.2.3): the default's models, which models picked on sites used to be copied into (see
  // saveSettings), back to each agent's default. Each site's own picks stay.
  if (!stored.defaultModelsReset) {
    view.settings = { ...view.settings, models: {} };
    chrome.storage.local.set({ settings: view.settings, defaultModelsReset: true }).catch(() => {});
  }
  view.picks = normalizePicks(stored.sitePicks);
  view.disabled = stored.disabled || {};
  view.offSites = normalizeOffSites(stored.offSites);
  view.modOrder = normalizeModOrder(stored.modOrder);
  view.defaultOrder = normalizeModOrder(stored.defaultOrder);
  renderSettings();

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId === view.windowId) chrome.tabs.get(tabId).then(setTab, () => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url === undefined && info.status === undefined) return;
    // The active tab of this window, even under another id: Safari can give a tab a new id when it goes
    // to another site.
    if (tabId === view.tab?.id || (tab.active && tab.windowId === view.windowId)) setTab(tab);
  });
  // Safari doesn't always report a tab's new address in onUpdated; a page committing in it is certain.
  // (Only the Safari build has the webNavigation permission.)
  chrome.webNavigation?.onCommitted.addListener(({ frameId }) => { if (frameId === 0) followActiveTab(); });
  chrome.tabs.onAttached.addListener(() => followActiveTab());
  chrome.tabs.onDetached.addListener(() => followActiveTab());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (view.site && changes[chatKey(view.site)]) {
      view.chat = normalizeChat(changes[chatKey(view.site)].newValue);
      render();
    }
    if (changes.settings || changes.sitePicks) { // another panel's pick, or this one's
      if (changes.settings) view.settings = normalizeSettings(changes.settings.newValue);
      if (changes.sitePicks) view.picks = normalizePicks(changes.sitePicks.newValue);
      renderSettings();
      renderModels();
      render();
    }
    if (changes.updated) {
      view.updated = changes.updated.newValue || null;
      renderUpdate();
    }
    if (changes.disabled || changes.offSites || changes.modOrder || changes.defaultOrder) { // a switch flipped here, on the setup page, or by an agent / the CLI; mods reordered in another panel, or renamed
      if (changes.disabled) view.disabled = changes.disabled.newValue || {};
      if (changes.offSites) view.offSites = normalizeOffSites(changes.offSites.newValue);
      if (changes.modOrder) view.modOrder = normalizeModOrder(changes.modOrder.newValue);
      if (changes.defaultOrder) view.defaultOrder = normalizeModOrder(changes.defaultOrder.newValue);
      renderMods();
    }
  });

  await followActiveTab();
  await refreshStatus();
  setInterval(() => { if (!document.hidden) refreshStatus(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
}

async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: view.windowId });
  if (tab) await setTab(tab);
}

// What was typed in the message box and not sent, by tab. One panel serves every tab in its window, so on a
// tab switch the box would keep the other tab's words: each tab gets back what was left in it instead.
// (This panel's memory only: a closed tab's goes with it, and a new panel starts empty.)
const drafts = new Map();
chrome.tabs.onRemoved.addListener((tabId) => drafts.delete(tabId));

/** Put an unsent message back in its tab's box, unless something else was typed there meanwhile. */
function restoreDraft({ prompt, tabId }) {
  if (view.tab?.id === tabId) { if (!ui.input.value.trim()) ui.input.value = prompt; }
  else if (!drafts.get(tabId)) drafts.set(tabId, prompt);
}

async function setTab(tab) {
  const url = tab.url || tab.pendingUrl || '';
  if (view.tab && view.tab.id !== tab.id) {
    if (ui.input.value) drafts.set(view.tab.id, ui.input.value); else drafts.delete(view.tab.id);
    ui.input.value = drafts.get(tab.id) || '';
  }
  view.tab = { id: tab.id, url };
  const site = siteForUrl(url);
  if (site !== view.site) {
    leaveSite(view.site);
    view.site = site;
    view.chat = emptyChat();
    if (site) {
      const key = chatKey(site);
      view.chat = normalizeChat((await chrome.storage.local.get(key))[key]);
      if (view.site !== site) return; // switched again meanwhile
    }
    // Each site chat has its own agent and model.
    renderSettings();
    if (!ui.settings.hidden && view.status?.helper?.connected) loadModels(currentAgent().id);
    render();
    returnToSite(site);
    return;
  }
  render();
}

// ---- views that belong to a site ----------------------------------------------------------------------
// The code card (and its History), the approval dialog, the import's questions, the Ask card, the agent's
// menu, the site's files and the mods menu all belong to the site they were opened on. On a tab of another
// site they go: the code card, the import's questions and the menus close; the approval dialog and the Ask
// card hide, and come back on that site's tab if they're still waiting (the Ask: render's loop, by site).
// (Settings and the update notice aren't a site's: they stay.)
const siteCards = new Set(); // the import's open questions: their cancel
function leaveSite(prev) {
  if (codeView.dialog?.open) codeView.dialog.close();
  if (approval.dialog?.open) { closeApproval(); approval.reopenOn = prev; }
  for (const cancel of [...siteCards]) cancel();
  if (agentAsk.dialog?.open) closeAgentAsk();
  closeLevelMenu(false);
  if (ui.modsMenu && !ui.modsMenu.hidden) { ui.modsMenu.hidden = true; ui.modsMore?.setAttribute('aria-expanded', 'false'); }
  if (ui.siteFilesBox) ui.siteFilesBox.open = false;
  if (document.activeElement?.tagName === 'SELECT') document.activeElement.blur(); // (an open dropdown)
}
function returnToSite(site) {
  if (!site || approval.reopenOn !== site) return;
  approval.reopenOn = null;
  if (approval.queue?.length && !document.querySelector('dialog[open]')) showApproval();
}

// The model is chosen per agent (an Opus choice means nothing to Codex), per site chat (lib.js).
const chosenModel = (agentId) => (agentId && chatSettings().models[agentId]) || '';

function normalizeChat(c) {
  const chat = { ...emptyChat(), ...(c && typeof c === 'object' ? c : {}) };
  if (!Array.isArray(chat.messages)) chat.messages = [];
  return chat;
}

// ---- rendering ----------------------------------------------------------------------------------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function code(text) {
  return el('code', null, text);
}


const cardKey = (m) => `${m.done || ''}|${m.undoneFix ? 1 : 0}|${m.fixRun || ''}`;
function breakCard(li, m) {
  li.classList.add('break-card');
  li.dataset.cardKey = cardKey(m);
  const state = m.undoneFix ? 'Fix undone.' : m.done === 'fixed' ? 'Fixed.' : m.done === 'fixing' ? 'Fixing…' : m.done === 'ignored' ? 'Ignored.' : '';
  if (state) li.append(' ', el('span', 'break-state', state));
  const acts = el('div', 'break-actions');
  const fail = (b, e) => { b.disabled = false; request({ type: 'chat.note', site: view.site, text: `Couldn't do that: ${e?.message ?? e}` }).catch(() => {}); };
  const undo = button('Undo fix', '', (e) => undoFix(m.mod, e.currentTarget));
  const fix = button(m.afterFix ? 'Try again' : 'Fix it', m.afterFix ? '' : 'go', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { prompt } = await request({ type: 'modError.fix', id: m.mod, fp: m.fp, site: view.site, url: view.tab?.url });
      await startRun(prompt, { fix: { mod: m.mod, fp: m.fp } });
    } catch (x) { fail(b, x); }
  });
  const show = button('Show error', '', () => {
    const mod = (view.status?.mods || []).find((x) => x.id === m.mod);
    const err = mod?.broken?.find((x) => x.fp === m.fp) || { message: m.quiet ? 'nothing it looks for is on the page any more' : '', line: m.line || 0, quiet: m.quiet };
    openCodeView(m.mod, { error: err });
  });
  const ignore = button('Ignore', 'text', async (e) => { const b = e.currentTarget; b.disabled = true; try { await request({ type: 'modError.dismiss', id: m.mod, fp: m.fp }); } catch (x) { fail(b, x); } });
  ignore.title = 'Don\'t flag this again for this version of the mod';
  if (m.undoneFix || m.done === 'ignored' || m.done === 'fixing') return;
  if (m.done === 'fixed') acts.append(undo);
  else if (m.afterFix) acts.append(undo, fix, show, ignore);
  else acts.append(fix, show, ignore);
  li.append(acts);
}

async function undoFix(id, b) {
  if (b) b.disabled = true;
  try { await request({ type: 'mod.undo', ids: [id], site: view.site, tab: view.tab?.id }); } catch (e) {
    if (b) b.disabled = false;
    request({ type: 'chat.note', site: view.site, text: `Couldn't undo the fix: ${e?.message ?? e}` }).catch(() => {});
  }
}

// ---- an organization's settings instead of TRIF's sandbox (helper/lib/withoutsandbox.js) -------------
// Wording: docs/CODEX-ORG-STRINGS.md.

const both = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '');

/** The card's words for an agent: settingsName is "Codex" or "Claude Code". */
function sandboxCardText(m) {
  const who = m.settingsName || m.name || 'Your agent';
  // Never another agent by name (the list keeps growing). No personal login for the open model (codex-oss).
  const other = m.agent === 'codex-oss' ? 'Another agent works' : `A personal ${who} login, or another agent, works`;
  return {
    title: `Your organization’s ${who} settings replace TRIF’s sandbox.`,
    text: `${who} would run under your company’s settings instead of TRIF’s sandbox. Those settings may let it do more than TRIF allows, or less (some companies’ settings stop it writing mods or reaching TRIF, and then chats can’t work). ${other} with TRIF’s sandbox.`,
    why: Array.isArray(m.why) && m.why.length ? `Your company’s settings ${both(m.why)}.` : '',
    go: `Use ${who} anyway`,
  };
}

function sandboxAnswer(choice) {
  return el('p', 'sandbox-answer', choice === 'allowed' ? 'Allowed: TRIF sent your message again.' : 'Stopped. Nothing was changed.');
}

/** The choice card: Stop (the run stays stopped, nothing stored) or Use <agent> anyway (consent, then resend). */
function sandboxCard(li, m) {
  const t = sandboxCardText(m);
  li.append(el('p', 'sandbox-title', t.title), el('p', 'sandbox-text', t.text));
  if (t.why) li.append(el('p', 'sandbox-why', t.why));
  if (m.answered) { li.append(sandboxAnswer(m.answered)); return; }
  const actions = el('div', 'sandbox-actions');
  const error = el('p', 'note error');
  error.hidden = true;
  const done = (choice) => { actions.replaceWith(sandboxAnswer(choice)); error.hidden = true; };
  const fail = (e) => { stopBtn.disabled = goBtn.disabled = false; error.textContent = String(e?.message ?? e); error.hidden = false; };
  const site = view.site;
  const stopBtn = button('Stop', '', async () => {
    stopBtn.disabled = goBtn.disabled = true;
    try { await request({ type: 'chat.sandboxCard', site, card: m.time }); done('stop'); } catch (e) { fail(e); }
  });
  const goBtn = button(t.go, 'primary', async () => {
    if (view.chat.run) { fail(new Error('Wait for the chat to finish, then try again.')); return; }
    stopBtn.disabled = goBtn.disabled = true;
    try {
      await request({ type: 'agent.withoutSandbox', agent: m.agent, allow: true, site, card: m.time });
      loadAgents(); // (Settings' line)
      done('allowed');
      const tabId = view.tab?.id;
      const runId = await startRun(m.prompt, { agent: m.agent, model: chosenModel(m.agent) || undefined, ...(m.merge ? { merge: m.merge } : {}) });
      view.myRuns.set(runId, { prompt: m.prompt, tabId });
    } catch (e) { fail(e); }
  });
  actions.append(stopBtn, goBtn);
  li.append(actions, error);
}

/** Settings, under the agent: each agent allowed to run without TRIF's sandbox, with Stop allowing. */
function renderWithoutSandbox() {
  const allowed = (view.agents?.agents || []).filter((a) => a.withoutSandbox);
  ui.withoutSandbox.replaceChildren(...allowed.map((a) => {
    const line = el('p', 'note', `${a.name} without TRIF’s sandbox: allowed`);
    const stopBtn = button('Stop allowing', '', async () => {
      stopBtn.disabled = true;
      try { await request({ type: 'agent.withoutSandbox', agent: a.id, allow: false }); } catch (e) {
        stopBtn.disabled = false;
        line.title = String(e?.message ?? e);
        return;
      }
      loadAgents();
    });
    line.append(stopBtn);
    return line;
  }));
  ui.withoutSandbox.hidden = !allowed.length;
}

/** The chat's quiet "no TRIF sandbox" chip, once a run here went on under an organization's settings. */
function renderNoSandbox() {
  const w = view.site ? view.chat.withoutSandbox : null;
  ui.noSandbox.hidden = !w;
  if (w) ui.noSandbox.title = `Your organization’s ${w.settingsName || w.name || 'agent'} settings apply instead of TRIF’s sandbox. Settings → Agents to change this.`;
}

function messageNode(m) {
  const li = el('li', `msg ${m.role}`);
  if (m.role === 'sandbox') { sandboxCard(li, m); return li; }
  // (Role 'login': the agent needs logging in, a plain line; the notice above has the Log in button.)
  if (m.role === 'assistant' || m.role === 'error') setMarkdown(li, m.text);
  else li.textContent = m.text;
  if (m.role === 'tool') li.title = m.text;
  // "x.js was deleted." from the panel's trash icon: Undo until it's used (the restore adds its own line).
  if (m.undo && !m.undone) {
    const undo = button('Undo', '', async () => {
      undo.disabled = true;
      try {
        await request({ type: 'mod.restore', id: m.undo, site: view.site, tab: view.tab?.id });
        undo.remove();
      } catch (e) {
        undo.disabled = false;
        request({ type: 'chat.note', site: view.site, text: `Couldn't restore ${m.undo}: ${e?.message ?? e}` }).catch(() => {});
      }
    });
    li.append(' ', undo);
  }
  // A mod that broke (background.js announceBreak): Fix it / Show error / Ignore; a fix's own new error: Undo
  // fix first; once fixed: Undo fix
  if (m.kind === 'modError') breakCard(li, m);
  // "x.js waits for you." with "Mods your chat makes: Wait for me": Show code, Turn on
  if (m.waitMod) {
    const mod = view.status?.mods?.find?.((x) => x.id === m.waitMod);
    const waiting = !mod || mod.chatWaiting || (mod.newOff === 'chat' && mod.enabled === false);
    if (waiting) {
      const show = button('Show code', '', () => openCodeView(m.waitMod));
      const on = button('Turn on', '', async () => {
        on.disabled = true;
        try { await request({ type: 'mod.enable', id: m.waitMod, enabled: true, tab: view.tab?.id }); show.remove(); on.replaceWith('It\'s on.'); refreshStatus(); }
        catch (e) { on.disabled = false; request({ type: 'chat.note', site: view.site, text: `Couldn't turn it on: ${e?.message ?? e}` }).catch(() => {}); }
      });
      li.append(' ', show, ' ', on);
    }
  }
  // "Changed x.js." after a run: put back what the mods were before it (the helper keeps them: history/)
  if (Array.isArray(m.undoChange) && m.undoChange.length && !m.undone) {
    const undo = button('Undo these changes', '', async () => {
      undo.disabled = true;
      try {
        await request({ type: 'mod.undo', ids: m.undoChange, site: view.site, tab: view.tab?.id });
        undo.remove();
      } catch (e) {
        undo.disabled = false;
        request({ type: 'chat.note', site: view.site, text: `Couldn't undo: ${e?.message ?? e}` }).catch(() => {});
      }
    });
    li.append(' ', undo);
  }
  return li;
}

function render() {
  const { site, chat, status } = view;
  const running = !!chat.run;
  const helperOk = !!status?.helper?.connected;
  const { info: agentInfo, list: agentList } = currentAgent();
  const anyAgent = agentList.some((a) => a.available);

  renderSites();
  renderAgentLevel();
  renderAgentSites();
  renderSiteTools();
  // (the Ask card: this tab's site's only; another site's waits for its own tab, leaveSite)
  const askSite = agentSiteOf(view.tab?.url || '');
  const ask = (view.status?.agentAsks || []).find((a) => !agentAsk.answered.has(a.id) && askSite && (a.site === askSite || hostInScope(askSite, a.site)));
  if (ask) showAgentAsk(ask.id, ask.site);
  else if (agentAsk.dialog?.open) closeAgentAsk();
  ui.site.textContent = site || 'Tim\'s Robot Internet Fixer';
  ui.site.title = view.tab?.url || '';
  document.title = site ? `TRIF · ${site}` : 'Tim\'s Robot Internet Fixer';

  // What's in the way (problemNow): the dot, the colours (body.blocked: red; body.needs-login: yellow,
  // not on the landing page, where no agent is needed yet) and the gate's and landing page's one line all
  // follow it, so they can't disagree.
  watchOpenModel(agentInfo?.id, helperOk);
  const problem = problemNow({ helperOk, agentInfo });
  const red = RED.has(problem);
  document.body.classList.toggle('blocked', red);
  document.body.classList.toggle('needs-login', !!problem && !red && !!site);
  document.body.dataset.problem = problem || '';

  // Status dot
  let dot = 'bad';
  let dotLabel = 'Helper not connected';
  if (!status) { dot = ''; dotLabel = 'Checking…'; }
  else if (helperOk) {
    const agentOk = !problem && (agentInfo ? agentInfo.available : anyAgent);
    dot = red ? 'bad' : agentOk ? 'ok' : 'warn';
    dotLabel = problem === 'scripts' ? 'User scripts are off'
      : problem === 'login' ? `${agentInfo?.name || 'The agent'} isn’t logged in`
      : problem === 'key' ? `No ${openModelKeyMissing()} API key yet`
      : !agentOk ? 'Coding agent not available'
      : `Ready${agentInfo ? ` · ${agentInfo.name}` : ''}`;
  }
  ui.dot.className = `dot ${dot}`;
  ui.dot.title = dotLabel;
  ui.dot.setAttribute('aria-label', dotLabel);

  // Before the mods: a mod's "Merge with my agent" starts a run too.
  // Not while the agent is known to be logged out (or the open model has no key): the run would only fail
  // with that. From the agent itself, not the panel's main problem: a red one (user scripts off) takes
  // that slot, and the login is still missing. Send's tooltip says what to do.
  const keyMissing = agentInfo?.id === 'codex-oss' && agentInfo.available && openModelKeyMissing();
  // (Except a login a run found gone, loginExpired: the agent's own check still says logged in then, so
  // after logging in from a terminal, sending again is the only way to tell. The notice still shows.)
  const waitsForLogin = (!!agentInfo?.available && agentInfo.loggedIn === false && !agentInfo.loginExpired) || !!keyMissing;
  const canSend = !!site && helperOk && !waitsForLogin && (agentInfo ? agentInfo.available : (view.agents ? anyAgent : true));
  ui.composer.dataset.canSend = canSend ? '1' : '';
  ui.send.title = !waitsForLogin ? 'Send'
    : keyMissing ? `Add your ${keyMissing} API key in Settings first`
      : `Log in to ${agentInfo?.name || 'your agent'} first`;

  renderGate(problem, agentInfo);
  renderTabLock();
  renderFaces(problem, agentInfo);
  renderPausedAll();
  renderNotice({ helperOk, agentInfo, anyAgent });
  renderUpdate();
  renderMods();
  renderStarter();
  renderSiteStarter();
  renderMessages();
  renderNoSandbox();

  ui.empty.hidden = !site || chat.messages.length > 0;
  ui.working.hidden = !running;

  ui.newChat.disabled = !site || (chat.messages.length === 0 && !running);
  ui.input.disabled = !site;
  ui.input.placeholder = site ? `What should I fix on ${site}?` : 'Open a website to fix it';
  ui.send.hidden = running;
  ui.stop.hidden = !running;
  ui.stop.disabled = !chat.run?.runId;
  ui.send.disabled = !canSend;
}

// Red (mods can't run): the helper isn't connected, or user scripts are off. Yellow, the rest: the agent
// can't run until the user logs in (or saves the open model's key).
const RED = new Set(['helper', 'scripts']);

/** What's in the way: 'helper', 'scripts', 'login', 'key' (in that order: red first), or null. */
function problemNow({ helperOk, agentInfo }) {
  const { status } = view;
  if (!status) return null;
  if (!helperOk) return 'helper';
  if (!status.userScripts) return 'scripts';
  if (needsLogin(agentInfo)) return 'login';
  if (agentInfo?.id === 'codex-oss' && agentInfo.available && openModelKeyMissing()) return 'key';
  return null;
}

/**
 * The problem in one line, for the gate and the landing page (the site's own page has the notices):
 * the notice's words, shortened, with its action as a link.
 */
function problemLine(problem, agentInfo) {
  const link = (text, onClick) => {
    const a = el('a', null, text);
    a.href = '#';
    a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return a;
  };
  const p = el('p');
  switch (problem) {
    case 'helper':
      p.append('The TRIF helper isn’t connected. Run ', code(SETUP_COMMAND), ` in a terminal, then restart ${BROWSER}. `, link('Setup page', openSetup));
      break;
    case 'scripts':
      if (FIREFOX) p.append('Mods are paused. ', link('Allow user scripts', allowUserScripts));
      else p.append('Mods are paused: turn on “Allow User Scripts” for TRIF. ', link('Open extension settings', allowUserScripts));
      break;
    case 'login': {
      const name = agentInfo?.name || 'The agent';
      const fix = agentInfo?.loginFix || '';
      if (agentInfo?.canLogin) p.append(`${name} isn’t logged in. `, link('Log in', () => login.start(agentInfo.id, name, fix)));
      else return markdownBlock('', `${name} isn’t logged in.${fix ? ` To log in, ${fix}.` : ''}`);
      break;
    }
    case 'key':
      p.append(`No ${openModelKeyMissing()} API key yet: add it in `, link('Settings', openSettings), '.');
      break;
    default:
      return null;
  }
  return p;
}

/** Fill a one-line problem spot (rebuilt only when what it says changes, so a link isn't swapped mid-click). */
function renderProblemLine(node, problem, agentInfo) {
  const key = problem ? JSON.stringify([problem, BROWSER, agentInfo?.name, agentInfo?.canLogin, agentInfo?.loginFix, problem === 'key' && openModelKeyMissing()]) : '';
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  const line = problem ? problemLine(problem, agentInfo) : null;
  node.replaceChildren(...(line ? [line] : []));
  node.hidden = !line;
}

// Turning user scripts on: in Firefox a permission prompt, which must open from the click itself; in
// Chrome, the extension's settings page, where the switch is.
function allowUserScripts() {
  if (FIREFOX) chrome.permissions.request({ permissions: ['userScripts'] }).then(() => setTimeout(refreshStatus, 300), () => {});
  else openTab({ url: view.status?.settingsUrl || `chrome://extensions/?id=${chrome.runtime.id}` });
}

/** Every mod paused (Settings): a notice saying so, with Resume, and the checkbox follows. */
function setPaused(paused) {
  return request({ type: 'mods.pause', paused, tab: view.tab?.id }).then(refreshStatus, (e) => request({ type: 'chat.note', site: view.site, text: `Couldn't ${paused ? 'pause' : 'resume'} mods: ${e?.message ?? e}` }).catch(() => {}));
}
function renderPausedAll() {
  const paused = !!view.status?.paused;
  ui.pauseAll.checked = paused;
  ui.pausedAll.hidden = !paused;
  if (!paused) { ui.pausedAll.replaceChildren(); return; }
  if (ui.pausedAll.childElementCount) return;
  ui.pausedAll.replaceChildren(el('p', 'title', 'All mods are paused'),
    el('p', null, 'Nothing from TRIF runs on any site in this browser until you resume. Each mod keeps its own switch.'),
    actions(button('Resume', 'primary', () => setPaused(false))));
}

/**
 * This tab is locked (background's tabLocks, tablock.js): the agent ran code in it, so the browser blocks
 * every request from it that changes something (posting, sending, saving) until the page is reloaded.
 * One short line and a Reload button, so the rest of the panel stays in view; the details in the line's
 * tooltip. Meanwhile the panel's state colour is white (body.tab-locked, sidepanel.css --paused) and the
 * robot in the bar shows a pause sign for eyes, as the toolbar icon does.
 * Another kind (TABLOCK-AUDIT TL-4): another tab of a site the agent ran code in, locked with it until
 * that tab reloads, with a button to show that tab.
 */
function renderTabLock() {
  const n = ui.tabLock;
  const lock = view.tab && (view.status?.lockedTabs || []).find((l) => l.tabId === view.tab.id);
  n.hidden = !lock;
  document.body.classList.toggle('tab-locked', !!lock);
  if (!lock) { n.replaceChildren(); delete n.dataset.kind; return; }
  const kind = lock.kind === 'site' ? 'site' : 'code';
  if (n.childElementCount && n.dataset.kind === kind) return;
  n.dataset.kind = kind;
  const line = (text, why) => {
    const p = el('p', 'title', text);
    p.title = why;
    p.setAttribute('aria-description', why);
    return p;
  };
  if (kind === 'site') {
    const show = button('Show that tab', null, async () => {
      if (lock.from == null) return;
      try { const t = await chrome.tabs.update(lock.from, { active: true }); if (t?.windowId != null) await chrome.windows.update(t.windowId, { focused: true }); } catch { /* gone */ }
    });
    const why = `Your agent ran code in another ${lock.site} tab, so TRIF blocks ${lock.site}'s pages from posting, sending or saving as you until that tab reloads. Reading, scrolling, clicks and mods work as usual.`;
    n.replaceChildren(line('Posting is paused on this site: your agent ran code in another tab.', why), show);
    return;
  }
  // Back to the page it was locked on if the tab is somewhere else now (a blocked page: reloading that
  // would only ask for the blocked address again), else a reload. Either way a new page: unlocked.
  const reload = button('Reload', null, () => {
    const t = view.tab;
    if (!t) return;
    let away = true;
    try { away = !hostInScope(new URL(t.url || '').hostname, lock.site); } catch { /* no URL: away */ }
    (away && /^https?:/.test(lock.url) ? chrome.tabs.update(t.id, { url: lock.url }) : chrome.tabs.reload(t.id)).catch(() => {});
  });
  n.replaceChildren(line('Posting is paused: your agent ran code here.', 'Your agent ran code in this page, so TRIF has blocked anything here from posting, sending or saving as you, or opening other sites, until the page reloads. Reading, scrolling, clicks and mods work as usual.'), reload);
}

/** User scripts off: "Mods are paused", in a notice of its own above the rest (a login notice too). */
function renderPaused(helperOk) {
  const n = ui.paused;
  const off = !!view.site && helperOk && !view.status.userScripts;
  n.hidden = !off;
  if (!off || n.childElementCount) return;
  const actions = el('p', 'actions');
  actions.append(button(FIREFOX ? 'Allow user scripts' : 'Open extension settings', 'primary', allowUserScripts));
  n.replaceChildren(el('p', 'title', 'Mods are paused'), el('p', null, FIREFOX
    ? 'Allow user scripts for TRIF so mods can run on websites.'
    : 'Turn on “Allow User Scripts” for TRIF so mods can run on websites.'), actions);
}

function renderNotice({ helperOk, agentInfo, anyAgent }) {
  const n = ui.notice;
  const { site, status } = view;
  const parts = [];
  let bad = false;
  renderPaused(helperOk);
  // A login started from the gate's line goes on in the gate (renderGate leaves the line out meanwhile).
  const inGate = !ui.gate.hidden && !!login.current && !document.body.classList.contains('blocked');
  if (inGate && n.parentElement !== ui.gate) ui.gate.append(n);
  else if (!inGate && n.nextElementSibling !== ui.update) ui.update.before(n);
  if (helperOk && (login.current || needsLogin(agentInfo))) {
    // Built once per state, so the status refresh doesn't wipe the code being typed.
    const L = login.current;
    const key = JSON.stringify(['login', L?.phase, L?.error, L?.name || agentInfo?.name, agentInfo?.canLogin, agentInfo?.loginFix]);
    if (n.dataset.key === key && !n.hidden) return;
    n.dataset.key = key;
    const { nodes, tone } = login.nodes(agentInfo);
    n.replaceChildren(...nodes);
    n.classList.toggle('bad', tone === 'bad');
    n.classList.toggle('ok', tone === 'ok');
    n.hidden = false;
    if (L?.phase === 'code') n.querySelector('input')?.focus();
    return;
  }
  n.dataset.key = '';
  n.classList.remove('ok');
  if (!site) {
    // The landing page (renderGate) shows instead.
  } else if (status && !helperOk) {
    bad = true;
    const p = el('p');
    p.append('Run ', code(SETUP_COMMAND), ` in a terminal (needs Node 18+), then restart ${BROWSER}.`);
    parts.push(el('p', 'title', 'The TRIF helper isn’t connected'), p);
    if (status.helper.error) parts.push(el('p', 'note', `${BROWSER} says: ${status.helper.error}`));
    const actions = el('p', 'actions');
    const retry = el('button', 'btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', async () => {
      await request({ type: 'reconnect' }).catch(() => {});
      setTimeout(refreshStatus, 800);
    });
    const setup = el('a', null, 'Setup page');
    setup.href = '#';
    setup.addEventListener('click', (e) => { e.preventDefault(); openSetup(); });
    const report = el('a', null, 'Report a problem');
    report.href = '#';
    report.addEventListener('click', (e) => { e.preventDefault(); openReport(); });
    actions.append(retry, setup, report);
    parts.push(actions);
  } else if (status && !status.userScripts) {
    // "Mods are paused" (renderPaused).
  } else if (helperOk && view.agents && (agentInfo ? !agentInfo.available : !anyAgent)) {
    bad = true;
    if (agentInfo) {
      parts.push(el('p', 'title', `${agentInfo.name} isn’t available`));
      if (agentInfo.note) { const p = el('p'); setMarkdown(p, agentInfo.note); parts.push(p); }
    } else {
      parts.push(el('p', 'title', 'No coding agent found'));
      parts.push(el('p', null, `Install Claude Code, then run ${SETUP_COMMAND} again from the same terminal.`));
    }
    if (anyAgent) parts.push(el('p', 'note', 'Pick another agent in Settings.'));
  } else if (helperOk && view.agentsError && !view.agents) {
    parts.push(el('p', 'note', `Couldn’t list coding agents: ${view.agentsError}`));
  }
  if (status?.storageBroken) {
    bad = true;
    parts.unshift(el('p', 'title', `${BROWSER}’s storage for TRIF stopped working`),
      el('p', null, `Switches you change now last until ${BROWSER} quits. Quit and reopen ${BROWSER} to fix it.`));
  }
  n.replaceChildren(...parts);
  n.classList.toggle('bad', bad);
  n.hidden = parts.length === 0;
}

// ---- logging in --------------------------------------------------------------------------------

/** The chosen agent is available but logged out (agent.list says so, or the last run failed with it). */
function needsLogin(agentInfo) {
  if (!agentInfo?.available || agentInfo.loggedIn === true) return false;
  if (agentInfo.loggedIn === false) return true;
  return loginLine(view.site ? view.chat.messages.at(-1) : null);
}

// A run's "needs you to log in again" line (role 'login'), or an older helper's "isn't logged in" error.
const loginLine = (m) => m?.role === 'login' || (m?.role === 'error' && /isn[’']t logged in/i.test(String(m.text)));

function button(label, className, onClick) {
  const b = el('button', className ? `btn ${className}` : 'btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function markdownBlock(className, text) {
  const d = el('div', `md ${className || ''}`.trim());
  setMarkdown(d, text);
  return d;
}

// Logging in (login.js): the notice shows its steps.
const login = createLogin({ request, changed: () => render(), succeeded: () => { loadAgents(); answerLoginError(); } });

// Logged in: a chat whose last message is a run's login line (loginLine) gets a line saying it's sorted,
// so it doesn't sit there as if it still applied (and the login notice doesn't come back for it).
function answerLoginError() {
  if (!loginLine(view.site ? view.chat.messages.at(-1) : null)) return;
  request({ type: 'chat.note', site: view.site, text: `${login.current?.name || 'Your agent'} is logged in now: send your message again.` }).catch(() => {});
}

function actions(...children) {
  const p = el('p', 'actions');
  p.append(...children.filter(Boolean));
  return p;
}

let modLabelSeq = 0;
onSwitchChange(() => renderMods());
ui.waitingBadge?.addEventListener('click', () => openApproval(null));

// ---- Groups: "Rules" and "Page scripts", each with a switch for this site (background's mods.group)
const GROUP_TEXT = {
  // (the lines for style and boxed mods: approved by Tim, 2026-11-10, docs/TIER-NAMES-STRINGS.md)
  rules: [GROUP_NAMES.rules, 'Run by TRIF from data: they change how the page looks, and can\'t send, load or click anything themselves.'],
  sandboxed: [GROUP_NAMES.sandboxed, 'Run in TRIF\'s sandbox: they change what the page shows, and do only what you\'ve allowed.'],
  page: [GROUP_NAMES.page, 'Run in the page with everything it has.'],
};
const groupOff = (g) => !!view.site && groupOffOn(normalizeGroupsOff(view.status?.groupsOff), g, view.site);
const groupHeadings = new Map();
// Collapsed tiers (this browser's): their heading stays, with its On and Off; the note and the mods hide.
const collapsedGroups = new Set();
try { for (const g of JSON.parse(localStorage.getItem('groupsCollapsed') || '[]')) collapsedGroups.add(g); } catch { /* none */ }
function applyCollapsed() {
  ui.modList.dataset.collapsed = [...collapsedGroups].join(' ');
  for (const [g, li] of groupHeadings) {
    li.classList.toggle('collapsed', collapsedGroups.has(g));
    li.querySelector('.group-toggle')?.setAttribute('aria-expanded', String(!collapsedGroups.has(g)));
  }
}
function groupHeading(g) {
  let li = groupHeadings.get(g);
  if (!li) {
    li = el('li', 'mod-group');
    li.dataset.group = g;
    const id = `mod-group-${g}`;
    const name = el('h3', 'mod-group-name');
    name.id = id;
    const toggle = el('button', 'group-toggle');
    toggle.append(el('span', 'group-name-text', GROUP_TEXT[g][0]));
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.append(el('span', 'group-count'));
    toggle.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>');
    toggle.addEventListener('click', () => {
      if (collapsedGroups.has(g)) collapsedGroups.delete(g); else collapsedGroups.add(g);
      try { localStorage.setItem('groupsCollapsed', JSON.stringify([...collapsedGroups])); } catch { /* this time only */ }
      applyCollapsed();
    });
    name.append(toggle);
    // On and Off buttons (Tim: the mods' own switches below are the only switches, so the two layers don't look alike)
    const sw = el('div', 'group-switch');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-labelledby', id);
    const setGroup = async (on) => {
      if (sw.hasAttribute('aria-busy') || on === !groupOff(g)) return;
      sw.setAttribute('aria-busy', 'true');
      try { await request({ type: 'mods.group', site: view.site, group: g, enabled: on, tab: view.tab?.id }); await refreshStatus(); } catch (e) {
        request({ type: 'chat.note', site: view.site, text: `Couldn't switch ${GROUP_TEXT[g][0]} ${on ? 'on' : 'off'}: ${e?.message ?? e}` }).catch(() => {});
      } finally { sw.removeAttribute('aria-busy'); }
    };
    for (const on of [true, false]) {
      const btn = el('button', 'gs-btn', on ? 'On' : 'Off');
      btn.type = 'button';
      btn.dataset.on = String(on);
      btn.addEventListener('click', () => setGroup(on));
      sw.append(btn);
    }
    const row = el('div', 'mod-group-row');
    row.append(name, sw);
    li.append(row, el('p', 'mod-group-note', GROUP_TEXT[g][1]));
    groupHeadings.set(g, li);
    applyCollapsed();
  }
  const off = groupOff(g);
  const sw = li.querySelector('.group-switch');
  for (const btn of sw.querySelectorAll('.gs-btn')) btn.setAttribute('aria-pressed', String((btn.dataset.on === 'true') === !off));
  sw.title = off ? `Off on ${view.site}: none of these run here. Click to switch them on here.` : `On on ${view.site}: click to stop all of these running here (each mod's own switch is kept).`;
  li.classList.toggle('off', off);
  return li;
}

function renderMods() {
  // A row being dragged stays where the pointer has it: the list catches up when it's dropped.
  if (modDrag) { modDrag.dirty = true; return; }
  const { site, status, tab } = view;
  // Every mod that runs somewhere on this site's domain (google.com: Search, Maps, mail.google.com…, and
  // all-sites mods), not just on this page, so the list doesn't change as you move around the site; a
  // light says which run on this page. Plus mods on hold from an agent run here, so they can be allowed.
  // In the order the user dragged them into on this site, if they did, else the site's shipped mods in
  // the order TRIF ships them in (display only: lib.js orderMods).
  const scope = site ? scopeFor(site) : null;
  const listed = orderMods(site && status ? status.mods.filter((m) => limitToSites(m, [scope]) || m.held?.site === site) : [], view.defaultOrder[scope]);
  view.modNatural = listed.map((m) => m.id);
  // Grouped by how TRIF runs them (lib.js "Groups"): rules first, then sandboxed mods, then page scripts,
  // each in its own order.
  const ordered = orderMods(listed, view.modOrder[scope]);
  const mods = GROUPS.flatMap((g) => ordered.filter((m) => modGroup(m) === g));
  ui.mods.hidden = mods.length === 0 && !view.siteFileCount;
  updateApprovals(mods);
  if (!mods.length) { view.modRows.clear(); ui.modList.replaceChildren(); ui.modsReviewNote.hidden = true; return; }
  ui.modsCount.textContent = `(${mods.length})`;
  // Mods TRIF found can do more than change the page's look, which the user hasn't looked at yet (helper
  // lib/held.js): they keep running; each gets its facts once, below it.
  const toReview = mods.filter((m) => m.review && !m.held).length;
  ui.modsReviewNote.hidden = !toReview;
  ui.modsReviewNote.textContent = toReview
    ? `TRIF now reads what each mod's code can do. ${toReview === 1 ? 'One mod here can' : `${toReview} mods here can`} do more than change how the page looks: have a look below. ${toReview === 1 ? 'It keeps' : 'They keep'} running meanwhile.`
    : '';
  // Each row is built once and rebuilt only when its own mod changes; rows that stay are left where they
  // are (not even moved), so a button being clicked or a focused switch is never swapped out from under
  // the pointer by a status refresh or by another mod changing. Everything else updates in place.
  const rows = new Map();
  for (const m of mods) {
    const key = JSON.stringify([site, m.name, m.description || '', m.file, m.held ?? null, m.pending ?? null, m.review ?? null, m.risk?.tier ?? null, m.risk?.why ?? null, m.matches,
      m.source ?? null, m.version ?? null, m.update ?? null, m.powers ?? null, m.powerInfo ?? null, m.found ?? null, m.sandboxed ?? null, m.broken ?? null, m.fixUndo ?? null]);
    const old = view.modRows.get(m.id);
    rows.set(m.id, old && old.key === key ? old : { key, li: modItem(m) });
  }
  view.modRows = rows;
  // A heading for each group with mods here (or switched off here), with its switch, before its rows
  const want = [];
  for (const g of GROUPS) {
    const inGroup = mods.filter((m) => modGroup(m) === g);
    if (!inGroup.length && !groupOff(g)) continue;
    want.push(groupHeading(g), ...inGroup.map((m) => rows.get(m.id).li));
  }
  want.forEach((li, i) => { if (ui.modList.children[i] !== li) ui.modList.insertBefore(li, ui.modList.children[i] || null); });
  while (ui.modList.children.length > want.length) ui.modList.lastElementChild.remove();
  const byId = new Map(mods.map((m) => [m.id, m]));
  for (const li of ui.modList.children) updateModItem(li, byId.get(li.dataset.mod));
  // Each tier's count: how many of its mods are switched on here, of how many ("(1/2)")
  for (const [g, li] of groupHeadings) {
    const inGroup = mods.filter((m) => modGroup(m) === g);
    const on = inGroup.filter((m) => !m.held && shownEnabled(m.id, isOn(m.id, switchSite(m)), switchSite(m))).length;
    const count = li.querySelector('.group-count');
    if (count) { count.replaceChildren(el('span', 'gc-on', String(on)), el('span', 'gc-all', `/${inGroup.length}`)); count.title = `${on} of ${inGroup.length} switched on`; }
  }
  syncSwitches(ui.modList, isOn);
  // Open unless the user closed it (remembered across sites and sessions), so each switch is one click away.
  if (view.modsOpenFor === null) {
    let open = true;
    try { open = localStorage.getItem('modsOpen') !== 'false'; } catch {}
    ui.mods.open = open;
    ui.mods.addEventListener('toggle', () => {
      try { localStorage.setItem('modsOpen', String(ui.mods.open)); } catch {}
    });
    view.modsOpenFor = site;
  }
}

// ---- Tim's mods, site by site (helper/lib/preinstalled.js) -----------------------------------------
// Settings lists each site Tim has mods for, added or with an Add button; a site's own panel has a small
// "Add Tim's mods for <site>" link while that site's aren't added. Both go to the helper (shipped.install),
// which only the user can ask for: never an agent run. Nothing removes them in bulk: the user deletes mods
// one by one.

let starterBusy = null; // the site being added
let starterError = null; // {site, message}

function renderStarter() {
  const st = view.status?.helper?.connected ? view.status.starter : null;
  ui.starter.hidden = !st?.sites?.length;
  if (ui.starter.hidden) return;
  const key = JSON.stringify([st.sites, starterBusy, starterError]);
  if (ui.starterList.dataset.key === key) return;
  ui.starterList.dataset.key = key;
  ui.starterList.replaceChildren(...st.sites.map((x) => {
    const li = el('li');
    li.dataset.site = x.site;
    const name = el('span', 'starter-site', x.name);
    // A site added with some of its mods not on the computer (deleted, or left out): which are, which aren't.
    // "Add the rest" brings them back, fresh, switched as Tim set them.
    const out = x.choice === 'added' ? x.mods.filter((m) => m.choice !== 'added') : [];
    const names = (list) => list.map((m) => m.name).join(', ');
    const mods = el('span', 'starter-mods', out.length
      ? `Added: ${names(x.mods.filter((m) => m.choice === 'added'))}. Not added: ${names(out)}.`
      : names(x.mods));
    if (x.choice === 'added' && !out.length) li.append(name, el('span', 'starter-state', 'Added'), mods);
    else {
      const label = out.length ? 'Add the rest' : 'Add';
      const add = button(starterBusy === x.site ? 'Adding…' : label, null, () => addStarter(x.site));
      add.disabled = !!starterBusy;
      add.setAttribute('aria-label', out.length ? `Add Tim’s other mods for ${x.name}: ${names(out)}` : `Add Tim’s mods for ${x.name}`);
      li.append(name, add, mods);
    }
    return li;
  }));
  const err = starterError && !starterError.fromSite ? starterError.message : '';
  ui.starterErr.textContent = err;
  ui.starterErr.hidden = !err;
}

/**
 * The site this panel is on, when Tim has mods for it that the user hasn't added (all, or some left out).
 * Not just for a mod the user deleted: that may be on purpose, so only Settings offers it back.
 */
function siteStarterOffer() {
  const st = view.status?.helper?.connected ? view.status.starter : null;
  const scope = siteScope();
  return (scope && st?.sites?.find((x) => x.site === scope && (x.choice !== 'added' || x.mods.some((m) => m.choice === 'skipped')))) || null;
}

function renderSiteStarter() {
  const x = siteStarterOffer();
  const n = ui.siteStarter;
  n.hidden = !x;
  if (!x) return;
  // In the gate under its button while TRIF is off for the site; under the mods list while it's on.
  const home = ui.gate.hidden ? ui.chat : null;
  if (home && n.nextElementSibling !== home) home.before(n);
  else if (!home && n.previousElementSibling !== ui.gateErr) ui.gateErr.after(n);
  ui.siteStarterLink.textContent = starterBusy === x.site ? `Adding Tim’s mods for ${x.name}…` : `Add Tim’s mods for ${x.name}`;
  ui.siteStarterLink.title = x.mods.filter((m) => m.choice !== 'added').map((m) => m.name).join(', ');
  ui.siteStarterLink.setAttribute('aria-disabled', String(!!starterBusy));
  const err = starterError?.fromSite && starterError.site === x.site ? starterError.message : '';
  ui.siteStarterErr.textContent = err;
  ui.siteStarterErr.hidden = !err;
}

async function addStarter(site, { fromSite = false } = {}) {
  if (starterBusy) return;
  starterBusy = site;
  starterError = null;
  render();
  try {
    await request({ type: 'shipped.install', sites: [site], tab: view.tab?.id });
  } catch (e) {
    starterError = { site, fromSite, message: `Couldn’t add them: ${e?.message ?? e}` };
  }
  starterBusy = null;
  await refreshStatus();
  render();
}

// TRIF is off on a site until the user turns it on here (see "sites TRIF is on for" in lib.js):
// until then the panel shows only "The robot is off." and the button (and, in the top bar, the robot,
// grey and dim, and settings), and nothing runs or reads the site. Once on, the header's switch turns it
// back off. The robot in the bar does what the switch does: wakes the panel, or puts it to sleep.
// (Unknown until the first status: neither shows.)
// The site's state (lib.js siteState): on; off (TRIF keeps the browser's access, so on again doesn't ask:
// a quick before and after); disconnected (restrictive, no access: a first visit too; the panel all grey,
// and Connect asks the browser and turns it on); blocked (TRIF's block list: the panel red, and Unblock).
// (Chrome's own list of sites extensions may not touch doesn't show in chrome.permissions: contains still
// says yes there, checked in Chrome 156. Such a site looks on or off here; the browser refuses TRIF there.)
const siteScope = () => (view.site ? scopeFor(view.site) : null);
const currentState = () => {
  const scope = siteScope();
  if (!scope || !view.status) return null;
  const st = view.status;
  return siteState(scope, { sitesOn: st.sitesOn, access: st.access || { all: true, origins: [] }, blocked: st.blockedSites });
};
const siteIsOn = () => currentState() === 'on';
let siteSwitching = false;

// (the toolbar's paused face is flipped on a light toolbar: the background can't see the scheme, so it's told)
const schemeQuery = matchMedia('(prefers-color-scheme: light)');
const tellScheme = () => request({ type: 'faces.scheme', light: schemeQuery.matches }).catch(() => {});
schemeQuery.addEventListener?.('change', tellScheme);

/**
 * The robot's face (faces.js, scripts/render-icon.js), one at a time: paused (the agent ran code in this
 * tab), blocked (a red cross), disconnected (a broken link), off (blank), logged out (hollow yellow eyes),
 * else his eyes. One colour each, the frame's. On the bar's
 * robot (data-face, sidepanel.css), and the background is told whether the agent needs a login, for the
 * toolbar's yellow face in every tab.
 */
function renderFaces(problem, agentInfo) {
  const state = siteScope() && view.status ? currentState() : null;
  const loggedOut = problem === 'login' || problem === 'key';
  ui.barRobot.dataset.face = document.body.classList.contains('tab-locked') ? 'paused'
    : state === 'blocked' ? 'blocked' : state === 'disconnected' ? 'disconnected' : state === 'off' ? 'off' : loggedOut ? 'login' : 'normal';
  // (only once the agent is known, and not while the helper or user scripts are what's wrong: no answer then)
  if (!view.toldScheme && view.status) { view.toldScheme = true; tellScheme(); }
  if (agentInfo && problem !== 'helper' && problem !== 'scripts' && loggedOut !== view.toldLoggedOut) {
    view.toldLoggedOut = loggedOut;
    request({ type: 'faces.login', loggedOut }).catch(() => { view.toldLoggedOut = null; });
  }
}

function renderGate(problem, agentInfo) {
  const red = RED.has(problem);
  // No website in this tab: the landing page, only the robot and settings (body.no-site hides the rest),
  // and when something red is in the way, the robot in red and a line saying what.
  const noSite = !!view.tab && !view.site;
  document.body.classList.toggle('no-site', noSite);
  ui.landing.hidden = !noSite;
  renderProblemLine(ui.landingNote, noSite && red ? problem : null, agentInfo);
  const icon = `icons/robot-shaded${noSite && red ? '-red' : ''}.svg`;
  if (ui.landingIcon.getAttribute('src') !== icon) ui.landingIcon.setAttribute('src', icon);
  // This extension's own version (the helper's is in settings: they can differ while one updates).
  if (noSite) ui.landingVersion.textContent = `TRIF ${chrome.runtime.getManifest().version}`;
  const scope = siteScope();
  const known = !!scope && !!view.status;
  const state = currentState();
  const gated = known && state !== 'on';
  document.body.classList.toggle('site-off', gated);
  document.body.classList.toggle('site-disconnected', gated && state === 'disconnected');
  document.body.classList.toggle('site-blocked', gated && state === 'blocked');
  ui.gate.hidden = !gated;
  ui.siteSwitch.hidden = !known;
  ui.siteSwitch.setAttribute('aria-checked', String(siteIsOn()));
  ui.siteSwitch.setAttribute('aria-busy', String(siteSwitching));
  ui.siteSwitch.title = ui.siteSwitch.dataset.error || (scope ? `Turn the robot ${siteIsOn() ? 'off' : 'on'} for ${scope}` : '');
  ui.siteSwitch.setAttribute('aria-label', ui.siteSwitch.title);
  // The robot in the bar: the same switch, so the same words and the same busy look.
  ui.barRobot.hidden = !known;
  ui.barRobot.setAttribute('aria-busy', String(siteSwitching));
  ui.barRobot.title = ui.siteSwitch.title;
  ui.barRobot.setAttribute('aria-label', ui.siteSwitch.title);
  // The problem in one line under "The robot is off." (but not during a login started from it: its
  // notice shows there instead, renderNotice). Red: no Fix button, which couldn't work.
  renderProblemLine(ui.gateNote, gated && !(login.current && !red) ? problem : null, agentInfo);
  if (!gated) return;
  // The gate's robot: a red cross when blocked, a grey broken link when disconnected, else a blank face in
  // the state's colour (red when TRIF is missing a part, yellow when the agent needs a login).
  const loggedOut = problem === 'login' || problem === 'key';
  const gateIcon = `icons/robot-shaded-${state === 'blocked' ? 'blocked' : state === 'disconnected' ? 'disconnected' : `off${red ? '-red' : loggedOut ? '-yellow' : ''}`}.svg`;
  if (ui.gateIcon.getAttribute('src') !== gateIcon) ui.gateIcon.setAttribute('src', gateIcon);
  ui.gateTitle.textContent = state === 'disconnected' ? `TRIF is disconnected on ${scope}`
    : state === 'blocked' ? `The robot is blocked on ${scope}` : 'The robot is off.';
  ui.gateWhy.hidden = true;
  ui.gateBtn.hidden = red;
  ui.gateBtn.textContent = state === 'disconnected' ? 'Connect' : state === 'blocked' ? 'Unblock' : `Fix ${scope}`;
  ui.gateBtn.disabled = siteSwitching;
  // Quiet links under Fix: block the site in TRIF, and disconnect it (give the browser's permission back;
  // with every site allowed, that offers restrictive mode instead). Not Disconnect in Safari, which keeps
  // site access in its own settings.
  ui.gateLinks.hidden = state !== 'off';
  ui.gateBlock.textContent = `Block on ${scope}`;
  ui.gateDisconnect.textContent = `Disconnect from ${scope}`;
  ui.gateDisconnect.hidden = !SITE_ACCESS;
}

// The gate's main button: Fix (off), Connect (disconnected), or Unblock.
function gateClick() {
  if (currentState() === 'blocked') return setBlocked(false);
  return setSiteOn(true);
}

function disconnectClick(e) {
  e.preventDefault();
  siteAction({ type: 'site.disconnect' });
}

async function setSiteOn(on) {
  if (siteSwitching || !view.site) return;
  const state = currentState();
  if (on && state === 'blocked') return;
  // On without the browser's access (disconnected: Connect) asks for it first. permissions.request must come
  // from the click itself (Firefox allows nothing awaited before it), so it's the first thing here. Off
  // keeps the access, so on again (off) doesn't ask.
  const scope = siteScope();
  const asking = on && SITE_ACCESS && !hasSiteAccess(view.status?.access, scope) ? chrome.permissions.request({ origins: siteOrigins(scope) }) : null;
  siteSwitching = true;
  ui.gateErr.hidden = true;
  delete ui.siteSwitch.dataset.error;
  render();
  try {
    if (asking && !(await asking)) {
      ui.gateErr.textContent = `${BROWSER} didn’t get your OK, so TRIF stays disconnected on ${scope}.`;
      ui.gateErr.hidden = false;
      return;
    }
    await request({ type: 'site.set', site: view.site, on, tab: view.tab?.id });
    await refreshStatus();
  } catch (e) {
    // Under the button when turning on; on the header switch's tooltip when turning off.
    const text = `Couldn't switch TRIF ${on ? 'on' : 'off'}: ${e?.message ?? e}`;
    ui.gateErr.textContent = text;
    ui.gateErr.hidden = false;
    if (!on) ui.siteSwitch.dataset.error = text;
  } finally {
    siteSwitching = false;
    render();
  }
}

// Disconnecting and blocking: a message to the background for this site, its error under the gate.
async function siteAction(msg, site = view.site) {
  if (siteSwitching || !site) return;
  siteSwitching = true;
  ui.gateErr.hidden = true;
  render();
  try {
    await request({ ...msg, site, tab: view.tab?.id });
    await refreshStatus();
  } catch (e) {
    ui.gateErr.textContent = String(e?.message ?? e);
    ui.gateErr.hidden = false;
  } finally {
    siteSwitching = false;
    render();
  }
}

function setBlocked(blocked, site = siteScope()) {
  return siteAction({ type: 'site.block', blocked }, site);
}

// Settings, "Site permissions": the mode (not in Safari, which asks per site itself), and the blocked sites.
function renderSites() {
  // (the one-time note after an update gave up every site's access)
  ui.accessNote.hidden = !view.status?.accessNote;
  const st = view.status;
  const blocked = st?.blockedSites || [];
  const key = JSON.stringify(blocked);
  if (ui.blockedList.dataset.key !== key) {
    ui.blockedList.dataset.key = key;
    ui.blockedList.replaceChildren(...blocked.map((site) => {
      const li = el('li', null, site);
      li.append(' ', button('Unblock', '', () => setBlocked(false, site)));
      return li;
    }));
  }
  ui.blockedEmpty.hidden = blocked.length > 0;
  // What the chat makes: starts on, or waits
  ui.chatMods.value = st?.chatWait ? 'wait' : 'on';
  if (ui.onBreak && document.activeElement !== ui.onBreak) ui.onBreak.value = st?.onBreak || 'ask';
}

function setChatWait(wait) {
  return request({ type: 'mods.chatWait', wait }).then(refreshStatus, (e) => { modeNote(String(e?.message ?? e)); refreshStatus(); });
}

function modeNote(text) {
  ui.modeNote.textContent = text || '';
  ui.modeNote.hidden = !text;
}

// A mod on several sites gets a switch for this site only (the setup page has the whole-mod one);
// a mod for one site, a switch for the mod.
const switchSite = (m) => (isMultiSite(m) ? view.site : undefined);
const isOn = (id, site) => enabledIn(view.disabled, id) && !(site && offOnSite(view.offSites, id, site));

function modItem(m) {
  const li = el('li');
  li.dataset.mod = m.id;
  const labelId = `mod-name-${++modLabelSeq}`;
  // A row is the light, the name, one chip when there's something to say, one line of description, one tag
  // at most, and the controls. Everything else about the mod is in its code card.
  // (a heading, so a screen reader's heading navigation goes mod to mod)
  const name = el('h3', 'mod-name');
  const light = el('span', 'light');
  const label = el('span', null, m.name);
  label.id = labelId;
  name.append(label);
  // The chip (modlevel.js): its powers and how noticeable it is. Hover says what; a click opens the code card.
  const info = modChip(m, view.site);
  if (info) {
    const chip = el('button', `mod-chip ${info.tone}`, info.text);
    chip.type = 'button';
    chip.title = info.title;
    chip.setAttribute('aria-describedby', labelId);
    chip.addEventListener('click', (e) => { e.stopPropagation(); openCodeView(m.id); });
    name.append(chip);
  }
  // The tags: at most one shows, the most urgent (updateModItem: showOneTag; data-rank, lowest first)
  const tag = el('span', 'tag row-tag');
  tag.dataset.rank = '3';
  tag.hidden = true;
  name.append(tag);
  if (m.pending && !m.held) {
    const t = holdTag(m, 'change on hold', labelId);
    t.classList.add('row-tag');
    t.dataset.rank = '1';
    name.append(t);
  }
  // A new error (or "may be broken"): a small red badge that shows it; a mod a fix run changed: Undo fix
  if (Array.isArray(m.broken) && m.broken.length) {
    const errs = m.broken.filter((b) => !b.quiet);
    const first = errs[0] || m.broken[0];
    const badge = el('button', 'tag err-badge row-tag', errs.length ? (errs.length > 1 ? `${errs.length} errors` : 'error') : 'may be broken');
    badge.dataset.rank = '2';
    badge.type = 'button';
    badge.title = first.quiet ? 'May be broken: nothing it looks for is on the page any more.' : `New error${first.line ? ` at line ${first.line}` : ''}: ${first.message}`;
    badge.addEventListener('click', (e) => { e.stopPropagation(); openCodeView(m.id, { error: first }); });
    name.append(badge);
  }
  if (m.fixUndo) {
    const undo = el('button', 'tag fix-undo', 'Undo fix');
    undo.type = 'button';
    undo.title = 'Put back the version from before your agent fixed it';
    undo.addEventListener('click', (e) => { e.stopPropagation(); undoFix(m.id, undo); });
    name.append(undo);
  }
  const main = el('div', 'mod-main');
  // What the mod does, from its header's @description, on one line (all of it in the tooltip).
  const desc = m.description ? el('div', 'mod-desc', m.description) : null;
  if (desc) desc.title = m.description;
  main.append(light, name, ...(desc ? [desc] : []));
  const row = el('div', 'mod-row');
  if (m.held) {
    // Written by an agent run here, and it can do something the user hasn't allowed (what TRIF read in
    // its code, or matches outside the site): not running until the user allows it, in the approval dialog
    // (below); the row says so, and its tag opens the dialog at this mod.
    li.classList.add('held');
    row.append(gripButton(labelId), main, holdTag(m, 'on hold', labelId), codeButton(m, labelId), deleteButton(m, labelId, li));
  } else {
    const site = switchSite(m);
    row.append(gripButton(labelId), main, modSwitch(document, {
      id: m.id, site, enabled: isOn(m.id, site), labelId,
      apply: (id, enabled, s) => request({ type: 'mod.enable', id, enabled, tab: view.tab?.id, ...(s ? { site: s } : {}) }),
    }), codeButton(m, labelId), deleteButton(m, labelId, li));
  }
  const err = el('div', 'mod-err');
  err.hidden = true;
  li.append(row, err);
  if (!m.held && !m.pending && m.review) li.append(factsBox(m, m.review, 'review'));
  // A new version of a shipped mod: a tag; its notice, with what the user can do, opens from it.
  if (m.update && !m.held) {
    const notice = updateNotice(m, err);
    notice.hidden = true;
    const t = el('button', 'tag row-tag mod-update-tag', 'update available');
    t.type = 'button';
    t.dataset.rank = '4';
    t.title = m.update.version ? `Version ${m.update.version}: see what you can do` : 'See what you can do';
    t.setAttribute('aria-expanded', 'false');
    t.addEventListener('click', (e) => { e.stopPropagation(); notice.hidden = !notice.hidden; t.setAttribute('aria-expanded', String(!notice.hidden)); });
    name.append(t);
    li.append(notice);
  }
  return li;
}

/** One tag on a row at most: the most urgent with something to say. A held row's switch-place tag outranks all. */
function showOneTag(li, held) {
  const tags = [...li.querySelectorAll('.mod-name .row-tag')].filter((t) => t.textContent).sort((a, b) => a.dataset.rank - b.dataset.rank);
  tags.forEach((t, i) => { t.hidden = held || i > 0; });
}

// What a mod can do, in two clearly separate parts: TRIF's own facts, read from the code (the helper's
// lib/powers.js and held.js), and what the mod says about itself (its header's @risk reason or
// description: whoever wrote the mod wrote that too), labelled as such. Held: Allow is on the row.
// Review (a mod the user has, still running): "Looks right" allows what was found; or switch it off.
function factsBox(m, info, kind) {
  const box = el('div', `mod-facts ${kind}`);
  box.append(el('p', 'facts-head', kind === 'held' && info.asks ? 'Waiting for your OK. This boxed mod asks for these powers, and TRIF holds it to them:'
    : kind === 'held' && info.by === 'sandbox' ? 'Waiting for your OK.'
    : kind === 'held' ? 'Waiting for your OK. TRIF found that this mod:'
    : kind === 'pending' ? 'A change to this mod is waiting for your OK. TRIF found that the new version:'
      : 'TRIF found that this mod:'));
  const list = el('ul', 'facts');
  for (const f of (Array.isArray(info.facts) ? info.facts : [String(info.reason || '')]).filter(Boolean)) list.append(el('li', null, info.asks ? `It ${f}.` : f));
  box.append(list);
  const where = m.matches && m.matches.length ? ` It runs by itself on every page it's for (${m.matches.slice(0, 3).join(', ')}${m.matches.length > 3 ? '…' : ''}).` : '';
  const fromAgent = kind !== 'review' && info.by !== 'outside' && info.by !== 'sandbox';
  // (by 'sandbox': this browser can't sandbox it, so allowing it runs it as a page script: lib.js sandboxFallback)
  const who = info.by === 'sandbox' ? 'Allow runs this version as a free mod, in this browser only.'
    : fromAgent ? `An agent ${kind === 'pending' ? 'changed' : 'wrote'} it in your chat on ${info.site || view.site}.` : 'It\'s new or changed since TRIF last let it run.';
  box.append(el('p', 'facts-note', `${kind === 'review' ? 'It keeps running until you switch it off.'
    : kind === 'pending' ? `${who} The version before keeps running until you decide.` : who}${where}${info.asks ? ' Allow is for these powers: a new version that asks for nothing more runs without asking again.' : ''}`));
  if (info.claim) {
    const claim = el('p', 'facts-claim');
    claim.append(el('span', 'facts-who', fromAgent ? 'The agent says: ' : 'The mod says: '), document.createTextNode(`“${info.claim}”`));
    box.append(claim);
  }
  const shown = el('pre', 'facts-code');
  shown.hidden = true;
  const showCode = button('Show code', '', async () => {
    if (!shown.hidden) { shown.hidden = true; showCode.textContent = 'Show code'; return; }
    showCode.disabled = true;
    try {
      const r = await request({ type: 'mod.code', id: m.id });
      shown.textContent = r.code + (r.truncated ? '\n…' : '');
      shown.hidden = false;
      showCode.textContent = 'Hide code';
    } catch (e) { rowError(m.id, String(e?.message ?? e)); } finally { showCode.disabled = false; }
  });
  // The waiting change itself, against the version that last ran (the helper's lib/diff.js)
  const diffView = el('pre', 'facts-diff');
  diffView.hidden = true;
  const showDiff = button('Show what changed', '', async () => {
    if (!diffView.hidden) { diffView.hidden = true; showDiff.textContent = 'Show what changed'; return; }
    showDiff.disabled = true;
    try {
      const r = await request({ type: 'mod.diff', id: m.id });
      diffView.replaceChildren(...r.lines.map((l) => el('span', l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'ctx', `${l.t === '…' ? '…' : l.t} ${l.s}\n`)));
      diffView.hidden = false;
      showDiff.textContent = 'Hide what changed';
    } catch (e) { rowError(m.id, String(e?.message ?? e)); } finally { showDiff.disabled = false; }
  });
  const decide = (type, label, title) => {
    const b = button(label, type === 'mod.approve' ? 'primary' : '', async () => {
      b.disabled = true;
      clearRowError(m.id);
      try { await request({ type, id: m.id, hash: info.hash, tab: view.tab?.id }); } catch (e) { b.disabled = false; rowError(m.id, String(e?.message ?? e)); }
    });
    b.title = title;
    return b;
  };
  if (kind === 'pending') {
    box.append(actions(decide('mod.approve', 'Allow', 'The new version runs from the next page load.'),
      decide('mod.reject', 'Don\'t allow', 'The version before stays; the change is kept in its history (trif history).'), showDiff));
    box.append(diffView);
    return box;
  }
  if (kind === 'held' && info.by === 'sandbox') {
    box.append(actions(showCode));
    box.append(shown);
    return box;
  }
  if (kind === 'held') {
    box.append(actions(decide('mod.reject', 'Don\'t allow', 'It goes to the trash (trif restore brings it back).'), showCode));
    box.append(shown);
    return box;
  }
  if (kind === 'review') {
    const ok = button('Looks right', '', async () => {
      ok.disabled = true;
      clearRowError(m.id);
      try { await request({ type: 'mod.review', id: m.id }); } catch (e) { ok.disabled = false; rowError(m.id, String(e?.message ?? e)); }
    });
    ok.title = 'TRIF won\'t ask about these again for this mod (only if it gains something new).';
    box.append(actions(ok, showCode));
  } else box.append(actions(showCode));
  box.append(shown);
  return box;
}

// ---- the robot on TRIF's cards --------------------------------------------------------------------------
/**
 * The robot for a card's header (the approval, Ask, import and code cards), built afresh: his frame and
 * either his eyes or the code card's face, </> in his green. (Not a copy of the bar's robot, which carries
 * every face it can show: the pause bars, the cross, the broken link, hidden only there.)
 */
function cardRobot(face = 'eyes') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['rim', 'face', ...(face === 'eyes' ? ['eye'] : [])]) {
    for (const p of document.querySelectorAll(`#bar-robot svg polygon.${cls}`)) svg.append(p.cloneNode(false));
  }
  if (face === 'code') {
    const code = document.createElementNS(NS, 'path');
    code.setAttribute('class', 'code');
    code.setAttribute('d', 'M48 47 L31 64 L48 81 M80 47 L97 64 L80 81 M71 40 L57 88');
    svg.append(code);
  }
  return svg;
}

// ---- "Agent on this site" (agentsites.js; background.js agentGate) -------------------------------------
// On the line over the message box, after the agent and model: what the agent can do on the tab's site
// (Ask, the default; Off, Look or Run code), with a small icon, as a button that opens a menu. Only where
// there's a chat to have (the site connected and the robot on). A sensitive site (TRIF's list keeps the
// agent off) says so in the chat's first line. Settings: the sites chosen, and the sensitive list.
const agentSettingsNow = () => ({ sites: view.status?.agentSites || {}, sensitive: view.status?.sensitiveSites ?? null });
const LEVEL_WORDS = { off: 'Agent can’t see this site', look: 'Agent can look', ask: 'Agent asks before running code', run: 'Agent can run code' };
// (the icons: an eye crossed out, an eye, an eye with a question mark, code; drawn in currentColor)
const EYE = '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/>';
// (</>: thin strokes, sharp chevrons, a clear slash, the gaps open; .code-glyph in sidepanel.css)
const CODE_ICON = '<svg class="code-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.7 4 .9 8l3.8 4M11.3 4l3.8 4-3.8 4M9.3 2.3 6.7 13.7"/></svg>';
const LEVEL_ICONS = {
  off: `<svg viewBox="0 0 16 16">${EYE}<circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/></svg>`,
  look: `<svg viewBox="0 0 16 16">${EYE}<circle cx="8" cy="8" r="2"/></svg>`,
  ask: `<svg viewBox="0 0 16 16">${EYE}<path d="M6.7 6.7a1.4 1.4 0 1 1 1.9 1.3c-.4.2-.6.5-.6.9v.2"/><path d="M8 10.6v.1"/></svg>`,
  run: CODE_ICON,
};
const levelMenu = $('#agent-level-menu');
const levelItems = () => [...levelMenu.querySelectorAll('[role="menuitemradio"]')];
for (const b of levelItems()) b.querySelector('.agent-level-icon').innerHTML = LEVEL_ICONS[b.dataset.level];

function renderAgentLevel() {
  const site = agentSiteOf(view.tab?.url || '');
  const show = !!site && !!view.status?.helper?.connected && !!siteScope() && currentState() === 'on';
  const wrap = ui.agentLevel.parentElement;
  wrap.hidden = !show;
  ui.agentSiteNote.hidden = true;
  if (!show) { closeLevelMenu(false); return; }
  const lv = agentLevel(site, agentSettingsNow());
  const words = LEVEL_WORDS[lv.level];
  if (ui.agentLevel.dataset.level !== lv.level) {
    ui.agentLevel.dataset.level = lv.level;
    ui.agentLevel.querySelector('.agent-level-icon').innerHTML = LEVEL_ICONS[lv.level];
    ui.agentLevel.querySelector('.agent-level-text').textContent = words;
  }
  // (narrow: only the icon, the words its tooltip and label)
  ui.agentLevel.title = words;
  ui.agentLevel.setAttribute('aria-label', words);
  $('#agent-level-head').textContent = `What your agent can do on ${site}`;
  for (const b of levelItems()) b.setAttribute('aria-checked', String(b.dataset.level === lv.level));
  if (lv.by === 'sensitive') {
    ui.agentSiteNote.textContent = `Your agent can’t see ${site}: it’s ${lv.why || 'on your list of sensitive sites'}. Change it below.`;
    ui.agentSiteNote.hidden = false;
  }
}

function openLevelMenu() {
  levelMenu.hidden = false;
  ui.agentLevel.setAttribute('aria-expanded', 'true');
  (levelItems().find((b) => b.getAttribute('aria-checked') === 'true') || levelItems()[0]).focus();
}
function closeLevelMenu(focusButton = true) {
  if (levelMenu.hidden) return;
  levelMenu.hidden = true;
  ui.agentLevel.setAttribute('aria-expanded', 'false');
  if (focusButton) ui.agentLevel.focus();
}
ui.agentLevel.addEventListener('click', () => (levelMenu.hidden ? openLevelMenu() : closeLevelMenu()));
ui.agentLevel.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && levelMenu.hidden) { e.preventDefault(); openLevelMenu(); }
});
levelMenu.addEventListener('keydown', (e) => {
  const items = levelItems();
  const at = items.indexOf(document.activeElement);
  const go = (i) => { e.preventDefault(); items[(i + items.length) % items.length].focus(); };
  if (e.key === 'Escape') { e.preventDefault(); closeLevelMenu(); } else if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Tab') closeLevelMenu(false);
});
document.addEventListener('pointerdown', (e) => { if (!levelMenu.hidden && !ui.agentLevel.parentElement.contains(e.target)) closeLevelMenu(false); });
levelMenu.addEventListener('click', async (e) => {
  const b = e.target.closest('[role="menuitemradio"]');
  const site = agentSiteOf(view.tab?.url || '');
  if (!b || !site) return;
  closeLevelMenu();
  const v = b.dataset.level;
  try { await request({ type: 'agentSite.set', site, level: v === 'ask' ? null : v }); } catch (e2) { ui.agentLevel.title = String(e2?.message ?? e2); }
  refreshStatus();
});

function renderAgentSites() {
  const sites = view.status?.agentSites || {};
  const key = JSON.stringify(sites);
  if (ui.agentSitesList.dataset.key !== key) {
    ui.agentSitesList.dataset.key = key;
    ui.agentSitesList.replaceChildren(...Object.keys(sites).sort().map((site) => {
      const li = el('li');
      li.dataset.site = site;
      const sel = el('select');
      sel.setAttribute('aria-label', `Agent on ${site}`);
      for (const [v, t] of [['off', 'Off'], ['look', 'Look'], ['run', 'Run code']]) sel.append(new Option(t, v));
      sel.value = sites[site];
      sel.addEventListener('change', () => request({ type: 'agentSite.set', site, level: sel.value }).then(refreshStatus, () => {}));
      const forget = button('Ask again', '', () => request({ type: 'agentSite.set', site, level: null }).then(refreshStatus, () => {}));
      forget.title = 'Forget this choice: the site goes back to asking (or off, if it\'s on the sensitive list)';
      li.append(el('span', 'agent-site', site), sel, forget);
      return li;
    }));
  }
  ui.agentSitesEmpty.hidden = Object.keys(sites).length > 0;
  // (the sensitive list, as text: not while the user is editing it)
  const text = sensitiveList(view.status?.sensitiveSites ?? null).map((x) => (x.why ? `${x.pattern}: ${x.why}` : x.pattern)).join('\n');
  if (document.activeElement !== ui.sensitiveSites && ui.sensitiveSites.dataset.shown !== text) { ui.sensitiveSites.value = text; ui.sensitiveSites.dataset.shown = text; }
}
ui.sensitiveSave?.addEventListener('click', async () => {
  const list = ui.sensitiveSites.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 ? { pattern: l.slice(0, i).trim(), why: l.slice(i + 1).trim() } : { pattern: l, why: '' }; });
  try { await request({ type: 'agentSensitive.set', list }); ui.sensitiveNote.textContent = 'Saved.'; } catch (e) { ui.sensitiveNote.textContent = String(e?.message ?? e); }
  ui.sensitiveSites.dataset.shown = '';
  refreshStatus();
});
ui.sensitiveReset?.addEventListener('click', async () => {
  try { await request({ type: 'agentSensitive.set', list: null }); ui.sensitiveNote.textContent = 'TRIF\'s list again.'; } catch (e) { ui.sensitiveNote.textContent = String(e?.message ?? e); }
  ui.sensitiveSites.dataset.shown = '';
  refreshStatus();
});

// The Ask dialog: an agent wants to run code on a site set to Ask (background.js askToRun waits 25 s for
// this). Just this once (this run) / Always on this site (Run code) / Not here (Look). Esc or × closes it
// without an answer: the agent's command then fails, saying the user didn't answer.
const agentAsk = { id: null, dialog: null, answered: new Set() };
function showAgentAsk(id, site) {
  if (!id || agentAsk.answered.has(id)) return;
  if (!agentAsk.dialog) {
    const d = el('dialog', 'approval agent-ask');
    d.id = 'agent-ask';
    d.setAttribute('aria-labelledby', 'agent-ask-title');
    const top = el('div', 'ap-top');
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    top.append(el('span', 'ap-count', 'Your agent is asking'), x);
    const who = el('div', 'ap-who');
    const robot = el('span', 'ap-robot');
    robot.append(cardRobot());
    const title = el('h2', 'ap-name');
    title.id = 'agent-ask-title';
    who.append(robot, title);
    const text = el('p', 'ap-lead agent-ask-text', 'It can read everything you can see here.');
    const err = el('p', 'ap-err');
    err.hidden = true;
    const answer = (choice) => async () => {
      err.hidden = true;
      try { await request({ type: 'agentAsk.answer', id: agentAsk.id, choice }); agentAsk.answered.add(agentAsk.id); closeAgentAsk(); refreshStatus(); } catch (e) { err.textContent = String(e?.message ?? e); err.hidden = false; }
    };
    const acts = el('div', 'ap-actions');
    acts.append(button('Just this once', 'go agent-once', answer('once')), button('Always on this site', 'agent-always', answer('always')), button('Not here', 'text agent-no', answer('no')));
    x.addEventListener('click', () => { agentAsk.answered.add(agentAsk.id); closeAgentAsk(); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); agentAsk.answered.add(agentAsk.id); closeAgentAsk(); });
    d.append(top, who, text, err, acts);
    document.body.append(d);
    agentAsk.dialog = d;
  }
  agentAsk.id = id;
  agentAsk.dialog.dataset.site = site;
  agentAsk.dialog.querySelector('#agent-ask-title').textContent = `Your agent wants to run code on ${site}.`;
  if (!agentAsk.dialog.open) agentAsk.dialog.showModal();
}
function closeAgentAsk() {
  if (agentAsk.dialog?.open) agentAsk.dialog.close();
  agentAsk.id = null;
}

// ---- The approval dialog ---------------------------------------------------------------------------
// Every hold (a boxed mod's powers, a free mod TRIF found can do more, an agent's change waiting, and a boxed
// mod this browser can't sandbox) is one card centred over the dimmed panel: the mod, its kind, site and
// file, what it asks for or what TRIF found, the combination warnings in red, one note line; Allow, Show code,
// Not now (and × and Esc). Several waiting: "1 of N", one after another. It opens when a hold first appears,
// or when the panel opens with something waiting; after Not now, only a new hold opens it again: the rows say
// "on hold" and the badge at the top ("N waiting") reopens it.
const approval = { queue: [], at: 0, seen: new Set(), done: new Set(), dialog: null, parts: null, shownKey: null };
const holdKey = (m) => `${m.id}@${(m.held || m.pending)?.hash || ''}`;
const holdOf = (m) => m.held || m.pending;

function holdTag(m, text, labelId) {
  const b = el('button', 'tag on-hold', text);
  b.type = 'button';
  b.title = 'Waiting for your OK: open it';
  b.setAttribute('aria-describedby', labelId);
  b.addEventListener('click', () => openApproval(m.id));
  return b;
}

// (the icon beside each line: by what it is)
const FACT_ICONS = {
  'read-drafts': '✎', keys: '⌨', 'site-data': '⇣', 'page-data': '◫', sound: '♪', controls: '◐', mods: '⇆', media: '▶',
  'search-box': '⌕', 'go-to': '↪', click: '◉', 'write-drafts': '⇄',
  'site-storage': '▤', 'local-fonts': 'Aa', 'image-variants': '▣', preload: '⇡', embeds: '▷', 'rewrite-requests': '⇌', 'block-events': '⊘', 'page-events': '↯', 'edit-uploads': '⧉', migrate: '⇢',
  sends: '↗', loads: '↗', site: '↗', acts: '◉', navigates: '↪', hidden: '?', match: '◎', risk2: '⚠',
};
const iconOf = (key) => {
  const k = String(key || '');
  const p = /^power:([\w-]+)/.exec(k);
  return FACT_ICONS[p ? p[1] : k.split(':')[0]] || '•';
};

function approvalDialog() {
  if (approval.dialog) return approval.parts;
  const d = el('dialog', 'approval');
  d.id = 'approval';
  d.setAttribute('aria-labelledby', 'approval-name');
  const top = el('div', 'ap-top');
  const count = el('span', 'ap-count');
  const x = el('button', 'ap-x', '×');
  x.type = 'button';
  x.title = 'Not now';
  x.setAttribute('aria-label', 'Not now');
  top.append(count, x);
  const who = el('div', 'ap-who');
  const robot = el('span', 'ap-robot');
  robot.append(cardRobot());
  const nameBox = el('div');
  const name = el('h2', 'ap-name');
  name.id = 'approval-name';
  const meta = el('div', 'ap-meta');
  const chip = el('span', 'ap-chip');
  const where = el('span', 'ap-where');
  meta.append(chip, where);
  nameBox.append(name, meta);
  who.append(robot, nameBox);
  const lead = el('p', 'ap-lead');
  const facts = el('ul', 'ap-facts');
  const together = el('div', 'ap-together');
  const note = el('p', 'ap-note');
  const claim = el('p', 'ap-claim');
  const err = el('p', 'ap-err');
  err.setAttribute('role', 'alert');
  const codeBox = el('pre', 'ap-code');
  const allow = button('Allow', 'go ap-allow', () => decideApproval('mod.approve'));
  const show = button('Show code', 'ap-show', () => toggleApprovalCode());
  const reject = button('Don\'t allow', 'ap-reject', () => decideApproval('mod.reject'));
  reject.title = 'The version before stays; the change is kept in its history (trif history).';
  const later = button('Not now', 'text ap-later', () => notNow());
  x.addEventListener('click', () => notNow());
  const acts = el('div', 'ap-actions');
  acts.append(allow, show, reject, later);
  d.append(top, who, lead, facts, together, note, claim, err, codeBox, acts);
  // Esc is Not now; Tab stays in the card (showModal makes the panel inert, and this keeps the focus from
  // leaving for the browser's own controls too)
  d.addEventListener('cancel', (e) => { e.preventDefault(); notNow(); });
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...d.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.closest('[hidden]') && n.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.body.append(d);
  approval.dialog = d;
  approval.parts = { count, name, chip, where, lead, facts, together, note, claim, err, codeBox, allow, show, reject, later };
  return approval.parts;
}

// From renderMods: what's waiting here. Opens the dialog for a hold not seen before; keeps an open one in step.
function updateApprovals(mods) {
  approval.queue = mods.filter((m) => holdOf(m) && !approval.done.has(holdKey(m)));
  const fresh = approval.queue.filter((m) => !approval.seen.has(holdKey(m)));
  const open = !!approval.dialog?.open;
  if (open) {
    const cur = approval.queue.findIndex((m) => holdKey(m) === approval.shownKey);
    if (cur >= 0) approval.at = cur;
    else approval.at = Math.min(approval.at, approval.queue.length - 1);
    if (!approval.queue.length) closeApproval();
    else renderApproval();
  } else if (fresh.length && !document.querySelector('dialog[open]:not(#approval)')) {
    // (not over another of TRIF's cards, an import's question say: it opens when that one's done)
    approval.at = approval.queue.indexOf(fresh[0]);
    showApproval();
  }
  renderWaitingBadge();
}

function openApproval(id) {
  const i = approval.queue.findIndex((m) => m.id === id);
  approval.at = i >= 0 ? i : 0;
  if (approval.queue.length) showApproval();
}

function showApproval() {
  approvalDialog();
  for (const m of approval.queue) approval.seen.add(holdKey(m));
  renderApproval();
  if (!approval.dialog.open) approval.dialog.showModal();
  renderWaitingBadge();
}

function closeApproval() {
  if (approval.dialog?.open) approval.dialog.close();
  approval.shownKey = null;
  renderWaitingBadge();
}

// Not now: the next one waiting, or close (the rows and the badge keep it findable)
function notNow() {
  if (approval.at + 1 < approval.queue.length) { approval.at++; renderApproval(); return; }
  closeApproval();
}

function renderApproval() {
  const P = approvalDialog();
  const m = approval.queue[approval.at];
  if (!m) { closeApproval(); return; }
  const info = holdOf(m);
  const key = holdKey(m);
  const kind = m.held ? (info.by === 'sandbox' ? 'sandbox' : 'held') : 'pending';
  const n = approval.queue.length;
  P.count.textContent = n > 1 ? `${approval.at + 1} of ${n} waiting for your OK` : 'Waiting for your OK';
  if (approval.shownKey === key) return; // (the same hold: leave the code open, the buttons as they are)
  approval.shownKey = key;
  approval.dialog.dataset.mod = m.id;
  P.name.textContent = m.name || m.id;
  const k = m.rules ? ['style', 'Style mod'] : m.sandboxed ? ['boxed', 'Boxed mod'] : ['free', 'Free mod'];
  P.chip.className = `ap-chip ${k[0]}`;
  P.chip.textContent = k[1];
  const file = String(m.file || '').split(/[\\/]/).pop() || `${m.id.split('/').pop()}.js`;
  P.where.replaceChildren(`${info.site || m.id.split('/')[0]} · `, fileLink(file, 'Show the code', () => openCodeView(m.id)));
  P.lead.textContent = info.asks ? 'It asks for these powers. TRIF holds it to them:'
    : kind === 'pending' ? 'A change to it is waiting. TRIF found that the new version:'
      : kind === 'sandbox' ? 'This browser can\'t run it in TRIF\'s sandbox:'
        : 'TRIF found that this mod:';
  // the lines: each power or finding with its icon; the combinations (power:together:…) in the red box,
  // the strongest first as the helper sent them, a sentence once
  const needs = Array.isArray(info.needs) ? info.needs : [];
  const all = (Array.isArray(info.facts) ? info.facts : [String(info.reason || '')]).map((f, i) => ({ f, key: needs[i] || '' }));
  const plain = all.filter((x) => x.f && !/^power:together:/.test(x.key));
  const warns = [];
  for (const x of all) if (x.f && /^power:together:/.test(x.key) && !warns.some((w) => w.f === x.f)) warns.push(x);
  P.facts.replaceChildren(...plain.map((x) => {
    const li = el('li');
    li.append(el('span', 'ap-ic', iconOf(x.key)), el('span', null, info.asks ? `It ${x.f}.` : x.f));
    li.firstChild.setAttribute('aria-hidden', 'true');
    return li;
  }));
  P.together.replaceChildren(...warns.map((x) => {
    const line = el('p');
    if (/^power:together:many:/.test(x.key)) line.textContent = x.f;
    else line.append(el('b', null, 'Together,'), ` it ${x.f}.`);
    return line;
  }));
  P.together.hidden = !warns.length;
  const fromAgent = kind !== 'sandbox' && info.by !== 'outside';
  const who = m.imported && !fromAgent ? 'You imported it from a file.' : fromAgent ? `An agent ${kind === 'pending' ? 'changed' : 'wrote'} it in your chat on ${info.site || view.site}.` : 'It\'s new or changed since TRIF last let it run.';
  P.note.textContent = kind === 'sandbox' ? 'Allow runs this version as a free mod, in this browser only.'
    : kind === 'pending' ? `${who} The version before keeps running until you decide.`
      : info.asks ? `${who} Updates that ask for the same powers won't ask again.`
        : !m.rules && !m.sandboxed ? `${who} A free mod can do anything the page can, so look at the code if you're not sure.`
          : who;
  P.claim.replaceChildren();
  P.claim.hidden = !info.claim;
  if (info.claim) P.claim.append(el('span', 'ap-claim-who', fromAgent ? 'The agent says: ' : 'The mod says: '), document.createTextNode(`“${info.claim}”`));
  P.err.hidden = true;
  P.err.textContent = '';
  P.codeBox.hidden = true;
  P.codeBox.replaceChildren();
  P.show.textContent = kind === 'pending' ? 'Show what changed' : 'Show code';
  P.reject.hidden = kind !== 'pending';
  for (const b of [P.allow, P.show, P.reject]) b.disabled = false;
}

async function toggleApprovalCode() {
  const P = approval.parts;
  const m = approval.queue[approval.at];
  if (!m) return;
  const pending = !m.held && !!m.pending;
  if (!P.codeBox.hidden) { P.codeBox.hidden = true; P.show.textContent = pending ? 'Show what changed' : 'Show code'; return; }
  P.show.disabled = true;
  try {
    if (pending) {
      const r = await request({ type: 'mod.diff', id: m.id });
      P.codeBox.replaceChildren(...r.lines.map((l) => el('span', l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'ctx', `${l.t === '…' ? '…' : l.t} ${l.s}\n`)));
    } else {
      const r = await request({ type: 'mod.code', id: m.id });
      P.codeBox.textContent = r.code + (r.truncated ? '\n…' : '');
    }
    P.codeBox.hidden = false;
    P.show.textContent = pending ? 'Hide what changed' : 'Hide code';
  } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; } finally { P.show.disabled = false; }
}

async function decideApproval(type) {
  const P = approval.parts;
  const m = approval.queue[approval.at];
  if (!m) return;
  const info = holdOf(m);
  P.allow.disabled = P.reject.disabled = true;
  P.err.hidden = true;
  try {
    await request({ type, id: m.id, hash: info.hash, tab: view.tab?.id });
    // (done here; the next status drops it too) on to the next one, or close
    approval.done.add(holdKey(m));
    approval.queue.splice(approval.at, 1);
    approval.shownKey = null;
    if (!approval.queue.length) closeApproval();
    else { approval.at = Math.min(approval.at, approval.queue.length - 1); renderApproval(); }
  } catch (e) {
    P.allow.disabled = P.reject.disabled = false;
    P.err.textContent = String(e?.message ?? e);
    P.err.hidden = false;
  }
  renderWaitingBadge();
}

function renderWaitingBadge() {
  if (!ui.waitingBadge) return;
  const n = approval.queue.length;
  ui.waitingBadge.hidden = !n || !!approval.dialog?.open;
  ui.waitingBadge.textContent = `${n} waiting`;
  ui.waitingBadge.setAttribute('aria-label', `${n} ${n === 1 ? 'mod' : 'mods'} waiting for your OK: open`);
}

// A newer version of a mod TRIF ships, which didn't replace this copy because the user changed it
// (helper/lib/preinstalled.js): use it (theirs goes to the trash, with an Undo in the chat), keep theirs
// (this version isn't offered again), or have their agent merge the two in a chat run here.
function updateNotice(m, err) {
  const box = el('div', 'mod-update');
  const v = m.update.version ? ` (version ${m.update.version})` : '';
  box.append(el('p', null, m.update.modified
    ? `TRIF has a new version of this mod${v}. You've changed yours, so it wasn't replaced.`
    : `TRIF has a new version of this mod${v}.`));
  const fail = (b, e) => { b.disabled = false; rowError(m.id, String(e?.message ?? e)); };
  const choose = (choice) => async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    clearRowError(m.id);
    try { await request({ type: 'mod.update', id: m.id, choice, site: view.site, tab: view.tab?.id }); } catch (x) { fail(b, x); }
  };
  const useNew = button('Use the new version', '', choose('new'));
  useNew.title = m.update.modified ? 'Your copy goes to the trash (Undo in the chat brings it back).' : '';
  const keep = button('Keep mine', '', choose('mine'));
  keep.title = 'This version won\'t be offered again; a later one will.';
  const row = actions(useNew, keep);
  if (m.update.modified) {
    // A first run only proposes the merge; the agent edits once the user says so in the chat (see the
    // helper's mergeRequest and host.js).
    const merge = button('Merge with my agent', 'merge', async () => {
      if (view.merging.has(m.id)) return;
      view.merging.add(m.id); // not re-enabled by a render while the run is starting
      merge.disabled = true;
      clearRowError(m.id);
      try {
        await startRun(`Compare the new version of ${m.name}${v} from TRIF with my copy and suggest how to merge them, keeping my changes.`, { merge: m.id });
      } catch (x) { fail(merge, x); } finally { view.merging.delete(m.id); renderMods(); }
    });
    merge.title = 'Your agent looks at both versions and suggests how to merge them; nothing changes until you say so.';
    row.append(merge);
  }
  box.append(row);
  return box;
}

// A row's button failed: say why under it for a while. Kept here, not just written into the row, because
// every render rewrites the row's error line (the next status refresh would wipe it at once).
const ROW_ERROR_MS = 10000;
function rowError(id, message) {
  const old = view.modErrors.get(id);
  if (old) clearTimeout(old.timer);
  view.modErrors.set(id, { message, timer: setTimeout(() => { view.modErrors.delete(id); renderMods(); }, ROW_ERROR_MS) });
  renderMods();
}
function clearRowError(id) {
  const old = view.modErrors.get(id);
  if (old) { clearTimeout(old.timer); view.modErrors.delete(id); }
}

// Deleting moves the mod to the helper's trash (`trif restore`), so it's one click, with an Undo on
// the chat line it leaves, rather than a confirmation.
// ---- The code viewer: any mod's code, from the </> on its row --------------------------------------------
// The same card as the approval dialog: name, kind, site and file, then the code (a style mod: its rules,
// the file) with line numbers and light colouring; Copy, Show in Finder (the helper reveals the mod's own
// file, found by its id: helper/lib/reveal.js), Open in editor; × or Esc closes. A mod with a change
// waiting: the version running now, or the one waiting.
// A file name as a quiet link (a button): the code card, or in the code card, the file in its folder
function fileLink(text, title, onClick, cls = '') {
  const b = el('button', `file-link ${cls}`.trim(), text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function codeButton(m, labelId) {
  const b = el('button', 'icon-btn mod-code');
  b.type = 'button';
  b.title = 'Show code';
  b.setAttribute('aria-label', 'Show code');
  b.setAttribute('aria-describedby', labelId);
  b.innerHTML = CODE_ICON;
  b.addEventListener('click', () => openCodeView(m.id));
  return b;
}

const codeView = { dialog: null, parts: null, id: null, version: 'file', text: '' };
const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

function codeViewDialog() {
  if (codeView.dialog) return codeView.parts;
  const d = el('dialog', 'approval code-view');
  d.id = 'code-view';
  d.setAttribute('aria-labelledby', 'code-view-name');
  const top = el('div', 'ap-top');
  const x = el('button', 'ap-x', '×');
  x.type = 'button';
  x.title = 'Close';
  x.setAttribute('aria-label', 'Close');
  top.append(el('span', 'ap-count', 'Code'), x);
  const who = el('div', 'ap-who');
  const robot = el('span', 'ap-robot');
  robot.append(cardRobot('code')); // (the code card's own face: </> for eyes)
  const nameBox = el('div');
  const name = el('h2', 'ap-name');
  name.id = 'code-view-name';
  const meta = el('div', 'ap-meta');
  const chip = el('span', 'ap-chip');
  const where = el('span', 'ap-where');
  meta.append(chip, where);
  nameBox.append(name, meta);
  who.append(robot, nameBox);
  // (what the row leaves out: how noticeable it is, its powers, where it runs)
  const about = el('div', 'cv-about');
  // (a change waiting: which version)
  const versions = el('div', 'cv-versions');
  versions.setAttribute('role', 'group');
  versions.setAttribute('aria-label', 'Version');
  const vRan = button('Running now', 'cv-ran', () => loadCodeView('ran'));
  const vNew = button('Waiting for your OK', 'cv-new', () => loadCodeView('file'));
  versions.append(vRan, vNew);
  const errorBox = el('div', 'ap-together cv-error');
  errorBox.hidden = true;
  const codeBox = el('pre', `cv-code${codeWrap ? ' wrap' : ''}`);
  codeBox.tabIndex = 0;
  codeBox.setAttribute('aria-label', 'The mod\'s code');
  const note = el('p', 'ap-note cv-note');
  const err = el('p', 'ap-err');
  err.setAttribute('role', 'alert');
  // (two tabs under the header: the code, and the versions TRIF kept)
  const tabs = el('div', 'cv-tabs');
  tabs.setAttribute('role', 'tablist');
  const tab = (label, cls, fn) => { const b = button(label, `cv-tab ${cls}`, fn); b.setAttribute('role', 'tab'); return b; };
  const codeTab = tab('Code', 'cv-tab-code', () => showCodeTab());
  const historyBtn = tab('History', 'cv-tab-history', () => showHistoryTab());
  tabs.append(codeTab, historyBtn);
  // (a kept version shown in place: Diff with the current one, Restore)
  const hTools = el('div', 'cv-h-tools');
  hTools.hidden = true;
  const hDiff = button('See differences', 'cv-h-diff', () => showVersion(codeView.version_, !codeView.diff));
  hDiff.setAttribute('aria-pressed', 'false');
  const hRestore = button('Restore', 'cv-h-restore', (ev) => restoreVersion(ev.currentTarget));
  hTools.append(hDiff, hRestore);
  const copy = button('Copy', 'cv-copy', () => copyCode());
  const exportBtn = button('Export', 'cv-export', () => exportMod());
  // (the rest in a small menu: Open in editor, Show in Finder)
  const more = el('button', 'btn cv-more', '⋯');
  more.type = 'button';
  more.title = 'More';
  more.setAttribute('aria-label', 'More');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  const menu = el('div', 'pop-menu cv-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const item = (label, cls, fn) => { const b = button(label, `menu-item ${cls}`, () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); fn(); }); b.setAttribute('role', 'menuitem'); return b; };
  const editor = item('Open in editor', 'cv-editor', () => revealMod('editor'));
  const reveal = item(IS_MAC ? 'Show in Finder' : 'Show in folder', 'cv-reveal', () => revealMod('folder'));
  const wrap = item('Wrap lines', 'cv-wrap', () => {
    codeWrap = !codeWrap;
    try { localStorage.setItem('codeWrap', codeWrap ? 'on' : 'off'); } catch { /* this time only */ }
    codeBox.classList.toggle('wrap', codeWrap);
    wrap.setAttribute('aria-checked', String(codeWrap));
  });
  wrap.setAttribute('role', 'menuitemcheckbox');
  wrap.setAttribute('aria-checked', String(codeWrap));
  menu.append(editor, reveal, wrap);
  more.addEventListener('click', () => { menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); });
  x.addEventListener('click', () => d.close());
  const moreWrap = el('span', 'cv-more-wrap');
  moreWrap.append(more, menu);
  const acts = el('div', 'ap-actions');
  acts.append(copy, exportBtn, moreWrap);
  const historyBox = el('ul', 'cv-history-list');
  historyBox.hidden = true;
  d.append(top, who, about, tabs, versions, errorBox, hTools, codeBox, historyBox, note, err, acts);
  d.addEventListener('close', () => setTimeout(() => renderMods(), 0)); // (a hold that came meanwhile: its card now)
  document.body.append(d);
  codeView.dialog = d;
  codeView.parts = { name, chip, where, about, versions, vRan, vNew, errorBox, codeBox, historyBox, historyBtn, codeTab, hTools, hDiff, hRestore, exportBtn, more, menu, note, err, copy, reveal, editor };
  return codeView.parts;
}

function openCodeView(id, { error = null } = {}) {
  const m = (view.status?.mods || []).find((x) => x.id === id);
  if (!m) return;
  const P = codeViewDialog();
  codeView.id = id;
  codeView.dialog.dataset.mod = id;
  P.name.textContent = m.name || m.id;
  const k = m.rules ? ['style', 'Style mod'] : m.sandboxed ? ['boxed', 'Boxed mod'] : ['free', 'Free mod'];
  P.chip.className = `ap-chip ${k[0]}`;
  P.chip.textContent = k[1];
  P.where.replaceChildren(`${m.id.split('/')[0]} · `, fileLink(String(m.file || '').split(/[\\/]/).pop() || `${m.id.split('/').pop()}.js`,
    IS_MAC ? 'Show in Finder' : 'Show in folder', () => revealMod('folder'), 'cv-file'),
    ...(m.source === 'webmods' || m.source === 'trif' ? [' · ', el('span', 'cv-source', `Tim's mod${m.version ? `, v${m.version}` : ''}`)] : []));
  const { everywhere, sites } = modSites(m);
  const site = m.id.split('/')[0];
  const lines = [
    ...(modLevel(m) ? [levelWords(m, view.site || site)] : []),
    ...powerLines(m).map((l) => `Power: ${l}`),
    ...(m.powerInfo?.warnings || []).map((w) => w.charAt(0).toUpperCase() + w.slice(1)),
    ...(everywhere ? ['Runs on every site.'] : sites.length > 1 ? [`Runs on ${sites.join(', ')}.`] : []),
    ...(m.from ? [`Made from ${m.from}.`] : []),
    ...(m.enabled !== false && !m.registered && !m.held ? [view.status?.userScripts ? 'Not active right now.' : 'Paused: user scripts are off.'] : []),
  ];
  P.about.replaceChildren(...lines.map((l) => el('p', null, l)));
  P.about.hidden = !lines.length;
  P.versions.hidden = !m.pending;
  P.copy.textContent = 'Copy';
  delete P.copy.dataset.copied;
  // (Show in Finder and Open in editor: the helper does them)
  const connected = !!view.status?.helper?.connected;
  setCodeTab('code');
  P.menu.hidden = true;
  for (const b of [P.reveal, P.editor, P.historyBtn, P.exportBtn]) {
    b.disabled = !connected;
    b.title = connected ? '' : 'TRIF\'s helper isn\'t connected, so it can\'t open the file';
  }
  const fl = P.where.querySelector('.cv-file');
  if (fl && !connected) fl.title = 'TRIF\'s helper isn\'t connected, so it can\'t open the file';
  // (Show error: the error above the code, its line marked and in view)
  codeView.error = error;
  P.errorBox.hidden = !error;
  P.errorBox.replaceChildren();
  if (error) P.errorBox.append(el('b', null, error.quiet ? 'May be broken: ' : `New error${error.line ? ` at line ${error.line}` : ''}: `), error.quiet ? 'nothing it looks for is on the page any more.' : String(error.message || ''));
  if (!codeView.dialog.open) codeView.dialog.showModal();
  loadCodeView('file');
}

async function loadCodeView(version) {
  const P = codeView.parts;
  const id = codeView.id;
  codeView.version = version;
  P.vRan.setAttribute('aria-pressed', String(version === 'ran'));
  P.vNew.setAttribute('aria-pressed', String(version !== 'ran'));
  P.err.hidden = true;
  P.note.hidden = true;
  P.codeBox.replaceChildren();
  let r;
  try {
    r = await request({ type: 'mod.code', id, ...(version === 'ran' ? { version: 'ran' } : {}) });
  } catch (e) {
    // (the helper away: what this extension has, for a free or boxed mod)
    try { r = version === 'ran' ? null : await request({ type: 'mod.localCode', id }); } catch { r = null; }
    if (!r) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; return; }
  }
  if (codeView.id !== id || codeView.version !== version) return;
  codeView.text = String(r.code ?? '');
  renderCode(P.codeBox, codeView.text);
  const line = codeView.error?.line && version !== 'ran' ? P.codeBox.children[codeView.error.line - 1] : null;
  if (line) { line.classList.add('hl'); line.scrollIntoView({ block: 'center' }); }
  if (r.truncated || r.local) {
    P.note.textContent = r.truncated ? 'Showing the first 200,000 characters.' : 'From the browser: TRIF\'s helper isn\'t connected.';
    P.note.hidden = false;
  }
}

// Light colouring, no library: comments, strings, keywords and numbers, by one pattern (a long file: plain).
const CODE_TOKENS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`)|\b(const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|async|await|try|catch|finally|throw|true|false|null|undefined|this|typeof|instanceof|switch|case|break|continue|default|delete|void|yield)\b|\b(\d+(?:\.\d+)?)\b/g;
function renderCode(box, text) {
  const pieces = [];
  if (text.length <= 300000) {
    let at = 0;
    for (const t of text.matchAll(CODE_TOKENS)) {
      if (t.index > at) pieces.push([text.slice(at, t.index), null]);
      pieces.push([t[0], t[1] ? 'c' : t[2] ? 's' : t[3] ? 'k' : 'n']);
      at = t.index + t[0].length;
    }
    if (at < text.length) pieces.push([text.slice(at), null]);
  } else pieces.push([text, null]);
  // one element per line (CSS numbers them), each piece split at its line breaks; the line's text in an
  // inner span, so a wrapped line's continuations hang at its own indentation (codeLine)
  const source = text.split('\n');
  let line = codeLine('l', '', source[0]);
  const lines = [line];
  for (const [t, cls] of pieces) {
    const parts = t.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) { line = codeLine('l', '', source[lines.length]); lines.push(line); }
      if (part) line.firstChild.append(cls ? el('span', `t${cls}`, part) : document.createTextNode(part));
    });
  }
  box.replaceChildren(...lines);
}

/**
 * A line of code: span.l (numbered by CSS, once per source line) holding span.lc with `text`; --ind, the
 * line's own indentation (tabs as 2), plus `extra` characters, is where its wrapped continuations start.
 */
function codeLine(cls, text, source = text, extra = 0) {
  const line = el('span', cls);
  const lead = /^[ \t]*/.exec(source || '')[0];
  line.style.setProperty('--ind', `${[...lead].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0) + extra}ch`);
  line.append(el('span', 'lc', text));
  return line;
}

// Long lines wrap in the code card (on by default; the ⋯ menu's Wrap lines, remembered in this browser)
let codeWrap = true;
try { codeWrap = localStorage.getItem('codeWrap') !== 'off'; } catch { /* no storage: on */ }

// History (helper lib/history.js): the versions TRIF kept of this mod, with View, Diff with current and
// Restore; the code again from the same button.
const HISTORY_SOURCE = {
  chat: 'before your agent changed it in a chat', fix: 'before a fix', restore: 'before you restored an older version',
  import: 'before an import replaced it', undo: 'before an undo',
};
// The tabs: the code, or History (the versions kept; one clicked is shown in place, with Diff and Restore)
function setCodeTab(which) {
  const P = codeView.parts;
  P.codeTab.setAttribute('aria-selected', String(which === 'code'));
  P.historyBtn.setAttribute('aria-selected', String(which !== 'code'));
  P.historyBox.hidden = which !== 'history';
  P.codeBox.hidden = which === 'history';
  P.hTools.hidden = which !== 'version';
  if (which !== 'code') P.versions.hidden = true;
  codeView.tab = which;
}
function showCodeTab() {
  const P = codeView.parts;
  P.note.hidden = true;
  setCodeTab('code');
  const m = (view.status?.mods || []).find((x) => x.id === codeView.id);
  P.versions.hidden = !m?.pending;
  loadCodeView('file');
}
async function showHistoryTab() {
  const P = codeView.parts;
  P.err.hidden = true;
  P.note.hidden = true;
  setCodeTab('history');
  let r;
  try { r = await request({ type: 'mod.history', id: codeView.id }); } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; return; }
  const entries = (r.entries || []).filter((e) => e.kind === 'version');
  if (!entries.length) { P.historyBox.replaceChildren(el('li', 'cv-history-empty', 'No earlier versions kept. TRIF keeps the version before each change your agent makes, a fix, a restore or an import, for 30 days.')); return; }
  P.historyBox.replaceChildren(...entries.map((e) => {
    const li = el('li');
    li.dataset.stamp = e.stamp;
    const when = new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const row = el('button', 'cv-h-row');
    row.type = 'button';
    row.append(el('span', 'cv-h-when', when), el('span', 'cv-h-from', e.source ? HISTORY_SOURCE[e.source] || '' : ''));
    row.addEventListener('click', () => showVersion({ ...e, when }, false));
    li.append(row);
    return li;
  }));
}

// A kept version in place of the list: its text, or (Diff) what changed since, with Restore
async function showVersion(e, diff) {
  if (!e) return;
  const P = codeView.parts;
  P.err.hidden = true;
  codeView.version_ = e;
  codeView.diff = diff;
  try {
    const r = await request({ type: diff ? 'mod.historyDiff' : 'mod.historyCode', id: codeView.id, stamp: e.stamp });
    if (diff) P.codeBox.replaceChildren(...r.lines.map((l) => codeLine(`l ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'}`, `${l.t === '…' ? '…' : l.t} ${l.s}`, l.s, 2)));
    else { codeView.text = String(r.code ?? ''); renderCode(P.codeBox, codeView.text); }
    setCodeTab('version');
    P.hDiff.setAttribute('aria-pressed', String(!!diff));
    P.hRestore.disabled = false;
    P.note.textContent = diff ? `What changed since the version from ${e.when} (- then, + now).` : `The version from ${e.when}.`;
    P.note.hidden = false;
  } catch (x) { P.err.textContent = String(x?.message ?? x); P.err.hidden = false; }
}

async function restoreVersion(b) {
  const P = codeView.parts;
  const e = codeView.version_;
  if (!e) return;
  b.disabled = true;
  try {
    await request({ type: 'mod.historyRestore', id: codeView.id, stamp: e.stamp });
    const said = `Restored the version from ${e.when}. The one before is in History.`;
    setCodeTab('code');
    setTimeout(() => loadCodeView('file').then(() => { P.note.textContent = said; P.note.hidden = false; }), 800);
  } catch (x) { b.disabled = false; P.err.textContent = String(x?.message ?? x); P.err.hidden = false; }
}

async function exportMod() {
  const P = codeView.parts;
  P.err.hidden = true;
  try {
    const r = await request({ type: 'mod.export', id: codeView.id });
    P.note.textContent = `Exported to ${IS_MAC ? 'Downloads' : 'your downloads folder'} as ${r.file}: send it to a friend, who imports it with Import mod… (or drops it on TRIF's panel).`;
    P.note.hidden = false;
  } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; }
}

// ---- Import, export, a site's files, and dropping files on the panel (helper lib/share.js) -------------
function renderSiteTools() {
  const site = view.site;
  const ok = !!site && !!view.status?.helper?.connected;
  ui.modsMore.hidden = !ok;
  if (!ok) { ui.modsMenu.hidden = true; ui.siteFilesBox.hidden = true; return; }
  const mine = (view.status?.mods || []).filter((m) => m.id.startsWith(`${site}/`));
  ui.exportSite.hidden = !mine.length;
  ui.exportSite.textContent = `Export all mods for ${site}`;
  if (view.filesFor !== site) { view.filesFor = site; loadSiteFiles(); }
}

async function loadSiteFiles() {
  const site = view.site;
  let files = [];
  try { files = (await request({ type: 'files.list', site })).files || []; } catch { files = []; }
  if (site !== view.site) return;
  view.siteFileCount = files.length;
  ui.siteFilesBox.hidden = !files.length;
  ui.siteFilesSummary.textContent = `Files (${files.length})`;
  if (!files.length) { ui.siteFiles.replaceChildren(); renderMods(); return; }
  const show = el('button', 'link-btn', IS_MAC ? 'Show in Finder' : 'Show in folder');
  show.type = 'button';
  show.addEventListener('click', () => request({ type: 'files.reveal', site }).catch(() => {}));
  if (ui.mods.hidden) renderMods(); // (a site with files and no mods: the box shows, for them)
  ui.siteFiles.replaceChildren(...files.slice(0, 12).flatMap((f) => {
    const x = el('button', 'file-x', '×');
    x.type = 'button';
    x.title = `Remove ${f.name} (to TRIF's trash)`;
    x.setAttribute('aria-label', `Remove ${f.name}`);
    x.addEventListener('click', async () => { x.disabled = true; try { await request({ type: 'files.remove', site, name: f.name }); } catch { x.disabled = false; } view.filesFor = null; renderSiteTools(); });
    const item = el('span', 'site-file');
    item.dataset.name = f.name;
    item.append(el('span', null, f.name), x);
    return [item];
  }), ...(files.length > 12 ? [el('span', 'files-more', `and ${files.length - 12} more`)] : []), show);
}

// (the ⋯ on the Mods header: inside its summary, so its clicks don't open or close the box)
ui.modsMore?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ui.modsMenu.hidden = !ui.modsMenu.hidden; ui.modsMore.setAttribute('aria-expanded', String(!ui.modsMenu.hidden)); });
ui.modsMenu?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.mods-more-wrap') && ui.modsMenu && !ui.modsMenu.hidden) { ui.modsMenu.hidden = true; ui.modsMore.setAttribute('aria-expanded', 'false'); }
  const cm = codeView.parts;
  if (cm && !cm.menu.hidden && !e.target.closest?.('.cv-more-wrap')) { cm.menu.hidden = true; cm.more.setAttribute('aria-expanded', 'false'); }
});
ui.importMod?.addEventListener('click', () => { ui.modsMenu.hidden = true; ui.importFile.click(); });
ui.importFile?.addEventListener('change', async () => {
  const f = ui.importFile.files?.[0];
  ui.importFile.value = '';
  if (f) await importModFile(f);
});
ui.exportSite?.addEventListener('click', async () => {
  ui.modsMenu.hidden = true;
  try {
    const r = await request({ type: 'mod.exportSite', site: view.site });
    request({ type: 'chat.note', site: view.site, text: `Exported ${r.ids.length} mod${r.ids.length === 1 ? '' : 's'} for ${r.site} to the folder "${r.dir}" in ${IS_MAC ? 'Downloads' : 'your downloads folder'}.` }).catch(() => {});
  } catch (e) { request({ type: 'chat.note', site: view.site, text: `Couldn't export: ${e?.message ?? e}` }).catch(() => {}); }
});

// A small card for the import's questions (which site; a copy or Replace): resolves the choice, or null
function askCard(title, text, choices) {
  return new Promise((resolve) => {
    resolve = ((r) => (v) => { r(v); setTimeout(() => renderMods(), 0); })(resolve);
    const d = el('dialog', 'approval import-ask');
    d.id = 'import-ask';
    const top = el('div', 'ap-top');
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Cancel');
    top.append(el('span', 'ap-count', 'Import mod'), x);
    const acts = el('div', 'ap-actions');
    const done = (v) => { siteCards.delete(cancel); d.close(); d.remove(); resolve(v); };
    const cancel = () => done(null);
    siteCards.add(cancel); // (another site's tab: cancelled, leaveSite)
    for (const [label, value, cls] of choices) acts.append(button(label, cls || '', () => done(value)));
    acts.append(button('Cancel', 'text', () => done(null)));
    x.addEventListener('click', () => done(null));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    d.append(top, el('h2', 'ap-name', title), el('p', 'ap-lead', text), acts);
    document.body.append(d);
    d.showModal();
  });
}

async function importModFile(file) {
  const note = (text) => request({ type: 'chat.note', site: view.site, text }).catch(() => {});
  if (file.size > 4 * 1024 * 1024) return note(`Couldn't import ${file.name}: it's bigger than a mod can be (4 MB).`);
  const text = await file.text();
  let site = '';
  let choice = '';
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = await request({ type: 'mod.import', text, name: file.name, site, choice, chatSite: view.site }); } catch (e) { return note(`Couldn't import ${file.name}: ${e?.message ?? e}`); }
    if (r.needsSite) {
      const sites = [...new Set([...(r.needsSite || []), view.site].filter(Boolean))].slice(0, 5);
      site = await askCard('Which site is this mod for?', `${file.name} doesn't say which site it's for${r.needsSite.length ? ` (its @match lines name ${r.needsSite.join(', ')})` : ''}.`, sites.map((s, k) => [s, s, k === 0 ? 'go' : '']));
      if (!site) return;
      continue;
    }
    if (r.exists) {
      choice = await askCard(`${r.exists} is here already`, `Add ${file.name} beside it as a copy, or replace it? (The one there is kept in its history.)`, [['Add as a copy', 'copy', 'go'], ['Replace', 'replace', '']]);
      if (!choice) return;
      continue;
    }
    return;
  }
}

// Dropping files on the panel, the chat included: a .js is imported; anything else goes in the site's files
// (data for its mods and runs), or, while the user is typing, attached to their next message.
let dragDepth = 0;
const isMod = (name, type) => /\.js$/i.test(name || '') || /javascript/i.test(type || '');
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  const items = [...(e.dataTransfer.items || [])];
  const js = items.length && items.every((it) => it.kind === 'file' && isMod('', it.type));
  ui.dropText.textContent = !view.site ? 'Open a site\'s tab to add files to it' : js ? 'Drop to import this mod' : `Add to ${view.site}'s files`;
  ui.dropOverlay.hidden = false;
});
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.dropOverlay.hidden = true; });
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  if (!view.site || !view.status?.helper?.connected) return;
  for (const f of [...e.dataTransfer.files].slice(0, 10)) {
    if (isMod(f.name, f.type)) { await importModFile(f); continue; }
    await addSiteFile(f);
  }
});

async function addSiteFile(f) {
  const site = view.site;
  const note = (text) => request({ type: 'chat.note', site, text }).catch(() => {});
  const typing = !!ui.input.value.trim();
  // (a slice at a time, so a big file is never all in memory: the helper appends them, then renames it into place)
  let id = null;
  const progress = el('p', 'note file-progress');
  const big = f.size > 2 * FILE_SLICE;
  try {
    id = (await request({ type: 'files.begin', site, name: f.name, size: f.size })).id;
    if (big) { progress.textContent = `Adding ${f.name}… 0%`; ui.messages.after(progress); }
    for (let at = 0; at < f.size; at += FILE_SLICE) {
      const bytes = new Uint8Array(await f.slice(at, at + FILE_SLICE).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await request({ type: 'files.slice', id, offset: at, data: btoa(bin) });
      if (big) progress.textContent = `Adding ${f.name}… ${Math.floor(Math.min(1, (at + FILE_SLICE) / f.size) * 100)}%`;
    }
    const r = await request({ type: 'files.end', id, attach: typing });
    id = null;
    if (typing) ui.input.value = `${ui.input.value.replace(/\s+$/, '')} [attached: files/${r.name}]`;
  } catch (e) {
    if (id) request({ type: 'files.abort', id }).catch(() => {});
    progress.remove();
    return note(`Couldn't add ${f.name}: ${e?.message ?? e}`);
  }
  progress.remove();
  view.filesFor = null;
  renderSiteTools();
}
const FILE_SLICE = 4 * 1024 * 1024;

async function copyCode() {
  const P = codeView.parts;
  let ok = false;
  try { await navigator.clipboard.writeText(codeView.text); ok = true; } catch {
    // (no clipboard API here: the old way, from a selection)
    const ta = el('textarea');
    ta.value = codeView.text;
    codeView.dialog.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  P.copy.textContent = ok ? 'Copied' : 'Couldn\'t copy';
  P.copy.dataset.copied = String(ok);
  setTimeout(() => { if (codeView.parts) codeView.parts.copy.textContent = 'Copy'; }, 1500);
}

async function revealMod(how) {
  const P = codeView.parts;
  P.err.hidden = true;
  try { await request({ type: 'mod.reveal', id: codeView.id, how }); } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; }
}

function deleteButton(m, labelId, li) {
  const b = el('button', 'icon-btn mod-delete');
  b.type = 'button';
  b.title = 'Delete';
  b.setAttribute('aria-label', 'Delete');
  b.setAttribute('aria-describedby', labelId);
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V2.75h3V4.5M4 4.5l.7 8.75h6.6L12 4.5M6.75 7v4M9.25 7v4"/></svg>';
  b.addEventListener('click', async () => {
    b.disabled = true;
    clearRowError(m.id);
    try {
      await request({ type: 'mod.delete', id: m.id, site: view.site, tab: view.tab?.id });
    } catch (e) {
      b.disabled = false;
      rowError(m.id, String(e?.message ?? e));
    }
  });
  return b;
}

// ---- reordering ---------------------------------------------------------------------------------
// The mods can be put in any order, per site: dragged by the grip (or anywhere on the row that isn't a
// button), or with Alt+↑/↓ (and ↑/↓, Home and End on the grip). Display only: chrome.storage.local
// `modOrder` (lib.js), never the order mods run in.

function gripButton(labelId) {
  const b = el('button', 'icon-btn mod-grip');
  b.type = 'button';
  b.title = 'Drag to reorder the list (or Alt+↑ / Alt+↓). It only changes how they\'re listed, not the order they run in.';
  b.setAttribute('aria-label', 'Move');
  b.setAttribute('aria-describedby', labelId);
  b.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    [5, 11].flatMap((x) => [3.5, 8, 12.5].map((y) => `<circle cx="${x}" cy="${y}" r="1.25"/>`)).join('') + '</svg>';
  return b;
}

const rowIds = () => [...ui.modList.children].filter((li) => li.dataset.mod).map((li) => li.dataset.mod);
const rowName = (li) => li.querySelector('.mod-name > span:not(.light)')?.textContent || li.dataset.mod;

/** Keep the list's current order as this site's (the rows are already where they belong). */
function saveModOrder(li) {
  const scope = siteScope();
  if (!scope) return;
  const ids = rowIds();
  view.modOrder = setModOrder(view.modOrder, scope, ids, view.modNatural);
  chrome.storage.local.set({ modOrder: view.modOrder }).catch((e) => console.warn('[TRIF] couldn\'t save the mod order', e));
  ui.modsLive.textContent = `${rowName(li)} moved to position ${ids.indexOf(li.dataset.mod) + 1} of ${ids.length}.`;
}

/**
 * Put row `li` at position `to` among the mod rows by moving the rows around it (so a pointer captured by
 * `li` stays on it). Rows stay within their group: the group headings aren't crossed.
 */
function placeRow(li, to) {
  const at = () => rowIds().indexOf(li.dataset.mod);
  const same = (x) => x && x.dataset.mod && x.dataset.group === li.dataset.group;
  while (at() < to && same(li.nextElementSibling)) li.before(li.nextElementSibling);
  while (at() > to && same(li.previousElementSibling)) li.after(li.previousElementSibling);
}

// The keyboard: Alt+↑/↓ anywhere in a row; on the grip, ↑/↓, Home and End too.
ui.modList.addEventListener('keydown', (e) => {
  if (modDrag) return;
  const li = e.target.closest?.('#mod-list > li');
  if (!li || !li.dataset.mod || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const onGrip = !!e.target.closest('.mod-grip');
  const ids = rowIds();
  const from = ids.indexOf(li.dataset.mod);
  let to = null;
  if (e.key === 'ArrowUp' && (e.altKey || onGrip)) to = from - 1;
  else if (e.key === 'ArrowDown' && (e.altKey || onGrip)) to = from + 1;
  else if (e.key === 'Home' && onGrip && !e.altKey) to = 0;
  else if (e.key === 'End' && onGrip && !e.altKey) to = ids.length - 1;
  if (to === null) return;
  e.preventDefault();
  if (moveId(ids, li.dataset.mod, to) === ids) return;
  const focused = document.activeElement;
  placeRow(li, Math.max(0, Math.min(ids.length - 1, to)));
  if (focused && li.contains(focused) && document.activeElement !== focused) focused.focus();
  li.scrollIntoView({ block: 'nearest' });
  saveModOrder(li);
});

// The pointer: a press that moves a few pixels picks the row up; it follows the pointer, the other rows
// make way, and letting go puts it there (Escape, or the browser taking the pointer, puts it back).

ui.modList.addEventListener('pointerdown', (e) => {
  if (modDrag || e.button !== 0 || !e.isPrimary) return;
  const li = e.target.closest('#mod-list > li');
  if (!li || !li.dataset.mod || rowIds().length < 2) return;
  const onGrip = !!e.target.closest('.mod-grip');
  // Buttons (the switch, delete, Allow…), the update offer and error text keep their clicks and text
  // selection; on a touch screen only the grip drags (elsewhere a finger scrolls the list).
  if (!onGrip && (e.pointerType === 'touch' || e.target.closest('button, a, input, select, textarea, .mod-update, .mod-err'))) return;
  if (onGrip) e.preventDefault(); // (no text selection starting from the grip)
  modDrag = { li, pointerId: e.pointerId, startY: e.clientY, y: e.clientY, started: false, dirty: false };
  document.addEventListener('pointermove', onModDragMove);
  document.addEventListener('pointerup', onModDragUp);
  document.addEventListener('pointercancel', onModDragCancel);
  document.addEventListener('keydown', onModDragKey, true);
});

function onModDragKey(e) {
  if (e.key !== 'Escape' || !modDrag?.started) return;
  e.preventDefault();
  e.stopPropagation();
  endModDrag(false);
}

function onModDragMove(e) {
  const d = modDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  d.y = e.clientY;
  if (!d.started) {
    if (Math.abs(e.clientY - d.startY) < DRAG_PX) return;
    d.started = true;
    d.ids = rowIds();
    d.grabDy = d.startY - d.li.getBoundingClientRect().top;
    try { d.li.setPointerCapture(d.pointerId); } catch { /* the pointer's gone already */ }
    window.getSelection()?.removeAllRanges();
    ui.modList.classList.add('dragging');
    d.li.classList.add('drag');
    const step = () => { if (modDrag !== d) return; autoScroll(d); followPointer(d); d.frame = requestAnimationFrame(step); };
    d.frame = requestAnimationFrame(step);
  }
  e.preventDefault();
  followPointer(d);
}

// Near the list's top or bottom edge, the list scrolls (faster the closer the pointer).
function autoScroll(d) {
  const r = ui.modList.getBoundingClientRect();
  const over = d.y < r.top + EDGE_PX ? d.y - (r.top + EDGE_PX) : d.y > r.bottom - EDGE_PX ? d.y - (r.bottom - EDGE_PX) : 0;
  if (over) ui.modList.scrollTop += Math.max(-12, Math.min(12, over / 2));
}

function followPointer(d) {
  const list = ui.modList;
  const { li } = d;
  const r = list.getBoundingClientRect();
  const h = li.offsetHeight;
  const top = Math.max(0, Math.min(list.scrollHeight - h, d.y - r.top - list.clientTop + list.scrollTop - d.grabDy));
  const mid = top + h / 2;
  // (positions among the mod rows: the group headings aren't rows, and a row stays in its group: placeRow)
  const others = [...list.children].filter((x) => x !== li && x.dataset.mod);
  let to = others.findIndex((x) => x.offsetTop + x.offsetHeight / 2 > mid);
  if (to === -1) to = others.length;
  if (to !== rowIds().indexOf(li.dataset.mod)) {
    // The rows that make way slide there (unless reduced motion turns that off, in CSS).
    const before = new Map(others.map((x) => [x, x.offsetTop]));
    placeRow(li, to);
    for (const x of others) {
      const dy = before.get(x) - x.offsetTop;
      if (!dy) continue;
      x.style.transition = 'none';
      x.style.transform = `translateY(${dy}px)`;
      x.getBoundingClientRect(); // (start from there)
      x.style.transition = '';
      x.style.transform = '';
    }
  }
  li.style.transform = `translateY(${top - li.offsetTop}px)`;
}

function onModDragUp(e) { if (modDrag && e.pointerId === modDrag.pointerId) endModDrag(true); }
function onModDragCancel(e) { if (modDrag && e.pointerId === modDrag.pointerId) endModDrag(false); }

function endModDrag(keep) {
  const d = modDrag;
  if (!d) return;
  modDrag = null;
  document.removeEventListener('pointermove', onModDragMove);
  document.removeEventListener('pointerup', onModDragUp);
  document.removeEventListener('pointercancel', onModDragCancel);
  document.removeEventListener('keydown', onModDragKey, true);
  if (d.started) {
    cancelAnimationFrame(d.frame);
    try { d.li.releasePointerCapture(d.pointerId); } catch { /* released already */ }
    d.li.style.transform = '';
    d.li.classList.remove('drag');
    ui.modList.classList.remove('dragging');
    if (!keep) {
      for (const id of d.ids) { const x = [...ui.modList.children].find((c) => c.dataset.mod === id); if (x) ui.modList.append(x); }
      renderMods(); // (the group headings back in their places)
    } else if (rowIds().join('\n') !== d.ids.join('\n')) saveModOrder(d.li);
    // The click that ends a drag isn't one.
    const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  }
  if (d.dirty) renderMods();
}

// Green when the mod runs on the tab's page: switched on (here), matching this URL, not on hold.
function updateLight(li, m, on) {
  const light = li.querySelector('.light');
  const running = on && !m.held && modAppliesTo(withOffSites(m, offSitesFor(m, view.offSites, normalizeGroupsOff(view.status?.groupsOff))), view.tab?.url || '');
  light.classList.toggle('on', running);
  light.title = running ? 'Running on this page' : m.held ? 'On hold' : !on ? 'Switched off' : 'Not running on this page';
}

function updateModItem(li, m) {
  if (!m) return;
  li.dataset.group = modGroup(m);
  li.classList.toggle('group-off', groupOff(modGroup(m)));
  // One chat run at a time per site: merging waits for the one going.
  const merge = li.querySelector('.mod-update .merge');
  if (merge) {
    merge.disabled = view.merging.has(m.id) || !!view.chat.run || !ui.composer.dataset.canSend;
    merge.title = view.chat.run ? 'Your agent is busy in this chat; this waits until it\'s done.'
      : !ui.composer.dataset.canSend ? (ui.send.title !== 'Send' ? `${ui.send.title}.` : 'No coding agent is available here yet.')
        : 'Your agent looks at both versions and suggests how to merge them; nothing changes until you say so.';
  }
  const rowErr = view.modErrors.get(m.id)?.message;
  if (m.held) {
    updateLight(li, m, false);
    const tag = li.querySelector('.tag');
    tag.textContent = '';
    showOneTag(li, true); // (the "on hold" button in the switch's place says it)
    const err = li.querySelector('.mod-err');
    if (rowErr) { err.textContent = rowErr; err.hidden = false; } else { err.textContent = ''; err.hidden = true; } // (the facts box says why)
    return;
  }
  const site = switchSite(m);
  const on = shownEnabled(m.id, isOn(m.id, site), site);
  li.classList.toggle('off', !on);
  updateLight(li, m, on);
  const tag = li.querySelector('.tag');
  // (one tag at most, showOneTag: a change the chat made waiting comes first, then new or updated)
  tag.textContent = m.chatWaiting ? 'changed' : !on && m.newOff ? (m.newOff === 'update' ? 'updated' : 'new') : '';
  tag.title = m.chatWaiting ? 'Your chat changed it, and waits for you (Settings): the version before runs until you turn this one on.'
    : !on && m.newOff === 'chat' ? 'Your chat made it, and waits for you (Settings): switch it on once you\'ve looked at it.'
    : !on && m.newOff === 'update' ? 'TRIF updated it and switched it off: switch it on once you\'ve looked at it.'
    : !on && m.newOff ? 'TRIF switched it off because it came from outside your chat: switch it on once you\'ve looked at it.' : '';
  tag.dataset.rank = m.chatWaiting ? '1' : '3';
  showOneTag(li, false);
  const err = li.querySelector('.mod-err');
  err.textContent = rowErr || switchError(m.id, site) || (on && m.error) || '';
  err.hidden = !err.textContent;
}

// The agent's replies are short by default (AGENTS.md "5. Report"); Explain, on its last reply, asks it for
// the full account: what changed, what it checked and couldn't, how to undo. Not while it's working, and not
// on the answer to an Explain.
const EXPLAIN_PROMPT = 'Explain what you did.';
function renderExplain(msgs) {
  const want = explainTarget(msgs);
  // (kept, not rebuilt, while it stays on the same reply: a status refresh never swaps it under the pointer)
  for (const old of ui.messages.querySelectorAll('.explain-btn')) {
    if (old.parentNode === want) { old.disabled = !ui.composer.dataset.canSend; return; }
    old.remove();
  }
  if (!want) return;
  const b = button('Explain', 'explain-btn', async () => {
    b.disabled = true;
    try { await startRun(EXPLAIN_PROMPT); } catch (e) { b.disabled = false; console.warn('[TRIF] explain failed', e); }
  });
  b.title = 'Ask your agent what it changed, what it checked, and how to undo it';
  b.disabled = !ui.composer.dataset.canSend;
  want.append(b);
}
function explainTarget(msgs) {
  if (!view.site || view.chat.run) return null;
  let last = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') break;
    if (msgs[i].role === 'assistant') { last = i; break; }
  }
  if (last < 0) return null;
  const asked = msgs.slice(0, last).reverse().find((m) => m.role === 'user');
  if (asked?.text === EXPLAIN_PROMPT) return null;
  return ui.messages.children[last] || null;
}

// The agent's tool lines, a run of them in a row, fold into one line ("Ran 2 commands, read 1 file ›") that
// opens to show them, as in Claude. Each line keeps its own node (the chat's indexes stay put); the first of a
// run carries the summary. Notes (stopped, a site's new data) aren't tools and stand on their own.
const TOOL_KINDS = [['ran', 'command', 'commands'], ['edited', 'file', 'files'], ['wrote', 'file', 'files'], ['read', 'file', 'files'], ['searched', 'time', 'times']];
const toolKind = (text) => {
  const t = String(text || '');
  const k = TOOL_KINDS.find(([verb]) => t === verb || t.startsWith(`${verb} `));
  if (k) return k[0] === 'wrote' ? 'edited' : k[0];
  return /^(mcp__\w+|[A-Z][A-Za-z]*)( |$)/.test(t) ? 'used' : null;
};
const toolsOpen = new Set(); // (the runs the user opened, by their first line's time)
function toolSummary(lines) {
  const n = new Map();
  for (const m of lines) { const k = toolKind(m.text); n.set(k, (n.get(k) || 0) + 1); }
  const parts = [];
  for (const [verb, one, many] of [...TOOL_KINDS.filter(([v]) => v !== 'wrote'), ['used', 'tool', 'tools']]) {
    const c = n.get(verb);
    if (c) parts.push(`${verb} ${c} ${c === 1 ? one : many}`);
  }
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function groupTools(msgs) {
  const nodes = ui.messages.children;
  for (let i = 0; i < msgs.length;) {
    if (msgs[i].role !== 'tool' || !toolKind(msgs[i].text) || !nodes[i]) { i++; continue; }
    let j = i;
    while (j + 1 < msgs.length && msgs[j + 1].role === 'tool' && toolKind(msgs[j + 1].text) && nodes[j + 1]) j++;
    const key = String(msgs[i].time);
    const open = toolsOpen.has(key);
    const first = nodes[i];
    let sum = first.querySelector(':scope > .tool-sum');
    if (!sum) {
      const text = el('span', 'tool-text', first.textContent);
      sum = el('button', 'tool-sum');
      sum.type = 'button';
      sum.addEventListener('click', () => {
        if (toolsOpen.has(sum.dataset.key)) toolsOpen.delete(sum.dataset.key); else toolsOpen.add(sum.dataset.key);
        groupTools(view.site ? view.chat.messages : []);
      });
      text.title = first.title;
      first.removeAttribute('title');
      first.replaceChildren(sum, text);
    }
    sum.dataset.key = key;
    sum.textContent = toolSummary(msgs.slice(i, j + 1));
    sum.setAttribute('aria-expanded', String(open));
    first.classList.add('tool-head');
    first.classList.toggle('open', open);
    for (let k = i; k <= j; k++) {
      nodes[k].classList.toggle('tool-member', k > i);
      nodes[k].hidden = k > i && !open;
    }
    i = j + 1;
  }
}

function renderMessages() {
  const msgs = view.site ? view.chat.messages : [];
  const r = view.rendered;
  const nearBottom = ui.chat.scrollHeight - ui.chat.scrollTop - ui.chat.clientHeight < 60;
  const sameThread = r.site === view.site && msgs.length >= r.count && (r.count === 0 || msgs[0]?.time === r.first);
  if (!sameThread) {
    ui.messages.replaceChildren(...msgs.map(messageNode));
  } else {
    if (msgs.length > r.count) ui.messages.append(...msgs.slice(r.count).map(messageNode));
    // (a mod-broke card the background changed since: Fixing…, Fixed., Ignored., Fix undone.: drawn again)
    msgs.forEach((m, i) => {
      if (m.kind !== 'modError' || i >= r.count) return;
      const node = ui.messages.children[i];
      if (node && node.dataset.cardKey !== cardKey(m)) node.replaceWith(messageNode(m));
    });
  }
  const changed = !sameThread || msgs.length !== r.count;
  view.rendered = { site: view.site, count: msgs.length, first: msgs[0]?.time ?? null };
  renderExplain(msgs);
  groupTools(msgs);
  if (changed && (nearBottom || !sameThread)) ui.chat.scrollTop = ui.chat.scrollHeight;
}

function renderSettings() {
  const { list } = currentAgent();
  const def = list.find((a) => a.id === view.agents?.default);
  const opts = [new Option(def ? `Default (${def.name})` : 'Default', '')];
  for (const a of list) {
    const label = a.available ? `${a.name}${a.version ? ` ${a.version}` : ''}` : `${a.name} (not found)`;
    const o = new Option(label, a.id);
    o.disabled = !a.available;
    opts.push(o);
  }
  const mine = chatSettings();
  if (mine.agent && !list.some((a) => a.id === mine.agent)) {
    opts.push(new Option(mine.agent, mine.agent));
  }
  ui.agent.replaceChildren(...opts);
  ui.agent.value = mine.agent || '';
  const chosen = list.find((a) => a.id === (mine.agent || view.agents?.default));
  const note = chosen?.note || (view.agentsError && !view.agents ? 'Agents are listed once the helper is connected.' : '');
  ui.agentNote.textContent = note;
  ui.agentNote.hidden = !note;
  renderWithoutSandbox();
  renderModels();
}

// ---- model picker -------------------------------------------------------------------------------
// What the chosen agent offers (helper agent.models): Codex lists the models the signed-in account can
// use; Claude Code can't, so it offers its family aliases plus "Other…" for an exact name.

const OTHER = '__other__';

async function loadModels(agentId, fresh = false) {
  if (!agentId || !view.status?.helper?.connected) return;
  try { view.modelLists[agentId] = await request({ type: 'agent.models', agent: agentId, fresh }); } catch (e) {
    view.modelLists[agentId] = { models: [], default: null, custom: true, error: String(e?.message ?? e) };
  }
  renderModels();
}

function renderModels() {
  const { id, info } = currentAgent();
  renderOpenModel(id, !!view.status?.helper?.connected); // open model: where it comes from (openmodel.js)
  const list = view.modelLists[id] || null;
  const chosen = chosenModel(id);
  const models = list?.models || [];
  const allowsOther = !list || list.custom !== false;
  const known = !chosen || models.some((m) => m.id === chosen);
  const def = list?.default ? models.find((m) => m.id === list.default) : null;
  const opts = [new Option(def ? `Default (${def.name})` : 'Default', '')];
  for (const m of models) {
    const o = new Option(m.name, m.id);
    if (m.description) o.title = m.description;
    opts.push(o);
  }
  if (!known && !allowsOther) opts.push(new Option(`${chosen} (not available)`, chosen));
  if (allowsOther) opts.push(new Option('Other…', OTHER));
  const value = (!known && allowsOther) || view.modelOther[id] ? OTHER : chosen;
  if (document.activeElement !== ui.model) {
    ui.model.replaceChildren(...opts);
    ui.model.value = value;
  }
  ui.model.disabled = !id;
  ui.modelCustomRow.hidden = value !== OTHER;
  if (value === OTHER && document.activeElement !== ui.modelCustom) ui.modelCustom.value = known ? '' : chosen;

  const selected = models.find((m) => m.id === (value === OTHER ? '' : value || list?.default));
  const name = info?.name || 'this agent';
  const note = list?.error ? `Couldn’t list ${name}’s models: ${list.error}`
    : !known && !allowsOther ? `${chosen} isn’t one of the models your account can use; pick another.`
      : value === OTHER || !selected?.description ? list?.note || '' : selected.description;
  ui.modelNote.textContent = note;
  ui.modelNote.hidden = !note;
  ui.modelNote.classList.toggle('error', !!list?.error || (!known && !allowsOther));
  renderUsing(info, chosen, models, def);
}

/**
 * The line over the message box: this chat's agent and model ("Open model · Kimi K2.7 Code", "Claude Code ·
 * Default (Opus)"), so a model picked somewhere else is never a surprise. The model's name once its list has
 * loaded (settings), its id until then.
 */
function renderUsing(info, chosen, models, def) {
  if (!info) { ui.using.hidden = true; return; }
  const named = chosen && models.find((m) => m.id === chosen);
  const model = chosen ? (named ? named.name : chosen) : def ? `Default (${def.name})` : 'Default model';
  ui.using.textContent = `${info.name} · ${model}`;
  ui.using.title = 'Change the agent or model';
  ui.using.hidden = false;
}

async function saveModel(agentId, model) {
  if (!agentId) return;
  await saveSettings({ models: { ...chatSettings().models, [agentId]: model } });
}

// ---- actions ------------------------------------------------------------------------------------

/**
 * Changes this site chat's agent settings (its pick), and makes its agent (not its models) the default for
 * sites without one. (No site: just the default, models too.)
 */
async function saveSettings(patch) {
  const next = { ...chatSettings(), ...patch };
  // On a site, its models stay its own: they don't become every new chat's (0.2.1 copied them into the
  // default, so a model tried once on one site quietly became the model of every site chatted on later).
  // The agent still does. With no site open (settings on the landing page), this is the default itself.
  view.settings = normalizeSettings(view.site ? { ...next, models: view.settings.models } : next);
  if (!view.site) return chrome.storage.local.set({ settings: view.settings });
  view.picks = { ...view.picks, [view.site]: normalizeSettings(next) };
  await chrome.storage.local.set({ settings: view.settings, sitePicks: view.picks });
}

/** Drop every stored model pick for `agentId` (each site's and the default): the open model's provider changed. */
async function forgetModelPicks(agentId) {
  const r = withoutModel({ settings: view.settings, picks: view.picks, snapshots: view.snapshots }, agentId);
  view.settings = r.settings;
  view.picks = r.picks;
  await chrome.storage.local.set({ settings: view.settings, sitePicks: view.picks }).catch(() => {});
  renderModels();
}

/** A run is starting here: the site keeps the settings it runs with, whatever is picked elsewhere later. */
async function keepSettings() {
  if (!view.site || view.picks[view.site]) return;
  view.picks = { ...view.picks, [view.site]: normalizeSettings(chatSettings()) };
  await chrome.storage.local.set({ sitePicks: view.picks }).catch(() => {});
}

// Slash commands the panel handles itself (each message starts a fresh agent process, so e.g. Claude
// Code's own /model would only last one message). Anything else starting with / goes to the agent, which
// runs its own commands: /compact, /context… Returns true when handled.
const PANEL_HELP = 'Panel commands: /model [name|default] picks the model (also in settings), /clear starts a new chat. ' +
  'Other commands go to the agent: /compact shrinks a long conversation, /context shows what it holds.';
async function panelCommand(text) {
  const m = /^\/(\S+)\s*(.*)$/s.exec(text);
  if (!m) return false;
  const [, cmd, arg] = m;
  const note = (t) => request({ type: 'chat.note', site: view.site, text: t });
  if (cmd === 'model') {
    const { id, info } = currentAgent();
    const names = (view.modelLists[id]?.models || []).map((x) => x.id).join(', ');
    if (!arg.trim()) {
      await note(`Model: ${chosenModel(id) || `${info?.name || 'the agent'}’s default`}.${names ? ` Change it with /model followed by one of: ${names}, or default.` : ''}`);
    } else {
      const model = /^default$/i.test(arg.trim()) ? '' : arg.trim();
      view.modelOther[id] = false;
      await saveModel(id, model);
      renderModels();
      await note(model ? `Model set to ${model} (from the next message)` : `Model set to ${info?.name || 'the agent'}’s default`);
    }
    return true;
  }
  if (cmd === 'clear' || cmd === 'new') { await newChat(); return true; }
  if (cmd === 'help') { await note(PANEL_HELP); return true; }
  return false;
}

async function send() {
  const text = ui.input.value.trim();
  if (!text || !view.site || view.chat.run || !ui.composer.dataset.canSend) return;
  if (text.startsWith('/')) {
    ui.input.value = '';
    try { if (await panelCommand(text)) return; } catch (e) { console.warn('[TRIF] command failed', e); }
  }
  ui.input.value = '';
  const tabId = view.tab.id;
  try {
    const runId = await startRun(text);
    view.myRuns.set(runId, { prompt: text, tabId }); // (to put it back if the agent needs logging in)
  } catch (e) {
    // The background records start failures in the chat; anything earlier goes back in the box.
    const inChat = view.chat.messages.some((m) => m.role === 'user' && m.text === text);
    if (!inChat && !ui.input.value) ui.input.value = text;
    console.warn('[TRIF] agent.start failed', e);
  }
}

/** Starts an agent run in this chat with `text` as the user's message; `extra` goes along (e.g. merge). */
async function startRun(text, extra = {}) {
  if (view.chat.run) throw new Error(`already working on ${view.site}`);
  if (!ui.composer.dataset.canSend) throw new Error('No coding agent is available here yet');
  const { id: agent } = currentAgent();
  await keepSettings();
  const chat = view.chat;
  const sessionId = chat.sessionId && (!chat.agent || !agent || chat.agent === agent) ? chat.sessionId : undefined;
  const { runId } = await request({
    type: 'agent.start', site: view.site, tabId: view.tab.id, url: view.tab.url, prompt: text,
    sessionId, agent: agent || undefined, model: chosenModel(agent) || undefined, ...extra,
  });
  view.myRuns.set(runId, null);
  return runId;
}

async function stop() {
  const runId = view.chat.run?.runId;
  if (!runId) return;
  ui.stop.disabled = true;
  try { await request({ type: 'agent.stop', runId }); } catch (e) { console.warn('[TRIF] stop failed', e); }
}

async function newChat() {
  if (!view.site) return;
  await request({ type: 'chat.clear', site: view.site }).catch((e) => console.warn('[TRIF] clear failed', e));
  ui.input.focus();
}

function openSetup() {
  const url = chrome.runtime.getURL('onboarding.html');
  chrome.tabs.query({ url }).then(([existing]) => {
    if (existing) chrome.tabs.update(existing.id, { active: true });
    else openTab({ url });
  });
}

ui.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) return; // IME confirming a candidate
    if (!view.chat.run) ui.composer.requestSubmit();
  }
});
ui.stop.addEventListener('click', stop);
ui.newChat.addEventListener('click', newChat);
ui.gateBtn.addEventListener('click', gateClick);
ui.gateBlock.addEventListener('click', (e) => { e.preventDefault(); setBlocked(true); });
ui.gateDisconnect.addEventListener('click', disconnectClick);
ui.accessNoteOk?.addEventListener('click', () => request({ type: 'siteAccess.noteSeen' }).then(refreshStatus, () => {}));
ui.siteStarterLink.addEventListener('click', (e) => { e.preventDefault(); const x = siteStarterOffer(); if (x) addStarter(x.site, { fromSite: true }); });
ui.siteSwitch.addEventListener('click', () => setSiteOn(!siteIsOn()));
ui.barRobot.addEventListener('click', () => setSiteOn(!siteIsOn())); // off: the Fix button; on: the power button
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    ui.input.value = chip.textContent;
    ui.input.focus();
  });
}
ui.settingsBtn.addEventListener('click', () => toggleSettings());
/** Open or close Settings (open: true just opens them). */
function toggleSettings(open = ui.settings.hidden) {
  ui.settings.hidden = !open;
  ui.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open && view.status?.helper?.connected) { loadAgents().then(() => loadModels(currentAgent().id)); loadInstructions(); }
}
const openSettings = () => { if (ui.settings.hidden) toggleSettings(true); };
ui.using.addEventListener('click', () => { openSettings(); try { ui.model.focus(); } catch { /* disabled */ } });

// The user's standing instructions for every agent run: ~/.trif/instructions.md, read and written
// through the helper (helper/lib/instructions.js). Loaded when settings open; saved as they type.
const INSTRUCTIONS_NOTE = 'Applies from your next message, here and in Claude Code in ~/.trif.';
let instructionsTimer = null;
let instructionsSaved = null; // the text the helper last confirmed

function instructionsNote(text, error) {
  ui.instructionsNote.textContent = text;
  ui.instructionsNote.classList.toggle('error', !!error);
}

async function loadInstructions() {
  if (document.activeElement === ui.instructions && instructionsSaved !== null) return; // don't clobber typing
  try {
    const r = await request({ type: 'instructions.get' });
    instructionsSaved = r.text;
    if (document.activeElement !== ui.instructions || !ui.instructions.value) ui.instructions.value = r.text;
    ui.instructions.disabled = false;
    instructionsNote(INSTRUCTIONS_NOTE);
  } catch (e) {
    ui.instructions.disabled = instructionsSaved === null;
    instructionsNote(`Couldn't load them: ${String(e?.message ?? e)}`, true);
  }
}

async function saveInstructions() {
  clearTimeout(instructionsTimer);
  const text = ui.instructions.value;
  if (instructionsSaved === null || text.trim() === instructionsSaved) return;
  try {
    const r = await request({ type: 'instructions.set', text });
    instructionsSaved = r.text;
    instructionsNote(r.text ? 'Saved. ' + INSTRUCTIONS_NOTE : 'Cleared.');
  } catch (e) {
    instructionsNote(`Couldn't save them: ${String(e?.message ?? e)}`, true);
  }
}

ui.instructions.addEventListener('input', () => {
  clearTimeout(instructionsTimer);
  instructionsTimer = setTimeout(saveInstructions, 800);
});
ui.instructions.addEventListener('blur', saveInstructions);
ui.agent.addEventListener('change', async () => {
  await saveSettings({ agent: ui.agent.value });
  renderModels();
  loadModels(currentAgent().id);
});
ui.model.addEventListener('change', () => {
  const { id } = currentAgent();
  if (ui.model.value === OTHER) {
    view.modelOther[id] = true;
    renderModels();
    ui.modelCustom.focus();
    return;
  }
  view.modelOther[id] = false;
  saveModel(id, ui.model.value).then(renderModels);
});
let modelTimer = null;
ui.modelCustom.addEventListener('input', () => {
  clearTimeout(modelTimer);
  modelTimer = setTimeout(() => saveModel(currentAgent().id, ui.modelCustom.value.trim()), 400);
});
ui.modelCustom.addEventListener('change', () => { clearTimeout(modelTimer); saveModel(currentAgent().id, ui.modelCustom.value.trim()); });
$('#setup-link').addEventListener('click', (e) => { e.preventDefault(); openSetup(); });
mountOpenModel({ request, onChange: async () => { await forgetModelPicks('codex-oss'); loadModels('codex-oss', true); }, changed: () => render() });

// ---- updates ------------------------------------------------------------------------------------
// The helper checks for a newer TRIF (helper/lib/update.js) and its summary rides on the status. The
// panel offers it (Update installs it, then the extension reloads onto it), says so after the reload, and
// has the "Install updates automatically" setting (off unless the user turns it on).

const UPDATED_SHOWN_MS = 24 * 60 * 60 * 1000;

function renderUpdate() {
  const n = ui.update;
  const u = view.status?.helper?.connected ? view.status.update : null;
  const done = view.updated && Date.now() - view.updated.at < UPDATED_SHOWN_MS && view.updated.to === (u?.current || view.status?.version) ? view.updated : null;
  const installing = view.updateBusy === 'installing' || u?.installing;
  const key = JSON.stringify([u?.available, u?.latest, u?.canInstall, installing, view.updateError, done?.to]);
  renderUpdateSettings(u);
  if (n.dataset.key === key) return;
  n.dataset.key = key;
  const parts = [];
  n.classList.remove('ok', 'bad');
  if (installing) {
    parts.push(el('p', 'title', `Updating TRIF to ${u?.latest || 'the new version'}…`));
    parts.push(el('p', 'note', 'It reloads by itself when it’s done.'));
  } else if (u?.available) {
    parts.push(el('p', 'title', `TRIF ${u.latest} is available`));
    if (view.updateError) { parts.push(el('p', 'note error', view.updateError)); n.classList.add('bad'); }
    const actions = el('p', 'actions');
    if (u.canInstall) actions.append(button('Update', 'primary', installUpdate));
    if (u.notes) actions.append(notesToggle(n, u.notes));
    if (actions.childNodes.length) parts.push(actions);
    if (!u.canInstall && u.why) parts.push(el('p', 'note', u.why));
  } else if (done) {
    n.classList.add('ok');
    parts.push(el('p', 'title', `TRIF updated to ${done.to}`));
    const actions = el('p', 'actions');
    if (done.notes) actions.append(notesToggle(n, done.notes));
    actions.append(button('OK', null, () => request({ type: 'update.dismiss' }).catch(() => {})));
    parts.push(actions);
  }
  n.replaceChildren(...parts);
  n.hidden = parts.length === 0;
}

function notesToggle(container, notes) {
  return button('What’s new', null, (e) => {
    const shown = container.querySelector('.md');
    if (shown) { shown.remove(); e.target.textContent = 'What’s new'; return; }
    const md = el('div', 'md');
    setMarkdown(md, unwrapMarkdown(notes));
    container.append(md);
    e.target.textContent = 'Hide';
  });
}

function renderUpdateSettings(u) {
  const connected = !!view.status?.helper?.connected;
  ui.autoUpdate.checked = !!u?.auto;
  ui.autoUpdate.disabled = !connected || !u || !u.canInstall || !!view.updateBusy;
  let text = '';
  if (!connected || !u) text = connected ? '' : 'Update settings appear once the helper is connected.';
  else if (view.updateBusy === 'checking') text = `TRIF ${u.current}. Checking for updates…`;
  else if (!u.canInstall) text = `TRIF ${u.current}. ${u.why || ''}`;
  else if (u.available) text = `TRIF ${u.current} (${u.latest} is available).`;
  else if (u.error) text = `TRIF ${u.current}. Couldn’t check for updates: ${u.error}`;
  else text = `TRIF ${u.current}${u.latest ? ', up to date' : ''}.`;
  if (ui.updateNote.dataset.text === text) return;
  ui.updateNote.dataset.text = text;
  ui.updateNote.replaceChildren(text);
  if (connected && u && u.source && !view.updateBusy) {
    const check = el('a', null, 'Check now');
    check.href = '#';
    check.addEventListener('click', (e) => { e.preventDefault(); checkForUpdate(); });
    ui.updateNote.append(' ', check);
  }
}

async function checkForUpdate() {
  view.updateBusy = 'checking';
  ui.updateNote.dataset.text = '';
  renderUpdate();
  try { await request({ type: 'update.check' }); } catch (e) { view.updateError = String(e?.message ?? e); }
  view.updateBusy = null;
  await refreshStatus();
}

async function installUpdate() {
  view.updateBusy = 'installing';
  view.updateError = null;
  renderUpdate();
  try {
    await request({ type: 'update.install' });
    // The extension reloads in a moment, closing this panel's connection; it reopens on the new version.
  } catch (e) {
    view.updateError = `Couldn’t update: ${String(e?.message ?? e)}`;
    view.updateBusy = null;
    renderUpdate();
  }
}

ui.pauseAll.addEventListener('change', () => setPaused(ui.pauseAll.checked));
ui.chatMods.addEventListener('change', () => setChatWait(ui.chatMods.value === 'wait'));
ui.onBreak?.addEventListener('change', () => request({ type: 'modError.onBreak', value: ui.onBreak.value }).then(refreshStatus, () => {}));

ui.autoUpdate.addEventListener('change', async () => {
  const on = ui.autoUpdate.checked;
  try { await request({ type: 'update.setAuto', on }); } catch (e) {
    ui.autoUpdate.checked = !on;
    ui.updateNote.dataset.text = '';
    ui.updateNote.textContent = `Couldn’t change it: ${String(e?.message ?? e)}`;
  }
  refreshStatus();
});

// ---- report a problem ---------------------------------------------------------------------------
// The helper writes the report (helper/lib/report.js: versions, setup checks, this site's mods and recent
// errors, scrubbed of names, paths and addresses); the panel opens the report form (timsrobot.com/report)
// with it after the #, which the browser never sends to the server: nothing leaves until the person
// presses Send there.

const REPORT_URL = 'https://timsrobot.com/report'; // when the helper can't say (it isn't connected)

function reportLink(url, text, site) {
  const params = new URLSearchParams({ r: text });
  if (site) params.set('s', site);
  return `${url}#${params.toString()}`;
}

async function openReport() {
  const scope = view.site ? scopeFor(view.site) : null;
  const mods = view.site && view.status ? view.status.mods.filter((m) => limitToSites(m, [scope])) : [];
  let url = REPORT_URL;
  let text;
  try {
    const r = await request({ type: 'report.build', site: view.site || '', siteOn: siteIsOn(), mods });
    text = r.text;
    url = r.url || url;
  } catch (e) {
    // Without the helper: what the panel knows, which is when a report matters most.
    const s = view.status;
    text = `TRIF problem report\n\nTRIF        ${s?.version || '?'}\nBrowser     ${s?.browser || BROWSER} ${s?.chrome || ''}\nHelper      not connected (${s?.helper?.error || String(e?.message ?? e)})`;
  }
  openTab({ url: reportLink(url, text, view.site || '') });
}

$('#report-link').addEventListener('click', (e) => { e.preventDefault(); openReport(); });

init().catch((e) => console.error('[TRIF] side panel failed to start', e));
