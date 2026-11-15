# The iPhone app's new strings (branch ios-poc): awaiting Tim

**Awaiting Tim** (written 2026-11-15). Every string below is new or changed in the iPhone app (mobile/browser-probe)
and is already in the build so it can be tried; nothing here is approved yet. Where the app shows the same thing
as the desktop panel, it uses the panel's approved words unchanged (listed at the end, not for review). The
proof of concept's own strings (the probe's checks, report, point-and-hide bar) aren't listed: they're unchanged.

## Tabs

| Where | Old | New |
|---|---|---|
| Address bar, empty | Address | Search or type an address |
| Toolbar, accessibility labels | (icons only) | Back · Forward · Chat · Mods · Mods, {n} waiting for your OK · Tabs, {n} open · More · Reload · Stop |
| Tab switcher's title | — | 1 tab · {n} tabs |
| Tab switcher, a tab with no page | — | New tab |
| Tab switcher, + and × (accessibility) | — | New tab · Close {tab's title} |
| A new tab's page, its list | — | Visited lately |
| A new tab's page, nothing visited yet | — | Type an address or a search above. |
| The ⋯ menu | (wand menu, pages menu, checks and report buttons) | New tab · History · Import… · then the wand's four items as before · then **The probe** (Checks, Report, the test pages, the real sites) |

## History

| Where | New |
|---|---|
| Title, search field | History · Search history |
| Empty | No history yet. The pages you visit are kept here, on this phone only. |
| Search finds nothing | Nothing in your history matches. |
| A visit's long-press menu | Open in a new tab · Copy address |
| Clear button, its question | Clear… · **Clear history** — The last hour · Today · All history — Your history is kept only on this phone. Cleared, it's gone. |
| After importing a browser's history | Added {n} visit(s) to your history. |

## The Mods tab

The tab is the desktop panel's mods list (tiers, rows, icons, the approval and code cards) with the panel's words.
New or changed:

| Where | Desktop | iPhone |
|---|---|---|
| The sheet's title | (Mods on this site) | Mods on {site} (Mods when no site) |
| No mods for the site | (the section is hidden) | No mods for {site} yet. Open the chat, say what to fix, and add the mod it writes. |
| No site (a new tab) | — | Open a site to see its mods. |
| A tap on a row's icons (no hover on a phone) | each icon's words on hover; a click opens Details | a small card: each icon with its words (the panel's ICON_LABELS), and **Details** |
| After the bin | (moves to TRIF's trash, `trif restore`) | Deleted {name}. **Undo** (this launch only; there's no trash on the phone) |
| A tier's On / Off, its tooltip | …Click to switch them on here. / …click to stop all of these… | …Tap to switch them on here. / …tap to stop all of these running here (each mod's own switch is kept). |
| A tier's On / Off failing | — | Couldn't switch {Style mods} {on/off}: {why} |
| A free mod that should run here and didn't start | — | Can't run here on iPhone: this page didn't let it start. (under its row, and in Details) |
| "updated" tag's tooltip (an import replaced it) | TRIF updated it and switched it off: switch it on once you've looked at it. (a shipped mod's update) | You imported a new version of it, so TRIF switched it off: switch it on once you've looked at it. |
| History, nothing kept | No earlier versions kept. TRIF keeps the version before each change your agent makes, a fix, a restore or an import, for 30 days. | No earlier versions kept. TRIF keeps the version before each change your chat makes, a restore or an import, for 30 days. |
| Don't allow's tooltip | The version before stays; the change is kept in its history (trif history). | The version before stays; the change is kept in its history. |
| Things hidden by long-pressing, under the mods | — | **Hidden by pointing**, each selector with **Show again** |
| Under the list | (⋯ menu) Import mod… | **Import mod…** as a button; the sheet's ⋯ has Import mod… and Export all mods for {site} |

The mod switches' tooltips still say "click" (they come from extension/modswitch.js, shared with desktop): screen
readers read them on the phone. Worth a phone wording, or leave.

## Editing a mod's code (the code card's Code tab; added 11-15)

| Where | New |
|---|---|
| Code tab's button | Edit |
| While editing | Undo · Redo · Cancel · Save |
| Save refused | **Not saved:** TRIF found a problem in it. — then up to eight lines, each **Line {n}** (tap: the editor selects that line) and what's wrong, in `trif check`'s own words (helper and sandbox lint, as agents see them) |
| Saved, runs | Saved. It runs from this page load. **Undo** |
| Saved, needs an OK | Saved. It waits for your OK: the version before keeps running until you decide. **Undo** |
| After Undo | Put back the version from before your edit. Your edit is in History. |
| History, a version an edit replaced | before you edited it |
| The approval card's note for an edit | You edited it. (then desktop's "The version before keeps running until you decide.") |
| An edit's own holds, on the card | runs on {pattern}, outside {site} (desktop's held.js words) · is now a free mod, so it can do anything the page can do (new) |
| Editor (accessibility) | The mod's code (desktop's) |

