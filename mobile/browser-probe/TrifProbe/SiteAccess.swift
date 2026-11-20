import Foundation
import SwiftUI
import UIKit
import WebKit

// Site access (Tim, 2026-11-20: "I want people feeling comfortable with TRIF as their browser and still using it for
// banking etc." … "let's opt in per site"; docs/MOBILE-BEHAVIOUR.md, Site access). Every site starts disconnected, and
// on a disconnected site TRIF adds nothing to the page: the tab's own WKUserContentController holds none of TRIF's
// scripts and no message handler of TRIF's (Browser.applyAccess, before the page's document starts), and every way the
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
        guard readable(frame) else { let e = refusal("a script"); completionHandler?(nil, e); return }
        super.__evaluateJavaScript(javaScriptString, inFrame: frame, in: contentWorld, completionHandler: completionHandler)
    }
    override func __callAsyncJavaScript(_ functionBody: String, arguments: [String: Any]? = nil, inFrame frame: WKFrameInfo?, in contentWorld: WKContentWorld, completionHandler: (@MainActor @Sendable (Any?, (any Error)?) -> Void)? = nil) {
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
