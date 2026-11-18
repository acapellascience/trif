# Phone sync: phone mods kept the same on the iPhone and the computer

Branch `phone-link` (the computer) and `ios-poc` (the iPhone). Goal decided by Tim, 2026-11-17. Progress and the
checklist: docs/PHONE-SYNC-PROGRESS.md. Built on the phone link (docs/PHONE-LINK.md): the same pairing, the same
Noise session, the same listener. Strings: docs/PHONE-LINK-STRINGS.md ("Phone sync"), then docs/IOS-APP-STRINGS.md
on ios-poc for the phone's.

> "If I started something on my phone and want to fine tune it, I can bring it over to real TRIF and go hard."

Phone mods are **one set**, kept the same on both devices. A mod made or edited on the phone shows up in the
computer's phone twin (`sites/phone~<site>/`), where the desktop phone view (Edit for mobile) and its chats work on
it; their changes go back to the phone.

## 1. Decisions (defaults Tim can override)

Each is the goal's choice or the smallest one that fits it. Tim can change any; the section that would change is
named.

| # | Default | Where |
|---|---|---|
| D1 | **What syncs:** every mod file the phone app has, and every mod file in the computer's phone twins `sites/phone~*/`. Adds, edits and deletes, both ways. Tim, 2026-11-18. | 2 |
| D2 | **What doesn't:** desktop mods (`sites/<site>/`, `all-sites/`) stay desktop-only; approvals stay each device's (D13 only words them); a site's tier (group) switches and Pause all stay each device's (D14). A mod's own switches sync since 11-18 (D12). | 2, 11 |
| D3 | **Approval on the receiving side, never bypassed.** A synced change is judged there exactly as a change made there: held.js on the computer, the app's own approval on the phone. Style-section-only changes and style mods apply at once, as locally. Neither side's approval counts for the other (PHONE-LINK.md rule 6); the other side's approval is only a hint for the card's words (D13). | 6 |
| D4 | **Conflicts keep both.** A base revision per mod; one side changed: it wins; both changed: both are kept, the user is told. Tim, 2026-11-18. | 4 |
| D5 | **In a conflict the phone's version keeps the mod's name**, on both devices, and the computer's version is kept beside it as "{name} (from your computer)" (file `<name>-from-computer.js`). Why: the phone is the side the goal calls receiving (its copy keeps its switch, approvals and history there, and the version running on the phone in the user's hand doesn't change under them); and both devices end with the same set, so the conflict doesn't come back. The alternative (the computer's keeps the name) is the same code with the sides swapped. Tim, 2026-11-18. | 4 |
| D6 | **An edit beats a delete.** Deleted on one side and changed on the other: the changed mod comes back on the side that deleted it, and the user is told. Nothing is lost. Tim, 2026-11-18. | 4 |
| D7 | **Deletes go to the trash**, never hard: the computer's `trash/` (30 days, `trif restore`); on the phone a new Recently deleted list (30 days) in the Mods tab, since the app keeps only the last delete today. Tim, 2026-11-18. | 5 |
| D8 | **A mod new to the phone** (made on the computer) **arrives with the computer's switch state** (on, off, off on some sites: D12), still marked new ("From your computer"), and waiting for an OK there if its code can do more than change the page (with the gentle card when the hint fits, D13). The same the other way: new on the phone, it arrives on the computer with the phone's switch, held as held.js decides. Tim, 2026-11-18 (it arrived off, as an import, before). | 4b, 6 |
| D9 | **When:** the phone syncs when the app comes to the front (if paired), a few seconds after one of its phone mods changes, when the computer nudges it, and from Sync now in the Mods tab. The computer never sends a mod unasked: it sends a nudge with no data (section 7). Tim, 2026-11-18. | 8 |
| D10 | **The phone's every-site mods** (`all-sites`) stay on the phone in v1: checked in S2, the desktop phone view has no every-site folder (a `sites/phone~all-sites/` mod without `@match` would get `*://all-sites/*`, mods.js `defaultMatches`). They're `skipped` ("every-site mods stay on the phone for now") and said so in the Mods tab. Later: `defaultMatches` and the phone view taught that folder. | 2 |
| D12 | **A mod's switches sync** (Tim, 2026-11-18: "so editing continues seamlessly"): its on/off and its per-site switches follow the last change on either side, by the same base and three-way rule as the text (section 4b). Changed on both since they last agreed: **the later change wins** (each side stamps when the person last switched it; the same time: the phone's, as D5). | 4b |
| D13 | **Approvals stay per device, but gentler, both ways** (Tim, 2026-11-18). A synced mod that waits for an OK still waits (consent is per device; sync is never a way round a hold, nothing is ever approved by it), but when the other device allowed this very version, its card says "You allowed this on {device}." and its one Allow is the same Allow. The other side's approval travels only as a hint: the mod's sync key, the revision allowed there, its tier and powers (the device's name is the one it was paired under, never the wire's). It counts only if the arriving revision is that one AND it asks for nothing beyond that tier and those powers; otherwise the normal card. | 6b |
| D14 | **A site's tier (group) switches and Pause all stay each device's.** Pause all is a safety switch: it stops everything on the device in your hand, and must never be turned on or off from elsewhere. A tier's switch (On / Off for a site's style, boxed or free mods) is the same kind of brake, for one site; and the computer's phone view is a testing ground (Tim, 2026-11-18), where those brakes are for testing. Only a mod's own switches sync. | 4b |
| D15 | **Safe mode's switch-offs on the phone sync like any switch** (they change the mod's own switch): a mod that took the phone down is off in the computer's phone view too, until switched on on either side. The alternative (a per-device layer for safe mode) is open for Tim. | 4b |
| D16 | **One sync key** (`sync.js syncKey`, Swift `PhoneSync.key`): every switch and hint record is keyed through it. Today it's the mod's id (`<site>/<name>`); mods get a stable id separate from their name in a later batch (with a rename on both sides), and only that function changes. | 2 |
| D11 | **A switch, on for a paired phone.** Pairing is the opt-in, so a paired phone syncs; Settings' Connect a phone has "Keep phone mods the same here and on connected phones" under the link's switch to turn it off (the store's `sync`, only `false` is off; `phone.sync`, the panel's alone). Off, every `sync.*` is answered `off` and no nudge goes out. Tim, 2026-11-17 (in place of the round-3 draft's off by default). | 9 |

## 2. What is synced, and the ids

- **On the phone**: every `InstalledMod` (Mods.swift `ModStore.mods`). Its id is `<site>/<name>` and its file
  `<name>.js` (`InstalledMod.file`). The file's text is `code`, held versions included (a held change is the file;
  `ran` is only what runs meanwhile).
