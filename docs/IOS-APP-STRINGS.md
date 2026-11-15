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
