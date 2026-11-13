# TRIF's three mod tiers: what each one guarantees, and how far to trust it

A brief for outside reviewers. Branch `powers` of https://github.com/acapellascience/trif (the 0.3.0 line;
not yet on main or in a release). Paths below are relative to the repo root. The longer design notes are
docs/SAFE-MODS.md (tiers, guards, powers, combinations), docs/SECURITY.md (the agent, the tab lock, the
code reading) and docs/POWERS.md.

## What TRIF is, in one paragraph

A browser extension (Chrome, Firefox; Safari adapter) plus a local helper (Node) that lets a coding agent
write "mods": scripts and styles that run on a site every time the user visits it, logged in. The threat
model: a mod's author may be hostile, either directly (a shared mod) or because the agent that wrote it read
a hostile page and was steered (prompt injection). What such a mod wants: act as the user (post, DM, follow:
the step that turns one infected page into a worm), send what it reads somewhere, or keep doing either
unseen.

## The tiers at a glance

| tier | header | runs as | the guarantee | what it rests on | how strong |
|---|---|---|---|---|---|
| Style mod | `// @style` (old: `@rules`) | data, executed by TRIF: CSS plus declarative hide/restyle/replace-text/filter rules | can't send, click, type or navigate; its CSS loads nothing | there is no code; CSS checked for anything that loads | strong (small surface), except clickjacking |
| Boxed mod | `// @boxed` (old: `@sandboxed`) | JavaScript in an SES Compartment in a separate user-script world, with frozen stand-ins for elements | can't send, click, type, navigate, read typed text or change form submission, unless the header names a power the user approved | the world's CSP, SES lockdown, an allowlist of operations on stand-ins, one design rule (below) | argued and adversarially tested, not proven |
| Free mod | none | JavaScript in the page's own world, with everything the page has | none at run time; the mod waits for the user's OK if TRIF's reading of its code finds it can act | a static reading of the code (helper/lib/powers.js) and a hold (helper/lib/held.js) | a checkpoint for honest code and lazy attacks, not a boundary |

Free mods are first-class on purpose: a user may run any code they choose. The two safe tiers exist so that
most mods never need that trust.

## 1. Style mods

**What runs.** No mod code. TRIF's runtime applies the rules: selectors, text replacements (as
textContent, never inside an editor), regexes (checked for nested repeats, and run on at most 20,000
characters of a text node; there is no time limit), one shared MutationObserver.

**The guards.** The CSS may not load anything: no `url()` other than `data:` (boxed mods: also `#fragment`
and an image the page shows), no `@import`, `image-set()`, `src()` and the like, no escapes outside strings
that could spell one, no selector on the `value` attribute or `:autofill` (attribute selectors plus a
loading background would leak field values otherwise). The check reads the text the way a browser parses it
(`cssScan`, the same in helper/lib/rules.js and extension/sandbox.js): a quoted string ends at a line break,
and an unquoted `url()` is one token. Before the November review it read a string on to the next quote and
took `/*` inside a `url()` for a comment, so CSS could sit where the check saw a string or a comment and the
browser saw rules; tests/css-browser.test.js runs every allowed case in a real browser.

**Known gap: clickjacking (RT-3, open, tier-wide).** CSS can make a real control invisible and float it over
a decoy, so the user's own click lands on it. Not closed in code; the panel's wording doesn't claim
otherwise. A partial fix for boxed mods' `style()` is proposed in docs/SANDBOX-TIER-NOTES.md, not built.

**Code:** helper/lib/rules.js (format and the CSS check), extension/lib.js (the runtime), helper/lib/mods.js
(headers).

## 2. Boxed mods

