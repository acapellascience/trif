// The phone view: "Edit for mobile" (docs/MOBILE-EDIT.md). The panel's tab moves into a phone-sized window of
// its own, where the site sees an iPhone: Safari's user agent and no client hints in every request the tab
// makes (declarativeNetRequest session rules for that tab only), and touch, an iPhone's screen and no hover in
// the page's JavaScript (phone-page.js, in the page's own world before the site's scripts). TRIF's panel
// opens beside it, following that window, so the chat, the agent's commands and its screenshots work on the
// phone layout. "Back to desktop" puts the tab back where it was, as a desktop tab again.
//
// Why the tab itself moves, not a copy: Chrome lets TRIF capture a tab only with <all_urls> or activeTab, which
// comes from the toolbar click on that tab, and a phone window has no toolbar. A tab keeps activeTab when it
// moves to another window and on reloads and pages of the same origin (checked in Chrome 156), so the agent's
// `trif screenshot` of the phone works without any new permission.
//
// No new permission: declarativeNetRequest, scripting, tabs and the site's own access are what TRIF has. What
// the browser's debugger would add (CSS hover and pointer media queries, the viewport meta tag, workers) is
// in docs/MOBILE-EDIT.md "The debugger route".
//
// The page script has to know, synchronously and before any of the site's code, that its document is in the
// phone tab: the rules add a `Server-Timing: trif-phone` entry to the tab's page and frame responses, which
// the script reads from the Performance timeline. Pages in other tabs don't get it, so they're left alone.

/** What the site is told it's on: Safari on an iPhone 15 (what TRIF's iPhone app's web view says it is). */
export const PHONE = Object.freeze({
  name: 'iPhone',
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  screen: Object.freeze({ width: 390, height: 844 }),
  // (the page's part of the screen in Safari, its bars shown: what the window's page area is made, when the
  // screen has room)
  viewport: Object.freeze({ width: 390, height: 750 }),
  minHeight: 480,
});

/** Where the phone view's search field searches when what's typed isn't an address: Safari's default on an iPhone. */
export const SEARCH = 'https://www.google.com/search?q=';

/**
 * Where the phone view's address field goes (the panel's navigation bar: the phone window has no address bar
 * of its own): an http(s) address as typed; a bare host ("x.com", "localhost:3000", "x.com/home"), https (http
 * for localhost and an IP address); anything else, a search. Never another scheme (javascript:, file:,
 * chrome:…): that's searched for, as text. null for nothing.
 */
export function navTarget(text) {
  const t = String(text ?? '').trim().slice(0, 2048);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try { const u = new URL(t); if (u.protocol === 'http:' || u.protocol === 'https:') return u.href; } catch { /* searched for */ }
  }
  const m = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9])(:\d{1,5})?([/?#]\S*)?$/i.exec(t);
  if (m) {
    const local = /^(localhost|\[|\d)/i.test(m[1]);
    try { return new URL(`${local ? 'http' : 'https'}://${t}`).href; } catch { /* searched for */ }
  }
  return SEARCH + encodeURIComponent(t);
}

// Rule ids from here up are the phone view's; tablock.js leaves them alone (createTabLocks `foreign`).
export const RULE_BASE = 1_000_000;
export const isPhoneRule = (id) => Number(id) >= RULE_BASE;

export const MARK = 'trif-phone';
export const SCRIPT_ID = 'trif-phone';

// Every client hint header Chrome may send (Safari sends none): removed from the phone tab's requests.
export const CLIENT_HINTS = [
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version', 'sec-ch-ua-model',
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-arch', 'sec-ch-ua-bitness',
  'sec-ch-ua-wow64', 'sec-ch-ua-form-factors',
];

// Without `resourceTypes` a rule matches everything but main_frame: the page itself is the request that
// matters most (a server choosing its mobile page), so every type is named.
export const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest',
  'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

/**
 * The phone tab's rules: Safari's user agent and no client hints on everything it requests, and the marker
 * on its documents. (Firefox sends no client hints; removing headers that aren't there is harmless.)
 * `types`: the resource types this browser knows (Firefox has no webtransport or webbundle).
 */
export function phoneRules(tabId, ids, { ua = PHONE.ua, types = ALL_TYPES } = {}) {
  return [
    {
      id: ids[0], priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: ua }, ...CLIENT_HINTS.map((header) => ({ header, operation: 'remove' }))] },
      condition: { tabIds: [tabId], resourceTypes: types },
    },
    {
      id: ids[1], priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'server-timing', operation: 'append', value: MARK }] },
      condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] },
    },
  ];
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Where the phone window goes and how big it is. `frame`: the window's own parts around the page (outer size
 * minus the page's, {width, height}; a guess before it's measured). `screen`: the usable part of the screen
 * the user's window is on ({left, top, width, height}, from the panel, or null). `home`: the user's window.
 * The page area is PHONE.viewport when the screen has room; on a short screen it's as tall as fits (a phone
 * with less room under Safari's bars), never under PHONE.minHeight. Its left edge is the user's window's,
 * and its top the screen's, so the panel window has room beside it.
 */
