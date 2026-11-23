# TRIF without Node on the user's computer: design

Goal (Tim, 2026-11-17): a person with no Node installed installs TRIF and everything works as now: the
helper, `trif` inside agent runs (both agents' sandboxes), setup, doctor, updates, the Safari bridge, the
phone link, uninstall. Existing Node-based installs upgrade without losing ~/.trif, settings or paired phones.

## What needs Node today

- `<home>/bin/trif-host` (native messaging host) and `<home>/bin/trif` (the CLI, also run by agents inside
  their sandbox): `#!/bin/sh exec <node> <app>/helper/{host,cli}.js` (setup.js `hostWrapperContent`,
  `cliWrapperContent`), `<node>` from `pickNodePath()`: whichever node ran setup.
- The Safari bridge's LaunchAgent: `ProgramArguments = [<node>, safari-bridge.js]`; the bridge spawns
  `process.execPath host.js` per Safari connection.
- update.js `installLocked`: runs the downloaded package's `helper/cli.js setup --copy` with `node =
  process.execPath`.
- runs.js `runLimits`: makes `dirname(dirname(process.execPath))` readable to the run's sandbox, so `trif`
  can start node in there.
- doctor.js checks the wrapper's node exists and is 18+ ("Node moved or was upgraded?": a real failure
  today, when Homebrew upgrades or removes node).
- The front door: `npx timsrobot setup` (README, extension/lib.js `SETUP_COMMAND`, onboarding, help.js).

Nothing else: no npm runtime dependencies. Built-ins used: fs, path, child_process, crypto (sha256, HMAC,
Ed25519 verify, and on branch phone-link X25519 `diffieHellman`, AES via createCipheriv), os, net,
http/https (phone-link: `phonelink/server.js`), vm (only `new vm.Script(code)` as a syntax check of mods,
in cli.js `check`, edit.js, powers.js: no code is run in vm), util. 16.6k lines of JS in helper/.

## Options compared (sources checked 2026-11-17)

| | Private Node runtime | Node SEA | Bun `--compile` | Deno `compile` | Rewrite |
|---|---|---|---|---|---|
| Same engine as tests and Chrome | yes (V8, the very binary CI tests) | yes | no: JavaScriptCore | V8, own Node layer | n/a |
| Code changes | small: which node the wrappers name | bundle helper/ into one script (SEA `require` loads built-ins only); re-exec patterns (`process.execPath host.js`, update's `node cli.js`) | bundle; every Node API gap | bundle; Node-compat gaps | everything |
| Download | 27.5 MB (darwin-arm64 .tar.xz), 29 MB x64, 31-32 MB Linux, 38 MB win zip | about the same (it *is* node + a blob) | ~25-33 MB gz, ~14 MB gz with `--trim` | ~35-45 MB | small |
| On disk | ~110 MB (bin/node only; npm, headers dropped) | ~110 MB | ~60-70 MB | ~80-100 MB | small |
| Updates | JS-only package as today (small); runtime re-downloaded only when its pin changes | the whole binary every release, per platform; old clients' feed has one package of at most 50 MB (update.js `PACKAGE_MAX`) | same as SEA | same as SEA | per platform |
| Signing | none by Tim: official binaries are signed and notarized by the OpenJS Foundation | injecting the blob breaks Node's signature: re-sign each release (ad hoc works for non-quarantined files; Developer ID + notarization for downloads from a browser) | same | same | Tim signs each release |
| Startup | node ~30 ms, `trif --version` ~70-130 ms (measured, Node 22, Intel) | similar, a little less with code cache | faster (~10 ms) | similar to node | fastest |

- **Node SEA** (nodejs.org/api/single-executable-applications.html, Node 26.13.1 doc): Stability 1.1,
  active development; `node --build-sea` since 25.5; on macOS `codesign --remove-signature` / inject /
  re-sign; the main script's `require` loads only built-ins (or `createRequire` for disk files, which undoes
  the point); `useVfs` assets are Stability 1.0. No notes on child_process or vm: `vm.Script` works (V8), but
  spawning `process.execPath` runs the SEA's own main, so the bridge and update paths need rework.
- **Bun** (bun.com/docs/compiler/size, bun.com/reference/node/vm): `vm` runs on JavaScriptCore, so
  `trif check`'s syntax errors would differ from what Chrome (V8) reports (and reference pages disagree
  on `vm.Script`'s constructor status); several vm options unimplemented; MIT but statically links
  WebKit's JSC (LGPL). Cross-compiles to all targets, the smallest binary. Rejected: the code would run on a
  different engine from the one it's tested and syntax-checked against, and every Node behaviour the helper
  leans on (detached process groups, stdin framing for native messaging, X25519) is a new compatibility
  question.
- **Deno** (docs.deno.com/api/node/vm): V8, `node:vm` Script supported minus `importModuleDynamically`;
  cross-compiles. Rejected: a second Node-compat layer, a bundle step, and the size of SEA without its
  fidelity.
- **Rewrite** (Go/Rust/Swift): 16.6k lines plus ~ the same in tests, a second implementation of the
  protocol the extension speaks, the `vm.Script` syntax check needs a JS parser anyway. Rejected on cost and
  risk; no user-visible gain over a private runtime.

## Recommendation: a private, pinned Node runtime

TRIF keeps its own copy of official Node in `<home>/runtime/node-v<ver>-<platform>-<arch>/bin/node`
(no PATH change, nothing outside TRIF's folders). The version and the SHA-256 of each platform's archive
are pinned in `helper/runtime.json` (from nodejs.org's SHASUMS256.txt; release.js refreshes it in a dry-run-
testable step), which ships inside the signed package, so the update feed's signature covers the runtime too.

- **Where from**: `https://nodejs.org/dist/v<ver>/node-v<ver>-<os>-<arch>.tar.xz` (Linux: `.tar.gz` when
  `xz` is missing; Windows: `.zip`, unpacked with the bundled `tar.exe`). The pin makes the host irrelevant
  to integrity; a mirror on TRIF's GitHub release is a later option (same hashes).
