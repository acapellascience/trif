# Strings: the TRIF skill, and getting a mod into TRIF

Every new piece of text people see, for Tim's OK before a release. The skill's own text (SKILL.md and its
references, the scripts' messages, read by Claude) isn't listed: it's Claude's to word. Where the skill tells Claude
what to say to the user about TRIF's panel, it names TRIF's existing labels (Mods on this site, ⋯, Import mod…,
Paste a mod…, Fix <site>).

## Shown in Claude's apps

| Where | Text |
|---|---|
| claude.ai Customize → Skills, Claude Code's plugin list: the skill's name | trif |
| the skill's description (also the plugin's), 182 of claude.ai's 200 characters | Write mods for TRIF (Tim's Robot Internet Fixer), the extension that customizes websites. Use when asked to change how a site looks or works: test the mod live, then hand it to TRIF. |
| the local plugin marketplace (`skill/dist`, for trying the plugin before it's published; seen only by whoever adds it) | TRIF's skill, built locally from the TRIF repository, to try before it's published. |

## In TRIF's panel: "Paste a mod…"

| Where | Text |
|---|---|
| the Mods ⋯ menu, under Import mod… | Paste a mod… |
| the card's line over its title (as Import's cards) | Import mod |
| the card's title | Paste a mod |
| under the title | It's added switched off, like an imported file: look at it, then turn it on. |
| the text box's placeholder | Paste the whole mod here, from // ==WebMod== to the end. |
| the text box's label (screen readers) | The mod's code |
| buttons | Add · Try it here (Undo while it's being tried) · Cancel |
| under the box, while it's tried | Trying it on this tab. Undo, or reloading the page, takes it away. |
| … or when it threw | It ran into a problem here: <the error> |
| if the import fails, in the chat (Import's existing note, with the name the paste gets: the mod's @name in kebab-case, or pasted-mod.js) | Couldn't import <name>.js: <why> |

After Add, the existing import cards follow unchanged (which site; add a copy or replace).

## In TRIF's panel: mod files in Downloads

Settings, under "Install updates automatically":

| Where | Text |
|---|---|
| the switch (off by default) | Offer to add mod files I download |
| its note, off | When a mod file appears in your Downloads, TRIF offers to add it, switched off. It reads nothing else there. |
| … just switched on | Looking at your Downloads folder… (your computer may ask whether your browser can.) |
| … on | TRIF offers each new mod file in your Downloads. It reads nothing else there. |
| … macOS refused the folder | TRIF can’t read your Downloads folder: your computer didn’t allow your browser to. To allow it, open System Settings → Privacy & Security → Files & Folders, and turn on Downloads Folder under your browser. |
| … no such folder | There’s no Downloads folder for TRIF to look in. |
| … anything else | TRIF can’t look in your Downloads folder: <why> |
| … the switch failed | Couldn’t change it: <why> |

The card (at the top of the panel, on any site, while an offer waits):

| Where | Text |
|---|---|
| over the title | From your Downloads |
| title | Add this mod? <the mod's @name> |
| then | <its @description> |
| then | <file> was downloaded from <site>. It’s added switched off: look at it, then turn it on. |
| … where the system kept no record of where it came from | <file> is in your Downloads. It’s added switched off: look at it, then turn it on. |
| a boxed mod with powers that ask | It asks for powers, so it waits for your OK. It could: (then the hold's own lines, as TRIF writes them today) |
| a free mod TRIF would hold | TRIF finds it could do more than change the page, so it waits for your OK. It could: (the same) |
| buttons | Add · Try it here (style and boxed mods) · Not now · Ignore files from <site> (when the site is known) |
| while it's tried | Trying it on this tab. Undo, or reloading the page, takes it away. (and Undo in place of Try it here) |
| when the trial threw | It ran into a problem here: <the error> |
| TRIF's toolbar button while an offer waits (a badge, blue) | 1 |

Errors the card or the paste card can show (in the line under them):

| When | Text |
|---|---|
| Try it here on a free mod | Only style and boxed mods can be tried here. This is a free mod, which would run with everything the page has: add it, and it waits for your OK. |
| the mod's @match doesn't cover the tab | This mod isn't for this page: its @match lines don't include it. |
| TRIF is off on the site | TRIF is off on <host>: turn it on there first |
| not a web page | TRIF can only try a mod on a website |
| no sandbox (Safari, or a browser without TRIF's world) | <browser> has no box for boxed mods here, so TRIF won't try one |
| the tab has an old sandbox | this tab has TRIF's sandbox from before an update: reload it, then try again |
| the tab moved while it was tried | the tab went to another page meanwhile: try again |
| the tab closed | that tab is gone |
| the file changed after it was offered | <file> changed since TRIF offered it |
| the offer was handled elsewhere | that offer is gone |
| not a mod TRIF can read (paste) | it's empty · it's bigger than a mod can be (4 MB) · it has no // ==WebMod== header, so it isn't a mod TRIF can read · its header has a problem: <why> |

Not TRIF's, but what the user may see when they switch it on (macOS, the first time the browser's helper reads
the folder, if the browser hasn't been allowed before): “Google Chrome” would like to access files in your
Downloads folder. [Don’t Allow] [Allow] (or “Firefox”, or the browser's own name).
