// A plain cover as the app leaves while it's used through Home Screen icons (Tim, 11-18). Tapping a site's icon
// (a Web Clip opening trif://open?url=…) while TRIF is in the background plays iOS's hand-off: the Web Clip's black
// screen, then iOS's own picture of TRIF as it was left sliding in and cross-fading into the live app. That picture
// showed the tab left in front (X), not the icon's site (FeedBook), for about half a second. Nothing the app does at
// open time changes that picture, so it's changed on the way out: black with TRIF's robot in the middle, "like
// you're going from TRIF to your app", the same as the launch screen (Info.plist UILaunchScreen: LaunchBlack +
// CoverRobot), so a cold launch and a return look alike.
//
// When: only in icon use (`reason`), as a window over everything, in sceneDidEnterBackground (iOS takes its picture
// after that returns; not on resign-active, so Control Center, a notification pulled down or the app switcher still
// show the page). Otherwise the real picture stays, so the app switcher's card shows the page.
// Off on the way back: once a link UIKit handed over has been taken (ContentView.openLink: the icon's tab chosen with
// no animation) and the shown tab's page has drawn (at most 0.8 s), then a short fade. Tab pictures (TabShots) are
// WebKit's takeSnapshot of the page alone, so they never hold the cover.

import UIKit

@MainActor
final class LeavingCover {
    static let shared = LeavingCover()
    weak var browser: Browser?
    private var window: UIWindow?
    /// The app's latest arrival in front came through a Home Screen icon's link (cold or warm).
    private(set) var arrivedByIcon = false
    private var iconLinkAt = Date.distantPast
    private var shownAt: Date?
    /// The last steps, newest last, for the dev step {"cover": 1}: "+ms since the app came to the front: what".
    private var events: [String] = []
    private var frontAt = Date()
    /// (development) `-nocover`: never covered, as before 11-18, to compare.
    static let off = ProcessInfo.processInfo.arguments.contains("-nocover")

    private func note(_ s: String) {
        events.append("+\(Int(Date().timeIntervalSince(frontAt) * 1000)) ms \(s)")
        if events.count > 30 { events.removeFirst(events.count - 30) }
    }

    /// A Home Screen icon's link came (PendingLink.came: as UIKit hands it over; ContentView.openLink).
    func iconLinkCame(_ how: String) {
        iconLinkAt = Date()
        arrivedByIcon = true
        note("icon link: \(how)")
    }

    /// Why the app counts as used through icons now (nil: it doesn't, the real picture stays). Two signs that the next
    /// return will likely be through an icon: (1) the shown tab is an icon's own tab, on its site, in full screen (how
    /// an icon lands: the site as an app, no browser around it); (2) the app last came to the front through an icon's
    /// link. A tab put in full screen by the two-finger hold, with no icon, isn't (1): it's still TRIF used as a
    /// browser, reached from TRIF's own icon or the app switcher, where the card should show the page.
    func reason() -> String? {
        guard !LeavingCover.off, let b = browser, let t = b.current else { return nil }
        let site = Site.of(t.host)
        if b.fullScreen, !site.isEmpty,
           (UserDefaults.standard.dictionary(forKey: "iconTabs") as? [String: String])?[site] == t.id.uuidString {
            return "\(site)'s icon tab in full screen"
        }
        if arrivedByIcon { return "came to the front by an icon" }
        return nil
    }

    func willEnterForeground() {
        frontAt = Date()
        // (a cold launch: the link came in configurationForConnecting, before this; a warm return's comes after)
        arrivedByIcon = Date().timeIntervalSince(iconLinkAt) < 3
        note("coming to the front\(window?.isHidden == false ? ", covered" : "")")
    }

    func didEnterBackground(_ scene: UIWindowScene) {
        guard let why = reason() else {
            note("left: the real picture kept")
            return
        }
        show(in: scene)
        note("left: covered (\(why))")
        Diagnostics.shared.log("cover", "the app left in icon use (\(why)): covered for iOS's picture")
    }

    func show(in scene: UIWindowScene) {
        let w = window ?? {
            let w = UIWindow(windowScene: scene)
            w.windowLevel = .alert + 1
            w.overrideUserInterfaceStyle = .dark
            w.backgroundColor = .black
            w.rootViewController = CoverController()
            window = w
            return w
        }()
        w.layer.removeAllAnimations()
        w.alpha = 1
        w.isHidden = false
        w.layoutIfNeeded()
        // (drawn now: iOS's picture is taken right after sceneDidEnterBackground returns)
        CATransaction.flush()
        shownAt = Date()
    }

    func didBecomeActive() {
        guard let w = window, !w.isHidden else { return }
        note("in front, covered")
        Task { @MainActor in
            let start = Date()
            func since() -> Double { Date().timeIntervalSince(start) }
            // (an icon's link UIKit has handed over and ContentView.openLink hasn't taken yet: its tab first)
            while PendingLink.url != nil, since() < 1 { try? await Task.sleep(nanoseconds: 20_000_000) }
            // (the shown tab's page drawn: a tab let go in the background is made again and loads)
            while !(browser?.current?.drawn ?? true), since() < 0.8 { try? await Task.sleep(nanoseconds: 30_000_000) }
            // (a frame for SwiftUI to draw what openLink chose)
            try? await Task.sleep(nanoseconds: 50_000_000)
            guard window?.isHidden == false else { return }
            note("cover off (\(browser?.host.nonEmpty ?? "-") shown, drawn \(browser?.current?.drawn ?? false), waited \(Int(since() * 1000)) ms)")
            hide(animated: true)
        }
    }

    func hide(animated: Bool) {
        guard let w = window, !w.isHidden else { return }
        guard animated else { w.isHidden = true; return }
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            w.alpha = 0
        } completion: { _ in
            if w.alpha == 0 { w.isHidden = true; w.alpha = 1 }
        }
    }

    /// (development) {"cover": 1}: the rule now, whether the cover is up, the last steps. {"cover": "show"}: the
    /// cover put up for 6 s, for a screenshot.
    func describe() -> String {
        "icon use now: \(reason() ?? "no (the real picture stays)"); came by an icon \(arrivedByIcon); cover \(window?.isHidden == false ? "up" : "down")\n" + events.joined(separator: "\n")
    }
    func showForCheck() {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        show(in: scene)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            hide(animated: false)
        }
    }
}

/// Black, TRIF's robot at the exact centre of the whole screen (not the safe area) at its own size, no words: CoverRobot,
/// the launch screen's picture (make-icon.js --cover: 128 pt, the robot itself 124 pt, a third of an SE's width; Tim,
/// 11-18), so a cold launch and a return look the same.
private final class CoverController: UIViewController {
    override func loadView() {
        let v = UIView()
        v.backgroundColor = .black
        let robot = UIImageView(image: UIImage(named: "CoverRobot"))
        robot.translatesAutoresizingMaskIntoConstraints = false
        robot.isAccessibilityElement = false // (no words: nothing for VoiceOver to say)
        v.addSubview(robot)
        NSLayoutConstraint.activate([robot.centerXAnchor.constraint(equalTo: v.centerXAnchor),
                                     robot.centerYAnchor.constraint(equalTo: v.centerYAnchor)])
        view = v
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
