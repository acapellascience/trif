// TRIF Probe (browser): a test app that asks what a TRIF made as its own iPhone browser could do.
// Not TRIF. See mobile/README.md for what each part is for and what to send back.

import SwiftUI
import UniformTypeIdentifiers
import UIKit

@main
struct TrifProbeApp: App {
    // (the app icon's long-press menu, Pause all mods: Safety.swift)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = Model()

    var body: some Scene {
        WindowGroup {
            ContentView(pane: model.pane, modsPanel: model.modsPanel, safety: model.browser.safety, store: model.browser.mods)
                .environmentObject(model.browser)
                .environmentObject(model.report)
                .tint(Color.trifGreen) // (every button and control TRIF's green, not iOS's blue: Tim, 11-14)
        }
    }
}

/// The app's three long-lived parts, made once, in order.
@MainActor
final class Model: ObservableObject {
    let report: Report
    let browser: Browser
    let pane: ClaudePane
    let modsPanel: ModsPanel

    init() {
        let report = Report()
        let browser = Browser(report: report)
        self.report = report
        self.browser = browser
        self.pane = ClaudePane(report: report, browser: browser)
        self.modsPanel = ModsPanel(browser: browser)
        // (Point TRIF at this: the chat opens, with the tab's data and then the part pointed at in its message box)
        let pane = self.pane
        browser.chatPoint = { text, png in pane.open { await pane.fill(text, png: png, picture: "TRIF pointer.png", as: "TRIF pointer.txt") } }
        // For the Simulator and CI: `-autorun plain,strict,…` (the probe's own pages, or full addresses) runs the
        // checks on each page in turn, as the Checks sheet's button does, and saves them in the report.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-autorun"), i + 1 < args.count {
            let pages = args[i + 1].split(separator: ",").map(String.init)
            Task { @MainActor in
                for page in pages {
                    browser.go(page.contains(":") ? page : PageSchemeHandler.home + (page.hasSuffix(".html") ? page : page + ".html"))
                    await browser.waitForLoad()
                    browser.running = true
                    report.add(await Checks(browser: browser).runAll())
                    browser.running = false
                }
                report.log("autorun", "done: \(pages.joined(separator: ","))")
            }
        }
        // (development) `-import /path/a.zip,/path/b.js`: those files imported as if opened from Files or AirDrop
        // (Import.swift), for the Simulator, where AirDrop can't be tried.
        if let i = args.firstIndex(of: "-import"), i + 1 < args.count {
            let paths = args[i + 1].split(separator: ",").map { URL(fileURLWithPath: String($0)) }
            Task { @MainActor in try? await Task.sleep(nanoseconds: 1_500_000_000); browser.importFiles(paths) }
        }
        // (development) steps, one at a time, for driving the app in the Simulator without touching it: write
        // Documents/step.json, then `xcrun simctl spawn <device> notifyutil -p com.trif.probe.step`. What a step's
        // script returns goes to Documents/step-out.txt. Steps: {"sheet": "mods|tabs|history|chat|none"},
        // {"modsjs": "…"} (in the Mods tab's page), {"pagejs": "…"} (in the shown tab's page), {"go": "…"},
        // {"newtab": "…"}, {"select": n}, {"close": n}, {"back": true}.
        let panel = self.modsPanel
        Model.pane = self.pane
        Model.stepRunner = { Task { @MainActor in await Model.runStep(browser: browser, panel: panel) } }
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in Model.stepRunner?() },
                                        "com.trif.probe.step" as CFString, nil, .deliverImmediately)
        // (development) `-go address`: the shown tab goes there at start.
        if let i = args.firstIndex(of: "-go"), i + 1 < args.count {
            let to = args[i + 1]
            Task { @MainActor in try? await Task.sleep(nanoseconds: 500_000_000); browser.go(to) }
        }
        // (development) `-open sheet`: a sheet open at start (mods, tabs, history), for screenshots in the Simulator.
        if let i = args.firstIndex(of: "-open"), i + 1 < args.count {
            let which = args[i + 1]
            Task { @MainActor in try? await Task.sleep(nanoseconds: 2_500_000_000); browser.wantsSheet = which }
        }
        // (development) `-dumpchat`: the chat's message box and what's around it, ten seconds after start, to
        // Documents/chat-dom.html (ClaudePane.dumpComposer).
        if args.contains("-dumpchat") {
            let pane = self.pane
            Task { @MainActor in try? await Task.sleep(nanoseconds: 1_000_000_000); browser.wantsChat = true; try? await Task.sleep(nanoseconds: 10_000_000_000); await pane.dumpComposer(); report.log("dumpchat", "done") }
        }
        // (development) `-shottest addr,addr`: each page's settled screenshot and whole-page PDF, as a mod's
        // follow-up would send them, saved to Documents (shot-N.png, page-N.pdf) instead of the chat.
        if let i = args.firstIndex(of: "-shottest"), i + 1 < args.count {
            let pages = args[i + 1].split(separator: ",").map(String.init)
            Task { @MainActor in
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                for (n, page) in pages.enumerated() {
                    browser.go(page)
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    let (png, blank) = await browser.settledScreenshot()
                    let pdf = await browser.fullPage()
                    try? png?.write(to: docs.appendingPathComponent("shot-\(n).png"))
                    try? pdf?.write(to: docs.appendingPathComponent("page-\(n).pdf"))
                    report.log("shottest", "\(page): blank \(blank), png \((png?.count ?? 0) / 1000) kB, pdf \((pdf?.count ?? 0) / 1000) kB")
                }
                report.log("shottest", "done")
            }
        }
    }
}

