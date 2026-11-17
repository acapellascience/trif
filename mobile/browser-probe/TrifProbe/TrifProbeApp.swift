// TRIF Probe (browser): a test app that asks what a TRIF made as its own iPhone browser could do.
// Not TRIF. See mobile/README.md for what each part is for and what to send back.

import SwiftUI
import UniformTypeIdentifiers
import UIKit
import UIKit.UIGestureRecognizerSubclass
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
        LocalModels.shared.wake() // (a model download iOS kept going while the app was away)
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
        Model.barsRef = self.bars
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
    static weak var barsRef: BarState?

    static func runStep(browser: Browser, panel: ModsPanel) async {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        guard let data = try? Data(contentsOf: docs.appendingPathComponent("step.json")),
              let step = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var out = "ok"
        if let s = step["sheet"] as? String { browser.wantsSheet = s }
        if let js = step["modsjs"] as? String {
            do { out = "\(try await panel.webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        if let js = step["boxjs"] as? String {
            let r = await browser.call(js, in: Browser.boxWorld)
            out = r.text ?? "error: \(r.error ?? "?")"
        }
        // (development, 11-16: how to get WebKit's cookies onto disk at once: {"cookies": "touch"} sets a throwaway
        // cookie through the public store; {"cookies": "spi"} says whether WebKit's private flush is there)
        if let c = step["cookies"] as? String {
            let store = WKWebsiteDataStore.default().httpCookieStore
            if c == "touch", let k = HTTPCookie(properties: [.name: "trif_touch", .value: String(Int(Date().timeIntervalSince1970)), .domain: "trif.invalid", .path: "/", .expires: Date().addingTimeInterval(60)]) {
                await store.setCookie(k)
                out = "touched"
            } else if c == "flush" {
                let sel = NSSelectorFromString("_flushCookiesToDiskWithCompletionHandler:")
                if store.responds(to: sel) {
                    typealias Flush = @convention(c) (AnyObject, Selector, @convention(block) @escaping () -> Void) -> Void
                    let f = unsafeBitCast(store.method(for: sel), to: Flush.self)
                    let t0 = Date()
                    await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in f(store, sel) { k.resume() } }
                    out = "flushed in \(Int(Date().timeIntervalSince(t0) * 1000)) ms"
                } else { out = "no flush" }
            } else if c == "dump" {
                // (every cookie's name, domain, path, expiry and flags to Documents/cookies.tsv: never a value)
                let all = await store.allCookies()
                let lines = all.map { k in "\(k.domain)\t\(k.name)\t\(k.path)\t\(k.expiresDate.map { String(Int($0.timeIntervalSince1970)) } ?? "session")\t\(k.isHTTPOnly ? "httponly" : "")\t\(k.isSecure ? "secure" : "")\t\(k.sameSitePolicy?.rawValue ?? "")" }
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                try? lines.sorted().joined(separator: "\n").write(to: docs.appendingPathComponent("cookies.tsv"), atomically: true, encoding: .utf8)
                out = "\(all.count) cookies"
            } else if c == "bench" {
                // (300 flushes by the path in use: how long each takes, and that no cookie changed or went)
                let sig = { (l: [HTTPCookie]) in Set(l.map { "\($0.name)|\($0.domain)|\($0.path)|\($0.value.hashValue)|\($0.expiresDate?.timeIntervalSince1970 ?? 0)" }) }
                let before = await store.allCookies()
                let t0 = Date()
                for _ in 0..<300 { await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in CookieKeeper.shared.flush(nil) { k.resume() } } }
                let ms = Date().timeIntervalSince(t0) * 1000 / 300
                let after = await store.allCookies()
                let a = sig(before), b = sig(after)
                out = "\(CookieKeeper.shared.usesPrivateFlush ? "private" : "public"): \(String(format: "%.2f", ms)) ms a flush; cookies before \(before.count) (\(Set(before.map { Site.of($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }).count) sites), after \(after.count); \(a == b ? "identical" : "CHANGED: \(a.subtracting(b).count) gone, \(b.subtracting(a).count) new")"
            } else {
                out = "spi: \(store.responds(to: NSSelectorFromString("_flushCookiesToDiskWithCompletionHandler:")))"
            }
        }
        if step["appstate"] != nil { out = "app state \(UIApplication.shared.applicationState.rawValue) (0 active, 1 inactive, 2 background), scenes \(UIApplication.shared.connectedScenes.map { "\($0.activationState.rawValue)" })" }
        if let b = step["bars"] as? String, let bars = Model.barsRef {
            if b == "full" { bars.expand() } else if b == "compact" { bars.collapse() }
            out = bars.describe()
        }
        if step["toolbar"] != nil {
            let w = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
            out = "page button centre \(ContentView.pageButtonMidX), screen centre \((w?.bounds.midX ?? 0)), off by \(abs(ContentView.pageButtonMidX - (w?.bounds.midX ?? 0)))"
        }
        if let id = step["approve"] as? String {
            for m in browser.mods.mods where m.held && (id == "*" || m.id == id) { browser.approveMod(m.id) }
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
        // ({"openurl": "…"}: opened as the app opens addresses in other apps, UIApplication.open)
        if let u = step["openurl"] as? String, let url = URL(string: u) { out = await UIApplication.shared.open(url) ? "opened" : "not opened" }
        // ({"hit": [x, y]}: the view UIKit's hit test finds at that window point, and its superviews)
        if let p = step["hit"] as? [Double], p.count == 2, let w = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first {
            var v = w.hitTest(CGPoint(x: p[0], y: p[1]), with: nil)
            var chain: [String] = []
            while let x = v, chain.count < 12 { chain.append("\(type(of: x)) \(Int(x.convert(x.bounds, to: w).minY))..\(Int(x.convert(x.bounds, to: w).maxY))"); v = x.superview }
            out = chain.joined(separator: " < ")
            let all = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            out += "\nwindows: " + all.map { "\(type(of: $0)) level \($0.windowLevel.rawValue) hidden \($0.isHidden) \(Int($0.frame.minY))..\(Int($0.frame.maxY)) hit \($0.hitTest($0.convert(CGPoint(x: p[0], y: p[1]), from: nil), with: nil).map { "\(type(of: $0))" } ?? "nil")" }.joined(separator: "; ")
        }
        if step["exitbutton"] != nil { out = "exit button centre \(FullScreenExit.placed)" }
        if step["view"] != nil { out = "on \(browser.current?.host.nonEmpty ?? "-"), full screen \(browser.fullScreen), covers \(ContentView.coversNow), \(browser.tabs.count) tabs" }
        if let u = step["iconcheck"] as? String, let site = URL(string: u) { out = await Model.iconCheck(browser: browser, site: site) }
        // ({"iconqueue": {…the same as iconprofile}}: the shown page's icon put on the list of icons waiting;
        // {"iconbatch": 1}: the list's profile as its Add all button makes it, to Documents/icon-batch.mobileconfig
        // (nothing handed, nothing recorded); {"iconqueueclear": 1}; {"iconqueuelist": 1})
        if let o = step["iconqueue"] as? [String: Any] { out = await Model.iconQueue(browser: browser, options: o) }
        if step["iconbatch"] != nil { out = Model.iconBatch(docs: docs) }
        if step["iconqueueclear"] != nil { IconQueue.shared.clear(why: "development step"); out = "cleared" }
        if step["iconqueuelist"] != nil { out = IconQueue.shared.items.map { "\($0.site) \($0.label) outline \($0.outline) swatch \($0.swatch) badge \($0.badge) picture \($0.picture != nil)" }.joined(separator: "\n") + "\ntag \(IconQueue.shared.tag ?? "-")" }
        // ({"iconprofile": {"outline": true, "swatch": 0-5, "badge": false, "name": "…"}}: the shown page's Home Screen
        // icon and profile as the sheet would make them, to Documents/icon-test.png and icon-test.mobileconfig)
        if let o = step["iconprofile"] as? [String: Any] { out = await Model.iconProfile(browser: browser, options: o, docs: docs) }
        if let u = step["playcheck"] as? String, let page = URL(string: u) { out = await Model.playCheck(browser: browser, page: page) }
        if step["playing"] != nil { out = await Model.playingStates(browser: browser) }
        // ({"tabjs": "…", "tab": n}: JavaScript in tab n's page, shown or not)
        if let js = step["tabjs"] as? String, let n = step["tab"] as? Int, n < browser.tabs.count {
            do { out = "\(try await browser.tabs[n].webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        if step["tabhosts"] != nil { out = browser.tabs.map { ($0 === browser.current ? "*" : "") + ($0.host.isEmpty ? "-" : $0.host) }.joined(separator: " ") }
        if let p = step["import"] as? String { browser.importFiles(p.split(separator: ",").map { URL(fileURLWithPath: String($0)) }) }
        if let t = step["offer"] as? String { browser.offer(text: t) }
        if step["cancelOffer"] != nil { browser.modOffer = nil }
        if step["bodies"] != nil { out = "\(Diagnostics.shared.bodies) bodies" }
        if step["addOffer"] != nil, let m = browser.modOffer { browser.modOffer = nil; browser.addMod(m) }
        if step["status"] != nil { out = browser.status }
        if step["resethint"] != nil { UserDefaults.standard.removeObject(forKey: "fullScreenHinted") }
        if step["fullscreen"] != nil { browser.toggleFullScreen(); out = "full screen: \(browser.fullScreen), note: \(browser.status)" }
        if step["chat"] != nil, let p = Model.pane { out = "shown: \(p.shown), activity: \(p.activity.rawValue), at: \(p.webView.url?.absoluteString ?? "nothing")" }
        if step["chats"] != nil, let p = Model.pane { out = p.views.map { "\($0 === p.cur ? "*" : " ") \($0.site.isEmpty ? "-" : $0.site) \($0.activity.rawValue) \($0.webView.url?.path ?? "nothing")" }.joined(separator: "\n") }
        if let i = step["showchat"] as? Int, let p = Model.pane, i < p.views.count { p.show(p.views[i]) }
        if step["memwarn"] != nil { NotificationCenter.default.post(name: UIApplication.didReceiveMemoryWarningNotification, object: UIApplication.shared) }
        if step["closechat"] != nil { Model.pane?.close() }
        if step["newchat"] != nil { Model.pane?.home() }
        if step["chatback"] != nil { Model.pane?.back() }
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
        // (the robot view's More: chosen, and JavaScript in the side panel's page)
        if let m = step["more"] as? Bool { Model.pane?.choose(more: m, service: m ? nil : .claude) }
        if let sv = step["service"] as? String, let s = ChatService(rawValue: sv) { Model.pane?.choose(more: false, service: s) }
        if let js = step["paneljs"] as? String, let wv = Model.pane?.panel.webView {
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

    /// The address screen (AddressScreen), over the page, the toolbar under it.
    @State private var showAddress = false
    @State private var showChecks = false
    @State private var showReport = false
    @State private var showTabs = false
    @State private var showHistory = false
    @State private var showMods = false
    @State private var addingIcon = false
    /// The list of Home Screen icons waiting (IconQueueView).
    @State private var showIconQueue = false
    @ObservedObject private var iconQueue = IconQueue.shared
    @State private var pickingFolder = false
    @State private var askingProject = false
    /// ⋯'s Hide the full screen button (off at first): the two-finger hold is then the only way out.
    @AppStorage("fullScreenButtonHidden") private var hideExitButton = false
    @ObservedObject private var folder = FolderWatch.shared
    @State private var importing = false
    @State private var asking = false
    @State private var question = ""

    /// Mods waiting for the user's OK on this site (the Mods button's badge, as the panel's waiting badge).
    private var waitingHere: Int {
        browser.mods.mods.filter { $0.held && ($0.everywhere || Site.of($0.site) == browser.site || $0.sites.contains { Site.of($0) == browser.site }) }.count
    }

    var body: some View {
        let _ = Diagnostics.shared.bodyRan("the browser's main view")
        page
        .onChange(of: coverNames, initial: true) { _, now in ContentView.coversNow = now }
        .onChange(of: phase) { _, p in
            // (safe mode: the record is unclean only while the app is in front; Safety follows UIKit's own notices too)
            browser.safety.active(p == .active)
            if p != .active { browser.saveTabs(); browser.history.saveNow(); if p == .inactive { browser.snapshot(nil, "the app left the front") } }
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
                ChatScreen(pane: pane)
                    .modifier(ToolbarRoom(insets: bars.insets))
                    .zIndex(pane.shown ? 1 : 0)
                    .allowsHitTesting(pane.shown)
                    .accessibilityHidden(!pane.shown)
                column
                    .background(Color(.systemBackground))
                    .zIndex(pane.shown ? 0 : 1)
                // (what else covers the page lies over it the same way, the toolbar showing under it, so the toolbar's
                // page button (and the others) can always take you back: Tim, 11-15)
                if showTabs {
                    TabsView(close: { showTabs = false }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(3)
                }
                if showMods {
                    ModsPanelView(panel: modsPanel, close: { showMods = false }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(3)
                }
                if showAddress {
                    AddressScreen(history: browser.history, close: { showAddress = false }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(4)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
            // (the full screen exit button: over everything, outside the clip, as it sits in the status bar's row)
            .overlay {
                if browser.fullScreen && !hideExitButton && !covered {
                    FullScreenExit(wake: browser.exitWake, long: browser.exitWakeLong) { browser.setFullScreen(false) }
                }
            }
        }
    }

    // (the page reaches from under the compact address bar to the foot; the bars lie over it, the address bar
    // growing and shrinking and the toolbar sliding away as the page scrolls (BarState), so the page is never
    // resized while that happens: what's under the bars is told to the page once they settle. iOS 26 and later;
    // before that the bars stay full and the page sits between them.)
    private var column: some View { columnLinks(columnBase) }
    private var columnBase: some View {
        ZStack(alignment: .top) {
            ZStack(alignment: .top) {
                WebViewHost(webView: browser.webView).id(browser.current.id)
                if browser.current.webView.url == nil && !browser.loading {
                    NewTabView(history: browser.history).modifier(BarPadding(bars: bars, top: true, bottom: true))
                }
            }
            .modifier(BarPadding(bars: bars, top: !BarState.moves && !browser.fullScreen, bottom: !BarState.moves && !browser.fullScreen))
            .padding(.top, browser.fullScreen ? 0 : BarState.compactHeight)
            .accessibilityHidden(pane.shown)
            if browser.fullScreen {
                FullScreenNote(text: browser.status, voiceOverExit: hideExitButton, leave: { browser.setFullScreen(false) }) { browser.status = "" }
            } else {
            PullActionsView(pull: bars.pull, insets: bars.insets)
            TopBar(bars: bars, full: addressBar, compact: compactBar)
                .modifier(PullShift(pull: bars.pull))
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
        }
        .onChange(of: browser.fullScreen) { _, now in bars.setFull(now); if now { closeCovers() } }
        .onAppear {
            pane.follow(site: browser.site); bars.attach(browser.webView); bars.setFull(browser.fullScreen)
            // (a pull's choice: as the toolbar's new tab, a reload, and closing the tab as the switcher does)
            bars.wakeExit = { [browser] in browser.wakeExit() }
            bars.pull.act = { [browser] c in
                switch c {
                case .newTab: browser.newTab()
                case .reload: browser.reload()
                case .close: if let t = browser.current { browser.close(t) }
                }
            }
        }
        .onChange(of: browser.address) { _, _ in pane.follow(site: browser.site); pane.tabChanged() }
        .onChange(of: browser.pageChanged) { _, _ in pane.follow(site: browser.site); pane.tabChanged(); bars.attach(browser.webView) }
        .onChange(of: browser.loading) { _, now in if now { bars.expand() } }
        // (the bars stay full while anything covers the page: its toolbar is how to get back)
        .onChange(of: covered) { _, now in bars.hold(now) }
        .onChange(of: pane.shown) { _, now in if now { pane.settleLayout() } }
        .onChange(of: browser.wantsChat) { _, want in if want { pane.open(); browser.wantsChat = false } }
        .onChange(of: browser.hideChat) { _, _ in pane.close() }
        // (the next of a reply's mods once the Mods tab, opened for one that waits for an OK, has closed)
        .onChange(of: showMods) { _, open in if !open { browser.holdFromChat = false; nextOfferSoon() } }
        .onChange(of: modsPanel.wantsClose) { _, want in if want { showMods = false; modsPanel.wantsClose = false } }
        .onChange(of: browser.wantsMods) { _, want in if want { showMods = true; browser.wantsMods = false } }
        .onChange(of: browser.wantsAddress) { _, want in if want { closeCovers(); showAddress = true; browser.wantsAddress = false } }
    }
    /// (the sheets and what comes from outside: in a part of their own, so the compiler can follow the chain)
    private func columnLinks(_ base: some View) -> some View {
        base
        .onChange(of: browser.wantsSheet) { _, which in
            switch which {
            case "mods": showMods = true
            case "tabs": browser.snapshot(); showTabs = true
            case "history": showHistory = true
            case "chat": pane.open()
            case "import": importing = true
            case "address": showAddress = true
            case "icon": addingIcon = true
            case "iconqueue": showIconQueue = true
            case "none": addingIcon = false; showIconQueue = false; showMods = false; showTabs = false; showHistory = false; showAddress = false; pane.close(); showChecks = false; showReport = false
            default: break
            }
            browser.wantsSheet = ""
        }
        .onChange(of: modsPanel.wantsImport) { _, want in if want { showMods = false; importing = true; modsPanel.wantsImport = false } }
        .onOpenURL { url in openLink(url) }
        // (the icon check's way in, Model.iconCheck: UIApplication.open of the app's own scheme asks "Open in …?" first)
        .onAppear { ContentView.openForCheck = { url in openLink(url) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.javaScript, .zip, .folder, .json], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { browser.importFiles(urls) }
        }
        .sheet(isPresented: $addingIcon) { WebClipSheet().environmentObject(browser) }
        .sheet(isPresented: $showIconQueue) { IconQueueView().environmentObject(browser) }
        .alert(pane.service.project == nil ? "Keep TRIF chats in a project" : "TRIF chats' project", isPresented: $askingProject) {
            Button(pane.service.project == nil ? "Copy and go" : "Make another") { pane.openProjects() }
            if pane.service.project != nil { Button("Stop using it", role: .destructive) { pane.service.useProject(nil, hasGuide: false) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(pane.service.project == nil
                 ? "In \(pane.service.rawValue), make a new project and paste TRIF's instructions as its instructions (they're copied when you tap Copy and go). Then, on the project's page, tap Use this project for TRIF chats. New TRIF chats then start in it."
                 : "New TRIF chats in \(pane.service.rawValue) start in your project\(pane.service.projectHasGuide ? ", which has TRIF's instructions" : ""). Project chats may still show in \(pane.service.rawValue)'s recent chats.")
        }
        .background(Color.clear.fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { FolderWatch.shared.choose(url) }
        })
        .sheet(isPresented: $showChecks) { ChecksView().environmentObject(browser).environmentObject(report) }
        .sheet(isPresented: $showReport) { ReportView().environmentObject(report) }
        .sheet(isPresented: $showHistory) { HistoryView(history: browser.history).environmentObject(browser) }
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
            Text(siteLabel)
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

    /// The page's site as the address bar shows it when it isn't being typed in (Tim, 11-15, as Chrome): only the
    /// host, without www. or m.; no scheme, no path.
    private var siteLabel: String {
        var h = browser.host
        for p in ["www.", "m."] where h.hasPrefix(p) { h.removeFirst(p.count) }
        return h.isEmpty ? (browser.webView.url == nil ? "Search or type URL" : browser.address) : h
    }

    /// The full address bar: the site, centred (a lock for https), and Share inside it; tap it for the address screen.
    /// Reload (Stop while loading) beside it.
    private var addressBar: some View {
        HStack(spacing: 6) {
            moreMenu
            Button { closeCovers(); showAddress = true } label: {
                HStack(spacing: 5) {
                    if browser.webView.url?.scheme == "https" { Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(.secondary) }
                    Text(siteLabel).font(.body).lineLimit(1).truncationMode(.middle)
                        .foregroundStyle(browser.webView.url == nil ? .secondary : .primary)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 36)
                .frame(height: 38)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(.secondarySystemBackground)))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Address, \(siteLabel)")
            .overlay(alignment: .trailing) {
                if let url = browser.webView.url, ["http", "https"].contains(url.scheme ?? "") {
                    ShareLink(item: url) { Image(systemName: "square.and.arrow.up").font(.system(size: 16)) }
                        .padding(.trailing, 10)
                        .accessibilityLabel("Share")
                }
            }
            // (no reload button: pull the page down. A stop while loading, so a slow page can be stopped)
            if browser.loading {
                Button { browser.webView.stopLoading() } label: { Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)) }
                    .accessibilityLabel("Stop loading")
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    /// The ⋯ menu at the address bar's left (Tim, 11-16: moved there from the toolbar's last button, which is now the
    /// Home Screen [+]): new tab, history, importing, the folder, the project, full screen, the page's tools, the probe.
    private var moreMenu: some View {
        Menu {
            Button { onTab { browser.newTab() } } label: { Label("New tab", systemImage: "plus.square.on.square") }
            Button { onTab { showHistory = true } } label: { Label("History", systemImage: "clock") }
            Button { onTab { importing = true } } label: { Label("Import…", systemImage: "square.and.arrow.down") }
            Button { onTab { pickingFolder = true } } label: { Label(folder.folderName.map { "Mods folder: \($0)…" } ?? "Watch a folder for mods…", systemImage: "folder.badge.gearshape") }
            if let name = folder.folderName { Button("Stop watching \(name)", role: .destructive) { folder.stop() } }
            Button { onTab { askingProject = true } } label: { Label(pane.service.project == nil ? "Keep TRIF chats in a project…" : "TRIF chats' project…", systemImage: "folder") }
            // (full screen for this tab; the line under it names the shortcut, which also switches back)
            Button { onTab { browser.setFullScreen(true) } } label: {
                Label("Full screen", systemImage: "arrow.up.left.and.arrow.down.right")
                Text("Or hold two fingers on the page")
            }
            Toggle(isOn: $hideExitButton) { Label("Hide the full screen button", systemImage: "eye.slash") }
            // (the Home Screen icons put aside with Add to Home Screen later, all added in one install)
            if !iconQueue.items.isEmpty {
                Button { onTab { showIconQueue = true } } label: { Label("Home Screen icons to add (\(iconQueue.items.count))…", systemImage: "square.grid.2x2") }
            }
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
        } label: {
            Image(systemName: "ellipsis.circle").font(.system(size: 19)).frame(width: 34, height: 38).contentShape(Rectangle())
        }
        .accessibilityLabel("More")
    }

    /// The shown tab is on a website (for Add to Home Screen).
    private var onWebPage: Bool { let s = browser.webView.url?.scheme; return s == "https" || s == "http" }
    /// Something covers the page: the chat, the tabs, the Mods tab, the address screen.
    private var covered: Bool { pane.shown || showTabs || showMods || showAddress }
    /// Whatever covers the page closes (the chat as its own Back does: nothing in it lost). `all`: the sheets and
    /// questions too (history, checks, report, the project and Ask the phone questions, the file pickers), for a Home
    /// Screen icon, which lands on its page as an app would. An Add this mod? stays: it waits for the person's OK.
    private func closeCovers(all: Bool = false) {
        if pane.shown { pane.close() }
        showTabs = false
        showMods = false
        showAddress = false
        guard all else { return }
        showHistory = false; showChecks = false; showReport = false
        askingProject = false; asking = false; importing = false; pickingFolder = false
    }
    /// A link the app was opened with: a file to import, a mod's trif://add, a Home Screen icon's trif://open.
    private func openLink(_ url: URL) {
        if url.isFileURL { browser.importFiles([url]); try? FileManager.default.removeItem(at: url) }
        else if url.host?.lowercased() == "add", url.scheme?.lowercased() == "trif" {
            // (a mod in a link: a QR code's, from desktop TRIF; offered like any other)
            if let m = ModLinkInURL.read(url) { closeCovers(); Task { await browser.offerFiles([(m.name, m.text)], from: "a code") } }
            else { browser.status = "That code's mod couldn't be read: it may be cut short or damaged." }
        }
        else if let site = TrifLink.target(url) {
            // (the Add to Home Screen sheet, if it's for this site, stays: it says it's done, and the person closes it;
            // likewise the list of icons waiting, if they came from its profile, which also clears the list)
            let host = Site.of(site.host ?? ""), set = TrifLink.set(url)
            ProfileHandoff.shared.opened(fromIconOf: host, set: set)
            IconQueue.shared.opened(site: host, set: set)
            if !(addingIcon && ProfileHandoff.shared.installed) { addingIcon = false }
            if !(showIconQueue && ProfileHandoff.shared.installed) { showIconQueue = false }
            closeCovers(all: true)
            if TrifLink.wantsFullScreen(url) { browser.openFullScreen(site) } else { browser.openFromIcon(site) }
        }
        else if url.scheme == "trif" { report.log("icon", "a trif:// link that isn't an http(s) site, ignored") }
    }
    static var openForCheck: ((URL) -> Void)?
    /// What covers the page, by name ("none"), for the dev step {"view": 1} and the icon check (Model.iconCheck).
    private var coverNames: String {
        let all: [(Bool, String)] = [(pane.shown, "chat"), (showTabs, "tabs"), (showMods, "mods"), (showAddress, "address"),
                                     (showHistory, "history"), (showChecks, "checks"), (showReport, "report"), (addingIcon, "icon"), (showIconQueue, "iconqueue"),
                                     (askingProject, "project"), (asking, "ask"), (importing, "import"), (pickingFolder, "folder")]
        return all.filter(\.0).map(\.1).joined(separator: ",").nonEmpty ?? "none"
    }
    static var coversNow = "none"
    /// The toolbar's page button (Tim, 11-15): back to the page, from whatever covers it. On the page already (Tim,
    /// 11-16): a + that opens a new tab, onto the address screen.
    private func showPage() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if covered { closeCovers() } else { browser.newTab() }
    }

    /// Back and forward's accessibility label while the chat is open (as the chat's own ‹ {site}).
    private var backToTab: String { "Back to \(browser.site.isEmpty ? "Tab" : browser.site)" }

    /// A toolbar button while something covers the page: back to the tab first, then its job there.
    private func onTab(_ job: () -> Void) {
        closeCovers()
        job()
    }

    private var toolbar: some View {
        // (the page button at the screen's exact centre, a little bigger; the three on each side evenly in their half,
        // mirrored: each side cell the same width. Tim, 11-15: evenly spaced, the bigger middle one sat 11 pt left)
        HStack(spacing: 0) {
            // (with the chat open, back and forward only close it, back to the page as it was: Tim, 11-15, "that's
            // the behaviour people will expect")
            // (the chat showing: its own history; the tabs, Mods or the address screen: closed; else the tab's history)
            Button { if pane.shown { pane.back() } else if covered { closeCovers() } else { browser.back() } } label: { Image(systemName: "chevron.left") }
                .disabled(pane.shown ? !pane.canGoBack : !covered && !browser.canGoBack)
                .accessibilityLabel(covered && !pane.shown ? backToTab : "Back")
                .frame(maxWidth: .infinity)
            Button { if pane.shown { pane.forward() } else if covered { closeCovers() } else { browser.forward() } } label: { Image(systemName: "chevron.right") }
                .disabled(pane.shown ? !pane.canGoForward : !covered && !browser.canGoForward)
                .accessibilityLabel(covered && !pane.shown ? backToTab : "Forward")
                .frame(maxWidth: .infinity)
            // (the same button opens the chat and, while it's open (shown selected), goes back to the tab)
            Button { if pane.shown { pane.close() } else { closeCovers(); pane.open() } } label: {
                ChatGlyph(activity: pane.activity).frame(width: 24, height: 24)
                    .padding(5)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.trifGreen.opacity(pane.shown ? 0.2 : 0)))
                    .padding(-5)
            }
            .accessibilityLabel(pane.activity == .working ? "Chat, writing a reply" : pane.activity == .replied ? "Chat, replied" : "Chat")
            .accessibilityAddTraits(pane.shown ? .isSelected : [])
                .frame(maxWidth: .infinity)
            // (the middle cell, a little bigger: the page button, or with the experiment below the tabs button)
            Group { if ContentView.tabsInMiddle { tabsButton } else { pageButton } }
                .frame(width: 64)
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).midX } action: { ContentView.pageButtonMidX = $0 }
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
                .frame(maxWidth: .infinity)
            Group { if ContentView.tabsInMiddle { pageButton } else { tabsButton } }
                .frame(maxWidth: .infinity)
            // (the last button adds this site to the Home Screen, Tim 11-16; what the ⋯ menu here held is in the ⋯ at the
            // address bar's left. Its glyph, an A in a rounded square like the App Store's (Tim, 11-17), so it isn't
            // taken for the new tab's +)
            Button { onTab { addingIcon = true } } label: { Image(systemName: "a.square") }
                .disabled(!onWebPage)
                .accessibilityLabel("Add to Home Screen")
                .frame(maxWidth: .infinity)
        }
        .font(.title3)
        // (the same room on both sides: iOS's side safe areas are the same on both sides in landscape, so the row's
        // centre is the screen's)
        .padding(.horizontal, 6)
        .padding(.vertical, 10)
    }

    /// (development: where the middle button's centre is, for the step {"toolbar": 1})
    static var pageButtonMidX: CGFloat = 0

    /// The toolbar's tabs button and page button swapped (Tim, 11-17, an experiment: does it feel more like a normal
    /// browser?): the tabs button in the middle, the page button where the tabs were. `true` ships it; `false` (or the
    /// launch flag `-pagemiddle`) is the layout before: back, forward, chat, [page], Mods, tabs, Home Screen.
    static let tabsInMiddle = true && !ProcessInfo.processInfo.arguments.contains("-pagemiddle")

    /// The page: back to it from whatever covers it; on the page, a + for a new tab.
    private var pageButton: some View {
        Button(action: showPage) { PageGlyph(letter: ProcessInfo.processInfo.arguments.contains("-pageletter") ? String(siteLabel.prefix(1)).uppercased() : nil, plus: !covered) }
            .accessibilityLabel(covered ? backToTab : "New Tab")
    }
    /// The tabs, their count in a rounded square.
    private var tabsButton: some View {
        Button { onTab { browser.snapshot(); showTabs = true } } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(lineWidth: 1.8).frame(width: 22, height: 22)
                Text("\(browser.tabs.count)").font(.system(size: 12, weight: .semibold))
            }
        }
        .accessibilityLabel("Tabs, \(browser.tabs.count) open")
    }

}

/// TRIF's robot as a toolbar glyph (Tim, 11-16): TRIF's own shapes, the side panel's squircle (RobotShape.swift,
/// made by mobile/prepare.js from extension/sidepanel.html's #bar-robot: the line midway between its rim and face) and
/// its eyes, drawn as the other glyphs are: an outline in the button's tint, the same line width as the switch beside
/// it, the eyes filled. Writing a reply: three moving dots for eyes; all mods paused: the panel's two bars.
struct RobotGlyph: View {
    var paused = false
    var working = false
    /// The squircle's middle line: halfway between the rim's outer edge and the face's.
    static let outline: [(Double, Double)] = zip(RobotShape.rim, RobotShape.face).map { (($0.0 + $1.0) / 2, ($0.1 + $1.1) / 2) }
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height), k = s / 128
            ZStack {
                RobotPolygon(points: RobotGlyph.outline).stroke(style: StrokeStyle(lineWidth: max(1.5, s * 0.09), lineJoin: .round))
                if paused {
                    ForEach(0..<RobotShape.pause.count, id: \.self) { i in
                        let r = RobotShape.pause[i]
                        RoundedRectangle(cornerRadius: r.4 * k)
                            .frame(width: r.2 * k, height: r.3 * k)
                            .position(x: (r.0 + r.2 / 2) * k, y: (r.1 + r.3 / 2) * k)
                    }
                } else if working {
                    PhaseAnimator([0, 1, 2]) { lit in
                        HStack(spacing: s * 0.08) {
                            ForEach(0..<3, id: \.self) { i in Circle().frame(width: s * 0.15, height: s * 0.15).opacity(i == lit ? 1 : 0.3) }
                        }
                    } animation: { _ in .easeInOut(duration: 0.3) }
                } else {
                    ForEach(0..<RobotShape.eyes.count, id: \.self) { i in RobotPolygon(points: RobotShape.eyes[i]).fill() }
                }
            }
            .frame(width: s, height: s)
        }
    }
}

/// One of the robot's polygons, scaled from its 128 x 128 space to the view's.
struct RobotPolygon: Shape {
    let points: [(Double, Double)]
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 128
        var p = Path()
        for (n, (x, y)) in points.enumerated() {
            let pt = CGPoint(x: rect.minX + x * k, y: rect.minY + y * k)
            if n == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

/// The toolbar's page button, in the middle and a little bigger: a page, in a soft green circle (or, to compare,
/// `-pageletter`: the site's letter).
struct PageGlyph: View {
    var letter: String? = nil
    /// On the page itself: a + (a new tab) instead of the page, the change between the two a quick, soft replace.
    var plus = false
    var body: some View {
        ZStack {
            // (the soft circle only behind the +: over the chat, Mods, the tabs or the address screen the circle would
            // read as "you're here", as it does behind the chat's robot, so the page glyph has none: Tim, 11-16)
            Circle().fill(Color.trifGreen.opacity(0.16)).frame(width: 40, height: 40)
                .scaleEffect(plus ? 1 : 0.6).opacity(plus ? 1 : 0)
            if let letter, !letter.isEmpty, !plus {
                Text(letter).font(.system(size: 19, weight: .bold, design: .rounded))
            } else {
                Image(systemName: plus ? "plus" : "doc.text").font(.system(size: 19, weight: plus ? .semibold : .medium))
                    .contentTransition(.symbolEffect(.replace.downUp))
            }
        }
        .frame(width: 40, height: 40)
        .animation(.easeInOut(duration: 0.22), value: plus)
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
/// down shrinks the address bar to a small line with the site and slides the toolbar away; scrolling up, reaching
/// the top, a tap on the small line, or a page starting to load brings both back. `progress` (0 full, 1 compact)
/// follows the scrolling, but no faster than the whole way in about 0.22 s, easing in and out (11-15: a fast flick
/// moved them in one jump), and settles fully one way or the other once the finger is off.
/// The page is never resized for them: it lies under both bars, from the small line to the foot, the whole time, and
/// WebKit is told what they cover as they move, every frame (obscuredContentInsets, iOS 26), so the page's fixed
/// headers and footers (x.com's tab bar) move with them and are never covered or left floating. The page's own
/// viewport, for vh units, is told the range once (setMinimumViewportInset: compact … full). Before iOS 26 the bars
/// stay full and the page sits between them (`moves` false).
/// Its own object: per-frame changes redraw the two bars, not the app's main view.
@MainActor
final class BarState: NSObject, ObservableObject {
    static let compactHeight: CGFloat = 26
    static var moves: Bool { if #available(iOS 26, *) { return true } else { return false } }
    /// The bars' fastest: the whole way in this long.
    static let quickest: CGFloat = 0.22

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
    /// Where the scrolling says the bars should be; `progress` goes there at its own pace (tick).
    private var target: CGFloat = 0
    private var speed: CGFloat = 0
    private var link: CADisplayLink?
    /// The software keyboard is up (Tim, 11-15: the toolbar rode on it, eating the room): the toolbar goes down with
    /// it and comes back with it, as Chrome's does. Not for a hardware keyboard's strip alone (the keyboard's frame
    /// must cover more than that of the screen).
    @Published private(set) var keyboardUp = false

    override init() {
        super.init()
        for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
                let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                let duration = (n.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
                let hiding = n.name == UIResponder.keyboardWillHideNotification
                MainActor.assumeIsolated { self?.keyboard(hiding ? .zero : end, duration: duration) }
            }
        }
    }

    private func keyboard(_ end: CGRect, duration: Double) {
        let screen = UIScreen.main.bounds
        let overlap = end.isEmpty ? 0 : max(0, screen.maxY - max(end.minY, screen.minY))
        let up = overlap > 150
        guard up != keyboardUp else { return }
        withAnimation(.easeOut(duration: max(duration, 0.1))) { keyboardUp = up }
        insets.set(keyboard: up)
        applyInsets()
    }

    func measured(full: CGFloat) {
        let e = max(full - BarState.compactHeight, 0)
        guard abs(e - extra) > 0.5 else { return }
        extra = e
        applyInsets(range: true)
    }
    func measured(toolbar: CGFloat) {
        guard abs(toolbar - toolbarHeight) > 0.5 else { return }
        toolbarHeight = toolbar
        insets.set(toolbar: toolbar)
        applyInsets(range: true)
    }
    func measured(bottom: CGFloat) {
        guard abs(bottom - bottomHeight) > 0.5 else { return }
        bottomHeight = bottom
        applyInsets(range: true)
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
        fingers.view?.removeGestureRecognizer(fingers)
        wv.addGestureRecognizer(fingers)
        settleTask?.cancel()
        stop()
        target = 0
        progress = 0
        applyInsets(range: true)
    }

    /// Full screen: no bars at all (nothing covers the page, nothing moves, no pull-down).
    private(set) var full = false
    /// Full screen's page scrolled back up: its way-out button brightens (set by the app).
    var wakeExit: () -> Void = {}
    private var upRun: CGFloat = 0
    func setFull(_ a: Bool) {
        guard a != full else { return }
        full = a
        stop()
        target = 0
        progress = 0
        applyInsets(range: true)
    }

    /// The bars full again (a load starting, the address being typed, a tap on the small line).
    func expand() { settle(to: 0) }
    /// (development) Compact, as after scrolling down.
    func collapse() { settle(to: 1) }
    /// (development) Where the bars and the page are.
    func describe() -> String {
        guard let wv = webView else { return "no page" }
        let sv = wv.scrollView
        var top: CGFloat = 0
        if #available(iOS 26, *) { top = wv.obscuredContentInsets.top }
        return "progress \(progress), target \(target), obscured top \(top), contentOffset \(sv.contentOffset.y), adjusted top \(sv.adjustedContentInset.top), web view top \(wv.convert(CGPoint.zero, to: nil).y)"
    }
    /// While something covers the page (the chat, the tabs, Mods, the address screen) the bars stay full; when it
    /// goes, they go back to where they were (11-16: they stayed full, and x.com's own header, which hides as the
    /// page scrolls down until it scrolls up again, stayed hidden behind the full address bar).
    private var heldFrom: CGFloat?
    func hold(_ h: Bool) {
        guard h != held else { return }
        held = h
        if h { heldFrom = target; expand() }
        else { settle(to: heldFrom ?? 0); heldFrom = nil }
    }

    private func scrolled(_ sv: UIScrollView) {
        let y = sv.contentOffset.y
        defer { lastY = y }
        if shifting { return } // (the page moved with the bar: not the person's scrolling)
        guard !full else {
            // (full screen: scrolled back up a little way, the way out shows again for a moment)
            upRun = y < lastY ? upRun + (lastY - y) : 0
            if upRun > 40 { upRun = 0; wakeExit() }
            return
        }
        pulled(sv)
        guard BarState.moves, !held else { return }
        let top = -sv.adjustedContentInset.top
        // (a page with little or nothing to scroll keeps its bars)
        if sv.contentSize.height < sv.bounds.height + 120 { if target != 0 { settle(to: 0) }; return }
        // (at the top, or pulled down past it: full)
        if y <= top + 1 { if target != 0 { settle(to: 0) }; return }
        // (only the person's own scrolling: not a page scrolling itself, not the bounce at the bottom)
        guard sv.isTracking || sv.isDecelerating else { return }
        if y >= sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom - 1 { return }
        let t = min(max(target + (y - lastY) / max(toolbarHeight, 44), 0), 1)
        if t != target { target = t; run() }
        if !sv.isTracking { settleSoon() }
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began:
            // (a pull counts only if it starts with the page at its very top)
            if let sv = webView?.scrollView { pullFromTop = !held && sv.contentOffset.y <= -sv.adjustedContentInset.top + 1 }
        case .changed:
            // (the finger going sideways moves no scrolling, so the choice follows the gesture itself too)
            if let sv = webView?.scrollView { pulled(sv) }
        case .ended:
            pull.release()
            pullFromTop = false
            settleSoon()
        case .cancelled, .failed:
            pull.cancel()
            pullFromTop = false
            settleSoon()
        default: break
        }
    }

    // MARK: pulling down at the top (Tim, 11-16, as Chrome: + New Tab, Reload, × Close Tab)
    /// The pull's state, for its own small view (PullActionsView): its own object, so the bars don't redraw for it.
    let pull = PullActions()
    private var pullFromTop = false
    private lazy var fingers: FingerWatch = {
        let f = FingerWatch()
        f.moved = { [weak self] in guard let self, self.pullFromTop, let sv = self.webView?.scrollView else { return }; self.pulled(sv) }
        return f
    }()
    /// Only the page's own scroll view going past its top, with the person's finger on it: a page that handles the touch
    /// itself (a map, a canvas, a piece dragged, an inner scroller) never moves it, and a page with
    /// `overscroll-behavior: none` doesn't let it go past its top (WebKit stops the bounce), so neither pulls.
    private func pulled(_ sv: UIScrollView) {
        guard pullFromTop, sv.isTracking else { return }
        let past = -sv.adjustedContentInset.top - sv.contentOffset.y
        // (where the finger is across the screen: the scroll view's own pan reports none of the sideways part once it's
        // scrolling up and down, so a watcher of the touches themselves says)
        pull.update(distance: max(past, 0), sideways: fingers.x)
    }

    /// Once the finger is off and the page has stopped moving: fully one way or the other.
    private func settleSoon() {
        settleTask?.cancel()
        settleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard let self, !Task.isCancelled, let sv = self.webView?.scrollView, !sv.isTracking else { return }
            if sv.isDecelerating { self.settleSoon(); return }
            self.settle(to: self.target > 0.5 ? 1 : 0)
        }
    }

    private func settle(to t: CGFloat) {
        settleTask?.cancel()
        target = t
        run()
    }

    // MARK: moving the bars, a frame at a time

    private func run() {
        guard link == nil, progress != target else { return }
        let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
        l.add(to: .main, forMode: .common)
        link = l
    }
    private func stop() {
        link?.invalidate()
        link = nil
        speed = 0
    }

    /// One frame: toward `target`, closely enough to follow a slow scroll, never faster than `quickest`, speeding up
    /// and slowing down smoothly.
    @objc private func tick(_ l: CADisplayLink) {
        let dt = CGFloat(max(min(l.targetTimestamp - l.timestamp, 1.0 / 30), 1.0 / 240))
        let diff = target - progress
        if abs(diff) < 0.002 {
            progress = target
            applyInsets()
            stop()
            return
        }
        let fastest = 1 / BarState.quickest
        // (the speed that would close the gap in about 50 ms, capped; reached within about 60 ms; slowing to stop)
        let wanted = max(min(diff / 0.05, fastest), -fastest)
        let accel = fastest / 0.06 * dt
        speed = speed + max(min(wanted - speed, accel), -accel)
        var p = progress + speed * dt
        if (diff > 0 && p > target) || (diff < 0 && p < target) { p = target }
        progress = min(max(p, 0), 1)
        applyInsets()
    }

    /// The page's content moved down by `dy` points with the bar's edge (up for a negative one): the scroll offset
    /// takes the change, so the page's scrollY stays put. Not counted as the person's scrolling (`lastY`).
    private func shift(_ sv: UIScrollView, by dy: CGFloat) {
        guard dy != 0, BarState.compensates else { return }
        var o = sv.contentOffset
        o.y -= dy
        shifting = true
        sv.contentOffset = o
        shifting = false
        lastY = sv.contentOffset.y
    }
    private var shifting = false
    /// (development) `-nobarshift` at launch: the bars move without the page moving with them, as before 11-16.
    static let compensates = !ProcessInfo.processInfo.arguments.contains("-nobarshift")

    /// What the bars cover now, told to WebKit (every frame they move); with `range`, also the viewport's range
    /// (compact … full, for the page's vh units), when a bar's size changes.
    private func applyInsets(range: Bool = false) {
        insets.set(top: extra, bottom: bottomHeight)
        guard let wv = webView else { return }
        if #available(iOS 26, *) {
            let p = progress
            let gone = keyboardUp ? 1 : p // (the toolbar, gone down with the keyboard)
            let e = full ? .zero : UIEdgeInsets(top: (extra * (1 - p) * 2).rounded() / 2, left: 0, bottom: (max(bottomHeight - toolbarHeight * gone, 0) * 2).rounded() / 2, right: 0)
            let was = wv.obscuredContentInsets
            let sv = wv.scrollView
            if was != e || (BarState.compensates && sv.contentInset != e) {
                // (as Chrome for iOS does on iOS 26 (CRWWebViewContentView, its content-inset mode): the web view
                // stays the whole height under the bars; what they cover is both WebKit's obscured insets and the
                // scroll view's content insets, so the page's top and foot can be scrolled out from under them)
                shifting = true
                if BarState.compensates {
                    if sv.contentInsetAdjustmentBehavior != .never { sv.contentInsetAdjustmentBehavior = .never }
                    sv.contentInset = e
                }
                wv.obscuredContentInsets = e
                shifting = false
                // (and the page moves with the address bar's edge, so its own scroll position (scrollY) never
                // changes because the bar did: only the person's scrolling moves it. Without this a bar growing over a
                // still page read to the page as a scroll down, and x.com's header, which hides on scrolling down and
                // comes back on scrolling up, stayed hidden under the full bar: 11-16, Tim's phone)
                shift(sv, by: e.top - was.top)
            }
            if range && full {
                wv.setMinimumViewportInset(.zero, maximumViewportInset: .zero)
            } else if range {
                wv.setMinimumViewportInset(UIEdgeInsets(top: 0, left: 0, bottom: max(bottomHeight - toolbarHeight, 0), right: 0),
                                           maximumViewportInset: UIEdgeInsets(top: extra, left: 0, bottom: bottomHeight, right: 0))
            }
        }
    }
}

/// Watches the finger on a web view without taking part: where it is across the screen (`x`), as it moves. Never
/// recognizes, never cancels or delays a touch, and works alongside every other gesture.
final class FingerWatch: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private(set) var x: CGFloat = 0
    var moved: () -> Void = {}
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }
    convenience init() { self.init(target: nil, action: nil) }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { if let t = touches.first { x = t.location(in: nil).x } }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { if let t = touches.first { x = t.location(in: nil).x; moved() } }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}

