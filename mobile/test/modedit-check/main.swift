import Foundation

// ModEdits.swift (a chat's edit blocks for a mod, Tim 11-19; a shortened whole file caught: the phones' shared rule
// mobile/shared/gen/core.js, TrifCore.modEdit, called through Core.swift) and its refusals' words, built for the Mac
// by modedit.test.js. argv: gen/core.js.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 1 { Core.source = URL(fileURLWithPath: args[1]) } else { failures.append("no core.js (argv[1])") }
Core.report = { failures.append("Core: " + $0) }

let mod = """
// ==WebMod==
// @name        Calmer feed
// @match       https://www.youtube.com/*
// @style
// ==/WebMod==
({
  "css": [
    "#related { display: none; }",
    "#chips { opacity: 0.6; }"
  ]
})

"""
let other = "// ==WebMod==\n// @name        Other\n// @match       https://x.com/*\n// @style\n// ==/WebMod==\n({ \"css\": [\"a { color: red; }\"] })\n"
let v = ModEdits.version(mod) ?? "?"
check(v.count == 8, "version: \(v)")
let mods = [ModEdits.Mod(id: "youtube.com/calmer-feed", name: "Calmer feed", code: mod, history: []),
            ModEdits.Mod(id: "x.com/other", name: "Other", code: other, history: [])]
func blk(_ s: String, _ r: String) -> String { "<<<<<<< SEARCH\n\(s)\n=======\n\(r)\n>>>>>>> REPLACE" }

// (a whole file: as before)
if case .whole = ModEdits.resolve("```js\n\(mod)```", mods: mods) {} else { check(false, "whole file not whole") }
check(!ModEdits.has(mod), "has(whole)")

