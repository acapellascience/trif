// Quick ask (Tim, 11-18: "stay on the page, long-press, say or type what to change, and have it done without fiddling
// with the chat"). The robot's long press opens the chats' list with a box at its top, "What should change?", and a
// microphone to hold. What's asked goes to the tab's chat with the page, as the robot's tap fills it:
//   - Claude or ChatGPT: their message box is filled, and a slim strip of their real page slides up over the tab,
//     the message box and the site's own Send button in it. TRIF never sends there (their terms: no automated
//     access); the person taps Send. Their message appearing is the send (Web/chat.js), then a pill says it's working.
//   - More (TRIF's own API engines, My computer, the model on this iPhone): sent at once, by TRIF's own panel.
// When the reply is done, a look-only mod (a style mod: css, hide, settings; no powers, nothing to approve, only the
// chat's site) is added at once, the pill saying Done · Undo. Anything else gets Add this mod? or the approval card,
// as ever (never skipped), through the done banner's offers: one offer per mod.
// Talking: SpeechInput.swift (on this iPhone only; it listens until the person stops it, and only their stop asks).

import AVFoundation
import Speech
import SwiftUI

/// One quick ask: what was asked, of which chat, and where it is.
struct QuickAsk: Equatable {
    enum State: Equatable {
        /// More: being put in TRIF's own panel, its engine checked first (not working yet).
        case starting
        /// Claude / ChatGPT: filled, waiting for the person's own Send in the strip.
        case waitingSend
        /// Sent: a reply being written.
        case working
        /// Look-only mods added (Undo puts things back as they were).
        case done
        /// A reply with no mod in it.
        case replied
        /// Mods that need Add this mod? or an OK: their card is up (or the done banner holds them).
        case card
        /// Undone.
        case undone
        /// Not sent, or the engine said no at once: what to do, in the app's words (the pill red; its tap: `fix`).
        case failed(String)
    }
    /// Where a red pill's tap goes (Tim, 11-18: "show at once a clear red note that says what to do and links to where
    /// to do it"): More's Settings at the model, the keys, the models on this iPhone or My computer; the pairing
    /// screen; or the chat itself (a sign-in page, the engine's own words).
    enum Fix: Equatable { case chat, settings(String), pair }
    var fix: Fix = .chat
    /// Working, and nothing at all back for a while (no words, no step): the pill turns amber with this; the request
    /// goes on (never cancelled by it).
    var slow: String?
    /// More's engine and model in words (ClaudePane.engineLabel), for the pill while it's put in.
    var engine: String?
    let id = UUID()
    var request: String
    /// Claude, ChatGPT or More.
    var service: String
    var site: String
    /// The chat's link key (ClaudePane.linkKey); More: "More|<site>".
    var key: String
    var state: State
    /// What Done added, for Undo: each mod's id and the version it replaced (nil: it was new).
    var applied: [(id: String, before: InstalledMod?)] = []
    var at = Date()
    static func == (a: QuickAsk, b: QuickAsk) -> Bool { a.id == b.id && a.state == b.state && a.slow == b.slow && a.fix == b.fix && a.applied.map(\.id) == b.applied.map(\.id) }
    /// A quick ask that can't go: the pill red at once, with what to do.
    static func problem(_ request: String, service: String, site: String, key: String, _ why: String, fix: Fix) -> QuickAsk {
        var q = QuickAsk(request: request, service: service, site: site, key: key, state: .failed(why))
        q.fix = fix
        return q
    }
    var failed: Bool { if case .failed = state { return true } else { return false } }

    /// A look-only mod: a style mod (css, hide, settings) with no powers, nothing waiting for an OK, no warnings, and
    /// only the chat's own site. Anything else gets its card. (The shared rule: QuickAskRules.swift.)
    static func lookOnly(_ m: InstalledMod, site: String) -> Bool { QuickAskRules.lookOnly(m.quickFacts, site: site) }
    /// The request, short enough for a pill.
    var short: String { request.count > 38 ? String(request.prefix(36)).trimmingCharacters(in: .whitespaces) + "…" : request }
}

extension InstalledMod {
    /// What quick ask's rules look at (QuickAskRules).
    var quickFacts: QuickAskRules.Facts {
        .init(id: id, tier: tier, powers: powers, held: held, warnings: warnings, everywhere: everywhere, sites: sites)
    }
}

// MARK: the box at the top of the chats' list
// (the microphone itself, SpeechInput, is in SpeechInput.swift)

