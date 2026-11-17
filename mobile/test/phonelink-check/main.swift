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
