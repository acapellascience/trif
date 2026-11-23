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
- [x] 7. Front door text: extension `SETUP_COMMAND`, onboarding, background "not connected", help.js, README
      (drafts first in NO-NODE-STRINGS.md; never name agent products).
- [x] 8. Clean-machine test (macOS, local): temp HOME, PATH without node, install.sh against a local server
      with a built package, helper with a stand-in agent, `trif` in a real sandboxed run
      (`tests/run-sandbox.test.js` style), update from a previous build, uninstall.
- [x] 9. Upgrade test: a Node-based install of origin/main updates to this build, keeps ~/.trif, settings,
      paired phones (phone-link state if merged), and ends on the runtime.
- [x] 10. CI: job on macos-latest and ubuntu-latest that builds, removes node from PATH, runs 8 and 9; CI
      tests on the pinned Node version.
- [x] 11. Size and startup time recorded here; phone-link branch checked on the runtime (crypto X25519, http).
- [x] 12. Windows, built on branch `windows` (Tim 11-23: "we should build no-node for windows", before
      `windows` reaches main): node.exe from the pinned .zip, the .bat/.cmd wrappers on it, install.ps1
      served by the site, uninstall, the upgrade, CI job `clean-machine` in windows.yml. Below and in
      docs/NO-NODE.md "Windows"; docs/WINDOWS-PROGRESS.md "No Node on Windows".

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
- CI (round 8, run 44193233783, tests/clean-machine.test.js): macos-latest (arm64) install.sh 12.0 s,
  runtime 135 MB, app 7.5 MB, `trif help` 114-256 ms, update 0.4 s, upgrade from v0.3.0 5.6 s; ubuntu-latest
  (x64) install.sh 3.0 s, runtime 127 MB, app 6.2 MB, `trif help` 49-53 ms, update 0.2 s, upgrade 1.7 s.
- Phone link on the runtime (round 9, this Mac, origin/phone-link 564528f merged with no-node in a scratch
  worktree, not pushed): stand-in phone's Noise_IK handshake + hello to the installed helper on TRIF's own
  Node 9-12 ms; the phone-link suites on bare Node 24.22.3 (PATH = its bin + /usr/bin:/bin) 132/132 in 31.7 s.
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
  CI: https://github.com/acapellascience/trif/actions/runs/44191011295 green (the new tests skip there: opt-in until step 10).

- Round 8, step 10 (7 still waits on For Tim 2 and 4): .github/workflows/test.yml job `clean-machine`
  (macos-latest + ubuntu-latest, fail-fast off): runner node = the pinned version read from
  helper/runtime.json; every other node/npm/npx/corepack on PATH, /usr/local/bin, /opt/homebrew/bin deleted
  and checked gone; on macOS real Claude Code (claude.ai/install.sh) and Codex (brew cask) installed, so
  their sandboxed runs run too; TRIF_CLEAN_MACHINE=1. 13/13 pass on both, no skips on macOS (Linux skips
  the two agent runs). The `unit` job now runs on Node 24.22.3 too (908 tests green, run 44192560390).
  Fixed tests/update.test.js: a web-ext spawn error left its server open and hung Node 24.
  CI: https://github.com/acapellascience/trif/actions/runs/44193233783 (all green; unit needed one
  rerun for the clickjack-browser flake), https://github.com/acapellascience/trif/actions/runs/44192560390 green.

- Round 9, step 11 (7 still waits on For Tim 2 and 4): phone-link checked on the runtime. origin/phone-link
  (564528f) merges into no-node with no conflicts. On bare Node 24.22.3 with no other node on PATH: its 15
  non-browser phone suites 132/132 (pure branch), and on the merge those + extension/run-sandbox/
  run-scope-reads/runtime/setup-runtime/uninstall/install-script 308 pass, 2 skipped (opt-in), 0 fail; the
  merged tree's clean-machine file 13/13 (real Claude Code and Codex runs). New: the upgrade test seeds real
  phone-link state once the branch is merged and the paired phone reconnects to the helper on the runtime.
  CI: https://github.com/acapellascience/trif/actions/runs/44195812789 green on attempt 1 (unit, clean-machine
  macOS + Linux). Previous run 44194903097: only the clickjack-browser flake.

- Round 10, step 7 (Tim answered For Tim 1-4): front door text on the branch. One install command,
  `curl -fsSL https://timsrobot.com/install.sh | sh` (paths.js INSTALL_COMMAND = extension/lib.js
  SETUP_COMMAND; Safari `sh -s -- --browser safari`), new RESETUP_COMMAND `~/.trif/bin/trif setup` for
  "install an agent, then set up again"; "needs Node 18+" gone from panel/onboarding/background; README
  (requirements, install, Firefox, Safari, updates, troubleshooting, uninstall via `trif uninstall`,
  releasing), help.js, doctor/update fixes, PROTOCOL.md, beta START HERE files. Drafts:
  docs/NO-NODE-STRINGS.md. Merged origin/main (the install.sh redirect). New test in
  tests/install-script.test.js (the command is the same in extension, CLI, README, site route). CI: https://github.com/acapellascience/trif/actions/runs/44211356838 green on attempt 1. Previous run 44196244739: only the clickjack-browser flake.

## Next step

Nothing on the checklist is open. Waiting on others: Tim's words (NO-NODE-STRINGS.md, WINDOWS-STRINGS.md
47-55), `windows` and release-0.4.0 meeting main (install.ps1's delivery copies release-0.4.0's install.sh
pattern; when they meet, site/src/index.js gets both routes, release.js both modules). (Tim reviews the step-7 drafts in docs/NO-NODE-STRINGS.md; apply
his changes if he sends any.)

## Notes for next round

