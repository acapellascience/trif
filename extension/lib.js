// Logic shared by background.js and the tests. Nothing here touches `chrome` at import time; the
// functions that need Chrome APIs take them as parameters.

import { safeStringify, formatError } from './runtime.js';

// The running extension's own id: the Web Store build has a different one from the unpacked dev build
// (whose manifest key fixes it to this fallback, also used under Node in the tests).
export const EXTENSION_ID = globalThis.chrome?.runtime?.id || 'iaablflfafmonebdomeikadolkgdbkhe';
// The Firefox build (scripts/build-extension.js firefox) runs the same code; these cover the differences.
export const FIREFOX = !!globalThis.chrome?.runtime?.getURL?.('')?.startsWith('moz-extension:');
export const SAFARI = !!globalThis.chrome?.runtime?.getURL?.('')?.startsWith('safari-web-extension:');
export const BROWSER = FIREFOX ? 'Firefox' : SAFARI ? 'Safari' : 'Chrome';
// What the browser calls TRIF's panel: Chrome's side panel, Firefox's sidebar, Safari's window.
export const PANEL = FIREFOX ? 'sidebar' : SAFARI ? 'panel' : 'side panel';
// What sets the helper up for this browser: plain setup doesn't install Safari's bridge.
export const SETUP_COMMAND = SAFARI ? 'npx timsrobot setup --browser safari' : 'npx timsrobot setup';
export const SETTINGS_URL = FIREFOX ? 'about:addons' : SAFARI ? 'Safari Settings → Extensions' : `chrome://extensions/?id=${EXTENSION_ID}`;
// PROTOCOL.md calls this `__webmods_runtime`, but chrome.userScripts rejects ids starting with "_"
// (reserved for generated ids), so it is registered under this id.
export const RUNTIME_ID = 'webmods-runtime';
export const USER_SCRIPTS_OFF = FIREFOX
  ? 'User scripts aren\'t allowed for TRIF. Click the TRIF toolbar button, then "Allow user scripts", and reload the page.'
  : `User scripts are off for TRIF. Open ${SETTINGS_URL} and turn on "Allow User Scripts", then reload the page.`;
export const RUN_CAP = 1000000;

// ---- user scripts -------------------------------------------------------------------------------

/**
 * True when chrome.userScripts can be used: Chrome's "Allow User Scripts" switch is on, or in Firefox the
 * optional userScripts permission is granted (without it chrome.userScripts is undefined).
 */
export function userScriptsAvailable(chromeApi) {
  try {
    const p = chromeApi.userScripts.getScripts(); // throws when the switch is off
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

const RUN_AT = {
  document_start: 'document_start', 'document-start': 'document_start',
  document_end: 'document_end', 'document-end': 'document_end',
  document_idle: 'document_idle', 'document-idle': 'document_idle',
};
export function normalizeRunAt(runAt) {
  return RUN_AT[String(runAt || '').trim().toLowerCase()] || 'document_start';
}

/** Wrap a mod's code exactly as PROTOCOL.md specifies. */
export function wrapModCode(id, code) {
  const mod = JSON.stringify(id);
  return `(() => { const __mod = ${mod}; window.__webmods && (window.__webmods.current = __mod);
try { ${code}
} catch (e) { window.__webmods?.errors.push({mod: __mod, message: String(e?.message ?? e), stack: String(e?.stack ?? ""), time: Date.now()}); console.error("[TRIF]", __mod, e); }
})();
//# sourceURL=trif://${id}.js`;
}

export function modToUserScript(mod) {
  return {
    id: mod.id,
    matches: Array.isArray(mod.matches) ? mod.matches : [],
    excludeMatches: Array.isArray(mod.excludes) ? mod.excludes : [],
    js: [{ code: wrapModCode(mod.id, String(mod.code ?? '')) }],
    runAt: normalizeRunAt(mod.runAt),
    world: 'MAIN',
    allFrames: false,
  };
}

export function runtimeUserScript(code, matches = ['<all_urls>']) {
  return { id: RUNTIME_ID, matches, excludeMatches: [], js: [{ code }], runAt: 'document_start', world: 'MAIN', allFrames: false };
}

/**
 * Where the runtime goes: the pages the registered mods match, plus the sites being recorded. Not every
 * page: the runtime's globals (window.trif, window.webmods, window.__webmods) would let any site detect TRIF users.
 */
export function runtimeMatches(mods, recording = []) {
  const set = new Set();
  for (const m of mods || []) for (const p of Array.isArray(m.matches) ? m.matches : []) set.add(String(p));
  for (const site of recording || []) { set.add(`*://${site}/*`); set.add(`*://*.${site}/*`); }
  return [...set].sort();
}

/** Small non-cryptographic string hash (FNV-1a), used to remember the registered runtime. */
export function quickHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16) + ':' + s.length;
}

const errMsg = (e) => String(e?.message ?? e);

/**
 * The switched-off set from chrome.storage.local `disabled` ({"<mod id>": true}), cleaned up: only
 * `true` entries count. Ids of mods that no longer exist may linger; they're harmless and never shown.
 */
export function normalizeDisabled(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [id, off] of Object.entries(value)) if (off === true) out[id] = true;
  }
  return out;
}

/**
 * Make chrome.userScripts (`us`) contain exactly the runtime plus `mods`, minus the ids in
 * `disabled` (mods the user switched off: they're unregistered if registered, and not reported as
 * registered or as errors). `offSites` (mod id → sites it's switched off on) become extra excludes.
 * `applied` maps script id → hash of what was last registered (persisted by the caller).
 * The runtime must run before every mod, so whenever it is missing or its code or matches changed,
 * everything is unregistered and re-registered with the runtime first (registration order = injection
 * order). It only runs where a registered mod does, or on a site in `recording` (runtimeMatches); with
 * neither, nothing is registered at all. With `sitesOn`, mods are limited to those sites (limitToSites)
 * and so is `recording`.
 * Returns {registered, errors, applied, reset}.
 */
