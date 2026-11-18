// Talking to the quick ask (the box's microphone, the robot held): what's said, as text, live, recognised on this
// iPhone only. Tim, 11-18: "Don't have the microphone stop listening at any point if it's turned on or if it's
// tapped. Let it keep going and have long stretches of silence … You want to be able to ramble. The user will know
// when to stop it."
//   - Listening ends ONLY by the person: the stop tap, letting go of a hold, the ✕, a slide away. No silence stop,
//     no time limit.
//   - Only the person's stop or letting go asks. Anything else that ends it (a call, Siri, the app leaving the
//     front, the list closed, an error) asks nothing and keeps every word in the box, with a note.
//   - The words only ever grow (SpeechText.swift): what was said before a pause stays, new words go after it.
// Recognizers, best first, all on this iPhone: iOS 26's SpeechAnalyzer with SpeechTranscriber (long-form, no time
// limit; its model may need a download, through AssetInventory, the first time: until it's in, the older way is
// used, with a note), else its DictationTranscriber, else SFSpeechRecognizer with requiresOnDeviceRecognition, whose
// tasks end by themselves (after a pause, or about a minute): a new one starts at once on the same audio. Where none
// recognises on this iPhone, nothing is recorded and the microphone says so: no audio ever leaves the phone.

import AVFoundation
import Speech
import SwiftUI

/// What a recognizer tells SpeechInput (always on the main queue, in order).
enum SpeechEvent {
    /// SpeechAnalyzer: the words being heard (may change) / a finished stretch.
    case volatile(String), final(String)
    /// SFSpeechRecognizer: the task's transcription so far / an utterance it marked done.
    case partial(String), segment(String)
    /// The recognizer ended by itself and a new one took over on the same audio (the live words are kept).
    case newTask(String)
    /// After the end of the audio (the person's stop): every word is in.
    case ended
    /// It can't go on (the words so far are kept, nothing asked).
    case failed(String)
}

/// A recognizer the audio is fed to. `append` comes on the audio thread.
protocol SpeechListener: AnyObject {
    var name: String { get }
    func begin()
    func append(_ buffer: AVAudioPCMBuffer)
    /// The person stopped: the audio ends here; `.ended` once the last words are in.
    func endAudio()
    /// Dropped: no more events.
    func cancel()
    /// (Diagnostics) What it was given and what it did with it.
    var flow: String { get }
}

/// SFSpeechRecognizer, on device: one task after another on the same audio, so it never stops by itself.
final class RecognizerListener: SpeechListener, @unchecked Sendable {
    let name = "SFSpeechRecognizer (on device)"
    private let recognizer: SFSpeechRecognizer
    private let send: (SpeechEvent) -> Void
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var generation = 0
    private var finishing = false
    private var cancelled = false
    private var begunAt = Date()
    private var quickEnds = 0
    private var fed = 0
    private var lastEnd = ""

    init(_ recognizer: SFSpeechRecognizer, send: @escaping (SpeechEvent) -> Void) {
        self.recognizer = recognizer
        self.send = send
    }

    func begin() {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        req.addsPunctuation = true
        req.taskHint = .dictation
        lock.lock()
        generation += 1
        let g = generation
        let old = task
        request = req
        begunAt = Date()
        lock.unlock()
        old?.finish()
        let t = recognizer.recognitionTask(with: req) { [weak self] result, error in self?.handle(g, result, error) }
        lock.lock(); if generation == g { task = t }; lock.unlock()
    }

    private func handle(_ g: Int, _ result: SFSpeechRecognitionResult?, _ error: Error?) {
        lock.lock()
        let current = g == generation && !cancelled
        let ending = finishing
        lock.unlock()
        guard current else { return }
        if let result {
            let s = result.bestTranscription.formattedString
            if result.isFinal {
                post(.segment(s))
                taskEnded(g, ending, why: "final")
                return
            }
            // (a pause: iOS marks the utterance done with its metadata; the next words may start a new transcription)
            post(result.speechRecognitionMetadata != nil ? .segment(s) : .partial(s))
        }
        if let error, result == nil || result?.isFinal == false {
            taskEnded(g, ending, why: RecognizerListener.describe(error))
        }
    }

    /// The task ended (final, an error, "no speech"): after the person's stop, every word is in; otherwise a new
    /// task starts at once, however long the silence. Only a recognizer that can't run at all (10 tasks in a row
    /// ending within half a second of starting) stops listening.
    private func taskEnded(_ g: Int, _ ending: Bool, why: String) {
        lock.lock(); lastEnd = why; lock.unlock()
        if ending { post(.ended); return }
        lock.lock()
        quickEnds = Date().timeIntervalSince(begunAt) < 0.5 ? quickEnds + 1 : 0
        let broken = quickEnds >= 10
        if broken { cancelled = true }
        lock.unlock()
        if broken { post(.failed("the recognizer couldn't run (\(why))")); return }
        begin()
        post(.newTask(why))
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); let r = request; if r != nil { fed += 1 }; lock.unlock()
        r?.append(buffer)
    }

    var flow: String {
        lock.lock(); defer { lock.unlock() }
        return "\(fed) buffers in, task \(generation)\(lastEnd.isEmpty ? "" : ", the last task ended: \(lastEnd)")"
    }

    func endAudio() {
        lock.lock(); finishing = true; let r = request; lock.unlock()
        r?.endAudio()
    }

    func cancel() {
        lock.lock(); cancelled = true; generation += 1; let t = task; task = nil; request = nil; lock.unlock()
        t?.cancel()
    }

    private func post(_ e: SpeechEvent) { DispatchQueue.main.async { self.send(e) } }

    static func describe(_ error: Error) -> String {
        let e = error as NSError
        return "\(e.domain) \(e.code): \(e.localizedDescription)"
    }
}

/// iOS 26's SpeechAnalyzer: long-form, on device, no time limit. Should its results end by themselves, a new
/// analyzer takes over on the same audio.
@available(iOS 26.0, *)
final class AnalyzerListener: SpeechListener, @unchecked Sendable {
    enum Kind: String { case speech = "SpeechTranscriber", dictation = "DictationTranscriber" }
    let kind: Kind
    let locale: Locale
    let format: AVAudioFormat
    var name: String { "SpeechAnalyzer + \(kind.rawValue) (\(locale.identifier))" }
    private let send: (SpeechEvent) -> Void
    private let lock = NSLock()
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzer: SpeechAnalyzer?
    private var generation = 0
    private var finishing = false
    private var cancelled = false
    private var begunAt = Date()
    private var quickEnds = 0
    // (audio thread only, or under the feed's lock)
    private var converter: AVAudioConverter?
    private var fed = 0, notConverted = 0, results = 0
    private var lastEnd = ""

