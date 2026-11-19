import AVFoundation
import Combine
import Network
import SwiftUI
import UIKit

// The phone link's screen: My computer, from More (Settings and the My computer engine), and from a
// `trif://pair` link (iOS's Camera app scanning desktop TRIF's code opens it here). Scans the code with the camera
// (QRScanner), pairs (PhoneLinkPairer, PhoneLinkPair.swift) under the name the person gives this iPhone, and shows
// the paired computer. More opens it (Settings' My computer block, and the My computer engine's notices). Every word is a draft in docs/IOS-APP-STRINGS.md and docs/PHONE-LINK-STRINGS.md.
//
// Development: `-linkhost 127.0.0.1:<port>` pairs with that address instead of looking on the Wi-Fi (a loopback
// address only), for the Simulator against a helper in a temp HOME.

/// The phone sync in the app (PhoneSync.swift; docs/PHONE-SYNC.md section 8 on branch phone-link): the app's one
/// link to the paired computer (More's engine uses it too), and when the phone syncs: the app in front, 3 s after a
/// mod's file changed, the computer's nudge, Sync now. Only with a paired computer; quiet when it isn't there. A link
/// opened for a sync alone is closed after 30 s of nothing. The Mods tab's line and Sync now: S7.
@MainActor
final class PhoneSyncModel: ObservableObject {
    static let shared = PhoneSyncModel()
    @Published private(set) var last: PhoneSync.Summary?
    @Published private(set) var lastProblem: String?
    @Published private(set) var syncing = false
    /// When a sync with the computer last ended well (kept across launches: the pairing screen's and Settings'
    /// "Last synced …" line).
    @Published private(set) var lastAt: Date? = {
        let t = UserDefaults.standard.double(forKey: "phoneSync.lastAt")
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }()
    /// The problem the toast last said for an automatic sync: the same one isn't said again until a sync works
    /// (a Mac asleep would otherwise be said each time the app comes to the front).
    private var toldProblem: String?
    /// What the Mods tab tells the person until they tap OK: conflicts, mods that came back, ones that couldn't
    /// come over (S7; drafts in docs/IOS-APP-STRINGS.md, "Phone sync").
    @Published private(set) var notices: [String] = []
    /// For the notices' names (the app's ModStore).
    private weak var store: ModStore?
    private var scheduler: PhoneSync.Scheduler?
    private var watch: AnyCancellable?
    private var idle: DispatchWorkItem?
    /// After a sync that changed mods here, with their ids (the app: Browser.syncApplied, so pages run the change).
    var applied: (([String]) -> Void)?

    private(set) lazy var link: PhoneLinkRemote = {
        let screen = UIScreen.main.bounds.size
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        return PhoneLinkRemote(phoneName: PhoneLinkModel.shared.sentName, device: ["name": UIDevice.current.model, "width": Int(screen.width), "height": Int(screen.height)],
                               app: version, endpoints: PhoneLinkModel.devEndpoints)
    }()

