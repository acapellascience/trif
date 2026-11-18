// Tabs (branch ios-poc): several pages open at once, each in a web view of its own with its own back and forward,
// all sharing one configuration (so the same scripts, mods, cookies and sign-ins). Kept between launches: each
// tab's address, title and back/forward list (WebKit's interactionState), restored when the tab is first shown.

import SwiftUI
import WebKit
import ImageIO

@MainActor
final class Tab: ObservableObject, Identifiable {
    let id: UUID
    /// Its web view: made again when the tab comes back after being let go in the background (Browser.discard).
    private(set) var webView: WKWebView
    func replaceWebView(_ wv: WKWebView) { webView = wv; committedAt = nil; finishedAt = nil }
    @Published var title: String
    @Published var url: URL?
    @Published var loading = false
    /// Its picture for the tab list changed (taken, or dropped): the card reads it again (TabShots: the pictures
    /// themselves are on disk and in a small cache, never held by the tab).
    @Published var shotVersion = 0
    /// When its web view last committed a page and finished loading one: a page is "drawn" a moment after it has
    /// finished, or a while after it committed (a page still loading its last pieces). Not drawn: a web view just made
    /// (a restored tab, one let go and made again) or one whose page process ended. A tab that isn't drawn keeps the
    /// picture it had (Tim, 11-18: restored tabs left before they drew were kept as blank cards).
    var committedAt: Date?
    var finishedAt: Date?
    var drawn: Bool {
        if let f = finishedAt { return Date().timeIntervalSince(f) > 0.3 }
        if let c = committedAt { return Date().timeIntervalSince(c) > 2.5 }
        return false
    }
    /// What to restore when the tab is first shown: its back/forward list, else its address.
    var savedState: Data?
    var savedURL: URL?
    var started = false
    /// Its page was last loaded as a computer's (Request Desktop Website, Browser.desktopHosts).
    var desktop = false
    /// When its page last came back in the other mode's agent and was loaded again (Browser.checkAgent).
    var agentFixedAt: Date?
    var watches: [NSKeyValueObservation] = []

    init(id: UUID = UUID(), webView: WKWebView, title: String = "", url: URL? = nil) {
        self.id = id
        self.webView = webView
        self.title = title
        self.url = url
    }

    /// The tab's name in the switcher: its title, else its host, else New tab.
    var label: String { !title.isEmpty ? title : url?.host ?? (savedURL?.host ?? "New tab") }
    var host: String { (url ?? savedURL)?.host ?? "" }
}

/// The tabs' pictures for the tab list, as Safari's and Chrome's (Tim, 11-15: only the shown tab had one; 11-18:
/// "a lot of the tabs in tab view are still blank when I load them up"). WebKit's public takeSnapshot, taken only of
/// the shown tab: as it's left, as the tab list opens, as the app leaves the front, and a second after a page has
/// loaded in it; at most once every few seconds a tab (unless its address changed), never mid-scroll, and only once
/// its page has drawn (`Tab.drawn`), and a picture all of one colour (a page not drawn yet) is never kept: the card
/// keeps the one before. Kept as a small JPEG per tab (Caches/tab-shots/<tab id>.jpg, the card's shape and size at the
/// screen's scale, the part under the address bar left out), written off the main thread; deleted with its tab, and
/// files of tabs no longer open dropped at launch. Cards read them lazily (only cards on the screen, downscaled,
/// through a small cache), so a list of many tabs holds a few pictures, not all. Sensitive pages (PrivatePages:
/// TRIF's sensitive sites, sign-in pages, a page with a password field showing) are never pictured, and their tab's
/// old picture goes: their card is the letter card. No page is ever loaded just to make its card.
@MainActor
final class TabShots {
    static let shared = TabShots()
    /// At most one picture a tab this often (the same address).
    static let every: TimeInterval = 3
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tab-shots", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private let io = DispatchQueue(label: "trif.tab-shots", qos: .utility)
    private func file(_ id: UUID) -> URL { dir.appendingPathComponent("\(id.uuidString).jpg") }
    /// The tabs with a picture on disk (read from the folder once, kept up to date).
    private var kept: Set<UUID> = []
    /// Pictures read lately, downscaled: a few cards' worth (cost = bytes decoded).
    private let cache: NSCache<NSUUID, UIImage> = { let c = NSCache<NSUUID, UIImage>(); c.totalCostLimit = 12 << 20; return c }()
    private var last: [UUID: (at: Date, url: URL)] = [:]
    /// (development, the `tabshots` step) pictures read from disk since launch.
    private(set) var reads = 0

