import Foundation

// ChatOffers.swift on the Mac (mobile/test/chatoffers.test.js): what a chat may offer. Its rules are the phones'
// shared rule (mobile/shared/gen/core.js, argv[2]), called through Core.swift, held to the answers ChatOffers.swift
// gave before the move (mobile/shared/core/chat-offers-cases.json, argv[1]). Prints "chat offers: ok" or the first
// thing wrong, and exits 1 then.

func fail(_ s: String) -> Never { print("FAIL: \(s)"); exit(1) }
func check(_ ok: Bool, _ s: String) { if !ok { fail(s) } }
guard CommandLine.arguments.count > 2 else { fail("usage: check <chat-offers-cases.json> <core.js>") }
Core.source = URL(fileURLWithPath: CommandLine.arguments[2])
Core.report = { fail("Core: " + $0) }

// the cases (the Swift's own answers before the move)
let cases = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
check(cases["limit"] as? Int == ChatOfferMemory.limit, "limit")
for c in cases["key"] as! [[String]] {
    check(ChatOfferMemory.normalise(c[0]) == c[1], "normalise \(c[0].debugDescription.prefix(60))")
    check(ChatOfferMemory.key(c[0]) == c[2], "key \(c[0].debugDescription.prefix(60)): \(ChatOfferMemory.key(c[0])) not \(c[2])")
}
func plain(_ m: ChatOfferMemory) -> [[String: String]] { m.entries.map { ["key": $0.key, "outcome": $0.outcome.rawValue, "at": "\($0.at.timeIntervalSince1970)"] } }
func plain(_ e: Any?) -> [[String: String]] { (e as! [[String: Any]]).map { ["key": $0["key"] as! String, "outcome": $0["outcome"] as! String, "at": "\(Double(($0["at"] as! NSNumber).doubleValue))"] } }
func memory(_ e: Any?) -> ChatOfferMemory {
    ChatOfferMemory(entries: (e as! [[String: Any]]).map { .init(key: $0["key"] as! String, outcome: .init(rawValue: $0["outcome"] as! String)!, at: Date(timeIntervalSince1970: ($0["at"] as! NSNumber).doubleValue)) })
}
for n in cases["note"] as! [[String: Any]] {
    let m = ChatOfferMemory()
    let steps = n["steps"] as! [[Any]]
    for st in steps { m.note(st[0] as! String, .init(rawValue: st[1] as! String)!, at: Date(timeIntervalSince1970: (st[2] as! NSNumber).doubleValue)) }
    check(plain(m) == plain(n["entries"]), "note \(steps): \(plain(m))")
    let want = (n["outcomes"] as! [Any]).map { $0 as? String }
    check(["a", "b", "pasted"].map { m.outcome($0)?.rawValue } == want, "outcomes \(steps)")
}
do {
    let big = ChatOfferMemory()
    for i in 0..<520 { big.note("code \(i)", .offered, at: Date(timeIntervalSince1970: Double(i))) }
    big.note("code 30", .offered, at: Date(timeIntervalSince1970: 1000))
    let l = cases["noteLimit"] as! [String: Any]
    check(big.entries.count == l["count"] as? Int && big.entries.first?.key == l["first"] as? String && big.entries.last?.key == l["last"] as? String
          && big.outcome("code 0")?.rawValue == l["code 0"] as? String && big.outcome("code 519")?.rawValue == l["code 519"] as? String, "the limit")
}
func knowns(_ a: Any?) -> [ChatOfferJudge.Known] { (a as! [[String: Any]]).map { .init(id: $0["id"] as! String, code: $0["code"] as! String, history: $0["history"] as! [String]) } }
for s in cases["skip"] as! [[String: Any]] {
    let got = ChatOfferJudge.skip(id: "localhost/calmer-feed", code: s["code"] as! String, installed: knowns(s["installed"]), deleted: knowns(s["deleted"]),
                                  queued: knowns(s["queued"]), memory: memory(s["entries"]))
    check(got == s["want"] as? String, "skip \((s["code"] as! String).prefix(40).debugDescription): \(got ?? "nil") not \(s["want"] ?? "nil")")
}

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

// a hand-over's cost: one judge call with 40 installed mods of 3 KB, each with 10 versions, 10 in Recently deleted, 500
// remembered (the worst a phone keeps), and a note
do {
    let body = String(repeating: "div.feed > article:nth-child(2n) { display: none !important }\n", count: 50)
    func mod(_ i: Int) -> ChatOfferJudge.Known { .init(id: "site\(i).com/mod", code: "// \(i)\n" + body, history: (0..<10).map { "// \(i).\($0)\n" + body }) }
    let inst = (0..<40).map(mod), del = (40..<50).map(mod)
    let mem = ChatOfferMemory()
    for i in 0..<ChatOfferMemory.limit { mem.note("remembered \(i)", .offered) }
    var t = Date()
    ChatOfferMemory.warm((inst + del).flatMap { [$0.code] + $0.history })
    let warmMs = Date().timeIntervalSince(t) * 1e3
    let batch = Date()
    _ = ChatOfferMemory.keys((0..<16).map { "// batch \($0)\n" + body })
    let batchMs = Date().timeIntervalSince(batch) * 1e3
    t = Date()
    check(ChatOfferJudge.skip(id: "x", code: "// first\n" + body, installed: inst, deleted: del, queued: [], memory: mem) == nil, "a new one offered")
    let firstMs = Date().timeIntervalSince(t) * 1e3
    let n = 20
    t = Date()
    for i in 0..<n { check(ChatOfferJudge.skip(id: "x", code: "// new \(i)\n" + body, installed: inst, deleted: del, queued: [], memory: mem) == nil, "a new one offered") }
    let skipMs = Date().timeIntervalSince(t) / Double(n) * 1e3
    t = Date()
    for i in 0..<n { mem.note("new \(i)", .offered) }
    let noteMs = Date().timeIntervalSince(t) / Double(n) * 1e3
    FileHandle.standardError.write("chat offers through core.js: skip (40 mods × 11 versions of 3 KB, 500 remembered) warmed ahead \(String(format: "%.0f", warmMs)) ms (off the main thread; a 16-code batch \(String(format: "%.1f", batchMs)) ms), first \(String(format: "%.1f", firstMs)) ms, then \(String(format: "%.1f", skipMs)) ms, note \(String(format: "%.2f", noteMs)) ms a call\n".data(using: .utf8)!)
    check(firstMs < 50 && skipMs < 50 && batchMs < 50 && noteMs < 20, "warmed, a hand-over's judge costs under 50 ms, a warming batch under 50 ms, a note under 20 ms")
}

print("chat offers: ok")
