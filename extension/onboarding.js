// Status page: helper connection, the "Allow User Scripts" switch, installed mods (each with an on/off
// switch, shared with the side panel). Polls the service worker, which also re-checks the switch on
// every status request; switches follow chrome.storage.local `disabled` live.

import { modSites, offOnSite, normalizeOffSites, FIREFOX, BROWSER } from './lib.js';

const PANEL = FIREFOX ? 'sidebar' : 'side panel';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';

const $ = (sel) => document.querySelector(sel);
let last = null;        // last status
let modsKey = null;     // which mods the list was built for (switches update in place)
let disabled = {};      // chrome.storage.local `disabled`
let offSites = {};      // chrome.storage.local `offSites`: mods switched off on some of their sites

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
      'Run ', code('npx webmods setup'), ` in a terminal (it needs Node 18 or newer), then quit and restart ${BROWSER}.`,
      el('br'), 'Already set up? Run ', code('webmods doctor'), ' to see what\'s wrong.',
      ...(s.helper.error ? [el('br'), `${BROWSER} says: ${s.helper.error}`] : []),
    ]);
  }
  $('#reconnect').hidden = s.helper.connected;

  if (s.userScripts) {
    setSection('userscripts', true, 'User scripts allowed', 'Mods can run on websites.');
  } else {
    setSection('userscripts', false, 'User scripts are off', FIREFOX
      ? `Firefox asks before an add-on can run scripts on websites. Click "Allow user scripts" and confirm.`
      : 'Open the extension settings and turn on "Allow User Scripts".');
  }
  $('#settings').hidden = !!s.userScripts;

  last = s;
  renderMods();
  const rec = s.recording.length ? ` · recording requests on ${s.recording.join(', ')}` : '';
  $('#footer').textContent = `WebMods ${s.version} · ${BROWSER} ${s.chrome}${rec}`;
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
    tag.textContent = on && m.enabled !== false && !m.registered ? (s.userScripts ? 'not active' : 'paused') : '';
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
  if (!r || r.error) throw new Error(r?.error || 'no answer from the WebMods service worker');
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

if (FIREFOX) {
  $('#settings').textContent = 'Allow user scripts';
  $('.sub').textContent = $('.sub').textContent.replace('side panel', PANEL);
}
$('#settings').addEventListener('click', () => {
  // Firefox grants userScripts only through this prompt, which must open from the click itself.
  if (FIREFOX) chrome.permissions.request({ permissions: ['userScripts'] }).then(() => setTimeout(refresh, 300), () => {});
  else chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
$('#reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  setTimeout(refresh, 800);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.disabled || changes.offSites)) return;
  if (changes.disabled) disabled = changes.disabled.newValue || {};
  if (changes.offSites) offSites = normalizeOffSites(changes.offSites.newValue);
  if (last) renderMods();
});

chrome.storage.local.get(['disabled', 'offSites']).then((s) => {
  disabled = s.disabled || {};
  offSites = normalizeOffSites(s.offSites);
}, () => {}).finally(refresh);
setInterval(refresh, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
