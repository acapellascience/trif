// Mods that arrive by themselves (Tim, 11-16, approved): the phone half of desktop's Send to iPhone
// (docs/MOBILE-EDIT.md section 8, branch mobile-edit).
//
// - A folder the person picks once (iCloud Drive/TRIF, where the Mac copies a mod): kept as a security-scoped
//   bookmark; each time the app comes to the front, each .js file there not offered before (by name, size and date)
//   goes to the Add this mod? sheet, one at a time. Files in iCloud not yet on the phone are asked for, and offered
//   the next time. The person's files are only read: never moved, changed or deleted.
// - A QR code's link, trif://add?v=1&name=<site>-<mod>.js&z=<raw deflate, base64url>[&h=<16 hex of its sha256>]:
//   the mod's text unpacked (256 KB at most), checked against h, and offered the same way.
// Either way, nothing is added without the person's Add it.

import CryptoKit
import Compression
import Foundation
import UIKit

@MainActor
final class FolderWatch: ObservableObject {
    static let shared = FolderWatch()
    private let bookmarkKey = "watchFolder.bookmark"
    private let seenKey = "watchFolder.seen"
    /// The folder's name, while one is watched.
    @Published private(set) var folderName: String?
    private var scanning = false
    weak var browser: Browser?

    private init() {
        if let url = resolve() { folderName = url.lastPathComponent }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { FolderWatch.shared.scan("the app came to the front") }
        }
    }

    private func log(_ text: String) { Diagnostics.shared.log("folder", text) }

    /// The folder picked in Files: watched from now on (and looked through at once).
    func choose(_ url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else {
            browser?.status = "TRIF couldn't keep that folder."
            log("no bookmark for the folder picked")
            return
        }
        UserDefaults.standard.set(data, forKey: bookmarkKey)
        folderName = url.lastPathComponent
        log("watching \(url.lastPathComponent)")
        browser?.status = "TRIF looks in \(url.lastPathComponent) for new mods each time you open it."
        scan("the folder was picked")
    }

    func stop() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        log("stopped watching \(folderName ?? "the folder")")
        folderName = nil
    }

    private func resolve() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: bookmarkKey)
        }
        return url
    }

    /// The .js files in the folder not offered before, offered in turn (off the main thread to read them).
    func scan(_ why: String) {
        guard !scanning, let url = resolve(), let browser else { return }
        scanning = true
        let seen = Set(UserDefaults.standard.stringArray(forKey: seenKey) ?? [])
        Task.detached(priority: .utility) {
            let found = FolderWatch.newFiles(in: url, seen: seen)
            await MainActor.run {
                let me = FolderWatch.shared
                me.scanning = false
                if found.waiting > 0 { me.log("\(found.waiting) file(s) in iCloud not on the phone yet: asked for, next time") }
                if let e = found.error { me.log("couldn't look in \(url.lastPathComponent): \(e)"); return }
                guard !found.files.isEmpty else { return }
                me.log("\(found.files.count) new mod file(s) in \(url.lastPathComponent) (\(why)): \(found.files.map(\.name).joined(separator: ", "))")
                var list = UserDefaults.standard.stringArray(forKey: me.seenKey) ?? []
                list += found.files.map(\.key)
                if list.count > 2000 { list.removeFirst(list.count - 2000) }
                UserDefaults.standard.set(list, forKey: me.seenKey)
                Task { await browser.offerFiles(found.files.map { ($0.name, $0.text) }, from: url.lastPathComponent) }
            }
        }
    }

    struct Found { var files: [(name: String, key: String, text: String)] = []; var waiting = 0; var error: String? }

    nonisolated static func newFiles(in folder: URL, seen: Set<String>) -> Found {
        var out = Found()
        let ok = folder.startAccessingSecurityScopedResource()
        defer { if ok { folder.stopAccessingSecurityScopedResource() } }
        var coordinated: NSError?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &coordinated) { dir in
            let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
            guard let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: []) else {
                out.error = "it can't be read"
                return
            }
            for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let name = item.lastPathComponent
                // (a file iCloud hasn't brought to the phone yet: ".<name>.js.icloud"; asked for, offered next time)
                if name.hasPrefix("."), name.hasSuffix(".js.icloud") {
                    let real = item.deletingLastPathComponent().appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
                    try? FileManager.default.startDownloadingUbiquitousItem(at: real)
                    out.waiting += 1
                    continue
                }
                guard name.lowercased().hasSuffix(".js"), !name.hasPrefix(".") else { continue }
                let v = try? item.resourceValues(forKeys: Set(keys))
                guard v?.isRegularFile != false else { continue }
                let size = v?.fileSize ?? 0
                let key = "\(name)|\(size)|\(Int(v?.contentModificationDate?.timeIntervalSince1970 ?? 0))"
                guard !seen.contains(key), size > 0, size <= 2_000_000 else { continue }
                guard let data = try? Data(contentsOf: item), let text = String(data: data, encoding: .utf8) else { continue }
                out.files.append((name, key, text))
            }
        }
        if let coordinated, out.error == nil { out.error = coordinated.localizedDescription }
        return out
    }
}

