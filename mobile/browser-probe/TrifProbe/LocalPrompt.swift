// What the model on this iPhone is told, the shape its reply must have, and how TRIF turns that into a mod (the
// research, mobile/local-model/README.md: small models do best with a short guide of their own, never the 16.7 KB
// desktop one, whose x.com examples they copy, and with the reply's shape fixed by a grammar).
//   - styleJSON (every phone): one JSON object, the style mod's name, description and rules; TRIF writes the header
//     itself (@name, @description, @match for the page, @style) and makes the small repairs the research found
//     (a filter's "a|b" words as a pattern). About 70% of style tasks done by MiniCPM5-2B in the research.
//   - file (6 GB phones and up, the 4B model, experimental): the whole mod file, style or boxed, its header's shape and
//     @match fixed by the grammar.
// (Agent-facing words; no app types here, so mobile/local-model/harness.sh compiles it on a Mac too.)

import Foundation

enum LocalPrompt {
    enum Mode: String { case styleJSON, file }

    /// The guide (mobile/local-model/guide.txt), and its style part alone for styleJSON (gen.js styleOf).
    static func guide(_ full: String, mode: Mode) -> String {
        guard mode == .styleJSON else { return full }
        var g = full
        if let a = g.range(of: "**Boxed mod**"), let b = g.range(of: "Tips:", range: a.upperBound..<g.endIndex) { g.removeSubrange(a.lowerBound..<b.lowerBound) }
        if let c = g.range(of: "\"Add a button") { g.removeSubrange(c.lowerBound..<g.endIndex) }
        return g
    }

    static func system(guide full: String, mode: Mode) -> String {
        switch mode {
        case .styleJSON:
            return "You write style mods for TRIF, an app that changes websites. The user is looking at a page on their phone. Below is how TRIF style mods work. The user's message has an outline of the page and what they want changed.\n\nReply with one JSON object only: \"name\" (a short name for the mod), \"description\" (one sentence), and the style mod's rules: \"css\" (a string, \"\" if none), \"hide\", \"filter\" and \"replace\" (lists, [] if none). Use selectors from the outline where you can.\n\n--- How TRIF style mods are written ---\n\(guide(full, mode: .styleJSON))"
        case .file:
            return "You write mods for TRIF, an app that changes websites with small mods. The user is looking at a page in TRIF on their phone. Below is how TRIF mods are written. The user's message has an outline of the page and what they want changed.\n\nReply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod. Don't write a free mod. In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet).\n\n--- How TRIF mods are written ---\n\(full)"
        }
    }

    /// The person's message: the page (its address, the @match it needs, its outline), then what they want.
    static func user(url: String, outline: String, request: String) -> String {
        let u = URL(string: url)
        let host = u?.host ?? "the site"
        let origin = u.map { "\($0.scheme ?? "https")://\($0.host ?? "")" } ?? "https://\(host)"
        let site = host.split(separator: ".").suffix(2).joined(separator: ".")
        return "I'm looking at \(url). Its @match must cover \(origin)/*; when I mean the whole site, match all of its subdomains too (https://*.\(site)/*).\n\n--- The page: \(url) (an outline: each line starts with a CSS selector for a part of it, then its size and first words) ---\n\(outline)\n\nWhat I want: \(request)"
    }

    // MARK: the reply's shape

