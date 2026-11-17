import Foundation

// ChatOffers.swift on the Mac (mobile/test/chatoffers.test.js): what a chat may offer. Prints "chat offers: ok" or
// the first thing wrong, and exits 1 then.

func fail(_ s: String) -> Never { print("FAIL: \(s)"); exit(1) }
func check(_ ok: Bool, _ s: String) { if !ok { fail(s) } }

let v1 = "// ==WebMod==\n// @name Calmer feed\n// @match http://localhost/*\n// @style\n// ==/WebMod==\n{ \"css\": \"h2 { color: #b22222 }\" }"
let v2 = v1.replacingOccurrences(of: "#b22222", with: "#1f8a5b")
let v3 = v1.replacingOccurrences(of: "#b22222", with: "#123456")
let other = v1.replacingOccurrences(of: "Calmer feed", with: "No cookie box")

// (the same code as a page shows it: CRLF, trailing and non-breaking spaces, blank lines around)
let shown = "\n" + v1.replacingOccurrences(of: "\n", with: " \r\n").replacingOccurrences(of: "{ \"css\"", with: "{\u{00A0}\"css\"") + "\n\n"
check(ChatOfferMemory.key(shown) == ChatOfferMemory.key(v1), "normalised code has the same key")
check(ChatOfferMemory.key(v1) != ChatOfferMemory.key(v2), "a changed version has another key")

let defaults = UserDefaults(suiteName: "trif.chatoffers.check.\(getpid())")!
defer { defaults.removePersistentDomain(forName: "trif.chatoffers.check.\(getpid())") }
var mem = ChatOfferMemory.standard(defaults)
typealias K = ChatOfferJudge.Known
let id = "localhost/calmer-feed"
func judge(_ code: String, installed: [K] = [], deleted: [K] = [], queued: [K] = []) -> String? {
    ChatOfferJudge.skip(id: id, code: code, installed: installed, deleted: deleted, queued: queued, memory: mem)
}

// a first offer: offered; then declined; then the same code from the chat again (another launch): skipped
check(judge(v1) == nil, "a new mod is offered")
mem.note(v1, .offered)
mem.note(v1, .declined)
mem.note(v1, .dismissed) // (the sheet closing after Cancel: stays declined)
mem = ChatOfferMemory.standard(defaults) // (a new launch)
check(mem.outcome(v1) == .declined, "declined, remembered across launches (\(String(describing: mem.outcome(v1))))")
check(judge(shown)?.contains("offered from a chat before (declined)") == true, "declined code isn't offered again: \(judge(shown) ?? "nil")")

// dismissed (swiped away)
mem.note(other, .offered); mem.note(other, .dismissed)
check(mem.outcome(other) == .dismissed, "dismissed")
check(judge(other) != nil, "dismissed code isn't offered again")

// added, then changed by the person: the chat's old code (its history) isn't offered; a new version is
mem.note(v2, .offered); mem.note(v2, .added)
let installed = [K(id: id, code: v3, history: [v1, v2])]
let fresh = ChatOfferMemory(entries: []) // (a phone that never offered them: the history alone)
func judgeFresh(_ code: String, installed: [K] = [], deleted: [K] = [], queued: [K] = []) -> String? {
    ChatOfferJudge.skip(id: id, code: code, installed: installed, deleted: deleted, queued: queued, memory: fresh)
}
check(judgeFresh(v3, installed: installed) == "installed as it is", "the installed code: \(judgeFresh(v3, installed: installed) ?? "nil")")
check(judgeFresh(v2, installed: installed) == "an earlier version of \(id)", "history: \(judgeFresh(v2, installed: installed) ?? "nil")")
check(judgeFresh(v1, installed: installed) != nil, "an older version in history")
let v4 = v1.replacingOccurrences(of: "#b22222", with: "#abcdef")
check(judgeFresh(v4, installed: installed) == nil, "a genuinely new version is still offered")
check(judge(v4, installed: installed) == nil, "a genuinely new version is still offered, with the memory")

// Recently deleted: its code and its history
let deleted = [K(id: id, code: v3, history: [v2])]
check(judgeFresh(v3, deleted: deleted) == "in Recently deleted", "deleted")
check(judgeFresh(v2, deleted: deleted) == "in Recently deleted", "deleted's history")
check(judgeFresh(v4, deleted: deleted) == nil, "new after a delete: offered")

// waiting already
check(judgeFresh(v4, queued: [K(id: id, code: v4)]) == "waiting to be offered", "queued")

// bounded: the oldest goes past the limit
let small = ChatOfferMemory()
for i in 0..<(ChatOfferMemory.limit + 20) { small.note("code \(i)", .offered) }
check(small.entries.count == ChatOfferMemory.limit, "at most \(ChatOfferMemory.limit): \(small.entries.count)")
check(small.outcome("code 0") == nil && small.outcome("code \(ChatOfferMemory.limit + 19)") == .offered, "the oldest forgotten")
// (offered again moves it to the newest)
small.note("code 30", .offered)
check(small.entries.last?.key == ChatOfferMemory.key("code 30") && small.entries.count == ChatOfferMemory.limit, "re-noted moves to the end, once")
// (added for code never offered from a chat: not remembered)
small.note("pasted", .added)
check(small.outcome("pasted") == nil, "a paste's add isn't a chat offer")

print("chat offers: ok")
