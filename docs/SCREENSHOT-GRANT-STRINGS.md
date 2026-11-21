# Screenshots without access to every site: words people see (drafts, branch capture-grant)

TRIF has only the sites the user turned it on for, and Chrome, Edge and Firefox let it take a screenshot of a tab
only after the user clicks TRIF's robot on that tab or presses TRIF's shortcut there (activeTab). The browser takes
that back when the tab goes to another site (Firefox: any new page), when the tab closes and when the browser
restarts. Tim chose (11-21): keep per-site access, make the click painless. None of this is approved yet.

## In the panel

While an agent's `trif screenshot` waits for the click (up to 60 s), one small line in the chat of that tab, with
the robot icon in front (extension/capturegrant.js `SEE_TAB_TITLE`, `seeTabWhere`; sidepanel.js renderSeeTab):

> **Click the robot to let TRIF see this tab.** It's at the top right of Chrome, next to the address bar (or in the
> puzzle-piece menu). Or press ⌥⇧S.

- "Chrome" is the browser's name as TRIF knows it (Edge, Firefox, Brave…).
- "⌥⇧S" is TRIF's shortcut as the browser has it (Alt+Shift+S off a Mac). When the user has no shortcut for TRIF
  (removed, or another extension took it), the last sentence is left out.
- The line goes as soon as the click comes (the screenshot is taken then) or when the 60 s are up.
- While the line shows, the click on the robot leaves TRIF's panel open (it normally closes it).

## The shortcut

Its name in chrome://extensions/shortcuts, edge://extensions/shortcuts and Firefox's Manage Extension Shortcuts
(extension/manifest.json `commands`), Alt+Shift+S by default (⌥⇧S on a Mac):

> **Let TRIF see this tab**

It does what the click on the robot does, and opens TRIF's panel if it isn't open; it never closes it.

## Chrome Web Store (store/listing.md, the activeTab justification)

> Lets the user's agent take a screenshot of the tab the user is looking at, after the user clicks the TRIF
> toolbar button on it **or presses TRIF's keyboard shortcut there**. Chrome's captureVisibleTab needs activeTab or
> access to every site, and TRIF only asks for the sites the user turns it on for. Nothing else uses it: TRIF reads
> and changes only the sites the user allowed.

(added: "or presses TRIF's keyboard shortcut there")

## For agents only (no approval needed; listed for reference)

- `trif screenshot` refused, nothing to wait in (no TRIF panel beside the tab): as before, now naming the shortcut
  and that `--copy` needs the same click (extension/screenshot.js needsClick).
- After the 60 s with no click: says the panel showed the user a note for 60 s and none came, and to tell the user
  plainly and run `trif screenshot` again, which waits again (and that the click then leaves the panel open).
- `trif help screenshot` and AGENTS.md's command table: a line on the wait.
