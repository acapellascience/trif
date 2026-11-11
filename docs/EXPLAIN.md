# What the panel's words mean

Written out from extension/explain.json (tests/explain.test.js checks this file is that table):
`node -e "process.stdout.write(require('./helper/lib/explain').toMarkdown())" > docs/EXPLAIN.md`.

Every term the side panel shows has four layers: its label (1-3 words: a row chip, a power's name), its
line (the approved sentence: the approval card, a chip's hover, `trif status`), its explanation (2-4
sentences, behind "more" in the panel) and notes for agents (`trif explain <term>`). The code keeps its
own labels and lines; the tests check each against the table. "Drafted": written for this table, not
shown in the panel as such.

## Tiers

### Style mods

`tiers/style-mods`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Style mods
- **Line**: Only change how the page looks.
- **Explanation**: Only change how the page looks. TRIF runs them from data: there's no code in them, only rules about what to restyle, hide or reword, so they can't send, load or click anything themselves. One thing to watch: by restyling, a mod could hide a real button under something else, so your own click lands on it.
- **For agents**:
  - First choice for any mod: `// @style` in the header (old name `@rules` still works); `trif new <site> <mod> --style`. After the header, one JSON object: `css`, `hide`, `replace` ({in?, find, with, regex?, caseless?}), `filter` ({items, hideIfText | hideIfRegex | hideIfHas}).
  - Refused by `trif check` and NOT SENT: CSS that loads anything (`url()` other than `data:` or `#fragment`, `@import`, `image-set()`, backslash escapes outside strings), selectors naming the `value` attribute or `:autofill`, selectors containing `{`, `}`, `;` or `@`.
  - Never waits for the user's OK. Made by the side-panel chat it starts on, unless Settings' "Mods your chat makes" is Wait for me; from anywhere else it starts off.
  - Not enough when you need logic, new elements, timing or drawing: write a boxed mod.
  - Clickjacking (RT-3) is open for every tier: don't float elements over the page's own controls.

### Boxed mods

`tiers/boxed-mods`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Boxed mods
- **Line**: Do only what you've allowed.
- **Explanation**: Do only what you've allowed. They run in TRIF's sandbox and change what the page shows; on their own they can't send, load, click or read what you type. One that needs more asks for named powers and gets only those. In Safari, which has no sandbox, a boxed mod runs as a free mod after your OK.
- **For agents**:
  - `// @boxed` (old `@sandboxed`); `trif new <site> <mod> --boxed`. JavaScript in an SES compartment in TRIF's user-script world; elements are frozen stand-ins; the API is TECHNIQUES.md "Boxed mods".
  - Not there: `window`, `document`, `fetch`/XHR/WebSocket, storage, `postMessage`, `eval`/`Function`, event constructors. `trif check` lints each ("not there in a boxed mod…", with tips). Source containing `import(` or an HTML comment marker is refused, even inside a string or comment.
  - Names it sets must be its own (`trif-box-` ids and classes, `data-trif-box-*`); links and images only take addresses the page already has; it can't write into the page's forms or editors (that's write-drafts).
  - No powers: never waits for the user's OK. With `// @powers …`: held once for that set; an update with the same set runs, one that adds a power waits for it.
  - Safari (and any browser whose world can't be configured): held, then runs as a free mod in the Free mods group; the page-wide rules don't apply there.
  - If no power covers what's needed, say so and write a free mod; don't contort the boxed one.

### Free mods

`tiers/free-mods`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Free mods
- **Line**: Run in the page with everything it has.
- **Explanation**: Run in the page with everything it has. A free mod can do anything the page can, including posting or sending as you. TRIF reads its code first and holds one that can send, click, go to other pages or hide what it does, but that reading can miss things, so switch on only free mods you trust.
- **For agents**:
  - No tier line in the header: the default for `trif new <site> <mod>`. Use it only for what needs the page: patching fetch/XHR or the app's code, its state, a network request, acting for the user.
  - helper/lib/powers.js reads it token by token; a new or changed mod that sends, clicks or types, navigates, loads from a computed address, names another site or hides code (`eval`, `Function`, string timers, `import()`) is HELD until the user allows it. Approving (`trif approve`, Allow, allowed.json) is the user's, never yours.
  - `trif check <site>/<mod>` shows what TRIF reads, line by line, with ways round (a fake key press, `x[k] = v` in a mod that mentions `href`, a tag name in a variable).
  - Allowances are per power and per line: a later edit that adds a power, or adds or changes a line using one, waits again.
  - Set `@risk 0|1|2` honestly; the panel's level comes from it, and TRIF's reading can raise it, never lower it.
  - Never act on `trif-box-` names; give a free mod's own elements plain `trif-` names. The user can switch Free mods off per site: then it doesn't run there, whatever its own switch says.

## Powers

### read-drafts

`powers/read-drafts`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: read-drafts
- **Line**: It can read what you type on this site, but can't send it anywhere.
- **Explanation**: It can read what you type on this site, but can't send it anywhere. It sees what's in text fields, text boxes and editors, never password, card or one-time-code fields. Beside a power that writes, clicks or plays something, what it reads could find a way out, so those pairs show a warning.
- **For agents**:
  - Gives `.value` of the page's text fields, textareas and selects (not hidden, file or button inputs), `.text` of editors and attributes inside them, `data` on `input` events, and keys pressed in fields.
  - Without it: "reading what's typed in the page needs the read-drafts power (// @powers read-drafts)". Always: "password and card fields stay hidden, whatever the mod's powers" (type=password; autocomplete cc-*, current-password, new-password, one-time-code). Also "a {type} input isn't something the user typed", "<{tag}> has no value".
  - Not needed to count, style or hide fields; `attr('value')` on a field stays null with or without it.
  - A read: with write-drafts, click, media, sound, edit-uploads, page-events, image-variants or preload it warns. On a page, another boxed mod's act beside it is refused unless that mod has read-drafts too.

### keys

`powers/keys`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: keys
- **Line**: It can see the keys you press (not in text fields), so it can have shortcuts.
- **Explanation**: It can see the keys you press (not in text fields), so it can have shortcuts. It doesn't see what you type into fields or editors. One gap: a field tucked inside a part of the page TRIF can't look into could pass it a few keys, so allow it only for shortcuts you want.
- **For agents**:
  - Gives `key`/`code` on key events wherever the focus is, except in fields and editors: hotkeys while a post (a div, article or custom element) has focus.
  - Without it a boxed mod already gets `key`/`code` when focus is on the page, a link, a button or a list item; ask for `keys` only when that isn't enough.
  - Known gap: a field inside a closed shadow root on a plain element can't be detected, so its keys may reach the mod.
  - Counts as a read in the combination table (warns with write-drafts, click, sound, media, …).

### site-data

`powers/site-data`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: site-data
- **Line**: It can see and filter what {site} sends this page (posts, profiles), but can't send anything.
- **Explanation**: It can see and filter what {site} sends this page (posts, profiles), but can't send anything. It can only take things out or change their order, never add its own: TRIF checks what it gives back and keeps the site's original if anything is new. The site could notice that not everything it sent was shown.
- **For agents**:
  - `trif.filterResponse(urlGlob, (data, {url, method, status}) => data)`: the site's JSON fetch/XHR responses whose address matches (`*` for anything), as a plain copy, before the page sees them. Synchronous: no `await`.
  - Remove or reorder only: every string, number and boolean value and every object key you return must be in what the site sent (a value no more times than it was there). Otherwise `trif errors` says "a filter may only remove or reorder, and {why}: TRIF kept what the site sent"; a promise back: "a filter returns the data itself, not a promise: TRIF kept what the site sent".
  - Also `trif.filterEmbedded(selector, fn)` (`<script type="application/json">`; run at document-start) and `trif.filterGlobal(name, fn)` for globals the header names (`// @powers site-data ytInitialData`); header error: `site-data: "{n}" isn't a data global TRIF filters (a name like ytInitialData; never a browser name)`.
  - An address the site sent may come back with whole query parameters taken out (never longer); so may a link's `href`.
  - Panel level 1 (noticeable, "what it sends isn't all shown"). Changing what the site receives is rewrite-requests, not this.

### page-data

`powers/page-data`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: page-data
- **Line**: It can read the data {site} keeps behind what's on the page.
- **Explanation**: It can read the data {site} keeps behind what's on the page. That's often more than the page shows, such as the details behind a name or a post, and it gets a copy it can't change. On its own that stays on the page; beside a power that writes, clicks or plays something, it shows a warning.
- **For agents**:
  - `el.pageData(path)`: a plain JSON copy (functions and nodes stripped): `props.…` (React props) or `fiber.…` (`fiber.return.memoizedProps.user`).
  - Without it: "the page's data needs the page-data power (// @powers page-data)"; a bad path: "a path is names with dots between them (props.post.text)".
  - Use it instead of a free mod's React-internals reading when the mod only needs to read.
  - A read in the combination table.

### site-storage

`powers/site-storage`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: site-storage
- **Line**: It can read and change what this site keeps under: {keys}.
- **Explanation**: It can read and change what this site keeps under: {keys}. Only under those names, never one that looks like a login, and cookies it can only read. Changing what the site keeps can change how the site behaves for you, and the site could notice.
- **For agents**:
  - `trif.storage('local' | 'session' | 'cookie')` gives `get(key)`, `set(key, text)`, `remove(key)`, `keys()` for the header's keys only: `// @powers site-storage session:my-state local:myPrefix:*` (a prefix ends with `*`, at least 3 characters before it).
  - Header errors: `site-storage: "{k}" is named like a login (token, session, auth…): a boxed mod doesn't get those`; `site-storage: "{a}" isn't a key: local:name, session:name or cookie:name (a prefix may end with *)`; `…a prefix is at least 3 characters before the *`. Runtime: "cookies are only read", `"{k}" isn't one of the header's keys ({…})`, `the header names no {area}: keys …`.
  - What you write can't add an address that wasn't already there or in a link on the page (the write-drafts check).
  - For the mod's own settings use `trif.settings` (no power). To carry over what a free version kept, once, use `// @migrate localStorage key …` rather than this power.
  - A read; panel level 1 (noticeable).

### local-fonts

`powers/local-fonts`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: local-fonts
- **Line**: It can see which fonts are installed on this computer (and this site could see that too).
- **Explanation**: It can see which fonts are installed on this computer (and this site could see that too). Your browser asks you first. The fonts you have can help sites tell your computer apart from others, so allow it only for a mod that needs them.
- **For agents**:
  - `await trif.localFonts()` gives `[{family, fullName, style, postscriptName}]` (up to 5000), after the browser's own prompt: call it from the user's click.
  - "this browser doesn't list its fonts" where the browser has no `queryLocalFonts`.
  - Narrower: let the user type a font name into a `controls` text box and apply it with `font-family` in `trif.css`; that reads nothing.
  - A read in the combination table; panel level 1 (noticeable).

### image-variants

`powers/image-variants`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: image-variants
- **Line**: It can load other sizes of pictures this page shows (from {host}).
- **Explanation**: It can load other sizes of pictures this page shows (from {host}). TRIF makes each address from a picture already on the page, by the one change its header names; the mod only picks which picture. The pictures' host sees which ones load, so beside a power that reads, that choice shows a warning.
- **For agents**:
  - `trif.imageVariant(img)` gives a new `<img>` of the mod's own. Header: `// @powers image-variants pbs.twimg.com _normal.→_400x400.` (`->` works too).
  - Header errors: "image-variants takes the pictures' host and the change: …", `image-variants: "{c}" isn't a change from→to (up to 60 characters each, no // or @)`. Runtime: "imageVariant takes one of the page's own pictures (<img>)", "that picture isn't from {host}", "the header's change doesn't apply to that picture's address", "that picture has no address".
  - Its pixels read back on a canvas only where the host allows (CORS); so it counts as a read itself, and warns with other reads.
  - Page-wide: refused while another boxed mod has a read this mod doesn't. Panel level 1 (noticeable).
  - Just showing a page picture bigger (same file) needs no power: `style()` or `trif.css`.

### sound

`powers/sound`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: sound
- **Line**: It can play sounds.
- **Explanation**: It can play sounds. It can't listen or record, and its sounds come from the mod itself, not from the web. Beside a power that reads, it could turn what it reads into sounds a device nearby could pick up, so that pair shows a warning.
- **For agents**:
  - `trif.audio()`: `tone`, `play(dataUrl)`, oscillator, gain, filter, delay, panner, compressor, noise, buffer and sound nodes, `render(seconds, build)` offline (up to 10 s); "a mod makes up to 6 sound contexts a minute (close one less often)".
  - Sounds only from `data:audio/…;base64` ("sounds come from data:audio/…;base64 addresses only"); no addresses, microphone, worklets or the page's own media (that's `media`).
  - Lint: "trif.audio: needs the sound power: add `// @powers sound` to the header (the user approves it once)".
  - The browser starts audio only after the user clicks or types on the page; TRIF resumes it then.
  - Not enforced across mods: a sound mod beside another mod's read isn't refused; only the single-mod warning exists.

### controls

`powers/controls`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: controls
- **Line**: It can add its own controls (sliders, pickers).
- **Explanation**: It can add its own controls (sliders, pickers). They belong to the mod, sit outside the site's forms and are never password boxes, so they only take what you set in them on purpose. This doesn't make it wait for your OK on its own.
- **For agents**:
  - `page.create('input' | 'select' | 'option')` and `label`: inputs of type range, color, checkbox, number or text; `.value`/`.checked`, `setValue`/`setChecked` on its own only; `on('input')`.
  - Refused: "a mod's input can be range, color, checkbox, number, text (not {type})", "a control a mod makes can't go inside a form", "a label is for one of the mod's own controls (a trif-box- id)", "setChecked is for the mod's own checkboxes"; never `name` or `autocomplete`.
  - Soft: listed on a hold but never holds alone. It still counts in the row's "N powers" and toward the more-than-three warning.
  - Lint: `create('input')`, `create('select')`, `create('option')` without it: "…needs the controls power…". Your own buttons need no power.

### mods

`powers/mods`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: mods
- **Line**: It can talk to your other boxed mods on this page.
- **Explanation**: It can talk to your other boxed mods on this page. Only boxed mods with this same power hear it, and the messages go through TRIF, not the page, so the site and free mods can't listen in. This doesn't make it wait for your OK on its own.
- **For agents**:
  - `trif.channel(name)` gives `send(data)` and `on((data, {from}) => …)`, delivered a moment later.
  - Refused: "a message is plain data: text, numbers, true/false, null, arrays and plain objects (no functions or elements)", "a message is nested too deep", "a message is up to 256 KB", "on takes a function".
  - Soft (never holds alone), but counts toward the more-than-three warning. The page-wide rules treat a page's boxed mods as one, so a channel can't carry another mod's read into your act.
  - In Safari, where boxed mods run as free mods, channels live on the page's window and the page could reach them.

### preload

`powers/preload`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: preload
- **Line**: It can make this page load its pictures sooner.
- **Explanation**: It can make this page load its pictures sooner. Only the page's own pictures, from where the page gets them, as when you scroll to them. This doesn't make it wait for your OK on its own, but beside a power that reads it shows a warning, since the pictures' host sees which ones load.
- **For agents**:
  - `el.loadSooner()` on the page's own lazy `<img>`. Errors: "loadSooner is for the page's own pictures (<img>)", "loading the page's pictures sooner needs the preload power (// @powers preload)".
  - Soft, but warns with any read ("could pass what it reads to the sites this page's pictures come from…"), and page-wide it's refused while another boxed mod has a read this one doesn't.
  - Loading more in the background is a different thing (tier 2, free mod); this only moves the page's own lazy pictures earlier.

### media

`powers/media`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: media
- **Line**: It can play and pause video and audio on this page.
- **Explanation**: It can play and pause video and audio on this page. It can also mute, change the volume or jump to a time, but never change where a video comes from. A video's host sees how it plays, so beside a power that reads, that could carry a little of what it read, and the pair warns.
- **For agents**:
  - On the page's own `<video>`/`<audio>`: `play()` (a promise of true, or false if the browser wouldn't), `pause()`, `setMuted(bool)`, `setVolume(0..1)`, `seek(seconds)`, `.media` ({paused, muted, volume, currentTime, duration}); `on('play' | 'pause' | 'ended' | 'timeupdate' | …)` to hear them.
  - Errors: "playing the page's video and audio needs the media power (// @powers media)", "hearing the page's video and audio needs the media power (// @powers media)", "that's for the page's <video> and <audio>", "a volume is from 0 to 1", "seek takes a time in seconds".
  - Never their `src`. Page-wide: refused while another boxed mod has a read this one doesn't. Panel level 1 (noticeable).
  - The mod's own sounds are `sound`, not this.

### search-box

`powers/search-box`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: search-box
- **Line**: It adds a search box that searches {host}.
- **Explanation**: It adds a search box that searches {host}. TRIF draws the box: the mod can't fill it in or read it, and it searches only when you press Enter, with what you typed. It can only search the mod's own site.
- **For agents**:
  - `trif.searchBox({placeholder, autofocus, spaces: '+', emptyOk, button, here, link})`; header `// @powers search-box https://www.example.com/search?q={query}` on the mod's own site; `{link}` (one at most) is the path of a link the page shows (hold: "…(in the place a link on the page names)").
  - Header errors: "search-box takes the site's search address, with {query} where the words go: …", `search-box: "{v}" isn't an address`, `…needs to be an http(s) address with {query} in it`, `search-box: {host} isn't this mod's site: a search box searches the site it's on`, "search-box: one {link} at most". Runtime: "the search-box power needs its address in the header: @powers search-box https://…{query}", "this search box's address has {link}: give it a link the page shows, { link: page.find(…) }".
  - Use it instead of typing into the site's own search field (which needs write-drafts and, to search, click).
  - No added risk with any other power: the mod can't see what's typed in it.

### go-to

`powers/go-to`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: go-to
- **Line**: It can take you to these pages on {site}: {paths}, or to a link the page shows.
- **Explanation**: It can take you to these pages on {site}: {paths}, or to a link the page shows. It can't make up addresses: only the exact pages its header lists, or links already on this page, on this site. Beside a power that clicks, it could take you somewhere and click there, so that pair warns.
- **For agents**:
  - `trif.goTo(where)`: a header path exactly (`// @powers go-to /home /i/bookmarks`), or an address a link on the page shows, same site; `{inApp: true}` moves through the page's router. `reload` in the header gives `trif.reload()` ("a boxed mod reloads a page at most once in 10 seconds"); a query from a list: `/?mods=[red|blue]`.
  - Header errors: `go-to: "{p}" isn't a page of this site: a path starting with /, with no query, # or *; or reload; or /path?name=[one|two]`, `go-to: "{v}" in {p} isn't a plain word (letters, digits, - and _): a value can't be an address`. Runtime: `"{where}" isn't one of the header's pages ({paths}, or none), or a link to this site that the page shows`, "reloading needs `reload` in the header: @powers go-to reload".
  - Page-wide: refused while another boxed mod has click or page-events and this one doesn't.
  - Narrower: a link of your own (`page.create('a')` with an `href` a page link already has) needs no power and lets the user choose. Lint: "trif.goTo: needs the go-to power…".

### embeds

`powers/embeds`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: embeds
- **Line**: It can play videos this page links to, inside the page (from {players}).
- **Explanation**: It can play videos this page links to, inside the page (from {players}). It only plays one after you click TRIF's play button, from the player its header names, and passes on only the video's id. The video's site sees you watching, as it would if you opened the link.
- **For agents**:
  - `trif.embed(link, {label})` gives TRIF's button (default "Play the video here"); the user's own click plays it. Header: `// @powers embeds www.youtube.com/embed` (also `www.youtube-nocookie.com/embed`, `player.vimeo.com/video`).
  - Errors: `embeds: "{a}" isn't a player TRIF makes embeds for (…)`, "the embeds power needs where its videos come from: @powers embeds www.youtube.com/embed"; runtime "embed takes a link the page shows", "that link isn't a video from {players}", "that link has no address".
  - Recognises YouTube watch/shorts/embed/live and youtu.be links, and numeric Vimeo ones.
  - No added risk with any other power (combination table); a mod that wants a player from anywhere else is a free mod, and say what loads from where.

### rewrite-requests

`powers/rewrite-requests`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: rewrite-requests
- **Line**: It changes what {site} receives from this page: {name} set to {value} (in {operation} requests).
- **Explanation**: It changes what {site} receives from this page: {name} set to {value} (in {operation} requests). Only the settings and values its header names, made by TRIF in the site's own requests; the mod's code has no part in it. If the site doesn't expect the change, rate limits or an account flag are possible.
- **For agents**:
  - Header only, no API: `// @powers rewrite-requests HomeTimeline variables.enableRanking=false`: the request's name (the address's last part or its `operationName`), then `path=value` (dotted names); values `true`, `false`, `null`, numbers or plain words; applied by TRIF's page side to same-origin requests (a query parameter, its JSON, or a JSON body).
  - Header errors: "rewrite-requests takes the request's name and what to set in it: …", `rewrite-requests: "{x}" isn't name.path=value`, `rewrite-requests: "{v}" isn't true, false, null, a number or a plain word (an address or long text could carry data)`.
  - No added risk with any other power: nothing the mod reads rides on it. It's the only power at panel level 2 ("changes requests").
  - Prefer filtering what comes back (site-data) when that does the job: it doesn't change what the site receives.

