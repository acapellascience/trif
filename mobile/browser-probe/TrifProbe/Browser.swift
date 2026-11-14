// The probe's browser: one web view, with three places code can run beside a page.
//   the page's own world   where a free mod would run, and where the page can change everything
//   TRIF's world ("trif")  the kit (mobile/shared/kit.js), the start script, and the only way to the app
//   the box ("trif-box")   where SES locks the language down and boxed mods would run
// It also does the things a TRIF browser would do by itself: hides what the saved rules say from the first
// moment of each load, lets you long-press a thing to hide it, and stops a mod link before it loads.

import SwiftUI
import UIKit
import WebKit

/// What the kit says about the element under a finger (mobile/shared/kit.js describe).
struct Picked: Equatable {
    var tag: String
    var text: String
    var selector: String
    var how: String
    var matches: Int
    var similarSelector: String?
    var similarCount: Int
    var from: String
}

/// A mod link the browser stopped: an address ending /trif-install, with what it carries after the #.
struct ModLink: Identifiable {
    let id = UUID()
    let address: String
    let hide: [String]   // selectors, from #hide=…
    let source: String   // which web view it came from: the page, or Claude's pane
}

@MainActor
final class Browser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UIGestureRecognizerDelegate {
    static let trifWorld = WKContentWorld.world(name: "trif")
    static let boxWorld = WKContentWorld.world(name: "trif-box")
    /// What Safari adds to its user agent, so sites treat this web view as the browser it is.
    static let safariSuffix = "Version/26.0 Mobile/15E148 Safari/604.1"

    @Published var address = ""
    @Published var title = ""
    @Published var loading = false
    @Published var canGoBack = false
    @Published var status = ""
    @Published var picked: Picked?
    @Published var modLink: ModLink?
    /// Whole mods (Mods.swift): those kept, and one from the clipboard waiting for an OK.
    let mods = ModStore()
    @Published var modOffer: InstalledMod?
    @Published var running = false

    let webView: WKWebView
    let pages: PageSchemeHandler
    let report: Report

    private var loadWaiters: [CheckedContinuation<Void, Never>] = []

    init(report: Report) {
        self.report = report
        let pages = PageSchemeHandler()
        self.pages = pages
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(pages, forURLScheme: PageSchemeHandler.scheme)
        config.applicationNameForUserAgent = Browser.safariSuffix
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.isInspectable = true
        webView.configuration.userContentController.addScriptMessageHandler(self, contentWorld: Browser.trifWorld, name: "trif")
        installScripts()

        let press = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
        press.minimumPressDuration = 0.45
        press.delegate = self
        webView.addGestureRecognizer(press)

        go(PageSchemeHandler.home + "plain.html")
    }

    // MARK: resources and scripts

