# TRIF: boxed mods and their powers

Read this to write, convert or repair a **boxed mod** (`// @boxed`). AGENTS.md's rules still apply.

## Boxed mods: when a style mod isn't enough

A boxed mod is JavaScript that TRIF runs in its own sandbox, not in the page: the language plus TRIF's API,
and nothing else (no `window`, `document`, `fetch`, storage). It can't send, navigate or click by itself, so
it never waits for the user's OK. Use it for logic, new elements, animation or drawing; a free mod only for
what needs the page's own code.

```js
// ==WebMod==
// @name        Calm feed
// @description Hides promoted posts and marks long threads
// @match       https://x.com/*
// @boxed
// @risk        1 hides promoted posts, so their ad impressions never report
// ==/WebMod==
// ==Style==
// {
//   "css": [".trif-box-long { outline: 2px solid var(--color); }"],
//   "settings": { "color": { "type": "colour", "value": "#ffe696" }, "longAt": { "type": "number", "value": 3, "min": 1, "max": 20 } }
// }
// ==/Style==
trif.observe('article', (post) => {
  if (post.text.includes('Promoted')) return post.hide();
  if (post.findAll('[data-testid=tweetText]').length > trif.style.longAt) post.classes.add('trif-box-long');
});
```

Fixed CSS, hides and tweakable values go in the style section (AGENTS.md); `trif.css` is for CSS the code
works out; `trif.settings` for what the mod keeps as it runs. The code runs inside an async function (top-level
`return` and `await` work). `trif check` lists anything you used that isn't there.

**`trif`**: `css(text, {shadow?: hostSelector})` (returns `{remove}`), `hide(sel)`, `observe(sel, fn,
{attributes?})` (each match now and later; returns stop), `changes(sel, fn)` (batches of changed elements),
`text(sel, fn)` (replace text), `wrap(sel, /re/, fn)` (split text into your own elements), `onUrl(fn)`,
`ready`, `loaded`, `settings(key, defaults)` (→ `{value, save}`, per site, up to 1 MB), `style`, `log`,
`warn`, `error`.

**`page`**: `find`, `findAll`, `create(tag)` (harmless tags: `div`, `span`, `a`, `button`, `img`, lists,
tables, `canvas`, …), `createSvg(tag)`, `on(type, fn)` (input events as plain data; `visibilitychange`,
`pagehide`, and custom events named in `// @events`), `url`, `title`, `width`, `height`, `scrollX/Y`, `root`,
`body`, `prefersDark`, `prefersReducedMotion`, `matchMedia(q)`, `elementFromPoint(x, y)`, `styleSheets()`.
A `<script src>`'s text is empty in the box: to read a site's code, fetch it with `trif run --page` or open
its URL with `trif navigate`. An empty result doesn't mean the feature isn't there.

**Elements** are stand-ins: `text`, `innerText`, `setText`, `attr`, `setAttr`/`removeAttr` (safe attributes:
`title`, `role`, `hidden`, `alt`, `aria-*`, `data-trif-box-*`, `trif-box-` ids; links only `#…` or an address
already on the page; images only `data:`/`blob:` or one the page shows), `classes` (add/remove `trif-box-`
classes), `style(prop[, value])`, `hide`/`show`, `find`, `closest`, `parent`, `children`, `append`/`prepend`/
`before`/`after`, `remove`, `clone`, `rect()` and the size properties, `animate(keyframes, timing)`,
`onResize`, `onVisible`, `on(type, fn)`; on your own elements also pointer capture, `focus`, and drag and drop.

**Events**: `type`, `key`/`code`, modifiers, `x`/`y`, `deltaX/Y`, `button`, `target`, `preventDefault()`.

**`canvas()`** on your own `<canvas>`: 2D drawing, gradients, `drawImage` (your canvases and the page's
images), `getImageData`/`putImageData`, `toDataURL`.

