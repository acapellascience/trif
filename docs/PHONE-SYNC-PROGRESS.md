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
- [x] S2. The session side: `sync.begin/get/put/end` handlers and `sync.changed` (a `PhoneSync` class beside
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

## Done this round (round 2, 2026-11-17)

- S2: `helper/lib/phonelink/syncsession.js` (`PhoneSync`: begin/get/put/end, `changed()` nudge, `status(phoneId)`,
  base deleted on unpair), held.js `synced.json` (`recordSynced`/`loadSynced`; the hold stays `by: 'outside'` and
  gets `phone: <name>`), history source `phone`. D10 checked: every-site phone mods stay on the phone in v1.
- `tests/phone-sync-session.test.js` (7 tests, fake session/server, real held/history/trash; the capitals one runs on
  APFS, skipped on CI's Linux). Locally also 140 related tests pass. CI efebdc6, all green:
  https://github.com/acapellascience/trif/actions/runs/44052653702

## Next step

S3: wire `PhoneSync` in host.js (owner helper only, beside `Remote`; `afterWrite: () => { syncMods('phone sync');
return state.held; }`; `enabled` from a setting, default on; `changed()` from syncMods when a twin's file changed and
it wasn't the sync's own write), the Settings phone row line from `status()`, "From {phone}" on a hold card
(`info.phone`), the history label for source `phone` (sidepanel.js `HISTORY_SOURCE`), the panel strings test.

## Notes for next round

- Round 1's notes still hold (ids, base, resultOf, ignoresCase); what S2 settled:
- The computer does its part in `sync.begin`: trash (its own move into trash.js's layout, since trash.js `parseId`
  refuses names with spaces, which phone ids allow) and the conflict sibling (written, its `rev` in `give`). The base
  moves at begin for `agreed`/`gone`, at end for every planned id whose `have` matches the file now.
- `skipped` also carries the computer side's left-alone ids (big, link, not UTF-8, linked twin, capitals,
  every-site), so the phone's line can name them; a phone id whose twin is a link is skipped, not wanted.
- `put` re-checks: the plan's rev against the file now (`changed`), a run started since (`changed`), 16 MB of twins.
- `held` in put's answer: `afterWrite`'s map (host's `state.held`), or held.updateHeld here when none (tests).
- The nudge skips a phone with a sync going on; S3 should not nudge for the sync's own writes (or accept one extra
  no-op sync: harmless, everything agrees).
- The switch to turn it off if Tim says no to the rule 3/5 wording: `new PhoneSync(..., {enabled: () => false})`,
  or just don't start it in host.js: no other code path writes twins from the link.
- `sync.done`'s `waiting` lists this phone's synced mods held now (synced.json phone id + held `phone`).

## For Tim (decisions)

1. D1–D10 in docs/PHONE-SYNC.md section 1 are defaults: the goal's choices plus D5 (in a conflict the phone's
   version keeps the name, the computer's is kept beside it as "(from your computer)"), D6 (an edit beats a
   delete), D8 (a mod new to the phone arrives off, as an import does) and D10 (every-site phone mods).
2. (Sent to Tim for confirmation, 11-17; S2 built as designed and easy to switch off: see notes.) The goal widens two of the phone link's rules' wording (PHONE-SYNC.md section 9): the link can now put phone mod
   files in the computer's phone twins, where held.js judges them as any mod from outside. Written down there;
   no step goes beyond it.

## CI

- Round 1: 0bf7006 + 8627a42, run 44049845082: the clickjack flake alone, on the run and its one rerun.
- Round 2: efebdc6, run 44052653702: green.
