// "On this iPhone", the More chat's own engine (Tim, 11-16; the research: mobile/local-model/README.md): a small model
// that runs on the phone, free and private, for style mods (and, on phones with 6 GB of memory, boxed mods too,
// experimental). Which model, from the phone's memory:
//   - 4 GB (an iPhone SE): MiniCPM5-2B (1.56 GB; about 70% of the research's style tasks done) or Qwen3.5-2B (1.28 GB;
//     about 59%, reads pages twice as fast). Both offered; MiniCPM5 first.
//   - 6 GB and up: Qwen3.5-4B (2.74 GB; 9 of the 12 tasks, the only one decent at boxed mods).
// All three Apache-2.0. Downloaded only when the person says so (its size and the free space shown first), from its
// Hugging Face repository, in the background, checked against its SHA-256, into Application Support/models, left out
// of backups. The model is loaded when a request comes, and let go when the robot view closes or memory runs low.

import CryptoKit
import Foundation
import UIKit

struct LocalModelInfo {
    let id: String
    let name: String
    let repo: String
    let file: String
    let size: Int64
    let sha256: String
    /// The memory the phone needs, in GB (physicalMemory).
    let minGB: Double
    /// How it writes: style mods as JSON (TRIF writes the header), or whole files (style or boxed).
    let mode: LocalPrompt.Mode
    let note: String
    var url: URL {
        if let base = LocalModels.mockBase { return base.appendingPathComponent("models").appendingPathComponent(file) }
        return URL(string: "https://huggingface.co/\(repo)/resolve/main/\(file)")!
    }
}