export async function syncUserScripts(us, { mods, runtimeCode, applied = {}, disabled = {}, offSites = {}, recording = [], sitesOn = null }) {
  // sitesOn (null: no limit): mods and recording only on the sites TRIF is on for (limitToSites).
  if (sitesOn) recording = (recording || []).filter((site) => (sitesOn || []).some((s) => hostInScope(site, s)));
  const errors = [];
  const desired = [];
  const seen = new Set();
  for (const mod of mods || []) {
    if (!mod || typeof mod.id !== 'string' || !mod.id) { errors.push({ id: String(mod?.id ?? ''), error: 'mod has no id' }); continue; }
    if (mod.id === RUNTIME_ID || seen.has(mod.id)) { errors.push({ id: mod.id, error: 'duplicate or reserved mod id' }); continue; }
    if (disabled[mod.id] === true) continue; // switched off: not desired, so unregistered below if registered
    if (mod.held) continue; // held for the user's approval (an agent wrote it for another site): same
    seen.add(mod.id);
    const limited = sitesOn ? limitToSites(mod, sitesOn) : mod;
    if (!limited) continue; // only on sites TRIF is off for
    desired.push(withOffSites(limited, offSites[mod.id]));
  }

  // (Anything registered that isn't wanted goes: a home page marker left by a development build too.)
  const existing = await us.getScripts();
  const existingIds = new Set(existing.map((s) => s.id));
  const matches = runtimeMatches(desired, recording);
  if (!matches.length) {
    if (existing.length) await us.unregister();
    return { registered: [], errors, applied: {}, reset: existing.length > 0 };
  }
  const runtimeHash = quickHash(runtimeCode + '\n' + JSON.stringify(matches));
  const current = existing.find((s) => s.id === RUNTIME_ID);
  const currentCode = current?.js?.[0]?.code;
  const sameMatches = (a) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify(matches);
  // (applied's hash also covers the fallback below, where the registered matches are <all_urls>.)
  const runtimeOk = !!current && (currentCode !== undefined
    ? currentCode === runtimeCode && (sameMatches(current.matches) || applied[RUNTIME_ID] === runtimeHash)
    : applied[RUNTIME_ID] === runtimeHash);

  const next = {};
  const registered = [];
  const registerMod = async (mod, update) => {
    try {
      if (update) await us.update([modToUserScript(mod)]);
      else await us.register([modToUserScript(mod)]);
      next[mod.id] = mod.hash ?? null;
      registered.push(mod.id);
    } catch (e) {
      errors.push({ id: mod.id, error: errMsg(e) });
    }
  };

  // Several mods in one call: Chrome shares every user script with its pages again after each call, so
  // ten 5 MB mods took 2-4 s one by one and 0.2-0.9 s in one call (Chrome 156). One bad mod fails the whole
  // call, so then they go one at a time and only that one is reported (any the call did register, updated).
  const registerMods = async (mods, update) => {
    if (!mods.length) return;
    if (mods.length > 1) {
      try {
        if (update) await us.update(mods.map(modToUserScript));
        else await us.register(mods.map(modToUserScript));
        for (const mod of mods) { next[mod.id] = mod.hash ?? null; registered.push(mod.id); }
        return;
      } catch { /* one at a time, below */ }
    }
    const there = update || mods.length === 1 ? null : new Set((await us.getScripts()).map((s) => s.id));
    for (const mod of mods) await registerMod(mod, update || !!there?.has(mod.id));
  };

  if (!runtimeOk) {
    if (existing.length) await us.unregister();
    // A mod with an invalid pattern makes the union invalid too; then the runtime goes everywhere
    // (the mod itself fails to register and is reported).
    try { await us.register([runtimeUserScript(runtimeCode, matches)]); } catch { await us.register([runtimeUserScript(runtimeCode)]); }
    next[RUNTIME_ID] = runtimeHash;
    await registerMods(desired, false);
    return { registered, errors, applied: next, reset: true };
  }

  next[RUNTIME_ID] = runtimeHash;
  const stale = existing.map((s) => s.id).filter((id) => id !== RUNTIME_ID && !seen.has(id));
  if (stale.length) await us.unregister({ ids: stale });
  const fresh = [];
  const changed = [];
  for (const mod of desired) {
    if (!existingIds.has(mod.id)) fresh.push(mod);
    else if (mod.hash && applied[mod.id] === mod.hash) { next[mod.id] = mod.hash; registered.push(mod.id); }
    else changed.push(mod);
  }
  await registerMods(changed, true);
  await registerMods(fresh, false);
  const order = new Map(desired.map((m, i) => [m.id, i]));
  registered.sort((a, b) => order.get(a) - order.get(b)); // (in the mods' order, as before they were batched)
  return { registered, errors, applied: next, reset: false };
}

// ---- mods sets in parts ---------------------------------------------------------------------------

/**
 * What this extension can do beyond 0.2.4's native messaging protocol, sent in its hello so the helper
 * never has to guess from the version: 'modsParts' takes a mods set bigger than one native message (1 MB)
 * as {type:"modsPart"} messages (ModsParts).
 */
export const FEATURES = ['modsParts'];

/**
 * Joins {type:"modsPart", set, i, n, data} messages back into the {type:"mods"} message the helper cut up
 * (helper/lib/mods.js modsParts): `data` is a slice of its JSON text, parts 0..n-1 of one `set` in order.
 * push(part) returns {message} once the last part is in (the whole set, to apply at once), {error} when the
 * sequence is broken (a part missing, out of order or malformed, or text that doesn't parse: the set so far
 * is dropped, and the helper should send it again; the rest of its parts are then ignored), else {}. A new
 * set's first part drops an unfinished older one (`superseded`: its id), as does a whole `mods` message
 * (reset()).
 */
export class ModsParts {
  constructor() {
    this.current = null;
    this.dropped = null; // the last set given up on: the rest of its parts are ignored, not more errors
  }

  reset() {
    const had = this.current;
    this.current = null;
    if (had) this.dropped = had.set;
    return had ? had.set : null;
  }

