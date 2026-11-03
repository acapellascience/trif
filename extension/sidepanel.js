// Side panel: chat with your coding agent about the site in the active tab. Follows the active tab
// of its window. The background relays agent runs to the helper and writes each run's transcript to
// chrome.storage.local `chat:<site>`; this page renders that record and reacts to storage changes.
// See docs/PROTOCOL.md, "Side panel and agent runs".

import { siteForUrl, modAppliesTo, modSites, isMultiSite, offOnSite, normalizeOffSites, scopeFor, limitToSites, withOffSites, FIREFOX, BROWSER, SETUP_COMMAND,
  normalizeSettings, normalizePicks, siteSettings, withoutModel } from './lib.js';
import { setMarkdown } from './markdown.js';
import { createLogin } from './login.js';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';
import { mountOpenModel, renderOpenModel, openModelKeyMissing, watchOpenModel } from './openmodel.js';

const $ = (sel) => document.querySelector(sel);
const chatKey = (site) => `chat:${site}`;
const emptyChat = () => ({ sessionId: null, agent: null, messages: [], run: null, last: null });

const ui = {
  dot: $('#dot'), site: $('#site'), barRobot: $('#bar-robot'), siteSwitch: $('#site-switch'), newChat: $('#new-chat'), settingsBtn: $('#settings-btn'),
  gate: $('#gate'), gateBtn: $('#gate-btn'), gateErr: $('#gate-err'), gateNote: $('#gate-note'),
  landing: $('#landing'), landingIcon: $('#landing-icon'), landingVersion: $('#landing-version'), landingNote: $('#landing-note'),
  settings: $('#settings'), agent: $('#agent'), agentNote: $('#agent-note'), model: $('#model'),
  modelCustomRow: $('#model-custom-row'), modelCustom: $('#model-custom'), modelNote: $('#model-note'),
  instructions: $('#instructions'), instructionsNote: $('#instructions-note'),
  autoUpdate: $('#auto-update'), updateNote: $('#update-note'), update: $('#update'),
  notice: $('#notice'), paused: $('#paused'), mods: $('#mods'), modsCount: $('#mods-count'), modList: $('#mod-list'),
  chat: $('#chat'), empty: $('#empty'), messages: $('#messages'), working: $('#working'),

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
  myRuns: new Set(),         // runs this panel started
  updated: null,             // chrome.storage.local `updated`: {from, to, notes, at} after an update's reload
  updateBusy: null,          // 'checking' | 'installing' while the panel waits on the helper
  updateError: null,
};

// ---- background port ----------------------------------------------------------------------------

let port = null;
let reqSeq = 0;
const pending = new Map();

