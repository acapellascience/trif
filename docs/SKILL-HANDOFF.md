# The TRIF skill: getting a mod from Claude into TRIF

The skill (`skill/`, made by `skill/build.js`) lets Claude write a mod anywhere: Claude in Chrome's side panel,
claude.ai, Cowork, Claude Code. This note is about the last step, getting the file into TRIF, and about a test
hook inside TRIF. It ranks the options, says what a hostile page could do with each, and what's built.

**Status (2026-11-16, second pass).** Tim chose: keep Paste a mod, build (a) in the helper, and build "Try it
here" as a button only the user can press; (b) and (c) as page hooks stay out. All three are built on branch
`skill`, their wording waiting for Tim in docs/SKILL-STRINGS.md:

- **Paste a mod…** (sidepanel.js pasteCard): the ⋯ menu, a box, Add or Try it here.
- **Mod files in Downloads** (helper/lib/downloads.js; Settings → "Offer to add mod files I download", off by
  default; config.json `watchDownloads`): the card "Add this mod?" with Add, Try it here, Not now, Ignore files
  from <site>. Details and threats below, as designed.
- **Try it here** (background.js tryMod, helper/lib/preview.js): on both cards, by the card's tab.

## The one fact everything turns on

Claude in Chrome acts on a page by running JavaScript **in the page's own world** and by synthetic input. TRIF
can't tell that code from the page's own scripts: same world, same events, same origin. There is no API between
extensions, so nothing Claude does carries a mark a page couldn't copy. (A one-time code the user reads from
TRIF's panel and types into Claude's chat would be such a mark; the page can still read it from Claude's injected
code and race it, and it costs the user the very steps a hand-off is meant to save.) So: **any hand-off a page
can trigger, every page can trigger**, on every site TRIF is on for, including ads and third-party scripts in
those pages. And what passes through the page's world can be read or changed by the page: a mod Claude hands
over that way may not be the mod that arrives.

Also: Claude in Chrome's panel and TRIF's both live in Chrome's side panel, and a window shows one at a time.
Whatever the hand-off, the user switches to TRIF's panel to see it (a badge on TRIF's toolbar button can say
something's waiting).

## The options, ranked

| | Option | Steps for the user | A hostile page could | Verdict |
|---|---|---|---|---|
| 1 | **(d) Import or drag a file** (exists) | save, open TRIF, ⋯ → Import mod…, pick the file (or drag it from Chrome's downloads) | nothing new | The skill's default now |
| 1b | **Paste a mod** (prototype, branch `skill-paste`) | copy the code from the chat, open TRIF, ⋯ → Paste a mod…, paste, Add | nothing new: only what the user pastes | Recommend: small, safe, works for every surface, and in any window that uses the panel's code |
| 2 | **(a) TRIF notices a mod file in Downloads** and offers "Add this mod?" | open TRIF, Add | download a file (Chrome shows it; a second asks the user) and so put a card in front of them | Recommend next, built as below; Tim's call |
| 3 | **(b) A page hand-off** (CustomEvent / postMessage to a content script) → card | open TRIF, Add | put a card in front of the user silently, from any page, any time | Not now; only with every rule below |
| 4 | **(c) A page-callable "try this mod"** in TRIF's runtime | none | run code in TRIF's sandbox whenever it likes | Don't build. Instead: a "Try it here" button on the import card, which only the user can press |

What lands in TRIF is the same for every option: TRIF's import (`helper/lib/share.js importMod`) checks the
header, takes out `@source`/`@version`, files it by its `@match`, never over a mod without the user's choice, and
marks it imported; the browser starts it **switched off** (`extension/lib.js applyNewMods`, `newOff: 'new'`), and
`held.js` **holds** it if its code can act. So the floor is the same: nothing runs until the user switches it on,
and nothing that can act runs until they've read what TRIF found and allowed it. The options differ in how
easily the card gets in front of them, and who can put it there.

### (a) Downloads, in detail

Two ways to notice the file:

- **The helper watches the downloads folder** (no browser permission). It already writes exports there
  (`share.js exportMod`). Firefox gets it too, and so does every other surface: a mod file downloaded from
  claude.ai or Cowork lands there as well. On macOS the file's own record of where it came from
  (`com.apple.metadata:kMDItemWhereFroms`, which Chrome and Firefox set) gives the card its source ("from
  claude.ai", "from x.com"). To check on a fresh Mac: whether reading ~/Downloads from the helper (started by the
  browser) brings up macOS's folder-access question, and under which app's name.
- **Chrome's `downloads` permission** (`downloads.onCreated`/`onChanged` give the file, its address and the page
  it came from). As a required permission it's an install warning ("Manage your downloads") and, on update,
  Chrome turns TRIF off until each user accepts it: wrong for the store listing being prepared on `store`. As an
  **optional** permission (asked for when the user switches the feature on) there's no warning on install or
  update. The extension still can't read the file: the helper would. So it adds a prompt and Chrome-only code to
  get what the folder watch gives anyway.

Recommended: the helper's watch, **off until the user switches it on** in Settings (so a store reviewer and a
user who never uses chats see nothing), and:

- only files that appeared after the helper started, ending `.js`, at most 4 MB, with a `// ==WebMod==` header;
  never anything else read; never a file moved or deleted (an added mod is a copy);
