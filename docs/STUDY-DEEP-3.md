# Depth study 3: the 0.3.1 guides on the same tasks (2026-11-18)

**Question.** In depth study 2 (docs/STUDY-DEEP-2.md), agents stopped at a CSS hide on `live` in every
run (0/9): the corner mini-player kept polling out of sight. The guides 0.3.1 ships (release-0.3.1 at
1f3ec78) add lines aimed at exactly that. Do they change what agents do, without costing the other two tasks?

**Verdict, in one line.** Yes, on these stand-ins. `live` went from 0/9 deep to **5/5 deep**, and
`newest` (3/3) and `suggest` (2/2) stayed deep. Every `live` run checked the network before it wrote
anything, saw the frames, and dropped the player from the site's data instead of hiding it. With the
request reworded to avoid the guide's own words ("live", "preview", "player", "video"), 3 more runs were
also all deep: 8/8 in all.

## Setup

The harness, tasks and scoring are study 2's, unchanged (tests/e2e/lib/deep2.js, `--study` in
tests/e2e/scenario.js). It has one new arm:

- **rel031**: the three workspace guides at release-0.3.1 1f3ec78 (AGENTS/BOXED/TECHNIQUES 24.0/7.5/7.0 KB,
  38.4 KB). That's study 2's **lean2** (ce5b1bc) plus these lines:
  - AGENTS.md, "Hidden isn't stopped": "If what you hide plays, polls, counts down or makes sound (a player,
    a live preview, autoplay), stop it or keep it from loading … `trif record` shows whether it's still
    sending."
  - AGENTS.md, "When it's better but still not right, get curious".
  - AGENTS.md, "Don't dig in silence".
  - BOXED.md: "A `<script src>`'s text is empty in the box: to read a site's code, fetch it with
    `trif run --page` or open its URL with `trif navigate`. An empty result doesn't mean the feature isn't
    there."
  - Smaller changes: `replace`'s `with` takes no `$1`; a style section takes only `css`, `hide`, `settings`;
    the phone-mods section is gone.

The model and harness match study 2:
- Opus with high effort, a side-panel chat (`trif agent run --tab`).
- The same model and client: `claude-opus-5-5` and Claude Code 2.1.319, as in study 2's logs.
- The TRIF code is this branch's, as in study 2. Only the guides changed.
- Chrome, headless and muted, under the shared browser lock with the 1.5 GB memory guard.

Runs: live ×5, newest ×3, suggest ×2, 10 runs, **$3.84**. Then live ×3 in different wording, $1.10
("Different wording" below). **$4.94 in all.** Results are in ~/WebMods-worktrees/live-runs/out-deep3/:
- 2026-11-18T23-01-20 (live);
- 2026-11-18T23-10-22 (newest);
- 2026-11-18T23-16-15 (suggest);
- 2026-11-18T23-30-26 (live, different wording).

Summarise each with `node tests/e2e/deep2-summary.js <dir> [--rows]`. The run script is
~/WebMods-worktrees/live-runs/run-deep3.sh. It needs Node 22 (global `WebSocket`) and Tim's Claude Code
login.

## Results

### rel031

| task | deep | surface | fail | fix kinds | read bundle | used `--page` | median tokens | median output | median tools | median secs | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| suggest | 2 | 0 | 0 | data 2 | 0/2 | 0/2 | 368k | 3017 | 12 | 60 | $0.77 |
| newest | 3 | 0 | 0 | request 3 | 3/3 | 3/3 | 520k | 3325 | 15 | 62 | $1.36 |
| live | 5 | 0 | 0 | data 5 | 0/5 | 0/5 | 316k | 2191 | 8 | 62 | $1.71 |
| **all** | **10** | **0** | **0** | | 3/10 | 3/10 | 368k | 3017 | 11 | 62 | $3.84 |

Per run:

