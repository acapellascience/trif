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
- [x] Unread count from a title → core/unread-count.js (round 12; moved from mobile/shared/unread-count.js, cases now
      core/unread-count-cases.json): TrifCore.unreadCount too. UnreadTitle.swift stays the twin the app runs (every
      title change), held to the same cases and random titles by test/unreadcount.test.js, which also checks gen/core.js.
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
  - [x] Part 2 (round 5): Recently deleted's 30 days (remove, undoDelete, restoreDeleted, the 200 cap), history (30 days, 30
        versions), add's rules (chat on; import / computer off and marked new or updated; edit / computer keep the
        switch; allowed, offSites and added carried over), undoAdd, reject's carry-over (on, offSites, allowed, source,
        added; extraNeeds cleared; the change into History as undo), restore's carry-over. Swift: ModChanges.swift;
        answers are field names (`keep`) and indices (-1 the new entry), so no code text crosses into JS.
  - [x] Part 3 (round 6): what runs: running (Pause all, on, not held without a version kept, tier off on the site,
        per-site switch, @match / @exclude; which runs the version kept), isOn, multiSite, off (the plan's off sites),
        setOn, setGroup → core/mod-store.js; @match → core/match.js (one, any, applies; an address as its parts).
        Swift: ModRuns.swift (setOn / setGroup call through; running, isOn, off, MatchPattern are twins: every page
        load). signature's hashing stays Swift (Hasher, per launch); what it hashes follows running's `kept`.
- [x] Which site a chat's mod runs on and the cross-site warning's decision → core/mod-offer.js (round 7): from (the
      host the mod reader takes, the site it came from: the chat's, phone~ removed, else the shown page's), elsewhere
      (the coral box: every / other sites sorted, also). Swift: ModOfferRules.swift (Browser.offerFromChat,
      ModOfferView.elsewhere; words stay Swift). @match itself was round 6 (core/match.js); trying a mod in More's chat
      (PanelChat.tryMod) uses ModStore.applies, the round-6 twin. Round 8: the Add to TRIF tap (Browser.offer(text:site:))
      takes `from` too (a bug fix: it kept the phone~ prefix, against the spec); mod-offer-cases.json "tap".
- [x] Which tabs reload when mods change → core/tab-reload.js (round 9): shown (start or refresh), loaded (the "pending"
      signature), stale, refresh (later / keep / ask / next), recheck (playing / keep / reload). Swift: TabReloadRules.swift
      (Browser.select / refreshIfStale call through; loaded and stale are twins: every commit). The signature (Hasher,
      per launch), the playing check, the waiting and the reload stay Swift; Pause all's evenPlaying is the caller's.
- [x] Leaving cover's "icon use" decision → core/leaving-cover.js (round 8): reason (icon tab on its site in full
      screen, or arrived by an icon), arrived (within 3 s). Swift: LeavingCoverRules.swift (LeavingCover.reason /
      willEnterForeground call through; `-nocover`, the browser, UserDefaults "iconTabs" and the words stay Swift).
- [x] Video-resume matching → core/video-resume.js (round 10): videoID, asksForTime, samePage, decide (30 min, live,
      ended, same page, own time, first 5 s / last 10 s). Swift: VideoResume.swift calls through (once a page load), an
      address as its parts (VideoResume.parts: URLComponents). The page's script (its own videoId, compared by
      videoresume.test.js), the store (VideoStore, its 30-minute drop), the play and the words stay Swift.
- [x] Dictation accumulator → core/speech-text.js (round 11): apply (one recognizer event: volatile, final, partial,
      segment, newTask) over {said, live, taskSaid, restarts} → {added, …, tail}; words, norm, clean, join, isFresh.
      Swift: SpeechText.swift calls through on every event; `committed` stays Swift and never crosses (committed +=
      added; text = committed + tail), so a call's cost doesn't grow with the talk. The old Swift stays as its copy,
      answering only if the shared rule can't (held to the same cases). SpeechInput's base join is Swift's join (same
      join cases).