    static func resource(_ name: String, _ ext: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext), let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "throw new Error('the app is missing \(name).\(ext)');"
        }
        return text
    }

    /// The scripts every page gets at its start. Put in again whenever the hide rules change: the rules are
    /// part of the start script's own text, so a page never waits for them.
    func installScripts() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        let kit = Browser.resource("kit", "js")
        let startOwn = Browser.resource("start-own", "js") + "(\(report.rulesJSON()));"
        let startPage = Browser.resource("start-page", "js")
        ucc.addUserScript(WKUserScript(source: kit, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        ucc.addUserScript(WKUserScript(source: startOwn, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        ucc.addUserScript(WKUserScript(source: startPage, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        for script in mods.userScripts() { ucc.addUserScript(script) }
    }

    // MARK: whole mods

    func addMod(_ m: InstalledMod) {
        mods.add(m)
        report.log("mods", "added \(m.tierName.lowercased()) \(m.id) for \(m.sites.joined(separator: ", "))")
        installScripts()
        reload()
        status = "Added \(m.name). It runs on \(m.sites.joined(separator: ", "))."
        Task { await reportToChat(m) }
    }

    func removeMod(_ m: InstalledMod) { mods.remove(m); installScripts(); reload() }

    func toggleMod(_ m: InstalledMod) { mods.toggle(m); installScripts(); reload() }

    // MARK: running JavaScript

    static func jsError(_ error: Error) -> String {
        let ns = error as NSError
        if let message = ns.userInfo["WKJavaScriptExceptionMessage"] as? String { return message }
        return ns.localizedDescription
    }

    /// Runs `body` as the body of an async function in a world. Every body the probe sends returns text
    /// (usually JSON), so that's what comes back: (text, nil), or (nil, why it failed).
    func call(_ body: String, _ arguments: [String: Any] = [:], in world: WKContentWorld) async -> (text: String?, error: String?) {
        await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: world) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: (value as? String, nil))
                case .failure(let error):
                    continuation.resume(returning: (nil, Browser.jsError(error)))
                }
            }
        }
    }

    /// Runs a whole script's text in a world, the way a file would be loaded. Returns why it failed, or nil.
    func load(_ source: String, in world: WKContentWorld) async -> String? {
        await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(source + "\n;'loaded'", in: nil, in: world) { result in
                switch result {
                case .success:
                    continuation.resume(returning: nil)
                case .failure(let error):
                    continuation.resume(returning: Browser.jsError(error))
                }
            }
        }
    }

    static func parse(_ text: String?) -> Any? {
        guard let text = text, let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func jsonText(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value) || value is String || value is NSNumber || value is NSNull,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: going places

    func go(_ text: String) {
        var entry = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if entry.isEmpty { return }
        if !entry.contains("://") {
            if entry.contains(" ") || !entry.contains(".") {
                entry = "https://duckduckgo.com/?q=" + (entry.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? entry)
            } else {
                entry = "https://" + entry
            }
        }
        guard let url = URL(string: entry) else { status = "That isn't an address."; return }
        picked = nil
        webView.load(URLRequest(url: url))
    }

    func reload() { picked = nil; webView.reload() }
    func back() { picked = nil; webView.goBack() }

    var host: String { webView.url?.host ?? "" }

    /// Waits for the page now loading to finish (or eight seconds).
    func waitForLoad() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            loadWaiters.append(continuation)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                self.resumeLoadWaiters()
            }
        }
    }

    private func resumeLoadWaiters() {
        let waiting = loadWaiters
        loadWaiters = []
        for w in waiting { w.resume() }
    }

    // MARK: mod links

    /// Is this address a mod link? (An https address whose path ends /trif-install, or anything trif:.)
    static func modLink(_ url: URL, source: String) -> ModLink? {
        let isLink = url.scheme == "trif" || url.path.hasSuffix("/trif-install")
        guard isLink else { return nil }
        var hide: [String] = []
        if let fragment = url.fragment {
            for part in fragment.components(separatedBy: "&") {
                let pair = part.components(separatedBy: "=")
                if pair.count >= 2, pair[0] == "hide" {
                    let value = pair.dropFirst().joined(separator: "=")
                    if let selector = value.removingPercentEncoding, !selector.isEmpty { hide.append(selector) }
                }
            }
        }
        return ModLink(address: url.absoluteString, hide: hide, source: source)
    }

    func offer(_ link: ModLink) {
        report.log("mod link", "from \(link.source): \(link.address)")
        modLink = link
    }

    /// A mod link, or a bare selector, on the clipboard (what a chat gives when it can't make a link).
    func offerFromClipboard() { offer(text: UIPasteboard.general.string) }

    /// A mod a chat has just finished writing (Web/chat.js): offered by itself, unless that very mod is already
    /// added or another offer is up.
    func offerFromChat(_ text: String) {
        guard modOffer == nil, modLink == nil else { return }
        let r = mods.read(text)
        guard let m = r.mod else { return }
        if mods.mods.contains(where: { $0.id == m.id && $0.code == m.code }) { return }
        modOffer = m
    }

    /// What was pasted (iOS's own Paste button hands it over without asking): a whole mod, a mod link, or a selector.
    func offer(text pasted: String?) {
        guard let text = pasted?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            status = "Nothing on the clipboard."
            return
        }
        // (a whole mod: a chat's reply with a ==WebMod== file in it, or the file)
        if text.contains("==WebMod==") {
            let r = mods.read(text)
            if let m = r.mod { modOffer = m } else { status = "That mod can't be added: \(r.error ?? "no reason given")." }
            return
        }
        let words = text.components(separatedBy: .whitespacesAndNewlines)
        if let found = words.first(where: { $0.contains("trif-install") }), let url = URL(string: found), let link = Browser.modLink(url, source: "clipboard") {
            offer(link)
        } else if text.count < 300, !text.contains("\n") {
            offer(ModLink(address: "(pasted selector)", hide: [text], source: "clipboard"))
        } else {
            status = "The clipboard has no mod link or selector."
        }
    }

    // MARK: hiding

    func hide(_ selector: String, how: String, from: String) async {
        let host = self.host
        guard !host.isEmpty else { return }
        report.add(HideRule(host: host, selector: selector, how: how, from: from, at: Date()))
        report.log("hidden", "\(host): \(selector) (named by \(how), from \(from))")
        installScripts()
        await applyRulesNow()
        picked = nil
        _ = await call("globalThis.__trifKit && globalThis.__trifKit.unmark(); return 'ok';", in: Browser.trifWorld)
    }

    func applyRulesNow() async {
        let selectors = report.rules.filter { $0.host == host }.map { $0.selector }
        let result = await call("return JSON.stringify(globalThis.__trifKit.hide(selectors));", ["selectors": selectors], in: Browser.trifWorld)
        if let error = result.error { status = "Couldn't hide: \(error)" }
    }

    func forgetRulesHere() async {
        report.forgetRules(for: host)
        installScripts()
        reload()
    }

    // MARK: pointing

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func longPressed(_ press: UILongPressGestureRecognizer) {
        guard press.state == .began else { return }
        let point = press.location(in: webView)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await pick(at: point) }
    }

    /// The element under a point of the web view (in points; the page works out its own zoom and scroll).
    func pick(at point: CGPoint) async {
        let body = """
        const vv = window.visualViewport;
        const cx = vv ? vv.offsetLeft + x / vv.scale : x, cy = vv ? vv.offsetTop + y / vv.scale : y;
        return JSON.stringify(globalThis.__trifKit.at(cx, cy));
        """
        let result = await call(body, ["x": Double(point.x), "y": Double(point.y)], in: Browser.trifWorld)
        show(result, from: "pointing")
    }

    func widen() async {
        show(await call("return JSON.stringify(globalThis.__trifKit.wider());", in: Browser.trifWorld), from: picked?.from ?? "pointing")
    }

    func mark(selector: String, from: String) async -> Bool {
        let result = await call("return JSON.stringify(globalThis.__trifKit.pick(selector));", ["selector": selector], in: Browser.trifWorld)
        show(result, from: from)
        return picked != nil
    }

    func cancelPick() async {
        picked = nil
        _ = await call("globalThis.__trifKit && globalThis.__trifKit.unmark(); return 'ok';", in: Browser.trifWorld)
    }

    private func show(_ result: (text: String?, error: String?), from: String) {
        if let error = result.error { status = "Couldn't look: \(error)"; picked = nil; return }
        guard let d = Browser.parse(result.text) as? [String: Any], let selector = d["selector"] as? String else { picked = nil; return }
        let similar = d["similar"] as? [String: Any]
        picked = Picked(tag: d["tag"] as? String ?? "", text: d["text"] as? String ?? "", selector: selector,
                        how: d["how"] as? String ?? "", matches: d["matches"] as? Int ?? 0,
                        similarSelector: similar?["selector"] as? String, similarCount: similar?["matches"] as? Int ?? 0, from: from)
    }

    // MARK: the outline, and asking the phone's own model

    func outline(_ maxChars: Int = 6000) async -> (text: String, chars: Int, tokens: Int)? {
        let result = await call("return JSON.stringify(globalThis.__trifKit.outline(max));", ["max": maxChars], in: Browser.trifWorld)
        guard let o = Browser.parse(result.text) as? [String: Any], let text = o["text"] as? String else {
            status = "No outline: \(result.error ?? "the page has no kit")"
            return nil
        }
        return (text, o["chars"] as? Int ?? text.count, o["tokens"] as? Int ?? 0)
    }

    func copyOutline() async {
        guard let request = await pageForChat() else { return }
        UIPasteboard.general.string = request
        status = "Copied: the page and how to write a mod for it. Paste it into the chat and say what you want changed; then copy the reply and Add a mod from the clipboard."
    }

    // MARK: the chat, both ways (Tim, 11-13)

    /// The page's parts and sizes when it was last sent to the chat, to say afterwards what a mod did.
    private var baseline: (host: String, layout: String)?
    /// Puts text (and a screenshot) into the chat's message box: the pane's fill, set by the app.
    var chatFill: ((String, Data?) async -> Void)?

    /// What the chat gets for this page: how TRIF mods are written, then its outline. Notes its layout.
    func pageForChat() async -> String? {
        guard let o = await outline() else { return nil }
        if let l = (await call("return JSON.stringify(globalThis.__trifKit.layout());", in: Browser.trifWorld)).text { baseline = (host, l) }
        // (agent-facing words: what TRIF mods are and how to hand one over, then the page)
        let page = webView.url
        let origin = page.map { "\($0.scheme ?? "https")://\($0.host ?? "")" } ?? "https://\(host)"
        let request = """
        I'm looking at \(page?.absoluteString ?? host) in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page: each line starts with a CSS selector for a part of it.

        I'll say what I want changed. Reply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod; a free mod only if it really needs the page's own code. Its @match must cover \(origin)/*. In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet).

        --- How TRIF mods are written ---
        \(Browser.resource("mod-guide", "txt"))

        --- The page: \(page?.absoluteString ?? host) ---
        \(o.text)
        """
        report.log("outline", "\(host): \(o.chars) characters, about \(o.tokens) tokens, with the request (\(request.count) characters in all)")
        return request
    }

    /// After a mod is added: once the page has loaded again, what changed (from the layout sent to the chat),
    /// the mod's errors and a screenshot, into the chat's message box for the person to send.
    func reportToChat(_ m: InstalledMod) async {
        guard let fill = chatFill else { return }
        for _ in 0..<40 where loading { try? await Task.sleep(nanoseconds: 250_000_000) }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        var lines: [String] = []
        if let b = baseline, b.host == host, let r = (await call("return JSON.stringify(globalThis.__trifKit.compare(JSON.parse(before)));", ["before": b.layout], in: Browser.trifWorld)).text,
           let changed = Browser.parse(r) as? [[String: Any]] {
            for c in changed.prefix(25) {
                let text = (c["text"] as? String).map { $0.isEmpty ? "" : " “\($0)”" } ?? ""
                lines.append("- \(c["what"] as? String ?? "changed"): \(c["sel"] as? String ?? "?")\(text) (was \(c["was"] as? String ?? "?"), now \(c["now"] as? String ?? "gone"))")
            }
        }
        var errors: [String] = []
        if m.world == "box", let t = (await call("return JSON.stringify(globalThis.__trifSandbox ? globalThis.__trifSandbox.errors.filter((e) => e.mod === id).map((e) => e.message) : []);", ["id": m.id], in: Browser.boxWorld)).text,
           let list = Browser.parse(t) as? [String] { errors += list }
        if m.world == "page", let t = (await call("return JSON.stringify(window.__trifModErrors || []);", in: .page)).text,
           let list = Browser.parse(t) as? [String] { errors += list.filter { $0.hasPrefix("\(m.id):") } }
        var text = "I added your mod \"\(m.name)\" and reloaded \(webView.url?.absoluteString ?? host). Here's the page now (screenshot attached).\n"
        text += lines.isEmpty ? "\nNothing that was on the page before disappeared or shrank.\n" : "\nWhat disappeared or shrank, of what was on the page when I sent it to you:\n\(lines.joined(separator: "\n"))\n"
        if !errors.isEmpty { text += "\nThe mod's errors:\n\(errors.prefix(10).map { "- \($0)" }.joined(separator: "\n"))\n" }
        text += "\nIf that isn't what I asked for, fix the mod and give me the whole file again."
        let shot = await screenshot()
        await fill(text, shot)
        status = "Added \(m.name). What it did is attached in the chat's message box: send it, with what to fix, if it needs fixing."
    }

    /// The page as it looks, as PNG.
    func screenshot() async -> Data? {
        await withCheckedContinuation { c in
            webView.takeSnapshot(with: nil) { image, _ in c.resume(returning: image?.pngData()) }
        }
    }

    func askPhone(_ question: String) async {
        guard let o = await outline(2800) else { return }
        status = "Asking the phone's own model…"
        let answer = await OnDevice.ask(question, outline: o.text)
        guard let reply = answer.text else {
            status = "The phone's model didn't answer: \(answer.error ?? "no reason given")"
            report.log("on-device", "\(host): “\(question)” → no answer in \(answer.ms) ms: \(answer.error ?? "")")
            return
        }
        let found = await mark(selector: reply, from: "the on-device model")
        report.log("on-device", "\(host): “\(question)” → \(reply) in \(answer.ms) ms; \(found ? "found on the page" : "finds nothing on the page")")
        status = found ? "The phone's model chose this, in \(answer.ms) ms." : "The phone's model answered “\(reply)” (\(answer.ms) ms), which finds nothing on this page."
    }

    // MARK: the app end of TRIF's world

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return (nil, "not a message of the probe's") }
        switch type {
        case "ping":
            return (["ok": true, "received": (body["pad"] as? String ?? "").count], nil)
        case "load":
            report.log("load", body["rec"] as? String ?? "")
            return (["ok": true], nil)
        default:
            return (nil, "unknown message")
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if navigationAction.targetFrame?.isMainFrame ?? true, let link = Browser.modLink(url, source: "the page") {
            offer(link)
            return .cancel
        }
        let scheme = url.scheme ?? ""
        return ["http", "https", "about", "blob", "data", PageSchemeHandler.scheme].contains(scheme) ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
        status = ""
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        address = webView.url?.absoluteString ?? ""
        picked = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        title = webView.title ?? ""
        address = webView.url?.absoluteString ?? ""
        canGoBack = webView.canGoBack
        resumeLoadWaiters()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loading = false
        status = error.localizedDescription
        resumeLoadWaiters()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loading = false
        if (error as NSError).code != NSURLErrorCancelled { status = error.localizedDescription }
        resumeLoadWaiters()
    }

    /// A link that wants a new window opens here instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if let link = Browser.modLink(url, source: "the page") { offer(link) } else { webView.load(navigationAction.request) }
        }
        return nil
    }

    /// No menu of the system's on a long press: the long press is the probe's.
    func webView(_ webView: WKWebView, contextMenuConfigurationFor elementInfo: WKContextMenuElementInfo) async -> UIContextMenuConfiguration? {
        nil
    }
}

struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
