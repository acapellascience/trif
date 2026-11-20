// A reply picked up after TRIF wasn't running (Tim, 11-20: "is there a way to automatically pick up the fact that
// there's a new mod when the app restarts?"). At the person's own Send in a Claude or ChatGPT page, a small note is
// kept on disk: which chat, its conversation (once it has an address), the tab sent from, when, and a fingerprint of
// the message sent. It goes when TRIF sees that reply end. A note still there when TRIF starts again (the app was
// ended mid-reply), or when it comes back after its background time ran out, means the reply was never seen ending:
// its conversation is loaded again behind the tab and the reply after that message is read as if it had been seen
// arriving (ClaudePane.pickUp, chat.js resume with the note). Notes older than an hour are dropped.
// No UI and nothing of UIKit: built for the Mac too (mobile/test/sentnotes.test.js).

import Foundation

/// One send TRIF saw, whose reply it hasn't seen end yet.
struct SentNote: Codable, Equatable {
    /// "Claude" or "ChatGPT" (ChatService's raw value).
    var service: String
    /// The site the chat is for.
    var site: String
    /// The conversation's address as kept (no query or fragment); nil until a new chat has one.
    var conv: String?
    /// The tab sent from (Tab.id), for the notification's tap.
    var tab: String?
    /// When the person sent.
    var at: Date
    /// How many of the person's messages the page showed before this one (for the log; a long conversation may not
    /// draw them all, so it doesn't find the message).
    var users: Int
    /// chat.js's fingerprint of the message's last words (sentPrint): how the message is found again.
    var print: String?
    /// A quick ask's request (its pill comes back after a relaunch, and its look-only mods are added as it would have).
    var quick: String?
    /// The chat's key, as ClaudePane.linkKey makes it: one note per service and site.
    var key: String { "\(service)|\(site)" }
}

/// The notes, kept in Application Support/chat-sent.json (written at every change; a few hundred bytes).
final class SentNotes {
    /// Older than this, a note is dropped: a reply that old isn't waited for (the chat page would load for nothing).
    static let maxAge: TimeInterval = 3600
    let file: URL
    private(set) var all: [SentNote] = []

    init(file: URL) {
        self.file = file
        if let d = try? Data(contentsOf: file) {
            let dec = JSONDecoder()
            dec.dateDecodingStrategy = .secondsSince1970
            all = (try? dec.decode([SentNote].self, from: d)) ?? []
        }
    }
    /// The app's own file.
    static var appFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("chat-sent.json")
    }

    func note(for key: String) -> SentNote? { all.first { $0.key == key } }

    /// A send: its note, in place of the chat's earlier one (one reply waited for per chat).
    func put(_ n: SentNote) {
        all.removeAll { $0.key == n.key }
        all.insert(n, at: 0)
        save()
    }
    /// The reply seen ending (or the note dropped): gone. True if there was one.
    @discardableResult
    func clear(_ key: String) -> Bool {
        let had = all.count
        all.removeAll { $0.key == key }
        guard all.count != had else { return false }
        save()
        return true
    }
    /// The chat's conversation seen at an address: kept in its note when the note has none yet, or only a provisional
    /// one (chatgpt.com's /c/local-chatgpt:…) and this is its own. Another conversation never replaces the note's.
    func follow(_ key: String, conv: String) {
        guard let i = all.firstIndex(where: { $0.key == key }) else { return }
        let was = all[i].conv
        guard was != conv, was == nil || (SentNotes.provisional(was) && !SentNotes.provisional(conv)) else { return }
        all[i].conv = conv
        save()
    }
    /// The notes to pick up now, newest first; those older than `maxAge` (or from the future: a clock put back) are
    /// taken out and returned as `old`.
    func due(now: Date = Date()) -> (due: [SentNote], old: [SentNote]) {
        let old = all.filter { now.timeIntervalSince($0.at) > SentNotes.maxAge || $0.at.timeIntervalSince(now) > 300 }
        if !old.isEmpty {
            all.removeAll { o in old.contains(o) }
            save()
        }
        return (all.sorted { $0.at > $1.at }, old)
    }

    private func save() {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .secondsSince1970
        if all.isEmpty { try? FileManager.default.removeItem(at: file); return }
        if let d = try? enc.encode(all) { try? d.write(to: file, options: .atomic) }
    }

    /// A new conversation's provisional address (chatgpt.com signed in, 11-20: /c/local-chatgpt:<uuid>, "%3A" in the
    /// address, until the server gives it its own /c/<id>): the same conversation as the address that replaces it,
    /// and not one a page can be loaded at again.
    static func provisional(_ conv: String?) -> Bool {
        guard let conv, let u = URL(string: conv) else { return false }
        // (in a ChatGPT project too: /g/g-p-<id>-<name>/c/local-…)
        return u.path.range(of: "^(/g/g-p-[^/]+)?/c/local[-:]", options: .regularExpression) != nil
    }
}
