# Edit for mobile: the new strings (branch mobile-edit)

Every string people see that this branch adds, exact, for Tim's OK. None is approved yet. `{site}` and the
like are filled in. How it works: docs/MOBILE-EDIT.md.

## The panel

| Where | String | Notes |
|---|---|---|
| The bar's phone button (title and accessible name), on a site TRIF is on | Edit for mobile | a phone outline icon, beside New chat |
| The same button in the phone view's panel (pressed) | Back to desktop | |
| The line under the bar in the phone view's panel | Phone view: {site} sees an {device}. Mods you make here are for TRIF on your phone. | `{device}` is "iPhone" ("an iPhone") |
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

## Send to iPhone (the code card's ⋯ menu, on a Mac)

| Where | String |
|---|---|
| Menu item | Send to iPhone… |
| Note, AirDrop's window open | Pick your iPhone in AirDrop. On the phone, open {file} in TRIF. |
| Note, the file shown in Finder instead | {file} is in the Finder window: Share → AirDrop sends it to your iPhone, which opens it in TRIF. |
| The same, when the Mac has no AirDrop | No AirDrop on this Mac. {file} is in the Finder window: Share → AirDrop sends it to your iPhone, which opens it in TRIF. |

`{file}` is `<site>-<mod>.js`, as Export names it.

## Agent-only (my call, listed for reference)

- The run's context, for a chat in the phone view (helper/lib/agents/index.js `phoneText`): "Tab {n} is TRIF's
  phone view: a window 390 px wide where the site sees an iPhone (Safari's user agent, touch, no hover), so it
  shows its mobile layout. The user is making this mod for TRIF on their phone: write it for the layout this tab
  shows (selectors and screenshots from this tab, not a desktop one), add `// @device phone` to its header, and
  make it do nothing where that layout isn't there (it also runs in desktop tabs of the site). See "Phone mods"
  in AGENTS.md."
- The reminder on later messages: "…; it's TRIF's phone view (iPhone): a mod for the phone, `// @device phone`".
- AGENTS.md "Phone mods" (a short section under "Mod files").
- `trif tabs` marks the phone's tab `"phone": "iPhone"`.
- A header warning: "@device should be phone or desktop (got "{value}")".
