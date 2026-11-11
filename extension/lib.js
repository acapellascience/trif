// Logic shared by background.js and the tests. Nothing here touches `chrome` at import time; the
// functions that need Chrome APIs take them as parameters.

import { safeStringify, formatError } from './runtime.js';
import { SANDBOX_WORLD, SANDBOX_RUNTIME_ID, SES_FILE, sandboxRuntimeCode, sandboxModCode, sandboxPageCode } from './sandbox.js';
import { sensitiveList, patternMatches } from './agentsites.js';

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
    // Throws when the switch is off. Asked for an id that's never registered: a plain getScripts() hands back
    // every script with all its code, a copy of every mod for each call. This runs for every message from the
    // helper, so a 48 MB set in 49 parts made gigabytes of copies in Firefox's parent process faster than it
    // collected them (7.4 GB, and the Mac ran out of memory).
    const p = chromeApi.userScripts.getScripts({ ids: [PROBE_ID] });
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// (Never registered: see userScriptsAvailable.)
const PROBE_ID = 'trif-probe';

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
  const base = {
    id: mod.id,
    matches: Array.isArray(mod.matches) ? mod.matches : [],
    excludeMatches: Array.isArray(mod.excludes) ? mod.excludes : [],
    runAt: normalizeRunAt(mod.runAt),
    allFrames: false,
  };
  // A sandboxed mod (sandbox.js): in TRIF's own world, its code evaluated by SES in a compartment of its
  // own; or, in a browser without that world and once the user allowed it (sandboxFallback), in the page's
  // world with the same API around it.
  // (a boxed mod's powers, as the helper read them from its header: docs/POWERS.md)
  const powers = { powers: Array.isArray(mod.powers) ? mod.powers : [], args: mod.powerArgs && typeof mod.powerArgs === 'object' ? mod.powerArgs : {} };
  if (inSandboxWorld(mod)) return { ...base, js: [{ code: sandboxModCode(mod.id, String(mod.code ?? ''), powers) }], world: 'USER_SCRIPT', worldId: SANDBOX_WORLD };
  if (mod.sandboxed) return { ...base, js: [{ code: sandboxPageCode(mod.id, String(mod.code ?? ''), powers) }], world: 'MAIN' };
  return { ...base, js: [{ code: wrapModCode(mod.id, String(mod.code ?? '')) }], world: 'MAIN' };
}

/** Whether a mod registers in TRIF's sandbox world: sandboxed, in a browser that has the world. */
export function inSandboxWorld(mod) { return !!(mod && mod.sandboxed && !mod.unsandboxed); }

/** The sandbox world's runtime (sandbox.js): SES, then TRIF's code; where any sandboxed mod runs. */
const SES_STAMP = 'globalThis.__trifT0 = performance.now();'; // (so the runtime can say what loading SES took)
export function sandboxRuntimeScript(matches, excludes = []) {
  return { id: SANDBOX_RUNTIME_ID, matches, excludeMatches: excludes, js: [{ code: SES_STAMP }, { file: SES_FILE }, { code: sandboxRuntimeCode() }], runAt: 'document_start', world: 'USER_SCRIPT', worldId: SANDBOX_WORLD, allFrames: false };
}

// ---- browsers without TRIF's sandbox world ------------------------------------------------------------
// A sandboxed mod in a browser that can't host the world (background.js sandboxWorld: Safari, or a browser
// whose userScripts has no configureWorld with a CSP) isn't silently run unsandboxed: it waits for the
// user's OK, held here in the extension (held.by 'sandbox'; the helper's holds are about what a mod can do,
// and this is about where it can run). Allowed (state `unsandboxedOk`: id -> the hash allowed), it runs as
// a page script with the same API (sandbox.js sandboxPageCode), in the "Page scripts" group (modGroup), as
// that's how it runs. A new version waits again.

/** The text a sandboxed mod's hold shows in a browser without the sandbox. */
export function sandboxHoldReason(browser = BROWSER) {
  return `${browser} can't run boxed mods, so here it would run as a free mod, with everything the page has`;
}

/**
 * The mods as this browser runs them: unchanged where it can sandbox (`canSandbox`); otherwise each sandboxed
 * mod marked `unsandboxed`, and held (by 'sandbox') unless `allowed[id]` is its hash. Idempotent: marks from
 * a run before (with another canSandbox or `allowed`) are taken off first; `hash` is left as the helper sent
 * it (syncUserScripts tells the two ways of registering apart). Pure.
 */
export function sandboxFallback(mods, { canSandbox = true, allowed = {}, browser = BROWSER } = {}) {
  return (mods || []).map((m0) => {
    let m = m0;
    if (m && (m.unsandboxed || (m.held && m.held.by === 'sandbox'))) {
      m = { ...m };
      delete m.unsandboxed;
      if (m.held && m.held.by === 'sandbox') delete m.held;
    }
    if (!m || !m.sandboxed || canSandbox) return m;
    // (held by the helper anyway: its own Allow first)
    if (m.held) return { ...m, unsandboxed: true };
    if (allowed[m.id] && allowed[m.id] === m.hash) return { ...m, unsandboxed: true };
    const facts = [sandboxHoldReason(browser), ...(Array.isArray(m.pageFacts) ? m.pageFacts.map((f) => `as a free mod, it ${f}`) : [])];
    return { ...m, unsandboxed: true, held: { by: 'sandbox', site: modSiteName(m), reason: facts.join('; '), facts, claim: String(m.risk?.why || m.description || '').slice(0, 300), hash: m.hash } };
  });
}

// (the site folder a mod is in: its id's first part)
function modSiteName(m) { return String(m.site || String(m.id || '').split('/')[0] || ''); }

export function runtimeUserScript(code, matches = ['<all_urls>'], excludes = []) {
  return { id: RUNTIME_ID, matches, excludeMatches: excludes, js: [{ code }], runAt: 'document_start', world: 'MAIN', allFrames: false };
}

/**
 * The sensitive sites of their own no registered mod runs on (lib.js "sensitive sites"): the runtimes skip
 * them too (their matches come from mods whose `*.google.com` would otherwise reach mail.google.com).
 * `desired`: the mods as limitToSites made them (`usedSites`), `recording` the sites being recorded.
 */
