# TRIF: techniques for mods

Read before a free mod, data filtering or a repair. AGENTS.md's rules still apply; style mods are there,
boxed mods in BOXED.md. A free or boxed mod's fixed CSS, hides and tweakable values belong in its style
section (AGENTS.md); keep in code only what needs code.

## Writing mods TRIF can read

TRIF reads every mod before it runs and holds one that can send, click, navigate or run code it can't read.
Where it can't tell, it assumes the worst, so write plainly. `trif check` shows what it reads, line by line.

| Flagged | Instead |
|---|---|
| `dispatchEvent(new KeyboardEvent/MouseEvent)`, `.click()` | to reach your own code, a `CustomEvent('my-mod-…')` |
| `x[k] = v` in a mod that mentions `src`/`href` | a `Map`, array methods, or properties by name |
| `createElement(variable)`, `setAttribute(variable, …)` | literal tag and attribute names |
| `innerHTML` with values inside a tag | `createElement` + `textContent` |
| `window[k]`, names built from pieces, `eval`, `new Function`, string timers | call things by name |
| `fetch`, XHR, `sendBeacon`, `location = …`, another site's address | only when the user asked; then it rightly waits |

Don't disguise code to dodge the reader: that gets it held as code TRIF can't check.

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
- What your code loads or sends from the page follows its Content Security Policy (`fetch`, XHR, sockets,
  images, iframes): x.com blocks a `fetch` to any other server. For another server's data, a boxed mod with
  the `load` power (BOXED.md). A block is a console message (a blocked `fetch` rejects with a TypeError);
  listen for `securitypolicyviolation` to see it.
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

## Testing

Pure logic (a filter function) can be tested with Node in a `_`-prefixed file next to the mod
(`sites/x.com/_hide-reposts.test.js`): stub the globals, load the mod, call what it exposes, and use a real
recorded response, trimmed, as the fixture. Not runnable in side-panel runs; the user can run it.

**Detox Timeline** (`trif install-example x.com/detox-timeline`) is the reference free mod: data filtering
over fetch and XHR, placeholders, request rewriting, React reads, a settings menu. Read it if it's in the
workspace; install it only if the user wants it.
