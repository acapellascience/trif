// Tabs (branch ios-poc): several pages open at once, each in a web view of its own with its own back and forward,
// all sharing one configuration (so the same scripts, mods, cookies and sign-ins). Kept between launches: each
// tab's address, title and back/forward list (WebKit's interactionState), restored when the tab is first shown.

import SwiftUI
import WebKit

@MainActor
final class Tab: ObservableObject, Identifiable {
    let id: UUID
    /// Its web view: made again when the tab comes back after being let go in the background (Browser.discard).
    private(set) var webView: WKWebView
    func replaceWebView(_ wv: WKWebView) { webView = wv }
    @Published var title: String
    @Published var url: URL?
    @Published var loading = false
    /// A picture of the page, for the tab switcher (TabShots: taken when the tab is left, the app goes to the
    /// background, the switcher opens, or a page has loaded; kept in Caches, so restored tabs have theirs).
    @Published var snapshot: UIImage?
    /// What to restore when the tab is first shown: its back/forward list, else its address.
    var savedState: Data?
    var savedURL: URL?
    var started = false
    var watches: [NSKeyValueObservation] = []

    init(id: UUID = UUID(), webView: WKWebView, title: String = "", url: URL? = nil) {
        self.id = id
        self.webView = webView
        self.title = title
        self.url = url
    }

    /// The tab's name in the switcher: its title, else its host, else New tab.
    var label: String { !title.isEmpty ? title : url?.host ?? (savedURL?.host ?? "New tab") }
    var host: String { (url ?? savedURL)?.host ?? "" }
}

/// The tabs' pictures for the switcher (Tim, 11-15: only the shown tab had one; the others were letters): each
/// taken from the tab's web view at the card's size (its width at the screen's scale), shown at once, and kept as a
/// JPEG in Caches/tab-shots/<tab id>.jpg, written off the main thread, so a tab restored at launch shows its last
/// one. A tab's picture goes when it's closed. Only a web view on the screen can be pictured, so a tab is taken as
/// it's left, not afterwards.
@MainActor
final class TabShots {
    static let shared = TabShots()
    /// About a card's width in points (two columns on a phone); the picture is that times the screen's scale.
    private static let width: CGFloat = 200
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tab-shots", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private let io = DispatchQueue(label: "trif.tab-shots", qos: .utility)
    private func file(_ id: UUID) -> URL { dir.appendingPathComponent("\(id.uuidString).jpg") }

    /// Pictures the tab now, if its page is on the screen; a failed try keeps the picture it had. Each try is in the
    /// diagnostics (11-16): taken or not, why, its size, saved or not.
    func take(_ tab: Tab, _ why: String = "") {
        let wv = tab.webView
        let host = tab.host.isEmpty ? "a new tab" : tab.host
        guard wv.url != nil else { return }
        guard wv.window != nil, wv.bounds.width > 10 else {
            Diagnostics.shared.log("tab shot", "\(host) (\(why)): not taken, its page isn't on the screen\(wv.window == nil ? "" : " (no size)")")
            return
        }
        let url = file(tab.id)
        let io = self.io
        let cfg = WKSnapshotConfiguration()
        cfg.snapshotWidth = NSNumber(value: Double(TabShots.width))
        cfg.afterScreenUpdates = false
        wv.takeSnapshot(with: cfg) { [weak tab] image, error in
            guard let tab else { return }
            guard let image, image.size.width > 1 else {
                Diagnostics.shared.log("tab shot", "\(host) (\(why)): WebKit gave no picture\(error.map { ": \($0.localizedDescription)" } ?? ""); the one before is kept")
                return
            }
            tab.snapshot = image
            let size = "\(Int(image.size.width * image.scale))x\(Int(image.size.height * image.scale))"
            io.async {
                let outcome: String
                if let data = image.jpegData(compressionQuality: 0.7) {
                    do { try data.write(to: url, options: .atomic); outcome = "saved, \(data.count / 1000) kB" } catch { outcome = "not saved: \(error.localizedDescription)" }
                } else { outcome = "not saved: no JPEG" }
                Diagnostics.logLater("tab shot", "\(host) (\(why)): taken, \(size), \(outcome)")
            }
        }
    }

