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

    init() {
        if let data = UserDefaults.standard.data(forKey: Report.key), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            runs = saved.runs
            events = saved.events
            rules = saved.rules
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Saved(runs: runs, events: events, rules: rules)) {
            UserDefaults.standard.set(data, forKey: Report.key)
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
