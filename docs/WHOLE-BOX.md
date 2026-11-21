# The whole agent in TRIF's own box (spike, 20 November)

Tim's question: "should we see if we can just enforce our own sandbox, double-dutying the work of the Claude
Code tools? That would solve the problem we had before, where someone with an enterprise account ends up
forced into a looser box."

Short answer: **on macOS, yes, and it works today** with a real Claude Code (2.1.319 here, 2.1.330 on CI)
and every `trif` command a run uses. **On Windows, Claude Code itself runs in an AppContainer too (seen on CI), but only with an administrator's one-time step or with the whole internet open to it**: AppContainers can't reach this computer's own servers (TRIF's key proxy) without a loopback exemption, and their network capability has no host list. Codex can go in the same macOS box, with
one limit. What it costs and what it doesn't fix are below; shipping it, and which guarantees TRIF makes, are
Tim's decisions.

Branch `whole-box` (from main at 11f81b0), prototype only: nothing merged, nothing released.

## What changes

Today a side-panel run's Claude Code process runs **unsandboxed**. Only its shell commands (`trif`, `cd`,
`ls`) are inside Seatbelt, through Claude Code's own sandbox settings that TRIF passes (claude.js
`runSettings`). Its own file tools (Read, Write, Edit, Glob, Grep) are code inside that unsandboxed process,
held only by permission rules. An organization's managed settings outrank every rule TRIF passes, so TRIF
can only detect a loosening (claude-managed.js) and stop or ask ("Use Claude Code anyway").

With the whole box, the helper starts the agent itself under a Seatbelt profile of TRIF's own:

    /usr/bin/sandbox-exec -f <run>/box.sb  claude -p ...

Everything in that process and everything it starts (its file tools, its shell, `trif`, MCP servers, git)
gets the same answers from the kernel. Permission rules become a second layer, not the fence.

## macOS: feasible, seen working

`helper/lib/wholebox.js` (the profile, the wrapper, an allowlist proxy), hooked into `runs.js _spawn` behind
`TRIF_WHOLE_BOX=1` for staged Claude Code runs. Deny by default, then:

