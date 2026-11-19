// A short line in front of whatever shows (Tim, 11-18: "some kind of visible 'successfully synced' message"): a
// pill near the top of the screen for a few seconds, in a window of its own over the app's (sheets too), that takes
// no touches, so nothing under it moves or stops working. Only while the app is in front: no notification, no sound.
// Used for a sync with the computer (PhoneSyncModel) and for safe mode's switches put back (Safety.swift).
// Every word is a draft in docs/IOS-APP-STRINGS.md.

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
    private var window: UIWindow?
    private var hide: DispatchWorkItem?

    /// Shows `text` for `seconds` (a newer one replaces it). Nothing while the app isn't in front.
    func show(_ text: String, problem: Bool = false, seconds: Double = 4) {
        guard UIApplication.shared.applicationState == .active,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) else {
            shown = Array((shown + ["(not shown, the app not in front) \(text)"]).suffix(10))
            return
        }
        let w = window ?? {
            let w = UIWindow(windowScene: scene)
            // (over the app and its sheets, under the leaving cover at .alert + 1)
            w.windowLevel = .alert
            w.isUserInteractionEnabled = false
            w.backgroundColor = .clear
            let host = UIHostingController(rootView: ToastHost(toast: self))
            host.view.backgroundColor = .clear
            w.rootViewController = host
            window = w
            return w
        }()
        w.isHidden = false
        withAnimation(.easeOut(duration: 0.25)) { item = Item(text: text, problem: problem) }
        shown = Array((shown + [text]).suffix(10))
        UIAccessibility.post(notification: .announcement, argument: text)
        hide?.cancel()
        let h = DispatchWorkItem { [weak self] in
            guard let self else { return }
            withAnimation(.easeIn(duration: 0.3)) { self.item = nil }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in if self?.item == nil { self?.window?.isHidden = true } }
        }
        hide = h
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: h)
    }

    var describe: String { "now: \(item.map { "\($0.problem ? "problem: " : "")\($0.text)" } ?? "none"); shown: \(shown)" }
}

private struct ToastHost: View {
    @ObservedObject var toast: AppToast

    var body: some View {
        VStack {
            if let t = toast.item {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: t.problem ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(t.problem ? Color.red : Color.trifGreen)
                    Text(t.text)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.footnote)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.regularMaterial))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 1))
                .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
                .id(t.id)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
    }
}
