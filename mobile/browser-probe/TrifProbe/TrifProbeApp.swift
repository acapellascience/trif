// TRIF Probe (browser): a test app that asks what a TRIF made as its own iPhone browser could do.
// Not TRIF. See mobile/README.md for what each part is for and what to send back.

import SwiftUI
import UniformTypeIdentifiers
import UIKit
import WebKit

@main
struct TrifProbeApp: App {
    // (the app icon's long-press menu, Pause all mods: Safety.swift)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = Model()

    var body: some Scene {
        WindowGroup {
            ContentView(pane: model.pane, modsPanel: model.modsPanel, safety: model.browser.safety, store: model.browser.mods, bars: model.bars)
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
    /// The address bar and toolbar's state as the page scrolls (BarState): its own object, so only the bars redraw.
    let bars = BarState()

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
    /// (not observed here: only the bars follow it, as the page scrolls)
    let bars: BarState
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
                // (the chat leaves the toolbar showing under it, so the chat button is where it was, to go back: Tim,
                // 11-15, "sometimes you hit it by accident and you just wanna go back")
                ChatScreen(pane: pane, tabName: browser.site.isEmpty ? "Tab" : browser.site)
                    .modifier(ToolbarRoom(insets: bars.insets))
                    .zIndex(pane.shown ? 1 : 0)
                    .allowsHitTesting(pane.shown)
                    .accessibilityHidden(!pane.shown)
                column
                    .background(Color(.systemBackground))
                    .zIndex(pane.shown ? 0 : 1)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
        }
    }

