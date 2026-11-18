// The All mods page in the extension (allmods.html): mounts allmods.js with the background's port, the way the
// side panel talks to it (a `panel` port, requests with a reqId), the switches from chrome.storage.local, and the
// sites' icons the browser already shows in its tabs (nothing fetched for them).

import { mountAllMods } from './allmods.js';
import { loadExplain } from './explain.js';
import { siteForUrl, scopeFor, normalizeOffSites, sensitiveSites, setBrowser } from './lib.js';
import { siteUrl } from './allmods-model.js';

let port = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();

function connect() {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'reply') {
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'error'));
    } else if (msg?.type === 'statusChanged') {
      for (const fn of listeners) fn({ status: true });
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    for (const p of pending.values()) p.reject(new Error('lost connection to the TRIF service worker'));
    pending.clear();
    setTimeout(() => { if (!port) connect(); for (const fn of listeners) fn({ status: true }); }, 500); // (the worker restarted)
  });
}

function request(msg) {
  if (!port) connect();
  const reqId = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    try { port.postMessage({ ...msg, reqId }); } catch (e) { pending.delete(reqId); reject(e); }
  });
}

async function switches() {
  const s = await chrome.storage.local.get(['disabled', 'offSites']).catch(() => ({}));
  return { disabled: s.disabled || {}, offSites: normalizeOffSites(s.offSites) };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.disabled || changes.offSites)) return;
  const sw = {};
  if (changes.disabled) sw.disabled = changes.disabled.newValue || {};
  if (changes.offSites) sw.offSites = normalizeOffSites(changes.offSites.newValue);
  for (const fn of listeners) fn({ switches: sw });
});

/** The icon of each site open in a tab, as the browser shows it there: site -> address. Fetches nothing. */
async function favicons() {
  const out = new Map();
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) {
    const site = siteForUrl(t.url || '');
    const icon = String(t.favIconUrl || '');
    if (!site || !/^(https?:|data:image\/)/.test(icon)) continue;
    for (const s of new Set([site, scopeFor(site)])) if (s && !out.has(s)) out.set(s, icon);
  }
  return out;
}

/** A site's tab: one already open on it, brought to the front; else a new tab next to this one. */
async function openSite(site) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const t = tabs.find((x) => { const s = siteForUrl(x.url || ''); return s && (s === site || s.endsWith(`.${site}`)); });
  if (t) {
    await chrome.tabs.update(t.id, { active: true }).catch(() => {});
    await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    return;
  }
  const url = siteUrl(site);
  if (url) await chrome.tabs.create({ url, active: true });
}

// (memoised: the status is the same object until the next refresh)
let sensFor = null, sensModel = null;
function sensitive(status) {
  if (status === sensFor && sensModel) return sensModel;
  sensFor = status;
  sensModel = sensitiveSites({ list: status?.sensitiveSites ?? null, pending: (status?.sensitive?.pending || []).map((p) => p.host), hosts: status?.sensitive?.splits || [] });
  return sensModel;
}

async function start() {
  await loadExplain(); // (the approval card's "more")
  connect();
  const api = {
    request: async (msg) => {
      const r = await request(msg);
      if (msg.type === 'status' && r?.browser) setBrowser(r.browser);
      return r;
    },
    switches,
    onChange: (fn) => listeners.add(fn),
    openSite,
    favicons,
    sensitive,
  };
  window.__trifAllMods = mountAllMods(document.getElementById('app'), api);
}

start().catch((e) => console.error('[TRIF] the All mods page failed to start', e));
