# No-Node: text people see (drafts for Tim)

Nothing here is live yet. Each line: where it shows, today's text, the draft.

| Where | Today | Draft |
|---|---|---|
| extension/lib.js `SETUP_COMMAND` | `npx timsrobot setup` | `curl -fsSL https://timsrobot.com/install.sh \| sh` |
| extension/background.js "not connected" | The TRIF helper isn't connected. Run `npx timsrobot setup` in a terminal (needs Node 18+), then restart {browser}. | The TRIF helper isn't connected. Run `{SETUP_COMMAND}` in a terminal, then restart {browser}. |
| extension/onboarding.js | Run `npx timsrobot setup` in a terminal (it needs Node 18 or newer), then quit and restart {browser}. | Run `{SETUP_COMMAND}` in a terminal, then quit and restart {browser}. |
| README requirements | Node 18 or newer: check with `node --version`… | (line removed) |
| setup output, runtime fetched | (new) | `runtime      Node {ver} for TRIF, in {dir}` |
| setup output, runtime unavailable | (new) | `runtime      couldn't download TRIF's own Node ({why}); using {node} for now, and trying again at the next update` |
| doctor, still on system node | (new) | `TRIF runs on {node}, not its own copy of Node: run \`trif setup\` to fetch it` |
| `trif uninstall` | (new) | `Removed TRIF's helper, CLI and browser connections. Your mods are still in {home}; \`trif uninstall --all\` removes them too.` |
