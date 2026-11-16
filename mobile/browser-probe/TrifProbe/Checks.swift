// The checks. Most are JavaScript (browser-checks.json, made from mobile/browser-probe/checks.js): each is a
// list of steps, each step run in one of the three worlds, the last returning { answer, detail }. The ones
// here need the app itself: loading SES into the box world, WebKit's content blocker, and the phone's model.
//
// An answer is yes, no, some, info or error. "no" isn't a failure: these are open questions.

import Foundation
import UIKit
import WebKit

private struct JSStep: Codable {
    let world: String
    let body: String
}

private struct JSCheck: Codable {
    let id: String
    let group: String
    let title: String
    let steps: [JSStep]
}

@MainActor
struct Checks {
    let browser: Browser

    private func world(_ name: String) -> WKContentWorld {
        switch name {
        case "page": return .page
        case "box": return Browser.boxWorld
        default: return Browser.trifWorld
        }
    }

    private func ms(since start: Date) -> Int { Int(Date().timeIntervalSince(start) * 1000) }

    private func loadChecks() -> [JSCheck] {
        guard let url = Bundle.main.url(forResource: "browser-checks", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let checks = try? JSONDecoder().decode([JSCheck].self, from: data) else { return [] }
        return checks
    }

    /// One JavaScript check: its steps in order, each given what the one before returned.
    private func run(_ check: JSCheck) async -> CheckResult {
        let started = Date()
        var prev = "null"
        for step in check.steps {
            let result = await browser.call(step.body, ["prevJson": prev], in: world(step.world))
            if let error = result.error {
                return CheckResult(id: check.id, group: check.group, title: check.title, answer: "error", detail: "in the \(step.world) world: \(error)", ms: ms(since: started))
            }
            let text = result.text ?? "null"
            // (a page that has changed JSON can answer with anything: what isn't JSON is passed on as text)
            prev = Browser.parse(text) == nil ? Browser.jsonText(["garbled": text]) : text
        }
        let last = Browser.parse(prev) as? [String: Any]
        let answer = last?["answer"] as? String ?? "error"
        let detail: String
        if let d = last?["detail"] as? String { detail = d } else if let d = last?["detail"] { detail = Browser.jsonText(d) } else { detail = prev }
        return CheckResult(id: check.id, group: check.group, title: check.title, answer: answer, detail: detail, ms: ms(since: started))
    }

    private func result(_ id: String, _ group: String, _ title: String, _ answer: String, _ detail: Any, _ started: Date) -> CheckResult {
        let text = (detail as? String) ?? Browser.jsonText(detail)
        return CheckResult(id: id, group: group, title: title, answer: answer, detail: text, ms: ms(since: started))
    }

    // MARK: the checks that need the app

    private func environment() async -> CheckResult {
        let started = Date()
        let agent = await browser.call("return navigator.userAgent;", in: Browser.trifWorld)
        let detail: [String: Any] = [
            "device": Report.deviceName(),
            "system": "iOS \(UIDevice.current.systemVersion)",
            "userAgent": agent.text ?? agent.error ?? "",
            "onDeviceModel": OnDevice.availability(),
            "memoryMB": Int(ProcessInfo.processInfo.physicalMemory / 1_048_576),
        ]
        return result("env", "The app", "What this is", "info", detail, started)
    }

    /// SES and the runtime's file go into the box world as text, the way a user script would put them there.
    private func loadBox() async -> [CheckResult] {
        var out: [CheckResult] = []
        var started = Date()
        let has = await browser.call("return typeof lockdown;", in: Browser.boxWorld)
        if has.text != "function" {
            let error = await browser.load(Browser.resource("ses.umd.min", "js"), in: Browser.boxWorld)
            let types = await browser.call("return [typeof lockdown, typeof Compartment].join('/');", in: Browser.boxWorld)
            let ok = error == nil && types.text == "function/function"
            let detail: [String: Any] = ["error": error ?? "", "lockdown/Compartment": types.text ?? types.error ?? "", "loadMs": ms(since: started)]
            out.append(result("box.ses", "The box", "SES loads in a world of its own", ok ? "yes" : "no", detail, started))
        } else {
            out.append(result("box.ses", "The box", "SES loads in a world of its own", "yes", "already loaded on this page", started))
        }
        started = Date()
        let error = await browser.load(Browser.resource("sandbox-runtime", "js"), in: Browser.boxWorld)
        let type = await browser.call("return typeof globalThis.__trifStartSandbox;", in: Browser.boxWorld)
        let fileDetail: [String: Any] = ["error": error ?? "", "loadMs": ms(since: started)]
        out.append(result("box.file", "The box", "The sandbox runtime's file loads there", error == nil && type.text == "function" ? "yes" : "no", fileDetail, started))
        return out
    }

    private func compile(_ identifier: String, _ json: String) async -> (list: WKContentRuleList?, error: String?) {
        await withCheckedContinuation { continuation in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
                continuation.resume(returning: (list, error.map { ($0 as NSError).localizedDescription }))
            }
        }
    }

