import Foundation
import SwiftUI
import UIKit
import WebKit

// Site access (Tim, 2026-11-20: "I want people feeling comfortable with TRIF as their browser and still using it for
// banking etc." … "let's opt in per site"; docs/MOBILE-BEHAVIOUR.md, Site access). Every site starts disconnected, and
// on a disconnected site TRIF adds nothing of mods or AI to the page: the tab's own WKUserContentController holds none
// of TRIF's scripts and no message handler of TRIF's (Browser.applyAccess, before the page's document starts; only the
// browser features' own world, below, is in every page), and every way the
// app has of reading a page (JavaScript in any world, a snapshot, a PDF, a web archive, find) goes through TabWebView's
// overrides below, which refuse there. The person connects a site from the robot's card (Connect) or the Mods tab; ⋯ →
// Disconnect from {site} undoes it. Per device: connections never sync. The rules (which site a host is in, sensitive
// sites each a site of their own, the upgrade, a sensitive site's adds): mobile/shared/core/site-access.js.

/// The connected sites and the person's own sensitive sites (UserDefaults "connectedSites", "sensitiveOwn"), and the
/// rule's answers for a host, kept per host (asked on every page load and every read of a page).
@MainActor
final class SiteAccess: ObservableObject {
    static let shared = SiteAccess()

    /// The sites connected on this device (core scopes: example.com, mail.google.com).
    @Published private(set) var sites: [String]
    /// The person's own sensitive sites and patterns (Sensitive sites…), added to TRIF's list.
    @Published private(set) var own: [String]
    /// Counts every change, for views that follow it.
    @Published private(set) var changes = 0
    /// After a connect or disconnect: (site, connected now). Browser puts the tabs' scripts right.
    var onChange: ((String, Bool) -> Void)?

    struct Card: Equatable { var site: String; var connected: Bool; var sensitive: Bool; var why: String; var own: Bool }

    private var cards: [String: Card] = [:]

    private init() {
        sites = UserDefaults.standard.stringArray(forKey: "connectedSites") ?? []
        own = UserDefaults.standard.stringArray(forKey: "sensitiveOwn") ?? []
    }

    /// The host of an address, as the rule takes it ("" for none).
    nonisolated static func host(_ url: URL?) -> String { (url?.host ?? "").lowercased() }

    /// What the card says for a host (no answer from the rule: disconnected, the host's registrable site, not marked
    /// sensitive; then nothing of TRIF's runs there, the safe side).
    func card(_ host: String) -> Card {
        let h = host.lowercased()
        if let c = cards[h] { return c }
        var c = Card(site: Site.of(h), connected: false, sensitive: false, why: "", own: false)
        if let r = Core.shared.call("siteAccess.card", [sites, h, own]) as? [String: Any] {
            c = Card(site: r["site"] as? String ?? c.site, connected: r["connected"] as? Bool ?? false, sensitive: r["sensitive"] as? Bool ?? false,
                     why: r["why"] as? String ?? "", own: r["own"] as? Bool ?? false)
        }
        cards[h] = c
        return c
    }

    /// The site a host is in for TRIF: a sensitive site of its own (mail.google.com), else its registrable site.
    func scope(_ host: String) -> String { card(host).site }
    func isConnected(_ host: String) -> Bool { !host.isEmpty && card(host).connected }

    /// Whether TRIF may be on a page at this address: an http(s) page on a connected site, or TRIF's own pages (the
    /// probe's scheme). Anything else (about:, data:, blob:, file:, no address) gets nothing.
    func allows(_ url: URL?) -> Bool {
        guard let url, let scheme = url.scheme?.lowercased() else { return false }
        if scheme == PageSchemeHandler.scheme { return true }
        guard scheme == "http" || scheme == "https" else { return false }
        return isConnected(SiteAccess.host(url))
    }

    func connect(_ host: String, why: String) {
        guard let next = Core.shared.call("siteAccess.connect", [sites, host.lowercased(), own]) as? [String] else { return }
        set(next, site: scope(host), on: true, why: why)
    }
    func disconnect(_ host: String, why: String) {
        guard let next = Core.shared.call("siteAccess.disconnect", [sites, host.lowercased(), own]) as? [String] else { return }
        set(next, site: scope(host), on: false, why: why)
    }
    private func set(_ next: [String], site: String, on: Bool, why: String) {
        guard next != sites else { return }
        sites = next
        UserDefaults.standard.set(next, forKey: "connectedSites")
        cards = [:]
        changes += 1
        Diagnostics.shared.log("site access", "\(on ? "connected" : "disconnected") \(site) (\(why)); \(next.count) site(s) connected")
        onChange?(site, on)
    }

