# Handoff: the `fable` review work, for whoever picks it up on a Mac

The review's fixes were written in a cloud container: no macOS, no installed extension, no real agent.
This says what has never run, in the order to check it, and how I'd approach what was left open.

Read first:

- `docs/SECURITY.md`, "Review fixes (November 2026)": what was closed and why, then "Still open".
- `docs/REVIEW-STRINGS.md`: every new line a user or an agent can read. None is approved.
- `tests/hardening.test.js`: one test per fix.

No working exploit was built for any finding. Each was confirmed by reading the code, and each fix has a
regression test. Keep it that way: `docs/SECURITY-TIERS.md` asks that a working exploit go to Tim privately.

## 1. What has never run (check in this order)

1. **`npm test` on the Mac.** About ten tests can't pass in a Linux container (they need macOS, or an agent
   installed): `claude: a run has exactly TRIF's tools`, the three `run limits:` tests, `a run never starts
   with private files in the workspace`, the `doctor:` and `setup for …` tests, `shipped-history.json`. Those
   cover code I changed (`helper/lib/agents/claude.js`, `helper/lib/agents/codex.js`, `helper/lib/runs.js`),
   so this is the first time they can be seen passing with the changes. `two browsers: a mod made by A's
   run…` in `tests/origins.test.js` failed about half the time on `main` too.
2. **The e2e** (`tests/e2e/run.js`). I changed `tests/e2e/scenario.js`: the two stand-in chat agents now
   call `trif run --page`. Untested.
3. **A boxed `trif run` through the installed extension** (`extension/background.js` `boxedRun`). Tested
   against a mock of the browser, and against real SES in a plain page (`tests/sandbox-browser.test.js`),
   never through `chrome.userScripts`. Watch for:
   - a page with no boxed mod: the runtime, SES file included, has to be injected into the sandbox world
     first (`sandboxRuntimeScript([]).js` through `userScripts.execute`);
   - whether `execute` waits for the run's promise. The code polls `__trifSandbox.result(runId)` in case it
     doesn't;
   - the page-guard mark is checked before and after, so a tab that navigates mid-run gives no result.
4. **Safari and a boxed run.** `runsBoxed` needs `sandboxWorld() === true` and `userScripts.execute`. Safari's
   adapter (`extension/safari.js`) has a stand-in `execute` that runs code in the page's own world. Confirm
   `sandboxWorld()` is false there, so a run asking for the box is refused with the `--page` message and
   never runs in the page's world under the box's name.
5. **One real Claude Code run and one real Codex run.** Does the agent use the box by default and `--page`
   only when it needs `document`? Does Claude Code accept the globs in the new deny rules
   (`claude.js` `STATE_FILES`, `INSTRUCTION_FILES`)? Are `CLAUDE.md`, `AGENTS.md` and the rest under the mods
   folder moved to `trash/_instructions/` before the run starts (`runs.js` `instructionFiles`)?
6. **Navigation.** `trif open` now starts from `about:blank` and loads under a one-rule guard
   (`extension/tablock.js` `guardNavigation`); a refused `trif navigate` goes back. Try a same-site address
   that redirects to another site: the tab should not end up there.
7. **The opener.** A tab that opened a locked tab on the same site is locked with it (`lockOpener`).
8. **Firefox.** Never run. The lock's rules now name the method `"other"`, with a fallback to the named
   methods if the browser refuses it (`withMethods`): confirm which one Firefox takes.

## 2. What was left open, and how I'd do it

Needs a Mac to get right:

- **Writes after a run's window.** A run's process group is killed, and a mod written more than ten seconds
  later is judged as an outside change. A process that left the group outlives it. The real fix is the next
  item; short of that, check on macOS whether either agent's sandbox lets a child leave the group at all.
  (Checked: both do; done with the next item, docs/STAGING.md.)
- **Runs write the mods folder directly** (the staging-folder redesign). Who wrote what is worked out
  afterwards from snapshots and a time window; several of the fixes were that reckoning going wrong. Give each
  run a folder of its own to write, and have the helper copy from it once it has decided. This changes how
  both agents are started, which is why I didn't do it blind. It's the one change here that removes a class
  of bug. (Done: docs/STAGING.md.)
- **The release key reaches the keychain through an argument** (`scripts/release.js` keygen), and the
  key-proxy address is in Codex's arguments. Both are visible to other processes of the same user while the
  command runs. Pass them on stdin or in a file readable only by the user.
- **The update feed has no expiry.** Sign a date into it and refuse a feed older than some weeks, so an old
  signed feed can't be replayed to hold a user on a version with a known hole.

Tim's calls, with what I'd recommend:

- **Shipped mods as a baseline.** A rewrite of one of Tim's mods that reuses the shipped lines isn't held.
  Tim's rule, from the prompt-fatigue discussion: the first OK was the trust, and a new question for an old
  power should come only when the power has changed in character. So keep not asking. The panel says
  "changed" now. A cheap next step is to hold only when an edit adds a power or a site the shipped version
  never had.
- **Other tabs of a locked site.** Agreed direction: lock the tabs the agent's code can reach, leave the
  rest usable. Boxed runs now need no lock, and the opener is locked. What's left is a window the page finds
  by name; lock a same-site tab when a locked tab gets a reference to it, or accept it and say so.
- **Same-site GETs.** The lock stops the methods that send. A site that changes something on a GET isn't
  covered. I'd document it and not chase it.
- **A style section inside mods.** Most edits to a mod are style edits. If the CSS, and a few typed settings
  (a number, a colour, an on/off), live in a part of the file that TRIF applies itself, an edit there can't
  change what the code does and needs no question. The condition: the code must not be able to read that
  part as text, or style becomes a way to carry code.
- **Sensitive sites: every mod starts off**, not only the agent.
- **`rewrite-requests`.** Limit what a rule may write into a request, not only which field it writes.
- **CI**, and a human reading the diff.

## 3. The phone probes

Separate work, on top of this branch: `mobile/README.md`. The Swift there has only been checked for syntax.
