# Windows port: progress

What carries from one round of work to the next. The survey, the sandbox decision, what was seen and the
reserves are in `docs/WINDOWS.md`; the texts awaiting Tim in `docs/WINDOWS-STRINGS.md`. Each round: read
this, do the next step, tick the list, rewrite "Next step" and add to the notes.

## Goal checklist

Side-panel chats on Windows behind TRIF's own AppContainer fence, each agent proven with the attempts to
get out (reads, writes, the network with name lookups and 127.0.0.1, the private folder, the state files,
other programs, Credential Manager), on windows-latest, with the real agent and a stand-in model.

- [x] **Claude Code, fenced**: no shell (`--tools Read,Edit,Write,Glob,Grep`), `trif` as an MCP tool whose
      program runs inside the fence (`helper/lib/win/fence.js`, `fence.cs`, `helper/mcp.js`, the Windows
      branches of `runs.js` and `agents/claude.js`).
- [x] **Claude Code: the attempts to get out**, on CI: `tests/windows-fence/run.js` (the fence with the
      helper's own spec, as an administrator and as an ordinary user) and `tests/windows-run.js` (a real
      run, 68 checks).
- [x] **A real fenced run on CI, Claude Code** (`windows-fence.yml`, job `run`).
- [ ] **Codex, option 1**: its shell off, `trif` (and TRIF's file tools) as MCP tools inside the fence.
      Explored only; see the notes.
- [ ] **Codex, option 2**: its commands through the fence's launcher. Not started. (Seen already: no
      shell starts inside the fence, and node there can't start a child. Only if 1 fails.)
- [ ] **Codex, option 3**: its `elevated` sandbox with name lookups and 127.0.0.1 closed. Not started.
      Needs an administrator once: only if 1 and 2 fail, and then stop for Tim first.
- [ ] **Codex: the attempts to get out**, and a real fenced Codex run on CI.
- [ ] **The tests marked "no side-panel runs" un-skipped and passing on Windows.** 47 in
      `tests/windows-skips.json` with the reason `runs` (agents.test.js 35, codex-sandbox 3, open-models 3,
      claude-managed 2, origins 2, stage 2); beside them `login` 6 and `limits` 6. The stand-in fence
      (`tests/fake-fence.js`, `TRIF_FENCE_BIN`) is in every test helper's environment; the stand-in agents
      are still `#!/usr/bin/env` scripts, which Windows can't start.
- [x] **The reserves recorded** in `docs/WINDOWS.md` ("The options, against the guarantees", "Codex: where
      it stands", "WSL").

## Done so far

- Setup, native messaging, the helper, the CLI, doctor, keys, mods on Windows (`docs/WINDOWS.md`, "What
  works"); the survey of every macOS assumption.
- The fence (an AppContainer per run, built on the computer by Windows' own C# compiler), Claude Code runs
  behind it, the `trif` tool's server, unit tests with stand-ins (`tests/windows-runs.test.js`).
- Fenced file tools for an agent with none of its own that can be held to a run's folders (read, write,
  edit, list, search, view a picture: `helper/lib/win/fenced-files.js`, offered by `helper/mcp.js` when
  its config has `files`). Unit-tested; no run uses them yet. They're there for Codex, option 1.
- CI at `f8e3943` (round 1): windows-fence
  [43951176484](https://github.com/acapellascience/trif/actions/runs/43951176484) (`fence`,
  `fence-standard-user` and the real Claude Code `run`: green; `agents`, which only informs, was still
  going when the next push cancelled it), windows
  [43951176499](https://github.com/acapellascience/trif/actions/runs/43951176499) (green: Node 18 and 22,
  unit tests, smoke test, browser check). The macOS tests
  ([43951176467](https://github.com/acapellascience/trif/actions/runs/43951176467)) were still waiting
  for a runner when this was written: look before trusting them.

## Next step

**Codex, option 1, as a real run on the runner.** In `tests/windows-fence/agents.js` (job `agents` of
`windows-fence.yml`, never failing) the Codex runs against the stand-in model now go through
`runToolAsync`: read that job's output for the three runs under "Codex: its tools, and a run without its
shell" and find out (a) whether Codex with `features.shell_tool=false` calls an MCP tool at all, (b) what
`apply_patch` and `view_image` (Codex's own, outside the fence) can reach under `sandbox_mode="read-only"`
and whether any setting takes them away or makes Codex refuse them, (c) whether `exec` (its JavaScript
tool) can reach anything but the other tools. If Codex's own file tools can be shut, wire it:
`agents/codex.js` on Windows with the shell off, `helper/mcp.js` with `files`, then a `tests/windows-run.js`
for Codex. If they can't, write down what was seen and go to option 2.

## Notes for next round

- **Why Codex's runs "didn't get going"** (0 requests to the stand-in in 150 s, even with no sandbox): the
  test started Codex with `spawnSync`, which stops the very program the stand-in server lives in. Not
  Codex's doing. Fixed with `runToolAsync`; the result hasn't been read yet.
- Codex 0.169 with `shell_tool` off still has: `apply_patch`, `view_image`, `exec` (JavaScript in its own
  isolate: "no Node, no file system, no network access"; it calls the other tools), the MCP tools, and
  tools for sub-agents and questions. Switching off every feature found left `apply_patch`. With TRIF's
  permission profile no session starts on Windows ("unelevated restricted-token sandbox cannot enforce
  deny-read restrictions"), so the exploration uses `sandbox_mode="read-only"` without the profile.
- CI: `gh run list --branch windows --limit 6`, then
  `gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'`. For one job's output:
  `gh run view <id> --log | grep -E "^agents"` into a scratch file, then grep that; never print a whole
  log (the agents job alone is 700 long lines). A push cancels the windows-fence run before it.
- Known and not Windows' doing: the macOS `tests` workflow fails now and then on
  `tests/clickjack-browser.test.js`. In `windows.yml`, `still-skipped` (the skipped tests run anyway, for
  information) and the Edge and Brave steps only inform.
- `still-skipped` had been dying on its first line (bash's `-e`); fixed in this round's last commit. Its
  `all-on-windows.tap` artifact is the list of what fails once the skips go: start the un-skipping there.
- `tests/windows-run.js` and `tests/windows-fence/run.js` set `TRIF_FENCE_BIN: ''` to get the real fence;
  anything else started through `tests/fake-extension.js` gets the stand-in.
- Strings: 2 and 3 in `docs/WINDOWS-STRINGS.md` name Claude Code inside a message about another agent
  ("Use Claude Code here, or …"). Listed for Tim; they go when Codex runs fenced.
- Rules: commits by path, never `-a`; the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  push only `windows`; never `~/.trif`, never the real helper; a temp HOME for anything local.
