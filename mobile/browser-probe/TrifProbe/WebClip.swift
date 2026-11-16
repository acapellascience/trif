// A site's own icon on the Home Screen that opens it in TRIF (Tim, 11-16): an iOS configuration profile with one
// Web Clip whose address is trif://open?url=<the site>, full screen, so a tap shows a blank web-app screen for a moment
// and then opens TRIF, with no Safari and no question (see `profile`). The profile is made here (its icon the site's
// own: its apple-touch-icon, else its web app manifest's, else its favicon on a tile, else its letter), and handed to
// Safari from a tiny server on 127.0.0.1 that lives only until Safari has fetched it: Safari is what offers to
// download a profile ("Profile Downloaded"), then Settings installs it. One profile per site, with a fixed
// identifier, so adding a site again replaces its icon.

import CryptoKit
import Network
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

/// trif://open?url=<an http(s) address>: the site to open (anything else: nil).
enum TrifLink {
    static func target(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == "trif", url.host?.lowercased() == "open",
              let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
              let t = URL(string: raw), let s = t.scheme?.lowercased(), s == "https" || s == "http", t.host != nil else { return nil }
        return t
    }
    static func link(to site: URL) -> URL {
        var c = URLComponents()
        c.scheme = "trif"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "url", value: site.absoluteString)]
        return c.url!
    }
}

extension Browser {
    /// Opened from a site's Home Screen icon: its tab if one is open on that site (as an app comes back where it
    /// was), else a new tab there.
    func openFromIcon(_ target: URL) {
        let site = Site.of(target.host ?? "")
        if let t = (current.map { [$0] } ?? []).filter({ Site.of($0.host) == site }).first ?? tabs.first(where: { Site.of($0.host) == site }) {
            if t !== current { select(t) }
            report.log("icon", "opened \(site) from its Home Screen icon: its tab")
        } else {
            newTab(target.absoluteString)
            report.log("icon", "opened \(site) from its Home Screen icon: a new tab")
        }
    }
}

/// What the page says about itself for an icon: its touch icons, manifest, favicons and names.
struct SiteFace {
    var site: String
    var start: URL
    var name: String
    var icon: UIImage?
    var source: String
}

@MainActor
enum WebClipMaker {
    /// The page's icons and names (read in TRIF's world: links and metas only).
    static let readPage = """
    const abs = (h) => { try { return new URL(h, location.href).href; } catch (e) { return null; } };
    const size = (s) => Math.max(0, ...String(s || '').split(/\\s+/).map((x) => parseInt(x, 10) || 0));
    const links = (sel) => [...document.querySelectorAll(sel)].map((l) => ({ href: abs(l.getAttribute('href')), size: size(l.getAttribute('sizes')) })).filter((l) => l.href);
    const meta = (n) => { const m = document.querySelector(`meta[name="${n}"], meta[property="${n}"]`); return m ? (m.getAttribute('content') || '').trim() : ''; };
    const man = document.querySelector('link[rel="manifest"]');
    return JSON.stringify({ touch: links('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]'),
      icons: links('link[rel~="icon"]'), manifest: man ? abs(man.getAttribute('href')) : null,
      appName: meta('apple-mobile-web-app-title') || meta('application-name'), siteName: meta('og:site_name'), title: document.title || '', agent: navigator.userAgent });
    """

