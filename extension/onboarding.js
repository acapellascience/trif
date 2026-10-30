// Status page: helper connection, the "Allow User Scripts" switch, installed mods (each with an on/off
// switch, shared with the side panel). Polls the service worker, which also re-checks the switch on
// every status request; switches follow chrome.storage.local `disabled` live.

import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';

const $ = (sel) => document.querySelector(sel);
let last = null;        // last status
let modsKey = null;     // which mods the list was built for (switches update in place)
let disabled = {};      // chrome.storage.local `disabled`

function setSection(id, ok, title, detail) {
  const el = document.getElementById(id);
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
  el.querySelector('.title').textContent = title;
  const d = el.querySelector('.detail');
  d.replaceChildren(...(Array.isArray(detail) ? detail : [detail ?? '']));
}

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

function render(s) {
  if (s.helper.connected) {
    setSection('helper', true, 'Helper connected', 'Your coding agent can use the webmods command.');
  } else {
    setSection('helper', false, 'Helper not connected', [
      'Run ', code('npx webmods setup'), ' in a terminal (it needs Node 18 or newer), then quit and restart Chrome.',
      el('br'), 'Already set up? Run ', code('webmods doctor'), ' to see what\'s wrong.',
      ...(s.helper.error ? [el('br'), `Chrome says: ${s.helper.error}`] : []),
    ]);
  }
  $('#reconnect').hidden = s.helper.connected;

  if (s.userScripts) {
    setSection('userscripts', true, 'User scripts allowed', 'Mods can run on websites.');
  } else {
    setSection('userscripts', false, 'User scripts are off',
      'Open the extension settings and turn on "Allow User Scripts".');
  }
  $('#settings').hidden = !!s.userScripts;

  last = s;
  renderMods();
  const rec = s.recording.length ? ` · recording requests on ${s.recording.join(', ')}` : '';
  $('#footer').textContent = `WebMods ${s.version} · Chrome ${s.chrome}${rec}`;
}

let labelSeq = 0;
onSwitchChange(() => { if (last) renderMods(); });

function renderMods() {
  const s = last;
  const list = $('#mod-list');
  const modsDetail = $('#mods .detail');
  if (!s.mods.length) {
    modsDetail.replaceChildren('No mods yet. Open your coding agent in ', code('~/.webmods'), ' and ask it to change a website.');
  } else {
    modsDetail.replaceChildren();
  }
  // Rebuilt only when the set of mods changes, so a focused switch keeps focus through the polling.
  const key = JSON.stringify(s.mods.map((m) => [m.id, m.name, m.description]));
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
    tag.textContent = on && m.enabled !== false && !m.registered ? (s.userScripts ? 'not active' : 'paused') : '';
    tag.hidden = !tag.textContent;
    const err = li.querySelector('.mod-err');
    err.textContent = switchError(m.id) || (on && m.error) || '';
    err.hidden = !err.textContent;
  }
  syncSwitches(list, (id) => enabledIn(disabled, id));
}

// Mods grouped by website: the folder name without "www.", so www.google.com and google.com mods
// share a group. Sites alphabetically, mods by name.
function groupBySite(mods) {
  const groups = new Map();
  for (const m of mods) {
    const site = String(m.site || m.id.split('/')[0]).replace(/^www\./, '');
    if (!groups.has(site)) groups.set(site, []);
    groups.get(site).push(m);
  }
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

// A collapsible group: the site and how many of its mods are on, then the mods with their switches.
function siteGroup(site, mods, open) {
  const li = el('li', 'site');
  const details = el('details');
  details.dataset.site = site;
  details.open = open;
  const summary = el('summary');
  summary.append(el('span', 'site-name', site), el('span', 'site-count'));
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
  const err = el('div', 'mod-err');
  err.hidden = true;
  main.append(err);
  li.append(main, modSwitch(document, {
    id: m.id, enabled: enabledIn(disabled, m.id), labelId,
    apply: async (id, enabled) => {
      const r = await chrome.runtime.sendMessage({ type: 'mod.enable', id, enabled });
      if (!r || r.error) throw new Error(r?.error || 'no answer from the WebMods service worker');
      return r;
    },
  }));
  return li;
}

async function refresh() {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'status' });
    if (s && !s.error) render(s);
  } catch (e) {
    console.warn('status failed', e);
  }
}

$('#settings').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
$('#reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  setTimeout(refresh, 800);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.disabled) return;
  disabled = changes.disabled.newValue || {};
  if (last) renderMods();
});

chrome.storage.local.get('disabled').then((s) => { disabled = s.disabled || {}; }, () => {}).finally(refresh);
setInterval(refresh, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