struct QuickAskBox: View {
    let ask: (String) -> Void
    @ObservedObject private var speech = SpeechInput.shared
    @FocusState private var focused: Bool
    @State private var pressing = false
    @State private var stopPress = false
    @State private var micAway = false

    private var live: Bool { speech.phase == .listening || speech.phase == .finishing }

    private var note: String? {
        switch speech.phase {
        case .refused: return SpeechInput.refusedWords
        case .unavailable(let why): return why
        case .asking: return "Allow TRIF to hear you, then hold the microphone and speak."
        default:
            if let p = speech.getting { return "Getting this iPhone's newer speech recognition ready (\(Int(p * 100))%). Talking works meanwhile." }
            return live ? nil : speech.stoppedNote
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 8) {
                // (while talking: the glowing box with the whole text as it's heard, in place of the field)
                if live { listening } else { field }
                if !live && !speech.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title) }
                        .accessibilityLabel("Ask")
                }
                if speech.tapMode { stopX }
                mic
            }
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .animation(.easeOut(duration: 0.2), value: speech.phase)
        .onAppear { speech.check(); speech.keptFromHold = false }
    }

    private var field: some View {
        TextField("What should change?", text: $speech.draft, axis: .vertical)
            .lineLimit(1...6)
            .submitLabel(.send)
            .focused($focused)
            .onSubmit(send)
            .onChange(of: speech.draft) { _, t in
                // (Return in a field that grows: send, not a new line)
                if t.hasSuffix("\n") { speech.draft = String(t.dropLast()); send() }
            }
            .onChange(of: focused) { _, f in if f { speech.stoppedNote = nil } }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(.tertiarySystemFill)))
    }

    private var listening: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "waveform").foregroundStyle(Color.trifGreen).symbolEffect(.variableColor.iterative, isActive: speech.phase == .listening)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                HeardText(text: speech.transcript, maxHeight: 128)
                // (how it ends: the next tap, or a slide away while held)
                Text(speech.tapMode ? "Listening, tap to stop" : micAway ? "Let go to cancel" : "Slide away to cancel")
                    .font(.caption2).foregroundStyle(micAway && !speech.tapMode ? Color.trifCoral : .secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(.secondarySystemBackground)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.trifGreen.opacity(0.7), lineWidth: 1))
        .shadow(color: Color.trifGreen.opacity(0.55), radius: 8)
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(speech.transcript.isEmpty ? "Listening" : "Heard: \(speech.transcript)")
    }

    /// Hold to talk: pressed, it listens; let go, what was heard is asked; slid well away first, nothing is.
    /// Tapped (under 0.3 s, Tim 11-18): it listens until the next tap (asked) or the ✕ (kept in the box). Nothing
    /// else asks: a call, the app or the list left, an error stop it with every word kept in the box.
    private var mic: some View {
        let off = speech.phase == .refused || speech.phase.isUnavailable
        return Image(systemName: speech.tapMode ? "stop.fill" : live ? "mic.fill" : off ? "mic.slash" : "mic")
            .font(.title3)
            .foregroundStyle(live ? Color.white : off ? Color.secondary : Color.trifGreen)
            .frame(width: 40, height: 40)
            .background(Circle().fill(live ? Color.trifGreen : Color(.tertiarySystemFill)))
            .shadow(color: live ? Color.trifGreen.opacity(0.6) : .clear, radius: 8)
            .contentShape(Circle())
            // (the press's length from the touches' own times, not from when the app got round to them: on Tim's SE,
            // 11-18, the main thread was busy as listening started, the finger's lift came late, and a tap was taken
            // for a hold let go: it listened a moment and stopped with nothing heard)
            .overlay(PressArea(down: micDown, moved: { micAway = $0 > 90 }, up: micUp))
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction {
                if speech.tapMode { speech.release() } else { micDown(); micUp(0, false) }
            }
            .accessibilityLabel(speech.tapMode ? "Stop listening" : "Talk")
            .accessibilityHint(speech.tapMode ? "Asks what was heard" : "Tap, say what should change, then tap again. Or hold, and let go")
    }

    private func micDown() {
        guard !pressing else { return }
        pressing = true
        micAway = false
        // (listening by a tap: this press is the tap that stops it)
        if speech.tapMode { stopPress = true; return }
        focused = false
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        speech.press { words in ask(words) }
    }

    /// `held`: seconds between the finger's touch and its lift, by the touches' times. `cancelled`: iOS took the touch
    /// (the sheet dragged, a call): listening goes on as a tap's would, nothing lost and nothing asked.
    private func micUp(_ held: TimeInterval, _ cancelled: Bool) {
        guard pressing else { return }
        pressing = false
        if stopPress { stopPress = false; if !cancelled { speech.release() }; return }
        guard speech.phase == .listening else { return }
        if held < 0.3 || cancelled { speech.keepListening(held: held) }
        else if micAway { speech.cancel() }
        else { speech.release(held: held) }
    }

    /// (tap-listening: stop without asking, the words kept in the box)
    private var stopX: some View {
        Button { speech.keep() } label: {
            Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
                .frame(width: 32, height: 32).background(Circle().fill(Color(.tertiarySystemFill)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stop without asking")
        .accessibilityHint("Keeps the words in the box")
    }

    private func send() {
        focused = false
        QuickSend.send(ask)
    }
}

/// Sending what's in the box: its arrow, and the list's Send at the top right (Tim, 11-18: "Done" read as cancelling;
/// Send does exactly what the arrow does). While listening by a tap, Send is the stop that asks what was heard.
@MainActor enum QuickSend {
    static func canSend(_ s: SpeechInput) -> Bool {
        switch s.phase {
        case .listening: return s.tapMode && !s.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .finishing: return false
        default: return !s.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
    static func send(_ ask: (String) -> Void) {
        let s = SpeechInput.shared
        if s.phase == .listening { if s.tapMode { s.release() }; return }
        let t = s.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        s.draft = ""
        s.stoppedNote = nil
        ask(t)
    }
}

/// The list's Send (top right): enabled when there's something to send.
struct QuickSendButton: View {
    let ask: (String) -> Void
    @ObservedObject private var speech = SpeechInput.shared
    var body: some View {
        Button("Send") { QuickSend.send(ask) }
            .bold()
            .disabled(!QuickSend.canSend(speech))
            .accessibilityHint("Sends what's in the box")
    }
}

/// The words heard so far, all of them: they grow downwards; past `maxHeight` they scroll, the newest kept in view.
struct HeardText: View {
    let text: String
    let maxHeight: CGFloat
    var body: some View {
        let words = Text(text.isEmpty ? "Listening…" : text).font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
        ViewThatFits(in: .vertical) {
            words
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 0) { words; Color.clear.frame(height: 1).id("end") }
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: text) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
                .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .frame(maxHeight: maxHeight)
    }
}

// MARK: the robot held (Tim, 11-18: "long-press on the robot = hold to talk")

/// Over the toolbar while the robot is held: the glowing pill with the words as they're heard, as the box's
/// microphone shows them, and how to cancel; slid away, how letting go cancels.
struct HoldTalkPill: View {
    @ObservedObject private var speech = SpeechInput.shared
    let away: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: away ? "xmark.circle" : "waveform")
                    .foregroundStyle(away ? Color.trifCoral : Color.trifGreen)
                    .symbolEffect(.variableColor.iterative, isActive: speech.phase == .listening && !away)
                    .padding(.top, 1)
                HeardText(text: speech.transcript, maxHeight: 150)
            }
            Text(away ? "Let go to cancel" : "Slide away to cancel").font(.caption2)
                .foregroundStyle(away ? Color.trifCoral : .secondary)
                .padding(.leading, 26)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.regularMaterial))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder((away ? Color.trifCoral : Color.trifGreen).opacity(0.7), lineWidth: 1))
        .shadow(color: (away ? Color.trifCoral : Color.trifGreen).opacity(0.55), radius: 10)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(speech.transcript.isEmpty ? "Listening" : "Heard: \(speech.transcript)")
    }
}