### block-events

`powers/block-events`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: block-events
- **Line**: It can keep this site from seeing some of what you do here ({what}), so the site doesn't react to it.
- **Explanation**: It can keep this site from seeing some of what you do here ({what}), so the site doesn't react to it. It can't keep back your typing in fields, sending a form, or leaving the page, and it blocks clicks only on the things its header names. If a button seems not to respond, this mod may be keeping your click from the site.
- **For agents**:
  - `trif.block(type, fn?)`: the site doesn't see the event (when `fn(e)` returns true, or always without `fn`); it reaches only `fn`. Header: `// @powers block-events mouseover keydown click(button.cancel)`.
  - Blockable: mouse, pointer, key, wheel, scroll, touch and drag events; click-like ones only with a selector. Never submit, focus, input or leaving; keys typed in fields or editors, and anything on TRIF's search box, always pass.
  - Header errors: `block-events: "{a}" isn't an event it may keep from the site (…)`, `block-events: {type} only on what it names: {type}(button.cancel)`, `block-events: "{sel}" can't name the value attribute or :autofill`. Runtime: `"{type}" isn't one of the events the header says it keeps from the site (…)`, "block takes a function, or nothing".
  - Narrower: stopping events on the mod's own elements needs no power (`e.stopPropagation()`); on the page's: "stopping an event is for events on the mod's own elements (the page's own need the block-events power)".
  - With click it warns ("could keep your clicks from reaching the page and click in their place"); page-wide, another mod's click is refused beside it. Panel level 1.

