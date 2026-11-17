// Several Home Screen icons in one install (Tim, 11-16: "have a queue of unexported and then you could batch it").
// In the [+] sheet, "Add to Home Screen later" puts the icon, with all its choices, on a list kept across restarts;
// the list (⋯ → Home Screen icons to add, or the sheet's "Add them all…") makes one profile with one Web Clip per
// site: one download, one trip to Settings, one Install. What iOS does (Simulator, iOS 26.3, 11-17):
// - A profile installed with the same identifier as one already there replaces it, all its icons (new ones made).
// - A Web Clip's own identifier (or UUID) shared with another profile's does nothing: both icons stay. So a site's
//   icon is replaced only by a profile with the same identifier: its own (adding it alone again), or this list's
//   (handing the list again, until it's cleared). Each new list gets its own identifier, so it never removes an
//   earlier one; a list holding every site of an earlier list takes that one's identifier and replaces it.
// - Each icon from a profile can still be deleted from the Home Screen on its own (IsRemovable: press and hold,
//   Delete Bookmark); removing the profile in Settings removes all of its icons.
// The list is cleared once TRIF is opened from one of its icons (their links carry the profile's tag: `set`), or when
// the person clears it.

import SwiftUI
import UIKit

/// An icon waiting on the list: the site and every choice the [+] sheet makes, and its pictures.
struct QueuedIcon: Identifiable, Codable {
    var id = UUID()
    var site: String
    var start: String
    var siteName: String
    var user: String?
    var source: String
    var nameChoice: IconName = .onTrif
    var customName = ""
    var outline = true
    var swatch = 0
    /// The colour picker's colour (red, green, blue), used when swatch is -1.
    var other: [Double] = [0x0e / 255, 0xa5 / 255, 0xe9 / 255]
    var badge = false
    var added = Date()
    /// The site's own picture and the one chosen from Photos (kept as files beside the list).
    var siteIcon: UIImage?
    var picture: UIImage?

    enum CodingKeys: String, CodingKey { case id, site, start, siteName, user, source, nameChoice, customName, outline, swatch, other, badge, added }