/// Full screen's own note (the bars, where notes usually are, are away): the app's note ("Switched to full screen",
/// and any other while the tab is in full screen) at the top, fading as the others do, after 2 seconds. And for
/// VoiceOver, which can't hold two fingers on the page, the way back as a button of its own.
struct FullScreenNote: View {
    let text: String
    /// (VoiceOver's own way back, while the button is hidden)
    let voiceOverExit: Bool
    let leave: () -> Void
    let dismiss: () -> Void
    var body: some View {
        ZStack(alignment: .top) {
            if !text.isEmpty {
                Text(text)
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
                    .padding(.top, 8)
                    .padding(.horizontal, 16)
                    .onTapGesture { withAnimation(.easeOut(duration: 0.3)) { dismiss() } }
                    .transition(.opacity)
                    .task(id: text) {
                        let wait = UIAccessibility.isVoiceOverRunning ? 10.0 : text == Browser.fullScreenHint ? 4.0 : 2.0
                        try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                        guard !Task.isCancelled else { return }
                        withAnimation(.easeOut(duration: 0.3)) { dismiss() }
                    }
            }
            if voiceOverExit {
            Color.clear.frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel("Switch to TRIF view")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { leave() }
            }
        }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(!text.isEmpty)
    }
}

/// Full screen's visible way out (Tim, 11-16: someone who comes in from a Home Screen icon mustn't be stuck): a small
/// round button at the top right, over a dark see-through backing. Bright for 3 seconds on entering full screen, and for
/// a moment when the page is scrolled back up or the app comes back to the front; otherwise faint (30%), never gone.
/// A tap is TRIF view, as the two-finger hold. ⋯ → Hide the full screen button takes it away.
/// (development) `-exitrobot`: the robot instead of the exit glyph, to compare.
struct FullScreenExit: View {
    let wake: Int
    let long: Bool
    let leave: () -> Void
    @State private var bright = true
    static let robot = ProcessInfo.processInfo.arguments.contains("-exitrobot")
    /// (`-exitbelow`: where it was before 11-17, 60 points under the status bar at the right)
    static let belowBar = ProcessInfo.processInfo.arguments.contains("-exitbelow")
    static let below: CGFloat = 60
    /// (development: `-exity <points>`, the circle's centre that far down)
    static let devY: CGFloat? = { let a = ProcessInfo.processInfo.arguments; return a.firstIndex(of: "-exity").flatMap { a.indices.contains($0 + 1) ? Double(a[$0 + 1]).map { CGFloat($0) } : nil } }()
    var body: some View {
        GeometryReader { g in
            // (Tim, 11-17: "can we move it up?": the round button straddles the foot of the status bar, beside the
            // clock: on the SE right of the centred clock (most of it in the 20-point strip), on a notch or Dynamic
            // Island phone between the clock and the cutout, just under the clock's row. iOS keeps every touch in the
            // status bar itself (the SE's 0-20, the 17 Pro's 0-54: Simulator, 11-17), so the 44-point target starts at
            // the bar's foot, and the button's lower half and what's under it take the tap)
            let frame = g.frame(in: .global)
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            let top = scene?.keyWindow?.safeAreaInsets.top ?? 20
            let bar = scene?.statusBarManager?.statusBarFrame.height ?? top
            let w = frame.width
            let cutout = top > 30
            // (a cutout phone: between the clock, about a quarter across, and the cutout's left edge, the widest gap in
            // its row (right of it the status icons leave too little); no cutout: just right of the centred clock,
            // short of where sites put their top bar's right-hand buttons (Wikipedia's search, 11-17))
            let x = FullScreenExit.belowBar ? w - 8 - 14 : cutout ? (w * 0.24 + w / 2 - 63) / 2 : w / 2 + 63
            let side: CGFloat = FullScreenExit.belowBar ? 28 : 22
            // (the circle's centre and the target's top, in the window's points)
            let cy = FullScreenExit.devY ?? (FullScreenExit.belowBar ? FullScreenExit.below + 14 : bar - 2)
            // (44 points square; under the bar, 40 wide and from the bar's foot down 44, to cover less of the page)
            let hit = FullScreenExit.belowBar ? CGRect(x: x - 22, y: cy - 22, width: 44, height: 44) : CGRect(x: x - 20, y: max(bar, cy - 22), width: 40, height: 44)
            Group {
                if FullScreenExit.robot { RobotGlyph().frame(width: side * 0.6, height: side * 0.6) }
                else { Image(systemName: "arrow.down.right.and.arrow.up.left").font(.system(size: side * 0.43, weight: .bold)) }
            }
            .foregroundStyle(.white)
            .frame(width: side, height: side)
            .background(Circle().fill(Color.black.opacity(0.45)))
            .opacity(bright ? 1 : 0.3)
            .position(x: x, y: cy - frame.minY)
            // (the taps go to ExitTaps, on the window: here, near the top, neither a SwiftUI button nor a UIKit control
            // got the Simulator's taps, though UIKit's hit test found them; the page under them did, 11-17)
            .allowsHitTesting(false)
            .accessibilityElement()
            .accessibilityLabel("Switch to TRIF view")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { leave() }
            .onAppear { place(hit, x: x, cy: cy) }
            .onChange(of: hit) { _, r in place(r, x: x, cy: cy) }
            .onDisappear { ExitTaps.shared.remove() }
        }
        .task(id: wake) {
            withAnimation(.easeOut(duration: 0.2)) { bright = true }
            try? await Task.sleep(nanoseconds: long ? 3_000_000_000 : 1_500_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.6)) { bright = false }
        }
    }
    /// (development: where it is, in the window's points, for the step {"exitbutton": 1})
    static var placed = ""
    private func place(_ hit: CGRect, x: CGFloat, cy: CGFloat) {
        ExitTaps.shared.rect = hit
        ExitTaps.shared.action = leave
        ExitTaps.shared.install()
        FullScreenExit.placed = "circle (\(Int(x)), \(Int(cy))), taps \(Int(hit.minX))–\(Int(hit.maxX)) × \(Int(hit.minY))–\(Int(hit.maxY))"
    }
}

