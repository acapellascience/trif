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
// Hold-to-talk: iOS's Speech framework, on this iPhone only (requiresOnDeviceRecognition); where the iPhone can't
// recognise speech itself, the microphone says so and nothing is recorded.

import AVFoundation
import Speech
import SwiftUI

/// One quick ask: what was asked, of which chat, and where it is.
struct QuickAsk: Equatable {
    enum State: Equatable {
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
        /// Not sent (More couldn't take it): why, in the app's words.
        case failed(String)
    }
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
    static func == (a: QuickAsk, b: QuickAsk) -> Bool { a.id == b.id && a.state == b.state && a.applied.map(\.id) == b.applied.map(\.id) }

    /// A look-only mod: a style mod (css, hide, settings) with no powers, nothing waiting for an OK, no warnings, and
    /// only the chat's own site. Anything else gets its card.
    static func lookOnly(_ m: InstalledMod, site: String) -> Bool {
        m.tier == "style" && m.powers.isEmpty && !m.held && m.warnings.isEmpty && !m.everywhere && !site.isEmpty
            && !m.sites.isEmpty && m.sites.allSatisfy { Site.of($0) == site }
    }
    /// The request, short enough for a pill.
    var short: String { request.count > 38 ? String(request.prefix(36)).trimmingCharacters(in: .whitespaces) + "…" : request }
}

// MARK: hold-to-talk

/// The microphone held in the quick ask's box: what's said, as text, live, recognised on this iPhone only.
@MainActor
final class SpeechInput: ObservableObject {
    static let shared = SpeechInput()
    enum Phase: Equatable { case idle, asking, listening, finishing, refused, unavailable(String) }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var transcript = ""
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var finished: ((String) -> Void)?
    private var finishing: Task<Void, Never>?

    /// The phone's language's recognizer (English if it has none).
    static func recognizer() -> SFSpeechRecognizer? { SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")) }
    /// The language's name, for "not on this iPhone".
    static var language: String { Locale.current.localizedString(forIdentifier: (recognizer()?.locale ?? Locale.current).identifier) ?? "this language" }
    static let notOnDevice = "This iPhone can't recognise speech in \(language) by itself, so TRIF doesn't listen. Type instead, or use the keyboard's dictation."
    static let refusedWords = "TRIF can't hear you: allow the Microphone and Speech Recognition for TRIF Probe in Settings. You can still type."

    /// Whether talking can work here at all, as far as is known without asking: refused, not on this iPhone, or fine.
    func check() {
        if SFSpeechRecognizer.authorizationStatus() == .denied || SFSpeechRecognizer.authorizationStatus() == .restricted
            || AVAudioApplication.shared.recordPermission == .denied { phase = .refused; return }
        if let r = SpeechInput.recognizer(), !r.supportsOnDeviceRecognition { phase = .unavailable(SpeechInput.notOnDevice); return }
        if phase == .refused || phase.isUnavailable { phase = .idle }
    }

    /// The microphone pressed: listening starts (permissions asked for the first time instead; refused, or no
    /// recognition on this iPhone: nothing recorded, the reason shown). `done`: the words when it's let go.
    func press(_ done: @escaping (String) -> Void) {
        guard phase == .idle else { return }
        let speech = SFSpeechRecognizer.authorizationStatus()
        let mic = AVAudioApplication.shared.recordPermission
        if speech == .denied || speech == .restricted || mic == .denied { phase = .refused; Diagnostics.shared.log("quick ask", "talking: refused (speech \(speech.rawValue), microphone \(mic.rawValue))"); return }
        guard let r = SpeechInput.recognizer() else { phase = .unavailable(SpeechInput.notOnDevice); return }
        // (never to a server: only where this iPhone recognises speech itself)
        guard r.supportsOnDeviceRecognition else { phase = .unavailable(SpeechInput.notOnDevice); Diagnostics.shared.log("quick ask", "talking: no on-device recognition for \(r.locale.identifier)"); return }
        if speech == .notDetermined || mic == .undetermined {
            phase = .asking
            SFSpeechRecognizer.requestAuthorization { s in
                AVAudioApplication.requestRecordPermission { ok in
                    Task { @MainActor in
                        let granted = s == .authorized && ok
                        self.phase = granted ? .idle : .refused
                        Diagnostics.shared.log("quick ask", "talking: speech recognition \(s == .authorized ? "allowed" : "not allowed"), microphone \(ok ? "allowed" : "not allowed")")
                    }
                }
            }
            return
        }
        guard r.isAvailable else { phase = .unavailable("Speech recognition isn't available right now. Type instead."); return }
        start(r, done)
    }

    private func start(_ r: SFSpeechRecognizer, _ done: @escaping (String) -> Void) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            phase = .unavailable("The microphone can't be used right now. Type instead.")
            Diagnostics.shared.log("quick ask", "talking: the audio session wouldn't start (\(error.localizedDescription))")
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        req.addsPunctuation = true
        request = req
        transcript = ""
        finished = done
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { phase = .unavailable("This iPhone has no microphone to use. Type instead."); restoreSession(); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
        task = r.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal ?? false
            Task { @MainActor in
                guard let self else { return }
                if let text { self.transcript = text }
                if final || error != nil { self.end() }
            }
        }
        engine.prepare()
        do { try engine.start() } catch {
            input.removeTap(onBus: 0)
            task?.cancel()
            phase = .unavailable("The microphone can't be used right now. Type instead.")
            restoreSession()
            return
        }
        phase = .listening
        Diagnostics.shared.log("quick ask", "talking: listening (on this iPhone, \(r.locale.identifier))")
    }

