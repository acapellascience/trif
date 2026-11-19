// The chat: claude.ai (or chatgpt.com) in a web view of its own, signed in as the person, on their own
// subscription, shown full screen over the tab when the chat button is tapped (Tim, 11-15: "you either want
// claude or you don't"; it was a pane from the bottom before). TRIF's script in it (Web/chat.js, a world of its
// own) puts the tab's data into the message box, tells the app when the person sends (the app goes back to the
// tab), watches the reply until it's done, and hands over the mod files in it: the app asks Add this mod? about
// each, over the tab. The person always sends, and always says yes to a mod, themselves.

import SwiftUI
import UIKit
import UserNotifications
import WebKit
import os

/// Which chat the pane shows: Claude, or ChatGPT (Codex on the web works on code repositories, not on a page
/// someone is looking at, so ChatGPT is its side's chat). Each keeps its own sign-in (the app's one cookie store).
enum ChatService: String, CaseIterable, Identifiable {
    case claude = "Claude", chatgpt = "ChatGPT"
    var id: String { rawValue }
    /// Its site, as people know it (the stand-in's too).
    var host: String { self == .claude ? "claude.ai" : "chatgpt.com" }
    var home: String { ChatService.standIn ?? (self == .claude ? "https://claude.ai/new" : "https://chatgpt.com/") }

    // MARK: a project for TRIF's chats (Tim, 11-16: they cluttered his history)
    /// The project TRIF's new chats start in, picked by the person (Use this project for TRIF chats), or nil.
    var project: URL? { UserDefaults.standard.string(forKey: "chatProject.\(rawValue)").flatMap(URL.init(string:)) }
    /// The person said the project has TRIF's instructions (then a new chat gets the page, not the 16 KB guide again).
    var projectHasGuide: Bool { project != nil && UserDefaults.standard.bool(forKey: "chatProjectGuide.\(rawValue)") }
    func useProject(_ url: URL?, hasGuide: Bool) {
        UserDefaults.standard.set(url?.absoluteString, forKey: "chatProject.\(rawValue)")
        UserDefaults.standard.set(hasGuide, forKey: "chatProjectGuide.\(rawValue)")
    }
    /// Where a new chat starts: the project's page (its message box starts a chat in it), else a new chat.
    var start: String { project?.absoluteString ?? home }
    /// Where the person makes a project.
    var projectsPage: String { ChatService.standIn ?? (self == .claude ? "https://claude.ai/projects" : "https://chatgpt.com/") }
    /// A project's own page: claude.ai/project/<id>; chatgpt.com/g/g-p-<id>-<name>/project.
    func isProjectPage(_ url: URL?) -> Bool {
        guard let url, let h = URL(string: home)?.host, url.host == h else { return false }
        return self == .claude ? url.path.hasPrefix("/project/") : url.path.range(of: "^/g/g-p-[^/]+/project/?$", options: .regularExpression) != nil
    }
    /// (development) `-chathome <address>`: a stand-in chat page for both (mobile/shared/pages/chat.html, served by
    /// mobile/serve.js), for the Simulator, where neither can be signed in to.
    static let standIn: String? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-chathome"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }()
}

/// What the chat is doing, for the chat button: nothing, writing a reply (animated dots), or a reply with no mod
/// in it waiting to be read (a quiet mark).
enum ChatActivity: String { case idle, working, replied }

/// One chat page (Tim, 11-16: more than one chat at a time): its own web view, conversation, reply watcher and pending
/// fill. The pane keeps up to three (ClaudePane.maxViews); a working one keeps running while another is shown.
@MainActor
final class ChatView: Identifiable {
    let id = UUID()
    let webView: WKWebView
    /// Claude or ChatGPT: the one it was opened on.
    var service: ChatService
    /// The site its conversation is for (each site keeps its own conversation).
    var site = "" { didSet { if site != oldValue { tellLook() } } }
    /// TRIF's look in the page (Web/chat.js look): the site for its greeting, and TRIF's robot (RobotShape), so the
    /// greeting and the pills draw TRIF's own shape. On each load and whenever the site changes.
    func tellLook() {
        webView.callAsyncJavaScript("return globalThis.__trifChat && globalThis.__trifChat.look ? globalThis.__trifChat.look(site, shape) : null;",
                                    arguments: ["site": site, "shape": ChatView.robotShape], in: nil, in: ClaudePane.chatWorld) { _ in }
    }
    static let robotShape: [String: Any] = {
        func points(_ p: [(Double, Double)]) -> String { p.map { "\($0.0),\($0.1)" }.joined(separator: " ") }
        func rgb(_ c: (Int, Int, Int)) -> String { "rgb(\(c.0),\(c.1),\(c.2))" }
        return ["rim": points(RobotShape.rim), "face": points(RobotShape.face), "eyes": RobotShape.eyes.map(points),
                "colours": ["rim": rgb(RobotShape.rimColour), "face": rgb(RobotShape.faceColour), "eye": rgb(RobotShape.eyeColour)]]
    }()
    var started = false
    var loading = false { willSet { changed() } }
    var canGoBack = false { willSet { changed() } }
    var canGoForward = false { willSet { changed() } }
    var activity: ChatActivity = .idle { willSet { changed() } didSet { activityChanged() } }
    /// It shows a project's page that isn't TRIF's project yet (the top bar offers to use it).
    var projectPage = false { willSet { changed() } }
    /// "Adding the page…" while the tab's data goes into its box.
    var adding = false { willSet { changed() } }
    var title = "" { willSet { changed() } }
    /// A load asked for hasn't put its page in yet (until it commits): the page there is the one before.
    var navigating = false
    /// The address last asked for: the conversation it's about to show, before it has loaded.
    var requested: URL?
    /// Which fill is current: a reload makes the one under way stop, and starts it again after.
    var fillGeneration = 0
    var lastPrepared: ClaudePane.Prepared?
    var refill: ClaudePane.Prepared?
    /// Mods in the last reply that TRIF didn't see being written (chat.js done's `waiting`): the chat opens at them.
    var waitingMods = 0
    var workingSince = Date.distantPast
    /// The conversation the person sent from (nil: a new chat with no address yet): a reload onto another one while
    /// .working isn't that reply (Tim, 11-18: old chats' code picked up).
    var workingConversation: String?
    /// The instructions went in a new chat's first message: its address, once it has one, is noted.
    var contextNext = false
    /// The page went into a new chat in TRIF's project without the guide (the project has it).
    var projectFill = false
    /// The tab the person was on when they sent: a notification's tap goes back to it.
    var sentTab: UUID?
    /// The site a new conversation started by TRIF's instructions is for (recorded once it has an address).
    var ownerNext: String?
    /// The things put into its message box, one after another.
    var chain: Task<Void, Never>?
    var lastUsed = Date()
    var watches: [NSKeyValueObservation] = []
    var fitTask: Task<Void, Never>?
    var changed: () -> Void = {}
    var activityChanged: () -> Void = {}
    init(webView: WKWebView, service: ChatService) { self.webView = webView; self.service = service }

    /// The conversation shown, as kept (no query or fragment), or nil for a new chat that has no address of its own yet.
    var conversation: String? { ClaudePane.conversation(of: webView.url) }
    /// One of the chat's own pages: a conversation or a new chat (not a file, a link or a sign-in page it went to).
    var onChatPage: Bool {
        guard let u = webView.url, let home = URL(string: service.home), u.host == home.host else { return false }
        let p = u.path
        return p.hasPrefix("/chat/") || p.hasPrefix("/c/") || p.hasPrefix("/uc/") || p == home.path || p == "/" || p == "/new" || service.isProjectPage(u)
    }
    /// For the chats' list: its site and a short title.
    var label: String {
        var t = title
        for cut in [" - Claude", " | Claude", " – Claude", "ChatGPT - ", " - ChatGPT", "Claude"] { t = t.replacingOccurrences(of: cut, with: "") }
        t = t.trimmingCharacters(in: .whitespaces)
        if t.count > 26 { t = String(t.prefix(25)) + "…" }
        let s = site.isEmpty ? "No site" : site
        return t.isEmpty || t == "New chat" ? s : "\(s) · \(t)"
    }
}

/// A chat's web view. While the quick ask's strip shows only a band of it, touches outside the band (`stripBand`, in
/// the window) aren't its: they go to the tab under it (SwiftUI's clipping hides the rest of the chat but doesn't
/// keep touches from it: checked with the hit step, 11-18).
final class ChatWebView: WKWebView {
    /// The strip's band in the window (below its header); nil when the chat isn't a strip.
    static var stripBand: ClosedRange<CGFloat>?
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if let band = ChatWebView.stripBand, let w = window, !band.contains(convert(point, to: w).y) { return nil }
        return super.hitTest(point, with: event)
    }
}

/// A chat the person sent a message in, and the way back from it to the tab it started from (Tim, 11-18: "the site is
/// lost in the tabs"; chats linked tab → chat only, now both ways). One per service and site (each site has one
/// conversation at a time: ClaudePane's lastChat), newest first, kept across launches (UserDefaults `chatLinks`, 20).
struct ChatLink: Codable, Identifiable, Equatable {
    /// working: a reply being written; waiting: a reply done, not yet read; read; added: a mod from it was added.
    enum State: String, Codable { case working, waiting, read, added }
    var service: String
    var site: String
    /// The tab the person sent from (Tab.id, kept across launches with the tabs), its title and address then.
    var tab: UUID?
    var tabTitle: String
    var tabURL: String?
    /// The conversation (kept as ClaudePane.remember keeps it), nil for a new chat with no address yet.
    var conv: String?
    var state: State
    var at: Date
    var id: String { ClaudePane.linkKey(service, site) }
    /// The tab list's badge and the chat list's picture: working, a reply waiting, or plain.
    var activity: ChatActivity { state == .working ? .working : state == .waiting ? .replied : .idle }
    /// As the tab list's shared rules take it (TabListRules).
    var facts: TabListRules.LinkFacts { .init(site: site, tab: tab, state: state.rawValue) }
}

/// A reply done in a chat the person isn't looking at (Tim, 11-18): the banner that slides down over whatever is
/// shown. With mods: they wait here (the same offer: Browser.offerFromChat(hold:)) for its Add or Go to <site>.
struct ChatBanner: Identifiable, Equatable {
    let id = UUID()
    let link: String
    let service: String
    let site: String
    var mods: [InstalledMod]
    /// Mods in the reply that TRIF didn't see being written (the app was in the background): not offered by
    /// themselves; the chat opens at the first, its Add to TRIF in view (11-18).
    var inChat = 0
    static func == (a: ChatBanner, b: ChatBanner) -> Bool { a.id == b.id && a.mods.map(\.id) == b.mods.map(\.id) && a.inChat == b.inChat }
}