/// Full screen's exit taps, seen by the window itself (every touch in the app passes the window's recognizers): near
/// the top of the screen in full screen, the Simulator's taps never reached a SwiftUI button or a UIKit control there,
/// though UIKit's hit test found it (11-17); the page under it got them. A tap inside `rect` (window points) calls
/// `action`, and the page doesn't get it.
@MainActor
final class ExitTaps: NSObject, UIGestureRecognizerDelegate {
    static let shared = ExitTaps()
    var rect: CGRect = .zero
    var action: () -> Void = {}
    private var tap: UITapGestureRecognizer?
    func install() {
        guard tap == nil, let w = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return }
        let t = UITapGestureRecognizer(target: self, action: #selector(tapped))
        t.delegate = self
        t.cancelsTouchesInView = true
        t.delaysTouchesBegan = false
        w.addGestureRecognizer(t)
        tap = t
    }
    func remove() { tap?.view?.removeGestureRecognizer(tap!); tap = nil }
    @objc private func tapped(_ t: UITapGestureRecognizer) { if t.state == .ended { action() } }
    nonisolated func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        MainActor.assumeIsolated { rect.contains(touch.location(in: nil)) }
    }
    nonisolated func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

/// Pulling the page down past its top: three choices (+ New Tab, Reload, × Close Tab), Reload chosen at first; the
/// finger sliding left or right chooses another (a tick each time); far enough, a tap of feel, and letting go does it.
/// Not far enough, or pushed back up, and letting go does nothing.
@MainActor
final class PullActions: ObservableObject {
    enum Choice: Int, CaseIterable { case newTab = 0, reload, close }
    /// How far down to pull for it to count.
    static let reach: CGFloat = 70
    @Published private(set) var distance: CGFloat = 0
    @Published private(set) var choice: Choice = .reload
    var armed: Bool { distance >= PullActions.reach }
    /// What the app does with a choice (set by the app).
    var act: (Choice) -> Void = { _ in }
    private var startX: CGFloat?
    private let tick = UISelectionFeedbackGenerator()
    private let tap = UIImpactFeedbackGenerator(style: .light)

