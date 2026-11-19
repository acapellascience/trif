import Foundation

/// A chat's changes to a mod as edit blocks (Tim, 11-19: "so they could just change the necessary lines and then we
/// parse that on the app side"), and a whole file a chat shortened ("// rest unchanged") caught before it replaces a
/// mod. The phones' shared rule: mobile/shared/core/mod-edit.js (TrifCore.modEdit), through Core.swift, once a
/// hand-over (not a hot path). The words stay Swift (Browser, ModOfferView). No UI: the Mac check
/// (mobile/test/modedit.test.js) builds it.
enum ModEdits {
    /// One change as the review shows it: the lines it takes out and puts in (1-based `line` in the new code), with the
    /// unchanged line above and below; `loose`: matched ignoring whitespace.
    struct Change: Codable, Equatable {
        var line: Int
        var removed: [String]
        var added: [String]
        var above: String?
        var below: String?
        var loose: Bool
    }
    /// A mod here, as an edit is judged against it: its file id, @name, code now and earlier versions' codes.
    struct Mod {
        var id: String
        var name: String
        var code: String
        var history: [String]
    }
    /// Why a reply's edits weren't applied (nothing was).
    enum Why: String { case stale, noversion, nomatch, many, nofile, unreadable, other }
    /// What a chat's text comes to.
    enum Outcome {
        /// no edit blocks: a whole mod, read as ever
        case whole
        /// every edit applied: per mod, its new code and the changes (in order)
        case edited([(id: String, code: String, changes: [Change])])
        /// edits that are in already (an Add to TRIF tapped again): nothing to offer
        case already([String])
        /// nothing applied: the mod (nil: none found), why, and the block (0-based) that didn't fit
        case refused(id: String?, why: Why, block: Int?)
    }

    /// The version tag the prompt gives with a mod's code (8 hex digits). No answer: nil (the prompt goes without one,
    /// so a chat sends a whole file).
    static func version(_ code: String) -> String? { Core.shared.call("modEdit.version", [code]) as? String }

    /// Whether a text has edit blocks at all (no answer: no, it's read as a whole mod, as before).
    static func has(_ text: String) -> Bool { Core.shared.call("modEdit.has", [text]) as? Bool ?? false }

    /// A chat's text against the mods here: whole, edited, already in, or refused. All or nothing: one edit that
    /// doesn't fit, and none of the text's edits apply. No answer from the shared rule: refused (nothing changes).
    static func resolve(_ text: String, mods: [Mod]) -> Outcome {
        guard has(text) else { return .whole }
        guard let p = Core.shared.call("modEdit.parse", [text]) as? [String: Any], let edits = p["edits"] as? [[String: Any]] else { return .refused(id: nil, why: .other, block: nil) }
        if edits.isEmpty { return .refused(id: nil, why: .unreadable, block: nil) }
        let list = mods.map { ["id": $0.id, "name": $0.name] }
        var done: [(id: String, code: String, changes: [Change])] = []
        var already: [String] = []
        for e in edits {
            let file = e["file"] as? String
            guard let id = Core.shared.call("modEdit.target", [file, list]) as? String, let m = mods.first(where: { $0.id == id }) else {
                return .refused(id: nil, why: file == nil ? .noversion : .nofile, block: nil)
            }
            // (a second edit for the same mod in one text: against the first's result)
            let current = done.last(where: { $0.id == id })?.code ?? m.code
            if e["version"] is NSNull || e["version"] == nil { return .refused(id: id, why: .noversion, block: nil) }
            // (an edit for a mod a block before it changed: its version is the code before)
            var edit = e
            if current != m.code, let v = version(m.code), (e["version"] as? String)?.lowercased() == v, let nv = version(current) { edit["version"] = nv }
            guard let r = Core.shared.call("modEdit.take", [edit, current, m.history]) as? [String: Any] else { return .refused(id: id, why: .other, block: nil) }
            if r["ok"] as? Bool == true, let code = r["code"] as? String {
                let changes = (r["changes"] as? [[String: Any]] ?? []).compactMap(change)
                if let i = done.firstIndex(where: { $0.id == id }) { done[i].code = code; done[i].changes += changes } else { done.append((id, code, changes)) }
                continue
            }
            let why = r["why"] as? String ?? ""
            if why == "already" { already.append(id); continue }
            return .refused(id: id, why: Why(rawValue: why) ?? .other, block: r["block"] as? Int)
        }
        if done.isEmpty { return .already(already) }
        return .edited(done)
    }

