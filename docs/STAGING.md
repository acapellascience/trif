# Runs work in a folder of their own (staging)

Until now a side-panel run wrote straight into the mods folder (`~/.trif/sites`), and the helper worked out
afterwards which changes were the run's: a snapshot when it started, what differed later, and a time window
(a mod written more than 10 s after the run's process group ended counted as the user's). Several of the
November review's fixes were that reckoning going wrong (docs/SECURITY.md "Review fixes"), and one hole was
left: a process that leaves the run's group can write after the window and pass as the user.

Now each run writes only a folder of its own, and only the helper writes the mods folder. Which changes are
the run's is what the helper copied for it: a fact, not a guess.

Code: `helper/lib/stage.js` (the copy and the sync), `runs.js` (`_launch`, `_watchStage`, `_syncStage`,
`_finish`), `held.js` (`written`), `agents/claude.js` (`runSettings`), `cli.js` (`optionPath`). Tests:
`tests/stage.test.js`.

## The run's working folder

`<boxRoot>/<runId>.ws/`, beside the run's mailbox (`~/Library/Caches/TRIF/boxes/` on macOS), made fresh for
the run and removed when it ends:

```
<runId>.ws/                       the agent's working folder (cwd)
  AGENTS.md TECHNIQUES.md BOXED.md CLAUDE.md instructions.md      copies
  .claude/settings.json           Claude Code's project settings, as trif setup writes them
  .shipped/                       a copy (merge runs read it)
  sites/<own folder>/             every file, files/ included: the run's site's folders, all-sites/
  sites/<other site>/             every file but files/, to read: read-only to the sandboxes
```

The agent's view doesn't change: the same files at the same relative places, `sites/<site>/<mod>.js`, and
`trif` commands take the same mod ids. The run's `trif` gets `TRIF_RUN_MODS_DIR` = the copy's `sites/`, so
`trif check`, `verify`, `new`, `install-example`, `run -f` and `-o` read and write the copy; a path into the
mods folder itself (`~/.trif/sites/x.com/a.js`, `TRIF_RUN_LIVE_MODS_DIR`) is taken as the same path in the
copy. The context and AGENTS.md say to name files by their place in the working folder.

