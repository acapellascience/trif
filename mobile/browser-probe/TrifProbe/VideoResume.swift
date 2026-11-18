// A video picks up where it was after its page loads again (Tim, 11-18: "If a page is playing a video and it reloads
// for any reason, is there a way to make it remember where it was in the video and reload from that spot?").
// No UI and no WebKit here, so the rules are built for the Mac too (mobile/test/videoresume.test.js).
//
// - What's kept: TRIF's world in each page (`watch`, every page from its start, main frame; same-origin frames' videos
//   too) tells the app the state of the video playing (or last played): the page's address, the time, playing or
//   paused, the duration (live: none), muted, the speed, and its source when it isn't a blob. Every 3 s while it plays
//   in a page shown, every 8 s in a tab behind or with the app in the background (the media's own timeupdate events,
//   which WebKit keeps firing while it plays; no timers), and at once on pause, ended, a seek, and the page hiding.
// - Where: the tab (Tab.video), and Application Support/tab-videos.json (`VideoStore`) so a relaunch keeps it; gone
//   with its tab. Never sent anywhere; Diagnostics gets only "resumed a video at m:ss on <host>".
// - When: the same tab loads the same page again within 30 minutes (a reload of any kind, a page process ended, a mod
//   applying, back to it): `decide` gives the page a plan, and the page seeks the video that matches it (duration
//   within 1 s, the same source when both have one, the same video id in the address) once it knows its duration,
//   then plays it if it was playing (the app's play, which counts as the person's: with sound when iOS lets it, else
//   muted with "Tap for sound", else left paused there). Not for live streams, another video, the first 5 s or the
//   last 10 s, a link that asks for its own time (t=, start=). If the site moves it again in the next 6 s, it's put
//   back once.

import Foundation

enum VideoResume {
    /// What a page last said of its video.
    struct State: Codable, Equatable {
        var url: String
        var time: Double
        var playing: Bool
        /// Seconds; -1 for a live stream (WebKit's Infinity) or not known.
        var duration: Double
        var live: Bool = false
        var ended: Bool = false
        var muted: Bool = false
        var rate: Double = 1
        /// Its source when that's an address (not a blob: one made by the page, never the same twice).
        var src: String = ""
        var at: Date
    }

    static let window: TimeInterval = 30 * 60
    static let skipStart = 5.0, skipEnd = 10.0

    /// The site's own id for the video in a page's address, where it has one: YouTube's watch?v=, /shorts/, /embed/,
    /// /live/, youtu.be/; Vimeo's number. nil elsewhere (the address itself is the page then).
    static func videoID(_ address: String) -> String? {
        guard let u = URLComponents(string: address), let host = u.host?.lowercased() else { return nil }
        let parts = u.path.split(separator: "/").map(String.init)
        if host == "youtu.be" { return parts.first.map { "yt:" + $0 } }
        if host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "youtube-nocookie.com" || host.hasSuffix(".youtube-nocookie.com") {
            if let v = u.queryItems?.first(where: { $0.name == "v" })?.value, !v.isEmpty { return "yt:" + v }
            if parts.count >= 2, ["shorts", "embed", "live", "v"].contains(parts[0]) { return "yt:" + parts[1] }
            return nil
        }
        if host == "vimeo.com" || host.hasSuffix(".vimeo.com"), let n = parts.last(where: { !$0.isEmpty && $0.allSatisfy(\.isNumber) }) { return "vimeo:" + n }
        return nil
    }

    /// The address asks for its own time (a shared link's t=, start=, YouTube's #t=): the person chose it.
    static func asksForTime(_ address: String) -> Bool {
        guard let u = URLComponents(string: address) else { return false }
        if u.queryItems?.contains(where: { ["t", "start", "time_continue"].contains($0.name) }) == true { return true }
        return (u.fragment ?? "").hasPrefix("t=")
    }

    /// The same page: the same video id when the site has one, else the same address (its #part aside).
    static func samePage(_ a: String, _ b: String) -> Bool {
        let va = videoID(a), vb = videoID(b)
        if va != nil || vb != nil { return va == vb }
        func strip(_ s: String) -> String { s.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? s }
        return strip(a) == strip(b)
    }