- **Only `bin/node` is kept** (plus LICENSE); npm, headers and docs are dropped after verifying.
- **Wrappers, LaunchAgent, update** name the runtime's node instead of `pickNodePath()`. `pickNodePath()`
  stays as the fallback when the runtime can't be fetched (offline setup with a system node), and doctor
  says so.
- **Sandboxes**: no change in kind. `runLimits` already makes node's prefix readable; it becomes
  `<home>/runtime/node-v…`, inside the workspace folder (already readable to runs) and outside the private
  folder (denied). Claude Code's sandbox (`Bash(trif:*)`, seatbelt/bubblewrap) and Codex's seatbelt profile
  allow exec of readable files; the e2e `tests/run-sandbox.test.js` proves it on the runtime's node.
- **Gatekeeper/quarantine**: files fetched by `curl` or by node's https are not quarantined (only apps that
  set LSQuarantine, browsers, mail, AirDrop, do that), and the binary is notarized by OpenJS anyway. The
  helper never runs anything a browser downloaded.
- **Runtime upgrades**: a new pin downloads beside the old one, wrappers switch atomically (write-and-rename),
  the old folder is removed on the next setup once nothing runs from it (the Safari agent is restarted
  onto the new one).
- **Node LTS choice**: pin Node 24 LTS (supported to April 2028) first; CI runs on the pinned version
  (read from runtime.json), so tests and users run the same binary. Node 26 later.

### Install without npm

1. **`curl -fsSL https://timsrobot.com/install.sh | sh`** (recommended default). The script, written by
   release.js for each release, holds the release's package URL and SHA-256 and the runtime pins; it uses
   only `/bin/sh`, `curl`, `tar`, `shasum`/`sha256sum`, `uname`. It downloads and verifies the runtime,
   downloads and verifies the package, then runs `<runtime>/bin/node package/helper/cli.js setup --copy`,
   which takes over as today. Also published as a release asset. Trust: HTTPS to timsrobot.com, the same
   kind of trust as npm's registry today; setup then checks the signed feed as updates do.
   The extension's "not connected" line and onboarding show this command; an agent can run it too.
2. **A signed .pkg** (later, optional): double-click, for people without a terminal habit. Needs Tim's
   Developer ID *Installer* certificate and notarytool per release; a per-user install from a .pkg is
   awkward. Not needed for the goal.
3. **`npx timsrobot setup`** stays for people with Node: same result (it fetches the private runtime too).

### Upgrade from a Node-based install

The installed old helper updates the usual way: it downloads the package and runs its `helper/cli.js
setup --copy` with *its own* node (update.js). The new setup fetches the runtime and rewrites the wrappers
and the LaunchAgent to point at it; ~/.trif, the private folder (settings, paired phones) are untouched,
as in every update. If the runtime can't be fetched, setup keeps the current node and retries at the next
update check; doctor shows it. Old updaters kill setup at 120 s, so then the download gets 75 s; new ones
give setup 10 min and say so (`TRIF_SETUP_TIMEOUT_MS`), and run it on TRIF's own node when it's installed.
So the first no-node release must still run on the user's node (18+): it
does, it's the same JS.

