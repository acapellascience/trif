import Foundation

// LeavingCoverRules.swift (the leaving cover's "icon use" decision: the phones' shared rule mobile/shared/gen/core.js,
// TrifCore.leavingCover, called through Core.swift), built for the Mac by leavingcover.test.js. argv:
// leaving-cover-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
var n = 0
for c in cases["reason"] as? [[Any]] ?? [] {
    n += 1
    let f = c[0] as! [String: Any]
    var want: LeavingCoverRules.Why?
    if let w = c[1] as? [String: Any] { want = (w["iconTab"] as? String).map { .iconTab($0) } ?? .arrived }
    let got = LeavingCoverRules.reason(fullScreen: f["fullScreen"] as! Bool, host: f["host"] as! String, tab: f["tab"] as! String,
                                       iconTabs: f["iconTabs"] as? [String: String], arrivedByIcon: f["arrivedByIcon"] as! Bool)
    check(got == want, "reason \(f): \(String(describing: got)), want \(String(describing: want))")
}
for c in cases["arrived"] as? [[Any]] ?? [] {
    n += 1
    let (s, want) = ((c[0] as! NSNumber).doubleValue, c[1] as! Bool)
    check(LeavingCoverRules.arrived(since: s) == want, "arrived \(s): want \(want)")
}
check(n > 500, "only \(n) cases")

// cost: leaving (reason) and coming back (arrived)
_ = LeavingCoverRules.arrived(since: 1)
let t0 = Date()
for _ in 0..<200 {
    _ = LeavingCoverRules.reason(fullScreen: true, host: "m.facebook.com", tab: "A", iconTabs: ["facebook.com": "A", "x.com": "B"], arrivedByIcon: false)
    _ = LeavingCoverRules.arrived(since: 2)
}
let us = Date().timeIntervalSince(t0) / 200 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("leaving and back: \(Int(us)) µs") }
check(us < 5000, "leaving and back costs \(Int(us)) µs")

print(failures.isEmpty ? "leaving cover: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