- **On the computer**: every `.js` file directly in a phone twin, `sites/phone~<site>/<name>.js`, not starting
  with `.` or `_` (mods.js `isIgnoredName`), held ones included (the file on disk is the held version).
- **On the wire** a mod is named by the phone's id, `<site>/<name>`. The computer's file is
  `sites/phone~<site>/<name>.js`: the helper adds `phone~` itself, so no message can name a desktop folder.
  `<site>` must be a plain host name (remoterun.js `HOST_RE`: lower-case labels of letters, digits and hyphens with a
  dot between; or `all-sites`, D10); `<name>` a plain mod file name (pathcheck.js `badName` and `unsafeName` clean,
  not starting with `.` or `_`, at most 120 characters, no `/`). Anything else is refused (`bad-mod`) and never
  touches the disk. A mod made on the computer keeps its twin's folder name as its site on the phone
  (`ModStore.read(text, site:)`), so the id is the same string on both sides, also for a part of a site
  (`phone~m.example.com`).
- **A revision** is the SHA-256 of the file's UTF-8 bytes, hex. Nothing is normalised: the same text is the same
  revision on both sides.

## 3. The base

The computer keeps, per paired phone, the revision each mod had when the two sides last agreed:
`<private>/phone-link/sync/<phone id>.json`, `{v: 1, base: {<id>: <revision>}, sw: {<key>: <switch>}, at}` (`sw`: the switches' base, section 4b; an older helper's file has none, and an older helper keeps only `base`), mode 600 (the folder 700),
in the private folder (no run can read it). Only the computer keeps a base: the phone sends what it has, the
computer decides (section 4) and tells the phone what to do. A lost answer costs nothing: two sides with the same
revision are in sync whatever the base says, and the base is set again.

