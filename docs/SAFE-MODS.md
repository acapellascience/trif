# Design note: mods that can't act (a safe tier)

Names (Nov 10): people see the tiers as **style mods** (this note's "rules"), **boxed mods** ("sandboxed")
and **free mods** ("page"); headers `@style` and `@boxed` (the old `@rules` and `@sandboxed` still work).
The code, storage and protocol keep rules / sandboxed / page.

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
  cap on what they read) or text (set as textContent).
- CSS gets the same treatment as themes would: no `url()` to other sites (or only to the mod's own
  site), no `@import`, so a rule can't send what the page shows anywhere (attribute selectors plus
  `background: url()` can leak values otherwise).
- The runtime re-applies rules as the page changes (one shared observer for all style mods), which is
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

The world's guards are TRIF's code, tested like tablock.js: an e2e "hostile boxed mod" that tries
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
  adapter (safari.js) and would need its own sandbox. A browser that can't sandbox runs boxed mods
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

## The rule behind the guards

**A boxed mod may only name things that are its own, or copy addresses the page already has.** Its ids,
classes and data attributes are `trif-box-` ones; the page's own names, and other mods', aren't its to set or
change; an address it puts on an image or a link is one the page already shows; what it writes goes into its
own elements, never into the page's forms or editors (write-drafts, the one exception, below). Each fix since the red team is this rule applied to
one more place the page's own code (or a free mod) reads. Every new piece of API, and every power
(docs/POWERS.md), is checked against it: a power that lets a mod name something of the page's, or an
address the page doesn't have, is a hole unless it's the power's whole point and narrowed (click names
declared selectors; go-to declared paths).

## Sandboxed: what's built (branch sandbox-tier)

Built on the stand-in design proved on the `sandbox-standin` branch (its notes there: "Stand-in design"):
not a full browser world with the dangerous parts removed, but an empty one with what TRIF hands it. Working
notes, decisions and open questions: docs/SANDBOX-TIER-NOTES.md.

**Format.** `// @sandboxed` in the header (helper/lib/mods.js; `sandboxed: true` on the Mod). Never held
for its code (held.js), like a style mod. `trif check` lists what the sandbox wouldn't give it, as a lint
(helper/lib/sandboxlint.js); `trif new --sandboxed`; `trif mods`/`status` say so.

**The world** (extension/sandbox.js). TRIF's userScripts world `trif-sandbox`, configured once per
background start with its own CSP (`connect-src 'none'`, loads only from data:/blob: and, for images, the
page's site; 'unsafe-eval' only for SES's evaluator) and messaging for TRIF's own code (settings). Where any
boxed mod runs, `trif-sandbox-runtime` loads SES (ses 2.3.0, Apache-2.0, extension/vendor, the npm
file byte for byte) and runs `lockdown()` once per page; each mod is evaluated in a Compartment of its own,
inside an async function. One world for all boxed mods, a compartment each (a world per mod would load
SES and lock down again per mod per page).

**What a mod has**: the language (frozen) and `page`, `trif`, `console`, the timers, `Math`, `Date`; no
`eval`, `Function`, `Compartment` in the compartment, and SES's `Function.prototype.constructor` throws.
Elements only as frozen stand-ins (one per node; one shared frozen prototype whose methods find the node in
a WeakMap), with allowlisted operations. The TRIF API: `trif.css`, `trif.hide`, `trif.observe` and
`trif.text` (one MutationObserver for every mod in the world), `trif.settings(key, defaults)` (per mod and
per site, in the extension's storage, not the site's), `trif.log/warn/error`. Errors are caught (top level,
callbacks, after an await) and kept in the world for `trif errors` / `trif logs`, which read them with
`userScripts.execute`. The API in full: BOXED.md (helper/workspace).

