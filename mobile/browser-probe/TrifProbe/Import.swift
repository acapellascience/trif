// Bringing things in from people's other browsers (branch ios-poc), and sending mods out.
//
// In: what desktop TRIF exports (helper/lib/share.js: a mod's file, <site>-<mod>.js, or a site's mods, a folder
// "<site> mods" of .js files; AirDropped from a Mac, a folder arrives as a .zip), picked in Files (Import mod…) or
// opened in the app from the share sheet or AirDrop (Info.plist's document types). Each mod is read as the helper
// reads it and added the way desktop imports one: off, marked new (updated, for one it replaces, the one before in
// its history), and held like any mod from outside when it can do more than change the page.
// Also another browser's history export (History.swift parseExport), from Safari's Export Browsing Data (a folder
// or zip with History.json) or Google Takeout (Chrome's History.json).
// Out: a mod as its file, or a site's mods as files in a folder "<site> mods", for the share sheet.

import Foundation
import Compression

enum ModFiles {
    /// What was picked or opened: the mod files in it (folders and zips gone through), and history exports.
    struct Found {
        var mods: [(name: String, text: String)] = []
        var history: [Data] = []
        var skipped: [String] = []
    }

    /// Mods as files to share: one, as <site>-<mod>.js (desktop's export name); several, in a folder `folder`.
    static func write(_ mods: [InstalledMod], folder: String? = nil) -> [URL]? {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString.prefix(8))")
        let dir = folder.map { base.appendingPathComponent($0) } ?? base
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            return try mods.map { m in
                let parts = m.id.split(separator: "/").map(String.init)
                let name = folder == nil ? "\(parts.first ?? "mod")-\(parts.last ?? "mod").js" : "\(parts.last ?? "mod").js"
                let url = dir.appendingPathComponent(name)
                try Data(m.code.utf8).write(to: url)
                return url
            }
        } catch { return nil }
    }

    /// Goes through files, folders and zip archives (at most `limit` bytes read in all: a mod is small, a browser's
    /// history export can be some megabytes).
    static func collect(_ urls: [URL], limit: Int = 64 * 1024 * 1024) -> Found {
        // (TRIF's own heavy job: a crash in it isn't blamed on the pages' mods)
        let job = HeavyJob.begin("importing files")
        defer { HeavyJob.end(job) }
        var found = Found()
        var budget = limit
        func take(name: String, data: Data) {
            let lower = name.lowercased()
            let last = (name as NSString).lastPathComponent
            if last.hasPrefix(".") || lower.contains("__macosx/") { return }
            if lower.hasSuffix(".js"), let text = String(data: data, encoding: .utf8) {
                found.mods.append((last, text))
            } else if lower.hasSuffix(".json"), HistoryStore.parseExport(data) != nil {
                found.history.append(data)
            } else if lower.hasSuffix(".zip") {
                for e in Zip.entries(data, limit: budget) { take(name: e.name, data: e.data) }
            } else {
                found.skipped.append(last)
            }
        }
        func visit(_ url: URL) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { found.skipped.append(url.lastPathComponent); return }
            if isDir.boolValue {
                let items = (try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)) ?? []
                for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) { visit(item) }
                return
            }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= budget, let data = try? Data(contentsOf: url) else { found.skipped.append(url.lastPathComponent); return }
            budget -= data.count
            take(name: url.lastPathComponent, data: data)
        }
        for u in urls { visit(u) }
        return found
    }
}

/// Just enough of the zip format to read an export: the central directory's entries, stored or deflated (no zip64,
/// no encryption), each at most a sixth of `limit` and all together at most `limit` once unpacked.
enum Zip {
    struct Entry { let name: String; let data: Data }

