// The model on this iPhone, tried on a Mac (mobile/local-model/harness.sh; harness/main.swift): the app's own LocalLlama.swift and
// LocalPrompt.swift, against llama.cpp's macOS slice, on one of the research's pages.
//   harness <model.gguf> <page: wikipedia|hn|guardian|testfeed> <styleJSON|file> <what I want> [runs]
import Foundation

let a = CommandLine.arguments
guard a.count >= 5 else { print("usage: harness <model.gguf> <page> <styleJSON|file> <request> [runs]"); exit(2) }
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let page = a[2]
let url = (try String(contentsOf: here.appendingPathComponent("research/outlines/\(page).url"), encoding: .utf8)).trimmingCharacters(in: .whitespacesAndNewlines)
let shown = url.hasPrefix("file:") ? "https://feed.example/home" : url
let outline = try String(contentsOf: here.appendingPathComponent("research/outlines/\(page).txt"), encoding: .utf8)
let mode = LocalPrompt.Mode(rawValue: a[3]) ?? .styleJSON
let guide = try String(contentsOf: here.appendingPathComponent("local-guide.txt"), encoding: .utf8)
let system = LocalPrompt.system(guide: guide, mode: mode)
let user = LocalPrompt.user(url: shown, outline: outline, request: a[4])
let origin = URL(string: shown).map { "\($0.scheme!)://\($0.host!)" }!
let grammar = mode == .styleJSON ? LocalPrompt.styleGrammar : LocalPrompt.fileGrammar(origin: origin)
let cache = FileManager.default.temporaryDirectory.appendingPathComponent("trif-\(mode.rawValue)-\(system.hashValue).state").path
let llama = try LocalLlama(path: a[1], nCtx: 6144)
print("loaded in \(llama.loadMs) ms")
for run in 1...(a.count > 5 ? Int(a[5]) ?? 1 : 1) {
    let t0 = Date()
    let (text, stats) = try llama.generate(system: system, user: user, grammar: grammar, maxTokens: 900, cachePath: cache)
    print("--- run \(run): \(Int(Date().timeIntervalSince(t0) * 1000)) ms; \(stats.summary)")
    print(text)
    let m = mode == .styleJSON ? LocalPrompt.modFile(json: text, origin: origin) : LocalPrompt.modFile(reply: text)
    print("--- as a mod (\(m.why ?? "ok")\(m.fixes.isEmpty ? "" : ", fixes: \(m.fixes.joined(separator: ", "))")):\n\(m.file ?? "")")
}
llama.unload()