Removing a phone deletes its base. Pairing again starts with no base: the first sync joins the two sets (a mod on
one side only is copied to the other; the same text on both is in sync; different text on both is a conflict,
section 4), so nothing is lost.

## 4. Deciding: the three-way rule

For every id on either side or in the base: P = the phone's revision (or none), C = the computer's, B = the base.

| Case | What happens |
|---|---|
| P = C | In sync. The base becomes P (none and none: the id leaves the base). |
| P = B, C ≠ B | Only the computer changed: C goes to the phone (`give`), or, C none, the phone moves its mod to its trash (`remove`). |
| C = B, P ≠ B | Only the phone changed: the computer asks for P (`want`), or, P none, moves its file to its trash. |
| P ≠ B, C ≠ B, P none | Deleted on the phone, changed on the computer: an edit beats a delete (D6), C goes to the phone (`give`, `back: true`). |
| P ≠ B, C ≠ B, C none | Deleted on the computer, changed on the phone: the computer asks for P (`want`, `back: true`). |
| P ≠ B, C ≠ B, both there | **Conflict** (D5): the computer writes its own C as a new mod beside it, `sites/phone~<site>/<name>-from-computer.js` (`-from-computer-2`… if taken), with the header's `@name` given " (from your computer)" (that one line; none: the file name says it), keeps C in its history, asks for P (`want`) and writes it at the id, and gives the new sibling to the phone (`give`, `conflict: <id>`). Both devices end with the same two mods. |

(No base and both there with different text is the last row too: two mods of the same name made apart.)

The computer leaves out of a sync, as `later`, every mod of a twin where a run is working (a phone run or a
desktop phone-view chat: `Runs.bySite`), so a run's working copy and a synced file never cross. It nudges the phone
when the run ends (section 7).

## 4b. The switches (D12, D14)

A mod's switch is `{on, off, at}`: on or off, the sites it's switched off on (a mod for several sites, the per-site
switches: the app's `offSites`, the extension's `offSites`), and `at`, when the person last changed it on that side
(ms; 0: never). Two switches are the same when `on` and `off` are (`switchKey`, without `at`). Each side stamps `at`
only for the person's own change: the Mods tab's switch on the phone (and safe mode, D15), the panel's switch, `trif
enable` or a chat's on the computer (background.js `mod.enable`); a mod switched off because it's new, or a sync's
own setting (which takes the other side's `at`), isn't a change of the person's.

The computer keeps the switches' base beside the files' (section 3), per sync key. For each mod both sides have once
the sync's files are done (not one removed, not a conflict's sibling, which starts as a new mod does), with P, C, B
the phone's, the computer's and the base:

| Case | What happens |
|---|---|
| P = C | In sync, whatever the times. The base becomes it. |
| P = B, C ≠ B | Only the computer changed: the phone takes C (the plan's `switches`). |
| C = B, P ≠ B | Only the phone changed: the computer takes P (sent to the extension at `sync.end`). |
| P ≠ B, C ≠ B (or no base: the first sync after an update, a new pairing) | **The later change wins**: the one with the greater `at`; the same `at`: the phone's (as D5). |
| A mod new to one side (D8) | It takes the other side's switch, after it's taken as a new mod (so a new mod is still marked new, and held if it needs an OK). |
| A side that can't say (an older app, an extension that hasn't reported, an older extension) | Left as it is on both sides; the base doesn't move. |

The computer's switches are the browser's (the extension of the helper that owns the phone link): it reports every
phone twin mod's `{on, off, at}` in each `modsApplied` (`phoneSwitches`), the helper keeps the last report, and a
change in it nudges the phones (section 7). What the computer takes goes to the extension as `phoneSwitches`
(`set: [{id: phone~<site>/<name>, on, off, at}]`; a phone twin's mod only, never a desktop mod's or a group's),
which applies it and reports again. The base moves at `sync.end`, and only where the phone's switches then (its
`switches`) and the extension's last report agree: a switch sent is counted done once the browser says so, and until
then the next sync sends it again. Pause all and the tier switches never travel (D14).

## 5. Deletes

Never hard. On the computer a mod the phone deleted goes through `trash.js` `deleteMod` with the twin as its scope
(`trash/<site>/<mod>@<stamp>.js`, 30 days, `trif restore`, the panel's Undo). On the phone it goes to Recently
deleted (D7, new: `ModStore.trash`, 30 days, Restore in the Mods tab), not the one-step undo. A mod restored from
either trash is a change like any other and syncs again.

## 6. Approval on the receiving side

**On the computer** a synced file is a change from outside the helper, and held.js already judges those:
`updateHeld` holds it while its code can do something not allowed for that mod there (`by: 'outside'`; style
mods and style-section-only changes run at once). The sync adds a mark so the panel can say where it came from:
`$TRIF_HOME/synced.json`, mod id → `{hash, phone, name, at}`, written before the file (as edit.js's mark), read by
`updateHeld`: the hold stays `by: 'outside'` (so every place that reads `by` judges and words it as today) and gets
`phone: <the phone's name>` for "From {phone}". A conflict's `-from-computer` sibling is a new mod there, so held.js
judges it as one (it may wait once, though it's the computer's own text): never a way round a hold. Before a file is replaced, its old text goes to `history/` (`writeEntry`,
source `phone`), so the desktop's Undo puts it back. What the phone approved counts for nothing here.

