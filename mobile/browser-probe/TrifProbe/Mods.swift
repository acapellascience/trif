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

// (ModNeed and the hold rules: ModHolds.swift, the shared mobile/shared/core/mod-store.js)

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
    /// When the person last changed its switch here (ms since 1970), or the computer's time for a switch the phone
    /// sync set (docs/PHONE-SYNC.md 4b: the later change wins). nil: never.
    var switchAt: Double?
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
    /// Its stable id: the header's first valid `@id` line (docs/PHONE-SYNC.md 2a; ModID), as the reader found it; nil:
    /// none. Two in one folder with one id: only the first by file name keeps it (ModStore.keptUids).
    var uid: String? = nil
    /// (offered, not kept) The changes a chat's edit blocks made to the mod here (Tim, 11-19), for Add this mod?'s
    /// review; nil: a whole file. Browser.addMod drops it before the mod is kept.
    var edits: [ModEdits.Change]? = nil

    struct RanVersion: Codable, Equatable { var code: String; var script: String; var world: String; var at: String; var style: String? = nil }

    var tierName: String { tier == "style" ? "Style mod" : tier == "boxed" ? "Boxed mod" : "Free mod" }
    /// The tier's colour, as the panel's (sidepanel.css --led-green, --led-yellow, --led-coral).
    var colour: Color { tier == "style" ? .trifGreen : tier == "boxed" ? .trifYellow : .trifCoral }
    var everywhere: Bool { site == "all-sites" }
    /// Its file's name, as desktop keeps it (sites/<site>/<name>.js): read again, it keeps its id.
    var file: String { "\(id.split(separator: "/").last ?? "mod").js" }
    /// A mod for several sites (or every site) has a switch per site (desktop's isMultiSite).
    var multiSite: Bool { ModRuns.multiSite(everywhere: everywhere, sites: sites) }

    /// The needs not yet allowed (modfile.js waiting): what a hold is waiting for.
    var waiting: [ModNeed] { ModHolds.waiting(needs + extraNeeds, allowed: allowed) }
    /// The fields a change takes from another version, by the shared rules' names (ModChanges keep).
    mutating func take(_ fields: Set<String>, from o: InstalledMod) {
        for f in fields {
            switch f {
            case "on": on = o.on; switchAt = o.switchAt
            case "newOff": newOff = o.newOff
            case "offSites": offSites = o.offSites; switchAt = o.switchAt
            case "allowed": allowed = o.allowed
            case "source": source = o.source
            case "added": added = o.added
            default: Core.report("a change keeps \(f), which the app doesn't know")
            }
        }
    }

    /// What the hold rules read of it (ModHolds).
    var holdFacts: ModHolds.Facts { .init(tier: tier, site: site, matches: matches, needs: needs, extraNeeds: extraNeeds, allowed: allowed, ran: ran != nil) }
    /// What the rules of what runs read of it (ModRuns).
    var runFacts: ModRuns.Facts { .init(hold: holdFacts, on: on, sites: sites, offSites: offSites, excludes: excludes) }
    var held: Bool { !waiting.isEmpty }
    /// A change on hold: the version before runs meanwhile.
    var pending: Bool { held && ran != nil }

    enum CodingKeys: String, CodingKey { case id, site, name, description, tier, sites, matches, excludes, powers, powerArgs, facts, warnings, risk, hash, needs, code, script, world, at, on, offSites, switchAt, allowed, source, newOff, added, history, ran, extraNeeds, uid }

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
        try c.encode(world, forKey: .world); try c.encode(at, forKey: .at); try c.encode(on, forKey: .on); try c.encode(offSites, forKey: .offSites); try c.encodeIfPresent(switchAt, forKey: .switchAt)
        try c.encode(allowed, forKey: .allowed); try c.encode(source, forKey: .source); try c.encodeIfPresent(newOff, forKey: .newOff); try c.encode(added, forKey: .added)
        try c.encode(Array(history.prefix(10)), forKey: .history); try c.encodeIfPresent(ran, forKey: .ran); try c.encode(extraNeeds, forKey: .extraNeeds)
        try c.encodeIfPresent(uid, forKey: .uid)
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
        switchAt = try c.decodeIfPresent(Double.self, forKey: .switchAt)
        allowed = try c.decodeIfPresent([String: [String]].self, forKey: .allowed) ?? [:]
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "chat"
        newOff = try c.decodeIfPresent(String.self, forKey: .newOff)
        added = try c.decodeIfPresent(Date.self, forKey: .added) ?? Date()
        history = try c.decodeIfPresent([ModVersion].self, forKey: .history) ?? []
        ran = try c.decodeIfPresent(RanVersion.self, forKey: .ran)
        extraNeeds = try c.decodeIfPresent([ModNeed].self, forKey: .extraNeeds) ?? []
        uid = try c.decodeIfPresent(String.self, forKey: .uid)
    }

    /// What identity reads of it (ModID): its file id, folder, file, the id its text has, its name.
    var idEntry: ModID.Entry { .init(id: id, site: site, file: file, uid: uid, name: name) }

    /// Another reading of the same mod (its text changed by TRIF: an id stamped, a rename, a move to another file
    /// id) with this record's own state: its switches, approvals, History, the version kept running, its marks.
    func carry(to again: InstalledMod) -> InstalledMod {
        var m = again
        m.on = on; m.offSites = offSites; m.switchAt = switchAt; m.allowed = allowed; m.source = source; m.newOff = newOff
        m.added = added; m.history = history; m.ran = ran; m.extraNeeds = extraNeeds; m.cameFrom = cameFrom
        return m
    }
}

