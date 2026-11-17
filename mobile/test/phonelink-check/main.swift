import Foundation
import Network

// mobile/test/phonelink.test.js builds this with ../../browser-probe/TrifProbe/PhoneLink.swift for the Mac:
//   check selftest                                  → "ok" or what didn't match
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
