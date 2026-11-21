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
- [x] **3. Clear refusal errors.** When the box refuses something, the run's error names it (Seatbelt
  violation reports from the log / the relay's refusal), not a mystery failure.
  - [x] **3a.** *(round 5)* Every deny in the run's profile carries the run's tag; `log stream` on the tag
    (started before the agent) collects Seatbelt's reports; with the allowlist proxy's refusals, a failed
    boxed run gets an error line naming them (reason "box"; `done.boxRefused`), and every boxed run logs
    them (`boxRefused`). Draft words in WHOLE-BOX-STRINGS.md.
  - [x] **3b.** *(round 6)* What every boxed run is refused (round 5's CI list) left out of the error,
    kept in the log (`routine`); a real failed run on CI (an organization's settings sending Claude Code
    to a gateway host the box doesn't let it reach: the error names that connection and nothing else).
    The relay's refusals (step 8) go through the same path as the allowlist proxy's (`fromProxy`).
- [x] **4. Informed fallback, never silent.** *(round 6)* If the box can't start, nothing runs; the panel's
  card offers "Run this chat with the older protection" as the person's own choice (the chat keeps it
  until a new chat; its chip). Draft words in WHOLE-BOX-STRINGS.md.
- [x] **8. The network relay.** *(round 7)* `helper/lib/relay.js`: CONNECT-only to Anthropic's hosts on 443
  (plus org-named hosts, step 5), no TLS termination; strict parsing; own unit tests + fuzz-style tests of
  its parsing and of the running relay; token runs use it (wholebox.startProxy is now the relay).
- [ ] **5. Organisations' policies inside the box.** Managed settings already readable; hooks run inside
  the box; network allowed only to the hosts those settings name (OTEL endpoints etc.) through the relay.
  docs/IT-ADMINS.md: what the box does, what it allows, how an admin sees/controls it.
  - [x] **5a.** *(round 7)* claude-managed.js `orgNetwork` (managed `env` endpoints, HTTP hooks' URLs →
    the relay or a port on this computer; plain http elsewhere and their own proxies noted; command hooks'
    scripts readable); runs.js gives them to the relay and the box, logs `orgNetwork`; a key-signed run
    gets the relay too when they name hosts. docs/IT-ADMINS.md (draft).
  - [x] **5b.** *(round 8)* The org CI test strict on round 7's findings. Their own proxy (any proxy
    variable in managed `env`) or a cloud sign-in Claude Code would read from this computer's files → the
    chat doesn't start in the box: the older-protection card, with its reason (`orgProxy` / `orgSignIn`).
    Their own sign-in (managed `apiKeyHelper`, a key in their `env`, Bedrock / Vertex / Foundry with
    credentials in their settings) works in the box: no TRIF sign-in asked, the token not given, the cloud
    hosts through the relay. A chat's session follows it between the box and the older protection
    (claudesessions.js). Open (For Tim, round 8): plain-http collectors elsewhere; credential files; a
    proxy on this computer; carrying a boxed chat's turns back out.
- [x] **2. Daily CI against the latest Claude Code** *(round 8)*: whole-box-latest.yml (daily 06:17 UTC,
  by hand, or when it changes) runs all of whole-box.yml on npm's newest Claude Code in place of the pin and
  records what passed (artifact `claude-code-tested`); `node scripts/release.js claude-pin <version>`
  moves the pin only when a passed run tested exactly the packages the registry gives now. GitHub runs a
  schedule only from the default branch: daily once it's on main.

### Windows