@MainActor
final class ModStore: ObservableObject {
    @Published private(set) var mods: [InstalledMod] = [] { didSet { keptCache = nil } }
    /// The tiers switched off on a site (the Mods tab's On / Off on each tier): site → [style, boxed, free].
    @Published private(set) var groupsOff: [String: [String]] = [:]
    /// The last mod deleted, for Undo (this launch only).
    @Published private(set) var lastDeleted: InstalledMod?
    /// Recently deleted (phone sync, D7): every mod deleted here, by the user or by a sync, for 30 days, newest first.
    @Published private(set) var trash: [DeletedMod] = []
    /// The computer's approval hints (phone sync, D13), by sync key: what it allows as it is. Only words on the
    /// approval card ("You allowed this on …"), never an approval. Kept in the settings (small).
    @Published private(set) var syncHintsKept: [String: PhoneSync.Hint] = ModStore.loadHints()
    private static let hintsKey = "syncHints"
    nonisolated static func loadHints() -> [String: PhoneSync.Hint] {
        guard let d = UserDefaults.standard.data(forKey: hintsKey), let h = try? JSONDecoder().decode([String: PhoneSync.Hint].self, from: d) else { return [:] }
        return h
    }
    /// The computer allowed this version as it is, asking nothing beyond what it allowed there (the hint fits).
    func allowedOnComputer(_ m: InstalledMod) -> Bool {
        guard let h = syncHintsKept[syncKey(m)] else { return false }
        return h.fits(rev: PhoneSync.rev(m.code), tier: m.tier, powers: m.tier == "boxed" ? m.powers : [])
    }
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
            m.on = old.on; m.offSites = old.offSites; m.switchAt = old.switchAt; m.source = old.source; m.newOff = old.newOff; m.added = old.added; m.history = old.history
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

    // MARK: ids (ModID; docs/PHONE-SYNC.md 2a)

