# Edit for mobile: a phone view in desktop TRIF, and sending mods to the phone

Branch `mobile-edit` (worktree `~/WebMods-worktrees/mobile-edit`), 2026-11-16. The idea, in Tim's words: open a
window where TRIF runs but the site thinks it's on a phone, sized like a phone, so a mod can be made on the
mobile site on the Mac, and then sent to the phone. The phone side is TRIF's iPhone app (branch `ios-poc`,
`mobile/`), which runs mods in its own WKWebView browser and imports `.js` files ("Add this mod?").

Short version:

- **What's built** (no new permission): the panel's phone button moves the tab into a 390 px wide window
  where the site sees Safari on an iPhone: the user agent and no client hints in every request of that tab
  (declarativeNetRequest session rules for that tab only), and in the page's own JavaScript an iPhone's
  navigator, screen, touch and no hover (a page script at document_start in that tab only). TRIF's panel opens
  in a window beside it and works on it: the chat, the agent's commands and `trif screenshot`. "Back to
  desktop" puts the tab back where it was. Tested headless in Chrome 156 against local pages and four public
  sites. The same in headless Firefox 159, but for the screenshot (untested there).
- **The one thing a debugger would add**: CSS. Style sheets' `@media (hover: hover)` and `(pointer: fine)` still
  see the mouse, `:hover` still applies, the viewport meta tag is ignored, and workers keep the desktop user
  agent. Worth it only if those turn out to matter on real sites; my recommendation is no, not now.
- **Send to phone**: the code card's ⋯ menu has "Send to iPhone…": a copy of the mod's file to the Mac's
  AirDrop (helper, `osascript`), which the iPhone app already opens. No server. A QR code for small mods and an
  iCloud Drive folder are the next steps, and need small changes in the app (below).

## 1. How sites tell a phone

| Signal | Who reads it | Examples |
|---|---|---|
| `User-Agent` request header | the server: a different page, or a redirect to an `m.` address | Instagram's HTML has `"is_mobile":true`, `"is_mobile_safari":true` for an iPhone user agent (checked with curl, 11-16); X sends a mobile "tap" animation; Facebook redirects to m.facebook.com; Wikipedia no longer redirects to `en.m.` (same page, 11-16) |
| Client hints: `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`, and on request (`Accept-CH`) `-Model`, `-Platform-Version`… | the server (Chromium only: Safari and Firefox send none) | Google asks for them with `Accept-CH` |
| `navigator.userAgent`, `navigator.userAgentData.mobile`, `navigator.platform` | the page's scripts | every "is mobile" library |
| Width: CSS `@media (max-width: …)`, `innerWidth` | the page's styles and scripts | X, Reddit, Instagram: responsive layouts |
| Touch: `navigator.maxTouchPoints`, `'ontouchstart' in window`, `document.createEvent('TouchEvent')`, `matchMedia('(pointer: coarse)')`, `(hover: none)` | scripts (and CSS media queries) | "open in app" banners, swipe carousels, menus that open on tap instead of hover |
| `screen.width`, `window.orientation`, `devicePixelRatio` | scripts | older detection code (`typeof window.orientation !== 'undefined'`) |
| The viewport meta tag | the phone's browser itself: a page without one is laid out 980 px wide and scaled down | desktop-only sites |

So a faithful phone needs three layers: the requests (server-side choices), the page's JavaScript, and the
window's width (the CSS). A desktop browser can fake the first two per tab without the debugger, and give the
third by its window size.

## 2. The window

