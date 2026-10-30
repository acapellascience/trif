// Side panel: chat with your coding agent about the site in the active tab. Follows the active tab
// of its window. The background relays agent runs to the helper and writes each run's transcript to
// chrome.storage.local `chat:<site>`; this page renders that record and reacts to storage changes.
// See docs/PROTOCOL.md, "Side panel and agent runs".

import { siteForUrl, modAppliesTo, modSites, isMultiSite, offOnSite, normalizeOffSites, isLoginUrl, scopeFor, limitToSites, withOffSites, FIREFOX, BROWSER } from './lib.js';
import { renderMarkdown, MARKDOWN_ELEMENTS, MARKDOWN_ATTRIBUTES } from './markdown.js';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';

const $ = (sel) => document.querySelector(sel);
const chatKey = (site) => `chat:${site}`;
const emptyChat = () => ({ sessionId: null, agent: null, messages: [], run: null, last: null });

const ui = {
  dot: $('#dot'), site: $('#site'), siteSwitch: $('#site-switch'), newChat: $('#new-chat'), settingsBtn: $('#settings-btn'),
  gate: $('#gate'), gateBtn: $('#gate-btn'), gateErr: $('#gate-err'),
  settings: $('#settings'), agent: $('#agent'), agentNote: $('#agent-note'), model: $('#model'),
  instructions: $('#instructions'), instructionsNote: $('#instructions-note'),
  notice: $('#notice'), mods: $('#mods'), modsCount: $('#mods-count'), modList: $('#mod-list'),
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
  settings: { agent: '', model: '' },
  rendered: { site: null, count: 0, first: null },
  modsOpenFor: null,         // set once the mods <details> open state has been restored
  modsKey: null,             // which mods the list was last built for (switches update in place)
  disabled: {},              // chrome.storage.local `disabled`: mods switched off (by anyone: panel, agent, CLI)
  offSites: {},              // chrome.storage.local `offSites`: mods switched off on some of their sites
  myRuns: new Set(),         // runs this panel started
  login: null,               // agent login in progress: {loginId, agent, name, fix, phase, url, error, early}
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
    for (const p of pending.values()) p.reject(new Error('lost connection to the WebMods service worker'));
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
    const L = view.login;
    if (L && L.loginId && msg.runId === L.loginId) return onLoginEvent(L, msg.event);
    if (L && !L.loginId && !view.myRuns.has(msg.runId) && L.early.length < 50) L.early.push(msg); // before agent.login's reply
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
  } catch (e) {
    console.warn('[webmods] status failed', e);
  }
  render();
}

async function loadAgents() {
  try {
    view.agents = await request({ type: 'agent.list' });
    view.agentsError = null;
  } catch (e) {
    view.agents = null;
    view.agentsError = String(e?.message ?? e);
  }
  renderSettings();
  render();
}

/** The agent a new run would use: the chosen one, else the helper's default. */
function currentAgent() {
  const list = view.agents?.agents || [];
  const id = view.settings.agent || view.agents?.default || '';
  return { id, info: list.find((a) => a.id === id) || null, list };
}

// ---- tab following ------------------------------------------------------------------------------

async function init() {
  connectPort();
  const win = await chrome.windows.getCurrent();
  view.windowId = win.id;
  const stored = await chrome.storage.local.get(['settings', 'disabled', 'offSites']);
  view.settings = { agent: '', model: '', ...(stored.settings || {}) };
  view.disabled = stored.disabled || {};
  view.offSites = normalizeOffSites(stored.offSites);
  renderSettings();

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId === view.windowId) chrome.tabs.get(tabId).then(setTab, () => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tabId === view.tab?.id && (info.url !== undefined || info.status !== undefined)) setTab(tab);
  });
  chrome.tabs.onAttached.addListener(() => followActiveTab());
  chrome.tabs.onDetached.addListener(() => followActiveTab());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (view.site && changes[chatKey(view.site)]) {
      view.chat = normalizeChat(changes[chatKey(view.site)].newValue);
      render();
    }
    if (changes.settings) {
      view.settings = { agent: '', model: '', ...(changes.settings.newValue || {}) };
      renderSettings();
      render();
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
  }
  render();
}

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