export function phoneBounds({ frame = { width: 0, height: 0 }, screen = null, home = null, viewport = PHONE.viewport } = {}) {
  const fw = finite(frame.width) ? Math.max(0, frame.width) : 0;
  const fh = finite(frame.height) ? Math.max(0, frame.height) : 0;
  const width = Math.round(viewport.width + fw);
  let height = Math.round(viewport.height + fh);
  const out = { width, height };
  const s = screen && finite(screen.width) && finite(screen.height) && screen.width > 0 && screen.height > 0 ? screen : null;
  if (s) {
    height = Math.max(Math.round(PHONE.minHeight + fh), Math.min(height, Math.round(s.height)));
    out.height = height;
    const left = finite(home?.left) ? home.left : s.left;
    out.left = Math.round(Math.max(s.left, Math.min(left, s.left + s.width - width)));
    out.top = Math.round(s.top);
  } else if (finite(home?.left) && finite(home?.top)) {
    out.left = Math.round(home.left);
    out.top = Math.round(home.top);
  }
  return out;
}

// The window's parts around the page before they're measured: Chrome's popup window on macOS (a title bar
// and the address line). Corrected from the real window right after it opens.
const FRAME_GUESS = { width: 0, height: 62 };

const BOUNDS = ['left', 'top', 'width', 'height'];

/** A tab's page size, as the page itself sees it (the isolated world: the page script doesn't reach it). */
async function pageSize(chrome, tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => ({ w: innerWidth, h: innerHeight }), injectImmediately: true });
    return r?.result && r.result.w > 0 ? r.result : null;
  } catch { return null; }
}

/**
 * The window's bounds and its page's size once they agree: the same in two looks in a row. Right after the
 * tab moves (or the window is resized) the page can still have its old window's size, or one on the way, for
 * a moment, longer on a busy machine: a frame measured from that is wrong, and so is the window sized by it
 * (CI, on a busy runner: a 776 x 813 page). null if the page can't be measured.
 */
async function settled(chrome, tabId, windowId, pause) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    const win = await chrome.windows.get(windowId).catch(() => null);
    const size = await pageSize(chrome, tabId);
    if (!win || !size) return null;
    const now = { win, size };
    if (last && BOUNDS.every((k) => last.win[k] === win[k]) && last.size.w === size.w && last.size.h === size.h) return now;
    last = now;
    await new Promise((r) => setTimeout(r, pause));
  }
  return last;
}

/**
 * Makes phone window `windowId`'s page area (tab `tabId`'s) the phone's: the window's parts measured, the
 * window resized, then measured again until it's right (a look taken while the page still had another size is
 * corrected there), a few rounds at most. `screen`, `home`: as phoneBounds takes them. Returns the page's
 * size, {w, h}, or null if it can't be measured yet. `pause`: ms between looks.
 */