    /// What the page loading `address` in this tab gets: the plan (the saved state), or why not.
    static func decide(saved: State?, address: String, now: Date = Date()) -> (plan: State?, why: String) {
        guard let s = saved else { return (nil, "nothing kept") }
        if now.timeIntervalSince(s.at) > window { return (nil, "kept more than 30 minutes ago") }
        if s.live { return (nil, "a live stream") }
        if s.ended { return (nil, "it had ended") }
        if !samePage(s.url, address) { return (nil, "another page or video") }
        if asksForTime(address) && !asksForTime(s.url) { return (nil, "the address asks for its own time") }
        if s.time < skipStart { return (nil, "in its first \(Int(skipStart)) s") }
        if s.duration > 0, s.time > s.duration - skipEnd { return (nil, "in its last \(Int(skipEnd)) s") }
        return (s, "resume")
    }

    /// A state from the page's message (nil if it isn't one).
    static func state(from body: [String: Any], now: Date = Date()) -> State? {
        guard let url = body["url"] as? String, let time = (body["time"] as? NSNumber)?.doubleValue, time.isFinite, time >= 0 else { return nil }
        let d = (body["duration"] as? NSNumber)?.doubleValue ?? -1
        return State(url: String(url.prefix(2000)), time: time, playing: body["playing"] as? Bool ?? false,
                     duration: d.isFinite ? d : -1, live: body["live"] as? Bool ?? false, ended: body["ended"] as? Bool ?? false,
                     muted: body["muted"] as? Bool ?? false, rate: (body["rate"] as? NSNumber)?.doubleValue ?? 1,
                     src: String((body["src"] as? String ?? "").prefix(2000)), at: now)
    }

    /// The plan as the page takes it.
    static func planObject(_ s: State, address: String) -> [String: Any] {
        ["time": s.time, "playing": s.playing, "duration": s.duration, "muted": s.muted, "rate": s.rate, "src": s.src,
         "vid": videoID(address) ?? ""]
    }