    static func rgb(_ c: UIColor) -> [Double] {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
        return [Double(r), Double(g), Double(b)]
    }
    var otherColour: UIColor { UIColor(red: other[safe: 0] ?? 0, green: other[safe: 1] ?? 0, blue: other[safe: 2] ?? 0, alpha: 1) }
    var label: String { nameChoice.label(site: siteName, user: user, custom: customName) }
    var look: IconLook {
        IconLook(outline: outline, colour: swatch < 0 ? otherColour : outlineSwatches[max(0, min(swatch, outlineSwatches.count - 1))].colour, badge: badge)
    }
    @MainActor var face: SiteFace {
        SiteFace(site: site, start: URL(string: start) ?? URL(string: "https://\(site)/")!, name: siteName, icon: siteIcon ?? WebClipMaker.letterTile(siteName), source: source, user: user)
    }
    /// The picture the icon shows.
    @MainActor var shown: UIImage { picture ?? face.icon! }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

@MainActor
final class IconQueue: ObservableObject {
    static let shared = IconQueue()
    /// At most this many (the clip page takes up to 20 icons a profile).
    static let limit = 20
    @Published private(set) var items: [QueuedIcon] = []
    /// Counts the person's changes to the list (a change starts the hand-off over: the profile is made again).
    @Published private(set) var edits = 0
    /// The list's profile tag, from its first hand-off until it's cleared (handing it again replaces what it installed).
    private(set) var tag: String?

    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("IconQueue", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private struct Saved: Codable { var items: [QueuedIcon]; var tag: String? }

    init() { load() }

    func item(for site: String) -> QueuedIcon? { items.first { $0.site == site } }

    /// On the list: in place of the same site's (keeping its place), else at the end.
    func put(_ q: QueuedIcon) {
        var q = q
        if let i = items.firstIndex(where: { $0.site == q.site }) {
            q.id = items[i].id
            items[i] = q
        } else {
            guard items.count < IconQueue.limit else { return }
            items.append(q)
        }
        write(pictures: q)
        edits += 1
        save()
    }

    func remove(_ id: UUID) {
        items.removeAll { $0.id == id }
        removePictures(id)
        edits += 1
        save()
        Diagnostics.shared.log("icon", "took an icon off the list (\(items.count) left)")
    }

    /// The list emptied: the person cleared it, or its profile was installed (`installed`: the steps stay, saying so).
    func clear(why: String) {
        for q in items { removePictures(q.id) }
        clearedCount = items.count
        items = []
        tag = nil
        handedSingle = nil
        save()
        Diagnostics.shared.log("icon", "the list of icons waiting cleared: \(why)")
    }

    /// The one icon on the list was handed as its site's own profile (no tag in its link): this site.
    var handedSingle: String?
    /// How many icons were on the list when it was last cleared (the steps' words, after it's done).
    private(set) var clearedCount = 0

    /// TRIF was opened from a Home Screen icon (`set`: the profile tag in its link): if it's the list's profile, it's
    /// installed and the list is cleared.
    func opened(site: String, set: String?) {
        guard !items.isEmpty else { return }
        if let set, set == tag { clear(why: "opened from one of its icons (set \(set))") }
        else if set == nil, items.count == 1, items[0].site == site, handedSingle == site { clear(why: "opened from its icon (\(site))") }
    }

    /// The tag for the list's profile: its own if it was handed before; else an earlier list's whose sites are all on
    /// this one (so it replaces that one); else a new one.
    func profileTag() -> String {
        if let tag { return tag }
        let sites = Set(items.map(\.site))
        let prefix = WebClipMaker.batchPrefix
        let reuse = IconQueue.records.filter { $0.key.hasPrefix(prefix) && !$0.value.isEmpty && Set($0.value).isSubset(of: sites) }
            .max { $0.value.count < $1.value.count }?.key
        let t = reuse.map { String($0.dropFirst(prefix.count)) }
            ?? String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10)).lowercased()
        tag = t
        save()
        return t
    }

    // MARK: profiles handed out (which sites went in which profile: for "added before")

    /// Profile identifier → its sites, for every profile TRIF has handed to Safari or Files on this phone.
    static var records: [String: [String]] { UserDefaults.standard.dictionary(forKey: "iconProfiles") as? [String: [String]] ?? [:] }
    static func recordHanded(id: String, sites: [String]) {
        var r = records
        r[id] = sites
        UserDefaults.standard.set(r, forKey: "iconProfiles")
    }
    /// Which of these sites went in another profile before (its icon may still be on the Home Screen).
    static func addedBefore(_ sites: [String], except id: String) -> Set<String> {
        let others = records.filter { $0.key != id }.values.flatMap { $0 }
        return Set(sites).intersection(others)
    }

    // MARK: files

    private func save() {
        let s = Saved(items: items, tag: tag)
        if let d = try? JSONEncoder().encode(s) { try? d.write(to: dir.appendingPathComponent("queue.json"), options: .atomic) }
    }
    private func load() {
        guard let d = try? Data(contentsOf: dir.appendingPathComponent("queue.json")), let s = try? JSONDecoder().decode(Saved.self, from: d) else { return }
        tag = s.tag
        items = s.items.map { q in
            var q = q
            q.siteIcon = UIImage(contentsOfFile: dir.appendingPathComponent("\(q.id.uuidString)-site.png").path).map { UIImage(cgImage: $0.cgImage!, scale: 2, orientation: .up) }
            q.picture = UIImage(contentsOfFile: dir.appendingPathComponent("\(q.id.uuidString)-picture.png").path).map { UIImage(cgImage: $0.cgImage!, scale: 2, orientation: .up) }
            return q
        }
    }
    private func write(pictures q: QueuedIcon) {
        let site = dir.appendingPathComponent("\(q.id.uuidString)-site.png"), pic = dir.appendingPathComponent("\(q.id.uuidString)-picture.png")
        if let d = q.siteIcon?.pngData() { try? d.write(to: site, options: .atomic) }
        if let d = q.picture?.pngData() { try? d.write(to: pic, options: .atomic) } else { try? FileManager.default.removeItem(at: pic) }
    }
    private func removePictures(_ id: UUID) {
        for k in ["site", "picture"] { try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id.uuidString)-\(k).png")) }
    }
}