    private static func change(_ d: [String: Any]) -> Change? {
        guard let line = d["line"] as? Int else { return nil }
        return Change(line: line, removed: d["removed"] as? [String] ?? [], added: d["added"] as? [String] ?? [],
                      above: d["above"] as? String, below: d["below"] as? String, loose: d["loose"] as? Bool ?? false)
    }

    /// A whole file offered for a mod here, shortened: the placeholder's line and text, or nil. No answer: nil (the
    /// offer goes on as before).
    static func elided(_ offered: String, current: String) -> (line: Int, text: String)? {
        guard let r = Core.shared.call("modEdit.elided", [offered, current]) as? [String: Any], let line = r["line"] as? Int, let text = r["text"] as? String else { return nil }
        return (line, text)
    }
}

/// Changes or a file TRIF didn't take from a chat: the note people see, and the message for the chat, put in its box
/// for the person to send (never sent by TRIF). The words people see are drafts for Tim (docs/IOS-APP-STRINGS.md);
/// the message is the person's to send, so it's in the strings file too. `log`: for Diagnostics (ids and reasons).
struct ChatRefusal: Equatable {
    var note: String
    var request: String
    var log: String

    /// After the note, where the message is.
    static let inBox = " The message box asks the chat again."
    static let copied = " A message asking the chat again is copied."
    static let alreadyNote = "Those changes are in already."

    /// The line a chat starts its edit blocks with, for a mod's code now (nil: no version could be made).
    static func editLine(_ id: String, _ code: String) -> String? { ModEdits.version(code).map { "TRIF edit \(id) \($0)" } }

    /// Edits that weren't applied. `mod`: the one they name (id, @name, code now), nil when none was found.
    static func edits(_ why: ModEdits.Why, mod: (id: String, name: String, code: String)?, block: Int?) -> ChatRefusal {
        let name = mod?.name ?? "the mod"
        let note = "Those changes don't fit \(mod.map { $0.name } ?? "a mod here") as it is now, so nothing was changed."
        let line = mod.flatMap { editLine($0.id, $0.code) }
        let k = (block ?? 0) + 1
        let request: String
        switch why {
        case .stale:
            request = "Your changes to \(name) were for an earlier version of it: it has changed since, so TRIF changed nothing. Here it is now. Send the changes again as edit blocks against this text, or the whole file.\n\n\(line ?? "")\n```js\n\(mod?.code ?? "")\n```"
        case .nomatch:
            request = "Change \(k) of your edits to \(name) doesn't match the mod: its SEARCH lines aren't in it exactly, so TRIF changed nothing. Send the changes again with SEARCH lines copied exactly from the mod\(line.map { " (\($0))" } ?? ""), or the whole file."
        case .many:
            request = "Change \(k) of your edits to \(name) matches more than one place in the mod, so TRIF changed nothing. Send the changes again with enough SEARCH lines that each matches one place\(line.map { " (\($0))" } ?? ""), or the whole file."
        case .noversion where mod != nil:
            request = "Your edits to \(name) don't say which version they're for, so TRIF changed nothing. Start them with this line: \(line ?? ""). Or send the whole file."
        case .noversion, .nofile:
            request = "Your edits don't name a mod TRIF has (each needs the TRIF edit line given with the mod's code), so TRIF changed nothing. Send them again with that line, or the whole file."
        case .unreadable, .other:
            request = "TRIF couldn't read your edits (each needs <<<<<<< SEARCH, ======= and >>>>>>> REPLACE on lines of their own), so it changed nothing. Send them again\(line.map { " (\($0))" } ?? ""), or the whole file."
        }
        return ChatRefusal(note: note, request: request, log: "\(mod?.id ?? "no mod found")'s edits (\(why.rawValue)\(block.map { ", block \($0 + 1)" } ?? ""))")
    }

    /// A whole file that leaves parts of the mod here out: the placeholder's line and text.
    static func shortened(_ mod: (id: String, name: String, code: String), line n: Int, text: String) -> ChatRefusal {
        let line = editLine(mod.id, mod.code)
        let note = "The chat's new \(mod.name) leaves out part of the mod, so it wasn't added."
        let request = "Your file for \(mod.name) leaves part of the mod out (line \(n): \(text)), so TRIF didn't use it. Send the whole file with nothing left out, or just the changes as edit blocks\(line.map { " (\($0))" } ?? "")."
        return ChatRefusal(note: note, request: request, log: "\(mod.id) shortened (line \(n))")
    }
}