| | Allowed | Notes |
|---|---|---|
| Read | system folders (`/usr`, `/System`, `/bin`, `/private/etc`, `/opt/homebrew`…), the agent's program folder, node, TRIF's code, **the run's staged copy**, its box, screenshots and temporary folders, the run's agent folder (settings, context), the live workspace's `bin/` (the `trif` shim), and the agent's config folder | Not the home folder, not the live workspace, not the private folder. `stat` is allowed everywhere (node looks at each folder on a path); listing a folder is a read, so it isn't |
| Write | the copy's `sites/`, the box, screenshots, temporary folders, config folder | Then denied (later rules win): other sites' folders in the copy, instruction files under `sites/` (CLAUDE.md, AGENTS.md, `.claude/`…, by regex), the config folder's settings, hooks, plugins, skills, agents, commands |
| Network | TCP to given ports on this computer only | Seatbelt can't name a remote host: only `*` or `localhost`, plus a port. So the box allows exactly the key proxy's port (or an allowlist proxy's, below). No DNS: the mDNSResponder socket stays closed |
| Other | fork/exec (of what it can read), signals and process info within the box, sysctl reads, a few mach services (user lookup, notifications, log, trustd) | No Launch Services, no Apple events, no pasteboard, no securityd unless asked (see the login section). Without these, `open -a Terminal` or `osascript` can't start a program outside the box |

### What was seen (macOS 15.7.5 locally; macos-latest on CI)

- **A normal run works.** `tests/run-sandbox.test.js` (the real helper, real Claude Code, stand-in model,
  every `trif` command a run uses: status, tabs, new, check, verify, explain, errors, logs, mods, help,
  doctor, report) passes **with and without** `TRIF_WHOLE_BOX=1`, locally and on CI. Its refusals still
  hold (another site's `trif new` refused by the system, private folder and keychain checks refused).
- **The file tools are fenced by the system, whatever Claude Code is told.** `tests/whole-box.test.js`
  runs the real Claude Code with the loosest settings it has: its own sandbox off, `Read(//**)`,
  `Edit(//**)`, `Bash(*)`, `--dangerously-skip-permissions`, `bypassPermissions`, `--add-dir` on the parent
  folder. Without the box (the control) it read the stand-in ssh key, the live workspace's mod, the
  private folder's config, and grep'd and `cat`'d them all. In the box, the same run:
  - Read of its own mod in the copy: ok. Write of a new mod for its site: ok.
  - Read of the ssh key, the live mod, `config.json`: `EPERM: operation not permitted`.
  - Grep and Glob of the home folder: "Refusing to search …: it could not be opened (EPERM)".
  - Write into another site's folder in the copy, and into the live mods folder: `EPERM`.
  - `cat` of the key through its shell: "Operation not permitted"; `curl https://example.com`: no network.
- **With real managed settings** (on the CI runner, written with sudo to
  `/Library/Application Support/ClaudeCode/managed-settings.json`, never on anyone's computer): see
  [Enterprise](#enterprise-what-managed-settings-can-still-do).
- A node program in the box (`tests/whole-box.test.js`, test 4) got the same answers for 30 attempts:
  the copy, own site, box and config folder yes; home folder, real home, live workspace (mods and `bin/`),
  private folder, other site, guide, instruction files, config settings, `/tmp`: `EPERM`; another port on
  this computer and 1.1.1.1: `EPERM`; a name lookup: failed; `security list-keychains`: refused; a nested
  `sandbox-exec`: `sandbox_apply: Operation not permitted`.

### What it needs, and what broke on the way

- **Claude Code's own command sandbox has to be off inside.** macOS refuses to apply a second sandbox
  to a sandboxed process (`sandbox_apply: Operation not permitted`, seen even with an outer
  `(allow default)` profile). So in the box, `runSettings` passes `sandbox.enabled: false` and TRIF's box
  is the commands' fence too. Same reads and writes as before for commands; the network for commands now
  includes the key proxy's port (spending on the user's key, never reading it).
- **Its temporary folder.** Without `CLAUDE_CODE_TMPDIR`, Claude Code wants `/tmp/claude-<uid>`, which every
  Claude Code session on the computer shares; the box refuses it and Claude Code exits ("EPERM … open
  '/tmp/claude-501'"). TRIF already sets the run's own (runs.js `agentTmp`), so runs are fine; it's a
  check that now fails closed.
- **The run's agent folder** (its `--settings` file and context) must be readable, and the `trif` shim in
  the live workspace's `bin/` (on the run's PATH). Both found by the first runs; both read-only.
- **Config folder.** The user's `~/.claude` can't be opened to the box: it holds every past session's
  transcript, `settings.json` (hooks there run in the user's next terminal session, outside any box) and,
  on Linux and Windows, `.credentials.json`. The prototype gives Claude Code a config folder of TRIF's own
  (`CLAUDE_CONFIG_DIR=<private>/agent-config/claude`), read-write, its settings, hooks, plugins, skills,
  agents and commands write-denied. Claude Code ignores user settings in these runs anyway
  (`--setting-sources project`).
- **Updates and telemetry**: `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The box
  can't write the versions folder and the network allows nothing else, so an update can't happen in a run
  whatever the variables say; updates happen outside runs, as now.
- **Startup**: no measurable cost. Median of 5 locally: `claude --version` 14 ms → 24 ms (the profile is
  compiled), time to Claude Code's first message 202 ms → 188 ms (noise).

### Logging in, and the network to Anthropic

- **With an API key** (TRIF's key proxy on 127.0.0.1): works as tested. The box allows that port only; the
  key never enters the box.
- **With a Claude subscription login** (most users): two things, not wired in the prototype.
  1. *Network.* Claude Code talks to `api.anthropic.com` itself. The box can't name hosts, so
     `wholebox.js startProxy` is a small CONNECT proxy in the helper that tunnels only to Anthropic's hosts
     on 443 (tested with a stand-in upstream), set as `HTTPS_PROXY`; the box allows only its port. Claude
     Code honors `HTTPS_PROXY`. Not tried against the real API (that needs a login).
  2. *The token.* On macOS it's a keychain item that Claude Code reads by running `/usr/bin/security`.
     With its own config folder, Claude Code looks for a different item (`Claude Code-credentials-<hash of
     the folder>`), so the user would log in again for TRIF (the panel's existing login flow:
     `claude auth login` prints the link; in the box `open` can't start the browser, which the panel
     handles already). 2.1.319 also reads `CLAUDE_SECURESTORAGE_CONFIG_DIR` (empty: the default item, the
     user's own login, with TRIF's config folder): undocumented, so a maintenance risk. Either way the box
     must allow securityd and `security` (`keychain: true` in wholebox.js), and then **anything the box
     runs can ask for that token**: a run whose commands an organization loosened to `Bash(*)` could print
     it and write it into a mod. Seatbelt can't tell Claude Code's own `security` call from one its shell
     makes. Today that's equally true, and worse (no box at all). An API key through the key proxy
     doesn't have this hole.

## Codex in the same box (macOS)

Codex runs its commands, `apply_patch` and `view_image` in its own Seatbelt sandbox already, so most of
its file access is fenced today; the Codex process itself (its config and login in `~/.codex`) isn't. In
TRIF's box:

- `codex --version` runs in a deny-default profile; Codex's own sandbox inside it fails exactly like Claude
  Code's (`sandbox-exec: sandbox_apply: Operation not permitted`, exit 71, Codex 0.166).
- So Codex would run with its own sandbox off (`danger-full-access`) and TRIF's box as the fence. Its
  login (`~/.codex/auth.json`, a file) would need to move to a TRIF-owned `CODEX_HOME` or go through the
  key proxy; `auth.json` readable in the box means readable by its shell.
- An organization's Codex requirements that **force** a sandbox mode would then make every command fail
  (closed), not loosen anything. One that allows `danger-full-access` is fenced by TRIF's box.
- Not wired in the prototype (runs.js only wraps `claude`).

## Windows

Tried on windows-latest with TRIF's fence launcher (`tests/whole-box/fence.cs` is the windows branch's
`helper/lib/win/fence.cs` at ea8205e, unchanged) and npm's Claude Code 2.1.330 (`bin\claude.exe`, a native
program): `tests/whole-box/win-probe.js`, [run 44866586744](https://github.com/acapellascience/trif/actions/runs/44866586744)
(the `windows` job). Both container kinds: a plain AppContainer, and the less-privileged one TRIF's fence
uses (with `registryRead`), each given `internetClient`. The run's working folder, its `sites\`
(other sites' folders read-only), a config folder and a temporary folder have entries for the container;
nothing else.

| | Plain AppContainer | Less-privileged + registryRead |
|---|---|---|
| `claude --version` | starts (88 ms) | starts (81 ms) |
| Its MCP server (node, a child of claude.exe) | starts, `trif` tool answers | the same |
| Reaching a server on this computer (TRIF's key proxy, the stand-in API) | **refused**: 0 requests, Claude Code retried for 2 minutes | the same |
| …after `CheckNetIsolation LoopbackExempt -a -p=<container SID>` (an administrator) | works | works |
| Read its own mod in the copy / write a mod for its site | ok / ok | ok / ok |
| Read a file elsewhere in the home folder, the live workspace's mod | refused ("where it leads on disk could not be determined": Claude Code can't resolve the path, as the system won't say) | the same |
| Glob and Grep of the home folder | `EPERM … stat 'C:\Users\runneradmin'` | the same |
| Write into another site's folder in the copy, into the home folder | `EPERM` | `EPERM` |
| Bash (Git Bash) | dies at start (`NtCreateDirectoryObject … 0xC0000022`), as the fence work found | the same |
| The internet from inside (`internetClient`) | **1.1.1.1:443 and example.com:443 connected, names resolve** | the same |

All of it with `--dangerously-skip-permissions`, every tool allowed and `--add-dir` on the home folder:
nothing got out ("nothing got out of the box"). A second pass with a real loosening
`C:\Program Files\ClaudeCode\managed-settings.json` on the runner (every tool allowed, `bypassPermissions`, `C:\` as an extra folder), [run 44867250215](https://github.com/acapellascience/trif/actions/runs/44867250215): the same answers in both containers, nothing got out, and Claude Code reported no trouble loading them (the less-privileged container is given an entry on `C:\Program Files\ClaudeCode` for that).

So on Windows:

- **The file tools can be fenced by Windows**, whatever Claude Code is told, as on a Mac.
- **The network is the problem.** An AppContainer reaches either nothing on this computer (no key
  proxy, no allowlist proxy) or, with `internetClient`, the whole internet: Windows' capability has no host
  list. Three ways out, each a decision:
  1. *A loopback exemption*, set once by an administrator (a UAC prompt in `trif setup`), for one fixed
     container that every run uses, with each run's folders given to a capability of its own instead of
     to a container of its own (fence.cs takes capabilities already). No `internetClient`: the run reaches
     only the key proxy or an allowlist proxy, like the Mac. TRIF asks for no administrator today.
  2. *`internetClient`, no proxy*: Claude Code talks to Anthropic itself, and so can anything in the
     container (its MCP server, which is TRIF's own CLI). The login has to be inside: an API key in its
     environment, or Claude Code's `.credentials.json` (a plain file on Windows) in the config folder,
     readable by its own Read tool. TRIF's deny rules would cover the file, and an organization could
     loosen those.
  3. *Firewall rules for the container* (Windows Filtering Platform, by container SID, allowing Anthropic's
     addresses): an administrator too, and addresses change.
- No shell inside, as already decided for Windows (`trif` is an MCP tool); that also means an
  organization forcing Claude Code's sandbox on has no commands to break.
- Managed settings on Windows live in `C:\Program Files\ClaudeCode`; the less-privileged container needs
  an entry to read them (the probe gives one), or the organization's policies quietly don't apply (the
  Mac showed this: below).

### Windows without an administrator? (round 9, step 9)

Tried on windows-latest with TRIF's pinned claude.exe 2.1.330 in the container TRIF's fence makes for a run
(less-privileged + registryRead), `tests/whole-box/win-net-probe.js`, runs
[44886490084](https://github.com/acapellascience/trif/actions/runs/44886490084) and
[44887167150](https://github.com/acapellascience/trif/actions/runs/44887167150). The idea: a named pipe
whose security names the run's container (`tests/whole-box/pipe-bridge.cs`, outside the box as the user,
carries each connection to TRIF's relay), so nothing in the box needs loopback.

| From inside the container | no network capability | + `privateNetworkClientServer` |
|---|---|---|
| A pipe with Node's (Windows' default) security; ours not naming the container | refused (EPERM) | the same |
| **Our pipe naming the container** (with or without a low label) | **opens, carries both ways** | the same |
| Listening on a port of its own (127.0.0.1) | **refused (EACCES)** | works (same process) |
| A port on this computer outside (127.0.0.1; its own LAN address) | refused | refused (timed out) |
| The internet (1.1.1.1:443) | refused | refused |
| claude.exe with `HTTPS_PROXY` = the relay's 127.0.0.1 port (control) | can't connect, relay saw nothing | the same |
| claude.exe with `ANTHROPIC_UNIX_SOCKET` = the pipe (a name found in claude.exe, undocumented) | opens the pipe, sends nothing, "FailedToOpenSocket" | (not tried) |
| **claude.exe → shim (box-shim.js, a port inside) → pipe → bridge → relay** | can't: the shim can't listen | **works**: the stand-in API (Read, Write, the `trif` MCP tool; the box held), and the real api.anthropic.com, TLS end to end, 401 for the made-up token |

So:

- **With no capability and no administrator there's no way.** Claude Code speaks only TCP to a proxy, and
  a container with no network capability can't listen, so nothing inside can turn its TCP into the pipe.
  (The pipe itself works: the container may open a pipe whose security names it.)
- **`privateNetworkClientServer` (no administrator) makes the pipe path work**, internet and this computer's
  ports still closed. But that capability is Windows' "home and work networks": inbound and outbound to
  the local network. On CI there's no other computer to show it, but by its definition a boxed run could
  reach the router, printers, a NAS, and at work the company's internal servers. The Mac box allows none.
- **The administrator's loopback exemption** (the spike: works, no shim) opens every port on this computer
  to the container: TRIF's relay, and also whatever else listens there (development servers, databases,
  Docker). The Mac box allows one port.
- **The exemption plus firewall rules for the container**, both in the same one administrator step:
  Windows Firewall rules can name an AppContainer (`New-NetFirewallRule -Package <container SID>`), so the
  step can block it from every port on this computer but the relay's (a fixed port then). That is the
  Mac's guarantee. Not tried yet.

| Option | Administrator | The box can reach | Like the Mac |
|---|---|---|---|
| W1. `privateNetworkClientServer` + pipe + shim | no | the relay; **the local network** | no (the LAN) |
| W2. Loopback exemption, one fixed container | once, at setup | the relay; **every port on this computer** | no (local services) |
| W3. W2 + firewall rules for that container (all but the relay's port blocked) | once, at setup | the relay only | yes |

All three still need: one fixed container for every run (an exemption or rules name one container; each
run's folders then go to a capability of its own, which fence.cs takes already), and no Bash (the Windows
design). Recommendation (For Tim, round 9, in the progress file): W3.

## Enterprise: what managed settings can still do

Tested for real on GitHub's macOS runner: the workflow writes
`/Library/Application Support/ClaudeCode/managed-settings.json` with sudo (never on anyone's computer),
[run 44867149601](https://github.com/acapellascience/trif/actions/runs/44867149601) and again in [run 44867250215](https://github.com/acapellascience/trif/actions/runs/44867250215) (the `macos` jobs).

1. **Loosen everything** (`Read(//**)`, `Edit(//**)`, `Bash(*)`… allowed, `bypassPermissions`, the whole disk
   as an extra folder, Claude Code's sandbox off). The control run without the box read every secret; in
   the box every read and write outside the copy was refused by the system (same table as above). This
   is the point of the spike: **managed settings can loosen Claude Code's rules, not TRIF's box**.
2. **Force Claude Code's own sandbox on** (`enabled`, `failIfUnavailable`, no unsandboxed retries). In the
   box Claude Code can't start it ("Sandbox is required but failed to initialize: EPERM … listen
   '…/srt-mux-….sock' … Running it outside the sandbox is not allowed"; and a nested `sandbox_apply` would
   fail next). So **every shell command fails, closed**: `trif` can't run, the run can't do its work. File
   tools still work, still fenced. This is today's "breaks" category, newly reachable: an organization
   that requires Claude Code's sandbox breaks whole-box runs that use a shell. With `trif` as an MCP tool
   and no Bash (the Windows design), it wouldn't matter.
3. **Found on the way: the box must let Claude Code read the managed settings.** The first CI pass hadn't:
   Claude Code printed "Managed settings failed to load; policies from the failed source are NOT in
   effect" and went on. TRIF would have been switching an organization's policy off without saying so. The
   profile now reads `/Library/Application Support/ClaudeCode`, `/etc/claude-code` and Claude Code's own
   MDM plist by name. Server-managed settings are fetched by Claude Code at start (through the proxy) and
   cached in its config folder.

What managed settings can still do to a boxed run:

| They can | Effect in the box |
|---|---|
| Loosen permission rules, modes, extra folders, Claude Code's sandbox off, more network for its sandbox | nothing beyond the box: the system refuses. Not asked about in the box (decided 11-21, below); any command → no shell |
| Force Claude Code's sandbox on | shell commands fail (closed); fine with no shell (`trif` over MCP) |
| `allowManagedPermissionRulesOnly`, plan mode | TRIF's allow rules ignored: `trif` and edits refused by Claude Code itself, as today ("breaks") |
| Deny or allowlist MCP servers (`allowManagedMcpServersOnly`, `deniedMcpServers`) | would remove a `trif` MCP tool: breaks, closed |
| Hooks, `apiKeyHelper`, OpenTelemetry export, a forced login method | run inside the box: an organization's audit hook that writes a log elsewhere, or telemetry to its collector, would be refused. TRIF would be degrading the organization's monitoring; whether that's acceptable is a question for Tim (and maybe for those organizations) |
| Add tools | can't add a tool `--tools` leaves out (claude-managed.js) |

None of this involves TRIF reading or changing an organization's settings; it only stops relying on them.

**Decided (Tim, 11-21, step 7a):** in TRIF's full sandbox, settings that only loosen Claude Code's rules
(any command allowed, its sandbox off, bypass mode, more folders…) are **not asked about**: no "Use Claude
Code anyway", the chat isn't marked "no TRIF sandbox"; what they do goes in the run's log (`orgSettings`
line; the helper's log too). Settings that break TRIF's own rules (plan mode, only the company's permission
rules, the `trif` tool taken away) still stop the chat. When the company's settings **let a run use
commands beyond TRIF's own** (claude-managed.js `anyCommand`: a `Bash` allow rule for anything but `trif`,
`webmods`, `cd`, `ls`, or one with shell operators; `bypassPermissions` or `auto` mode), the chat gets the
`trif` tool instead of a shell, as when Claude Code's sandbox is forced on: the box would hold a free shell
too, but the run's environment holds its one-year sign-in token (`CLAUDE_CODE_OAUTH_TOKEN`), which a free
shell could read and copy into a mod; `--tools` leaves Bash out and no company setting can put it back.
Read strictly: a rule for any other single command counts as any command (git's aliases, npm's scripts and
every interpreter run others). `acceptEdits` mode keeps the shell: it approves only file edits and file
commands (mkdir, touch, rm, mv, cp, sed), none of which reads the environment. Outside the full sandbox
nothing changes (asked, as before).

## Costs and risks

- **Maintenance**: the profile lists what Claude Code needs to start (tested on 2.1.319 and 2.1.330). A
  release that needs a new mach service, a new folder or a new helper program fails closed: the run stops
  with Claude Code's own EPERM. `tests/whole-box.test.js` and `TRIF_WHOLE_BOX=1 tests/run-sandbox.test.js`
  catch it on CI with npm's newest Claude Code. Expect a fix every few months, like the tool list in
  tests/agent-tools.test.js today.
- **What breaks inside a run**: Claude Code's own sandbox (off by design), its auto-update (on purpose),
  opening a browser from inside (the panel shows the link instead), slash commands that reach the user's
  `~/.claude` (plugins, user skills, user `CLAUDE.md`, memory: already off in these runs by
  `--setting-sources project` and `--disable-slash-commands`), MCP servers that need the network or files
  outside the box (TRIF passes `--strict-mcp-config` with none today). `/login` in the panel is
  `claude auth login`, not a run: it can stay outside the box, given the same `CLAUDE_CONFIG_DIR` so the
  run finds the login it made.
- **sandbox-exec is deprecated** (its man page says so) but is what Claude Code's and Codex's command
  sandboxes and Bazel run, and what TRIF's runs already depend on through Claude Code; Chrome and Safari use
  the same Seatbelt through its library call (`sandbox_init`), which node can't reach without a native addon. Apple has given
  no replacement for command-line programs. The helper isn't an App Store app and isn't itself sandboxed,
  so notarization is unaffected: sandbox-exec is a system binary the helper runs, as Claude Code does
  today. (If the helper itself were ever App-Sandboxed, it couldn't run sandbox-exec at all, the same as
  today.) The Safari app is separate and doesn't start agents.
- **Seatbelt's network filter is coarse**: ports on localhost only, so the host allowlist lives in a proxy
  in the helper. That proxy is new code that must be right.

## Recommendation and options

**My recommendation: build it on macOS, and design it with no shell.**

1. **macOS, Claude Code: the whole process in TRIF's box, for every side-panel run.** It turns "TRIF's
   limits, unless an organization says otherwise" into "TRIF's limits, enforced by macOS", it costs nothing
   measurable at start, and today's tests already pass inside it. The permission rules stay, as a second
   layer and for clearer refusals.
2. **Drop Bash on the Mac too, and give `trif` as an MCP tool** (the Windows design, helper/mcp.js on the
   windows branch). Then an organization forcing Claude Code's sandbox on can't break runs, `cd`/`ls`
   aren't needed (Glob, Read), and both platforms have one design. Optional: the box works with Bash too
   (Claude Code's sandbox off inside, TRIF's box under the commands), which is what the prototype does.
3. **Logins.** With an API key nothing more is needed. For subscription logins, ship the allowlist proxy
   (wholebox.js `startProxy`, wired in runs.js) and a TRIF-owned config folder, and decide between a
   second login for TRIF (clean, one more step for people) and sharing the user's keychain item through
   `CLAUDE_SECURESTORAGE_CONFIG_DIR` (no new login, undocumented). Either way, say plainly that a run's own
   process can reach its login token, as today.
4. **Codex next, same box**, its own sandbox off inside (`danger-full-access`), a TRIF-owned `CODEX_HOME`.
5. **Windows: Claude Code in the fence, once the network is decided** (option 1 if one administrator
   prompt at setup is acceptable; it gives the Mac's guarantees). Until then Windows keeps the design
   already decided (no shell, rules for the file tools, the fence for `trif`).

After 1, the managed-settings check (claude-managed.js) changes meaning: "loosens" no longer needs the
user's consent for anything the box covers (files, commands, network); "breaks" still stops the run. The
security docs' "Known limit" line about company-managed agents would go.

Options, for Tim to choose:

| Option | Guarantee for file tools | Enterprise loosening | Cost |
|---|---|---|---|
| A. As today | permission rules (Claude Code's) | detected, user consents to looser box | none |
| B. Whole box, opt-in setting | macOS for those who turn it on | covered for them | small; two code paths to test |
| C. Whole box on macOS for every run (+ Bash kept) | macOS | covered; "force Claude's sandbox" breaks runs | profile upkeep per Claude Code release |
| D. C + no shell, `trif` over MCP (recommended) | macOS | covered; only MCP allowlists and rule-only modes break runs | C, plus moving the guides to the tool |
| E. D on Windows with a one-time administrator step | Windows, same as the Mac | covered | an admin prompt; fence.cs change (fixed container, per-run capability) |
| F. D on Windows with `internetClient` | Windows for files; whole internet open; login inside | covered for files | no admin; weaker network than today's Windows design |

Not done in the spike: the proxy wired into runs.js for subscription logins, a real login in the box (it
would need a real account), Codex in the box end to end, the panel's wording, Windows' managed-settings
check (claude-managed.js reads no Windows locations yet).

## Files on the branch

- `helper/lib/wholebox.js`: the profile, the wrapper, the allowlist proxy.
- `helper/lib/runs.js` (`_spawn`, behind `TRIF_WHOLE_BOX=1`, macOS, staged Claude Code runs) and
  `helper/lib/agents/claude.js` (`runSettings` `wholeBox`: Claude Code's own sandbox off inside).
- `tests/whole-box.test.js`: profile, proxy, a node program in the box, the real Claude Code with its
  loosest settings (and the control without the box), managed settings forcing its sandbox on (CI).
- `tests/run-sandbox.test.js`: passes `TRIF_WHOLE_BOX` through, so the same full run is checked in the box.
- `tests/whole-box/win-probe.js`, `fence.cs`, `mcp-echo.js`: the Windows probe.
- `.github/workflows/whole-box.yml`: both, on this branch only.