  push(part) {
    const { set, i, n, data } = part || {};
    const okSet = (typeof set === 'string' && set) || Number.isInteger(set);
    if (!okSet || !Number.isInteger(n) || n < 1 || !Number.isInteger(i) || i < 0 || i >= n || typeof data !== 'string') {
      const had = this.reset();
      return { error: `a malformed part of a mods set${had !== null ? ` (dropped set ${had})` : ''}` };
    }
    let superseded = null;
    if (i === 0) {
      superseded = this.reset();
      this.current = { set, n, parts: [] };
    } else if (set === this.dropped && this.current?.set !== set) {
      return {};
    } else if (!this.current || this.current.set !== set) {
      const had = this.reset();
      this.dropped = set;
      return { error: `part ${i + 1} of ${n} of mods set ${set} came without the parts before it${had !== null ? ` (dropped set ${had})` : ''}` };
    } else if (i !== this.current.parts.length || n !== this.current.n) {
      const had = this.current;
      this.reset();
      return { error: `mods set ${set}: got part ${i + 1} of ${n} after part ${had.parts.length} of ${had.n}; dropped it` };
    }
    this.current.parts.push(data);
    if (this.current.parts.length < n) return superseded !== null ? { superseded } : {};
    const text = this.current.parts.join('');
    this.current = null;
    let message;
    try { message = JSON.parse(text); } catch (e) { this.dropped = set; return { error: `mods set ${set} doesn't parse (${errMsg(e)}); dropped it` }; }
    if (!message || message.type !== 'mods' || !Array.isArray(message.mods)) { this.dropped = set; return { error: `mods set ${set} isn't a mods message; dropped it` }; }
    return superseded !== null ? { message, superseded } : { message };
  }
}

// ---- tabs ---------------------------------------------------------------------------------------

/** Test a tab URL against a selector: "/regex/flags" or a plain substring. */
export function urlMatcher(selector) {
  const s = String(selector);
  const m = /^\/(.+)\/([a-z]*)$/s.exec(s);
  if (m) {
    let re;
    try { re = new RegExp(m[1], m[2]); } catch (e) { throw new Error(`invalid url regex ${s}: ${e.message}`); }
    return (url) => re.test(url || '');
  }
  return (url) => (url || '').includes(s);
}

/**
 * Pick the target tab. `tabs` = all tabs in normal windows (in window/index order),
 * `focusedWindowId` = the last-focused normal window. Throws with a helpful message.
 * With `args.scope` (an agent run's site) only tabs on that site count, and errors never mention other
 * tabs: a run must not learn which other sites are open, or their addresses by guessing at --url.
 */
export function selectTab(tabs, focusedWindowId, args = {}) {
  const scope = args.scope || null;
  if (scope) tabs = tabs.filter((x) => urlInScope(x.url || x.pendingUrl || '', scope));
  const on = scope ? ` on ${scope}` : '';
  if (args.tab !== undefined && args.tab !== null && args.tab !== '') {
    const id = Number(args.tab);
    const t = tabs.find((x) => x.id === id);
    if (!t) throw new Error(`no tab${on} with id ${args.tab} (run \`trif tabs\` to list tabs)`);
    return t;
  }
  if (args.url !== undefined && args.url !== null && args.url !== '') {
    const match = urlMatcher(args.url);
    const t = tabs.find((x) => x.windowId === focusedWindowId && match(x.url)) || tabs.find((x) => match(x.url));
    if (!t) throw new Error(`no tab${on} whose URL matches ${args.url} (run \`trif tabs\` to list tabs)`);
    return t;
  }
  // A run works on its site's tab even when the user has moved to another one.
  const t = tabs.find((x) => x.active && x.windowId === focusedWindowId) || tabs.find((x) => x.active) || (scope ? tabs[0] : null);
  if (!t) throw new Error(scope ? `no tab is open on ${scope} (open one with \`trif open\`)` : 'no active tab (is a Chrome window open?)');
  return t;
}

/**
 * The last-focused normal window, or null. Firefox deprecates getLastFocused's `windowTypes` (it logs a
 * warning on every call, and the panel asks for status every few seconds), so there the window's type
 * is checked instead.
 */
export async function lastFocusedNormalWindow(chromeApi, firefox = FIREFOX) {
  const win = await chromeApi.windows.getLastFocused(firefox ? {} : { windowTypes: ['normal'] }).catch(() => null);
  return win && (!win.type || win.type === 'normal') ? win : null;
}

/** Resolve a tab selector using chrome.windows/chrome.tabs. */
export async function resolveTab(chromeApi, args = {}) {
  const [tabs, win] = await Promise.all([
    chromeApi.tabs.query({ windowType: 'normal' }),
    lastFocusedNormalWindow(chromeApi),
  ]);
  tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  return selectTab(tabs, win?.id, args);
}

export function tabInfo(t) {
  return { id: t.id, windowId: t.windowId, active: !!t.active, url: t.url ?? t.pendingUrl ?? '', title: t.title ?? '' };
}

/** Add https:// when the URL has no scheme ("example.com/x" → "https://example.com/x"). */
export function normalizeUrl(to) {
  const s = String(to ?? '').trim();
  if (!s) throw new Error('missing URL');
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
}

/** "https://www.x.com/home" → "www.x.com"; "X.com" → "x.com". */
export function normalizeSite(site) {
  let s = String(site ?? '').trim().toLowerCase();
  if (!s) throw new Error('missing site');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '');
  if (!s) throw new Error(`invalid site ${site}`);
  return s;
}

export function hostMatchesSite(hostname, site) {
  const h = String(hostname || '').toLowerCase();
  return h === site || h.endsWith('.' + site);
}

/** True when the mod was made from another browser's side panel (its origin isn't this install). */
export function fromOtherBrowser(mod, installId) {
  return !!(installId && mod?.origin && typeof mod.origin.by === 'string' && mod.origin.by && mod.origin.by !== installId);
}

/**
 * Mods the helper marks `startOff` (preinstalled by setup), and mods made from another browser's side
 * panel, are switched off the first time the extension sees them; `startedOff` remembers that, so after
 * it the switch is the user's. Pure: returns {disabled, startedOff, changed} with new objects when
 * something changed.
 */
export function applyStartOff(mods, disabled = {}, startedOff = {}, installId = null) {
  const fresh = (mods || []).filter((m) => (m?.startOff || fromOtherBrowser(m, installId)) && typeof m.id === 'string' && startedOff[m.id] !== true);
  if (!fresh.length) return { disabled, startedOff, changed: false };
  const d = { ...disabled };
  const s = { ...startedOff };
  for (const m of fresh) { d[m.id] = true; s[m.id] = true; }
  return { disabled: d, startedOff: s, changed: true };
}

