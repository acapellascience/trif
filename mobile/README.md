# TRIF on a phone: two probes

Two test apps that ask an iPhone what a TRIF for iOS could do. Neither is TRIF. Each one runs a list of
checks, lets you try the "point at it" idea by hand, and makes a report you send back.

| | Asks | Where it is |
|---|---|---|
| **Safari probe** | What could TRIF do as an extension to Safari on iPhone? | `safari-probe/` |
| **Browser probe** | What could TRIF do as its own browser app? | `browser-probe/` |

Nothing here has been run on a Mac or a phone. The Safari probe's code and every JavaScript check have been
run in Chromium (`TRIF_BROWSER_TESTS=1 node mobile/test/smoke.js`, in Chrome for Testing). The Swift has only been checked for syntax: expect to fix a
compile error or two in Xcode, and send them to me.

## What the answers decide

The same questions are put to both, so the reports can be read side by side.

| Question | Check | If yes | If no |
|---|---|---|---|
| Can code written later run in the page's own world? | Safari `main.written` | Free mods work in Safari on iPhone the way they do in Safari on Mac (the `toString` way in `extension/safari.js`). | No free mods in Safari on iPhone. Style mods only, unless the box works. |
| Does that survive a strict page? | the same, on `strict.html`, `trusted.html` and github.com | Free mods work on the sites people most want fixed. | They work only where the page allows `eval`: not x.com, not Instagram. |
| Can a world beside the page evaluate code? | Safari `own.eval`, `box.compartment`; browser `own.eval`, `box.compartment` | **The box works.** Boxed mods run on the phone. In Safari this would be the main tier. | No box there. Chromium says no for an extension's world, which is why TRIF uses a user-scripts world on desktop; Safari and WKWebView are the open question. |
| Does TRIF's sandbox runtime run as it is? | `box.start`, `box.run`, `box.confined`, `box.mod` | The desktop runtime ports unchanged. | The error text says what WebKit lacks. |
| What does locking down cost per page? | `box.start` detail (`lockdownMs`), browser `box.ses` (`loadMs`) | Under about 50 ms: load it on every page. | Load it only on sites that have a boxed mod. |
| Are hide rules in before the first paint? | `timing.start`, `timing.own`; the report's "loads" | No flash of the thing you hid. | A flash on every load. In Safari the fix is a content blocker; in the browser it's `blocker.works`. |
| Do selectors made by pointing last? | hide things, browse for a few days, read "a saved rule no longer found anything" | Point-and-hide stands by itself. | It needs TRIF's text-based rules (`@rules`) underneath, or it's a toy on sites with build-tool class names. |
| Can the page see or break TRIF's world? | `worlds.separate`, `worlds.clean` on `hostile.html` | The kit can be trusted on hostile pages. | Everything in that world has to be written as defensively as a free mod. |
| Can requests be blocked per tab or per site? | Safari `network`; browser `blocker.works` | A tab lock is possible if an agent ever runs on the phone. | Not needed for point-and-hide or mod links. |
| Can the extension's app half hold files and fetch? | Safari `native` | Mods and the catalogue can live in the app, shared with the extension. | The extension keeps everything in its own storage. |
| How often does Safari restart the background? | Safari `lifetime` | (information) | Design for a background that knows nothing when it wakes. It already has to on Mac. |
| Does Claude sign in inside an app's web view? | browser, by hand (below) | "Claude in a pane" is real. | The pane is dead; the route is the share sheet to the Claude app and a link back. |
| Does a link in Claude's reply reach the app? | browser, by hand | The loop closes with no server. | Fall back to copy and "Add a mod from the clipboard". |
| Is the phone's own model usable for this? | browser `ondevice`, and "Ask the phone's own model" | A free middle tier between pointing and Claude. | Skip it for now. |

## Before either: the test pages

`shared/pages/` has five pages with the same body (a sticky banner, a feed with a promoted post, a sidebar,
a cookie box, build-tool class names, a shadow root, a frame) and different rules:

- `plain.html`: no policy.
- `strict.html`: a strict Content-Security-Policy, as a header.
- `trusted.html`: the same, plus Trusted Types.
- `hostile.html`: the page replaces `querySelector`, `JSON.stringify`, `Array.prototype.map` and others.
- `spa.html`: more posts arrive after a moment; "Explore" swaps the feed without a page load.

The browser probe carries them inside the app. The Safari probe needs them served:

```
node mobile/serve.js
```

It prints the address for the Simulator (`http://localhost:8377/`) and for a phone on the same Wi-Fi.

## The Safari probe

```
node mobile/safari-probe/build.js
```

On a Mac this puts the extension together, has Apple's converter wrap it in an iPhone app project
(`mobile/build/safari-app/`), and opens Xcode. Then:

1. In Xcode, pick your team under Signing & Capabilities for both targets (the app and its extension). If the
   bundle id is taken, run again with `TRIF_PROBE_BUNDLE_ID=your.own.id`.