    private var keptCache: [String: String]?
    /// File id → the stable id it keeps: its text's, unless an earlier file in its folder has the same one.
    var keptUids: [String: String] {
        if let k = keptCache { return k }
        let k = ModID.kept(mods.map(\.idEntry))
        keptCache = k
        return k
    }
    /// The mods as identity reads them, each with the id it keeps.
    private var idEntries: [ModID.Entry] { let k = keptUids; return mods.map { var e = $0.idEntry; e.uid = k[$0.id]; return e } }
    /// A mod's sync key (D16): `<site>#<id>` with a stable id, else its file id.
    func syncKey(_ m: InstalledMod) -> String { PhoneSync.key(m.id, uid: keptUids[m.id]) }
    /// Renames this launch (old file id → new), so what held an old id (a quick ask's Undo) finds the mod.
    private var renamedTo: [String: String] = [:]
    /// A mod's file id now, after any renames this launch.
    func current(_ id: String) -> String {
        var id = id, seen = Set<String>()
        while let to = renamedTo[id], seen.insert(id).inserted { id = to }
        return id
    }
    /// Told of each rename (old file id, new): Browser passes it to what keeps ids (Safety, tabs, the Mods tab).
    var onRename: ((String, String) -> Void)?

    /// Where a mod just read is kept and with which text: under the installed mod it's a new version of (the one with
    /// its stable id on its site; `byName`: else the one with its @name, as before), and its id stamped in when it has
    /// none (that mod's, else a new one; never for `computer`). nil: as it was read.
    private func placement(_ m: InstalledMod, byName: Bool, source: String) -> (file: String, site: String, text: String)? {
        let p = ModID.place(m.idEntry, among: idEntries, byName: byName)
        // (an id of its own: one no mod on its site has, or the one it updates, which it then keeps)
        let u = ModID.stamp(has: ModID.isId(m.uid) ? m.uid : nil, before: p.replaces.flatMap { keptUids[$0] }, source: source)
        let text = u.flatMap { ModID.withMeta(m.code, uid: $0) } ?? m.code
        guard p.file != m.file || p.site != m.site || text != m.code else { return nil }
        return (p.file, p.site, text)
    }
    /// `placement` applied (read again on this thread; nil: the same).
    private func placed(_ m: InstalledMod, byName: Bool, source: String) -> InstalledMod {
        guard let p = placement(m, byName: byName, source: source), let again = read(p.text, file: p.file, site: p.site).mod else { return m }
        return m.carry(to: again)
    }
    /// A text with its stable id: its own, else `keep`, else a new one (an edit, a restore: TRIF writes it).
    private func stamped(_ text: String, keep: String?, source: String) -> String {
        guard source != "computer", let u = ModID.stamp(has: nil, before: keep, source: source) else { return text }
        guard let p = ModID.parts(text), p.header, !ModID.isId(p.uid) else { return text }
        return ModID.withMeta(text, uid: u) ?? text
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
        m.uid = ModID.isId(d["uid"] as? String) ? d["uid"] as? String : nil
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
        guard let m = r.mod, let p = placement(m, byName: true, source: "chat") else { return r }
        let again = await readInBackground(p.text, file: p.file, site: p.site, here: here)
        return again.mod == nil ? r : again
    }

    /// A mod from a chat or the clipboard: as `read`, and when one kept here is the same mod, under that one's id,
    /// whatever its file is called: the one with its stable id on its site first (11-18, docs/PHONE-SYNC.md 2a), else
    /// the one with its @name ("the same @name replaces that mod"). Its id is stamped in when it has none (the mod
    /// it replaces keeps its own).
    func readNamed(_ text: String, here: String) -> (mod: InstalledMod?, error: String?) {
        let r = read(text, here: here)
        guard let m = r.mod, let p = placement(m, byName: true, source: "chat") else { return r }
        let again = read(p.text, file: p.file, site: p.site, here: here)
        return again.mod == nil ? r : again
    }

    /// What changed from one text to another, as desktop's "See differences" shows it (helper/lib/diff.js).
    func diff(_ before: String, _ after: String) -> [[String: String]] {
        guard let c = js else { return [] }
        c.setObject(before, forKeyedSubscript: "__a" as NSString)
        c.setObject(after, forKeyedSubscript: "__b" as NSString)
        let out = c.evaluateScript("JSON.stringify(__trifMods.lineDiff(__a, __b))")?.toString() ?? "[]"
        return (try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [[String: String]]) ?? []
    }