/// Where KeptTalkPill shows (its own view, so the toolbar's view isn't redrawn with every word heard); it goes by
/// itself after 15 s, the words staying in the box.
struct KeptTalkSlot: View {
    @ObservedObject private var speech = SpeechInput.shared
    let open: () -> Void
    var body: some View {
        if speech.keptFromHold && speech.phase == .idle && !speech.draft.isEmpty {
            KeptTalkPill(open: open)
                .padding(.bottom, 10)
                // (going, it fades where it is: never moved down over the toolbar, where a removal that doesn't finish
                // would take the toolbar's taps, as the robot's pill once did)
                .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .bottom)), removal: .opacity))
                .task {
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    if !Task.isCancelled { withAnimation { speech.keptFromHold = false } }
                }
        }
    }
}

/// The robot's hold stopped by something else (a call, the app left, an error): nothing was asked; the words are in
/// the box. Over the toolbar, the end of them and the note; a tap opens the list with them, the ✕ just closes this.
struct KeptTalkPill: View {
    @ObservedObject private var speech = SpeechInput.shared
    let open: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "mic.slash").foregroundStyle(.secondary).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(speech.draft).font(.footnote).lineLimit(3).truncationMode(.head)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(SpeechInput.keptHoldWords).font(.caption2).foregroundStyle(.secondary)
            }
            Button { speech.keptFromHold = false } label: {
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary).frame(width: 26, height: 26)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.regularMaterial))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.secondary.opacity(0.4), lineWidth: 1))
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .onTapGesture { speech.keptFromHold = false; open() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Listening stopped. Nothing was sent. \(speech.draft)")
        .accessibilityHint("Opens your words in What should change?")
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: the pill above the toolbar

/// "Working: <request>…", then "Done · Undo" (or "Replied"); a tap opens the chat.
struct QuickPill: View {
    let quick: QuickAsk
    /// The strip's chat being filled behind the tab (waitingSend, the strip not in yet).
    var preparing = false
    let open: () -> Void
    let undo: () -> Void
    let dismiss: () -> Void
    /// While it's working: the pill tucked away (its ✕, or a swipe), the work going on; Done · Undo, Replied or a
    /// failure comes back up when it ends (Tim, 11-20: "Working…" lasting the whole run sat over sites' footer menus).
    var tuck: () -> Void = {}

    /// Still under way: what the ✕ and a swipe tuck away rather than end.
    private var underWay: Bool {
        switch quick.state { case .working, .starting, .waitingSend: return true; default: return false }
    }

    var body: some View {
        HStack(spacing: 8) {
            switch quick.state {
            case .working where quick.slow != nil:
                Image(systemName: "clock.badge.exclamationmark").foregroundStyle(Color.orange)
                Text(quick.slow ?? "").lineLimit(2)
            case .working:
                ProgressView().controlSize(.mini)
                Text("Working: \(quick.short)").lineLimit(1)
            case .starting:
                ProgressView().controlSize(.mini)
                Text("Sending to \(quick.engine ?? quick.service)…").lineLimit(1)
            case .done:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.trifGreen)
                Text("Done").lineLimit(1)
                Text("·").foregroundStyle(.secondary)
                Button("Undo", action: undo).bold()
            case .replied:
                ChatGlyph(activity: .replied).frame(width: 16, height: 16).foregroundStyle(Color.trifGreen)
                Text("Replied: \(quick.short)").lineLimit(1)
            case .undone:
                Image(systemName: "arrow.uturn.backward").foregroundStyle(.secondary)
                Text("Undone").lineLimit(1)
            case .failed(let why):
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.red)
                Text(why).lineLimit(2).foregroundStyle(Color.red)
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Color.red.opacity(0.8))
            case .waitingSend where preparing:
                ProgressView().controlSize(.mini)
                Text("Putting it in \(quick.service)…").lineLimit(1)
            case .waitingSend, .card:
                EmptyView()
            }
            if underWay {
                Button(action: tuck) {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        .frame(width: 22, height: 22).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide")
            }
        }
        .font(.footnote)
        .padding(.leading, 14).padding(.trailing, underWay ? 8 : 14).padding(.vertical, 8)
        .background(Capsule().fill(.regularMaterial))
        .overlay(Capsule().strokeBorder(border, lineWidth: quick.failed || quick.slow != nil ? 1.5 : 1))
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        .contentShape(Capsule())
        .onTapGesture(perform: open)
        .gesture(DragGesture(minimumDistance: 12).onEnded { g in if abs(g.translation.height) > 16 || abs(g.translation.width) > 40 { underWay ? tuck() : dismiss() } })
        .accessibilityElement(children: .combine)
        .accessibilityHint(quick.failed ? hint : "Opens the chat")
        .accessibilityAction(named: underWay ? "Hide" : "Close", underWay ? tuck : dismiss)
        .task(id: quick.state) {
            // (Done and Replied go by themselves after 20 s, Undone after 2; Working stays until the reply is done)
            let wait: Double
            switch quick.state {
            case .done, .replied: wait = 20
            case .failed: wait = 30
            case .undone: wait = 2
            default: return
            }
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            if !Task.isCancelled { withAnimation(.easeOut(duration: 0.3)) { dismiss() } }
        }
    }
}

