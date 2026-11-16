// Diagnostics (branch ios-poc, 11-15): a short log of what goes wrong on the phone, kept on it, that Tim can send from
// the Mods tab's ⋯ (Send diagnostics…). Tim saw x.com's timeline turn black and stop loading on his iPhone SE; this
// says, with times, whether WebKit ended a page's process (a black page; the app reloads it), the app was low on
// memory, a page's main thread stalled (and for how long, with how many elements it had), or a mod had errors.
// Nothing in it is sent anywhere by itself; it names the sites and the mods, never what's on a page.

import Foundation
import UIKit
import WebKit

extension String {
    /// nil for an empty string (for `?? "none"`).
    var nonEmpty: String? { isEmpty ? nil : self }
}

@MainActor
final class Diagnostics {
    static let shared = Diagnostics()

    struct Event: Codable { let at: Date; let kind: String; let text: String }
    private(set) var events: [Event] = []
    private var saveTask: Task<Void, Never>?
    private static let max = 600

    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("diagnostics.json")
    }

    private init() {
        if let data = try? Data(contentsOf: Diagnostics.file), let list = try? JSONDecoder().decode([Event].self, from: data) { events = list }
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Diagnostics.shared.log("memory", "the app was warned it's low on memory (\(Diagnostics.freeMB()) MB left for it)") }
        }
        Diagnostics.watchMainThread()
        log("start", "the app started: \(Diagnostics.device()), iOS \(UIDevice.current.systemVersion), \(Diagnostics.freeMB()) MB left for it")
        logInstall()
        // (a few seconds in: asked at once, WebKit's store answers 0 before it has read its file)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await Diagnostics.shared.cookieCensus("just after launch")
            await CookieKeeper.shared.names("just after launch")
        }
        CookieKeeper.shared.start()
        // (going to the background: a few seconds held, so WebKit can write down what the pages stored, and the count)
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Diagnostics.shared.wentToBackground() }
        }
    }

    // MARK: sign-ins that don't last (Tim, 11-15: X, Instagram and Claude signed out after restarts)
    // Not seen in the Simulator: cookies and storage were on disk within a second, and survived the app being killed
    // (kill -9, with WebKit's own processes too) and relaunched. So these lines say where they go on a phone: whether
    // this is the same install as before (a fresh install or data container starts with no sign-ins), and how many
    // cookies each site has at launch and on going to the background. Counts only: never a cookie's name or value.

    private func logInstall() {
        let d = UserDefaults.standard
        let launch = d.integer(forKey: "diag.launches") + 1
        d.set(launch, forKey: "diag.launches")
        var install = d.string(forKey: "diag.install") ?? ""
        let fresh = install.isEmpty
        if fresh { install = String(UUID().uuidString.prefix(8)); d.set(install, forKey: "diag.install") }
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        let cookieFile = lib.appendingPathComponent("Cookies/Cookies.binarycookies")
        let a = try? FileManager.default.attributesOfItem(atPath: cookieFile.path)
        let size = (a?[.size] as? NSNumber)?.intValue
        let ago = (a?[.modificationDate] as? Date).map { Int(Date().timeIntervalSince($0) / 60) }
        let websiteData = FileManager.default.fileExists(atPath: lib.appendingPathComponent("WebKit").path)
        let tabsKept = FileManager.default.fileExists(atPath: SavedTabs.file.path)
        log("install", "launch \(launch) of install \(install)\(fresh ? " (new: no data from before)" : ""), app id \(Bundle.main.bundleIdentifier ?? "?"), data folder \(String(NSHomeDirectory().split(separator: "/").last?.prefix(8) ?? "?")); tabs kept: \(tabsKept ? "yes" : "no"), cookie file: \(size.map { "\($0) bytes, written \(ago ?? 0) min ago" } ?? "none"), WebKit's data folder: \(websiteData ? "yes" : "no")")
    }

    /// How many cookies each site has in the app's one store (the tabs' and the chat's), and how many of them last
    /// only while the app runs (a sign-in kept in those ends with the app, by design).
    func cookieCensus(_ when: String) async {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        var count: [String: Int] = [:], session: [String: Int] = [:]
        for c in cookies {
            let site = Site.of(c.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
            count[site, default: 0] += 1
            if c.isSessionOnly { session[site, default: 0] += 1 }
        }
        let list = count.sorted { $0.value > $1.value }.prefix(25).map { "\($0.key) \($0.value)\(session[$0.key].map { " (\($0) for this run only)" } ?? "")" }
        log("cookies", "\(when): \(cookies.count) cookies\(list.isEmpty ? "" : ": " + list.joined(separator: ", "))")
    }

    private var holdTask: UIBackgroundTaskIdentifier = .invalid
    private func wentToBackground() {
        if holdTask == .invalid {
            holdTask = UIApplication.shared.beginBackgroundTask(withName: "TRIF: storing the pages' data") { [weak self] in
                MainActor.assumeIsolated { self?.endHold() }
            }
        }
        CookieKeeper.shared.flush("going to the background")
        Task { @MainActor in
            await self.cookieCensus("going to the background")
            await CookieKeeper.shared.names("going to the background")
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            self.endHold()
        }
    }
    private func endHold() {
        guard holdTask != .invalid else { return }
        let t = holdTask
        holdTask = .invalid
        UIApplication.shared.endBackgroundTask(t)
    }

    /// From any thread: logged on the main one.
    nonisolated static func logLater(_ kind: String, _ text: String) {
        DispatchQueue.main.async { MainActor.assumeIsolated { Diagnostics.shared.log(kind, text) } }
    }

    /// As log, once per launch for the same words (a mod's errors are seen each time the Mods tab asks).
    private var once = Set<String>()
    func logOnce(_ kind: String, _ text: String) {
        guard once.insert("\(kind) \(text)").inserted else { return }
        log(kind, text)
    }

    /// A view's body counted: more than 50 times in a second means an update loop (a state changed by its own
    /// layout), which kept Tim's phone at 50% CPU until iOS ended the app (11-15). Logged at most once a minute.
    private var bodyCount = 0, bodyWindow = CFAbsoluteTimeGetCurrent(), bodyLogged = 0.0
    private(set) var bodies = 0
    func bodyRan(_ view: String) {
        bodies += 1
        let now = CFAbsoluteTimeGetCurrent()
        if now - bodyWindow >= 1 { bodyWindow = now; bodyCount = 0 }
        bodyCount += 1
        if bodyCount == 50, now - bodyLogged > 60 {
            bodyLogged = now
            log("loop", "\(view) was drawn again 50 times within a second (an update loop?); last: \(lastAction)")
        }
    }

    /// What the app was doing last (for a hang's line): set by the steps that could take long.
    private(set) var lastAction = "nothing in particular"
    func mark(_ action: String) { lastAction = action }

    /// Watches the app's own main thread from another: a check sent every second that comes back late means the
    /// app was blocked (taps waited); over 500 ms, it's logged with what the app was doing. One check out at a time.
    nonisolated static func watchMainThread() {
        let q = DispatchQueue(label: "trif.hang-watch", qos: .utility)
        final class Out: @unchecked Sendable { var waiting = false }
        let out = Out()
        func tick() {
            if !out.waiting {
                out.waiting = true
                let sent = CFAbsoluteTimeGetCurrent()
                DispatchQueue.main.async {
                    let waited = CFAbsoluteTimeGetCurrent() - sent
                    q.async { out.waiting = false }
                    if waited > 0.5 { MainActor.assumeIsolated { Diagnostics.shared.log("hang", "the app's main thread was blocked \(Int(waited * 1000)) ms (last: \(Diagnostics.shared.lastAction))") } }
                }
            }
            q.asyncAfter(deadline: .now() + 1, execute: tick)
        }
        q.async(execute: tick)
    }

    func log(_ kind: String, _ text: String) {
        events.append(Event(at: Date(), kind: kind, text: String(text.prefix(1500))))
        if events.count > Diagnostics.max { events.removeFirst(events.count - Diagnostics.max) }
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            if let data = try? JSONEncoder().encode(self.events) { try? data.write(to: Diagnostics.file, options: .atomic) }
        }
    }

    /// The log as a file to share: a header, then one line per event, oldest first.
    func file() -> URL? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var text = "TRIF iPhone app diagnostics\nmade \(f.string(from: Date())) on \(Diagnostics.device()), iOS \(UIDevice.current.systemVersion), app \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"))\n\n"
        for e in events { text += "\(f.string(from: e.at))  \(e.kind)  \(e.text)\n" }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("TRIF diagnostics.txt")
        do { try text.write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }

    func clear() { events = []; log("start", "the log was cleared") }

    static func freeMB() -> Int { Int(os_proc_available_memory() / 1_048_576) }

    static func device() -> String {
        var sys = utsname()
        uname(&sys)
        return withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }

    /// Where a web view's page was, for a line: its address without what follows ? or #.
    static func place(_ url: URL?) -> String {
        guard let url else { return "no page" }
        return "\(url.scheme ?? "")://\(url.host ?? "")\(url.path)"
    }

    /// Put at the start of every page in TRIF's world: how busy the page's main thread is. Every five seconds it
    /// watches the page draw for half a second: a thread free to draw draws about 30 frames then; one kept busy by
    /// other work (the page's, a mod's) draws fewer, and the share missed is about how busy it was. (Timers alone
    /// don't see a mod that works in step with them.) It also notes the longest stall (a 100 ms timer that came
    /// late). Every ten seconds, if the page was busy a fifth of the time or more, or stalled 400 ms, it tells the
    /// app. A tenth of the time watching, and nothing while the page is hidden.
    static let stallWatch = """
    (function () {
      if (window.top !== window || globalThis.__trifStallWatch) return;
      globalThis.__trifStallWatch = true;
      var start = performance.now(), last = start, longest = 0, samples = [];
      function sample() {
        if (document.visibilityState !== 'visible') return;
        var t0 = performance.now(), frames = 0;
        function frame(now) {
          frames++;
          if (now - t0 < 500) requestAnimationFrame(frame);
          else samples.push(Math.max(0, Math.min(100, Math.round(100 * (1 - frames * (1000 / 60) / (now - t0))))));
        }
        requestAnimationFrame(frame);
      }
      function tick() {
        var now = performance.now(), l = Math.max(0, now - last - 100);
        last = now;
        if (document.visibilityState === 'visible' && l > longest) longest = l;
        if (now - start >= 10000) {
          var busy = samples.length ? Math.round(samples.reduce(function (a, b) { return a + b; }, 0) / samples.length) : 0;
          if (busy >= 20 || longest >= 400) {
            try { window.webkit.messageHandlers.trif.postMessage({ type: 'stalls', busy: busy, longest: Math.round(longest), elements: document.getElementsByTagName('*').length }); } catch (e) { /* no app */ }
          }
          start = now; longest = 0; samples = [];
        }
        setTimeout(tick, 100);
      }
      setTimeout(tick, 100);
      setInterval(sample, 5000);
    })();
    """
}