    private init() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        kept = Set(names.compactMap { $0.hasSuffix(".jpg") ? UUID(uuidString: String($0.dropLast(4))) : nil })
    }

    func has(_ id: UUID) -> Bool { kept.contains(id) }

    /// The tab's card width in points: two columns with 14 pt between and round them (TabsView).
    private static func cardWidth(_ windowWidth: CGFloat) -> CGFloat { max(100, ((windowWidth - 42) / 2).rounded(.up)) }

    /// Pictures the tab now if it can (see above); a failed or skipped try keeps the picture it had. `retries`: tries
    /// again a second later while the page is scrolling (a load's picture). Each try is in the diagnostics (11-16).
    func take(_ tab: Tab, _ why: String = "", retries: Int = 0) {
        let wv = tab.webView
        guard let url = wv.url else { return }
        let host = tab.host.isEmpty ? "a new tab" : tab.host
        if let reason = PrivatePages.why(url) { drop(tab, "\(host) (\(why)): not taken, \(reason)"); return }
        guard let window = wv.window, wv.bounds.width > 10 else {
            Diagnostics.shared.log("tab shot", "\(host) (\(why)): not taken, its page isn't on the screen\(wv.window == nil ? "" : " (no size)")")
            return
        }
        guard tab.drawn else {
            Diagnostics.shared.log("tab shot", "\(host) (\(why)): not taken, its page hasn't drawn yet; the one before is kept")
            return
        }
        if let l = last[tab.id], l.url == url, Date().timeIntervalSince(l.at) < TabShots.every { return }
        let sv = wv.scrollView
        if sv.isDragging || sv.isDecelerating || sv.isZooming {
            if retries > 0 {
                Task { @MainActor [weak tab] in
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    if let tab { TabShots.shared.take(tab, why, retries: retries - 1) }
                }
            } else { Diagnostics.shared.log("tab shot", "\(host) (\(why)): not taken, the page is scrolling; the one before is kept") }
            return
        }
        // (the page from just under the address bar, which lies over it, the card's shape; what's under the toolbar
        // and any note over the page's foot is the page's too, and is kept: a card never comes out short)
        var top: CGFloat = 0
        if #available(iOS 26, *) { top = wv.obscuredContentInsets.top }
        let w = wv.bounds.width
        let h = min(wv.bounds.height - top, (w / TabCard.shape).rounded())
        guard h > 40 else { return }
        last[tab.id] = (Date(), url)
        let cfg = WKSnapshotConfiguration()
        cfg.rect = CGRect(x: 0, y: top, width: w, height: h)
        cfg.snapshotWidth = NSNumber(value: Double(min(w, TabShots.cardWidth(window.bounds.width))))
        cfg.afterScreenUpdates = false
        let id = tab.id
        let path = file(id)
        wv.takeSnapshot(with: cfg) { [weak tab, weak wv] image, error in
            guard let tab, let wv else { return }
            guard let image, image.size.width > 1 else {
                Diagnostics.shared.log("tab shot", "\(host) (\(why)): WebKit gave no picture\(error.map { ": \($0.localizedDescription)" } ?? ""); the one before is kept")
                return
            }
            Task { @MainActor in
                // (a sign-in form on any site: a password field showing, asked in TRIF's world; a page that doesn't
                // answer within a second counts as having none)
                if await PrivatePages.passwordShowing(wv) { self.drop(tab, "\(host) (\(why)): not taken, a password field shows"); return }
                if TabShots.oneColour(image) {
                    self.last[id] = nil
                    Diagnostics.shared.log("tab shot", "\(host) (\(why)): not kept, all one colour (not drawn yet?); the one before is kept")
                    return
                }
                let px = "\(Int(image.size.width * image.scale))x\(Int(image.size.height * image.scale))"
                self.cache.setObject(image, forKey: id as NSUUID, cost: TabShots.cost(image))
                self.kept.insert(id)
                tab.shotVersion += 1
                self.io.async {
                    let outcome: String
                    if let data = image.jpegData(compressionQuality: 0.7) {
                        do { try data.write(to: path, options: .atomic); outcome = "saved, \(data.count / 1000) kB" } catch { outcome = "not saved: \(error.localizedDescription)" }
                    } else { outcome = "not saved: no JPEG" }
                    Diagnostics.logLater("tab shot", "\(host) (\(why)): taken, \(px), \(outcome)")
                }
            }
        }
    }

    /// The tab's picture goes (its page is a sensitive one now): its card is the letter card.
    private func drop(_ tab: Tab, _ line: String) {
        last[tab.id] = nil
        guard kept.contains(tab.id) || cache.object(forKey: tab.id as NSUUID) != nil else { return }
        Diagnostics.shared.log("tab shot", line + "; its old picture deleted")
        remove(tab.id)
        tab.shotVersion += 1
    }

    /// A card's picture: from the cache, else read from disk off the main thread, downscaled to at most a card's size.
    func image(_ id: UUID, scale: CGFloat) async -> UIImage? {
        if let i = cache.object(forKey: id as NSUUID) { return i }
        guard kept.contains(id) else { return nil }
        let url = file(id)
        // (a card is at most ~200 pt wide on a phone; an iPad's are wider)
        let maxPx = Int(((UIDevice.current.userInterfaceIdiom == .pad ? 600 : 220) / TabCard.shape * scale).rounded(.up))
        let image: UIImage? = await withCheckedContinuation { k in
            io.async {
                let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: maxPx,
                                             kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true]
                guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { k.resume(returning: nil); return }
                k.resume(returning: UIImage(cgImage: cg, scale: scale, orientation: .up))
            }
        }
        reads += 1
        if let image { cache.setObject(image, forKey: id as NSUUID, cost: TabShots.cost(image)) } else { kept.remove(id) }
        return image
    }

    private static func cost(_ i: UIImage) -> Int { Int(i.size.width * i.scale * i.size.height * i.scale * 4) }

    /// A picture all of one colour (a page that hasn't drawn: white, or black in dark mode): its grey levels at
    /// 12 × 16 all within a few steps of each other.
    nonisolated static func oneColour(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage else { return false }
        let w = 12, h = 16
        var px = [UInt8](repeating: 0, count: w * h)
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn, let lo = px.min(), let hi = px.max() else { return false }
        return Int(hi) - Int(lo) <= 6
    }

    func remove(_ id: UUID) {
        kept.remove(id)
        last[id] = nil
        cache.removeObject(forKey: id as NSUUID)
        let url = file(id)
        io.async { try? FileManager.default.removeItem(at: url) }
    }

    /// At launch: pictures of tabs no longer open (closed while a picture was being written, an older build's) go.
    func dropOrphans(keeping open: Set<UUID>) {
        let orphans = kept.subtracting(open)
        guard !orphans.isEmpty else { return }
        kept.subtract(orphans)
        let dir = self.dir
        io.async {
            let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
            var gone = 0
            for n in names where !open.contains(where: { "\($0.uuidString).jpg" == n }) {
                if (try? FileManager.default.removeItem(at: dir.appendingPathComponent(n))) != nil { gone += 1 }
            }
            Diagnostics.logLater("tab shot", "at launch: \(gone) picture\(gone == 1 ? "" : "s") of tabs no longer open deleted")
        }
    }

    /// (development, the `tabshots` step) each tab's picture on disk, and the folder.
    func describe(_ tabs: [Tab], current: Tab?) -> String {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        var lines = tabs.enumerated().map { n, t -> String in
            let f = file(t.id)
            let size = (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize).map { "\($0 / 1000) kB" }
            let px = CGImageSourceCreateWithURL(f as CFURL, nil).flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) as? [CFString: Any] }
                .map { "\($0[kCGImagePropertyPixelWidth] ?? "?")x\($0[kCGImagePropertyPixelHeight] ?? "?")" }
            let priv = (t.webView.url ?? t.savedURL).flatMap(PrivatePages.why).map { ", \($0)" } ?? ""
            return "\(n)\(t === current ? "*" : "") \(t.host.nonEmpty ?? "-"): \(size.map { "picture \(px ?? "?") \($0)" } ?? "no picture")\(priv), drawn \(t.drawn), started \(t.started)"
        }
        let open = Set(tabs.map { "\($0.id.uuidString).jpg" })
        lines.append("folder: \(names.count) files, \(names.filter { !open.contains($0) }.count) not of an open tab; read from disk since launch: \(reads)")
        return lines.joined(separator: "\n")
    }
}

