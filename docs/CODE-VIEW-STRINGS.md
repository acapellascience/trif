# The code card and Show in Finder: the new strings (branch powers)

**Approved by Tim, 2026-11-10.**

Every user-facing string the code viewer adds, exact, **all awaiting Tim's OK**.

## The mod row

- The `</>` icon button, beside delete on every row (style, boxed and free mods, held ones too): its title
  and label **Show code**
- The file name after the mod's name is now a link (a button) to the same card: its title **Show the code**

## The code card (the approval card's look)

- Top line: **Code**; the × is labelled **Close**
- Then the mod's name, its kind chip (**Style mod** · **Boxed mod** · **Free mod**), and **{site} · {file}**;
  the file name is a link there too: **Show in Finder** (Mac) / **Show in folder** (elsewhere); with the
  helper away: **TRIF's helper isn't connected, so it can't open the file**
- A mod with a change waiting: two buttons for which version, **Running now** · **Waiting for your OK**
  (group label **Version**)
- The code, with line numbers and light colouring (no library); its label **The mod's code**
- Under it, when it applies: **Showing the first 200,000 characters.** · **From the browser: TRIF's helper
  isn't connected.** (a free or boxed mod's code from the extension when the helper is away)
- Buttons: **Copy** (then **Copied** or **Couldn't copy** for a moment) · **Show in Finder** / **Show in
  folder** · **Open in editor** · **Close**
- With the helper away, Show in Finder and Open in editor are disabled, titled **TRIF's helper isn't
  connected, so it can't open the file**
- A style mod's code with the helper away: **TRIF's helper isn't connected, so a style mod's rules can't be
  shown**

## The mod row, reworked (branch faces, 2026-11-11; **new strings awaiting Tim's OK**)

Each row: the light, the name, one chip when there's something to say, one line of description (ellipsis,
all of it in the tooltip), at most one tag, and the switch, `</>` and bin. The mapping is
`extension/modlevel.js`: a boxed mod's level comes from its powers (`rewrite-requests` changes requests;
`block-events`, `site-data`, `click`, `write-drafts`, `media` noticeable; any other power nothing), a free or
style mod's from `@risk`, raised to noticeable if TRIF read that its code sends requests or acts for you.

- The chip: **{N} power(s)** · **noticeable** · **changes requests**, joined by " · ". Muted for noticeable
  only, green for powers, amber for a combination warning or changed requests. A click opens the code card.
- Its hover: each power's words (**{power} {what it can do}**, the approval card's), the combination
  warnings, then **Noticeable: {site} could tell something's different.** (with **(what it sends isn't all
  shown)** for `site-data`) or **Changes requests: this mod changes what {site} receives, which it could
  notice (rate limits or an account flag are possible).**, each followed by the mod's own `@risk` reason.
- Tags, one at a time, most urgent first: **on hold** / **change on hold**, **error** / **{N} errors** / **may
  be broken**, **new**, **updated**, **update available** (new; its title **Version {n}: see what you can do**
  or **See what you can do**; a click opens the update notice).
- Removed from the row: the file name, **Tim's mod, v{n}**, **detectable**, **Powers: …**, **all sites** /
  **{N} sites**, **not active**, **paused**, **from {browser}**.
- The code card's header now has: the file (a link), **Tim's mod, v{n}**, and lines for the level (as the
  hover), **Power: {power} {what it can do}**, the combination warnings, **Runs on every site.** / **Runs on
  {sites}.**, **Made from {browser}.**, **Not active right now.** / **Paused: user scripts are off.**

## Added on branch faces (2026-11-11; **awaiting Tim's OK**)

- The code card's ⋯ menu: **Wrap lines** (a checkbox item, ticked by default, remembered in this browser).
  Long lines wrap, one line number per source line, continuations indented to the line's own indentation;
  the same in History's versions and their differences.
- The code card's robot has its own face, **</>** for eyes (no words).
- Moving to a tab of another site closes the code card (and History), the import's questions, and the
  menus; an approval waiting there hides and shows again back on its site (no words).

## The approval card

- Its **{site} · {file}** line: the file name is a link to the code card (over the approval card), titled
  **Show the code**

## Errors (from the helper, shown in the card)

- **no mod {id}** · **"{id}" isn't a mod id TRIF opens files for** · **{id}'s file isn't where TRIF keeps
  mods ({site}/{mod}.js in the sites folder), so TRIF won't open it** · **{id}'s file isn't there any more** ·
  **TRIF doesn't know how to open folders on {platform}** · **{id} has no earlier version that ran**

## CLI

- `trif reveal <site>/<mod> [--editor]`: **showed {site}/{mod}.js in Finder** (elsewhere: **in its
  folder**) · **opened {site}/{mod}.js**; help: **show a mod's file in Finder (its folder elsewhere), or with
  --editor open it in the system's app for .js; refused inside a run**