/// The steps of one job and how long each took, logged to the diagnostics as one line (Tim, 11-15: the chat's
/// follow-up took 10 to 15 s on Instagram; these are the numbers from his phone).
@MainActor
final class Stopwatch {
    let name: String
    private let start = Date()
    private var last = Date()
    private var laps: [String] = []
    init(_ name: String) { self.name = name }
    /// The step just finished, with anything worth saying about it (a size).
    func lap(_ step: String, _ note: String = "") {
        let now = Date()
        laps.append("\(step) \(Int(now.timeIntervalSince(last) * 1000)) ms\(note.isEmpty ? "" : " (\(note))")")
        last = now
    }
    var elapsedMs: Int { Int(Date().timeIntervalSince(start) * 1000) }
    func done(_ note: String = "") {
        Diagnostics.shared.log("timing", "\(name): \(laps.joined(separator: ", ")); \(elapsedMs) ms in all\(note.isEmpty ? "" : " (\(note))")")
    }
}


/// Sign-ins kept on disk (11-16). WebKit writes a change to its cookies to disk about ten seconds after it happens
/// (Simulator: not yet after 8 s, done by 11 s), or when the app is suspended. A site that rotates its sign-in cookie
/// on a page load (a new value each time; the old one stops working) and an app ended before then, by a crash or
/// an installer, leaves the old value on disk: signed out at the next launch. Reproduced in the Simulator with a
/// server that rotates its cookie, the app and its WebKit networking process killed together (as on a phone) up to
/// 8 s after a load. So each change is written down at once, a tenth of a second after it, and on leaving the front,
/// with WebKit's own flush (a private call, used only if WebKit has it: checked, never assumed).
/// And, for the sites whose sign-ins Tim lost (x.com, twitter.com, instagram.com, claude.ai, chatgpt.com), the
/// diagnostics name their cookies, with each one's domain and expiry, and what changed during a run: added,
/// removed, or replaced by a new value. Names only: a cookie's value is never logged, only compared, in memory.
@MainActor
final class CookieKeeper: NSObject, WKHTTPCookieStoreObserver {
    static let shared = CookieKeeper()
    static let watched: Set<String> = ["x.com", "twitter.com", "instagram.com", "claude.ai", "chatgpt.com"]
    private var store: WKHTTPCookieStore { WKWebsiteDataStore.default().httpCookieStore }
    private var started = false
    private var pending: Task<Void, Never>?
    /// What the watched sites' cookies were at the last look: name|domain|path -> (a hash of the value, expiry).
    private var last: [String: (value: Int, expires: Date?)]?
    private var firstLoad = true

