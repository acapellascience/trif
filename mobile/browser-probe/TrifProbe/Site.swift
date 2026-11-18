import Foundation

// Sites (docs/MOBILE-BEHAVIOUR.md, Sites). The phones' shared rule is mobile/shared/core/site.js (TrifCore.site); this is
// its Swift twin, kept because it runs on every navigation and tab change, held to the same answers
// (mobile/shared/core/site-cases.json) by mobile/test/quickask.test.js. Change both, or neither.

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