/**
 * Shipped mods folded into another one (helper/lib/preinstalled.js retireShippedMods): the helper sends
 * the ids whose old copy went to the trash as that mod's `absorbs`. The first time this browser sees each
 * one, the mod it went into takes over its switch: on if either was on (and on a site, on there if either
 * was). `absorbed` remembers that, so after it the switch is the user's. One that's back in the mods
 * (restored from the trash) is only remembered: the two keep their own switches. Pure: returns
 * {disabled, offSites, absorbed, changed} with new objects when something changed.
 */
export function applyAbsorbed(mods, disabled = {}, offSites = {}, absorbed = {}) {
  const present = new Set((mods || []).map((m) => m?.id));
  let d = disabled;
  let o = offSites;
  let a = absorbed;
  let changed = false;
  for (const m of mods || []) {
    if (typeof m?.id !== 'string' || !Array.isArray(m.absorbs)) continue;
    for (const old of m.absorbs) {
      if (typeof old !== 'string' || a[old] === true) continue;
      if (!changed) { d = { ...disabled }; o = { ...offSites }; a = { ...absorbed }; changed = true; }
      a[old] = true;
      if (present.has(old)) continue;
      const was = { disabled: d[old] === true, offSites: o[old] || [] };
      const mine = { disabled: d[m.id] === true, offSites: o[m.id] || [] };
      const next = was.disabled ? mine // the old one was off: as it was
        : mine.disabled ? was // only the old one was on: on, where it was
          : { disabled: false, offSites: mine.offSites.filter((s) => was.offSites.includes(s)) }; // both: on wherever either was
      if (next.disabled) d[m.id] = true; else delete d[m.id];
      if (next.offSites.length) o[m.id] = next.offSites; else delete o[m.id];
    }
  }
  return { disabled: d, offSites: o, absorbed: a, changed };
}

/**
 * Mods renamed on disk since the last `mods` message. A mod's id is its site folder and file name, so a
 * renamed file arrives as a new id while the old one is gone; when the code is the same, in the same site
 * folder, it's the same mod. Returns [{from, to}] (each old id paired once, in order).
 */
export function findRenames(prev, next) {
  const before = new Set((prev || []).map((m) => m?.id));
  const now = new Set((next || []).map((m) => m?.id));
  const gone = (prev || []).filter((m) => typeof m?.id === 'string' && typeof m.code === 'string' && !now.has(m.id));
  const out = [];
  for (const m of next || []) {
    if (!gone.length) break;
    if (typeof m?.id !== 'string' || typeof m.code !== 'string' || before.has(m.id)) continue;
    const i = gone.findIndex((g) => g.site === m.site && g.code === m.code);
    if (i === -1) continue;
    out.push({ from: gone[i].id, to: m.id });
    gone.splice(i, 1);
  }
  return out;
}

/**
 * A renamed mod keeps its switches: its `disabled` and `offSites` entries move to the new id, and the new
 * id counts as already seen (`startedOff`), so it isn't switched off again as if it were new. Pure: returns
 * {disabled, offSites, startedOff, changed} with new objects when something changed.
 */
export function carryRenames(renames, { disabled = {}, offSites = {}, startedOff = {} } = {}) {
  if (!renames?.length) return { disabled, offSites, startedOff, changed: false };
  const d = { ...disabled };
  const o = { ...offSites };
  const s = { ...startedOff };
  const was = renames.map(({ from }) => ({ disabled: d[from] === true, offSites: o[from] }));
  for (const { from } of renames) { delete d[from]; delete o[from]; }
  renames.forEach(({ to }, i) => {
    if (was[i].disabled) d[to] = true; else delete d[to];
    if (was[i].offSites?.length) o[to] = was[i].offSites; else delete o[to];
    s[to] = true;
  });
  return { disabled: d, offSites: o, startedOff: s, changed: true };
}

// ---- mod order in the side panel --------------------------------------------------------------------
// The user can drag the panel's mods into the order they like, per site: chrome.storage.local `modOrder` =
// {"<site>": ["<mod id>", …]} (the site as scopeFor gives it). Display only: mods run in the order they
// always do. Mods not in a site's list (new ones) come after the listed ones, in the order they came in;
// ids in the list that aren't mods any more are skipped (one brought back from the trash takes its old
// place), and dropped the next time the order is saved.

/** `modOrder` from storage, cleaned up: lists of ids, no duplicates, no empty lists. */
export function normalizeModOrder(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [site, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue;
      const ids = [...new Set(list.filter((x) => typeof x === 'string' && x))];
      if (ids.length) out[site] = ids;
    }
  }
  return out;
}

/** `mods` in the saved order `ids` (mod ids, or nothing): the listed ones first, then the rest as they came. */
export function orderMods(mods, ids) {
  const list = Array.isArray(mods) ? mods : [];
  if (!Array.isArray(ids) || !ids.length) return list.slice();
  const rank = new Map(ids.map((id, i) => [id, i]));
  return list
    .map((m, i) => ({ m, i, r: rank.has(m?.id) ? rank.get(m.id) : Infinity }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.m);
}

/** `ids` with `id` moved to position `to` (clamped to the list); the same array when it isn't there or doesn't move. */
export function moveId(ids, id, to) {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const at = Math.max(0, Math.min(ids.length - 1, Math.trunc(Number(to) || 0)));
  if (at === from) return ids;
  const out = ids.slice();
  out.splice(from, 1);
  out.splice(at, 0, id);
  return out;
}

/**
 * `modOrder` with `site`'s order set to `ids`. When that's the order the mods come in anyway (`natural`),
 * the site's entry goes instead, so new mods keep coming in where they would. Returns a new object.
 */
export function setModOrder(modOrder, site, ids, natural = []) {
  const out = normalizeModOrder(modOrder);
  const same = ids.length === natural.length && ids.every((id, i) => id === natural[i]);
  if (same || !ids.length) delete out[site];
  else out[site] = [...new Set(ids)];
  return out;
}

/** `modOrder` with renamed mods (findRenames) in their old places. Returns {modOrder, changed}. */
export function renameInOrder(modOrder, renames) {
  const order = normalizeModOrder(modOrder);
  const to = new Map((renames || []).map((r) => [r.from, r.to]));
  let changed = false;
  for (const [site, ids] of Object.entries(order)) {
    if (!ids.some((id) => to.has(id))) continue;
    order[site] = [...new Set(ids.map((id) => to.get(id) || id))];
    changed = true;
  }
  return { modOrder: order, changed };
}

// ---- run scope ----------------------------------------------------------------------------------
// Requests from a side-panel agent run carry args.scope, a registrable domain set by the helper
// (helper/lib/scope.js, which these mirror): they may only touch tabs and URLs on that site.

/** "x.com" is in scope "x.com", and so is "api.x.com"; "notx.com" isn't. */
export function hostInScope(hostname, scope) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return !!scope && (h === scope || h.endsWith('.' + scope));
}

