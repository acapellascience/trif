import Foundation
import Network

// More's "My computer" engine, its link (step 14 of the phone link: docs/PHONE-LINK.md sections 4, 6 and 8 on branch
// phone-link). No UI here, so mobile/test/phonelink.test.js builds it for the Mac too; PanelChat.swift drives it.
//
// - connect: the paired computer (PhoneLinkKeys) found by Bonjour (records whose TXT `id` is its key's) or at fixed
//   endpoints, a session with no pairing secret, the app's `hello` at once (the computer wants a message within 5 s),
//   `ping` every 30 s. Every computer that answers nothing to the first message means this phone was removed there.
// - start: `run.start` with the page copy and a screenshot; the run is followed: its `run.event`s (numbered, each
//   handed on once, in order), its `tool.request`s (answered by `onTool`, at most once), its `run.result` (then
//   `run.ack`, so the computer forgets it).
// - The link drops (the app suspended, the Wi-Fi gone): `away`; it reconnects after `retry`'s waits, or at once on
//   wake() (the app back in front), and sends `run.resume` for each followed run from the last event it has. When
//   every wait is used up, the followed runs are given up (`onLost`): the computer keeps them, listed in `hello`'s
//   `pending`, which pickUp follows again (PanelChat does on the panel's start and when the app is back in front)
//   from the last event its chat already shows (`shown`, kept across launches in `defaults`).
// Callbacks come on `queue` (main by default).

final class PhoneLinkRemote: PhoneSyncLink {
    enum Failure: String, Error {
        /// No computer is paired.
        case notPaired
        /// No record of the paired computer in 5 s, or none that answered (section 8: asleep, off, another Wi-Fi, no
        /// browser with TRIF open there).
        case notFound
        /// The computer answered nothing to the first message: removed there, or its link turned off.
        case removed
        /// iOS's Local Network permission is off.
        case denied
        /// Something that doesn't read (an answer that doesn't decrypt, a broken message).
        case broken
        case keychain
        /// The encryption's self-test failed on this phone: never connect.
        case selfTest
    }
    enum State: Equatable { case idle, finding, open, away, failed(Failure) }
    struct Pending { let runId: String; let chat: String; let done: Bool; let last: Int }
    struct Hello { let name: String; let agent: String?; let model: String?; let pending: [Pending] }
    /// An answer of the computer's `error` (its `code`: busy, no-agent, too-big, bad-request, bad-url, no-run, failed;
    /// or one of Failure's, or `away`, `timeout`).
    struct RunError: Error { let code: String; let message: String }
    struct ToolAnswer { let text: String; let shot: Data?; let error: Bool }

    static let findSeconds = 5.0
    static let requestSeconds = 20.0
    static let pingSeconds = 30.0
    private static var selfTestResult: String?? // (run once)

    private let keys: PhoneLinkKeys
    private let phoneName: String
    private let device: [String: Any]
    private let app: String
    private let queue: DispatchQueue
    private let fixed: [NWEndpoint]?
    /// The waits before each reconnection after a drop (seconds); none left: the followed runs are given up.
    var retry: [Double] = [2, 4, 8, 15, 30, 30]

    private(set) var state = State.idle { didSet { if oldValue != state { onState?(state) } } }
    private(set) var hello: Hello?
    var onState: ((State) -> Void)?
    /// (runId, n, the run's event as the desktop panel gets it)
    var onEvent: ((String, Int, [String: Any]) -> Void)?
    /// (runId, the `run.result` message: `mods` [{id, name, code | tooBig}], `removed`)
    var onResult: ((String, [String: Any]) -> Void)?
    /// (runId, tool, input, answer): read_page {selector, limit}, try_mod {id, code}, screenshot {}. Answer once.
    var onTool: ((String, String, [String: Any], @escaping (ToolAnswer) -> Void) -> Void)?
    /// A followed run the computer doesn't have any more (`no-run`), or given up after the drop (`away`), or the
    /// phone removed there (`removed`).
    var onLost: ((String, RunError) -> Void)?

    /// The computer's `sync.changed`: a phone twin changed there (PhoneSync.swift: the phone syncs when ready).
    var onSyncChanged: (() -> Void)?