export function runtimeExcludes(desired, recording, model) {
  if (!model) return [];
  const used = new Set((desired || []).flatMap((m) => m.usedSites || []));
  for (const r of recording || []) used.add(r);
  return model.splits.filter((x) => !used.has(x) && [...used].some((u) => hostInScope(x, u))).flatMap(siteExcludes).sort();
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
 * `known`: the ids registered after the last sync, as it returned them (null: not sure, ask the browser).
 * With them the scripts aren't fetched: getScripts() hands back every script with all its code, a copy of
 * every mod on every sync, which Firefox's parent process can be slow to free (see userScriptsAvailable).
 * Returns {registered, errors, applied, reset, known} (`known` null when a register or update failed, as
 * then it's unclear what's registered).
 */
export async function syncUserScripts(us, { mods, runtimeCode, applied = {}, disabled = {}, offSites = {}, groupsOff = {}, recording = [], sitesOn = null, known = null, sensitive = null }) {
  // sitesOn (null: no limit): mods and recording only on the sites TRIF is on for (limitToSites).
  // `sensitive`: the sensitive sites (sensitiveSites): each of its own, with only its own mods.
  if (sitesOn) recording = (recording || []).filter((site) => (sensitive ? siteOnFor(`https://${site}/`, sitesOn, sensitive) : (sitesOn || []).some((s) => hostInScope(site, s))));
  const errors = [];
  const desired = [];
  const seen = new Set();
  for (const mod of mods || []) {
    if (!mod || typeof mod.id !== 'string' || !mod.id) { errors.push({ id: String(mod?.id ?? ''), error: 'mod has no id' }); continue; }
    if (mod.id === RUNTIME_ID || seen.has(mod.id)) { errors.push({ id: mod.id, error: 'duplicate or reserved mod id' }); continue; }
    if (disabled[mod.id] === true) continue; // switched off: not desired, so unregistered below if registered
    if (mod.held) continue; // held for the user's approval (an agent wrote it for another site): same
    seen.add(mod.id);
    const limited = sitesOn ? limitToSites(mod, sitesOn, sensitive) : mod;
    if (!limited) continue; // only on sites TRIF is off for
    // (its own switched-off sites, and the sites where its group is off: groupsOff)
    const reg = withOffSites(limited, offSitesFor(mod, offSites, groupsOff));
    // (a sandboxed mod run as a page script registers differently: a hash of its own)
    desired.push(reg.sandboxed && reg.unsandboxed ? { ...reg, hash: `${reg.hash ?? ''}:page` } : reg);
  }

  // (Anything registered that isn't wanted goes: a home page marker left by a development build too.)
  // (Known ids carry no code: the runtime is then checked by its hash in `applied`.)
  const existing = Array.isArray(known) ? known.map((id) => ({ id })) : await us.getScripts();
  const existingIds = new Set(existing.map((s) => s.id));
  const matches = runtimeMatches(desired, recording);
  const rtExcludes = runtimeExcludes(desired, recording, sensitive);
  if (!matches.length) {
    if (existing.length) await us.unregister();
    return { registered: [], errors, applied: {}, reset: existing.length > 0, known: [] };
  }
  // The sandbox world's runtime (sandbox.js) goes where a sandboxed mod runs in that world. Its mods queue
  // themselves until it's there, so unlike the page's runtime it needn't be registered before them.
  const sandboxMatches = runtimeMatches(desired.filter(inSandboxWorld), []);
  const sandboxCode = sandboxMatches.length ? sandboxRuntimeCode() : null;
  const sandboxHash = sandboxMatches.length ? quickHash(sandboxCode + '\n' + JSON.stringify(sandboxMatches) + (rtExcludes.length ? JSON.stringify(rtExcludes) : '')) : null;
  const sandboxNow = existing.find((s) => s.id === SANDBOX_RUNTIME_ID);
  let sandboxUp = false; // (the sandbox runtime registered after this sync)
  const syncSandboxRuntime = async (fresh) => {
    const there = !fresh && !!sandboxNow;
    if (!sandboxMatches.length) { if (there) await us.unregister({ ids: [SANDBOX_RUNTIME_ID] }); return; }
    const code = sandboxNow?.js?.[2]?.code;
    const same = there && (code !== undefined ? code === sandboxCode && JSON.stringify([...(sandboxNow.matches || [])].sort()) === JSON.stringify(sandboxMatches) && JSON.stringify([...(sandboxNow.excludeMatches || [])].sort()) === JSON.stringify(rtExcludes) : applied[SANDBOX_RUNTIME_ID] === sandboxHash);
    try {
      if (!same) { if (there) await us.update([sandboxRuntimeScript(sandboxMatches, rtExcludes)]); else await us.register([sandboxRuntimeScript(sandboxMatches, rtExcludes)]); }
      next[SANDBOX_RUNTIME_ID] = sandboxHash;
      sandboxUp = true;
    } catch (e) {
      unsure = true;
      // (its mods would wait for it forever: each says why instead, and isn't registered)
      for (const m of desired.filter(inSandboxWorld)) errors.push({ id: m.id, error: `TRIF's sandbox couldn't be set up: ${errMsg(e)}` });
    }
  };
  const runtimeHash = quickHash(runtimeCode + '\n' + JSON.stringify(matches) + (rtExcludes.length ? JSON.stringify(rtExcludes) : ''));
  const current = existing.find((s) => s.id === RUNTIME_ID);
  const currentCode = current?.js?.[0]?.code;
  const sameMatches = (a) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify(matches);
  // (applied's hash also covers the fallback below, where the registered matches are <all_urls>.)
  const runtimeOk = !!current && (currentCode !== undefined
    ? currentCode === runtimeCode && ((sameMatches(current.matches) && JSON.stringify([...(current.excludeMatches || [])].sort()) === JSON.stringify(rtExcludes)) || applied[RUNTIME_ID] === runtimeHash)
    : applied[RUNTIME_ID] === runtimeHash);

  const next = {};
  const registered = [];
  let unsure = false; // a register or update failed: what's registered is then for the browser to say
  const registerMod = async (mod, update) => {
    try {
      if (update) await us.update([modToUserScript(mod)]);
      else await us.register([modToUserScript(mod)]);
      next[mod.id] = mod.hash ?? null;
      registered.push(mod.id);
    } catch (e) {
      unsure = true;
      errors.push({ id: mod.id, error: errMsg(e) });
    }
  };
  const knownNow = () => (unsure ? null : [RUNTIME_ID, ...(sandboxUp ? [SANDBOX_RUNTIME_ID] : []), ...registered]);

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
      } catch { unsure = true; /* one at a time, below (some of the call's may be registered) */ }
    }
    const there = update || mods.length === 1 ? null : new Set((await us.getScripts()).map((s) => s.id));
    for (const mod of mods) await registerMod(mod, update || !!there?.has(mod.id));
  };

  if (!runtimeOk) {
    if (existing.length) await us.unregister();
    // A mod with an invalid pattern makes the union invalid too; then the runtime goes everywhere
    // (the mod itself fails to register and is reported).
    try { await us.register([runtimeUserScript(runtimeCode, matches, rtExcludes)]); } catch { await us.register([runtimeUserScript(runtimeCode, ['<all_urls>'], rtExcludes)]); }
    next[RUNTIME_ID] = runtimeHash;
    await syncSandboxRuntime(true);
    await registerMods(sandboxUp ? desired : desired.filter((m) => !inSandboxWorld(m)), false);
    return { registered, errors, applied: next, reset: true, known: knownNow() };
  }

  next[RUNTIME_ID] = runtimeHash;
  const stale = existing.map((s) => s.id).filter((id) => id !== RUNTIME_ID && id !== SANDBOX_RUNTIME_ID && !seen.has(id));
  if (stale.length) await us.unregister({ ids: stale });
  await syncSandboxRuntime(false);
  const fresh = [];
  const changed = [];
  for (const mod of desired) {
    if (inSandboxWorld(mod) && !sandboxUp) continue; // (reported above)
    if (!existingIds.has(mod.id)) fresh.push(mod);
    else if (mod.hash && applied[mod.id] === mod.hash) { next[mod.id] = mod.hash; registered.push(mod.id); }
    else changed.push(mod);
  }
  await registerMods(changed, true);
  await registerMods(fresh, false);
  const order = new Map(desired.map((m, i) => [m.id, i]));
  registered.sort((a, b) => order.get(a) - order.get(b)); // (in the mods' order, as before they were batched)
  return { registered, errors, applied: next, reset: false, known: knownNow() };
}