    init(kind: Kind, locale: Locale, format: AVAudioFormat, send: @escaping (SpeechEvent) -> Void) {
        self.kind = kind
        self.locale = locale
        self.format = format
        self.send = send
    }

    static func module(_ kind: Kind, _ locale: Locale) -> any SpeechModule {
        switch kind {
        case .speech: return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        case .dictation: return DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
        }
    }

    func begin() {
        let module = AnalyzerListener.module(kind, locale)
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        let a = SpeechAnalyzer(modules: [module])
        lock.lock()
        generation += 1
        let g = generation
        let oldCont = continuation, oldAnalyzer = analyzer
        continuation = cont
        analyzer = a
        begunAt = Date()
        lock.unlock()
        oldCont?.finish()
        if let oldAnalyzer { Task.detached { await oldAnalyzer.cancelAndFinishNow() } }
        Task.detached { [weak self] in
            do {
                if let t = module as? SpeechTranscriber {
                    for try await r in t.results { self?.result(g, String(r.text.characters), r.isFinal) }
                } else if let d = module as? DictationTranscriber {
                    for try await r in d.results { self?.result(g, String(r.text.characters), r.isFinal) }
                }
                self?.resultsEnded(g, nil)
            } catch {
                self?.resultsEnded(g, error)
            }
        }
        Task.detached { [weak self] in
            do { try await a.start(inputSequence: stream) } catch { self?.resultsEnded(g, error) }
        }
    }

    private func current(_ g: Int) -> (Bool, Bool) {
        lock.lock(); defer { lock.unlock() }
        return (g == generation && !cancelled, finishing)
    }

    private func result(_ g: Int, _ text: String, _ final: Bool) {
        guard current(g).0 else { return }
        lock.lock(); results += 1; lock.unlock()
        post(final ? .final(text) : .volatile(text))
    }

    private func resultsEnded(_ g: Int, _ error: Error?) {
        let (cur, ending) = current(g)
        guard cur else { return }
        let why = error.map { RecognizerListener.describe($0) } ?? "results ended"
        lock.lock(); lastEnd = why; lock.unlock()
        if ending { post(.ended); return }
        lock.lock()
        quickEnds = Date().timeIntervalSince(begunAt) < 0.5 ? quickEnds + 1 : 0
        let broken = quickEnds >= 10
        if broken { cancelled = true }
        lock.unlock()
        if broken { post(.failed("the analyzer couldn't run (\(why))")); return }
        begin()
        post(.newTask(why))
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard let b = convert(buffer) else { lock.lock(); notConverted += 1; lock.unlock(); return }
        lock.lock(); let c = continuation; if c != nil { fed += 1 }; lock.unlock()
        c?.yield(AnalyzerInput(buffer: b))
    }

    var flow: String {
        lock.lock(); defer { lock.unlock() }
        return "\(fed) buffers in as \(AudioFeed.words(format))\(notConverted > 0 ? " (\(notConverted) not converted)" : ""), \(results) results, analyzer \(generation)\(lastEnd.isEmpty ? "" : ", the last ended: \(lastEnd)")"
    }

    private func convert(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if b.format == format { return b }
        if converter == nil || converter?.inputFormat != b.format { converter = AVAudioConverter(from: b.format, to: format) }
        guard let converter else { return nil }
        let cap = AVAudioFrameCount(Double(b.frameLength) * format.sampleRate / b.format.sampleRate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return nil }
        var given = false
        var err: NSError?
        let status = converter.convert(to: out, error: &err) { _, s in
            if given { s.pointee = .noDataNow; return nil }
            given = true
            s.pointee = .haveData
            return b
        }
        return status == .error || out.frameLength == 0 ? nil : out
    }

    func endAudio() {
        lock.lock(); finishing = true; let c = continuation, a = analyzer; lock.unlock()
        c?.finish()
        if let a { Task.detached { try? await a.finalizeAndFinishThroughEndOfInput() } }
    }

    func cancel() {
        lock.lock(); cancelled = true; generation += 1; let c = continuation, a = analyzer; continuation = nil; analyzer = nil; lock.unlock()
        c?.finish()
        if let a { Task.detached { await a.cancelAndFinishNow() } }
    }

    private func post(_ e: SpeechEvent) { DispatchQueue.main.async { self.send(e) } }
}

/// (development, `-speechdeaf analyzer|recognizer`) That recognizer is given no audio, as one that hears nothing on
/// a phone: the switch to the other, with all the audio from the start, can be tried in the Simulator.
final class DeafListener: SpeechListener {
    let inner: SpeechListener
    init(_ inner: SpeechListener) { self.inner = inner }
    var name: String { inner.name + " (deaf: -speechdeaf)" }
    func begin() { inner.begin() }
    func append(_ buffer: AVAudioPCMBuffer) {}
    func endAudio() { inner.endAudio() }
    func cancel() { inner.cancel() }
    var flow: String { inner.flow }

    static let kind: String? = {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-speechdeaf"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }()
}

/// Where the audio comes from: the microphone, or (development) a recording played as if it were one.
protocol AudioSource: AnyObject {
    func start(_ to: @escaping (AVAudioPCMBuffer) -> Void) throws
    func stop()
}

/// The microphone, through AVAudioEngine's input tap.
final class MicSource: AudioSource {
    let engine = AVAudioEngine()
    private var tapOn = false
    private var to: ((AVAudioPCMBuffer) -> Void)?
    private var change: NSObjectProtocol?
    var onLost: ((String) -> Void)?

    enum Failure: Error { case noInput }

    func start(_ to: @escaping (AVAudioPCMBuffer) -> Void) throws {
        self.to = to
        try tap()
        // (headphones in or out, a route change: the engine stops; the tap is put back in the new format)
        change = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self, self.to != nil else { return }
            let s = AVAudioSession.sharedInstance()
            // (something set the app's session to another category meanwhile (a page's sound, WebKit): back to recording)
            var back = ""
            if s.category != .record {
                back = ", set back to record"
                do { try s.setCategory(.record, mode: .measurement, options: .duckOthers); try s.setActive(true) } catch { back = ", couldn't be set back to record (\(error.localizedDescription))" }
            }
            let line = "talking: the microphone's setup changed (session \(s.category.rawValue)\(back), \(MicSource.route)); started again"
            MainActor.assumeIsolated { Diagnostics.shared.log("quick ask", line) }
            do { try self.tap() } catch { self.onLost?("the microphone changed and couldn't start again (\(error.localizedDescription))") }
        }
    }

