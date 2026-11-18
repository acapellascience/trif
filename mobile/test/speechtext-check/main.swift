import Foundation

// SpeechText.swift on the Mac (mobile/test/speechtext.test.js): the microphone's words only ever grow, decided by the
// phones' shared rule (mobile/shared/gen/core.js, TrifCore.speechText, called through Core.swift) and by the Swift
// copy kept for when it can't answer; both against speech-text-cases.json (the answers the Swift gave before the
// move). argv: speech-text-cases.json, gen/core.js. Prints "speech text: ok" or what's wrong, and exits 1 then.

var failures: [String] = []
func check(_ ok: Bool, _ s: String) { if !ok && failures.count < 30 { failures.append(s) } }
func eq(_ a: String, _ b: String, _ s: String) { check(a == b, "\(s): got \"\(a)\", wanted \"\(b)\"") }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}

func stories(_ how: String) {
    // SpeechAnalyzer: volatile words revised, finals appended in order
    do {
        var t = SpeechText()
        t.volatile("make the"); t.volatile("make the header")
        eq(t.text, "make the header", "\(how) volatile shown")
        t.final("Make the header blue.")
        t.volatile("and")
        eq(t.text, "Make the header blue. and", "\(how) a new stretch after a final")
        t.volatile("and bigger")
        t.final("And bigger.")
        eq(t.text, "Make the header blue. And bigger.", "\(how) finals in order")
        t.volatile("")
        eq(t.text, "Make the header blue. And bigger.", "\(how) an empty volatile drops nothing committed")
    }
    // after a pause: the recognizer starts over with only the newest words (no isFinal, no metadata)
    do {
        var t = SpeechText()
        t.partial("Make the header blue")
        t.partial("And")
        eq(t.text, "Make the header blue And", "\(how) a fresh transcription keeps the words before it")
        t.partial("And make it bigger")
        eq(t.text, "Make the header blue And make it bigger", "\(how) the new stretch grows after them")
        check(t.restartsCaught == 1, "\(how) one restart caught")
    }
    // the recognizer marks a segment's end, then repeats what it said
    do {
        var r = SpeechText()
        r.segmentEnded("Make the header blue.")
        r.partial("Make the header blue. And")
        r.partial("Make the header blue. And bigger")
        eq(r.text, "Make the header blue. And bigger", "\(how) a repeat of the segment isn't doubled")
        r.partial("Make the header blue, and bigger")
        eq(r.text, "Make the header blue. and bigger", "\(how) a repeat with its punctuation revised isn't doubled")
        r.partial("Make the heading blue and bigger too")
        eq(r.text, "Make the header blue. and bigger too", "\(how) a repeat with one word revised isn't doubled")
    }
    // a task ending by itself: the next task's words go after
    do {
        var t = SpeechText()
        t.partial("one two three")
        t.newTask()
        t.partial("four five")
        t.segmentEnded("Four five six.")
        t.newTask()
        t.partial("Seven")
        t.newTask(); t.newTask()
        eq(t.text, "one two three Four five six. Seven", "\(how) tasks append, empty ones add nothing")
    }
}

// every recorded run, event by event (the Swift's answers before the move)
func replay(_ how: String) -> Int {
    var n = 0
    for run in cases["runs"] as? [[String: Any]] ?? [] {
        var t = SpeechText()
        let evs = run["events"] as! [[String]], states = run["states"] as! [[String: Any]]
        for (i, e) in evs.enumerated() {
            switch e[0] {
            case "volatile": t.volatile(e[1])
            case "final": t.final(e[1])
            case "partial": t.partial(e[1])
            case "segment": t.segmentEnded(e[1])
            default: t.newTask()
            }
            n += 1
            let w = states[i]
            let ok = t.committed == w["committed"] as! String && t.live == w["live"] as! String && t.taskSaid == w["taskSaid"] as! String
                && t.restartsCaught == (w["restarts"] as! NSNumber).intValue && t.text == SpeechText.join(t.committed, t.live)
            check(ok, "\(how) run \(evs.prefix(i + 1)): got \(t), wanted \(w)")
        }
    }
    return n
}

// the helpers (the Swift copy's; the shared ones are compared by core-speechtext.test.js)
var n = 0
for c in cases["clean"] as? [[String]] ?? [] { n += 1; eq(SpeechText.clean(c[0]), c[1], "clean \(c[0].debugDescription)") }
for c in cases["norm"] as? [[String]] ?? [] { n += 1; eq(SpeechText.norm(c[0]), c[1], "norm \(c[0].debugDescription)") }
for c in cases["join"] as? [[String]] ?? [] { n += 1; eq(SpeechText.join(c[0], c[1]), c[2], "join \(c[0].debugDescription) \(c[1].debugDescription)") }
for c in cases["isFresh"] as? [[Any]] ?? [] {
    n += 1
    let (p, x, want) = (c[0] as! String, c[1] as! String, c[2] as! Bool)
    check(SpeechText.isFresh(previous: p, next: x) == want, "isFresh \(p.debugDescription) → \(x.debugDescription): want \(want)")
}
for shared in [true, false] {
    SpeechText.shared = shared
    let how = shared ? "shared" : "Swift copy"
    stories(how)
    n += replay(how)
}
check(n > 7000, "only \(n) cases")
SpeechText.shared = true

// what was committed is never shortened, whatever comes (a random walk of events, through the shared rule)
do {
    var gen = SystemRandomNumberGenerator()
    let vocab = ["make", "the", "header", "blue", "and", "bigger", "please", "now", "page", "red", "Make", "The,"]
    func phrase() -> String { (0..<Int.random(in: 0...7, using: &gen)).map { _ in vocab.randomElement(using: &gen)! }.joined(separator: " ") }
    for _ in 0..<300 {
        var t = SpeechText()
        var before = ""
        for _ in 0..<40 {
            switch Int.random(in: 0..<6, using: &gen) {
            case 0: t.volatile(phrase())
            case 1: t.final(phrase())
            case 2, 3: t.partial(phrase())
            case 4: t.segmentEnded(phrase())
            default: t.newTask()
            }
            check(t.committed.hasPrefix(before), "committed only grows (\"\(before)\" → \"\(t.committed)\")")
            check(t.text.hasPrefix(t.committed), "the text starts with what's committed")
            before = t.committed
        }
    }
}

// cost: a partial result (every one the recognizer gives), after ten minutes of talk
do {
    var t = SpeechText()
    for i in 0..<150 { t.segmentEnded("this is sentence number \(i) of a long talk about the header, the page and its colours."); t.newTask() }
    t.newTask()
    var said = "and now"
    let t0 = Date()
    for i in 0..<200 { said += " word\(i % 7)"; t.partial(said) }
    let us = Date().timeIntervalSince(t0) / 200 * 1e6
    if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("a partial after \(t.committed.utf8.count) bytes: \(Int(us)) µs") }
    check(us < 5000, "a partial costs \(Int(us)) µs")
}

print(failures.isEmpty ? "speech text: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
