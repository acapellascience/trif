import Foundation

// SpeechText.swift on the Mac (mobile/test/speechtext.test.js): the microphone's words only ever grow. Prints
// "speech text: ok" or the first thing wrong, and exits 1 then.

func fail(_ s: String) -> Never { print("FAIL: \(s)"); exit(1) }
func check(_ ok: Bool, _ s: String) { if !ok { fail(s) } }
func eq(_ a: String, _ b: String, _ s: String) { if a != b { fail("\(s): got \"\(a)\", wanted \"\(b)\"") } }

// SpeechAnalyzer: volatile words revised, finals appended in order
do {
    var t = SpeechText()
    t.volatile("make the"); t.volatile("make the header")
    eq(t.text, "make the header", "volatile shown")
    t.final("Make the header blue.")
    t.volatile("and")
    eq(t.text, "Make the header blue. and", "a new stretch after a final")
    t.volatile("and bigger")
    t.final("And bigger.")
    eq(t.text, "Make the header blue. And bigger.", "finals in order")
    t.volatile("")
    eq(t.text, "Make the header blue. And bigger.", "an empty volatile drops nothing committed")
}

// SFSpeechRecognizer: revisions within an utterance replace the live words
do {
    var t = SpeechText()
    t.partial("make the"); t.partial("Make the header"); t.partial("Make the head of")
    eq(t.text, "Make the head of", "a revision replaces the live words")
    t.partial("Make the head of the page blue")
    eq(t.text, "Make the head of the page blue", "growing")
}

// after a pause: the recognizer starts over with only the newest words (no isFinal, no metadata)
do {
    var t = SpeechText()
    t.partial("Make the header blue")
    t.partial("And")
    eq(t.text, "Make the header blue And", "a fresh transcription keeps the words before it")
    t.partial("And make it bigger")
    eq(t.text, "Make the header blue And make it bigger", "the new stretch grows after them")
    check(t.restartsCaught == 1, "one restart caught")
}

// after a pause, starting over with the same first words
do {
    var t = SpeechText()
    t.partial("make the header blue")
    t.partial("make the")
    eq(t.text, "make the header blue make the", "a much shorter transcription is a new one")
    t.partial("make the footer red")
    eq(t.text, "make the header blue make the footer red", "and grows")
}

// the recognizer marks a segment's end, then either starts over or repeats what it said
do {
    var t = SpeechText()
    t.partial("make the header")
    t.segmentEnded("Make the header blue.")
    eq(t.text, "Make the header blue.", "a segment committed")
    t.partial("and bigger")
    eq(t.text, "Make the header blue. and bigger", "fresh words after it")
    t.partial("and bigger please")
    eq(t.text, "Make the header blue. and bigger please", "growing")

    var r = SpeechText()
    r.segmentEnded("Make the header blue.")
    r.partial("Make the header blue. And")
    r.partial("Make the header blue. And bigger")
    eq(r.text, "Make the header blue. And bigger", "a repeat of the segment isn't doubled")
    r.partial("Make the header blue, and bigger")
    eq(r.text, "Make the header blue. and bigger", "a repeat with its punctuation revised isn't doubled")
    r.partial("Make the heading blue and bigger too")
    eq(r.text, "Make the header blue. and bigger too", "a repeat with one word revised isn't doubled")
}

// a task ending by itself (isFinal after about a minute, an error): the next task's words go after
do {
    var t = SpeechText()
    t.partial("one two three")
    t.newTask()
    t.partial("four five")
    eq(t.text, "one two three four five", "a new task appends")
    t.segmentEnded("Four five six.")
    t.newTask()
    t.partial("Seven")
    eq(t.text, "one two three Four five six. Seven", "a final then a new task")
    t.newTask(); t.newTask()
    eq(t.text, "one two three Four five six. Seven", "empty tasks add nothing")
}

// what was committed is never shortened, whatever comes (a random walk of events)
do {
    var gen = SystemRandomNumberGenerator()
    let vocab = ["make", "the", "header", "blue", "and", "bigger", "please", "now", "page", "red", "Make", "The,"]
    func phrase() -> String { (0..<Int.random(in: 0...7, using: &gen)).map { _ in vocab.randomElement(using: &gen)! }.joined(separator: " ") }
    for _ in 0..<2000 {
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

print("speech text: ok")