- `chrome.windows.create({ type: 'popup', width, height, left, top })`. Width and height are the window's
  outer size, frame included. A popup has no tab strip or toolbar, only a title bar and a line with the
  address; for the page to be 390 px wide the window is 390 plus the frame (0 on macOS), so TRIF measures the
  page after the window opens (`innerWidth`/`innerHeight` from TRIF's isolated world, which the page script
  doesn't touch) and resizes once (`phone.js fit`).
- **Is 390 × 844 reachable?** The width, yes: Chrome's popup windows go well under 390 (password managers open
  360 px popups). Headless Chrome took a popup down to 200 × 300 with `windows.update`. The height: Chrome
  keeps windows on the screen, and a 13" MacBook Air has about 856 px under the menu bar with the Dock shown,
  so 844 + the title and address lines doesn't fit. TRIF doesn't need 844, though: Safari on a 390 × 844
  iPhone gives the page about 390 × 660–750 (its bars take the rest). So the page area is **390 × 750** when
  the screen has room, as tall as fits when it hasn't (never under 480), and `screen.height` still says 844.
- **Zoom** (`chrome.tabs.setZoom`) would fit a taller page in less screen: at 0.8, a 312 px window holds a
  390 CSS px page. Two catches, checked in Chrome 156: the default zoom scope is per origin, so it would zoom
  the user's other tabs of the site too (`setZoomSettings(tabId, {scope: 'per-tab'})` avoids that), and a
  per-tab zoom is reset by every navigation, so the page would load at 1.0 and be re-zoomed after its first
  layout. And `devicePixelRatio` changes with it. Not used: the shorter page is closer to a real phone.
- **Headless caveat**: headless Chrome ignores `windows.create`'s size (it took 1280 × 720, the
  `--window-size`) and doesn't keep windows on the screen; `windows.update` works. The fit step makes headless
  right too. The real limits on Tim's screen need one look in a headed Chrome.

### Why the tab itself moves

Chrome lets an extension capture a tab only with `<all_urls>` or `activeTab` (the toolbar click on that tab):
a site's own access isn't enough (docs/PROTOCOL.md "Screenshots"). A new tab in a new window has neither, and a
popup window has no toolbar to click. But a tab keeps `activeTab` when it moves to another window, and on
reloads and pages of the same origin: checked in Chrome 156 (`windows.create({tabId, type: 'popup'})`, then
`captureVisibleTab` of the popup: works after a reload and a same-origin navigation; a fresh tab in a popup:
refused). So "Edit for mobile" moves the panel's tab (which got `activeTab` when the user opened the panel
from the toolbar on it) and "Back to desktop" moves it back (`tabs.move` out of a popup works in Chrome 156,
though the documentation says tabs move only between normal windows; if it fails, the tab gets an ordinary
window of its own). Back on the desktop, the tab has lost `activeTab` (checked), as after any move back: the
next toolbar click gives it again. Closing the phone window closes the tab, as closing any window does.

## 3. The user agent and client hints, that tab only

Session rules with `tabIds` (only session rules take them), as `extension/tablock.js` already does:

```js
{ id, priority: 1, condition: { tabIds: [tabId], resourceTypes: ALL_TYPES },
  action: { type: 'modifyHeaders', requestHeaders: [
    { header: 'user-agent', operation: 'set', value: IPHONE_SAFARI },
    { header: 'sec-ch-ua', operation: 'remove' }, … every Sec-CH-UA-* … ] } }
```

- **`resourceTypes` must be listed**: a rule without them matches everything but `main_frame`, which is the
  request that matters most (the server choosing its mobile page). That was the first probe's miss.
- **Which phone**: Safari on an iPhone, because that's what the phone app's web view tells sites it is (Google's
  sign-in took it for Safari). Safari sends no client hints and has no `navigator.userAgentData`, so they're all
  removed, not set to `?1`: an iPhone user agent with Chromium's hints would be a mix no real
  browser sends. (An Android profile, `Sec-CH-UA-Mobile: ?1` and `Sec-CH-UA-Platform: "Android"`, would be a
  second profile in `phone.js PHONE`, if one is ever wanted.)
- Checked in headless Chrome 156: the page's own request, its `fetch`, and a frame's all carry the iPhone user
  agent and no `sec-ch-ua*`, also when the server asked for more with `Accept-CH`; another tab of the same page
  keeps Chrome's.