    /// (Diagnostics) The input the tap has, and where the sound comes from.
    private(set) var formatWords = "-"
    static var route: String {
        let r = AVAudioSession.sharedInstance().currentRoute.inputs.map { "\($0.portType.rawValue) \($0.portName)" }
        return r.isEmpty ? "no input route" : "input \(r.joined(separator: ", "))"
    }

    private func tap() throws {
        if engine.isRunning { engine.stop() }
        if tapOn { engine.inputNode.removeTap(onBus: 0); tapOn = false }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.noInput }
        let to = self.to
        formatWords = AudioFeed.words(format)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in to?(buffer) }
        tapOn = true
        engine.prepare()
        do { try engine.start() } catch { input.removeTap(onBus: 0); tapOn = false; throw error }
    }

    func stop() {
        to = nil
        if let change { NotificationCenter.default.removeObserver(change) }
        change = nil
        if engine.isRunning { engine.stop() }
        if tapOn { engine.inputNode.removeTap(onBus: 0); tapOn = false }
    }
}

/// (development, `-speechfile <wav>`) A recording as the microphone: its audio in 0.1 s pieces at the pace of speech
/// (`-speechrate N`: N times as fast), then silence for as long as listening goes on, as a quiet room would be.
final class FileSource: AudioSource, @unchecked Sendable {
    let url: URL
    let rate: Double
    private let lock = NSLock()
    private var running = false

    init(_ url: URL, rate: Double) { self.url = url; self.rate = rate }

    func start(_ to: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard let all = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else { throw MicSource.Failure.noInput }
        try file.read(into: all)
        lock.lock(); running = true; lock.unlock()
        let piece = AVAudioFrameCount(format.sampleRate / 10)
        let wait = UInt64(100_000_000 / max(rate, 0.1))
        Thread.detachNewThread { [weak self] in
            var at: AVAudioFrameCount = 0
            while let self, self.isRunning {
                guard let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: piece) else { return }
                b.frameLength = piece
                let n = at < all.frameLength ? min(piece, all.frameLength - at) : 0
                for ch in 0..<Int(format.channelCount) {
                    if let dst = b.floatChannelData?[ch] {
                        dst.update(repeating: 0, count: Int(piece))
                        if n > 0, let src = all.floatChannelData?[ch] { dst.update(from: src + Int(at), count: Int(n)) }
                    } else if let dst = b.int16ChannelData?[ch] {
                        dst.update(repeating: 0, count: Int(piece))
                        if n > 0, let src = all.int16ChannelData?[ch] { dst.update(from: src + Int(at), count: Int(n)) }
                    }
                }
                at += n
                to(b)
                Thread.sleep(forTimeInterval: Double(wait) / 1_000_000_000)
            }
        }
    }

    private var isRunning: Bool { lock.lock(); defer { lock.unlock() }; return running }
    func stop() { lock.lock(); running = false; lock.unlock() }
}

/// The audio of one listen, on its way to the recognizer (the audio thread adds, the main thread reads and switches):
/// how much came and how loud (Diagnostics: where it stops on a phone), and, until a recognizer hears words, all of
/// it kept, so another recognizer can be given the whole of it from the start (no word lost by a switch).
final class AudioFeed: @unchecked Sendable {
    private let lock = NSLock()
    private var listener: SpeechListener?
    private var kept: [AVAudioPCMBuffer]? = []
    private var keptSeconds = 0.0
    private var buffers = 0
    private var seconds = 0.0
    private var loudest: Float = 0
    private var sound = 0.0
    private var format = "-"
    /// Louder than this (−40 dBFS) a buffer counts as sound: a voice near the phone is well over it, a quiet room under.
    static let soundLevel: Float = 0.01
    /// At most this much audio is kept for a switch (the oldest goes first).
    static let keepSeconds = 120.0

    func add(_ b: AVAudioPCMBuffer) {
        let peak = AudioFeed.peak(b)
        let secs = b.format.sampleRate > 0 ? Double(b.frameLength) / b.format.sampleRate : 0
        let copy = AudioFeed.copy(b)
        lock.lock(); defer { lock.unlock() }
        if buffers == 0 { format = AudioFeed.words(b.format) }
        buffers += 1
        seconds += secs
        loudest = max(loudest, peak)
        if peak > AudioFeed.soundLevel { sound += secs }
        if kept != nil, let copy {
            kept!.append(copy)
            keptSeconds += secs
            while keptSeconds > AudioFeed.keepSeconds, let first = kept!.first {
                kept!.removeFirst()
                keptSeconds -= Double(first.frameLength) / max(first.format.sampleRate, 1)
            }
        }
        listener?.append(b)
    }

    /// The recognizer the audio goes to from now; `replay`: given everything kept first, from the start.
    func use(_ l: SpeechListener?, replay: Bool) {
        lock.lock(); defer { lock.unlock() }
        listener = l
        if replay, let l, let kept { for b in kept { l.append(b) } }
    }

    /// Words were heard: nothing more to keep.
    func stopKeeping() { lock.lock(); kept = nil; keptSeconds = 0; lock.unlock() }

    /// Seconds of audio with sound in it so far.
    var soundSeconds: Double { lock.lock(); defer { lock.unlock() }; return sound }
    var keptAudio: Double { lock.lock(); defer { lock.unlock() }; return keptSeconds }

    var words: String {
        lock.lock(); defer { lock.unlock() }
        let db = loudest > 0 ? String(format: "%.0f dB", 20 * log10(Double(loudest))) : "silent"
        return buffers == 0 ? "no audio from the microphone" : "\(buffers) buffers of \(format), \(String(format: "%.1f", seconds)) s, loudest \(db), \(String(format: "%.1f", sound)) s with sound"
    }

    static func words(_ f: AVAudioFormat) -> String {
        let kind: String
        switch f.commonFormat {
        case .pcmFormatFloat32: kind = "float32"
        case .pcmFormatInt16: kind = "int16"
        case .pcmFormatInt32: kind = "int32"
        case .pcmFormatFloat64: kind = "float64"
        default: kind = "other"
        }
        return "\(Int(f.sampleRate)) Hz \(f.channelCount) ch \(kind)\(f.isInterleaved && f.channelCount > 1 ? " interleaved" : "")"
    }

