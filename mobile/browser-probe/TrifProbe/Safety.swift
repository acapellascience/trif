// Getting out of a mod that wrecks a page (branch ios-poc, 11-15: Tim's iPhone SE, x.com with a broken free mod: the
// page's process at 50-60% CPU for minutes, the timeline gone black, then the app gone). Three ways out, as the
// user must always have one:
// - Safe mode: if the app quit while it was in front (a crash, or iOS ending it) and mods were running on a site,
//   the next launch starts with those mods switched off, says so, and the Mods tab lists them to switch back on one
//   at a time. (Leaving the app normally, to the home screen or another app, is a clean end; the record is only
//   left "unclean" while the app is in front.)
// - Pause all mods: from the Mods tab's ⋯, or a long press on the app's icon (before it even shows a page).
// - A runaway page: the stall watch (Diagnostics.stallWatch) says how busy each page's main thread is; a page with
//   mods kept busy most of the time for 40 seconds, or whose process WebKit ended twice in three minutes, gets an
//   offer to switch off its mods, naming the one most recently added or changed (a mod's own time can't be told
//   apart from the page's).

import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class Safety: ObservableObject {
    /// What the last launch left: the sites whose mods were running, and whether it ended cleanly.
    private struct Session: Codable { var clean: Bool; var sites: [String: [String]] }
    private static let key = "safety.session"
    private static let offKey = "safety.switchedOff"

    /// Mods switched off by safe mode or a runaway offer, by site, with why: the Mods tab lists them.
    struct SwitchedOff: Codable, Equatable { var ids: [String]; var why: String; var at: Date }
    @Published private(set) var switchedOff: [String: SwitchedOff] = [:]
    /// A runaway page's offer, for the app to show.
    struct Offer: Identifiable, Equatable { let id = UUID(); let site: String; let why: String; let mods: [String]; let likely: String? }
    @Published var offer: Offer?

    private var session: Session
    private var busyRuns: [String: Int] = [:]
    private var ends: [String: [Date]] = [:]
    private var offered = Set<String>()

    /// Reads what the last launch left. `store`: the mods, so a site's can be switched off before any page loads.
    init(store: ModStore) {
        session = (UserDefaults.standard.data(forKey: Safety.key)).flatMap { try? JSONDecoder().decode(Session.self, from: $0) } ?? Session(clean: true, sites: [:])
        switchedOff = (UserDefaults.standard.data(forKey: Safety.offKey)).flatMap { try? JSONDecoder().decode([String: SwitchedOff].self, from: $0) } ?? [:]
        let args = ProcessInfo.processInfo.arguments
        if !session.clean, !session.sites.isEmpty, !args.contains("-nosafe") {
            for (site, ids) in session.sites {
                let off = store.switchOff(ids, site: site)
                guard !off.isEmpty else { continue }
                switchedOff[site] = SwitchedOff(ids: off, why: "quit", at: Date())
                Diagnostics.shared.log("safe mode", "the app quit while it was in front, with mods running on \(site): switched off \(off.joined(separator: ", "))")
            }
            saveOff()
        }
        session = Session(clean: false, sites: [:])
        saveSession()
    }

    private func saveSession() { if let d = try? JSONEncoder().encode(session) { UserDefaults.standard.set(d, forKey: Safety.key) } }
    private func saveOff() { if let d = try? JSONEncoder().encode(switchedOff) { UserDefaults.standard.set(d, forKey: Safety.offKey) } }

    /// The app is in front (unclean until it leaves), or has left (clean).
    func active(_ inFront: Bool) {
        session.clean = !inFront
        saveSession()
    }

    /// The mods running in the tabs now, by site (kept, so a crash knows which to switch off).
    func running(_ bySite: [String: [String]]) {
        session.sites = bySite.filter { !$0.value.isEmpty }
        saveSession()
    }

    /// A mod switched back on (or deleted): it's no longer listed as switched off by TRIF.
    func forget(_ id: String) {
        var changed = false
        for (site, var s) in switchedOff where s.ids.contains(id) {
            s.ids.removeAll { $0 == id }
            switchedOff[site] = s.ids.isEmpty ? nil : s
            changed = true
        }
        if changed { saveOff() }
    }

    func dismiss(site: String) { switchedOff[site] = nil; saveOff() }

    /// A stall report from a page (Diagnostics.stallWatch): busy, in tenths, over the last ten seconds.
    func busy(site: String, percent: Int, mods: [InstalledMod]) {
        guard !mods.isEmpty else { busyRuns[site] = 0; return }
        busyRuns[site] = percent >= 50 ? (busyRuns[site] ?? 0) + 1 : 0
        if (busyRuns[site] ?? 0) >= 4 { propose(site: site, why: "busy", mods: mods) }
    }

    /// WebKit ended a page's process: twice in three minutes on a site with mods, and the mods are offered off.
    func ended(site: String, mods: [InstalledMod]) {
        let now = Date()
        ends[site] = (ends[site] ?? []).filter { now.timeIntervalSince($0) < 180 } + [now]
        if !mods.isEmpty, (ends[site] ?? []).count >= 2 { propose(site: site, why: "ended", mods: mods) }
    }

    private func propose(site: String, why: String, mods: [InstalledMod]) {
        guard offer == nil, !offered.contains(site) else { return }
        offered.insert(site)
        let changed = { (m: InstalledMod) in max(m.added, m.history.first?.at ?? m.added) }
        let likely = mods.max { changed($0) < changed($1) }
        Diagnostics.shared.log("runaway", "\(site): \(why == "busy" ? "the page was busy most of the time for 40 s" : "WebKit ended its process twice in 3 minutes"), with \(mods.map(\.id).joined(separator: ", ")); offered to switch them off (most recently changed: \(likely?.id ?? "-"))")
        offer = Offer(site: site, why: why, mods: mods.map(\.id), likely: likely?.id)
    }

    /// Switches off what an offer named (all the site's mods, or the likely one), and lists them for the Mods tab.
    func accept(_ o: Offer, only one: String?, store: ModStore) {
        let off = store.switchOff(one.map { [$0] } ?? o.mods, site: o.site)
        if !off.isEmpty {
            var s = switchedOff[o.site] ?? SwitchedOff(ids: [], why: o.why, at: Date())
            s.ids = Array(Set(s.ids + off)).sorted()
            s.why = o.why
            switchedOff[o.site] = s
            saveOff()
            Diagnostics.shared.log("runaway", "switched off \(off.joined(separator: ", ")) on \(o.site)")
        }
        offer = nil
    }
}

