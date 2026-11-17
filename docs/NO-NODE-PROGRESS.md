# No-Node progress

Design: docs/NO-NODE.md. Text people see: docs/NO-NODE-STRINGS.md (drafts for Tim).
Branch `no-node`, worktree ~/WebMods-worktrees/no-node.

## Checklist

- [x] 1. Research and design (docs/NO-NODE.md): private pinned Node runtime; curl|sh front door.
- [x] 2. `helper/runtime.json` (Node 24.22.3 pins) + `helper/lib/runtime.js`: platform key, fetch (update.js
      `fetchUrl`), SHA-256 check, unpack with `tar` into `<home>/runtime/<name>` via a temp folder and rename,
      keep only bin/node + LICENSE, `runtimeNode(home)`, prune old ones. Unit tests with a fake archive.
- [x] 3. setup.js: use the runtime's node for both wrappers and the Safari LaunchAgent (fetch it if missing;
      fallback `pickNodePath()` with a note); `--no-runtime` for git checkouts/dev. Tests.
- [x] 4. update.js: run the new package's setup with the runtime's node when present; doctor.js: check the
      runtime (present, hash of bin/node, runs) and say when TRIF is still on a system node. Tests.
- [x] 5. `trif uninstall` (manifests, LaunchAgent, bin, app, runtime; mods and private folder kept unless
      `--all`). Tests. Strings to NO-NODE-STRINGS.md.
- [x] 6. `scripts/install.sh` template + release.js step that fills it (package URL/sha, runtime pins) and a
      `release.js refresh-runtime` dry-runnable step that rewrites runtime.json from SHASUMS256.txt. Tests
      (dry run only, never a real release).
- [ ] 7. Front door text: extension `SETUP_COMMAND`, onboarding, background "not connected", help.js, README
      (drafts first in NO-NODE-STRINGS.md; never name agent products).
- [x] 8. Clean-machine test (macOS, local): temp HOME, PATH without node, install.sh against a local server
      with a built package, helper with a stand-in agent, `trif` in a real sandboxed run
      (`tests/run-sandbox.test.js` style), update from a previous build, uninstall.
- [x] 9. Upgrade test: a Node-based install of origin/main updates to this build, keeps ~/.trif, settings,
      paired phones (phone-link state if merged), and ends on the runtime.
- [ ] 10. CI: job on macos-latest and ubuntu-latest that builds, removes node from PATH, runs 8 and 9; CI
      tests on the pinned Node version.
- [ ] 11. Size and startup time recorded here; phone-link branch checked on the runtime (crypto X25519, http).
- [ ] 12. Windows: list what's left for branch `windows` (node.exe zip, .cmd wrappers) once it's on main.

## Measurements

- Node 24.22.3 archives: darwin-arm64 .tar.xz 27.5 MB, darwin-x64 29.3 MB, linux-x64 32.1 MB,
  linux-arm64 31.0 MB, win-x64 .zip 37.8 MB (nodejs.org Content-Length, 2026-11-17).
- The real runtime (round 1, this Mac, darwin-arm64): download + verify + unpack 15.7 s; 129 MB on disk
  (bin/node + LICENSE); no quarantine attribute (only com.apple.provenance); signed
  "Developer ID Application: Node.js Foundation (HX7739G8FX)"; `trif --version` on it 130-170 ms;
  `vm.Script` syntax check works.
- Clean-machine test (round 6, this Mac, darwin-arm64, tests/clean-machine.test.js): install.sh with a local
  server and the cached real archive 7.8 s; on disk runtime 139 MB (du), app 7.5 MB; package (npm pack)
  2.7 MB; `trif help` on the runtime 57-60 ms warm, ~230 ms the first time; `trif update --install` (local
  server, runtime kept) 0.26 s; the whole test 18.6 s incl. a Claude Code and a Codex run.
- Upgrade test (round 7, this Mac, tests/clean-machine.test.js second test): the v0.3.0 updater installs
  this build and setup fetches + unpacks the runtime (local server, cached archive) in 4.3-4.5 s; whole
  test 6.8 s.
- Today (system Node 22): `node -e 0` 20-50 ms, `node helper/cli.js --version` 70-130 ms.

## Done this round

