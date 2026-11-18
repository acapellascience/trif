// The video-resume rules (VideoResume.swift: the phones' shared mobile/shared/gen/core.js, TrifCore.videoResume, called
// through Core.swift) on the Mac: which loads pick a video up where it was, and the site's video ids, against
// video-resume-cases.json (argv[1]; gen/core.js argv[2]). `check --videoid-script` prints the page's videoId function,
// for videoresume.test.js to run in node and compare with the Swift one. Prints "video resume: ok" or the failures.
import Foundation

if CommandLine.arguments.contains("--videoid-script") { print(VideoResume.videoIDScript); exit(0) }
if CommandLine.arguments.contains("--videoid") {
    // (one address a line on stdin → its id or "-"; gen/core.js the last argument)
    Core.source = URL(fileURLWithPath: CommandLine.arguments.last!)
    while let line = readLine() { print(VideoResume.videoID(line) ?? "-") }
    exit(0)
}

var failures: [String] = []
func expect(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }

let args = CommandLine.arguments
if args.count > 2 { Core.source = URL(fileURLWithPath: args[2]) } else { failures.append("no core.js (argv[2])") }
Core.report = { failures.append("Core: " + $0) }
guard args.count > 1, let cd = FileManager.default.contents(atPath: args[1]), let C = (try? JSONSerialization.jsonObject(with: cd)) as? [String: Any] else {
    print("no cases (argv[1])"); exit(1)
}
let now = Date()
// the recorded answers
let A = C["addresses"] as! [[Any]]
for r in A {
    let a = r[0] as! String, w = r[2] as! [String: Any]
    // (the platform's parts, as recorded: what the rules were given)
    let mine = try! JSONSerialization.data(withJSONObject: [VideoResume.parts(a)], options: [.sortedKeys, .fragmentsAllowed])
    let kept = try! JSONSerialization.data(withJSONObject: [r[1]], options: [.sortedKeys, .fragmentsAllowed])
    expect(mine == kept, "parts \(a): \(String(decoding: mine, as: UTF8.self))")
    expect(VideoResume.videoID(a) == w["id"] as? String, "videoID \(a): \(VideoResume.videoID(a) ?? "nil")")
    expect(VideoResume.asksForTime(a) == w["asks"] as! Bool, "asksForTime \(a)")
}
for r in C["same"] as! [[Any]] {
    let i = r[0] as! Int, j = r[1] as! Int, a = A[i][0] as! String, b = A[j][0] as! String
    expect(VideoResume.samePage(a, b) == r[2] as! Bool, "samePage \(a) \(b)")
}
var t0 = Date()
for r in C["decide"] as! [[Any]] {
    let f = r[0] as! [String: Any], w = r[1] as! [String: Any], address = f["address"] as! String
    let s = (f["saved"] as? [String: Any]).map { v in
        VideoResume.State(url: v["url"] as! String, time: (v["time"] as! NSNumber).doubleValue, playing: true, duration: (v["duration"] as! NSNumber).doubleValue,
                          live: v["live"] as! Bool, ended: v["ended"] as! Bool, at: now.addingTimeInterval(-(v["age"] as! NSNumber).doubleValue))
    }
    let d = VideoResume.decide(saved: s, address: address, now: now)
    expect((d.plan != nil) == w["plan"] as! Bool && d.why == w["why"] as! String && (d.plan == nil || d.plan == s), "decide \(f): \(d.why)")
}
let decideCost = Date().timeIntervalSince(t0) / Double((C["decide"] as! [[Any]]).count)
func st(_ url: String, _ time: Double, playing: Bool = true, duration: Double = 600, live: Bool = false, ended: Bool = false, ago: TimeInterval = 10) -> VideoResume.State {
    VideoResume.State(url: url, time: time, playing: playing, duration: duration, live: live, ended: ended, at: now.addingTimeInterval(-ago))
}
let page = "http://127.0.0.1:8390/video.html?v=a"
func plan(_ s: VideoResume.State?, _ address: String) -> VideoResume.State? { VideoResume.decide(saved: s, address: address, now: now).plan }