    /// Whether a mod's @match (and @exclude) covers an address (ModRuns.applies: a Swift twin of the shared rule, as
    /// it's asked on every page load for every mod; modfile.js matchesUrl is the same test, in the page).
    func applies(_ m: InstalledMod, to url: String) -> Bool {
        ModRuns.applies(m.matches, m.excludes, URL(string: url).map(MatchPattern.parts))
    }

    static func allow(_ needs: [ModNeed], _ allowed: [String: [String]]) -> [String: [String]] { ModHolds.allow(needs, allowed) }

    // MARK: what runs

    func groupOff(_ tier: String, on site: String) -> Bool { (groupsOff[site] ?? []).contains(tier) }

    /// Whether a mod is switched on (for a site: its switch there).
    func isOn(_ m: InstalledMod, site: String?) -> Bool { ModRuns.isOn(m.runFacts, site: site) }

    /// The mods switched on, not held (a change on hold: its version before), whose @match covers this address.
    /// (ModRuns.running: a Swift twin of the shared rule, as it's asked several times on every page load)
    func running(on url: String) -> [InstalledMod] {
        ModRuns.running(mods.map(\.runFacts), paused: paused, groupsOff: groupsOff, url: url).map { mods[$0.i] }
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
            let off = ModRuns.off(m.runFacts, groupsOff: groupsOff)
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

    /// Adds a mod, or a new version of the one with its id (the one before kept in its history). `source`: chat,
    /// import, link or pasted. One from a chat (the user tapped Add it) is on; an import starts off, marked new
    /// (updated, if it replaces one), as on desktop. A new version that needs an OK the one before didn't: the
    /// one before keeps running until the user decides.
    /// The rules: ModChanges.add (core mod-store.js): History 30 days, 30 versions; from the computer (phone sync D8),
    /// judged as an edit, its switch kept, or new: off and marked as an import is.
    /// Every add but the computer's and an edit's: under the mod it's a new version of by stable id (an import or an offer whose id
    /// is a mod's on its site), with an id stamped in when it has none (docs/PHONE-SYNC.md 2a "When TRIF gives one").
    @discardableResult
    func add(_ new: InstalledMod, source: String) -> InstalledMod {
        // (an edit is the record it edits: saveEdit stamped its text already; the computer's copy is never moved or stamped)
        var m = source == "computer" || source == "edit" ? new : placed(new, byName: false, source: source)
        let date = Date()
        if let i = mods.firstIndex(where: { $0.id == m.id }) {
            let old = mods[i]
            var facts = m.holdFacts
            facts.allowed = old.allowed
            let r = ModChanges.add(old: (old.holdFacts, old.on, old.newOff, old.history.map(\.at)), new: (facts, m.on, m.newOff), source: source, at: date, changed: old.code != m.code)
            m.source = r.source; m.on = r.on; m.newOff = r.newOff
            m.take(r.keep, from: old)
            m.history = ModChanges.pick(r.history, from: old.history, new: r.version.map { ModVersion(stamp: $0.stamp, at: date, code: old.code, source: $0.source) })
            // (the version before ran, and this one waits: it keeps running meanwhile)
            switch r.ran {
            case .ran?: m.ran = old.ran
            case .current?: m.ran = .init(code: old.code, script: old.script, world: old.world, at: old.at, style: old.styleScript)
            case nil: break
            }
            mods[i] = m
        } else {
            let r = ModChanges.add(old: nil, new: (m.holdFacts, m.on, m.newOff), source: source, at: date, changed: true)
            m.source = r.source; m.on = r.on; m.newOff = r.newOff
            mods.append(m)
        }
        save()
        return m
    }

    /// Recently deleted's days (core mod-store.js TRASH_DAYS; pruned again at each start).
    static let trashDays = 30.0

    /// A quick ask's Undo: the mod as it was before it was added (`before`), or gone if it was new; not to Recently
    /// deleted (it never was, as far as the person goes).
    func undoAdd(_ id: String, before: InstalledMod?) {
        mods = ModChanges.pick(ModChanges.undoAdd(ids: mods.map(\.id), id: id, hasBefore: before != nil), from: mods, new: before)
        save()
    }

    /// Deletes a mod: to Recently deleted (30 days). `by`: you (the Mods tab: Undo too) or computer (a sync).
    func remove(_ id: String, by: String = "you") {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        let date = Date()
        let r = ModChanges.remove(trash: trash.map(\.at), by: by, at: date)
        let m = mods.remove(at: i)
        if r.undo { lastDeleted = m }
        trash = [DeletedMod(mod: m, at: date, by: by)] + ModChanges.pick(r.keep, from: trash, new: nil)
        save()
    }

    func undoDelete() {
        guard let m = lastDeleted, let r = ModChanges.undoDelete(last: m.id, ids: mods.map(\.id), trash: trash.map(\.mod.id)) else { return }
        if r.append { mods.append(m) }
        if trash.indices.contains(r.drop) { trash.remove(at: r.drop) }
        lastDeleted = nil
        save()
    }

    /// Puts a mod from Recently deleted back (a change like any other: it syncs again). False: one with its id is
    /// here now.
    @discardableResult
    func restoreDeleted(_ entry: String) -> Bool {
        guard let r = ModChanges.restoreDeleted(entry, trash: trash.map { ($0.id, $0.mod.id) }, ids: mods.map(\.id), last: lastDeleted?.id),
              trash.indices.contains(r.index) else { return false }
        mods.append(trash.remove(at: r.index).mod)
        if r.clearLast { lastDeleted = nil }
        save()
        return true
    }

    /// A mod's switch: the whole mod, or (a mod for several sites) its switch on one site.
    /// (the shared rule, ModRuns.setOn: a mod for several sites switched on a site; switching on clears "new, off")
    func setOn(_ id: String, _ on: Bool, site: String?) {
        guard let i = mods.firstIndex(where: { $0.id == id }), let r = ModRuns.setOn(mods[i].runFacts, on, site: site) else { return }
        mods[i].on = r.on
        mods[i].offSites = r.offSites
        if r.clearNewOff { mods[i].newOff = nil }
        // (the person's change, for the phone sync: the later change wins, docs/PHONE-SYNC.md 4b; a synced mod's "from
        // your computer" mark, kept while it arrived on (D8), goes with the first tap of its switch here)
        mods[i].switchAt = (Date().timeIntervalSince1970 * 1000).rounded(.down)
        if mods[i].newOff == "computer" { mods[i].newOff = nil }
        save()
    }

    /// (the shared rule, ModRuns.setGroup)
    func setGroup(_ tier: String, on: Bool, site: String) {
        guard let g = ModRuns.setGroup(groupsOff, tier, on: on, site: site) else { return }
        groupsOff = g
        save()
    }

    /// Allow: what it waits for is allowed for it (a later version that needs nothing more runs without asking).
    func approve(_ id: String) {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        mods[i].allowed = ModHolds.approve(mods[i].holdFacts)
        mods[i].ran = nil
        save()
    }

    /// Don't allow a change on hold: the version before is back (this one kept in its history). A new mod: deleted.
    func reject(_ id: String) {
        guard let i = mods.firstIndex(where: { $0.id == id }) else { return }
        let now = mods[i], date = Date()
        guard let r = ModChanges.reject(ran: now.ran != nil, history: now.history.count, at: date) else { return }
        guard case .back(let c) = r, let ran = now.ran, var back = read(ran.code, file: now.file, site: now.site).mod else { remove(id); return }
        back.take(c.keep, from: now)
        if let x = c.extraNeeds { back.extraNeeds = x }
        back.history = ModChanges.pick(c.history, from: now.history, new: ModVersion(stamp: c.version.stamp, at: date, code: now.code, source: c.version.source))
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
    static func changeNeeds(_ m: InstalledMod, was old: InstalledMod) -> [ModNeed] { ModHolds.changeNeeds(m.holdFacts, was: old.holdFacts) }

    /// What the user had allowed, plus what the version that ran already did (its sites, its tier), so a change is
    /// asked about only for what it adds.
    static func seeded(_ old: InstalledMod) -> [String: [String]] { ModHolds.seeded(old.holdFacts) }

    /// Saves an edit (checked first: a broken one is never saved). The version before goes into History ("before you
    /// edited it"); the edit is judged as any change (held.js): if it needs an OK the version before didn't, the
    /// version before keeps running and the approval card asks. Its id and site stay (desktop's: the file stays where
    /// it is; a new @name is only its name). Returns the mod and the stamp of the version kept, or the check's answer.
    func saveEdit(_ id: String, _ text: String) -> (mod: InstalledMod?, stamp: String?, check: [String: Any]) {
        guard let old = mods.first(where: { $0.id == id }) else { return (nil, nil, ["ok": false, "errors": [["message": "that mod isn't here any more"]]]) }
        let checked = check(text, for: old)
        // (an edit saved keeps the mod's id; one with none gets one: TRIF writes it)
        guard checked["ok"] as? Bool == true, var m = read(stamped(text, keep: keptUids[id], source: "edit"), file: old.file, site: old.site).mod else { return (nil, nil, checked) }
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
              var back = read(stamped(v.code, keep: keptUids[id], source: source), file: mods[i].file, site: mods[i].site).mod else { return false }
        let now = mods[i], date = Date()
        guard let c = ModChanges.restore(history: now.history.count, source: source, at: date) else { return false }
        back.take(c.keep, from: now)
        back.allowed = ModStore.seeded(now)
        back.extraNeeds = ModStore.changeNeeds(back, was: now)
        back.history = ModChanges.pick(c.history, from: now.history, new: ModVersion(stamp: c.version.stamp, at: date, code: now.code, source: c.version.source))
        // (it waits: the version before keeps running, or what that one was keeping while a change waited: the last
        // approved version, as an edit there keeps it (Tim, 11-18))
        switch ModHolds.ranAfter(held: back.held, old: now.holdFacts, restore: true) {
        case .ran?: back.ran = now.ran
        case .current?: back.ran = .init(code: now.code, script: now.script, world: now.world, at: now.at, style: now.styleScript)
        case nil: break
        }
        mods[i] = back
        save()
        return true
    }

    // MARK: renaming (docs/PHONE-SYNC.md 2a "Renaming")

    /// Renames a mod (the Mods tab's details): its @name set (and its @id added if it has none), its file following
    /// the name (`<slug>.js`, `-2`… past the others in its folder), nothing else in its text changed, so it never
    /// waits for an OK and isn't marked new: its switches, approvals, History, the version kept running and its marks
    /// stay. Everything keyed by its id follows (its file here, its sync key's hint, what Browser keeps: onRename).
    /// Answer: the mod as it is now, or why not (ModID.checkName's words, or the reader's).
    func rename(_ id: String, to name: String) -> (mod: InstalledMod?, error: String?) {
        guard let old = mods.first(where: { $0.id == id }) else { return (nil, "gone") }
        let r = ModID.renamed(old.idEntry, to: name, folder: idEntries)
        guard let to = r.id else { return (nil, r.why ?? "no answer") }
        let uid = keptUids[id] ?? ModID.newId()
        guard let text = ModID.withMeta(old.code, name: name.trimmingCharacters(in: .whitespacesAndNewlines), uid: uid) else { return (nil, "no answer") }
        if text == old.code && to == id { return (old, nil) }
        return move(id, to: to, text: text, why: "renamed") ? (mods.first { $0.id == to }, nil) : (nil, "unreadable")
    }

    /// The phone sync's rename (the computer's plan: `renames`, applied first): the mod moves to the computer's file
    /// id, its text as it is (the new @name arrives with the plan's give), everything keyed by it following. False:
    /// not here, another mod has that id here, or another folder.
    func syncRename(_ from: String, _ to: String) -> Bool {
        guard from != to, let old = mods.first(where: { $0.id == from }), !mods.contains(where: { $0.id == to }),
              let cut = to.firstIndex(of: "/"), String(to[..<cut]) == old.site else { return false }
        return move(from, to: to, text: old.code, why: "renamed on the computer")
    }

    /// One mod moved to another file id with this text (read there again), its record's state kept.
    private func move(_ id: String, to: String, text: String, why: String) -> Bool {
        guard let i = mods.firstIndex(where: { $0.id == id }), let cut = to.firstIndex(of: "/") else { return false }
        let old = mods[i]
        let file = "\(to[to.index(after: cut)...]).js"
        guard let again = read(text, file: file, site: old.site).mod, again.id == to else { return false }
        var m = old.carry(to: again)
        // (the version kept running while a change waits: its script names the mod's id, so it's made again there)
        if let ran = old.ran, let back = read(ran.code, file: file, site: old.site).mod {
            m.ran = .init(code: ran.code, script: back.script, world: back.world, at: back.at, style: back.styleScript)
        }
        let oldKey = syncKey(old)
        mods[i] = m
        let newKey = syncKey(m)
        if oldKey != newKey, let h = syncHintsKept[oldKey] {
            var hints = syncHintsKept
            hints[oldKey] = nil
            hints[newKey] = h
            syncHints(hints)
        }
        if to != id {
            renamedTo[id] = to
            onRename?(id, to)
        }
        save()
        Diagnostics.shared.log("mods", "\(why): \(id) → \(to)")
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
        // (the decision is the shared rule's: ModOfferRules.elsewhere, TrifCore.modOffer.elsewhere; the words are these)
        guard let from = mod.cameFrom, let away = ModOfferRules.elsewhere(cameFrom: from, folder: mod.site, sites: mod.sites) else { return nil }
        guard case let .others(others, also) = away else {
            return ("It runs on every site", "It came from \(from), but it runs on every site you visit, not just \(from). Add it only if you meant it to.")
        }
        let list = others.joined(separator: ", ")
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
                // (a chat's edit blocks (Tim, 11-19): each change, compact, before Add: what it takes out and puts in)
                if let changes = mod.edits, !changes.isEmpty {
                    Section {
                        // (long lines wrap, so what changed in a line shows without scrolling sideways)
                        ScrollView(.vertical) {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(changes.enumerated()), id: \.offset) { _, c in EditChangeView(change: c) }
                            }.padding(.vertical, 2).frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxHeight: 320)
                    } header: { Text(ModOfferView.changesWord(changes.count)).textCase(nil) }
                }
                // (the buttons before the code (Tim, 11-16: "sometimes you don't wanna read the code and you have to
                // scroll down"), after all that says what Add it agrees to: name, what it does, sites, powers, warning)
                Section {
                    Button(mod.edits.map { ModOfferView.addChanges($0.count) } ?? "Add it") { browser.addMod(mod); dismiss() }.bold()
                    Button("Cancel", role: .cancel) { browser.offerClosed(declined: true); dismiss() }
                }
                Section("Its code") {
                    ScrollView(.horizontal) { Text(mod.code).font(.caption2.monospaced()).textSelection(.enabled) }.frame(maxHeight: 260)
                }
            }
            .navigationTitle(mod.edits == nil ? "Add this mod?" : "Change this mod?")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}


