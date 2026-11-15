// The Mods tab (branch ios-poc): the desktop side panel's mods list, on the phone. A page of the app's own
// (Web/mods.html, mods-page.js, mods-page.css, over the panel's own sidepanel.css and switch.css, with its row icons,
// explanations, switch and robot: shared/gen/panel-kit.js) in a web view of its own, which never loads anything
// else. It gets the site's mods from here (state) and asks for every change by a message (the "app" handler),
// as the panel asks the extension's background.

import SwiftUI
import UIKit
import WebKit

@MainActor
final class ModsPanel: NSObject, ObservableObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let webView: WKWebView
    private weak var browser: Browser?
    private var ready = false
    /// Set by the page's Import mod… (the app shows the file picker) and Export (the share sheet).
    @Published var wantsImport = false
    @Published var share: ShareFiles?
    /// The approval card to open when the page is next shown (a mod just added that waits).
    var openApproval: String?

    init(browser: Browser) {
        self.browser = browser
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "app")
        webView.navigationDelegate = self
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if let page = Bundle.main.url(forResource: "mods", withExtension: "html"), let dir = Bundle.main.resourceURL {
            webView.loadFileURL(page, allowingReadAccessTo: dir)
        }
    }

    /// Nothing but the page itself: a link in a mod's code or description isn't followed in here.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        navigationAction.request.url?.isFileURL == true ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        Task { await refresh() }
    }

    /// Sends the page what it shows: the site's mods, as the panel's status has them.
    func refresh(openingApproval: String? = nil) async {
        guard ready, let browser else { return }
        let state = await browser.modsState()
        let json = Browser.jsonText(state)
        let open = openingApproval ?? openApproval
        openApproval = nil
        _ = try? await webView.callAsyncJavaScript("window.trifRender && window.trifRender(JSON.parse(state), open || null); return 'ok';",
                                                   arguments: ["state": json, "open": open ?? ""], in: nil, contentWorld: .page)
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let d = message.body as? [String: Any] else { return (nil, "not a message of the Mods tab's") }
        return await handle(d)
    }

    /// One of the page's messages (or the sheet's own menu's): what it asks for, done; its answer, or why not.
    func handle(_ d: [String: Any]) async -> (Any?, String?) {
        guard let type = d["type"] as? String, let browser else { return (nil, "not a message of the Mods tab's") }
        let id = d["id"] as? String ?? ""
        let store = browser.mods
        let mod = store.mods.first { $0.id == id }
        func done(_ again: Bool = true) async -> (Any?, String?) {
            if again { browser.modsChanged() }
            await refresh()
            return (["ok": true], nil)
        }
        switch type {
        case "state":
            return (Browser.jsonText(await browser.modsState()), nil)
        case "enable":
            let on = d["enabled"] as? Bool ?? false
            store.setOn(id, on, site: d["site"] as? String)
            browser.report.log("mods", "\(id) switched \(on ? "on" : "off")\((d["site"] as? String).map { " on \($0)" } ?? "")")
            return await done()
        case "group":
            guard let g = d["group"] as? String else { return (nil, "no group") }
            store.setGroup(g == "rules" ? "style" : g == "sandboxed" ? "boxed" : "free", on: d["enabled"] as? Bool ?? true, site: browser.site)
            return await done()
        case "delete":
            store.remove(id)
            browser.report.log("mods", "deleted \(id)")
            return await done()
        case "undoDelete":
            store.undoDelete()
            return await done()
        case "approve":
            browser.approveMod(id)
            await refresh()
            return (["ok": true], nil)
        case "reject":
            store.reject(id)
            browser.report.log("mods", "didn't allow \(id)")
            return await done()
        case "code":
            guard let m = mod else { return (nil, "that mod isn't here any more") }
            return (["code": d["version"] as? String == "ran" ? (m.ran?.code ?? m.code) : m.code], nil)
        case "diff":
            guard let m = mod, let ran = m.ran else { return (nil, "nothing is waiting") }
            return (["lines": store.diff(ran.code, m.code)], nil)
        case "history":
            guard let m = mod else { return (nil, "that mod isn't here any more") }
            return (["entries": m.history.map { ["stamp": $0.stamp, "at": $0.at.timeIntervalSince1970 * 1000, "source": $0.source] }], nil)
        case "historyCode", "historyDiff":
            guard let m = mod, let v = m.history.first(where: { $0.stamp == d["stamp"] as? String }) else { return (nil, "that version isn't kept any more") }
            return type == "historyCode" ? (["code": v.code], nil) : (["lines": store.diff(v.code, m.code)], nil)
        case "restore":
            guard store.restore(id, stamp: d["stamp"] as? String ?? "") else { return (nil, "that version couldn't be read") }
            browser.report.log("mods", "restored a version of \(id)")
            return await done()
        case "copy":
            UIPasteboard.general.string = d["text"] as? String ?? ""
            return (["ok": true], nil)
        case "export":
            guard let m = mod, let file = ModFiles.write([m]) else { return (nil, "couldn't write the file") }
            share = ShareFiles(urls: file)
            return (["ok": true, "file": file.first?.lastPathComponent ?? ""], nil)
        case "exportSite":
            let list = store.mods.filter { $0.site == browser.site || Site.host($0.site, isIn: browser.site) }
            guard !list.isEmpty, let files = ModFiles.write(list, folder: "\(browser.site) mods") else { return (nil, "no mods for \(browser.site)") }
            share = ShareFiles(urls: files)
            return (["ok": true, "count": list.count], nil)
        case "import":
            wantsImport = true
            return (["ok": true], nil)
        case "unhide":
            guard let r = browser.report.rules.first(where: { $0.id.uuidString == id }) else { return (nil, "not hidden any more") }
            await browser.unhide(r)
            await refresh()
            return (["ok": true], nil)
        default:
            return (nil, "unknown message \(type)")
        }
    }
}

