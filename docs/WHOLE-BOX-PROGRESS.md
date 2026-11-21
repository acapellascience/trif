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
- [ ] **6. Sign-in via `claude setup-token`.** *(round 2: claudetoken.js + logins.js mode "token"; left:
  6b below)* Run once outside the box (the panel's login flow shows the
  URL/code), token stored in the Keychain via the helper (keyring.js; never in files, never printed),
  passed to the boxed run as `CLAUDE_CODE_OAUTH_TOKEN` (verify the variable). The box then needs no
  securityd. API keys keep working through the key proxy. Tests with stand-in tokens only.
- [ ] **6b.** The boxed run gets the token (`claudetoken.readToken` → `tokenEnv` in runs.js's whole-box
  path; keychain off in the box; with a saved API key, the key proxy as now); no token and no key → the
  run says so and the panel offers the sign-in (panel button: `agent.login {agent:'claude', mode:'token'}`
  through background.js, the same URL/code card); a token Anthropic refuses (expired, revoked) → "sign in
  again"; Settings: signed in for the full sandbox, with Sign out (`removeToken`). Check the real
  setup-token output from the CI probe first (step "Probe setup-token's output").
  **Round 2's probe: without a terminal it prints nothing useful** (below), so logins.js mode "token" needs
  a pseudo-terminal first: e.g. macOS's `/usr/bin/script -q /dev/null <claude> setup-token` (no new
  dependency; Windows: ConPTY, step 9b), then probe again on CI for the URL, the code prompt and the token
  line, and fix `parseSetupTokenLine` and the fake `claude` in tests/claudetoken.test.js to match.
- [ ] **7. Bash kept on macOS, boxed.** Claude Code's own sandbox off inside, its Bash inside TRIF's box
  (the spike does this). `trif` as an MCP tool only when an organization forces Claude Code's sandbox on
  (detected from managed settings: claude-managed.js) and on Windows.
- [ ] **3. Clear refusal errors.** When the box refuses something, the run's error names it (Seatbelt
  violation reports from the log / the relay's refusal), not a mystery failure.
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

## Findings

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

## Next

Round 3: step 6b (above): read the CI probe's real setup-token output first and fix the parser/fake to
match; then the token into boxed runs, the panel's sign-in offer and Sign out. Then step 7.

## CI

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
