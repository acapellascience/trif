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
// differs from what the last sync left (a switch, or the sync's own writes, isn't).

/// The mods the sync reads and writes.
protocol PhoneSyncStore: AnyObject {
    /// Every mod: id (`<site>/<name>`) → its file's text (a held version included: the file is what syncs).
    func syncFiles() -> [String: String]
    /// A mod from the computer: `isNew` as an import (off, marked new), else as an edit (its switch kept). Taken
    /// (waiting for an OK here or not), or refused with why (the reader's error, or its id isn't this one).
    func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken
    /// A mod deleted on the computer: to Recently deleted (never gone at once).
    func syncRemove(_ id: String)
}

/// A request over the paired computer's session (connecting first when needed); the answer, or an `error` message.
protocol PhoneSyncLink: AnyObject {
    func syncRequest(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void)
}

final class PhoneSync {
    enum Taken: Equatable { case taken(held: Bool), refused(String) }

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
        /// Left out by the computer (a bad id, over 1 MB, every-site mods) or for later (a run working on its site).
        var skipped: [(id: String, why: String)] = []
        var later: [String] = []
        var changedAnything: Bool { !(taken.isEmpty && removed.isEmpty && sent.isEmpty && conflicts.isEmpty && refused.isEmpty) }
    }
    struct Failure: Error { let code: String; let message: String }

    static func rev(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }

    private let store: PhoneSyncStore
    private let link: PhoneSyncLink
    init(store: PhoneSyncStore, link: PhoneSyncLink) { self.store = store; self.link = link }

    /// One whole sync. done: what it did, or why it couldn't (the link's or the computer's `error`: off, busy, …).
    func run(_ done: @escaping (Result<Summary, Failure>) -> Void) {
        let files = store.syncFiles()
        let manifest = files.keys.sorted().map { ["id": $0, "rev": Self.rev(files[$0]!)] }
        link.syncRequest(["t": "sync.begin", "mods": manifest]) { [self] plan in
            guard plan["t"] as? String == "sync.plan", let syncId = plan["syncId"] as? String else { return done(.failure(Self.failure(plan))) }
            let want = (plan["want"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
            let give = (plan["give"] as? [[String: Any]] ?? []).filter { $0["id"] is String && $0["rev"] is String }
            let remove = plan["remove"] as? [String] ?? []
            var s = Summary()
            s.later = plan["later"] as? [String] ?? []
            s.skipped = (plan["skipped"] as? [[String: Any]] ?? []).map { ($0["id"] as? String ?? "", $0["why"] as? String ?? "") }
            for g in give where g["back"] as? Bool == true { s.cameBack.append(g["id"] as! String) }
            for g in give { if let of = g["conflict"] as? String { s.conflicts.append((of, g["id"] as! String)) } }
            self.puts(want[...], syncId, s) { s in
                self.gets(give[...], syncId, s) { s in
                    var s = s
                    for id in remove where self.store.syncFiles()[id] != nil { self.store.syncRemove(id); s.removed.append(id) }
                    let now = self.store.syncFiles()
                    let ids = Set(want + give.map { $0["id"] as! String } + remove)
                    let have = ids.sorted().compactMap { id in now[id].map { ["id": id, "rev": Self.rev($0)] } }
                    self.link.syncRequest(["t": "sync.end", "syncId": syncId, "have": have]) { end in
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
        let id = g["id"] as! String, want = g["rev"] as! String
        link.syncRequest(["t": "sync.get", "syncId": syncId, "mod": id]) { [self] a in
            var t = s
            // (the computer's file changed since its plan: not taken, the next sync decides)
            if a["t"] as? String == "sync.mod", let code = a["code"] as? String, Self.rev(code) == want {
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

    /// When the phone syncs (D9). `sync` runs one (PhoneSync.run with the app's store and link); its answer comes
    /// back through `finished`. Callbacks and calls on one queue (main in the app).
    final class Scheduler {
        let changeDelay: Double
        private let files: () -> [String: String]
        private let sync: (@escaping (Result<Summary, Failure>) -> Void) -> Void
        /// Each sync's answer, and its reason (front, change, nudge, now).
        var finished: ((Result<Summary, Failure>, String) -> Void)?
        private(set) var running = false
        private var again: String?
        private var changeTimer: DispatchWorkItem?
        private let queue: DispatchQueue
        /// The files' revisions the last sync left (nil: no sync yet this launch).
        private(set) var known: [String: String]?

        init(changeDelay: Double = 3, queue: DispatchQueue = .main, files: @escaping () -> [String: String],
             sync: @escaping (@escaping (Result<Summary, Failure>) -> Void) -> Void) {
            self.changeDelay = changeDelay; self.queue = queue; self.files = files; self.sync = sync
        }

        private func revs() -> [String: String] { files().mapValues(PhoneSync.rev) }

        /// Sync now (or once the one running ends).
        func now(_ why: String) {
            changeTimer?.cancel(); changeTimer = nil
            guard !running else { again = again ?? why; return }
            running = true
            sync { [weak self] r in
                guard let self else { return }
                self.running = false
                if case .success = r { self.known = self.revs() }
                self.finished?(r, why)
                if let w = self.again { self.again = nil; self.now(w) }
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
