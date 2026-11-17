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
- [x] S8. Simulator pass: a mod made on the phone, edited by a desktop phone-view chat (stand-in agent), back on the
      phone; a conflict; a delete

## Done this round (round 7, 2026-11-17)

- S8, the Simulator pass (SE, shots 278-283 and a recording 284-se-sync-pass.mp4 in ios-poc's mobile/browser-probe/shots/):
  two mods imported on the phone (Add, off) went to the computer's twin; a phone edit went over; a desktop phone-view
  chat (stand-in agent, `run example.com … EDIT`) edited them, and they came back (red bar, then blue on the app's
  return to the front); a conflict kept both on both sides with the notice; a phone delete → the computer's trash/, a
  computer delete → Recently deleted.
- Bug found and fixed (ios-poc a2bb8b7): a synced change sat in the store and ran only after a relaunch; now the pages'
  scripts are remade after a sync (Browser.syncApplied) and the shown page reloads if it's affected. Mac test 8/8.
- Stand-in (phone-link): the computer's `run <site> <words>` (a desktop phone-view run, nudge when done) and the
  agent's EDIT[:rrggbb]; phone-sync-e2e + phone-link-run 11/11. CI: ios-poc https://github.com/acapellascience/trif/actions/runs/44064337204 green; phone-link https://github.com/acapellascience/trif/actions/runs/44064371815 the clickjack flake alone (twice). .ipa built, dSYM F386A367-DD85-31DC-BE66-1680659BAE56.

## Next step

None: every checklist item is done. Left for Tim: the decisions below, and a pass on a real phone when he wants.

## Notes for next round

- Rounds 1–5's notes still hold.
- Round 7: a phone whose link has closed (30 s idle) gets a computer change on its next front / Sync now / change, not
  at once (D9 as designed): the nudge reaches connected phones only. A killed app with mods running trips safe mode
  (mods switched off) on its next launch: send it to the background (launch Preferences) before `simctl terminate`.
- Screenshots are 2x: tap at pixel/2.
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
- Round 7: phone-link 2e1781f, run 44064371815: the clickjack flake alone (test 144), on the run and its one rerun; ios-poc a2bb8b7, run 44064337204: green.