    func update(distance d: CGFloat, sideways x: CGFloat) {
        let was = armed
        if distance == 0, d > 0 { startX = x; choice = .reload; tick.prepare() }
        distance = d
        if armed && !was { tap.impactOccurred() }
        // (a third of the way across a choice's column moves to the next: about 45 points on a phone)
        let dx = x - (startX ?? x)
        let c: Choice = dx < -45 ? .newTab : dx > 45 ? .close : .reload
        if c != choice {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { choice = c }
            if armed { tick.selectionChanged() }
        }
    }
    func release() {
        let go = armed ? choice : nil
        cancel()
        if let go { act(go) }
    }
    func cancel() { distance = 0; startX = nil; choice = .reload }
}

/// The three choices in the gap a pull opens above the address bar, where the bar was (Tim, 11-16: as Chrome's, the
/// bar itself comes down with the finger: PullShift): the chosen one in a soft circle that slides between them, its
/// name under it; the reload arrow drawn round as the pull nears far enough.
struct PullActionsView: View {
    @ObservedObject var pull: PullActions
    @ObservedObject var insets: BarInsets
    @Namespace private var ns

    var body: some View {
        if pull.distance > 2 {
            HStack(spacing: 0) {
                item(.newTab, "plus", "New Tab")
                item(.reload, "arrow.clockwise", "Reload")
                item(.close, "xmark", "Close Tab")
            }
            .frame(maxWidth: .infinity)
            .frame(height: max(pull.distance, 0), alignment: .bottom)
            .padding(.bottom, 0)
            .background(.bar)
            .clipped()
            .opacity(Double(min(1, pull.distance / 40)))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func item(_ c: PullActions.Choice, _ symbol: String, _ label: String) -> some View {
        let chosen = pull.choice == c
        let progress = min(1, pull.distance / PullActions.reach)
        return VStack(spacing: 4) {
            ZStack {
                if chosen {
                    Circle().fill(Color.trifGreen.opacity(pull.armed ? 0.22 : 0.10)).frame(width: 46, height: 46)
                        .matchedGeometryEffect(id: "chosen", in: ns)
                }
                if c == .reload && !pull.armed {
                    Circle().trim(from: 0, to: progress).stroke(Color.trifGreen, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90)).frame(width: 30, height: 30)
                }
                Image(systemName: symbol).font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(chosen ? Color.trifGreen : Color.secondary)
            }
            .frame(width: 46, height: 46)
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.trifGreen).opacity(chosen && pull.armed ? 1 : 0)
        }
        .frame(maxWidth: .infinity)
    }
}