## Getting out of a mod that wrecks a page, and diagnostics (added 11-15)

| Where | New |
|---|---|
| The Mods tab before its list arrives | Loading mods… |
| Mods tab's ⋯ | Pause all mods · Resume mods · Send diagnostics… |
| The app icon's long-press menu | Pause all mods |
| Mods tab, all paused | **All mods are paused:** none runs on any site. **Resume mods** |
| Toolbar's Mods button while paused (accessibility; its robot shows two bars for eyes, STYLE.md's paused face) | Mods, all paused |
| Over the page after safe mode | The app quit while mods were running on {site}, so TRIF switched it/them off. Switch them back on one at a time in Mods. **Mods** · **OK** |
| Over the page after a runaway offer was taken | TRIF switched off a mod / {n} mods on {site} that kept this iPhone busy. Switch them back on one at a time in Mods. **Mods** · **OK** |
| Mods tab, after safe mode | The app quit while these were running on {site}, so TRIF switched them off: **{names}**. Switch each back on to try it. **OK** |
| Mods tab, after a runaway offer | These kept this iPhone busy on {site}, so TRIF switched them off: … / The page on {site} stopped twice while these ran, so TRIF switched them off: … |
| The runaway offer (an alert) | **{site} keeps this iPhone busy** — Its page has been busy most of the time for 40 seconds while mods ran on it. Switch them off? {name} changed most recently. / Its page stopped twice in three minutes while mods ran on it. Switch them off? — **Switch off its mods** · **Not now** |
| Status strip, a page's process ended | This page stopped (iPhone ended it, often for memory), so it was loaded again. |
| The diagnostics file's name | TRIF diagnostics.txt (its lines are for whoever reads the log: not reviewed here) |

## Adding and importing

| Where | New |
|---|---|
| Status strip, a mod added that needs an OK (the Mods tab opens on its card) | {name} waits for your OK. |
| Status strip after an import (one) | Imported 1 mod: {name}. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page. |
| … (several) | Imported {n} mods: {names}. Like any mod from outside, they start off, and each waits for your OK if its own code can do more than change the page. |
| … an error (desktop's words) | Couldn't import {file}: {why} |
| … nothing usable | Nothing to import there. · Nothing TRIF can import there: {files}. |
| The share sheet / AirDrop's "Open in" name for the app's files | TRIF mod (the document type's name, Info.plist) |
| The "Add this mod?" sheet's free-mod warning | unchanged words, now in the panel's coral |

## The chat, full screen (added 11-15, replacing the pane from the bottom)

| Where | Old | New |
|---|---|---|
| The chat's top bar, the way back | (the pane closed with the chat button) | **‹ {site}** (**‹ Tab** on a tab with no site); accessibility: Back to {site} |
| The chat's top bar, Start over | Start over (text) | a new-chat icon; accessibility: Start over |
| The chat's top bar | Send page · Paste | (gone: the tab's data goes into the message box when the chat opens, and a reply's mod comes to the app by itself) |
| The pane's grip (accessibility) | Chat height | (gone) |
| Toolbar's chat button (accessibility) | Chat | Chat · Chat, writing a reply (animated dots on the bubble) · Chat, replied (a small green mark: a reply with no mod in it) |
| The Add this mod? sheet, a reply with several mods (offered in turn) | — | {n} of {m} mods in the reply |
| Status strip, a reply whose mod can't be read | — | The reply's mod can't be added: {why}. |
| Status strip after a mod from the chat is added | Added {name}. What it did is attached in the chat's message box: send it, with what to fix, if it needs fixing. | (gone: what it did goes into the message box the next time the chat opens) · Added {name}. It runs on {sites}. (unchanged) |

What's attached in the message box keeps its names: TRIF instruction (a chat without TRIF's instructions yet),
TRIF follow-up (one that has them), TRIF screenshot, TRIF pointer.

## Notes that go by themselves (added 11-15)

| Where | Old | New |
|---|---|---|
| The notes at the foot of the page (status, Hidden: … Undo) | a × to close each (accessibility: Dismiss) | no ×: each fades out after 2 s, or 5 s with Undo; a tap sends it sooner (10 s with VoiceOver on). No new words |
| The Mods tab's note (Deleted {name}. Undo · Couldn't switch …) | stayed until the next change | the same: 5 s with Undo, 2 s without |
| Status strip, a load that was cancelled or interrupted (another navigation replaced it, the page stopped itself: amazon.com) | The operation couldn't be completed. (NSURLErrorDomain error -999.) | (nothing, as in Safari); real failures (offline, an unknown host, a certificate) still show |