    /// The page's site, its name and best icon (fetched as the page would fetch it: a plain request to the address
    /// the page itself names, no cookies), rendered as a 180-point square.
    static func face(of browser: Browser) async -> SiteFace? {
        guard let page = browser.webView.url, let host = page.host else { return nil }
        let site = Site.of(host)
        let start = URL(string: "\(page.scheme ?? "https")://\(host)/")!
        let r = await browser.call(readPage, in: Browser.trifWorld)
        let d = Browser.parse(r.text) as? [String: Any] ?? [:]
        let agent = d["agent"] as? String ?? ""
        func list(_ k: String) -> [(URL, Int)] { (d[k] as? [[String: Any]] ?? []).compactMap { e in (e["href"] as? String).flatMap(URL.init(string:)).map { ($0, e["size"] as? Int ?? 0) } } }
        var manifest: [String: Any] = [:]
        if let m = (d["manifest"] as? String).flatMap(URL.init(string:)), let data = await fetch(m, agent), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { manifest = j }
        // (the name: the manifest's, the page's app name or site name, a title cleaned up, the domain)
        let fromTitle: String = {
            let t = (d["title"] as? String ?? "").replacingOccurrences(of: "\u{2019}", with: "'")
            let parts = t.components(separatedBy: CharacterSet(charactersIn: "|/–—·")).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            return parts.last.flatMap { $0.count <= 24 ? $0 : nil } ?? ""
        }()
        let domainName = site.split(separator: ".").first.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? site
        let name = [manifest["short_name"] as? String, manifest["name"] as? String, d["appName"] as? String, d["siteName"] as? String, fromTitle, domainName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty && $0.count <= 30 } ?? domainName
        // (the icon: the largest apple-touch-icon; else the manifest's largest of 180 px or more, not maskable only; else
        // the largest favicon on a tile; else the letter)
        var candidates: [(URL, Int, String)] = list("touch").sorted { $0.1 > $1.1 }.map { ($0.0, $0.1, "apple-touch-icon") }
        if candidates.isEmpty { candidates.append((start.appendingPathComponent("apple-touch-icon.png"), 0, "apple-touch-icon")) }
        let base = (d["manifest"] as? String).flatMap(URL.init(string:)) ?? start
        let manifestIcons: [(URL, Int)] = (manifest["icons"] as? [[String: Any]] ?? []).compactMap { e in
            let purpose = (e["purpose"] as? String ?? "any").split(separator: " ").map(String.init)
            guard purpose.contains("any") || !purpose.contains("maskable"), let src = e["src"] as? String, let u = URL(string: src, relativeTo: base)?.absoluteURL else { return nil }
            let s = (e["sizes"] as? String ?? "").split(separator: " ").compactMap { Int($0.split(separator: "x").first ?? "") }.max() ?? 0
            return s >= 180 ? (u, s) : nil
        }.sorted { $0.1 > $1.1 }
        candidates += manifestIcons.map { ($0.0, $0.1, "manifest") }
        var favicons = list("icons").sorted { $0.1 > $1.1 }
        favicons.append((start.appendingPathComponent("favicon.ico"), 0))
        candidates += favicons.map { ($0.0, $0.1, "favicon") }
        for (u, _, kind) in candidates {
            guard let data = await fetch(u, agent), let img = UIImage(data: data), img.size.width >= 16 else { continue }
            // (a small picture, or a favicon, goes on a padded tile; a touch icon or a big manifest icon fills it)
            let px = img.size.width * img.scale
            let fill = kind != "favicon" && px >= 120
            return SiteFace(site: site, start: start, name: name, icon: render(img, fill: fill), source: kind)
        }
        return SiteFace(site: site, start: start, name: name, icon: letterTile(name), source: "letter")
    }

    nonisolated static func fetch(_ url: URL, _ agent: String) async -> Data? {
        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        var req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 10)
        req.httpShouldHandleCookies = false
        if !agent.isEmpty { req.setValue(agent, forHTTPHeaderField: "User-Agent") }
        guard let (data, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              data.count < 3_000_000 else { return nil }
        return data
    }

    static let side: CGFloat = 180