    /// WebKit's content blocker: hide rules and blocked requests that are applied by the browser engine
    /// itself, with no script in the page at all. Reloads the page, so it runs last.
    private func blocker() async -> [CheckResult] {
        var out: [CheckResult] = []
        var started = Date()
        var timings: [String: Any] = [:]
        for n in [1, 1000, 10000] {
            let rules = (0..<n).map { "{\"trigger\":{\"url-filter\":\".*\"},\"action\":{\"type\":\"css-display-none\",\"selector\":\".trif-probe-rule-\($0)\"}}" }
            let t = Date()
            let made = await compile("trif-probe-timing", "[" + rules.joined(separator: ",") + "]")
            timings["\(n) rules"] = made.list != nil ? "\(ms(since: t)) ms" : "failed: \(made.error ?? "")"
        }
        out.append(result("blocker.compile", "The content blocker", "How long hide rules take to compile", "info", timings, started))

        started = Date()
        let json = """
        [{"trigger":{"url-filter":".*"},"action":{"type":"css-display-none","selector":"trif-probe-blocked"}},
         {"trigger":{"url-filter":"trif-probe-canary"},"action":{"type":"block"}}]
        """
        let made = await compile("trif-probe-test", json)
        guard let list = made.list else {
            out.append(result("blocker.works", "The content blocker", "A rule list hides an element and blocks a request, with no script", "no", "didn't compile: \(made.error ?? "")", started))
            return out
        }
        let ucc = browser.webView.configuration.userContentController
        let ask = """
        const el = document.createElement('trif-probe-blocked');
        el.textContent = 'x';
        document.documentElement.append(el);
        const hidden = getComputedStyle(el).display === 'none';
        el.remove();
        const url = new URL('/trif-probe-canary?n=' + Date.now(), location.href).href;
        const request = await fetch(url, { cache: 'no-store' }).then((r) => 'answered (' + r.status + ')', (e) => 'blocked (' + e.message + ')');
        return JSON.stringify({ hidden, request });
        """
        let before = await browser.call(ask, in: Browser.trifWorld)
        ucc.add(list)
        browser.reload()
        await browser.waitForLoad()
        let after = await browser.call(ask, in: Browser.trifWorld)
        ucc.remove(list)
        let a = Browser.parse(after.text) as? [String: Any]
        let hidden = a?["hidden"] as? Bool ?? false
        let blocked = (a?["request"] as? String ?? "").hasPrefix("blocked")
        let beforeValue: Any = Browser.parse(before.text) ?? (before.error ?? "")
        let afterValue: Any = Browser.parse(after.text) ?? (after.error ?? "")
        let detail: [String: Any] = ["before": beforeValue, "withTheRules": afterValue]
        let answer = hidden && blocked ? "yes" : (hidden || blocked ? "some" : "no")
        out.append(result("blocker.works", "The content blocker", "A rule list hides an element and blocks a request, with no script", answer, detail, started))
        browser.reload()
        await browser.waitForLoad()
        return out
    }

    private func onDevice() async -> CheckResult {
        let started = Date()
        let availability = OnDevice.availability()
        guard OnDevice.isAvailable else {
            return result("ondevice", "The phone's own model", "The on-device model picks the right part of the page", "info", availability, started)
        }
        guard let o = await browser.outline(2800) else {
            return result("ondevice", "The phone's own model", "The on-device model picks the right part of the page", "error", "no outline of this page", started)
        }
        var detail: [String: Any] = ["outlineChars": o.chars, "outlineTokens": o.tokens]
        var good = 0
        let questions = ["the cookie notice", "the banner asking me to subscribe", "the sidebar of trending topics"]
        for q in questions {
            let answer = await OnDevice.ask(q, outline: o.text)
            var matches = -1
            if let reply = answer.text {
                let counted = await browser.call("return String(globalThis.__trifKit.count(selector));", ["selector": reply], in: Browser.trifWorld)
                matches = Int(counted.text ?? "") ?? -1
            }
            if matches > 0 { good += 1 }
            let entry: [String: Any] = ["reply": answer.text ?? "", "error": answer.error ?? "", "ms": answer.ms, "findsOnPage": matches]
            detail[q] = entry
        }
        let answer = good == questions.count ? "yes" : (good > 0 ? "some" : "no")
        return result("ondevice", "The phone's own model", "The on-device model picks the right part of the page", answer, detail, started)
    }

    // MARK: all of them

    func runAll() async -> CheckRun {
        let url = browser.webView.url?.absoluteString ?? ""
        var results: [CheckResult] = [await environment()]
        var boxLoaded = false
        for check in loadChecks() {
            if !boxLoaded, check.steps.contains(where: { $0.world == "box" }) {
                results.append(contentsOf: await loadBox())
                boxLoaded = true
            }
            results.append(await run(check))
        }
        results.append(await onDevice())
        results.append(contentsOf: await blocker())
        return CheckRun(at: Date(), url: url, results: results)
    }
}
