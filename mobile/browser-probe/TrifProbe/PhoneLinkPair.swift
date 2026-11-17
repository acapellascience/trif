import Foundation
import Network
import Security

// The phone link's pairing, the phone's side (docs/PHONE-LINK.md section 3 on branch phone-link). No UI here, so
// mobile/test/phonelink.test.js builds it for the Mac too; the screen is PhoneLinkView.swift.
//
// - PairCode: the text of desktop TRIF's QR code, `trif://pair?v=1&k=<key>&s=<secret>&n=<name>` (base64url key of
//   32 bytes and secret of 16; `n` may end in "…", cut by the helper's `qrName`). Anything else is not a code.
// - PhoneLinkKeys: the phone's private key and the paired computer (its public key, name, when), in the Keychain
//   (service "TRIF phone link", this device only: never in a backup or iCloud Keychain). One computer in version 1:
//   pairing with another replaces it. The phone's key stays across pairings.
// - PhoneLinkPairer: finds the code's computer (Bonjour, records whose TXT `id` is its key's), connects with the
//   secret in the first message, and keeps the computer once the handshake's answer decrypts (only the holder of
//   the code's key can make it). Then the app's `hello`, for the computer's own name, and the connection closes.
//   Every step has a time limit; the end is one of section 8's states.

/// The QR code's text, read with nothing taken on trust.
struct PairCode: Equatable {
    let computerKey: Data
    let secret: String // (sent as the code has it: the helper compares the text)
    let name: String
    var computerId: String { PhoneLink.keyId(computerKey) }

    static let secretLength = 16
    static let fallbackName = "your computer"

    static func parse(_ text: String) -> PairCode? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.utf8.count <= 1024, let c = URLComponents(string: t), c.scheme?.lowercased() == "trif",
              c.host?.lowercased() == "pair", c.user == nil, c.port == nil, c.path.isEmpty || c.path == "/" else { return nil }
        var q: [String: String] = [:]
        for item in c.queryItems ?? [] {
            if q[item.name] != nil { return nil } // (a name twice: not the helper's code)
            q[item.name] = item.value ?? ""
        }
        guard q["v"] == "1", let k = q["k"].flatMap(base64url), k.count == PhoneLink.keyLength,
              let s = q["s"], let sd = base64url(s), sd.count == secretLength else { return nil }
        return PairCode(computerKey: k, secret: s, name: cleanName(q["n"] ?? ""))
    }

    /// Base64url without padding (what the helper writes); nil for anything else.
    static func base64url(_ s: String) -> Data? {
        guard !s.isEmpty, s.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        return Data(base64Encoded: b)
    }

    /// A name for the screen: no control characters, at most 63 characters, never empty.
    static func cleanName(_ s: String) -> String {
        let kept = String(String.UnicodeScalarView(s.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && $0.properties.generalCategory != .format }))
            .trimmingCharacters(in: .whitespaces)
        let cut = String(kept.prefix(63))
        return cut.isEmpty ? fallbackName : cut
    }
}

// MARK: Keys

/// Where the keys live: the Keychain in the app, memory in the Mac test.
protocol PhoneLinkVault: AnyObject {
    func read(_ account: String) -> Data?
    func write(_ account: String, _ data: Data) -> Bool
    func delete(_ account: String)
}

