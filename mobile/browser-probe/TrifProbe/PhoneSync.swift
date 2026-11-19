import Foundation
import CryptoKit

// Phone sync, the iPhone's side (docs/PHONE-SYNC.md on branch phone-link, sections 4, 6, 7 and 8): the phone's mods
// and the computer's phone twins kept the same, both ways, over the phone link's session. No UI here, so
// mobile/test/phonelink.test.js builds it for the Mac too (with a stand-in store); the app's store is ModStore
// (Mods.swift, `PhoneSyncStore`), the link PhoneLinkRemote (`PhoneSyncLink`).
//
// One sync: `sync.begin` with every mod's {id, rev} → the computer's plan; `sync.put` each `want` (the file as it is
// now); `sync.get` each `give`, taken by the store as the app's own changes are judged (new as an import, changed as
// an edit, so what needs an OK waits for it here); `remove`d ones to Recently deleted; `sync.end` with the revisions
// the phone has now for the plan's ids (the computer moves its base only where they match its files, so a refused
// file is simply tried again next time). The computer decides everything (it alone keeps a base); the phone never
// writes what it wasn't given.
//
// When (D9, `Scheduler`): the app in front, 3 s after a change to a mod's file, the computer's `sync.changed` nudge,
// Sync now. One at a time; what comes during one waits for the next. A change is only one if a file's revision
// differs from what the last sync left (the sync's own writes aren't; since 11-18 a switch or an approval is,
// through the app's `files` signature).
//
// Beside the text (11-18; docs/PHONE-SYNC.md 4b and 6b): `switches: true` in sync.begin, each row's `sw` (the mod's
// switch: on, the sites it's off on, when the person last changed it) and `ok` (what this phone allows as it is: the
// approval hint); the plan's `switches` (set here after the gets, so a new mod takes the computer's switch, D8) and
// `allowed` (the computer's hints, kept by the store); sync.end's `switches` (every mod's now). An older computer
// sends neither: nothing changes here. A hint never approves: it only words the approval card. Every switch and hint
// is kept by `PhoneSync.key` (D16: `<site>#<stable id>`, else the file id); the wire names mods by file id.
//
// Stable ids (11-18; docs/PHONE-SYNC.md 2a, 3, 4 and 7 "Ids and renames"): `ids: true` in sync.begin, each row's `uid`
// (the mod's `@id`, where it keeps one), `body` and `meta` (SHA-256 of the text without the header's @name and @id
// lines, and of `<name>\n<id>`: ModID.revs, the shared core's mod-id.js). The plan's `renames` are applied first
// (`syncRename`: the mod moves to the computer's file id, its text as it is; one that can't, `to` taken here, ends the
// sync before sync.end, `unfinished`, and the next one decides again); a `give` with `merge: true` (a rename on one side,
// an edit on the other) has no `rev`: whatever sync.get gives is taken; a `give` with `apart: <id>` is the computer's mod
// of another's name, moved beside it ("… (from your computer)"): new here, and told. Every-site mods (all-sites/…)
// sync like any (D10). An older computer sends none of it: nothing changes here.

/// The mods the sync reads and writes.
protocol PhoneSyncStore: AnyObject {
    /// Every mod: id (`<site>/<name>`) → its file's text (a held version included: the file is what syncs).
    func syncFiles() -> [String: String]
    /// A mod from the computer: `isNew` as an import (off, marked new), else as an edit (its switch kept). Taken
    /// (waiting for an OK here or not), or refused with why (the reader's error, or its id isn't this one).
    func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken
    /// A mod deleted on the computer: to Recently deleted (never gone at once).
    func syncRemove(_ id: String)
    /// Every mod's switch, by sync key (PhoneSync.key).
    func syncSwitches() -> [String: PhoneSync.Switch]
    /// The computer's switch for a mod (it changed there, or the mod is new here): set as it is, its mark kept. False:
    /// no such mod here.
    func syncSetSwitch(_ key: String, _ s: PhoneSync.Switch) -> Bool
    /// What this phone allows as it is (each mod not waiting for an OK), by sync key: the hint the computer gets.
    func syncAllowed() -> [String: PhoneSync.Hint]
    /// The computer's hints (the plan's `allowed`), by sync key: kept for the approval card's words.
    func syncHints(_ hints: [String: PhoneSync.Hint])
    /// Each mod's stable id where it keeps one (the first by file name in its folder): file id → id.
    func syncUids() -> [String: String]
    /// The computer's rename (the plan's `renames`): the mod `from` moves to `to`, its text as it is, everything kept by
    /// it following. False: it couldn't (`to` taken here, or no such mod).
    func syncRename(_ from: String, _ to: String) -> Bool
}