### page-events

`powers/page-events`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: page-events
- **Line**: It can send this page's own code these signals: {names}.
- **Explanation**: It can send this page's own code these signals: {names}. Only those names, with plain data and no new web addresses. What the page's code does with a signal is up to the site, and could include posting or sending, so beside a power that reads or writes a post, it warns.
- **For agents**:
  - `trif.signal(name, detail)` on the document. Header: `// @powers page-events my-app-reset`: names with a `-` or `:`, never a browser event's, `trif:`, or a framework's (htmx:, hx-, turbo:, alpine:, livewire:, stimulus:, phx:, react:, vue:, svelte:, ng:, ember:).
  - Header errors: `page-events: "{n}" is named like a framework's own event (htmx:, turbo:, alpine:, …), which the page's code acts on`, `page-events: "{n}" isn't a page's own event's name (…)`, "trif: events are TRIF's own". Runtime: `"{n}" isn't one of the header's signals (…)`, "a signal's detail is plain data (JSON)", "a signal's detail is plain data, up to 64 KB", and the no-new-address check on the detail.
  - Listening to the page's own events needs no power: `// @events name` and `page.on(name, fn)`.
  - It counts as something that sends: with write-drafts or edit-uploads it warns "could write a post and send it for you"; page-wide it's refused beside another mod's read, and after another mod changed a draft or an attached picture. Panel level 1.

