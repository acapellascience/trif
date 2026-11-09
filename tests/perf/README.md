# X-Flyer performance suite

Measures what limits X-Flyer's frame rate (x.com/space-shooter), state by state, so it can be rerun after
every change to the game. Opt-in: not part of `npm test` (nothing here is named `*.test.js`).

```sh
node tests/perf/xflyer.js                                   # Tim's live X-Flyer, alone and with his X mods
node tests/perf/xflyer.js path/to/space-shooter.js          # another copy (a patched one, examples/…), same company
node tests/perf/xflyer.js a.js b.js c.js                    # X-Flyer (the first) with exactly these mods
node tests/perf/xflyer.js --states fire,boss --sizes laptop --configs all --runs 3
node tests/perf/xflyer.js --variants none,no-glow,no-rave   # ablations: what each feature costs
node tests/perf/xflyer.js --startup                         # page load, Shift+S, the first frames
node tests/perf/xflyer.js --leak 3                          # 3 minutes on Home: heap and DOM over time
node tests/perf/xflyer.js --states list                     # the states
```

The defaults: the live `~/.trif/sites/x.com/space-shooter.js`, with Detox Timeline, Follow status, Punk Fonts
and Rainbow Rave from the same folder (whichever of them exist), every state, both window sizes, both
configs, three runs. Every file is read fresh for every run, and every result records each mod's sha1 and
modification time, so it's clear which version was measured. Nothing in `~/.trif` is written to.

## What it outputs

In `tests/perf/.work/<time>/` (or `--out`):

- `summary.md`: one row per window size × mods × variant × state: frames per second (frames shown over
  the window, and from the median frame), p95 and p99 frame times, frames over 50 ms, the main thread's
  time by kind of work in ms per second (script, style, layout, prepaint and paint, composite, GC; also
  `canvas`, the 2D canvas's recorded drawing being sent to the GPU, and `hittest`, elementsFromPoint),
  style recalcs per second and the elements they touch, and the biggest cost (the biggest kind of work,
  and the mod's function with the most time under it, file:line).
- `summary.json`: the same with more: the other threads (compositor, GPU, raster workers), the top trace
  events, the hottest functions overall and the mod's (self and total ms per second), Chrome's counters
  (style recalcs, layouts, script and task time per second, heap, nodes), long animation frames.
- `results.jsonl`: every run, everything it recorded (and the mods' sha1s, the log lines around a
  transient state's trigger, startup times, errors).
- `log.txt`: one line per run as it goes.

## How it measures

- **The page.** `lib/xpage.js`: a stand-in for X's Home served as https://x.com:<port> (the browser maps
  x.com to 127.0.0.1 and nothing else resolves). tests/e2e's X page is a list of entry ids, enough for
  Detox Timeline's filter but not for a game that blasts words, avatars and photos, so this one is built
  the way X builds its page: React Native Web's atomic classes inserted into `#react-native-stylesheet` as
  they're first used (about 1,300 rules), X's inline colours, light mode (so the theme translator works,
  as it does for Tim; `?theme=dark` to have it idle), the left nav, the sticky tabs and composer, the
  sidebar (search, Premium, trends, who to follow), and the timeline as X's virtualised list
  (`cellInnerDiv` rows placed with `translateY`, only those within a window above and two below in the
  page, the next page fetched near the end) from a HomeLatestTimeline GraphQL response the page fetches
  (so Detox Timeline filters it as on X). 60 posts a page (more as you scroll): text with links and
  hashtags, photos (real JPEGs, 1200×675), quoted posts, link cards, reposts, the action bar, and React's
  fiber on each post and picture (follower counts, who follows whom) for X-Flyer and Follow status. About
  110 elements a post, 2,000 to 4,000 in the page; generated names, text and pictures (seeded: the same
  every run). `?elon=N`: every Nth post is @elonmusk's (the boss). `?rows=all`: no recycling.
- **The browser.** Chrome for Testing (tests/e2e/.browsers, or the main checkout's), headless (`--headless=new
  --mute-audio`: the game and Rainbow Rave play music), a fresh profile per run, its window grown until the
  page is exactly 1440×900 at 1× (desktop) or 1280×800 at 2× (laptop: a retina MacBook Air). Started under
  `memguard.sh` (killed, it and only it, if one of its processes passes 1.5 GB or all of them 4 GB) and
  `nice`; one at a time, and never while another Chrome for Testing is running (it waits).
- **The mods.** Injected with CDP (`Page.addScriptToEvaluateOnNewDocument`), wrapped exactly as TRIF's
  extension wraps them (`wrapModCode` from extension/lib.js), in TRIF's order (by file name), run when the
  page has its `<html>` (document-start) or at DOMContentLoaded (document-idle). TRIF isn't installed;
  `window.trif.log` is a stand-in that records each line with its time (and marks it in the trace).
  Math.random is seeded, so every run plays the same game. The ship can't die (one line patched out:
  see `lib/variants.js` IMMORTAL; `--mortal` to play without it): deaths at random moments would make
  runs incomparable. Dying has its own state, from the game's own test hook.
- **The states.** Each is played with scripted keys (CDP key events: ← and → in turn, space held, ↑ held
  on Home to scroll the timeline at you) for a fixed time. Steady states settle 2.5 s, then: frames for
  `--seconds` (6), then a 3 s trace, then a 3 s CPU profile, each its own window (so tracing doesn't skew
  the frame times). Transient states (the boss growing, the explosion, game over) are measured from the
  moment the game logs them, over fixed windows; their frame times are the median of `--runs` plain runs,
  plus one traced run and one profiled run.
- **Frames**: requestAnimationFrame timestamps. **Trace**: CDP Tracing (devtools.timeline and friends),
  the main thread's self time by event, grouped into kinds; style recalcs (UpdateLayoutTree) and their
  element counts; the other threads' busy time. **Profile**: the Profiler domain at 250 µs; mod functions
  are reported by file and line (the line numbers are the mod file's own). Traces are summarised and
  dropped (never written to disk).

## Variants (ablations)

`--variants a,b,c` measures each as its own row; `a+b` combines. Each edits the mod's text as it's read
(failing loudly if its anchor isn't there any more), or the page, or the company: see `lib/variants.js`
(`no-xlate-scan`, `no-xlate`, `no-glow`, `no-wrap`, `no-chase`, `no-shadows`, `no-shadowblur`, `no-timeline`,
`no-hud`, `no-shake`, `no-music`, `no-sfx`, `no-rave`, `no-detox`, `no-follow`, `no-punk`). They're for
attributing cost, not fixes: an ablated game doesn't look or play the same.

## Headless vs a real window

Headless Chrome for Testing renders with the GPU (ANGLE on Metal, Skia Graphite, GPU compositing and
raster), as a window does, and paces requestAnimationFrame at 60 Hz. What it doesn't have: a real display
(no vsync from the screen; a ProMotion screen would allow 120 Hz), the browser's own UI, other tabs, and
Tim's extensions; and sound is muted (the Web Audio graph still runs).
