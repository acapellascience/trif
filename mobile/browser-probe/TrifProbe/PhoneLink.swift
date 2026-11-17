import CryptoKit
import Foundation
import Network

// The phone link, the phone's side: the More chat's "My computer" engine talks to TRIF on the user's computer
// over Wi-Fi. The design and the wire are docs/PHONE-LINK.md on branch phone-link; the computer's side is
// helper/lib/phonelink/ there (noise.js, frames.js, server.js, bonjour.js). This file is the same wire in CryptoKit
// and Network, and nothing else (no dependency):
//
// - NoiseInitiator: Noise_IK_25519_ChaChaPoly_SHA256, prologue "TRIF phone link 1". The phone is always the
//   initiator: it knows the computer's key from the QR code, so its own key and the pairing secret go encrypted
//   in its first message. `PhoneLink.selfTest()` runs the published vector (cacophony's, the one the helper's
//   tests use) through it: the two sides agree on every byte.
// - Frames: every Noise message on the TCP connection has a 2-byte big-endian length before it. After the
//   handshake an application message (one JSON object, at most 8 MB) travels as pieces, one per transport
//   message: a first byte (0 more follows, 1 the last piece), then the piece.
// - PhoneLinkBrowser: NWBrowser on `_trif._tcp`; a record's TXT `id` is the first 8 bytes of SHA-256 of the
//   computer's key, hex. Every record with the paired computer's id is a candidate (a killed helper can leave a
//   stale one behind), tried in turn.
// - PhoneLinkSession: one connection: the handshake, then JSON messages both ways. It ends with a reason that maps
//   onto PHONE-LINK.md section 8's states; it never waits without a time limit.
//
// Keys are 32-byte Data, as X25519 has them. Nothing here keeps keys (the Keychain is the pairing step's) or logs
// them.

enum PhoneLink {
    static let protocolName = "Noise_IK_25519_ChaChaPoly_SHA256"
    static let prologue = Data("TRIF phone link 1".utf8)
    static let serviceType = "_trif._tcp"
    static let keyLength = 32
    static let tagLength = 16
    static let maxMessage = 65535
    static let maxJSON = 8 * 1024 * 1024
    /// What fits in one transport message beside the first byte.
    static let piece = maxMessage - tagLength - 1

    enum Failure: Error, Equatable {
        case badKey, shortMessage, badMessage, notMyTurn, notDone, tooBig, badPiece, notAMessage, tooManyMessages
    }

    /// A key's short id: the first 8 bytes of its SHA-256, hex (the Bonjour record's `id`, a paired phone's `id`).
    static func keyId(_ publicKey: Data) -> String {
        SHA256.hash(data: publicKey).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// A new key pair: (privateKey, publicKey), 32 bytes each.
    static func newKeyPair() -> (privateKey: Data, publicKey: Data) {
        let k = Curve25519.KeyAgreement.PrivateKey()
        return (k.rawRepresentation, k.publicKey.rawRepresentation)
    }

    static func publicKey(of privateKey: Data) throws -> Data {
        guard privateKey.count == keyLength else { throw Failure.badKey }
        return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey).publicKey.rawRepresentation
    }

