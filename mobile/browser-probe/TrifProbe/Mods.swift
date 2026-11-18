// The mods the app keeps (branch ios-poc): each one read the way the helper reads it (shared/gen/mods.js in
// JavaScriptCore: helper/lib/mods.js buildMod, the style rules, a boxed mod's powers and a free mod's code reading),
// run in its tier's world as on desktop (a style mod's rules in TRIF's world, a boxed mod in the box with SES and
// TRIF's sandbox runtime, a free mod in the page's own world), and held, as on desktop (helper/lib/held.js), while
// it can do something the user hasn't allowed: a boxed mod's powers and their combinations, what TRIF found a free
// mod's code can do. A held mod never runs; a change waiting for an OK leaves the version before running.
// The Mods tab (ModsPanel.swift, Web/mods.html) shows and changes all of this.

import SwiftUI
import JavaScriptCore
import WebKit
import CryptoKit

/// What a mod needs allowed before it runs (held.js needsOf): a power, a combination, a finding; `lines`, the
/// hashes of the lines of code that use it (a free mod's), so a later version is asked about again only for those.
struct ModNeed: Codable, Equatable {
    var key: String
    var fact: String
    var power: String?
    var lines: [String]?
}

struct PowerFact: Codable, Equatable { var power: String; var fact: String }
struct ModRisk: Codable, Equatable { var tier: Int; var why: String? }

/// A version kept before a change (the code card's History): its text, when, and what replaced it.
struct ModVersion: Codable, Equatable, Identifiable {
    var stamp: String
    var at: Date
    var code: String
    /// chat, import, restore, undo (as desktop's history sources)
    var source: String
    var id: String { stamp }
}

struct InstalledMod: Codable, Identifiable, Equatable {
    var id: String              // site/name, as desktop's ids
    var site: String            // the folder it's kept under: a host, or all-sites
    var name: String
    var description: String
    var tier: String            // style, boxed or free
    var sites: [String]
    var matches: [String]
    var excludes: [String] = []
    var powers: [String]
    var powerArgs: [String: [String]] = [:]
    var facts: [PowerFact] = []
    var warnings: [String] = []
    var risk: ModRisk?
    var hash: String = ""
    var needs: [ModNeed] = []
    var code: String            // the file
    var script: String          // what runs: the mod behind a check of the page's address
    var world: String           // trif, box or page
    var at: String              // start or end
    /// A free mod's style section: the script that puts its CSS on the page, in TRIF's world (modfile.js readMod
    /// styleScript); "" without one. Not kept: made again with `script`.
    var styleScript: String = ""
    var on: Bool = true
    /// Sites it's switched off on (a mod for several sites: its switch is the site's, as desktop's offSites).
    var offSites: [String] = []
    /// What the user allowed it: {need key: [line hashes]} (allowed.json's shape).
    var allowed: [String: [String]] = [:]
    /// How it came: chat, import, link, pasted.
    var source: String = "chat"
    /// Why it's off and marked: import (new) or update (updated), until it's switched on.
    var newOff: String?
    var added: Date = Date()
    var history: [ModVersion] = []
    /// While a change waits for the user's OK: the version that last ran, which keeps running.
    var ran: RanVersion?
    /// What an edit (or a restore) asks about beyond what the code needs: a site its @match didn't cover before,
    /// becoming a free mod (ModStore.changeNeeds). Kept apart from `needs`, which reading the file again remakes.
    var extraNeeds: [ModNeed] = []
    /// (offered, not kept) The site it came from: the chat's, or the page it was pasted on (Add this mod? warns when it
    /// runs on another). nil: from a file or a code, which has no site of its own.
    var cameFrom: String? = nil

    struct RanVersion: Codable, Equatable { var code: String; var script: String; var world: String; var at: String; var style: String? = nil }

    var tierName: String { tier == "style" ? "Style mod" : tier == "boxed" ? "Boxed mod" : "Free mod" }
    /// The tier's colour, as the panel's (sidepanel.css --led-green, --led-yellow, --led-coral).
    var colour: Color { tier == "style" ? .trifGreen : tier == "boxed" ? .trifYellow : .trifCoral }
    var everywhere: Bool { site == "all-sites" }
    /// Its file's name, as desktop keeps it (sites/<site>/<name>.js): read again, it keeps its id.
    var file: String { "\(id.split(separator: "/").last ?? "mod").js" }
    /// A mod for several sites (or every site) has a switch per site (desktop's isMultiSite).
    var multiSite: Bool { everywhere || Set(sites.map(Site.of)).count > 1 }

    /// The needs not yet allowed (modfile.js waiting): what a hold is waiting for.
    var waiting: [ModNeed] {
        (needs + extraNeeds).filter { n in
            guard let ok = allowed[n.key] else { return true }
            return (n.lines ?? []).contains { !ok.contains($0) }
        }
    }
    var held: Bool { !waiting.isEmpty }
    /// A change on hold: the version before runs meanwhile.
    var pending: Bool { held && ran != nil }

    enum CodingKeys: String, CodingKey { case id, site, name, description, tier, sites, matches, excludes, powers, powerArgs, facts, warnings, risk, hash, needs, code, script, world, at, on, offSites, allowed, source, newOff, added, history, ran, extraNeeds }

    init(id: String, site: String, name: String, description: String, tier: String, sites: [String], matches: [String], powers: [String], code: String, script: String, world: String, at: String) {
        self.id = id; self.site = site; self.name = name; self.description = description; self.tier = tier; self.sites = sites
        self.matches = matches; self.powers = powers; self.code = code; self.script = script; self.world = world; self.at = at
    }

