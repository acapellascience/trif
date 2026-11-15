// Tabs (branch ios-poc): several pages open at once, each in a web view of its own with its own back and forward,
// all sharing one configuration (so the same scripts, mods, cookies and sign-ins). Kept between launches: each
// tab's address, title and back/forward list (WebKit's interactionState), restored when the tab is first shown.

import SwiftUI
import WebKit

@MainActor
final class Tab: ObservableObject, Identifiable {
    let id: UUID
    let webView: WKWebView
    @Published var title: String
    @Published var url: URL?
    @Published var loading = false
    /// A picture of the page, for the tab switcher (taken when the switcher opens, or the tab is left).
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
    @Environment(\.dismiss) private var dismiss
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
                                Image(uiImage: shot).resizable().scaledToFill()
                            } else {
                                Text(String(tab.host.replacingOccurrences(of: "www.", with: "").prefix(1)).uppercased())
                                    .font(.largeTitle.bold()).foregroundStyle(.secondary)
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
