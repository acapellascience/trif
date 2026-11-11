# TRIF: techniques for mods

The how-to half of the guide, read when you need it: before you write a mod, before you repair one, and
when you test. AGENTS.md (next to this file) is the rest: the workspace, the CLI, the workflow and the
safety rules, which always apply.

## Style mods: start here

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
  `data:`, no `@import`, `image-set()` and the like, and no backslash escapes outside strings.
- `hide`: selectors to hide (`display: none !important`, including elements that appear later).
- `replace`: `{ in?, find, with, regex?, caseless? }`: text to replace inside the elements `in` matches
  (default the whole page). `with` is plain text. Patterns are capped and can't nest repeats.
- `filter`: `{ items, hideIfText | hideIfRegex | hideIfHas }`: hide each element matching `items` whose
  text contains the words (case-insensitive), matches the pattern, or that has an element matching the
  selector inside it.

Selectors can't contain `{`, `}`, `;` or `@`. `trif check <site>/<mod>` checks the rules and says what's
wrong. Rules re-apply as the page changes, so single-page apps need nothing extra.

## Boxed mods: when a style mod isn't enough

When a mod needs logic, new elements, animation or drawing, but not the page itself, write a **boxed
mod**: JavaScript that TRIF runs in its own sandbox, not in the page. It has the language and TRIF's API,
nothing else: no `window`, `document`, `fetch`, storage, frames or events to fire. So it can't send,
navigate, load or click anything itself, it never waits for the user's OK, and the page can't reach it.
Write a free mod (JavaScript in the page) only for what needs the page: filtering the data the site loads,
the app's state, its code.

`trif new <site> <mod> --boxed` makes one (`// @boxed` in the header; its old name, `@sandboxed`, still
works):

```js
// ==WebMod==
// @name        Calm feed
// @description Hides promoted posts and marks long threads
// @match       https://x.com/*
// @boxed
// @risk        1 hides promoted posts, so their ad impressions never report
// ==/WebMod==
trif.css('[data-testid=sidebarColumn] { display: none !important }');
trif.observe('article', (post) => {
  if (post.text.includes('Promoted')) return post.hide();
  if (post.findAll('[data-testid=tweetText]').length > 3) post.classes.add('trif-box-calm-long');
});
const prefs = await trif.settings('prefs', { color: 'rgb(255, 230, 150)' });
trif.css(`.trif-box-calm-long { outline: 2px solid ${prefs.value.color} }`);
```

