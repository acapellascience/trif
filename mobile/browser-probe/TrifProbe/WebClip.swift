// A site's own icon on the Home Screen that opens it in TRIF (Tim, 11-16): an iOS configuration profile with one
// Web Clip whose address is trif://open?url=<the site>, full screen, so a tap shows a blank web-app screen for a moment
// and then opens TRIF, with no Safari and no question (see `profile`). The profile is made here (its icon the site's
// own: its apple-touch-icon, else its web app manifest's, else its favicon on a tile, else its letter), and handed to
// Safari from a tiny server on 127.0.0.1 that lives only until Safari has fetched it: Safari is what offers to
// download a profile ("Profile Downloaded"), then Settings installs it. One profile per site, with a fixed
// identifier, so adding a site again replaces its icon.

import CryptoKit
import Network
import PhotosUI
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
        // (app=1: the icon opens its site in full screen, no browser around it: Tim, 11-16)
        c.queryItems = [URLQueryItem(name: "url", value: site.absoluteString), URLQueryItem(name: "app", value: "1")]
        return c.url!
    }
}

extension TrifLink {
    /// The link asks for full screen (app=1: the name the icons made since 11-16 have).
    static func wantsFullScreen(_ url: URL) -> Bool {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains { $0.name == "app" && $0.value == "1" } ?? false
    }
}