// ---- mods in storage -----------------------------------------------------------------------------

/**
 * The mods are kept in chrome.storage.local one per key (`mod:<id>`), in the order `modIds` gives, so a
 * change to one mod writes only that one: each write is a copy for the browser to pass on (and to every
 * open extension page, in storage.onChanged), and a whole set of big mods on every change was a lot of
 * memory for Firefox to free. (0.2.4 and older kept them all under `mods`: read until the first write.)
 */
export const modStorageKey = (id) => `mod:${id}`;

/** The mods in what chrome.storage.local.get(null) returned. */
export function storedMods(items) {
  const s = items || {};
  if (Array.isArray(s.modIds)) return s.modIds.map((id) => s[modStorageKey(id)]).filter((m) => m && typeof m === 'object');
  return Array.isArray(s.mods) ? s.mods : [];
}

// What tells a mod's stored copy is current: all of it but the code, which its hash covers (mods.js buildMod).
const storedSignature = (m) => JSON.stringify(typeof m.hash === 'string' ? { ...m, code: undefined } : m);

/** What's in storage, as storedMods read it, for modsStoragePlan. */
export function modsStorageState(items) {
  const s = items || {};
  if (!Array.isArray(s.modIds)) return { ids: null, keys: new Map(), legacy: 'mods' in s };
  return { ids: s.modIds, keys: new Map(storedMods(s).map((m) => [m.id, storedSignature(m)])), legacy: 'mods' in s };
}

/**
 * How to bring storage (`stored`, from modsStorageState or a previous plan) to `mods`: `set` (the mods that
 * changed, and `modIds` if the list did), then `remove` (gone mods' keys, and the old `mods`). `stored` is
 * what storage holds once both are done.
 */
export function modsStoragePlan(mods, stored) {
  const set = {};
  const keys = new Map();
  const list = (Array.isArray(mods) ? mods : []).filter((m) => m && typeof m.id === 'string' && m.id);
  for (const m of list) {
    const sig = storedSignature(m);
    keys.set(m.id, sig);
    if (stored.keys.get(m.id) !== sig) set[modStorageKey(m.id)] = m;
  }
  const ids = list.map((m) => m.id);
  if (JSON.stringify(ids) !== JSON.stringify(stored.ids)) set.modIds = ids;
  const remove = [...stored.keys.keys()].filter((id) => !keys.has(id)).map(modStorageKey);
  if (stored.legacy) remove.push('mods');
  return { set, remove, stored: { ids, keys, legacy: false } };
}

// ---- mods sets in parts ---------------------------------------------------------------------------

/**
 * What this extension can do beyond 0.2.4's native messaging protocol, sent in its hello so the helper
 * never has to guess from the version: 'modsParts' takes a mods set bigger than one native message (1 MB)
 * as {type:"modsPart"} messages (ModsParts); 'modsSame' takes a mod it already has without its code
 * (fillSameMods).
 */
export const FEATURES = ['modsParts', 'modsSame'];

/**
 * A mods message's mods with the code put back in those sent without it (`same: true`: the helper sent
 * them before, with this hash; helper/lib/mods.js withSame), from `had` (the mods as they were). Returns
 * {mods}, or {missing: [ids]} when one isn't there with that hash (then the helper must send them all).
 */
export function fillSameMods(mods, had) {
  const byId = new Map((Array.isArray(had) ? had : []).filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
  const missing = [];
  const out = (Array.isArray(mods) ? mods : []).map((m) => {
    if (!m || m.same !== true) return m;
    const was = byId.get(m.id);
    if (!was || typeof was.code !== 'string' || typeof m.hash !== 'string' || was.hash !== m.hash) { missing.push(String(m.id)); return m; }
    const { same, ...rest } = m;
    return { ...rest, code: was.code };
  });
  return missing.length ? { missing } : { mods: out };
}

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
 * Tim's mods the user deleted and got back (Settings' "Add the rest", a site's link): the helper sends each
 * with `readded` (a stamp). The first time this browser sees a stamp, the mod is switched as Tim set it,
 * like a new one (off when it comes with `startOff`, else on), not as it was before it was deleted;
 * `readded` (id -> stamp) remembers that, so after it the switch is the user's. Pure: returns {disabled,
 * readded, changed} with new objects when something changed.
 */
export function applyReadded(mods, disabled = {}, readded = {}) {
  const fresh = (mods || []).filter((m) => typeof m?.id === 'string' && typeof m.readded === 'string' && readded[m.id] !== m.readded);
  if (!fresh.length) return { disabled, readded, changed: false };
  const d = { ...disabled };
  const r = { ...readded };
  for (const m of fresh) {
    if (m.startOff) d[m.id] = true; else delete d[m.id];
    r[m.id] = m.readded;
  }
  return { disabled: d, readded: r, changed: true };
}

// ---- new mods start on or off ----------------------------------------------------------------------
// A mod from outside this browser's own chat arrives switched off, until the user has looked at it. What
// counts as arriving: a mod id this
// browser has never seen (`seenMods`: a terminal agent's, one dropped in by hand, Tim's mods added, one
// made from another browser), and a new version of a shipped mod TRIF put in place by itself (the helper
// sends its stamp as `autoUpdated`; `autoUpdated` here remembers the stamps seen). Not: one this browser's
// own side-panel chat made while its run was going (its origin is this install, `live`: the user asked for it,
// and the agent checks it running; a file that appeared just after the run ended doesn't count; unless Settings'
// "Mods your chat makes" is Wait for me: `chatWait`), one waiting for the user's OK anyway (held: allowing it is looking at it), or one the user
// asked for by name (a new version they chose, one restored from the trash: ids already seen). Tim's mods
// the user got back (`readded`) count as arriving. `newOff` (id -> 'new' | 'update' | 'chat') remembers why a
// mod was switched off, for the panel and `trif status`, until the user switches it on.

/** The groups a mod can be in. */
export const MOD_GROUPS = ['rules', 'sandboxed', 'page'];

/** chrome.storage.local `newOff`, cleaned up: mod id -> 'new' | 'update' | 'chat'. */
export function normalizeNewOff(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [id, v] of Object.entries(value)) if (v === 'new' || v === 'update' || v === 'chat') out[id] = v;
  return out;
}

/**
 * The first time this browser sees each mod (and each stamp of a shipped mod TRIF updated by itself):
 * remembered in `seen` (id -> true) and `autoUpdated` (id -> stamp); one from outside the chat is switched
 * off, with why in `newOff`. `seen` null (never stored: a browser that had its mods before this
 * existed) takes every mod there now as seen, switching nothing off; `autoUpdated` null likewise.
 * `readded`: the stamps the browser had seen before this message (a mod with a new one arrives again).
 * Pure: returns {disabled, seen, autoUpdated, newOff, changed} with new objects when something changed.
 */