    /// Sensitive sites… : a site or pattern of the person's own. False when it isn't one (cleaned by the rule).
    @discardableResult
    func addOwn(_ text: String) -> Bool {
        guard let p = Core.shared.call("siteAccess.cleanPattern", [text]) as? String, !p.isEmpty else { return false }
        if !own.contains(p) { own.append(p); saveOwn("added \(p)") }
        return true
    }
    func removeOwn(_ p: String) {
        own.removeAll { $0 == p }
        saveOwn("removed \(p)")
    }
    private func saveOwn(_ what: String) {
        UserDefaults.standard.set(own, forKey: "sensitiveOwn")
        cards = [:]
        changes += 1
        Diagnostics.shared.log("site access", "the person's sensitive sites: \(what) (\(own.count) of theirs)")
        onChange?("", true)
    }
    /// TRIF's list and the person's, as the Sensitive sites screen shows them: [(pattern, why, own)].
    var list: [(pattern: String, why: String, own: Bool)] {
        ((Core.shared.call("siteAccess.list", [own]) as? [[String: Any]]) ?? []).map { ($0["pattern"] as? String ?? "", $0["why"] as? String ?? "", $0["own"] as? Bool ?? false) }
    }

    // MARK: the upgrade (Tim, 11-20, confirmed: sites with mods or a Home Screen icon connected; sensitive ones not)

    /// The one-time note for a phone that had TRIF before site access (drafts: docs/IOS-APP-STRINGS.md).
    @Published var upgradeNote = UserDefaults.standard.bool(forKey: "siteAccess.note")
    func noteSeen() { upgradeNote = false; UserDefaults.standard.set(false, forKey: "siteAccess.note") }

    /// At the first start of this version: on a phone that had mods or Home Screen icons, their sites are connected
    /// (sensitive ones aside: they start disconnected, their mods kept) and the note is shown once. A new install has
    /// neither: nothing is connected and there's no note.
    func upgradeOnce(modSites: [String], iconSites: [String]) {
        guard !UserDefaults.standard.bool(forKey: "siteAccess.upgraded") else { return }
        UserDefaults.standard.set(true, forKey: "siteAccess.upgraded")
        guard !modSites.isEmpty || !iconSites.isEmpty else {
            Diagnostics.shared.log("site access", "first start with site access: nothing to connect (no mods, no icons)")
            return
        }
        guard let r = Core.shared.call("siteAccess.upgrade", [["modSites": modSites, "iconSites": iconSites, "already": sites, "own": own]]) as? [String: Any],
              let next = r["connect"] as? [String] else { return }
        let waiting = r["waiting"] as? [String] ?? []
        sites = next
        UserDefaults.standard.set(next, forKey: "connectedSites")
        cards = [:]
        changes += 1
        upgradeNote = true
        UserDefaults.standard.set(true, forKey: "siteAccess.note")
        Diagnostics.shared.log("site access", "first start with site access: connected \(next.count) site(s) with mods or icons (\(next.joined(separator: ", "))); sensitive, left disconnected with their mods waiting: \(waiting.isEmpty ? "none" : waiting.joined(separator: ", "))")
    }

    // MARK: a sensitive site's adds (core sensitiveAdd)

    struct SensitiveAdd { var off: Bool; var newOff: String?; var holds: [String] }
    func sensitiveAdd(site: String, isNew: Bool, source: String, tier: String, oldOn: Bool) -> SensitiveAdd {
        let sensitive = card(site).sensitive
        guard sensitive else { return SensitiveAdd(off: false, newOff: nil, holds: []) }
        let f: [String: Any] = ["sensitive": true, "isNew": isNew, "source": source, "tier": tier, "oldOn": oldOn]
        guard let r = Core.shared.call("siteAccess.sensitiveAdd", [f]) as? [String: Any] else {
            // (no answer: off, and a chat's version waits: the safe side)
            return SensitiveAdd(off: isNew, newOff: isNew ? "sensitive" : nil, holds: ["chat", "pasted", "quick"].contains(source) ? ["change"] : [])
        }
        return SensitiveAdd(off: r["off"] as? Bool ?? isNew, newOff: r["newOff"] as? String, holds: r["holds"] as? [String] ?? [])
    }