2. Run it on a simulator first, then on your iPhone.
3. On the device: Settings → Apps → Safari → Extensions → TRIF Probe → on, and allow it on all websites.
   (Per-site permission is itself a finding: note how many taps it took and what Safari asked.)
4. In Safari, open a test page. Tap the puzzle-piece button → TRIF Probe.

In the popup:

- **Run the checks on this page.** About ten seconds. Do it on all five test pages, then on github.com and
  two or three sites you'd want to fix. Reload a page once before its first run (two checks need a load
  that happened after the extension was allowed).
- **Pick something to hide.** The popup closes; tap a thing on the page. A bar at the bottom names it and
  offers Hide this, Hide all like it, or Wider. Reload: it should stay hidden.
- **Copy this page's outline.** Puts a short outline of the page on the clipboard, and records whether
  Safari let it.
- **Open the full report** → Copy the report, and send it to me.

By hand, and worth a sentence each when you send the report:

- Open `http://…:8377/trif-install#hide=.cookie-consent` from another app (Messages, the Claude app). Does
  it open Safari, and does the report list it under mod links?
- Leave the phone alone for an hour with Safari in the background, then open the report: the background's
  start count and alarm count say how often Safari kept it alive.
- How does tapping to pick feel against a real site's own tap handling?

## The browser probe

Open `mobile/browser-probe/TrifProbe.xcodeproj`, pick your team, run. It needs iOS 17; the on-device model
check needs iOS 26 on a phone with Apple Intelligence (iPhone 15 Pro or later), or the Simulator on an Apple
silicon Mac that has it turned on.

It starts on the plain test page. The bar at the bottom, left to right: back, reload, **pages** (the test
pages and a few real sites), **checks**, **wand** (outline, clipboard, the phone's model, forget), **Claude**
(shows the pane), **report**.

- **Checks → Run the checks on this page.** About twenty seconds; the last two reload the page. Run on all
  five test pages, then on real sites.
- **Long-press anything** on a page. The app marks it and offers Hide this, All N like it, or Wider. Reload:
  it's hidden before the page draws, because the rules are part of the script WebKit runs first.
  Note what the long press fights with: text selection, the page's own long-press menus.
- **Wand → Ask the phone's own model.** Say what bothers you; the model gets the page outline and picks a
  part; the app marks it and you confirm.
- **Claude in a pane.** Tap the bubble. Then, by hand:
  1. Can you sign in? Try email, then Google, then Apple. Which work? (A window Claude opens shows as a
     sheet.) Does the chat itself work, and does it stay signed in after you quit the app?
  2. Wand → Copy this page's outline for Claude. Paste it into the chat, and say what bothers you.
  3. Claude should answer with a link ending `/trif-install#hide=…`. Tap it. The app should stop the link
     and show "Add this mod?" with what it would hide. Add it.
  4. If Claude's page won't make it a link, copy the reply and use Wand → Add a mod from the clipboard.
- **Report → Share the report**, and send it to me. It names the sites you ran it on and which addresses
  Claude's pane went to (never what was typed or said there).

The app never puts a script into Claude's pane and never reads from it. It only watches which address the
pane is about to load, which every browser does.

## What isn't probed, because it's known

- **A content blocker in Safari.** Hide rules compiled into a Safari content blocker apply before paint and
  need no per-site permission. It's a separate extension type, how every ad blocker on iPhone works, and the
  same engine the browser probe's `blocker` checks use.
- **Sync and the catalogue.** iCloud key-value and document storage, and fetching signed static files, are
  ordinary and need a paid developer account to try. Nothing to learn from a probe.
- **Being a real browser.** Default-browser status, passkeys in a web view and service workers on every site
  each need an entitlement Apple grants on request (`com.apple.developer.web-browser`). The browser probe's
  `page.features` check shows what pages get without it.
- **Apple's review.** Running code written after review is the rule every userscript manager on the App Store
  already lives under. Whether Apple accepts it for TRIF is a question for a submission, not a probe.

## For whoever changes this

```
node mobile/prepare.js          # remakes shared/gen/ from extension/sandbox.js and browser-probe/checks.js
TRIF_BROWSER_TESTS=1 node mobile/test/smoke.js   # the Safari probe and the browser probe's JS checks, in Chrome for Testing
ruby mobile/browser-probe/make-project.rb   # rewrites the Xcode project (gem install xcodeproj)
```

- `shared/kit.js` is the code both probes put beside a page: naming an element, hiding, the outline, the marker.
- `browser-probe/checks.js` holds the browser probe's JavaScript checks as functions; `prepare.js` turns them
  into `shared/gen/browser-checks.json`, which the app reads. `Checks.swift` has the ones that need the app.
- `shared/gen/sandbox-runtime.js` is TRIF's sandbox runtime wrapped so a probe can start it inside a `try`.
  Run `prepare.js` after `extension/sandbox.js` changes; the smoke test fails when it's stale.
