# X-Flyer performance suite

Measures what limits X-Flyer's frame rate (x.com/space-shooter), state by state, so it can be rerun after
every change to the game. Opt-in: not part of `npm test` (nothing here is named `*.test.js`).

```sh
node tests/perf/xflyer.js                                   # your live X-Flyer, alone and with your X mods
node tests/perf/xflyer.js path/to/space-shooter.js          # another copy (a patched one, examples/…), same company
node tests/perf/xflyer.js a.js b.js c.js                    # X-Flyer (the first) with exactly these mods
node tests/perf/xflyer.js --states fire,boss --sizes laptop --configs all --runs 3
node tests/perf/xflyer.js --variants none,no-glow,no-rave   # ablations: what each feature costs
node tests/perf/xflyer.js --variants none,@patched.js       # the live copy and a patched one, run for run
node tests/perf/xflyer.js --startup                         # page load, Shift+S, the first frames
node tests/perf/xflyer.js --leak 3                          # 3 minutes on Home: heap and DOM over time
node tests/perf/xflyer.js --states list                     # the states
```

The defaults: the live `~/.trif/sites/x.com/space-shooter.js`, with Detox Timeline, Follow status, Punk Fonts
and Rainbow Rave from the same folder (whichever of them exist; other mods there only when named), every
state, both window sizes, both configs, three runs (about two hours; narrow it with the options). Every file is read fresh for every run, and every result records each mod's sha1 and
modification time, so it's clear which version was measured. Nothing in `~/.trif` is written to.

Sharing the machine's test browser with others (other agents, the e2e suite): `--lock DIR` (or
`XFLYER_BROWSER_LOCK=DIR`) takes DIR with mkdir before each browser starts, keeps it for a turn of about
nine minutes (`--lock-minutes`), then gives it up for a minute; it's removed when the suite ends or is
stopped.

## What it outputs

In `tests/perf/.work/<time>/` (or `--out`):

