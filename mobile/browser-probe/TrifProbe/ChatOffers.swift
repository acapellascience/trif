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
// No UI and Foundation only: built for the Mac too, by mobile/test/chatoffers.test.js.

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

    /// The code as compared: line ends as \n, no trailing spaces on a line (non-breaking ones as spaces), no blank
    /// lines at either end. (A page's innerText, a viewer's lines and the stored file differ only in those.)
    static func normalise(_ code: String) -> String {
        let lines = code.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{00A0}", with: " ")
            .components(separatedBy: "\n")
            .map { l -> String in var s = Substring(l); while let c = s.last, c == " " || c == "\t" { s = s.dropLast() }; return String(s) }
        var a = lines.startIndex, z = lines.endIndex
        while a < z, lines[a].isEmpty { a += 1 }
        while z > a, lines[z - 1].isEmpty { z -= 1 }
        return lines[a..<z].joined(separator: "\n")
    }

    /// FNV-1a 64 of the normalised code, and its length.
    static func key(_ code: String) -> String {
        let n = normalise(code)
        var h: UInt64 = 0xcbf29ce484222325
        for b in n.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return String(h, radix: 16) + ":" + String(n.utf8.count)
    }

    func outcome(_ code: String) -> Outcome? {
        let k = ChatOfferMemory.key(code)
        return entries.last(where: { $0.key == k })?.outcome
    }

    /// Offered: remembered (newest last). Added, declined, dismissed: what came of a code offered, if it was (dismissed
    /// only over offered: Cancel says declined first).
    func note(_ code: String, _ o: Outcome, at: Date = Date()) {
        let k = ChatOfferMemory.key(code)
        let i = entries.lastIndex(where: { $0.key == k })
        switch o {
        case .offered:
            if let i { entries.remove(at: i) }
            entries.append(Entry(key: k, outcome: .offered, at: at))
            if entries.count > ChatOfferMemory.limit { entries.removeFirst(entries.count - ChatOfferMemory.limit) }
        case .dismissed:
            guard let i, entries[i].outcome == .offered else { return }
            entries[i].outcome = .dismissed
        case .added, .declined:
            guard let i else { return }
            entries[i].outcome = o
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

    static func skip(id: String, code: String, installed: [Known], deleted: [Known], queued: [Known], memory: ChatOfferMemory) -> String? {
        let k = ChatOfferMemory.key(code)
        let same = { (c: String) in ChatOfferMemory.key(c) == k }
        if installed.contains(where: { same($0.code) }) { return "installed as it is" }
        if queued.contains(where: { same($0.code) }) { return "waiting to be offered" }
        if let o = memory.outcome(code) { return "offered from a chat before (\(o.rawValue))" }
        if let m = installed.first(where: { $0.history.contains(where: same) }) { return "an earlier version of \(m.id)" }
        if deleted.contains(where: { same($0.code) || $0.history.contains(where: same) }) { return "in Recently deleted" }
        return nil
    }
}