@MainActor
final class ClaudePane: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static var home: String { ChatService.claude.home }
    /// TRIF in the chat (Web/chat.js; Tim, 11-13): its own world beside Claude's or ChatGPT's page.
    static let chatWorld = WKContentWorld.world(name: "trif-chat")
    @Published var service: ChatService = ChatService(rawValue: UserDefaults.standard.string(forKey: "chatService") ?? "") ?? .claude
    /// The switch's third choice, More (Tim, 11-16): the desktop side panel's own chat on an API key, or on this iPhone
    /// (PanelChat.swift), in place of Claude's or ChatGPT's page. Remembered.
    @Published private(set) var more = UserDefaults.standard.bool(forKey: "chatMore")
    private(set) lazy var panel: PanelChat = {
        let p = PanelChat(browser: browser!, report: report)
        p.onActivity = { [weak self] a in self?.panelActivity = a; self?.refreshActivity() }
        p.isShown = { [weak self] in self?.shown ?? false }
        // (a quick ask's run done: its mods through the quick ask's own way, look-only ones added at once)
        p.quickDone = { [weak self] site, codes, ok, path in await self?.quickMoreDone(site, codes, ok: ok, path: path) ?? 0 }
        // (its run as it goes: red at once when the engine says no, amber when nothing comes back)
        p.quickNews = { [weak self] news in self?.quickMoreNews(news) }
        // (Not right? Ask Claude, after the model on this iPhone: the same request in Claude's chat, with the page)
        p.onAskClaude = { [weak self] request in
            guard let self else { return }
            self.choose(more: false, service: .claude)
            self.shown = false
            self.open { [weak self] in if !request.isEmpty { await self?.fill(request) } }
        }
        return p
    }()
    private var panelActivity: ChatActivity = .idle
    /// Claude, ChatGPT or More.
    func choose(more m: Bool, service s: ChatService? = nil) {
        if m != more {
            more = m
            UserDefaults.standard.set(m, forKey: "chatMore")
            report.log("claude", m ? "switched to More (the side panel's chat)" : "switched back to \(s?.rawValue ?? service.rawValue)")
            // (back from More to the same service: as a switch to it, shown for this tab and its page filled in if idle;
            // to the other service, `use` does that, so the old service's chat isn't loaded for nothing first (11-18))
            if m { panel.start() } else if shown, s == nil || s == service { showSwitched() }
        }
        if let s, !m { use(s) }
    }
    /// A switch to a chat (Claude · ChatGPT · More's switch): its chat for the shown tab's site, and, if that chat is
    /// idle and the tab's, this page's details in its box, as the robot's Go to chat does (Tim, 11-18: fine to fill on
    /// a switch, but only ever the page in front: fillContext takes out any earlier page's).
    private func showSwitched() {
        showFor(tabSite)
        let v = cur!
        if shown, v.activity == .idle, v.site == tabSite, let ready = prepare(v) { queue(v) { [weak self] in await self?.fillContext(v, ready) } }
    }
    /// The shown tab changed: the side panel follows it, as on desktop.
    func tabChanged() { if more { panel.pushTab() } }

    // MARK: the chats (Tim, 11-16: up to three at once)

    static let maxViews = 3
    /// The chat pages, oldest first; the shown one is `cur`.
    @Published private(set) var views: [ChatView] = []
    @Published private(set) var cur: ChatView!

    @Published var popup: WKWebView?
    var webView: WKWebView { cur.webView }
    var loading: Bool { get { cur.loading } set { cur.loading = newValue } }
    var canGoBack: Bool { cur.canGoBack }
    var canGoForward: Bool { cur.canGoForward }
    var site: String { cur.site }
    var projectPage: Bool { cur.projectPage }
    var adding: Bool { cur.adding }
    func back() { if cur.canGoBack { cur.webView.goBack() } }
    func forward() { if cur.webView.canGoForward { cur.webView.goForward() } }

    /// Reload, the shown chat's own (Tim, 11-16: "if anything goes wrong there, you're stuck"): the same address, never a
    /// new chat. A reply being written is watched again once it has loaded (didFinish: chat.js resume); the tab's data
    /// being put in its box is put in again, once.
    func reloadChat() {
        let v = cur!
        report.log("claude", "\(v.service.rawValue): reloaded")
        v.fillGeneration += 1
        if v.adding, let p = v.lastPrepared { v.refill = p }
        v.loading = true
        v.navigating = true
        v.webView.reload()
    }
    /// The chat is showing, full screen over the tab.
    @Published private(set) var shown = false
    /// The chat button's state, over all the chats: working if any is, else replied if any has a reply waiting.
    @Published private(set) var activity: ChatActivity = .idle
    private func refreshActivity() {
        let all = views.map(\.activity) + [panelActivity]
        let a: ChatActivity = all.contains(.working) ? .working : all.contains(.replied) ? .replied : .idle
        if a != activity { activity = a }
    }

    private let report: Report
    private weak var browser: Browser?

    init(report: Report, browser: Browser) {
        self.report = report
        self.browser = browser
        super.init()
        let first = makeView(service)
        views = [first]
        cur = first
        loadLinks()
        browser.offersHeld = { [weak self] in self?.banners.flatMap(\.mods) ?? [] }
        browser.chatTabFor = { [weak self] site in self?.links.contains { $0.site == site } ?? false }
        browser.modAddedFrom = { [weak self] site in self?.modAdded(site) }
        // (development) `xcrun simctl spawn <device> notifyutil -p com.trif.probe.dumpchat`: the chat's layout and
        // scroll positions to Documents/chat-dom.html, without a relaunch (dumpComposer)
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
            guard let observer else { return }
            let pane = Unmanaged<ClaudePane>.fromOpaque(observer).takeUnretainedValue()
            Task { @MainActor in await pane.dumpComposer() }
        }, "com.trif.probe.dumpchat" as CFString, nil, .deliverImmediately)
        // (the keyboard gone, however it went (Tim, 11-16: the chat's page stayed pushed up, its message box mid-screen
        // over an empty half, after the keyboard closed): the chat's page back in its frame, now and once it has
        // settled; doing it again changes nothing)
        for name in [UIResponder.keyboardWillHideNotification, UIResponder.keyboardDidHideNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.settleLayout() }
            }
        }
        // (in the background while a reply is being written: ReplyInBackground below)
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.wentToBackground() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.cameBack() }
        }
        NotificationCenter.default.addObserver(forName: .trifNotificationTapped, object: nil, queue: .main) { [weak self] n in
            let info = n.userInfo ?? [:]
            MainActor.assumeIsolated { self?.notificationTapped(info) }
        }
        // (memory: the idle chats that aren't showing go first)
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.memoryWarning() }
        }
    }

    /// A chat page of its own (they share the app's sign-ins: the default data store).
    private func makeView(_ s: ChatService) -> ChatView {
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = Browser.safariSuffix
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        // (Add to TRIF under each mod in a reply, and filling the message box: Web/chat.js, main frame only)
        config.userContentController.addUserScript(WKUserScript(source: Browser.resource("chat", "js"), injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: ClaudePane.chatWorld))
        let wv = ChatWebView(frame: .zero, configuration: config)
        config.userContentController.add(self, contentWorld: ClaudePane.chatWorld, name: "trif")
        let v = ChatView(webView: wv, service: s)
        v.changed = { [weak self] in self?.objectWillChange.send() }
        v.activityChanged = { [weak self] in self?.refreshActivity() }
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.isInspectable = true
        // (a tapped link to another app opens at once, the page's own try asks: AppLinks)
        TouchClock.watch(wv)
        // (the chat page stays put in its frame: claude.ai and chatgpt.com scroll their conversation inside
        // themselves, so the web view's own scrolling only ever hid the top of the chat, after the keyboard
        // or a send moved it: Tim, 11-14)
        // (but a page taller than the pane, as a sign-in page is (Google's "Sign in to continue"), scrolls as any page
        // does: the web view's scrolling is on exactly while its page is taller or wider than the pane. Tim, 11-15:
        // with it always off, signing in on a small iPhone was nearly impossible)
        let sv = wv.scrollView
        sv.isScrollEnabled = false
        sv.bounces = false
        sv.contentInsetAdjustmentBehavior = .never
        v.watches = [
            sv.observe(\.contentSize, options: [.new]) { [weak self, weak v] _, _ in Task { @MainActor in if let v { self?.fitScrolling(v) } } },
            sv.observe(\.bounds, options: [.new]) { [weak self, weak v] _, _ in Task { @MainActor in if let v { self?.fitScrolling(v) } } },
            // (the conversation it's on, kept, so the app reopens it: Tim, 11-14)
            wv.observe(\.url, options: [.new]) { [weak self, weak v] w, _ in let url = w.url; Task { @MainActor in if let v { self?.remember(v, url) } } },
            wv.observe(\.title, options: [.new]) { [weak v] w, _ in let t = w.title ?? ""; Task { @MainActor in v?.title = t } },
            wv.observe(\.canGoBack, options: [.new]) { [weak v] w, _ in let b = w.canGoBack; Task { @MainActor in v?.canGoBack = b } },
            wv.observe(\.canGoForward, options: [.new]) { [weak v] w, _ in let b = w.canGoForward; Task { @MainActor in v?.canGoForward = b } },
        ]
        return v
    }
    private func view(of wv: WKWebView) -> ChatView? { views.first { $0.webView === wv } }

    /// The chat for a site (and the chosen service): its own if it has one; else a new one while there are fewer than
    /// three; else the one least recently used that isn't writing a reply, released for it (its conversation is kept
    /// by address, so opening it again loads it). All three writing: the shown one stays.
    private func viewFor(_ s: String) -> ChatView {
        if let v = views.first(where: { $0.site == s && $0.service == service }) { return v }
        if views.count < ClaudePane.maxViews {
            // (the first chat page, not yet used: it's this site's)
            if views.count == 1, !views[0].started { views[0].service = service; views[0].site = s; return views[0] }
            let v = makeView(service)
            v.site = s
            views.append(v)
            report.log("claude", "a chat for \(s.isEmpty ? "no site" : s): \(views.count) chat pages now")
            logMemory("a chat page added")
            return v
        }
        guard let old = views.filter({ $0.activity != .working && $0 !== cur }).min(by: { $0.lastUsed < $1.lastUsed })
                ?? views.filter({ $0.activity != .working }).min(by: { $0.lastUsed < $1.lastUsed }) else {
            report.log("claude", "all \(views.count) chats are writing replies: the shown one stays")
            return cur
        }
        release(old, why: "a fourth chat was needed")
        let v = makeView(service)
        v.site = s
        views.append(v)
        return v
    }
    /// A chat page let go (its conversation stays kept by address: opening it again loads it).
    private func release(_ v: ChatView, why: String) {
        v.webView.stopLoading()
        v.chain?.cancel()
        views.removeAll { $0 === v }
        if cur === v, let other = views.last { cur = other }
        report.log("claude", "a chat page let go (\(v.site.isEmpty ? "no site" : v.site), \(why)): \(views.count) left")
        logMemory("a chat page let go")
        refreshActivity()
    }
    private func memoryWarning() {
        let idle = views.filter { $0 !== cur && $0.activity != .working }
        for v in idle { release(v, why: "a memory warning") }
        logMemory("a memory warning: \(idle.count) idle chat page(s) let go")
    }
    private func logMemory(_ what: String) {
        Diagnostics.shared.log("chats", "\(what): \(views.count) chat page(s), \(views.filter { $0.activity == .working }.count) writing; \(os_proc_available_memory() / 1_048_576) MB of memory left to the app")
    }
    /// Shows a chat from the chats' list.
    func show(_ v: ChatView) {
        guard views.contains(where: { $0 === v }) else { return }
        cur = v
        v.lastUsed = Date()
        if v.activity == .replied { v.activity = .idle; Task { _ = await chatJS(v, "showReply()") } }
        if !v.started { start(v) }
        seen(v)
        report.log("claude", "\(v.service.rawValue): the chat for \(v.site.isEmpty ? "no site" : v.site) shown")
    }
    /// The chats in progress, for the list: those that have loaded something.
    var openViews: [ChatView] { views.filter(\.started) }

    /// Whether a page is bigger than the web view showing it (then it scrolls as a document does).
    nonisolated static func scrolls(_ sv: UIScrollView) -> Bool {
        sv.contentSize.height > sv.bounds.height + 2 || sv.contentSize.width > sv.bounds.width + 2
    }

    /// Scrolling on for a page taller (or wider) than the pane; off, and back at the top, for one that fits (the
    /// chats, which scroll inside themselves).
    /// (decided a moment after the page's size stops changing, and with a margin each way, so a page whose height
    /// follows the pane's, as the chats' do while the keyboard comes and goes, can't flip it back and forth on every
    /// layout: 11-15, an update loop on Tim's phone was looked for here too)
    private func fitScrolling(_ v: ChatView) {
        v.fitTask?.cancel()
        v.fitTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled, let self else { return }
            let sv = v.webView.scrollView
            let over = max(sv.contentSize.height - sv.bounds.height, sv.contentSize.width - sv.bounds.width)
            let on = sv.isScrollEnabled ? over > 1 : over > 24
            if sv.isScrollEnabled != on {
                sv.isScrollEnabled = on
                sv.bounces = on
            }
            self.clampOffset(v)
        }
    }

    /// The page's offset inside its frame, kept within what it can be: none when it fits (the chats scroll inside
    /// themselves), and never past its end (WebKit can leave the page pushed up once the keyboard has gone).
    private func clampOffset(_ v: ChatView) {
        let sv = v.webView.scrollView
        guard !sv.isTracking, !sv.isDecelerating else { return }
        let maxY = max(0, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
        let maxX = max(0, sv.contentSize.width - sv.bounds.width)
        let fit = CGPoint(x: min(max(sv.contentOffset.x, 0), maxX), y: sv.isScrollEnabled ? min(max(sv.contentOffset.y, -sv.adjustedContentInset.top), maxY) : 0)
        if fit != sv.contentOffset { sv.setContentOffset(fit, animated: false) }
    }

    /// After the keyboard goes (or the chat comes back): the page's layout as it should be, now and a moment later.
    func settleLayout() {
        let v = cur!
        v.webView.setNeedsLayout()
        clampOffset(v)
        fitScrolling(v)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            self?.clampOffset(v)
            // (the page told its window's size again: a chat that measured itself with the keyboard up lays out again)
            _ = try? await v.webView.evaluateJavaScript("window.dispatchEvent(new Event('resize')); 1", in: nil, in: ClaudePane.chatWorld)
        }
    }
    /// The shown tab's site; the chat button opens its chat (Tim, 11-15: the chat follows the tab).
    private var tabSite = ""
    private func lastKey(_ s: ChatService, _ site: String) -> String { site.isEmpty ? "lastChat.\(s.rawValue)" : "lastChat.\(s.rawValue).\(site)" }
    /// A conversation's address (claude.ai/chat/…, chatgpt.com/c/…), kept for its chat and site; nothing else is.
    private func remember(_ v: ChatView, _ url: URL?) {
        guard let url, let home = URL(string: v.service.home), url.host == home.host,
              url.path.hasPrefix("/chat/") || url.path.hasPrefix("/c/") || url.path.hasPrefix("/uc/") else { return }
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        c?.query = nil
        c?.fragment = nil
        if let s = c?.url?.absoluteString {
            // (a conversation belongs to the site it was started for (Tim, 11-16: an NYT tab got a follow-up in his YouTube
            // conversation): recorded the first time it's seen in a site's chat, and kept as that site's only if it's
            // that site's)
            if ClaudePane.owner(of: s) == nil || v.ownerNext != nil { ClaudePane.setOwner(s, v.ownerNext ?? v.site); v.ownerNext = nil }
            if ClaudePane.owner(of: s) == v.site { UserDefaults.standard.set(s, forKey: lastKey(v.service, v.site)) }
            else { report.log("claude", "\(v.service.rawValue): the chat for \(v.site.isEmpty ? "no site" : v.site) is on \(ClaudePane.owner(of: s) ?? "?")'s conversation: not kept as this site's") }
            if v.contextNext { v.contextNext = false; noteContext(s) }
            // (the chat's link follows its conversation: a new chat's first address, or another one the person went to)
            if ClaudePane.owner(of: s) == v.site { updateLink(v) { if $0.conv != s, $0.state != .working || $0.conv == nil { $0.conv = s } } }
        }
    }

    /// Which site each conversation is for (by address; the last 500).
    private static let ownersKey = "chatConversationSites"
    static func owner(of conv: String) -> String? { (UserDefaults.standard.dictionary(forKey: ownersKey) as? [String: String])?[conv] }
    static func setOwner(_ conv: String, _ site: String) {
        var d = UserDefaults.standard.dictionary(forKey: ownersKey) as? [String: String] ?? [:]
        d[conv] = site
        if d.count > 500 { for k in d.keys.prefix(d.count - 500) { d[k] = nil } }
        UserDefaults.standard.set(d, forKey: ownersKey)
    }

    // MARK: which conversations have TRIF's instructions

    /// The conversation the shown chat is on.
    private var conversation: String? { cur.conversation }
    /// The conversations TRIF's full instructions were sent in (by address; the last 300).
    private static let contextKey = "chatsWithInstructions"
    private func hasContext(_ conv: String) -> Bool { (UserDefaults.standard.stringArray(forKey: ClaudePane.contextKey) ?? []).contains(conv) }
    private func noteContext(_ conv: String) {
        var list = UserDefaults.standard.stringArray(forKey: ClaudePane.contextKey) ?? []
        guard !list.contains(conv) else { return }
        list.append(conv)
        if list.count > 300 { list.removeFirst(list.count - 300) }
        UserDefaults.standard.set(list, forKey: ClaudePane.contextKey)
    }
    /// Where a chat opens: its site's conversation, else a new one.
    private func resumeURL(_ v: ChatView) -> URL? {
        if let kept = UserDefaults.standard.string(forKey: lastKey(v.service, v.site)) {
            if ClaudePane.owner(of: kept) == v.site, let u = URL(string: kept) { return u }
            // (kept before conversations were recorded by site, or another site's: not reopened; a new chat instead)
            UserDefaults.standard.removeObject(forKey: lastKey(v.service, v.site))
            report.log("claude", "\(v.service.rawValue): the conversation kept for \(v.site.isEmpty ? "no site" : v.site) isn't recorded as its own: a new chat instead")
        }
        return URL(string: v.service.start)
    }

    /// Loads an address in a chat, marked as loading at once (a fill waits for it: waitForPage).
    private func go(_ v: ChatView, _ url: URL) {
        v.loading = true
        v.navigating = true
        v.requested = url
        v.webView.load(URLRequest(url: url))
    }

    /// Loads a chat the first time it's shown (not before: the browser is useful without it).
    private func start(_ v: ChatView) {
        guard !v.started, let url = resumeURL(v) else { return }
        v.started = true
        go(v, url)
    }
    /// (the first chat, loaded: the dev steps' and the projects' way in)
    func start() { start(cur) }

    /// The shown tab's site changed (another tab, or another site in it): the chat button opens that site's chat next
    /// (a new one if it has none). Nothing loads in the background meanwhile.
    func follow(site new: String) { tabSite = new }

    /// The shown chat is on one of its own pages.
    var onChatPage: Bool { cur.onChatPage }

    /// The chat for the shown tab's site, shown (a working chat for another site keeps running behind it).
    private func showFor(_ s: String) {
        let v = viewFor(s)
        if v !== cur { report.log("claude", "\(service.rawValue): the chat for \(s.isEmpty ? "no site" : s)") }
        cur = v
        v.lastUsed = Date()
        start(v)
    }

    /// The chat button: the chat for the shown tab's site, full screen. In a chat that isn't writing a reply, the tab's
    /// data goes into the message box (fillContext); at a reply waiting to be read, it opens there. `then`: one more
    /// thing to put in the message box after.
    func open(then extra: (() async -> Void)? = nil) {
        Diagnostics.shared.mark("opening the chat")
        // (More: the side panel's chat, which has its own context and fills nothing)
        if more {
            if panelActivity == .replied { panelActivity = .idle; refreshActivity() }
            shown = true
            panel.start()
            panel.preloadLocal()
            report.log("claude", "More: opened")
            return
        }
        // (the quick ask's strip up: the whole chat instead, as it is)
        if strip { strip = false; if quick?.state == .waitingSend { shown = true; seen(cur); return } }
        let already = shown
        if !already { showFor(tabSite) }
        let v = cur!
        let was = v.activity
        if was == .replied { v.activity = .idle }
        shown = true
        seen(v)
        report.log("claude", "\(v.service.rawValue): opened\(was == .idle ? "" : " (\(was.rawValue))")")
        // (the tab's data starts being gathered now, while the chat's page gets ready: 11-15)
        Diagnostics.shared.mark("opening the chat: gathering the page")
        // (the shown chat isn't this tab's site's (all three were writing): shown, but nothing put in it)
        let mine = v.site == tabSite
        if !mine { report.log("claude", "\(v.service.rawValue): the chat shown is \(v.site.isEmpty ? "no site" : v.site)'s, not \(tabSite.isEmpty ? "this tab" : tabSite)'s: nothing put in it") }
        let ready = was == .idle && !already && mine ? prepare(v) : nil
        Diagnostics.shared.mark("opening the chat: the chat's page")
        queue(v) { [weak self] in
            guard let self else { return }
            if was == .replied { _ = await self.chatJS(v, "showReply(\(v.waitingMods > 0))"); v.waitingMods = 0 }
            else if let ready { await self.fillContext(v, ready) }
            if let extra { await extra() } // (chat.js fill waits for the message box itself)
        }
    }

    /// Back to the tab (the chats keep running behind it: a reply goes on being written).
    func close() {
        guard shown else { return }
        shown = false
        blur(cur)
        // (the model on this iPhone let go with the robot view: its memory back for the page)
        if more { LocalRunner.shared.unload() }
    }

    /// The keyboard away from a chat's message box (so it doesn't come up over the tab).
    private func blur(_ v: ChatView) {
        v.webView.endEditing(true)
        Task { _ = try? await v.webView.callAsyncJavaScript("document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) }
    }

    /// Start over: a new conversation for the shown chat's site (and the one kept forgotten), with the full instructions.
    func home() {
        let v = cur!
        UserDefaults.standard.removeObject(forKey: lastKey(v.service, v.site))
        v.activity = .idle
        v.started = true
        guard let url = URL(string: v.service.start) else { return }
        go(v, url)
        guard let ready = prepare(v) else { return }
        queue(v) { [weak self] in await self?.fillContext(v, ready) }
    }

    /// The things put into a chat's message box, one after another (a fill waits for the one before).
    private func queue(_ v: ChatView, _ op: @escaping @MainActor () async -> Void) {
        let before = v.chain
        v.chain = Task { @MainActor in
            await before?.value
            await op()
        }
    }

    private func chatJS(_ v: ChatView, _ call: String) async -> String? {
        try? await v.webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.\(call) : null;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) as? String
    }
    /// (the shown chat's: chat.js's state, for the dev steps)
    func chatState() async -> String? { await chatJS(cur, "state()") }

    /// The conversation an address is (kept without query or fragment), or nil for a new chat.
    static func conversation(of url: URL?) -> String? {
        guard let url, url.path.hasPrefix("/chat/") || url.path.hasPrefix("/c/") || url.path.hasPrefix("/uc/") else { return nil }
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        c?.query = nil
        c?.fragment = nil
        return c?.url?.absoluteString
    }

    /// The tab's data being gathered for the message box, started when the chat button is pressed.
    struct Prepared {
        let followUp: Bool
        let conv: String?
        let text: Task<String?, Never>
        let shot: Task<Data?, Never>
        let watch: Stopwatch
    }
    /// The conversation it'll be for is the one the chat is showing or loading: a follow-up if TRIF's instructions
    /// are already in it, else the instructions. The text and the screenshot are gathered side by side.
    private func prepare(_ v: ChatView) -> Prepared? {
        guard let browser else { return nil }
        let conv = ClaudePane.conversation(of: v.loading ? v.requested : v.webView.url)
        let followUp = conv.map { hasContext($0) && ClaudePane.owner(of: $0) == browser.site } ?? false
        let sw = Stopwatch("\(followUp ? "the follow-up" : "the instructions") for \(browser.host.isEmpty ? "a new tab" : browser.host)")
        let shot = Task { @MainActor in await browser.quickScreenshot() }
        // (a new chat in TRIF's project, which has TRIF's instructions: the page only; once sent, the chat counts as
        // having them, as the project does)
        let inProject = !followUp && conv == nil && v.service.projectHasGuide
        if inProject { v.projectFill = true }
        let text = Task { @MainActor in followUp ? await browser.feedbackForChat(conv: conv, sw) : await browser.pageForChat(conv: conv, sw, guideInProject: inProject) }
        return Prepared(followUp: followUp, conv: conv, text: text, shot: shot, watch: sw)
    }

    /// The last fill not yet sent, for a chat (its service and site): its conversation ("new" for a new chat), and the
    /// tab and page it was of. Cleared at a send. Kept between launches (a reload of the chat's page must not fill again).
    struct FillRecord: Codable { var conv: String; var page: String; var at: Date }
    private func lastFill(_ v: ChatView) -> FillRecord? {
        UserDefaults.standard.data(forKey: "lastFill.\(v.service.rawValue).\(v.site)").flatMap { try? JSONDecoder().decode(FillRecord.self, from: $0) }
    }
    private func setLastFill(_ v: ChatView, _ r: FillRecord?) {
        UserDefaults.standard.set(r.flatMap { try? JSONEncoder().encode($0) }, forKey: "lastFill.\(v.service.rawValue).\(v.site)")
    }
    /// Whether an address TRIF's text in a chat's box names is the tab's page (both without the fragment).
    nonisolated static func samePage(_ named: String, _ url: URL?) -> Bool {
        let strip = { (s: String) in String(s.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? "") }
        guard let url else { return false }
        return strip(named) == strip(url.absoluteString)
    }
    /// The tab and its page (its address without the fragment): another tab or another page is a new fill.
    static func pageKey(_ b: Browser) -> String {
        var c = b.webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
        c?.fragment = nil
        return "\(b.current.id.uuidString) \(c?.url?.absoluteString ?? "")"
    }

    /// The tab's data into the message box (Tim, 11-15: "full instructions if it's a new chat, the feedback data
    /// if it's not"): in a conversation without TRIF's instructions, how mods are written and the page
    /// (Browser.pageForChat, as TRIF instruction.txt); in one that has them, the page as it is now, what changed,
    /// the mods on it (the code only of those the chat hasn't seen) and their errors (Browser.feedbackForChat, as
    /// TRIF follow-up.txt). The text goes in first, the screenshot when it's ready (11-15: it all took 10 to 15 s on
    /// Instagram). Nothing when the message box isn't there (signed out) or already has something in it. The
    /// person sends it themselves.
    private func fillContext(_ v: ChatView, _ ready: Prepared) async {
        let sw = ready.watch
        let generation = v.fillGeneration
        let name = v.service.rawValue
        v.lastPrepared = ready
        v.adding = true
        defer { if generation == v.fillGeneration { v.adding = false } }
        // (only into one of the chat's own pages with its message box there: not waiting for the page to finish
        // loading (claude.ai takes seconds more after its box is usable: 11-16, a new chat took 5 s to fill), but
        // looking for the box every 150 ms, 20 s at most (the person may go back to the conversation from a file
        // meanwhile); the chat is never moved for it. 11-16: a fill started on a file the chat had opened)
        // (and only with the conversation itself in front: the message box shown and usable, nothing over it. While a
        // viewer is open (a file, an artifact: 11-16, Tim tapped a .js and Claude's viewer covered the box), the wait
        // goes on, however long, for as long as the chat is shown: closing the viewer lets the fill go in)
        // (the quick ask's strip counts: its message box is in front there)
        let inFront = { [weak self] in ((self?.shown ?? false) || (self?.strip ?? false)) && self?.cur === v }
        var st: [String: Any] = [:]
        var waited = 0
        var saidViewer = false
        while waited < 133 {
            if !v.navigating, v.onChatPage {
                st = (Browser.parse(await chatJS(v, "state()")) as? [String: Any]) ?? [:]
                if st["usable"] as? Bool == true { break }
            }
            let over = st["viewer"] as? String
            if let over, !saidViewer {
                saidViewer = true
                report.log("claude", "\(name): \(over) is over the message box: the fill waits for it to close")
            }
            try? await Task.sleep(nanoseconds: 150_000_000)
            if over == nil || !inFront() { waited += 1 }
            if !inFront() && v.activity != .idle { break }
            if generation != v.fillGeneration { break }
        }
        sw.lap("the chat ready")
        guard generation == v.fillGeneration else { return } // (the chat reloaded meanwhile: filled after it, instead)
        guard v.onChatPage, st["editor"] as? Bool == true, st["usable"] as? Bool == true else {
            if let over = st["viewer"] as? String {
                report.log("claude", "\(name): \(over) stayed over the message box, nothing filled")
                Diagnostics.shared.log("chat", "the page's data wasn't put in: \(over) was over the chat's message box")
                return
            }
            report.log("claude", "\(name): no message box (\(v.onChatPage ? "signed out?" : "not on a conversation")), nothing filled")
            Diagnostics.shared.log("chat", "the page's data wasn't put in: the chat \(v.onChatPage ? "had no message box" : "wasn't on a conversation") for 20 s")
            return
        }
        if st["working"] as? Bool == true { return }
        guard let browser, inFront() || v.activity == .idle else { return }
        // (once per page: 11-16, leaving the chat and coming back put the page in a second time. What's in the box
        // is looked at (TRIF's tiles or text, or the person's own) and so is the record of the last fill, which
        // outlives a reload of the chat's page)
        let convKey = v.conversation ?? "new"
        let page = ClaudePane.pageKey(browser)
        let record = lastFill(v)
        let same = record.map { $0.conv == convKey && $0.page == page } ?? false
        var ours = st["trif"] as? Int ?? 0
        if ours == 0, st["has"] as? Bool != true, same {
            // (the record says it's in, unsent, but the box looks empty: a page that puts its draft back a moment
            // after it loads is given that moment)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            st = (Browser.parse(await chatJS(v, "state()")) as? [String: Any]) ?? st
            ours = st["trif"] as? Int ?? 0
        }
        // (Tim, 11-18: chatgpt.com put its draft back, TRIF's unsent fill for a YouTube page, into a chat opened on
        // x.com, beside x.com's attachments. TRIF's text names its page: one naming another page isn't this fill's,
        // whatever the record says. Old TRIF things go, this page's go in; the person's own words and files stay;
        // never two pages' at once)
        let pages = st["pages"] as? [String] ?? []
        let otherPage = pages.first { !ClaudePane.samePage($0, browser.webView.url) }
        let others = st["others"] as? Bool == true
        if ours > 0 {
            if same && otherPage == nil { report.log("claude", "\(name): the page is already in the message box, unsent: not again"); return }
            let r = try? await v.webView.callAsyncJavaScript("return globalThis.__trifChat ? await globalThis.__trifChat.clearTrif() : 1;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld)
            let left = (r as? NSNumber)?.intValue ?? 1
            let why = otherPage.map { "TRIF's text for \(URL(string: $0)?.host ?? "another page") was in the message box" } ?? "the tab changed since the last fill"
            report.log("claude", "\(name): \(why): TRIF's earlier things taken out\(others ? ", the person's own kept" : "")\(left > 0 ? " (not all of it: \(left) left, so nothing added)" : "")")
            if otherPage != nil || left > 0 {
                Diagnostics.shared.log("chat", "\(name) for \(tabSite): \(why); TRIF's earlier fill taken out\(others ? " (the person's own words kept)" : "")\(left > 0 ? ", but \(left) of its things stayed, so nothing was added" : "")")
            }
            if left > 0 { return }
        } else if st["has"] as? Bool == true {
            // (the person's own words or files: kept, and the page goes in with them, once: a fill recorded for this page
            // that's no longer there was taken out by the person)
            if same { report.log("claude", "\(name): the message box has the person's own things, and this page's fill was taken out: not again"); return }
            report.log("claude", "\(name): the message box has the person's own things: kept, the page added")
        }
        let conv = v.conversation
        if st["context"] as? Bool == true, let conv { noteContext(conv) }
        // (a follow-up only into a conversation that has TRIF's instructions and is this tab's site's (Tim, 11-16: an NYT
        // tab got a follow-up in his YouTube conversation). Another site's conversation, or one whose site isn't known,
        // gets the whole instructions, saying it's a different site.)
        let tabSite = browser.site
        let owner = conv.flatMap(ClaudePane.owner(of:))
        let has = conv.map(hasContext) ?? false
        let followUp = has && owner == tabSite
        let why: String
        if conv == nil { why = "a new chat" }
        else if followUp { why = "it has TRIF's instructions and is \(tabSite)'s" }
        else if !has { why = "it doesn't have TRIF's instructions yet" }
        else { why = "it's \(owner ?? "an unknown site")'s, not \(tabSite.isEmpty ? "this tab" : tabSite)'s" }
        report.log("claude", "\(name): fill for \(tabSite.isEmpty ? "no site" : tabSite) in \(conv.map { "conversation …\($0.suffix(8))" } ?? "a new chat") (recorded for \(owner ?? "no site yet")): \(followUp ? "the follow-up" : "the instructions"), as \(why)")
        var text = await ready.text.value
        // (made again when the chat turned out to be on another conversation than the one it was made for, or the
        // decision changed: a navigation inside the chat, say)
        if ready.conv != conv || ready.followUp != followUp {
            text = followUp ? await browser.feedbackForChat(conv: conv, sw)
                : await browser.pageForChat(conv: conv, sw, guideInProject: conv == nil && v.service.projectHasGuide)
        }
        if !followUp, has, let t = text { text = "(This is a different site: \(tabSite.isEmpty ? "another page" : tabSite). Start from these instructions and this page; the mods above in this conversation were for \(owner ?? "another site").)\n\n\(t)" }
        // (a new chat is this tab's site's once it has an address; one with no site recorded yet becomes this site's)
        if conv == nil { v.ownerNext = tabSite } else if owner == nil, let conv { ClaudePane.setOwner(conv, tabSite) }
        if let text {
            await fill(v, text, as: followUp ? "TRIF follow-up.txt" : "TRIF instruction.txt")
            sw.lap("text into the message box")
        }
        if let shot = await ready.shot.value {
            await fill(v, "", png: shot, picture: "TRIF screenshot.jpg")
            sw.lap("screenshot into the message box", "\(shot.count / 1000) kB JPEG")
        }
        setLastFill(v, FillRecord(conv: convKey, page: page, at: Date()))
        await browser.noteBaseline()
        sw.lap("the page's layout, for next time")
        sw.done()
    }

    /// From Web/chat.js, in any of the chats: an Add to TRIF tap; the person's send; a reply done, with the mod files in it.
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], let type = d["type"] as? String, let wv = message.webView, let v = view(of: wv) else { return }
        let name = v.service.rawValue
        switch type {
        case "stripbox":
            if strip, cur === v { stripMeasured(v, d["box"] as? [String: Any]) }
        case "mod":
            guard let text = d["text"] as? String else { return }
            report.log("claude", "\(name): Add to TRIF tapped (\(text.count) characters)")
            browser?.offer(text: text, site: v.site)
        case "sent":
            // (back to the tab at once: the reply is watched from here, the dots on the chat button)
            report.log("claude", "\(name): sent (\(d["how"] as? String ?? "?"))\(d["withInstructions"] as? Bool == true ? ", with TRIF's instructions" : "")")
            if d["withInstructions"] as? Bool == true || v.projectFill { if let conv = v.conversation { noteContext(conv) } else { v.contextNext = true } }
            v.projectFill = false
            setLastFill(v, nil)
            v.activity = .working
            v.workingSince = Date()
            v.workingConversation = v.conversation
            v.lastUsed = Date()
            sentLink(v)
            v.sentTab = link(v)?.tab
            askToNotify()
            // (a quick ask sent by the person's own Send in the strip (or in the whole chat): the strip slides away,
            // the pill says it's working)
            if let q = quick, q.key == ClaudePane.linkKey(v.service.rawValue, v.site), q.state == .waitingSend {
                quick?.state = .working
                watchReply(v, q.id)
                Diagnostics.shared.log("quick ask", "\(name): sent by the person (\(d["how"] as? String ?? "?"))")
            }
            if strip && cur === v { strip = false; blur(v) }
            if shown && cur === v { close() } else { blur(v) }
            let since = v.workingSince
            // (a reply that never says it's done, a page that went away: the dots stop after 16 minutes)
            Task { @MainActor [weak self, weak v] in
                try? await Task.sleep(nanoseconds: 16 * 60 * 1_000_000_000)
                guard let v, v.activity == .working, v.workingSince == since else { return }
                v.activity = .idle
                self?.updateLink(v) { if $0.state == .working { $0.state = .read } }
            }
        case "done":
            // (the mods: the reply's new code blocks with a whole mod file in each)
            handleDone(v, d, d["mods"] as? [String] ?? [])
        case "held":
            // (mod files on the page that weren't offered: outside the assistant's replies (the person's own pasted
            // code, the message box) or in replies TRIF didn't see arrive (an old conversation's history), Tim, 11-18)
            let outside = d["outside"] as? Int ?? 0, history = d["history"] as? Int ?? 0
            var parts: [String] = []
            if outside > 0 { parts.append("\(outside) outside the assistant's replies") }
            if history > 0 { parts.append("\(history) in replies not seen arriving") }
            let how = "\(d["why"] as? String ?? "?"), \(d["mode"] as? String ?? "?"), \(d["anchored"] as? Bool == true ? "sent message found" : "no sent message found"), \(d["live"] as? Int ?? 0) live"
            Diagnostics.shared.log("chat offers", "held from \(v.site.isEmpty ? "no site" : v.site) at \(d["path"] as? String ?? "?"): \(parts.joined(separator: ", ")) (\(how))")
        case "fillguard":
            // (the page put something of TRIF's back after the fill (its saved draft): taken out again by chat.js)
            let gone = (d["gone"] as? [String] ?? []).joined(separator: ", ")
            report.log("claude", "\(name): after the fill, taken out again: \(gone)")
            Diagnostics.shared.log("chat", "\(name) for \(v.site.isEmpty ? "no site" : v.site): the page put back an earlier fill after TRIF's (its saved draft): taken out again: \(gone)")
        case "nopickup":
            // (a reply with code in it, and no mod read from it: what there was, for the next report)
            let what = "\(name)'s reply at \(d["path"] as? String ?? "?") had \(d["blocks"] as? Int ?? 0) code block(s)\(d["header"] as? Bool == true ? " and a mod's header" : ""), and no mod was read from it (\(d["kinds"] as? String ?? "?"))"
            report.log("claude", what)
            Diagnostics.shared.log("chat", what)
        case "viewer":
            // (the chat's own viewer opened, on a file the person tapped: the mod it shows, to Add this mod?; or, when no
            // code could be read off it, a line in the diagnostics, so the next report shows what was there)
            let text = d["text"] as? String ?? ""
            let file = d["name"] as? String ?? ""
            let what = "\(d["why"] as? String ?? "a viewer")\(file.isEmpty ? "" : " on \(file)") at \(d["path"] as? String ?? "?")"
            if let skipped = d["skipped"] as? String {
                // (a viewer the chat opened by itself, with no tap and no new reply: old code, not offered)
                Diagnostics.shared.log("chat offers", "viewer from \(v.site.isEmpty ? "no site" : v.site): skipped \(file.isEmpty ? "its file" : file) (\(skipped))")
                return
            }
            if text.isEmpty {
                report.log("claude", "\(name): \(what), no mod's code read off it")
                if file.lowercased().hasSuffix(".js") { Diagnostics.shared.log("chat files", "\(name)'s viewer opened \(what), and no mod's code could be read off it") }
                return
            }
            report.log("claude", "\(name): \(what): its code read (\(text.count) characters), to Add this mod?")
            guard let browser else { return }
            Task { @MainActor in
                let offered = await browser.offerFromChat([text], from: v.site, path: "viewer")
                if let conv = v.conversation { for m in offered { browser.noteChatHas(m.code, conv) } }
            }
        default: break
        }
    }

    /// A reply done, with the mod files in its code blocks: offered with Add this mod? (whichever chat is showing, or
    /// none). None: the chat button's replied mark.
    private func handleDone(_ v: ChatView, _ d: [String: Any], _ texts: [String]) {
        report.log("claude", "\(v.service.rawValue): reply done (\(d["why"] as? String ?? "?")\(d["stop"] as? Bool == true ? ", its stop button seen" : "")) for \(v.site.isEmpty ? "no site" : v.site), \(texts.count) mod file(s) in it")
        let late = d["why"] as? String == "late"
        // (the person went to another conversation before the reply was done: its watch ended, nothing offered)
        let key = ClaudePane.linkKey(v.service.rawValue, v.site)
        if d["why"] as? String == "left" {
            if v.activity == .working { v.activity = .idle }
            updateLink(v) { if $0.state == .working { $0.state = .read } }
            if quick?.key == key, quick?.state == .working { quick = nil }
            endBackgroundIfIdle(); return
        }
        guard v.activity == .working || late else { return }
        guard let browser else { v.activity = .idle; endBackgroundIfIdle(); return }
        // (looking at this chat: as ever. Else the done banner (Tim, 11-18), its mods held for its Add or Go to
        // <site>; but on the chat's own site's tab, nothing over it, Add this mod? comes up at once, as before)
        let looking = shown && cur === v
        let onItsTab = !shown && !v.site.isEmpty && browser.site == v.site && ContentView.coversNow == "none"
        let hold = !looking && !onItsTab
        // (a quick ask's reply: its look-only mods added at once, the rest to their card; the pill says which)
        let isQuick = !late && quick?.key == key && quick?.state == .working
        Task { @MainActor in
            if isQuick, texts.isEmpty, d["why"] as? String == "quiet", d["stop"] as? Bool != true, d["replies"] as? Int == 0 {
                // (nothing came back at all: the page never showed a reply being written and nothing changed. Not
                // "Replied": the pill amber, its tap opening the chat to see)
                self.quick?.slow = "Nothing back from \(v.service.rawValue): open the chat"
                v.activity = .idle
                self.updateLink(v) { $0.state = .read }
                Diagnostics.shared.log("quick ask", "\(v.service.rawValue): sent, and nothing came back on the page")
                self.endBackgroundIfIdle()
                return
            }
            if isQuick {
                let offered = await self.quickDeliver(texts, site: v.site, path: "quick", hold: hold, view: v)
                if let conv = v.conversation { for m in offered { browser.noteChatHas(m.code, conv) } }
                if UIApplication.shared.applicationState == .background { self.notifyDone(v, offered) }
                v.activity = offered.isEmpty && !looking ? .replied : .idle
                self.updateLink(v) { $0.state = looking || !offered.isEmpty ? .read : .waiting }
                self.endBackgroundIfIdle()
                return
            }
            let offered = await browser.offerFromChat(texts, from: v.site, path: late ? "late" : "auto", hold: hold)
            if let conv = v.conversation { for m in offered { browser.noteChatHas(m.code, conv) } }
            // (the app in the background: a notification says so, then iOS's background time is given back)
            if UIApplication.shared.applicationState == .background { self.notifyDone(v, offered) } // (not inactive: an alert of the system's over the app)
            if late {
                if !offered.isEmpty, v.activity == .replied { v.activity = .idle }
                if hold, !offered.isEmpty { self.banner(v, offered) }
                self.endBackgroundIfIdle(); return
            }
            v.activity = !offered.isEmpty || looking ? .idle : .replied
            self.updateLink(v) { $0.state = looking ? .read : .waiting }
            // (mods in the reply TRIF didn't see being written: the banner says so, and the chat opens at them)
            let inChat = texts.isEmpty ? d["waiting"] as? Int ?? 0 : 0
            v.waitingMods = looking ? 0 : inChat
            if inChat > 0 { Diagnostics.shared.log("chat offers", "\(v.service.rawValue) for \(v.site.isEmpty ? "no site" : v.site): \(inChat) mod(s) in the reply, not seen being written: left in the chat for its Add to TRIF\(looking ? "" : ", the done banner says so")") }
            if !looking && (hold || offered.isEmpty) { self.banner(v, hold ? offered : [], inChat: inChat) }
            self.endBackgroundIfIdle()
        }
    }

    // MARK: chat links (Tim, 11-18): from a chat back to its tab, the done banner, the tabs' badges, the chats' list

    nonisolated static func linkKey(_ service: String, _ site: String) -> String { "\(service)|\(site)" }
    /// The chats sent from, newest first (ChatLink).
    @Published private(set) var links: [ChatLink] = []
    /// Replies done in chats not being looked at, oldest first: the first is the banner shown.
    @Published private(set) var banners: [ChatBanner] = []
    private static let linksKey = "chatLinks"

    private func loadLinks() {
        guard let data = UserDefaults.standard.data(forKey: ClaudePane.linksKey),
              var list = try? JSONDecoder().decode([ChatLink].self, from: data) else { return }
        // (a reply being written when the app last ran isn't watched any more: no chat page is loaded yet, and when
        // one is, it watches only a send of its own. Plain, so nothing spins for ever)
        let stale = list.filter { $0.state == .working }.count
        for i in list.indices where list[i].state == .working { list[i].state = .read }
        links = list
        if stale > 0 { Diagnostics.shared.log("chats", "\(stale) chat(s) were writing a reply when TRIF last ran: shown as plain") }
    }
    private func saveLinks() {
        links.sort { $0.at > $1.at }
        if links.count > 20 { links.removeLast(links.count - 20) }
        if let data = try? JSONEncoder().encode(links) { UserDefaults.standard.set(data, forKey: ClaudePane.linksKey) }
    }
    func link(_ v: ChatView) -> ChatLink? { links.first { $0.id == ClaudePane.linkKey(v.service.rawValue, v.site) } }
    private func updateLink(_ v: ChatView, _ change: (inout ChatLink) -> Void) {
        guard let i = links.firstIndex(where: { $0.id == ClaudePane.linkKey(v.service.rawValue, v.site) }) else { return }
        var l = links[i]
        change(&l)
        guard l != links[i] else { return }
        links[i] = l
        saveLinks()
    }
    /// A send: the chat's link, with the tab it was sent from. A chat shown for another site than the tab's (the
    /// chats' list, all three busy) keeps the tab it had: the shown tab isn't its.
    private func sentLink(_ v: ChatView) {
        guard let browser, !v.site.isEmpty else { return }
        let here = browser.current!
        var l = link(v) ?? ChatLink(service: v.service.rawValue, site: v.site, tab: nil, tabTitle: "", tabURL: nil, conv: nil, state: .working, at: Date())
        if browser.site == v.site { l.tab = here.id; l.tabTitle = here.title; l.tabURL = (here.webView.url ?? here.savedURL)?.absoluteString }
        l.conv = v.conversation ?? l.conv
        l.state = .working
        l.at = Date()
        links.removeAll { $0.id == l.id }
        links.insert(l, at: 0)
        saveLinks()
    }
    /// A chat shown: its reply read (a mod added stays so), its plain banner gone.
    private func seen(_ v: ChatView) {
        updateLink(v) { if $0.state == .waiting { $0.state = .read } }
        let key = ClaudePane.linkKey(v.service.rawValue, v.site)
        banners.removeAll { $0.link == key && $0.mods.isEmpty }
    }
    /// A mod from a site's chat added: its newest link says so.
    private func modAdded(_ site: String) {
        guard let i = links.firstIndex(where: { $0.site == site }), links[i].state != .working else { return }
        links[i].state = .added
        saveLinks()
    }
    private func banner(_ v: ChatView, _ mods: [InstalledMod], inChat: Int = 0) {
        let key = ClaudePane.linkKey(v.service.rawValue, v.site)
        // (one per chat: a later reply's joins it, mods and all)
        if let i = banners.firstIndex(where: { $0.link == key }) { banners[i].mods += mods; banners[i].inChat += inChat; return }
        var b = ChatBanner(link: key, service: v.service.rawValue, site: v.site, mods: mods)
        b.inChat = inChat
        banners.append(b)
        Diagnostics.shared.log("chats", "done banner for \(v.site.isEmpty ? "no site" : v.site): \(mods.isEmpty ? "a reply" : "\(mods.count) mod(s) held for it")")
    }
    /// The banner's ✕ (or swiped up): its mods dismissed, as a sheet swiped away is.
    func dismissBanner(_ b: ChatBanner) {
        banners.removeAll { $0.id == b.id }
        browser?.dismissHeld(b.mods)
    }
    /// The banner's Add: its mods to Add this mod?, over what's shown.
    func addFromBanner(_ b: ChatBanner) {
        banners.removeAll { $0.id == b.id }
        browser?.offerHeld(b.mods)
    }
    /// Go to <site>: the chat closed and its tab shown; that tab closed (or gone to another site): a new tab at the
    /// page it was on, else the site's home (a new tab, as a link opens one: nothing rewritten). Its held mods, if
    /// it has a banner with any, then come up there. Returns false for a chat with no site. The shared rule decides
    /// which (TabListRules: tabList.goTo; a chat not sent from yet: fallbackLink's tab, the same choice).
    @discardableResult
    func goToSite(_ key: String) -> Bool {
        guard let browser else { return false }
        let link = links.first(where: { $0.id == key })
        let chat = link == nil ? views.first(where: { ClaudePane.linkKey($0.service.rawValue, $0.site) == key })?.site : nil
        guard let site = link?.site ?? chat,
              let go = TabListRules.goTo(link: link.map { ($0.site, $0.tab, $0.tabURL) }, chat: chat, tabs: browser.tabs.map(\.facts), current: browser.current.id)
        else { return false }
        if shown { close() }
        switch go {
        case .tab(let id):
            if let t = browser.tabs.first(where: { $0.id == id }), t !== browser.current { browser.select(t) }
            Diagnostics.shared.log("chats", "go to \(site): its tab")
        case .open(let address, let page):
            browser.newTab(address)
            Diagnostics.shared.log("chats", "go to \(site): its tab is closed or on another site, a new tab at \(page ? "its page" : "the site")")
            if let i = links.firstIndex(where: { $0.id == key }) { links[i].tab = browser.current.id; links[i].tabURL = browser.current.webView.url?.absoluteString ?? (page ? address : nil); saveLinks() }
        }
        follow(site: browser.site)
        if let i = banners.firstIndex(where: { $0.link == key }) {
            let b = banners.remove(at: i)
            browser.offerHeld(b.mods)
        }
        return true
    }
    /// A chat the person hasn't sent from (its top bar's ← site): a link made from the chat itself, no tab.
    private func fallbackLink(_ key: String) -> ChatLink? {
        guard let v = views.first(where: { ClaudePane.linkKey($0.service.rawValue, $0.site) == key }) else { return nil }
        // (the shown tab is on its site: that one)
        var t: Tab?
        if let b = browser { t = b.site == v.site ? b.current : b.tabs.last { Site.of($0.host) == v.site } }
        return ChatLink(service: v.service.rawValue, site: v.site, tab: t?.id, tabTitle: t?.title ?? "", tabURL: nil, conv: v.conversation, state: .read, at: Date())
    }
    /// The tab the shown chat (or the quick ask's strip) belongs to, for the tab list to open at (Tim, 11-18): the one it
    /// was sent from while open and on its site, else nil (the shown tab). More follows the shown tab: nil.
    /// The shared rule decides (TabListRules: tabList.focus).
    var chatTabShown: UUID? {
        guard let browser else { return nil }
        let link = links.first(where: { $0.id == curKey })
        let chat = link == nil ? views.first(where: { ClaudePane.linkKey($0.service.rawValue, $0.site) == curKey })?.site : nil
        return TabListRules.focus(open: shown || strip, more: more, link: link.map(\.facts), chat: chat,
                                  tabs: browser.tabs.map(\.facts), current: browser.current.id)
    }
    /// The shown chat's way back (its top bar's ← site).
    var curKey: String { ClaudePane.linkKey(cur.service.rawValue, cur.site) }
    /// A tab's robot badge in the tab list: its chats' (sent from it, while it's on their site): working, a reply
    /// waiting, or plain (nil: no chat).
    func badge(for tab: UUID) -> ChatActivity? { badges()[tab] }
    /// Every tab's badge with any, at once (the tab list asks once a drawing): the shared rule (tabList.badges).
    func badges() -> [UUID: ChatActivity] {
        guard let browser else { return [:] }
        return TabListRules.badges(links: links.map(\.facts), tabs: browser.tabs.map(\.facts)).compactMapValues(ChatActivity.init(rawValue:))
    }
    /// A chat from the chats' list (or a banner's Open chat): shown, at its conversation, nothing put in its box.
    func openChat(_ key: String) {
        guard let l = links.first(where: { $0.id == key }) ?? fallbackLink(key), let s = ChatService(rawValue: l.service) else { return }
        if more { more = false; UserDefaults.standard.set(false, forKey: "chatMore") }
        if s != service { service = s; UserDefaults.standard.set(s.rawValue, forKey: "chatService") }
        let v = viewFor(l.site)
        cur = v
        v.lastUsed = Date()
        if !v.started {
            if let c = l.conv, ClaudePane.owner(of: c) == l.site, let u = URL(string: c) { v.started = true; go(v, u) } else { start(v) }
        } else if v.activity != .working, let c = l.conv, v.conversation != c, ClaudePane.owner(of: c) == l.site, let u = URL(string: c) {
            go(v, u)
        }
        shown = true
        if v.activity == .replied { v.activity = .idle; let toMod = v.waitingMods > 0; v.waitingMods = 0; queue(v) { [weak self] in _ = await self?.chatJS(v, "showReply(\(toMod))") } }
        seen(v)
        report.log("claude", "\(s.rawValue): the chat for \(l.site) opened from its link")
    }
    /// A notification's tap, or the person at the chat's tab: a banner's held mods come up there.
    private func arrived(_ v: ChatView) {
        let key = ClaudePane.linkKey(v.service.rawValue, v.site)
        if let i = banners.firstIndex(where: { $0.link == key }) {
            let b = banners.remove(at: i)
            if !b.mods.isEmpty { browser?.offerHeld(b.mods) }
        }
    }

    // MARK: quick ask (QuickAsk.swift; Tim, 11-18): the robot's long press, a box, the request to the tab's chat

    /// The quick ask under way (the pill above the toolbar), or nil.
    @Published var quick: QuickAsk?
    /// Claude's or ChatGPT's real page in a slim strip over the tab: its message box, filled, and its own Send. While
    /// this is on and `stripIn` isn't yet, the chat is being filled behind the tab.
    @Published private(set) var strip = false {
        didSet { if oldValue && !strip { stripEnded() } }
    }
    /// The strip slid in (Tim, 11-18: it went "up and down and up and down" as Claude's page loaded): only once the box
    /// is filled and the page has settled (its box's text, attachments and place unchanged for 0.3 s), at its final
    /// size; it never moves after that but with the keyboard the person brings up. Until then the pill says it's
    /// getting ready (QuickPill).
    @Published private(set) var stripIn = false
    /// How much of the chat's page the strip shows under its header (Tim, 11-18: "a very little panel that shows the
    /// text"): what shows of the box's text and the site's own Send, no attachments or anything else. Fixed once in.
    @Published private(set) var stripBody: CGFloat = 0
    /// How far the chat's page is moved down inside the strip, so that part's foot sits at the strip's foot. It follows
    /// the page from then on, with no animation, so a page changing under it doesn't move what shows.
    @Published private(set) var stripShift: CGFloat = 0
    /// Where the strip's part of the page is in the chat's web view (points), and what tells it changed.
    private struct StripPlace { var top: CGFloat; var bottom: CGFloat; var height: CGFloat; var sig: String; var ready: Bool }
    private var stripTask: Task<Void, Never>?
    private var stripPlace: StripPlace?
    private var stripSig = ""
    private var stripChanged = Date()
    private var stripStarted = Date()

    /// The keyboard coming up now isn't the person's: the strip's chat is being filled behind the tab (its fill
    /// focuses the box for each paste and blurs it at once; on a phone that can still start the keyboard), nothing of
    /// it shows, and no finger is on a page.
    var keyboardNotTheirs: Bool { strip && !stripIn && !shown && TouchClock.down == 0 && (TouchClock.lastLift.map { Date().timeIntervalSince($0) > 1.5 } ?? true) }

    /// The shown chat's page has the keyboard's focus (a view of its web view is the first responder).
    var chatHasFocus: Bool {
        func has(_ v: UIView) -> Bool { v.isFirstResponder || v.subviews.contains(where: has) }
        return cur.map { has($0.webView) } ?? false
    }

    /// The strip's part of the page from chat.js's stripBox (document coordinates), in the web view's points.
    private func place(_ v: ChatView, _ box: [String: Any]?) -> StripPlace? {
        guard let box, let top = (box["top"] as? NSNumber)?.doubleValue, let bottom = (box["bottom"] as? NSNumber)?.doubleValue else { return nil }
        let sv = v.webView.scrollView
        let z = sv.zoomScale
        let t = sv.convert(CGPoint(x: 0, y: top * z), to: v.webView).y
        let b = sv.convert(CGPoint(x: 0, y: bottom * z), to: v.webView).y
        let h = v.webView.bounds.height
        let sig = "\(Int(t.rounded())) \(Int(b.rounded())) \(Int(h)) \(box["chars"] ?? "") \(box["tiles"] ?? "") \(box["box"] ?? "") \(box["send"] ?? "")"
        return StripPlace(top: t, bottom: b, height: h, sig: sig, ready: box["ready"] as? Bool ?? false)
    }
    /// A measure of the strip's part of the page (chat.js tells each change while the strip is on; the settling asks too).
    private func stripMeasured(_ v: ChatView, _ box: [String: Any]?) {
        let p = place(v, box)
        stripPlace = p
        let sig = p?.sig ?? "none"
        if sig != stripSig { stripSig = sig; stripChanged = Date() }
        if stripIn, let p { pin(p) }
    }
    /// The strip's part of the page kept where it shows, at once (no animation): what moved in the page doesn't move there.
    private func pin(_ p: StripPlace) {
        let shift = p.height - p.bottom - QuickStrip.pad
        guard abs(shift - stripShift) > 0.5 else { return }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { stripShift = shift }
    }
    /// After the fill: the page watched until it settles, then the strip slides in, once.
    private func settleStrip(_ v: ChatView, _ id: UUID) async {
        stripTask?.cancel()
        stripStarted = Date()
        stripChanged = Date()
        stripSig = ""
        stripPlace = nil
        _ = await chatCall(v, "stripWatch(true)", [:])
        stripTask = Task { @MainActor [weak self, weak v] in
            while !Task.isCancelled, let self, let v, self.strip, !self.stripIn, self.cur === v, self.quick?.id == id {
                let box = try? await v.webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.stripBox() : null;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) as? [String: Any]
                guard !Task.isCancelled, self.strip, !self.stripIn else { return }
                self.stripMeasured(v, box)
                let quiet = Date().timeIntervalSince(self.stripChanged)
                let waited = Date().timeIntervalSince(self.stripStarted)
                // (settled: unchanged 0.3 s, the page loaded (or 3 s waited for a page that goes on loading); never
                // more than 8 s: then as it is)
                let settled = self.stripPlace != nil && quiet >= 0.3 && ((self.stripPlace?.ready ?? false) || waited > 3)
                if settled || waited > 8 { self.slideIn(v, waited: waited, settled: settled); return }
                try? await Task.sleep(nanoseconds: 60_000_000)
            }
        }
    }
    private func slideIn(_ v: ChatView, waited: TimeInterval, settled: Bool) {
        if let p = stripPlace {
            let part = min(max(p.bottom - p.top, 0), QuickStrip.maxPart)
            stripBody = max(QuickStrip.minBody, part + 2 * QuickStrip.pad)
            stripShift = p.height - p.bottom - QuickStrip.pad
        } else {
            // (no box found: the page's foot, as before)
            stripBody = QuickStrip.noBoxBody
            stripShift = 0
        }
        stripIn = true
        Diagnostics.shared.log("quick ask", "the strip in after \(String(format: "%.1f", waited)) s of filling and settling\(settled ? "" : " (not settled: shown as it is)"), \(Int(stripBody)) pt of the page\(stripPlace == nil ? " (no message box found: the page's foot)" : "")")
    }
    /// The strip gone (sent, cancelled, the whole chat opened, a new ask): its watching stopped.
    private func stripEnded() {
        stripTask?.cancel()
        stripTask = nil
        stripIn = false
        if let v = cur { Task { _ = await chatCall(v, "stripWatch(false)", [:]) } }
    }

    /// A request from the box: to the tab's site's chat (its conversation if it has one, else a new one), with the
    /// page as the robot's tap puts it. Claude / ChatGPT: the strip, for the person's own Send (TRIF never sends
    /// there). More: sent at once by TRIF's own panel.
    func quickAsk(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let browser, !tabSite.isEmpty, browser.webView.url?.scheme?.hasPrefix("http") == true else {
            quick = QuickAsk(request: text, service: more ? "More" : service.rawValue, site: "", key: "", state: .failed("Open a website first, then ask."))
            return
        }
        if more { return quickMore(text) }
        if shown { close() }
        // (an ask still waiting for its Send: its words come out of the box before the new ones go in)
        let prior = quick?.state == .waitingSend ? quick : nil
        showFor(tabSite)
        let v = cur!
        let was = v.activity
        if was == .replied { v.activity = .idle }
        seen(v)
        let key = ClaudePane.linkKey(v.service.rawValue, v.site)
        quick = QuickAsk(request: text, service: v.service.rawValue, site: v.site, key: key, state: .waitingSend)
        let id = quick!.id
        // (a strip still up from an ask not sent: it goes, and comes in again once this one has settled)
        if strip { strip = false }
        strip = true
        Diagnostics.shared.log("quick ask", "\(v.service.rawValue) for \(v.site): \(text.count) characters; the strip up for the person's own Send\(was == .working ? " (a reply still being written there)" : "")")
        let ready = was != .working && v.site == tabSite ? prepare(v) : nil
        queue(v) { [weak self] in
            guard let self else { return }
            // (signed in, a message box to fill? Else the pill says so at once, red, and its tap opens the chat there:
            // Tim, 11-18, "only say Working when it's actually working")
            if let problem = await self.askable(v), self.quick?.id == id {
                self.strip = false
                self.quick = QuickAsk.problem(text, service: v.service.rawValue, site: v.site, key: key, problem, fix: .chat)
                Diagnostics.shared.log("quick ask", "\(v.service.rawValue) for \(v.site): not filled (\(problem))")
                return
            }
            if let prior, prior.key == key { _ = await self.chatCall(v, "takeText(t)", ["t": prior.request]) }
            if let ready { await self.fillContext(v, ready) }
            let said = await self.fill(v, text)
            // (the person's message appearing is the send, however they sent it)
            let armed = await self.chatCall(v, "armSend()", [:]) ?? "?"
            Diagnostics.shared.log("quick ask", "the request into \(v.service.rawValue)'s box: \(said); watching for the send: \(armed)")
            // (the strip slides in once the page has settled with all of it)
            if self.strip, self.quick?.id == id { await self.settleStrip(v, id) }
        }
    }

    /// The chat page can't take a request: why, in the pill's words (nil: its message box is there). Waits a little
    /// for a page still loading (chat.js canAsk: up to 6 s, at once on a sign-in page).
    private func askable(_ v: ChatView) async -> String? {
        var said: String?
        let until = Date().addingTimeInterval(20)
        while Date() < until {
            // (a page still on its way (a sign-in page is often a redirect): asked once it's there)
            if v.webView.isLoading || v.webView.url?.scheme?.hasPrefix("http") != true { try? await Task.sleep(nanoseconds: 200_000_000); continue }
            let before = v.webView.url
            said = await chatCall(v, "canAsk(ms)", ["ms": 6000])
            if said == "box" || said == "signed out" || said == "viewer" { break }
            // (chat.js not in the page yet, or the page moved on meanwhile: asked again)
            if said == nil || v.webView.url != before || v.webView.isLoading { try? await Task.sleep(nanoseconds: 250_000_000); continue }
            break
        }
        switch said {
        case "box": return nil
        case "signed out": return "Sign in to \(v.service.rawValue) first"
        case "viewer": return "Close what's open in \(v.service.rawValue) first"
        case nil: return "\(v.service.rawValue) didn't load: open the chat"
        default: return "\(v.service.rawValue) has no message box: open the chat"
        }
    }

    /// Claude / ChatGPT sent (the person's Send): no reply text growing on the page for 150 s (a stop button alone
    /// doesn't count), the pill amber; words later, Working again. Looked at every 5 s while working.
    private func watchReply(_ v: ChatView, _ id: UUID) {
        Task { @MainActor [weak self, weak v] in
            var last: String?
            var since = Date()
            while true {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, let v, self.quick?.id == id, self.quick?.state == .working else { return }
                // (only the reply's text counts: a stop button shown for minutes with no words is still nothing)
                let now = await self.chatCall(v, "replyNow()", [:]).map { String($0.drop { $0 != ":" }) }
                if now != last {
                    if last != nil, self.quick?.slow != nil { self.quick?.slow = nil }
                    since = Date()
                    last = now
                } else if Date().timeIntervalSince(since) >= 150, self.quick?.slow == nil {
                    self.quick?.slow = "Still nothing back from \(v.service.rawValue): open the chat"
                    Diagnostics.shared.log("quick ask", "\(v.service.rawValue): no reply text on the page for 150 s (\(now?.isEmpty == false ? "a reply being written shown" : "nothing shown"))")
                }
            }
        }
    }

    /// More: the panel's own message box, sent (TRIF's own page), once its engine is checked: a model chosen, its key,
    /// the model on this iPhone downloaded, the computer paired (PanelChat.quickSend). Working only once sent; its
    /// run's news (quickMoreNews) and end (quickMoreDone) come back.
    private func quickMore(_ text: String) {
        if shown { close() }
        let site = tabSite
        quick = QuickAsk(request: text, service: "More", site: site, key: "More|\(site)", state: .starting)
        quick?.engine = moreLabel?.fix == nil ? moreLabel?.text : nil
        let id = quick!.id
        Diagnostics.shared.log("quick ask", "More for \(site): \(text.count) characters, to TRIF's panel")
        Task { @MainActor [weak self] in
            guard let self else { return }
            let said = await self.panel.quickSend(text)
            guard self.quick?.id == id else { return }
            let why: String
            var fix: QuickAsk.Fix = .chat
            switch said {
            case .sent(let engine):
                if self.quick?.state == .starting { self.quick?.state = .working }
                Diagnostics.shared.log("quick ask", "More: sent to \(engine)")
                return
            case .busy: why = "Still working on this site. Ask again when it's done."
            case .nosite: why = "Open a website first, then ask."
            case .problem(let w, let f): why = w; fix = f
            default: why = "More can't ask yet: open the chat to set it up."
            }
            self.quick?.state = .failed(why)
            self.quick?.fix = fix
            Diagnostics.shared.log("quick ask", "More: not sent (\(said))")
        }
    }

    /// Where a red note or Go to chat's red line sends the person: More's Settings at what's missing, or the pairing.
    func openFix(_ fix: QuickAsk.Fix) {
        Diagnostics.shared.log("quick ask", "fix opened: \(fix)")
        switch fix {
        case .pair: PhoneLinkModel.shared.shown = true
        case .chat: open()
        case .settings(let what):
            choose(more: true)
            open()
            Task { @MainActor [weak self] in
                guard let self else { return }
                for _ in 0..<20 {
                    if (try? await self.panel.webView.callAsyncJavaScript("return window.__trifPanelShowSettings ? window.__trifPanelShowSettings(w) : false;", arguments: ["w": what], in: nil, contentWorld: .page)) as? Bool == true { return }
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
            }
        }
    }

    /// What the chat will use, in words, for Go to chat (and the quick ask's pill): Claude · claude.ai, ChatGPT ·
    /// chatgpt.com, or More's engine and model (PanelChat.engineLabel), looked at again each time the list opens.
    @Published private(set) var moreLabel: PanelChat.EngineLabel?
    var engineLabel: PanelChat.EngineLabel {
        if more { return moreLabel ?? PanelChat.EngineLabel(text: "More", fix: nil) }
        return PanelChat.EngineLabel(text: "\(service.rawValue) · \(service.host)", fix: nil)
    }
    func refreshEngineLabel() {
        guard more else { return }
        Task { @MainActor [weak self] in
            guard let self, let l = await self.panel.engineLabel() else { return }
            if self.moreLabel != l { self.moreLabel = l }
        }
    }

    /// A quick ask's More run, as it goes (PanelChat.quickNews).
    private func quickMoreNews(_ news: PanelChat.QuickNews) {
        guard quick?.service == "More", quick?.state == .working || quick?.state == .starting else { return }
        switch news {
        case .progress: if quick?.slow != nil { quick?.slow = nil }
        case .slow(let words): quick?.slow = words
        case .failed(let words, let fix):
            quick?.state = .failed(words)
            quick?.fix = fix
            quick?.slow = nil
            Diagnostics.shared.log("quick ask", "More: the engine said no (\(words))")
        }
    }

    /// A quick ask's More run done (PanelChat.quickDone). Its pill closed meanwhile: offered as ever.
    func quickMoreDone(_ site: String, _ codes: [String], ok: Bool, path: String) async -> Int {
        guard quick?.service == "More", quick?.state == .working || quick?.state == .starting else {
            guard let browser, !codes.isEmpty else { return 0 }
            return await browser.offerFromChat(codes, from: site, path: path).count
        }
        if codes.isEmpty && !ok {
            quick?.state = .failed("Not done: open the chat to see why.")
            return 0
        }
        return await quickDeliver(codes, site: site, path: "quick \(path)", hold: false, view: nil).count
    }

    /// A quick ask's reply: its mods judged as any chat's (offered once: ChatOffers), the look-only ones added at
    /// once (Undo keeps what each replaced), the others to Add this mod? or the approval card: now, or held by the
    /// done banner when the person is elsewhere (`hold`). The pill says Done, Replied, or goes for the card.
    private func quickDeliver(_ texts: [String], site: String, path: String, hold: Bool, view v: ChatView?) async -> [InstalledMod] {
        guard let browser else { return [] }
        let offered = await browser.offerFromChat(texts, from: site, path: path, hold: true)
        let sorted = QuickAskRules.sort(offered.map(\.quickFacts), chatSite: site)
        let s = sorted.site
        // (offered ids are one each: offerFromChat keeps a mod's last block)
        let look = offered.filter { sorted.look.contains($0.id) }
        let rest = offered.filter { sorted.rest.contains($0.id) }
        var applied: [(id: String, before: InstalledMod?)] = []
        for m in look {
            applied.append((m.id, browser.mods.mods.first { $0.id == m.id }))
            browser.addMod(m, quiet: true)
        }
        if !rest.isEmpty { if hold, let v { banner(v, rest) } else { browser.offerHeld(rest) } }
        quick?.applied = applied
        quick?.state = sorted.state == "done" ? .done : sorted.state == "card" ? .card : .replied
        if quick?.state == .card { quick = nil }
        Diagnostics.shared.log("quick ask", "reply for \(s.isEmpty ? "no site" : s): \(look.count) look-only mod(s) added (\(look.map(\.id).joined(separator: ", "))), \(rest.count) to their card\(rest.isEmpty ? "" : hold ? " (held by the done banner)" : "")")
        return offered
    }

    /// Done's Undo: each mod added as it was before (removed if it was new), the page shown again with it.
    func quickUndo() {
        guard let q = quick, q.state == .done, let browser else { return }
        for step in QuickAskRules.undo(state: "done", applied: q.applied.map { ($0.id, $0.before != nil) }) {
            guard let a = q.applied.last(where: { $0.id == step.id }) else { continue }
            if let code = browser.mods.mods.first(where: { $0.id == a.id })?.code { browser.chatOffers.note(code, .declined) }
            browser.mods.undoAdd(a.id, before: step.back ? a.before : nil)
        }
        browser.modsChanged(why: "the quick ask's Undo")
        quick?.applied = []
        quick?.state = .undone
        Diagnostics.shared.log("quick ask", "undone: \(q.applied.map { "\($0.id) \($0.before == nil ? "removed" : "back to its version before")" }.joined(separator: ", "))")
    }
    /// The pill tapped: its chat, at its conversation (More: the panel).
    func quickOpen() {
        guard let q = quick else { return }
        if q.state == .waitingSend { return expandStrip() }
        // (a red note: where it says to go)
        if q.failed, q.fix != .chat {
            quick = nil
            return openFix(q.fix)
        }
        if q.service == "More" { choose(more: true); open() }
        else if !q.key.isEmpty { openChat(q.key) }
        if q.state == .replied || q.state == .undone || { if case .failed = q.state { return true } else { return false } }() { quick = nil }
    }
    /// The strip's ✕: no ask; the request's words out of the box (the page's own things stay, as a fill left unsent).
    func cancelStrip() {
        guard strip else { return }
        strip = false
        let v = cur!
        blur(v)
        if let q = quick, q.state == .waitingSend {
            quick = nil
            queue(v) { [weak self] in _ = await self?.chatCall(v, "takeText(t)", ["t": q.request]); self?.blur(v) }
            Diagnostics.shared.log("quick ask", "cancelled in the strip")
        }
    }
    /// The strip's expand: the whole chat, as it is (its Send there counts as the quick ask's too).
    func expandStrip() {
        strip = false
        shown = true
        seen(cur)
    }
    /// The chat's JS with arguments, in TRIF's world there.
    private func chatCall(_ v: ChatView, _ call: String, _ args: [String: Any]) async -> String? {
        let r = try? await v.webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.\(call) : null;", arguments: args, in: nil, contentWorld: ClaudePane.chatWorld)
        return r.map { "\($0)" }
    }
    /// (development: the quick ask's state, for the dev steps)
    var quickDescribe: String {
        guard let q = quick else { return "quick: none, strip \(strip)" }
        return "quick: \(q.service) for \(q.site.isEmpty ? "no site" : q.site), \(q.state)\(q.failed ? " fix \(q.fix)" : "")\(q.slow.map { " slow \"\($0)\"" } ?? ""), applied \(q.applied.map(\.id)), strip \(strip)\(strip ? " (in \(stripIn), body \(Int(stripBody)), shift \(Int(stripShift)), page part \(stripPlace.map { "\(Int($0.top))-\(Int($0.bottom)) of \(Int($0.height))" } ?? "none"))" : ""), shown \(shown)"
    }

    // MARK: a reply in the background (Tim, 11-15: "a notification when a new mod is ready")
    // An app in the background runs only while it holds background time from iOS (about 30 seconds since iOS 13;
    // a swiped-away app runs nothing), and TRIF has no server to notice a reply for it. So: going to the background
    // while a reply is being written, the app asks for that time, the chat keeps watching the reply, and when it's
    // done a local notification says so. If the time runs out first, it's given back (iOS ends an app that keeps
    // it) with a quiet notification, and the reply is read when the app comes back.

    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private var backgroundSince: Date?
    static let replyNote = "trif.reply"
    static let stillNote = "trif.reply.still"
    private var working: [ChatView] { views.filter { $0.activity == .working } }

    /// Notifications asked for once, at the first send (not at launch). Refused: nothing else changes. `.badge` too
    /// (11-18): iOS asks only once, so the icon's unread badge (UnreadCounts) can't be asked for after this.
    private func askToNotify() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
                Task { @MainActor in Diagnostics.shared.log("notify", "notifications \(ok ? "allowed" : "not allowed")") }
            }
        }
    }

    private func wentToBackground() {
        backgroundSince = Date()
        guard !working.isEmpty, bgTask == .invalid else { return }
        let start = Date()
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "TRIF: a reply being written") { [weak self] in
            // (iOS calls this on the main thread just before the time is up: the time is given back here, at once)
            MainActor.assumeIsolated {
                guard let self else { return }
                Diagnostics.shared.log("background", "iOS's background time ran out after \(Int(Date().timeIntervalSince(start))) s, \(self.working.count) reply(s) still being written")
                for v in self.working { self.notifyStillWriting(v) }
                self.endBackground()
            }
        }
        // (the time iOS gives is known only once the app is in the background)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard let self, self.bgTask != .invalid else { return }
            let left = UIApplication.shared.backgroundTimeRemaining
            Diagnostics.shared.log("background", "\(self.working.count) reply(s) being written: background time asked for, \(left > 100_000 ? "no limit given yet" : "\(Int(left)) s left")")
        }
    }

    /// iOS's background time given back once no chat is writing any more.
    private func endBackgroundIfIdle() { if working.isEmpty { endBackground() } }
    private func endBackground() {
        guard bgTask != .invalid else { return }
        let t = bgTask
        bgTask = .invalid
        if let since = backgroundSince, UIApplication.shared.applicationState != .active {
            Diagnostics.shared.log("background", "background time given back after \(Int(Date().timeIntervalSince(since))) s in the background")
        }
        UIApplication.shared.endBackgroundTask(t)
    }

    /// Back in front: the quiet "still writing" note goes, and a reply that ended while the app was stopped is read.
    private func cameBack() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [ClaudePane.stillNote])
        let away = backgroundSince.map { Date().timeIntervalSince($0) } ?? 0
        backgroundSince = nil
        endBackground()
        // (after a while away iOS will have stopped the chats' pages: a reply may have been cut off mid-stream, or
        // finished on the chat's side without the page hearing. If, a moment after coming back, nothing is being
        // written, the conversation is loaded again and the reply read from it (chat.js resume). A page iOS ended
        // is loaded again anyway: webViewWebContentProcessDidTerminate.)
        for v in working {
            Task { @MainActor [weak self, weak v] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self, let v, v.activity == .working, away > 20, v.conversation != nil else { return }
                let st = (Browser.parse(await self.chatJS(v, "state()")) as? [String: Any]) ?? [:]
                if st["replying"] as? Bool == true { return }
                Diagnostics.shared.log("background", "back after \(Int(away)) s; the reply isn't being written any more: its conversation loaded again to read it")
                v.webView.reload()
            }
        }
    }

    private func notify(_ title: String, _ body: String, id: String, kind: String, tab: UUID?, quiet: Bool = false) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.userInfo = ["kind": kind, "tab": tab?.uuidString ?? ""]
        if quiet { c.interruptionLevel = .passive } else { c.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    private func noteSite(_ v: ChatView) -> String { v.site.isEmpty ? (browser?.site ?? "") : v.site }

    private func notifyDone(_ v: ChatView, _ offered: [InstalledMod]) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [ClaudePane.stillNote])
        let s = noteSite(v)
        let place = s.isEmpty ? "" : " for \(s)"
        if offered.count == 1 {
            notify("Your mod is ready", "\(offered[0].name)\(place): tap to add it.", id: ClaudePane.replyNote, kind: "mod", tab: v.sentTab)
        } else if offered.count > 1 {
            notify("Your mods are ready", "\(offered.count) mods\(place): tap to add them.", id: ClaudePane.replyNote, kind: "mod", tab: v.sentTab)
        } else {
            notify("\(v.service.rawValue) replied", s.isEmpty ? "Tap to read the reply." : "On \(s): tap to read the reply.", id: ClaudePane.replyNote, kind: "replied", tab: v.sentTab)
        }
        Diagnostics.shared.log("notify", "the reply's notification: \(offered.count) mod(s)")
    }

    private func notifyStillWriting(_ v: ChatView) {
        let s = noteSite(v)
        notify("Still writing", "\(v.service.rawValue) is still writing\(s.isEmpty ? "" : " for \(s)"). Open TRIF to get your mod when it's done.", id: ClaudePane.stillNote, kind: "working", tab: v.sentTab, quiet: true)
    }

    /// A tap on one of these notifications: the tab it was sent from; then its mod's Add this mod? (already waiting
    /// for the app to be in front), or the chat at the reply.
    private func notificationTapped(_ info: [AnyHashable: Any]) {
        guard let browser else { return }
        if let id = (info["tab"] as? String).flatMap(UUID.init(uuidString:)), let tab = browser.tabs.first(where: { $0.id == id }), tab !== browser.current {
            browser.select(tab)
            follow(site: browser.site)
        }
        // (the mods its done banner held, if it has one: they come up here, on the tab)
        for v in views where !v.site.isEmpty && v.site == browser.site { arrived(v) }
        switch info["kind"] as? String {
        case "replied": open()
        case "mod":
            // (the app was ended meanwhile, so the mod isn't waiting any more: the chat, whose reply has its Add to TRIF)
            if browser.modOffer == nil && browser.offerQueue.isEmpty { open() }
        default: break
        }
    }

    /// Puts text (and a PNG) into the shown chat's message box as a paste, for the person to send (Web/chat.js fill).
    @discardableResult
    func fill(_ text: String, png: Data? = nil, pdf: Data? = nil, picture: String = "TRIF screenshot.png", as file: String? = nil) async -> String {
        await fill(cur, text, png: png, pdf: pdf, picture: picture, as: file)
    }
    @discardableResult
    private func fill(_ v: ChatView, _ text: String, png: Data? = nil, pdf: Data? = nil, picture: String = "TRIF screenshot.png", as file: String? = nil) async -> String {
        var said = "failed"
        do {
            let r = try await v.webView.callAsyncJavaScript("return await globalThis.__trifChat ? globalThis.__trifChat.fill(text, png, name || null, pdf || null, picture) : 'not loaded';",
                                                            arguments: ["text": text, "png": png?.base64EncodedString() ?? "", "pdf": pdf?.base64EncodedString() ?? "", "name": file ?? "", "picture": picture], in: nil, contentWorld: ClaudePane.chatWorld)
            said = r as? String ?? "failed (\(String(describing: r)))"
        } catch {
            said = "failed: \((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)"
        }
        // (filling focuses the message box; if the person has gone back to the tab, or another chat, no keyboard over it)
        if !(shown && cur === v) { blur(v) }
        report.log("claude", "\(v.service.rawValue): filled the message box (\(text.count) characters\(png == nil ? "" : ", a picture")\(pdf == nil ? "" : ", a \(pdf!.count / 1000) kB PDF")): \(said)")
        return said
    }

    /// (development) Writes the message box's surroundings to Documents/chat-dom.html (Web/chat.js dump).
    func dumpComposer() async {
        let r = try? await webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.dump() : 'not loaded';", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld)
        let html = r as? String ?? "nothing"
        if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? html.write(to: dir.appendingPathComponent("chat-dom.html"), atomically: true, encoding: .utf8)
        }
    }

    /// Switches to the other chat service (remembered): the shown tab's site's chat on it, loaded.
    func use(_ s: ChatService) {
        guard s != service else { return }
        service = s
        UserDefaults.standard.set(s.rawValue, forKey: "chatService")
        report.log("claude", "switched to \(s.rawValue)")
        showSwitched()
    }

    /// Where a chat went, without what the address carries after ? (sign-in steps put secrets there).
    private func note(_ what: String, _ url: URL?, _ v: ChatView? = nil) {
        guard let url = url else { return }
        report.log("claude", "\((v?.service ?? service).rawValue), \(what): \(url.scheme ?? "")://\(url.host ?? "")\(url.path)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if Browser.isModLink(url) {
            browser?.stopModLink(url, from: "Claude's pane")
            return .cancel
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if !["http", "https", "about", "blob", "data"].contains(scheme) {
            // (another app's link: as in a tab, to iOS when tapped, else Safari's question on the chat shown; TRIF's own
            // schemes, javascript: and file: never)
            if AppLinks.kind(url) == .other {
                browser?.appLink(url, action: navigationAction, from: webView, source: "a chat", shown: shown || strip || webView === popup)
            } else {
                report.log("claude", "\((view(of: webView)?.service ?? service).rawValue), not followed: \(AppLinks.logged(url))")
            }
            return .cancel
        }
        if ModDownloads.wanted(navigationAction) { return .download }
        if navigationAction.targetFrame?.isMainFrame ?? false { note("going to", url, view(of: webView)) }
        return .allow
    }

    // (a .js file the person taps in the chat, shown or downloaded: never shown in the chat, which it would strand
    // (11-16), but to Add this mod?: ModDownloads)
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if navigationResponse.isForMainFrame, (navigationResponse.response.suggestedFilename ?? "").lowercased().hasSuffix(".js")
            || (navigationResponse.response.url?.path.lowercased().hasSuffix(".js") ?? false) { return .download }
        return ModDownloads.wanted(navigationResponse) ? .download : .allow
    }
    // (a window the chat opened only to download a file, ChatGPT's signed address say: closed again once the file's on its way)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { ModDownloads.shared.take(download); if webView === popup { popup = nil } }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { ModDownloads.shared.take(download); if webView === popup { popup = nil } }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { view(of: webView)?.loading = true }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        browser?.appLinkNewLoad(webView)
        guard let v = view(of: webView) else { return }
        v.navigating = false
        v.projectPage = v.service.isProjectPage(webView.url) && webView.url?.absoluteString != v.service.project?.absoluteString
    }
    /// ⋯'s Keep TRIF chats in a project: the chat, at the service's projects (TRIF's instructions on the clipboard).
    func openProjects() {
        UIPasteboard.general.string = ClaudePane.projectInstructions
        showFor(tabSite)
        let v = cur!
        v.started = true
        shown = true
        if let u = URL(string: v.service.projectsPage) { go(v, u) }
        report.log("claude", "\(v.service.rawValue): to its projects, TRIF's instructions copied")
    }
    /// What goes in a project's instructions: how TRIF mods are written, and how to answer (agent-facing words).
    static var projectInstructions: String {
        """
        This project is for making TRIF mods: small changes to websites, made in the TRIF app. Each chat starts with a page I'm looking at in TRIF: its address, a screenshot, and an outline of the page in which each line starts with a CSS selector for a part of it.

        I'll say what I want changed. Reply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod; a free mod only if it really needs the page's own code. Always in a code block in the reply, however long, not as an attached file. Everything you need is in what I send: don't open the page in a browser or any other tool.

        --- How TRIF mods are written ---
        \(Browser.resource("mod-guide", "txt"))
        """
    }
    /// The project shown, used for TRIF's chats from now on.
    func useShownProject(hasGuide: Bool) {
        let v = cur!
        guard let u = v.webView.url, v.service.isProjectPage(u) else { return }
        var c = URLComponents(url: u, resolvingAgainstBaseURL: false)
        c?.query = nil; c?.fragment = nil
        v.service.useProject(c?.url, hasGuide: hasGuide)
        v.projectPage = false
        report.log("claude", "\(v.service.rawValue): TRIF's chats start in a project now\(hasGuide ? ", which has TRIF's instructions" : "")")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let v = view(of: webView)
        v?.loading = false
        note(v != nil ? "loaded" : "loaded in a window it opened", webView.url, v)
        guard let v else { return }
        v.tellLook()
        // (the chat's page loaded again while a reply was being written, its process ended say: watched again)
        if v.activity == .working {
            // (only the conversation the person sent from (or a new chat's, which had no address yet): another one
            // loaded meanwhile is history, nothing to watch; chat.js's resume itself takes only a reply still being written)
            if let w = v.workingConversation, v.conversation != w {
                v.activity = .idle
                Diagnostics.shared.log("chat offers", "\(v.service.rawValue): another conversation loaded while a reply was being written: not watched")
            } else { Task { _ = await chatJS(v, "resume()") } }
        }
        // (reloaded while the tab's data was going in: in again)
        if let p = v.refill {
            v.refill = nil
            queue(v) { [weak self] in await self?.fillContext(v, p) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        view(of: webView)?.loading = webView.isLoading
        if !Browser.stoppedNotFailed(error) { report.log("claude", "failed: \(error.localizedDescription)") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        view(of: webView)?.loading = webView.isLoading
        if !Browser.stoppedNotFailed(error) { report.log("claude", "failed to load: \(error.localizedDescription)") }
    }

    /// A window Claude's page opens (signing in with Google or Apple does): a second web view made from the
    /// configuration WebKit hands over, so the two pages can still talk, shown as a sheet.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, Browser.isModLink(url) {
            browser?.stopModLink(url, from: "Claude's pane (a link that opens a new window)")
            return nil
        }
        // (a window for another app's link: to iOS when tapped, no window)
        if let url = navigationAction.request.url, !["http", "https", "about", "blob", "data"].contains(url.scheme?.lowercased() ?? "") {
            if AppLinks.kind(url) == .other {
                browser?.appLink(url, tapped: TouchClock.tapped(linkOrForm: true), mainFrame: true, from: webView, source: "a chat's new window", shown: shown || strip)
            }
            return nil
        }
        note("opened a window for", navigationAction.request.url, view(of: webView))
        let child = WKWebView(frame: .zero, configuration: configuration)
        TouchClock.watch(child)
        child.navigationDelegate = self
        child.uiDelegate = self
        child.isInspectable = true
        popup = child
        return child
    }

    /// A chat's page process ended (memory): loaded again, and noted in the diagnostics log.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Diagnostics.shared.log("ended", "WebKit ended a chat page's process at \(Diagnostics.place(webView.url)) (\(views.count) chat pages); loading it again.")
        if webView.url != nil { webView.reload() }
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popup { popup = nil }
    }
}

