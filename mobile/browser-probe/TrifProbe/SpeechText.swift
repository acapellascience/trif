// The words heard while the microphone listens, put together so they only ever grow (Tim, 11-18: "If you pause, it
// deletes the things you've said so far"). The phones' shared rule: mobile/shared/core/speech-text.js
// (TrifCore.speechText.apply), through Core.swift, once per recognizer event (~50 µs on the Mac); the Swift copy below (the rule
// as it was here, held to the same speech-text-cases.json) answers only if the shared one can't. No UI, no Speech
// framework: built for the Mac too (mobile/test/speechtext-check). SpeechInput (QuickAsk.swift) feeds it whatever
// recognizer it runs:
//   - iOS 26's SpeechAnalyzer: `volatile` for the words being heard (they may change), `final` for a finished stretch
//     (appended, never changed again).
//   - SFSpeechRecognizer: `partial` with the task's best transcription so far, `segmentEnded` when the recognizer
//     marks an utterance done (isFinal, or its metadata after a pause), `newTask` when a task ended by itself and the
//     next one starts on the same audio. After a pause, iOS's on-device recognizer may start its transcription over
//     with only the newest words, or repeat what it already gave: `partial` keeps the earlier words either way.
// Committed words never disappear; only the live tail may be revised.

import Foundation

struct SpeechText: Equatable {
    /// Finished stretches, in order: only ever appended to.
    private(set) var committed = ""
    /// The stretch being heard now (revised as the recognizer changes its mind).
    private(set) var live = ""
    /// The current recognition task's own text at its last segment end (its later results may start with it again).
    private(set) var taskSaid = ""
    /// How many times a fresh transcription was caught replacing the live words (kept, for Diagnostics).
    private(set) var restartsCaught = 0
    /// Everything heard, in order.
    private(set) var text = ""
    /// (the Mac check) false: only the Swift copy, to compare it with the shared rule
    nonisolated(unsafe) static var shared = true

    init() {}

    // MARK: SpeechAnalyzer

    /// The words being heard now, not final yet.
    mutating func volatile(_ s: String) { step("volatile", s) }

    /// A finished stretch: appended after the earlier ones.
    mutating func final(_ s: String) { step("final", s) }

    // MARK: SFSpeechRecognizer

    /// A partial result: `whole` is the task's best transcription so far.
    mutating func partial(_ whole: String) { step("partial", whole) }

    /// The recognizer marked the utterance done (isFinal, or metadata after a pause): `whole` is the task's text.
    mutating func segmentEnded(_ whole: String) { step("segment", whole) }

    /// The task ended (by itself, or for the next one): what was live is kept, the next task starts afresh.
    mutating func newTask() { step("newTask", nil) }

    // MARK: the shared rule

    private mutating func step(_ kind: String, _ s: String?) {
        if SpeechText.shared {
            // (what's committed never crosses: it only grows, and it grows long; the answer says what to add to it)
            let state: [String: Any] = ["said": !committed.isEmpty, "live": live, "taskSaid": taskSaid, "restarts": restartsCaught]
            if let r = Core.shared.call("speechText.apply", [state, s.map { [kind, $0] } ?? [kind]]) as? [String: Any],
               let a = r["added"] as? String, let l = r["live"] as? String, let t = r["taskSaid"] as? String,
               let n = r["restarts"] as? Int, let tail = r["tail"] as? String {
                committed += a; live = l; taskSaid = t; restartsCaught = n; text = committed + tail
                return
            }
        }
        switch kind {
        case "volatile": copyVolatile(s ?? "")
        case "final": copyFinal(s ?? "")
        case "partial": copyPartial(s ?? "")
        case "segment": copySegmentEnded(s ?? "")
        default: copyNewTask()
        }
        text = SpeechText.join(committed, live)
    }

    // MARK: the Swift copy (the rule as it was here; speech-text-cases.json holds both to the same answers)

    private mutating func copyVolatile(_ s: String) { live = SpeechText.clean(s) }

    private mutating func copyFinal(_ s: String) {
        committed = SpeechText.join(committed, SpeechText.clean(s))
        live = ""
    }

    private mutating func copyPartial(_ whole: String) {
        let s = afterTaskSaid(SpeechText.clean(whole))
        if SpeechText.isFresh(previous: live, next: s) {
            // (the recognizer started over after a pause: the words it dropped are kept)
            committed = SpeechText.join(committed, live)
            restartsCaught += 1
        }
        live = s
    }

    private mutating func copySegmentEnded(_ whole: String) {
        copyPartial(whole)
        committed = SpeechText.join(committed, live)
        live = ""
        let w = SpeechText.clean(whole)
        if !w.isEmpty { taskSaid = w }
    }

    private mutating func copyNewTask() {
        committed = SpeechText.join(committed, live)
        live = ""
        taskSaid = ""
    }

    // MARK: helpers

    /// `s` without the task's already committed words at its start (when the recognizer repeats them).
    private func afterTaskSaid(_ s: String) -> String {
        guard !taskSaid.isEmpty else { return s }
        let said = SpeechText.words(taskSaid), all = SpeechText.words(s)
        guard all.count >= said.count else { return s }
        let a = said.map(SpeechText.norm), b = all.prefix(said.count).map(SpeechText.norm)
        // (the same words; or, for a longer stretch, nearly the same: a word revised in the repeat)
        let same = zip(a, b).filter { $0 == $1 }.count
        guard same == a.count || (a.count >= 3 && same >= a.count - max(1, a.count / 5) && a.first == b.first) else { return s }
        return all.dropFirst(said.count).joined(separator: " ")
    }

    /// Whether `next` is a new transcription rather than a revision of `previous`: shorter, and either starting
    /// differently or much shorter. (A wrong guess repeats a few words; the other way round would lose them.)
    static func isFresh(previous: String, next: String) -> Bool {
        let p = words(previous).map(norm), n = words(next).map(norm)
        guard p.count >= 2, n.count < p.count else { return false }
        if n.isEmpty { return true }
        if Array(n.prefix(2)) != Array(p.prefix(min(2, n.count))) { return true }
        return n.count * 3 <= p.count * 2
    }

    static func words(_ s: String) -> [String] { s.split(whereSeparator: { $0.isWhitespace }).map(String.init) }
    static func norm(_ w: String) -> String { w.lowercased().filter { $0.isLetter || $0.isNumber } }
    static func clean(_ s: String) -> String { words(s).joined(separator: " ") }
    /// (also SpeechInput's: the box's words, then these)
    static func join(_ a: String, _ b: String) -> String {
        let a = a.trimmingCharacters(in: .whitespacesAndNewlines), b = b.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return a + " " + b
    }
}
