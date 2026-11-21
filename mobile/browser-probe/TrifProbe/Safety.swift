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
    /// What the last launch left: the sites whose mods were running, and whether it ended cleanly (it's unclean only
    /// while the app is in front: a launch that never came to the front, one iOS prewarmed or launched in the
    /// background, or one an installer ended, is clean); `since`: when it last came to the front or left it.
    private struct Session: Codable { var clean: Bool; var sites: [String: [String]]; var since: Date? = nil }
    private static let key = "safety.session"
    private static let offKey = "safety.switchedOff"

    /// Mods switched off by safe mode or a runaway offer, by site, with why: the Mods tab lists them.
    /// `snap`: the snapshot of the switches taken before (SwitchSnapshot), for "Turn them back on".
    struct SwitchedOff: Codable, Equatable { var ids: [String]; var why: String; var at: Date; var snap: String? = nil }
    @Published private(set) var switchedOff: [String: SwitchedOff] = [:]
    /// A runaway page's offer, for the app to show.
    struct Offer: Identifiable, Equatable { let id = UUID(); let site: String; let why: String; let mods: [String]; let likely: String? }
    @Published var offer: Offer?

    private var session: Session
    private var busyRuns: [String: Int] = [:]
    private var ends: [String: [Date]] = [:]
    private var offered = Set<String>()
    /// The switches as they were before safe mode or a runaway offer switched mods off, newest first (the last 5).
    @Published private(set) var snapshots: [SwitchSnapshot] = []

    /// Reads what the last launch left. `store`: the mods, so a site's can be switched off before any page loads.
    init(store: ModStore) {
        snapshots = SwitchSnapshot.load()
        session = (UserDefaults.standard.data(forKey: Safety.key)).flatMap { try? JSONDecoder().decode(Session.self, from: $0) } ?? Session(clean: true, sites: [:])
        switchedOff = (UserDefaults.standard.data(forKey: Safety.offKey)).flatMap { try? JSONDecoder().decode([String: SwitchedOff].self, from: $0) } ?? [:]
        let args = DevFlags.args
        let ago = session.since.map { " \(Int(Date().timeIntervalSince($0))) s before this launch" } ?? ""
        Diagnostics.shared.log("safe mode", session.clean
            ? "the last run ended cleanly (it had left the front\(ago), or never came to it)"
            : "the last run ended while the app was in front (it came to the front\(ago)), with mods running on \(session.sites.keys.sorted().joined(separator: ", ").nonEmpty ?? "no site")")
        // (TRIF's own heavy work was going on as the app died (a model's check or load, a reply from it, a big
        // import): that, not the pages' mods, is the likely cause, so they're left on. Tim, 11-18: the 4 GB model's
        // check used up the phone's memory and safe mode switched off all his x.com and youtube.com mods)
        let jobs = HeavyJob.takeLastRun()
        if !session.clean, !jobs.isEmpty {
            Diagnostics.shared.log("safe mode", "the app quit while TRIF was \(jobs.joined(separator: ", ")); mods left on")
        } else if !session.clean, !session.sites.isEmpty, !args.contains("-nosafe") {
            // (a snapshot of the switches first, so one tap can put them back: Tim, 11-18)
            let (bySite, snap) = switchOff(session.sites, why: "quit", reason: "the app quit while it was in front, with mods running", store: store)
            for (site, off) in bySite {
                switchedOff[site] = SwitchedOff(ids: off, why: "quit", at: Date(), snap: snap)
                Diagnostics.shared.log("safe mode", "the app quit while it was in front, with mods running on \(site): switched off \(off.joined(separator: ", "))")
            }
            saveOff()
        }
        // (clean until the app is in front: 11-16, Tim's phone switched x.com's mods off after an install over the app,
        // because every launch was marked unclean from its start, in front or not)
        session = Session(clean: true, sites: [:], since: Date())
        saveSession()
        // (in front, or not, from UIKit's own notifications: they come for every change, the first one too, which
        // SwiftUI's scenePhase onChange doesn't)
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.active(true) }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.active(false) }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.active(false) }
        }
        if UIApplication.shared.applicationState == .active { active(true) }
    }

    private func saveSession() { if let d = try? JSONEncoder().encode(session) { UserDefaults.standard.set(d, forKey: Safety.key) } }
    private func saveOff() { if let d = try? JSONEncoder().encode(switchedOff) { UserDefaults.standard.set(d, forKey: Safety.offKey) } }

    /// The app is in front (unclean until it leaves), or has left (clean).
    func active(_ inFront: Bool) {
        guard session.clean == inFront else { return }
        session.clean = !inFront
        session.since = Date()
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

    /// A mod renamed: its lists here follow it (what's switched off, what was running for a crash's check).
    func renamed(_ from: String, _ to: String) {
        var changed = false
        for (site, var s) in switchedOff where s.ids.contains(from) {
            s.ids = s.ids.map { $0 == from ? to : $0 }
            switchedOff[site] = s
            changed = true
        }
        if changed { saveOff() }
        if snapshots.contains(where: { $0.mods.contains { $0.id == from } }) {
            for i in snapshots.indices { for j in snapshots[i].mods.indices where snapshots[i].mods[j].id == from { snapshots[i].mods[j].id = to } }
            SwitchSnapshot.save(snapshots)
        }
        if session.sites.values.contains(where: { $0.contains(from) }) {
            session.sites = session.sites.mapValues { $0.map { $0 == from ? to : $0 } }
            saveSession()
        }
    }

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
        let (bySite, snap) = switchOff([o.site: one.map { [$0] } ?? o.mods], why: o.why, reason: o.why == "busy" ? "the page was busy most of the time for 40 s" : "WebKit ended its process twice in 3 minutes", store: store)
        let off = bySite[o.site] ?? []
        if !off.isEmpty {
            var s = switchedOff[o.site] ?? SwitchedOff(ids: [], why: o.why, at: Date())
            s.ids = Array(Set(s.ids + off)).sorted()
            s.why = o.why
            s.snap = snap
            switchedOff[o.site] = s
            saveOff()
            Diagnostics.shared.log("runaway", "switched off \(off.joined(separator: ", ")) on \(o.site)")
        }
        offer = nil
    }
}

