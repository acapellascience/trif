// OpenRouter's models as More's picker shows them (Tim, 11-18: "the Models list is endless … Can we reduce it so it
// only shows models actually available to you?"). No UI and no networking here (built for the Mac too, by
// mobile/test/openroutermodels.test.js): PanelChat.fetchModels gets the list, this file reads it.
//
// - Which list: OpenRouter's own list for the key (GET /api/v1/models/user, Bearer key), which applies the account's
//   provider preferences, then its privacy (data policy) settings and guardrails (allowed models and providers);
//   the public /api/v1/models when that fails. Both have the same rows.
// - Fit for writing mods (`fit`): takes tools, answers on chat completions (batch-only rows don't), writes text, at
//   least 32K of context (the smaller of the model's and its top provider's), not past its expiration date. Runs ask
//   OpenRouter for providers that take every parameter sent (PanelEngines: provider.require_parameters), so a model
//   is never routed to a provider that would drop the tools.
// - The picker's parts: Recommended (the small table below, the first of each row's candidates the list has), Recent
//   (the person's own, newest first), All models by maker.

import Foundation

enum OpenRouterModels {
    struct Model: Equatable {
        let id: String
        /// Its name without the maker's "Anthropic: " (the maker heads its group); an alias says what it is now.
        let name: String
        /// The maker's name, as its group is headed.
        let maker: String
        let created: Double
        /// US dollars per million tokens, in and out (nil: OpenRouter decides per request, as Auto).
        let input: Double?
        let output: Double?
        let context: Int
        let images: Bool
        var free: Bool { input == 0 && output == 0 }
    }

    /// Recommended: one row per kind, its candidates in order (OpenRouter's "~…-latest" ids follow the newest of a
    /// family by themselves). "*free" = any free model that's fit (not a router). Easy to change: only this table.
    static let recommended: [(kind: String, ids: [String])] = [
        ("Claude Opus", ["~anthropic/claude-opus-latest", "anthropic/claude-opus-5.5"]),
        ("Claude Sonnet", ["~anthropic/claude-sonnet-latest", "anthropic/claude-sonnet-5.5"]),
        ("GPT flagship", ["~openai/gpt-astra-latest", "~openai/gpt-sol-latest", "openai/gpt-6.2-astra"]),
        ("Gemini Pro", ["~google/gemini-pro-latest", "google/gemini-4-carbon"]),
        ("Gemini Flash", ["~google/gemini-flash-latest", "google/gemini-4-hydrogen"]),
        ("Strong and cheap", ["~deepseek/deepseek-flash-latest", "~z-ai/glm-latest", "~moonshotai/kimi-latest"]),
        ("Free", ["cohere/north-mini-code:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemma-4-31b-it:free", "*free"]),
    ]
    static let auto = "openrouter/auto"
    static let minContext = 32_000

    /// The makers' names, by the id's first part; others take the name's "Maker: " part. The groups' order: these
    /// first, as listed, then the rest by name.
    static let makers: [(prefix: [String], name: String)] = [
        (["anthropic"], "Anthropic"), (["openai"], "OpenAI"), (["google"], "Google"), (["meta-llama", "meta"], "Meta"),
        (["mistralai"], "Mistral"), (["qwen"], "Qwen"), (["deepseek"], "DeepSeek"), (["x-ai"], "xAI"),
        (["moonshotai"], "Moonshot AI"), (["z-ai"], "Z.ai"), (["openrouter"], "OpenRouter"),
    ]

    /// Why a row isn't fit for writing mods (nil: fit). `today` as "yyyy-MM-dd".
    static func unfit(_ r: [String: Any], today: String) -> String? {
        guard let id = r["id"] as? String, !id.isEmpty else { return "no id" }
        guard (r["supported_parameters"] as? [String])?.contains("tools") == true else { return "no tools" }
        if let eps = r["endpoints"] as? [String], !eps.contains("/api/v1/chat/completions") { return "not on chat completions" }
        if let outs = (r["architecture"] as? [String: Any])?["output_modalities"] as? [String], !outs.contains("text") { return "no text out" }
        if context(r) < minContext { return "context under 32K" }
        if let exp = r["expiration_date"] as? String, !exp.isEmpty, exp.prefix(10) < today.prefix(10) { return "expired" }
        return nil
    }

    /// The smaller of the model's context and its top provider's (OpenRouter's routers have no provider's).
    static func context(_ r: [String: Any]) -> Int {
        let own = (r["context_length"] as? NSNumber)?.intValue ?? 0
        if let top = ((r["top_provider"] as? [String: Any])?["context_length"] as? NSNumber)?.intValue, top > 0 { return min(own > 0 ? own : top, top) }
        return own
    }

