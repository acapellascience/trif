import Foundation

/// Quick ask's rules (docs/MOBILE-BEHAVIOUR.md, Quick ask): which of a reply's mods are added at once (look-only), what
/// the pill says then, and Undo's steps. The phones' shared rule: mobile/shared/core/quick-ask.js (TrifCore.quickAsk),
/// through Core.swift (a quick ask's reply: once, not a hot path). No UI: the Mac check (mobile/test/quickask.test.js)
/// builds it.
enum QuickAskRules {
    /// What the rule needs of a mod (InstalledMod.quickFacts).
    struct Facts {
        var id: String
        var tier: String
        var powers: [String]
        var held: Bool
        var warnings: [String]
        var everywhere: Bool
        var sites: [String]
        var plain: [String: Any] { ["id": id, "tier": tier, "powers": powers, "held": held, "warnings": warnings, "everywhere": everywhere, "sites": sites] }
    }
    /// A reply's mods sorted: the chat's site, the ids added at once, the ids to their cards, and the pill's state
    /// (done, card or replied).
    struct Sorted: Equatable { var site: String; var look: [String]; var rest: [String]; var state: String }

    /// A look-only mod: a style mod with no powers, nothing waiting for an OK, no warnings, not everywhere, every site
    /// the chat's (`site`: already a site). No answer: not look-only (its card instead).
    static func lookOnly(_ m: Facts, site: String) -> Bool {
        (Core.shared.call("quickAsk.lookOnly", [m.plain, site]) as? Bool) ?? false
    }

    /// A reply's offered mods sorted, for the tab's chat site (phone~ twins and hosts are fine). No answer: none added
    /// at once, every one to its card.
    static func sort(_ offered: [Facts], chatSite: String) -> Sorted {
        if let r = Core.shared.call("quickAsk.sort", [offered.map(\.plain), chatSite]) as? [String: Any],
           let s = r["site"] as? String, let look = r["look"] as? [String], let rest = r["rest"] as? [String], let st = r["state"] as? String {
            return Sorted(site: s, look: look, rest: rest, state: st)
        }
        return Sorted(site: "", look: [], rest: offered.map(\.id), state: offered.isEmpty ? "replied" : "card")
    }

    /// Undo's steps (only from done), newest first: back to the version before (`back`) or removed; each declined. No
    /// answer: what Done added, newest first, still undone (Undo was promised).
    static func undo(state: String, applied: [(id: String, hadBefore: Bool)]) -> [(id: String, back: Bool)] {
        let a = applied.map { ["id": $0.id, "hadBefore": $0.hadBefore] as [String: Any] }
        if let steps = Core.shared.call("quickAsk.undo", [state, a]) as? [[String: Any]] {
            return steps.compactMap { s in (s["id"] as? String).map { ($0, s["to"] as? String == "before") } }
        }
        return state == "done" ? applied.reversed().map { ($0.id, $0.hadBefore) } : []
    }
}