export function urlInScope(url, scope) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && hostInScope(u.hostname, scope);
}

// Whether a match pattern only matches pages in `scope` (not <all_urls>, any-host patterns, file://…).
export function patternInScope(pattern, scope) {
  const m = /^(\*|https?):\/\/([^/]*)\//i.exec(String(pattern ?? '').trim());
  if (!m) return false;
  let host = m[2].replace(/:(\*|\d+)$/, '').toLowerCase().replace(/\.$/, '');
  if (host.startsWith('*.')) host = host.slice(2);
  if (!host || host.includes('*')) return false;
  return hostInScope(host, scope);
}

export function modInScope(mod, scope) {
  const matches = Array.isArray(mod?.matches) ? mod.matches : [];
  return matches.length > 0 && matches.every((p) => patternInScope(p, scope));
}

// ---- sites TRIF is on for -------------------------------------------------------------------
// TRIF is off on every site until the user turns it on from the side panel there. On a site that's
// off nothing from TRIF runs (no mods, not even all-sites ones, no runtime) and no page command
// reaches its tabs, from a side-panel chat or a terminal. chrome.storage.local `sitesOn` is a sorted
// list of registrable domains ("x.com", "bbc.co.uk"), each covering its subdomains.

// Mirrors helper/lib/scope.js (a test keeps them in step).
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'com.br', 'com.mx', 'co.in', 'co.za', 'com.cn',
  'com.tw', 'com.hk', 'co.kr', 'com.sg', 'com.tr', 'com.ar', 'co.il', 'com.my', 'co.id', 'com.ph',
]);
const SHARED_SUFFIXES = new Set([
  'github.io', 'githubusercontent.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'blogspot.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'glitch.me',
  'substack.com', 'tumblr.com', 'wordpress.com', 'neocities.org', 'fly.dev', 'onrender.com',
]);

/** The registrable domain for a host or site name: "www.news.bbc.co.uk" -> "bbc.co.uk", "x.com" -> "x.com". */
export function scopeFor(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if (!h || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  const keep = MULTI_SUFFIXES.has(last2) || SHARED_SUFFIXES.has(last2) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** chrome.storage.local `sitesOn`, cleaned up: unique registrable domains, sorted. */
export function normalizeSitesOn(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((x) => typeof x === 'string').map(scopeFor).filter(Boolean))].sort();
}

/** The site in `sitesOn` that covers `url`'s host (http/https only), or null: TRIF is off there. */
export function siteOnFor(url, sitesOn) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return (sitesOn || []).find((s) => hostInScope(u.hostname, s)) || null;
}

/**
 * Sites to turn on for someone who used TRIF before sites had to be turned on: those of their mods
 * that are switched on (not all-sites ones, which name no site) and those they've chatted on.
 * `chats` maps site -> stored chat.
 */
export function sitesInUse(mods, disabled, chats) {
  const sites = [];
  for (const m of mods || []) {
    const site = String(m?.id || '').split('/')[0];
    if (site && site !== 'all-sites' && disabled?.[m.id] !== true && !m.held) sites.push(site);
  }
  for (const [site, chat] of Object.entries(chats || {})) if (chat?.messages?.length) sites.push(site);
  return normalizeSitesOn(sites);
}

/**
 * Sites setup said to start on (the helper's mods message `sitesOn`), applied once per browser: each
 * one not in `offered` is turned on and joins `offered`, so a site the user later turns off stays off.
 * Returns {sitesOn, offered, changed}.
 */
export function applyStartSites(sitesOn, offered, start) {
  const on = new Set(sitesOn || []);
  const seen = new Set(offered || []);
  let changed = false;
  for (const site of normalizeSitesOn(start)) {
    if (seen.has(site)) continue;
    seen.add(site);
    on.add(site);
    changed = true;
  }
  return { sitesOn: [...on].sort(), offered: [...seen].sort(), changed };
}

/**
 * The mod limited to the sites in `sitesOn`: each @match narrowed to those sites (any-host patterns and
 * <all_urls> become one pair per site; patterns for other sites go), or null when nothing is left. The
 * sites used go into its hash, so it re-registers when they change. file:// patterns go too.
 */
export function limitToSites(mod, sitesOn) {
  const out = new Set();
  const used = new Set();
  for (const raw of Array.isArray(mod?.matches) ? mod.matches : []) {
    const p = String(raw).trim();
    const m = p === '<all_urls>' ? ['', '*', '*', '/*'] : /^(\*|https?|wss?|ftp):\/\/([^/]*)(\/.*)$/i.exec(p);
    if (!m) continue;
    const [, scheme, hostPart, path] = m;
    const port = /(:(\*|\d+))$/.exec(hostPart)?.[1] || '';
    const host = hostPart.slice(0, hostPart.length - port.length).toLowerCase();
    const add = (s) => { used.add(s); out.add(`${scheme}://${s}${port}${path}`); out.add(`${scheme}://*.${s}${port}${path}`); };
    if (host === '*') { (sitesOn || []).forEach(add); continue; }
    const wild = host.startsWith('*.');
    const base = wild ? host.slice(2) : host;
    const covering = (sitesOn || []).find((s) => hostInScope(base, s));
    if (covering) { used.add(covering); out.add(p); continue; }
    // "*.co.uk" with bbc.co.uk on: just bbc.co.uk. (An exact host never covers another site.)
    if (wild) for (const s of sitesOn || []) if (hostInScope(s, base)) add(s);
  }
  if (!out.size) return null;
  const tag = [...used].sort().join(',');
  return { ...mod, matches: [...out].sort(), hash: mod.hash ? `${mod.hash}|sites:${tag}` : mod.hash };
}