extension Model {
    static var stepRunner: (() -> Void)?
    static weak var pane: ClaudePane?

    static func runStep(browser: Browser, panel: ModsPanel) async {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        guard let data = try? Data(contentsOf: docs.appendingPathComponent("step.json")),
              let step = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var out = "ok"
        if let s = step["sheet"] as? String { browser.wantsSheet = s }
        if let js = step["modsjs"] as? String {
            do { out = "\(try await panel.webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        if let js = step["pagejs"] as? String {
            let r = await browser.call(js, in: .page)
            out = r.text ?? "error: \(r.error ?? "?")"
        }
        if let u = step["go"] as? String { browser.go(u) }
        if let u = step["newtab"] as? String { browser.newTab(u.isEmpty ? nil : u) }
        if let n = step["select"] as? Int, n < browser.tabs.count { browser.select(browser.tabs[n]) }
        if let n = step["close"] as? Int, n < browser.tabs.count { browser.close(browser.tabs[n]) }
        if step["back"] != nil { browser.back() }
        if let p = step["import"] as? String { browser.importFiles(p.split(separator: ",").map { URL(fileURLWithPath: String($0)) }) }
        if let t = step["offer"] as? String { browser.offer(text: t) }
        if step["cancelOffer"] != nil { browser.modOffer = nil }
        if step["bodies"] != nil { out = "\(Diagnostics.shared.bodies) bodies" }
        if step["addOffer"] != nil, let m = browser.modOffer { browser.modOffer = nil; browser.addMod(m) }
        if step["status"] != nil { out = browser.status }
        if step["chat"] != nil, let p = Model.pane { out = "shown: \(p.shown), activity: \(p.activity.rawValue), at: \(p.webView.url?.absoluteString ?? "nothing")" }
        if step["closechat"] != nil { Model.pane?.close() }
        if let p = step["pause"] as? Bool { browser.pauseAll(p) }
        if step["acceptOffer"] != nil, let o = browser.safety.offer { browser.safety.accept(o, only: nil, store: browser.mods); browser.modsChanged() }
        // ({"panego": "…"}: the chat pane loads an address; {"pane": 1}: its scrolling and size; {"panejs": "…"}: in its page)
        if let u = step["panego"] as? String, let url = URL(string: u) { Model.pane?.webView.load(URLRequest(url: url)) }
        if step["pane"] != nil, let sv = Model.pane?.webView.scrollView {
            out = "scrolls: \(sv.isScrollEnabled), content: \(Int(sv.contentSize.width))x\(Int(sv.contentSize.height)), pane: \(Int(sv.bounds.width))x\(Int(sv.bounds.height)), offset: \(Int(sv.contentOffset.y))"
        }
        if let js = step["panejs"] as? String, let wv = Model.pane?.webView {
            do { out = "\(try await wv.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        try? out.write(to: docs.appendingPathComponent("step-out.txt"), atomically: true, encoding: .utf8)
    }
}

struct ContentView: View {
    @EnvironmentObject var browser: Browser
    @EnvironmentObject var report: Report
    @ObservedObject var pane: ClaudePane
    @ObservedObject var modsPanel: ModsPanel
    @ObservedObject var safety: Safety
    @ObservedObject var store: ModStore
    @Environment(\.scenePhase) private var phase

    @State private var entry = ""
    @State private var showChecks = false
    @State private var showReport = false
    @State private var showTabs = false
    @State private var showHistory = false
    @State private var showMods = false
    @State private var importing = false
    @State private var asking = false
    @State private var question = ""
    @FocusState private var editing: Bool

    /// Mods waiting for the user's OK on this site (the Mods button's badge, as the panel's waiting badge).
    private var waitingHere: Int {
        browser.mods.mods.filter { $0.held && ($0.everywhere || Site.of($0.site) == browser.site || $0.sites.contains { Site.of($0) == browser.site }) }.count
    }

    var body: some View {
        let _ = Diagnostics.shared.bodyRan("the browser's main view")
        page
        .onChange(of: phase) { _, p in
            // (safe mode: the record is unclean only while the app is in front)
            browser.safety.active(p == .active)
            if p != .active { browser.saveTabs(); browser.history.saveNow() }
        }
        .alert(item: $safety.offer) { o in
            let name = o.likely.flatMap { id in browser.mods.mods.first { $0.id == id }?.name }
            return Alert(title: Text("\(o.site) keeps this iPhone busy"),
                         message: Text(o.why == "ended" ? "Its page stopped twice in three minutes while mods ran on it. Switch them off?" : "Its page has been busy most of the time for 40 seconds while mods ran on it. Switch them off?\(name.map { " \($0) changed most recently." } ?? "")"),
                         primaryButton: .destructive(Text("Switch off its mods")) { browser.safety.accept(o, only: nil, store: browser.mods); browser.modsChanged() },
                         secondaryButton: .cancel(Text("Not now")) { browser.safety.offer = nil })
        }
    }

    // (the room is the space the app is offered, read by a GeometryReader around everything, and nothing in it is
    // sized from what's inside it: before 11-15 a chat pane was sized from the column, which grew with the pane, a
    // layout that never settled while the keyboard was up (the app at 50% CPU, then ended by iOS: Tim's iPhone SE).
    // The chat is full screen now, one layer, the tab the other; the chat's layer is always there, behind the tab
    // while hidden, so its page keeps running and a reply goes on being written and watched.)
    private var page: some View {
        GeometryReader { geo in
            ZStack {
                ChatScreen(pane: pane, tabName: browser.site.isEmpty ? "Tab" : browser.site)
                    .zIndex(pane.shown ? 1 : 0)
                    .allowsHitTesting(pane.shown)
                    .accessibilityHidden(!pane.shown)
                column
                    .background(Color(.systemBackground))
                    .zIndex(pane.shown ? 0 : 1)
                    .allowsHitTesting(!pane.shown)
                    .accessibilityHidden(pane.shown)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
        }
    }

    private var column: some View {
        VStack(spacing: 0) {
            addressBar
            ZStack {
                WebViewHost(webView: browser.webView).id(browser.current.id)
                if browser.current.webView.url == nil && !browser.loading {
                    NewTabView(history: browser.history)
                }
            }
            if let picked = browser.picked { PickedBar(picked: picked) }
            if let h = browser.lastHide {
                HStack {
                    Text("Hidden: \(h.selector)").font(.footnote.monospaced()).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Undo") { Task { await browser.unhide(h) } }.font(.footnote.bold())
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color(.secondarySystemBackground))
            }
            if let off = safety.switchedOff[browser.site] {
                SafetyBanner(site: browser.site, off: off, open: { showMods = true }, dismiss: { browser.safety.dismiss(site: browser.site) })
            }
            if !browser.status.isEmpty {
                HStack(alignment: .top) {
                    Text(browser.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    Button { browser.status = "" } label: { Image(systemName: "xmark").font(.caption) }
                        .accessibilityLabel("Dismiss")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color(.secondarySystemBackground))
            }
            Divider()
            toolbar
        }
        .onAppear { entry = browser.address; pane.follow(site: browser.site) }
        .onChange(of: browser.address) { _, new in if !editing { entry = new }; pane.follow(site: browser.site) }
        .onChange(of: browser.pageChanged) { _, _ in if !editing { entry = browser.address }; pane.follow(site: browser.site) }
        .onChange(of: browser.wantsChat) { _, want in if want { pane.open(); browser.wantsChat = false } }
        .onChange(of: browser.hideChat) { _, _ in pane.close() }
        // (the next of a reply's mods once the Mods tab, opened for one that waits for an OK, has closed)
        .onChange(of: showMods) { _, open in if !open { browser.holdFromChat = false; nextOfferSoon() } }
        .onChange(of: modsPanel.wantsClose) { _, want in if want { showMods = false; modsPanel.wantsClose = false } }
        .onChange(of: browser.wantsMods) { _, want in if want { showMods = true; browser.wantsMods = false } }
        .onChange(of: browser.wantsAddress) { _, want in if want { entry = ""; editing = true; browser.wantsAddress = false } }
        .onChange(of: browser.wantsSheet) { _, which in
            switch which {
            case "mods": showMods = true
            case "tabs": browser.snapshot(); showTabs = true
            case "history": showHistory = true
            case "chat": pane.open()
            case "import": importing = true
            case "none": showMods = false; showTabs = false; showHistory = false; pane.close(); showChecks = false; showReport = false
            default: break
            }
            browser.wantsSheet = ""
        }
        .onChange(of: modsPanel.wantsImport) { _, want in if want { showMods = false; importing = true; modsPanel.wantsImport = false } }
        .onOpenURL { url in if url.isFileURL { browser.importFiles([url]); try? FileManager.default.removeItem(at: url) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.javaScript, .zip, .folder, .json], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { browser.importFiles(urls) }
        }
        .sheet(isPresented: $showChecks) { ChecksView().environmentObject(browser).environmentObject(report) }
        .sheet(isPresented: $showReport) { ReportView().environmentObject(report) }
        .sheet(isPresented: $showTabs) { TabsView().environmentObject(browser) }
        .sheet(isPresented: $showHistory) { HistoryView(history: browser.history).environmentObject(browser) }
        .sheet(isPresented: $showMods) {
            ModsPanelView(panel: modsPanel).environmentObject(browser)
                .presentationDetents([.medium, .large], selection: .constant(.large))
        }
        .sheet(item: $browser.modLink) { link in ModLinkView(link: link).environmentObject(browser) }
        .sheet(item: $browser.modOffer, onDismiss: nextOfferSoon) { mod in ModOfferView(mod: mod).environmentObject(browser) }
        .alert("What bothers you on this page?", isPresented: $asking) {
            TextField("the cookie notice", text: $question)
            Button("Ask the phone") { let q = question; Task { await browser.askPhone(q) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The phone's own model gets the page's outline and your words, and picks a part. Nothing leaves the phone.")
        }
    }

    /// A reply's next mod, a moment after a sheet has gone (one sheet can't open while another is closing), unless the
    /// Mods tab has opened meanwhile (a mod just added that waits for an OK): then once it closes.
    private func nextOfferSoon() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if !showMods { browser.nextOffer() }
        }
    }

    private var addressBar: some View {
        HStack(spacing: 8) {
            TextField("Search or type an address", text: $entry)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($editing)
                .submitLabel(.go)
                .onSubmit { browser.go(entry) }
            if browser.loading {
                Button { browser.webView.stopLoading() } label: { Image(systemName: "xmark") }.accessibilityLabel("Stop")
            } else {
                Button { browser.reload() } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Reload")
                    .disabled(browser.webView.url == nil)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private var toolbar: some View {
        HStack {
            Button { browser.back() } label: { Image(systemName: "chevron.left") }.disabled(!browser.canGoBack).accessibilityLabel("Back")
            Spacer()
            Button { browser.forward() } label: { Image(systemName: "chevron.right") }.disabled(!browser.canGoForward).accessibilityLabel("Forward")
            Spacer()
            Button { pane.open() } label: { ChatGlyph(activity: pane.activity).frame(width: 28, height: 24) }
                .accessibilityLabel(pane.activity == .working ? "Chat, writing a reply" : pane.activity == .replied ? "Chat, replied" : "Chat")
            Spacer()
            Button { showMods = true } label: {
                RobotGlyph(paused: store.paused).frame(width: 24, height: 24)
                    .overlay(alignment: .topTrailing) {
                        if waitingHere > 0 {
                            Text("\(waitingHere)").font(.caption2.bold()).foregroundStyle(.black)
                                .padding(.horizontal, 4).background(Capsule().fill(Color.trifYellow)).offset(x: 8, y: -6)
                        }
                    }
            }
            .accessibilityLabel(store.paused ? "Mods, all paused" : waitingHere > 0 ? "Mods, \(waitingHere) waiting for your OK" : "Mods")
            Spacer()
            Button { browser.snapshot(); showTabs = true } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(lineWidth: 1.8).frame(width: 22, height: 22)
                    Text("\(browser.tabs.count)").font(.system(size: 12, weight: .semibold))
                }
            }
            .accessibilityLabel("Tabs, \(browser.tabs.count) open")
            Spacer()
            Menu {
                Button { browser.newTab() } label: { Label("New tab", systemImage: "plus.square.on.square") }
                Button { showHistory = true } label: { Label("History", systemImage: "clock") }
                Button { importing = true } label: { Label("Import…", systemImage: "square.and.arrow.down") }
                Divider()
                Button("Copy this page for the chat") { Task { await browser.copyOutline() } }
                Button("Add a mod from the clipboard") { browser.offerFromClipboard() }
                Button("Ask the phone's own model…") { question = ""; asking = true }
                Button("Show everything hidden on this site again", role: .destructive) { Task { await browser.forgetRulesHere() } }
                Divider()
                Menu("The probe") {
                    Button("Checks") { showChecks = true }
                    Button("Report") { showReport = true }
                    Section("The probe's own pages") {
                        ForEach(browser.pages.pageNames, id: \.self) { name in
                            Button(name) { browser.go(PageSchemeHandler.home + name) }
                        }
                        Button("a mod link") { browser.go(PageSchemeHandler.home + "trif-install#hide=.cookie-consent") }
                    }
                    Section("Real sites") {
                        ForEach(["github.com", "x.com", "youtube.com", "reddit.com", "en.wikipedia.org", "nytimes.com"], id: \.self) { site in
                            Button(site) { browser.go(site) }
                        }
                    }
                }
            } label: { Image(systemName: "ellipsis.circle") }
            .accessibilityLabel("More")
        }
        .font(.title3)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }
}

/// The robot as the toolbar's Mods button (docs/STYLE.md: one colour, its frame and eyes alike): a squircle head
/// and two round eyes, in the button's colour.
struct RobotGlyph: View {
    /// All mods paused: two bars for eyes (docs/STYLE.md's paused face).
    var paused = false
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: s * 0.3, style: .continuous).stroke(lineWidth: s * 0.09)
                HStack(spacing: s * 0.2) {
                    if paused {
                        RoundedRectangle(cornerRadius: s * 0.04).frame(width: s * 0.13, height: s * 0.36)
                        RoundedRectangle(cornerRadius: s * 0.04).frame(width: s * 0.13, height: s * 0.36)
                    } else {
                        Circle().frame(width: s * 0.2, height: s * 0.2)
                        Circle().frame(width: s * 0.2, height: s * 0.2)
                    }
                }
            }
            .frame(width: s, height: s)
        }
    }
}

/// What a long press chose, and what to do with it.
struct PickedBar: View {
    @EnvironmentObject var browser: Browser
    let picked: Picked

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(picked.text.isEmpty ? "<\(picked.tag)>" : "“\(picked.text)”").font(.subheadline).lineLimit(2)
            Text("\(picked.selector)  (named by \(picked.how)\(picked.matches == 1 ? "" : ", finds \(picked.matches)"))")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack {
                Button("Hide this") { Task { await browser.hide(picked.selector, how: picked.how, from: picked.from) } }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                if let similar = picked.similarSelector, picked.similarCount > 1 {
                    Button("All \(picked.similarCount) like it") { Task { await browser.hide(similar, how: picked.how, from: picked.from) } }
                        .buttonStyle(.bordered)
                }
                Button("Wider") { Task { await browser.widen() } }.buttonStyle(.bordered)
                Spacer()
                Button("Cancel") { Task { await browser.cancelPick() } }
            }
            .font(.subheadline)
            Button("Point TRIF at this") { Task { await browser.pointToChat() } }
                .buttonStyle(.bordered)
                .font(.subheadline)
            // (the element's own name, site-wide: outlined first, then hidden: Tim, 11-14)
            if let all = picked.everywhereSelector {
                Group {
                    if browser.previewing {
                        Button("Hide them") { Task { await browser.hide(all, how: "everywhere", from: picked.from) } }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                    } else {
                        Button("Everywhere on \(browser.host) (\(picked.everywhereCount) here)") { Task { await browser.previewEverywhere() } }
                            .buttonStyle(.bordered)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .font(.subheadline)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
    }
}

/// A mod link the browser stopped: what it would do, before it does anything.
struct ModLinkView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    let link: ModLink

    var body: some View {
        NavigationStack {
            List {
                Section("A mod, from \(link.source)") {
                    Text(link.address).font(.footnote.monospaced())
                }
                if link.hide.isEmpty {
                    Section { Text("This link carries nothing the probe knows how to add. (It reads #hide=selector.)") }
                } else {
                    Section("It would hide, on \(browser.host)") {
                        ForEach(link.hide, id: \.self) { selector in Text(selector).font(.footnote.monospaced()) }
                    }
                    Section {
                        Button("Show me first") {
                            let first = link.hide[0]
                            Task { _ = await browser.mark(selector: first, from: "a mod link") }
                            dismiss()
                        }
                        Button("Add it") {
                            browser.hideChat += 1
                            let selectors = link.hide
                            Task { for s in selectors { await browser.hide(s, how: "given", from: "a mod link") } }
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("Add this mod?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Don't") { dismiss() } } }
        }
    }
}

struct ResultRow: View {
    let result: CheckResult

    private var color: Color {
        switch result.answer {
        case "yes": return .green
        case "no", "error": return .red
        case "some": return .orange
        default: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(result.answer).bold().foregroundStyle(color).frame(width: 46, alignment: .leading)
                Text(result.title)
            }
            .font(.subheadline)
            Text(result.detail).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
        }
    }
}

struct RunView: View {
    let run: CheckRun

    var body: some View {
        let groups = Dictionary(grouping: run.results, by: { $0.group })
        let order = run.results.map { $0.group }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        ForEach(order, id: \.self) { group in
            Section(group) {
                ForEach(groups[group] ?? []) { result in ResultRow(result: result) }
            }
        }
    }
}

struct ChecksView: View {
    @EnvironmentObject var browser: Browser
    @EnvironmentObject var report: Report
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(browser.running ? "Running: about twenty seconds…" : "Run the checks on this page") {
                        Task {
                            browser.running = true
                            let run = await Checks(browser: browser).runAll()
                            report.add(run)
                            browser.running = false
                        }
                    }
                    .disabled(browser.running)
                    Text(browser.address).font(.footnote).foregroundStyle(.secondary)
                } footer: {
                    Text("The last two checks reload the page. Run them on each of the probe's own pages, then on a few real sites.")
                }
                if let last = report.runs.last {
                    Section { Text("Last run: \(last.url)").font(.footnote) }
                    RunView(run: last)
                }
            }
            .navigationTitle("Checks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct ReportView: View {
    @EnvironmentObject var report: Report
    @Environment(\.dismiss) private var dismiss

    private func count(_ kind: String) -> Int { report.events.filter { $0.kind == kind }.count }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ShareLink("Share the report", item: report.json())
                    Button("Copy the report") { UIPasteboard.general.string = report.json() }
                    Button("Clear everything recorded", role: .destructive) { report.clear() }
                } footer: {
                    Text("Everything the probe has recorded on this device. It names the sites you ran it on, and nothing from inside Claude's pane except which addresses it went to. Nothing is sent anywhere: share it yourself.")
                }
                Section("So far") {
                    Text("\(report.runs.count) run(s) of the checks")
                    Text("\(report.rules.count) thing(s) hidden")
                    Text("\(count("load")) page load(s) timed")
                    Text("\(count("mod link")) mod link(s) stopped")
                    Text("\(count("on-device")) question(s) to the phone's model")
                }
                Section("What happened, newest first") {
                    ForEach(Array(report.events.reversed().prefix(60))) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.kind).font(.caption).bold()
                            Text(event.text).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(6)
                        }
                    }
                }
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

extension Color {
    /// The panel's yellow and coral (--led-yellow, --led-coral): boxed mods and free mods.
    static let trifYellow = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0xe8 / 255, green: 0xc5 / 255, blue: 0x47 / 255, alpha: 1)
        : UIColor(red: 0x9a / 255, green: 0x73 / 255, blue: 0x00 / 255, alpha: 1) })
    static let trifCoral = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0xf0 / 255, green: 0x86 / 255, blue: 0x6a / 255, alpha: 1)
        : UIColor(red: 0xc2 / 255, green: 0x51 / 255, blue: 0x2d / 255, alpha: 1) })
    /// TRIF's green, as the panel has it (--led-green): the robot's own on dark, a darker one on light, so
    /// text in it stays readable.
    static let trifGreen = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255, alpha: 1)
        : UIColor(red: 0x1f / 255, green: 0x8a / 255, blue: 0x5b / 255, alpha: 1) })
}
