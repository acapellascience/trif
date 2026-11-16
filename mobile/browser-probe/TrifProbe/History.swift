// History (branch ios-poc): the pages visited in any tab, newest first, searchable, kept only on the phone (a file
// in Application Support, left out of backups; nothing sends it anywhere). Also reads the history another browser
// exports: Safari's (Settings or File → Export Browsing Data: a folder or zip with History.json) and Chrome's
// (Google Takeout: Chrome/History.json, {"Browser History": [...]}).

import SwiftUI

struct HistoryEntry: Codable, Identifiable, Equatable {
    var id = UUID()
    var url: String
    var title: String
    var at: Date
    var host: String { URL(string: url)?.host ?? url }
}

@MainActor
final class HistoryStore: ObservableObject {
    @Published private(set) var entries: [HistoryEntry] = []   // oldest first
    private static let max = 20_000
    private var saveTask: Task<Void, Never>?

    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("history.json")
    }

    init() {
        if let data = try? Data(contentsOf: HistoryStore.file), let list = try? JSONDecoder().decode([HistoryEntry].self, from: data) { entries = list }
    }

    /// A page shown in a tab. The same address again within half an hour updates the visit (its title, its time).
    func visit(_ url: URL?, title: String) {
        guard let url, ["http", "https"].contains(url.scheme ?? "") else { return }
        let text = url.absoluteString
        if let i = entries.lastIndex(where: { $0.url == text }), entries[i].at > Date().addingTimeInterval(-1800) {
            var e = entries.remove(at: i)
            e.at = Date()
            if !title.isEmpty { e.title = title }
            entries.append(e)
        } else {
            entries.append(HistoryEntry(url: text, title: title, at: Date()))
            if entries.count > HistoryStore.max { entries.removeFirst(entries.count - HistoryStore.max) }
        }
        saveSoon()
    }

    /// A title that arrived after the page did.
    func retitle(_ url: URL?, _ title: String) {
        guard let text = url?.absoluteString, !title.isEmpty, let i = entries.lastIndex(where: { $0.url == text }), entries[i].title != title else { return }
        entries[i].title = title
        saveSoon()
    }

    func remove(_ ids: Set<UUID>) { entries.removeAll { ids.contains($0.id) }; saveSoon() }

    /// Clears what was visited since `since` (nil: all of it).
    func clear(since: Date?) {
        if let since { entries.removeAll { $0.at >= since } } else { entries = [] }
        saveSoon()
    }

    /// The most recent visit to each of the last few sites (a new tab's list).
    func recentSites(_ n: Int) -> [HistoryEntry] {
        var seen = Set<String>(), out: [HistoryEntry] = []
        for e in entries.reversed() where !seen.contains(e.host) {
            seen.insert(e.host)
            out.append(e)
            if out.count == n { break }
        }
        return out
    }

    /// Visits from another browser's export, merged by time (a visit already here isn't added twice).
    @discardableResult
    func importVisits(_ list: [HistoryEntry]) -> Int {
        let have = Set(entries.map { "\($0.url) \(Int($0.at.timeIntervalSince1970))" })
        let new = list.filter { !have.contains("\($0.url) \(Int($0.at.timeIntervalSince1970))") }
        entries = (entries + new).sorted { $0.at < $1.at }
        if entries.count > HistoryStore.max { entries.removeFirst(entries.count - HistoryStore.max) }
        saveSoon()
        return new.count
    }

    private func saveSoon() {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            self.saveNow()
        }
    }

    func saveNow() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        var url = HistoryStore.file
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// Another browser's history export, read: Safari's History.json ({"history": [{url, title, time_usec}]}) or
    /// Chrome's from Takeout ({"Browser History": [{url, title, time_usec}]}). nil when it's neither.
    nonisolated static func parseExport(_ data: Data) -> [HistoryEntry]? {
        guard let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let rows = (d["history"] ?? d["Browser History"]) as? [[String: Any]] else { return nil }
        return rows.compactMap { r in
            guard let url = r["url"] as? String, url.hasPrefix("http") else { return nil }
            let usec = (r["time_usec"] as? NSNumber)?.doubleValue ?? (r["visit_time"] as? NSNumber)?.doubleValue ?? 0
            guard usec > 0 else { return nil }
            return HistoryEntry(url: url, title: r["title"] as? String ?? "", at: Date(timeIntervalSince1970: usec / 1_000_000))
        }
    }
}

struct HistoryView: View {
    @EnvironmentObject var browser: Browser
    @ObservedObject var history: HistoryStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var asking = false

    private var shown: [HistoryEntry] {
        let all = history.entries.reversed()
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let list = q.isEmpty ? Array(all) : all.filter { $0.url.lowercased().contains(q) || $0.title.lowercased().contains(q) }
        return Array(list.prefix(1500))
    }

    private static let day: DateFormatter = { let f = DateFormatter(); f.dateStyle = .full; f.timeStyle = .none; f.doesRelativeDateFormatting = true; return f }()
    private static let time: DateFormatter = { let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .short; return f }()

