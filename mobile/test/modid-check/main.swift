import Foundation

// ModID.swift (stable mod ids and renames: docs/PHONE-SYNC.md 2a, Tim 11-18) and Core.swift, built for the Mac by
// mobile/test/modid.test.js: the text rules called through the shared core (mobile/shared/core/mod-id.js) against the
// desktop's cases, the Swift twin isId, and the decisions made here: which mod keeps an id in a folder, which id an
// added mod's text gets (stamping), which installed mod an offered or imported one is (by id first, then by @name),
// and where a rename puts the file. argv: mod-id-cases.json, gen/core.js. Prints "mod id: ok" or the failures.
var failures: [String] = []
func check(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let d = FileManager.default.contents(atPath: args[1]), let cases = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}

// the text rules, through the shared core, give the desktop's answers
for c in cases["ids"] as! [[Any]] {
    let v = c[0] as! String, want = c[1] as! Bool
    check(ModID.isId(v) == want, "isId (twin) \(v)")
    check(Core.shared.call("modId.isId", [v]) as? Bool == want, "isId (core) \(v)")
}
check(!ModID.isId(nil) && !ModID.isId("abcdefgé") && !ModID.isId("abcdefg\u{301}h"), "isId: nil, accents, combining marks")
let texts = cases["texts"] as! [String: [String: Any]]
// (JSONSerialization drops a U+FEFF that starts a string, so the "bom" case's texts get theirs back here)
let fixed = { (k: String, s: String) in k == "bom" && s.unicodeScalars.first != "\u{FEFF}" ? "\u{FEFF}" + s : s }
for (k, c) in texts {
    let text = fixed(k, c["text"] as! String)
    let meta = c["meta"] as! [String: Any]
    guard let p = ModID.parts(text) else { check(false, "parts \(k): no answer"); continue }
    check(p.name == meta["name"] as? String && p.uid == meta["uid"] as? String && p.header == meta["header"] as? Bool, "parts \(k) meta: \(p)")
    check(p.body.unicodeScalars.elementsEqual(fixed(k, c["body"] as! String).unicodeScalars), "parts \(k) body")
    check(p.meta == c["metaText"] as? String, "parts \(k) metaText")
    let revs = c["revs"] as! [String: String]
    let r = ModID.revs(text)
    check(r?.body == revs["body"] && r?.meta == revs["meta"], "revs \(k) (CryptoKit's SHA-256 of the core's texts): \(String(describing: r))")
}
for w in cases["withMeta"] as! [[String: Any]] {
    let set = w["set"] as! [String: String]
    let k = w["text"] as! String
    let out = ModID.withMeta(fixed(k, texts[k]!["text"] as! String), name: set["name"], uid: set["uid"])
    check(out.map { Array($0.unicodeScalars) } == Array(fixed(k, w["out"] as! String).unicodeScalars), "withMeta \(k) \(set)")
}
for c in cases["files"] as! [[Any]] {
    check(ModID.fileFor(c[0] as! String, taken: c[1] as! [String], own: c[2] as? String) == c[3] as? String, "fileFor \(c)")
}
for c in cases["names"] as! [[Any]] { check(ModID.checkName(c[0] as! String) == c[1] as? String, "checkName \(c[0])") }

// one device: two in a folder with one id: the first by file name keeps it; another folder's is another mod
typealias E = ModID.Entry
let a1 = E(id: "x.com/b-copy", site: "x.com", file: "b-copy.js", uid: "aaaaaaaa-1"), a0 = E(id: "x.com/a", site: "x.com", file: "a.js", uid: "aaaaaaaa-1")
let a2 = E(id: "y.com/a", site: "y.com", file: "a.js", uid: "aaaaaaaa-1"), none = E(id: "x.com/n", site: "x.com", file: "n.js", uid: nil)
let bad = E(id: "x.com/bad", site: "x.com", file: "bad.js", uid: "NOT_AN_ID")
let kept = ModID.kept([a1, a0, a2, none, bad])
check(kept == ["x.com/a": "aaaaaaaa-1", "y.com/a": "aaaaaaaa-1"], "kept: the first by file name, per folder: \(kept)")

