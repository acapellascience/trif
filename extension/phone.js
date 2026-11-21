// The phone view: "Edit for mobile" (docs/MOBILE-EDIT.md). The panel's tab moves into a window of its own, where
// the site sees an iPhone: Safari's user agent and no client hints in every request the tab makes
// (declarativeNetRequest session rules for that tab only), and touch, an iPhone's screen and no hover in the
// page's JavaScript (phone-page.js, in the page's own world before the site's scripts). "Back to desktop" puts
// the tab back where it was, as a desktop tab again.
//
// The window (2026-11-18, after Tim tried it): an ORDINARY browser window, sized so its page area is the
// phone's 390 px with TRIF's side panel (Chrome) or sidebar (Firefox) open beside the page. So the phone view
// has the browser's own address bar, back, forward and reload, TRIF's toolbar button, and TRIF's real panel.
// The width is measured, not guessed: the window's parts (its frame and the panel) are the window's width less
// the page's, as the page itself sees it, and the window is corrected by the difference (fitPhoneWindow). When
// the person resizes the panel or the window, the page tells TRIF (a resize listener in TRIF's isolated world)
// and the width is corrected again. The browser keeps an ordinary window from going narrower than its own
// minimum (about 500 px without a panel, and in headless Chrome 156 792 px with the side panel, so a 406 px
// page): then the page is as narrow as the window goes, and the panel says how wide it is.
//
// TRIF's panel in that window: Chrome's sidePanel.open needs a user gesture, and the 📱 menu's click is one in
// the panel that made it, for about five seconds (its transient activation: checked in Chrome 156, refused
// after 6 s and without a click), so that panel opens the side panel in the new window itself (sidepanel.js
// togglePhone). Firefox's sidebarAction.open takes no window and only works synchronously inside the click
// handler, before the new window exists (it then opens in the window clicked in): there, and whenever the
// open fails, the window opens at phone width and the panel that asked says to click TRIF's button in it.
// A tab alone in its window (11-19) doesn't move: that window itself is made phone-sized, its side panel or
// sidebar staying open (moving a window's last tab out closes the window and the panel in it, which then can't
// open anything), and Back to desktop gives it its size back. Back to desktop (11-20) expands any phone window
// back out, the tab staying in it with TRIF's panel beside it, to the size of the window the tab came from.
//
// The popup route (the design before 11-18), kept for browsers with no side panel (Arc: the panel in a window,
// `state.panelInWindow`, or a request from such a panel window): a phone-sized popup, which an ordinary window
// can't be, with TRIF's panel in a popup window beside it, and in its banner a navigation bar standing in for
// the address bar the popup doesn't have (background.js phone.nav). phoneRoute says which a browser gets.
//
// Why the tab itself moves, not a copy: Chrome lets TRIF capture a tab only with <all_urls> or activeTab, which
// comes from the toolbar click on that tab. A tab keeps activeTab when it moves to another window and on
// reloads and pages of the same origin (checked in Chrome 156), so the agent's `trif screenshot` of the phone
// works without any new permission (in the ordinary window a toolbar click there gives it too).
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
 * Which phone view a browser gets: 'window' (an ordinary window, its address bar and TRIF's side panel or
 * sidebar beside the page), or 'popup' (a phone-sized popup and TRIF's panel in a window beside it, with the
 * panel's navigation bar) where the browser has no side panel: Arc (`panelInWindow`, remembered from a
 * toolbar click that showed none, or a request from a panel window, `fromPanelWindow`), or a Chromium without
 * chrome.sidePanel. Firefox always has its sidebar.
 */
export function phoneRoute({ firefox = false, sidePanel = false, panelInWindow = false, fromPanelWindow = false } = {}) {
  if (firefox) return 'window';
  return sidePanel && !panelInWindow && !fromPanelWindow ? 'window' : 'popup';
}

/**
 * Where the phone view's address field goes (the popup route's navigation bar, in the panel: a popup has no
 * address bar of its own): an http(s) address as typed; a bare host ("x.com", "localhost:3000", "x.com/home"), https (http
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
// An ordinary window's: the side panel or sidebar beside the page (Chrome's is about 320–390 px, Firefox's
// sidebar about 280–340), the tab strip and the toolbar above it. Corrected the same way.
const WINDOW_FRAME_GUESS = { width: 360, height: 90 };

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
 * corrected there), a few rounds at most. `screen`, `home`: as phoneBounds takes them; `widthOnly`: the width
 * alone, the window left where it is and as tall as it is. Returns the page's size, {w, h}, or null if it can't
 * be measured yet. `pause`: ms between looks.
 */
