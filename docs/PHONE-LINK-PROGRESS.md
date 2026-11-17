# Phone link: progress

The loop's file: read this first, every round. The design: docs/PHONE-LINK.md. Strings: docs/PHONE-LINK-STRINGS.md.
Branch `phone-link` (worktree ~/WebMods-worktrees/phone-link). iPhone work is on `ios-poc` and only when the
round's brief says it is free.

## Checklist

Computer side:
- [x] 1. Design and wire protocol (docs/PHONE-LINK.md), the strings file
- [x] 2. `helper/lib/phonelink/noise.js` (Noise IK, ciphers) and `frames.js` (packets, pieces), unit tests with
      the published vector
- [x] 3. `store.js`: the computer's key (keyring, service `TRIF phone link`), `<private>/phone-link.json`
      (on/off, port, paired phones), the pairing window (secret, 5 minutes, 5 tries, one phone), remove. Unit tests
      with `tests/fake-keychain.js`
- [x] 4. `server.js`: the listener (none while off; silent refusal of unpaired, removed, garbage, late), sessions,
      `hello`/`ping`. Tests on 127.0.0.1, a random port. `tests/phone-link-client.js` (the stand-in phone) begun
- [x] 5. `bonjour.js`: `dns-sd -R` while the listener is up (a stand-in binary in tests, `TRIF_DNS_SD`)
- [x] 6a. The `remote` mark in `runs.js`: a run started for a phone (site forced to `phone~<host>`, the phone's
      page copy and screenshot into the run's screenshots folder, context, page commands refused), with the
      stand-in model; the folder limit proven (nothing written outside `sites/phone~<host>/`)
- [x] 6b. `remote.js`: `run.start` over a session, events numbered, kept results, `run.resume`/`run.ack`,
      `run.result`, kept results deleted when the phone is removed
- [x] 7. `trif phone page|try|screenshot` (cli.js, the mailbox, `tool.request` round trip), AGENTS.md
- [x] 8. `host.js` and `link.js`: the helper that owns `helper.sock` owns the link; `phone.*` as `PANEL_COMMANDS`
- [x] 9. Desktop panel: Connect a phone (QR encoder in the extension, the list, Remove, the switch), strings
- [x] 10. End to end: `tests/phone-link-client.js` (a stand-in phone) against the real helper in a temp HOME, the
      stand-in model: pair, run, try on the phone, result, drop and resume, remove
- [x] 11. Pointers in docs/PROTOCOL.md and docs/SECURITY.md

iPhone side (needs ios-poc free):
- [x] 12. `PhoneLink.swift`: Noise IK in CryptoKit (the same published vector as a self-test), frames, NWBrowser
- [x] 13. QR scan, pairing, the computer's key and the phone's key in the Keychain; Info.plist (Local Network,
      Bonjour service, camera)
- [x] 14. "My computer" engine in More: `run.start` with the page copy and screenshot, events as `agentEvent`s,
      `tool.request` → read_page / try_mod / screenshot, resume after suspension
- [x] 15. The result to Add this mod? / the approval card; the states of PHONE-LINK.md section 8
- [x] 16. Simulator proof against the helper in a temp HOME

## Done this round (round 18, 2026-11-17)

The brief: step 16 (ios-poc free, c888b41), the picked-up run's repeated steps, then the computer's odds and ends.
- **Step 16**, one recorded Simulator pass (SE, iOS 26.3) against `tests/phone-link-computer.js`: paired by the
  code; a run with three tools (try: "free mods can't be tried here", page `h1`: 0 matches on today's
  example.com, screenshot) to Add this mod? (2 mods, Cancel each); a drop mid-run, reconnected and resumed to
  Done; the app terminated mid-run, the run picked up ("Stand-in Mac finished this while TRIF was closed.",
  "Working" once); removed ("This iPhone isn't connected to Stand-in Mac any more…"); computer gone ("Can't find
  Stand-in Mac…"). Shots: docs/phone-link-shots/sim16/ (6); the video: scratchpad `s16/pass.mov` (17 MB, not committed).
- **Wart fixed** on ios-poc 14d4ee7: `PhoneLinkRemote` keeps each run's newest shown event in UserDefaults
  (`phoneLink.shown`), `pickUp` resumes after it. Mac test 6/6 (the pickup now checks it starts after "Working").
  .ipa built (~/Downloads, iCloud TRIF/), dSYM UUID 8130EB9D-F57B-3734-9590-C84D84DB0602.
- **Computer** 7c368b1: names cut at 60 at a word with "…" (`cleanName`, also hello's device name); the e2e
  phone run now DELETEs its twin's old mod (in `removed`, gone, nothing else touched). 101/101 phone-link tests.
- CI: ios-poc https://github.com/acapellascience/trif/actions/runs/44043058248, phone-link
  https://github.com/acapellascience/trif/actions/runs/44043417800.

## Earlier rounds

- Round 17: main merged (6994b7a, the run allowlist: `PHONE_RUN_COMMANDS`); step 15 on ios-poc c888b41 (kept runs
  picked up, sandbox/login words, "Can't find" for a removed last phone).
- Round 16: step 14 on ios-poc, d66642c (PhoneLinkRemote.swift, My computer in More, the phone's name at
  pairing; a Mac test against the real Store/Server/Runs/Remote); tests/phone-link-computer.js here (5dc3e3c).
- Round 15: step 13 on ios-poc, 85166ad: `PhoneLinkPair.swift` (the code's parser, the Keychain, the pairer),
  `PhoneLinkView.swift` (the My computer sheet, the QR scanner), Info.plist's Local Network, Bonjour and camera
  words; a Mac test of the pairer against the real server.js and store.js; CI's unit suite green, the browser
  suite's first test timed out (see the CI section).
- Round 14: step 12 on ios-poc, f2f2ded: `PhoneLink.swift` (Noise IK in CryptoKit with the published vector as a
  self-test, frames, `PhoneLinkBrowser`, `PhoneLinkSession` and its ends), `mobile/test/phonelink.test.js`
  against this branch's noise.js and frames.js, the `phonelink` dev step. CI green first time, run 44032210025.
- Round 13: main (18019be: phone-view-scope, downloads, the skill, the clip page) merged here, 88c0640; one
  conflict, host.js's `PANEL_COMMANDS` (both kept). Found after it and fixed: `skill/build.js`'s cut took this
  branch's "Phone runs" into the skill; the cut now stops at "### Phone runs" (6bc818b). Its progress-file edit
  was committed by round 14 (2bf47a6); that commit's CI failed on the clickjacking flake alone, rerun once (see the CI section).
- Round 12: the look at Settings' Connect a phone in a real browser, `tests/phone-link-browser.test.js`
  (macOS; headless Chrome for Testing with TRIF's own extension, the real host.js by native messaging in a
  temp workspace; each state light and dark, the code read back from the screenshot by macOS's reader and
  paired with; 27 s). Found and fixed: the panel's icon rule outlined the QR's modules into a blot no camera
  could read (`stroke: none` now); a window under about 420 px high cut the code (`.pl-qr` is at most
  `max(55vh - 40px, 150px)` wide). `tests/cdp-page.js` `launch` takes `prepare(profile, extensionId)`. The
  22 screenshots are in `docs/phone-link-shots/`, not committed. CI: every phone-link test passed, the phone
  view's window-size flake failed in each of 4 runs.
- Round 11: a phone's run in the real sandbox (`tests/run-sandbox.test.js`, its third test: the real Claude
  Code, the stand-in model, the stand-in phone; `trif phone` works inside, the link's files and key, this
  computer's tabs and the site's desktop mods are refused); not with Codex (three tries, see the notes); a
  long computer name cut in the QR's text (`store.js` `qrName`). CI for 8a7b8f3: every phone-link test
  passed in both attempts, a known browser flake failed in each.
- Round 10: step 10, `tests/phone-link-e2e.test.js` (one story with the stand-in phone against the real
  host.js in a temp HOME: pair from the code's text, a run with a try on the phone, page commands refused in
  words, the twin's mods alone, nothing for the extension, the page copy in no file afterwards, a drop and a
  resume, `run.ack`, remove, off; 2 s); the stand-in agent's `CLI[args]`; step 11, the pointers in
  docs/PROTOCOL.md and docs/SECURITY.md. **The computer side's checklist was done there.** CI green for
  2714c89 on the first attempt.
- Round 9: step 9, the side panel's Connect a phone: `extension/qr.js` (TRIF's own QR encoder, the same
  matrices as macOS's generator, vectors in `tests/phone-link-qr.vectors.json`), `extension/phonelink.js`
  (the section at the end of Settings), background.js `phoneLink.*` from the panel's page alone, 11 tests.
  **Not seen in a real browser yet** (needs Tim's OK for a local browser run). CI for 8e57db2: every
  phone-link test passed in both attempts, one known browser flake failed in each.
- Round 8: step 8, `link.js` (class `Link`) and host.js: the helper that owns `helper.sock` owns the link;
  `phone.status|on|off|pair.start|pair.stop|remove` as `PANEL_COMMANDS`, the `phoneLink` message; a helper
  without the socket has the store alone (`here: false`); `testEnv` keeps every test helper off the network
  and the Keychain; `tests/phone-link-host.test.js`. CI green for c0172aa on the first attempt.
- Round 7: step 7, `trif phone page|try|screenshot` (cli.js → the run's mailbox → host.js → `remoterun.js`
  `remoteCommand` → `Remote.tool` → `tool.request` on the session that follows the run), AGENTS.md "Phone
  runs", 9 tests. CI green for 69375a1 on the first attempt.
- Round 6: step 6b, `remote.js` (class `Remote`: `run.start`, numbered `run.event`s, `run.result` from the
  run's own twin, `run.resume`/`run.ack`/`run.stop`, kept runs in `<private>/phone-link/kept/`, a phone's own
  runs only, deleted with the phone), 8 tests. CI green for 71fe8e8 on the first attempt.
- Round 5: step 6a, `Runs.startRemote` and `phonelink/remoterun.js` (the site made from the page address, the
  stage's `twinOnly`, `remoteRefusal`, never without the sandbox), 10 tests. CI green for a6878b0 on the first
  attempt.
- Round 4: step 5, `bonjour.js` (class `Announcer`: one `dns-sd -R` child while the listener is up, restarted
  when it dies, a stand-in binary in tests through `TRIF_DNS_SD`), 11 tests. CI green for 0bd5bdc on the first
  attempt.
- Round 3: step 4, `server.js` (the listener: none while the store says none, silent refusals, sessions, `hello`
  and `ping`), `tests/phone-link-client.js` (the stand-in phone), 13 tests. CI green for 8a04fa2 on the second
  attempt.
- Round 2: step 3, `store.js` (the computer's key in the keyring, `phone-link.json`, the pairing window, remove),
  18 tests. CI green for 7dcd239 on the second attempt.
- Round 1: the survey, docs/PHONE-LINK.md, docs/PHONE-LINK-STRINGS.md, step 2 (`noise.js`, `frames.js`, 18 tests
  with the published cacophony vector). CI green for c8898a4:
  https://github.com/acapellascience/trif/actions/runs/43959884729

## CI

- Round 17: the merge 6994b7a, run https://github.com/acapellascience/trif/actions/runs/44039586205: failed first on
  the known clickjacking-guard flake alone (cba664f's run had it too, with a phone-view test main has since fixed);
  rerun once: success. ios-poc c888b41 (step 15), https://github.com/acapellascience/trif/actions/runs/44040898733:
  success first time. The commit that records this (strings, the stand-in's LOGGEDOUT, this file) was pushed after.
- Round 16: phone-link 5dc3e3c (tests/phone-link-computer.js, strings), success first time,
  https://github.com/acapellascience/trif/actions/runs/44037688934. ios-poc d66642c (step 14), run 44037674336:
  failed on bridge.test.js "the page side of site-data" alone again (60 s timeout; 793 tests, 781 passed). Looked:
  not this branch's code, not the runner's Chrome (157.0.8103.78 on both the passing f2f2ded and the failing runs).
  Its 60 s limit counts `tests/cdp-page.js` `launch`'s wait for the test browsers' lock (up to 10 min), and test
  files run side by side: this one, the suite's first browser, waited behind another file's browser. 85166ad and
  d66642c changed the files' timing (phonelink.test.js's swiftc builds), not the test. Fixed on ios-poc b54bc59
  (its limit 600 s, a comment says why), run https://github.com/acapellascience/trif/actions/runs/44038468476:
  success (793 tests, 782 passed, 11 skipped, 0 failed; the new My computer test skipped there: no phone-link
  folder). The commit that records this line was pushed without waiting for its run (docs only).
- Round 15, ios-poc 85166ad, run 44034027521: unit suite green; the browser suite's first test, mobile/test/
  bridge.test.js "the page side of site-data", timed out (60 s) in both attempts (the second by `gh run rerun
  --failed`, once). It passed in 5 s on f2f2ded 15 minutes earlier and the commit changes no page code: a new
  flake to watch (it is the suite's first Chrome launch). If it fails again on the next ios-poc push, look at
  `tests/cdp-page.js` `launch` on the runner. The phone-link commit with this file is docs only, pushed without
  waiting for its run.
- Round 14, 2bf47a6 (round 13's progress-file edit, docs only; the code is 6bc818b's): failed in both
  attempts on one known browser flake each, run https://github.com/acapellascience/trif/actions/runs/44031391641
  (976 tests, 967 passed, 1 failed each): attempt 1 the clickjacking guard, attempt 2 (`gh run rerun --failed`,
  once) the phone view's "the site sees an iPhone in that tab only". Every phone-link test passed in both. The
  commit that records this line was pushed without waiting for its run (docs only).
- Round 12, 3 runs, each failed on a browser test: 692162f, run 44009878623 (936 tests, 925 passed, 3
  failed): the phone view's "the site sees an iPhone in that tab only" and "desktop mods never run in the
  phone view" (known flakes) and this round's own browser test, which runs there after all (CI's runner is
  macOS with `TRIF_BROWSER_TESTS=1`): CI's Vision writes a notice of its own to the reader's output before
  the code's text. The next commit's run, 44010570874, showed that (the text's shape alone); fixed in the
  one after (the reader marks its lines), run
  https://github.com/acapellascience/trif/actions/runs/44011280246: 936 tests, 927 passed, 8 skipped, 1
  failed, the phone view's "the site sees an iPhone in that tab only" alone; the new browser test and every
  other phone-link test passed. That flake failed in all three runs. One guess, not proven: this round's
  test built its reader (swiftc) while that test's browser ran; the build now waits for the browsers' lock.
  46e4d37 (the build under the lock), run https://github.com/acapellascience/trif/actions/runs/44011896600:
  the same, 927 passed, 1 failed, that flake alone, so the guess was wrong. How it fails: "the page area is
  the phone's", `{w: 776, h: 813}` for `{w: 390, h: 750}` (the phone window's size, in tests/phone-browser.test.js;
  not this branch's code). Four runs in a row now: for the main session. The commit that records this line
  was pushed without waiting for its run (docs only).
- Round 11, 8a7b8f3: failed twice on browser tests alone, run
  https://github.com/acapellascience/trif/actions/runs/44007593328: attempt 1 (935 tests, 926 passed, 8
  skipped, 1 failed) on the clickjacking guard alone; attempt 2 (`gh run rerun --failed`, once, as the brief
  says: 924 passed, 3 failed) on the phone view's three ("the site sees an iPhone in that tab only", "a site
  whose service worker serves its pages", "TRIF as installed, on a site without access"). Each passed in the
  other attempt; every phone-link test passed in both, the new store test too (the real-sandbox test is
  skipped there, as its file's other two are: no Claude Code on CI). Known flakes, not looked into. The
  commit that records this line was pushed without waiting for its run (docs only).
- Round 10's docs-only commit af8e169 (the same code as 2714c89): failed on the clickjacking guard alone, run
  44006336367: the known flake, not rerun.
- Round 10, 2714c89: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/44005995592
  (933 tests, 926 passed, 7 skipped, 0 failed; the end-to-end test ran there, the browser tests passed too).
  The commit that records this line was pushed without waiting for its run (docs only).
- Round 9's docs-only commit a9cd0d9 (the same code as 8e57db2): failed on the clickjacking guard alone, run
  44005073014 (932 tests, 924 passed, 1 failed): the known flake, not rerun (the next commit's run is green).
- Round 9, 8e57db2: failed twice on one known browser flake each, run
  https://github.com/acapellascience/trif/actions/runs/44003832633 (932 tests, 924 passed, 7 skipped, 1 failed
  in both attempts): attempt 1 on the clickjacking guard alone, attempt 2 (`gh run rerun --failed`, once, as
  the brief says) on the phone view's "the site sees an iPhone in that tab only" alone. Each passed in the
  other attempt; every phone-link test (the 11 new ones too) and the rest of tests/extension.test.js passed in
  both. Not looked into (not this branch's code). The commit that records this line was pushed without
  waiting for its run (docs only).
- Round 8, c0172aa: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/44001876567
  (921 tests, 914 passed, 7 skipped, 0 failed; the host test ran there, the browser tests passed too). The
  commit that records this line was pushed without waiting for its run (docs only).
- Round 8, a48e0d0: failed, run 44001116015 (921 tests, 911 passed, 3 failed): the two known browser flakes
  (the clickjacking guard; the phone view's "the site sees an iPhone in that tab only") and this round's own
  host test, on a race in the test (it took an older `phoneLink` message for the one after Remove, then found
  the listener still closing). Fixed in c0172aa (the line above).
- Round 7, 69375a1: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/43998715361
  (920 tests, 913 passed, 7 skipped, 0 failed; all 9 tool tests ran there, the browser tests passed too).
  Locally `npm test` (no browser tests) had one failure, not this branch's: tests/update.test.js "release
  script: secrets go to security and web-ext…", which needs `web-ext` and this worktree's node_modules has
  none (alone, it hangs until killed: don't run it locally here; CI runs it and it passes).
- Round 7's docs-only commit 2126d2b (the same code as 69375a1): failed twice on the phone view's browser
  tests alone, run 43999029519: attempt 1 on "the site sees an iPhone in that tab only", attempt 2 (`gh run
  rerun --failed`, once, as the brief says) on that one and "TRIF as installed, on a site without access".
  Every phone-link test passed in both. Known flakes, not looked into; the commit that records this line was
  pushed without waiting for its run.
- Round 6, 71fe8e8: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/43994465011
  (911 tests, 904 passed, 7 skipped, 0 failed; all 8 remote tests ran there). The commit before it, 766ae0d,
  failed (run 43993766535: 901 passed, 3 failed): the clickjacking guard's timing check and the phone view's
  "the site sees an iPhone in that tab only" (both browser tests this branch doesn't touch, both passed in the
  next run), and this round's own conversation test, on timing (fixed in 71fe8e8: see the notes).
- Round 6's docs-only commit a2df505 (the same code as 71fe8e8): failed twice on browser tests alone, run
  43995033266: attempt 1 on the phone view's "a site whose service worker serves its pages", attempt 2 (`gh run
  rerun --failed`, once, as the brief says) on the clickjacking guard and the phone view's "the site sees an
  iPhone in that tab only". Every phone-link test passed in both. Not looked into (not this branch's code);
  three different browser tests have now flaked in one evening: for the main session.
- Round 5, a6878b0: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/43971467309
  (903 tests, 896 passed, 7 skipped, 0 failed; all 10 remote-run tests ran there)
- Round 4, 0bd5bdc: success on the first attempt, https://github.com/acapellascience/trif/actions/runs/43967487962
  (all 11 announcer tests ran there). Round 3's docs-only commit 0f79fa7 had failed on the clickjacking guard's
  timing check alone (873 passed, 1 failed, run 43966627115): the known flake, rerun once with
  `gh run rerun 43966627115 --failed`.
- Round 3, 8a04fa2: success on the second attempt, https://github.com/acapellascience/trif/actions/runs/43965527256
  (attempt 1: 873 passed, 1 failed, the clickjacking guard's timing check again, this time "the second look:
  19.40 ms at most"; all 13 server tests passed in both attempts; `gh run rerun <id> --failed` cleared it)
- Round 2, 7dcd239: success on the second attempt, https://github.com/acapellascience/trif/actions/runs/43961575804
  (attempt 1 failed on two browser tests this branch's work doesn't touch: the clickjacking guard's timing check,
  "a press: 5.58 ms on average", and the phone view's "desktop mods never run in the phone view", `window.__ask is
  not a function`; every phone-link test passed in both attempts; `gh run rerun <id> --failed` cleared it)
- Round 1, c8898a4: success, https://github.com/acapellascience/trif/actions/runs/43959884729

## Next step

None on the checklist: every item is done. Left for the main session and Tim: the `denied` Local Network flow
(device-only, Tim's phone, by Tim); optional, Add this mod? saying the mod came from the computer; the phone
applying `removed` (a deleted twin mod) on its side is not built (the result carries it, the app ignores it);
the iPhone still cuts its own name hard at 60 before sending (`sentName`), so the computer's word cut only shows
for longer names from other clients; merging `phone-link` and the iPhone side is Tim's call.

## Notes for next round

- **Round 18:** the recorded pass's helpers: scratchpad `s16/lib.sh` (`st`, `say`, `shot`, `chat`, `send`,
  `newchat`). The stand-in agent takes one `PAUSE`; a `trif phone …` asked while the phone is away fails at once
  (`away`, the agent's error), so a drop with a tool after it shows no tool step. A rerun of WRITE on the same site
  offers nothing (the twin's mods unchanged). The iOS Simulator tool's taps are in points (SE: 375×667).
  `phoneLink.shown` is pruned at each hello to the runs the computer keeps or the app follows.

- **Round 17:** a picked-up run replays from event 1, so a chat that already showed the first steps before the app
  was closed shows them twice ("Working" twice in the Simulator). The app keeps no event numbers across launches;
  harmless, could be fixed by keeping `following` in UserDefaults. A stale `chat.run` in the panel store from a
  killed app is replaced by the adopted run; one with no kept run stays as before (pre-existing).
- **The Simulator asks no Local Network question**: NWBrowser browses without a prompt there, and a missing
  computer is `notFound` after 5 s. `denied` (PHONE-LINK.md 8) can only be seen on a device.
- Simulator recipe that worked: stand-in computer through a FIFO (as round 16), `simctl launch … -noserver -noopen
  -linkhost 127.0.0.1:<port> -go https://example.com/` (More needs a page open), `simctl openurl` the qr, then
  steps `{"more": true}`, `{"sheet":"chat"}`, paneljs: `#agent` = computer, `#input`, `#composer.requestSubmit()`.
  Kept run: `PAUSE:k WRITE`, `simctl terminate`, `go k`, `kept` until done, launch again, `{"sheet":"chat"}`.
- Stand-in words: `LOGGEDOUT` (tests/phone-link-agent.js) fails as a logged-out agent (a 401 result).
- host.js after the merge: a run's request is checked against `run.remote ? PHONE_RUN_COMMANDS : RUN_COMMANDS`
  first, then `remoteRefusal` (a phone run's delete/restore: its own twin). A new run command on main must be
  added to RUN_COMMANDS there; it reaches phone runs only if it is also in remoterun.js `REMOTE_COMMANDS`.

- **Step 14's API (ios-poc):** `PhoneLinkRemote(keys:phoneName:device:app:endpoints:queue:)`: `connect(done)`,
  `start(url:prompt:page:shot:chat:session:width:done)` → the computer's runId, `stop`, `unfollow`, `wake`,
  `close`, `drop` (tests), `retry` (the waits; `[]`: none, `wake()` only), `state`, `hello` (`pending`),
  `following`; callbacks `onEvent(runId, n, ev)`, `onResult(runId, msg)`, `onTool(runId, tool, input, answer)`,
  `onLost(runId, RunError)`, `onState`. In PanelChat: `link` (lazy), `goComputer`, `computerEvent/Result/Tool/Lost`,
  `linkWords(code, message)`, `wakeLink()` (didBecomeActive), `linkChanged()` (PhoneLinkModel's `computer` changed:
  `window.__trifPanelLinkChanged` repaints the Settings block and re-lists the agents). Panel requests `link.status`,
  `link.open`; the link https://pair.trif.invalid/ is caught like Ask Claude's.
- The panel's sessionId for My computer is the computer's agent session (from its `session`/`done` events); the
  next `run.start` sends it as `session`, which the computer takes only for that phone's own twin (5b).
- With no phone paired and no pairing window, the computer doesn't listen: a removed last phone finds nothing
  (`notFound`, "Can't find …"), not `removed`. The Mac test opens a pairing window before removing to see
  `removed`. Both are honest; Tim may want the removed-last-phone case worded better (it can't be told apart).
- `tests/phone-link-computer.js` (this branch): the stand-in computer for ios-poc. `node tests/phone-link-computer.js
  --seconds 600` prints `{port, qr, home}`, then stdin lines `pair`, `go <word>`, `list`, `remove`, `kept`
  (`{kept: {<phone>: [{runId, done}]}}`), `quit`. For the Simulator: a FIFO for stdin (`mkfifo plc.in`, hold it
  open with `sleep 900 > plc.in &`, start the node with `< plc.in > plc.out &`, then `echo "go b" > plc.in`); launch
  the app with `-linkhost 127.0.0.1:<port>`, `simctl openurl` the qr, then More: `paneljs` sets `#agent` to
  `computer` and submits `#composer` (scratchpad `panelrun.sh` shows the pattern). The stand-in's words in the
  request: `WRITE PHONE[try bottom-bar] PHONE[page h1] PHONE[screenshot]`, `PAUSE:<word>`, `SLEEP`.
- In the Simulator the app put in the background (`simctl launch … com.apple.Preferences`) kept its connection
  for the few seconds tried: use the `phonedrop` step to lose it.
- The stand-in's mods have no tier (free mods): `try_mod` answers "free mods can't be tried here", an honest
  error the agent gets; a style mod would be tried for real.

- **Step 13's API (ios-poc):** `PhoneLinkKeys.shared.phoneKey()` (made once; nil if the Keychain refuses),
  `.computer` → `PairedComputer {key, name, pairedAt, id}` or nil, `.save`, `.forget()`. `PhoneLinkModel.shared`
  (MainActor): `shown`, `open(text)`, `pair(code)`, `forget()`, `computer`, `step`, `describe`. A `refused` end on a
  session with no `pair` (step 14) means "removed there or the link turned off": PHONE-LINK.md 8's "pair again".
- The pairer keeps the computer when the handshake's answer decrypts, before the `hello` answer (a lost `hello`
  answer still leaves both sides paired). The phone's name in `pair` is `UIDevice.current.name` (iOS 16+: "iPhone"
  unless the app has the user-assigned-device-name entitlement; the Simulator gives its model name).
- Simulator pairing against real helper code without Bonjour or the real network: a node script in the scratchpad
  (`sim-pair-computer.js`: tests/fake-keychain.js, `Store` + `Server` on 127.0.0.1 port 0 in a temp HOME, writes
  `{port, qr}`, stops itself after 120 s), launch with `-linkhost 127.0.0.1:<port>`, `simctl openurl <dev> "<qr>"`,
  then the `phonepair` step. iOS asked no question for `simctl openurl` of the app's own scheme.
- `node --test mobile/test/phonelink.test.js` on ios-poc: 5 tests, ~8 s (the pairer test spawns the check with
  `CHECK_PHONE_KEY` so two runs share one phone key). It finds tests/fake-keychain.js next to the phonelink folder
  (`lib/../../../tests`); without it that test skips.
- The camera prompt in the Simulator: Allow at (262, 456) in points on the SE; then "no camera" (no capture device).

- **Step 12's API (ios-poc, PhoneLink.swift):** `PhoneLink.newKeyPair()` → `(privateKey, publicKey)` Data,
  `PhoneLink.keyId(pub)` (the record's and the store's `id`), `PhoneLink.selfTest()` → nil or what failed (call it
  before the link is first used; refuse the link if it fails). `PhoneLinkBrowser(queue:)`: `start()`, `stop()`,
  `onChange(records, state)`, `PhoneLinkBrowser.candidates(records, computerId:)` (try each in turn: a stale
  record answers `unreachable`). `PhoneLinkSession(endpoint:privateKey:computerKey:hello:queue:)` (`hello`:
  `{v: 1, name, pair?}`), `start()`, `onOpen(payload)`, `onMessage(obj)`, `onEnd(End)` (once), `send(obj)` → Bool,
  `close()`. `refused` = closed after the first message with no answer (PHONE-LINK.md 8: "pair again");
  `unreachable` = no connection or no answer in 5 s. The session doesn't send `ping` or `hello` (the app's
  message, not the handshake's): step 14 sends `hello` at once on `onOpen` (the server wants a transport message
  within 5 s) and `ping` every 30 s.
- ios-poc test: `node --test mobile/test/phonelink.test.js` (5 s; macOS; it finds this worktree's
  helper/lib/phonelink by path, or `TRIF_PHONE_LINK_LIB`; on ios-poc's CI only the self-test runs). Don't put
  helper `.js` files under `mobile/test/`: `node --test`'s default glob runs every `.js` under a `test/` folder.
- Simulator: build as IOS-AGENT-NOTES.md says (a sim.entitlements in the scratchpad: application-identifier and
  keychain-access-groups `SIMTEST.com.timsrobot.trifprobe.browser`), `simctl install`, `simctl launch <dev>
  com.timsrobot.trifprobe.browser -noserver -noopen`, then `{"phonelink": 1}` into `Documents/step.json` and
  `notifyutil -p com.trif.probe.step`; the answer is in `Documents/step-out.txt`.
- The pbxproj ids used: `…00000028` (build file) and `…00000029` (file ref) for PhoneLink.swift; next free `…2A`.
- **After merging main again**: run `node --test tests/skill.test.js` too. The skill (`skill/trif/`, main's)
  is cut from helper/workspace/AGENTS.md by `skill/build.js` at headings; anything this branch adds to
  AGENTS.md inside a cut lands in the skill unless the cut is moved. "Phone runs" is kept out (the cut for
  mod-format.md ends at "### Phone runs"); when this branch is merged for a release, main decides whether
  the skill should say anything about phones (it shouldn't need to).
- host.js's `PANEL_COMMANDS` is now main's list plus `...PHONE_COMMANDS`; `panelCommand` handles `phone.*`
  first, then main's `downloads.*` and the agent ones. A new panel command on main will conflict on that
  one line again: keep both.
- main's phone-view-scope is here now: `stage.js` `ownFolder` gives a phone scope its twin alone,
  `trash.js` `siteInScope` the same for delete and restore. The two notes further down that say a phone run
  can't delete a phone mod yet are from before the merge (kept for their detail); whether it works for a
  phone's run is the next step's first check.
- The browser look: `TRIF_E2E_CHROME="$(ls -d ~/WebMods/tests/e2e/.browsers/chrome/*/chrome-mac-*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing | tail -1)"
  TRIF_BROWSER_TESTS=1 PHONE_LINK_SHOTS=docs/phone-link-shots node --test tests/phone-link-browser.test.js`
  (27 s; this worktree has no Chrome for Testing of its own, the main checkout's is used). It needs Tim's OK
  each time, as any local browser run. The helper there is started by Chrome through a small `host.sh` that
  sets `testEnv`'s variables and becomes host.js (cdp-page strips `TRIF_*` from Chrome's own environment).
  The panel's page opened in a tab (`chrome-extension://<id>/sidepanel.html`) works as the side panel does
  for Settings. After the switch goes on again the listener is up a moment after the panel says "on": the
  test waits for it (not looked into; the end-to-end test has the listener's own proof).
- **Anything drawn as an SVG in the side panel is outlined by `sidepanel.css`'s `svg` rule** unless it says
  `stroke: none` itself: that is what broke the code. Unit tests with a fake document can't see CSS.
- The real-sandbox phone test: `node --test --test-name-pattern "a run from a paired phone"
  tests/run-sandbox.test.js` (5 s; the whole file 19 s). It needs the real Claude Code on this Mac and runs
  it with fake keys against `tests/fake-anthropic-server.js`. Steps that need the run's id (the page copy's
  file name) are objects in the script that `phoneRun`'s `known({runId, port, pageFile})` fills in once
  `run.started` is back, before the agent's first step. The page copy is at
  `<private>/screenshots/phone_<host>/phone-page-<runId>.txt`.
- Codex and a phone run, what was found: with no model given (a phone's run has none), Codex's requests to
  the stand-in carry model `gpt-6.1-sol` and **no `tools` field at all**, so `tests/fake-model-server.js`
  falls back to a call named `shell`, which Codex answers with "unsupported call: shell" (16 times, then the
  run ends ok with nothing done). `model = "stand-in"` in the scratch home's `~/.codex/config.toml` changed
  nothing: the request still said `gpt-6.1-sol` (not looked into: whether Codex ignores it there or the
  helper names a model). Ways on: teach the stand-in what Codex's catalog models call (look at a real
  request's `input` for the tool list), or a model choice for phone runs ("For Tim" 3). The Codex fixture
  would be `setup('codex')` with only Codex in `agentbin` (add `only !== 'codex'` to the Claude link line).
- A stand-in model server's `step` counter is never reset (`setScript` swaps the array's contents only): a
  second run against the same server starts where the first stopped. One run per server, or a new fixture.
- `checkRefused(named, refused, info, secrets)` takes the strings no refused command may print (default: the
  fixture's `SECRET`); `BY.phone` is the helper's refusal to a phone's run.
- `qrName(name, room)` returns the name percent-encoded (what goes after `&n=`), never more than `room`
  bytes; the phone's side (step 13) just reads `n` with URLComponents and may see a "…" at its end.
- Step 10's test: `node --test tests/phone-link-e2e.test.js` (2 s). It calls `standInAgent()` for the temp
  workspace (which also sets this process's env, unused there) and gives the spawned helper the same through
  FakeExtension's `testEnv` plus `env: {...chain.env, TRIF_DNS_SD, TRIF_AGENT_KILL_GRACE_MS}`; the helper
  finds the stand-in `claude` through `<private>/config.json`'s `env.PATH`, and `hello.agent` is
  `{name: 'Claude Code', model: null}` there. The keychain and dns-sd stand-ins are in a second temp folder.
- In that test the extension gets one `mods` message during a run (the twin's new mods, for the desktop
  phone view: expected), no `request`, no `agentEvent`. After a run the private folder has `helper.log`,
  `runs/<runId>.jsonl`, `phone-link/kept/<phone>/<runId>.json` and `sessions.json`: none has the page copy
  or a screenshot (the test reads every file but the stand-in agent's own notes in `fakebin/`).
- `run.resume`'s `first` is the first event the computer still has (1 here), not `after + 1`; the events
  that follow are the ones past `after`. For step 14: take `last` and `done` from the answer, number from
  the events themselves.
- The stand-in agent's `CLI[args]` results are in `phoneCalls()` too, with `cli: true`, in the order of the
  words in the message.
- docs/PROTOCOL.md is in the npm package's files: its new section's heading says "branch `phone-link`, not
  released"; change the heading (and SECURITY.md's) when the branch is merged for a release.
- tests/open-models.test.js's real-Codex test failed once in the whole local suite and passed alone: load
  (another batch was building on this Mac), not looked into.
- Step 9's API. qr.js: `qrMatrix(text, {level, mask})` → `{version, level, mask, size, rows}` (throws "too
  long" past 271 bytes), `qrPath(qr, quiet = 4)` → `{d, size}`, `qrFit(bytes, level)`, `qrPenalty(rows)`.
  phonelink.js: `TEXT` (every string; the panel test checks each is in the strings file, apostrophes aside),
  `createPhoneLink({request, changed, now, setTimer, clearTimer})` → `{state, view(), open(helperConnected),
  close(), onMessage(status), connect(), cancel(), toggle(on), remove(id)}`, `phoneLinkView(state, now, date)`,
  `renderPhoneLink(root, link, {doc, addMore})`, `sentence(e)`. sidepanel.js has four touches: the import, the
  `phoneLink` const above `request()`, the `phoneLink` message in `onPortMessage`, `toggleSettings` and
  `refreshStatus` (the helper coming or going while Settings are open).
- The reference tool for the QR vectors is not in the repo (a 40-line Swift file: `CIQRCodeGenerator` with
  `inputCorrectionLevel`, the bitmap read back as rows; `VNDetectBarcodesRequest` to read a matrix). Apple's
  generator uses alphanumeric mode for texts of capitals and digits alone, so compare with texts that have a
  lower-case letter. The iPhone side (step 13) reads the code with the same Vision/AVFoundation reader.
- The fake port's sender in tests/extension.test.js: a port whose sender id isn't the extension's gets no
  reply at all (`onConnect` ignores it), so "not the panel" senders there are the extension's other pages and
  content scripts (the existing test's three).
- The section's three layers (label, line, explanation) are in phonelink.js's `TEXT`, not in
  extension/explain.json: the table's terms carry an approval stamp and docs/EXPLAIN.md is written out from
  it, so they move there once Tim approves the words (then `trif explain` has them, and agent notes).
- Step 8's API. `new Link({home, runs, version, log, agent, getWorkspace, env})` (an EventEmitter, `'change'`):
  `start()` (the owner's; async), `closing()`, `stop()` (async), `refresh()`, `onEvent(runId, event)` → true
  for a phone's run, `tool` (a getter: the function for `remoteCommand`, or null without the link),
  `status()`, `command(cmd, args)` (async; throws with `e.code` `elsewhere`, `no-listener`), `owner`, `store`,
  `server`, `announcer`, `remote`. `COMMANDS` is the list host.js puts in `PANEL_COMMANDS`.
- For step 9: `phone.pair.start` answers `{qr, expires, ...status}`; its `port` is the listener's. The panel
  must not keep or log `qr` beyond drawing it. `phone.status` first, then `phoneLink` messages follow by
  themselves. In a helper without the link `phone.pair.start` fails with "another browser's TRIF has the
  phone link just now…": show the strings file's line for `here: false` instead of calling it.
- For step 10: the host test's helpers to copy: `panel(ext, cmd, args)` (a request as the side panel's),
  `qrOf(qr)` → `{key, secret}`, `connect(port, computerKey, keys, {name, pair})`, `listening(port)`,
  `everyFile()`. A host test brings `env: {...chain.env, TRIF_DNS_SD: standIn.bin}` (`makeFakeKeychain`,
  `makeStandIn` from tests/fake-dns-sd.js); without them `phone.on` fails (no keychain) and the announcer
  says `missing`. The stand-in agent for a run through the real host.js: `standInAgent` sets `process.env`
  for this process; a spawned helper needs the same variables in the FakeExtension's `env` (look at what
  `standInAgent` sets). Test: `node --test tests/phone-link-host.test.js` (3 s).
- `TRIF_PHONE_LINK_HOST` takes only `127.0.0.1` or `::1` (anything else is ignored: every interface, as the
  phone needs). It can only narrow where the listener is.
- A second owner can't happen through `becomePrimary` (a live `helper.sock` is probed first), but if someone
  deletes `helper.sock` under a live helper, another helper takes it and the first gives the link up at its
  next poll (2 s): for those 2 seconds both may listen (the second on another port when the kept one is
  taken) and both may announce. The phone matches on the id and tries each record (step 12's note), and both
  helpers trust the same file, so nothing is weakened; noted, not fixed.
- The whole suite locally, without the update test that hangs here: `node --test $(ls tests/*.test.js | grep
  -v update.test.js)` (64 s, no browser tests without `TRIF_BROWSER_TESTS=1`).
- Step 7's API. `remote.tool(run, cmd, args)` → a promise of `{text, file | null, error}` (`run`: the helper's
  live run, from `runs.byToken`; rejects with `e.code` `not-remote`, `away`, `timeout`, `busy`, `bad-request`,
  `no-mod`, `too-big`; the message is for the agent). `remote.tools` (id → waiting request), `remote.toolMs`
  (a test may lower it). remoterun.js: `REMOTE_TOOLS` (command → the phone's tool), `remoteCommand(run, cmd,
  args, tool)` → null (not a `trif phone` command) or a promise (host.js replies with it), `toolRequest`,
  `readDraft(run, id)` → `{id, code}`, `writeToolShot(run, buf)` → the file or null, `AWAY` (the text).
- `try_mod`'s `input` is `{id, code}` (the id for the app to name the draft; PHONE-LINK.md's table says so).
  For step 14: the app answers `tool.result {id, text, shot, error}`; `error: true` makes the agent's command
  exit 1 with `text` on stdout; a `shot` that isn't a JPEG or PNG is dropped with a line saying so.
- The stand-in agent has `PHONE[<args>]` (runs the real `trif phone <args>` through the mailbox, in order;
  `phoneCalls()` → `[{args, status, stdout, stderr, shot}]`), and the stand-in phone `phone.onTool = (request)
  => ({text, shot, error}) | null` with every request in `phone.tools`. In a test, the Runs' `onRequest` must
  answer the mailbox as host.js does: copy it from `tests/phone-link-tool.test.js` (step 10 uses the real
  host.js instead). `WRITE` writes the same files every time: a second `WRITE` run on a site changes nothing,
  so its result has no mods (use a site no run has written for). Test: `node --test
  tests/phone-link-tool.test.js` (4 s).
- A JS regex inside the stand-in agent's template needs its backslashes doubled (`\\[`): round 7 lost a run to
  `/PHONE[…]/` there; the run's first event carries the agent's syntax error.
- **The phone view's scoping fix (For Tim item 7) is done on branch `phone-view-scope`** (commits a3c92f1,
  39c219c; it also fixes the `window.__ask is not a function` flake in tests/phone-pages.js). It is not on
  main yet and waits for Tim: don't merge it here. Once it is merged (main, then here), a phone run's delete
  starts working: `trif delete` and a file the run deletes in its own twin, and `run.result`'s `removed`
  gets real entries; step 10's end-to-end test should then use the stand-in agent's `DELETE`.
- Step 6b's API: `new Remote(store, server, runs, {home | getWorkspace, log, agent: () => ({id, name, model}) |
  null, now, keepMs, flushMs})`; `start()` (registers `run.start|stop|resume|ack` on the server, sets
  `server.helloMore`, follows the store, reads the kept folder; returns the Remote), `stop()` (writes what isn't
  written; call it after `runs.stopAll()` in host.js's shutdown so that the runs' last events are kept),
  `onEvent(runId, event)` → true when the run is a phone's (host.js must then not send it to the extension, but
  keep its own `done` handling: `syncMods`, `held`), `hello(session)`, `records` (runId → record: `phone`,
  `scope`, `splits`, `chat`, `n`, `events [{n, event}]`, `done`, `result`, `session`), `orphans` (runs of a
  removed phone that are still ending). Also exported: `resultOf(ws, scope, splits, changedFiles)`,
  `decodeShot(base64)`. remoterun.js has `remoteScope(url, splits)` → `{url, host, site, scope}` now.
- For step 8: the `agent` option is what `hello` shows and what starts the run (`id`, `model`): give it the
  default agent as the panel would choose it (`agents.listAgents(ws).default` and its name); without it the
  run uses `Runs.start`'s default and `hello.agent` is null.
- `run.resume` answers itself (`session.send` with the request's id) so that `ok {first, last, done}` goes
  before the events; the other handlers return their answer. A run's events go only to `rec.session` (the
  starter, or the last resumer): a reconnected phone must `run.resume` to follow a run again.
- **A phone run can't delete a phone mod yet, not even its own twin's**: `trash.js` `checkScope` refuses it
  (`scopeOf('phone~x.com', ['phone~x.com'])` is `phone~phone~x.com`), both for `trif delete` and for a file the
  run deletes in its copy ("this chat can only delete mods of phone~x.com; phone~x.com/old is another
  site's"). It fails closed. This is main's bug ("For Tim" 7, being fixed on a branch from main): once that fix
  is merged here, `run.result`'s `removed` gets real entries; until then `removed` is proven only in
  `resultOf`'s unit test. The stand-in agent has a `DELETE` word ready for it (step 10's end-to-end test).
- The stand-in agent (`tests/phone-link-agent.js`): `standInAgent(prefix)` → `{home, bin, calls, go}`, called
  before runs.js is required (it sets `process.env`); words in the message: `WRITE`, `DELETE`, `PAUSE:<word>`
  (waits for `go('<word>')`), `SLEEP`. Its session id is the `--resume` value, else `sess-remote-1`. In a later
  message of a conversation the context has no `sites/phone~…/`, so `WRITE` there needs the folder in the message.
- The remote test's helpers to copy for step 10: `connect(keys, name)` (pairs a new phone when a name is given,
  else comes back with the keys; sends `hello`), `toDone(phone, runId)`, `ended(runId)`. Test: `node --test
  tests/phone-link-remote.test.js` (1.4 s).
- The stand-in agent names every new conversation `sess-remote-1`, and a run that was stopped after its agent
  started ends with that id too: a test of "this conversation isn't this site's" must use a site no run has
  been on (round 6's first CI run failed on exactly this, on timing that differs from the local one).
- A missing agent program and a logged-out agent come as run events (`error`; `done` with `error.kind:
  'login'`), not as `run.start` errors: for step 14, map them from the events.
- Step 6a's API: `runs.startRemote(own, msg)` → `{runId, site, scope}`, throws with `e.code` `bad-url`,
  `too-big`, `bad-request` (and the plain "already working on phone~x.com" of `Runs.start`). `own`: `{phone: {id
  (16 hex), name}, splits, sessionId, agent, model}`; `msg`: `{url, prompt, page (string), shot (Buffer, JPEG or
  PNG, optional), width}`. `run.remote` = `{phone, width, files: {page, shot}}` once launched.
  `remoteRefusal(run, cmd, args)` → the refusal's text or null; step 7 adds its three commands to
  `REMOTE_COMMANDS` in remoterun.js (name them `remote.page`, `remote.try`, `remote.screenshot`, not `phone.*`,
  which step 8 uses for the panel's commands) and handles them in host.js before the extension fallthrough.
- runs.js is being edited on branch `windows` too (`_serveBox`, Windows argv): this branch's touches are single
  lines (the require, `start(args, own)`, `remote:` in the run object, `startRemote`, two lines in `_launch`,
  the `ctx` line in `_spawn`, one in `_withoutSandbox`, one in `_finish`). Keep new logic in
  `phonelink/remoterun.js`.
- The test file sets `process.env` from `testEnv(home)` before it requires runs.js (the `Runs` is in the test's
  own process; `TRIF_BOX_ROOT`, `TRIF_HOME`, `HOME` are the temp ones). Test: `node --test
  tests/phone-link-run.test.js` (2 s). After touching runs.js, stage.js or agents/index.js also run
  `tests/stage.test.js tests/phone.test.js tests/run-folders.test.js tests/codex-sandbox.test.js
  tests/agents.test.js` (40 s, all stand-ins).
- host.js sends every run's events to the extension (`onAgentEvent`: "panels ignore runs they didn't start").
  For step 6b/8: a remote run's events should go to the phone's session and not to the extension (the phone's
  chat is not the desktop panel's business); the `done` handling there (`syncMods`, `held`) must stay.
- The host-level proof that a remote run's page command never reaches the extension (the fake extension sees
  nothing) can only be written once host.js can start a remote run (step 8): put it in step 10's end-to-end
  test. Until then `remoteRefusal` is proven as a function, and host.js calls it in the token block.
- The context promises `trif phone page|try|screenshot`, which step 7 builds; nothing can start a remote run
  outside a test before step 8, so no real agent reads it meanwhile. Step 7 should add a "Phone runs" part to
  AGENTS.md and name it in `remoteContextText`.
- The agent's stand-in is unsandboxed (as in agents.test.js), so the folder limit is proven at the helper's
  side (the stage: what is copied to the mods folder) and in the limits both adapters are given; the real
  sandboxes with a real agent are `tests/run-sandbox.test.js`'s way (macOS, local only): a remote variant of it
  belongs with step 10.
- Tests: `node --test tests/phone-link-store.test.js tests/phone-link-noise.test.js` (3 seconds). The whole suite
  is `npm test`; the browser tests need `TRIF_BROWSER_TESTS=1` and are CI's job (don't run them locally without
  the lock and the watchdog).
- Tests now: `node --test tests/phone-link-bonjour.test.js tests/phone-link-server.test.js
  tests/phone-link-store.test.js tests/phone-link-noise.test.js` (7 seconds, 61 tests).
- `bonjour.js` API: `new Announcer(store, server, {env, log, platform, retryMs, retryMaxMs, settledMs})` (an
  EventEmitter, `'change'` when `status()` changes); `start()` (returns the announcer), `stop()`, `sync()`,
  `status()` → `{running, error: null | 'unsupported' | 'missing' | 'failing', record: {name, port, id} | null}`.
  Also `recordArgs`, `instanceName`, `pause`. In tests always pass `env: {TRIF_DNS_SD: <stand-in>}` and
  `platform: 'darwin'`: without `TRIF_DNS_SD` it runs the real `/usr/bin/dns-sd`, which announces on the Wi-Fi.
  The stand-in is `makeStandIn(dir)` in the bonjour test (`calls()` → `[{pid, argv}]`, `die(true)` makes the next
  ones exit at once); step 10's end-to-end test needs it too: move it to a shared file then.
- For step 8 (host.js): make the announcer next to the server, `announcer.start()` after `server.start()`, and
  `announcer.stop()` in `shutdown()` before the exit (the `'exit'` hook is the backstop, SIGKILL there). The
  helper's test env must carry `TRIF_DNS_SD` (add it to `testEnv` in tests/fake-extension.js, pointing at a
  stand-in, so that no host test can ever announce for real), and `phone.status` for the panel should include
  `announcer.status().error`. A helper that is SIGKILLed leaves its `dns-sd` behind: an option for step 8 is a
  pid file in `<private>/phone-link/` that the next owner checks (`ps -p <pid> -o command=` must show `dns-sd`
  and `_trif._tcp` before it kills anything); the app-side rule in PHONE-LINK.md section 5 covers it meanwhile.
- For step 12 (the app): several records can carry the computer's `id` (a stale one, or Bonjour's "Name (2)"
  after a clash): match on the `id` in the TXT record, never on the name, and try each until one answers.
- `server.js` API: `new Server(store, {version, log, host, port, hello, firstMessageMs, idleMs, maxConnections})`
  (an EventEmitter: `'session'` (a proven Session), `'listening'` (port), `'stopped'`); `await start()` → the port
  or 0; `await sync()` → the port or 0 (queued behind any change being handled: tests call it after touching the
  store); `await stop()`; `address()`; `handle(type, fn(session, msg) → answer | nothing | a promise)` (the
  answer gets `t: 'ok'` unless it has a `t`, and the request's `id`; a throw becomes `error` with `e.code` or
  `bad-request`); `sessions` (a Set), `stats` (`refused`, `sessions`). `Session`: `phone` `{id, name}`, `key`,
  `hello` (`{app, device}` after the app's `hello`), `send(obj)` → false when closed (throws only "message too
  big"), `close()`, `'close'`. The `hello` option gives the `hello` answer's `agent` and `pending` (step 6).
  Without `host` it binds every interface: always pass `host: '127.0.0.1'` in tests.
- For step 6: push to a phone with `session.send({t: 'run.event', …})`; find a phone's live session by
  `[...server.sessions].find((s) => s.phone.id === id)`; on `'session'`, send what was kept for that phone.
  Removal already closes the session; remote.js deletes the kept results on the store's `'change'`.
- For the iPhone side (step 12): after the handshake's answer the app must send `hello` within 5 seconds, then a
  `ping` every 30 seconds while in front (the computer closes a session that is quiet for 2 minutes); a silent
  close before any answer = "isn't connected any more".
- Test timings: the tests use `firstMessageMs: 500`; the `pair()` helper in the server test sends a ping right
  after the handshake (so its ids start at q2). The stand-in clients treat ECONNRESET as a close.
- `store.js` API: `new Store(home, {env, now, name})` (an EventEmitter, `'change'`); `await setOn(true|false)` →
  `{on, created}`; `await keys()` → `{publicKey, privateKey}` Buffers or null (off, or the keyring's key isn't the
  file's); `status()` → `{on, id, name, port, phones, pairing, listen}` (no secret, no keys: safe for the panel);
  `pairStart()` → `{secret, qr, expires}` (throws while off); `pairStop()`; `pairing()`; `pairTry(phoneKey Buffer,
  secret string, name)` → the phone's row or null; `isPaired(phoneKey Buffer)` → row or null (null while off);
  `seen(id)`; `remove(id)` → `{id, name}` or null; `list()`; `setPort(port)`. Everything but `setOn`/`keys` is
  synchronous and reads the file again each time (two helpers agree); the window is the opening helper's alone.
- Test setup to copy: `setup()` in the store test (temp workspace through `tempDir`, `makeFakeKeychain`, env
  `{TRIF_KEYCHAIN_BIN}`, a clock the test moves; the private folder is `<home>-private`). The stand-in keychain
  takes about 0.2 s per `setOn(true)`.
- The store's expiry timer is unref'd and cleared by `pairStop()`; tests call `store.pairStop()` at the end.
- Writing a file with the Write tool turned `\u2028` escapes into the real characters (a syntax error inside a
  regex): check with `cat -v` after writing such escapes.
- `noise.js` API: `new Handshake({initiator, s: {publicKey, privateKey}, rs, prologue, e})`, `writeMessage`,
  `readMessage`, `split() → {send, receive}`; the responder reads `hs.rs` (the phone's key) after message 1 and
  decides before `writeMessage`: that is where server.js refuses with nothing sent. `keyId(publicKey)` is the
  8-byte id. `frames.js`: `packet`, `PacketReader`, `seal(cipher, obj) → [packets]`, `Assembler(cipher).push(msg)`.
- The published vector is in the noise test file: the Swift side (step 12) should run the same one.
- The computer's name is the Mac's own (`scutil --get ComputerName`, read once when a Store is made without a
  `name`; the host name without `.local` if that fails). Tests pass `name` and never depend on it.
- The sandbox keeps runs away from the Keychain already (agents/codex-oss.js's note: the home folder is denied),
  so a run can't read the computer's key; step 6 should have a test line for the private folder's
  `phone-link.json` and `phone-link/` being unreadable from a run.
- The helper lives only while a browser with TRIF is open (native messaging host); several helpers can run, the
  one owning `helper.sock` should own the link (step 8: read host.js around `listen()` and how `helper.sock`
  changes hands).
- ios-poc's More chat already speaks the desktop panel's `agentEvent`s (`Web/panel-adapter.js` startRun) and has
  the tools the computer will ask for (`PanelChat.swift`: read_page, try_mod, screenshot). The new engine can sit
  in the adapter's `agent.start` beside the API engines.
- macOS's firewall, when the user has it on, may ask "accept incoming connections?" for `node` the first time the
  listener binds. Step 4 should bind only when the link is on, and step 9's strings may need a line about it.
- The clickjacking guard's timing check (`tests/clickjack-browser.test.js`) has now flaked in CI in rounds 2 and
  3, on runs that don't touch it: not this branch's to fix, worth a mention to Tim (main has the same test).
- CI takes about 9 minutes. If it fails on browser tests only (not `phone-link-*`), look at the names with
  `gh run view <id> --log-failed | grep "not ok"` and rerun with `gh run rerun <id> --failed` before digging.
- Commits end with the Co-Authored-By line the loop prompt gives (Tim's rule), by path, never `-a`.

## For Tim (decisions)

1. **"Asleep" and "TRIF isn't running" look the same from the phone** in version 1 (PHONE-LINK.md section 8):
   the helper runs only while a browser with TRIF is open, so in both cases nothing announces or answers. Proposed:
   one state whose text names both ("It may be asleep, on another Wi-Fi, or have no browser with TRIF open").
   Telling them apart needs an always-on background announcer on the computer; not built, not recommended.
2. **The QR carries the computer's whole public key** (32 bytes), not a shorter fingerprint: the key is its own
   fingerprint, and having it lets the phone's first message be encrypted, so the computer can refuse strangers
   without sending a byte.
3. **Agent and model**: a phone run uses the computer's default agent and model in version 1; the phone shows
   which. Choosing from the phone could come later.
4. **Strings**: docs/PHONE-LINK-STRINGS.md, all drafts.

Items 1 to 3 stand as defaults (the main session's brief, round 2) until Tim says otherwise. New in round 2,
small, also a default unless Tim objects:

5. **A lost key drops the listed phones.** If the computer's key is gone from the Keychain (deleted by hand, a
   new Mac restored without it), turning the link on makes a new key, and the phones listed before are removed
   from the list, since they can't reach the new key and must scan a new code anyway.

Item 6 stands as the default (the main session's brief, round 6). Item 7 is fixed on main
(`phone-view-scope`, merged) and merged here in round 13; a phone run's delete is proven end to end (round 18).

New in round 6, small, defaults unless Tim objects:

8. **What is kept on the computer for a phone**: what the agent said in each run and the mods it wrote, in the
   private folder, until the phone has it, 7 days at most, deleted when the phone is removed. Never the page
   copy or the screenshot. A phone is given at most 3 runs at once and 20 kept ones.
9. **Removing a phone stops its run** if one is going (what it already wrote to the phone twin stays, as the
   user's own files).

New in round 8, small, defaults unless Tim objects:

10. **With two browsers open, one of them has the link** (the one whose helper owns `helper.sock`: usually the
    browser opened first). In the other browser's Settings the switch and Remove work, but Connect a phone
    shows a line sending the user to the first browser (strings file, a draft). Making the button work from
    any browser needs the helpers to talk to each other about a pairing secret: not built.
11. **A phone's run ends when the browser that has the link closes**, like a panel's run (the helper lives
    only while its browser is open). What the agent already wrote to the phone twin stays; the phone gets the run
    as ended, with what was written, when it next connects. Another open browser takes the link over
    within a few seconds, for new runs.

New in round 9, small, defaults unless Tim objects:

12. **The Connect a phone button turns the link on** when it was off (also after the user had switched it
    off with phones listed: those phones can reach the computer again from then). The switch appears once the
    link is on or a phone is listed. A **Cancel** button under the code closes the pairing window; closing
    Settings or the panel does too.
13. **New strings in round 9** (docs/PHONE-LINK-STRINGS.md, drafts): the section's line ("Your iPhone asks
    this computer's agent for mods.") and the explanation behind its "i", which replace round 1's two
    sentences under the name; "Cancel"; "{phone} is connected."; the too-long-name line; the code's name for
    a screen reader.

New in round 5 (6 is built as the strict default; 7 is for the main session and Tim, about main's code):

6. **A phone run never goes on without TRIF's sandbox** (new in round 5, built as the strict default). Where a
   company's settings replace the sandbox, the desktop panel lets the user allow that agent anyway; a phone run
   stops instead, even with that consent recorded, with a state on the phone (the strings file has a draft).
   The other way (honor the desktop consent for phone runs) would let a request from the phone run an agent
   outside the fence: not built, Tim's call if wanted.
7. **Three things in the desktop phone view (main's code, not changed here)**, found while proving the folder
   limit; remote runs are protected from each by this branch, the phone view is as it was:
   - the stage copies a phone-view run's files in `all-sites/`, in a new folder, and in the site's desktop
     folder when there is none yet, into the mods folder (`stage.js` `ownFolder`/`newFolders`; the sandboxes make
     existing folders read-only, not ones the run creates). MOBILE-EDIT.md says a phone run can't write
     `sites/x.com/`. Whether such a mod is then held is `held.js`'s (its @match is in the phone scope's pages);
   - `trif delete x.com/<mod>` from a phone-view run passes `trash.js` `checkScope` (`scopeOf('x.com',
     ['phone~x.com'])` is `phone~x.com`), so it can put a desktop mod of its site in the trash;
   - for a sensitive site of its own (mail.google.com), `ownFolder('phone~mail.google.com',
     'phone~mail.google.com', ['mail.google.com'])` is false (`scopeOf` gives `phone~phone~mail.google.com`), so
     its phone twin isn't its own folder (fails closed in the sandbox; the same expression is in `runLimits`).
   Suggested: a separate small fix on main (use `ownTwin` for every phone scope), with Tim's OK.

New in round 11, small, a default unless Tim objects:

14. **A very long computer name is cut in the code** (whole characters, then "…"), only in what the phone
    shows while it pairs; afterwards the phone shows the whole name. The "name is too long" line of round 9
    stays in the panel as a backstop the user shouldn't meet any more; Tim may drop it from the strings.

15. **The iPhone's pairing words (round 15, drafts)**: the "My computer" screen's lines in
    docs/PHONE-LINK-STRINGS.md. One changes words the app already shows: iOS's camera question now reads "To scan
    the code TRIF shows on your computer. Websites you visit can also ask to use the camera, for a photo or a video
    call." (one Info.plist key serves both uses). For now the screen is also in the ⋯ menu as "My computer…" until
    More's engine (step 14) opens it; Tim may want it only in More then. Round 16: only in More now (the brief); the ⋯ item is gone.
16. **What the computer lists a phone as**: the phone sends `UIDevice.current.name`, which on iOS 16+ is just
    "iPhone" (a phone's own name needs Apple's user-assigned-device-name entitlement, granted on request). So two
    iPhones are both "iPhone" in the desktop list. Options: ask Apple for the entitlement, or let the user name the
    phone on the pairing screen. Decided (the main session's brief, round 16): item 17.

New in round 16, the main session's brief (a default):

17. **The person names the phone at pairing**: a field on the My computer screen before pairing, "iPhone"
    prefilled and editable, kept for later pairings (at most 60 characters, "iPhone" if left empty). No
    entitlement asked of Apple. Built on ios-poc (d66642c); strings drafted.

New in round 17:

18. **The removed-last-phone line** (draft, docs/PHONE-LINK-STRINGS.md "Not found"): "Can't find {computer}. It
    may be asleep, on another Wi-Fi, or have no browser with TRIF open. If this iPhone was removed there, pair it
    again: Pair with my computer." A phone removed as the computer's last one can't be told from "not found"
    (with no phone paired the computer stops listening, by design), so one line covers both. Built on ios-poc.
