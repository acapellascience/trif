import Foundation

/// What a mod needs allowed before it runs (held.js needsOf): a power, a combination, a finding; `lines`, the
/// hashes of the lines of code that use it (a free mod's), so a later version is asked about again only for those.
struct ModNeed: Codable, Equatable {
    var key: String
    var fact: String
    var power: String?
    var lines: [String]?
}

/// The mod store's hold rules (docs/MOBILE-BEHAVIOUR.md, Mods and holds): what a mod waits for, what Allow allows, what
/// a change asks about beyond its code's needs, what the version before counts as allowed, and which version runs while
/// a change waits. The phones' shared rule: mobile/shared/core/mod-store.js (TrifCore.modStore), through Core.swift
/// (an add, an edit, a restore, Allow: not hot paths). `waiting` stays a Swift twin, held to the same cases: `held` is
/// asked of every mod on every page load. No UI: the Mac check (mobile/test/modstore.test.js) builds it.
enum ModHolds {
    /// What the rules read of a mod (InstalledMod.holdFacts).
    struct Facts {
        var tier: String
        var site: String
        var matches: [String]
        var needs: [ModNeed]
        var extraNeeds: [ModNeed]
        var allowed: [String: [String]]
        /// a version before is kept running (InstalledMod.ran)
        var ran: Bool
        var plain: [String: Any] {
            ["tier": tier, "site": site, "matches": matches, "needs": needs.map(ModHolds.plain), "extraNeeds": extraNeeds.map(ModHolds.plain),
             "allowed": allowed, "ran": ran]
        }
    }

    /// The needs not yet allowed (core waiting; the twin, as it's asked on every page load).
    static func waiting(_ needs: [ModNeed], allowed: [String: [String]]) -> [ModNeed] {
        needs.filter { n in
            guard let ok = allowed[n.key] else { return true }
            return (n.lines ?? []).contains { !ok.contains($0) }
        }
    }

    /// Allowed plus these needs (their keys and lines). No answer: allowed as it was (what waits still waits).
    static func allow(_ needs: [ModNeed], _ allowed: [String: [String]]) -> [String: [String]] {
        decodeAllowed(Core.shared.call("modStore.allow", [needs.map(plain), allowed])) ?? allowed
    }

    /// Allow: what the mod waits for allowed for it. No answer: allowed as it was (it stays held).
    static func approve(_ m: Facts) -> [String: [String]] {
        decodeAllowed(Core.shared.call("modStore.approve", [m.plain])) ?? m.allowed
    }

    /// What a change asks about beyond its code's needs, judged against the version before. No answer: every one of
    /// its @match (if it can act), and becoming a free mod: it asks more, never less.
    static func changeNeeds(_ m: Facts, was old: Facts) -> [ModNeed] {
        if let r = Core.shared.call("modStore.changeNeeds", [m.plain, old.plain]) as? [[String: Any]] { return r.compactMap(need) }
        let free = m.tier == "free" && old.tier != "free" ? [ModNeed(key: "tier:free", fact: "is now a free mod, so it can do anything the page can do")] : []
        return free + (m.needs.isEmpty ? [] : m.matches.map { ModNeed(key: "match:\($0)", fact: "runs on \($0), outside \(Site.of(old.site))") })
    }

    /// What the user had allowed plus what the version that ran already did. No answer: only what was allowed.
    static func seeded(_ old: Facts) -> [String: [String]] {
        decodeAllowed(Core.shared.call("modStore.seeded", [old.plain])) ?? old.allowed
    }

    /// Which version runs while a change waits: .ran (the one the version before kept), .current (the version before),
    /// or nil. `restore`: a kept version restored (since 11-18 it keeps what a held version before kept, as an add).
    /// No answer: nil (nothing runs until the user decides).
    enum Kept: String { case ran, current }
    static func ranAfter(held: Bool, old: Facts, restore: Bool) -> Kept? {
        (Core.shared.call("modStore.ranAfter", [held, old.plain, restore ? "restore" : "add"]) as? String).flatMap(Kept.init)
    }

    static func plain(_ n: ModNeed) -> [String: Any] {
        var o: [String: Any] = ["key": n.key, "fact": n.fact]
        if let p = n.power { o["power"] = p }
        if let l = n.lines { o["lines"] = l }
        return o
    }

    static func need(_ o: [String: Any]) -> ModNeed? {
        guard let k = o["key"] as? String else { return nil }
        return ModNeed(key: k, fact: o["fact"] as? String ?? "", power: o["power"] as? String, lines: o["lines"] as? [String])
    }

    private static func decodeAllowed(_ v: Any?) -> [String: [String]]? {
        guard let o = v as? [String: Any] else { return nil }
        var out: [String: [String]] = [:]
        for (k, l) in o { guard let l = l as? [String] else { return nil }; out[k] = l }
        return out
    }
}
