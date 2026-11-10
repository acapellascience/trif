# Design note: mods that can't act (a safe tier)

Status: **rules: built** (main). **Sandboxed: built on the `sandbox-tier` branch** (Chrome and Firefox;
see "Sandboxed: what's built" below; spikes on `sandbox-spike` and `sandbox-standin`). `trif.filterResponse`
and themes: not built. Follows docs/SECURITY.md (0.3), which reads each mod's code (powers.js) and
holds mods that can act until the user allows them. That reading is careful but can never be a proof:
deciding what arbitrary JavaScript will do is undecidable, and a determined author can always compute a
name from page data at run time. This note is about the other way round: mods that **can't** act, so
there's nothing to detect.

## The idea

Most mods only change what the user sees. If they ran somewhere they physically couldn't send a request,
click, type or navigate, and got only what restyling and rearranging need, then:
- they'd never need a hold or a review, whoever wrote them (a side-panel agent, a terminal agent, a mod
  someone shared, a profile theme): the safety comes from where they run, not from reading them;
- the classifier would only police the remainder, the mods that genuinely need the page's own powers,
  which keep today's path behind review;
- sharing mods (themes, the "personal styling" idea) becomes safe by construction.

## Three tiers

| tier | what it is | can it act? | hold/review |
|---|---|---|---|
| **rules** | data, not code: CSS, plus declarative rules (hide/restyle/rename/move what matches a selector, replace text, filter list items by text) that TRIF executes | no: no code at all | never |
| **sandboxed** | JavaScript in an isolated world with the DOM, but no network, no synthetic input, no navigation, no code-from-strings, plus a small TRIF API | no (enforced by the world, below) | never |
| **page** | today's mods: JavaScript in the page's own world (`MAIN`), with everything the page has | yes | as now (powers.js + held.js) |

Agents write the lowest tier that does the job; AGENTS.md says so, and TRIF can suggest moving a page mod
down when its code would fit.

## What today's mods need

Rough sort of one user's 81 mods (Tim's, Nov 2026):
- **53** change the DOM: hide, move, replace or add elements, often with a MutationObserver
  (hide-sponsored-results, the YouTube feed mods, simple-home). Fit **sandboxed**; many of the hiding
  ones fit **rules**.
- **15** draw or play: canvas, Web Audio, animation (X-Flyer, robot sounds, fireworks). Fit
  **sandboxed** if the world keeps canvas, audio and requestAnimationFrame.
- **7** patch the page's `fetch`/XHR/`JSON.parse` to filter what comes back (Detox Timeline, the
  Instagram and Facebook feed filters). Need **page**, or a TRIF API that filters responses for them
  (below).
- **6** are close to CSS-only. Fit **rules**.
So most could be safe; the data filters are the hard core.

## Rules: the format

A mod file that is JSON (or a `// ==WebMod==` header with a `@rules` block), checked against a schema,
executed by TRIF's runtime:

```json
{ "match": ["https://x.com/*"],
  "css": "[data-testid=sidebarColumn] { display: none }",
  "hide": ["[data-testid=placementTracking]"],
  "text": [{ "in": "article", "replace": "Grok", "with": "the robot" }],
  "filter": [{ "items": "[data-testid=cellInnerDiv]", "hideIfText": "Promoted" }] }
```

- No free-form code, so nothing to inject; strings are only ever used as selectors, regexes (with a
  time limit) or text (set as textContent).
- CSS gets the same treatment as themes would: no `url()` to other sites (or only to the mod's own
  site), no `@import`, so a rule can't send what the page shows anywhere (attribute selectors plus
  `background: url()` can leak values otherwise).
- The runtime re-applies rules as the page changes (one shared observer for all rules mods), which is
  what most hiding mods hand-roll today.

## Sandboxed: the world (the design; what's built is below)

Chrome's userScripts API can run a script in a `USER_SCRIPT` world (and, since Chrome 133, a named world
per mod via `worldId`) configured with `chrome.userScripts.configureWorld({ worldId, csp, messaging })`.
That world shares the page's DOM but has its own JavaScript globals, so TRIF controls what's in it:

- **Network:** the world's CSP (`connect-src 'none'`; `default-src 'none'` for its own loads) and
  `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `Worker` removed from its global.
- **Code from strings:** the CSP without `'unsafe-eval'` blocks `eval`, `Function` and string timers in
  the world.
- **Synthetic input:** `HTMLElement.prototype.click`, `dispatchEvent` (for UI event types), `submit`,
  `requestSubmit`, `execCommand`, the clipboard, and the `MouseEvent`/`KeyboardEvent`/… constructors
  removed or wrapped in the world (its prototypes are its own).
- **Navigation:** `location` writes and `window.open` are blocked by wrapping, and as a backstop the tab
  lock's network rules (tablock.js) could apply to requests the world causes.
- **The escape hatches to close:** the DOM is shared, so the world could reach the page's world through
  it. Each needs a guard in the world's DOM:
  - inline handlers (`setAttribute('onclick', …)`, `on…` properties set to strings, `<img onerror>` in
    `innerHTML`) and `<script>`/`javascript:`/`srcdoc` all run code in the **page's** world: the
    world's `setAttribute`, `innerHTML`, `insertAdjacentHTML`, `createElement` are wrapped to refuse them
    (or sanitize through the Sanitizer API where it exists);
  - another frame's window (`iframe.contentWindow`, `window.frames`, `parent`, `opener`) has unwrapped
    prototypes: the world gets no way to reach other windows (the getters return null);
  - `src`/`href`/`url()` set to another site leaks data in a GET: the world's setters only take
    addresses on the mod's own site (or data:/blob:).
- **What it keeps:** the DOM (read and change), CSS, MutationObserver, canvas, Web Audio, timers and
  requestAnimationFrame, `localStorage` (the page's, shared: fine for settings), and the TRIF API.

The world's guards are TRIF's code, tested like tablock.js: an e2e "hostile sandboxed mod" that tries
every escape above and must fail at each.

## The TRIF API (for both tiers)

What the hand-rolled patterns become, so mods don't need the page's powers for them:
- `trif.css(text)`, `trif.hide(selector)`, `trif.observe(selector, fn)` (fires for each match, now and
  later; one shared observer), `trif.text(selector, fn)`;
- `trif.filterResponse(urlPattern, fn)`: the one the data filters need. TRIF's runtime (in the page's
  world, TRIF's own code) wraps `fetch`/XHR once; the mod's `fn` gets a copy of the parsed response and
  returns the filtered data, which the runtime substitutes. The mod never touches the page's `fetch`, so
  it can't send anything; it can only change what comes back. That moves Detox Timeline-style filters
  to **sandboxed**, except where they rewrite requests (Detox Timeline's "Recent" sort), which stays a
  reviewed power, or a declared, checked `trif.rewriteRequest(urlPattern, {params})` with a fixed list
  of allowed changes;
- `trif.settings(key, defaults)` (per-mod storage), `trif.log/warn/error` (as now).

## Open questions

- **Browsers:** `worldId` and `configureWorld` are Chrome 133+; Firefox's userScripts has worlds and
  `configureWorld` but per-mod worlds and CSP support need checking; Safari's userScripts is TRIF's own
  adapter (safari.js) and would need its own sandbox. A browser that can't sandbox runs sandboxed mods
  as page mods behind review (never silently unsandboxed).
- **Performance:** a wrapped DOM in the world costs something; measure on X's timeline with the feed
  mods.
- **Does CSP in a user-script world block its fetch?** Chrome documents the world CSP for script
  execution; whether `connect-src` applies to requests from the world has to be tested (if not, removing
  the globals plus the tab-lock rules is the network wall).
- **React-heavy sites:** some mods move or re-render elements React owns; doing that from another world
  is the same DOM, so should behave the same. Check with the X mods.
- **Rules expressiveness:** where the line sits between rules and sandboxed; start small (css, hide,
  text, filter) and grow only from real mods.

## A plan

1. **Rules tier**: schema, runtime support, `trif check` for it, AGENTS.md "prefer rules"; move the
   CSS-only and pure-hiding mods (shipped ones first) to it. No browser questions; immediate win. *(Built;
   moving the shipped mods: not yet.)*
2. **Spike the sandbox** in Chrome: one world, the guards, the hostile-mod e2e. Answer the CSP and
   performance questions. *(Done: branches sandbox-spike, sandbox-standin.)*
3. **`trif.filterResponse`**, then move the data filters. *(Not built.)*
4. **Sandboxed tier** for agents by default in Chrome; Firefox when it can; page tier stays for the rest.
   *(Built on branch sandbox-tier: AGENTS.md tells agents rules, then sandboxed, then page.)*
5. **Themes / shared styling** on top of rules (closed-world tokens, as discussed: no free text, no
   code).

## Sandboxed: what's built (branch sandbox-tier)

Built on the stand-in design proved on the `sandbox-standin` branch (its notes there: "Stand-in design"):
not a full browser world with the dangerous parts removed, but an empty one with what TRIF hands it. Working
notes, decisions and open questions: docs/SANDBOX-TIER-NOTES.md.

**Format.** `// @sandboxed` in the header (helper/lib/mods.js; `sandboxed: true` on the Mod). Never held
for its code (held.js), like a rules mod. `trif check` lists what the sandbox wouldn't give it, as a lint
(helper/lib/sandboxlint.js); `trif new --sandboxed`; `trif mods`/`status` say so.