    // MARK: words (drafts, docs/IOS-APP-STRINGS.md; the first line and Connect are Tim's, approved)

    static func disconnectedLine(_ site: String) -> String { "TRIF is disconnected on \(site)." }
    /// The sensitive card's extra line (desktop's sensitive wording, SENSITIVE-STRINGS.md: "it's {why}", "on your list of
    /// sensitive sites").
    static func sensitiveLine(_ c: Card) -> String? {
        guard c.sensitive else { return nil }
        return c.why.isEmpty ? "It\u{2019}s on your list of sensitive sites." : "It\u{2019}s \(c.why), so it\u{2019}s on TRIF\u{2019}s list of sensitive sites."
    }
}

// TRIF's browser features (Tim 11-20: "i think i'm fine with browser features working, as long as they're beyond the
// modification powers of the agents and mods"; docs/MOBILE-BEHAVIOUR.md, Site access). What a browser does by itself,
// on every site, connected or not, sensitive or not: a video picks up where it was (VideoResume), sound and video play
// on as the app leaves (BackgroundPlay), what plays pauses while the microphone listens and plays on after, the tab
// list's "is it playing" and password-field looks, the desktop agent put right after back/forward. Nothing of it is a
// mod or AI, and nothing it learns leaves the app's own bookkeeping (the tab's video state, the diagnostics): never a
// chat, an outline, a screenshot or a mod.
//
// How it stays out of the reach of mods, agents and pages:
// - Its own content world, "trif-browser": not the page's, not TRIF's ("trif": the kit, the mod runtime), not the box,
//   not chat.js's. A world's globals, its listeners and the properties it puts on page objects are its own: nothing in
//   another world sees or calls them. Mods only ever run in the page's world, TRIF's or the box (ModStore.world: a
//   closed choice), so no mod's code is ever in this one.
// - Its code is fixed text compiled into the signed app (BrowserWorld.scripts, BrowserCall's scripts): never made
//   from anything a mod, a chat, the phone link or an agent writes, never in the mod store, nothing that syncs.
// - Its one message handler, "trifBrowser", is registered for that world only (addScriptMessageHandler(_:contentWorld:
//   name:)): WebKit gives `window.webkit.messageHandlers.trifBrowser` to no other world, so neither the page nor a mod
//   can post to it. It takes only the video messages, checked (BrowserWorld.accept), a few a second at most.
// - The app reaches into that world only through TabWebView.browserFeature(_:), a closed list of those fixed scripts
//   with number and yes/no arguments: every other script call into it, from anywhere in the app, is refused (the read
//   checkpoint below), on every site.

/// The browser features' world, scripts and message handler (see above).
@MainActor
enum BrowserWorld {
    static let world = WKContentWorld.world(name: "trif-browser")
    static let handlerName = "trifBrowser"
    static func isIt(_ w: WKContentWorld) -> Bool { w.name == world.name }

    /// Every page's, from its start, main frame only: kept as made, so a controller's can be told apart (accessState).
    static let scripts: [WKUserScript] = [BackgroundPlay.watch, VideoResume.watch].map {
        WKUserScript(source: $0, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world)
    }
    /// How many of a controller's scripts are the browser world's.
    static func count(_ ucc: WKUserContentController) -> Int { ucc.userScripts.filter { u in scripts.contains { $0 === u } }.count }

    /// Puts the browser world in a tab's controller: its scripts (again after every emptying: Browser.applyAccess) and,
    /// with `handler`, its message handler (once, as the controller is made: it stays for the controller's life).
    static func install(_ ucc: WKUserContentController, handler: BrowserFeatureHandler?) {
        // (development: `-bare`, nothing of the app's in any page)
        if DevFlags.args.contains("-bare") { return }
        for s in scripts { ucc.addUserScript(s) }
        if let handler { ucc.addScriptMessageHandler(handler, contentWorld: world, name: handlerName) }
    }