/** Insert renderMarkdown output (already safe by construction) through the Sanitizer as a second fence. */
function setMarkdown(node, text) {
  const html = renderMarkdown(text);
  if (typeof node.setHTML === 'function') {
    try {
      node.setHTML(html, { sanitizer: { elements: MARKDOWN_ELEMENTS, attributes: MARKDOWN_ATTRIBUTES } });
      return;
    } catch { /* older Sanitizer API shape: fall through */ }
  }
  node.innerHTML = html;
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

  ui.site.textContent = site || 'WebMods';
  ui.site.title = view.tab?.url || '';
  document.title = site ? `WebMods · ${site}` : 'WebMods';

  // Status dot
  let dot = 'bad';
  let dotLabel = 'Helper not connected';
  if (!status) { dot = ''; dotLabel = 'Checking…'; }
  else if (helperOk) {
    const agentOk = agentInfo ? agentInfo.available && agentInfo.loggedIn !== false : anyAgent;
    dot = status.userScripts && agentOk ? 'ok' : 'warn';
    dotLabel = !status.userScripts ? 'User scripts are off'
      : agentInfo?.available && agentInfo.loggedIn === false ? `${agentInfo.name} isn’t logged in`
      : !agentOk ? 'Coding agent not available'
      : `Ready${agentInfo ? ` · ${agentInfo.name}` : ''}`;
  }
  ui.dot.className = `dot ${dot}`;
  ui.dot.title = dotLabel;
  ui.dot.setAttribute('aria-label', dotLabel);

  renderGate();
  renderNotice({ helperOk, agentInfo, anyAgent });
  renderMods();
  renderMessages();

  ui.empty.hidden = !site || chat.messages.length > 0;
  ui.working.hidden = !running;

  ui.newChat.disabled = !site || (chat.messages.length === 0 && !running);
  const canSend = !!site && helperOk && (agentInfo ? agentInfo.available : (view.agents ? anyAgent : true));
  ui.input.disabled = !site;
  ui.input.placeholder = site ? `What would you like to change on ${site}?` : 'Open a website to customize it';
  ui.send.hidden = running;
  ui.stop.hidden = !running;
  ui.stop.disabled = !chat.run?.runId;
  ui.send.disabled = !canSend;
  ui.composer.dataset.canSend = canSend ? '1' : '';
}