/// (an older store, or a stand-in that doesn't keep them: no switches or hints, as before 11-18)
extension PhoneSyncStore {
    func syncSwitches() -> [String: PhoneSync.Switch] { [:] }
    func syncSetSwitch(_ key: String, _ s: PhoneSync.Switch) -> Bool { false }
    func syncAllowed() -> [String: PhoneSync.Hint] { [:] }
    func syncHints(_ hints: [String: PhoneSync.Hint]) {}
    func syncUids() -> [String: String] { [:] }
    func syncRename(_ from: String, _ to: String) -> Bool { false }
}

/// A request over the paired computer's session (connecting first when needed); the answer, or an `error` message.
protocol PhoneSyncLink: AnyObject {
    func syncRequest(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void)
}

final class PhoneSync {
    enum Taken: Equatable { case taken(held: Bool), refused(String) }

    /// A mod's sync key: the ONE place a mod is keyed for its switch and its hint (D16): `<site>#<stable id>` where it
    /// keeps one (docs/PHONE-SYNC.md 2a), else its file id (`<site>/<name>`), so a renamed mod keeps both.
    static func key(_ id: String, uid: String? = nil) -> String {
        guard let uid, ModID.isId(uid), let cut = id.firstIndex(of: "/") else { return id }
        return "\(id[..<cut])#\(uid)"
    }

    /// A mod's switch as the sync carries it: on, the sites it's off on (sorted), and when the person last changed it
    /// (ms since 1970; 0: never). Two are the same switch when `on` and `off` are, whatever `at`.
    /// `fresh`: off only because it came new from outside and was never switched (no choice of the person's): in a
    /// tie on the first sync after an update it yields to the computer's (docs/PHONE-SYNC.md 4b).
    struct Switch: Equatable {
        var on: Bool
        var off: [String]
        var at: Double
        var fresh = false
        init(on: Bool, off: [String], at: Double, fresh: Bool = false) {
            self.on = on; self.off = Array(Set(off)).sorted(); self.at = max(0, at.rounded(.down)); self.fresh = fresh && !on && self.at == 0
        }
        init?(_ d: [String: Any]?) {
            guard let d, let on = d["on"] as? Bool else { return nil }
            self.init(on: on, off: (d["off"] as? [String] ?? []).filter { !$0.isEmpty && $0.count <= 253 }, at: (d["at"] as? NSNumber)?.doubleValue ?? 0)
        }
        var wire: [String: Any] { fresh ? ["on": on, "off": off, "at": at, "fresh": true] : ["on": on, "off": off, "at": at] }
        func same(_ o: Switch) -> Bool { on == o.on && off == o.off }
    }

    /// The other device's approval of a mod, as a hint (D13): the revision allowed there, its tier and powers.
    struct Hint: Equatable, Codable {
        var rev: String
        var tier: String
        var powers: [String]
        static let tiers = ["style", "boxed", "free"]
        init(rev: String, tier: String, powers: [String]) { self.rev = rev; self.tier = tier; self.powers = Array(Set(powers)).sorted() }
        init?(_ d: [String: Any]?) {
            guard let d, let rev = d["rev"] as? String, rev.count == 64, rev.allSatisfy({ $0.isHexDigit && !$0.isUppercase }),
                  let tier = d["tier"] as? String, Hint.tiers.contains(tier) else { return nil }
            self.init(rev: rev, tier: tier, powers: (d["powers"] as? [String] ?? []).filter { !$0.isEmpty && $0.count <= 40 })
        }
        var wire: [String: Any] { ["rev": rev, "tier": tier, "powers": powers] }
        /// Whether it fits this version: the very revision, and what it asks for within what was allowed there (its
        /// tier no higher, every power among those). Never an approval: only the card's words.
        func fits(rev r: String, tier t: String, powers p: [String]) -> Bool {
            guard r == rev, let mine = Hint.tiers.firstIndex(of: t), let there = Hint.tiers.firstIndex(of: tier), mine <= there else { return false }
            return p.allSatisfy(powers.contains)
        }
    }