    /// Let go: the words so far are the request (the last of them given a moment to come in).
    func release() {
        guard phase == .listening else { return }
        phase = .finishing
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        finishing = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            self?.end()
        }
    }

    private func end() {
        guard phase == .listening || phase == .finishing else { return }
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        finishing?.cancel()
        task?.cancel()
        task = nil
        request = nil
        restoreSession()
        phase = .idle
        let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = ""
        let done = finished
        finished = nil
        Diagnostics.shared.log("quick ask", "talking: let go, \(words.isEmpty ? "nothing heard" : "\(words.count) characters heard")")
        if !words.isEmpty { done?(words) }
    }

    /// The app's own audio session again (playback, so pages' sound goes on in the background: BackgroundPlay).
    private func restoreSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        if !ProcessInfo.processInfo.arguments.contains("-noaudiosession") { try? session.setCategory(.playback, mode: .moviePlayback) }
    }

    /// (development) The same recognizer on a recorded file (SFSpeechURLRecognitionRequest): what it hears, and how.
    func recognize(file: URL) async -> String {
        let status = SFSpeechRecognizer.authorizationStatus()
        if status == .notDetermined {
            _ = await withCheckedContinuation { (k: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in SFSpeechRecognizer.requestAuthorization { k.resume(returning: $0) } }
        }
        let now = SFSpeechRecognizer.authorizationStatus()
        guard now == .authorized else { return "speech recognition not allowed (\(now.rawValue))" }
        guard let r = SpeechInput.recognizer() else { return "no recognizer" }
        let on = r.supportsOnDeviceRecognition
        guard on else { return "\(r.locale.identifier): no on-device recognition here, so TRIF wouldn't listen (the microphone says so)" }
        let req = SFSpeechURLRecognitionRequest(url: file)
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        var partials = 0
        return await withCheckedContinuation { (k: CheckedContinuation<String, Never>) in
            var said = false
            r.recognitionTask(with: req) { result, error in
                if result != nil, result?.isFinal == false { partials += 1 }
                guard !said else { return }
                if let result, result.isFinal { said = true; k.resume(returning: "heard (on device, \(r.locale.identifier), \(partials) partial results): \(result.bestTranscription.formattedString)") }
                else if let error { said = true; k.resume(returning: "error: \(error.localizedDescription)") }
            }
        }
    }

    var describe: String {
        "phase \(phase), speech \(SFSpeechRecognizer.authorizationStatus().rawValue) (0 not asked, 1 denied, 2 restricted, 3 allowed), microphone \(AVAudioApplication.shared.recordPermission == .denied ? "denied" : AVAudioApplication.shared.recordPermission == .granted ? "allowed" : "not asked"), on-device \(SpeechInput.recognizer()?.supportsOnDeviceRecognition ?? false) (\(SpeechInput.recognizer()?.locale.identifier ?? "-"))"
    }
}

extension SpeechInput.Phase {
    var isUnavailable: Bool { if case .unavailable = self { return true } else { return false } }
}

// MARK: the box at the top of the chats' list

struct QuickAskBox: View {
    let ask: (String) -> Void
    @ObservedObject private var speech = SpeechInput.shared
    @State private var text = ""
    @FocusState private var focused: Bool
    @State private var pressing = false