    static func render(_ img: UIImage, fill: Bool) -> UIImage {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 2
        f.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: f).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(x: 0, y: 0, width: side, height: side))
            let inset: CGFloat = fill ? 0 : side * 0.22
            let box = CGRect(x: inset, y: inset, width: side - 2 * inset, height: side - 2 * inset)
            let scale = min(box.width / img.size.width, box.height / img.size.height)
            let s = fill ? CGSize(width: side, height: side) : CGSize(width: img.size.width * scale, height: img.size.height * scale)
            img.draw(in: CGRect(x: (side - s.width) / 2, y: (side - s.height) / 2, width: s.width, height: s.height))
        }
    }

    static func letterTile(_ name: String) -> UIImage {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 2
        f.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: f).image { _ in
            UIColor(red: 0x18 / 255, green: 0x18 / 255, blue: 0x1a / 255, alpha: 1).setFill()
            UIRectFill(CGRect(x: 0, y: 0, width: side, height: side))
            let letter = String(name.prefix(1)).uppercased() as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 96, weight: .bold), .foregroundColor: UIColor(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255, alpha: 1)]
            let s = letter.size(withAttributes: attrs)
            letter.draw(at: CGPoint(x: (side - s.width) / 2, y: (side - s.height) / 2), withAttributes: attrs)
        }
    }

    /// A UUID that's always the same for the same text (so the same site's profile replaces itself).
    static func stableUUID(_ text: String) -> String {
        let h = Array(SHA256.hash(data: Data(text.utf8)))
        var b = Array(h.prefix(16))
        b[6] = (b[6] & 0x0f) | 0x50
        b[8] = (b[8] & 0x3f) | 0x80
        let hex = b.map { String(format: "%02X", $0) }.joined()
        let i = hex.index(hex.startIndex, offsetBy: 0)
        func part(_ a: Int, _ n: Int) -> String { String(hex[hex.index(i, offsetBy: a)..<hex.index(i, offsetBy: a + n)]) }
        return "\(part(0, 8))-\(part(8, 4))-\(part(12, 4))-\(part(16, 4))-\(part(20, 12))"
    }

    /// "a" or "an" before the name: an X, an Instagram, a YouTube (a short all-capitals name is said letter by letter).
    static func article(_ name: String) -> String {
        guard let c = name.first.map({ Character($0.uppercased()) }) else { return "a" }
        let spelled = name.count <= 4 && name == name.uppercased()
        return ("AEIOU".contains(c) || (spelled && "FHLMNRSX".contains(c))) ? "an" : "a"
    }

    /// The profile: one Web Clip, removable, not full screen, identified by its site.
    static func profile(_ face: SiteFace, name: String) -> Data? {
        let id = "com.timsrobot.trif.webclip.\(face.site)"
        guard let png = face.icon?.pngData() else { return nil }
        let clip: [String: Any] = [
            "PayloadType": "com.apple.webClip.managed", "PayloadVersion": 1,
            "PayloadIdentifier": "\(id).clip", "PayloadUUID": stableUUID("\(id).clip"),
            "PayloadDisplayName": "\(name) for TRIF",
            "Label": name, "URL": TrifLink.link(to: face.start).absoluteString, "Icon": png,
            // (full screen, though a site's own icon wouldn't be: a clip that isn't opens Safari, which then asks "Open in
            // TRIF?" every time; a full-screen one opens a blank web-app screen for a moment and then TRIF, no question.
            // Simulator, iOS 26.3, 11-16. TargetApplicationBundleIdentifier, which should open TRIF itself, is ignored
            // in a profile installed by hand: MDM only)
            "IsRemovable": true, "FullScreen": true, "Precomposed": true,
        ]
        let p: [String: Any] = [
            "PayloadType": "Configuration", "PayloadVersion": 1,
            "PayloadIdentifier": id, "PayloadUUID": stableUUID(id),
            "PayloadDisplayName": "\(name) for TRIF",
            "PayloadDescription": "Adds \(article(name)) \(name) icon to your Home Screen that opens \(name) in TRIF.",
            "PayloadOrganization": "TRIF", "PayloadRemovalDisallowed": false,
            "PayloadContent": [clip],
        ]
        return try? PropertyListSerialization.data(fromPropertyList: p, format: .xml, options: 0)
    }
}

/// Hands a profile to Safari: a server on this phone's loopback (127.0.0.1) that answers with it, then stops 2 s
/// later (or after 90 s, or when iOS's background time runs out); then Safari is opened at its address.
/// On Tim's iPhone (11-16) Safari found nothing listening (it worked in the Simulator), so now: the background time
/// is asked for first, before anything else (its own identifier); the server listens on the loopback interface only,
/// on a port the system picks; it must answer a test request from the app itself before Safari is opened; and each
/// step is in the diagnostics ("icon"). If any of it fails, or Safari never fetches the profile, the sheet offers to
/// save the profile to Files instead (FilesFallback below).
@MainActor
final class ProfileHandoff: NSObject, ObservableObject {
    static let shared = ProfileHandoff()
    enum State: Equatable { case idle, starting, handed, fetched, failed(String), timedOut, wrongBrowser(String) }
    @Published private(set) var state: State = .idle
    private var listener: NWListener?
    private var task: UIBackgroundTaskIdentifier = .invalid
    private var generation = 0
    private var openedAt: Date?