/// The switches as they were before safe mode (or a runaway offer) switched mods off (Tim, 11-18: "some sort of
/// configuration file that stores what the switches were set at, so … you can turn them all back on exactly as they
/// were"). Application Support/safe-mode-snapshots.json, newest first, the last 5. Written before any switch changes,
/// and again with each mod's switch after. Each mod by its file id then and its stable id (@id), so a mod renamed
/// since still restores. Tiers and Pause all: safe mode changes neither, so they're only recorded (`groupsOff`,
/// `paused`), never restored. docs/MOBILE-BEHAVIOUR.md "Safe mode's snapshot".
struct SwitchSnapshot: Codable, Identifiable, Equatable {
    /// A mod's own switch: on, the sites it's off on (a mod for several sites), when it was last switched (ms).
    struct Switch: Codable, Equatable {
        var on: Bool; var offSites: [String]; var at: Double?
        func same(_ o: Switch) -> Bool { on == o.on && offSites.sorted() == o.offSites.sorted() && at == o.at }
    }
    struct Mod: Codable, Equatable {
        var id: String
        var uid: String?
        var name: String
        /// What safe mode switched off: its whole switch, or its switch on these sites (a mod for several sites).
        var whole: Bool
        var sites: [String]
        var before: Switch
        /// As safe mode left it (nil: the app ended before it got that far: then nothing is put back).
        var after: Switch?
        /// It was waiting for an OK then (it waits still after a restore: a switch never allows anything).
        var held: Bool
    }
    var id: String
    var at: Date
    /// quit (safe mode), busy or ended (a runaway page's offer, taken).
    var why: String
    var reason: String
    var sites: [String]
    var mods: [Mod]
    var groupsOff: [String: [String]]
    var paused: Bool
    /// When "Turn them back on" (or the ⋯ menu) last put them back.
    var restored: Date?

