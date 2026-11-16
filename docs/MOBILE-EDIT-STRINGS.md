# Edit for mobile: the new strings (branch mobile-edit)

Every string people see that this branch adds, exact, for Tim's OK. None is approved yet. `{site}` and the
like are filled in. How it works: docs/MOBILE-EDIT.md.

## The panel

| Where | String | Notes |
|---|---|---|
| The bar's phone button (title and accessible name), on a site TRIF is on | Edit for mobile | a phone outline icon, beside New chat |
| The same button in the phone view's panel (pressed) | Back to desktop | |
| The line under the bar in the phone view's panel | Phone view: {site} sees an {device}. Only its phone mods run here, and the mods you make here are for TRIF on your phone. | `{device}` is "iPhone" ("an iPhone"). Changed on mobile-edit-fix (phone mods' own folder) |
| Its link | Back to desktop | |
| A chat note when opening fails | Couldn’t open the phone view: {why} | `{why}` from the list below |
| A chat note when going back fails | Couldn’t go back to desktop: {why} | |

The `{why}`s (from the background):

| Case | String |
|---|---|
| TRIF is off or disconnected there | TRIF isn't on for {host}: turn it on first |
| Not a web page | the phone view is for web pages |
| No access to the host (rare: the button shows only where TRIF is on) | TRIF has no access to {host}: connect it first |
| The browser won't keep rules to one tab | this browser didn't keep the phone view's rules to one tab |

## Phone mods' own folder (branch mobile-edit-fix)

| Where | String | Notes |
|---|---|---|
| A chat note after Export all mods, in the phone view | Exported {n} phone mod(s) for {site} to the folder "{dir}" in {where}. | `{dir}` is `phone~{site} mods` |
| The folder Export makes there | phone~{site} mods | the folder name in Downloads (or where chosen) |
| A refusal a run can get (agents see it; the chat may show it) | {id} is a desktop mod: this run is in the phone view, which switches only its own mods (sites/phone~{site}/) | |
| The same, the other way | {id} is a phone mod: switch it from the phone view's chat | |
| The helper log, once, per mod moved | moved the phone mod {from} to {to}: the phone view has a folder of its own now | not in the panel |

The folder name `phone~<site>` shows wherever a mod's id or folder does (Show in Finder, `trif mods`, the
setup page's lists). If Tim prefers another name (`<site> (phone)`, say), it's one constant on each side
(`PHONE_PREFIX`), as long as it can't be a host name.

## Send to iPhone (the code card's ⋯ menu, on a Mac)

| Where | String |
|---|---|
| Menu item (phone mods only, since mobile-edit-fix) | Send to iPhone… |
| Note, AirDrop's window open | Pick your iPhone in AirDrop. On the phone, open {file} in TRIF. |
| Note, the file shown in Finder instead | {file} is in the Finder window: Share → AirDrop sends it to your iPhone, which opens it in TRIF. |
| The same, when the Mac has no AirDrop | No AirDrop on this Mac. {file} is in the Finder window: Share → AirDrop sends it to your iPhone, which opens it in TRIF. |

`{file}` is `<site>-<mod>.js`, as Export names it.

## Agent-only (my call, listed for reference)

- The run's context, for a chat in the phone view (helper/lib/agents/index.js `phoneText`, since mobile-edit-fix):
  it's a TRIF of its own; phone mods in `sites/phone~<site>/`, the only folder it can write; the desktop mods in
  `sites/<site>/` to read, for the idea, rebuilt for the mobile page without assuming the same selectors or data.
  "This run is limited to {site}'s phone view".
- The reminder on later messages: "…; it's TRIF's phone view (iPhone): phone mods only, in sites/phone~<site>/".
- The panel's console line (for Tim's checks): "[TRIF] phone view, tab {n}: rules on, page script registered, this
  page has the marker (it sees an iPhone)", or MISSING / has NO marker (it sees a desktop), "a service worker
  controls it".
- AGENTS.md "Phone mods" (a short section under "Mod files").
- `trif tabs` marks the phone's tab `"phone": "iPhone"`.
- A header warning: "@device should be phone or desktop (got "{value}")".
