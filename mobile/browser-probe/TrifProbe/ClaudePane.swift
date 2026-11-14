// Claude beside the page: claude.ai in a web view of its own, signed in as the person, on their own
// subscription. The app doesn't touch that page: no script of TRIF's goes into it and nothing is read out
// of it. The only thing it does is stop a mod link when one is tapped (an address ending /trif-install),
// which is how a fix gets from the chat to the page above. What the probe wants to know is whether
// signing in works at all in an app's web view, and whether a link in a reply reaches the app.

import SwiftUI
import UIKit
import WebKit

/// Which chat the pane shows: Claude, or ChatGPT (Codex on the web works on code repositories, not on a page
/// someone is looking at, so ChatGPT is its side's chat). Each keeps its own sign-in (the app's one cookie store).
enum ChatService: String, CaseIterable, Identifiable {
    case claude = "Claude", chatgpt = "ChatGPT"
    var id: String { rawValue }
    var home: String { self == .claude ? "https://claude.ai/new" : "https://chatgpt.com/" }
}

@MainActor
final class ClaudePane: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static var home: String { ChatService.claude.home }
    /// TRIF in the chat (Web/chat.js; Tim, 11-13): its own world beside Claude's or ChatGPT's page.
    static let chatWorld = WKContentWorld.world(name: "trif-chat")
    @Published var service: ChatService = ChatService(rawValue: UserDefaults.standard.string(forKey: "chatService") ?? "") ?? .claude

    @Published var popup: WKWebView?
    @Published var loading = false

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
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
    }

    /// Loads Claude the first time the pane is shown (not before: the probe is useful without it).
    func start() {
        guard !started, let url = URL(string: service.home) else { return }
        started = true
        webView.load(URLRequest(url: url))
    }

    func home() {
        if let url = URL(string: service.home) { webView.load(URLRequest(url: url)) }
    }

    /// An Add to TRIF tap in the chat, or a mod just finished in a reply (Web/chat.js): to the app's Add this mod? sheet.
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], d["type"] as? String == "mod", let text = d["text"] as? String else { return }
        if d["auto"] as? Bool == true {
            report.log("claude", "\(service.rawValue): a mod finished in a reply (\(text.count) characters)")
            browser?.offerFromChat(text)
        } else {
            report.log("claude", "\(service.rawValue): Add to TRIF tapped (\(text.count) characters)")
            browser?.offer(text: text)
        }
    }

    /// Puts text (and a PNG) into the chat's message box as a paste, for the person to send (Web/chat.js fill).
    @discardableResult
    func fill(_ text: String, png: Data? = nil, pdf: Data? = nil, picture: String = "TRIF screenshot.png", as file: String? = nil) async -> String {
        let r = try? await webView.callAsyncJavaScript("return await globalThis.__trifChat ? globalThis.__trifChat.fill(text, png, name || null, pdf || null, picture) : 'not loaded';",
                                                       arguments: ["text": text, "png": png?.base64EncodedString() ?? "", "pdf": pdf?.base64EncodedString() ?? "", "name": file ?? "", "picture": picture], in: nil, contentWorld: ClaudePane.chatWorld)
        let said = r as? String ?? "failed"
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
        home()
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

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        note(webView === self.webView ? "loaded" : "loaded in a window it opened", webView.url)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loading = false
        report.log("claude", "failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loading = false
        if (error as NSError).code != NSURLErrorCancelled { report.log("claude", "failed to load: \(error.localizedDescription)") }
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

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popup { popup = nil }
    }
}

struct ClaudePaneView: View {
    @ObservedObject var pane: ClaudePane
    /// The mod file in what was just copied from the chat (Browser.offer(text:)), from iOS's own Paste button,
    /// which needs no "Allow Paste?" each time.
    var addPasted: (String?) -> Void = { _ in }
    /// Send page: the page, and how to write a mod for it, into the message box (Browser.pageForChat).
    var sendPage: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Chat", selection: Binding(get: { pane.service }, set: { pane.use($0) })) {
                    ForEach(ChatService.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                if pane.loading { ProgressView().scaleEffect(0.7) }
                Spacer()
                Button("Send page") { sendPage() }.font(.subheadline).bold()
                PasteButton(payloadType: String.self) { texts in Task { @MainActor in addPasted(texts.first) } }
                    .labelStyle(.titleAndIcon)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                Button("Start over") { pane.home() }.font(.subheadline)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            WebViewHost(webView: pane.webView)
        }
        .onAppear { pane.start() }
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