/** The side panel's "site" for a tab URL: hostname without a leading "www.", or null for pages mods can't run on. */
export function siteForUrl(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  return host.startsWith('www.') && host.length > 4 ? host.slice(4) : host;
}

// ---- match patterns -----------------------------------------------------------------------------

const ALL_URLS_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'ws', 'wss']);
const DEFAULT_PORTS = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };

/**
 * Chrome match pattern test (https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns):
 * `<all_urls>`, or `scheme://host/path` where scheme is `*` (http or https) or a concrete scheme;
 * host is `*`, `*.example.com` (the domain and its subdomains) or exact, optionally with `:port`
 * (no port = any port); path is a glob (`*` = any run of characters) matched against path + query.
 * Invalid patterns and unparsable URLs never match. Pure: used by the side panel and the tests.
 */
export function matchesPattern(pattern, url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return false; }
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  const p = String(pattern ?? '').trim();
  if (p === '<all_urls>') return ALL_URLS_SCHEMES.has(scheme);
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(p);
  if (!m) return false;
  const [, pScheme, pHostPort, pPath] = m;
  if (pScheme === '*') { if (scheme !== 'http' && scheme !== 'https') return false; }
  else if (pScheme.toLowerCase() !== scheme) return false;

  if (scheme === 'file') {
    if (pHostPort !== '' && pHostPort !== '*') return false;
  } else {
    const hp = /^(\*|(?:\*\.)?[^*:/[\]]+|\[[0-9a-f:.]+\])(?::(\*|\d+))?$/i.exec(pHostPort);
    if (!hp) return false;
    const pHost = hp[1].toLowerCase().replace(/\.$/, '');
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (pHost !== '*') {
      if (pHost.startsWith('*.')) {
        const base = pHost.slice(2);
        if (host !== base && !host.endsWith('.' + base)) return false;
      } else if (host !== pHost) return false;
    }
    if (hp[2] !== undefined && hp[2] !== '*' && (u.port || DEFAULT_PORTS[scheme] || '') !== hp[2]) return false;
  }
  return globMatch(pPath, u.pathname + u.search);
}

/** `*` matches any run of characters (including none); everything else is literal. */
export function globMatch(glob, s) {
  const parts = String(glob).split('*');
  if (parts.length === 1) return s === glob;
  if (!s.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length - 1; i++) {
    const at = s.indexOf(parts[i], pos);
    if (at < 0) return false;
    pos = at + parts[i].length;
  }
  const last = parts[parts.length - 1];
  return s.length - pos >= last.length && s.endsWith(last);
}

/** True when a mod ({matches, excludes}) would run on `url`. */
export function modAppliesTo(mod, url) {
  const matches = Array.isArray(mod?.matches) ? mod.matches : [];
  const excludes = Array.isArray(mod?.excludes) ? mod.excludes : [];
  return matches.some((p) => matchesPattern(p, url)) && !excludes.some((p) => matchesPattern(p, url));
}

/** One compact line for a tool event: "ran trif reload --tab 12", "edited sites/x.com/a.js". */
export function toolLine(name, summary) {
  const n = String(name ?? '').trim();
  const s = String(summary ?? '').replace(/\s+/g, ' ').trim();
  const verb = { Bash: 'ran', Edit: 'edited', MultiEdit: 'edited', Write: 'wrote', Read: 'read', Glob: 'searched', Grep: 'searched' }[n];
  if (verb) return s ? `${verb} ${s}` : verb;
  return s ? `${n || 'tool'} ${s}` : (n || 'tool');
}

// A chat lives in chrome.storage.local (chat:<site>). Agents can reply at length, or an error can carry
// a whole page, so each message's text and each chat's total size are capped.
export const CHAT_MAX = 500;               // messages kept per site
export const CHAT_TEXT_MAX = 20000;        // characters kept of one message
export const CHAT_BYTES_MAX = 1024 * 1024; // about how much one chat may take (oldest messages go first)

/** Caps a chat's messages in place (see above); returns the chat. */
export function capChat(chat) {
  let messages = Array.isArray(chat.messages) ? chat.messages : [];
  if (messages.length > CHAT_MAX) messages = messages.slice(-CHAT_MAX);
  messages = messages.map((m) => {
    if (typeof m?.text !== 'string' || m.text.length <= CHAT_TEXT_MAX) return m;
    return { ...m, text: `${m.text.slice(0, CHAT_TEXT_MAX)}\n\n[… shortened: ${m.text.length - CHAT_TEXT_MAX} more characters not kept]` };
  });
  // Sizes as stored, roughly (JSON text; non-ASCII may take more bytes, which the slack covers).
  const sizes = messages.map((m) => JSON.stringify(m).length + 1);
  let total = sizes.reduce((a, b) => a + b, 0);
  let drop = 0;
  while (total > CHAT_BYTES_MAX && drop < messages.length - 1) total -= sizes[drop++];
  chat.messages = drop ? messages.slice(drop) : messages;
  return chat;
}

/** Hosts whose sign-in pages the side panel may open for an agent login (and their subdomains). */
export const LOGIN_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com'];

/**
 * Whether the URL from a `login` event may be opened in a tab: https, default port, no credentials,
 * host one of LOGIN_HOSTS or a subdomain. Anything else is refused (the helper relays what the agent
 * CLI printed, so don't trust it blindly).
 */