    static let keep = 5
    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("safe-mode-snapshots.json")
    }
    static func load() -> [SwitchSnapshot] {
        guard let d = try? Data(contentsOf: file) else { return [] }
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        return (try? dec.decode([SwitchSnapshot].self, from: d)) ?? []
    }
    static func save(_ list: [SwitchSnapshot]) {
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601; enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let d = try? enc.encode(Array(list.prefix(keep))) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? d.write(to: file, options: .atomic)
    }

    /// What a restore did: put back, left alone (changed since: the person's or the computer's later choice), gone,
    /// and of those put back the ones that still wait for an OK.
    struct Result { var restored: [String] = []; var changed: [String] = []; var gone: [String] = []; var waiting: [String] = [] }
}

extension Safety {
    /// Switches off the mods running on these sites, a snapshot of their switches written first. Returns what went
    /// off by site, and the snapshot's id (nil when nothing was on).
    func switchOff(_ bySite: [String: [String]], why: String, reason: String, store: ModStore) -> ([String: [String]], String?) {
        // (each mod once, with every site safe mode will switch it off on)
        var plan: [String: (whole: Bool, sites: [String])] = [:]
        for (site, ids) in bySite {
            for id in ids {
                guard let m = store.mods.first(where: { $0.id == id }), store.isOn(m, site: site) else { continue }
                var p = plan[id] ?? (!m.multiSite, [])
                if m.multiSite { p.sites = Array(Set(p.sites + [site])).sorted() }
                plan[id] = p
            }
        }
        guard !plan.isEmpty else { return ([:], nil) }
        let uids = store.keptUids
        let sw = { (m: InstalledMod) in SwitchSnapshot.Switch(on: m.on, offSites: m.offSites, at: m.switchAt) }
        let sites = bySite.keys.sorted()
        var snap = SwitchSnapshot(id: UUID().uuidString, at: Date(), why: why, reason: reason, sites: sites,
                                  mods: plan.keys.sorted().compactMap { id in
                                      store.mods.first { $0.id == id }.map { m in
                                          .init(id: id, uid: uids[id], name: m.name, whole: plan[id]!.whole, sites: plan[id]!.sites, before: sw(m), after: nil, held: m.held)
                                      }
                                  },
                                  groupsOff: store.groupsOff.filter { sites.contains($0.key) }, paused: store.paused, restored: nil)
        snapshots = Array(([snap] + snapshots).prefix(SwitchSnapshot.keep))
        SwitchSnapshot.save(snapshots)
        var off: [String: [String]] = [:]
        for (site, ids) in bySite {
            let o = store.switchOff(ids, site: site)
            if !o.isEmpty { off[site] = o }
        }
        for i in snap.mods.indices { snap.mods[i].after = store.mods.first { $0.id == snap.mods[i].id }.map(sw) }
        snapshots[0] = snap
        SwitchSnapshot.save(snapshots)
        Diagnostics.shared.log("safe mode", "snapshot \(snap.id.prefix(8)) of \(snap.mods.count) mod(s)' switches on \(sites.joined(separator: ", ")) kept before switching them off (\(why))")
        return (off, snap.id)
    }