export async function fitPhoneWindow({ chrome, tabId, windowId, screen = null, home = null, log = () => {}, pause = 100 }) {
  let before = null;
  for (let round = 0; round < 4; round++) {
    const m = await settled(chrome, tabId, windowId, pause);
    if (!m) return null;
    const frame = { width: m.win.width - m.size.w, height: m.win.height - m.size.h };
    const want = phoneBounds({ frame, screen, home });
    if (!BOUNDS.some((k) => finite(want[k]) && Math.abs(want[k] - m.win[k]) > 1)) return m.size;
    // (the browser kept the window as it was though asked last round: it won't go there, so this is as close as it gets)
    if (before && BOUNDS.every((k) => before[k] === m.win[k])) return m.size;
    before = m.win;
    await chrome.windows.update(windowId, want).catch((e) => log(`phone window: ${e?.message ?? e}`));
    // (the page takes the new size a moment later: until its size changes, or 15 looks)
    for (let i = 0; i < 15; i++) {
      const now = await pageSize(chrome, tabId);
      if (now && (now.w !== m.size.w || now.h !== m.size.h)) break;
      await new Promise((r) => setTimeout(r, pause));
    }
  }
  return pageSize(chrome, tabId);
}

/**
 * The phone views of this browser, kept in session storage (`phones`) across service worker restarts: tab id
 * -> {window, home: {windowId, index}, ids, site, since}. Listeners are added by `listen()`.
 * `firefox`: Firefox's resource types; `panelUrl(windowId)`: the panel window's address for a window.
 */
