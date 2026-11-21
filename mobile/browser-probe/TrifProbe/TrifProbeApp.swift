// TRIF (the iPhone app; its project and types are still named TrifProbe): a browser with TRIF in it, grown from a test app that asked what TRIF could do as its own iPhone browser.
// Not TRIF. See mobile/README.md for what each part is for and what to send back.

import AVFoundation
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

    #if DEBUG
    /// (development, site access) the connected sites and each tab's set: its controller's user scripts, TRIF's handler,
    /// the page's set and whether TRIF may read it.
    static func accessState(_ browser: Browser) -> String {
        var lines = ["connected: \(SiteAccess.shared.sites)", "own sensitive: \(SiteAccess.shared.own)", "scripts made: \(browser.connectedScripts.count) (set \(browser.scriptsVersion))"]
        for (i, t) in browser.tabs.enumerated() {
            let ucc = t.webView.configuration.userContentController
            let b = BrowserWorld.count(ucc), n = ucc.userScripts.count - b
            let c = SiteAccess.shared.card(t.host)
            // ("N user script(s)": TRIF's and the mods'; the browser features' world's apart, on every page)
            lines.append("\(t === browser.current ? "*" : " ")tab \(i) \(t.host.isEmpty ? "-" : t.host): site \(c.site) connected \(c.connected) sensitive \(c.sensitive); controller \(t.accessKey ?? "unset") \(n) user script(s), handler \(t.handlerOn ? "on" : "off"), browser world \(b) script(s); page \(t.pageAccess), readable \((t.webView as? TabWebView)?.readable ?? false)")
        }
        return lines.joined(separator: "\n")
    }

    /// (development, site access) every way the app reads a page, tried on the shown tab through its web view: each is
    /// refused (TRIF.disconnected) on a page TRIF isn't connected on.
    static func readCheck(_ browser: Browser) async -> String {
        let wv = browser.webView
        var out: [String] = []
        func said(_ e: Error?) -> String { (e as NSError?).map { $0.domain == TabWebView.refusedDomain ? "REFUSED" : "error \($0.domain) \($0.code)" } ?? "ran" }
        do { _ = try await wv.callAsyncJavaScript("return 1", arguments: [:], in: nil, contentWorld: Browser.trifWorld); out.append("trif world script: ran") } catch { out.append("trif world script: \(said(error))") }
        do { _ = try await wv.callAsyncJavaScript("return 1", arguments: [:], in: nil, contentWorld: .page); out.append("page world script: ran") } catch { out.append("page world script: \(said(error))") }
        do { _ = try await wv.evaluateJavaScript("1", in: nil, contentWorld: Browser.boxWorld); out.append("box world evaluate: ran") } catch { out.append("box world evaluate: \(said(error))") }
        let e1: Error? = await withCheckedContinuation { c in wv.evaluateJavaScript("1") { _, e in c.resume(returning: e) } }
        out.append("plain evaluate: \(said(e1))")
        let shot: (UIImage?, Error?) = await withCheckedContinuation { c in wv.takeSnapshot(with: nil) { i, e in c.resume(returning: (i, e)) } }
        out.append("screenshot: \(shot.0 != nil ? "taken" : said(shot.1))")
        let pdf: Error? = await withCheckedContinuation { c in wv.createPDF { r in if case .failure(let e) = r { c.resume(returning: e) } else { c.resume(returning: nil) } } }
        out.append("pdf: \(said(pdf))")
        let arch: Error? = await withCheckedContinuation { c in wv.createWebArchiveData { r in if case .failure(let e) = r { c.resume(returning: e) } else { c.resume(returning: nil) } } }
        out.append("web archive: \(said(arch))")
        let o = await browser.outline()
        out.append("outline: \(o == nil ? "none (\(browser.status))" : "\(o!.chars) chars")")
        let p = await browser.pageForChat()
        out.append("page for chat: \(p == nil ? "none" : "\(p!.count) chars")")
        let q = await browser.quickScreenshot()
        out.append("quick screenshot: \(q == nil ? "none" : "taken")")
        // (the browser features' world: any other call into it refused on every site; their own calls run on every site)
        do { _ = try await wv.callAsyncJavaScript("return 1", arguments: [:], in: nil, contentWorld: BrowserWorld.world); out.append("browser world, another call: ran") } catch { out.append("browser world, another call: \((error as NSError).domain == TabWebView.browserWorldDomain ? "BLOCKED" : said(error))") }
        do { _ = try await wv.evaluateJavaScript("1", in: nil, contentWorld: BrowserWorld.world); out.append("browser world, another evaluate: ran") } catch { out.append("browser world, another evaluate: \((error as NSError).domain == TabWebView.browserWorldDomain ? "BLOCKED" : said(error))") }
        if let t = wv as? TabWebView {
            do { out.append("browser feature's own call (playing): ran, \(try await t.browserFeature(.playing) ?? "nil")") } catch { out.append("browser feature's own call (playing): \(said(error))") }
        }
        return out.joined(separator: "\n")
    }

    /// (development, the browser features' world, 11-20) What each of the other worlds in the shown page can see of
    /// the browser world: its globals (__trifVideo), its handler (trifBrowser); a post tried if one is found.
    static func browserReach(_ browser: Browser) async -> String {
        let probe = """
            const w = globalThis;
            const h = (w.webkit && w.webkit.messageHandlers) || null;
            const names = h ? ['trifBrowser', 'trif', 'app', 'panel', 'chat'].filter((n) => { try { return !!h[n]; } catch (e) { return false; } }) : [];
            let posted = 'no handler to post to';
            if (h && h.trifBrowser) { try { await h.trifBrowser.postMessage({ type: 'videostate', url: 'x', time: 1 }); posted = 'POSTED'; } catch (e) { posted = 'refused: ' + e.message; } }
            return JSON.stringify({ video: typeof w.__trifVideo, webkit: typeof w.webkit, handlers: names, posted,
              globals: Object.getOwnPropertyNames(w).filter((k) => /trifvideo|trifbrowser/i.test(k)),
              pause: [...document.querySelectorAll('video, audio')].filter((m) => '__trifPause' in m || '__trifPlayedOn' in m).length });
            """
        var out: [String] = []
        for (name, world) in [("page", WKContentWorld.page), ("trif", Browser.trifWorld), ("box", Browser.boxWorld), ("chat", ClaudePane.chatWorld)] {
            let r = await browser.call(probe, in: world)
            out.append("\(name): \(r.text ?? "error \(r.error ?? "?")")")
        }
        return out.joined(separator: "\n")
    }
    #endif
    let report: Report
    let browser: Browser
    let pane: ClaudePane
    let modsPanel: ModsPanel
    /// The address bar and toolbar's state as the page scrolls (BarState): its own object, so only the bars redraw.
    let bars = BarState()

    init() {
        DevFlags.dropArgumentDefaults()
        let report = Report()
        let browser = Browser(report: report)
        self.report = report
        self.browser = browser
        self.pane = ClaudePane(report: report, browser: browser)
        LocalModels.shared.wake() // (a model download iOS kept going while the app was away)
        self.modsPanel = ModsPanel(browser: browser)
        #if DEBUG
        // For the Simulator and CI: `-autorun plain,strict,…` (the probe's own pages, or full addresses) runs the
        // checks on each page in turn, as the Checks sheet's button does, and saves them in the report.
        let args = DevFlags.args
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
        #endif
        // (development) steps, one at a time, for driving the app in the Simulator without touching it: write
        // Documents/step.json, then `xcrun simctl spawn <device> notifyutil -p com.trif.probe.step`. What a step's
        // script returns goes to Documents/step-out.txt. Steps: {"sheet": "mods|tabs|history|chat|none"},
        // {"modsjs": "…"} (in the Mods tab's page), {"pagejs": "…"} (in the shown tab's page), {"go": "…"},
        // {"newtab": "…"}, {"select": n}, {"close": n}, {"back": true}.
        // (Release has none of it: the Darwin observer, step.json, every step and the development launch flags are
        // compiled only into Debug builds, the Simulator's. Security batch 11-20: a step runs any JavaScript in any
        // page, the signed-in chats' too, reads cookies and approves mods.)
        Model.pane = self.pane
        LeavingCover.shared.browser = browser
        PhoneSyncModel.shared.applied = { ids in browser.syncApplied(ids) }
        SpeechInput.pauseMedia = { BackgroundPlay.pauseForTalk(browser) }
        SpeechInput.resumeMedia = { BackgroundPlay.resumeAfterTalk(browser) }
        PhoneSyncModel.shared.start(store: browser.mods)
        #if DEBUG
        let panel = self.modsPanel
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
        #endif
    }
}

extension Model {
    static weak var pane: ClaudePane?
    /// (development: the robotHold step, as ContentView's gesture on the robot; only the Debug build's step posts it)
    static let robotHoldStep = Notification.Name("trif.robotHoldStep")
}

