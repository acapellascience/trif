# The All mods page: the new strings (branch mod-organizer)

Every new string people see on the All mods page (extension/allmods.html, allmods.js, allmods-model.js) and
where it's opened from, exact. **Awaiting Tim: all of them are drafts.** None of them names a coding agent.
`{…}` is filled in. The page reuses the side panel's words where it shows the same thing: the row tags
("waiting for your OK", "change waiting for your OK", "error", "{n} errors", "stopped a click", "may be broken",
"updated", "update available", "new", and their hovers), the tier names (Style mods, Boxed mods, Free mods),
the power icons' hovers, the approval card (all of it: it's the panel's own card) and the code card's notes
("Showing the first 200,000 characters.", "From the browser: TRIF's helper isn't connected.").

## A. Opening it

| Where | Words | OK? |
|---|---|---|
| The side panel's Mods ⋯ menu, a new last item | All mods… | |
| Settings, first of the links at the bottom | All mods · Report a problem · Setup and status | |
| `trif help mods` (for the terminal; agent-facing, listed for interest) | In the browser, the All mods page lists every mod by site, with its switch and status: the side panel's Mods ⋯ menu → All mods…, or Settings → All mods. | |

## B. The head, the search and the filters

| Where | Words | OK? |
|---|---|---|
| The tab's title | All mods · Tim's Robot Internet Fixer | |
| Heading | All mods | |
| Beside it | {31} mods · {8} sites (1 mod, 1 site) | |
| While it loads | Loading mods… | |
| It couldn't | Couldn’t load the mods: {error} | |
| The helper isn't connected (a red-edged line at the top) | TRIF’s helper isn’t connected: switches work, but deleting, exporting and Recently deleted wait for it. | |
| Search box (placeholder) | Search names, descriptions, sites and code | |
| Search box (screen readers) | Search mods | |
| On/off menu (screen readers: "On or off") | On and off · On · Off | |
| Kind menu (screen readers: "Kind") | Every kind · Style mods · Boxed mods · Free mods | |
| Filter button, with its count | Waiting for your OK | |
| its hover | Mods that wait for your OK before they run, or a change to them does | |
| Filter button | Has errors | |
| its hover | Mods with a recent error, or that may be broken | |
| Filter button | TRIF off on the site | |
| its hover | Mods for sites where TRIF is off, blocked or not connected: they don't run there | |
| Link, while a filter or a search is on | Clear filters | |
| Under the filters | {31} mods · or, filtered: Showing {12} of {31} | |
| Beside it | Select all · or, filtered: Select these {12} | |
| Nothing matches | No mods match. Clear the filters to see them all. | |
| No mods at all | No mods yet. Open a site and tell your coding agent what to fix: its mods show up here. | |

## C. The sites

| Where | Words | OK? |
|---|---|---|
| The group for mods on every site | Every site | |
| A site's group | {X} {x.com} (Tim's mods' name for the site, then its address) or just {github.com} | |
| Its state chip | TRIF on · TRIF off · Blocked · Disconnected | |
| hover, on | TRIF is on here: its mods that are switched on run. | |
| hover, off | TRIF is off here: none of these run until you turn it on in the side panel on this site. | |
| hover, blocked | Blocked in TRIF: none of these run here, and nothing from TRIF touches the site. | |
| hover, disconnected | TRIF isn't connected to this site: none of these run until you connect it in the side panel there. | |
| Its count | {3} of {4} on | |
| Its button | Open {x.com} (an open tab of the site comes to the front; else a new tab) | |
| Its checkbox (screen readers) | Select the {4} mods for {x.com} · Select the mod for every site · … (phone) | |
| The phone section's heading | Phone mods | |
| under it | These run only in the phone view (Edit for mobile in the side panel), on the site they’re for. | |

## D. A mod's row