Also: timers, `requestAnimationFrame`, `Math`, `Date`, typed arrays, `URL`, `Intl`, `TextEncoder`/`Decoder`,
`structuredClone`, `atob`/`btoa`, `performance.now()`.

Limits to know:
- Name only your own things: `trif-box-` ids and classes, `data-trif-box-*`. Never change the page's ids,
  classes or framework attributes.
- No selector `\` escapes; no `value` attribute or `:autofill` in selectors.
- The page's forms and fields are its own: you can hide them, not move or overwrite them.
- Keys are reported only outside fields and editors; editors' contents are invisible and can't be written.
- Source with `import(` or an HTML comment marker is refused, even in a string.
- If no power covers what's needed, say so and write a free mod; don't contort the boxed one.

### Powers: what a boxed mod can ask for

One exception goes in the header, `// @powers sound, read-drafts`. TRIF holds the mod until the user
approves that set once; an update that adds a power waits again. The quiet ones (`sound`, `controls`,
`mods`, `preload`, `embeds`, `media`) don't make it wait alone. **Ask only for powers the mod uses.**

- `sound`: `trif.audio()`: `tone()`, `play(dataUrl)`, oscillator/gain/filter/delay/panner/noise/buffer nodes,
  `render()` offline. Sounds only from embedded `data:audio`. Starts after the user clicks or types.
- `controls`: your own `input` (range, color, checkbox, number, text), `select`, `label`; `.value`, `setValue`,
  `on('input')`. Never in the page's forms.
- `keys`: key events wherever the focus is, except fields and editors.
- `read-drafts`: what the user types in the page's fields and editors (never passwords or cards).
- `write-drafts`: `setValue`/`setText` on the page's fields and editors, as the user types (not while they
  press Send); no addresses that weren't already there. Usually with `read-drafts`.
- `site-data`: `trif.filterResponse(urlGlob, (data, {url}) => data)`: the site's JSON responses, before the
  page sees them. **Remove or reorder only**; synchronous. Also `trif.filterEmbedded(sel, fn)` and
  `trif.filterGlobal(name, fn)` for globals named in the header.
- `page-data`: `el.pageData('props.…' | 'fiber.…')`: React data behind an element, as a plain copy.
- `search-box`: `trif.searchBox({placeholder})`; Enter goes to the header's address
  (`// @powers search-box https://example.com/search?q={query}`).
- `media`: `play`, `pause`, `setMuted`, `setVolume`, `seek`, `.media` on the page's video and audio.
- `go-to`: `trif.goTo(path)` to paths listed in the header, or a link's address on the page.
- `click`: `el.click()` on what the header names, with words the user reads:
  `// @click "Show more": button.more`. Never form submits or links to other sites.
- `block-events`: `trif.block(type, fn?)` hides events named in the header from the site.
- `page-events`: `trif.signal(name, detail)` for the header's signal names.
- `site-storage`: `trif.storage('local'|'session'|'cookie')` for keys named in the header (never login
  keys); `// @migrate localStorage key` brings a free version's data into settings.
- `rewrite-requests`: TRIF rewrites the site's own requests as the header says
  (`// @powers rewrite-requests HomeTimeline variables.sort=Top→Recent`); existing fields and values only.
- `image-variants`: `trif.imageVariant(img)`: another size of a picture, by the header's literal change.
- `edit-uploads`: `trif.onUpload((canvas) => canvas)` to edit pictures the user attaches.
- `embeds`: `trif.embed(link)`: a play button for a linked video, from the header's player.
- `local-fonts`: `await trif.localFonts()` after a click.
- `preload`: `el.loadSooner()` on lazy images.
- `mods`: `trif.channel(name)` to talk to your other boxed mods on the page.

Some pairs warn the user on the hold (`trif check` says which). A mod's act can be refused while another
boxed mod on the site has a power that would make a warned pair; the user approves the site's combined set
once. Don't add unused powers to get around that.