extension QuickPill {
    private var border: Color {
        quick.failed ? Color.red.opacity(0.7) : quick.slow != nil ? Color.orange.opacity(0.7) : Color.trifGreen.opacity(quick.state == .working ? 0.6 : 0.25)
    }
    private var hint: String {
        switch quick.fix {
        case .chat: return "Opens the chat"
        case .settings: return "Opens More's settings"
        case .pair: return "Opens Pair with my computer"
        }
    }
}

/// Over the top of the chat's strip: what to do there (the site's own Send), the full chat, and Cancel.
struct QuickStripHeader: View {
    let service: String
    let expand: () -> Void
    let cancel: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            ChatGlyph(activity: .idle).frame(width: 18, height: 18).foregroundStyle(Color.trifGreen)
            Text("Check it, then tap Send in \(service)").font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            Button(action: expand) { Image(systemName: "arrow.up.left.and.arrow.down.right").font(.footnote.weight(.semibold)).frame(width: 30, height: QuickStrip.header) }
                .accessibilityLabel("Open the whole chat")
            Button(action: cancel) { Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary).frame(width: 30, height: QuickStrip.header) }
                .accessibilityLabel("Cancel")
        }
        .padding(.leading, 14).padding(.trailing, 6)
        .frame(height: QuickStrip.header)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }
}