/// The address bar moved down with a pull at the page's top, by as much as the page has come down: the choices show
/// in the room it leaves above it; let go, and it springs back up.
struct PullShift: ViewModifier {
    @ObservedObject var pull: PullActions
    func body(content: Content) -> some View {
        content
            .offset(y: max(pull.distance, 0))
            .animation(pull.distance == 0 ? .spring(response: 0.3, dampingFraction: 0.85) : nil, value: pull.distance)
    }
}

/// The full bars' room (changes only when a bar's size does).
@MainActor
final class BarInsets: ObservableObject {
    @Published private(set) var top: CGFloat = 0
    @Published private(set) var bottom: CGFloat = 0
    @Published private(set) var toolbar: CGFloat = 50
    /// The software keyboard is up: the toolbar is down behind it, so what lies over the page leaves it no room.
    @Published private(set) var keyboard = false
    func set(toolbar t: CGFloat) { if abs(t - toolbar) > 0.5 { toolbar = t } }
    func set(keyboard k: Bool) { if k != keyboard { keyboard = k } }
    func set(top t: CGFloat, bottom b: CGFloat) {
        if abs(t - top) > 0.5 { top = t }
        if abs(b - bottom) > 0.5 { bottom = b }
    }
}

/// Room at the foot for the toolbar (the open chat leaves it showing).
struct ToolbarRoom: ViewModifier {
    @ObservedObject var insets: BarInsets
    func body(content: Content) -> some View { content.padding(.bottom, insets.keyboard ? 0 : insets.toolbar) }
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

    /// How far the toolbar has gone: with the page's scrolling, or all the way while the keyboard is up.
    private var gone: CGFloat { bars.keyboardUp ? 1 : bars.progress }

    var body: some View {
        VStack(spacing: 0) {
            notes
            VStack(spacing: 0) {
                middle
                toolbar
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bars.measured(toolbar: $0) }
                    .opacity(Double(1 - gone))
                    .allowsHitTesting(gone < 0.5)
                    .accessibilityHidden(gone >= 0.5)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bars.measured(bottom: $0) }
        }
        .offset(y: gone * bars.toolbarHeight)
    }
}