### Uninstall

There's no `trif uninstall` today. Add one: removes the native-messaging manifests TRIF wrote, the Safari
LaunchAgent, `<home>/bin`, `<home>/app`, `<home>/runtime`; keeps the mods (`<home>/sites`) and the private
folder unless `--all`. (Text people see: docs/NO-NODE-STRINGS.md.)

### Windows (built on branch `windows`, step 12)

The same runtime, the same pins file. What's different there:

- **Where**: `%USERPROFILE%\.trif\runtime\node-v<ver>-win-<x64|arm64>\node.exe` (+ LICENSE and the
  `.trif-runtime.json` record): no `bin\` level, as nodejs.org's .zip has none. From
  `node-v<ver>-win-<arch>.zip` (pinned in helper/runtime.json, 37.8 MB for x64), unpacked by Windows' own
  `%SystemRoot%\System32\tar.exe` (bsdtar, which reads .zip; never a tar on PATH: Git's GNU tar can't),
  taking out only `node.exe` and `LICENSE` by name (the .zip also holds npm's ~2000 files).
- **Wrappers**: `trif-host.bat`, `trif.cmd` and Git Bash's `trif` (lib/win/launchers.js) name it as they
  named the system node, through `nodePath`: inside the workspace, so written from the wrapper's own folder,
  `"%~dp0..\runtime\node-v…\node.exe"`, and the files stay ASCII whatever the profile folder is called.
- **The fence** (side-panel runs, lib/win/fence.js) grants the run's AppContainer read and execute on that
  one file, as it did the system node.
- **Front door**: `irm https://timsrobot.com/install.ps1 | iex` in PowerShell (`& ([scriptblock]::Create((irm
  …))) --browser edge` passes setup's options). scripts/install.ps1, filled in by release.js
  `installScriptWindows` like install.sh: Windows PowerShell 5.1 only, picks win-arm64 or win-x64 from the
  OS's architecture, downloads the .zip and the package, checks each against its SHA-256 (`Save-Checked`,
  the one place that verifies), runs `node.exe package\helper\cli.js setup --copy` with
  `TRIF_RUNTIME_ARCHIVE` = the checked .zip. All in one script block run at its end (a cut-off download
  doesn't parse); it never calls `exit` (under `iex` it would close the window).
- **Delivery** (the pattern of release-0.4.0's install.sh): timsrobot.com/install.ps1 is the site's own code,
  `site/src/install-windows.js` (`INSTALL_PS1`, null until a release writes it: a 404), served by
  `site/src/index.js` `installerWindows` as text/plain (what `irm` returns as a string), only a filled-in
  script with its package pinned; never a redirect, never a release file. release.js checks the Windows
  pins against nodejs.org's SHASUMS256.txt (`checkWindowsPins`), fills the script, and after `gh release
  create` writes the module only if the package GitHub serves has the pinned SHA-256 (`checkPublished`);
  it goes live with a deploy of the site from that commit.
- **Uninstall**: the browsers' registry keys naming a removed manifest go, `<home>\bin` comes off the user's
  PATH (win/userpath.js `removeFromUserPath`), running helpers are found by their pipe markers and ended with
  `taskkill /T`. `bin\` and `runtime\` (with `--all`, the workspace) can't be deleted while this command runs
  from them (node.exe is in use; cmd.exe re-reads trif.cmd after each command): a hidden Windows PowerShell
  waits for the process to end and deletes them (`removeLater`). It's started by a short PowerShell's
  `Start-Process`: what Node spawns is in a job that ends with it, and a detached PowerShell (no console)
  doesn't start at all (both seen in the VM).
- **Upgrade from a Node-based install**: as on macOS: the old updater runs the new setup on the system node;
  setup fetches the runtime and rewrites the wrappers. Pruning an older runtime that's running (the helper
  that ran the update) fails on its node.exe and is retried at the next setup.
- **Tests**: tests/windows-clean-machine.js (CI job `clean-machine` in windows.yml): install.ps1, the
  helper, the fence, an update, uninstall --all, and the upgrade from a Node-based install, with no node on
  the PATH TRIF gets. `--safe` (the default off CI) touches nothing outside its scratch folder.

### Who signs

Nothing new for Tim on the recommended path: the runtime is OpenJS's notarized binary and TRIF stays JS.
A .pkg (option 2) or a SEA would need his Developer ID in a one-time release.js step; neither is required.
