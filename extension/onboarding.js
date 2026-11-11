// The setup page: a checklist that ticks itself off (the helper, TRIF in this browser, user scripts, which
// of Tim's mods to add, site by site, site permissions, the coding agent's login, then trying it), and the
// user's mods below (each with an on/off switch, shared with the side panel). Opens by itself when TRIF is installed. Polls the service worker for status
// (which also re-checks the user scripts switch); the agent list and the login go over a `panel` port,
// as in the side panel (login.js). Switches follow chrome.storage.local `disabled` live.

import { modSites, offOnSite, normalizeOffSites, normalizeSettings, scopeFor, siteNames, hasSiteAccess, FIREFOX, SAFARI, BROWSER, PANEL, SETUP_COMMAND } from './lib.js';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';
import { createLogin } from './login.js';
import { setMarkdown } from './markdown.js';

const OPEN_MODEL = 'codex-oss';

const $ = (sel) => document.querySelector(sel);
let last = null;        // last status
let modsKey = null;     // which mods the list was built for (switches update in place)
let disabled = {};      // chrome.storage.local `disabled`
let offSites = {};      // chrome.storage.local `offSites`: mods switched off on some of their sites
let settings = normalizeSettings(); // chrome.storage.local `settings`: the default agent (as the panel's Settings)
let agents = null;      // agent.list: {agents, default}, once the helper answers
let openModel = null;   // agent.openModel, while the open model is the agent

