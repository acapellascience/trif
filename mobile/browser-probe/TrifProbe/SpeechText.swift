// The words heard while the microphone listens, put together so they only ever grow (Tim, 11-18: "If you pause, it
// deletes the things you've said so far"). No UI, no Speech framework: built for the Mac too (mobile/test/
// speechtext-check). SpeechInput (QuickAsk.swift) feeds it whatever recognizer it runs:
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
    private var taskSaid = ""
    /// How many times a fresh transcription was caught replacing the live words (kept, for Diagnostics).
    private(set) var restartsCaught = 0

    init() {}

    /// Everything heard, in order.
    var text: String { SpeechText.join(committed, live) }

    // MARK: SpeechAnalyzer

    /// The words being heard now, not final yet.
    mutating func volatile(_ s: String) { live = SpeechText.clean(s) }

    /// A finished stretch: appended after the earlier ones.
    mutating func final(_ s: String) {
        committed = SpeechText.join(committed, SpeechText.clean(s))
        live = ""
    }

    // MARK: SFSpeechRecognizer

    /// A partial result: `whole` is the task's best transcription so far.
    mutating func partial(_ whole: String) {
        let s = afterTaskSaid(SpeechText.clean(whole))
        if SpeechText.isFresh(previous: live, next: s) {
            // (the recognizer started over after a pause: the words it dropped are kept)
            committed = SpeechText.join(committed, live)
            restartsCaught += 1
        }
        live = s
    }

    /// The recognizer marked the utterance done (isFinal, or metadata after a pause): `whole` is the task's text.
    mutating func segmentEnded(_ whole: String) {
        partial(whole)
        committed = SpeechText.join(committed, live)
        live = ""
        let w = SpeechText.clean(whole)
        if !w.isEmpty { taskSaid = w }
    }

    /// The task ended (by itself, or for the next one): what was live is kept, the next task starts afresh.
    mutating func newTask() {
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
    static func join(_ a: String, _ b: String) -> String {
        let a = a.trimmingCharacters(in: .whitespacesAndNewlines), b = b.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return a + " " + b
    }
}