/// The Keychain, service "TRIF phone link": after the first unlock (a run's result can be picked up with the
/// phone locked), this device only, never synced.
final class KeychainVault: PhoneLinkVault {
    static let service = "TRIF phone link"
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }
    func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }
    func write(_ account: String, _ data: Data) -> Bool {
        SecItemDelete(query(account) as CFDictionary)
        var q = query(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
    func delete(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}

final class MemoryVault: PhoneLinkVault {
    private var items: [String: Data] = [:]
    func read(_ account: String) -> Data? { items[account] }
    func write(_ account: String, _ data: Data) -> Bool { items[account] = data; return true }
    func delete(_ account: String) { items[account] = nil }
}

/// The computer this phone is paired with.
struct PairedComputer: Codable, Equatable {
    let key: Data
    var name: String
    let pairedAt: Date
    var id: String { PhoneLink.keyId(key) }
}

final class PhoneLinkKeys {
    static let shared = PhoneLinkKeys(vault: KeychainVault())
    static let phoneAccount = "phone"
    static let computerAccount = "computer"
    let vault: PhoneLinkVault

    init(vault: PhoneLinkVault) { self.vault = vault }

    /// The phone's private key, made the first time; nil when the Keychain won't keep one.
    func phoneKey() -> Data? {
        if let k = vault.read(Self.phoneAccount), (try? PhoneLink.publicKey(of: k)) != nil { return k }
        let k = PhoneLink.newKeyPair().privateKey
        guard vault.write(Self.phoneAccount, k), vault.read(Self.phoneAccount) == k else { return nil }
        return k
    }

    /// The paired computer, or nil (none, or a record that doesn't read).
    var computer: PairedComputer? {
        guard let d = vault.read(Self.computerAccount), let c = try? JSONDecoder().decode(PairedComputer.self, from: d),
              c.key.count == PhoneLink.keyLength else { return nil }
        return c
    }

    func save(_ c: PairedComputer) -> Bool {
        guard let d = try? JSONEncoder().encode(c) else { return false }
        return vault.write(Self.computerAccount, d)
    }

    /// Forgets the computer on this phone (the computer lists the phone until it is removed there).
    func forget() { vault.delete(Self.computerAccount) }
}

// MARK: Pairing

final class PhoneLinkPairer {
    enum Failure: Equatable {
        /// No record of the code's computer in 5 s, or none that answered (section 8: asleep, off, another Wi-Fi…).
        case notFound
        /// A record answered and closed with nothing said: the code was used, cancelled, or its 5 minutes are up.
        case refused
        /// iOS's Local Network permission is off.
        case denied
        /// The answer didn't decrypt: not the computer the code named.
        case broken
        /// The Keychain wouldn't keep a key.
        case keychain
        /// The encryption's self-test failed on this phone: never connect.
        case selfTest
    }
    enum Step: Equatable { case finding, connecting, paired(String), failed(Failure) }

    static let findSeconds = 5.0
    static let helloSeconds = 5.0
    private static var selfTestResult: String?? // (run once)

    let code: PairCode
    private let keys: PhoneLinkKeys
    private let phoneName: String
    private let device: [String: Any]
    private let queue: DispatchQueue
    private let fixed: [NWEndpoint]? // (development and the Mac test: these endpoints instead of Bonjour)
    private var browser: PhoneLinkBrowser?
    private var session: PhoneLinkSession?
    private var tried: [NWEndpoint] = []
    private var waiting: [NWEndpoint] = []
    private var sawRefused = false, sawBroken = false
    private var timer: DispatchWorkItem?
    private var finished = false
    private var privateKey = Data()
    private(set) var step = Step.finding { didSet { onStep?(step) } }
    var onStep: ((Step) -> Void)?

    /// phoneName: what the computer lists (`hello`'s name); device: the app hello's `device` ({name, width, height}).
    init(code: PairCode, keys: PhoneLinkKeys = .shared, phoneName: String, device: [String: Any] = [:],
         endpoints: [NWEndpoint]? = nil, queue: DispatchQueue = .main) {
        self.code = code; self.keys = keys; self.phoneName = phoneName; self.device = device
        self.fixed = endpoints; self.queue = queue
    }

    func start() {
        if Self.selfTestResult == nil { Self.selfTestResult = .some(PhoneLink.selfTest()) }
        if case .some(.some) = Self.selfTestResult { return fail(.selfTest) }
        guard let k = keys.phoneKey() else { return fail(.keychain) }
        privateKey = k
        step = .finding
        if let fixed {
            waiting = fixed
            next()
            return
        }
        let b = PhoneLinkBrowser(queue: queue)
        b.onChange = { [weak self] records, state in
            guard let self, !self.finished else { return }
            if state == .denied { return self.fail(.denied) }
            for r in PhoneLinkBrowser.candidates(records, computerId: self.code.computerId)
            where !self.tried.contains(r.endpoint) && !self.waiting.contains(r.endpoint) { self.waiting.append(r.endpoint) }
            if self.session == nil { self.next() }
        }
        browser = b
        b.start()
        arm(Self.findSeconds) { [weak self] in
            guard let self, self.session == nil else { return }
            self.fail(self.sawBroken ? .broken : self.sawRefused ? .refused : .notFound)
        }
    }

    func cancel() {
        guard !finished else { return }
        finished = true
        stopAll()
    }

    /// Tries the next record, or ends when there is none left and the search is over.
    private func next() {
        guard !finished, session == nil else { return }
        guard !waiting.isEmpty else {
            // (Bonjour: wait for more records until the 5 s are up, unless every record so far refused)
            if fixed != nil || !tried.isEmpty && timer == nil { fail(sawBroken ? .broken : sawRefused ? .refused : .notFound) }
            return
        }
        let endpoint = waiting.removeFirst()
        tried.append(endpoint)
        let hello: [String: Any] = ["v": 1, "name": phoneName, "pair": code.secret]
        guard let s = try? PhoneLinkSession(endpoint: endpoint, privateKey: privateKey, computerKey: code.computerKey,
                                            hello: hello, queue: queue) else { return fail(.broken) }
        session = s
        step = .connecting
        s.onOpen = { [weak self] payload in self?.opened(payload) }
        s.onMessage = { [weak self] m in self?.message(m) }
        s.onEnd = { [weak self] why in self?.ended(why) }
        s.start()
    }

    private var openedName: String?

    private func opened(_ payload: [String: Any]) {
        // (The answer decrypted: only the code's computer could write it. Kept now, so a lost `hello` answer
        // still leaves the phone paired, as the computer has it.)
        let name = (payload["name"] as? String).map(PairCode.cleanName) ?? code.name
        guard keys.save(PairedComputer(key: code.computerKey, name: name, pairedAt: Date())) else { return fail(.keychain) }
        openedName = name
        timer?.cancel(); timer = nil
        browser?.stop()
        session?.send(["t": "hello", "id": 1, "app": "TRIF", "device": device])
        arm(Self.helloSeconds) { [weak self] in self?.succeed(name) }
    }

    private func message(_ m: [String: Any]) {
        guard m["t"] as? String == "hello", let named = m["name"] as? String, var c = keys.computer, c.id == code.computerId else { return }
        c.name = PairCode.cleanName(named)
        _ = keys.save(c)
        succeed(c.name)
    }

    private func ended(_ why: PhoneLinkSession.End) {
        guard !finished else { return }
        session = nil
        if let name = openedName { return succeed(name) } // (closed after the answer: paired all the same)
        switch why {
        case .refused: sawRefused = true
        case .broken: sawBroken = true
        default: break
        }
        next()
    }

    private func succeed(_ name: String) {
        guard !finished else { return }
        finished = true
        stopAll()
        step = .paired(name)
    }

    private func fail(_ f: Failure) {
        guard !finished else { return }
        finished = true
        stopAll()
        step = .failed(f)
    }

    private func stopAll() {
        timer?.cancel(); timer = nil
        browser?.stop(); browser = nil
        let s = session
        session = nil
        s?.onEnd = nil
        s?.close()
    }

    private func arm(_ seconds: Double, _ f: @escaping () -> Void) {
        timer?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.timer = nil; f() }
        timer = w
        queue.asyncAfter(deadline: .now() + seconds, execute: w)
    }
}
