// Tab locks (docs/SECURITY.md, "Agent code in a tab"; docs/TABLOCK-AUDIT.md). Before a side-panel agent's
// `trif run` code runs in a tab, the tab is locked: the browser itself blocks, with declarativeNetRequest
// session rules for that tab,
// - every request from it that changes something (POST, PUT, PATCH, DELETE: fetch, XHR, sendBeacon, form
//   posts) and every WebSocket;
// - anything that could carry what the page shows to another site: going to another site's page, or a
//   frame, fetch, XHR or event stream to one; and images, scripts, styles, fonts and media from any site
//   the page hadn't already loaded from when the lock started (TL-1: the page keeps its CDNs, but the code
//   can't name a new site in an image's address).
// Page code can't get around a rule the browser applies (the agent's code runs in the page, and anything
// it leaves behind, timers or wrapped functions, only lives as long as the page does). Clicks, keys and
// reading the page work as before.
//
// While any tab of a site S is locked that way, the whole site is (TL-2, TL-4, TL-5), with rules on what
// S's pages start (initiatorDomains), in any tab:
// - writes and sockets S starts are blocked everywhere, including requests no tab owns (tabId -1: a
//   SharedWorker, S's service worker passing a fetch through) and S's other tabs: those show the paused
//   icon and a notice too, and so does a tab of S opened during the lock;
// - requests no tab owns that S starts can't reach another site (the same rule as the tab's own);
// - S can't send a tab that didn't exist when the lock started to another site (a popup, noopener or
//   not, before TRIF even sees the tab); the user's own new tabs (typed, bookmarks) have no initiator and
//   load as usual, and S's existing tabs can still follow links out.
// Those other tabs unlock when the last tab of S the agent ran code in unlocks. (Several tabs with agent
// code: each unlocks on its own new page; S stays locked until all have.)
//
// The lock lasts as long as the document the code ran in: the next document in the tab (a reload, or a
// real navigation) has none of the agent's code, and unlocks it. A marker in the extension's own
// isolated world (which page code can't see or set) tells the documents apart: it's set in the document
// when the lock starts, and a tab whose current document lacks it gets unlocked. (Not the tab's URL: a
// single-page site changes that without a new document, and the agent's code could too.) A document
// brought back from the back/forward cache brings its code back too: its marker sees that (pageshow),
// locks the tab again and reloads the page. Tabs a locked tab opens are locked too, and stay locked while
// it is (the code could reach into them).
//
// What the code leaves in the site's storage outlives the page (TL-3). First, the agent's code can't save:
// leakGuard (below) refuses saves while its code is on the call stack (a speed bump). Then at lock time
// TRIF takes a fingerprint of S's stored state (from the isolated world: Cache Storage names and keys,
// service worker registrations, localStorage and sessionStorage, IndexedDB names and versions, cookies
// the page can see), and compares it when the tab is on a new page, before unlocking (the lock's rules
// still apply to that page):
// - Cache Storage or service workers changed: TRIF clears just those for S's origin (from the isolated
//   world, so no browsingData permission) and reloads past the cache; then unlocks;
// - localStorage, sessionStorage, IndexedDB or cookies changed (big sites write their own all the time):
//   it unlocks as usual, and says so in a quiet line in the chat (`noted`).
// Limits: IndexedDB's contents aren't compared (names and versions only), cookies only as the page sees
// them (not HttpOnly ones).
//
// Before the agent's code, the page's own leak channels that aren't requests are put out of reach too
// (leakGuard, in the page's world): WebRTC's constructors, link prefetch/preconnect/prerender/
// modulepreload, and speculation rules. That one is a speed bump, not a wall: a fresh realm (a frame the
// guard misses) can get the originals back; DNS prefetch the browser does itself (TL-6).
//
// If the lock can't be set up (no declarativeNetRequest, a browser that ignores the per-tab or initiator
// conditions), the agent's code doesn't run: lock() throws, and `trif run` fails with why.
//
// While a tab is locked, TRIF's toolbar icon for that tab is the robot with a pause sign for eyes
// (icons/robot-paused-*.png, scripts/render-icon.js), and the normal robot again once it unlocks; other
// tabs keep theirs. (chrome.action.setIcon with the tab's id, in Firefox too. Firefox drops a tab's own
// icon when the tab goes to a new page, as a blocked one does while the lock stays: check() sets it again.)