function connectPort() {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    for (const p of pending.values()) p.reject(new Error('lost connection to the TRIF service worker'));
    pending.clear();
    setTimeout(() => { if (!port) connectPort(); refreshStatus(); }, 500); // the service worker restarted
  });
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
      view.myRuns.delete(msg.runId);
      refreshStatus();
      if (!msg.event.ok) loadAgents(); // maybe "not logged in": refresh loggedIn
    }
  } else if (msg?.type === 'statusChanged') {
    refreshStatusSoon();
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
  connectPort();
  // In Safari the panel is a window of its own, opened with ?window=<the window whose tabs it follows>.
  const opener = Number(new URLSearchParams(location.search).get('window'));
  view.windowId = opener || (await chrome.windows.getCurrent()).id;
  const stored = await chrome.storage.local.get(['settings', 'sitePicks', 'disabled', 'offSites', 'updated']);
  view.updated = stored.updated || null;
  view.settings = normalizeSettings(stored.settings);
  view.picks = normalizePicks(stored.sitePicks);
  view.disabled = stored.disabled || {};
  view.offSites = normalizeOffSites(stored.offSites);
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
    if (changes.disabled || changes.offSites) { // a switch flipped here, on the setup page, or by an agent / the CLI
      if (changes.disabled) view.disabled = changes.disabled.newValue || {};
      if (changes.offSites) view.offSites = normalizeOffSites(changes.offSites.newValue);
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

async function setTab(tab) {
  const url = tab.url || tab.pendingUrl || '';
  view.tab = { id: tab.id, url };
  const site = siteForUrl(url);
  if (site !== view.site) {
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
  }
  render();
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


function messageNode(m) {
  const li = el('li', `msg ${m.role}`);
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
  return li;
}

function render() {
  const { site, chat, status } = view;
  const running = !!chat.run;
  const helperOk = !!status?.helper?.connected;
  const { info: agentInfo, list: agentList } = currentAgent();
  const anyAgent = agentList.some((a) => a.available);

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
  // with that, under the notice that says it. Send's tooltip says what to do.
  const waitsForLogin = (problem === 'login' && agentInfo?.loggedIn === false) || problem === 'key';
  const canSend = !!site && helperOk && !waitsForLogin && (agentInfo ? agentInfo.available : (view.agents ? anyAgent : true));
  ui.composer.dataset.canSend = canSend ? '1' : '';
  ui.send.title = !waitsForLogin ? 'Send'
    : problem === 'key' ? `Add your ${openModelKeyMissing()} API key in Settings first`
      : `Log in to ${agentInfo?.name || 'your agent'} first`;

  renderGate(problem, agentInfo);
  renderNotice({ helperOk, agentInfo, anyAgent });
  renderUpdate();
  renderMods();
  renderMessages();

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
  else chrome.tabs.create({ url: view.status?.settingsUrl || `chrome://extensions/?id=${chrome.runtime.id}` });
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
  const last = view.site ? view.chat.messages.at(-1) : null;
  return last?.role === 'error' && /isn[’']t logged in/i.test(String(last.text));
}

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

// Logged in: a chat whose last message is a run's "isn't logged in" error gets a line saying it's sorted,
// so the error doesn't sit there as if it still applied (and the login notice doesn't come back for it).
function answerLoginError() {
  const last = view.site ? view.chat.messages.at(-1) : null;
  if (last?.role !== 'error' || !/isn[’']t logged in/i.test(String(last.text))) return;
  request({ type: 'chat.note', site: view.site, text: `${login.current?.name || 'Your agent'} is logged in now: send your message again.` }).catch(() => {});
}

function actions(...children) {
  const p = el('p', 'actions');
  p.append(...children.filter(Boolean));
  return p;
}

let modLabelSeq = 0;
onSwitchChange(() => renderMods());

function renderMods() {
  const { site, status, tab } = view;
  // Every mod that runs somewhere on this site's domain (google.com: Search, Maps, mail.google.com…, and
  // all-sites mods), not just on this page, so the list doesn't change as you move around the site; a
  // light says which run on this page. Plus mods on hold from an agent run here, so they can be allowed.
  const scope = site ? scopeFor(site) : null;
  const mods = site && status ? status.mods.filter((m) => limitToSites(m, [scope]) || m.held?.site === site) : [];
  ui.mods.hidden = mods.length === 0;
  if (!mods.length) { view.modRows.clear(); ui.modList.replaceChildren(); return; }
  ui.modsCount.textContent = `(${mods.length})`;
  // Each row is built once and rebuilt only when its own mod changes; rows that stay are left where they
  // are (not even moved), so a button being clicked or a focused switch is never swapped out from under
  // the pointer by a status refresh or by another mod changing. Everything else updates in place.
  const rows = new Map();
  for (const m of mods) {
    const key = JSON.stringify([site, m.name, m.file, !!m.held, m.risk?.tier ?? null, m.risk?.why ?? null, m.matches,
      m.source ?? null, m.version ?? null, m.update ?? null]);
    const old = view.modRows.get(m.id);
    rows.set(m.id, old && old.key === key ? old : { key, li: modItem(m) });
  }
  view.modRows = rows;
  const want = [...rows.values()].map((r) => r.li);
  want.forEach((li, i) => { if (ui.modList.children[i] !== li) ui.modList.insertBefore(li, ui.modList.children[i] || null); });
  while (ui.modList.children.length > want.length) ui.modList.lastElementChild.remove();
  const byId = new Map(mods.map((m) => [m.id, m]));
  for (const li of ui.modList.children) updateModItem(li, byId.get(li.dataset.mod));
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

// TRIF is off on a site until the user turns it on here (see "sites TRIF is on for" in lib.js):
// until then the panel shows only "The robot is off." and the button (and, in the top bar, the robot,
// grey and dim, and settings), and nothing runs or reads the site. Once on, the header's switch turns it
// back off. The robot in the bar does what the switch does: wakes the panel, or puts it to sleep.
// (Unknown until the first status: neither shows.)
const siteScope = () => (view.site ? scopeFor(view.site) : null);
const siteIsOn = () => !!siteScope() && (view.status?.sitesOn || []).includes(siteScope());
let siteSwitching = false;

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
  const gated = known && !siteIsOn();
  document.body.classList.toggle('site-off', gated);
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
  ui.gateBtn.hidden = red;
  ui.gateBtn.textContent = `Fix ${scope}`;
  ui.gateBtn.disabled = siteSwitching;
}

async function setSiteOn(on) {
  if (siteSwitching || !view.site) return;
  siteSwitching = true;
  ui.gateErr.hidden = true;
  delete ui.siteSwitch.dataset.error;
  render();
  try {
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

// A mod on several sites gets a switch for this site only (the setup page has the whole-mod one);
// a mod for one site, a switch for the mod.
const switchSite = (m) => (isMultiSite(m) ? view.site : undefined);
const isOn = (id, site) => enabledIn(view.disabled, id) && !(site && offOnSite(view.offSites, id, site));

function modItem(m) {
  const li = el('li');
  li.dataset.mod = m.id;
  li.title = m.file || m.id;
  const labelId = `mod-name-${++modLabelSeq}`;
  const name = el('div', 'mod-name');
  const light = el('span', 'light');
  const label = el('span', null, m.name);
  label.id = labelId;
  const tag = el('span', 'tag');
  tag.hidden = true;
  // Spaces between the name and its badges, so a badge can wrap to the next line on its own.
  name.append(label, ' ', tag);
  // Risk tier from the mod's header (AGENTS.md "Account safety"): nothing for 0, a badge for 1 and 2.
  if (m.risk?.tier >= 1) {
    const badge = el('span', `tag risk risk-${m.risk.tier}`, m.risk.tier >= 2 ? 'changes requests' : 'detectable');
    badge.title = (m.risk.tier >= 2
      ? 'Risk 2: this mod changes what the site receives, which the site could notice (rate limits or an account flag are possible).'
      : 'Risk 1: the site\'s own scripts could notice this mod (for example, ads it hides never report being seen).') +
      (m.risk.why ? `\n${m.risk.why}` : '');
    name.append(' ', badge);
  }
  // Mods that also run on other sites say so: their switch here is for this site only.
  const { everywhere, sites } = modSites(m);
  if (everywhere || sites.length > 1) {
    const badge = el('span', 'tag', everywhere ? 'all sites' : `${sites.length} sites`);
    badge.title = (everywhere ? 'Runs on every site.' : `Runs on ${sites.join(', ')}.`) +
      ` This switch is for ${view.site} only; switch it on other sites, or everywhere, from Setup.`;
    name.append(' ', badge);
  }
  const main = el('div', 'mod-main');
  // The mods TRIF ships say so (their header's @source and @version).
  const file = el('div', 'mod-file', (m.file || m.id).split('/').pop());
  if (m.source === 'webmods' || m.source === 'trif') file.append(' ', el('span', 'mod-source', `Tim's mod${m.version ? `, v${m.version}` : ''}`));
  main.append(light, name, file);
  const row = el('div', 'mod-row');
  if (m.held) {
    // Written by an agent run here but reaching other sites: not running until the user allows it.
    li.classList.add('held');
    const allow = el('button', 'btn allow', 'Allow');
    allow.type = 'button';
    allow.setAttribute('aria-describedby', labelId);
    allow.addEventListener('click', async () => {
      allow.disabled = true;
      clearRowError(m.id);
      try { await request({ type: 'mod.approve', id: m.id, tab: view.tab?.id }); } catch (e) {
        allow.disabled = false;
        rowError(m.id, String(e?.message ?? e));
      }
    });
    row.append(main, allow, deleteButton(m, labelId, li));
  } else {
    const site = switchSite(m);
    row.append(main, modSwitch(document, {
      id: m.id, site, enabled: isOn(m.id, site), labelId,
      apply: (id, enabled, s) => request({ type: 'mod.enable', id, enabled, tab: view.tab?.id, ...(s ? { site: s } : {}) }),
    }), deleteButton(m, labelId, li));
  }
  const err = el('div', 'mod-err');
  err.hidden = true;
  li.append(row, err);
  if (m.update && !m.held) li.append(updateNotice(m, err));
  return li;
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

// Green when the mod runs on the tab's page: switched on (here), matching this URL, not on hold.
function updateLight(li, m, on) {
  const light = li.querySelector('.light');
  const running = on && !m.held && modAppliesTo(withOffSites(m, view.offSites[m.id]), view.tab?.url || '');
  light.classList.toggle('on', running);
  light.title = running ? 'Running on this page' : m.held ? 'On hold' : !on ? 'Switched off' : 'Not running on this page';
}

function updateModItem(li, m) {
  if (!m) return;
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
    tag.textContent = 'on hold';
    tag.hidden = false;
    const err = li.querySelector('.mod-err');
    if (rowErr) { err.textContent = rowErr; err.hidden = false; } else if (!li.querySelector('.allow')?.disabled) {
      err.textContent = `An agent wrote this while working here, but ${m.held.reason}. It won't run until you allow it.`;
      err.hidden = false;
    }
    return;
  }
  const site = switchSite(m);
  const on = shownEnabled(m.id, isOn(m.id, site), site);
  li.classList.toggle('off', !on);
  updateLight(li, m, on);
  // "not active"/"paused" only once the status agrees the mod is on (not mid-switch).
  const tag = li.querySelector('.tag');
  tag.textContent = on && m.enabled !== false && !m.registered ? (view.status.userScripts ? 'not active' : 'paused')
    : !on && m.from ? `from ${m.from}` : '';
  tag.title = !on && m.from ? `Made from ${m.from}. Mods made in another browser start off here; switch it on to use it.` : '';
  tag.hidden = !tag.textContent;
  const err = li.querySelector('.mod-err');
  err.textContent = rowErr || switchError(m.id, site) || (on && m.error) || '';
  err.hidden = !err.textContent;
}

function renderMessages() {
  const msgs = view.site ? view.chat.messages : [];
  const r = view.rendered;
  const nearBottom = ui.chat.scrollHeight - ui.chat.scrollTop - ui.chat.clientHeight < 60;
  const sameThread = r.site === view.site && msgs.length >= r.count && (r.count === 0 || msgs[0]?.time === r.first);
  if (!sameThread) {
    ui.messages.replaceChildren(...msgs.map(messageNode));
  } else if (msgs.length > r.count) {
    ui.messages.append(...msgs.slice(r.count).map(messageNode));
  }
  const changed = !sameThread || msgs.length !== r.count;
  view.rendered = { site: view.site, count: msgs.length, first: msgs[0]?.time ?? null };
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
}

async function saveModel(agentId, model) {
  if (!agentId) return;
  await saveSettings({ models: { ...chatSettings().models, [agentId]: model } });
}

// ---- actions ------------------------------------------------------------------------------------

/**
 * Changes this site chat's agent settings (its pick), and makes them the default for sites without one.
 * (No site: just the default.)
 */
async function saveSettings(patch) {
  const next = { ...chatSettings(), ...patch };
  view.settings = normalizeSettings(next);
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
  try {
    await startRun(text);
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
  view.myRuns.add(runId);
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
    else chrome.tabs.create({ url });
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
ui.gateBtn.addEventListener('click', () => setSiteOn(true));
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
    setMarkdown(md, notes);
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
  chrome.tabs.create({ url: reportLink(url, text, view.site || '') });
}

$('#report-link').addEventListener('click', (e) => { e.preventDefault(); openReport(); });

init().catch((e) => console.error('[TRIF] side panel failed to start', e));