/// trif://add?v=1&name=…&z=…[&h=…]: a mod in a link (a QR code's), unpacked and checked.
enum ModLinkInURL {
    static let maxSize = 256 * 1024
    /// (name, text) or why it can't be read.
    static func read(_ url: URL) -> (name: String, text: String)? {
        guard url.scheme?.lowercased() == "trif", url.host?.lowercased() == "add",
              let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        let get = { (k: String) in q.first(where: { $0.name == k })?.value }
        guard get("v") == "1", let z = get("z"), var name = get("name") else { return nil }
        name = (name as NSString).lastPathComponent
        if !name.lowercased().hasSuffix(".js") { name += ".js" }
        var b64 = z.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        guard let packed = Data(base64Encoded: b64), let data = inflate(packed), let text = String(data: data, encoding: .utf8) else { return nil }
        if let h = get("h")?.lowercased() {
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest.hasPrefix(h), h.count >= 8 else { return nil }
        }
        return (name, text)
    }

    /// Raw deflate, 256 KB at most unpacked (Apple's zlib is raw deflate).
    static func inflate(_ packed: Data) -> Data? {
        guard !packed.isEmpty else { return nil }
        var out = Data(count: maxSize + 1)
        let n = out.withUnsafeMutableBytes { dst in
            packed.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, maxSize + 1, src.bindMemory(to: UInt8.self).baseAddress!, packed.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard n > 0, n <= maxSize else { return nil }
        return out.prefix(n)
    }
}

extension Browser {
    /// Mod files from outside the chat (the watched folder, a QR code's link), each read with its file name (which
    /// tells its site) and offered in turn with Add this mod?; one already here as it is, left out.
    func offerFiles(_ files: [(name: String, text: String)], from: String) async {
        var found: [InstalledMod] = []
        var failed: [String] = []
        for (name, text) in files {
            let r = await mods.readInBackground(text, file: name, here: host)
            guard let m = r.mod else { failed.append("\(name): \(r.error ?? "no reason given")"); continue }
            if mods.mods.contains(where: { $0.id == m.id && $0.code == m.code }) || offerQueue.contains(where: { $0.id == m.id && $0.code == m.code }) { continue }
            found.append(m)
        }
        if !failed.isEmpty {
            status = "Couldn't read \(failed.count == 1 ? "a mod" : "\(failed.count) mods") from \(from): \(failed.prefix(3).joined(separator: "; "))."
            Diagnostics.shared.log("folder", "couldn't read from \(from): \(failed.joined(separator: "; "))")
        }
        guard !found.isEmpty else { return }
        if offerQueue.isEmpty && modOffer == nil { offerBatch = 0; offerShown = 0 }
        offerQueue += found
        offerBatch += found.count
        nextOffer()
    }
}