    // (every field but the first few optional: mods kept by the proof of concept read in, then read again)
    /// Kept without `script` (made again from the code when the app starts: ModStore.init), and with at most ten
    /// earlier versions: Tim's phone kept 323 KB of mods in its settings, each twice, and saved it on every change.
    func encode(to e: Encoder) throws {
        var c = e.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(site, forKey: .site); try c.encode(name, forKey: .name); try c.encode(description, forKey: .description)
        try c.encode(tier, forKey: .tier); try c.encode(sites, forKey: .sites); try c.encode(matches, forKey: .matches); try c.encode(excludes, forKey: .excludes)
        try c.encode(powers, forKey: .powers); try c.encode(powerArgs, forKey: .powerArgs); try c.encode(facts, forKey: .facts); try c.encode(warnings, forKey: .warnings)
        try c.encodeIfPresent(risk, forKey: .risk); try c.encode(hash, forKey: .hash); try c.encode(needs, forKey: .needs); try c.encode(code, forKey: .code)
        try c.encode(world, forKey: .world); try c.encode(at, forKey: .at); try c.encode(on, forKey: .on); try c.encode(offSites, forKey: .offSites)
        try c.encode(allowed, forKey: .allowed); try c.encode(source, forKey: .source); try c.encodeIfPresent(newOff, forKey: .newOff); try c.encode(added, forKey: .added)
        try c.encode(Array(history.prefix(10)), forKey: .history); try c.encodeIfPresent(ran, forKey: .ran); try c.encode(extraNeeds, forKey: .extraNeeds)
    }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        code = try c.decode(String.self, forKey: .code)
        site = try c.decodeIfPresent(String.self, forKey: .site) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        tier = try c.decodeIfPresent(String.self, forKey: .tier) ?? "free"
        sites = try c.decodeIfPresent([String].self, forKey: .sites) ?? []
        matches = try c.decodeIfPresent([String].self, forKey: .matches) ?? []
        excludes = try c.decodeIfPresent([String].self, forKey: .excludes) ?? []
        powers = try c.decodeIfPresent([String].self, forKey: .powers) ?? []
        powerArgs = try c.decodeIfPresent([String: [String]].self, forKey: .powerArgs) ?? [:]
        facts = try c.decodeIfPresent([PowerFact].self, forKey: .facts) ?? []
        warnings = try c.decodeIfPresent([String].self, forKey: .warnings) ?? []
        risk = try c.decodeIfPresent(ModRisk.self, forKey: .risk)
        hash = try c.decodeIfPresent(String.self, forKey: .hash) ?? ""
        needs = try c.decodeIfPresent([ModNeed].self, forKey: .needs) ?? []
        script = try c.decodeIfPresent(String.self, forKey: .script) ?? ""
        world = try c.decodeIfPresent(String.self, forKey: .world) ?? "page"
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? "end"
        on = try c.decodeIfPresent(Bool.self, forKey: .on) ?? true
        offSites = try c.decodeIfPresent([String].self, forKey: .offSites) ?? []
        allowed = try c.decodeIfPresent([String: [String]].self, forKey: .allowed) ?? [:]
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "chat"
        newOff = try c.decodeIfPresent(String.self, forKey: .newOff)
        added = try c.decodeIfPresent(Date.self, forKey: .added) ?? Date()
        history = try c.decodeIfPresent([ModVersion].self, forKey: .history) ?? []
        ran = try c.decodeIfPresent(RanVersion.self, forKey: .ran)
        extraNeeds = try c.decodeIfPresent([ModNeed].self, forKey: .extraNeeds) ?? []
    }
}

/// Sites as the panel groups them: a host's registrable domain (en.wikipedia.org → wikipedia.org).
enum Site {
    private static let twoPart: Set<String> = ["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp",
                                               "com.br", "com.mx", "co.in", "co.kr", "com.cn", "com.tw", "com.hk", "co.za", "com.sg", "com.tr", "com.ar", "qc.ca"]
    static func of(_ host: String) -> String {
        let h = host.lowercased().replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
        if h.isEmpty || h == "all-sites" || h.allSatisfy({ $0.isNumber || $0 == "." }) || !h.contains(".") { return h }
        let parts = h.split(separator: ".").map(String.init)
        guard parts.count > 2 else { return h }
        let last2 = parts.suffix(2).joined(separator: ".")
        return twoPart.contains(last2) ? parts.suffix(3).joined(separator: ".") : last2
    }
    /// Whether `host` is `site` or under it.
    static func host(_ host: String, isIn site: String) -> Bool {
        let h = host.lowercased().replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
        return h == site || h.hasSuffix("." + site)
    }
}

@MainActor
final class ModStore: ObservableObject {
    @Published private(set) var mods: [InstalledMod] = []
    /// The tiers switched off on a site (the Mods tab's On / Off on each tier): site → [style, boxed, free].
    @Published private(set) var groupsOff: [String: [String]] = [:]
    /// The last mod deleted, for Undo (this launch only).
    @Published private(set) var lastDeleted: InstalledMod?
    /// Recently deleted (phone sync, D7): every mod deleted here, by the user or by a sync, for 30 days, newest first.
    @Published private(set) var trash: [DeletedMod] = []
    private let key = "installedMods"
    private let groupsKey = "groupsOff"
    private let readerKey = "modReader"
    private lazy var js: JSContext? = {
        let c = JSContext()
        c?.evaluateScript(Browser.resource("mods", "js"))
        return c
    }()

    /// modfile.js freePageScript and freeRelayScript (the reader's own text: the same until the app brings a new one).
    private lazy var freeScripts: (page: String, relay: String)? = {
        guard let c = js, let page = c.evaluateScript("__trifMods.freePageScript")?.toString(), let relay = c.evaluateScript("__trifMods.freeRelayScript")?.toString(),
              page.hasPrefix("("), relay.hasPrefix("(") else { return nil }
        return (page, relay)
    }()

    /// Pause all mods (the Mods tab's ⋯, the app icon's menu): no mod runs anywhere until Resume.
    @Published private(set) var paused = UserDefaults.standard.bool(forKey: ModStore.pausedKey)
    func setPaused(_ p: Bool) {
        paused = p
        UserDefaults.standard.set(p, forKey: ModStore.pausedKey)
        Diagnostics.shared.log("paused", p ? "all mods paused" : "mods resumed")
    }

    init() {
        mods = ModFilesStore.load()
        trash = ModFilesStore.loadTrash().filter { $0.at > Date().addingTimeInterval(-ModStore.trashDays * 86400) }
        // (once: the mods the app kept in its settings, moved to their own files)
        if !UserDefaults.standard.bool(forKey: "modsInFiles"), let data = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([InstalledMod].self, from: data) {
            if mods.isEmpty { mods = list }
            ModFilesStore.write(mods)
            UserDefaults.standard.removeObject(forKey: key)
            UserDefaults.standard.set(true, forKey: "modsInFiles")
            Diagnostics.shared.log("storage", "moved \(list.count) mods (\(data.count / 1024) KB) from the app's settings to their own files")
        }
        if let g = UserDefaults.standard.dictionary(forKey: groupsKey) as? [String: [String]] { groupsOff = g }
        rereadIfNeeded(force: mods.contains { $0.script.isEmpty })
    }