    /// Once, at launch (the app's ModStore).
    func start(store: ModStore) {
        guard scheduler == nil else { return }
        self.store = store
        let sync = PhoneSync(store: store, link: link)
        // (a file, a switch or an Allow that differs from the last sync's: a sync 3 s later; the sync itself reads the store)
        let s = PhoneSync.Scheduler(files: { store.syncSignature() }) { [weak self] done in
            guard PhoneLinkKeys.shared.computer != nil else { return done(.failure(.init(code: "notPaired", message: ""))) }
            self?.syncing = true
            sync.run(done)
        }
        s.finished = { [weak self] r, why in MainActor.assumeIsolated { self?.finished(r, why) } }
        scheduler = s
        link.onSyncChanged = { [weak self] in MainActor.assumeIsolated { self?.scheduler?.now("nudge") } }
        watch = store.$mods.dropFirst().sink { [weak self] _ in DispatchQueue.main.async { self?.scheduler?.changed() } }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.scheduler?.now("front") }
        }
    }

    /// Sync now (the Mods tab's button, S7; the dev step `sync`).
    func syncNow() { scheduler?.now("now") }

    private func finished(_ r: Result<PhoneSync.Summary, PhoneSync.Failure>, _ why: String) {
        syncing = false
        switch r {
        case .success(let s):
            last = s; lastProblem = nil
            tell(s)
            if !s.unfinished {
                lastAt = s.at
                UserDefaults.standard.set(s.at.timeIntervalSince1970, forKey: "phoneSync.lastAt")
                toldProblem = nil
                AppToast.shared.show(toastWords(s))
            } else { toast(problem: "unfinished", why) }
            let here = s.taken + s.removed + s.cameBack + s.conflicts.map(\.sibling) + s.switched + s.renamed.map(\.to)
            if !here.isEmpty { applied?(here) }
            if s.changedAnything || !s.skipped.isEmpty {
                Diagnostics.shared.log("sync", "synced (\(why))\(s.unfinished ? ", ended before its end (a rename that can't be done here)" : ""): \(s.renamed.count) renamed here, \(s.apart.count) kept apart, \(s.switched.count) switched here, \(s.taken.count) taken here (\(s.waitingHere.count) waiting), \(s.removed.count) deleted here, \(s.sent.count) sent (\(s.waitingThere.count) waiting there), \(s.conflicts.count) conflicts, \(s.refused.count) refused, \(s.skipped.count) skipped, \(s.later.count) later")
            }
        case .failure(let f):
            guard f.code != "notPaired" else { return }
            lastProblem = f.code
            Diagnostics.shared.log("sync", "not synced (\(why)): \(f.code) \(f.message)")
            toast(problem: f.code, why)
        }
        // (a link nobody else uses: closed after 30 s of nothing)
        idle?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self, !self.syncing, self.link.following.isEmpty, Date().timeIntervalSince(self.link.lastUse) >= 29 else { return }
            if self.link.state == .open { self.link.close() }
        }
        idle = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: w)
    }

    /// The paired computer's name (nil: not paired, so the Mods tab shows no sync line).
    var computerName: String? { PhoneLinkKeys.shared.computer?.name }

    /// The Mods tab's line: syncing, the last sync and what it did, or why it didn't happen.
    var line: String? {
        guard let c = computerName else { return nil }
        if syncing { return "Syncing with \(c)…" }
        if let p = lastProblem {
            switch p {
            case "off": return "Not synced: syncing phone mods is off on \(c)."
            case "notFound": return "Not synced: can't find \(c) right now. TRIF tries again when it's back."
            case "removed": return "Not synced: this iPhone isn't connected to \(c) any more."
            case "denied": return "Not synced: TRIF needs Local Network access to find \(c)."
            default: return "Not synced with \(c) this time. TRIF tries again."
            }
        }
        guard let s = last else { return "Not synced with \(c) yet." }
        let time = s.at.formatted(date: Calendar.current.isDateInToday(s.at) ? .omitted : .abbreviated, time: .shortened)
        var parts: [String] = []
        let here = s.taken.count + s.removed.count
        if here > 0 { parts.append("\(here) changed here") }
        if !s.waitingHere.isEmpty { parts.append("\(s.waitingHere.count) waiting for your OK") }
        if !s.sent.isEmpty { parts.append("\(s.sent.count) sent to \(c)") }
        if !s.waitingThere.isEmpty { parts.append("\(s.waitingThere.count) waiting for your OK there") }
        return parts.isEmpty ? "Synced with \(c) at \(time)." : "Synced with \(c) at \(time): \(parts.joined(separator: ", "))."
    }

    func seen() { notices = [] }

    /// The toast after a sync (Tim, 11-18), the computer's own toast seen from the phone's side: what came from the
    /// computer (taken here, new or changed, and deleted there), what went to it, and what waits here for an OK.
    /// Switches aren't counted, as on the computer. Drafts in docs/IOS-APP-STRINGS.md.
    func toastWords(_ s: PhoneSync.Summary) -> String {
        let c = computerName ?? "your computer"
        let n = s.taken.count + s.removed.count, m = s.sent.count, k = s.waitingHere.count
        guard n + m + k > 0 else { return "Synced with \(c) · nothing new" }
        return "Synced with \(c) · \(n) from the computer, \(m) to it" + (k > 0 ? ", \(k) waiting for your OK" : "")
    }

    /// A sync that didn't happen, in the toast: always after Sync now; after an automatic one only when it's news.
    private func toast(problem code: String, _ why: String) {
        guard why == "now" || code != toldProblem else { return }
        toldProblem = code
        AppToast.shared.show(Self.problemWords(code, computerName ?? "your computer"), problem: true, seconds: 6)
    }

    static func problemWords(_ code: String, _ c: String) -> String {
        switch code {
        case "off": return "Not synced: syncing phone mods is off on \(c)"
        case "notFound": return "Not synced: can't find \(c). It may be asleep, on another Wi-Fi, or have no browser with TRIF open"
        case "removed": return "Not synced: this iPhone isn't connected to \(c) any more"
        case "denied": return "Not synced: TRIF needs Local Network access to find \(c)"
        default: return "Not synced with \(c) this time. TRIF tries again"
        }
    }

    /// "Last synced just now / 5 min ago / at 2:05 PM / Nov 17 at 2:05 PM" (nil: never), as the computer's phone line
    /// says its {ago}.
    func lastLine(now: Date = Date()) -> String? {
        guard let t = lastAt else { return nil }
        let secs = now.timeIntervalSince(t)
        if secs < 60 { return "Last synced just now" }
        if secs < 3600 { return "Last synced \(Int(secs / 60)) min ago" }
        let time = t.formatted(date: .omitted, time: .shortened)
        return Calendar.current.isDateInToday(t) ? "Last synced at \(time)" : "Last synced \(t.formatted(.dateTime.month(.abbreviated).day())) at \(time)"
    }

    private func name(_ id: String) -> String {
        if let m = store?.mods.first(where: { $0.id == id }) { return m.name }
        if let d = store?.trash.first(where: { $0.mod.id == id }) { return d.mod.name }
        let file = id.split(separator: "/").last.map(String.init) ?? id
        return file.hasSuffix(".js") ? String(file.dropLast(3)) : file
    }

    /// A sync's news for the person (each line once, at most 20 kept).
    private func tell(_ s: PhoneSync.Summary) {
        let c = computerName ?? "your computer"
        var add: [String] = []
        for (id, sib) in s.conflicts { add.append("\(name(id)) changed on both. Both are kept: “\(name(sib))” is beside it.") }
        for id in s.cameBack { add.append("\(name(id)) came back: it was changed on \(c).") }
        // (two different mods with one name: the computer's kept beside the phone's, under " (from your computer)")
        for (id, of) in s.apart { add.append("\(name(of)): two different mods had this name. The one from \(c) is now “\(name(id))”.") }
        for (id, why) in s.refused where !why.hasPrefix("rename to ") {
            if why == "computer: too-big" { add.append("\(name(id)) is too big to sync.") }
            else if why == "computer: bad-mod" { add.append("\(name(id)) didn't go to \(c): TRIF there can't read it.") }
            else if !why.hasPrefix("computer:") { add.append("\(name(id)) on \(c) has an error, so it isn't on this iPhone yet.") }
            // (busy, changed meanwhile: the next sync tries again, nothing to tell)
        }
        for (id, why) in s.skipped where why.contains("1 MB") { add.append("\(name(id)) is too big to sync.") }
        let fresh = add.filter { !notices.contains($0) }
        if !fresh.isEmpty { notices = Array((notices + fresh).suffix(20)) }
    }

    /// (development) the last sync, as the dev step `syncstate` says it.
    var describe: String {
        guard let s = last else { return "no sync yet\(lastProblem.map { " (\($0))" } ?? "")" }
        return "renamed \(s.renamed.map { "\($0.from)>\($0.to)" })\(s.unfinished ? " unfinished" : "") apart \(s.apart.map { "\($0.id)~\($0.of)" }) taken \(s.taken.sorted()) waitingHere \(s.waitingHere.sorted()) removed \(s.removed.sorted()) sent \(s.sent.sorted()) waitingThere \(s.waitingThere.map(\.id).sorted()) conflicts \(s.conflicts.map { "\($0.id)>\($0.sibling)" }) cameBack \(s.cameBack) switched \(s.switched.sorted()) refused \(s.refused.map(\.id)) skipped \(s.skipped.map(\.id)) later \(s.later)\(lastProblem.map { " problem \($0)" } ?? "")"
    }
}