- Step 12 as built (branch `windows`, 11-23): see docs/NO-NODE.md "Windows". Found on the way, each seen in
  Tim's Windows 11 ARM VM and on windows-latest: Windows' tar.exe takes its arguments in the console's code
  page (a profile folder with an accent reached it as "Zo? ??": run it in the folder with relative ASCII
  names); a Windows PowerShell started from PowerShell 7 can't load Get-FileHash (7's module folders: .NET's
  own SHA256 and WebClient instead); Node's children die with it (its job), and a detached PowerShell has no
  console and doesn't start (uninstall's deferred delete goes through Start-Process); in PowerShell
  `--browser chrome,edge` is an array (quote it); Node has navigator.platform "win32" (the extension tells
  Windows by the browser's userAgent).

- Tim's answers (2026-11-17), now the plan: (1) TRIF ships its own pinned Node (the private runtime);
  (2) the main install command is `curl -fsSL https://timsrobot.com/install.sh | sh`, `npx timsrobot setup`
  stays as the second option for people with Node; (3) `trif uninstall` keeps mods and settings, `--all`
  removes everything; (4) install.sh lives at timsrobot.com/install.sh: the redirect (site/src/index.js
  `INSTALL_SH` → releases/latest/download/install.sh, tests/site.test.js) is on main and merged here; it
  404s until the next release attaches install.sh. Don't deploy the site.
- Step 7 as built: not run, the browser e2e (tests/e2e/scenario.js gate note regex updated to the curl
  text); unit tests cover the strings (extension.test.js not-connected error, safari.test.js both commands,
  install-script.test.js front door). Mergeability with `windows`: it edits README's requirements block (its
  "Windows 10/11" line sits two lines above the removed Node line) and doctor.js's setupFix lines; Windows
  will need its own SETUP_COMMAND (an install.ps1 one-liner) and INSTALL_COMMAND, so keep both defined in
  one place each (lib.js, paths.js) when that lands. README's Windows section says `npx timsrobot setup`.

- Step 11 as built: tests/clean-machine.test.js `PHONE_LINK` (helper/lib/phonelink/noise.js exists, i.e. after
  phone-link merges): the upgrade test then seeds the store's real format (computer key pair in the keyring,
  service "TRIF phone link"/account "computer", base64url; phone-link.json {on, sync, publicKey, port: 0,
  phones:[{id: keyId, name, key, pairedAt, lastSeen}]}) and, after the system node is deleted, asks the
  installed helper `phone.status` (listening, port) and connects tests/phone-link-client.js with the phone's
  keys: hello answered. Before the merge it seeds the old stand-in file (only "kept byte for byte" is checked).
  Every helper in that test gets TRIF_DNS_SD = a /bin/sh stand-in (sleep) and TRIF_PHONE_LINK_HOST=127.0.0.1.
- What phone-link needs from Node: crypto x25519 (generateKeyPairSync, diffieHellman, raw keys via DER
  wrappers), chacha20-poly1305, sha256/hmac, timingSafeEqual, net (TCP listener), child_process for
  /usr/bin/dns-sd and /usr/sbin/scutil (system binaries, not node). All in the official Node build's OpenSSL 3.
  Keychain items are made by /usr/bin/security, so their ACL doesn't name node: the runtime's new path
  brings no Keychain prompt.
- Not tested (needs a real iPhone on Wi-Fi; the phone-link branch's device rounds cover the link itself): the
  macOS firewall, when on, asks about incoming connections per program, so after the upgrade the listener's
  program is TRIF's node (signed by the Node.js Foundation), not the system node: possibly one new "accept
  incoming connections?" prompt, and maybe again when a pin bump replaces the binary. Check on a Mac with
  the firewall on when phone-link and no-node both reach main.

- Step 10 as built: the clean-machine job's test runner keeps the setup-node toolcache node on PATH (it
  needs `npm pack` and `node --test`); TRIF's processes only ever get PATH=/usr/bin:/bin, and with the
  runner's other nodes deleted, setup's pickNodePath fallback (/usr/local/bin, /opt/homebrew/bin) finds
  nothing either. Agent installs are `|| echo`ed: a failed install skips that run rather than failing CI
  (check the log for "didn't install" if a run shows as skipped). Bumping helper/runtime.json's version
  moves both jobs to it (the sed in the "pinned Node version" steps expects `  "version": "x.y.z",`).

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

1. **Review the front-door drafts** (step 7, live on the branch, nothing shipped): docs/NO-NODE-STRINGS.md
   rows marked "step 7". Choices made there you may want to change: the panel shows only the curl
   command (no npx line); "install an agent, then run `~/.trif/bin/trif setup`" instead of the whole
   installer again; beta START HERE files lead with curl and keep the .tgz + npx as the with-Node option.
   No site page needed new text (the home page's Get it links to the README).
2. **Phone link + firewall, once phone-link and no-node are both on main** (a wording heads-up):
   docs/PHONE-GUIDE.md step 1.4 on phone-link says "If the Mac asks whether to let `node` accept incoming
   network connections, click **Allow**. That's TRIF's helper." The dialog still says `node` (macOS shows
   the program's file name, and TRIF's own is `~/.trif/runtime/node-v<ver>-<os>-<arch>/bin/node`), but it's
   a different program from any Node the computer had, so someone who allowed their own Node before is
   asked again, and maybe once more when an update brings a new Node (a new folder). Suggested line:
   "If the Mac asks whether to let `node` accept incoming network connections, click **Allow**. That's
   TRIF's helper, on TRIF's own copy of Node. You'll only see this if your Mac's firewall is on, and it
   may ask again after a TRIF update." Not checked on a Mac with the firewall on yet.

Answered 2026-11-17 (recorded in Notes for next round): runtime choice, front door, uninstall, where
install.sh lives.