    /// Puts back the switches a snapshot holds: only what safe mode changed, and only where the switch is still as
    /// safe mode left it (one changed since, here or synced from the computer, is a later choice: left alone). Each
    /// as a switch of the person's (a fresh time, so it syncs). A hold still holds. Nil: no such snapshot.
    func restore(_ snapId: String, store: ModStore) -> SwitchSnapshot.Result? {
        guard let k = snapshots.firstIndex(where: { $0.id == snapId }) else { return nil }
        var r = SwitchSnapshot.Result()
        let uids = store.keptUids
        for e in snapshots[k].mods {
            // (by its stable id where it had one: a renamed mod is still found)
            let m = e.uid.flatMap { u in store.mods.first { uids[$0.id] == u } } ?? store.mods.first { $0.id == e.id }
            guard let m else { r.gone.append(e.name); continue }
            guard let after = e.after, SwitchSnapshot.Switch(on: m.on, offSites: m.offSites, at: m.switchAt).same(after) else { r.changed.append(m.id); continue }
            if e.whole { store.setOn(m.id, e.before.on, site: nil) }
            for site in e.sites where !e.before.offSites.contains(site) { store.setOn(m.id, true, site: site) }
            forget(m.id)
            r.restored.append(m.id)
            if store.mods.first(where: { $0.id == m.id })?.held == true { r.waiting.append(m.id) }
        }
        snapshots[k].restored = Date()
        SwitchSnapshot.save(snapshots)
        // (the banners of the sites it covered: nothing of theirs is left switched off by TRIF)
        for site in snapshots[k].sites where switchedOff[site]?.snap == snapId { switchedOff[site] = nil }
        saveOff()
        Diagnostics.shared.log("safe mode", "snapshot \(snapId.prefix(8)) put back: \(r.restored.joined(separator: ", ").nonEmpty ?? "none")\(r.changed.isEmpty ? "" : "; left as changed since: \(r.changed.joined(separator: ", "))")\(r.gone.isEmpty ? "" : "; gone: \(r.gone.joined(separator: ", "))")\(r.waiting.isEmpty ? "" : "; still waiting for an OK: \(r.waiting.joined(separator: ", "))")")
        return r
    }

    /// (development: the snapshots, as the step `snapshots` prints them)
    var describeSnapshots: String {
        snapshots.map { s in
            "\(s.id.prefix(8)) \(s.why) \(s.sites.joined(separator: ",")) \(s.restored == nil ? "" : "restored ")mods: " + s.mods.map { m in
                "\(m.id)\(m.uid.map { " uid \($0)" } ?? "") \(m.whole ? "whole" : "on \(m.sites.joined(separator: ","))") before \(m.before.on ? "on" : "off")\(m.before.offSites.isEmpty ? "" : " off on \(m.before.offSites.joined(separator: ","))") after \(m.after.map { "\($0.on ? "on" : "off")\($0.offSites.isEmpty ? "" : " off on \($0.offSites.joined(separator: ","))")" } ?? "-")\(m.held ? " held" : "")"
            }.joined(separator: "; ")
        }.joined(separator: "\n").nonEmpty ?? "no snapshots"
    }
}

extension Browser {
    /// "Turn them back on" (the banner) and the Mods tab's ⋯ → Restore switches from before safe mode: the snapshot's
    /// switches put back (Safety.restore), the pages' scripts made again (the shown tab loads again unless it plays;
    /// tabs behind when they're next shown), and what happened said in the toast. The switches sync as any switch.
    @discardableResult
    func restoreSwitches(_ snapId: String) -> SwitchSnapshot.Result? {
        guard let r = safety.restore(snapId, store: mods) else { return nil }
        if !r.restored.isEmpty { modsChanged(why: "safe mode's switches put back") }
        AppToast.shared.show(Safety.restoreWords(r), problem: r.restored.isEmpty)
        return r
    }
}

extension Safety {
    /// The toast after a restore (drafts, docs/IOS-APP-STRINGS.md).
    static func restoreWords(_ r: SwitchSnapshot.Result) -> String {
        let left = r.changed.count + r.gone.count
        guard !r.restored.isEmpty else {
            return r.changed.isEmpty ? "Nothing to put back: those mods were deleted since" : "Nothing to put back: you've switched those mods since"
        }
        var t = r.restored.count == 1 ? "1 mod back on as before" : "\(r.restored.count) mods back on as before"
        if left > 0 { t += left == 1 ? " · 1 you changed since is left as it is" : " · \(left) you changed since are left as they are" }
        if !r.waiting.isEmpty { t += r.waiting.count == 1 ? " · 1 still waits for your OK" : " · \(r.waiting.count) still wait for your OK" }
        return t
    }

    /// The ⋯ menu's line for a snapshot: when, and the sites (drafts).
    static func snapshotLabel(_ s: SwitchSnapshot) -> String {
        let when = Calendar.current.isDateInToday(s.at) ? s.at.formatted(date: .omitted, time: .shortened)
            : s.at.formatted(date: .abbreviated, time: .shortened)
        return "\(when) · \(s.sites.joined(separator: ", "))\(s.restored != nil ? " (put back)" : "")"
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
        MainActor.assumeIsolated { BackgroundPlay.setUp() }
        return true
    }