- Round 1: researched SEA / Bun / Deno / private runtime / rewrite; wrote docs/NO-NODE.md, this file,
  docs/NO-NODE-STRINGS.md. Recommendation: private pinned Node runtime (no signing by Tim, same engine
  as tests, small updates); curl|sh installer.
- Round 1, step 2: helper/runtime.json (Node 24.22.3 pins, all platforms) + helper/lib/runtime.js
  (ensureRuntime, installedNode, pruneRuntimes, runtimeInfo) + tests/runtime.test.js (5 pass); smoke-tested
  against the real nodejs.org archive in a temp HOME. CI green: https://github.com/acapellascience/trif/actions/runs/44170185742
  (clickjack-browser flake once, rerun passed; design commit run 44169238711 green).

- Round 2, step 3: setup picks the node with `chooseNode` (lib/setup.js): TRIF's own runtime for copies,
  downloaded via `ensureRuntimeSync`; fallback with a note; `--runtime`/`--no-runtime`, `TRIF_RUNTIME`;
  prunes older pins unless the Safari plist names them. tests/setup-runtime.test.js (3: real setup against a
  local server, wrappers run on the fake runtime, pin bump, fallback). Local non-browser suite 872/875 pass
  (the only failure: release-script test needs node_modules/.bin/web-ext, absent in this worktree; not this
  change). CI: https://github.com/acapellascience/trif/actions/runs/44174209142 green after one rerun
  (codex-sandbox.test.js mailbox-wait timing flake, passes locally).

- Round 3, step 4: update.js runs the new setup on TRIF's own Node with 10 min (tells setup via
  TRIF_SETUP_TIMEOUT_MS); doctor checks the runtime (whole, pin, damaged, still on system Node). New tests
  in setup-runtime (3) and update (1 + asserts); locally update/cli/runtime/upgrade + 9 related files pass
  (only the known web-ext ENOENT release test fails, no npm install here). CI: https://github.com/acapellascience/trif/actions/runs/44177557546 green (attempt 1 cancelled: no macOS runner within 15 min; rerun passed)

- Round 4, step 5: `trif uninstall [--all [--yes]]` (helper/lib/uninstall.js; cli.js handler, help.js, NOT_IN_RUNS);
  tests/uninstall.test.js (4 pass: real setup then uninstall in a temp HOME, another workspace's manifest
  kept, setup again restores, --all needs --yes off a TTY, fake-keychain key removed, outside modsDir kept,
  running helper stopped, non-workspace refused). Locally cli/install/setup-runtime/runtime/explain/
  extension/sweep 256/256 pass. CI: https://github.com/acapellascience/trif/actions/runs/44182632765 (attempt 1: 892 pass, only the known clickjack-browser flake failed; rerun: the same, 892 pass, only clickjack-browser failed again; the known flake, moved on per the rules)

- Round 5, step 6: scripts/install.sh (POSIX sh template: platform incl. Rosetta, xz-or-gz, curl https-only
  with --proto-redir, shasum/sha256sum, all in main() so a cut-off pipe runs nothing, setup's stdin
  /dev/null, `sh -s -- <setup args>`); release.js `installScript` (fills it, attached as release asset
  install.sh), `runtimePins`/`runtimePinsProblem` (preflight check), `refresh-runtime [<ver>] [--dry-run]`
  (dry run against nodejs.org reproduces helper/runtime.json byte for byte); runtime.js `archiveFile` /
  TRIF_RUNTIME_ARCHIVE so setup keeps install.sh's download (still hash-checked). Tests: install-script (4,
  incl. `cat | sh` with no node on PATH vs a local server), runtime (+1), setup-runtime (+1). CI: https://github.com/acapellascience/trif/actions/runs/44186997274 green on attempt 1 (clickjack passed this time).
  Previous round's CI rerun (44182632765) and 44185286312: only clickjack-browser failed (a timing assert,
  "the second look: 18.10 ms at most"); 3 runs in a row now, all timing; not touched by this branch.