#if DEBUG
extension Model {
    static var stepRunner: (() -> Void)?
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
        // ({"reload": "why"}: the shown tab loaded again by the app, as its own reloads are; {"videos": 1}: each tab's
        // video as last told (VideoResume), and the note shown)
        if let why = step["reload"] as? String { browser.reload(why) }
        // ({"hashtest": "/path", "old": false}: LocalModels.sha256 on a big file as a model's check runs it, the app's
        // memory footprint sampled every 0.1 s: its start, its most, its end; "old": the reading before 11-18)
        if let path = step["hashtest"] as? String { out = await Model.hashTest(URL(fileURLWithPath: path), old: step["old"] as? Bool ?? false) }
        if step["videos"] != nil {
            out = browser.tabs.enumerated().map { i, t in
                let v = t.video.map { "\(VideoResume.clock($0.time)) (\(String(format: "%.1f", $0.time)) s) \($0.playing ? "playing" : "paused") of \(String(format: "%.0f", $0.duration)) s\($0.live ? " live" : "")\($0.muted ? " muted" : "") \(Int(Date().timeIntervalSince($0.at))) s ago, \($0.url)" } ?? "none"
                return "\(i)\(t === browser.current ? "*" : " ") \(t.host.nonEmpty ?? "-"): \(v)"
            }.joined(separator: "\n") + "\nnote: \(browser.status)"
        }
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
        // ({"toolbarwatch": 1}: the last taps on the toolbar that did nothing, as ToolbarWatch would log them)
        if step["toolbarwatch"] != nil { out = "busy: \(ToolbarWatch.busy()); bar \(ToolbarWatch.shared.bar)\nlogged:\n" + ToolbarWatch.shared.recent.joined(separator: "\n") + "\nseen:\n" + ToolbarWatch.shared.seen.joined(separator: "\n") }
        // ({"phonelink": 1}: the phone link's self-test, PhoneLink.swift: the published Noise vector and the frames vector)
        if step["phonelink"] != nil { out = "phone link self-test: " + (PhoneLink.selfTest() ?? "ok") }
        // ({"phonepair": 1}: the pairing's state; {"phonepair": "trif://pair?…"}: pair with that code (with
        // -linkhost, at that address); {"phonepair": "forget"}: forget the computer)
        if let v = step["phonepair"] {
            let m = PhoneLinkModel.shared
            if let text = v as? String, text == "forget" { m.forget() } else if let text = v as? String, text == "noask" { m.asking = nil; m.shown = false } else if let text = v as? String { m.open(text) }
            out = "phone link: " + m.describe
        }
        // ({"phonedrop": 1}: More's link to the computer lost as a suspended app loses it; it reconnects after its waits,
        // or at once when the app comes back to the front)
        // ({"sync": 1}: Sync now; {"syncstate": 1}: what the last sync did, and the mods' ids and Recently deleted)
        if step["sync"] != nil { PhoneSyncModel.shared.syncNow(); out = "sync asked" }
        if step["syncstate"] != nil {
            let m = browser.mods
            out = "sync: \(PhoneSyncModel.shared.syncing ? "running" : "idle"); last: \(PhoneSyncModel.shared.describe)\nmods: \(m.mods.map { "\($0.id)\($0.on ? "" : " off")\($0.offSites.isEmpty ? "" : " off on \($0.offSites.joined(separator: ","))")\($0.held ? " held" : "")\($0.newOff.map { " mark \($0)" } ?? "")\(m.allowedOnComputer($0) ? " allowed-there" : "")\($0.switchAt.map { " at \(Int($0))" } ?? "")\(m.keptUids[$0.id].map { " uid \($0)" } ?? "")\(m.syncHintsKept[m.syncKey($0)] != nil ? " hint" : "")" }.sorted())\ndeleted: \(m.trash.map { "\($0.mod.id) by \($0.by)" })"
        }
        // (safe mode's snapshots: {"snapshots": 1} lists them; {"restoresnap": 0 | "<id prefix>"} puts one back as the
        // ⋯ menu does; {"bannerrestore": 1} the shown site's banner's Turn them back on; {"safetystate": 1} what's
        // listed as switched off by TRIF; {"enable": {"id", "on", "site"}} a switch as the Mods tab sends it; {"toast": 1})
        if step["snapshots"] != nil { out = browser.safety.describeSnapshots }
        if let r = step["restoresnap"] {
            let list = browser.safety.snapshots
            let id = (r as? Int).flatMap { $0 < list.count ? list[$0].id : nil } ?? (r as? String).flatMap { p in list.first { $0.id.hasPrefix(p) }?.id }
            out = id.flatMap { browser.restoreSwitches($0) }.map { "restored \($0.restored) changed \($0.changed) gone \($0.gone) waiting \($0.waiting): \(Safety.restoreWords($0))" } ?? "no such snapshot"
        }
        if step["bannerrestore"] != nil {
            if let id = browser.safety.switchedOff[browser.site]?.snap, let r = browser.restoreSwitches(id) { out = "restored \(r.restored) changed \(r.changed): \(Safety.restoreWords(r))" } else { out = "no banner with a snapshot on \(browser.site)" }
        }
        if step["safetystate"] != nil { out = browser.safety.switchedOff.map { "\($0.key): \($0.value.ids) \($0.value.why) snap \($0.value.snap?.prefix(8) ?? "-")" }.sorted().joined(separator: "\n").nonEmpty ?? "nothing switched off by TRIF" }
        if let e = step["enable"] as? [String: Any] {
            var d: [String: Any] = ["type": "enable", "id": e["id"] as? String ?? "", "enabled": e["on"] as? Bool ?? true]
            if let site = e["site"] as? String { d["site"] = site }
            let a = await panel.handle(d)
            out = a.1.map { "refused: \($0)" } ?? "ok"
        }
        if step["toast"] != nil { out = AppToast.shared.describe }
        // ({"panelmsg": {"type": "delete", "id": …}}: any Mods tab message, as its page sends it (the mod matrix's clean-up);
        // {"modlist": "site or empty"}: each mod's id, name, site, on, held, history count and its code's length)
        if let m = step["panelmsg"] as? [String: Any] {
            let a = await panel.handle(m)
            out = a.1.map { "refused: \($0)" } ?? "ok"
        }
        if let s = step["modlist"] as? String {
            out = browser.mods.mods.filter { s.isEmpty || $0.site == s || $0.sites.contains(s) }
                .map { "\($0.id)\t\($0.name)\t\($0.site)\t\($0.on ? "on" : "off")\($0.held ? " held" : "")\thistory \($0.history.count)\t\($0.code.count)" }.joined(separator: "\n")
        }
        // ({"rename": [id, "New name"]}: the Mods tab's Rename, as its Save sends it; {"modcode": id}: a mod's file now;
        // {"modreads": [text, here]}: what readNamed makes of a chat's code (the id it'd be kept under, its @id))
        if let r = step["rename"] as? [String], r.count == 2 {
            let a = await panel.handle(["type": "rename", "id": r[0], "name": r[1]])
            out = a.1.map { "refused: \($0)" } ?? "renamed: \(browser.mods.mods.first { $0.name == r[1].trimmingCharacters(in: .whitespaces) }.map { "\($0.id) uid \($0.uid ?? "none") on \($0.on) held \($0.held) mark \($0.newOff ?? "none") history \($0.history.count)" } ?? "?")"
        }
        if let id = step["modcode"] as? String { out = browser.mods.mods.first { $0.id == id }?.code ?? "no mod \(id)" }
        if let r = step["modreads"] as? [String], r.count == 2 {
            let x = await browser.mods.readNamedInBackground(r[0], here: r[1])
            out = x.mod.map { "reads as \($0.id) uid \($0.uid ?? "none")" } ?? "unreadable: \(x.error ?? "?")"
        }
        if step["phonedrop"] != nil, let l = Model.pane?.panel.link { l.drop(); out = "phone link: \(l.state), following \(l.following.count)" }
        if step["exitbutton"] != nil { out = "exit button centre \(FullScreenExit.placed)" }
        // (quick ask, QuickAsk.swift: {"quick": "words"} as the box sends them; {"quickstate": 1}; {"quickundo": 1},
        // {"quickopen": 1} (the pill tapped), {"quickcancel": 1} (the strip's ✕), {"quickexpand": 1})
        if let pane = Model.pane {
            if let t = step["quick"] as? String { pane.quickAsk(t) }
            if step["quickundo"] != nil { pane.quickUndo() }
            if step["quickopen"] != nil { pane.quickOpen() }
            if step["quickcancel"] != nil { pane.cancelStrip() }
            if step["quickexpand"] != nil { pane.expandStrip() }
            if ["quick", "quickstate", "quickundo", "quickopen", "quickcancel", "quickexpand"].contains(where: { step[$0] != nil }) { out = pane.quickDescribe }
            // ({"enginelabel": 1}: Go to chat's words for what the chat will use, More's looked at again)
            if step["enginelabel"] != nil {
                if pane.more, let l = await pane.panel.engineLabel() { out = "engine: \(l.text)\(l.fix.map { " (fix \($0))" } ?? "")" } else { out = "engine: \(pane.engineLabel.text)" }
            }
        }
        // (talking: {"speech": 1} the permissions and the recognizer; {"speechfile": "/path.wav"} the recognizer on a
        // recorded file; {"micpress": 1} / {"micrelease": 1} the box's microphone pressed and let go)
        if step["speech"] != nil { SpeechInput.shared.check(); out = SpeechInput.shared.describe }
        if let f = step["speechfile"] as? String { out = await SpeechInput.shared.recognize(file: URL(fileURLWithPath: f)) }
        // ({"mictap": 1} pressed and lifted at once: tap-listening; {"micstop": 1} the stop tap (= micrelease);
        // {"micx": 1} the ✕; {"miccancel": 1} a slide away; {"micinterrupt": 1} an audio interruption beginning, as a
        // call's; {"micstate": 1} the phase, the words, the box, what was asked; {"micdraft": "words"} the box's words;
        // {"robothold": 1 | 0 | "away"} the robot held / let go / let go after sliding away, as ContentView's gesture)
        let speech = SpeechInput.shared
        if step["micpress"] != nil || step["mictap"] != nil {
            speech.press { words in Model.pane?.quickAsk(words) }
            try? await Task.sleep(nanoseconds: 300_000_000)
            if step["mictap"] != nil { speech.keepListening() }
            out = speech.state
        }
        if let d = step["micdraft"] as? String { speech.draft = d; out = speech.state }
        if step["micrelease"] != nil || step["micstop"] != nil { speech.release(); try? await Task.sleep(nanoseconds: 3_000_000_000); out = speech.state }
        if step["micx"] != nil { speech.keep(); out = speech.state }
        if step["miccancel"] != nil { speech.cancel(); out = speech.state }
        if step["micinterrupt"] != nil {
            NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                                            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
            try? await Task.sleep(nanoseconds: 300_000_000)
            out = speech.state
        }
        if let h = step["robothold"] {
            NotificationCenter.default.post(name: Model.robotHoldStep, object: nil, userInfo: ["hold": "\(h)"])
            try? await Task.sleep(nanoseconds: (("\(h)" == "1") ? 900 : 3_000) * 1_000_000)
            out = speech.state
        }
        if step["micstate"] != nil { out = speech.state }
        // ({"modsstale": 1} each tab: its page, shown or not, and whether the mods running there changed since it loaded)
        if step["modsstale"] != nil {
            out = browser.tabs.enumerated().map { i, t in
                let stale = TabReloadRules.stale(t.modsLoaded?.signature, now: t.modsLoaded.map { browser.mods.signature($0.url) } ?? "")
                return "\(i) \(t === browser.current ? "shown" : "behind") \(t.webView.url?.absoluteString ?? "-") \(stale == nil ? "not loaded" : stale! ? "stale (loads again when shown)" : "up to date")"
            }.joined(separator: "\n")
        }
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
        // ({"rebuild": {"n": 5, "on": true}}: every mod switched on first (with "on"), then n changes to the mods in a
        // row, as the Mods tab's switches make them: the main thread's time for each and the hangs meanwhile)
        if let o = step["rebuild"] as? [String: Any] { out = await Model.rebuildCheck(browser: browser, n: o["n"] as? Int ?? 5, allOn: o["on"] as? Bool ?? false) }
        // (site access, 11-20: {"connect": "host or address"} / {"disconnect": …} as the card's Connect and ⋯'s Disconnect;
        // {"access": 1}: the connected sites, the person's own sensitive ones, and each tab's set (its controller's user
        // scripts, TRIF's handler on it, the page's set, readable); {"readcheck": 1}: every way of reading the shown page
        // tried through the tab's web view, what came back; {"sensitiveown": "pattern" | "-pattern"}; {"accessupgrade":
        // 1}: the first-start rule run again (its flag cleared) with today's mods and icons)
        if let h = step["connect"] as? String { SiteAccess.shared.connect(URL(string: h)?.host ?? h, why: "development step"); out = "connected: \(SiteAccess.shared.sites)" }
        if let h = step["disconnect"] as? String { SiteAccess.shared.disconnect(URL(string: h)?.host ?? h, why: "development step"); out = "connected: \(SiteAccess.shared.sites)" }
        if let p = step["sensitiveown"] as? String {
            if p.hasPrefix("-") { SiteAccess.shared.removeOwn(String(p.dropFirst())); out = "own: \(SiteAccess.shared.own)" }
            else { out = SiteAccess.shared.addOwn(p) ? "own: \(SiteAccess.shared.own)" : "refused" }
        }
        if step["accessupgrade"] != nil {
            UserDefaults.standard.set(false, forKey: "siteAccess.upgraded")
            if let keep = step["keep"] as? [String] { UserDefaults.standard.set(keep, forKey: "connectedSites") }
            out = "run at next launch; connected now \(SiteAccess.shared.sites)"
        }
        if step["access"] != nil { out = Model.accessState(browser) }
        if step["readcheck"] != nil { out = await Model.readCheck(browser) }
        // ({"browserreach": 1}: what the page's, TRIF's, the box's and chat.js's worlds see of the browser features' world
        // in the shown page; {"browseraccept": [body…]}: BrowserWorld.accept's answer for each)
        if step["browserreach"] != nil { out = await Model.browserReach(browser) }
        if let bodies = step["browseraccept"] as? [Any] { out = bodies.map { BrowserWorld.accept($0).map { "ok \($0.keys.sorted())" } ?? "refused" }.joined(separator: "\n") }
        // ({"tabjs": "…", "tab": n}: JavaScript in tab n's page, shown or not)
        if let js = step["tabjs"] as? String, let n = step["tab"] as? Int, n < browser.tabs.count {
            do { out = "\(try await browser.tabs[n].webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        // ({"desktop": true|false}: ⋯ → Request Desktop / Mobile Website on the shown page; {"desktopstate": 1}: the
        // sites kept and each tab's mode)
        if let d = step["desktop"] as? Bool { browser.requestDesktop(d); out = "asked \(d ? "desktop" : "mobile")" }
        if step["desktopstate"] != nil { out = "sites: \(browser.desktopHosts.sorted()); tabs: " + browser.tabs.map { ($0 === browser.current ? "*" : "") + ($0.host.isEmpty ? "-" : $0.host) + ($0.desktop ? " desktop" : " mobile") + (($0.webView.customUserAgent ?? "").isEmpty ? "" : " (Mac agent)") }.joined(separator: ", ") }
        // ({"tabshots": 1}: each tab's picture for the tab list, and the pictures' folder; {"privatepage": ["https://…"]}:
        // whether each would be pictured, Tabs.swift PrivatePages)
        if step["tabshots"] != nil { out = TabShots.shared.describe(browser.tabs, current: browser.current) }
        if let us = step["privatepage"] as? [String] { out = us.map { u in "\(u): \(URL(string: u).flatMap(PrivatePages.why) ?? "pictured")" }.joined(separator: "\n") + "\n\(PrivatePages.sensitive.count) sensitive patterns" }
        // ({"cover": 1}: the leaving cover's rule now and its last steps; {"cover": "show"}: up for 6 s, LeavingCover.swift)
        if let c = step["cover"] { if c as? String == "show" { LeavingCover.shared.showForCheck() }; out = LeavingCover.shared.describe() }
        // ({"tabsfocus": 1}: the card the tab list last opened at: its index and host, and the shown tab's)
        if step["tabsfocus"] != nil {
            let i = browser.tabs.firstIndex { $0.id == TabsView.lastFocus }
            out = "list opened at \(i.map(String.init) ?? "-") \(i.map { browser.tabs[$0].host } ?? ""); shown tab \(browser.tabs.firstIndex { $0 === browser.current } ?? -1) \(browser.host)"
        }
        if step["tabhosts"] != nil { out = browser.tabs.map { ($0 === browser.current ? "*" : "") + ($0.host.isEmpty ? "-" : $0.host) }.joined(separator: " ") }
        if let p = step["import"] as? String { browser.importFiles(p.split(separator: ",").map { URL(fileURLWithPath: String($0)) }) }
        // ({"offer": text, "site": "…"}: pasted, or with a site an Add to TRIF tap in that chat)
        if let t = step["offer"] as? String { browser.offer(text: t, site: step["site"] as? String ?? "") }
        if step["cancelOffer"] != nil { browser.modOffer = nil }
        // ({"offerchat": [code…], "site": "…", "path": "auto"}: as a chat hands mods over; what was offered, and the
        // offer shown. {"offerstate": 1}: the offer shown and the queue)
        if let texts = step["offerchat"] as? [String] {
            let got = await browser.offerFromChat(texts, from: step["site"] as? String ?? "", path: step["path"] as? String ?? "auto")
            out = "offered: \(got.map(\.id).joined(separator: ", ").nonEmpty ?? "none")"
        }
        if step["offerstate"] != nil { out = "shown: \(browser.modOffer.map { "\($0.id) \($0.code.count) \($0.tier) sites \($0.sites) powers \($0.powers) held \($0.held) warnings \($0.warnings) everywhere \($0.everywhere) came \($0.cameFrom ?? "-") edits \($0.edits.map { "\($0.count)" } ?? "-")" } ?? "none"), queued: \(browser.offerQueue.count)" }
        if step["bodies"] != nil { out = "\(Diagnostics.shared.bodies) bodies" }
        if step["addOffer"] != nil, let m = browser.modOffer { browser.modOffer = nil; browser.addMod(m) }
        if step["status"] != nil { out = browser.status }
        // (another app's link: the question up now, if any, and the note)
        if step["applink"] != nil { out = "question: \(browser.appLinkAsking ?? "none"); note: \(browser.status)" }
        if step["copydiag"] != nil { browser.copyDiagnostics() }
        // (security batch, 11-20: {"diaglog": [kind, text]} a line put in the log as the app would; {"diagtext": 1} the
        // text Copy diagnostics copies; {"iconlink": "https://…/"} the link TRIF's icon for that site carries (its key
        // in it); {"linkopen": "trif://…"} how TrifLink takes a link (full screen or a tab, and why); {"outside": 1}
        // the offers from outside waiting; {"watchfolder": "/path" | ""} that folder watched (as picked in Files) or
        // none, {"folderscan": 1} looked through now)
        if let l = step["diaglog"] as? [String], l.count == 2 { Diagnostics.shared.log(l[0], l[1]); out = "logged" }
        if step["diagtext"] != nil { out = Diagnostics.shared.text() }
        if let u = step["iconlink"] as? String, let site = URL(string: u) { out = TrifLink.link(to: site).absoluteString }
        if let u = step["linkopen"] as? String, let url = URL(string: u) { out = "\(TrifLink.open(url))" }
        if step["outside"] != nil { out = "waiting \(browser.outsideWaiting), reading \(browser.outsideReading), ids \(browser.outsideIds.sorted()), shown \(browser.modOffer?.id ?? "none"), queued \(browser.offerQueue.map(\.id))" }
        if let f = step["watchfolder"] as? String {
            if f.isEmpty { FolderWatch.shared.stop() } else { try? FileManager.default.createDirectory(atPath: f, withIntermediateDirectories: true); FolderWatch.shared.choose(URL(fileURLWithPath: f, isDirectory: true)) }
            out = "watching \(FolderWatch.shared.folderName ?? "none")"
        }
        if step["folderscan"] != nil { FolderWatch.shared.scan("the dev step"); out = "scanning" }
        if step["resethint"] != nil { UserDefaults.standard.removeObject(forKey: "fullScreenHinted") }
        if step["fullscreen"] != nil { browser.toggleFullScreen(); out = "full screen: \(browser.fullScreen), note: \(browser.status)" }
        if step["chat"] != nil, let p = Model.pane { out = "shown: \(p.shown), activity: \(p.activity.rawValue), at: \(p.webView.url?.absoluteString ?? "nothing")" }
        if step["chats"] != nil, let p = Model.pane { out = p.views.map { "\($0 === p.cur ? "*" : " ") \($0.site.isEmpty ? "-" : $0.site) \($0.activity.rawValue) \($0.webView.url?.path ?? "nothing")" }.joined(separator: "\n") }
        if let i = step["showchat"] as? Int, let p = Model.pane, i < p.views.count { p.show(p.views[i]) }
        // ({"links": 1}: the chat links, newest first, and the banners; {"gosite": n} / {"openlink": n}: link n's Go to
        // <site> / its chat; {"banner": "add|go|open|dismiss"}: the banner shown's button; {"tabbadges": 1})
        if let p = Model.pane {
            if step["links"] != nil {
                out = p.links.map { l in "\(l.service) \(l.site) \(l.state.rawValue) tab \(browser.tabs.firstIndex { t in t.id == l.tab }.map(String.init) ?? "closed") \(l.conv?.suffix(12) ?? "-") \(l.tabTitle)" }.joined(separator: "\n")
                out += "\nbanners: " + p.banners.map { "\($0.site) \($0.mods.map(\.id))\($0.unreadable.map { " unreadable: \($0)" } ?? "")\($0.inChat > 0 ? " in chat \($0.inChat)" : "")" }.joined(separator: "; ")
                out += "\nshown tab \(browser.tabs.firstIndex { $0 === browser.current } ?? -1) \(browser.site), covers \(ContentView.coversNow), offer \(browser.modOffer.map { "\($0.id) runs on \($0.sites) came from \($0.cameFrom ?? "-")" } ?? "none")"
            }
            // ({"sentnotes": 1}: the notes of sends whose replies TRIF hasn't seen end (SentNotes), newest first;
            // {"pickup": 1}: picked up now, as at a launch)
            if step["sentnotes"] != nil { out = p.sentNotes.all.map { "\($0.key) \($0.conv?.suffix(14) ?? "-") \(Int(Date().timeIntervalSince($0.at))) s ago users \($0.users) print \($0.print ?? "-")\($0.quick != nil ? " quick" : "")" }.joined(separator: "\n").nonEmpty ?? "none" }
            if step["pickup"] != nil { p.pickUp("the dev step") }
            if let n = step["gosite"] as? Int, n < p.links.count { p.goToSite(p.links[n].id) }
            if let n = step["openlink"] as? Int, n < p.links.count { p.openChat(p.links[n].id) }
            if let b = step["banner"] as? String, let first = p.banners.first {
                switch b { case "add": p.addFromBanner(first); case "go": p.goToSite(first.link); case "open": p.openChat(first.link); default: p.dismissBanner(first) }
            }
            // ({"unread": 1}: each tab's unread count from its title, the icon tabs, TRIF's icon badge and the permission;
            // {"unreadanswer": true|false}: TRIF's words before iOS's question answered Continue / Not now)
            if step["unread"] != nil { out = await UnreadCounts.shared.describe() }
            if let a = step["unreadanswer"] as? Bool { UnreadCounts.shared.answer(allow: a); out = "answered \(a ? "Continue" : "Not now")" }
            if step["tabbadges"] != nil { out = browser.tabs.enumerated().map { "\($0.offset) \($0.element.host.nonEmpty ?? "-"): \(p.badge(for: $0.element.id).map(\.rawValue) ?? "none")" }.joined(separator: "\n") }
        }
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
        // ({"chatjs": "…"}: in the shown chat page's TRIF world, where Web/chat.js runs: `return __trifChat.state()`;
        // {"chatlook": 1}: chat.js look() called as ChatView.tellLook calls it, its answer or error)
        if let js = step["chatjs"] as? String, let wv = Model.pane?.webView {
            do { out = "\(try await wv.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: ClaudePane.chatWorld) ?? "nil")" } catch { out = "error: \(error)" }
        }
        if step["chatlook"] != nil, let p = Model.pane {
            do { out = "\(try await p.webView.callAsyncJavaScript("return globalThis.__trifChat && globalThis.__trifChat.look ? globalThis.__trifChat.look(site, shape) : 'no __trifChat';", arguments: ["site": p.site, "shape": ChatView.robotShape], in: nil, contentWorld: ClaudePane.chatWorld) ?? "nil")" } catch { out = "error: \(error)" }
        }
        // (the robot view's More: chosen, and JavaScript in the side panel's page)
        if let m = step["more"] as? Bool { Model.pane?.choose(more: m, service: m ? nil : .claude) }
        if let sv = step["service"] as? String, let s = ChatService(rawValue: sv) { Model.pane?.choose(more: false, service: s) }
        // (TRIF's chats in a project, 11-20: {"projectstate": 1}: each service's card answer, kept project, whether its
        // instructions are in it, and each chat's setup; {"projectsetup": "Claude"}: ⋯'s Set it up for that service)
        if step["projectstate"] != nil, let p = Model.pane {
            out = ChatService.allCases.map { "\($0.rawValue): offer \($0.offerState.rawValue), project \($0.project?.absoluteString ?? "none"), guide \($0.projectHasGuide)" }.joined(separator: "\n")
            out += "\n" + p.views.map { "chat \($0.service.rawValue) \($0.site.isEmpty ? "-" : $0.site): setup \($0.setup.map { "\($0.stage.rawValue) create \($0.createSeen) closed \($0.closed) project \($0.project ?? "-")" } ?? "none")" }.joined(separator: "\n")
        }
        if let sv = step["projectsetup"] as? String, let s = ChatService(rawValue: sv), let p = Model.pane { p.choose(more: false, service: s); p.setUpProject(why: "the dev step") }
        if let js = step["paneljs"] as? String, let wv = Model.pane?.panel.webView {
            do { out = "\(try await wv.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page) ?? "nil")" } catch { out = "error: \(error)" }
        }
        try? out.write(to: docs.appendingPathComponent("step-out.txt"), atomically: true, encoding: .utf8)
    }
}
#endif

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
    /// The robot's long press: the chats' list (ChatListView).
    @State private var showChatList = false
    /// The quick ask's strip is drawn (a moment longer than it's up, so it can slide away).
    @State private var stripLayer = false
    @State private var stripUp = false
    /// The card the tab list opens at (nil: the shown tab's).
    @State private var tabsFocus: UUID?
    /// (the robot's long press just opened the list or talked: the tap that ends it doesn't also open the list)
    @State private var robotHeld = false
    /// The robot held (Tim, 11-18: hold to talk): the finger came down at; listening; slid far enough to cancel.
    @State private var robotDown: Date?
    @State private var robotHoldWait: Task<Void, Never>?
    @State private var holdTalk = false
    @State private var holdAway = false
    /// The robot's finger is down as SwiftUI's gesture sees it (back to false however the gesture ends, cancelled too).
    @GestureState private var robotTouching = false
    /// A hold ended by something else while the finger is still down: nothing more from that finger (no second hold).
    @State private var robotSpent = false
    @State private var showMods = false
    @State private var addingIcon = false
    @ObservedObject private var phoneLink = PhoneLinkModel.shared
    /// The list of Home Screen icons waiting (IconQueueView).
    @State private var showIconQueue = false
    /// The quick ask whose Working pill was tucked away (its ✕): hidden until it's done (QuickPill.tuck).
    @State private var quickTucked: UUID?
    @ObservedObject private var iconQueue = IconQueue.shared
    @State private var pickingFolder = false
    @State private var askingProject = false
    /// ⋯'s Hide the full screen button (off at first): the two-finger hold is then the only way out.
    @AppStorage("fullScreenButtonHidden") private var hideExitButton = false
    /// ⋯'s Show unread counts (on at first): the sites' own counts on the tab cards and TRIF's icon (UnreadCounts).
    @AppStorage(UnreadCounts.settingKey) private var showUnread = true
    @ObservedObject private var unread = UnreadCounts.shared
    @ObservedObject private var folder = FolderWatch.shared
    @State private var importing = false
    /// Site access (Tim 11-20): the connections, the person's sensitive sites, the one-time note.
    @ObservedObject private var access = SiteAccess.shared
    @State private var showSensitive = false
    /// The shown tab's website's host ("" for no website): the robot's card is for it.
    private var webHost: String {
        guard let u = browser.webView.url ?? browser.current?.savedURL, ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { return "" }
        return SiteAccess.host(u)
    }
    /// The shown tab is a website TRIF isn't connected on: the robot is drawn quieter, and anything that would read the
    /// page shows the card.
    private var disconnectedHere: Bool { let _ = access.changes; return !webHost.isEmpty && !access.isConnected(webHost) }

