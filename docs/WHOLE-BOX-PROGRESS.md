# Whole box: progress

Tim's decision (11-21): "start the sandbox plan with mitigations". The whole side-panel agent process in
TRIF's own OS sandbox, as an **opt-in setting first** (draft: "Run chats in TRIF's full sandbox"), with the
mitigations below. Findings of the spike: docs/WHOLE-BOX.md. Words people see: drafts in
docs/WHOLE-BOX-STRINGS.md (Tim's to approve). Branch `whole-box` only.

Each step needs tests that prove it: the box holds with the loosest Claude Code settings and a permissive
managed policy; a normal run works; the fallback happens only on the person's choice.

## Checklist

### macOS (Claude Code)

- [x] **1. Pinned Claude Code for runs.** TRIF's boxed runs use a pinned, tested Claude Code installed
  privately for TRIF (`<home>/runtime/claude-code-<ver>-<platform>/`), never the user's own, which keeps
  updating as usual. Pin + checksums in `helper/claude-code.json` (from the npm registry's sha512, inside
  the signed package). `helper/lib/claudepin.js`. Refreshing the pin = a release step after the box tests
  pass (`node helper/lib/claudepin.js pin <version>`). *(round 1; wiring into release.js: step 2)*
- [x] **1b. The setting.** "Run chats in TRIF's full sandbox" (opt-in), replaces `TRIF_WHOLE_BOX=1`;
  turning it on downloads the pinned Claude Code in the background (progress in the panel); a run before it
  is there gets the informed fallback (step 4: for now it stops with a message). *(round 2)*
- [x] **6. Sign-in via `claude setup-token`.** *(rounds 2–3)* Run once outside the box by TRIF's
  pinned copy under a pseudo-terminal (the panel's login flow shows the URL/code), token stored in the
  Keychain via the helper (keyring.js; never in files, never printed), passed to the boxed run as
  `CLAUDE_CODE_OAUTH_TOKEN` (outranking variables unset), Anthropic reached through the allowlist proxy.
  API keys keep working through the key proxy (they win). Tests with stand-in tokens only.
- [x] **6b.** *(round 3)* The boxed run signs in (claudetoken.prepareBoxed); no token and no key → a login
  error, mode "token", and the panel's login notice becomes the box's sign-in (`agent.login` mode
  token); a refused token → "sign in again" (Settings hears of it); Settings: the sign-in line and Sign out
  (`wholeBox.signOut`, panel only). The user's own Claude Code login status is left alone by boxed runs.
  Not checked for real: a real sign-in to the end (no account on CI; the token line's exact look is
  unknown: the parser takes any `sk-ant-oat…` from any line, and ends a program that waits after it), and
  a real token through the allowlist proxy to api.anthropic.com (CI's runs use a stand-in via
  `TRIF_ANTHROPIC_URL`). Both want one manual try by Tim with his own account when he chooses (not
  needed for the next steps).
- [x] **7. Bash kept on macOS, boxed.** Claude Code's own sandbox off inside, its Bash inside TRIF's box
  (the spike does this). `trif` as an MCP tool only when an organization forces Claude Code's sandbox on
  (detected from managed settings: claude-managed.js) and on Windows.
  - [x] **7b.** *(round 4)* An organization forcing Claude Code's sandbox on: boxed runs get no Bash and
    the `trif` tool (helper/mcp.js, from branch windows, no launcher: already in the box); MCP allow/deny
    lists that take it away stop the run with a draft message.
  - [x] **7a.** *(round 5; Tim answered 11-21: "yes, the recommendation")* In the box, settings that only
    loosen Claude Code's rules aren't asked about and the chat isn't marked; they're in the run's log.
    Settings that let a run use any command → no shell, the `trif` tool. Breaks still stop the chat.
- [ ] **3. Clear refusal errors.** When the box refuses something, the run's error names it (Seatbelt
  violation reports from the log / the relay's refusal), not a mystery failure.
  - [x] **3a.** *(round 5)* Every deny in the run's profile carries the run's tag; `log stream` on the tag
    (started before the agent) collects Seatbelt's reports; with the allowlist proxy's refusals, a failed
    boxed run gets an error line naming them (reason "box"; `done.boxRefused`), and every boxed run logs
    them (`boxRefused`). Draft words in WHOLE-BOX-STRINGS.md.
  - [ ] **3b.** What every boxed run is refused (round 5's CI list, Findings) left out of the error,
    kept in the log; a real failed run on CI (a run the box makes fail, e.g. a host an organization's
    settings name, step 5); the relay's refusals (step 8) the same way.
- [ ] **4. Informed fallback, never silent.** If the box can't start, the panel offers "Run this chat with
  the older protection" as the person's own choice. Draft the words.
- [ ] **8. The network relay.** CONNECT-only to Anthropic's hosts on 443 (plus org-named hosts, step 5), no
  TLS termination; own unit tests + a fuzz-style test of its parsing; wired into runs for token logins.
- [ ] **5. Organisations' policies inside the box.** Managed settings already readable; hooks run inside
  the box; network allowed only to the hosts those settings name (OTEL endpoints etc.) through the relay.
  docs/IT-ADMINS.md: what the box does, what it allows, how an admin sees/controls it.
- [ ] **2. Daily CI against the latest Claude Code** (scheduled workflow), so a break is known before the
  pin moves; and the pin refresh as a release.js step gated on the box tests.

### Windows

- [ ] **9. Network without the admin loopback prompt.** On windows-latest: can the boxed claude.exe reach
  the relay without loopback (a named pipe the AppContainer is granted, or another no-admin path)? If none,
  the one-time admin prompt at setup (loopback exemption for TRIF's container). Build whichever works;
  trade-off in WHOLE-BOX.md for Tim.
- [ ] **9b. Windows half of the rest:** pinned claude.exe (1), Credential Manager for the token (6), `trif`
  over MCP, no Bash (7), refusal errors (3), fallback (4), relay (8), managed settings in
  `C:\Program Files\ClaudeCode` (5), daily CI (2).

### Later

- [ ] **10. Codex**, same design, after Claude Code is solid on both.

## Done

### Round 1 (11-21): step 1, the pinned Claude Code

- `helper/claude-code.json`: Claude Code 2.1.330 (the version the spike's CI passed on), each platform's
  npm package (`@anthropic-ai/claude-code-<platform>`) tarball URL and npm's sha512 integrity.
- `helper/lib/claudepin.js`: `ensurePinned(home)` downloads the platform's tarball (streamed to disk,
  https only, size cap), checks the pinned sha512 before unpacking, keeps only the binary (and licence),
  on macOS checks its code signature is Anthropic's (team Q6L2SF6YDW), writes a record, and renames the
  folder into place (complete or absent). `installedPinned(home)`, `checkPinned` (the binary unchanged
  since it was unpacked), `prunePinned` (older pins). `node helper/lib/claudepin.js pin <version>` rewrites
  the pin file from the registry (the release step). `TRIF_CLAUDE_CODE_PIN=<file>` for tests.
- `runs.js`: a whole-box run (`run.wholeBox`, still `TRIF_WHOLE_BOX=1` until 1b) skips `detect` and uses
  the pinned binary, checked unchanged before each run (`checkPinned`: SHA-256 against the record,
  streamed, remembered per inode/size/ctime: the binary takes 0.4 s to hash); missing or changed, the run
  stops with a draft message and the user's own Claude Code is never started (the fallback offer is
  step 4). The rest of `_launch` moved into `_withAgent(run, found, env)` unchanged.
- Tests: `tests/claudepin.test.js` (a stand-in registry on 127.0.0.1 serving fake tarballs: installs once
  for two callers, wrong checksum, no binary, a symlink as the binary, a cut-off download, 404, a redirect
  to http, size cap, unsigned binary refused on macOS, changed binary noticed even with its times put back,
  prune, the pin command against a fake registry, the real pin file's shape). `tests/run-sandbox.test.js`
  under `TRIF_WHOLE_BOX=1`: the full run with every `trif` command now uses the pinned copy (the `claude`
  on PATH is replaced by a stand-in that fails loudly), plus a new test: pinned copy missing, or its record
  disagreeing, stops the run with the message, no model call. `tests/whole-box.test.js` uses the pinned
  copy when `TRIF_TEST_CLAUDE_PIN_HOME` is set (CI).
- Locally: claudepin installed the real 2.1.330 darwin-arm64 tarball (served from a local copy) in 3.9 s,
  checksum and Anthropic's signature passing; `TRIF_WHOLE_BOX=1` run-sandbox (2 tests) and plain run-sandbox,
  whole-box.test.js, and the agents/managed/run-folders/hardening/keys/shipped/install suites pass.
- CI (`whole-box.yml`, macos job): claudepin's unit tests; installs the real pin through
  `node helper/lib/claudepin.js ensure` (cached by the pin file's hash), and runs the box tests and the
  full side-panel run with it. The npm `-g` Claude Code stays for today's-sandbox runs (the user's own).

### Round 2 (11-21): step 1b, the setting; step 6 started

- `helper/lib/wholeboxsetting.js`: Settings' "Run chats in TRIF's full sandbox", config.json `"wholeBox":
  true` (off by default; macOS only for now: `available` false elsewhere, the panel shows no switch).
  On: TRIF's pinned Claude Code downloads in the background (claudepin `onProgress(got, total)`, sent to the
  panel at most every 500 ms); a failed download says why, with **Try again**; a helper starting with it on
  and the copy missing fetches it; off keeps the copy. host.js `wholeBox.status/set/retry` are
  PANEL_COMMANDS (the extension's connection only: a terminal's or a run's socket is refused).
  background.js relays `{type:'wholeBox'}` into the panel's status; sidepanel.html/js `renderWholeBox`.
  runs.js reads the setting (`isOn(ws)`) instead of `TRIF_WHOLE_BOX`; a run while it's still downloading
  says so. `TRIF_WHOLE_BOX=1` now only tells tests/run-sandbox.test.js to switch the setting on in its
  config.json. Draft words: WHOLE-BOX-STRINGS.md.
- claudepin: `onProgress` for every caller of the one shared download; `pinning(home)`.
- `helper/lib/claudetoken.js` (step 6): `parseSetupTokenLine` (the sign-in URL; the token taken out of
  whatever line holds it; anything `sk-ant-…` redacted from every line), `tokenEnv(env, token)`
  (`CLAUDE_CODE_OAUTH_TOKEN`, and the variables that outrank it removed: Bedrock/Vertex/Foundry,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`), `storeToken/readToken/hasToken/removeToken` (keyring.js,
  service "TRIF Claude Code sign-in": by stdin, never in an argv). logins.js mode `"token"` (claude only):
  TRIF's pinned copy (never the user's) runs `setup-token` with a config folder of its own (removed after,
  so the user's Claude Code settings are untouched) and `DISABLE_AUTOUPDATER=1`; the URL/code flow as for
  `auth login`; on exit 0 the token goes to the keyring; it never reaches an event, the notes or the log.
- Tests: `tests/wholebox-setting.test.js` (5: off by default, on → download with progress → ready and
  pruned, failed → Try again, helper start fetches a missing copy, throttling, unavailable off macOS, and
  through a real helper: sent on hello, refused from the socket with and without a run token, on → real
  claudepin download from a stand-in registry with progress → ready, off keeps the copy).
  `tests/claudepin.test.js` +1 (progress: both callers, one download, the server's size or 0).
  `tests/claudetoken.test.js` (5: parsing and redaction, tokenEnv, a fake keychain with no argv leak, the
  token login with a fake pinned `claude`: good code → keyring, nothing in events/log, the URL's query and
  the code not in the log; bad code, no token, no copy, not Claude Code). Locally all pass, with
  downloads/agents/agent-keys/explain/extension/install/sandboxlint/whole-box suites (no regressions).
- Not run locally: `TRIF_WHOLE_BOX=1 tests/run-sandbox.test.js` (the permission check refused it this round
  as it did running the downloaded binary in round 1): CI runs it. The panel wasn't looked at in a browser
  (21 test browsers from other sessions were running): the switch's look is unchecked.

### Round 3 (11-21): step 6b, the sign-in end to end

- `claudetoken.ptyCommand`: `setup-token` under macOS's own `/usr/bin/script` (no new dependency). script
  refuses node's socket pipes as stdin (tcgetattr: "Operation not supported on socket"), so stdin goes
  through `cat`, stopped when script ends (`pkill -P $$ -x cat`); the terminal is made 4000 columns wide
  (`/bin/stty`) so nothing wraps; script returns the program's exit status; cancelling (SIGTERM to the
  group) ends the program too (SIGHUP from the closed terminal). The code is sent with \r (it reads keys).
- `claudetoken.termLine`: a line as it looks on screen (Ink places words with ESC[nG / ESC[nC, not
  spaces); the logo, spinners, box and its own instructions dropped (`CHROME`); a refused code
  (`REFUSED_CODE`) ends the login with Claude Code's own words (it would otherwise wait for Return and
  start over with a new link the panel never sees); after the token, a program still running after 3 s is
  ended and counted as signed in.
- `claudetoken.prepareBoxed` (runs.js's whole-box path, in place of the adapter's prepare): API key's
  proxy first; else the token (`CLAUDE_CODE_OAUTH_TOKEN`; `OUTRANKS` and `ANTHROPIC_BASE_URL` unset;
  `HTTPS_PROXY` = wholebox.startProxy, the box's one port; `TRIF_ANTHROPIC_URL` in tests); else an error
  with `signIn: 'token'` → the run's login error. runs.js: login errors in a boxed run carry `mode:
  'token'` (and `refused` when the token was used), and never mark the user's own Claude Code logged out.
- wholeboxsetting.js: `signedIn` (token not refused, or an API key; null until checked), `token`, `key`,
  `refused`, `signInError`; `refreshSignIn` (on start, on switching on, on `wholeBox.status`),
  `signedIn()` after a token login, `noteRefused()`, `signOut()`. host.js wires login/run `done`
  events to them and adds `wholeBox.signOut` to PANEL_COMMANDS.
- Extension: login.js `start(agent, name, fix, mode)` and the box's words; sidepanel.js `boxedInfo`
  (the setting on + Claude Code: "logged in" = the box's sign-in, Log in = mode token); Settings' line and
  Sign out; background.js passes `mode` and `wholeBox.signOut`. Draft words: WHOLE-BOX-STRINGS.md.
- Tests: claudetoken.test.js 7 (the fake claude now needs a terminal, reads keys, draws like Ink, refuses
  BADCODE and waits, GOODWAIT waits after the token; prepareBoxed; the pty); wholebox-setting.test.js 6
  (the sign-in states; never a real keychain); run-sandbox.test.js under TRIF_WHOLE_BOX (CI): no sign-in →
  login error mode token, no model call; a stand-in token → the run works, the stand-in Anthropic sees
  `Bearer <token>` and no x-api-key, the token in no event or log; a 401 → refused, Settings told; Sign
  out. fake-anthropic-server.js: `{status}` steps. Locally: agents, agent-keys, helper, extension,
  sandboxlint, claudetoken, wholebox-setting, claudepin, explain, agent-tools (286 pass).
- Not looked at in a browser: the panel's sign-in notice and Settings' line (words are drafts anyway).

## For Tim (round 4): answered 11-21, "yes, the recommendation" (done in round 5, step 7a)

**Should a chat in TRIF's full sandbox still ask "Use Claude Code anyway" when a company's Claude Code
settings loosen Claude Code's rules?** Today it does. For example, a company allows every command, turns
Claude Code's sandbox off, or uses bypass mode: the chat stops and says the company's settings replace
TRIF's sandbox, and the person can choose "Use Claude Code anyway". After that the chat is marked "no TRIF
sandbox". In the full sandbox that's no longer true, because TRIF's box holds whatever those settings say.
CI showed it: the loosest managed settings, and still every read and write outside the run's copy was
refused. So the question stops the person for nothing and tells them something that isn't so. Dropping it
changes what people are asked, so it's your call.

My recommendation: in the full sandbox, don't ask, and don't mark the chat "no TRIF sandbox". Note the
company's settings in the run's log. Settings that stop TRIF's own rules from working (plan mode, only the
company's permission rules, the trif tool taken away) still stop the chat, as now. One more change goes
with it: if the company's settings let the run use any command, give that chat the `trif` tool instead of
a shell (round 4's no-shell mode). The box still holds with a shell. But a free shell could read the chat's
own sign-in token (the one-year setup-token, which the box needs in its environment) and copy it into a
mod. Without a shell it can't, and a company setting can't put back a tool TRIF leaves out.

Alternative: keep asking in the full sandbox too, with words that are right there (for example "your
company's settings loosen Claude Code's rules; TRIF's full sandbox still holds"). That's safe, but it's a
question with nothing to decide.

## Findings

- **setup-token under a terminal** (round 3 CI probe, pinned 2.1.330): prints Ink's "Welcome to Claude Code"
  logo, "This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude
  subscription required.", "Opening browser to sign in…", spinners, then "Browser didn't open? Use the url
  below to sign in (c to copy)" and the URL (`https://claude.ai/oauth/authorize?…`, one line at 4000
  columns), then "Paste code here if prompted" over an input box. A wrong code: "Finishing sign-in…", then
  "✘ OAuth error: That code wasn't accepted. It may be incomplete, expired, already used, or from an
  earlier sign-in attempt. Sign in again to get a new code." and "Press Enter to retry", and it waits.
  TERM=dumb and xterm-256color draw the same. Words are placed with cursor moves (ESC[nG), not spaces.

- **`claude setup-token` needs a terminal** (round 2 CI probe, pinned 2.1.330 on macos-latest): `--help`
  works ("Set up a long-lived authentication token (requires Claude subscription)", no options but -h);
  run with stdin/stdout as pipes (how logins.js runs `auth login`) it prints only a newline, no sign-in URL,
  and waits until killed (it exits on SIGTERM, 143). Unlike `auth login`, which prints its URL without a
  TTY. It writes `.claude.json` and `backups/` into CLAUDE_CONFIG_DIR even then: the throwaway config folder
  logins.js gives it is needed. So the token login (round 2's mode "token") is right in its handling of
  the token but can't see the URL yet: step 6b starts with a pseudo-terminal.
- `gh run watch` returns at once in this environment (no TTY): wait with a `gh run view --json status` loop.

- npm's `@anthropic-ai/claude-code` 2.1.x is a thin package whose `optionalDependencies` are per-platform
  packages holding one native binary each (`package/claude`, `claude.exe` on Windows): darwin-arm64 is a
  164 MB download, 364 MB unpacked, signed by Anthropic (Developer ID, team Q6L2SF6YDW, hardened runtime).
  dist-tags on 11-21: `stable` 2.1.323, `latest` 2.1.330.
- A downloaded binary isn't quarantined (node's https sets no quarantine flag), and it's Anthropic-signed
  anyway; the checksum pin is what TRIF relies on.
- Locally, running the downloaded binary was refused by this session's permission check (auto mode), so
  the real pinned binary is only run on CI; local tests use fake tarballs.

- For step 6 (code.claude.com/docs/en/authentication, read 11-21): `claude setup-token` opens the same
  browser flow as `/login` and prints a one-year OAuth token to the terminal after approval; it saves it
  nowhere. Needs a Pro, Max, Ultra, Team or Enterprise plan. The variable is `CLAUDE_CODE_OAUTH_TOKEN`.
  Precedence, highest first: cloud-provider variables (Bedrock/Vertex/Foundry) > `ANTHROPIC_AUTH_TOKEN` >
  `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > profiles > `/login` credentials. So a
  boxed run with the token must unset the higher ones (and an org's `apiKeyHelper` in managed settings
  would win over it: step 5). The token "can only make model requests" (no Remote Control, no claude.ai
  connectors). Bare mode doesn't read it. Which stream it's printed on isn't documented: check with a
  fake `claude` modelled on the real output, never Tim's login.

### Round 4 (11-21): step 7b, no shell when an organization forces Claude Code's sandbox on

- `helper/mcp.js` (branch windows' `trif` tool server, read and copied; same file, small additions): with no
  `launcher` in its config it starts TRIF's CLI as is (Claude Code starts the server inside TRIF's box, so
  its children are boxed), with the run's `TRIF_*` variables and temporary folder (`env`) and working
  folder (`cwd`); a launcher still needs its spec. util.js `shellWord`, `trifCommand`, `mcpStep`, `mcpName`
  and agents/index.js `noShellText` copied from branch windows (contextText `noShell`).
- claude-managed.js: `forcesSandbox` (`sandbox.enabled` true in any source) and `mcpBlocks`
  (`allowedMcpServers` without a `serverName: "trif"` entry, `allowManagedMcpServersOnly` without one,
  `deniedMcpServers` naming it), per source, not breaks for runs with a shell.
- claude.js `command({mcp})`: `--tools` without Bash, no Bash allow rules, `mcp__trif__trif` allowed,
  `--mcp-config` with that one server (`--strict-mcp-config` already); tool steps of an MCP tool told as a
  shell's would be ("trif status"). `noShellBrokenMessage` (draft in WHOLE-BOX-STRINGS.md).
- runs.js `_withAgent`: a boxed run with `forcesSandbox` → `run.noShell` (logged), or stopped with the
  message when `mcpBlocks`; `_spawn` → `_trifTool` (the server's config in the run's agent folder, 0600) and
  the context's no-shell line.
- Tests: tests/wholebox-noshell.test.js (3: the managed checks, the command with and without, the server
  with no launcher: words as they are, env, cwd, failures). run-sandbox.test.js, CI only (TRIF_WHOLE_BOX=1
  with the runner's real managed settings, copied for the helper): every `trif` command through the tool in
  the box, Bash not offered and refused, another site's `trif new` refused by the box, the model told
  there's no shell; and with `deniedMcpServers` naming trif, the run stops with no model call. Locally:
  wholebox-noshell, claude-managed, agents, agent-tools, helper, extension, sandboxlint, claudetoken,
  wholebox-setting, claudepin, explain, agent-keys, run-folders, hardening, shipped (345 pass).

### Round 5 (11-21): step 7a (Tim's answer), step 3a (the box's refusals named)

- **7a, decided by Tim 11-21 ("yes, the recommendation"; recorded in WHOLE-BOX.md, Enterprise):**
  claude-managed.js `anyCommand` (a `Bash` allow rule for anything but `trif`/`webmods`/`cd`/`ls`, or with
  shell operators; `bypassPermissions` or `auto` mode; not `acceptEdits`: it approves file commands
  only). runs.js `_withAgent`, in the box: `loosens` → the run's log (`orgSettings`) and the helper's log,
  no `_withoutSandbox` (no card, no "no TRIF sandbox"); `forcesSandbox` or `anyCommand` → no shell (the
  trif tool), `mcpBlocks` with either → stopped (claude.js `noShellBrokenMessage`, a second draft for
  any-command); `breaks` still stop. Outside the box unchanged.
- **3a:** helper/lib/boxrefusals.js (`tagFor`, `parseReport`, `describe`, `summary`, `watch`, `fromProxy`);
  wholebox.js `macProfile({tag})`: `(deny default (with message "<tag>"))` and the explicit denies too;
  runs.js `_watchBox` (before prepare; the agent starts once `log stream` reads, ≤3 s), `_boxRefusals`,
  `_finish` (the error line, `done.boxRefused`, the log line, `unwatched` when `log stream` can't run);
  a failed boxed run waits 500 ms after exit for the last reports. claudetoken.prepareBoxed hands over
  the proxy's `seen`.
- Tests: wholebox-noshell.test.js +2 (anyCommand; runs.js's box decisions with stubs: loosening logged and
  not asked, any command → no shell, + the tool taken away → stopped, plan mode stops, outside the box
  asked); tests/wholebox-refusals.test.js (4: the words; the watcher with a stand-in `log`; **real
  Seatbelt locally: a shell in a tagged box refused a scratch file's read and a read-only folder's write,
  both read back from `log stream`**; runs.js's end of a run). run-sandbox.test.js, CI only: the loosest
  settings (`loosen`) → a boxed side-panel run not asked, no shell, the trif tool; `loosen-shell`
  (sandbox off, every folder, acceptEdits, no other commands) → not asked, a shell, the box still refusing
  config.json, the keychain file, a write to the private folder; both now also check the box's refusals
  in the run's log and print them. Locally 366 tests across the suites (one skip), no regressions.
- **What a boxed run that worked was refused along the way** (CI, run 44877625810, real pinned 2.1.330,
  the `loosen-shell` and no-shell runs): `security` (Claude Code checks the keychain) reading
  ~/.CFUserTextEncoding and the global preferences, and the services com.apple.analyticsd /
  SecurityServer / securityd.xpc; Claude Code itself: `ipc-posix-shm-read-data
  apple.shm.notification_center`, com.apple.FSEvents, listening on a socket in its temp folder
  (`cc-socks/<pid>.sock`), writing its config folder's `plugins` and ~/Library/Caches/claude-cli-nodejs;
  `git` (Xcode's shim) reading Xcode's libxcrun; `zsh` a temp file in /private/tmp; `trif` (node) reading
  config.json, ~/.trif/preinstalled.json, helper.log. None stopped the run, so a failed run's error
  would name these too: **step 3b leaves the ones every run has out of the error** (kept in the log).
  Under load the kernel reports even fewer: the repo's `tests` workflow (the whole suite at once) saw no
  report at all in 10 s for the real-Seatbelt unit test, which is strict only in whole-box.yml
  (`TRIF_TEST_BOX_REPORTS=1`) and skips elsewhere when none arrive.
  Also: **not every refusal is reported** (the Write tool's refused write into the private folder had no
  report; the ones around it did), so the error names what was seen, best effort.
- Finding: `log stream` works for an administrator account without sudo (Tim's Mac, here); its first
  line "Filtering the log data using …" says it's reading. A report reads "Sandbox: cat(16354)
  deny(1) file-read-data /Users/…/.zshrc" followed by the profile's message on its own line. Noise in
  every program: `/dev/dtracehelper` (ioctl/write), filtered out.

## Next

Round 6: step 3b (look at round 5's CI print of what a normal boxed run is refused; a real failed run named
on CI; noise out of the error if needed), then step 4 (the informed fallback: "Run this chat with the older
protection", draft words).

## CI

- Round 5, 7a: [run 44876683949](https://github.com/acapellascience/trif/actions/runs/44876683949) (whole-box.yml,
  a394c4f) **passed** (macos and windows): with the loosest managed settings (`Bash(*)`, bypass mode,
  every folder, Claude Code's sandbox off) **a boxed side-panel run went on without asking, no shell, every
  `trif` command through the trif tool, the box refusing as before**; with settings that only loosen
  (`acceptEdits`, every folder, sandbox off, no other commands) **not asked, a shell, the box refusing
  config.json, the keychain file and the private folder**; the round-4 steps unchanged. The repo's `tests`
  workflow: [run 44876684031](https://github.com/acapellascience/trif/actions/runs/44876684031) passed.
  3a: [run 44877859928](https://github.com/acapellascience/trif/actions/runs/44877859928) (78ccb22): macos
  **passed**: the real-Seatbelt unit test (tagged reports through `log stream`), and every boxed
  side-panel run's refusals read back into its log (printed: Findings); windows passed (unchanged). Before it, 1836fdd's macos failed the real-Seatbelt test (a cold runner's first `log
  stream`: now waits for its header up to 15 s in that test, 3 s in runs) and c4f6cbd's the
  `loosen-shell` check of the Write's report (none came: not every refusal is reported). The repo's
  `tests` workflow failed on the real-Seatbelt test for 1836fdd–78ccb22 (no reports under the whole
  suite's load): strict only in whole-box.yml since 6256e9f, whose `tests` run
  [44878306764](https://github.com/acapellascience/trif/actions/runs/44878306764) passed (its whole-box run,
  44878306779, still running at the end of the round: the same code as 78ccb22 bar that test's skip).

- Round 4, [run 44874659962](https://github.com/acapellascience/trif/actions/runs/44874659962) (whole-box.yml,
  18ca3f6): macos **passed**: the unit tests (wholebox-noshell added); the earlier steps unchanged; **with
  the runner's real managed settings forcing Claude Code's sandbox on, a boxed side-panel run with no
  Bash did every `trif` command through the trif tool** (Bash not offered and refused, another site's
  `trif new` refused by the box, the model told there's no shell), in 4.6 s; **with `deniedMcpServers`
  naming trif as well, the run stopped before Claude Code started, no model call**. The pinned 2.1.330
  starts with its forced sandbox and no Bash. windows passed (the spike's probe, unchanged). The repo's
  `tests` workflow: [run 44874659973](https://github.com/acapellascience/trif/actions/runs/44874659973) passed.

- Round 3, [run 44873370047](https://github.com/acapellascience/trif/actions/runs/44873370047) (whole-box.yml,
  f19e44a): macos **passed**: the unit tests; the real pin; **the setup-token probe found the URL under the
  pseudo-terminal, and through logins.js gave exactly: login URL → the refused stand-in code's words →
  error → done not ok** (Findings); the box tests; the side-panel run in today's sandbox; the same in the
  box, now with the token test (no sign-in → mode token, no model call; a stand-in token → a run with
  `Bearer <token>` and no x-api-key; a 401 → refused, Settings told; Sign out); both managed-settings
  steps. windows passed (the spike's probe, unchanged). Before it, run 44873006986 (52a4dc9) failed
  one check: a refused token's status was from before the token was saved (fixed in f19e44a). The repo's
  `tests` workflow: [run 44873370090](https://github.com/acapellascience/trif/actions/runs/44873370090)
  passed (and 52a4dc9's, 44873006926).

- Round 2, [run 44871249783](https://github.com/acapellascience/trif/actions/runs/44871249783) (whole-box.yml,
  7e2146c): macos **passed**: claudepin + wholebox-setting + claudetoken unit tests; the real pin installed;
  the box tests; the side-panel run in today's sandbox; **the same with the whole process in the box, now
  switched on through the setting (config.json "wholeBox")**, the missing/changed test included; both
  managed-settings steps. The setup-token probe (continue-on-error) ran and found no URL (Findings).
  windows passed (the spike's probe, unchanged). The repo's `tests` workflow: [run
  44871249816](https://github.com/acapellascience/trif/actions/runs/44871249816) passed (and aec4bae's,
  e6f3ad8's). (Round 2's first whole-box run, 44871158232, was cancelled by me: I misread `gh run watch`
  returning at once as the probe hanging; the probe now has a hard stop anyway.)

- Round 1, [run 44869998053](https://github.com/acapellascience/trif/actions/runs/44869998053) (whole-box.yml):
  macos **passed**: claudepin unit tests 8/8; the real pin installed by `claudepin.js ensure` (2.1.330,
  checksum and signature passing, `--version` ok); whole-box.test.js with the pinned binary (5 pass, the
  sandbox-on one runs in its own step); run-sandbox today's sandbox, and with `TRIF_WHOLE_BOX=1` on the pin
  (2/2, the missing/changed test included); the managed-settings steps (loosen everything; force Claude
  Code's sandbox on) on the pin. windows job unchanged this round (the spike's probe; still running at
  push time). The repo's `tests` workflow: [run 44869997926](https://github.com/acapellascience/trif/actions/runs/44869997926).
