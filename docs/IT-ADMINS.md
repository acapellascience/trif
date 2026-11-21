# TRIF's full sandbox: for IT administrators

*Draft (branch whole-box, round 7): Tim approves these words before anyone outside sees them.*

TRIF (Tim's Robot Internet Fixer) is a browser extension and a small helper program. Its side-panel chat runs
Claude Code to write changes ("mods") for the website the person is on. This page covers the opt-in Settings
switch **Run chats in TRIF's full sandbox** (macOS for now). It says what the box does, what it lets through,
and how your organization's Claude Code policies apply inside it.

## What the box is

With the switch on, every chat's Claude Code process, and everything it starts (its shell commands, your
hooks, MCP servers), runs inside a macOS sandbox profile TRIF writes for that run (`sandbox-exec`, Seatbelt).
The box denies by default:

- **Files.** It can read system folders (`/usr`, `/System`, `/opt/homebrew`, `/usr/local`…), a copy of the
  person's TRIF workspace made for the run, and the run's own folders. It can write only the folder of the
  site being changed and the run's temporary folders. The real workspace, the home folder, the keychain
  files and TRIF's private folder (`~/Library/Application Support/TRIF`) are out of reach.
- **Your policy files.** `/Library/Application Support/ClaudeCode` (managed-settings.json, the drop-in folder
  and the scripts in it), `/etc/claude-code` and Claude Code's MDM profile
  (`/Library/Managed Preferences/…/com.anthropic.claudecode.plist`) stay readable, so Claude Code loads your
  policies as it always does.
- **The network.** It can make no connection except to a few ports on this computer:
  - TRIF's API-key proxy, if the person saved an API key;
  - **TRIF's network relay** (an HTTP proxy, `HTTPS_PROXY`). The relay only accepts `CONNECT`. It tunnels
    to `api.anthropic.com`, `claude.ai`, `console.anthropic.com` and `platform.claude.com` on port 443, and
    to the hosts your managed settings name (below). The relay never decrypts the traffic: Claude Code
    checks the server's certificate itself. Host names must match exactly, with no wildcards. An Anthropic
    host whose name resolves to this computer is refused;
  - ports on this computer that your managed settings name, such as a local OpenTelemetry collector.
- **Claude Code's own version.** Boxed chats use a copy of Claude Code that TRIF installs in its own
  folder, pinned to a version TRIF has tested. TRIF checks the copy against a checksum and Anthropic's code
  signature. The person's own Claude Code is not used for boxed chats and keeps updating as usual.
- **Sign-in.** Boxed chats use a long-lived token from `claude setup-token`, kept in the macOS Keychain, or
  an API key through TRIF's key proxy. The person's own Claude Code login is never read.

## Your managed settings inside the box

Claude Code applies your managed settings inside the box exactly as it does outside. The box is a second
fence around them:

| Your settings | In TRIF's full sandbox |
|---|---|
| Restrict: deny rules, MCP allow/deny lists, forced login method, plan mode, `allowManagedPermissionRulesOnly` | applied by Claude Code. If they leave TRIF's chat unable to work (plan mode, only your rules, TRIF's `trif` tool denied), the chat stops and says which setting did it |
| Loosen: allow rules, `bypassPermissions`, Claude Code's sandbox off, extra folders | can't reach past the box. Chats aren't stopped to ask about them; they're noted in the run's log. If they allow any command, the chat gets TRIF's `trif` tool in place of a shell |
| Force Claude Code's own sandbox on | it can't start inside another sandbox, so the chat has no shell and uses TRIF's `trif` tool (an MCP server) instead |
| **Hooks** (`hooks`) | run inside the box, as children of Claude Code. Command hooks can read what the box allows (your scripts in the paths they name too) and write only the run's folders. HTTP hooks (`type: "http"`) go to the URL you named, through the relay, if it's `https` |
| **Telemetry** (`env`: `OTEL_EXPORTER_OTLP_*ENDPOINT`) | `https` endpoints go through the relay, that host and port only. Endpoints on this computer (`http://127.0.0.1:4318`, `localhost`) are let through as that port |
| An LLM gateway or cloud endpoint (`env`: `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_FOUNDRY_BASE_URL`) | `https`: through the relay, that host and port only |
| Plain `http://` to another computer, or a proxy of your own in `env` (`HTTPS_PROXY`…) | **not let through.** The relay only carries `CONNECT` tunnels, and a proxy you name takes the relay's place, which the box refuses. The run's log notes them; a chat that fails because of it says which connection was refused |

TRIF only reads your settings, to know which hosts to allow and when a chat can't work. It never changes
them.

## What you can see

- **Each run's log**: `~/Library/Application Support/TRIF/runs/<run>.jsonl`. It records the run's lines
  `orgSettings` (what your settings loosen), `orgNetwork` (the hosts, ports and scripts allowed for them,
  and what couldn't be allowed), `noShell` (why the chat had no shell) and `boxRefused` (what the box
  refused: Seatbelt's reports and the relay's refusals).
- **The helper's log**: `~/Library/Application Support/TRIF/helper.log`.
- **The chat**: a chat that fails after the box refused something says what was refused, for example
  "TRIF's full sandbox refused a connection to otel.example.com:4318."
- **The network**: the relay connects from this computer to Anthropic's hosts and to yours, port 443 or the
  port you named, with the TLS session from Claude Code inside. If your network inspects TLS, Claude Code
  must trust your certificate, as it does outside the box.

## What you can control

- Your managed settings, as above. Hooks and telemetry keep working inside the box over `https`, or to a
  collector on the computer itself.
- The switch is the person's choice, and off by default. If the box can't start, the chat offers to run
  with TRIF's older protection, but only when the person chooses it, never by itself.
- **Not yet:** a managed setting to require TRIF's full sandbox, or to forbid it. Windows (in progress).
  `apiKeyHelper` and cloud-provider credentials (Bedrock, Vertex) that need files outside the box. Plain
  `http` collectors on other computers. If you need one of these, tell us.
