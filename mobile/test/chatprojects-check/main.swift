// TRIF's chats in a project (ChatProjects.swift, Tim 11-20) on the Mac: conversation and project addresses on both
// services (ChatGPT's project conversations included), the first-use card asked once (Not now, Set it up or a send past
// it: never again), the project made from TRIF's form noticed by its address (not the page the setup started on, not
// after the form was closed or the window passed), and a kept project found gone. Prints "chat projects: ok" or the
// failures.
import Foundation

var failures: [String] = []
func expect(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }
func u(_ s: String) -> URL { URL(string: s)! }

// (conversations)
for p in ["/chat/1b2c", "/c/6820aa", "/uc/x", "/g/g-p-0123456789abcdef0123456789abcdef-trif/c/6820aa", "/c/local-chatgpt:abc"] { expect(ChatProjects.isConversation(p), "\(p) is a conversation") }
for p in ["/", "/new", "/project/abc", "/projects", "/projects/create", "/g/g-p-0123/project", "/g/g-abc/c", "/gpts", "/chatty"] { expect(!ChatProjects.isConversation(p), "\(p) isn't a conversation") }

// (project pages)
expect(ChatProjects.isProjectPage("/project/019a-7f", claude: true), "claude.ai's project page")
expect(ChatProjects.isProjectPage("/project/019a-7f/", claude: true), "with a slash at the end")
expect(!ChatProjects.isProjectPage("/projects", claude: true), "claude.ai's projects list isn't one")
expect(!ChatProjects.isProjectPage("/projects/create", claude: true), "claude.ai's new-project form isn't one")
expect(!ChatProjects.isProjectPage("/project/019a/chat", claude: true), "deeper isn't one")
expect(ChatProjects.isProjectPage("/g/g-p-0123456789abcdef0123456789abcdef-trif/project", claude: false), "chatgpt.com's project page")
expect(!ChatProjects.isProjectPage("/g/g-p-0123456789abcdef0123456789abcdef-trif/c/1", claude: false), "a project's conversation isn't the page")
expect(!ChatProjects.isProjectPage("/g/g-abc/project", claude: false), "a GPT isn't a project")
expect(!ChatProjects.isProjectPage("/project/019a", claude: false), "claude's shape on chatgpt.com isn't one")

// (project ids: ChatGPT's name after the id doesn't count)
let hex = "0123456789abcdef0123456789abcdef"
expect(ChatProjects.projectID("/g/g-p-\(hex)-trif/project", claude: false) == "g-p-\(hex)", "ChatGPT's id without the name")
expect(ChatProjects.projectID("/g/g-p-\(hex)-renamed/c/1", claude: false) == "g-p-\(hex)", "the same id in a conversation")
expect(ChatProjects.projectID("/project/019a", claude: true) == "019a", "claude.ai's id")
expect(ChatProjects.projectID("/new", claude: true) == nil, "no id")
expect(ChatProjects.kept(u("https://claude.ai/project/019a/?x=1#y"))?.absoluteString == "https://claude.ai/project/019a", "kept: no query, fragment or end slash")

// (the card: offered until answered, never with a project kept)
expect(ChatProjects.offers(.unasked, hasProject: false), "offered at first")
expect(ChatProjects.offers(.shown, hasProject: false), "still offered once shown, until answered")
for s in [ProjectOfferState.declined, .ignored, .accepted] { expect(!ChatProjects.offers(s, hasProject: false), "\(s): never again") }
expect(!ChatProjects.offers(.unasked, hasProject: true), "not with a project kept")
expect(ChatProjects.shown(.unasked) == .shown && ChatProjects.shown(.declined) == .declined, "drawn: shown, an answer stays")
expect(ChatProjects.afterSend(.shown) == .ignored, "sent past the card: never again")
expect(ChatProjects.afterSend(.unasked) == .unasked, "a send with no card shown changes nothing")
expect(ChatProjects.afterSend(.declined) == .declined && ChatProjects.afterSend(.accepted) == .accepted, "answers stay")

// (the project made from the form)
let t0 = Date()
var s = ChatProjects.Setup(claude: true, started: t0, from: "https://claude.ai/project/old1")
expect(ChatProjects.adopt(s, url: u("https://claude.ai/project/new2"), now: t0.addingTimeInterval(20)), "the new project's page is taken")
expect(ChatProjects.adopt(s, url: u("https://claude.ai/project/new2?tab=x"), now: t0.addingTimeInterval(20)), "with a query too")
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/project/old1/"), now: t0.addingTimeInterval(20)), "never the page it started on")
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/projects/create"), now: t0.addingTimeInterval(20)), "not the form")
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/chat/abc"), now: t0.addingTimeInterval(20)), "not a conversation")
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/project/new2"), now: t0.addingTimeInterval(ChatProjects.setupWindow + 1)), "not after the window")
s.closed = true
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/project/new2"), now: t0.addingTimeInterval(20)), "not after the form was closed without Create")
s.closed = false; s.stage = .guide
expect(!ChatProjects.adopt(s, url: u("https://claude.ai/project/new3"), now: t0.addingTimeInterval(20)), "only once: not in the instructions stage")
let g = ChatProjects.Setup(claude: false, started: t0, from: "https://chatgpt.com/")
expect(ChatProjects.adopt(g, url: u("https://chatgpt.com/g/g-p-\(hex)-trif/project"), now: t0.addingTimeInterval(5)), "ChatGPT's new project")
expect(ChatProjects.adopt(g, url: u("https://chatgpt.com/g/g-p-\(hex)-my-mods/project"), now: t0.addingTimeInterval(5)), "renamed in the form: still the one made")
expect(!ChatProjects.adopt(g, url: u("https://chatgpt.com/project/x"), now: t0.addingTimeInterval(5)), "claude's shape isn't ChatGPT's")

// (a kept project gone)
let kc = u("https://claude.ai/project/019a")
expect(!ChatProjects.gone(kept: kc, landed: kc, status: 200, saysMissing: false, claude: true), "there: not gone")
expect(ChatProjects.gone(kept: kc, landed: kc, status: 404, saysMissing: false, claude: true), "404: gone")
expect(ChatProjects.gone(kept: kc, landed: kc, status: 200, saysMissing: true, claude: true), "the page says not found: gone")
expect(ChatProjects.gone(kept: kc, landed: u("https://claude.ai/projects"), status: 200, saysMissing: false, claude: true), "sent to the list: gone")
expect(ChatProjects.gone(kept: kc, landed: u("https://claude.ai/new"), status: 200, saysMissing: false, claude: true), "sent to a new chat: gone")
expect(!ChatProjects.gone(kept: kc, landed: u("https://claude.ai/login?from=x"), status: 200, saysMissing: false, claude: true), "signed out: not gone")
expect(!ChatProjects.gone(kept: kc, landed: u("https://accounts.google.com/x"), status: 200, saysMissing: false, claude: true), "another site: not gone")
expect(!ChatProjects.gone(kept: kc, landed: nil, status: nil, saysMissing: false, claude: true), "nothing yet: not gone")
let kg = u("https://chatgpt.com/g/g-p-\(hex)-trif/project")
expect(!ChatProjects.gone(kept: kg, landed: u("https://chatgpt.com/g/g-p-\(hex)-renamed/project"), status: 200, saysMissing: false, claude: false), "renamed: not gone")
expect(ChatProjects.gone(kept: kg, landed: u("https://chatgpt.com/"), status: 200, saysMissing: false, claude: false), "ChatGPT sent home: gone")

print(failures.isEmpty ? "chat projects: ok" : failures.joined(separator: "\n"))
