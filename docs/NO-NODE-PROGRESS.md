# No-Node progress

Design: docs/NO-NODE.md. Text people see: docs/NO-NODE-STRINGS.md (drafts for Tim).
Branch `no-node`, worktree ~/WebMods-worktrees/no-node.

## Checklist

- [x] 1. Research and design (docs/NO-NODE.md): private pinned Node runtime; curl|sh front door.
- [ ] 2. `helper/runtime.json` (Node 24.22.3 pins) + `helper/lib/runtime.js`: platform key, fetch (update.js
      `fetchUrl`), SHA-256 check, unpack with `tar` into `<home>/runtime/<name>` via a temp folder and rename,
      keep only bin/node + LICENSE, `runtimeNode(home)`, prune old ones. Unit tests with a fake archive.
- [ ] 3. setup.js: use the runtime's node for both wrappers and the Safari LaunchAgent (fetch it if missing;
      fallback `pickNodePath()` with a note); `--no-runtime` for git checkouts/dev. Tests.
- [ ] 4. update.js: run the new package's setup with the runtime's node when present; doctor.js: check the
      runtime (present, hash of bin/node, runs) and say when TRIF is still on a system node. Tests.
- [ ] 5. `trif uninstall` (manifests, LaunchAgent, bin, app, runtime; mods and private folder kept unless
      `--all`). Tests. Strings to NO-NODE-STRINGS.md.
- [ ] 6. `scripts/install.sh` template + release.js step that fills it (package URL/sha, runtime pins) and a
      `release.js refresh-runtime` dry-runnable step that rewrites runtime.json from SHASUMS256.txt. Tests
      (dry run only, never a real release).
- [ ] 7. Front door text: extension `SETUP_COMMAND`, onboarding, background "not connected", help.js, README
      (drafts first in NO-NODE-STRINGS.md; never name agent products).
- [ ] 8. Clean-machine test (macOS, local): temp HOME, PATH without node, install.sh against a local server
      with a built package, helper with a stand-in agent, `trif` in a real sandboxed run
      (`tests/run-sandbox.test.js` style), update from a previous build, uninstall.
- [ ] 9. Upgrade test: a Node-based install of origin/main updates to this build, keeps ~/.trif, settings,
      paired phones (phone-link state if merged), and ends on the runtime.
- [ ] 10. CI: job on macos-latest and ubuntu-latest that builds, removes node from PATH, runs 8 and 9; CI
      tests on the pinned Node version.
- [ ] 11. Size and startup time recorded here; phone-link branch checked on the runtime (crypto X25519, http).
- [ ] 12. Windows: list what's left for branch `windows` (node.exe zip, .cmd wrappers) once it's on main.

## Measurements

- Node 24.22.3 archives: darwin-arm64 .tar.xz 27.5 MB, darwin-x64 29.3 MB, linux-x64 32.1 MB,
  linux-arm64 31.0 MB, win-x64 .zip 37.8 MB (nodejs.org Content-Length, 2026-11-17).
- Today (system Node 22, Intel Mac): `node -e 0` 20-50 ms, `node helper/cli.js --version` 70-130 ms.

## Done this round

- Round 1: researched SEA / Bun / Deno / private runtime / rewrite; wrote docs/NO-NODE.md, this file,
  docs/NO-NODE-STRINGS.md. Recommendation: private pinned Node runtime (no signing by Tim, same engine
  as tests, small updates); curl|sh installer.

## Next step

Step 2: `helper/runtime.json` + `helper/lib/runtime.js` with unit tests (tests/runtime.test.js).

## Notes for next round

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

## For Tim

Not blocking steps 2-6 (they follow the recommendation and are easy to change):
1. **Runtime choice**: private pinned Node (recommended: ~28 MB download, ~110 MB on disk, no signing for
   you) vs Bun (~2x smaller, but a different JS engine from Chrome's, so syntax checks and Node behaviour
   differ) vs a Node SEA (one `trif` file, but you'd re-sign every release and updates become full binaries).
2. **Front door** (needed by step 7): `curl -fsSL https://timsrobot.com/install.sh | sh` shown in the panel
   and README (recommended), and/or a signed .pkg later (needs your Developer ID Installer certificate and
   notarization in release.js). Keep `npx timsrobot setup` as the alternative for people with Node?
3. **Uninstall**: add `trif uninstall` keeping mods and settings by default (`--all` removes them)?
