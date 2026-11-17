# Finish the job

<!-- Cut from TRIF's agent guide (AGENTS.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

Users name one or two instances; they mean the whole kind.

## Finish the job

Users name the one or two things they noticed; they mean the whole kind. "Remove the AI mode button"
means no AI Mode on Google: the button, the tab, the overview, the follow-up box. "Make the menus
rainbow" means every pop-up surface. "Hide the sidebar" means the results take its place. Every "you
missed these" costs the user a round trip; finding them is your job.

**When the user is adjusting what you just did, do exactly that.** "Thinner", "make the gift bigger",
"less blank space on the left" are about particular things, not a class to widen: change those, measure
them against the user's words (the gap they named, before and after), and leave everything else as it
was. Don't add changes they didn't ask for (centring, recolouring, moving things) while you're there; if
one would help, offer it in a line. When you're unsure what they mean, take the most literal reading and
say which in your first line. Before you report, reread their message and check each thing it asks for
against the page.

**Before editing: name the class and count it.**

1. Say in one sentence what kind of thing it is ("every surface painted X's brand blue", "every
   recommendation carousel on Amazon"). Write the change as a rule over that class, not a list of the
   instances named.
2. Count every instance with a query before writing code, and keep the numbers. Sweep by what the
   instances share: a colour or style, a component type (`role`, fixed or sticky bars, shadow hosts), a
   label (text, `aria-label`, a flag in the network data):
   ```sh
   trif sweep --url x.com --color '#1d9bf0'      # elements, ::before/::after, rules and CSS variables using it
   trif sweep --url x.com --selector '[role=menu], [role=dialog], [role=listbox], [role=tooltip]'
   trif sweep --url amazon.com --text '^Sponsored$' --scroll
   ```
   The report says where the matches are (landmarks, menus, dialogs, fixed/sticky, shadow roots,
   frames). Your own `querySelectorAll` and `getComputedStyle` loops miss shadow roots, `::before` and
   stylesheet rules; `trif sweep` doesn't. Repointing a variable, or re-declaring each rule that uses a value, beats patching elements,
   and catches what's added later.
3. List where else it lives, and check each: the site's other page types (home, search, item, settings;
   single-page apps change pages without a load); states (hover, focus, selected, open menus, dialogs
   and hover cards, empty and loading, light and dark); content that arrives later (lazy sections,
   infinite scroll); narrow and full widths (the side panel narrows the tab); shadow roots. Cross-origin
   iframes can't be changed from the page: say so.
4. `trif status --url <site>`: the other mods your change will meet.

**While editing: change it at the source, and follow the effects.**

- One rule over many patches: a variable repointed, a role-based selector, a condition ("anything still
  light at night gets dark text"). An allowlist ("only real results") fails by hiding everything: check
  it on a second page.
- Removing something removes its effects: the container, the space it held (grid and flex columns,
  `max-width`, margins, sticky offsets: let the neighbours take it), placeholders and skeletons, its
  copies (sticky duplicates, mobile variants), the ways in (links, tabs, buttons), its behaviour
  (autoplay, timers).
- Restyling something: every surface of that kind, in every state; text contrast on the new background;
  what shows through bars you made transparent; sibling regions consistent; stacking (`z-index`, a
  `transform` on an ancestor).
- Changing how a mod works (a new detection signal, a new hiding technique): move every part of it over,
  and anything in other mods that relies on the old way.
- Keep what makes the page usable unless it was named: "just price and stars" still needs Add to cart.
  Say in one line what you kept.
- `*`, `body *` and body-wide rules also hit hidden elements sites rely on (X computes a search token from
  some): scope them to the visible app, and smoke-test.

**Verify with evidence.**

- Re-run the same sweeps after a reload, on every page type and state you listed, with `--scroll`.
  Count: "0 of 37 blue surfaces left; 4 kept on purpose (video player, our button)" (for you, and for the
  user if they ask). The first match, or only the page in front of you, isn't verification.
- Measure what the user claimed: "fill the space" is the column's width before and after; "never shows
  up" is the first paint after a reload, not a minute later.
- After broad changes, smoke-test: search still returns results, the main dialog (compose, add to cart)
  opens, navigation works, other mods' pages and menus render, and what the user asked for earlier in
  the conversation still holds.
- Check preconditions before measuring: the mod is on (`trif status`), the element is on the page.
- Be exact about what you didn't see: a synthetic test (a faked label) isn't "fixed"; a screenshot you
  couldn't take is no grounds for describing how the page looks; a `--copy` screenshot isn't the tab's
  state.

**Fix what's in scope; ask only about what isn't.** Leftovers of what was asked (another instance,
page or state, the empty space it left) get fixed in the same turn and listed. Don't end with "want me
to hide that too?" or "tell me if you see another one" when you can look. Ask only about a different
change, a real trade-off (losing a feature, a higher risk tier), or what you can't reach. When you pick
between two readings of a request, say which in your first line.

Before you report:

- [ ] I changed the class with rules, not one selector per instance.
- [ ] The sweeps show nothing left on each page type and state I listed; I have the numbers.
- [ ] Nothing I removed left a gap; the neighbours reflowed (measured).
- [ ] Restyled things: all states, contrast, sticky bars, siblings.
- [ ] Core flows and the other mods still work; earlier requests still hold.
- [ ] What I couldn't check is named, with the reason.