    private func log(_ text: String) { Diagnostics.shared.log("icon", text) }

    func hand(_ profile: Data, name: String) {
        stop(log: false)
        generation += 1
        let gen = generation
        state = .starting
        // (the background time first, its own identifier, so the server outlives the switch to Safari)
        task = UIApplication.shared.beginBackgroundTask(withName: "TRIF: a Home Screen icon for Safari") {
            MainActor.assumeIsolated {
                let me = ProfileHandoff.shared
                guard me.generation == gen else { return }
                if me.state == .handed { me.log("iOS's background time ran out before Safari fetched the profile"); me.state = .timedOut }
                me.stop(log: true)
            }
        }
        log("server starting (background time asked for: \(task != .invalid ? "yes" : "no"))")
        // (development: `-noserver` at launch, as if the server had failed, for the Files route)
        if ProcessInfo.processInfo.arguments.contains("-noserver") { fail("development: -noserver"); return }
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback // (only this phone can reach it)
        params.allowLocalEndpointReuse = true
        guard let l = try? NWListener(using: params, on: .any) else { fail("the server couldn't be made"); return }
        listener = l
        let file = name.replacingOccurrences(of: "[^A-Za-z0-9.-]+", with: "-", options: .regularExpression)
        l.newConnectionHandler = { c in
            c.start(queue: .main)
            c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { data, _, _, _ in
                let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let ping = request.hasPrefix("GET /trif-ping ")
                let body = ping ? Data("ok".utf8) : profile
                var head = "HTTP/1.1 200 OK\r\nContent-Type: \(ping ? "text/plain" : "application/x-apple-aspen-config")\r\nContent-Length: \(body.count)\r\n"
                if !ping { head += "Content-Disposition: attachment; filename=\"\(file).mobileconfig\"\r\n" }
                head += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
                c.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in
                    c.cancel()
                    guard !ping else { return }
                    // (only Safari installs a profile: 11-16, Tim's default browser, Chrome, fetched it and did nothing)
                    let agent = request.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("user-agent:") } ?? ""
                    let other = ["CriOS": "Chrome", "FxiOS": "Firefox", "EdgiOS": "Edge", "OPiOS": "Opera", "DuckDuckGo": "DuckDuckGo", "Brave": "Brave"]
                        .first { agent.contains($0.key) }?.value
                    Task { @MainActor in
                        let me = ProfileHandoff.shared
                        guard me.generation == gen else { return }
                        let after = me.openedAt.map { String(format: ", %.1f s after it was opened", Date().timeIntervalSince($0)) } ?? ""
                        if let other {
                            me.log("\(other), not Safari, fetched the profile\(after): it can't install it")
                            me.state = .wrongBrowser(other)
                            return
                        }
                        me.log("Safari fetched the profile for \(name)\(after)")
                        me.state = .fetched
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        if me.generation == gen { me.stop(log: false) }
                    }
                })
            }
        }
        l.stateUpdateHandler = { st in
            Task { @MainActor in
                let me = ProfileHandoff.shared
                guard me.generation == gen else { return }
                switch st {
                case .ready:
                    guard let port = me.listener?.port?.rawValue, port != 0 else { me.fail("the server has no port"); return }
                    me.log("listening on 127.0.0.1:\(port)")
                    // (it has to answer the app itself first: then Safari is opened, never before)
                    let ok = await ProfileHandoff.selfTest(port: port)
                    guard me.generation == gen else { return }
                    guard ok else { me.fail("the server didn't answer the app's own test"); return }
                    me.log("ready: it answered the app's own test")
                    // (in Safari whatever the default browser is: only Safari installs profiles. Safari registers
                    // x-safari-https (iOS 17 and later) but not x-safari-http (iOS 26.3 Simulator: its Info.plist, and
                    // opening it fails), so for this http address that's tried first and the plain address, which goes to
                    // the default browser, follows; a browser that isn't Safari is seen by its user agent when it fetches)
                    let path = "127.0.0.1:\(port)/\(file).mobileconfig"
                    guard let safari = URL(string: "x-safari-http://\(path)"), let plain = URL(string: "http://\(path)") else { me.fail("no address"); return }
                    me.openedAt = Date()
                    me.away = false
                    // (development: `-noopen` at launch, no browser opened, the address in the diagnostics, for testing
                    // what another browser's fetch does)
                    if ProcessInfo.processInfo.arguments.contains("-noopen") { me.log("development: not opened (\(plain.absoluteString))"); me.state = .handed; return }
                    UIApplication.shared.open(safari) { opened in
                        MainActor.assumeIsolated {
                            guard me.generation == gen else { return }
                            if opened {
                                me.log("opened in Safari (x-safari-http)")
                                if me.state == .starting { me.state = .handed }
                                return
                            }
                            me.log("x-safari-http didn't open: the plain address instead (the default browser)")
                            UIApplication.shared.open(plain) { opened in
                                MainActor.assumeIsolated {
                                    guard me.generation == gen else { return }
                                    me.log("the default browser \(opened ? "opened" : "not opened") at the profile's address")
                                    if opened { if me.state == .starting { me.state = .handed } } else { me.fail("no browser was opened") }
                                }
                            }
                        }
                    }
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 90_000_000_000)
                        guard me.generation == gen, me.state == .handed else { return }
                        me.log("timed out: Safari didn't fetch the profile in 90 s")
                        me.state = .timedOut
                        me.stop(log: false)
                    }
                case .failed(let e): me.fail("the server failed: \(e)")
                case .waiting(let e): me.log("the server is waiting: \(e)")
                default: break
                }
            }
        }
        l.start(queue: .main)
    }

    /// One request to the server from the app itself, over the same loopback: true if it answers within 2 s.
    nonisolated static func selfTest(port: UInt16) async -> Bool {
        await withCheckedContinuation { (k: CheckedContinuation<Bool, Never>) in
            let once = TakeOnce()
            let c = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
            let finish: @Sendable (Bool) -> Void = { ok in if once.take() { c.cancel(); k.resume(returning: ok) } }
            c.stateUpdateHandler = { st in
                switch st {
                case .ready:
                    c.send(content: Data("GET /trif-ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".utf8), completion: .contentProcessed { _ in
                        c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, _, _ in
                            finish(data.flatMap { String(data: $0, encoding: .utf8) }?.hasPrefix("HTTP/1.1 200") ?? false)
                        }
                    })
                case .failed, .cancelled: finish(false)
                default: break
                }
            }
            c.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { finish(false) }
        }
    }

    /// The app is back in front with Safari not having fetched the profile: it didn't work (the sheet offers Files).
    /// At once, on coming back: the moment the app is in front again after the browser had it.
    func cameBack() {
        guard away, let at = openedAt else { return }
        away = false
        switch state {
        case .handed:
            log("back in TRIF \(Int(Date().timeIntervalSince(at))) s after Safari was opened, the profile not fetched: Files offered")
            state = .timedOut
            stop(log: false)
        case .wrongBrowser(let b):
            log("back in TRIF from \(b): Files offered")
            stop(log: false)
        default: break
        }
    }
    /// The app left the front after the browser was opened (so its coming back means the person came back).
    var away = false
    private var watchers: [NSObjectProtocol] = []
    override init() {
        super.init()
        watchers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { let me = ProfileHandoff.shared; if me.openedAt != nil { switch me.state { case .handed, .starting, .wrongBrowser: me.away = true; default: break } } }
        })
        watchers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ProfileHandoff.shared.cameBack() }
        })
    }

    private func fail(_ why: String) {
        log("couldn't hand the profile to Safari: \(why)")
        state = .failed(why)
        stop(log: false)
    }

    /// A new sheet: nothing handed yet.
    func reset() { if state != .starting && state != .handed { state = .idle } }

    func stop(log: Bool) {
        listener?.cancel()
        listener = nil
        if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        if log { self.log("server stopped") }
    }
}

