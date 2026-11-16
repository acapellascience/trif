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
- [ ] **Codex, option 1**: its shell off, `trif` and TRIF's file tools as MCP tools inside the fence.
      Wired into the helper (`agents/codex.js` `windowsConfig`, `runs.js` `_fence` with `files`) and green
      in a real run on CI with a model name Codex doesn't know (tools called directly). Left before it's
      ticked: the same with Codex's default model (everything behind `exec`), then switching it on
      (`platform.js` `WINDOWS_RUN_AGENTS`; today only the test does, `TRIF_WINDOWS_CODEX_RUNS=1`).
- [ ] **Codex, option 2**: its commands through the fence's launcher. Not started. (Seen already: no
      shell starts inside the fence, and node there can't start a child. Only if 1 fails.)
- [ ] **Codex, option 3**: its `elevated` sandbox with name lookups and 127.0.0.1 closed. Not started.
      Needs an administrator once: only if 1 and 2 fail, and then stop for Tim first.
- [ ] **Codex: the attempts to get out**, and a real fenced Codex run on CI. `tests/windows-run.js codex`
      (job `run-codex`, 93 checks, green): the tool, TRIF's file tools, Codex's own tools, a program in the
      run's container, a sub-agent. Left: the default-model pass (above); then the job stops being
      `continue-on-error`.
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
  its config has `files`). Unit-tested; Codex's runs use them (round 3).