    static func peak(_ b: AVAudioPCMBuffer) -> Float {
        let n = Int(b.frameLength)
        var p: Float = 0
        if let d = b.floatChannelData?[0] { for i in 0..<n { p = max(p, abs(d[i])) } }
        else if let d = b.int16ChannelData?[0] { for i in 0..<n { p = max(p, abs(Float(d[i]) / 32768)) } }
        return p
    }

    static func copy(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let c = AVAudioPCMBuffer(pcmFormat: b.format, frameCapacity: max(b.frameLength, 1)) else { return nil }
        c.frameLength = b.frameLength
        let from = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: b.audioBufferList))
        let to = UnsafeMutableAudioBufferListPointer(c.mutableAudioBufferList)
        for i in 0..<min(from.count, to.count) {
            guard let src = from[i].mData, let dst = to[i].mData else { continue }
            let n = min(Int(from[i].mDataByteSize), Int(to[i].mDataByteSize))
            memcpy(dst, src, n)
            to[i].mDataByteSize = UInt32(n)
        }
        return c
    }
}

/// The microphone of the quick ask: the box's (tap or hold) and the robot's hold.
@MainActor
final class SpeechInput: ObservableObject {
    static let shared = SpeechInput()
    enum Phase: Equatable { case idle, asking, listening, finishing, refused, unavailable(String) }
    @Published private(set) var phase: Phase = .idle
    /// Everything heard this time, after the box's words it started from: it only grows (live words may be revised).
    @Published private(set) var transcript = ""
    /// The box's words: typed, or kept when listening stopped without asking. Talking goes on after them.
    @Published var draft = ""
    /// Listening stopped by itself (a call, the app left, the list closed, an error): nothing was asked, the words
    /// are in the box. Shown there until the microphone or the box is used again.
    @Published var stoppedNote: String?
    /// The robot's hold stopped that way: its pill says so over the toolbar (a tap opens the box with the words).
    @Published var keptFromHold = false
    /// Tapped, not held (Tim, 11-18: "tap to start listening, tap again to stop"): listening goes on after the finger
    /// lifts, until the microphone's next tap (asked) or the ✕ (kept in the box, not asked).
    @Published private(set) var tapMode = false
    /// Listening from the robot's hold (not the box).
    @Published private(set) var fromRobot = false
    /// The better recognizer's model coming to this iPhone (a note while it does).
    @Published private(set) var getting: Double?

    private var words = SpeechText()
    private var base = ""
    private var listener: SpeechListener?
    private var source: AudioSource?
    /// This listen's audio on its way to the recognizer (counted; kept until words are heard, for a switch).
    private var feed: AudioFeed?
    private var listenID = 0
    /// Each listener made gets the next number; events from one replaced are ignored.
    private var listenerSerial = 0
    /// The recognizers tried this listen ("analyzer", "recognizer").
    private var tried: [String] = []
    /// A recognizer gave words this listen.
    private var heardWords = false
    /// The feed's seconds with sound when the current recognizer began.
    private var soundAtListener = 0.0
    private var watch: Task<Void, Never>?
    private var pressAt = Date()
    private var finished: ((String) -> Void)?
    private var finishing: Task<Void, Never>?
    /// (development) How many times the words were handed on to be asked, and the events seen this listen.
    private(set) var asked = 0
    private(set) var lastAsked = ""
    private var events: [String: Int] = [:]
    private var listenStarted = Date()

    static let stoppedWords = "Listening stopped. Nothing was sent: your words are kept here."
    static let keptHoldWords = "Listening stopped. Nothing was sent. Tap to see your words."
    static let nothingHeardWords = "No words were heard, so nothing was sent. Try again, or type."
    static let failedWords = "Listening stopped: the microphone or speech recognition stopped working. Nothing was sent. Type instead, or try again."