    /// What one sync did, for the Mods tab's line.
    struct Summary {
        var at = Date()
        /// From the computer, taken here (new or changed), and of those the ones waiting for an OK here.
        var taken: [String] = []
        var waitingHere: [String] = []
        /// Deleted on the computer, moved to Recently deleted here.
        var removed: [String] = []
        /// Sent to the computer, and what waits there for the user's OK (`sync.done`'s `waiting`: id, name).
        var sent: [String] = []
        var waitingThere: [(id: String, name: String)] = []
        /// Changed on both: the computer's version kept beside it (id, its sibling's id).
        var conflicts: [(id: String, sibling: String)] = []
        /// Deleted here, changed on the computer: back (an edit beats a delete).
        var cameBack: [String] = []
        /// Not taken here (the reader refused it) or not taken there (`sync.put`'s error code): tried next time.
        var refused: [(id: String, why: String)] = []
        /// Left out by the computer (a bad id, over 1 MB) or for later (a run working on its site). Every-site mods sync (D10).
        var skipped: [(id: String, why: String)] = []
        var later: [String] = []
        /// Switched here to the computer's switch (it changed there, or the mod is new here).
        var switched: [String] = []
        /// Renamed here as the computer said (from, to): applied first.
        var renamed: [(from: String, to: String)] = []
        /// The computer's mods moved beside one of the same name (its id, the phone's mod's): new here.
        var apart: [(id: String, of: String)] = []
        /// Ended before sync.end (a rename that couldn't be done here): the next sync decides again.
        var unfinished = false
        var changedAnything: Bool { !(taken.isEmpty && removed.isEmpty && sent.isEmpty && conflicts.isEmpty && refused.isEmpty && switched.isEmpty && renamed.isEmpty) }
    }
    struct Failure: Error { let code: String; let message: String }

    /// (Mac checks only: false plays an app from before 11-18, which says nothing of ids: no `ids`, no row `uid`,
    /// `body` or `meta`. The app never changes it.)
    nonisolated(unsafe) static var sendIds = true

    static func rev(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }

    private let store: PhoneSyncStore
    private let link: PhoneSyncLink
    init(store: PhoneSyncStore, link: PhoneSyncLink) { self.store = store; self.link = link }