function code(text) {
  const c = document.createElement('code');
  c.textContent = text;
  return c;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(label, className, onClick) {
  const b = el('button', className ? `btn ${className}` : 'btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function link(text, href) {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

// ---- the port to the service worker (agent list, login), as the side panel's

let port = null;
let reqSeq = 0;
const pending = new Map();

function connectPort() {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'reply') {
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'error'));
    } else if (msg?.type === 'agentEvent') {
      login.onAgentEvent(msg);
    } else if (msg?.type === 'statusChanged') {
      refresh();
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    for (const p of pending.values()) p.reject(new Error('lost connection to the TRIF service worker'));
    pending.clear();
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

const login = createLogin({ request, changed: () => renderSteps(), succeeded: () => loadAgents() });

let loadingAgents = false;
async function loadAgents() {
  if (loadingAgents || !last?.helper.connected) return;
  loadingAgents = true;
  try {
    agents = await request({ type: 'agent.list' });
    openModel = currentAgent()?.id === OPEN_MODEL ? await request({ type: 'agent.openModel' }).catch(() => null) : null;
  } catch { /* the helper went away: the status says so */ }
  loadingAgents = false;
  renderSteps();
}

/** The agent the panel runs by default (its Settings' choice, else the helper's default), from agent.list. */
function currentAgent() {
  const list = agents?.agents || [];
  const id = settings.agent || agents?.default || '';
  return list.find((a) => a.id === id) || null;
}

/** The open model's provider name when it needs an API key and none is saved, else null. */
function keyMissing() {
  if (!openModel?.effective?.keyRequired || openModel.hasKey) return null;
  return (openModel.providers || []).find((p) => p.id === openModel.effective.provider)?.label || 'the provider';
}

async function useAgent(id) {
  settings = normalizeSettings({ ...settings, agent: id });
  await chrome.storage.local.set({ settings }).catch(() => {});
  openModel = null;
  loadAgents();
}

// ---- the steps

/** Fill a step's body, rebuilt only when `key` changes (so the login code being typed survives the polling). */
function setBody(step, key, build) {
  const body = step.querySelector('.body');
  if (body.dataset.key === key) return;
  body.dataset.key = key;
  body.replaceChildren(...build().filter(Boolean));
}

function renderSteps() {
  const s = last;
  if (!s) return;
  const connected = !!s.helper.connected;
  const steps = [];

  // 1. The helper.
  const helper = $('#step-helper');
  steps.push({ el: helper, done: connected, state: 'connected' });
  if (!connected) {
    const d = helper.querySelector('.detail');
    d.replaceChildren('Run ', code(SETUP_COMMAND), ` in a terminal (it needs Node 18 or newer), then quit and restart ${BROWSER}.`,
      // (The full path: `trif` alone works only once ~/.trif/bin is on PATH, and with no helper there's
      // nothing to ask whether it is.)
      el('br'), 'Already set up? Run ', code('~/.trif/bin/trif doctor'), ' to see what\'s wrong.',
      ...(s.helper.error ? [el('br'), `${BROWSER} says: ${s.helper.error}`] : []));
  }

  // 2. TRIF in this browser: this page is it.
  const browser = $('#step-browser');
  browser.querySelector('.name').textContent = `Add TRIF to ${BROWSER}`;
  steps.push({ el: browser, done: true, state: 'done' });

  // 3. User scripts (Safari runs mods without a switch for them).
  const scripts = $('#step-scripts');
  scripts.hidden = SAFARI;
  if (!SAFARI) steps.push({ el: scripts, done: !!s.userScripts, state: 'on' });

  // 4. Tim's mods: none until the user picks the sites.
  steps.push(starterStep(s, connected));

  // (No site-permission step: TRIF asks for each site's permission when it's turned on there.)

  // 5. The coding agent, logged in.
  steps.push(loginStep(connected));

  // 6. Try it: never ticked; once the rest are, it's what's left.
  steps.push(tryStep(s));

  const now = steps.findIndex((x) => !x.done);
  steps.forEach((x, i) => {
    x.el.classList.toggle('done', !!x.done);
    x.el.classList.toggle('now', i === now);
    x.el.classList.toggle('later', i > now && !x.done);
    x.el.querySelector('.mark').textContent = x.done ? '✓' : String(i + 1);
    x.el.querySelector('.state').textContent = x.done ? x.state : '';
  });
  const ready = now === steps.length - 1;
  $('#title').textContent = ready ? 'TRIF is ready' : 'Set up TRIF';
  $('#sub').textContent = ready ? 'Open any website, click the TRIF icon, and ask for a change.' : 'A few steps. Each one ticks itself off.';
}

// The agents stand on an equal footing here: the step names none of them, offers each one on this computer
// the same button (alphabetically), and ticks off as soon as any one of them is logged in, which then
// becomes the agent TRIF uses if the one it would have used (the default) isn't.
let adopting = null; // (the logged-in agent being made the choice, so a re-render doesn't ask again)
let terminalLogin = null; // an agent that logs in only in a terminal, whose button was clicked: its instructions show
const ready = (a, info, missing) => !!a?.available && (a.id === OPEN_MODEL ? a.id === info?.id && !missing : a.loggedIn === true);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function loginStep(connected) {
  const step = $('#step-login');
  const name = step.querySelector('.name');
  const info = currentAgent();
  const list = agents?.agents || [];
  const missing = info?.id === OPEN_MODEL ? keyMissing() : null;
  name.textContent = info?.id === OPEN_MODEL ? 'Set up the open model' : 'Log in to your coding agent';
  if (!connected) return { el: step, done: false };
  if (!agents) {
    setBody(step, 'checking', () => [el('p', null, 'Checking your coding agent…')]);
    return { el: step, done: false };
  }
  // Logged in only when the agent says so. The open model has no login to check (only its key); for the
  // others, no answer (an old or slow `auth status`) is not a yes: the step stays open, asking again.
  const here = list.filter((a) => a.available && a.id !== OPEN_MODEL).sort((a, b) => a.name.localeCompare(b.name));
  const openModelHere = list.find((a) => a.id === OPEN_MODEL && a.available);
  const readyOne = ready(info, info, missing) ? info : here.find((a) => ready(a, info, missing));
  if (readyOne && !login.current) {
    if (readyOne.id !== info?.id && adopting !== readyOne.id) { adopting = readyOne.id; useAgent(readyOne.id); }
    return { el: step, done: true, state: readyOne.id === OPEN_MODEL ? 'ready' : `${readyOne.name} logged in` };
  }

  const key = JSON.stringify([info?.id, missing, terminalLogin, here.map((a) => [a.id, a.loggedIn, a.canLogin]), !!openModelHere,
    login.current && [login.current.phase, login.current.error]]);
  setBody(step, key, () => {
    if (login.current) return login.nodes(info).nodes;
    if (!here.length && !openModelHere) {
      const p = el('p');
      p.append('TRIF needs a coding agent on this computer: ', link('Claude Code', 'https://claude.com/claude-code'), ' or ',
        link('Codex', 'https://github.com/openai/codex'), '. Install one, then run ', code(SETUP_COMMAND), ' again from the same terminal.');
      return [p];
    }
    // One button each, the same: logging in to one makes it the agent TRIF uses.
    const row = el('div', 'row');
    for (const a of here) {
      // (an agent with no login here, Codex today, gets the same button: it shows how, in a terminal)
      row.append(button(`Log in to ${a.name}`, 'primary', a.canLogin
        ? async () => { terminalLogin = null; if (a.id !== currentAgent()?.id) await useAgent(a.id); login.start(a.id, a.name, a.loginFix || ''); }
        : () => { terminalLogin = a.id; if (a.id !== currentAgent()?.id) useAgent(a.id); else renderSteps(); }));
    }
    if (openModelHere && info?.id !== OPEN_MODEL) row.append(button('Use an open model', '', () => useAgent(OPEN_MODEL)));
    if (missing) {
      return [el('p', null, `The open model needs your ${missing} API key: paste it in Settings, in the TRIF ${PANEL}.`),
        row.childElementCount ? row : null, el('p', 'wait', 'This ticks itself off once it’s saved, or once an agent is logged in.')];
    }
    const names = here.map((a) => a.name);
    const unknown = here.some((a) => a.loggedIn !== true && a.loggedIn !== false);
    const intro = !here.length ? 'TRIF runs your coding agent on your account.'
      : `TRIF runs your coding agent on your account. ${unknown
        ? `It couldn’t tell whether ${andList(names)} ${names.length > 1 ? 'are' : 'is'} logged in on this computer.`
        : `${here.length === 1 ? names[0] : here.length === 2 ? `Neither ${names[0]} nor ${names[1]}` : `None of ${andList(names)}`} is logged in on this computer yet.`}`;
    const shown = here.find((a) => a.id === terminalLogin && !a.canLogin);
    const how = shown ? el('div', 'md') : null;
    if (how) setMarkdown(how, `To log in to ${shown.name}, ${shown.loginFix || 'log in to it in a terminal'}.`);
    const wait = el('div', 'wait');
    setMarkdown(wait, 'This ticks itself off once one is logged in.');
    return [el('p', null, intro), row.childElementCount ? row : null, how, wait];
  });
  return { el: step, done: false };
}

// Tim's mods, site by site (helper/lib/preinstalled.js): nothing of his is on disk until the user picks the
// sites. "Add these" has the helper copy the ticked sites' mods in (each on or off as Tim set it: ticked
// means on the computer, not switched on), turn TRIF on for them and record none for the rest; "Start
// with none" records none for all. Either way the step is done, and Settings in the panel (or a site's
// own panel) adds any site's later. Ticked to start: the sites TRIF starts on for.
// (the code as this version shipped it: the release's tag)
const STARTER_SOURCE = `https://github.com/acapellascience/trif/tree/v${chrome.runtime.getManifest().version}/examples/sites`;
const picks = new Map(); // site -> ticked, once the user changes one
let starterBusy = false;
let starterError = '';

function starterStep(s, connected) {
  const step = $('#step-starter');
  const st = s.starter;
  if (!connected || !st) return { el: step, done: false };
  if (st.chosen) {
    const added = st.sites.filter((x) => x.choice === 'added').map((x) => x.name);
    return { el: step, done: true, state: added.length ? siteNames(added) : 'none' };
  }
  const ticked = (x) => (picks.has(x.site) ? picks.get(x.site) : x.suggested);
  setBody(step, JSON.stringify(['starter', st.sites, starterBusy, starterError]), () => {
    const intro = el('p', null, 'Tim made mods for a few sites. None of them is on your computer until you choose. They’re plain JavaScript you can read first: ');
    const see = link('see the code', STARTER_SOURCE);
    see.id = 'starter-source';
    intro.append(see, '.');
    const list = el('ul', 'picks');
    for (const x of st.sites) {
      const li = el('li', 'pick');
      li.dataset.site = x.site;
      const label = el('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = ticked(x);
      box.disabled = starterBusy;
      box.addEventListener('change', () => { picks.set(x.site, box.checked); add.disabled = starterBusy || !st.sites.some(ticked); });
      const name = el('span', 'pick-name', x.name);
      if (x.note) name.append(el('span', 'pick-note', x.note));
      label.append(box, name, el('span', 'pick-mods', x.mods.map((m) => m.name).join(', ')));
      li.append(label);
      list.append(li);
    }
    const row = el('div', 'row');
    const add = button('Add these', 'primary', () => chooseStarter({ type: 'shipped.install', sites: st.sites.filter(ticked).map((x) => x.site), others: 'none' }));
    const none = button('Start with none', '', () => chooseStarter({ type: 'shipped.none' }));
    [add.id, none.id] = ['starter-add', 'starter-none'];
    add.disabled = starterBusy || !st.sites.some(ticked);
    none.disabled = starterBusy;
    row.append(add, none);
    return [
      intro, list, row,
      el('p', 'note', `Each mod has its own switch in the TRIF ${PANEL}: you can turn any of them off individually, any time. You can add the others later, in the panel’s Settings.`),
      starterError ? el('p', 'problem', starterError) : null,
    ];
  });
  return { el: step, done: false };
}

async function chooseStarter(msg) {
  starterBusy = true;
  starterError = '';
  renderSteps();
  try { await request(msg); } catch (e) { starterError = `Couldn’t do that: ${e?.message ?? e}`; }
  starterBusy = false;
  refresh();
}

// The sites to try it on: where a mod TRIF comes with is switched on, and TRIF works on the site.
function trySites(s) {
  const blocked = s.blockedSites || [];
  const on = new Set((s.sitesOn || []).filter((x) => !blocked.includes(x) && hasSiteAccess(s.access || { all: true }, x)));
  const sites = [];
  for (const m of s.mods) {
    if (!['trif', 'webmods'].includes(m.source) || !isOn(m.id)) continue;
    const site = String(m.site || '').replace(/^www\./, '');
    if (!site.includes('.') || !on.has(scopeFor(site)) || sites.includes(site)) continue;
    sites.push(site);
  }
  return sites.sort().slice(0, 4);
}

function tryStep(s) {
  const step = $('#step-try');
  const sites = trySites(s);
  setBody(step, JSON.stringify(sites), () => {
    if (!sites.length) return [el('p', null, 'Open any website, click the TRIF icon, and ask for a change.')];
    const row = el('div', 'row');
    row.append(...sites.map((site, i) => button(`Open ${site}`, i ? '' : 'primary', () => chrome.tabs.create({ url: `https://${site}/` }))));
    return [el('p', null, 'See the difference, then ask for a change of your own.'), row];
  });
  return { el: step, done: false };
}

function render(s) {
  const wasConnected = !!last?.helper.connected;
  last = s;
  if (s.helper.connected && (!wasConnected || !agents)) loadAgents();
  if (!s.helper.connected) agents = null;
  renderSteps();
  renderMods();
  const rec = s.recording.length ? ` · recording requests on ${s.recording.join(', ')}` : '';
  $('#footer').textContent = `TRIF ${s.version} · ${BROWSER} ${s.chrome}${rec}`;
}

let labelSeq = 0;
onSwitchChange(() => { if (last) renderMods(); });

function renderMods() {
  const s = last;
  const list = $('#mod-list');
  const modsDetail = $('#mods .detail');
  if (!s.mods.length) {
    modsDetail.replaceChildren('No mods yet. Open any website, click the TRIF icon, and ask for a change.');
  } else {
    modsDetail.replaceChildren();
  }
  const groups = groupBySite(s.mods).map(([site]) => GROUP_NAMES[site] || site);
  $('#mods-sites').textContent = groups.length ? ` · ${groups.join(', ')}` : '';
  // Rebuilt only when the set of mods changes, so a focused switch keeps focus through the polling.
  const key = JSON.stringify(s.mods.map((m) => [m.id, m.name, m.description, m.matches, offSites[m.id] || []]));
  if (key !== modsKey) {
    modsKey = key;
    const open = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.site));
    list.replaceChildren(...groupBySite(s.mods).map(([site, mods]) => siteGroup(site, mods, open.has(site))));
  }
  const byId = new Map(s.mods.map((m) => [m.id, m]));
  for (const group of list.querySelectorAll('details[data-site]')) {
    const ids = [...group.querySelectorAll('li[data-mod]')].map((li) => li.dataset.mod);
    const on = ids.filter((id) => shownEnabled(id, enabledIn(disabled, id))).length;
    group.querySelector('.site-count').textContent =
      `${ids.length} mod${ids.length === 1 ? '' : 's'}${on === ids.length ? ', all on' : on ? `, ${on} on` : ', all off'}`;
  }
  for (const li of list.querySelectorAll('li[data-mod]')) {
    const m = byId.get(li.dataset.mod);
    const on = shownEnabled(m.id, enabledIn(disabled, m.id));
    li.classList.toggle('off', !on);
    const tag = li.querySelector('.tag');
    tag.textContent = on && m.enabled !== false && !m.registered ? (s.userScripts ? 'not active' : 'paused')
      : !on && m.from ? `from ${m.from}` : '';
    tag.title = !on && m.from ? `Made from ${m.from}. Mods made in another browser start off here; switch it on to use it.` : '';
    tag.hidden = !tag.textContent;
    const err = li.querySelector('.mod-err');
    err.textContent = switchError(m.id) || (on && m.error) || '';
    err.hidden = !err.textContent;
  }
  syncSwitches(list, isOn);
}

const isOn = (id, site) => enabledIn(disabled, id) && !(site && offOnSite(offSites, id, site));

async function applySwitch(id, enabled, site) {
  const r = await chrome.runtime.sendMessage({ type: 'mod.enable', id, enabled, ...(site ? { site } : {}) });
  if (!r || r.error) throw new Error(r?.error || 'no answer from the TRIF service worker');
  return r;
}

// Group keys that aren't websites: mods matching every site, and mods for several sites with none of
// them their folder (usually ones in sites/all-sites/).
const EVERY_SITE = '*';
const SEVERAL_SITES = '+';
const GROUP_NAMES = { [EVERY_SITE]: 'Every site', [SEVERAL_SITES]: 'Several sites' };

// A mod's group: its folder without "www." (so www.google.com and google.com mods share one) when the
// mod runs there, else the one site it runs on; a mod for x.com that also matches twitter.com is in x.com
// (with a switch per site under it).
function groupOf(m) {
  const { everywhere, sites } = modSites(m);
  if (everywhere) return EVERY_SITE;
  const folder = String(m.site || m.id.split('/')[0]).replace(/^www\./, '');
  const covers = (s) => s === folder || folder.endsWith('.' + s) || s.endsWith('.' + folder);
  if (!sites.length || sites.some(covers)) return folder;
  return sites.length === 1 ? sites[0] : SEVERAL_SITES;
}

// Every site first, then several sites, then websites alphabetically; mods by name.
function groupBySite(mods) {
  const groups = new Map();
  for (const m of mods) {
    const group = groupOf(m);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(m);
  }
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const rank = (g) => (g === EVERY_SITE ? 0 : g === SEVERAL_SITES ? 1 : 2);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

// A collapsible group: the site and how many of its mods are on, then the mods with their switches.
function siteGroup(site, mods, open) {
  const li = el('li', 'site');
  const details = el('details');
  details.dataset.site = site;
  details.open = open;
  const summary = el('summary');
  summary.append(el('span', 'site-name', GROUP_NAMES[site] || site), el('span', 'site-count'));
  const ul = el('ul', 'site-mods');
  ul.append(...mods.map(modItem));
  details.append(summary, ul);
  li.append(details);
  return li;
}

function modItem(m) {
  const li = el('li');
  li.dataset.mod = m.id;
  const labelId = `mod-name-${++labelSeq}`;
  const name = el('div', 'mod-name');
  const label = el('span', null, m.name);
  label.id = labelId;
  const tag = el('span', 'tag');
  tag.hidden = true;
  name.append(label, tag);
  const main = el('div', 'mod-main');
  main.append(name, el('div', 'mod-id', m.id.split('/').slice(1).join('/')));
  if (m.description) main.append(el('div', 'mod-desc', m.description));
  const siteList = siteSwitches(m);
  if (siteList) main.append(siteList);
  const err = el('div', 'mod-err');
  err.hidden = true;
  main.append(err);
  li.append(main, modSwitch(document, { id: m.id, enabled: enabledIn(disabled, m.id), labelId, apply: applySwitch }));
  return li;
}

// For a mod on several sites, a switch per site: the sites it names, plus any it was switched off on
// (for a mod on every site, those are all there is). Null when there's nothing to list.
function siteSwitches(m) {
  const { everywhere, sites } = modSites(m);
  if (!everywhere && sites.length < 2) return null;
  const off = offSites[m.id] || [];
  const all = [...sites, ...off.filter((o) => !sites.includes(o))];
  if (!all.length) return el('div', 'mod-sites', `Switch it off on one site from the ${PANEL} there.`);
  const ul = el('ul', 'site-switches');
  ul.setAttribute('aria-label', `${m.name} by site`);
  if (everywhere) ul.append(el('li', 'site-switches-note', 'Off on:'));
  for (const site of all) {
    const row = el('li');
    const label = el('span', null, site);
    label.id = `mod-site-${++labelSeq}`;
    row.append(label, modSwitch(document, { id: m.id, site, enabled: isOn(m.id, site), labelId: label.id, apply: applySwitch }));
    ul.append(row);
  }
  return ul;
}

async function refresh() {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'status' });
    if (s && !s.error) render(s);
  } catch (e) {
    console.warn('status failed', e);
  }
}