    /// The messages the browser world sends (VideoResume.watch), and what each may carry: anything else is refused.
    static let types: Set<String> = ["videoplan", "videostate", "videoplay", "videoapplied", "videoresumed"]
    /// A message's body checked: a known type, only the fields it has, strings capped, numbers finite. nil: refused.
    nonisolated static func accept(_ raw: Any?) -> [String: Any]? {
        guard let body = raw as? [String: Any], let type = body["type"] as? String, types.contains(type), body.count <= 16 else { return nil }
        let strings: Set<String> = ["type", "url", "src", "nav", "why"]
        let numbers: Set<String> = ["time", "duration", "rate", "applied", "now"]
        let flags: Set<String> = ["playing", "ended", "live", "muted", "again", "paused"]
        var out: [String: Any] = [:]
        for (k, v) in body {
            if strings.contains(k) {
                guard let t = v as? String, t.count <= 2000 else { return nil }
                out[k] = t
            } else if numbers.contains(k) {
                // (JSON's Infinity and NaN never arrive as numbers; a live stream's duration comes as -1)
                guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
                out[k] = n
            } else if flags.contains(k) {
                guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
                out[k] = n.boolValue
            } else { return nil }
        }
        return out
    }
}

/// The calls the app makes into the browser world: a closed list, each a fixed script compiled into the app, with only
/// numbers and yes/no as arguments. Through TabWebView.browserFeature only.
@MainActor
enum BrowserCall {
    /// A video or audio playing with sound on the page (Browser.playing).
    case playing
    /// The resumed video played, by the app (its play counts as the person's); `forceMuted`: development's -resumemuted.
    case play(forceMuted: Bool)
    /// "Tap for sound": the resumed video's sound on.
    case unmute
    /// The app went to the background: what WebKit paused plays on.
    case playOn(left: Double, shown: Bool)
    /// The microphone listens: what plays is paused; after, it plays on; a stuck one nudged.
    case talkPause(t0: Double)
    case talkResume(t0: Double, count: Bool)
    case talkNudge(step: Int)
    /// The page's process's agent (desktop mode after back/forward).
    case userAgent
    /// A password field showing (the tab list's picture).
    case passwordShowing

    var script: String {
        switch self {
        case .playing: return Browser.pagePlaying
        case .play: return VideoResume.play
        case .unmute: return VideoResume.unmute
        case .playOn: return BackgroundPlay.playOn
        case .talkPause: return BackgroundPlay.talkPause
        case .talkResume: return BackgroundPlay.talkResume
        case .talkNudge: return BackgroundPlay.talkNudge
        case .userAgent: return "return navigator.userAgent;"
        case .passwordShowing: return PrivatePages.passwordScript
        }
    }
    var arguments: [String: Any] {
        switch self {
        case .play(let m): return ["forceMuted": m]
        case .playOn(let left, let shown): return ["left": left, "shown": shown]
        case .talkPause(let t0): return ["t0": t0]
        case .talkResume(let t0, let count): return ["t0": t0, "count": count]
        case .talkNudge(let step): return ["step": step]
        case .playing, .unmute, .userAgent, .passwordShowing: return [:]
        }
    }
    /// For a refusal's or a log's line.
    var name: String { String("\(self)".prefix(while: { $0 != "(" })) }
}

/// The browser world's message handler (registered for that world only, in each tab's controller): the video messages,
/// checked, to Browser.videoMessage, at most 40 a tab in any 10 s (the page's own media events drive the watch).
@MainActor
final class BrowserFeatureHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var browser: Browser?
    private var recent: [ObjectIdentifier: [Date]] = [:]
    private var toldRefused = Set<String>()

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        // (WebKit gives this handler to the browser world only; checked again, and the page itself, never a frame)
        guard BrowserWorld.isIt(message.world), message.frameInfo.isMainFrame, let wv = message.webView as? TabWebView,
              let body = BrowserWorld.accept(message.body), let type = body["type"] as? String else {
            let why = !BrowserWorld.isIt(message.world) ? "from another world (\(message.world.name ?? "the page's"))" : !message.frameInfo.isMainFrame ? "from a frame" : "not one of its messages"
            if toldRefused.insert(why).inserted { Diagnostics.shared.log("browser world", "a message was refused: \(why)") }
            return (nil, "not a browser feature's message")
        }
        let key = ObjectIdentifier(wv), now = Date()
        var times = (recent[key] ?? []).filter { now.timeIntervalSince($0) < 10 }
        guard times.count < 40 else {
            if toldRefused.insert("busy \(Diagnostics.place(wv.url))").inserted { Diagnostics.shared.log("browser world", "more than 40 messages in 10 s from \(Diagnostics.place(wv.url)): dropped until it calms") }
            return (nil, "too many")
        }
        times.append(now)
        recent[key] = times
        if recent.count > 64 { recent = recent.filter { $0.value.contains { now.timeIntervalSince($0) < 10 } } }
        guard let browser else { return (nil, "no browser") }
        return await browser.videoMessage(type, body, wv)
    }
}