function renderNotice({ helperOk, agentInfo, anyAgent }) {
  const n = ui.notice;
  const { site, status } = view;
  const parts = [];
  let bad = false;
  if (helperOk && (view.login || needsLogin(agentInfo))) {
    // Built once per state, so the status refresh doesn't wipe the code being typed.
    const L = view.login;
    const key = JSON.stringify(['login', L?.phase, L?.error, L?.name || agentInfo?.name, agentInfo?.canLogin, agentInfo?.loginFix]);
    if (n.dataset.key === key && !n.hidden) return;
    n.dataset.key = key;
    const { nodes, tone } = loginNotice(agentInfo);
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
    parts.push(el('p', null, 'Open a website in this window to customize it.'));
  } else if (status && !helperOk) {
    bad = true;
    const p = el('p');
    p.append('Run ', code('npx webmods setup'), ` in a terminal (needs Node 18+), then restart ${BROWSER}.`);
    parts.push(el('p', 'title', 'The WebMods helper isn’t connected'), p);
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
    actions.append(retry, setup);
    parts.push(actions);
  } else if (status && !status.userScripts) {
    parts.push(el('p', 'title', 'Mods are paused'));
    parts.push(el('p', null, FIREFOX
      ? 'Allow user scripts for WebMods so mods can run on websites.'
      : 'Turn on “Allow User Scripts” for WebMods so mods can run on websites.'));
    const actions = el('p', 'actions');
    const open = el('button', 'btn primary', FIREFOX ? 'Allow user scripts' : 'Open extension settings');
    open.type = 'button';
    open.addEventListener('click', () => {
      // Firefox grants userScripts only through this prompt, which must open from the click itself.
      if (FIREFOX) chrome.permissions.request({ permissions: ['userScripts'] }).then(() => setTimeout(refreshStatus, 300), () => {});
      else chrome.tabs.create({ url: status.settingsUrl || `chrome://extensions/?id=${chrome.runtime.id}` });
    });
    actions.append(open);
    parts.push(actions);
  } else if (helperOk && view.agents && (agentInfo ? !agentInfo.available : !anyAgent)) {
    bad = true;
    if (agentInfo) {
      parts.push(el('p', 'title', `${agentInfo.name} isn’t available`));
      if (agentInfo.note) { const p = el('p'); setMarkdown(p, agentInfo.note); parts.push(p); }
    } else {
      parts.push(el('p', 'title', 'No coding agent found'));
      parts.push(el('p', null, 'Install Claude Code, then run npx webmods setup again from the same terminal.'));
    }
    if (anyAgent) parts.push(el('p', 'note', 'Pick another agent in Settings.'));
  } else if (helperOk && view.agentsError && !view.agents) {
    parts.push(el('p', 'note', `Couldn’t list coding agents: ${view.agentsError}`));
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

/** Notice contents for the login flow: {nodes, tone: ''|'bad'|'ok'}. */
function loginNotice(agentInfo) {
  const L = view.login;
  const name = L?.name || agentInfo?.name || 'The agent';
  const fix = L?.fix || agentInfo?.loginFix || '';
  const fallback = () => (fix ? markdownBlock('note', `Or ${fix}.`) : null);
  const cancel = () => button('Cancel', '', cancelLogin);
  const nodes = [];
  let tone = '';
  switch (L?.phase) {
    case 'starting':
      nodes.push(el('p', 'title', `Logging in to ${name}…`), el('p', null, 'Opening the sign-in page…'), actions(cancel()));
      break;
    case 'code': {
      nodes.push(el('p', 'title', `Logging in to ${name}`),
        el('p', null, 'Finish signing in in the tab that opened, then paste the code it shows here:'));
      const form = el('form', 'login-form');
      const input = el('input');
      Object.assign(input, { type: 'text', name: 'code', placeholder: 'Code', autocomplete: 'off', spellcheck: false, required: true });
      input.setAttribute('aria-label', 'Login code');
      form.append(input, Object.assign(el('button', 'btn primary', 'Submit'), { type: 'submit' }));
      form.addEventListener('submit', (e) => { e.preventDefault(); submitLoginCode(input.value); });
      nodes.push(form);
      if (L.error) nodes.push(el('p', 'note', L.error));
      const again = el('a', null, 'Open the sign-in page again');
      again.href = '#';
      again.addEventListener('click', (e) => { e.preventDefault(); if (isLoginUrl(L.url)) chrome.tabs.create({ url: L.url, active: true }); });
      nodes.push(actions(cancel(), again));
      break;
    }
    case 'checking':
      nodes.push(el('p', 'title', `Logging in to ${name}`), el('p', null, 'Checking the code…'), actions(cancel()));
      break;
    case 'success':
      tone = 'ok';
      nodes.push(el('p', 'title', 'Logged in'), el('p', null, `${name} is ready.`));
      break;
    case 'failed':
      tone = 'bad';
      nodes.push(el('p', 'title', `Couldn’t log in to ${name}`));
      if (L.error) nodes.push(markdownBlock('', L.error));
      nodes.push(actions(button('Try again', 'primary', () => startLogin(L.agent, name, fix))));
      nodes.push(fallback());
      break;
    default: // not started
      nodes.push(el('p', 'title', `${name} isn’t logged in`));
      if (agentInfo?.canLogin) {
        nodes.push(el('p', null, 'Log in with your account to use it from this panel.'));
        nodes.push(actions(button('Log in', 'primary', () => startLogin(agentInfo.id, name, fix))));
        nodes.push(fallback());
      } else if (fix) {
        nodes.push(markdownBlock('', `To log in, ${fix}.`));
      }
  }
  return { nodes: nodes.filter(Boolean), tone };
}

function actions(...children) {
  const p = el('p', 'actions');
  p.append(...children.filter(Boolean));
  return p;
}

async function startLogin(agent, name, fix) {
  const L = { loginId: null, agent, name, fix, phase: 'starting', url: null, error: null, early: [] };
  view.login = L;
  render();
  let loginId;
  try {
    ({ loginId } = await request({ type: 'agent.login', agent: agent || undefined }));
  } catch (e) {
    if (view.login === L) loginFailed(L, String(e?.message ?? e));
    return;
  }
  if (view.login !== L) { // cancelled meanwhile
    request({ type: 'agent.loginCancel', loginId }).catch(() => {});
    return;
  }
  L.loginId = loginId;
  const early = L.early.filter((m) => m.runId === loginId);
  L.early = [];
  for (const m of early) onLoginEvent(L, m.event);
}

function onLoginEvent(L, event) {
  if (view.login !== L || !event) return;
  switch (event.kind) {
    case 'login': {
      if (L.url) return;
      if (!isLoginUrl(event.url)) {
        request({ type: 'agent.loginCancel', loginId: L.loginId }).catch(() => {});
        loginFailed(L, `${L.name} gave a sign-in link that isn’t on claude.com, claude.ai or anthropic.com, so WebMods didn’t open it.`);
        return;
      }
      L.url = event.url;
      L.phase = 'code';
      chrome.tabs.create({ url: L.url, active: true }).catch((e) => console.warn('[webmods] could not open the sign-in page', e));
      break;
    }
    case 'text':
      // A complaint about the code while it's being checked: let the user paste it again.
      if (L.phase === 'checking' && /invalid|error|fail|expired|try again/i.test(String(event.text))) {
        L.phase = 'code';
        L.error = String(event.text);
      }
      break;
    case 'error':
      L.error = String(event.message || '');
      break;
    case 'done':
      if (event.ok) {
        L.phase = 'success';
        L.error = null;
        loadAgents();
        setTimeout(() => { if (view.login === L) { view.login = null; render(); } }, 2500);
      } else if (event.cancelled) {
        view.login = null;
      } else {
        loginFailed(L, L.error || 'The login didn’t finish.');
        return;
      }
      break;
    default:
      return;
  }
  render();
}

function loginFailed(L, message) {
  L.phase = 'failed';
  L.error = message;
  render();
}

async function submitLoginCode(value) {
  const L = view.login;
  const code = String(value ?? '').trim();
  if (!L || L.phase !== 'code' || !code) return;
  L.phase = 'checking';
  L.error = null;
  render();
  try {
    await request({ type: 'agent.loginCode', loginId: L.loginId, code });
  } catch (e) {
    if (view.login === L && L.phase === 'checking') { L.phase = 'code'; L.error = String(e?.message ?? e); render(); }
  }
}

function cancelLogin() {
  const L = view.login;
  if (!L) return;
  view.login = null;
  if (L.loginId) request({ type: 'agent.loginCancel', loginId: L.loginId }).catch(() => {});
  render();
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
  if (!mods.length) { view.modsKey = null; ui.modList.replaceChildren(); return; }
  ui.modsCount.textContent = `(${mods.length})`;
  // Rebuilt only when the set of mods changes; everything else updates in place, so a focused switch
  // keeps focus through status refreshes.
  const key = JSON.stringify([site, mods.map((m) => [m.id, m.name, m.file, !!m.held, m.risk?.tier ?? null, m.risk?.why ?? null, m.matches])]);
  if (key !== view.modsKey) {
    view.modsKey = key;
    ui.modList.replaceChildren(...mods.map(modItem));
  }
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

// WebMods is off on a site until the user turns it on here (see "sites WebMods is on for" in lib.js):
// until then the panel shows only "WebMods is disabled" and the button, and nothing runs or reads the
// site. Once on, the header's switch turns it back off. (Unknown until the first status: neither shows.)
const siteScope = () => (view.site ? scopeFor(view.site) : null);
const siteIsOn = () => !!siteScope() && (view.status?.sitesOn || []).includes(siteScope());
let siteSwitching = false;

function renderGate() {
  const scope = siteScope();
  const known = !!scope && !!view.status;
  const gated = known && !siteIsOn();
  document.body.classList.toggle('site-off', gated);
  ui.gate.hidden = !gated;
  ui.siteSwitch.hidden = !known;
  ui.siteSwitch.setAttribute('aria-checked', String(siteIsOn()));
  ui.siteSwitch.setAttribute('aria-busy', String(siteSwitching));
  ui.siteSwitch.title = ui.siteSwitch.dataset.error || (scope ? `WebMods on ${scope}` : '');
  ui.siteSwitch.setAttribute('aria-label', ui.siteSwitch.title);
  if (!gated) return;
  ui.gateBtn.textContent = `Enable WebMods on ${scope}`;
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
    const text = `Couldn't switch WebMods ${on ? 'on' : 'off'}: ${e?.message ?? e}`;
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
  main.append(light, name, el('div', 'mod-file', (m.file || m.id).split('/').pop()));
  const row = el('div', 'mod-row');
  if (m.held) {
    // Written by an agent run here but reaching other sites: not running until the user allows it.
    li.classList.add('held');
    const allow = el('button', 'btn allow', 'Allow');
    allow.type = 'button';
    allow.setAttribute('aria-describedby', labelId);
    allow.addEventListener('click', async () => {
      allow.disabled = true;
      try { await request({ type: 'mod.approve', id: m.id, tab: view.tab?.id }); } catch (e) {
        allow.disabled = false;
        const err = li.querySelector('.mod-err');
        err.textContent = String(e?.message ?? e);
        err.hidden = false;
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
  return li;
}

// Deleting moves the mod to the helper's trash (`webmods restore`), so it's one click, with an Undo on
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
    try {
      await request({ type: 'mod.delete', id: m.id, site: view.site, tab: view.tab?.id });
    } catch (e) {
      b.disabled = false;
      const err = li.querySelector('.mod-err');
      err.textContent = String(e?.message ?? e);
      err.hidden = false;
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
  if (m.held) {
    updateLight(li, m, false);
    const tag = li.querySelector('.tag');
    tag.textContent = 'on hold';
    tag.hidden = false;
    const err = li.querySelector('.mod-err');
    if (!li.querySelector('.allow')?.disabled) {
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
  err.textContent = switchError(m.id, site) || (on && m.error) || '';
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
  if (view.settings.agent && !list.some((a) => a.id === view.settings.agent)) {
    opts.push(new Option(view.settings.agent, view.settings.agent));
  }
  ui.agent.replaceChildren(...opts);
  ui.agent.value = view.settings.agent || '';
  const chosen = list.find((a) => a.id === (view.settings.agent || view.agents?.default));
  const note = chosen?.note || (view.agentsError && !view.agents ? 'Agents are listed once the helper is connected.' : '');
  ui.agentNote.textContent = note;
  ui.agentNote.hidden = !note;
  if (document.activeElement !== ui.model) ui.model.value = view.settings.model || '';
}

// ---- actions ------------------------------------------------------------------------------------

async function saveSettings(patch) {
  view.settings = { ...view.settings, ...patch };
  await chrome.storage.local.set({ settings: view.settings });
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
    if (!arg.trim()) {
      await note(`Model: ${view.settings.model || 'the agent\'s default'}. Change it with /model opus, sonnet, haiku or default.`);
    } else {
      const model = /^default$/i.test(arg.trim()) ? '' : arg.trim();
      await saveSettings({ model });
      if (document.activeElement !== ui.model) ui.model.value = model;
      await note(model ? `Model set to ${model} (from the next message)` : 'Model set to the agent\'s default');
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
    try { if (await panelCommand(text)) return; } catch (e) { console.warn('[webmods] command failed', e); }
  }
  const { id: agent } = currentAgent();
  const chat = view.chat;
  const sessionId = chat.sessionId && (!chat.agent || !agent || chat.agent === agent) ? chat.sessionId : undefined;
  ui.input.value = '';
  try {
    const { runId } = await request({
      type: 'agent.start', site: view.site, tabId: view.tab.id, url: view.tab.url, prompt: text,
      sessionId, agent: agent || undefined, model: view.settings.model.trim() || undefined,
    });
    view.myRuns.add(runId);
  } catch (e) {
    // The background records start failures in the chat; anything earlier goes back in the box.
    const inChat = view.chat.messages.some((m) => m.role === 'user' && m.text === text);
    if (!inChat && !ui.input.value) ui.input.value = text;
    console.warn('[webmods] agent.start failed', e);
  }
}

async function stop() {
  const runId = view.chat.run?.runId;
  if (!runId) return;
  ui.stop.disabled = true;
  try { await request({ type: 'agent.stop', runId }); } catch (e) { console.warn('[webmods] stop failed', e); }
}

async function newChat() {
  if (!view.site) return;
  await request({ type: 'chat.clear', site: view.site }).catch((e) => console.warn('[webmods] clear failed', e));
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
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    ui.input.value = chip.textContent;
    ui.input.focus();
  });
}
ui.settingsBtn.addEventListener('click', () => {
  const open = ui.settings.hidden;
  ui.settings.hidden = !open;
  ui.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open && view.status?.helper?.connected) { loadAgents(); loadInstructions(); }
});

// The user's standing instructions for every agent run: ~/.webmods/instructions.md, read and written
// through the helper (helper/lib/instructions.js). Loaded when settings open; saved as they type.
const INSTRUCTIONS_NOTE = 'Applies from your next message, here and in Claude Code in ~/.webmods.';
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
ui.agent.addEventListener('change', () => saveSettings({ agent: ui.agent.value }));
let modelTimer = null;
ui.model.addEventListener('input', () => {
  clearTimeout(modelTimer);
  modelTimer = setTimeout(() => saveSettings({ model: ui.model.value.trim() }), 400);
});
ui.model.addEventListener('change', () => { clearTimeout(modelTimer); saveSettings({ model: ui.model.value.trim() }); });
$('#setup-link').addEventListener('click', (e) => { e.preventDefault(); openSetup(); });

init().catch((e) => console.error('[webmods] side panel failed to start', e));