    private init() {
        let nc = NotificationCenter.default
        // (anything that takes the app away mid-listen stops it without asking: the words kept)
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { SpeechInput.shared.interrupt(why: "the app stopped being in front") }
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { SpeechInput.shared.interrupt(why: "the app left the front") }
        }
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { n in
            let began = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init) == .began
            MainActor.assumeIsolated { if began { SpeechInput.shared.interrupt(why: "an audio interruption (a call, Siri, an alarm)") } }
        }
        nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { SpeechInput.shared.interrupt(why: "iOS's audio restarted") }
        }
    }

    // MARK: which recognizer

    /// The phone's language's SFSpeechRecognizer (English if it has none).
    static func recognizer() -> SFSpeechRecognizer? { SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")) }
    /// The language's name, for "not on this iPhone".
    static var language: String { Locale.current.localizedString(forIdentifier: (recognizer()?.locale ?? Locale.current).identifier) ?? "this language" }
    static let notOnDevice = "This iPhone can't recognise speech in \(language) by itself, so TRIF doesn't listen. Type instead, or use the keyboard's dictation."
    static let refusedWords = "TRIF can't hear you: allow the Microphone and Speech Recognition for TRIF in Settings. You can still type."

    /// iOS 26's analyzer, when its model is on this iPhone (found by `choose`).
    private var analyzerChoice: (kind: String, locale: Locale, format: AVAudioFormat)?
    /// What `choose` found, for Diagnostics and the speech step.
    private(set) var choiceWords = "not looked yet"
    private var choosing: Task<Void, Never>?
    private var looked = false
    private var downloadTried = false
    private var downloading = false
    private var downloadAfter = false

    /// Finds the best recognizer on this iPhone (once; again after a download). `download`: the person is using the
    /// microphone, so a missing model may be fetched (Apple's, through AssetInventory; no audio goes anywhere).
    func choose(download: Bool = false) {
        // (a look already going on (the list opening asks without download): the person's press, which may fetch the
        // model, is looked at again once it's done. Before 11-18 it was dropped, so a first press right after the list
        // opened never started the download)
        guard choosing == nil else { if download { downloadAfter = true }; return }
        // (looked already: a press's download wish is answered from that look, without looking again)
        if looked {
            if download, !downloadTried {
                downloadTried = true
                if #available(iOS 26.0, *), let m = lookedToGet as? any SpeechModule { fetch(m) }
            }
            return
        }
        looked = true
        if download { downloadTried = true }
        if ProcessInfo.processInfo.arguments.contains("-oldspeech") { choiceWords = "SFSpeechRecognizer (-oldspeech)"; return }
        guard #available(iOS 26.0, *) else { choiceWords = "SFSpeechRecognizer (before iOS 26)"; return }
        choosing = Task { @MainActor in
            await self.chooseAnalyzer(download: download)
            self.choosing = nil
            // (a press came during the look: its download wish is answered from this look, not a second one. Tim's
            // phone, 11-18: the hold's look and the press's look both ran, "recognizers: …" logged twice)
            if self.downloadAfter {
                self.downloadAfter = false
                self.downloadTried = true
                if #available(iOS 26.0, *), let m = self.lookedToGet as? any SpeechModule { self.fetch(m) }
            }
            self.upgradeListening()
        }
    }

    /// What the last look said to fetch (an iOS 26 SpeechModule; nil: nothing, or the best is here).
    private var lookedToGet: Any?

    /// The look ended while a listen had already started on SFSpeechRecognizer (the robot held before the look was
    /// done: Tim's phone, 11-18, "listening (SFSpeechRecognizer …)" 0.4 s before "→ SpeechTranscriber"): the analyzer it
    /// found takes over, given all the audio from the start (kept until the first words), as long as no words came yet.
    private func upgradeListening() {
        guard phase == .listening, analyzerChoice != nil, !heardWords, !tried.contains("analyzer"), tried.last == "recognizer" else { return }
        let old = listener
        old?.cancel()
        words = SpeechText()
        transcript = base
        let kept = feed?.keptAudio ?? 0
        let l = begin("analyzer", replay: true)
        count("upgraded")
        Diagnostics.shared.log("quick ask", "talking: the look found \(l.name) after listening had started on \(old?.name ?? "-"); it takes over, given the \(String(format: "%.1f", kept)) s kept from the start")
    }

    /// Looks for the best recognizer now, off the main thread, if no look has been made yet (the robot's finger coming
    /// down: the look takes ~0.4 s on an iPhone SE, the hold starts at 0.45 s).
    func lookAhead() {
        guard !looked, choosing == nil else { return }
        choose()
    }

    @available(iOS 26.0, *)
    private func chooseAnalyzer(download: Bool) async {
        // (looked at off the main thread: in the Simulator the look held it ~430 ms, and a tap on the microphone right
        // as the list opened waited for it)
        let found = await Task.detached(priority: .userInitiated) { await SpeechInput.look(Locale.current) }.value
        let notes = found.notes
        let toGet = found.toGet
        lookedToGet = analyzerChoice?.kind == AnalyzerListener.Kind.speech.rawValue || found.choice?.kind == AnalyzerListener.Kind.speech.rawValue ? nil : toGet
        if let c = found.choice { analyzerChoice = c }
        choiceWords = notes.joined(separator: "; ") + (analyzerChoice.map { " → \($0.kind)" } ?? " → SFSpeechRecognizer")
        Diagnostics.shared.log("quick ask", "talking: recognizers on this iPhone: \(choiceWords)")
        // (the better model isn't here yet: fetched once the microphone is used; the older way until it's in)
        if let m = toGet, download, analyzerChoice?.kind != AnalyzerListener.Kind.speech.rawValue { fetch(m) }
    }

    /// Apple's speech model fetched (AssetInventory; no audio goes anywhere), then looked at again.
    @available(iOS 26.0, *)
    private func fetch(_ m: any SpeechModule) {
        guard !downloading else { return }
        downloading = true
        getting = 0
        Diagnostics.shared.log("quick ask", "talking: getting the speech model for this iPhone")
        Task { @MainActor in
            do {
                if let req = try await AssetInventory.assetInstallationRequest(supporting: [m]) {
                    let watch = Task { @MainActor in
                        while !Task.isCancelled { self.getting = req.progress.fractionCompleted; try? await Task.sleep(nanoseconds: 500_000_000) }
                    }
                    try await req.downloadAndInstall()
                    watch.cancel()
                }
                Diagnostics.shared.log("quick ask", "talking: the speech model is on this iPhone")
            } catch {
                Diagnostics.shared.log("quick ask", "talking: the speech model didn't download (\(error.localizedDescription))")
            }
            self.getting = nil
            self.downloading = false
            self.analyzerChoice = nil
            self.looked = false
            self.choose()
        }
    }

    /// What iOS 26's analyzer has on this iPhone for the language: the best module whose model is installed (its
    /// audio format), else the one to fetch.
    @available(iOS 26.0, *)
    struct Look: @unchecked Sendable {
        var notes: [String] = []
        var choice: (kind: String, locale: Locale, format: AVAudioFormat)?
        var toGet: (any SpeechModule)?
    }

    @available(iOS 26.0, *)
    nonisolated static func look(_ here: Locale) async -> Look {
        var r = Look()
        // (SpeechTranscriber where this iPhone has it; else DictationTranscriber)
        var kinds: [AnalyzerListener.Kind] = []
        if SpeechTranscriber.isAvailable { kinds.append(.speech) } else { r.notes.append("SpeechTranscriber not on this device") }
        kinds.append(.dictation)
        for kind in kinds {
            let loc: Locale? = kind == .speech ? await SpeechTranscriber.supportedLocale(equivalentTo: here) : await DictationTranscriber.supportedLocale(equivalentTo: here)
            guard let loc else { r.notes.append("\(kind.rawValue): \(here.identifier) not supported"); continue }
            let m = AnalyzerListener.module(kind, loc)
            let status = await AssetInventory.status(forModules: [m])
            r.notes.append("\(kind.rawValue) \(loc.identifier): \(status)")
            if status == .installed {
                guard let f = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [m]) else { r.notes.append("no audio format"); continue }
                // (the model kept for TRIF: one installed for another app may otherwise not be usable, or go)
                do { if !(try await AssetInventory.reserve(locale: loc)) { r.notes.append("\(loc.identifier) reserved before") } }
                catch { r.notes.append("\(loc.identifier) not reserved (\(error.localizedDescription))") }
                r.notes.append("audio \(AudioFeed.words(f))")
                r.choice = (kind.rawValue, loc, f)
                break
            }
            if status == .supported || status == .downloading, r.toGet == nil { r.toGet = m }
        }
        return r
    }

    /// Talking can start at once: both permissions given, recognition on this iPhone and available now (the robot's
    /// hold talks straight away only then; otherwise it opens the chats' list, whose box says why or asks).
    var ready: Bool {
        guard phase == .idle, SFSpeechRecognizer.authorizationStatus() == .authorized,
              SpeechInput.standInFile != nil || AVAudioApplication.shared.recordPermission == .granted else { return false }
        if analyzerChoice != nil { return true }
        guard let r = SpeechInput.recognizer(), r.supportsOnDeviceRecognition, r.isAvailable else { return false }
        return true
    }

    /// (development, `-speechfile <path>`: a recording stands in for the microphone, played at the pace of speech
    /// (`-speechrate N`), then silence, so a hold or a tap can be tried in the Simulator without the Mac's room)
    static let standInFile: URL? = {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-speechfile"), i + 1 < a.count else { return nil }
        return URL(fileURLWithPath: a[i + 1])
    }()
    static let standInRate: Double = {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-speechrate"), i + 1 < a.count, let n = Double(a[i + 1]), n > 0 { return n }
        return 1
    }()

    /// Whether talking can work here at all, as far as is known without asking: refused, not on this iPhone, or fine.
    func check() {
        choose()
        if SFSpeechRecognizer.authorizationStatus() == .denied || SFSpeechRecognizer.authorizationStatus() == .restricted
            || AVAudioApplication.shared.recordPermission == .denied { phase = .refused; return }
        if analyzerChoice == nil, let r = SpeechInput.recognizer(), !r.supportsOnDeviceRecognition { phase = .unavailable(SpeechInput.notOnDevice); return }
        if phase == .refused || phase.isUnavailable { phase = .idle }
    }

    // MARK: listening

    /// The microphone pressed (the box's, or the robot held): listening starts, after the box's words (permissions
    /// asked for the first time instead; refused, or no recognition on this iPhone: nothing recorded, the reason
    /// shown). `done`: the whole text, when the person stops or lets go.
    func press(robot: Bool = false, _ done: @escaping (String) -> Void) {
        guard phase == .idle else { return }
        pressAt = Date()
        let speech = SFSpeechRecognizer.authorizationStatus()
        let mic = SpeechInput.standInFile != nil ? .granted : AVAudioApplication.shared.recordPermission
        if speech == .denied || speech == .restricted || mic == .denied { phase = .refused; Diagnostics.shared.log("quick ask", "talking: refused (speech \(speech.rawValue), microphone \(mic.rawValue))"); return }
        let r = SpeechInput.recognizer()
        // (never to a server: only where this iPhone recognises speech itself)
        guard analyzerChoice != nil || r?.supportsOnDeviceRecognition == true else {
            phase = .unavailable(SpeechInput.notOnDevice)
            Diagnostics.shared.log("quick ask", "talking: no on-device recognition for \(r?.locale.identifier ?? Locale.current.identifier)")
            return
        }
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
        if analyzerChoice == nil, r?.isAvailable != true { phase = .unavailable("Speech recognition isn't available right now. Type instead."); return }
        choose(download: true)
        start(robot: robot, done)
    }

    private func start(robot: Bool, _ done: @escaping (String) -> Void) {
        let file = SpeechInput.standInFile
        let t0 = CACurrentMediaTime()
        var sessionMs = 0
        if file == nil || ProcessInfo.processInfo.arguments.contains("-speechsession") {
            do { try takeSession() } catch {
                phase = .unavailable("The microphone can't be used right now. Type instead.")
                Diagnostics.shared.log("quick ask", "talking: the audio session wouldn't start (\(error.localizedDescription))")
                return
            }
            sessionMs = Int((CACurrentMediaTime() - t0) * 1000)
        }
        guard let kind = kinds().first else { phase = .unavailable(SpeechInput.notOnDevice); giveBackSession(); return }
        listenID += 1
        tried = []
        heardWords = false
        words = SpeechText()
        events = [:]
        base = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = base
        stoppedNote = nil
        keptFromHold = false
        fromRobot = robot
        finished = done
        let f = AudioFeed()
        feed = f
        let l = begin(kind)
        let src: AudioSource = file.map { FileSource($0, rate: SpeechInput.standInRate) } ?? MicSource()
        (src as? MicSource)?.onLost = { why in MainActor.assumeIsolated { SpeechInput.shared.interrupt(why: why, failed: true) } }
        do { try src.start { b in f.add(b) } } catch {
            l.cancel()
            listener = nil
            feed = nil
            finished = nil
            transcript = ""
            phase = .unavailable(file != nil ? "The stand-in recording can't be read." : "The microphone can't be used right now. Type instead.")
            Diagnostics.shared.log("quick ask", "talking: the microphone wouldn't start (\(error.localizedDescription); \(MicSource.route))")
            giveBackSession()
            return
        }
        source = src
        listenStarted = Date()
        phase = .listening
        let s = AVAudioSession.sharedInstance()
        let mic = (src as? MicSource).map { "microphone \($0.formatWords), \(MicSource.route)" } ?? "a stand-in recording"
        Diagnostics.shared.log("quick ask", "talking: listening (\(l.name)\(robot ? ", the robot held" : "")), ready \(Int((CACurrentMediaTime() - t0) * 1000)) ms after the press (the audio session \(sessionMs) ms); \(mic); session \(s.category.rawValue) \(s.mode.rawValue)")
        watchListening()
    }

    // MARK: which recognizer hears it (Tim, 11-18 on his iPhone SE: "Tapping the microphone … just listens for a
    // moment and then doesn't record anything and then exits")

    /// What can recognise speech on this iPhone now, best first: iOS 26's analyzer (its model here), then
    /// SFSpeechRecognizer on device.
    private func kinds() -> [String] {
        var k: [String] = []
        if analyzerChoice != nil { k.append("analyzer") }
        if let r = SpeechInput.recognizer(), r.supportsOnDeviceRecognition { k.append("recognizer") }
        return k
    }

    /// One this listen hasn't tried yet.
    private func alternative() -> String? { kinds().first { !tried.contains($0) } }

    /// A new listener of that kind, begun, the audio going to it (`replay`: all of it from the start first).
    @discardableResult
    private func begin(_ kind: String, replay: Bool = false) -> SpeechListener {
        listenerSerial += 1
        let serial = listenerSerial
        let send: (SpeechEvent) -> Void = { e in MainActor.assumeIsolated { SpeechInput.shared.event(e, serial) } }
        var made: SpeechListener?
        if kind == "analyzer", #available(iOS 26.0, *), let c = analyzerChoice, let k = AnalyzerListener.Kind(rawValue: c.kind) {
            made = AnalyzerListener(kind: k, locale: c.locale, format: c.format, send: send)
        }
        var l: SpeechListener = made ?? RecognizerListener(SpeechInput.recognizer() ?? SFSpeechRecognizer()!, send: send)
        if DeafListener.kind == kind { l = DeafListener(l) }
        tried.append(kind)
        listener = l
        soundAtListener = feed?.soundSeconds ?? 0
        l.begin()
        feed?.use(l, replay: replay)
        return l
    }

    /// The recognizer heard no words though there was sound (or it stopped working): the next one takes over, given
    /// all the audio from the start, so nothing said is lost.
    private func switchListener(to kind: String, why: String) {
        let old = listener
        old?.cancel()
        words = SpeechText()
        transcript = base
        let kept = feed?.keptAudio ?? 0
        let l = begin(kind, replay: true)
        count("switched")
        Diagnostics.shared.log("quick ask", "talking: \(old?.name ?? "-") heard no words (\(why); \(old?.flow ?? "-")); now \(l.name), given the \(String(format: "%.1f", kept)) s kept from the start")
    }

    /// While listening: what reached the recognizer, said in Diagnostics at 1.5 s, 6 s, then each minute; and the
    /// switch to the other recognizer when 4 s with sound brought no words.
    private func watchListening() {
        watch?.cancel()
        let id = listenID
        watch = Task { @MainActor [weak self] in
            let marks = [1.5, 6.0]
            var said = 0
            var nextMinute = 60.0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self, !Task.isCancelled, self.phase == .listening, self.listenID == id else { return }
                let t = Date().timeIntervalSince(self.listenStarted)
                if said < marks.count, t >= marks[said] {
                    said += 1
                    Diagnostics.shared.log("quick ask", "talking: after \(String(format: "%.1f", t)) s: \(self.flowWords)")
                } else if t >= nextMinute {
                    nextMinute += 60
                    Diagnostics.shared.log("quick ask", "talking: after \(Int(t)) s: \(self.flowWords)")
                }
                if !self.heardWords, let f = self.feed, f.soundSeconds - self.soundAtListener >= SpeechInput.noWordsSound, let alt = self.alternative() {
                    self.switchListener(to: alt, why: "\(Int(SpeechInput.noWordsSound)) s with sound and no words")
                }
            }
        }
    }

    /// Seconds of audio with sound in it after which a recognizer that gave no words is replaced.
    static let noWordsSound = 4.0

    /// (Diagnostics) The audio, the recognizer, what it gave.
    private var flowWords: String {
        "\(feed?.words ?? "no audio"); \(listener?.name ?? "no recognizer"): \(listener?.flow ?? "-"); events (\(eventWords))"
    }

    private func event(_ e: SpeechEvent, _ serial: Int) {
        guard serial == listenerSerial, phase == .listening || phase == .finishing else { return }
        switch e {
        case .volatile(let s): words.volatile(s); count("volatile"); heard(s)
        case .final(let s): words.final(s); count("final"); heard(s)
        case .partial(let s): words.partial(s); count("partial"); heard(s)
        case .segment(let s): words.segmentEnded(s); count("segment"); heard(s)
        case .newTask(let why):
            words.newTask(); count("new task")
            Diagnostics.shared.log("quick ask", "talking: the recognizer ended by itself (\(why)); listening goes on")
        case .ended:
            count("ended")
            end()
            return
        case .failed(let why):
            Diagnostics.shared.log("quick ask", "talking: \(listener?.name ?? "the recognizer") failed: \(why)")
            if phase == .finishing { end(); return }
            if !heardWords, let alt = alternative() { switchListener(to: alt, why: why); return }
            interrupt(why: why, failed: true)
            return
        }
        transcript = SpeechText.join(base, words.text)
    }

    /// The first words of this listen: what's kept for a switch isn't needed any more.
    private func heard(_ s: String) {
        guard !heardWords, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        heardWords = true
        feed?.stopKeeping()
        Diagnostics.shared.log("quick ask", "talking: first words \(String(format: "%.1f", Date().timeIntervalSince(listenStarted))) s in (\(listener?.name ?? "-"))")
    }

    private func count(_ k: String) { events[k, default: 0] += 1 }

    /// The press was a tap: listening goes on until the next tap (asked) or the ✕ (kept, not asked). Nothing else stops it.
    /// `held`: the finger's time down, by the touches' own times (nil: not known, a dev step).
    func keepListening(held: TimeInterval? = nil) {
        guard phase == .listening else { return }
        tapMode = true
        Diagnostics.shared.log("quick ask", "talking: tapped (\(SpeechInput.heldWords(held)), handled \(Int(Date().timeIntervalSince(pressAt) * 1000)) ms after the press), listening until the next tap")
    }

    private static func heldWords(_ held: TimeInterval?) -> String { held.map { "held \(Int($0 * 1000)) ms" } ?? "held for a dev step" }

    /// The person's stop (the tap on stop, or letting go): everything heard is asked, once the last words are in.
    func release(held: TimeInterval? = nil) {
        guard phase == .listening else { return }
        let how = tapMode ? "the stop tap" : "let go, \(SpeechInput.heldWords(held)), handled \(Int(Date().timeIntervalSince(pressAt) * 1000)) ms after the press"
        phase = .finishing
        tapMode = false
        watch?.cancel()
        watch = nil
        source?.stop()
        source = nil
        // (no words yet, but there was sound: the other recognizer gets all of it before the end)
        var wait: UInt64 = 2_500_000_000
        if !heardWords, let f = feed, f.soundSeconds - soundAtListener >= 0.3, let alt = alternative() {
            switchListener(to: alt, why: "none by the stop")
            wait = 8_000_000_000
        }
        Diagnostics.shared.log("quick ask", "talking: the person's stop (\(how)): \(flowWords)")
        listener?.endAudio()
        // (at most 2.5 s for the last words; 8 s when the other recognizer was just given it all)
        finishing = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: wait)
            if !Task.isCancelled { self?.end() }
        }
    }

    /// Slid away and let go: what was said this time is dropped (the box's words before it stay), nothing asked.
    func cancel(why: String = "slid away") {
        guard phase == .listening || phase == .finishing else { return }
        stopAll()
        draft = base
        transcript = ""
        phase = .idle
        Diagnostics.shared.log("quick ask", "talking: cancelled (\(why)), \(words.text.count) characters dropped")
    }

    /// The ✕ while tap-listening: stopped, every word kept in the box, nothing asked.
    func keep(why: String = "the ✕") {
        guard phase == .listening || phase == .finishing else { return }
        let flow = flowWords
        stopAll()
        draft = transcript
        transcript = ""
        phase = .idle
        Diagnostics.shared.log("quick ask", "talking: stopped (\(why)), \(draft.count) characters kept in the box, nothing asked (\(flow))")
    }

    /// Stopped by anything but the person (a call, Siri, the app leaving the front, the list closed, an error):
    /// nothing asked, every word kept in the box, with a note. (After the person's stop it's theirs: it goes on.)
    func interrupt(why: String, failed: Bool = false) {
        guard phase == .listening else { return }
        let robot = fromRobot
        let flow = flowWords
        // (a call or Siri took the sound: what was playing stays paused, as iOS leaves it; anything else plays on)
        stopAll(resume: !why.hasPrefix("an audio interruption"))
        draft = transcript
        transcript = ""
        phase = .idle
        if !draft.isEmpty {
            stoppedNote = SpeechInput.stoppedWords
            keptFromHold = robot
        } else if failed {
            // (an error with nothing heard: said, not a silent close)
            stoppedNote = SpeechInput.failedWords
        }
        Diagnostics.shared.log("quick ask", "talking: stopped by \(why)\(failed ? " (an error)" : ""), nothing asked, \(draft.count) characters kept in the box (\(flow))")
    }

    private func stopAll(resume: Bool = true) {
        finished = nil
        tapMode = false
        watch?.cancel()
        watch = nil
        finishing?.cancel()
        finishing = nil
        source?.stop()
        source = nil
        feed?.use(nil, replay: false)
        feed = nil
        listener?.cancel()
        listener = nil
        giveBackSession(resume: resume)
    }

    private func end() {
        guard phase == .listening || phase == .finishing else { return }
        let flow = flowWords
        let robot = fromRobot
        finishing?.cancel()
        finishing = nil
        watch?.cancel()
        watch = nil
        tapMode = false
        source?.stop()
        source = nil
        feed?.use(nil, replay: false)
        feed = nil
        listener?.cancel()
        listener = nil
        giveBackSession()
        phase = .idle
        let all = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = ""
        let done = finished
        finished = nil
        let secs = Int(Date().timeIntervalSince(listenStarted))
        Diagnostics.shared.log("quick ask", "talking: stopped by the person after \(secs) s, \(all.isEmpty ? "nothing heard" : "\(all.count) characters asked") (\(flow))")
        guard !all.isEmpty, let done else {
            // (nothing heard: said in the box, not a silent close)
            if all.isEmpty, !robot { stoppedNote = SpeechInput.nothingHeardWords }
            return
        }
        draft = ""
        stoppedNote = nil
        asked += 1
        lastAsked = all
        done(all)
    }

    private var eventWords: String { events.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ") + (words.restartsCaught > 0 ? ", restarts caught \(words.restartsCaught)" : "") }

    // MARK: the audio session and the pages' sound (Tim, 11-18: "when I stop, the video doesn't start again. And when
    // I go back, it's hung")

    /// Set by the app: pause what the pages are playing (TRIF does it, before the session takes the sound) / play it
    /// on after (Browser.pauseMediaForTalk / resumeMediaAfterTalk).
    static var pauseMedia: (() -> Void)?
    static var resumeMedia: (() -> Void)?
    private var sessionBefore: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?

    /// The session for listening: what played is paused first; the category it had is kept to put back.
    private func takeSession() throws {
        let session = AVAudioSession.sharedInstance()
        SpeechInput.pauseMedia?()
        sessionBefore = (session.category, session.mode, session.categoryOptions)
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            giveBackSession()
            throw error
        }
    }

    /// However listening ended: the engine is already stopped; the session let go (others told), its category as it
    /// was before (playback, so pages' sound goes on in the background: BackgroundPlay), then what played plays on.
    private func giveBackSession(resume: Bool = true) {
        guard let before = sessionBefore else { return }
        sessionBefore = nil
        let session = AVAudioSession.sharedInstance()
        do { try session.setActive(false, options: .notifyOthersOnDeactivation) } catch {
            Diagnostics.shared.log("audio", "after talking: the session wouldn't let go (\(error.localizedDescription))")
        }
        do { try session.setCategory(before.category, mode: before.mode, options: before.options) } catch {
            Diagnostics.shared.log("audio", "after talking: the session's category wouldn't go back (\(error.localizedDescription))")
        }
        if resume { SpeechInput.resumeMedia?() }
    }

    /// (development) The SFSpeechRecognizer on a recorded file (SFSpeechURLRecognitionRequest): what it hears, and how.
    func recognize(file: URL) async -> String {
        let status = SFSpeechRecognizer.authorizationStatus()
        if status == .notDetermined {
            _ = await withCheckedContinuation { (k: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in SFSpeechRecognizer.requestAuthorization { k.resume(returning: $0) } }
        }
        let now = SFSpeechRecognizer.authorizationStatus()
        guard now == .authorized else { return "speech recognition not allowed (\(now.rawValue))" }
        guard let r = SpeechInput.recognizer() else { return "no recognizer" }
        guard r.supportsOnDeviceRecognition else { return "\(r.locale.identifier): no on-device recognition here, so TRIF wouldn't listen (the microphone says so)" }
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
        "phase \(phase), speech \(SFSpeechRecognizer.authorizationStatus().rawValue) (0 not asked, 1 denied, 2 restricted, 3 allowed), microphone \(AVAudioApplication.shared.recordPermission == .denied ? "denied" : AVAudioApplication.shared.recordPermission == .granted ? "allowed" : "not asked"), on-device \(SpeechInput.recognizer()?.supportsOnDeviceRecognition ?? false) (\(SpeechInput.recognizer()?.locale.identifier ?? "-")), recognizers: \(choiceWords)"
    }

    /// (development, the mic steps) Where listening is: phase, mode, the words, what was asked.
    var state: String {
        "phase \(phase)\(tapMode ? ", tap mode" : "")\(fromRobot ? ", robot" : ""), listener \(listener?.name ?? "-"), events (\(eventWords)), asked \(asked)\(stoppedNote != nil ? ", note: \(stoppedNote!)" : "")\(keptFromHold ? ", kept from a hold" : "")\(getting.map { ", getting the model \(Int($0 * 100))%" } ?? "")\n"
            + "transcript: \(transcript)\ndraft: \(draft)\nlast asked: \(lastAsked)"
    }
}

extension SpeechInput.Phase {
    var isUnavailable: Bool { if case .unavailable = self { return true } else { return false } }
}
