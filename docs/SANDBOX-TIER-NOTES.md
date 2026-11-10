# Sandbox tier: working notes (branch sandbox-tier)

A running log of the overnight build of the sandboxed tier (docs/SAFE-MODS.md): decisions, measurements,
browser findings, open questions for Tim. Newest findings are folded into the sections, not appended.

## What was built

- `// @sandboxed` header (helper/lib/mods.js). A mod is `@rules` or `@sandboxed`, not both (an error).
  The hash of every other mod is unchanged (`sandboxed` only joins the hashed header fields when it's set),
  so seen.json and allowed.json keep matching.
- Never held for its code (held.js powersFor returns nothing for it, like a rules mod). A side-panel run's
  sandboxed mod is still held for an `@match` outside the run's site, or for `@risk 2`, exactly like a rules
  mod: those are about the run's scope, not about what the code can do.
- `trif check` on a sandboxed mod: parses it (inside an async function, as it runs), says it never waits,
  and lists, as a lint, what the sandbox wouldn't give it (helper/lib/sandboxlint.js): page-only globals
  (`window`, `document`, `fetch`, `localStorage`, ...), real-element members (`.innerHTML`,
  `.addEventListener`, `.click`, `.style.x`, ...), string timers, and the two source patterns SES refuses
  outright (`import(` and `<!--`/`-->`, even in strings and comments). Exit 0: a lint, not a hold.
- `trif new --sandboxed` (helper/templates/sandboxed.js), `trif mods` ("kind: sandboxed"), `trif status`
  ("registered (sandboxed)", "WAITING: ..." and `NO SANDBOX` in a browser without it, group names in
  `GROUPS OFF` / `NEW MODS`).
- extension/sandbox.js: the world's runtime and the API. lib.js: registration (`modToUserScript`,
  `sandboxRuntimeScript`, `syncUserScripts`), groups (`modGroup` → 'sandboxed'), the fallback
  (`sandboxFallback`). background.js: the world's configuration (`sandboxWorld`), settings storage
  (`onUserScriptMessage`), errors and logs from the world (`sandboxList`), Allow for the fallback.
- Panel: a **Sandboxed** group between Rules and Page scripts with its own per-site switch; Settings →
  New mods start → **Sandboxed** (default On).
- Examples: examples/sandboxed (ports of Simple Shopping and DVD Logo; not shipped mods, nothing scans
  that folder).

## Design decisions (for Tim to review)

1. **Built on the stand-in design** (SES Compartment in TRIF's userScripts world), not the removal design.
   No concrete reason found against it; the hostile e2e is the evidence.
2. **One shared world (`trif-sandbox`), one Compartment per mod**, not a `worldId` per mod. Chrome has
   per-mod worlds, but each world would load SES (237 KB) and run lockdown again, per mod, per page
   (measured below); compartments already separate the mods' globals, and the language is frozen for all of
   them. What mods share: the DOM (shared with the page anyway), TRIF's one MutationObserver, and the frozen
   intrinsics.
3. **Messaging is on for TRIF's world**, against the brief's "no messaging", for `trif.settings`. Without
   it, the only persistent storage the world can reach is the page's own (localStorage), which the brief
   asked to avoid: the site could read, change and detect the settings. With it, TRIF's runtime captures
   `chrome.runtime.sendMessage` before any mod runs and deletes `chrome`/`browser` from the world; mods'
   compartments never have them. The background accepts only `settings.get` / `settings.save` for a
   sandboxed mod it knows, for the site the *browser* says the sender is on (not the message), capped at
   64 KB per mod per site, 200 sites per mod. Network is still off (the world's CSP and no API).
   Alternative, one line each in sandbox.js and background.js: messaging off and settings in the page's
   localStorage under a TRIF prefix (what the page-script fallback does).
4. **Settings are per mod *and per site*.** Otherwise a mod matching two sites could carry what it read on
   one into the other's page (the shared DOM is a channel to the page it runs on).
5. **Addresses**: an image's `src` only `data:`/`blob:` or an address an image on the page already shows (so
   cloning the site's logo works) — never a new request, not even to the site itself (a GET there can do
   things: log out, unsubscribe, "like"). A link's `href` only this site's own pages *without a query*
   (`/url?q=https://elsewhere` is an open redirect on many sites), or `#...`. A link goes nowhere until the
   user clicks it.
6. **Text the browser would run or submit isn't written**: `setText`, `append('text')`, `before/after`, and
   `trif.text` refuse (or skip) `<script>`, `<style>`, `<textarea>`, `<option>`, `<select>`. An empty
   `<script>` the page made would otherwise run text written into it later, in the page's world; a page
   `<style>` would load `url()`s TRIF's CSS check never saw. `value` is only offered on `<progress>`/`<li>`.
7. **The mod's code runs in an async function**: top-level `return` and `await` work (the settings API is a
   promise); rejections after an await are reported as the mod's errors.