- [x] Desktop-mode per-site memory → core/desktop.js (round 9): key, wants, set, can. Swift: DesktopRules (in
      TabReloadRules.swift): set calls through (⋯'s Request Desktop / Mobile Website); key, wants, can are twins.
- [x] Which tab the tab list snaps to → core/tab-list.js (round 12): focus (ClaudePane.chatTabShown: open = chat shown or
      the strip, More → null, the link's tab while open and on its site; a chat with no link yet: the shown tab if on its
      site, else the last tab there), marked (the card drawn as current; a Swift twin: every card, every drawing), badges
      (each card's robot: working > replied > idle, only links whose tab is open and on their site). Swift:
      TabListRules.swift (TabsView asks badges once a drawing, not once a card).
- [x] Go to <site>'s choice → tabList.goTo (round 13): the chat's own tab while open and on its site, else a new tab at
      the page it was on if that page is on the site, else https://site/; a chat not sent from yet: focus's tab choice
      (linkOf, shared with focus). Swift: TabListRules.goTo (ClaudePane.goToSite; ClaudePane.tabFor removed). The new
      tab, the link's bookkeeping, follow and the banner's held mods stay Swift.
- [x] Last spec audit (round 13): every "Tim, 11-xx" decision in IOS-AGENT-NOTES checked against docs/MOBILE-BEHAVIOUR.md;
      added Copy diagnostics and several icons at once. Left as notes on purpose: looks (icon face, robot size, toolbar
      glyphs), iOS mechanics (profiles, Open Settings' URL), and the open idea (desktop mode running desktop mods).

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

- Round 5 (11-18): the mod store, part 2 (changes) moved: core/mod-store.js add, undoAdd, remove, undoDelete,
  restoreDeleted, reject, restore (+ HISTORY_DAYS/MAX, TRASH_DAYS/MAX) and ModChanges.swift; ModStore.add / undoAdd /
  remove / undoDelete / restoreDeleted / reject / restore apply the answers (InstalledMod.take, ModChanges.pick).
  Cases recorded from the old Swift (scratchpad rec/main.swift: the verbatim functions over lite records, Date() fixed):
  342 adds (7 sources × on/newOff × new/unchanged/came-off; 10 Histories incl. 29/30/31/40 entries, ages 30 days ±1 ms,
  out of order; hold shapes held / ran / allowed / a line more), 10 undoAdds (duplicates), 14 removes (199/200/230
  entries, ±1 ms, a future one), 24 undoDeletes, 135 restoreDeleteds, 28 rejects, 56 restores; the JS passed all 609
  at once, then the new Swift through JSC. core-modstore.test.js also runs ModStoreTest.kt's addingAndImporting and
  deletingAndRecentlyDeleted stories. Cost (Mac, unoptimised): an add with 30 versions ~200 µs. Tests: all of
  mobile/test (30 pass, 13 skipped as before) and smoke. Simulator (SE, headless, the Mods tab's own messages): a style
  mod added → v2 (History: chat) → switched off → restore (History: restore, chat; still off) → delete → Undo → back →
  delete → Restore from Recently deleted → back (again: refused, gone from the list), History kept; a boxed keys mod:
  Don't allow while new → deleted; again, Allow, an edit adding other.org → pending (asks match:https://other.org/*,
  History: edit) → Don't allow → the version before, not held, History undo, edit; no "shared rule" line in
  diagnostics. .ipa built (dSYM F1CC45A7-9944-3ACC-B78D-2D061A6636E8).

- Round 6 (11-18): the mod store, part 3 (what runs) moved: core/mod-store.js multiSite, isOn, running, off, setOn,
  setGroup and core/match.js (one, any, applies over an address's parts {scheme, host, path}); ModRuns.swift (setOn /
  setGroup call through; running, isOn, off and MatchPattern, moved from Mods.swift, are twins); InstalledMod.runFacts.
  Cases recorded from the old Swift (scratchpad r6/rec: verbatim functions, then pack.py): 57 patterns × 57 addresses
  (3135 answers incl. case, ports, punycode, IPv6, %7e vs ~, é both ways, regex characters, newline, empty path,
  about:/data:/javascript:, unparsable), 104 isOn × 6 sites, 960 setOn, 432 off × 4 groupsOff, 120 running lists
  (1-8 mods, duplicates, held with and without a kept version, tiers off, paused) × 10 addresses, 96 setGroup; the JS
  passed all at once, then the Swift twins and call-through. A recorder bug (duplicate ids in a list) fixed before use.
  Cost (Mac, unoptimised): running 40 mods twin ~125 µs (the URL is now parsed once, not per mod), shared ~450 µs; a
  switch's call ~30 µs. Tests: all of mobile/test (34 pass, 13 skipped as before), prepare --check, smoke. Simulator
  (SE, headless, serve.js, the Mods tab's own messages; a style mod for localhost and 127.0.0.1, outline read in the
  page): runs on localhost → off on localhost (stored offSites [localhost], still on) → gone there, still on 127.0.0.1
  → on again → the style tier off on localhost → gone there, still on 127.0.0.1 → tier on → the whole switch off → gone
  on both → on → back; no "core" line in diagnostics. .ipa built (dSYM 7241AF10-D0E0-383F-A9B5-14B63BE9CCEE).

- Round 7 (11-18): a chat's offered mod moved: core/mod-offer.js (from, elsewhere) and ModOfferRules.swift
  (Browser.offerFromChat's here / came; ModOfferView's coral box decides through it, its words unchanged). Cases
  recorded from the old Swift (scratchpad r7/rec: the verbatim code + Site.swift): 133 from (19 chat sites incl. "",
  phone~, phone~phone~, Phone~ and PHONE~ (not twins), ports, spaces × 7 shown hosts) and 161 elsewhere (7 came-froms
  incl. nil/"" × 23 site sets: duplicates, case, www., all-sites in the list or the folder, IPs, punycode, two-part
  suffixes, x.com.evil.org); the JS passed them at once, then the Swift through JSC. Sorting is code point order, as
  Swift's sorted() (checked: an astral character after U+FFFD). Cost (Mac, unoptimised): an offer's two calls ~50 µs.
  Tests: all of mobile/test (39 pass, 13 skipped as before), prepare --check, smoke. Simulator (SE, headless,
  offerchat on a localhost page): phone~m.example.com, no @match → runs on m.example.com, came from example.com, no
  box; phone~example.com + other.org → other.org, "another site"; example.com + b.org + a.net → "other sites ... also
  runs on a.net, b.org"; *://*/* → "every site"; no chat site → localhost, no box; no "shared rule" line in
  diagnostics (shots 459-463). .ipa built (dSYM D5039D09-0258-34D7-86C5-D8184EE6301B).

- Round 8 (11-18): the leaving cover's "icon use" moved (core/leaving-cover.js: reason, arrived; LeavingCoverRules.swift,
  called by LeavingCover.reason / willEnterForeground). Cases recorded from the old Swift (scratchpad r8/rec: the
  verbatim rule + Site.swift): 560 reasons (10 hosts incl. case, www., m., two-part suffixes, IPs, "", phone~ × 10
  iconTabs sets incl. none, another tab's id, "" and www. keys × full screen × arrived) and 11 arrived (-5 s to
  distantPast, 3 s ± 1 µs); the JS passed them at once, then the Swift through JSC. Cost (Mac, unoptimised): leaving
  and back ~33 µs. Bug fix (Tim's rule, not a new decision): the Add to TRIF tap (Browser.offer(text:site:)) now takes
  ModOfferRules.from, so phone~<site> is <site> there too (mod-offer-cases.json "tap": 6, and core-modoffer.test.js
  checks the tap's Swift calls it). Tests: all of mobile/test (43 pass, 13 skipped as before), prepare --check.
  Simulator (SE, headless, serve.js): the tap with phone~m.example.com → sites m.example.com, came example.com;
  phone~example.com + other.org → came example.com; x.com → x.com; none → localhost. Cover: an icon link (simctl
  openurl trif://open) → full screen on localhost's icon tab → left: covered (icon tab) → back by the icon: cover off
  after 53 ms; full screen off → left: covered (came by an icon) → back by the app → left: the real picture kept; no
  "shared rule" line in diagnostics. .ipa built (dSYM 380648BC-59FB-3DA9-A12D-79ABAC4EFFBB).

- Round 9 (11-18): which tabs load again when the mods change (core/tab-reload.js: shown, loaded, stale, refresh,
  recheck) and desktop websites' per-site memory (core/desktop.js: key, wants, set, can); both in TabReloadRules.swift
  (DesktopRules beside it). Cases recorded from the old Swift (scratchpad r9/rec.swift: the verbatim guards over facts):
  4 shown, 8 loaded, 15 stale, 480 refresh, 240 recheck; 18 keys (case, www., www, wwwx, www.www., Ü/É, IPv6, ""), 90
  wants, 180 sets, 22 cans; the JS passed them at once, then the Swift through JSC (twins compared with the JS). Cost
  (Mac, unoptimised): refresh + recheck ~29 µs, a request ~20 µs. Tests: all of mobile/test (46 pass, 13 skipped as
  before), prepare --check, smoke. Simulator (SE, headless, serve.js + serve-media.js): a mod for 127.0.0.1 added with
  localhost shown → localhost not loaded again, 127.0.0.1 marked stale → shown: loaded again (outline); localhost
  shown again unchanged → not loaded again; a mod for the shown site → loaded again; Pause all → loaded again without
  (outline 0), resumed → with; a video playing (unmuted, a silent track) and a mod added → "playing, so not loaded
  again now", stale; paused, shown again → loaded again; Request Desktop Website → sites [localhost], the tab desktop
  (Mac agent); Mobile → [] ; no "shared rule" line in diagnostics. .ipa built (dSYM 4551F1E9-7562-327D-9B9C-79900B473811).

- Round 10 (11-18): video resume's matching rules moved (core/video-resume.js: videoID, asksForTime, samePage, decide;
  VideoResume.swift calls through with an address as its parts, VideoResume.parts). Cases recorded from the old Swift
  (scratchpad r10: the verbatim file + a recorder): 115 addresses (YouTube hosts, case, ports, user:pw, v= empty /
  doubled / +, é both ways, /shorts|embed|live|v, youtu.be, Vimeo's last number incl. ١٢, ½, １, 1+mark, a '/' or '#'
  with a mark after it, t= / start= / time_continue= / %74= / #t=, raw non-ASCII) with their parts, 2261 page pairs,
  2478 decisions (times 0-700, durations -1-600, live, ended, ages -5 s to 1801 s and 30 min ±1 ms); the old Swift
  passed them through the new check, then the JS at once, then the new Swift (its parts compared too). Cost (Mac,
  unoptimised): a load's decide ~62 µs (once a page load). Tests: all of mobile/test (48 pass, 13 skipped as before),
  prepare --check, smoke. Simulator (SE, headless, serve-media.js on 8392, muted): playing at 0:42 → reload resumed
  playing (0:43); paused 0:31 → paused 0:31; paused at 0:02.5 → not resumed ("in its first 5 s"); 1:25 of 1:30 → not
  ("in its last 10 s"); another address → not ("another page or video"); back to ?v=a → resumed at 0:41; no "shared
  rule" line in diagnostics. .ipa built (dSYM E7C83E32-0828-3E27-A482-7CD200D9D51C).

- Round 11 (11-18): the microphone's words moved (core/speech-text.js; SpeechText.swift calls apply once per recognizer
  event). Cases recorded from the old Swift (scratchpad r11/m: verbatim, taskSaid readable; seeded): 167 event runs
  (the check's stories; 120 recognizer-like: growing, revised, restarted fresh or with the same first words, segments
  repeated as they were, with punctuation, a word or two changed, upper-cased, NFD; 40 random walks) with every
  state, 381 cleans, 81 norms, 324 joins, 500 isFresh, over odd words (marks, NFD, Σ / ς, İ, ß, ﬁ, Ǆ, Han, Arabic
  digits, emoji with modifiers, flags, ZWJ, ZWSP, BOM mid-word, Thai AM, a Prepend sign) and separators (tab, CR LF,
  NBSP, ideographic space, LS, NEL, a space with a mark after it, U+180E). The old Swift passed all 4373 (unoptimised),
  then the JS after two fixes (Foundation's trim also takes U+200B; a mark after a control is its own Character),
  then the new Swift through JSC and its copy. Cost (Mac, -O, warm): a partial of 10 / 60 live words 40 / 123 µs
  through the shared rule (Swift copy 22 / 116 µs), the same after 13 KB committed (sending `committed` cost +100 µs
  there, so it no longer crosses); node --jitless's JS part 9 / 43 µs. Tests: all of mobile/test (52 pass, 12
  skipped), prepare --check, smoke. Simulator (SE, headless, `-speechfile` r11/talk.wav: "Make the header blue." 4 s
  of silence "And make it bigger please."; speech permission allowed by a headless tap on the alert):
  SFSpeechRecognizer (-oldspeech): "Make the header blue" → after the pause "Make the header blue And make it bigger,
  please" (partial 10, segment 2), kept on; ✕ → in the box; a second listen → after the box's words (95 characters);
  SpeechAnalyzer + DictationTranscriber: the same words (volatile 10), ✕ keeps them; no "shared rule" line in
  diagnostics. .ipa built (dSYM 53F68BF4-47EF-32DA-9D58-AE748B7226A8).

- Round 12 (11-18): the tab list's rules moved (core/tab-list.js: focus, marked, badges, activity; TabListRules.swift;
  ClaudePane.chatTabShown / badges() and TabsView call it). Cases recorded from the old Swift (scratchpad r12/g, the
  old code verbatim in shape over Site.swift): 450 focus (120 a tab), 220 marked, 220 badges (113 with any); the pure
  Swift passed them before the switch. Cost on the Mac (unoptimised): a tap's focus + a drawing's badges over 20 tabs,
  6 chats ~180 µs; no chats: badges makes no call. Unread count moved into shared/core (TrifCore.unreadCount; twin
  kept). Tests: core-tablist (3), tablist (Swift through JSC), unreadcount (+ gen check), all core-* pass. Simulator
  (SE, headless): from the page on 127.0.0.1 / localhost → that tab; from the chat → its tab; from Mods → the shown
  tab; More's chat → the shown tab; no "shared rule" line in diagnostics. .ipa built (dSYM
  33188806-1468-3E24-A54D-CC74F1D28B16).

- Round 13 (11-18): Go to <site>'s choice moved (core/tab-list.js goTo, linkOf now shared by focus and goTo;
  TabListRules.goTo; ClaudePane.goToSite calls it, tabFor gone). Cases recorded from the old Swift (scratchpad r13/m:
  the old goToSite / fallbackLink / tabFor over Site.swift, 9631 runs packed to 744 distinct: 74 no site, 86 its tab, 48
  its page, 536 the site's home) over 9 sites (incl. "", IPs, ü and punycode, localhost), 12 hosts, 24 addresses
  (case, ports, user:pw, a space (Foundation encodes it), "not a url", "", no scheme, about:, javascript:, a trailing
  dot, IPv6, another site with ours in its query) and tab ids present / gone / none; the JS passed them at once, then
  the Swift through JSC (the page's parts compared too). Cost (Mac, unoptimised): a Go to ~73 µs (once a tap). Tests:
  all of mobile/test (58 pass, 13 skipped), prepare --check, smoke. Simulator (SE, headless, serve.js, three chat
  links seeded through `defaults write … chatLinks`): from the plain page, Go to 127.0.0.1 → its tab (2); a link whose
  tab is on another site → a new tab at http://127.0.0.1:8377/agent?r13, the link now on it; example.com with no tab and
  a page on evil.org → a new tab at https://example.com/; Diagnostics "go to …" lines as before, no "shared rule" line.
  Spec audit (above). .ipa built (dSYM 9F78F478-50FC-3B68-88B2-E43D4F546762).

## Next step

Core complete for the listed candidates. If more is wanted later (none asked): which tab a Home Screen icon lands on
(its site's own tab, off-site → a new own tab, a blank one takes the address) and the background tabs' let-go timing
(20 s, playing kept) are pure decisions still in Swift; Android may want them shared once it has icons.

## Notes for next round

- Round 13: a link's tabURL crosses as URL(string:)'s parts {url: absoluteString, host} (Foundation now encodes a
  space, so absoluteString can differ from the stored string; the new tab opens absoluteString, as before). Chat links
  can be seeded with the app stopped: `simctl spawn <dev> defaults write com.timsrobot.trifprobe.browser chatLinks
  -data <hex of JSON [{service, site, tab, tabTitle, tabURL, state, at (s since 2001)}]>`; tab ids from Application
  Support/tabs.json. Driver: scratchpad r13/step.sh ({"links":1}, {"select":0}, {"gosite":n}).

- Round 12: tab ids cross as uuidString (upper case); a chat's site on the SE's localhost pages is "" (Site.of has no
  dot to cut), so the Simulator's chat follows the shown tab; links with real sites need a sent chat, so the cases carry
  the link paths. Android: shared/unread-count.js is now shared/core/unread-count.js (its cases
  core/unread-count-cases.json); origin/android doesn't reference the old path from Kotlin. Driver: scratchpad
  r12/drive.py ({"sheet": "tabs"}, {"tabsfocus": 1}, {"sheet": "none"}, {"tabbadges": 1}).

- Round 11: a rule over growing text can keep the growing part on the platform side: speechText.apply takes `said`
  (anything committed) and answers `added` (append it) and `tail` (text = committed + tail); the JS test rebuilds
  committed the same way. Foundation's trimmingCharacters(in: .whitespacesAndNewlines) is White_Space plus U+200B
  (checked over every scalar); Swift's Characters: a mark after a control (tab, LF, NEL, ZWSP, BOM) is its own,
  Thai / Lao AM join (SpacingMark), a Prepend sign joins what follows unless it's a control. Simulator speech:
  `simctl privacy grant speech-recognition` fails and the grant attempt quits the app; tap the alert's Allow headless
  (iOS Simulator tool, SE at (261, 506) points) after `{"mictap":1}`, then tap again. Steps: mictap, micstate, micx
  (keeps in the box), micdraft "" (clears it).

- Round 10: an address crosses as URLComponents' parts {host, path (decoded), query [[name, value|null]], fragment}
  (null: unparsable; Foundation now parses "not a url" as a path). The old Swift compared Characters and canonically:
  video-resume.js does too (NFC compare; a '/' or '#' with a mark after it doesn't split; a number part is \p{N} per
  grapheme start); Han numerals differ, as in site.js. Recorder: scratchpad r10/m/main.swift over r10/old.swift
  (verbatim), pack in the round's python. Simulator driver: r10/drive.py (serve-media.js on 8390, muted plays,
  `{"reload": why}`, `{"videos": 1}`, report.json's "video" lines).

- Round 9: the reload drivers are scratchpad r9/drive.py (tabs by index: the SE has pages, localhost, 127.0.0.1; a
  page marker `window.__r9` tells a reload; `{"modsstale": 1}`, `{"pause": true}`, `{"desktop": true}` /
  `{"desktopstate": 1}`) and r9/play.py (serve-media.js 8390 + a copy of a.mp4 with a silent audio track made by
  ffmpeg anullsrc, deleted after: Browser.playing ignores muted media, and sound must not reach Tim's speakers). A
  paused test video can come back playing after a tab switch (another feature's resume): check `paused` before
  reading a reload.

- Round 8: the cover's driver is scratchpad r8/drive.py (`{"offer": text, "site": …}` is the Add to TRIF tap now;
  `{"cover": 1}`; an icon return is `simctl openurl <dev> trif://open?url=http://localhost:8377/`, away is `simctl
  launch <dev> com.apple.Preferences`). The SE remembers localhost as an icon tab from earlier rounds.

- Round 7: ModOfferView is SwiftUI, so its decision moved into ModOfferRules.swift (no UI) first; the recorder ran the
  verbatim code. The offerFromChat Diagnostics line now names the chat's site as given (phone~x.com, not x.com):
  agent-only text. Simulator driver: scratchpad r7/drive.py (offerchat with a site, then `{"links":1}`'s offer line
  "runs on … came from …", and `simctl io screenshot` for the box).

- Round 6: an address crosses into JS as its parts (MatchPattern.parts: lower-case scheme and host, percent-encoded
  path or "/", ?query), since a bare JSContext has no URL parser; Android passes its own Uri's. signature stays Swift
  (Hasher is seeded per launch; compared only within a launch). Simulator driver: scratchpad r6/drive.py (serve.js on
  8377; `{"go"}` then `{"pagejs": "return getComputedStyle(document.body).outlineWidth"}`; enable / group messages).

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

- Round 5: the change rules' answers are indices and field names, so History's code never crosses into JS (an add
  sends times only). `changed` (the code differs) stays Swift on purpose: Swift's String == is canonical (é precomposed
  == decomposed), JS's and Kotlin's literal; Android passes its own compare. History / trash ages in the cases sit 1 ms
  either side of 30 days: exactly 30 days is float noise in Swift's Date. Simulator drivers: scratchpad r5/drive.py
  (style mod: add, History, restore, delete, Undo, Restore) and r5/hold.py (boxed keys mod: Don't allow, Allow, an edit
  that waits); they read the stored mod file (Application Support/mods/<id with __>.json), as the Mods tab's state
  lists only the shown site's mods. Reoffering the same code is skipped by the chat-offer memory: vary it.

## For Tim

- Round 13: Go to {site} (from a chat, its banner or the chats' list) now picks its tab through the shared rules
  Android will use; it behaves as before. The behaviour spec got its last check against the notes (two small rules
  written down: Copy diagnostics, several icons at once). A new TRIF.ipa is in iCloud Drive/TRIF.

- Round 12: which card the tab list opens at (the tab you just left; from a chat, the chat's own tab) and each card's
  robot badge now decide through the shared rules Android will use; they behave as before. The unread-count rule sits
  with the other shared rules now. A new TRIF.ipa is in iCloud Drive/TRIF.

- Round 11: the microphone's words (what was said before a pause stays, a recognizer starting over or repeating
  itself never loses or doubles words) now come from the shared rules Android will use; they behave as before. A new
  TRIF.ipa is in iCloud Drive/TRIF.

- Round 10: a video picking up where it was after its page loads again now decides through the shared rules (which
  load resumes, the YouTube / Vimeo video ids); it behaves as before. A new TRIF.ipa is in iCloud Drive/TRIF.

- Round 9: which tabs load again when a mod changes (never another site's, never one playing; tabs behind when next
  shown; Pause all even while playing) and Request Desktop Website's per-site memory now decide through the shared
  rules; they behave as before. A new TRIF.ipa is in iCloud Drive/TRIF.

- Round 8: the Add to TRIF button in a chat from your computer's phone view now treats phone~<site> as <site>, as the
  spec says (it kept "phone~<site>" before); a bug fix, no new decision. The leaving cover (the robot as the app
  leaves in icon use) now decides through the shared rules; it behaves as before. A new TRIF.ipa is in iCloud Drive/TRIF.

- Round 7: where a chat's mod is read and the coral "runs on another site / every site" box now decide through the
  shared rules; they behave as before. A new TRIF.ipa is in iCloud Drive/TRIF.

- Nothing to decide, no new words. Since round 6 the mod switches (a mod's, its per-site switch, a tier's per site)
  and which mods run on a page (Pause all, @match) also follow the shared rules; they behave as before. What a mod waits for, what Allow allows, and what an edit or a restore asks about now
  decide through the shared rules Android will use; since round 5 also adding (on or off, marked new or updated),
  History (30 days, 30 versions), Recently deleted (30 days), Undo, Restore and Don't allow. They behave as before. A
  new TRIF.ipa is in iCloud Drive/TRIF.
- One odd corner, kept as it was (a refactor changes nothing): if a change is waiting for your OK and you restore an
  older version that also needs an OK, the mod stops running until you decide (an edit in the same spot keeps the
  last approved version running). Say if you'd like a restore to keep it running too.