@MainActor
final class LocalModels: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = LocalModels()

    nonisolated static let all: [LocalModelInfo] = [
        LocalModelInfo(id: "minicpm5-2b", name: "MiniCPM5 2B", repo: "openbmb/MiniCPM5-2B-GGUF", file: "MiniCPM5-2B-Q4_K_M.gguf", size: 1_561_318_368,
                       sha256: "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd", minGB: 3.5, mode: .styleJSON,
                       note: "Style mods. The best of the small ones in TRIF's tests."),
        LocalModelInfo(id: "qwen35-2b", name: "Qwen3.5 2B", repo: "unsloth/Qwen3.5-2B-GGUF", file: "Qwen3.5-2B-Q4_K_M.gguf", size: 1_280_835_840,
                       sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223", minGB: 3.5, mode: .styleJSON,
                       note: "Style mods. Reads pages about twice as fast; gets fewer right."),
        LocalModelInfo(id: "qwen35-4b", name: "Qwen3.5 4B", repo: "unsloth/Qwen3.5-4B-GGUF", file: "Qwen3.5-4B-Q4_K_M.gguf", size: 2_740_937_888,
                       sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4", minGB: 5.5, mode: .file,
                       note: "Style mods, and boxed mods (experimental). Needs 6 GB of memory."),
    ]
    nonisolated static func named(_ id: String?) -> LocalModelInfo? { all.first { $0.id == id } }

    /// The phone's memory, in GB.
    nonisolated static var memoryGB: Double { Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824 }
    nonisolated static func fits(_ m: LocalModelInfo) -> Bool { memoryGB >= m.minGB }
    /// The one suggested for this phone.
    nonisolated static var suggested: LocalModelInfo { memoryGB >= 5.5 ? all[2] : all[0] }
    /// The context: 4k on a 4 GB phone, 6k with more.
    nonisolated static var contextTokens: Int32 { memoryGB >= 5.5 ? 6144 : 4096 }

    /// (development) `-modelbase http://localhost:<port>`: downloads from a local stand-in (a loopback address only).
    nonisolated static let mockBase: URL? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-modelbase"), i + 1 < args.count, let u = URL(string: args[i + 1]),
              ["localhost", "127.0.0.1", "::1"].contains(u.host ?? "") else { return nil }
        return u
    }()

    // MARK: on disk

    let dir: URL = {
        var d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("models", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        try? d.setResourceValues(v)
        return d
    }()
    func file(_ m: LocalModelInfo) -> URL { dir.appendingPathComponent(m.file) }
    func isReady(_ m: LocalModelInfo) -> Bool { FileManager.default.fileExists(atPath: file(m).path) && states[m.id] == nil }
    var readyModels: [LocalModelInfo] { LocalModels.all.filter(isReady) }
    /// Free space where the models go, in bytes.
    var freeSpace: Int64 {
        (try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage).flatMap { $0 } ?? 0
    }

    // MARK: downloads (in the background: they go on while the app is away)

    enum State: Equatable { case downloading(Double), paused, checking, failed(String) }
    @Published private(set) var states: [String: State] = [:]
    private var tasks: [String: URLSessionDownloadTask] = [:]
    private var resumeData: [String: Data] = [:]
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: "com.timsrobot.trif.models")
        c.isDiscretionary = false
        c.sessionSendsLaunchEvents = true
        return URLSession(configuration: c, delegate: self, delegateQueue: .main)
    }()
    /// (the app started: downloads iOS kept going meanwhile are picked up again)
    func wake() {
        session.getAllTasks { all in
            Task { @MainActor in
                for t in all { if let id = t.taskDescription, let d = t as? URLSessionDownloadTask, t.state == .running { self.tasks[id] = d; self.states[id] = .downloading(0) } }
            }
        }
    }

    /// Starts (or resumes) a model's download. Refused, with why, when there's no room for it.
    func download(_ m: LocalModelInfo) -> String? {
        guard tasks[m.id] == nil else { return nil }
        if freeSpace < m.size + 300_000_000 { return "There isn't room for it: it needs \(Self.size(m.size + 300_000_000)), and \(Self.size(freeSpace)) is free." }
        let t: URLSessionDownloadTask
        if let r = resumeData.removeValue(forKey: m.id) { t = session.downloadTask(withResumeData: r) } else { t = session.downloadTask(with: m.url) }
        t.taskDescription = m.id
        tasks[m.id] = t
        states[m.id] = .downloading(states[m.id].flatMap { if case .downloading(let p) = $0 { return p } else { return nil } } ?? 0)
        t.resume()
        Diagnostics.shared.log("local model", "downloading \(m.name) (\(Self.size(m.size)), \(Self.size(freeSpace)) free)")
        return nil
    }
    func pause(_ m: LocalModelInfo) {
        guard let t = tasks.removeValue(forKey: m.id) else { return }
        t.cancel { [weak self] data in Task { @MainActor in self?.resumeData[m.id] = data; self?.states[m.id] = .paused } }
    }
    /// The model's file deleted (or its download stopped and forgotten).
    func delete(_ m: LocalModelInfo) {
        tasks.removeValue(forKey: m.id)?.cancel()
        resumeData[m.id] = nil
        states[m.id] = nil
        LocalRunner.shared.unload()
        try? FileManager.default.removeItem(at: file(m))
        Diagnostics.shared.log("local model", "\(m.name) deleted")
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let id = downloadTask.taskDescription ?? ""
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (LocalModels.named(id)?.size ?? 1)
        let p = min(1, Double(totalBytesWritten) / Double(max(total, 1)))
        MainActor.assumeIsolated { if case .downloading(let was) = self.states[id] ?? .downloading(0), p - was >= 0.005 || p >= 1 { self.states[id] = .downloading(p) } }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // (the file must be moved before this returns: iOS deletes it after)
        let id = downloadTask.taskDescription ?? ""
        guard let m = LocalModels.named(id) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let staging = location.deletingLastPathComponent().appendingPathComponent("trif-\(m.file).part")
        try? FileManager.default.removeItem(at: staging)
        let moved = (try? FileManager.default.moveItem(at: location, to: staging)) != nil
        MainActor.assumeIsolated {
            self.tasks[id] = nil
            guard moved, status == 200 || status == 206 else { self.states[id] = .failed(moved ? "the server answered \(status)" : "the download couldn't be kept"); return }
            self.states[id] = .checking
            let target = self.file(m)
            Task.detached(priority: .utility) {
                let ok = LocalModels.sha256(of: staging) == m.sha256
                await MainActor.run {
                    if ok {
                        try? FileManager.default.removeItem(at: target)
                        try? FileManager.default.moveItem(at: staging, to: target)
                        var v = URLResourceValues()
                        v.isExcludedFromBackup = true
                        var t = target
                        try? t.setResourceValues(v)
                        self.states[id] = nil
                        Diagnostics.shared.log("local model", "\(m.name) downloaded and checked")
                    } else {
                        try? FileManager.default.removeItem(at: staging)
                        self.states[id] = .failed("the download didn't match its checksum, so it was deleted")
                        Diagnostics.shared.log("local model", "\(m.name): the download didn't match its SHA-256; deleted")
                    }
                }
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let id = task.taskDescription ?? ""
        let data = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        MainActor.assumeIsolated {
            self.tasks[id] = nil
            if (error as NSError).code == NSURLErrorCancelled { return } // (paused or deleted: said there)
            if let data { self.resumeData[id] = data; self.states[id] = .paused }
            else { self.states[id] = .failed(error.localizedDescription) }
            Diagnostics.shared.log("local model", "\(LocalModels.named(id)?.name ?? id)'s download stopped: \(error.localizedDescription)")
        }
    }

    nonisolated static func sha256(of url: URL) -> String {
        guard let h = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? h.close() }
        var hasher = SHA256()
        while let chunk = try? h.read(upToCount: 8 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func size(_ b: Int64) -> String { b >= 1_000_000_000 ? String(format: "%.2f GB", Double(b) / 1e9) : "\(b / 1_000_000) MB" }

    /// For the panel's Settings (Web/panel-adapter.js): each model, its size, whether it suits this phone, its state.
    func describe() -> [String: Any] {
        let mem = Int(LocalModels.memoryGB.rounded())
        return [
            "memory": "This iPhone has \(mem) GB of memory; \(LocalModels.size(freeSpace)) free for files.",
            "models": LocalModels.all.map { m -> [String: Any] in
                var o: [String: Any] = ["id": m.id, "name": m.name, "size": LocalModels.size(m.size), "note": m.note,
                                        "fits": LocalModels.fits(m), "suggested": m.id == LocalModels.suggested.id, "ready": isReady(m)]
                switch states[m.id] {
                case .downloading(let p): o["state"] = "downloading"; o["progress"] = p
                case .paused: o["state"] = "paused"
                case .checking: o["state"] = "checking"
                case .failed(let why): o["state"] = "failed"; o["why"] = why
                case nil: o["state"] = isReady(m) ? "ready" : "none"
                }
                return o
            },
        ]
    }
}

/// The loaded model, one at a time, on a thread of its own (llama.cpp is called from one thread at a time).
final class LocalRunner: @unchecked Sendable {
    static let shared = LocalRunner()
    private let queue = DispatchQueue(label: "trif.local-model", qos: .userInitiated)
    #if canImport(llama)
    private var llama: LocalLlama?
    #endif
    private var loadedPath = ""
    private var cancelFlag = false
    private let lock = NSLock()

    private init() {
        // (memory low: the model goes first)
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            LocalRunner.shared.unload()
        }
    }

    static var available: Bool {
        #if canImport(llama)
        return true
        #else
        return false
        #endif
    }

    func cancel() { lock.lock(); cancelFlag = true; lock.unlock() }
    private var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelFlag }

    /// Let go of the model (the robot view closed, memory low, the model deleted).
    func unload() {
        queue.async {
            #if canImport(llama)
            if self.llama != nil { self.llama = nil; self.loadedPath = ""; DispatchQueue.main.async { Diagnostics.shared.log("local model", "unloaded (\(LocalLlama.memoryLeftMB) MB of memory left)") } }
            #endif
        }
    }

    /// One reply, off the main thread: (the text, a summary of what it took).
    func generate(path: String, system: String, user: String, grammar: String, cachePath: String, onText: @escaping @Sendable (String) -> Void) async throws -> (String, String) {
        lock.withLock { cancelFlag = false }
        return try await withCheckedThrowingContinuation { c in
            queue.async {
                #if canImport(llama)
                do {
                    if self.llama == nil || self.loadedPath != path {
                        self.llama = nil
                        self.llama = try LocalLlama(path: path, nCtx: LocalModels.contextTokens)
                        self.loadedPath = path
                    }
                    let r = try self.llama!.generate(system: system, user: user, grammar: grammar, maxTokens: 900, cachePath: cachePath,
                                                     cancelled: { self.cancelled }, onText: onText)
                    c.resume(returning: (r.text, r.stats.summary))
                } catch { c.resume(throwing: error) }
                #else
                c.resume(throwing: PanelError.message("the model on this iPhone needs a real iPhone: the Simulator can't run it"))
                #endif
            }
        }
    }
}