// the sync key (D16): <site>#<id> with one, else the file id
check(PhoneSync.key("x.com/a", uid: "aaaaaaaa-1") == "x.com#aaaaaaaa-1" && PhoneSync.key("x.com/a", uid: nil) == "x.com/a"
      && PhoneSync.key("x.com/a", uid: "BAD") == "x.com/a", "sync key")

// stamping: TRIF writes it for the person; never a sync's copy; an update keeps the mod's id
check(ModID.stamp(has: nil, before: nil, source: "computer") == nil, "a sync's copy is never stamped")
check(ModID.stamp(has: "aaaaaaaa-1", before: "bbbbbbbb-2", source: "chat") == nil, "an id of its own stays")
check(ModID.stamp(has: nil, before: "bbbbbbbb-2", source: "chat") == "bbbbbbbb-2", "an update without @id gets the mod's id")
for src in ["chat", "import", "link", "pasted", "edit", "restore", "undo"] {
    let u = ModID.stamp(has: nil, before: nil, source: src)
    check(ModID.isId(u) && u?.count == 36 && u == u?.lowercased(), "a new mod from \(src) gets a new UUID in lower case: \(String(describing: u))")
}
check(ModID.stamp(has: nil, before: nil, source: "chat") != ModID.stamp(has: nil, before: nil, source: "chat"), "new ids differ")

// the same mod: by id first (whatever its name or file), then by @name (a chat's code), as before
let feed = E(id: "x.com/calmer-feed", site: "x.com", file: "calmer-feed.js", uid: "aaaaaaaa-1", name: "Calmer feed")
let old = E(id: "x.com/old-one", site: "x.com", file: "old-one.js", uid: nil, name: "Old one")
let installed = [feed, old]
check(ModID.same(E(id: "x.com/quiet-feed", site: "x.com", file: "quiet-feed.js", uid: "aaaaaaaa-1", name: "Quiet feed"), among: installed, byName: true) == feed, "by id: renamed elsewhere, still the mod")
check(ModID.same(E(id: "x.com/quiet-feed", site: "x.com", file: "quiet-feed.js", uid: "aaaaaaaa-1", name: "Quiet feed"), among: installed, byName: false) == feed, "by id: an import of an exported copy under another file")
check(ModID.same(E(id: "y.com/calmer-feed", site: "y.com", file: "calmer-feed.js", uid: "aaaaaaaa-1", name: "Calmer feed"), among: installed, byName: true) == nil, "another site's id: another mod")
check(ModID.same(E(id: "x.com/calmer-feed", site: "x.com", file: "calmer-feed.js", uid: "aaaaaaaa-1", name: "Calmer feed"), among: installed, byName: true) == nil, "its own file id already: no move")
check(ModID.same(E(id: "x.com/old-one-v2", site: "x.com", file: "old-one-v2.js", uid: nil, name: "Old one"), among: installed, byName: true) == old, "no id: by @name, as before")
check(ModID.same(E(id: "x.com/old-one-v2", site: "x.com", file: "old-one-v2.js", uid: nil, name: "Old one"), among: installed, byName: false) == nil, "an import: not by name")
check(ModID.same(E(id: "x.com/calmer-2", site: "x.com", file: "calmer-2.js", uid: "cccccccc-3", name: "Calmer feed"), among: installed, byName: true) == nil, "another id with the same name: two mods")
check(ModID.same(E(id: "x.com/calmer-2", site: "x.com", file: "calmer-2.js", uid: nil, name: "Calmer feed"), among: installed, byName: true) == feed, "the name, no id of its own: that mod")

