# Free mods: techniques

<!-- Cut from TRIF's agent guide (TECHNIQUES.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

Only when a mod needs the page itself. Read references/checks.md too: what TRIF holds.

## Where mods run

- In the page's **main world**, sharing `window` with the site: you can patch `fetch`, XHR, `history`,
  prototypes, and read app state. The site can see your globals too: keep them few and prefixed.
- At **`document-start`** by default, before the site's scripts (no `head`/`body` yet). Network hooks must
  run then.
- **Once per page load**: single-page apps navigate without loads, so watch for route changes.
- `window.trif?.log/warn/error(...)` go to `trif logs`. TRIF catches your errors (`trif errors`) and flags
  new ones to the user, so catch what you expect.
- `window.trif?.expect(selector)` once at the start: TRIF flags the mod as maybe broken if that stops
  appearing.
- Sites with Trusted Types throw on `innerHTML = '…'`: build with `createElement` and `textContent`.

## Techniques, most robust first

### 1. CSS

Fixed CSS goes in the style section. For CSS the code works out, add a `<style>` to
`document.head || document.documentElement`.
- Selectors, best first: `data-testid`, `aria-label`/`role`, `href` patterns, ids. Never generated classes
  (`.css-1dbjc4n`).
- `:has()` hides a container by what it contains. When JS decides, mark with a prefixed attribute and let
  CSS hide it; hide framework-owned nodes rather than removing them. Use `!important`.
- Dark mode: real colours on the main containers; `filter: invert(1)` is a fallback.
- Virtualized feeds: hide a row's contents, not the row, so the list closes up.

### 2. Filtering data before the app sees it

When hiding drawn items isn't enough (AGENTS.md, "Scrolling feeds"), rewrite the response the feed is built
from. In a boxed mod, `site-data` does this for you. In a free mod, hook both `fetch` and XHR:

```js
const TARGET = /\/graphql\/[^/]+\/HomeTimeline\b/;   // operation name, not the hash
const filterData = (data) => { /* remove entries, keep cursors */ return data; };
const filterText = (t) => { try { return JSON.stringify(filterData(JSON.parse(t))); } catch { return t; } };
const fetch0 = window.fetch;
window.fetch = async function (input) {
  const res = await fetch0.apply(this, arguments);
  const url = typeof input === 'string' ? input : input?.url || String(input);
  if (!TARGET.test(url) || !res.ok) return res;
  try {
    const out = new Response(filterText(await res.clone().text()), { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(out, 'url', { value: res.url });
    return out;
  } catch (e) { window.trif?.warn('filter failed', String(e)); return res; }
};
// XHR: note the URL in open(); override the responseText/response getters to return filterText of the original.
```

- Touch only matching, successful responses; on any surprise return the original.
- Find the list defensively (optional chaining, a bounded search).
- **Keep pagination**: never drop cursor entries. A page filtered to nothing can stall the list; Detox
  Timeline adds a slim placeholder entry so the list keeps growing.
- A request can be rewritten the same way, minimally, into one the site's own UI sends.

### 3. DOM tweaks in single-page apps

Expect the app to re-render and undo you. Re-apply from a debounced `MutationObserver` (setTimeout, not
rAF); catch route changes by wrapping `history.pushState`/`replaceState` and listening for `popstate`. Make
every pass idempotent (check before changing). A flag on `<html>` set on route change lets CSS style the page
from its first frame.

### 4. React state

When the DOM lacks the data, React often has it: the fiber is on the node under a `__reactFiber$…` key; walk
`.return` a bounded number of steps looking for a prop. Explore with `trif run`; guard every access and
degrade to doing nothing.

### 5. Shadow DOM

Page CSS and `querySelector` don't reach into shadow roots. Mods run first, so wrap
`Element.prototype.attachShadow` to style each root as it's made. Use `e.composedPath()` for event targets.

### 6. Adding UI

Match the site (read its computed font, colours, radius); anchor next to something stable and re-insert if
it disappears; use ARIA roles. Keep settings in `localStorage` under a prefixed key. Never insert page text
as HTML.

## Keep mods fast

- A running CSS animation restyles its element every frame: animate one container, not every post;
  prefer `transform`/`opacity`; pause what's off screen.
- Don't keep changing variables or classes on `<html>`/`<body>`: each change restyles the whole page.
- Layout reads (`getComputedStyle`, `getBoundingClientRect`) force layout: read once per change, batch reads
  before writes.
- Write only what changed. Do heavy setup after the first frame.

If a mod stays costly, say so in the report.

## Resilient mods, and repairing broken ones

Prefer what changes least: test ids, roles, labels, URL patterns, GraphQL operation names. To repair:
`trif errors` and `trif logs`; check each selector or data path live with `trif run`; for data mods, record
again and compare the response; fix the smallest thing, keeping the user's edits, and support the old shape
alongside the new while both may be served.