What it has (everything else is simply not there, and `trif check` lists what you used that isn't):

- **`trif`**: `css(text)` (CSS that loads nothing new: `url()` only with `data:`, `#somewhere`, or an
  address an image on the page shows or one of the page's style sheets uses; returns `{remove}`),
  `css(text, {shadow: 'host-selector'})` (the same CSS into the shadow roots, open or closed, of the hosts
  that match, now and as they're made), `hide(selector)`, `observe(selector, fn, {attributes: ['class',
  'hidden']})` (each matching element, now and as they appear, and with `attributes` again as one of those
  changes: `fn(el, {attribute})`; never `value`, nothing inside editors; one observer shared by all of
  TRIF's mods; returns a stop function), `changes(selector, fn)` (what changed under the elements that
  match: children added or removed, text; `fn([elements])` in batches; not inside editors), `text(selector,
  fn)` (each text inside what matches, now and later, replaced by what `fn(text)` returns), `wrap(selector,
  /pattern/, (match, groups) => element or text)` (the page's text split into your own pieces: each match
  replaced by what `fn` returns, outside editors, fields and form text; the page's text node stays, empty;
  patterns up to 200 characters, no nested repeats or back-references), `onUrl(fn)` (the page's address
  as it changes, in-app moves too), `ready` and `loaded` (promises: the document parsed, and loaded),
  `settings(key, defaults)` (a promise of `{value, save(obj)}`: the mod's own, per site, kept by TRIF, not
  in the site's storage; JSON, up to 1 MB per mod on a site), `log`, `warn`, `error` (`trif logs`;
  `console.log` and friends do the same).
- **`page`**: `find(sel)`, `findAll(sel)`, `create(tag)` (harmless tags only: `div`, `span`, `p`, `a`,
  `button`, `img`, lists, `dl`/`dt`/`dd`, headings, tables, `canvas`, `output`, `meter`, `abbr`, `time`,
  ...), `createSvg(tag)` (`svg`, `g`, `path`, `circle`, `rect`, `line`, `polygon`, `text`, gradients,
  `clipPath`, `use`, ...), `on(type, fn)` (input events on the window, read as plain data; also
  `visibilitychange`, `fullscreenchange`, `pagehide` (then only `settings` saves: nothing that acts), and
  the page's own custom events named in the header, `// @events my-app-ready`: `fn({type, detail})`, the
  detail a plain copy), `url`, `title`, `width`, `height`, `scrollX`, `scrollY`, `root`, `body`,
  `prefersReducedMotion`, `prefersDark`, `devicePixelRatio`, `visibilityState`, `hidden`,
  `matchMedia(query)` (`{matches, onChange(fn)}`), `elementFromPoint(x, y)`, `elementsFromPoint(x, y)`
  (stand-ins; a shadow root's host, a frame's element, never what's inside), `styleSheets()` (plain
  copies: `[{href, readable, rules: [{selector, text, media}]}]`; another site's sheet unreadable).
- **Elements, as TRIF's stand-ins** (not the real nodes): `tag`, `text`, `innerText` (as shown), `setText(t)`,
  `attr(name)`, `setAttr(name, value)` (`title`, `role`, `hidden`, `alt`, sizes, `aria-*`,
  `data-trif-box-*`, an `id` or `class` starting with `trif-box-`, `open` on a `<details>`, `value`/`min`/
  `max`/`low`/`high`/`optimum` on a `<meter>`, `datetime` on a `<time>`, `placeholder` on the page's inputs
  and textareas (shown, never sent); a link's `href` only `#…` or an address a link on the page already
  has; an image's `src` only `data:`/`blob:` or an image the page already shows; on your own SVG, its
  shapes' attributes, references only `url(#trif-box-…)` and `href="#trif-box-…"`), `removeAttr`,
  `classes.add/remove/toggle` (`trif-box-` classes) and `has` (any), `style(prop, value)` (read the
  computed value with one argument; values that load nothing new), `inlineStyle(prop)` (its style
  attribute's), `hide()`, `show()`, `find`, `findAll`, `closest`, `matches`, `parent`, `children`, `next`,
  `previous`, `append`/`prepend`/`before`/`after` (stand-ins or text), `remove()`, `clone()` (a copy with
  only allowed elements and attributes; an SVG copy keeps its ids, renamed `trif-box-…`, and its references
  to them), `rect()`, `offsetWidth`/`offsetHeight`/`offsetTop`/`offsetLeft`, `clientWidth`/`clientHeight`,
  `scrollWidth`/`scrollHeight`/`scrollTop`/`scrollLeft` (read only), `bbox()`, `totalLength()`,
  `pointAtLength(l)`, `isPointInFill(x, y)`, `isPointInStroke(x, y)` (SVG; not inside editors),
  `animate(keyframes, timing)` (Web Animations: values that load nothing, no `url()`; returns `{play, pause,
  cancel, finish, reverse, setCurrentTime, setPlaybackRate, currentTime, startTime, playState, finished}`),
  `animations()` (its animations: the page's own readable, changeable only by the mod that made them),
  `onResize(fn)` (`{width, height}`), `onVisible(fn, {threshold, rootMargin})` (`{visible, ratio, x, y,
  width, height}`), `on(type, fn)`, and on your own elements: `capturePointer(e.pointerId)` /
  `releasePointer`, `focus()` / `blur()` (also TRIF's search box; never while the user is in one of the
  page's fields, at most 10 in 10 s), drag and drop between them (`dragstart`, `dragover`, `drop`, ...;
  `e.dataTransfer.setData/getData/types()/setDropEffect` hold your own data only: never files, nor what
  another app or the page put in a drag).
- **Events** (`fn(e)`): `type`, `key`/`code` (see Keys), modifier flags, `x`/`y`, `deltaX`/`deltaY`,
  `button`, `buttons`, `pointerId`, `pointerType`, `animationName`/`propertyName`/`elapsedTime`, `target`
  (a stand-in), `preventDefault()` (with `{preventDefault: true}` when listening), and
  `stopPropagation()`/`stopImmediatePropagation()` for events on your own elements (the page then learns
  less; stopping the page's own events is the `block-events` power).
- **`canvas()`** on a `<canvas>` the mod made: 2D drawing with numbers and text (`fillRect`, `arc`,
  `fillText`, `measureText` (all its metrics), `set({fillStyle, font, filter, ...})` (no `url()`),
  `linearGradient`/`radialGradient`/`conicGradient` (`addStop(offset, colour)`), `pattern(source)`,
  `setLineDash`, `drawImage(source, ...)` (your own canvases, images you made from `data:`/`blob:`, and
  the page's own images; never the page's canvas or video), `getImageData` (`{width, height, data}`; the
  browser refuses on a canvas another site's picture tainted), `putImageData`, `toDataURL(type)` (up to 8
  MB: usable as an image's `src`).
- `setTimeout`, `setInterval`, `requestAnimationFrame` and their clears (functions only), `Math`, `Date`,
  the JavaScript language (frozen: mods can't change `Array.prototype` and the like), typed arrays
  (`Float32Array`, `Float64Array` too), and the browser's pure tools, frozen: `URL` (a parser; no
  `createObjectURL`), `URLSearchParams`, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone`,
  `atob`, `btoa`, and `performance.now()` (only).

Good to know:
- **A boxed mod names only its own things, or copies addresses the page already has.** Names you give
  start `trif-box-`: data attributes `data-trif-box-*`, ids and classes `trif-box-*`. The page's own code
  acts on its attributes (htmx's `data-hx-post`, Turbo, Stimulus, classes and ids it looks for), and free
  mods act on their `trif-` names, so a boxed mod never sets those, nor changes or removes the page's
  own ids and classes: mark elements with `data-trif-box-…` or a `trif-box-` class and style them with
  `trif.css`. Copies (`clone()`) keep none of the page's ids, classes or data attributes. Links point at
  `#…` or at an address one of the page's links already has (a new address could carry data, and some
  pages fetch their links before anyone clicks).
- **Selectors** have no `\` escapes and don't name the `value` attribute or `:autofill` (React keeps a
  field's `value` attribute in step with what's typed); `attr('value')` on a field is null.
- **Forms are the page's**: a button you make is always `type="button"` and can't go inside a form, and
  the page's own fields can't be moved into, out of or between forms, removed, or written over (hide them
  with `hide()` instead).
- **Keys**: `on('keydown')` and the like say which key (`key`, `code`) only when TRIF can tell it wasn't
  typed into a field or editor: with the focus on the page, a link, a button or a list item, yes; on a
  field, an editor, or an element that could hold one (a `div`, `span`, `article`, a custom element), null.
- **Editors are the user's**: what's typed into a contenteditable isn't in `.text` or `trif.text`, copies
  or attributes inside it, and a boxed mod can't write into one (text, elements, attributes, classes,
  removing): it can restyle or hide it.
- The code runs inside a function, so a top-level `return` ends it and `await` works at the top.
- Errors are caught and shown by `trif errors`, as for free mods.
- The sandbox refuses source with `import(` or an HTML comment marker in it, even inside a string or a
  comment; `trif check` points them out.
- Where it isn't enough, see if a power covers it (below); if none does, say so and write a free mod; don't
  contort the mod.
  Examples: examples/boxed in TRIF's folder (Simple Shopping, DVD Logo).

### Powers: what a boxed mod can ask for

A boxed mod that needs one exception asks for it in its header, `// @powers sound, read-drafts`, from this
menu. TRIF holds the mod until the user approves that set of powers, once (an update that asks for nothing
new doesn't ask again; one that adds a power waits for it), and gives it those and nothing more. No power
sends anything the mod makes up (go-to and click go only where the header or the page's links say), so ask
only for what the mod needs; a mod that needs the network is a free mod.

- `sound`: `trif.audio()`: `tone({frequency, duration, volume, type, at})`, `play(dataUrl, {volume})`,
  and nodes for your own graph: `oscillator({type, frequency, wave: {real, imag}})` (and `setWave(real,
  imag)`: up to 4096 terms), `gain(v)`, `filter({type, frequency, Q})`, `delay(s)`, `panner(p)`,
  `compressor({threshold, knee, ratio, attack, release})` (its `reduction`, a number), `noise(s)`,
  `buffer([samples] or [left, right], rate, {loop})` (numbers, up to 10 s at 3000 to 96000 a second),
  `sound(dataUrl)`; each has `connect(node | node.param(name) | 'out')` (a node into another's parameter:
  FM, an LFO), `start(at)`, `stop(at)`, `param(name).set/ramp/expRamp/target`; `now`, `state`, `rate`,
  `latency` (`{base, output}`, seconds), `resume()`, `suspend()`, `close()` (the next `trif.audio()` makes a
  new one; up to 6 a minute), and `render(seconds, (offline) => build, {rate, channels})`: your graph
  rendered offline (the same API on `offline`), up to 10 s, one at a time, back as numbers: `{rate, length,
  peak, rms, channels: [Float32Array]}`. Sounds only from `data:audio/…;base64` (embed them); no addresses,
  no microphone, no worklets. The browser starts sound after the user clicks or types on the page; TRIF
  resumes it then (not after your `suspend()`).
- `controls`: your own `page.create('input' | 'select' | 'option')` (and `label`): inputs of type `range`,
  `color`, `checkbox`, `number` or `text`, with `min`/`max`/`step`/`value`/`placeholder`; read them with
  `.value` / `.checked`, set with `setValue` / `setChecked`, listen with `on('input')`. Never a password box,
  never `autocomplete` or `name`, never inside one of the page's forms. Doesn't make the mod wait on its
  own.
- `keys`: `key` and `code` on key events wherever the focus is, except in fields and editors (hotkeys on a
  focused post).
- `read-drafts`: what the user types: `.value` of the page's text fields, textareas and selects, `.text` of
  editors, `data` on `input` events, and keys in fields. Password and card fields stay hidden, always.

- `site-data`: `trif.filterResponse(urlGlob, (data, {url, method, status}) => data)`: the site's JSON
  responses (fetch and XHR) whose address matches (`*` for anything), as a plain copy, before the page
  sees them. Change it in place or return it. **Remove or reorder only**: every string, number and boolean
  in what you return, and every object key, has to be in what the site sent (a string or number no more
  times than it was there), or TRIF keeps the original and `trif errors` says why. Synchronous: no `await`.
- `page-data`: `el.pageData(path)`: the page's data behind an element, as a plain copy (no functions, no
  elements): `props.…` (its React props) or `fiber.…` (its React fiber: `fiber.return.memoizedProps.user`).
- `search-box`: `trif.searchBox({placeholder})` gives you a search box TRIF draws; place and style it like
  any element; you can't fill or read it. When the user presses Enter, it goes to the address in the header
  with their words: `// @powers search-box https://www.example.com/search?q={query}` (on the mod's own site).

- `media`: on the page's own `<video>` and `<audio>`: `play()` (a promise of true, or false if the browser
  wouldn't), `pause()`, `setMuted(bool)`, `setVolume(0..1)`, `seek(seconds)`, and `.media` (`{paused, muted,
  volume, currentTime, duration}`). Never their source.
- `go-to`: `trif.goTo(where)`: to a page the header lists (`// @powers go-to /home /i/bookmarks`: literal
  paths of the site, no query, `#` or `*`), or to an address a link on the page already shows, on the
  same site. Nothing you build: no query you add.
- `click`: `el.click()` on what the header names, each on a line of its own with words the user reads:
  `// @click the play button: button.play` (the hold says "can click these for you: the play button
  (button.play)"). Never something that submits or resets a form (submit or reset buttons, a button with
  no type in a form, a label for those), and never a link to another site, whatever the header says.
- `write-drafts`: change what the user is about to post: `setValue(text)` on the page's text fields and
  textareas (TRIF sends the page an `input` event, so React and the like see it), and `setText`, adding
  and removing inside editors. Never a password or card field, a hidden input or a select. To change what
  they typed you need to read it too (`read-drafts`). No addresses you make up: what you write may only
  have the addresses already in that field or editor, or in a link on the page (a site can fetch one for a
  preview before anything is posted); anything that looks like one counts (`example.com`, `node.js`).

- `block-events`: `trif.block(type, fn?)` keeps this site from seeing an event (when `fn(e)` returns true,
  or always without `fn`); a blocked event reaches only `fn`. The types are in the header: `// @powers
  block-events mouseover keydown click(button.cancel)` (mouse, pointer, key, wheel, scroll, touch and drag
  events; clicks only on a selector, in brackets, no spaces). Never what the user types into a field or
  editor, never TRIF's search box, never submit, focus, input or leaving the page.
- `page-events`: `trif.signal(name, detail)` sends the page's own code one of the header's signals
  (`// @powers page-events trif-demo-reset`: names with a `-` or `:`, never a browser event's, TRIF's, or a
  framework's like `htmx:` or `turbo:`), on the document; `detail` plain JSON with no address the page's
  links don't have.
- `site-storage`: `trif.storage('local' | 'session' | 'cookie')` gives `get(key)`, `set(key, text)`,
  `remove(key)`, `keys()` for the header's keys only: `// @powers site-storage session:trif-demo-state
  local:myPrefix:*` (a prefix ends with `*`; never a key named like a login: token, session, auth…). Cookies
  are only read. What you write has no address that wasn't there or in a link on the page. **`// @migrate
  localStorage old-key other-key`** brings what the mod's free version kept there into its settings once per
  site: `trif.settings('old-key', defaults)` then has it (listed on the hold).
- `rewrite-requests`: changes the site's own same-origin requests, as the header says and only so: `//
  @powers rewrite-requests HomeTimeline variables.enableRanking=false` (the request's name, the address's
  last part or its `operationName`; then `path=value`, values `true`, `false`, `null`, numbers or plain
  words; in a query parameter, its JSON, or a JSON body). TRIF makes the change; your code has no part in it.
- `image-variants`: `trif.imageVariant(img)` gives a new `<img>` of yours with another size of a picture
  the page shows, by the header's literal change on its host: `// @powers image-variants pbs.twimg.com
  _normal.→_400x400.` (`->` works too). Draw it on your canvas; its pixels read back where its host allows
  (CORS). `on('load')`/`on('error')` on your own pictures say when.
- `edit-uploads`: `trif.onUpload((canvas, {width, height, type}) => canvas)`: each PNG, JPEG or WebP
  picture the user attaches (a file input, a paste, a drop), as a canvas of yours; return it (or another of
  your canvases) and TRIF makes the file, same name and type, where the original was. You never get the file,
  its path or its metadata; other files pass untouched.
- `embeds`: `trif.embed(link, {label})` gives TRIF's button for a video a link on the page names; the
  user's click plays it inside the page from the header's player (`// @powers embeds www.youtube.com/embed`;
  also `www.youtube-nocookie.com/embed`, `player.vimeo.com/video`): the video's id only, no referrer.
- `local-fonts`: `await trif.localFonts()`: `[{family, fullName, style, postscriptName}]`, after the
  browser's own prompt (call it from the user's click).
- `preload` (doesn't make the mod wait on its own): `el.loadSooner()` on the page's own lazy `<img>`.
- And more of some: `site-data` also has `trif.filterEmbedded(selector, fn)` (the page's `<script
  type="application/json">`, before its code reads them; run the mod at `document-start`) and
  `trif.filterGlobal(name, fn)` for data globals the header names (`// @powers site-data ytInitialData`);
  responses behind a guard (`for (;;);`) or with several documents are filtered document by document; and
  an address the site sent may come back with whole query parameters taken out (so may a link's `href`).
  `search-box` takes `{autofocus, spaces: '+', emptyOk, button: yourButton, here: true, link}` (`{link}` in
  the header's address: the path of a link the page shows). `go-to` takes `reload` (`trif.reload()`, at most
  once in 10 seconds), a query from a list (`/?mods=[red|blue]`: `trif.goTo('/?mods=red,blue')`), and
  `trif.goTo(page, {inApp: true})` (TRIF moves the address and tells the page's router). `media` also hears
  the page's video and audio: `on('play' | 'pause' | 'ended' | 'timeupdate' | 'volumechange' | …)`.

**Combinations.** Some powers together warn the user in the hold ("Together, it could put what it reads into
something you post"; the list: docs/POWER-COMBINATIONS.md in TRIF's repository, or `trif check`), and more
than three powers get one general warning. Ask for the fewest that do the job. On a page, an act of yours
(writing a draft, clicking, playing media, go-to) is refused while another boxed mod there has a power that
would make a warned pair with it that yours didn't ask for (the error says which); a mod that needs both
asks for both.
- `mods`: `trif.channel(name)` gives `send(data)` and `on((data, {from}) => …)` between your boxed mods on
  this page that have the power: plain data only (text, numbers, true/false, null, arrays, plain objects),
  delivered a moment later. Doesn't make the mod wait on its own.

## Writing mods TRIF can read

TRIF reads every mod's code before it runs, and a mod that can do certain things waits for the user's OK
(AGENTS.md, "Mods that wait for the user's OK"). It goes by the code, not your `@risk` header, and it's
cautious: where it can't tell what a line does, it assumes the worst. Each new or changed line that it
flags asks the user again. So write mods it can read: the user gets fewer questions, and the ones they
get mean something. `trif check <site>/<mod>` shows what TRIF reads in a mod, line by line, with how to
avoid each thing where there's a way: run it after writing or changing one.

What it flags, and the plain way to do the same job:

| It flags | Because | Instead |
|---|---|---|
| `dispatchEvent(new KeyboardEvent(…))`, `new MouseEvent`, `.click()` on the page | that's acting for the user | to reach your own code (or another of your mods), dispatch a `CustomEvent` named after the mod (`new CustomEvent('my-mod-reset')`) and listen for it |
| `x[k] = v` when the mod's text mentions `src`, `href` or the like | it can't tell that from setting an element's `src` to an address it built | keep data in a `Map` (`m.set(k, v)`) or use array methods (`push`, `map`, `fill`); set element properties by name (`img.src = …`) |
| `document.createElement(tag)` with a variable | it can't rule out `<script>` | literal tags: `createElement('div')`; one small helper per kind of element if you want one |
| `el.setAttribute(name, …)` with a variable | it can't rule out `onclick` or `src` | name the attribute, or set the property (`el.title = …`, `el.dataset.x = …`) |
| `innerHTML` with values inside a tag (`` `<img src=${u}>` ``) | an attribute could be an inline handler | build elements with `createElement` and set `textContent` (values between tags, `` `<b>${name}</b>` ``, are fine) |
| `window[k]`, `x[k](…)`, names built from pieces, `atob`/`fromCharCode` | the name could be `fetch` or `eval` | call things by name; embedded data is fine as `Uint8Array.from(atob(s), (c) => c.charCodeAt(0))` |
| `eval`, `new Function`, `setTimeout('code')`, `<script>`, `javascript:` | code it can't read | write the code itself |
| `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `location = …`, `window.open` | sending, or going somewhere | only when the user asked for it: then it's right that it waits; say so |
| an address of another site, or one built at run time | it can carry what the mod reads elsewhere | the mod's own site, or `data:`/`blob:` |

Don't contort a mod to dodge the reader: if it genuinely needs to send, click or load, write it plainly
and tell the user why it waits. Code bent to look harmless (names built at run time, aliases of `window`)
is flagged as code TRIF can't check, which is a worse question to put to the user.

## Where mods run

- In the page's **MAIN world**: you share `window` with the site. You can patch `fetch`,
  `XMLHttpRequest`, `history`, prototypes; read the app's globals and React state. The site can also see
  (and break) anything you put on `window`, so keep globals to a minimum (each one also lets the site
  detect the mod) and prefix any you need (`window.__hideReposts`).
- At **`document_start`** by default: before the site's own scripts, so your hooks are in place before
  its first request. `document.documentElement` exists; `document.head` and `document.body` usually do
  not yet. Use `document-end` or `document-idle` only for simple DOM tweaks where a flash of the original
  page doesn't matter; network hooks must run at `document-start`.
- **Once per page load.** Single-page apps change pages without a load, so your mod won't run again on
  navigation: watch for it (see "DOM tweaks in single-page apps" below).
- `window.trif.log(...)`, `.warn(...)`, `.error(...)` record messages that `trif logs` shows,
  tagged with your mod. Use `window.trif?.log(...)` and log events, not every mutation. (`window.webmods`
  is the same object, its name before 0.2.0: leave it as it is in existing mods.)
- TRIF catches errors thrown while your mod first runs, and errors from its timers and handlers whose
  stack points at your file; `trif errors` shows both. A new error marks the mod's row and offers the user a
  fix (in the side panel's chat), so a mod that throws on every item is noticed: catch what you expect.
- `window.trif?.expect(selector)`: say what your mod looks for (the feed's items, the button it adds next
  to). If none of it is on a page where it was before, three loads in a row, TRIF flags the mod as maybe
  broken (the site changed) and offers a fix. It only notes the selector; call it once, at the start.
  Style mods and boxed mods don't need it: TRIF knows their selectors (rules, `trif.observe`, `trif.hide`).
- Your code isn't subject to the page's Content Security Policy, but what it creates may be: an iframe or
  image from another origin, an inline `<script>`, sometimes a `<style>` element. Sites with **Trusted
  Types** (many Google sites) throw on `el.innerHTML = '...'`: build DOM with `createElement` and
  `textContent` instead. CSP blocks are console messages, not exceptions; to see them, listen for
  `securitypolicyviolation` and `trif.warn` the `blockedURI`.

## Techniques, most robust first

### 1. CSS

For hiding, resizing, recolouring and rearranging, CSS is the most robust tool: it applies before the
first paint, survives re-renders, and can't break the app's logic.

```js
const addStyle = (css) => {
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).append(style);   // at document_start there's no <head> yet
  return style;
};
addStyle(`
  [data-testid=sidebarColumn] { display: none !important; }
  [data-testid=primaryColumn] { max-width: none !important; }
`);
```

- **Selectors**, best first: `data-testid` and similar test hooks; `aria-label` and `role`; `href`
  patterns (`a[href^="/explore"]`); ids; element structure. Avoid generated class names (`.css-1dbjc4n`,
  `.x1n2onr6`, `.sc-bdVaJa`): they change with every deploy. When `aria-label` is localized, prefer
  something language-neutral.
- **`:has()`** hides a container by what it contains:
  `[data-testid=cellInnerDiv]:has([data-testid=socialContext])`.
- **Mark, then style.** When the decision needs JS, set a prefixed attribute
  (`el.setAttribute('data-hr-hide', '')`) and keep the rule in your stylesheet
  (`[data-hr-hide] { display: none !important; }`). Don't remove nodes the site's framework owns:
  React will re-create them or crash. Hide them.
- Use `!important`; the site's own styles are often very specific.
- **Dark mode**: set real colours on the site's main containers. `html { filter: invert(1)
  hue-rotate(180deg) }` (re-inverting `img, video, picture`) is a quick fallback, not a good result.

For example, "make Hacker News dark and wider" is CSS only (after checking the live selectors):

```js
addStyle(`
  #hnmain { width: 100% !important; max-width: 1400px; background: #1b1b1d !important; }
  body { background: #111 !important; }
  body, td, .title, .subtext, .commtext { color: #ddd !important; }
  a:link, .titleline > a { color: #e8e8e8 !important; }
  a:visited { color: #9a9a9a !important; }
  .subtext a, .comhead a { color: #a0a0a0 !important; }
  #hnmain td[bgcolor="#ff6600"] { background: #3a2410 !important; }
  textarea, input { background: #222; color: #ddd; border: 1px solid #444; }
`);
```

**Virtualized lists** (rows absolutely positioned with `transform: translateY(...)`, only the visible
ones in the DOM: X, Facebook, Instagram, many modern feeds) don't take hiding well. A hidden row can
leave a gap, and if most rows are hidden the list may stop loading more, because it only fetches when its
end comes on screen. If you hide rows there, hide the row's contents (`[data-x-hide] > * { display: none
}`) so a list that re-measures its rows closes up, and check with a screenshot. Better: filter the data.

### 2. Filtering data before the app sees it

For "remove all X from my feed", rewrite the network response the feed is built from. The app then
renders a list without those items: no gaps, no flashes, correct counts, and the virtualized list works
as designed. Hook both `fetch` and `XMLHttpRequest`: many apps still use XHR (X does).

Keep the filter a **pure function** from parsed JSON to parsed JSON, and keep everything else identical.

```js
const TARGET = /\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline)\b/;   // match the operation name, not the hash
const filterData = (data) => { /* remove unwanted entries, keep cursors */ return data; };
const filterText = (text) => { try { return JSON.stringify(filterData(JSON.parse(text))); } catch { return text; } };

// fetch
const fetch0 = window.fetch;
window.fetch = async function (input, init) {
  const response = await fetch0.apply(this, arguments);
  const url = typeof input === 'string' ? input : input?.url || String(input);
  if (!TARGET.test(url) || !response.ok) return response;
  try {
    const text = filterText(await response.clone().text());
    const filtered = new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(filtered, 'url', { value: response.url });   // some apps read it
    return filtered;
  } catch (e) { window.trif?.warn('filter failed', String(e)); return response; }
};

// XMLHttpRequest: remember the URL, and filter through the response getters.
const open0 = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  this.__hrTarget = TARGET.test(String(url));
  return open0.apply(this, arguments);
};
const textGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;
const responseGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get;
const done = (xhr) => xhr.__hrTarget && xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 300;
const filtered = (xhr) => {   // computed once per request
  if (xhr.__hrFiltered === undefined) {
    const raw = responseGetter.call(xhr);
    xhr.__hrFiltered = typeof raw === 'string' ? filterText(raw)
      : raw && typeof raw === 'object' && !(raw instanceof Blob) && !(raw instanceof ArrayBuffer) ? filterData(raw) : raw;
  }
  return xhr.__hrFiltered;
};
Object.defineProperty(XMLHttpRequest.prototype, 'responseText', { configurable: true,
  get() { return done(this) && typeof responseGetter.call(this) === 'string' ? filtered(this) : textGetter.call(this); } });
Object.defineProperty(XMLHttpRequest.prototype, 'response', { configurable: true,
  get() { return done(this) ? filtered(this) : responseGetter.call(this); } });
```

Rules that matter:

- **Only touch matching requests.** Everything else passes through untouched, including errors and
  non-2xx responses. If parsing fails or the shape isn't what you expect, return the original.
- **Find the list wherever it is**, defensively: optional chaining everywhere, and when the layout varies
  between requests, a bounded search for the array (Detox Timeline looks for an `instructions` array up to a few
  levels deep).
- **Keep pagination working.** Never drop cursor entries (`cursor-bottom-…`, `next_page`, `endCursor`).
  An infinite list usually loads more only when its end moves; if you filter a page down to nothing, it
  may stop. Detox Timeline adds a placeholder entry (a slim "N posts hidden by your filters" row, with a unique
  id and a sort index just above the bottom cursor) so the list always grows, and stops adding them after
  three pages in a row with nothing new, so a feed that really ended can end.
- **State across pages** (posts already shown, for deduplication) resets on a fresh load: a request
  without a cursor.
- Requests can be rewritten the same way (Detox Timeline forces the Following feed to Recent by setting
  `enableRanking: false` in the GraphQL variables: in the URL for GET, in the JSON body for POST). Keep
  the change minimal and keep a request you don't understand as it was.
- Expose the pure function for tests if you like (`window.__hrFilter = filterText`), prefixed.

### 3. DOM tweaks in single-page apps

When CSS can't express it (moving an element, reacting to text, adding a button), change the DOM, and
expect the app to re-render and undo you at any time.

```js
// Re-apply on DOM changes, debounced. setTimeout, not requestAnimationFrame: rAF pauses in background tabs.
const onDOMChange = (fn, delay = 100) => {
  let queued = false;
  new MutationObserver(() => {
    if (!queued) { queued = true; setTimeout(() => { queued = false; try { fn(); } catch (e) { window.trif?.warn(String(e)); } }, delay); }
  }).observe(document.documentElement, { childList: true, subtree: true });
};

// Route changes: SPAs navigate with history.pushState/replaceState and the back button (popstate).
const onRoute = (fn) => {
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function () { const result = original.apply(this, arguments); fn(); return result; };
  }
  addEventListener('popstate', fn);
};
```

- Make every pass **idempotent**: check before changing (`if (!el.hasAttribute('data-hr-done'))`, `if
  (!row.querySelector(':scope > .hr-button'))`). Setting attributes doesn't re-trigger a
  childList-only observer; adding elements does, so guard insertions.
- **Flip a flag on `<html>` the moment the route changes** (`document.documentElement.toggleAttribute(
  'data-hr-explore', location.pathname.startsWith('/explore'))`) and key your CSS on it: the page is
  styled from its first frame, before the app renders anything.
- To navigate inside the app without a reload, use its router: `history.pushState({}, '', href);
  dispatchEvent(new PopStateEvent('popstate', { state: {} }));`, with a fallback to `location.assign(href)`
  if nothing happened after a second or so.
- To stop a click before the app's router sees it, listen on `document` in the capture phase and call
  `e.preventDefault(); e.stopImmediatePropagation()`. Use `e.target.closest('a[href]')` to find the link,
  and skip it when the click was on a button inside the link.

### 4. Reading app state from React

When the DOM doesn't have the data you need (an id, whether a post is a reply), the framework often does.
React stores its fiber on DOM nodes under a key starting with `__reactFiber$` (props under
`__reactProps$`). Walk up (`.return`) or down (`.child`) a bounded number of steps looking for the prop:

```js
const fiberOf = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactFiber$'))];
const propUp = (el, name, steps = 40) => {
  for (let f = fiberOf(el), i = 0; f && i < steps; i++, f = f.return) if (f.memoizedProps?.[name]) return f.memoizedProps[name];
  return null;
};
const tweet = propUp(article, 'tweet');   // X: the post object behind an <article>
```

Find the prop name by exploring with `trif run` (walk up from an element and list
`Object.keys(f.memoizedProps)` at each step). Treat it as fragile: guard every access, return `null`, and
degrade to doing nothing. Stores such as Relay or Redux can sometimes be reached the same way (Instagram's
Relay environment shows up as a prop with `getStore()`).

### 5. Shadow DOM

Styles from the page don't reach inside shadow roots, and `querySelector` doesn't either. Because mods
run before the site, you can catch every root as it's created, closed ones included:

```js
const roots = new Set();
const ROOT_CSS = `.min-w-\\[400px\\] { min-width: 0 !important; }`;
const styleRoot = (root) => {
  roots.add(root);
  if (!root.querySelector(':scope > style[data-hr]')) {
    const style = document.createElement('style');
    style.dataset.hr = '';
    style.textContent = ROOT_CSS;
    root.append(style);
  }
};
const attachShadow0 = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (...args) { const root = attachShadow0.apply(this, args); styleRoot(root); return root; };
setInterval(() => roots.forEach(styleRoot), 1500);   // put styles back if the app re-renders a root
```

For events, `e.target` is retargeted to the shadow host: use `e.composedPath()` to find the real element
(`e.composedPath().find((el) => el.tagName === 'A')`). The focused element inside shadow roots is
`document.activeElement.shadowRoot.activeElement` (repeat while there's a `shadowRoot`).

### 6. Adding UI

Small additions (a settings menu, a toggle, a section) should look like part of the site:

- **Match the theme** by reading computed styles: the body's background tells light from dark; copy
  the site's font (`getComputedStyle(someText).fontFamily`), radius and colours, and put them in CSS
  variables on `<html>` that your stylesheet uses. Re-read when you open a menu: the user may have
  switched themes.
- **Anchor** your element next to something stable, insert it from the DOM-change handler if it's
  missing, and use ARIA roles (`role="menu"`, `menuitemcheckbox`, `aria-checked`).
- **Settings** go in `localStorage` under a mod-specific key, merged over defaults, ignoring unknown
  keys (`try { Object.assign(options, JSON.parse(localStorage.getItem('hideReposts.options') || '{}')) }
  catch {}`). If a setting changes how data is filtered, reload the page when the menu closes after a
  change, so the data is fetched again.
- **Never insert page text as HTML.** Usernames, post text and anything else from the site go in with
  `textContent`, or through an escaping function. Prefer building elements to `innerHTML`.

## Keep mods fast

A mod runs on every page of its site, next to the user's other mods, often for hours. What they notice
is a hot laptop or a page that stutters, so ask before anything runs every frame, on every element, or on
a timer. These are what made TRIF's own mods slow, biggest first:

- **Each running CSS animation restyles its element every frame**, `steps()` or not. One on every post
  or every word means hundreds, and that can take a whole CPU core. Animate one element (a container,
  an overlay, a background), not each piece. Animating `transform` and `opacity` is cheapest, since the
  browser composites them without restyling. Pause what's out of view or switched off.
- **Never animate or keep rewriting something the whole page inherits.** An animated custom property
  registered with `inherits: true`, a variable set on `<html>` or `<body>` from a timer or a scroll
  handler, or a class there that a `html:has(...)` rule watches: each change restyles every element on
  the page. Put the variable on the elements that use it (`inherits: false`), and set your state as an
  attribute of your own (`html[data-xx-on]`), only when it changes.
- **Reading layout forces it.** `getComputedStyle`, `getBoundingClientRect`, `offsetWidth` and
  `elementsFromPoint` make the browser bring style and layout up to date first, and that's costly on a
  heavily styled page. That cost also lands on other mods' reads, so your styles can make their code
  slow. Read once when something changes, not on a timer. In a loop, do all the reads before any writes,
  or once per frame for everything that needs them, then share the result.
- **Write only what changed.** Update a text node or a style when its value differs, not on every pass.
- **Canvas:** draw text and blurred shapes (`shadowBlur`) once to an offscreen canvas and `drawImage`
  them each frame. Calling `fillText` and blurring every frame is slow.
- **Start light.** Do heavy setup only when it's needed, after the first frame: decoding embedded media,
  building audio graphs, large tables. Decode base64 with `Uint8Array.fromBase64` where it exists.

To check a mod, watch the page idle and while scrolling, with the mod on and off.
`document.getAnimations().length` counts what's animating. The browser's Performance panel shows
style, layout and paint time per second, and which functions are hot. If a mod is still costly when it
does what the user asked, say so in your report, with what it costs and what would make it cheaper.

## Resilient mods, and repairing broken ones

Sites ship new code constantly. Prefer what changes least: semantics (test ids, roles, labels, URL
patterns, GraphQL operation names) over structure, and structure over class names. Match GraphQL
requests by operation name (`/graphql/[^/]+/HomeTimeline`), never by the hash before it.

When a mod stops working:

1. `trif errors --url <site>` and `trif logs --url <site>`: an exception or a "shape changed"
   warning usually points at the cause.
2. Check each assumption live with `trif run`: does each selector still match? Does the fiber prop
   still exist?
3. For data mods, record again and compare the response with what the mod expects (write the new sample
   to a `_` file and diff it against the old one if you kept one). Look for renamed keys, a new wrapper
   object, new entry types.
4. Fix the smallest thing, keeping the mod's structure and the user's edits. Add the new shape alongside
   the old one when both may still be served.

## Testing

Pure logic, such as a filter function, can be unit-tested with Node. Keep a test file next to the mod,
named with a leading underscore so TRIF doesn't load it: `sites/x.com/_hide-reposts.test.js`. The
simplest way is to load the mod itself with stub globals and call what it exposes:

```js
const fs = require('fs'), path = require('path'), assert = require('assert'), { test } = require('node:test');
global.window = global;
global.location = { hostname: 'x.com', pathname: '/home', href: 'https://x.com/home' };
global.history = { pushState() {}, replaceState() {} };
global.addEventListener = () => {};
global.MutationObserver = class { observe() {} };
global.XMLHttpRequest = class {};
for (const k of ['responseText', 'response']) Object.defineProperty(XMLHttpRequest.prototype, k, { configurable: true, get() { return this._text; } });
XMLHttpRequest.prototype.open = function () {};
global.document = { documentElement: { append() {} }, head: null, cookie: '', querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => ({ append() {}, setAttribute() {}, dataset: {}, style: {} }) };
eval(fs.readFileSync(path.join(__dirname, 'hide-reposts.js'), 'utf8'));

test('reposts go, cursors stay', () => {
  const page = { data: { entries: [{ entryId: 'tweet-1' }, { entryId: 'tweet-2', repost: true }, { entryId: 'cursor-bottom-1' }] } };
  const out = JSON.parse(window.__hrFilter(JSON.stringify(page)));
  assert.deepStrictEqual(out.data.entries.map((e) => e.entryId), ['tweet-1', 'cursor-bottom-1']);
});
```

Run it with `node --test sites/x.com/_hide-reposts.test.js` (not available in side-panel runs; see
"Side-panel runs" in AGENTS.md). Build fixtures from a real recorded
response (trimmed), and add a case for every bug you fix.

## Reference implementation

**Detox Timeline** (`trif install-example x.com/detox-timeline`) is a large, battle-tested mod for X: filtering of
GraphQL timelines over fetch and XHR, placeholder entries that keep infinite scroll going, request
rewriting, React fiber reads, a settings menu in X's style, SPA route hooks and a debounced observer. If
the workspace has it (`sites/x.com/detox-timeline.js`, or `_detox-timeline.js` when set aside), read it for
patterns. Installing it changes how X looks and behaves, so only do that if the user wants it.