/// A tab's web view: every way the app reads a page goes through here, and refuses on a page TRIF isn't connected on
/// (the one native choke point; Tim 11-20: "is that disconnection actually robust?"). JavaScript in any world (the
/// Swift async forms call these same methods), a snapshot (the tab list's own pictures excepted: `tabPicture`, kept on
/// the phone, never sent), a PDF, a web archive, find. `pageConnected`: the document in it was loaded with TRIF in it
/// (Browser.applyAccess), or its site was connected while it was shown; a frame is asked about by its own origin too.
final class TabWebView: WKWebView {
    /// The document now in this web view was loaded with TRIF's scripts (or connected since).
    var pageConnected = false
    /// What a refusal was last told for, so Diagnostics gets one line a page.
    private var toldFor: String?

    static let refusedDomain = "TRIF.disconnected"

    /// Whether TRIF may read this page (and that frame of it) now.
    var readable: Bool { pageConnected && SiteAccess.shared.allows(url) }
    private func readable(_ frame: WKFrameInfo?) -> Bool {
        guard readable else { return false }
        guard let f = frame, !f.isMainFrame else { return true }
        let o = f.securityOrigin
        return SiteAccess.shared.allows(URL(string: "\(o.protocol)://\(o.host)\(o.port > 0 ? ":\(o.port)" : "")/"))
    }
    private func refusal(_ what: String) -> NSError {
        let site = SiteAccess.shared.scope(SiteAccess.host(url))
        let place = "\(site)|\(url?.path ?? "")"
        if toldFor != place {
            toldFor = place
            Diagnostics.shared.log("site access", "refused \(what) on \(site.isEmpty ? "a page with no site" : site): TRIF isn't connected there\(pageConnected ? "" : " (the page was loaded without TRIF)")")
        }
        return NSError(domain: TabWebView.refusedDomain, code: 1, userInfo: [NSLocalizedDescriptionKey: "TRIF is disconnected on \(site.isEmpty ? "this page" : site)",
                                                                             "WKJavaScriptExceptionMessage": "TRIF is disconnected on \(site.isEmpty ? "this page" : site)"])
    }

    override func __evaluateJavaScript(_ javaScriptString: String, inFrame frame: WKFrameInfo?, in contentWorld: WKContentWorld, completionHandler: (@MainActor @Sendable (Any?, (any Error)?) -> Void)? = nil) {
        guard !BrowserWorld.isIt(contentWorld) else { let e = browserWorldRefusal(); completionHandler?(nil, e); return }
        guard readable(frame) else { let e = refusal("a script"); completionHandler?(nil, e); return }
        super.__evaluateJavaScript(javaScriptString, inFrame: frame, in: contentWorld, completionHandler: completionHandler)
    }
    override func __callAsyncJavaScript(_ functionBody: String, arguments: [String: Any]? = nil, inFrame frame: WKFrameInfo?, in contentWorld: WKContentWorld, completionHandler: (@MainActor @Sendable (Any?, (any Error)?) -> Void)? = nil) {
        guard !BrowserWorld.isIt(contentWorld) else { let e = browserWorldRefusal(); completionHandler?(nil, e); return }
        guard readable(frame) else { let e = refusal("a script"); completionHandler?(nil, e); return }
        super.__callAsyncJavaScript(functionBody, arguments: arguments, inFrame: frame, in: contentWorld, completionHandler: completionHandler)
    }
    override func evaluateJavaScript(_ javaScriptString: String, completionHandler: (@MainActor @Sendable (Any?, (any Error)?) -> Void)? = nil) {
        guard readable else { let e = refusal("a script"); completionHandler?(nil, e); return }
        super.evaluateJavaScript(javaScriptString, completionHandler: completionHandler)
    }
    override func takeSnapshot(with snapshotConfiguration: WKSnapshotConfiguration?, completionHandler: @escaping @MainActor @Sendable (UIImage?, (any Error)?) -> Void) {
        guard readable else { let e = refusal("a screenshot"); completionHandler(nil, e); return }
        super.takeSnapshot(with: snapshotConfiguration, completionHandler: completionHandler)
    }
    override func __createPDF(with pdfConfiguration: WKPDFConfiguration?, completionHandler: @escaping @MainActor @Sendable (Data?, (any Error)?) -> Void) {
        guard readable else { let e = refusal("a PDF"); completionHandler(nil, e); return }
        super.__createPDF(with: pdfConfiguration, completionHandler: completionHandler)
    }
    override func __createWebArchiveData(completionHandler: @escaping @MainActor @Sendable (Data?, (any Error)?) -> Void) {
        guard readable else { let e = refusal("a web archive"); completionHandler(nil, e); return }
        super.__createWebArchiveData(completionHandler: completionHandler)
    }
    override func __find(_ string: String, with configuration: WKFindConfiguration?, completionHandler: @escaping @MainActor @Sendable (WKFindResult) -> Void) {
        guard readable else { _ = refusal("a find"); return }
        super.__find(string, with: configuration, completionHandler: completionHandler)
    }