export function applyNewMods(mods, { disabled = {}, seen = null, autoUpdated = null, newOff = {}, chatWait = false, installId = null, readded = {} } = {}) {
  const list = (mods || []).filter((m) => typeof m?.id === 'string');
  const out = { disabled, seen: seen || {}, autoUpdated: autoUpdated || {}, newOff, changed: false };
  const copy = () => {
    if (out.changed) return;
    out.disabled = { ...disabled }; out.seen = { ...(seen || {}) }; out.autoUpdated = { ...(autoUpdated || {}) }; out.newOff = { ...newOff };
    out.changed = true;
  };
  if (!seen || !autoUpdated) {
    copy();
    if (!seen) for (const m of list) out.seen[m.id] = true;
    if (!autoUpdated) for (const m of list) if (typeof m.autoUpdated === 'string') out.autoUpdated[m.id] = m.autoUpdated;
  }
  // (this browser's own chat: written while its run here was going, origin.live; not a file that appeared in the
  // moments after it ended, which helper/lib/origins.js also counts for it but could be anyone's)
  const fromChat = (m) => !!installId && m.origin?.by === installId && m.origin.live === true;
  const off = (m) => !m.held && (!fromChat(m) || chatWait);
  for (const m of list) {
    const fresh = !out.seen[m.id] || (typeof m.readded === 'string' && readded[m.id] !== m.readded);
    const updated = typeof m.autoUpdated === 'string' && out.autoUpdated[m.id] !== m.autoUpdated;
    if (!fresh && !updated) continue;
    copy();
    out.seen[m.id] = true;
    if (typeof m.autoUpdated === 'string') out.autoUpdated[m.id] = m.autoUpdated;
    if (off(m) && out.disabled[m.id] !== true) {
      out.disabled[m.id] = true;
      out.newOff[m.id] = fromChat(m) ? 'chat' : fresh ? 'new' : 'update';
    }
  }
  // (why a mod that's gone was off: nothing to show any more)
  const present = new Set(list.map((m) => m.id));
  for (const id of Object.keys(out.newOff)) if (!present.has(id)) { copy(); delete out.newOff[id]; }
  return out;
}

/**
 * "Mods your chat makes: Wait for me": a change the chat made to a mod that's running waits, and the version
 * before keeps running until the user turns this one on. `waiting` (id -> {old: the mod as it was}); given the
 * mods before and after a sync. Pure: returns {waiting, changed}.
 */
export function applyChatWaiting(before, after, { waiting = {}, chatWait = false, installId = null, isOn = () => true } = {}) {
  const was = new Map((before || []).map((m) => [m.id, m]));
  const out = { ...waiting };
  let changed = false;
  for (const m of after || []) {
    const held = out[m.id];
    const old = was.get(m.id);
    const fromChat = !!installId && m.origin?.by === installId && m.origin.live === true;
    if (held) {
      // (put back as it was, or changed from outside the chat: nothing to wait for)
      if (held.old.hash === m.hash || (old && old.hash !== m.hash && !fromChat)) { delete out[m.id]; changed = true; }
      continue;
    }
    if (chatWait && fromChat && old && old.hash !== m.hash && !m.held && isOn(m.id)) { out[m.id] = { old }; changed = true; }
  }
  const present = new Set((after || []).map((m) => m.id));
  for (const id of Object.keys(out)) if (!present.has(id)) { delete out[id]; changed = true; }
  return { waiting: out, changed };
}

/** chrome.storage.local `readded`, cleaned up: mod id -> stamp. */
export function normalizeReadded(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [id, v] of Object.entries(value)) if (typeof v === 'string') out[id] = v;
  return out;
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

// ---- the panel in a window of its own ------------------------------------------------------------
//
// Some Chromium browsers have chrome.sidePanel but not Chrome's side panel itself: Arc replaced Chrome's
// browser UI, which is where the side panel lives, so sidePanel.open() does nothing there (even in Chrome
// it doesn't wait for the panel to show). So a side panel says which window it's in as it loads
// ("panel.window"), and when none has said so within PANEL_OPEN_WAIT_MS of the toolbar click, the
// background opens the same page in a popup window beside the browser window instead, following that
// window's tabs (sidepanel.html?window=<id>&fallback=1). See docs/PROTOCOL.md, "The panel in a window".

export const PANEL_WINDOW_WIDTH = 400;
export const PANEL_OPEN_WAIT_MS = 1000;
// A side panel that shows up later than that (a slow start in Chrome) still counts: the window opened
// meanwhile is closed again, and the browser isn't remembered as needing one.
export const PANEL_LATE_MS = 10000;
// A toolbar click focuses the browser window it's in: a focus that recent is the click's own.
export const CLICK_FOCUS_MS = 500;

/** The panel page's address in a window of its own, following the tabs of browser window `windowId`. */
export function panelWindowUrl(getURL, windowId) {
  return getURL(`sidepanel.html?window=${windowId}&fallback=1`);
}

/**
 * What the panel page's address (location.search) says: `openedFor`, the browser window whose tabs it
 * follows when it's a window of its own (Safari's, or the fallback here), else null (a side panel, which
 * follows its own window's); `fallback`, whether it's the fallback.
 */
export function panelQuery(search) {
  const q = new URLSearchParams(search || '');
  const id = Number(q.get('window'));
  const openedFor = Number.isInteger(id) && id > 0 ? id : null;
  return { openedFor, fallback: openedFor !== null && q.get('fallback') === '1' };
}

/**
 * The browser window a panel window (from windows.getAll with tabs) follows, or null when `win` isn't one.
 * `base` is the extension's own URL (runtime.getURL('')).
 */
