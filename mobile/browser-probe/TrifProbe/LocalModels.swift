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
import UserNotifications

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
    /// Free space where the models go, in bytes; nil when iOS doesn't say (then a download isn't refused for it).
    var freeSpace: Int64? {
        let v = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
        if let important = v?.volumeAvailableCapacityForImportantUsage, important > 0 { return important }
        if let plain = v?.volumeAvailableCapacity, plain > 0 { return Int64(plain) }
        return nil
    }
    private var freeText: String { freeSpace.map { LocalModels.size($0) } ?? "an unknown amount" }

    // MARK: downloads (in the background: they go on while the app is away)
    // (11-16, Tim's phone: he started one and couldn't tell whether it was moving. So: bytes, speed and time left for
    // every view of it (Settings and the chat's bar), each change pushed to the panel, a note and a notification when
    // it ends, and the diagnostics told at the start, every 10%, and at each pause, resume, end and failure. A download
    // iOS stopped (the app swiped away: its background downloads are cancelled) is no longer forgotten silently: it
    // shows as paused, with why, and resumes from where it was.)

    enum State: Equatable { case downloading(Double), paused, checking, failed(String) }
    @Published private(set) var states: [String: State] = [:]
    /// Bytes so far, the total, the speed (bytes a second, smoothed) and the last 10% told to the diagnostics.
    struct Progress { var done: Int64 = 0; var total: Int64 = 0; var speed: Double = 0; var at = Date(); var atBytes: Int64 = 0; var decile = -1; var told = false; var lastByte = Date(); var stallTold = false }
    private var progress: [String: Progress] = [:]
    /// The last end of a download, for a note: "ready" or why it stopped, and when.
    private(set) var notes: [String: (kind: String, text: String, at: Date)] = [:]
    /// Why a paused download is paused, when it wasn't the person (the app was closed, no network).
    private var pausedWhy: [String: String] = [:]
    /// Downloads iOS was asked to make (so one that vanished while the app was away is known).
    private var wanted: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "modelDownloads") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "modelDownloads") }
    }
    private var tasks: [String: URLSessionDownloadTask] = [:]
    /// Cancelled here (Pause, Delete): not a failure.
    private var cancelling: Set<String> = []
    private let resumeDir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("model-resume", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private func resumeFile(_ id: String) -> URL { resumeDir.appendingPathComponent("\(id).data") }
    private func keepResume(_ id: String, _ data: Data?) {
        if let data { try? data.write(to: resumeFile(id)) } else { try? FileManager.default.removeItem(at: resumeFile(id)) }
    }
    /// The background session's events finished being handed over (iOS woke the app for them): its handler called.
    var backgroundDone: (() -> Void)?
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: LocalModels.sessionID)
        c.isDiscretionary = false
        c.sessionSendsLaunchEvents = true
        // (the person asked for it: on cellular and in Low Data Mode too, rather than waiting without saying so)
        c.allowsCellularAccess = true
        c.allowsExpensiveNetworkAccess = true
        c.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: c, delegate: self, delegateQueue: .main)
    }()
    nonisolated static let sessionID = "com.timsrobot.trif.models"

    private func log(_ text: String) { Diagnostics.shared.log("local model", text) }
    private func name(_ id: String) -> String { LocalModels.named(id)?.name ?? id }

    /// (the app started, or iOS woke it for the downloads: the session made again with its identifier, and the
    /// downloads still going attached; one asked for that isn't there any more shows as paused, with why)
    func wake() {
        session.getAllTasks { all in
            Task { @MainActor in
                var found = Set<String>()
                for t in all {
                    guard let id = t.taskDescription, let d = t as? URLSessionDownloadTask, t.state == .running || t.state == .suspended else { continue }
                    found.insert(id)
                    self.tasks[id] = d
                    if t.state == .suspended { d.resume() }
                    let total = d.countOfBytesExpectedToReceive > 0 ? d.countOfBytesExpectedToReceive : (LocalModels.named(id)?.size ?? 0)
                    self.progress[id] = Progress(done: d.countOfBytesReceived, total: total, at: Date(), atBytes: d.countOfBytesReceived, decile: Int(Double(d.countOfBytesReceived) / Double(max(total, 1)) * 10), told: true)
                    self.states[id] = .downloading(Double(d.countOfBytesReceived) / Double(max(total, 1)))
                    self.monitor(id, d)
                    self.log("\(self.name(id)): its download found going on (\(LocalModels.size(d.countOfBytesReceived)) of \(LocalModels.size(total)))")
                }
                for id in self.wanted where !found.contains(id) && self.states[id] == nil {
                    guard let m = LocalModels.named(id), !self.isReady(m) else { self.wanted.remove(id); continue }
                    if FileManager.default.fileExists(atPath: self.resumeFile(id).path) {
                        self.states[id] = .paused
                        self.pausedWhy[id] = self.pausedWhy[id] ?? "it stopped while the app was closed"
                    } else {
                        self.states[id] = .failed("it stopped while the app was closed")
                    }
                    self.log("\(m.name): its download wasn't going on when the app started (\(self.pausedWhy[id] ?? "no way to resume it"))")
                }
            }
        }
    }

    /// Starts (or resumes) a model's download. Refused, with why, when there's no room for it.
    func download(_ m: LocalModelInfo) -> String? {
        log("\(m.name): download asked for (\(freeText) free\(tasks[m.id] != nil ? "; one is already going" : ""))")
        guard tasks[m.id] == nil else { return nil }
        if let free = freeSpace, free < m.size + 300_000_000 {
            let why = "There isn't room for it: it needs \(Self.size(m.size + 300_000_000)), and \(Self.size(free)) is free."
            log("\(m.name): not downloaded, no room")
            return why
        }
        let t: URLSessionDownloadTask
        let resume = try? Data(contentsOf: resumeFile(m.id))
        if let resume { t = session.downloadTask(withResumeData: resume) } else { t = session.downloadTask(with: m.url) }
        keepResume(m.id, nil)
        t.taskDescription = m.id
        tasks[m.id] = t
        pausedWhy[m.id] = nil
        notes[m.id] = nil
        var w = wanted; w.insert(m.id); wanted = w
        var pr = progress[m.id] ?? Progress()
        pr.total = m.size; pr.at = Date(); pr.atBytes = pr.done; pr.speed = 0; pr.told = false
        progress[m.id] = pr
        states[m.id] = .downloading(Double(pr.done) / Double(max(m.size, 1)))
        t.resume()
        LocalModels.askToNotify()
        log("\(m.name): download \(resume != nil ? "resumed at \(Self.size(pr.done))" : "started") from \(m.url.host ?? "?") (\(Self.size(m.size)), task \(LocalModels.stateName(t.state)))")
        watch(m.id, t)
        monitor(m.id, t)
        return nil
    }

    /// A download that hasn't begun coming in (11-16, Tim's first try did nothing, with no word why): looked at after 15 s
    /// and 45 s. A task iOS left suspended is resumed; one still with nothing is said (the bar's note and the
    /// diagnostics), with its state and any error; after 45 s it's started again from scratch, once.
    private func watch(_ id: String, _ t: URLSessionDownloadTask, again: Bool = false) {
        for (delay, last) in [(15.0, false), (45.0, true)] {
            Task { @MainActor [weak self, weak t] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard let self, let t, self.tasks[id] === t, t.countOfBytesReceived == 0 else { return }
                let state = LocalModels.stateName(t.state)
                let err = t.error.map { " (\(LocalModels.why($0)))" } ?? ""
                self.log("\(self.name(id)): nothing has come in after \(Int(delay)) s; the task is \(state)\(err)")
                if t.state == .suspended { t.resume() }
                if last, !again, t.state != .completed {
                    // (started again, from scratch: a task that never began)
                    self.cancelling.insert(id)
                    t.cancel()
                    self.tasks[id] = nil
                    let fresh = self.session.downloadTask(with: LocalModels.named(id)!.url)
                    fresh.taskDescription = id
                    self.tasks[id] = fresh
                    fresh.resume()
                    self.notes[id] = ("waiting", "It hadn’t started, so it was started again.", Date())
                    self.log("\(self.name(id)): started again (the first task never began)")
                    self.objectWillChange.send()
                    self.watch(id, fresh, again: true)
                } else if self.notes[id] == nil || self.notes[id]?.kind == "waiting" {
                    self.notes[id] = ("waiting", "Nothing has come in yet\(err.isEmpty ? "" : err). It may be waiting for a network connection.", Date())
                    self.objectWillChange.send()
                }
            }
        }
    }
    /// While a download is on its way: every 10 s, a stall (nothing new for 30 s) told to the diagnostics, once per stall.
    private func monitor(_ id: String, _ t: URLSessionDownloadTask) {
        Task { @MainActor [weak self, weak t] in
            while true {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                guard let self, let t, self.tasks[id] === t, var pr = self.progress[id] else { return }
                let quiet = Date().timeIntervalSince(pr.lastByte)
                if quiet >= 30, !pr.stallTold, t.countOfBytesReceived > 0 {
                    pr.stallTold = true
                    self.progress[id] = pr
                    self.log("\(self.name(id)): nothing new for \(Int(quiet)) s at \(LocalModels.mb(pr.done)) of \(LocalModels.mb(pr.total)); the task is \(LocalModels.stateName(t.state))")
                }
            }
        }
    }
    nonisolated static func stateName(_ s: URLSessionTask.State) -> String {
        switch s { case .running: return "running"; case .suspended: return "suspended"; case .canceling: return "cancelling"; case .completed: return "completed"; @unknown default: return "unknown" }
    }
    func pause(_ m: LocalModelInfo) {
        guard let t = tasks.removeValue(forKey: m.id) else { return }
        cancelling.insert(m.id)
        t.cancel { [weak self] data in Task { @MainActor in
            guard let self else { return }
            self.keepResume(m.id, data)
            self.states[m.id] = data == nil ? .failed("it couldn't be paused; start it again") : .paused
            self.log("\(m.name): paused at \(Self.size(self.progress[m.id]?.done ?? 0))\(data == nil ? " (no way to resume: it starts over)" : "")")
        } }
    }
    /// The model's file deleted (or its download stopped and forgotten).
    func delete(_ m: LocalModelInfo) {
        if let t = tasks.removeValue(forKey: m.id) { cancelling.insert(m.id); t.cancel() }
        keepResume(m.id, nil)
        states[m.id] = nil
        progress[m.id] = nil
        notes[m.id] = nil
        pausedWhy[m.id] = nil
        var w = wanted; w.remove(m.id); wanted = w
        LocalRunner.shared.unload()
        try? FileManager.default.removeItem(at: file(m))
        log("\(m.name) deleted")
    }

    /// The download ended: a note for the chat and Settings, and a notification if the app isn't in front.
    private func ended(_ id: String, ok: Bool, why: String = "") {
        notes[id] = (ok ? "ready" : "failed", ok ? "Model ready: \(name(id))." : "Couldn’t download \(name(id)): \(why).", Date())
        if ok || !why.isEmpty { var w = wanted; w.remove(id); wanted = w }
        guard UIApplication.shared.applicationState != .active else { return }
        let c = UNMutableNotificationContent()
        c.title = ok ? "Model ready" : "Model download stopped"
        c.body = ok ? "\(name(id)) is on this iPhone: the More chat can use it." : "\(name(id)): \(why)."
        c.userInfo = ["kind": "model"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "trif.model.\(id)", content: c, trigger: nil))
    }
    /// Notifications asked for once, at a first download (as at a first chat send).
    static func askToNotify() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { s in
            guard s.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    /// Why a download stopped, in a few plain words.
    nonisolated static func why(_ error: Error) -> String {
        let e = error as NSError
        if e.domain == NSPOSIXErrorDomain && e.code == Int(ENOSPC) { return "this iPhone ran out of space" }
        if e.domain == NSURLErrorDomain {
            switch e.code {
            case NSURLErrorCannotWriteToFile, NSURLErrorCannotCreateFile: return "this iPhone ran out of space"
            case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut, NSURLErrorCannotConnectToHost, NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff:
                return "the network connection was lost"
            default: break
            }
        }
        if let u = e.userInfo[NSUnderlyingErrorKey] as? NSError, u.domain == NSPOSIXErrorDomain, u.code == Int(ENOSPC) { return "this iPhone ran out of space" }
        return e.localizedDescription
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let id = downloadTask.taskDescription ?? ""
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let host = downloadTask.response?.url?.host ?? "?"
        MainActor.assumeIsolated {
            let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (LocalModels.named(id)?.size ?? 1)
            var pr = self.progress[id] ?? Progress(total: total)
            if pr.stallTold { self.log("\(self.name(id)): coming in again after a stall") }
            pr.lastByte = Date()
            pr.stallTold = false
            pr.done = totalBytesWritten
            pr.total = total
            let now = Date()
            let dt = now.timeIntervalSince(pr.at)
            if dt >= 1 {
                let rate = Double(totalBytesWritten - pr.atBytes) / dt
                pr.speed = pr.speed == 0 ? rate : pr.speed * 0.6 + rate * 0.4
                pr.at = now
                pr.atBytes = totalBytesWritten
            }
            if !pr.told { pr.told = true; self.log("\(self.name(id)): the download is coming in (HTTP \(status), from \(host))"); if self.notes[id]?.kind == "waiting" { self.notes[id] = nil } }
            let p = min(1, Double(totalBytesWritten) / Double(max(total, 1)))
            let decile = Int(p * 10)
            if decile > pr.decile, pr.decile >= 0 || decile > 0 {
                self.log("\(self.name(id)): \(decile * 10)% (\(LocalModels.mb(totalBytesWritten)) of \(LocalModels.mb(total)), \(LocalModels.mb(Int64(pr.speed)))/s)")
            }
            pr.decile = max(pr.decile, decile)
            self.progress[id] = pr
            if case .downloading(let was) = self.states[id] ?? .downloading(0), p - was >= 0.002 || p >= 1 { self.states[id] = .downloading(p) }
        }
    }

    /// Waiting for a network (background downloads wait rather than fail): said, so it isn't taken for stuck.
    nonisolated func urlSession(_ session: URLSession, taskIsWaitingForConnectivity task: URLSessionTask) {
        let id = task.taskDescription ?? ""
        MainActor.assumeIsolated {
            self.notes[id] = ("waiting", "Waiting for a network connection.", Date())
            self.log("\(self.name(id)): waiting for a network connection")
            self.objectWillChange.send()
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        MainActor.assumeIsolated {
            self.backgroundDone?()
            self.backgroundDone = nil
        }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // (the file must be moved before this returns: iOS deletes it after)
        let id = downloadTask.taskDescription ?? ""
        guard let m = LocalModels.named(id) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let staging = location.deletingLastPathComponent().appendingPathComponent("trif-\(m.file).part")
        try? FileManager.default.removeItem(at: staging)
        var moveError: Error?
        do { try FileManager.default.moveItem(at: location, to: staging) } catch { moveError = error }
        MainActor.assumeIsolated {
            self.tasks[id] = nil
            if let moveError {
                let why = LocalModels.why(moveError) == moveError.localizedDescription ? "the download couldn't be kept" : LocalModels.why(moveError)
                self.states[id] = .failed(why); self.ended(id, ok: false, why: why); self.log("\(m.name): \(why) (\(moveError.localizedDescription))"); return
            }
            guard status == 200 || status == 206 else {
                try? FileManager.default.removeItem(at: staging)
                let why = "the server answered \(status)"
                self.states[id] = .failed(why); self.ended(id, ok: false, why: why); self.log("\(m.name): \(why)"); return
            }
            self.states[id] = .checking
            self.log("\(m.name): downloaded; checking its SHA-256")
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
                        self.progress[id] = nil
                        self.ended(id, ok: true)
                        self.log("\(m.name): ready (checked)")
                    } else {
                        try? FileManager.default.removeItem(at: staging)
                        let why = "it didn't match its checksum, so it was deleted"
                        self.states[id] = .failed(why)
                        self.progress[id] = nil
                        self.ended(id, ok: false, why: why)
                        self.log("\(m.name): the download didn't match its SHA-256; deleted")
                    }
                }
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let id = task.taskDescription ?? ""
        let e = error as NSError
        let data = e.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        let reason = e.userInfo[NSURLErrorBackgroundTaskCancelledReasonKey] as? Int
        MainActor.assumeIsolated {
            self.tasks[id] = nil
            // (cancelled here, by Pause or Delete: said there)
            if self.cancelling.remove(id) != nil { return }
            if let data { self.keepResume(id, data) }
            var why = LocalModels.why(error)
            if let reason {
                why = reason == NSURLErrorCancelledReasonUserForceQuitApplication ? "it stopped when the app was swiped away"
                    : reason == NSURLErrorCancelledReasonBackgroundUpdatesDisabled ? "Background App Refresh is off for TRIF" : "iOS stopped it to save resources"
            }
            if data != nil {
                self.states[id] = .paused
                self.pausedWhy[id] = why
                self.notes[id] = ("failed", "\(self.name(id))’s download is paused: \(why). Resume it in Settings.", Date())
            } else {
                self.states[id] = .failed(why)
                self.ended(id, ok: false, why: why)
            }
            self.log("\(self.name(id))'s download stopped: \(why)\(data != nil ? "; it can resume" : "") (\(e.domain) \(e.code))")
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

    /// For the panel (Web/panel-adapter.js: Settings and the chat's bar): each model, its size, whether it suits this
    /// phone, its state with bytes, speed and time left, and the last note.
    func describe() -> [String: Any] {
        let mem = Int(LocalModels.memoryGB.rounded())
        return [
            "memory": "This iPhone has \(mem) GB of memory; \(freeText) free for files.",
            "models": LocalModels.all.map { m -> [String: Any] in
                var o: [String: Any] = ["id": m.id, "name": m.name, "size": LocalModels.size(m.size), "note": m.note,
                                        "fits": LocalModels.fits(m), "suggested": m.id == LocalModels.suggested.id, "ready": isReady(m)]
                if let pr = progress[m.id] {
                    o["done"] = LocalModels.mb(pr.done); o["total"] = LocalModels.mb(pr.total)
                    o["progress"] = Double(pr.done) / Double(max(pr.total, 1))
                    let quiet = Date().timeIntervalSince(pr.lastByte)
                    if case .downloading = states[m.id], quiet >= 6, pr.done > 0 {
                        // (nothing new for a while: no speed or time left that's no longer true, but how long it's been)
                        o["stalled"] = "Nothing new for \(LocalModels.duration(quiet)): it goes on by itself when the network is back."
                    } else if pr.speed > 1000 {
                        o["speed"] = "\(LocalModels.mb(Int64(pr.speed)))/s"
                        o["left"] = LocalModels.duration(Double(pr.total - pr.done) / pr.speed)
                    }
                }
                switch states[m.id] {
                case .downloading(let p): o["state"] = "downloading"; if o["progress"] == nil { o["progress"] = p }
                case .paused: o["state"] = "paused"; if let w = pausedWhy[m.id] { o["why"] = w }
                case .checking: o["state"] = "checking"
                case .failed(let why): o["state"] = "failed"; o["why"] = why
                case nil: o["state"] = isReady(m) ? "ready" : "none"
                }
                if let n = notes[m.id] { o["noteKind"] = n.kind; o["noteText"] = n.text; o["noteAge"] = Date().timeIntervalSince(n.at) }
                return o
            },
        ]
    }
    nonisolated static func mb(_ b: Int64) -> String { b >= 10_000_000_000 ? String(format: "%.1f GB", Double(b) / 1e9) : "\(Int((Double(b) / 1e6).rounded())) MB" }
    nonisolated static func duration(_ s: Double) -> String {
        guard s.isFinite, s >= 0 else { return "" }
        if s < 60 { return "\(max(1, Int(s))) s" }
        if s < 3600 { return "\(Int((s / 60).rounded())) min" }
        return "\(Int(s / 3600)) h \(Int(s.truncatingRemainder(dividingBy: 3600) / 60)) min"
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