**The world** (extension/sandbox.js). TRIF's userScripts world `trif-sandbox`, configured once per
background start with its own CSP (`connect-src 'none'`, loads only from data:/blob: and, for images, the
page's site; 'unsafe-eval' only for SES's evaluator) and messaging for TRIF's own code (settings). Where any
sandboxed mod runs, `trif-sandbox-runtime` loads SES (ses 2.3.0, Apache-2.0, extension/vendor, the npm
file byte for byte) and runs `lockdown()` once per page; each mod is evaluated in a Compartment of its own,
inside an async function. One world for all sandboxed mods, a compartment each (a world per mod would load
SES and lock down again per mod per page).

**What a mod has**: the language (frozen) and `page`, `trif`, `console`, the timers, `Math`, `Date`; no
`eval`, `Function`, `Compartment` in the compartment, and SES's `Function.prototype.constructor` throws.
Elements only as frozen stand-ins (one per node; one shared frozen prototype whose methods find the node in
a WeakMap), with allowlisted operations. The TRIF API: `trif.css`, `trif.hide`, `trif.observe` and
`trif.text` (one MutationObserver for every mod in the world), `trif.settings(key, defaults)` (per mod and
per site, in the extension's storage, not the site's), `trif.log/warn/error`. Errors are caught (top level,
callbacks, after an await) and kept in the world for `trif errors` / `trif logs`, which read them with
`userScripts.execute`. The API in full: TECHNIQUES.md "Sandboxed mods".

**The guards, as built** (each tried by the hostile e2e, below):
- network: no fetch/XHR/WebSocket/EventSource/beacon/Worker in the compartment; the world's CSP; images only
  data:/blob: or an address an image on the page already shows; links only this site's pages without a
  query; CSS only if it loads nothing (rules mods' check); no `<link>`, `<script>`, `<iframe>`, `<object>`,
  `<embed>`, `<form>`, `<input>`, `<style>`, `<svg>`, media...;
- code from strings: none in the compartment; timers take functions; no `on*` attributes, `javascript:`,
  `srcdoc`, `innerHTML`; no text written into `<script>`/`<style>` (an empty script the page made would run
  it) or form controls' text;
- other windows, frames, the page's globals and prototypes: not reachable (no window, frames by index or
  `contentWindow`); the language is frozen; stand-ins and their prototype are frozen; a browser error
  reaches the mod as a fresh TypeError (no DOMException object);