Not copied in (or out): links, files with more than one name (hard links), names TRIF doesn't take
(`pathcheck.js`), files agents read as instructions (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`…) under
`sites/`, files directly in `sites/`, `.git`, and `node_modules` below a site's folder. TRIF's state files
(`allowed.json`, `held.json`, `seen.json`…) aren't in the copy at all.

### Why a copy as the working folder, not the same folder with writes sent elsewhere

macOS has no way to show one process a folder in another place (no mount namespaces), and neither agent can
be told "write here when the path says there". Both sandboxes do one thing well: allow writing a folder by
its path. So the agent works in a folder that is all its own, laid out like the workspace, and the sandbox
allows writing that folder's `sites/` and nothing of the real workspace:

- **Codex**: `:workspace_roots` (the copy) read-only, the copy's `sites/` writable, other sites' folders in
  it read-only; the real workspace stays readable, as before, and nothing of it writable.
- **Claude Code**: its commands' sandbox may write the copy's `sites/` (`allowWrite`), never the mods folder
  or the workspace's state files (`denyWrite`, by name); its file tools may edit `<copy>/sites/**` only,
  minus other sites' folders and instruction files there.

Resuming a chat works from a new working folder: checked with Claude Code 2.1.319 (`--resume` finds the
session wherever it was started and appends to it there; the empty folder it makes in `~/.claude/projects`
for each later run's working folder is removed after the run, `claude.js` afterRun) and Codex 0.166 (`exec
resume` takes the current folder as the session's).

## The sync

The helper keeps, for each file it follows, the copy's and the mods folder's sha1 as of the last sync, and
compares both sides with them (a file is read again only when its size, time or inode change):

- **Changed in the copy** (the run's doing): copied to the mods folder, written as a new file and renamed into
  place, never through a link. Recorded in `written` (path -> sha1). A mod the run deleted goes to the trash,
  as `trif delete` would: only one that stays on the run's site, unless the run made it; refused, it is put
  back in the copy. Another deleted file goes to `trash/<site>/files/`. If the mods folder's version had also
  changed meanwhile (the user's edit), that version is kept in history before the run's replaces it.
- **Changed in the mods folder, not in the copy** (the user, the helper doing a `trif delete` for the run,
  another browser's run): copied into the copy, so the agent sees it. Not the run's.
- **Refused**, said once in the helper's log: another site's existing folder, the names above, a file read
  through a link or with a second name. The sandboxes already refuse most of these; this is the second wall.

When: a moment after the copy changes (a watcher), every second, before the helper handles each of the run's
`trif` requests (a mod saved just before `trif reload` is in the mods folder when the reload goes out), and
before it answers one (its `trif delete` shows in the copy by the time `trif` returns). After each sync that
copied something, the helper sends the mods to the browser at once (`onStaged`), so the panel and the page
see a saved mod as quickly as before.

When the run ends: one last sync, then the folder is closed and removed. Nothing reads it again. A process the
run left behind (outside its process group, or not) can only write there (its sandbox lets it write nothing
else of the workspace), so what it writes goes nowhere.

## What depends on "what the run changed"

- **Held mods** (`held.js`): a mod is the run's when its file is what the helper copied for it
  (`written`, same sha1); then it's held for matching other sites or saying risk 2, as before. Anything else
  that changed is someone else's, judged like any outside change. No time window decides it any more (the
  10 s `recent` window stays only so the sync right after the run ends still knows it); `locked` folders
  aren't needed for runs with a copy.
- **`changedFiles` and undo**: the files the run changed through its copy, and its own `trif delete` and
  `trif restore`, that differ from when it started. `history.recordChanges` keeps their previous text, as
  before, so the chat's "Changed x.js" line and Undo work as they did. The user's edits during the run are no
  longer listed as the run's.
- **Origins** (`origins.js`): unchanged: new mods written while a run is live are its own, by when the file was
  written, and the helper writes them while it runs.
- **Fix runs, merge runs**: unchanged (`.shipped/` is in the copy; the merge is settled after the last sync).
- **Files the user added**: in the copy for the run's site; a file dropped during the run comes in within a
  second.
- **All-sites mods, sensitive sites of their own**: `all-sites/` is the run's own folder (its changes wait, as
  before); a sensitive site's own folder is another site's to its parent's run, and the run's own for a run
  on it (`stage.js` ownFolder, the same rule as `runLimits`).

## Processes that leave the run's group (macOS, checked)

- **Codex 0.166**: a command under its permission profile can call `setsid()` and leave the run's process
  group; it keeps running after Codex exits, and can write later. It stays inside the sandbox: a write outside
  the profile's folders is refused ("Operation not permitted"). Checked with `codex sandbox` and a Python
  child.
- **Claude Code 2.1.319**: every Bash command already runs in a session of its own (its shell is a session
  leader), so the helper's kill of the run's group never reaches commands, and a backgrounded child wrote a
  file 4 s after `claude -p` had exited. Also sandboxed throughout. (TRIF's runs only allow `trif`, `cd` and
  `ls`, so a run can't start such a child of its own; it's the agent's own behaviour.)

With the working folder this matters much less: such a process can only write the run's folder, which nothing
reads after the run, its mailbox (closed, the token refused) and its screenshots folder.

## Not covered

- A run under an organization's settings instead of TRIF's sandbox (`withoutsandbox.js`) works in its copy
  like any other, but nothing stops it writing the mods folder itself; such a write is judged as an outside
  change.
- A big file in the run's site's `files/` is read in full when the run starts (to know it later) and copied.
- A folder for another site that the user creates while the run is going isn't followed into the copy.
