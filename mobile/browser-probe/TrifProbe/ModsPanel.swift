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
    /// Set when the tab should close by itself: a hold that came from the chat, now decided (Browser.holdFromChat).
    @Published var wantsClose = false
    /// The ⋯ menu's All mods (Tim, 11-18: every-site mods seen in one list without visiting a site): every mod, by
    /// where it runs, each with its whole switch; off: the shown site's mods.
    @Published var showAll = false

    /// After Allow or Don't allow: if the tab was opened for a hold from the chat and nothing else on the site
    /// waits, it closes, so the page (reloaded with the mod) shows.
    private func closeIfDecided() {
        guard let browser, browser.holdFromChat else { return }
        let site = browser.site
        let waiting = browser.mods.mods.contains { $0.held && ($0.everywhere || SiteAccess.shared.scope($0.site) == site || $0.sites.contains { SiteAccess.shared.scope($0) == site }) }
        if !waiting { browser.holdFromChat = false; wantsClose = true }
    }
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

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Diagnostics.shared.log("ended", "WebKit ended the Mods tab's page process; loading it again.")
        ready = false
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        Task { await refresh() }
    }

    /// Sends the page what it shows: the site's mods, as the panel's status has them.
    /// First what the app knows (at once), then what the page says (which mods started there, their errors), when it
    /// answers: a page busy with its own work (x.com scrolling) answers late, and the tab stayed blank meanwhile
    /// (Tim, 11-15: about five seconds). The page's part has two seconds; past that the tab keeps what it showed.
    func refresh(openingApproval: String? = nil) async {
        guard ready, let browser else { return }
        let open = openingApproval ?? openApproval
        openApproval = nil
        let all = showAll
        await send(browser.modsState(askPage: false, all: all), open: open)
        // (All mods: no page to ask)
        if all { return }
        let full: [String: Any]? = await Browser.within(2, nil) { await browser.modsState(askPage: true) }
        if let full { await send(full, open: nil) } else { Diagnostics.shared.log("slow", "the Mods tab asked \(Diagnostics.place(browser.webView.url)) which mods started there, and it didn't answer within 2 s") }
        // (a mod still starting: asked again once its grace is over; one wait at a time)
        if let wait = full?["recheck"] as? Double {
            recheck?.cancel()
            recheck = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                self.recheck = nil
                await self.refresh()
            }
        }
    }
    private var recheck: Task<Void, Never>?

    private func send(_ state: [String: Any], open: String?) async {
        _ = try? await webView.callAsyncJavaScript("window.trifRender && window.trifRender(JSON.parse(state), open || null); return 'ok';",
                                                   arguments: ["state": Browser.jsonText(state), "open": open ?? ""], in: nil, contentWorld: .page)
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
            if again { browser.modsChanged(why: "the Mods tab: \(type) \(id)") }
            await refresh()
            return (["ok": true], nil)
        }
        switch type {
        case "state":
            // (from the app's own store at once: never waits for the page, which may be busy or gone. Tim, 11-15:
            // on x.com the tab showed nothing at all, as this waited on the page)
            return (Browser.jsonText(await browser.modsState(askPage: false, all: showAll)), nil)
        case "enable":
            let on = d["enabled"] as? Bool ?? false
            store.setOn(id, on, site: d["site"] as? String)
            if on { browser.safety.forget(id) }
            browser.report.log("mods", "\(id) switched \(on ? "on" : "off")\((d["site"] as? String).map { " on \($0)" } ?? "")")
            return await done()
        case "group":
            guard let g = d["group"] as? String else { return (nil, "no group") }
            store.setGroup(g == "rules" ? "style" : g == "sandboxed" ? "boxed" : "free", on: d["enabled"] as? Bool ?? true, site: browser.site)
            return await done()
        case "delete":
            store.remove(id)
            browser.safety.forget(id)
            browser.report.log("mods", "deleted \(id)")
            return await done()
        case "connect":
            // (the Mods tab's Connect on a disconnected site: as the robot's card's)
            SiteAccess.shared.connect(browser.host, why: "the Mods tab")
            await refresh()
            return (["ok": true], nil)
        case "resume":
            browser.pauseAll(false)
            await refresh()
            return (["ok": true], nil)
        case "dismissOff":
            browser.safety.dismiss(site: browser.site)
            await refresh()
            return (["ok": true], nil)
        case "syncNow":
            PhoneSyncModel.shared.syncNow()
            await refresh()
            return (["ok": true], nil)
        case "syncSeen":
            PhoneSyncModel.shared.seen()
            await refresh()
            return (["ok": true], nil)
        case "restoreDeleted":
            guard let entry = d["entry"] as? String, store.trash.contains(where: { $0.id == entry }) else { return (nil, "It isn't in Recently deleted any more.") }
            guard store.restoreDeleted(entry) else { return (nil, "A mod with the same name is here now. Delete or rename it first.") }
            browser.report.log("mods", "restored \(entry)")
            return await done()
        case "undoDelete":
            store.undoDelete()
            return await done()
        case "approve":
            browser.approveMod(id)
            await refresh()
            closeIfDecided()
            return (["ok": true], nil)
        case "reject":
            store.reject(id)
            browser.report.log("mods", "didn't allow \(id)")
            let r = await done()
            closeIfDecided()
            return r
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
        case "check":
            guard let m = mod else { return (nil, "that mod isn't here any more") }
            return (store.check(d["text"] as? String ?? "", for: m), nil)
        case "save":
            let r = store.saveEdit(id, d["text"] as? String ?? "")
            guard let m = r.mod else { return (["ok": false, "check": r.check], nil) }
            browser.report.log("mods", "edited \(id)\(m.held ? ", waiting for an OK" : "")")
            if r.stamp != nil { browser.modsChanged() }
            await refresh()
            return (["ok": true, "saved": r.stamp != nil, "held": m.held, "stamp": r.stamp ?? ""], nil)
        case "undoEdit":
            guard store.restore(id, stamp: d["stamp"] as? String ?? "", as: "undo") else { return (nil, "that version isn't kept any more") }
            browser.report.log("mods", "undid an edit of \(id)")
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
        case "rename":
            // (the details' Name row: docs/PHONE-SYNC.md 2a. Never held, never marked new; everything keyed by its id follows)
            let r = store.rename(id, to: d["name"] as? String ?? "")
            guard let m = r.mod else { return (nil, ModsPanel.renameWords(r.error)) }
            if m.id != id || m.name != mod?.name { browser.report.log("mods", "renamed \(id) to \(m.id) (\(m.name))") }
            return await done()
        case "showAll":
            showAll = d["on"] as? Bool ?? !showAll
            await refresh()
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

extension ModsPanel {
    /// A rename's refusal in the person's words (ModStore.rename's reasons: ModID.checkName's, or the store's).
    static func renameWords(_ why: String?) -> String {
        switch why {
        case "a name can't be empty"?: return "Give it a name."
        case "a name is one line"?: return "A name fits on one line."
        case "a name can be up to 80 characters"?: return "A name can be up to 80 characters."
        case "gone"?: return "That mod isn't here any more."
        default: return "TRIF couldn't rename it. Try again."
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
    /// Closes it (it lies over the page, the toolbar under it).
    var close: () -> Void = {}
    @EnvironmentObject var browser: Browser
    private func dismiss() { close() }

    var body: some View {
        NavigationStack {
            WebViewHost(webView: panel.webView)
                .background(Color(.systemBackground))
                .navigationTitle(panel.showAll ? "All mods" : browser.site.isEmpty ? "Mods" : "Mods on \(browser.site)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            // (every mod, wherever it runs: every-site mods without visiting a site)
                            Button(panel.showAll ? (browser.site.isEmpty ? "Mods for this page" : "Mods on \(browser.site)") : "All mods") {
                                Task { _ = await panel.handle(["type": "showAll", "on": !panel.showAll]) }
                            }
                            // (site access, Tim 11-20: as desktop's Disconnect; its mods and switches kept for when it's connected again)
                            if !panel.showAll, browser.connectedHere, !browser.site.isEmpty, browser.webView.url?.scheme?.hasPrefix("http") == true {
                                Button("Disconnect from \(browser.site)", role: .destructive) {
                                    SiteAccess.shared.disconnect(browser.host, why: "the Mods tab's menu")
                                    Task { await panel.refresh() }
                                }
                            }
                            Divider()
                            Button("Import mod…") { panel.wantsImport = true }
                            Button("Export all mods for \(browser.site)") {
                                Task { _ = await panel.handle(["type": "exportSite"]) }
                            }
                            .disabled(!browser.mods.mods.contains { $0.site == browser.site || Site.host($0.site, isIn: browser.site) })
                            Divider()
                            // (Safety.swift: the switches as they were before safe mode switched mods off, put back)
                            RestoreSwitchesMenu(safety: browser.safety) { id in
                                browser.restoreSwitches(id)
                                Task { await panel.refresh() }
                            }
                            // (Safety.swift: no mod runs anywhere until Resume)
                            Button(browser.mods.paused ? "Resume mods" : "Pause all mods") {
                                browser.pauseAll(!browser.mods.paused)
                                Task { await panel.refresh() }
                            }
                            // (Diagnostics.swift: what went wrong lately, with times, as a file to send)
                            Button("Send diagnostics…") { if let f = Diagnostics.shared.file() { panel.share = ShareFiles(urls: [f]) } }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("More")
                    }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .task { await panel.refresh() }
        // (All mods is for this look only: the tab opens on the site's mods next time)
        .onDisappear { if panel.showAll { panel.showAll = false; Task { await panel.refresh() } } }
        .onChange(of: browser.pageChanged) { _, _ in Task { await panel.refresh() } }
        .onReceive(SiteAccess.shared.$changes) { _ in Task { await panel.refresh() } }
        // (a sync started, finished or has news: the line, the list, Recently deleted)
        .onReceive(PhoneSyncModel.shared.objectWillChange) { _ in Task { await panel.refresh() } }
        .sheet(item: $panel.share) { s in ShareSheet(items: s.urls) }
    }
}


/// The Mods tab's ⋯ → Restore switches from before safe mode: each snapshot kept (Safety.snapshots), by when and
/// the sites; only while there is one.
struct RestoreSwitchesMenu: View {
    @ObservedObject var safety: Safety
    let restore: (String) -> Void

    var body: some View {
        if !safety.snapshots.isEmpty {
            Menu("Restore switches from before safe mode") {
                ForEach(safety.snapshots) { s in
                    Button(Safety.snapshotLabel(s)) { restore(s.id) }
                }
            }
        }
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
    /// `askPage`: ask the page which mods started and their errors (else the last answer for this page is used).
    /// `all`: every mod (the ⋯ menu's All mods), as no site's: each with its whole switch, nothing asked of a page.
    func modsState(askPage: Bool, all: Bool = false) async -> [String: Any] {
        let url = all ? "" : webView.url?.absoluteString ?? ""
        let site = all ? "" : self.site
        // (site access: a sensitive site is a site of its own: only the mods kept under it, never its parent's or every-site
        // mods, which never run there)
        let card = SiteAccess.shared.card(host)
        let listed = all ? mods.mods : card.sensitive ? mods.mods.filter { SiteAccess.shared.scope($0.site) == site } : mods.mods.filter { m in
            m.everywhere || SiteAccess.shared.scope(m.site) == site || m.sites.contains { SiteAccess.shared.scope($0) == site } || (!url.isEmpty && mods.applies(m, to: url))
        }
        // (a page TRIF isn't connected on is never asked anything: that would be a script in it)
        let askPage = askPage && (webView as? TabWebView)?.readable == true
        let ran: Set<String>, errors: [String: [String]]
        var askedAt: Date?
        if askPage {
            let asked = Date()
            ran = url.isEmpty ? [] : await ranHere()
            errors = await modErrorsById(listed)
            lastPageAnswer = (url, ran, errors, asked)
            askedAt = asked
            for (id, list) in errors where !list.isEmpty {  Diagnostics.shared.logOnce("mod error", "\(id) on \(Diagnostics.place(webView.url)): \(list.prefix(3).joined(separator: " | "))") }
        } else if !all, let last = lastPageAnswer, last.url == url {
            ran = last.ran; errors = last.errors; askedAt = last.at
        } else { ran = []; errors = [:] }
        // (the page's answer counts as the last word on which mods started only once it was asked a while after the
        // page finished loading: before that a mod switched on may simply not have started yet. Tim, 11-18: "Can't
        // run here on iPhone" flashed under each free mod he switched on, for a frame, before the page had loaded
        // with it)
        let tab = current
        let finished = loading ? nil : tab?.finishedAt
        let settled = finished.map { f in askedAt.map { $0.timeIntervalSince(f) >= Browser.startGrace } ?? false } ?? false
        var starting = false
        let rows: [[String: Any]] = listed.map { m in
            let applies = !url.isEmpty && mods.applies(m, to: url)
            let on = mods.isOn(m, site: all ? nil : site)
            let tierOff = mods.groupOff(m.tier, on: site)
            var row: [String: Any] = [
                "id": m.id, "name": m.name, "description": m.description, "tier": m.tier,
                "rules": m.tier == "style", "sandboxed": m.tier == "boxed",
                "powers": m.powers, "powerInfo": ["facts": m.facts.map { ["power": $0.power, "fact": $0.fact] }, "warnings": m.warnings],
                "matches": m.matches, "sites": m.sites, "site": m.site, "file": "\(m.id.split(separator: "/").last ?? "mod").js",
                // (`whole`: the mod's own switch, apart from its switch on this site; `everywhere`: an every-site mod,
                // in its own group on every site. All mods: one switch each, the whole one)
                "multi": m.multiSite && !all, "on": on, "whole": m.on, "everywhere": m.everywhere, "applies": applies, "running": ran.contains(m.id),
                "errors": errors[m.id] ?? [], "imported": m.source == "import", "history": m.history.count,
            ]
            if let r = m.risk { row["risk"] = ["tier": r.tier, "why": r.why ?? ""] }
            if let n = m.newOff { row["newOff"] = n }
            if m.held {
                var hold: [String: Any] = ["needs": m.waiting.map(\.key), "facts": m.waiting.map(\.fact), "asks": m.tier == "boxed",
                                           "by": m.source, "site": m.site, "hash": m.hash]
                // (the computer allowed this very version, asking nothing more: the card says so; Allow is the same Allow, D13)
                if mods.allowedOnComputer(m) { hold["allowedOn"] = PhoneSyncModel.shared.computerName ?? "your computer" }
                row[m.pending ? "pending" : "held"] = hold
            }
            // (one that should be running here and isn't said to be: switched on since this page loaded, so it starts at
            // the next load; or loaded with it and not settled yet: starting; or loaded with it, settled, and a free mod:
            // the page's own world wouldn't run it. Only that last is an error)
            if !all, on, !tierOff, !m.held, applies, !mods.paused, !ran.contains(m.id) {
                if !(tab?.modsLoadedIds.contains(m.id) ?? false) { row["nextLoad"] = true }
                else if !settled { row["starting"] = true; starting = true }
                else if m.tier == "free" { row["cant"] = true }
            }
            return row
        }
        modsStateSeq += 1
        let tiers = ["style": "rules", "boxed": "sandboxed", "free": "page"]
        return [
            "site": site, "host": all ? "" : host, "url": url, "loading": loading, "all": all, "rename": true,
            // (a rename: the open code card follows its mod to its new id)
            "renamed": renamedForPanel.map { ["from": $0.from, "to": $0.to] } ?? NSNull(),
            "mods": rows,
            "groupsOff": (mods.groupsOff[site] ?? []).compactMap { tiers[$0] },
            "hidden": all ? [] : report.rules.filter { $0.host == host }.map { ["id": $0.id.uuidString, "selector": $0.selector] },
            "deleted": mods.lastDeleted?.name ?? NSNull(),
            "sync": PhoneSyncModel.shared.line.map { ["line": $0, "syncing": PhoneSyncModel.shared.syncing, "notices": PhoneSyncModel.shared.notices] as [String: Any] } ?? NSNull(),
            "trash": mods.trash.map { ["entry": $0.id, "name": $0.mod.name, "site": $0.mod.everywhere ? "every site" : $0.mod.site] },
            "paused": mods.paused,
            "switchedOff": safety.switchedOff[site].map { ["why": $0.why, "ids": $0.ids] } ?? NSNull(),
            "seq": modsStateSeq,
            // (site access: whether TRIF is on here, and a sensitive site's line; the page shows Connect when it isn't)
            "access": all || url.isEmpty || !(webView.url?.scheme.map { ["http", "https"].contains($0.lowercased()) } ?? false) ? NSNull()
                : ["connected": connectedHere, "site": card.site, "line": SiteAccess.disconnectedLine(card.site),
                   "why": SiteAccess.sensitiveLine(card) ?? NSNull(), "sensitive": card.sensitive] as [String: Any],
            // (a mod still starting on a page that has loaded: ask the page again once the grace is over, so one that
            // really can't start says so then)
            "recheck": starting ? max(0.2, (finished?.addingTimeInterval(Browser.startGrace + 0.1).timeIntervalSinceNow ?? Browser.startGrace)) : NSNull(),
        ]
    }

    /// How long after its page finished loading a mod has to say it started before the Mods tab says it couldn't.
    static let startGrace: TimeInterval = 2
}
