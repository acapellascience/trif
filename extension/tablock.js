// Tab locks (docs/SECURITY.md, "Agent code in a tab"). Before a side-panel agent's `trif run` code runs
// in a tab, the tab is locked: the browser itself blocks every request from it that changes something
// (POST, PUT, PATCH, DELETE: fetch, XHR, sendBeacon, form posts) and every WebSocket, with
// declarativeNetRequest session rules for that tab. Page code can't get around a rule the browser applies
// (the agent's code runs in the page, and anything it leaves behind, timers or wrapped functions, only
// lives as long as the page does). Clicks, keys and reading the page work as before.
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
// If the lock can't be set up (no declarativeNetRequest, a browser that ignores the per-tab condition),
// the agent's code doesn't run: lock() throws, and `trif run` fails with why.

export const WRITE_METHODS = ['post', 'put', 'patch', 'delete', 'connect'];

/**
 * The rules for a locked tab. No list of request kinds: browsers name them differently (Firefox's
 * sendBeacon is a "beacon", Chrome's a "ping") and a list would miss one. Without `resourceTypes` a rule
 * matches every kind but whole pages, so: changing requests of every kind, then changing page loads
 * (form posts), then sockets, whatever the method.
 */
export function lockRules(tabId, ids) {
  const block = { type: 'block' };
  return [
    { id: ids[0], priority: 1000, action: block, condition: { tabIds: [tabId], requestMethods: WRITE_METHODS } },
    { id: ids[1], priority: 1000, action: block, condition: { tabIds: [tabId], requestMethods: WRITE_METHODS, resourceTypes: ['main_frame'] } },
    { id: ids[2], priority: 1000, action: block, condition: { tabIds: [tabId], resourceTypes: ['websocket'] } },
  ];
}

// In the tab's isolated world (the extension's, which page code can't reach): set or check the marker.
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

export function createTabLocks({ chrome, log = () => {}, changed = () => {}, key = 'tabLocks' }) {
  const locks = new Map(); // tabId -> {token, ids, site, since, parent}
  let nextId = 1;
  const ready = (async () => {
    try {
      const saved = (await chrome.storage.session.get(key))[key] || {};
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const have = new Set(rules.map((r) => r.id));
      for (const [tab, l] of Object.entries(saved)) if (l && Array.isArray(l.ids) && l.ids.every((i) => have.has(i))) locks.set(Number(tab), l);
      nextId = Math.max(0, ...rules.map((r) => r.id)) + 1;
      // rules no lock owns (a lock record lost): remove them
      const owned = new Set([...locks.values()].flatMap((l) => l.ids));
      const stray = rules.filter((r) => !owned.has(r.id)).map((r) => r.id);
      if (stray.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stray });
    } catch (e) { log(`tab locks: ${e?.message ?? e}`); }
  })();
  const save = () => chrome.storage.session.set({ [key]: Object.fromEntries(locks) }).catch(() => {});

  async function addRules(tabId) {
    const ids = [nextId++, nextId++, nextId++];
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: lockRules(tabId, ids) });
    // A browser that dropped the per-tab condition would block every tab's requests, and one that dropped
    // the methods would block everything: either way, not what was asked for. Check what it kept.
    const got = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => ids.includes(r.id));
    const ok = got.length === ids.length && got.every((r) => Array.isArray(r.condition?.tabIds) && r.condition.tabIds.length === 1 && r.condition.tabIds[0] === tabId)
      && got.filter((r) => r.id !== ids[2]).every((r) => Array.isArray(r.condition?.requestMethods) && r.condition.requestMethods.length === WRITE_METHODS.length);
    if (!ok) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});
      throw new Error("this browser can't block requests for one tab");
    }
    return ids;
  }

  async function mark(tabId, token) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: setMarker, args: [token], injectImmediately: true });
    if (!r || r.result !== true) throw new Error("couldn't mark the tab's page");
  }

  /** Lock a tab (or keep it locked, marking its current document too). Throws if it can't. */
  async function lock(tabId, site, parent = null) {
    await ready;
    let l = locks.get(tabId);
    if (!l) {
      const ids = await addRules(tabId);
      l = { token: crypto.randomUUID(), ids, site: site || '', since: Date.now(), parent };
      locks.set(tabId, l);
      log(`locked tab ${tabId}${site ? ` (${site})` : ''}${parent != null ? `, opened by locked tab ${parent}` : ''}`);
    }
    try { await mark(tabId, l.token); } catch (e) {
      if (parent == null) { await unlock(tabId, 'no marker'); throw e; }
      // (a tab a locked tab opened may not be scriptable yet: it stays locked while its opener is)
    }
    await save();
    changed();
    return l;
  }

  async function unlock(tabId, why) {
    const l = locks.get(tabId);
    if (!l) return;
    locks.delete(tabId);
    try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: l.ids }); } catch (e) { log(`unlocking tab ${tabId}: ${e?.message ?? e}`); }
    log(`unlocked tab ${tabId}: ${why}`);
    await save();
    changed();
    // tabs it opened can go too, once their own page is a new one
    for (const [id, c] of locks) if (c.parent === tabId) check(id).catch(() => {});
  }

  // The tab's document changed (or may have): unlock if it's a new one without the agent's code.
  async function check(tabId) {
    await ready;
    const l = locks.get(tabId);
    if (!l) return;
    if (l.parent != null && locks.has(l.parent)) { await mark(tabId, l.token).catch(() => {}); return; } // (still within reach of locked code)
    let same;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: hasMarker, args: [l.token], injectImmediately: true });
      same = r ? r.result === true : null;
    } catch { same = null; } // (a page the extension can't script: nothing of the agent's there; stay locked until a page it can check)
    if (same === false) await unlock(tabId, 'a new page');
  }

  return {
    ready, lock, unlock, check,
    isLocked: (tabId) => locks.has(tabId),
    list: () => [...locks.entries()].map(([tabId, l]) => ({ tabId, site: l.site, since: l.since })),
    /** A document back from the back/forward cache with its marker: lock its tab again. */
    async restored(tabId, token) {
      await ready;
      if (locks.has(tabId) || typeof token !== 'string' || !token) return; // (only the marker, in our isolated world, sends this)
      const ids = await addRules(tabId);
      locks.set(tabId, { token, ids, site: '', since: Date.now(), parent: null });
      await save();
      changed();
      log(`locked tab ${tabId} again: a locked page came back from the back/forward cache`);
    },
    async opened(tab) {
      if (tab.openerTabId != null && locks.has(tab.openerTabId)) await lock(tab.id, locks.get(tab.openerTabId).site, tab.openerTabId).catch((e) => log(`couldn't lock tab ${tab.id}: ${e?.message ?? e}`));
    },
  };
}
