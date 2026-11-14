// The probe's browser: one web view, with three places code can run beside a page.
//   the page's own world   where a free mod would run, and where the page can change everything
//   TRIF's world ("trif")  the kit (mobile/shared/kit.js), the start script, and the only way to the app
//   the box ("trif-box")   where SES locks the language down and boxed mods would run
// It also does the things a TRIF browser would do by itself: hides what the saved rules say from the first
// moment of each load, lets you long-press a thing to hide it, and stops a mod link before it loads.

import SwiftUI
import UIKit
import WebKit
import PDFKit

/// What the kit says about the element under a finger (mobile/shared/kit.js describe).
struct Picked: Equatable {
    var tag: String
    var text: String
    var selector: String
    var how: String
    var matches: Int
    var similarSelector: String?
    var similarCount: Int
    var everywhereSelector: String? = nil
    var everywhereCount: Int = 0
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
    /// The last thing hidden, while it can be undone (the status strip's Undo: Tim, 11-14, hid a whole page).
    @Published var lastHide: HideRule?
    /// Everywhere on <site>: its matches outlined on the page, waiting for Hide them.
    @Published var previewing = false
    /// Set when something asks for the chat pane to open (Point TRIF at this); the app opens it.
    @Published var wantsChat = false
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
        // (never the page itself: the html or body element)
        if (await call("return String([...document.querySelectorAll(sel)].some((e) => e === document.documentElement || e === document.body));", ["sel": selector], in: Browser.trifWorld)).text == "true" {
            report.log("hidden", "\(host): not \(selector), which is the whole page")
            return
        }
        let rule = HideRule(host: host, selector: selector, how: how, from: from, at: Date())
        report.add(rule)
        lastHide = rule
        report.log("hidden", "\(host): \(selector) (named by \(how), from \(from))")
        installScripts()
        await applyRulesNow()
        picked = nil; previewing = false
        _ = await call("globalThis.__trifKit && globalThis.__trifKit.unmark(); return 'ok';", in: Browser.trifWorld)
    }

    func applyRulesNow() async {
        let selectors = report.rules.filter { $0.host == host }.map { $0.selector }
        let result = await call("return JSON.stringify(globalThis.__trifKit.hide(selectors));", ["selectors": selectors], in: Browser.trifWorld)
        if let error = result.error { status = "Couldn't hide: \(error)" }
    }

    /// Shows a hidden thing again, at once (no reload): the last one (Undo), or any from the list.
    func unhide(_ rule: HideRule) async {
        report.remove(rule)
        if lastHide?.id == rule.id { lastHide = nil }
        report.log("hidden", "\(rule.host): shown again: \(rule.selector)")
        installScripts()
        if rule.host == host { await applyRulesNow() }
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

    /// Point TRIF at this: what was long-pressed, as the chat needs it (where it is, its text and HTML, a picture
    /// of it), into the chat's message box as an attachment; the pane opens. (Agent-facing words.)
    var chatPoint: ((String, Data?) async -> Void)?
    func pointToChat() async {
        guard let p = picked, let point = chatPoint else { return }
        let js = """
        const el = globalThis.__trifKit && globalThis.__trifKit.chosen();
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const html = el.outerHTML.replace(/\\s+/g, ' ');
        return JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top + scrollY), pageH: document.documentElement.scrollHeight, viewW: innerWidth, viewH: innerHeight,
          html: html.length > 4000 ? html.slice(0, 4000) + ' …(cut)' : html, text: (el.innerText || '').trim().slice(0, 600) });
        """
        guard let d = Browser.parse((await call(js, in: Browser.trifWorld)).text) as? [String: Any] else { return }
        let n = { (k: String) in (d[k] as? NSNumber)?.intValue ?? 0 }
        var crop: Data?
        let rect = CGRect(x: n("x"), y: n("y"), width: n("w"), height: n("h")).intersection(webView.bounds)
        if !rect.isNull, rect.width > 4, rect.height > 4 {
            let cfg = WKSnapshotConfiguration()
            cfg.rect = rect
            crop = await Browser.within(5, nil) { await withCheckedContinuation { c in self.webView.takeSnapshot(with: cfg) { image, _ in c.resume(returning: image?.pngData()) } } }
        }
        let text = """
        I'm pointing at this part of \(webView.url?.absoluteString ?? host) (a picture of it is attached, if it was on the screen):

        Selector: \(p.selector)  (finds \(p.matches); named by \(p.how))
        \(p.similarSelector.map { "Others like it: \($0) (finds \(p.similarCount))\n" } ?? "")Where: \(n("w"))×\(n("h")) px, \(n("top")) px from the top of a page \(n("pageH")) px tall (the screen is \(n("viewW"))×\(n("viewH")))
        Its text: “\(d["text"] as? String ?? "")”

        Its HTML:
        ```html
        \(d["html"] as? String ?? "")
        ```
        """
        report.log("pointed", "\(host): \(p.selector)\(crop == nil ? "" : ", with a picture")")
        wantsChat = true
        await cancelPick()
        await point(text, crop)
    }

    /// Everywhere on <site>, first tap: outline what it would hide on this page; the second hides it site-wide.
    func previewEverywhere() async {
        guard let s = picked?.everywhereSelector else { return }
        _ = await call("globalThis.__trifKit.preview(sel); return 'ok';", ["sel": s], in: Browser.trifWorld)
        previewing = true
    }

    func cancelPick() async {
        previewing = false
        picked = nil
        _ = await call("globalThis.__trifKit && globalThis.__trifKit.unmark(); return 'ok';", in: Browser.trifWorld)
    }

    private func show(_ result: (text: String?, error: String?), from: String) {
        if let error = result.error { status = "Couldn't look: \(error)"; picked = nil; return }
        guard let d = Browser.parse(result.text) as? [String: Any], let selector = d["selector"] as? String else { picked = nil; return }
        let similar = d["similar"] as? [String: Any]
        let all = d["everywhere"] as? [String: Any]
        previewing = false
        picked = Picked(tag: d["tag"] as? String ?? "", text: d["text"] as? String ?? "", selector: selector,
                        how: d["how"] as? String ?? "", matches: d["matches"] as? Int ?? 0,
                        similarSelector: similar?["selector"] as? String, similarCount: similar?["matches"] as? Int ?? 0,
                        everywhereSelector: all?["selector"] as? String, everywhereCount: all?["matches"] as? Int ?? 0, from: from)
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
    var chatFill: ((String, Data?, Data?) async -> Void)?

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

        A screenshot of what I see is attached. If I attach TRIF pointer files, those are the parts of the page I mean. Everything you need is in what I send: don't open the page in a browser, a connected computer or any other tool; work from these and answer straight away.

        --- How TRIF mods are written ---
        \(Browser.resource("mod-guide", "txt"))
        \(alreadyHere())
        --- The page: \(page?.absoluteString ?? host) ---
        \(o.text)
        """
        report.log("outline", "\(host): \(o.chars) characters, about \(o.tokens) tokens, with the request (\(request.count) characters in all)")
        return request
    }

    /// What's already changing this page, for the chat to build on (Tim, 11-14): the mods switched on here, whole,
    /// and the things hidden by pointing. Empty when there's nothing.
    func alreadyHere() -> String {
        let here = webView.url?.absoluteString ?? ""
        let on = mods.running(on: here)
        let hidden = report.rules.filter { $0.host == host }.map(\.selector)
        if on.isEmpty && hidden.isEmpty { return "" }
        var t = "\n--- Already changing this page (build on these) ---\n"
        if !on.isEmpty {
            t += "Mods switched on here. To change one, give back its whole file with the same @name (it replaces that mod); a new @name adds a mod beside them.\n"
            for m in on { t += "\n### \(m.name) (\(m.tierName.lowercased()))\n```js\n\(m.code)\n```\n" }
        }
        if !hidden.isEmpty {
            t += "\nHidden by me, by pointing (each of these is display: none; the outline below doesn't have them):\n\(hidden.map { "- \($0)" }.joined(separator: "\n"))\n"
        }
        return t
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
        var text = "I added your mod \"\(m.name)\" and reloaded \(webView.url?.absoluteString ?? host). Here's the page now: a screenshot of what's on the screen, and the whole page as a PDF, are attached.\n"
        text += lines.isEmpty ? "\nNothing that was on the page before disappeared or shrank.\n" : "\nWhat disappeared or shrank, of what was on the page when I sent it to you:\n\(lines.joined(separator: "\n"))\n"
        if !errors.isEmpty { text += "\nThe mod's errors:\n\(errors.prefix(10).map { "- \($0)" }.joined(separator: "\n"))\n" }
        text += "\nIf that isn't what I asked for, fix the mod and give me the whole file again. Work from what I've attached; don't open the page in a browser or another tool."
        let (shot, blank) = await settledScreenshot()
        if blank { text += "\n\n(The screenshot looked blank even after waiting: the page may not have finished drawing.)" }
        let whole = await fullPage()
        await fill(text, shot, whole)
        status = "Added \(m.name). What it did is attached in the chat's message box: send it, with what to fix, if it needs fixing."
    }

    /// A screenshot of the page once it has finished (Tim, 11-14: look before sending): loaded, the pictures on
    /// the screen arrived, fonts in, and nothing added to it for a moment (up to 6 seconds: a mod that animates
    /// keeps changing what's in place, not adding, so it doesn't hold this up). Then the picture is looked at,
    /// and taken again (up to twice, a second apart) while it's nearly all one colour. `blank`: it still was.
    func settledScreenshot() async -> (png: Data?, blank: Bool) {
        let settle = """
        return await new Promise((done) => {
          const start = Date.now(); let last = Date.now();
          const mo = new MutationObserver(() => { last = Date.now(); });
          mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
          const pictures = () => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; }).every((i) => i.complete);
          const tick = () => {
            const ok = document.readyState === 'complete' && pictures() && Date.now() - last > 600;
            if (ok || Date.now() - start > 6000) { mo.disconnect(); done(JSON.stringify({ ok, ms: Date.now() - start })); } else setTimeout(tick, 200);
          };
          (document.fonts ? document.fonts.ready : Promise.resolve()).then(tick, tick);
        });
        """
        for _ in 0..<24 where loading { try? await Task.sleep(nanoseconds: 250_000_000) }
        // (each step with a time limit of its own: a page that reloads meanwhile, or a snapshot that never comes
        // back, mustn't leave the follow-up waiting for ever)
        let settled = await Browser.within(8, "timed out") { let r = await self.call(settle, in: Browser.trifWorld); return r.text ?? "failed: \(r.error ?? "?")" }
        var shot = await Browser.within(5, nil) { await self.screenshot() }
        var tries = 1
        while tries < 3, shot.map(Browser.looksBlank) ?? true {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            shot = await Browser.within(5, nil) { await self.screenshot() }
            tries += 1
        }
        let blank = shot.map(Browser.looksBlank) ?? true
        report.log("claude", "screenshot: settled \(settled), \(tries) \(tries == 1 ? "try" : "tries")\(blank ? ", still blank" : "")")
        return (shot, blank)
    }

    /// What `op` gives, or `fallback` if it hasn't come back within `seconds` (it's left to finish on its own).
    static func within<T>(_ seconds: Double, _ fallback: T, _ op: @escaping @MainActor () async -> T) async -> T {
        let once = OnceFlag()
        return await withCheckedContinuation { (c: CheckedContinuation<T, Never>) in
            Task { @MainActor in let v = await op(); if !once.done { once.done = true; c.resume(returning: v) } }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                if !once.done { once.done = true; c.resume(returning: fallback) }
            }
        }
    }

    /// Nearly all one colour (a page not drawn yet, or only a spinner): the picture, small, in 4-bit colours.
    static func looksBlank(_ png: Data) -> Bool {
        guard let image = UIImage(data: png)?.cgImage else { return true }
        let w = 64, h = 128
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return false }
        var counts: [Int: Int] = [:]
        for i in stride(from: 0, to: px.count, by: 4) { counts[(Int(px[i] >> 4) << 8) | (Int(px[i + 1] >> 4) << 4) | Int(px[i + 2] >> 4), default: 0] += 1 }
        return Double(counts.values.max() ?? 0) / Double(w * h) > 0.985
    }

    /// The whole page, top to bottom, as a PDF (what Safari's Full Page screenshot makes; Tim, 11-14): a chat
    /// shrinks a tall picture until it can't be read, a PDF keeps its detail. Not when it's over 10 MB (an
    /// endless feed).
    func fullPage() async -> Data? {
        guard let data = await Browser.within(15, nil, { try? await self.webView.pdf(configuration: WKPDFConfiguration()) }) else {
            report.log("claude", "no whole-page PDF (failed or over 15 seconds)")
            return nil
        }
        // (WebKit makes it one page as tall as the page, which a chat would shrink like a tall picture: cut into
        // pages a screen high, still drawn, not pictures, so its text stays sharp and readable)
        let paged = Browser.pages(of: data, height: max(webView.bounds.height, 600)) ?? data
        if paged.count > 10_000_000 { report.log("claude", "the whole-page PDF is \(paged.count / 1_000_000) MB, so not attached"); return nil }
        return paged
    }

    /// A one-page PDF cut into pages `height` high, top first.
    static func pages(of pdf: Data, height: CGFloat) -> Data? {
        guard let doc = PDFDocument(data: pdf), doc.pageCount == 1, let page = doc.page(at: 0) else { return nil }
        let box = page.bounds(for: .mediaBox)
        guard box.height > height * 1.2 else { return nil }
        let count = Int((box.height / height).rounded(.up))
        let size = CGRect(x: 0, y: 0, width: box.width, height: height)
        return UIGraphicsPDFRenderer(bounds: size).pdfData { r in
            for i in 0..<count {
                r.beginPage()
                let c = r.cgContext
                // (PDF space runs upward: page i shows the stretch from the top down i screens)
                c.saveGState()
                c.translateBy(x: 0, y: height)
                c.scaleBy(x: 1, y: -1)
                c.translateBy(x: -box.minX, y: -(box.maxY - height * CGFloat(i + 1)))
                c.clip(to: CGRect(x: box.minX, y: box.maxY - height * CGFloat(i + 1), width: box.width, height: height))
                page.draw(with: .mediaBox, to: c)
                c.restoreGState()
            }
        }
    }

    /// What's on the screen of the page, as PNG.
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

/// (Browser.within: whichever of an answer and its time limit comes first)
@MainActor final class OnceFlag { var done = false }
