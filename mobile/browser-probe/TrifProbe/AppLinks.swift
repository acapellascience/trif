import Foundation
#if os(iOS)
import UIKit
#endif

/// Links that aren't web pages (tel:, mailto:, sms:, maps:, an app's own scheme such as fb-messenger:): handed to iOS,
/// as Safari does (Tim, 11-18). Like Safari, only at once when the person tapped; a page (or a mod) trying it by itself
/// gets Safari's question instead, at most one at a time and one a load; never from a frame inside the page unless
/// tapped. http/https always stay in TRIF (the default-browser rules). The decisions here have no UI, so the Mac test
/// (mobile/test/applinks.test.js) builds them too.
enum AppLinks {
    enum Kind: Equatable {
        /// http/https: TRIF's own business (tabs, full screen's rule…)
        case web
        /// about:, blob:, data: and the app's test pages (trifprobe:): they stay in the web view
        case stay
        /// javascript: (runs in its page, never anywhere else) and file: (never opened)
        case never
        /// trif: and the app's other schemes: never handed to iOS (that would be the page opening TRIF itself)
        case own
        /// anything else: another app's
        case other
    }

    enum Decision: Equatable {
        /// to iOS now (the person tapped)
        case open
        /// Safari's question first
        case ask
        /// nothing (and why, for the log)
        case drop(String)
    }

    /// The app's own schemes (Info.plist's CFBundleURLSchemes, the test pages', More's panel's).
    static let ownSchemes: Set<String> = {
        var s: Set<String> = ["trif", "trifprobe", "trifpanel"]
        let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        for t in types { for x in t["CFBundleURLSchemes"] as? [String] ?? [] { s.insert(x.lowercased()) } }
        return s
    }()

    static func kind(_ url: URL, own: Set<String> = ownSchemes) -> Kind {
        let s = url.scheme?.lowercased() ?? ""
        if s.isEmpty { return .never }
        if s == "http" || s == "https" { return .web }
        if ["about", "blob", "data", "trifprobe"].contains(s) { return .stay }
        if s == "javascript" || s == "file" { return .never }
        if own.contains(s) { return .own }
        return .other
    }

    /// What to do with another app's link.
    /// - tapped: the person tapped it (a link or form, with their finger on the page a moment ago, or a menu's item)
    /// - mainFrame: the page itself (or a new window), not a frame inside it
    /// - askedThisLoad: the question was already put for this page's load (answered either way)
    /// - asking: a question is up now
    /// - mayAsk: where it came from can ask at all (More's panel can't: its own page, only taps)
    static func decide(tapped: Bool, mainFrame: Bool, askedThisLoad: Bool, asking: Bool, mayAsk: Bool = true) -> Decision {
        if tapped { return .open }
        if !mayAsk { return .drop("not tapped") }
        if !mainFrame { return .drop("a frame inside the page, not tapped") }
        if asking { return .drop("a question is already up") }
        if askedThisLoad { return .drop("asked once on this page already") }
        return .ask
    }

    /// A link or form counts as tapped when the person's finger was on the page just now (WebKit calls a script's
    /// a.click() a link too), or a long-press menu's item was chosen.
    static func isTap(linkOrForm: Bool, sinceTouch: TimeInterval?, touching: Bool, menu: Bool) -> Bool {
        guard linkOrForm else { return false }
        return menu || touching || (sinceTouch.map { $0 >= 0 && $0 < tapWindow } ?? false)
    }
    /// (a tap's link comes ~0–0.4 s after the finger lifts: WebKit waits for a double tap on pages without a phone viewport)
    static let tapWindow: TimeInterval = 1.5

    /// The app iOS will hand it to, where that's certain (Apple's own apps; there's no public way to ask iOS which
    /// app takes a scheme, and Mail may not be the person's mail app).
    static func appName(_ url: URL) -> String? {
        switch url.scheme?.lowercased() ?? "" {
        case "tel", "telprompt": return "Phone"
        case "sms", "imessage": return "Messages"
        case "facetime", "facetime-audio", "facetime-group": return "FaceTime"
        case "maps": return "Maps"
        case "itms-apps", "itms-appss", "macappstore": return "App Store"
        case "music": return "Music"
        case "shortcuts": return "Shortcuts"
        case "x-apple-reminderkit": return "Reminders"
        case "calshow": return "Calendar"
        case "photos-redirect": return "Photos"
        case "x-safari-https": return "Safari"
        default: return nil
        }
    }

    // (words people see: drafts for Tim, docs/IOS-APP-STRINGS.md; the question is Safari's own)
    static func question(_ url: URL) -> String {
        if let n = appName(url) { return "Open this page in \u{201C}\(n)\u{201D}?" }
        return "Open this page in another app?"
    }
    static let cancelWord = "Cancel"
    static let openWord = "Open"
    static let noApp = "No app on this iPhone can open this link."

    /// What the log may say about it: the scheme only (a mailto:'s address or a tel:'s number is the person's business).
    static func logged(_ url: URL) -> String { "\(url.scheme?.lowercased() ?? "?"):" }
}

#if os(iOS)
/// When the person's finger was last on a page (a tab's, a chat's, More's panel): what tells a tapped link from a
/// page's script (`AppLinks.isTap`). Never recognizes, never delays or cancels a touch.
@MainActor
final class TouchClock {
    static var lastLift: Date?
    static var down = 0
    /// a long-press menu is up or was just closed (its Open is the person's choice)
    static var menuUntil = Date.distantPast
    static var menu: Bool { menuOpen || Date() < menuUntil }
    static var menuOpen = false

    static func tapped(linkOrForm: Bool) -> Bool {
        AppLinks.isTap(linkOrForm: linkOrForm, sinceTouch: lastLift.map { Date().timeIntervalSince($0) }, touching: down > 0, menu: menu)
    }
    static func watch(_ v: UIView) { v.addGestureRecognizer(TouchWatch()) }
}

final class TouchWatch: UIGestureRecognizer, UIGestureRecognizerDelegate {
    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { TouchClock.down += touches.count }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { lift(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { lift(touches) }
    private func lift(_ touches: Set<UITouch>) {
        TouchClock.down = max(0, TouchClock.down - touches.count)
        TouchClock.lastLift = Date()
        if TouchClock.down == 0 { state = .failed }
    }
    override func reset() { super.reset(); TouchClock.down = 0 }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
#endif
