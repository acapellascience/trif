import Foundation
import JavaScriptCore

/// The phone apps' shared rules: mobile/shared/core/*.js, made into gen/core.js (the global TrifCore) by
/// mobile/prepare.js. Android runs the same file, so a rule changed there changes on both phones
/// (docs/MOBILE-BEHAVIOUR.md). One JavaScriptCore context, made at the first call; any thread, one call at a time.
/// No UI: the Mac checks build it too (they point `source` at the repository's file).
final class Core: @unchecked Sendable {
    static let shared = Core()
    /// core.js: the app's bundle (the Mac checks set the repository's)
    nonisolated(unsafe) static var source: URL? = Bundle.main.url(forResource: "core", withExtension: "js")
    /// where a failure is told (the app: Diagnostics), once per rule
    nonisolated(unsafe) static var report: (String) -> Void = { _ in }

    private let lock = NSLock()
    private var context: JSContext?
    private var entry: JSValue?
    private var told: Set<String> = []

    /// TrifCore.call("module.fn", args): the answer decoded from JSON (a String, NSNumber, [String: Any]…), or nil if
    /// the rule couldn't answer (then the caller's safe answer stands, and the failure is told once).
    func call(_ name: String, _ args: [Any?]) -> Any? {
        lock.lock(); defer { lock.unlock() }
        if entry == nil { load() }
        let plain = args.map { $0 ?? NSNull() }
        guard let f = entry,
              let data = try? JSONSerialization.data(withJSONObject: plain, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { fail(name, "not loaded"); return nil }
        context?.exception = nil
        guard let r = f.call(withArguments: [name, json]), r.isString, let s = r.toString(), let d = s.data(using: .utf8) else {
            fail(name, context?.exception?.toString() ?? "no answer")
            return nil
        }
        return try? JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed])
    }

    private func load() {
        guard let url = Core.source, let src = try? String(contentsOf: url, encoding: .utf8), let c = JSContext() else { return }
        c.evaluateScript(src, withSourceURL: url)
        let f = c.objectForKeyedSubscript("TrifCore")?.objectForKeyedSubscript("call")
        if let f, !f.isUndefined { context = c; entry = f }
    }

    private func fail(_ name: String, _ why: String) {
        guard !told.contains(name) else { return }
        told.insert(name)
        Core.report("the shared rule \(name) didn't answer: \(why)")
    }
}