    /// DH. Throws on a key that gives an all-zero secret (a low-order point), as the helper does.
    static func dh(_ privateKey: Data, _ publicKey: Data) throws -> Data {
        guard privateKey.count == keyLength, publicKey.count == keyLength else { throw Failure.badKey }
        let secret = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
            .sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey))
        let out = secret.withUnsafeBytes { Data($0) }
        guard out.count == keyLength, out.contains(where: { $0 != 0 }) else { throw Failure.badKey }
        return out
    }

    static func hash(_ parts: Data...) -> Data {
        var h = SHA256()
        for p in parts { h.update(data: p) }
        return Data(h.finalize())
    }

    static func hmac(_ key: Data, _ parts: Data...) -> Data {
        var h = HMAC<SHA256>(key: SymmetricKey(data: key))
        for p in parts { h.update(data: p) }
        return Data(h.finalize())
    }

    /// Noise's HKDF, two outputs.
    static func hkdf2(_ chainingKey: Data, _ input: Data) -> (Data, Data) {
        let temp = hmac(chainingKey, input)
        let out1 = hmac(temp, Data([1]))
        let out2 = hmac(temp, out1, Data([2]))
        return (out1, out2)
    }

    // MARK: Frames

    /// A Noise message with its length before it.
    static func packet(_ message: Data) throws -> Data {
        guard message.count <= maxMessage else { throw Failure.tooBig }
        return Data([UInt8(message.count >> 8), UInt8(message.count & 0xff)]) + message
    }

    /// JSON bytes as packets ready to write, encrypted with this side's `send` cipher, in order.
    static func seal(_ cipher: inout NoiseCipher, json: Data) throws -> [Data] {
        guard json.count <= maxJSON else { throw Failure.tooBig }
        let bytes = [UInt8](json)
        var out: [Data] = []
        var at = 0
        repeat {
            let end = min(at + piece, bytes.count)
            let last = end >= bytes.count
            let plain = Data([last ? 1 : 0]) + Data(bytes[at..<end])
            out.append(try packet(try cipher.encrypt(Data(), plain)))
            at = end
        } while at < bytes.count
        return out
    }

    static func seal(_ cipher: inout NoiseCipher, _ message: [String: Any]) throws -> [Data] {
        try seal(&cipher, json: try JSONSerialization.data(withJSONObject: message))
    }

    // MARK: Self-test

    /// The published vector for Noise_IK_25519_ChaChaPoly_SHA256 (cacophony's, as in the helper's
    /// tests/phone-link-noise.test.js), and a frames vector the helper's frames.js made. nil when every byte
    /// matches, else what didn't. The link is never used when this fails.
    static func selfTest() -> String? {
        func hex(_ s: String) -> Data {
            var d = Data()
            var i = s.startIndex
            while i < s.endIndex { let j = s.index(i, offsetBy: 2); d.append(UInt8(s[i..<j], radix: 16)!); i = j }
            return d
        }
        func toHex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
        do {
            let initStatic = hex("e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1")
            let respPublic = try publicKey(of: hex("4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893"))
            guard toHex(respPublic) == "31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62" else { return "the responder's public key" }
            let hs = try NoiseInitiator(privateKey: initStatic, computerKey: respPublic, prologue: hex("4a6f686e2047616c74"),
                                        ephemeral: hex("893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a"))
            let m = [
                ("4c756477696720766f6e204d69736573", "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944718da798efbcd91528520204f904b9bd6c7413dccdc214d951e15253e39987f18146e8cd0873654207148333479d4d16c289f0294b29960a72f48e0b7bba2e89083169825e59642148d492020664ccf7"),
                ("4d757272617920526f746862617264", "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088435361e70b2ed446e6c9ec387d1d6b3b840f194e373979d241b203c4acafccf5"),
                ("462e20412e20486179656b", "050e9f3c8fac16b68dbce8f8c4bfbf6617c897f9ada4aa29aa19c8"),
                ("4361726c204d656e676572", "344233a6cabb7141d80f3da2fedc311d9646bbb0f505afe403a667"),
                ("4a65616e2d426170746973746520536179", "62cdeeb172ad7ade7aa7d9e069da5790f12331bfa00177787a1d0810c67dc3b2b4"),
                ("457567656e2042f6686d20766f6e2042617765726b", "029bead1b40992327044d409d9a1f3ad8f36c3c452775d557e18bbeb2e8dfcead32d514024"),
            ]
            guard toHex(try hs.writeMessage(hex(m[0].0))) == m[0].1 else { return "message 1" }
            guard toHex(try hs.readMessage(hex(m[1].1))) == m[1].0 else { return "message 2" }
            guard toHex(hs.handshakeHash) == "0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7" else { return "the handshake hash" }
            var (send, receive) = try hs.split()
            for (n, (plain, cipher)) in m.dropFirst(2).enumerated() {
                if n % 2 == 0 {
                    guard toHex(try send.encrypt(Data(), hex(plain))) == cipher else { return "transport message \(n + 1)" }
                } else {
                    guard toHex(try receive.decrypt(Data(), hex(cipher))) == plain else { return "transport message \(n + 1)" }
                }
            }
            // frames.js's seal(new CipherState(<32 bytes 0x01…0x20>), {t: "ping"}), and the same read back
            var key = NoiseCipher(key: Data(1...32))
            let sealed = try seal(&key, json: Data(#"{"t":"ping"}"#.utf8))
            guard sealed.count == 1, toHex(sealed[0]) == framesVector else { return "frames" }
            var reader = PacketReader()
            var assembler = Assembler(cipher: NoiseCipher(key: Data(1...32)))
            let back = reader.push(sealed[0].prefix(5)) + reader.push(sealed[0].dropFirst(5))
            guard back.count == 1, let obj = try assembler.push(back[0]), obj["t"] as? String == "ping" else { return "frames read back" }
            return nil
        } catch {
            return "threw \(error)"
        }
    }

    /// Made by the helper's frames.js (see selfTest).
    static let framesVector = "001d62f1f56245f88b49f2255172ea59e4372cb5830affbe2f17f8cf18d482"
}

/// One direction's cipher after the handshake (and the handshake's own, inside the symmetric state).
struct NoiseCipher {
    private(set) var key: SymmetricKey?
    private(set) var n: UInt64 = 0
    static let maxNonce: UInt64 = 1 << 48 // (as the helper's: far below Noise's 2^64-1; a link never gets there)

    init(key: Data? = nil) { self.key = key.map { SymmetricKey(data: $0) } }

    private func nonce() throws -> ChaChaPoly.Nonce {
        var b = Data(count: 4)
        withUnsafeBytes(of: n.littleEndian) { b.append(contentsOf: $0) }
        return try ChaChaPoly.Nonce(data: b)
    }

    mutating func encrypt(_ ad: Data, _ plaintext: Data) throws -> Data {
        guard let key else { return plaintext }
        guard n < Self.maxNonce else { throw PhoneLink.Failure.tooManyMessages }
        let box = try ChaChaPoly.seal(plaintext, using: key, nonce: try nonce(), authenticating: ad)
        n += 1
        return box.ciphertext + box.tag
    }

    /// Throws on a message that doesn't check; the nonce moves only on one that does.
    mutating func decrypt(_ ad: Data, _ ciphertext: Data) throws -> Data {
        guard let key else { return ciphertext }
        guard n < Self.maxNonce else { throw PhoneLink.Failure.tooManyMessages }
        guard ciphertext.count >= PhoneLink.tagLength else { throw PhoneLink.Failure.shortMessage }
        let c = Data(ciphertext)
        let box = try ChaChaPoly.SealedBox(nonce: try nonce(), ciphertext: c.prefix(c.count - PhoneLink.tagLength),
                                           tag: c.suffix(PhoneLink.tagLength))
        let out = try ChaChaPoly.open(box, using: key, authenticating: ad)
        n += 1
        return out
    }
}

/// The phone's side of the IK handshake: writeMessage(payload) → message 1; readMessage(message 2) → the
/// computer's payload; then split() → this side's ciphers.
final class NoiseInitiator {
    private var h: Data
    private var ck: Data
    private var cipher = NoiseCipher()
    private let s: Data, sPublic: Data, rs: Data
    private var e: Data?
    private var step = 0

    var handshakeHash: Data { h }

    /// privateKey: the phone's; computerKey: the computer's public key (from the QR); ephemeral: for tests only.
    init(privateKey: Data, computerKey: Data, prologue: Data = PhoneLink.prologue, ephemeral: Data? = nil) throws {
        guard computerKey.count == PhoneLink.keyLength else { throw PhoneLink.Failure.badKey }
        s = privateKey
        sPublic = try PhoneLink.publicKey(of: privateKey)
        rs = computerKey
        e = ephemeral
        let name = Data(PhoneLink.protocolName.utf8)
        h = name.count <= 32 ? name + Data(count: 32 - name.count) : PhoneLink.hash(name)
        ck = h
        mixHash(prologue)
        mixHash(computerKey) // (IK's pre-message: the responder's static key)
    }

    private func mixHash(_ d: Data) { h = PhoneLink.hash(h, d) }
    private func mixKey(_ input: Data) { let (a, b) = PhoneLink.hkdf2(ck, input); ck = a; cipher = NoiseCipher(key: b) }
    private func encryptAndHash(_ p: Data) throws -> Data { let c = try cipher.encrypt(h, p); mixHash(c); return c }
    private func decryptAndHash(_ c: Data) throws -> Data { let p = try cipher.decrypt(h, c); mixHash(c); return p }

    /// -> e, es, s, ss, and the payload encrypted.
    func writeMessage(_ payload: Data = Data()) throws -> Data {
        guard step == 0 else { throw PhoneLink.Failure.notMyTurn }
        let ePrivate = e ?? PhoneLink.newKeyPair().privateKey
        e = ePrivate
        let ePublic = try PhoneLink.publicKey(of: ePrivate)
        mixHash(ePublic)
        mixKey(try PhoneLink.dh(ePrivate, rs)) // es
        let sCipher = try encryptAndHash(sPublic) // s
        mixKey(try PhoneLink.dh(s, rs)) // ss
        let out = ePublic + sCipher + (try encryptAndHash(payload))
        guard out.count <= PhoneLink.maxMessage else { throw PhoneLink.Failure.tooBig }
        step = 1
        return out
    }

    /// <- e, ee, se, and the computer's payload.
    func readMessage(_ message: Data) throws -> Data {
        guard step == 1, let e else { throw PhoneLink.Failure.notMyTurn }
        guard message.count <= PhoneLink.maxMessage else { throw PhoneLink.Failure.badMessage }
        guard message.count >= PhoneLink.keyLength else { throw PhoneLink.Failure.shortMessage }
        let m = Data(message)
        let re = m.prefix(PhoneLink.keyLength)
        mixHash(re)
        mixKey(try PhoneLink.dh(e, re)) // ee
        mixKey(try PhoneLink.dh(s, re)) // se
        let payload = try decryptAndHash(m.dropFirst(PhoneLink.keyLength))
        step = 2
        return payload
    }

    func split() throws -> (send: NoiseCipher, receive: NoiseCipher) {
        guard step == 2 else { throw PhoneLink.Failure.notDone }
        let (k1, k2) = PhoneLink.hkdf2(ck, Data()) // (k1: initiator → responder)
        return (NoiseCipher(key: k1), NoiseCipher(key: k2))
    }
}

/// The stream cut back into Noise messages: push(chunk) → [message, …].
struct PacketReader {
    private var buf = Data()
    var waiting: Int { buf.count }

    mutating func push(_ chunk: Data) -> [Data] {
        buf.append(chunk)
        var out: [Data] = []
        while buf.count >= 2 {
            let s = buf.startIndex
            let len = Int(buf[s]) << 8 | Int(buf[s + 1])
            guard buf.count >= 2 + len else { break }
            out.append(Data(buf[(s + 2)..<(s + 2 + len)]))
            buf = Data(buf[(s + 2 + len)...])
        }
        return out
    }
}

/// Decrypted pieces back into objects: push(noiseMessage) → the object when its last piece came, else nil.
/// Throws on a piece that doesn't decrypt, a first byte that's neither, more than 8 MB, or JSON that isn't an
/// object: the caller closes the connection.
struct Assembler {
    var cipher: NoiseCipher
    var max = PhoneLink.maxJSON
    private var parts = Data()

    init(cipher: NoiseCipher) { self.cipher = cipher }

    mutating func push(_ message: Data) throws -> [String: Any]? {
        let plain = try cipher.decrypt(Data(), message)
        guard let first = plain.first, first == 0 || first == 1 else { throw PhoneLink.Failure.badPiece }
        guard parts.count + plain.count - 1 <= max else { throw PhoneLink.Failure.tooBig }
        parts.append(plain.dropFirst())
        if first == 0 { return nil }
        let json = parts
        parts = Data()
        guard let obj = try JSONSerialization.jsonObject(with: json) as? [String: Any] else { throw PhoneLink.Failure.notAMessage }
        return obj
    }
}

// MARK: Finding the computer

/// NWBrowser on `_trif._tcp`. `onChange` gets every record seen (on `queue`) and the browser's state. Needs the
/// Local Network permission and `_trif._tcp` in Info.plist's NSBonjourServices: without them the state is
/// `.denied` (iOS answers the browse with a policy error).
final class PhoneLinkBrowser {
    struct Record: Hashable {
        let name: String
        let id: String? // (TXT `id`: the computer's key id)
        let version: String? // (TXT `v`)
        let endpoint: NWEndpoint
    }

    enum State: Equatable { case starting, browsing, denied, failed(String), stopped }

    private var browser: NWBrowser?
    private let queue: DispatchQueue
    private(set) var records: [Record] = []
    private(set) var state = State.starting
    var onChange: (([Record], State) -> Void)?

    init(queue: DispatchQueue = .main) { self.queue = queue }

    /// The records for a paired computer (its key's id), in the order seen.
    static func candidates(_ records: [Record], computerId: String) -> [Record] {
        records.filter { $0.id?.lowercased() == computerId.lowercased() }
    }

    func start() {
        stop()
        state = .starting
        let params = NWParameters.tcp
        params.includePeerToPeer = false // (Wi-Fi only in version 1)
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: PhoneLink.serviceType, domain: nil), using: params)
        b.stateUpdateHandler = { [weak self] s in
            guard let self, self.browser === b else { return }
            switch s {
            case .ready: self.state = .browsing
            case .failed(let err), .waiting(let err): self.state = Self.isDenied(err) ? .denied : .failed("\(err)")
            case .cancelled: self.state = .stopped
            default: return
            }
            self.onChange?(self.records, self.state)
        }
        b.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self, self.browser === b else { return }
            self.records = results.compactMap(Self.record)
            self.onChange?(self.records, self.state)
        }
        browser = b
        b.start(queue: queue)
    }

    func stop() {
        browser?.cancel()
        browser = nil
        records = []
        state = .stopped
    }

    static func record(_ r: NWBrowser.Result) -> Record? {
        guard case let .service(name, _, _, _) = r.endpoint else { return nil }
        var id: String?, v: String?
        if case let .bonjour(txt) = r.metadata { id = txt["id"]; v = txt["v"] }
        return Record(name: name, id: id, version: v, endpoint: r.endpoint)
    }

    static func isDenied(_ err: NWError) -> Bool {
        if case let .dns(code) = err { return code == -65570 } // (kDNSServiceErr_PolicyDenied)
        return false
    }
}

