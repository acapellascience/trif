# WebMods privacy policy

Last updated: October 29, 2026

WebMods is a Chrome extension that runs website customizations ("mods") written by **your own coding
agent** (for example Claude Code or OpenAI Codex) on your own computer. This policy explains what the
extension does with your data. In short, **WebMods has no server, collects nothing, and sends nothing
to its developer.**

## Who handles your data

There are three parties:

1. **The WebMods extension**, running in your Chrome.
2. **The WebMods helper**, a small program you install on your computer. The extension talks only
   to the helper, through Chrome's "native messaging" channel. That channel connects programs on the
   same machine and doesn't go over the network.
3. **Your coding agent** (Claude Code, Codex…). It runs on your computer under your own account with
   its AI provider (for example Anthropic or OpenAI). The helper starts it when you send a message in
   the WebMods side panel.

The WebMods developer is none of these at run time. There is no WebMods account, server, analytics,
telemetry, crash reporting, advertising or tracking of any kind. The extension contains no code that
makes network requests to anyone.

## What the extension handles, and why

| Data | When | Where it goes |
|---|---|---|
| **Your mods** (JavaScript files, with the sites each one runs on) | Always | Read from a folder on your computer (`~/.webmods/sites/`) by the helper. The extension keeps a copy in Chrome's local extension storage so mods work before the helper connects. |
| **Tab addresses and titles** | When the side panel is open, and when your agent asks | The side panel uses them to show the mods and chat for the current site. Your agent gets them when it lists tabs or targets one. |
| **Page content**: visible text, screenshots of the visible tab, the result of scripts the agent runs on the page, and errors or log messages from mods | Only when your agent asks, while working on a request from you | Passed through the helper to your agent. |
| **Recorded network requests** (address, method, status, request body and response text) | Only on sites where you or your agent turn recording on. It's off by default. | Kept in the page's memory and cleared on every reload. Passed to your agent when it asks. These can include sensitive data such as login tokens, so turn recording on only where you need it. |
| **Your chat messages** in the side panel, and your agent's replies | When you use the side panel | Your messages go through the helper to your agent. The chat history for each site is saved in Chrome's local extension storage. |
| **Settings**: chosen agent, model name, which mods you switched off, which sites are being recorded | When you change them | Chrome's local extension storage only. |

WebMods doesn't use Chrome sync storage, cookies, or any remote storage.

## Your coding agent and its AI provider

When you ask your agent for a change, it reads the page it needs, which can include the text,
address and screenshots described above, and sends it to **its own AI provider** to do the work.
This is the same as any other time you use that agent, and it's covered by **that provider's terms
and privacy policy**, not by WebMods:

- Claude Code (Anthropic): https://www.anthropic.com/legal/privacy
- Codex (OpenAI): https://openai.com/policies/privacy-policy

The agent uses your own login or API key. WebMods never sees your credentials and receives no copy
of what is sent. Avoid asking the agent to work on pages that show information you don't want to send
to your AI provider, such as banking or medical records. The agent only reads pages while it is
working on something you asked for.

Web pages can contain text written to mislead AI agents ("prompt injection"). WebMods limits what
the agent can do: it can edit files in the WebMods folder and run WebMods commands. But those
commands can run scripts in your open tabs, so review what the agent does on sensitive sites.

## Sharing and sale

The WebMods developer doesn't receive your data, so it can't share or sell it. Data reaches a third
party (your AI provider) only when you send a request through your own agent, and only for the purpose
you asked for. It isn't used for advertising, profiling, or creditworthiness or lending.

## Keeping and deleting your data

Everything stays on your computer until you delete it:

- **Chat history:** use "New chat" in the side panel to clear a site's conversation.
- **Mods:** switch them off in the side panel, or delete the files in `~/.webmods/sites/`.
- **Everything the extension stored:** remove the extension from Chrome. That deletes its local
  storage and all registered mods.
- **Helper files** (`~/.webmods/`, including logs and the agent run records in `~/.webmods/runs/`):
  delete that folder.
- **What your agent sent to its provider:** see that provider's controls (linked above).

## Children

WebMods isn't directed at children under 13 and doesn't knowingly handle their data.

## Changes

If what WebMods does with data changes, this policy will be updated and its date changed before the
new version is published. Any change that sends data somewhere new will be described in the release
notes.

## Contact

Questions about privacy: <CONTACT EMAIL>
