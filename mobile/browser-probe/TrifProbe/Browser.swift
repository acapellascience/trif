// The probe's browser: its tabs (Tabs.swift), each a web view, with three places code can run beside a page.
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
    @Published var canGoForward = false
    /// The tabs, and the one shown (Tabs.swift). Everything below that says `webView` means the shown tab's.
    @Published private(set) var tabs: [Tab] = []
    @Published private(set) var current: Tab!
    /// The pages visited, in every tab (History.swift).
    let history = HistoryStore()
    /// What the shown page last said about its mods (ModsPanel: the Mods tab shows it at once, then asks again).
    var lastPageAnswer: (url: String, ran: Set<String>, errors: [String: [String]])?
    /// A hold that came from the chat opened the Mods tab: it closes again once that's decided.
    var holdFromChat = false
    /// Set when something wants the Mods tab open (a mod added that waits for an OK); the app opens it.
    @Published var wantsMods = false
    @Published var status = ""
    @Published var picked: Picked?
    /// The last thing hidden, while it can be undone (the status strip's Undo: Tim, 11-14, hid a whole page).
    @Published var lastHide: HideRule?
    /// Everywhere on <site>: its matches outlined on the page, waiting for Hide them.
    @Published var previewing = false
    /// Set when something asks for the chat to open; the app opens it.
    @Published var wantsChat = false
    /// Counts the times a mod came in and the chat should get out of the way, so the page with the mod shows
    /// (Tim, 11-15: "when the code is pasted, just hide the claude window"). The chat keeps its conversation.
    @Published var hideChat = 0
    /// The mods of a reply waiting for their Add this mod? (one sheet at a time), and where the one shown is in them.
    private var offerQueue: [InstalledMod] = []
    @Published private(set) var offerPlace: (n: Int, of: Int)?
    private var offerBatch = 0, offerShown = 0
    /// The last mod added from the chat, for what the chat is told next (feedbackForChat).
    private var lastAdded: (id: String, name: String)?
    @Published var modLink: ModLink?
    /// Whole mods (Mods.swift): those kept, and one from the clipboard waiting for an OK.
    let mods = ModStore()
    /// Safe mode, Pause all, a runaway page (Safety.swift).
    private(set) var safety: Safety!
    @Published var modOffer: InstalledMod?
    @Published var running = false
    /// Counts the shown tab's finished loads (and tab switches), for what follows the page (the Mods tab).
    @Published var pageChanged = 0

    var webView: WKWebView { current.webView }
    /// The one configuration every tab's web view is made from: the same scripts (the kit, the hide rules, the
    /// mods), the same message handler, the probe's pages, and the app's one cookie store.
    private let config: WKWebViewConfiguration
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
        self.config = config
        super.init()

        config.userContentController.addScriptMessageHandler(self, contentWorld: Browser.trifWorld, name: "trif")
        // (before any page: a launch after the app quit in front starts with those sites' mods switched off)
        safety = Safety(store: mods)
        NotificationCenter.default.addObserver(forName: .trifPauseAll, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.pauseAll(true) }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.memoryWarning() }
        }
        installScripts()
        restoreTabs()
    }

    // MARK: tabs

    /// A web view for a tab: from the shared configuration, or (a page opening a window) the one WebKit hands over.
    private func makeTab(configuration: WKWebViewConfiguration? = nil, id: UUID = UUID(), title: String = "", url: URL? = nil) -> Tab {
        let tab = Tab(id: id, webView: WKWebView(frame: .zero, configuration: configuration ?? config), title: title, url: url)
        attach(tab)
        return tab
    }

    /// Sets up a tab's web view: the app as its delegate, the long press, and watching its address and title.
    private func attach(_ tab: Tab) {
        let wv = tab.webView
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.allowsLinkPreview = false
        wv.isInspectable = true
        let press = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
        press.minimumPressDuration = 0.45
        press.delegate = self
        wv.addGestureRecognizer(press)
        // (an address or title that changes without a page load, as a single-page site's do: the tab and History follow)
        tab.watches = [
            wv.observe(\.url, options: [.new]) { [weak self, weak tab] w, _ in Task { @MainActor in
                guard let self, let tab, let u = w.url else { return }
                tab.url = u
                if tab === self.current { self.address = u.absoluteString; self.canGoBack = w.canGoBack; self.canGoForward = w.canGoForward }
                if !w.isLoading { self.history.visit(u, title: w.title ?? "") }
            } },
            wv.observe(\.title, options: [.new]) { [weak self, weak tab] w, _ in Task { @MainActor in
                guard let self, let tab else { return }
                tab.title = w.title ?? ""
                if tab === self.current { self.title = tab.title }
                self.history.retitle(w.url, tab.title)
            } },
        ]
    }

    /// A tab in the background lets its page go after a while (and at once when iOS warns of low memory): its address,
    /// back/forward list and picture are kept, and the page loads again when the tab is shown. A page left running
    /// behind kept using the phone (Tim, 11-15: an x.com tab with a busy mod, while he read Wikipedia).
    private var letGo: [UUID: Task<Void, Never>] = [:]
    private static let backgroundSeconds: UInt64 = 20
    private func letGoLater(_ tab: Tab) {
        letGo[tab.id]?.cancel()
        letGo[tab.id] = Task { @MainActor [weak self, weak tab] in
            try? await Task.sleep(nanoseconds: Browser.backgroundSeconds * 1_000_000_000)
            guard !Task.isCancelled, let self, let tab else { return }
            self.discard(tab)
        }
    }

    func discard(_ tab: Tab) {
        guard tab !== current, tab.started, tab.webView.url != nil else { return }
        tab.savedState = tab.webView.interactionState as? Data
        tab.savedURL = tab.webView.url
        tab.watches = []
        let old = tab.webView
        old.stopLoading()
        old.navigationDelegate = nil
        old.uiDelegate = nil
        old.removeFromSuperview()
        tab.replaceWebView(WKWebView(frame: .zero, configuration: config))
        attach(tab)
        tab.started = false
        Diagnostics.shared.log("tab", "let go of a background tab's page (\(Diagnostics.place(tab.savedURL))); it loads again when shown")
        noteRunning()
    }

    /// iOS warns the app of low memory: every background tab lets its page go now.
    func memoryWarning() {
        for t in tabs where t !== current { letGo[t.id]?.cancel(); discard(t) }
    }

    private func restoreTabs() {
        if let saved = SavedTabs.load(), !saved.tabs.isEmpty {
            tabs = saved.tabs.map { s in
                let t = makeTab(id: s.id, title: s.title, url: nil)
                t.savedState = s.state
                t.savedURL = s.url.flatMap(URL.init(string:))
                return t
            }
            select(tabs.first { $0.id == saved.selected } ?? tabs[tabs.count - 1])
        } else {
            let t = makeTab()
            tabs = [t]
            select(t)
            go(PageSchemeHandler.home + "plain.html")
        }
    }

    /// Keeps the tabs (and each one's back/forward list) for the next launch.
    func saveTabs() {
        let list = tabs.map { t in
            SavedTabs.One(id: t.id, url: (t.webView.url ?? t.savedURL)?.absoluteString, title: t.title,
                          state: t.started ? (t.webView.interactionState as? Data) : t.savedState)
        }
        SavedTabs(tabs: list, selected: current?.id).save()
    }

    /// Shows a tab: the first time, what was kept of it is loaded (its back/forward list, else its address).
    func select(_ tab: Tab) {
        defer { noteRunning() }
        letGo[tab.id]?.cancel()
        if let was = current, was !== tab { snapshot(was); letGoLater(was) }
        current = tab
        picked = nil; previewing = false; lastHide = nil; status = ""
        if !tab.started {
            tab.started = true
            if let state = tab.savedState { tab.webView.interactionState = state }
            else if let u = tab.savedURL { tab.webView.load(URLRequest(url: u)) }
            tab.savedState = nil
        }
        address = tab.webView.url?.absoluteString ?? tab.savedURL?.absoluteString ?? ""
        title = tab.webView.title ?? tab.title
        loading = tab.webView.isLoading
        canGoBack = tab.webView.canGoBack
        canGoForward = tab.webView.canGoForward
        pageChanged += 1
        saveTabs()
    }

    /// A new tab after the one shown: empty (the address bar's), or at an address.
    func newTab(_ address: String? = nil) {
        let t = makeTab()
        t.started = true
        let at = (tabs.firstIndex { $0 === current } ?? tabs.count - 1) + 1
        tabs.insert(t, at: at)
        select(t)
        if let address { go(address) } else { wantsAddress = true }
    }

    func close(_ tab: Tab) {
        guard let i = tabs.firstIndex(where: { $0 === tab }) else { return }
        tab.webView.stopLoading()
        tabs.remove(at: i)
        if tabs.isEmpty { let t = makeTab(); t.started = true; tabs = [t]; select(t); wantsAddress = true; return }
        if tab === current { select(tabs[min(i, tabs.count - 1)]) } else { saveTabs() }
    }

    /// The tab's picture for the switcher.
    func snapshot(_ tab: Tab? = nil) {
        let t = tab ?? current!
        guard t.webView.url != nil, t.webView.window != nil else { return }
        let cfg = WKSnapshotConfiguration()
        cfg.snapshotWidth = 300
        t.webView.takeSnapshot(with: cfg) { image, _ in if let image { t.snapshot = image } }
    }

    /// Set when a new tab wants its address typed; the app focuses the address bar.
    @Published var wantsAddress = false
    /// (development) a sheet to open (-open): mods, tabs, history or chat.
    @Published var wantsSheet = ""
    /// The site of the page shown, as the chat pane and the Mods tab group sites (Mods.swift Site.of).
    var site: String { Site.of(host) }

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
        let ucc = config.userContentController
        ucc.removeAllUserScripts()
        // (development) `-bare`: nothing of the app's in any page, to measure a page without it
        if ProcessInfo.processInfo.arguments.contains("-bare") { return }
        ucc.addUserScript(WKUserScript(source: Diagnostics.stallWatch, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        let kit = Browser.resource("kit", "js")
        let startOwn = Browser.resource("start-own", "js") + "(\(report.rulesJSON()));"
        let startPage = Browser.resource("start-page", "js")
        ucc.addUserScript(WKUserScript(source: kit, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        ucc.addUserScript(WKUserScript(source: startOwn, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        ucc.addUserScript(WKUserScript(source: startPage, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        for script in mods.userScripts() { ucc.addUserScript(script) }
    }

    // MARK: whole mods

    /// A mod the user added (from the chat or the clipboard: its Add it), or imported. One that needs an OK waits
    /// for it, with TRIF's approval card in the Mods tab, and doesn't run until then.
    func addMod(_ m: InstalledMod, source: String = "chat") {
        Diagnostics.shared.mark("adding \(m.id) (\(source))")
        hideChat += 1
        let added = mods.add(m, source: source)
        report.log("mods", "added \(added.tierName.lowercased()) \(added.id) (\(source))\(added.held ? ", waiting for an OK" : "")")
        modsChanged()
        if added.held {
            status = "\(added.name) waits for your OK."
            // (the approval card over the page instead of the chat: what there is to do now; after Allow, or Don't
            // allow, the Mods tab steps aside again and the page shows: ModsPanel.closeAfterDecision)
            holdFromChat = source != "import"
            // (after the Add this mod? sheet has gone: one sheet can't open while another is closing)
            Task { @MainActor in try? await Task.sleep(nanoseconds: 700_000_000); self.wantsMods = true }
        } else if source != "import" {
            status = "Added \(added.name). It runs on \(added.sites.joined(separator: ", "))."
        }
        if source == "chat" { lastAdded = (added.id, added.name) }
    }

    /// After any change to the mods: the scripts every page gets are made again, and the page reloads to run them.
    func modsChanged(reload again: Bool = true) {
        Diagnostics.shared.mark("making the pages' scripts again after a change to the mods")
        installScripts()
        if again { keepStatus = true; reload() }
        noteRunning()
    }

    /// Pause all mods, or resume them: every page loads again without (or with) them.
    func pauseAll(_ p: Bool) {
        if mods.paused != p { mods.setPaused(p) }
        installScripts()
        for t in tabs where t.started && t.webView.url != nil { t.webView.reload() }
        noteRunning()
    }

    /// Which mods are running in the tabs, by site, for safe mode (Safety.running).
    func noteRunning() {
        var bySite: [String: [String]] = [:]
        for t in tabs where t.started {
            guard let u = t.webView.url else { continue }
            let ids = mods.running(on: u.absoluteString).map(\.id)
            if !ids.isEmpty { bySite[Site.of(u.host ?? ""), default: []] += ids }
        }
        safety.running(bySite.mapValues { Array(Set($0)).sorted() })
    }

    /// Allow, on the approval card: it runs from this reload; one the chat made gets its follow-up, as when added.
    func approveMod(_ id: String) {
        mods.approve(id)
        report.log("mods", "allowed \(id)")
        modsChanged()
    }

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
    func forward() { picked = nil; webView.goForward() }

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

    /// The mod files in a reply that's just done (Web/chat.js): each read (off the main thread), and offered in turn
    /// with the Add this mod? sheet, over the tab; nothing is added without its Add it. Leaves out one already added
    /// as it is. Returns how many are offered (none: the chat button shows the reply waiting instead).
    func offerFromChat(_ texts: [String]) async -> Int {
        let here = host
        var found: [InstalledMod] = []
        var why: String?
        for t in texts {
            let r = await mods.readNamedInBackground(t, here: here)
            guard let m = r.mod else { why = why ?? r.error ?? "no reason given"; continue }
            if mods.mods.contains(where: { $0.id == m.id && $0.code == m.code }) || offerQueue.contains(where: { $0.id == m.id && $0.code == m.code }) { continue }
            found.removeAll { $0.id == m.id }
            found.append(m)
        }
        if found.isEmpty, let why { status = "The reply's mod can't be added: \(why)." }
        guard !found.isEmpty else { return 0 }
        if offerQueue.isEmpty && modOffer == nil { offerBatch = 0; offerShown = 0 }
        offerQueue += found
        offerBatch += found.count
        nextOffer()
        return found.count
    }

    /// The next of a reply's mods, once no other sheet is up (the app calls it again as each one closes).
    func nextOffer() {
        guard modOffer == nil, modLink == nil else { return }
        guard !offerQueue.isEmpty else { offerPlace = nil; return }
        offerShown += 1
        offerPlace = offerBatch > 1 ? (offerShown, offerBatch) : nil
        modOffer = offerQueue.removeFirst()
    }

    /// What was pasted (iOS's own Paste button hands it over without asking): a whole mod, a mod link, or a selector.
    func offer(text pasted: String?) {
        guard let text = pasted?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            status = "Nothing on the clipboard."
            return
        }
        // (a whole mod: a chat's reply with a ==WebMod== file in it, or the file)
        if text.contains("==WebMod==") {
            let here = host
            Task { @MainActor in
                let r = await mods.readNamedInBackground(text, here: here)
                if let m = r.mod { modOffer = m } else { status = "That mod can't be added: \(r.error ?? "no reason given")." }
            }
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

    /// What the chat gets for this page: how TRIF mods are written, then its outline. Notes its layout.
    func pageForChat() async -> String? {
        guard let o = await outline() else { return nil }
        if let l = (await call("return JSON.stringify(globalThis.__trifKit.layout());", in: Browser.trifWorld)).text { baseline = (host, l) }
        // (agent-facing words: what TRIF mods are and how to hand one over, then the page)
        let page = webView.url
        let origin = page.map { "\($0.scheme ?? "https")://\($0.host ?? "")" } ?? "https://\(host)"
        let here = await alreadyHere()
        let request = """
        I'm looking at \(page?.absoluteString ?? host) in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page: each line starts with a CSS selector for a part of it.

        I'll say what I want changed. Reply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod; a free mod only if it really needs the page's own code. Its @match must cover \(origin)/*; when I mean the whole site, match all of its subdomains too (for \(page?.host ?? host): https://*.\(Site.of(page?.host ?? host))/*), as a site's pages are often on several (en.wikipedia.org, not only www.wikipedia.org). In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet).

        A screenshot of what I see is attached. If I attach TRIF pointer files, those are the parts of the page I mean. Everything you need is in what I send: don't open the page in a browser, a connected computer or any other tool; work from these and answer straight away.

        --- How TRIF mods are written ---
        \(Browser.resource("mod-guide", "txt"))
        \(here)
        --- The page: \(page?.absoluteString ?? host) ---
        \(o.text)
        """
        report.log("outline", "\(host): \(o.chars) characters, about \(o.tokens) tokens, with the request (\(request.count) characters in all)")
        return request
    }

    /// What's already changing this page, for the chat to build on (Tim, 11-14): the mods switched on here, whole,
    /// their errors since the page loaded, and the things hidden by pointing. Empty when there's nothing.
    /// `except`: a mod left out (the one a follow-up is about, whose code the chat wrote).
    /// (Tim, 11-14: a theme mod's `background: … !important` hid Wikipedia's thumbnails; the chat, without the
    /// theme's code, patched over it with a free mod instead of fixing the theme.)
    func alreadyHere(except: String? = nil) async -> String {
        let here = webView.url?.absoluteString ?? ""
        let on = mods.running(on: here)
        let others = on.filter { $0.id != except }
        let hidden = report.rules.filter { $0.host == host }.map(\.selector)
        let errors = await modErrors(on)
        if others.isEmpty && hidden.isEmpty && errors.isEmpty { return "" }
        var t = "\n--- \(except == nil ? "Already changing this page (build on these)" : "Also changing this page") ---\n"
        if !others.isEmpty {
            t += "Mods switched on here. To change one, give back its whole file with the same @name (it replaces that mod); a new @name adds a mod beside them. If one of them is what's in the way, fix that one rather than adding a mod that works around it.\n"
            for m in others { t += "\n### \(m.name) (\(m.tierName.lowercased()))\n```js\n\(m.code)\n```\n" }
        }
        if !errors.isEmpty {
            t += "\nErrors from mods on this page since it loaded (some only happen once I type or click):\n\(errors.prefix(15).map { "- \($0)" }.joined(separator: "\n"))\n"
        }
        if !hidden.isEmpty {
            t += "\nHidden by me, by pointing (each of these is display: none; the outline doesn't have them):\n\(hidden.map { "- \($0)" }.joined(separator: "\n"))\n"
        }
        return t
    }

    /// Errors these mods have had on the page since it loaded: a boxed mod's (the sandbox's list, refusals
    /// included), a free mod's (what it threw). Each starts with the mod's name.
    func modErrors(_ list: [InstalledMod]) async -> [String] {
        let byId = await modErrorsById(list)
        return list.flatMap { m in (byId[m.id] ?? []).map { "\(m.name): \($0)" } }
    }

    /// The same, by mod: each one's messages.
    func modErrorsById(_ list: [InstalledMod]) async -> [String: [String]] {
        var out: [String: [String]] = [:]
        let boxed = list.filter { $0.world == "box" }.map(\.id)
        if !boxed.isEmpty, let t = (await call("return JSON.stringify(globalThis.__trifSandbox ? globalThis.__trifSandbox.errors.filter((e) => ids.includes(e.mod)).map((e) => [e.mod, e.message]) : []);", ["ids": boxed], in: Browser.boxWorld)).text,
           let rows = Browser.parse(t) as? [[String]] {
            for r in rows where r.count == 2 { out[r[0], default: []].append(r[1]) }
        }
        let free = list.filter { $0.world == "page" }
        if !free.isEmpty, let t = (await call("return JSON.stringify(window.__trifModErrors || []);", in: .page)).text, let rows = Browser.parse(t) as? [String] {
            for r in rows { if let m = free.first(where: { r.hasPrefix("\($0.id):") }) { out[m.id, default: []].append(String(r.dropFirst(m.id.count + 1)).trimmingCharacters(in: .whitespaces)) } }
        }
        return out
    }

    /// What a chat that already has TRIF's instructions gets when it's opened again (Tim, 11-15: "the feedback
    /// data if it's not [a new chat]"): the page as it is now (a screenshot and its outline), what disappeared
    /// or shrank since it was last sent, the mods running here with their code and errors, and the things hidden.
    /// (Agent-facing words.)
    func feedbackForChat() async -> (text: String, png: Data?)? {
        // (once a page that's loading has finished: just after a mod is added, it's reloading)
        for _ in 0..<40 where loading { try? await Task.sleep(nanoseconds: 250_000_000) }
        guard let o = await outline() else { return nil }
        let page = webView.url?.absoluteString ?? host
        var lines: [String] = []
        if let b = baseline, b.host == host, let r = (await call("return JSON.stringify(globalThis.__trifKit.compare(JSON.parse(before)));", ["before": b.layout], in: Browser.trifWorld)).text,
           let changed = Browser.parse(r) as? [[String: Any]] {
            for c in changed.prefix(25) {
                let text = (c["text"] as? String).map { $0.isEmpty ? "" : " “\($0)”" } ?? ""
                lines.append("- \(c["what"] as? String ?? "changed"): \(c["sel"] as? String ?? "?")\(text) (was \(c["was"] as? String ?? "?"), now \(c["now"] as? String ?? "gone"))")
            }
        }
        if let l = (await call("return JSON.stringify(globalThis.__trifKit.layout());", in: Browser.trifWorld)).text { baseline = (host, l) }
        let on = mods.running(on: webView.url?.absoluteString ?? "")
        var text = "Here's \(page) in TRIF now: a screenshot of what's on the screen is attached, and the page's outline is below."
        if let a = lastAdded, on.contains(where: { $0.id == a.id }) { text += " I added your mod \"\(a.name)\"; the page was reloaded with it."; lastAdded = nil }
        text += "\n"
        if !lines.isEmpty {
            text += "\nWhat disappeared or shrank since I last sent you this page:\n\(lines.joined(separator: "\n"))\n(The page may have been reloaded since, so anything that opens when I type or click, like a menu, is closed now: some of these may be closed, not gone.)\n"
        }
        let here = await alreadyHere()
        text += here.isEmpty ? "\nNo TRIF mods are running on this page, and nothing on it is hidden.\n" : here
        text += "\nI'll say what I want changed. As before: reply with the whole mod file in one code block, nothing to fill in; to change a mod above, give back its whole file with the same @name. Work from what I've attached; don't open the page in a browser or another tool.\n"
        text += "\n--- The page now: \(page) ---\n\(o.text)\n"
        let (shot, blank) = await settledScreenshot()
        if blank { text += "\n(The screenshot looked blank even after waiting: the page may not have finished drawing.)" }
        report.log("outline", "\(host): the follow-up, \(text.count) characters")
        return (text, shot)
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
        // (not for a page more than twelve screens tall, an endless feed say: its PDF is big to make and to hold, and
        // a chat reads the screenshot anyway. 11-15: the app's memory grew by 600 MB on Tim's phone)
        let tall = Double((await call("return String(document.documentElement.scrollHeight);", in: Browser.trifWorld)).text ?? "") ?? 0
        if tall > Double(max(webView.bounds.height, 500)) * 12 {
            report.log("claude", "no whole-page PDF: the page is \(Int(tall)) px tall")
            return nil
        }
        guard let data = await Browser.within(15, nil, { try? await self.webView.pdf(configuration: WKPDFConfiguration()) }) else {
            report.log("claude", "no whole-page PDF (failed or over 15 seconds)")
            return nil
        }
        // (WebKit makes it one page as tall as the page, which a chat would shrink like a tall picture: cut into
        // pages a screen high, still drawn, not pictures, so its text stays sharp and readable)
        // (cut into pages off the main thread: a long page's PDF drawn page by page held the app up)
        let height = max(webView.bounds.height, 600)
        Diagnostics.shared.mark("cutting the page's PDF into pages")
        let paged = await Task.detached(priority: .userInitiated) { Browser.pages(of: data, height: height) ?? data }.value
        if paged.count > 10_000_000 { report.log("claude", "the whole-page PDF is \(paged.count / 1_000_000) MB, so not attached"); return nil }
        return paged
    }

    /// A one-page PDF cut into pages `height` high, top first.
    nonisolated static func pages(of pdf: Data, height: CGFloat) -> Data? {
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
        let image: UIImage? = await withCheckedContinuation { c in
            webView.takeSnapshot(with: nil) { image, _ in c.resume(returning: image) }
        }
        guard let image else { return nil }
        // (the PNG made off the main thread)
        return await Task.detached(priority: .userInitiated) { image.pngData() }.value
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
        case "stalls":
            let busy = (body["busy"] as? NSNumber)?.intValue ?? 0, longest = (body["longest"] as? NSNumber)?.intValue ?? 0
            let url = message.webView?.url
            let running = mods.running(on: url?.absoluteString ?? "")
            Diagnostics.shared.log("busy", "\(Diagnostics.place(url)): its main thread was busy \(busy)% of the last 10 s (longest stall \(longest) ms), \((body["elements"] as? NSNumber)?.intValue ?? 0) elements, \(running.map(\.id).joined(separator: ", ").nonEmpty ?? "no mods")")
            safety.busy(site: Site.of(url?.host ?? ""), percent: busy, mods: running)
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

    private func tab(of webView: WKWebView) -> Tab? { tabs.first { $0.webView === webView } }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        tab(of: webView)?.loading = true
        guard webView === self.webView else { return }
        loading = true
        // (a reload the app made to run changed mods keeps what the status strip says about the change)
        if keepStatus { keepStatus = false } else { status = "" }
    }
    private var keepStatus = false

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        tab(of: webView)?.url = webView.url
        guard webView === self.webView else { return }
        address = webView.url?.absoluteString ?? ""
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        picked = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Diagnostics.shared.log("page", "\(Diagnostics.place(webView.url)) loaded, with \(mods.running(on: webView.url?.absoluteString ?? "").map(\.id).joined(separator: ", ").nonEmpty ?? "no mods")")
        if let t = tab(of: webView) { t.loading = false; t.title = webView.title ?? t.title }
        history.visit(webView.url, title: webView.title ?? "")
        saveTabs()
        noteRunning()
        guard webView === self.webView else { return }
        loading = false
        title = webView.title ?? ""
        address = webView.url?.absoluteString ?? ""
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        pageChanged += 1
        resumeLoadWaiters()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        tab(of: webView)?.loading = false
        guard webView === self.webView else { return }
        loading = false
        status = error.localizedDescription
        resumeLoadWaiters()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        tab(of: webView)?.loading = false
        guard webView === self.webView else { return }
        loading = false
        if (error as NSError).code != NSURLErrorCancelled { status = error.localizedDescription }
        resumeLoadWaiters()
    }

    /// A link or page that opens a window: a new tab after this one (made from the configuration WebKit hands over,
    /// so the page that opened it can still talk to it, as a sign-in window needs).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let link = Browser.modLink(url, source: "the page") { offer(link); return nil }
        let t = makeTab(configuration: configuration)
        t.started = true
        let at = (tabs.firstIndex { $0.webView === webView } ?? tabs.count - 1) + 1
        tabs.insert(t, at: at)
        select(t)
        return t.webView
    }

    /// WebKit ended a page's process (memory, most often: a long timeline): the page goes black. The tab loads it
    /// again, and the diagnostics log says so, with the mods that were running there.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let url = webView.url
        let on = mods.running(on: url?.absoluteString ?? "").map(\.id)
        Diagnostics.shared.log("ended", "WebKit ended the page's process (a black page) at \(Diagnostics.place(url)), \(webView === self.webView ? "the tab shown" : "a tab behind"), with \(on.isEmpty ? "no mods" : on.joined(separator: ", ")); \(Diagnostics.freeMB()) MB left for the app. Loading it again.")
        report.log("load", "process ended: \(Diagnostics.place(url))")
        if webView === self.webView { status = "This page stopped (iPhone ended it, often for memory), so it was loaded again." }
        safety.ended(site: Site.of(url?.host ?? ""), mods: mods.running(on: url?.absoluteString ?? ""))
        if url != nil { webView.reload() }
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let t = tab(of: webView) { close(t) }
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
