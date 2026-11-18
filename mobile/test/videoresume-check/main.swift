// The video-resume rules (VideoResume.swift) on the Mac: which loads pick a video up where it was, and the site's
// video ids. `check --videoid-script` prints the page's videoId function, for videoresume.test.js to run in node and
// compare with the Swift one. Prints "video resume: ok" or the failures.
import Foundation

if CommandLine.arguments.contains("--videoid-script") { print(VideoResume.videoIDScript); exit(0) }
if CommandLine.arguments.contains("--videoid") {
    // (one address a line on stdin → its id or "-")
    while let line = readLine() { print(VideoResume.videoID(line) ?? "-") }
    exit(0)
}

var failures: [String] = []
func expect(_ ok: Bool, _ what: String) { if !ok { failures.append(what) } }

let now = Date()
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
