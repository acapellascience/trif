// Whole mods, from a chat (proof of concept, branch ios-poc): a mod file Claude or ChatGPT wrote, copied from
// its reply, read here (shared/gen/mods.js in JavaScriptCore: TRIF's style rules and the mod's header), shown
// for an OK, then kept and run on every page its @match covers, each tier in its own world as on desktop:
// a style mod's rules in TRIF's world, a boxed mod in the box (SES), a free mod in the page.
// Not yet: the code reading and holds, powers granted one by one, settings, a style section.

import SwiftUI
import JavaScriptCore
import WebKit

struct InstalledMod: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var description: String
    var tier: String            // style, boxed or free
    var sites: [String]
    var powers: [String]
    var code: String            // the file as the chat wrote it
    var script: String          // what runs: the mod behind a check of the page's address
    var world: String           // trif, box or page
    var at: String              // start or end
    var on: Bool = true

    var tierName: String { tier == "style" ? "Style mod" : tier == "boxed" ? "Boxed mod" : "Free mod" }
    var colour: Color { tier == "style" ? .green : tier == "boxed" ? .yellow : .orange }
}

@MainActor
final class ModStore: ObservableObject {
    @Published private(set) var mods: [InstalledMod] = []
    private let key = "installedMods"
    private lazy var js: JSContext? = {
        let c = JSContext()
        c?.evaluateScript(Browser.resource("mods", "js"))
        return c
    }()

    init() {
        if let data = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([InstalledMod].self, from: data) { mods = list }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(mods) { UserDefaults.standard.set(data, forKey: key) }
    }

    /// A mod file, or a chat's reply with one in it: the mod, ready to add, or why it can't be.
    func read(_ text: String) -> (mod: InstalledMod?, error: String?) {
        guard let c = js else { return (nil, "the mod reader didn't start") }
        c.setObject(text, forKeyedSubscript: "__input" as NSString)
        let out = c.evaluateScript("JSON.stringify((function () { const f = __trifMods.findMod(__input); return f ? __trifMods.parseMod(f) : { error: 'there is no mod file (a ==WebMod== header) in it' }; })())")?.toString() ?? ""
        guard let d = try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any] else { return (nil, "the mod reader gave nothing back: \(c.exception?.toString() ?? out)") }
        if let error = d["error"] as? String { return (nil, error) }
        let s = { (k: String) in d[k] as? String ?? "" }
        let a = { (k: String) in d[k] as? [String] ?? [] }
        return (InstalledMod(id: s("id"), name: s("name"), description: s("description"), tier: s("tier"), sites: a("sites"), powers: a("powers"),
                             code: s("code"), script: s("script"), world: s("world"), at: s("at")), nil)
    }

    /// Adds a mod, or replaces the one with its name.
    func add(_ m: InstalledMod) {
        if let i = mods.firstIndex(where: { $0.id == m.id }) { mods[i] = m } else { mods.append(m) }
        save()
    }

    func remove(_ m: InstalledMod) { mods.removeAll { $0.id == m.id }; save() }

    func toggle(_ m: InstalledMod) {
        guard let i = mods.firstIndex(where: { $0.id == m.id }) else { return }
        mods[i].on.toggle()
        save()
    }

    /// The scripts the mods that are on add to every page (each checks the page's address itself): SES and
    /// TRIF's sandbox runtime first in the box world when any boxed mod is on.
    func userScripts() -> [WKUserScript] {
        let on = mods.filter(\.on)
        var out: [WKUserScript] = []
        if on.contains(where: { $0.world == "box" }) {
            out.append(WKUserScript(source: Browser.resource("ses.umd.min", "js"), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.boxWorld))
            out.append(WKUserScript(source: Browser.resource("sandbox-runtime", "js"), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Browser.boxWorld))
        }
        for m in on {
            let world: WKContentWorld = m.world == "box" ? Browser.boxWorld : m.world == "page" ? .page : Browser.trifWorld
            out.append(WKUserScript(source: m.script, injectionTime: m.at == "start" ? .atDocumentStart : .atDocumentEnd, forMainFrameOnly: true, in: world))
        }
        return out
    }
}

/// A mod from the clipboard: what it is and does, before it runs.
struct ModOfferView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    let mod: InstalledMod

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(mod.name).font(.headline)
                        Text(mod.tierName).font(.caption.bold()).foregroundStyle(mod.colour)
                        if !mod.description.isEmpty { Text(mod.description).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }
                Section("Runs on") { Text(mod.sites.joined(separator: ", ")).font(.footnote.monospaced()) }
                if !mod.powers.isEmpty { Section("Asks for these powers") { Text(mod.powers.joined(separator: ", ")).font(.footnote.monospaced()) } }
                if mod.tier == "free" {
                    Section { Text("A free mod can do anything the page can do, including posting or sending as you. Only enable free mods that you trust.").font(.footnote).foregroundStyle(.orange) }
                }
                Section("Its code") {
                    ScrollView(.horizontal) { Text(mod.code).font(.caption2.monospaced()).textSelection(.enabled) }.frame(maxHeight: 260)
                }
                Section {
                    Button("Add it") { browser.addMod(mod); dismiss() }.bold()
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
            .navigationTitle("Add this mod?")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// The mods the app keeps: each on or off, or gone.
struct ModsListView: View {
    @EnvironmentObject var browser: Browser
    @ObservedObject var store: ModStore

    var body: some View {
        NavigationStack {
            List {
                if store.mods.isEmpty { Text("No mods yet. Ask Claude or ChatGPT for one, copy its reply, then Add a mod from the clipboard.").foregroundStyle(.secondary) }
                ForEach(store.mods) { m in
                    HStack {
                        Rectangle().fill(m.colour).frame(width: 3)
                        VStack(alignment: .leading) {
                            Text(m.name)
                            Text("\(m.tierName) · \(m.sites.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("", isOn: Binding(get: { m.on }, set: { _ in browser.toggleMod(m) })).labelsHidden().tint(m.colour)
                    }
                }
                .onDelete { idx in for i in idx { browser.removeMod(store.mods[i]) } }
            }
            .navigationTitle("Your mods")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