    /// Kept: each mod in a file of its own, written off the main thread (ModFilesStore); the tiers off by site in the
    /// settings (small).
    private func save() {
        ModFilesStore.write(mods)
        ModFilesStore.writeTrash(trash)
        UserDefaults.standard.set(groupsOff, forKey: groupsKey)
    }

    /// The reader's own version (mods.js's text): when the app brings a new one, every mod is read again from its
    /// file, so what runs is what this version makes of it. The proof of concept's mods (ids without a site) are
    /// read in as allowed for what they can do: the user added each from its "Add this mod?" sheet.
    private func rereadIfNeeded(force: Bool) {
        let version = SHA256.hash(data: Data(Browser.resource("mods", "js").utf8)).map { String(format: "%02x", $0) }.joined()
        guard force || UserDefaults.standard.string(forKey: readerKey) != version else { return }
        var out: [InstalledMod] = []
        for old in mods {
            let fromProbe = !old.id.contains("/")
            guard var m = read(old.code, file: fromProbe ? "" : old.file, site: fromProbe ? "" : old.site).mod else { out.append(old); continue }
            m.on = old.on; m.offSites = old.offSites; m.source = old.source; m.newOff = old.newOff; m.added = old.added; m.history = old.history
            m.allowed = fromProbe ? ModStore.allow(m.needs, old.allowed) : old.allowed
            if !fromProbe, let ran = old.ran { m.ran = ran }
            m.extraNeeds = old.extraNeeds
            out.removeAll { $0.id == m.id }
            out.append(m)
        }
        mods = out
        UserDefaults.standard.set(version, forKey: readerKey)
        save()
    }

    // MARK: reading

    /// A mod file, or a chat's reply with one in it: the mod, ready to add, or why it can't be. `file`: the file's
    /// name, when it came as one; `here`: the page's host (a mod for several sites is kept under it, if it's one).
    func read(_ text: String, file: String = "", site: String = "", here: String = "") -> (mod: InstalledMod?, error: String?) {
        guard let c = js else { return (nil, "the mod reader didn't start") }
        c.setObject(text, forKeyedSubscript: "__input" as NSString)
        c.setObject(["file": file, "site": site, "here": here], forKeyedSubscript: "__opts" as NSString)
        let out = c.evaluateScript(ModReader.readCall)?.toString() ?? ""
        return ModStore.build(out.isEmpty ? (c.exception?.toString() ?? "") : out)
    }

