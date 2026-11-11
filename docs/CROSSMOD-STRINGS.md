# Cross-mod approval and the sandbox fixes: new and changed strings (branch crossmod)

**Awaiting Tim's OK.** Every user-facing sentence branch crossmod adds or changes: the approval card, the
mod row's review, `trif status`, the errors a boxed mod (and so the agent writing it) sees in `trif errors`,
`trif check`, and the agents' guidance. Errors read "TRIF sandbox: …". `{…}` is a value filled in. Bold is new.

## Cross-mod approval

The warnings themselves are the combinations' own sentences (helper/lib/combinations.js, generated, not
listed again here); what's new is the lead that names the other mod.

- Approval card, in the red box after the mod's own warnings: **"Together with {the other mod's name},** it
  {warning}." (the lead in bold, as "Together," is)
- The mod row's review box (a mod the user already has, one switched on, say): **"Together with {name}, it
  {warning}."**
- `trif status`, on a hold or a review: **"together with {name}, it {warning}"** (after the mod's own lines, as
  "together, it …" is)
- The refusals' ending, which said "(a mod that asks for {act} and {power} together shows the user that)"
  (approved wording, in the eight page-wide refusals: COMBO-FIXES-STRINGS.md, WIDEN-STRINGS.md,
  POWERS-STRINGS.md). Changed, since asking for an unused power is what this replaces: **"(the user's OK for
  the two mods together lifts it: TRIF asks for that when either is new, changed or switched on)"**. If Tim
  prefers the approved ending kept, it's one constant (extension/sandbox.js `LIFT`).
- The combinations doc's intro (docs/POWER-COMBINATIONS.md, generated): "… the sandbox's page-wide rules stop a
  combination split between mods from slipping past the hold**, unless the user approved the two mods together
  (the same warnings, "Together with …": cross-mod approval)**: docs/SAFE-MODS.md, "Combinations"."

## Agents (helper/workspace/AGENTS.md, TECHNIQUES.md)

- AGENTS.md, "Write the mod", after "the user approves the set once.": **"A mod asks only for the powers it
  uses.** Don't pad its powers so it can act beside another boxed mod on the site (a click refused while
  another mod has `keys`, say): the user's cross-mod approval covers coexistence (TRIF asks "Together with
  <the other mod>, it could …" on the mod's hold), and unused powers only put warnings on the hold for things
  it can't do. If a converted mod's header asks for powers its code never uses, take them out."
- TECHNIQUES.md, "Combinations", replacing "a mod that needs both asks for both.": "…(the error says which),
  **until the user approves the two mods together: TRIF asks them on your mod's hold ("Together with <the
  other mod>, it could …") when it's new or changed, or on its review. Never ask for a power your mod doesn't
  use** just to act beside another mod: that puts warnings on its hold for things it can't do. A mod that uses
  both asks for both."

## The sandbox fixes (job 1)

- `trif check`, a boxed mod with no powers but `@migrate`: **"It runs in TRIF's sandbox, with only TRIF's API,
  and brings over its old settings from the site's storage once (@migrate)."**, then the existing "It waits
  for the user's OK once for this set of powers …" and its hold line. (It used to say it never waits.)
- Canvas, a wrong argument to `arc` or `ellipse`: "TRIF sandbox: {arc|ellipse} takes numbers and text **(and
  true or false for anticlockwise)**"
- Canvas, `getImageData` on a canvas a picture from another site tainted: **"TRIF sandbox: its pixels can't be
  read: a picture from another site drawn on it was loaded without CORS (an image variant needs
  trif.imageVariant(img, { pixels: true }))"**
- `trif.imageVariant` with options that aren't an object: **"TRIF sandbox: imageVariant's options are { pixels:
  true }"**
- TECHNIQUES.md, for agents: `css(text, {shadow})` "…of the hosts that match, **roots inside roots too,** now and
  as they're made"; `block-events` "a blocked event reaches only `fn`, **where `e.preventDefault()` also stops
  what the browser would do (the page scrolling on Space or an arrow key; not for wheel and touch)**";
  `site-storage` "What you write has no **other site's** address that wasn't there or in a link on the page
  **(this site's own, `example.com/page` on example.com, is fine)**"; `image-variants` "**It shows from any
  host. To read its pixels, ask for them: `trif.imageVariant(img, {pixels: true})` loads it with CORS, so drawn
  on your canvas its pixels read back where its host allows (a host without CORS then doesn't show it).**";
  `edit-uploads` "**If no mod draws on it or gives back another, the original file goes on untouched.**"