**The guards, as built** (each tried by the hostile e2e, below):
- network: no fetch/XHR/WebSocket/EventSource/beacon/Worker in the compartment; the world's CSP; images only
  data:/blob: or an address an image on the page already shows; links only this site's pages without a
  query; CSS only if it loads nothing (style mods' check); no `<link>`, `<script>`, `<iframe>`, `<object>`,
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
- the page's own code as the messenger (red team, RT-1; audit AU-3): names a mod gives are its own
  (`data-trif-box-*`, `trif-box-` ids and classes; not plain `trif-`, which free mods use and act on; the
  page's own ids and classes aren't a mod's to change), so htmx, Turbo, Stimulus, the like and free mods
  find nothing to act on; copies keep none of the page's;
- the audit (AU-1 to AU-9, branch sandbox-fixes-3): no writing into editors (text, elements, attributes,
  classes, removing; restyling stays); `attr('value')` null on fields, and no selector (anywhere, `trif.css`
  included) naming the `value` attribute or `:autofill`, or with a `\` escape; a select's options and
  custom elements (possible form fields) stay where they are in forms; `canvas()` only on the mod's own;
  a link only to `#…` or an address a link on the page already has (speculation rules and prefetchers fetch
  links with no click: tests/e2e/scenario.js specRulesCheck); `open` only on `<details>`;
- forms (RT-2): a mod's buttons are `type="button"` and never inside a form; the page's fields stay in the
  form they're in;
- forms, round 2 (RT-10): nor can a mod remove a page field, or what holds it, or write over it, or take off
  its value;
- keys (RT-4, RT-8): default-deny: which key was pressed reaches a mod only for the page itself or an element
  that can't be (or hold, in a shadow root, open or closed) a field or editor;
- editors (RT-9): what's typed into a contenteditable is hidden from mods (`.text`, `trif.text`, copies,
  attributes inside it).

Not closed, for any tier that restyles (rules too): arranging the page so the user's own click lands on
something else (clickjacking, RT-3). Wording and a mitigation are proposed in docs/SANDBOX-TIER-NOTES.md.