### click

`powers/click`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: click
- **Line**: It can click these for you: {words} ({selector}).
- **Explanation**: It can click these for you: {words} ({selector}). It can't click anything else, a button that sends a form, or a link to another site. A plain button the site turns into a post could still post, so look at what each listed thing does.
- **For agents**:
  - `el.click()` only on elements matching an `// @click words: selector` line; the words are what the hold shows.
  - Header errors: `@click "{line}": say what it is, then a colon and its selector: // @click the play button: button.play`, `@click "{line}": that selector isn't one TRIF takes (no \ escapes, value attribute, :autofill, braces or semicolons)`, "@click lines are for a mod with the click power (@powers click)", "the click power needs what it may click: // @click the play button: button.play".
  - Runtime: "clicking for the user needs the click power, with what it may click named in the header (// @click words: selector)", "that isn't one of the things the header says this mod may click", "a click that would submit or reset a form isn't offered, whatever the header says", "a click on a link to another site isn't offered". Lint: ".click(): needs the click power…".
  - Page-wide: refused beside another mod's read or block-events, and after another mod changed a draft or picture unless this one has write-drafts / edit-uploads.
  - Never use it to post, like, follow or buy (AGENTS.md safety rules). Narrower: a link or button the user clicks themselves. Panel level 1.

### write-drafts

`powers/write-drafts`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: write-drafts
- **Line**: It can change what you type and paste on this site before you post it.
- **Explanation**: It can change what you type and paste on this site before you post it. It can't post it for you, touch password or card fields, or add a web address that isn't already in your text or on the page. Read what you're about to send before you send it.
- **For agents**:
  - `setValue(text)` on the page's text fields and textareas (TRIF sends an `input` event so React and the like see it); `setText`, adding and removing inside editors. To change what was typed, the mod needs read-drafts too.
  - Errors: "changing what the user typed needs the write-drafts power (// @powers write-drafts)", "password and card fields stay the user's, whatever the mod's powers", "a {type} input isn't a text the user types", "a select isn't a text the user types".
  - No made-up addresses: `"{text}" looks like an address that isn't in what the user typed here or in a link on the page: a boxed mod doesn't add addresses to a draft…` (counts `scheme://`, `www.`, dotted names like `node.js`, IPv4; checked on the whole text after the write).
  - Page-wide: "changing what the user types is off on this page while another boxed mod here has the {read} power…".
  - With a read: "could put what it reads into something you post"; with click or page-events: "could write a post and send it for you". Attached pictures are edit-uploads. Panel level 1.

### edit-uploads

`powers/edit-uploads`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: edit-uploads
- **Line**: It can change pictures you attach on this site before you post them.
- **Explanation**: It can change pictures you attach on this site before you post them. It only sees and changes the picture, not your text or other files. Together with a power that reads, it could hide what it reads inside a picture you post, so that pair shows a warning.
- **For agents**:
  - `trif.onUpload((canvas, {width, height, type}) => canvas)`: each PNG, JPEG or WebP the user attaches (file input, paste, drop) as a canvas of the mod's own; return it or another of its canvases, and TRIF makes the file (same name and type) where the original was.
  - The mod never gets the file, its path or its metadata; other files, and pictures over 30 MB or 8192×8192 px, pass untouched.
  - Errors: "onUpload takes a function", "onUpload returns a canvas of the mod's own (or nothing: the one it was given)"; page-wide: "changing the pictures the user attaches is off on this page while another boxed mod here has the {read} power…".
  - With a read: "could put what it reads into a picture you post"; with click or page-events: "could write a post and send it for you". Panel level 1.

### @migrate