- one card at a time per browser, and at most a few an hour; the rest wait in a list behind the first;
- the card says it's a file in Downloads, names the file and where it came from, shows the mod's name,
  description and what TRIF found in it (the hold's facts, for a free mod), and offers Add and Not now; "Ignore
  files from <source>" after a second;
- Add runs the existing import (site question, copy or replace), and the mod arrives off and, if it can act, held;
- the card and its badge show in whatever TRIF surface is open for that site (the side panel, or the
  phone-sized "edit for mobile" window when it lands), keyed by the mod's site, not by a tab.

Threats, and what stops them:

- *Spam*: a page triggers downloads to fill the panel with cards. Chrome shows each download and asks before a
  page's second one; the watch keeps one card and a few an hour.
- *Social engineering* ("TRIF update: add this to fix X"): the card says plainly the file came from a download
  and from where, never borrows TRIF's voice, and the mod still arrives off and held: the user would have to
  Add, switch on, and Allow what TRIF found, three separate choices.
- *Reaching a power or approval*: none: the import path is the one a dropped file takes; a card never allows,
  never switches on, and Add is its only act.
- *Drive-by*: nothing runs from a download. Off is the floor.
- *Privacy*: the helper reads names in the downloads folder. It reads only new `.js` files' headers, keeps
  nothing about the rest, and is off unless switched on. The privacy policy (store/PRIVACY.md) would say so.

### (b) A page hand-off, in detail

A content script listening for a `trif:offer-mod` event (or `postMessage`) and turning it into a card. Over (a)
it saves one file save, and loses Chrome's download prompt and the user's sight of a download: a page can offer
silently, as often as the limits allow, and can swap Claude's mod for its own on the way (it runs in the same
world). It also adds a listener every page can reach in an extension that has none today. If it's ever built, it
needs all of (a)'s rules plus: only on sites TRIF is on for, top frame only, the mod's `@match` limited to the
page's own host (so a page can only offer mods for itself, which its own scripts could already do while it's
open), plain data only (text, at most 4 MB, parsed by the helper, never `eval`ed or rendered as HTML), one
pending offer per tab, "Block offers from <site>", and a card that says "This page offered a mod" (not "Claude"
or "your agent": TRIF can't know). Recommendation: don't, unless (a) and paste turn out not to be enough.

### (c) A page-callable trial, in detail

The best test of a mod is TRIF's own runtime, and a trial would be temporary, this tab only, no powers. But a hook
any page can call hands every page the sandbox as a surface to probe: today only mod files the user added reach
it; with the hook, any web page could, as often as it likes, and TRIF's sandbox world has `messaging: true` to the
background (background.js configureWorld), the step after an escape. A page could also run trials to switch off
other boxed mods' acts on the page (an active run makes TRIF refuse risky pairs), or flood the user's logs. The
same test without the exposure: **a "Try it here" button on the import card** (and on a held mod's card), which
runs a style or boxed mod, without powers, on the tab the card is for, until it reloads. Only the user can press
it; it should take the tab it's for, so it works in the side panel and in the phone-sized edit window alike.

For Claude's own testing, the skill doesn't need TRIF at all: `scripts/page/try-style.js` runs TRIF's own
style-mod runtime (copied from `helper/lib/rules.js` by the generator, so it can't drift) with an undo, and
`try-boxed.js` runs a boxed mod's code over the page with a copy of TRIF's API that refuses the main things the
box refuses. Both are Claude's code in the page, as Claude's every other action is, and reach nothing of TRIF's.

### What's built for (a), and what the user sees on macOS

- The helper reads the folder with asynchronous calls only, so the system's question never holds it up. The
  first read happens when the user switches the setting on (and at each start of the browser while it's on).
- macOS protects ~/Downloads. The helper is the browser's child, so the system asks in the browser's name, once:
  "“Google Chrome” would like to access files in your Downloads folder" (or Firefox's). Until it's answered the
  note says "Looking at your Downloads folder… (your computer may ask whether your browser can.)". Refused (now
  or before), reading fails with EPERM and the note says how to allow it (System Settings → Privacy & Security →
  Files & Folders → the browser → Downloads Folder); nothing else breaks, and it starts working on the next look
  once allowed. Many users won't see the question at all: a browser that has saved downloads there, or TRIF's
  own Export (which writes there), usually has it already. Not tried on a fresh Mac account here (it would mean a
  real TCC prompt on Tim's machine): to check, on a new macOS user, switch it on in each browser.
- Where it came from: macOS's where-from record on the file (the page's site is shown, never the address) and the
  quarantine record's app name; on Linux, Chrome's `user.xdg.*.url`. Found here: headless Chrome for Testing
  writes the quarantine record (its own name) but no where-from record, for blob:, data: and served downloads
  from 127.0.0.1 alike; the card then says "<file> is in your Downloads." without a site. Whether a real Chrome
  and Firefox write it for a download from claude.ai is on Tim's try list. (The quarantine record's id also
  points into macOS's download history database, which has the address; TRIF doesn't read that.)
- Both browsers' helpers watch when it's on (one config); a file added or put off in one is dropped from the
  other (downloads.json in the private folder, also where "Ignore files from" is kept).

## Waiting on Tim

1. The wording of all three (docs/SKILL-STRINGS.md) before a release.
2. A line in the privacy policy (store/PRIVACY.md, on branch `store`) for the Downloads setting: off by default;
   when on, the helper reads the names in the downloads folder and new `.js` files' text, on the computer only.
3. Publishing the skill (claude.ai upload, a plugin marketplace): `node skill/package.js` makes
   `skill/dist/trif-skill.zip` and `skill/dist/trif-plugin/`.