export function panelWindowTarget(win, base) {
  const tab = win?.tabs?.length === 1 ? win.tabs[0] : null;
  const url = tab ? (tab.url || tab.pendingUrl || '') : '';
  if (!base || !url.startsWith(`${base}sidepanel.html?`)) return null;
  const { openedFor, fallback } = panelQuery(url.slice(url.indexOf('?')));
  return fallback ? openedFor : null;
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isBox = (b) => !!b && finite(b.left) && finite(b.top) && finite(b.width) && finite(b.height) && b.width > 0 && b.height > 0;

/** The screen (one of `screens`, {left, top, width, height}: its usable area) that window `win` is mostly on. */
export function screenFor(screens, win) {
  if (!isBox(win) || !Array.isArray(screens)) return null;
  const area = (s) => Math.max(0, Math.min(s.left + s.width, win.left + win.width) - Math.max(s.left, win.left))
    * Math.max(0, Math.min(s.top + s.height, win.top + win.height) - Math.max(s.top, win.top));
  let best = null;
  for (const s of screens.filter(isBox)) if (area(s) > 0 && (!best || area(s) > area(best))) best = s;
  return best;
}

/** `screens` with `screen` added (the latest first, a few at most, none twice). */
export function rememberScreen(screens, screen) {
  const list = Array.isArray(screens) ? screens.filter(isBox) : [];
  if (!isBox(screen)) return list;
  const key = (s) => [s.left, s.top, s.width, s.height].join();
  const s = { left: screen.left, top: screen.top, width: screen.width, height: screen.height };
  return [s, ...list.filter((x) => key(x) !== key(s))].slice(0, 6);
}

/**
 * Where the panel window goes for browser window `win`: beside its right edge, as tall as it, when the
 * screen it's on (from `screens`) has room there; otherwise over the window's right edge, inside the
 * screen. With no screen known, over the right edge (on screen whenever the window's right edge is).
 */
export function panelWindowBounds(win, screens, width = PANEL_WINDOW_WIDTH) {
  if (!isBox(win)) return { width, height: 800 };
  const w = Math.round(Math.min(width, win.width));
  const right = Math.round(win.left + win.width);
  const top = Math.round(win.top);
  const height = Math.round(win.height);
  const s = screenFor(screens, win);
  if (s && right + w <= s.left + s.width) return { left: right, top, width: w, height };
  let left = right - w;
  if (s) left = Math.max(s.left, Math.min(left, s.left + s.width - w));
  return { left: Math.round(left), top, width: w, height };
}

/**
 * What a toolbar click in browser window `browser` does while its panel window `panel` is open
 * (windows.get results; `focusedAt`: window id -> when it was last focused, as far as the background
 * saw). 'focus' brings the panel back when it's minimized, or behind the browser window (it overlaps it,
 * and the browser window was focused after it, not just now by the click itself); else 'close', like the
 * side panel's second click.
 */
export function panelWindowClick({ panel, browser, focusedAt = {}, now = Date.now() }) {
  if (panel?.state === 'minimized') return 'focus';
  const overlap = isBox(panel) && isBox(browser)
    && panel.left < browser.left + browser.width && browser.left < panel.left + panel.width
    && panel.top < browser.top + browser.height && browser.top < panel.top + panel.height;
  const p = focusedAt[panel?.id] || 0;
  const b = focusedAt[browser?.id] || 0;
  return overlap && b > p && now - b > CLICK_FOCUS_MS ? 'focus' : 'close';
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

/**
 * Tim's mods, site by site, as the helper sends them (helper/lib/preinstalled.js starterOffer), cleaned up:
 * {chosen, sites: [{site, name, note, choice: 'added'|'none'|null, suggested, mods: [{id, name, description, on, choice: 'added'|'deleted'|'skipped'|null}]}]},
 * or null (an older helper, or nothing usable).
 */
export function normalizeStarter(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.sites)) return null;
  const str = (x, max = 200) => (typeof x === 'string' ? x.slice(0, max) : '');
  const sites = [];
  for (const s of value.sites.slice(0, 50)) {
    const site = s && typeof s === 'object' ? scopeFor(str(s.site)) : '';
    if (!site || sites.some((x) => x.site === site)) continue;
    const mods = (Array.isArray(s.mods) ? s.mods : []).slice(0, 50).filter((m) => m && typeof m === 'object' && str(m.id))
      .map((m) => ({ id: str(m.id), name: str(m.name) || str(m.id), description: str(m.description), on: !!m.on, choice: ['added', 'deleted', 'skipped'].includes(m.choice) ? m.choice : null }));
    if (!mods.length) continue;
    sites.push({ site, name: str(s.name, 60) || site, note: str(s.note, 80), choice: s.choice === 'added' || s.choice === 'none' ? s.choice : null, suggested: !!s.suggested, mods });
  }
  return { chosen: !!value.chosen || sites.some((s) => s.choice), sites };
}

/** The sites' names as words: "X", "X and Google", "X, Google and Amazon". */
export function siteNames(names) {
  const list = (names || []).filter(Boolean);
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
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

/**
 * The site in `sitesOn` that covers `url`'s host (http/https only), or null: TRIF is off there. With the
 * sensitive sites (`sensitive`, sensitiveSites below), the host's own site only: google.com on doesn't
 * cover mail.google.com, which is a site of its own.
 */
export function siteOnFor(url, sitesOn, sensitive = null) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (sensitive) { const s = sensitive.scopeOf(u.hostname); return (sitesOn || []).includes(s) ? s : null; }
  return (sitesOn || []).find((s) => hostInScope(u.hostname, s)) || null;
}

// ---- sensitive sites, each a site of its own ---------------------------------------------------------
// A host on the sensitive list (agentsites.js: TRIF's, or the user's from Settings) that is a subdomain of
// a registrable domain (mail.google.com under google.com) is a site of its own in TRIF (Tim, 2026-11-11):
// its mods are in sites/<host>/, its panel lists only those, a side-panel run there is scoped to it (and
// its folder: helper/lib/scope.js scopeOf), it has its own switch, block and access, and no other site's
// mods run on it: not the parent's (their `*.google.com` gets mail.google.com excluded), not all-sites
// mods. A sensitive host that is itself a registrable domain (paypal.com) is already a site of its own;
// all-sites mods skip it too. Either way a sensitive site's own mods run only there.
// Wildcard patterns (`*bank*`) split at the label that matched: netbank.example.com is its own site.
// `pending`: hosts the user hasn't answered the upgrade's question about yet (background.js
// "sensitive sites on upgrade"): until then they stay part of their parent, as before.

const cleanHostName = (h) => String(h || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '').replace(/^www\./, '');

/**
 * The sensitive site `host` is in: {scope, why, pattern}, or null when it isn't sensitive. `scope` is the
 * part of the host the matching pattern names (mail.google.com for inbox.mail.google.com), or its
 * registrable domain when that's longer (paypal.com for www.paypal.com; example.bank for `*.bank`). The
 * shortest when several match.
 */
export function sensitiveHit(host, list = null, pending = []) {
  const h = cleanHostName(host);
  if (!h || !h.includes('.') || isIp(h) || h.includes(':')) return null;
  const reg = scopeFor(h);
  let best = null;
  for (const x of sensitiveList(list)) {
    if (!patternMatches(x.pattern, h)) continue;
    const p = cleanHostName(x.pattern);
    let cand = p;
    if (p.includes('*')) {
      const labels = h.split('.');
      const pl = p.split('.');
      if (pl.length === 1) {
        // (the matching label furthest right: `*bank*` on bank.mybank.example.com is mybank.example.com)
        const re = new RegExp(`^${pl[0].split('*').map((t) => t.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')).join('[a-z0-9-]*')}$`);
        let i = labels.length - 1;
        while (i >= 0 && !re.test(labels[i])) i--;
        cand = labels.slice(Math.max(i, 0)).join('.');
      } else cand = labels.slice(labels.length - pl.length).join('.');
    }
    if (!hostInScope(cand, reg)) cand = reg;
    if (cand !== reg && pending.includes(cand)) continue; // (not answered yet: still part of its parent)
    if (!best || cand.length < best.scope.length) best = { scope: cand, why: x.why, pattern: x.pattern };
  }
  return best;
}