// where a mod just read is kept: an update (its id carries over), a mod of its own, or beside another of its name
let pl1 = ModID.place(E(id: "x.com/calmer-feed", site: "x.com", file: "calmer-feed.js", uid: nil, name: "Calmer feed"), among: installed, byName: true)
check(pl1.file == "calmer-feed.js" && pl1.replaces == "x.com/calmer-feed", "no id, the mod's own file id: an update of it: \(pl1)")
let pl2 = ModID.place(E(id: "x.com/calmer-feed", site: "x.com", file: "calmer-feed.js", uid: "cccccccc-3", name: "Calmer feed"), among: installed + [E(id: "x.com/calmer-feed-2", site: "x.com", file: "calmer-feed-2.js", uid: nil)], byName: true)
check(pl2.file == "calmer-feed-3.js" && pl2.replaces == nil, "another id at a mod's file id: beside it, past the taken -2: \(pl2)")
let pl3 = ModID.place(E(id: "x.com/quiet", site: "x.com", file: "quiet.js", uid: "aaaaaaaa-1", name: "Quiet"), among: installed, byName: false)
check(pl3.file == "calmer-feed.js" && pl3.replaces == "x.com/calmer-feed", "an import whose id is a mod's: that mod: \(pl3)")
let pl4 = ModID.place(E(id: "x.com/old-one", site: "x.com", file: "old-one.js", uid: "dddddddd-4", name: "Old one"), among: installed, byName: true)
check(pl4.file == "old-one.js" && pl4.replaces == "x.com/old-one", "the mod there has no id: an update, and it takes this one's: \(pl4)")
let pl5 = ModID.place(E(id: "x.com/new", site: "x.com", file: "new.js", uid: nil, name: "New"), among: installed, byName: true)
check(pl5.file == "new.js" && pl5.replaces == nil, "a mod of its own")

// a rename's file: the slug, -2 past the folder's others (any case), its own file kept when the slug is its own
let other = E(id: "x.com/quiet-feed", site: "x.com", file: "Quiet-Feed.js", uid: nil, name: "Quiet")
let r1 = ModID.renamed(feed, to: "Quiet feed", folder: [feed, other, a2])
check(r1.id == "x.com/quiet-feed-2" && r1.why == nil, "renamed past another's file: \(r1)")
check(ModID.renamed(feed, to: "  Calmer feed!  ", folder: [feed]).id == "x.com/calmer-feed", "the same slug: the file stays")
check(ModID.renamed(feed, to: "  ", folder: [feed]).why == "a name can't be empty" && ModID.renamed(feed, to: "a\nb", folder: [feed]).why == "a name is one line", "refused names")
check(ModID.renamed(E(id: "all-sites/x", site: "all-sites", file: "x.js", uid: nil), to: "Dark everywhere", folder: []).id == "all-sites/dark-everywhere", "an every-site mod's rename")
check(ModID.renamed(feed, to: "日本語", folder: [feed]).id == "x.com/mod", "nothing left: mod")

// a rename's text: the name set, the id added after it; a CRLF file keeps its line ends
let t = texts["plain"]!["text"] as! String
let renamedText = ModID.withMeta(t, name: "Quiet feed", uid: "3f2b8c1e-6d4a-4b7e-9c1f-2a5d8e7b9c01")
check(renamedText.flatMap(ModID.parts)?.name == "Quiet feed" && renamedText.flatMap(ModID.parts)?.uid == "3f2b8c1e-6d4a-4b7e-9c1f-2a5d8e7b9c01", "rename text")
check(renamedText.flatMap(ModID.revs)?.body == ModID.revs(t)?.body, "a rename changes the meta alone, not the body")

// cost: a sync row's parts (a 100 KB mod)
let big = t + String(repeating: "x(); // padding\n", count: 6500)
let c0 = Date()
for _ in 0..<20 { _ = ModID.revs(big) }
let ms = Date().timeIntervalSince(c0) * 1000 / 20
if ProcessInfo.processInfo.environment["TRIF_COST"] != nil { print("cost: revs of a \(big.utf8.count / 1024) KB mod \(String(format: "%.2f", ms)) ms") }

print(failures.isEmpty ? "mod id: ok" : failures.joined(separator: "\n"))
exit(failures.isEmpty ? 0 : 1)