    // (the page reaches from under the compact address bar to the foot; the bars lie over it, the address bar
    // growing and shrinking and the toolbar sliding away as the page scrolls (BarState), so the page is never
    // resized while that happens: what's under the bars is told to the page once they settle. iOS 26 and later;
    // before that the bars stay full and the page sits between them.)
    private var column: some View {
        ZStack(alignment: .top) {
            ZStack(alignment: .top) {
                WebViewHost(webView: browser.webView).id(browser.current.id)
                if browser.current.webView.url == nil && !browser.loading {
                    NewTabView(history: browser.history).modifier(BarPadding(bars: bars, top: true, bottom: true))
                }
            }
            .modifier(BarPadding(bars: bars, top: !BarState.moves, bottom: !BarState.moves))
            .padding(.top, BarState.compactHeight)
            .accessibilityHidden(pane.shown)
            TopBar(bars: bars, full: addressBar, compact: compactBar)
                .accessibilityHidden(pane.shown)
            BottomBars(bars: bars) {
                // (the notes over the page's foot, above the bars: they come and go without moving anything)
                notes
            } bars: {
                VStack(spacing: 0) {
                    if let picked = browser.picked { PickedBar(picked: picked) }
                    if let off = safety.switchedOff[browser.site] {
                        SafetyBanner(site: browser.site, off: off, open: { showMods = true }, dismiss: { browser.safety.dismiss(site: browser.site) })
                    }
                }
            } toolbar: {
                VStack(spacing: 0) {
                    Divider()
                    toolbar
                }
                .background(.bar)
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .onAppear { entry = browser.address; pane.follow(site: browser.site); bars.attach(browser.webView) }
        .onChange(of: browser.address) { _, new in if !editing { entry = new }; pane.follow(site: browser.site) }
        .onChange(of: browser.pageChanged) { _, _ in if !editing { entry = browser.address }; pane.follow(site: browser.site); bars.attach(browser.webView) }
        .onChange(of: browser.loading) { _, now in if now { bars.expand() } }
        .onChange(of: editing) { _, now in bars.hold(now || pane.shown) }
        .onChange(of: pane.shown) { _, now in bars.hold(now || editing) }
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

    /// The small notes at the foot of the page (Tim, 11-15: closing each by hand was annoying): each goes by itself,
    /// fading out, after 2 seconds, or 5 when it has a button (Undo); a tap sends it sooner. What they report
    /// that matters stays where it already is (a mod's errors on its row and in diagnostics).
    private var notes: some View {
        VStack(spacing: 0) {
            if let h = browser.lastHide {
                HStack {
                    Text("Hidden: \(h.selector)").font(.footnote.monospaced()).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Undo") { Task { await browser.unhide(h) } }.font(.footnote.bold())
                }
                .modifier(NoteStyle(seconds: 5, key: h.id.uuidString) { if browser.lastHide?.id == h.id { browser.lastHide = nil } })
            }
            if !browser.status.isEmpty {
                Text(browser.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    .modifier(NoteStyle(seconds: 2, key: browser.status) { browser.status = "" })
            }
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

    /// The address bar when the page has been scrolled down: the site, small; tap to bring the bars back. The chat's
    /// robot comes along while a reply is being written or waits (the toolbar is away then).
    private var compactBar: some View {
        HStack(spacing: 6) {
            if browser.webView.url?.scheme == "https" { Image(systemName: "lock.fill").font(.system(size: 9)) }
            Text(browser.host.hasPrefix("www.") ? String(browser.host.dropFirst(4)) : browser.host.isEmpty ? "New tab" : browser.host)
                .font(.footnote.weight(.medium))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .trailing) {
            if pane.activity != .idle {
                Button { pane.open() } label: { ChatGlyph(activity: pane.activity).frame(width: 18, height: 18) }
                    .padding(.trailing, 14)
                    .accessibilityLabel(pane.activity == .working ? "Chat, writing a reply" : "Chat, replied")
            }
        }
        .accessibilityElement(children: .contain)
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

    /// Back and forward's accessibility label while the chat is open (as the chat's own ‹ {site}).
    private var backToTab: String { "Back to \(browser.site.isEmpty ? "Tab" : browser.site)" }

    /// A toolbar button while the chat is open: back to the tab first, then its job there.
    private func onTab(_ job: () -> Void) {
        pane.close()
        job()
    }

    private var toolbar: some View {
        HStack {
            // (with the chat open, back and forward only close it, back to the page as it was: Tim, 11-15, "that's
            // the behaviour people will expect")
            Button { if pane.shown { pane.close() } else { browser.back() } } label: { Image(systemName: "chevron.left") }
                .disabled(!pane.shown && !browser.canGoBack)
                .accessibilityLabel(pane.shown ? backToTab : "Back")
            Spacer()
            Button { if pane.shown { pane.close() } else { browser.forward() } } label: { Image(systemName: "chevron.right") }
                .disabled(!pane.shown && !browser.canGoForward)
                .accessibilityLabel(pane.shown ? backToTab : "Forward")
            Spacer()
            // (the same button opens the chat and, while it's open (shown selected), goes back to the tab)
            Button { if pane.shown { pane.close() } else { pane.open() } } label: {
                ChatGlyph(activity: pane.activity).frame(width: 24, height: 24)
                    .padding(5)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.trifGreen.opacity(pane.shown ? 0.2 : 0)))
                    .padding(-5)
            }
            .accessibilityLabel(pane.activity == .working ? "Chat, writing a reply" : pane.activity == .replied ? "Chat, replied" : "Chat")
            .accessibilityAddTraits(pane.shown ? .isSelected : [])
            Spacer()
            // (the mods' button is a switch, on or, with all paused, off: Tim, 11-15; the robot is the chat's now)
            Button { onTab { showMods = true } } label: {
                SwitchGlyph(on: !store.paused).frame(width: 30, height: 24)
                    .overlay(alignment: .topTrailing) {
                        if waitingHere > 0 {
                            Text("\(waitingHere)").font(.caption2.bold()).foregroundStyle(.black)
                                .padding(.horizontal, 4).background(Capsule().fill(Color.trifYellow)).offset(x: 8, y: -6)
                        }
                    }
            }
            .accessibilityLabel(store.paused ? "Mods, all paused" : waitingHere > 0 ? "Mods, \(waitingHere) waiting for your OK" : "Mods")
            Spacer()
            Button { onTab { browser.snapshot(); showTabs = true } } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(lineWidth: 1.8).frame(width: 22, height: 22)
                    Text("\(browser.tabs.count)").font(.system(size: 12, weight: .semibold))
                }
            }
            .accessibilityLabel("Tabs, \(browser.tabs.count) open")
            Spacer()
            Menu {
                Button { onTab { browser.newTab() } } label: { Label("New tab", systemImage: "plus.square.on.square") }
                Button { onTab { showHistory = true } } label: { Label("History", systemImage: "clock") }
                Button { onTab { importing = true } } label: { Label("Import…", systemImage: "square.and.arrow.down") }
                Divider()
                Button("Copy this page for the chat") { onTab { Task { await browser.copyOutline() } } }
                Button("Add a mod from the clipboard") { onTab { browser.offerFromClipboard() } }
                Button("Ask the phone's own model…") { onTab { question = ""; asking = true } }
                Button("Show everything hidden on this site again", role: .destructive) { onTab { Task { await browser.forgetRulesHere() } } }
                Divider()
                Menu("The probe") {
                    Button("Checks") { onTab { showChecks = true } }
                    Button("Report") { onTab { showReport = true } }
                    Section("The probe's own pages") {
                        ForEach(browser.pages.pageNames, id: \.self) { name in
                            Button(name) { onTab { browser.go(PageSchemeHandler.home + name) } }
                        }
                        Button("a mod link") { onTab { browser.go(PageSchemeHandler.home + "trif-install#hide=.cookie-consent") } }
                    }
                    Section("Real sites") {
                        ForEach(["github.com", "x.com", "youtube.com", "reddit.com", "en.wikipedia.org", "nytimes.com"], id: \.self) { site in
                            Button(site) { onTab { browser.go(site) } }
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

/// The robot (docs/STYLE.md: one colour, its frame and eyes alike): a squircle head and two round eyes, in the
/// button's colour. The toolbar's chat button (Tim, 11-15); while a reply is being written its eyes are three
/// dots, lighting up one after another.
struct RobotGlyph: View {
    /// All mods paused: two bars for eyes (docs/STYLE.md's paused face).
    var paused = false
    var working = false
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: s * 0.3, style: .continuous).stroke(lineWidth: s * 0.09)
                if working {
                    PhaseAnimator([0, 1, 2]) { lit in
                        HStack(spacing: s * 0.08) {
                            ForEach(0..<3, id: \.self) { i in Circle().frame(width: s * 0.15, height: s * 0.15).opacity(i == lit ? 1 : 0.3) }
                        }
                    } animation: { _ in .easeInOut(duration: 0.3) }
                } else {
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
            }
            .frame(width: s, height: s)
        }
    }
}

/// A switch, as the toolbar's Mods button: on (its knob right, filled), or off with every mod paused (knob left).
struct SwitchGlyph: View {
    var on = true
    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = min(g.size.height, w * 0.6)
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().stroke(lineWidth: max(1.5, h * 0.12))
                Group {
                    if on { Circle().fill() } else { Circle().stroke(lineWidth: max(1.5, h * 0.12)) }
                }
                .frame(width: h * 0.56, height: h * 0.56)
                .padding(.horizontal, h * 0.22)
            }
            .frame(width: w, height: h)
            .frame(width: w, height: g.size.height)
        }
    }
}

/// A note at the foot of the page: its look, and its going by itself `seconds` after it shows (or after its text
/// changes: `key`), fading out; a tap sends it at once. (With VoiceOver on it stays 10 seconds, to be read.)
struct NoteStyle: ViewModifier {
    let seconds: Double
    let key: String
    let dismiss: () -> Void

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground))
            .overlay(alignment: .top) { Divider() }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(.easeOut(duration: 0.3)) { dismiss() } }
            .transition(.opacity)
            .task(id: key) {
                let wait = UIAccessibility.isVoiceOverRunning ? max(seconds, 10) : seconds
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.3)) { dismiss() }
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

// MARK: the bars as the page scrolls (Tim, 11-15: "a little more dynamism … like chrome mobile")

/// The address bar and the toolbar following the page's scrolling, as Chrome's and Safari's do on iPhone: scrolling
/// down shrinks the address bar to a small line with the site (no buttons) and slides the toolbar away; scrolling up,
/// reaching the top, a tap on the small line, or a page starting to load brings both back. They move with the finger
/// (`progress`, 0 full to 1 compact), and settle fully one way or the other when it lets go.
/// The page isn't resized meanwhile: it lies under the bars, and what they cover is told to it (WKWebView's
/// obscuredContentInsets, iOS 26) once, when they've settled, so its fixed headers and footers stay clear of them.
/// Before iOS 26 the bars stay full and the page sits between them (`moves` false).
/// Its own object: per-frame changes redraw the two bars, not the app's main view.
@MainActor
final class BarState: NSObject, ObservableObject {
    static let compactHeight: CGFloat = 26
    static var moves: Bool { if #available(iOS 26, *) { return true } else { return false } }

    @Published private(set) var progress: CGFloat = 0
    @Published private(set) var loading = false
    @Published private(set) var loaded: Double = 0
    /// How much taller the full address bar is than the compact one.
    @Published private(set) var extra: CGFloat = 30
    /// The toolbar's height (what slides away), and the whole bottom block's (the toolbar and the bars over it).
    @Published private(set) var toolbarHeight: CGFloat = 50
    private var bottomHeight: CGFloat = 50
    /// The full bars' room, for a page under them before iOS 26, and the new-tab page (BarPadding).
    let insets = BarInsets()

    private weak var webView: WKWebView?
    private var watches: [NSKeyValueObservation] = []
    private var lastY: CGFloat = 0
    private var held = false
    private var settleTask: Task<Void, Never>?

    func measured(full: CGFloat) {
        let e = max(full - BarState.compactHeight, 0)
        guard abs(e - extra) > 0.5 else { return }
        extra = e
        applyInsets()
    }
    func measured(toolbar: CGFloat) {
        guard abs(toolbar - toolbarHeight) > 0.5 else { return }
        toolbarHeight = toolbar
        insets.set(toolbar: toolbar)
        applyInsets()
    }
    func measured(bottom: CGFloat) {
        guard abs(bottom - bottomHeight) > 0.5 else { return }
        bottomHeight = bottom
        applyInsets()
    }

    /// Follows the shown tab's web view (a tab switch, a page loaded).
    func attach(_ wv: WKWebView) {
        guard wv !== webView else { return }
        webView?.scrollView.panGestureRecognizer.removeTarget(self, action: #selector(panned(_:)))
        webView = wv
        let sv = wv.scrollView
        lastY = sv.contentOffset.y
        loading = wv.isLoading
        loaded = wv.estimatedProgress
        let main = { (f: @escaping @MainActor () -> Void) in if Thread.isMainThread { MainActor.assumeIsolated(f) } else { Task { @MainActor in f() } } }
        watches = [
            sv.observe(\.contentOffset, options: [.new]) { [weak self] sv, _ in main { self?.scrolled(sv) } },
            wv.observe(\.estimatedProgress, options: [.new]) { [weak self] w, _ in main { self?.loaded = w.estimatedProgress } },
            wv.observe(\.isLoading, options: [.new]) { [weak self] w, _ in main { self?.loading = w.isLoading } },
        ]
        sv.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
        settleTask?.cancel()
        progress = 0
        applyInsets()
    }

    /// The bars full again (a load starting, the address being typed, a tap on the small line).
    func expand() { settle(to: 0) }
    /// While the address is being typed, the bars stay full.
    func hold(_ h: Bool) { held = h; if h { expand() } }

    private func scrolled(_ sv: UIScrollView) {
        let y = sv.contentOffset.y
        defer { lastY = y }
        guard BarState.moves, !held else { return }
        let top = -sv.adjustedContentInset.top
        // (a page with little or nothing to scroll keeps its bars)
        if sv.contentSize.height < sv.bounds.height + 120 { if progress != 0 { settle(to: 0) }; return }
        // (at the top, or pulled down past it: full)
        if y <= top + 1 { if progress != 0 { if sv.isTracking { progress = 0 } else { settle(to: 0) } }; return }
        // (only the person's own scrolling: not a page scrolling itself, not the bounce at the bottom)
        guard sv.isTracking || sv.isDecelerating else { return }
        if y >= sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom - 1 { return }
        let p = min(max(progress + (y - lastY) / max(toolbarHeight, 44), 0), 1)
        if p != progress { progress = p }
        if !sv.isTracking { settleSoon() }
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        if g.state == .ended || g.state == .cancelled || g.state == .failed { settleSoon() }
    }

    /// Once the finger is off and the page has stopped moving: fully one way or the other.
    private func settleSoon() {
        settleTask?.cancel()
        settleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard let self, !Task.isCancelled, let sv = self.webView?.scrollView, !sv.isTracking else { return }
            if sv.isDecelerating { self.settleSoon(); return }
            self.settle(to: self.progress > 0.5 ? 1 : 0)
        }
    }

    private func settle(to target: CGFloat) {
        settleTask?.cancel()
        if progress != target { withAnimation(.easeOut(duration: 0.22)) { progress = target } }
        applyInsets()
    }

    /// What the settled bars cover, told to the page (only when it changes: each change lays the page out again).
    private func applyInsets() {
        insets.set(top: extra, bottom: bottomHeight)
        guard let wv = webView else { return }
        if #available(iOS 26, *) {
            let p: CGFloat = progress >= 0.5 ? 1 : 0
            let e = UIEdgeInsets(top: extra * (1 - p), left: 0, bottom: max(bottomHeight - toolbarHeight * p, 0), right: 0)
            if wv.obscuredContentInsets != e { wv.obscuredContentInsets = e }
        }
    }
}

/// The full bars' room (changes only when a bar's size does).
@MainActor
final class BarInsets: ObservableObject {
    @Published private(set) var top: CGFloat = 0
    @Published private(set) var bottom: CGFloat = 0
    @Published private(set) var toolbar: CGFloat = 50
    func set(toolbar t: CGFloat) { if abs(t - toolbar) > 0.5 { toolbar = t } }
    func set(top t: CGFloat, bottom b: CGFloat) {
        if abs(t - top) > 0.5 { top = t }
        if abs(b - bottom) > 0.5 { bottom = b }
    }
}

/// Room at the foot for the toolbar (the open chat leaves it showing).
struct ToolbarRoom: ViewModifier {
    @ObservedObject var insets: BarInsets
    func body(content: Content) -> some View { content.padding(.bottom, insets.toolbar) }
}

/// Room for the full bars around something that lies under them.
struct BarPadding: ViewModifier {
    @ObservedObject var insets: BarInsets
    let top: Bool, bottom: Bool
    init(bars: BarState, top: Bool, bottom: Bool) { insets = bars.insets; self.top = top; self.bottom = bottom }
    func body(content: Content) -> some View {
        content.padding(.top, top ? insets.top : 0).padding(.bottom, bottom ? insets.bottom : 0)
    }
}

/// The address bar: full (the address field, reload) or, scrolled down, a small line (the site); between the two as
/// the page moves. A thin green line under it while a page loads.
struct TopBar<Full: View, Compact: View>: View {
    @ObservedObject var bars: BarState
    let full: Full
    let compact: Compact

