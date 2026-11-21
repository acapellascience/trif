# Mods that break: the new strings (branch powers)

Every user- and agent-facing string for error flags, "Want me to fix it?", quiet breakage, automatic
fixes and Undo fix, exact. **Approved by Tim, 2026-11-11.**

## How it works (decisions to check)

- An error's fingerprint: the mod, the line in its file, and the message without numbers and quoted parts
  (extension/modhealth.js). Kept per mod and per version (its hash): a fixed or changed mod starts fresh.
- TRIF reads a page's mod errors (page scripts' and the sandbox's, as `trif errors` does), their logs, and
  whether what each mod looks for is there: 3 and 9 seconds after a page of a site TRIF is on for loads, and
  every 10 seconds while a side panel is open on it. Nothing new runs in the page for this.
- "May be broken": a style mod's selectors (its rules), a boxed mod's `trif.observe` and `trif.hide`, a
  free mod's `trif.expect`: none on a page (its address without the query) on 3 loads in a row, where they
  were before. Counted once per load, at the 9-second look.
- (11-20, with Tim) **Comes and goes**: on a page where what a mod looks for went away and came back (2 or more
  loads in a row with nothing, or a raised flag, then a match), or one a fix run found nothing broken on
  (`trif not-broken`), it comes and goes: no "may be broken" there again for that version of the mod (a new
  version starts fresh). Kept in `modHealth` with the page (`pages[page].comesAndGoes`), trimmed with it.
- (11-20) **Hide-only mods wait longer**: a mod that only hides things is flagged after 10 loads in a row
  with nothing, spanning at least 3 days (others: 3 loads). Hide-only: a style mod with a hide list and no
  filter or replace, whose CSS rules (if any) only set `display: none` (as the hide list does; any other
  declaration, `visibility`/`opacity`/sizes included, makes it not hide-only: helper/lib/rules.js hidesOnly);
  a boxed mod that only ever called `trif.hide` (not `observe`/`changes`). A free mod's `trif.expect`: 3 loads.
- The toolbar icon gets a red **!** on a tab where a running mod has a new error (title below). The tab
  itself isn't marked: an extension can't change a tab's title or icon without changing the page.
- A card per new fingerprint, once; Ignore is for that fingerprint and that version.
- "Fix it automatically": only on sites at Run code or Ask (never Off or Look), once per fingerprint,
  only when the site's chat isn't already running something (then it's the usual card); one agent run
  per new error, which is the cost.
- Undo fix: a run started by Fix it (or by itself) that changed its mod: the card and the mod's row offer
  Undo fix (TRIF's history, as "Undo these changes"), while the mod is that version, for 7 days. If the
  fixed version has a new error in its first 3 loads, the new card leads with Undo fix.

## The mod's row

- The badge: **error** · **{n} errors** · **may be broken**; its title: **New error at line {n}: {message}**
  (no line: **New error: {message}**) · **May be broken: nothing it looks for is on the page any more.**
  Clicking it opens the code card at that line.
- **Undo fix**; its title: **Put back the version from before your agent fixed it**

## The chat's card

- **{Mod name} has a new error on {site}. Want me to fix it?**
- **{Mod name} may be broken on {site}: nothing it looks for is on the page any more. Want me to fix it?**
- After a fix: **{Mod name}'s fix has a new error on {site}. Undo the fix, or want me to try again?** ·
  **{Mod name}'s fix may not work on {site}. Undo the fix, or want me to try again?**
- Buttons: **Fix it** · **Show error** · **Ignore** (title: **Don't flag this again for this version of the
  mod**); after a fix: **Undo fix** · **Try again** · **Show error** · **Ignore**; once fixed: **Undo fix**
- Its state, after: **Fixing…** · **Fixed.** · **Ignored.** · **Fix undone.** · (APPROVED by Tim, 11-20)
  **Not broken.** (a fix run found nothing broken and said so with `trif not-broken`; no buttons after it)
- If a button fails: **Couldn't do that: {why}** · **Couldn't undo the fix: {why}**
- Fix it automatically, before the run: **{Mod name} has a new error on {site}: TRIF asked your agent to fix
  it (Settings: When a mod breaks, Fix it automatically).** (or **may be broken on {site}: …**)

## The code card (Show error)

- Above the code, in red: **New error at line {n}: {message}** · **May be broken: nothing it looks for is
  on the page any more.**; the line is marked and scrolled to.

## Settings

- **When a mod breaks**, **Then**: **Ask me** · **Fix it automatically** · **Just flag it**
- **Ask me: a message in the chat offers to fix it. Fix it automatically: your agent tries to fix it (on
  sites where it can run code), and tells you in the chat. Just flag it: the mod's row says so, nothing
  more.**

## Toolbar

- Badge **!**; title **TRIF: a mod here has a new error** · **TRIF: {n} new mod errors here**

## The fix run's message (what the agent is asked, as the user's message in the chat)

- **My mod "{name}" ({id}, the file sites/{id}.js) has a new error on {url}, at line {n}:** then the message
  and stack in a code block, then **Fix the mod so it works with the page as it is now, doing the same thing
  as before. Look at the page first (trif text, trif screenshot) if that helps you see what changed.** and
  **Its recent logs:** with up to 8 lines.
- May be broken: **TRIF thinks my mod "{name}" ({id}, the file sites/{id}.js) may be broken on {url}:
  nothing it looks for is on the page any more, though it was on earlier loads. The site has probably
  changed how this part of the page is built. Look at the page as it is now (trif text, trif screenshot,
  trif sweep), find what the mod should act on, and update the mod so it works again, doing the same thing
  as before.**
  Then (11-20, agent wording, Claude's): **If nothing is broken (the mod still fits how the site builds that part,
  and the site just didn't show it this time: some parts of a page, like promos, come and go), don't change
  the mod. Run `trif not-broken {id} {page}` so TRIF stops flagging it there, and tell me what you found.**

## CLI (trif status, trif mods)

- **NEW ERROR at line {n}: {message}** · **NEW ERRORS ({n}) at line {n}: {message}** · **MAY BE BROKEN:
  nothing it looks for is on the page any more**, then **(trif errors --tab <id> for the details; the user
  can ignore it in the side panel)**

## For mod authors (TECHNIQUES.md)

- `window.trif?.expect(selector)`, with the paragraph in "Free mods".