**Browsers.**
- Chrome (138+; tested on 156): the sandbox as above.
- Firefox (153+; tested on 159): the same sandbox, and the hostile e2e passes as in Chrome (SES locks down
  in Firefox's user script sandbox; its world CSP governs eval). Two quirks of its messaging, handled:
  docs/SANDBOX-TIER-NOTES.md "Browsers".
- Safari: no such world (TRIF's own adapter, extension/safari.js). Each boxed mod waits for the user's
  OK, in the extension (`sandboxFallback` in lib.js: held by 'sandbox', with the reason), and once allowed
  runs as a free mod with the same API (sandbox.js `sandboxPageCode`), in the Free mods group. Never
  silently unsandboxed. The same applies to any browser whose `configureWorld` fails.

**The hostile e2e** (tests/e2e/scenario.js `sandboxedCheck`, fixture tests/e2e/fixtures/sandbox-hostile.js):
156 escapes tried (all refused or absent in Chrome 156 and Firefox 159); each must be refused or absent, the test server must see none of the `e2e-sbx-leak`
addresses, the page must notice nothing (its own listeners for clicks, keys, submits, messages and inline
code), its prototypes, form, script, style, link and image must be as they were, and the tab must stay where
it was with no new tab. Plus a good mod (restyle, hide, add, text now and later, observe, canvas, timers,
frames, a copy of a page image, listening, settings across a reload), errors and logs, the two sample ports
(examples/boxed), and the panel's group switch. Results: docs/SANDBOX-TIER-NOTES.md "Measurements".

**Not built**: `trif.filterResponse` (the data filters stay free mods), themes.

## Design (not built): `trif.filterResponse` for boxed mods

The data filters (Detox Timeline and the Instagram and Facebook feed filters) patch the page's `fetch` and
`XMLHttpRequest` and rewrite what comes back. That needs the page's world, so they're free mods today. A
boxed mod could do the same job if TRIF did the patching and only handed it the data:

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
  `XMLHttpRequest` once, the way the recorder already does, on pages where a boxed mod has asked to
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

**What stays a free mod.** Rewriting requests (Detox Timeline's "Recent" sort changes the request's
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

## Powers (branch powers): named exceptions for boxed mods

Design: docs/POWERS.md. A boxed mod may ask for powers from a fixed menu (`// @powers sound, read-drafts`);
none of them sends anything. The helper reads them from the header (helper/lib/boxpowers.js), holds the mod
until the user approves that *set* (held.js keys `power:<name>`: an update with the same powers runs, a new
power waits for itself; the quiet ones, `sound`, `controls`, `mods`, `preload`, `embeds` and `media`, are listed but
never hold alone, while a warned combination one makes does: docs/POWERS.md "How approval works"), and passes the set to the
extension with the mod; the sandbox (extension/sandbox.js) gives each mod what its set grants and refuses
the rest. All twelve of 0.2 are built (phases 1 to 3), and the nine of 0.3 (below); phase 1's, with what each gives:
- `sound`: `trif.audio()`, TRIF's facade over Web Audio (oscillators, gains, filters, delays, panners,
  noise, sounds decoded from `data:audio/…;base64`): no address, no microphone, no worklet, no page media;
  browser errors reach the mod as plain TypeErrors.
- `controls`: the mod's own `input` (range, color, checkbox, number, text; autocomplete off, set by TRIF),
  `select`, `option`, `label`; no type=password, `autocomplete` or `name`; never inside one of the page's
  forms; `.value`/`setValue`, `.checked`/`setChecked` on its own only.
- `keys`: key and code wherever the focus is, except in fields and editors (accepting that a field in a
  closed shadow root can't be told apart).
- `read-drafts`: `.value` of the page's text fields, textareas and selects (not hidden, file or button
  inputs), `.text` of editors and attributes inside them, `data` on input events, keys in fields; password
  and card fields (`type=password`, `autocomplete` cc-*, current-password, new-password, one-time-code)
  never.
Each is tested both ways in the e2e (tests/e2e/scenario.js powersCheck, powers2Check, powers3Check): it
works when declared, and is refused (or empty) when not.

**The powers against the rule** ("a boxed mod may only name things that are its own, or copy addresses the
page already has"):
- `sound`: names nothing of the page's; sounds only from `data:` the mod carries. Fits.
- `controls`: the mod's own inputs, with its own `trif-box-` names (a label's `for` only a `trif-box-` id),
  never `name` or `autocomplete`, never inside the page's forms. Fits.
- `keys`, `read-drafts`: reads only; they name nothing and write nothing (`setValue` only on the mod's own
  controls; `attr('value')` stays null on the page's fields, `.value` is the read). Fits.
- `site-data` (built): the mod names nothing of the page's and sets no address; what it returns can only be
  what the site sent, removed or reordered. "In what the site sent", exactly: every string *value* in the
  output equals a string value in the input (no substrings, no joins: a cut URL is a new URL), and occurs no
  more times than in the input (no duplicating an address the page would fetch twice); the same for numbers
  and booleans (by type and value: `1` and `true` are different, so a count can't be bumped or a flag
  invented where the input had none); every object *key* in the output is a key somewhere in the input (a mod
  can't put an existing string under a new key the page would act on, like `media_url`); `null` is free
  (it's removing). Each filter is checked against the original response, so filters in a row can't build
  on each other's inventions. Removal and reordering do let a mod choose what the page sees, and so what it
  reports back to its own site (impressions); that's the site's own data going to the site. Fits.
- `page-data` (built): reads; plain copies with no functions or nodes, through events on the element. Fits.
- `search-box` (built): TRIF's own box, which the mod can't fill or read, going to the address in the
  header (the mod's own site, checked by the helper) with only what the user typed, on their Enter. The mod
  names nothing of the page's. Fits.
- `media` (built): `play`/`pause`/`setMuted`/`setVolume`/`seek` and a `.media` state (paused, muted,
  volume, time, duration) on the page's own `<video>` and `<audio>`; never their `src`. Names nothing; sets
  no address. Fits.
- `go-to` (built): `trif.goTo(where)` goes to a path the header lists, exactly (literal paths of the site:
  no query, `#` or `*`, checked by the helper, so a path the mod built can't carry data), or to an address a
  link on the page already shows, on the page's own origin (a copy; the hold names the site). Fits.
- `click` (built): `el.click()` only on an element matching an `@click words: selector` line (the words
  are what the hold shows; the selectors are under the same limits as everywhere in the box), and never one
  that would submit or reset a form (a submit or reset button or input, a button with no type in a form, a
  label for one of those), or a link (`a`, `area`) to another origin. The page's own element is named, but
  by the header the user approved, not the mod: the exception the power names, narrowed. A click on a
  `type=button` that the page's own code turns into a post can't be told apart: the hold lists what it
  may click, in words and selectors, so the user can say no. Fits as narrowed.
- `write-drafts` (built): `setValue` on the page's text fields and textareas (through the field's own
  setter and an `input` event, so the page's code sees the change), and the editor writes AU-1 refused
  (`setText`, adding, removing, attributes inside an editor). Never a password or card field (the same
  test as read-drafts), a hidden, file or other non-text input, or a select. It's the one power that writes
  into what's the user's: its whole point. **No made-up addresses**, the rule itself: a site can fetch an
  address in a draft before anything is posted (X's link cards, say), so the text a mod writes into a
  field or an editor may only have the addresses already in what the user typed there, or in a link on
  the page (not the mod's own). Anything that looks like one counts: `scheme://…`, `www.…`, a dotted name
  ending in letters (`evil.example`, `node.js`), an IPv4 address, with the full stops CJK text uses too;
  the check is on the whole text after the write (an editor's text around it too), so text joined across
  writes, or by a removal, is caught; compared without case. Two things it allows that the rest don't:
  plain text the mod wrote going into a post, and the page's own visible text going from one place into
  a post (a DM's text into a reply, say), both in what the user is about to post themselves. The hold
  says "can change what you type and paste on this site before you post it". Pasted or dropped files
  aren't touched.
- The combinations: below, "Combinations".
- `mods` (built): `trif.channel(name)` with `send(data)`/`on(fn)` between this page's boxed mods with
  the power, through TRIF (never the DOM), in plain data only (no functions, stand-ins or other objects
  JSON would drop silently), delivered later (a timer), with the sender's id. It names nothing; with the
  page-wide rules below it carries no read to an act that didn't ask for it. Fits.
  (In a browser without the sandbox, where a boxed mod runs as a free mod the user allowed, the channels
  live on the page's window, where the page could reach them: the free tier's terms.)
- **0.3's powers (WIDEN.md class B), against the rule.** Fits, as narrowed, unless it says *exception*:
  - `block-events`: names nothing but event types (the header's) and, for clicks, the header's selectors;
    sets no address. Fits. (What it does to the user: keeping the page from seeing a click on Cancel can
    stop the page acting; that's why clicks need a selector the hold shows.)
  - `page-events`: *exception*: it names the page's own event names, which aren't its own. Narrowed: only
    the names in the header (shown in the hold), never a browser event's, TRIF's (`trif:`) or a framework's
    (`htmx:`, `turbo:`, …); on the document only; the detail plain JSON with no address the page's links
    don't have (the write-drafts check).
  - `site-storage`: *exception*: it names the site's storage keys. Narrowed: literal keys from the header
    (a prefix at most), never one named like a login; cookies read only; what it writes has no new address.
    `@migrate`, the one-time import into the mod's own settings, names the keys its free version used, the
    same way, and is a need of its own on the hold.
  - `rewrite-requests`: *exception*: it names the site's request fields and changes what the site
    receives. Narrowed: literal values only (true, false, null, numbers, plain words: no address, no long
    text), fixed in the header and applied by TRIF's page side to same-origin requests; the mod's code has no
    part in it, so nothing it reads can ride on it. The hold says it changes what the site receives.
  - `image-variants`: *exception*: it makes a new address. Narrowed: TRIF makes it, from a picture the page
    shows, by the header's literal change on the header's host (the same host as the picture); the mod only
    picks which of the page's pictures. That choice reaches the host, which is why a read beside it warns.
  - `edit-uploads`: names nothing; the file TRIF makes carries only the mod's pixels, under the original's
    name and type. Fits. (What it reads can end up in the pixels: the read + edit-uploads warning.)
  - `embeds`: *exception*: the player's address is new. Narrowed: TRIF makes it from a link the page shows
    (the video's id kept, nothing else), only for the header's player, only after the user's own click on
    TRIF's button; no referrer, no top navigation, no credentials where the browser allows.
  - `local-fonts`: names nothing; a read the page couldn't make itself (the hold says the site could see it).
  - `preload`: names nothing; the page's own lazy pictures, at their own addresses. Fits.
  - `site-data`, widened: guards and several documents (nothing new: each document checked on its own);
    the page's embedded JSON and data globals: *exception*, the globals' names are the page's, from the
    header, never a browser name; an address the site sent may come back with whole query parameters taken
    out (a copy of an address the page already has, made shorter, never longer: same scheme, host, path and
    `#`, the rest of its parameters in order), and so may a link's `href`; only an address on the page's own
    site (its host without `www.`, or a host under it). Which parameters go is the mod's choice, so on an
    address another site gets (a picture, a tracker, a link out) the choice could carry what it reads there:
    another site's address comes back exactly as the site sent it, so the hold's "can't send anything" holds.
  - `search-box`, widened: `{link}` copies the path of a link the page shows (on the same site); the
    current host only when it's a host of the same site. Fits.
  - `go-to`, widened: `reload` (the same address), in-app moves only to pages go-to allows, and a query
    from a list in the header (*exception*: values from the header, plain words, never an address).
  - `media`, widened: the page's media events, with nothing about their source. Fits.


## Combinations (branch powers)

The table: `helper/lib/combinations.js`, written out in docs/POWER-COMBINATIONS.md. Every pair (210) and
triple (1330) of the 21 powers, each with the warning a hold shows or a one-line reason it adds nothing;
tests/combinations.test.js checks it covers all of them, that its reasoning holds (below), that the doc is
the table, that the counts here are its counts, and that the sandbox's page-wide rules follow it. The
twelve powers of 0.2 keep their literal table; the combinations with a power added in 0.3 follow rules,
by what each power is (a read, a way out, an act).

**How the table is reasoned.** No power sends anything a mod makes up, and the addresses a mod can reach
(links, images, go-to, click, search-box) are the page's own or the header's. So what a boxed mod reads can
leave the site only through a way out: what's posted, what's clicked (both public on most sites), what the
page's own code is told or sees, what the site keeps, which of the page's pictures and videos load, how
the page's media plays (another site's host sees those requests), and sound in the room. Everything else
stays on the site it came from, which already has it. The reads are `read-drafts`, `keys`, `site-data`,
`page-data`, `site-storage`, `local-fonts`, `image-variants` (the pixels of the pictures it loads) and
`edit-uploads` (the pictures the user attaches, before anything is posted); the rest see only what the page
shows.
- A read with a way out warns: `write-drafts` ("could put what it reads into something you post"),
  `edit-uploads` (into a picture you post), `click` ("could let what it reads decide what it clicks for
  you"), `page-events` (handed to the page's own code, which may post or send it), `site-storage` (kept
  where the site's own code, and boxed mods on later pages, find it), `block-events`'s function form (which
  of the user's actions the page's code sees), `media` (by how it plays), `image-variants` and `preload`
  (which pictures load), `embeds` (which video it offers) and `sound` (sounds a device nearby could pick
  up). Several are narrow channels (timing, a choice among the page's own pictures or videos, a listening
  device near the user), listed because they exist. `site-storage`, `image-variants` and `edit-uploads` are
  reads and ways out both, so they warn with the other reads.
- Acts that combine warn: `write-drafts` or `edit-uploads` with `click` or `page-events` ("could write a
  post and send it for you": a draft no longer waits for the user's own send), `go-to` with `click` or
  `page-events` (it acts where the mod takes the user), `go-to` with `site-storage` (it leaves something for
  a page's code to act on as it loads, then takes the user there: warned as go-to with page-events is),
  `block-events` with `click`, `page-events` or `go-to` (it keeps the user's clicks from the page and acts,
  or moves them, in their place), and `rewrite-requests` with `click` or `page-events` (the act's own
  request carries the header's change, with no one asking).
- Triples: a read with something that sends (`click`, `page-events`) and something that writes the post
  (`write-drafts`, `edit-uploads`, a read other than the picture it posts) ("could put what it reads into a
  post and send it for you"), and `go-to` with a sender and `write-drafts` ("could go to a page, write a post
  there and send it for you") are worse than their pairs; every other triple is "no more than its pairs"
  (their warnings show), or adds nothing (it reads nothing beyond the page and its acts don't combine; or it
  reads but nothing in it carries what it reads off the page).
- No added risk, with the reason in the table: reads together (unless one is also a way out); a read with
  `go-to` (only this site's pages, the header's, with the header's words in a query, or links the page
  shows, and the site can already see it), `search-box` (only what the user types, which the mod can't
  read), `controls` (the mod's own inputs: only what the user gives it on purpose), `rewrite-requests` (fixed
  in the header, made by TRIF) or `mods`; `mods` with anything (a channel between its own boxed mods, which
  the page-wide rules treat as one); acts that don't combine.
- Counts: 91 of 210 pairs warn; 32 of 1330 triples have their own warning; 952 more show their pairs'.

**The hold.** Each warned combination a mod has is a need of its own, keyed by its powers
(`power:together:keys+click+write-drafts`), so approving a pair doesn't cover a triple; the panel's
approval dialog lists them in the red box, the strongest first, one line each ("Together, it …"; the same
sentence once), `trif status` as "together, it …". A mod with more than three powers gets, instead, Tim's
general warning (key `power:together:many:<its powers>`, so the exact set): "Mods with many powers can act
in unspecific or powerful ways. Treat this with caution." Its combinations are still needs (without lines),
so a later version with fewer powers doesn't ask again for what the user allowed.

**Across mods: the page-wide rules** (extension/sandbox.js `ACT_PARTNERS`, `clickOk`, `signalOk`). Boxed
mods on a page see each other's elements (one `created` set), and with `mods` talk; so a combination split
between two mods, each without the warning, would slip past the hold. The sandbox keeps the powers of every
boxed mod that has run on the page, and refuses an act while another mod's power makes a warned pair with it
that the acting mod didn't ask for itself (and so its hold didn't show), unless the user approved both powers
for the site's boxed mods together (site approval, below):
- `write-drafts` (writing into a draft), `media` (play, pause, mute, volume, seek), `edit-uploads`,
  `image-variants`, `preload`, `embeds` (made, and clicked), `site-storage`'s writes (set, remove) and
  `block-events`'s function form, each beside a read: refused unless the acting mod has that read. (A block
  with no function decides nothing from what the mod reads, and isn't checked.)
- `click` and `page-events` beside a read, `block-events` or `rewrite-requests`: refused unless the acting
  mod has that power; and after another mod changed a draft or an attached picture, refused unless it has
  write-drafts or edit-uploads (it could be sent).
- `edit-uploads` as a read: counted for the mods that were handed a picture the user attached, not every mod
  with the power (which would stop every media mod beside an upload editor).
- `@migrate` reads the site's storage once, so it counts as `site-storage`, on the hold's combinations and
  in these rules.
- `go-to` beside `click`, `page-events`, `block-events` or `site-storage`: refused unless the mod going has
  that power (the other could act where it lands, keep the user's click from the page while it goes, or
  have left something for the page's code there); and `site-storage`'s writes beside `go-to`. go-to waits until the page's boxed mods have all started, and checks again then (a mod
  that starts later isn't in play before). And the page it lands on is marked (TRIF's background, and the
  tab's session storage, for 30 seconds): there, a boxed mod without go-to doesn't click or signal the
  page's code until the user's own click or key, so a mod that runs only on the page go-to leads to can't act
  there for the user. An in-app move marks the page it stays on.
- `sound` beside a read: refused only when the sound mod shares a `mods` channel with the reading mod
  (which could hand it what it reads), checked as the live sound starts, connects or changes. Beside a read
  it has no channel with, not enforced: the channel needs a listening device near the user and carries
  little, and enforcing it would stop every sound mod beside any hotkey mod (Tim's call). What a reading
  mod puts in its own elements, which the sound mod could read off the page, is that unenforced case.
- `site-storage` also reaches past the page: what a mod keeps there, a boxed mod on a later page (or in
  another tab) can read, where this page's mods aren't in play. That's why a write beside a read is refused
  here, and why a read with site-storage warns on its own.
Each refusal says which power, and that the user's OK for the two mods together lifts it. In a browser
without the sandbox (boxed mods run as free mods the user allowed), these rules don't apply: the free tier's
terms.

**Site approval** (branch crossmod; `helper/lib/sitecombos.js`). Before it, the only way for a mod to act
beside another mod's power was to ask for that power too, unused ("padding"), so its hold warned of things it
can't do (Style Encoder asked for page-data, image-variants and site-storage only to coexist with Follow
Status). Now a mod asks only for what it uses, and the user approves what a site's boxed mods can do together,
once per site:
- A site's boxed mods: those that run on it (a site they name, one under the other, or everywhere) and are on in
  some browser (each browser's helper records which boxed mods it runs, from what the extension registered:
  `$TRIF_HOME/switches.json`; a mod is off when every browser that knows it has it off: switched off, its group
  or TRIF off on its site, paused). Their powers together, the union (`@migrate` as site-storage), are what the
  site's mods can do together. A sensitive site of its own (mail.google.com, extension/lib.js "sensitive sites")
  is a site apart, as the extension runs it: only its own folder's mods, which run nowhere else, so neither
  google.com's mods nor all-sites ones are in its union, and its mods aren't in google.com's (each browser sends
  the sites of their own it knows of with modsApplied, `splits`, kept in switches.json).
- The site's approved union: allowed.json keys `site:<site>:<a>+<b>+…`, the whole union, under the mod whose
  hold carried it; the site's is every such key's powers, whichever mod's entry, so switching a mod off or
  deleting it never takes any away, and adding it again doesn't ask again.
- A mod whose powers add a holding power to the site's approved union, on a site with other boxed mods (a quiet
  one, `sound`, `controls`, `mods`, `preload`, `embeds` or `media`, only when it completes a warned combination in
  the site's union), asks: its card
  has its own powers and own combinations as before, then a box with three lists made from the union's powers,
  each list's items on one line: "Your {site} mods can:" (what they can do as you), "They can see:", "It could end
  up in:", the items it adds marked new, and a flag line when what they see and where it could end up aren't empty
  ("So something they read could be sent from your account.") and when they can click or signal and write drafts
  ("So they could post for you."). Wording and layout approved by Tim (2026-11-11). `trif status` prints the lists under the mod, one line each. Approving the mod approves
  the site's new union. A mod alone on its site asks nothing for it: the next one asks for both.
- Switched on, a mod that adds a holding power the site hasn't approved waits like a new one (held by
  'switch'; its row keeps its switch). Mods the user already has whose site's union isn't approved (from before
  site approvals): the newest with a power it adds asks in its review, and keeps running meanwhile.
- The helper sends each boxed mod its sites' approved unions (`siteOk`, `"<site> <a>+<b>+…"`, in its
  registration). `partnersOk`, `clickOk`, `signalOk`, `soundOk` and `arrivedOk` let an act X through beside
  another mod's power Y when both are in the approved union of the page's site (which act and partner make a
  combination: extension/pagewide.js, the one definition the helper reads too); otherwise refused, and the
  refusal goes in the mod's errors once per act on a page, whatever it catches. tests/sitecombos.test.js checks,
  for random sets of a site's mods, that the sandbox refuses exactly the pairs not both approved, and that
  approving what the holds asked lets every act through.
- Against the rule: it names nothing and sets no address; it only lifts refusals for powers the user was shown
  together, on that site. Fits.
The cost: a refusal can still happen where the site's union isn't approved (from before site approvals, until
the review's "Looks right"); the errors show in `trif errors`.
