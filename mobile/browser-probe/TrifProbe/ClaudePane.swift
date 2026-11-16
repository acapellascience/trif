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

/// Which chat the pane shows: Claude, or ChatGPT (Codex on the web works on code repositories, not on a page
/// someone is looking at, so ChatGPT is its side's chat). Each keeps its own sign-in (the app's one cookie store).
enum ChatService: String, CaseIterable, Identifiable {
    case claude = "Claude", chatgpt = "ChatGPT"
    var id: String { rawValue }
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
        p.onActivity = { [weak self] a in self?.activity = a }
        p.isShown = { [weak self] in self?.shown ?? false }
        return p
    }()
    /// Claude, ChatGPT or More.
    func choose(more m: Bool, service s: ChatService? = nil) {
        if m != more {
            more = m
            UserDefaults.standard.set(m, forKey: "chatMore")
            report.log("claude", m ? "switched to More (the side panel's chat)" : "switched back to \(s?.rawValue ?? service.rawValue)")
            if m { panel.start() } else if shown, !started { start() }
        }
        if let s, !m { use(s) }
    }
    /// The shown tab changed: the side panel follows it, as on desktop.
    func tabChanged() { if more { panel.pushTab() } }

    @Published var popup: WKWebView?
    @Published var loading = false
    /// The chat's own history (its page's back and forward): the chat's ‹ and the toolbar's arrows while it shows.
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    func back() { if canGoBack { webView.goBack() } }

    /// Reload, the chat's own (Tim, 11-16: "if anything goes wrong there, you're stuck"): the same address, never a
    /// new chat. A reply being written is watched again once it has loaded (didFinish: chat.js resume); the tab's data
    /// being put in its box is put in again, once.
    func reloadChat() {
        report.log("claude", "\(service.rawValue): reloaded")
        fillGeneration += 1
        if adding, let p = lastPrepared { refill = p }
        loading = true
        navigating = true
        webView.reload()
    }
    /// Which fill is current: a reload makes the one under way stop, and starts it again after.
    private var fillGeneration = 0
    private var lastPrepared: Prepared?
    private var refill: Prepared?
    func forward() { if webView.canGoForward { webView.goForward() } }
    /// The chat is showing, full screen over the tab.
    @Published private(set) var shown = false
    @Published private(set) var activity: ChatActivity = .idle
    private var workingSince = Date.distantPast

    let webView: WKWebView
    private let report: Report
    private weak var browser: Browser?
    private var started = false

    init(report: Report, browser: Browser) {
        self.report = report
        self.browser = browser
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = Browser.safariSuffix
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        // (Add to TRIF under each mod in a reply, and filling the message box: Web/chat.js, main frame only)
        config.userContentController.addUserScript(WKUserScript(source: Browser.resource("chat", "js"), injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: ClaudePane.chatWorld))
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(self, contentWorld: ClaudePane.chatWorld, name: "trif")
        webView.navigationDelegate = self
        // (the chat page stays put in its frame: claude.ai and chatgpt.com scroll their conversation inside
        // themselves, so the web view's own scrolling only ever hid the top of the chat, after the keyboard
        // or a send moved it: Tim, 11-14)
        // (development) `xcrun simctl spawn <device> notifyutil -p com.trif.probe.dumpchat`: the chat's layout and
        // scroll positions to Documents/chat-dom.html, without a relaunch (dumpComposer)
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
            guard let observer else { return }
            let pane = Unmanaged<ClaudePane>.fromOpaque(observer).takeUnretainedValue()
            Task { @MainActor in await pane.dumpComposer() }
        }, "com.trif.probe.dumpchat" as CFString, nil, .deliverImmediately)
        // (but a page taller than the pane, as a sign-in page is (Google's "Sign in to continue"), scrolls as any page
        // does: the web view's scrolling is on exactly while its page is taller or wider than the pane. Tim, 11-15:
        // with it always off, signing in on a small iPhone was nearly impossible)
        let sv = webView.scrollView
        sv.isScrollEnabled = false
        sv.bounces = false
        sv.contentInsetAdjustmentBehavior = .never
        // (the keyboard gone, however it went (Tim, 11-16: the chat's page stayed pushed up, its message box mid-screen
        // over an empty half, after the keyboard closed): the chat's page back in its frame, now and once it has
        // settled; doing it again changes nothing)
        for name in [UIResponder.keyboardWillHideNotification, UIResponder.keyboardDidHideNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.settleLayout() }
            }
        }
        scrollWatches = [
            sv.observe(\.contentSize, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.fitScrolling() } },
            sv.observe(\.bounds, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.fitScrolling() } },
        ]
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
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
        // (the conversation the pane is on, kept, so the app reopens it: Tim, 11-14)
        urlWatch = webView.observe(\.url, options: [.new]) { [weak self] wv, _ in
            let url = wv.url
            Task { @MainActor in self?.remember(url) }
        }
        historyWatches = [
            webView.observe(\.canGoBack, options: [.new]) { [weak self] wv, _ in let v = wv.canGoBack; Task { @MainActor in self?.canGoBack = v } },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] wv, _ in let v = wv.canGoForward; Task { @MainActor in self?.canGoForward = v } },
        ]
    }

    private var urlWatch: NSKeyValueObservation?
    private var historyWatches: [NSKeyValueObservation] = []
    private var scrollWatches: [NSKeyValueObservation] = []

    /// Whether a page is bigger than the web view showing it (then it scrolls as a document does).
    nonisolated static func scrolls(_ sv: UIScrollView) -> Bool {
        sv.contentSize.height > sv.bounds.height + 2 || sv.contentSize.width > sv.bounds.width + 2
    }

    /// Scrolling on for a page taller (or wider) than the pane; off, and back at the top, for one that fits (the
    /// chats, which scroll inside themselves).
    /// (decided a moment after the page's size stops changing, and with a margin each way, so a page whose height
    /// follows the pane's, as the chats' do while the keyboard comes and goes, can't flip it back and forth on every
    /// layout: 11-15, an update loop on Tim's phone was looked for here too)
    private var fitTask: Task<Void, Never>?
    private func fitScrolling() {
        fitTask?.cancel()
        fitTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled, let self else { return }
            let sv = self.webView.scrollView
            let over = max(sv.contentSize.height - sv.bounds.height, sv.contentSize.width - sv.bounds.width)
            let on = sv.isScrollEnabled ? over > 1 : over > 24
            if sv.isScrollEnabled != on {
                sv.isScrollEnabled = on
                sv.bounces = on
            }
            self.clampOffset()
        }
    }

    /// The page's offset inside its frame, kept within what it can be: none when it fits (the chats scroll inside
    /// themselves), and never past its end (WebKit can leave the page pushed up once the keyboard has gone).
    private func clampOffset() {
        let sv = webView.scrollView
        guard !sv.isTracking, !sv.isDecelerating else { return }
        let maxY = max(0, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
        let maxX = max(0, sv.contentSize.width - sv.bounds.width)
        let fit = CGPoint(x: min(max(sv.contentOffset.x, 0), maxX), y: sv.isScrollEnabled ? min(max(sv.contentOffset.y, -sv.adjustedContentInset.top), maxY) : 0)
        if fit != sv.contentOffset { sv.setContentOffset(fit, animated: false) }
    }

    /// After the keyboard goes (or the chat comes back): the page's layout as it should be, now and a moment later.
    func settleLayout() {
        webView.setNeedsLayout()
        clampOffset()
        fitScrolling()
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            self?.clampOffset()
            // (the page told its window's size again: a chat that measured itself with the keyboard up lays out again)
            _ = try? await self?.webView.evaluateJavaScript("window.dispatchEvent(new Event('resize')); 1", in: nil, in: ClaudePane.chatWorld)
        }
    }
    /// The site the chat's conversation is for: the shown tab's (follow). Each site keeps its own conversation,
    /// so switching tabs, or going to another site, brings that site's chat back (Tim, 11-15: the chat follows the tab).
    @Published private(set) var site = ""
    /// The shown tab's site; the chat goes to its conversation the next time it opens (not while a reply is being
    /// written, or waits to be read: that conversation stays until then).
    private var tabSite = ""
    private func lastKey(_ s: ChatService, _ site: String) -> String { site.isEmpty ? "lastChat.\(s.rawValue)" : "lastChat.\(s.rawValue).\(site)" }
    /// A conversation's address (claude.ai/chat/…, chatgpt.com/c/…), kept for its chat and site; nothing else is.
    private func remember(_ url: URL?) {
        guard let url, let home = URL(string: service.home), url.host == home.host,
              url.path.hasPrefix("/chat/") || url.path.hasPrefix("/c/") else { return }
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        c?.query = nil
        c?.fragment = nil
        if let s = c?.url?.absoluteString {
            UserDefaults.standard.set(s, forKey: lastKey(service, site))
            if contextNext { contextNext = false; noteContext(s) }
        }
    }

    // MARK: which conversations have TRIF's instructions

    /// The conversation shown, as kept (no query or fragment), or nil for a new chat that has no address of its own yet.
    private var conversation: String? {
        guard let url = webView.url, url.path.hasPrefix("/chat/") || url.path.hasPrefix("/c/") else { return nil }
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        c?.query = nil
        c?.fragment = nil
        return c?.url?.absoluteString
    }
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
    /// The instructions went in a new chat's first message: its address, once it has one, is noted.
    private var contextNext = false
    /// Where the pane opens: the site's conversation, else a new one.
    private var resumeURL: URL? {
        UserDefaults.standard.string(forKey: lastKey(service, site)).flatMap(URL.init(string:)) ?? URL(string: service.start)
    }

    /// Loads an address in the chat, marked as loading at once (a fill waits for it: waitForPage).
    private func go(_ url: URL) {
        loading = true
        navigating = true
        requested = url
        webView.load(URLRequest(url: url))
    }
    /// The address last asked for: the conversation the chat is about to show, before it has loaded.
    private var requested: URL?
    /// A load asked for hasn't put its page in yet (until it commits): the page there is the one before.
    private var navigating = false

    /// Loads the chat the first time it's opened (not before: the browser is useful without it).
    func start() {
        guard !started else { return }
        site = tabSite
        guard let url = resumeURL else { return }
        started = true
        go(url)
    }

    /// The shown tab's site changed (another tab, or another site in it): the chat goes to that site's
    /// conversation (a new one if it has none) when it next opens. Nothing loads in the background meanwhile.
    func follow(site new: String) { tabSite = new }

    /// To the shown tab's site's conversation, if the chat is on another's and nothing is going on in it.
    /// The chat's page is one of its own: a conversation or a new chat (not a file, a link or a sign-in page it went to).
    var onChatPage: Bool {
        guard let u = webView.url, let home = URL(string: service.home), u.host == home.host else { return false }
        let p = u.path
        return p.hasPrefix("/chat/") || p.hasPrefix("/c/") || p == home.path || p == "/" || p == "/new" || service.isProjectPage(u)
    }

    private func catchUp() {
        // (the chat follows the tab's site only from one of its own pages: one that went to a file, a link or a sign-in
        // stays there, for its ‹ to bring back; 11-16)
        guard started, site != tabSite, activity == .idle, onChatPage || webView.url == nil else { return }
        site = tabSite
        guard let url = resumeURL else { return }
        if webView.url?.absoluteString.hasPrefix(url.absoluteString) == true { return }
        report.log("claude", "\(service.rawValue): the chat for \(site.isEmpty ? "no site" : site)")
        go(url)
    }

    /// The chat button: the chat, full screen. In a chat that isn't writing a reply, the tab's data goes into the
    /// message box (fillContext); at a reply waiting to be read, it opens there. `then`: one more thing to put in
    /// the message box after (Point TRIF at this).
    func open(then extra: (() async -> Void)? = nil) {
        Diagnostics.shared.mark("opening the chat")
        // (More: the side panel's chat, which has its own context and fills nothing)
        if more {
            if activity == .replied { activity = .idle }
            shown = true
            panel.start()
            report.log("claude", "More: opened")
            return
        }
        let was = activity
        let already = shown
        if was == .replied { activity = .idle }
        if was == .idle { catchUp() }
        start()
        shown = true
        report.log("claude", "\(service.rawValue): opened\(was == .idle ? "" : " (\(was.rawValue))")")
        // (the tab's data starts being gathered now, while the chat's page gets ready: 11-15)
        Diagnostics.shared.mark("opening the chat: gathering the page")
        let ready = was == .idle && !already ? prepare() : nil
        Diagnostics.shared.mark("opening the chat: the chat's page")
        queue { [weak self] in
            guard let self else { return }
            if was == .replied { _ = await self.chatJS("showReply()") }
            else if let ready { await self.fillContext(ready) }
            if let extra { await extra() } // (chat.js fill waits for the message box itself)
        }
    }

    /// Back to the tab (the chat keeps running behind it: a reply goes on being written).
    func close() {
        guard shown else { return }
        shown = false
        blur()
    }

    /// The keyboard away from the chat's message box (so it doesn't come up over the tab).
    private func blur() {
        webView.endEditing(true)
        Task { _ = try? await webView.callAsyncJavaScript("document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) }
    }

    /// Start over: a new conversation for this site (and the one kept forgotten), with the full instructions.
    func home() {
        UserDefaults.standard.removeObject(forKey: lastKey(service, site))
        activity = .idle
        guard let url = URL(string: service.start) else { return }
        go(url)
        guard let ready = prepare() else { return }
        queue { [weak self] in await self?.fillContext(ready) }
    }

    /// The things put into the message box, one after another (a fill waits for the one before).
    private var chain: Task<Void, Never>?
    private func queue(_ op: @escaping @MainActor () async -> Void) {
        let before = chain
        chain = Task { @MainActor in
            await before?.value
            await op()
        }
    }


    private func chatJS(_ call: String) async -> String? {
        try? await webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.\(call) : null;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) as? String
    }

    /// The conversation an address is (kept without query or fragment), or nil for a new chat.
    private static func conversation(of url: URL?) -> String? {
        guard let url, url.path.hasPrefix("/chat/") || url.path.hasPrefix("/c/") else { return nil }
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
    private func prepare() -> Prepared? {
        guard let browser else { return nil }
        let conv = ClaudePane.conversation(of: loading ? requested : webView.url)
        let followUp = conv.map(hasContext) ?? false
        let sw = Stopwatch("\(followUp ? "the follow-up" : "the instructions") for \(browser.host.isEmpty ? "a new tab" : browser.host)")
        let shot = Task { @MainActor in await browser.quickScreenshot() }
        // (a new chat in TRIF's project, which has TRIF's instructions: the page only; once sent, the chat counts as
        // having them, as the project does)
        let inProject = !followUp && conv == nil && service.projectHasGuide
        if inProject { projectFill = true }
        let text = Task { @MainActor in followUp ? await browser.feedbackForChat(conv: conv, sw) : await browser.pageForChat(conv: conv, sw, guideInProject: inProject) }
        return Prepared(followUp: followUp, conv: conv, text: text, shot: shot, watch: sw)
    }

    /// The last fill not yet sent, for this chat service: its conversation ("new" for a new chat), and the tab and page
    /// it was of. Cleared at a send. Kept between launches (a reload of the chat's page must not fill again).
    struct FillRecord: Codable { var conv: String; var page: String; var at: Date }
    private var lastFill: FillRecord? {
        get { UserDefaults.standard.data(forKey: "lastFill.\(service.rawValue)").flatMap { try? JSONDecoder().decode(FillRecord.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "lastFill.\(service.rawValue)") }
    }
    /// The tab and its page (its address without the fragment): another tab or another page is a new fill.
    static func pageKey(_ b: Browser) -> String {
        var c = b.webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
        c?.fragment = nil
        return "\(b.current.id.uuidString) \(c?.url?.absoluteString ?? "")"
    }

    /// "Adding the page…" over the chat while the tab's data goes into its box.
    @Published private(set) var adding = false

    /// The tab's data into the message box (Tim, 11-15: "full instructions if it's a new chat, the feedback data
    /// if it's not"): in a conversation without TRIF's instructions, how mods are written and the page
    /// (Browser.pageForChat, as TRIF instruction.txt); in one that has them, the page as it is now, what changed,
    /// the mods on it (the code only of those the chat hasn't seen) and their errors (Browser.feedbackForChat, as
    /// TRIF follow-up.txt). The text goes in first, the screenshot when it's ready (11-15: it all took 10 to 15 s on
    /// Instagram). Nothing when the message box isn't there (signed out) or already has something in it. The
    /// person sends it themselves.
    private func fillContext(_ ready: Prepared) async {
        let sw = ready.watch
        let generation = fillGeneration
        lastPrepared = ready
        adding = true
        defer { if generation == fillGeneration { adding = false } }
        // (only into one of the chat's own pages with its message box there: not waiting for the page to finish
        // loading (claude.ai takes seconds more after its box is usable: 11-16, a new chat took 5 s to fill), but
        // looking for the box every 150 ms, 20 s at most (the person may go back to the conversation from a file
        // meanwhile); the chat is never moved for it. 11-16: a fill started on a file the chat had opened)
        // (and only with the conversation itself in front: the message box shown and usable, nothing over it. While a
        // viewer is open (a file, an artifact: 11-16, Tim tapped a .js and Claude's viewer covered the box), the wait
        // goes on, however long, for as long as the chat is shown: closing the viewer lets the fill go in)
        var st: [String: Any] = [:]
        var waited = 0
        var saidViewer = false
        while waited < 133 {
            if !navigating, onChatPage {
                st = (Browser.parse(await chatJS("state()")) as? [String: Any]) ?? [:]
                if st["usable"] as? Bool == true { break }
            }
            let over = st["viewer"] as? String
            if let over, !saidViewer {
                saidViewer = true
                report.log("claude", "\(service.rawValue): \(over) is over the message box: the fill waits for it to close")
            }
            try? await Task.sleep(nanoseconds: 150_000_000)
            if over == nil || !shown { waited += 1 }
            if !shown && activity != .idle { break }
            if generation != fillGeneration { break }
        }
        sw.lap("the chat ready")
        guard generation == fillGeneration else { return } // (the chat reloaded meanwhile: filled after it, instead)
        guard onChatPage, st["editor"] as? Bool == true, st["usable"] as? Bool == true else {
            if let over = st["viewer"] as? String {
                report.log("claude", "\(service.rawValue): \(over) stayed over the message box, nothing filled")
                Diagnostics.shared.log("chat", "the page's data wasn't put in: \(over) was over the chat's message box")
                return
            }
            report.log("claude", "\(service.rawValue): no message box (\(onChatPage ? "signed out?" : "not on a conversation")), nothing filled")
            Diagnostics.shared.log("chat", "the page's data wasn't put in: the chat \(onChatPage ? "had no message box" : "wasn't on a conversation") for 20 s")
            return
        }
        if st["working"] as? Bool == true { return }
        guard let browser, shown || activity == .idle else { return }
        // (once per page: 11-16, leaving the chat and coming back put the page in a second time. What's in the box
        // is looked at (TRIF's tiles or text, or the person's own) and so is the record of the last fill, which
        // outlives a reload of the chat's page)
        let convKey = conversation ?? "new"
        let page = ClaudePane.pageKey(browser)
        let record = lastFill
        let same = record.map { $0.conv == convKey && $0.page == page } ?? false
        var ours = st["trif"] as? Int ?? 0
        if ours == 0, st["has"] as? Bool != true, same {
            // (the record says it's in, unsent, but the box looks empty: a page that puts its draft back a moment
            // after it loads is given that moment)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            st = (Browser.parse(await chatJS("state()")) as? [String: Any]) ?? st
            ours = st["trif"] as? Int ?? 0
        }
        if ours > 0 {
            if same { report.log("claude", "\(service.rawValue): the page is already in the message box, unsent: not again"); return }
            if st["others"] as? Bool == true { report.log("claude", "\(service.rawValue): the message box has the person's own things too: left as it is"); return }
            let r = try? await webView.callAsyncJavaScript("return globalThis.__trifChat ? await globalThis.__trifChat.clearTrif() : 1;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld)
            let left = (r as? NSNumber)?.intValue ?? 1
            report.log("claude", "\(service.rawValue): the tab changed since the last fill: the old one taken out\(left > 0 ? " (not all of it: \(left) left, so nothing added)" : "")")
            if left > 0 { return }
        } else if st["has"] as? Bool == true {
            report.log("claude", "\(service.rawValue): the message box already has something in it: left as it is"); return
        }
        let conv = conversation
        if st["context"] as? Bool == true, let conv { noteContext(conv) }
        // (the conversation turned out to have the instructions after all, seen on its page: the follow-up instead)
        let followUp = conv.map(hasContext) ?? false
        var text = await ready.text.value
        if followUp && !ready.followUp { text = await browser.feedbackForChat(conv: conv, sw) }
        if let text {
            await fill(text, as: followUp ? "TRIF follow-up.txt" : "TRIF instruction.txt")
            sw.lap("text into the message box")
        }
        if let shot = await ready.shot.value {
            await fill("", png: shot, picture: "TRIF screenshot.jpg")
            sw.lap("screenshot into the message box", "\(shot.count / 1000) kB JPEG")
        }
        lastFill = FillRecord(conv: convKey, page: page, at: Date())
        await browser.noteBaseline()
        sw.lap("the page's layout, for next time")
        sw.done()
    }

    /// From Web/chat.js: an Add to TRIF tap; the person's send; a reply done, with the mod files in it.
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], let type = d["type"] as? String else { return }
        switch type {
        case "mod":
            guard let text = d["text"] as? String else { return }
            report.log("claude", "\(service.rawValue): Add to TRIF tapped (\(text.count) characters)")
            browser?.offer(text: text)
        case "sent":
            // (back to the tab at once: the reply is watched from here, the dots on the chat button)
            report.log("claude", "\(service.rawValue): sent (\(d["how"] as? String ?? "?"))\(d["withInstructions"] as? Bool == true ? ", with TRIF's instructions" : "")")
            if d["withInstructions"] as? Bool == true || projectFill { if let conv = conversation { noteContext(conv) } else { contextNext = true } }
            projectFill = false
            lastFill = nil
            activity = .working
            workingSince = Date()
            sentTab = browser?.current.id
            askToNotify()
            if shown { close() } else { blur() }
            let since = workingSince
            // (a reply that never says it's done, a page that went away: the dots stop after 16 minutes)
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 16 * 60 * 1_000_000_000)
                guard let self, self.activity == .working, self.workingSince == since else { return }
                self.activity = .idle
            }
        case "done":
            // (the mods: the reply's new code blocks with a whole mod file in each)
            handleDone(d, d["mods"] as? [String] ?? [])
        case "viewer":
            // (the chat's own viewer opened, on a file the person tapped: the mod it shows, to Add this mod?; or, when no
            // code could be read off it, a line in the diagnostics, so the next report shows what was there)
            let text = d["text"] as? String ?? ""
            let name = d["name"] as? String ?? ""
            let what = "\(d["why"] as? String ?? "a viewer")\(name.isEmpty ? "" : " on \(name)") at \(d["path"] as? String ?? "?")"
            if text.isEmpty {
                report.log("claude", "\(service.rawValue): \(what), no mod's code read off it")
                if name.lowercased().hasSuffix(".js") { Diagnostics.shared.log("chat files", "\(service.rawValue)'s viewer opened \(what), and no mod's code could be read off it") }
                return
            }
            report.log("claude", "\(service.rawValue): \(what): its code read (\(text.count) characters), to Add this mod?")
            guard let browser else { return }
            Task { @MainActor in
                let offered = await browser.offerFromChat([text])
                if let conv = self.conversation { for m in offered { browser.noteChatHas(m.code, conv) } }
            }
        default: break
        }
    }

    /// A reply done, with the mod files in its code blocks: offered with Add this mod?. None: the chat button's
    /// replied mark.
    private func handleDone(_ d: [String: Any], _ texts: [String]) {
        report.log("claude", "\(service.rawValue): reply done (\(d["why"] as? String ?? "?")\(d["stop"] as? Bool == true ? ", its stop button seen" : "")), \(texts.count) mod file(s) in it")
        let late = d["why"] as? String == "late"
        guard activity == .working || late else { return }
        guard let browser else { activity = .idle; endBackground(); return }
        Task { @MainActor in
            let offered = await browser.offerFromChat(texts)
            if let conv = self.conversation { for m in offered { browser.noteChatHas(m.code, conv) } }
            // (the app in the background: a notification says so, then iOS's background time is given back)
            if UIApplication.shared.applicationState == .background { self.notifyDone(offered) } // (not inactive: an alert of the system's over the app)
            self.endBackground()
            if late { if !offered.isEmpty, self.activity == .replied { self.activity = .idle }; return }
            self.activity = !offered.isEmpty || self.shown ? .idle : .replied
        }
    }

    // MARK: a reply in the background (Tim, 11-15: "a notification when a new mod is ready")
    // An app in the background runs only while it holds background time from iOS (about 30 seconds since iOS 13;
    // a swiped-away app runs nothing), and TRIF has no server to notice a reply for it. So: going to the background
    // while a reply is being written, the app asks for that time, the chat keeps watching the reply, and when it's
    // done a local notification says so. If the time runs out first, it's given back (iOS ends an app that keeps
    // it) with a quiet notification, and the reply is read when the app comes back.

    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private var backgroundSince: Date?
    /// The tab the person was on when they sent: a notification's tap goes back to it.
    private var sentTab: UUID?
    static let replyNote = "trif.reply"
    static let stillNote = "trif.reply.still"

    /// Notifications asked for once, at the first send (not at launch). Refused: nothing else changes.
    private func askToNotify() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound]) { ok, _ in
                Task { @MainActor in Diagnostics.shared.log("notify", "notifications \(ok ? "allowed" : "not allowed")") }
            }
        }
    }

    private func wentToBackground() {
        backgroundSince = Date()
        guard activity == .working, bgTask == .invalid else { return }
        let start = Date()
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "TRIF: a reply being written") { [weak self] in
            // (iOS calls this on the main thread just before the time is up: the time is given back here, at once)
            MainActor.assumeIsolated {
                guard let self else { return }
                Diagnostics.shared.log("background", "iOS's background time ran out after \(Int(Date().timeIntervalSince(start))) s, the reply still being written")
                if self.activity == .working { self.notifyStillWriting() }
                self.endBackground()
            }
        }
        // (the time iOS gives is known only once the app is in the background)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard let self, self.bgTask != .invalid else { return }
            let left = UIApplication.shared.backgroundTimeRemaining
            Diagnostics.shared.log("background", "a reply is being written: background time asked for, \(left > 100_000 ? "no limit given yet" : "\(Int(left)) s left")")
        }
    }

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
        guard activity == .working else { return }
        // (after a while away iOS will have stopped the chat's page: its reply may have been cut off mid-stream, or
        // finished on the chat's side without the page hearing. If, a moment after coming back, nothing is being
        // written, the conversation is loaded again and the reply read from it (chat.js resume). A page iOS ended
        // is loaded again anyway: webViewWebContentProcessDidTerminate.)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, self.activity == .working, away > 20, self.conversation != nil else { return }
            let st = (Browser.parse(await self.chatJS("state()")) as? [String: Any]) ?? [:]
            if st["replying"] as? Bool == true { return }
            Diagnostics.shared.log("background", "back after \(Int(away)) s; the reply isn't being written any more: its conversation loaded again to read it")
            self.webView.reload()
        }
    }

    private func notify(_ title: String, _ body: String, id: String, kind: String, quiet: Bool = false) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.userInfo = ["kind": kind, "tab": sentTab?.uuidString ?? ""]
        if quiet { c.interruptionLevel = .passive } else { c.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    private var noteSite: String { site.isEmpty ? (browser?.site ?? "") : site }

    private func notifyDone(_ offered: [InstalledMod]) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [ClaudePane.stillNote])
        let place = noteSite.isEmpty ? "" : " for \(noteSite)"
        if offered.count == 1 {
            notify("Your mod is ready", "\(offered[0].name)\(place): tap to add it.", id: ClaudePane.replyNote, kind: "mod")
        } else if offered.count > 1 {
            notify("Your mods are ready", "\(offered.count) mods\(place): tap to add them.", id: ClaudePane.replyNote, kind: "mod")
        } else {
            notify("\(service.rawValue) replied", noteSite.isEmpty ? "Tap to read the reply." : "On \(noteSite): tap to read the reply.", id: ClaudePane.replyNote, kind: "replied")
        }
        Diagnostics.shared.log("notify", "the reply's notification: \(offered.count) mod(s)")
    }

    private func notifyStillWriting() {
        notify("Still writing", "\(service.rawValue) is still writing\(noteSite.isEmpty ? "" : " for \(noteSite)"). Open TRIF to get your mod when it's done.", id: ClaudePane.stillNote, kind: "working", quiet: true)
    }

    /// A tap on one of these notifications: the tab it was sent from; then its mod's Add this mod? (already waiting
    /// for the app to be in front), or the chat at the reply.
    private func notificationTapped(_ info: [AnyHashable: Any]) {
        guard let browser else { return }
        if let id = (info["tab"] as? String).flatMap(UUID.init(uuidString:)), let tab = browser.tabs.first(where: { $0.id == id }), tab !== browser.current {
            browser.select(tab)
        }
        switch info["kind"] as? String {
        case "replied": open()
        case "mod":
            // (the app was ended meanwhile, so the mod isn't waiting any more: the chat, whose reply has its Add to TRIF)
            if browser.modOffer == nil { open() }
        default: break
        }
    }

    /// Puts text (and a PNG) into the chat's message box as a paste, for the person to send (Web/chat.js fill).
    @discardableResult
    func fill(_ text: String, png: Data? = nil, pdf: Data? = nil, picture: String = "TRIF screenshot.png", as file: String? = nil) async -> String {
        var said = "failed"
        do {
            let r = try await webView.callAsyncJavaScript("return await globalThis.__trifChat ? globalThis.__trifChat.fill(text, png, name || null, pdf || null, picture) : 'not loaded';",
                                                          arguments: ["text": text, "png": png?.base64EncodedString() ?? "", "pdf": pdf?.base64EncodedString() ?? "", "name": file ?? "", "picture": picture], in: nil, contentWorld: ClaudePane.chatWorld)
            said = r as? String ?? "failed (\(String(describing: r)))"
        } catch {
            said = "failed: \((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)"
        }
        // (filling focuses the message box; if the person has gone back to the tab meanwhile, no keyboard over it)
        if !shown { blur() }
        report.log("claude", "\(service.rawValue): filled the message box (\(text.count) characters\(png == nil ? "" : ", a picture")\(pdf == nil ? "" : ", a \(pdf!.count / 1000) kB PDF")): \(said)")
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

    /// Switches the pane to the other chat (remembered), and loads it.
    func use(_ s: ChatService) {
        guard s != service else { return }
        service = s
        UserDefaults.standard.set(s.rawValue, forKey: "chatService")
        report.log("claude", "switched to \(s.rawValue)")
        started = true
        activity = .idle
        site = tabSite
        guard let url = resumeURL else { return }
        go(url)
        if shown, let ready = prepare() { queue { [weak self] in await self?.fillContext(ready) } }
    }

    /// Where the pane went, without what the address carries after ? (sign-in steps put secrets there).
    private func note(_ what: String, _ url: URL?) {
        guard let url = url else { return }
        report.log("claude", "\(service.rawValue), \(what): \(url.scheme ?? "")://\(url.host ?? "")\(url.path)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if let link = Browser.modLink(url, source: "Claude's pane") {
            browser?.offer(link)
            return .cancel
        }
        let scheme = url.scheme ?? ""
        if !["http", "https", "about", "blob", "data"].contains(scheme) {
            note("an address for another app, not followed", url)
            return .cancel
        }
        if ModDownloads.wanted(navigationAction) { return .download }
        if navigationAction.targetFrame?.isMainFrame ?? false { note("going to", url) }
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

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === self.webView { loading = true } }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        navigating = false
        projectPage = service.isProjectPage(webView.url) && webView.url?.absoluteString != service.project?.absoluteString
    }
    /// The page went into a new chat in TRIF's project without the guide (the project has it).
    private var projectFill = false
    /// The chat shows a project's page that isn't TRIF's project yet (the top bar offers to use it).
    @Published var projectPage = false
    /// ⋯'s Keep TRIF chats in a project: the chat, at the service's projects (TRIF's instructions on the clipboard).
    func openProjects() {
        UIPasteboard.general.string = ClaudePane.projectInstructions
        start()
        shown = true
        if let u = URL(string: service.projectsPage) { go(u) }
        report.log("claude", "\(service.rawValue): to its projects, TRIF's instructions copied")
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
        guard let u = webView.url, service.isProjectPage(u) else { return }
        var c = URLComponents(url: u, resolvingAgainstBaseURL: false)
        c?.query = nil; c?.fragment = nil
        service.useProject(c?.url, hasGuide: hasGuide)
        projectPage = false
        report.log("claude", "\(service.rawValue): TRIF's chats start in a project now\(hasGuide ? ", which has TRIF's instructions" : "")")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView { loading = false }
        note(webView === self.webView ? "loaded" : "loaded in a window it opened", webView.url)
        // (the chat's page loaded again while a reply was being written, its process ended say: watched again)
        if webView === self.webView, activity == .working { Task { _ = await chatJS("resume()") } }
        // (reloaded while the tab's data was going in: in again)
        if webView === self.webView, let p = refill {
            refill = nil
            queue { [weak self] in await self?.fillContext(p) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === self.webView { loading = webView.isLoading }
        if !Browser.stoppedNotFailed(error) { report.log("claude", "failed: \(error.localizedDescription)") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === self.webView { loading = webView.isLoading }
        if !Browser.stoppedNotFailed(error) { report.log("claude", "failed to load: \(error.localizedDescription)") }
    }

    /// A window Claude's page opens (signing in with Google or Apple does): a second web view made from the
    /// configuration WebKit hands over, so the two pages can still talk, shown as a sheet.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let link = Browser.modLink(url, source: "Claude's pane (a link that opens a new window)") {
            browser?.offer(link)
            return nil
        }
        note("opened a window for", navigationAction.request.url)
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.navigationDelegate = self
        child.uiDelegate = self
        child.isInspectable = true
        popup = child
        return child
    }

    /// The chat's page process ended (memory): loaded again, and noted in the diagnostics log.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Diagnostics.shared.log("ended", "WebKit ended the chat pane's page process at \(Diagnostics.place(webView.url)); loading it again.")
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
            Divider()
            if pane.more {
                WebViewHost(webView: pane.panel.webView)
            } else {
            WebViewHost(webView: pane.webView)
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
