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
