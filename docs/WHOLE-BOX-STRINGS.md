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

- An organization forces Claude Code's own sandbox on (it can't start inside TRIF's box, so the chat runs
  with no shell and the `trif` tool) **and** its settings take that tool away (round 4, claude.js
  `noShellBrokenMessage`): **Your organization's Claude Code settings require Claude Code's own sandbox,
  which can't start inside TRIF's full sandbox, and {what}, which would take its place, so this chat can't
  run in TRIF's full sandbox. Turning off “Run chats in TRIF's full sandbox” in Settings runs chats with
  TRIF's usual protection.** where {what} is **allow only the MCP servers they name, which leaves out
  TRIF's `trif` tool** · **deny TRIF's `trif` tool** (claude-managed.js `mcpBlocks`).

- An organization's settings let runs use any command (so in the box the chat runs with the `trif` tool,
  no shell: step 7a) **and** take that tool away (round 5, the same `noShellBrokenMessage`): **Your
  organization's Claude Code settings let Claude Code run any command, so in TRIF's full sandbox this chat
  gets TRIF's `trif` tool in place of a shell, but they also {what}, so this chat can't run in TRIF's full
  sandbox. Turning off “Run chats in TRIF's full sandbox” in Settings runs chats with TRIF's usual
  protection.** ({what} as above.)

Not shown (round 5, Tim 11-21): in TRIF's full sandbox, settings that only loosen Claude Code's rules show
nothing: no "Use Claude Code anyway" card, no "no TRIF sandbox" chip.

The offer that follows these (step 4, "Run this chat with the older protection"): not written yet.

Not shown to people (round 4): a chat that runs with no shell says nothing in the panel; its steps read
as they do with a shell ("trif status"). The agent is told (agents/index.js `noShellText`, agent-only).


## Signing in for TRIF's full sandbox (step 6, `claude setup-token`)

In code now (helper/lib/logins.js, mode "token"):

- TRIF's copy not there: **TRIF's own copy of Claude Code isn't downloaded yet (Settings: Run chats in
  TRIF's full sandbox)**
- Failed: **Signing in to Claude Code for TRIF's full sandbox failed: {last lines it printed}** (any
  sk-ant-… in them shown as [token])
- A code it didn't take (round 3): **Signing in to Claude Code for TRIF's full sandbox failed: OAuth error:
  That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in
  attempt. Sign in again to get a new code.** (Claude Code's own words after "failed: "; the panel then
  offers Try again, a fresh sign-in)
- Finished without a token: **Claude Code finished, but TRIF didn't find a sign-in token in what it printed.**
- The keyring refused it: **Signed in, but TRIF couldn't keep the sign-in: {keyring's error}**
- The saved one isn't a token (someone changed the keyring item): **the saved Claude Code sign-in isn't a
  token TRIF recognizes; sign in again**

### The panel (round 3: extension/login.js, sidepanel.js; the setting on, chats with Claude Code)

The login notice, in place of "Claude Code isn't logged in" (the user's own login can't be used in the box):

- Title: **Sign in to Claude Code for TRIF's full sandbox**
- Line: **Chats in TRIF's full sandbox can't use your own Claude Code login. Sign in once with your account;
  TRIF keeps the sign-in in your Mac's Keychain.**
- Button: **Sign in** (beside it, as now: Switch to {agent} · Use robotless)
- After a run's token was refused: title **Sign in to Claude Code again for TRIF's full sandbox**, line
  **Claude Code refused the sign-in TRIF kept (it may have expired, or been signed out elsewhere).**
- The gate's one-line version: **Claude Code needs you to sign in for TRIF's full sandbox. Sign in**
- While signing in: **Signing in to Claude Code for TRIF's full sandbox…** / **Signing in to Claude Code
  for TRIF's full sandbox** (then the same "Finish signing in in the tab that opened, then paste the code it
  shows here:", "Checking the code…" as the normal login)
- Done: **Signed in** · **Chats in TRIF's full sandbox can use Claude Code now.**
- Failed: **Couldn't sign in to Claude Code for TRIF's full sandbox** · {the error above} · **Try again**

The run's messages (helper/lib/claudetoken.js, runs.js), shown as the chat's login line:

- No API key, no token: **Chats in TRIF's full sandbox need you to sign in to Claude Code for TRIF first.**
- The keyring couldn't be read: **TRIF's full sandbox couldn't read your Claude Code sign-in ({why}): sign
  in again.**
- Anthropic refused the token: **Claude Code refused TRIF's full sandbox sign-in (it may have expired, or been
  signed out elsewhere): sign in again.**

Settings, under the switch (on), one line:

- **Its chats use your saved Anthropic API key.** (a key is saved: it wins, as now)
- **Signed in to Claude Code for TRIF's full sandbox (kept in your Mac's Keychain).** + button **Sign out**
- **Claude Code refused TRIF's sign-in: sign in again from a chat.** + **Sign out**
- **Not signed in yet: a chat will ask you to sign in.**

Not said anywhere yet (Tim's call whether to): that the token lasts a year and can only make model
requests (no Remote Control, no claude.ai connectors), and that it needs a Pro, Max, Team or Enterprise plan.
