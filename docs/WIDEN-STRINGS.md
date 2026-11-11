# The widened box: the new strings (branch powers)

**All awaiting Tim's OK.** Every user-facing string the widening adds (WIDEN.md, class A and class B):
the new powers' hold sentences, the new combination warnings, and the errors a boxed mod (and so the agent
writing it) sees. Errors read "TRIF sandbox: …" in `trif errors`; header errors are `trif check`'s.
`{…}` is a value filled in.

## Holds (panel and trif status), the new powers

A hold stores each as a fact after "it": the panel shows "It <fact>.", `trif status` "it <fact>".

| power | fact |
|---|---|
| block-events | can keep this site from seeing some of what you do here ({what}), so the site doesn't react to it · {what}: "the mouse moving over things", "keys", "clicks", "clicks on {selector}", "scrolling", "touches", "dragging" |
| page-events | can send this page's own code these signals: {names} |
| site-storage | can read and change what this site keeps under: {keys} · a cookie: "{name} (a cookie: only read)" |
| rewrite-requests | changes what {site} receives from this page: {name} set to {value} (in {operation} requests) |
| image-variants | can load other sizes of pictures this page shows (from {host}) |
| edit-uploads | can change pictures you attach on this site before you post them |
| embeds | can play videos this page links to, inside the page (from {youtube.com}) |
| local-fonts | can see which fonts are installed on this computer (and this site could see that too) |
| preload (listed, never holds alone) | can make this page load its pictures sooner |
| `@migrate` (a need of its own) | brings over its old settings from what this site keeps under: {keys} (once) |
| go-to, with `reload` | can reload this page; it can take you to these pages on {site}: …, or to a link the page shows |
| go-to, a query from a list | … these pages on {site}: /?mods=one of red, blue, … |
| search-box, with `{link}` | adds a search box that searches {host} (in the place a link on the page names) |

Two notes for Tim: WIDEN.md's image-variants sentence said "bigger versions"; the change in the header can
make any size, so it says "other sizes". The rewrite-requests sentence says plainly that it changes what the
site receives (the coordinator's ask), naming the setting, its value and the requests.

## Combination warnings, the new ones (helper/lib/combinations.js)

The red box's lines, "Together, it …", with their ranks among all thirteen (the eight before keep their
words; their ranks moved to make room):

1. could put what it reads into a post and send it for you *(as before)*
2. could go to a page, write a post there and send it for you *(as before)*
3. could write a post and send it for you *(as before)*
4. could put what it reads into something you post *(as before)*
5. **could put what it reads into a picture you post** (a read + edit-uploads)
6. **could hand what it reads to this page's own code, which may post or send it** (a read + page-events)
7. could take you to a page and click things there for you *(as before)*
8. **could take you to a page and set off that page's own actions there** (go-to + page-events)
9. could let what it reads decide what it clicks for you *(as before)*
10. **could keep your clicks from reaching the page and click in their place** (block-events + click)
11. could pass what it reads to the site a video or sound comes from, by how it plays it *(as before)*
12. **could pass what it reads to the sites this page's pictures come from, by which ones it loads** (a read + image-variants or preload)
13. could turn what it reads into sounds that a device nearby could pick up *(as before)*

The many-powers sentence is unchanged. New reasons ("No added risk: …") in docs/POWER-COMBINATIONS.md:
- its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it
- it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it
- keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields
- it only makes the page load its own pictures sooner, as it would when you scroll to them
- both only load the page's own pictures, from where the page gets them

## Page-wide rules (errors a mod sees), the new acts

Each reads "{act} is off on this page while another boxed mod here has the {power} power: with both, {why}
(a mod that asks for {act} and {power} together shows the user that)":

