// A Mac WebKit stand-in for the Simulator (11-17: the Mac's iOS runtime was gone): the phone's reader (gen/mods.js) reads a
// free mod with a style section; the scripts go in as ModStore.userScripts puts them (style-mirror and the relay
// in TRIF's world, the free runtime in the page's, the style script in TRIF's at the start, the mod in the page's);
// strict.html (style-src 'self') and plain.html load in an offscreen WKWebView; what applied, what the relay told,
// and a snapshot of each.
//
//   node mobile/serve.js 8377 &
//   swiftc -O mobile/test/webkit-check/main.swift -o <scratch>/wkcheck
//   <scratch>/wkcheck <repo> mobile/test/webkit-check/style-demo.js <shots dir> http://localhost:8377
//
// Prints what applied in each world and what reached the app's handler; an offscreen window, nothing shown.
import AppKit
import WebKit
import JavaScriptCore

let args = CommandLine.arguments
let repo = args[1], modPath = args[2], outDir = args[3], base = args[4]
let modsJS = try! String(contentsOfFile: "\(repo)/mobile/shared/gen/mods.js", encoding: .utf8)
let mirror = try! String(contentsOfFile: "\(repo)/mobile/browser-probe/TrifProbe/Web/style-mirror.js", encoding: .utf8)
let ctx = JSContext()!
ctx.evaluateScript(modsJS)
ctx.setObject(try! String(contentsOfFile: modPath, encoding: .utf8), forKeyedSubscript: "__input" as NSString)
let out = ctx.evaluateScript("JSON.stringify(__trifMods.readMod(__input, {site: 'localhost'}))")!.toString()!
let mod = try! JSONSerialization.jsonObject(with: Data(out.utf8)) as! [String: Any]
if let e = mod["error"] { print("read error: \(e)"); exit(1) }
let pageRT = ctx.evaluateScript("__trifMods.freePageScript")!.toString()!
let relay = ctx.evaluateScript("__trifMods.freeRelayScript")!.toString()!
print("read: \(mod["id"]!) tier \(mod["tier"]!) world \(mod["world"]!) at \(mod["at"]!) styleScript \((mod["styleScript"] as! String).count) chars")

let trifWorld = WKContentWorld.world(name: "trif")
final class H: NSObject, WKScriptMessageHandler {
    var lines: [String] = []
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        if let b = m.body as? [String: Any] { lines.append("\(b["kind"] ?? "") \(b["mod"] ?? "") \(b["path"] ?? ""): \(b["text"] ?? "")") }
    }
}
let h = H()
let cfg = WKWebViewConfiguration()
let ucc = cfg.userContentController
ucc.add(h, contentWorld: trifWorld, name: "trif")
ucc.addUserScript(WKUserScript(source: mirror, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: trifWorld))
ucc.addUserScript(WKUserScript(source: relay, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: trifWorld))
ucc.addUserScript(WKUserScript(source: pageRT, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
ucc.addUserScript(WKUserScript(source: mod["styleScript"] as! String, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: trifWorld))
ucc.addUserScript(WKUserScript(source: mod["script"] as! String, injectionTime: (mod["at"] as! String) == "start" ? .atDocumentStart : .atDocumentEnd, forMainFrameOnly: true, in: .page))

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let win = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 375, height: 667), styleMask: [.borderless], backing: .buffered, defer: false)
let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 375, height: 667), configuration: cfg)
win.contentView = wv
win.orderBack(nil)

func run(_ pages: [(String, String)], _ done: @escaping () -> Void) {
    guard let (name, shot) = pages.first else { return done() }
    h.lines = []
    wv.load(URLRequest(url: URL(string: "\(base)/\(name)")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
        let probe = "const b = getComputedStyle(document.documentElement, '::before'); return JSON.stringify({before: b.content, bg: b.backgroundColor, size: b.fontSize, ran: document.documentElement.getAttribute('data-demo-ran'), outline: getComputedStyle(document.body).outlineColor + ' ' + getComputedStyle(document.body).outlineWidth, trif: typeof window.trif, log: typeof (window.trif && window.trif.log)});"
        wv.callAsyncJavaScript(probe, arguments: [:], in: nil, in: .page) { r in
            print("\(name) page: \((try? r.get()) as? String ?? "\(r)")")
            wv.callAsyncJavaScript("const st = document.querySelector('style[data-trif-style]'); return JSON.stringify({style: !!st, pageTookIt: !!(st && st.sheet), adopted: document.adoptedStyleSheets.length, ran: globalThis.__trifRan || null});", arguments: [:], in: nil, in: trifWorld) { r2 in
                print("\(name) trif world: \((try? r2.get()) as? String ?? "\(r2)")")
                print("\(name) relay told:\n  " + h.lines.joined(separator: "\n  "))
                wv.takeSnapshot(with: nil) { img, _ in
                    if let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: "\(outDir)/\(shot)")); print("shot \(outDir)/\(shot)")
                    }
                    run(Array(pages.dropFirst()), done)
                }
            }
        }
    }
}
run([("strict.html", "291-mac-webkit-style-section-strict.png"), ("plain.html", "292-mac-webkit-style-section-plain.png")]) { exit(0) }
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("timed out"); exit(2) }
app.run()
