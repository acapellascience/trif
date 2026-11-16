// The probe's own test pages (mobile/shared/pages), served to the web view at trifprobe://pages/… with each
// page's own headers (pages.json), so a strict page really is strict. /trif-install is the address a mod
// link would have; /trif-probe-canary is what the network checks ask for.

import Foundation
import WebKit

final class PageSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "trifprobe"
    static let home = "trifprobe://pages/"

    private let folder: URL?
    private var headers: [String: [String: String]] = [:]
    private(set) var canaryRequests = 0

    override init() {
        folder = Bundle.main.resourceURL?.appendingPathComponent("pages")
        super.init()
        if let folder = folder,
           let data = try? Data(contentsOf: folder.appendingPathComponent("pages.json")),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: [String: String]] {
            headers = parsed
        }
    }

    var pageNames: [String] { headers.keys.sorted().filter { $0 != "install.html" } }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var name = url.lastPathComponent
        if name == "trif-probe-canary" {
            canaryRequests += 1
            respond(urlSchemeTask, url, 200, "text/plain", ["Cache-Control": "no-store"], Data("canary".utf8))
            return
        }
        if name == "trif-install" { name = "install.html" }
        if name.isEmpty || name == "/" || name == "pages" { name = "plain.html" }
        let safe = name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil
        guard safe, let folder = folder, let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else {
            respond(urlSchemeTask, url, 404, "text/plain", [:], Data("not found".utf8))
            return
        }
        let type: String
        switch (name as NSString).pathExtension {
        case "html": type = "text/html; charset=utf-8"
        case "js": type = "text/javascript; charset=utf-8"
        case "css": type = "text/css; charset=utf-8"
        case "json": type = "application/json"
        default: type = "application/octet-stream"
        }
        var fields = headers[name] ?? [:]
        fields["Cache-Control"] = "no-store"
        respond(urlSchemeTask, url, 200, type, fields, data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ status: Int, _ type: String, _ extra: [String: String], _ data: Data) {
        var fields = extra
        fields["Content-Type"] = type
        fields["Content-Length"] = String(data.count)
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