export const ICONS = {
  normal: { 16: 'icons/robot-16.png', 32: 'icons/robot-32.png' }, // (manifest.json's action.default_icon)
  paused: { 16: 'icons/robot-paused-16.png', 32: 'icons/robot-paused-32.png' },
};

export const WRITE_METHODS = ['post', 'put', 'patch', 'delete', 'connect'];

// Requests that could carry data out to another site, whatever their method: going there (a page or a
// frame), or asking it (fetch and XHR, event streams, plugins).
export const CROSS_SITE_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest', 'other', 'object'];
// What a page loads from other sites all the time (X from twimg.com): allowed only from the sites it had
// already loaded from when the lock started (TL-1).
export const SUBRESOURCE_TYPES = ['image', 'script', 'stylesheet', 'font', 'media'];

// The parts of a site's stored state the fingerprint covers (TL-3): those TRIF clears by itself, and
// those it only mentions.
export const CLEARED_PARTS = ['caches', 'serviceWorkers'];
export const NOTED_PARTS = ['localStorage', 'sessionStorage', 'indexedDB', 'cookies'];

/**
 * The rules for a locked tab. No list of request kinds for writes: browsers name them differently
 * (Firefox's sendBeacon is a "beacon", Chrome's a "ping") and a list would miss one. Without
 * `resourceTypes` a rule matches every kind but whole pages, so: changing requests of every kind, then
 * changing page loads (form posts), then sockets, whatever the method; then other sites; then
 * subresources from sites the page didn't already use.
 */
export function lockRules(tabId, ids, site, domains = []) {
  const block = { type: 'block' };
  const keep = [...new Set([site, ...domains])];
  return [
    { id: ids[0], priority: 1000, action: block, condition: { tabIds: [tabId], requestMethods: WRITE_METHODS } },
    { id: ids[1], priority: 1000, action: block, condition: { tabIds: [tabId], requestMethods: WRITE_METHODS, resourceTypes: ['main_frame'] } },
    { id: ids[2], priority: 1000, action: block, condition: { tabIds: [tabId], resourceTypes: ['websocket'] } },
    // (excludedRequestDomains: the site and its subdomains stay reachable, so the tab can reload)
    { id: ids[3], priority: 1000, action: block, condition: { tabIds: [tabId], resourceTypes: CROSS_SITE_TYPES, excludedRequestDomains: [site] } },
    { id: ids[4], priority: 1000, action: block, condition: { tabIds: [tabId], resourceTypes: SUBRESOURCE_TYPES, excludedRequestDomains: keep } },
  ];
}

/**
 * The rules for a site while a tab of it is locked: what the site's pages start (initiatorDomains), in
 * any tab and in none (TL-2, TL-4, TL-5). `openTabs`: the tabs open when the lock started.
 */
export function siteRules(ids, site, domains = [], openTabs = []) {
  const block = { type: 'block' };
  const from = [site];
  const keep = [...new Set([site, ...domains])];
  return [
    { id: ids[0], priority: 1000, action: block, condition: { initiatorDomains: from, requestMethods: WRITE_METHODS } },
    { id: ids[1], priority: 1000, action: block, condition: { initiatorDomains: from, requestMethods: WRITE_METHODS, resourceTypes: ['main_frame'] } },
    { id: ids[2], priority: 1000, action: block, condition: { initiatorDomains: from, resourceTypes: ['websocket'] } },
    // no tab (workers, the service worker): nowhere but the site and what it already used
    { id: ids[3], priority: 1000, action: block, condition: { tabIds: [-1], initiatorDomains: from, resourceTypes: ['xmlhttprequest', 'other', 'object', ...SUBRESOURCE_TYPES], excludedRequestDomains: keep } },
    // a new tab sent to another site by the site (popups)
    { id: ids[4], priority: 1000, action: block, condition: { initiatorDomains: from, resourceTypes: ['main_frame'], excludedRequestDomains: [site], ...(openTabs.length ? { excludedTabIds: openTabs } : {}) } },
  ];
}

// ---- in the tab's isolated world (the extension's, which page code can't reach) ------------------------
// (Functions for chrome.scripting.executeScript: they run there, so they use nothing from this module.)