/// Files for the share sheet (Export, Export all mods for a site).
struct ShareFiles: Identifiable {
    let id = UUID()
    let urls: [URL]
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// The Mods tab, as a sheet over the page: the panel's list for the shown tab's site.
struct ModsPanelView: View {
    @ObservedObject var panel: ModsPanel
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebViewHost(webView: panel.webView)
                .ignoresSafeArea(edges: .bottom)
                .background(Color(.systemBackground))
                .navigationTitle(browser.site.isEmpty ? "Mods" : "Mods on \(browser.site)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button("Import mod…") { panel.wantsImport = true }
                            Button("Export all mods for \(browser.site)") {
                                Task { _ = await panel.handle(["type": "exportSite"]) }
                            }
                            .disabled(!browser.mods.mods.contains { $0.site == browser.site || Site.host($0.site, isIn: browser.site) })
                        } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("More")
                    }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .task { await panel.refresh() }
        .onChange(of: browser.pageChanged) { _, _ in Task { await panel.refresh() } }
        .sheet(item: $panel.share) { s in ShareSheet(items: s.urls) }
    }
}


extension Browser {
    /// The ids of the mods that started on the shown page, in each of the three worlds (modfile.js marks them).
    func ranHere() async -> Set<String> {
        var out = Set<String>()
        for world in [Browser.trifWorld, Browser.boxWorld, WKContentWorld.page] {
            if let t = (await call("return JSON.stringify(Array.isArray(globalThis.__trifRan) ? globalThis.__trifRan : []);", in: world)).text,
               let ids = Browser.parse(t) as? [String] { out.formUnion(ids) }
        }
        return out
    }

    /// What the Mods tab shows for the shown tab's site, in the shape the desktop panel's status has its mods:
    /// every mod for the site (its domain, or every site), whether it started on this page, its errors here, its hold.
    func modsState() async -> [String: Any] {
        let url = webView.url?.absoluteString ?? ""
        let site = self.site
        let listed = mods.mods.filter { m in
            m.everywhere || Site.of(m.site) == site || m.sites.contains { Site.of($0) == site } || (!url.isEmpty && mods.applies(m, to: url))
        }
        let ran = url.isEmpty ? [] : await ranHere()
        let errors = await modErrorsById(listed)
        let rows: [[String: Any]] = listed.map { m in
            let applies = !url.isEmpty && mods.applies(m, to: url)
            let on = mods.isOn(m, site: site)
            let tierOff = mods.groupOff(m.tier, on: site)
            var row: [String: Any] = [
                "id": m.id, "name": m.name, "description": m.description, "tier": m.tier,
                "rules": m.tier == "style", "sandboxed": m.tier == "boxed",
                "powers": m.powers, "powerInfo": ["facts": m.facts.map { ["power": $0.power, "fact": $0.fact] }, "warnings": m.warnings],
                "matches": m.matches, "sites": m.sites, "site": m.site, "file": "\(m.id.split(separator: "/").last ?? "mod").js",
                "multi": m.multiSite, "on": on, "applies": applies, "running": ran.contains(m.id),
                "errors": errors[m.id] ?? [], "imported": m.source == "import", "history": m.history.count,
            ]
            if let r = m.risk { row["risk"] = ["tier": r.tier, "why": r.why ?? ""] }
            if let n = m.newOff { row["newOff"] = n }
            if m.held {
                row[m.pending ? "pending" : "held"] = ["needs": m.waiting.map(\.key), "facts": m.waiting.map(\.fact), "asks": m.tier == "boxed",
                                                         "by": m.source, "site": m.site, "hash": m.hash]
            }
            // (a free mod that should have started here and didn't: the page's own world wouldn't run it)
            if m.tier == "free", on, !tierOff, !m.held, applies, !loading, !ran.contains(m.id) { row["cant"] = true }
            return row
        }
        let tiers = ["style": "rules", "boxed": "sandboxed", "free": "page"]
        return [
            "site": site, "host": host, "url": url, "loading": loading,
            "mods": rows,
            "groupsOff": (mods.groupsOff[site] ?? []).compactMap { tiers[$0] },
            "hidden": report.rules.filter { $0.host == host }.map { ["id": $0.id.uuidString, "selector": $0.selector] },
            "deleted": mods.lastDeleted?.name ?? NSNull(),
        ]
    }
}
