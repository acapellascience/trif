import Foundation

// Mods a chat offers (Add this mod?), and which it may not (Tim, 11-17, his iPhone SE: "spurious asks to add old code
// when I open Claude chat"). The chat page's script hands over code it takes for a new reply's; a long conversation's
// older messages render late, and the page is often loaded again, so old code came over as new, and the app skipped
// only a mod installed with the very same code. Now, whatever the page says: the same code is never offered from a
// chat twice (remembered across launches, by a hash of the code with its line ends and trailing spaces evened out,
// with what came of it), nor code that is an installed mod's current or earlier version (its History), nor a mod's
// in Recently deleted. A new version of a mod is still offered. The Add to TRIF button under a block is the person's
// own tap and isn't held to this (Browser.offer(text:)).
//
// The rules are the phones' shared rule, mobile/shared/core/chat-offers.js (Android runs the same); storage stays
// here. No UI and Foundation only: built for the Mac too, by mobile/test/chatoffers.test.js.

/// Every code offered from a chat, newest last, at most `limit`: its key and what came of it.
final class ChatOfferMemory {
    enum Outcome: String, Codable { case offered, added, declined, dismissed }
    struct Entry: Codable, Equatable { var key: String; var outcome: Outcome; var at: Date }
    static let limit = 500
    private(set) var entries: [Entry]
    private let store: ([Entry]) -> Void

    init(entries: [Entry] = [], store: @escaping ([Entry]) -> Void = { _ in }) {
        self.entries = Array(entries.suffix(ChatOfferMemory.limit))
        self.store = store
    }

    /// The app's: in UserDefaults ("chatOffers").
    static func standard(_ defaults: UserDefaults = .standard) -> ChatOfferMemory {
        let key = "chatOffers"
        let kept = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode([Entry].self, from: $0) } ?? []
        return ChatOfferMemory(entries: kept) { list in if let d = try? JSONEncoder().encode(list) { defaults.set(d, forKey: key) } }
    }

    /// The rules are the phones' shared rule (mobile/shared/core/chat-offers.js, through Core.swift): the memory's
    /// entries as it takes them (at: seconds since 1970).
    private static func plain(_ e: [Entry]) -> [[String: Any]] { e.map { ["key": $0.key, "outcome": $0.outcome.rawValue, "at": $0.at.timeIntervalSince1970] } }

    /// The code as compared: line ends as \n, no trailing spaces on a line (non-breaking ones as spaces), no blank
    /// lines at either end. (A page's innerText, a viewer's lines and the stored file differ only in those.)
    static func normalise(_ code: String) -> String { (Core.shared.call("chatOffers.normalise", [code]) as? String) ?? code }

    /// FNV-1a 64 of the normalised code, and its length ("" if the shared rule didn't answer).
    static func key(_ code: String) -> String { keys([code])?.first ?? "" }

    /// Codes' keys, remembered while the app runs (a code's key never changes: a hand-over hashes only new code; the
    /// judge takes every installed mod's versions). nil if the shared rule didn't answer. (Remembered by NSString, which
    /// compares literally: Swift's String calls "café" and "cafe\u{301}" equal, their keys differ.)
    static func keys(_ codes: [String]) -> [String]? {
        keyLock.lock(); defer { keyLock.unlock() }
        let ns = codes.map { $0 as NSString }
        var missing: [NSString] = [], seen = Set<NSString>()
        for c in ns where keyCache[c] == nil && seen.insert(c).inserted { missing.append(c) }
        if !missing.isEmpty {
            guard let got = Core.shared.call("chatOffers.keys", [missing]) as? [String], got.count == missing.count else { return nil }
            if keyCache.count + missing.count > 2000 { keyCache.removeAll() }
            for (c, k) in zip(missing, got) { keyCache[c] = k }
        }
        var out: [String] = []
        for c in ns { guard let k = keyCache[c] else { return nil }; out.append(k) }
        return out
    }
    private static let keyLock = NSLock()
    /// Works out the keys ahead (off the main thread, a few at a time, so a call meanwhile waits little): the app's
    /// installed and deleted versions at launch, so a reply's first hand-over doesn't hash them all.
    static func warm(_ codes: [String]) {
        let codes = Array(codes.prefix(1500))
        for i in stride(from: 0, to: codes.count, by: 16) { _ = keys(Array(codes[i..<min(i + 16, codes.count)])) }
    }
    nonisolated(unsafe) private static var keyCache: [NSString: String] = [:]

    func outcome(_ code: String) -> Outcome? {
        (Core.shared.call("chatOffers.outcome", [ChatOfferMemory.plain(entries), code]) as? String).flatMap(Outcome.init(rawValue:))
    }

    /// Offered: remembered (newest last). Added, declined, dismissed: what came of a code offered, if it was (dismissed
    /// only over offered: Cancel says declined first). (Nothing changes if the shared rule didn't answer.)
    func note(_ code: String, _ o: Outcome, at: Date = Date()) {
        guard let list = Core.shared.call("chatOffers.note", [ChatOfferMemory.plain(entries), code, o.rawValue, at.timeIntervalSince1970]) as? [[String: Any]] else { return }
        entries = list.compactMap { e in
            guard let k = e["key"] as? String, let o = (e["outcome"] as? String).flatMap(Outcome.init(rawValue:)), let t = e["at"] as? NSNumber else { return nil }
            return Entry(key: k, outcome: o, at: Date(timeIntervalSince1970: t.doubleValue))
        }
        store(entries)
    }
}

/// Whether a chat's mod is offered: why not, or nil.
enum ChatOfferJudge {
    struct Known {
        var id: String
        var code: String
        var history: [String] = []
    }

    /// (The shared rule; if it didn't answer, not offered: a chat's offer is never a must.)
    static func skip(id: String, code: String, installed: [Known], deleted: [Known], queued: [Known], memory: ChatOfferMemory) -> String? {
        let all = installed + deleted + queued
        guard let ks = ChatOfferMemory.keys([code] + all.flatMap { [$0.code] + $0.history }) else { return "the shared rule didn't answer" }
        var i = 1
        let known = { (list: [Known]) -> [[String: Any]] in
            list.map { m in
                let k = ks[i], h = Array(ks[(i + 1)..<(i + 1 + m.history.count)])
                i += 1 + m.history.count
                return ["id": m.id, "key": k, "history": h]
            }
        }
        let a: [String: Any] = ["key": ks[0], "installed": known(installed), "deleted": known(deleted), "queued": known(queued),
                                "entries": memory.entries.map { ["key": $0.key, "outcome": $0.outcome.rawValue] }]
        switch Core.shared.call("chatOffers.skip", [a]) {
        case let why as String: return why
        case is NSNull: return nil
        default: return "the shared rule didn't answer"
        }
    }
}
