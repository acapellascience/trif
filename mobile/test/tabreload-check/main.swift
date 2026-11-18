import Foundation

// TabReloadRules.swift (which tabs load again when the mods change, and Request Desktop Website's per-site memory: the
// phones' shared rules mobile/shared/gen/core.js, TrifCore.tabReload and TrifCore.desktop, called through Core.swift;
// loaded, stale, key, wants and can are Swift twins), built for the Mac by tabreload.test.js. argv:
// tab-reload-cases.json, desktop-cases.json, gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 3 { Core.source = URL(fileURLWithPath: args[3]) } else { failures.append("no core.js (argv[3])") }
Core.report = { failures.append("Core: " + $0) }
func load(_ i: Int) -> [String: Any] {
    guard args.count > i, let d = FileManager.default.contents(atPath: args[i]), let c = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
        print("no cases (argv[\(i)])"); exit(1)
    }
    return c
}
let R = load(1), D = load(2)
func rows(_ c: [String: Any], _ k: String) -> [(Any, Any)] { (c[k] as? [[Any]] ?? []).map { ($0[0], $0[1]) } }
func str(_ v: Any?) -> String? { v as? String }
var n = 0
// the JS answer for a twin
func js(_ name: String, _ a: [Any]) -> Any? { Core.shared.call(name, a) }

for (f, w) in rows(R, "shown") {
    n += 1; let f = f as! [String: Any]
    let got = TabReloadRules.starts(started: f["started"] as! Bool, waitingForFront: f["waitingForFront"] as! Bool)
    check(got == ((w as! String) == "start"), "shown \(f)")
}
for (f, w) in rows(R, "loaded") {
    n += 1; let f = f as! [String: Any]
    let got = TabReloadRules.loaded(pending: f["pending"] as! Bool, signature: f["signature"] as! String)
    check(got == w as! String, "loaded \(f): \(got)")
    check(js("tabReload.loaded", [f]) as? String == got, "loaded \(f): the twin and the shared rule differ")
}
for (f, w) in rows(R, "stale") {
    n += 1; let f = f as! [String: Any]
    let got = TabReloadRules.stale(str(f["loaded"]), now: f["now"] as! String)
    check(got == (w as? Bool), "stale \(f): \(String(describing: got))")
    let j = js("tabReload.stale", [f["loaded"]!, f["now"]!])
    check((j is NSNull && got == nil) || (j as? Bool) == got, "stale \(f): the twin and the shared rule differ")
}
for (f, w) in rows(R, "refresh") {
    n += 1; let f = f as! [String: Any]
    let got = TabReloadRules.refresh(pending: f["pending"] as! Bool, started: f["started"] as! Bool, hasPage: f["hasPage"] as! Bool,
                                     reloading: f["reloading"] as! Bool, loaded: str(f["loaded"]), now: f["now"] as! String, evenPlaying: f["evenPlaying"] as! Bool)
    check(got.rawValue == w as! String, "refresh \(f): \(got)")
}
for (f, w) in rows(R, "recheck") {
    n += 1; let f = f as! [String: Any]
    let got = TabReloadRules.recheck(playing: f["playing"] as! Bool, shown: f["shown"] as! Bool, reloading: f["reloading"] as! Bool,
                                     pending: f["pending"] as! Bool, loaded: str(f["loaded"]), now: f["now"] as! String)
    check(got.rawValue == w as! String, "recheck \(f): \(got)")
}
for (h, w) in rows(D, "key") {
    n += 1; let h = h as! String
    check(DesktopRules.key(h) == w as! String, "key \(h): \(DesktopRules.key(h))")
    check(js("desktop.key", [h]) as? String == DesktopRules.key(h), "key \(h): the twin and the shared rule differ")
}
for (f, w) in rows(D, "wants") {
    n += 1; let f = f as! [String: Any]; let kept = f["kept"] as! [String], h = f["host"] as! String
    check(DesktopRules.wants(Set(kept), host: h) == w as! Bool, "wants \(f)")
    check(js("desktop.wants", [kept, h]) as? Bool == (w as! Bool), "wants \(f): the shared rule differs")
}
for (f, w) in rows(D, "set") {
    n += 1; let f = f as! [String: Any]
    let got = DesktopRules.set(Set(f["kept"] as! [String]), host: f["host"] as! String, on: f["on"] as! Bool)
    check(got == w as! [String], "set \(f): \(got)")
}
for (f, w) in rows(D, "can") {
    n += 1; let f = f as! [String: Any]; let s = f["scheme"] as! String, h = f["host"] as! String
    check(DesktopRules.can(scheme: s, host: h) == w as! Bool, "can \(f)")
    check(js("desktop.can", [s, h]) as? Bool == (w as! Bool), "can \(f): the shared rule differs")
}
check(n > 1000, "only \(n) cases")

// cost: a change to the mods looked at for the shown tab (refresh, then recheck), and Request Desktop Website
_ = TabReloadRules.starts(started: true, waitingForFront: false)
let t0 = Date()
for _ in 0..<200 {
    _ = TabReloadRules.refresh(pending: false, started: true, hasPage: true, reloading: false, loaded: "a:1,b:2", now: "a:1", evenPlaying: false)
    _ = TabReloadRules.recheck(playing: false, shown: true, reloading: false, pending: false, loaded: "a:1,b:2", now: "a:1")
}
let us = Date().timeIntervalSince(t0) / 200 * 1e6
let t1 = Date()
for _ in 0..<200 { _ = DesktopRules.set(["a.org", "b.org", "m.youtube.com"], host: "www.example.com", on: true) }
let us2 = Date().timeIntervalSince(t1) / 200 * 1e6
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("refresh and recheck: \(Int(us)) µs\nrequest desktop: \(Int(us2)) µs") }
check(us < 5000 && us2 < 5000, "refresh and recheck cost \(Int(us)) µs, request desktop \(Int(us2)) µs")

print(failures.isEmpty ? "tab reload: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
