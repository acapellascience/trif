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
- [ ] S4. Stand-in phone sync (`tests/phone-link-client.js`) and the end-to-end test against the real helper in a
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

## Done this round (round 3, 2026-11-17)

- S3: link.js makes `PhoneSync` beside `Remote` in the owner helper (stopped with it); `syncChanged()`, per-phone
  `synced` in `status()`, a removed phone's base deleted in `phone.remove` too. host.js: `afterWrite` runs syncMods
  with `syncWriting` set; syncMods nudges when `twinStamp()` (phone twins' .js name/size/mtime) changed otherwise;
  hold info carries `phone`. Switch D11 (Tim: on for a paired phone, off in Settings): store `sync` (only `false` is
  off), `phone.sync`, background `phoneLink.sync` (panel only). Panel: second switch, each phone's line, conflicts,
  "From {phone}." on a hold, history "before a sync from your phone". PHONE-LINK.md rules 3 and 5 say it's confirmed.
- Tests: store, panel, extension, host (real helper: sync on, plan/done, nudge on a twin edit, off refuses and
  doesn't nudge, base gone on remove). Locally 57 + 157 + 146 + 28 pass. CI 61c864a, green: https://github.com/acapellascience/trif/actions/runs/44054353924

## Next step

S4: sync in the stand-in phone (`tests/phone-link-client.js`: a `sync(mods)` doing begin/get/put/end) and the e2e
test against the real helper in a temp HOME on 127.0.0.1 (tests/phone-link-e2e.test.js style): add, edit both ways,
conflict, deletes both ways, held (From {phone} in the mods message), style at once, refusals, the switch off.

## Notes for next round

- Rounds 1–2's notes still hold (ids, base, resultOf, ignoresCase; begin does trash + sibling; skipped; put
  re-checks). What S3 settled:
- The switch is read per message from the store file (`enabled`), so another browser's helper turning it off counts
  at once; `phone.sync` off also drops syncs going on. A file without `sync` is on.
- The nudge comes from syncMods only (watcher, poll, every command's sync); the sync's own writes go through
  `afterWrite` with `state.syncWriting`, which updates `twinStamp` without nudging. The first syncMods only records.
- `link.status().phones[i].synced` is in-memory (since the helper started): null shows "Not synced yet."
- tests/phone-link-host.test.js sleeps 1.1 s between sync.begins (BEGIN_EVERY_MS); the e2e test will need the same.
- Hold cards: `info.phone` replaces the generic "It's new or changed…" reason only (both card variants in
  sidepanel.js: `fromPhone`). The phone view's list (Edit for mobile) uses the same cards.

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