    static let browserWorldDomain = "TRIF.browserWorld"
    private var toldBrowserWorld = false
    /// Any script call into the browser features' world but theirs (browserFeature): refused, on every site.
    private func browserWorldRefusal() -> NSError {
        if !toldBrowserWorld {
            toldBrowserWorld = true
            Diagnostics.shared.log("browser world", "refused a script into the browser features' world: only their own calls reach it")
        }
        return NSError(domain: TabWebView.browserWorldDomain, code: 1, userInfo: [NSLocalizedDescriptionKey: "only TRIF's browser features call into their world",
                                                                                  "WKJavaScriptExceptionMessage": "only TRIF's browser features call into their world"])
    }

    /// One of TRIF's browser features calls into its own world (BrowserWorld): on every page, connected or not (the one
    /// exception to the checkpoint above, and the only way into that world). A fixed script from a closed list, numbers
    /// and yes/no for arguments, the page's main frame; its answer as text (nil: none), for the app's bookkeeping only.
    func browserFeature(_ call: BrowserCall) async throws -> String? {
        try await withCheckedThrowingContinuation { (k: CheckedContinuation<String?, Error>) in
            super.__callAsyncJavaScript(call.script, arguments: call.arguments, inFrame: nil, in: BrowserWorld.world) { v, e in
                if let e { k.resume(throwing: e) } else { k.resume(returning: v.flatMap { $0 is NSNull ? nil : "\($0)" }) }
            }
        }
    }

    /// The tab list's own picture of the page (TabShots): kept on this phone for the card, never sent anywhere, as
    /// Safari's tab pictures; taken on a disconnected page too (a sensitive site's never: PrivatePages).
    func tabPicture(_ cfg: WKSnapshotConfiguration?, _ done: @escaping @MainActor @Sendable (UIImage?, (any Error)?) -> Void) {
        super.takeSnapshot(with: cfg, completionHandler: done)
    }
}

/// ⋯ → Sensitive sites…: the person's own sensitive sites (added to TRIF's list, desktop's Settings list), and TRIF's
/// list to look at. A site on it starts disconnected like every site, and once connected is a site of its own where
/// mods start off and a chat makes only style and boxed mods. Words: drafts (docs/IOS-APP-STRINGS.md).
struct SensitiveSitesView: View {
    @ObservedObject private var access = SiteAccess.shared
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var refused = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("bank.example.com or *bank*", text: $typed)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                            .onSubmit(add)
                        Button("Add", action: add).disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if refused { Text("That isn\u{2019}t a site or a pattern TRIF can use.").font(.footnote).foregroundStyle(.red) }
                    ForEach(access.own, id: \.self) { p in Text(p) }
                        .onDelete { i in for n in i.map({ access.own[$0] }) { access.removeOwn(n) } }
                } header: { Text("Yours") } footer: {
                    Text("Sensitive sites start disconnected. Once you connect one, its mods start off, and a chat can only make style and boxed mods there.")
                }
                Section("TRIF\u{2019}s list") {
                    ForEach(access.list.filter { !$0.own }, id: \.pattern) { x in
                        HStack { Text(x.pattern); Spacer(); Text(x.why).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            .navigationTitle("Sensitive sites")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func add() {
        refused = !access.addOwn(typed)
        if !refused { typed = "" }
    }
}