/// A flag that can be taken once, from any thread.
final class TakeOnce: @unchecked Sendable {
    private var taken = false
    private let lock = NSLock()
    func take() -> Bool { lock.lock(); defer { lock.unlock() }; if taken { return false }; taken = true; return true }
}

/// The profile as a file to save in Files (the route that needs no server: Files opens a .mobileconfig as Safari
/// does, "Profile Downloaded", then Settings).
struct ProfileFile: FileDocument {
    static let type = UTType(filenameExtension: "mobileconfig") ?? .data
    static var readableContentTypes: [UTType] { [type] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// The ⋯ menu's Add to Home Screen: the icon, its name (editable), and the button; then what to do in Settings. If
/// Safari can't be handed the profile (or never fetches it), saving it to Files instead.
struct WebClipSheet: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var handoff = ProfileHandoff.shared
    @State private var face: SiteFace?
    @State private var name = ""
    @State private var failed = false
    @State private var saving: ProfileFile?
    @State private var saved = false

    private var label: String { name.isEmpty ? (face?.name ?? "") : name }
    private var profile: Data? { face.flatMap { WebClipMaker.profile($0, name: label) } }
    /// Safari didn't get it: the Files route is offered.
    private var offerFiles: Bool {
        switch handoff.state { case .failed, .timedOut, .wrongBrowser: return true; default: return failed }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Group {
                        if let icon = face?.icon {
                            Image(uiImage: icon).resizable().frame(width: 96, height: 96)
                                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
                        } else {
                            ProgressView().frame(width: 96, height: 96)
                        }
                    }
                    .padding(.top, 24)
                    TextField("Name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 240)
                        .disabled(face == nil)
                    note.font(.footnote).multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal, 24)
                    Button {
                        guard let f = face, let p = profile else { failed = true; return }
                        saved = false
                        Diagnostics.shared.log("icon", "made the Home Screen icon for \(f.site) (\(f.source), \(p.count / 1000) kB profile)")
                        ProfileHandoff.shared.hand(p, name: label)
                    } label: {
                        Text(handoff.state == .idle ? "Add to Home Screen" : "Try again").bold().frame(maxWidth: 240)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(face == nil || handoff.state == .starting)
                    if offerFiles {
                        Button {
                            guard let p = profile else { return }
                            saving = ProfileFile(data: p)
                        } label: {
                            Text("Save to Files instead").frame(maxWidth: 240)
                        }
                        .buttonStyle(.bordered)
                        .onAppear { Diagnostics.shared.log("icon", "fallback offered: save the profile to Files") }
                    }
                }
                .padding(.bottom, 24)
            }
            .navigationTitle("Add to Home Screen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .fileExporter(isPresented: Binding(get: { saving != nil }, set: { if !$0 { saving = nil } }), document: saving,
                      contentType: ProfileFile.type, defaultFilename: "\(label) for TRIF") { result in
            switch result {
            case .success(let url): saved = true; Diagnostics.shared.log("icon", "profile saved to Files (\(url.lastPathComponent))")
            case .failure(let e): Diagnostics.shared.log("icon", "profile not saved to Files: \(e.localizedDescription)")
            }
            saving = nil
        }
        .task {
            ProfileHandoff.shared.reset()
            if let f = await WebClipMaker.face(of: browser) { face = f; name = f.name } else { failed = true }
        }
    }

    @ViewBuilder private var note: some View {
        if saved {
            Text("Saved. Open the Files app and tap the file, then open Settings, tap Profile Downloaded near the top, and Install.")
        } else {
            switch handoff.state {
            case .handed, .fetched:
                Text("Safari asks to download a profile: tap Allow. Then open Settings, tap Profile Downloaded near the top, and Install.")
            case .wrongBrowser(let b):
                Text("\(b) opened instead of Safari, and only Safari can add the icon. Save it to Files instead, then tap it there.")
            case .failed, .timedOut:
                Text("Safari didn't get the icon. Save it to Files instead, then tap it there.")
            default:
                if failed { Text("Couldn't make the icon for this page.") }
                else { Text("The icon opens \(face?.site ?? "the site") in TRIF.") }
            }
        }
    }
}
