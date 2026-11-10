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