    /// Mods waiting for the user's OK on this site (the Mods button's badge, as the panel's waiting badge).
    private var waitingHere: Int {
        browser.mods.mods.filter { $0.held && ($0.everywhere || SiteAccess.shared.scope($0.site) == browser.site || $0.sites.contains { SiteAccess.shared.scope($0) == browser.site }) }.count
    }

    var body: some View {
        let _ = Diagnostics.shared.bodyRan("the browser's main view")
        page
        .onChange(of: coverNames, initial: true) { _, now in ContentView.coversNow = now }
        .onChange(of: phase) { was, p in
            // (safe mode: the record is unclean only while the app is in front; Safety follows UIKit's own notices too)
            browser.safety.active(p == .active)
            // (inactive on the way in too, from the background: "left the front" only on the way out; 11-17, Tim's
            // diagnostics read as if the app had left three times)
            // (the shown tab's picture as the app leaves; not on the way back in, when its page may not have drawn yet)
            if p != .active { browser.saveTabs(); browser.history.saveNow(); VideoStore.shared.saveNow(); if p == .inactive, was == .active { browser.snapshot(nil, "the app left the front") } }
            // (a hold going on as the app leaves the front: ended, its words kept)
            if p != .active { robotEnded("the app left the front", stop: false) }
        }
        // (the hold's listening stopped by something else (a call, an error): the pill and the hold go with it)
        // ($phase tells before the change is made (willSet): only the hold's own state goes back here, a turn later)
        .onReceive(SpeechInput.shared.$phase) { now in
            guard holdTalk, now != .listening, now != .finishing else { return }
            Task { @MainActor in if holdTalk, SpeechInput.shared.phase != .listening, SpeechInput.shared.phase != .finishing { robotEnded("listening stopped (\(SpeechInput.shared.phase))", stop: false) } }
        }
        // (a link UIKit handed over that onOpenURL never brought: opened once the app has been in front 2 s)
        .onChange(of: phase, initial: true) { _, p in
            guard p == .active, PendingLink.url != nil else { return }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard let u = PendingLink.url, phase == .active else { return }
                PendingLink.url = nil
                Diagnostics.shared.log("link", "onOpenURL never brought the link (\(Int(Date().timeIntervalSince(PendingLink.since))) s since it came): opened now")
                openLink(u)
            }
        }