export async function fitPhoneWindow({ chrome, tabId, windowId, screen = null, home = null, log = () => {}, pause = 100, widthOnly = false, live = () => true }) {
  let before = null;
  for (let round = 0; round < 4; round++) {
    const m = await settled(chrome, tabId, windowId, pause);
    if (!m) return null;
    // (the phone view ended meanwhile, Back to desktop expanding the window back out: left as it is now)
    if (!live()) return m.size;
    // (a maximized, full-screen or minimized window is the person's choice: left as it is)
    if (m.win.state && m.win.state !== 'normal') return m.size;
    const frame = { width: m.win.width - m.size.w, height: m.win.height - m.size.h };
    // (widthOnly: correcting a window the person has moved or made taller: only its width, where it is)
    const want = widthOnly ? { width: phoneBounds({ frame }).width } : phoneBounds({ frame, screen, home });
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
  const settling = new Map(); // tabId -> the window route's settling (fit and reload), once
  const goes = new Map();     // tabId -> what lets it start (the panel's phone.settle, or a timeout)
  const fitting = new Map();  // tabId -> a width correction under way
  const again = new Set();    // tabs resized again while one was under way
  const moving = new Set();   // tabs TRIF itself is moving (into the phone window and back)
  const KEY = 'phones';
  const types = firefox ? ALL_TYPES.filter((t) => t !== 'webtransport' && t !== 'webbundle') : ALL_TYPES;
  const ready = (async () => {
    try {
      const saved = (await chrome.storage.session.get(KEY))[KEY] || {};
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const have = new Set(rules.map((r) => r.id));
      for (const [tab, p] of Object.entries(saved)) if (p && Array.isArray(p.ids) && p.ids.every((i) => have.has(i))) phones.set(Number(tab), p);
      // (a window route's settling cut short by the worker's restart: as fitted as it got; corrected from here on)
      for (const p of phones.values()) if (p.route === 'window') p.settled = true;
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
    settling.delete(tabId); goes.delete(tabId); again.delete(tabId);
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
  // reload, a link to another page of the site): loaded again, hard. Once per address while that doesn't help:
  // a page that comes back marked ends it, so the next load the worker serves is healed again (11-20, Tim on X:
  // the reload after a mod's approval, seconds after the one after its edit, came back the desktop's: X's
  // service worker served it, and the second heal for that address within 15 s was skipped).
  const healed = new Map(); // tabId -> {url, at}: a heal whose load hasn't come back marked yet
  async function heal(tabId, url) {
    if (!/^https?:/.test(url || '')) return;
    const c = await check(tabId);
    if (!c.phone || !c.page || c.page.error) return;
    if (c.page.marked) { healed.delete(tabId); return; }
    if (c.page.url !== url) return;
    const h = healed.get(tabId);
    if (h && h.url === url && Date.now() - h.at < 15000) return; // (healed, and still without: not again and again)
    const u = new URL(url);
    if (!(await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] }).catch(() => false))) {
      log(`phone view, tab ${tabId}: no access to ${u.hostname}, so it sees a desktop there`);
      return;
    }
    healed.set(tabId, { url, at: Date.now() });
    log(`phone view, tab ${tabId}: ${url} came without the phone's rules${c.page.worker ? ' (its service worker served it)' : ''}: loading it again past the worker and the cache`);
    await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
  }

  // The ordinary window's width, kept right: the page tells TRIF when its size changes (the person resized the
  // panel or the window, or the panel opened or closed), from TRIF's isolated world, where the site can't
  // reach it, and only for the browser's own resize events. Put in each page of the phone tab as it loads.
  async function watchSize(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] }, world: 'ISOLATED', injectImmediately: true,
      func: () => {
        if (globalThis.__trifPhoneSize) return;
        globalThis.__trifPhoneSize = true;
        let timer = 0;
        addEventListener('resize', (e) => {
          if (!e.isTrusted) return;
          clearTimeout(timer);
          timer = setTimeout(() => { try { chrome.runtime.sendMessage({ type: 'phone.resized' }).catch(() => {}); } catch { /* TRIF reloaded */ } }, 250);
        });
      },
    }).catch(() => {});
  }


  /** The window route's second half: the panel's page laid out, the window fitted, the page loaded as a phone's. */
  function settleWindow(tabId, p) {
    if (settling.has(tabId)) return settling.get(tabId);
    let go;
    const started = new Promise((r) => { go = r; });
    goes.set(tabId, go);
    // (no word from the panel that asked, closed meanwhile, say: on its own, without waiting for a panel)
    const timer = setTimeout(() => go({ panel: null }), 8000);
    const run = (async () => {
      const { panel } = await started;
      clearTimeout(timer);
      goes.delete(tabId);
      // (the side panel or sidebar opened: until it's there, so the page's width is the one it will have)
      let shown = false;
      for (let i = 0; i < 30 && panel; i++) { if (panel()) { shown = true; break; } await new Promise((r) => setTimeout(r, 100)); }
      if (!phones.has(tabId)) return { window: p.window, viewport: null, panel: shown };
      let viewport = null;
      for (let i = 0; i < 20 && !viewport; i++) {
        viewport = await fitPhoneWindow({ chrome, tabId, windowId: p.window, screen: p.screen || null, home: p.homeBounds || null, log, live: () => phones.has(tabId) });
        if (!viewport) await new Promise((r) => setTimeout(r, 150));
      }
      if (viewport) { p.width = viewport.w; save(); }
      // (a hard reload, as the popup route's: past the HTTP cache and the site's service worker; see open)
      await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
      changed();
      return { window: p.window, viewport, panel: shown };
    })();
    settling.set(tabId, run);
    run.finally(() => { p.settled = true; save(); }).catch(() => {});
    return run;
  }

  /** The page's size changed: the window's width corrected (debounced by the page; one at a time). */
  async function refit(tabId) {
    const p = phones.get(tabId);
    if (!p || p.route !== 'window' || !p.settled || p.window == null) return;
    if (fitting.has(tabId)) { again.add(tabId); return; }
    const run = (async () => {
      try {
        do {
          again.delete(tabId);
          const size = await fitPhoneWindow({ chrome, tabId, windowId: p.window, log, widthOnly: true, live: () => phones.has(tabId) });
          if (size && size.w !== p.width) { p.width = size.w; save(); changed(); }
        } while (again.has(tabId) && phones.has(tabId));
      } catch (e) { log(`phone window: ${e?.message ?? e}`); }
    })();
    fitting.set(tabId, run);
    await run;
    fitting.delete(tabId);
  }

  return {
    ready,
    check: (tabId) => ready.then(() => check(Number(tabId))),
    isPhone: (tabId) => phones.has(Number(tabId)),
    get: (tabId) => phones.get(Number(tabId)) || null,
    windows: () => [...phones.values()].map((p) => p.window),
    tabs: () => [...phones.keys()],
    /** The phone window `windowId` is one: its tab's id, or null. */
    tabOfWindow: (windowId) => { for (const [id, p] of phones) if (p.window === windowId) return id; return null; },

    /**
     * Tab `tabId` into a phone window. `screen`: the usable screen the panel is on, `site`: the panel's site,
     * `route`: phoneRoute's. Throws when the tab can't be (not a web page, no access).
     * The window route returns as soon as the window is there, {window, route: 'window'}, so the panel that
     * asked can open its side panel in it within its click's gesture; then settle() fits it. The popup route
     * returns when it's done: {window, route: 'popup', viewport: the page's size}.
     */
    async open(tabId, { screen = null, site = '', panel = true, route = 'popup' } = {}) {
      await ready;
      tabId = Number(tabId);
      if (phones.has(tabId)) {
        const p = phones.get(tabId);
        await chrome.windows.update(p.window, { focused: true }).catch(() => {});
        return { window: p.window, route: p.route || 'popup', already: true };
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
      const p = { window: null, home: { windowId: tab.windowId, index: tab.index }, ids, site, since: Date.now(), route };
      phones.set(tabId, p);
      save();
      try {
        await register();
        if (route === 'window') {
          p.screen = screen;
          p.homeBounds = home ? { left: home.left, top: home.top } : null;
          // The tab alone in an ordinary window: that window becomes the phone's, made phone-sized (settle), not a
          // new one. Moving a window's last tab out closes the window, and the panel that asked with it, before it
          // can open TRIF's side panel in the new one (Tim, 11-19, google.com in a window of its own: "resizes the
          // window but doesn't reopen the panel"). Its side panel or sidebar is there already and stays; Back to
          // desktop gives the window its size back (`restore`).
          const alone = home?.type === 'normal' && (await chrome.tabs.query({ windowId: tab.windowId }).catch(() => [])).length === 1;
          if (alone) {
            p.window = tab.windowId;
            p.same = true;
            p.restore = { left: home.left, top: home.top, width: home.width, height: home.height, state: home.state || 'normal' };
            // (maximized or full screen: an ordinary window first, as fitPhoneWindow leaves the others as they are)
            if (home.state && home.state !== 'normal') {
              await chrome.windows.update(tab.windowId, { state: 'normal' }).catch((e) => log(`phone window: ${e?.message ?? e}`));
              for (let i = 0; i < 30; i++) {
                const w = await chrome.windows.get(tab.windowId).catch(() => null);
                if (!w || w.state === 'normal') break;
                await new Promise((r) => setTimeout(r, 100));
              }
            }
            save();
            settleWindow(tabId, p);
            changed();
            return { window: p.window, route, same: true };
          }
          const bounds = phoneBounds({ frame: WINDOW_FRAME_GUESS, screen, home });
          // (what Back to desktop expands the phone window back out to, should the window it came from be gone)
          if (home) p.restore = { left: home.left, top: home.top, width: home.width, height: home.height, state: home.state || 'normal' };
          moving.add(tabId);
          let win;
          try {
            win = await chrome.windows.create({ tabId, type: 'normal', focused: true, ...bounds })
              .catch(() => chrome.windows.create({ tabId, type: 'normal', focused: true }));
          } finally { moving.delete(tabId); }
          p.window = win.id;
          save();
          settleWindow(tabId, p);
          changed();
          return { window: win.id, route };
        }
        const bounds = phoneBounds({ frame: FRAME_GUESS, screen, home });
        moving.add(tabId);
        let win;
        try { win = await chrome.windows.create({ tabId, type: 'popup', focused: true, ...bounds }); } finally { moving.delete(tabId); }
        p.window = win.id;
        save();
        // (the window measured on the page it has, and resized, before the reload: so the phone page loads at
        // the phone's size from its first script)
        let viewport = null;
        for (let i = 0; i < 20 && !viewport; i++) {
          viewport = await fitPhoneWindow({ chrome, tabId, windowId: win.id, screen, home, log, live: () => phones.has(tabId) });
          if (!viewport) await new Promise((r) => setTimeout(r, 150));
        }
        if (viewport) { p.width = viewport.w; save(); }
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
        return { window: win.id, route, viewport };
      } catch (e) {
        await forget(tabId);
        throw e;
      }
    },

    /**
     * The window route, after open: `panel` says whether the panel that asked opened TRIF's side panel there,
     * `shown()` whether it's there now (the background's record of the panels). Waits for it (3 s at most),
     * fits the window and loads the page as the phone's. {window, viewport, panel: whether the panel is there}.
     */
    async settle(tabId, { panel = false, shown = () => false } = {}) {
      await ready;
      tabId = Number(tabId);
      const p = phones.get(tabId);
      if (!p) throw new Error('that tab isn\'t in the phone view');
      if (p.route !== 'window') return { window: p.window, viewport: p.width ? { w: p.width } : null, panel: false };
      const run = settleWindow(tabId, p);
      goes.get(tabId)?.({ panel: panel ? shown : null });
      const r = await run;
      // (shown after all, by now: a toolbar click in the phone window, say)
      return { ...r, panel: r.panel || !!shown() };
    },

    /**
     * Reloads a tab as TRIF does (`trif reload`, `trif verify`, a mod switched or approved): a phone tab past
     * its service worker and the HTTP cache, so its page comes with the phone's rules and marker (a page a
     * worker serves has neither: heal loads it again, a second load), any other tab as asked.
     */
    async reload(tabId, { bypassCache = false } = {}) {
      tabId = Number(tabId);
      await ready;
      return chrome.tabs.reload(tabId, { bypassCache: bypassCache || phones.has(tabId) });
    },

    /** The phone tab's page changed size (its isolated world's resize listener): the width corrected. */
    resized(tabId) {
      tabId = Number(tabId);
      if (!phones.has(tabId)) return;
      ready.then(() => refit(tabId)).catch(() => {});
    },

    /**
     * Back to desktop, as a desktop tab (reloaded): the window route's phone window expanded back out, the tab in
     * it (its panel stays); the popup route's tab back in its window, where it was.
     */
    async close(tabId, { reload = true } = {}) {
      await ready;
      tabId = Number(tabId);
      const p = phones.get(tabId);
      if (!p) return { back: false };
      await forget(tabId);
      // The window route: the phone window expands back out, the tab still in it, and TRIF's side panel or sidebar
      // there stays open, now on the desktop page (Tim, 11-20: "going back to desktop view now kills the sidebar.
      // can we instead expand back out and keep the sidebar?": moving the tab back to the window it came from
      // closed the phone window, and its panel with it). To the size, place and state of the window it came from
      // (as that window is now, if it's still open; else as it was), or for a tab that was alone in its window,
      // that window's own from before.
      if (p.route === 'window' && p.window != null) {
        const t = await chrome.tabs.get(tabId).catch(() => null);
        const win = t?.windowId === p.window ? await chrome.windows.get(p.window).catch(() => null) : null;
        let r = p.restore || null;
        if (win && !p.same && p.home?.windowId != null) {
          const h = await chrome.windows.get(p.home.windowId).catch(() => null);
          if (h) r = { left: h.left, top: h.top, width: h.width, height: h.height, state: h.state || 'normal' };
        }
        if (win && r) {
          await chrome.windows.update(p.window, { left: r.left, top: r.top, width: r.width, height: r.height }).catch((e) => log(`back to desktop: ${e?.message ?? e}`));
          if (r.state && r.state !== 'normal') await chrome.windows.update(p.window, { state: r.state }).catch(() => {});
          await chrome.windows.update(p.window, { focused: true }).catch(() => {});
          if (reload) await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
          changed();
          return { back: true, window: p.window };
        }
      }
      // (the popup route, or a phone window gone: the tab back where it was)
      let windowId = p.home?.windowId;
      const home = windowId != null ? await chrome.windows.get(windowId).catch(() => null) : null;
      moving.add(tabId);
      try {
        // (a browser that won't move a tab out of a popup, as Firefox's documentation says: an ordinary window of its own.
        // The phone window, with no tab left, closes, its side panel or sidebar with it.)
        const moved = home ? await chrome.tabs.move(tabId, { windowId, index: Number.isInteger(p.home.index) ? p.home.index : -1 }).then(() => true, (e) => { log(`back to desktop: ${e?.message ?? e}`); return false; }) : false;
        if (!moved) windowId = (await chrome.windows.create({ tabId, type: 'normal', focused: true })).id;
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
      } catch (e) { log(`back to desktop: ${e?.message ?? e}`); } finally { moving.delete(tabId); }
      if (reload) await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {}); // (past the worker and the cache, as open)
      changed();
      return { back: true, window: windowId };
    },

    /**
     * The browser's events: a phone window closed (its tab with it), a phone tab closed, a page of it loaded
     * (healed if it came without the rules; its size watched), the phone tab dragged out of its window by the
     * person (an ordinary window lets them): no longer a phone there, so a desktop tab again.
     */
    listen() {
      chrome.tabs?.onUpdated?.addListener((tabId, info, tab) => {
        if (info.status !== 'complete' || !phones.has(tabId)) return;
        ready.then(() => heal(tabId, tab?.url || '')).catch(() => {});
        if (phones.get(tabId)?.route === 'window') ready.then(() => watchSize(tabId)).then(() => refit(tabId)).catch(() => {});
      });
      chrome.tabs?.onRemoved?.addListener((tabId) => { if (phones.has(tabId)) ready.then(() => forget(tabId)).then(changed).catch(() => {}); });
      chrome.tabs?.onAttached?.addListener((tabId, { newWindowId }) => {
        const p = phones.get(tabId);
        if (!p || moving.has(tabId) || p.window == null || newWindowId === p.window) return;
        log(`phone view, tab ${tabId}: moved out of its phone window, so a desktop tab again`);
        ready.then(() => forget(tabId)).then(() => chrome.tabs.reload(tabId, { bypassCache: true })).catch(() => {}).then(changed);
      });
      chrome.windows?.onRemoved?.addListener((windowId) => {
        for (const [tabId, p] of phones) if (p.window === windowId) ready.then(() => forget(tabId)).then(changed).catch(() => {});
        healed.clear();
      });
    },
  };
}
