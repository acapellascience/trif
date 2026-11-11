# Site approval and the sandbox fixes: new and changed strings (branch crossmod)

**Awaiting Tim's OK.** Every user-facing sentence branch crossmod adds or changes: the approval card, the
mod row's review, `trif status`, the errors a boxed mod (and so the agent writing it) sees in `trif errors`,
`trif check`, and the agents' guidance. Errors read "TRIF sandbox: …". `{…}` is a value filled in. Bold is new.

## Site approval

The box on a mod's card (and its review row), after the mod's own powers and warnings, in the red box's colours:

- Title: **"Your {site} mods together"**
- Headings: **"What they can see beyond the page"**, **"What they can do as you"**, **"Where what they see could go"**
- Items, one per power in the site's union (words from the powers' own lines, extension/explain.json):
  - see: **"what you type"** (read-drafts), **"the keys you press"** (keys), **"what {site} sends this page"**
    (site-data), **"the data behind the page"** (page-data), **"what {site} keeps"** (site-storage, @migrate),
    **"the fonts on this computer"** (local-fonts), **"pictures you attach"** (edit-uploads)
  - do as you: **"click {the @click words, comma-separated}"** (click), **"write into your drafts"** (write-drafts),
    **"signal the page's code"** (page-events), **"take you to pages"** (go-to), **"change what {site} receives"**
    (rewrite-requests), **"keep some of what you do from the site"** (block-events)
  - could go: **"into posts and drafts"** (write-drafts), **"pictures you post"** (edit-uploads), **"{site}'s
    storage"** (site-storage), **"clicks the site sees"** (click, block-events), **"the page's own code"**
    (page-events), **"which pictures load"** (image-variants, preload), **"which videos load"** (embeds), **"how media
    plays"** (media), **"sound"** (sound)
- Marker on an item this mod adds: **"new"**
- Flags: **"So something they read could end up sent from your account."** (see and could-go lists both non-empty);
  **"So they could post for you."** (write-drafts with click or page-events)
- The card's note for a mod held because it was switched on: **"You switched it on, and it adds to what this site's
  boxed mods can do together."** (then the existing "Updates that ask for the same powers won't ask again.")
- `trif status`, on a hold or a review: **"it adds to what your {site} mods can do together"**, then one line each:
  **"{site} mods together, what they can see beyond the page: {items}"**, **"{site} mods together, what they can do
  as you: {items}"**, **"{site} mods together, where what they see could go: {items}"**, **"{site} mods together:
  {flag}"**, each item followed by **" (new)"** when the mod adds it.
- The ending of the eight page-wide refusals, which said "(a mod that asks for {act} and {power} together shows the
  user that)" (approved wording: COMBO-FIXES-STRINGS.md, WIDEN-STRINGS.md, POWERS-STRINGS.md): **"(the user's OK for
  this site's mods together lifts it: TRIF asks when a mod that adds it is new, changed or switched on)"**
  (extension/sandbox.js `LIFT`). A refusal now also goes in the mod's errors (trif errors), once per act on a page.
- The combinations doc's intro (docs/POWER-COMBINATIONS.md, generated): "… the sandbox's page-wide rules stop a
  combination split between mods from slipping past the hold**, unless the user approved what the site's boxed mods
  can do together ("Your … mods together": one approval per site)**: docs/SAFE-MODS.md, "Combinations"."

## Quiet powers and one card per request (2026-11-11)

- Quiet powers (sound, controls, mods, preload, embeds, media) don't hold on their own: no new sentence on the card
  (they're listed as before when something else holds). The explain table's agent notes for sound, media and
  embeds: **"Quiet: doesn't make the mod wait for the user's OK on its own (like controls and mods); a warned
  combination it makes, in the mod or among its site's boxed mods, does."**
- The approval card for several mods one request made or changed:
  - name: **"{n} mods from one request"**
  - lead: **"They ask for these powers. TRIF holds them to them:"** (or **"TRIF found that these mods:"** when one of
    them is a free or style mod)
  - each mod: its name, its kind's chip (as on a single card), **"Show code"** (opens its code card), and
    **"changed"** for a change to a mod that was running; its lines and its own red box as on a single card
  - the site's box once
  - note: **"An agent made or changed them in your chat on {site}. Allow is for all of them; Not now leaves them all
    waiting."**
- AGENTS.md, after the three tiers: **"Tiers and powers, in your reply.** Pick the safest tier that does what was
  asked, with the fewest powers. Never ask the user whether moving up a tier, or adding a power, is OK: TRIF's
  approval card is that question. When a change moves a mod up a tier or adds a power, say so in half a sentence in
  your reply ("it's a boxed mod with the keys power now"). When a power is no longer needed, drop it. Ask only when
  there's a real trade-off, a safer way that does less against a riskier way that does all of it, in one line."
- Docs for agents: TECHNIQUES.md **"The quiet powers (`sound`, `controls`, `mods`, `preload`, `embeds`, `media`)
  don't make it wait on their own; a warned combination one of them makes does."**; `preload` **"(quiet: doesn't
  make the mod wait on its own)"**.

## Agents (helper/workspace/AGENTS.md, TECHNIQUES.md)

- AGENTS.md, "Write the mod", after "the user approves the set once.": **"A mod asks only for the powers it
  uses.** Don't pad its powers so it can act beside another boxed mod on the site (a click refused while another
  mod has `keys`, say): the user approves what a site's boxed mods can do together, once per site (TRIF asks on
  the hold of the mod that adds a power: "Your <site> mods together"), which covers coexistence; unused powers
  only put warnings on the hold for things it can't do. If a converted mod's header asks for powers its code never
  uses, take them out."
- TECHNIQUES.md, "Combinations": "…(the error says which), **until the user approves what the site's boxed mods
  can do together: TRIF asks on the hold of the mod that adds a power ("Your <site> mods together", what it adds
  marked new), once per site. Never ask for a power your mod doesn't use** just to act beside another mod: that
  puts warnings on its hold for things it can't do. A mod that uses both asks for both."

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
