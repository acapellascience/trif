# Phone sync: progress

The loop's file: read this first, every round. The design: docs/PHONE-SYNC.md (decisions D1–D11; D1–D10 are defaults Tim
can override, D11 is Tim's). Strings: docs/PHONE-LINK-STRINGS.md, "Phone sync". Built on the phone link: docs/PHONE-LINK.md.
Branch `phone-link` (worktree ~/WebMods-worktrees/phone-link) for the computer; `ios-poc` for the iPhone, only when
the round's brief says it is free.

## Checklist

Computer side:
- [x] S0. Design and protocol (docs/PHONE-SYNC.md), the strings drafts, this file
- [x] S1. `helper/lib/phonelink/sync.js` core, no I/O beyond the base file: ids ↔ twin paths and their refusals,
      revisions, the three-way plan (every row of section 4, first sync), sibling names and the @name line, the
      base file (mode 600). Unit tests `tests/phone-sync.test.js`
- [x] S2. The session side: `sync.begin/get/put/end` handlers and `sync.changed` (a `PhoneSync` class beside
      `Remote`): the import check, writes (temp + rename, no links), history before replace, trash for deletes,
      `synced.json` and held.js `by: 'phone'`, `later` for twins with a run, limits; D10 checked (phone view and
      `phone~all-sites`). Unit tests with a fake session
- [x] S3. host.js / link.js wiring (the owner helper only; removing a phone deletes its base; the nudge on twin
      changes from syncMods), the desktop lines (Settings' phone row, "From {phone}" on a hold), panel strings test
- [x] S4. Stand-in phone sync (`tests/phone-link-client.js`) and the end-to-end test against the real helper in a
      temp HOME on 127.0.0.1: add, edit both ways, conflict, deletes both ways, held, style at once, refusals
- [x] S5. ~~PHONE-LINK.md rules 3 and 5 reworded~~ (done in round 3, Tim confirmed 11-17), pointers in
      docs/PROTOCOL.md and docs/SECURITY.md

iPhone side (ios-poc):
- [x] S6. `PhoneSync.swift`: the manifest, the plan applied with ModStore's rules (new as an import, changed as an
      edit, removed to Recently deleted), when it syncs (front, after a change, nudge, Sync now); ModStore trash.
      Unit tests
- [x] S7. The Mods tab's line, Sync now, Recently deleted, the conflict notice; strings into IOS-APP-STRINGS.md; the
      Mac harness (mobile/test/phonelink.test.js) syncing with the helper
- [ ] S8. Simulator pass: a mod made on the phone, edited by a desktop phone-view chat (stand-in agent), back on the
      phone; a conflict; a delete

## Done this round (round 6, 2026-11-17)

- S7 (ios-poc 8373e19): the Mods tab's sync line and Sync now (paired only), notices at the top until OK (conflict,
  came back, couldn't read, too big), Recently deleted with Restore (all sites, folded), "from your computer" on a mod
  new from the computer; drafts in IOS-APP-STRINGS.md "Phone sync in the Mods tab". Simulator (SE): computer's mods
  arrived, a computer delete → Recently deleted → Restore went back, a conflict showed its notice (shots 276, 277).
- Harness (phone-link 010554a): the stand-in computer attaches the sync session (+ held.js's first look) with stdin
  `twin`, `write`, `delete`, `nudge`, `synced`, `held`; ios-poc's Mac test 8/8, its new last test syncs over the real
  link. CI green: ios-poc https://github.com/acapellascience/trif/actions/runs/44061257135, phone-link https://github.com/acapellascience/trif/actions/runs/44061245200
- .ipa built and copied, dSYM 0DB7485B-25B0-32F1-8601-25AC0C3A45B9.

## Next step

S8 (ios-poc, if free): the Simulator pass with a desktop phone-view chat: a mod made on the phone (Add this mod? or
-import), edited by a stand-in-agent run on the computer (how a run's accepted write reaches the live twin in the
stand-in: check Runs/stage, then `nudge`), back on the phone; a conflict; a delete. Screenshots from 278.

## Notes for next round

- Rounds 1–5's notes still hold.
- Driving the stand-in computer from a shell: `mkfifo f; tail -f f | node tests/phone-link-computer.js --seconds 900
  > log`, `echo <cmd> > f`; write lines via node (JSON.stringify) to avoid shell quoting. Kill the `tail -f` after.
- The app's dev step `modsjs` runs JS in the Mods tab: `window.webkit.messageHandlers.app.postMessage({type:'save',
  id, text})` edits a mod as the tab's editor does (how round 6 made the phone side of a conflict). Build step.json
  with node too.
- A conflict is made by a phone save and, within its 3 s change delay, a computer `write` (its nudge syncs at once).
- The line's counts are the latest sync's only (a quiet sync after shows just "Synced with … at …"); notices stay
  until OK, deduped, at most 20.
- The pairing sheet opens over the app after `simctl openurl` of the qr: tap Done (322, 68) before the Mods tab.

## For Tim (decisions)

1. D1–D10 in docs/PHONE-SYNC.md section 1 are defaults: the goal's choices plus D5 (in a conflict the phone's
   version keeps the name, the computer's is kept beside it as "(from your computer)"), D6 (an edit beats a
   delete), D8 (a mod new to the phone arrives off, as an import does) and D10 (every-site phone mods).
2. Confirmed by Tim 11-17: PHONE-LINK.md rules 3 and 5 now allow a paired phone to write phone twin mod files,
   held like any mod from outside. D11 (his): sync on for a paired phone, a Settings switch turns it off. The
   switch's wording "Keep phone mods the same here and on connected phones" is a draft.

## CI

- Round 1: 0bf7006 + 8627a42, run 44049845082: the clickjack flake alone, on the run and its one rerun.
- Round 2: efebdc6, run 44052653702: green.
- Round 3: 61c864a, run 44054353924: green.
- Round 4: 5f48cc5, run 44056254255: green.
- Round 5: phone-link 02de94e, run 44056937058: the clickjack flake, green on rerun; ios-poc 4bcd67d, run 44058240792: green.
- Round 6: phone-link 010554a, run 44061245200: green; ios-poc 8373e19, run 44061257135: green.
