# Organization settings: new strings (0.2.6)

**Status: AWAITING TIM'S OK.** Drafts as built on `release-0.2.6`. Nothing here is final until Tim says so.

When an organization's managed settings replace TRIF's sandbox (Codex's requirements refuse TRIF's
permission profile, or Claude Code's managed settings loosen its limits), TRIF stops the run and asks.
`{Agent}` is "Codex" (the Codex and the open-model agents) or "Claude Code".

No message names another agent (Tim, 0.2.6: the list keeps growing): they say "another agent". The open-model
agent (Codex with an open model) gets no "personal Codex login" part: open models don't use one.

## The choice card (in the chat)

Where: `extension/sidepanel.js` `sandboxCardText`.

| | Codex | Claude Code |
|---|---|---|
| Title | Your organization’s Codex settings replace TRIF’s sandbox. | Your organization’s Claude Code settings replace TRIF’s sandbox. |
| Text | Codex would run under your company’s settings instead of TRIF’s sandbox. Those settings may let it do more than TRIF allows, or less (some companies’ settings stop it writing mods or reaching TRIF, and then chats can’t work). A personal Codex login, or another agent, works with TRIF’s sandbox. | Claude Code would run under your company’s settings instead of TRIF’s sandbox. Those settings may let it do more than TRIF allows, or less (some companies’ settings stop it writing mods or reaching TRIF, and then chats can’t work). A personal Claude Code login, or another agent, works with TRIF’s sandbox. |
| Text, open model (via Codex) | Codex would run under your company’s settings instead of TRIF’s sandbox. Those settings may let it do more than TRIF allows, or less (some companies’ settings stop it writing mods or reaching TRIF, and then chats can’t work). Another agent works with TRIF’s sandbox. | – |
| What they change (Claude Code only, from the list below) | – | Your company’s settings {phrase}, {phrase} and {phrase}. |
| Buttons | **Stop** · **Use Codex anyway** | **Stop** · **Use Claude Code anyway** |
| After Stop | Stopped. Nothing was changed. | same |
| After Use … anyway | Allowed: TRIF sent your message again. | same |
| While a chat is running | Wait for the chat to finish, then try again. | same |

The first draft's sentence "The tab lock and the holds on mods still protect you either way." was replaced
by the text above (the coordinator's rewording after the CodexStandard report). Say if it should come back.

## The chip (beside "agent · model", over the message box)

Where: `extension/sidepanel.html` `#no-sandbox`, `sidepanel.js` `renderNoSandbox`.

- Chip: **no TRIF sandbox**
- Tooltip: Your organization’s {Agent} settings apply instead of TRIF’s sandbox. Settings → Agents to change this.

## Settings (under the agent choice)

Where: `sidepanel.js` `renderWithoutSandbox`. Shown only for agents with consent stored. Uses the agent's own
name ("Codex", "Claude Code", "Open model (via Codex)").

- {Agent name} without TRIF’s sandbox: allowed **Stop allowing**

## Errors and stop messages

Shown in the chat (as an error) and by `trif agent run` in a terminal.

**Stopped, no consent yet** (`trif agent run`, and panels older than 0.2.6, which show it instead of the card):
- Codex (`codex.js sandboxOverriddenMessage`): Your organization's Codex settings replace TRIF's sandbox, so
  TRIF stopped the run before Codex did anything. To let Codex work under your company's settings instead,
  choose “Use Codex anyway” in TRIF's side panel. A personal Codex login, or another agent, works with TRIF's
  sandbox. (Codex said: {Codex's line})
- Open model (via Codex): the same, ending "… in TRIF's side panel. Another agent works with TRIF's sandbox.
  (Codex said: {Codex's line})"
- Claude Code (`claude.js withoutSandboxMessage`): Your organization's Claude Code settings {phrases}, which
  replaces TRIF's sandbox, so TRIF stopped the run before Claude Code started. To let Claude Code work under
  your company's settings instead, choose “Use Claude Code anyway” in TRIF's side panel. A personal Claude Code
  login, or another agent, works with TRIF's sandbox.

**Allowed, but the organization's settings stop the run's work** (once per run; `orgBlockedMessage`):
- Codex: Your company's Codex settings don't let Codex write mods or reach TRIF from the side panel, so chats
  can't work with this login. Use a personal Codex login, try another agent, or work with Codex in a terminal
  in ~/.trif.
- Open model (via Codex): Your company's Codex settings don't let Codex write mods or reach TRIF from the side
  panel, so chats can't work with them. Try another agent, or work with Codex in a terminal in ~/.trif.
- Claude Code: Your company's Claude Code settings don't let Claude Code write mods or reach TRIF from the
  side panel, so chats can't work with them. Use a personal Claude Code login, try another agent, or work with
  Claude Code in a terminal in ~/.trif.

**Claude Code settings that only break runs** (no card, no consent; `claude.js brokenMessage`):
- Your organization's Claude Code settings {breaking phrase}, so chats with Claude Code can't work in TRIF's
  side panel. Try another agent, or work with Claude Code in a terminal in ~/.trif.

**Refusals** (not normally seen):
- From anywhere but the panel (the helper's socket, a run): only a click in TRIF's side panel can change
  this (Settings, under the agent)
- From another page of the extension: only the side panel can change this

## Claude Code phrases (`agents/claude-managed.js effects`)

Each follows "Your organization's Claude Code settings …" / "Your company's settings …".

Loosen TRIF's limits (card):
- turn Claude Code’s sandbox off
- turn off the sandbox’s limits on files
- let commands run without the sandbox when it can’t start *(Linux only)*
- let commands run again outside the sandbox
- run `trif`, `ls` outside the sandbox
- let Claude Code run any command in the sandbox, not only TRIF’s
- let commands reach github.com on the network / let commands reach 3 websites on the network
- let commands use connections on this computer
- let commands write more folders
- let commands read more folders
- allow `Bash`, `Read(//Users/**)` and 2 more without asking
- let Claude Code’s file tools into more folders
- approve Claude Code’s actions by themselves (bypassPermissions mode)

Only break runs (stop message):
- ignore every permission rule but theirs, TRIF’s too, so Claude Code can’t run `trif` or write this site’s mods
- keep Claude Code in plan mode, where it can’t write mods
- ignore what TRIF lets commands read, so `trif` can’t run

## CHANGELOG (Unreleased)

- **Codex at work:** if your organization's Codex settings won't let TRIF use its sandbox, TRIF asks before
  going on without it.

As drafted it names Codex only; Claude Code under managed settings now gets the same choice. A possible
wider line: "**Codex and Claude Code at work:** if your organization's settings won't let TRIF use its
sandbox, TRIF asks before going on without it."
