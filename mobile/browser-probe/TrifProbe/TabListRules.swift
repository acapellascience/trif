import Foundation

/// The tab list's rules (docs/MOBILE-BEHAVIOUR.md, Tabs; Chats and tabs): which card it opens at (Tim, 11-18: "it
/// should snap to the tab that I just left") and each card's robot badge. The phones' shared rule:
/// mobile/shared/core/tab-list.js (TrifCore.tabList), through Core.swift. The list, its scrolling and the badges' looks
/// stay TabsView's. No UI: the Mac check (mobile/test/tablist.test.js) builds it.
enum TabListRules {
    struct TabFacts { let id: UUID; let host: String }
    /// A chat link: its site, the tab it was sent from, its state (ChatLink.State's raw value).
    struct LinkFacts { let site: String; let tab: UUID?; let state: String }

    /// `open`: the chat shown or the quick ask's strip; `more`: More's chat; `link`: the shown chat's link, else `chat`:
    /// its site (a chat not sent from yet). Once a tap on the tabs button. No answer: nil, the shown tab.
    static func focus(open: Bool, more: Bool, link: LinkFacts?, chat: String?, tabs: [TabFacts], current: UUID) -> UUID? {
        let facts: [String: Any] = ["open": open, "more": more, "link": link.map(plain) ?? NSNull(), "chat": chat ?? NSNull(),
                                    "tabs": tabs.map(plain), "current": current.uuidString]
        return (Core.shared.call("tabList.focus", [facts]) as? String).flatMap(UUID.init(uuidString:))
    }
    /// The card drawn as the current one: `focus` while that tab is open, else the shown tab. A twin of tabList.marked
    /// (same cases): every card, every time the list is drawn.
    static func marked(focus: UUID?, tabs: [UUID], current: UUID) -> UUID {
        focus.flatMap { id in tabs.contains(id) ? id : nil } ?? current
    }
    /// Each tab's badge with any (ChatActivity's raw values: working, replied, idle); once a drawing of the list. No
    /// answer: none.
    static func badges(links: [LinkFacts], tabs: [TabFacts]) -> [UUID: String] {
        if links.isEmpty { return [:] }
        let facts: [String: Any] = ["links": links.map(plain), "tabs": tabs.map(plain)]
        guard let r = Core.shared.call("tabList.badges", [facts]) as? [String: Any] else { return [:] }
        var out: [UUID: String] = [:]
        for (k, v) in r { if let id = UUID(uuidString: k), let b = v as? String { out[id] = b } }
        return out
    }

    private static func plain(_ t: TabFacts) -> [String: Any] { ["id": t.id.uuidString, "host": t.host] }
    private static func plain(_ l: LinkFacts) -> [String: Any] { ["site": l.site, "tab": l.tab?.uuidString ?? NSNull(), "state": l.state] }
}
