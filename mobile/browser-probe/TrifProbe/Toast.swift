// A short line in front of whatever shows (Tim, 11-18: "some kind of visible 'successfully synced' message"; 11-19:
// "they need to be able to be swiped up and away when they do appear, or they need to appear much less
// obtrusively"): a small one-line pill in the status bar's strip, over the clock and battery and never over the
// app's own bars, for 2.5 s (3.5 s for a problem), in a window of its own over the app's (sheets too). A swipe up or a
// tap puts it away at once; the window takes touches on the pill alone, so nothing else under it stops working.
// Only while the app is in front: no notification, no sound. Used after a sync the person started (PhoneSyncModel)
// and for safe mode's switches put back (Safety.swift). Every word is a draft in docs/IOS-APP-STRINGS.md.
//
// `ToastPill` is the pill's rules (its place, its time, what puts it away), Foundation only, so the Mac check
// (mobile/test/phonelink-check) tests them.

import Foundation

enum ToastPill {
    /// How long it shows.
    static let seconds = 2.5
    static let problemSeconds = 3.5
    static func seconds(problem: Bool) -> Double { problem ? problemSeconds : seconds }

    /// Its place, in points from the window's top: inside the status bar's strip (the window's top safe area; 20 pt
    /// when the status bar is hidden), so never over the app's top bar or a sheet's. iPhone SE (a 20 pt strip): 18 pt
    /// high, 1 pt down. A taller strip (Face ID phones): 22 pt high at the strip's foot.
    static func place(safeTop: Double) -> (top: Double, height: Double) {
        let strip = max(safeTop, 20)
        let h = min(22, max(16, strip - 2))
        return (max(1, strip - h - 1), h)
    }

    /// A drag on it that ends here puts it away: up past 10 pt, or flung up.
    static func dismisses(dragY: Double, predictedY: Double) -> Bool { dragY < -10 || predictedY < -30 }

    /// How far it follows a drag: up as far as the finger goes, down a little and no more.
    static func follow(_ dragY: Double) -> Double { dragY < 0 ? dragY : min(dragY * 0.2, 4) }
}

#if canImport(UIKit)
import SwiftUI
import UIKit

@MainActor
final class AppToast: ObservableObject {
    static let shared = AppToast()

    struct Item: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let problem: Bool
    }
    @Published private(set) var item: Item?
    /// (development: the last ones shown, newest last, for the `toast` step)
    private(set) var shown: [String] = []
    private var window: PillWindow?
    private var hide: DispatchWorkItem?

    /// Shows `text` (a newer one replaces it) for ToastPill's time, or `seconds`. Nothing while the app isn't in front.
    func show(_ text: String, problem: Bool = false, seconds: Double? = nil) {
        guard UIApplication.shared.applicationState == .active,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) else {
            shown = Array((shown + ["(not shown, the app not in front) \(text)"]).suffix(10))
            return
        }
        let w = window ?? {
            let w = PillWindow(windowScene: scene)
            // (over the app and its sheets, under the leaving cover at .alert + 1)
            w.windowLevel = .alert
            w.backgroundColor = .clear
            let host = UIHostingController(rootView: ToastHost(toast: self, window: w))
            host.view.backgroundColor = .clear
            w.rootViewController = host
            window = w
            return w
        }()
        w.isHidden = false
        withAnimation(.easeOut(duration: 0.2)) { item = Item(text: text, problem: problem) }
        shown = Array((shown + [text]).suffix(10))
        UIAccessibility.post(notification: .announcement, argument: text)
        hide?.cancel()
        let h = DispatchWorkItem { [weak self] in self?.dismiss() }
        hide = h
        DispatchQueue.main.asyncAfter(deadline: .now() + (seconds ?? ToastPill.seconds(problem: problem)), execute: h)
    }

    /// Away now (its time is up, a swipe up, a tap).
    func dismiss() {
        hide?.cancel(); hide = nil
        guard item != nil else { return }
        withAnimation(.easeIn(duration: 0.2)) { item = nil }
        window?.pill = .null
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in if self?.item == nil { self?.window?.isHidden = true } }
    }

    var describe: String {
        "now: \(item.map { "\($0.problem ? "problem: " : "")\($0.text)" } ?? "none"); shown: \(shown); pill \(window.map { NSCoder.string(for: $0.pill) } ?? "none")"
    }
}

/// The toast's window: a touch lands on it only on the pill (its frame as last laid out); anywhere else it falls
/// through to the app's window below.
final class PillWindow: UIWindow {
    var pill: CGRect = .null
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        !pill.isNull && pill.insetBy(dx: -4, dy: 0).contains(point)
    }
}

private struct ToastHost: View {
    @ObservedObject var toast: AppToast
    weak var window: PillWindow?
    @State private var drag: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let place = ToastPill.place(safeTop: Double(geo.safeAreaInsets.top))
            VStack(spacing: 0) {
                if let t = toast.item {
                    HStack(spacing: 5) {
                        Image(systemName: t.problem ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(t.problem ? Color.red : Color.trifGreen)
                        Text(t.text)
                            .font(.caption2.weight(.medium))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .minimumScaleFactor(0.85)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: place.height)
                    .background(Capsule(style: .continuous).fill(.regularMaterial))
                    .overlay(Capsule(style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                    .contentShape(Capsule())
                    .background(GeometryReader { g in
                        Color.clear.onAppear { window?.pill = g.frame(in: .global) }
                            .onChange(of: g.frame(in: .global)) { _, f in window?.pill = f }
                    })
                    .offset(y: ToastPill.follow(Double(drag)))
                    .opacity(drag < 0 ? max(0.2, 1 + Double(drag) / 40) : 1)
                    .onTapGesture { toast.dismiss() }
                    .gesture(DragGesture(minimumDistance: 4, coordinateSpace: .global)
                        .onChanged { drag = $0.translation.height }
                        .onEnded { v in
                            if ToastPill.dismisses(dragY: Double(v.translation.height), predictedY: Double(v.predictedEndTranslation.height)) { toast.dismiss() }
                            withAnimation(.easeOut(duration: 0.15)) { drag = 0 }
                        })
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { toast.dismiss() }
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .id(t.id)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, place.top)
            .frame(maxWidth: .infinity)
            .ignoresSafeArea(edges: .top)
        }
    }
}
#endif
