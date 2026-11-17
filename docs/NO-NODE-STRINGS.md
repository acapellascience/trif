# No-Node: text people see (drafts for Tim)

Nothing here is live yet. Each line: where it shows, today's text, the draft.

| Where | Today | Draft |
|---|---|---|
| extension/lib.js `SETUP_COMMAND` | `npx timsrobot setup` | `curl -fsSL https://timsrobot.com/install.sh \| sh` |
| extension/background.js "not connected" | The TRIF helper isn't connected. Run `npx timsrobot setup` in a terminal (needs Node 18+), then restart {browser}. | The TRIF helper isn't connected. Run `{SETUP_COMMAND}` in a terminal, then restart {browser}. |
| extension/onboarding.js | Run `npx timsrobot setup` in a terminal (it needs Node 18 or newer), then quit and restart {browser}. | Run `{SETUP_COMMAND}` in a terminal, then quit and restart {browser}. |
| README requirements | Node 18 or newer: check with `node --version`… | (line removed) |
| setup summary, runtime downloaded (live on branch, step 3) | (new) | `✓ Downloaded Node {ver} for TRIF` |
| setup at a terminal, while downloading (stderr; step 3) | (new) | `Downloading Node {ver} for TRIF…` |
| setup --verbose (step 3) | (new) | `runtime       Node {ver} for TRIF: {node}` (+ ` (downloaded now)`); `runtime       not used ({why}): node {node}` |
| setup output, runtime unavailable (step 3) | (new) | `runtime       couldn't download TRIF's own Node ({why}); using {node} for now, and trying again at the next update` |
| `trif help setup` (step 3) | (new) | usage gains `[--runtime\|--no-runtime]`; new paragraph "Which node they run: TRIF's own copy of Node (…pinned in helper/runtime.json, downloaded from nodejs.org and checked against its pinned SHA-256 into <home>/runtime), for --copy installs; the node running setup for --link ones. --runtime uses TRIF's own for --link too; --no-runtime (or TRIF_RUNTIME=off) never. If the download fails, setup uses the node running it and tries again at the next update." The first line "First time: npx timsrobot setup (needs Node 18 or newer)" changes in step 7. |
| doctor, runtime fine (step 4) | (new) | `ok    TRIF's own Node v{ver} ({dir})` |
| doctor, older pin (step 4) | (new) | `warn  TRIF's own Node is v{ver}; this TRIF uses v{pinned}` fix: setup |
| doctor, damaged runtime (step 4) | (new) | `FAIL  TRIF's own Node in {dir} is damaged: {its record .trif-runtime.json is missing \| its node can't be read ({code}) \| its node has changed since it was downloaded \| its node doesn't run ({out})}` fix: `remove that folder (rm -rf "{dir}"), then {setup fix}` |
| doctor, copy install on the system Node (step 4) | (new) | `warn  TRIF runs on this computer's Node ({node}), not its own: it stops working if that Node is removed or upgraded` fix: `run: trif setup --runtime` |
| doctor, git checkout / runtime off (step 4) | (new) | `-     TRIF runs on this computer's Node ({node}), as a git checkout does (trif setup --runtime for TRIF's own)`; `-     TRIF runs on this computer's Node ({node}); its own is off ({why})` |
| `trif uninstall` (step 5, live on branch) | (new) | `Removed TRIF's helper, CLI and browser connections. Your mods ({home}) and settings ({private}) are still there: installing TRIF again picks them up. To remove them too, delete those two folders.` |
| `trif uninstall --all` (step 5) | (new) | `Removed TRIF: its helper, CLI, browser connections, settings, saved API keys and mods.` (+ ` Your mods folder {dir} is outside the workspace and is still there.`) |
| `trif uninstall`, last line (step 5) | (new) | `Remove the TRIF extension from your browser too: chrome://extensions (Firefox: about:addons; Safari: delete TRIF.app).` |
| `trif uninstall --all` at a terminal (step 5) | (new) | `This deletes your mods ({modsDir}), TRIF's settings and paired phones, and the API keys TRIF saved. Type "delete" to go on: ` / `Nothing removed.` |
| `trif uninstall --all` without a terminal (step 5) | (new) | `trif uninstall: --all deletes your mods and settings: add --yes to confirm` |
| `trif uninstall` details (step 5) | (new) | `kept     {path}: it starts another TRIF ({wrapper})` / `: it runs Safari's bridge for another workspace ({home})` / `: your mods folder is outside the workspace`; `problem  couldn't remove {path}: {why}` / `couldn't remove the link {link} (remove it with: sudo rm {link})`; refusals: `there's no TRIF workspace at {home}`, `{home} doesn't look like a TRIF workspace (no bin, app, sites or AGENTS.md in it); left it alone`, `{home} is your home folder, not a TRIF workspace; left it alone` |
| `trif help uninstall` (step 5) | (new) | summary "remove TRIF's helper, CLI and browser connections (your mods and settings stay unless --all)"; details in helper/lib/help.js `uninstall` |
| README "Uninstall" (step 7) | the manual list of files | `Run \`trif uninstall\` (\`--all\` also deletes your mods, settings and saved API keys), then remove the extension from your browser.` (the manual list stays below, for an install whose `trif` is gone) |