/**
 * The sensitive sites, for the functions that need them (siteOnFor, limitToSites, syncUserScripts):
 *   scopeOf(host)     the site a host is in: its sensitive site, else its registrable domain
 *   isSensitive(site) whether a site is a sensitive one
 *   whyOf(site)       its `why` ("email")
 *   splits            the sensitive sites of their own under a registrable domain that TRIF knows of: the
 *                     list's hosts, and those among `hosts` (sites on, blocked, mod folders, tabs seen)
 * `list`: the user's sensitive list or null for TRIF's; `pending` as above.
 */
export function sensitiveSites({ list = null, pending = [], hosts = [] } = {}) {
  const memo = new Map();
  const hit = (h) => { const k = cleanHostName(h); if (!memo.has(k)) memo.set(k, sensitiveHit(k, list, pending)); return memo.get(k); };
  const scopeOf = (h) => hit(h)?.scope || scopeFor(h);
  const splits = new Set();
  const consider = (h) => { const x = hit(h); if (x && x.scope !== scopeFor(x.scope)) splits.add(x.scope); };
  for (const x of sensitiveList(list)) if (!x.pattern.includes('*')) consider(x.pattern);
  for (const h of hosts || []) consider(h);
  return {
    list, pending: [...pending],
    scopeOf,
    isSensitive: (site) => hit(site)?.scope === cleanHostName(site),
    whyOf: (site) => hit(site)?.why || '',
    splits: [...splits].sort(),
  };
}

/** The sensitive sites named in the list itself (not wildcard patterns): what TRIF can block from the start. */
export function sensitiveListSites(list = null) {
  const out = new Set();
  for (const x of sensitiveList(list)) {
    if (x.pattern.includes('*')) continue;
    const s = sensitiveHit(x.pattern, list)?.scope;
    if (s) out.add(s);
  }
  return [...out].sort();
}

/** A stored list of sites (sitesOn, blockedSites): clean host names as they are (mail.google.com stays), sorted. */
export function normalizeSiteList(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((x) => typeof x === 'string').map(cleanHostName).filter((x) => /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*)$/.test(x)))].sort();
}

/** The hosts the upgrade asks about, from storage: [{host, parent, why, mods: [ids], allSites: [ids]}]. */
export function normalizePending(value) {
  const out = [];
  for (const p of Array.isArray(value) ? value : []) {
    const host = cleanHostName(p?.host);
    if (!host || out.some((x) => x.host === host)) continue;
    const ids = (l) => (Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []);
    out.push({ host, parent: cleanHostName(p.parent) || scopeFor(host), why: String(p.why || ''), mods: ids(p.mods), allSites: ids(p.allSites) });
  }
  return out;
}

/**
 * What to do with sensitive sites TRIF hasn't dealt with yet (background.js "sensitive sites on upgrade").
 * `hosts`: sensitive sites (sensitiveHit's scopes) to look at; those in `done`, `pending` or `blocked` are
 * skipped. Returns {block: [sites], ask: [{host, parent, why, mods, allSites}], done: [sites]}:
 *   - a site of its own under a registrable domain (mail.google.com) that the user's setup reaches (TRIF on
 *     for its parent and a switched-on mod of the parent's, or an all-sites one, matching it; or mods in its
 *     own folder): asked about, with the parent's mods that match it (`mods`, switched on or off: the copies
 *     keep that) and the all-sites ones that did (`allSites`: they skip it from now on);
 *   - a sensitive registrable domain (paypal.com) that's on, or has mods of its own: left as it is;
 *   - any other: blocked.
 * `force`: work out the ask for a host whatever else (the panel's Keep, with the mods as they are now).
 */
export function sensitivePlan({ hosts = [], done = [], pending = [], blocked = [], list = null, mods = [], disabled = {}, sitesOn = [], force = false } = {}) {
  const out = { block: [], ask: [], done: [] };
  const seen = new Set();
  for (const raw of hosts) {
    const host = sensitiveHit(raw, list)?.scope;
    if (!host || seen.has(host)) continue;
    seen.add(host);
    if (!force && (done.includes(host) || pending.includes(host) || blocked.includes(host))) continue;
    const parent = scopeFor(host);
    const folder = (m) => String(m?.id || '').split('/')[0];
    const own = mods.filter((m) => hostInScope(folder(m), host));
    const reaches = (m) => (Array.isArray(m.matches) ? m.matches : []).some((p) => patternReachesHost(p, host));
    const on = (m) => disabled[m.id] !== true && !m.held;
    if (parent === host) {
      if (!force) { if (!(sitesOn.includes(host) || own.length)) out.block.push(host); out.done.push(host); }
      continue;
    }
    const parentMods = mods.filter((m) => folder(m) !== 'all-sites' && scopeFor(folder(m)) === parent && !hostInScope(folder(m), host) && reaches(m));
    const allSites = mods.filter((m) => folder(m) === 'all-sites' && reaches(m));
    const reached = own.length > 0 || (sitesOn.includes(parent) && (parentMods.some(on) || allSites.some(on)));
    if (reached || force) out.ask.push({ host, parent, why: sensitiveHit(host, list)?.why || '', mods: parentMods.map((m) => m.id), allSites: allSites.filter(on).map((m) => m.id) });
    else out.block.push(host);
    if (!force) out.done.push(host);
  }
  return out;
}

/** The site a mod's folder is: its id's first part, as a site (all-sites: null). */
export function modHome(mod, sensitive = null) {
  const folder = String(mod?.id || '').split('/')[0] || String(mod?.site || '');
  if (!folder || folder === 'all-sites') return null;
  return sensitive ? sensitive.scopeOf(folder) : scopeFor(folder);
}

/** Whether a match pattern's host part reaches `host` (any path): `*://*.google.com/x/*` reaches mail.google.com. */
export function patternReachesHost(pattern, host) {
  const p = String(pattern ?? '').trim();
  if (p === '<all_urls>') return true;
  const m = /^(\*|https?):\/\/([^/]*)\//i.exec(p);
  if (!m) return false;
  const ph = m[2].replace(/:(\*|\d+)$/, '').toLowerCase().replace(/\.$/, '');
  const h = cleanHostName(host);
  if (ph === '*') return true;
  if (ph.startsWith('*.')) return hostInScope(h, ph.slice(2)) || hostInScope(`www.${h}`, ph.slice(2));
  return ph === h || ph === `www.${h}`;
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
 * With the sensitive sites (`sensitive`, sensitiveSites): a sensitive site only gets its own mods (those
 * in its folder), and those run only there; other mods' patterns covering one get it excluded (`*.google.com`
 * runs on google.com but not on mail.google.com). `usedSites`: the sites it ends up on.
 */
