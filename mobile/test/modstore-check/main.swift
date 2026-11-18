import Foundation

// ModHolds.swift (the mod store's hold rules: the phones' shared rule mobile/shared/gen/core.js, TrifCore.modStore,
// called through Core.swift; `waiting` a Swift twin) and Site.swift, built for the Mac by modstore.test.js.
// argv: mod-store-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
func needs(_ v: Any) -> [ModNeed] { (v as! [[String: Any]]).map { ModHolds.need($0)! } }
func allowed(_ v: Any) -> [String: [String]] { (v as! [String: Any]).mapValues { $0 as! [String] } }
func facts(_ o: [String: Any]) -> ModHolds.Facts {
    .init(tier: o["tier"] as! String, site: o["site"] as! String, matches: o["matches"] as! [String], needs: needs(o["needs"]!),
          extraNeeds: needs(o["extraNeeds"]!), allowed: allowed(o["allowed"]!), ran: o["ran"] as! Bool)
}
func kept(_ v: Any) -> ModHolds.Kept? { (v as? String).flatMap(ModHolds.Kept.init) }

var n = 0
// [mod, waiting, approve, seeded, ranAfter(true, add), ranAfter(true, restore)]
for c in cases["mods"] as? [[Any]] ?? [] {
    n += 1
    let m = facts(c[0] as! [String: Any])
    let w = ModHolds.waiting(m.needs + m.extraNeeds, allowed: m.allowed)
    check(w == needs(c[1]), "waiting (twin) \(m.plain)")
    // (the twin agrees with the shared rule's)
    let jsHeld = Core.shared.call("modStore.held", [m.plain]) as? Bool
    check(jsHeld == !w.isEmpty, "held: twin \(!w.isEmpty), shared \(String(describing: jsHeld))")
    check(ModHolds.approve(m) == allowed(c[2]), "approve \(m.plain)")
    check(ModHolds.seeded(m) == allowed(c[3]), "seeded \(m.plain)")
    check(ModHolds.ranAfter(held: true, old: m, restore: false) == kept(c[4]), "ranAfter add \(m.plain)")
    check(ModHolds.ranAfter(held: true, old: m, restore: true) == kept(c[5]), "ranAfter restore \(m.plain)")
}
for c in cases["allow"] as? [[Any]] ?? [] { n += 1; check(ModHolds.allow(needs(c[0]), allowed(c[1])) == allowed(c[2]), "allow \(c[0]) \(c[1])") }
for c in cases["changeNeeds"] as? [[Any]] ?? [] {
    n += 1
    let m = facts(c[0] as! [String: Any]), o = facts(c[1] as! [String: Any])
    let got = ModHolds.changeNeeds(m, was: o)
    check(got == needs(c[2]), "changeNeeds \(m.tier) \(m.matches) from \(o.tier) on \(o.site): \(got.map(\.key))")
}
for c in cases["ranAfter"] as? [[Any]] ?? [] {
    n += 1
    check(ModHolds.ranAfter(held: c[0] as! Bool, old: facts(c[1] as! [String: Any]), restore: c[2] as! String == "restore") == kept(c[3]), "ranAfter \(c[0]) \(c[2])")
}
check(n > 300, "only \(n) cases")

// cost: an edit's two calls (seeded + changeNeeds) for a mod with 6 needs of 20 lines, through the shared rule; the
// twin's held for 40 mods (a page load's running list)
let big = ModHolds.Facts(tier: "free", site: "x.com", matches: ["*://*.x.com/*", "https://other.org/*"],
                         needs: (0..<6).map { i in ModNeed(key: "finding:\(i)", fact: "does thing \(i)", power: nil, lines: (0..<20).map { String(format: "%016x", i * 100 + $0) }) },
                         extraNeeds: [], allowed: [:], ran: false)
_ = ModHolds.seeded(big)
var t0 = Date()
for _ in 0..<100 { _ = ModHolds.seeded(big); _ = ModHolds.changeNeeds(big, was: big) }
let us = Date().timeIntervalSince(t0) / 100 * 1e6
t0 = Date()
var h = 0
for _ in 0..<100 { for _ in 0..<40 { if !ModHolds.waiting(big.needs, allowed: big.allowed).isEmpty { h += 1 } } }
let twin = Date().timeIntervalSince(t0) / 100 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("edit: \(Int(us)) µs; 40 holds (twin): \(Int(twin)) µs") }
check(us < 10000, "an edit's rules cost \(Int(us)) µs")

print(failures.isEmpty ? "mod store: ok" : failures.prefix(20).joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
