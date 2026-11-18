import Foundation

/// The leaving cover's "icon use" decision (docs/MOBILE-BEHAVIOUR.md, Icons and full screen): whether the app counts
/// as used through Home Screen icons as it leaves, so LeavingCover puts its cover up for iOS's picture. The phones'
/// shared rule: mobile/shared/core/leaving-cover.js (TrifCore.leavingCover), through Core.swift (once as the app
/// leaves or comes to the front, not a hot path). The cover, its timing and the scene hooks stay LeavingCover.swift.
/// No UI: the Mac check (mobile/test/leavingcover.test.js) builds it.
enum LeavingCoverRules {
    enum Why: Equatable {
        /// the shown tab is this site's icon tab, on its site, in full screen
        case iconTab(String)
        /// the app last came to the front by an icon's link
        case arrived
    }

    /// `host`/`tab`: the shown tab's; `iconTabs`: each icon's site → its own tab's id (UserDefaults "iconTabs").
    /// No answer: nil (the real picture stays, as before the cover).
    static func reason(fullScreen: Bool, host: String, tab: String, iconTabs: [String: String]?, arrivedByIcon: Bool) -> Why? {
        let facts: [String: Any] = ["fullScreen": fullScreen, "host": host, "tab": tab,
                                    "iconTabs": iconTabs.map { $0 as Any } ?? NSNull(), "arrivedByIcon": arrivedByIcon]
        guard let r = Core.shared.call("leavingCover.reason", [facts]) as? [String: Any] else { return nil }
        if let s = r["iconTab"] as? String { return .iconTab(s) }
        if r["arrived"] as? Bool == true { return .arrived }
        return nil
    }

    /// Coming to the front counts as by an icon: its link came `since` seconds ago, within the shared window (3 s).
    /// No answer: the same window here.
    static func arrived(since: Double) -> Bool {
        (Core.shared.call("leavingCover.arrived", [since]) as? Bool) ?? (since < 3)
    }
}