/// Pages TRIF never pictures for the tab list: TRIF's sensitive sites (the desktop's list, extension/agentsites.js
/// SENSITIVE_DEFAULT, read from the panel's copy in the app: email, money, passwords, messages, AI chats, files,
/// government accounts; the phone has no list of the person's own), sign-in services and sign-in pages, and any page
/// showing a password field.
enum PrivatePages {
    /// Sign-in services (and their subdomains).
    static let signIn = ["accounts.google.com", "appleid.apple.com", "idmsa.apple.com", "account.apple.com", "login.microsoftonline.com",
                         "login.live.com", "account.live.com", "login.yahoo.com", "auth0.com", "okta.com", "onelogin.com", "auth.openai.com"]
    /// A sign-in page's address on any site (x.com/i/flow/login, github.com/login, instagram.com/accounts/login).
    private static let signInPath = try! NSRegularExpression(pattern: "(^|/)(log-?in|sign-?in|sign_in|log_in|auth|oauth2?|sso|session|i/flow/login)(/|\\.|$)", options: [.caseInsensitive])

    /// TRIF's sensitive list, [(pattern, why)], read once from the bundle's panel/agentsites.js.
    static let sensitive: [(String, String)] = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("panel/agentsites.js"),
              let text = try? String(contentsOf: url, encoding: .utf8),
              let start = text.range(of: "SENSITIVE_DEFAULT = ["), let end = text.range(of: "\n];", range: start.upperBound..<text.endIndex) else {
            Diagnostics.logLater("tab shot", "the sensitive sites' list wasn't found in the app; only sign-in pages are left out")
            return []
        }
        let block = String(text[start.upperBound..<end.lowerBound])
        let re = try! NSRegularExpression(pattern: "\\['([^']+)', '([^']*)'\\]")
        return re.matches(in: block, range: NSRange(block.startIndex..., in: block)).compactMap { m in
            guard let p = Range(m.range(at: 1), in: block), let w = Range(m.range(at: 2), in: block) else { return nil }
            return (String(block[p]), String(block[w]))
        }
    }()

    /// Why a page isn't pictured, or nil.
    static func why(_ url: URL) -> String? {
        let host = (url.host ?? "").lowercased().replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
        guard !host.isEmpty else { return nil }
        if let hit = sensitive.first(where: { matches($0.0, host) }) { return "a sensitive site (\(hit.1.isEmpty ? hit.0 : hit.1))" }
        if signIn.contains(where: { host == $0 || host.hasSuffix("." + $0) }) { return "a sign-in page" }
        let path = url.path
        if signInPath.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil { return "a sign-in page" }
        return nil
    }

    /// agentsites.js patternMatches: a host and its subdomains; `*` within a label (`*bank*` any label, `*.bank` the
    /// last labels).
    static func matches(_ pattern: String, _ host: String) -> Bool {
        let p = pattern.lowercased().replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
        guard !p.isEmpty, !host.isEmpty else { return false }
        if !p.contains("*") { return host == p || host.hasSuffix("." + p) }
        let labels = host.split(separator: ".").map(String.init)
        let pl = p.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        let label = { (lab: String, s: String) -> Bool in
            let re = "^" + lab.split(separator: "*", omittingEmptySubsequences: false).map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: "[a-z0-9-]*") + "$"
            return s.range(of: re, options: .regularExpression) != nil
        }
        if pl.count == 1 { return labels.contains { label(pl[0], $0) } }
        guard labels.count >= pl.count else { return false }
        let tail = Array(labels.suffix(pl.count))
        return zip(pl, tail).allSatisfy { label($0, $1) }
    }

    /// A password field showing on the page (asked in TRIF's world, a second at most).
    static func passwordShowing(_ wv: WKWebView) async -> Bool {
        await Browser.within(1, false) {
            let r = try? await wv.callAsyncJavaScript("return [...document.querySelectorAll('input[type=password]')].some((e) => e.offsetWidth > 0 && e.offsetHeight > 0)",
                                                      arguments: [:], in: nil, contentWorld: Browser.trifWorld)
            return (r as? Bool) ?? false
        }
    }
}