    /// The reader's answer (JSON) as the mod the app keeps, or why it can't be one.
    nonisolated static func build(_ out: String) -> (mod: InstalledMod?, error: String?) {
        guard let data = out.data(using: .utf8), let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return (nil, "the mod reader gave nothing back: \(out.prefix(200))") }
        if let error = d["error"] as? String { return (nil, error) }
        let s = { (k: String) in d[k] as? String ?? "" }
        let a = { (k: String) in d[k] as? [String] ?? [] }
        var m = InstalledMod(id: s("id"), site: s("site"), name: s("name"), description: s("description"), tier: s("tier"), sites: a("sites"), matches: a("matches"),
                             powers: a("powers"), code: s("code"), script: s("script"), world: s("world"), at: s("at"))
        m.excludes = a("excludes")
        m.styleScript = s("styleScript")
        m.hash = s("hash")
        m.powerArgs = d["powerArgs"] as? [String: [String]] ?? [:]
        if let info = d["powerInfo"] as? [String: Any] {
            m.facts = (info["facts"] as? [[String: Any]] ?? []).map { PowerFact(power: $0["power"] as? String ?? "", fact: $0["fact"] as? String ?? "") }
            m.warnings = info["warnings"] as? [String] ?? []
        }
        if let r = d["risk"] as? [String: Any], let t = r["tier"] as? Int { m.risk = ModRisk(tier: t, why: r["why"] as? String) }
        m.needs = (d["needs"] as? [[String: Any]] ?? []).map { ModNeed(key: $0["key"] as? String ?? "", fact: $0["fact"] as? String ?? "", power: $0["power"] as? String, lines: $0["lines"] as? [String]) }
        return (m, nil)
    }

    /// As `read`, on a reader of its own off the main thread (adding a mod from the chat must not hold up the app:
    /// reading a big free mod's code takes a while on a phone).
    func readInBackground(_ text: String, file: String = "", site: String = "", here: String = "") async -> (mod: InstalledMod?, error: String?) {
        let out = await ModReader.shared.evaluate(text, file: file, site: site, here: here)
        return ModStore.build(out)
    }

    /// readNamed, off the main thread.
    func readNamedInBackground(_ text: String, here: String) async -> (mod: InstalledMod?, error: String?) {
        let r = await readInBackground(text, here: here)
        guard let m = r.mod, !mods.contains(where: { $0.id == m.id }),
              let same = mods.first(where: { $0.name == m.name && $0.site == m.site }) else { return r }
        return await readInBackground(text, file: same.file, site: same.site, here: here)
    }

    /// A mod from a chat or the clipboard: as `read`, and when one kept here has its @name and site (the chat's
    /// new version of it: "the same @name replaces that mod"), under that one's id, whatever its file is called.
    func readNamed(_ text: String, here: String) -> (mod: InstalledMod?, error: String?) {
        let r = read(text, here: here)
        guard let m = r.mod, !mods.contains(where: { $0.id == m.id }),
              let same = mods.first(where: { $0.name == m.name && $0.site == m.site }) else { return r }
        return read(text, file: same.file, site: same.site, here: here)
    }

    /// What changed from one text to another, as desktop's "See differences" shows it (helper/lib/diff.js).
    func diff(_ before: String, _ after: String) -> [[String: String]] {
        guard let c = js else { return [] }
        c.setObject(before, forKeyedSubscript: "__a" as NSString)
        c.setObject(after, forKeyedSubscript: "__b" as NSString)
        let out = c.evaluateScript("JSON.stringify(__trifMods.lineDiff(__a, __b))")?.toString() ?? "[]"
        return (try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [[String: String]]) ?? []
    }

    /// Whether a mod's @match (and @exclude) covers an address (MatchPattern: in Swift, as it's asked on every page
    /// load for every mod; modfile.js matchesUrl is the same test, in the page).
    func applies(_ m: InstalledMod, to url: String) -> Bool {
        guard let u = URL(string: url) else { return false }
        return MatchPattern.any(m.matches, u) && !MatchPattern.any(m.excludes, u)
    }

    static func allow(_ needs: [ModNeed], _ allowed: [String: [String]]) -> [String: [String]] {
        var out = allowed
        for n in needs { out[n.key] = Array(Set((out[n.key] ?? []) + (n.lines ?? []))).sorted() }
        return out
    }

    // MARK: what runs

    func groupOff(_ tier: String, on site: String) -> Bool { (groupsOff[site] ?? []).contains(tier) }

    /// Whether a mod is switched on (for a site: its switch there).
    func isOn(_ m: InstalledMod, site: String?) -> Bool {
        guard m.on else { return false }
        guard let site, !site.isEmpty else { return true }
        return !(m.multiSite && m.offSites.contains(site))
    }

    /// The mods switched on, not held (a change on hold: its version before), whose @match covers this address.
    func running(on url: String) -> [InstalledMod] {
        if paused { return [] }
        let site = Site.of(URL(string: url)?.host ?? "")
        return mods.filter { m in
            guard m.on, !(m.held && m.ran == nil), !groupOff(m.tier, on: site), !(m.multiSite && m.offSites.contains(site)) else { return false }
            return applies(m, to: url)
        }
    }

    /// What runs on a page at `url`, as one string (each mod running there and the version of it that runs): a page
    /// loaded under another signature loads again to run the change, once it's the tab shown (Browser.refreshIfStale).
    func signature(_ url: String) -> String {
        running(on: url).map { m -> String in
            var h = Hasher()
            if m.held, let r = m.ran { h.combine(r.script); h.combine(r.world); h.combine(r.at); h.combine(r.style ?? "") }
            else { h.combine(m.script); h.combine(m.world); h.combine(m.at); h.combine(m.styleScript) }
            // (what it's been allowed, in case the runtime reads it rather than the script)
            for (k, v) in m.allowed.sorted(by: { $0.key < $1.key }) { h.combine(k); h.combine(v) }
            for (k, v) in m.powerArgs.sorted(by: { $0.key < $1.key }) { h.combine(k); h.combine(v) }
            return "\(m.id):\(h.finalize())"
        }.sorted().joined(separator: ",")
    }

    /// The scripts every page gets for the mods: SES and TRIF's sandbox runtime first in the box world when a boxed
    /// mod may run, then each mod that's on and not held (a change on hold: the version before), behind a check of
    /// the sites it's switched off on, and the sites whose tier is off.
    /// Made in two halves (Tim, 11-18: hangs of 14.5 s, 2.9 s… after "making the pages' scripts again"): `scriptPlan`
    /// (main thread, quick: what runs, each mod's key) and `ModStore.build` (any thread: the scripts' texts, only for
    /// mods whose key isn't in `built`); `userScripts(from:)` then makes the WKUserScripts on the main thread, each
    /// mod's kept with its key, so an unchanged mod costs nothing the next time.
    struct ScriptPlan: Sendable {
        struct One: Sendable { var key: String; var script: String; var world: String; var at: String; var style: String; var off: [String] }
        var mods: [One] = []
        var mirrorTrif = false, free = false, box = false
        var bridged: [[[String]]] = []
        /// What it puts in, as one string: the same shape, the same scripts.
        var shape: String { "\(mirrorTrif)\(free)\(box)|\(bridged)|" + mods.map(\.key).joined(separator: ",") }
    }
    /// One mod's texts: (source, at the start, world).
    typealias BuiltScripts = [(source: String, start: Bool, world: String)]
    func scriptPlan() -> ScriptPlan {
        var plan = ScriptPlan()
        if paused { return plan }
        var list: [(InstalledMod, String, String, String, String)] = []
        for m in mods where m.on {
            if m.held { if let r = m.ran { list.append((m, r.script, r.world, r.at, r.style ?? "")) }; continue }
            list.append((m, m.script, m.world, m.at, m.styleScript))
        }
        plan.mirrorTrif = list.contains(where: { $0.2 == "trif" || !$0.4.isEmpty })
        plan.free = list.contains(where: { $0.2 == "page" }) && freeScripts != nil
        plan.box = list.contains(where: { $0.2 == "box" })
        // (the page's side of a boxed mod's site-data power, trif.filterResponse: desktop's own bridge (mobile/shared/gen/
        // page-bridge.js), in the page's world at its start, only on the pages of boxed mods allowed site-data (a held
        // change's version before: the power in the grant its script carries). It wraps fetch and XMLHttpRequest only
        // once such a mod asks for a filter; what a filter gives back is checked in the box world (remove or reorder
        // only), and anything else leaves the site's response as it was.)
        plan.bridged = list.filter { m, script, world, _, _ in world == "box" && (m.held ? script.contains("\"site-data\"") : m.powers.contains("site-data")) }
            .map { [$0.0.matches, $0.0.excludes] }
        var seen: [String: PlanKey] = [:]
        for (m, script, world, at, style) in list {
            let off = Array(Set((m.multiSite ? m.offSites : []) + groupsOff.filter { $0.value.contains(m.tier) }.map(\.key))).sorted()
            // (a mod's key is made again only when its texts changed: the same strings compare at once, so a change to
            // another mod costs this one nothing; hashing every script at each change was most of the time, 11-18)
            let key: String
            if let k = planKeys[m.id], k.script == script, k.style == style, k.world == world, k.at == at, k.off == off { key = k.key }
            else {
                var h = Hasher()
                h.combine(script); h.combine(world); h.combine(at); h.combine(style); h.combine(off)
                key = "\(m.id)#\(h.finalize())"
            }
            seen[m.id] = PlanKey(script: script, style: style, world: world, at: at, off: off, key: key)
            plan.mods.append(.init(key: key, script: script, world: world, at: at, style: style, off: off))
        }
        planKeys = seen
        return plan
    }
    private struct PlanKey { var script, style, world, at: String; var off: [String]; var key: String }
    private var planKeys: [String: PlanKey] = [:]
    /// The texts of the plan's mods not in `have` (any thread).
    nonisolated static func build(_ plan: ScriptPlan, have: Set<String>) -> [String: BuiltScripts] {
        var out: [String: BuiltScripts] = [:]
        for m in plan.mods where !have.contains(m.key) && out[m.key] == nil {
            let behind = { (s: String) in m.off.isEmpty ? s : "(function () { const h = location.hostname.replace(/^www\\./, ''); if (\(Browser.jsonText(m.off)).some((s) => h === s || h.endsWith('.' + s))) return;\n\(s)\n})();" }
            var one: BuiltScripts = []
            // (a free mod's style section first, at the page's start whenever its code runs, as desktop's is)
            if !m.style.isEmpty { one.append((behind(m.style), true, "trif")) }
            one.append((behind(m.script), m.at == "start", m.world))
            out[m.key] = one
        }
        return out
    }
    /// Each mod's WKUserScripts as last made, by key (only the plan's last mods are kept).
    private var built: [String: [WKUserScript]] = [:]
    var builtKeys: Set<String> { Set(built.keys) }
    private static func world(_ w: String) -> WKContentWorld { w == "box" ? Browser.boxWorld : w == "page" ? .page : Browser.trifWorld }
    /// The shared scripts, made once.
    private lazy var mirrorScripts: (trif: WKUserScript, box: WKUserScript) = {
        let mirror = Browser.resource("style-mirror", "js")
        return (WKUserScript(source: mirror, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld),
                WKUserScript(source: mirror, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.boxWorld))
    }()
    private lazy var boxScripts: [WKUserScript] = [
        WKUserScript(source: Browser.resource("ses.umd.min", "js"), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.boxWorld),
        WKUserScript(source: Browser.resource("sandbox-runtime", "js"), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.boxWorld),
    ]
    private lazy var freeUserScripts: [WKUserScript] = freeScripts.map { free in [
        WKUserScript(source: free.relay, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.trifWorld),
        WKUserScript(source: free.page, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page),
    ] } ?? []
    private var bridgeScript: (pairs: [[[String]]], script: WKUserScript)?

    /// The WKUserScripts for a plan, with the texts `fresh` built for mods new or changed since (main thread).
    func userScripts(from plan: ScriptPlan, fresh: [String: BuiltScripts]) -> [WKUserScript] {
        var out: [WKUserScript] = []
        // (first in each world with a mod: a style element the page's policy refuses still applies: Web/style-mirror.js;
        // TRIF's world has a free mod's style section too)
        if plan.mirrorTrif { out.append(mirrorScripts.trif) }
        // (where a free mod may run: desktop's window.trif.log/warn/error in the page's world, and their way to the
        // app's Diagnostics in TRIF's ("mod log" lines: a mod's start, its log lines, its errors), before any mod)
        if plan.free { out += freeUserScripts }
        if plan.box { out.append(mirrorScripts.box); out += boxScripts }
        if !plan.bridged.isEmpty {
            if bridgeScript?.pairs != plan.bridged {
                bridgeScript = (plan.bridged, WKUserScript(source: Browser.resource("page-bridge", "js") + "(\(Browser.jsonText(plan.bridged)));", injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
            }
            out.append(bridgeScript!.script)
        }
        var keep: [String: [WKUserScript]] = [:]
        for m in plan.mods {
            let scripts: [WKUserScript]
            if let have = keep[m.key] ?? built[m.key] { scripts = have }
            else {
                let texts = fresh[m.key] ?? ModStore.build(ScriptPlan(mods: [m]), have: [])[m.key] ?? []
                scripts = texts.map { WKUserScript(source: $0.source, injectionTime: $0.start ? .atDocumentStart : .atDocumentEnd, forMainFrameOnly: true, in: ModStore.world($0.world)) }
            }
            keep[m.key] = scripts
            out += scripts
        }
        built = keep
        return out
    }
    /// All at once, on the main thread (the app's start: the scripts must be there before any page).
    func userScripts() -> [WKUserScript] {
        let plan = scriptPlan()
        return userScripts(from: plan, fresh: ModStore.build(plan, have: builtKeys))
    }

    // MARK: changes

    private func stamp() -> String { String(Int(Date().timeIntervalSince1970 * 1000)) }

    /// Adds a mod, or a new version of the one with its id (the one before kept in its history). `source`: chat,
    /// import, link or pasted. One from a chat (the user tapped Add it) is on; an import starts off, marked new
    /// (updated, if it replaces one), as on desktop. A new version that needs an OK the one before didn't: the
    /// one before keeps running until the user decides.
    @discardableResult
    func add(_ new: InstalledMod, source: String) -> InstalledMod {
        var m = new
        m.source = source
        if let i = mods.firstIndex(where: { $0.id == m.id }) {
            let old = mods[i]
            m.history = old.history
            if old.code != m.code { m.history.insert(ModVersion(stamp: stamp(), at: Date(), code: old.code, source: ["import", "edit", "computer"].contains(source) ? source : "chat"), at: 0) }
            m.history = Array(m.history.filter { $0.at > Date().addingTimeInterval(-30 * 86400) }.prefix(30))
            m.allowed = old.allowed
            m.offSites = old.offSites
            m.added = old.added
            // (from the computer, phone sync: judged as an edit, its switch kept)
            if source == "import" { m.on = false; m.newOff = "update" } else if source == "edit" || source == "computer" { m.on = old.on; m.newOff = old.newOff } else { m.on = true; m.newOff = nil }
            // (the version before ran, and this one waits: it keeps running meanwhile)
            if m.held, !old.held || old.ran != nil { m.ran = old.ran ?? .init(code: old.code, script: old.script, world: old.world, at: old.at, style: old.styleScript) }
            mods[i] = m
        } else {
            // (new from the computer, phone sync D8: as an import, off and marked new)
            if source == "import" { m.on = false; m.newOff = "import" } else if source == "computer" { m.on = false; m.newOff = "computer" }
            mods.append(m)
        }
        save()
        return m
    }

    static let trashDays = 30.0

    /// A quick ask's Undo: the mod as it was before it was added (`before`), or gone if it was new; not to Recently
    /// deleted (it never was, as far as the person goes).
    func undoAdd(_ id: String, before: InstalledMod?) {
        if let before {
            if let i = mods.firstIndex(where: { $0.id == id }) { mods[i] = before } else { mods.append(before) }
        } else {
            mods.removeAll { $0.id == id }
        }
        save()
    }

    /// Deletes a mod: to Recently deleted (30 days). `by`: you (the Mods tab: Undo too) or computer (a sync).
    func remove(_ id: String, by: String = "you") {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        let m = mods.remove(at: i)
        if by == "you" { lastDeleted = m }
        trash.insert(DeletedMod(mod: m, at: Date(), by: by), at: 0)
        trash = Array(trash.filter { $0.at > Date().addingTimeInterval(-ModStore.trashDays * 86400) }.prefix(200))
        save()
    }

    func undoDelete() {
        guard let m = lastDeleted else { return }
        if !mods.contains(where: { $0.id == m.id }) { mods.append(m) }
        if let i = trash.firstIndex(where: { $0.mod.id == m.id }) { trash.remove(at: i) }
        lastDeleted = nil
        save()
    }

    /// Puts a mod from Recently deleted back (a change like any other: it syncs again). False: one with its id is
    /// here now.
    @discardableResult
    func restoreDeleted(_ entry: String) -> Bool {
        guard let i = trash.firstIndex(where: { $0.id == entry }), !mods.contains(where: { $0.id == trash[i].mod.id }) else { return false }
        mods.append(trash.remove(at: i).mod)
        if lastDeleted.map({ m in mods.contains { $0.id == m.id } }) == true { lastDeleted = nil }
        save()
        return true
    }

    /// A mod's switch: the whole mod, or (a mod for several sites) its switch on one site.
    func setOn(_ id: String, _ on: Bool, site: String?) {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        if let site, !site.isEmpty, mods[i].multiSite {
            mods[i].offSites.removeAll { $0 == site }
            if !on { mods[i].offSites.append(site) } else if !mods[i].on { mods[i].on = true }
        } else {
            mods[i].on = on
        }
        if on { mods[i].newOff = nil }
        save()
    }

    func setGroup(_ tier: String, on: Bool, site: String) {
        var list = groupsOff[site] ?? []
        list.removeAll { $0 == tier }
        if !on { list.append(tier) }
        groupsOff[site] = list.isEmpty ? nil : list
        save()
    }

    /// Allow: what it waits for is allowed for it (a later version that needs nothing more runs without asking).
    func approve(_ id: String) {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        mods[i].allowed = ModStore.allow(mods[i].waiting, mods[i].allowed)
        mods[i].ran = nil
        save()
    }

    /// Don't allow a change on hold: the version before is back (this one kept in its history). A new mod: deleted.
    func reject(_ id: String) {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        guard let ran = mods[i].ran, var back = read(ran.code, file: mods[i].file, site: mods[i].site).mod else { remove(id); return }
        let now = mods[i]
        back.on = now.on; back.offSites = now.offSites; back.allowed = now.allowed; back.source = now.source; back.added = now.added
        back.extraNeeds = []
        back.history = [ModVersion(stamp: stamp(), at: Date(), code: now.code, source: "undo")] + now.history
        mods[i] = back
        save()
    }

    // MARK: editing (the code card's Edit)

    /// An edit checked as `trif check` checks a file (modfile.js checkMod): {ok, errors: [{line, message}], lint, tier}.
    func check(_ text: String, for m: InstalledMod) -> [String: Any] {
        guard let c = js else { return ["ok": false, "errors": [["message": "the mod reader didn't start"]]] }
        c.setObject(text, forKeyedSubscript: "__input" as NSString)
        c.setObject(["file": m.file, "site": m.site], forKeyedSubscript: "__opts" as NSString)
        let out = c.evaluateScript("JSON.stringify(__trifMods.checkMod(__input, __opts))")?.toString() ?? ""
        return (try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any]) ?? ["ok": false, "errors": [["message": c.exception?.toString() ?? "the check gave nothing back"]]]
    }

    /// What a change asks about beyond its code's needs, as held.js judges a change against the version before: a
    /// @match for another site, when the mod can do something there (a style mod or a boxed mod without powers can't
    /// act, wherever it runs); and becoming a free mod. Only what the user hasn't allowed for the mod waits (seeded).
    static func changeNeeds(_ m: InstalledMod, was old: InstalledMod) -> [ModNeed] {
        var out: [ModNeed] = []
        if m.tier == "free" && old.tier != "free" { out.append(ModNeed(key: "tier:free", fact: "is now a free mod, so it can do anything the page can do")) }
        if !m.needs.isEmpty && !old.everywhere {
            let home = Site.of(old.site)
            for p in m.matches {
                let host = p == "<all_urls>" ? "*" : (p.range(of: "://").map { String(p[$0.upperBound...].prefix { $0 != "/" }) } ?? "")
                let h = host.replacingOccurrences(of: "*.", with: "")
                if host != "*", Site.host(h, isIn: home) { continue }
                out.append(ModNeed(key: "match:\(p)", fact: "runs on \(p), outside \(home)"))
            }
        }
        return out
    }

    /// What the user had allowed, plus what the version that ran already did (its sites, its tier), so a change is
    /// asked about only for what it adds.
    static func seeded(_ old: InstalledMod) -> [String: [String]] {
        guard !old.held else { return old.allowed }
        var keys = old.matches.map { ModNeed(key: "match:\($0)", fact: "") }
        if old.tier == "free" { keys.append(ModNeed(key: "tier:free", fact: "")) }
        return allow(keys + old.extraNeeds, old.allowed)
    }

    /// Saves an edit (checked first: a broken one is never saved). The version before goes into History ("before you
    /// edited it"); the edit is judged as any change (held.js): if it needs an OK the version before didn't, the
    /// version before keeps running and the approval card asks. Its id and site stay (desktop's: the file stays where
    /// it is; a new @name is only its name). Returns the mod and the stamp of the version kept, or the check's answer.
    func saveEdit(_ id: String, _ text: String) -> (mod: InstalledMod?, stamp: String?, check: [String: Any]) {
        guard let old = mods.first(where: { $0.id == id }) else { return (nil, nil, ["ok": false, "errors": [["message": "that mod isn't here any more"]]]) }
        let checked = check(text, for: old)
        guard checked["ok"] as? Bool == true, var m = read(text, file: old.file, site: old.site).mod else { return (nil, nil, checked) }
        guard m.code != old.code else { return (old, nil, checked) }
        m.allowed = ModStore.seeded(old)
        m.extraNeeds = ModStore.changeNeeds(m, was: old)
        var kept = old
        kept.allowed = m.allowed
        if let i = mods.firstIndex(where: { $0.id == id }) { mods[i] = kept }
        let saved = add(m, source: "edit")
        return (saved, saved.history.first?.stamp, checked)
    }

    /// Restore a kept version: it becomes the mod (the current one kept in History), judged again like any change.
    func restore(_ id: String, stamp s: String, as source: String = "restore") -> Bool {
        guard let i = mods.firstIndex(where: { $0.id == id }), let v = mods[i].history.first(where: { $0.stamp == s }),
              var back = read(v.code, file: mods[i].file, site: mods[i].site).mod else { return false }
        let now = mods[i]
        back.on = now.on; back.offSites = now.offSites; back.source = now.source; back.added = now.added; back.newOff = now.newOff
        back.allowed = ModStore.seeded(now)
        back.extraNeeds = ModStore.changeNeeds(back, was: now)
        back.history = [ModVersion(stamp: stamp(), at: Date(), code: now.code, source: source)] + now.history
        if back.held, !now.held { back.ran = .init(code: now.code, script: now.script, world: now.world, at: now.at, style: now.styleScript) }
        mods[i] = back
        save()
        return true
    }
}