`powers/migrate`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: @migrate
- **Line**: It brings over its old settings from what this site keeps under: {keys} (once).
- **Explanation**: It brings over its old settings from what this site keeps under: {keys} (once). It copies them into its own settings on this site a single time and doesn't read them again. Only the names listed, never one that looks like a login.
- **For agents**:
  - Not a power: a header line that's a need of its own on the hold. `// @migrate localStorage old-key other-key` (or sessionStorage); at the mod's first `trif.settings`, each key's value becomes `trif.settings('old-key', …)`, once per site.
  - Errors: `@migrate "{v}": say where and which keys: // @migrate localStorage my-key other-key`, `@migrate "{k}": a key by its whole name`, plus site-storage's login-name rule.
  - Use when converting a free mod to a boxed one so the user's settings carry over; prefer it to asking for site-storage.

## Row chips

### {N} power(s)

`chips/n-powers`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: {N} power(s)
- **Line** (drafted): This boxed mod asks for powers beyond the box.
- **Explanation**: This boxed mod asks for powers beyond the box: hover to see what each one lets it do. TRIF holds it to those and nothing more. The chip is green, or amber when some of its powers together carry a warning; click it to see the code.
- **For agents**:
  - Shown only for boxed mods with `@powers`; it counts every power, soft ones (controls, mods, preload) too. Green; amber when the mod has combination warnings (or the many-powers sentence) or is at level 2.
  - Its hover: one line per power ("{power} {what it can do}", the hold's words), then the warnings, then the level words.
  - Ask for the fewest powers that do the job: more than three gets the many-powers warning.

### noticeable

`chips/noticeable`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: noticeable
- **Line**: Noticeable: {site} could tell something's different.
- **Explanation**: Noticeable: {site} could tell something's different. Usually that's harmless, but a site that notices may treat you like someone using an ad blocker or an extension. On an account you care about, it's worth knowing.
- **For agents**:
  - Level 1 (extension/modlevel.js). A boxed mod's comes from its powers: block-events, site-data, click, write-drafts, media, page-events, site-storage, edit-uploads, image-variants, local-fonts. A free or style mod's from `@risk 1`, or raised to 1 when TRIF's reading finds it sends or acts.
  - For free and style mods, `// @risk 1 <why>`: the why is shown after the level words. A boxed mod's @risk isn't used for its level.
  - Mention it to the user once, briefly, when a mod crosses into it (AGENTS.md "Account safety").
  - With site-data the words add "(what it sends isn't all shown)".

### changes requests

`chips/changes-requests`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: changes requests
- **Line**: Changes requests: this mod changes what {site} receives, which it could notice (rate limits or an account flag are possible).
- **Explanation**: Changes requests: this mod changes what {site} receives, which it could notice (rate limits or an account flag are possible). For a boxed mod, that's only the changes its header names, made by TRIF. Sites watch what they receive more closely than how a page looks, so this is the level to think about on an account you care about.
- **For agents**:
  - Level 2: a boxed mod with rewrite-requests, or a free or style mod with `@risk 2`. TRIF's reading never sets 2 by itself (what it finds counts as 1).
  - Warn the user clearly before writing it (AGENTS.md "Account safety"): loading more in the background, internal APIs, parameters the UI never uses, a pace no person would.
  - Amber chip.

## Row tags

### on hold

`tags/on-hold`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: on hold
- **Line**: Waiting for your OK: open it
- **Explanation**: Waiting for your OK: open it. It isn't running, because TRIF found it can do something you haven't allowed yet, such as send, click or go to pages for you, or it asks for powers. Open it to see the list, then Allow it or leave it waiting.
- **For agents**:
  - Held: a free mod whose code TRIF reads as able to act (helper/lib/held.js), a boxed mod with powers (once per set), a boxed mod in a browser without the sandbox, a mod matching outside the run's site.
  - Never approve it yourself (`trif approve`, Allow, held.json / allowed.json are the user's). Tell the user in plain words what it can do and that it's waiting.
  - `trif status` / `trif mods` show HELD and what TRIF found; `trif check` shows it before anything waits, with ways round.
  - A held mod isn't also switched off as new: allowing it counts as looking at it.

### change on hold

`tags/change-on-hold`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: change on hold
- **Line**: Waiting for your OK: open it
- **Explanation**: Waiting for your OK: open it. A new version of this mod can do something the one before couldn't, so TRIF holds the change. The version before keeps running until you decide.
- **For agents**:
  - An edit that adds a power (a free mod: or adds or changes a line using one; a boxed mod: a new power) waits; the earlier version keeps running.
  - The approval card offers Show what changed and Don't allow. Tell the user the change is waiting and why.

### error · {N} errors

`tags/error`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: error · {N} errors
- **Line**: New error at line {n}: {message}
- **Explanation**: New error at line {n}: {message}. The mod hit a problem on this page, often because the site changed. Click to see that line in its code; your agent can try to fix it.
- **For agents**:
  - An error's fingerprint is the mod, the line and the message without numbers or quoted parts, per version: a fixed or changed mod starts fresh. With several, the tag counts them and the title shows the first.
  - `trif errors --tab <id>`; `trif status` shows NEW ERROR at line {n}: {message}.
  - Fix it automatically runs only on sites at Run code or Ask. Keep the mod doing what it did; Undo fix is offered for 7 days.
  - Catch expected failures and `trif.warn` once rather than throwing in a loop.

### may be broken

`tags/may-be-broken`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: may be broken
- **Line**: May be broken: nothing it looks for is on the page any more.
- **Explanation**: May be broken: nothing it looks for is on the page any more. It found what it works on here before, but not on the last 3 loads of this page, so the site has probably changed. It still runs; your agent can look at the page and update it.
- **For agents**:
  - Watched: a style mod's selectors, a boxed mod's `trif.observe` and `trif.hide`, a free mod's `trif.expect(selector)`; none on the page (its address without the query) on 3 loads in a row where they were before, counted at the 9-second look.
  - In a free mod, call `window.trif?.expect(selector)` so TRIF can tell.
  - Repair: look at the page as it is now (trif text, screenshot, sweep) and make it do the same thing as before.

### new

`tags/new`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: new
- **Line**: TRIF switched it off because it came from outside your chat: switch it on once you've looked at it.
- **Explanation**: TRIF switched it off because it came from outside your chat: switch it on once you've looked at it. That means a terminal, a file, another browser, or Tim's mods you added. Nothing of it runs until you do, and </> shows its code.
- **For agents**:
  - `off (new)` in `trif status`. Only the user switches it on (side panel, or `trif enable <id>` in their terminal); a side-panel run's enable is refused: "{id} is switched off until the user looks at it; only the user can switch it on, in the side panel or with trif enable in their terminal".
  - Tell the user it's off until they've looked at it; don't switch it on for them.

### new

`tags/new-chat-wait`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: new
- **Line**: Your chat made it, and waits for you (Settings): switch it on once you've looked at it.
- **Explanation**: Your chat made it, and waits for you (Settings): switch it on once you've looked at it. It's saved but not running, because "Mods your chat makes" is set to Wait for me. Switch it on when you're ready, or set that back to Start on.
- **For agents**:
  - Only with Settings' "Mods your chat makes" at Wait for me (`trif status`: CHAT MODS). Say that what you made waits for them; you can't switch it on from a side-panel run.

### updated

`tags/updated`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: updated
- **Line**: TRIF updated it and switched it off: switch it on once you've looked at it.
- **Explanation**: TRIF updated it and switched it off: switch it on once you've looked at it. A new version of one of Tim's mods replaced your copy, which you hadn't changed. Nothing of it runs until you switch it back on.
- **For agents**:
  - A copy exactly as shipped is replaced by each new version; this browser then switches it off (`off (updated by TRIF…)` in `trif status`). Only the user switches it on.
  - Keep `@source` and `@version` when editing one of Tim's mods; once changed, it's never replaced (update available instead).

### update available

`tags/update-available`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: update available
- **Line**: Version {n}: see what you can do
- **Explanation**: Version {n}: see what you can do. TRIF has a new version of this mod but didn't put it in place, usually because you've changed your copy. You can use the new one (yours goes to the trash), keep yours, or have your agent merge the two.
- **For agents**:
  - `trif mods` shows "update available (you've changed it)". Merging: first tell the user what TRIF changed, what they changed and how you'd merge, then stop and ask. Edit only `sites/<site>/<mod>.js` (`.shipped/…js` is the old shipped version, `.new.js` the new), set `@version`, check it parses.
  - From a terminal, after merging: `trif mod-update <site>/<mod> --merged`. `--use-new` / `--keep` are the user's call: ask first.

### changed

`tags/changed`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: changed
- **Line**: Your chat changed it, and waits for you (Settings): the version before runs until you turn this one on.
- **Explanation**: Your chat changed it, and waits for you (Settings): the version before runs until you turn this one on. That's because "Mods your chat makes" is set to Wait for me. Look at the change first, then use Turn on in the chat.
- **For agents**:
  - `trif status`: "off (changed by the chat: the version before runs until the user turns this one on)". Say that your change waits; a side-panel run can't turn it on.

## Combination warnings

### Posts what it reads

`warnings/read-post-for-you`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Posts what it reads
- **Line**: Together, it could put what it reads into a post and send it for you.
- **Explanation**: Together, it could put what it reads into a post and send it for you. It still only clicks, or signals, what its header names on this site. But what it read could go out from your account without you pressing send, so allow this only for a mod you'd trust to post for you.
- **For agents**:
  - A read + (click or page-events) + (write-drafts or edit-uploads): 28 triples. The hold also shows the pairs' warnings.
  - Almost never needed: split the job so the user does the send, or drop the read.

### Goes and posts

`warnings/go-post-for-you`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Goes and posts
- **Line**: Together, it could go to a page, write a post there and send it for you.
- **Explanation**: Together, it could go to a page, write a post there and send it for you. It only goes to pages its header lists or links already on the page, and only clicks or signals what its header names. Still, a post could go out from your account without you, so check the pages and buttons the hold lists.
- **For agents**:
  - go-to + (click or page-events) + write-drafts.
  - Page-wide: go-to is refused while another boxed mod has click or page-events and this one doesn't.

### Posts for you

`warnings/post-for-you`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Posts for you
- **Line**: Together, it could write a post and send it for you.
- **Explanation**: Together, it could write a post and send it for you. It still only clicks, or signals, what its header names on this site. A post or picture it changed would no longer wait for you to send it, so a mistake in the mod could post from your account.
- **For agents**:
  - click + write-drafts, click + edit-uploads, page-events + write-drafts, page-events + edit-uploads.
  - Page-wide: after another boxed mod changed a draft (or attached picture), click and page-events are refused unless the acting mod has write-drafts (or edit-uploads) too: "clicking for the user is off on this page since another boxed mod here changed a draft…".

### Reads into posts

`warnings/read-into-post`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads into posts
- **Line**: Together, it could put what it reads into something you post.
- **Explanation**: Together, it could put what it reads into something you post. It can't send the post for you, and it can't add a web address that wasn't already in your text or on the page. Read your post before you send it, since something it read elsewhere could be slipped in.
- **For agents**:
  - A read (read-drafts, keys, site-data, page-data, site-storage, local-fonts, image-variants) + write-drafts.
  - Page-wide: writing a draft is refused while another boxed mod has a read this one doesn't.
  - A mod that changes the user's own text in place (a styler) needs read-drafts + write-drafts, and so this warning: say so to the user.

### Reads into pictures

`warnings/read-into-picture`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads into pictures
- **Line**: Together, it could put what it reads into a picture you post.
- **Explanation**: Together, it could put what it reads into a picture you post. It can't send the picture for you, and it only changes the picture's pixels. What it read could be hidden in the picture where you can't see it, so allow this only if the mod needs both.
- **For agents**:
  - A read + edit-uploads.
  - Page-wide: changing attached pictures is refused while another boxed mod has a read this one doesn't.

### Reads to page code

`warnings/read-into-page-code`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads to page code
- **Line**: Together, it could hand what it reads to this page's own code, which may post or send it.
- **Explanation**: Together, it could hand what it reads to this page's own code, which may post or send it. It can only send the signals its header names, with plain data and no new web addresses. What the page's code does with them is up to the site, and TRIF can't see that.
- **For agents**:
  - A read + page-events.
  - Page-wide: signalling is refused while another boxed mod has a read this one doesn't.

### Goes and clicks

`warnings/go-and-click`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Goes and clicks
- **Line**: Together, it could take you to a page and click things there for you.
- **Explanation**: Together, it could take you to a page and click things there for you. It only goes to pages its header lists or links on the page, and only clicks what its header names, never a form's send button or a link to another site.
- **For agents**:
  - go-to + click.
  - Page-wide: go-to is refused while another boxed mod has click and this one doesn't.

### Goes and signals

`warnings/go-and-signal`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Goes and signals
- **Line**: Together, it could take you to a page and set off that page's own actions there.
- **Explanation**: Together, it could take you to a page and set off that page's own actions there. It only goes to pages its header lists or links on the page, and only sends the signals its header names. A signal can do something different on another page, and what it does is up to the site.
- **For agents**:
  - go-to + page-events.
  - Page-wide: go-to is refused while another boxed mod has page-events and this one doesn't.

### Reads, then clicks

`warnings/read-decides-click`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads, then clicks
- **Line**: Together, it could let what it reads decide what it clicks for you.
- **Explanation**: Together, it could let what it reads decide what it clicks for you. It still only clicks the things its header names. But the site sees what you click, and others may too (a like or a follow is often public), so what it read could show in those clicks.
- **For agents**:
  - A read + click.
  - Page-wide: click is refused while another boxed mod has a read this one doesn't.

### Blocks and clicks

`warnings/block-and-click`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Blocks and clicks
- **Line**: Together, it could keep your clicks from reaching the page and click in their place.
- **Explanation**: Together, it could keep your clicks from reaching the page and click in their place. It can only keep back the clicks its header names, and only click what its header names. Watch for a button that seems not to do what you clicked it for.
- **For agents**:
  - block-events + click.
  - Page-wide: click is refused while another boxed mod has block-events and this one doesn't.

### Reads through video

`warnings/read-through-media`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads through video
- **Line**: Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.
- **Explanation**: Together, it could pass what it reads to the site a video or sound comes from, by how it plays it. It can't change where a video comes from, only play, pause, mute, set the volume or jump to a time. The video's host sees the requests those make, so their timing could carry a little of what it read.
- **For agents**:
  - A read + media.
  - Page-wide: media controls are refused while another boxed mod has a read this one doesn't.

### Reads through pictures

`warnings/read-through-pictures`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads through pictures
- **Line**: Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.
- **Explanation**: Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads. It only loads the page's own pictures, or other sizes of them by its header's change, from where the page gets them. But their host sees which load and when, so a little of what it read could show there.
- **For agents**:
  - A read + image-variants, or a read + preload (image-variants + preload alone adds nothing).
  - Page-wide: image-variants and preload are refused while another boxed mod has a read this one doesn't.

### Reads into sound

`warnings/read-into-sound`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads into sound
- **Line**: Together, it could turn what it reads into sounds that a device nearby could pick up.
- **Explanation**: Together, it could turn what it reads into sounds that a device nearby could pick up. It can't listen or record, and plays only sounds it makes itself. A phone or speaker in the room would have to be listening, so it's a narrow way out, but it exists.
- **For agents**:
  - A read + sound.
  - Not enforced across mods: a sound mod beside another mod's read isn't refused (enforcing it would stop every sound mod beside any hotkey mod; Tim's call).

### Many powers

`warnings/many-powers`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Many powers
- **Line**: Mods with many powers can act in unspecific or powerful ways. Treat this with caution.
- **Explanation**: Mods with many powers can act in unspecific or powerful ways. Treat this with caution. It shows in place of the separate warnings when a boxed mod asks for more than three powers. Each power keeps its own limits, but together they're harder to think through, so allow it only if you know why it needs each one.
- **For agents**:
  - More than 3 powers, soft ones (controls, mods, preload) included. Keyed by the exact set (`power:together:many:<powers>`); its combinations are still needs, so a later version with fewer powers doesn't ask again for what was allowed.
  - Split into smaller mods or drop powers to get under four; each mod then shows its own specific warnings.

### Reads into storage

`warnings/read-into-storage`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads into storage
- **Line**: Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.
- **Explanation**: Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later. It can only write under the names its header lists, never one that looks like a login, and with no new web addresses. But the site's own code reads what's kept there and may send it on, so allow this only if the mod needs both.
- **For agents**:
  - site-storage (or @migrate, which counts as site-storage) + a read.
  - Page-wide: site-storage writes are refused while another boxed mod has a read this one doesn't.

### Clicks with changes

`warnings/click-and-rewrite`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Clicks with changes
- **Line**: Together, it could click things for you and change what the site receives from those clicks.
- **Explanation**: Together, it could click things for you and change what the site receives from those clicks. It only clicks what its header names, and only changes the settings its header names. But those clicks act as you, carrying changes you didn't choose, without you pressing anything.
- **For agents**:
  - rewrite-requests + click.
  - Page-wide: click is refused while another boxed mod has rewrite-requests and this one doesn't.

### Signals with changes

`warnings/signal-and-rewrite`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Signals with changes
- **Line**: Together, it could set off this page's own actions and change what the site receives from them.
- **Explanation**: Together, it could set off this page's own actions and change what the site receives from them. It only sends the signals and changes the settings its header names. What the page's code does with a signal is up to the site, and the requests it sends then carry the mod's changes.
- **For agents**:
  - rewrite-requests + page-events.
  - Page-wide: page-events signals are refused while another boxed mod has rewrite-requests and this one doesn't.

### Blocks and signals

`warnings/block-and-signal`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Blocks and signals
- **Line**: Together, it could keep your clicks from reaching the page and set off the page's own actions in their place.
- **Explanation**: Together, it could keep your clicks from reaching the page and set off the page's own actions in their place. It can only keep back what its header names, and only send the signals its header names. Watch for a button that seems not to do what you clicked it for.
- **For agents**:
  - block-events + page-events.
  - Page-wide: page-events signals are refused while another boxed mod has block-events and this one doesn't.

### Blocks and goes

`warnings/block-and-go`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Blocks and goes
- **Line**: Together, it could keep your clicks from reaching the page and take you to another page in their place.
- **Explanation**: Together, it could keep your clicks from reaching the page and take you to another page in their place. It can only keep back what its header names, and only go to pages its header lists or links on this page. If a click takes you somewhere you didn't expect, this mod may be why.
- **For agents**:
  - block-events + go-to.
  - Page-wide: go-to is refused while another boxed mod has block-events and this one doesn't.

### Reads, then blocks

`warnings/read-decides-blocks`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads, then blocks
- **Line**: Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.
- **Explanation**: Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on. Sites often record what you do on a page, so the pattern of what it keeps back could carry a little of what it read. It's a narrow way out, but it exists.
- **For agents**:
  - block-events (the function form) + a read.
  - Page-wide: a block's function is refused while another boxed mod has a read this one doesn't; the list form isn't affected.

### Reads through videos

`warnings/read-through-videos`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Reads through videos
- **Line**: Together, it could pass what it reads to the site a video comes from, by which video it offers you.
- **Explanation**: Together, it could pass what it reads to the site a video comes from, by which video it offers you. It only offers videos the page links to, and only plays one after you click TRIF's play button. The video's site learns which one you played, so the mod's choice could carry a little of what it read.
- **For agents**:
  - embeds + a read.
  - Page-wide: embed() and its play are refused while another boxed mod has a read this one doesn't.

## Agent on this site

### Off

`agent-levels/off`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Off
- **Line**: it can’t see or touch this site.
- **Explanation**: It can’t see or touch this site: your agent can't read its pages, take screenshots or run code in them. It can still write mods for this site, which go through the same checks as anywhere. Email, banking, payments, password managers and message and AI chat sites start here until you choose otherwise.
- **For agents**:
  - Stored as `off`; Settings calls it Off, the chat line "Agent can’t see this site". Refused: run, text, sweep, screenshot, requests, request, errors, logs, record, reload, navigate, open, close, status --tab (agentsites.js COMMAND_NEEDS); `trif tabs` lists its tabs as `https://<site>/` with no title.
  - Error: "\"Agent on this site\" is Off for {site} (it's {what}, so it's off unless the user raises it): you can't read, screenshot or run code on its tabs. You can still write mods for it…".
  - Precedence: the user's choice for the exact site; then the sensitive list (off); then their choice for a parent domain; then Ask.
  - Don't retry or look for a way round: write the mod and tell the user you couldn't test it. Fix it automatically never starts on Off or Look sites.

### Look

`agent-levels/look`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Look
- **Line**: it can read the page and take screenshots.
- **Explanation**: It can read the page and take screenshots. It can't run its own code in the page, though it can reload the page to see a mod working. Pick this when you want help with mods here but no live changes.
- **For agents**:
  - Allowed: text, sweep, screenshot, requests, request, errors, logs, record, reload, navigate, open, close, status --tab. Refused: `trif run`: "the user has set \"Agent on this site\" to Look for {site}: you can read the page and take screenshots there, but not run code (trif run)…".
  - "Not here" in the Ask dialog sets Look.
  - Test by reloading and reading or screenshotting instead of `trif run`.

### Ask first

`agent-levels/ask`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Ask first
- **Line**: it can look, and asks you before running code here.
- **Explanation**: It can look, and asks you before running code here. The first time it wants to, the panel asks: Just this once, Always on this site (Run code) or Not here (Look). If you don't answer within 25 seconds, or the panel isn't open, the code doesn't run.
- **For agents**:
  - The default for any site not on the sensitive list. Reading works; the first `trif run` opens the question and waits up to 25 s.
  - Just this once covers that side-panel run (every `trif run` in it); from a terminal, that one command. × or Esc: the command fails, saying the user didn't answer.
  - No side panel open: fails at once: "running code on {site} needs the user's OK first (\"Agent on this site\" is Ask there), and TRIF's side panel isn't open to ask them…".

### Run code

`agent-levels/run`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Run code
- **Line**: it can change the page live; posting is paused until the page reloads.
- **Explanation**: It can change the page live; posting is paused until the page reloads. When your agent in this panel runs code in a tab, TRIF stops all of that site's tabs from posting, sending or saving as you. Code run from a terminal isn't paused that way.
- **For agents**:
  - "Always on this site" sets it. A side-panel run's `trif run` locks the tab first (tablock.js): declarativeNetRequest rules block state-changing requests, WebSockets and loads from new sites on the site's tabs until a new document; storage writes from the run's code are refused ("TRIF: your agent's code can't save data on this site").
  - If the lock can't be set: "TRIF couldn't lock tab {id} against sending requests (…), so it won't run agent code there".
  - A terminal `trif run` (no run scope) isn't locked (background.js run: `if (args.scope)`). Never use it to post, like, follow, buy or change settings.

## Robot faces

### Paused

`faces/paused`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Paused
- **Line**: Posting is paused: your agent ran code here.
- **Explanation**: Posting is paused: your agent ran code here. Until this page reloads, TRIF blocks anything in it from posting, sending or saving as you, or opening other sites, and that includes your own posts. Reading, scrolling, clicks and mods work as usual; reload when you want to post again.
- **For agents**:
  - Face: white frame, two white bars for eyes (dark grey on a light theme or toolbar); wins over every other face.
  - The lock lasts until the tab shows a new document (a reload or a real navigation, not a URL change); a page restored from the back/forward cache is locked again and reloaded; tabs a locked tab opens are locked too.
  - Only side-panel runs lock. Tell the user to reload before posting.

### Paused

`faces/paused-other-tab`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Paused
- **Line**: Posting is paused on this site: your agent ran code in another tab.
- **Explanation**: Posting is paused on this site: your agent ran code in another tab. Until that tab reloads, TRIF keeps all of this site's pages from posting, sending or saving as you. Show that tab takes you there.
- **For agents**:
  - The site's other tabs, and its tabs opened during the lock, unlock when the last tab the agent ran code in shows a new page.

### Blocked

`faces/blocked`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Blocked
- **Line**: The robot is blocked on {site}
- **Explanation**: The robot is blocked on {site}. Nothing from TRIF runs on this site or reads it: no mods, and your agent can't touch its tabs. Only you can undo it, with Unblock.
- **For agents**:
  - Face: red frame, a red cross for eyes. Set by the gate's "Block on {site}" link.
  - Agents get: "{site} is blocked in TRIF: nothing from TRIF runs there or reads it, and only the user can unblock it (in the side panel)". Don't look for a way round; tell the user.

### Disconnected

`faces/disconnected`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Disconnected
- **Line**: TRIF is disconnected on {site}
- **Explanation**: TRIF is disconnected on {site}. Your browser hasn't given TRIF permission for this site, so no mods run here and your agent can't reach it. Connect asks your browser for this site only, then turns TRIF on here.
- **For agents**:
  - Face: grey frame, a grey broken link for eyes. Agents get: "TRIF is disconnected on {site}: nothing from TRIF runs there or reads it until the user connects it (the side panel on that site has the button)".

### Off

`faces/off`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Off
- **Line**: The robot is off.
- **Explanation**: The robot is off. TRIF is off on this site: no mods run here, all-sites ones included, and your agent can't read or touch its tabs. TRIF keeps your browser's permission, so turning it back on doesn't ask again.
- **For agents**:
  - Face: a blank frame. Agents get: "TRIF is off on {site}: nothing from TRIF runs there or reads it until the user turns it on (the side panel on that site has the switch)". You can't turn a site on.
  - You can still write a mod for it; it runs once the user turns the site on. Say so.

### Logged out

`faces/logged-out`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label** (drafted): Logged out
- **Line**: {agent} isn’t logged in.
- **Explanation**: {agent} isn't logged in. The robot shows hollow yellow eyes on every tab until it is, since the chat can't run without it. Your mods keep running as usual; log in from the panel, or add the API key in Settings.
- **For agents**:
  - Face: yellow frame, hollow yellow eyes, on every tab; loses to paused, blocked, disconnected and off. Also shown for a missing API key ("No {X} API key yet: add it in Settings.").

## Mods your chat makes

### Mods your chat makes

`chat-mods/chat-mods-setting`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Mods your chat makes
- **Line** (drafted): Whether what your chat makes runs at once.
- **Explanation**: Whether what your chat makes runs at once. Start on (the default) runs it so you see it working; Wait for me saves it and waits for you to turn it on. It's only for this panel's chat: mods from a terminal, a file or TRIF's updates always start off.
- **For agents**:
  - `trif status` shows `CHAT MODS  wait for the user…` when it's Wait for me. Held mods wait for their OK either way.

### Start on

`chat-mods/start-on`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Start on
- **Line**: Start on: what the chat makes or changes runs at once, so you see it working.
- **Explanation**: Start on: what the chat makes or changes runs at once, so you see it working. A mod that needs your OK still waits for it, and mods from anywhere else start off. Pick Wait for me if you'd rather look at each one first.
- **For agents**:
  - Counts as the chat's only while its run is going (origin.live); a file that appears after the run ends starts off.
  - Check that what you made works (reload, screenshot) and tell the user it's on.

### Wait for me

`chat-mods/wait-for-me`, approved 2026-11-11 (Claude, delegated by Tim)

- **Label**: Wait for me
- **Line**: Wait for me: it's saved, but runs only when you turn it on (a change waits too, and the version before keeps running).
- **Explanation**: Wait for me: it's saved, but runs only when you turn it on (a change waits too, and the version before keeps running). Its row says new or changed, and the chat offers Show code and Turn on. Your agent in this panel can't turn it on for you.
- **For agents**:
  - Your enable from a side-panel run is refused while it waits (background.js:1157). Say "{file} waits for you" and what it does; you can't test it running until they turn it on.
