// The Mac app's side of TRIF for Safari (scripts/build-safari.js puts this file in the generated
// Xcode project). TRIF's extension asks its app for one thing: the key the helper's Safari bridge
// expects (~/Library/Application Support/TRIF/safari-token, TRIF's private folder, written by
// `trif setup --browser safari`). Until 0.2.1 it was ~/.trif/safari-token (~/.webmods/safari-token before
// 0.2.0, when TRIF was called WebMods): still read when the new one isn't there, for one version. Safari
// only lets an extension message its own app, so another Safari extension can't get the key and reach
// the helper.

import SafariServices
import Foundation

// SFExtensionMessageKey's value; the constant itself needs macOS 11, newer than the target's minimum.
let messageKey = "message"

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[messageKey] as? [String: Any]
        var reply: [String: Any] = [:]
        if message?["type"] as? String == "token" {
            // In the sandbox, NSHomeDirectory() is this extension's container; the key is in the real home
            // (the entitlements allow reading just that file).
            let home = String(cString: getpwuid(getuid()).pointee.pw_dir)
            let path = home + "/Library/Application Support/TRIF/safari-token"
            let paths = [path, home + "/.trif/safari-token", home + "/.webmods/safari-token"]
            if let token = paths.lazy.compactMap({ try? String(contentsOfFile: $0, encoding: .utf8) }).first {
                reply["token"] = token.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                reply["error"] = "couldn't read \(path); run: trif setup --browser safari"
            }
        } else {
            reply["error"] = "unknown request"
        }
        let response = NSExtensionItem()
        response.userInfo = [messageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