    /// m:ss (h:mm:ss past an hour).
    static func clock(_ t: Double) -> String {
        let s = Int(t.rounded(.down))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// The page's video id, as `videoID` (in TRIF's world; the same rules, kept in step by the Mac test).
    static let videoIDScript = """
        function (address) {
          let u; try { u = new URL(address); } catch (e) { return null; }
          const host = u.hostname.toLowerCase(), parts = u.pathname.split('/').filter(Boolean);
          if (host === 'youtu.be') return parts[0] ? 'yt:' + parts[0] : null;
          if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
            const v = u.searchParams.get('v');
            if (v) return 'yt:' + v;
            if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) return 'yt:' + parts[1];
            return null;
          }
          if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) { const n = [...parts].reverse().find((p) => /^\\d+$/.test(p)); return n ? 'vimeo:' + n : null; }
          return null;
        }
        """

    /// (TRIF's world, every page from its start, main frame) The video's state to the app, and a plan from it
    /// applied. Messages: videoplan (asked once at the start: {plan} or nothing), videostate, videoplay (the app
    /// plays the video: a play from the page alone isn't allowed with sound), videoresumed.
    static let watch = """
        (function () {
          if (window.top !== window || globalThis.__trifVideo) return;
          const videoId = \(videoIDScript);
          const post = (m) => { try { return window.webkit.messageHandlers.trif.postMessage(m); } catch (e) { return Promise.resolve(null); } };
          const S = globalThis.__trifVideo = { plan: null, asked: false, done: false, applied: 0, appliedAt: 0, target: null, el: null, last: 0, touched: 0 };
          // (the person's own hand on the page: their seek or pause after a resume is theirs)
          for (const k of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(k, () => { S.touched = Date.now(); }, true);
          const nav = (() => { try { const e = performance.getEntriesByType('navigation')[0]; return e ? e.type : ''; } catch (e) { return ''; } })();
          const isBlob = (s) => !s || s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('mediasource:');
          const docs = new Set();
          const videos = () => {
            const out = [];
            for (const d of docs) { try { out.push(...d.querySelectorAll('video')); } catch (e) {} }
            return out;
          };
          // (the plan's video: its duration within 1 s, the same source when both have one, the page still on its video)
          const fits = (m) => {
            const p = S.plan;
            if (!p || !(m.readyState >= 1)) return false;
            if (!isFinite(m.duration) || Math.abs(m.duration - p.duration) > 1) return false;
            if (p.src && !isBlob(m.currentSrc) && m.currentSrc !== p.src) return false;
            return true;
          };
          const finish = (why) => {
            if (S.done) return;
            S.done = true;
            post({ type: 'videoresumed', why, time: S.plan ? S.plan.time : 0, applied: S.applied, now: S.target ? S.target.currentTime : -1, paused: S.target ? S.target.paused : true });
          };
          const apply = (m, again) => {
            const p = S.plan;
            S.target = m; S.el = m; S.applied++; S.appliedAt = Date.now();
            try { if (p.rate && p.rate !== 1 && m.playbackRate !== p.rate) m.playbackRate = p.rate; } catch (e) {}
            try { if (p.muted) m.muted = true; } catch (e) {}
            try { m.currentTime = p.time; } catch (e) {}
            if (p.playing && m.paused) post({ type: 'videoplay', again: !!again });
            if (!again) post({ type: 'videoapplied', time: p.time, playing: p.playing });
          };
          const tryApply = (m) => {
            if (!S.plan || S.done) return;
            if (S.target) {
              // (the site put a new source in the same element, or moved it: put back once, in the 6 s after; never
              // after the person touched or typed on the page, their own seek or pause)
              if (m !== S.target || S.applied >= 2 || S.touched > S.appliedAt || Date.now() - S.appliedAt > 6000 || !fits(m)) return;
              const expect = S.plan.time + (m.paused ? 0 : Math.max(0, (Date.now() - S.appliedAt) / 1000 - 1) * (m.playbackRate || 1));
              if (m.currentTime < S.plan.time - 2 || m.currentTime > expect + 3) apply(m, true);
              return;
            }
            if (videoId(location.href) !== (S.plan.vid || null)) { finish('another video'); return; }
            if (m.readyState >= 1 && m.duration === Infinity) { finish('live'); return; }
            if (fits(m)) apply(m, false);
          };
          const state = (m, why) => {
            const d = m.duration;
            return { type: 'videostate', why, url: location.href, time: m.currentTime || 0, playing: !m.paused && !m.ended, ended: !!m.ended,
              duration: isFinite(d) ? d : -1, live: d === Infinity, muted: !!m.muted, rate: m.playbackRate || 1, src: isBlob(m.currentSrc) ? '' : m.currentSrc };
          };
          // (nothing told while the plan's video is still being put back: the time kept stays the one to go back to)
          const holding = (m) => !S.asked || (S.plan && !S.done && !S.target);
          const report = (m, why, now) => {
            if (!m || holding(m) || !(m.readyState >= 1)) return;
            const t = Date.now(), every = document.visibilityState === 'visible' ? 3000 : 8000;
            if (!now && t - S.last < every) return;
            S.last = t;
            post(state(m, why));
          };
          const chosen = (m) => {
            // (the one with sound wins over a muted preview playing beside it)
            if (!S.el || S.el === m || S.el.ended || !S.el.isConnected || (S.el.paused && !m.paused) || (S.el.muted && !m.muted)) S.el = m;
            return S.el === m;
          };
          const on = (e) => {
            const m = e.target;
            if (!m || m.localName !== 'video') return;
            switch (e.type) {
              case 'loadedmetadata': case 'durationchange': tryApply(m); break;
              case 'play': case 'playing': if (chosen(m)) report(m, e.type, true); break;
              case 'pause': case 'ended': if (m === S.el) report(m, e.type, true); break;
              case 'seeked': tryApply(m); if (m === S.el || !S.el) { chosen(m); report(m, 'seeked', true); } break;
              case 'timeupdate': if (S.target === m && !S.done) tryApply(m); if (!m.paused && chosen(m)) report(m, 'timeupdate', false); break;
              case 'ratechange': case 'volumechange': if (m === S.el) report(m, e.type, true); break;
            }
          };
          const kinds = ['loadedmetadata', 'durationchange', 'play', 'playing', 'pause', 'ended', 'seeked', 'timeupdate', 'ratechange', 'volumechange'];
          const watchDoc = (d) => {
            if (!d || docs.has(d)) return;
            docs.add(d);
            for (const k of kinds) d.addEventListener(k, on, true);
          };
          watchDoc(document);
          // (same-origin frames: their documents watched as each loads; others can't be reached)
          const frames = () => { for (const f of document.querySelectorAll('iframe')) { try { watchDoc(f.contentDocument); for (const m of f.contentDocument.querySelectorAll('video')) tryApply(m); } catch (e) {} } };
          document.addEventListener('load', (e) => { if (e.target && e.target.localName === 'iframe') frames(); }, true);
          document.addEventListener('DOMContentLoaded', frames);
          const away = () => { if (S.el) report(S.el, 'hidden', true); };
          window.addEventListener('pagehide', away, true);
          document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); }, true);
          post({ type: 'videoplan', url: location.href, nav }).then((r) => {
            S.asked = true;
            if (r && r.plan) {
              S.plan = r.plan;
              frames();
              for (const m of videos()) tryApply(m);
              // (settled: 6 s after it was put back, or no video like it within 30 s)
              const t0 = Date.now();
              const look = setInterval(() => {
                if (S.done) { clearInterval(look); return; }
                if (S.target ? Date.now() - S.appliedAt > 6000 : Date.now() - t0 > 30000) { clearInterval(look); finish(S.target ? 'resumed' : 'no video like it'); }
              }, 1000);
            }
          }, () => { S.asked = true; });
        })();
        """

    /// (TRIF's world, by the app: its play counts as the person's) The plan's video played: with sound, else muted.
    static let play = """
        const S = globalThis.__trifVideo, m = S && S.target;
        if (!m) return 'no video';
        if (!m.paused) return 'playing';
        // (development, -resumemuted: as when iOS refuses the sound, to see the note)
        if (forceMuted) { m.muted = true; S.mutedByTrif = true; try { await m.play(); return 'muted'; } catch (e) { return 'left paused (' + e.name + ')'; } }
        try { await m.play(); return 'playing'; } catch (e) {
          if (!m.muted) {
            m.muted = true;
            try { await m.play(); S.mutedByTrif = true; return 'muted'; } catch (e2) { m.muted = false; }
          }
          return 'left paused (' + e.name + ')';
        }
        """
    /// (TRIF's world, by the app, from the person's tap on "Tap for sound")
    static let unmute = """
        const S = globalThis.__trifVideo, m = S && S.target;
        if (!m || !S.mutedByTrif) return 'nothing to do';
        m.muted = false; S.mutedByTrif = false;
        if (m.paused) { try { await m.play(); } catch (e) { return 'unmuted, paused (' + e.name + ')'; } }
        return 'sound on';
        """
}

/// The tabs' video states on disk (Application Support/tab-videos.json, left out of backups): written a few seconds
/// after a change, at once as the app leaves the front, and without a tab once it's closed.
final class VideoStore: @unchecked Sendable {
    static let shared = VideoStore()
    private let queue = DispatchQueue(label: "trif.tab-videos", qos: .utility)
    private let lock = NSLock()
    private var states: [String: VideoResume.State] = [:]
    private var dirty = false, scheduled = false

