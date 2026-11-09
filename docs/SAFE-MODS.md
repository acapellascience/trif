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

## Spike results, part 2: the shared elements (Chrome 156, Nov 2026)

The world's element tools are now TRIF's, installed by the prelude and allowlist-based
(`sandboxPrelude` in extension/lib.js): new elements only of harmless kinds; attributes only from a safe
list, an address only `data:`, `blob:` or the page's own origin, no event handlers; HTML strings cleaned by
TRIF's own allowlist cleaner (Chrome's Sanitizer API isn't used: its defaults let images load from any
address); nodes put into the page from outside it checked the same way (elements already in the page may
be moved); CSS from the world only if it loads nothing (style properties through a checking stand-in for
`element.style`, since Chrome handles `style.backgroundImage = …` by name, out of reach of the
prototypes); `trifCSS(text)` for style sheets; other frames' windows and documents null; and a Navigation
API listener that cancels navigations to another origin a person didn't start.

Measured by a probe mod in each world on the test site (tests/e2e/scenario.js sandboxSpikeCheck), with the
test server's request log as the ground truth for anything that would load (raw:
docs/sandbox-spike-results-2.json). "CSP only" is the same world without TRIF's prelude, for comparison.

| Category | TRIF's world | CSP only |
|---|---|---|
| 1. New elements that load or run things (script, iframe, object, embed, link, meta, base, style, form) | all refused | all made |
| 2. An address on a new or existing element (img src as property and attribute, a page link's href), an onclick attribute | all refused; nothing reached the server | set; images not loaded (the world's CSP stopped them), the onclick set |
| 2. Same-origin and data: images | allowed | allowed |
| 3. HTML strings with an outside image, an inline handler (innerHTML, insertAdjacentHTML) | cleaned: no request, the handler never ran, harmless markup kept | the inline handler ran in the page's world |
| 4. CSS loading from another address (style property, setProperty, cssText, a style sheet) | all refused; nothing reached the server | all loaded (the server got each) |
| 5. Another frame's window or document | `contentWindow`/`contentDocument` null; **`window[0]` still reaches the frame's document** | reachable |
| 6. Navigating to another origin (script-started) | cancelled: the server never saw it, the tab stayed | went through |
| Restyling: text, style, hiding, a div and button with text, a style sheet (trifCSS), canvas | all work | all work |

1000-element restyle: 2.7 ms in TRIF's world (with the stand-in for `style`), 1.5 ms CSP only, 0.7 ms in
the page's world, on the test page. The `style` stand-in is the main cost; not timed on a real site.

Also seen: in the CSP-only world, images the world made didn't load (its CSP applies to them), but CSS it
wrote did, and an inline handler it wrote ran in the page's world. The CSP alone isn't enough; TRIF's
element tools close what it leaves.

Still open:
- `window[0]` (and other frames by index) reaches a same-origin frame's document, where TRIF's tools
  aren't installed; indexed frame access can't be removed from the world. (Not refusing to create frames
  covers new ones; frames the page already has remain.)
- Custom events and messages to the page's own listeners (a CustomEvent the page listens for).
- Writes to the page's storage and cookies, which the site reads later.
- Deceiving the user by what's shown (any mod can).
- Per-mod worlds; Firefox and Safari; timing on real sites.

## Stand-in design (branch sandbox-standin, Chrome)

The sandbox above is built by removal: a full browser world, with what's known to be dangerous taken out,
so anything nobody thought of (or that Chrome adds later) is reachable until someone notices. The stand-in
design starts empty instead: a mod reaches only what TRIF hands it.

