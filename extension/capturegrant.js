// Capture grants: which tabs the browser lets TRIF take screenshots of, without access to every site.
//
// TRIF has the sites the user turned it on for, not <all_urls> (lib.js "site access"), and the browser's
// captureVisibleTab wants <all_urls> or activeTab (screenshot.js). activeTab is the browser's, per tab, given
// when the user clicks TRIF's toolbar button on that tab or presses TRIF's shortcut there (the manifest's
// "see-tab" command; a click inside the panel doesn't count). The browser takes it back:
//   - Chrome and Edge: when the tab goes to another origin (a reload or another page of the same origin keeps
//     it; www.x.com after x.com ends it, and coming back doesn't bring it back), and when the tab closes;
//   - Firefox: with any new document in the tab (a reload too; a single-page site's own address changes keep it),
//     and when the tab closes;
//   - all: when the browser or TRIF restarts.
// The browser doesn't say which tabs have it, so this keeps its own record, as the grants come and go by those
// rules (kept in session storage by background.js, which the browser empties as it restarts): a hint only.
// What decides is captureVisibleTab itself: a capture that works records the tab, one refused forgets it.
//
// And while a screenshot waits for the grant (the user asked, in the panel, to click the robot: background.js
// waitForGrant), `wait` resolves as soon as the grant for that tab comes, or after `ms`.
//
// background.js's hasCaptureGrant(tab) answers "can TRIF picture tab X now" (every site, or this record), for
// anything that would rather not ask (the in-view note at Send).

export const GRANT_WAIT_MS = 60000; // how long a screenshot waits for the user's click (or shortcut)

/** The origin of `url` (https://x.com), or '' for one without (about:blank, chrome://). */
export function originOf(url) {
  try {
    const u = new URL(String(url ?? ''));
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch { return ''; }
}

/**
 * deps: {family: 'chromium' | 'firefox' (lib.js FAMILY), now?, save?(dump) (on every change), setTimer?, clearTimer?}.
 */
export function createCaptureGrants({ family = 'chromium', now = Date.now, save = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const grants = new Map(); // tabId -> {origin, at, how: 'click' | 'shortcut' | 'seen'}
  const waits = new Map();  // tabId -> [{site, windowId, since, until, shortcut, done(result)}]
  const changed = () => { try { save?.(dump()); } catch { /* the record is a hint */ } };
  const dump = () => Object.fromEntries([...grants].map(([id, g]) => [String(id), g]));
  const finish = (tabId, result) => {
    const list = waits.get(tabId);
    if (!list) return 0;
    waits.delete(tabId);
    for (const w of list) w.done(result);
    return list.length;
  };
  const forget = (tabId) => { if (grants.delete(tabId)) changed(); };

  return {
    /**
     * The user clicked the toolbar button on `tab` or pressed the shortcut there (`how`), or a capture of it
     * worked ('seen'). Synchronous (the toolbar click decides from it whether to close the panel). Returns how
     * many screenshots were waiting for it, now on their way.
     */
    grant(tab, how = 'click') {
      if (!tab || !Number.isInteger(tab.id)) return 0;
      grants.set(tab.id, { origin: originOf(tab.url || tab.pendingUrl || ''), at: now(), how });
      changed();
      return finish(tab.id, 'granted');
    },
    /** Whether TRIF has the grant for `tabId` by the record (at `url`, the tab's address now, when given). */
    has(tabId, url) {
      const g = grants.get(tabId);
      if (!g) return false;
      if (url === undefined || !g.origin) return true;
      return originOf(url) === g.origin;
    },
    /** A capture of `tabId` was refused for want of the grant. */
    refused(tabId) { forget(tabId); },
    /** tabs.onUpdated: the browser's rules for taking the grant back (above). */
    updated(tabId, info = {}, tab = null) {
      const g = grants.get(tabId);
      if (!g) return;
      if (family === 'firefox' && info.status === 'loading') return forget(tabId);
      const url = info.url || (info.status === 'loading' ? tab?.url || '' : '');
      if (url && g.origin && originOf(url) !== g.origin) forget(tabId);
    },
    /** tabs.onRemoved: no grant, and nothing to wait for. */
    removed(tabId) { forget(tabId); finish(tabId, 'closed'); },
    /**
     * Wait for the grant on `tab`, at most `ms`: resolves 'granted', 'timeout', 'closed' or 'cancelled'.
     * `info`: {site, shortcut}, for the panel's note (waiting()).
     */
    wait(tab, { ms = GRANT_WAIT_MS, site = '', shortcut = '' } = {}) {
      return new Promise((resolve) => {
        const since = now();
        let timer = null;
        const w = {
          site, shortcut, windowId: tab.windowId, since, until: since + ms,
          done: (result) => { clearTimer(timer); resolve(result); },
        };
        timer = setTimer(() => {
          const list = (waits.get(tab.id) || []).filter((x) => x !== w);
          if (list.length) waits.set(tab.id, list); else waits.delete(tab.id);
          resolve('timeout');
        }, ms);
        if (!waits.has(tab.id)) waits.set(tab.id, []);
        waits.get(tab.id).push(w);
      });
    },
    /** Whether a screenshot is waiting for the grant on `tabId`. */
    isWaiting(tabId) { return waits.has(tabId); },
    /** Every wait ends (`result`, 'cancelled' by default): TRIF lost its access to the site, say. */
    cancel(tabId, result = 'cancelled') { finish(tabId, result); },
    /** The waits, one per tab, for the panel: [{tabId, windowId, site, shortcut, since, until}]. */
    waiting() {
      return [...waits].map(([tabId, list]) => {
        const w = list[0];
        return { tabId, windowId: w.windowId, site: w.site, shortcut: w.shortcut, since: w.since, until: Math.max(...list.map((x) => x.until)) };
      });
    },
    /** The record as kept (session storage), and back. */
    dump,
    load(saved) {
      if (!saved || typeof saved !== 'object') return;
      for (const [k, g] of Object.entries(saved)) {
        const id = Number(k);
        if (Number.isInteger(id) && g && typeof g === 'object' && !grants.has(id)) {
          grants.set(id, { origin: typeof g.origin === 'string' ? g.origin : '', at: Number(g.at) || 0, how: String(g.how || 'click') });
        }
      }
    },
  };
}

/**
 * A shortcut as the browser gives it (commands.getAll: Chrome on a Mac gives '⌥⇧S', Firefox 'Alt+Shift+S'
 * everywhere), the way the user's keyboard says it: on a Mac, ⌥⇧S.
 */
export function shortcutText(shortcut, mac = false) {
  const s = String(shortcut || '').trim();
  if (!s || !mac || !s.includes('+')) return s;
  const keys = { Alt: '⌥', Shift: '⇧', Ctrl: '⌘', Command: '⌘', MacCtrl: '⌃' };
  const parts = s.split('+');
  return parts.map((p, i) => (i < parts.length - 1 ? keys[p] ?? p : p)).join('');
}

// The panel's note while a screenshot waits for the click (sidepanel.js renderSeeTab; drafts in
// docs/SCREENSHOT-GRANT-STRINGS.md).
export const SEE_TAB_TITLE = 'Click the robot to let TRIF see this tab.';
/** Where TRIF's robot is, in a few words, and the shortcut that does the same (`shortcut` '' when the user has none). */
export function seeTabWhere(browser, shortcut) {
  return `It's at the top right of ${browser || 'the browser'}, next to the address bar (or in the puzzle-piece menu).` + (shortcut ? ` Or press ${shortcut}.` : '');
}