**The world.** Chrome 138+ / Firefox 153+ `userScripts` world `trif-sandbox`, with its own CSP
(`connect-src 'none'`; loads only from data:/blob: and, for images, the page's own site; `'unsafe-eval'`
only for SES's evaluator). SES 2.3.0 (`lockdown()`, `errorTaming: 'safe'`; the vendored file's sha256 is
pinned and checked at build and in tests). Each mod gets its own Compartment with: the frozen language,
`page`, `trif`, `console`, timers (functions only), `Math`, `Date`, and some pure tools (TRIF's own frozen
`URL`, `TextEncoder`, `structuredClone`…). No `eval`/`Function`/`Compartment`, no `window`, `document`,
`navigator`, storage, `postMessage`, network constructors, or event constructors.

**Elements are stand-ins.** One frozen object per node, sharing one frozen prototype whose methods look the
node up in a WeakMap and do only allowlisted things. No `click`, `dispatchEvent`, `focus` on the page's
elements, `submit`, `innerHTML`, `on*` attributes, `javascript:`, `srcdoc`, `target`; no creating
`script`, `style`, `link`, `iframe`, `object`, `embed`, `form`, `input` (without a power).

**The design rule** every guard and power is checked against: *a boxed mod may only name things that are
its own, or copy addresses the page already has.* Its ids, classes and data attributes must start with
`trif-box-` (so the page's frameworks, such as htmx, Turbo, Stimulus, and other mods find nothing to act on);
an image or link it sets is an address the page already shows; it writes only into its own elements.

**Reads it doesn't get, by default:** what's typed in fields and contenteditable editors (`attr('value')`
is null, editors' text hidden), which key was pressed while focus is in anything that is or may hold a
field (including shadow roots), the page's own canvases.

**Powers** (`// @powers a, b`): 21 named, narrowed exceptions, each held until the user approves that set
of powers (approval is keyed by the set, not the code: a later version with the same powers runs, a new
power waits). None of them sends anything the mod makes up. Examples: `sound` (Web Audio facade, no
addresses, no mic), `read-drafts` (field text, never password/card/OTP fields), `write-drafts` (text into
fields, refusing any text that would add an address that isn't already there), `click` (only selectors
listed in the header, never submit/reset or cross-origin links), `go-to` (only paths listed in the header),
`site-data` (filter the site's own responses: remove or reorder only, every output value must occur in the
input). The full list, each argued against the rule: docs/SAFE-MODS.md "Powers"; the user-facing sentences:
docs/WIDEN-STRINGS.md, docs/POWERS-STRINGS.md.

**Combinations.** Every pair (210) and triple (1330) of powers is in a table (helper/lib/combinations.js,
written out in docs/POWER-COMBINATIONS.md), each with a warning the approval shows or a one-line reason it
adds nothing; more than three powers gets one general warning. Two mods splitting a dangerous pair between
them is handled at run time: the sandbox tracks every boxed mod's powers on the page and refuses an act
(write, click, media control, navigate, page events…) while another mod's power would make a warned pair
the acting mod didn't itself ask for (extension/sandbox.js `ACT_PARTNERS`).

**Known gaps and limits, plainly:**
- Clickjacking (RT-3), as for style mods.
- Not enforced across mods: `sound` beside a read (a listening device near the user could pick it up;
  warned for a single mod only).
- Residual channels that exist by design and are warned: timing of the page's media requests (`media` +
  a read), which of the page's pictures load (`image-variants`/`preload` + a read).
- A field inside a *closed* shadow root on a plain element can't be detected from TRIF's world, so keys
  pressed in it may reach a mod with `keys`.
- Safari has no such world: boxed mods there wait for the user's OK and then run as free mods (never
  silently). The same applies to any browser where the world can't be configured.
