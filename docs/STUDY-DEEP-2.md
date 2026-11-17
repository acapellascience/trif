# Depth study 2: obfuscated code, tempting surface fixes (2026-11-17)

**Question (Tim's hypothesis).** Since `trif run` became boxed by default in side-panel chats (`--page`
runs in the page's own world and locks the site until reload), agents work at the surface and don't dig
into the site's own code for the deep fix. The first depth study (commit e9fb0cb: autoplay, follow, jump)
didn't support that, but its levers may have been too easy to reach. This one makes digging harder and
the surface fix tempting.

**Verdict, in one line.** Partly supported. When the surface fix shows a cost the agent can see (gaps in
a feed, or the wrong 10 comments), agents dig, in every arm, boxed default or not: 17 of 18 runs. When
the cost is invisible (a hidden player that keeps streaming), all 9 runs stopped at a CSS hide and never
looked at the network or the code. The guide wording made no difference. Neither did the box, because
agents who wanted to dig got around it (`trif navigate` to the script, or `--page`).

## Tasks

Each app is one minified bundle (short names, no source map, about 175 KB on ~10 long lines). The app
module sits among 300 generated vendor modules that use decoy `localStorage` keys, fetch URLs and string
tables (tests/e2e/lib/deep2.js). Every task's text is a plain user request with no hint of the deep
fix. Nothing these pages do at load is a send, so the measures don't depend on load-time sends after a
reload. reload-unlock (4cf6cb3, CI green) was merged into this branch before the runs anyway.

| key | page | request | surface fix (passes a look) | deep fix |
|---|---|---|---|---|
| `suggest` | Tidepool: a virtualized feed (fixed 150 px rows, recycled nodes); "Suggested for you" is only badge text, and reposts use the same badge element | "get rid of the suggested posts in my feed" | hide the rows or their contents: leaves 150 px holes (and a row hidden by hand stays hidden when it's reused for another post) | drop `k:3` items from `GET /tidepool/api/v2/feed` |
| `newest` | Quillby: an article's comments, 10 at a time from `GET …/api/c?…&o=0`, by votes; cards carry `<time datetime>` | "show me the newest comments first" | re-sort the drawn cards by time: they look right, but they're the 10 *top* comments, not the 10 newest | ask for `o=2` (a hidden sort the bundle has: `localStorage qb:o`, or a `qb:flags {"sm":1}` menu), or rewrite the request |
| `live` | Glint: a live mini-player pops up in the corner 1.8 s after load and polls ~25 KB frames every 400 ms; the big player (a card's click) uses the same frames | "get rid of the live preview that pops up in the corner" | CSS hide: it's gone from the screen, but it keeps polling (~50 KB/s) in the background | `localStorage gl:prefs {"lp":0}` (bundle only), or drop `feat` from `GET /glint/api/home`, or click its own close button |

**Scoring** (automatic, after the site's storage is emptied and the page reloaded, so a setting left by
hand doesn't count). The harness measures with CDP and the server's request log, never `trif run`.
- `suggest`: scroll to the end, 500 px a step. **fail** if a suggested post is drawn, loading stops, or
  fewer than 20 other posts are drawn. **surface** if any step shows a >30 px stretch of the list with
  nothing drawn, or a non-suggested post is blank. Otherwise **deep**.
- `newest`: **deep** if the first 10 on screen are the 10 newest overall, and after "Show more" the
  first 20 are the 20 newest. **surface** if the first 10 are in time order but the wrong set. Otherwise
  **fail**.
- `live`: **fail** if the mini-player is visible after 7 s or the big player doesn't play.
  **surface** if it's hidden but its frames were fetched more than 3 times. Otherwise **deep**.

**Scripted solve check** (`--study-solve`, through TRIF as free mods, before any agent run): baseline
fail on all three. suggest: content-hide and row-hide → surface (29 gap steps; the row-hide also blanked
43 real posts), fetch filter → deep. newest: DOM sort → surface, request rewrite and `qb:o` → deep.
live: CSS hide → surface (20 frames), `gl:prefs` and auto-close → deep (0–1 frames). 9/9 as intended.

## Arms

- **box**: this branch's guides (main's, eb92635 and later), 107.6 KB.
- **dig**: the same, with the `trif run` passage of AGENTS.md rewritten to say what the page's own world
  is for (the first study's arm), 107.4 KB.
- **lean2**: lean-guides at ce5b1bc (AGENTS/BOXED/TECHNIQUES 23.6/7.3/7.0 KB), 37.8 KB.

Opus, effort high, side-panel chat (`trif agent run --tab`), 3 rounds, shuffled arm order per task.
27 runs, $12.66 in all. Results: ~/WebMods-worktrees/live-runs/out-deep2/2026-11-17T19-40-12
(study.json, each run's log, mods and screenshots). Summarise with
`node tests/e2e/deep2-summary.js <dir> [--rows]`.

## Results

"read bundle" means the run fetched or opened the app's script, or its tool output contained an
app-only string from it. Tokens are input + cache + output, per run.

### box

| task | deep | surface | fail | fix kinds | read bundle | used `--page` | median tokens | median output | median tools | median secs | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| suggest | 3 | 0 | 0 | data 3 | 0/3 | 0/3 | 470k | 2779 | 10 | 61 | $1.44 |
| newest | 2 | 1 | 0 | request 2, dom-sort 1 | 2/3 | 1/3 | 730k | 4748 | 15 | 84 | $1.82 |
| live | 0 | 3 | 0 | hide 3 | 0/3 | 0/3 | 226k | 1714 | 5 | 54 | $1.08 |
| **all** | **5** | **4** | **0** | | 2/9 | 1/9 | 470k | 2779 | 10 | 66 | $4.35 |

### dig

| task | deep | surface | fail | fix kinds | read bundle | used `--page` | median tokens | median output | median tools | median secs | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| suggest | 3 | 0 | 0 | data 3 | 0/3 | 0/3 | 569k | 3361 | 12 | 68 | $1.52 |
| newest | 3 | 0 | 0 | setting 2, request 1 | 3/3 | 3/3 | 583k | 3913 | 11 | 72 | $2.21 |
| live | 0 | 3 | 0 | hide 3 | 0/3 | 0/3 | 237k | 1572 | 6 | 54 | $1.10 |
| **all** | **6** | **3** | **0** | | 3/9 | 3/9 | 452k | 3356 | 11 | 68 | $4.83 |

### lean2

| task | deep | surface | fail | fix kinds | read bundle | used `--page` | median tokens | median output | median tools | median secs | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| suggest | 3 | 0 | 0 | data 3 | 0/3 | 0/3 | 324k | 2534 | 11 | 73 | $1.07 |
| newest | 3 | 0 | 0 | request 3 | 3/3 | 3/3 | 495k | 4484 | 16 | 70 | $1.59 |
| live | 0 | 3 | 0 | hide 3 | 0/3 | 0/3 | 248k | 1887 | 8 | 49 | $0.82 |
| **all** | **6** | **3** | **0** | | 3/9 | 3/9 | 324k | 2534 | 11 | 67 | $3.48 |

## What the agents did

**suggest: 9/9 deep, and none needed the bundle.** Every run noticed the virtualized rows, reasoned
that hiding would leave gaps, and went to the data without trying a hide. The guides name this exact
case (TECHNIQUES.md, "Virtualized lists"). They found `k: 3` in the feed's JSON through `trif record` /
`trif request`, and all 9 wrote a boxed mod with `site-data` (`trif.filterResponse`). A box run said:
"The feed is virtualized (rows positioned by transform), so hiding would leave gaps". So the minified
bundle wasn't a hurdle here: the lever could be read off the network.

**newest: 8/9 deep, and this is where they read obfuscated code.** 8 runs read the bundle and found the
hidden `[[0,"Top"],[2,"Newest"],[1,"Oldest"]]` sort: dig and lean2 every time with `trif run --page …
fetch("/quillby/assets/index-….js")` plus regex searches over it, one box run with `--page`, and one box
run by `trif navigate`-ing a second tab to the script URL and grepping the saved output (no lock). Fixes:
a boxed `rewrite-requests c o=2` mod (6), or a free mod that switches on the bundle's hidden "Sort by" menu (`qb:flags`) and makes `qb:o` default to 2, so the user can still switch back (2, both dig). The one surface run (box,
round 2) tried to read the scripts *from the box*, where an external script's text is empty
(`page.findAll("script").map(s => s.text)`). It took the empty result at face value ("the site only lets
you see comments ranked by votes") and DOM-sorted the 10 it had. It was honest about the gap ("some
newer comments may only turn up after 'Show more comments'") and didn't try to fetch the script.
The lean2 runs also tried to relabel "Top comments" with a style-section key, `replace`, that doesn't
exist (3 helper errors, `unknown key "replace"`).

**live: 0/9 deep, in every arm.** Every run found `.gZ`, wrote a style mod hiding it, reloaded, and
confirmed it stayed hidden. No run looked at the network (`trif record`/`requests`: 0 in all 9) or the
code, and none tried the close button. Several saw it was still running and judged that fine:
- "it's still there behind the scenes but never shows" (dig)
- "the popup still loads a few seconds in, but it stays hidden" (lean2)
- "it still gets created but now stays hidden" (box)

The request reads as a looks request, and the dig passage itself says to dig when the request is "about
behaviour or data rather than looks". These were the cheapest runs (5–8 tools, ~50 s).

**Across arms.** Outcomes were the same: box 5 deep / 4 surface, dig 6/3, lean2 6/3. The one difference
came from a single run. dig and lean2 used `--page` in every newest run, box in 1 of 3. lean2 had the
lowest cost and tokens (median 324k tokens vs 470k box and 452k dig; $3.48 vs $4.35 and $4.83).

## Verdict

Tim's hypothesis is **not supported as stated**. The boxed default doesn't keep agents at the surface:
when they decided the surface was wrong they read minified code, through `--page` or around it
(`trif navigate` to the script URL). Changing the wording toward digging (dig) changed nothing.

There is a **real, narrower version of it**. Agents stop at the surface when the surface fix passes
every check they think to run and the cost doesn't show on screen. In live, all 9 runs stopped at
CSS, and some explicitly noted the thing was still running underneath. Both deep wins came from a
cost the agent could *see* or *infer from the screen*: gaps in a fixed-row feed (named in the guides),
or a set of comments that is obviously only the top page. What would change behaviour is guidance about
**hidden costs of hiding**: a hidden element that still runs (players, timers, polling, sound) should be
stopped or kept from mounting, not just hidden. Plus a box hint that an external script's `text` is empty
(fetch it with `--page`, or open its URL).

Caveats: one model, one effort level, 3 rounds; stand-in apps; the suggest lever was visible in the
network data, so that task tested "notice the cost", not "read obfuscated code".
