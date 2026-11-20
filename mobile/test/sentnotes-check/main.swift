// The notes of sends whose replies TRIF hasn't seen end (SentNotes.swift, Tim 11-20: a reply picked up after the app
// was ended mid-reply) on the Mac: one note per chat, cleared, a new chat's address followed (a provisional one
// replaced by its own, never by another conversation), kept across launches in its file, notes over an hour old
// dropped, a broken file read as none. argv[1]: a folder to write in. Prints "sent notes: ok" or the failures.
import Foundation

var failures: [String] = []
func expect(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }

guard CommandLine.arguments.count > 1 else { print("no folder (argv[1])"); exit(1) }
let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let file = dir.appendingPathComponent("chat-sent.json")
let now = Date()
func note(_ service: String, _ site: String, conv: String? = nil, ago: TimeInterval = 10, print p: String? = "11:0a1b2c3d", quick: String? = nil) -> SentNote {
    SentNote(service: service, site: site, conv: conv, tab: UUID().uuidString, at: now.addingTimeInterval(-ago), users: 2, print: p, quick: quick)
}

// (nothing yet: no file, no notes)
var s = SentNotes(file: file)
expect(s.all.isEmpty, "a missing file is no notes")
expect(s.due(now: now).due.isEmpty, "nothing due with no notes")

// (one per chat: a second send in the same chat replaces the first; another site's is its own)
s.put(note("Claude", "x.com", conv: "https://claude.ai/chat/a1"))
s.put(note("Claude", "x.com", conv: "https://claude.ai/chat/a2", ago: 5))
s.put(note("ChatGPT", "x.com"))
s.put(note("Claude", "bbc.com", conv: "https://claude.ai/chat/b1", ago: 20, quick: "make it calmer"))
expect(s.all.count == 3, "one note per service and site: \(s.all.map(\.key))")
expect(s.note(for: "Claude|x.com")?.conv == "https://claude.ai/chat/a2", "the later send's note kept")
expect(s.note(for: "Claude|bbc.com")?.quick == "make it calmer", "a quick ask's request kept")

// (kept across launches: a new store reads the file)
var t = SentNotes(file: file)
expect(t.all == s.all, "read back from its file as written")

// (a new chat's address followed; a provisional one replaced by its own; never one conversation by another)
t.follow("ChatGPT|x.com", conv: "https://chatgpt.com/c/local-chatgpt%3A1234-0000")
expect(t.note(for: "ChatGPT|x.com")?.conv == "https://chatgpt.com/c/local-chatgpt%3A1234-0000", "a new chat's first address noted")
t.follow("ChatGPT|x.com", conv: "https://chatgpt.com/c/own1")
expect(t.note(for: "ChatGPT|x.com")?.conv == "https://chatgpt.com/c/own1", "a provisional address replaced by its own")
t.follow("ChatGPT|x.com", conv: "https://chatgpt.com/c/other")
expect(t.note(for: "ChatGPT|x.com")?.conv == "https://chatgpt.com/c/own1", "another conversation never replaces the note's")
t.follow("Claude|x.com", conv: "https://claude.ai/chat/zz")
expect(t.note(for: "Claude|x.com")?.conv == "https://claude.ai/chat/a2", "a note's own address isn't replaced")
t.follow("Claude|nobody.com", conv: "https://claude.ai/chat/q")
expect(t.note(for: "Claude|nobody.com") == nil, "following a chat with no note makes none")
expect(SentNotes(file: file).note(for: "ChatGPT|x.com")?.conv == "https://chatgpt.com/c/own1", "the followed address written")
expect(SentNotes.provisional("https://chatgpt.com/c/local-chatgpt:abc") && SentNotes.provisional("https://chatgpt.com/c/local-chatgpt%3Aabc"), "provisional addresses, : or %3A")
expect(!SentNotes.provisional("https://chatgpt.com/c/68f0") && !SentNotes.provisional(nil) && !SentNotes.provisional("https://claude.ai/chat/local-x"), "own addresses aren't provisional")

// (cleared when the reply is seen ending; clearing twice is nothing)
expect(t.clear("Claude|x.com"), "a note cleared")
expect(!t.clear("Claude|x.com"), "cleared again: nothing")
expect(SentNotes(file: file).note(for: "Claude|x.com") == nil, "the clear written")

// (due: newest first; an hour old and more, or from the future past 5 minutes (a clock put back), dropped)
t.put(note("Claude", "old.com", conv: "https://claude.ai/chat/o", ago: 3601))
t.put(note("Claude", "edge.com", conv: "https://claude.ai/chat/e", ago: 3599))
t.put(note("Claude", "future.com", conv: "https://claude.ai/chat/f", ago: -600))
t.put(note("Claude", "soon.com", conv: "https://claude.ai/chat/s", ago: -60))
let (due, old) = t.due(now: now)
expect(Set(old.map(\.site)) == ["old.com", "future.com"], "an hour old and the future dropped: \(old.map(\.site))")
expect(due.map(\.site) == ["soon.com", "x.com", "bbc.com", "edge.com"], "due newest first: \(due.map(\.site))")
expect(SentNotes(file: file).note(for: "Claude|old.com") == nil, "the dropped notes written out")
expect(t.due(now: now).old.isEmpty, "dropped once")

// (the last note cleared: the file goes)
for n in t.all { t.clear(n.key) }
expect(!FileManager.default.fileExists(atPath: file.path), "no notes, no file")

// (a broken file is no notes, and the next note writes a good one)
try! Data("{not json".utf8).write(to: file)
var b = SentNotes(file: file)
expect(b.all.isEmpty, "a broken file read as no notes")
b.put(note("Claude", "x.com", conv: "https://claude.ai/chat/a3", print: nil))
expect(SentNotes(file: file).note(for: "Claude|x.com")?.print == nil && SentNotes(file: file).all.count == 1, "written again after a broken file; a note with no fingerprint")

// (the file is small: 20 notes)
for i in 0..<20 { b.put(note("Claude", "site\(i).com", conv: "https://claude.ai/chat/\(i)", quick: String(repeating: "w", count: 80))) }
let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? -1
expect(size > 0 && size < 12_000, "20 notes in \(size) bytes")

print(failures.isEmpty ? "sent notes: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
