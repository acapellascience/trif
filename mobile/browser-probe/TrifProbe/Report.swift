// What the probe has found, kept between launches, and the text you send back.

import Foundation
import UIKit

struct CheckResult: Codable, Identifiable {
    let id: String
    let group: String
    let title: String
    let answer: String   // yes, no, some, info or error
    let detail: String   // a line of text, or JSON
    let ms: Int
}

struct CheckRun: Codable, Identifiable {
    var id = UUID()
    let at: Date
    let url: String
    let results: [CheckResult]
}

/// Something that happened on its own: a page load's timing, something hidden, a mod link, a step in Claude's pane.
struct LogEvent: Codable, Identifiable {
    var id = UUID()
    let at: Date
    let kind: String
    let text: String
}

struct HideRule: Codable, Identifiable {
    var id = UUID()
    let host: String
    let selector: String
    let how: String      // what kind of name the selector leans on: id, class, position…
    let from: String     // pointing, a mod link, the on-device model, pasted
    let at: Date
}

@MainActor
final class Report: ObservableObject {
    @Published private(set) var runs: [CheckRun] = []
    @Published private(set) var events: [LogEvent] = []
    @Published private(set) var rules: [HideRule] = []

    private struct Saved: Codable {
        var runs: [CheckRun]
        var events: [LogEvent]
        var rules: [HideRule]
    }
    private struct Export: Codable {
        let probe: String
        let made: Date
        let device: String
        let system: String
        let onDeviceModel: String
        let runs: [CheckRun]
        let events: [LogEvent]
        let rules: [HideRule]
    }
    private static let key = "trif-probe-report"

    /// Kept in Application Support/report.json, written a moment after a change, off the main thread (it was in the
    /// app's settings, rewritten whole on every page load: 11-15).
    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("report.json")
    }
    private static let queue = DispatchQueue(label: "trif.report", qos: .utility)
    private var saveTask: Task<Void, Never>?

    init() {
        let data = (try? Data(contentsOf: Report.file)) ?? UserDefaults.standard.data(forKey: Report.key)
        if let data, let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            runs = saved.runs
            events = saved.events
            rules = saved.rules
        }
        if UserDefaults.standard.data(forKey: Report.key) != nil {
            UserDefaults.standard.removeObject(forKey: Report.key)
            save()
        }
    }

    private func save() {
        let saved = Saved(runs: runs, events: events, rules: rules)
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            Report.queue.async { if let data = try? JSONEncoder().encode(saved) { try? data.write(to: Report.file, options: .atomic) } }
        }
    }

    func add(_ run: CheckRun) {
        runs.append(run)
        if runs.count > 30 { runs.removeFirst(runs.count - 30) }
        save()
    }

    func log(_ kind: String, _ text: String) {
        events.append(LogEvent(at: Date(), kind: kind, text: String(text.prefix(4000))))
        if events.count > 300 { events.removeFirst(events.count - 300) }
        save()
    }

    func add(_ rule: HideRule) {
        rules.removeAll { $0.host == rule.host && $0.selector == rule.selector }
        rules.append(rule)
        save()
    }

    func remove(_ rule: HideRule) {
        rules.removeAll { $0.id == rule.id }
        save()
    }

    func forgetRules(for host: String) {
        rules.removeAll { $0.host == host }
        save()
    }

    func clear() {
        runs = []
        events = []
        rules = []
        save()
    }

    /// The hide rules as { host: [selector] }, as JSON text (what the start script is given).
    func rulesJSON() -> String {
        var byHost: [String: [String]] = [:]
        for r in rules { byHost[r.host, default: []].append(r.selector) }
        guard let data = try? JSONSerialization.data(withJSONObject: byHost), let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }

    static func deviceName() -> String {
        var sys = utsname()
        uname(&sys)
        return withUnsafePointer(to: &sys.machine) { p in
            p.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
    }

    func json() -> String {
        let export = Export(probe: "browser", made: Date(), device: Report.deviceName(),
                            system: "iOS \(UIDevice.current.systemVersion)", onDeviceModel: OnDevice.availability(),
                            runs: runs, events: events, rules: rules)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(export), let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }
}
