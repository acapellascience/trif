import Foundation

// Site.swift (the twin of mobile/shared/core/site.js) and QuickAskRules.swift (quick ask's rules: the phones' shared rule
// mobile/shared/gen/core.js, TrifCore.quickAsk, called through Core.swift), built for the Mac by quickask.test.js.
// argv: site-cases.json, quick-ask-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 3 { Core.source = URL(fileURLWithPath: args[3]) } else { failures.append("no core.js (argv[3])") }
Core.report = { failures.append("Core: " + $0) }
func json(_ i: Int) -> [String: Any] {
    guard args.count > i, let d = FileManager.default.contents(atPath: args[i]), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { failures.append("no cases (argv[\(i)])"); return [:] }
    return o
}
func facts(_ o: [String: Any]) -> QuickAskRules.Facts {
    QuickAskRules.Facts(id: o["id"] as? String ?? "", tier: o["tier"] as! String, powers: o["powers"] as! [String], held: o["held"] as! Bool,
                        warnings: o["warnings"] as! [String], everywhere: o["everywhere"] as! Bool, sites: o["sites"] as! [String])
}

// the twin: Site.of / host(isIn:) / a chat's site
let site = json(1), quick = json(2)
var n = 0
for c in site["of"] as? [[String]] ?? [] { n += 1; check(Site.of(c[0]) == c[1], "Site.of \(c[0]): \(Site.of(c[0])), want \(c[1])") }
for c in site["hostIsIn"] as? [[Any]] ?? [] { n += 1; let (h, s, w) = (c[0] as! String, c[1] as! String, c[2] as! Bool); check(Site.host(h, isIn: s) == w, "host \(h) in \(s)") }
for c in site["chat"] as? [[String]] ?? [] { n += 1; let got = QuickAskRules.sort([], chatSite: c[0]).site; check(got == c[1], "chat site \(c[0]): \(got), want \(c[1])") }

// the rule
for c in quick["lookOnly"] as? [[Any]] ?? [] {
    n += 1
    let m = c[0] as! [String: Any]
    check(QuickAskRules.lookOnly(facts(m), site: c[1] as! String) == (c[2] as! Bool), "lookOnly \(m["name"]!) on \(c[1])")
}
for c in quick["sort"] as? [[Any]] ?? [] {
    n += 1
    let o = c[0] as! [String: Any], w = c[2] as! [String: Any]
    let got = QuickAskRules.sort((o["offered"] as! [[String: Any]]).map(facts), chatSite: c[1] as! String)
    let want = QuickAskRules.Sorted(site: w["site"] as! String, look: w["look"] as! [String], rest: w["rest"] as! [String], state: w["state"] as! String)
    check(got == want, "sort \(o["name"]!) on \(c[1]): \(got)")
}
for c in quick["undo"] as? [[Any]] ?? [] {
    n += 1
    let ap = (c[1] as! [[String: Any]]).map { (id: $0["id"] as! String, hadBefore: $0["hadBefore"] as! Bool) }
    let got = QuickAskRules.undo(state: c[0] as! String, applied: ap).map { "\($0.id):\($0.back ? "before" : "remove")" }
    let want = (c[2] as! [[String: Any]]).map { "\($0["id"] as! String):\($0["to"] as! String)" }
    check(got == want, "undo \(c[0]) \(ap): \(got)")
}
check(n > 150, "only \(n) cases")

// cost: a reply's sort (3 mods) through the shared rule
let three = (0..<3).map { QuickAskRules.Facts(id: "m\($0)", tier: "style", powers: [], held: false, warnings: [], everywhere: false, sites: ["x.com"]) }
_ = QuickAskRules.sort(three, chatSite: "x.com")
let t0 = Date()
for _ in 0..<200 { _ = QuickAskRules.sort(three, chatSite: "phone~m.x.com") }
let us = Date().timeIntervalSince(t0) / 200 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("sort: \(Int(us)) µs a call") }
check(us < 5000, "sort costs \(Int(us)) µs")

print(failures.isEmpty ? "quick ask: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