    var body: some View {
        let p = bars.progress
        ZStack(alignment: .top) {
            full
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bars.measured(full: $0) }
                .scaleEffect(1 - 0.15 * p, anchor: .top)
                .opacity(Double(max(0, 1 - p * 1.8)))
                .allowsHitTesting(p < 0.5)
                .accessibilityHidden(p >= 0.5)
            compact
                .frame(height: BarState.compactHeight)
                .contentShape(Rectangle())
                .onTapGesture { bars.expand() }
                .opacity(Double(min(max(p * 1.8 - 0.8, 0), 1)))
                .allowsHitTesting(p >= 0.5)
                .accessibilityHidden(p < 0.5)
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Shows the address bar")
        }
        .frame(maxWidth: .infinity)
        .frame(height: BarState.compactHeight + bars.extra * (1 - p), alignment: .top)
        .clipped()
        .background(.bar)
        .overlay(alignment: .bottom) {
            ZStack(alignment: .leading) {
                Divider()
                if bars.loading {
                    Rectangle().fill(Color.trifGreen).frame(height: 2)
                        .scaleEffect(x: max(0.05, bars.loaded), y: 1, anchor: .leading)
                        .animation(.easeOut(duration: 0.2), value: bars.loaded)
                }
            }
        }
    }
}

/// The foot: notes (over the page, not measured), then bars a choice needs (the point-and-hide bar, safe mode's) and
/// the toolbar. Scrolled down, the whole foot slides down by the toolbar's height: the toolbar goes, the rest stays.
struct BottomBars<Notes: View, Middle: View, Toolbar: View>: View {
    @ObservedObject var bars: BarState
    let notes: Notes
    let middle: Middle
    let toolbar: Toolbar
    init(bars: BarState, @ViewBuilder notes: () -> Notes, @ViewBuilder bars middle: () -> Middle, @ViewBuilder toolbar: () -> Toolbar) {
        self.bars = bars
        self.notes = notes()
        self.middle = middle()
        self.toolbar = toolbar()
    }

    var body: some View {
        VStack(spacing: 0) {
            notes
            VStack(spacing: 0) {
                middle
                toolbar
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bars.measured(toolbar: $0) }
                    .opacity(Double(1 - bars.progress))
                    .allowsHitTesting(bars.progress < 0.5)
                    .accessibilityHidden(bars.progress >= 0.5)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bars.measured(bottom: $0) }
        }
        .offset(y: bars.progress * bars.toolbarHeight)
    }
}