**Mechanism.** Secure EcmaScript (SES, the `ses` package 2.3.0, Apache-2.0; `extension/vendor/`,
237 KB minified, shipped inside the extension, no network loads). In TRIF's own userScripts world
(`trif-standin`: connect-src 'none', no messaging; 'unsafe-eval' because SES evaluates code inside its
compartment), `lockdown()` freezes the JavaScript language once per page, then each `// @sandboxed standin`
mod's code is evaluated in its own `Compartment`, whose global holds only the language and TRIF's
endowments. SES also drops language built-ins newer than it knows (Chrome 156's new iterator helpers, here).
The code: `extension/standin.js`.

**What's granted** (everything else is absent, not blocked):
- `page`: `find`/`findAll` (selectors), `create(tag)` (an allowlist of tags), `css(text)` (CSS that loads
  nothing, the rules-mod check), `observe(selector, fn)` (now and as the page adds them), `on(type, fn)`
  (an allowlist of input events, read as plain data), `url`, `title`, `width`, `height`, `root`, `body`,
  `prefersReducedMotion`.
- Elements only as stand-ins: frozen TRIF-made objects, one per node, the node itself never handed out:
  `text`/`setText`, `attr`/`setAttr`/`removeAttr` (an allowlist; `href` on `a` and `src` on `img` only for
  this site's addresses or data:/blob: images), `classes`, `style(prop, value)` (values that load nothing),
  `hide`/`show`, `find`/`findAll`/`closest`/`matches`, `parent`/`children`, `append`/`prepend`/`before`/
  `after`/`remove`, `clone()` (a copy keeping only allowed elements and attributes), `rect()`, `on(...)`,
  and `canvas()`: 2D drawing with numbers and text only.
- `timers` (functions only: `setTimeout`, `setInterval`, `onFrame` and clears), `trif.log/warn/error`,
  `trif.settings(key, defaults)` (the mod's own namespaced settings, not the site's storage), `Math`, `Date`.

**Measured** (tests/e2e/scenario.js standinCheck, headless Chrome 156; outcomes only):

| | Result |
|---|---|
| Names on a stand-in mod's global | 63, against 1,239 on the page's world. Beyond the language (Node's bare global as the reference): `page`, `timers`, `trif` (TRIF's), `harden`, `lockdown`, `Compartment` (SES's), and `Temporal`, `TextEncoder`, `TextDecoder` (built-ins SES passes through: data transforms with no reach). |
| `window`, `document`, `fetch`, `XMLHttpRequest`, `localStorage`, `location`, `navigator`, `chrome`, `setTimeout`, `postMessage`, `Image`, `URL`, the page's own global | all `undefined` |
| An image pointed at another site (`setAttr('src', …)`) | refused; the test server saw nothing |
| Restyling: a style, a style sheet, a new element with text, a canvas drawing, a timer | all work |
| Sample: Simple Shopping (docs/standin-samples/amazon.com) on a page shaped like Amazon's results | the sponsored row and the "Customers also bought" carousel hidden, the plain results kept |
| Sample: DVD Logo (docs/standin-samples/www.google.com) | the logo hidden, its copy bouncing |
| 1,000 elements restyled | about 2 ms, against 0.7 ms for a page mod |

**Porting the samples, how it felt.** Simple Shopping went over almost unchanged: its CSS through
`page.css`, its observer as `page.observe`. The DVD logo needed real changes, which are the API's gaps:
copying an element (added as `clone()`), "reduce motion" (added), and two things left out: tinting a
same-site image with a CSS mask (a mask's `url()` to the site isn't offered) and measuring an SVG's drawn
box (`getBBox`). So: hiding, filtering and restyling fit well; effects that lean on browser APIs need each
API added, deliberately, as a stand-in.

**Still open.**
- Each mod's own compartment shares one locked-down world per page (one `lockdown`); compartments can't
  reach each other's endowments, but a world per source (see above) would separate them further.
- `trif.settings` lives in the site's localStorage under a TRIF prefix: the mod can't touch the site's
  keys, but the site can read the mod's.
- Listening to the page's input events (`on`) means a stand-in mod can see keystrokes on the page; it has
  no way to send them anywhere, but that's a capability to say out loud.
- Denial of service (a mod looping forever) isn't contained: SES doesn't, and the world's one thread is
  the page's.
- Firefox and Safari: not tried. Timing on real sites: not measured. The API is a first cut.
