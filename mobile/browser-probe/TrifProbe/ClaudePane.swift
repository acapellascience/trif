// The chat: claude.ai (or chatgpt.com) in a web view of its own, signed in as the person, on their own
// subscription, shown full screen over the tab when the chat button is tapped (Tim, 11-15: "you either want
// claude or you don't"; it was a pane from the bottom before). TRIF's script in it (Web/chat.js, a world of its
// own) puts the tab's data into the message box, tells the app when the person sends (the app goes back to the
// tab), watches the reply until it's done, and hands over the mod files in it: the app asks Add this mod? about
// each, over the tab. The person always sends, and always says yes to a mod, themselves.

import SwiftUI
import UIKit
import WebKit

/// Which chat the pane shows: Claude, or ChatGPT (Codex on the web works on code repositories, not on a page
/// someone is looking at, so ChatGPT is its side's chat). Each keeps its own sign-in (the app's one cookie store).
enum ChatService: String, CaseIterable, Identifiable {
    case claude = "Claude", chatgpt = "ChatGPT"
    var id: String { rawValue }
    var home: String { ChatService.standIn ?? (self == .claude ? "https://claude.ai/new" : "https://chatgpt.com/") }
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

    @Published var popup: WKWebView?
    @Published var loading = false
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
        NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !ClaudePane.scrolls(self.webView.scrollView) else { return }
                self.webView.scrollView.setContentOffset(.zero, animated: true)
            }
        }
        scrollWatches = [
            sv.observe(\.contentSize, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.fitScrolling() } },
            sv.observe(\.bounds, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.fitScrolling() } },
        ]
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
        // (the conversation the pane is on, kept, so the app reopens it: Tim, 11-14)
        urlWatch = webView.observe(\.url, options: [.new]) { [weak self] wv, _ in
            let url = wv.url
            Task { @MainActor in self?.remember(url) }
        }
    }

    private var urlWatch: NSKeyValueObservation?
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
            guard sv.isScrollEnabled != on else { return }
            sv.isScrollEnabled = on
            sv.bounces = on
            if !on, sv.contentOffset != .zero { sv.setContentOffset(.zero, animated: false) }
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
        UserDefaults.standard.string(forKey: lastKey(service, site)).flatMap(URL.init(string:)) ?? URL(string: service.home)
    }

    /// Loads an address in the chat, marked as loading at once (a fill waits for it: waitForPage).
    private func go(_ url: URL) {
        loading = true
        webView.load(URLRequest(url: url))
    }

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
    private func catchUp() {
        guard started, site != tabSite, activity == .idle else { return }
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
        let was = activity
        let already = shown
        if was == .replied { activity = .idle }
        if was == .idle { catchUp() }
        start()
        shown = true
        report.log("claude", "\(service.rawValue): opened\(was == .idle ? "" : " (\(was.rawValue))")")
        queue { [weak self] in
            guard let self else { return }
            if was == .replied { _ = await self.chatJS("showReply()") }
            else if was == .idle, !already { await self.fillContext() }
            if let extra { await self.waitForPage(); await extra() }
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
        guard let url = URL(string: service.home) else { return }
        go(url)
        queue { [weak self] in await self?.fillContext() }
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

    /// Waits for the chat's page to finish loading (15 s at most).
    private func waitForPage() async {
        for _ in 0..<60 where loading || webView.url == nil { try? await Task.sleep(nanoseconds: 250_000_000) }
    }

    private func chatJS(_ call: String) async -> String? {
        try? await webView.callAsyncJavaScript("return globalThis.__trifChat ? globalThis.__trifChat.\(call) : null;", arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) as? String
    }

    /// The tab's data into the message box (Tim, 11-15: "full instructions if it's a new chat, the feedback data
    /// if it's not"): in a conversation without TRIF's instructions, how mods are written and the page
    /// (Browser.pageForChat, as TRIF instruction.txt, with a screenshot); in one that has them, the page as it is
    /// now, the mods on it and their errors (Browser.feedbackForChat, as TRIF follow-up.txt). Nothing when the
    /// message box isn't there (signed out) or already has something in it. The person sends it themselves.
    private func fillContext() async {
        await waitForPage()
        // (the message box a moment after the page has loaded: chat.js fill waits for it too)
        var st: [String: Any] = [:]
        for _ in 0..<20 {
            st = (Browser.parse(await chatJS("state()")) as? [String: Any]) ?? [:]
            if st["editor"] as? Bool == true { break }
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        guard st["editor"] as? Bool == true else { report.log("claude", "\(service.rawValue): no message box (signed out?), nothing filled"); return }
        if st["has"] as? Bool == true { report.log("claude", "\(service.rawValue): the message box already has something in it: left as it is"); return }
        if st["working"] as? Bool == true { return }
        guard let browser, shown || activity == .idle else { return }
        let conv = conversation
        if st["context"] as? Bool == true, let conv { noteContext(conv) }
        if let conv, hasContext(conv) {
            if let f = await browser.feedbackForChat() { await fill(f.text, png: f.png, as: "TRIF follow-up.txt") }
        } else if let t = await browser.pageForChat() {
            let shot = await browser.settledScreenshot().png
            await fill(t, png: shot, as: "TRIF instruction.txt")
        }
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
            if d["withInstructions"] as? Bool == true { if let conv = conversation { noteContext(conv) } else { contextNext = true } }
            activity = .working
            workingSince = Date()
            if shown { close() } else { blur() }
            let since = workingSince
            // (a reply that never says it's done, a page that went away: the dots stop after 16 minutes)
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 16 * 60 * 1_000_000_000)
                guard let self, self.activity == .working, self.workingSince == since else { return }
                self.activity = .idle
            }
        case "done":
            let texts = d["mods"] as? [String] ?? []
            report.log("claude", "\(service.rawValue): reply done (\(d["why"] as? String ?? "?")\(d["stop"] as? Bool == true ? ", its stop button seen" : "")), \(texts.count) mod file(s) in it")
            let late = d["why"] as? String == "late"
            guard activity == .working || late else { return }
            guard let browser else { activity = .idle; return }
            Task { @MainActor in
                let offered = await browser.offerFromChat(texts)
                if late { if offered > 0, self.activity == .replied { self.activity = .idle }; return }
                self.activity = offered > 0 || self.shown ? .idle : .replied
            }
        default: break
        }
    }

    /// Puts text (and a PNG) into the chat's message box as a paste, for the person to send (Web/chat.js fill).
    @discardableResult
    func fill(_ text: String, png: Data? = nil, pdf: Data? = nil, picture: String = "TRIF screenshot.png", as file: String? = nil) async -> String {
        let r = try? await webView.callAsyncJavaScript("return await globalThis.__trifChat ? globalThis.__trifChat.fill(text, png, name || null, pdf || null, picture) : 'not loaded';",
                                                       arguments: ["text": text, "png": png?.base64EncodedString() ?? "", "pdf": pdf?.base64EncodedString() ?? "", "name": file ?? "", "picture": picture], in: nil, contentWorld: ClaudePane.chatWorld)
        let said = r as? String ?? "failed"
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
        if shown { queue { [weak self] in await self?.fillContext() } }
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
        if navigationAction.targetFrame?.isMainFrame ?? false { note("going to", url) }
        return .allow
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === self.webView { loading = true } }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView { loading = false }
        note(webView === self.webView ? "loaded" : "loaded in a window it opened", webView.url)
        // (the chat's page loaded again while a reply was being written, its process ended say: watched again)
        if webView === self.webView, activity == .working { Task { _ = await chatJS("resume()") } }
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
    /// What the way back says: the tab's site (or "Tab").
    var tabName: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { pane.close() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.body.weight(.semibold))
                        Text(tabName).lineLimit(1).truncationMode(.middle)
                    }
                }
                .accessibilityLabel("Back to \(tabName)")
                Spacer(minLength: 4)
                if pane.loading { ProgressView().scaleEffect(0.7) }
                Picker("Chat", selection: Binding(get: { pane.service }, set: { pane.use($0) })) {
                    ForEach(ChatService.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                Button { pane.home() } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("Start over")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Divider()
            WebViewHost(webView: pane.webView)
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
