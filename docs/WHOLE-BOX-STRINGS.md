# TRIF's full sandbox: words people see (drafts)

**All drafts, for Tim to approve** (branch `whole-box`; docs/WHOLE-BOX-PROGRESS.md). Agent-only text
(logs, CLI errors for agents) isn't listed.

## Settings (side panel)

In code now (extension/sidepanel.html, sidepanel.js renderWholeBox; shown only on a Mac for now):

- Label: **Run chats in TRIF's full sandbox** (off by default)
- Its line, off: **The whole chat, not only its commands, runs inside TRIF's own sandbox, with a copy of
  Claude Code TRIF has tested. Your own Claude Code isn't changed.**
- Switched on, while TRIF's copy downloads (about 160 MB): **Downloading TRIF's copy of Claude Code
  {version}: {got} of {total} MB…** (without a size from the server: **…: {got} MB…**; before the first
  bytes: **Downloading TRIF's copy of Claude Code {version}…**)
- On, the copy there: **On for chats with Claude Code: they use TRIF's copy of Claude Code ({version}). Your
  own Claude Code isn't changed.**
- The download failed: **Couldn't download TRIF's copy of Claude Code: {error}. Chats can't run in TRIF's
  full sandbox until it's there.** with a **Try again** button. ({error} is claudepin.js's message, e.g.
  "https://registry.npmjs.org/… answered HTTP 503", "the download of Claude Code 2.1.330 (darwin-arm64)
  doesn't match its pinned checksum; not using it": agent-ish; Tim may want plainer ones.)
- The switch itself failed: **Couldn't change it: {error}** (as the other switches say).

## When a chat can't start in it (side panel, the run's error)

In code now (helper/lib/runs.js):

- TRIF's copy not downloaded yet: **TRIF's own copy of Claude Code isn't downloaded yet, so this chat can't
  run in TRIF's full sandbox.**
- Still downloading: **TRIF's own copy of Claude Code is still downloading (Settings shows how far), so this
  chat can't run in TRIF's full sandbox yet.**
- TRIF's copy changed or unreadable: **TRIF's own copy of Claude Code wasn't started: {why}.** where {why}
  is one of: **it has changed since it was downloaded** · **its record .trif-claude-code.json is missing**
  · **it can't be read ({code})**
- Checking it failed: **couldn't check TRIF's own copy of Claude Code: {error}**

The offer that follows these (step 4, "Run this chat with the older protection"): not written yet.
