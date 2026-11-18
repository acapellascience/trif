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

// part 2: changes (ModChanges.swift through the shared rule), against the old Mods.swift's answers
func date(_ v: Any) -> Date { Date(timeIntervalSince1970: (v as! Double) / 1000) }
func times(_ o: [String: Any]) -> [Date] { (o["history"] as? [[String: Any]] ?? []).map { date($0["at"]!) } }
func ver(_ v: Any?) -> ModChanges.Version? { (v as? [String: Any]).map { .init(stamp: $0["stamp"] as! String, source: $0["source"] as! String) } }
for c in cases["add"] as? [[Any]] ?? [] {
    n += 1
    let m = c[1] as! [String: Any], w = c[5] as! [String: Any]
    let old = (c[0] as? [String: Any]).map { o in (facts: facts(o), on: o["on"] as! Bool, newOff: o["newOff"] as? String, history: times(o)) }
    let got = ModChanges.add(old: old, new: (facts(m), m["on"] as! Bool, m["newOff"] as? String), source: c[2] as! String, at: date(c[3]), changed: c[4] as! Bool)
    let want = ModChanges.Added(source: w["source"] as! String, on: w["on"] as! Bool, newOff: w["newOff"] as? String, keep: Set(w["keep"] as? [String] ?? []),
                                history: w["history"] as? [Int] ?? [], version: ver(w["version"]), ran: kept(w["ran"] as Any))
    check(got == want, "add \(c[2]) \(got) want \(want)")
}
for c in cases["undoAdd"] as? [[Any]] ?? [] { n += 1; check(ModChanges.undoAdd(ids: c[0] as! [String], id: c[1] as! String, hasBefore: c[2] as! Bool) == c[3] as! [Int], "undoAdd \(c)") }
for c in cases["remove"] as? [[Any]] ?? [] {
    n += 1
    let r = ModChanges.remove(trash: (c[0] as! [[String: Any]]).map { date($0["at"]!) }, by: c[1] as! String, at: date(c[2])), w = c[3] as! [String: Any]
    check(r.undo == w["undo"] as! Bool && r.keep == w["keep"] as! [Int], "remove \(c[1]) \(r.keep.count)")
}
for c in cases["undoDelete"] as? [[Any]] ?? [] {
    n += 1
    let r = ModChanges.undoDelete(last: c[0] as? String, ids: c[1] as! [String], trash: c[2] as! [String]), w = c[3] as? [String: Any]
    check(r?.append == w?["append"] as? Bool && r?.drop == w?["drop"] as? Int, "undoDelete \(c)")
}
for c in cases["restoreDeleted"] as? [[Any]] ?? [] {
    n += 1
    let t = (c[1] as! [[String: String]]).map { (id: $0["id"]!, modId: $0["modId"]!) }
    let r = ModChanges.restoreDeleted(c[0] as! String, trash: t, ids: c[2] as! [String], last: c[3] as? String), w = c[4] as? [String: Any]
    check(r?.index == w?["index"] as? Int && r?.clearLast == w?["clearLast"] as? Bool, "restoreDeleted \(c)")
}
func carry(_ w: [String: Any]) -> ModChanges.Carry {
    .init(keep: Set(w["keep"] as! [String]), extraNeeds: (w["extraNeeds"] as? [[String: Any]])?.compactMap(ModHolds.need), version: ver(w["version"])!, history: w["history"] as! [Int])
}
for c in cases["reject"] as? [[Any]] ?? [] {
    n += 1
    let cur = c[0] as! [String: Any]
    let r = ModChanges.reject(ran: cur["ran"] as! Bool, history: times(cur).count, at: date(c[1]))
    check(r == ((c[2] as? [String: Any]).map { .back(carry($0)) } ?? .remove), "reject \(String(describing: r))")
}
for c in cases["restore"] as? [[Any]] ?? [] {
    n += 1
    check(ModChanges.restore(history: times(c[0] as! [String: Any]).count, source: c[1] as! String, at: date(c[2])) == carry(c[3] as! [String: Any]), "restore \(c[1])")
}
check(n > 900, "only \(n) cases")


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
// cost: an add with 30 versions in History (a user action or a sync's change)
let hist = (0..<30).map { Date().addingTimeInterval(Double(-$0) * 3600) }
var t1 = Date()
for _ in 0..<100 { _ = ModChanges.add(old: (big, true, nil, hist), new: (big, true, nil), source: "edit", at: Date(), changed: true) }
let addUs = Date().timeIntervalSince(t1) / 100 * 1e6
check(addUs < 10000, "an add's rules cost \(Int(addUs)) µs")
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("edit: \(Int(us)) µs; 40 holds (twin): \(Int(twin)) µs; add: \(Int(addUs)) µs") }
check(us < 10000, "an edit's rules cost \(Int(us)) µs")

print(failures.isEmpty ? "mod store: ok" : failures.prefix(20).joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
