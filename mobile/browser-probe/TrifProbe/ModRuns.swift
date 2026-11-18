import Foundation

/// What runs (docs/MOBILE-BEHAVIOUR.md, Mods and holds): a mod's switch (the whole mod's, or a mod for several sites:
/// its switch on each), the tiers switched off on a site, Pause all, and which mods run on a page (MatchPattern). The
/// phones' shared rule: mobile/shared/core/mod-store.js (TrifCore.modStore: multiSite, isOn, running, off, setOn,
/// setGroup) and core/match.js (TrifCore.match). A switch's tap calls through Core.swift; `running`, `isOn`, `off` and
/// MatchPattern stay Swift twins, held to the same cases (mod-runs-cases.json): they're asked on every page load for
/// every mod. No UI: the Mac check (mobile/test/modruns.test.js) builds it.
enum ModRuns {
    /// What the rules read of a mod (InstalledMod.runFacts).
    struct Facts {
        var hold: ModHolds.Facts
        var on: Bool
        var sites: [String]
        var offSites: [String]
        var excludes: [String]
        var everywhere: Bool { hold.site == "all-sites" }
        var multiSite: Bool { ModRuns.multiSite(everywhere: everywhere, sites: sites) }
        var held: Bool { !ModHolds.waiting(hold.needs + hold.extraNeeds, allowed: hold.allowed).isEmpty }
        var plain: [String: Any] {
            var o = hold.plain
            o["on"] = on; o["sites"] = sites; o["offSites"] = offSites; o["excludes"] = excludes
            return o
        }
    }

    /// A mod for several sites (or every site) has a switch per site (desktop's isMultiSite; core multiSite).
    static func multiSite(everywhere: Bool, sites: [String]) -> Bool { everywhere || Set(sites.map(Site.of)).count > 1 }

    /// Whether a mod is switched on (for a site: its switch there). The twin of core isOn.
    static func isOn(_ m: Facts, site: String?) -> Bool {
        guard m.on else { return false }
        guard let site, !site.isEmpty else { return true }
        return !(m.multiSite && m.offSites.contains(site))
    }

    /// Whether a mod's @match (and @exclude) covers an address. The twin of core match.applies.
    static func applies(_ matches: [String], _ excludes: [String], _ u: MatchPattern.Parts?) -> Bool {
        guard let u else { return false }
        return MatchPattern.any(matches, u) && !MatchPattern.any(excludes, u)
    }

    /// The mods that run on a page (each one's index, and whether the version kept runs: a change waits). The twin of
    /// core running.
    static func running(_ mods: [Facts], paused: Bool, groupsOff: [String: [String]], url: String) -> [(i: Int, kept: Bool)] {
        if paused { return [] }
        let u = URL(string: url).map(MatchPattern.parts)
        let site = Site.of(URL(string: url)?.host ?? "")
        let tiersOff = groupsOff[site] ?? []
        var out: [(i: Int, kept: Bool)] = []
        for (i, m) in mods.enumerated() {
            guard m.on else { continue }
            let held = m.held
            guard !(held && !m.hold.ran), !tiersOff.contains(m.hold.tier), !(m.multiSite && m.offSites.contains(site)), applies(m.hold.matches, m.excludes, u) else { continue }
            out.append((i, held && m.hold.ran))
        }
        return out
    }

    /// The sites a mod's script checks it's off on: its own switch's (a mod for several sites), and its tier's. The
    /// twin of core off.
    static func off(_ m: Facts, groupsOff: [String: [String]]) -> [String] {
        Array(Set((m.multiSite ? m.offSites : []) + groupsOff.filter { $0.value.contains(m.hold.tier) }.map(\.key))).sorted()
    }

    /// A mod's switch (core setOn): nil if the shared rule didn't answer (nothing changes).
    static func setOn(_ m: Facts, _ on: Bool, site: String?) -> (on: Bool, offSites: [String], clearNewOff: Bool)? {
        guard let r = Core.shared.call("modStore.setOn", [m.plain, on, site ?? NSNull()]) as? [String: Any],
              let isOn = r["on"] as? Bool, let offSites = r["offSites"] as? [String], let clear = r["clearNewOff"] as? Bool else { return nil }
        return (isOn, offSites, clear)
    }

    /// A tier's switch on a site (core setGroup): groupsOff after, nil if the shared rule didn't answer.
    static func setGroup(_ groupsOff: [String: [String]], _ tier: String, on: Bool, site: String) -> [String: [String]]? {
        guard let r = Core.shared.call("modStore.setGroup", [groupsOff, tier, on, site]) as? [String: Any] else { return nil }
        var out: [String: [String]] = [:]
        for (k, v) in r { guard let l = v as? [String] else { return nil }; out[k] = l }
        return out
    }
}

/// Chrome-style match patterns (https://x.com/*, *://*.x.com/*, <all_urls>), as modfile.js matchesUrl tests them. The
/// twin of core match.js, which takes an address as its parts (`parts`: the platform's URL parsing).
enum MatchPattern {
    /// An address as the rule reads it: scheme and host in lower case, the percent-encoded path ("/" when empty) and
    /// "?" + the percent-encoded query when there is one.
    struct Parts { var scheme: String; var host: String; var path: String
        var plain: [String: Any] { ["scheme": scheme, "host": host, "path": path] }
    }

    static func parts(_ u: URL) -> Parts {
        var target = u.path.isEmpty ? "/" : u.path
        if let q = u.query { target += "?" + q }
        // (URL.path decodes percent escapes; the page's location.pathname keeps them)
        if let comps = URLComponents(url: u, resolvingAgainstBaseURL: false) { target = (comps.percentEncodedPath.isEmpty ? "/" : comps.percentEncodedPath) + (comps.percentEncodedQuery.map { "?" + $0 } ?? "") }
        return Parts(scheme: (u.scheme ?? "").lowercased(), host: (u.host ?? "").lowercased(), path: target)
    }

    nonisolated(unsafe) private static var paths: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func any(_ patterns: [String], _ u: URL) -> Bool { any(patterns, parts(u)) }
    static func any(_ patterns: [String], _ u: Parts) -> Bool { patterns.contains { one($0, u) } }

    static func one(_ p: String, _ u: Parts) -> Bool {
        let scheme = u.scheme, host = u.host
        let web = scheme == "http" || scheme == "https"
        if p == "<all_urls>" { return web }
        guard let sep = p.range(of: "://") else { return false }
        let ps = String(p[..<sep.lowerBound])
        let rest = p[sep.upperBound...]
        guard let slash = rest.firstIndex(of: "/") else { return false }
        let ph = String(rest[..<slash]).lowercased(), path = String(rest[slash...])
        if ps == "*" { if !web { return false } } else if ps != scheme || !(ps == "http" || ps == "https") { return false }
        if ph != "*" {
            if ph.hasPrefix("*.") { let base = String(ph.dropFirst(2)); if host != base && !host.hasSuffix("." + base) { return false } }
            else if ph.contains("*") || host != ph { return false }
        }
        lock.lock(); defer { lock.unlock() }
        let re: NSRegularExpression
        if let cached = paths[path] { re = cached } else {
            let escaped = NSRegularExpression.escapedPattern(for: path).replacingOccurrences(of: "\\*", with: ".*")
            guard let made = try? NSRegularExpression(pattern: "^\(escaped)$", options: [.dotMatchesLineSeparators]) else { return false }
            paths[path] = made
            re = made
        }
        let target = u.path
        return re.firstMatch(in: target, range: NSRange(target.startIndex..., in: target)) != nil
    }
}