    /// The list's rows that are fit, read (each id once).
    static func read(_ rows: [[String: Any]], today: String) -> [Model] {
        var seen = Set<String>()
        var out: [Model] = []
        for r in rows where unfit(r, today: today) == nil {
            let id = r["id"] as! String
            guard seen.insert(id).inserted else { continue }
            let full = r["name"] as? String ?? id
            let p = r["pricing"] as? [String: Any]
            let maker = makerName(id: id, name: full)
            var name = shortName(full)
            // (a free one's "(free)": the picker marks it Free)
            if name.hasSuffix(" (free)"), (p?["prompt"] as? String) == "0", (p?["completion"] as? String) == "0" { name = String(name.dropLast(7)) }
            // (an alias, "Claude Opus Latest": what it is now, as OpenRouter says)
            if let t = (r["alias_target"] as? [String: Any])?["name"] as? String, !t.isEmpty { name += " (\(shortName(t)))" }
            let price = { (k: String) -> Double? in
                guard let v = p?[k] else { return nil }
                let d = (v as? String).flatMap(Double.init) ?? (v as? NSNumber)?.doubleValue
                guard let d, d >= 0 else { return nil } // (Auto's -1: decided per request)
                return d * 1_000_000
            }
            let inputs = ((r["architecture"] as? [String: Any])?["input_modalities"] as? [String]) ?? []
            out.append(Model(id: id, name: name, maker: maker, created: (r["created"] as? NSNumber)?.doubleValue ?? 0,
                             input: price("prompt"), output: price("completion"), context: context(r), images: inputs.contains("image")))
        }
        return out
    }

    static func shortName(_ s: String) -> String {
        guard let c = s.range(of: ": ") else { return s }
        let rest = s[c.upperBound...].trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? s : rest
    }
    static func makerName(id: String, name: String) -> String {
        var first = String(id.split(separator: "/").first ?? "")
        if first.hasPrefix("~") { first.removeFirst() }
        if let m = makers.first(where: { $0.prefix.contains(first) }) { return m.name }
        if let c = name.range(of: ": ") { return String(name[..<c.lowerBound]) }
        return first.isEmpty ? "Other" : first
    }

    /// Recommended's ids, in the table's order: each row's first candidate in the list (none: the row left out).
    static func picks(_ models: [Model]) -> [String] {
        let have = Set(models.map(\.id))
        var out: [String] = []
        for row in recommended {
            for c in row.ids {
                if c == "*free" {
                    if let f = models.filter({ $0.free && !$0.id.hasPrefix("openrouter/") && !out.contains($0.id) }).max(by: { $0.created < $1.created }) { out.append(f.id); break }
                } else if have.contains(c), !out.contains(c) { out.append(c); break }
            }
        }
        return out
    }

    /// Recent: the ones used, newest first, that the list still has and Recommended doesn't show; at most 5.
    static func recent(_ used: [String], models: [Model], shown: [String]) -> [String] {
        let have = Set(models.map(\.id))
        var out: [String] = []
        for id in used where have.contains(id) && !shown.contains(id) && !out.contains(id) && id != auto { out.append(id) }
        return Array(out.prefix(5))
    }

    /// All models by maker: the known makers first (the table's order), then the rest by name; in each, the aliases
    /// ("… Latest") first, then the newest first.
    static func groups(_ models: [Model]) -> [(maker: String, ids: [String])] {
        var by: [String: [Model]] = [:]
        for m in models where m.id != auto { by[m.maker, default: []].append(m) }
        let known = makers.map(\.name)
        let names = by.keys.sorted { a, b in
            let ia = known.firstIndex(of: a) ?? Int.max, ib = known.firstIndex(of: b) ?? Int.max
            return ia != ib ? ia < ib : a.lowercased() < b.lowercased()
        }
        return names.map { n in
            (n, by[n]!.sorted { a, b in
                let la = a.id.hasPrefix("~"), lb = b.id.hasPrefix("~")
                if la != lb { return la }
                return a.created != b.created ? a.created > b.created : a.id < b.id
            }.map(\.id))
        }
    }

    // MARK: the small line under each model (drafts for Tim: docs/IOS-APP-STRINGS.md)

    /// "$3 in, $15 out per million tokens · 200K context"; "Free · 256K context"; Auto's "Price varies · 2M context".
    static func line(_ m: Model) -> String {
        let ctx = "\(contextText(m.context)) context"
        if m.free { return "Free · \(ctx)" }
        guard let i = m.input, let o = m.output else { return "Price varies · \(ctx)" }
        return "\(dollars(i)) in, \(dollars(o)) out per million tokens · \(ctx)"
    }
    static func dollars(_ v: Double) -> String {
        if v == 0 { return "$0" }
        let s = v >= 10 ? String(format: "%.0f", v) : v >= 1 ? String(format: "%.2f", v) : v >= 0.01 ? String(format: "%.3f", v) : String(format: "%.4f", v)
        var t = s
        if t.contains(".") { while t.hasSuffix("0") { t.removeLast() }; if t.hasSuffix(".") { t.removeLast() } }
        return "$" + t
    }
    static func contextText(_ n: Int) -> String {
        if n >= 1_000_000 {
            let v = (Double(n) / 1_000_000 * 10).rounded() / 10
            return v == v.rounded() ? "\(Int(v))M" : String(format: "%.1fM", v)
        }
        return "\(Int((Double(n) / 1000).rounded()))K"
    }

    static func today(_ d: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}