export function isLoginUrl(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return LOGIN_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// ---- run ----------------------------------------------------------------------------------------

/**
 * Code for chrome.userScripts.execute. It evaluates to a Promise of a JSON envelope string
 * ({ok, json} or {ok:false, error}); the envelope is also stored in window.__webmods_runs[runId]
 * for 60 s so the background can poll for it if execute doesn't wait for the promise.
 */
/**
 * Why a page command may not act on this document (null when it may): not http(s), outside the run's
 * `scope`, or on a site TRIF is off for (`sitesOn`). Injected into the page and run there (so it checks the
 * document the command really meets: the tab may have gone elsewhere between the extension's check and the
 * injection), hence self-contained. With a `token` (isolated world), marks the document when it may, so the
 * extension can tell afterwards that the command ran in this same document (background.js pageCall).
 */
export function pageGuard(scope, sitesOn, token) {
  let u;
  try { u = new URL(String(location.href)); } catch (e) { return 'the tab is not on a web page any more'; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const inside = (x) => !!x && (host === x || host.endsWith('.' + x));
  let why = null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') why = 'the tab went to a page that isn\'t http or https before TRIF reached it';
  else if (scope && !inside(scope)) why = `the tab went to ${host} before TRIF reached it, and this agent run is limited to ${scope}`;
  else if (!(sitesOn || []).some(inside)) why = `the tab went to ${host} before TRIF reached it, and TRIF is off there`;
  if (!why && token) window.__trifPageGuard = token;
  return why;
}

export function buildRunCode(code, expression, runId, guard = null) {
  const body = expression ? `return (${code}\n);` : `${code}\n`;
  // guard {scope, sitesOn}: checked against the document the code meets, before it runs.
  const check = guard
    ? `{ const __wmWhy = (${pageGuard.toString()})(${JSON.stringify(guard.scope || null)}, ${JSON.stringify(guard.sitesOn || [])}, null); if (__wmWhy) return JSON.stringify({ ok: false, error: __wmWhy }); }\n`
    : '';
  return `(async () => {
${check}const __wmStringify = (${safeStringify.toString()});
const __wmFormatError = (${formatError.toString()});
let __wmOut;
try {
  const __wmValue = await (async () => {
${body}
  })();
  __wmOut = JSON.stringify({ ok: true, json: __wmStringify(__wmValue, ${RUN_CAP}) });
} catch (__wmErr) {
  let msg; try { msg = __wmFormatError(__wmErr); } catch (x) { msg = 'error'; }
  __wmOut = JSON.stringify({ ok: false, error: msg });
}
try {
  const runs = window.__webmods_runs || (window.__webmods_runs = {});
  runs[${JSON.stringify(runId)}] = __wmOut;
  setTimeout(() => { try { delete runs[${JSON.stringify(runId)}]; } catch (x) {} }, 60000);
} catch (x) {}
return __wmOut;
})()`;
}

/** Code that reads (and removes) a stored run envelope; evaluates to the string or null. */
export function buildPollCode(runId) {
  const k = JSON.stringify(runId);
  return `(() => { try { const r = window.__webmods_runs; if (r && typeof r[${k}] === 'string') { const v = r[${k}]; delete r[${k}]; return v; } } catch (e) {} return null; })()`;
}

/** Turn an envelope string into {value}, or throw the page's error. */
export function parseRunEnvelope(str) {
  const env = JSON.parse(str);
  if (!env.ok) throw new Error(env.error || 'error');
  return { value: JSON.parse(env.json) };
}

/** First injection result of chrome.userScripts.execute: envelope string, null (not ready), or throws. */
export function firstInjectionResult(results) {
  const r = Array.isArray(results) ? results[0] : undefined;
  if (!r) throw new Error('the script was not injected (the tab may be closed or showing a page extensions cannot access)');
  if (r.error) throw new Error(String(r.error));
  return typeof r.result === 'string' ? r.result : null;
}

// One chrome.userScripts call that never settles (seen in Firefox) would hold up every queued mod sync and
// switch behind it, so each call gets a time limit; the error names the call.
export const USER_SCRIPTS_TIMEOUT_MS = 10000;
export function timedUserScripts(api, ms = USER_SCRIPTS_TIMEOUT_MS) {
  const wrap = (name) => (...args) =>
    withTimeout(Promise.resolve().then(() => api[name](...args)), ms, `userScripts.${name} didn't answer within ${ms / 1000}s`);
  return { register: wrap('register'), update: wrap('update'), unregister: wrap('unregister'), getScripts: wrap('getScripts') };
}

export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ---- recorder results ---------------------------------------------------------------------------

/** Filter/limit recorder entries (already light: no bodies) for the `requests` command. */
export function filterRequests(entries, { filter, limit } = {}) {
  let list = Array.isArray(entries) ? entries : [];
  if (filter !== undefined && filter !== null && filter !== '') {
    let re;
    try { re = new RegExp(String(filter)); } catch (e) { throw new Error(`invalid filter regex: ${e.message}`); }
    list = list.filter((e) => re.test(e.url));
  }
  const n = limit === undefined || limit === null || limit === '' ? 50 : Number(limit);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid limit ${limit}`);
  return n === 0 ? [] : list.slice(-n);
}

/** Exponential reconnect delay: 1 s, 2 s, 4 s … capped at 30 s. */
export function nextBackoff(prev) {
  return prev ? Math.min(prev * 2, 30000) : 1000;
}

export function chromeVersion(userAgent) {
  const m = /(?:Chrom(?:e|ium)|Firefox)\/([\d.]+)/.exec(userAgent || '')
    || /Version\/([\d.]+)(?: Mobile\/\S+)? Safari\//.exec(userAgent || ''); // Safari's own version
  return m ? m[1] : 'unknown';
}

// Where a mod runs, for display: `everywhere` when a pattern covers any host (<all_urls>, `*://*/*`),
// and `sites`, the hosts its other patterns name, without "www." or "*.", subdomains of a listed
// site folded into it (x.com and mobile.x.com: x.com), in pattern order. Excludes are ignored.
export function modSites(mod) {
  const hosts = [];
  let everywhere = false;
  for (const p of Array.isArray(mod?.matches) ? mod.matches : []) {
    const s = String(p).trim();
    if (s === '<all_urls>') { everywhere = true; continue; }
    const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)\//i.exec(s);
    if (!m || m[1].toLowerCase() === 'file') continue;
    let host = m[2].replace(/:(\*|\d+)$/, '').toLowerCase().replace(/\.$/, '');
    if (host === '*') { everywhere = true; continue; }
    if (host.startsWith('*.')) host = host.slice(2);
    if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
    if (host && !host.includes('*') && !hosts.includes(host)) hosts.push(host);
  }
  const sites = hosts.filter((h) => !hosts.some((o) => o !== h && h.endsWith('.' + o)));
  return { everywhere, sites };
}

// ---- per-site switches --------------------------------------------------------------------------
// A mod that runs on several sites can be off on some of them: chrome.storage.local `offSites`
// ({"<mod id>": ["twitter.com", …]}, sites as siteForUrl gives them). A site covers its subdomains.
// Registration adds them to the mod's excludes, so Chrome skips those sites.

/** Whether the mod runs on more than one site (the side panel's switch is then per site). */
export function isMultiSite(mod) {
  const { everywhere, sites } = modSites(mod);
  return everywhere || sites.length > 1;
}

/** A switched-off site as stored: lowercase hostname without a trailing dot, "www." or port; null if it isn't one. */
export function offSiteName(site) {
  let h = String(site ?? '').trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) { try { h = new URL(h).hostname; } catch { return null; } }
  h = h.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (h.startsWith('www.') && h.length > 4) h = h.slice(4);
  return /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*)$/.test(h) ? h : null;
}

