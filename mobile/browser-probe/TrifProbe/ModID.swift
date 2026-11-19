import Foundation
import CryptoKit

/// A mod's stable id and its name (Tim, 11-18: "Knowing it's the same mod should use a separate ID, instead of relying
/// on equivalent names"; docs/PHONE-SYNC.md 2a on branch phone-link, D17): the header's `// @id <id>` line. The text
/// rules are the phones' shared mobile/shared/core/mod-id.js (TrifCore.modId, the desktop's helper/lib/modid.js
/// algorithm, held to the desktop's cases), through Core.swift; the decisions around them (which mod keeps an id in a
/// folder, which id an added mod's text gets, which installed mod an offered one is) are here, as plain values, so the
/// Mac check (mobile/test/modid.test.js) holds them. No UI. If the shared rule doesn't answer, nothing is written: a
/// mod keeps its text as it is (no id stamped, no rename), which is how it was before ids.
enum ModID {
    /// A stable id: 8 to 64 lower-case letters, digits and hyphens, starting with a letter or digit (a Swift twin of
    /// core isId: asked for every mod on every list; held to the same cases).
    static func isId(_ v: String?) -> Bool {
        guard let v, (8...64).contains(v.unicodeScalars.count), let first = v.unicodeScalars.first, first != "-" else { return false }
        return v.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
    }
    /// A new one: a random UUID (v4), lower case.
    static func newId() -> String { UUID().uuidString.lowercased() }

    /// The header's name and id, and the two texts a sync's part revisions hash (core parts).
    struct Parts: Equatable { var name: String?; var uid: String?; var header: Bool; var body: String; var meta: String }
    static func parts(_ text: String) -> Parts? {
        guard let d = Core.shared.call("modId.parts", [text]) as? [String: Any], let body = d["body"] as? String, let meta = d["meta"] as? String else { return nil }
        return Parts(name: d["name"] as? String, uid: d["uid"] as? String, header: d["header"] as? Bool ?? false, body: bom(text, body), meta: meta)
    }
    /// A sync row's part revisions (docs/PHONE-SYNC.md 3): SHA-256 hex of the body (the text without the header's @name
    /// and @id lines) and of the meta (`<name>\n<id>`), UTF-8.
    static func revs(_ text: String) -> (body: String, meta: String)? {
        parts(text).map { (sha($0.body), sha($0.meta)) }
    }
    static func sha(_ s: String) -> String { SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined() }

    /// The text with its @name and/or @id set (nil: that one left as it is); nil if the rule didn't answer.
    static func withMeta(_ text: String, name: String? = nil, uid: String? = nil) -> String? {
        let set: [String: Any] = ["name": name.map { $0 as Any } ?? NSNull(), "uid": uid.map { $0 as Any } ?? NSNull()]
        return (Core.shared.call("modId.withMeta", [text, set]) as? String).map { bom(text, $0) }
    }
    /// (Foundation's JSONSerialization drops a U+FEFF at the start of a string it reads, so an answer that starts as
    /// the text does gets it back: the body and a rewritten file start where the text starts)
    private static func bom(_ text: String, _ out: String) -> String {
        text.unicodeScalars.first == "\u{FEFF}" && out.unicodeScalars.first != "\u{FEFF}" ? "\u{FEFF}" + out : out
    }
    /// The file a name gives in a folder: `<slug>.js`, `-2`… past the others' files (any case); `own` is the mod's file.
    static func fileFor(_ name: String, taken: [String], own: String?) -> String? {
        Core.shared.call("modId.fileFor", [name, taken, own ?? NSNull()]) as? String
    }
    /// Why a name can't be one ("" when it can; nil: no answer).
    static func checkName(_ name: String) -> String? { Core.shared.call("modId.checkName", [name]) as? String }

    /// A mod as identity reads it.
    struct Entry: Equatable { var id: String; var site: String; var file: String; var uid: String?; var name: String = "" }

    /// One device (2a): a mod is its folder and its id. Two in one folder with one id (a copied file): the first by
    /// file name keeps it, the others count as having none. Answer: file id → the id it keeps.
    static func kept(_ mods: [Entry]) -> [String: String] {
        var first: [String: Entry] = [:]
        for m in mods where isId(m.uid) {
            let k = "\(m.site)#\(m.uid!)"
            if let f = first[k], f.file.compare(m.file, options: .literal) != .orderedDescending { continue }
            first[k] = m
        }
        return Dictionary(first.values.map { ($0.id, $0.uid!) }, uniquingKeysWith: { a, _ in a })
    }

    /// The id to write into an added mod's text (nil: leave the text as it is). TRIF gives one whenever it writes a mod
    /// for the person (a chat's add, an import, a paste, a link, an edit, a restore: `source`), never when it copies one
    /// from the computer (`computer`: the other side's bytes, so revisions stay equal). `has`: the id the text keeps
    /// already; `before`: the id of the mod it replaces (an update without @id keeps that mod's).
    static func stamp(has: String?, before: String?, source: String) -> String? {
        guard source != "computer", has == nil else { return nil }
        return before ?? newId()
    }

    /// Which installed mod an offered or imported one is a new version of: one on its site with its stable id first
    /// (whatever its name or file), then (`byName`: a chat's or a paste's code) one on its site with its @name, as
    /// before. nil: it's a mod of its own (its own file id).
    static func same(_ m: Entry, among installed: [Entry], byName: Bool) -> Entry? {
        if isId(m.uid), let s = installed.first(where: { $0.site == m.site && $0.uid == m.uid }) { return s.id == m.id ? nil : s }
        guard byName, !installed.contains(where: { $0.id == m.id }) else { return nil }
        // (a mod whose id is another's isn't taken by name: two mods, apart)
        return installed.first { $0.name == m.name && $0.site == m.site && !(isId(m.uid) && isId($0.uid) && $0.uid != m.uid) }
    }

    /// Where a mod just read is kept: under the installed mod it's a new version of (`same`), or its own file id; and
    /// when that file id is another mod's whose id isn't its own (two mods with one name), beside it, `-2`… (as a
    /// rename past another's file goes). `replaces`: the installed mod's file id it updates (its id carries over), or
    /// nil for a mod of its own.
    static func place(_ m: Entry, among installed: [Entry], byName: Bool) -> (file: String, site: String, replaces: String?) {
        if let t = same(m, among: installed, byName: byName) { return (t.file, t.site, t.id) }
        guard let here = installed.first(where: { $0.id == m.id }) else { return (m.file, m.site, nil) }
        guard isId(m.uid), isId(here.uid), here.uid != m.uid,
              let f = fileFor(String(m.file.dropLast(3)), taken: installed.filter { $0.site == m.site }.map(\.file), own: nil) else { return (m.file, m.site, here.id) }
        return (f, m.site, nil)
    }

    /// A rename (2a "Renaming"): the new file id in its folder (`<site>/<slug>`, `-2`… past the folder's other files), or
    /// nil with why it can't be (the name's check), or nil and nil when the rule didn't answer.
    static func renamed(_ m: Entry, to name: String, folder: [Entry]) -> (id: String?, why: String?) {
        guard let why = checkName(name) else { return (nil, nil) }
        guard why.isEmpty else { return (nil, why) }
        let taken = folder.filter { $0.site == m.site && $0.id != m.id }.map(\.file)
        guard let file = fileFor(name, taken: taken, own: m.file), file.hasSuffix(".js") else { return (nil, nil) }
        return ("\(m.site)/\(file.dropLast(3))", nil)
    }
}