- **What the rules can't reach**: requests to a site TRIF has no access to (modifyHeaders needs host access;
  TRIF has the sites the user connected: a CDN's pictures go with Chrome's user agent, which doesn't change the
  page), and requests no tab owns (`tabId` −1: a service worker's own fetches, a SharedWorker). A site whose
  service worker fetches pages would see the desktop user agent there. Rules for −1 would apply to every tab,
  so they're not used.
- Rule ids from 1,000,000 up are the phone view's; tab locks (`tablock.js`, which removes session rules it
  doesn't own when it starts) leave them alone (`createTabLocks({ foreign })`).

## 4. Touch and the rest, in the page

`extension/phone-page.js`: a classic script registered with `chrome.scripting.registerContentScripts` (world
`MAIN`, `document_start`, every frame, `matchOriginAsFallback` for about:blank frames, `<all_urls>`, which only
runs where TRIF has access; not persisted across browser restarts), only while a phone window is open.

**Knowing it's the phone tab, synchronously.** A registered script can't be limited to a tab, and asking the
background is asynchronous, so the site's first script would run first. The phone tab's rules also add
`Server-Timing: trif-phone` to its pages' and frames' responses (an `append` on a response header, which DNR
allows for any response header), and the script reads it from
`performance.getEntriesByType('navigation')[0].serverTiming` at document_start: there in the phone tab, absent
everywhere else (checked). A page without it returns at once, changing nothing. (The site's own scripts can
read that entry too, in that tab only; it says nothing they couldn't tell from the user agent.)

What it sets, for Safari on an iPhone 15 with iOS 18.5:

- `navigator`: `userAgent`, `appVersion`, `platform` (`iPhone`), `vendor` (`Apple Computer, Inc.`),
  `maxTouchPoints` (5), `standalone` (false); `userAgentData` removed, so `'userAgentData' in navigator` is false.
- `screen`: 390 × 844 (and avail), `screen.orientation` portrait; `window.orientation` 0; `outerWidth`,
  `outerHeight`, `screenX`/`screenY` as a phone has them.
- Touch: `ontouchstart` and friends on window, document and elements; `Touch` and `TouchEvent` (stand-ins
  where the desktop hides them); `document.createEvent('TouchEvent')`.
- `matchMedia`: `pointer`, `any-pointer`, `hover`, `any-hover` answered as a finger (coarse, none), in any
  query (`(hover: hover) and (pointer: fine)` is false), by rewriting just those features to always-true or
  always-false ones, so the rest of the query and its change events still work.
- The mouse as a finger: a press sends `touchstart`, a drag `touchmove`, the release `touchend` (before the
  mouse events, as a phone does; a `preventDefault` on them stops the mouse events and the click, as on a
  phone); pointer events say `pointerType: 'touch'`; a mouse that only moves over the page (a hover, which a
  finger can't do) isn't passed to the page's scripts.
- **Left as it is: `devicePixelRatio`** (2 on a Retina Mac, 3 on the iPhone): CSS `resolution` queries and
  `image-set()` go by the real one, and a page whose JavaScript saw 3 would draw its canvases at the wrong size.

**What a page script can't do** (the debugger can, below): style sheets' `@media (hover: …)` and
`(pointer: …)` and `:hover`; the viewport meta tag (desktop Chrome ignores it: a page without one is laid out
at 390 px instead of 980 and scaled); workers' `navigator.userAgent`; making its getters look native to code
that checks `Function.prototype.toString`.

## 5. The debugger route

`chrome.debugger.attach({tabId}, '1.3')`, then `Emulation.setDeviceMetricsOverride({width: 390, height: 844,
deviceScaleFactor: 3, mobile: true})`, `Emulation.setTouchEmulationEnabled({enabled: true, maxTouchPoints: 5})`,
`Emulation.setEmitTouchEventsForMouse({enabled: true, configuration: 'mobile'})`,
`Emulation.setUserAgentOverride({userAgent, platform: 'iPhone', userAgentMetadata})` (or none, for Safari),
`Emulation.setEmulatedMedia({features: [{name: 'hover', value: 'none'}, {name: 'pointer', value: 'coarse'}]})`.
That's DevTools' device mode, from an extension.

| | Without the debugger (built) | With the debugger |
|---|---|---|
| Permission | none new | `debugger`: "Access the page debugger backend". New warnings disable an installed extension until the user accepts them, and it draws extra review in the Chrome Web Store |
| While it's on | nothing shows | Chrome's bar in every window: "TRIF started debugging this browser" with Cancel (it goes only with a command-line switch). The user's DevTools on that tab end the session |
| Server's view | the same: user agent, hints | the same |
| Page's JavaScript | the same, from a page script | the same, from the browser itself (native getters, workers too) |
| CSS: hover, pointer, the viewport meta tag, device-width | the mouse's, the window's | the phone's |
| The window | must be 390 px wide | any window: the page is drawn 390 wide inside it, at the phone's scale |
| Screenshots | `activeTab` (the tab moves) | `Page.captureScreenshot`, any size, without `activeTab` |
| Firefox | yes (below) | no: Firefox has no `debugger` API for extensions |
| Enterprise | nothing | Chrome 155 started refusing it under some managed policies, rolled back on 2026-11-04 |

**Recommendation: no debugger, now.** What it adds is CSS hover and pointer queries, the viewport tag and
workers. Most mobile layouts key on width, which the window gives; the agent is told not to rely on hover or
pointer queries (AGENTS.md "Phone mods"). The bar across every window, the scary warning for every user (for a
feature some use), the store review, and no Firefox outweigh that. If real sites show the gap matters, the
debugger could come later as an **optional** permission (`optional_permissions: ["debugger"]`, asked for on the
first "Edit for mobile" that wants it): no install or update warning for everyone else. Chrome allows
`debugger` as optional.

## 6. Firefox

**Checked in headless Firefox 159** (`tests/phone-firefox.js`, through TRIF's Firefox build): the panel's
`phone.open` moves the tab into a 390 px popup, the server and the page see the iPhone (user agent, no
`userAgentData`, touch, `matchMedia`, the screen, `window.orientation`, a frame too), the panel window opens
beside it, and `phone.close` moves the tab back into its window (`tabs.move` out of a popup works there too,
though Mozilla's documentation says it doesn't) with the rules gone. What's what:

- `declarativeNetRequest` session rules with `tabIds` and `modifyHeaders` on `main_frame`: yes. Firefox sends
  no client hints, so only the user agent changes. `phone.js` leaves out the resource types Firefox doesn't
  know (`webtransport`, `webbundle`).
- `scripting.registerContentScripts` with `world: 'MAIN'` and `matchOriginAsFallback`: yes.
- `Server-Timing` in `PerformanceNavigationTiming.serverTiming`: yes (secure pages: https and localhost).
- `permissions.contains` with a port in the origin says no in Firefox: TRIF asks for the host without it.
- **Screenshots: untested.** Firefox's `captureTab` wants `<all_urls>`; its `captureVisibleTab` takes `activeTab`
  (since 126), which the toolbar button gives. Whether a tab keeps it through the move, as in Chrome, needs a
  toolbar click, which the headless driver can't make: one look in a real Firefox.
- TRIF's panel: Firefox's sidebar is per window, and popups have none, so the panel window (the fallback
  Chrome's Arc users get) is the one. The panel's phone button shows in Firefox; hidden in Safari.
- No `debugger` route at all; Firefox's Responsive Design Mode is DevTools-only.

## 7. TRIF's panel and agent in the phone view

- **The panel**: the bar's phone button (Edit for mobile) on any site TRIF is on. It moves the tab, opens
  TRIF's panel in a window beside the phone (`sidepanel.html?window=<phone window>&fallback=1`, the panel window
  that follows another window's tabs; it closes with the phone window). There the button is pressed (Back to
  desktop) and a line under the bar says "Phone view: x.com sees an iPhone. Mods you make here are for TRIF on
  your phone." with Back to desktop. The panel the user had stays in their own window.
- **The agent**: a chat in the phone's panel passes the phone tab's id, as any chat does; the background adds
  `phone: {device: 'iPhone', width: 390}` to `agent.start`, and the helper tells the agent that tab is the
  phone view, to write for the layout it shows, to add `// @device phone`, and to make the mod do nothing where
  that layout isn't there (helper/lib/agents/index.js `phoneText`, AGENTS.md "Phone mods"). Every page command
  finds the phone's tab (`resolveTab` takes the phone windows; `trif tabs` lists it with `phone: "iPhone"`), and
  `trif screenshot --tab <id>` captures it at phone size.
- **The mod**: checked and held as usual: the phone view changes what the site sees, not how TRIF judges a
  mod. `@device phone` is parsed (`helper/lib/mods.js`, into the mod's `device`); nothing acts on it yet.
  Desktop TRIF runs it in every tab of the site, which is why the agent is told to make it bail out on the
  desktop layout. Later, if wanted: run `@device phone` mods only in phone tabs on desktop (the runtime would
  check the same marker), and show a small phone tag in the mods list.

## 8. Send to phone

What the phone app already takes (ios-poc `Import.swift`, `Info.plist` document types): a `.js` (or a folder,
or a zip) opened in the app from the share sheet, AirDrop or Files; each mod "added off, marked new, held like
any mod from outside". The app also handles `trif://open?url=` (Home Screen icons).

| Option | Simple? | Private? | Phone side | Mac side |
|---|---|---|---|---|
| **AirDrop from the Mac** | one click, pick the phone, tap Open in TRIF | yes: Mac to phone directly, no server | **nothing new** (document types) | **built**: Send to iPhone… |
| **QR code** of the mod itself (small mods) | point the Camera, tap the banner | yes: nothing leaves the screen | handle `trif://add?…` (below) | a QR encoder in the panel (not built) |
| **iCloud Drive folder** `iCloud Drive/TRIF` | nothing to do each time: the app finds new mods | through Apple's iCloud (end to end only with Advanced Data Protection) | a folder the user picks once (a bookmark), read on foreground | the helper copies the file there (maybe a macOS "access iCloud Drive" prompt the first time) |
| Local network hand-off (helper serves the file once, QR holds the address) | as the QR, any size | stays on the Wi-Fi | fetch the address; the Local Network permission prompt | a listener on the network; macOS's firewall prompt for node |
| A link (a paste site, a gist, TRIF's own server) | simple | **no**: a server sees the mod | — | — |

**Recommendation**: AirDrop now (built, and the phone side exists); the QR code next for small mods (style
mods, most short free mods), because it's the most magic and the most private; the iCloud folder only if Tim
wants "it's just there". No link through a server.

**Built: Send to iPhone…** (the code card's ⋯ menu, macOS only). The helper (`helper/lib/tophone.js`,
`mod.toPhone`) copies the mod's file to a folder of its own in the temporary folder, named as Export names it
(`<site>-<mod>.js`, which the app reads the site from), and opens AirDrop's window on it with a small
JavaScript for Automation script (`osascript -l JavaScript`, AppKit's `NSSharingService`). On this Mac the
AirDrop service is there and accepts the file (`canPerformWithItems`, checked without opening anything).
**Untested**: whether the window shows from `osascript` (it has no app of its own; the script makes itself an
accessory app first). If it doesn't show within a second or two, the script says so and the helper shows the
file in Finder instead, where Share → AirDrop does the same. Copies older than an hour are removed.

**What the iPhone app would need for the QR code** (for the agent on ios-poc; nothing here edits it):

1. A URL form: `trif://add?v=1&name=<site>-<mod>.js&z=<payload>`, where the payload is the mod's text,
   compressed with raw deflate (the browser's `CompressionStream('deflate-raw')`; the app's
   `compression_decode_buffer(…, COMPRESSION_ZLIB)` reads raw deflate, as `Import.swift`'s zip reader already
   does), base64url without padding. Optional `&h=<first 16 hex of sha256 of the text>` to refuse a damaged one.
2. In the app's `onOpenURL` (where `trif://open` is handled): decode, decompress (refuse over 256 KB
   unpacked), check `h`, then hand `(name, text)` to the same path `importFiles` uses for a file:
   `mods.read(text, file: name, here: host)` and `mods.add(m, source: "import")`, so it starts off and is held
   like any mod from outside, and say what came in.
3. The iPhone's Camera opens `trif://` links in the app (the banner says "Open in TRIF"). A QR code holds at
   most 2,953 bytes, so the payload fits about 2,200 compressed bytes: roughly 6–8 KB of mod. Bigger mods
   say "too big for a code: use Send to iPhone (AirDrop)". (A sequence of codes the app scans itself would
   carry any size; that needs a scanner in the app, AVFoundation, and is more work than it's worth now.)

**What the app would need for the iCloud folder**: a "Watch a folder…" setting that opens the folder picker
(`UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`), keeps a security-scoped bookmark, and on
each return to the foreground lists new `.js` files there (not yet imported, by name and hash) and offers "Add
this mod?" for each. No iCloud entitlement or container is needed for a folder the user picks. The Mac side
would copy the file to `~/Library/Mobile Documents/com~apple~CloudDocs/TRIF/`.

## 9. Tests

- `tests/phone.test.js` (unit, no browser): the rules, the window's bounds, the page script's profile matching
  `phone.js`, a page without the marker left alone, `resolveTab` with the phone's window, tab locks leaving the
  phone's rules, what the agent is told, `@device`, Send to iPhone's copy and fallback.
- `tests/phone-browser.test.js` (headless Chrome for Testing, `TRIF_BROWSER_TESTS=1`, one browser at a time
  under `tests/cdp-page.js`'s lock and memory guard): TRIF's real extension (a copy granting 127.0.0.1), local
  pages that tell a phone the usual ways (`tests/phone-pages.js`: the server from the user agent and hints, an
  `m.` redirect, the page's own checks, a frame, a press), the panel's `phone.open`: everything in sections 3
  and 4 above, the tab moved with `activeTab` (captureVisibleTab works), another tab of the same page untouched,
  then Back to desktop and closing the window undoing it all. `PHONE_SHOTS=<dir>` saves screenshots.
- `tests/phone-shots.js` (by hand): the same phone view on public sites that serve a mobile layout logged out,
  next to the desktop one, and the panel window. `tests/phone-firefox.js` (by hand): the local pages in Firefox.

**Public sites, headless Chrome 156, logged out (2026-11-16):**

| Site | Phone view |
|---|---|
| instagram.com/nasa | the mobile page: "Open app" in the header, the "See full profile in the app" sheet, a 3-column grid |
| reddit.com/r/pics | the mobile layout (menu button, search icon, one column) |
| en.wikipedia.org/wiki/Cat | the mobile skin (Minerva), on the same address: Wikipedia no longer redirects to `en.m.` |
| x.com/NASA | not tried: X answers headless Chrome with a 403 ("Access to x.com was denied"). The phone view's user agent would get past that, which is a bot check, so the script leaves out any site that refuses the headless browser. X needs one look in a real Chrome |

Reddit ran its own JavaScript check (a `js_challenge` in the address) and let the page through, as it does
for any browser that runs scripts.

## 10. What's left

- A look in a real (headed) Chrome on Tim's Mac: the window's real size limits, the panel window beside it
  (it's as wide as the phone window, 390, since a panel window is never wider than the window it follows), X,
  and whether AirDrop's window shows.
- Firefox: the screenshot through the move (section 6).
- An agent run in the phone view end to end (the e2e's `--agent`): `trif tabs`, `trif screenshot --tab` there.
  The parts are tested (resolveTab, the capture, the context), not the whole.
- The iPhone app: the QR code's `trif://add` and, if wanted, the watched folder (section 8). Then the QR code
  in the panel (a small QR encoder in extension/vendor).
- Maybe: `@device phone` mods only in phone tabs on desktop; a phone tag in the mods list; a CLI `trif to-phone`.
- Tim's wording for the strings in docs/MOBILE-EDIT-STRINGS.md.
