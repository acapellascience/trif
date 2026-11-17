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
| D1 | **What syncs:** every mod file the phone app has, and every mod file in the computer's phone twins `sites/phone~*/`. Adds, edits and deletes, both ways. | 2 |
| D2 | **What doesn't (v1):** desktop mods (`sites/<site>/`, `all-sites/`) stay desktop-only; each device's on/off switches (and site groups, holds' approvals) stay its own. Both are later options (section 11). | 2, 11 |
| D3 | **Approval on the receiving side, never bypassed.** A synced change is judged there exactly as a change made there: held.js on the computer, the app's own approval on the phone. Style-section-only changes and style mods apply at once, as locally. Neither side's approval counts for the other (PHONE-LINK.md rule 6). | 6 |
| D4 | **Conflicts keep both.** A base revision per mod; one side changed: it wins; both changed: both are kept, the user is told. | 4 |
| D5 | **In a conflict the phone's version keeps the mod's name**, on both devices, and the computer's version is kept beside it as "{name} (from your computer)" (file `<name>-from-computer.js`). Why: the phone is the side the goal calls receiving (its copy keeps its switch, approvals and history there, and the version running on the phone in the user's hand doesn't change under them); and both devices end with the same set, so the conflict doesn't come back. The alternative (the computer's keeps the name) is the same code with the sides swapped. | 4 |
| D6 | **An edit beats a delete.** Deleted on one side and changed on the other: the changed mod comes back on the side that deleted it, and the user is told. Nothing is lost. | 4 |
| D7 | **Deletes go to the trash**, never hard: the computer's `trash/` (30 days, `trif restore`); on the phone a new Recently deleted list (30 days) in the Mods tab, since the app keeps only the last delete today. | 5 |
| D8 | **A mod new to the phone** (made on the computer) **arrives as an import does**: off, marked new ("From your computer"), waiting for an OK if its code can do more than change the page. A changed mod keeps its switch. | 6 |
| D9 | **When:** the phone syncs when the app comes to the front (if paired), a few seconds after one of its phone mods changes, when the computer nudges it, and from Sync now in the Mods tab. The computer never sends a mod unasked: it sends a nudge with no data (section 7). | 8 |
| D10 | **The phone's every-site mods** (`all-sites`) sync to `sites/phone~all-sites/` if the desktop phone view runs that folder; to check in step S2, else they're left out of v1 and said so in the Mods tab. | 2 |

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
`<private>/phone-link/sync/<phone id>.json`, `{v: 1, base: {<id>: <revision>}, at}`, mode 600 (the folder 700),
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

## 5. Deletes

Never hard. On the computer a mod the phone deleted goes through `trash.js` `deleteMod` with the twin as its scope
(`trash/<site>/<mod>@<stamp>.js`, 30 days, `trif restore`, the panel's Undo). On the phone it goes to Recently
deleted (D7, new: `ModStore.trash`, 30 days, Restore in the Mods tab), not the one-step undo. A mod restored from
either trash is a change like any other and syncs again.

## 6. Approval on the receiving side

**On the computer** a synced file is a change from outside the helper, and held.js already judges those:
`updateHeld` holds it while its code can do something not allowed for that mod there (`by: 'outside'`; style
mods and style-section-only changes run at once). The sync adds a mark so the panel can say where it came from:
`$TRIF_HOME/synced.json`, mod id → `{hash, phone, at}`, written before the file (as edit.js's mark), read by
`updateHeld` to record `by: 'phone'`. Before a file is replaced, its old text goes to `history/` (`writeEntry`,
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

Computer → phone:

| `t` | Fields |
|---|---|
| `sync.changed` | none. A phone twin's file changed on the computer (a desktop phone-view chat, an edit, a restore). Sent to that phone's live session, at most every 2 seconds; the phone answers with `sync.begin` when it's ready. It carries no mod and names none. |

Error codes: `bad-mod`, `too-big`, `changed`, `no-sync`, `busy` (more than one `sync.begin` a second).

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

PHONE-LINK.md section 2 stands. The sync touches two of its rules' wording, which the goal decides; nothing else
changes:

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

- **Computer**: in Settings' Connect a phone, under each phone: "Synced {time}: {n} from this phone, {k} waiting
  for your OK." In the desktop phone view's list, a mod waiting because of a sync says "From {phone}" in its hold
  card. A conflict: the twin's list shows both, and the sync line says "{name} changed on both: both are kept."
- **Phone**: in the Mods tab, a line at the top after a sync that changed something: "Synced with {computer}: {n}
  changed here, {k} waiting for your OK."; a conflict: "{name} changed on both. Both are kept: “{name} (from your
  computer)” is beside it."; an edit beating a delete: "{name} came back: it was changed on {computer}."; Sync now;
  Recently deleted.

Exact drafts: docs/PHONE-LINK-STRINGS.md, "Phone sync".

## 11. Later, recorded

- **Desktop mods to the phone**: a desktop mod copied to the phone twin by choice ("Edit for mobile" already
  makes a twin of a site) rather than synced as is: desktop selectors seldom fit the phone's page.
- **Switches** (and site groups): synced per mod, with the same base rule; v1 keeps each device's.
- **Approvals**: never synced by design (rule 6), unless Tim decides otherwise.
- **More than one phone**: each has its own base, so two phones and one computer converge through the computer;
  conflicts between two phones name the phone (`-from-<phone>`). v1 builds the base per phone already.
- **Sync away from home**: rides whatever transport the link gets (PHONE-LINK.md section 9).

## 12. Proof

- Unit (computer): ids and their refusals; the three-way rule, every row, and the first sync with no base;
  sibling names; the base file; `sync.begin/get/put/end` against a fake session (held, style at once, trash,
  history, `changed`, `later` for a busy twin, limits, a link where the twin is).
- Unit (phone): the plan applied to `ModStore` (new as an import, changed as an edit, held keeps the version
  before running, removed to Recently deleted, a refused file).
- End to end: the stand-in phone (`tests/phone-link-client.js`) syncs with the real helper in a temp HOME on
  127.0.0.1: add, edit both ways, a conflict, deletes both ways, a held mod on the computer, a style change at
  once, the refusals.
- The Mac test harness for the Swift side (mobile/test/phonelink.test.js) against the same helper.
- Simulator: a mod made on the phone, edited by a desktop phone-view chat (the stand-in agent), back on the phone;
  a conflict; a delete.
