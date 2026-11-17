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
| doctor, still on system node | (new) | `TRIF runs on {node}, not its own copy of Node: run \`trif setup\` to fetch it` |
| `trif uninstall` | (new) | `Removed TRIF's helper, CLI and browser connections. Your mods are still in {home}; \`trif uninstall --all\` removes them too.` |