extension Browser {
    /// Opened from a site's Home Screen icon made for full screen (Tim, 11-16): the site with no browser around it, as
    /// a native app; each icon's site keeps its own tab for it, so the icon comes back to it. The icon always lands in
    /// full screen, whatever its tab was left in (Tim, 11-16: "it should go straight to full screen view so it feels
    /// like an app"); inside, the hold still switches it either way, and TRIF's own icon opens TRIF as it was left.
    func openFullScreen(_ target: URL) {
        let site = Site.of(target.host ?? "")
        var map = UserDefaults.standard.dictionary(forKey: "iconTabs") as? [String: String] ?? [:]
        if let id = map[site].flatMap(UUID.init(uuidString:)), let t = tabs.first(where: { $0.id == id }) {
            let was = fullScreenTabs.contains(t.id)
            if t !== current { select(t) }
            report.log("icon", "opened \(site) from its icon: its own tab, \(was ? "already in full screen" : "back to full screen")")
        } else {
            newTab(target.absoluteString)
            map[site] = current.id.uuidString
            UserDefaults.standard.set(map, forKey: "iconTabs")
            report.log("icon", "opened \(site) from its icon: a new tab of its own, in full screen")
        }
        setFullScreen(true, note: false)
    }

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

extension Model {
    /// (development) {"iconcheck": "https://…/"}: that site's Home Screen icon link opened from each state the app can
    /// be in while in front (no tab of its own yet; its tab in or out of full screen; another tab in front; the tabs,
    /// the chat, More's settings, the address screen, the Mods tab, history over the page), as the icon opens it;
    /// each must end on the icon's own tab, in full screen, nothing over it. One
    /// line a state, PASS or FAIL. Through onOpenURL's own handler (ContentView.openForCheck): the app opening its own
    /// scheme asks "Open in …?" first. A cold launch and the app in the background need `simctl openurl` (notes).
    static func iconCheck(browser: Browser, site: URL) async -> String {
        let link = TrifLink.link(to: site), host = Site.of(site.host ?? "")
        func wait(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
        func own() -> Tab? {
            (UserDefaults.standard.dictionary(forKey: "iconTabs") as? [String: String])?[host]
                .flatMap(UUID.init(uuidString:)).flatMap { id in browser.tabs.first { $0.id == id } }
        }
        var lines: [String] = [], made: [Tab] = []
        func other() { browser.newTab(PageSchemeHandler.home + "plain.html"); made.append(browser.current) }
        func tap(_ name: String) async {
            let before = "\(browser.current === own() ? "its tab" : "another tab"), full screen \(browser.fullScreen), covers \(ContentView.coversNow)"
            ContentView.openForCheck?(link)
            await wait(1.5)
            let ok = own() != nil && browser.current === own() && browser.fullScreen && ContentView.coversNow == "none"
            lines.append("\(ok ? "PASS" : "FAIL") \(name) (was: \(before)) → on \(browser.current?.host.nonEmpty ?? "-"), full screen \(browser.fullScreen), covers \(ContentView.coversNow)")
        }
        // (no tab of its own: the map's entry dropped, so the icon makes one)
        var map = UserDefaults.standard.dictionary(forKey: "iconTabs") as? [String: String] ?? [:]
        map[host] = nil
        UserDefaults.standard.set(map, forKey: "iconTabs")
        await tap("no tab of its own yet")
        await tap("its tab in front, in full screen")
        browser.setFullScreen(false, note: false)
        await tap("its tab in front, left in TRIF view")
        other()
        await tap("another tab in front, its tab in full screen")
        let wasMore = Model.pane?.more ?? false
        for cover in ["", "tabs", "chat", "more", "address", "mods", "history"] {
            if let t = own() { browser.setFullScreen(false, tab: t, note: false) }
            other()
            if cover == "more" { Model.pane?.choose(more: true); browser.wantsSheet = "chat" }
            else if !cover.isEmpty { browser.wantsSheet = cover }
            await wait(1.2)
            await tap("another tab in front\(cover.isEmpty ? "" : ", \(cover) over it"), its tab in TRIF view")
            if cover == "more" { Model.pane?.choose(more: wasMore) }
        }
        for t in made where browser.tabs.contains(where: { $0 === t }) { browser.close(t) }
        return lines.joined(separator: "\n")
    }
}

extension Model {
    /// (development) The step {"iconprofile": {…}}: the face read from the shown page, the icon composed, the profile.
    static func iconProfile(browser: Browser, options o: [String: Any], docs: URL) async -> String {
        guard let face = await WebClipMaker.face(of: browser), var pic = face.icon else { return "no face" }
        // ("noise": a picture of random pixels, the worst case for the PNG's size, as a photo chosen from Photos)
        if o["noise"] as? Bool == true {
            let f = UIGraphicsImageRendererFormat()
            f.scale = 2
            pic = WebClipMaker.square(UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200), format: f).image { _ in
                for x in stride(from: 0, to: 300, by: 0.5) { for y in stride(from: 0, to: 200, by: 0.5) {
                    UIColor(hue: .random(in: 0...1), saturation: 0.8, brightness: .random(in: 0.3...1), alpha: 1).setFill()
                    UIRectFill(CGRect(x: x, y: y, width: 0.5, height: 0.5))
                } }
            })
        }
        let sw = o["swatch"] as? Int ?? 0
        let look = IconLook(outline: o["outline"] as? Bool ?? true, colour: outlineSwatches[max(0, min(sw, outlineSwatches.count - 1))].colour, badge: o["badge"] as? Bool ?? false)
        let name = o["name"] as? String ?? "\(face.name) on TRIF"
        let png = WebClipMaker.iconPNG(pic, look: look)
        let profile = WebClipMaker.profile(face, name: name, picture: pic, look: look)
        try? png?.write(to: docs.appendingPathComponent("icon-test.png"))
        try? profile?.write(to: docs.appendingPathComponent("icon-test.mobileconfig"))
        return "site \(face.site), name \(face.name), user \(face.user ?? "-"), source \(face.source), png \(png?.count ?? 0) bytes, profile \(profile?.count ?? 0) bytes"
    }
}

/// What the page says about itself for an icon: its touch icons, manifest, favicons and names.
struct SiteFace {
    var site: String
    var start: URL
    var name: String
    /// The site's own picture, a 180-point square (what shows on the icon's screen, or the whole icon without the outline).
    var icon: UIImage?
    var source: String
    /// The person's name on the site, when the page shows it plainly (for the name "{user}'s {site}"; nil: not known).
    var user: String? = nil
}

