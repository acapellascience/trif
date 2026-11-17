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
- [ ] S5. ~~PHONE-LINK.md rules 3 and 5 reworded~~ (done in round 3, Tim confirmed 11-17), pointers in
      docs/PROTOCOL.md and docs/SECURITY.md

iPhone side (ios-poc):
- [ ] S6. `PhoneSync.swift`: the manifest, the plan applied with ModStore's rules (new as an import, changed as an
      edit, removed to Recently deleted), when it syncs (front, after a change, nudge, Sync now); ModStore trash.
      Unit tests
- [ ] S7. The Mods tab's line, Sync now, Recently deleted, the conflict notice; strings into IOS-APP-STRINGS.md; the
      Mac harness (mobile/test/phonelink.test.js) syncing with the helper
- [ ] S8. Simulator pass: a mod made on the phone, edited by a desktop phone-view chat (stand-in agent), back on the
      phone; a conflict; a delete

## Done this round (round 4, 2026-11-17)

- S4: `PhoneClient.sync(mods)` in tests/phone-link-client.js (begin, get each give, put each want, remove to
  `phone.trash`, end with `have`; `PhoneClient.rev`; `beforePuts` for races). tests/phone-sync-e2e.test.js: the
  real helper in a temp HOME on 127.0.0.1, one story: the first sync joins (held clicker "From Tim's iPhone" in the
  mods message, style and plain at once, every-site and 7 bad ids skipped), no nudge for its own writes, desktop
  edit nudges and goes over, phone edit with history (source phone), a race (`changed`) then the conflict kept
  both ways, deletes both ways to the trashes, `later` during a paused phone run, bad-mod/too-big/bad-mod id/
  no-sync/busy, a linked twin left alone, phone B's own base, the switch off. Desktop mods untouched.
- Passes 3 of 3 locally (~22 s); phone-link-e2e, -host, sync-session, sync: 17 pass. CI 5f48cc5
  green: https://github.com/acapellascience/trif/actions/runs/44056254255
- Browser tests once locally (headless, muted, cdp-page.js's lock and 1.5 GB watchdog, one at a time;
  TRIF_E2E_CHROME = ~/WebMods/tests/e2e/.browsers' Chrome, the worktree has none): phone-link-browser 1/1,
  phone-browser 5/5 pass.

## Next step

S5: pointers in docs/PROTOCOL.md and docs/SECURITY.md (short: sync rides the session; rules 3 and 5). Then, with
ios-poc free, S6 (PhoneSync.swift).

## Notes for next round

- Rounds 1–3's notes still hold. S4 found no helper bug. What it settled:
- A conflict's `want` carries `conflict: true` (the doc's table says `conflict?`); `give` carries `conflict: <id>`.
- The panel's `mods` message can come between puts: wait for one with every expected id (`nextMods`).
- History and trash entries have `.source` / `.created` beside the `.js`: filter on `.js`.
- The stand-in agent's `PAUSE:<word>` phone run is enough to make a twin busy (`later`); after `done` a sync or
  two may still say `later` while the run winds down (the test retries).
- For S7's Mac harness: `PhoneClient.sync` is the reference for the order of messages the app sends.

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
