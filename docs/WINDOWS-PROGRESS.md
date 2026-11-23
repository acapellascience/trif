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
      run, 70 checks).
- [x] **A real fenced run on CI, Claude Code** (`windows-fence.yml`, job `run`).
- [x] **Codex, option 1**: its shell off, `trif` and TRIF's file tools as MCP tools inside the fence
      (`agents/codex.js` `windowsConfig`, `runs.js` `_fence` with `files`). Switched on in round 4:
      `platform.js` `WINDOWS_RUN_AGENTS` is `claude` and `codex`.
- [x] **Codex, options 2 and 3**: not needed, since option 1 holds. Kept as reserves in `docs/WINDOWS.md`
      ("Codex: where it stands"); 3 would need an administrator once, and Tim's word first.
- [x] **Codex: the attempts to get out**, and a real fenced Codex run on CI: `tests/windows-run.js codex`
      (job `run-codex`, 134 checks, no longer `continue-on-error`). Three runs: a model name Codex doesn't
      know (tools called directly), a sub-agent of that, and Codex's default model (everything behind
      `exec`) with a sub-agent of its own.
- [x] **The tests marked "no side-panel runs" un-skipped and passing on Windows.** Of the 47, 43 run and
      pass on windows-latest since round 7; nothing is left with the reason `runs` in
      `tests/windows-skips.json`. Staying skipped, each for its own reason, and **not counted here** (the
      main session's brief, rounds 6 and 7): 3 `open-model` (see "Outside the goal" below) and 1
      `mac-command` (the macOS command, which Windows never builds; its Windows twin is in
      `tests/windows-runs.test.js`). Beside them `login` 6 and `limits` 6.
- [x] **Security: nothing on Windows relies on `O_NOFOLLOW`**, which Windows doesn't have. Done in round
      7: `helper/cli.js` `writeOptionFile` (a run's write), `helper/lib/stage.js` `_readLive` and
      `readPlain`, beside round 5's `runs.js` `_serveBox`. Each looks at the name first and takes only the
      plain file it looked at; tests in `tests/cli.test.js`, `tests/stage.test.js` and
      `tests/agents.test.js` run on windows-latest (they make links there) and pass.
- [x] **Security: the stage's plain-file functions keep a path under their folder themselves** (added
      after round 7 from an independent red team's run on the branch `windows-redteam`,
      [44006035513](https://github.com/acapellascience/trif/actions/runs/44006035513), which found no way
      out; Tim approved this one hardening). `helper/lib/stage.js` `readPlain`, `writePlain`, `removePlain`,
      `plainUnder`, `_readLive`, `_deleteLive`: a path that's absolute, has `..`, or isn't under the folder
      (case as the volume has it) is refused there, through `pathcheck.js` `relRefused` and `joinInside`.
      Tests on every system (`tests/windows.test.js`, `tests/stage.test.js`) and Windows' odd forms for real
      on windows-latest (`..\`, `C:..`, `\\?\`, drive-relative, trailing dots and spaces). Done in round 8,
      green on CI (the links under "Done this round").
- [x] **The reserves recorded** in `docs/WINDOWS.md` ("The options, against the guarantees", "Codex: where
      it stands", "WSL").

### Outside the goal

- **The open model (`codex-oss`) on Windows** stays out of scope for now (the main session's brief, round
  6). Its 3 tests stay skipped with the reason `open-model`, its chats stay off there
  (`WINDOWS_RUN_AGENTS`), and neither counts against GOAL COMPLETE.

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

### Round 3

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

### Round 4

- The default-model pass: a third run in `tests/windows-run.js codex`, started with no model named (Codex
  named `gpt-6.1-sol`). 41 more checks, green on the first push: the tools beside `exec` and those behind
  it against lists of what's known, the isolate (no `fetch`, `require`, `process`, no import of `node:fs`),
  TRIF's tools working through `exec`, every way out refused (Codex's `apply_patch` through `exec` and
  directly, no shell or `view_image` there at all, TRIF's refusals), and the same from a sub-agent
  (`collaboration.spawn_agent`). Written up in `docs/WINDOWS.md`, "Codex: where it stands".
- Codex switched on: `WINDOWS_RUN_AGENTS = ['claude', 'codex']`, `windowsRunAgents` and
  `TRIF_WINDOWS_CODEX_RUNS` gone, `run-codex` no longer `continue-on-error`, the unit tests
  (`tests/windows.test.js`, `tests/windows-runs.test.js`) use the open model as the agent that's still off.
- Texts for Tim (`docs/WINDOWS-STRINGS.md`): README's Windows section now says chats work with Claude
  Code and Codex (26, marked as changed); strings 1–3 are shown for the open model alone now.
  `docs/PROTOCOL.md`'s Windows section, which still said chats don't run there, says what runs.
- CI at `e46cfae` (the third run alone): windows-fence
  [43960664775](https://github.com/acapellascience/trif/actions/runs/43960664775) green, `run-codex` with
  134 checks. At `e012317` (Codex switched on; the commit after it is these notes): windows-fence
  [43961432466](https://github.com/acapellascience/trif/actions/runs/43961432466) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`), windows
  [43961432584](https://github.com/acapellascience/trif/actions/runs/43961432584) green (Node 18 and 22,
  `still-skipped`). The macOS tests: at `e46cfae`
  [43960664437](https://github.com/acapellascience/trif/actions/runs/43960664437) red on the known one
  alone (`tests/clickjack-browser.test.js`; 832 pass, 1 fail); at `e012317` GitHub had started no `tests`
  run when this was written (the two unit test files that changed pass on a Mac, run by hand with a temp
  HOME): look at the one this commit starts before trusting them.

### Round 5

- The 47 tests skipped for "no side-panel runs": 31 passed on Windows as they were (the stand-in agents'
  `.cmd`s were already made by `tests/fake-extension.js` `windowsShims`), and came off the list. Eight more
  pass after the tests learnt Windows' ways (`WIN`, `exe`, `inWs` in `tests/agents.test.js`): a file's
  place said with backslashes, the stand-in found as `claude.cmd`, the PATH's `;`, no temporary folder of
  Claude Code's, a stop that ends the agent at once, no file modes, stand-in Codexes as Node scripts.
- **Found and fixed in the helper**: a request in a run's mailbox that was a link was read on Windows
  (`runs.js` `_serveBox` relied on `O_NOFOLLOW`, which Windows doesn't have). Now looked at first
  (`lstat`), and what's opened must be the file that was looked at. The test that says so runs there.
- **Found, not fixed**: on Windows the run's site is in Claude Code's argv
  (`Read(//c/…-private/screenshots/<site>/**)` among `--allowedTools`); on macOS nothing of the page is.
  The run's first test says so and is skipped again there (`argv-site`) until the rule moves.
- Seen on Node 18 only: a file made within a few milliseconds of a run's start looked older than the run
  (Windows' file clock runs up to 16 ms behind); `tests/origins.test.js` waits 50 ms there now.
- CI: at `ef6c852` windows [43963766935](https://github.com/acapellascience/trif/actions/runs/43963766935)
  red (4 of the newly run tests, and the Node 18 one). At `5c36070` windows
  [43965062201](https://github.com/acapellascience/trif/actions/runs/43965062201) red on the run's first
  test alone; windows-fence
  [43965061646](https://github.com/acapellascience/trif/actions/runs/43965061646) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`: the mailbox change behind real runs). At
  `8b2525d` (that test skipped again): windows
  [43966237445](https://github.com/acapellascience/trif/actions/runs/43966237445) green (Node 18: 736 pass,
  107 skipped; Node 22: 737 pass, 106 skipped; `still-skipped`), windows-fence
  [43966237511](https://github.com/acapellascience/trif/actions/runs/43966237511) green (all five jobs), the
  macOS tests [43966237458](https://github.com/acapellascience/trif/actions/runs/43966237458) green. The
  commit after it is these notes.

### Round 6

- **The run's site is out of Claude Code's argv on Windows**: the rule for its screenshots folder
  (`Read(//c/…/screenshots/<site>/**)`) moved from `--allowedTools` into the run's `--settings` file
  (`claude.js` `windowsRules` gives it as `file`; `command()` writes `permissions.allow`). The run's first
  test ("agent.start: runId first…") is off the skips file and passes there: 40 of the 47.
- **Proven with the real Claude Code** (`tests/windows-run.js`, job `run`, 70 checks now): it reads a file
  in its own site's screenshots folder through the rule in the file, and is refused another site's
  ("Claude requested permissions to read from …\\screenshots\\other.net\\seen.txt, but you haven't
  granted it").
- From the main session's brief: the open model is out of scope for now ("Outside the goal"); the
  `O_NOFOLLOW` reliance in `stage.js` and `cli.js` is on the checklist as a security item, and is the
  next step.
- CI at `074eb09` (the code; the commit after it is these notes): windows-fence
  [43967916867](https://github.com/acapellascience/trif/actions/runs/43967916867) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`). windows
  [43967916568](https://github.com/acapellascience/trif/actions/runs/43967916568): Node 18 green (737
  pass, 106 skipped); Node 22 red at first on six tests of `tests/cli.test.js` (its shared helper went
  away during "run: … timeout gives exit 1", and the five page commands after it found none), green when
  the job was run again (738 pass, 105 skipped), nothing changed: a flake, not seen before, noted below.
  The macOS tests [43967916585](https://github.com/acapellascience/trif/actions/runs/43967916585): red
  on three that timed out on a slow runner (`agent.login without the agent installed…`, `CLI: agent run
  streams events…`, `screenshot writes a PNG…`: 5 s waits, 26 s tests); `tests/agents.test.js` passes on
  a Mac by hand (temp HOME), and run again on CI the three passed: red then
  on the known one alone (`tests/clickjack-browser.test.js`, "a press: 5.93 ms on average"; 832 pass, 1
  fail).

### Round 7

- **Nothing on Windows relies on `O_NOFOLLOW` any more.** `cli.js` `writeOptionFile` (a run's
  `trif screenshot -o`, `trif request -o`): the name is looked at first, a link, a folder or a file with
  another name (a hard link) is refused, a new file is made only where there's none (`O_EXCL`), an existing
  one is emptied after the open, once it's matched to what was looked at (`ino` and `dev`, as bigints: a
  Windows file number doesn't fit a double). `stage.js` `_readLive` looks first when the walk's `st` isn't
  given (it wasn't from `_pull`); `readPlain` says the name must be a plain file; all write the flag as
  `O_NOFOLLOW || 0`. `docs/WINDOWS.md` (the table's row, the list of what's next) and `docs/PROTOCOL.md`
  follow.
- **Tests that run on windows-latest**: `tests/cli.test.js` ("inside a side-panel run, -o never writes
  through a link or a hard link…": a link, a link to nowhere, a hard link, a folder; a plain file made and
  replaced; outside a run the person's own link is written through as ever), `tests/stage.test.js` ("stage:
  a file swapped for a link, in the copy or in the mods folder, is never read through"), and in
  `tests/agents.test.js` the run's `trif screenshot -o` onto a link (one pointing out of the run's folders
  is refused as a place by `optionPath`, which takes real paths; one pointing within them as a link).
- **Two more of the 47 off the skips list** ("setup records PATH…", "doctor: an agent that isn't logged
  in…"): stand-ins as Node scripts with a `.cmd` written by the test (`cmdFor`), the PATH joined with
  `path.delimiter` and the system's folder (`SYSTEM_PATH`), paths said with `exe()`. They passed on the
  runner with the skips off before they came off the list.
- **The last one too** ("a run never starts with private files…"): its second half needs a private file
  that can't be moved. `chmod` locks nothing on Windows, and `icacls <private> /deny <user>:(WD,AD)`
  didn't stop the runner's administrator (the helper made `from-workspace-…` in the folder anyway). What
  holds: the file made and held open by PowerShell, sharing nothing (`heldOpen` in
  `tests/agents.test.js`); the helper can't move it, and the run is refused with the same words. It passed
  on the runner with the skips off (`9b32222`), then came off the list: 43 of the 47, and no test is left
  with the reason `runs`.
- Two waits that a slow runner outran (Node 18, once each, at `a7f8cb6`): a stand-in's call file read
  while it was being written (`calls()` passes over one that isn't JSON yet), and a left-behind process's
  late write (`tests/stage.test.js` waits for it, up to 15 s, after the 2.5 s).
- CI at `a7f8cb6` (the security change): windows-fence
  [43972315139](https://github.com/acapellascience/trif/actions/runs/43972315139) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`: real runs behind the changed read and write), the
  macOS tests [43972315243](https://github.com/acapellascience/trif/actions/runs/43972315243) green,
  windows [43972315307](https://github.com/acapellascience/trif/actions/runs/43972315307): Node 22 and
  `still-skipped` green, Node 18 red on the two waits above (the new tests passed on both). At `7d4ec06`
  (the waits, the three tests rewritten): windows
  [43973482638](https://github.com/acapellascience/trif/actions/runs/43973482638) green (Node 18, Node
  22, `still-skipped`), windows-fence
  [43973482720](https://github.com/acapellascience/trif/actions/runs/43973482720) green (all five), the
  macOS tests [43973482634](https://github.com/acapellascience/trif/actions/runs/43973482634) green.
  At `9b32222` (two tests off the list, the third rewritten): windows
  [43992426591](https://github.com/acapellascience/trif/actions/runs/43992426591) green, windows-fence
  [43992426473](https://github.com/acapellascience/trif/actions/runs/43992426473) green, the macOS tests
  [43992426449](https://github.com/acapellascience/trif/actions/runs/43992426449) red on the known one
  alone (`tests/clickjack-browser.test.js`; 834 pass, 1 fail). At `e5211f0` (the last test off the list;
  the commit after it is these notes): windows-fence
  [43993241011](https://github.com/acapellascience/trif/actions/runs/43993241011) green (all five),
  windows [43993241026](https://github.com/acapellascience/trif/actions/runs/43993241026): Node 22 and
  `still-skipped` green; Node 18 red at first on one test this round didn't touch ("agent.running lists
  the runs still going…": no message from the helper within 5 s), green when the job was run again
  (742 pass, 103 skipped; Node 22: 743 pass, 102 skipped), nothing changed: a flake, noted below. The macOS
  tests [43993241030](https://github.com/acapellascience/trif/actions/runs/43993241030): red on the known
  one alone again.

## Done this round (round 8)

- **The one item added after round 7** (the main session's brief; Tim approved it): an independent red
  team on `windows-redteam` found no way out, and one thing to harden. `stage.js` `plainUnder` asked only
  that the real path of `root` + `rel` be what the two joined say, and `path.join` takes `..` out before
  either is looked at: `readPlain(root, '..\outside\secret.txt')` gave the file outside. No caller could
  give it such a path (each takes `rel` from the names found in a folder, and `nameRefused` passes over
  the odd ones), so nothing was reachable from a run; it's closed in the functions themselves all the same.
- **What changed**: `pathcheck.js` has `relRefused(rel)` (why a path isn't names alone under a folder:
  a root or drive, `.`/`..`, an empty name, a NUL; by Windows' rules also `/` as a separator and the names
  it reads as another, `winOddPath`) and `joinInside(root, rel, {ci})` (the path, or it throws: refused by
  its names, or the path made isn't inside `root`, case as the volume has it). `stage.js` goes through it
  in `readPlain`, `writePlain` (before a folder is made), `plainFolders`, `removePlain`, `plainUnder`
  (false; `''` is still the folder itself), `_readLive` and `_deleteLive` (before anything is moved to the
  trash). `_writeLive`'s read of the mods folder's version for history is `_readLive` now (never through
  a link).
- **Checked beside it, nothing to change**: `cli.js` `-o` in a run (`optionPath`: real paths and
  `winOddPath`, so `..\x`, `C:..`, a trailing dot or space are refused already); a run's `mod.delete` and
  `mod.restore` (`trash.js` `parseId`: `badName` on both names); `mod.code` and `mod.diff` (the id must be
  a mod the helper has); the mailbox's file names (`runs.js` `_serveBox`: `^[\w.-]+\.req$` from the
  folder's own list; the second red team is on that protocol, on `windows-redteam`, untouched here);
  `win/fenced-files.js` (inside the fence, which decides what it opens, by design).
- **Tests**: `tests/windows.test.js` "path checks: a relative path that must stay under a folder…" (both
  systems' rules, on every system); `tests/stage.test.js` "stage: the plain-file functions themselves keep
  a path under their folder…" (for real, every system: nothing outside read, written, removed or moved)
  and "stage on Windows: the ways Windows has of saying a path elsewhere are refused…" (windows-latest
  only: 40 forms against a real file outside).
- CI at `3a9610b`: windows-fence
  [44009104897](https://github.com/acapellascience/trif/actions/runs/44009104897) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`: real runs behind the changed functions), the macOS
  tests [44009104766](https://github.com/acapellascience/trif/actions/runs/44009104766) green, windows
  [44009104809](https://github.com/acapellascience/trif/actions/runs/44009104809): Node 22 and
  `still-skipped` green; Node 18 red at first on one test this round didn't touch ("mod.delete /
  mod.restore: from the panel any mod; from a run only mods inside its scope": the run's `trif delete`
  got no answer from the helper within 10 s), green when the job was run again, nothing changed (745 pass,
  103 skipped; Node 22: 746 pass, 102 skipped): a flake, beside the two noted before. The three new tests
  passed on both Nodes, in the red attempt too.

## Merge of main (11-17)

- **main merged into `windows`** (`bef1379`): the run-scope allowlist (run-scope-reads: host.js
  `RUN_COMMANDS`, `checkRunReads`, `helperInfo(run)`; trash.js `checkSite`), the phone view, the skill, the
  clip page. Conflicts only where both sides added: `contextText` takes `phone` and `noShell`, runs.js passes
  both, stage.js imports and exports both sides' helpers. A fenced run's `trif` reaches the helper through
  the same `onClientLine`, so the allowlist and scope checks hold there as on macOS; the phone twin's lock
  reaches the fence through `lockedDirs`. skill/build.js copies env.js too (Windows' pathcheck.js needs it).
  Two of main's new tests failed on windows-latest and are fixed in `91e070a` (downloads' chmod 0o000 folder:
  skip list, reason `permissions`; phone.test.js compares `realpathSync.native`'s long names, RUNNER~1).
  [44037442444](https://github.com/acapellascience/trif/actions/runs/44037442444) green (Node 22 after one
  rerun: a codex-sandbox.test.js flake, untouched by the merge); tests/run-scope-reads.test.js passes there
  (7 of 7); windows-fence and the macOS tests green.

## Merge of main (11-20)

- **main merged into `windows`** (`39c60a7`, from `34ffa44`; then `317debb` took in `4bae788`, the
  clickjack test's CI fix that was already on `origin/windows` as well as on main). 41 commits of main:
  0.3.1, the lean guides (AGENTS.md, BOXED.md, TECHNIQUES.md), Claude Code defaulting to Opus when no model
  is picked, `trif reload` of a locked tab, style mods' replace rules all applying, paste files into the
  chat box, the screenshot permission message, the clickjack test's warm-up. **No conflicts**, and nothing
  that needed a Windows decision: the run-scope commit in the list (`6cd0a68`) is the cherry-pick of what
  the 11-17 merge already brought. Looked at for Windows: `claude.js` `command()` now always ends with
  `--model <pick or opus>`, after the Windows branch's rules and `mcp.json`, so a fenced run gets it too
  (`tests/windows-runs.test.js` passes as it is); `cli.js`'s reload timeout and
  "still locked" line, the extension's pasted-file names (`pasted-<date>-<hhmmss>.png`: no `:`) are the
  same on Windows. The fence, the run's rules and Credential Manager are untouched.
- **Local, macOS, Node 22** (temp HOME): the whole unit suite, 899 tests, 881 pass, 18 skipped, 0 fail
  (browser tests skipped without `TRIF_BROWSER_TESTS`); `tests/update.test.js` on its own, 18 of 18 (it
  didn't hang on this branch).
- **CI**: the only red was `run-codex`, and it was red before the merge too (`4bae788`,
  [44441890277](https://github.com/acapellascience/trif/actions/runs/44441890277)): Codex 0.171 (was 0.169)
  offers its default model a new tool, `functions.send_message_to_user_async` ("Send a concise message that
  needs the user's attention…", `{message}` alone), and the run test fails on any tool it doesn't know,
  by design. Looked at: words out to the user, like `request_user_input_async` beside it; nothing on the
  computer. Added to `CODEX_BY_DEFAULT` (`7deea00`). The test now prints an unknown tool's description and
  parameters in the failure (`e22491e`), so the next one can be judged from the log.
- CI at `7deea00` (the code; the commit after it is these notes): windows-fence
  [44830579151](https://github.com/acapellascience/trif/actions/runs/44830579151) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`), the macOS tests
  [44830579194](https://github.com/acapellascience/trif/actions/runs/44830579194) green, windows
  [44830579183](https://github.com/acapellascience/trif/actions/runs/44830579183) green (Node 18 and
  `still-skipped` first time; Node 22 after one `gh run rerun --failed`: a flake in `tests/cli.test.js`,
  untouched by the merge, "run: page error gives exit 1 with the message…": `trif run 'throw new Error("boom")'`
  exited 1 with nothing on stderr, and the shared helper answered the next tests; 918 tests, 806 pass, 111
  skipped, that 1 failed).

## Edge in the tests (11-20)

Tim (11-20): "yeah def put edge in the tests for windows". Edge is the default browser on Windows.
- **CI** (`1b261e6`): the browser check in Edge (`tests/windows-browser.js --browser edge`, the runner's
  stable Edge, 157.0.4341.60) is a **required step** of `windows.yml` now, no longer `continue-on-error`; it
  fails if the runner has no Edge. It checks: `setup --browser edge` alone; Edge's own key
  `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.webmods.helper` names its manifest (read back
  through PowerShell); Edge (headless, muted, `--load-extension`, a temp profile) starts the helper
  through it; the hello says Edge; a page command goes through; doctor's `ok    Microsoft Edge: native
  host manifest` and `extension v0.3.1 on Edge 157…`; the helper ends with the browser.
- **New in the browser check, every browser**: the registry check above; **the panel page**
  (`sidepanel.html` opened in a tab: headless has no side panel to click) reaches the helper through the
  service worker (its status dot: "User scripts are off", which is right there); and, as INFO lines that
  never fail, the browser's extensions page. What they said: Edge turns `chrome://extensions/?id=…` into
  `edge://extensions/?id=…`; **Edge has the "Allow User Scripts" switch** on the details page ("…not been
  reviewed by Microsoft"), like Chrome and Brave; turning it on through that page's own
  `chrome.developerPrivate.updateExtensionConfiguration({extensionId, userScriptsAccess: true})` works in
  all three (Chrome for Testing 158, Edge 157, Brave), `chrome.userScripts` is then usable in the service
  worker and the helper hears "on".
- **The smoke test** sets up `chrome,edge,firefox` and checks Edge's key and doctor's Edge line too.
- **Setup**: the Windows code already registered Edge's key and found its profile
  (`%LOCALAPPDATA%\Microsoft\Edge\User Data`, `browsers.js`); one gap fixed: with no browser profile
  folder at all, setup on Windows installed for Chrome alone; now Chrome and Edge (string 14b in
  `docs/WINDOWS-STRINGS.md`, a draft). Unit test in `tests/windows.test.js` ("windows setup for Edge: …":
  found by its profile folder alone, its own key, Chrome's untouched, doctor's line and its fix naming
  `--browser edge`; the no-profile fallback).
- **Docs**: `docs/WINDOWS.md`'s VM checklist has Edge (no install; `--browser chrome,edge`; the phone view
  and per-site access/sensitive sites added as steps 11–12 for Chrome; "The same in Microsoft Edge": what to
  look for in Edge's sidebar, Developer mode in the left column, the user scripts switch, policies, Startup
  boost keeping Edge and the helper running). `docs/WINDOWS-STRINGS.md`: 14b, and the `chrome://extensions`
  / "Chrome" texts among those that read wrong in Edge (they still work: Edge takes `chrome://`).
- **Local, macOS, Node 22** (temp HOME): 919 tests, 900 pass, 19 skipped, 0 fail.
- **CI at `1b261e6`**: windows [44836145368](https://github.com/acapellascience/trif/actions/runs/44836145368)
  green first time (Node 18, Node 22 with the Edge step, `still-skipped`), windows-fence
  [44836145392](https://github.com/acapellascience/trif/actions/runs/44836145392) green, macOS tests
  [44836145387](https://github.com/acapellascience/trif/actions/runs/44836145387) green. No flakes this time.
- **Next, if wanted**: since `developerPrivate` turns user scripts on from the test, the browser check could
  now put a mod on a page and see it run, in Chrome and Edge ("What's left" 5 in `docs/WINDOWS.md`).

## Merge of phone-link (11-20)

Tim (11-20, in his Windows 11 ARM VM): the phone view worked but was the old one (a separate phone window);
the newer one is on `phone-link`. **`origin/phone-link` merged into `windows`** (a real merge, from
`8f4c666`; phone-link at `cd01c06`). What came in: the phone view's newer window route (a tab alone
in its window makes that window the phone's and its side panel stays; the panel's first paint is already the
phone view, `044ce93`; reloads after a mod's edit stay the phone's, past the site's service worker,
`9008e34`; Back to desktop widens the window back out and keeps the side panel, `d928f6f`), the phone link
and phone sync (helper `lib/phonelink/`, the panel's Connect a phone, Sync with phone), mods' stable ids
(`@id`, Rename in the code card's Details, `lib/modid.js`, `lib/rename.js`), the chat queue (messages sent
while a run works: `--input-format stream-json`, the run's stdin kept open), mod health learning what comes
and goes (`a61f639`, `trif not-broken`), the What's new / Not now fixes, the kind-change registration fix
(`cd01c06`), the side panel's fold (`fde34d8`).
- **Conflicts** (6 files), each resolved keeping both sides:
  - `claude.js` `command()`: takes `fence` and `live`; a fenced run gets the chat queue's
    `--input-format stream-json --replay-user-messages` too (stdin through `cmd.exe` for npm's `claude.cmd`
    passes the JSON lines as it passes the prompt).
  - `agents/index.js` `contextText`: phone-link's `remote` (a phone's run) and `REPLY_TEXT`, and Windows'
    `noShell` line, now `noShellText()`, appended to both the side panel's context and a phone run's.
  - `runs.js`: the context gets `remote` and `noShell`; `adapter.command` gets `live` and the fence;
    the spawn stays Windows' (`spawnable`, no process group, `windowsHide`) with phone-link's live stdin.
  - `background.js` `trif reload`: the locked tab's second load (main's `tabLocks`) and phone-link's
    `phones.reload` (hard for a phone tab), both.
  - `AGENTS.md` (and the skill's `mod-format.md`, rebuilt with `skill/build.js`): `windows` has the lean
    guides from main, `phone-link` doesn't yet: the lean text kept, with phone-link's additions written in
    its style (`@id`, `sites/phone~all-sites/`, the `trif phone …` and `trif not-broken` rows); phone-link's
    "Phone runs" section came in as it is. (When phone-link meets main, the same three conflicts will come up.)
  - `8f4c666` (trif MCP steps shown as `trif …`) is untouched by the merge.
- **The phone link is off on Windows** (`lib/phonelink/link.js`, `platform === 'win32'`). The phone finds
  the computer by its Bonjour record alone (`_trif._tcp`), and the announcer is the Mac's `/usr/bin/dns-sd`
  (`bonjour.js`: anything but macOS is `unsupported`). On Windows the helper would listen on all interfaces
  for a phone that can't find it, and Windows Firewall would ask the user about node.exe. So there the link
  has the store and nothing else: no listener, no announcer, no phone runs, no sync; `phone.status` says
  `unsupported: 'windows'`, every other `phone.*` is refused with `unsupported` (no key made, no file
  written); the panel hides Settings' Connect a phone, the phone line and the phone menu's Sync with phone
  (no new words). The rest of the phone link is plain Node and its tests run on windows-latest. Nothing
  about its security rules changed. Turning it on later needs Tim's calls: (a) an announcer for Windows (the
  DNS-SD API in `dnsapi.dll`, `DnsServiceRegister`, Windows 10 1809+, from PowerShell through P/Invoke as
  `credman.js` does, or Apple's Bonjour for Windows' `dns-sd.exe`, which isn't on a Windows by default);
  (b) the firewall: let Windows ask the first time (it offers private and public networks), or have setup
  add an inbound rule for node.exe on private networks only (needs an administrator); (c) the store's
  `phone-link.json` and `phone-relay.key` rely on `%LOCALAPPDATA%\TRIF`'s inherited access list, as the
  rest of the private folder does (modes do nothing there), and the fence denies runs that folder by name;
  the computer's private key goes to Credential Manager (`keyring.js`, service `TRIF phone link`).
  Not seen (a label the user sees, for Tim): the phone button's name stays "Phone view and sync with phone"
  with Sync hidden.
- Tests added: `tests/phone-link-store.test.js` ("Windows: the link is off…"), `tests/phone-link-panel.test.js`
  ("a helper without the phone link (Windows)…").
- **Tests on Windows**: the phone link's pure parts run on windows-latest (Noise, frames, QR, the store's
  parsing and names, the panel's views, bonjour.js's arguments and pauses, the sync's merge rules, mod ids,
  rename). What needs the link on is in `tests/windows-skips.json`, reason `phone-link` (their keyring
  stand-ins are shell scripts too, and the e2e tests start a helper whose link is off); `phone-link-host`'s two
  as `sockets` (helper.sock paths); two mode-600 checks of the sync's base as a new reason `modes`; a phone
  run's limits (the macOS/Linux sandbox's) as `limits`. The files moved to `tests/on-windows.js`, which now
  takes `"*"` for a whole file, its before/after hooks too (`phone-link-remote`, `phone-link-tool`: their
  hooks turn the link on with a script keyring, and Node 18 failed the run on a hook alone, every test skipped).
- **Local, macOS, Node 22**: the unit suite without the real-browser files and `tests/update.test.js`:
  1089 tests, 1085 pass, 4 skipped, 0 fail; the phone link's and phone sync's files again after the skip
  changes, 142, 0 fail. No test browser was started here (another session's was running).
- **CI** at `8b6187d` (the code; the commit after it is these notes): windows
  [44871213761](https://github.com/acapellascience/trif/actions/runs/44871213761) green first time (Node 18,
  Node 22, `still-skipped`), windows-fence
  [44871213693](https://github.com/acapellascience/trif/actions/runs/44871213693) green (`fence`,
  `fence-standard-user`, `run`, `agents`, `run-codex`). On the way: two known Node 18 flakes of the 5 s kind
  (`cli.test.js` "run: -f file and - (stdin)", `agents.test.js` "merge: a run on another site never settles
  it"), each passing on a rerun. The macOS tests
  [44871213740](https://github.com/acapellascience/trif/actions/runs/44871213740): every test passes, but
  `tests/phone-browser.test.js` as a whole goes over the 180 s a test file gets, some runs and not others
  (red again on a rerun; green at `8e14385`, [44870505817](https://github.com/acapellascience/trif/actions/runs/44870505817)).
  That is phone-link's own: the same file times out on `phone-link` itself (cd01c06,
  [44851716925](https://github.com/acapellascience/trif/actions/runs/44851716925)), red there since
  `044ce93` but for one run. Not the merge's, and left as it is here: it is phone-link's file to split or time.
- `mod-visibility` was merged into `windows` meanwhile by its own session (`d8560db`); the commits above
  went on top of it.

## trif doctor streams, and the merge of phone-link (11-23)

Tim (11-23, his Windows VM): `trif doctor` looked hung, since `claude auth status --json` takes seconds there
and doctor printed only at the end.
- **Doctor** (`476298d`, every OS): `doctor()` takes `onCheck` (each check as it's added) and `onProgress`
  (a slow step's "checking …" text, then null: the helper's ping, Windows' registry keys, looking for agents,
  each agent's saved key and login, the open model, the saved API keys, Safari's bridge). The CLI prints each
  check's lines as they come, the same text as before line for line (`--json` unchanged), and in a terminal
  the step on stderr, wiped when it's done. Test in `tests/agents.test.js` (a stand-in whose login takes 1.5 s).
- **phone-link merged** (`94e7851`, from `476298d`; phone-link at `b1989d5`, 23 commits): dictation, what's
  in view at Send (screenshot, outline, selection), screenshots without access to every site, the `load`
  power, the helper keeping the workspace guides in step (`guides.js`; doctor's "workspace guides" line), mod
  health judged only where a mod applied, the phone view's iPhone 17 size. Conflicts in 14 files, each kept
  both sides: `background.js` (`withInView`), `sidepanel.css`, `cli.js`, `runs.js`, `stage.js`,
  `tests/mod-visibility.test.js` (mod-visibility, which both had: windows' `writeOptionFile` comment,
  `joinInside`, the `on-windows` wrapper), `host.js` (`HELPER_DIR` beside `pipes`), `doctor.js`
  (`staleGuides` beside `panelRunsOff`), and the guides again: windows has the lean ones, phone-link doesn't,
  so phone-link's additions are written in the lean style (`load`'s line and the feed example
  `tests/load-power-browser.test.js` reads, the CSP line, "What the user is looking at", redirect-only
  domains, the screenshot row's click wait); `skill/trif` rebuilt.
- One test fixed for Windows (`0012fe3`): `tests/inview.test.js` checked the in-view picture's mode 600, which
  is 666 on windows-latest; checked off Windows only. `helper/lib/guides.js` writes through a temporary
  file and a rename; on Windows a guide an agent has open can refuse the rename, which is caught and logged.
- **Local, macOS, Node 22**: 1198 tests, 1165 pass, 32 skipped, 1 fail (`tests/phone-sync-e2e.test.js`, its
  1.1 s "one sync a second" margin under the whole suite's load; the file alone passes twice).
- **CI at `0012fe3`**: windows [45113662296](https://github.com/acapellascience/trif/actions/runs/45113662296)
  green (Node 18, Node 22 with the Edge step, `still-skipped`), windows-fence
  [45113662213](https://github.com/acapellascience/trif/actions/runs/45113662213) green. The macOS tests
  [45113662238](https://github.com/acapellascience/trif/actions/runs/45113662238) red, not the merge's: two
  failures phone-link has on its own, `tests/skill-browser.test.js` try-style ("topLevelList is not
  defined": `rules.js selectorsOf` now calls a helper the skill's page script doesn't carry; red on phone-link
  since `347e425`, [44951805489](https://github.com/acapellascience/trif/actions/runs/44951805489)) and
  `tests/phone-browser.test.js` (expects a 750 px page area; `6eebf38` made the phone an iPhone 17, 780);
  `inview-browser` and `phone-window-browser` failed once on the first attempt there and passed on its rerun
  (and at `94e7851`): flakes.

## The phone link on Windows (11-23)

Tim (11-23): turn the phone link and phone sync on on Windows, with Windows' own DNS-SD API (no Bonjour
install) and Windows Firewall's own prompt (no setup rule, no administrator).
- **The switch-off is gone**: `helper/lib/phonelink/link.js`, `extension/phonelink.js` and
  `extension/sidepanel.js` are phone-link's again (no `unsupported: 'windows'`); Settings has Connect a phone
  and the phone menu Sync with phone, as on the Mac. `phone.status` says `system: 'windows'` there, for one new
  note under the code (draft 40: Windows may ask about Node.js).
- **The announcer**: `helper/lib/win/dnssd.cs` → `trif-dnssd-<hash>.exe` in `<home>\bin`, built once per
  version by Windows' csc.exe as the fence is (`helper/lib/win/dnssd.js`). Chosen over PowerShell with
  Add-Type because the record lives as long as a process holds it: a PowerShell would compile its C# again for
  every record (seconds, on each listener change), while the fence's way is already on the branch and starts in
  a moment. It takes the Mac's `dns-sd -R <name> _trif._tcp local <port> v=1 id=<id>` arguments (bonjour.js
  `recordArgs`, unchanged) and calls `DnsServiceConstructInstance` (host `<COMPUTERNAME>.local`, no address:
  Windows answers for its own name) and `DnsServiceRegister`; it holds the record until its standard input
  closes, then `DnsServiceDeRegister`. bonjour.js on Windows ends it by closing its input (a kill would leave
  the record to time out), and at the helper's exit its input closes with the helper. A failed registration
  exits 3, which the announcer's pauses and retries already handle. `-B <type> <domain> <seconds>` browses
  (CI, and a check by hand in the VM).
- **The firewall**: nothing listens at the helper's start; server.js binds only when the store says so (the
  link on, and a phone paired or the code on screen), so Windows' "Allow access?" comes up at Connect a phone.
  `trif doctor`, while the link is on: Windows Firewall's inbound rules for the helper's node.exe and the
  current networks' profiles (`helper/lib/win/firewall.js`, PowerShell's NetSecurity module, read only, a few
  seconds behind a "checking …" line): allowed here / blocked here / allowed on other networks only / not asked
  yet (drafts 41–45).
- **Tests**: `tests/phone-link-windows.test.js` on every system (the announcer on `win32` with a `.js` stand-in:
  the Mac's arguments, ended by closing its input, retried when it exits; no csc.exe → `missing`; the program's
  build with a stand-in compiler; the firewall's verdicts and doctor's lines; the PowerShell read; doctor's
  line end to end on Windows only). `tests/windows-dnssd.js` on windows-latest (windows.yml, a required step
  since its first run passed): the real program built by csc.exe (170 ms), registered through Windows' DNS-SD
  API, found by browsing (`TRIF CI <pid>._trif._tcp.local`), taken back when its input closed (exit 0); then,
  for information, the runner's firewall as doctor reads it. CI at `e836e30`: windows
  [45120851670](https://github.com/acapellascience/trif/actions/runs/45120851670) green (both Node versions,
  `still-skipped`), windows-fence [45120851766](https://github.com/acapellascience/trif/actions/runs/45120851766)
  green, the macOS tests [45120851697](https://github.com/acapellascience/trif/actions/runs/45120851697) red only
  on phone-link's own two (`skill-browser` try-style, `phone-browser`'s 750 px), as before. At `2969cad` (the
  step required): windows [45121858945](https://github.com/acapellascience/trif/actions/runs/45121858945) green
  after one rerun of Node 18 (a flake in `tests/extension.test.js`, "mods that break on a single-page site…",
  untouched here, also seen once locally), windows-fence
  [45121858941](https://github.com/acapellascience/trif/actions/runs/45121858941) green, the macOS tests
  [45121858959](https://github.com/acapellascience/trif/actions/runs/45121858959) red on the same two. The
  runner's firewall as doctor reads it: no rule for its node.exe, a Public network (`unasked`). Not known yet:
  browsing again right after the record was taken back still listed it, which may be Windows' cache or the
  record's goodbye not yet out; whether a phone still sees it then is for a real pairing to show. The older phone-link tests stay
  skipped on Windows (reason `phone-link`, reworded: their keyring and dns-sd stand-ins are the Mac's scripts).
- **Only a real pairing shows**: the iPhone finding the record over Wi-Fi (Parallels on Bridged), the host name
  resolving without an address in the record, the firewall prompt and its rule, a phone run and sync through
  it; `docs/WINDOWS.md` step 13.

## No Node on Windows (11-23)

Tim (11-23): "we should build no-node for windows". `no-node` (59b0b02) merged in (`bb072f8`), then main's
b4febdf (no /install.sh redirect, `88975de`); docs/NO-NODE.md "Windows" has the design, NO-NODE-PROGRESS step 12.
- **Merge conflicts** (4, both sides kept): `setup.js` setup()'s doc comment; `doctor.js` (Windows' streaming
  `add`/`step` and no-node's `runtimeCheck` export); `sidepanel.js` imports; README (0.3.1 with the curl door).
  Auto-merged and checked: setup's `chooseNode` feeds `nodePath` to win/setup.js `writeWrappers` unchanged.
- **Built**: runtime.js on Windows (System32 tar.exe, node.exe + LICENSE only, in the temp folder with relative
  names); scripts/install.ps1 (`irm https://timsrobot.com/install.ps1 | iex`) and its delivery as
  release-0.4.0 does install.sh (site/src/install-windows.js + index.js `installerWindows`; release.js
  `installScriptWindows`, `checkWindowsPins` against nodejs.org's SHASUMS256.txt, `installModuleWindows`
  written after `checkPublished`; never a release asset); uninstall on Windows (registry keys, Path, helpers
  by marker, `removeLater`); the Windows install command in paths.js/extension/doctor/help/update; README's
  Windows section; drafts 47-55 in WINDOWS-STRINGS.md.
- **Tests**: tests/windows-clean-machine.js, CI job `clean-machine` (windows.yml): install.ps1 run as a
  person runs it in a `Zoë 用户 100%` profile with no node on the PATH TRIF gets, help/doctor on the runtime,
  the helper started by trif-host.bat running on TRIF's node.exe, `trif status`, node.exe inside a run's
  fence, an update from a signed local feed, `uninstall --all`; then the upgrade from 014da14 on the
  computer's Node to this build, the computer's Node deleted, doctor and the helper still fine, `uninstall`
  keeping mods and settings. Unit tests: the .zip (runtime.test.js), uninstall on Windows with stand-ins,
  install.ps1's template and module, the site route, the pins check. no-node's POSIX tests skipped on
  Windows by name (`runtime-posix`, `install-sh`, `setup`). Smoke/browser/run keep the job's Node
  (`TRIF_RUNTIME=off`).
- **Tim's VM** (Windows 11 ARM, `--safe`: registry under a scratch root, PowerShell stand-in for keys and
  Path, `--no-link`, no fence; Tim's 0.3.1 checked untouched after): 67 checks, all passed (win-arm64:
  install.ps1 12.4 s, runtime 82 MB, `trif help` 1.1 s first then ~0.25-0.3 s, update 2.2 s, upgrade 7.8 s,
  folders gone ~3 s after uninstall ended).
- **Found and fixed on the way** (VM and CI): Windows' tar.exe gets its arguments in the console's code page
  (a profile with an accent: "Failed to open …Zo? ??…"); Add-Type can't compile into such a TEMP either, so
  Credential Manager failed for user names with accents (powershell.js PRELUDE: TEMP's 8.3 name); a Windows
  PowerShell started from PowerShell 7 loads 7's modules (no Get-FileHash, ConvertFrom-Json): install.ps1
  uses .NET, powershell.js drops PSModulePath; Node's children die with it and a detached PowerShell never
  starts (removeLater goes through Start-Process); uninstall's late `require` after `app` was deleted; Node
  has `navigator.platform` "win32" (the extension reads the browser's userAgent); PowerShell passes
  `chrome,edge` as an array (quote it); PowerShell's errors as CLIXML ("#< CLIXML" was all doctor said).

## Next step

**Nothing is left on the checklist: the goal was complete as of round 7, and the item added after it is
done in round 8**, each proven on windows-latest (the links under "Done this round" and the rounds
before). What's left isn't the loop's:
- **Tim's**: the first pass on a real Windows desktop, a Windows 11 ARM VM in Parallels (the checklist in
  `docs/WINDOWS.md`, "Trying it on a Windows 11 ARM VM (Parallels)"); the texts in `docs/WINDOWS-STRINGS.md`
  (README's Windows section among them); and the merge to main and a release, which no round does.
- **If another round runs anyway**, in this order, none of it required by the goal: the flakes on
  the Windows runner (Node 22, 11-20: "run: page error gives exit 1…" in `tests/cli.test.js`, exit 1 with
  an empty stderr; Node 18: "mod.delete / mod.restore…" in round 8: a run's request unanswered for 10 s; the 5 s waits:
  "agent.running lists the runs still going…" in round 7, the six
  `tests/cli.test.js` ones in round 6: longer waits there, or the helper's log printed when one fails);
  an attempt at a junction and a hard link from inside the fence (`tests/windows-fence/run.js`); other
  sites' folder names out of Claude Code's argv on Windows (round 6's note); the open model, which is out
  of scope until Tim says otherwise.

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
  information) and the Brave step only inform; the Edge step is required since 11-20. Brave's step shows
  FAIL lines by design (`--drop-key`: each run takes one of its keys away).
- `still-skipped` had been dying on its first line (bash's `-e`); fixed in this round's last commit. Its
  `all-on-windows.tap` artifact is the list of what fails once the skips go: start the un-skipping there.
- `tests/windows-run.js` and `tests/windows-fence/run.js` set `TRIF_FENCE_BIN: ''` to get the real fence;
  anything else started through `tests/fake-extension.js` gets the stand-in.
- Strings: 1–3 in `docs/WINDOWS-STRINGS.md` say "another coding agent" and are shown for the open model
  alone since round 4 (they go if its runs get fenced); 5c and 5d name the run's agent; README's Windows
  section (26) names Claude Code and Codex. All still awaiting Tim.
- **A new Codex adds tools** (0.171, 11-20: `send_message_to_user_async`): `run-codex` goes red with "not
  looked at yet", and the failure prints the tool as Codex describes it. Judge it from that, add it to the
  right list in `tests/windows-run.js` with a comment saying what it does, and say so here; anything that
  touches files, the network or programs is a question for Tim, not a list entry.
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
- **Codex's default model** (round 4): its requests have no `tools`; they're in `input` as
  `{type: "additional_tools", tools: [...]}`, namespaces `functions`, `clock`, `collaboration`
  (`directTools` in `tests/windows-run.js` reads both shapes). `collaboration.spawn_agent` takes
  `{task_name, message, fork_turns: "none"}` and answers `{"task_name": "/root/helper"}`;
  `collaboration.wait_agent` takes `{timeout_ms}` alone and answers `{"message": "Wait completed.",
  "timed_out": false}`. The test builds those calls from the tools' own `parameters` (`argsFor`), so a
  changed schema shows in the log line "its sub-agent tools, as Codex describes them". A sub-agent's
  requests are told from its parent's by `prompt_cache_key`, or by the missing `spawn_agent` call.
- Through `exec` an MCP tool's answer is `{content: [{type: "text", text}], isError}`; the test prints
  `RESULT\n<text>` or `THREW\n<message>`, so patterns with `^` need `/m`. A real `trif status` through
  `exec` came back in one go ("Script completed"): no `wait` was needed.
- Not tried: a sub-agent's own sub-agent under the default model (it has the `collaboration` tools; each
  starts from the same config). The open model (`codex-oss.js`) is still off on Windows: its `command()`
  passes `opts` (and so `fence`) on to `codex.command`, but no run of it has been fenced or attacked.
- No account on CI, so every real run is with an API key through the key proxy. A run on someone's own
  login differs only in where Codex's model requests go; the config and the fence are the same.
- **Round 5, the skipped tests**: one job's failures without the whole log:
  `gh api --allow-escape-sequences repos/acapellascience/trif/actions/jobs/<id>/logs | cut -c30- > f`, then
  `grep -nE "^not ok [0-9]+ - |^# (pass|fail|skipped) " f`. The `still-skipped` job's `all-on-windows`
  artifact lists every test with the skips off; names there have `\\` before some characters.
- A stand-in agent in a test: a Node script (`#!${process.execPath}`), never `#!/bin/sh`;
  `windowsShims(home)` (now called by `makeHome` too) makes the `.cmd`, and the helper then says the
  agent's path with `.cmd` (`exe(bin, 'claude')`).
- On Windows `changedFiles`, a tool's summary and the CLI's "changed:" line say a file's place with
  backslashes (`sites\example.com\fake.js`); `undoable` and mod ids keep `/`. Left as it is: the panel only
  shows them.
- `O_NOFOLLOW` is nothing on Windows (`fs.constants.O_NOFOLLOW` is undefined): since round 7 nothing
  relies on it (the checklist's security item). A new open of a file a run can name wants the same: `lstat`
  first, then what's opened must be it.
- **A path a caller gives under a folder** (round 8): `pathcheck.js` `joinInside(root, rel, {ci})`, never
  `path.join(root, rel)` (which takes `..` out, so a real-path check after it sees nothing wrong). The
  tests' list of Windows' forms is in `tests/stage.test.js` ("stage on Windows: …"): add to it there.
- The branch `windows-redteam` is the red teams': never pushed to or changed from this loop.
- The open model on Windows: out of scope for now, settled in round 6 ("Outside the goal" above). Leave
  its three tests skipped as `open-model`.
- **Round 6, the rule in the settings file**: Claude Code takes `permissions.allow` from the run's
  `--settings` file on Windows as on macOS; an absolute `//c/…` rule there works as it did in argv. Still
  in argv on Windows: the relative rules, other sites' folder names among the denies
  (`Edit(./sites/<other site>/**)`; on macOS those are in the settings file). Not the run's own site, and
  nothing a fenced program can read (the run test's `cmdline` attempt is refused), but if they're wanted
  out too they'd have to be spelled `//c/…` (the run's copy), and the matching tried again on the runner
  (case, slashes, 8.3 names, `..`).
- **A flake on windows-latest, Node 22** (round 6, once): in `tests/cli.test.js` the shared helper
  closed the connection during `trif run --timeout 100 hang` ("the helper closed the connection before
  answering"), and the next five page-command tests found no helper. Green on a re-run
  (`gh run rerun <id> --failed`). If it comes back, look at why the helper went away there (its log isn't
  printed by the test), before blaming the change in hand.
- `fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW` doesn't throw on Windows: `0 | undefined` is `0`, so
  the open just follows. Junctions and hard links need no privilege on Windows in general; an
  AppContainer is said to be refused both unless it may write the target. Not seen here: an attempt at
  each from inside the fence (`tests/windows-fence/run.js`) would say.
- **Round 7**: `optionPath` (`cli.js`) already refuses a link in the file's place when it points out of the
  run's folders (`isInside` takes real paths), with the "files are written only in…" text; what
  `writeOptionFile` adds is the link within those folders, the hard link, and the swap between the check
  and the write. Left as it is on Windows: a link to nowhere put there between the look and the open
  (`O_EXCL` there may make the file the link names; it's then refused, empty, before anything is written).
- `stat` numbers on Windows: `ino` is 64 bits and Node gives a double unless asked for `{ bigint: true }`,
  so two files' numbers can read the same once a volume has reused a record often. `writeOptionFile` asks
  for bigints; `stage.js` and `_serveBox` still compare doubles, each beside an `isFile()` on the `lstat`
  that tells a link whatever the numbers say.
- A folder can't be locked for a test on the runner with `icacls /deny <user>:(WD,AD)`: the helper still
  made a folder in it (the runner's administrator; not looked into further: perhaps its restore privilege,
  which `CreateDirectory` asks to use). `fence-standard-user` shows how a job runs as an ordinary user if a
  test ever needs rules that hold.
- A test's stand-in agent on a PATH that no `config.json` names yet (`trif setup`, `trif doctor` started
  by the test): `cmdFor(dir, name)` writes the `.cmd`; `SYSTEM_PATH` has `System32`, which starting a
  `.cmd` needs.
- Still in Claude Code's argv on Windows: other sites' folder names among the deny rules (round 6's note).
  Not required for this goal (the main session's brief, round 7); kept as a note.
- The `still-skipped` job's artifact: `gh run download <windows run id> -D <scratch>`, then
  `grep -nE "^(not ok|ok) [0-9]+ - <the test's first words>" all-on-windows/all-on-windows.tap`.
- **A flake on windows-latest, Node 18** (round 7, once): "agent.running lists the runs still going…"
  timed out after 5 s waiting for the run's first text; green on `gh run rerun <id> --failed` (which runs
  the whole workflow's jobs again under new job ids).
