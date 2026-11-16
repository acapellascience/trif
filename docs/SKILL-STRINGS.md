# Strings: the TRIF skill, and getting a mod into TRIF

Every new piece of text people see, for Tim's OK. The skill's own text (SKILL.md and its references, the scripts'
messages, read by Claude) isn't listed: it's Claude's to word. Where the skill tells Claude what to say to the user
about TRIF's panel, it names TRIF's existing labels (Mods on this site, ⋯, Import mod…, Fix <site>).

## Shown in Claude's apps (branch `skill`)

| Where | Text |
|---|---|
| claude.ai Customize → Skills, Claude Code's plugin list: the skill's name | trif |
| the skill's description (also the plugin's), 182 of claude.ai's 200 characters | Write mods for TRIF (Tim's Robot Internet Fixer), the extension that customizes websites. Use when asked to change how a site looks or works: test the mod live, then hand it to TRIF. |
| the local plugin marketplace (`skill/dist`, for trying the plugin before it's published; seen only by whoever adds it) | TRIF's skill, built locally from the TRIF repository, to try before it's published. |

## In TRIF's panel: "Paste a mod…" (branch `skill-paste`, a prototype)

| Where | Text |
|---|---|
| the Mods ⋯ menu, under Import mod… | Paste a mod… |
| the card's line over its title (as Import's cards) | Import mod |
| the card's title | Paste a mod |
| under the title | It's added switched off, like an imported file: look at it, then turn it on. |
| the text box's placeholder | Paste the whole mod here, from // ==WebMod== to the end. |
| the text box's label (screen readers) | The mod's code |
| buttons | Add · Cancel |
| if the import fails, in the chat (Import's existing note, with the name the paste gets: the mod's @name in kebab-case, or pasted-mod.js) | Couldn't import <name>.js: <why> |

After Add, the existing import cards follow unchanged (which site; add a copy or replace).

## Proposed, not built: TRIF notices a mod file in Downloads (docs/SKILL-HANDOFF.md, option a)

| Where | Text |
|---|---|
| Settings, a switch (off by default) | Offer to add mod files I download |
| its note | When a mod file (.js with a TRIF header) appears in your Downloads, TRIF offers to add it, switched off. It reads nothing else there. |
| the card's line over its title | From your Downloads |
| the card's title | Add this mod? |
| its lead | <file> was downloaded from <source>. It's added switched off: look at it, then turn it on. |
| buttons | Add · Not now · Ignore files from <source> |
| TRIF's toolbar button, while one waits (a badge) | 1 |
