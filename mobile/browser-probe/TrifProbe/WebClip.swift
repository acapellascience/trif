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

/// Hands a profile to Safari: a server on 127.0.0.1 that answers with it, then stops 2 s later (or after 90 s),
/// kept running while the app is in the background with iOS's background time; then Safari is opened at its address.
@MainActor
final class ProfileHandoff {
    static let shared = ProfileHandoff()
    private var listener: NWListener?
    private var task: UIBackgroundTaskIdentifier = .invalid

    private var generation = 0

    func hand(_ profile: Data, name: String, done: @escaping (Bool) -> Void) {
        stop()
        generation += 1
        let gen = generation
        // (bound to 127.0.0.1: nothing else on the network can reach it)
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        guard let l = try? NWListener(using: params) else { done(false); return }
        listener = l
        let file = name.replacingOccurrences(of: "[^A-Za-z0-9.-]+", with: "-", options: .regularExpression)
        let stopSoon: @Sendable (Double) -> Void = { secs in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(secs * 1e9))
                if ProfileHandoff.shared.generation == gen { ProfileHandoff.shared.stop() }
            }
        }
        l.newConnectionHandler = { c in
            c.start(queue: .main)
            c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                var head = "HTTP/1.1 200 OK\r\nContent-Type: application/x-apple-aspen-config\r\nContent-Length: \(profile.count)\r\n"
                head += "Content-Disposition: attachment; filename=\"\(file).mobileconfig\"\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
                c.send(content: Data(head.utf8) + profile, completion: .contentProcessed { _ in
                    c.cancel()
                    Task { @MainActor in Diagnostics.shared.log("icon", "Safari fetched the profile for \(name)") }
                    stopSoon(2)
                })
            }
        }
        l.stateUpdateHandler = { st in
            Task { @MainActor in
                let me = ProfileHandoff.shared
                guard me.generation == gen else { return }
                switch st {
                case .ready:
                    guard let port = me.listener?.port?.rawValue, let url = URL(string: "http://127.0.0.1:\(port)/\(file).mobileconfig") else { done(false); return }
                    me.task = UIApplication.shared.beginBackgroundTask(withName: "TRIF: handing a profile to Safari") { MainActor.assumeIsolated { ProfileHandoff.shared.stop() } }
                    UIApplication.shared.open(url) { ok in done(ok) }
                    stopSoon(90)
                case .failed: done(false); me.stop()
                default: break
                }
            }
        }
        l.start(queue: .main)
    }

    func stop() {
        listener?.cancel()
        listener = nil
        if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
    }
}

/// The ⋯ menu's Add to Home Screen: the icon, its name (editable), and the button; then what to do in Settings.
struct WebClipSheet: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    @State private var face: SiteFace?
    @State private var name = ""
    @State private var stage = 0 // 0 reading the site, 1 ready, 2 handed to Safari, 3 failed

    var body: some View {
        NavigationStack {
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
                if stage == 2 {
                    Text("Safari asks to download a profile: tap Allow. Then open Settings, tap Profile Downloaded near the top, and Install.")
                        .font(.footnote).multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal, 24)
                } else if stage == 3 {
                    Text("Couldn't hand the icon to Safari.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("The icon opens \(face?.site ?? "the site") in TRIF.").font(.footnote).foregroundStyle(.secondary)
                }
                Button {
                    guard let f = face, let p = WebClipMaker.profile(f, name: name.isEmpty ? f.name : name) else { stage = 3; return }
                    Diagnostics.shared.log("icon", "made the Home Screen icon for \(f.site) (\(f.source), \(p.count / 1000) kB profile)")
                    ProfileHandoff.shared.hand(p, name: name.isEmpty ? f.name : name) { ok in stage = ok ? 2 : 3 }
                } label: {
                    Text(stage == 2 ? "Make it again" : "Add to Home Screen").bold().frame(maxWidth: 240)
                }
                .buttonStyle(.borderedProminent)
                .disabled(face == nil)
                Spacer()
            }
            .navigationTitle("Add to Home Screen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .task {
            if let f = await WebClipMaker.face(of: browser) { face = f; name = f.name; stage = 1 } else { stage = 3 }
        }
    }
}
