# Mods start off: the new strings (branch powers)

**All awaiting Tim's OK.** Tim's three asks of 2026-11-11: his shipped mods start off for new users; the
"New mods start" setting is gone (mods from outside the chat always start off); and one setting is left,
for the mods the side panel's chat makes.

## Settings (side panel)

The "New mods start" section and its three rows (Style mods, Boxed mods, Free mods: On · Off) and its note
("Mods your chat here makes still start on.") are removed. In their place, one row:

- Label: **Mods your chat makes**
- Choices: **Start on** (the default) · **Wait for me**
- Its line under it: **Start on: what the chat makes or changes runs at once, so you see it working. Wait
  for me: it's saved, but runs only when you turn it on (a change waits too, and the version before keeps
  running).**

## The mod's row (side panel)

The tag, as before: **new** · **updated** (Tim's update), and new: **changed** (a chat change waiting).
Their tooltips:

- new: **TRIF switched it off because it came from outside your chat: switch it on once you've looked at it.**
  (was: "New {kind} start off (Settings): switch it on once you've looked at it.")
- updated: **TRIF updated it and switched it off: switch it on once you've looked at it.**
- new, from the chat with Wait for me: **Your chat made it, and waits for you (Settings): switch it on once
  you've looked at it.**
- changed: **Your chat changed it, and waits for you (Settings): the version before runs until you turn this
  one on.**

## The chat's result card

With Wait for me, after the "Changed {file}." line, for each: **{file} waits for you.** with two buttons,
**Show code** and **Turn on**; after Turn on, the words **It's on.** If it can't: **Couldn't turn it on: {why}**

## The setup page (Tim's mods step)

- The note under the list, was "Each mod has its own switch in the TRIF {panel}: you can turn any of them
  off individually, any time. You can add the others later, in the panel's Settings." Now: **Tim's mods are
  added switched off: turn on the ones you want in the TRIF {panel}, each with its own switch. You can add
  the other sites' later, in the panel's Settings.**

## Settings, Tim's mods

- The note under the list now starts: **They're added switched off: turn on the ones you want.** (then, as
  before, "Plain JavaScript you can read: see the code.")

## trif setup --help

- was "Tim's mods (the mods TRIF ships, for {sites}; some on, some off)", now **"Tim's mods (the mods TRIF
  ships, for {sites}; each starts off)"**.

## CLI

- `trif status`: the `NEW MODS` line ("new {kinds} start off in this browser (the user's setting, …)") is
  removed. New, when the chat's setting is Wait for me: **CHAT MODS     wait for the user: what the side
  panel's chat makes or changes runs only once they turn it on**.
- `trif status`, a mod's state, was "off (new: waiting for the user to look at it)" / "off (updated by TRIF:
  …)": now also **off (changed by the chat: the version before runs until the user turns this one on)**.
- `trif status`'s key, was "off (new) = new mods of its kind start off in this browser (the user's setting);
  …": now **off (new) = it came from outside the chat, so it started off; only the user switches it on, in
  the side panel or trif enable <id> in their terminal**.
- `trif mods`: was "off: new, and new mods of its kind start off in this browser (the user's setting); not
  running until …": now **off: it came from outside the chat (or TRIF updated it), so it started off; not
  running until the user switches it on after looking at it (side panel, or trif enable {id} in their
  terminal)**.

## For an agent run

- `mod.enable` refused, was "{id} is new and switched off until the user looks at it (their setting: new {kind}
  start off); only the user can switch it on, …": now **{id} is switched off until the user looks at it; only
  the user can switch it on, in the side panel or with trif enable in their terminal**.
- AGENTS.md, the bullet about mods starting off, rewritten to say it's always so, and "Wait for me".

## CHANGELOG (Unreleased)

- Summary point, exactly: **Mods from outside your chat start off**, Tim's too, until you've looked at them.
- Under More: **Mods from outside your chat start off**, marked "new" or "updated", until you switch them on:
  a terminal agent's, a file's, another browser's, TRIF's updates, Tim's mods too. What your chat makes
  starts on, or waits: Settings, "Mods your chat makes".

SITES_ON (for the coordinator): kept. With per-site access TRIF still needs the browser's permission on those
sites, and being on there only means the panel shows their mods' switches; it runs nothing, as every mod
starts off.