@MainActor
final class PhoneLinkModel: ObservableObject {
    static let shared = PhoneLinkModel()
    @Published var shown = false
    @Published private(set) var computer: PairedComputer? = PhoneLinkKeys.shared.computer
    @Published private(set) var step: PhoneLinkPairer.Step?
    @Published private(set) var codeName: String?
    @Published var scanning = false
    @Published var note: String?
    private var pairer: PhoneLinkPairer?
    /// What the computer lists this iPhone as (Tim's default 17, 11-17): the person names it at pairing; "iPhone" to
    /// start with (iOS gives apps only "iPhone" for the device's name, without an entitlement TRIF doesn't ask for).
    @Published var phoneName: String = UserDefaults.standard.string(forKey: "phoneLinkName") ?? "iPhone" {
        didSet { UserDefaults.standard.set(phoneName, forKey: "phoneLinkName") }
    }
    /// The name as sent: trimmed, 60 characters at most, "iPhone" if empty.
    var sentName: String {
        let t = phoneName.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "iPhone" : String(t.prefix(60))
    }

    /// A `trif://pair` link (the Camera app, or a scan): pairs at once. False when it isn't a code.
    @discardableResult
    func open(_ text: String) -> Bool {
        shown = true
        scanning = false
        guard let code = PairCode.parse(text) else { note = "That isn't a code from TRIF on your computer."; return false }
        pair(code)
        return true
    }