**On the phone** (Mods.swift, as the app's own changes are judged):
- a new mod (D8): `ModStore.add(m, source: "sync")` with the import's rules: off, marked new, held if its code
  needs an OK;
- a changed mod: as `saveEdit` judges an edit: `seeded` allowed from the version before, `changeNeeds` for a new
  site or becoming free; a change that needs an OK waits and the version before keeps running (`ran`); its history
  keeps the one before (source `computer`); its switch stays;
- a removed mod: to Recently deleted;
- a file the app's reader refuses (not a mod, an error in it): not taken, said in the Mods tab's line, and tried
  again next time (the base doesn't move).

"Don't allow" on either side puts back the version before; that's a change, and it syncs to the other side, where
it is judged again. So both sides keep agreeing on the text while each keeps its own approvals.

## 6b. The approval hint (D13)

Each side says, per mod, what it has allowed as it is now: the phone in `sync.begin`'s rows (`ok`: `{rev, tier,
powers}` for each mod not waiting for an OK there, `rev` its file's revision), the computer in the plan (`allowed`:
the same for each phone twin mod not held there). Nothing else: no need keys, no lines, no approval.

- **Computer**: `$TRIF_HOME/synced-allowed.json`, sync key → `{rev, tier, powers, phone, name, at}`, each phone's
  rows replaced at each `sync.begin`. held.js, for every hold: if the mod's sync key has a hint whose `rev` is the
  SHA-256 of the file as it is, whose tier is the mod's or higher (style < boxed < free) and whose powers include
  every power the mod's header asks for, the hold gets `allowedOn: <the phone's name as paired>` and the card says
  "You allowed this on {phone}." (in place of "From {phone}."). Still held, by the same rules; Allow is the same
  Allow, one tap.
- **Phone**: the plan's `allowed`, kept per sync key (`ModStore.syncHints`, the app's settings); the Mods tab's
  approval card of a held mod whose code's revision is the hint's, tier no higher, powers among the hint's, says "You
  allowed this on {computer}." (the paired computer's name). Never approved by it.
- Changed code (another revision), more powers, a higher tier, or no hint: the normal card. A hint never approves,
  never switches anything on, and is never sent for a mod waiting there.

## 7. The wire (additions to PHONE-LINK.md section 4)

The same session, the same frames, the same 8 MB limit per message. One sync at a time per phone; a new
`sync.begin` ends the one before. Each request repeats the sync's `syncId`; a stale one is `error` `no-sync`.

Phone → computer:

