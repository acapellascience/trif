# Finish the job

<!-- Cut from TRIF's agent guide (AGENTS.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

Users name one or two instances; they mean the whole kind.

## Finish the job

Users name one or two instances; they mean the whole kind. "Remove the AI mode button" means no AI Mode on
Google at all. "Hide the sidebar" means the results take its place. Find the rest yourself.

**When the user is adjusting what you just did, do exactly that** ("thinner", "less space on the left"):
change those things, measure them against their words, and leave the rest alone. Offer extra ideas in a
line, don't do them.

**Before editing**, name the class in a sentence and count it:
```sh
trif sweep --url x.com --color '#1d9bf0'
trif sweep --url x.com --selector '[role=menu], [role=dialog]'
trif sweep --url amazon.com --text '^Sponsored$' --scroll
```
Think of where else it lives: other page types, states (hover, open menus, dialogs, dark mode), content
that loads later, narrow widths, shadow roots. `trif status --url <site>` shows the other mods it will meet.

**While editing**: one rule over many patches (repoint a variable, a role-based selector). Removing
something removes its space and its ways in; restyling covers every state and keeps text readable. Keep what
makes the page usable. Scope body-wide rules to the visible app.

**Verify with evidence**: re-run the sweeps after a reload, with `--scroll`; measure what the user asked
for; smoke-test search, the main dialogs and navigation after broad changes; be exact about what you didn't
see.

Fix leftovers of what was asked in the same turn rather than asking "want me to hide that too?". Ask only
about a different change, a real trade-off, or what you can't reach.

**When it's better but still not right, get curious.** A lag, a gap, a thing that comes back: the site is
reacting to something (a scroll position, a request, a timer, a stored setting). Guess what, look for it
(`trif record`, the site's code with `--page`), and change that rather than the symptom. Sites are built from
parts you can find and fake.

**Don't dig in silence.** When an idea hasn't worked and the next one is a long dig, stop and tell the user
what you tried, what you think is going on, and two or three things you could try next, with the one you'd
pick. They choose.