        .alert(item: $safety.offer) { o in
            let name = o.likely.flatMap { id in browser.mods.mods.first { $0.id == id }?.name }
            return Alert(title: Text("\(o.site) keeps this iPhone busy"),
                         message: Text(o.why == "ended" ? "Its page stopped twice in three minutes while mods ran on it. Switch them off?" : "Its page has been busy most of the time for 40 seconds while mods ran on it. Switch them off?\(name.map { " \($0) changed most recently." } ?? "")"),
                         primaryButton: .destructive(Text("Switch off its mods")) { browser.safety.accept(o, only: nil, store: browser.mods); browser.modsChanged(why: "a runaway page's mods switched off") },
                         secondaryButton: .cancel(Text("Not now")) { browser.safety.offer = nil })
        }
        .onChange(of: showUnread) { _, on in unread.settingChanged(on) }
        // (before iOS's question, once, at the first count on a Home Screen icon tab: what the badge is and that
        // nothing else comes of it; Continue asks iOS for the badge only. UnreadCounts)
        .alert("Unread counts on TRIF’s icon", isPresented: $unread.asking) {
            Button("Not now", role: .cancel) { unread.answer(allow: false) }
            Button("Continue") { unread.answer(allow: true) }
        } message: {
            Text("Your Home Screen sites have unread messages. TRIF can show how many on its own icon. iOS will ask about notifications next: TRIF uses only the number on the icon, never alerts or sounds.")
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
                // (a quick ask's strip (Tim, 11-18): the same chat, laid out as ever, only its foot showing over the tab:
                // its message box, filled, and the site's own Send. Nothing in it is resized or moved)
                ChatScreen(pane: pane)
                    .modifier(ChatLayer(insets: bars.insets, size: geo.size, strip: stripLayer && !pane.shown, up: stripUp,
                                        part: pane.stripBody, shift: pane.stripShift,
                                        header: QuickStripHeader(service: pane.quick?.service ?? pane.service.rawValue,
                                                                 expand: { pane.expandStrip() }, cancel: { withAnimation { pane.cancelStrip() } })))
                    .zIndex(pane.shown || stripLayer ? 1 : 0)
                    .allowsHitTesting(pane.shown || pane.stripIn)
                    .accessibilityHidden(!pane.shown && !pane.stripIn)
                column
                    .background(Color(.systemBackground))
                    .zIndex(pane.shown || stripLayer ? 0 : 1)
                // (what else covers the page lies over it the same way, the toolbar showing under it, so the toolbar's
                // page button (and the others) can always take you back: Tim, 11-15)
                if showTabs {
                    TabsView(pane: pane, focus: tabsFocus, close: { showTabs = false }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(3)
                }
                if showMods {
                    ModsPanelView(panel: modsPanel, close: { showMods = false }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(3)
                }
                if showAddress {
                    AddressScreen(history: browser.history, close: { showAddress = false }, cancel: { showAddress = false; browser.leaveEmptyNewTab() }).environmentObject(browser)
                        .modifier(ToolbarRoom(insets: bars.insets)).zIndex(4)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
            // (a reply done in a chat not looked at (Tim, 11-18): over everything, the tab, the tabs, Mods, the chat)
            .overlay(alignment: .top) {
                if let b = pane.banners.first {
                    ChatBannerView(banner: b, showGo: !(browser.site == b.site && !covered),
                                   add: { withAnimation { pane.addFromBanner(b) } },
                                   go: { withAnimation { closeCovers(); pane.goToSite(b.link) } },
                                   openChat: {
                                       Diagnostics.shared.log("chats", "done banner: open chat for \(b.site.isEmpty ? "no site" : b.site)\(b.mods.isEmpty ? "" : ", \(b.mods.count) mod(s) still held by it")")
                                       withAnimation { closeCovers(); pane.openChat(b.link) }
                                   },
                                   dismiss: { withAnimation { pane.dismissBanner(b) } })
                        .id(b.id)
                        .padding(.top, 4)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .task(id: b.id) {
                            // (a plain reply's banner goes by itself after 8 s; one with mods stays: it is their offer; so
                            // does one saying the reply has a mod to add in the chat, 11-18, or one TRIF couldn't read, 11-19)
                            guard b.mods.isEmpty, b.inChat == 0, b.unreadable == nil else { return }
                            try? await Task.sleep(nanoseconds: 8_000_000_000)
                            if !Task.isCancelled, pane.banners.first?.id == b.id { withAnimation { pane.dismissBanner(b) } }
                        }
                }
            }
            .animation(.spring(duration: 0.35), value: pane.banners.first?.id)
            // (a note while the chat is shown, as "No app on this iPhone can open this link.": the page's notes are under it)
            // (and the robot held: what's heard, over whatever is shown, just above the toolbar)
            .overlay(alignment: .bottom) {
                VStack(spacing: 0) {
                    // (Tim, 11-18: after a long hold the toolbar took no taps until the app went to the background.
                    // Found in the Simulator: the pill, with a long text (its HeardText a ScrollView), stayed in its
                    // removal for good, invisible and moved down over the toolbar, and SwiftUI gave it the taps. It
                    // only shows words, so it takes no touches, and it goes at once when the finger lifts)
                    if holdTalk {
                        HoldTalkPill(away: holdAway).padding(.bottom, 10)
                            .allowsHitTesting(false)
                            .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .bottom)), removal: .identity))
                    }
                    // (a hold stopped by a call, the app left, an error: nothing asked, the words kept; a tap shows them)
                    if !holdTalk { KeptTalkSlot { closeCovers(); showChatList = true } }
                    if pane.shown && !browser.status.isEmpty && !browser.fullScreen {
                        Text(browser.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                            .modifier(NoteStyle(seconds: 2, key: browser.status) { browser.status = "" })
                    }
                }
                .modifier(ToolbarRoom(insets: bars.insets))
                .animation(.easeOut(duration: 0.2), value: holdTalk)
            }
            // (the full screen exit button: over everything, outside the clip, as it sits in the status bar's row)
            .overlay {
                if browser.fullScreen && !hideExitButton && !covered {
                    FullScreenExit(wake: browser.exitWake, long: browser.exitWakeLong) { browser.setFullScreen(false) }
                }
            }
        }
        // (while the quick ask's chat is filled behind the tab, a keyboard its box's brief focus starts moves nothing)
        .ignoresSafeArea(.keyboard, edges: pane.strip && !pane.stripIn && !pane.shown ? .bottom : [])
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
                // (not for a tab with an address of its own waiting to load: a launch by an icon showed this list
                // for a moment over its site's tab, 11-17)
                if browser.current.webView.url == nil && !browser.loading && browser.current.savedURL == nil && browser.current.savedState == nil {
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
                    if let off = safety.switchedOff[browser.site] {
                        SafetyBanner(site: browser.site, off: off,
                                     restore: off.snap.flatMap { id in safety.snapshots.contains { $0.id == id && $0.restored == nil } ? { _ = browser.restoreSwitches(id) } : nil },
                                     open: { showMods = true }, dismiss: { browser.safety.dismiss(site: browser.site) })
                    }
                }
            } toolbar: {
                VStack(spacing: 0) {
                    Divider()
                    toolbar
                }
                .background { toolbarFill }
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
                case .reload: browser.reload("pull-to-refresh")
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
        // (the strip slides in once, when its page has settled (pane.stripIn), and away when it goes)
        .onChange(of: pane.stripIn) { _, now in
            if now {
                stripLayer = true
                Task { @MainActor in try? await Task.sleep(nanoseconds: 30_000_000); if pane.stripIn { stripUp = true } }
            } else {
                stripUp = false
                Task { @MainActor in try? await Task.sleep(nanoseconds: 380_000_000); if !pane.stripIn { stripLayer = false } }
            }
        }
        .onChange(of: browser.wantsChat) { _, want in if want { pane.open(); browser.wantsChat = false } }
        // (site access: something asked for TRIF on a page it isn't connected on: the robot's card)
        .onChange(of: browser.wantsConnectCard) { _, want in if want { browser.wantsConnectCard = false; closeCovers(); showChatList = true } }
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
            case "tabs": tabsFocus = pane.chatTabShown; browser.snapshot(); showTabs = true
            case "history": showHistory = true
            case "chat": pane.open()
            case "import": importing = true
            case "address": showAddress = true
            case "icon": addingIcon = true
            case "iconqueue": showIconQueue = true
            case "chatlist": showChatList = true
            case "none": showChatList = false; addingIcon = false; showIconQueue = false; showMods = false; showTabs = false; showHistory = false; showAddress = false; pane.close(); showChecks = false; showReport = false
            default: break
            }
            browser.wantsSheet = ""
        }
        .onChange(of: modsPanel.wantsImport) { _, want in if want { showMods = false; importing = true; modsPanel.wantsImport = false } }
        .onOpenURL { url in openLink(url) }
        // (development: the robotHold step holds and lets go of the robot as the finger would)
        .onReceive(NotificationCenter.default.publisher(for: Model.robotHoldStep)) { n in
            switch n.userInfo?["hold"] as? String {
            case "1": robotHold()
            case "away": holdAway = true; robotLift()
            default: robotLift()
            }
        }
        // (the icon check's way in, Model.iconCheck: UIApplication.open of the app's own scheme asks "Open in …?" first)
        .onAppear {
            #if DEBUG
            ContentView.openForCheck = { url in openLink(url) }
            #endif
            // (a tap on the toolbar that did nothing: the app's state with it, in Diagnostics "toolbar")
            ToolbarWatch.shared.state = { holdWords }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.javaScript, .zip, .folder, .json], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { browser.importFiles(urls) }
        }
        .sheet(isPresented: $addingIcon) { WebClipSheet().environmentObject(browser) }
        .sheet(isPresented: $showIconQueue) { IconQueueView().environmentObject(browser) }
        .sheet(isPresented: $phoneLink.shown) { PhoneLinkView() }
        // (Tim 11-20: set up in one tap: TRIF fills the service's new-project form, then its instructions; the person taps
        // Create and Save)
        .alert(pane.service.project == nil ? "Keep TRIF chats in a project" : "TRIF chats' project", isPresented: $askingProject) {
            Button(pane.service.project == nil ? "Set it up" : "Make a new one") { pane.setUpProject(why: "the ⋯ menu") }
            if pane.service.project != nil { Button("Stop using it", role: .destructive) { pane.service.useProject(nil, hasGuide: false) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(pane.service.project == nil
                 ? "TRIF opens \(pane.service.rawValue)'s new-project form, filled in: you tap Create, then Save for TRIF's instructions. New TRIF chats then start in that project. They still show in your recent chats."
                 : "New TRIF chats in \(pane.service.rawValue) start in your project\(pane.service.projectHasGuide ? ", which has TRIF's instructions" : ""). Project chats may still show in \(pane.service.rawValue)'s recent chats.")
        }
        .background(Color.clear.fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { FolderWatch.shared.choose(url) }
        })
        .sheet(isPresented: $showChecks) { ChecksView().environmentObject(browser).environmentObject(report) }
        .sheet(isPresented: $showReport) { ReportView().environmentObject(report) }
        .sheet(isPresented: $showHistory) { HistoryView(history: browser.history).environmentObject(browser) }
        .sheet(isPresented: $showSensitive) { SensitiveSitesView() }
        // (site access: the one-time note for a phone that had TRIF before it)
        .alert("TRIF now connects site by site", isPresented: Binding(get: { access.upgradeNote }, set: { if !$0 { access.noteSeen() } })) {
            Button("OK") { access.noteSeen() }
        } message: {
            Text("TRIF does nothing on a site until you connect it there: tap the robot and Connect. Sites where you have mods or a Home Screen icon are connected already. Sensitive sites, such as email and banking, start disconnected; their mods wait.")
        }
        .sheet(isPresented: $showChatList) {
            ChatListView(pane: pane, site: browser.site,
                         ask: { text in showChatList = false; closeCovers(); pane.quickAsk(text) },
                         goToChat: { showChatList = false; closeCovers(); pane.open() },
                         open: { key in showChatList = false; closeCovers(); pane.openChat(key) },
                         go: { key in showChatList = false; closeCovers(); pane.goToSite(key) },
                         close: { showChatList = false }, host: webHost)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $browser.modOffer, onDismiss: nextOfferSoon) { mod in ModOfferView(mod: mod).environmentObject(browser) }
    }

    /// The small notes at the foot of the page (Tim, 11-15: closing each by hand was annoying): each goes by itself,
    /// fading out, after 2 seconds, or 5 when it has a button (Undo); a tap sends it sooner. What they report
    /// that matters stays where it already is (a mod's errors on its row and in diagnostics).
    private var notes: some View {
        VStack(spacing: 0) {
            // (the quick ask's pill: Working, then Done · Undo or Replied; a tap opens the chat)
            // (and while the strip's chat is filled behind the tab: "Putting it in Claude…")
            if let q = pane.quick, !pane.shown, q.state != .card, q.state != .waitingSend || (pane.strip && !pane.stripIn),
               !(quickTucked == q.id && [.working, .starting, .waitingSend].contains(q.state)) {
                QuickPill(quick: q, preparing: q.state == .waitingSend, open: { closeCovers(); pane.quickOpen() }, undo: { pane.quickUndo() }, dismiss: { if pane.quick?.id == q.id { pane.quick = nil } },
                          tuck: { withAnimation(.easeOut(duration: 0.25)) { quickTucked = q.id }; Diagnostics.shared.log("quick ask", "the Working pill hidden by the person; the work goes on") })
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if !browser.status.isEmpty {
                // (a mod from a chat added on another tab: the way to its site, Tim 11-18)
                if browser.status == Browser.tapForSound, browser.soundTab != nil {
                    // (a video picked up where it was, playing muted: iOS allowed no sound without a tap)
                    Button { browser.soundOn() } label: {
                        Label(browser.status, systemImage: "speaker.wave.2.fill").font(.footnote.bold()).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .modifier(NoteStyle(seconds: 8, key: browser.status) { browser.status = "" })
                } else if let g = browser.statusGo, g.text == browser.status {
                    HStack(spacing: 12) {
                        Text(browser.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                        Button("Go to \(g.site)") { browser.status = ""; closeCovers(); pane.goToSite(pane.links.first { $0.site == g.site }?.id ?? "") }
                            .font(.footnote.bold()).lineLimit(1)
                    }
                    .modifier(NoteStyle(seconds: 5, key: browser.status) { browser.status = "" })
                } else {
                Text(browser.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    .modifier(NoteStyle(seconds: 2, key: browser.status) { browser.status = "" })
                }
            }
        }
    }

    /// A reply's next mod, a moment after a sheet has gone (one sheet can't open while another is closing), unless the
    /// Mods tab has opened meanwhile (a mod just added that waits for an OK): then once it closes.
    private func nextOfferSoon() {
        browser.offerClosed(declined: false)
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
            // (Tim, 11-17: Send diagnostics… is in the Mods tab's ⋯, and he forgets it; the same text, copied. Near the top,
            // so it shows without scrolling the menu on an SE)
            Button { browser.copyDiagnostics() } label: { Label("Copy diagnostics", systemImage: "doc.on.clipboard") }
            Button { onTab { pickingFolder = true } } label: { Label(folder.folderName.map { "Mods folder: \($0)…" } ?? "Watch a folder for mods…", systemImage: "folder.badge.gearshape") }
            if let name = folder.folderName { Button("Stop watching \(name)", role: .destructive) { folder.stop() } }
            Button { onTab { askingProject = true } } label: { Label(pane.service.project == nil ? "Keep TRIF chats in a project…" : "TRIF chats' project…", systemImage: "folder") }
            // (site access, Tim 11-20: as desktop's Disconnect; the site's mods and switches are kept)
            if !webHost.isEmpty, !disconnectedHere {
                Button(role: .destructive) { onTab { SiteAccess.shared.disconnect(webHost, why: "the ⋯ menu") } } label: { Label("Disconnect from \(browser.site)", systemImage: "bolt.horizontal.circle") }
            }
            Button { onTab { showSensitive = true } } label: { Label("Sensitive sites…", systemImage: "lock.shield") }
            // (as Safari's page menu, Tim 11-18: the site as a computer's, remembered for the site; the other way back)
            if browser.canRequestDesktop {
                Button { onTab { browser.requestDesktop(!browser.desktopShown) } } label: {
                    Label(browser.desktopShown ? "Mobile Website" : "Desktop Website", systemImage: browser.desktopShown ? "iphone" : "desktopcomputer")
                }
            }
            // (full screen, the app's view, whatever tab is shown; the line under it names the shortcut, which also switches back)
            Button { onTab { browser.setFullScreen(true) } } label: {
                Label("Full screen", systemImage: "arrow.up.left.and.arrow.down.right")
                Text("Or hold two fingers on the page")
            }
            Toggle(isOn: $hideExitButton) { Label("Hide the full screen button", systemImage: "eye.slash") }
            // (the sites' own unread counts, from their titles: the tab cards' badges and TRIF's icon's, Tim 11-18)
            Toggle(isOn: $showUnread) { Label("Show unread counts", systemImage: "number.circle") }
            // (the Home Screen icons put aside with Add to Home Screen later, all added in one install)
            if !iconQueue.items.isEmpty {
                Button { onTab { showIconQueue = true } } label: { Label("Home Screen icons to add (\(iconQueue.items.count))…", systemImage: "square.grid.2x2") }
            }
            Divider()
            Button("Copy this page for the chat") { onTab { Task { await browser.copyOutline() } } }
            Button("Add a mod from the clipboard") { onTab { browser.offerFromClipboard() } }
            Divider()
            Menu("The probe") {
                Button("Checks") { onTab { showChecks = true } }
                Button("Report") { onTab { showReport = true } }
                Section("The probe's own pages") {
                    ForEach(browser.pages.pageNames, id: \.self) { name in
                        Button(name) { onTab { browser.go(PageSchemeHandler.home + name) } }
                    }
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
    /// The toolbar's background: see-through over the page (it takes the page's colours, as Safari's does), but the
    /// colour of whatever covers the page when something does (Tim, 11-20: a pink BBC mod tinted the toolbar under
    /// a white chat; "also do that for the other views").
    @ViewBuilder private var toolbarFill: some View {
        if showTabs { Color(.systemGroupedBackground) }
        else if covered { Color(.systemBackground) }
        else { Rectangle().fill(.bar) }
    }
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
        askingProject = false; importing = false; pickingFolder = false
    }
    /// A link the app was opened with: a file to import, a mod's trif://add, a Home Screen icon's trif://open.
    /// With no animation (Tim, 11-17: an icon tapped while TRIF was on another tab showed that tab first, then faded):
    /// the tab switch, the bars leaving for full screen and the covers closing happen in one frame, before the app's
    /// first frame back. (What still shows the old tab for ~0.35 s on a return from the background is iOS's own
    /// picture of the app as it was left, cross-faded into the live app: see IOS-AGENT-NOTES.md.)
    private func openLink(_ url: URL) {
        var still = Transaction(animation: nil)
        still.disablesAnimations = true
        withTransaction(still) { UIView.performWithoutAnimation { openLinkNow(url) } }
    }
    private func openLinkNow(_ url: URL) {
        PendingLink.take(url)
        if TrifLink.isOurs(url) {
            LeavingCover.shared.iconLinkCame("taken by the app")
            Diagnostics.shared.log("icon", "the app takes \(PendingLink.describe(url)), over: \(coverNames)")
        }
        if url.isFileURL { browser.importFiles([url]); try? FileManager.default.removeItem(at: url) }
        else if url.host?.lowercased() == "pair", url.scheme?.lowercased() == "trif" {
            // (desktop TRIF's Connect a phone code, scanned with iOS's Camera app: My computer opens with it)
            // (from outside: asked first, "Connect this iPhone to {computer}?"; security batch 11-20)
            closeCovers(); PhoneLinkModel.shared.open(url.absoluteString, fromLink: true)
        }
        else if url.host?.lowercased() == "add", url.scheme?.lowercased() == "trif" {
            // (a mod in a link: a QR code's, from desktop TRIF; offered like any other)
            // (security batch, 11-20: from outside, so one at a time: a link while another's mod waits is dropped)
            if let m = ModLinkInURL.read(url) {
                if browser.outsideMayOffer("a code") {
                    closeCovers()
                    browser.outsideReading += 1
                    Task { await browser.offerFiles([(m.name, m.text)], from: "a code", outside: true); browser.outsideReading -= 1 }
                }
            }
            else { browser.status = "That code's mod couldn't be read: it may be cut short or damaged." }
        }
        else if url.host?.lowercased() == "settings", url.scheme?.lowercased() == "trif" {
            // (Tim, 11-18: the clip page's Open Settings, after Safari downloaded the profile: TRIF's own page in
            // Settings by iOS's public way, as the steps' button; the tab, the covers and the leaving cover untouched)
            ContentView.openSettings("trif://settings")
        }
        else if let site = TrifLink.target(url) {
            // (the Add to Home Screen sheet, if it's for this site, stays: it says it's done, and the person closes it;
            // likewise the list of icons waiting, if they came from its profile, which also clears the list)
            // (security batch, 11-20: full screen, and an icon counted as installed, only for a link TRIF made:
            // TrifLink.open; any other trif://open is an ordinary tab with its address, and never connects a site)
            let host = Site.of(site.host ?? ""), set = TrifLink.set(url)
            let how = TrifLink.open(url)
            if case .fullScreen = how {
                ProfileHandoff.shared.opened(fromIconOf: host, set: set)
                IconQueue.shared.opened(site: host, set: set)
            }
            if !(addingIcon && ProfileHandoff.shared.installed) { addingIcon = false }
            if !(showIconQueue && ProfileHandoff.shared.installed) { showIconQueue = false }
            closeCovers(all: true)
            switch how {
            case .fullScreen: browser.openFullScreen(site)
            case .tab(let why):
                if TrifLink.wantsFullScreen(url) { Diagnostics.shared.log("icon", "a full screen link not taken as one (\(why)): an ordinary tab") }
                browser.openFromIcon(site)
            }
        }
        else if url.scheme == "trif" { report.log("icon", "a trif:// link that isn't an http(s) site, ignored") }
    }
    /// TRIF's page in Settings (UIApplication.openSettingsURLString, public; never prefs: links). At a cold launch the
    /// scene may not take it yet: tried again once after 0.6 s.
    static func openSettings(_ why: String) {
        guard let u = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(u) { ok in
            Diagnostics.shared.log("link", "\(why): TRIF's page in Settings \(ok ? "opened" : "not opened, trying again")")
            guard !ok else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                UIApplication.shared.open(u) { ok in Diagnostics.shared.log("link", "\(why): TRIF's page in Settings \(ok ? "opened" : "not opened")") }
            }
        }
    }
    #if DEBUG
    static var openForCheck: ((URL) -> Void)?
    #endif
    /// What covers the page, by name ("none"), for the dev step {"view": 1} and the icon check (Model.iconCheck).
    private var coverNames: String {
        let all: [(Bool, String)] = [(pane.shown, "chat"), (showTabs, "tabs"), (showMods, "mods"), (showAddress, "address"),
                                     (showHistory, "history"), (showChecks, "checks"), (showReport, "report"), (addingIcon, "icon"), (showIconQueue, "iconqueue"),
                                     (askingProject, "project"), (importing, "import"), (pickingFolder, "folder"), (showChatList, "chatlist"), (pane.strip, "strip")]
        return all.filter(\.0).map(\.1).joined(separator: ",").nonEmpty ?? "none"
    }
    static var coversNow = "none"
    /// The toolbar's page button (Tim, 11-15): back to the page, from whatever covers it. On the page already (Tim,
    /// 11-16): a + that opens a new tab, onto the address screen.
    /// Tapped again on the new tab's address screen, before anything was opened in it (Tim, 11-18: the toolbar's
    /// buttons toggle, as Safari's): that empty tab goes and the tab it was opened from is back, as it was.
    private func showPage() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if covered {
            // (Browser.newTabFrom: the empty new tab goes, back to the tab it came from)
            let leaving = showAddress
            closeCovers()
            if leaving { browser.leaveEmptyNewTab() }
        } else {
            browser.newTab()
        }
    }

    /// Back and forward's accessibility label while the chat is open (as the chat's own ‹ {site}).
    private var backToTab: String { "Back to \(browser.site.isEmpty ? "Tab" : browser.site)" }

    /// A toolbar button while something covers the page: back to the tab first, then its job there.
    private func onTab(_ job: () -> Void) {
        closeCovers()
        job()
    }

    /// The finger on the robot: held still 0.45 s, it talks (or opens the list); moved first, it was a slide, not a
    /// hold. While talking, slid well away (90 pt) means letting go cancels.
    private func robotPress(_ moved: CGSize) {
        if robotSpent { return }
        let far = hypot(moved.width, moved.height)
        if robotDown == nil {
            robotDown = Date()
            // (the best recognizer looked for as the finger comes down, so a hold that talks at 0.45 s uses it: Tim's
            // phone, 11-18, started on SFSpeechRecognizer 0.4 s before the look said SpeechTranscriber was there)
            SpeechInput.shared.lookAhead()
            robotHoldWait = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 450_000_000)
                if !Task.isCancelled, robotDown != nil { robotHold() }
            }
        }
        if holdTalk { holdAway = far > 90 } else if far > 20 { robotHoldWait?.cancel() }
    }

    /// The hold ended some other way than the finger lifting (the touch cancelled, the app leaving the front, the
    /// listening stopped by something else): everything about it goes back. `stop`: the listening is stopped here too,
    /// what was heard kept, not asked (SpeechInput.interrupt: the box keeps the words and KeptTalkPill says so); not when
    /// SpeechInput stopped it itself (the app leaving, a call, an error: it has already kept the words).
    private func robotEnded(_ why: String, stop: Bool) {
        guard robotDown != nil || holdTalk || holdAway else { return }
        robotHoldWait?.cancel()
        robotDown = nil
        let talking = holdTalk
        holdTalk = false
        holdAway = false
        if talking, stop { SpeechInput.shared.interrupt(why: why) }
        Diagnostics.shared.log("quick ask", "robot hold ended without its lift (\(why))\(talking ? "" : ", not talking yet")")
        // (the finger still down: the rest of its touch does nothing, and its lift opens no list; else robotHeld goes)
        if robotTouching { robotSpent = true } else { releaseHeld() }
    }

    /// The tap that ends a hold is stopped for a moment (robotHeld), then taps work again.
    private func releaseHeld() {
        if robotHeld { Task { @MainActor in try? await Task.sleep(nanoseconds: 400_000_000); robotHeld = false } }
    }

    /// (Diagnostics) The robot's hold and what lies over the toolbar now.
    private var holdWords: String {
        let robot = "the robot: \(robotDown == nil ? "up" : "down"), held \(robotHeld), talking \(holdTalk)\(holdAway ? ", slid away" : "")"
        let strip = "strip \(pane.strip ? (pane.stripIn ? "in" : "filling") : "off"), its layer \(stripLayer ? (stripUp ? "up" : "drawn") : "gone")"
        return "\(robot); speech \(SpeechInput.shared.phase); covers \(ContentView.coversNow); \(strip); quick \(pane.quick.map { "\($0.state)" } ?? "none"); keyboard \(bars.keyboardUp ? "up" : "down"), bars \(String(format: "%.2f", bars.progress)); chat focused \(pane.chatHasFocus)"
    }

    private func robotHold() {
        robotHeld = true
        // (site access: on a site TRIF isn't connected on, the hold doesn't listen: the card, as the tap)
        if disconnectedHere {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Diagnostics.shared.log("quick ask", "robot held on \(browser.site): TRIF isn't connected there; the card")
            showChatList = true
            return
        }
        let speech = SpeechInput.shared
        guard speech.ready else {
            // (no permission yet, refused, or no speech on this iPhone: the list, whose box says why or asks)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Diagnostics.shared.log("quick ask", "robot held: the list (talking not ready: \(speech.describe))")
            showChatList = true
            return
        }
        speech.choose()
        speech.press(robot: true) { words in closeCovers(); pane.quickAsk(words) }
        guard speech.phase == .listening else { showChatList = true; return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        holdAway = false
        holdTalk = true
        Diagnostics.shared.log("quick ask", "robot held: talking")
    }

    private func robotLift() {
        robotHoldWait?.cancel()
        // (a hold already ended by something else: the finger's lift only clears it)
        if robotSpent { robotSpent = false; holdAway = false; releaseHeld(); return }
        let held = robotDown.map { Date().timeIntervalSince($0) }
        robotDown = nil
        if holdTalk {
            holdTalk = false
            if holdAway { SpeechInput.shared.cancel() } else { SpeechInput.shared.release(held: held) }
        }
        holdAway = false
        // (a hold that ends off the button sends no tap: not kept for the next one)
        releaseHeld()
    }

    private var toolbar: some View {
        // (the page button at the screen's exact centre, a little bigger; the three on each side evenly in their half,
        // mirrored: each side cell the same width. Tim, 11-15: evenly spaced, the bigger middle one sat 11 pt left)
        HStack(spacing: 0) {
            // (with the chat open, back and forward only close it, back to the page as it was: Tim, 11-15, "that's
            // the behaviour people will expect")
            // (the chat showing: its own history; the tabs, Mods or the address screen: closed; else the tab's history)
            Button { ToolbarWatch.shared.fired("back"); if pane.shown { pane.back() } else if covered { closeCovers() } else { browser.back() } } label: { Image(systemName: "chevron.left") }
                .disabled(pane.shown ? !pane.canGoBack : !covered && !browser.canGoBack)
                .accessibilityLabel(covered && !pane.shown ? backToTab : "Back")
                .modifier(WatchSlot(name: "back", enabled: pane.shown ? pane.canGoBack : covered || browser.canGoBack))
                .frame(maxWidth: .infinity)
            Button { ToolbarWatch.shared.fired("forward"); if pane.shown { pane.forward() } else if covered { closeCovers() } else { browser.forward() } } label: { Image(systemName: "chevron.right") }
                .disabled(pane.shown ? !pane.canGoForward : !covered && !browser.canGoForward)
                .accessibilityLabel(covered && !pane.shown ? backToTab : "Forward")
                .modifier(WatchSlot(name: "forward", enabled: pane.shown ? pane.canGoForward : covered || browser.canGoForward))
                .frame(maxWidth: .infinity)
            // (Tim, 11-18: a tap opens the quick ask, "What should change?", with Go to chat and the chats below
            // (ChatListView); while the chat is open (shown selected) it goes back to the tab; with the quick ask's strip
            // up, the whole chat, as before. Held: talk at once (hold to talk), or the same list when talking can't start)
            Button {
                ToolbarWatch.shared.fired("robot")
                if robotHeld { robotHeld = false; return }
                if pane.shown { pane.close() } else if pane.strip { pane.open() } else { showChatList = true }
            } label: {
                ChatGlyph(activity: pane.activity).frame(width: 24, height: 24)
                    // (site access: a quieter robot on a site TRIF isn't connected on; my call, for Tim)
                    .opacity(disconnectedHere && !pane.shown ? 0.4 : 1)
                    .padding(5)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.trifGreen.opacity(pane.shown ? 0.2 : 0)))
                    .padding(-5)
            }
            .simultaneousGesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .updating($robotTouching) { _, on, _ in on = true }
                .onChanged { g in robotPress(g.translation) }
                .onEnded { _ in robotLift() })
            // (a touch the system took (a call, Control Center, an alert): SwiftUI calls no onEnded, only the gesture
            // state goes back. A moment later, a hold still marked down is ended here: nothing left half-held)
            .onChange(of: robotTouching) { _, on in
                guard !on else { return }
                Task { @MainActor in
                    if robotDown != nil { robotEnded("the touch was cancelled", stop: true) }
                    if robotSpent { robotSpent = false; releaseHeld() }
                }
            }
            .accessibilityLabel(pane.activity == .working ? "Chat, writing a reply" : pane.activity == .replied ? "Chat, replied" : "Chat")
            .accessibilityValue(disconnectedHere ? "TRIF is disconnected on \(browser.site)" : "")
            .accessibilityHint("Opens What should change? and the chats")
            .accessibilityAddTraits(pane.shown ? .isSelected : [])
            .accessibilityAction(named: "Go to chat") { closeCovers(); pane.open() }
                .modifier(WatchSlot(name: "robot", enabled: true))
                .frame(maxWidth: .infinity)
            // (the page: back to it from whatever covers it; on the page, a + for a new tab; in the middle, a little bigger)
            pageButton
                .modifier(WatchSlot(name: "page", enabled: true))
                .frame(width: 64)
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).midX } action: { ContentView.pageButtonMidX = $0 }
            // (Tim, 11-17, later: back to the Mods switch next, then the tabs; `-tabsfirst`: the tabs first, as for a while that day)
            if ContentView.tabsBeforeMods { tabsButton.frame(maxWidth: .infinity); modsButton.frame(maxWidth: .infinity) }
            else { modsButton.frame(maxWidth: .infinity); tabsButton.frame(maxWidth: .infinity) }
            // (the last button adds this site to the Home Screen, Tim 11-16; what the ⋯ menu here held is in the ⋯ at the
            // address bar's left. Its glyph, an A in a rounded square like the App Store's (Tim, 11-17), so it isn't
            // taken for the new tab's +)
            Button { ToolbarWatch.shared.fired("A"); onTab { addingIcon = true } } label: { Image(systemName: "a.square") }
                .disabled(!onWebPage)
                .accessibilityLabel("Add to Home Screen")
                .modifier(WatchSlot(name: "A", enabled: onWebPage))
                .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { ToolbarWatch.shared.bar = $0 }
        .font(.title3)
        // (the same room on both sides: iOS's side safe areas are the same on both sides in landscape, so the row's
        // centre is the screen's)
        .padding(.horizontal, 6)
        .padding(.vertical, 10)
    }

    /// (development: where the middle button's centre is, for the step {"toolbar": 1})
    static var pageButtonMidX: CGFloat = 0

    /// The toolbar's tabs button before the Mods switch. `false` (Tim, 11-17, later the same day: "the old order"):
    /// back, forward, chat, [page], Mods, tabs, Home Screen. `true` (or the launch flag `-tabsfirst`) is the order he
    /// tried that day: back, forward, chat, [page], tabs, Mods, Home Screen.
    static let tabsBeforeMods = false || DevFlags.args.contains("-tabsfirst")

    /// The Mods tab: a switch, on or, with all paused, off (Tim, 11-15; the robot is the chat's now), with the count
    /// waiting for an OK.
    private var modsButton: some View {
        // (tapped again while it's open: back to the page, as it was; Tim, 11-18)
        Button { ToolbarWatch.shared.fired("Mods"); if showMods { showMods = false } else { onTab { showMods = true } } } label: {
            SwitchGlyph(on: !store.paused).frame(width: 30, height: 24)
                .overlay(alignment: .topTrailing) {
                    if waitingHere > 0 {
                        Text("\(waitingHere)").font(.caption2.bold()).foregroundStyle(.black)
                            .padding(.horizontal, 4).background(Capsule().fill(Color.trifYellow)).offset(x: 8, y: -6)
                    }
                }
        }
        .accessibilityLabel(store.paused ? "Mods, all paused" : waitingHere > 0 ? "Mods, \(waitingHere) waiting for your OK" : "Mods")
        .modifier(WatchSlot(name: "Mods", enabled: true))
    }

    /// The page: back to it from whatever covers it; on the page, a + for a new tab.
    private var pageButton: some View {
        Button { ToolbarWatch.shared.fired("page"); showPage() } label: { PageGlyph(letter: DevFlags.args.contains("-pageletter") ? String(siteLabel.prefix(1)).uppercased() : nil, plus: !covered) }
            .accessibilityLabel(covered ? backToTab : "New Tab")
    }
    /// The tabs, their count in a rounded square.
    private var tabsButton: some View {
        // (tapped again with the tabs open and none picked: back to the page, as it was, as Safari's; Tim, 11-18)
        // (opened at the tab just left; from a chat, the chat's own tab: Tim, 11-18)
        Button { ToolbarWatch.shared.fired("tabs"); if showTabs { showTabs = false } else { let f = pane.chatTabShown; onTab { tabsFocus = f; browser.snapshot(); showTabs = true } } } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(lineWidth: 1.8).frame(width: 22, height: 22)
                Text("\(browser.tabs.count)").font(.system(size: 12, weight: .semibold))
            }
        }
        .accessibilityLabel("Tabs, \(browser.tabs.count) open")
        .modifier(WatchSlot(name: "tabs", enabled: true))
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
        // (the quick ask's chat being filled behind the tab: its box's focus, a moment long, isn't the person's
        // keyboard; the toolbar and the layout stay (Tim, 11-18: the strip went "up and down" as Claude's page loaded))
        if up, Model.pane?.keyboardNotTheirs == true {
            Diagnostics.shared.log("quick ask", "the keyboard came up while the strip's chat was being filled: left out of the layout")
            return
        }
        // (the person's own keyboard in the strip's box: the whole chat, where the box has room to edit (the strip shows
        // only a cropped band of a page laid out over the whole tab, which WebKit would scroll under the keyboard))
        if up, let pane = Model.pane, pane.stripIn, !pane.shown, pane.chatHasFocus {
            Diagnostics.shared.log("quick ask", "the keyboard came up in the strip: the whole chat opened")
            pane.expandStrip()
        }
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
    static let compensates = !DevFlags.args.contains("-nobarshift")

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
    static let robot = DevFlags.args.contains("-exitrobot")
    /// (`-exitbelow`: where it was before 11-17, 60 points under the status bar at the right)
    static let belowBar = DevFlags.args.contains("-exitbelow")
    static let below: CGFloat = 60
    /// (development: `-exity <points>`, the circle's centre that far down)
    static let devY: CGFloat? = { let a = DevFlags.args; return a.firstIndex(of: "-exity").flatMap { a.indices.contains($0 + 1) ? Double(a[$0 + 1]).map { CGFloat($0) } : nil } }()
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

