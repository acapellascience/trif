# Shared core: progress

The loop moving the iPhone app's rules (not its looks) out of Swift into shared JavaScript, so Android runs the same
code. Prompt: ~/WebMods-worktrees/loop-prompts/shared-core-loop-prompt.md. Spec both apps follow:
docs/MOBILE-BEHAVIOUR.md. Branch ios-poc.

## How a rule moves (the pattern set in round 1)

1. Write the Swift's current answers as a cases file beside the module: `mobile/shared/core/<rule>-cases.json`.
2. Make the existing Swift check (mobile/test/<rule>-check/main.swift, built by swiftc from its node test) read the
   cases (argv[1]) and pass them BEFORE touching the Swift.
3. Write `mobile/shared/core/<rule>.js` (CommonJS, pure, no platform calls; file `a-b.js` → `TrifCore.aB`) and
   `mobile/test/core-<rule>.test.js` (the module and gen/core.js in a bare vm context, against the cases).
4. `node mobile/prepare.js` (writes gen/core.js; `--check` is in smoke).
5. Swift calls through `Core.shared.call("module.fn", [args])` (Core.swift; JSON in and out; nil → the safe answer).
   Keep a Swift fast path only for a hot path's common case, and have the check compare it. Add Core.swift and
   argv[2] = gen/core.js to the Swift check; the check measures a call's cost.
6. Simulator: the touched path, headless (devlock first). Then the .ipa.
7. Update IOS-AGENT-NOTES.md's map and the table at the end of docs/MOBILE-BEHAVIOUR.md.

## Checklist

- [x] docs/MOBILE-BEHAVIOUR.md written (round 1)
- [x] Core.swift + mobile/shared/core + gen/core.js (round 1)
- [x] Link policy: AppLinks kind / decide / isTap / logged → core/app-links.js (round 1). Words and Apple app names stay
      Swift (looks); the app's own schemes come from Info.plist (platform) and are passed in.
- [~] Unread count from a title: shared already as mobile/shared/unread-count.js with a Swift twin (UnreadTitle.swift),
      held to the same cases by test/unreadcount.test.js. Left as a twin (it runs on every title change); optional:
      move the file into shared/core so it's in TrifCore too (keep the twin).
- [ ] Chat-offer judge: ChatOfferMemory.normalise/key (FNV-1a 64 + utf8 length), note() bookkeeping, ChatOfferJudge.skip
      order (installed, queued, offered before, earlier version, Recently deleted). Swift unit check exists
      (test/chatoffers.test.js). Storage stays Swift (UserDefaults); the rule takes the entries list.
- [ ] Quick ask: `QuickAsk.lookOnly` (style, no powers, not held, no warnings, not everywhere, every site the chat's)
      and Undo's bookkeeping (version before or removed, not to Recently deleted).
- [ ] Which site a chat's mod runs on (chat's site, phone~ twins, @match) and the cross-site warning's decision; needs
      `Site.of` in JS (two-part suffix list in Mods.swift) — move Site.of with it.
- [ ] Which tabs reload when mods change: signature compare, playing, shown vs behind, Pause all (Browser.refreshIfStale
      / select).
- [ ] Leaving cover's "icon use" decision (LeavingCover.reason: icon tab on its site in full screen, or arrived by an
      icon within 3 s).
- [ ] Video-resume matching (VideoResume.decide, videoID; 30 min, 5 s / 10 s, live, ended, t=/start=). Swift unit check
      exists (test/videoresume.test.js; the page's JS videoId already compared). Move decide + videoID.
- [ ] Dictation accumulator (SpeechText: segments, restarts, revised partials, never shrinking). Swift unit check exists
      (test/speechtext.test.js, random walk). Hot path (every partial result): measure; maybe a twin like unread.
- [ ] Desktop-mode per-site memory (Browser.desktopKey: lower case, no www.; the kept list's add/remove).
- [ ] Which tab the tab list snaps to (ClaudePane.chatTabShown + the from-Mods/from-page cases).

## Done this round

- Round 1 (11-18): docs/MOBILE-BEHAVIOUR.md (all areas, incl. unread counts, popup-to-opener, video resume, voice);
  the core mechanism (mobile/shared/core, prepare.js → gen/core.js, Core.swift, Diagnostics "core" line on a failure);
  the link policy moved (app-links.js + app-links-cases.json; AppLinks.swift calls through; http/https fast path in
  Swift). Tests: core-applinks (node, 2), applinks (Swift through JSC: 47 cases + words; ~13 µs a call on the Mac,
  http(s) 1 µs), unreadcount, speechtext, videoresume, chatoffers, smoke all pass. Simulator (SE, headless): a page's
  own mailto: → asked; again while up → dropped (question up); Cancel; again → dropped (once a load); a real tap on
  tel: → opened (no app: the note). Shots 457-458. .ipa built (dSYM 503B2ECE-EE85-312E-A453-5EF9A063F93C).

## Next step

Round 2: the chat-offer judge (ChatOffers.swift → core/chat-offers.js), by the pattern above. The memory's entries are
data the Swift keeps in UserDefaults; pass them in and take the new list back from `note`. The hash must match the
Swift exactly (FNV-1a 64 over UTF-8: use BigInt or two 32-bit halves in JS; check non-ASCII code in the cases).

## Notes for next round

- `Core.call` args go through JSONSerialization: use NSNull for nil, `[String: Any]` for objects; Bool answers come
  back as NSNumber (`as? Bool` works).
- gen/core.js is committed (as the other gen files); smoke runs `prepare.js --check`.
- The Simulator step helper: write Documents/step.json, `notifyutil -p com.trif.probe.step`, read step-out.txt
  (a 15-line sh in the scratchpad did it). `pagejs` that navigates answers "error: ?" (fine).
- The control tool's `tap` works headless (no panel) on the SE.

## For Tim

- Nothing to decide. No new words. The app behaves as before; links that aren't web pages now decide through the
  shared rule Android will use.
