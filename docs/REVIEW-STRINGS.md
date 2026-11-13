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

## Secrets out of arguments; an update feed that expires (branch release-keys)

What a person sees:

- the panel's update line, and `trif update`, when the feed is too old (helper/lib/update.js feedTooOld),
  after "Couldn't check for updates:": **the update feed is from 2026-09-01, more than 8 weeks ago, so it may
  be an old copy that hides a newer version; not using it**
- the same, for a feed with no date at all (none has been made): **the update feed has no date, so it may be
  an old copy that hides a newer version; not using it**
- an open-model run whose Codex didn't send the key proxy's token (helper/lib/agents/codex-oss.js
  friendlyFor): **This Codex didn’t send the run’s key-proxy token, so TRIF’s key proxy refused its request:
  update Codex (brew upgrade codex, or npm install -g @openai/codex), then try again**
- what the key proxy answers such a request with (helper/lib/keyproxy.js NO_TOKEN; Codex shows it after
  "401 Unauthorized", in a plain Codex run's error too): **TRIF's key proxy: this request doesn't carry the
  run's token. Only the run's own Codex can use it (Codex 0.166 or later sends it)**

What Tim sees, releasing (scripts/release.js):

- after a release and a dry run: **The feed is signed for 2026-11-13T18:04:11.000Z; installs accept it until
  2027-01-08.** and **The feed is good until 2027-01-08: release again before then, or run node
  scripts/release.js refresh-feed.**
- `node scripts/release.js refresh-feed [--dry-run]`: **updates/latest.json: TRIF 0.3.0, signed again (good
  until 2027-01-08).**, then **Commit and push it on main: git add updates && git commit -m "Update feed
  signed again" && git push** (or **Dry run: updates/ unchanged.**); its refusals: **there is no
  updates/latest.json (+ .sig) to sign again: release first**, **updates/latest.json isn't signed by the
  release key (helper/lib/release-key.js): not signing it again**
- keygen, when the keychain write fails: **couldn't save the key in the keychain: trif-release-key isn't in
  the keychain afterwards (…)** (the key itself never in it)
- the usage line: **usage: node scripts/release.js keygen | refresh-feed [--dry-run] | <version> [--dry-run]
  [--skip-tests]**
## Branch site-lock: the whole site locked, sensitive sites' mods start off, what rewrite-requests may write

None approved yet.

### The panel (extension/sidepanel.js)

- The notice's tooltip on another tab of a locked site, was "…blocks {site}'s pages from posting, sending or
  saving as you until that tab reloads…": **Your agent ran code in another {site} tab, so TRIF blocks
  {site}'s pages from posting, sending or saving as you, or opening other sites, until that tab reloads.
  Reading, scrolling, clicks and mods work as usual.** (The line itself is unchanged: "Posting is paused on
  this site: your agent ran code in another tab.")
- A mod's "new" tag, a sensitive site's mod the chat made (it starts off there): **{site} is a sensitive site,
  so every mod starts off there: switch it on once you've looked at it.**
- A mod's "changed" tag, a chat change waiting on a sensitive site: **{site} is a sensitive site, so your
  chat's change waits for you there: the version before runs until you turn this one on.**
- The upgrade's notice, under each host's row (beside "Mods for all sites don’t run there any more."): **New
  mods for it start off there, your chat’s too, until you switch them on.**
- The chat's result card on a sensitive site: "{file} waits for you." with Show code and Turn on (today's
  "Wait for me" strings), whatever the setting.

### What agents read

- `trif status`, a mod's state: **off (a sensitive site's, where every mod starts off: waiting for the user to
  look at it)** (helper/cli.js)
- `trif mods` for one: **off: it's a sensitive site's, where every mod starts off, the chat's too; not running
  until the user switches it on after looking at it (side panel, or trif enable {id} in their terminal)**;
  for the site's mod in `trif status --site`: **off: it's a sensitive site's, where every mod starts off, the
  chat's too, until the user switches it on**
- AGENTS.md "Sensitive sites": **Every mod there starts off until the user switches it on, yours too, whatever
  "Mods your chat makes" says, and a change you make to one that's on waits for them (the version before keeps
  running): when you finish, tell them it's waiting and that they turn it on in the side panel.**
