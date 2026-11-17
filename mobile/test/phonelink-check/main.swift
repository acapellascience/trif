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
        func syncFiles() -> [String: String] { files }
        func syncTake(_ id: String, code: String, isNew: Bool) -> PhoneSync.Taken {
            takes.append("\(id) \(isNew ? "new" : "changed")")
            if code.contains("BROKEN") { return .refused("not a mod") }
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
               "remove": ["a.com/gone", "a.com/never"], "later": ["b.com/busy"], "skipped": [["id": "all-sites/x", "why": "every-site mods stay on the phone for now"]]]
    pc.putErrors = ["a.com/both": "changed"]
    let original = st.files
    var got: Result<PhoneSync.Summary, PhoneSync.Failure>?
    PhoneSync(store: st, link: pc).run { got = $0 }
    wait { got != nil }
    guard case .success(let s)? = got else { say("FAIL no summary: \(String(describing: got))"); exit(1) }
    let begin = pc.sent.first!
    let man = begin["mods"] as! [[String: String]]
    expect(begin["t"] as? String == "sync.begin" && man.map { $0["id"]! } == original.keys.sorted() && man.allSatisfy { $0["rev"] == PhoneSync.rev(original[$0["id"]!]!) }, "begin: every mod with its rev, sorted")
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
    expect(s.later == ["b.com/busy"] && s.skipped.first?.id == "all-sites/x", "later and skipped")
    expect(s.waitingThere.first?.name == "Up", "waiting there")
    let have = (pc.sent.last!["have"] as! [[String: String]])
    let haveIds = have.map { $0["id"]! }
    expect(!haveIds.contains("a.com/missing") && !haveIds.contains("a.com/gone") && !haveIds.contains("a.com/stale") && !haveIds.contains("a.com/never"), "have: only what the phone has: \(haveIds)")
    expect(have.allSatisfy { $0["rev"] == PhoneSync.rev(st.files[$0["id"]!]!) } && haveIds.contains("a.com/bad") && haveIds.contains("a.com/up"), "have: the revisions now (a refused one its old)")

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
    let sch = PhoneSync.Scheduler(changeDelay: 0.05, files: { st.files }, sync: { runs += 1; finish = $0 })
    var reasons: [String] = []
    sch.finished = { _, why in reasons.append(why) }
    sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 0, "no sync yet this launch: a change waits for the first")
    sch.now("front"); sch.now("nudge"); sch.now("now")
    expect(runs == 1 && sch.running, "one at a time")
    finish?(.success(.init())); wait { runs == 2 }
    expect(runs == 2 && reasons == ["front"], "what came during one runs once after it: \(runs) \(reasons)")
    finish?(.success(.init())); RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    expect(reasons == ["front", "nudge"] && !sch.running, "then idle: \(reasons)")
    sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 2, "a change that leaves every file as the last sync did (a switch) is no sync")
    st.files["a.com/up"] = "// up v3"; sch.changed(); sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 3, "a file changed: one sync after the delay: \(runs)")
    finish?(.failure(.init(code: "notFound", message: ""))); RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    st.files["a.com/up"] = "// up v4"; sch.changed(); RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    expect(runs == 4, "after a failed sync the change rule still compares with the last good one")
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
//   quit
// and prints: "paired <name>", "hello <name> agent <agent> pending <n>", "started" or "error <code>", "event <n> <kind>
// <what>", "tool <tool> <input JSON, code cut to its first line>" (answered at once: canned words, a JPEG), "result
// <mod ids> removed <n>", "state <state>", "lost <code>".
if args.count > 3, args[1] == "remote", let port = NWEndpoint.Port(args[2]), let code = PairCode.parse(args[3]) {
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
