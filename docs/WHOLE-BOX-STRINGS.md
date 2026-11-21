# TRIF's full sandbox: words people see (drafts)

**All drafts, for Tim to approve** (branch `whole-box`; docs/WHOLE-BOX-PROGRESS.md). Agent-only text
(logs, CLI errors for agents) isn't listed.

## Settings (side panel)

- Label: **Run chats in TRIF's full sandbox** (off by default; step 1b)
- Its line (draft): **The whole chat, not only its commands, runs inside TRIF's own sandbox, with a copy of
  Claude Code TRIF has tested. Your own Claude Code isn't changed.**

## When a chat can't start in it (side panel, the run's error)

In code now (helper/lib/runs.js):

- TRIF's copy not downloaded yet: **TRIF's own copy of Claude Code isn't downloaded yet, so this chat can't
  run in TRIF's full sandbox.**
- TRIF's copy changed or unreadable: **TRIF's own copy of Claude Code wasn't started: {why}.** where {why}
  is one of: **it has changed since it was downloaded** · **its record .trif-claude-code.json is missing**
  · **it can't be read ({code})**
- Checking it failed: **couldn't check TRIF's own copy of Claude Code: {error}**

The offer that follows these (step 4, "Run this chat with the older protection"): not written yet.
