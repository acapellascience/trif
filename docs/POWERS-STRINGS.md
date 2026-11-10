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
| site-data *(phase 2)* | can see and filter what {site} sends this page (posts, profiles), but can't send anything |
| page-data *(phase 2)* | can read the data {site} keeps behind what's on the page |
| search-box *(phase 2)* | adds a search box that searches {site} |
| media *(phase 3)* | can play and pause video and audio on this page |
| go-to *(phase 3)* | can take you to these pages on {site} |
| click *(phase 3)* | can click these for you |
| write-drafts *(phase 3)* | can change what you type and paste on this site before you post it |
| mods *(phase 3; listed, never holds alone)* | can talk to your other boxed mods on this page |

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
- **the {name} power isn't in this version of TRIF yet**
- **powers (@powers) are for boxed mods (@boxed): a free mod has every power the page has, and a style mod
  none**

## Errors a mod sees (TRIF sandbox: …)

- **that needs the {power} power (// @powers {power} in the mod's header, which the user approves)**
- read-drafts: **reading what's typed in the page needs the read-drafts power (// @powers read-drafts)** ·
  **password and card fields stay hidden, whatever the mod's powers** · **a {type} input isn't something the
  user typed** · **<{tag}> has no value**
- controls: **a mod's input can be range, color, checkbox, number, text (not {type})** · **{attr} takes a
  number** · **a label is for one of the mod's own controls (a trif-box- id)** · **a control a mod makes can't go
  inside a form** · **setValue is for the mod's own controls (changing what the user typed is the
  write-drafts power, not in this version)** · **setChecked is for the mod's own checkboxes**
- sound: **sounds come from data:audio/…;base64 addresses only** · **connect takes another of this mod's
  sound nodes, or 'out'** · **only sources start** / **only sources stop** · **no {name} here** · **{what}
  must be a number** · **this browser has no Web Audio**