/// The chat, full screen over the tab: a bar with the way back to the tab, the Claude / ChatGPT switch and Start
/// over, then the chat's page. It's always in the app's view tree (behind the tab while hidden), so its page keeps
/// running and a reply goes on being written and watched.
struct ChatScreen: View {
    @ObservedObject var pane: ClaudePane

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                // (back in the chat's own history: from a file, a link or a sign-in page to the conversation; the toolbar's
                // page button goes back to the tab. 11-16)
                if !pane.more {
                Button { pane.back() } label: { Image(systemName: "chevron.left").font(.body.weight(.semibold)) }
                    .disabled(!pane.canGoBack)
                    .opacity(pane.canGoBack ? 1 : 0)
                    .accessibilityLabel("Back")
                    .accessibilityHidden(!pane.canGoBack)
                }
                // (the chats in progress, up to three (Tim, 11-16): each one's site and a short title, the one writing a
                // reply marked; one is shown, the others keep running behind it)
                if !pane.more, pane.openViews.count > 1 {
                    Menu {
                        ForEach(pane.openViews) { v in
                            Button { pane.show(v) } label: {
                                Label(v.label, systemImage: v.activity == .working ? "ellipsis.bubble" : v.activity == .replied ? "bubble.left.fill" : v === pane.cur ? "checkmark" : "bubble.left")
                                if v.activity == .working { Text("Writing a reply") } else if v.activity == .replied { Text("Replied") }
                            }
                        }
                    } label: {
                        Image(systemName: "square.stack").overlay(alignment: .topTrailing) {
                            if pane.openViews.contains(where: { $0.activity == .working && $0 !== pane.cur }) { Circle().fill(Color.trifGreen).frame(width: 7, height: 7).offset(x: 3, y: -2) }
                        }
                    }
                    .accessibilityLabel("Chats, \(pane.openViews.count) open")
                }
                Spacer(minLength: 4)
                // (Claude · ChatGPT · More: the third, the side panel's own chat, on an API key or this iPhone)
                Picker("Chat", selection: Binding(get: { pane.more ? "more" : pane.service.rawValue }, set: { v in
                    if v == "more" { pane.choose(more: true) } else { pane.choose(more: false, service: ChatService(rawValue: v)) }
                })) {
                    ForEach(ChatService.allCases) { Text($0.rawValue).tag($0.rawValue) }
                    Text("More").tag("more")
                }
                .pickerStyle(.segmented)
                .fixedSize()
                // (the chat's reload, beside new chat; stop while it loads. Not a pull: a conversation is long, its top far
                // away. 11-16)
                // (More: the panel's own bar has New chat and Settings; the switch alone up here, centred)
                if pane.more {
                    Spacer(minLength: 4)
                } else {
                if pane.loading {
                    Button { pane.webView.stopLoading(); pane.loading = false } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Stop loading")
                } else {
                    Button { pane.reloadChat() } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("Reload the chat")
                }
                Button { pane.home() } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("Start over")
                }
            }
            .overlay(alignment: .bottom) {
                // (a project's page, not yet TRIF's: use it for TRIF's chats)
                if pane.projectPage { ProjectOffer(pane: pane).offset(y: 44) }
            }
            .zIndex(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            // (the quick ask's strip shows only the chat's foot: its top bar, clipped away, takes no touches (its
            // switch, a UIKit control, still took them over the tab's address bar: the hit step, 11-18))
            .allowsHitTesting(!pane.strip)
            // (the way back to the tab the chat is for, Tim 11-18: "← facebook.com"; its tab, or a new one at its page
            // if that tab has closed)
            if !pane.more, !pane.site.isEmpty {
                Button { pane.goToSite(pane.curKey) } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.left").font(.caption.weight(.semibold))
                        Text(pane.site).font(.footnote.weight(.medium)).lineLimit(1).truncationMode(.middle)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
                .padding(.top, -2)
                .accessibilityLabel("Go to \(pane.site)")
                .allowsHitTesting(!pane.strip)
            }
            Divider()
            if pane.more {
                WebViewHost(webView: pane.panel.webView)
            } else {
            // (every chat page stays in the view tree, so a reply goes on being written and watched; the shown one on top)
            ZStack {
                ForEach(pane.views) { v in
                    WebViewHost(webView: v.webView)
                        .opacity(v === pane.cur ? 1 : 0)
                        .allowsHitTesting(v === pane.cur)
                        .accessibilityHidden(v !== pane.cur)
                        .zIndex(v === pane.cur ? 1 : 0)
                }
            }
                .overlay(alignment: .top) {
                    if pane.adding {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.mini)
                            Text("Adding the page…").font(.footnote)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Capsule().fill(.regularMaterial))
                        .padding(.top, 8)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                    }
                }
            }
        }
        .background(Color(.systemBackground))
        .sheet(isPresented: Binding(get: { pane.popup != nil }, set: { if !$0 { pane.popup = nil } })) {
            if let popup = pane.popup {
                VStack(spacing: 0) {
                    HStack {
                        Text("A window \(pane.service.rawValue) opened").font(.subheadline).bold()
                        Spacer()
                        Button("Close") { pane.popup = nil }
                    }
                    .padding(12)
                    WebViewHost(webView: popup)
                }
            }
        }
    }
}