| `t` | Fields | Answer |
|---|---|---|
| `sync.begin` | `mods`: `[{id, rev}]`, every mod on the phone (at most 500) | `sync.plan` `{syncId, want: [{id, back?, conflict?}], give: [{id, rev, back?, conflict?}], remove: [id], later: [id], skipped: [{id, why}]}` (`skipped`: a bad id or a mod over 1 MB) |
| `sync.get` | `syncId`, `mod` (an id from `give`) | `sync.mod` `{mod, name, code}` (`code` is the computer's file as it is now) |
| `sync.put` | `syncId`, `mod` (an id from `want`), `code` | `ok` `{mod, rev, held}` (`held`: waiting for the user's OK on the computer), or `error` `bad-mod` (not a mod file, or its id), `too-big`, `changed` (the computer's file changed since the plan: the next sync decides) |
| `sync.end` | `syncId`, `have`: `[{id, rev}]` (the phone's revisions now, for the plan's ids) | `sync.done` `{synced, waiting: [{id, name}] (held on the computer), conflicts: [{id, sibling}]}`; the base moves for each id where `have` matches the computer's file |

Beside the text (an app from 11-18 says `switches: true` in `sync.begin`; an older app says nothing and gets
none of it; an older helper ignores it all, and the app finds no `switches` or `allowed` in its plan):

| Where | Field | What |
|---|---|---|
| `sync.begin` | `switches: true` | this app syncs switches and hints |
| `sync.begin` each row | `sw: {on, off, at}`, `ok?: {rev, tier, powers}` | the phone's switch; what it allows (section 6b) |
| `sync.plan` | `switches: [{id, on, off, at}]` | what the phone sets, after its gets (a new mod: after it's taken) |
| `sync.plan` | `allowed: [{id, rev, tier, powers}]` | the computer's hints |
| `sync.end` | `switches: [{id, on, off, at}]` | every mod's switch on the phone now (the switches' base moves where it matches the extension) |

Computer → phone:

| `t` | Fields |
|---|---|
| `sync.changed` | none. A phone twin's file changed on the computer (a desktop phone-view chat, an edit, a restore), or a phone twin mod's switch did (the extension's report). Sent to that phone's live session, at most every 2 seconds; the phone answers with `sync.begin` when it's ready. It carries no mod and names none. |

Error codes: `bad-mod`, `too-big`, `changed`, `no-sync`, `busy` (more than one `sync.begin` a second), `off`
(syncing is switched off on the computer: `PhoneSync`'s `enabled`, every `sync.*` answered so, nothing read or
written).

Built (S2): `helper/lib/phonelink/syncsession.js`, class `PhoneSync` beside `Remote`. The computer does its own
part in `sync.begin` (a mod deleted on the phone to the trash, a conflict's sibling written), so the plan's `give`
carries the sibling's `rev`. `skipped` also names what the computer leaves on its side: a file over 1 MB, a link
or not UTF-8 at a mod's name, a twin that's a link, an id differing from a computer one only in capitals (APFS).

Limits: a mod 1 MB (larger ones are `skipped` both ways and named in the line); 500 mods a side; the phone twins
together 16 MB (helper's own limit for all mods); a `sync.put` is checked as an import is before anything is
written: valid UTF-8, no NUL, a `==WebMod==` header the helper's reader takes (`mods.js` `buildMod`), within the
limits. The file is written in a fresh temporary file in the twin and renamed into place; the twin must be a real
folder (not a link, `lstat`), made if missing, and the file is never followed if it is a link.

## 8. When it syncs

The phone starts every sync (D9): when the app comes to the front and has a paired computer (a short connection
if More isn't using one: hello, sync, closed after 30 s of nothing); 3 seconds after its last change to a mod; on
`sync.changed`; on Sync now. No record of the computer, no sync: nothing waits, nothing is said but the line's
"last synced". While a sync runs, more changes wait for the next one.

## 9. What must hold

PHONE-LINK.md section 2 stands. The sync touches two of its rules' wording, which the goal decides and Tim
confirmed on 2026-11-17 (PHONE-LINK.md rules 3 and 5 now say so); nothing else changes:

- **Rule 3** ("the link has no message that names a folder, a file path or a desktop mod") becomes: no message
  names a folder or a path; a sync names a phone mod by its id, which the helper turns into
  `sites/phone~<site>/<name>.js` itself after the checks of section 2. The computer writes only there.
- **Rule 5** ("the link can ask for runs and nothing else") becomes: runs, and the phone twins' files by sync. Still
  no message approves a mod, changes a setting or a switch, pairs, reads a desktop mod or reaches a tab.

What that adds, said plainly: a paired phone can now put a mod file in the computer's phone twins, where the desktop
phone view runs it in the desktop browser. held.js judges it there as any mod from outside, so one that can send,
act or load from elsewhere waits for the user's OK on the computer; a style mod runs at once, as a style mod from
anywhere does. And a desktop phone-view chat's agent reads mods that came from the phone: mod files, data, as it
reads any mod in the twin.

The rest: no new listener, port or record (the session's handlers, as remote.js's); only the session's own phone
(the paired key) chooses whose base; the computer never writes outside `sites/phone~*/`, `history/`, `trash/` and
its private folder; everything arriving is checked like an import (section 7); nothing is hard-deleted.

## 10. What the user sees

- **Computer**: in Settings' Connect a phone, the switch "Keep phone mods the same here and on connected phones"
  (D11, on), and under each phone while it's on: "Synced {time}: {n} from this phone, {k} waiting
  for your OK." In the desktop phone view's list, a mod waiting because of a sync says "From {phone}" in its hold
  card. A conflict: the twin's list shows both, and the sync line says "{name} changed on both: both are kept."
- **Both**: a mod switched on, off, or off on a site on one device is the same on the other after the next sync
  (D12). The hold card of a synced mod the other device allowed as it is: "You allowed this on {device}." (D13).
- **Phone**: in the Mods tab, a line at the top after a sync that changed something: "Synced with {computer}: {n}
  changed here, {k} waiting for your OK."; a conflict: "{name} changed on both. Both are kept: “{name} (from your
  computer)” is beside it."; an edit beating a delete: "{name} came back: it was changed on {computer}."; Sync now;
  Recently deleted.

Exact drafts: docs/PHONE-LINK-STRINGS.md, "Phone sync".

## 11. Later, recorded

- **Desktop mods to the phone**: a desktop mod copied to the phone twin by choice ("Edit for mobile" already
  makes a twin of a site) rather than synced as is: desktop selectors seldom fit the phone's page.
- **Switches**: synced per mod since 11-18 (D12); site groups and Pause all stay each device's (D14).
- **Approvals**: never synced by design (rule 6); since 11-18 the other side's is a hint for the card's words (D13).
- **A stable id** separate from a mod's name, and a rename on both sides (Tim, 11-18, next batch): the sync key (D16)
  becomes it.
- **More than one phone**: each has its own base, so two phones and one computer converge through the computer;
  conflicts between two phones name the phone (`-from-<phone>`). v1 builds the base per phone already.
- **Sync away from home**: rides whatever transport the link gets (PHONE-LINK.md section 9).

## 12. Proof

- Unit (computer): ids and their refusals; the three-way rule, every row, and the first sync with no base;
  sibling names; the base file; `sync.begin/get/put/end` against a fake session (held, style at once, trash,
  history, `changed`, `later` for a busy twin, limits, a link where the twin is).
- Unit (computer, 11-18): the switches' rule, every case of section 4b and a side that can't say
  (tests/phone-sync.test.js); the switches' base; the hint's conditions (the very revision, no more powers, no
  higher tier); through the session (tests/phone-sync-session.test.js): switches both ways, the later change, new
  mods both ways (D8), an older app and an extension that hasn't said; the hint on a hold (still held), changed
  code or more powers without it, the plan's `allowed`.
- End to end (11-18, tests/phone-sync-e2e.test.js's second test): a new phone gets the twin's mods with the
  computer's switches, its switch goes to the extension (`phoneSwitches`), the extension's report nudges it, the
  later change wins; the hint on the side panel's hold.
- Unit (phone): the plan applied to `ModStore` (new as an import, changed as an edit, held keeps the version
  before running, removed to Recently deleted, a refused file).
- End to end: the stand-in phone (`tests/phone-link-client.js`) syncs with the real helper in a temp HOME on
  127.0.0.1: add, edit both ways, a conflict, deletes both ways, a held mod on the computer, a style change at
  once, the refusals. Built (S4): `tests/phone-sync-e2e.test.js`, with `PhoneClient.sync` (the app's whole
  sync: begin, get, put, end); also a race (`changed`, then the conflict), a twin with a phone run `later`, a
  twin that's a link, a second phone's own base, the switch off, and the desktop mods untouched throughout.
- The Mac test harness for the Swift side (mobile/test/phonelink.test.js) against the same helper.
- Simulator: a mod made on the phone, edited by a desktop phone-view chat (the stand-in agent), back on the phone;
  a conflict; a delete.
