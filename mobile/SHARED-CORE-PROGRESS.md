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
- [x] Quick ask → core/quick-ask.js (round 3): lookOnly (style, no powers, not held, no warnings, not everywhere,
      every site the chat's), sort (look ids, card ids, the pill's state), undo (steps newest first, back or removed,
      declined; only from Done). Swift: QuickAskRules.swift (ClaudePane.quickDeliver / quickUndo call it). Site.of moved
      too: core/site.js (of, hostIsIn, chat = phone~ removed then of), Site.swift kept as a twin (every navigation),
      held to site-cases.json. The mod list's own Undo (ModStore.undoAdd: not to Recently deleted) moves with the store.
- [~] The mod store's rules (Tim, 11-18: Android ported them to Kotlin by hand, branch android,
      mobile/android/app/src/main/java/com/timsrobot/trif/ModStore.kt + ModStoreTest.kt; the Android loop switches to
      the shared copy once it exists) → core/mod-store.js (TrifCore.modStore), pure functions over plain mod records,
      the lists and files staying platform. Three parts:
  - [x] Part 1 (round 4): holds and Allow: waiting / held (Swift twin: every page load), allow, approve, changeNeeds,
        seeded, ranAfter (add / restore: which version runs while a change waits). Swift: ModHolds.swift (ModNeed moved
        there too).
  - [ ] Part 2: Recently deleted's 30 days (remove, undoDelete, restoreDeleted, the 200 cap), history (30 days, 30
        versions), add's rules (chat on; import / computer off and marked new or updated; edit / computer keep the
        switch; allowed, offSites and added carried over), undoAdd, reject's carry-over (on, offSites, allowed, source,
        added; extraNeeds cleared; the change into History as undo). Likely `add(old|null, new, source, now)` →
        the record's new fields, `trash(list, entry, now)` etc.; the code reading (ModReader) stays platform.
  - [ ] Part 3: @match (applies: MatchPattern, hot: every page load × every mod, a twin), running (on, not held without
        a version kept, tier switch, per-site switch), signature, tier switches (groupsOff, isOn), Pause all, multiSite.
- [ ] Which site a chat's mod runs on (chat's site, phone~ twins, @match) and the cross-site warning's decision
      (core/site.js exists now: TrifCore.site.of / hostIsIn / chat).
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

