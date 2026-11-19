import Foundation
import Network

// mobile/test/phonelink.test.js builds this with ../../browser-probe/TrifProbe/PhoneLink.swift for the Mac:
//   check selftest                                  → "ok" or what didn't match
//   check parse <text>…, check pair <port> <code>…  → PhoneLinkPair.swift (below)
//   check connect <port> <computerKeyHex> <phonePrivateHex> [secret]
//     a PhoneLinkSession to 127.0.0.1:<port>; prints "open <payload JSON>", then sends hello and a 300 KB
//     message (several pieces), prints "msg <t> <blob length>" for each message it gets, closes on "bye",
//     and prints "end <reason>" last.

func hex(_ s: String) -> Data {
    var d = Data()
    var i = s.startIndex
    while i < s.endIndex { let j = s.index(i, offsetBy: 2); d.append(UInt8(s[i..<j], radix: 16)!); i = j }
    return d
}

func say(_ s: String) { print(s); fflush(stdout) }
// (ModID's text rules: the repository's shared core, as the app's bundle has it)
Core.source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../shared/gen/core.js").standardized
Core.report = { say("core: \($0)") }

let args = CommandLine.arguments
if args.count > 1, args[1] == "selftest" {
    say(PhoneLink.selfTest() ?? "ok")
    exit(0)
}
// check syncunit: PhoneSync.swift against a scripted computer and a store in memory; "FAIL …" lines, then
// "sync unit: ok" or "sync unit: <n> failed"
if args.count > 1, args[1] == "syncunit" {
    var fails = 0
    func expect(_ ok: Bool, _ what: String) { if !ok { fails += 1; say("FAIL \(what)") } }
    final class Store: PhoneSyncStore {
        var files: [String: String] = [:], trash: [String: String] = [:], takes: [String] = []
        var switches: [String: PhoneSync.Switch] = [:], allowed: [String: PhoneSync.Hint] = [:], hints: [String: PhoneSync.Hint]?, setAt: [String: Int] = [:]
        func syncFiles() -> [String: String] { files }
        func syncSwitches() -> [String: PhoneSync.Switch] { switches.filter { files[$0.key] != nil } }
        func syncSetSwitch(_ key: String, _ s: PhoneSync.Switch) -> Bool {
            guard files[key] != nil else { return false }
            setAt[key] = takes.count // (when: after the gets, so a new mod is here)
            let changed = !(switches[key].map { $0.same(s) } ?? false)
            switches[key] = s
            return changed
        }
        func syncAllowed() -> [String: PhoneSync.Hint] { allowed }
        func syncHints(_ h: [String: PhoneSync.Hint]) { hints = h }
        func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken {
            takes.append("\(id) \(isNew ? "new" : "changed")")
            if code.contains("BROKEN") { return .refused("not a mod") }
            if files[id] == nil { switches[id] = .init(on: false, off: [], at: 0) } // (new: off, as an import, until the plan's switch)
            files[id] = code
            return .taken(held: code.contains("fetch("))
        }
        func syncRemove(_ id: String) { trash[id] = files.removeValue(forKey: id) }
    }
    final class Computer: PhoneSyncLink {
        var sent: [[String: Any]] = [], plan: [String: Any] = [:], code: [String: String] = [:], putErrors: [String: String] = [:]
        var beginError: String?
        func syncRequest(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
            sent.append(m)
            let t = m["t"] as! String
            DispatchQueue.main.async { [self] in
                if t == "sync.begin" { return done(beginError.map { ["t": "error", "code": $0] } ?? plan) }
                if t == "sync.get" { return done(["t": "sync.mod", "mod": m["mod"]!, "name": "x", "code": code[m["mod"] as! String] ?? ""]) }
                if t == "sync.put" { return done(putErrors[m["mod"] as! String].map { ["t": "error", "code": $0] } ?? ["t": "ok", "mod": m["mod"]!, "rev": PhoneSync.rev(m["code"] as! String), "held": false]) }
                if t == "sync.end" { return done(["t": "sync.done", "synced": 1, "waiting": [["id": "a.com/up", "name": "Up"]], "conflicts": []]) }
            }
        }
    }
    func wait(_ f: () -> Bool) { let end = Date().addingTimeInterval(5); while !f() && Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) } }
    expect(PhoneSync.rev("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "rev is SHA-256 of UTF-8, hex")

    let st = Store(), pc = Computer()
    st.files = ["a.com/up": "// up v2", "a.com/same": "// same", "a.com/gone": "// gone here", "a.com/edit": "// edit v1",
                "a.com/held": "// held v1", "a.com/both": "// both phone", "a.com/bad": "// bad v1"]
    let giveN = "// new from computer", giveE = "// edit v2", giveH = "// held v2 fetch(1)", giveS = "// sibling", giveB = "// back", giveX = "BROKEN"
    pc.code = ["a.com/new": giveN, "a.com/edit": giveE, "a.com/held": giveH, "a.com/both-from-computer": giveS, "a.com/back": giveB, "a.com/bad": giveX, "a.com/stale": "// newer"]
    pc.plan = ["t": "sync.plan", "syncId": "s1",
               "want": [["id": "a.com/up"], ["id": "a.com/both", "conflict": true], ["id": "a.com/missing"]],
               "give": [["id": "a.com/new", "rev": PhoneSync.rev(giveN)], ["id": "a.com/edit", "rev": PhoneSync.rev(giveE)],
                        ["id": "a.com/held", "rev": PhoneSync.rev(giveH)], ["id": "a.com/both-from-computer", "rev": PhoneSync.rev(giveS), "conflict": "a.com/both"],
                        ["id": "a.com/back", "rev": PhoneSync.rev(giveB), "back": true], ["id": "a.com/bad", "rev": PhoneSync.rev(giveX)],
                        ["id": "a.com/stale", "rev": PhoneSync.rev("// older")]],
               "remove": ["a.com/gone", "a.com/never"], "later": ["b.com/busy"], "skipped": [["id": "a.com/huge", "why": "over 1 MB"]],
               // (beside the text, 11-18: the computer's switches to set here, and what it allows as it is)
               "switches": [["id": "a.com/new", "on": true, "off": [String](), "at": 7000], ["id": "a.com/same", "on": true, "off": ["m.a.com"], "at": 9000],
                            ["id": "a.com/gone", "on": true, "off": [String](), "at": 1], ["id": "a.com/nothere", "on": true, "off": [String](), "at": 1], ["id": "a.com/bad-switch", "on": "yes"]],
               "allowed": [["id": "a.com/same", "rev": PhoneSync.rev("// same"), "tier": "boxed", "powers": ["keys"]], ["id": "a.com/junk", "rev": "short", "tier": "boxed"]]]
    st.switches = ["a.com/up": .init(on: false, off: [], at: 500), "a.com/same": .init(on: true, off: [], at: 0)]
    st.allowed = ["a.com/up": .init(rev: PhoneSync.rev("// up v2"), tier: "style", powers: []), "a.com/same": .init(rev: PhoneSync.rev("// an older same"), tier: "style", powers: [])]
    pc.putErrors = ["a.com/both": "changed"]
    let original = st.files
    var got: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: st, link: pc).run { got = $0 }
    wait { got != nil }
    guard case .success(let s)? = got else { say("FAIL no summary: \(String(describing: got))"); exit(1) }
    let begin = pc.sent.first!
    let man = begin["mods"] as! [[String: Any]]
    expect(begin["t"] as? String == "sync.begin" && man.map { $0["id"] as! String } == original.keys.sorted() && man.allSatisfy { $0["rev"] as? String == PhoneSync.rev(original[$0["id"] as! String]!) }, "begin: every mod with its rev, sorted")
    // (beside the text: it says it knows switches; each row its switch; `ok` only for the very revision allowed here)
    let row = { (id: String) in man.first { $0["id"] as? String == id }! }
    expect(begin["switches"] as? Bool == true, "begin says switches: true")
    expect((row("a.com/up")["sw"] as? [String: Any]).flatMap(PhoneSync.Switch.init) == PhoneSync.Switch(on: false, off: [], at: 500), "a row's switch")
    expect(row("a.com/edit")["sw"] == nil, "no switch kept for it: none sent")
    expect((row("a.com/up")["ok"] as? [String: Any]).flatMap(PhoneSync.Hint.init) == PhoneSync.Hint(rev: PhoneSync.rev("// up v2"), tier: "style", powers: []), "ok for the revision allowed here")
    expect(row("a.com/same")["ok"] == nil, "an approval of another revision isn't sent as one of this")
    expect(pc.sent.map { $0["t"] as! String } == ["sync.begin", "sync.put", "sync.put", "sync.get", "sync.get", "sync.get", "sync.get", "sync.get", "sync.get", "sync.get", "sync.end"], "order: begin, puts, gets, end: \(pc.sent.map { $0["t"]! })")
    expect(pc.sent.filter { $0["t"] as? String != "sync.begin" }.allSatisfy { $0["syncId"] as? String == "s1" }, "every request carries the syncId")
    expect(pc.sent[1]["mod"] as? String == "a.com/up" && pc.sent[1]["code"] as? String == "// up v2", "put sends the file as it is")
    expect(s.sent == ["a.com/up"] && s.refused.contains { $0.id == "a.com/both" && $0.why == "computer: changed" }, "put ok / refused: \(s.sent) \(s.refused)")
    expect(st.files["a.com/new"] == giveN && st.takes.contains("a.com/new new"), "a new mod taken as new")
    expect(st.files["a.com/edit"] == giveE && st.takes.contains("a.com/edit changed"), "a changed mod taken as an edit")
    expect(s.waitingHere == ["a.com/held"] && s.taken.contains("a.com/held"), "held here: \(s.waitingHere)")
    expect(st.files["a.com/bad"] == "// bad v1" && s.refused.contains { $0.id == "a.com/bad" && $0.why == "not a mod" }, "a file the reader refuses is not taken")
    expect(st.files["a.com/stale"] == nil && !st.takes.contains { $0.hasPrefix("a.com/stale") }, "a give whose code isn't its rev is not taken")
    expect(st.files["a.com/gone"] == nil && st.trash["a.com/gone"] == "// gone here" && s.removed == ["a.com/gone"], "remove goes to the trash")
    expect(s.conflicts.count == 1 && s.conflicts[0].id == "a.com/both" && s.conflicts[0].sibling == "a.com/both-from-computer" && st.files["a.com/both-from-computer"] == giveS, "conflict: the sibling taken")
    expect(s.cameBack == ["a.com/back"] && st.files["a.com/back"] == giveB, "came back")
    expect(s.later == ["b.com/busy"] && s.skipped.first?.id == "a.com/huge", "later and skipped")
    expect(s.waitingThere.first?.name == "Up", "waiting there")
    // the plan's switches: set after the gets (a new mod takes the computer's: D8), not for a removed or missing mod
    expect(st.switches["a.com/new"] == PhoneSync.Switch(on: true, off: [], at: 7000) && st.setAt["a.com/new"] == st.takes.count, "a new mod arrives with the computer's switch, after it's taken")
    expect(st.switches["a.com/same"] == PhoneSync.Switch(on: true, off: ["m.a.com"], at: 9000), "a per-site switch from the computer")
    expect(Set(s.switched) == ["a.com/new", "a.com/same"], "switched here: \(s.switched)")
    expect(st.setAt["a.com/gone"] == nil && st.setAt["a.com/nothere"] == nil && st.setAt["a.com/bad-switch"] == nil, "no switch for a removed, missing or unreadable one")
    expect(st.hints == ["a.com/same": PhoneSync.Hint(rev: PhoneSync.rev("// same"), tier: "boxed", powers: ["keys"])], "the computer's hints kept, a bad one left out: \(String(describing: st.hints))")
    let endSw = (pc.sent.last!["switches"] as? [[String: Any]]) ?? []
    expect(endSw.map { $0["id"] as! String } == st.files.keys.sorted().filter { st.switches[$0] != nil }
           && endSw.allSatisfy { PhoneSync.Switch($0) == st.switches[$0["id"] as! String] }, "end: every mod's switch now")
    let have = (pc.sent.last!["have"] as! [[String: String]])
    let haveIds = have.map { $0["id"]! }
    expect(!haveIds.contains("a.com/missing") && !haveIds.contains("a.com/gone") && !haveIds.contains("a.com/stale") && !haveIds.contains("a.com/never"), "have: only what the phone has: \(haveIds)")
    expect(have.allSatisfy { $0["rev"] == PhoneSync.rev(st.files[$0["id"]!]!) } && haveIds.contains("a.com/bad") && haveIds.contains("a.com/up"), "have: the revisions now (a refused one its old)")

    // an older computer: no switches or hints in its plan: nothing set, the hints kept as they were
    let st3 = Store(); st3.files = ["a.com/x": "// x"]; st3.switches = ["a.com/x": .init(on: true, off: [], at: 3)]; st3.hints = ["a.com/x": .init(rev: PhoneSync.rev("// x"), tier: "style", powers: [])]
    let pc3 = Computer(); pc3.plan = ["t": "sync.plan", "syncId": "s3", "want": [[String: Any]](), "give": [[String: Any]](), "remove": [String]()]
    var got3: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: st3, link: pc3).run { got3 = $0 }
    wait { got3 != nil }
    if case .success(let s3)? = got3 { expect(s3.switched.isEmpty && !s3.changedAnything, "an older computer: nothing switched") } else { expect(false, "an older computer's sync works") }
    expect(st3.switches["a.com/x"] == .init(on: true, off: [], at: 3) && st3.hints?.count == 1 && st3.setAt.isEmpty, "an older computer: switches and hints as they were")

    // the hint's conditions (D13): the very revision, and nothing beyond what was allowed there; never an approval
    let h = PhoneSync.Hint(rev: PhoneSync.rev("code"), tier: "boxed", powers: ["keys", "click"])
    expect(h.fits(rev: PhoneSync.rev("code"), tier: "boxed", powers: ["click"]), "same revision, fewer powers: the gentle card")
    expect(h.fits(rev: PhoneSync.rev("code"), tier: "style", powers: []), "a lower tier")
    expect(!h.fits(rev: PhoneSync.rev("changed"), tier: "boxed", powers: ["click"]), "changed code: the normal card")
    expect(!h.fits(rev: PhoneSync.rev("code"), tier: "boxed", powers: ["click", "go-to"]), "more powers: the normal card")
    expect(!h.fits(rev: PhoneSync.rev("code"), tier: "free", powers: []), "a higher tier: the normal card")
    expect(PhoneSync.Hint(["rev": "x", "tier": "boxed"]) == nil && PhoneSync.Hint(["rev": PhoneSync.rev("a"), "tier": "god"]) == nil, "bad hints refused")
    expect(PhoneSync.Switch(on: true, off: ["b", "a", "a"], at: 5.7) == PhoneSync.Switch(on: true, off: ["a", "b"], at: 5), "a switch's sites sorted once, its time whole")
    expect(PhoneSync.Switch(on: true, off: [], at: 1).same(.init(on: true, off: [], at: 99)) && !PhoneSync.Switch(on: true, off: [], at: 1).same(.init(on: false, off: [], at: 1)), "same: without the time")
    expect(PhoneSync.key("a.com/x") == "a.com/x", "the sync key of a mod without a stable id is its file id")
    expect(PhoneSync.Switch(on: false, off: [], at: 0, fresh: true).wire["fresh"] as? Bool == true && PhoneSync.Switch(on: false, off: [], at: 9, fresh: true).wire["fresh"] == nil
           && PhoneSync.Switch(on: true, off: [], at: 0, fresh: true).wire["fresh"] == nil, "fresh: an off never switched only")

    // the computer says off: a failure, nothing changed
    let pc2 = Computer(); pc2.beginError = "off"
    let before = st.files
    var got2: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: st, link: pc2).run { got2 = $0 }
    wait { got2 != nil }
    if case .failure(let f)? = got2 { expect(f.code == "off", "off's code") } else { expect(false, "off is a failure") }
    expect(st.files == before && pc2.sent.count == 1, "off: nothing more sent or changed")

    // the scheduler: one at a time, the change rule
    var runs = 0, finish: ((Result<PhoneSync.Summary, PhoneSync.Failure>) -> Void)?
    let sch = PhoneSync.Scheduler(changeDelay: 0.05, gap: 0, files: { st.files }, sync: { runs += 1; finish = $0 })
    var reasons: [String] = []
    sch.finished = { _, why in reasons.append(why) }
    sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 0, "no sync yet this launch: a change waits for the first")
    sch.now("front"); sch.now("nudge"); sch.now("now")
    expect(runs == 1 && sch.running, "one at a time")
    finish?(.success(.init())); wait { runs == 2 }
    expect(runs == 2 && reasons == ["front"], "what came during one runs once after it: \(runs) \(reasons)")
    finish?(.success(.init())); RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    expect(reasons == ["front", "now"] && !sch.running, "then idle; the one after is the person's Sync now (its toast says nothing new too): \(reasons)")
    sch.now("front"); sch.now("pair"); sch.now("change")
    finish?(.success(.init())); wait { runs == 4 }; finish?(.success(.init())); RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    expect(reasons.suffix(2) == ["front", "pair"], "an automatic reason after the person's doesn't replace it: \(reasons)")
    sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 4, "a change that leaves every file as the last sync did (a switch) is no sync")
    st.files["a.com/up"] = "// up v3"; sch.changed(); sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 5, "a file changed: one sync after the delay: \(runs)")
    finish?(.failure(.init(code: "notFound", message: ""))); RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    st.files["a.com/up"] = "// up v4"; sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 6, "after a failed sync the change rule still compares with the last good one")
    // the toast after a sync (Tim, 11-18, 11-19): only after one the person started (Sync now, pairing's first);
    // an automatic one (front, change, nudge) shows none, whatever it did or why it failed
    do {
        let C = "Tim's Mac"
        var moved = PhoneSync.Summary(); moved.taken = ["a.com/x"]; moved.sent = ["a.com/y", "a.com/z"]
        var waits = PhoneSync.Summary(); waits.taken = ["a.com/x"]; waits.waitingHere = ["a.com/x"]
        var switchedOnly = PhoneSync.Summary(); switchedOnly.switched = ["a.com/x"]
        let nothing = PhoneSync.Summary()
        let off = PhoneSync.Failure(code: "notFound", message: "")
        var un = PhoneSync.Summary(); un.unfinished = true
        func said(_ r: Result<PhoneSync.Summary, PhoneSync.Failure>, _ why: String) -> String {
            guard let x = PhoneSync.Toast.after(r, why: why, computer: C) else { return "-" }
            return (x.problem ? "! " : "") + x.text
        }
        for why in ["front", "change", "nudge"] {
            for r: Result<PhoneSync.Summary, PhoneSync.Failure> in [.success(nothing), .success(switchedOnly), .success(moved), .success(waits), .success(un), .failure(off), .failure(.init(code: "busy", message: "")), .failure(.init(code: "off", message: ""))] {
                expect(said(r, why) == "-", "automatic (\(why)): no toast, success or failure: \(said(r, why))")
            }
        }
        expect(said(.success(nothing), "now") == "Synced with \(C) · nothing new", "Sync now, nothing moved: nothing new")
        expect(said(.success(nothing), "pair") == "Synced with \(C) · nothing new", "pairing's first sync, nothing moved: nothing new")
        expect(said(.success(moved), "now") == "Synced with \(C) · 1 from the computer, 2 to it", "Sync now with changes: the counts")
        expect(said(.success(waits), "pair") == "Synced with \(C) · 1 from the computer, 0 to it, 1 waiting for your OK", "the counts and the wait")
        let notFound = "! Not synced: can't find \(C). It may be asleep, on another Wi-Fi, or have no browser with TRIF open"
        expect(said(.failure(off), "now") == notFound && said(.failure(off), "now") == notFound, "Sync now failing: said every time")
        expect(said(.failure(.init(code: "off", message: "")), "pair") == "! Not synced: syncing phone mods is off on \(C)", "another reason")
        expect(said(.success(un), "now") == "! Not synced with \(C) this time. TRIF tries again", "an unfinished sync the person started: a problem")
        expect(said(.failure(.init(code: "notPaired", message: "")), "now") == "-", "not paired: never said")

        // the lasting line (My computer, Settings): the latest try's failure said quietly, cleared when one works
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        func line(_ failed: String?, _ ago: Double) -> String? { PhoneSync.Toast.lastLine(at: t0, failed: failed, computer: C, now: t0.addingTimeInterval(ago)) }
        expect(PhoneSync.Toast.lastLine(at: nil, failed: "notFound", computer: C) == nil, "never synced: no line")
        expect(line(nil, 10) == "Last synced just now" && line(nil, 125) == "Last synced 2 min ago", "the line: \(line(nil, 125) ?? "nil")")
        expect(line("notFound", 125) == "Last synced 2 min ago · the last try didn't get through: can't find \(C)", "a failed try's note: \(line("notFound", 125) ?? "nil")")
        expect(line("off", 125) == "Last synced 2 min ago · the last try didn't get through: syncing phone mods is off on \(C)", "off")
        expect(line("busy", 125) == "Last synced 2 min ago · the last try didn't get through", "a reason without words: the note alone")
        var lastFailed: String? = nil
        for r: Result<PhoneSync.Summary, PhoneSync.Failure> in [.failure(off)] { lastFailed = PhoneSync.Toast.failed(r) }
        expect(lastFailed == "notFound", "a failed try is kept")
        expect(PhoneSync.Toast.failed(.success(un)) == "unfinished", "an unfinished one too")
        lastFailed = PhoneSync.Toast.failed(.success(nothing))
        expect(lastFailed == nil && line(lastFailed, 10) == "Last synced just now", "a sync that works clears it")
        expect(PhoneSync.Toast.failed(.failure(.init(code: "notPaired", message: ""))) == nil, "not paired: nothing kept")
    }

    // the scheduler against a computer that refuses a begin within its second (busy) and nudges after each sync that
    // sent it a switch (the helper before 11-19: the switch arriving in the browser was news): a burst of 5 switch
    // changes in 2 s (here 0.5 s, the delays scaled by 1/4) is one sync, never two in flight, nothing reported failed
    do {
        var fs = ["a.com/s": "1"], seen: [String: String] = [:]
        var lastBegin = -100.0, inFlight = 0, maxInFlight = 0, begins = 0, busy = 0
        var reported: [String] = []
        weak var schRef: PhoneSync.Scheduler?
        let clock = { ProcessInfo.processInfo.systemUptime }
        let refuseWithin = 0.25 // (the computer's second, scaled)
        let sch = PhoneSync.Scheduler(changeDelay: 0.75, gap: 0.3, files: { fs }) { done in
            inFlight += 1; maxInFlight = max(maxInFlight, inFlight); begins += 1
            let now = clock()
            if now - lastBegin < refuseWithin {
                busy += 1; inFlight -= 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { done(.failure(.init(code: "busy", message: "one sync a second"))) }
                return
            }
            lastBegin = now
            let sent = fs != seen // (the phone's switch went to the computer)
            seen = fs
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                inFlight -= 1
                done(.success(.init()))
                // (the old helper's echo: a nudge a moment after the switch reached the browser)
                if sent { DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { schRef?.now("nudge") } }
            }
        }
        schRef = sch
        sch.finished = { r, why in
            if case .failure(let f) = r { reported.append("\(why): \(f.code)") }
        }
        sch.now("front") // (the app's first sync this launch)
        wait { sch.known != nil }
        RunLoop.main.run(until: Date().addingTimeInterval(0.6)) // (its echo, and quiet)
        let before = sch.started
        let t0 = Date()
        for i in 0..<5 { fs["a.com/s"] = "\(i + 2)"; sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
        let lastChange = Date()
        var firstSync: Date?
        let startedAtBurst = sch.started
        let end = Date().addingTimeInterval(3)
        while Date() < end { if firstSync == nil && sch.started > startedAtBurst { firstSync = Date() }; RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        let burstSyncs = sch.started - before
        expect(reported.isEmpty, "a burst of switches: nothing reported failed: \(reported)")
        expect(maxInFlight == 1, "never two in flight: \(maxInFlight)")
        expect(firstSync.map { $0.timeIntervalSince(lastChange) < 1.0 } ?? false, "the burst's sync goes soon after its last change (3 s scaled): \(firstSync.map { $0.timeIntervalSince(lastChange) } ?? -1)")
        // (the switch's sync, and the old helper's echo: one or two begun with the computer, a busy tried again quietly)
        let accepted = burstSyncs - sch.retried
        expect(accepted >= 1 && accepted <= 2, "a burst of 5 switch changes: one or two syncs: \(accepted) (\(burstSyncs) begun, \(sch.retried) tried again) in \(Date().timeIntervalSince(t0))")
        expect(busy == 0, "the gap keeps every begin past the computer's second: \(busy) refused")
        say("burst: \(accepted) syncs with the computer (\(burstSyncs) begun, \(sch.retried) tried again), \(firstSync.map { Int($0.timeIntervalSince(lastChange) * 1000) } ?? -1) ms after the last change (0.75 s delay), \(busy) refused")
    }

    // a `busy` answer (a computer whose second was another sync's): tried again quietly after the gap, said only when
    // it keeps coming (3 times tried again)
    do {
        var answers = ["busy", "busy", "ok"], calls = 0
        var got: [String] = []
        let sch = PhoneSync.Scheduler(changeDelay: 0.05, gap: 0.1, files: { [:] }) { done in
            calls += 1
            let a = answers.isEmpty ? "busy" : answers.removeFirst()
            DispatchQueue.main.async { a == "ok" ? done(.success(.init())) : done(.failure(.init(code: a, message: ""))) }
        }
        sch.finished = { r, why in got.append("\(why) \(r.failureCode ?? "ok")") }
        sch.now("now")
        wait { !got.isEmpty }
        expect(got == ["now ok"] && calls == 3 && sch.retried == 2, "busy twice: tried again, then ok, one answer: \(got) \(calls)")
        answers = []
        got = []; calls = 0
        sch.now("front")
        wait { !got.isEmpty }
        expect(got == ["front busy"] && calls == 4, "busy every time: said after 3 tries again: \(got) \(calls)")
        // (a sync asked for during the gap waits for it, and is one)
        answers = ["ok", "ok", "ok"]; got = []; calls = 0
        sch.now("front"); sch.now("nudge"); sch.now("change")
        wait { got.count == 1 }
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        expect(got == ["front ok"] && calls == 1, "three asked for at once: one sync: \(got)")
        sch.now("front"); sch.now("now")
        wait { got.count == 3 }
        expect(got.suffix(2) == ["front ok", "now ok"], "the person's during one waits and keeps its reason: \(got)")
    }

    // the toast's pill (Tim, 11-19: swiped up and away, or a tap; smaller, shorter, never over the top bar)
    do {
        let se = ToastPill.place(safeTop: 20)
        expect(se.top == 1 && se.height == 18 && se.top + se.height <= 20, "iPhone SE: inside the 20 pt status bar: \(se)")
        let hidden = ToastPill.place(safeTop: 0)
        expect(hidden.top + hidden.height <= 20, "status bar hidden: the top 20 pt: \(hidden)")
        for top in [44.0, 47, 59, 62] {
            let p = ToastPill.place(safeTop: top)
            expect(p.height == 22 && p.top + p.height <= top, "a \(top) pt strip: at its foot, inside it: \(p)")
        }
        expect(ToastPill.seconds(problem: false) == 2.5 && ToastPill.seconds(problem: true) == 3.5, "2.5 s, a problem 3.5 s")
        expect(ToastPill.dismisses(dragY: -12, predictedY: -12), "a swipe up puts it away")
        expect(ToastPill.dismisses(dragY: -6, predictedY: -60), "a flick up too")
        expect(!ToastPill.dismisses(dragY: -6, predictedY: -12) && !ToastPill.dismisses(dragY: 20, predictedY: 40), "a nudge or a drag down doesn't")
        expect(ToastPill.follow(-15) == -15 && ToastPill.follow(30) == 4, "it follows up, barely down")
    }

    // ---- stable ids (11-18, docs/PHONE-SYNC.md 2a, 3, 4, 7): rows with uid, body and meta; renames applied first; a
    // rename that can't be done ends the sync before sync.end; merge and apart; switches and hints kept by uid
    var events: [String] = []
    final class IdStore: PhoneSyncStore {
        var files: [String: String] = [:], switches: [String: PhoneSync.Switch] = [:], hints: [String: PhoneSync.Hint]?
        var log: (String) -> Void = { _ in }
        func syncFiles() -> [String: String] { files }
        func syncUids() -> [String: String] {
            ModID.kept(files.map { id, code in
                let p = id.split(separator: "/", maxSplits: 1).map(String.init)
                return ModID.Entry(id: id, site: p[0], file: "\(p[1]).js", uid: ModID.parts(code)?.uid)
            })
        }
        func key(_ id: String) -> String { PhoneSync.key(id, uid: syncUids()[id]) }
        func syncSwitches() -> [String: PhoneSync.Switch] { Dictionary(files.keys.compactMap { id in switches[key(id)].map { (key(id), $0) } }, uniquingKeysWith: { a, _ in a }) }
        func syncSetSwitch(_ k: String, _ s: PhoneSync.Switch) -> Bool {
            guard files.keys.contains(where: { key($0) == k }) else { return false }
            let changed = !(switches[k].map { $0.same(s) } ?? false)
            switches[k] = s
            return changed
        }
        func syncAllowed() -> [String: PhoneSync.Hint] { [:] }
        func syncHints(_ h: [String: PhoneSync.Hint]) { hints = h }
        func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken {
            log("take \(id)")
            files[id] = code
            if isNew { switches[key(id)] = .init(on: false, off: [], at: 0, fresh: true) }
            return .taken(held: false)
        }
        func syncRemove(_ id: String) { files[id] = nil }
        func syncRename(_ from: String, _ to: String) -> Bool {
            log("rename \(from)>\(to)")
            guard let code = files[from], files[to] == nil else { return false }
            let was = key(from)
            files[from] = nil
            files[to] = code
            if was != key(to), let sw = switches.removeValue(forKey: was) { switches[key(to)] = sw }
            return true
        }
    }
    final class LogComputer: PhoneSyncLink {
        var sent: [[String: Any]] = [], plan: [String: Any] = [:], code: [String: String] = [:]
        var log: (String) -> Void = { _ in }
        func syncRequest(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
            sent.append(m)
            let t = m["t"] as! String
            log("\(t) \(m["mod"] as? String ?? "")")
            DispatchQueue.main.async { [self] in
                if t == "sync.begin" { return done(plan) }
                if t == "sync.get" { return done(["t": "sync.mod", "mod": m["mod"]!, "name": "x", "code": code[m["mod"] as! String] ?? ""]) }
                if t == "sync.put" { return done(["t": "ok", "mod": m["mod"]!, "rev": PhoneSync.rev(m["code"] as! String), "held": false]) }
                if t == "sync.end" { return done(["t": "sync.done", "synced": 1, "waiting": [[String: Any]](), "conflicts": [[String: Any]]()]) }
            }
        }
    }
    let U1 = "11111111-aaaa-4aaa-8aaa-111111111111", U2 = "22222222-bbbb-4bbb-8bbb-222222222222", U3 = "33333333-cccc-4ccc-8ccc-333333333333", U4 = "44444444-dddd-4ddd-8ddd-444444444444"
    let mod = { (name: String, uid: String?, body: String) in "// ==WebMod==\n// @name \(name)\n\(uid.map { "// @id \($0)\n" } ?? "")// @match *://x.com/*\n// ==/WebMod==\n\(body)\n" }
    let oldName = mod("Old name", U2, "a();"), editHere = mod("Edit here", U1, "b(); // edited on the phone"), calmer = mod("Calmer feed", U3, "c();")
    let plainOne = mod("Plain", nil, "p();"), dup = mod("Copy", U3, "d();")
    let ids = IdStore()
    ids.files = ["x.com/old-name": oldName, "x.com/edit-here": editHere, "x.com/calmer-feed": calmer, "x.com/plain": plainOne, "x.com/zz-copy": dup]
    ids.switches = [PhoneSync.key("x.com/old-name", uid: U2): .init(on: true, off: ["m.x.com"], at: 50)]
    let newName = ModID.withMeta(oldName, name: "New name")!
    let merged = mod("Merged", U1, "b(); // edited on the phone")
    let apart = mod("Calmer feed (from your computer)", U4, "c2();"), every = "// ==WebMod==\n// @name Dark\n// @id 55555555-eeee-4eee-8eee-555555555555\n// ==/WebMod==\nbody { filter: invert(1) }\n"
    let lc = LogComputer()
    lc.code = ["x.com/new-name": newName, "x.com/merged": merged, "x.com/calmer-feed-from-computer": apart, "all-sites/dark": every]
    lc.plan = ["t": "sync.plan", "syncId": "i1",
               "renames": [["from": "x.com/old-name", "to": "x.com/new-name"], ["from": "x.com/edit-here", "to": "x.com/merged"]],
               "want": [["id": "x.com/merged", "merge": true]],
               "give": [["id": "x.com/new-name", "rev": PhoneSync.rev(newName)], ["id": "x.com/merged", "merge": true],
                        ["id": "x.com/calmer-feed-from-computer", "rev": PhoneSync.rev(apart), "apart": "x.com/calmer-feed"],
                        ["id": "all-sites/dark", "rev": PhoneSync.rev(every)]],
               "remove": [String](),
               "switches": [["id": "x.com/new-name", "on": true, "off": ["m.x.com", "x.com"], "at": 90], ["id": "all-sites/dark", "on": true, "off": [String](), "at": 70]],
               "allowed": [["id": "x.com/new-name", "rev": PhoneSync.rev(newName), "tier": "style", "powers": [String]()]]]
    events = []
    ids.log = { events.append($0) }; lc.log = { events.append($0) }
    var got4: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: ids, link: lc).run { got4 = $0 }
    wait { got4 != nil }
    guard case .success(let s4)? = got4 else { say("FAIL ids: no summary \(String(describing: got4))"); exit(1) }
    let b4 = lc.sent.first!, rows4 = b4["mods"] as! [[String: Any]]
    let row4 = { (id: String) in rows4.first { $0["id"] as? String == id } ?? [:] }
    expect(b4["ids"] as? Bool == true && b4["switches"] as? Bool == true, "begin says ids: true")
    expect(row4("x.com/old-name")["uid"] as? String == U2 && row4("x.com/plain")["uid"] == nil, "a row's uid where it has one")
    expect(row4("x.com/zz-copy")["uid"] == nil && row4("x.com/calmer-feed")["uid"] as? String == U3, "one id in a folder twice: the first by file name keeps it")
    let r4 = ModID.revs(oldName)!
    expect(row4("x.com/old-name")["body"] as? String == r4.body && row4("x.com/old-name")["meta"] as? String == r4.meta && r4.body == ModID.sha(oldName.replacingOccurrences(of: "// @name Old name\n// @id \(U2)\n", with: "")), "body and meta: SHA-256 of the text without @name/@id and of name\\nid")
    expect(r4.meta == ModID.sha("Old name\n\(U2)") && ModID.revs(plainOne)!.meta == ModID.sha("Plain\n"), "meta's text")
    expect((row4("x.com/old-name")["sw"] as? [String: Any]).flatMap(PhoneSync.Switch.init) == PhoneSync.Switch(on: true, off: ["m.x.com"], at: 50), "a switch kept by the id's key goes in its row")
    let firstReq = events.firstIndex { $0.hasPrefix("sync.put") || $0.hasPrefix("sync.get") } ?? -1
    let lastRename = events.lastIndex { $0.hasPrefix("rename") } ?? Int.max
    expect(lastRename < firstReq, "renames before puts and gets: \(events)")
    expect(s4.renamed.map { "\($0.from)>\($0.to)" } == ["x.com/old-name>x.com/new-name", "x.com/edit-here>x.com/merged"], "renamed: \(s4.renamed)")
    expect(ids.files["x.com/old-name"] == nil && ids.files["x.com/new-name"] == newName, "the computer's rename: moved, then its text (the new @name) taken")
    expect(lc.sent.contains { $0["t"] as? String == "sync.put" && $0["mod"] as? String == "x.com/merged" && $0["code"] as? String == editHere }, "merge: the phone's file put under the new id, its text as it was")
    expect(ids.files["x.com/merged"] == merged && events.contains("take x.com/merged"), "merge: the give has no rev, whatever sync.get gives is taken")
    expect(s4.apart.count == 1 && s4.apart[0].id == "x.com/calmer-feed-from-computer" && s4.apart[0].of == "x.com/calmer-feed" && ids.files["x.com/calmer-feed-from-computer"] == apart && ids.files["x.com/calmer-feed"] == calmer, "apart: the computer's mod beside the phone's, both here")
    expect(ids.files["all-sites/dark"] == every && s4.taken.contains("all-sites/dark"), "an every-site mod comes over (D10)")
    expect(ids.switches[PhoneSync.key("x.com/new-name", uid: U2)] == PhoneSync.Switch(on: true, off: ["m.x.com", "x.com"], at: 90) && s4.switched.contains("x.com/new-name"), "the plan's switch (by file id) set by the id's key after the rename")
    expect(ids.switches[PhoneSync.key("all-sites/dark", uid: "55555555-eeee-4eee-8eee-555555555555")]?.on == true, "a new every-site mod takes the computer's switch")
    expect(ids.hints?.keys.sorted() == ["x.com#\(U2)"], "hints kept by the id's key: \(String(describing: ids.hints))")
    let end4 = lc.sent.last!
    expect(end4["t"] as? String == "sync.end", "a sync with renames ends with sync.end")
    let have4 = (end4["have"] as? [[String: String]] ?? []).map { $0["id"]! }
    expect(have4.contains("x.com/new-name") && have4.contains("x.com/merged") && !have4.contains("x.com/old-name"), "have names the new ids: \(have4)")
    let endSw4 = (end4["switches"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
    expect(endSw4.contains("x.com/new-name") && !endSw4.contains { $0.contains("#") }, "end's switches by file id on the wire: \(endSw4)")
    expect(!s4.unfinished && s4.changedAnything, "finished")

    // a rename that can't be done here (another mod has `to`): no puts, no gets, no sync.end; the next sync decides
    let ids2 = IdStore(); ids2.files = ["x.com/a": mod("A", U1, "a();"), "x.com/b": mod("B", nil, "b();")]
    let lc2 = LogComputer(); lc2.plan = ["t": "sync.plan", "syncId": "i2", "renames": [["from": "x.com/a", "to": "x.com/b"]], "want": [["id": "x.com/b"]], "give": [["id": "x.com/a", "rev": "x"]], "remove": [String]()]
    var got5: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: ids2, link: lc2).run { got5 = $0 }
    wait { got5 != nil }
    if case .success(let s5)? = got5 {
        expect(s5.unfinished && s5.refused.first?.id == "x.com/a" && s5.renamed.isEmpty, "a rename refused: unfinished, said as refused")
    } else { expect(false, "a refused rename is a sync that ended early, not a failure") }
    expect(lc2.sent.map { $0["t"] as! String } == ["sync.begin"] && ids2.files.count == 2, "nothing more sent or changed: \(lc2.sent.map { $0["t"]! })")
    // (the scheduler keeps comparing with the last finished sync: an unfinished one doesn't count)
    var runs6 = 0, finish6: ((Result<PhoneSync.Summary, PhoneSync.Failure>) -> Void)?
    var f6 = ["x.com/a": "1"]
    let sch6 = PhoneSync.Scheduler(changeDelay: 0.05, gap: 0, files: { f6 }, sync: { runs6 += 1; finish6 = $0 })
    sch6.now("front"); var un = PhoneSync.Summary(); un.unfinished = true; finish6?(.success(un))
    RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    expect(sch6.known == nil, "an unfinished sync isn't the last good one")
    f6["x.com/a"] = "1"
    sch6.now("now"); finish6?(.success(.init())); RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    expect(sch6.known != nil && runs6 == 2, "a finished one is")

    // the sync key (D16)
    expect(PhoneSync.key("x.com/a", uid: U1) == "x.com#\(U1)" && PhoneSync.key("x.com/a") == "x.com/a" && PhoneSync.key("all-sites/d", uid: U1) == "all-sites#\(U1)", "the sync key: <site>#<id>, else the file id")

    say(fails == 0 ? "sync unit: ok" : "sync unit: \(fails) failed")
    exit(fails == 0 ? 0 : 1)
}
// check parse <text>…: PairCode.parse of each: "code <id> <secret> <name>" or "none"
if args.count > 1, args[1] == "parse" {
    for t in args.dropFirst(2) { say(PairCode.parse(t).map { "code \($0.computerId) \($0.secret) \($0.name)" } ?? "none") }
    exit(0)
}
// check pair <port> <code text> [<port> <code text>]…: PhoneLinkPairer with the endpoint 127.0.0.1:<port> and a
// vault in memory, one pairing after another; prints each step, then "kept <name> <id>" or "kept none", and last
// "phone <public key hex>" (the same key across pairings; env CHECK_PHONE_KEY: the private key to start with)
if args.count > 3, args[1] == "pair" {
    let vault = MemoryVault()
    if let k = ProcessInfo.processInfo.environment["CHECK_PHONE_KEY"] { _ = vault.write(PhoneLinkKeys.phoneAccount, hex(k)) } // (a phone's key from before)
    let keys = PhoneLinkKeys(vault: vault)
    var jobs = Array(args.dropFirst(2))
    func nextJob() {
        guard jobs.count >= 2, let port = NWEndpoint.Port(jobs[0]) else {
            let pub = keys.phoneKey().flatMap { try? PhoneLink.publicKey(of: $0) } ?? Data()
            say("phone " + pub.map { String(format: "%02x", $0) }.joined())
            exit(0)
        }
        let text = jobs[1]
        jobs.removeFirst(2)
        guard let code = PairCode.parse(text) else { say("not a code"); return nextJob() }
        let p = PhoneLinkPairer(code: code, keys: keys, phoneName: "Check phone", device: ["name": "iPhone", "width": 375, "height": 667],
                                endpoints: [.hostPort(host: "127.0.0.1", port: port)])
        p.onStep = { s in
            say("step \(s)")
            switch s {
            case .paired, .failed:
                say("kept " + (keys.computer.map { "\($0.name) \($0.id)" } ?? "none"))
                DispatchQueue.main.async { withExtendedLifetime(p) {}; nextJob() }
            default: break
            }
        }
        p.start()
    }
    nextJob()
    dispatchMain()
}
// check remote <port> <code text>: pairs (PhoneLinkPairer, a vault in memory), then PhoneLinkRemote with the same keys at
// 127.0.0.1:<port>, driven by lines on stdin:
//   run <site> <prompt>   run.start for https://<site>/home with a page copy and a small JPEG
//   drop                  the connection lost as a suspended app loses it (no reconnection until `wake`)
//   wake                  reconnect now (run.resume for the followed runs)
//   close                 the app closed (PhoneLinkRemote.close: the computer keeps the runs)
//   reopen                a new PhoneLinkRemote with the same keys, connected ("hello …")
//   pickup                pickUp for each of its hello's pending runs ("pending <chat> done <bool>")
//   pset <id> <JSON string>   the phone's own mod made or edited (a store in memory: the app's ModStore stands in)
//   pdel <id>             the phone deletes one (to its trash)
//   files                 "files <JSON id → text>", "trash <JSON ids>"
//   sync                  one PhoneSync.run with that store over this link: "synced <summary>" or "sync failed <code>"
//                         (the store holds what has a fetch( in it, as the app's approval would: "held" in the summary)
//   quit
// and prints: "paired <name>", "nudged" (the computer's sync.changed), "hello <name> agent <agent> pending <n>", "started" or "error <code>", "event <n> <kind>
// <what>", "tool <tool> <input JSON, code cut to its first line>" (answered at once: canned words, a JPEG), "result
// <mod ids> removed <n>", "state <state>", "lost <code>".
if args.count > 3, args[1] == "remote", let port = NWEndpoint.Port(args[2]), let code = PairCode.parse(args[3]) {
    // (CHECK_OLD_PHONE: an app from before 11-18, which says nothing of stable ids)
    if ProcessInfo.processInfo.environment["CHECK_OLD_PHONE"] != nil { PhoneSync.sendIds = false }
    let keys = PhoneLinkKeys(vault: MemoryVault())
    // (what the app's chats show, kept across a close and reopen as across launches; this process's own)
    let shownSuite = "trif.phonelink-check.\(getpid())"
    let shownStore = UserDefaults(suiteName: shownSuite)!
    shownStore.removePersistentDomain(forName: shownSuite)
    atexit { UserDefaults.standard.removePersistentDomain(forName: "trif.phonelink-check.\(getpid())") }
    let at: [NWEndpoint] = [.hostPort(host: "127.0.0.1", port: port)]
    let jpeg = Data([0xff, 0xd8, 0xff, 0xe0]) + Data("the phone's page".utf8)
    let p = PhoneLinkPairer(code: code, keys: keys, phoneName: "Check phone", device: ["name": "iPhone", "width": 375, "height": 667], endpoints: at)
    var remote: PhoneLinkRemote?
    final class MemStore: PhoneSyncStore {
        var files: [String: String] = [:], trash: [String: String] = [:]
        // (switches and hints by sync key: a mod's stable id where it has one, as the app keeps them)
        var switches: [String: PhoneSync.Switch] = [:], allowedRevs: [String: String] = [:], hints: [String: PhoneSync.Hint] = [:]
        func syncFiles() -> [String: String] { files }
        func syncUids() -> [String: String] {
            ModID.kept(files.map { id, code in
                let p = id.split(separator: "/", maxSplits: 1).map(String.init)
                return ModID.Entry(id: id, site: p[0], file: "\(p.count > 1 ? p[1] : id).js", uid: ModID.parts(code)?.uid)
            })
        }
        func key(_ id: String) -> String { PhoneSync.key(id, uid: syncUids()[id]) }
        func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken {
            guard code.contains("==WebMod==") else { return .refused("not a mod") }
            let new = files[id] == nil
            files[id] = code
            if new { switches[key(id)] = .init(on: false, off: [], at: 0) } // (new: off, as an import, until the plan's switch)
            return .taken(held: code.contains("fetch("))
        }
        func syncRemove(_ id: String) { switches[key(id)] = nil; trash[id] = files.removeValue(forKey: id) }
        func syncSwitches() -> [String: PhoneSync.Switch] { Dictionary(files.keys.compactMap { id in switches[key(id)].map { (key(id), $0) } }, uniquingKeysWith: { a, _ in a }) }
        func syncSetSwitch(_ k: String, _ s: PhoneSync.Switch) -> Bool {
            guard files.keys.contains(where: { key($0) == k }) else { return false }
            let changed = !(switches[k].map { $0.same(s) } ?? false)
            switches[k] = s
            return changed
        }
        // (`pok`: allowed here as it is then, a free mod's hint; a later change isn't, as the app's approval goes)
        func syncAllowed() -> [String: PhoneSync.Hint] {
            Dictionary(allowedRevs.compactMap { id, rev in files[id].flatMap { PhoneSync.rev($0) == rev ? (key(id), PhoneSync.Hint(rev: rev, tier: "free", powers: [])) : nil } }, uniquingKeysWith: { a, _ in a })
        }
        func syncHints(_ h: [String: PhoneSync.Hint]) { hints = h }
        /// The computer's rename (as ModStore.syncRename): moved, its text as it is, its switch following.
        func syncRename(_ from: String, _ to: String) -> Bool {
            guard let code = files[from], files[to] == nil else { return false }
            let was = key(from)
            files[from] = nil; files[to] = code
            if was != key(to), let sw = switches.removeValue(forKey: was) { switches[key(to)] = sw }
            if let a = allowedRevs.removeValue(forKey: from) { allowedRevs[to] = a }
            return true
        }
        /// The phone's own rename (as ModStore.rename): @name set, @id added if none, the file following.
        func rename(_ from: String, _ to: String, _ name: String) -> Bool {
            guard let code = files[from], from == to || files[to] == nil,
                  let text = ModID.withMeta(code, name: name, uid: syncUids()[from] ?? ModID.newId()) else { return false }
            let was = key(from)
            files[from] = nil; files[to] = text
            if was != key(to), let sw = switches.removeValue(forKey: was) { switches[key(to)] = sw }
            return true
        }
    }
    let mem = MemStore()
    func json(_ o: Any) -> String { String(data: try! JSONSerialization.data(withJSONObject: o, options: .sortedKeys), encoding: .utf8)! }
    func open() {
        let r = PhoneLinkRemote(keys: keys, phoneName: "Check phone", device: ["name": "iPhone", "width": 375, "height": 667], app: "check", endpoints: at,
                                defaults: shownStore)
        r.retry = []
        r.onState = { s in say("state \(s)") }
        r.onEvent = { _, n, ev in
            let kind = ev["kind"] as? String ?? "?"
            let what: String
            switch kind {
            case "text": what = ev["text"] as? String ?? ""
            case "tool": what = "\(ev["name"] as? String ?? "") \(ev["summary"] as? String ?? "")"
            case "error": what = ev["message"] as? String ?? ""
            case "done": what = "ok \(ev["ok"] as? Bool ?? false)"
            case "session": what = ev["sessionId"] as? String ?? ""
            default: what = ""
            }
            say("event \(n) \(kind) \(what.replacingOccurrences(of: "\n", with: " "))")
        }
        r.onResult = { _, m in
            let ids = (m["mods"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }.sorted()
            say("result \(ids.joined(separator: ",")) removed \((m["removed"] as? [Any])?.count ?? 0)")
        }
        r.onTool = { _, tool, input, answer in
            var shown = input
            if let c = shown["code"] as? String { shown["code"] = String(c.split(separator: "\n").first ?? "") }
            say("tool \(tool) \(json(shown))")
            switch tool {
            case "try_mod": answer(.init(text: "Tried it.\nErrors: none", shot: jpeg, error: false))
            case "read_page": answer(.init(text: "<nav>Home</nav>", shot: nil, error: false))
            default: answer(.init(text: "The screenshot is attached.", shot: jpeg, error: false))
            }
        }
        r.onLost = { _, e in say("lost \(e.code)") }
        r.onSyncChanged = { say("nudged") }
        remote = r
        r.connect { res in
            switch res {
            case .success(let h): say("hello \(h.name) agent \(h.agent ?? "none") pending \(h.pending.count)")
            case .failure(let f): say("connect failed \(f)")
            }
        }
    }
    func begin() {
        open()
        FileHandle.standardInput.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { exit(0) }
            for line in String(decoding: d, as: UTF8.self).split(separator: "\n").map(String.init) {
                DispatchQueue.main.async {
                    let w = line.split(separator: " ", maxSplits: 2).map(String.init)
                    switch w.first {
                    case "run" where w.count == 3:
                        remote?.start(url: "https://\(w[1])/home", prompt: w[2], page: "<main>the page</main>", shot: jpeg, chat: w[1], session: nil, width: 375) { res in
                            switch res {
                            case .success: say("started")
                            case .failure(let e): say("error \(e.code)")
                            }
                        }
                    case "drop": remote?.drop()
                    case "wake": remote?.wake()
                    case "close": remote?.close(); remote = nil
                    case "reopen": open()
                    case "pickup":
                        for k in remote?.hello?.pending ?? [] { say("pending \(k.chat) done \(k.done)"); remote?.pickUp(k.runId) }
                    case "pset" where w.count == 3:
                        if let t = try? JSONSerialization.jsonObject(with: Data(w[2].utf8), options: .fragmentsAllowed) as? String { mem.files[w[1]] = t; say("pset \(w[1])") }
                    case "pdel" where w.count == 2:
                        mem.trash[w[1]] = mem.files.removeValue(forKey: w[1]); say("pdel \(w[1])")
                    case "files": say("files \(json(mem.files))"); say("trash \(json(mem.trash.keys.sorted()))")
                    // (`pren <from> <to> <name…>`: the phone renames a mod, as the Mods tab's Rename does)
                    case "pren" where w.count == 3:
                        let rest = w[2].split(separator: " ", maxSplits: 1).map(String.init)
                        say(rest.count == 2 && mem.rename(w[1], rest[0], rest[1]) ? "pren \(w[1]) \(rest[0])" : "pren failed")
                    case "psw" where w.count == 3:
                        if let d = try? JSONSerialization.jsonObject(with: Data(w[2].utf8)) as? [String: Any], let sw = PhoneSync.Switch(d) { mem.switches[mem.key(w[1])] = sw; say("psw \(w[1])") }
                    case "pok" where w.count == 2: if let f = mem.files[w[1]] { mem.allowedRevs[w[1]] = PhoneSync.rev(f) }; say("pok \(w[1])")
                    case "sws":
                        say("switches \(json(mem.switches.mapValues { $0.wire }))")
                        say("hints \(json(mem.hints.mapValues { $0.wire }))")
                    case "sync":
                        guard let r = remote else { say("sync failed closed"); break }
                        PhoneSync(store: mem, link: r).run { res in
                            switch res {
                            case .success(let s):
                                say("synced taken \(json(s.taken.sorted())) held \(json(s.waitingHere.sorted())) removed \(json(s.removed.sorted())) sent \(json(s.sent.sorted())) waitingThere \(json(s.waitingThere.map(\.id).sorted())) conflicts \(json(s.conflicts.map { "\($0.id)>\($0.sibling)" })) cameBack \(json(s.cameBack)) refused \(json(s.refused.map { "\($0.id): \($0.why)" })) skipped \(json(s.skipped.map(\.id))) later \(json(s.later)) switched \(json(s.switched.sorted())) renamed \(json(s.renamed.map { "\($0.from)>\($0.to)" })) apart \(json(s.apart.map { "\($0.id)~\($0.of)" }))\(s.unfinished ? " unfinished" : "")")
                            case .failure(let f): say("sync failed \(f.code)")
                            }
                        }
                    case "quit": exit(0)
                    default: say("? \(line)")
                    }
                }
            }
        }
    }
    p.onStep = { s in
        switch s {
        case .paired(let n): say("paired \(n)"); DispatchQueue.main.async { withExtendedLifetime(p) {}; begin() }
        case .failed(let f): say("pair failed \(f)"); exit(1)
        default: break
        }
    }
    p.start()
    dispatchMain()
}
guard args.count >= 5, args[1] == "connect", let port = NWEndpoint.Port(args[2]) else {
    say("usage: check selftest | connect <port> <computerKeyHex> <phonePrivateHex> [secret]")
    exit(2)
}
var hello: [String: Any] = ["v": 1, "name": "Check phone"]
if args.count > 5 { hello["pair"] = args[5] }
let session = try PhoneLinkSession(endpoint: .hostPort(host: "127.0.0.1", port: port), privateKey: hex(args[4]),
                                   computerKey: hex(args[3]), hello: hello)
session.onOpen = { payload in
    let json = String(data: try! JSONSerialization.data(withJSONObject: payload, options: .sortedKeys), encoding: .utf8)!
    say("open \(json)")
    session.send(["t": "hello", "id": 1, "app": "check"])
    session.send(["t": "big", "blob": String(repeating: "y", count: 300_000) + "é"])
}
session.onMessage = { m in
    say("msg \(m["t"] as? String ?? "?") \((m["blob"] as? String)?.count ?? 0)")
    if m["t"] as? String == "bye" { session.close() }
}
session.onEnd = { why in
    say("end \(why)")
    exit(0)
}
session.start()
dispatchMain()