/// A mod from the chat or the clipboard: what it is and does, before it's added.
struct ModOfferView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    let mod: InstalledMod

    /// A boxed mod's findings are its powers ("It can …"), as the approval card says them.
    private var asks: Bool { mod.tier == "boxed" }
    /// The approval card's own lines: each need's fact but the "together" warnings and per-site keys.
    private var findings: [String] {
        var seen = Set<String>()
        return mod.needs.filter { n in
            !n.fact.isEmpty && !n.key.hasPrefix("power:together:") && n.key.range(of: "^site:.+:[a-z+-]+$", options: .regularExpression) == nil
        }.map(\.fact).filter { seen.insert($0).inserted }
    }
    /// The "Together, it …" warnings (a "many" one is said as it is).
    private var together: [(fact: String, many: Bool)] {
        var seen = Set<String>()
        return mod.needs.filter { $0.key.hasPrefix("power:together:") && !$0.fact.isEmpty && seen.insert($0.fact).inserted }
            .map { ($0.fact, $0.key.hasPrefix("power:together:many:")) }
    }
    private func icon(for fact: String) -> String {
        guard let n = mod.needs.first(where: { $0.fact == fact }) else { return "circle" }
        if n.key.hasPrefix("match:") { return "arrow.up.right.square" }
        if n.key.hasPrefix("tier:") { return "cpu" }
        return "checkmark.shield"
    }
    /// It runs on a site other than the one it came from (or on every site): the warning's words.
    private var elsewhere: (title: String, text: String)? {
        guard let from = mod.cameFrom, !from.isEmpty else { return nil }
        if mod.everywhere || mod.sites.contains("all-sites") {
            return ("It runs on every site", "It came from \(from), but it runs on every site you visit, not just \(from). Add it only if you meant it to.")
        }
        let others = Array(Set(mod.sites.map(Site.of).filter { !$0.isEmpty && $0 != from })).sorted()
        guard !others.isEmpty else { return nil }
        let list = others.joined(separator: ", ")
        let also = mod.sites.map(Site.of).contains(from)
        return ("It runs on \(others.count == 1 ? "another site" : "other sites")",
                "It came from \(from), but it \(also ? "also " : "")runs on \(list). Add it only if you meant it to change \(others.count == 1 ? "that site" : "those sites").")
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        // (a reply with several mods: offered in turn)
                        if let place = browser.offerPlace { Text("\(place.n) of \(place.of) mods in the reply").font(.caption).foregroundStyle(.secondary) }
                        Text(mod.name).font(.headline)
                        Text(mod.tierName).font(.caption.bold()).foregroundStyle(mod.colour)
                        if !mod.description.isEmpty { Text(mod.description).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }
                // (Tim, 11-17: a mod that runs on another site than the one it came from stands out, first thing)
                if let away = elsewhere {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(away.title).font(.subheadline.bold())
                                Text(away.text).font(.footnote)
                            }
                        } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                        .foregroundStyle(Color.trifCoral)
                        .listRowBackground(Color.trifCoral.opacity(0.12))
                        .accessibilityElement(children: .combine)
                    }
                }
                Section("Runs on") { Text(mod.sites.joined(separator: ", ")).font(.footnote.monospaced()) }
                if !mod.powers.isEmpty { Section("Asks for these powers") { Text(mod.powers.joined(separator: ", ")).font(.footnote.monospaced()) } }
                // (what TRIF found, as the Mods tab's approval card says it: mods-page.js renderApproval)
                if !findings.isEmpty || !together.isEmpty {
                    Section {
                        ForEach(Array(findings.enumerated()), id: \.offset) { _, f in
                            Label { Text(asks ? "It \(f)." : f).font(.footnote) } icon: { Image(systemName: icon(for: f)).font(.footnote) }
                        }
                        ForEach(Array(together.enumerated()), id: \.offset) { _, t in
                            if t.many { Text(t.fact).font(.footnote).foregroundStyle(Color.trifCoral) }
                            else { (Text("Together,").bold() + Text(" it \(t.fact).")).font(.footnote).foregroundStyle(Color.trifCoral) }
                        }
                    } header: { Text(asks ? "It asks for these powers. TRIF holds it to them:" : "TRIF found that this mod:").textCase(nil) }
                }
                if mod.tier == "free" {
                    Section { Text("A free mod can do anything the page can do, including posting or sending as you. Only enable free mods that you trust.").font(.footnote).foregroundStyle(Color.trifCoral) }
                }
                // (the buttons before the code (Tim, 11-16: "sometimes you don't wanna read the code and you have to
                // scroll down"), after all that says what Add it agrees to: name, what it does, sites, powers, warning)
                Section {
                    Button("Add it") { browser.addMod(mod); dismiss() }.bold()
                    Button("Cancel", role: .cancel) { browser.offerClosed(declined: true); dismiss() }
                }
                Section("Its code") {
                    ScrollView(.horizontal) { Text(mod.code).font(.caption2.monospaced()).textSelection(.enabled) }.frame(maxHeight: 260)
                }
            }
            .navigationTitle("Add this mod?")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}


