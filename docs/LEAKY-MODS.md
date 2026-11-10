# Design sketch: leaky mods (a sandboxed mod with named exceptions)

*Draft for Tim to edit. Nothing here is built. The hold sentences are proposed UI text.*

## The idea

A sandboxed mod can't send, load, click or type anything, and can't see your drafts (see SAFE-MODS.md).
Some useful mods need one exception: a word counter has to see what you type, and a sound mod has to make
a noise. Today those mods have to be page scripts, with every power the page has, and the hold can only
guess at what the code might do.

A **leaky** mod stays in the sandbox but asks for one or more **leaks** from a fixed menu:

```js
// @sandboxed
// @leak read-drafts
```

TRIF holds it once, the hold says exactly what was asked for, and TRIF **enforces** that list. That's
stronger than a page-script hold: a page-script hold describes what code *might* do, while a leaky mod
*can only* do what it asked for.

## The rule that keeps it safe: no leak sends anything

Nothing in the menu reaches the network: no `fetch`, no address of the mod's choosing, no request it can
shape. While that holds, reads can be combined freely. A mod that reads your drafts **and** the site's data
**and** your keystrokes still can't get any of it off the page. That's what makes "let it see my text" a
fair thing to say yes to.

A "talk to this one server" leak would break that for every other leak, so it isn't on the menu. A mod that
needs the network is a page script.

The leaks that *act* (clicking, going to pages, changing drafts) are where care is needed. Each one is
narrowed below, so it can't be turned into a send.

## The menu

Each entry gives the header name, what the mod gets, the **hold sentence** (proposed wording), how TRIF
keeps it narrow, and which of Tim's current mods would use it.

### Reads (they see more; nothing leaves)

1. **`read-drafts`**: what you type in text fields and editors.
   - Gets: the stand-ins' `.text` and a new `.value` on fields and editors; `input` events with their data.
   - Hold: **"It can read what you type on this site, but can't send it anywhere."**
   - Narrowing: password fields and `autocomplete="cc-*"` fields stay hidden, always.
   - Uses: a word counter; Style Encoder (reading the post it styles).
2. **`keys`**: keystrokes outside text fields, wherever focus is.
   - Gets: `key`/`code` on key events, except in fields and editors (that's `read-drafts`). The sandbox
     today hides keys whenever focus is on an element that could hide a field (a post on X, for one); this
     leak accepts that small risk.
   - Hold: **"It can see the keys you press (not in text fields), so it can have shortcuts."**
   - Uses: hotkeys on X (j/k on a focused post), the localhost demos, the Rainbow Raves.
3. **`site-data`**: the site's own data as it arrives, to filter it (`trif.filterResponse`, designed in
   SAFE-MODS.md).
   - Gets: parsed JSON copies of responses matching declared URL patterns; returns the filtered data.
   - Hold: **"It can see and filter what x.com sends this page (posts, profiles), but can't send anything."**
   - Narrowing: **the mod may only remove or reorder, never invent.** Every string in what it returns has to
     appear in what it got, or TRIF keeps the original. That matters because a page fetches the URLs
     in its own data (media, next-page cursors). A mod that could write a new URL into a response could
     make the page send for it.
   - Uses: Instagram following-only, hide-ai-content, hide-reposts; YouTube no-auto-radio and
     subscriptions-only; Facebook remove-pages; Detox Timeline's filtering half.
4. **`page-data`**: the page's own data behind an element (React props and state).
   - Gets: `el.pageData(path)`, a plain JSON copy with functions and DOM nodes stripped, read through TRIF's
     page runtime.
   - Hold: **"It can read the data x.com keeps behind what's on the page."**
   - Uses: Three-Column Feed, Follow Status, the spaceship.

### Effects that don't act on the site

5. **`sound`**: make noise.
   - Gets: Web Audio, and audio from `data:`/`blob:` or files shipped with the mod. No addresses, no
     microphone.
   - Hold: **"It can play sounds."**
   - Uses: robot-sounds, switch-snap, wake-up, the four Rainbow Raves.
6. **`controls`**: its own sliders, color pickers, checkboxes and text boxes.
   - Gets: `<input>` (range, color, checkbox, number, text), `<select>` and `<label>` of its own, outside
     any of the page's forms, with `.value`.
   - Hold: none needed on its own; listed as **"It can add its own controls (sliders, pickers)."**
   - Narrowing: no `type=password`, no `autocomplete` (a fake login box gets nothing the browser would
     fill), and never inside a page form.
   - Uses: Profile Styler, Post Styler, Image Borders, the tuners.