    /// The runs followed: runId → the newest event number handed on.
    private(set) var following: [String: Int] = [:]
    private var waiting: [(Result<Hello, Failure>) -> Void] = []
    private var answers: [Int: ([String: Any]) -> Void] = [:]
    private var nextId = 1
    private var session: PhoneLinkSession?
    private var browser: PhoneLinkBrowser?
    private var tried: [NWEndpoint] = []
    private var queued: [NWEndpoint] = []
    private var sawRefused = false, sawBroken = false
    private var findTimer: DispatchWorkItem?
    private var retryTimer: DispatchWorkItem?
    private var pingTimer: DispatchWorkItem?
    private var attempt = 0
    private var privateKey = Data()
    private var computer: PairedComputer?
    private let defaults: UserDefaults
    private static let shownKey = "phoneLink.shown"
    /// runId → the newest event handed on, kept across launches (a picked-up run's chat already shows those).
    private var shown: [String: Int] {
        get { defaults.dictionary(forKey: Self.shownKey) as? [String: Int] ?? [:] }
        set { defaults.set(newValue, forKey: Self.shownKey) }
    }
    private func forget(_ runId: String) { if shown[runId] != nil { shown[runId] = nil } }

    /// phoneName: the handshake's name; device: `hello`'s ({name, width, height}); endpoints: these instead of Bonjour
    /// (development and the Mac test).
    init(keys: PhoneLinkKeys = .shared, phoneName: String, device: [String: Any] = [:], app: String = "TRIF",
         endpoints: [NWEndpoint]? = nil, queue: DispatchQueue = .main, defaults: UserDefaults = .standard) {
        self.keys = keys; self.phoneName = phoneName; self.device = device; self.app = app
        self.fixed = endpoints; self.queue = queue; self.defaults = defaults
    }

    // MARK: what the engine asks

    /// The open link's `hello` answer, connecting first when needed.
    func connect(_ done: @escaping (Result<Hello, Failure>) -> Void) {
        if state == .open, let hello { return done(.success(hello)) }
        waiting.append(done)
        if state != .finding { find() }
    }

    /// `run.start`; the run is followed from its first event. done: the computer's runId, or why not.
    func start(url: String, prompt: String, page: String, shot: Data?, chat: String, session sid: String?, width: Int?,
               _ done: @escaping (Result<String, RunError>) -> Void) {
        connect { [weak self] r in
            guard let self else { return }
            if case .failure(let f) = r { return done(.failure(RunError(code: f.rawValue, message: "\(f)"))) }
            var m: [String: Any] = ["t": "run.start", "url": url, "prompt": prompt, "page": page, "chat": chat]
            if let shot { m["shot"] = shot.base64EncodedString() }
            if let sid, !sid.isEmpty { m["session"] = sid }
            if let width { m["width"] = width }
            self.request(m) { a in
                if a["t"] as? String == "run.started", let id = a["runId"] as? String {
                    self.following[id] = 0
                    done(.success(id))
                } else {
                    done(.failure(Self.error(a)))
                }
            }
        }
    }

    /// `run.stop` (the run's events still come, ending with its `done`).
    func stop(_ runId: String) {
        guard state == .open else { return }
        request(["t": "run.stop", "runId": runId]) { _ in }
    }

    /// A run the computer kept (`hello`'s `pending`: the app was closed meanwhile, or gave the run up after a drop),
    /// followed after the last event its chat shows (none: from its first): `run.resume`, then its events, its
    /// result, as a started run's.
    func pickUp(_ runId: String) {
        guard state == .open, following[runId] == nil else { return }
        let after = shown[runId] ?? 0
        following[runId] = after
        request(["t": "run.resume", "runId": runId, "after": after]) { [weak self] r in
            guard let self, r["t"] as? String == "error" else { return }
            let e = Self.error(r)
            guard e.code != "away", e.code != "timeout", self.following[runId] != nil else { return }
            self.following[runId] = nil
            self.forget(runId)
            self.onLost?(runId, e)
        }
    }

    /// No longer followed (its chat cleared): the computer still keeps it until acked.
    func unfollow(_ runId: String) { following[runId] = nil }

    /// A phone sync's request (PhoneSync.swift), connecting first when needed; a failure to connect is an `error`
    /// with Failure's code.
    func syncRequest(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        connect { [weak self] r in
            guard let self else { return }
            switch r {
            case .success: self.request(m, done)
            case .failure(let f): done(["t": "error", "code": f.rawValue, "message": "not connected"])
            }
        }
    }

    /// The app is in front again: reconnect at once if the link dropped.
    func wake() {
        guard state == .away || !following.isEmpty && state != .open && state != .finding else { return }
        retryTimer?.cancel(); retryTimer = nil
        attempt = 0
        find()
    }

    /// Closes the link and forgets the followed runs (the computer keeps them).
    func close() {
        following = [:]
        stopAll()
        failWaiting(.notFound)
        state = .idle
    }

    /// (tests) The connection lost as a suspended app loses it.
    func drop() {
        guard let s = session, state == .open else { return }
        s.onEnd = nil
        s.close()
        ended(.dropped("dropped by the app"))
    }

    // MARK: finding and connecting