    var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("tab-videos.json")
    }

    /// What was kept for these tabs, no older than the resume window (the rest dropped).
    func load(keeping ids: Set<UUID>) -> [UUID: VideoResume.State] {
        let all = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([String: VideoResume.State].self, from: $0) } ?? [:]
        let now = Date()
        let kept = all.filter { k, v in UUID(uuidString: k).map(ids.contains) == true && now.timeIntervalSince(v.at) <= VideoResume.window }
        lock.withLock { states = kept }
        if kept.count != all.count { lock.withLock { dirty = true }; saveNow() }
        return Dictionary(uniqueKeysWithValues: kept.compactMap { k, v in UUID(uuidString: k).map { ($0, v) } })
    }

    func set(_ id: UUID, _ s: VideoResume.State?) {
        let schedule: Bool = lock.withLock {
            if let s { states[id.uuidString] = s } else { states[id.uuidString] = nil }
            dirty = true
            if scheduled { return false }
            scheduled = true
            return true
        }
        if schedule { queue.asyncAfter(deadline: .now() + 5) { [weak self] in self?.write() } }
    }

    /// Written now (the app leaving the front).
    func saveNow() { queue.async { [weak self] in self?.write() } }

    private func write() {
        let snapshot: [String: VideoResume.State]? = lock.withLock {
            scheduled = false
            guard dirty else { return nil }
            dirty = false
            return states
        }
        guard let snapshot, let data = try? JSONEncoder().encode(snapshot) else { return }
        var url = file
        try? data.write(to: url, options: .atomic)
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        try? url.setResourceValues(v)
    }
}
