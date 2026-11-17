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
- [ ] S7. The Mods tab's line, Sync now, Recently deleted, the conflict notice; strings into IOS-APP-STRINGS.md; the
      Mac harness (mobile/test/phonelink.test.js) syncing with the helper
- [ ] S8. Simulator pass: a mod made on the phone, edited by a desktop phone-view chat (stand-in agent), back on the
      phone; a conflict; a delete

## Done this round (round 5, 2026-11-17)

- S5 (phone-link 02de94e): PROTOCOL.md's phone link section has the sync's messages, `phone.sync`, the base and
  synced.json; SECURITY.md says what a paired phone may write, how it's checked and held. CI run 44056937058: the clickjack
  flake, green on its rerun (round 4's progress commit, 44056705742, the same flake).
- S6 (ios-poc 4bcd67d): PhoneSync.swift (`run`: begin, puts, gets taken by the store, removes, end with `have`;
  `Summary`; `Scheduler`: one at a time, coalesced, a change syncs 3 s later only if a file's rev moved); ModStore
  as `PhoneSyncStore` (new as an import, off, newOff "computer"; changed as saveEdit judges, history source
  computer; deletes to `trash`, Recently deleted, 30 days, for every delete now); PhoneSyncModel owns the app's one
  PhoneLinkRemote (More's `link` is it), syncs on front, changes, `sync.changed`, Sync now; dev steps `sync`,
  `syncstate`. Mac test 7/7 (new `syncunit`: a scripted computer, 25 checks). Simulator build and the .ipa
  (dSYM 203EB9E6-FDD6-3BED-ADBD-E5A6FBAF06F3) built. ios-poc CI green: https://github.com/acapellascience/trif/actions/runs/44058240792

## Next step

S7 (ios-poc, if free): the Mods tab's line (PhoneSyncModel.last / lastProblem), Sync now, Recently deleted with
Restore, the conflict and came-back notices; strings into IOS-APP-STRINGS.md (drafts from PHONE-LINK-STRINGS.md
"Phone sync"); the Mac harness syncing with the real helper (a `check sync …` command in main.swift with a store in
memory, against Store + Server + PhoneSync session in a temp HOME).

## Notes for next round

- Rounds 1–4's notes still hold.
- The phone's side never computes a plan: it sends every mod (ids with a `/` only: the proof of concept's old
  ids are left out) and applies what the computer says. A `give` whose code's rev isn't the plan's is not taken
  (the next sync decides); `have` lists only ids the phone has after applying.
- `syncTake` refuses a file whose id comes out different from the plan's (the reader's file+site → id).
- mods-page.js shows newOff "computer" as "new" with the import's tooltip: S7 words it ("From your computer").
- For S7's and S8's Simulator runs the stand-in computer (tests/phone-link-computer.js) doesn't attach a
  `PhoneSync` session yet: add it there (the e2e test's wiring is the model), with stdin commands to write, edit
  and delete a twin file and to show the twin.
- ModStore is main-actor: the conformance is `@preconcurrency`; PhoneSync's callbacks run on main (the link's
  queue).

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