/// The mod reader (shared/gen/mods.js) in a JavaScriptCore context of its own, on a queue of its own: reading a mod
/// off the main thread.
final class ModReader: @unchecked Sendable {
    static let shared = ModReader()
    static let readCall = "JSON.stringify((function () { const f = __trifMods.findMod(__input); return f ? __trifMods.readMod(f, __opts) : { error: 'there is no mod file (a ==WebMod== header) in it' }; })())"
    private let queue = DispatchQueue(label: "trif.mod-reader", qos: .userInitiated)
    private var context: JSContext?

    func evaluate(_ text: String, file: String, site: String, here: String) async -> String {
        await withCheckedContinuation { (k: CheckedContinuation<String, Never>) in
            queue.async {
                if self.context == nil {
                    let c = JSContext()
                    let src = Bundle.main.url(forResource: "mods", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
                    c?.evaluateScript(src)
                    self.context = c
                }
                guard let c = self.context else { k.resume(returning: ""); return }
                c.setObject(text, forKeyedSubscript: "__input" as NSString)
                c.setObject(["file": file, "site": site, "here": here], forKeyedSubscript: "__opts" as NSString)
                k.resume(returning: c.evaluateScript(ModReader.readCall)?.toString() ?? (c.exception?.toString() ?? ""))
            }
        }
    }
}

/// Chrome-style match patterns (https://x.com/*, *://*.x.com/*, <all_urls>), as modfile.js matchesUrl tests them.
enum MatchPattern {
    nonisolated(unsafe) private static var paths: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func any(_ patterns: [String], _ u: URL) -> Bool { patterns.contains { one($0, u) } }

