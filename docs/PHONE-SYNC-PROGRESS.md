# Phone sync: progress

The loop's file: read this first, every round. The design: docs/PHONE-SYNC.md (decisions D1–D10 are defaults Tim
can override). Strings: docs/PHONE-LINK-STRINGS.md, "Phone sync". Built on the phone link: docs/PHONE-LINK.md.
Branch `phone-link` (worktree ~/WebMods-worktrees/phone-link) for the computer; `ios-poc` for the iPhone, only when
the round's brief says it is free.

## Checklist

Computer side:
- [x] S0. Design and protocol (docs/PHONE-SYNC.md), the strings drafts, this file
- [x] S1. `helper/lib/phonelink/sync.js` core, no I/O beyond the base file: ids ↔ twin paths and their refusals,
      revisions, the three-way plan (every row of section 4, first sync), sibling names and the @name line, the
      base file (mode 600). Unit tests `tests/phone-sync.test.js`
- [ ] S2. The session side: `sync.begin/get/put/end` handlers and `sync.changed` (a `PhoneSync` class beside
      `Remote`): the import check, writes (temp + rename, no links), history before replace, trash for deletes,
      `synced.json` and held.js `by: 'phone'`, `later` for twins with a run, limits; D10 checked (phone view and
      `phone~all-sites`). Unit tests with a fake session
- [ ] S3. host.js / link.js wiring (the owner helper only; removing a phone deletes its base; the nudge on twin
      changes from syncMods), the desktop lines (Settings' phone row, "From {phone}" on a hold), panel strings test
- [ ] S4. Stand-in phone sync (`tests/phone-link-client.js`) and the end-to-end test against the real helper in a
      temp HOME on 127.0.0.1: add, edit both ways, conflict, deletes both ways, held, style at once, refusals
- [ ] S5. PHONE-LINK.md rules 3 and 5 reworded (PHONE-SYNC.md section 9), pointers in docs/PROTOCOL.md and
      docs/SECURITY.md

iPhone side (ios-poc):
- [ ] S6. `PhoneSync.swift`: the manifest, the plan applied with ModStore's rules (new as an import, changed as an
      edit, removed to Recently deleted), when it syncs (front, after a change, nudge, Sync now); ModStore trash.
      Unit tests
- [ ] S7. The Mods tab's line, Sync now, Recently deleted, the conflict notice; strings into IOS-APP-STRINGS.md; the
      Mac harness (mobile/test/phonelink.test.js) syncing with the helper
- [ ] S8. Simulator pass: a mod made on the phone, edited by a desktop phone-view chat (stand-in agent), back on the
      phone; a conflict; a delete

## Done this round (round 1, 2026-11-17)

- S0: docs/PHONE-SYNC.md (decisions, ids, base, the three-way rule, conflicts and deletes, approval on each side,
  the wire, when, what must hold, what people see, later, proof); strings drafts; this file.
- S1: `helper/lib/phonelink/sync.js` (parseId/idOf, rev, readManifest, plan, siblingId, renameHeader, the base
  file) and `tests/phone-sync.test.js` (8 tests, pass locally and on CI). Not wired to anything yet. CI 8627a42:
  https://github.com/acapellascience/trif/actions/runs/44049845082: 983 pass, 1 fail, the known clickjack flake
  (test 144), twice (rerun once, as the rule says; the 8 new tests pass both times).

## Next step

S2: the session side (`PhoneSync` beside `Remote`, using sync.js's `plan`).

## Notes for next round

- The computer alone keeps the base (`<private>/phone-link/sync/<phone id>.json`); the phone sends `{id, rev}` and
  applies the plan. Equal revisions are in sync whatever the base says, so a lost answer is harmless.
- held.js already holds a file changed from outside (`by: 'outside'`) and lets style-only changes run: the sync
  only adds the `synced.json` mark for `by: 'phone'`. history.js `writeEntry(ws, site, mod, content, at, source)`
  before replacing; trash.js `deleteMod(ws, id, {scope})` for deletes (scope = the twin).
- On the phone: `ModStore.add(m, source:)` (import rules when source is "import": reuse for "sync"), `saveEdit`'s
  `seeded`/`changeNeeds` for changed mods, `remove` keeps only `lastDeleted` (Recently deleted is new, S6).
- remote.js's `resultOf` is how a run's twin files are read safely (O_NOFOLLOW, lstat on the twin): reuse it.
- Phone ids are `<site>/<name>`; the twin is `phone~<site>`; HOST_RE is copied from remoterun.js (it lets an
  IPv4-looking host like 127.0.0.1 through, as remoterun.js does: harmless, a folder name).
- sync.js `plan` gives a conflict's sibling as `{id: sibling, conflict: id}` with no `rev`: S2 writes the sibling
  (the computer's text through `renameHeader`) first, then puts its `rev` in the `sync.plan` it sends.
- `plan`'s `leave` (Map id -> 'later' | why) is how S2 keeps busy twins (Runs.bySite) and mods over 1 MB
  (`MOD_MAX`) out: without it a too-big computer mod would look deleted there and the phone would trash its copy.
- APFS ignores case: readManifest drops a second phone id that differs only in capitals; S2 must also check the
  computer side's ids with `ignoresCase` before writing.
- `want` entries carry `back` (edit beat a delete) and `conflict` for the lines of section 10.

## For Tim (decisions)

1. D1–D10 in docs/PHONE-SYNC.md section 1 are defaults: the goal's choices plus D5 (in a conflict the phone's
   version keeps the name, the computer's is kept beside it as "(from your computer)"), D6 (an edit beats a
   delete), D8 (a mod new to the phone arrives off, as an import does) and D10 (every-site phone mods).
2. The goal widens two of the phone link's rules' wording (PHONE-SYNC.md section 9): the link can now put phone mod
   files in the computer's phone twins, where held.js judges them as any mod from outside. Written down there;
   no step goes beyond it.

## CI

- Round 1: 0bf7006 + 8627a42, run 44049845082: the clickjack flake alone, on the run and its one rerun.