    func pair(_ code: PairCode) {
        pairer?.cancel()
        note = nil
        codeName = code.name
        let screen = UIScreen.main.bounds.size
        let p = PhoneLinkPairer(code: code, phoneName: sentName,
                                device: ["name": UIDevice.current.model, "width": Int(screen.width), "height": Int(screen.height)],
                                endpoints: Self.devEndpoints)
        p.onStep = { [weak self] s in
            Task { @MainActor in
                guard let self, self.pairer === p else { return }
                self.step = s
                if case .paired = s { self.computer = PhoneLinkKeys.shared.computer }
            }
        }
        pairer = p
        step = .finding
        p.start()
    }

    func forget() {
        pairer?.cancel(); pairer = nil
        PhoneLinkKeys.shared.forget()
        computer = nil
        step = nil
    }

    func reset() { pairer?.cancel(); pairer = nil; step = nil; note = nil; scanning = false }

    /// (development) `-linkhost 127.0.0.1:<port>`: loopback only.
    static var devEndpoints: [NWEndpoint]? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-linkhost"), i + 1 < args.count else { return nil }
        let parts = args[i + 1].split(separator: ":")
        guard parts.count == 2, ["127.0.0.1", "localhost"].contains(String(parts[0])), let port = NWEndpoint.Port(String(parts[1])) else { return nil }
        return [.hostPort(host: "127.0.0.1", port: port)]
    }

    /// One line for the dev step {"phonepair": …}.
    var describe: String {
        let c = computer.map { "paired \($0.name) id \($0.id)" } ?? "not paired"
        let s: String
        switch step {
        case nil: s = "idle"
        case .finding?: s = "finding"
        case .connecting?: s = "connecting"
        case .paired(let n)?: s = "paired(\(n))"
        case .failed(let f)?: s = "failed(\(f))"
        }
        return "\(c); step \(s)" + (note.map { "; note \($0)" } ?? "")
    }
}

struct PhoneLinkView: View {
    @ObservedObject var model = PhoneLinkModel.shared
    @ObservedObject var sync = PhoneSyncModel.shared
    @Environment(\.dismiss) private var dismiss
    @State private var camera = AVCaptureDevice.authorizationStatus(for: .video)

    private var computerName: String { model.codeName ?? model.computer?.name ?? PairCode.fallbackName }