## The bars as the page scrolls, and the toolbar's icons (added 11-15)

| Where | Old | New |
|---|---|---|
| The address bar, scrolled down (compact) | — | the site without www. (a small lock on https; **New tab** on an empty tab); accessibility hint: Shows the address bar. The chat's robot sits at its right while a reply is being written or waits (accessibility: Chat, writing a reply · Chat, replied) |
| Toolbar, the Mods button | the robot (paused: bars for eyes) | a switch (paused: off); accessibility unchanged: Mods · Mods, all paused · Mods, {n} waiting for your OK |
| Toolbar, the chat button | a speech bubble (dots while writing, a green mark when replied) | the robot (three moving dots for eyes while writing, the green mark when replied), shown selected while the chat is open; a second tap goes back to the tab. Accessibility unchanged: Chat · Chat, writing a reply · Chat, replied |
| The chat, full screen | covered the toolbar | the toolbar stays under it; back and forward only close the chat (back to the page as it was), the other buttons go back to the tab and do their job there |
| Toolbar, back and forward while the chat is open (accessibility) | Back · Forward | Back to {site} (Back to Tab on a tab with no site), as the chat's own ‹ {site} |

## Notifications when a reply is done in the background (added 11-15)

Asked for at the first send (iOS's own question; the app adds no words to it). Posted only while the app is in the
background, within the ~30 s iOS gives it there.

| When | Title | Body |
|---|---|---|
| The reply has one mod | Your mod is ready | {mod's name} for {site}: tap to add it. |
| Several mods | Your mods are ready | {n} mods for {site}: tap to add them. |
| No mod | Claude replied (ChatGPT replied) | On {site}: tap to read the reply. |
| iOS's background time ran out first (quiet: no sound or banner, only in the list; removed when the app opens) | Still writing | Claude is still writing for {site}. Open TRIF to get your mod when it's done. |

A tap opens the app on the tab the message was sent from, with Add this mod? (or the chat at the reply).

## The chat's message box filling faster (added 11-15)

| Where | Old | New |
|---|---|---|
| Over the chat while the tab's data goes into its box (a moment; it was 10 to 15 s on Instagram) | — | Adding the page… |
| The screenshot attached in the message box | TRIF screenshot.png | TRIF screenshot.jpg |

## The desktop panel's words, reused unchanged (not for review)

Style mods / Boxed mods / Free mods and their lines; On / Off; the row tags (new, updated, on hold, change on hold,
error, N errors); the light's tooltips; Show code; Delete; N more for other {site} pages; the approval card (Waiting
for your OK, N of M waiting for your OK, It asks for these powers. TRIF holds it to them:, TRIF found that this
mod:, A change to it is waiting. TRIF found that the new version:, Together, …, the free-mod warning, You imported it
from a file., An agent wrote / changed it in your chat on {site}., Updates that ask for the same powers won't ask
again., The version before keeps running until you decide., Allow, Show code / Hide code, Show what changed, Don't
allow, Not now); the code card (Code, Details, History, Running now, Waiting for your OK, the Details lines, See
differences, Restore, the History sources, The version from {date}., What changed since the version from {date} (-
then, + now)., Restored the version from {date}. The one before is in History., Copy, Copied, Export); every power's
and warning's "i" (explain.json); Import mod…; Export all mods for {site}; Couldn't export: {why}.
