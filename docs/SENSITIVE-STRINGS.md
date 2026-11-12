# Sensitive sites, each a site of its own: the new strings (branch sensitive)

Every user- and agent-facing string this branch adds, exact. Tim's own words (2026-11-11) and the ones he
approved are marked **approved**; he approved the rest on 2026-11-11, so every one is.

## How it works (decisions to check)

- A host on the sensitive list (TRIF's, extension/agentsites.js, or the user's from Settings) under a
  registrable domain (mail.google.com under google.com) is a TRIF site of its own (extension/lib.js
  "sensitive sites"): its mods in `sites/<host>/`, "Mods on this site" lists only those, a side-panel run
  there is scoped to the host (its `trif` commands, and its macOS sandbox's writable folder,
  `sites/<host>/`; `sites/google.com/` is another site's folder to it, and the other way round). It has its
  own switch, block and access. The parent's mods never run on it (`*.google.com` gets mail.google.com
  excluded when registered, and so do TRIF's runtimes), nor do all-sites mods; its own mods run only there.
  A sensitive registrable domain (paypal.com) is already its own site; all-sites mods skip it too.
- A wildcard pattern (`*bank*`) splits at the matching label: netbank.example.com is its own site; a host
  like that becomes one the first time TRIF sees a tab on it.
- **Starts blocked**: TRIF puts each sensitive site on its block list once (`sensitiveDone` records it, so an
  Unblock sticks): TRIF's list on the first start of this version, a host the user adds to the list in
  Settings, a pattern's host the first time a tab is on it. The screen is the usual blocked one (Unblock, and
  Disconnect when it has access of its own: not for mail.google.com while google.com's access covers it).
  Unblock lands on "The robot is off." (or disconnected without access); Fix turns it on.
- **Upgrade**: a sensitive host the user's setup already reaches (TRIF on for its parent and a switched-on
  mod of the parent's, or an all-sites mod, matching it; or mods in `sites/<host>/`) isn't blocked: every
  site's panel asks once (the notice below), and until then nothing changes there. **Keep TRIF on there**
  copies the parent's mods that match the host into `sites/<host>/` (same file names; a name already there
  keeps both, the copy with `-2`), with their switches, what was allowed for each, what TRIF last let run
  and any hold, and turns TRIF on there; each copy is a mod of its own from then on. **Block it** puts the
  host on the block list (its folder untouched). A sensitive registrable domain the user already uses
  (on, or with mods of its own) is left as it is.
- On a site whose "Agent on this site" is Off, a side-panel run may only make style and boxed mods: a free
  mod it writes there is held, with the reason below (the agent sees it in `trif status`). The user can
  Allow it, change the level, or add the mod themselves.
- **Copy to {host}**: the code card's ⋯ menu on a parent's mod has one item per sensitive site of its own
  under that site; it copies the file into `sites/<host>/` (a name already there keeps both), where it's a
  mod of its own that starts off, like any mod from outside the chat.

## The panel

| Where | String | |
|---|---|---|
| The Off note (first line of the chat), sensitive site | `Your agent can’t see {host} (it’s {why}): it can only write mods from what you describe. Change it below.` | **approved** |
| The Off note, a site with no `why` on the list | `Your agent can’t see {host} (it’s on your list of sensitive sites): it can only write mods from what you describe. Change it below.` | **approved** (the fallback `why` is today's) |
| The Off note, a site the user set to Off | `Your agent can’t see {host} (you set it to Off): it can only write mods from what you describe. Change it below.` | **approved** |
| The agent level on the chat line, Off (always in words) | `Agent: Off` (then the ⌄) | **approved** |
| The mods box's folded line | `{N} more for other {site} pages` | **approved** |
| The upgrade's notice, one row per host | `{host} is {why}: TRIF now keeps it apart from {parent}, as its own site.` | **approved** |
| Its buttons | `Keep TRIF on there` · `Block it` | **approved** |
| Its buttons while working | `Keeping…` · `Blocking…` | **approved** |
| The code card's ⋯ menu, a parent's mod | `Copy to {host}` | **approved** |
| The code card after it | `Copied to {host}/{name}: it’s off there until you switch it on.` | **approved** |
| The code card, if it fails | `Couldn’t copy it: {error}` | **approved** |
| Under a row, when all-sites mods reached the host | `Mods for all sites don’t run there any more.` | **approved** |
| The notice, a host with no `why` on the list | `{host} is on your list of sensitive sites: TRIF now keeps it apart from {parent}, as its own site.` | **approved** |

The blocked and disconnected screens, Unblock, Fix, Connect and Disconnect are today's strings, with the
host in them (`The robot is blocked on mail.google.com`).

## What agents are told

| Where | String | |
|---|---|---|
| A free mod held on an Off site (`trif status`, the panel's hold) | `is a free mod, and "Agent on this site" is Off for {site}: there your agent may only make style mods and boxed mods` | **approved** |
| A side-panel run's context, Off | ` "Agent on this site" is Off here (the user's setting): you can't read, screenshot or run code on its tabs, and you may only write style mods (`trif new <site> <mod> --style`) and boxed mods (`--boxed`) for it, from what the user describes: a free mod you write here waits for the user, refused. If what they ask needs a free mod, say so and stop (they can change "Agent on this site" in the side panel, or add the mod themselves). Don't try trif text, trif screenshot or trif run here.` | **approved** |
| `trif delete`/`restore` from a run, a mod of another site's folder | `this chat can only {delete|restore} mods of {scope}; {id} is another site's. Ask the user to do it from the side panel there or their terminal.` | **approved** |
| Code a run sends meeting a site of its own (lib.js pageGuard) | `the tab went to {host} before TRIF reached it, which is a site of its own, and this agent run is limited to {scope}` (from a terminal: `…which is a site of its own, and TRIF is off there`) | **approved** |
| `trif status`, the sensitive sites TRIF blocked (counted, not listed) | `sensitive     {N} sensitive sites (email, banking, passwords, chats) blocked in TRIF until the user unblocks them, each a site of its own (`trif status --json`: sensitiveBlocked)` | **approved** |
| AGENTS.md | "Sensitive sites" under "Sites TRIF is on for", and the Off line under "Agent on this site" | **approved** |

## Logs (the helper's and the extension's)

- `sensitive sites, each a site of its own, blocked until you unblock them: {hosts}`
- `sensitive sites your mods reach, waiting for your choice in the side panel: {hosts}`
- `{host} is a site of its own, on, with its own copies of {N} mod(s)`
- `{host} is a site of its own: copied {from -> to, …}` (helper)
