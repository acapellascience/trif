import SwiftUI
import UIKit

// MARK: taps on the toolbar that do nothing (Tim, 11-18: after a long robot hold and the strip's Send, "all of a
// sudden I can't click any of the menu buttons down below"; minimising the app brought them back)

/// A do-nothing recognizer on each of the app's windows (as TouchWatch on the web views): every touch that reaches
/// a window passes it, whichever view gets it, so a tap on the toolbar that went to something else is seen too.
final class WindowTouchWatch: UIGestureRecognizer, UIGestureRecognizerDelegate {
    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { MainActor.assumeIsolated { ToolbarWatch.shared.saw(touches) } }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { MainActor.assumeIsolated { ToolbarWatch.shared.saw(touches) }; quiet(event) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { MainActor.assumeIsolated { ToolbarWatch.shared.saw(touches) }; quiet(event) }
    private func quiet(_ event: UIEvent) {
        if (event.allTouches ?? []).allSatisfy({ $0.phase == .ended || $0.phase == .cancelled }) { state = .failed }
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}

/// Watches taps on the toolbar's buttons: a short tap on an enabled button whose action didn't run within 0.5 s is
/// logged (Diagnostics "toolbar"): where the touch went (its window and view), the gesture recognizers that had it and
/// their states, and the app's state then (the robot's hold, the strip, covers, the keyboard). At most one line every
/// 10 s, 20 a launch. Costs a rectangle check per touch.
@MainActor
final class ToolbarWatch {
    static let shared = ToolbarWatch()

    /// Each button's frame in the window (SwiftUI's global space) and whether it's enabled; the toolbar's.
    private(set) var slots: [String: (frame: CGRect, enabled: Bool)] = [:]
    var bar: CGRect = .zero
    /// The app's state for the line (ContentView's: the robot's hold, the strip, covers, the keyboard).
    var state: () -> String = { "" }
    /// When a toolbar button's action last ran (systemUptime, as UITouch.timestamp).
    private var lastFired: TimeInterval = 0
    private struct Down { var at: TimeInterval; var start: CGPoint; var slot: String; var went: String; var lastPhase: String }
    private var downs: [ObjectIdentifier: Down] = [:]
    private var lastLog: TimeInterval = -100
    private var logged = 0
    /// (development: the lines it would log, kept even past the limits, for the toolbarwatch step)
    private(set) var recent: [String] = []

    func place(_ name: String, _ frame: CGRect, enabled: Bool) { slots[name] = (frame, enabled); watchWindows() }

    /// Every window of the app's scenes gets a WindowTouchWatch (once each; windows come and go with sheets and alerts).
    func watchWindows() {
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            for w in ws.windows where !(w.gestureRecognizers ?? []).contains(where: { $0 is WindowTouchWatch }) {
                w.addGestureRecognizer(WindowTouchWatch())
            }
        }
    }
    func enable(_ name: String, _ on: Bool) { slots[name]?.enabled = on }

    /// A toolbar button's action ran.
    func fired(_ name: String) { lastFired = ProcessInfo.processInfo.systemUptime }

    /// (development: the last touches seen, for the toolbarwatch step)
    private(set) var seen: [String] = []

    func saw(_ touches: Set<UITouch>) {
        for t in touches {
            let id = ObjectIdentifier(t)
            #if DEBUG
            if t.phase == .began || t.phase == .ended || t.phase == .cancelled {
                let p = t.location(in: t.window)
                seen.append("\(t.phase == .began ? "began" : t.phase == .ended ? "ended" : "cancelled") \(Int(p.x)),\(Int(p.y)) \(ToolbarWatch.went(t))\(t.phase == .began ? "" : "; " + ToolbarWatch.recognizers(t))")
                if seen.count > 12 { seen.removeFirst() }
            }
            #endif
            switch t.phase {
            case .began:
                guard bar.width > 0, let w = t.window else { continue }
                let p = t.location(in: w)
                guard bar.contains(p), let slot = slots.first(where: { $0.value.frame.insetBy(dx: -2, dy: -6).contains(p) }) else { continue }
                downs[id] = Down(at: t.timestamp, start: p, slot: slot.key, went: ToolbarWatch.went(t), lastPhase: "began")
            case .ended, .cancelled:
                guard let d = downs.removeValue(forKey: id) else { continue }
                let p = t.location(in: t.window)
                let moved = hypot(p.x - d.start.x, p.y - d.start.y)
                let held = t.timestamp - d.at
                guard held < 0.8, moved < 14 else { continue }
                let cancelled = t.phase == .cancelled
                let recognizers = ToolbarWatch.recognizers(t)
                let began = d.at
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    guard let self, self.lastFired < began, self.slots[d.slot]?.enabled != false else { return }
                    self.report(d, cancelled: cancelled, held: held, recognizers: recognizers)
                }
            default: continue
            }
        }
        // (touches that never end: UIKit drops them on a scene reset; no build-up)
        if downs.count > 20 { downs.removeAll() }
    }