    static func one(_ p: String, _ u: URL) -> Bool {
        let scheme = (u.scheme ?? "").lowercased(), host = (u.host ?? "").lowercased()
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
        var target = u.path.isEmpty ? "/" : u.path
        if let q = u.query { target += "?" + q }
        // (URL.path decodes percent escapes; the page's location.pathname keeps them)
        if let comps = URLComponents(url: u, resolvingAgainstBaseURL: false) { target = (comps.percentEncodedPath.isEmpty ? "/" : comps.percentEncodedPath) + (comps.percentEncodedQuery.map { "?" + $0 } ?? "") }
        return re.firstMatch(in: target, range: NSRange(target.startIndex..., in: target)) != nil
    }
}

/// A mod in Recently deleted.
struct DeletedMod: Codable, Identifiable, Equatable {
    var mod: InstalledMod
    var at: Date
    /// you, or computer (deleted there, phone sync)
    var by: String
    var id: String { "\(mod.id)@\(Int(at.timeIntervalSince1970 * 1000))" }
}

/// Phone sync (PhoneSync.swift): the mods as the sync sees them, and its changes judged as the app's own are
/// (docs/PHONE-SYNC.md section 6 on branch phone-link).
extension ModStore: @preconcurrency PhoneSyncStore {
    /// Every mod kept under a site (not the proof of concept's, whose ids have none): id → its file.
    func syncFiles() -> [String: String] {
        Dictionary(mods.filter { $0.id.contains("/") }.map { ($0.id, $0.code) }, uniquingKeysWith: { a, _ in a })
    }