- Round 6, step 8 (before 7: Tim hasn't answered For Tim): tests/clean-machine.test.js, 8/8 pass locally
  with real Claude Code and Codex runs (18.6 s); helper/install-script/run-sandbox 43/43 still pass.
  CI: https://github.com/acapellascience/trif/actions/runs/44190037064 green (clean-machine test skipped there: opt-in until step 10). Previous run 44188683245: only the clickjack-browser flake.

- Round 7, step 9 (7 still waits on For Tim 2 and 4): second test in tests/clean-machine.test.js, the
  upgrade from a Node-based install. Passes locally from v0.3.0 (default) and from origin/main
  (`TRIF_UPGRADE_FROM=origin/main`); the whole file 13/13 incl. step 8's real Claude Code and Codex runs.
  CI: CI_LINK_9

## Next step

Step 7 (front door text) if Tim has answered For Tim 2 and 4; else step 10 (CI job on macos-latest and
ubuntu-latest: TRIF_CLEAN_MACHINE=1, node off PATH for the TRIF parts, tests on the pinned Node; fetch the
upgrade tag, e.g. `fetch-depth: 0` or `git fetch --tags`, else the upgrade test skips).

## Notes for next round

- Step 9 as built: `git archive <FROM>` (default v0.3.0, the release people have; `TRIF_UPGRADE_FROM`
  overrides; skipped if the ref is missing) packed at its own version with a test release key; this build
  packed one patch up. Old install = the old package's `helper/cli.js setup --copy --browser chrome,safari`
  on the system node (a folder holding only a `node` link, so PATH=<that>:/usr/bin:/bin), as npx does.
  Seeded: a mod, config keys, `<private>/phone-link.json` (phone-link's store file, branch not merged), the
  phone link's keyring item (service "TRIF phone link", account "computer") and an agent key. Then the old
  wrapper's `trif update --install` with TRIF_RUNTIME=<pins pointing at the local server> (the old updater
  passes its env to the new setup); checks: app at the new version, runtime installed, both wrappers and
  the Safari plist name it (not the system node), manifest path unchanged, nothing lost (keyring items
  identical). Then the node folder is deleted: help, doctor (own-Node line, no warnings), the helper via
  bin/trif-host (ps shows the runtime) and `trif tabs` all work.
- Risk not tested: the old updater kills setup at 120 s, so setup's download budget under it is 75 s; a
  slow connection (~<3 Mbit/s for 28 MB) falls back to the system node with a note, and that install moves
  to the runtime only at the next update or `trif setup --runtime`. doctor's warn line covers it.
- `pack(S, version, key, root)` now takes the source root.

- Step 8 as built: tests/clean-machine.test.js, opt-in `TRIF_CLEAN_MACHINE=1` (skipped otherwise, so CI
  skips it until step 10 sets it). npm-packs this checkout twice (0.1.0 with a test release key, and the
  current version as shipped), serves both + the real pinned archive (cached in TRIF_TEST_NODE_CACHE or
  <tmp>/trif-node-archives, sha-checked) from a child-process server; env has PATH=<agentbin>:/usr/bin:/bin
  and no NODE_TEST_CONTEXT (else setup turns the runtime off). Subtests: install.sh piped to sh
  (`--browser chrome,safari --no-link --no-examples`; wrappers, Chrome manifest, Safari plist all name the
  runtime's node), help/doctor/status, the helper started through bin/trif-host (FakeExtension `command`
  option, new) + `trif tabs`, real Claude Code and Codex runs (native binaries only; skipped where absent,
  e.g. CI) running trif status/tabs/new/check/verify/mods/doctor, Codex also `command -v node` = exit 1,
  `trif update --install` from a signed local feed (keeps a user mod and a config key, same runtime),
  `trif uninstall --all --yes --bin-dir <tmp>` (workspace, private folder, manifest, plist, keys gone).
- Commands needing the stand-in extension must run async (runAsync): spawnSync blocks its answers.
- Linux: the test should run there (no agents, plist checks are darwin-only); not tried yet: step 10.
- Step 4's open question (should setup re-verify the runtime's hash?): left as is; doctor reports damage.
- `trif` has no --version (round 1's timing was `node helper/cli.js --version`?); startup timed on `trif help`.

- Step 6 as built: install.sh unpacks Node into its temp folder only, runs `<node> package/helper/cli.js
  setup --copy "$@"` with TRIF_RUNTIME_ARCHIVE=<the archive>; runtime.js `ensureRuntime({archiveFile})` uses it
  when its basename is one of this platform's pins (sha still checked), else downloads as usual; so the
  MARK file and folder shape stay owned by runtime.js. setup skips its "Downloading Node" line then.
- release() writes dist/release/<v>/install.sh (mode 755) from src's template and pins and attaches it;
  releases/latest/download/install.sh is then a stable link. Not exercised by a full `release.js <v>
  --dry-run` this round (needs a CHANGELOG section for a new version); step 8 should run one in a copy, or
  call installScript on an `npm pack` result directly.
- installScript accepts only plain https package URLs and 64-hex SHAs (single-quoted into the script);
  tests rewrite the filled lines to point at 127.0.0.1 (install.sh allows http only to 127.0.0.1/localhost).
- refresh-runtime: default = newest release of the pinned major from nodejs.org/dist/index.json;
  `TRIF_NODE_DIST` overrides the dist URL (tests); SHASUMS256.txt.sig (GPG) still not checked.
- Windows: install.sh refuses MINGW/MSYS/Cygwin; branch `windows` needs an install.ps1 counterpart (win-x64
  .zip pins are already in runtime.json; installScript leaves them out of install.sh).

- Step 5 as built: uninstall takes the install lock (refuses during an update), removes only manifests
  whose `path` is in this workspace's bin (all browserTable dirs, or `--native-dir`), Safari plists whose
  TRIF_HOME is this home (none = the default home), `trif`/`webmods` links in `--bin-dir` (default
  /usr/local/bin) to this workspace's wrappers, SIGTERMs helpers from `helper-<pid>.sock` whose `ps`
  command has host.js, then bin/, app/, runtime/, `.app.new-*`/`.app.old-*`/`.update-*`, sockets.
  `--all`: keyring keys (agentkeys AGENT_KEYS + codex-oss removeKey; skipped when the keyring tool is
  missing), private folder, boxRoot() (and its empty parent unless TRIF_BOX_ROOT), ~/.webmods link, home;
  a modsDir outside home is kept. Refuses a folder without bin/app/sites/AGENTS.md, and the home folder.
  Interactive --all asks to type "delete". Windows: deleting runtime/node.exe while it runs fails (it's the
  process running uninstall): branch `windows` needs a deferred delete (a .cmd that waits, or
  MoveFileEx on reboot) and its registry keys (HKCU NativeMessagingHosts) removed here.
- uninstall leaves the extension itself (Chrome loads it unpacked from <home>/app/extension, now gone: Chrome
  shows it as failed to load); the last line tells the user to remove it. README Uninstall rewrite is a
  step-7 draft in NO-NODE-STRINGS.md.

- Step 4 as built: update.js `updateNode(home)` (the running node if it's already a runtime, else
  `R.installedNode(home)`, else `process.execPath`); setup run with `timeout: SETUP_TIMEOUT_MS` (10 min,
  under lock.js's 15 min stale age) and `TRIF_SETUP_TIMEOUT_MS` in its env; setup.js `downloadBudget(env)`
  = that less 60 s (min 30 s, max 10 min), 75 s when the lock is held without it. runtime.js
  `runtimeOf(node, home)` / `checkRuntime(node, home)` (MARK, sha of bin/node, --version); doctor.js
  `runtimeCheck` after the host-wrapper line: ok / warn (older pin) / fail (damaged: rm -rf + setup) /
  warn (copy on system node: `trif setup --runtime`) / info (git checkout, runtime off, no platform).
- installedNode doesn't hash, so setup won't replace a damaged runtime by itself: doctor says remove it.
  Maybe setup should re-verify the hash and re-fetch (0.3 s for 110 MB); decide in step 8.
- doctor's top "Node vX" line still says "install a current Node from nodejs.org" when the running node is
  <18; step 7 (front door text) should change that fix too.

- Step 3 as built (lib/setup.js `chooseNode`): runtime by default for mode copy (npx, updates, install.sh),
  the running node for mode link (git checkouts) unless `--runtime`; `--no-runtime` / `TRIF_RUNTIME=off`
  never; `TRIF_RUNTIME=<pins.json>` for tests (fake archive on a 127.0.0.1 server: tests/setup-runtime.test.js);
  under `node --test` (NODE_TEST_CONTEXT) unset means off. tests/fake-extension.js `testEnv`, upgrade.test.js,
  e2e/lib/install.js and run-sandbox.test.js set `TRIF_RUNTIME=off` (steps 8/9 flip it with fake or real pins).
- setup stays synchronous (mergeable with `windows`): the download runs in a child, `node runtime.js ensure
  <home> [pins]` (`ensureRuntimeSync`). Under an update (TRIF_INSTALL_LOCK set) it gets 75 s, since old
  updaters kill setup at 120 s; on failure setup keeps the running node and notes it (exit 0).
- Pruning runs after the Safari agent is written and keeps any runtime the Safari plist still names (a setup
  for other browsers doesn't rewrite it). Errors removing a runtime (Windows, node.exe in use) are skipped.
- install.sh (step 6) should unpack the runtime into `<home>/runtime/<name>` with a `.trif-runtime.json`
  (installedNode requires it), or into a temp folder and let setup fetch: decide there.

- Windows branch keeps `nodePath` as the single thing wrappers name (win/setup.js `writeWrappers`):
  change how setup *chooses* `nodePath`, not the wrapper writers, to stay mergeable.
- Upgrade path: the old helper runs the new package's `helper/cli.js setup --copy` with its own node
  (update.js installLocked), so setup must fetch the runtime itself; keep the package JS-only (old
  clients cap packages at 50 MB, update.js PACKAGE_MAX).
- runs.js `runLimits` reads node's prefix from `process.execPath`; under the runtime it's
  `<home>/runtime/node-v…`; keep the runtime out of the private folder (denied to runs).
- Pins come from https://nodejs.org/dist/v24.22.3/SHASUMS256.txt (GPG-signed .sig beside it; verifying
  that in release.js is a nice-to-have).
- Linux: prefer .tar.xz, fall back to .tar.gz when `xz` isn't installed (both pinned).

- **Node 24 vs the tests (found round 1)**: under the runtime's Node 24.22.3, tests/runtime.test.js passes,
  tests/update.test.js runs all 18 tests but `release script: secrets go to security and web-ext in no argv
  or environment` fails (round 2: on Node 22 too, here it's `spawn node_modules/.bin/web-ext ENOENT`,
  the worktree has no `npm install`; check that's the whole story on Node 24), and the file's
  process then never exits (an open handle; Node 22 exits). Both are test/release-side, but CI must run on
  the pinned version (step 10): fix them first, then run the whole suite on Node 24 locally (one browser
  suite at a time). Downloaded runtime for local use: re-fetch with `ensureRuntime(<temp home>)`.
- Tests must never download the real runtime: inject `pins`/`fetch` (runtime.js takes both), or a
  TRIF_RUNTIME env switch for subprocess tests (setup via the CLI).

## For Tim

Not blocking steps 2-6 (they follow the recommendation and are easy to change):
1. **Runtime choice**: private pinned Node (recommended: ~28 MB download, ~110 MB on disk, no signing for
   you) vs Bun (~2x smaller, but a different JS engine from Chrome's, so syntax checks and Node behaviour
   differ) vs a Node SEA (one `trif` file, but you'd re-sign every release and updates become full binaries).
2. **Front door** (needed by step 7): `curl -fsSL https://timsrobot.com/install.sh | sh` shown in the panel
   and README (recommended), and/or a signed .pkg later (needs your Developer ID Installer certificate and
   notarization in release.js). Keep `npx timsrobot setup` as the alternative for people with Node?
3. **Uninstall** (built in step 5, easy to change): `trif uninstall` keeps mods and settings by default;
   `--all` removes them and the saved API keys, after typing "delete" at a terminal or with `--yes`.
   Wording drafts in NO-NODE-STRINGS.md.
4. **Where install.sh lives** (step 6 built it as a release asset): the command can name GitHub's
   `https://github.com/acapellascience/trif/releases/latest/download/install.sh` directly (works today, no
   site change), or timsrobot.com/install.sh redirecting there (a site deploy, yours). Recommended: the
   timsrobot.com address, as a redirect, so the panel text survives a repo move.
