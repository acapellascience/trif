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
- [ ] **1b. The setting.** "Run chats in TRIF's full sandbox" (opt-in), replaces `TRIF_WHOLE_BOX=1`;
  turning it on downloads the pinned Claude Code in the background (progress in the panel); a run before it
  is there gets the informed fallback (step 4).
- [ ] **6. Sign-in via `claude setup-token`.** Run once outside the box (the panel's login flow shows the
  URL/code), token stored in the Keychain via the helper (keyring.js; never in files, never printed),
  passed to the boxed run as `CLAUDE_CODE_OAUTH_TOKEN` (verify the variable). The box then needs no
  securityd. API keys keep working through the key proxy. Tests with stand-in tokens only.
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

## Findings

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

Round 2: step 1b (the setting, background download) and start step 6 (`claude setup-token`: verify the
variable name and the output format from the docs; a fake `claude` for tests).

## CI

- Round 1, [run 44869998053](https://github.com/acapellascience/trif/actions/runs/44869998053) (whole-box.yml):
  macos **passed**: claudepin unit tests 8/8; the real pin installed by `claudepin.js ensure` (2.1.330,
  checksum and signature passing, `--version` ok); whole-box.test.js with the pinned binary (5 pass, the
  sandbox-on one runs in its own step); run-sandbox today's sandbox, and with `TRIF_WHOLE_BOX=1` on the pin
  (2/2, the missing/changed test included); the managed-settings steps (loosen everything; force Claude
  Code's sandbox on) on the pin. windows job unchanged this round (the spike's probe; still running at
  push time). The repo's `tests` workflow: [run 44869997926](https://github.com/acapellascience/trif/actions/runs/44869997926).
