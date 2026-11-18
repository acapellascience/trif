import Foundation

/// A mod a chat hands over, before Add this mod? (docs/MOBILE-BEHAVIOUR.md, Mods and holds; Chat offers): which site
/// it's read for and where it came from, and whether the coral "runs on another site" box shows. The phones' shared
/// rule: mobile/shared/core/mod-offer.js (TrifCore.modOffer), through Core.swift (once an offer, not a hot path). The
/// words stay Swift (ModOfferView). No UI: the Mac check (mobile/test/modoffer.test.js) builds it.
enum ModOfferRules {
    /// Where a chat's mod is read (`here`: a host or site, for the mod reader's default @match) and the site it came
    /// from: the chat's site (phone~<site> as <site>), the shown page's host only when the chat has none. No answer: the
    /// shown page's (the reader's usual default).
    static func from(chatSite: String, shown host: String) -> (here: String, came: String) {
        if let r = Core.shared.call("modOffer.from", [chatSite, host]) as? [String: Any], let h = r["here"] as? String, let c = r["came"] as? String { return (h, c) }
        return (host, Site.of(host))
    }

    /// The coral box: runs on every site, or on other sites (sorted, once each; `also`: on the one it came from too).
    enum Away: Equatable { case every; case others([String], also: Bool) }

    /// The box's decision for a mod offered from `cameFrom` (nil or "": a file or a code, no box); `folder` its site
    /// (all-sites: every site), `sites` those its @match names. No answer: the box for every site (a warning too many
    /// rather than one missed).
    static func elsewhere(cameFrom: String?, folder: String, sites: [String]) -> Away? {
        guard let from = cameFrom, !from.isEmpty else { return nil }
        switch Core.shared.call("modOffer.elsewhere", [from, folder, sites]) {
        case is NSNull: return nil
        case let r as [String: Any]:
            if r["every"] as? Bool == true { return .every }
            if let o = r["others"] as? [String], let a = r["also"] as? Bool { return .others(o, also: a) }
            return .every
        default: return .every
        }
    }
}