// MARK: One connection

/// One connection to the computer: the handshake, then JSON messages both ways. Callbacks come on `queue`.
/// `onOpen` gets the computer's handshake payload (`{v, name, paired}`); `onEnd` comes once, with the reason.
final class PhoneLinkSession {
    enum End: Equatable {
        /// The connection didn't open, or opened and got no answer in time: the computer wasn't found (section 8:
        /// asleep, off, another Wi-Fi, TRIF not running). Try the next record first.
        case unreachable(String)
        /// Connected, the first message sent, closed with no answer: this phone isn't paired there any more
        /// (removed, the link turned off, or a wrong pairing secret).
        case refused
        /// Open, then lost (the app is suspended, the Wi-Fi changed): reconnect and `run.resume`.
        case dropped(String)
        /// Something on the wire that doesn't read (a bad tag, a piece too big): closed by the phone.
        case broken(String)
        /// close() was called.
        case closed
    }

    static let connectSeconds = 5.0 // (section 8: the connection fails or times out in 5 s)
    static let answerSeconds = 5.0

    private let connection: NWConnection
    private let queue: DispatchQueue
    private var handshake: NoiseInitiator?
    private var send: NoiseCipher?
    private var assembler: Assembler?
    private var reader = PacketReader()
    private var firstSent = false
    private var ended = false
    private var timer: DispatchWorkItem?