/// The toolbar's chat button's picture: the robot (Tim, 11-15); its eyes three moving dots while a reply is being
/// written; a small green mark when a reply with no mod in it waits to be read.
struct ChatGlyph: View {
    let activity: ChatActivity
    var body: some View {
        RobotGlyph(working: activity == .working)
            .overlay(alignment: .topTrailing) {
                if activity == .replied {
                    GeometryReader { g in
                        Circle().fill(Color.trifGreen).frame(width: g.size.width * 0.34, height: g.size.width * 0.34)
                            .offset(x: g.size.width * 0.72, y: -g.size.width * 0.12)
                    }
                }
            }
    }
}

/// "Use this project for TRIF chats" over a project's page in the chat; then whether it has TRIF's instructions (so
/// a new chat there gets the page without them).
struct ProjectOffer: View {
    @ObservedObject var pane: ClaudePane
    @State private var asking = false
    var body: some View {
        Button { asking = true } label: {
            Label("Use this project for TRIF chats", systemImage: "folder")
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(.regularMaterial, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
        }
        .zIndex(2)
        .confirmationDialog("Use this project for TRIF chats?", isPresented: $asking, titleVisibility: .visible) {
            Button("Use it: TRIF's instructions are in it") { pane.useShownProject(hasGuide: true) }
            Button("Use it: they aren't in it") { pane.useShownProject(hasGuide: false) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("New TRIF chats start in this project. If you pasted TRIF's instructions into it, each chat gets just the page.")
        }
    }
}

/// The done banner (Tim, 11-18): slides down over whatever is shown when a chat the person isn't looking at finishes
/// a reply. With mods: "Claude made a mod for {site}" · Add · Go to {site}; without: "Claude replied about {site}" ·
/// Open chat. As the app's other banner (SafetyBanner): footnote words, the main button bold. ✕ or a swipe up
/// closes it (its mods dismissed, as a sheet swiped away). A tap anywhere else on it opens the chat (Tim, 11-18: "tapping
/// anywhere on the notification should bring me to the Claude screen"), as Open chat; a mod banner stays up over the
/// chat, still holding its mods for its Add or Go to (one offer, never lost).
struct ChatBannerView: View {
    let banner: ChatBanner
    /// Go to {site} is left out when that site's tab is already the one shown, uncovered.
    let showGo: Bool
    let add: () -> Void
    let go: () -> Void
    let openChat: () -> Void
    let dismiss: () -> Void

    private var text: String {
        let s = banner.site.isEmpty ? "" : " for \(banner.site)"
        if banner.mods.count == 1 { return "\(banner.service) made a mod\(s)" }
        if banner.mods.count > 1 { return "\(banner.service) made \(banner.mods.count) mods\(s)" }
        // (draft, 11-18: mods TRIF didn't see being written, to add from the chat)
        if banner.inChat == 1 { return "\(banner.service) replied with a mod\(s)" }
        if banner.inChat > 1 { return "\(banner.service) replied with \(banner.inChat) mods\(s)" }
        return banner.site.isEmpty ? "\(banner.service) replied" : "\(banner.service) replied about \(banner.site)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ChatGlyph(activity: .idle).frame(width: 20, height: 20).foregroundStyle(Color.trifGreen).padding(.top, 1)
            VStack(alignment: .leading, spacing: 6) {
                Text(text).font(.footnote.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    // (VoiceOver: the words are the banner's tap, to the chat)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint("Opens the chat")
                    .accessibilityAction { openChat() }
                HStack(spacing: 16) {
                    if banner.mods.isEmpty { Button("Open chat", action: openChat).font(.footnote.bold()) }
                    else { Button("Add", action: add).font(.footnote.bold()) }
                    if showGo && !banner.site.isEmpty { Button("Go to \(banner.site)", action: go).font(.footnote).lineLimit(1) }
                }
            }
            Spacer(minLength: 0)
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.secondary).frame(width: 28, height: 28) }
                .accessibilityLabel("Close")
        }
        .padding(.leading, 12).padding(.vertical, 10).padding(.trailing, 4)
        // (the whole banner a tap target, its buttons keeping their own: a child's tap wins over this one)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture { openChat() }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemBackground)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color(.separator), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        .padding(.horizontal, 10)
        .gesture(DragGesture(minimumDistance: 12).onEnded { g in if g.translation.height < -20 { dismiss() } })
        .accessibilityElement(children: .contain)
    }
}