function setMarker(token) {
  const w = window;
  const first = !w.__trifTabLock;
  w.__trifTabLock = token;
  if (first) {
    w.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      // back from the back/forward cache, agent code and all: lock again, and start the page afresh
      try { chrome.runtime.sendMessage({ type: 'tabLock.restored', token: w.__trifTabLock }); } catch {}
      location.reload();
    });
  }
  return true;
}
function hasMarker(token) { return window.__trifTabLock === token; }

/** The sites the page has loaded anything from (TL-1), with its own. */
function loadedDomains() {
  const out = new Set([location.hostname]);
  try {
    for (const e of performance.getEntriesByType('resource')) {
      try { const u = new URL(e.name); if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.hostname.toLowerCase()); } catch { /* not a URL */ }
    }
  } catch { /* no timeline */ }
  return [...out].filter((h) => h && /^[a-z0-9.-]+$/.test(h)).slice(0, 300);
}

/** A fingerprint of the site's stored state (TL-3): a short hash per part, null where it can't be read. */
async function fingerprint() {
  const hash = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return `${(x >>> 0).toString(16)}:${s.length}`; };
  const storage = (st) => { const ks = []; for (let i = 0; i < st.length; i++) ks.push(st.key(i)); return hash(ks.sort().map((k) => `${k}=${st.getItem(k)}`).join('\n')); };
  const part = async (f) => { try { return await f(); } catch { return null; } };
  return {
    caches: await part(async () => {
      const parts = [];
      for (const n of (await caches.keys()).sort()) parts.push(`${n}=${(await (await caches.open(n)).keys()).map((r) => r.url).sort().join(',')}`);
      return hash(parts.join('|'));
    }),
    serviceWorkers: await part(async () => hash((await navigator.serviceWorker.getRegistrations())
      .map((r) => `${r.scope}@${(r.active || r.waiting || r.installing || {}).scriptURL || ''}`).sort().join('|'))),
    localStorage: await part(() => storage(localStorage)),
    sessionStorage: await part(() => storage(sessionStorage)),
    indexedDB: await part(async () => hash((await indexedDB.databases()).map((d) => `${d.name}@${d.version}`).sort().join('|'))),
    cookies: await part(() => hash(document.cookie.split('; ').sort().join('; '))),
  };
}