    var body: some View {
        NavigationStack {
            List {
                if model.scanning {
                    Section { scanner } footer: { Text("Scan the code in TRIF's Settings on your computer: Connect a phone.") }
                } else if let step = model.step {
                    Section { progress(step) }
                } else if let c = model.computer {
                    Section {
                        Text("Connected to \(c.name) since \(c.pairedAt.formatted(date: .abbreviated, time: .omitted)).")
                        lastSynced
                    }
                }
                if let note = model.note { Section { Text(note).foregroundStyle(.red) } } // (a QR that isn't TRIF's, too)
                if !model.scanning {
                    if model.computer == nil && model.step == nil {
                        Section {
                            Text("Your coding agent on your computer makes the mod. In TRIF on your computer, open Settings, choose Connect a phone, and scan the code.")
                        }
                    }
                    if model.computer == nil {
                        // (what the computer lists this iPhone as: Tim's default 17)
                        Section {
                            TextField("iPhone", text: $model.phoneName)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .submitLabel(.done)
                        } header: { Text("This iPhone's name") } footer: { Text("What TRIF on your computer calls this iPhone.") }
                    }
                    Section {
                        Button(model.computer == nil ? "Scan the code" : "Scan a new code") { model.reset(); model.scanning = true }
                        if let c = model.computer {
                            Button("Forget \(c.name)", role: .destructive) { model.forget() }
                        }
                    } footer: {
                        if model.computer != nil { Text("Your computer still lists this iPhone until you remove it there.") }
                    }
                }
            }
            .navigationTitle("My computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { model.reset(); dismiss() }
                }
            }
        }
    }

    /// When mods last synced with the computer ("just now" kept true while it shows); nothing before the first sync.
    private var lastSynced: some View {
        TimelineView(.periodic(from: .now, by: 30)) { t in
            if let line = sync.lastLine(now: t.date) { Text(line).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private var scanner: some View {
        switch camera {
        case .authorized:
            if QRScanner.available {
                QRScanner { text in
                    if PairCode.parse(text) != nil { model.open(text) } else { model.note = "That isn't a code from TRIF on your computer." }
                }
                .frame(height: 300)
                .listRowInsets(EdgeInsets())
                .accessibilityLabel("The camera, to scan the code")
            } else {
                Text("This iPhone has no camera to scan with.")
            }
        case .notDetermined:
            ProgressView().task {
                _ = await AVCaptureDevice.requestAccess(for: .video)
                camera = AVCaptureDevice.authorizationStatus(for: .video)
            }
        default:
            Text("TRIF can't use the camera. Turn it on in Settings, then TRIF, then Camera.")
            Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
        }
    }

    @ViewBuilder private func progress(_ step: PhoneLinkPairer.Step) -> some View {
        switch step {
        case .finding: Label { Text("Looking for \(computerName) on your Wi-Fi…") } icon: { ProgressView() }
        case .connecting: Label { Text("Connecting to \(computerName)…") } icon: { ProgressView() }
        case .paired(let name):
            Label("Connected to \(name).", systemImage: "checkmark.circle")
            lastSynced
        case .failed(let f):
            Text(Self.words(f, computerName)).foregroundStyle(.red)
            if f == .denied {
                Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
            }
        }
    }

    static func words(_ f: PhoneLinkPairer.Failure, _ computer: String) -> String {
        switch f {
        case .notFound: return "Can't find \(computer). It may be asleep, on another Wi-Fi, or have no browser with TRIF open."
        case .refused: return "That code didn't work: it may have been used already or be more than 5 minutes old. Show a new one on \(computer) and scan it again."
        case .denied: return "TRIF needs Local Network access to find \(computer). Turn it on in Settings, then TRIF, then Local Network."
        case .broken: return "Something on your Wi-Fi answered as \(computer) but isn't it. TRIF didn't connect."
        case .keychain: return "This iPhone couldn't keep the connection's key. Try again."
        case .selfTest: return "TRIF's encryption didn't pass its check on this iPhone, so TRIF won't connect."
        }
    }
}

/// The camera, reading QR codes: `found` with each code's text (once per text).
struct QRScanner: UIViewRepresentable {
    let found: (String) -> Void
    static var available: Bool { AVCaptureDevice.default(for: .video) != nil }

    func makeCoordinator() -> Coordinator { Coordinator(found) }

    func makeUIView(context: Context) -> Preview {
        let v = Preview()
        let c = context.coordinator
        guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device),
              c.session.canAddInput(input) else { return v }
        c.session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard c.session.canAddOutput(output) else { return v }
        c.session.addOutput(output)
        output.setMetadataObjectsDelegate(c, queue: .main)
        output.metadataObjectTypes = [.qr]
        v.layer.session = c.session
        v.layer.videoGravity = .resizeAspectFill
        let s = c.session
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
        return v
    }

    func updateUIView(_ uiView: Preview, context: Context) {}

    static func dismantleUIView(_ uiView: Preview, coordinator: Coordinator) {
        let s = coordinator.session
        DispatchQueue.global(qos: .userInitiated).async { s.stopRunning() }
    }

    final class Preview: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        override var layer: AVCaptureVideoPreviewLayer { super.layer as! AVCaptureVideoPreviewLayer }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let session = AVCaptureSession()
        let found: (String) -> Void
        private var last: String?
        init(_ found: @escaping (String) -> Void) { self.found = found }
        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            for case let o as AVMetadataMachineReadableCodeObject in objects {
                guard let text = o.stringValue, text != last else { continue }
                last = text
                found(text)
            }
        }
    }
}
