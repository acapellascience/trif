import Foundation

// ModRuns.swift (what runs: switches, tiers off, Pause all, MatchPattern; the twins and the switches' call-through to
// the phones' shared rule mobile/shared/gen/core.js, TrifCore.modStore / TrifCore.match, by Core.swift), with
// ModHolds.swift and Site.swift, built for the Mac by modruns.test.js. argv: mod-runs-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
func needs(_ v: Any?) -> [ModNeed] { (v as! [[String: Any]]).map { ModHolds.need($0)! } }
func facts(_ o: [String: Any]) -> ModRuns.Facts {
    .init(hold: .init(tier: o["tier"] as! String, site: o["site"] as! String, matches: o["matches"] as! [String], needs: needs(o["needs"]),
                      extraNeeds: needs(o["extraNeeds"]), allowed: (o["allowed"] as! [String: Any]).mapValues { $0 as! [String] }, ran: o["ran"] as! Bool),
          on: o["on"] as! Bool, sites: o["sites"] as! [String], offSites: o["offSites"] as! [String], excludes: o["excludes"] as! [String])
}
let R = (cases["mods"] as! [[String: Any]]).map(facts)
func groups(_ v: Any) -> [String: [String]] { (v as! [String: Any]).mapValues { $0 as! [String] } }
func partsPlain(_ u: String) -> Any { URL(string: u).map { MatchPattern.parts($0).plain } ?? NSNull() }
func same(_ a: Any, _ b: Any) -> Bool { (a as AnyObject).isEqual(b) }
var n = 0

// @match: the twin, and the parts it reads
let match = cases["match"] as! [String: Any]
let patterns = match["patterns"] as! [String], one = match["one"] as! [String]
for (u, pair) in (match["urls"] as! [[Any]]).enumerated() {
    let url = pair[0] as! String
    check(same(partsPlain(url), pair[1]), "parts \(url): \(partsPlain(url)) \(pair[1])")
    let bits = Array(one[u])
    for (i, p) in patterns.enumerated() {
        n += 1
        let got = URL(string: url).map { MatchPattern.one(p, MatchPattern.parts($0)) } ?? false
        check(got == (bits[i] == "1"), "one \(p) \(url): \(got)")
    }
}
// isOn, off: the twins
let isOnSites = (cases["isOnSites"] as! [Any]).map { $0 as? String }
for c in cases["isOn"] as! [[Any]] {
    n += 1
    let m = R[c[0] as! Int], a = c[1] as! [Bool]
    for (i, s) in isOnSites.enumerated() { check(ModRuns.isOn(m, site: s) == a[i], "isOn \(c[0]) \(s ?? "nil")") }
}
let choices = (cases["groupsChoices"] as! [Any]).map(groups)
for c in cases["off"] as! [[Any]] {
    n += 1
    let m = R[c[0] as! Int], a = c[1] as! [[String]]
    for (i, g) in choices.enumerated() { check(ModRuns.off(m, groupsOff: g) == a[i], "off \(c[0]) \(i)") }
}
// running: the twin, and the shared rule through JavaScriptCore
let runUrls = (cases["runUrls"] as! [[Any]]).map { $0[0] as! String }
for c in cases["running"] as! [[Any]] {
    n += 1
    let list = (c[0] as! [Int]).map { R[$0] }, g = groups(c[1]), p = c[2] as! Bool, a = c[3] as! [[[Any]]]
    for (i, u) in runUrls.enumerated() {
        let want = a[i].map { [$0[0] as! Int, ($0[1] as! Bool) ? 1 : 0] }
        let twin = ModRuns.running(list, paused: p, groupsOff: g, url: u).map { [$0.i, $0.kept ? 1 : 0] }
        check(twin == want, "running (twin) \(c[0]) \(u): \(twin) \(want)")
        let js = (Core.shared.call("modStore.running", [list.map(\.plain), ["paused": p, "groupsOff": g, "url": partsPlain(u)]]) as? [[Any]])?
            .map { [($0[0] as! NSNumber).intValue, ($0[1] as! Bool) ? 1 : 0] }
        check(js == want, "running (shared) \(c[0]) \(u): \(String(describing: js))")
    }
}
// the switches, through the shared rule
for c in cases["setOn"] as! [[Any]] {
    n += 1
    let r = c[0] as! Int, to = c[1] as! Bool, s = c[2] as? String, a = c[3] as! [String: Any]
    guard let got = ModRuns.setOn(R[r], to, site: s) else { check(false, "setOn \(r): no answer"); continue }
    check(got.on == a["on"] as! Bool && got.offSites == a["offSites"] as! [String], "setOn \(r) \(to) \(s ?? "nil"): \(got)")
    if !R[r].on { check(got.clearNewOff == a["clearNewOff"] as! Bool, "setOn clearNewOff \(r) \(to)") }
}
for c in cases["setGroup"] as! [[Any]] {
    n += 1
    let got = ModRuns.setGroup(groups(c[0]), c[1] as! String, on: c[2] as! Bool, site: c[3] as! String)
    check(got == groups(c[4]), "setGroup \(c[1]) \(c[2]) \(c[3]): \(String(describing: got))")
}

// cost: 40 mods on a page (the twin: every page load, several times), and the shared rule's
let forty = (0..<40).map { R[($0 * 13) % R.count] }
var t = Date()
for _ in 0..<200 { _ = ModRuns.running(forty, paused: false, groupsOff: choices[2], url: "https://www.a.com/p?q=1") }
let twinCost = Date().timeIntervalSince(t) / 200
let plain = forty.map(\.plain)
t = Date()
for _ in 0..<50 { _ = Core.shared.call("modStore.running", [plain, ["paused": false, "groupsOff": choices[2], "url": partsPlain("https://www.a.com/p?q=1")]]) }
let jsCost = Date().timeIntervalSince(t) / 50
t = Date()
for _ in 0..<200 { _ = ModRuns.setOn(R[3], false, site: "a.com") }
let tapCost = Date().timeIntervalSince(t) / 200
FileHandle.standardError.write("modruns-check: running 40 mods twin \(Int(twinCost * 1e6)) µs, shared \(Int(jsCost * 1e6)) µs; setOn \(Int(tapCost * 1e6)) µs\n".data(using: .utf8)!)

if failures.isEmpty && n > 4000 { print("mod runs: ok") } else { print("\(failures.count) failures of \(n)\n" + failures.prefix(15).joined(separator: "\n")) }