    private func find() {
        stopAll()
        if Self.selfTestResult == nil { Self.selfTestResult = .some(PhoneLink.selfTest()) }
        if case .some(.some) = Self.selfTestResult { return fail(.selfTest) }
        guard let c = keys.computer else { return fail(.notPaired) }
        guard let k = keys.phoneKey() else { return fail(.keychain) }
        computer = c
        privateKey = k
        tried = []; queued = []; sawRefused = false; sawBroken = false
        state = .finding
        if let fixed {
            queued = fixed
            return next()
        }
        let b = PhoneLinkBrowser(queue: queue)
        b.onChange = { [weak self] records, st in
            guard let self, self.state == .finding, self.browser === b else { return }
            if st == .denied { return self.fail(.denied) }
            for r in PhoneLinkBrowser.candidates(records, computerId: c.id)
            where !self.tried.contains(r.endpoint) && !self.queued.contains(r.endpoint) { self.queued.append(r.endpoint) }
            if self.session == nil { self.next() }
        }
        browser = b
        b.start()
        let w = DispatchWorkItem { [weak self] in
            guard let self, self.state == .finding, self.session == nil else { return }
            self.fail(self.notFoundReason)
        }
        findTimer = w
        queue.asyncAfter(deadline: .now() + Self.findSeconds, execute: w)
    }

    private var notFoundReason: Failure { sawBroken ? .broken : sawRefused ? .removed : .notFound }

    private func next() {
        guard state == .finding, session == nil, let c = computer else { return }
        guard !queued.isEmpty else {
            // (Bonjour: more records may come until the 5 s are up)
            if fixed != nil || findTimer == nil { fail(notFoundReason) }
            return
        }
        let endpoint = queued.removeFirst()
        tried.append(endpoint)
        guard let s = try? PhoneLinkSession(endpoint: endpoint, privateKey: privateKey, computerKey: c.key,
                                            hello: ["v": 1, "name": phoneName], queue: queue) else { return fail(.broken) }
        session = s
        s.onOpen = { [weak self, weak s] _ in if let s { self?.opened(s) } }
        s.onMessage = { [weak self] m in self?.message(m) }
        s.onEnd = { [weak self, weak s] why in if let s, self?.session === s { self?.ended(why) } }
        s.start()
    }

    private func opened(_ s: PhoneLinkSession) {
        findTimer?.cancel(); findTimer = nil
        browser?.stop(); browser = nil
        request(["t": "hello", "app": app, "device": device]) { [weak self] a in
            guard let self, self.session === s else { return }
            guard a["t"] as? String == "hello" else { return self.broke() }
            let agent = a["agent"] as? [String: Any]
            let pending = (a["pending"] as? [[String: Any]] ?? []).compactMap { p -> Pending? in
                guard let id = p["runId"] as? String else { return nil }
                return Pending(runId: id, chat: p["chat"] as? String ?? "", done: p["done"] as? Bool ?? false, last: p["last"] as? Int ?? 0)
            }
            self.hello = Hello(name: (a["name"] as? String).map(PairCode.cleanName) ?? self.computer?.name ?? PairCode.fallbackName,
                               agent: agent?["name"] as? String, model: agent?["model"] as? String, pending: pending)
            // (the runs this computer no longer keeps aren't shown again)
            let kept = Set(pending.map(\.runId)).union(self.following.keys)
            if self.shown.keys.contains(where: { !kept.contains($0) }) { self.shown = self.shown.filter { kept.contains($0.key) } }
            self.attempt = 0
            self.state = .open
            self.ping()
            // (the runs followed before the drop: from the last event this app has)
            for (id, last) in self.following {
                self.request(["t": "run.resume", "runId": id, "after": last]) { [weak self] r in
                    guard let self, r["t"] as? String == "error" else { return }
                    let e = Self.error(r)
                    guard e.code != "away", e.code != "timeout", self.following[id] != nil else { return } // (asked again on the next connection)
                    self.following[id] = nil
                    self.forget(id)
                    self.onLost?(id, e)
                }
            }
            let w = self.waiting
            self.waiting = []
            for f in w { f(.success(self.hello!)) }
        }
    }

    private func broke() {
        sawBroken = true
        let s = session
        session = nil
        s?.onEnd = nil
        s?.close()
        failAnswers()
        if state == .finding { next() } else { lostLink() }
    }

    private func ended(_ why: PhoneLinkSession.End) {
        session = nil
        pingTimer?.cancel(); pingTimer = nil
        failAnswers()
        if state == .finding {
            switch why {
            case .refused: sawRefused = true
            case .broken: sawBroken = true
            default: break
            }
            return next()
        }
        lostLink()
    }