extension ModStore {
    /// Switches these mods off on a site (the whole mod, or its switch there for a mod on several sites); returns
    /// the ones that were on.
    func switchOff(_ ids: [String], site: String) -> [String] {
        var off: [String] = []
        for id in ids {
            guard let m = mods.first(where: { $0.id == id }), isOn(m, site: site) else { continue }
            setOn(id, false, site: m.multiSite ? site : nil)
            off.append(id)
        }
        return off
    }
}

/// The app's icon's long-press menu: Pause all mods (Info.plist's UIApplicationShortcutItems), handled here as the
/// scene starts or is brought back by it.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let pauseShortcut = "com.timsrobot.trifprobe.pause"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// A tap on a reply's notification (ClaudePane): told to the chat once the app's parts are there.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        await MainActor.run {
            // (a launch from the notification: the app's parts start a moment after this)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 600_000_000)
                NotificationCenter.default.post(name: .trifNotificationTapped, object: nil, userInfo: info)
            }
        }
    }

    /// In front, the app shows the reply itself: no banner.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [] }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if options.shortcutItem?.type == AppDelegate.pauseShortcut { ModStore.pauseFromShortcut() }
        let c = UISceneConfiguration(name: nil, sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        if shortcutItem.type == AppDelegate.pauseShortcut { ModStore.pauseFromShortcut() }
        completionHandler(true)
    }
}

extension Notification.Name {
    /// Pause all mods came from outside the app's views (the icon's menu): the browser runs no mods from now.
    static let trifPauseAll = Notification.Name("trifPauseAll")
    /// A reply's notification was tapped (ClaudePane.notificationTapped).
    static let trifNotificationTapped = Notification.Name("trifNotificationTapped")
}

extension ModStore {
    static let pausedKey = "modsPaused"
    /// Pause all mods, from the icon's menu: kept, and the running app told.
    nonisolated static func pauseFromShortcut() {
        UserDefaults.standard.set(true, forKey: pausedKey)
        Diagnostics.logLater("paused", "all mods paused from the app icon's menu")
        DispatchQueue.main.async { NotificationCenter.default.post(name: .trifPauseAll, object: nil) }
    }
}

/// The note over the page after safe mode or a runaway offer switched mods off; Mods opens the tab.
struct SafetyBanner: View {
    let site: String
    let off: Safety.SwitchedOff
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Color.trifYellow)
            VStack(alignment: .leading, spacing: 6) {
                Text(off.why == "quit"
                     ? "The app quit while mods were running on \(site), so TRIF switched \(off.ids.count == 1 ? "it" : "them") off. Switch them back on one at a time in Mods."
                     : "TRIF switched off \(off.ids.count == 1 ? "a mod" : "\(off.ids.count) mods") on \(site) that kept this iPhone busy. Switch them back on one at a time in Mods.")
                    .font(.footnote)
                HStack(spacing: 16) {
                    Button("Mods", action: open).font(.footnote.bold())
                    Button("OK", action: dismiss).font(.footnote)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
    }
}