/** `offSites` from storage, cleaned up: valid sites only, no duplicates, no empty lists. */
export function normalizeOffSites(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [id, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue;
      const sites = [...new Set(list.filter((x) => typeof x === 'string').map(offSiteName).filter(Boolean))];
      if (sites.length) out[id] = sites;
    }
  }
  return out;
}

/** Whether `site` is switched off for mod `id` (an entry for it or a parent domain). */
export function offOnSite(offSites, id, site) {
  const s = offSiteName(site);
  return !!s && (offSites?.[id] || []).some((o) => hostInScope(s, o));
}

/** Exclude patterns for a switched-off site and its subdomains (IPs: just the address). */
export function siteExcludes(site) {
  return /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(site) ? [`*://${site}/*`] : [`*://${site}/*`, `*://*.${site}/*`];
}

/** The mod as registered: its switched-off sites added to its excludes (and to its hash, so it re-registers). */
export function withOffSites(mod, sites) {
  if (!sites || !sites.length) return mod;
  const excludes = [...(Array.isArray(mod.excludes) ? mod.excludes : []), ...sites.flatMap(siteExcludes)];
  return { ...mod, excludes, hash: mod.hash ? `${mod.hash}|off:${sites.join(',')}` : mod.hash };
}

/**
 * The switch state after switching mod `mod` on or off on `site`: {disabled, offSites} for that mod,
 * from its current `disabled` (whole mod off) and `offSites` list.
 * - Off on a site: the site joins the list. Once every site the mod names is off, the whole mod is
 *   off instead (and the list is cleared), so its main switch shows off.
 * - On on a site: entries for it, its parent domains and its subdomains go. If the whole mod was off,
 *   it comes on there only: on its other named sites it's off (a mod for every site comes on
 *   everywhere but the sites still in its list).
 */
export function switchSite(mod, { disabled, offSites = [] }, site, enabled) {
  const s = offSiteName(site);
  if (!s) throw new Error(`"${site}" isn't a site (use a hostname like twitter.com)`);
  const related = (o) => hostInScope(s, o) || hostInScope(o, s);
  const { everywhere, sites } = modSites(mod);
  if (enabled) {
    let list = offSites.filter((o) => !related(o));
    if (disabled && !everywhere) list = [...new Set([...list, ...sites.filter((o) => !related(o))])];
    return { disabled: false, offSites: list };
  }
  if (disabled) return { disabled: true, offSites };
  const list = offSites.some((o) => hostInScope(s, o)) ? offSites : [...offSites, s];
  if (!everywhere && sites.length && sites.every((o) => list.some((x) => hostInScope(o, x)))) return { disabled: true, offSites: [] };
  return { disabled: false, offSites: list };
}

// ---- agent and model per site chat -----------------------------------------------------------------
// Each site's chat (the panel showing that site) has its own agent and model: Claude Code with Opus on
// one site, Codex on another, at the same time. chrome.storage.local `sitePicks` = {<site>: {agent,
// models: {<agent id>: model}}} (the same shape as `settings`); `settings` is the default for sites
// without a pick, and is set to the last pick made anywhere, so a new site starts with what the user last
// chose. A panel showing a site without a pick holds on to the default it first saw for that site (its
// `snapshots`), so a pick made in another panel doesn't change it; the site's pick is written when the user
// changes it there, or when a run starts there.

/** Agent settings from storage: {agent, models}. Before per-agent models there was one `model` (Claude Code's). */
export function normalizeSettings(s) {
  const out = { agent: '', models: {}, ...(s && typeof s === 'object' && !Array.isArray(s) ? s : {}) };
  if (typeof out.agent !== 'string') out.agent = '';
  if (!out.models || typeof out.models !== 'object' || Array.isArray(out.models)) out.models = {};
  if (typeof out.model === 'string' && out.model && !Object.keys(out.models).length) out.models = { claude: out.model };
  delete out.model;
  return out;
}

/** `sitePicks` from storage, cleaned up. */
export function normalizePicks(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [site, s] of Object.entries(value)) if (site && s && typeof s === 'object') out[site] = normalizeSettings(s);
  }
  return out;
}

/**
 * {settings, picks} without any model pick for `agentId` (the default's and every site's); `snapshots`
 * (siteSettings) lose it too, in place. Used when the open model's provider changes: its model picks name
 * the old provider's models.
 */
export function withoutModel({ settings, picks, snapshots }, agentId) {
  const strip = (s) => {
    const n = normalizeSettings(s);
    const { [agentId]: _gone, ...models } = n.models;
    return { ...n, models };
  };
  const outPicks = {};
  for (const [site, s] of Object.entries(picks || {})) outPicks[site] = strip(s);
  if (snapshots) for (const [site, s] of snapshots) snapshots.set(site, strip(s));
  return { settings: strip(settings), picks: outPicks };
}

/**
 * The agent settings for `site`'s chat: its pick, else the default this panel first saw for it (kept in
 * `snapshots`, a Map the panel owns), else `global` (no site: the global settings themselves).
 */
export function siteSettings({ picks, snapshots, global, site }) {
  if (!site) return normalizeSettings(global);
  if (picks[site]) return picks[site];
  if (!snapshots.has(site)) snapshots.set(site, normalizeSettings(JSON.parse(JSON.stringify(global || {}))));
  return snapshots.get(site);
}