    /// The open link lost: `away`, and a reconnection later while runs are followed.
    private func lostLink() {
        guard state == .open else { return }
        state = .away
        scheduleRetry()
    }

    private func scheduleRetry() {
        guard !following.isEmpty, attempt < retry.count else { return }
        let w = DispatchWorkItem { [weak self] in self?.retryTimer = nil; self?.find() }
        retryTimer = w
        queue.asyncAfter(deadline: .now() + retry[attempt], execute: w)
        attempt += 1
    }

    private func fail(_ f: Failure) {
        let reconnecting = !following.isEmpty && f != .selfTest && f != .notPaired && f != .removed && f != .keychain
        stopAll()
        failWaiting(f)
        if reconnecting && attempt < retry.count {
            state = .away
            return scheduleRetry()
        }
        // (given up: the computer keeps the runs; a removed phone's are gone there)
        let lost = following
        following = [:]
        state = .failed(f)
        if f == .removed { for id in lost.keys { forget(id) } }
        for id in lost.keys.sorted() { onLost?(id, RunError(code: f == .removed ? "removed" : "away", message: "\(f)")) }
    }

    private func failWaiting(_ f: Failure) {
        let w = waiting
        waiting = []
        for x in w { x(.failure(f)) }
    }

    private func failAnswers() {
        let a = answers
        answers = [:]
        for (_, f) in a.sorted(by: { $0.key < $1.key }) { f(["t": "error", "code": "away", "message": "the link to the computer dropped"]) }
    }

    private func stopAll() {
        findTimer?.cancel(); findTimer = nil
        pingTimer?.cancel(); pingTimer = nil
        browser?.stop(); browser = nil
        let s = session
        session = nil
        s?.onEnd = nil
        s?.close()
        failAnswers()
    }

    private func ping() {
        let w = DispatchWorkItem { [weak self] in
            guard let self, self.state == .open, let s = self.session else { return }
            _ = s.send(["t": "ping"])
            self.ping()
        }
        pingTimer = w
        queue.asyncAfter(deadline: .now() + Self.pingSeconds, execute: w)
    }

    // MARK: messages

    /// When the last request went (the phone sync closes a link of its own once nothing has used it for 30 s).
    private(set) var lastUse = Date.distantPast

    private func request(_ m: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        lastUse = Date()
        guard let s = session else { return done(["t": "error", "code": "away", "message": "no link"]) }
        let id = nextId
        nextId += 1
        var m = m
        m["id"] = id
        answers[id] = done
        guard s.send(m) else { answers[id] = nil; return done(["t": "error", "code": "away", "message": "not sent"]) }
        queue.asyncAfter(deadline: .now() + Self.requestSeconds) { [weak self] in
            guard let self, let f = self.answers.removeValue(forKey: id) else { return }
            f(["t": "error", "code": "timeout", "message": "no answer in \(Int(Self.requestSeconds)) s"])
        }
    }

    private func message(_ m: [String: Any]) {
        let t = m["t"] as? String ?? ""
        switch t {
        case "run.event":
            guard let id = m["runId"] as? String, let n = m["n"] as? Int, let ev = m["event"] as? [String: Any],
                  let last = following[id], n > last else { return }
            following[id] = n
            shown[id] = n
            onEvent?(id, n, ev)
        case "run.result":
            guard let id = m["runId"] as? String, following[id] != nil else { return }
            following[id] = nil
            forget(id)
            onResult?(id, m)
            request(["t": "run.ack", "runId": id]) { _ in }
        case "tool.request":
            guard let tid = m["id"] as? String, let runId = m["runId"] as? String, let tool = m["tool"] as? String else { return }
            let input = m["input"] as? [String: Any] ?? [:]
            guard following[runId] != nil, let onTool else {
                return answerTool(tid, ToolAnswer(text: "The app isn't following this run.", shot: nil, error: true))
            }
            var answered = false
            onTool(runId, tool, input) { [weak self] a in
                guard !answered else { return }
                answered = true
                self?.answerTool(tid, a)
            }
        case "pong":
            return
        case "sync.changed":
            onSyncChanged?()
        default:
            guard let id = m["id"] as? Int, let f = answers.removeValue(forKey: id) else { return }
            f(m)
        }
    }

    private func answerTool(_ id: String, _ a: ToolAnswer) {
        guard let s = session else { return } // (the computer ends the waiting command itself when the link goes)
        var r: [String: Any] = ["t": "tool.result", "id": id, "text": a.text, "error": a.error]
        if let shot = a.shot { r["shot"] = shot.base64EncodedString() }
        _ = s.send(r)
    }

    private static func error(_ a: [String: Any]) -> RunError {
        RunError(code: a["code"] as? String ?? "failed", message: a["message"] as? String ?? "no answer")
    }
}