export function limitToSites(mod, sitesOn, sensitive = null) {
  const out = new Set();
  const used = new Set();
  const on = sitesOn || [];
  const home = sensitive ? modHome(mod, sensitive) : null;
  const homeSensitive = !!home && sensitive.isSensitive(home);
  // (may the mod run on site s at all)
  const allowed = (s) => !sensitive || (homeSensitive ? s === home : s === home || !sensitive.isSensitive(s));
  for (const raw of Array.isArray(mod?.matches) ? mod.matches : []) {
    const p = String(raw).trim();
    const m = p === '<all_urls>' ? ['', '*', '*', '/*'] : /^(\*|https?|wss?|ftp):\/\/([^/]*)(\/.*)$/i.exec(p);
    if (!m) continue;
    const [, scheme, hostPart, path] = m;
    const port = /(:(\*|\d+))$/.exec(hostPart)?.[1] || '';
    const host = hostPart.slice(0, hostPart.length - port.length).toLowerCase();
    const add = (s) => { used.add(s); out.add(`${scheme}://${s}${port}${path}`); out.add(`${scheme}://*.${s}${port}${path}`); };
    if (host === '*') { on.filter(allowed).forEach(add); continue; }
    const wild = host.startsWith('*.');
    const base = wild ? host.slice(2) : host;
    const covering = sensitive ? (on.includes(sensitive.scopeOf(base)) ? sensitive.scopeOf(base) : null) : on.find((s) => hostInScope(base, s));
    if (covering && allowed(covering)) { used.add(covering); out.add(p); continue; }
    // "*.co.uk" with bbc.co.uk on: just bbc.co.uk. (An exact host never covers another site.) And a
    // sensitive site's own mod with `*.google.com`: just mail.google.com.
    if (wild) for (const s of on) if (s !== covering && hostInScope(s, base) && allowed(s)) add(s);
  }
  if (!out.size) return null;
  // (the sensitive sites of their own under the sites it runs on, except its own: excluded)
  const excl = new Set();
  if (sensitive) {
    for (const x of sensitive.splits) {
      if (x === home) continue;
      if ([...used].some((u) => u !== x && hostInScope(x, u))) siteExcludes(x).forEach((e) => excl.add(e));
    }
  }
  const tag = [...used].sort().join(',');
  const xs = [...excl].sort();
  const limited = { ...mod, matches: [...out].sort(), hash: mod.hash ? `${mod.hash}|sites:${tag}${xs.length ? `|apart:${xs.join(',')}` : ''}` : mod.hash };
  if (xs.length) limited.excludes = [...(Array.isArray(mod.excludes) ? mod.excludes : []), ...xs];
  if (sensitive) limited.usedSites = [...used].sort();
  return limited;
}

// ---- site access ----------------------------------------------------------------------------
// TRIF asks for no sites at install (the manifest's host permissions are all optional), and asks for each
// site's when it's turned on there: a site without the browser's access is disconnected (a first visit
// too); "Connect" (or Fix) in the side panel asks for that site's origin (siteOrigins), from the click, and
// turns it on. TRIF never asks for every site. (Until 0.3 a "permissive" mode had <all_urls>: an update
// gives that up once, background.js dropEverySite, and the sites keep their switches and ask again.)
// A site in `sitesOn` counts only with access (activeSites), and never when it's blocked in TRIF
// (`blockedSites`, TRIF's own list, whatever access it has). Safari asks per site itself and its build
// keeps <all_urls> (scripts/build-extension.js), so there TRIF doesn't ask or check.

export const SITE_ACCESS = !SAFARI;

/**
 * The origins a site (a registrable domain) needs: the domain and its subdomains, http and https. One
 * pattern does both: `*.amazon.com` matches amazon.com itself too (in Chrome's and Firefox's match
 * patterns), and asking for amazon.com separately only made the browser's prompt list it twice. An IP
 * address has no subdomains (and `*.` before one isn't a valid pattern): just the address.
 */
const isIp = (site) => /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(site);
export function siteOrigins(site) {
  return isIp(site) ? [`*://${site}/*`] : [`*://*.${site}/*`];
}

export function originsFor(sites) {
  return [...new Set((sites || []).flatMap(siteOrigins))];
}

/**
 * What the browser gives TRIF, from permissions.getAll(): {origins, all, allUrls}. `all`: every http(s)
 * site (<all_urls>, *://*\/*). `allUrls`: <all_urls> itself, which Chrome's and Firefox's tab capture
 * want (a site's own origins aren't enough for it; see screenshot.js).
 */
export function normalizeAccess(granted) {
  const origins = [...new Set((Array.isArray(granted?.origins) ? granted.origins : []).filter((o) => typeof o === 'string'))].sort();
  const allUrls = origins.includes('<all_urls>');
  const all = allUrls || ['http', 'https'].every((scheme) => origins.some((o) => originCovers(o, scheme, '*', false)));
  return { origins, all, allUrls };
}

/** The access when TRIF doesn't check (Safari, or a browser without chrome.permissions): everything. */
export const ALL_ACCESS = Object.freeze({ origins: ['<all_urls>'], all: true, allUrls: true });

/** What the browser gives TRIF now (ALL_ACCESS where TRIF doesn't check). */
export async function readAccess(chromeApi, check = SITE_ACCESS) {
  if (!check || typeof chromeApi?.permissions?.getAll !== 'function') return ALL_ACCESS;
  return normalizeAccess(await chromeApi.permissions.getAll());
}

// Whether a granted origin pattern covers pages of `host` (any port, any path) for `scheme`; with
// `wild`, of all its subdomains too. `host` '*' asks for every host.
function originCovers(pattern, scheme, host, wild) {
  const p = String(pattern).trim();
  if (p === '<all_urls>') return true;
  const m = /^(\*|https?):\/\/([^/]*)(\/.*)$/i.exec(p);
  if (!m || m[3] !== '/*') return false;
  if (m[1] !== '*' && m[1].toLowerCase() !== scheme) return false;
  const hp = /^(.*?)(?::(\*|\d+))?$/.exec(m[2]);
  if (hp[2] !== undefined && hp[2] !== '*') return false;
  const g = hp[1].toLowerCase().replace(/\.$/, '');
  if (g === '*') return true;
  if (host === '*') return false;
  if (g.startsWith('*.')) return hostInScope(host, g.slice(2));
  return !wild && g === host;
}

/** Whether the browser gives TRIF all of `site` (siteOrigins, both schemes; an IP has no subdomains). */
export function hasSiteAccess(access, site) {
  if (!access || access.all) return !!access;
  return ['http', 'https'].every((scheme) => access.origins.some((o) => originCovers(o, scheme, site, false))
    && (isIp(site) || access.origins.some((o) => originCovers(o, scheme, site, true))));
}

/** The sites TRIF works on: on in `sitesOn`, with access. */
export function activeSites(sitesOn, access) {
  return (sitesOn || []).filter((s) => hasSiteAccess(access, s));
}

/** The sites in `sitesOn` the browser doesn't give TRIF (yet, or any more). */
export function sitesWithoutAccess(sitesOn, access) {
  return (sitesOn || []).filter((s) => !hasSiteAccess(access, s));
}

/** The granted origins that give TRIF every site (what an update from a permissive TRIF gives up, once). */
export function everySiteOrigins(access) {
  const every = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);
  return (access?.origins || []).filter((o) => every.has(o));
}

