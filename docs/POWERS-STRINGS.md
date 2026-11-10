# Powers: the new strings (branch powers)

Every user-facing string the powers add, exact, **all awaiting Tim's OK**. The hold sentences are the
sketch's (docs/POWERS.md); a hold stores each as a fact after "it" (as the classifier's facts are), so the
panel shows "It <fact>." and `trif status` "it <fact>".

## Holds (panel and trif status)

| power | fact (the panel adds "It … .") |
|---|---|
| read-drafts | can read what you type on this site, but can't send it anywhere |
| keys | can see the keys you press (not in text fields), so it can have shortcuts |
| sound | can play sounds |
| controls (listed, never holds alone) | can add its own controls (sliders, pickers) |
| site-data | can see and filter what {site} sends this page (posts, profiles), but can't send anything |
| page-data | can read the data {site} keeps behind what's on the page |
| search-box | adds a search box that searches {host} ({host}: the search address's, from the header) |
| media *(phase 3)* | can play and pause video and audio on this page |
| go-to *(phase 3)* | can take you to these pages on {site}: {paths}, or to a link the page shows · (no paths) can take you to a link a page on {site} shows |
| click *(phase 3)* | can click these for you: {words} ({selector}), {words} ({selector}) (from the `@click` lines) |
| write-drafts *(phase 3)* | can change what you type and paste on this site before you post it |
| mods *(phase 3; listed, never holds alone)* | can talk to your other boxed mods on this page |
| write-drafts with read-drafts, keys, site-data or page-data *(phase 3: the combination, its own item)* | could put what it reads into something you post, with these powers together |

{site} is the mod's site folder (x.com), or "the sites it runs on" for a mod in all-sites.

## Side panel

- Hold heading: **Waiting for your OK. This boxed mod asks for these powers, and TRIF holds it to them:**
- Added to the hold's note: **Allow is for these powers: a new version that asks for nothing more runs
  without asking again.**
- On the mod's row: **Powers: sound, read-drafts** (the header's names, in the menu's order).

## CLI

- `trif status`, after `registered`: **(boxed, powers: read-drafts, sound)**
- `trif mods`: **kind: boxed mod with powers: read-drafts, sound (runs in TRIF's sandbox, with only TRIF's API
  and those powers; waits for the user's OK once for that set)**
- `trif check`:
  - **It runs in TRIF's sandbox with these powers, and only these (TRIF enforces them): read-drafts, sound.**
  - **It waits for the user's OK once for this set of powers (not for each change to its code: only a new
    power asks again). The hold will say it:** then `- it <fact>` per power
  - (controls alone) **Those don't make it wait for the user's OK on their own. A hold would list it:**
  - lint: **trif.audio: needs the sound power: add `// @powers sound` to the header (the user approves it
    once)**; the same for `create('input')`, `create('select')`, `create('option')` and `controls`.

## Errors (NOT SENT, trif check)

- **"{name}" isn't a power (the powers: read-drafts, keys, site-data, page-data, sound, controls, mods, media,
  search-box, go-to, click, write-drafts)**
- **the {name} power isn't in this version of TRIF yet** (no power on the menu gives it now: kept for later ones)
- **powers (@powers) are for boxed mods (@boxed): a free mod has every power the page has, and a style mod
  none**

## Errors a mod sees (TRIF sandbox: …)

- **that needs the {power} power (// @powers {power} in the mod's header, which the user approves)**
- read-drafts: **reading what's typed in the page needs the read-drafts power (// @powers read-drafts)** ·
  **password and card fields stay hidden, whatever the mod's powers** · **a {type} input isn't something the
  user typed** · **<{tag}> has no value**
- controls: **a mod's input can be range, color, checkbox, number, text (not {type})** · **{attr} takes a
  number** · **a label is for one of the mod's own controls (a trif-box- id)** · **a control a mod makes can't go
  inside a form** · **setValue is for the mod's own controls** *(phase 3: this one is gone; a page field without
  write-drafts now says the write-drafts error below)* · **setChecked is for the mod's own checkboxes**
- sound: **sounds come from data:audio/…;base64 addresses only** · **connect takes another of this mod's
  sound nodes, or 'out'** · **only sources start** / **only sources stop** · **no {name} here** · **{what}
  must be a number** · **this browser has no Web Audio**

## Phase 2 errors

- NOT SENT / trif check: **search-box takes the site's search address, with {query} where the words go:
  @powers search-box https://www.example.com/search?q={query}** · **search-box: "{value}" isn't an address** ·
  **search-box: "{value}" needs to be an http(s) address with {query} in it** · **search-box: {host} isn't
  this mod's site: a search box searches the site it's on** · **the {name} power takes nothing after its name**
- A mod (trif errors): **a filter may only remove or reorder, and {why}: TRIF kept what the site sent**, where
  {why} is **the text "{text}" isn't in what the site sent** / **the text "{text}" more times than what the
  site sent** / **the value {value} isn't in what the site sent** / **the key "{key}" isn't in what the site
  sent** / **it was too deep to check**; **a filter returns the data itself, not a promise: TRIF kept what the
  site sent**; **a filter returns plain data: TRIF kept what the site sent**
- A mod (thrown): **filterResponse takes a function** · **the page's data needs the page-data power
  (// @powers page-data)** · **a path is names with dots between them (props.post.text)** · **the search-box
  power needs its address in the header: @powers search-box https://…{query}**
- The search box's own label (read by screen readers): **Search**

## Phase 3 errors

- NOT SENT / trif check: **go-to: "{path}" isn't a page of this site: a path starting with /, with no query,
  # or \*** · **@click "{line}": say what it is, then a colon and its selector: // @click the play button:
  button.play** · **@click "{line}": that selector isn't one TRIF takes (no \\ escapes, value attribute,
  :autofill, braces or semicolons)** · **@click lines are for a mod with the click power (@powers click)** ·
  **the click power needs what it may click: // @click the play button: button.play**
- lint (trif check): **.click(): needs the click power: add `// @powers click` to the header (the user approves
  it once)**, and the same for **.play()**, **.pause()**, **.setMuted()**, **.setVolume()**, **.seek()** (media),
  **.setValue()** (write-drafts, unless the mod has controls), **trif.goTo** (go-to), **trif.channel** (mods).
  This replaces the lint's **a boxed mod can't click for the user** for `.click`.
- A mod (thrown):
  - media: **that's for the page's <video> and <audio>** · **playing the page's video and audio needs the media
    power (// @powers media)** · **a volume is from 0 to 1** · **seek takes a time in seconds**
  - click: **clicking for the user needs the click power, with what it may click named in the header
    (// @click words: selector)** · **that isn't one of the things the header says this mod may click** ·
    **a click that would submit or reset a form isn't offered, whatever the header says** · **a click on a
    link to another site isn't offered**
  - go-to: **"{where}" isn't one of the header's pages ({paths}, or none), or a link to this site that the
    page shows**
  - mods: **a message is plain data: text, numbers, true/false, null, arrays and plain objects (no functions
    or elements)** · **a message is nested too deep** · **a message is up to 256 KB** · **on takes a
    function**
  - write-drafts: **changing what the user typed needs the write-drafts power (// @powers write-drafts)** ·
    **password and card fields stay the user's, whatever the mod's powers** · **a {type} input isn't a text
    the user types** / **a select isn't a text the user types** · **changing what the user types is off on
    this page while another boxed mod here has the {read} power: with both, what one reads could end up in
    what the user posts (a mod that asks for write-drafts and {read} together shows the user that)**
