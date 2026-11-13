# Strings added by the review fixes (branch fable)

New text a person or an agent can see. None of it has been approved; the drafts are in the code as below.

## The panel

- Code card, beside "Tim's mod, v3" when the file isn't a version TRIF shipped: **Tim's mod, v3, changed**
  (extension/sidepanel.js).
- A hold's fact, when a side-panel run changed a free mod that runs on every site after the user allowed it
  (helper/lib/held.js): **runs on <all_urls>, outside x.com: your agent changed it since you allowed that**
- A hold's fact, when TRIF couldn't work out the holds (helper/lib/held.js heldOnError): **couldn't be
  checked (something went wrong in TRIF), so it waits**
- A hold's fact for a `click` line whose words are in quotes (helper/lib/boxpowers.js): **can click these for
  you: only what says "Show more" (button.more)**; a line without quotes reads as before, "the play button
  (button.play)".

## What agents read (errors from `trif`, and from the sandbox in `trif errors`)

- navigate, open: **x.com sent the tab on to elsewhere.example, which is outside x.com: TRIF stopped it there
  (an agent's navigation stays on its site, since an address can carry what the agent read)**
- navigate, open, where the rule can't be set: **TRIF couldn't keep tab 5's page loads to x.com (…), so it
  won't send the tab anywhere for an agent**
- screenshot: **tab 5 stopped being the one showing in its window while TRIF took the picture, so there's no
  picture: try again, or use `trif sweep` or `trif text`**
- delete, restore: **sites/m.x.com is a link, not m.x.com's own folder: ask the user to do it from their
  terminal**
- `trif mods`, `trif doctor`, the log, for a skipped file or folder: **ignored: the file has a line break, a
  control character or a hidden direction mark in its name**
- write-drafts: **a draft isn't changed while the user is pressing a button or Enter (it may be on its way
  out): change it as they type, or a moment later**
- click: **the header lets this mod click what says "Show more", and this says "delete"**; **…and a boxed mod
  changed what this says, so TRIF can't tell**
