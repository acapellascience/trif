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
import AVFoundation

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
    /// Full screen (Tim, 11-16): a tab's page with no browser around it (no address bar, toolbar or tabs), as an app.
    /// Each tab's own: two fingers held on the page switch it, either way, any time; the ⋯ menu's Full screen too; a
    /// Home Screen icon's tab starts in it. Remembered by tab (its id), across launches.
    @Published private(set) var fullScreenTabs: Set<UUID> = Set((UserDefaults.standard.stringArray(forKey: "fullScreenTabs") ?? []).compactMap(UUID.init(uuidString:)))
    var fullScreen: Bool { current.map { fullScreenTabs.contains($0.id) } ?? false }
    /// Full screen on or off for a tab (the shown one by default); `note`: say so in a note that fades.
    func setFullScreen(_ on: Bool, tab: Tab? = nil, note: Bool = true) {
        guard let t = tab ?? current, fullScreenTabs.contains(t.id) != on else { return }
        if on { fullScreenTabs.insert(t.id) } else { fullScreenTabs.remove(t.id) }
        UserDefaults.standard.set(fullScreenTabs.map(\.uuidString), forKey: "fullScreenTabs")
        report.log("fullscreen", "\(on ? "full screen" : "TRIF view") for the tab on \(Site.of(t.host).isEmpty ? "no site" : Site.of(t.host))")
        guard t === current else { return }
        if on { wakeExit(long: true) }
        // (the first time in full screen, wherever it came from: how to get out, once; Tim, 11-16)
        if on, !UserDefaults.standard.bool(forKey: "fullScreenHinted") {
            UserDefaults.standard.set(true, forKey: "fullScreenHinted")
            status = Browser.fullScreenHint
        } else if note { status = on ? "Switched to full screen" : "Switched to TRIF view" }
    }
    static let fullScreenHint = "Hold two fingers on the page to switch views"
    /// Full screen's way out, the small button at the top right, comes up bright for a moment (counted): on entering
    /// full screen, the page scrolled back up, the app back in front.
    @Published private(set) var exitWake = 0
    /// The last wake-up is entering full screen (3 s bright), not a scroll or a return (a moment).
    private(set) var exitWakeLong = false
    func wakeExit(long: Bool = false) { exitWakeLong = long; exitWake += 1 }
    func toggleFullScreen() { setFullScreen(!fullScreen) }
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
    var offerQueue: [InstalledMod] = []
    @Published private(set) var offerPlace: (n: Int, of: Int)?
    var offerBatch = 0, offerShown = 0
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
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if let self { BackgroundPlay.resume(self) } }
        }
        installScripts()
        ModDownloads.shared.browser = self
        FolderWatch.shared.browser = self
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
        // (full screen and back: two fingers held still on the page; pages don't use it, and it never blocks them. A
        // pinch moves too far, a two-finger tap is too short)
        let two = UILongPressGestureRecognizer(target: self, action: #selector(twoFingerPress(_:)))
        two.numberOfTouchesRequired = 2
        two.minimumPressDuration = 0.6
        two.allowableMovement = 24
        two.delegate = self
        wv.addGestureRecognizer(two)
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

    /// A tab in the background lets its page go after a while (and when iOS warns of low memory): its address,
    /// back/forward list and picture are kept, and the page loads again when the tab is shown. A page left running
    /// behind kept using the phone (Tim, 11-15: an x.com tab with a busy mod, while he read Wikipedia).
    /// A tab playing sound or a video is kept, as Safari keeps one (Tim, 11-16: a YouTube video with his Background
    /// Play mod stopped about 20 s after he switched tabs): it's let go once it has been paused or stopped that long.
    private var letGo: [UUID: Task<Void, Never>] = [:]
    static let backgroundSeconds: Double = 20
    /// How often a kept, playing tab is looked at again.
    static let playingCheckSeconds: Double = 5
    private func letGoLater(_ tab: Tab) {
        letGo[tab.id]?.cancel()
        letGo[tab.id] = Task { @MainActor [weak self, weak tab] in
            var wait = Browser.backgroundSeconds, kept = false, quietSince = Date()
            while true {
                // (nothing held while waiting: a closed tab's web view goes, and its sound with it)
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                wait = Browser.playingCheckSeconds
                guard !Task.isCancelled, let self, let tab, tab !== self.current, self.tabs.contains(where: { $0 === tab }) else { return }
                if await Browser.playing(tab) {
                    if !kept { Diagnostics.shared.log("tab", "kept a background tab's page: it's playing (\(Diagnostics.place(tab.webView.url))); let go once it has stopped \(Int(Browser.backgroundSeconds)) s") }
                    kept = true; quietSince = Date()
                } else if !kept || Date().timeIntervalSince(quietSince) >= Browser.backgroundSeconds {
                    guard !Task.isCancelled, tab !== self.current else { return }
                    self.discard(tab, kept ? "it stopped playing \(Int(Date().timeIntervalSince(quietSince))) s ago" : nil)
                    return
                }
            }
        }
    }

    /// A tab's page is playing sound (or a video with sound): WebKit says so, and the page agrees. WebKit's answer
    /// alone isn't the page's (11-16, the Simulator): it's the whole web process's, so a same-site tab that never
    /// played says "playing" while another plays, and media WebKit paused itself (the app in the background) stays
    /// "playing". So the page is asked too, in TRIF's world: a video or audio playing, not muted (a muted feed video
    /// doesn't keep a tab), or a frame it could be in. A page that doesn't answer within a second (busy, or its
    /// process gone) counts as not playing.
    static func playing(_ tab: Tab) async -> Bool {
        guard tab.started, tab.webView.url != nil else { return false }
        let wv = tab.webView
        return await Browser.within(1, false) {
            guard await wv.requestMediaPlaybackState() == .playing else { return false }
            let page = try? await wv.callAsyncJavaScript(Browser.pagePlaying, arguments: [:], in: nil, contentWorld: Browser.trifWorld)
            return (page as? String).map { $0 != "no" } ?? false
        }
    }
    static let pagePlaying = """
        if ([...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && !m.muted)) return 'playing';
        return document.querySelector('iframe') ? 'in a frame, maybe' : 'no';
        """

    func discard(_ tab: Tab, _ why: String? = nil) {
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
        Diagnostics.shared.log("tab", "let go of a background tab's page (\(Diagnostics.place(tab.savedURL)))\(why.map { ": \($0)" } ?? ""); it loads again when shown")
        noteRunning()
    }

    /// iOS warns the app of low memory: every background tab lets its page go now, except one that's playing (it
    /// goes on being looked at, and is let go once it has stopped).
    func memoryWarning() {
        let others = tabs.filter { $0 !== current && $0.started && $0.webView.url != nil }
        guard !others.isEmpty else { return }
        Task { @MainActor in
            // (all asked at once: a second at most)
            let asks = others.map { t in Task { @MainActor in await Browser.playing(t) } }
            var playing: [Tab] = []
            for (t, ask) in zip(others, asks) where await ask.value { playing.append(t) }
            for t in others where !playing.contains(where: { $0 === t }) && t !== current { letGo[t.id]?.cancel(); discard(t, "low memory") }
            // (its let-go wait, from when it was left, goes on looking at it)
            for t in playing where t !== current {
                Diagnostics.shared.log("tab", "low memory: kept a background tab's page, it's playing (\(Diagnostics.place(t.webView.url))); \(others.count == playing.count ? "no other to let go" : "\(others.count - playing.count) other\(others.count - playing.count == 1 ? "" : "s") let go")")
            }
        }
    }

    /// A launch that isn't in front yet (iOS prewarming the app, a launch in the background) loads no page: the tabs
    /// are restored, and the shown one loads once the app first comes to the front, as Safari's and Chrome's do.
    /// (11-16: a page loaded in such a launch, then the launch ended by an installer, left a site's rotated sign-in
    /// cookie not yet on disk.)
    private var waitingForFront = true
    private let launchedAt = Date()
    private func cameToFront() {
        if fullScreen { wakeExit() }
        guard waitingForFront else { return }
        waitingForFront = false
        let waited = Date().timeIntervalSince(launchedAt)
        if waited > 2 { Diagnostics.shared.log("launch", "the app was launched without being in front (prewarmed, or in the background) \(Int(waited)) s before it came to the front; no page loaded until then") }
        if let t = current, !t.started { start(t); loading = t.webView.isLoading }
    }

    private func restoreTabs() {
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.cameToFront() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if self?.waitingForFront == true { Diagnostics.shared.log("launch", "the app went to the background before it ever came to the front: no page loaded") } }
        }
        if UIApplication.shared.applicationState == .active { waitingForFront = false }
        if let saved = SavedTabs.load(), !saved.tabs.isEmpty {
            tabs = saved.tabs.map { s in
                let t = makeTab(id: s.id, title: s.title, url: nil)
                t.savedState = s.state
                t.savedURL = s.url.flatMap(URL.init(string:))
                TabShots.shared.load(t) // (its last picture, from the last launch: Tabs.swift)
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
        if let was = current, was !== tab { TabShots.shared.take(was, "left"); letGoLater(was) }
        current = tab
        picked = nil; previewing = false; lastHide = nil; status = ""
        if !tab.started && !waitingForFront { start(tab) }
        address = tab.webView.url?.absoluteString ?? tab.savedURL?.absoluteString ?? ""
        title = tab.webView.title ?? tab.title
        loading = tab.webView.isLoading
        canGoBack = tab.webView.canGoBack
        canGoForward = tab.webView.canGoForward
        pageChanged += 1
        saveTabs()
    }

    /// A tab's page, the first time it's shown: what was kept of it (its back/forward list, else its address).
    private func start(_ tab: Tab) {
        tab.started = true
        if let state = tab.savedState { tab.webView.interactionState = state }
        else if let u = tab.savedURL { tab.webView.load(URLRequest(url: u)) }
        tab.savedState = nil
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
        letGo[tab.id]?.cancel(); letGo[tab.id] = nil
        tab.webView.stopLoading()
        tabs.remove(at: i)
        TabShots.shared.remove(tab.id)
        setFullScreen(false, tab: tab, note: false)
        if tabs.isEmpty { let t = makeTab(); t.started = true; tabs = [t]; select(t); wantsAddress = true; return }
        if tab === current { select(tabs[min(i, tabs.count - 1)]) } else { saveTabs() }
    }

    /// The tab's picture for the switcher (TabShots: kept on disk too). Taken as a tab is left, when the app goes to
    /// the background, when the switcher opens, and a moment after a page has loaded.
    func snapshot(_ tab: Tab? = nil, _ why: String = "the tabs opened") {
        guard let t = tab ?? current else { return }
        TabShots.shared.take(t, why)
    }
    /// After the shown tab's page loads: its picture a second later (once it has drawn), at most every 3 s.
    private var shotLater: Task<Void, Never>?
    private func snapshotSoon() {
        guard shotLater == nil, let t = current else { return }
        shotLater = Task { @MainActor [weak self, weak t] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let t, t === self?.current { TabShots.shared.take(t, "loaded") }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            self?.shotLater = nil
        }
    }

    /// Set when a new tab wants its address typed; the app focuses the address bar.
    @Published var wantsAddress = false
    /// (development) a sheet to open (-open): mods, tabs, history or chat.
    @Published var wantsSheet = ""
    /// The site of the page shown, as the chat pane and the Mods tab group sites (Mods.swift Site.of).
    var site: String { Site.of(host) }

    // MARK: resources and scripts

    /// A file of the app's, read once and kept (11-16: the pages' scripts are made again at each change to the mods,
    /// and read SES and the sandbox, about 400 KB, from disk each time).
    static func resource(_ name: String, _ ext: String) -> String {
        let key = "\(name).\(ext)"
        if let t = resourceCache[key] { return t }
        guard let url = Bundle.main.url(forResource: name, withExtension: ext), let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "throw new Error('the app is missing \(name).\(ext)');"
        }
        resourceCache[key] = text
        return text
    }
    private static var resourceCache: [String: String] = [:]

    /// The scripts every page gets at its start. Put in again whenever the hide rules change: the rules are
    /// part of the start script's own text, so a page never waits for them.
    func installScripts() {
        let ucc = config.userContentController
        ucc.removeAllUserScripts()
        // (development) `-bare`: nothing of the app's in any page, to measure a page without it
        if ProcessInfo.processInfo.arguments.contains("-bare") { return }
        ucc.addUserScript(WKUserScript(source: Diagnostics.stallWatch, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
        ucc.addUserScript(WKUserScript(source: BackgroundPlay.watch, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld))
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
        guard let url = Browser.address(for: text) else { status = "That isn't an address."; return }
        picked = nil
        // (a tab not started yet, waiting for the app to come to the front: this is its page now, not what was kept)
        if let t = current, !t.started { t.started = true; t.savedState = nil }
        webView.load(URLRequest(url: url))
    }

    /// What the address field's text means (Tim, 11-15, as Chrome): a search on Google when it has a space, or no dot
    /// and isn't localhost or an IP address; otherwise an address, https:// added when it has no scheme (http:// for
    /// localhost). What's typed goes to Google only then, at Go: nothing is looked up while typing.
    nonisolated static func address(for text: String) -> URL? {
        let entry = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if entry.isEmpty { return nil }
        let lower = entry.lowercased()
        if lower.range(of: "^[a-z][a-z0-9+.-]*://", options: .regularExpression) != nil { return URL(string: entry) }
        if ["about:", "data:", "trifprobe:"].contains(where: { lower.hasPrefix($0) }) { return URL(string: entry) }
        let hostPart = String(lower.split(separator: "/", maxSplits: 1).first ?? "")
        let host = hostPart.replacingOccurrences(of: ":\\d+$", with: "", options: .regularExpression)
        let local = host == "localhost" || host.hasSuffix(".localhost")
        let ip = host.range(of: "^\\d{1,3}(\\.\\d{1,3}){3}$", options: .regularExpression) != nil || host.hasPrefix("[")
        if entry.contains(" ") || (!entry.contains(".") && !local && !ip) {
            var allowed = CharacterSet.urlQueryAllowed
            allowed.remove(charactersIn: "+&=#?/")
            return URL(string: "https://www.google.com/search?q=" + (entry.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""))
        }
        return URL(string: (local ? "http://" : "https://") + entry)
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
    /// as it is. Returns those offered (none: the chat button shows the reply waiting instead).
    @discardableResult
    func offerFromChat(_ texts: [String], from chatSite: String = "") async -> [InstalledMod] {
        let here = host
        // (where it came from: the chat's site, else the page shown; Add this mod? warns when it runs elsewhere)
        let came = chatSite.isEmpty ? Site.of(here) : Site.of(chatSite)
        var found: [InstalledMod] = []
        var why: String?
        for t in texts {
            let r = await mods.readNamedInBackground(t, here: here)
            guard var m = r.mod else { why = why ?? r.error ?? "no reason given"; continue }
            if mods.mods.contains(where: { $0.id == m.id && $0.code == m.code }) || offerQueue.contains(where: { $0.id == m.id && $0.code == m.code }) { continue }
            m.cameFrom = came
            found.removeAll { $0.id == m.id }
            found.append(m)
        }
        if found.isEmpty, let why { status = "The reply's mod can't be added: \(why)." }
        guard !found.isEmpty else { return [] }
        if offerQueue.isEmpty && modOffer == nil { offerBatch = 0; offerShown = 0 }
        offerQueue += found
        offerBatch += found.count
        nextOffer()
        return found
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
                if var m = r.mod { m.cameFrom = Site.of(here); modOffer = m } else { status = "That mod can't be added: \(r.error ?? "no reason given")." }
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

    /// Where each finger of a two-finger touch came down: a hold counts only if neither has moved since (a pinch keeps
    /// its centre still, which is all the long press itself measures: Simulator 11-16, a pinch switched views).
    private var twoStart: [(touch: UITouch, at: CGPoint)] = []
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if let p = g as? UILongPressGestureRecognizer, p.numberOfTouchesRequired == 2, let v = g.view {
            twoStart.removeAll { $0.touch.phase == .ended || $0.touch.phase == .cancelled || $0.touch === touch }
            twoStart.append((touch, touch.location(in: v)))
        }
        return true
    }
    /// The fingers of a two-finger hold are each still near where they came down.
    private func stillHolding(_ press: UILongPressGestureRecognizer) -> Bool {
        guard let v = press.view, twoStart.count >= 2, press.numberOfTouches >= 2 else { return false }
        return (0..<press.numberOfTouches).allSatisfy { i in
            let now = press.location(ofTouch: i, in: v)
            return twoStart.contains { hypot($0.at.x - now.x, $0.at.y - now.y) < 24 }
        }
    }

    @objc private func twoFingerPress(_ press: UILongPressGestureRecognizer) {
        // (the fingers lifting can read to the page as a tap on whatever was under them: a link tapped from then until
        // a moment after is let go, Simulator 11-16, X's "Get the app")
        if press.state == .began || press.state == .ended || press.state == .cancelled {
            ignoreLinksUntil = Date().addingTimeInterval(0.8)
            // (and a click the page handles itself, not a link: let go too, for the same moment, from TRIF's world)
            Task { _ = await call(Browser.clickGuard, in: Browser.trifWorld) }
        }
        guard press.state == .began, stillHolding(press) else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        toggleFullScreen()
    }
    private var ignoreLinksUntil = Date.distantPast
    static let clickGuard = """
    if (!window.__trifClickGuard) {
      window.__trifClickGuard = true;
      window.addEventListener('click', (e) => { if (Date.now() < (window.__trifNoClickUntil || 0)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    }
    window.__trifNoClickUntil = Date.now() + 800;
    return 'ok';
    """

    @objc private func longPressed(_ press: UILongPressGestureRecognizer) {
        // (no pointing at parts of the page in full screen; and not with two fingers down: that's full screen's hold)
        guard press.state == .began, !fullScreen, press.numberOfTouches < 2 else { return }
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

    /// `budgetMs`: the walk stops after that long (a big page's whole walk took seconds on an iPhone SE), and the
    /// outline then says it's partial (agent-facing words).
    func outline(_ maxChars: Int = 6000, budgetMs: Int = 300) async -> (text: String, chars: Int, tokens: Int)? {
        let result = await call("return JSON.stringify(globalThis.__trifKit.outline(max, budget));", ["max": maxChars, "budget": budgetMs], in: Browser.trifWorld)
        guard let o = Browser.parse(result.text) as? [String: Any], var text = o["text"] as? String else {
            status = "No outline: \(result.error ?? "the page has no kit")"
            return nil
        }
        if o["partial"] as? Bool == true { text += "\n(Partial: the page is big, so TRIF stopped outlining it after \(budgetMs) ms. The screenshot shows what's on the screen.)" }
        return (text, o["chars"] as? Int ?? text.count, o["tokens"] as? Int ?? 0)
    }

    func copyOutline() async {
        guard let request = await pageForChat() else { return }
        await noteBaseline()
        UIPasteboard.general.string = request
        status = "Copied: the page and how to write a mod for it. Paste it into the chat and say what you want changed; then copy the reply and Add a mod from the clipboard."
    }

    // MARK: the chat, both ways (Tim, 11-13)

    /// The page's parts and sizes when it was last sent to the chat, to say afterwards what a mod did.
    private var baseline: (host: String, layout: String)?

    /// What the chat gets for this page: how TRIF mods are written, then its outline. Notes its layout.
    func pageForChat(conv: String? = nil, _ sw: Stopwatch? = nil, guideInProject: Bool = false) async -> String? {
        guard let o = await outline() else { return nil }
        sw?.lap("outline", "\(o.chars) chars")
        // (agent-facing words: what TRIF mods are and how to hand one over, then the page)
        let page = webView.url
        let origin = page.map { "\($0.scheme ?? "https")://\($0.host ?? "")" } ?? "https://\(host)"
        let here = await alreadyHere(conv: conv)
        sw?.lap("mods and their errors")
        // (a chat in the person's TRIF project, whose instructions have how TRIF mods are written: the page only)
        if guideInProject {
            let r = """
            I'm looking at \(page?.absoluteString ?? host) in TRIF (how TRIF mods are written is in this project's instructions). Its @match must cover \(origin)/*; for the whole site, all of its subdomains too (https://*.\(Site.of(page?.host ?? host))/*). A screenshot is attached; below is an outline of the page, each line starting with a CSS selector.
            \(here)
            --- The page: \(page?.absoluteString ?? host) ---
            \(o.text)
            """
            report.log("outline", "\(host): \(o.chars) characters, for a chat in TRIF's project (\(r.count) characters in all, without the guide)")
            return r
        }
        let request = """
        I'm looking at \(page?.absoluteString ?? host) in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page: each line starts with a CSS selector for a part of it.

        I'll say what I want changed. Reply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod; a free mod only if it really needs the page's own code. Always in a code block in the reply, however long, not as an attached file. Its @match must cover \(origin)/*; when I mean the whole site, match all of its subdomains too (for \(page?.host ?? host): https://*.\(Site.of(page?.host ?? host))/*), as a site's pages are often on several (en.wikipedia.org, not only www.wikipedia.org). In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet).

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
    /// `conv`: the conversation it's for. A mod whose code that conversation already has (sent before, or written
    /// in it) is named, not given again (11-15: only what changed since the last send).
    func alreadyHere(except: String? = nil, conv: String? = nil) async -> String {
        let here = webView.url?.absoluteString ?? ""
        let on = mods.running(on: here)
        let others = on.filter { $0.id != except }
        let hidden = report.rules.filter { $0.host == host }.map(\.selector)
        let errors = await modErrors(on)
        if others.isEmpty && hidden.isEmpty && errors.isEmpty { return "" }
        var t = "\n--- \(except == nil ? "Already changing this page (build on these)" : "Also changing this page") ---\n"
        if !others.isEmpty {
            t += "Mods switched on here. To change one, give back its whole file with the same @name (it replaces that mod); a new @name adds a mod beside them. If one of them is what's in the way, fix that one rather than adding a mod that works around it.\n"
            for m in others {
                if let conv, chatHas(m, conv) { t += "\n### \(m.name) (\(m.tierName.lowercased())): unchanged since you last saw its code in this chat\n"; continue }
                t += "\n### \(m.name) (\(m.tierName.lowercased()))\n```js\n\(m.code)\n```\n"
                if let conv { noteChatHas(m.code, conv) }
            }
        }
        if !errors.isEmpty {
            t += "\nErrors from mods on this page since it loaded (some only happen once I type or click):\n\(errors.prefix(15).map { "- \($0)" }.joined(separator: "\n"))\n"
        }
        if !hidden.isEmpty {
            t += "\nHidden by me, by pointing (each of these is display: none; the outline doesn't have them):\n\(hidden.map { "- \($0)" }.joined(separator: "\n"))\n"
        }
        return t
    }

    /// The page's parts and sizes now, to say next time what disappeared since (once the chat has its text: it
    /// isn't needed for this one).
    func noteBaseline() async {
        if let l = (await call("return JSON.stringify(globalThis.__trifKit.layout(300, 250));", in: Browser.trifWorld)).text { baseline = (host, l) }
    }

    /// The mods' code each conversation has (by a hash of the code): sent to it, or written in it.
    private var codeInChat: [String: Set<Int>] = [:]
    nonisolated static func codeHash(_ code: String) -> Int {
        var h: UInt64 = 0xcbf29ce484222325
        for b in code.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return Int(truncatingIfNeeded: h)
    }
    func chatHas(_ m: InstalledMod, _ conv: String) -> Bool { codeInChat[conv]?.contains(Browser.codeHash(m.code)) == true }
    func noteChatHas(_ code: String, _ conv: String) { codeInChat[conv, default: []].insert(Browser.codeHash(code)) }

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
    func feedbackForChat(conv: String? = nil, _ sw: Stopwatch? = nil) async -> String? {
        // (a page still loading, just after a mod was added say: a second at most, then what's there; this used to
        // wait up to 10 s, and a page that never stops loading, Instagram's, always took them)
        for _ in 0..<5 where loading { try? await Task.sleep(nanoseconds: 200_000_000) }
        sw?.lap("waited for the page to load")
        guard let o = await outline() else { return nil }
        sw?.lap("outline", "\(o.chars) chars")
        let page = webView.url?.absoluteString ?? host
        var lines: [String] = []
        if let b = baseline, b.host == host, let r = (await call("return JSON.stringify(globalThis.__trifKit.compare(JSON.parse(before), 200));", ["before": b.layout], in: Browser.trifWorld)).text,
           let changed = Browser.parse(r) as? [[String: Any]] {
            for c in changed.prefix(25) {
                let text = (c["text"] as? String).map { $0.isEmpty ? "" : " “\($0)”" } ?? ""
                lines.append("- \(c["what"] as? String ?? "changed"): \(c["sel"] as? String ?? "?")\(text) (was \(c["was"] as? String ?? "?"), now \(c["now"] as? String ?? "gone"))")
            }
        }
        sw?.lap("what changed since last sent")
        let on = mods.running(on: webView.url?.absoluteString ?? "")
        var text = "Here's \(page) in TRIF now: a screenshot of what's on the screen is attached, and the page's outline is below."
        if let a = lastAdded, on.contains(where: { $0.id == a.id }) { text += " I added your mod \"\(a.name)\"; the page was reloaded with it."; lastAdded = nil }
        text += "\n"
        if !lines.isEmpty {
            text += "\nWhat disappeared or shrank since I last sent you this page:\n\(lines.joined(separator: "\n"))\n(The page may have been reloaded since, so anything that opens when I type or click, like a menu, is closed now: some of these may be closed, not gone.)\n"
        }
        let here = await alreadyHere(conv: conv)
        sw?.lap("mods and their errors", "\(on.count) mods")
        text += here.isEmpty ? "\nNo TRIF mods are running on this page, and nothing on it is hidden.\n" : here
        text += "\nI'll say what I want changed. As before: reply with the whole mod file in one code block, nothing to fill in, never as an attached file; to change a mod above, give back its whole file with the same @name. Work from what I've attached; don't open the page in a browser or another tool.\n"
        text += "\n--- The page now: \(page) ---\n\(o.text)\n"
        report.log("outline", "\(host): the follow-up, \(text.count) characters")
        return text
    }

    /// What's on the screen of the tab, quickly (11-15: a settled, full-resolution PNG took 6 s on a busy page): one
    /// snapshot as it is now, at most 2x and the screen's width, as a JPEG, made off the main thread.
    func quickScreenshot() async -> Data? {
        guard webView.url != nil else { return nil }
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = false
        let wv = webView
        let image: UIImage? = await Browser.within(3, nil) { await withCheckedContinuation { c in wv.takeSnapshot(with: cfg) { img, _ in c.resume(returning: img) } } }
        guard let image else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> Data? in
            let f = UIGraphicsImageRendererFormat()
            f.scale = min(image.scale, 2)
            f.opaque = true
            return UIGraphicsImageRenderer(size: image.size, format: f).image { _ in image.draw(at: .zero) }.jpegData(compressionQuality: 0.6)
        }.value
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
        if navigationAction.navigationType == .linkActivated, Date() < ignoreLinksUntil, webView === self.webView { return .cancel }
        // (in full screen, a link the person taps to another site opens in TRIF's own view, in a new tab; the full-screen
        // tab stays on its site. Redirects and sign-in hops are left alone: only a tapped link)
        let here = Site.of(webView.url?.host ?? "")
        if fullScreen, webView === self.webView, navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame ?? false,
           ["http", "https"].contains(scheme), !here.isEmpty, !Site.host(url.host ?? "", isIn: here) {
            newTab(url.absoluteString)
            report.log("fullscreen", "a link from \(here) in full screen to \(url.host ?? "?"): TRIF view, a new tab")
            return .cancel
        }
        if ModDownloads.wanted(navigationAction) { return .download }
        return ["http", "https", "about", "blob", "data", PageSchemeHandler.scheme].contains(scheme) ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        ModDownloads.wanted(navigationResponse) ? .download : .allow
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { ModDownloads.shared.take(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { ModDownloads.shared.take(download) }

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
        CookieKeeper.shared.firstPageLoaded()
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
        snapshotSoon()
    }

    /// A load that was stopped, not one that failed: cancelled (NSURLErrorCancelled, -999: another navigation
    /// replaced it, or the page stopped its own loading, as amazon.com's does) or interrupted (WebKit's "Frame load
    /// interrupted", 102). A browser shows nothing for these (Tim, 11-15, saw "URL error -999" on amazon.com).
    nonisolated static func stoppedNotFailed(_ error: Error) -> Bool {
        let ns = error as NSError
        return (ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled) || (ns.domain == WKError.errorDomain && ns.code == 102)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }

    /// A load ended without finishing. Loading is what the web view says now (a cancelled load's replacement may
    /// already be under way, so not simply false); real failures (offline, an unknown host, a certificate) show.
    private func failed(_ webView: WKWebView, _ error: Error) {
        tab(of: webView)?.loading = webView.isLoading
        guard webView === self.webView else { return }
        loading = webView.isLoading
        if !Browser.stoppedNotFailed(error) { status = error.localizedDescription }
        resumeLoadWaiters()
    }

    /// A link or page that opens a window: a new tab after this one (made from the configuration WebKit hands over,
    /// so the page that opened it can still talk to it, as a sign-in window needs).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let link = Browser.modLink(url, source: "the page") { offer(link); return nil }
        let t = makeTab(configuration: configuration)
        t.started = true
        // (a window the page opens: a new tab, in TRIF view)
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

/// Sound and video go on with the app in the background or the phone locked (Tim, 11-16: YouTube with his
/// Background Play mod): Info.plist's UIBackgroundModes `audio`, and the app's audio session set to playback at
/// launch. Only the category is set, the session isn't started: nothing plays and no other app's sound is
/// interrupted until a page plays. (The local model, the chats and the Mods tab make no sound of their own.)
/// That alone keeps sound (an <audio>) going, as in Safari. A video with sound WebKit pauses as the app goes to
/// the background or the phone locks (Safari does the same, 11-16, the Simulator), and plays it again when the app
/// comes back: TRIF plays it on at once instead (`resume`), unless the page paused it itself as it went hidden
/// (YouTube without a background-play mod). Interruptions (a call, another app's sound) and the session's other
/// changes go to the diagnostics, for a "stopped by itself" report. Development: `-noaudiosession` leaves the
/// session as iOS starts it, `-nobgresume` leaves WebKit's pause, to compare.
enum BackgroundPlay {
    /// (in TRIF's world, every page from its start) When each video or audio was last paused, and whether the page
    /// was showing then. As the app leaves (or the phone locks), WebKit pauses a video with sound while the page
    /// still shows, then tells the page it's hidden. At that moment, before the page's own listeners (this one is
    /// the first on the window), what WebKit paused within the last second plays on; a page that pauses as it goes
    /// hidden (YouTube without a background-play mod) then pauses it itself, while hidden, and that's kept.
    /// (TRIF's world sees the real visibilityState, whatever a mod tells the page.)
    static let watch = """
        document.addEventListener('pause', (e) => {
          if (e.target instanceof HTMLMediaElement) e.target.__trifPause = { at: Date.now(), visible: document.visibilityState === 'visible' };
        }, true);
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'hidden') return;
          const now = Date.now();
          for (const m of document.querySelectorAll('video, audio')) {
            const p = m.__trifPause;
            if (m.paused && !m.ended && p && p.visible && now - p.at < 1000) { m.__trifPlayedOn = now; m.play().catch(() => {}); }
          }
        }, true);
        """
    /// After the app has gone (`left`, ms): plays on what WebKit paused since then that's still paused (the page wasn't
    /// told, or a mod stopped the telling): in the shown tab only what was paused while it showed; in a tab already
    /// hidden (its page isn't told anything as the app leaves) whatever was paused since. Says what it did.
    private static let playOn = """
        const out = [], since = left - 300;
        for (const m of document.querySelectorAll('video, audio')) {
          const p = m.__trifPause;
          if (!p || p.at < since - 2000) continue;
          const d = Math.round(p.at - left), gap = Math.abs(d) + ' ms ' + (d < 0 ? 'before' : 'after') + ' the app was told it left';
          if (m.__trifPlayedOn && m.__trifPlayedOn >= p.at - 1000) out.push((m.paused ? 'played on as it was hidden, then the page paused it' : 'played on as it was hidden') + ' (' + m.localName + ', paused ' + gap + ')');
          else if (!m.paused || m.ended) continue;
          else if (p.at < since || (shown && !p.visible)) out.push('left paused (' + m.localName + ', paused ' + gap + (p.visible ? '' : ', while hidden') + ')');
          else { try { await m.play(); out.push('played on (' + m.localName + ', paused ' + gap + ')'); } catch (e) { out.push('refused ' + e.name); } }
        }
        return out.join('; ');
        """

    /// The app went to the background (or the phone locked): what WebKit paused plays on. Looked at twice, as
    /// WebKit's pause can come a moment after the app is told.
    @MainActor static func resume(_ browser: Browser) {
        guard !ProcessInfo.processInfo.arguments.contains("-nobgresume") else { return }
        // (WebKit pauses as it's told the app left: the same moment as this, give or take: 300 ms before counts)
        let left = Date().timeIntervalSince1970 * 1000
        Task { @MainActor in
            var told = Set<String>()
            for wait in [0.6, 1.4] {
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                guard UIApplication.shared.applicationState == .background else { return }
                for t in browser.tabs where t.started && t.webView.url != nil {
                    let wv = t.webView, shown = t === browser.current
                    let r = await Browser.within(1, "no answer") { () -> String in
                        let v = try? await wv.callAsyncJavaScript(playOn, arguments: ["left": left, "shown": shown], in: nil, contentWorld: Browser.trifWorld)
                        return v.map { "\($0)" } ?? "no answer"
                    }
                    if !r.isEmpty, told.insert(r).inserted { Diagnostics.shared.log("audio", "the app went to the background, \(Diagnostics.place(wv.url))\(shown ? "" : " (a background tab)"): \(r)") }
                }
            }
        }
    }

    @MainActor static func setUp() {
        let session = AVAudioSession.sharedInstance()
        if !ProcessInfo.processInfo.arguments.contains("-noaudiosession") {
            do { try session.setCategory(.playback, mode: .moviePlayback) }
            catch { Diagnostics.shared.log("audio", "couldn't set the audio session to playback: \(error.localizedDescription)") }
        }
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { n in
            let info = n.userInfo ?? [:]
            let type = (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            let line: String
            if type == .began {
                let reason = (info[AVAudioSessionInterruptionReasonKey] as? UInt).flatMap(AVAudioSession.InterruptionReason.init(rawValue:))
                line = "sound interrupted (\(reason == .appWasSuspended ? "the app was suspended" : reason == .routeDisconnected ? "the headphones or speaker went" : "another app or a call"))"
            } else {
                let resume = ((info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0) & AVAudioSession.InterruptionOptions.shouldResume.rawValue != 0
                line = "sound interruption ended\(resume ? ", iOS says it may resume" : "")"
            }
            MainActor.assumeIsolated { Diagnostics.shared.log("audio", line) }
        }
        nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { _ in
            MainActor.assumeIsolated {
                Diagnostics.shared.log("audio", "iOS reset its media services: the audio session set again")
                if !ProcessInfo.processInfo.arguments.contains("-noaudiosession") { try? session.setCategory(.playback, mode: .moviePlayback) }
            }
        }
    }

    /// (development) The session as it is now, for the `playing` step.
    @MainActor static func describe() -> String {
        let s = AVAudioSession.sharedInstance()
        return "category \(s.category.rawValue), mode \(s.mode.rawValue), other audio playing \(s.isOtherAudioPlaying), outputs \(s.currentRoute.outputs.map(\.portType.rawValue))"
    }
}

extension Model {
    /// (development, the dev step {"playcheck": "<a page with a video or audio>"}) The regression check for a playing
    /// tab (Tim, 11-16: YouTube stopped about 20 s after he switched tabs): the page opens in a new tab and plays,
    /// the tab before is shown again, and the playing tab must still be there and playing past the let-go time and
    /// after a memory warning, then be let go once paused that long; the same page in a tab that doesn't play is
    /// let go. PASS/FAIL lines; about 75 s. The app in the background and the phone locked are checked from outside
    /// (simctl, the Home button) with {"playing": 1} and {"tabjs": …, "tab": n}.
    static func playCheck(browser: Browser, page: URL) async -> String {
        var lines: [String] = []
        func check(_ ok: Bool, _ what: String) { lines.append("\(ok ? "PASS" : "FAIL") \(what)") }
        func sleep(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
        func time(_ t: Tab) async -> Double {
            let r = try? await t.webView.callAsyncJavaScript("const m = document.querySelector('video, audio'); return m ? m.currentTime : -1", arguments: [:], in: nil, contentWorld: .page)
            return (r as? Double) ?? (r as? NSNumber)?.doubleValue ?? -1
        }
        guard let before = browser.current else { return "FAIL no tab shown" }
        browser.newTab(page.absoluteString)
        guard let t = browser.current, t !== before else { return "FAIL no new tab" }
        await sleep(0.5); await browser.waitForLoad(); await sleep(1)
        let started = try? await t.webView.callAsyncJavaScript("""
            const all = [...document.querySelectorAll('video, audio')];
            if (!all.length) return 'no video or audio on the page';
            const m = all[0];
            m.loop = true;
            try { await m.play(); return 'playing'; } catch (e) { return 'play refused: ' + e.name; }
            """, arguments: [:], in: nil, contentWorld: .page)
        await sleep(1.5)
        let front = await Browser.playing(t)
        check(front, "plays in front (\(started.map { "\($0)" } ?? "no answer"))")
        guard front else { browser.close(t); return lines.joined(separator: "\n") }

        // (a second tab on the same page that never plays: WebKit says "playing" for it too, as it shares the web
        // process; it must still be let go)
        browser.newTab(page.absoluteString)
        let quiet = browser.current!
        await sleep(0.5); await browser.waitForLoad(); await sleep(1)
        browser.select(before)
        let t0 = await time(t)
        await sleep(Browser.backgroundSeconds + 8)
        let t1 = await time(t)
        check(!quiet.started, "the same page in another tab, not playing, let go")
        browser.close(quiet)
        check(t.started && t.webView.url != nil, "kept past \(Int(Browser.backgroundSeconds)) s in a background tab")
        check(await Browser.playing(t) && t1 > t0 + Browser.backgroundSeconds / 2, "still playing there (\(String(format: "%.1f", t0)) s → \(String(format: "%.1f", t1)) s)")

        browser.memoryWarning()
        await sleep(2)
        let t2 = await time(t)
        check(t.started && t.webView.url != nil, "kept after a memory warning")
        check(await Browser.playing(t) && t2 > t1, "still playing after it (\(String(format: "%.1f", t2)) s)")

        _ = try? await t.webView.callAsyncJavaScript("document.querySelector('video, audio')?.pause()", arguments: [:], in: nil, contentWorld: .page)
        await sleep(2)
        check(!(await Browser.playing(t)), "paused")
        // (looked at every few seconds: let go between the let-go time and one look later)
        await sleep(Browser.backgroundSeconds + Browser.playingCheckSeconds + 2)
        check(!t.started, "let go once paused \(Int(Browser.backgroundSeconds)) s")
        browser.close(t)
        browser.select(before)
        return lines.joined(separator: "\n")
    }

    /// (development, {"playing": 1}) Each tab: shown (*), let go or not, and WebKit's playback state.
    static func playingStates(browser: Browser) async -> String {
        var out: [String] = []
        for t in browser.tabs {
            var state = "let go"
            if t.started && t.webView.url != nil {
                let wv = t.webView
                let s = await Browser.within(1, "no answer") { () -> String in
                    switch await wv.requestMediaPlaybackState() {
                    case .playing: return "playing"
                    case .paused: return "paused"
                    case .suspended: return "suspended"
                    case .none: return "none"
                    @unknown default: return "?"
                    }
                }
                let page = (try? await wv.callAsyncJavaScript(Browser.pagePlaying, arguments: [:], in: nil, contentWorld: Browser.trifWorld)) as? String
                state = "WebKit: \(s), page: \(page ?? "no answer") → \(await Browser.playing(t) ? "kept" : "not playing")"
            }
            out.append("\(t === browser.current ? "*" : " ") \(t.host.isEmpty ? "-" : t.host) \(state)")
        }
        return out.joined(separator: "\n") + "\naudio session: " + BackgroundPlay.describe()
    }
}

/// (Browser.within: whichever of an answer and its time limit comes first)
@MainActor final class OnceFlag { var done = false }


/// A .js file downloaded (a link tapped in a page or the chat, its download the file): to Add this mod?, not to
/// Files (Tim, 11-16). Only a .js file, 2 MB at most; anything else downloaded is let go, as before.
@MainActor
final class ModDownloads: NSObject, WKDownloadDelegate {
    static let shared = ModDownloads()
    weak var browser: Browser?
    private var files: [ObjectIdentifier: (url: URL, name: String)] = [:]

    private static func jsName(_ s: String?) -> Bool { (s ?? "").lowercased().hasSuffix(".js") }
    /// A link that asks to be downloaded (its `download` attribute) to a .js file, or a page's own made file.
    static func wanted(_ a: WKNavigationAction) -> Bool {
        guard a.shouldPerformDownload, let u = a.request.url else { return false }
        return jsName(u.path) || u.scheme == "blob" || u.scheme == "data"
    }
    /// A response that's a .js file to save (an attachment, or something the web view wouldn't show), in the main frame.
    static func wanted(_ r: WKNavigationResponse) -> Bool {
        guard r.isForMainFrame, jsName(r.response.suggestedFilename) else { return false }
        let disposition = (r.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        return disposition.contains("attachment") || !r.canShowMIMEType
    }

    func take(_ d: WKDownload) { d.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        guard ModDownloads.jsName(suggestedFilename), response.expectedContentLength < 2_000_000 else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).js")
        files[ObjectIdentifier(download)] = (url, suggestedFilename)
        return url
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let f = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let text = (try? String(contentsOf: f.url, encoding: .utf8)) ?? ""
        try? FileManager.default.removeItem(at: f.url)
        browser?.report.log("mods", "downloaded \(f.name) (\(text.count) characters): to Add this mod?")
        browser?.offer(text: text.isEmpty ? nil : text)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let f = files.removeValue(forKey: ObjectIdentifier(download))
        Diagnostics.shared.log("chat files", "couldn't download \(f?.name ?? "a file"): \(error.localizedDescription)")
    }
}