/// On this iPhone, as the More chat's engine: no tools (the page goes in with the request), one reply, the mod in it.
@MainActor
final class LocalConversation: PanelConversation {
    var takesImages: Bool { false }
    var usesTools: Bool { false }
    var model: LocalModelInfo
    /// A step's line in the chat (PanelChat sets it).
    var onStep: (String) -> Void = { _ in }
    private var url = "", outline = "", request = ""
    init(model: LocalModelInfo) { self.model = model }

    /// The page and what the person wants (PanelChat hands them over instead of its own first message).
    func set(url: String, outline: String, request: String) { self.url = url; self.outline = outline; self.request = request }
    func addUser(_ text: String, image: Data?) { if request.isEmpty { request = text } }

    func step(system _: String, tools _: [PanelTool], model _: String, effort _: String?) async throws -> PanelStep {
        let m = model
        let path = LocalModels.shared.file(m).path
        guard LocalModels.shared.isReady(m) else { throw PanelError.message("\(m.name) isn't on this iPhone yet: download it in Settings, under Model on this iPhone") }
        guard LocalRunner.available else { throw PanelError.message("the model on this iPhone needs a real iPhone: the Simulator can't run it") }
        let guide = Browser.resource("local-guide", "txt")
        let system = LocalPrompt.system(guide: guide, mode: m.mode)
        let user = LocalPrompt.user(url: url, outline: outline, request: request)
        let origin = URL(string: url).map { "\($0.scheme ?? "https")://\($0.host ?? "")" } ?? "https://example.com"
        let grammar = m.mode == .styleJSON ? LocalPrompt.styleGrammar : LocalPrompt.fileGrammar(origin: origin)
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let cache = caches.appendingPathComponent("trif-\(m.id)-\(m.mode.rawValue)-\(Browser.codeHash(system)).state").path
        onStep("Reading the page… (about half a minute on this iPhone)")
        var wrote = false
        let started = Date()
        let (text, stats) = try await LocalRunner.shared.generate(path: path, system: system, user: user, grammar: grammar, cachePath: cache) { [weak self] _ in
            Task { @MainActor in if !wrote { wrote = true; self?.onStep("Writing…") } }
        }
        Diagnostics.shared.log("local model", "\(m.name), \(m.mode.rawValue): \(Int(Date().timeIntervalSince(started))) s in all; \(stats)")
        let made = m.mode == .styleJSON ? LocalPrompt.modFile(json: text, origin: origin) : LocalPrompt.modFile(reply: text)
        guard let file = made.file else {
            return PanelStep(text: "The model on this iPhone couldn't write a mod for that (\(made.why ?? "no reason given")).\n\n[Not right? Ask Claude](\(PanelChat.askClaudeLink))", calls: [], stop: "done", inputTokens: 0)
        }
        if !made.fixes.isEmpty { Diagnostics.shared.log("local model", "repaired: \(made.fixes.joined(separator: ", "))") }
        let host = URL(string: url)?.host ?? "this site"
        let reply = "Here's a \(file.contains("// @boxed") ? "boxed" : "style") mod for \(host), written on this iPhone:\n\n```js\n\(file)```\n\n[Not right? Ask Claude](\(PanelChat.askClaudeLink))"
        return PanelStep(text: reply, calls: [], stop: "done", inputTokens: 0)
    }
    func addResults(_ results: [PanelToolResult]) {}
}