    var onOpen: (([String: Any]) -> Void)?
    var onMessage: (([String: Any]) -> Void)?
    var onEnd: ((End) -> Void)?
    private(set) var isOpen = false

    /// privateKey: the phone's; computerKey: the computer's public key; hello: the first message's payload
    /// (`{v: 1, name, pair?}`).
    init(endpoint: NWEndpoint, privateKey: Data, computerKey: Data, hello: [String: Any], queue: DispatchQueue = .main) throws {
        let params = NWParameters.tcp
        params.includePeerToPeer = false
        connection = NWConnection(to: endpoint, using: params)
        self.queue = queue
        handshake = try NoiseInitiator(privateKey: privateKey, computerKey: computerKey)
        firstMessage = try handshake!.writeMessage(try JSONSerialization.data(withJSONObject: hello))
    }

    private let firstMessage: Data

    func start() {
        arm(Self.connectSeconds) { [weak self] in self?.end(.unreachable("no connection in \(Int(Self.connectSeconds)) s")) }
        connection.stateUpdateHandler = { [weak self] s in
            guard let self, !self.ended else { return }
            switch s {
            case .ready: self.opened()
            case .failed(let err): self.lost("\(err)")
            case .waiting(let err): if !self.firstSent { self.end(.unreachable("\(err)")) }
            default: break
            }
        }
        connection.start(queue: queue)
    }