- CI at `f8e3943` (round 1): windows-fence
  [43951176484](https://github.com/acapellascience/trif/actions/runs/43951176484) (`fence`,
  `fence-standard-user` and the real Claude Code `run`: green; `agents`, which only informs, was still
  going when the next push cancelled it), windows
  [43951176499](https://github.com/acapellascience/trif/actions/runs/43951176499) (green: Node 18 and 22,
  unit tests, smoke test, browser check). The macOS tests
  ([43951176467](https://github.com/acapellascience/trif/actions/runs/43951176467)) were still waiting
  for a runner when this was written: look before trusting them.

### Round 2

- Read the Codex runs against the stand-in model, then two more rounds of them. Option 1 holds in the
  prototype: with `sandbox_mode="read-only"`, the shell's features and `view_image` off, Codex's own
  `apply_patch` is refused everywhere, its picture and shell tools are gone, `exec`'s isolate reaches
  nothing but the other tools, and the `trif` MCP tool, once approved in the server's config, answers from
  inside the fence, where a read outside and a connection to this computer are refused. What was seen is in
  `docs/WINDOWS.md`, "Codex: where it stands".
- Strings 2 and 3 (`helper/lib/platform.js` `panelRunsOff`) no longer name another agent: "Use another
  coding agent here, or …". `docs/WINDOWS-STRINGS.md` and `tests/windows.test.js` follow.
- CI at `07d3d44` (the code; the commit after it is these notes): windows-fence
  [43953801088](https://github.com/acapellascience/trif/actions/runs/43953801088) green (`fence`,
  `fence-standard-user`, `run`, `agents`), windows
  [43953801100](https://github.com/acapellascience/trif/actions/runs/43953801100) green (Node 18 and 22,
  `still-skipped`), the macOS tests
  [43953800965](https://github.com/acapellascience/trif/actions/runs/43953800965) red on the known one
  alone (`tests/clickjack-browser.test.js`, "a press: 4.67 ms on average"; 831 pass, 1 fail).

## Done this round (round 3)

- Codex, option 1, wired into the helper: `codex.js` `command()` with a `fence` (read-only, the shell's
  features and `view_image` off, the `trif` server approved, no profile), `_fence` gives the server TRIF's
  file tools, the run's context names them, the key proxy's token is printed by Node
  (`helper/lib/win/print-file.js`: there's no `/bin/cat`), and the file tools write no instruction files.
- `tests/windows-run.js` takes `codex`: the real helper and the real Codex 0.169 against the stand-in
  model, a made-up key in Credential Manager. 93 checks, all passing: every `trif` command, the file tools,
  the refusals (tool, file tools, Codex's own `apply_patch`/shell/`view_image`, the container), the tools
  Codex offers (a list of what's known), and a second run whose sub-agent tries to get out too.
- Seen about sub-agents: one starts with its parent's config (no shell, none of Codex's file tools, TRIF's
  tools fenced) and without the sub-agent tools. Written up in `docs/WINDOWS.md`, "Codex: where it stands".
- CI at `8603a64` (the code; the commit after it is these notes): windows-fence
  [43958005757](https://github.com/acapellascience/trif/actions/runs/43958005757) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`), windows
  [43958005611](https://github.com/acapellascience/trif/actions/runs/43958005611) green (Node 18 and 22,
  `still-skipped`), the macOS tests
  [43958005763](https://github.com/acapellascience/trif/actions/runs/43958005763) green.

## Next step

**The default-model pass, then switch Codex on.** In `tests/windows-run.js codex`, a third run started
without a model (Codex's default: everything behind `exec`, no `tools` field in its requests). Through
`exec` (`{custom: {name: 'exec', input: <JavaScript>}}`, see `viaExec` in `tests/windows-fence/agents.js`):
`ALL_TOOLS` against the known list; `tools.mcp__trif__trif` and `tools.mcp__trif__write_file` working;
`tools.apply_patch` in the site's folder and outside refused and nothing written; `tools.exec_command`
and `tools.view_image` absent; a file elsewhere through `tools.mcp__trif__read_file` refused. When that's
green: add `codex` to `WINDOWS_RUN_AGENTS`, take out `windowsRunAgents`' switch and
`TRIF_WINDOWS_CODEX_RUNS`, drop `continue-on-error` from `run-codex`, put `tests/windows.test.js` and the
unit test in `tests/windows-runs.test.js` right, and strike strings 2 and 3 in `docs/WINDOWS-STRINGS.md`
for Codex (they stay for open models until `codex-oss.js` passes `fence` on: look at its `command()`).
After that: the 47 skipped tests.

## Notes for next round

- **Codex and the stand-in model**: a model name Codex doesn't know gets a small tool set called directly
  and sends `tools` in each request; its default model (no `-m`) gets everything behind `exec` and sends no
  `tools` field (they're in `input`), so ask `exec` for `ALL_TOOLS` to see them. A stand-in's call to an
  MCP tool is `{type: "function_call", namespace: "mcp__trif", name: "trif"}` (`tests/fake-model-server.js`
  takes `call.namespace`); `mcp__trif__trif` as a plain name is "unsupported call". Through `exec`:
  `await tools.mcp__trif__trif({...})`, in a `custom_tool_call` named `exec` whose input is JavaScript.
- A finished job's output while the rest of its run goes on (`gh run view --log` waits for the whole run):
  `gh api --allow-escape-sequences repos/acapellascience/trif/actions/jobs/<job id>/logs` into a scratch
  file; job ids from `gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.databaseId)"'`. Then
  `grep -n ">>> "` for the headings and `sed -n` a range, `cut -c1-500`: Codex's stderr lines are long.
- The guarantee for Codex's own tools (no shell, no `view_image`, `apply_patch` refused) is Codex's config
  and its own refusal, as Claude Code's file tools on Windows are held by its rules, not by the fence. The
  run test has to attack each on every CI run, since a new Codex may add a tool.
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
- Strings: 2 and 3 in `docs/WINDOWS-STRINGS.md` now say "another coding agent"; still awaiting Tim, and
  they go when Codex runs fenced. 5c, 5d and README's Windows section (26) name Claude Code as the agent
  they're about.
- **The real Codex run** (round 3): `node tests/windows-run.js codex` on the runner; its log through the
  job's id as above, then `grep -n "FAIL\|all passed\|checks failed"`. What an MCP tool answers reaches the
  model as two parts, "Wall time: … Output:" and then the text, so patterns need `/m`. Codex's sub-agent
  tools: `spawn_agent {message}` answers `{"agent_id": …}`; `wait_agent {targets: [id], timeout_ms}`
  answers `{"status": {id: {"completed": "<its last words>"}}}`. A sub-agent's requests don't carry its
  parent's `spawn_agent` call: that's how the test tells them apart (`pick` in `tests/fake-model-server.js`
  chooses a step by who's asking).
- `codex.cmd` on the runner takes the `-c` values as they are (quotes, braces, Windows paths) through
  `platform.spawnable`: nothing needed escaping beyond what's there.
- A push cancels the windows-fence run before it, so wait for `fence` and `fence-standard-user` before the
  notes' commit if their result matters.
- Rules: commits by path, never `-a`; the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  push only `windows`; never `~/.trif`, never the real helper; a temp HOME for anything local.
