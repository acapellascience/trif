# "What you're looking at now": the new strings (branch in-view)

**Drafts: not yet approved by Tim.** The words people see in the side panel are below; the words only the agent
reads (the note itself) are Claude's call, and are listed after them for reference.

## How it works (decisions to check)

- Every message the person sends from the side panel (Send or Enter; a message that waits while the agent works
  too, and one sent with Send now) carries a note of what was in view **at the moment of Send**: the panel's tab,
  or in the phone view the phone view's tab. Fix it, Explain, merges and other runs TRIF starts itself don't.
- The note has: a screenshot of exactly the visible viewport (JPEG, in the site's screenshots folder, the one
  `trif screenshot` uses, kept 30 days like the rest), the scroll position and viewport size, the selected text
  and its element's selector, and an outline of the elements on screen (up to about 3.5 KB; landmarks, posts
  and headings kept first, plain text cut first).
- **Sensitive sites are never pictured**, whatever "Agent on this site" says. Their outline goes only where a run
  may read the page anyway: "Agent on this site" Look or Run code (they're Off by default, and then nothing of the
  page goes at all). Any site set to Off: nothing.
- **No picture without the browser's say-so.** TRIF has only the sites it's on, not every site, and Chrome lets it
  picture a tab only after the person clicks TRIF's toolbar button on that tab (since the browser started, on that
  site). Without that, the outline, scroll and selection still go, and the note tells the agent there's no
  picture and why. TRIF never opens the copy window for this.
- Taking it never holds a message up: the message shows in the chat at once; the outline and the picture are taken
  side by side and each gives up after 1.5 s. Measured in the tests: about 10 ms for both on a test page, the
  page walk 10 to 17 ms on a 12,000-element X-like page.

## In the side panel (drafts)

| Where | Text |
| --- | --- |
| Under a sent message that carried the note | `with what’s in view` |
| Its tooltip, with a screenshot | `Your agent also got a screenshot of the page as you saw it, and a list of what was on screen.` |
| Its tooltip, without one (a sensitive site, or no toolbar click yet) | `Your agent also got a list of what was on screen (no screenshot).` |

A possible hint, not built: where there was no picture because the toolbar button wasn't clicked on the tab,
`Click TRIF’s robot icon on this tab to let your agent see it too.` (it would need a place: the chip's tooltip,
or a line under the message box).

## For the agent (Claude's words; for reference)

The note's header and footer: `--- In view when I sent this ---` … `--- End of what was in view ---` (several
messages sent as one: `--- In view when I sent “<first words>” ---` for each, the last three kept). Its lines:

- `Page: <url> (“<title>”), tab <id>[, in the phone view (<device>, <width> px wide)]`
- `Viewport: <w>×<h> CSS px, scrolled to y <y> of <height>[; <dpr> device px per CSS px].` (or `the page's own
  scroller <selector> scrolled to y …` when the page scrolls a box of its own)
- `Screenshot of exactly this viewport: <file>`, or `No screenshot: <why>.`, one of:
  - `this site is on TRIF's sensitive list, and TRIF never pictures those`
  - `Chrome lets TRIF picture a tab only after the user clicks TRIF's toolbar button on it (since the browser
    started, on this site), and TRIF has only this site's access, not every site's; the rest of this note is read
    from the page itself`
  - `the tab wasn't the one showing in its window as the message was sent`
  - `the browser's picture took over 1500 ms`
- `Selected[ in a text field]: “<text>”` and `  in <selector>`
- `In view, top to bottom (CSS selectors for page.find / trif run; y: px from the viewport's top):` then a line per
  element, indented under the one around it: `<selector> [(<kind>)] “<text>” [<label>] y <top>–<bottom>
  [← the selection]`
- `(<n> more in view not listed, to keep this short; trif run or trif sweep for the rest.)`

The guide's line (helper/workspace/AGENTS.md, "Side-panel runs"): **What the user is looking at.** … start from
the selection and that note, not a search of the whole page.