    var body: some View {
        NavigationStack {
            let days = Dictionary(grouping: shown) { Calendar.current.startOfDay(for: $0.at) }
            List {
                if shown.isEmpty {
                    Text(search.isEmpty ? "No history yet. The pages you visit are kept here, on this phone only." : "Nothing in your history matches.")
                        .foregroundStyle(.secondary)
                }
                ForEach(days.keys.sorted(by: >), id: \.self) { day in
                    Section(HistoryView.day.string(from: day)) {
                        let rows = days[day] ?? []
                        ForEach(rows) { e in
                            Button { browser.go(e.url); dismiss() } label: {
                                HStack(alignment: .firstTextBaseline) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(e.title.isEmpty ? e.host : e.title).lineLimit(1)
                                        Text(e.url).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                                    }
                                    Spacer()
                                    Text(HistoryView.time.string(from: e.at)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .foregroundStyle(.primary)
                            .contextMenu {
                                Button("Open in a new tab") { browser.newTab(e.url); dismiss() }
                                Button("Copy address") { UIPasteboard.general.string = e.url }
                            }
                        }
                        .onDelete { idx in history.remove(Set(idx.map { rows[$0].id })) }
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search history")
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Clear…") { asking = true }.disabled(history.entries.isEmpty) }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Clear history", isPresented: $asking, titleVisibility: .visible) {
                Button("The last hour", role: .destructive) { history.clear(since: Date().addingTimeInterval(-3600)) }
                Button("Today", role: .destructive) { history.clear(since: Calendar.current.startOfDay(for: Date())) }
                Button("All history", role: .destructive) { history.clear(since: nil) }
            } message: {
                Text("Your history is kept only on this phone. Cleared, it's gone.")
            }
        }
    }
}

// MARK: the address screen (Tim, 11-15: "like Chrome")

/// What a tap on the address bar opens, over the page (the toolbar stays under it): the address field at the top
/// with the whole address, all selected so typing replaces it, and Cancel; the current page, with Copy and Edit;
/// then the history, newest first, narrowed to what matches the typing (title or address), all on the phone. Go
/// opens what's typed: an address, or a search on Google (Browser.address(for:)).
struct AddressScreen: View {
    @EnvironmentObject var browser: Browser
    @ObservedObject var history: HistoryStore
    let close: () -> Void
    @State private var text = ""
    @State private var editTick = 0
    @State private var copied = false

    private var current: String { browser.webView.url?.absoluteString ?? "" }
    private var typing: Bool { !text.isEmpty && text != current }
    private var shown: [HistoryEntry] {
        let q = typing ? text.trimmingCharacters(in: .whitespaces).lowercased() : ""
        var out: [HistoryEntry] = []
        var seen = Set<String>()
        for e in history.entries.reversed() {
            if !q.isEmpty && !e.url.lowercased().contains(q) && !e.title.lowercased().contains(q) { continue }
            // (one row for an address, whatever follows its #)
            guard seen.insert(e.url.components(separatedBy: "#")[0]).inserted else { continue }
            out.append(e)
            if out.count >= 200 { break }
        }
        return out
    }

    private func open(_ s: String) {
        browser.go(s)
        close()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                AddressField(text: $text, editTick: editTick, placeholder: "Search or type URL") { open(text) }
                    .frame(height: 38)
                    .padding(.horizontal, 10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(.secondarySystemBackground)))
                Button("Cancel", action: close)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            List {
                if !typing, !current.isEmpty {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(browser.title.isEmpty ? (browser.webView.url?.host ?? current) : browser.title).lineLimit(1)
                            Text(current).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        }
                        Spacer(minLength: 4)
                        Button {
                            UIPasteboard.general.string = current
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            copied = true
                        } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(copied ? "Copied" : "Copy link")
                        Button { text = current; editTick += 1 } label: { Image(systemName: "pencil") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Edit link")
                    }
                }
                Section {
                    ForEach(shown) { e in
                        Button { open(e.url) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title.isEmpty ? e.host : e.title).lineLimit(1)
                                Text(e.url).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                } header: {
                    if !typing { Text("History") }
                }
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.immediately)
        }
        .background(Color(.systemBackground))
        .onAppear { text = current }
    }
}

/// The address field: a UITextField, so the whole address can be selected when it opens (typing replaces it), and
/// Edit can put the cursor at its end. URL keyboard, Go.
struct AddressField: UIViewRepresentable {
    @Binding var text: String
    /// Changed by Edit: the field shows `text` with the cursor at its end, nothing selected.
    var editTick: Int
    var placeholder: String
    var go: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextField {
        let f = UITextField()
        f.placeholder = placeholder
        f.font = .preferredFont(forTextStyle: .subheadline)
        f.keyboardType = .webSearch
        f.returnKeyType = .go
        f.autocapitalizationType = .none
        f.autocorrectionType = .no
        f.spellCheckingType = .no
        f.clearButtonMode = .whileEditing
        f.textContentType = .URL
        f.delegate = context.coordinator
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        f.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        f.accessibilityLabel = "Address"
        DispatchQueue.main.async {
            f.text = text
            f.becomeFirstResponder()
            f.selectAll(nil)
        }
        return f
    }

    func updateUIView(_ f: UITextField, context: Context) {
        context.coordinator.parent = self
        if f.text != text { f.text = text }
        if context.coordinator.tick != editTick {
            context.coordinator.tick = editTick
            DispatchQueue.main.async {
                f.becomeFirstResponder()
                let end = f.endOfDocument
                f.selectedTextRange = f.textRange(from: end, to: end)
            }
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: AddressField
        var tick: Int
        init(_ p: AddressField) { parent = p; tick = p.editTick }
        @objc func changed(_ f: UITextField) { parent.text = f.text ?? "" }
        func textFieldShouldReturn(_ f: UITextField) -> Bool { parent.go(); return false }
    }
}