| run | outcome | fix | secs | cost | tools | network looks | measure |
|---|---|---|---|---|---|---|---|
| live 0 | deep | data (`feat` dropped from `/glint/api/home`), hide as fallback | 70 | $0.35 | 11 | 7 | 0 mini frames; big player plays |
| live 1 | deep | data, hide as fallback | 49 | $0.32 | 8 | 6 | 0 mini frames; big player plays |
| live 2 | deep | data, hide as fallback | 62 | $0.38 | 8 | 7 | 0 mini frames; big player plays |
| live 3 | deep | data, hide as fallback | 54 | $0.29 | 8 | 6 | 0 mini frames; big player plays |
| live 4 | deep | data, hide as fallback | 71 | $0.37 | 12 | 8 | 0 mini frames; big player plays |
| newest 0 | deep | request (`rewrite-requests`, `o=2`) | 78 | $0.42 | 11 | 3 | first 10 and 20 newest |
| newest 1 | deep | request | 50 | $0.46 | 15 | 6 | first 10 and 20 newest |
| newest 2 | deep | request | 62 | $0.48 | 15 | 5 | first 10 and 20 newest |
| suggest 0 | deep | data (`k:3` filtered) | 60 | $0.37 | 13 | 5 | no gaps, 0 suggested, 8 pages |
| suggest 1 | deep | data | 65 | $0.39 | 12 | 5 | no gaps, 0 suggested, 8 pages |

### Against study 2

Deep runs out of all runs. Per-run cost is the arm's cost divided by its runs.