/// What's kept of the tabs between launches (Application Support/tabs.json).
struct SavedTabs: Codable {
    struct One: Codable { var id: UUID; var url: String?; var title: String; var state: Data? }
    var tabs: [One]
    var selected: UUID?

    static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("tabs.json")
    }
    static func load() -> SavedTabs? { (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(SavedTabs.self, from: $0) } }
    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        var url = SavedTabs.file
        try? data.write(to: url, options: .atomic)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }
}

/// The tab switcher: every tab as a card (its picture and title), tap to switch, × to close, + for a new one.
struct TabsView: View {
    @EnvironmentObject var browser: Browser
    /// (the tabs' chats: each card's robot badge, Tim 11-18)
    @ObservedObject var pane: ClaudePane
    /// The tab it opens at, marked as the current one (Tim, 11-18: "it should snap to the tab that I just left"):
    /// the shown tab, or, from a chat, the chat's own tab (ContentView.tabsFocus). nil: the shown tab.
    var focus: UUID? = nil
    /// Closes it (it lies over the page, the toolbar under it).
    var close: () -> Void = {}
    private func dismiss() { close() }
    private let columns = [GridItem(.flexible(minimum: 60), spacing: 14, alignment: .top), GridItem(.flexible(minimum: 60), spacing: 14, alignment: .top)]
    /// (where the list is scrolled to: the focused card from the first frame, no scroll from the top)
    @State private var at: UUID?
    private var marked: UUID { focus.flatMap { id in browser.tabs.contains { $0.id == id } ? id : nil } ?? browser.current.id }

