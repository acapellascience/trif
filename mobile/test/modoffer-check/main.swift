import Foundation

// ModOfferRules.swift (a chat's mod: where it's read and came from; the coral "runs on another site" box: the phones'
// shared rule mobile/shared/gen/core.js, TrifCore.modOffer, called through Core.swift), built for the Mac by
// modoffer.test.js. argv: mod-offer-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
var n = 0
for c in cases["from"] as? [[Any]] ?? [] {
    n += 1
    let (chat, host, want) = (c[0] as! String, c[1] as! String, c[2] as! [String])
    let got = ModOfferRules.from(chatSite: chat, shown: host)
    check([got.here, got.came] == want, "from \(chat) \(host): \(got), want \(want)")
}
for c in cases["elsewhere"] as? [[Any]] ?? [] {
    n += 1
    let (f, s, ss) = (c[0] as? String, c[1] as! String, c[2] as! [String])
    var want: ModOfferRules.Away?
    if let w = c[3] as? [String: Any] { want = w["every"] as? Bool == true ? .every : .others(w["others"] as! [String], also: w["also"] as! Bool) }
    let got = ModOfferRules.elsewhere(cameFrom: f, folder: s, sites: ss)
    check(got == want, "elsewhere \(f ?? "nil") \(s) \(ss): \(String(describing: got)), want \(String(describing: want))")
}
check(n > 250, "only \(n) cases")

// cost: an offer's two calls
_ = ModOfferRules.from(chatSite: "x.com", shown: "y.com")
let t0 = Date()
for _ in 0..<200 { _ = ModOfferRules.from(chatSite: "phone~m.x.com", shown: "www.google.com"); _ = ModOfferRules.elsewhere(cameFrom: "x.com", folder: "x.com", sites: ["x.com", "y.com", "z.org"]) }
let us = Date().timeIntervalSince(t0) / 200 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("an offer: \(Int(us)) µs") }
check(us < 5000, "an offer costs \(Int(us)) µs")

print(failures.isEmpty ? "mod offer: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
