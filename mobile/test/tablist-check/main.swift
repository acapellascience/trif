import Foundation

// TabListRules.swift (the tab list's card it opens at and its robot badges: the phones' shared rule
// mobile/shared/gen/core.js, TrifCore.tabList, called through Core.swift; `marked` a Swift twin), built for the Mac by
// tablist.test.js. argv: tab-list-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
func uuid(_ a: Any?) -> UUID? { (a as? String).flatMap(UUID.init(uuidString:)) }
func tabs(_ a: Any?) -> [TabListRules.TabFacts] { (a as! [[String: Any]]).map { .init(id: uuid($0["id"])!, host: $0["host"] as! String) } }
func link(_ a: Any?) -> TabListRules.LinkFacts? {
    guard let l = a as? [String: Any] else { return nil }
    return .init(site: l["site"] as! String, tab: uuid(l["tab"]), state: l["state"] as! String)
}
var n = 0
for c in cases["focus"] as? [[Any]] ?? [] {
    n += 1
    let f = c[0] as! [String: Any]
    let got = TabListRules.focus(open: f["open"] as! Bool, more: f["more"] as! Bool, link: link(f["link"]), chat: f["chat"] as? String,
                                 tabs: tabs(f["tabs"]), current: uuid(f["current"])!)
    check(got == uuid(c[1]), "focus \(f): \(String(describing: got)), want \(c[1])")
}
for c in cases["marked"] as? [[Any]] ?? [] {
    n += 1
    let f = c[0] as! [String: Any]
    let got = TabListRules.marked(focus: uuid(f["focus"]), tabs: (f["tabs"] as! [String]).map { UUID(uuidString: $0)! }, current: uuid(f["current"])!)
    check(got == uuid(c[1]), "marked \(f): \(got), want \(c[1])")
}
for c in cases["badges"] as? [[Any]] ?? [] {
    n += 1
    let f = c[0] as! [String: Any]
    let got = TabListRules.badges(links: (f["links"] as! [Any]).compactMap(link), tabs: tabs(f["tabs"]))
    let want = Dictionary(uniqueKeysWithValues: (c[1] as! [String: String]).map { (UUID(uuidString: $0.key)!, $0.value) })
    check(got == want, "badges \(f): \(got), want \(want)")
}
check(n > 800, "only \(n) cases")

// cost: a tap on the tabs button (focus) and the list drawn (badges, 20 tabs, 6 chats)
let many = (0..<20).map { TabListRules.TabFacts(id: UUID(), host: ["x.com", "m.facebook.com", "news.bbc.co.uk", "claude.ai"][$0 % 4]) }
let chats = (0..<6).map { TabListRules.LinkFacts(site: ["x.com", "facebook.com", "bbc.co.uk"][$0 % 3], tab: many[$0 * 3].id, state: ["working", "waiting", "read"][$0 % 3]) }
_ = TabListRules.badges(links: chats, tabs: many)
let t0 = Date()
for _ in 0..<200 {
    _ = TabListRules.focus(open: true, more: false, link: chats[1], chat: nil, tabs: many, current: many[5].id)
    _ = TabListRules.badges(links: chats, tabs: many)
}
let us = Date().timeIntervalSince(t0) / 200 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("tab list opened: \(Int(us)) µs") }
check(us < 5000, "the tab list opened costs \(Int(us)) µs")

print(failures.isEmpty ? "tab list: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
