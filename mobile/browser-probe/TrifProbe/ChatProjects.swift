// TRIF's chats in a project of their own (Tim, 11-20: "TRIF's chats in Claude and ChatGPT go into a 'TRIF' project by
// default, set up in one tap, so they don't sprawl across the person's history"). The rules only, no UI: built for the
// Mac too (mobile/test/chatprojects.test.js with chatprojects-check/main.swift). ClaudePane does the rest: the card's
// answers, the setup (TRIF fills the service's new-project form and then its instructions; the person taps Create and
// Save: TRIF never does), the project noticed by its address, a project that's gone dropped. docs/MOBILE-BEHAVIOUR.md
// has the rule for both phones.

import Foundation

/// The first-use card ("Keep TRIF chats in their own project?"), per service: asked once. Any answer is final: Set it
/// up, Not now, or a send past the card without either (the card was offered once, on first use). The ⋯ menu's item
/// stays for anyone who changes their mind.
enum ProjectOfferState: String {
    /// Never shown yet.
    case unasked
    /// Shown, not answered yet (it shows again in an empty chat until answered or sent past).
    case shown
    /// Not now: never asked again.
    case declined
    /// Sent past without an answer: never asked again.
    case ignored
    /// Set it up (whatever came of it).
    case accepted
}

enum ChatProjects {
    // MARK: addresses

    /// A conversation's path: claude.ai's /chat/<id>, chatgpt.com's /c/<id> (and /uc/<id>), and a ChatGPT project's
    /// conversation, /g/g-p-<id>-<name>/c/<id> (claude.ai's project chats are plain /chat/<id>).
    static func isConversation(_ path: String) -> Bool {
        path.hasPrefix("/chat/") || path.hasPrefix("/c/") || path.hasPrefix("/uc/")
            || path.range(of: "^/g/g-p-[^/]+/c/[^/]+", options: .regularExpression) != nil
    }

    /// A project's own page: claude.ai/project/<id>; chatgpt.com/g/g-p-<id>-<name>/project.
    static func isProjectPage(_ path: String, claude: Bool) -> Bool {
        path.range(of: claude ? "^/project/[^/]+/?$" : "^/g/g-p-[^/]+/project/?$", options: .regularExpression) != nil
    }

    /// The project's own id in a project page's (or a ChatGPT project conversation's) path: claude.ai's
    /// /project/<id>; chatgpt.com's g-p-<id> without the name after it (the name changes when the project is renamed:
    /// g-p-<32 hex>-<name>). Nil for any other path.
    static func projectID(_ path: String, claude: Bool) -> String? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if claude { return parts.count >= 2 && parts[0] == "project" ? parts[1] : nil }
        guard parts.count >= 2, parts[0] == "g", parts[1].hasPrefix("g-p-") else { return nil }
        let rest = parts[1].dropFirst(4)
        // (ChatGPT's ids are 32 hex digits, then "-<name>"; anything else: the whole part)
        if let r = rest.range(of: "^[0-9a-f]{32}", options: .regularExpression) { return "g-p-" + rest[r] }
        return parts[1]
    }

    /// A project page's address as kept: no query, no fragment, no slash at the end.
    static func kept(_ url: URL) -> URL? {
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        c?.query = nil
        c?.fragment = nil
        if let p = c?.path, p.count > 1, p.hasSuffix("/") { c?.path = String(p.dropLast()) }
        return c?.url
    }

    // MARK: the first-use card

    /// Whether the card is offered: no project kept for the service, and the card never answered.
    static func offers(_ state: ProjectOfferState, hasProject: Bool) -> Bool {
        !hasProject && (state == .unasked || state == .shown)
    }
    /// The card drawn in a chat.
    static func shown(_ state: ProjectOfferState) -> ProjectOfferState { state == .unasked ? .shown : state }
    /// The person sent a message: a card they were shown and didn't answer counts as answered (never again).
    static func afterSend(_ state: ProjectOfferState) -> ProjectOfferState { state == .shown ? .ignored : state }

    // MARK: the setup

    /// One setup under way, in one chat: TRIF filled the new-project form (`form`), then, once the project's page
    /// came up, its instructions (`guide`).
    struct Setup: Equatable {
        enum Stage: String { case form, guide }
        var claude: Bool
        /// When the form was asked for.
        var started: Date
        /// The address the chat was on when the setup started (never taken for the new project).
        var from: String?
        var stage: Stage = .form
        /// The person's tap on Create (or Return in the form) was seen.
        var createSeen = false
        /// The form was closed without Create: the setup is over.
        var closed = false
        /// The project made, once noticed.
        var project: String?
    }
    /// How long after the form was opened a project page still counts as the one the person made from it.
    static let setupWindow: TimeInterval = 600

    /// Whether a project page the chat just went to is the project the person made from TRIF's form: during the form
    /// stage, within the window, not closed without Create, and not the page the setup started from. Whatever its
    /// name: if the person renamed it in the form, it's still the one made from TRIF's flow.
    static func adopt(_ s: Setup, url: URL, now: Date) -> Bool {
        guard s.stage == .form, !s.closed, now.timeIntervalSince(s.started) <= setupWindow,
              isProjectPage(url.path, claude: s.claude), let k = kept(url)?.absoluteString else { return false }
        if let from = s.from.flatMap(URL.init(string:)).flatMap(kept)?.absoluteString, from == k { return false }
        return true
    }

    // MARK: a project that's gone

    /// Whether the kept project is gone, judged when its page was asked for and has loaded: the server said not found
    /// (404, 410), the page says so (no message box, words like "not found"), or the service sent the chat to another
    /// page of its own that isn't this project (its projects list, a new chat). Not gone: a sign-in page, another site
    /// (signed out), nothing loaded yet, or the same project under a new name (ChatGPT's address carries the name).
    static func gone(kept: URL, landed: URL?, status: Int?, saysMissing: Bool, claude: Bool) -> Bool {
        if let status, status == 404 || status == 410 { return true }
        if saysMissing { return true }
        guard let landed, landed.host == kept.host else { return false }
        if landed.path.range(of: "(^|/)(login|log-in|signin|sign-in|signup|auth)(/|$)", options: [.regularExpression, .caseInsensitive]) != nil { return false }
        guard let want = projectID(kept.path, claude: claude) else { return false }
        return projectID(landed.path, claude: claude) != want
    }
}