extension WebClipMaker {
    static let batchPrefix = "com.timsrobot.trif.webclip.batch."

    /// The profile's name in Settings: "TRIF icons: X, YouTube, NYT", the first three and how many more after four.
    static func batchName(_ names: [String]) -> String {
        let list = names.count <= 4 ? names.joined(separator: ", ") : names.prefix(3).joined(separator: ", ") + " and \(names.count - 3) more"
        return "TRIF icons: \(list)"
    }

    /// The list's profile: one Web Clip per icon, each removable on its own, full screen, its link carrying the tag.
    /// The pictures step down together (360 px, 270, 180: 180 is already a 3× phone's icon) until the profile fits the
    /// clip page's 400,000 bytes; past that it goes as it is at 180 px, by the server on the phone (ProfileHandoff).
    static func batchProfile(_ items: [QueuedIcon], tag: String) -> (data: Data, px: Int)? {
        let id = batchPrefix + tag
        let labels = items.map(\.label)
        var last: (Data, Int)?
        for scale: CGFloat in [2, 1.5, 1] {
            var clips: [[String: Any]] = []
            for q in items {
                guard let png = compose(q.shown, look: q.look, scale: scale).pngData() else { return nil }
                let cid = "\(id).\(q.site)"
                clips.append([
                    "PayloadType": "com.apple.webClip.managed", "PayloadVersion": 1,
                    "PayloadIdentifier": cid, "PayloadUUID": stableUUID(cid),
                    "PayloadDisplayName": "\(q.siteName) for TRIF",
                    "Label": q.label, "URL": TrifLink.link(to: q.face.start, set: tag).absoluteString, "Icon": png,
                    "IsRemovable": true, "FullScreen": true, "Precomposed": true,
                ])
            }
            let n = items.count
            let p: [String: Any] = [
                "PayloadType": "Configuration", "PayloadVersion": 1,
                "PayloadIdentifier": id, "PayloadUUID": stableUUID(id),
                "PayloadDisplayName": batchName(items.map(\.siteName)),
                "PayloadDescription": "Adds \(n) icons to your Home Screen that open their sites in TRIF: \(labels.map { "“\($0)”" }.joined(separator: ", ")). Removing this profile removes all \(n).",
                "PayloadOrganization": "TRIF", "PayloadRemovalDisallowed": false,
                "PayloadContent": clips,
            ]
            guard let d = try? PropertyListSerialization.data(fromPropertyList: p, format: .xml, options: 0) else { return nil }
            last = (d, Int(side * scale))
            if d.count <= 400_000 { return last }
        }
        return last
    }

    /// The list as one job for the steps: one icon goes as its site's own profile (as the [+] sheet makes it); several
    /// as the list's profile.
    static func queueJob(_ queue: IconQueue) -> IconHandoffJob? {
        let items = queue.items
        guard let first = items.first else { return nil }
        if items.count == 1 {
            guard let p = profile(first.face, name: first.label, picture: first.picture, look: first.look) else { return nil }
            IconQueue.recordHanded(id: profileID(first.site), sites: [first.site])
            queue.handedSingle = first.site
            return IconHandoffJob(data: p, name: "\(first.siteName) for TRIF", page: first.start.hasPrefix("https:"), batch: nil,
                                  log: "made the Home Screen icon for \(first.site) from the list (\(p.count / 1000) kB profile)", site: first.site)
        }
        let tag = queue.profileTag()
        guard let (data, px) = batchProfile(items, tag: tag) else { return nil }
        IconQueue.recordHanded(id: batchPrefix + tag, sites: items.map(\.site))
        return IconHandoffJob(data: data, name: "TRIF icons", page: items.allSatisfy { $0.start.hasPrefix("https:") }, batch: tag,
                              log: "made the list's profile, \(items.count) icons (\(items.map(\.site).joined(separator: ", "))), set \(tag), pictures \(px) px, \(data.count / 1000) kB")
    }
}

