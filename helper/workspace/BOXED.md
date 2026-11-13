# TRIF: boxed mods and their powers

Read this when you write, convert or repair a **boxed mod** (`// @boxed`); not otherwise. TECHNIQUES.md
(next to this file) covers style mods, free mods, testing and repairs; AGENTS.md the workspace, the CLI,
the workflow and the safety rules, which always apply.

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
  that match, roots inside roots too, now and as they're made), `hide(selector)`, `observe(selector, fn, {attributes: ['class',
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
new doesn't ask again; one that adds a power waits for it), and gives it those and nothing more. The quiet
powers (`sound`, `controls`, `mods`, `preload`, `embeds`, `media`) don't make it wait on their own; a warned
combination one of them makes does. No power
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
  Put the words in quotes when they're what the thing says: `// @click "Show more": button.more`. Then TRIF
  only lets you click what matches the selector *and* says those words (its own text, `aria-label` or
  `title`, as the page wrote them: an element whose text or label a boxed mod changed doesn't count), and the
  hold says so ("only what says "Show more""). Prefer that: the user knows a button by what it says, and
  a selector can match more than you meant.
- `write-drafts`: change what the user is about to post: `setValue(text)` on the page's text fields and
  textareas (TRIF sends the page an `input` event, so React and the like see it), and `setText`, adding
  and removing inside editors. Never a password or card field, a hidden input or a select. To change what
  they typed you need to read it too (`read-drafts`). No addresses you make up: what you write may only
  have the addresses already in that field or editor, or in a link on the page (a site can fetch one for a
  preview before anything is posted); anything that looks like one counts (`example.com`, `node.js`).
  Write as the user types (an `input` listener), not as they send: from their press on anything that isn't a
  field, an editor or your own element until a moment after the click, and for a moment after Enter, a write
  is refused ("a draft isn't changed while the user is pressing a button or Enter").

- `block-events`: `trif.block(type, fn?)` keeps this site from seeing an event (when `fn(e)` returns true,
  or always without `fn`); a blocked event reaches only `fn`, where `e.preventDefault()` also stops what the
  browser would do (the page scrolling on Space or an arrow key; not for wheel and touch). The types are in the header: `// @powers
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
  are only read. What you write has no other site's address that wasn't there or in a link on the page (this
  site's own, `example.com/page` on example.com, is fine). **`// @migrate
  localStorage old-key other-key`** brings what the mod's free version kept there into its settings once per
  site: `trif.settings('old-key', defaults)` then has it (listed on the hold).
- `rewrite-requests`: changes the site's own same-origin requests, as the header says and only so: `//
  @powers rewrite-requests HomeTimeline variables.enableRanking=false` (the request's name, the address's
  last part or its `operationName`; then `path=value`, values `true`, `false`, `null`, numbers or plain
  words; in a query parameter, its JSON, or a JSON body). TRIF makes the change; your code has no part in it.
- `image-variants`: `trif.imageVariant(img)` gives a new `<img>` of yours with another size of a picture
  the page shows, by the header's literal change on its host: `// @powers image-variants pbs.twimg.com
  _normal.→_400x400.` (`->` works too). It shows from any host. To read its pixels, ask for them:
  `trif.imageVariant(img, {pixels: true})` loads it with CORS, so drawn on your canvas its pixels read back
  where its host allows (a host without CORS then doesn't show it). `on('load')`/`on('error')` on your own pictures say when.
- `edit-uploads`: `trif.onUpload((canvas, {width, height, type}) => canvas)`: each PNG, JPEG or WebP
  picture the user attaches (a file input, a paste, a drop), as a canvas of yours; return it (or another of
  your canvases) and TRIF makes the file, same name and type, where the original was. If no mod draws on
  it or gives back another, the original file goes on untouched. You never get the file,
  its path or its metadata; other files pass untouched.
- `embeds`: `trif.embed(link, {label})` gives TRIF's button for a video a link on the page names; the
  user's click plays it inside the page from the header's player (`// @powers embeds www.youtube.com/embed`;
  also `www.youtube-nocookie.com/embed`, `player.vimeo.com/video`): the video's id only, no referrer.
- `local-fonts`: `await trif.localFonts()`: `[{family, fullName, style, postscriptName}]`, after the
  browser's own prompt (call it from the user's click).
- `preload` (quiet: doesn't make the mod wait on its own): `el.loadSooner()` on the page's own lazy `<img>`.
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
would make a warned pair with it that yours didn't ask for (the error says which), until the user approves
what the site's boxed mods can do together: TRIF asks on the hold of the mod that adds a power ("Your <site>
mods can:", what it adds marked new), once per site. **Never ask for a power your mod doesn't use** just to
act beside another mod: that puts warnings on its hold for things it can't do. A mod that uses both asks for both.
- `mods`: `trif.channel(name)` gives `send(data)` and `on((data, {from}) => …)` between your boxed mods on
  this page that have the power: plain data only (text, numbers, true/false, null, arrays, plain objects),
  delivered a moment later. Doesn't make the mod wait on its own.