- Round 3 (11-18): quick ask's rules moved (core/quick-ask.js: lookOnly, sort, undo; QuickAskRules.swift calls them
  from ClaudePane.quickDeliver / quickUndo) and Site.of as core/site.js (of, hostIsIn, chat) with Site.swift (moved
  out of Mods.swift, unchanged) as its twin. Cases recorded from the old Swift: 63 hosts (www., case, two-part
  suffixes, empty labels, IPs and other scripts' digits, ports), 10 host-in-site, 10 chat sites (phone~), 76
  look-only, 48 sorts (incl. duplicate ids), 20 undos; the Swift passed them before the move. prepare.js: core modules
  may require each other. Cost: a sort ~50 µs on the Mac (unoptimised; once a reply). Tests: core-quickask (2),
  quickask (Swift twin + call-through), the other core tests, all of mobile/test (25) pass. Simulator (SE, headless,
  More's stand-in): quick ask → Done, a new mod added; Undo → removed; again → added; again (an update) → Done; Undo →
  back to its version before; no "shared rule" failure. Not tried there: the card path (the stand-in writes style
  mods only; unit cases cover it). .ipa built (dSYM 8B1867CD-BD28-3D03-9265-636ACACE4700).

- Round 4 (11-18): the mod store, part 1 (holds and Allow) moved: core/mod-store.js (waiting, held, allow, approve,
  changeNeeds, seeded, ranAfter) and ModHolds.swift (ModNeed moved from Mods.swift; ModStore.allow / changeNeeds /
  seeded are wrappers; add / restore / approve call through; InstalledMod.waiting is the Swift twin). Cases recorded
  from the old Swift (scratchpad recorder over the verbatim functions, Site.swift): 96 mods (waiting, approve, seeded,
  ranAfter add / restore each), 77 allows, 191 changeNeeds (13 @match sets incl. <all_urls>, *://*/*, file:, no scheme,
  ports, WWW, *.bbc.co.uk, x.com.evil.org, *.*.x.com; 7 home sites incl. all-sites, "" and www.), 10 more ranAfters;
  the JS passed them all at once, then the new Swift (through JSC) did. core-modstore.test.js also runs Android's
  ModStoreTest.kt stories (holdsWaitForAllow, editsAndRestores) on the pure functions. Cost (Mac, unoptimised): an
  edit's seeded + changeNeeds 170 µs; the twin's held for 40 mods 85 µs. Tests: all of mobile/test (29) and smoke
  pass. Simulator (SE, headless, via the Mods tab page's own messages): a boxed mod with keys offered and added →
  held (power:keys); Allow → runs; an edit adding https://other.org/* → pending, asks only match:https://other.org/*;
  Allow; restore the first version → not held; an edit to a free mod → pending, asks only tier:free; Don't allow →
  the boxed version back, not held, History 4; no "shared rule" line in diagnostics. .ipa built (dSYM
  6D3FE2EE-5C61-35F4-8483-1E1F3923E968).

## Next step

Round 5: the mod store, part 2 (Recently deleted, history, add's rules, undoAdd, reject's carry-over) → more functions
in core/mod-store.js, cases recorded from Mods.swift (ModStore.add / remove / undoDelete / restoreDeleted / undoAdd /
reject) and checked against ModStoreTest.kt (addingAndImporting, deletingAndRecentlyDeleted). Dates: pass `now` in (ms)
so the rules stay pure; the 30 days and the caps go in the module.

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

- core/site.js and Swift differ on purpose in one place: three-part hosts of Han numerals (一.二.三), which Swift's
  Character.isNumber counts and JS's \p{N} doesn't (left out of the cases; hosts arrive as punycode).
- Simulator quick ask: `{"more":true}`, `{"sheet":"chat"}`, paneljs on `#input`: value "/model stand-in" + an Enter
  keydown, `{"closechat":1}`, then `{"quick":"…"}`, `{"quickstate":1}`, `{"quickundo":1}`; copydiag + pbpaste.
- The mod store item: Android's ModStore.kt (git show origin/android:mobile/android/app/src/main/java/com/timsrobot/
  trif/ModStore.kt) has the same function names (allow, changeNeeds, seeded, undoAdd, remove, restoreDeleted, saveEdit).

- Round 4: the mod store's records go to JS as {tier, site, matches, needs, extraNeeds, allowed, ran (Bool)}:
  InstalledMod.holdFacts / ModHolds.Facts.plain. Line hashes are hex (ASCII), so JS's sort and Swift's sorted() agree;
  keep them ASCII. A quirk kept as it was (no change in behaviour): a restore while a change is waiting, of a version
  that itself waits, keeps nothing running (ranAfter 'restore' → null when the version before was held); add keeps
  the one it was already keeping. Android's ModStore.kt has the same. Flagged to Tim below.
- Simulator, mod store: the Mods tab page's own messages through `{"modsjs": "return JSON.stringify(await
  window.webkit.messageHandlers.app.postMessage({type:'save'|'approve'|'reject'|'restore'|'history'|'state', id, …}))"}`
  (sheet "mods" first); a boxed mod needs a power that isn't soft (keys) to be held. Helper: scratchpad ms/st.sh <id>.

## For Tim

- Nothing to decide, no new words. What a mod waits for, what Allow allows, and what an edit or a restore asks about now
  decide through the shared rules Android will use; they behave as before. A new TRIF.ipa is in iCloud Drive/TRIF.
- One odd corner, kept as it was (a refactor changes nothing): if a change is waiting for your OK and you restore an
  older version that also needs an OK, the mod stops running until you decide (an edit in the same spot keeps the
  last approved version running). Say if you'd like a restore to keep it running too.