enum QuickStrip {
    /// The header's height (slim: Tim, 11-18).
    static let header: CGFloat = 34
    /// Room above and below the page's part (the box's text and Send).
    static let pad: CGFloat = 6
    /// The most of their box's text the strip shows (about three or four lines; a longer text scrolls in their box,
    /// its last lines and Send in view). `-stripmax N`.
    static let maxPart: CGFloat = {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-stripmax"), i + 1 < a.count, let n = Double(a[i + 1]) { return CGFloat(n) }
        return 112
    }()
    static let minBody: CGFloat = 44
    /// No message box found in the page: its foot, this tall, as before 11-18 (`-stripheight N`: the whole strip).
    static let noBoxBody: CGFloat = {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-stripheight"), i + 1 < a.count, let n = Double(a[i + 1]) { return CGFloat(n) - header }
        return 230
    }()
}

/// A press measured by its touches' own times (UITouch.timestamp): when the finger went down, how far it moved, how
/// long it was held when it lifted. SwiftUI's gestures say only when the app handled them, which can be much later
/// while the app is busy (the microphone starting). A gesture recognizer that begins at the touch, so the list's
/// scrolling and the sheet's drag don't take the finger away mid-hold (a slide away is the hold's cancel).
struct PressArea: UIViewRepresentable {
    let down: () -> Void
    let moved: (CGFloat) -> Void
    let up: (_ held: TimeInterval, _ cancelled: Bool) -> Void

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        let r = Press(target: context.coordinator, action: #selector(Coordinator.changed(_:)))
        v.addGestureRecognizer(r)
        return v
    }
    func updateUIView(_ v: UIView, context: Context) { context.coordinator.area = self }
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var area: PressArea
        init(_ a: PressArea) { area = a }
        @objc func changed(_ r: Press) {
            switch r.state {
            case .began: area.down()
            case .changed: area.moved(r.distance)
            case .ended: area.up(r.held, false)
            case .cancelled, .failed: area.up(r.held, true)
            default: break
            }
        }
    }

    /// Begins as the finger touches, ends as it lifts; `held` from the touches' timestamps.
    final class Press: UIGestureRecognizer {
        private var began: (time: TimeInterval, at: CGPoint)?
        private(set) var held: TimeInterval = 0
        private(set) var distance: CGFloat = 0

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            guard began == nil, let t = touches.first else { return }
            began = (t.timestamp, t.location(in: view))
            held = 0
            distance = 0
            state = .began
        }
        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
            guard let b = began, let t = touches.first else { return }
            let p = t.location(in: view)
            distance = hypot(p.x - b.at.x, p.y - b.at.y)
            state = .changed
        }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { finish(touches, .ended) }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { finish(touches, .cancelled) }
        private func finish(_ touches: Set<UITouch>, _ s: UIGestureRecognizer.State) {
            guard let b = began else { return }
            held = max(0, (touches.first?.timestamp ?? ProcessInfo.processInfo.systemUptime) - b.time)
            state = s
        }
        override func reset() { super.reset(); began = nil }
        // (nothing else takes this finger: not the list's scrolling, not the sheet's drag)
        override func canBePrevented(by other: UIGestureRecognizer) -> Bool { false }
    }
}