    func start() {
        guard !started else { return }
        started = true
        // (later: this starts while the diagnostics themselves are starting)
        let how = usesPrivateFlush ? "WebKit's private flush" : "the public route (removing cookies changed since the distant future: none)"
        Task { @MainActor in Diagnostics.shared.log("cookies", "cookies are written down at once with \(how)") }
        store.add(self)
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { CookieKeeper.shared.flush("leaving the front") }
        }
    }

    nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        Task { @MainActor in self.changed() }
    }

    private var flushing: Task<Void, Never>?
    private func changed() {
        // (written down a tenth of a second after a change, several changes at once; looked at a second after)
        if flushing == nil {
            flushing = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 100_000_000)
                self.flushing = nil
                self.flush(nil)
            }
        }
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            await self.diff()
        }
    }

    /// How cookies are written down: WebKit's own private flush when it has one (Tim's choice for now), else a public
    /// call that, in WebKit's current source, ends in the same save: removing cookies changed since the distant future
    /// (none), then saving (undocumented behaviour, not a contract). `-publicflush` forces the public one.
    private static let flushSelector = NSSelectorFromString("_flushCookiesToDiskWithCompletionHandler:")
    var usesPrivateFlush: Bool { !ProcessInfo.processInfo.arguments.contains("-publicflush") && store.responds(to: CookieKeeper.flushSelector) }

    /// WebKit's cookies onto disk now; `done` once written.
    func flush(_ why: String?, done: (@MainActor () -> Void)? = nil) {
        let s = store
        if usesPrivateFlush {
            typealias Flush = @convention(c) (AnyObject, Selector, @convention(block) @escaping () -> Void) -> Void
            let f = unsafeBitCast(s.method(for: CookieKeeper.flushSelector), to: Flush.self)
            f(s, CookieKeeper.flushSelector) { Task { @MainActor in done?() } }
        } else {
            WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantFuture) { Task { @MainActor in done?() } }
        }
    }

    private static func key(_ c: HTTPCookie) -> String { "\(c.name)|\(c.domain)|\(c.path)" }
    private static func watched(_ c: HTTPCookie) -> Bool { watched.contains(Site.of(c.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))) }
    private static func when(_ c: HTTPCookie) -> String {
        guard let d = c.expiresDate else { return "this run only" }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return "until \(f.string(from: d))"
    }

    private func snapshot() async -> [HTTPCookie] { await store.allCookies().filter(CookieKeeper.watched) }

    /// The watched sites' cookies by name, domain and expiry (never a value), for the diagnostics.
    func names(_ when: String) async {
        let list = await snapshot()
        remember(list)
        let bySite = Dictionary(grouping: list) { Site.of($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
        // (a line a site: the log keeps 1500 characters a line)
        if bySite.isEmpty { Diagnostics.shared.log("cookie names", "\(when): none for x.com, twitter.com, instagram.com, claude.ai, chatgpt.com") }
        for site in bySite.keys.sorted() {
            let names = bySite[site]!.sorted { $0.name < $1.name }.map { "\($0.name) (\($0.domain), \(CookieKeeper.when($0)))" }
            Diagnostics.shared.log("cookie names", "\(when), \(site): \(names.joined(separator: ", "))")
        }
    }

    /// The first page load of a launch: the names then too.
    func firstPageLoaded() {
        guard firstLoad else { return }
        firstLoad = false
        Task { @MainActor in await self.names("at the first page load") }
    }

    private func remember(_ list: [HTTPCookie]) {
        last = Dictionary(list.map { (CookieKeeper.key($0), ($0.value.hashValue, $0.expiresDate)) }, uniquingKeysWith: { a, _ in a })
    }

    /// What changed for the watched sites since the last look: added, removed, or replaced (a new value).
    private func diff() async {
        let list = await snapshot()
        guard let before = last else { remember(list); return }
        var lines: [String] = []
        var now: [String: HTTPCookie] = [:]
        for c in list { now[CookieKeeper.key(c)] = c }
        for (k, c) in now {
            if let b = before[k] {
                if b.value != c.value.hashValue { lines.append("replaced \(c.name) (\(c.domain), \(CookieKeeper.when(c)))") }
            } else { lines.append("added \(c.name) (\(c.domain), \(CookieKeeper.when(c)))") }
        }
        for k in before.keys where now[k] == nil {
            let parts = k.split(separator: "|", omittingEmptySubsequences: false)
            lines.append("removed \(parts.first ?? "") (\(parts.count > 1 ? parts[1] : ""))")
        }
        remember(list)
        if !lines.isEmpty { Diagnostics.shared.log("cookie changes", lines.sorted().joined(separator: ", ")) }
    }
}