// resumes
expect(plan(st(page, 40), page)?.time == 40, "a reload of the same page at 0:40 resumes")
expect(plan(st(page, 30, playing: false), page)?.playing == false, "paused stays paused")
expect(plan(st(page + "#x", 40), page) != nil, "the #part aside")
expect(plan(st(page, 40, ago: 29 * 60), page) != nil, "29 minutes later")
// never
expect(plan(nil, page) == nil, "nothing kept")
expect(plan(st(page, 40, ago: 31 * 60), page) == nil, "31 minutes later")
expect(plan(st(page, 40, live: true), page) == nil, "a live stream")
expect(plan(st(page, 40, ended: true), page) == nil, "ended")
expect(plan(st(page, 4.9), page) == nil, "first 5 s")
expect(plan(st(page, 591, duration: 600), page) == nil, "last 10 s")
expect(plan(st(page, 589, duration: 600), page) != nil, "just before the last 10 s")
expect(plan(st(page, 40), "http://127.0.0.1:8390/video.html?v=b") == nil, "another address")
// YouTube: the video id decides, not the rest of the address
let yt = "https://m.youtube.com/watch?v=abc123&pp=xyz"
expect(plan(st(yt, 100), "https://m.youtube.com/watch?v=abc123") != nil, "same YouTube video, other parameters")
expect(plan(st(yt, 100), "https://m.youtube.com/watch?v=zzz999") == nil, "another YouTube video")
expect(plan(st(yt, 100), "https://m.youtube.com/") == nil, "YouTube's home page")
expect(plan(st(yt, 100), "https://m.youtube.com/watch?v=abc123&t=30") == nil, "a link with its own time")
expect(plan(st(yt + "&t=30", 100), "https://m.youtube.com/watch?v=abc123&t=30") != nil, "reloading a t= link resumes where it got to")
expect(plan(st("https://www.youtube.com/shorts/S1", 20), "https://m.youtube.com/shorts/S1") != nil, "a short on another YouTube host")
// ids
let ids: [(String, String?)] = [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "yt:dQw4w9WgXcQ"), ("https://youtu.be/dQw4w9WgXcQ?t=3", "yt:dQw4w9WgXcQ"),
    ("https://m.youtube.com/shorts/abc", "yt:abc"), ("https://www.youtube-nocookie.com/embed/xyz", "yt:xyz"),
    ("https://www.youtube.com/live/L1", "yt:L1"), ("https://www.youtube.com/feed/subscriptions", nil),
    ("https://vimeo.com/76979871", "vimeo:76979871"), ("https://player.vimeo.com/video/76979871", "vimeo:76979871"),
    ("https://example.com/watch?v=1", nil), ("not a url", nil),
]
for (u, id) in ids { expect(VideoResume.videoID(u) == id, "videoID(\(u)) = \(VideoResume.videoID(u) ?? "nil"), want \(id ?? "nil")") }
// the page's message
let s = VideoResume.state(from: ["url": page, "time": 12.5, "playing": true, "duration": -1, "live": true, "muted": true, "rate": 1.5, "src": ""], now: now)
expect(s?.live == true && s?.muted == true && s?.rate == 1.5 && s?.duration == -1, "state from a message")
expect(VideoResume.state(from: ["url": page, "time": Double.nan]) == nil, "a NaN time refused")
expect(VideoResume.state(from: ["time": 3]) == nil, "no address refused")
expect(VideoResume.clock(42.9) == "0:42" && VideoResume.clock(3725) == "1:02:05", "clock")

print(failures.isEmpty ? "video resume: ok" : failures.joined(separator: "\n"))
print(String(format: "a load's decide %.0f µs", decideCost * 1e6))