- AGENTS.md, `trif run --page`: "pauses the whole site's posting, in every tab" is now **locks the whole site,
  in every tab (no posting, no other sites)**; and in "Side-panel runs": **The site's other tabs get the same
  lock meanwhile, new ones too: they can't post, or fetch from or go to another site, either. Only requests
  with no body to the site itself (GETs) pass: the lock stops sending, so don't count on it if a site changes
  something on a GET.**
- rewrite-requests header errors (helper/lib/boxpowers.js), new: **rewrite-requests: "{v}" is a word, so say
  which word it takes the place of: {path}=Top→{v} (a rule only swaps a setting the request has for another,
  never writes new text)**; was "isn't true, false, null, a number or a plain word (an address or long text
  could carry data)", now: **rewrite-requests: "{v}" isn't true, false, null, a number or one word swapped for
  another (Top→Recent): an address or other text could carry data**
- rewrite-requests hold, a swap (helper/lib/boxpowers.js rewriteWords): **changes what {site} receives from this
  page: sort set to Recent in place of Top or Popular (in Home requests)** (a literal reads as before: "flag
  set to false")
- `trif explain rewrite-requests` (extension/explain.json, approved 2026-11-11, changed): the explanation's
  "made by TRIF in the site's own requests;" becomes **made by TRIF in the site's own requests, and only a
  setting the request already has;**; a new agent note: **What it may write: `true`, `false`, `null` or a
  number, each only in place of a value of its kind the request already has (a boolean, a number; null for
  anything), and a word only in place of words the header names: `variables.sort=Top→Recent` (or `->`;
  several with `|`: `Top|Popular→Recent`). A field the request doesn't have is never added, and a word that
  isn't a swap is refused: so no text of the mod's own reaches the site, not even in a field's name.**; the
  header-errors note lists the two errors above.
- BOXED.md rewrite-requests: **Only to a field the request already has (none is added), and only in place of
  a value of its kind: `true`, `false` or a number for one, `null` for anything, and a word only for the words
  the header names: `variables.sort=Top→Recent` (`->` works too; `Top|Popular→Recent`).**

### Logs (the extension's)

- `locked tab {id} too: a tab of {site} opened it`; `tab {id} has only {site}'s rules: {error}`
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
## Runs work in a folder of their own (branch staging, docs/STAGING.md)


- The run's context (helper/lib/agents/index.js contextText), after "check the folder rather than giving up.":
  **You work in this run's own copy of the workspace (your working folder): name files by their place in it
  (sites/x.com/<mod>.js), not in ~/.trif; TRIF puts each change you save into the user's mods at once.**
- AGENTS.md, "Workspace", after "Only create or edit files inside this workspace.": **In a side-panel chat your
  working folder is the run's own copy of this workspace, with the same files in the same places: name files by
  their place in it (`sites/x.com/hide-reposts.js`), not by `~/.trif/`. Each change you save under `sites/` is
  copied to the user's mods at once, so the browser has it straight away.**
- AGENTS.md, the recording example: `-o ~/.trif/sites/x.com/_home-timeline.json` is now
  `-o sites/x.com/_home-timeline.json` (the old path still works: `trif` takes it as the same path in the copy).

The helper's log (`trif report` can include it), when a run's change isn't copied to the mods folder:

- **run copy r…: sites/x.com/AGENTS.md not copied to the mods folder: <why>**, where <why> is one of: **a file
  directly in sites/**; **too deep**; **the name "…" isn't one TRIF takes**; **AGENTS.md is a file agents read as
  instructions**; **y.com is another site's folder**; **a file with more than one name (a hard link)**;
  **reached through a link**; **changed while it was read**; **not a file**; **not a file there**; **changed
  again while it was copied (copied at the next sync)**; **x.com isn't a folder**; or trif delete's own refusal
  ("this chat can only delete mods that stay on x.com; …").
- **run copy r…: couldn't bring sites/x.com/a.js into the run's copy: <why>**
- **agent run r…: copied sites/x.com/a.js to the mods folder**
- **agent run r…: couldn't sync its working folder: <error>**
## "This could be a boxed mod" (trif check and trif verify, for agents)

- After a free mod's "ok: … parses", when everything it uses has a box equivalent: **This free mod only does
  what a boxed mod can, and a boxed mod is the safer tier (it can't send, click or load anything, and never
  waits for the user's OK): rewrite it as one (`// @boxed`; BOXED.md), unless it needs the page's own world.**
  Then up to six lines of swaps, each the sandbox lint's existing tip ("- document: use page (page.find,
  page.body, page.create)"), and "- (N more: trif check after the rewrite lists what's left)".