    /// New: as an import (off, marked new, waiting if its code needs an OK). Changed: as an edit (saveEdit's rules:
    /// what the version before was allowed, a new site or becoming free asks; the version before keeps running
    /// meanwhile; its history keeps it, source computer; its switch stays). Not a mod the reader takes: refused.
    func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken {
        guard let cut = id.firstIndex(of: "/") else { return .refused("not a mod id") }
        let site = String(id[..<cut]), name = String(id[id.index(after: cut)...])
        let r = read(code, file: "\(name).js", site: site)
        guard var m = r.mod else { return .refused(r.error ?? "the reader didn't take it") }
        guard m.id == id else { return .refused("its id came out as \(m.id)") }
        if let old = mods.first(where: { $0.id == id }) {
            guard m.code != old.code else { return .taken(held: old.held) }
            m.allowed = ModStore.seeded(old)
            m.extraNeeds = ModStore.changeNeeds(m, was: old)
            var kept = old
            kept.allowed = m.allowed
            if let i = mods.firstIndex(where: { $0.id == id }) { mods[i] = kept }
        }
        let saved = add(m, source: "computer")
        Diagnostics.shared.log("sync", "\(isNew ? "new" : "changed") from the computer: \(id)\(saved.held ? ", waiting for an OK" : "")")
        return .taken(held: saved.held)
    }

    func syncRemove(_ id: String) {
        remove(id, by: "computer")
        Diagnostics.shared.log("sync", "deleted on the computer: \(id) (in Recently deleted)")
    }
}

/// Mods in files: Application Support/mods/<id>.json and an order file, written atomically on a queue of their own
/// (the latest list wins; a write in progress finishes first).
enum ModFilesStore {
    private static let queue = DispatchQueue(label: "trif.mod-files", qos: .utility)
    static var dir: URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("mods")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    private static func file(_ id: String) -> URL { dir.appendingPathComponent(id.replacingOccurrences(of: "/", with: "__") + ".json") }

    static func load() -> [InstalledMod] {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("order.json")), let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return ids.compactMap { id in (try? Data(contentsOf: file(id))).flatMap { try? JSONDecoder().decode(InstalledMod.self, from: $0) } }
    }

    /// Recently deleted, one file beside the mods' folder.
    private static var trashFile: URL { dir.deletingLastPathComponent().appendingPathComponent("mods-deleted.json") }
    static func loadTrash() -> [DeletedMod] {
        (try? Data(contentsOf: trashFile)).flatMap { try? JSONDecoder().decode([DeletedMod].self, from: $0) } ?? []
    }
    static func writeTrash(_ list: [DeletedMod]) {
        queue.async { if let d = try? JSONEncoder().encode(list) { try? d.write(to: trashFile, options: .atomic) } }
    }

    static func write(_ mods: [InstalledMod]) {
        let list = mods
        queue.async {
            let enc = JSONEncoder()
            for m in list { if let d = try? enc.encode(m) { try? d.write(to: file(m.id), options: .atomic) } }
            if let d = try? enc.encode(list.map(\.id)) { try? d.write(to: dir.appendingPathComponent("order.json"), options: .atomic) }
            let keep = Set(list.map { file($0.id).lastPathComponent } + ["order.json"])
            for f in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where !keep.contains(f) { try? FileManager.default.removeItem(at: dir.appendingPathComponent(f)) }
        }
    }
}