    init(pane: ClaudePane, focus: UUID? = nil, close: @escaping () -> Void = {}) {
        self.pane = pane
        self.focus = focus
        self.close = close
        _at = State(initialValue: focus)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(browser.tabs) { tab in
                        TabCard(tab: tab, current: tab.id == marked, chat: pane.badge(for: tab.id),
                                select: { browser.select(tab); dismiss() },
                                close: { withAnimation { browser.close(tab) } })
                        .id(tab.id)
                    }
                }
                .scrollTargetLayout()
                .padding(14)
            }
            .scrollPosition(id: $at, anchor: .center)
            .onAppear {
                // (no animation: the list opens already there)
                let id = marked
                if at != id { at = id }
                var t = Transaction(); t.disablesAnimations = true
                withTransaction(t) { proxy.scrollTo(id, anchor: .center) }
                TabsView.lastFocus = id
            }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(browser.tabs.count == 1 ? "1 tab" : "\(browser.tabs.count) tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { browser.newTab(); dismiss() } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New tab")
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

extension TabsView {
    /// (development: the card the list last opened at, for the step {"tabsfocus": 1})
    static var lastFocus: UUID?
}

struct TabCard: View {
    /// A card's width to its height: about a phone screen's, a little shorter, so two rows show on a small one.
    static let shape: CGFloat = 0.7
    @ObservedObject var tab: Tab
    let current: Bool
    /// Its chat's state, if it has one: a small robot at the card's top left, its eyes moving while Claude works, a
    /// dot while a reply waits unread, plain once read.
    var chat: ChatActivity? = nil
    let select: () -> Void
    let close: () -> Void
    @Environment(\.displayScale) private var scale
    /// Its picture, read while the card is on the screen (TabShots), let go when it scrolls off.
    @State private var shot: UIImage?