| Where | Words | OK? |
|---|---|---|
| Its tier, after its name | Style mod · Boxed mod · Free mod | |
| When it last changed | Changed just now · Changed {5} min ago · Changed {3} h ago · Changed yesterday · Changed {4} days ago · Changed {12 Oct} · Changed {12 Oct 2025} (hover: the date and time) | |
| Off on some of its sites | off on {x.com, google.com} (and {2} more) | |
| Tag hover: updated | TRIF updated it from Tim’s mods and switched it off: switch it on once you’ve looked at it. (the panel's) | |
| Tag hover: update available | A new version from TRIF is waiting: the side panel on its site offers it. | |
| Tag hover: new | It came from outside your chat, so TRIF switched it off: switch it on once you’ve looked at it. (the panel's) | |
| A held mod's switch, hover (it opens the approval card) | Waiting for your OK: switch it on to see what it can do, and allow it | |
| Buttons (hover and screen readers) | Show code · Export · Delete | |
| Buttons without the helper (hover) | TRIF's helper isn't connected, so it can't do this | |
| Its checkbox (screen readers) | Select {Hide Trends} | |
| Under it, when something failed | Couldn’t delete it: {error} · Couldn’t switch it off: {error} | |

## E. What's selected

| Where | Words | OK? |
|---|---|---|
| The bar | {2} selected | |
| Its buttons | Turn off · Export · Delete · Select none | |
| Turn off, when none is on (hover) | None of them is on | |

## F. Messages, and Undo

| Where | Words | OK? |
|---|---|---|
| One mod exported | Exported {Hide Trends} to {~/Downloads} as {x.com-hide-trends.js}. | |
| It couldn't | Couldn’t export {Hide Trends}: {error} | |
| A selection exported | Exported {3 mods / one mod} to {~/Downloads}, in the folder {TRIF mods}. | |
| It couldn't | Couldn’t export them: {error} | |
| The folder a selection goes in (in Downloads, or where you choose) | TRIF mods (TRIF mods 2, …) | |
| The folder chooser's question | Where should TRIF save these {3} mods? · Where should TRIF save this mod? | |
| The bar at the bottom, after a delete | Deleted {Old Layout}. · Deleted {2} mods. | |
| after Turn off | Turned off {Wide Diffs}. · Turned off {2} mods. | |
| its button | Undo | |
| Undo failed | Couldn’t undo it: {error} | |
| After Undo of a delete | {Old Layout} is back. · {2} mods are back. | |
| Screen readers, with the bar | {Deleted Old Layout.} Undo is in the bar at the bottom. | |

## G. Recently deleted

| Where | Words | OK? |
|---|---|---|
| Its heading (folded) | Recently deleted ({3}) | |
| Each one | {Old Layout} {reddit.com} · deleted {2 h ago} (and its description under it); for every site: Every site · deleted … | |
| Its button | Restore (screen readers: Restore {Old Layout}) | |
| Restore can't (hover) | A mod with this name is in its folder again: rename or delete that one first | |
| Nothing there | Nothing deleted lately. | |
| Under the list | Deleted mods stay here for 30 days. | |
| Restored | {Old Layout} is back. | |
| It couldn't | Couldn’t restore {Old Layout}: {error} | |

## H. The code (read-only; the side panel's code card has Edit and History)

| Where | Words | OK? |
|---|---|---|
| Card's top line | Code | |
| Under the name | {x.com} · {hide-trends.js} (every site: Every site · …) | |
| Buttons | Copy (then Copied) · Show in Finder (Show in folder off a Mac) · Open in editor · Close | |

## A proposed What's new line (CHANGELOG, next release)

| Where | Words | OK? |
|---|---|---|
| The summary's one point | **All mods**: every mod you have, by site, in a tab of its own, with its switch, what's wrong with it and when it changed; search, filters, and Undo. From the mods' ⋯ menu or Settings. | |

## Questions for Tim

- The page's name: "All mods" (as the menu says) or something else ("Your mods", "Mod organizer")?
- A mod for several sites is listed once, under its folder's site, with one switch for the whole mod (the
  setup page's), not the panel's per-site switch; "off on x.com" says where it's switched off.
- Site icons come only from tabs open now (the browser already has them); a site without one gets its
  first letter. Fetching icons would mean asking each site, which the page never does.