extension ModOfferView {
    /// (drafts for Tim, docs/IOS-APP-STRINGS.md)
    static func changesWord(_ n: Int) -> String { n == 1 ? "1 change" : "\(n) changes" }
    static func addChanges(_ n: Int) -> String { n == 1 ? "Add 1 change" : "Add \(n) changes" }
}

/// One change of a chat's edit blocks, as Add this mod? shows it: its line, the unchanged line above, the lines taken
/// out (−, coral) and put in (+, green), the unchanged line below.
struct EditChangeView: View {
    let change: ModEdits.Change
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Line \(change.line)").font(.caption2.bold()).foregroundStyle(.secondary)
            if let a = change.above { row(" ", a, .secondary, nil) }
            ForEach(Array(change.removed.enumerated()), id: \.offset) { _, l in row("−", l, Color.trifCoral, Color.trifCoral.opacity(0.12)) }
            ForEach(Array(change.added.enumerated()), id: \.offset) { _, l in row("+", l, Color.green, Color.green.opacity(0.12)) }
            if let b = change.below { row(" ", b, .secondary, nil) }
        }
        .accessibilityElement(children: .combine)
    }
    private func row(_ mark: String, _ line: String, _ colour: Color, _ back: Color?) -> some View {
        Text("\(mark) \(line.isEmpty ? " " : line)").font(.caption2.monospaced()).foregroundStyle(colour)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(back ?? .clear)
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

    /// Each mod's switch (docs/PHONE-SYNC.md 4b): on, the sites it's off on, when the person last changed it.
    func syncSwitches() -> [String: PhoneSync.Switch] {
        Dictionary(mods.filter { $0.id.contains("/") }.map { (syncKey($0), PhoneSync.Switch(on: $0.on, off: $0.offSites, at: $0.switchAt ?? 0, fresh: $0.newOff != nil)) }, uniquingKeysWith: { a, _ in a })
    }

    /// Each mod's stable id, where it keeps one (the first by file name in its folder): file id → id.
    func syncUids() -> [String: String] { keptUids.filter { $0.key.contains("/") } }

    /// The computer's switch, set as it is (its time kept, so both sides agree); the "from your computer" mark stays
    /// (D8: a new mod arrives with the computer's switch, still marked).
    func syncSetSwitch(_ key: String, _ s: PhoneSync.Switch) -> Bool {
        guard let i = mods.firstIndex(where: { syncKey($0) == key }) else { return false }
        let was = mods[i]
        mods[i].on = s.on
        mods[i].offSites = s.off
        mods[i].switchAt = s.at > 0 ? s.at : nil
        guard was.on != s.on || was.offSites.sorted() != s.off || was.switchAt != mods[i].switchAt else { return false }
        save()
        Diagnostics.shared.log("sync", "switch from the computer: \(was.id) \(s.on ? "on" : "off")\(s.off.isEmpty ? "" : " (off on \(s.off.joined(separator: ", ")))")")
        return was.on != s.on || was.offSites.sorted() != s.off
    }

    /// What this phone allows as it is: each mod not waiting for an OK (and no change waiting), its revision, tier
    /// and powers (D13: a hint the computer words its card with; never an approval there).
    func syncAllowed() -> [String: PhoneSync.Hint] {
        Dictionary(mods.filter { $0.id.contains("/") && !$0.held && $0.ran == nil }.map {
            (syncKey($0), PhoneSync.Hint(rev: PhoneSync.rev($0.code), tier: $0.tier, powers: $0.tier == "boxed" ? $0.powers : []))
        }, uniquingKeysWith: { a, _ in a })
    }

    func syncHints(_ hints: [String: PhoneSync.Hint]) {
        guard hints != syncHintsKept else { return }
        syncHintsKept = hints
        if let d = try? JSONEncoder().encode(hints) { UserDefaults.standard.set(d, forKey: ModStore.hintsKey) }
    }

    /// What the scheduler compares with the last sync (PhoneSync.Scheduler `files`): each mod's file, its switch and
    /// whether it's allowed here, so a switch or an Allow syncs too (3 s later), not only an edit.
    func syncSignature() -> [String: String] {
        let sw = syncSwitches(), ok = syncAllowed()
        return Dictionary(mods.filter { $0.id.contains("/") }.map { m in
            let k = syncKey(m)
            let s = sw[k].map { "\($0.on)|\($0.off.joined(separator: ","))" } ?? ""
            return (m.id, "\(m.code)\u{0}\(s)\u{0}\(ok[k] != nil)")
        }, uniquingKeysWith: { a, _ in a })
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