- synthetic input: stand-ins have no click/dispatchEvent/focus/submit; no event constructors;
- navigation: no location/open/history; no `target` attribute; no clicks;
- clipboard, cookies, storage, postMessage: none of navigator, document, localStorage, postMessage;
- the page's own code as the messenger (red team, RT-1): names a mod gives are TRIF's (`data-trif-*`, `trif-`
  ids and classes; the page's own ids and classes aren't a mod's to change), so htmx, Turbo, Stimulus and the
  like find nothing to act on; copies keep none of the page's;
- forms (RT-2): a mod's buttons are `type="button"` and never inside a form; the page's fields stay in the
  form they're in;
- keys (RT-4): which key was pressed in a field or editor doesn't reach a mod.

Not closed, for any tier that restyles (rules too): arranging the page so the user's own click lands on
something else (clickjacking, RT-3). Wording and a mitigation are proposed in docs/SANDBOX-TIER-NOTES.md.

**Browsers.**
- Chrome (138+; tested on 156): the sandbox as above.
- Firefox (153+; tested on 159): the same sandbox, and the hostile e2e passes as in Chrome (SES locks down
  in Firefox's user script sandbox; its world CSP governs eval). Two quirks of its messaging, handled:
  docs/SANDBOX-TIER-NOTES.md "Browsers".
- Safari: no such world (TRIF's own adapter, extension/safari.js). Each sandboxed mod waits for the user's
  OK, in the extension (`sandboxFallback` in lib.js: held by 'sandbox', with the reason), and once allowed
  runs as a page script with the same API (sandbox.js `sandboxPageCode`), in the Page scripts group. Never
  silently unsandboxed. The same applies to any browser whose `configureWorld` fails.

**The hostile e2e** (tests/e2e/scenario.js `sandboxedCheck`, fixture tests/e2e/fixtures/sandbox-hostile.js):
143 escapes tried (all refused or absent in Chrome 156 and Firefox 159); each must be refused or absent, the test server must see none of the `e2e-sbx-leak`
addresses, the page must notice nothing (its own listeners for clicks, keys, submits, messages and inline
code), its prototypes, form, script, style, link and image must be as they were, and the tab must stay where
it was with no new tab. Plus a good mod (restyle, hide, add, text now and later, observe, canvas, timers,
frames, a copy of a page image, listening, settings across a reload), errors and logs, the two sample ports
(examples/sandboxed), and the panel's group switch. Results: docs/SANDBOX-TIER-NOTES.md "Measurements".

**Not built**: `trif.filterResponse` (the data filters stay page scripts), themes.

## Design (not built): `trif.filterResponse` for sandboxed mods

The data filters (Detox Timeline and the Instagram and Facebook feed filters) patch the page's `fetch` and
`XMLHttpRequest` and rewrite what comes back. That needs the page's world, so they're page scripts today. A
sandboxed mod could do the same job if TRIF did the patching and only handed it the data:

```js
// a sandboxed mod
trif.filterResponse('https://x.com/i/api/graphql/*/HomeTimeline*', (data, { url }) => {
  for (const ins of data.data?.home?.home_timeline_urt?.instructions ?? []) {
    if (ins.entries) ins.entries = ins.entries.filter((e) => !e.entryId.startsWith('promoted-'));
  }
  return data;
});
```

**How it would work.**
- TRIF's page runtime (runtime.js, in the page's world, TRIF's own code) wraps `fetch` and
  `XMLHttpRequest` once, the way the recorder already does, on pages where a sandboxed mod has asked to
  filter (the registration carries the mods' URL patterns, so nothing is wrapped elsewhere).
- A response whose URL matches is read as text (JSON only; capped, like the recorder's 2 MB), and handed to
  TRIF's sandbox world **synchronously**, through a DOM event on a node only TRIF's two runtimes know about:
  the page runtime dispatches `CustomEvent(name, {detail: <JSON text>})`; the sandbox runtime's listener runs
  during the dispatch, parses the text, calls each matching mod's function on a copy (in its compartment),
  and answers with a second event carrying the JSON text back; the page runtime substitutes it (a new
  `Response` for fetch; the `responseText`/`response` getters for XHR, as Detox Timeline does now). Event
  dispatch is synchronous across worlds, and strings cross them (objects don't), which is why JSON text. A
  mod that throws or returns nothing leaves the response as it was.
- What the mod gets: plain data (parsed JSON) and `{url, method, status}`. It never sees the page's
  `fetch`, a request, or the response object, so it still can't send anything: it can only change what comes
  back to the page that asked for it.

**Why it's still safe.** The page can see and forge the events: it can feed the mod's function data of its
choosing (which only goes back to the page), and answer TRIF's runtime itself (its own data, to itself). The
mod can't use the channel to reach anything: the reply goes to the page that already had the data. The
event name, random per registration, is visible to the page once used (it can tell TRIF filters it, as it
can today from the patched `fetch`).

**What stays a page script.** Rewriting requests (Detox Timeline's "Recent" sort changes the request's
variables): it changes what the site receives. A later `trif.rewriteRequest(urlPattern, {params})` could
take a declared, checked list of changes; until then that part is a reviewed power.

**Spike (Nov 10, a one-off probe in the e2e, then taken out).** In Chrome 156 and Firefox 159, a
`CustomEvent` dispatched on `document` in the page's world reached a listener in a USER_SCRIPT world of
TRIF's *during the dispatch*, and that listener's answering event reached the page world's listener before
`dispatchEvent` returned: a synchronous round trip. A string `detail` crossed both ways, and so did a plain
object (cloned in Chrome; in Firefox it would arrive as an Xray wrapper of a page object, one more reason to
pass JSON text and parse it on TRIF's side, so the compartment only ever gets plain data). A 340 KB JSON
response (3,000 items) took 1.3 ms (Chrome) and about 1 ms (Firefox, 1 ms timer) for the whole round trip,
parse and stringify included. Not tried: the wrapping itself (fetch's `Response`, XHR's getters, as Detox
Timeline does), X's real responses, and streamed ones (NDJSON, server-sent events), which a text read would
hold open: those would be left alone.
