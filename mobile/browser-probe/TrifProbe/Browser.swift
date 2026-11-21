// The probe's browser: its tabs (Tabs.swift), each a web view, with three places code can run beside a page.
//   the page's own world   where a free mod would run, and where the page can change everything
//   TRIF's world ("trif")  the kit (mobile/shared/kit.js), the start script, and the only way to the app
//   the box ("trif-box")   where SES locks the language down and boxed mods would run
// It also does the things a TRIF browser would do by itself: hides what the saved rules say from the first
// moment of each load (rules point-and-hide made before 11-17), gives links and pictures the system's long-press
// menu (with Open in New Tab), and stops a mod link before it loads.

import SwiftUI
import UIKit
import WebKit
import PDFKit
import AVFoundation

@MainActor
final class Browser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UIGestureRecognizerDelegate {
    static let trifWorld = WKContentWorld.world(name: "trif")
    static let boxWorld = WKContentWorld.world(name: "trif-box")
    /// What Safari adds to its user agent, so sites treat this web view as the browser it is.
    static let safariSuffix = "Version/26.0 Mobile/15E148 Safari/604.1"
    /// What Safari on a Mac says it is (and Safari on an iPhone asked for a site's desktop website): a desktop site's tab.
    static let desktopAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

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
    /// What the shown page last said about its mods (ModsPanel: the Mods tab shows it at once, then asks again),
    /// and when it was asked (a mod is judged as not starting only on an answer asked a while after the page loaded).
    var lastPageAnswer: (url: String, ran: Set<String>, errors: [String: [String]], at: Date)?
    /// Each Mods tab state is numbered as it's made: the page keeps only the newest (a state made before a switch
    /// was tapped and delivered after it would show the switch in its old state; Tim's recording, 11-18).
    var modsStateSeq = 0
    /// A hold that came from the chat opened the Mods tab: it closes again once that's decided.
    var holdFromChat = false
    /// Set when something wants the Mods tab open (a mod added that waits for an OK); the app opens it.
    @Published var wantsMods = false
    @Published var status = ""
    /// The note's Go to <site> (a mod from a chat added on another tab): shown while the note says `text`.
    @Published var statusGo: (text: String, site: String)?
    /// The tab whose resumed video plays muted while the note says "Tap for sound" (VideoResume).
    weak var soundTab: Tab?
    /// Whether a chat for a site knows its way back there (ClaudePane's chat links), and a mod from that site's chat
    /// was added (its link says "mod added"). Set by the pane.
    var chatTabFor: (String) -> Bool = { _ in false }
    var modAddedFrom: (String) -> Void = { _ in }
    /// Full screen (Tim, 11-16): the page with no browser around it (no address bar, toolbar or tabs), as an app.
    /// How the person is looking at the browser now, not a tab's (Tim, 11-21: "if you're in browser mode and you go get
    /// an old tab that was opened from a bookmark link ... you still want browser mode"): switching tabs (the tabs,
    /// a swipe, a new tab, a banner's Go to, a notification, a page's own window) keeps it; two fingers held on the
    /// page or ⋯ → Full screen switch it, either way, on any tab; a Home Screen icon lands in it on its own tab; a
    /// tapped link to another site leaves it, for TRIF view in a new tab. Not kept across launches: the app starts in
    /// TRIF view unless an icon launched it. (Until 11-21 it was each tab's, remembered: "fullScreenTabs".)
    @Published private(set) var fullScreen = false
    /// Full screen on or off; `note`: say so in a note that fades.
    func setFullScreen(_ on: Bool, note: Bool = true) {
        guard fullScreen != on else { return }
        fullScreen = on
        report.log("fullscreen", "\(on ? "full screen" : "TRIF view") on \(Site.of(current?.host ?? "").isEmpty ? "no site" : Site.of(current?.host ?? ""))")
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
    /// Set when something asks for the chat to open; the app opens it.
    @Published var wantsChat = false
    /// Counts the times a mod came in and the chat should get out of the way, so the page with the mod shows
    /// (Tim, 11-15: "when the code is pasted, just hide the claude window"). The chat keeps its conversation.
    @Published var hideChat = 0
    /// The mods of a reply waiting for their Add this mod? (one sheet at a time), and where the one shown is in them.
    var offerQueue: [InstalledMod] = []
    /// Offers from outside TRIF (a trif://add link, a page's download, the watched folder; security batch 11-20): the
    /// ids handed to Add this mod?, and how many are still being read, so only one batch from outside waits at a time
    /// (FolderWatch.swift, `outsideMayOffer`).
    var outsideIds: Set<String> = []
    var outsideReading = 0
    @Published private(set) var offerPlace: (n: Int, of: Int)?
    var offerBatch = 0, offerShown = 0
    /// The last mod added from the chat, for what the chat is told next (feedbackForChat).
    private var lastAdded: (id: String, name: String)?
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
        // (each tab's full screen, kept until 11-21: full screen is the app's view now, never restored at a launch)
        UserDefaults.standard.removeObject(forKey: "fullScreenTabs")

        // (TRIF's message handler isn't on the shared configuration: each tab's own content controller gets it only while its
        // page is on a connected site, applyAccess)
        // (before any page: a launch after the app quit in front starts with those sites' mods switched off)
        safety = Safety(store: mods)
        // (a mod renamed (the Mods tab, or a sync): what keeps its id here follows it)
        mods.onRename = { [weak self] from, to in self?.modRenamed(from, to) }
        NotificationCenter.default.addObserver(forName: .trifPauseAll, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.pauseAll(true) }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.memoryWarning() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if let self { BackgroundPlay.resume(self) } }
        }
        // (site access, Tim 11-20: the first start of this version connects the sites a phone already used TRIF on, sensitive
        // ones aside; then each connect or disconnect puts the tabs right)
        SiteAccess.shared.upgradeOnce(modSites: mods.mods.map(\.site), iconSites: Array((UserDefaults.standard.dictionary(forKey: "iconTabs") ?? [:]).keys))
        SiteAccess.shared.onChange = { [weak self] site, on in self?.accessChanged(site, connected: on) }
        installScripts()
        // (the chat-offer judge's keys of every version a chat mustn't offer again, ahead: ChatOffers.swift)
        let versions = mods.mods.flatMap { [$0.code] + $0.history.map(\.code) } + mods.trash.flatMap { [$0.mod.code] + $0.mod.history.map(\.code) }
        Task.detached(priority: .utility) { ChatOfferMemory.warm(versions) }
        ModDownloads.shared.browser = self
        FolderWatch.shared.browser = self
        UnreadCounts.shared.browser = self
        restoreTabs()
        // (the counts in the titles kept with the tabs: the cards and TRIF's icon as they were left, UnreadCounts)
        UnreadCounts.shared.changed()
        // (a launch by a Home Screen icon: its own tab shown from the first frame, WebClip.swift)
        if let link = PendingLink.url, let site = TrifLink.target(link), TrifLink.isOurs(link) { showIconTabAtLaunch(site) }
        // (seen 11-21 in the Simulator: SwiftUI made the Model, so this Browser, before UIKit handed over the launch's
        // link in configurationForConnecting, so the line above found none; the link then still comes before the
        // first frame: AppDelegate calls this)
        PendingLink.atLaunch = { [weak self] link in
            if let site = TrifLink.target(link), TrifLink.isOurs(link) { self?.showIconTabAtLaunch(site) }
        }
    }

    // MARK: tabs

    /// A web view for a tab: from the shared configuration, or (a page opening a window) the one WebKit hands over.
    /// A tab's configuration: the shared one's (the cookie store, the probe's pages, the agent) with a content controller
    /// of its own, which holds TRIF's scripts and message handler only while the tab's page is on a connected site
    /// (applyAccess: site access, Tim 11-20). A window a page opens comes with WebKit's configuration, which must be the
    /// one it's made with (WebKit checks): that one gets the fresh controller itself.
    private func tabConfig(_ given: WKWebViewConfiguration? = nil) -> WKWebViewConfiguration {
        let c = given ?? (config.copy() as! WKWebViewConfiguration)
        c.userContentController = WKUserContentController()
        // (TRIF's browser features, on every site: their own world, their scripts and handler; BrowserWorld)
        BrowserWorld.install(c.userContentController, handler: browserFeatures)
        return c
    }
    /// The browser features' message handler, in every tab's controller (for their world only).
    private(set) lazy var browserFeatures: BrowserFeatureHandler = { let h = BrowserFeatureHandler(); h.browser = self; return h }()

    private func makeTab(configuration: WKWebViewConfiguration? = nil, id: UUID = UUID(), title: String = "", url: URL? = nil) -> Tab {
        let tab = Tab(id: id, webView: TabWebView(frame: .zero, configuration: tabConfig(configuration)), title: title, url: url)
        attach(tab)
        return tab
    }

    /// Sets up a tab's web view: the app as its delegate, the two-finger hold, and watching its address and title.
    private func attach(_ tab: Tab) {
        let wv = tab.webView
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        // (a long press on a link or picture: the system's menu and preview, `contextMenuConfigurationFor` below)
        wv.allowsLinkPreview = true
        wv.isInspectable = true
        // (full screen and back: two fingers held still on the page; pages don't use it, and it never blocks them. A
        // pinch moves too far, a two-finger tap is too short)
        let two = UILongPressGestureRecognizer(target: self, action: #selector(twoFingerPress(_:)))
        two.numberOfTouchesRequired = 2
        two.minimumPressDuration = 0.3  // (Tim, 11-18: half as long; was 0.6)
        two.allowableMovement = 24
        two.delegate = self
        wv.addGestureRecognizer(two)
        // (where the finger was last: a tapped link to another app opens at once, a page's own try asks: AppLinks)
        TouchClock.watch(wv)
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
            // (asked in the browser features' world: on every site, connected or not)
            guard let t = wv as? TabWebView else { return true }
            let page = try? await t.browserFeature(.playing)
            return page.map { $0 != "no" } ?? false
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
        tab.replaceWebView(TabWebView(frame: .zero, configuration: tabConfig()))
        tab.accessKey = nil; tab.handlerOn = false
        attach(tab)
        tab.started = false
        tab.reloadCause = nil
        tab.letGoWhy = why ?? "not shown for \(Int(Browser.backgroundSeconds)) s"
        Diagnostics.shared.log("tab", "let go of a background tab's page (\(Diagnostics.place(tab.savedURL)))\(why.map { ": \($0)" } ?? ""); it loads again when shown")
        noteRunning()
    }

    /// iOS warns the app of low memory: every background tab lets its page go now, except one that's playing (it
    /// goes on being looked at, and is let go once it has stopped).
    func memoryWarning() {
        lastMemoryWarning = Date()
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
                return t
            }
            // (each card reads its tab's last picture when it shows: Tabs.swift TabShots)
            TabShots.shared.dropOrphans(keeping: Set(tabs.map(\.id)))
            // (each tab's video, where a relaunch picks it up: VideoResume)
            let videos = VideoStore.shared.load(keeping: Set(tabs.map(\.id)))
            for t in tabs { t.video = videos[t.id] }
            select(tabs.first { $0.id == saved.selected } ?? tabs[tabs.count - 1])
        } else {
            let t = makeTab()
            tabs = [t]
            TabShots.shared.dropOrphans(keeping: [t.id])
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
        // (a tab being closed isn't pictured as it goes: its picture was just deleted)
        if let was = current, was !== tab, tabs.contains(where: { $0 === was }) { TabShots.shared.take(was, "left"); letGoLater(was) }
        current = tab
        status = ""
        if TabReloadRules.starts(started: tab.started, waitingForFront: waitingForFront) { start(tab) } else { refreshIfStale(tab, "shown again after they changed while it was behind") }
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
        if tab.savedState != nil || tab.savedURL != nil {
            logReload(tab, tab.savedURL, tab.letGoWhy.map { "shown again after its page was let go in the background (\($0))" } ?? "its tab restored as the app started")
            tab.letGoWhy = nil
        }
        if let state = tab.savedState { tab.webView.interactionState = state }
        else if let u = tab.savedURL { tab.webView.load(URLRequest(url: u)) }
        tab.savedState = nil
    }

    /// A new tab after the one shown: empty (the address bar's), or at an address.
    func newTab(_ address: String? = nil) {
        let from = current
        let t = makeTab()
        t.started = true
        let at = (tabs.firstIndex { $0 === current } ?? tabs.count - 1) + 1
        tabs.insert(t, at: at)
        select(t)
        if let address { go(address); newTabFrom = NewTabFrom() } else { newTabFrom = NewTabFrom(from: from, made: t); wantsAddress = true }
    }
    /// An empty new tab's address screen and the tab it was opened from (from the toolbar's +, the ⋯ menu, the tabs'
    /// +, a pull): its Cancel, or the + tapped again, closes it and goes back there, as Safari's (Tim, 11-18). Weak: a
    /// closed tab's web view isn't kept alive by it.
    struct NewTabFrom { weak var from: Tab?; weak var made: Tab? }
    var newTabFrom = NewTabFrom()
    /// The address screen left without opening anything (Cancel, the + again): the empty new tab it was for closes
    /// and the tab it came from is back, as it was. Only while nothing was opened in it and the tab it came from is
    /// still open (so another tab, with its page, is always left: never no tab, never no start page). True if it did.
    @discardableResult
    func leaveEmptyNewTab() -> Bool {
        defer { newTabFrom = NewTabFrom() }
        guard let from = newTabFrom.from, let made = newTabFrom.made, made === current, made !== from,
              made.webView.url == nil, !made.webView.isLoading, made.savedURL == nil,
              tabs.contains(where: { $0 === from }), tabs.count > 1 else { return false }
        select(from)
        close(made)
        return true
    }

    /// `showing`: the tab to show next if `tab` was the one shown and `showing` is still open (a page's own window
    /// closing itself: its opener); else the tab that takes its place.
    func close(_ tab: Tab, showing next: Tab? = nil) {
        guard let i = tabs.firstIndex(where: { $0 === tab }) else { return }
        letGo[tab.id]?.cancel(); letGo[tab.id] = nil
        tab.webView.stopLoading()
        tabs.remove(at: i)
        TabShots.shared.remove(tab.id)
        tab.video = nil
        VideoStore.shared.set(tab.id, nil)
        UnreadCounts.shared.changed()
        if tabs.isEmpty { let t = makeTab(); t.started = true; tabs = [t]; select(t); wantsAddress = true; return }
        if tab === current { select(next.flatMap { n in tabs.contains { $0 === n } ? n : nil } ?? tabs[min(i, tabs.count - 1)]) } else { saveTabs() }
    }

    /// The tab's picture for the switcher (TabShots: kept on disk too). Taken as a tab is left, when the app goes to
    /// the background, when the switcher opens, and a moment after a page has loaded.
    func snapshot(_ tab: Tab? = nil, _ why: String = "the tabs opened") {
        guard let t = tab ?? current else { return }
        TabShots.shared.take(t, why)
    }
    /// After the shown tab's page loads: its picture a second later (once it has drawn), the last load's if several
    /// come quickly (TabShots keeps it to one every few seconds); waited for while the page is being scrolled.
    private var shotLater: Task<Void, Never>?
    private func snapshotSoon() {
        guard let t = current else { return }
        shotLater?.cancel()
        shotLater = Task { @MainActor [weak self, weak t] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled, let t, t === self?.current else { return }
            TabShots.shared.take(t, "loaded", retries: 4)
        }
    }

    /// Set when a new tab wants its address typed; the app focuses the address bar.
    @Published var wantsAddress = false
    /// (development) a sheet to open (-open): mods, tabs, history or chat.
    @Published var wantsSheet = ""
    /// The site of the page shown, as the chat pane and the Mods tab group sites (Mods.swift Site.of).
    /// (site access, 11-20: a sensitive host is a site of its own, mail.google.com, not google.com: SiteAccess.scope)
    var site: String { SiteAccess.shared.scope(host) }
    /// TRIF is connected on the shown tab's page (an http(s) page on a connected site, or TRIF's own pages).
    var connectedHere: Bool { SiteAccess.shared.allows(webView.url ?? current?.savedURL) }
    /// Set when something asked for TRIF on a page it isn't connected on: the app shows the robot's card.
    @Published var wantsConnectCard = false

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
    /// (development, the `rebuild` step) how long the last swap took on the main thread, in ms, and its parts.
    var lastInstallMs: [String: Int] = [:]
    /// The scripts every page gets whatever the mods: made again only when the hide rules change.
    private var baseScripts: (rules: String, list: [WKUserScript])?
    private func base() -> [WKUserScript] {
        let rules = report.rulesJSON()
        if let b = baseScripts, b.rules == rules { return b.list }
        let start = { (s: String, w: WKContentWorld) in WKUserScript(source: s, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: w) }
        let list = [
            start(Diagnostics.stallWatch, Browser.trifWorld),
            // (background play and video pick-up: TRIF's browser features, in their own world on every page, BrowserWorld)
            start(Browser.resource("kit", "js"), Browser.trifWorld),
            start(Browser.resource("start-own", "js") + "(\(rules));", Browser.trifWorld),
            start(Browser.resource("start-page", "js"), .page),
        ]
        baseScripts = (rules, list)
        return list
    }
    /// The scripts a page on a connected site gets at its start (TRIF's own, then the mods'), as made last; a sensitive
    /// site's own set (only its own mods: sensitiveScripts) is made from the same plan. Each tab's content controller
    /// takes the set its next page needs as that page starts loading (applyAccess), so a change here reaches a page
    /// at its next load, as before (refreshIfStale reloads the shown one when what runs there changed).
    private(set) var connectedScripts: [WKUserScript] = []
    /// Counts the sets made, so a tab's controller holding an older one takes the new one at its next load.
    private(set) var scriptsVersion = 0
    private var lastPlan: ModStore.ScriptPlan?
    private var sensitiveSets: [String: [WKUserScript]] = [:]
    private func swapScripts(_ modScripts: [WKUserScript], plan: ModStore.ScriptPlan?) {
        let t0 = Date()
        // (development) `-bare`: nothing of the app's in any page, to measure a page without it
        let bare = DevFlags.args.contains("-bare")
        connectedScripts = bare ? [] : base() + modScripts
        lastPlan = plan
        sensitiveSets = [:]
        scriptsVersion += 1
        lastInstallMs["swap"] = Int(Date().timeIntervalSince(t0) * 1000)
        lastInstallMs["scripts"] = connectedScripts.count
    }

    /// A connected sensitive site's set (desktop's rule: a sensitive site is a site of its own, and only its own mods
    /// run there: not its parent's (google.com's on mail.google.com), not every-site mods): TRIF's own scripts and the
    /// mods kept under that site.
    private func sensitiveScripts(_ site: String) -> [WKUserScript] {
        if let s = sensitiveSets[site] { return s }
        if DevFlags.args.contains("-bare") { return [] }
        let plan = (lastPlan ?? mods.scriptPlan()).only { SiteAccess.shared.scope($0.site) == site }
        let list = base() + mods.userScripts(from: plan, fresh: [:], remember: false)
        sensitiveSets[site] = list
        return list
    }

    /// Which of TRIF's sets a page at `url` gets: "plain" (nothing of TRIF's: a disconnected site, or a page that isn't
    /// a website), "all" (a connected site, and TRIF's own pages), "sens:<site>" (a connected sensitive site).
    func accessKey(_ url: URL?) -> String {
        guard SiteAccess.shared.allows(url), let url else { return "plain" }
        if url.scheme?.lowercased() == PageSchemeHandler.scheme { return "all" }
        let c = SiteAccess.shared.card(SiteAccess.host(url))
        return c.sensitive ? "sens:\(c.site)" : "all"
    }

    /// A tab's content controller made to hold what a page at `url`, about to load in it (its main frame), may have:
    /// nothing of TRIF's at all on a disconnected site (no user scripts, no message handler, so no content world of
    /// TRIF's is ever made in that page), TRIF's set on a connected one. Called as each main-frame navigation is let
    /// through (decidePolicyFor navigationAction, redirects included) and again at its response (the address it really
    /// lands on): before the new document starts, so its document-start scripts are the ones put here.
    func applyAccess(_ tab: Tab, _ url: URL?, response: Bool) {
        let key = accessKey(url)
        if response { tab.responseAccess = key }
        guard tab.accessKey != key || (key != "plain" && tab.accessVersion != scriptsVersion) else { return }
        let ucc = tab.webView.configuration.userContentController
        ucc.removeAllUserScripts()
        // (the browser features' scripts first, on every page: they were taken out with the rest)
        BrowserWorld.install(ucc, handler: nil)
        if key == "plain" {
            if tab.handlerOn { ucc.removeScriptMessageHandler(forName: "trif", contentWorld: Browser.trifWorld); tab.handlerOn = false }
        } else {
            for s in key == "all" ? connectedScripts : sensitiveScripts(String(key.dropFirst(5))) { ucc.addUserScript(s) }
            if !tab.handlerOn { ucc.addScriptMessageHandler(self, contentWorld: Browser.trifWorld, name: "trif"); tab.handlerOn = true }
        }
        tab.accessKey = key
        tab.accessVersion = scriptsVersion
    }

    /// The scripts every page gets at its start, made and put in now, on the main thread (the app's start, the hide
    /// rules changed). A change to the mods goes through `rebuildScripts` instead.
    func installScripts() {
        let t0 = Date()
        let list = mods.userScripts()
        lastInstallMs = ["build": Int(Date().timeIntervalSince(t0) * 1000)]
        swapScripts(list, plan: nil)
        swappedShape = nil
    }

    /// After a change to the mods (Tim, 11-18: main-thread hangs after "making the pages' scripts again"): the mods'
    /// scripts made again with several changes in a row taken as one, the texts of new or changed mods built off the
    /// main thread (unchanged mods' scripts kept as they were made), then swapped in on the main thread; `then` once
    /// they're in. A change while one is being built builds again after it.
    private var rebuildTask: Task<Void, Never>?
    /// The mods' scripts in now (ModStore.ScriptPlan.shape + the hide rules); nil after a swap made otherwise.
    private var swappedShape: String?
    private var rebuildAgain = false
    private var afterRebuild: [() -> Void] = []
    private var rebuildWaiters: [CheckedContinuation<Void, Never>] = []
    /// A change to the mods isn't in the pages' scripts yet.
    var scriptsPending: Bool { rebuildTask != nil }
    func rebuildScripts(then: (() -> Void)? = nil) {
        if let then { afterRebuild.append(then) }
        if rebuildTask != nil { rebuildAgain = true; return }
        rebuildTask = Task { @MainActor [weak self] in
            guard let self else { return }
            var rounds = 0, built = 0, mainMs = 0
            let t0 = Date()
            repeat {
                rebuildAgain = false
                rounds += 1
                // (changes made in the same moment: one build)
                await Task.yield()
                let m0 = Date()
                let plan = mods.scriptPlan(), have = mods.builtKeys
                mainMs += Int(Date().timeIntervalSince(m0) * 1000)
                let fresh = await Task.detached(priority: .userInitiated) { ModStore.build(plan, have: have) }.value
                if rebuildAgain { continue }
                built = fresh.count
                let m1 = Date()
                // (what runs is what's in already (a switch that didn't change the scripts): nothing to put in)
                let shape = plan.shape + "|" + report.rulesJSON()
                if shape == swappedShape { lastInstallMs = ["same": 1]; mainMs += Int(Date().timeIntervalSince(m1) * 1000); continue }
                let list = mods.userScripts(from: plan, fresh: fresh)
                lastInstallMs = ["build": Int(Date().timeIntervalSince(m1) * 1000)]
                swapScripts(list, plan: plan)
                swappedShape = shape
                mainMs += Int(Date().timeIntervalSince(m1) * 1000)
            } while rebuildAgain
            let total = Int(Date().timeIntervalSince(t0) * 1000)
            lastInstallMs["main"] = mainMs; lastInstallMs["total"] = total; lastInstallMs["rounds"] = rounds; lastInstallMs["built"] = built
            if mainMs >= 50 || total >= 1000 {
                Diagnostics.shared.log("mods", "the pages' scripts made again: \(mainMs) ms on the main thread, \(total) ms in all, \(rounds) round(s), \(built) mod(s) built")
            }
            rebuildTask = nil
            let after = afterRebuild; afterRebuild = []
            for f in after { f() }
            let waiters = rebuildWaiters; rebuildWaiters = []
            for w in waiters { w.resume() }
        }
    }
    /// Returns once the pages' scripts are the mods' as they are now (the rebuild is done and swapped in).
    func scriptsInstalled() async {
        guard rebuildTask != nil else { return }
        await withCheckedContinuation { rebuildWaiters.append($0) }
    }

    // MARK: whole mods

    /// A mod the user added (from the chat or the clipboard: its Add it), or imported. One that needs an OK waits
    /// for it, with TRIF's approval card in the Mods tab, and doesn't run until then.
    /// `quiet`: no note (a quick ask's look-only mod: its pill says Done · Undo).
    func addMod(_ m: InstalledMod, source: String = "chat", quiet: Bool = false) {
        var m = m
        if let e = m.edits { Diagnostics.shared.log("chat offers", "\(m.id): \(e.count) change(s) from edit blocks added") }
        m.edits = nil
        Diagnostics.shared.mark("adding \(m.id) (\(source))")
        chatOffers.note(m.code, .added)
        hideChat += 1
        let added = mods.add(m, source: source)
        report.log("mods", "added \(added.tierName.lowercased()) \(added.id) (\(source))\(added.held ? ", waiting for an OK" : "")")
        modsChanged(why: "\(added.id) added (\(source))")
        if added.held {
            status = "\(added.name) waits for your OK."
            // (the approval card over the page instead of the chat: what there is to do now; after Allow, or Don't
            // allow, the Mods tab steps aside again and the page shows: ModsPanel.closeAfterDecision)
            holdFromChat = source != "import"
            // (after the Add this mod? sheet has gone: one sheet can't open while another is closing)
            Task { @MainActor in try? await Task.sleep(nanoseconds: 700_000_000); self.wantsMods = true }
        } else if !added.on, added.newOff == "sensitive", source != "import" {
            // (site access: a sensitive site's new mod starts off there, whoever made it)
            status = "Added \(added.name), off: \(SiteAccess.shared.scope(added.site)) is a sensitive site. Switch it on in Mods."
        } else if source != "import" && !quiet, added.site != "all-sites", !SiteAccess.shared.isConnected(added.site) {
            // (site access: adding a mod never connects its site; it waits there until the person connects it)
            status = "Added \(added.name). It runs once you connect TRIF on \(SiteAccess.shared.scope(added.site))."
        } else if source != "import" && !quiet {
            status = "Added \(added.name). It runs on \(added.sites.joined(separator: ", "))."
            // (added away from the site its chat was for (the done banner's Add, Tim 11-18): the note offers the way there)
            if let from = m.cameFrom, !from.isEmpty, from != site, chatTabFor(from) { statusGo = (status, from) }
        }
        if let from = m.cameFrom, !from.isEmpty { modAddedFrom(from) }
        if source == "chat" { lastAdded = (added.id, added.name) }
    }

    /// A mod renamed (ModStore.rename, syncRename): its old file id, where it's kept here, becomes the new one (the
    /// last mod added for the chat's words, what each tab loaded with and the page's last answer, safe mode's lists,
    /// the Mods tab's card to open). Recently deleted keeps its entries as they were.
    func modRenamed(_ from: String, _ to: String) {
        if lastAdded?.id == from { lastAdded?.id = to }
        for t in tabs where t.modsLoadedIds.contains(from) { t.modsLoadedIds.remove(from); t.modsLoadedIds.insert(to) }
        if var a = lastPageAnswer {
            if a.ran.remove(from) != nil { a.ran.insert(to) }
            if let e = a.errors.removeValue(forKey: from) { a.errors[to] = e }
            lastPageAnswer = a
        }
        safety.renamed(from, to)
        renamedForPanel = (from, to)
    }
    /// The last rename, for the Mods tab's page (its open card follows the mod to its new id).
    var renamedForPanel: (from: String, to: String)?

    /// After any change to the mods: the scripts every page gets are made again. The shown page loads again to run
    /// them only if what runs on it changed (a mod for its site: added, updated, undone, switched, synced), and never
    /// while it plays sound or video; tabs behind load again when they're next shown (Tim, 11-18: "when you
    /// successfully add the mod to the other tab, your tab reloads. That's quite annoying for watching videos").
    /// `playing`: the shown page loads again even if it plays (Pause all mods: the person's own act on it).
    func modsChanged(reload again: Bool = true, playing: Bool = false, why: String = "the mods changed") {
        Diagnostics.shared.mark("making the pages' scripts again after a change to the mods")
        rebuildScripts { [weak self] in
            guard let self else { return }
            // (so a hang later isn't put down to this)
            Diagnostics.shared.mark("the pages' scripts made again after a change to the mods")
            if again, let t = self.current { self.refreshIfStale(t, why, evenPlaying: playing) }
            self.noteRunning()
        }
    }

    /// `tab` shown: loaded again if the mods running on its page are no longer the ones it loaded with, unless it's
    /// playing (then it keeps going as it is, and loads again the next time it's shown not playing).
    func refreshIfStale(_ tab: Tab, _ why: String, evenPlaying: Bool = false) {
        // (a change not in the scripts yet: looked at once it is)
        // (the decision: TabReloadRules, the phones' shared rule; the signature, the playing check and the reload here)
        let seen = tab.modsLoaded
        let look = TabReloadRules.refresh(pending: scriptsPending, started: tab.started, hasPage: tab.webView.url != nil,
                                          reloading: tab.reloadCause != nil, loaded: seen?.signature,
                                          now: seen.map { mods.signature($0.url) } ?? "", evenPlaying: evenPlaying)
        if look == .later { afterRebuild.append { [weak self, weak tab] in if let self, let tab, tab === self.current { self.refreshIfStale(tab, why, evenPlaying: evenPlaying) } }; return }
        guard look == .ask || look == .next else { return }
        Task { @MainActor [weak self, weak tab] in
            guard let self, let tab else { return }
            let playing = look == .ask ? await Browser.playing(tab) : false
            let seen = tab.modsLoaded
            switch TabReloadRules.recheck(playing: playing, shown: tab === self.current, reloading: tab.reloadCause != nil,
                                          pending: self.scriptsPending, loaded: seen?.signature, now: seen.map { self.mods.signature($0.url) } ?? "") {
            case .playing:
                Diagnostics.shared.log("mods", "\(Diagnostics.place(tab.webView.url)): its mods changed (\(why)) but it's playing, so not loaded again now")
            case .reload:
                self.keepStatus = true
                self.reload(tab, "its mods changed: \(why)")
            case .keep: break
            }
        }
    }

    /// After a sync changed mods here (phone sync: taken, deleted, back, a conflict's sibling): the pages' scripts
    /// made again, so the change runs; the shown page reloads only when one of those mods is for it.
    func syncApplied(_ ids: [String]) {
        // (the shown page reloads only if what runs on it changed: refreshIfStale)
        Diagnostics.shared.mark("synced: \(ids.count) mod(s) changed")
        modsChanged(why: "phone sync changed \(ids.count) mod(s)")
    }

    /// Pause all mods, or resume them: every page loads again without (or with) them.
    func pauseAll(_ p: Bool) {
        if mods.paused != p { mods.setPaused(p) }
        // (the shown page loads again without (or with) them; tabs behind when they're next shown, unless playing then)
        modsChanged(playing: true, why: p ? "Pause all mods" : "mods resumed")
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
        modsChanged(why: "\(id) allowed")
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

    nonisolated static func jsonText(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value) || value is String || value is NSNumber || value is NSNull,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: going places

    func go(_ text: String) {
        guard let url = Browser.address(for: text) else { status = "That isn't an address."; return }
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

    /// The shown tab loaded again: `cause` says who asked (the Diagnostics "reload" line).
    func reload(_ cause: String) { if let t = current { reload(t, cause) } }
    /// A tab's page loaded again by the app, with why (Tim, 11-18: "Various things keep reloading my YouTube window. I'd
    /// like to track them all down"): every reload of a tab is a Diagnostics line "reload <host>: <cause>" (logged as
    /// WebKit starts it, decidePolicy). Its video picks up where it was (VideoResume).
    func reload(_ tab: Tab, _ cause: String) {
        tab.reloadCause = cause
        logReload(tab, tab.webView.url, cause)
        tab.webView.reload()
    }
    /// When iOS last warned of low memory (for the reload lines of pages it ended).
    private var lastMemoryWarning: Date?
    private func logReload(_ tab: Tab?, _ url: URL?, _ cause: String) {
        Diagnostics.shared.log("reload", "reload \(url?.host ?? "a page"): \(cause)\(tab.map { $0 === current ? "" : " (a tab behind)" } ?? "")")
    }

    // MARK: desktop websites

    /// Request Desktop Website (Tim, 11-18, "a desktop mode like safari has"): sites whose pages load as on a computer,
    /// by WebKit's own desktop mode (WKWebpagePreferences.preferredContentMode, each page load): a Mac's user agent and
    /// a computer's page width. As Safari's per-website setting: by host (without www.), in every tab, kept across
    /// launches; Request Mobile Website takes the site off. Only the hosts are kept (UserDefaults `desktopHosts`).
    /// The tabs' pages only: the chat's pages keep their own mode, and the mods that run are the same either way.
    @Published private(set) var desktopHosts: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "desktopHosts") ?? [])
    /// (the per-site memory's rules: DesktopRules, the phones' shared rule; key / wants / can are its Swift twins)
    nonisolated static func desktopKey(_ host: String) -> String { DesktopRules.key(host) }
    func wantsDesktop(_ url: URL?) -> Bool { DesktopRules.wants(desktopHosts, host: url?.host) }
    /// The shown page was loaded as a computer's (what ⋯'s Request Desktop / Mobile Website says it would change).
    var desktopShown: Bool { current?.desktop ?? false }
    /// The shown page is a website (http/https): only those can be asked for as a computer's or a phone's.
    var canRequestDesktop: Bool { DesktopRules.can(scheme: webView.url?.scheme, host: host) }
    /// ⋯ → Request Desktop / Mobile Website: the site remembered (or forgotten) and the page loaded again in that mode.
    func requestDesktop(_ on: Bool) {
        guard canRequestDesktop else { return }
        let key = Browser.desktopKey(host)
        let kept = DesktopRules.set(desktopHosts, host: host, on: on)
        desktopHosts = Set(kept)
        UserDefaults.standard.set(kept, forKey: "desktopHosts")
        Diagnostics.shared.log("desktop", "\(on ? "desktop" : "mobile") website for \(key) (\(desktopHosts.count) desktop sites)")
        reload(on ? "Request Desktop Website" : "Request Mobile Website")
    }
    func back() { webView.goBack() }
    func forward() { webView.goForward() }

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

    /// Is this address an old mod link (an https address whose path ends /trif-install, or anything trif:)? Stopped,
    /// with a line in the report: they carried #hide= selectors for point-and-hide, gone since 11-17 (Tim: it caught a
    /// resting thumb, and one element of many nested ones is fragile to hide); a trif: link never goes to iOS from a page.
    static func isModLink(_ url: URL) -> Bool { url.scheme == "trif" || url.path.hasSuffix("/trif-install") }
    func stopModLink(_ url: URL, from source: String) { report.log("mod link", "from \(source), not followed: \(url.absoluteString)") }

    /// A whole mod on the clipboard.
    func offerFromClipboard() { offer(text: UIPasteboard.general.string) }

    /// The mod files in a reply that's just done (Web/chat.js): each read (off the main thread), and offered in turn
    /// with the Add this mod? sheet, over the tab; nothing is added without its Add it. Leaves out one already added
    /// as it is. Returns those offered (none: the chat button shows the reply waiting instead).
    /// `path`: how the chat handed it over (auto: a reply done; late: one that turned up after it; viewer; panel;
    /// computer), for the Diagnostics line. Never offered (ChatOffers.swift): code a chat offered before, an installed
    /// mod's current or earlier version, a mod's in Recently deleted.
    /// `hold`: read and judged as ever, but not shown: the caller holds them (the chat's done banner, Tim 11-18: its
    /// Add, or Go to <site>, hands them to `offerHeld`); the same offer, never a second one.
    /// `refuse`: where a refusal's message for the chat goes (the chat's own box, filled, never sent); nil: nowhere
    /// (the note alone). Edit blocks (Tim, 11-19) are applied first, all or nothing (`prepare`); a whole file that
    /// leaves parts of the mod here out ("// rest unchanged") is refused (`shortened`).
    @discardableResult
    func offerFromChat(_ texts: [String], from chatSite: String = "", path: String, hold: Bool = false, refuse: ((ChatRefusal) -> Void)? = nil) async -> [InstalledMod] {
        // (the chat's site: a mod with no @match of its own is that site's, as desktop takes it from its folder, never
        // the page that happens to be shown (Tim, 11-18: FeedBook from a Facebook chat said "runs on google.com", the
        // tab he was on when it finished). The page shown only when the chat has no site. A computer's phone twin
        // (phone~<site>) is its site.)
        // (where it came from: the chat's site, else the page shown; Add this mod? warns when it runs elsewhere. The
        // shared rule: ModOfferRules.from, TrifCore.modOffer.from)
        let (here, came) = ModOfferRules.from(chatSite: chatSite, shown: host)
        var found: [InstalledMod] = []
        var why: String?
        var skipped: [String] = []
        let known = { (m: InstalledMod) in ChatOfferJudge.Known(id: m.id, code: m.code, history: m.history.map(\.code)) }
        var refusals: [ChatRefusal] = []
        // (each text: a whole file, or edit blocks applied first (all of a text's, or none))
        var ready: [Prepared] = []
        for whole in texts {
            switch prepare(whole) {
            case .texts(let list): ready += list
            case .already(let ids): skipped += ids.map { "\($0) (its changes are in already)" }
            case .refused(let r): refusals.append(r)
            }
        }
        for p in ready {
            let t = p.text
            let r: (mod: InstalledMod?, error: String?)
            if let on = p.on { r = await mods.readInBackground(t, file: on.file, site: on.site, here: here) } else { r = await mods.readNamedInBackground(t, here: here) }
            guard var m = r.mod else { why = why ?? r.error ?? "no reason given"; continue }
            // (a file that leaves parts of the mod here out, or edits that do: refused, the chat asked again)
            if let no = shortened(t, m) { refusals.append(no); continue }
            m.edits = p.edits
            if let no = ChatOfferJudge.skip(id: m.id, code: m.code, installed: mods.mods.map(known), deleted: mods.trash.map { known($0.mod) },
                                            queued: (offerQueue + found + [modOffer].compactMap { $0 } + offersHeld()).map(known), memory: chatOffers) {
                skipped.append("\(m.id) (\(no))")
                continue
            }
            m.cameFrom = came
            found.removeAll { $0.id == m.id }
            found.append(m)
        }
        // (a line for each hand-over, so a report shows what a chat offered and why not: ids and reasons only)
        if !found.isEmpty || !skipped.isEmpty || why != nil || !refusals.isEmpty {
            var parts: [String] = []
            if !found.isEmpty { parts.append("offered \(found.map { "\($0.id)\($0.edits.map { " (\($0.count) change(s) from edit blocks)" } ?? "")" }.joined(separator: ", "))") }
            if !skipped.isEmpty { parts.append("skipped \(skipped.joined(separator: ", "))") }
            if let why { parts.append("unreadable (\(why))") }
            if !refusals.isEmpty { parts.append("refused \(refusals.map(\.log).joined(separator: ", "))") }
            Diagnostics.shared.log("chat offers", "\(path) from \(chatSite.isEmpty ? "no site" : chatSite): \(parts.joined(separator: "; "))")
        }
        // (changes that didn't fit, a shortened file: said, and the chat asked again in its own box, never sent)
        if let r = refusals.first {
            refuse?(r)
            status = r.note + (refuse == nil ? "" : ChatRefusal.inBox)
        }
        lastUnreadable = found.isEmpty && skipped.isEmpty ? (refusals.first?.note ?? why) : nil
        if found.isEmpty, skipped.isEmpty, refusals.isEmpty, let why { status = "The reply's mod can't be added: \(why)." }
        guard !found.isEmpty else { return [] }
        for m in found { chatOffers.note(m.code, .offered) }
        if !hold { offerHeld(found) }
        return found
    }
    /// Why the last hand-over's code couldn't be read, when none of it could (the done banner says so: the note alone
    /// is gone in 2 s, and isn't seen at all from another tab: the mod matrix, 11-19).
    private(set) var lastUnreadable: String?
    /// Mods a chat handed over that wait elsewhere (the done banner's), for the judge's "queued": never offered twice.
    var offersHeld: () -> [InstalledMod] = { [] }
    /// Mods judged and noted as offered, into Add this mod? one after another (now, or once no sheet is up).
    func offerHeld(_ found: [InstalledMod]) {
        guard !found.isEmpty else { return }
        if offerQueue.isEmpty && modOffer == nil { offerBatch = 0; offerShown = 0 }
        offerQueue += found
        offerBatch += found.count
        nextOffer()
    }
    /// A held offer let go without Add (the done banner closed): dismissed, as a sheet swiped away is.
    func dismissHeld(_ mods: [InstalledMod]) {
        for m in mods { chatOffers.note(m.code, .dismissed); Diagnostics.shared.log("chat offers", "\(m.id) dismissed (the done banner closed)") }
    }

    /// The next of a reply's mods, once no other sheet is up (the app calls it again as each one closes).
    func nextOffer() {
        guard modOffer == nil else { return }
        guard !offerQueue.isEmpty else { offerPlace = nil; return }
        offerShown += 1
        offerPlace = offerBatch > 1 ? (offerShown, offerBatch) : nil
        modOffer = offerQueue.removeFirst()
        offerOpen = modOffer
    }

    /// Mods offered from a chat, remembered across launches (ChatOffers.swift), with what came of each.
    let chatOffers = ChatOfferMemory.standard()
    /// (the offer the sheet shows: dismissed when it closes without Add it or Cancel)
    private var offerOpen: InstalledMod?
    /// Add this mod?'s Cancel (declined) or the sheet gone (dismissed, if neither button said otherwise).
    func offerClosed(declined: Bool) {
        guard let m = offerOpen else { return }
        if declined { chatOffers.note(m.code, .declined) } else { chatOffers.note(m.code, .dismissed); offerOpen = nil }
        if let o = chatOffers.outcome(m.code), declined || o == .dismissed { Diagnostics.shared.log("chat offers", "\(m.id) \(o.rawValue)") }
    }

    /// What was pasted (iOS's own Paste button hands it over without asking), or an Add to TRIF tap: a whole mod.
    /// `refuse`: where a refusal's message goes (an Add to TRIF tap: its chat's box); nil (a paste): the clipboard.
    /// `outside`: where it came from when that isn't the person's own act (a page's download): one at a time
    /// (`outsideMayOffer`), and queued behind an offer already shown, never in its place.
    func offer(text pasted: String?, site chatSite: String = "", refuse: ((ChatRefusal) -> Void)? = nil, outside: String? = nil) {
        guard let text = pasted?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            status = outside == nil ? "Nothing on the clipboard." : "That file has no mod in it."
            return
        }
        if let outside, !outsideMayOffer(outside) { return }
        // (shown now, or after the offer that's up: one sheet at a time, never replacing it)
        func present(_ m: InstalledMod) {
            if outside != nil { outsideIds.insert(m.id) }
            if modOffer == nil { modOffer = m } else { offerQueue.append(m) }
        }
        if outside != nil { outsideReading += 1 }
        // (edit blocks (Tim, 11-19): applied to the mod they name, all or nothing, then offered as its new version)
        if ModEdits.has(text) {
            let (here, came) = ModOfferRules.from(chatSite: chatSite, shown: host)
            Task { @MainActor in
                defer { if outside != nil { outsideReading -= 1 } }
                switch prepare(text) {
                case .already:
                    status = ChatRefusal.alreadyNote
                case .refused(let r):
                    Diagnostics.shared.log("chat offers", "\(refuse == nil ? "pasted" : "Add to TRIF") edits refused: \(r.log)")
                    tellRefusal(r, refuse)
                case .texts(let list):
                    guard let p = list.first, let on = p.on else { return }
                    let r = await mods.readInBackground(p.text, file: on.file, site: on.site, here: here)
                    guard var m = r.mod else { status = "That mod can't be added: \(r.error ?? "no reason given")."; return }
                    if let no = shortened(p.text, m) { tellRefusal(no, refuse); return }
                    m.cameFrom = came
                    m.edits = p.edits
                    Diagnostics.shared.log("chat offers", "\(refuse == nil ? "pasted" : "Add to TRIF"): \(m.id), \(p.edits?.count ?? 0) change(s) from edit blocks")
                    // (several mods' edits in one text: the first now, the rest after it, as a reply's mods)
                    present(m)
                    if list.count > 1 {
                        for q in list.dropFirst() {
                            guard let o = q.on, var n = (await mods.readInBackground(q.text, file: o.file, site: o.site, here: here)).mod else { continue }
                            n.cameFrom = came; n.edits = q.edits; present(n)
                        }
                    }
                }
            }
            return
        }
        // (a whole mod: a chat's reply with a ==WebMod== file in it, or the file)
        if text.contains("==WebMod==") {
            // (an Add to TRIF tap in a chat: that chat's site, whichever tab is shown, as offerFromChat: the same shared
            // rule, so a computer's phone twin (phone~<site>) is its site here too, as the spec says; round 8 fixed it)
            let (here, came) = ModOfferRules.from(chatSite: chatSite, shown: host)
            Task { @MainActor in
                defer { if outside != nil { outsideReading -= 1 } }
                let r = await mods.readNamedInBackground(text, here: here)
                if var m = r.mod {
                    // (a whole file that leaves parts of the mod here out: refused, the chat asked for all of it)
                    if let no = shortened(text, m) { Diagnostics.shared.log("chat offers", "\(refuse == nil ? "pasted" : "Add to TRIF"): refused \(no.log)"); tellRefusal(no, refuse); return }
                    m.cameFrom = came; present(m)
                } else { status = "That mod can't be added: \(r.error ?? "no reason given")." }
            }
            return
        }
        if outside != nil { outsideReading -= 1 }
        status = outside == nil ? "The clipboard has no mod." : "That file has no mod in it."
    }

    // MARK: edit blocks and shortened files (Tim, 11-19; the rule: mobile/shared/core/mod-edit.js)

    /// A text ready to read: a whole file (`on` nil), or a mod's new code from edit blocks (`on`: the mod, `edits`:
    /// the changes).
    struct Prepared { var text: String; var edits: [ModEdits.Change]?; var on: InstalledMod? }
    enum PrepareOutcome { case texts([Prepared]), already([String]), refused(ChatRefusal) }

    /// A chat's text before it's read as a mod: edit blocks applied to the mods they name (all of them, or none), or
    /// why not; a whole file as it is.
    func prepare(_ text: String) -> PrepareOutcome {
        let here = mods.mods.map { ModEdits.Mod(id: $0.id, name: $0.name, code: $0.code, history: $0.history.map(\.code)) }
        switch ModEdits.resolve(text, mods: here) {
        case .whole: return .texts([Prepared(text: text, edits: nil, on: nil)])
        case .already(let ids): return .already(ids)
        case .edited(let list):
            return .texts(list.compactMap { e in mods.mods.first { $0.id == e.id }.map { Prepared(text: e.code, edits: e.changes, on: $0) } })
        case .refused(let id, let why, let block):
            let m = id.flatMap { i in mods.mods.first { $0.id == i } }
            return .refused(ChatRefusal.edits(why, mod: m.map { ($0.id, $0.name, $0.code) }, block: block))
        }
    }

    /// A text offered for a mod here that leaves parts of it out (a chat's "// rest unchanged"): the refusal, or nil.
    func shortened(_ text: String, _ m: InstalledMod) -> ChatRefusal? {
        guard let now = mods.mods.first(where: { $0.id == m.id }), let e = ModEdits.elided(m.code, current: now.code) else { return nil }
        return ChatRefusal.shortened((now.id, now.name, now.code), line: e.line, text: e.text)
    }

    /// A refusal said: the note, and the message for the chat in its box (`refuse`), else on the clipboard.
    func tellRefusal(_ r: ChatRefusal, _ refuse: ((ChatRefusal) -> Void)?) {
        if let refuse { refuse(r); status = r.note + ChatRefusal.inBox; return }
        UIPasteboard.general.string = r.request
        status = r.note + ChatRefusal.copied
    }

    // MARK: hiding (what point-and-hide hid before 11-17: still hidden, each shown again from the Mods tab)

    func applyRulesNow() async {
        let selectors = report.rules.filter { $0.host == host }.map { $0.selector }
        let result = await call("return JSON.stringify(globalThis.__trifKit.hide(selectors));", ["selectors": selectors], in: Browser.trifWorld)
        if let error = result.error { status = "Couldn't hide: \(error)" }
    }

    /// Shows a hidden thing again, at once (no reload), from the Mods tab's list.
    func unhide(_ rule: HideRule) async {
        report.remove(rule)
        report.log("hidden", "\(rule.host): shown again: \(rule.selector)")
        installScripts()
        if rule.host == host { await applyRulesNow() }
    }

    // MARK: the two-finger hold

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
    /// When listening last started (ms since 1970), for what it paused (BackgroundPlay.resumeAfterTalk).
    var talkStarted: Double?
    static let clickGuard = """
    if (!window.__trifClickGuard) {
      window.__trifClickGuard = true;
      window.addEventListener('click', (e) => { if (Date.now() < (window.__trifNoClickUntil || 0)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    }
    window.__trifNoClickUntil = Date.now() + 800;
    return 'ok';
    """

    // MARK: the outline

    /// `budgetMs`: the walk stops after that long (a big page's whole walk took seconds on an iPhone SE), and the
    /// outline then says it's partial (agent-facing words).
    func outline(_ maxChars: Int = 6000, budgetMs: Int = 300) async -> (text: String, chars: Int, tokens: Int)? {
        await ensureKit()
        let result = await call("return JSON.stringify(globalThis.__trifKit.outline(max, budget));", ["max": maxChars, "budget": budgetMs], in: Browser.trifWorld)
        guard let o = Browser.parse(result.text) as? [String: Any], var text = o["text"] as? String else {
            status = "No outline: \(result.error ?? "the page has no kit")"
            return nil
        }
        if o["partial"] as? Bool == true { text += "\n(Partial: the page is big, so TRIF stopped outlining it after \(budgetMs) ms. The screenshot shows what's on the screen.)" }
        return (text, o["chars"] as? Int ?? text.count, o["tokens"] as? Int ?? 0)
    }

    /// Copy diagnostics (the ⋯ menu): the text Send diagnostics… sends, on the clipboard, and "Copied.".
    func copyDiagnostics() {
        UIPasteboard.general.string = Diagnostics.shared.text()
        status = "Copied."
        report.log("diagnostics", "copied")
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

    /// The last line of what TRIF puts in a chat's box about a page (agent-facing; chat.js OUR_END, the same words): where
    /// TRIF's text ends, so an old fill can be taken out of the box and the person's own words around it kept (11-18).
    static let fillEnd = "--- End of what TRIF sent ---"

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
            I'm looking at \(page?.absoluteString ?? host) in TRIF (how TRIF mods are written is in this project's instructions). Its @match must cover \(origin)/*; for the whole site, all of its subdomains too (https://*.\(SiteAccess.shared.scope(page?.host ?? host))/*). No other sites: never example.com or any placeholder. A screenshot is attached; below is an outline of the page, each line starting with a CSS selector.
            \(here)
            --- The page: \(page?.absoluteString ?? host) ---
            \(o.text)
            \(Browser.fillEnd)
            """
            report.log("outline", "\(host): \(o.chars) characters, for a chat in TRIF's project (\(r.count) characters in all, without the guide)")
            return r
        }
        let request = """
        I'm looking at \(page?.absoluteString ?? host) in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page: each line starts with a CSS selector for a part of it.

        I'll say what I want changed. For a new mod, reply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod; a free mod only if it really needs the page's own code. Always in a code block in the reply, however long, not as an attached file. Its @match must cover \(origin)/*; when I mean the whole site, match all of its subdomains too (for \(page?.host ?? host): https://*.\(SiteAccess.shared.scope(page?.host ?? host))/*), as a site's pages are often on several (en.wikipedia.org, not only www.wikipedia.org). No other sites: never example.com or any placeholder. In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet). To change a mod already here, use edit blocks, as below.

        A screenshot of what I see is attached, only to show you the page: never edit it or make an image; every change I ask for is a TRIF mod, written as code. Everything you need is in what I send: don't open the page in a browser, a connected computer or any other tool; work from these and answer straight away.

        --- How TRIF mods are written ---
        \(Browser.resource("mod-guide", "txt"))
        \(here)
        --- The page: \(page?.absoluteString ?? host) ---
        \(o.text)
        \(Browser.fillEnd)
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
            t += "Mods switched on here. A new @name adds a mod beside them. If one of them is what's in the way, fix that one rather than adding a mod that works around it.\n\(Browser.editHowTo)"
            for m in others {
                // (each with the line its edit blocks start with: its file and the version of the code given here)
                let line = ChatRefusal.editLine(m.id, m.code).map { " · edit with: \($0)" } ?? ""
                if let conv, chatHas(m, conv) { t += "\n### \(m.name) (\(m.tierName.lowercased()))\(line): unchanged since you last saw its code in this chat\n"; continue }
                t += "\n### \(m.name) (\(m.tierName.lowercased()))\(line)\n```js\n\(m.code)\n```\n"
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

    /// How a chat changes a mod it was given (agent-facing; Tim, 11-19): edit blocks, not the whole file again
    /// (mobile/shared/core/mod-edit.js reads them). Short: models follow a short format best.
    static let editHowTo = """
    To change one, reply with edit blocks in one code block: first its "edit with" line, then for each change
    <<<<<<< SEARCH
    a few whole lines copied exactly from the mod
    =======
    the lines that replace them
    >>>>>>> REPLACE
    Each SEARCH must match exactly one place in the mod. To add lines, keep an anchor line in both parts; to delete, leave the replacement empty. Send its whole file with the same @name instead only when the change touches most of it, and never leave parts out of a whole file ("// rest unchanged").

    """

    /// The page's parts and sizes now, to say next time what disappeared since (once the chat has its text: it
    /// isn't needed for this one).
    func noteBaseline() async {
        await ensureKit()
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
        var text = "Here's \(page) in TRIF now: a screenshot of what's on the screen is attached (only to show you the page: never edit it or make an image; every change is a TRIF mod, written as code), and the page's outline is below."
        if let a = lastAdded, on.contains(where: { $0.id == a.id }) { text += " I added your mod \"\(a.name)\"; the page was reloaded with it."; lastAdded = nil }
        text += "\n"
        if !lines.isEmpty {
            text += "\nWhat disappeared or shrank since I last sent you this page:\n\(lines.joined(separator: "\n"))\n(The page may have been reloaded since, so anything that opens when I type or click, like a menu, is closed now: some of these may be closed, not gone.)\n"
        }
        let here = await alreadyHere(conv: conv)
        sw?.lap("mods and their errors", "\(on.count) mods")
        text += here.isEmpty ? "\nNo TRIF mods are running on this page, and nothing on it is hidden.\n" : here
        text += "\nI'll say what I want changed. As before: a new mod as its whole file in one code block, nothing to fill in, never as an attached file; to change a mod above, edit blocks as described there. Work from what I've attached; don't open the page in a browser or another tool.\n"
        text += "\n--- The page now: \(page) ---\n\(o.text)\n\(Browser.fillEnd)\n"
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

    // MARK: the app end of TRIF's world

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        // (only from a page TRIF is connected on: a disconnected page has no handler of TRIF's at all; this is the second wall)
        // (by the sending page's own origin: a page's start can speak before its commit has reached the app)
        let o = message.frameInfo.securityOrigin
        guard SiteAccess.shared.allows(URL(string: "\(o.protocol)://\(o.host)\(o.port > 0 ? ":\(o.port)" : "")/")) else {
            Diagnostics.shared.log("site access", "a message from a page TRIF isn't connected on was refused (\(o.host))")
            return (nil, "TRIF is disconnected here")
        }
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
        case "modlog":
            // (a free mod's start, its window.trif.log/warn/error lines and its errors: modfile.js freeRelay, which caps
            // them; told by the page's world, so cut again here and kept to what the mod passed)
            let cut = { (k: String, n: Int) in String((body[k] as? String ?? "").prefix(n)) }
            let kind = cut("kind", 8), mod = cut("mod", 100), path = cut("path", 100), text = cut("text", 240)
            let host = message.webView?.url?.host ?? "?"
            Diagnostics.shared.log("mod log", kind == "start" ? "\(mod) started on \(host)\(path)" : "\(mod) on \(host)\(path): \(kind == "log" ? "" : "\(kind): ")\(text)")
            return (["ok": true], nil)
        default:
            return (nil, "unknown message")
        }
    }

    // MARK: links for other apps (Tim, 11-18: tel:, mailto:, sms:, maps:, fb-messenger:… did nothing)

    /// (the web views whose current load has had its question, answered or not: one a load. Cleared as each commits)
    private var askedLoads = Set<ObjectIdentifier>()
    private weak var appLinkAlert: UIAlertController?
    private var droppedLines: [ObjectIdentifier: String] = [:]

    func appLinkNewLoad(_ webView: WKWebView) { askedLoads.remove(ObjectIdentifier(webView)); droppedLines[ObjectIdentifier(webView)] = nil }

    /// A navigation to another app's link, from a tab's page or a chat's: tapped (a link or form, the finger on the
    /// page just now, or a menu) opens it at once.
    func appLink(_ url: URL, action: WKNavigationAction, from webView: WKWebView, source: String, shown: Bool? = nil) {
        let tapped = TouchClock.tapped(linkOrForm: [.linkActivated, .formSubmitted].contains(action.navigationType))
        appLink(url, tapped: tapped, mainFrame: action.targetFrame?.isMainFrame ?? true, from: webView, source: source, shown: shown)
    }

    /// Another app's link: to iOS at once when the person tapped it; a page doing it by itself (a script, a redirect,
    /// a refresh) gets Safari's question, if it's the page on the screen, one question at a time and one a load; a
    /// frame inside the page, a tab behind, More's panel (`mayAsk` false): nothing unless tapped.
    func appLink(_ url: URL, tapped: Bool, mainFrame: Bool, from webView: WKWebView?, source: String, shown: Bool? = nil, mayAsk: Bool = true) {
        let key = webView.map { ObjectIdentifier($0) }
        let onScreen = shown ?? (webView === self.webView)
        let active = UIApplication.shared.applicationState == .active
        let d = AppLinks.decide(tapped: tapped, mainFrame: mainFrame, askedThisLoad: key.map { askedLoads.contains($0) } ?? false,
                                asking: appLinkAlert != nil, mayAsk: mayAsk && onScreen && active)
        switch d {
        case .open:
            handToIOS(url, source: source, how: "tapped")
        case .drop(let why):
            let reason = !onScreen && !tapped ? "not tapped, not on the screen" : !active && !tapped ? "not tapped, the app not in front" : why
            let line = "\(AppLinks.logged(url)) from \(source), not opened: \(reason)"
            // (a page trying again and again: its line once a load)
            if let key { if droppedLines[key] == line { return }; droppedLines[key] = line }
            Diagnostics.shared.log("app link", line)
        case .ask:
            if let key { askedLoads.insert(key) }
            askToOpen(url, source: source)
        }
    }

    /// Safari's question, over whatever is up (a sheet too).
    private func askToOpen(_ url: URL, source: String) {
        guard let top = Browser.topController() else {
            Diagnostics.shared.log("app link", "\(AppLinks.logged(url)) from \(source), not opened: nowhere to ask")
            return
        }
        let a = UIAlertController(title: AppLinks.question(url), message: nil, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: AppLinks.cancelWord, style: .cancel) { _ in
            Diagnostics.shared.log("app link", "\(AppLinks.logged(url)) from \(source): asked, Cancel")
        })
        a.addAction(UIAlertAction(title: AppLinks.openWord, style: .default) { [weak self] _ in
            self?.handToIOS(url, source: source, how: "asked, Open")
        })
        appLinkAlert = a
        top.present(a, animated: true)
        Diagnostics.shared.log("app link", "\(AppLinks.logged(url)) from \(source): asked")
    }

    private func handToIOS(_ url: URL, source: String, how: String) {
        UIApplication.shared.open(url, options: [:]) { [weak self] ok in
            Diagnostics.shared.log("app link", "\(AppLinks.logged(url)) from \(source), \(how): \(ok ? "handed to iOS" : "no app for it")")
            if !ok { self?.status = AppLinks.noApp }
        }
    }

    /// The controller on top (a sheet's, an alert's), to put a question over.
    static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard var c = (scenes.compactMap { $0.keyWindow }.first ?? scenes.flatMap(\.windows).first { $0.isKeyWindow })?.rootViewController else { return nil }
        while let p = c.presentedViewController, !p.isBeingDismissed { c = p }
        return c
    }

    /// (dev step: the question shown, if any)
    var appLinkAsking: String? { appLinkAlert?.title }

    // MARK: navigation

    /// (with the page's preferences: Request Desktop Website's sites load in WebKit's desktop mode, below)
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        let policy = await decidePolicy(webView, navigationAction)
        if policy == .allow, navigationAction.targetFrame?.isMainFrame ?? true, navigationAction.navigationType == .reload {
            let t = tab(of: webView)
            // (none of the app's (those say theirs as they ask, `reload`): the page's own location.reload(), or WebKit's own)
            if t?.reloadCause == nil { logReload(t, navigationAction.request.url ?? webView.url, "the page reloaded itself (location.reload or a refresh)") }
        }
        // (only the page itself: a frame inside it follows the page's mode. A new window's first load comes with no frame)
        if policy == .allow, navigationAction.targetFrame?.isMainFrame ?? true, let url = navigationAction.request.url,
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            let desktop = wantsDesktop(url)
            if desktop { preferences.preferredContentMode = .desktop }
            // (WebKit's desktop user agent ends with the configuration's application name, ours the phone's Safari
            // words "Mobile/15E148 Safari/604.1", which sites read as a phone: a Mac Safari's whole user agent instead,
            // set before this answer so this load already carries it. Back to the phone's on a site that isn't asked for)
            let agent = desktop ? Browser.desktopAgent : nil
            if (webView.customUserAgent ?? "") != (agent ?? "") { webView.customUserAgent = agent }
            tab(of: webView)?.desktop = desktop
        }
        // (site access: the tab's controller holds what the page it's going to may have, before that page starts)
        if policy == .allow, navigationAction.targetFrame?.isMainFrame ?? true, let t = tab(of: webView) {
            t.responseAccess = nil
            applyAccess(t, navigationAction.request.url, response: false)
        }
        return (policy, preferences)
    }

    private func decidePolicy(_ webView: WKWebView, _ navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if navigationAction.targetFrame?.isMainFrame ?? true, Browser.isModLink(url) {
            stopModLink(url, from: "the page")
            return .cancel
        }
        let scheme = url.scheme ?? ""
        if navigationAction.navigationType == .linkActivated, Date() < ignoreLinksUntil, webView === self.webView { return .cancel }
        // (another app's link, tel:, mailto:, maps:, fb-messenger:…: to iOS, as Safari; javascript:, file: and TRIF's
        // own schemes never. http/https stay in TRIF, below)
        switch AppLinks.kind(url) {
        case .never, .own:
            if navigationAction.targetFrame?.isMainFrame ?? true, scheme != "javascript" { report.log("link", "not followed: \(AppLinks.logged(url))") }
            return .cancel
        case .other:
            appLink(url, action: navigationAction, from: webView, source: "a page")
            return .cancel
        case .web, .stay: break
        }
        // (in full screen, a link the person taps to another site opens in TRIF's own view, in a new tab; the full-screen
        // tab stays on its site. Redirects and sign-in hops are left alone: only a tapped link)
        let here = Site.of(webView.url?.host ?? "")
        if fullScreen, webView === self.webView, navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame ?? false,
           ["http", "https"].contains(scheme), !here.isEmpty, !Site.host(url.host ?? "", isIn: here) {
            newTab(url.absoluteString)
            setFullScreen(false, note: false)
            report.log("fullscreen", "a link from \(here) in full screen to \(url.host ?? "?"): TRIF view, a new tab")
            return .cancel
        }
        if ModDownloads.wanted(navigationAction) { return .download }
        return ["http", "https", "about", "blob", "data", PageSchemeHandler.scheme].contains(scheme) ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if ModDownloads.wanted(navigationResponse) { return .download }
        // (the address the page really comes from, after any redirect: its controller set for that, before it commits)
        if navigationResponse.isForMainFrame, let t = tab(of: webView) { applyAccess(t, navigationResponse.response.url ?? webView.url, response: true) }
        return .allow
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

    /// The page that came in says what its tab's mode says (Request Desktop Website). A page WebKit brings back from
    /// its back/forward memory comes in its own page process, which keeps the user agent it had: in the Simulator
    /// (11-18) back from another site to a desktop site's page said "iPhone" in navigator and in its own requests.
    /// Then the tab's agent is put to that process again (set to the other and back, so WebKit sends it) and the
    /// page loaded again; at most once every 10 s a tab, so it can never loop.
    private func checkAgent(_ tab: Tab, _ webView: WKWebView) {
        // (an iPhone's: an iPad's own pages are a computer's already, WebKit's recommended mode there)
        // (asked in the browser features' world: on every site, connected or not)
        guard UIDevice.current.userInterfaceIdiom == .phone, let tv = webView as? TabWebView,
              let url = webView.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        let want = tab.desktop
        Task { @MainActor [weak self, weak tv, weak tab] in
            guard let self, let webView = tv, let tab,
                  let agent = try? await webView.browserFeature(.userAgent),
                  agent.contains("Macintosh") != want, tab.desktop == want, webView.url == url,
                  Date().timeIntervalSince(tab.agentFixedAt ?? .distantPast) > 10 else { return }
            tab.agentFixedAt = Date()
            let set = webView.customUserAgent
            webView.customUserAgent = want ? nil : Browser.desktopAgent
            webView.customUserAgent = set
            Diagnostics.shared.log("desktop", "\(Diagnostics.place(url)) came back as \(want ? "a phone's" : "a computer's") page: its agent put again, loaded again")
            self.report.log("desktop", "agent fixed: \(Diagnostics.place(url))")
            self.reload(tab, "desktop mode: back/forward brought the page back in the other mode's agent")
        }
    }

    /// A page came into a tab: which of TRIF's sets it was loaded with (its response's, or, for a page WebKit brought back
    /// from its back/forward memory, which never asks, the one its item was loaded with), whether TRIF may read it, and a
    /// page brought back with TRIF in it on a site disconnected since: loaded again, so it comes without.
    private func accessCommitted(_ t: Tab, _ webView: WKWebView) {
        let item = webView.backForwardList.currentItem
        let fresh = t.responseAccess
        let key = fresh ?? item.flatMap { t.itemAccess.object(forKey: $0) as String? } ?? "unknown"
        t.responseAccess = nil
        if let item { t.itemAccess.setObject(key as NSString, forKey: item) }
        t.pageAccess = key
        let allowed = SiteAccess.shared.allows(webView.url)
        (webView as? TabWebView)?.pageConnected = allowed && key != "plain" && key != "unknown"
        if key != "plain", !allowed, fresh == nil, webView.url.map({ ["http", "https"].contains($0.scheme?.lowercased() ?? "") }) == true {
            reload(t, "site access: the page came back from WebKit's memory with TRIF in it, and TRIF isn't connected on its site now")
        }
    }

    /// After a connect or a disconnect (SiteAccess.onChange). Connected: the tab shown there may be read at once (the quick
    /// ask goes on with no reload: TRIF's kit is put in when the page is first read), and it loads again only if mods
    /// would run there (refreshIfStale: what runs changed); tabs behind there when shown. Disconnected: TRIF stops there
    /// at once: the tab shown loads again without TRIF (even while it plays: the person's own act), tabs behind on it let
    /// go (each loads plain when shown). Its mods and switches are kept for when it's connected again.
    func accessChanged(_ site: String, connected on: Bool) {
        let on_ = { (t: Tab) -> Bool in !site.isEmpty && SiteAccess.shared.scope(t.host) == site }
        if site.isEmpty {
            // (the person's sensitive list changed: every tab takes its set again at its next load)
            sensitiveSets = [:]
            for t in tabs { t.accessVersion = -1 }
            if let t = current, t.webView.url != nil { reload(t, "site access: the sensitive sites changed") }
            pageChanged += 1
            return
        }
        for t in tabs where on_(t) {
            t.accessVersion = -1
            if on {
                if t === current {
                    (t.webView as? TabWebView)?.pageConnected = SiteAccess.shared.allows(t.webView.url)
                    refreshIfStale(t, "TRIF connected on \(site)", evenPlaying: false)
                }
            } else {
                (t.webView as? TabWebView)?.pageConnected = false
                if t === current { if t.webView.url != nil { reload(t, "site access: TRIF disconnected on \(site)") } }
                else if t.started { letGo[t.id]?.cancel(); letGo[t.id] = nil; discard(t, "TRIF was disconnected on its site") }
            }
        }
        pageChanged += 1
    }

    /// TRIF's kit in the shown page if it isn't there (a page loaded before its site was connected): put in when the page
    /// is first read, so Connect needs no reload for the quick ask.
    func ensureKit() async {
        guard (webView as? TabWebView)?.readable == true else { return }
        let has = await call("return String(typeof globalThis.__trifKit !== 'undefined');", in: Browser.trifWorld)
        guard has.text == "false" else { return }
        let e = await load(Browser.resource("kit", "js"), in: Browser.trifWorld)
        Diagnostics.shared.log("site access", "TRIF's kit put in \(Diagnostics.place(webView.url)) as it was first read\(e.map { ": \($0)" } ?? "")")
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        tab(of: webView)?.url = webView.url
        tab(of: webView)?.reloadCause = nil
        // (after the cause is cleared: a reload it asks for keeps its own)
        if let t = tab(of: webView) { accessCommitted(t, webView) }
        appLinkNewLoad(webView)
        // (a new page: not drawn until it has finished, or a while has passed; its tab keeps the picture it had)
        if let t = tab(of: webView) { t.committedAt = Date(); t.finishedAt = nil }
        if let t = tab(of: webView) { checkAgent(t, webView) }
        // (a change to the mods not in the scripts yet: this page has the old ones, so it counts as stale)
        if let t = tab(of: webView), let u = webView.url?.absoluteString {
            t.modsLoaded = (u, TabReloadRules.loaded(pending: scriptsPending, signature: mods.signature(u)))
            // (which mods this page loaded with: only those can have failed to start on it; the Mods tab)
            t.modsLoadedIds = scriptsPending ? [] : Set(mods.running(on: u).map(\.id))
        }
        guard webView === self.webView else { return }
        address = webView.url?.absoluteString ?? ""
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        CookieKeeper.shared.firstPageLoaded()
        Diagnostics.shared.log("page", "\(Diagnostics.place(webView.url)) loaded, with \(mods.running(on: webView.url?.absoluteString ?? "").map(\.id).joined(separator: ", ").nonEmpty ?? "no mods")")
        if let t = tab(of: webView) { t.loading = false; t.title = webView.title ?? t.title; t.finishedAt = Date() }
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
        // (a load that never came in: the controller back to what the page still shown may have)
        if let t = tab(of: webView), !webView.isLoading { t.responseAccess = nil; applyAccess(t, webView.url, response: false) }
        tab(of: webView)?.loading = webView.isLoading
        if !webView.isLoading { tab(of: webView)?.reloadCause = nil }
        guard webView === self.webView else { return }
        loading = webView.isLoading
        if !Browser.stoppedNotFailed(error) { status = error.localizedDescription }
        resumeLoadWaiters()
    }

    /// A link or page that opens a window: a new tab after this one (made from the configuration WebKit hands over,
    /// so the page that opened it can still talk to it, as a sign-in window needs).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, Browser.isModLink(url) { stopModLink(url, from: "the page"); return nil }
        // (a window for another app's link, target=_blank or window.open: to iOS, no empty tab. WebKit lets a page open a
        // window only from a tap, but the finger is checked too)
        if let url = navigationAction.request.url, AppLinks.kind(url) != .web, AppLinks.kind(url) != .stay {
            if AppLinks.kind(url) == .other { appLink(url, tapped: TouchClock.tapped(linkOrForm: true), mainFrame: true, from: webView, source: "a page's new window") }
            return nil
        }
        let t = makeTab(configuration: configuration)
        t.started = true
        // (its opener: where it goes back to when the page closes it, as a sign-in window does)
        t.opener = tab(of: webView)
        // (a window the page opens: a new tab, in the view the person is in: a sign-in window in full screen stays so)
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
        // (a black page until it's loaded again: never pictured)
        if let t = tab(of: webView) { t.committedAt = nil; t.finishedAt = nil }
        let warned = lastMemoryWarning.map { " a memory warning \(Int(Date().timeIntervalSince($0))) s before," } ?? ""
        let cause = "WebKit ended its page's process (\(Diagnostics.freeMB()) MB left for the app,\(warned) \(tabs.filter { $0.started && $0.webView.url != nil }.count) tabs with pages)"
        // (a tab behind isn't loaded again now, as Safari's isn't: its page loads when it's shown, its video picked up
        // there. Before 11-18 it loaded at once, unseen, into the memory that had just run out, and the video in it
        // stayed paused anyway: WebKit doesn't load media for a page that isn't on the screen)
        if url != nil, let t = tab(of: webView), t !== current {
            letGo[t.id]?.cancel(); letGo[t.id] = nil
            discard(t, cause)
            return
        }
        if url != nil { if let t = tab(of: webView) { reload(t, cause) } else { webView.reload() } }
    }

    /// A page's own window closed itself (window.close(): a sign-in popup done): its tab closes and, if it was the tab
    /// shown, the tab that opened it is shown again while it's still open (Tim, 11-18, as the Android app does; before,
    /// whichever tab came next took its place). A window closed in a tab behind leaves the shown tab as it is.
    func webViewDidClose(_ webView: WKWebView) {
        guard let t = tab(of: webView) else { return }
        report.log("tabs", "a page closed its own window\(t.opener.map { o in tabs.contains { $0 === o } ? "; back to its opener, \(Diagnostics.place(o.webView.url))" : "; its opener is gone" } ?? "")")
        close(t, showing: t.opener)
    }

    /// A long press on a link or a picture: the system's menu and preview, as in Safari (Tim, 11-17: "normal iphone
    /// behaviour"). The system's own items stay (`suggested`: Open, Add to Reading List, Copy Link, Share…, and a
    /// picture's Save to Photos, Copy…); a link also gets Open in New Tab first, a TRIF tab after this one. A web link's
    /// preview is the page itself, as Safari's (`LinkPreview`; WebKit draws only the link's highlight once the app gives
    /// the menu); tapping it opens the link in this tab, as Safari does. A picture keeps WebKit's own preview.
    func webView(_ webView: WKWebView, contextMenuConfigurationFor elementInfo: WKContextMenuElementInfo) async -> UIContextMenuConfiguration? {
        let link = elementInfo.linkURL.flatMap { Browser.opensInNewTab($0) ? $0 : nil }
        let web = link.flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0 : nil }
        let store = config.websiteDataStore, agent = config.applicationNameForUserAgent, desktop = wantsDesktop(web)
        // (the preview the page's width and about half its height, so the whole menu fits under it on an SE: at full
        // height, Copy Link and Share… were off the screen's foot)
        let size = CGSize(width: webView.bounds.width, height: (webView.bounds.height * 0.5).rounded())
        let preview: UIContextMenuContentPreviewProvider? = web.map { url in { LinkPreview(url: url, store: store, agent: agent, desktop: desktop, size: size) } }
        return UIContextMenuConfiguration(identifier: nil, previewProvider: preview) { [weak self, weak webView] suggested in
            guard let link else { return UIMenu(children: suggested) }
            let open = UIAction(title: "Open in New Tab", image: UIImage(systemName: "plus.square.on.square")) { _ in
                Task { @MainActor in self?.openInNewTab(link, after: webView) }
            }
            return UIMenu(children: [UIMenu(options: .displayInline, children: [open])] + suggested)
        }
    }

    /// The preview tapped: the link opens in its own tab, as Safari does.
    func webView(_ webView: WKWebView, contextMenuForElement elementInfo: WKContextMenuElementInfo, willCommitWithAnimator animator: UIContextMenuInteractionCommitAnimating) {
        guard let url = elementInfo.linkURL else { return }
        animator.addCompletion { [weak self, weak webView] in
            guard let self, let webView else { return }
            if Browser.isModLink(url) { self.stopModLink(url, from: "a link's preview"); return }
            if AppLinks.kind(url) == .other { self.appLink(url, tapped: true, mainFrame: true, from: webView, source: "a link's preview"); return }
            webView.load(URLRequest(url: url))
        }
    }

    // (the menu's own Open is WebKit's, a link activated with no finger on the page: chosen from the menu, so a tap)
    func webView(_ webView: WKWebView, contextMenuWillPresentForElement elementInfo: WKContextMenuElementInfo) { TouchClock.menuOpen = true }
    func webView(_ webView: WKWebView, contextMenuDidEndForElement elementInfo: WKContextMenuElementInfo) {
        TouchClock.menuOpen = false
        TouchClock.menuUntil = Date().addingTimeInterval(1)
    }

    /// Links a new tab can open (not javascript:, which runs in the page it's on).
    nonisolated static func opensInNewTab(_ url: URL) -> Bool { url.scheme?.lowercased() != "javascript" }

    /// Open in New Tab: a tab right after the one the link was on, shown, as a page's own new window opens.
    func openInNewTab(_ url: URL, after webView: WKWebView?) {
        if Browser.isModLink(url) { stopModLink(url, from: "Open in New Tab"); return }
        // (another app's link: to iOS, the person chose it; no empty tab)
        switch AppLinks.kind(url) {
        case .other: appLink(url, tapped: true, mainFrame: true, from: webView, source: "Open in New Tab"); return
        case .never, .own: return
        case .web, .stay: break
        }
        // (in full screen, a link to another site opens in TRIF view, as a tapped one does: decidePolicyFor)
        let here = Site.of(webView?.url?.host ?? "")
        let leaves = fullScreen && ["http", "https"].contains(url.scheme?.lowercased() ?? "") && !here.isEmpty && !Site.host(url.host ?? "", isIn: here)
        let t = makeTab()
        t.started = true
        let at = (tabs.firstIndex { $0.webView === webView } ?? tabs.firstIndex { $0 === current } ?? tabs.count - 1) + 1
        tabs.insert(t, at: at)
        select(t)
        if leaves { setFullScreen(false, note: false) }
        t.webView.load(URLRequest(url: url))
        report.log("link", "opened in a new tab: \(Diagnostics.place(url))\(leaves ? ", from full screen on \(here): TRIF view" : "")")
    }
}

/// A link's preview on a long press: the page in a web view of its own, with the tabs' cookies but none of TRIF's
/// scripts (no mods: it's a glance), quiet (nothing plays without a tap), no taps (the preview is one button).
final class LinkPreview: UIViewController {
    private let url: URL
    private let store: WKWebsiteDataStore
    private let agent: String?
    private let desktop: Bool
    init(url: URL, store: WKWebsiteDataStore, agent: String?, desktop: Bool, size: CGSize) {
        self.url = url; self.store = store; self.agent = agent; self.desktop = desktop
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = size
    }
    required init?(coder: NSCoder) { nil }
    override func loadView() {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = store
        c.applicationNameForUserAgent = agent
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = .all
        // (a site asked for as a computer's previews as one, as its tab would load it)
        if desktop { c.defaultWebpagePreferences.preferredContentMode = .desktop }
        let wv = WKWebView(frame: .zero, configuration: c)
        wv.isUserInteractionEnabled = false
        if desktop { wv.customUserAgent = Browser.desktopAgent }
        wv.load(URLRequest(url: url))
        view = wv
    }
}

struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

extension Browser {
    /// The page's video messages (VideoResume.watch). Its state is kept in the tab (and on disk); the plan is the
    /// saved state if VideoResume.decide says this load picks it up. A back/forward that loaded its page again (not
    /// from WebKit's page memory) is a reload line too.
    func videoMessage(_ type: String, _ body: [String: Any], _ webView: TabWebView?) async -> (Any?, String?) {
        guard let webView, let tab = tabs.first(where: { $0.webView === webView }) else { return (["ok": false], nil) }
        let host = webView.url?.host ?? "a page"
        switch type {
        case "videoplan":
            let address = body["url"] as? String ?? webView.url?.absoluteString ?? ""
            if body["nav"] as? String == "back_forward" { Diagnostics.shared.log("reload", "reload \(host): back/forward (its page loaded again, not kept by WebKit)\(tab === current ? "" : " (a tab behind)")") }
            let d = VideoResume.decide(saved: tab.video, address: address)
            if tab.video != nil { report.log("video", "\(host): \(d.why)") }
            guard let plan = d.plan else { return (["plan": NSNull()], nil) }
            return (["plan": VideoResume.planObject(plan, address: address)], nil)
        case "videostate":
            guard let st = VideoResume.state(from: body) else { return (["ok": false], nil) }
            tab.video = st
            VideoStore.shared.set(tab.id, st)
            return (["ok": true], nil)
        case "videoapplied":
            let t = (body["time"] as? NSNumber)?.doubleValue ?? 0
            Diagnostics.shared.log("video", "resumed a video at \(VideoResume.clock(t)) on \(host)")
            return (["ok": true], nil)
        case "videoplay":
            // (the app's own play: counts as the person's, so sound is allowed where the page's own play isn't)
            let r = await Browser.within(3, "no answer") { () -> String in
                let v = try? await webView.browserFeature(.play(forceMuted: DevFlags.args.contains("-resumemuted")))
                return v ?? "no answer"
            }
            report.log("video", "\(host): play after resuming: \(r)")
            if r == "muted", tab === current {
                status = Browser.tapForSound
                soundTab = tab
            }
            return (["ok": true, "played": r], nil)
        case "videoresumed":
            report.log("video", "\(host): \(body["why"] as? String ?? "?"), put back \((body["applied"] as? NSNumber)?.intValue ?? 0) time(s), now at \((body["now"] as? NSNumber)?.doubleValue ?? -1)")
            return (["ok": true], nil)
        default:
            return (nil, "unknown message")
        }
    }
    /// The note when a video picked up where it was but iOS let it play only muted (draft wording).
    static let tapForSound = "Tap for sound"
    /// The note's tap: the video's sound on (the person's tap: allowed).
    func soundOn() {
        guard let t = soundTab else { return }
        soundTab = nil
        status = ""
        guard let wv = t.webView as? TabWebView else { return }
        Task { @MainActor in
            let r = try? await wv.browserFeature(.unmute)
            self.report.log("video", "Tap for sound: \(r ?? "no answer")")
        }
    }
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
    /// (in the browser features' world, every page from its start, on every site: BrowserWorld) When each video or audio was last paused, and whether the page
    /// was showing then. As the app leaves (or the phone locks), WebKit pauses a video with sound while the page
    /// still shows, then tells the page it's hidden. At that moment, before the page's own listeners (this one is
    /// the first on the window), what WebKit paused within the last second plays on; a page that pauses as it goes
    /// hidden (YouTube without a background-play mod) then pauses it itself, while hidden, and that's kept.
    /// (TRIF's world sees the real visibilityState, whatever a mod tells the page.)
    static let watch = """
        document.addEventListener('pause', (e) => {
          if (e.isTrusted && e.target instanceof HTMLMediaElement) e.target.__trifPause = { at: Date.now(), visible: document.visibilityState === 'visible' };
        }, true);
        window.addEventListener('visibilitychange', (e) => {
          if (!e.isTrusted || document.visibilityState !== 'hidden') return;
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
    static let playOn = """
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
        guard !DevFlags.args.contains("-nobgresume") else { return }
        // (WebKit pauses as it's told the app left: the same moment as this, give or take: 300 ms before counts)
        let left = Date().timeIntervalSince1970 * 1000
        Task { @MainActor in
            var told = Set<String>()
            for wait in [0.6, 1.4] {
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                guard UIApplication.shared.applicationState == .background else { return }
                for t in browser.tabs where t.started && t.webView.url != nil {
                    guard let wv = t.webView as? TabWebView else { continue }
                    let shown = t === browser.current
                    let r = await Browser.within(1, "no answer") { () -> String in
                        let v = try? await wv.browserFeature(.playOn(left: left, shown: shown))
                        return v ?? "no answer"
                    }
                    if !r.isEmpty, told.insert(r).inserted { Diagnostics.shared.log("audio", "the app went to the background, \(Diagnostics.place(wv.url))\(shown ? "" : " (a background tab)"): \(r)") }
                }
            }
        }
    }

    // MARK: talking (SpeechInput: the quick ask's microphone, the robot held)

    /// (TRIF's world) What plays is paused by TRIF as listening starts, its time kept, so the session's switch to
    /// recording doesn't yank it (Tim, 11-18: the video didn't start again, and hung loading).
    static let talkPause = """
        const out = [];
        for (const m of document.querySelectorAll('video, audio')) {
          if (m.paused || m.ended) continue;
          m.__trifTalk = { at: t0, time: m.currentTime };
          m.pause();
          out.push(m.localName + ' at ' + m.currentTime.toFixed(1) + ' s');
        }
        return out.join(', ');
        """
    /// (TRIF's world) After: what TRIF paused, or what iOS paused as listening started (within 2 s of it), still
    /// paused and not ended (the person or the page didn't play or pause it since), plays on from where it was. Refused
    /// (autoplay rules): left paused there. Playing but stuck (no time going by in 1.2 s and the 0.6 s after, or still in
    /// a seek): marked for talkNudge's steps. Never reloaded. `count`: only how many there are. Answers JSON {lines, stuck}.
    static let talkResume = """
        const due = [...document.querySelectorAll('video, audio')].filter((m) => {
          const p = m.__trifPause, mine = m.__trifTalk && m.__trifTalk.at === t0;
          const near = p && p.at >= t0 - 300 && p.at <= t0 + 2000;
          return (mine || near) && m.paused && !m.ended;
        });
        if (count) return String(due.length);
        const out = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
        let stuck = 0;
        for (const m of due) {
          delete m.__trifTalk;
          const at = m.currentTime;
          try { await m.play(); } catch (e) { out.push(m.localName + ' left paused at ' + at.toFixed(1) + ' s (' + e.name + ')'); continue; }
          // (time going by on two looks: a leap and a stop again isn't playing)
          await wait(1200);
          const mid = m.currentTime;
          await wait(600);
          if (!m.paused && (mid - at < 0.3 || m.currentTime - mid < 0.2 || m.seeking)) { m.__trifStuck = { at, tried: [], seeking: m.seeking }; stuck++; }
          else out.push(m.localName + ' played on from ' + at.toFixed(1) + ' s' + (m.paused ? ', then paused by the page' : ''));
        }
        return JSON.stringify({ lines: out, stuck });
        """
    /// (TRIF's world) A video or sound still stuck after talking (playing, its time not going by, or a seek that never
    /// ends: Tim's reuters.com, 11-18, "nudged: still stuck (3.6 → 3.6 s)" with only a seek to its own time; seen in the
    /// Simulator too, a seek left hanging, `seeking` true for good) gets the next step, each its own call from the app
    /// (so each play() is the app's, a gesture), and then must show time going by on two looks (1.2 s, then 0.6 s
    /// more; a jump and a stop again isn't playing): 1 a seek to its own time and play; 2 pause and play; 3 a quarter
    /// second on and play (past a gap in what it has loaded); 4 a second on; 5 the media element loaded again at its
    /// time (`load()`: the only one that cleared a hanging seek in the Simulator; never for a player's own stream, a
    /// blob: source, which load() would cut off). Never the page. Answers JSON {lines, stuck}: a line once one has
    /// played on, been paused by the page, or tried all.
    static let talkNudge = """
        const steps = ['its own time', 'pause and play', '0.25 s on', '1 s on', 'loaded again at its time'];
        const list = [...document.querySelectorAll('video, audio')].filter((m) => m.__trifStuck);
        const out = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const from = new Map(), skipped = new Set();
        for (const m of list) {
          const end = isFinite(m.duration) ? m.duration - 0.1 : Infinity;
          const t = m.currentTime;
          try {
            if (step === 1) m.currentTime = t;
            else if (step === 2) m.pause();
            else if (step === 5) {
              if (/^blob:/.test(m.currentSrc || m.src || '') || !(m.currentSrc || m.src)) { skipped.add(m); continue; }
              m.load();
              m.currentTime = t;
            } else m.currentTime = Math.min(t + (step === 3 ? 0.25 : 1), end);
            m.play().catch(() => {});
          } catch (e) {}
          from.set(m, step === 5 ? t : m.currentTime); // (after the step's own seek: only time going by counts)
        }
        if (from.size) await wait(1200);
        const mid = new Map([...from.keys()].map((m) => [m, m.currentTime]));
        if (from.size) await wait(600);
        let stuck = 0;
        for (const m of list) {
          const s = m.__trifStuck, tried = s.tried.concat(skipped.has(m) ? [] : [steps[step - 1] || '?']);
          const said = m.localName + ' stuck at ' + s.at.toFixed(1) + ' s' + (s.seeking ? ' (in a seek)' : '') + ', tried ' + tried.join(', ') + ': ';
          const going = from.has(m) && !m.paused && !m.seeking && mid.get(m) - from.get(m) >= 0.3 && m.currentTime - mid.get(m) >= 0.2;
          if (from.has(m) && m.paused) { out.push(said + 'then paused by the page'); delete m.__trifStuck; }
          else if (going) { out.push(said + 'playing after ' + tried[tried.length - 1] + ' (' + s.at.toFixed(1) + ' → ' + m.currentTime.toFixed(1) + ' s)'); delete m.__trifStuck; }
          else if (step >= steps.length) { out.push(said + 'still stuck (' + s.at.toFixed(1) + ' → ' + m.currentTime.toFixed(1) + ' s' + (m.seeking ? ', in a seek' : '') + (skipped.has(m) ? '; its player’s own stream, not loaded again' : '') + ')'); delete m.__trifStuck; }
          else { s.tried = tried; stuck++; }
        }
        return JSON.stringify({ lines: out, stuck });
        """

    /// Listening starts: every tab's playing media paused (each page in TRIF's world), the moment kept.
    @MainActor static func pauseForTalk(_ browser: Browser) {
        let t0 = Date().timeIntervalSince1970 * 1000
        browser.talkStarted = t0
        for t in browser.tabs where t.started && t.webView.url != nil {
            guard let wv = t.webView as? TabWebView else { continue }
            let shown = t === browser.current
            Task { @MainActor in
                let r = await Browser.within(1, "no answer") { () -> String in
                    let v = try? await wv.browserFeature(.talkPause(t0: t0))
                    return v ?? "no answer"
                }
                if !r.isEmpty, r != "no answer" { Diagnostics.shared.log("audio", "talking: paused \(r) in \(Diagnostics.place(wv.url))\(shown ? "" : " (a tab behind)")") }
            }
        }
    }

    /// Listening ended (the session already given back): what was paused plays on, the session active again first.
    @MainActor static func resumeAfterTalk(_ browser: Browser) {
        guard let t0 = browser.talkStarted else { return }
        browser.talkStarted = nil
        let views = browser.tabs.filter { $0.started && $0.webView.url != nil }.compactMap { t in (t.webView as? TabWebView).map { ($0, t === browser.current) } }
        Task { @MainActor in
            var due: [(TabWebView, Bool)] = []
            for (wv, shown) in views {
                let n = await Browser.within(1, "0") { () -> String in
                    let v = try? await wv.browserFeature(.talkResume(t0: t0, count: true))
                    return v ?? "0"
                }
                if (Int(n) ?? 0) > 0 { due.append((wv, shown)) }
            }
            guard !due.isEmpty else { return }
            do { try AVAudioSession.sharedInstance().setActive(true) } catch {
                Diagnostics.shared.log("audio", "after talking: the session wouldn't start again (\(error.localizedDescription))")
            }
            for (wv, shown) in due {
                let r = await Browser.within(5, "no answer") { () -> String in
                    let v = try? await wv.browserFeature(.talkResume(t0: t0, count: false))
                    return v ?? "no answer"
                }
                var lines: [String] = []
                var stuck = 0
                if let o = Browser.parse(r) as? [String: Any] { lines = o["lines"] as? [String] ?? []; stuck = o["stuck"] as? Int ?? 0 } else { lines = [r] }
                // (stuck: the next step, one call each, until it plays or all five were tried)
                var step = 1
                while stuck > 0 && step <= 5 {
                    let k = step
                    let n = await Browser.within(4, "no answer in 4 s") { () -> String in
                        do { return try await wv.browserFeature(.talkNudge(step: k)) ?? "nil" }
                        catch { return "error: \((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)" }
                    }
                    guard let o = Browser.parse(n) as? [String: Any] else { lines.append("nudge \(step): \(n)"); break }
                    lines += o["lines"] as? [String] ?? []
                    stuck = o["stuck"] as? Int ?? 0
                    step += 1
                }
                Diagnostics.shared.log("audio", "after talking, \(Diagnostics.place(wv.url))\(shown ? "" : " (a tab behind)"): \(lines.joined(separator: "; "))")
            }
        }
    }

    @MainActor static func setUp() {
        let session = AVAudioSession.sharedInstance()
        if !DevFlags.args.contains("-noaudiosession") {
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
                if !DevFlags.args.contains("-noaudiosession") { try? session.setCategory(.playback, mode: .moviePlayback) }
            }
        }
    }

    /// (development) The session as it is now, for the `playing` step.
    @MainActor static func describe() -> String {
        let s = AVAudioSession.sharedInstance()
        return "category \(s.category.rawValue), mode \(s.mode.rawValue), other audio playing \(s.isOtherAudioPlaying), outputs \(s.currentRoute.outputs.map(\.portType.rawValue))"
    }
}

#if DEBUG
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

    /// (development, {"rebuild": …}) The pages' scripts made again n times in a row, as n quick changes to the mods
    /// (the Mods tab's switches) make them: each call's time on the main thread, how long until the last is in,
    /// and the main thread's hangs meanwhile (Tim, 11-18: 14.5 s, 2.9 s… "making the pages' scripts again").
    static func rebuildCheck(browser: Browser, n: Int, allOn: Bool) async -> String {
        if allOn { for m in browser.mods.mods where !m.on { browser.mods.setOn(m.id, true, site: nil) } }
        try? await Task.sleep(nanoseconds: 500_000_000)
        let h0 = Diagnostics.hangs.now
        var calls: [Int] = []
        let t0 = Date()
        // (each change a real one: a mod switched off, then on again, as the Mods tab's switch does)
        let first = browser.mods.mods.first
        for i in 0..<n {
            let c = Date()
            if let f = first { browser.mods.setOn(f.id, i % 2 == 1, site: nil) }
            browser.modsChanged(reload: false)
            calls.append(Int(Date().timeIntervalSince(c) * 1000))
            await Task.yield()
        }
        await browser.scriptsInstalled()
        let total = Int(Date().timeIntervalSince(t0) * 1000)
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let h1 = Diagnostics.hangs.now
        let sizes = browser.mods.mods.map { $0.script.utf8.count + $0.styleScript.utf8.count }
        return "\(browser.mods.mods.count) mods (\(browser.mods.mods.filter(\.on).count) on; \(sizes.reduce(0, +) / 1024) KB of scripts), \(browser.tabs.count) tabs\n" +
            "calls (ms on the main thread): \(calls)\nall in after \(total) ms; last install: \(browser.lastInstallMs)\n" +
            "hangs meanwhile: \(h1.count - h0.count), \(h1.totalMs - h0.totalMs) ms"
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
                let page = try? await (wv as? TabWebView)?.browserFeature(.playing)
                state = "WebKit: \(s), page: \(page ?? "no answer") → \(await Browser.playing(t) ? "kept" : "not playing")"
            }
            out.append("\(t === browser.current ? "*" : " ") \(t.host.isEmpty ? "-" : t.host) \(state)")
        }
        return out.joined(separator: "\n") + "\naudio session: " + BackgroundPlay.describe()
    }
}
#endif

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

    /// (each download: whether the person's finger was on the page just before it began)
    private var tapped: [ObjectIdentifier: Bool] = [:]
    /// A download begins. Only one that follows the person's touch (within 10 s: a signed address or a new window
    /// can take a few) goes on to Add this mod?: a page's script can start downloads by itself, as many as it likes
    /// (security batch, 11-20).
    func take(_ d: WKDownload) {
        let since = TouchClock.lastLift.map { Date().timeIntervalSince($0) }
        tapped[ObjectIdentifier(d)] = TouchClock.down > 0 || TouchClock.menu || (since.map { $0 >= 0 && $0 < 10 } ?? false)
        d.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let byTouch = tapped.removeValue(forKey: ObjectIdentifier(download)) ?? false
        guard ModDownloads.jsName(suggestedFilename), response.expectedContentLength < 2_000_000 else { return nil }
        guard byTouch else {
            Diagnostics.shared.log("outside offers", "a .js download a page started with no touch of the person's: not offered")
            return nil
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).js")
        files[ObjectIdentifier(download)] = (url, suggestedFilename)
        return url
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let f = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let text = (try? String(contentsOf: f.url, encoding: .utf8)) ?? ""
        try? FileManager.default.removeItem(at: f.url)
        browser?.report.log("mods", "downloaded \(f.name) (\(text.count) characters): to Add this mod?")
        browser?.offer(text: text.isEmpty ? nil : text, outside: "a download")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let f = files.removeValue(forKey: ObjectIdentifier(download))
        Diagnostics.shared.log("chat files", "couldn't download \(f?.name ?? "a file"): \(error.localizedDescription)")
    }
}