// Step 3's words: Chrome has a switch per extension (pictured); Firefox asks in a prompt.
$('#step-scripts .why').textContent = FIREFOX
  ? 'Mods are scripts that run on websites, and Firefox asks before an add-on runs them.'
  : 'Mods are scripts that run on websites, and Chrome asks you to allow that for each extension that runs them. One switch:';
$('#step-scripts .chrome-row').hidden = FIREFOX;
$('#settings').textContent = FIREFOX ? 'Allow user scripts' : 'Open TRIF’s Chrome settings';
$('#step-scripts .wait').textContent = FIREFOX ? 'Waiting for your OK: click Allow when Firefox asks.' : 'Waiting for the switch. Come back to this tab when it’s on.';
$('#settings').addEventListener('click', () => {
  // Firefox grants userScripts only through this prompt, which must open from the click itself.
  if (FIREFOX) chrome.permissions.request({ permissions: ['userScripts'] }).then(() => setTimeout(refresh, 300), () => {});
  else chrome.tabs.create({ url: last?.settingsUrl || `chrome://extensions/?id=${chrome.runtime.id}` });
});
$('#reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  setTimeout(refresh, 800);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) { // the agent picked here, or in a panel's Settings
    settings = normalizeSettings(changes.settings.newValue);
    openModel = null;
    loadAgents();
  }
  if (!(changes.disabled || changes.offSites)) return;
  if (changes.disabled) disabled = changes.disabled.newValue || {};
  if (changes.offSites) offSites = normalizeOffSites(changes.offSites.newValue);
  if (last) renderMods();
});

chrome.storage.local.get(['disabled', 'offSites', 'settings']).then((s) => {
  disabled = s.disabled || {};
  offSites = normalizeOffSites(s.offSites);
  settings = normalizeSettings(s.settings);
}, () => {}).finally(refresh);
setInterval(refresh, 2000);
// The agent's login can change outside (`claude` in a terminal): ask again while that step is open.
setInterval(() => { if (!document.hidden && $('#step-login').classList.contains('now') && !login.current) loadAgents(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