/// The chat's layer: over the page with the toolbar showing under it; or, for a quick ask, a strip of it (`strip`): the
/// header and, under it, `part` points of the chat's page: the box's text and the site's Send (Tim, 11-18: "a very
/// little panel that shows the text"), the page moved down by `shift` inside it so that part's foot is at the strip's
/// foot. Slides up (`up`) and away. The chat is laid out at its full size either way (its page never changes size for
/// the strip: it's only moved and clipped, never restyled).
struct ChatLayer<Header: View>: ViewModifier {
    @ObservedObject var insets: BarInsets
    let size: CGSize
    let strip: Bool
    let up: Bool
    let part: CGFloat
    let shift: CGFloat
    let header: Header
    func body(content: Content) -> some View {
        let bottom = insets.keyboard ? 0 : insets.toolbar
        let h = max(0, size.height - bottom)
        let tall = strip ? min(QuickStrip.header + part, h) : h
        content
            .frame(width: size.width, height: h)
            .offset(y: strip ? shift : 0)
            .frame(width: size.width, height: tall, alignment: .bottom)
            .clipped()
            // (the strip's band, below its header: the chat's page takes no touches outside it, though it's laid out
            // over the whole tab)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { r in
                ChatWebView.stripBand = strip ? (r.minY + QuickStrip.header)...max(r.minY + QuickStrip.header, r.maxY) : nil
            }
            .onChange(of: strip) { _, on in if !on { ChatWebView.stripBand = nil } }
            .overlay(alignment: .top) { if strip { header } }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: strip ? 14 : 0, topTrailingRadius: strip ? 14 : 0, style: .continuous))
            .shadow(color: .black.opacity(strip ? 0.22 : 0), radius: 10, y: -2)
            .offset(y: strip && !up ? tall + 20 : 0)
            .animation(.spring(duration: 0.35), value: up)
            .frame(width: size.width, height: h, alignment: .bottom)
            .clipped()
            .padding(.bottom, bottom)
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