- `summary.md`: one row per window size × mods × variant × state: frames per second (frames shown over
  the window, and from the median frame), p95 and p99 frame times, frames over 50 ms, the main thread's
  time by kind of work in ms per second (script, style, layout, prepaint and paint, composite, GC; also
  `canvas`, the 2D canvas's recorded drawing being sent to the GPU, and `hittest`, elementsFromPoint),
  style recalcs per second and the elements they touch, and the biggest cost (the biggest kind of work,
  and the mod's function with the most time under it, file:line).
- `summary.json`: the same with more: the other threads (compositor, GPU, raster workers: for the canvas
  and the page's pictures, the GPU process's main thread is where they're drawn), the top trace events, the
  hottest functions overall and the mod's (self and total ms per second), each mod's whole time (its code
  and what it called), Chrome's counters (style recalcs, layouts, script and task time per second, heap,
  nodes), long animation frames, and how busy the rest of the machine was.
- Every run notes the CPU the rest of the machine used before and after it (`load` in results.jsonl), since
  other apps can't be stopped: compare runs from quiet stretches, and prefer the medians.
- `results.jsonl`: every run, everything it recorded (and the mods' sha1s, the log lines around a
  transient state's trigger, startup times, errors).
- `log.txt`: one line per run as it goes.

## How it measures

- **The page.** `lib/xpage.js`: a stand-in for X's Home served as https://x.com:<port> (the browser maps
  x.com to 127.0.0.1 and nothing else resolves). tests/e2e's X page is a list of entry ids, enough for
  Detox Timeline's filter but not for a game that blasts words, avatars and photos, so this one is built
  the way X builds its page: React Native Web's atomic classes inserted into `#react-native-stylesheet` as
  they're first used (about 1,300 rules), X's inline colours, light mode (so the theme translator works,
  as it does when X is in light mode; `?theme=dark` to have it idle), the left nav, the sticky tabs and composer, the
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
- **Variants are interleaved** run by run (A B A B…), so a machine that gets busier part way through
  affects every variant alike.
- **Frames**: requestAnimationFrame timestamps. **Trace**: CDP Tracing (devtools.timeline and friends),
  the main thread's self time by event, grouped into kinds; style recalcs (UpdateLayoutTree) and their
  element counts; the other threads' busy time. **Profile**: the Profiler domain at 250 µs; mod functions
  are reported by file and line (the line numbers are the mod file's own). Traces are summarised and
  dropped (never written to disk).

## Variants (ablations)

`--variants a,b,c` measures each as its own row; `a+b` combines. Each edits the mod's text as it's read
(failing loudly if its anchor isn't there any more), or the page, or the company: see `lib/variants.js`
(`no-xlate-scan`, `no-xlate`, `no-glow`, `no-wrap`, `no-chase`, `no-shadows`, `no-shadowblur`, `no-timeline`,
`no-hud`, `no-shake`, `no-music`, `no-sfx`, `no-rave`, `no-detox`, `no-follow`, `no-punk`, and drawing ones:
`no-letters`, `no-sparks`, `no-rings`, `no-laser-draw`, `no-ship-draw`, `no-lives`, `no-telegraph-blur`,
`no-avatar-glow`, `no-boss-ring`). They're for attributing cost, not fixes: an ablated game doesn't look or
play the same.

## Startup

`--startup` traces and profiles the load of the page with the mods and X-Flyer's start (Shift+S) and first
frames: each mod's own run time at document-start, when X-Flyer is ready, the time from Shift+S to the
first frame of the game, the longest task (the freeze), the main thread by kind over it all, and the
mods' functions by time. (`--variants` works here too.)

## Leaks

`--leak MIN` plays MIN minutes on Home (firing, scrolling; the ship can die here, so game overs and restarts
are part of it) and every 15 s collects garbage and samples the JS heap, the nodes (Chrome's count, which
includes nodes no longer in the page but still held), the listeners, the word spans, canvases and
`<style>`s, and the browser's memory (all its processes, and the biggest: decoded audio and pictures live
outside the JS heap); then the same with the game off (the page scrolled at the same speed), since the
stand-in's own list grows as it loads more posts. It reports the growth per minute of each.

## Headless vs a real window

Headless Chrome for Testing renders with the GPU (ANGLE on Metal, Skia Graphite, GPU compositing and
raster), as a window does, and paces requestAnimationFrame at 60 Hz. What it doesn't have: a real display
(no vsync from the screen; a ProMotion screen would allow 120 Hz), the browser's own UI, other tabs, and
your extensions; and sound is muted (the Web Audio graph still runs).

# The X stylers' suite (stylers.js)

What Profile Styler, Post Styler, Site Inherits Profile Style and Style Encoder cost, with the rest of your X
mods, sitting on a page (idle: what the CPU does while you read) and scrolling.

```sh
node tests/perf/stylers.js                                   # every state, idle and scrolling, 3 runs (about 25 min)
node tests/perf/stylers.js --states own-allrb,home --runs 1  # some states
node tests/perf/stylers.js --variants none,no-rainbow,no-rave,no-poststyler,no-inherit,no-panel,no-readcode
node tests/perf/stylers.js --variants none,fixed             # the live stylers and the prototype fixes (lib/styler-fixes.js)
node tests/perf/stylers.js --variants none,@path/to/dir      # the copies in dir replace the mods of the same name
node tests/perf/stylers.js --selector-stats --runs 1         # which CSS selectors the style recalcs spent their time on
node tests/perf/stylers.js --shots DIR --look-at 1234 --variants none,fixed   # screenshots, animations stopped at 1.234 s
node tests/perf/stylers.js --states list
node tests/perf/lib/styler-fixes.js ~/.trif/sites/x.com OUTDIR               # patched copies of the stylers
```

- **The mods**: every `.js` in `~/.trif/sites/x.com` not starting with `_` (TRIF's rule), read fresh for every
  run (sha1 and mtime recorded; a file that changes mid-run is logged), injected as in xflyer.js.
- **The page**: lib/xpage.js with `?pbs=1&theme=dark`: profile pictures at
  `https://pbs.twimg.com/profile_images/<id>/<name>_<size>.png`, the sidebar's people as X's `UserCell`, X's
  `icon-verified` test id, and `/<handle>` as X's profile page (top bar, header photo, picture linking to
  `/<handle>/photo`, name and badge and handle in `UserName`, `editProfileButton` on your own (perf_me, also the
  account button), `userActions` and Follow on others', bio, `UserProfileHeader_Items`, the tabs, then that
  person's posts). Home has posts by styled and unstyled authors (and quoted posts, link cards, reposts).
- **The pictures** (lib/styles.js): the stand-in's avatars redrawn by Style Encoder's own `encode()` (taken from
  style-encoder.js as it is, run in the test browser) with three styles: `plain` (colours, no rainbow), `rbg` (a
  rainbow background), `allrb` (everything rainbow). ada_l and mkbhd_fan carry plain, grace_h and chromium_dev
  rbg, nasa_watch and acapella_news allrb, your own picture plain; the rest carry none. Served from disk by CDP
  request interception (`Fetch`): pbs.twimg.com is answered there, x.com goes on to the stand-in, anything
  else is refused and counted (`blocked` in results.jsonl); the browser also resolves nothing but x.com.
- **Your style**: `trifProfileStyler.mine:perf_me` in localStorage, as Profile Styler stores it.
- **States**: `own-plain`, `own-rbg`, `own-allrb` (your profile with each style), `own-panel` and
  `own-plain-panel` (the Style profile panel open), `other` (@grace_h, a rainbow background; yours all rainbow),
  `home` (yours all rainbow, inherited), `home-plain`.
- **Windows**: each state is loaded and settled (pictures read, styles applied), then `idle` (nothing touched)
  and `scroll` (mouse wheel, about 670 px/s) are each measured: the browser's CPU time by process (ps: renderer,
  GPU process, browser) over `--seconds`, Chrome's counters, then a 3 s trace (main thread by kind, the GPU
  process's and compositor's threads, frames drawn, style recalcs) and a 3 s CPU profile (the mods' functions by
  file:line). No requestAnimationFrame loop runs while idle (it would keep the page drawing by itself); frames
  are counted from the trace (`Display::FrameDisplayed`: frames put on screen; `BeginMainThreadFrame`: frames
  the page's main thread worked on). While scrolling, rAF gives fps and frame times.
- **Page checks** (results.jsonl `page`): elements, running animations by name (and how many are pinned to
  time 0), styled and rainbow posts, cards, the html attributes on, the panel, emoji wrappers, localStorage
  writes by key.
- **Variants**: lib/styler-variants.js. Ablations: `no-rainbow` (every rainbow shown as its plain colour),
  `no-rave`, `no-poststyler`, `no-inherit`, `no-encoder`, `no-xflyer`, `no-others`, `no-stylers`, `bare` (no
  mods), `no-panel` (the Style profile button and panel never built), `no-readcode` (the picture reads
  answered at once from the stand-in's table: no image, no canvas), `no-ticks` (the stylers' timers stopped
  after 4 s), and one per kind of animation (`no-textroll`, `no-linehue`, `no-boxroll`, `no-smallroll`,
  `no-bigroll`, `no-smil`, `no-fixed`, `no-emoji`). Fixes: lib/styler-fixes.js (`fix:<name>`, `fixed`).
- Safety as xflyer.js: `--lock DIR` (an `owner` file is written in it), memguard.sh, `nice`, headless,
  `--mute-audio`, one browser at a time.