/// How a Home Screen icon looks (Tim, 11-16): a small TRIF app, TRIF's outline (the app icon's rim and face, option
/// A) around a black screen with the picture on it; or, without the outline, just the picture. A green checkmark
/// badge can say the site has been fixed.
struct IconLook: Equatable {
    var outline = true
    /// The outline's colour: nil, TRIF's own green gradient; else a gradient made from this colour.
    var colour: UIColor? = nil
    var badge = false
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
      appName: meta('apple-mobile-web-app-title') || meta('application-name'), siteName: meta('og:site_name'), title: document.title || '', agent: navigator.userAgent,
      user: (() => {
        // (the person's name where a page shows it plainly in its markup: GitHub's user-login meta, MediaWiki's
        // personal link (Wikipedia). Anything else: not known, and the name "{user}'s {site}" isn't offered)
        const clean = (t) => { t = String(t || '').replace(/\\s+/g, ' ').trim(); return t.length > 0 && t.length <= 30 ? t : ''; };
        const gh = clean(meta('user-login'));
        if (gh) return gh;
        const wiki = document.querySelector('#pt-userpage a, #pt-userpage-2 a');
        if (wiki) return clean(wiki.textContent);
        return '';
      })() });
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
        let user = (d["user"] as? String).flatMap { $0.isEmpty ? nil : $0 }
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
            return SiteFace(site: site, start: start, name: name, icon: render(img, fill: fill), source: kind, user: user)
        }
        return SiteFace(site: site, start: start, name: name, icon: letterTile(name), source: "letter", user: user)
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

    /// A picture the person chose (Photos), cropped to a square from its middle, as a 180-point square.
    static func square(_ img: UIImage) -> UIImage {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 2
        f.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: f).image { _ in
            let k = max(side / max(img.size.width, 1), side / max(img.size.height, 1))
            let s = CGSize(width: img.size.width * k, height: img.size.height * k)
            img.draw(in: CGRect(x: (side - s.width) / 2, y: (side - s.height) / 2, width: s.width, height: s.height))
        }
    }

    /// The outline's two colours, top left to bottom right: TRIF's rim (the app icon's #44e0a8 → #1e9a6c), or the
    /// chosen colour a little lighter to a little darker.
    static func rimColours(_ c: UIColor?) -> (UIColor, UIColor) {
        guard let c else { return (UIColor(red: 0x44 / 255, green: 0xe0 / 255, blue: 0xa8 / 255, alpha: 1), UIColor(red: 0x1e / 255, green: 0x9a / 255, blue: 0x6c / 255, alpha: 1)) }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
        func mix(_ t: CGFloat, _ to: CGFloat) -> UIColor { UIColor(red: r + (to - r) * t, green: g + (to - g) * t, blue: b + (to - b) * t, alpha: 1) }
        return (mix(0.18, 1), mix(0.28, 0))
    }

    /// The icon as it goes on the Home Screen (iOS's mask rounds its corners): with the outline, TRIF's rim (the app
    /// icon's geometry: 100.39 of 1024 wide, the face a continuous-corner square, radius 0.26 × its side) around a
    /// black screen, the picture on the screen with a black margin round it; without, the picture filling it. The
    /// badge: a green checkmark at the top right, inside iOS's corner.
    static func compose(_ picture: UIImage, look: IconLook, scale: CGFloat = 2) -> UIImage {
        let f = UIGraphicsImageRendererFormat()
        f.scale = scale
        f.opaque = true
        let full = CGRect(x: 0, y: 0, width: side, height: side)
        return UIGraphicsImageRenderer(size: full.size, format: f).image { ctx in
            let cg = ctx.cgContext
            if look.outline {
                let (a, b) = rimColours(look.colour)
                if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [a.cgColor, b.cgColor] as CFArray, locations: [0, 1]) {
                    cg.drawLinearGradient(g, start: .zero, end: CGPoint(x: side, y: side), options: [])
                }
                let rim = side * 100.39 / 1024, faceSide = side - 2 * rim
                UIColor.black.setFill()
                UIBezierPath(roundedRect: CGRect(x: rim, y: rim, width: faceSide, height: faceSide), cornerRadius: 0.26 * faceSide).fill()
                let inner = (faceSide * screenFill).rounded()
                let box = CGRect(x: (side - inner) / 2, y: (side - inner) / 2, width: inner, height: inner)
                cg.saveGState()
                UIBezierPath(roundedRect: box, cornerRadius: 0.26 * inner).addClip()
                picture.draw(in: box)
                cg.restoreGState()
            } else {
                picture.draw(in: full)
            }
            if look.badge {
                let r = side * 0.135, c = CGPoint(x: side * 0.755, y: side * 0.245)
                UIColor.white.setFill()
                UIBezierPath(arcCenter: c, radius: r + side * 0.022, startAngle: 0, endAngle: .pi * 2, clockwise: true).fill()
                UIColor(red: 0x16 / 255, green: 0xa3 / 255, blue: 0x4a / 255, alpha: 1).setFill()
                UIBezierPath(arcCenter: c, radius: r, startAngle: 0, endAngle: .pi * 2, clockwise: true).fill()
                let tick = UIBezierPath()
                tick.move(to: CGPoint(x: c.x - r * 0.46, y: c.y + r * 0.02))
                tick.addLine(to: CGPoint(x: c.x - r * 0.12, y: c.y + r * 0.36))
                tick.addLine(to: CGPoint(x: c.x + r * 0.5, y: c.y - r * 0.34))
                tick.lineWidth = r * 0.26
                tick.lineCapStyle = .round
                tick.lineJoinStyle = .round
                UIColor.white.setStroke()
                tick.stroke()
            }
        }
    }
    /// How much of the face (the black screen) the picture takes, the rest a black margin round it.
    static let screenFill: CGFloat = 0.74

    /// The icon's PNG, small enough for the timsrobot.com page (it takes a profile of up to 400,000 bytes, and the
    /// PNG goes in it as base64): 360 px, else 270, else 180.
    static func iconPNG(_ picture: UIImage, look: IconLook) -> Data? {
        var last: Data?
        for scale: CGFloat in [2, 1.5, 1] {
            last = compose(picture, look: look, scale: scale).pngData()
            if let d = last, d.count <= 270_000 { return d }
        }
        return last
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

    /// The profile: one Web Clip, removable, full screen, identified by its site. `name` is the icon's label on the
    /// Home Screen (the person's choice); the profile itself is named after the site ({Site} for TRIF), so Settings
    /// and Files read plainly whatever the label is.
    static func profile(_ face: SiteFace, name: String, picture: UIImage? = nil, look: IconLook = IconLook()) -> Data? {
        let id = "com.timsrobot.trif.webclip.\(face.site)"
        guard let pic = picture ?? face.icon, let png = iconPNG(pic, look: look) else { return nil }
        let label = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard !label.isEmpty else { return nil }
        let siteName = face.name
        let clip: [String: Any] = [
            "PayloadType": "com.apple.webClip.managed", "PayloadVersion": 1,
            "PayloadIdentifier": "\(id).clip", "PayloadUUID": stableUUID("\(id).clip"),
            "PayloadDisplayName": "\(siteName) for TRIF",
            "Label": label, "URL": TrifLink.link(to: face.start).absoluteString, "Icon": png,
            // (full screen, though a site's own icon wouldn't be: a clip that isn't opens Safari, which then asks "Open in
            // TRIF?" every time; a full-screen one opens a blank web-app screen for a moment and then TRIF, no question.
            // Simulator, iOS 26.3, 11-16. TargetApplicationBundleIdentifier, which should open TRIF itself, is ignored
            // in a profile installed by hand: MDM only)
            "IsRemovable": true, "FullScreen": true, "Precomposed": true,
        ]
        let p: [String: Any] = [
            "PayloadType": "Configuration", "PayloadVersion": 1,
            "PayloadIdentifier": id, "PayloadUUID": stableUUID(id),
            "PayloadDisplayName": "\(siteName) for TRIF",
            "PayloadDescription": label == siteName ? "Adds \(article(siteName)) \(siteName) icon to your Home Screen that opens \(siteName) in TRIF."
                : "Adds an icon, “\(label)”, to your Home Screen that opens \(siteName) in TRIF.",
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
    enum State: Equatable { case idle, starting, handed, fetched, failed(String), timedOut, wrongBrowser(String), page, pageBack }
    @Published private(set) var state: State = .idle
    /// The site this hand-off is for (the sheet shows where it got to when it's opened again for the same site).
    @Published private(set) var site = ""
    /// The profile was saved to Files (that route's first step done).
    @Published var savedToFiles = false
    /// The icon was used: TRIF was opened from it, for this site (so it's on the Home Screen).
    @Published private(set) var installed = false
    /// Whether the timsrobot.com page is there (asked when the sheet opens: which route's steps to show).
    @Published private(set) var pageLive: Bool?
    func checkPage() async { pageLive = await ProfileHandoff.pageIsThere(ProfileHandoff.clipBase) }
    /// The sheet opened for a site: its progress kept if it's the same site, else a fresh start.
    func begin(site s: String) {
        guard s != site else { return }
        stop(log: false)
        site = s
        state = .idle
        savedToFiles = false
        installed = false
        openedAt = nil
    }
    /// TRIF was opened from a Home Screen icon for this site: the icon is there.
    func opened(fromIconOf s: String) {
        guard s == site, state != .idle || savedToFiles else { return }
        installed = true
        log("opened from the new icon for \(s): done")
    }
    private var listener: NWListener?
    private var task: UIBackgroundTaskIdentifier = .invalid
    private var generation = 0
    private var openedAt: Date?

    private func log(_ text: String) { Diagnostics.shared.log("icon", text) }

    /// The page on timsrobot.com that hands a profile to Safari from the address's # part (site/src/clip.js on the
    /// main repo's clip-page branch): `-clipbase <https origin>` at launch for a local copy.
    static var clipBase: String {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-clipbase"), i + 1 < a.count { return a[i + 1] }
        return "https://timsrobot.com"
    }

    /// The main route (Tim, 11-16): Safari opened by name (x-safari-https, whatever the default browser is) at the
    /// page, the profile in the # part, which no server sees; no server on the phone. Used once the page is there (one
    /// request for its script, nothing sent with it); else, and if Safari can't be opened that way, the server here.
    /// `page`: the page can take this profile (it takes only icons for https sites, of up to 400,000 bytes): else the
    /// server here at once.
    func hand(_ profile: Data, name: String, page: Bool = true) {
        stop(log: false)
        generation += 1
        let gen = generation
        state = .starting
        Task { @MainActor in
            let base = ProfileHandoff.clipBase
            if !page || profile.count > 400_000 { log("the page at \(base)/clip takes only https sites' icons of up to 400,000 bytes: the server on this phone instead"); serve(profile, name: name, gen: gen); return }
            let live = await ProfileHandoff.pageIsThere(base)
            guard generation == gen else { return }
            guard live else { log("the page at \(base)/clip isn't there: the server on this phone instead"); serve(profile, name: name, gen: gen); return }
            let b64 = profile.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            let host = base.replacingOccurrences(of: "https://", with: "")
            guard let url = URL(string: "x-safari-https://\(host)/clip#\(b64)") else { serve(profile, name: name, gen: gen); return }
            openedAt = Date()
            away = false
            UIApplication.shared.open(url) { opened in
                MainActor.assumeIsolated {
                    guard self.generation == gen else { return }
                    if opened {
                        self.log("opened in Safari at \(host)/clip (x-safari-https, \(b64.count) characters after the #)")
                        self.state = .page
                    } else {
                        self.log("x-safari-https didn't open: the server on this phone instead")
                        self.serve(profile, name: name, gen: gen)
                    }
                }
            }
        }
    }

    /// Whether the page is there: its script answers (a HEAD request, nothing sent).
    nonisolated static func pageIsThere(_ base: String) async -> Bool {
        guard let u = URL(string: "\(base)/clip.js") else { return false }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4)
        req.httpMethod = "HEAD"
        req.httpShouldHandleCookies = false
        guard let (_, r) = try? await URLSession.shared.data(for: req) else { return false }
        return (r as? HTTPURLResponse)?.statusCode == 200
    }

    /// The fallback: a server on this phone's loopback, Safari opened at it.
    private func serve(_ profile: Data, name: String, gen: Int) {
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
        case .page:
            // (the page gives no word back: the person is asked, and Files offered beside it)
            log("back in TRIF \(Int(Date().timeIntervalSince(at))) s after Safari was opened at the page")
            state = .pageBack
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
            MainActor.assumeIsolated { let me = ProfileHandoff.shared; if me.openedAt != nil { switch me.state { case .handed, .starting, .wrongBrowser, .page: me.away = true; default: break } } }
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

/// The icon's name (Tim, 11-16: iOS can't rename an icon later, so it's chosen here): "{site} on TRIF", "{user}'s
/// {site}" (only when the person's name on the site is known), "fixed {site}", or their own.
enum IconName: Hashable { case onTrif, users, fixed, custom }

/// The outline's colours to choose from: TRIF's green first (nil: the app icon's own gradient), then a few, then any
/// (the colour picker).
let outlineSwatches: [(name: String, colour: UIColor?)] = [
    ("TRIF green", nil),
    ("Blue", UIColor(red: 0x3b / 255, green: 0x82 / 255, blue: 0xf6 / 255, alpha: 1)),
    ("Purple", UIColor(red: 0x8b / 255, green: 0x5c / 255, blue: 0xf6 / 255, alpha: 1)),
    ("Pink", UIColor(red: 0xec / 255, green: 0x48 / 255, blue: 0x99 / 255, alpha: 1)),
    ("Orange", UIColor(red: 0xf9 / 255, green: 0x73 / 255, blue: 0x16 / 255, alpha: 1)),
    ("Graphite", UIColor(red: 0x6b / 255, green: 0x72 / 255, blue: 0x80 / 255, alpha: 1)),
]

/// The toolbar's [+] (Tim, 11-16; was the ⋯ menu's Add to Home Screen): first the icon itself (its name, the
/// outline and its colour, the picture, the fixed badge), then, before anything happens, what will happen and every step after it, for
/// the route that will be used (Safari, or Files); the sheet stays on that list the whole time, so the person can go
/// to Safari, Files or Settings and come back to read where they are, the step they're on marked as far as TRIF can
/// tell. Never closed while they're away; reopened for the same site, it shows where they were.
struct WebClipSheet: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var handoff = ProfileHandoff.shared
    @State private var face: SiteFace?
    @State private var nameChoice: IconName = .onTrif
    @State private var customName = ""
    @State private var outline = true
    /// The outline's colour: an index into outlineSwatches, or -1 for the colour picker's.
    @State private var swatch = 0
    @State private var otherColour = Color(UIColor(red: 0x0e / 255, green: 0xa5 / 255, blue: 0xe9 / 255, alpha: 1))
    @State private var badge = false
    /// A picture from Photos instead of the site's own (a square from its middle).
    @State private var picked: UIImage?
    @State private var photo: PhotosPickerItem?
    @State private var failed = false
    @State private var saving: ProfileFile?
    @State private var filesRoute = false

    private var siteName: String { face?.name ?? "" }
    private func name(_ c: IconName) -> String {
        switch c {
        case .onTrif: return "\(siteName) on TRIF"
        case .users: return "\(face?.user ?? "")'s \(siteName)"
        case .fixed: return "fixed \(siteName)"
        case .custom: return customName
        }
    }
    /// The icon's label on the Home Screen (an empty custom name: the site's own).
    private var label: String {
        let l = String(name(nameChoice).trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        return l.isEmpty ? siteName : l
    }
    private var look: IconLook {
        IconLook(outline: outline, colour: swatch < 0 ? UIColor(otherColour) : outlineSwatches[swatch].colour, badge: badge)
    }
    private var preview: UIImage? { (picked ?? face?.icon).map { WebClipMaker.compose($0, look: look) } }
    private var profile: Data? { face.flatMap { WebClipMaker.profile($0, name: label, picture: picked, look: look) } }
    private var started: Bool { handoff.state != .idle || handoff.savedToFiles }
    /// Safari didn't get it: the Files route is offered.
    private var safariFailed: Bool {
        switch handoff.state { case .failed, .timedOut, .wrongBrowser: return true; default: return false }
    }

    // MARK: the steps
    private static let settingsSteps = [
        "Open the Settings app and tap Profile Downloaded near the top (or General → VPN & Device Management).",
        "Tap Install, enter your passcode, then Install again.",
        "The icon appears on your Home Screen.",
    ]
    private var steps: [String] {
        filesRoute
            ? ["Choose where to save the file (On My iPhone is fine), then tap Save.",
               "Open the Files app and tap “\(siteName) for TRIF”."] + WebClipSheet.settingsSteps
            : ["Safari opens and asks to download a profile: tap Allow."] + WebClipSheet.settingsSteps
    }
    /// The step the person is on (0-based; steps.count when it's all done), as far as TRIF can tell.
    private var current: Int {
        if handoff.installed { return steps.count }
        if filesRoute { return handoff.savedToFiles ? 1 : 0 }
        switch handoff.state {
        case .fetched, .pageBack: return 1
        default: return 0
        }
    }
    /// Where things are, in a line over the steps (nothing before the button).
    private var status: String? {
        if handoff.installed { return "Done: the icon is on your Home Screen." }
        if filesRoute {
            if handoff.savedToFiles { return "Saved to Files: next, open the Files app and tap it." }
            if case .wrongBrowser(let b) = handoff.state { return "\(b) opened instead of Safari, and only Safari can add the icon. Save it to Files instead." }
            return safariFailed ? "Safari didn't get the icon. Save it to Files instead." : nil
        }
        switch handoff.state {
        case .starting: return "Opening Safari…"
        case .page, .handed: return "Safari is open: tap Allow there, then come back here."
        case .fetched: return "Safari downloaded it: next, Settings."
        case .pageBack: return "If Safari asked and you tapped Allow: next, Settings."
        case .wrongBrowser(let b): return "\(b) opened instead of Safari, and only Safari can add the icon. Save it to Files instead."
        case .failed, .timedOut: return "Safari didn't get the icon. Save it to Files instead."
        default: return nil
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // (the icon as the Home Screen will show it: iOS's corner, 0.26 × the side, and its label under it)
                    VStack(spacing: 6) {
                        if let icon = preview {
                            Image(uiImage: icon).resizable().frame(width: 84, height: 84)
                                .clipShape(RoundedRectangle(cornerRadius: 84 * 0.26, style: .continuous))
                                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
                                .accessibilityLabel("The icon")
                        } else {
                            ProgressView().frame(width: 84, height: 84)
                        }
                        Text(face == nil ? " " : label).font(.caption).lineLimit(1).truncationMode(.tail).frame(maxWidth: 96)
                    }
                    .padding(.top, 12)
                    if face != nil { options.disabled(started) }
                    if failed {
                        Text("Couldn't make the icon for this page.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let status {
                        Text(status).font(.subheadline.weight(.semibold)).multilineTextAlignment(.center)
                            .foregroundStyle(handoff.installed ? Color.trifGreen : .primary).padding(.horizontal, 20)
                    }
                    stepList
                    buttons
                    Text("iOS only lets an icon that opens an app be added this way, with a small profile. It adds just this one icon, and you can remove it in Settings → General → VPN & Device Management.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading).padding(.horizontal, 20)
                    if started && !handoff.installed {
                        Text(filesRoute ? "A profile waits about 8 minutes in Settings. If it's gone, tap the file in Files again." : "A downloaded profile waits about 8 minutes. If it's gone from Settings, tap Download it again here.")
                            .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading).padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 24)
            }
            .navigationTitle("Add to Home Screen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: started ? .confirmationAction : .cancellationAction) {
                    Button(started ? "Done" : "Cancel") { dismiss() }
                }
            }
        }
        .fileExporter(isPresented: Binding(get: { saving != nil }, set: { if !$0 { saving = nil } }), document: saving,
                      contentType: ProfileFile.type, defaultFilename: "\(siteName) for TRIF") { result in
            switch result {
            case .success(let url): handoff.savedToFiles = true; Diagnostics.shared.log("icon", "profile saved to Files (\(url.lastPathComponent))")
            case .failure(let e): Diagnostics.shared.log("icon", "profile not saved to Files: \(e.localizedDescription)")
            }
            saving = nil
        }
        // (Safari didn't get it: the Files route's steps, its button first)
        .onChange(of: safariFailed) { _, now in if now { filesRoute = true } }
        // (Custom…: starts from the name that was chosen, to edit)
        .onChange(of: nameChoice) { old, now in if now == .custom && customName.isEmpty { customName = name(old) } }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { picked = WebClipMaker.square(img) }
                else { Diagnostics.shared.log("icon", "the chosen picture couldn't be read") }
                photo = nil
            }
        }
        .task {
            let site = Site.of(browser.webView.url?.host ?? "")
            handoff.begin(site: site)
            if handoff.savedToFiles || safariFailed { filesRoute = true }
            async let page: Void = handoff.checkPage()
            if let f = await WebClipMaker.face(of: browser) { face = f } else { failed = true }
            await page
        }
    }

    /// The icon's choices, in a card: the name, the outline and its colour, the picture, the badge.
    private var options: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Name")
                Spacer(minLength: 8)
                // (a menu whose label is the chosen name on one line, cut short if it must: a menu Picker wraps it)
                Menu {
                    Picker("Name", selection: $nameChoice) {
                        Text(name(.onTrif)).tag(IconName.onTrif)
                        if face?.user != nil { Text(name(.users)).tag(IconName.users) }
                        Text(name(.fixed)).tag(IconName.fixed)
                        Text("Custom…").tag(IconName.custom)
                    }
                    .pickerStyle(.inline)
                } label: {
                    HStack(spacing: 4) {
                        Text(nameChoice == .custom ? "Custom…" : label).lineLimit(1).truncationMode(.middle)
                        Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.semibold))
                    }
                }
                .accessibilityLabel("Name, \(label)")
            }
            if nameChoice == .custom {
                TextField(siteName, text: $customName)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: customName) { _, t in if t.count > 60 { customName = String(t.prefix(60)) } }
            }
            Text("iOS can't rename the icon once it's on your Home Screen.").font(.footnote).foregroundStyle(.secondary)
            Divider()
            Toggle("TRIF outline", isOn: $outline.animation(.easeOut(duration: 0.15)))
            if outline {
                HStack(spacing: 10) {
                    ForEach(outlineSwatches.indices, id: \.self) { i in
                        Button { swatch = i } label: {
                            let (a, b) = WebClipMaker.rimColours(outlineSwatches[i].colour)
                            Circle().fill(LinearGradient(colors: [Color(a), Color(b)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(width: 28, height: 28)
                                .overlay(Circle().stroke(Color.primary, lineWidth: swatch == i ? 2.5 : 0).padding(-4))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(outlineSwatches[i].name)
                        .accessibilityAddTraits(swatch == i ? .isSelected : [])
                    }
                    ColorPicker("Other colour", selection: $otherColour, supportsOpacity: false)
                        .labelsHidden()
                        .overlay(Circle().stroke(Color.primary, lineWidth: swatch < 0 ? 2.5 : 0).padding(-4).allowsHitTesting(false))
                        .onChange(of: otherColour) { _, _ in swatch = -1 }
                }
                .padding(.vertical, 2)
            }
            Divider()
            HStack {
                Text("Picture")
                Spacer(minLength: 8)
                if picked != nil {
                    Button("Use the site's icon") { picked = nil }
                }
                PhotosPicker(selection: $photo, matching: .images) { Text(picked == nil ? "Choose…" : "Change…") }
            }
            Divider()
            Toggle(isOn: $badge) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Fixed badge")
                    Text("A green checkmark: this site has been fixed.").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemBackground)))
        .padding(.horizontal, 16)
    }

    private var stepList: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(steps.enumerated()), id: \.offset) { n, text in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    ZStack {
                        Circle().fill(n < current ? Color.trifGreen : n == current && started ? Color.trifGreen.opacity(0.18) : Color(.tertiarySystemFill))
                        if n < current { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
                        else { Text("\(n + 1)").font(.system(size: 12, weight: .bold)).foregroundStyle(n == current && started ? Color.trifGreen : .secondary) }
                    }
                    .frame(width: 22, height: 22)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                    Text(text).font(.subheadline.weight(n == current && started ? .semibold : .regular))
                        .foregroundStyle(n < current ? .secondary : .primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemBackground)))
        .padding(.horizontal, 16)
    }

    @ViewBuilder private var buttons: some View {
        if !handoff.installed {
            Button {
                guard let f = face, let p = profile else { failed = true; return }
                if filesRoute { saving = ProfileFile(data: p); return }
                Diagnostics.shared.log("icon", "made the Home Screen icon for \(f.site) (\(picked == nil ? f.source : "a picture from Photos"), \(outline ? "outline \(swatch < 0 ? "own colour" : outlineSwatches[swatch].name)" : "no outline")\(badge ? ", fixed badge" : ""), name \(nameChoice), \(p.count / 1000) kB profile)")
                ProfileHandoff.shared.hand(p, name: "\(f.name) for TRIF", page: f.start.scheme == "https")
            } label: {
                Text(filesRoute ? (handoff.savedToFiles ? "Save it again" : "Save to Files") : (handoff.state == .idle ? "Add to Home Screen" : "Download it again"))
                    .bold().frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .disabled(face == nil || handoff.state == .starting)
            if !filesRoute && (safariFailed || started) {
                Button {
                    filesRoute = true
                    Diagnostics.shared.log("icon", "fallback offered: save the profile to Files")
                } label: { Text("Save to Files instead").frame(maxWidth: 240) }
                .buttonStyle(.bordered)
            } else if filesRoute && !handoff.savedToFiles && !safariFailed {
                Button { filesRoute = false } label: { Text("Use Safari instead").frame(maxWidth: 240) }
                    .buttonStyle(.bordered)
            }
        }
    }
}