- [ ] **9. Network without the admin loopback prompt.** On windows-latest: can the boxed claude.exe reach
  the relay without loopback (a named pipe the AppContainer is granted, or another no-admin path)? If none,
  the one-time admin prompt at setup (loopback exemption for TRIF's container). Build whichever works;
  trade-off in WHOLE-BOX.md for Tim.
  - [x] **9a.** *(round 9)* Tried: **no way without an administrator that keeps the box to the relay.** A
    pipe naming the container opens from inside, but Claude Code speaks only TCP and a container with no
    network capability can't listen, so nothing inside can carry its TCP to the pipe
    (`ANTHROPIC_UNIX_SOCKET` doesn't either). With `privateNetworkClientServer` (no administrator) the pipe
    path works end to end, but it opens the local network. WHOLE-BOX.md "Windows without an
    administrator?": options W1–W3.
  - [ ] **9b'.** Build Tim's pick: **W3** (11-21), the exemption + firewall rules in one administrator step.
    - [x] *(round 10)* winbox.js: one container `TRIF.FullSandbox` (its SID derived in JS, = Windows'),
      each run's folders on a capability of its own (fence.cs `runCapability`; two runs can't read each
      other's), TRIF's two ports chosen at setup (not excluded, free; in the rules' description), setup /
      remove (one elevated step: the exemption + four block rules) / status (active store, every profile
      on, the rules as made); the box's capability `privateNetworkClientServer` (with none, nothing
      connects). On windows-latest: the stand-in run and the real Anthropic through the relay at its port.
    - [x] **Windows Firewall rules don't filter loopback** (round 10) → *(round 11)* **TRIF's own WFP
      filters hold it** (helper/lib/win/wfp.cs, same administrator step): with the exemption the box reaches
      127.0.0.1 at TRIF's two ports and nothing else (this computer's other ports and address, ::1, UDP, the
      internet), with or without the firewall rules, the firewall on or off. Status reads them back without
      an administrator (TRIF's WFP objects readable by signed-in users). WHOLE-BOX.md "TRIF's own WFP filters".
    - [ ] Open (For Tim, round 11, not blocking): keep the firewall rules (Windows Firewall must be on) or
      drop them (the filters alone).
- [ ] **9b. Windows half of the rest:** pinned claude.exe (1), Credential Manager for the token (6), `trif`
  over MCP, no Bash (7), refusal errors (3), fallback (4), relay (8), managed settings in
  `C:\Program Files\ClaudeCode` (5), daily CI (2).
  - [x] **(1)** *(round 9)* claudepin installs the pinned claude.exe on Windows (the system's tar.exe by
    its full path) and checks its Authenticode signature: Valid, signed by "Anthropic, PBC" (`winSigner` in
    the pin file; Windows PowerShell's Get-AuthenticodeSignature without a PowerShell 7 PSModulePath). On CI.
  - [x] **(2)** *(round 10, nothing to build)* whole-box-latest.yml calls all of whole-box.yml, so the
    Windows probes (the W3 one included) run daily on the newest claude.exe too.
  - [x] **(8)** *(round 11)* The relay as on the Mac (platform-neutral): relay.test.js on windows-latest;
    the W3 probe's claude.exe reaches the real Anthropic through it at winbox's fixed port.
  - [x] **(3)** *(round 12)* Refusal errors on Windows, the parts that don't need the run code:
    boxrefusals.js `fromRunOutput` (what the box's programs were told: EPERM/EACCES lines, Claude Code's
    atomic `.tmp.<pid>.<hex>` writes named as the file, Claude Code's "Refusing to read …: where it leads on
    disk could not be determined", PowerShell's "Access to the path … is denied"; tool results and stderr
    only, never the model's words) and `fromNetEvents` (TRIF's filters' drops, `wfp events`); same words,
    same error line. On windows-latest the stand-in run's refusals are all named (the secret's and the other
    run's reads, the other site's and the home folder's writes) and nothing it was allowed. **WFP's net
    events: an administrator only** (as the person: access denied), so a run's connection refusals come
    from its own lines and the relay's (For Tim round 12, not blocking). Wiring into the Windows run's
    `_finish` when the branches meet.
  - [ ] **(4)** needs the Windows run code (branch windows: helper/lib/win/fence.js, runs.js): when the
    branches meet; winbox.status's problems map to the card's why lines (WHOLE-BOX-STRINGS.md).
  - [x] **(5)** *(round 12, the reading part)* claude-managed.js reads Windows' sources where Claude Code
    does (code.claude.com/docs/en/managed-settings): `C:\Program Files\ClaudeCode\` (file + drop-ins),
    `Settings` under `HKLM\SOFTWARE\Policies\ClaudeCode` and `HKCU\…` (each its own source); Windows paths
    in command hooks. On windows-latest the pinned claude.exe used the file, then HKLM over it, then HKCU
    alone, and TRIF's check listed each. The box's grants for them (read on `C:\Program Files\ClaudeCode`,
    as the probes do) come with the Windows run code.
  - [ ] **(6)** Nothing to build here: claudetoken.js uses keyring.js's setKey/getKey, which on the windows
    branch are Credential Manager (credman.js, same signatures; a setup-token token fits its 2560 bytes).
    Test when the branches meet.

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

### Round 6 (11-21): step 3b (only what matters in a failed run's error), step 4 (the informed fallback)

- **3b:** boxrefusals.js `ROUTINE`, `routine(r, ctx)`, `routineContext` (the run's homes: $HOME's and the
  account's, as macOS's `security` reads the account's; the private folder; the workspace; Claude Code's
  temporary folder; /private/… as /…). Narrow rules from round 5's CI list: the notification centre's
  shared memory; ~/.CFUserTextEncoding and the global preferences; the services analyticsd,
  SecurityServer, securityd.xpc, FSEvents; Xcode's / the Command Line Tools' `usr/lib(/libxcrun.dylib)`;
  `claude` listening on `cc-socks/<n>.sock` / `srt-mux-<n>-<n>.sock` in its own temporary folder, writing
  `agent-config/claude/plugins`, `~/Library/Caches/claude-cli-nodejs`, `~/.claude`, `~/.config` (the
  folders themselves); `node` (trif) reading config.json, helper.log, preinstalled.json. runs.js `_finish`:
  the log line has `refused` (the rest) and `routine`; the error and `done.boxRefused` only the rest; a
  failed run refused only routine things gets no box line. The watcher's duplicates are now per program
  (Claude Code's Read of config.json is no longer folded into trif's routine one). Seatbelt's network
  targets (`remote:*:80`: it often gives no address) read **a connection to port 80**.
- zsh's here-documents: claude.js gives runs `TMPPREFIX=<the run's temp folder>/zsh` (zsh ignores TMPDIR
  for them; round 5's CI saw zsh refused /private/tmp/zsh…, which would fail any heredoc in the box).
- **CI's real failed run:** managed settings `{"env":{"ANTHROPIC_BASE_URL":"http://192.0.2.1:80",
  "CLAUDE_CODE_MAX_RETRIES":"0"}}` (an organization's LLM gateway; TEST-NET). Claude Code takes the managed
  `env` over the run's, the box refuses the connection, the run fails in 1.2 s with Claude Code's "API
  Error: Unable to connect to API (EPERM)" and then **TRIF's full sandbox refused a connection to port 80
  (claude).**, nothing routine named. This is also step 5's case (a gateway the org's settings name: the
  relay will let it through); the helper doesn't read managed `env` yet.
- **4:** runs.js `_boxUnavailable(run, why, message)`: the pinned copy missing / downloading / changed /
  its check failing, or sandbox-exec's own `sandbox-exec: …` line before the agent began → an error with
  reason `boxUnavailable` and `why`, `done.error` `{kind: 'boxUnavailable', why}`; nothing runs, never a
  fallback by itself. `agent.start` `olderProtection: true` → that run with TRIF's rules for the user's own
  Claude Code, as with the setting off (logged `olderProtection`, `done.olderProtection`). host.js takes it
  from the extension's connection only (the socket: refused with a message, a run's token or not).
  background.js: `agent.start` with it from the panel page only (`isPanelPage`, else refused; only `true`);
  the error becomes a `boxFallback` card message; choosing it sets `chat.olderProtection` and every later
  message in that chat sends it, until a new chat; `chat.boxFallbackCard` (Not now). sidepanel.js
  `boxFallbackCard` (styled as the sandbox card), the `older protection` chip (sidepanel.html).
- Tests: wholebox-refusals.test.js +1 (routine: round 5's whole list yes; the same files to other programs,
  inside ~/.claude, other runs' folders, other homes, the probes, heredocs: no; odd characters in paths)
  and the end of a run with routine refusals (mixed: only the rest named; only routine: no line);
  agents.test.js +1 (the real helper, the setting on, no pinned copy: boxUnavailable, the fake user's
  claude not started; the socket refused, with and without a run token; the extension's olderProtection
  → the user's claude ran, `done.olderProtection`; the next run boxed again); extension.test.js +1 (the
  card, refused from a content script / another page / non-true, the chat's olderProtection sent with
  later messages, a new chat without it, Not now). run-sandbox.test.js (CI): the LLM-gateway run, and the
  missing-pin test now checks the card's reason and then the older protection starting the user's own
  (stand-in) Claude Code. Locally 330 tests across the agents, extension, wholebox-*, claudetoken,
  claudepin, agent-tools, run-folders, hardening, sandboxlint, agent-keys, explain, claude-managed suites.
- Not looked at in a browser: the card and the chip (drafts anyway).
- Finding: a chat whose earlier turns ran in the box keeps their session id, and the older protection's
  run resumes it with the user's own Claude Code, whose config folder (~/.claude) doesn't have it (boxed
  runs use TRIF's agent-config/claude): `--resume` would fail. The same happens today when the setting is
  switched on or off mid-chat. Most fallbacks come first in a chat (the copy still downloading), so it's
  left for a later step: the helper could start a fresh session when the session isn't in the config
  folder the run uses.

### Round 7 (11-21): step 8 (the relay), step 5a (organizations' network, hooks, IT-ADMINS.md)

- **8:** `helper/lib/relay.js`, replacing the allowlist proxy (wholebox.startProxy now starts it; same
  `seen`, so the refusal errors of step 3 work unchanged). CONNECT only, no TLS termination (bytes spliced
  after the 200). Strict parsing, `parseHead` (pure): `CONNECT host:port HTTP/1.x`, CRLF only, `name:
  value` headers with no control characters and no folding, ≤ 8 KB and 64 lines, checked before the head
  ends too; not CONNECT → 405 at once (an absolute URL's host is kept, for the error). Targets
  (`parseTarget`): DNS names in lower case, labels checked, no trailing dot, no number-like names
  (127.1, 2130706433, 0x7f.0.0.1), dotted-quad IPv4, bracketed IPv6 in one spelling; port 1–65535, no
  leading zero. Rules: exact host and port, no wildcards (`{host, port, local?}`). The name is looked
  up once and the relay connects to the checked address; an Anthropic host resolving to loopback,
  unspecified, link-local or multicast addresses is refused (`local address`, a refusal); an org host
  may be marked `local`. Limits: 10 s for the head and for connecting, 5 min idle, 64 tunnels. `seen`:
  {target, allowed, reason, failed, up, down, address}, at most 500; a listed host that can't be
  reached is `failed`, not a refusal. boxrefusals: "a connection to {host:port} (an address on this
  computer)", "a request its network relay couldn't read" (drafts, WHOLE-BOX-STRINGS.md).
- **5a:** claude-managed.js `orgNetwork(settings)` and `check().network`: managed `env` endpoints
  (`ANTHROPIC_BASE_URL`, the Bedrock/Vertex/Foundry base URLs, `OTEL_EXPORTER_OTLP_*ENDPOINT`) and HTTP
  hooks' URLs: https → the relay (that host and port); this computer → that port in the box's profile
  (wholebox.wrap `ports`); plain http elsewhere, not-URLs and their own proxy variables → `notes` (the box
  refuses them; the run's log says so); command hooks' absolute paths that are files → readable in the box.
  runs.js: `run.orgNetwork`, an `orgNetwork` log line; claudetoken.prepareBoxed `allow` (token runs:
  Anthropic + theirs; key runs: a relay with theirs only, `HTTPS_PROXY`; always `NO_PROXY` for this
  computer). Hooks run in the box already (Claude Code's children); nothing else needed for that.
- docs/IT-ADMINS.md (draft): what the box does, what it lets through, managed settings in it, what an admin
  sees (run logs' `orgSettings` / `orgNetwork` / `noShell` / `boxRefused`, helper.log), what's not yet there.
- **Races (cheap, done):** a run's `done` log line now has `usage` (input/output/cache tokens, turns,
  Claude Code's own ms and API ms: claude.js `usageOf`), `wallMs` and `boxed` (and `olderProtection`). Tim's
  race: the same prompt with the setting on and off, then compare the two runs' `done` lines in
  `~/Library/Application Support/TRIF/runs/<id>.jsonl`.
- The pty test's flake (rounds 6–7: "hung (typed)"): the stand-in program set raw mode after printing its
  prompt, so text typed at once was still cooked (Return → newline) and it waited for ever. Fixed in the
  test; the real setup-token flow types much later.
- Tests: tests/relay.test.js (8: targets, parseHead, local addresses, the server's tunnels and refusals, DNS
  to this computer, limits/cap/close, a fuzz of the parser (20k inputs, seeded; prefix-consistency: a
  request split anywhere can't read as another) and of the running relay (connects only to listed
  targets, every connection answered or closed, still works after)); tests/wholebox-org.test.js (4);
  claudetoken.test.js (prepareBoxed with org hosts). CI only (whole-box.yml): the pinned Claude Code in the
  box through the relay to the real api.anthropic.com with a made-up token (Anthropic refuses it: proves
  a real TLS session through the relay); the relay fuzzed with 200k inputs; managed settings with hooks
  and telemetry (`TRIF_TEST_MANAGED=org`). Locally ~380 tests across the suites, no regressions.

### Round 8 (11-21): step 5b (an organization's proxy, sign-in and clouds; sessions across modes), step 2 (daily CI, the pin step)

- **The org test strict** (whole-box.test.js `hooks and telemetry`): both hook events ran boxed, the hook's
  curl got nowhere (000), the HTTP hook and the OTLP logs went through the relay (made-up hosts: `failed`,
  not refused), the hook's curl to example.com refused by the relay, the metrics at the collector on this
  computer. Passed on CI.
- **Their own proxy** (claude-managed.js `orgNetwork().stops`, kind `proxy`): any of `HTTPS_PROXY`,
  `HTTP_PROXY`, `ALL_PROXY` (either case) in managed `env`, on another computer or this one → runs.js
  `_boxUnavailable(run, 'orgProxy', …)` before anything starts: the older-protection card, its why line
  from claude.js `boxOrgMessage`. Not chained: **CI showed Claude Code applies the managed `env` over the
  run's own** (it went to their TEST-NET proxy, not TRIF's relay; the box refused it: "Unable to connect to
  API (EPERM)"), and Seatbelt can't name another computer, so the relay can't sit between. (`HTTP_PROXY`
  too: Claude Code's https falls back to it.) `NO_PROXY` of theirs: noted.
- **Their own sign-in** (`signIn`): managed `apiKeyHelper` (its script readable in the box; it runs there
  like a hook), `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in their env, a cloud provider. Then
  claudetoken.prepareBoxed `orgSignIn`: no TRIF sign-in asked, TRIF's token not given (unset), Anthropic and
  their hosts through the relay; the run's `signIn` line says `organization`, `managed settings`. A sign-in
  of theirs failing in the box is a plain error saying so (not the panel's sign-in notice, which wouldn't
  help). CI: the pinned Claude Code ran the managed helper in the box and every request carried its key.
- **Clouds** (`cloud()`): Bedrock (`bedrock-runtime.<region>.amazonaws.com`, `bedrock.<region>…`, from
  `AWS_REGION` / `AWS_DEFAULT_REGION` / the small model's region, checked as region names), Vertex
  (`<region>-aiplatform.googleapis.com`, `aiplatform.googleapis.com` for global, each `VERTEX_REGION_*`),
  Foundry (`<resource>.services.ai.azure.com`); a base URL of theirs replaces the runtime host. Credentials
  in their settings work (keys in env, `awsCredentialExport`'s script, `CLAUDE_CODE_SKIP_*_AUTH`); else
  (this computer's ~/.aws, gcloud, Azure sign-in; a credentials file their env names) → a stop, kind
  `cloudSignIn` → `orgSignIn`. Unit-tested only (no cloud account on CI, as the rules say).
- **The card** (sidepanel.js): for `org…` reasons, "You can run this chat with the older protection: …"
  without "wait", and "Nothing ran." for Not now (drafts, WHOLE-BOX-STRINGS.md).
- **Sessions across modes** (helper/lib/claudesessions.js; runs.js `_spawn`, before the prompt): the
  session newest in the run's own config folder → resumed; newer in the user's (~/.claude or
  $CLAUDE_CONFIG_DIR) and the run is boxed → copied into the box's folder (its tool-output folder too,
  links left out, 0600); newer in the box's and the run isn't boxed → a new session (logged `session`
  `fresh`; the model gets the full context, not the reminder), nothing written outside. Carrying the box's
  turns out is For Tim.
- **Step 2**: `.github/workflows/whole-box-latest.yml` (daily 06:17 UTC; by hand with `-f claude-code=<v>`;
  when the file changes on whole-box) calls whole-box.yml (now also `workflow_call`, input `claude-code`)
  which then pins that version as the release step does (`claudepin.js pin`, the registry's checksums)
  before every step, and on success uploads `claude-code-tested` (version, the pin file, commit).
  `node scripts/release.js claude-pin <version> [--dry-run]`: newer than the pin, makePins from the
  registry, then a passed whole-box-latest run whose record names exactly those packages and checksums
  (`pinTestedProblem`), else it stops saying how to run the tests; writes helper/claude-code.json (commit
  it; the next release ships it). whole-box.yml's concurrency group now has the workflow's name, so the two
  don't cancel each other. **GitHub runs a schedule only from the default branch**, so it's daily once
  merged into main (Tim's); until then by push or by hand (`gh workflow run` needs it on main too).
- The real-Seatbelt unit test flaked in the first daily run (no report reached the log in 10 s while the
  step's own probe saw them): now up to three shells, 6 s each.
- Tests: wholebox-org.test.js (+3: proxies, sign-in and clouds, runs.js's stop and org sign-in),
  claudetoken.test.js (orgSignIn), claudesessions.test.js (2), release-claudepin.test.js (1); CI only:
  `apiKeyHelper` (TRIF_TEST_MANAGED=keyhelper), `own proxy` (TRIF_TEST_MANAGED=proxy, the real network:
  nothing reached it). Locally the touched suites pass (~280 tests); tests/update.test.js's web-ext part
  needs node_modules, which this worktree doesn't have (CI's `tests` workflow passes it).

### Round 12 (11-21): 9b(3) (refusal errors on Windows), 9b(5) (an organization's policy on Windows, reading)

- **helper/lib/win/wfp.cs `events <minutes>`**: FwpmNetEventEnum0 (x64 layouts in the file), classify-drop
  events of TRIF's seven filters only (by the IDs their keys have now), each {time, filter, layer, protocol,
  remote, remotePort, localPort, app}; also whether Windows collects net events and the events' DACL. An
  access refused → `denied`. winbox.js `netEvents` / `parseEvents`; `node winbox.js events [minutes]`.
- **helper/lib/boxrefusals.js**: `fromNetEvents(events, {since})` and `fromRunOutput({stdout, stderr})` (the
  run's own lines, above), `dedupe`; `describe` gains **opening {path}** and **a connection from {where}**;
  `~` for Windows homes. Draft words: WHOLE-BOX-STRINGS.md (the refusal line, Windows).
- **helper/lib/agents/claude-managed.js**: Windows' sources (above); `parseReg`, `readReg` (reg.exe, by full
  path), a test folder's `registry-hklm.json` / `registry-hkcu.json` stand for the values.
- **tests/whole-box/win-w3-probe.js** (strict): `wfp events` as an administrator after step 4 names the
  drops (1.1.1.1:443, another port on 127.0.0.1, …); as the person (Basic User) learned; the stand-in run's
  refusals named. **tests/whole-box/win-managed-probe.js** (new, strict; whole-box.yml windows job, with the
  Windows unit tests): the file / HKLM / HKCU, which one claude.exe used, TRIF's check.
- docs/IT-ADMINS.md Windows: where the policy is read; how refusals are named.
- Tests: wholebox-refusals.test.js +1 (Windows), winbox.test.js +1 (net events), claude-managed.test.js +1
  (Windows sources); locally 94 across the box's suites, no regressions; on windows-latest too.

### Round 11 (11-21): step 9b' (W3 holds: TRIF's own WFP filters), 9b(8)

- **helper/lib/win/wfp.cs** (P/Invoke to fwpuclnt.dll; `add <sid> <relay> <keyProxy>` / `remove` / `status`,
  one JSON line; `TrifWfp.Run` for Add-Type): a persistent provider + sublayer (weight 65535) of TRIF's,
  seven persistent filters on the container's package SID: connect4 permit TCP 127.0.0.1 at the two ports
  (weight 15) over a hard block (weight 1); hard blocks at connect6, accept4/6, listen4/6. One transaction;
  fixed keys. Security descriptor: system and administrators all, signed-in users read (WFP's default:
  administrators only, so status as the person read nothing: windows-latest, run 44954832561).
- **winbox.js**: the elevated setup/remove scripts carry wfp.cs (comments dropped, gzip, base64) and
  compile it with Add-Type (nothing run as an administrator read from a file); the elevated command line
  ~24,000 of 32,767 characters (unit-tested < 30,000), the outer non-elevated script now on stdin (encoding
  it twice would pass the limit). status({wfpExe}) / parseWfp: `filtersMissing`, `filtersChanged` (a block
  narrowed, a permit widened, not hard, another sublayer…), `filtersUnknown` (couldn't read: also a read
  refused); the rules' ports and the filters' must agree.
- **win-w3-probe.js** strict again (continue-on-error gone): plus the filters alone (rules out), the filters
  with the firewall off, status as a Basic User (runas /trustlevel:0x20000; Administrators deny-only).
  Results: WHOLE-BOX.md "TRIF's own WFP filters: W3 holds".
- Words: why lines for the filters changed / unreadable (WHOLE-BOX-STRINGS.md); IT-ADMINS.md Windows: the
  filters, how to list them.
- Tests: winbox.test.js 7/7 locally and on both CI jobs; relay.test.js on windows-latest too.

### Round 10 (11-21): step 9b' (W3: built; the firewall rules don't hold loopback), drafts

- **helper/lib/winbox.js** (platform-neutral text + parsing; PowerShell on Windows): `containerSid` /
  `capabilitySid` (Windows' derivations; registryRead's well-known SID in the unit test, the container's
  against fence.cs on CI), `choosePorts` (netsh's excluded ranges, listening ports; the relay and key proxy
  adjacent), `rules`, `setupScript` / `removeScript` (run elevated: `Start-Process -Verb RunAs`, the script
  on the encoded command line, never in a file; on CI directly), `statusScript` / `parseStatus` (no
  administrator; problems `notExempt`, `firewallOff`, `rulesMissing`, `rulesChanged`, `extraRule`).
  Not wired into runs (the Windows run code is on branch windows); header says it isn't the guarantee yet.
- **fence.cs `runCapability`**: one shared container; each run's entries (grants "to run", readonly)
  name a per-run capability only its token holds; cleanup keeps the container. (The real fence is
  helper/lib/win/fence.cs on branch windows: the same change there when the branches meet.)
- relay.start({port}), startFakeAnthropic({port}); win-inside.js: UDP and file-read targets.
- **tests/whole-box/win-w3-probe.js** (windows job, `continue-on-error` until the loopback part holds):
  results in WHOLE-BOX.md "W3 on windows-latest". Held: the SID, status before/after, setup twice (same
  ports), the relay's and key proxy's ports open, the internet closed, two runs apart, a normal stand-in
  run, the real Anthropic through the relay (401), status `firewallOff`, remove. **Not held: every other
  port on 127.0.0.1, this computer's address, ::1, UDP: open** (Windows Firewall doesn't filter loopback).
- Words: WHOLE-BOX-STRINGS.md, Windows' administrator step (on, off, refused, failed, firewall off) and the
  card's why lines (the change gone, firewall off, rules changed, port taken); round 8 item 4's one chat line
  (Tim: keep the new session; draft only). IT-ADMINS.md: a Windows section (marked as changing).
- Tests: winbox.test.js 5/5 locally and on both CI jobs; relay.test.js unchanged (8 pass).

### Round 9 (11-21): step 9a (Windows' network without an administrator: none that keeps the box to the relay), 9b(1) (the pinned claude.exe)

- **The probe** (tests/whole-box/win-net-probe.js, in whole-box.yml's windows job before the spike's probe):
  TRIF's pinned claude.exe in the fence's run container (lpac + registryRead), no network capability, no
  loopback exemption; pipe-bridge.cs (outside, as the user: a pipe with its own security, carried to a TCP
  port), box-shim.js (inside: a port of the container's own for Claude Code's `HTTPS_PROXY`, carried to the
  pipe), win-inside.js (what node in the container can open). Results: WHOLE-BOX.md "Windows without an
  administrator?" and Findings.
- **9b(1)**: claudepin on Windows: `%SystemRoot%\System32\tar.exe` (Git's GNU tar earlier on PATH would read
  `C:\…` as a host); after the sha512, Authenticode: Get-AuthenticodeSignature must say `Valid` and the
  signer's CN and O must both be `Anthropic, PBC` (claudepin.winSignatureProblem, unit-tested on what CI
  printed and on near misses). The first CI try read nothing: the step's pwsh 7 PSModulePath made Windows
  PowerShell load 7's Security module, which failed; now dropped for the check, and PowerShell's stderr
  goes into the error. The windows job installs the pin as the helper does (cached by the pin file) and
  every Windows probe uses it.
- Tests: claudepin.test.js (+1, the signature lines; the pin file's winSigner), 11 pass locally with
  release-claudepin.test.js. CI as below.

## For Tim (round 12): not blocking (nothing built for it)

**Windows: let the person read Windows' network-event log?** On the Mac, a boxed chat that fails names the
connections the box refused (from macOS's own reports). On Windows, TRIF's filters' refusals are in
Windows' network-event log, which only administrators can read (windows-latest: refused as the person).
TRIF names them anyway from what the programs in the box were told and from TRIF's relay, so for Claude
Code's own connections (always through the relay) nothing is lost; a tool's direct connection is named only
if its error says where (Node's usually does).

- **Leave it (recommended):** nothing changes on the computer; the error names what the programs said.
- **Open the log to signed-in users** (one more change in the same administrator step): every program's
  blocked connections, not only TRIF's, become readable by anyone signed in to that computer. A privacy
  change for the whole computer, for a small gain in the error's words.

## For Tim (round 11): not blocking (the loop goes on with the rules kept)

**Windows: keep the firewall rules, or drop them?** TRIF's own network filters (round 11) keep a chat in
the full sandbox to TRIF's connection by themselves: tested with the firewall rules taken out, and with
Windows Firewall turned off. The firewall rules on top add nothing we could measure, but they need Windows
Firewall on, so on a computer where another security product is the firewall (Windows Firewall off),
TRIF's full sandbox wouldn't start there (the card offers the older protection).

- **Keep both (as now):** two layers; the full sandbox needs Windows Firewall on.
- **Drop the rules (recommended):** the same protection with one mechanism (the filters), works whatever
  firewall the computer uses; less to set up, check and explain (IT-ADMINS.md gets shorter).

## For Tim (round 9): answered 11-21, "W3" (built in round 10, step 9b')

**How should TRIF's full sandbox on Windows reach Anthropic?** There's no way without an administrator that
keeps a chat to TRIF's relay only (round 9 tried a named pipe; details in WHOLE-BOX.md). Three choices:

- **W1, no administrator:** the pipe works if the sandbox gets Windows' "home and work networks"
  permission. The internet and this computer stay closed, but a chat could reach other devices on your
  network (router, printers, a NAS; at work, the company's internal servers).
- **W2, one administrator prompt at setup:** Windows' loopback exemption for TRIF's sandbox. A chat could
  reach TRIF's relay, and also every other server on this computer (development servers, databases).
- **W3, one administrator prompt at setup (recommended):** W2 plus firewall rules so the sandbox reaches
  only the relay's port. The same as the Mac. More to build (a fixed relay port, the rules, removing
  them when the setting goes off), and the rules need testing on CI first.

Until you choose, Windows keeps today's design (no full sandbox). Draft card words for W2/W3 are in
WHOLE-BOX-STRINGS.md.

## For Tim (round 8): answered 11-21: 1–3 keep; 4 keep (a new session; the optional chat line drafted in WHOLE-BOX-STRINGS.md, round 10)

1. **Plain-http telemetry collectors on other computers** (`http://collector.corp:4318`). The relay only
   carries `CONNECT` tunnels, so they're refused (noted in the run's log). Carrying them means TRIF
   forwarding plain HTTP to a host the organization named: the relay would read and pass on unencrypted
   requests. Recommendation: keep refusing; organizations can use https or a collector on the computer.
2. **Cloud sign-in files** (~/.aws, gcloud's application-default credentials, a
   `GOOGLE_APPLICATION_CREDENTIALS` file). The box doesn't open them, so such chats don't start in the box
   (the card offers the older protection). Opening them would put cloud credentials where the run's tools
   could read them (unlike the setup-token token, which is only in the environment). Recommendation: keep
   as is until an organization asks.
3. **A proxy on this computer** (a company's local agent, 127.0.0.1:port). The box could open that port, but
   then the proxy's own rules, not TRIF's, decide where a chat can connect. Recommendation: keep stopping
   (with the card), as for a proxy elsewhere.
4. **A boxed chat's turns back to your own Claude Code.** When a chat that ran in the box runs with the
   older protection, it starts a new Claude Code session (the full context is given again, the earlier
   turns aren't). Copying them out would let what a boxed run wrote steer a Claude Code outside the box.
   Recommendation: keep the new session; maybe a line in the chat saying so (words to draft).
5. Words: the round-8 drafts in WHOLE-BOX-STRINGS.md (the proxy / cloud why lines, the card's no-wait text,
   the org sign-in error).

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

- **Round 12, refusals on Windows** (windows-latest, run 44956934539, pinned claude.exe 2.1.330 in TRIF's
  container after the W3 step): Windows collects net events (FWPM_ENGINE_COLLECT_NET_EVENTS on); as an
  administrator `wfp events` read 8 drops by TRIF's filters for step 4's probe (node.exe: listening on a
  port, 127.0.0.1 and this computer's address at other ports, ::1 and this computer's address at the relay
  port, UDP, 1.1.1.1:443), each with the program's path (`\device\harddiskvolume3\…\node.exe`); as the
  person (Basic User): `FwpmNetEventCreateEnumHandle0` → 5, access denied (the events' DACL: administrators,
  Network Configuration Operators and a few services). Node in the box is told just `EACCES` for a refused
  connect. claude.exe's refused Write: "EPERM: operation not permitted, open '<file>.tmp.<pid>.<hex>'"
  (its atomic write); its refused Read: "Refusing to read <path>: where it leads on disk could not be
  determined (…)" (it can't examine the path); both now named as the file.
- **Round 12, an organization's policy on Windows** (same run, claude.exe not boxed): with
  `C:\Program Files\ClaudeCode\managed-settings.json` alone Claude Code used it; with HKLM's `Settings` too,
  HKLM (first wins, as the docs say); with only HKCU's, HKCU. Each time its managed `env` ANTHROPIC_BASE_URL
  won over the process's.

- **Round 9, Windows' network** (windows-latest, pinned claude.exe 2.1.330, the fence's lpac container):
  Node's default pipe and a pipe not naming the container: EPERM; a pipe whose access list names the
  container: opens and carries both ways, a low mandatory label not needed. With no network capability,
  `listen` on 127.0.0.1 inside: EACCES; 127.0.0.1 outside, its own LAN address, 1.1.1.1: EACCES. With
  `privateNetworkClientServer`: listening works; 127.0.0.1 outside and its own LAN address time out;
  the internet EACCES; shim → pipe → bridge → relay: the stand-in run worked (Read, Write, MCP; the secret
  "where it leads on disk could not be determined", another site's and the home folder's writes EPERM),
  and the real api.anthropic.com through the relay: three tunnels (≈2 KB up, 4.9 KB down; one 37 KB up),
  "Failed to authenticate. API Error: 401 OAuth access token is invalid." in 2.9 s. claude.exe's
  `HTTPS_PROXY` straight at the relay: "Can't reach the API server … (FailedToOpenSocket)", the relay saw
  nothing. `ANTHROPIC_UNIX_SOCKET` (in the binary, undocumented) set to the pipe: claude.exe opened it,
  sent 0 bytes, then FailedToOpenSocket. The pinned claude.exe: 387,754,656 bytes; Authenticode Valid,
  `CN="Anthropic, PBC", O="Anthropic, PBC"`, issuer DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1.
  Child processes started by node in the privateNetworkClientServer container: `spawn EPERM` (claude.exe's
  MCP child starts fine; not looked into).

- **Round 8, an organization's own proxy** (CI, pinned 2.1.330 in the box, managed `env` `HTTPS_PROXY` =
  `http://192.0.2.1:3128`, TRIF's relay as the run's own `HTTPS_PROXY`): the relay saw nothing; Claude Code
  ended at once with "API Error: Unable to connect to API (EPERM)". So the managed `env` wins over the run's
  environment (proxies too), and the box refused the proxy. Hence a stop, not a chain.
- **Round 8, an organization's apiKeyHelper** (CI, managed `apiKeyHelper` = a script in /Library/Application
  Support/ClaudeCode printing a made-up key, no `ANTHROPIC_API_KEY`): Claude Code ran it inside the box and
  both requests to the stand-in carried that key; the run worked (exit 0).
- (CI's stand-in runs print "Ignoring 6 permissions.allow entries from .claude/settings.json: this workspace
  has not been trusted": the test harness's own project settings file, not TRIF's run settings, which come
  by --settings.)

- **Round 7, the relay on the real network** (CI run 44882307668, pinned 2.1.330 in the box, a made-up
  setup-token token, `HTTPS_PROXY` = the relay): Claude Code went to `api.anthropic.com:443` (160.79.104.10)
  through the relay, three tunnels, a real TLS session both ways (≈2 KB up, 4.9 KB down each; one with
  the request, 113 KB up), and ended in 1.2 s with **"Failed to authenticate. API Error: 401 OAuth access
  token is invalid."** Nothing else was asked for. So Claude Code honours `HTTPS_PROXY` with
  `CLAUDE_CODE_OAUTH_TOKEN`, and the relay carries it untouched.
- **Round 7, an organization's hooks and telemetry in the box** (same run, `TRIF_TEST_MANAGED=org`): the
  command hooks ran inside the box (SessionStart, PreToolUse twice; each wrote its line in the run's copy;
  reading `~/.ssh/id_ed25519` → "Operation not permitted"; `curl https://example.com` → the relay
  refused example.com:443, not named); **the HTTP hook went through the relay** (CONNECT
  hook.trif-ci.invalid:443, allowed, no address: a made-up name); **OTLP logs over https went through the
  relay** (CONNECT otel.trif-ci.invalid:4318); **OTLP metrics to `http://127.0.0.1:47318` reached the
  stand-in collector** (5.6 KB) through the port the box opened. Claude Code's exporters and HTTP hooks
  honour `HTTPS_PROXY`/`NO_PROXY`.


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

**Everything left of the Windows half needs branch windows's run code** (9b(4) the fallback card from
winbox.status's problems; wiring 9b(3)'s refusals into the run's error, 9b(5)'s grants for the policy
paths, the status check before each boxed run, 9b(6) Credential Manager for the token, the per-run
capability in the real fence.cs; then 7 and 8 end to end on Windows). That needs whole-box and windows to
meet: **a merge is Tim's call**. Open questions for Tim (not blocking): round 11 (firewall rules), round 12
(the network-event log). After the merge: step 10 (Codex) once Claude Code is solid on both.

## CI

- Round 12: round 11's whole-box run [44956109515](https://github.com/acapellascience/trif/actions/runs/44956109515)
  (4d1318a) **passed** (macos, windows), its `tests` run 44956109643 passed. whole-box
  [44956934539](https://github.com/acapellascience/trif/actions/runs/44956934539) (1b525e7) **passed** (macos,
  windows): `wfp events` read as an administrator, refused as the person; the stand-in run's refusals as
  words; the Windows unit tests; win-managed-probe strict, all nine checks. The last commit's runs: below
  (it makes the refusal checks strict).

- Round 11: whole-box [44953977628](https://github.com/acapellascience/trif/actions/runs/44953977628) (79a5abc)
  **passed** (macos, windows): the W3 probe strict, **TRIF's WFP filters hold the loopback part**, with
  and without the rules, the firewall off too. [44954832561](https://github.com/acapellascience/trif/actions/runs/44954832561)
  (88b5865): macos passed; windows failed one check: status as a Basic User read the filters as missing
  (WFP's default security: administrators only; fixed in d033810). [44955244776](https://github.com/acapellascience/trif/actions/runs/44955244776)
  (d033810) **passed** (macos, windows): status as a Basic User ready, the filters read; winbox and relay
  unit tests 15/15 on windows-latest. `tests` passed for d033810 (44955244720).

- Round 10: whole-box [44952181864](https://github.com/acapellascience/trif/actions/runs/44952181864)
  (6d8976f): macos passed; windows failed: setup counted the probe's own listeners as busy (the rules named
  other ports; fixed, setup takes the ports). [44952587854](https://github.com/acapellascience/trif/actions/runs/44952587854)
  (8f49ddf): macos passed; windows: rules right, but every socket refused (no network capability).
  [44953062701](https://github.com/acapellascience/trif/actions/runs/44953062701) (ede48d8): windows: the
  results above (loopback not filtered); macos passed. `tests` passed for 6d8976f (44952181868) and
  8f49ddf (44952587942); ede48d8's (44953063038) still running at push time.

- Round 9: whole-box [44885239892](https://github.com/acapellascience/trif/actions/runs/44885239892) (b68cf50)
  passed: the pinned claude.exe installed and validly signed by Anthropic, PBC; the probe's node couldn't
  start (lstat C:\, fixed with --preserve-symlinks). [44885793055](https://github.com/acapellascience/trif/actions/runs/44885793055)
  (a8f871c) passed: the container's pipe results; the shim can't listen. 2623e2b's (44886363875) Windows
  failed: the new signature check read nothing (PSModulePath, fixed). [44886490084](https://github.com/acapellascience/trif/actions/runs/44886490084)
  (the privateNetworkClientServer path end to end, 401 from the real Anthropic) and
  [44887167150](https://github.com/acapellascience/trif/actions/runs/44887167150) (ANTHROPIC_UNIX_SOCKET)
  passed, macos and windows. The `tests` workflow passed for every round-9 commit it finished.

- Round 8: [whole-box 44883531774](https://github.com/acapellascience/trif/actions/runs/44883531774) (ab3e6e2,
  5b) **passed** (macos, windows): the org test strict; **an organization's apiKeyHelper run in the box, its
  key on every request**; **their own proxy taken over TRIF's relay and refused by the box** (Findings);
  every earlier step unchanged. 98a595e (step 2): whole-box
  [44883703284](https://github.com/acapellascience/trif/actions/runs/44883703284) passed; the first
  whole-box-latest run (44883703363, npm latest = 2.1.330 = the pin) failed only on the real-Seatbelt unit
  test's flake (fixed, 6324f86). 6324f86: [whole-box-latest
  44884256188](https://github.com/acapellascience/trif/actions/runs/44884256188) **passed** (its
  `claude-code-tested` record uploaded), [whole-box 44884256091](https://github.com/acapellascience/trif/actions/runs/44884256091)
  passed, `tests` [44884256083](https://github.com/acapellascience/trif/actions/runs/44884256083) passed (and
  for ab3e6e2, 98a595e).

- Round 7: [run 44882307668](https://github.com/acapellascience/trif/actions/runs/44882307668) (whole-box.yml,
  f92935c) macos **passed**: unit tests (relay, wholebox-org added); **the pinned Claude Code in the box
  through the relay to the real Anthropic (401 for the made-up token)**; the relay fuzzed with 200k inputs
  (4000 live connections); every earlier step unchanged; **managed hooks and telemetry in the box**
  (Findings). windows still running at push time (unchanged this round). Before it, 8f8e7e0's run
  (44881477614) failed only on the pty test's race (fixed, a36713a), and a36713a's (44881963224) on the
  real-network test not letting the box read its agent folder (fixed, f92935c), then was cancelled by the
  next push. The repo's `tests` workflow passed for 8f8e7e0, a36713a and f92935c (44882307647).

- Round 6: [run 44879684946](https://github.com/acapellascience/trif/actions/runs/44879684946) (whole-box.yml,
  9668cc9: 3b and 4) **passed** (macos and windows): **the LLM-gateway run failed in 1.6 s with "TRIF's full
  sandbox refused a connection to port 80 (claude)." and nothing else named**; the loosest-settings and
  loosen-shell runs' `refused` now hold only the probes (config.json read by the Read tool, the keychain
  file, `ls` of the private folder, another site's write), everything else under `routine`; zsh's /tmp
  refusal gone (TMPPREFIX). Before it, 10d2ace's run 44879165944 failed only on the words (Seatbelt said
  `remote:*:80`, read then as "a connection to remote:*:80"). The repo's `tests` workflow for 9668cc9
  ([44879684954](https://github.com/acapellascience/trif/actions/runs/44879684954)) failed: every
  claudetoken.test.js subtest but the last passed, then the file hung to its 180 s limit in the pty test
  (untouched since round 3, passed in every run before: a flake under the whole suite's load; it now has
  a 30 s watchdog that fails saying what it saw). 10d2ace's `tests` run (44879165967) passed. a233444
  (the missing-pin test now checks the card's reason, then the older protection starting the user's own
  stand-in Claude Code): [run 44880243221](https://github.com/acapellascience/trif/actions/runs/44880243221)
  **passed** (macos, windows), its `tests` run
  [44880243167](https://github.com/acapellascience/trif/actions/runs/44880243167) passed.

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