// (two blocks, two code blocks of one reply, applied in order; the changes as the review shows them)
let text = "Here:\n```\nTRIF edit youtube.com/calmer-feed \(v)\n\(blk("    \"#chips { opacity: 0.6; }\"", "    \"#chips { opacity: 0.3; }\""))\n```\n```\n\(blk("    \"#related { display: none; }\",", "    \"#related { display: none; }\",\n    \"#comments { display: none; }\","))\n```"
switch ModEdits.resolve(text, mods: mods) {
case .edited(let list):
    check(list.count == 1 && list[0].id == "youtube.com/calmer-feed", "edited: \(list.map(\.id))")
    check(list[0].code.contains("opacity: 0.3") && list[0].code.contains("#comments"), "edited code: \(list[0].code)")
    check(list[0].changes.count == 2, "changes: \(list[0].changes)")
    check(list[0].changes.last?.added == ["    \"#comments { display: none; }\","] && list[0].changes.last?.removed == [], "insert change: \(String(describing: list[0].changes.last))")
default: check(false, "two blocks: not edited")
}
// (two mods' edits in one text)
let ov = ModEdits.version(other) ?? "?"
let both = "TRIF edit youtube.com/calmer-feed \(v)\n\(blk("    \"#chips { opacity: 0.6; }\"", "    \"#chips { opacity: 0.1; }\""))\nTRIF edit x.com/other \(ov)\n\(blk("({ \"css\": [\"a { color: red; }\"] })", "({ \"css\": [\"a { color: blue; }\"] })"))"
if case .edited(let list) = ModEdits.resolve(both, mods: mods) { check(list.map(\.id) == ["youtube.com/calmer-feed", "x.com/other"], "both: \(list.map(\.id))") } else { check(false, "both: not edited") }
// (one of them doesn't fit: nothing at all)
let half = "TRIF edit youtube.com/calmer-feed \(v)\n\(blk("    \"#chips { opacity: 0.6; }\"", "x"))\nTRIF edit x.com/other \(ov)\n\(blk("not in it", "y"))"
if case .refused(let id, let why, let b) = ModEdits.resolve(half, mods: mods) { check(id == "x.com/other" && why == .nomatch && b == 0, "half: \(String(describing: id)) \(why) \(String(describing: b))") } else { check(false, "half: not refused") }
// (stale, no version, no such mod, unreadable, twice)
let changed = mods.map { m -> ModEdits.Mod in var x = m; if x.id == "youtube.com/calmer-feed" { x.code = mod.replacingOccurrences(of: "#related", with: "#secondary") }; return x }
if case .refused(_, let why, _) = ModEdits.resolve("TRIF edit youtube.com/calmer-feed \(v)\n\(blk("    \"#chips { opacity: 0.6; }\"", "x"))", mods: changed) { check(why == .stale, "stale: \(why)") } else { check(false, "stale: not refused") }
if case .refused(let id, let why, _) = ModEdits.resolve("TRIF edit youtube.com/calmer-feed\n\(blk("    \"#chips { opacity: 0.6; }\"", "x"))", mods: mods) { check(why == .noversion && id == "youtube.com/calmer-feed", "noversion: \(why)") } else { check(false, "noversion: not refused") }
if case .refused(let id, let why, _) = ModEdits.resolve("TRIF edit nope.com/none \(v)\n\(blk("a", "b"))", mods: mods) { check(why == .nofile && id == nil, "nofile: \(why)") } else { check(false, "nofile: not refused") }
if case .refused(_, let why, _) = ModEdits.resolve("TRIF edit youtube.com/calmer-feed \(v)\n<<<<<<< SEARCH\n=======\nb\n>>>>>>> REPLACE", mods: mods) { check(why == .unreadable, "unreadable: \(why)") } else { check(false, "unreadable: not refused") }
let dup = mod + "// a\n// a\n"
if case .refused(_, let why, let b) = ModEdits.resolve("TRIF edit youtube.com/calmer-feed \(ModEdits.version(dup)!)\n\(blk("// a", "// b"))", mods: [ModEdits.Mod(id: "youtube.com/calmer-feed", name: "Calmer feed", code: dup, history: [])]) { check(why == .many && b == 0, "many: \(why)") } else { check(false, "many: not refused") }
// (in already: the mod's code now is the edit's result, its version before in History)
let after = mod.replacingOccurrences(of: "0.6", with: "0.2")
if case .already(let ids) = ModEdits.resolve("TRIF edit youtube.com/calmer-feed \(v)\n\(blk("    \"#chips { opacity: 0.6; }\"", "    \"#chips { opacity: 0.2; }\""))", mods: [ModEdits.Mod(id: "youtube.com/calmer-feed", name: "Calmer feed", code: after, history: [mod])]) {
    check(ids == ["youtube.com/calmer-feed"], "already: \(ids)")
} else { check(false, "already: not already") }

// (a shortened file)
let cut = mod.replacingOccurrences(of: "    \"#related { display: none; }\",\n", with: "    // ... rest unchanged ...\n")
let e = ModEdits.elided(cut, current: mod)
check(e?.line == 8 && e?.text == "// ... rest unchanged ...", "elided: \(String(describing: e))")
check(ModEdits.elided(mod, current: mod) == nil, "elided(self)")

// (the refusals' words: the mod's name, its edit line, and the code itself only when it changed since)
let line = "TRIF edit youtube.com/calmer-feed \(v)"
let stale = ChatRefusal.edits(.stale, mod: ("youtube.com/calmer-feed", "Calmer feed", mod), block: nil)
check(stale.request.contains(line) && stale.request.contains(mod) && stale.note.contains("Calmer feed"), "stale words: \(stale)")
let nm = ChatRefusal.edits(.nomatch, mod: ("youtube.com/calmer-feed", "Calmer feed", mod), block: 1)
check(nm.request.hasPrefix("Change 2 ") && nm.request.contains(line) && !nm.request.contains("```"), "nomatch words: \(nm.request)")
let none = ChatRefusal.edits(.nofile, mod: nil, block: nil)
check(none.note.contains("a mod here") && none.log.contains("no mod found"), "nofile words: \(none)")
let sh = ChatRefusal.shortened(("youtube.com/calmer-feed", "Calmer feed", mod), line: 8, text: "// ... rest unchanged ...")
check(sh.request.contains("line 8: // ... rest unchanged ...") && sh.request.contains(line), "shortened words: \(sh.request)")

// (the cost: a 5,000-line mod, 20 edits, through JavaScriptCore)
let big = (0..<5000).map { "const v\($0) = \($0); // line \($0)" }.joined(separator: "\n")
let bv = ModEdits.version(big) ?? "?"
let edits = (0..<20).map { blk("const v\($0 * 200) = \($0 * 200); // line \($0 * 200)", "const v\($0 * 200) = -1;") }.joined(separator: "\n")
let t0 = Date()
if case .edited(let l) = ModEdits.resolve("TRIF edit a.com/big \(bv)\n\(edits)", mods: [ModEdits.Mod(id: "a.com/big", name: "Big", code: big, history: [])]) { check(l[0].changes.count == 20, "big: \(l[0].changes.count)") } else { check(false, "big: not edited") }
let ms = Date().timeIntervalSince(t0) * 1000

if failures.isEmpty { print("mod edit: ok"); print(String(format: "a 5,000-line mod, 20 edits: %.0f ms", ms)) } else { failures.forEach { print($0) }; exit(1) }