7. **`mods`**: talk to TRIF's other mods on the page.
   - Gets: `trif.channel(name)` with `send`/`on`, between compartments only, never through the page's DOM,
     so a page script (or the page) can't listen in.
   - Hold: none on its own. Listed as **"It can talk to your other sandboxed mods on this page."**
   - Uses: the Rainbow Raves' "stop", skip-to-sandbox, the tuners.

### Acts (they do something on the site)

8. **`media`**: play, pause, mute or seek the page's own audio and video.
   - Hold: **"It can play and pause video and audio on this page."**
   - Uses: Reading Feed, SoundCloud no-autoplay.
9. **`search-box`**: a search box of its own that goes to the site's search page.
   - Gets: `trif.searchBox(urlTemplate)`, a box TRIF draws and owns. The mod sets its place and style;
     only what **you** type goes into the address, and only when you press Enter. The mod can't fill or
     read it.
   - Hold: **"It adds a search box that searches amazon.ca."**
   - Uses: the five Simple Homes (Amazon ×3, eBay, Reverb), and Kijiji's, which fakes typing today.
10. **`go-to`**: take you to declared pages on this site.
    - Gets: `trif.goTo(path)` for paths listed in the header (`// @leak go-to /home /i/following`), or any
      link already shown on the page.
    - Hold: **"It can take you to these pages on x.com: /home, /i/following."**
    - Narrowing: literal paths, no queries, no wildcards, since a path the mod builds could carry data.
    - Uses: random-mods; Detox Timeline's tab switch.
11. **`click`**: click declared buttons on the page for you.
    - Gets: `el.click()` only on elements matching selectors listed in the header.
    - Hold: **"It can click these for you: the play button."** The hold names each selector in words the
      mod gives, with the selector underneath.
    - Narrowing: refused on anything that submits a form or is a link to another site.
    - Uses: SoundCloud play-on-open; Detox Timeline's "Following".
12. **`write-drafts`**: change what you've typed or pasted before you send it.
    - Gets: setting a field's `.value`, inserting text into editors, replacing pasted or dropped files.
    - Hold: **"It can change what you type and paste on this site before you post it."**
    - Uses: Style Encoder, Image Borders.

## Combinations

Reads on their own can't leave the page. One combination can: **`write-drafts` with any read.** A mod that
can read your data and also write into your post could slip your data into a post you then send. When a mod
asks for both, the hold adds:

> **"Together, it could put what it reads into something you post."**

The other acts are narrowed so they carry no data: the search box only takes your typing, `go-to` only
takes fixed paths, `click` only fixed selectors, and media controls carry nothing. Clickjacking (dressing up
the page so your click lands somewhere else) is possible for every tier, rules included, and no leak
changes that.

## How approval works

- A leaky mod sits in the **Sandboxed** group (no fourth group), with its leaks on its row.
- It's held until you approve its leaks. **The approval is for the set of leaks, not the code.** Since TRIF
  enforces the list, an update with the same leaks runs without asking again. An update that asks for a new
  leak is held for that leak.
- "New mods start" (Settings) applies as for any sandboxed mod.
- In Safari, where there's no sandbox, a leaky mod is held like any sandboxed mod there and runs as a page
  script if allowed.

## What it would mean for Tim's mods

From a scan of what each of the 59 page-script mods uses (not a conversion):

| Would be | Count | Notes |
|---|---|---|
| Sandboxed, no leaks | ~20 | the YouTube feed mods, NYT reading mode, Punk Theme, Hide Ratings, Simple Shopping, Sky Clouds, … |
| Leaky | ~35 | mostly one leak: `sound`, `site-data`, `search-box`, `controls` |
| Page script | ~4 | X-Flyer (everything), Detox Timeline (rewrites requests for "Recent", an iframe), Facebook load-further-ahead (replaces the page's `IntersectionObserver`), tool-layout (types into the page) |

Detox Timeline could become leaky (`site-data`, `go-to`, `click`) if its "Recent" sort moved to a declared
`trif.rewriteRequest`, which changes what the site *receives*. That's a send, so it's left out of this menu
for now.

## Open questions for Tim

- Names: "leaky" or something kinder ("with exceptions")? The header (`@leak`) and the hold text follow.
- Should `controls` and `mods` need a hold at all? They give nothing that reaches beyond the mod.
- Is `keys` worth a leak, or should hotkeys just be part of the sandbox, accepting the closed-shadow-root
  risk?
- Building order: `sound`, `controls`, `keys` and `read-drafts` are small. `site-data` (filterResponse with
  the no-invent check), `page-data` and `search-box` are bigger.