- Cost of the safety: some ordinary things are refused (a mod can't remove a page field, give a page
  element an id, or draw from the page's canvas).

**How it's been tested and reviewed:**
- Hostile e2e in real headless Chrome and Firefox: tests/e2e/fixtures/sandbox-hostile.js (181 escape
  attempts) and sandbox-wide.js (the 0.3 widening); each must be refused, the test server must see no leak
  address, and the page's own listeners must notice nothing. Run by tests/e2e/scenario.js
  (`sandboxedCheck`, `powersCheck`…). Unit tests: tests/sandbox.test.js, tests/combinations.test.js.
- Two red-team rounds by an AI model with no context but the branch and docs (findings RT-1 to RT-10, all
  fixed except RT-3). An audit of sandbox.js (AU-1 to AU-9, all fixed). Both by AI models; no human
  security review yet.
- **Not yet reviewed by anyone else:** the 0.3 widening (36 additions to the base box and 9 new powers,
  2026-11-11), which only its builder's own hostile tests have exercised. That's the most useful place to
  look.

**Code:** extension/sandbox.js (the world, stand-ins, guards, page-wide rules), helper/lib/boxpowers.js
(header parsing), helper/lib/sandboxlint.js (`trif check`), helper/lib/combinations.js, extension/vendor
(SES).

## 3. Free mods

**What runs.** The mod's code in the page's own JavaScript world (`MAIN`), with everything the page can do.

**The checkpoint.** helper/lib/powers.js reads the code token by token for ways to send (`fetch`, XHR,
beacon, WebSocket, `postMessage`, form submit, workers), act (`.click()`, synthetic events,
`execCommand`, clipboard), navigate, load from a computed address, name another site, or hide code (`eval`,
`Function`, string timers, `import()`, inline HTML handlers, names built from decoded strings). It checks
its own reading against the JS engine, and whatever it can't follow counts as `hidden`. A mod that's new or
changed and can do something not yet allowed doesn't run until the user allows it in the panel or with
`trif approve` (helper/lib/held.js); allowances are kept per power and per line that uses it
(`~/.trif/allowed.json`, which agent runs can't write).

**How far to trust it:** not far, and the docs say so. Deciding what arbitrary JavaScript will do is
undecidable; a mod can call the site's own functions to post or fetch without writing either word. "TRIF
finds nothing" means "nothing TRIF knows how to spot". Free mods are for code the user chooses to trust.
The walls are elsewhere (next section) and in the two safe tiers.

## Around the tiers: the agent itself

Not a mod tier, but the reason the tiers matter. The side-panel agent works for one site: its shell runs in
an OS sandbox with no network and no writes outside that site's mods folder. JavaScript it runs live in a
tab (`trif run`) locks the tab first (extension/tablock.js): browser-enforced declarativeNetRequest rules
block every state-changing request, every WebSocket, and any load or navigation to a site the page hadn't
already used, on every tab of that site, until a new document; leftovers in cache and service workers are
checked and cleared. Per-site "Agent on this site: Off / Look / Run code", sensitive sites (email, banks,
password managers…) off by default. docs/SECURITY.md and docs/TABLOCK-AUDIT.md (TL-1 to TL-7).

Known limit: a terminal agent (outside the side panel) has the user's shell and could approve its own
mods; only the side panel's sandbox enforces that it can't. Some company-managed agents (enterprise
Codex/Claude) override TRIF's sandbox profile; TRIF detects this and tells the user rather than running unsandboxed (0.2.6).

## Where an auditor's time is best spent

1. The 0.3 widening in extension/sandbox.js: the new class A operations and the 9 new powers
   (block-events, page-events, site-storage, rewrite-requests, image-variants, edit-uploads, embeds,
   local-fonts, preload), against the design rule.
2. The stand-in allowlist: any method, getter or returned object that hands back a real node, a page
   function, or a way to set a name or address that isn't the mod's own.
3. `write-drafts`' no-new-address check and `site-data`'s "only what the site sent" check.
4. Gaps in the hostile fixtures: an escape class neither fixture tries.
5. The CSS check shared by style and boxed mods.

To run the tests: `npm test` (unit); `node tests/e2e/run.js chrome|firefox|all` (real browsers; run it
headless and muted, and one browser at a time: it's heavy). Please keep any working exploit private and send it to the maintainer rather
than opening a public issue.