    /// styleJSON: the research's JSON schema (gen.js SCHEMA), as GBNF, its keys in a fixed order.
    static let styleGrammar = #"""
    root ::= "{" ws "\"name\":" ws str60 "," ws "\"description\":" ws str160 "," ws "\"css\":" ws str2000 "," ws "\"hide\":" ws hides "," ws "\"filter\":" ws filters "," ws "\"replace\":" ws replaces ws "}"
    hides ::= "[" ws ( str200 ( "," ws str200 ){0,11} )? ws "]"
    filters ::= "[" ws ( filter ( "," ws filter ){0,5} )? ws "]"
    filter ::= "{" ws "\"items\":" ws str200 ( "," ws ( "\"hideIfText\":" ws str100 | "\"hideIfRegex\":" ws str200 ) )? ws "}"
    replaces ::= "[" ws ( replace ( "," ws replace ){0,5} )? ws "]"
    replace ::= "{" ws ( "\"in\":" ws str200 "," ws )? "\"find\":" ws str100 "," ws "\"with\":" ws str100 ws "}"
    str60 ::= "\"" char{0,60} "\""
    str100 ::= "\"" char{0,100} "\""
    str160 ::= "\"" char{0,160} "\""
    str200 ::= "\"" char{0,200} "\""
    str2000 ::= "\"" char{0,2000} "\""
    char ::= [^"\\\x7F\x00-\x1F] | "\\" ( ["\\/bfnrt] | "u" [0-9a-fA-F]{4} )
    ws ::= [ \t\n]{0,8}
    """#

    /// file: the whole reply one mod file in a code block, its header's shape and @match fixed (gen.js, local2gbnf).
    static func fileGrammar(origin: String) -> String {
        let o = origin.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "root ::= \"```js\\n// ==WebMod==\\n// @name        \" line \"\\n// @description \" line \"\\n// @match       \(o)/*\\n// @\" tier \"\\n// ==/WebMod==\\n\" body \"```\"\nline ::= [^\\n]{1,100}\ntier ::= \"style\" | \"boxed\"\nbody ::= ([^`] | \"`\" [^`] | \"``\" [^`])*\n"
    }

    // MARK: the reply, as a mod

    /// styleJSON's reply as a whole mod file: TRIF's own header, then its rules (the empty ones left out), with the
    /// research's repairs. (nil, why) when it isn't the JSON asked for.
    static func modFile(json: String, origin: String) -> (file: String?, why: String?, fixes: [String]) {
        guard let data = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return (nil, "the reply isn't JSON", []) }
        var fixes: [String] = []
        var rules: [String: Any] = [:]
        if let css = o["css"] as? String, !css.trimmingCharacters(in: .whitespaces).isEmpty { rules["css"] = css }
        if let hide = o["hide"] as? [String], !hide.isEmpty { rules["hide"] = hide }
        if var filter = o["filter"] as? [[String: Any]], !filter.isEmpty {
            // (a filter's words written as a pattern, "a|b": as hideIfRegex)
            for i in filter.indices {
                if let w = filter[i]["hideIfText"] as? String, w.contains("|") {
                    filter[i]["hideIfRegex"] = w.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "[.*+?^${}()\\[\\]\\\\]", with: "", options: .regularExpression) }.filter { !$0.isEmpty }.joined(separator: "|")
                    filter[i]["hideIfText"] = nil
                    fixes.append("words to pattern")
                }
            }
            rules["filter"] = filter
        }
        if let replace = o["replace"] as? [[String: Any]], !replace.isEmpty { rules["replace"] = replace }
        if rules.isEmpty { return (nil, "the reply has no rules", fixes) }
        let clean = { (s: Any?) in String((s as? String ?? "").replacingOccurrences(of: "[\\r\\n]+", with: " ", options: .regularExpression).prefix(120)).trimmingCharacters(in: .whitespaces) }
        let name = clean(o["name"]).isEmpty ? "Local mod" : clean(o["name"])
        guard let body = try? JSONSerialization.data(withJSONObject: rules, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
              let bodyText = String(data: body, encoding: .utf8) else { return (nil, "the rules couldn't be written", fixes) }
        let file = "// ==WebMod==\n// @name        \(name)\n// @description \(clean(o["description"]))\n// @match       \(origin)/*\n// @style\n// ==/WebMod==\n\(bodyText)\n"
        return (file, nil, fixes)
    }

    /// file's reply: the mod in its code block, with the boxed repair (a stand-in's `text()` called as a function).
    static func modFile(reply: String) -> (file: String?, why: String?, fixes: [String]) {
        guard let a = reply.range(of: "// ==WebMod==") else { return (nil, "no mod in the reply", []) }
        var t = String(reply[a.lowerBound...])
        if let end = t.range(of: "```") { t = String(t[..<end.lowerBound]) }
        var fixes: [String] = []
        let head = t.components(separatedBy: "==/WebMod==").first ?? ""
        if head.contains("@boxed"), t.range(of: "\\.(text|innerText)\\(\\)", options: .regularExpression) != nil {
            t = t.replacingOccurrences(of: "\\.(text|innerText)\\(\\)", with: ".$1", options: .regularExpression)
            fixes.append("text() to text")
        }
        return (t, nil, fixes)
    }
}
