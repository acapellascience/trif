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
