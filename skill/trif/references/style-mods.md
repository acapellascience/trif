# Style mods, and a style section in other mods

<!-- Cut from TRIF's agent guide (AGENTS.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

The tier to try first.

### Style mods: start here

Most requests ("make it look like this", "hide these", "rename that", "drop items that say X") are a **style
mod**: rules as data, run by TRIF's own code. It can't send or run code, so it never waits for the user's OK.
Use JavaScript only when a style mod can't do the job.

```js
// ==WebMod==
// @name        Calmer timeline
// @description Hides promoted posts and the trends box
// @match       https://x.com/*
// @style
// @risk        1 hides promoted posts, so their ad impressions never report
// ==/WebMod==
{
  "css": "[data-testid=primaryColumn] { max-width: 700px }",
  "hide": ["[data-testid=sidebarColumn] [aria-label=Trending]"],
  "replace": [{ "in": "article", "find": "Grok", "with": "the robot" }],
  "filter": [{ "items": "[data-testid=cellInnerDiv]", "hideIfText": "Promoted" }]
}
```

- `css`: one string (not a list, unlike a style section's) of any CSS that loads nothing (`url()` only with
  `data:`; no `@import`). Recolour with
  `background-color`, not `background`: the shorthand wipes the page's background pictures.
- `hide`: selectors to hide, now and later.
- `replace`: `{ in?, find, with, regex?, caseless? }`: `with` is plain text, no `$1` (a regex's groups aren't
  filled in).
- `filter`: `{ items, hideIfText | hideIfRegex | hideIfHas }`: hide each item with that text, pattern or
  descendant.

Selectors can't contain `{ } ; @`. `trif check <site>/<mod>` says what's wrong. Rules re-apply as the page
changes.

**Scrolling feeds: start simple.** Hide with `hide`/`filter` first, hiding a row's contents rather than the
row so the list closes up, and check by scrolling: `trif sweep --scroll` scrolls the tab to load more and
restores it (on the tab the user is looking at, add `--force`). Go further only if this feed
shows the cost (stutter, blank stretches, the list stops loading because most of it is hidden): then filter
the response the feed is built from (a boxed mod with `site-data`, BOXED.md; or a free mod, TECHNIQUES.md),
keeping pagination cursors. Don't fake the feed's scrolling (`scrollY`, the list's measurements). If neither
works, say so and ask.

**Hidden isn't stopped.** If what you hide plays, polls, counts down or makes sound (a player, a live
preview, autoplay), stop it or keep it from loading: its own close or off switch, its setting, or dropping it
from the response that brings it. `trif record` shows whether it's still sending.

### A style section in boxed and free mods

Put a boxed or free mod's looks in its **style section**, right after the header: TRIF applies it, and a
change there alone never makes the mod wait for the user's OK. A style section takes only `css`, `hide` and
`settings`; `replace` and `filter` are style-mod keys, so in a boxed or free mod do those in code.

```js
// ==/WebMod==
// ==Style==
// {
//   "css": ["[data-testid=primaryColumn] { max-width: var(--width); }"],
//   "hide": ["[data-testid=sidebarColumn] [aria-label=Trending]"],
//   "settings": {
//     "width":  { "type": "number", "value": 700, "min": 400, "max": 1400, "unit": "px" },
//     "accent": { "type": "colour", "value": "#1d9bf0" },
//     "marks":  { "type": "on-off", "value": true },
//     "layout": { "type": "choice", "value": "list", "options": ["list", "grid"] }
//   }
// }
// ==/Style==
if (trif.style.marks) { /* … */ }
```

`css` and `hide` follow style-mod rules; `var(--name)` is a setting's value; the code reads settings as
`trif.style.<name>`. A setting's type and range count as code; its `value`, the CSS and the hide list are
style. Put values the user may tweak here, not as constants in code.
