# Design note: mods that can't act (a safe tier)

Status: proposal, not built. Follows docs/SECURITY.md (0.3), which reads each mod's code (powers.js) and
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

## Sandboxed: the world

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
   CSS-only and pure-hiding mods (shipped ones first) to it. No browser questions; immediate win.
2. **Spike the sandbox** in Chrome: one world, the guards, the hostile-mod e2e. Answer the CSP and
   performance questions.
3. **`trif.filterResponse`**, then move the data filters.
4. **Sandboxed tier** for agents by default in Chrome; Firefox when it can; page tier stays for the rest.
5. **Themes / shared styling** on top of rules (closed-world tokens, as discussed: no free text, no
   code).

## Spike results (Chrome 156, Nov 2026)

Built on the `sandbox-spike` branch: a `// @sandboxed` header registers the mod in a userScripts
`USER_SCRIPT` world of TRIF's (`trif-sandbox`), configured with `configureWorld` (a restrictive CSP:
`default-src 'none'; connect-src 'none'; …`, messaging off), with a TRIF prelude first that removes the
network and synthetic-input APIs from the world's globals. Firefox and Safari refuse to register sandboxed
mods (an error says so). Measured by tests/e2e/scenario.js `sandboxSpikeCheck`: three copies of one probe
mod on a test page, in the sandbox world, in a second world with the same CSP but no prelude
(`@sandboxed csp-only`, the spike's measuring variant), and in the page's world; the test server's request
log is the ground truth for the network.

| | sandbox world (CSP + prelude) | same CSP, no prelude | page's world (today's mods) |
|---|---|---|---|
| a global the page defined | not reachable | not reachable | reachable |
| `fetch` / `XMLHttpRequest` / `.click()` / `KeyboardEvent` | not there | there | there |
| a `fetch` to the page's own server | not attempted (no fetch) | rejected ("Failed to fetch"); server saw nothing | resolved; server saw it |
| change the DOM, add a style element, canvas, timers | available | available | available |
| styling 1000 elements | 1.1 ms | 1.2 ms | 0.7 ms |

What this answers:
- **The page's code is out of reach**: the world has its own globals; a page global isn't visible there.
- **The world's CSP alone blocks `fetch` from the world** (connect-src): with the prelude's removal on
  top, the network APIs aren't even there. The CSP is the wall; the prelude is belt and braces.
- **What restyling needs works**: DOM, styles, canvas and timers are all there.
- **Cost**: a little slower than the page's world on a 1000-element pass (about 0.4 ms here); not
  measured yet on X's timeline with the real feed mods.

Still open (not measured here):
- What the page loads because of elements a sandboxed mod adds or changes (the shared DOM): the guards
  described above are not built yet, and this spike didn't test them.
- Navigation from the world, and frames.
- Per-mod worlds (one world for all sandboxed mods today: they share its globals).
- Firefox's and Safari's support; the timing on real sites.
