// A site's own unread count, read from its page title (Tim, 11-18: "unread counts instead of notifications"). No UI and
// no WebKit: built for the Mac too (mobile/test/unreadcount.test.js). The same rule as mobile/shared/core/unread-count.js,
// which Android uses; the test holds the two to the same answers (mobile/shared/core/unread-count-cases.json and random titles),
// so a change here is a change there. The patterns are spelt the same in both: ICU's \s and \d aren't JavaScript's.
//
// Counted: a count at the very start ("(3) Home / X", "(20+) Home / X", "(1,234) Feed | LinkedIn"), "Inbox (N)"
// anywhere ("Inbox (5) - … - Gmail"), "(N unread)" anywhere. Nothing else: brackets elsewhere are the real title's
// ("Dune: Part Two (2024) - IMDb"), as is a year at the start ("(2024) Dune trailer - YouTube").

import Foundation

enum UnreadTitle {
    struct Count: Equatable {
        /// The count (0 possible: "Inbox (0)"), and whether the site wrote it as "N+".
        var count: Int
        var plus: Bool
        /// The title without the count, for a card that shows the count as a badge beside it.
        var title: String
        /// The badge's words: "3", "20+", past 999 "999+".
        var text: String { UnreadTitle.text(count, plus) }
    }

    static func text(_ count: Int, _ plus: Bool) -> String { count > 999 ? "999+" : "\(count)\(plus ? "+" : "")" }

    private static let sp = #"[ \t\n\r\f\u000b\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]"#
    private static let num = #"([0-9]{1,3}(?:[,.\u00a0\u202f][0-9]{3})+|[0-9]{1,7})"#
    private static let sep = #"[-\u2013\u2014|\u2022\u00b7:]"#
    private static func rx(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression {
        try! NSRegularExpression(pattern: p, options: o)
    }
    private static let lead = rx("^\(sp)*\\(\(num)(\\+?)\\)\(sp)*")
    private static let inbox = rx("(^|[^A-Za-z0-9])(inbox)\(sp)*\\(\(num)(\\+?)\\)", .caseInsensitive)
    private static let unread = rx("\(sp)*\\(\(num)(\\+?)\(sp)+unread\\)", .caseInsensitive)
    private static let seps = rx("\(sp)+(\(sep))(?:\(sp)+\(sep))+(?=\(sp))")
    private static let ends = rx("^(?:\(sp)|\(sep))+|(?:\(sp)|\(sep))+$")
    private static let runs = rx("\(sp){2,}")
    private static let year = rx("^(19|20)[0-9]{2}$")

    private static func sub(_ r: NSRegularExpression, _ s: String, _ with: String) -> String {
        r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: with)
    }
    private static func tidy(_ s: String) -> String { sub(ends, sub(runs, sub(seps, s, " $1"), " "), "") }
    private static func number(_ s: String) -> Int { Int(s.filter { ("0"..."9").contains($0) }) ?? 0 }

    /// nil: no count in this title.
    static func read(_ title: String) -> Count? {
        let ns = title as NSString
        let all = NSRange(location: 0, length: ns.length)
        func part(_ m: NSTextCheckingResult, _ i: Int) -> String { m.range(at: i).location == NSNotFound ? "" : ns.substring(with: m.range(at: i)) }
        if let m = lead.firstMatch(in: title, range: all) {
            let n = part(m, 1), plus = part(m, 2) == "+"
            let isYear = !plus && year.firstMatch(in: n, range: NSRange(location: 0, length: (n as NSString).length)) != nil
            if !isYear { return Count(count: number(n), plus: plus, title: sub(ends, ns.substring(from: m.range.upperBound), "")) }
        }
        if let m = inbox.firstMatch(in: title, range: all) {
            let rest = ns.substring(to: m.range.location) + part(m, 1) + part(m, 2) + ns.substring(from: m.range.upperBound)
            return Count(count: number(part(m, 3)), plus: part(m, 4) == "+", title: tidy(rest))
        }
        if let m = unread.firstMatch(in: title, range: all) {
            let rest = ns.substring(to: m.range.location) + " " + ns.substring(from: m.range.upperBound)
            return Count(count: number(part(m, 1)), plus: part(m, 2) == "+", title: tidy(rest))
        }
        return nil
    }
}