    /// iOS woke (or launched) the app for the model downloads' background session (LocalModels): the session made again
    /// with its identifier, its downloads attached, and iOS told once its events are handled.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == LocalModels.sessionID else { completionHandler(); return }
        MainActor.assumeIsolated {
            Diagnostics.shared.log("local model", "iOS woke the app for the model downloads")
            LocalModels.shared.backgroundDone = completionHandler
            LocalModels.shared.wake()
        }
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
        // (a launch by a link, a Home Screen icon's: logged and kept as UIKit hands it over, WebClip.swift PendingLink)
        if let url = options.urlContexts.first?.url { MainActor.assumeIsolated { PendingLink.came(url, "the app was launched by a link") } }
        let c = UISceneConfiguration(name: nil, sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    /// A link while the app runs (SwiftUI's onOpenURL gets it too): logged and kept (PendingLink).
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url { MainActor.assumeIsolated { PendingLink.came(url, "a link came in") } }
    }

    // (the plain cover for iOS's picture of the app as it leaves in icon use, and off again on return: LeavingCover.swift)
    func sceneDidEnterBackground(_ scene: UIScene) {
        guard let ws = scene as? UIWindowScene else { return }
        MainActor.assumeIsolated { LeavingCover.shared.didEnterBackground(ws) }
    }
    func sceneWillEnterForeground(_ scene: UIScene) { MainActor.assumeIsolated { LeavingCover.shared.willEnterForeground() } }
    func sceneDidBecomeActive(_ scene: UIScene) { MainActor.assumeIsolated { LeavingCover.shared.didBecomeActive() } }

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
    /// "Turn them back on" (nil: no snapshot for it, as with switch-offs from before 11-18)
    var restore: (() -> Void)? = nil
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Color.trifYellow)
            VStack(alignment: .leading, spacing: 6) {
                Text(off.why == "quit"
                     ? "The app quit while mods were running on \(site), so TRIF switched \(off.ids.count == 1 ? "it" : "them") off."
                     : "TRIF switched off \(off.ids.count == 1 ? "a mod" : "\(off.ids.count) mods") on \(site) that kept this iPhone busy. Switch them back on one at a time in Mods.")
                    .font(.footnote)
                HStack(spacing: 16) {
                    if let restore { Button("Turn them back on", action: restore).font(.footnote.bold()) }
                    Button("Mods", action: open).font(restore == nil ? .footnote.bold() : .footnote)
                    Button("OK", action: dismiss).font(.footnote)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
    }
}


/// TRIF's own heavy jobs (Tim, 11-18: a model's check froze his phone and safe mode blamed his mods): each one is
/// written down as it starts and crossed off as it ends, at once (UserDefaults, from any thread), so the next launch
/// knows the app died during one (Safety.init: mods left on).
enum HeavyJob {
    private static let key = "safety.heavyJobs"
    private static let lock = NSLock()
    /// The jobs going on now (token → what).
    private static func read() -> [String: String] { UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] }

    /// A job starts: its token, for `end`.
    static func begin(_ what: String) -> String {
        let token = UUID().uuidString
        lock.withLock {
            var all = read()
            all[token] = what
            UserDefaults.standard.set(all, forKey: key)
        }
        return token
    }

    static func end(_ token: String) {
        lock.withLock {
            var all = read()
            guard all.removeValue(forKey: token) != nil else { return }
            UserDefaults.standard.set(all, forKey: key)
        }
    }

    /// Runs `body` as a heavy job.
    static func run<T>(_ what: String, _ body: () throws -> T) rethrows -> T {
        let t = begin(what)
        defer { end(t) }
        return try body()
    }

    /// At launch: what the last run was doing when it ended, and forgotten.
    static func takeLastRun() -> [String] {
        lock.withLock {
            let all = read()
            UserDefaults.standard.removeObject(forKey: key)
            return Array(Set(all.values)).sorted()
        }
    }
}
