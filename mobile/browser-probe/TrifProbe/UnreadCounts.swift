// The sites' own unread counts (Tim, 11-18: "unread counts instead of notifications"; he hates pings, and some people
// want to know something's waiting). Each tab's count is read from its page title (UnreadTitle.swift, the shared rule)
// as the page itself shows it: never a site's API, never a private one. Shown quietly: a small badge on the tab's card
// (Tabs.swift TabCard), and on TRIF's own icon the total over the Home Screen icon tabs (the sites used as apps:
// `iconTabs`, a tab counted only while it's on its icon's site), by UNUserNotificationCenter.setBadgeCount. That needs
// iOS's notification permission, asked for with `.badge` only (no alerts, no sounds) and only once there's first a count
// to put there, after TRIF's own few words; refused, the icon simply has no badge. The setting "Show unread counts"
// (⋯ menu, on at first) switches both off.
//
// Fresh: a title the page changes updates at once while the app runs (Browser's KVO on title). The app leaving the
// front keeps the last counts (iOS keeps the icon's badge as set; the tabs' titles are saved with them). Tabs behind are
// let go after 20 s (Browser.letGoLater), so their counts are as of then until they're shown again. No background
// refresh: BGAppRefreshTask would have to load each icon site's whole page (these sites put the count in the title with
// their own scripts, after signing in, not in the HTML), which is what "cheap" ruled out (Tim, 11-18).

import SwiftUI
import UserNotifications

@MainActor
final class UnreadCounts: ObservableObject {
    static let shared = UnreadCounts()
    /// The setting (UserDefaults; on unless switched off).
    nonisolated static let settingKey = "showUnreadCounts"
    nonisolated static var on: Bool { UserDefaults.standard.object(forKey: settingKey) as? Bool ?? true }
    /// TRIF's words before iOS's question have been shown (answered either way): never again, until the setting is
    /// switched off and on.
    nonisolated private static let askedKey = "unreadBadgeAsked"

    weak var browser: Browser?
    /// TRIF's explanation before iOS's question is up (ContentView's alert).
    @Published var asking = false
    /// The total over the icon tabs, and the badge last put on the icon (nil: none put since launch).
    private(set) var iconSum = 0
    private(set) var badgeSet: Int?
    private(set) var lastWhy = ""
    private var soon: Task<Void, Never>?

    /// A tab's title, address, or the tabs changed: the total is worked out again a moment later (titles change in
    /// bursts as a page loads).
    func changed() {
        guard soon == nil else { return }
        soon = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            self?.soon = nil
            self?.update()
        }
    }

    /// The tabs that stand for a Home Screen icon: each icon's own tab, while it's on its icon's site.
    func iconTabs(_ b: Browser) -> [Tab] {
        let map = UserDefaults.standard.dictionary(forKey: "iconTabs") as? [String: String] ?? [:]
        return b.tabs.filter { t in let s = Site.of(t.host); return !s.isEmpty && map[s] == t.id.uuidString }
    }

    func update() {
        guard let b = browser else { return }
        let on = UnreadCounts.on
        iconSum = on ? iconTabs(b).reduce(0) { $0 + max(0, $1.unread?.count ?? 0) } : 0
        let sum = iconSum
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let status = s.authorizationStatus, badge = s.badgeSetting
            Task { @MainActor in self.apply(sum, on: on, status: status, badge: badge) }
        }
    }

    private func apply(_ sum: Int, on: Bool, status: UNAuthorizationStatus, badge: UNNotificationSetting) {
        switch status {
        case .notDetermined:
            // (asked only with a count to show, the app in front, and once)
            lastWhy = "not asked yet"
            if on, sum > 0, !UserDefaults.standard.bool(forKey: UnreadCounts.askedKey), UIApplication.shared.applicationState == .active, !asking {
                asking = true
                Diagnostics.shared.log("unread", "the first unread count on a Home Screen icon tab: TRIF's words before iOS's question shown")
            }
        case .denied:
            lastWhy = "notifications refused: no icon badge"
        default:
            // (allowed earlier, for a chat's or a download's notification: the badge only if iOS's Badges switch
            // for TRIF is on; nothing is asked again, iOS asks only once)
            guard badge == .enabled else { lastWhy = "badges off for TRIF in Settings"; return }
            lastWhy = "badge allowed"
            set(sum)
        }
    }

    private func set(_ n: Int) {
        guard badgeSet != n else { return }
        badgeSet = n
        UNUserNotificationCenter.current().setBadgeCount(n) { error in
            Task { @MainActor in
                if let error { Diagnostics.shared.log("unread", "the icon's badge couldn't be set to \(n): \(error.localizedDescription)"); self.badgeSet = nil }
                else { Diagnostics.shared.log("unread", "TRIF's icon badge: \(n) (\(self.browser.map { self.iconTabs($0).count } ?? 0) icon tab(s))") }
            }
        }
    }

    /// TRIF's words answered: Continue asks iOS (badge only), Not now leaves it.
    func answer(allow: Bool) {
        asking = false
        UserDefaults.standard.set(true, forKey: UnreadCounts.askedKey)
        guard allow else { Diagnostics.shared.log("unread", "the icon badge: Not now"); return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { ok, _ in
            Task { @MainActor in
                Diagnostics.shared.log("unread", "the icon badge: iOS's question \(ok ? "allowed" : "refused")")
                self.update()
            }
        }
    }

    /// The setting switched: the cards follow by themselves (they read it); the icon's badge now, and switched back
    /// on, TRIF may explain once more.
    func settingChanged(_ on: Bool) {
        if on { UserDefaults.standard.removeObject(forKey: UnreadCounts.askedKey) }
        Diagnostics.shared.log("unread", "Show unread counts \(on ? "on" : "off")")
        update()
    }

    /// (development, {"unread": 1}) each tab's count, the icon tabs, the total, the badge and the permission.
    func describe() async -> String {
        guard let b = browser else { return "no browser" }
        let s = await UNUserNotificationCenter.current().notificationSettings()
        let icons = Set(iconTabs(b).map(\.id))
        let lines = b.tabs.enumerated().map { i, t in
            "\(i)\(t === b.current ? "*" : " ") \(t.host.isEmpty ? "-" : t.host)\(icons.contains(t.id) ? " (icon tab)" : ""): \(t.unread.map { "\($0.text) · card title “\($0.title)”" } ?? "no count")"
        }
        return lines.joined(separator: "\n") + "\nsetting \(UnreadCounts.on ? "on" : "off"); icon total \(iconSum); badge set \(badgeSet.map(String.init) ?? "-"); permission \(s.authorizationStatus.rawValue) (0 not asked, 1 refused, 2 allowed) badges \(s.badgeSetting.rawValue) (0 n/a, 1 off, 2 on) alerts \(s.alertSetting.rawValue); asking \(asking); asked \(UserDefaults.standard.bool(forKey: UnreadCounts.askedKey)); \(lastWhy)"
    }
}

/// A tab card's unread count: a small grey pill beside the robot's badge (never red: quiet).
struct UnreadBadge: View {
    let count: UnreadTitle.Count
    var body: some View {
        Text(count.text)
            .font(.caption2.weight(.semibold)).monospacedDigit()
            .foregroundStyle(.primary)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .frame(minWidth: 26, minHeight: 26)
            .background(Capsule().fill(.regularMaterial))
            .accessibilityLabel("\(count.text) unread")
    }
}