/// The toolbar robot's long press (Tim, 11-18): at its top the quick ask's box (QuickAsk.swift), "What should
/// change?" with the microphone; then the chats sent from, newest first, each with its site, its tab's title and its
/// state. A row opens its chat; its arrow goes to its site's tab.
struct ChatListView: View {
    @ObservedObject var pane: ClaudePane
    /// the shown tab's site (Go to chat's chat)
    let site: String
    let ask: (String) -> Void
    /// the full chat for the shown tab, as the robot's tap was until 11-18: the page's details filled in
    let goToChat: () -> Void
    let open: (String) -> Void
    let go: (String) -> Void
    let close: () -> Void

    /// (this tab's site's chat, if it has one: its state on Go to chat)
    private var mine: ChatLink? { site.isEmpty ? nil : pane.links.first { $0.site == site } }
    private var goWords: (title: String, line: String) {
        // (what it'll use, Tim 11-18: "Claude Sonnet 5.5 · OpenRouter · x.com"; nothing set up: what's missing, red)
        let label = pane.engineLabel
        if label.fix != nil { return ("Go to chat", label.text) }
        let place = site.isEmpty ? label.text : "\(label.text) · \(site)"
        switch mine?.state {
        case .waiting?: return ("Go to chat", "Reply waiting · \(place)")
        case .working?: return ("Go to chat", "Working… · \(place)")
        default: return ("Go to chat", place)
        }
    }

