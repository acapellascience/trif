import Foundation

// AppLinks.swift's decisions (another app's link from a page: Tim, 11-18), built for the Mac by applinks.test.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
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

print(failures.isEmpty ? "app links: ok" : "app links: FAILED\n" + failures.joined(separator: "\n"))
