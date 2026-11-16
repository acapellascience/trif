// The app half of TRIF Probe's Safari extension: what the extension reaches with
// browser.runtime.sendNativeMessage. mobile/safari-probe/build.js puts this in place of the one Apple's
// converter writes. Each command answers one question about what this half could do for a TRIF on iPhone:
//   ping   a message comes back (with the size of what was sent)
//   info   what process this is, and how much memory the device has
//   write  it can keep a megabyte in a folder of its own and read it back (where mods would live)
//   fetch  it can ask the network for something itself (where a catalogue would come from)

import Foundation
import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        let command = message["command"] as? String ?? "ping"

        let finish: ([String: Any]) -> Void = { reply in
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }

        switch command {
        case "info":
            let p = ProcessInfo.processInfo
            finish([
                "process": p.processName,
                "bundle": Bundle.main.bundleIdentifier ?? "",
                "system": p.operatingSystemVersionString,
                "memoryMB": Int(p.physicalMemory / 1_048_576),
            ])
        case "write":
            let started = Date()
            do {
                let fm = FileManager.default
                let dir = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let file = dir.appendingPathComponent("trif-probe.bin")
                let data = Data(count: 1_048_576)
                try data.write(to: file, options: .atomic)
                let back = try Data(contentsOf: file)
                try fm.removeItem(at: file)
                finish(["ok": back.count == data.count, "ms": Int(Date().timeIntervalSince(started) * 1000), "folder": dir.lastPathComponent])
            } catch {
                finish(["ok": false, "error": error.localizedDescription])
            }
        case "fetch":
            let started = Date()
            guard let url = URL(string: "https://example.com/") else { finish(["ok": false]); return }
            let task = URLSession.shared.dataTask(with: url) { data, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                finish([
                    "ok": error == nil && status == 200,
                    "status": status,
                    "bytes": data?.count ?? 0,
                    "ms": Int(Date().timeIntervalSince(started) * 1000),
                    "error": error?.localizedDescription ?? "",
                ])
            }
            task.resume()
        default:
            let pad = message["pad"] as? String ?? ""
            finish(["command": "ping", "received": pad.count])
        }
    }
}