    /// A restored tab's last picture, read off the main thread.
    func load(_ tab: Tab) {
        guard tab.snapshot == nil else { return }
        let url = file(tab.id)
        let host = tab.host.isEmpty ? "a new tab" : tab.host
        let scale = tab.webView.traitCollection.displayScale > 0 ? tab.webView.traitCollection.displayScale : 2
        io.async {
            guard let data = try? Data(contentsOf: url), let image = UIImage(data: data, scale: scale) else {
                Diagnostics.logLater("tab shot", "\(host): no picture kept from before (\(FileManager.default.fileExists(atPath: url.path) ? "its file unreadable" : "no file"))")
                return
            }
            DispatchQueue.main.async { [weak tab] in if let tab, tab.snapshot == nil { tab.snapshot = image } }
        }
    }

    func remove(_ id: UUID) {
        let url = file(id)
        io.async { try? FileManager.default.removeItem(at: url) }
    }
}

/// What's kept of the tabs between launches (Application Support/tabs.json).
struct SavedTabs: Codable {
    struct One: Codable { var id: UUID; var url: String?; var title: String; var state: Data? }
    var tabs: [One]
    var selected: UUID?

    static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("tabs.json")
    }
    static func load() -> SavedTabs? { (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(SavedTabs.self, from: $0) } }
    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        var url = SavedTabs.file
        try? data.write(to: url, options: .atomic)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }
}

/// The tab switcher: every tab as a card (its picture and title), tap to switch, × to close, + for a new one.
struct TabsView: View {
    @EnvironmentObject var browser: Browser
    /// Closes it (it lies over the page, the toolbar under it).
    var close: () -> Void = {}
    private func dismiss() { close() }
    private let columns = [GridItem(.flexible(minimum: 60), spacing: 14, alignment: .top), GridItem(.flexible(minimum: 60), spacing: 14, alignment: .top)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(browser.tabs) { tab in
                        TabCard(tab: tab, current: tab.id == browser.current.id,
                                select: { browser.select(tab); dismiss() },
                                close: { withAnimation { browser.close(tab) } })
                    }
                }
                .padding(14)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(browser.tabs.count == 1 ? "1 tab" : "\(browser.tabs.count) tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { browser.newTab(); dismiss() } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New tab")
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

struct TabCard: View {
    /// A card's width to its height: about a phone screen's, a little shorter, so two rows show on a small one.
    static let shape: CGFloat = 0.7
    @ObservedObject var tab: Tab
    let current: Bool
    let select: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                Button(action: select) {
                    // (a portrait card the column's width: the shape is set by a clear frame, the picture laid over it
                    // and clipped, so a wide picture can't widen the card past its column. Tim, 11-15, on an SE: it did)
                    Color(.secondarySystemBackground)
                        .aspectRatio(TabCard.shape, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            if let shot = tab.snapshot {
                                // (top-aligned, the card's width, cut off at the bottom)
                                Image(uiImage: shot).resizable().scaledToFill()
                                    .frame(minWidth: 0, maxWidth: .infinity, alignment: .top)
                            } else {
                                // (a tab never pictured yet: its site's letter, and the site)
                                VStack(spacing: 4) {
                                    Text(String(tab.host.replacingOccurrences(of: "www.", with: "").prefix(1)).uppercased())
                                        .font(.largeTitle.bold())
                                    if !tab.host.isEmpty {
                                        Text(tab.host.replacingOccurrences(of: "www.", with: "")).font(.caption2).lineLimit(1).padding(.horizontal, 6)
                                    }
                                }
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(current ? Color.trifGreen : Color(.separator), lineWidth: current ? 3 : 0.5))
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                Button(action: close) {
                    Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.white)
                        .frame(width: 24, height: 24).background(Circle().fill(Color.black.opacity(0.55)))
                }
                .padding(6)
                .accessibilityLabel("Close \(tab.label)")
            }
            Text(tab.label).font(.caption).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A new tab's page: the address bar is ready to type in; under it, the sites visited lately.
struct NewTabView: View {
    @EnvironmentObject var browser: Browser
    @ObservedObject var history: HistoryStore

    var body: some View {
        List {
            let recent = history.recentSites(12)
            if recent.isEmpty {
                Text("Type an address or a search above.").foregroundStyle(.secondary)
            } else {
                Section("Visited lately") {
                    ForEach(recent, id: \.url) { e in
                        Button { browser.go(e.url) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title.isEmpty ? e.host : e.title).lineLimit(1)
                                Text(e.host).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}