    private func opened() {
        firstSent = true
        guard let p = try? PhoneLink.packet(firstMessage) else { return end(.broken("first message")) }
        connection.send(content: p, completion: .contentProcessed { [weak self] err in if let err { self?.lost("\(err)") } })
        arm(Self.answerSeconds) { [weak self] in self?.end(.unreachable("no answer in \(Int(Self.answerSeconds)) s")) }
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, err in
            guard let self, !self.ended else { return }
            if let data, !data.isEmpty {
                for m in self.reader.push(data) { self.handle(m); if self.ended { return } }
            }
            if let err { return self.lost("\(err)") }
            if complete { return self.lost("closed by the computer") }
            self.receive()
        }
    }

    private func handle(_ message: Data) {
        do {
            if let hs = handshake {
                let payload = try hs.readMessage(message)
                let (s, r) = try hs.split()
                handshake = nil
                send = s
                assembler = Assembler(cipher: r)
                timer?.cancel()
                isOpen = true
                onOpen?((try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] ?? [:])
            } else if let obj = try assembler?.push(message) {
                onMessage?(obj)
            }
        } catch {
            end(.broken("\(error)"))
        }
    }

    /// Sends one message; false when the session isn't open or the message is too big.
    @discardableResult
    func send(_ message: [String: Any]) -> Bool {
        guard isOpen, !ended, var cipher = send, let packets = try? PhoneLink.seal(&cipher, message) else { return false }
        send = cipher
        for p in packets { connection.send(content: p, completion: .contentProcessed { [weak self] err in if let err { self?.lost("\(err)") } }) }
        return true
    }

    func close() { end(.closed) }

    private func lost(_ why: String) {
        if isOpen { end(.dropped(why)) } else if firstSent { end(.refused) } else { end(.unreachable(why)) }
    }

    private func arm(_ seconds: Double, _ f: @escaping () -> Void) {
        timer?.cancel()
        let w = DispatchWorkItem(block: f)
        timer = w
        queue.asyncAfter(deadline: .now() + seconds, execute: w)
    }

    private func end(_ why: End) {
        guard !ended else { return }
        ended = true
        isOpen = false
        timer?.cancel()
        connection.cancel()
        onEnd?(why)
    }
}
