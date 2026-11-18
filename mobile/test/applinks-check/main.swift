import Foundation

// AppLinks.swift's decisions (another app's link from a page: Tim, 11-18), built for the Mac by applinks.test.js.
// AppLinks' decisions are the phones' shared rule (mobile/shared/gen/core.js, argv[2]), called through Core.swift.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
if CommandLine.arguments.count > 2 { Core.source = URL(fileURLWithPath: CommandLine.arguments[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
func u(_ s: String) -> URL { URL(string: s)! }
let own: Set<String> = ["trif", "trifprobe", "trifpanel"]

// kinds: the web stays TRIF's, the app's own schemes and javascript:/file: never leave, the rest is another app's
check(AppLinks.kind(u("https://x.com/"), own: own) == .web, "https web")
check(AppLinks.kind(u("HTTP://x.com/"), own: own) == .web, "HTTP web (case)")
for s in ["about:blank", "blob:https://x.com/1", "data:text/html,hi", "trifprobe://checks/a"] { check(AppLinks.kind(u(s), own: own) == .stay, "\(s) stays") }
for s in ["javascript:alert(1)", "file:///etc/hosts"] { check(AppLinks.kind(u(s), own: own) == .never, "\(s) never") }
for s in ["trif://add?x", "TRIF://pair?y", "trifpanel://panel/"] { check(AppLinks.kind(u(s), own: own) == .own, "\(s) own") }
for s in ["tel:+15551234567", "mailto:a@b.c", "sms:+1555", "maps://?q=x", "facetime:a@b.c", "itms-apps://apps.apple.com/app/id1", "fb-messenger://user/1", "fb://profile"] {
    check(AppLinks.kind(u(s), own: own) == .other, "\(s) other")
}

// decisions
check(AppLinks.decide(tapped: true, mainFrame: true, askedThisLoad: false, asking: false) == .open, "tapped opens")
check(AppLinks.decide(tapped: true, mainFrame: false, askedThisLoad: true, asking: true) == .open, "tapped in a frame opens, whatever was asked")
check(AppLinks.decide(tapped: false, mainFrame: true, askedThisLoad: false, asking: false) == .ask, "a page by itself asks")
if case .drop = AppLinks.decide(tapped: false, mainFrame: false, askedThisLoad: false, asking: false) {} else { failures.append("a frame not tapped is dropped") }
if case .drop = AppLinks.decide(tapped: false, mainFrame: true, askedThisLoad: true, asking: false) {} else { failures.append("one question a load") }
if case .drop = AppLinks.decide(tapped: false, mainFrame: true, askedThisLoad: false, asking: true) {} else { failures.append("one question at a time") }
if case .drop = AppLinks.decide(tapped: false, mainFrame: true, askedThisLoad: false, asking: false, mayAsk: false) {} else { failures.append("mayAsk false never asks") }
check(AppLinks.decide(tapped: true, mainFrame: true, askedThisLoad: false, asking: false, mayAsk: false) == .open, "mayAsk false still opens a tap")

// a tap: a link or form, with the finger on the page just now or a menu's item
check(AppLinks.isTap(linkOrForm: true, sinceTouch: 0.2, touching: false, menu: false), "link 0.2 s after a lift")
check(!AppLinks.isTap(linkOrForm: true, sinceTouch: 5, touching: false, menu: false), "link 5 s after: a script's a.click()")
check(!AppLinks.isTap(linkOrForm: true, sinceTouch: nil, touching: false, menu: false), "link with no touch ever")
check(AppLinks.isTap(linkOrForm: true, sinceTouch: nil, touching: true, menu: false), "link with the finger down")
check(AppLinks.isTap(linkOrForm: true, sinceTouch: 30, touching: false, menu: true), "a menu's Open")
check(!AppLinks.isTap(linkOrForm: false, sinceTouch: 0.1, touching: true, menu: true), "a script's location = … is never a tap")

// words
check(AppLinks.question(u("maps://?q=x")) == "Open this page in \u{201C}Maps\u{201D}?", "Maps named")
check(AppLinks.question(u("fb-messenger://user/1")) == "Open this page in another app?", "unknown app")
check(AppLinks.appName(u("mailto:a@b.c")) == nil, "Mail not assumed")
check(AppLinks.logged(u("mailto:someone@example.com")) == "mailto:", "the log keeps the scheme only")

// the shared cases (mobile/shared/core/app-links-cases.json, argv[1]): the same answers as core/app-links.js
if CommandLine.arguments.count > 1, let d = FileManager.default.contents(atPath: CommandLine.arguments[1]),
   let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
    let own = Set(cases["own"] as? [String] ?? [])
    func name(_ k: AppLinks.Kind) -> String { switch k { case .web: "web"; case .stay: "stay"; case .never: "never"; case .own: "own"; case .other: "other" } }
    func name(_ d: AppLinks.Decision) -> String { switch d { case .open: "open"; case .ask: "ask"; case .drop(let why): "drop:" + why } }
    var n = 0
    for c in cases["kind"] as? [[String]] ?? [] { n += 1; let got = name(AppLinks.kind(u(c[0]), own: own)); check(got == c[1], "case kind \(c[0]): \(got), want \(c[1])") }
    for c in cases["decide"] as? [[Any]] ?? [] {
        n += 1
        let a = c[0] as! [String: Bool], want = c[1] as! String
        let got = name(AppLinks.decide(tapped: a["tapped"]!, mainFrame: a["mainFrame"]!, askedThisLoad: a["askedThisLoad"]!, asking: a["asking"]!, mayAsk: a["mayAsk"] ?? true))
        check(got == want, "case decide \(a): \(got), want \(want)")
    }
    for c in cases["isTap"] as? [[Any]] ?? [] {
        n += 1
        let a = c[0] as! [String: Any], want = c[1] as! Bool
        let got = AppLinks.isTap(linkOrForm: a["linkOrForm"] as! Bool, sinceTouch: a["sinceTouch"] as? Double, touching: a["touching"] as! Bool, menu: a["menu"] as! Bool)
        check(got == want, "case isTap \(a): \(got), want \(want)")
    }
    for c in cases["logged"] as? [[String]] ?? [] { n += 1; check(AppLinks.logged(u(c[0])) == c[1], "case logged \(c[0])") }
    check(n > 40, "the cases were read (\(n))")
} else { failures.append("no cases file (argv[1])") }

// the cost of a call through (a navigation's about:blank frame asks kind; a link asks isTap and decide)
do {
    let n = 5000
    var t = Date()
    for _ in 0..<n { _ = AppLinks.kind(u("about:blank"), own: own) }
    let kindUs = Date().timeIntervalSince(t) / Double(n) * 1e6
    t = Date()
    for _ in 0..<n { _ = AppLinks.decide(tapped: false, mainFrame: true, askedThisLoad: false, asking: false) }
    let decideUs = Date().timeIntervalSince(t) / Double(n) * 1e6
    t = Date()
    for _ in 0..<n { _ = AppLinks.kind(u("https://x.com/"), own: own) }
    let webUs = Date().timeIntervalSince(t) / Double(n) * 1e6
    FileHandle.standardError.write("app links through core.js: kind \(String(format: "%.1f", kindUs)) µs, decide \(String(format: "%.1f", decideUs)) µs, http(s) kind (Swift) \(String(format: "%.2f", webUs)) µs a call\n".data(using: .utf8)!)
    check(kindUs < 500 && decideUs < 500, "a call through costs under 0.5 ms")
}

print(failures.isEmpty ? "app links: ok" : "app links: FAILED\n" + failures.joined(separator: "\n"))