    /// One whole sync. done: what it did, or why it couldn't (the link's or the computer's `error`: off, busy, …).
    func run(_ done: @escaping (Result<Summary, Failure>) -> Void) {
        let files = store.syncFiles()
        let switches = store.syncSwitches(), allowed = store.syncAllowed(), uids = store.syncUids()
        let manifest: [[String: Any]] = files.keys.sorted().map { id in
            let rev = Self.rev(files[id]!), k = Self.key(id, uid: uids[id])
            var row: [String: Any] = ["id": id, "rev": rev]
            if let sw = switches[k] { row["sw"] = sw.wire }
            if let ok = allowed[k], ok.rev == rev { row["ok"] = ok.wire }
            if Self.sendIds, let u = uids[id], ModID.isId(u) { row["uid"] = u }
            if Self.sendIds, let r = ModID.revs(files[id]!) { row["body"] = r.body; row["meta"] = r.meta }
            return row
        }
        var begin: [String: Any] = ["t": "sync.begin", "switches": true, "mods": manifest]
        if Self.sendIds { begin["ids"] = true }
        link.syncRequest(begin) { [self] plan in
            guard plan["t"] as? String == "sync.plan", let syncId = plan["syncId"] as? String else { return done(.failure(Self.failure(plan))) }
            var s = Summary()
            // (renames first: the rest of the plan names the new ids. One that can't be done here ends this sync
            // before sync.end, so the computer's base doesn't move; the next sync decides again)
            for r in plan["renames"] as? [[String: Any]] ?? [] {
                guard let from = r["from"] as? String, let to = r["to"] as? String, from != to else { continue }
                if self.store.syncRename(from, to) { s.renamed.append((from, to)); continue }
                s.refused.append((from, "rename to \(to): can't here"))
                s.unfinished = true
                s.at = Date()
                return done(.success(s))
            }
            let want = (plan["want"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
            // (a merge's give has no rev: the text both keep, made by the computer at sync.put)
            let give = (plan["give"] as? [[String: Any]] ?? []).filter { $0["id"] is String && ($0["rev"] is String || $0["merge"] as? Bool == true) }
            let remove = plan["remove"] as? [String] ?? []
            s.later = plan["later"] as? [String] ?? []
            s.skipped = (plan["skipped"] as? [[String: Any]] ?? []).map { ($0["id"] as? String ?? "", $0["why"] as? String ?? "") }
            for g in give where g["back"] as? Bool == true { s.cameBack.append(g["id"] as! String) }
            for g in give { if let of = g["conflict"] as? String { s.conflicts.append((of, g["id"] as! String)) } }
            for g in give { if let of = g["apart"] as? String { s.apart.append((g["id"] as! String, of)) } }
            self.puts(want[...], syncId, s) { s in
                self.gets(give[...], syncId, s) { s in
                    var s = s
                    for id in remove where self.store.syncFiles()[id] != nil { self.store.syncRemove(id); s.removed.append(id) }
                    // (the computer's switches: after the gets, so a mod new here takes its switch; an older computer has none)
                    // (keys by the ids the mods keep now: a new one took its id with its text)
                    let uidsNow = self.store.syncUids()
                    for x in plan["switches"] as? [[String: Any]] ?? [] {
                        guard let id = x["id"] as? String, let sw = Switch(x), self.store.syncFiles()[id] != nil else { continue }
                        if self.store.syncSetSwitch(Self.key(id, uid: uidsNow[id]), sw) { s.switched.append(id) }
                    }
                    if let list = plan["allowed"] as? [[String: Any]] {
                        var hints: [String: Hint] = [:]
                        for x in list { if let id = x["id"] as? String, let h = Hint(x) { hints[Self.key(id, uid: uidsNow[id])] = h } }
                        self.store.syncHints(hints)
                    }
                    let now = self.store.syncFiles()
                    let ids = Set(want + give.map { $0["id"] as! String } + remove)
                    let have = ids.sorted().compactMap { id in now[id].map { ["id": id, "rev": Self.rev($0)] } }
                    let swNow = self.store.syncSwitches(), uidsEnd = self.store.syncUids()
                    let swList: [[String: Any]] = now.keys.sorted().compactMap { id in swNow[Self.key(id, uid: uidsEnd[id])].map { var d = $0.wire; d["id"] = id; return d } }
                    self.link.syncRequest(["t": "sync.end", "syncId": syncId, "have": have, "switches": swList]) { end in
                        guard end["t"] as? String == "sync.done" else { return done(.failure(Self.failure(end))) }
                        s.waitingThere = (end["waiting"] as? [[String: Any]] ?? []).map { ($0["id"] as? String ?? "", $0["name"] as? String ?? "") }
                        s.at = Date()
                        done(.success(s))
                    }
                }
            }
        }
    }

    private func puts(_ ids: ArraySlice<String>, _ syncId: String, _ s: Summary, _ next: @escaping (Summary) -> Void) {
        guard let id = ids.first else { return next(s) }
        guard let code = store.syncFiles()[id] else { return puts(ids.dropFirst(), syncId, s, next) } // (gone meanwhile: the next sync)
        link.syncRequest(["t": "sync.put", "syncId": syncId, "mod": id, "code": code]) { [self] a in
            var t = s
            if a["t"] as? String == "ok" { t.sent.append(id) } else { t.refused.append((id, "computer: \(a["code"] as? String ?? "failed")")) }
            puts(ids.dropFirst(), syncId, t, next)
        }
    }

    private func gets(_ list: ArraySlice<[String: Any]>, _ syncId: String, _ s: Summary, _ next: @escaping (Summary) -> Void) {
        guard let g = list.first else { return next(s) }
        let id = g["id"] as! String, want = g["rev"] as? String
        link.syncRequest(["t": "sync.get", "syncId": syncId, "mod": id]) { [self] a in
            var t = s
            // (the computer's file changed since its plan: not taken, the next sync decides; a merge has no rev: the
            // text the computer made, whatever it is)
            if a["t"] as? String == "sync.mod", let code = a["code"] as? String, want == nil || Self.rev(code) == want {
                let isNew = store.syncFiles()[id] == nil
                switch store.syncTake(id, code: code, isNew: isNew) {
                case .taken(let held): t.taken.append(id); if held { t.waitingHere.append(id) }
                case .refused(let why): t.refused.append((id, why))
                }
            }
            gets(list.dropFirst(), syncId, t, next)
        }
    }

    private static func failure(_ a: [String: Any]) -> Failure {
        Failure(code: a["code"] as? String ?? "failed", message: a["message"] as? String ?? "no answer")
    }

    /// The toast after a sync (Tim, 11-18; 11-19: "they happen every time you hit a switch … either way they're just
    /// noise"): only after a sync the person started on the phone (Sync now, the first sync after pairing), never
    /// after an automatic one (the app in front, a switch or another change, the computer's nudge), whatever it did.
    /// Its words are the computer's own toast seen from the phone's side: what came from the computer (taken here,
    /// new or changed, and deleted there), what went to it, and what waits here for an OK, or "nothing new"
    /// (switches aren't counted, as on the computer: extension/phonelink.js `syncToast(done, { asked })` on branch
    /// phone-link); a sync that didn't happen says why. An automatic sync's trace is the lasting line instead
    /// (`lastLine`: "Last synced …", and quietly, while the latest try failed, why). Drafts in docs/IOS-APP-STRINGS.md.
    enum Toast {
        /// The reasons the person started (the Scheduler's `why`): Sync now and pairing's first sync.
        static func asked(_ why: String) -> Bool { why == "now" || why == "pair" }

        /// What to show after a sync (nil: no toast). A failure "notPaired" is never said.
        static func after(_ r: Result<Summary, Failure>, why: String, computer c: String) -> (text: String, problem: Bool)? {
            guard asked(why) else { return nil }
            switch r {
            case .success(let s) where !s.unfinished: return (words(s, c), false)
            case .success: return (problemWords("unfinished", c), true)
            case .failure(let f): return f.code == "notPaired" ? nil : (problemWords(f.code, c), true)
            }
        }

        /// The counts' words, or "nothing new".
        static func words(_ s: Summary, _ c: String) -> String {
            let n = s.taken.count + s.removed.count, m = s.sent.count, k = s.waitingHere.count
            guard n + m + k > 0 else { return "Synced with \(c) · nothing new" }
            return "Synced with \(c) · \(n) from the computer, \(m) to it" + (k > 0 ? ", \(k) waiting for your OK" : "")
        }

        static func problemWords(_ code: String, _ c: String) -> String {
            switch code {
            case "off": return "Not synced: syncing phone mods is off on \(c)"
            case "notFound": return "Not synced: can't find \(c). It may be asleep, on another Wi-Fi, or have no browser with TRIF open"
            case "removed": return "Not synced: this iPhone isn't connected to \(c) any more"
            case "denied": return "Not synced: TRIF needs Local Network access to find \(c)"
            default: return "Not synced with \(c) this time. TRIF tries again"
            }
        }

        /// What the latest try's failure is kept as for the lasting line (nil: it worked, or nothing to keep).
        static func failed(_ r: Result<Summary, Failure>) -> String? {
            switch r {
            case .success(let s): return s.unfinished ? "unfinished" : nil
            case .failure(let f): return f.code == "notPaired" ? nil : f.code
            }
        }

        /// The why after "the last try didn't get through" (nil: none said, as for a dropped connection).
        static func reasonWords(_ code: String, _ c: String) -> String? {
            switch code {
            case "off": return "syncing phone mods is off on \(c)"
            case "notFound": return "can't find \(c)"
            case "removed": return "this iPhone isn't connected to \(c) any more"
            case "denied": return "TRIF needs Local Network access"
            default: return nil
            }
        }

        /// The lasting line on My computer and in Settings: "Last synced just now / 5 min ago / at 2:05 PM / Nov 17 at
        /// 2:05 PM" (as the computer's phone line says its {ago}), and while the latest try failed (`failed`, kept until
        /// a sync works), " · the last try didn't get through: {reason}". Nil before the first sync.
        static func lastLine(at t: Date?, failed: String?, computer c: String, now: Date = Date()) -> String? {
            guard let t else { return nil }
            let secs = now.timeIntervalSince(t)
            var line: String
            if secs < 60 { line = "Last synced just now" }
            else if secs < 3600 { line = "Last synced \(Int(secs / 60)) min ago" }
            else {
                let time = t.formatted(date: .omitted, time: .shortened)
                line = Calendar.current.isDateInToday(t) ? "Last synced at \(time)" : "Last synced \(t.formatted(.dateTime.month(.abbreviated).day())) at \(time)"
            }
            if let f = failed { line += " · the last try didn't get through" + (reasonWords(f, c).map { ": \($0)" } ?? "") }
            return line
        }
    }

    /// When the phone syncs (D9). `sync` runs one (PhoneSync.run with the app's store and link); its answer comes
    /// back through `finished`. Callbacks and calls on one queue (main in the app).
    ///
    /// One at a time, and never two begun closer than `gap` (11-19, Tim: "half the time they say not synced"): the
    /// computer refuses a sync.begin within a second of the last (`busy`), and a switch's sync was followed at once
    /// by the computer's nudge for that same switch arriving in the browser. What comes while one runs, or before the
    /// gap is over, runs once after it. A `busy` answer is tried again quietly after the gap (3 times at most),
    /// never said. A change syncs `changeDelay` after the last change of a burst: five switches in two seconds are
    /// one sync, three seconds after the last.
    final class Scheduler {
        let changeDelay: Double
        let gap: Double
        private let files: () -> [String: String]
        private let sync: (@escaping (Result<Summary, Failure>) -> Void) -> Void
        /// Each sync's answer, and its reason (front, change, nudge; the person's: now, pair).
        var finished: ((Result<Summary, Failure>, String) -> Void)?
        private(set) var running = false
        /// The reason of the sync waiting (for the one running to end, or for the gap).
        private var pending: String?
        private var changeTimer: DispatchWorkItem?
        private var gapTimer: DispatchWorkItem?
        private var lastStart: Double?
        private var busyTries = 0
        private let queue: DispatchQueue
        /// The files' revisions the last sync left (nil: no sync yet this launch).
        private(set) var known: [String: String]?
        /// (tests) how many syncs were begun, and how many `busy` answers were tried again
        private(set) var started = 0, retried = 0

        init(changeDelay: Double = 3, gap: Double = 1.2, queue: DispatchQueue = .main, files: @escaping () -> [String: String],
             sync: @escaping (@escaping (Result<Summary, Failure>) -> Void) -> Void) {
            self.changeDelay = changeDelay; self.gap = gap; self.queue = queue; self.files = files; self.sync = sync
        }

        private func revs() -> [String: String] { files().mapValues(PhoneSync.rev) }
        private static func clock() -> Double { ProcessInfo.processInfo.systemUptime }

        /// (the reason kept: the person's wins over an automatic one, so its toast says "nothing new" too)
        private func want(_ why: String) {
            if pending == nil || Toast.asked(why) && !Toast.asked(pending!) { pending = why }
        }

        /// Sync now (or once the one running ends and the gap is over). What comes meanwhile runs once after it,
        /// with the person's reason if one of them was theirs.
        func now(_ why: String) {
            changeTimer?.cancel(); changeTimer = nil
            want(why)
            kick()
        }

        private func kick() {
            guard !running, gapTimer == nil, let why = pending else { return }
            let wait = lastStart.map { gap - (Self.clock() - $0) } ?? 0
            if wait > 0 {
                let w = DispatchWorkItem { [weak self] in self?.gapTimer = nil; self?.kick() }
                gapTimer = w
                queue.asyncAfter(deadline: .now() + wait, execute: w)
                return
            }
            pending = nil
            running = true
            lastStart = Self.clock()
            started += 1
            sync { [weak self] r in
                guard let self else { return }
                self.running = false
                // (busy: a sync begun within the computer's second; quietly again after the gap)
                if case .failure(let f) = r, f.code == "busy", self.busyTries < 3 {
                    self.busyTries += 1; self.retried += 1
                    self.want(why)
                    self.kick()
                    return
                }
                self.busyTries = 0
                if case .success(let s) = r, !s.unfinished { self.known = self.revs() }
                self.finished?(r, why)
                self.kick()
            }
        }

        /// The mods changed (a switch, an edit, a delete…): a sync `changeDelay` after the last change, if a file
        /// differs from what the last sync left.
        func changed() {
            changeTimer?.cancel()
            let w = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.changeTimer = nil
                guard let k = self.known, k != self.revs() else { return } // (no sync yet: the app's first one covers it)
                self.now("change")
            }
            changeTimer = w
            queue.asyncAfter(deadline: .now() + changeDelay, execute: w)
        }
    }
}

extension Result where Success == PhoneSync.Summary, Failure == PhoneSync.Failure {
    /// The failure's code (nil: a sync that happened).
    var failureCode: String? { if case .failure(let f) = self { return f.code } else { return nil } }
}