- style mods (`trif check`): **a quoted string that isn't closed on its line**; **a url() whose address has a
  quote, a space, a bracket, a backslash or /* in it (put the address in quotes)**; **image-set(), image(),
  cross-fade(), element() and src() can load from an address**; **a selector can't name the value attribute or
  :autofill (it would read what's typed in a field)**
- rewrite-requests: **"variables.__proto__.x" names __proto__, prototype or constructor, which aren't a
  request's own fields**
- an agent that's too old, at a run's start: the adapter's existing "is too old for TRIF" sentence, now shown
  there too.

## `trif run` in the box (for agents)

- a boxed run whose code uses the page's own names: **Cannot read properties of undefined (reading 'title')
  (this ran in TRIF's box, where the page is `page` and `trif`, not `document` and `window`: BOXED.md has what
  they offer. For the page's own world, `trif run --page`: that pauses the site's posting until the tab
  reloads, and may ask the user first)**
- a browser without the sandbox world: **Safari has no box for an agent's code here (TRIF's sandbox isn't
  available): use `trif run --page`, which runs in the page's own world (document, window) and pauses the
  site's posting until the tab reloads**
- an extension older than the helper: **this browser's TRIF extension is from before `trif run` could use
  TRIF's box (it updates by itself; in Chrome, reload it on chrome://extensions). Until then: `trif run
  --page`, which runs in the page's own world (document, window) and pauses the site's posting until the tab
  reloads**
- the tab moved on: **the tab went to another page while the code ran, so what it returned is thrown away:
  run it again**
- a page with the sandbox from before an update: **this tab's page has TRIF's sandbox from before an update:
  reload the tab (trif reload) and run it again**
- `trif run --box --page`: **--page or --box, not both**
- `trif help run`: the new text in helper/lib/help.js, and AGENTS.md's "It runs in one of two places".

Nothing new in the panel: a boxed run shows no lock and asks no question.

## Shipped mods as a baseline, and style sections (branch holds-style)

The panel and `trif status`:

- A hold's fact, when an edit of one of Tim's mods makes it run on a host its shipped version doesn't while it
  can do something (helper/lib/held.js `shippedSiteNeeds`): **runs on https://bank.example/\*, where Tim's
  version of this mod doesn't**

What agents read:

- `trif check`, a mod with a style section (helper/cli.js): **Its style section (lines 5-20) checks out, with 2
  settings for the code: trif.style.size, trif.style.accent. TRIF applies it itself, so a change there alone
  never waits for the user's OK.** (one setting: "with a setting for the code: …"; none: "checks out. TRIF
  applies it …")
- A style mod with a style section (helper/lib/mods.js): **a style mod is all style: its CSS and hide list go in
  its JSON, without a // ==Style== section**
- The style section's own errors (helper/lib/stylesection.js; in `trif check`, `trif status` and `trif doctor`
  as the mod's problem):
  - **a style section (// ==Style== … // ==/Style==) goes right after the header's // ==/WebMod== line (only
    blank lines between)**; **…, and this mod has no header**
  - **the style section has no closing // ==/Style== line**; **a mod has one style section**
  - **line 7: every line of the style section is a // comment**
  - **the style section needs a JSON object between its two lines**; **the style section isn't valid JSON: …**;
    **the style section must be a JSON object**; **the style section can be up to 300000 characters**
  - **style section: unknown key "script" (a style section has css, hide, settings)**, and the rest after
    "style section: ", joined with "; ":
    - **"settings".size: a setting's name is a letter, then letters, digits or _ (up to 40)**
    - **"settings".size must be an object { type, value, … }**
    - **"settings".size.type must be number, colour, on-off or choice**
    - **"settings".size: "label" isn't for a colour setting (it has type, value)**
    - **"settings".size: a number setting needs "min" and "max", numbers, min below max**
    - **"settings".size.step must be a number above 0**; **"settings".size.unit must be one of px, em, …**
    - **"settings".size.value must be a number from 10 to 40**
    - **"settings".accent.value must be a colour as #rgb or #rrggbb (or with alpha: #rgba, #rrggbbaa)**
    - **"settings".marks.value must be true or false**
    - **"settings".layout.options must be 2 to 20 different words (a letter, then letters, digits or -, up to
      40)**; **"settings".layout.value must be one of its options (list, grid)**
    - **"css": var(--marks) is an on-off setting, which CSS can't use as a value (the code can:
      trif.style.marks)**
    - **"settings" must be an object: { "name": { "type": …, "value": … } }**; **at most 40 settings**
    - **"css" must be text, or a list of lines**; **"css" can be up to 200000 characters**
    - **"hide" must be a list of at most 500 selectors**; and the style mods' CSS and selector errors as they
      are, after **"css": ** or **"hide"[0]: **
- `trif errors`, from the sandbox when a boxed mod's style CSS came in unchecked (only if something other than
  the helper sent it): **TRIF sandbox: the style section's CSS loads from an address, or reads a field, so
  TRIF didn't apply it**

The guide (helper/workspace):

- AGENTS.md: the new section **A style section in boxed and free mods**; in "Mods that wait for the user's
  OK": **…; a change to a mod's style section alone (above) runs straight away too.**; in "Mods TRIF ships": **An edit
  of one that keeps using what the shipped version did runs straight away; one that adds a power, a line
  that uses one, or a site it runs on or talks to waits for the user's OK.**
- TECHNIQUES.md: **A free or boxed mod's looks: its style section** (one paragraph), and one sentence in
  "1. CSS": **Fixed CSS belongs in the mod's style section (above); the helper below is for CSS the code works
  out.**
- BOXED.md: **Its looks in a style section.** (a paragraph, an example, a line on `trif.settings` and
  `trif.css`), and `style` in the list of what `trif` has.
