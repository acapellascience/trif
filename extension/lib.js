// Logic shared by background.js and the tests. Nothing here touches `chrome` at import time; the
// functions that need Chrome APIs take them as parameters.

import { safeStringify, formatError } from './runtime.js';

// The running extension's own id: the Web Store build has a different one from the unpacked dev build
// (whose manifest key fixes it to this fallback, also used under Node in the tests).
export const EXTENSION_ID = globalThis.chrome?.runtime?.id || 'iaablflfafmonebdomeikadolkgdbkhe';
export const SETTINGS_URL = `chrome://extensions/?id=${EXTENSION_ID}`;
// PROTOCOL.md calls this `__webmods_runtime`, but chrome.userScripts rejects ids starting with "_"
// (reserved for generated ids), so it is registered under this id.
export const RUNTIME_ID = 'webmods-runtime';
export const USER_SCRIPTS_OFF =
  `User scripts are off for WebMods. Open ${SETTINGS_URL} and turn on "Allow User Scripts", then reload the page.`;
export const RUN_CAP = 1000000;

// ---- user scripts -------------------------------------------------------------------------------

/** True when chrome.userScripts can be used (the "Allow User Scripts" switch is on). */
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
} catch (e) { window.__webmods?.errors.push({mod: __mod, message: String(e?.message ?? e), stack: String(e?.stack ?? ""), time: Date.now()}); console.error("[webmods]", __mod, e); }
})();
//# sourceURL=webmods://${id}.js`;
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
 * page: the runtime's globals (window.webmods, window.__webmods) would let any site detect WebMods users.
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
 * neither, nothing is registered at all.
 * Returns {registered, errors, applied, reset}.
 */
export async function syncUserScripts(us, { mods, runtimeCode, applied = {}, disabled = {}, offSites = {}, recording = [] }) {
  const errors = [];
  const desired = [];
  const seen = new Set();
  for (const mod of mods || []) {
    if (!mod || typeof mod.id !== 'string' || !mod.id) { errors.push({ id: String(mod?.id ?? ''), error: 'mod has no id' }); continue; }
    if (mod.id === RUNTIME_ID || seen.has(mod.id)) { errors.push({ id: mod.id, error: 'duplicate or reserved mod id' }); continue; }
    if (disabled[mod.id] === true) continue; // switched off: not desired, so unregistered below if registered
    if (mod.held) continue; // held for the user's approval (an agent wrote it for another site): same
    seen.add(mod.id);
    desired.push(withOffSites(mod, offSites[mod.id]));
  }

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

  if (!runtimeOk) {
    if (existing.length) await us.unregister();
    // A mod with an invalid pattern makes the union invalid too; then the runtime goes everywhere
    // (the mod itself fails to register and is reported).
    try { await us.register([runtimeUserScript(runtimeCode, matches)]); } catch { await us.register([runtimeUserScript(runtimeCode)]); }
    next[RUNTIME_ID] = runtimeHash;
    for (const mod of desired) await registerMod(mod, false);
    return { registered, errors, applied: next, reset: true };
  }

  next[RUNTIME_ID] = runtimeHash;
  const stale = existing.map((s) => s.id).filter((id) => id !== RUNTIME_ID && !seen.has(id));
  if (stale.length) await us.unregister({ ids: stale });
  for (const mod of desired) {
    if (!existingIds.has(mod.id)) await registerMod(mod, false);
    else if (mod.hash && applied[mod.id] === mod.hash) { next[mod.id] = mod.hash; registered.push(mod.id); }
    else await registerMod(mod, true);
  }
  return { registered, errors, applied: next, reset: false };
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
 */
export function selectTab(tabs, focusedWindowId, args = {}) {
  if (args.tab !== undefined && args.tab !== null && args.tab !== '') {
    const id = Number(args.tab);
    const t = tabs.find((x) => x.id === id);
    if (!t) throw new Error(`no tab with id ${args.tab} (run \`webmods tabs\` to list tabs)`);
    return t;
  }
  if (args.url !== undefined && args.url !== null && args.url !== '') {
    const match = urlMatcher(args.url);
    const t = tabs.find((x) => x.windowId === focusedWindowId && match(x.url)) || tabs.find((x) => match(x.url));
    if (!t) throw new Error(`no tab whose URL matches ${args.url} (run \`webmods tabs\` to list tabs)`);
    return t;
  }
  const t = tabs.find((x) => x.active && x.windowId === focusedWindowId) || tabs.find((x) => x.active);
  if (!t) throw new Error('no active tab (is a Chrome window open?)');
  return t;
}

/** Resolve a tab selector using chrome.windows/chrome.tabs. */
export async function resolveTab(chromeApi, args = {}) {
  const [tabs, win] = await Promise.all([
    chromeApi.tabs.query({ windowType: 'normal' }),
    chromeApi.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null),
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

/**
 * Mods the helper marks `startOff` (preinstalled by setup) are switched off the first time the extension
 * sees them; `startedOff` remembers that, so after it the switch is the user's. Pure: returns
 * {disabled, startedOff, changed} with new objects when something changed.
 */
export function applyStartOff(mods, disabled = {}, startedOff = {}) {
  const fresh = (mods || []).filter((m) => m?.startOff && typeof m.id === 'string' && startedOff[m.id] !== true);
  if (!fresh.length) return { disabled, startedOff, changed: false };
  const d = { ...disabled };
  const s = { ...startedOff };
  for (const m of fresh) { d[m.id] = true; s[m.id] = true; }
  return { disabled: d, startedOff: s, changed: true };
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

/** One compact line for a tool event: "ran webmods reload --tab 12", "edited sites/x.com/a.js". */
export function toolLine(name, summary) {
  const n = String(name ?? '').trim();
  const s = String(summary ?? '').replace(/\s+/g, ' ').trim();
  const verb = { Bash: 'ran', Edit: 'edited', MultiEdit: 'edited', Write: 'wrote', Read: 'read', Glob: 'searched', Grep: 'searched' }[n];
  if (verb) return s ? `${verb} ${s}` : verb;
  return s ? `${n || 'tool'} ${s}` : (n || 'tool');
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
export function buildRunCode(code, expression, runId) {
  const body = expression ? `return (${code}\n);` : `${code}\n`;
  return `(async () => {
const __wmStringify = (${safeStringify.toString()});
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
  const m = /Chrom(?:e|ium)\/([\d.]+)/.exec(userAgent || '');
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
