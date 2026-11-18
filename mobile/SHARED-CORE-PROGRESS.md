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
- [x] Chat-offer judge → core/chat-offers.js (round 2): normalise, key (FNV-1a 64, 16-bit limbs), outcome, note
      (entries in, new list out), skip (takes keys). Storage stays Swift (UserDefaults), plus a key cache (NSString)
      warmed off the main thread at launch.
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

- Round 1 (11-18): docs/MOBILE-BEHAVIOUR.md; the core mechanism (Core.swift, prepare.js → gen/core.js); the link
  policy (app-links.js). .ipa dSYM 503B2ECE-EE85-312E-A453-5EF9A063F93C.
- Round 2 (11-18): the chat-offer judge moved (chat-offers.js + chat-offers-cases.json: 35 codes incl. CRLF/CR, NBSP,
  tabs, combining marks, CJK, emoji, ZWNBSP, NUL, U+10FFFF; 6 note sequences; the 500 limit; 23 judge cases, all
  recorded from the old Swift, which passed them before the move). ChatOffers.swift calls through; skip takes keys and
  Swift caches each code's key, warmed at launch (Browser.init → ChatOfferMemory.warm, detached, 16 a call). Cost on the
  Mac (unoptimised check, 40 mods × 11 versions of 3 KB, 500 remembered): old Swift 113 ms a hand-over; now warm 2.5 ms,
  warming 0.35 s once off the main thread (16-code batch 10 ms), note 2.7 ms. Tests: core-chatoffers (node, 2),
  chatoffers (Swift through JSC), core-applinks, applinks, chat, smoke pass. Simulator (SE, headless, `chatOffers`
  cleared): offerchat → offered; Cancel → dismissed; the same code with CRLF/trailing spaces → skipped (offered before
  (dismissed)); another → offered, added; again → skipped (installed as it is); relaunch → both still skipped; no
  "shared rule" line in diagnostics. .ipa built (dSYM 5D8CAAC5-CF9A-3A2B-AB67-8029334B4B85).

## Next step

Round 3: quick ask's auto-apply decision (`QuickAsk.lookOnly`) and Undo's bookkeeping → core/quick-ask.js, by the
pattern above. Then the chat's-site rule with Site.of.

## Notes for next round

- `Core.call` args go through JSONSerialization: use NSNull for nil, `[String: Any]` for objects; Bool answers come
  back as NSNumber (`as? Bool` works). A null answer arrives as NSNull (`case is NSNull`).
- Swift String equality and Set/Dictionary keys are canonical (é precomposed == decomposed): never key a cache of
  byte-exact rules by String; NSString compares literally. NSString bridging also drops a leading U+FEFF read from
  JSON (JSONSerialization): keep cases' BOMs mid-string.
- Recording the Swift's answers: a throwaway generator (scratchpad co/g/main.swift: the old Swift + inputs → JSON) is
  quicker than hand-writing them.
- The phone's JSContext has no JIT: hashing big inputs in JS costs ~0.2 µs a byte (node --jitless estimates it);
  cache or warm off the main thread.
- gen/core.js is committed; smoke runs `prepare.js --check`. Simulator helper: scratchpad step.sh (writes step.json,
  notifyutil, reads step-out.txt); `offerchat`/`cancelOffer`/`addOffer`/`copydiag` + `simctl pbpaste` for this path.

## For Tim

- Nothing to decide. No new words. The app behaves as before; links that aren't web pages (round 1) and what a chat
  may offer (round 2) now decide through the shared rules Android will use. A new TRIF.ipa is in iCloud Drive/TRIF.