export function createPhones({ chrome, log = () => {}, changed = () => {}, panelUrl = null, firefox = false }) {
  const phones = new Map();
  const KEY = 'phones';
  const types = firefox ? ALL_TYPES.filter((t) => t !== 'webtransport' && t !== 'webbundle') : ALL_TYPES;
  const ready = (async () => {
    try {
      const saved = (await chrome.storage.session.get(KEY))[KEY] || {};
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const have = new Set(rules.map((r) => r.id));
      for (const [tab, p] of Object.entries(saved)) if (p && Array.isArray(p.ids) && p.ids.every((i) => have.has(i))) phones.set(Number(tab), p);
      // (a tab that's gone while the worker slept)
      for (const id of [...phones.keys()]) { if (!(await chrome.tabs.get(id).catch(() => null))) await forget(id); }
      // rules of the phone view no phone owns (its record lost): removed
      const owned = new Set([...phones.values()].flatMap((p) => p.ids));
      const stray = rules.filter((r) => isPhoneRule(r.id) && !owned.has(r.id)).map((r) => r.id);
      if (stray.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stray });
      if (!phones.size) await unregister();
    } catch (e) { log(`phone view: ${e?.message ?? e}`); }
  })();
  const save = () => chrome.storage.session.set({ [KEY]: Object.fromEntries(phones) }).catch(() => {});

  async function freeIds() {
    const used = new Set((await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id));
    const out = [];
    for (let id = RULE_BASE; out.length < 2; id++) if (!used.has(id)) out.push(id);
    return out;
  }

  // The page script: registered while any phone is open (only the phone tab's pages carry the marker it looks
  // for), in every frame, on every site TRIF has access to (it only runs where it has).
  async function register() {
    const there = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
    if (there.length) return;
    const base = { id: SCRIPT_ID, js: ['phone-page.js'], runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: false };
    try {
      await chrome.scripting.registerContentScripts([{ ...base, matches: ['<all_urls>'], matchOriginAsFallback: true }]);
    } catch (e) {
      // (a browser without matchOriginAsFallback)
      log(`phone view: the page script with about:blank frames didn't register (${e?.message ?? e}); without them`);
      await chrome.scripting.registerContentScripts([{ ...base, matches: ['<all_urls>'] }]);
    }
  }
  async function unregister() {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  }

  async function forget(tabId) {
    const p = phones.get(tabId);
    phones.delete(tabId);
    if (p?.ids?.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: p.ids }).catch((e) => log(`phone rules: ${e?.message ?? e}`));
    save();
    if (!phones.size) await unregister();
  }

  /**
   * What's in place for phone tab `tabId` (the panel's console line, `trif tabs`): its rules, the page script,
   * and whether the page showing has the marker (the rules reached its document) and a service worker.
   */
  async function check(tabId) {
    const p = phones.get(tabId);
    if (!p) return { phone: false };
    const rules = (await chrome.declarativeNetRequest.getSessionRules().catch(() => [])).filter((r) => p.ids.includes(r.id)).length;
    const script = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => [])).length > 0;
    let page = null;
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] }, world: 'ISOLATED', injectImmediately: true, args: [MARK],
        func: (mark) => {
          const nav = performance.getEntriesByType('navigation')[0];
          return { url: location.href, marked: !!nav?.serverTiming?.some((e) => e.name === mark), worker: !!navigator.serviceWorker?.controller };
        },
      });
      page = r?.result || null;
    } catch (e) { page = { error: String(e?.message ?? e) }; }
    return { phone: true, rules, script, page };
  }

  // A page in the phone tab that came without the marker (a service worker served it, or the HTTP cache: a
  // reload, a link to another page of the site): loaded again, hard, once per address in a while.
  const healed = new Map(); // tabId -> {url, at}
  async function heal(tabId, url) {
    if (!/^https?:/.test(url || '')) return;
    const h = healed.get(tabId);
    if (h && h.url === url && Date.now() - h.at < 15000) return;
    const c = await check(tabId);
    if (!c.phone || !c.page || c.page.error || c.page.marked || c.page.url !== url) return;
    const u = new URL(url);
    if (!(await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] }).catch(() => false))) {
      log(`phone view, tab ${tabId}: no access to ${u.hostname}, so it sees a desktop there`);
      return;
    }
    healed.set(tabId, { url, at: Date.now() });
    log(`phone view, tab ${tabId}: ${url} came without the phone's rules${c.page.worker ? ' (its service worker served it)' : ''}: loading it again past the worker and the cache`);
    await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
  }

  return {
    ready,
    check: (tabId) => ready.then(() => check(Number(tabId))),
    isPhone: (tabId) => phones.has(Number(tabId)),
    get: (tabId) => phones.get(Number(tabId)) || null,
    windows: () => [...phones.values()].map((p) => p.window),
    tabs: () => [...phones.keys()],

    /**
     * Tab `tabId` into a phone window. `screen`: the usable screen the panel is on, `site`: the panel's site.
     * Returns {window, viewport: the page's size}. Throws when the tab can't be (not a web page, no access).
     */
    async open(tabId, { screen = null, site = '', panel = true } = {}) {
      await ready;
      tabId = Number(tabId);
      if (phones.has(tabId)) {
        const p = phones.get(tabId);
        await chrome.windows.update(p.window, { focused: true }).catch(() => {});
        return { window: p.window, already: true };
      }
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || tab.pendingUrl || '';
      if (!/^https?:/.test(url)) throw new Error('the phone view is for web pages');
      // (no port: Firefox's patterns don't take one, and access to a host is for every port)
      const origin = `${new URL(url).protocol}//${new URL(url).hostname}/*`;
      if (!(await chrome.permissions.contains({ origins: [origin] }).catch(() => false))) throw new Error(`TRIF has no access to ${new URL(url).hostname}: connect it first`);
      const home = await chrome.windows.get(tab.windowId).catch(() => null);
      const ids = await freeIds();
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: phoneRules(tabId, ids, { types }) });
      // (the browser kept them as asked: per tab, or not at all)
      const got = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => ids.includes(r.id));
      if (got.length !== 2 || !got.every((r) => JSON.stringify(r.condition?.tabIds) === JSON.stringify([tabId]))) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});
        throw new Error("this browser didn't keep the phone view's rules to one tab");
      }
      const p = { window: null, home: { windowId: tab.windowId, index: tab.index }, ids, site, since: Date.now() };
      phones.set(tabId, p);
      save();
      try {
        await register();
        const bounds = phoneBounds({ frame: FRAME_GUESS, screen, home });
        const win = await chrome.windows.create({ tabId, type: 'popup', focused: true, ...bounds });
        p.window = win.id;
        save();
        // (the window measured on the page it has, and resized, before the reload: so the phone page loads at
        // the phone's size from its first script)
        let viewport = null;
        for (let i = 0; i < 20 && !viewport; i++) {
          viewport = await fitPhoneWindow({ chrome, tabId, windowId: win.id, screen, home, log });
          if (!viewport) await new Promise((r) => setTimeout(r, 150));
        }
        // A hard reload: past the HTTP cache and the site's service worker. A page a service worker serves (X
        // has one) comes from the worker's own request, which belongs to no tab (tabId -1): the tab's rules
        // never see it, so the server would get the desktop user agent and the page no marker. A hard reload
        // skips the worker for that load, and leaves the page uncontrolled, so its own requests are the tab's.
        await chrome.tabs.reload(tabId, { bypassCache: true });
        if (panel && panelUrl) {
          const pw = await chrome.windows.get(win.id).catch(() => null);
          const pb = pw ? { left: pw.left + pw.width, top: pw.top, width: 420, height: pw.height } : {};
          await chrome.windows.create({ url: panelUrl(win.id), type: 'popup', focused: false, ...pb })
            .catch(() => chrome.windows.create({ url: panelUrl(win.id), type: 'popup', focused: false }))
            .catch((e) => log(`phone panel: ${e?.message ?? e}`));
        }
        changed();
        return { window: win.id, viewport };
      } catch (e) {
        await forget(tabId);
        throw e;
      }
    },

    /** Back to desktop: the tab back in its window, where it was, as a desktop tab (reloaded). */
    async close(tabId, { reload = true } = {}) {
      await ready;
      tabId = Number(tabId);
      const p = phones.get(tabId);
      if (!p) return { back: false };
      await forget(tabId);
      let windowId = p.home?.windowId;
      const home = windowId != null ? await chrome.windows.get(windowId).catch(() => null) : null;
      try {
        // (a browser that won't move a tab out of a popup, as Firefox's documentation says: an ordinary window of its own)
        const moved = home ? await chrome.tabs.move(tabId, { windowId, index: Number.isInteger(p.home.index) ? p.home.index : -1 }).then(() => true, (e) => { log(`back to desktop: ${e?.message ?? e}`); return false; }) : false;
        if (!moved) windowId = (await chrome.windows.create({ tabId, type: 'normal', focused: true })).id;
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
      } catch (e) { log(`back to desktop: ${e?.message ?? e}`); }
      if (reload) await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {}); // (past the worker and the cache, as open)
      changed();
      return { back: true, window: windowId };
    },

    /** The browser's events: a phone window closed (its tab with it), a phone tab closed. */
    listen() {
      chrome.tabs?.onUpdated?.addListener((tabId, info, tab) => {
        if (info.status === 'complete' && phones.has(tabId)) ready.then(() => heal(tabId, tab?.url || '')).catch(() => {});
      });
      chrome.tabs?.onRemoved?.addListener((tabId) => { if (phones.has(tabId)) ready.then(() => forget(tabId)).then(changed).catch(() => {}); });
      chrome.windows?.onRemoved?.addListener((windowId) => {
        for (const [tabId, p] of phones) if (p.window === windowId) ready.then(() => forget(tabId)).then(changed).catch(() => {});
        healed.clear();
      });
    },
  };
}