/// The list of icons waiting (⋯ → Home Screen icons to add): each one to change or take off, then all added in one
/// install, with what that means for removing them said first.
struct IconQueueView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var queue = IconQueue.shared
    @ObservedObject private var handoff = ProfileHandoff.shared
    @State private var editing: QueuedIcon?
    @State private var confirmClear = false

    private var n: Int { queue.items.count }
    private var started: Bool { handoff.state != .idle || handoff.savedToFiles }
    private var key: String { "batch:\(queue.edits)" }
    /// Sites on the list that went in another profile before.
    private var before: [String] {
        let id = queue.tag.map { WebClipMaker.batchPrefix + $0 } ?? (n == 1 ? WebClipMaker.profileID(queue.items[0].site) : "")
        let b = IconQueue.addedBefore(queue.items.map(\.site), except: id)
        return queue.items.filter { b.contains($0.site) }.map(\.siteName)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if n == 0 && !handoff.installed {
                        Text("No icons waiting. On a site, tap + and then Add to Home Screen later.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 24).padding(.top, 40)
                    } else {
                        if n > 0 { list }
                        if n > 1 && !handoff.installed {
                            Text("They go in one profile: one download and one Install in Settings. Removing that profile removes all \(n) icons together; you can still delete any one of them from the Home Screen (press and hold it, then Delete Bookmark).")
                                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 20)
                        }
                        if !before.isEmpty && !handoff.installed {
                            Text("Added before: \(before.joined(separator: ", ")). If an earlier icon is still on your Home Screen, this adds a second one: press and hold the old one, then Delete Bookmark.")
                                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 20)
                        }
                        IconHandoffSteps(count: n > 0 ? n : max(queue.clearedCount, 1), fileName: n == 1 ? "\(queue.items[0].siteName) for TRIF" : "TRIF icons",
                                         addTitle: n == 1 ? "Add to Home Screen" : "Add all \(n) to Home Screen", ready: n > 0) {
                            WebClipMaker.queueJob(queue)
                        }
                        if started && !handoff.installed {
                            Text(handoff.savedToFiles ? "A profile waits about 8 minutes in Settings. If it's gone, tap the file in Files again." : "A downloaded profile waits about 8 minutes. If it's gone from Settings, tap Download it again here.")
                                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 20)
                        }
                        if n > 0 {
                            Button(role: .destructive) { confirmClear = true } label: { Text("Clear the list").frame(maxWidth: 240) }
                                .buttonStyle(.bordered).tint(.red)
                        }
                    }
                }
                .padding(.bottom, 24)
            }
            .navigationTitle("Home Screen icons to add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .sheet(item: $editing) { WebClipSheet(editing: $0).environmentObject(browser) }
        .confirmationDialog("Clear \(n == 1 ? "the icon" : "all \(n) icons") from the list?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear the list", role: .destructive) { queue.clear(why: "the person cleared it") }
            Button("Cancel", role: .cancel) {}
        }
        .onAppear { handoff.begin(site: key) }
        .onChange(of: key) { _, k in handoff.begin(site: k) }
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(queue.items) { q in
                HStack(spacing: 12) {
                    Button { editing = q } label: {
                        HStack(spacing: 12) {
                            Image(uiImage: WebClipMaker.compose(q.shown, look: q.look, scale: 1)).resizable().frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 44 * 0.26, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(q.label).font(.body).lineLimit(1).foregroundStyle(.primary)
                                Text(q.site).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit \(q.label)")
                    Button { queue.remove(q.id) } label: { Image(systemName: "minus.circle.fill").font(.system(size: 20)).foregroundStyle(.red) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Take \(q.label) off the list")
                }
                .padding(.vertical, 8)
                if q.id != queue.items.last?.id { Divider().padding(.leading, 56) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemBackground)))
        .padding(.horizontal, 16)
        .disabled(handoff.installed)
    }
}