// ---- a site's state in the side panel, and in what agents are told ---------------------------------
// - on: in `sitesOn`, with access: TRIF works there.
// - off: with access, not in `sitesOn` (the power button's off): turning it on again doesn't ask.
// - disconnected: without the browser's access: a first visit, or a site disconnected,
//   or one setup turned on that isn't connected yet. "Connect" asks and turns it on, in one click.
// - blocked: in TRIF's block list (`blockedSites`): nothing from TRIF touches it, whatever access TRIF
//   has (with <all_urls> one site can't be taken away in Chrome's own settings), and it can't be turned on.

/** The state of `site` (a registrable domain): 'on', 'off', 'disconnected' or 'blocked' (see above). */
export function siteState(site, { sitesOn = [], access = null, blocked = [] } = {}) {
  // (no access shows first: a blocked site the user disconnected is disconnected, and Connect brings it back
  // to blocked, which TRIF's block list keeps whatever the access: Tim, 2026-11-11)
  if (!hasSiteAccess(access, site)) return 'disconnected';
  if ((blocked || []).includes(site)) return 'blocked';
  return (sitesOn || []).includes(site) ? 'on' : 'off';
}

/** Why a page command or a run can't touch `site`, in the words the panel uses; null when it's on. */
export function siteRefusal(site, state) {
  if (state === 'blocked') return `${site} is blocked in TRIF: nothing from TRIF runs there or reads it, and only the user can unblock it (in the side panel)`;
  if (state === 'disconnected') return `TRIF is disconnected on ${site}: nothing from TRIF runs there or reads it until the user connects it (the side panel on that site has the button)`;
  if (state === 'off') return `TRIF is off on ${site}: nothing from TRIF runs there or reads it until the user turns it on (the side panel on that site has the switch)`;
  return null;
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

/**
 * The side panel's mods box (Tim, 2026-11-11): `here`, the mods whose @match covers `url` (and held ones,
 * which wait to be allowed here), and `other`, those for other pages of the site (their light is grey), which
 * fold into "N more for other <site> pages" at the bottom. Each keeps the order it had.
 */
export function splitForPage(mods, url) {
  const here = [];
  const other = [];
  for (const m of mods || []) (m.held || modAppliesTo(m, url) ? here : other).push(m);
  return { here, other };
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
// `apart`: sites of their own inside those (lib.js "sensitive sites") the code may not meet: mail.google.com
// for a google.com run, or for any code while mail.google.com isn't on.
export function pageGuard(scope, sitesOn, token, apart = []) {
  let u;
  try { u = new URL(String(location.href)); } catch (e) { return 'the tab is not on a web page any more'; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const inside = (x) => !!x && (host === x || host.endsWith('.' + x));
  let why = null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') why = 'the tab went to a page that isn\'t http or https before TRIF reached it';
  else if (scope && !inside(scope)) why = `the tab went to ${host} before TRIF reached it, and this agent run is limited to ${scope}`;
  else if (!(sitesOn || []).some(inside)) why = `the tab went to ${host} before TRIF reached it, and TRIF is off there`;
  else if ((apart || []).some(inside)) why = `the tab went to ${host} before TRIF reached it, which is a site of its own${scope ? `, and this agent run is limited to ${scope}` : ', and TRIF is off there'}`;
  if (!why && token) window.__trifPageGuard = token;
  return why;
}

// tag: give the code a sourceURL of its own (trif-run-<runId>.js), so the page's save guard (tablock.js
// leakGuard) can tell the agent's code on the call stack from the site's.
export function buildRunCode(code, expression, runId, guard = null, { tag = false } = {}) {
  const body = expression ? `return (${code}\n);` : `${code}\n`;
  // guard {scope, sitesOn, apart}: checked against the document the code meets, before it runs.
  const check = guard
    ? `{ const __wmWhy = (${pageGuard.toString()})(${JSON.stringify(guard.scope || null)}, ${JSON.stringify(guard.sitesOn || [])}, null, ${JSON.stringify(guard.apart || [])}); if (__wmWhy) return JSON.stringify({ ok: false, error: __wmWhy }); }\n`
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
})()${tag ? `\n//# sourceURL=trif-run-${String(runId).replace(/[^\w-]/g, '')}.js` : ''}`;
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

// ---- Groups: how TRIF runs a mod, switched on and off per site (docs/PROTOCOL.md "Groups").
// "rules": a rules mod (its header says @rules: TRIF runs its data); "sandboxed": a sandboxed mod (its
// header says @sandboxed: run in TRIF's own world, sandbox.js); "page": every other mod (a page script, run
// in the page with everything it has), and a sandboxed mod in a browser without the sandbox (it runs, or
// would run, as a page script there: sandboxFallback). `groupsOff` (chrome.storage.local) maps a site to
// the groups switched off there: their mods don't run on it (or its subdomains), each mod's own
// switch left as it is.
export const GROUPS = ['rules', 'sandboxed', 'page'];
// What people call each group (the values above are stored, in groupsOff and startsOff, so they stay): a
// rules mod is a style mod, a sandboxed one a boxed mod, a page script a free mod.
export const GROUP_NAMES = { rules: 'Style mods', sandboxed: 'Boxed mods', page: 'Free mods' };
/** A group's name in a sentence: "style mods", "boxed mods", "free mods". */
export function groupWord(group) { return (GROUP_NAMES[group] || GROUP_NAMES.page).toLowerCase(); }
export function modGroup(mod) { return mod && mod.rules ? 'rules' : inSandboxWorld(mod) ? 'sandboxed' : 'page'; }

/** `groupsOff` from storage, cleaned up: valid sites, known groups, no duplicates, no empty lists. */
export function normalizeGroupsOff(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [site, list] of Object.entries(value)) {
      const s = offSiteName(site);
      if (!s || !Array.isArray(list)) continue;
      const groups = [...new Set(list.filter((g) => GROUPS.includes(g)))];
      if (groups.length) out[s] = [...new Set([...(out[s] || []), ...groups])];
    }
  }
  return out;
}

/** Whether `group` is switched off on `site` (an entry for it or a parent domain). */
export function groupOffOn(groupsOff, group, site) {
  const s = offSiteName(site);
  return !!s && Object.entries(groupsOff || {}).some(([o, list]) => list.includes(group) && hostInScope(s, o));
}

/** `groupsOff` after switching `group` on or off on `site` (a new object). */
export function switchGroup(groupsOff, site, group, enabled) {
  const s = offSiteName(site);
  if (!s) throw new Error(`"${site}" isn't a site (use a hostname like twitter.com)`);
  if (!GROUPS.includes(group)) throw new Error(`"${group}" isn't a group (${GROUPS.join(' or ')})`);
  const out = normalizeGroupsOff(groupsOff);
  const list = new Set(out[s] || []);
  if (enabled) list.delete(group); else list.add(group);
  if (list.size) out[s] = [...list]; else delete out[s];
  return out;
}

/** The sites a mod is switched off on: its own (offSites) and its group's (groupsOff). */
export function offSitesFor(mod, offSites, groupsOff) {
  const own = (offSites && offSites[mod.id]) || [];
  const g = modGroup(mod);
  const group = Object.entries(groupsOff || {}).filter(([, list]) => list.includes(g)).map(([s]) => s);
  return group.length ? [...new Set([...own, ...group])] : own;
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