/** Clears those parts of the site's stored state (its origin's, as the page sees it). Returns what it did. */
async function clearData(parts) {
  const done = [];
  const step = async (p, f) => { if (!parts.includes(p)) return; try { await f(); done.push(p); } catch { /* can't, from here */ } };
  await step('caches', async () => { for (const n of await caches.keys()) await caches.delete(n); });
  await step('serviceWorkers', async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
  await step('localStorage', () => localStorage.clear());
  await step('sessionStorage', () => sessionStorage.clear());
  // (a database the page has open goes once its page does: the reload after this)
  await step('indexedDB', async () => {
    for (const d of await indexedDB.databases()) {
      await new Promise((res) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => res(); });
    }
  });
  await step('cookies', () => {
    const host = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < host.length - 1; i++) domains.push(host.slice(i).join('.'));
    const paths = ['/', ...location.pathname.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')).filter((p) => p && p !== '/')];
    for (const c of document.cookie.split('; ')) {
      const name = c.split('=')[0];
      if (!name) continue;
      for (const d of domains) for (const p of paths) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}${d ? `; domain=${d}` : ''}`;
    }
  });
  return done;
}

// ---- in the page's own world, before the agent's code (TL-6) --------------------------------------------

export const SAVE_REFUSED = "TRIF: your agent's code can't save data on this site";

/**
 * Puts the page's leak channels that aren't requests out of easy reach: WebRTC's constructors, links that
 * prefetch, preconnect, prerender or modulepreload, and speculation rules. And refuses saves made by the
 * agent's code (TL-3): localStorage and sessionStorage (methods and named properties), IndexedDB (open,
 * delete, object store and cursor writes), cookies (document.cookie, cookieStore), Cache Storage and
 * service worker registration, when the agent's code is on the call stack (its sourceURL, trif-run-*.js:
 * lib.js buildRunCode); the site's own calls pass untouched. In frames of the page's own origin too, as
 * the page reaches them. A speed bump, not a wall: a realm it misses has the originals, and a wrapped
 * function the agent's code hands to the browser to call later (a bound one, through a microtask or a
 * timer's native callback) runs with no agent code on the stack.
 * (For chrome.userScripts.execute: it runs in the page, so it uses nothing from this module.)
 */
export function leakGuard() {
  const top = window;
  if (Object.prototype.hasOwnProperty.call(top, '__trifLeakGuard')) return;
  try { Object.defineProperty(top, '__trifLeakGuard', { value: true }); } catch { return; }
  const BAD_REL = /(^|\s)(dns-prefetch|preconnect|prefetch|prerender|modulepreload)(\s|$)/i;
  const BAD_TYPE = /^\s*speculationrules\s*$/i;
  const SAVE_REFUSED = "TRIF: your agent's code can't save data on this site";
  const AGENT = /trif-run-[\w-]+\.js/;
  const patched = new WeakSet();
  const bad = (n) => n && n.nodeType === 1 && ((n.localName === 'link' && BAD_REL.test(n.getAttribute('rel') || ''))
    || (n.localName === 'script' && BAD_TYPE.test(n.getAttribute('type') || '')));
  const sweep = (n) => {
    if (!n || n.nodeType !== 1) return;
    if (bad(n)) { n.remove(); return; }
    if (n.localName === 'iframe' || n.localName === 'frame') { try { patch(n.contentWindow); } catch { /* another origin */ } }
    if (n.querySelectorAll) for (const m of n.querySelectorAll('link, script, iframe, frame')) sweep(m);
  };
  function patch(w) {
    if (!w || patched.has(w)) return;
    try { void w.document; } catch { return; } // (another origin: not the page's to reach)
    patched.add(w);
    const refuse = function () { throw new w.DOMException('TRIF paused WebRTC on this tab while your agent ran code here', 'NotAllowedError'); };
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription']) {
      if (!(name in w)) continue;
      try { Object.defineProperty(w, name, { value: refuse, writable: false, configurable: false }); } catch { /* already fixed */ }
    }
    // (a link keeps no such rel; a script with such a type gets one that does nothing, not none, which
    // would run its text as code)
    const INERT = 'text/x-trif-paused';
    const guard = (proto, prop, isBad, instead) => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto, prop, { ...d, set(v) { if (!isBad(String(v))) d.set.call(this, v); else if (instead) d.set.call(this, instead); } });
    };
    // Saves by the agent's code: is its code on the stack? (V8's stack can be cut short or reshaped from page
    // code, so with the limit and formatter set aside for the look; if they can't be, it counts as the
    // agent's.)
    const E = w.Error;
    const fromAgent = () => {
      const limit = E.stackTraceLimit, prepare = E.prepareStackTrace;
      let stack;
      try {
        if ('stackTraceLimit' in E) E.stackTraceLimit = 200;
        if (prepare !== undefined) E.prepareStackTrace = undefined;
        stack = new E().stack;
      } catch { return true; } finally {
        try { if ('stackTraceLimit' in E) E.stackTraceLimit = limit; if (prepare !== undefined) E.prepareStackTrace = prepare; } catch { /* as it was */ }
      }
      return typeof stack !== 'string' || AGENT.test(stack);
    };
    const refusal = () => new w.DOMException(SAVE_REFUSED, 'NotAllowedError');
    const refuseSave = (proto, name, promise = false) => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, name);
      if (!d || typeof d.value !== 'function') return;
      const f = d.value;
      const g = { [name](...a) { if (fromAgent()) { if (promise) return w.Promise.reject(refusal()); throw refusal(); } return f.apply(this, a); } }[name];
      Object.defineProperty(proto, name, { ...d, value: g });
    };
    const refuseSetter = (proto, name) => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.set) return;
      Object.defineProperty(proto, name, { ...d, set(v) { if (fromAgent()) throw refusal(); d.set.call(this, v); } });
    };
    try {
      for (const n of ['setItem', 'removeItem', 'clear']) refuseSave(w.Storage && w.Storage.prototype, n);
      // (named properties, localStorage.x = 1, go through no method: the page gets a stand-in that checks)
      for (const n of ['localStorage', 'sessionStorage']) {
        const d = Object.getOwnPropertyDescriptor(w, n);
        if (!d || !d.get || !d.configurable) continue;
        let real = null, stand = null;
        Object.defineProperty(w, n, { ...d, get() {
          const s = d.get.call(this);
          if (s !== real) {
            real = s;
            stand = new w.Proxy(s, {
              get: (t, k) => { const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; },
              set: (t, k, v) => { if (typeof k === 'string' && fromAgent()) throw refusal(); return Reflect.set(t, k, v, t); },
              deleteProperty: (t, k) => { if (typeof k === 'string' && fromAgent()) throw refusal(); return Reflect.deleteProperty(t, k); },
              defineProperty: (t, k, desc) => { if (fromAgent()) throw refusal(); return Reflect.defineProperty(t, k, desc); },
            });
          }
          return stand;
        } });
      }
      for (const n of ['open', 'deleteDatabase']) refuseSave(w.IDBFactory && w.IDBFactory.prototype, n);
      for (const n of ['put', 'add', 'delete', 'clear', 'createIndex', 'deleteIndex']) refuseSave(w.IDBObjectStore && w.IDBObjectStore.prototype, n);
      for (const n of ['update', 'delete']) refuseSave(w.IDBCursor && w.IDBCursor.prototype, n);
      if (w.Document) refuseSetter(w.Document.prototype, 'cookie');
      if (w.HTMLDocument) refuseSetter(w.HTMLDocument.prototype, 'cookie');
      for (const n of ['set', 'delete']) refuseSave(w.CookieStore && w.CookieStore.prototype, n, true);
      for (const n of ['open', 'delete']) refuseSave(w.CacheStorage && w.CacheStorage.prototype, n, true);
      for (const n of ['put', 'add', 'addAll', 'delete']) refuseSave(w.Cache && w.Cache.prototype, n, true);
      refuseSave(w.ServiceWorkerContainer && w.ServiceWorkerContainer.prototype, 'register', true);
    } catch { /* a frame going away */ }
    try {
      guard(w.HTMLLinkElement.prototype, 'rel', (v) => BAD_REL.test(v));
      guard(w.HTMLScriptElement.prototype, 'type', (v) => BAD_TYPE.test(v), INERT);
      const setAttribute = w.Element.prototype.setAttribute;
      w.Element.prototype.setAttribute = function (name, value) {
        const n = String(name).toLowerCase();
        if (this instanceof w.HTMLLinkElement && n === 'rel' && BAD_REL.test(String(value))) return undefined;
        if (this instanceof w.HTMLScriptElement && n === 'type' && BAD_TYPE.test(String(value))) return setAttribute.call(this, name, INERT);
        return setAttribute.call(this, name, value);
      };
      if (w.HTMLScriptElement.supports) {
        const supports = w.HTMLScriptElement.supports;
        w.HTMLScriptElement.supports = (t) => (BAD_TYPE.test(String(t)) ? false : supports.call(w.HTMLScriptElement, t));
      }
      // a frame of the page's own origin (about:blank): fixed as the page reaches into it
      for (const [proto, prop] of [[w.HTMLIFrameElement.prototype, 'contentWindow'], [w.HTMLIFrameElement.prototype, 'contentDocument'],
        [w.HTMLFrameElement && w.HTMLFrameElement.prototype, 'contentWindow'], [w.HTMLObjectElement.prototype, 'contentWindow']]) {
        const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.get) continue;
        Object.defineProperty(proto, prop, { ...d, get() { const v = d.get.call(this); try { patch(prop === 'contentDocument' ? v && v.defaultView : v); } catch { /* not ours */ } return v; } });
      }
      new w.MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes') { if (bad(r.target)) r.target.remove(); continue; }
          for (const n of r.addedNodes) sweep(n);
        }
      }).observe(w.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['rel', 'type'] });
      sweep(w.document.documentElement);
    } catch { /* a frame going away */ }
  }
  patch(top);
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const defaultInScope = (host, site) => !!host && !!site && (host === site || host.endsWith(`.${site}`));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// icon(tabId, paused): sets the tab's toolbar icon (background.js: the paused face, or the tab's own face
// when it unlocks, faces.js); without it, the paused robot or the normal one.
export function createTabLocks({ chrome, log = () => {}, changed = () => {}, noted = () => {}, key = 'tabLocks', inScope = defaultInScope, icon = null }) {
  // tabId -> {token, ids, site, url, since, parent, kind, domains, fp, cleared, noted}
  // kind: 'code' (the agent's code ran there), 'opened' (a locked tab opened it), 'site' (another tab of a
  // locked site: the site's rules cover it, no rules of its own)
  const locks = new Map();
  const sites = new Map(); // site -> {ids, domains, openTabs, since}
  let nextId = 1;
  const ready = (async () => {
    try {
      const raw = (await chrome.storage.session.get(key))[key] || {};
      const saved = raw.locks ? raw : { locks: raw, sites: {} }; // (the shape before site locks)
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const have = new Set(rules.map((r) => r.id));
      for (const [s, x] of Object.entries(saved.sites || {})) if (x && Array.isArray(x.ids) && x.ids.every((i) => have.has(i))) sites.set(s, x);
      for (const [tab, l] of Object.entries(saved.locks || {})) {
        if (!l || !Array.isArray(l.ids) || !l.ids.every((i) => have.has(i))) continue;
        if (l.kind === 'site' && !sites.has(l.site)) continue;
        locks.set(Number(tab), { kind: l.parent != null ? 'opened' : 'code', ...l });
      }
      nextId = Math.max(0, ...rules.map((r) => r.id)) + 1;
      // rules no lock owns (a lock record lost): remove them
      const owned = new Set([...[...locks.values()].flatMap((l) => l.ids), ...[...sites.values()].flatMap((x) => x.ids)]);
      const stray = rules.filter((r) => !owned.has(r.id)).map((r) => r.id);
      if (stray.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stray });
    } catch (e) { log(`tab locks: ${e?.message ?? e}`); }
  })();
  const save = () => chrome.storage.session.set({ [key]: { locks: Object.fromEntries(locks), sites: Object.fromEntries(sites) } }).catch(() => {});
  // The tab's toolbar icon: paused while locked. (A tab that's gone, or a browser without per-tab icons:
  // nothing to show it on.)
  // (The callback form: Chrome reports a tab closed meanwhile as an unchecked lastError otherwise.)
  const showIcon = (tabId, paused) => (icon ? Promise.resolve().then(() => icon(tabId, paused)).catch(() => {}) : new Promise((res) => {
    if (!chrome.action?.setIcon) { res(); return; }
    try { chrome.action.setIcon({ tabId, path: paused ? ICONS.paused : ICONS.normal }, () => { void chrome.runtime?.lastError; res(); }); } catch { res(); /* the tab is gone */ }
  }));
  const inIsolated = async (tabId, func, args = []) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func, args, injectImmediately: true });
    return r ? r.result : undefined;
  };

  /** Adds `rules`, then reads back what the browser kept: `ok(kept)` must hold, or they go again. */
  async function addChecked(rules, ok, refusal) {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    const ids = rules.map((r) => r.id);
    const got = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => ids.includes(r.id));
    if (got.length !== ids.length || !ok(new Map(got.map((r) => [r.id, r.condition || {}])))) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});
      throw new Error(refusal);
    }
  }

  async function addRules(tabId, site, domains) {
    if (!site) throw new Error('no site to lock the tab to');
    const ids = [nextId++, nextId++, nextId++, nextId++, nextId++];
    const rules = lockRules(tabId, ids, site, domains);
    // A browser that dropped the per-tab condition would block every tab's requests, and one that dropped
    // the methods would block everything: either way, not what was asked for. Check what it kept.
    await addChecked(rules, (got) => ids.every((id) => same(got.get(id).tabIds, [tabId]))
      && [ids[0], ids[1]].every((id) => same(got.get(id).requestMethods, WRITE_METHODS))
      // (and the site left out of the cross-site rules: without that, the tab couldn't even reload)
      && same(got.get(ids[3]).excludedRequestDomains, [site])
      && same(got.get(ids[4]).excludedRequestDomains, rules[4].condition.excludedRequestDomains),
    "this browser can't block requests for one tab");
    return ids;
  }

  /** The site's rules, and its other tabs locked, if they aren't already. */
  async function lockSite(site, domains) {
    if (sites.has(site)) return;
    const ids = [nextId++, nextId++, nextId++, nextId++, nextId++];
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const openTabs = tabs.map((t) => t.id).filter((id) => Number.isInteger(id) && id >= 0);
    const rules = siteRules(ids, site, domains, openTabs);
    // A browser that dropped the initiator condition would block every site's writes: check.
    await addChecked(rules, (got) => ids.every((id) => same(got.get(id).initiatorDomains, [site]))
      && [ids[0], ids[1]].every((id) => same(got.get(id).requestMethods, WRITE_METHODS))
      && same(got.get(ids[3]).tabIds, [-1]) && same(got.get(ids[3]).excludedRequestDomains, rules[3].condition.excludedRequestDomains)
      && same(got.get(ids[4]).excludedRequestDomains, [site]) && same(got.get(ids[4]).excludedTabIds || [], openTabs),
    "this browser can't block requests a site starts");
    sites.set(site, { ids, domains, openTabs, since: Date.now() });
    log(`locked ${site} in every tab`);
    for (const t of tabs) await adopt(t);
  }

  /** Another tab of a locked site: locked with it (its rules cover the tab; this is the icon and notice). */
  async function adopt(tab) {
    if (!tab || !Number.isInteger(tab.id) || tab.id < 0 || locks.has(tab.id)) return;
    const host = hostOf(tab.url || tab.pendingUrl || '');
    const site = [...sites.keys()].find((s) => inScope(host, s));
    if (!site) return;
    locks.set(tab.id, { token: null, ids: [], site, url: String(tab.url || ''), since: Date.now(), parent: null, kind: 'site' });
    log(`locked tab ${tab.id} too: it's ${site}`);
    await save();
    await showIcon(tab.id, true);
    changed(tab.id);
  }

  /** No tab of the site the agent ran code in is locked any more: the site's rules and its other tabs go. */
  async function releaseSite(site) {
    if ([...locks.values()].some((l) => l.site === site && l.kind === 'code')) return;
    const x = sites.get(site);
    if (!x) return;
    sites.delete(site);
    try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: x.ids }); } catch (e) { log(`unlocking ${site}: ${e?.message ?? e}`); }
    log(`unlocked ${site} in every tab`);
    for (const [id, l] of [...locks]) if (l.kind === 'site' && l.site === site) await unlock(id, `${site} unlocked`);
    await save();
  }

  async function mark(tabId, token) {
    if ((await inIsolated(tabId, setMarker, [token])) !== true) throw new Error("couldn't mark the tab's page");
  }

  /** Lock a tab (or keep it locked, marking its current document too). Throws if it can't. */
  async function lock(tabId, site, parent = null, url = '') {
    await ready;
    let l = locks.get(tabId);
    if (l && l.kind === 'site') { locks.delete(tabId); l = null; } // (agent code there now: a lock of its own)
    if (!l) {
      const found = parent != null ? (locks.get(parent)?.domains || []) : await inIsolated(tabId, loadedDomains).catch(() => []);
      const domains = Array.isArray(found) ? found : [];
      const fp = parent == null ? await inIsolated(tabId, fingerprint).catch(() => null) : null;
      const ids = await addRules(tabId, site, domains);
      l = { token: crypto.randomUUID(), ids, site: site || '', url: String(url || ''), since: Date.now(), parent, kind: parent == null ? 'code' : 'opened', domains, fp: fp || null };
      locks.set(tabId, l);
      log(`locked tab ${tabId}${site ? ` (${site})` : ''}${parent != null ? `, opened by locked tab ${parent}` : ''}`);
      try { await lockSite(site, domains); } catch (e) { await unlock(tabId, 'no site lock'); throw e; }
    }
    try { await mark(tabId, l.token); } catch (e) {
      if (parent == null) { await unlock(tabId, 'no marker'); throw e; }
      // (a tab a locked tab opened may not be scriptable yet: it stays locked while its opener is)
    }
    await save();
    await showIcon(tabId, true);
    changed(tabId);
    return l;
  }

  async function unlock(tabId, why) {
    const l = locks.get(tabId);
    if (!l) return;
    locks.delete(tabId);
    if (l.ids.length) try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: l.ids }); } catch (e) { log(`unlocking tab ${tabId}: ${e?.message ?? e}`); }
    log(`unlocked tab ${tabId}: ${why}`);
    await save();
    if (why !== 'closed' && why !== 'replaced') await showIcon(tabId, false); // (gone: no icon to put back)
    changed(tabId);
    if (l.kind === 'code') await releaseSite(l.site);
    // tabs it opened can go too, once their own page is a new one
    for (const [id, c] of locks) if (c.parent === tabId) check(id).catch(() => {});
  }

  /**
   * A new page in a tab the agent's code ran in (TL-3): what may have been left in the site's storage.
   * Cache Storage or service workers changed: cleared, and a reload past the cache (true: still locked
   * meanwhile). Other saved data changed: a note (once), and the tab unlocks.
   */
  async function settleStorage(tabId, l) {
    const after = await inIsolated(tabId, fingerprint).catch(() => null);
    if (!after) return false;
    const changedParts = Object.keys(l.fp).filter((p) => l.fp[p] != null && after[p] != null && l.fp[p] !== after[p] && !(l.cleared || []).includes(p));
    const clear = changedParts.filter((p) => CLEARED_PARTS.includes(p));
    const note = changedParts.filter((p) => NOTED_PARTS.includes(p));
    if (note.length && !l.noted) {
      l.noted = true;
      log(`tab ${tabId}: ${l.site}'s ${note.join(', ')} changed while the agent's code ran`);
      try { noted(tabId, l.site, note); } catch { /* a note only */ }
    }
    if (!clear.length) return false;
    await mark(tabId, l.token).catch(() => {}); // (this page is the lock's too, until it's cleared)
    const done = await inIsolated(tabId, clearData, [clear]).catch(() => []);
    l.cleared = [...new Set([...(l.cleared || []), ...clear])];
    log(`tab ${tabId}: ${clear.join(' and ')} changed; cleared ${(done || []).join(' and ') || 'nothing'}`);
    await save();
    await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
    return true;
  }

  // The tab's document changed (or may have): unlock if it's a new one without the agent's code.
  async function check(tabId) {
    await ready;
    const l = locks.get(tabId);
    if (!l) return;
    if (l.kind === 'site') {
      // another tab of a locked site: locked while it's on the site
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (t && !inScope(hostOf(t.url || t.pendingUrl || ''), l.site)) await unlock(tabId, 'left the site');
      else if (t) await showIcon(tabId, true);
      return;
    }
    if (l.parent != null && locks.has(l.parent)) { await mark(tabId, l.token).catch(() => {}); await showIcon(tabId, true); return; } // (still within reach of locked code)
    let marked;
    try { marked = await inIsolated(tabId, hasMarker, [l.token]) === true; } catch { marked = null; } // (a page the extension can't script: nothing of the agent's there; stay locked until a page it can check)
    if (marked === false) {
      if (l.kind === 'code' && l.fp && await settleStorage(tabId, l)) return;
      await unlock(tabId, 'a new page');
    } else await showIcon(tabId, true); // (still locked: the icon again, in case a new page in the tab reset it)
  }

  return {
    ready, lock, unlock, check,
    isLocked: (tabId) => locks.has(tabId),
    // (url: the page it was locked on, for the panel's button: a tab sent to another site shows the
    // browser's "blocked" page, and reloading that only asks for the blocked address again)
    list: () => [...locks.entries()].map(([tabId, l]) => ({
      tabId, site: l.site, url: l.url || '', since: l.since, kind: l.kind,
      ...(l.kind === 'site' ? { from: [...locks.entries()].find(([, c]) => c.kind === 'code' && c.site === l.site)?.[0] ?? null } : {}),
    })),
    /** A document back from the back/forward cache with its marker: lock its tab again. */
    async restored(tabId, token, site, url) {
      await ready;
      if (locks.has(tabId) && locks.get(tabId).kind !== 'site') return;
      if (typeof token !== 'string' || !token || !site) return; // (only the marker, in our isolated world, sends this)
      locks.delete(tabId);
      const ids = await addRules(tabId, site, []);
      locks.set(tabId, { token, ids, site, url: String(url || ''), since: Date.now(), parent: null, kind: 'code', domains: [], fp: null });
      try { await lockSite(site, []); } catch (e) { log(`couldn't lock ${site} in every tab: ${e?.message ?? e}`); }
      await save();
      await showIcon(tabId, true);
      changed(tabId);
      log(`locked tab ${tabId} again: a locked page came back from the back/forward cache`);
    },
    async opened(tab) {
      await ready;
      const p = tab.openerTabId != null && locks.get(tab.openerTabId);
      if (p && p.kind !== 'site') await lock(tab.id, p.site, tab.openerTabId, p.url).catch((e) => log(`couldn't lock tab ${tab.id}: ${e?.message ?? e}`));
      else await adopt(tab);
    },
    /** A tab's address changed: a tab of a locked site is locked too. */
    async seen(tab) { await ready; await adopt(tab); },
  };
}
