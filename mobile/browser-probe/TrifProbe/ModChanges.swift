import Foundation

/// The mod store's change rules (docs/MOBILE-BEHAVIOUR.md, Mods and holds): what an add keeps of the version before and
/// how its switch starts, History's 30 days and 30 versions, Recently deleted's 30 days and 200 entries, Undo (of an
/// add, of a delete), putting one back, Don't allow's and a restore's carry-over. The phones' shared rule:
/// mobile/shared/core/mod-store.js part 2 (TrifCore.modStore), through Core.swift (user actions and syncs, not hot
/// paths). The records stay Swift's (ModStore): the rules read times, ids and hold facts, and answer with indices into
/// the lists given (-1: the new entry) and the names of the fields taken from the version before. No UI: the Mac check
/// (mobile/test/modstore.test.js) builds it. If the shared rule doesn't answer: nothing is lost and nothing new runs.
enum ModChanges {
    /// A version kept in History: its stamp (the rule's) and source; its time is the change's.
    struct Version: Equatable { var stamp: String; var source: String }

    /// An add's answer. keep: the fields taken from the version before; history: indices into its History (-1 the
    /// version before itself, `version`); ran: which version runs while it waits. No version before: keep, history
    /// and version empty.
    struct Added: Equatable {
        var source: String
        var on: Bool
        var newOff: String?
        var keep: Set<String> = []
        var history: [Int] = []
        var version: Version?
        var ran: ModHolds.Kept?
    }

    /// Don't allow's and a restore's answer: the fields taken from the current version, what it asks beyond its code
    /// (nil: as read), the current version into History.
    struct Carry: Equatable {
        var keep: Set<String>
        var extraNeeds: [ModNeed]?
        var version: Version
        var history: [Int]
    }

    enum Rejected: Equatable { case remove, back(Carry) }

    /// A time as the rules read it (ms since 1970, whole).
    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded(.down) }

    /// The list after: indices into `list`, -1 → `new`.
    static func pick<T>(_ idx: [Int], from list: [T], new: T?) -> [T] {
        idx.compactMap { $0 < 0 ? new : list.indices.contains($0) ? list[$0] : nil }
    }

    static func record(_ f: ModHolds.Facts, on: Bool, newOff: String?, history: [Date]? = nil) -> [String: Any] {
        var o = f.plain
        o["on"] = on; o["newOff"] = newOff ?? NSNull()
        if let history { o["history"] = history.map { ["at": ms($0)] } }
        return o
    }

    /// Adding a mod (old: the version with its id, its History's times) or a new version of one. changed: the code
    /// differs (Swift compares: canonical equality, as before). No answer: off and marked, nothing dropped, nothing kept
    /// running.
    static func add(old: (facts: ModHolds.Facts, on: Bool, newOff: String?, history: [Date])?, new m: (facts: ModHolds.Facts, on: Bool, newOff: String?),
                    source: String, at date: Date, changed: Bool) -> Added {
        let o: Any = old.map { record($0.facts, on: $0.on, newOff: $0.newOff, history: $0.history) } ?? NSNull()
        let r = Core.shared.call("modStore.add", [o, record(m.facts, on: m.on, newOff: m.newOff), source, ms(date), changed]) as? [String: Any]
        guard let r, let on = r["on"] as? Bool else {
            guard let old else { return Added(source: source, on: false, newOff: source == "computer" ? "computer" : "import") }
            return Added(source: source, on: false, newOff: "update", keep: ["allowed", "offSites", "added"],
                         history: (changed ? [-1] : []) + Array(old.history.indices), version: changed ? Version(stamp: String(Int(ms(date))), source: source) : nil)
        }
        return Added(source: r["source"] as? String ?? source, on: on, newOff: r["newOff"] as? String, keep: Set(r["keep"] as? [String] ?? []),
                     history: r["history"] as? [Int] ?? [], version: version(r["version"]), ran: (r["ran"] as? String).flatMap(ModHolds.Kept.init))
    }

    /// A quick ask's Undo: the mods after (indices into ids, -1 the version before). No answer: as they are.
    static func undoAdd(ids: [String], id: String, hasBefore: Bool) -> [Int] {
        Core.shared.call("modStore.undoAdd", [ids, id, hasBefore]) as? [Int] ?? Array(ids.indices)
    }

    /// Deleting a mod: whether Undo offers it, and which of Recently deleted's entries stay after the new one. No
    /// answer: all of them.
    static func remove(trash: [Date], by: String, at date: Date) -> (undo: Bool, keep: [Int]) {
        guard let r = Core.shared.call("modStore.remove", [trash.map { ["at": ms($0)] }, by, ms(date)]) as? [String: Any],
              let u = r["undo"] as? Bool, let k = r["keep"] as? [Int] else { return (by == "you", Array(trash.indices)) }
        return (u, k)
    }

    /// Undo of a delete. nil: nothing to do (or no answer: nothing undone).
    static func undoDelete(last: String?, ids: [String], trash: [String]) -> (append: Bool, drop: Int)? {
        guard let r = Core.shared.call("modStore.undoDelete", [last ?? NSNull(), ids, trash]) as? [String: Any],
              let a = r["append"] as? Bool, let d = r["drop"] as? Int else { return nil }
        return (a, d)
    }

    /// Putting one back from Recently deleted. nil: not (no such entry, one with its id is here, or no answer).
    static func restoreDeleted(_ entry: String, trash: [(id: String, modId: String)], ids: [String], last: String?) -> (index: Int, clearLast: Bool)? {
        guard let r = Core.shared.call("modStore.restoreDeleted", [entry, trash.map { ["id": $0.id, "modId": $0.modId] }, ids, last ?? NSNull()]) as? [String: Any],
              let i = r["index"] as? Int, let c = r["clearLast"] as? Bool else { return nil }
        return (i, c)
    }

    /// Don't allow. nil: no answer (nothing changes: it stays held).
    static func reject(ran: Bool, history: Int, at date: Date) -> Rejected? {
        let r = Core.shared.call("modStore.reject", [["ran": ran, "history": Array(repeating: [String: Any](), count: history)], ms(date)])
        if r is NSNull { return .remove }
        return carry(r).map(Rejected.back)
    }

    /// A restore's carry-over (source: restore or undo). nil: no answer (not restored).
    static func restore(history: Int, source: String, at date: Date) -> Carry? {
        carry(Core.shared.call("modStore.restore", [["history": Array(repeating: [String: Any](), count: history)], source, ms(date)]))
    }

    private static func carry(_ v: Any?) -> Carry? {
        guard let r = v as? [String: Any], let k = r["keep"] as? [String], let ver = version(r["version"]), let h = r["history"] as? [Int] else { return nil }
        return Carry(keep: Set(k), extraNeeds: (r["extraNeeds"] as? [[String: Any]])?.compactMap(ModHolds.need), version: ver, history: h)
    }

    private static func version(_ v: Any?) -> Version? {
        guard let o = v as? [String: Any], let s = o["stamp"] as? String, let src = o["source"] as? String else { return nil }
        return Version(stamp: s, source: src)
    }
}