    private var note: String? {
        switch speech.phase {
        case .refused: return SpeechInput.refusedWords
        case .unavailable(let why): return why
        case .asking: return "Allow TRIF to hear you, then hold the microphone and speak."
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // (while talking: a small glowing pill with the words as they're heard)
            if speech.phase == .listening || speech.phase == .finishing {
                HStack(spacing: 8) {
                    Image(systemName: "waveform").foregroundStyle(Color.trifGreen).symbolEffect(.variableColor.iterative, isActive: speech.phase == .listening)
                    Text(speech.transcript.isEmpty ? "Listening…" : speech.transcript)
                        .font(.footnote).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Capsule().fill(Color(.secondarySystemBackground)))
                .overlay(Capsule().strokeBorder(Color.trifGreen.opacity(0.7), lineWidth: 1))
                .shadow(color: Color.trifGreen.opacity(0.55), radius: 8)
                .transition(.opacity.combined(with: .scale(scale: 0.95)))
                .accessibilityLabel(speech.transcript.isEmpty ? "Listening" : "Heard: \(speech.transcript)")
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("What should change?", text: $text, axis: .vertical)
                    .lineLimit(1...4)
                    .submitLabel(.send)
                    .focused($focused)
                    .onSubmit(send)
                    .onChange(of: text) { _, t in
                        // (Return in a field that grows: send, not a new line)
                        if t.hasSuffix("\n") { text = String(t.dropLast()); send() }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(.tertiarySystemFill)))
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title) }
                        .accessibilityLabel("Ask")
                }
                mic
            }
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .animation(.easeOut(duration: 0.2), value: speech.phase)
        .onAppear { speech.check() }
    }

    /// Hold to talk: pressed, it listens; let go, what was heard is asked.
    private var mic: some View {
        let live = speech.phase == .listening || speech.phase == .finishing
        let off = speech.phase == .refused || speech.phase.isUnavailable
        return Image(systemName: live ? "mic.fill" : off ? "mic.slash" : "mic")
            .font(.title3)
            .foregroundStyle(live ? Color.white : off ? Color.secondary : Color.trifGreen)
            .frame(width: 40, height: 40)
            .background(Circle().fill(live ? Color.trifGreen : Color(.tertiarySystemFill)))
            .shadow(color: live ? Color.trifGreen.opacity(0.6) : .clear, radius: 8)
            .contentShape(Circle())
            .onLongPressGesture(minimumDuration: 0.05, maximumDistance: 300, perform: {}, onPressingChanged: { down in
                if down {
                    guard !pressing else { return }
                    pressing = true
                    focused = false
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    speech.press { words in ask(words) }
                } else {
                    pressing = false
                    speech.release()
                }
            })
            .accessibilityLabel("Hold to talk")
            .accessibilityHint("Hold, say what should change, then let go")
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        text = ""
        focused = false
        ask(t)
    }
}

// MARK: the pill above the toolbar

/// "Working: <request>…", then "Done · Undo" (or "Replied"); a tap opens the chat.
struct QuickPill: View {
    let quick: QuickAsk
    let open: () -> Void
    let undo: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            switch quick.state {
            case .working:
                ProgressView().controlSize(.mini)
                Text("Working: \(quick.short)").lineLimit(1)
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
                Image(systemName: "exclamationmark.circle").foregroundStyle(Color.trifCoral)
                Text(why).lineLimit(2)
            case .waitingSend, .card:
                EmptyView()
            }
        }
        .font(.footnote)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Capsule().fill(.regularMaterial))
        .overlay(Capsule().strokeBorder(Color.trifGreen.opacity(quick.state == .working ? 0.6 : 0.25), lineWidth: 1))
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        .contentShape(Capsule())
        .onTapGesture(perform: open)
        .gesture(DragGesture(minimumDistance: 12).onEnded { g in if abs(g.translation.height) > 16 || abs(g.translation.width) > 40 { dismiss() } })
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the chat")
        .accessibilityAction(named: "Close", dismiss)
        .task(id: quick.state) {
            // (Done and Replied go by themselves after 20 s, Undone after 2; Working stays until the reply is done)
            let wait: Double
            switch quick.state {
            case .done, .replied, .failed: wait = 20
            case .undone: wait = 2
            default: return
            }
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            if !Task.isCancelled { withAnimation(.easeOut(duration: 0.3)) { dismiss() } }
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
            Button(action: expand) { Image(systemName: "arrow.up.left.and.arrow.down.right").font(.footnote.weight(.semibold)).frame(width: 30, height: 30) }
                .accessibilityLabel("Open the whole chat")
            Button(action: cancel) { Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary).frame(width: 30, height: 30) }
                .accessibilityLabel("Cancel")
        }
        .padding(.leading, 14).padding(.trailing, 6)
        .frame(height: QuickStrip.header)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }
}

enum QuickStrip {
    /// The strip's height (the header and the bottom of the chat's page: its message box and Send). `-stripheight N`.
    static let height: CGFloat = {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-stripheight"), i + 1 < a.count, let n = Double(a[i + 1]) { return CGFloat(n) }
        return 270
    }()
    static let header: CGFloat = 40
}