| act | why |
|---|---|
| signalling the page's own code | what one reads could reach the page's code, which may post or send it |
| changing the pictures the user attaches | what one reads could end up in a picture the user posts |
| loading other sizes of the page's pictures | what one reads could reach the pictures' host through which ones load |
| loading the page's pictures sooner | what one reads could reach the pictures' host through which ones load |
| clicking for the user *(changed)* | what one reads could decide what the other clicks (or one could keep the user's clicks from the page while the other clicks) |
| taking the user to a page *(changed)* | one could take the user to a page where the other clicks or sets off the page's own actions |

And: **clicking for the user is off on this page since another boxed mod here changed a picture the user
attached: with both, it could be posted without the user (a mod that asks for click and edit-uploads
together shows the user that)**; the same two for page-events: **signalling the page's code is off on this
page since another boxed mod here changed a draft: …** and **… changed a picture the user attached (a mod
that asks for page-events and edit-uploads together shows the user that)**.

## Header errors (trif check), the new ones

- @events "{…}": a page's own event's name has a - or a : in it (no browser event has either)
- @events "{…}": trif: events are TRIF's own
- @migrate "{…}": a key by its whole name
- @migrate "{…}": say where and which keys: // @migrate localStorage my-key other-key
- block-events: "{…}" can't name the value attribute or :autofill
- block-events: "{…}" isn't an event it may keep from the site (mouse, pointer, key, wheel, scroll, touch and drag events, and clicks on a selector; never submit, focus, input or leaving the page)
- block-events: {…} only on what it names: {…}(button.cancel)
- embeds: "{…}" isn't a player TRIF makes embeds for ({…})
- go-to: "{…}" in {…} isn't a plain word (letters, digits, - and _): a value can't be an address
- go-to: "{…}" isn't a page of this site
- go-to: "{…}" isn't a page of this site: a path starting with /, with no query, # or *; or reload; or /path?name=[one|two]
- image-variants takes the pictures' host and the change: @powers image-variants pbs.twimg.com _normal.→_400x400.
- image-variants: "{…}" isn't a change from→to (up to 60 characters each, no // or @)
- page-events: "{…}" is named like a framework's own event (htmx:, turbo:, alpine:, …), which the page's code acts on
- rewrite-requests takes the request's name and what to set in it: @powers rewrite-requests HomeTimeline variables.enableRanking=false
- rewrite-requests: "{…}" isn't name.path=value
- rewrite-requests: "{…}" isn't true, false, null, a number or a plain word (an address or long text could carry data)
- search-box: "{…}" isn't an address
- search-box: one {link} at most
- site-data: "{…}" isn't a data global TRIF filters (a name like ytInitialData; never a browser name)
- site-storage: "{…}" is named like a login (token, session, auth…): a boxed mod doesn't get those
- site-storage: "{…}" isn't a key: local:name, session:name or cookie:name (a prefix may end with *)
- site-storage: "{…}": a prefix is at least 3 characters before the *
- the {…} power needs {…}
- the {…} power takes nothing after its name
- {…}: "{…}" isn't a page's own event's name (one with a - or a : in it: no browser event has either)
- {…}: trif: events are TRIF's own

## Errors a boxed mod sees (TRIF sandbox: …), the new ones

Class A and class B together, in the order of their words:

- "{…}" isn't a style property
- "{…}" isn't an attribute name
- "{…}" isn't one of the data globals the header names (@powers site-data {…})
- "{…}" isn't one of the events the header says it keeps from the site ({…})
- "{…}" isn't one of the header's keys ({…})
- "{…}" isn't one of the header's signals ({…})
- <{…}> isn't one of the SVG elements offered
- a buffer's channels are as long as each other, and not empty
- a colour loads nothing
- a drop effect is none, copy, link or move
- a duration is a number of milliseconds
- a keyframe is { property: value }
- a length is a number
- a margin is like "100px 0px"
- a mod makes up to 6 sound contexts a minute (close one less often)
- a pattern is up to 200 characters
- a point is two numbers
- a rate is a number
- a render has 1 or 2 channels
- a render is up to {…} seconds
- a sample rate is {…} to {…}
- a signal's detail is plain data (JSON)
- a signal's detail is plain data, up to 64 KB
- a stop's offset is a number from 0 to 1
- a style value is text or a number
- a threshold is a number from 0 to 1 (or a list of them)
- a time is a number of milliseconds
- a wave has as many real terms as imaginary ones, at least 2
- an image the mod made is drawn from data:, blob:, or an address an image on the page shows
- animate's timing is a duration, or { duration, delay, iterations, easing, … }
- as the page goes away, a mod may only save its settings
- attributes is a list of 1 to 20 attribute names
- block takes a function, or nothing
- blur is for the mod's own elements and TRIF's search box
- buffer takes one or two channels: [[numbers]] or [[left], [right]]
- button is a <button> of the mod's own
- capturePointer takes the event's pointerId
- changes takes a function
- clicking for the user is off on this page since another boxed mod here changed a picture the user attached: with both, it could be posted without the user (a mod that asks for click and edit-uploads together shows the user that)
- composite is replace, add or accumulate
- connect takes another of this mod's sound nodes, one of their parameters, or 'out'
- cookies are only read
- css's options are { shadow: 'a selector for the hosts' }
- direction is normal, reverse, alternate or alternate-reverse
- drag and drop is for the mod's own elements
- draggable is true, false or auto
- drawImage and pattern take the mod's own canvas, or an image (<img>)
- embed takes a link the page shows
- fill is none, forwards, backwards, both or auto
- filterEmbedded takes a function
- filterGlobal takes a function
- focus at most 10 times in 10 seconds
- focus is for the mod's own elements and TRIF's search box (never the page's: the user's next keys would go there)
- focus only while the page is showing
- getImageData takes a width and height, up to 16 million pixels
- hearing the page's video and audio needs the media power (// @powers media)
- imageVariant takes one of the page's own pictures (<img>)
- iterations is a number (or Infinity)
- keyframes are a list (up to 100) of { property: value }
- listening for "{…}" isn't offered{…}
- loadSooner is for the page's own pictures (<img>)
- loading the page's pictures sooner needs the preload power (// @powers preload)
- nested repeats ((a+)+ and the like) and back-references can make a page hang
- no {…} here
- not while the pointer is on TRIF's search box
- observe's options are { attributes: [names] }
- offset is a number
- onChange takes a function
- onResize takes a function
- onUpload takes a function
- onUrl takes a function
- onVisible takes a function
- onVisible's options are { threshold, rootMargin }
- one render at a time
- only the mod's own animations can be changed (the page may use one of its own as a timer)
- pagehide is for page.on
- playing the page's video and audio needs the media power (// @powers media)
- pointer capture is for the mod's own elements
- pointer capture is for the mod's own elements (on the page's, it would take their clicks)
- putImageData takes a width and height
- putImageData takes { width, height, data }
- releasePointer takes the event's pointerId
- reloading needs `reload` in the header: @powers go-to reload
- render takes a function that builds the sound
- setData is for a drag that starts on the mod's own element, in its dragstart
- settings can take up to 1 MB
- signalling the page's code is off on this page since another boxed mod here changed a draft: with both, a draft could be sent without the user (a mod that asks for page-events and write-drafts together shows the user that)
- signalling the page's code is off on this page since another boxed mod here changed a picture the user attached (a mod that asks for page-events and edit-uploads together shows the user that)
- stopping an event is for events on the mod's own elements (the page's own need the block-events power)
- storage is 'local', 'session' or 'cookie'
- that CSS loads from an address (only data:, #somewhere, or an image the page shows), or has escapes outside strings
- that link has no address
- that link isn't a video from {…}
- that picture has no address
- that picture is over 8 MB as a data: address
- that picture isn't from {…}
- that {…} names an address, code, or an id that isn't the mod's own (url(#trif-box-…) and href="#trif-box-…" only)
- that's for the page's <video> and <audio>
- the header names no {…}: keys (@powers site-storage {…}:a-key)
- the header's change doesn't apply to that picture's address
- the page's own canvas isn't drawn from (it may be a signature pad, or a drawing the page uploads)
- the pixels are width × height × 4 numbers
- the search-box power needs its address in the header: @powers search-box https://…{query}
- the user is in one of the page's fields: the focus stays there
- the value attribute isn't watched (React keeps it in step with what's typed in a field)
- this browser doesn't list its fonts
- this browser has no Web Audio
- this browser has no conic gradients
- this element can't be animated
- this search box's address has {link}: give it a link the page shows, { link: page.find(…) }
- toDataURL makes image/png, image/jpeg or image/webp
- wrap takes a function
- wrap takes a pattern (/…/)
- {link} is a link the page shows, on this site
- {…} can't be set here
- {…} has a number that isn't finite
- {…} is a list of numbers
- {…} is a list of numbers (an array or a typed array)
- {…} is a number
- {…} is for SVG shapes
- {…} is for the mod's own pictures
- {…} is for the page's <video> and <audio>
- {…} is up to {…} numbers
- {…} isn't offered inside an editor (what the user is typing)
- {…} isn't one of animate's options
- {…} loads nothing (no url())
- {…} must be a number
- {…} takes a colour, or a gradient or pattern of this canvas
- {…} takes numbers
- {…} takes text or a number
- {…}: too many

Also, from TRIF's own URL, TextDecoder and structuredClone: the browser's own message for a bad address or
encoding; **only plain data can be cloned**; **functions can't be cloned**; **symbols can't be cloned**.

## trif check's lint, changed

- Names now there aren't listed (Float32Array, Float64Array, URL, URLSearchParams, Intl, TextEncoder,
  TextDecoder, structuredClone, atob, btoa, performance.now); `trif.audio().play(…)` isn't "needs the media
  power" any more (only the page's `play()` and `pause()`, which take nothing).
- New: **not there in a boxed mod: the sandbox (SES) leaves it out of every mod** (Float16Array,
  SharedArrayBuffer, Atomics, WeakRef, FinalizationRegistry, WebAssembly); **a boxed mod has
  performance.now() only (the rest lists what the page loaded)**; **not there in a boxed mod: it would make a
  blob: address (a canvas's toDataURL() makes a data: one)**; **use setText** (for `.innerText =`); **a
  stand-in's {name} is read only (scrolling the page's elements would make it load more)**.
- The "not there" line now ends **…: it has page, trif, console, the timers, Math, Date, the language and
  its pure tools (URL, Intl, typed arrays…)**, and for some names a tip: **use trif.observe(selector, fn, {
  attributes }) or trif.changes(selector, fn)** (MutationObserver), **use el.onResize(fn)**, **use
  el.onVisible(fn, { threshold, rootMargin })**, **use page.matchMedia(query)**, **use page.devicePixelRatio**,
  **use el.style(property)**, **use page.width** / **page.height**, **use page.url (and trif.onUrl)**, **use
  page (page.find, page.body, page.create)**, **use trif.audio() (the sound power)**, **use
  trif.audio().render(seconds, build)**, **el.isPointInFill(x, y) takes numbers**, **getImageData and
  putImageData take and give { width, height, data }**.
- Element tips, new: **use capturePointer(e.pointerId), on the mod's own elements**, **use
  releasePointer(e.pointerId)**, **use animations()**, **use bbox()**, **use totalLength()**, **use
  pointAtLength(length)**, **use page.createSvg(tag)**, **use trif.wrap(selector, /pattern/, fn)**, **use
  toDataURL()**; changed: **a stand-in's style is style(property, value) (and inlineStyle(property) reads
  its style attribute)**; removed: "focus: not offered in a boxed mod" (it is, on its own elements).

## Other

- The search box (search-box, `button`): TRIF's own box, unchanged; the mod's button searches on the user's
  own click.
- The embed button's default label: **Play the video here**.
- Settings caps: **settings can take up to 1 MB** (was 64 KB); **a mod's settings can take up to 1 MB on a
  site**; **the boxed mods' settings on this site are at their 8 MB**; reload: **a boxed mod reloads a page at
  most once in 10 seconds**.