    static func entries(_ zip: Data, limit: Int) -> [Entry] {
        let b = [UInt8](zip)
        func u16(_ i: Int) -> Int { i + 2 <= b.count ? Int(b[i]) | Int(b[i + 1]) << 8 : 0 }
        func u32(_ i: Int) -> Int { i + 4 <= b.count ? u16(i) | u16(i + 2) << 16 : 0 }
        // (the end-of-central-directory record: in the last 64 KB plus its own 22 bytes)
        var eocd = -1
        var i = b.count - 22
        while i >= max(0, b.count - 65_557) { if u32(i) == 0x06054b50 { eocd = i; break }; i -= 1 }
        guard eocd >= 0 else { return [] }
        let count = u16(eocd + 10)
        var at = u32(eocd + 16)
        var out: [Entry] = []
        var total = 0
        for _ in 0..<count {
            guard u32(at) == 0x02014b50 else { break }
            let method = u16(at + 10), csize = u32(at + 20), usize = u32(at + 24)
            let nlen = u16(at + 28), xlen = u16(at + 30), clen = u16(at + 32), local = u32(at + 42)
            let name = String(decoding: b[min(at + 46, b.count)..<min(at + 46 + nlen, b.count)], as: UTF8.self)
            at += 46 + nlen + xlen + clen
            guard !name.hasSuffix("/"), usize <= limit / 6, total + usize <= limit, u32(local) == 0x04034b50 else { continue }
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            guard start + csize <= b.count else { continue }
            let packed = Data(b[start..<start + csize])
            var data: Data?
            if method == 0 { data = packed }
            else if method == 8 { data = inflate(packed, size: usize) }
            if let data { out.append(Entry(name: name, data: data)); total += data.count }
        }
        return out
    }

    /// Raw deflate (zip's method 8), with Apple's zlib (which is raw deflate, as zip has it).
    private static func inflate(_ packed: Data, size: Int) -> Data? {
        guard size > 0 else { return Data() }
        var out = Data(count: size)
        let n = out.withUnsafeMutableBytes { dst in
            packed.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size, src.bindMemory(to: UInt8.self).baseAddress!, packed.count, nil, COMPRESSION_ZLIB)
            }
        }
        return n == size ? out : nil
    }
}

extension Browser {
    /// Files picked in Files, or opened in the app (the share sheet, AirDrop): each mod imported, each history
    /// export merged. The status strip says what came in; the Mods tab opens on the mods.
    func importFiles(_ urls: [URL]) {
        let found = ModFiles.collect(urls)
        var added: [String] = [], failed: [String] = []
        for (name, text) in found.mods {
            let r = mods.read(text, file: name, here: host)
            guard let m = r.mod else { failed.append("Couldn't import \(name): \(r.error ?? "no reason given")"); continue }
            let kept = mods.add(m, source: "import")
            added.append(kept.name)
            report.log("import", "\(name) as \(kept.id)\(kept.held ? ", waiting for an OK" : "")")
        }
        var visits = 0
        for data in found.history { visits += history.importVisits(HistoryStore.parseExport(data) ?? []) }
        if !found.history.isEmpty { report.log("import", "history: \(visits) visit(s)") }
        if !added.isEmpty { modsChanged(reload: false) }
        var said: [String] = []
        if !added.isEmpty { said.append("Imported \(added.count == 1 ? "1 mod" : "\(added.count) mods"): \(added.joined(separator: ", ")). Like any mod from outside, \(added.count == 1 ? "it starts" : "they start") off, and \(added.count == 1 ? "waits" : "each waits") for your OK if \(added.count == 1 ? "its" : "its own") code can do more than change the page.") }
        if !found.history.isEmpty { said.append("Added \(visits) visit\(visits == 1 ? "" : "s") to your history.") }
        said += failed
        if said.isEmpty { said.append(found.skipped.isEmpty ? "Nothing to import there." : "Nothing TRIF can import there: \(found.skipped.prefix(5).joined(separator: ", ")).") }
        status = said.joined(separator: " ")
        if !added.isEmpty { wantsMods = true }
    }
}
