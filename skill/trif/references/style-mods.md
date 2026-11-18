# Style mods, and a style section in other mods

<!-- Cut from TRIF's agent guide (AGENTS.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

The tier to try first.

### Style mods: start here

Most customizations are "make it look like this", "hide these", "rename that", "drop the items that say
X". Write those as a **style mod**: rules as data instead of code, run by TRIF's own code. A style mod
can't send, load from anywhere or run code, whoever wrote it, so it never waits for the user's OK and
nothing on a page can turn it against them. Reach for JavaScript only when a style mod can't do the job.

`trif new <site> <mod> --style` makes one. After the header (with `// @style` in it), one JSON object (a
style mod's old name, `@rules`, still works):

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

- `css`: any CSS that changes how things look. Nothing that loads from an address: `url()` only with
  `data:`, no `@import`, `image-set()` and the like, and no backslash escapes outside strings. To recolour,
  set `background-color`, not the `background` shorthand: the shorthand also sets `background-image` to
  none, which wipes out every picture the page draws as a background (thumbnails, avatars, icons), and a
  mod can't put them back.
- `hide`: selectors to hide (`display: none !important`, including elements that appear later).
- `replace`: `{ in?, find, with, regex?, caseless? }`: text to replace inside the elements `in` matches
  (default the whole page). `with` is plain text: no `$1`, a regex's groups aren't filled in. Patterns are
  capped and can't nest repeats.
- `filter`: `{ items, hideIfText | hideIfRegex | hideIfHas }`: hide each element matching `items` whose
  text contains the words (case-insensitive), matches the pattern, or that has an element matching the
  selector inside it.

Selectors can't contain `{`, `}`, `;` or `@`. `trif check <site>/<mod>` checks the rules and says what's
wrong. Rules re-apply as the page changes, so single-page apps need nothing extra.

**Scrolling feeds: start simple; filter the data only when hiding breaks the feed.** `hide` and `filter`
(and a boxed mod's `post.hide()`) act on what the site has already drawn: it builds each item, then TRIF
hides it. Start there, hiding the row's contents rather than the row so the list closes up, and check it
by scrolling (`trif sweep --scroll`). That's enough for most requests: a box, a sidebar, an ad every
tenth post, a shelf that turns up now and then. Go deeper only when you see the cost in this feed (X,
Instagram, Threads, Facebook, Reddit, YouTube, TikTok: lists that load as you scroll and keep only the
visible rows on the page): scrolling stutters, hidden rows leave blank stretches, or the list stops
loading more because most of what it drew is hidden. Then remove the items from the response the feed
is built from, so the site never draws them: a boxed mod with the `site-data` power
(`trif.filterResponse`; BOXED.md, "Powers"), or a free mod that patches `fetch` and XHR (TECHNIQUES.md,
"Filtering data before the app sees it"). That costs more code, depends on the response's shape, and must
keep the pagination cursors. Don't fight the feed's scrolling itself (faking scroll positions,
overriding `scrollY` or the list's measurements): it's slow to get right and breaks with each site
change; if hiding and data filtering both fail, say so and ask. Tell the user which way you went and
why, in a sentence.

### A style section in boxed and free mods

Most follow-up requests are looks: a colour, a size, a gap, what's hidden. In a boxed or free mod, put those
in its **style section**, right after the header, and TRIF applies them itself: a change there alone never
makes the mod wait for the user's OK again, whatever the mod can do. JSON on `//` lines:

```js
// ==/WebMod==
// ==Style==
// {
//   "css": ["[data-testid=primaryColumn] { max-width: var(--width); }", ".trif-box-mark { outline: 2px solid var(--accent); }"],
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

- `css` (text, or a list of lines) and `hide` are a style mod's: nothing that loads from an address.
  `var(--name)` is a setting's value (a number with its `unit`, a colour, a choice's word).
- `settings` are what the code reads, as `trif.style.<name>`: `number` (with `min` and `max`, optional
  `step` and `unit`), `colour` (`#rgb` or `#rrggbb`, alpha too), `on-off` (true or false), `choice` (one of
  `options`, words). Nothing else: the code never sees the section's text.
- What a setting is (its type, range, choices) counts as code: changing it is judged like a code change.
  Its `value`, the CSS and the hide list are style.
- So write the values the user may want to tweak there, not as constants in the code; then "make it a bit
  wider" is a change to the section. `trif check` checks the section and says it found one.
