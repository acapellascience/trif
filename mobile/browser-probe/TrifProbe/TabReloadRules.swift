import Foundation

/// Which tabs load again when the mods change (docs/MOBILE-BEHAVIOUR.md, Tabs): the shown page only if what runs on
/// it changed, never while it plays unless Pause all asks for it; tabs behind when they're next shown. The phones'
/// shared rule: mobile/shared/core/tab-reload.js (TrifCore.tabReload), through Core.swift (after a change to the mods
/// or as a tab is shown, not a hot path). `loaded` and `stale` are Swift twins (every page commit), held to the same
/// cases. The signature (ModStore.signature: Hasher, per launch), the playing check and the reload stay Browser's.
/// No UI: the Mac check (mobile/test/tabreload.test.js) builds it.
enum TabReloadRules {
    /// What a page keeps as it commits while a change isn't in the scripts yet: it counts as stale.
    static let pending = "pending"

    /// A tab shown: its first load (true) or a look at whether its mods changed (false).
    static func starts(started: Bool, waitingForFront: Bool) -> Bool {
        if let r = Core.shared.call("tabReload.shown", [["started": started, "waitingForFront": waitingForFront]]) as? String { return r == "start" }
        return !started && !waitingForFront
    }

    /// The signature a page keeps as it commits (twin of tabReload.loaded; `signature` is made only when needed).
    static func loaded(pending: Bool, signature: @autoclosure () -> String) -> String {
        pending ? Self.pending : signature()
    }

    /// The mods running on a page changed since it loaded; nil: it hasn't loaded (twin of tabReload.stale).
    static func stale(_ kept: String?, now: String) -> Bool? {
        kept.map { now != $0 }
    }

    enum Look: String {
        /// the scripts aren't in yet: look again once they are, if it's still the tab shown
        case later
        case keep
        /// find out whether it plays, then recheck
        case ask
        /// recheck (on the next turn) without asking (Pause all)
        case next
    }
    /// The shown tab looked at after a change, or as it's shown again. `now`: the signature for the address it loaded.
    /// No answer: keep (a reload the person didn't ask for is the surprise to avoid).
    static func refresh(pending: Bool, started: Bool, hasPage: Bool, reloading: Bool, loaded: String?, now: String, evenPlaying: Bool) -> Look {
        let f: [String: Any] = ["pending": pending, "started": started, "hasPage": hasPage, "reloading": reloading,
                                "loaded": loaded ?? NSNull(), "now": now, "evenPlaying": evenPlaying]
        return (Core.shared.call("tabReload.refresh", [f]) as? String).flatMap(Look.init) ?? .keep
    }

    enum Again: String {
        /// it plays: it keeps going as it is, and loads again the next time it's shown not playing
        case playing
        case keep
        case reload
    }
    /// After refresh's ask (or next): whether it loads again now. `playing`: false when not asked. No answer: keep.
    static func recheck(playing: Bool, shown: Bool, reloading: Bool, pending: Bool, loaded: String?, now: String) -> Again {
        let f: [String: Any] = ["playing": playing, "shown": shown, "reloading": reloading, "pending": pending,
                                "loaded": loaded ?? NSNull(), "now": now]
        return (Core.shared.call("tabReload.recheck", [f]) as? String).flatMap(Again.init) ?? .keep
    }
}

/// Request Desktop Website's per-site memory (docs/MOBILE-BEHAVIOUR.md, Desktop websites): by host without www., in
/// every tab, kept across launches. The phones' shared rule: mobile/shared/core/desktop.js (TrifCore.desktop). `key`,
/// `wants` and `can` are Swift twins (every page load; ⋯'s menu), held to the same cases; `set` (⋯'s Request Desktop
/// / Mobile Website) calls through. WebKit's desktop mode and UserDefaults `desktopHosts` stay Browser's.
enum DesktopRules {
    /// Lower case, a leading www. removed.
    nonisolated static func key(_ host: String) -> String {
        var h = host.lowercased()
        if h.hasPrefix("www.") { h.removeFirst(4) }
        return h
    }
    static func wants(_ kept: Set<String>, host: String?) -> Bool {
        guard let h = host, !h.isEmpty else { return false }
        return kept.contains(key(h))
    }
    /// A website (http or https) with a host: only those can be asked for as a computer's or a phone's.
    static func can(scheme: String?, host: String) -> Bool {
        ["http", "https"].contains(scheme?.lowercased() ?? "") && !host.isEmpty
    }
    /// The kept list after Request Desktop (on) or Mobile (off) Website on `host`, sorted. No answer: the same here.
    static func set(_ kept: Set<String>, host: String, on: Bool) -> [String] {
        if let r = Core.shared.call("desktop.set", [kept.sorted(), host, on]) as? [String] { return r }
        var s = kept
        if on { s.insert(key(host)) } else { s.remove(key(host)) }
        return s.sorted()
    }
}