| task | box (main's guides) | dig | lean2 | **rel031** |
|---|---|---|---|---|
| suggest | 3/3 | 3/3 | 3/3 | **2/2** |
| newest | 2/3 | 3/3 | 3/3 | **3/3** |
| live | 0/3 | 0/3 | 0/3 | **5/5** |

| live, medians | box | dig | lean2 | **rel031** |
|---|---|---|---|---|
| network looks (`trif record`/`request(s)`) | 0 | 0 | 0 | **7** (6–8, 5/5 runs) |
| tools | 5 | 6 | 8 | 8 |
| secs | 54 | 54 | 49 | 62 |
| tokens | 226k | 237k | 248k | 316k |
| cost per run | $0.36 | $0.37 | $0.27 | $0.34 |

How strong is the live result? Study 2 had 0/9 deep, all arms together; rel031 has 5/5. If the guides
made no difference, the chance of that split is 1 in 2002 (Fisher's exact test, one-sided, p ≈ 0.0005).

newest and suggest look like lean2, their closest predecessor:
- newest: median 520k tokens vs 495k, $0.45 a run vs $0.53;
- suggest: 368k vs 324k, $0.39 vs $0.36.

## What the agents did

**live: 5/5 deep, all by the same route.** Each run went through the same steps:
1. It found the fixed corner element (`.gZ`), as in study 2.
2. Then, unlike study 2, it turned on `trif record`, reloaded, and read the requests.
3. It saw the frames (`/glint/api/f?ch=…`) and the `feat` field in `/glint/api/home`, and read up on
   `site-data`.
4. It wrote a boxed mod with `trif.filterResponse` that deletes `feat`. All five also kept a `hide` rule in
   the mod's style section as a fallback.

No run read the bundle, tried the close button, or found the `gl:prefs` setting. The network lever was
enough, as on suggest in study 2.

The step from "found it" to "is it still sending?" is the one the guide line names. The agents said so in
their own words, before writing the mod:
- "The corner preview is a live stream that keeps downloading frames, so I'm writing a mod that removes it
  from the page's data before it starts, rather than just hiding it." (run 0)
- "The corner preview is the featured "Retro arcade" stream. It keeps downloading frames even when hidden,
  so I'm writing a mod that takes it out of the site's home data before the page sees it." (run 4)

And in their replies to the user:
- "Hiding the preview wouldn't be enough, because it keeps downloading video frames in the background
  (about one a second, roughly 23 KB each)." (run 1)
- "Before, it kept downloading video frames even when you weren't watching it. Now the page never starts
  it: after a reload, Glint sends only its single request for the home page." (run 2)

Compare study 2, where agents saw it was still running and judged that fine: "it's still there behind the
scenes but never shows".

The `site-data` power needs the user's OK. In runs 0 and 1 the mod was held when the run ended, so the
agent couldn't check it on the page. Both said so plainly ("Because it's held, I couldn't check it on the
page"). The harness then allowed it, as a user would, and both scored deep.

**newest: 3/3 deep.** All three read the bundle with `trif run --page … fetch("/quillby/assets/index-….js")`,
found the hidden "Newest" sort, and wrote a boxed `rewrite-requests` mod asking for `o=2`.

Run 2 hit study 2's one surface case. It read the scripts from the box first, and the box returned
`{"src": "/quillby/assets/index-8b2d4f1a.js", "len": 0, "t": ""}`. In study 2 a box run took that empty text
as "the site only lets you see comments ranked by votes" and sorted the DOM. This run fetched the file with
`--page` on its very next call, the BOXED.md line's advice.

Two runs said they hadn't clicked "Show more" to check; it worked when measured.

**suggest: 2/2 deep.** Both filtered `k: 3` from the feed's JSON with `site-data`, as all 9 did in study 2.
Run 0 went to the data first: "The feed is virtualized, so I'm filtering suggested posts out of the feed
data … instead of hiding rows". Run 1 hid the posts first, saw the gaps, and switched, in "get curious"
fashion: "Hiding them on the page just left blank gaps, because the feed places each post at a fixed spot.
So now the mod takes them out of the feed's data".

## Different wording

The guide line's examples include "a live preview", the live request's own words. To see whether the line
works only when the user's words match it, 3 more live runs used the rel031 guides with the request
reworded, one wording per run. None of the wordings contains "live", "preview", "player" or "video". The
app and the checks were unchanged. The wording comes from a new harness option, `--study-prompts 'a|b|c'`
(round N asks in the Nth wording); each row in study.json records its `prompt`.

| run | request | outcome | fix | secs | cost | tools | network looks | read bundle |
|---|---|---|---|---|---|---|---|---|
| 0 | "the little thing that keeps popping up in the bottom corner is annoying, get rid of it" | deep | data (`feat` dropped), hide as fallback | 61 | $0.40 | 13 | 6 | yes (`--page`) |
| 1 | "stop that box in the corner from showing up" | deep | data, hide as fallback | 46 | $0.36 | 9 | 6 | no |
| 2 | "make the corner popup go away" | deep | data, hide as fallback | 49 | $0.34 | 9 | 4 | no |

**3/3 deep, $1.10** (median 278k tokens, 9 tools, 49 s). Each run opened by planning a plain hide ("I'll
hide the popup in the corner of the Glint page"). Then it worked out for itself that the box was a player,
checked whether it was still downloading, and changed course:
- "The mini-player fetches a new frame every 0.4s, so hiding it wouldn't stop it." (run 0, which also read
  the bundle with `--page` to see how the page builds it)
- "The corner box is a live mini-player that keeps downloading stream frames, so hiding it alone wouldn't
  stop it. I'll drop it from the page's data instead." (run 1)
- "Hiding the popup alone wasn't enough: even when you can't see it, the player keeps downloading stream
  frames nonstop." (run 2, to the user)

So in these runs the line didn't depend on the user's words matching it. Across both wordings, live is
8/8 deep with rel031, against 0/9 in study 2.

**Not exercised.** "Don't dig in silence" never came up. No run hit a failed idea followed by a long dig,
so none stopped to offer the user choices. These tasks don't test it.

## Verdict

The 0.3.1 guides fix study 2's one real failure on these stand-ins: a hidden thing left running. `live` went
from 0/9 to 5/5 deep, by an evident mechanism. Every run checked the network before writing, which no
study-2 run did, and gave the guide line's reason. The BOXED.md line about empty `<script src>` text
prevented study 2's one newest miss the one time it came up. Nothing regressed: suggest and newest are
all deep, at about lean2's cost.

No stronger wording is needed for this failure, so the planned extra arm wasn't run. Rewording the
request away from the guide's example didn't change the result (3/3 deep).

### Caveats

1. **One kind of hidden cost.** The reworded requests rule out the user's words matching the guide's.
   But the thing being hidden is still a player, which is in the line's list. A hidden timer, an ad that
   refreshes, or a sound loop that doesn't show on the network is still untested.
2. **Small samples on stand-in apps.** One model, 13 runs. Every live lever used was on the network.
   Whether agents read obfuscated code to stop a player with no network trace is still untested.
3. **One day apart.** The arms ran a day apart rather than shuffled together. The model and Claude Code
   version were the same, but run-to-run variation over a day can't be ruled out (p ≈ 0.0005 makes chance
   unlikely).
4. **The harness's two FAIL lines are unrelated noise:** "helper log: no warnings or errors", and a
   narrow-panel screenshot timeout. Study 2's runs had the same.