    private func state(_ l: ChatLink) -> String {
        switch l.state {
        case .working: return "Working…"
        case .waiting: return "Reply waiting"
        case .added: return "Mod added"
        case .read: return "Read"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    QuickAskBox(ask: ask).listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 12))
                    // (Tim, 11-18: the robot's tap opens this list now; the full chat is one tap further, here, first)
                    Button { if let fix = pane.engineLabel.fix { close(); pane.openFix(fix) } else { goToChat() } } label: {
                        HStack(spacing: 12) {
                            ChatGlyph(activity: mine?.activity ?? .idle).frame(width: 22, height: 22).foregroundStyle(Color.trifGreen)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(goWords.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.trifGreen)
                                Text(goWords.line).font(.caption).lineLimit(2)
                                    .foregroundStyle(pane.engineLabel.fix != nil ? Color.red : mine?.state == .waiting ? Color.trifGreen : .secondary)
                                    .fontWeight(mine?.state == .waiting ? .semibold : .regular)
                            }
                            Spacer(minLength: 0)
                            if mine?.state == .waiting { Circle().fill(Color.trifGreen).frame(width: 9, height: 9) }
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(mine?.state == .waiting ? "Go to chat, reply waiting" : "Go to chat")
                    .accessibilityValue(goWords.line)
                    .accessibilityHint(pane.engineLabel.fix != nil ? "Opens what needs setting up" : "Opens the whole chat for this page")
                }
                Section {
                if pane.links.isEmpty {
                    Text("No chats yet.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(pane.links) { l in
                    HStack(spacing: 12) {
                        Button { open(l.id) } label: {
                            HStack(spacing: 12) {
                                ChatGlyph(activity: l.activity).frame(width: 22, height: 22).foregroundStyle(Color.trifGreen)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(l.site).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    if !l.tabTitle.isEmpty { Text(l.tabTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                    Text("\(l.service) · \(state(l))").font(.caption2).foregroundStyle(l.state == .waiting ? Color.trifGreen : .secondary)
                                        .fontWeight(l.state == .waiting ? .semibold : .regular)
                                }
                                Spacer(minLength: 0)
                                // (a reply waiting: a green dot, easy to see down the list)
                                if l.state == .waiting { Circle().fill(Color.trifGreen).frame(width: 9, height: 9).accessibilityHidden(true) }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(l.site), \(l.tabTitle), \(state(l))")
                        .accessibilityHint("Opens the chat")
                        Button { go(l.id) } label: { Image(systemName: "arrow.up.forward.square").font(.title3) }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Go to \(l.site)")
                    }
                }
                }
            }
            .navigationTitle("Chats")
            .navigationBarTitleDisplayMode(.inline)
            // (Tim, 11-18: "Done" read as cancelling the request. Send = the box's arrow; Cancel closes, the words kept
            // in the box as a draft, as a tap on the dimmed page or a swipe down does)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: close).accessibilityHint("Closes without sending. Your words stay in the box")
                }
                ToolbarItem(placement: .confirmationAction) { QuickSendButton(ask: ask) }
            }
        }
        // (More's engine and model looked at again: a key or a model changed since)
        .onAppear { pane.refreshEngineLabel() }
        // (the list closed mid-listen (a tap on the microphone): stopped, nothing asked, the words kept in the box)
        .onDisappear { SpeechInput.shared.interrupt(why: "the list closed") }
    }
}