    /// The site as the card names it: the host without www.
    private var site: String { tab.host.replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression) }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ZStack(alignment: .topTrailing) {
                Button(action: select) {
                    // (a portrait card the column's width: the shape is set by a clear frame, the picture laid over it
                    // and clipped, so a wide picture can't widen the card past its column. Tim, 11-15, on an SE: it did)
                    Color(.secondarySystemBackground)
                        .aspectRatio(TabCard.shape, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            if let shot {
                                // (the card's width, from the top, cut off at the bottom: a picture of a shorter view
                                // (the bars taller then) leaves the card's grey under it rather than being zoomed)
                                GeometryReader { g in
                                    Image(uiImage: shot).resizable()
                                        .frame(width: g.size.width, height: g.size.width * shot.size.height / max(1, shot.size.width))
                                }
                            } else if !TabShots.shared.has(tab.id) {
                                // (no picture yet, or a page never pictured (a sensitive one): the site's first letter
                                // in a circle; a picture still being read shows the plain card a moment)
                                letter.frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(current ? Color.trifGreen : Color(.separator), lineWidth: current ? 3 : 0.5))
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .overlay(alignment: .topLeading) {
                    if let chat {
                        ChatGlyph(activity: chat).frame(width: 16, height: 16)
                            .foregroundStyle(Color.trifGreen)
                            .padding(5)
                            .background(Circle().fill(.regularMaterial))
                            .padding(6)
                            .allowsHitTesting(false)
                            .accessibilityLabel(chat == .working ? "Chat, working" : chat == .replied ? "Chat, reply waiting" : "Chat")
                    }
                }
                Button(action: close) {
                    Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.white)
                        .frame(width: 24, height: 24).background(Circle().fill(Color.black.opacity(0.55)))
                }
                .padding(6)
                .accessibilityLabel("Close \(tab.label)")
            }
            .padding(.bottom, 4)
            Text(tab.label).font(.caption).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            // (the site under the title; a tab with no title is already named by its site)
            if !site.isEmpty, tab.label != tab.host {
                Text(site).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: tab.shotVersion) { shot = await TabShots.shared.image(tab.id, scale: scale) }
        .onDisappear { shot = nil }
    }

    /// The fallback: the site's first letter (a new tab's globe) in a circle, in the app's greys.
    private var letter: some View {
        let first = String(Site.of(site).prefix(1)).uppercased()
        return ZStack {
            Circle().fill(Color(.tertiarySystemFill))
            if first.isEmpty { Image(systemName: "globe").font(.title2) } else { Text(first).font(.title.weight(.semibold)) }
        }
        .foregroundStyle(.secondary)
        .frame(width: 64, height: 64)
        .accessibilityHidden(true)
    }
}

/// A new tab's page: the address bar is ready to type in; under it, the sites visited lately.
struct NewTabView: View {
    @EnvironmentObject var browser: Browser
    @ObservedObject var history: HistoryStore

    var body: some View {
        List {
            let recent = history.recentSites(12)
            if recent.isEmpty {
                Text("Type an address or a search above.").foregroundStyle(.secondary)
            } else {
                Section("Visited lately") {
                    ForEach(recent, id: \.url) { e in
                        Button { browser.go(e.url) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title.isEmpty ? e.host : e.title).lineLimit(1)
                                Text(e.host).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}
