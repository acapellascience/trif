# The clickjacking guard: the new strings (branch clickjack-guard, for 0.3.2)

Every string people see when TRIF's clickjacking guard (extension/runtime.js `clickGuard`; RT-3 in
docs/SANDBOX-TIER-NOTES.md) stops a click, exact. **Awaiting Tim.** None of them names a coding agent.

## How it works (decisions to check)

- A trusted press (mouse or touch down, a click with no press before it, Enter or Space on a focused control)
  on one of the page's controls (a link, button, field, label, summary, frame, something with a control's
  role, `onclick` or a tab stop, or the outermost element with the pointer cursor), before the page sees it.
- Stopped only when the control is **unseen** (opacity under 0.25 all the way up, masked out, under 4 px, or
  showing nothing: no text, border, background or picture) **and it shows without the mods' styles**. The
  site's own invisible controls (a file input over a styled label, a custom checkbox) are left alone, as
  their look doesn't depend on a mod. Also stopped: a press through a boxed mod's own opaque element drawn
  over the control with clicks passing through it.
- What's stopped is the whole press: down, up, the click, the key's release. The page never gets it.
- A frame a mod hid becomes unclickable while the pointer is over it (the click then goes to what's under it,
  which is what the user saw), until the next press somewhere else.
- Told once per mod and reason on a page: the mod's row badge, `trif errors`, and one card in the site's chat
  per version of the mod (Ignore works as for an error). It isn't treated as an error to fix: no "Fix it",
  and "Fix it automatically" never starts a run for it.
- The card comes at once when the page has a boxed mod (TRIF's world tells the background); with only style
  mods it comes at the next look (the panel opening, or 3 and 9 seconds after a load).

## The card in the site's chat

> TRIF stopped a click: **{mod name}** had hidden what you clicked, so you couldn't see what it was. The
> page didn't get the click. If you didn't expect this, turn **{mod name}** off.

Its buttons: **Turn it off** · **Show code** · **Ignore** (title: *Don't flag this again for this version of
the mod*, as on the mod-error card). Once the mod is off: **Turned off.** in place of the buttons.

| | OK? |
|---|---|
| the card's text | |
| Turn it off / Show code / Ignore | |
| Turned off. | |

## The mod's row

- The badge: **stopped a click** (in place of **error** when every new entry is a stopped click).
- Its title, and the message in the code card's error line (it is the mod's entry in `trif errors` too):

> TRIF stopped a click on the page's "{control}": this mod's style {reason}, and without the mod it shows,
> so the click would have landed on it unseen.

`{control}` is the element, its id and up to 40 characters of its label (`<button#del> Delete account`).
`{reason}`, one of:

| why | reason | OK? |
|---|---|---|
| faded | made it nearly transparent | |
| masked | masked it out | |
| tiny | made it a few pixels small | |
| inkless | left nothing of it showing (no text, border, background or picture) | |
| covered | covered it with one of the mod's own elements, which lets clicks through to it | |

## Proposed CHANGELOG line (0.3.2; not in CHANGELOG.md yet)

> - **A click on something a mod hid is stopped.** If a style or boxed mod makes a button or link invisible
>   and you click where it is, TRIF stops the click and tells you which mod did it.

| | OK? |
|---|---|
| the line | |

## Agent-only (not for approval)

`window.__webmods.guard` (stats: presses, checks, ms; the last 50 stops), the `kind: 'clickjack'` and `why`
fields on the entry in `trif errors`, and the comments in the code.