8. **Code from strings**: the compartment has no `eval`, `Function` or `Compartment` (set undefined), and
   SES's tamed `Function.prototype.constructor` throws, so not even code confined to the compartment can be
   built from strings. The world itself allows 'unsafe-eval' because SES needs it to evaluate the mod.
9. **Errors**: anything a browser API throws (a DOMException, say) reaches the mod as a fresh TypeError with
   the message, so no object from outside the compartment's intrinsics leaks through an error.
10. **Group of a sandboxed mod in a browser without the sandbox: "Page scripts"**, since that's how it runs
    (or would) there. So switching Page scripts off on a site also covers them.
11. **Fallback hold lives in the extension**, not the helper: held.json is shared by every browser, and the
    hold is about where a mod can run in *this* browser. Allow (panel only) stores the allowed hash in
    `unsandboxedOk`; a new version waits again. No `trif approve` for it (like the group switches).

## Browsers

- **Chrome** (138+, the extension's minimum; tested: Chrome for Testing 156, headless): everything above.
  `configureWorld` with `worldId`, a CSP and messaging (133+), `userScripts.execute` with a `worldId` for
  reading the world's errors and logs (135+), `runtime.onUserScriptMessage` (120+).
- **Firefox** (153+, the add-on's minimum; tested: Firefox 159, headless): **hosts the sandbox too**, and the
  hostile e2e passes there exactly as in Chrome. MDN's compat data: `userScripts.configureWorld` and
  `worldId` since 136, `execute` since 153; Firefox's own test (test_ext_userScripts_mv3_csp.js) checks that
  a world's CSP governs `eval`, which is all SES needs from it here (TRIF doesn't rely on the CSP for the
  network: the compartment has no network API, and stand-ins refuse addresses; the e2e's server log shows
  nothing reached it in either browser). SES's `lockdown()` works in Firefox's user script sandbox (Xray
  wrappers and all). Two Firefox quirks, both handled in background.js `listenToSandbox`:
  - `runtime.onUserScriptMessage` exists only once the optional userScripts permission is granted, and a
    listener on `chrome.runtime`'s event (the namespace TRIF had touched before the grant) never heard a
    user script's message, while one on `browser.runtime`'s did (seen with a probe in the e2e);
  - taking the permission away and giving it back drops the listener: it's added again on each grant.
  In Firefox, `TextEncoder`/`TextDecoder` aren't on the compartment's global (68 names vs Chrome's
  70); `performance.now()` is 1 ms coarse there, so its timings below are rounded.
- **Safari**: no world of TRIF's own (its userScripts is TRIF's adapter, extension/safari.js, which runs
  page scripts). Every sandboxed mod waits for the user's OK there, held by the extension with the reason
  "Safari can't run sandboxed mods, so here it would run as a page script, with everything the page has",
  under Page scripts; Allow runs it as a page script with the same API (sandbox.js `sandboxPageCode`).
  Not run in Safari tonight (no Safari e2e); the page-script form is tested in Chrome and Firefox (e2e
  `sandboxPageFormCheck`: the API works in the page's world) and the hold in unit tests
  (tests/extension.test.js `sandboxFallback`). Any browser whose `configureWorld` fails gets the same.

## Measurements

From tests/e2e/scenario.js `sandboxedCheck` (sandbox-<browser>.json in the run's output), test page with
1000 cells and five sandboxed mods (hostile, good, throws, the two samples) plus one page mod:

| | Chrome 156 | Firefox 159 |
|---|---|---|
| SES loaded in the world (per page where a sandboxed mod runs) | 2.3-2.8 ms | 3 ms |
| `lockdown()` (once per page) | 5.8-6.9 ms | 4-5 ms |
| a mod's first run (compartment + its top level) | 0.2-3 ms | 0-6 ms |
| restyle 1000 elements through stand-ins (`style()`) | 3 ms | 2 ms |
| the same in a page mod (`el.style.setProperty`) | 0.4 ms | 0-1 ms |
| DVD port, per frame (TRIF's callback + the mod's step) | 0.11-0.13 ms | 0.11-0.18 ms |
| names on the compartment's global | 70 (page's world: ~1,240) | 68 |

So: about 8-10 ms once per page for the sandbox to start (at document_start, before any mod), then mods
cost about what they do; stand-ins are 5-8x a direct DOM call on a hot loop (still ~3 µs an element). A
world per mod would pay the 8-10 ms per mod per page, hence one shared world. Not measured on a real site
(no network tonight); X's timeline with the feed mods is the next thing to time.

## Hostile e2e: results

Final runs (Chrome 156: 56 of 56 checks passed; Firefox 159: 61 of 61): 123 escapes tried by
tests/e2e/fixtures/sandbox-hostile.js, every one refused (TRIF or the language said no) or absent (the thing
isn't there), in both browsers; the test server saw none of the `e2e-sbx-leak` addresses; the page's own
listeners saw no click, key, submit, focus or message and no inline code ran; its prototypes were untouched
(and not frozen: lockdown stays in TRIF's world); its form, empty script, style element, link, image, button
handler and frame were as they were; the tab stayed on the page and no tab opened. By category:
- network: fetch, XMLHttpRequest, WebSocket, EventSource, WebTransport, RTCPeerConnection, Worker,
  SharedWorker, navigator (so sendBeacon), Image, Request, importScripts: absent; images at another site,
  at this site with a query, at a new address on this site, the page's own image pointed elsewhere: refused;
  CSS `url()` (trif.css, style values), `image-set()`, `@import`, an escaped `u\72l(`, `@font-face`, a
  selector closing trif.hide's rule: refused; `<link>`, `<script>`, `<iframe>`, `<frame>`, `<object>`,
  `<embed>`, `<form>`, `<input>`, `<meta>`, `<base>`, `<style>`, `<svg>`, `<video>`, `<audio>`, `<source>`,
  `<template>`, `<portal>`: refused; a link to another site or to this site with a query: refused.
- code from strings: eval, Function, Compartment, lockdown, harden: absent; the Function, async function and
  generator constructors reached through functions: refused (SES); a string timer: refused.
- inline code: onclick on the page's button, onerror on a new image, a `javascript:` link, `srcdoc`:
  refused; `innerHTML` (frozen stand-in), `insertAdjacentHTML` (not there): refused; text into an empty
  script the page made (setText, append), CSS into the page's style element: refused; trif.text over it:
  skipped (nothing written).
- other windows, frames, the page: window, document, self, top, parent, frames, opener, location, history,
  storage, caches, cookieStore, chrome, browser, postMessage, open, alert, the page's own globals, event
  constructors, MutationObserver, getComputedStyle, DOMParser, customElements, trustedTypes: absent; no
  browser names on the global; a frame's window/document, into a frame, a frame by index: absent; the
  language's prototypes, a stand-in and its prototype: refused (frozen); a stand-in method on something TRIF
  didn't make: refused; a DOMException through a selector, classes or a canvas: arrives as a plain TypeError.
- synthetic input: click(): refused (not there); dispatchEvent, focus, submit, requestSubmit: absent; a form
  field's value, a textarea's or option's text: refused; execCommand: refused (no document).
- navigation: location, window.open, a `target` attribute, a target=_blank link's click: refused.
- clipboard, cookies, localStorage, postMessage: refused (none of them there).

## Open questions

- **Script gadgets**: the page's own code reacts to the DOM. A sandboxed mod can set `class`, `id` and
  `data-*` on elements; a framework that runs code from attributes it finds (Alpine's `x-*` isn't offered,
  but knockout's `data-bind`, htmx's `data-hx-*`, Turbo's `data-turbo-method`) or a page that reads
  `window.<id>` (DOM clobbering) could be driven that way. Not closed. Options: only `data-trif-*` on
  elements the page made, or no `id`/`data-*` on page elements at all.
- **Forms**: values aren't writable, but a mod can move a page's fields between forms (what's submitted
  changes) or add a `<button>` inside a form (the user's click submits it). Deception, needing the user's
  click; not closed.
- **Deceiving the user by what's shown** (any mod can, rules mods too).
- **Denial of service**: a mod looping forever hangs the page (one thread); SES doesn't contain it.
- **Keystrokes**: `page.on('keydown')` lets a mod see what's typed on the page; it can't send it anywhere,
  and settings are per site, but it can show it.
- **Page CSP**: a `<style>` element from the world on a page whose CSP forbids inline styles (style-src
  without 'unsafe-inline'): not tested. In Chrome the world's own CSP may cover it.
- **API gaps found while porting**: CSS masks with the site's images, `getBBox`, drawing images on a canvas
  (`drawImage`), focus/scrollIntoView. Each is a deliberate addition.
- **Where SES loads**: the sandbox runtime goes wherever any sandboxed mod *matches*, ignoring excludes and
  per-site switches (those only stop the mods). A sandboxed mod for every site costs ~8-10 ms on every page
  load. Could carry the excludes common to all sandboxed mods.
- **Settings of a deleted mod** stay in `sandboxSettings` (capped per mod); not cleaned up yet.
- **`trif approve`** doesn't reach the extension's sandbox hold (Safari): Allow is in the panel only, like
  the group switches.
- **Safari not run** tonight (no Safari e2e); its path is the page-script form (tested in Chrome and
  Firefox) plus the hold (unit tests).

## New UI text (for Tim's review)

Side panel:
- Group heading **Sandboxed**, with the line *Run in TRIF's sandbox: they can't send, click or load anything.*
- Settings → New mods start: a **Sandboxed** row (On / Off, default On).
- Tag tooltip on a new sandboxed mod that started off: *New sandboxed mods start off (Settings): switch it on
  once you've looked at it.* (the existing sentence with the new group name).
- A sandboxed mod on hold in a browser without the sandbox: head *Waiting for your OK.*; facts *Safari can't
  run sandboxed mods, so here it would run as a page script, with everything the page has* (then any of
  *as a page script, it <TRIF's usual fact>*); note *Allow runs this version as a page script, in this browser
  only.* Buttons: Allow (on the row), Show code.
- Errors via the existing "Couldn't switch …" note: *Couldn't switch Sandboxed on/off: …*

CLI and agents (trif status / mods / check / new, help): `registered (sandboxed)`, `registered (sandboxed mod,
run as a page script: the user allowed it, as this browser has no sandbox)`, `WAITING: <reason>; only the
user can allow that, in the side panel`, `NO SANDBOX    <browser> can't run sandboxed mods: each waits for
the user's OK (in the side panel) to run as a page script instead`, `kind: rules (…)` / `kind: sandboxed
(…)` in trif mods, `sandboxed mods` in GROUPS OFF / NEW MODS, trif check's sandboxed output and lint lines,
`trif new --sandboxed`, the template's comments, and the mods' own error messages (`TRIF sandbox: …`).

## Packaging

- extension/vendor: SES 2.3.0's `dist/ses.umd.min.js` byte for byte from npm (sha256 in README.txt), its
  Apache-2.0 LICENSE and the four licenses it ships for code it includes (aura, caja, core-js, v8). TRIF's
  own LICENSE (MIT) doesn't mention them yet.
- `web-ext lint` on the Firefox build: two new warnings, both `DANGEROUS_EVAL` in vendor/ses.umd.min.js (SES
  makes its evaluator with the realm's Function); no new errors. AMO may ask where the minified file comes
  from: the npm package, unchanged.
- The Chrome build: the world needs no new permission (userScripts already), nor web_accessible_resources
  (the browser injects vendor/ses.umd.min.js as a user script file).