    private func report(_ d: Down, cancelled: Bool, held: TimeInterval, recognizers: String) {
        let line = "a tap on \(d.slot) did nothing\(cancelled ? " (the touch was cancelled)" : "") (held \(Int(held * 1000)) ms): the touch went to \(d.went); recognizers: \(recognizers); still going in the windows: \(ToolbarWatch.busy()); \(state())"
        recent.append(line)
        if recent.count > 10 { recent.removeFirst() }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastLog >= 10, logged < 20 else { return }
        lastLog = now
        logged += 1
        Diagnostics.shared.log("toolbar", line)
    }

    /// Gesture recognizers in the app's windows that are in the middle of a gesture (began or changed) now: one left
    /// there after its finger lifted keeps taps from the others. Views a few levels deep (where SwiftUI's are).
    static func busy() -> String {
        var found: [String] = []
        func scan(_ v: UIView, _ depth: Int) {
            for g in v.gestureRecognizers ?? [] where g.state == .began || g.state == .changed {
                found.append("\(short(g))@\(short(v)) \(stateWords(g.state))")
            }
            if depth < 7, found.count < 8 { for s in v.subviews { scan(s, depth + 1) } }
        }
        for scene in UIApplication.shared.connectedScenes {
            for w in (scene as? UIWindowScene)?.windows ?? [] { scan(w, 0) }
        }
        return found.isEmpty ? "none" : found.joined(separator: ", ")
    }

    /// The window and the view the touch went to, and the view's first few superviews.
    private static func went(_ t: UITouch) -> String {
        var chain: [String] = []
        var v = t.view
        while let x = v, chain.count < 5 { chain.append(short(x)); v = x.superview }
        let w = t.window.map { "\(short($0)) level \(Int($0.windowLevel.rawValue))\($0.isKeyWindow ? " key" : "")" } ?? "no window"
        return "\(w) → \(chain.isEmpty ? "no view" : chain.joined(separator: " < "))"
    }

    /// The recognizers that had the touch, with their states (UIKit's own list for this touch).
    private static func recognizers(_ t: UITouch) -> String {
        let list = (t.gestureRecognizers ?? []).map { g in "\(short(g))@\(g.view.map(short) ?? "-") \(stateWords(g.state))\(g.isEnabled ? "" : " off")" }
        return list.isEmpty ? "none" : list.joined(separator: ", ")
    }

    private static func stateWords(_ s: UIGestureRecognizer.State) -> String {
        switch s {
        case .possible: return "possible"
        case .began: return "began"
        case .changed: return "changed"
        case .ended: return "ended"
        case .cancelled: return "cancelled"
        case .failed: return "failed"
        @unknown default: return "?"
        }
    }

    /// A type's name without SwiftUI's long generic parameters.
    private static func short(_ o: AnyObject) -> String {
        let n = String(describing: type(of: o))
        if let i = n.firstIndex(of: "<") { return String(n[..<i]) }
        return n
    }
}


/// A toolbar button's place and whether it's enabled, for ToolbarWatch.
struct WatchSlot: ViewModifier {
    let name: String
    let enabled: Bool
    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { ToolbarWatch.shared.place(name, $0, enabled: enabled) }
            .onChange(of: enabled, initial: true) { _, on in ToolbarWatch.shared.enable(name, on) }
    }
}
