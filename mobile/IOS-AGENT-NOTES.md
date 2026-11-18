# iPhone app (TrifProbe): notes for the next agent

Branch `ios-poc`, worktree `~/WebMods-worktrees/ios-poc`. The app is `mobile/browser-probe` (Xcode project
`TrifProbe.xcodeproj`, bundle `com.timsrobot.trifprobe.browser`, display name "TRIF" since 11-18 (Tim: "I'm getting
tired of seeing Probe"; it was "TRIF Probe"). The bundle identifier stays as it is, so the install on Tim's phone updates
in place with its tabs, mods and sign-ins: never change it. Internal names (target, folders, types) stay TrifProbe. mobile/README.md has the
long descriptions; docs/IOS-APP-STRINGS.md every word people see. This file is the short version.

## Standing rules

- Commit by path (`git commit -- <paths>`), never `-a`; end messages with the Co-Authored-By line. Push `ios-poc` only:
  never merge to main, tag, release or deploy. Never run wrangler or deploy timsrobot.com (branch `clip-page` holds the
  /clip page; Tim OKs every site deploy).
- Simulator only, headless, muted. Never install or launch anything on Tim's iPhone. His diagnostics are read only, and
  only with his OK (the coordinator pulls them).
- Every word people see goes in docs/IOS-APP-STRINGS.md for Tim (old → new). Agent-facing text (prompts, CLI, logs) is ours.
  Existing extension wording carries over unchanged. Don't name other coding agents in what people see.
- Never touch ~/.trif, Tim's browsers or TRIF's Application Support folder on the Mac. Never log cookie values or API keys.
- Page text and model replies are untrusted; "Add this mod?" is the consent step: nothing is installed without it.
- No private routes or tokens of claude.ai / chatgpt.com: TRIF reads only what their pages show.
- Each step ends with the .ipa built and copied (below) and its dSYM UUID reported. Screenshots go to
  `mobile/browser-probe/shots/` (not committed), numbered on from the last (458 now): `NNN-se-what.png`.
- Leave RobotShape / the robot outline alone: another agent has Tim's shape options.

## Build and test

- Simulator: iPhone SE (3rd gen) `531D07B3-0AE6-4010-B14F-B79E9DF95CBE`. Build:
  `xcodebuild -project TrifProbe.xcodeproj -scheme TrifProbe -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath <dd> build CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGN_ENTITLEMENTS=<sim.entitlements>`
  (the entitlements file, application-identifier + keychain-access-groups `SIMTEST.com.timsrobot.trifprobe.browser`, only
  so the Keychain works there: unsigned it answers -34018). Then `simctl install`, and launch with flags (below).
- Driving it: the app reads `Documents/step.json` when it gets the Darwin notification `com.trif.probe.step`
  (`xcrun simctl spawn <dev> notifyutil -p com.trif.probe.step`) and writes `Documents/step-out.txt`. Steps (TrifProbeApp
  `Model.step`): go, newtab, select, sheet ("chat" opens the robot view), chat, closechat, newchat, chats, showchat,
  service ("Claude"/"ChatGPT"), more (true/false), panejs (JS in the shown chat page), paneljs (JS in More's panel),
  panego, offer/cancelOffer/addOffer, offerchat ([code…], site, path: as a chat hands mods over: what was offered),
  offerstate (the offer shown, the queue), copydiag (⋯ → Copy diagnostics), status, fullscreen, resethint, memwarn, bars, tabhosts, openurl, toolbar, approve,
  view (site, full screen, covers), iconcheck ("https://…/": a Home Screen icon from 15 in-app states, PASS/FAIL lines (since 11-17 also: its tab gone to
  another site, in front or not, and its tab blank; PASS needs the icon's site shown);
  regression check for the icon → full screen rule; cold launch / background still by `simctl openurl` + `view`),
  playcheck ("http://…": a page with a <video>/<audio>; ~75 s of PASS/FAIL: a playing background tab is kept past
  20 s and a memory warning, let go once paused; a same-page quiet tab is let go), iconprofile ({"outline", "swatch" 0-5, "badge", "name", "noise"}: the shown
  page's Home Screen icon and profile to Documents/icon-test.png and .mobileconfig; "noise" = a worst-case photo),
  iconqueue (the same options: the shown page's icon onto the list waiting), phonelink (PhoneLink.swift's self-test in iOS's CryptoKit: "phone link self-test: ok"),
  phonepair (1: the pairing's state; "trif://pair?…": pair with that code; "forget"), phonedrop (More's link to the
  computer lost as a suspended app loses it: it reconnects after 2 s, or at once when the app is back in front), iconbatch (the list's profile to
  Documents/icon-batch.mobileconfig), iconqueuelist, iconqueueclear, hit ([x, y]: the view UIKit's hit test finds),
  exitbutton (where full screen's exit button and its taps are), desktop (true/false: ⋯ → Request Desktop / Mobile
  Website on the shown page), desktopstate (the sites kept, each tab's mode, "(Mac agent)" where the web view has it),
  links (the chat links, newest first, the banners, the shown tab and offer: "runs on … came from …"), gosite n /
  openlink n (link n's Go to <site> / its chat), banner ("add", "go", "open", "dismiss": the banner shown's button),
  tabbadges (each tab's robot badge), sheet "chatlist" (the robot's long-press list), tabshots (each tab's picture
  file, size, sensitive or not, drawn; the folder's files and orphans; pictures read from disk since launch),
  privatepage (["https://…"]: pictured or why not), cover (the leaving cover's rule now, up or down, its last steps
  with ms since the app came to the front; "show": up for 6 s, for a screenshot),
  applink (the other-app question up now, and the note), quick ("words": a quick ask as the box sends it), quickstate, quickundo, quickopen (the pill tapped), quickcancel
  (the strip's ✕), quickexpand; speech (permissions, on-device or not, which recognizers this device has), speechfile
  ("/path.wav": SFSpeechURLRecognitionRequest on a recorded file), micpress / micrelease (the box's hold), mictap /
  micstop (its tap and the stop tap), micx (the ✕), miccancel (a slide away), micinterrupt (an audio interruption
  beginning, as a call's), micdraft ("words": the box's words), micstate (phase, listener, recognizer events, the
  transcript, the box, how many times words were asked and the last), robothold (1 / 0 / "away": the robot held, let
  go, let go slid away, through ContentView's own robotHold/robotLift); modsstale (each tab: whether the mods running
  on its page changed since it loaded); tabsfocus (the card the tab list last opened at, and the shown tab),
  playing (each tab: WebKit's state,
  the page's, kept or not; the audio session), tabjs + tab (JS in tab n's page, shown or not), reload ("why": the shown
  tab loaded again by the app, logged with that cause), videos (each tab's video state as kept, and the note shown),
  rebuild ({"n": 5, "on": true}: every mod on first, then n real changes (one mod switched off/on) in a row: each call's
  main-thread ms, when all were in, the last rebuild's parts and the hangs meanwhile; an odd n leaves the first mod off), hashtest ("/path", "old": the
  reading before 11-18: LocalModels.sha256 at .utility with the app's footprint sampled every 0.1 s), unread (each
  tab's count from its title, icon tab or not, the card's title, the icon total, the badge set, the permission),
  unreadanswer (true/false: TRIF's words before iOS's question answered Continue / Not now)…
  Real touches: the iOS Simulator tool (tap, swipe, touch2_path for the two-finger hold). Screenshots: `simctl io <dev> screenshot`.
- Logs: `Library/Application Support/report.json` (kinds: claude, panel, mods, icon, fullscreen…) and `diagnostics.json`
  (kinds: hang, local model, chats, chat, chat files, memory…) in the app's data container.
- Stand-in chat (where Claude/ChatGPT can't be signed in): `node mobile/serve.js` (8377), launch with
  `-chathome http://localhost:8377/chat.html` (`?greet`: an empty-state heading and an Upgrade plan button, for TRIF's
  greeting and upsell hiding). A saved project (`chatProject.Claude` in the app's prefs plist) sends the chat to
  /project/… instead and drops the query: delete it with PlistBuddy (`Delete :chatProject.Claude`) while the app is stopped. Message words steer it: "two", "no mod", "file", "file and block", "powers" (a boxed
  mod with the click power: its card, never added by itself), "called <Name>" (the style mod's name: a new mod, not
  an update of Calmer feed), "ask <words>" (those words in its CSS as a comment: code of its own, so ChatOffers
  doesn't skip it as offered before; "powers" puts the message's words in a comment too),
  "viewer", "wait N", "no match" (the mod has no @match line, as desktop's folder mods: FeedBook). The mod's
  @match is the first http(s) origin in the attached files + the text: TRIF's own fill names the tab's page first, so a
  URL typed in the message doesn't win (use the `offerchat` step for a mod matching another site). Query flags: `?history` (a long conversation's older messages rendering late: an older
  exchange with an earlier Calmer feed put at the top 1.5 s after load and 2 s after each reply), `?reopen` (the
  chat reopens a viewer on an old file by itself, no tap), `?gpt` (/c/ addresses), `?slow`, `?nostop`, `?draft`, `?gptpaste`, `?viewerroute`,
  `?octane` (ChatGPT's newer mobile page: li[data-message-role], data-message-complete, a 3 s pause, picture-only
  inputs), `?cm` (code as .cm-editor/.cm-line), `?slowload`, `?late` (the page settles in pieces as claude.ai's does on a
  phone: the box's tool row at 1 s, a "… can make mistakes." line above it at 1.6 s, more room under it at 2.2 s, each
  attachment a placeholder first and its tile 0.5 s later: the quick ask's strip measured against it), `?pasted` (a paste of several lines goes into the box as a
  pre inside the ProseMirror, 20+ lines as a PASTED tile with a preview pre; the sent message keeps both, the pasted card
  opening the viewer), `?oldchat` (an old conversation loading in pieces into a .history box: the last reply's box filled
  in twice, the reply before it, the person's messages 2 s late; `window.__standinScrollUp()` or a scroll to the top
  draws an older exchange and redraws the rest). The header's "Older chat" button switches the page to such a
  conversation (pushState /chat/old-…, no load), mid-reply or not. `/project/<id>` serves it as a project page, `/new`
  as claude.ai's new-chat page.
- What the browser says it is: serve.js's `/agent` (`?nometa`: no width=device-width viewport): the user agent sent,
  navigator's, platform, width; `window.__agent` for pagejs. localhost vs 127.0.0.1 are two sites.
- Logged-out chatgpt.com works in the Simulator (reject non-essential cookies on its banner) and is the best check of
  ChatGPT's markup; claude.ai needs a sign-in, so it's stand-in only.
- Mock APIs (More's engines): `node mobile/mock-api.js 8379` (`MOCK_MODEL_MS=125` for 2 MB/s model downloads), launch with
  `-apibase http://localhost:8379` and paste the key `sk-test-not-a-real-key`. Message words: "loop" (15-step cap),
  "slow" (try Stop), "no tools". It refuses a turn that lost Claude's thinking block or OpenAI's reasoning item.
  `/models/<file>` serves 40 MB with ranges (its checksum never matches: tests the refusal); `-modelbase http://localhost:8379`.
- llama.cpp: `mobile/browser-probe/fetch-llama.sh` (b12428, SHA-256 checked, into `Vendor/`, gitignored; a device build
  needs it). Mac harness: `mobile/local-model/harness.sh <model.gguf> <wikipedia|hn|guardian|testfeed> <styleJSON|file> "<request>" [runs]`
  (env TRIF_GPU, TRIF_THREADS, TRIF_BATCH, TRIF_CTX). Models are 1.3–2.7 GB: download to the scratchpad, delete after
  (the Mac's disk is at 97%).
- The .ipa: `xcodebuild … -configuration Release -sdk iphoneos -derivedDataPath <ddev> CODE_SIGNING_ALLOWED=NO DEBUG_INFORMATION_FORMAT=dwarf-with-dsym build`,
  zip `Payload/TrifProbe.app` to `~/Downloads/TRIF.ipa`, copy `TrifProbe.app.dSYM` to `~/Downloads/TRIF.app.dSYM`, copy the
  .ipa to `~/Library/Mobile Documents/com~apple~CloudDocs/TRIF/TRIF.ipa` (named TrifProbe.ipa before 11-18; that one went
  to the Trash), report `dwarfdump --uuid`. Tim sideloads it with iloader.
- The mod reader on the Mac: `node --test mobile/test/modfile.test.js` (gen/mods.js in node's vm: a free mod's style
  section, its trif.log lines and start to the app, capped; boxed and style mods). Real WebKit without the Simulator:
  mobile/test/webkit-check (swiftc; an offscreen WKWebView with the scripts as ModStore.userScripts puts them, on
  serve.js's strict.html and plain.html: what applied in each world, what reached the handler, a snapshot).
- Generated files: `node mobile/prepare.js` (and `--check`, run by mobile/test/smoke.js): sandbox-runtime.js,
  browser-checks.json, mods.js, panel-kit.js, mod-guide.txt, page-bridge.js, RobotShape.swift, and the side panel folder
  `shared/gen/panel`. Never edit those by hand.
- Browser tests (headless Chrome, muted): `TRIF_BROWSER_TESTS=1 TRIF_E2E_CHROME="/Users/tim/WebMods/tests/e2e/.browsers/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node --test mobile/test/chat.test.js`
  (10 tests: fill, send, watch, pickup, viewers, ChatGPT's new page, old code rendering late, the person's own pasted
  code, an old conversation: pieces, reload/resume, /new → /chat/<id>, switched mid-reply; the quick ask: never a
  scripted send, the person's Send told once, their message appearing as the send, takeText). One browser suite at a time; small payloads.
- Links to other apps on the Mac: `node --test mobile/test/core-applinks.test.js` (the shared rule, mobile/shared/core/app-links.js,
  and gen/core.js, against app-links-cases.json) and `node --test mobile/test/applinks.test.js` (swiftc: AppLinks.swift +
  Core.swift + mobile/test/applinks-check/main.swift, calling through gen/core.js: the same cases, the words, and the cost
  of a call: ~13 µs on the Mac). Simulator pages for it: any small node server with tel:/mailto:/sms:/maps:/
  fb-messenger: links, a target=_blank one, a trif: one, `location = 'mailto:…'` on load and every 1.5 s, an
  `a.click()` on load, an iframe to fb:// (the batch's own lived in the scratchpad).
- The microphone's words (SpeechText.swift: segments, restarts, revised partials; committed words never shrink, a
  random walk of 2000 × 40 events) on the Mac: `node --test mobile/test/speechtext.test.js` (swiftc with
  mobile/test/speechtext-check/main.swift; ~3 s).
- Video resume's rules (VideoResume.swift) on the Mac: `node --test mobile/test/videoresume.test.js` (swiftc with
  mobile/test/videoresume-check/main.swift; the page's JS videoId compared with the Swift one in node; ~2 s).
- Unread counts' title rule on the Mac: `node --test mobile/test/unreadcount.test.js` (mobile/shared/unread-count.js
  against mobile/shared/unread-cases.json, then UnreadTitle.swift built by swiftc with mobile/test/unreadcount-check
  giving the same answers on the cases and 3000 random titles; ~2 s). Stand-in page: mobile/shared/pages/unread.html
  (`?n=4`, `window.__count(n | "whole title")`, `?cycle=s`); serve.js on 8377 and 8378 (127.0.0.1:8378 = another tab
  on the same host). An icon tab: `simctl openurl 'trif://open?url=http%3A%2F%2Flocalhost%3A8377%2Funread.html%3Fn%3D1&app=1'`.
  Notification permission: `simctl privacy` has no notifications; uninstall resets it, the question is tapped.
- What a chat may offer (ChatOffers.swift → core/chat-offers.js) on the Mac: `node --test mobile/test/chatoffers.test.js`
  (swiftc with mobile/test/chatoffers-check/main.swift, Core.swift, argv chat-offers-cases.json + gen/core.js; ~20 s;
  prints the judge's cost) and `mobile/test/core-chatoffers.test.js` (the JS alone).
- Sites and quick ask's rules (Site.swift twin, QuickAskRules.swift → core/site.js, core/quick-ask.js) on the Mac:
  `node --test mobile/test/quickask.test.js` (swiftc with mobile/test/quickask-check/main.swift, Site.swift,
  QuickAskRules.swift, Core.swift; argv site-cases.json, quick-ask-cases.json, gen/core.js; `TRIF_COST=1` prints a
  sort's cost, ~50 µs unoptimised) and `mobile/test/core-quickask.test.js` (the JS alone).
- The mod store's hold and change rules (ModHolds.swift, ModChanges.swift → core/mod-store.js) on the Mac: `node --test
  mobile/test/modstore.test.js` (swiftc with mobile/test/modstore-check/main.swift, Site.swift, ModHolds.swift,
  ModChanges.swift, Core.swift; argv mod-store-cases.json, gen/core.js; `TRIF_COST=1` prints an edit's two calls, ~190 µs
  unoptimised, 40 holds by the twin, ~85 µs, and an add with 30 versions in History, ~200 µs) and
  `mobile/test/core-modstore.test.js` (the JS alone, and Android's ModStoreTest.kt stories).
- What runs (ModRuns.swift → core/mod-store.js part 3, core/match.js) on the Mac: `node --test mobile/test/modruns.test.js`
  (swiftc with mobile/test/modruns-check/main.swift, Site.swift, ModHolds.swift, ModRuns.swift, Core.swift; argv
  mod-runs-cases.json, gen/core.js; prints running for 40 mods by the twin ~125 µs and the shared rule ~450 µs
  unoptimised, a switch's call ~30 µs) and `mobile/test/core-modruns.test.js` (the JS alone, and ModStoreTest.kt's
  matchPatterns and switchesTiersAndPause).
- A chat's offered mod (ModOfferRules.swift → core/mod-offer.js) on the Mac: `node --test mobile/test/modoffer.test.js`
  (swiftc with mobile/test/modoffer-check/main.swift, Site.swift, ModOfferRules.swift, Core.swift; argv
  mod-offer-cases.json, gen/core.js; an offer's two calls ~50 µs unoptimised) and `mobile/test/core-modoffer.test.js`.
- The leaving cover's icon use (LeavingCoverRules.swift → core/leaving-cover.js) on the Mac: `node --test
  mobile/test/leavingcover.test.js` (swiftc with leavingcover-check/main.swift, LeavingCoverRules.swift, Core.swift;
  argv leaving-cover-cases.json, gen/core.js; leaving and back ~33 µs unoptimised) and `core-leavingcover.test.js`.
- Media checks: a range-serving static server is needed (WebKit asks for media in ranges; `python -m http.server`
  won't do). Make a silent clip with ffmpeg (`testsrc` + `anullsrc`, so nothing reaches the Mac's speakers: the
  Simulator plays to them) and serve it with a few lines of node; play by `pagejs` (`await v.play()` works: the app's
  JS counts as a gesture). App to the background: `simctl launch <dev> com.apple.Preferences`; back: `simctl launch`
  the app; lock: the iOS Simulator tool's LOCK button (HOME wakes / unlocks). Steps still answer in the background
  while something plays.
- Dev launch flags: `-speechfile <wav>` (a recording stands in for the microphone in every hold or tap of it: played in
  0.1 s pieces at the pace of speech, then silence for as long as listening goes on; `-speechrate N` N times as fast;
  make them with `say -v Samantha -o x.wav --data-format=LEI16@16000 "…"` and ffmpeg's anullsrc for silences, never the
  live microphone), `-oldspeech` (SFSpeechRecognizer even where iOS 26's SpeechAnalyzer is there), `-speechsession` (the real audio session switch with `-speechfile`), `-chathome <url>`, `-apibase <loopback>`, `-modelbase <loopback>`, `-memorygb 4` (a 4 GB phone's
  choices), `-clipbase <url>`, `-noserver`, `-noopen` (Home Screen hand-off), `-exitrobot`, `-hang100` (log 100 ms hangs),
  `-nobarshift`, `-stripmax <pt>` (the most of their box's text the strip shows, 112), `-stripheight <pt>` (the strip when no message box is found, 264), `-pageletter`, `-tabsfirst` (tabs before Mods, as tried on 11-17), `-nocover` (no leaving cover, as before 11-18, to compare), `-resumemuted` (a resumed video
  is played muted, as when iOS refuses its sound: the "Tap for sound" note), `-exitbelow` (the exit button's old
  spot), `-exity <pt>`, `-noaudiosession` (iOS's default session), `-nobgresume` (leave WebKit's pause), `-publicflush` (the public cookie flush), `-bare` (no scripts in pages), `-go <url>`,
  `-open <url>`, `-import <path>`, `-autorun …`, `-shottest …`, `-linkhost 127.0.0.1:<port>` (the phone link pairs there,
  not over Bonjour: a helper's store.js + server.js on loopback in a temp HOME; `simctl openurl` the code's text).

## Map

- TrifProbeApp.swift: the app's views (toolbar, bars, sheets, the ⋯ menu at the address bar's left (moreMenu), full
  screen note and exit button), `Model`, dev steps, BarState.
- Browser.swift: tabs' web views, navigation, mod offers (Add this mod?; offerFromChat with ChatOffers.swift's judge
  and memory), old hide rules (applied, Show again from the Mods tab), outline and chat context
  (pageForChat, feedbackForChat), screenshots, full screen state, ModDownloads (.js downloads to Add this mod?), the
  long-press menu (`contextMenuConfigurationFor`: the system's `suggested` items + Open in New Tab → `openInNewTab`;
  `LinkPreview`, a link's page preview; `willCommitWithAnimator`: the preview tapped opens it in the tab),
  desktop websites (`desktopHosts`, `requestDesktop`, `decidePolicyFor … preferences:` sets `.desktop` and the web
  view's `customUserAgent` = `desktopAgent` per main-frame load, `Tab.desktop` = the mode it loaded in, `checkAgent`
  after each commit).
- Chat links (ClaudePane.swift, Tim 11-18: from a chat back to its tab): `ChatLink` (service, site, the tab sent from
  by Tab.id + its title and address, the conversation, state working/waiting/read/added; UserDefaults `chatLinks`,
  newest first, 20; working → read at launch). `sentLink` at each send (a chat shown for another site than the tab's
  keeps its tab), `remember` follows the conversation, `seen` (shown → read), `modAdded` (Browser.addMod →
  modAddedFrom). `banners` ([ChatBanner], the first shown; ChatBannerView over everything in ContentView.page; a plain
  one goes after 8 s, one with mods stays: they're its offer, ✕ = dismissed). `goToSite(key)`: its tab if open and on
  its site, else a new tab at the page it was on (else https://site/); then the banner's held mods come up.
  `openChat(key)`: the site's chat shown at its conversation, nothing filled. `badge(for: tab)` (TabCard). The
  robot's tap → ChatListView (Go to chat first; `site` the shown tab's); its hold → hold to talk (ContentView
  robotPress/robotHold/robotLift, HoldTalkPill in QuickAsk.swift) or ChatListView when talking isn't ready.
- Shared rules (11-18, the shared-core loop: mobile/SHARED-CORE-PROGRESS.md; spec docs/MOBILE-BEHAVIOUR.md):
  mobile/shared/core/*.js → `node mobile/prepare.js` → mobile/shared/gen/core.js (global `TrifCore`, a bundle resource;
  Android takes gen/ too). Core.swift: `Core.shared.call("module.fn", args)` (one JSContext made at the first call, a
  lock, JSON in and out through `TrifCore.call`; nil = the rule didn't answer: the caller's safe answer, Diagnostics
  "core" once). Moved so far: AppLinks' kind/decide/isTap/logged; ChatOffers' judge; quick ask's look-only, sort and
  Undo steps (QuickAskRules.swift); the mod store's holds and Allow (ModHolds.swift), its changes (ModChanges.swift) and what runs (ModRuns.swift: the switches through it; running / isOn / off / MatchPattern twins). A chat's offered mod: where it's read and came from, and the coral "runs on another site" box's decision (ModOfferRules.swift); the leaving cover's "icon use" (LeavingCoverRules.swift). core/site.js is Site.of in JS (Site.swift stays a Swift twin: every navigation);
  core modules may `require('./other.js')` (prepare.js bundles them with a small require).
- AppLinks.swift (Tim, 11-18; no UI in its top half, built for the Mac too): `AppLinks.kind` (web / stay (about, blob,
  data, trifprobe) / never (javascript, file) / own (trif, trifpanel, Info.plist's schemes) / other; http/https answered
  in Swift, the rest by TrifCore.appLinks), `decide` (tapped → open; else ask once a load, one at a time, main frame,
  shown, app in front; else drop), `isTap` (both shared), `appName` (Apple's apps only), the words (Swift). `TouchClock` + `TouchWatch` (a do-nothing recognizer on every tab's, chat's and More's web
  view: when the finger was last on a page) and the long-press menu's open/close. Browser: `appLink(...)` (open /
  question by UIAlertController on the top controller / Diagnostics "app link" lines with the scheme only, a drop's line
  once a load), `askedLoads` cleared by each commit (`appLinkNewLoad`, the pane's didCommit too), `handToIOS`
  (UIApplication.open; false → the note). Called from decidePolicy (after mod links and the two-finger guard),
  createWebViewWith (no tab), Open in New Tab, the preview's commit, ClaudePane's decidePolicy/createWebViewWith,
  PanelChat's (taps only, never asks). The note shows over the chat too (ContentView.page's bottom overlay).
- QuickAsk.swift (Tim, 11-18): `QuickAsk` (request, service, site, key, state waitingSend/working/done/replied/card/
  undone/failed, `applied` for Undo; `lookOnly` → QuickAskRules, `InstalledMod.quickFacts`), `QuickAskBox` (the box at the top of ChatListView; its text is
  `SpeechInput.draft`, so it outlives the sheet), `HeardText` (every word heard, scrolling past a height, the newest
  in view), `HoldTalkPill`, `KeptTalkSlot`/`KeptTalkPill` (a robot hold stopped by something else: the words, a tap
  opens the list), `QuickPill` (above the toolbar, in ContentView.notes; `preparing`: "Putting it in {Service}…" while
  the strip's chat fills), `QuickStripHeader`, `QuickStrip` (header 34, pad, maxPart, minBody, noBoxBody), `QuickSend` +
  `QuickSendButton` (the box's arrow and the list's Send: one action). ClaudePane: `quick`, `strip` (on from the ask;
  its didSet → `stripEnded`), `stripIn` (slid in, once settled), `stripBody`/`stripShift` (the page's part shown, and how
  far the page is moved down so that part's foot is the strip's foot), `settleStrip` (after the fill: chat.js
  `stripWatch(true)` + its own `stripBox()` every 60 ms; in when unchanged 0.3 s and loaded (or 3 s), at most 8 s),
  `stripMeasured` (each "stripbox" message: `place` converts document coordinates to the web view's points with the
  scroll view's convert; once in, `pin` moves the page with no animation), `slideIn`, `keyboardNotTheirs`,
  `chatHasFocus`, `quickAsk` (Claude/
  ChatGPT: showFor + prepare/fillContext + the request as text + chat.js `armSend`; More: `quickMore` →
  PanelChat.quickSend), `quickDeliver` (offerFromChat(hold: true), look-only → Browser.addMod(quiet:), the rest
  offerHeld or the done banner), `quickUndo` (ModStore.undoAdd: the version before, or removed; not to Recently
  deleted), `cancelStrip` (chat.js `takeText`), `expandStrip`, `quickOpen`. handleDone's quick branch; "sent" moves
  waitingSend → working. ContentView: `ChatLayer` (the chat laid out full size; in strip mode moved by `shift` and clipped to header +
  `part`, sliding: `stripLayer`/`stripUp`, driven by `pane.stripIn`), `ChatWebView.stripBand` (touches outside the
  strip's band go to the tab; the page now reaches below the strip too). chat.js `stripBox` (what shows of the box
  inside its own scrolling ∪ the SEND button, document coordinates, plus chars, tiles, the box's height, readyState)
  and `stripWatch(on)` (MutationObserver + ResizeObserver + scroll/resize/visualViewport, once a frame, only changes,
  and every 250 ms: posts "stripbox"). PanelChat:
  `quickSend` (TRIF's own panel: #input, #composer.requestSubmit(); waits for #site.title == the tab's address;
  `quickPending` marks the next run; refused if startRun never takes it), `Run.quick`, `offerRun` → `quickDone`.
- SpeechInput.swift (Tim, 11-18, "Don't have the microphone stop listening at any point"): `SpeechInput.shared`
  (phase, `transcript` = the box's words it started from + SpeechText, `draft` the box's text, `stoppedNote`,
  `keptFromHold`, `tapMode`, `fromRobot`, `getting` (a model download)); `press(robot:)`, `keepListening` (tap mode),
  `release` (the person's stop: endAudio, `.ended` or 2.5 s, then asked), `cancel` (slide away: this listen's words
  dropped), `keep` (the ✕: kept, not asked), `interrupt(why:)` (willResignActive, didEnterBackground, AVAudioSession
  interruption / media reset, the list's onDisappear, a lost microphone, a broken recognizer: kept, not asked, the
  note). `choose(download:)`: iOS 26 SpeechAnalyzer with SpeechTranscriber (`isAvailable`) else DictationTranscriber
  (`.progressiveLongDictation`), each only when AssetInventory says installed; a missing model is fetched at the first
  press (`assetInstallationRequest`, the box's note with %) and SFSpeechRecognizer used meanwhile. Listeners:
  `AnalyzerListener` (an AsyncStream of AnalyzerInput, AVAudioConverter to bestAvailableAudioFormat; results ending by
  themselves → a new analyzer), `RecognizerListener` (requiresOnDeviceRecognition; metadata → segment; a task ending
  by itself (final, an error, no speech) → a new task at once on the same audio; only 10 tasks in a row ending within
  0.5 s of starting stop it). Sources: `MicSource` (AVAudioEngine tap, re-tapped on a configuration change),
  `FileSource` (`-speechfile`). SpeechText.swift (no UI; built for the Mac too): the accumulator.
- ChatOffers.swift (no UI; built for the Mac too): storage and the call-through. The rules are
  mobile/shared/core/chat-offers.js (TrifCore.chatOffers, round 2 of the shared core): normalise, key (FNV-1a 64 in
  16-bit limbs, no BigInt), outcome, note (entries in, the new list out; null = unchanged), skip (takes keys, not code).
  `ChatOfferMemory` keeps the entries (UserDefaults `chatOffers`, last 500, global; `at` crosses as seconds since 1970)
  and a key cache by NSString (Swift's String equality is canonical: "café" == "cafe\u{301}", their keys differ),
  warmed off the main thread at launch for every installed and deleted version (`warm`, 16 a call) so a hand-over
  hashes only new code (warm judge ~2.5 ms on the Mac; the first, cold, 0.35 s in the 440-version worst case).
  `ChatOfferJudge.skip`: installed as it is, queued, offered before, an installed mod's History, Recently deleted; if
  the rule doesn't answer, not offered. Diagnostics kind `chat offers`: one line per hand-over (path
  auto/late/viewer/panel/computer, ids offered and skipped with why) and declined/dismissed.
- Tabs.swift: Tab, tab pictures (TabShots, PrivatePages), TabsView/TabCard. History.swift: history. Import.swift: importing mod files. FolderWatch.swift: the watched
  iCloud folder and `trif://add` links. WebClip.swift: Home Screen icons (the sheet's look and name: IconLook,
  WebClipMaker.compose; profile hand-off; IconHandoffSteps, the steps shared with the list), `trif://open`.
  IconQueue.swift: the list of icons waiting (QueuedIcon, IconQueue, the batch profile, IconQueueView).
- QuickAskRules.swift: quick ask's rules through the shared core (TrifCore.quickAsk): lookOnly, sort (look ids, card
  ids, the pill's state; no answer → all to their cards), undo (steps newest first; no answer → still undone).
  ClaudePane.quickDeliver / quickUndo use it. Site.swift: `Site.of` / `Site.host(_:isIn:)` (moved out of Mods.swift
  in round 3), the twin of core/site.js.
- ModHolds.swift (round 4 of the shared core): ModNeed, and the hold rules through TrifCore.modStore: allow, approve,
  changeNeeds, seeded, ranAfter (add / restore: which version runs while a change waits); `waiting` stays a Swift twin
  (InstalledMod.held is asked of every mod on every page load). No answer: allowed unchanged, every @match asked,
  only what was allowed, nothing kept running (each asks more, never less). ModStore.allow / changeNeeds / seeded are
  one-line wrappers over it; InstalledMod.holdFacts is what it reads.
- ModChanges.swift (round 5 of the shared core): the mod store's change rules through TrifCore.modStore: add (keep,
  on / newOff, History indices, the version kept, ran), undoAdd, remove (Undo, Recently deleted's 30 days / 200),
  undoDelete, restoreDeleted, reject and restore's carry-over. ModStore (Mods.swift) keeps the records and applies the
  answers: `ModChanges.pick` (indices, -1 the new entry) and `InstalledMod.take` (the field names in `keep`). The code
  compare (`changed`) stays Swift: Swift's String == is canonical, JS's literal. No answer: nothing is lost (History and
  Recently deleted kept whole), a new add is off and marked, Undo / Restore / Don't allow do nothing.
- ModOfferRules.swift (round 7 of the shared core): `from(chatSite:shown:)` (Browser.offerFromChat: the host the mod
  reader takes and the site it came from; no answer: the shown page's) and `elsewhere(cameFrom:folder:sites:)`
  (ModOfferView's coral box: every / others sorted + also; no answer: the every-site box) through TrifCore.modOffer. The
  words stay in ModOfferView. Browser.offer(text:site:) (the Add to TRIF tap) takes `from` too since round 8 (before,
  it kept a phone~ twin as the site, against the spec): mod-offer-cases.json "tap"; core-modoffer.test.js also checks
  the tap's Swift calls it. Dev step `{"offer": text, "site": "phone~x.com"}` is that tap; offerstate shows `came`.
- LeavingCoverRules.swift (round 8 of the shared core): `reason(fullScreen:host:tab:iconTabs:arrivedByIcon:)` (.iconTab
  site / .arrived / nil; no answer: nil, the real picture) and `arrived(since:)` (< 3 s; no answer: the same here)
  through TrifCore.leavingCover. LeavingCover.reason / willEnterForeground call them; `-nocover`, the browser and
  UserDefaults "iconTabs" stay Swift, and so do the words (agent-only: Diagnostics "cover", {"cover": 1}).
- ModRuns.swift (round 6 of the shared core): what runs. setOn / setGroup through TrifCore.modStore (a tap; no answer:
  the switch doesn't move); running, isOn, off (the sites a mod's script checks it's off on) and MatchPattern (moved
  from Mods.swift; `parts` is the platform's URL parsing the shared rule reads: lower-case scheme and host,
  percent-encoded path + ?query) stay Swift twins, held to mod-runs-cases.json (every page load × every mod).
  InstalledMod.runFacts is what it reads; ModStore.running / isOn / applies / setOn / setGroup / scriptPlan use it.
  Twin quirks kept: Swift's `firstIndex(of: "/")` and `contains("*")` read Characters (a "/" followed by a combining
  mark isn't a "/"), JS UTF-16 units; hosts arrive as punycode, so String's canonical == makes no difference there.
- Mods.swift: ModStore (installed mods, holds, user scripts), ModReader (mods.js in JavaScriptCore). A free mod
  (modfile.js readMod): its code in the page's world behind `__trifFree.start` (a Diagnostics "mod log" line, once
  a load) and, with a style section, its own `trif.style` (as desktop's wrapModCode); the section's CSS is
  `styleScript`, a style element put by TRIF's world at the page's start (style-mirror.js there for strict pages;
  desktop: lib.js styleSectionCode). Not kept: made again with `script` at launch; a held change's `ran` keeps its
  own `style`. Where a free mod may run: `freePageScript` (page world: desktop's window.trif.log/warn/error, expect a
  no-op) tells TRIF's world's `freeRelayScript` by a CustomEvent with a JSON string, which caps (40 a load, 200
  characters) and posts "modlog" → Browser → Diagnostics "mod log" (start, log, warn, error: the wrapper's catch). ModsPanel.swift + Web/mods.html,
  mods-page.js/css: the Mods tab.
- ClaudePane.swift: the robot view: ChatService, up to 3 ChatViews (Claude/ChatGPT pages), fills, reply watching,
  conversations' sites, projects, notifications, the switch Claude · ChatGPT · More. Web/chat.js: TRIF inside those pages
  (fill, send, done-detection, pickup, Add to TRIF, viewers, and `look`: the greeting, the pills' words, upsells hidden;
  ChatView.tellLook passes the site and RobotShape's polygons on each load).
- PanelChat.swift: More, the desktop side panel in a web view (trifpanel://), runs and tools. Web/panel-adapter.js: the
  panel's chrome.* and background stand-in, API keys and model blocks. Web/panel-phone.css: what the phone hides.
  PanelEngines.swift: Keychain keys, Anthropic / OpenAI Responses / OpenRouter streaming, the Simulator stand-in.
- LocalLlama.swift (llama.cpp wrapper), LocalPrompt.swift (guide, grammars, JSON → mod, repairs), LocalModels.swift
  (catalogue, downloads, LocalRunner, LocalConversation). mobile/local-model/: README, local-guide.txt, the research.
- Safety.swift: safe mode, AppDelegate (shortcut, notifications, background downloads' events). Diagnostics.swift:
  diagnostics log, hang watchdog (`Diagnostics.hangs`), cookie keeper. Report.swift: report.json. Pages.swift: test pages
  scheme. Checks.swift, OnDevice.swift: the probe's old checks.
- PhoneLink.swift: the phone link's wire (More's "My computer" engine; design: docs/PHONE-LINK.md and the progress file on
  branch phone-link, whose loop owns this file): Noise IK in CryptoKit (`NoiseInitiator`, `NoiseCipher`, `selfTest()`
  with the published vector), frames (`PacketReader`, `Assembler`, `PhoneLink.seal`), `PhoneLinkBrowser` (NWBrowser on
  `_trif._tcp`, TXT `id`), `PhoneLinkSession` (one connection; `End`: unreachable, refused, dropped, broken, closed).
  PhoneLinkPair.swift (no UI; built for the Mac too): `PairCode.parse` (the `trif://pair` code), `PhoneLinkKeys`
  (Keychain service "TRIF phone link", accounts `phone` (private key) and `computer` (JSON: key, name, pairedAt),
  after first unlock, this device only; `MemoryVault` in the Mac test), `PhoneLinkPairer` (Bonjour candidates or fixed
  endpoints → session with `pair` → kept on the answer → app `hello` for the name → closed; `Step`, `Failure`).
  PhoneLinkView.swift: `PhoneLinkModel.shared` (`open(text)`, `forget()`, `phoneName`/`sentName`: what the computer
  lists this iPhone as, named by the person before pairing, "iPhone" to start with), the My computer sheet (opened
  from More: Settings' My computer block and the engine's "Pair with my computer" link, https://pair.trif.invalid/
  caught in PanelChat; and `trif://pair` links; no ⋯ menu item since 11-17), `QRScanner` (AVCaptureMetadataOutput).
  Info.plist: NSLocalNetworkUsageDescription, NSBonjourServices `_trif._tcp`, the camera's words.
  PhoneLinkRemote.swift (no UI; built for the Mac too): More's "My computer" engine's link: `connect` (Bonjour or
  fixed endpoints, no secret, app `hello` at once, `ping` every 30 s), `start` (`run.start` with the outline as the
  page copy and a JPEG), events numbered and each handed on once, `tool.request` → `onTool`, `run.result` → `onResult`
  then `run.ack`, `away` on a drop → reconnect after `retry` waits or `wake()` → `run.resume` from the last event;
  `onLost` (no-run, away after the waits, removed). PanelChat.swift's engine `computer` (PanelEngines' list):
  `goComputer`, the computer's `done` held until its result, whose mods go to `offerFromChat` (Add this mod?); its
  tool requests run `runTool` on the run's tab (try_mod answers with a screenshot too); `linkWords` (the states).
  Kept runs (11-17): the adapter asks `link.pickUp` once loaded, and the app back in front asks again (at most every
  30 s): `pickUpKept` connects, takes `hello`'s `pending` into their chats (`window.__trifPanelAdopt`: not into a
  chat busy with a live run), `PhoneLinkRemote.pickUp` → `run.resume` after 0; nothing pending → the link closed.
  The computer's `error` events with `reason` sandbox/login are said in the app's words (`linkWords`). The Simulator
  asks no Local Network question (Bonjour browses with no prompt; a missing computer is `notFound`): `denied` is a
  device-only check.
  PhoneSync.swift (no UI; built for the Mac too): phone sync (docs/PHONE-SYNC.md and PHONE-SYNC-PROGRESS.md on
  phone-link): `PhoneSync.run` (begin with {id, rev} → puts → gets taken by the store → removes → end with `have`),
  `Summary`, `Scheduler` (one at a time, coalesced; a change syncs 3 s later only if a file's rev differs from the
  last good sync). The store is ModStore (`syncFiles`, `syncTake`: new as an import (off, newOff "computer"),
  changed as saveEdit judges, history source computer; `syncRemove` → `trash`, Recently deleted, 30 days,
  Application Support/mods-deleted.json, `restoreDeleted`; every delete goes there now). PhoneSyncModel
  (PhoneLinkView.swift) owns the app's ONE PhoneLinkRemote (PanelChat's `link` is it: one session per phone) and
  syncs on didBecomeActive, `$mods` changes, `sync.changed` (onSyncChanged), syncNow; closes a sync-only link after
  30 s unused (`lastUse`). Dev steps `sync`, `syncstate`. The Mods tab (S7): PhoneSyncModel's `line` (syncing, the
  last sync's counts or why not; paired only) and Sync now under Import mod…; `notices` (conflict, came back, couldn't
  read, too big) at the top until OK (`seen`); Recently deleted (all sites, folded) with Restore; newOff "computer"
  marked "from your computer". ModsPanel's state has `sync` and `trash`; messages syncNow, syncSeen, restoreDeleted;
  the tab refreshes on PhoneSyncModel's changes. After a sync that changed mods here (taken, removed, back, a
  conflict's sibling) PhoneSyncModel's `applied` → Browser.syncApplied: the pages' scripts made again (before S8 a
  synced change sat in the store and ran only after a relaunch), and the shown page reloads if one of them is for it.
  Test on the Mac: `node --test mobile/test/phonelink.test.js` (swiftc builds the four files with
  mobile/test/phonelink-check/main.swift; a stand-in computer from the phone-link worktree's helper/lib/phonelink
  and tests/, or TRIF_PHONE_LINK_LIB; 8 tests, about a minute; `check syncunit`: PhoneSync against a scripted computer;
  the last test: PhoneSync over the real link against the stand-in computer's sync session (`check remote`'s stdin
  `pset <id> <JSON>`, `pdel`, `files`, `sync`; a store in memory that holds what has `fetch(`)). The last one runs the real Store, Server, Runs and Remote with
  the stand-in agent (phone-link's `tests/phone-link-computer.js`, which is also the Simulator's computer: `node
  tests/phone-link-computer.js --seconds 600`, its first line `{port, qr}`, then stdin `go <word>`, `kept`, `remove`,
  `pair`, `quit`, and for sync `twin`, `write <rel> <JSON string>`, `delete <rel>`, `nudge`, `synced`, `held`,
  `run <site> <words>` (a desktop phone-view chat on phone~<site> with the stand-in agent; its word EDIT[:rrggbb]
  appends a coloured top bar to every mod of that twin; when done it nudges: S8's "edited on the computer");
  launch the app with `-linkhost 127.0.0.1:<port>`, pair with `simctl openurl` of its qr. Driving it from a shell:
  `mkfifo f; tail -f f | node tests/phone-link-computer.js --seconds 900 > log`, then `echo twin > f`. Its first
  look at held.js is at start, so what a sync brings later is judged).
- VideoResume.swift (Tim, 11-18; no UI, no WebKit: built for the Mac too): `VideoResume.watch` (TRIF's world, every
  page's start, main frame, in Browser's base scripts; same-origin frames' videos too) posts `videostate` (the playing
  video, or the last played: an unmuted one wins over a muted preview) on timeupdate every 3 s shown / 8 s hidden or
  backgrounded (media events, no timers: WebKit keeps them firing while it plays), and at once on play, pause, ended,
  seeked, rate/volume, pagehide/hidden. At the start it asks `videoplan` (with the navigation type: back_forward is a
  reload line); no reports until answered, nor while a plan waits for its video. `decide` (30 min, same page = same
  site video id (`videoID`: YouTube v=/shorts/embed/live/youtu.be, Vimeo) else the address without #, not live, not
  ended, not a link asking its own time (t=, start=), not the first 5 s / last 10 s). The page applies the plan to the
  video whose duration is within 1 s (and the same non-blob src), once it has metadata: speed, muted, seek; playing →
  `videoplay`, the app's own play (`VideoResume.play`, a gesture: sound; refused → muted + the "Tap for sound" note
  (`Browser.tapForSound`, `soundTab`, `soundOn`), else left paused). A site that moves it in the next 6 s (behind the
  expected time or past it + 3 s; not after the person's pointerdown/touchstart/keydown) gets it put back once.
  `videoapplied` → Diagnostics "video: resumed a video at m:ss on <host>" (the only line; reasons not to resume go to
  report.json "video"). Kept: Tab.video, and `VideoStore` (Application Support/tab-videos.json, written 5 s after a
  change and as the app leaves the front; loaded in restoreTabs, older than 30 min dropped; a closed tab's removed).
  Browser.videoMessage handles the messages. The JS videoId mirrors the Swift one (mobile/test/videoresume.test.js
  checks both).
- Reload causes (Tim, 11-18: "Various things keep reloading my YouTube window"): every app reload goes through
  `Browser.reload(tab, cause)` / `reload(cause)` and logs Diagnostics "reload <host>: <cause>[ (a tab behind)]" as it asks
  (Tab.reloadCause until the commit); decidePolicy's .reload with no cause = "the page reloaded itself"; `start` logs
  "its tab restored as the app started" or "shown again after its page was let go in the background (<why>)" (Tab.letGoWhy,
  from discard); the page's back_forward navigation (a real reload, not WebKit's page memory) logs from videoplan.
  Causes passed: modsChanged(why:) (each caller: "<id> added (chat)", "the Mods tab: enable <id>", "phone sync changed N
  mod(s)", "Pause all mods", "the quick ask's Undo", …), Request Desktop/Mobile Website, desktop agent fix,
  pull-to-refresh, More's run, the probe's checks, WebKit ended its page's process (free MB, last memory warning, tabs).
- The pages' scripts (11-18, Tim's hangs after "making the pages' scripts again"): `Browser.rebuildScripts(then:)`
  coalesces changes (one build per moment; a change mid-build builds again after), `ModStore.scriptPlan()` on main
  (each mod's key made again only when its texts changed: `planKeys`), `ModStore.build` off main (texts of new/changed
  mods only), `userScripts(from:fresh:)` on main (WKUserScripts kept per mod key in `built`; SES, runtime, mirror, free
  relay, bridge made once), `swapScripts` (remove all + base + mods; skipped when `ScriptPlan.shape` + rules equal the
  last swap). `scriptsPending`: a tab committing meanwhile records its signature as "pending" (stale), and
  refreshIfStale waits for the swap. `installScripts()` stays synchronous for the launch and the hide rules. The mark
  "the pages' scripts made again…" after it, so later hangs aren't blamed on it. A Diagnostics "mods" line when a
  rebuild takes ≥ 50 ms on main or ≥ 1 s in all.
- HeavyJob (Safety.swift, 11-18): TRIF's own heavy work (`begin`/`end`/`run`, UserDefaults "safety.heavyJobs", any
  thread): a model's check (LocalModels), its load and runs (LocalRunner), imports (ModFiles.collect). Safety.init: an
  unclean end during one logs "safe mode: the app quit while TRIF was <job>; mods left on" and switches nothing off.
- LeavingCover.swift (Tim, 11-18): the black cover with the robot as the app leaves in icon use (`reason`, deciding through LeavingCoverRules.swift since round 8), a
  UIWindow at .alert + 1 put up in SceneDelegate.sceneDidEnterBackground (Safety.swift), taken off after
  sceneDidBecomeActive once PendingLink.url is taken and the shown tab is `drawn` (cap 0.8 s), 0.2 s fade.
  `iconLinkCame` from PendingLink.came and ContentView.openLinkNow. Its picture: Assets.xcassets/CoverRobot.imageset
  (`make-icon.js --cover`: robot-shaded.svg drawn from the vector at 256 / 384 px, a 128 pt picture cropped to the
  robot with 2 pt round it, the robot itself 124 pt) on LaunchBlack.colorset, also Info.plist's UILaunchScreen
  (INFOPLIST_KEY_UILaunchScreen_Generation = NO in the pbxproj and make-project.rb).
- Unread counts (Tim, 11-18): UnreadTitle.swift (no UI; built for the Mac too) = mobile/shared/unread-count.js, the
  shared rule (Android's to use; in docs/MOBILE-BEHAVIOUR.md; a Swift twin rather than a call through Core: it runs on
  every title change). `Tab.unread` (read in title's didSet; `cardLabel(counts:)` the title without the count). UnreadCounts.swift:
  `UnreadCounts.shared` (browser; `changed()` coalesces 0.3 s → `update()`: the sum over `iconTabs(b)` (iconTabs map,
  on its site) → getNotificationSettings → `apply`: not asked → `asking` (ContentView's alert, once: UserDefaults
  unreadBadgeAsked, cleared when the setting is switched on again) → `answer(allow:)` → requestAuthorization([.badge]);
  allowed with Badges on → `setBadgeCount` (only on change); refused / Badges off → nothing). Called from Tab.title/url
  didSet, Browser.init (after restoreTabs), close, openFullScreen. `UnreadBadge` (TabCard's top left, in an HStack after
  ChatGlyph). Setting: ⋯ → Show unread counts (`showUnreadCounts`, default on; TabCard reads it by @AppStorage).
  Diagnostics kind "unread" (numbers only, never titles: Gmail's has the address).
- make-icon.js: the app icons (light, dark, tinted = Rec. 709 grayscale of the colour art, face black); run it with
  `TRIF_E2E_CHROME=<Chrome for Testing binary>` (the worktree has no tests/e2e/.browsers). make-project.rb: regenerates the project
  (sources globbed); the pbxproj is also edited by hand (ids `A1C10B0E5EB1C11B000000xx`).

## Tim's decisions

- Mods from a reply are picked up automatically (and Add to TRIF stays under each block). Instructions ask for code
  blocks, never attached files.
- No private APIs or tokens for the chat sites. The one private call kept: WebKit's `_flushCookiesToDisk`, with the
  public fallback behind `-publicflush`.
- An icon's own tab (`iconTabs`) counts only while it's on the icon's site (11-17: Tim's YouTube icon opened his Google
  search, typed in its old tab): off-site it's left as it is and the icon makes a new own tab; a blank one takes the
  icon's address. Icon links log Diagnostics lines `link` (as UIKit hands them over: AppDelegate
  configurationForConnecting at launch, SceneDelegate openURLContexts later, which comes just AFTER onOpenURL) and
  `icon` (taken, the tab and why); PendingLink opens one onOpenURL never brought, 2 s after coming to the front.
- Full screen: per tab, remembered; the two-finger hold (0.3 s since 11-18, Tim: "half as long"; was 0.6; each finger still) toggles it either way at once, with
  a fading note; ⋯ → Full screen names the hold; a faint exit button at the top right 60 pt down (bright 3 s on entry and
  on scroll-up), hideable in ⋯. A Home Screen icon (`app=1`) ALWAYS lands on its site's own tab in full screen (Tim
  11-16: "no matter what it was in before"), closing covers (Add this mod? stays); TRIF's own icon opens as it was left.
- Add this mod? and the Mods tab's approval card: the buttons come right after what they agree to (name, site, summary,
  powers, warnings) and before the code (Tim, 11-16: no scrolling past code to approve).
- Toolbar page button: + on the page with a circle behind it; the page glyph has no circle.
- The robot glyph is TRIF's exact shape drawn as an outline in the toolbar's tint and line width, like the other icons.
- At most 3 chats at once; a working chat is never released; the robot opens the tab's own site's chat.
- A conversation belongs to the site it started on: no follow-ups across sites; other site's → full instructions.
- Projects: the person makes the project; TRIF only copies its instructions and remembers the page. Project chats still
  show in Recents (told, not hidden).
- More = the desktop side panel itself (generated, `--check`), not a new native chat. Engines: On this iPhone, Claude API,
  OpenAI API, OpenRouter; keys in the Keychain, this device only.
- On this iPhone: MiniCPM5-2B suggested on 4 GB, Qwen3.5-2B offered; Qwen3.5-4B on 6 GB+, and on 4 GB behind "Show bigger
  models"; style JSON by default, boxed only when picked; downloads only when asked, with a visible bar everywhere.
- App icon face (Tim 11-16, option A): Apple's continuous-corner curve scaled down, `continuous(100.39, 100.39, 823.22,
  214.04)`, not the mask moved in (its inner corners were too sharp). Rim = square minus face (even-odd, rim gradient),
  face on top (#18181a light, #000 tinted, none in dark); rim 100.4 at the sides, 120.5 on the diagonal. iOS's mask
  makes the outer edge. The approved mockups' tinted greys (brightened) are NOT used: tinted stays the grayscale.
- Background tabs are let go after 20 s (and on a memory warning) unless playing sound: a playing tab is kept,
  looked at every 5 s, and let go once paused/stopped 20 s (Tim, 11-16: YouTube with his Background Play mod).
- Sound and video play on with the app in the background or the phone locked: UIBackgroundModes audio, the session
  .playback/.moviePlayback at launch (category only, not activated), and BackgroundPlay.resume replays a video
  WebKit paused as the app left. That last is beyond Safari (which pauses it, 11-16 Simulator); a page that pauses
  itself as it goes hidden is respected. Awaiting Tim's view.
- Home Screen icons (Tim's design, 11-16): a small TRIF app (the app icon's rim and face A round a black screen, the
  picture on it at 74% of the face), outline colour (TRIF green gradient + 5 swatches + any), own picture (Photos),
  no outline, green checkmark "fixed" badge; names {Site} on TRIF · {user}'s {Site} (GitHub user-login meta and
  MediaWiki #pt-userpage only) · fixed {Site} · Custom…; Tim's labels approved as written. The toolbar's last button
  is the A button for it (a plain + until 11-17); the ⋯ menu is at the address bar's left (without Add to Home Screen). The profile is named
  {Site} for TRIF whatever the label (Settings, Files). http sites and profiles over 400,000 bytes skip the clip page.
- Several icons in one install (Tim, 11-16; built 11-17): "Add to Home Screen later" in the [+] sheet keeps the icon
  with all its choices on a list (survives restarts, up to 20); ⋯ → Home Screen icons to add / "Add them all…": edit,
  take off, clear, or add all as ONE profile (one Web Clip each). Its identifier `…webclip.batch.<tag>`, kept until the
  list is cleared; a new list holding every site of an earlier list reuses that one's tag (replaces it). The list clears
  when TRIF is opened from one of its icons (link `&set=<tag>`). Profile name "TRIF icons: X, YouTube, NYT". One icon on
  the list goes as its site's own profile. All its words await Tim (strings doc).
- Toolbar (Tim, 11-17): the Home Screen button is an A in a rounded square (SF Symbol a.square), not a +. Order
  SHIPPED (Tim, later 11-17: "the old order" again): back, forward, chat, [page / +] (centre, 4th of 7, exactly
  centred: SE 187.5, 17 Pro 201), Mods, tabs, A. Tried earlier that day: tabs before Mods. One line either way:
  `ContentView.tabsBeforeMods` (false; launch with `-tabsfirst` for the other). It's the only view that draws the
  bottom bar (full screen has none).
- Point-and-hide is gone (Tim, 11-17: a resting thumb set it off; with many nested divs the right layer can't be
  picked, and hiding one div is fragile): the long press, its bar (Hide this, All like it, Wider, Point TRIF at this,
  Everywhere on…), the Hidden/Undo note, Ask the phone's own model (it only fed that bar), Show everything hidden, the
  #hide= mod link sheet (trif: and /trif-install links in pages are now just not followed, a report line), the
  clipboard's selector path. Rules it made stay applied, each with Show again in the Mods tab. Pointing may come back
  later in the desktop mod tools, only if the right layer can be picked reliably.
- Long press on links and pictures = Safari's (Tim, 11-17, "normal iphone behaviour"; built 11-18): the system's menu
  (WebKit's `suggested` items kept: Open, Add to Reading List, Copy Link, Share…; a picture's Share…, Save to Photos,
  Copy, Copy Subject, Look Up) and, for links, "Open in New Tab" first (a TRIF tab after the link's, shown; not for
  javascript:; mod links stopped as ever). `allowsLinkPreview` is true. Once the app returns a configuration WebKit
  draws only the link's highlight, so http(s) links get `LinkPreview` (the page in its own web view: the tabs' cookie
  store, no TRIF scripts or mods, no autoplay, no touches), sized to the page's width and half its height so the whole
  menu fits on an SE. Tapping the preview loads the link in the same tab, as Safari. A picture keeps WebKit's preview.
  The two-finger hold still toggles full screen (also with a finger on a picture); text selection unchanged. Point-and-hide's
  "Hidden by pointing" list in the Mods tab is NOT dead: it shows the saved rules (Show again); only Report.add(HideRule)
  was dead and is gone.
- An icon's link shows its tab from the first frame (Tim, 11-17, "comes up as that other tab and then quickly switches
  with a little animation"; built 11-18). Cold: the link is known in configurationForConnecting BEFORE Model/Browser are
  made (checked: "launched by a link" logs before restoreTabs), so `Browser.showIconTabAtLaunch` selects the icon's own
  tab (on-site only; full screen) as the tabs are restored; ContentView.openLink then finds it in front. NewTabView isn't
  shown over a tab with a kept address waiting to load (it flashed over the icon's tab). Warm: openLink runs in a
  no-animation transaction + performWithoutAnimation. Measured (simctl recordVideo, every frame): in front, the switch is
  one frame; from the background, the APP's first frame is already the icon's tab, but iOS cross-fades its own snapshot
  of the app as it was left (the old tab) into it over ~0.35 s during the zoom. Nothing the app does at open time can
  change that snapshot: hence the leaving cover (next).
- Leaving cover (Tim, 11-18, built 11-18; his recording: the FeedBook icon tapped, iOS slid in TRIF's picture of X):
  as the app goes to the background in icon use, a black screen with the robot in the middle (no words; black in light
  and dark mode, after the Web Clip's own black screen) covers it before iOS takes its picture, so the slide-in and
  the fade show TRIF's robot, never another page. Launch screen the same (a cold launch from an icon looks like a
  return). Icon use (`LeavingCover.reason`, my pick): the shown tab is an icon's own tab (`iconTabs`), on its site, in
  full screen, OR the app last came to the front by an icon's link. Why: an icon lands exactly there, so someone
  leaving from it or who came in by an icon is the one likely to come back by one; a tab put in full screen by the
  two-finger hold with no icon is TRIF used as a browser, reached by TRIF's icon or the app switcher, where the card
  should show the page. Otherwise iOS's real picture is kept (the switcher's card shows the page). Put up in
  sceneDidEnterBackground, not on resign-active (Control Center, a pulled-down notification, the switcher keep the
  page). Off on return once the icon's tab is chosen and its page drawn (≤ 0.8 s, so a page iOS let go reloads under
  the robot, not as white), with a 0.2 s fade. Tab pictures are WebKit's takeSnapshot of the page alone (checked: one
  taken with the cover up is the page). Pause all mods, Safety and the default-browser rules untouched. Diagnostics
  kind "cover": one line each time it's put up, with why. Robot size (Tim, 11-18: "like this big, but perfectly
  centered and full resolution", his SE reference ~247 px): the robot itself (rim's outer edge to edge) 124 pt, a third
  of an SE's width, ONE fixed size on every iPhone (COVER_ROBOT_PT in make-icon.js): the Info.plist launch screen shows
  its picture at the picture's own size and can't scale it, and a storyboard that could would resample the bitmap on
  every phone but one (not full resolution); the cover matches it. Centred on the whole screen, not the safe area.
  Measured (bbox of the green): SE cover 248 px, offset 0, 0 (446); SE launch 247 px (h264 frame), +0.5, +0.5 (447);
  16e (@3x) launch 372 px, +0.5, 0 (448); 16e cover 372 px, 0, 0 (449), crisp at 100%. Tim's reference sat 12 pt above
  centre: the Simulator never showed that (nor the 11-18 shots 383-384); if his phone does, it's the phone's.
- ⋯ → Copy diagnostics (Tim, 11-17; after Import…, visible without scrolling on an SE): the same text as the Mods
  tab's Send diagnostics…, then the 2 s note "Copied." (draft).
- Chat offers (Tim, 11-17, "spurious asks to add old code when I open Claude chat"): a chat never offers the same
  code twice (whatever came of it), nor an installed mod's current or earlier version, nor one in Recently deleted
  (ChatOffers.swift: the second guard).
- Only the assistant's code, only from a reply TRIF saw arrive (Tim, 11-18: "When I paste code into Claude in the app,
  the app reads it as a mod"; "opening an old chat gets spurious pickups of old code"). Positive rules in chat.js, fail
  closed: `turnOf` — a block counts only if the nearest message around it is a REPLY (not USER), the outermost reply
  there holds no USER and not the message box, and it isn't in anything editable; else no Add to TRIF, no pickup, no
  late. `track` — a send's watch offers only replies that weren't on the page at the send, come after the person's
  message sent in this page (the last USER that wasn't there at the send), and were seen being written (Claude's
  data-is-streaming="true" on them, or their text changing between looks; after a reload, `resume`, twice); `late`
  takes only more of those (`last.live`). The watch is its conversation's (`convoOf`: /chat|/c|/uc/<id>; a new chat's
  first address is the same one; any other → done `left`, nothing offered, the app's dots stop). A viewer is offered
  only if the tap that opened it (sessionStorage `__trifTap` {at, reply}, 6 s) was inside an assistant's reply, or
  with no tap while a live reply is being written / ended < 2 min ago; else `skipped`. The app: a reload onto another
  conversation than the one sent from (`workingConversation`) isn't resumed. Not offered but on the page → message
  `held` → Diagnostics "chat offers": `held from <site> at <path>: N outside the assistant's replies, M in replies not
  seen arriving (<why>, send|resume, sent message found or not, K live)`. Add to TRIF stays under every assistant
  block, old ones too (a tap is consent).
- TRIF must stay default-browser compatible (Tim, 11-18, a standing design constraint): Apple's
  com.apple.developer.web-browser entitlement rules, so it can be made the default browser later: on launch, an
  address/search field or a usable start page; http/https links open where they point, in a new tab, with no
  redirecting or rewriting the destination; WebKit only; no crash-prone launch paths. Tim has no entitlement yet
  (needs the paid account + Apple's request); the Info.plist http/https declaration comes with that step.
- Chats and tabs both ways (Tim, 11-18, all four approved; words drafts): (1) a done banner when a chat not being
  looked at finishes a reply: "{Service} made a mod for {site}" · Add · Go to {site}, or "{Service} replied about
  {site}" · Open chat. Its mods are HELD (`offerFromChat(hold: true)`, noted offered once; Add or Go to hands them to
  Add this mod?; never a second offer: the judge's `queued` includes them). Exception (my call, for Tim): on the
  chat's own site's tab with nothing over it, Add this mod? comes up at once, as before (no banner). (2) the chat's
  top bar's "← {site}" row and the added note's "Go to {site}". Go to: the tab sent from while open AND on that site;
  else a new tab at its page (never a tab navigated elsewhere, nothing rewritten). (3) tab list robot badges.
  (4) long press on the toolbar's 🤖 → the chats' list (nothing else used a long press there; the tap is unchanged).
  Whole-banner tap (Tim, 11-18, "tapping anywhere on the notification should bring me to the Claude screen"): a tap
  anywhere on the done banner outside its buttons = Open chat (`onTapGesture` + contentShape on ChatBannerView; its
  buttons' own taps win; the swipe up still closes it). A mod banner tapped: the chat opens and the banner STAYS over
  it, still holding its mods for Add / Go to (one offer, never lost: checked, Add after it gave one Add this mod?).
  VoiceOver: the banner's words read as a button, hint "Opens the chat" (draft). Diagnostics "chats": "done banner:
  open chat for …". Simulator only (shots 387-388; a plain reply's text tapped, a mod banner's blank area tapped).
- A chat's mods belong to the chat's site (Tim's bug 11-18: FeedBook, no @match, from a Facebook chat said "runs on
  google.com", the tab shown when it finished): `offerFromChat` reads with `here` = the chat's site (phone~<site> →
  <site>), the page shown only when the chat has none; Add to TRIF taps pass the chat's site (`offer(text:site:)`);
  More's panel runs pass `run.site`. A mod whose own @match names another site still warns.
- Desktop Website / Mobile Website (Tim approved 11-18, "Request" dropped). The address screen's Cancel closes an
  empty new tab and goes back to the tab it came from (Browser.newTabFrom / leaveEmptyNewTab, as the + again; any
  way the new tab was made); never the last tab.
- "Open in New Tab" (link long-press menu, and History's long-press item, was "Open in a new tab"): approved by Tim 11-18.
- Request Desktop Website (Tim, 11-18, "a desktop mode like safari has"; built 11-18, words Safari's, drafts): in
  the ⋯ menu before Full screen, websites only; "Request Mobile Website" on a desktop site (the label follows the
  shown tab's loaded mode, `Tab.desktop`). Kept by host without www. (UserDefaults `desktopHosts`, a sorted list, no
  more), every tab, across launches; picking it reloads the shown tab only (other tabs change at their next load, as
  Safari). WebKit's public desktop mode per main-frame load (MacIntel, desktop behaviours) plus the web view's
  `customUserAgent` = Mac Safari's (`Browser.desktopAgent`; see Gotchas: WebKit's own desktop agent ends with our
  "Mobile/… Safari/604.1"). Phone mods run unchanged in it. The chat pane has its own delegate and config: never
  desktop (checked: a desktop localhost, the pane on localhost said iPhone). Not on iPad (WebKit's recommended mode
  there is a computer's already; `checkAgent` is iPhone-only). Link previews of a desktop site load as one.
- Toolbar buttons toggle (Tim, 11-18, "re-tapped on the tabs menu, it should bring you back to the page"): tabs and
  Mods tapped again while open close them (the page under them is never touched: same scroll, no reload; checked
  pixel-identical). [+] tapped again on its new tab's address screen, nothing opened there yet, closes that empty tab
  and selects the tab it came from (`newTabFrom`, weak, in ContentView). The A opens a full-height sheet over
  the toolbar (Cancel / swipe), so it has nothing to toggle.
- Full screen's exit button (Tim, 11-17, "can we move it up?"; glyph kept): beside the clock at the foot of the status
  bar: SE right of the clock (circle centre 250, 18), Dynamic Island phones between the clock and the island (17 Pro:
  117, 52). Its taps go to a window-level recognizer (ExitTaps), 40 × 44 from the bar's foot down.
- Add this mod? (Tim, 11-17, a stronger out-of-site warning approved): a coral "It runs on another site / other sites /
  every site" box first when the mod runs beyond the site it came from (the chat's site or the page it was pasted on;
  files and codes have none), and the approval card's findings ("TRIF found that this mod:", "Together, it …") above
  the buttons.
- The chat pages read as TRIF (Tim, 11-16): greeting with the robot in the service's greeting's place, pills "From
  TRIF: …" with the robot, upsell buttons hidden; never their branding, Log in, terms or safety lines. Cosmetic only.
- Tab pictures as Safari's and Chrome's (Tim, 11-18: "a lot of the tabs in tab view are still blank"; built 11-18).
  Cause found (Simulator, shot 356 vs the old build): a restored tab left (or the list opened, or the app coming
  back) before its page had drawn saved a white picture over its good one. Now TabShots (Tabs.swift) pictures only
  the shown tab (left, tabs opened, app leaving the front (not coming back), 1 s after a load), only once
  `Tab.drawn` (finished + 0.3 s, or committed + 2.5 s; reset by a commit, a web view made again, a process ended),
  never mid-scroll (a load's picture retries 4 × 1 s), at most every 3 s a tab per address, and drops a picture
  all of one colour. File: Caches/tab-shots/<id>.jpg, the card's width ((window − 42)/2 pt) at the screen's scale,
  the card's shape (0.7), from just under the address bar (obscuredContentInsets.top; the page under the toolbar
  is kept). Cards read them lazily (`.task(id: shotVersion)`, ImageIO downscale, NSCache 12 MB, let go on
  disappear); Tab holds no image. Closed tab → file deleted (and a closing tab isn't pictured as it goes);
  orphans deleted at launch. PrivatePages: never pictured, old picture deleted: TRIF's sensitive list
  (SENSITIVE_DEFAULT parsed from the bundle's panel/agentsites.js, 80 patterns, agentsites' matching), sign-in
  hosts (accounts.google.com, appleid/idmsa.apple.com, login.microsoftonline.com, …), sign-in paths (/login,
  /signin, /auth, /oauth, /sso, /session, /i/flow/login…) and a password field showing (TRIF's world, 1 s). The
  fallback: a grey card (secondarySystemBackground) with the site's first letter (Site.of) in a circle
  (tertiarySystemFill; an empty tab a globe); under every card its title, then its host (when it has a title).
  The app keeps no favicons (WebClip fetches them only for Home Screen icons), so no favicon card. Not touched:
  Mods, the chat pane, the start page, links/new tabs (default-browser rules unaffected).
- Quick ask (Tim, 11-18, "yes build it"; words drafts): the robot's long press opens the chats' list with the box
  "What should change?" and a hold-to-talk microphone at its top (a tap on the robot unchanged). Typed (the
  keyboard's own dictation works in it) or said (on-device Speech only: where `supportsOnDeviceRecognition` is
  false the microphone says so and records nothing; refused permissions: the box still types). The request goes to
  the tab's site's chat (its conversation, else a new one) with the same page details as the robot's tap, plus the
  request as text. HARD RULE (Claude's and ChatGPT's terms): in their panes TRIF fills the box but NEVER sends: no
  click(), no synthesized Enter, no submit, no TRIF button that triggers theirs. A strip of their real page (its foot:
  the box and the site's own Send) slides up over the tab; the person taps Send; their message appearing (chat.js
  armSend, plus the click/Return listeners) is the send; the strip goes, the pill says "Working: …". More's engines
  (API keys, My computer, On this iPhone) have no site page: TRIF's own panel sends at once. Done: look-only mods
  (style tier, no powers, nothing held, no warnings, only the chat's site: `QuickAsk.lookOnly`) are added at once,
  the pill "Done · Undo" (20 s); anything else gets Add this mod? / the approval card (on the chat's tab now, else
  the done banner holds it). One offer per mod (offerFromChat's judge). Follow-ups continue the same chat. The pill
  closed while working: the reply is offered as ever (nothing added by itself). A tap on the pill opens the chat.
- The strip appears once and stays still, and is small (Tim, 11-18, his recording: it went "up and down and up and
  down" while Claude's page loaded; "the Claude chat can be a lot smaller. We don't need to see the chips even"; built
  11-18). The chat fills behind the tab (the pill: "Putting it in Claude…", a tap opens the whole chat); once the box
  is filled and the page has settled (`settleStrip`: its text, attachments, size and place unchanged 0.3 s), the strip
  slides in once, at its final size: a slim header (34) over only what shows of their box's text and the site's own
  Send (one line: 92 pt in all on an SE; at most 112 pt of text: a longer text scrolls in their box, its end and Send in
  view), never the attachment chips, the "… can make mistakes." line or messages. Cropped by moving and clipping the
  chat's web view (laid out full size, never resized or restyled); afterwards the page's changes are followed with no
  animation (`pin`), so nothing in the strip moves. The person's software keyboard in the strip's box (their tap)
  opens the whole chat (the box focused, the keyboard up: the cropped band can't hold an editor with a keyboard:
  WebKit scrolled it out of the band, seen before this was added; shot 435 is the whole chat after); a hardware keyboard's bar keeps the strip, re-pinned
  above it (436). A keyboard coming up while the strip's chat fills behind the tab (the fill's brief focus; no finger on
  a page) is left out of the layout (`keyboardNotTheirs`, BarState and `.ignoresSafeArea(.keyboard)` on the page
  while preparing): my reading of the recording's dips (the toolbar went away as the strip jumped), unconfirmed on a
  phone: Diagnostics "quick ask: the keyboard came up while the strip's chat was being filled" says when it happens.
- The chats' list (Tim, 11-18: "Done" read as cancelling): top right **Send** = the box's arrow (QuickSend; while
  listening by a tap, the stop that asks; dimmed when the box is empty); top left **Cancel** closes, the words kept in
  the box, as a tap on the dimmed page or a swipe down (checked: all three keep the draft).
- The app is called TRIF (Tim, 11-18): CFBundleDisplayName (pbxproj, make-project.rb); every "TRIF Probe" people see
  is "TRIF" (Settings sentences, the icon steps). CFBundleName stays TrifProbe (PRODUCT_NAME; the generated plist wins
  over Info.plist's; Settings and iOS's questions show the display name). The developer menu "The probe" kept its words.
- The tab list opens at the right card (Tim, 11-18: "it should snap to the tab that I just left"): the shown tab;
  from the chat (or the quick ask's strip), the chat's own tab (`ClaudePane.chatTabShown`: its link's tab while open
  and on its site, else the shown tab; More follows the shown tab); from Mods, the shown tab (Mods always shows the
  shown tab's site). That card is centred (`scrollPosition(id:)` from the first frame, plus `scrollTo` without
  animation on appear) and drawn as the current one (green), even when it isn't the tab shown under the list.
  Recorded frame by frame (11-18): no scroll from the top, the card pictures fade in where they are.
- Links that aren't web pages go to iOS (Tim, 11-18; built 11-18, words drafts): tel:, mailto:, sms:, maps:, an app's
  scheme (fb-messenger:…) are handed to iOS (UIApplication.open) and the navigation cancelled. At once only when the
  person tapped: a link or form AND their finger on that web view in the last 1.5 s (WebKit calls a script's
  `a.click()` a link too: checked, it asks), or a long-press menu item (WebKit's Open, Open in New Tab, the preview).
  A page or mod doing it by itself (script, redirect, refresh, `a.click()`) gets Safari's question "Open this page in
  “App”?" / "Open this page in another app?" (Cancel / Open): only for the shown tab's or shown chat's main frame, one
  at a time, once a page load (reset at the next commit); frames inside the page, tabs behind, the app in the
  background: nothing. No app: "No app on this iPhone can open this link." (the app's note; full screen's note in full
  screen; over the chat too). target=_blank / window.open of such a link: to iOS, no empty tab. trif: (mod links: not
  followed, as before), TRIF's own schemes, javascript:, file: never leave; about/blob/data stay; http/https unchanged
  (default-browser rules). More's panel: taps only, never a question. Diagnostics "app link": the scheme only.
- The robot's tap = the quick ask (Tim, 11-18: "make that the default tap experience"; built 11-18): a tap on 🤖 opens
  the list (the box, the microphone, then **Go to chat**, then the chats). Go to chat = the old tap (the tab's site's
  chat, the page filled, or the reply waiting shown); it names the service and site and says Reply waiting / Working…
  for this tab's chat (a green dot); waiting chats in the list are bold with a dot. The chat open: the robot goes back
  to the tab; the strip up: the robot opens the whole chat. The compact address bar's robot (a reply writing or
  waiting) still opens the chat at once. VoiceOver: hint "Opens What should change? and the chats", action Go to chat.
- The robot held = hold to talk (Tim approved 11-18; built): held still 0.45 s with talking ready (speech allowed,
  microphone allowed, on-device recognition available) it listens at once (a light tap of feel), the glowing pill over
  the toolbar with the words and "Slide away to cancel"; let go → the quick ask (the strip and the person's own Send for
  Claude/ChatGPT, More direct; then the pill, Done · Undo). Slid 90 pt away → "Let go to cancel", nothing asked. Not
  ready (first time, refused, no on-device speech): the list opens instead, its box saying why or asking. A finger
  moving 20 pt before the 0.45 s is a slide, not a hold. One DragGesture(minimumDistance 0) beside the Button (ContentView
  robotPress/robotHold/robotLift); `robotHeld` stops the tap that ends a hold.
- The box's microphone: tap or hold (Tim, 11-18; built): a press under 0.3 s is a tap: listening goes on (a stop square,
  an ✕ beside it, "Listening, tap to stop") until the next tap (asked) or the ✕ (kept in the box, not asked). Longer
  is a hold, as before; slid 90 pt away and let go: this listen's words dropped, nothing asked.
- The microphone never stops by itself (Tim, 11-18: "If you pause, it deletes the things you've said so far … Let it
  keep going and have long stretches of silence … The user will know when to stop it"; built 11-18): no silence stop,
  no time limit, in tap and hold (box and robot). Only the person's stop tap or letting go asks; a call, Siri, the app
  leaving the front (even resign-active), the list closed, an error stop it with every word kept in the box
  (`draft`) and the note "Listening stopped. Nothing was sent: your words are kept here." (draft); a robot hold
  stopped that way puts KeptTalkPill over the toolbar (15 s; a tap opens the list with the words). The words only
  grow: what was said before a pause stays (SpeechText). A new listen goes on after the box's words (typed or kept),
  and the stop asks all of it. The whole text shows growing in the box's pill / the robot's pill, scrolling. On
  device only, always (SpeechAnalyzer runs on device; SFSpeech with requiresOnDeviceRecognition; neither → the
  not-on-this-iPhone note, nothing recorded). The ✕ now keeps the words (my call: never lose words; slide-away still
  drops them, it says "Let go to cancel" first).
- A mod for another site never reloads the tab shown (Tim, 11-18: "you're watching a YouTube video, when you
  successfully add the mod to the other tab, your tab reloads"; built 11-18). Cause: `Browser.modsChanged` reloaded the
  shown tab after EVERY mod change. Now each tab keeps `modsLoaded` (its committed address + `ModStore.signature`:
  every mod running there and the version of it); after a change the shown tab loads again only if that signature
  changed (`refreshIfStale`), and never while it plays (`Browser.playing`); tabs behind load again when next shown
  (`select`), unless playing then. Every path goes through it: Add this mod? / the banner's Add, Go to then Add, quick
  ask Done and Undo, Allow, the Mods tab's switches and edits, safe mode, phone sync (`syncApplied`), imports (no
  reload, as before). Pause all mods: the shown tab loads again even if playing (the person's own act); tabs behind
  only when shown (before 11-18 every tab reloaded at once).
- Sound and video around talking (Tim, 11-18, his phone: the video "doesn't start again … it's hung … spinning its
  loading thing forever"; built 11-18): as listening starts, TRIF pauses every tab's playing <video>/<audio> itself
  (BackgroundPlay.talkPause in TRIF's world, its time kept) before the session goes to .record; however listening ends
  (asked, cancelled, ✕, the list closed, the app left, an error) the engine stops, the session is let go
  (notifyOthersOnDeactivation), its category/mode/options put back exactly as they were (playback, moviePlayback),
  and what TRIF paused (or iOS paused within 2 s of the start) and is still paused plays on from its time
  (talkResume: the session activated first; play() refused → left paused there; playing but no time going by in
  1.2 s → one nudge, a seek to its own time and play; never a reload). After a call/Siri interruption it stays
  paused, as iOS leaves it. Diagnostics "audio": "talking: paused …", "after talking, <page>: …". Media inside
  iframes isn't reached (main frame only).
- Open Settings (Tim, 11-18): the Home Screen icon steps show **Open Settings** once Safari has the profile
  (`.fetched`, `.pageBack`) or it's saved to Files: `UIApplication.openSettingsURLString` only (public; never
  App-prefs:/prefs:, App Review). `trif://settings` (the clip page's own button, Tim edits site/) does the same
  (ContentView.openSettings, tried again once after 0.6 s; Diagnostics "link"); the tab, covers and leaving cover
  untouched; other trif:// hosts still ignored.
- The full chat opens with no keyboard (Tim, 11-18: "the keyboard flies up and it's disorienting"): chat.js fill never
  leaves the box focused: each paste/insert is `inBox` (focus with preventScroll, put, blur in the same turn; a box the
  person was already in keeps its focus). The strip too. Checked: Go to chat on the Claude and ChatGPT (`?octane`)
  stand-ins, the strip, a reply waiting: activeElement body, scrollY 0, a recording's frames show no keyboard bar
  (before: the Simulator's keyboard bar came up, shot 402).
- The Mods tab never says "didn't let it start" too early (Tim, 11-18: "odd flashes of error", his recording: the
  red line under each free mod for ~100 ms as he switched it on after safe mode). Cause: the quick state (the page's
  LAST answer, from before the switch) said "on, not started" before the page had loaded with the mod. Now
  (ModsPanel.modsState) a row that should run and isn't said to have started is `nextLoad` (not in Tab.modsLoadedIds:
  the ids the page committed with; switched on since), `starting` (loaded with it, but the page's answer wasn't asked
  ≥ Browser.startGrace 2 s after the page finished), or `cant` (loaded with it, answer settled, a free mod: the only
  error). A state with `starting` rows carries `recheck` (s): ModsPanel.refresh asks again then, so a mod that really
  can't start says so ~2 s after the page loads. The light's description says "Starts when this page loads again" /
  "Starting on this page" (drafts). Also: each state is numbered (`seq`, made in order on main) and the page drops an
  older one delivered late (a state made before a tap and delivered after it would show the switch's old state); a
  tier's On/Off shows the tapped state at once (`groupPending`). The flip-back in Tim's recording was NOT reproduced in
  the Simulator, old build or new (each "off then on" there looked like his own two taps ~0.6 s apart): the seq and
  groupPending are guards. The message is the phone's own (desktop has no "cant"), so desktop is unaffected.
- A page's own window closing itself (window.close(), a sign-in popup) goes back to the tab that opened it if that's
  still open (Tim, 11-18, as Android): Tab.opener (weak) set in createWebViewWith; webViewDidClose → close(t, showing:
  opener), only when that window was the tab shown. report.json "tabs" line. In docs/MOBILE-BEHAVIOUR.md (Links).
- Panels and dialogs that can outgrow their space scroll. Short release notes. Wording changes only where Tim names them.
- A video picks up where it was (Tim, 11-18; built 11-18, VideoResume above): every tab, every site, any reload of the
  same page within 30 min (a reload, a page process ended, a mod applying, back to it, a relaunch). Background
  playback keeps the kept time current (8 s reports from tabs behind and with the app in the background, checked).
  A tab BEHIND whose page process WebKit ends is no longer loaded again at once (my call, 11-18: unseen, into the memory
  that had just run out, and WebKit loads no media for a page off the screen, so its video stayed paused anyway): it's
  let go (discard) and loads when shown, its video picked up there. The shown tab still loads again at once.
- The model's check (Tim's SE crashed and froze, 11-18): LocalModels.sha256 reads with read(2) into ONE 2 MB buffer,
  F_NOCACHE, a 1 ms pause per piece, at .utility (Task.detached), as HeavyJob. FileHandle.read(upToCount:)'s Data was
  autoreleased and never let go inside the detached task: +444 MB for a 500 MB file in the Simulator (`hashtest` old),
  so the 2.74 GB model took the phone's memory. Now 3 GB: +2 MB, 14 s. A model loads only after its check (isReady needs
  the checked file in place), by mmap (LLAMA_LOAD_MODE_MMAP). A download answered ≥ 300 fails at once (didWriteData:
  cancelled, "the download failed: the server answered N"), never logged as progress.

- Unread counts instead of notifications (Tim, 11-18; words drafts): the sites' own counts from their page titles (a
  count at the very start "(3) …" / "(20+) …", "Inbox (N)" anywhere, "(N unread)" anywhere; a bracketed number elsewhere
  or a year at the start "(2024) …" is the real title's). A grey pill beside the robot's badge on each card (never red),
  the count taken out of the card's title. TRIF's icon badge = the sum over Home Screen icon tabs (on their sites), with
  `.badge` permission only, asked once at the first count, after TRIF's own alert; refused → no icon badge. Web Clip
  icons can't carry a badge of their own (iOS badges apps only): the icon tabs' cards and TRIF's icon carry it. The
  existing chat-reply and model-download questions ask for `.badge` too now (my call: iOS asks only once, so whichever
  asks first must include it, or a person who allowed chat notifications could never get the icon badge without going
  to Settings; the iOS question's words are the same either way). No background refresh (my call, per Tim's "only if
  cheap"): BGAppRefreshTask would have to load each icon site's whole page signed in (X, Facebook, Gmail write the count
  with their own scripts, not in the HTML). Counts are kept as the app leaves (the badge stays, titles saved in
  tabs.json); tabs behind are let go after 20 s, so their counts stand still until shown again.

## Open and unverified

- Unread counts (11-18): Simulator only (shots 450-456): stand-in unread.html as an icon tab: TRIF's alert at the first
  count (450), Continue → iOS's question (451) → Allow: badges on, alerts "not supported" (badge only), icon badge 1 → 4
  (452, the Home Screen) → none (0); the cards with the robot's badge and the pill (453), titles without the count
  (454: "Stand-in", "Inbox - tim@example.com - Gmail"); ⋯ → Show unread counts off (455; a real tap) → badge 0, cards
  with the whole titles and no pills (456); relaunch: every tab's count back from tabs.json before any page loaded, badge
  kept; a fresh install, Continue → Don't Allow: no badge, nothing asked again, cards still counted. Not tried: real
  sites (X's "(3) Home / X", Facebook, Gmail, LinkedIn on a phone, signed in), Gmail in other languages (only English
  "Inbox" is read), a page's title changing while the app is in the background (WebKit suspends it; the badge keeps
  the last), the Not now button (not tried at all), a phone where chats' notifications were allowed
  before this build (Badges is then whatever iOS gave for [.alert, .sound]: likely off; turn it on in Settings ›
  Notifications › TRIF; the "unread" step / Diagnostics say "badges off for TRIF in Settings").

- Links to other apps (11-18): Simulator only (shots 389-400, 413). Checked: tapped tel:/mailto: (no app in the
  Simulator: the note), sms: (Messages opened), maps: target=_blank (Maps, no new tab), fb-messenger: (the note), a
  trif: link (not followed, a report line), `location = 'mailto:…'` on load and every 1.5 s (one question; Cancel →
  never again on that load), `a.click()` on load (asked, Open → the note), an iframe to fb:// (nothing), WebKit's menu
  Open and Open in New Tab (the note, no tab), the chat pane: a tapped link (the note over the chat) and a script's
  maps: (“Maps” question), full screen (the note). Not tried: a phone with real apps (Facebook's m. site bouncing to
  fb://, Messenger installed), VoiceOver or a keyboard activating a link (no finger: they get the question, not an
  open), a form a script submits to another app's scheme (counts as tapped only with a finger down recently), iPad.
- The robot's tap / hold to talk / the microphone's tap (11-18): Simulator only, with `-speechfile` (shots 401-411):
  tap → list; Go to chat filled; hold → pill → strip → Send → Done · Undo; slide-away cancel; not ready → list; a
  reply waiting (409). Not tried on a phone: the 0.45 s hold vs the toolbar sliding away with the page. The first tap
  on the microphone right as the list opened was missed once (the sheet still moving).
- Open Settings (11-18): in the Simulator (26.3) openSettingsURLString opens Settings' MAIN page (Profile Downloaded
  right there: 1 tap; shots 424-425), warm and cold by `simctl openurl trif://settings` (422-423). On a phone it may
  open Apps → TRIF (then 2 back taps): the step's words cover both; Tim to say which his SE does.
- Talking and sound (11-18): Simulator only, `-speechsession` (the stand-in recording with the real session switch),
  a silent clip on 127.0.0.1 (media.sh in the batch's scratchpad): plays on after tap+stop, hold+cancel, hold+let go,
  the ✕ with the video in a tab behind, the app leaving mid-listen; left paused after a call-like interruption.
  The stall Tim saw wasn't reproduced in the Simulator (not tried with the old build); never on a phone, nor with
  AirPods, nor YouTube's own player (main-frame <video>, should work; iframes not reached).
- The never-stopping microphone (11-18): Simulator only, recordings, never a live microphone (see Gotchas for what the
  Simulator has). NOT known: whether Tim's iPhone SE (A15) has SpeechTranscriber (`isAvailable`) or only
  DictationTranscriber; the first Diagnostics "quick ask" line "talking: recognizers on this iPhone: …" says, and
  "talking: listening (<listener>)" names the one used. The model download on a phone (size, time, the note's %), a
  real call/Siri interrupting, AirPods connecting mid-listen (MicSource re-taps; untested), the record session's
  effect on a page playing sound (ducked as before), battery over a long ramble.

- Leaving cover (11-18): Simulator only (shots 383-386). Checked: icon tab B in full screen, left, the icon link for A
  (`simctl openurl`): every frame of the return (recordVideo) is the robot, then fading to A, no frame of B; with
  `-nocover` B shows in 4 frames (the problem reproduced). A real Web Clip tap (an old X icon on the SE's page 2,
  no app=1): zoom to black, the clip's shell slides out, the robot slides in, held 0.85 s while x.com drew, faded to it.
  iOS's saved picture (Library/SplashBoard, .ktx) is the robot in icon use and the page in ordinary use (TRIF view,
  launched plainly). The launch screen's picture there is black with the robot. Not tried: a phone (the Web Clip's
  shell is light grey in the Simulator, black on Tim's phone), the app switcher itself (a double HOME by the tool
  was too slow), the lock screen, iPad's several scenes, an icon tapped while a page plays sound in the background.
  iOS keeps a launch screen until a reinstall or restart: a sideloaded update should show it, else restart the phone.

- Quick ask (11-18): Simulator only, stand-in chat (shots 364-377, 381-382) and More's Simulator stand-in model
  (`/model stand-in` typed in More's box picks it; shot 372). Checked: a typed ask fills the stand-in's box and
  nothing is sent (the stand-in counts every send and whether a person made it: `window.__standinSends`,
  `__standinUntrusted()` = 0 throughout); a real tap on its Send → working → a style mod added, Undo removes it
  (a new mod) or puts the version before back (an update); a boxed mod with click → Add this mod?, or the done banner
  on another tab; More sends directly, Done · Undo; cancel and a second ask take the earlier words out; the speech
  recognizer on a recorded file (`say -v Samantha`, the default voice made silence) heard it on device (en_CA); the
  microphone revoked → the refused note, typing still works. Not tried: live hold-to-talk with the microphone (the
  Simulator would record the Mac's room: not done), the real claude.ai / chatgpt.com composers in the strip (11-18:
  the strip shows the box's text ∪ the SEND button; if their Send isn't found it shows the text only, and if no box,
  the page's foot; claude.ai's new-chat page centring its box is fine now, it's cropped by place), a phone, iPad, the
  ChatGPT pane, My computer and API engines (same panel path, untested), a quick ask on a chat already writing a
  reply (its Send is the stop button: the ask waits in the box; chat.js's maybeSent skips while a watch runs).
- The strip's settling and size (11-18): Simulator only, stand-in `?late&greet` (Claude) and `?late&octane&greet`
  (ChatGPT), recordings in shots/rec-11-18-strip (before1: the old build, the strip's content changing ~10 times in
  front of the person; after*: the pill, one slide in, then only the caret blinking: every changed frame listed with
  ffmpeg mpdecimate). Shots 428-436. Not known: whether real claude.ai settles within 8 s (else it's shown as it is),
  whether Tim's dips were the keyboard (the new Diagnostics lines say), a software keyboard on a phone in the strip
  (Simulator: the whole chat opened, 435). The request after the page's text typed in (ChatGPT
  `?octane`): fixed 11-18 (chat.js fill: the caret to the box's end, a blank line before, the box scrolled to its end;
  shot 441; Claude's stand-in attaches the page as a file, its box holds only the request, 440). Not tried on the real
  chatgpt.com.
- Tab list snap (11-18): Simulator only, 21 tabs (shots 378-380): from a page (tab 15 centred), from a chat on
  localhost over a 127.0.0.1 tab (its tab 17 centred and green; the shown tab isn't marked then), from Mods.

- Tab pictures (11-18): Simulator only (shots 356-363, local stand-in pages; 20 tabs: the app's footprint ~51 MB
  with the list open, 4 pictures read for the visible cards). Not tried: the mid-scroll wait (needs real touches),
  real sites (a page drawn but still loading for > 2.5 s, or with a long white splash: the one-colour check keeps
  the old picture), a 3× phone, iPad. The list opens at its top, not at the shown tab (as before).

- Request Desktop Website: checked in the Simulator only (11-18, shots 323-331, Safari's own for comparison 324) on
  stand-in pages. Never on real sites or a phone: Google sign-in on a desktop site (accounts.google.com isn't
  desktop unless asked, so the hop goes back to the phone's agent; the Mac Safari agent is what Safari's own desktop
  mode sends), a site that sends phones to m.<site> (its desktop choice is then m.<site>'s host: as in Safari, the
  person may need to go to www. first). The agent's Version is 26.0 (as safariSuffix), Safari's says 26.3.
- Open idea for Tim (11-18, not built): a desktop site could run that site's DESKTOP mods (as the computer does)
  instead of the phone's. It needs the desktop mods synced to the phone, and today phone sync carries only phone
  mods (PhoneSync / the twin). Now the phone's mods run unchanged in desktop mode (checked with a test mod: it ran
  in both modes).
- [+] on a phone: the address screen focuses its field, and the keyboard covers the toolbar, so the second tap needs
  the keyboard down first (the Simulator had no software keyboard); Cancel is the way then.
- Chats and tabs (11-18): checked in the Simulator only (shots 340-355, stand-in chat, localhost = tab A, 127.0.0.1 =
  tab B). Never on a phone or with real Claude/ChatGPT. Not tried: the done banner while a sheet is up (it waits under
  the sheet), two chats finishing at once (banners queue), More's panel runs (no banner: its own activity), a
  notification tap with a held mod (arrived() releases it on the tab; code path only), iPad. The badge lives on the
  tab sent from only while that tab is on the chat's site.

- Free mods' style section: checked in the Simulator 11-17 (iOS 26.3.1, shots 293-296) with a FeedBook-like test mod
  (title colour and size, page background, a loading cover the code lifts after 5 s) on feed.html and strict.html
  (style-mirror: an adopted sheet); "<id> started on …" and log/warn/error reached Diagnostics as "mod log" lines,
  and ⋯ → Copy diagnostics (a real tap) put them on the pasteboard. Never seen on a real phone. FeedBook's start and
  log lines should now be in Tim's diagnostics ("mod log"). A held free mod's version that keeps running keeps its own style (desktop's
  restyle puts the waiting change's style on it); a setting changed in the code card reloads the page (as every
  mod change does), nothing is restyled live. Log lines from a later callback name the free mod that started
  last on the page (WebKit's stacks have no sourceURL); a free mod's errors from events or timers aren't told.

- Chat offers in the Simulator (11-17, stand-in `?history`, `chatOffers` cleared, shots 300-301): opening the chat
  offered nothing for the old block; a reply handed over only its own two blocks (one skipped as installed), and
  an older message rendering after it made no late offer. Toolbar there: < > robot + Mods tabs A, page button exactly
  centred (187.5); a long press on text only selects it (no Hide bar).
- Chat offers in the Simulator (11-18, stand-in `?pasted` and `?oldchat`, `chatOffers` cleared, shots 313-322): code
  pasted into the box (a real paste, shot 314) and a pasted tile: no button, nothing offered; sent, the person's
  message's code block and pasted card: nothing, the reply's mod handed over (first skipped as installed, then
  example.test's offered, shot 319); their pasted card tapped → viewer `skipped (opened by a tap outside the
  assistant's replies)`; code pasted after the reply: no late offer; "Older chat" tapped mid-reply → done `left`, idle,
  nothing; an old chat opened cold, scrolled up: nothing (Add to TRIF under its replies).
- On the real claude.ai / chatgpt.com (signed in, can't be checked here): that Claude's reply wrapper
  ([data-is-streaming], .font-claude-response/.font-claude-message) holds its code blocks and never the person's
  message; that USER still matches (without it NOTHING is picked up now: fail closed, `held … no sent message found`);
  how Claude renders pasted code in the box and in the sent message, and its pasted-text viewer; ChatGPT has no
  streaming mark, so its replies count as live by growing between looks only; a reply that finished while the chat's
  page wasn't running (WebKit suspended it, then a reload) isn't offered (fail closed: `held … not seen arriving`;
  Add to TRIF is still there). Tim's next diagnostics should have `chat offers` lines (held/offered/skipped).

- Never run on a real phone: the local model after the freeze fix (Tim tests next: compare Runs on processor vs graphics
  chip; diagnostics lines have the numbers), real model downloads from Hugging Face, background download events.
- Logged-in Claude and ChatGPT: viewer markup, file cards, `/files/` routes, ChatGPT's logged-in markup (the "chat"
  diagnostics line says when a reply had code and nothing was picked up), project URLs and composers.
- API engines against real services: `fallbacks: "default"`, `include: reasoning.encrypted_content`; the Keychain in a
  sideloaded build.
- Exit button placement checked only on logged-out X and Instagram. Three chat pages' memory on the SE.
- Permission strings still await Tim. Long-press menu (11-18): Open in New Tab, the preview, Save to Photos (asks
  with NSPhotoLibraryAddUsageDescription, present since 11-15) checked in the Simulator only (shots 302-309); never on
  a phone, nor on real sites with long-press handlers of their own (X, Instagram, YouTube's thumbnails).
- Tim's icon report (11-17): the cause found in the Simulator is the icon's old tab gone to Google; his log can't prove
  it (icon lines went only to report.json then). If it recurs, the new `link`/`icon` lines say whether the link came
  at all. The real Web Clip path (tap → web app shell → trif://) works cold and warm in the Simulator (26.3) only.
- Safe mode's banner (mods switched off) lives in the bars, so a tab in full screen (an icon launch) doesn't show it;
  only the Mods tab lists them. Icons made before `app=1` (early 11-16) open in TRIF view: re-add them.
- Background play never tried on a real phone (YouTube, Tim's mod, AirPods, calls). Lock screen in the Simulator:
  WebKit's Now Playing shows the page's mediaSession title, artist and progress (shot 229) but no play/pause
  buttons were visible; Control Center not checked. Media inside iframes isn't replayed (main frame only).
- Home Screen icons: a 4-icon batch (outline colours, badge, no outline, custom name, a Photos-like picture) installed
  in the Simulator 11-17 by the server route, opened from an icon (list cleared, sheet said done), removed in Settings
  (all four went). "{user}'s" works only where the page shows the name plainly (GitHub, Wikipedia).
- The clip page takes several icons only on branch clip-page (49a41c1, 11-17, pushed), NOT
  deployed: until Tim deploys it, the live page lacks "trif-clip-batch" and the app hands batches over by the server on
  the phone (which failed once on Tim's iPhone, 11-16: then Files). Single icons are unchanged.
- The exit button's new spot: its taps only proven in the Simulator through the window recognizer; never on a phone.
  On the SE it slightly covers a site's top bar under the clock's right (Wikipedia's logo row); the target stops short of
  the right-hand buttons. The SE stayed light after `simctl ui appearance dark` (shots 251/252 are light).
- The chat look, logged in (can't be checked here): Claude's greeting heading (an h1/h2 with words only? its spark
  logo must stay), Claude's and ChatGPT's pill markup (data-cds card, group/thumbnail, composer-attachment span),
  upsell button words, dark mode by the page's own colours (data-trif-tone). Logged-out chatgpt.com checked (shot 241:
  its greeting sits in a footer inside a form; the instructions go in as text there, pictures-only inputs).

- Video resume (11-18): Simulator only, local stand-ins (scratchpad serve-media.js: video.html?v=a|b|c, alt.html
  (another clip at the same address), live.html (HLS without an end), seek0.html (seeks to 0 after a seek once),
  blob.html, frame.html; ffmpeg testsrc + anullsrc, silent). Checked: play 0:37→reload resumes ~0:41 playing; paused
  0:30 stays paused 0:30; another clip, live: no seek; the seek-to-0 site put back once; the page's own
  location.reload; blob src; a same-origin iframe's video; full screen; Request Desktop and Mobile Website; a
  same-site mod changed while paused (reload, resumed paused) and while playing (no reload); other sites' mods (no
  reload); the robot held to talk (paused and played on); relaunch (tab-videos.json); the shown tab's process killed;
  tab A playing behind + app backgrounded, its process killed (`kill -9`; find it by making the page hold 90 MB and
  taking the WebContent process that grew): resumed at the time it had reached; Tap for sound (`-resumemuted`, a
  real tap). Shots 437-439, 442. NOT tried: real YouTube (its player may move the time after 6 s or ignore a seek
  before its own start; the public t= fallback isn't built), Picture in Picture, AirPods, a phone, the Now Playing
  position (the app doesn't track one: WebKit's own), iPad. The 14.5 s hang Tim saw isn't explained: the rebuild
  measured 5–13 ms a change in the Simulator (32 mods, 587 KB, 7 tabs) before, ~4–5 ms now and 20 quick changes in ~56
  ms; the mark moved, so his next diagnostics say what really hangs.
- Speech (Tim's phone 11-18: "SpeechTranscriber en_US: supported; DictationTranscriber en_US: supported →
  SFSpeechRecognizer"): "supported" = Apple's model not on the phone yet, so the old recognizer is right until it's in.
  The download starts at a press (choose(download: true)); a press while the list's own look was still running was
  DROPPED before 11-18 (`choosing` busy): now `downloadAfter` looks again. Look for "talking: getting the speech model"
  then "the speech model is on this iPhone"; the next look (that run or the next launch) says "→ SpeechTranscriber".

- Mods tab flash (11-18): Simulator only, SE, stand-in pages on the Mac's LAN address (a site with no other mods;
  the batch's scratchpad flashtest/server.js: plain.html, blocker.html which takes window.__trifRan first so a free
  mod never marks its start) and three imported test mods (free, boxed, style). A recorder in the Mods page (modsjs:
  every frame, each switch's shown state against the last tap's, any "let it start" line) over 29 JS taps, 5 real
  taps (each mod on after safe mode switched them off, a tier Off then On), quick re-taps (0.3 s, 0.6 s): 0 error
  frames, 0 switches showing their old state; recordVideo frames the same (444). The OLD build on the same harness:
  the error in 5 frames (443, as Tim's). blocker.html: "Starting on this page" then the error 2.2 s later. Not on a
  phone or x.com: a page that finishes very late (x.com may keep loading) keeps the row "starting" until it finishes.
- Popup back to its opener (11-18): Simulator only, signin.html / signin-popup.html (from branch android, in
  mobile/shared/pages; serve.js on 8377 and 8378): real taps, the popup inserted before a 127.0.0.1 tab; closing went
  back to signin.html, "Signed in as Test Person" (445); the old code showed the next tab. Not tried: a popup closing
  while another tab is shown, real Google sign-in.

## Gotchas

- Browser tests here: nvm's node 20 (first on PATH) has no global WebSocket, which tests/cdp-page needs ("WebSocket is
  not defined"): run them with `/usr/local/bin/node` (22), as CI's node 22. node --test runs EVERY .js under a test/
  folder as a test file (style-demo.js failed CI for a day: it's style-demo.mod now). CI's per-file limit
  (package.json --test-timeout) counts the browser lock's waits: the browser files run one at a time (tests/cdp-page's
  lock), chat.test.js alone is ~170 s; hence 600000 there and LOCK_WAIT + n on each browser test (11-18).
- `-speechsession` (dev): with `-speechfile`, the real audio session switch too (to try what it does to pages'
  sound). In the Simulator the session's .record activation needed no microphone question.
- Speech in the Simulator (26.3.1, iPhone SE, en_CA, 11-18): `SpeechTranscriber.isAvailable` is false;
  DictationTranscriber's model said `supported`, then installed in 0.3 s on the first press. SFSpeechRecognizer on
  device, a buffer request with pauses of 15–20 s: no isFinal and no new task, but a result with
  `speechRecognitionMetadata` after each pause, its later results starting over with only the newest words (hence
  SpeechText.segmentEnded); no punctuation in those. DictationTranscriber: one growing volatile result through the
  pauses (finals now and then on long speech), one final at the stop.

- Other-app links in the Simulator (26.3): tel: and mailto: have no app (UIApplication.open says false), sms: opens
  Messages, maps: Maps (both leave a "◀ TRIF" back link; "◀ TRIF Probe" before 11-18). WebKit asks the policy for target=_blank BEFORE
  createWebViewWith (targetFrame nil): cancelled there, no window is asked for. A script's `a.click()` arrives as
  .linkActivated, hence the finger check (TouchClock).
- chat.js: a focus() from the app's JS brought the Simulator's keyboard bar up (shot 402) even with no tap; blur in the
  same turn shows none.

- iOS's pictures of the app (11-18): `<data container>/Library/SplashBoard/Snapshots/sceneID:…/*.ktx` (the newest is
  the app switcher's), the launch screen's under `… - {DEFAULT GROUP}/`; `sips -s format png x.ktx --out x.png` reads
  them. A warm return by an icon (Simulator 26.3): onOpenURL (openLink) runs BEFORE sceneWillEnterForeground, then
  didBecomeActive ~0.43 s later; UIKit's openURLContexts after that ("already taken").

- SwiftUI's `.clipped()` hides but doesn't stop touches (11-18, the hit step): the chat's web view, clipped to the
  strip, still took touches over the whole tab, and its top bar's segmented switch (a UIKit control) took them over
  the address bar. Hence ChatWebView's hitTest cut-off and `.allowsHitTesting(!pane.strip)` on the chat's top bar.
  The hit step returns the page's web view for SwiftUI areas (the toolbar, the strip's header): SwiftUI's own
  gestures still get those taps.
- Terminating the app (a relaunch) with mods running trips safe mode on that site ("The app quit while mods were
  running…"); going to Settings first didn't avoid it.
- iOS's Speech Recognition question shows its own fixed "Speech data from this app will be sent to Apple…" above
  TRIF's words, even though TRIF asks for on-device recognition only. `simctl privacy` has no speech service: tap Allow.

- Desktop mode (WebKit, Simulator 26.3, 11-18): WebKit's desktop user agent is "Mozilla/5.0 (Macintosh; …) … (KHTML,
  like Gecko) " + the configuration's applicationNameForUserAgent, i.e. ours, "Version/26.0 Mobile/15E148
  Safari/604.1" (sites read Mobile as a phone); the public fix is the web view's customUserAgent, set inside the
  navigation-action policy call (before its answer, so the main request already carries it). A page restored from
  the back/forward cache lives in its old web content process, which keeps the agent it had (back from 127.0.0.1 to
  a desktop localhost page said iPhone, in navigator and its fetches): `checkAgent` reads navigator.userAgent after
  commit and, if it's the other mode's, sets the agent to the other value and back (WebKit skips an unchanged
  value) and reloads, at most every 10 s a tab. A width=device-width page stays at the phone's width in desktop
  mode, in Safari too (checked side by side); a page without that viewport is 980 wide either way. Pinch zoom works
  on a desktop page (0.38 → 1.15).

- WebKit (Mac, 11-17): a user script's stack says `user-script:N` (`//# sourceURL` ignored); its errors from later
  callbacks reach window's error event as "Script error." with no stack. At document start, user scripts in
  different content worlds don't start in a fixed order (TRIF's world was after the page's about 1 run in 4): the
  free runtime holds its lines until freeRelay answers its hello. A CustomEvent's string `detail` crosses worlds.

- `os_proc_available_memory()` is 0 in the Simulator ("0 MB left for the app" in its lines): real numbers on a phone only.
- Task.detached(priority: .background) throttles disk reads hard (~35 MB/s in the Simulator, 80 s for a 3 GB file);
  .utility read it at ~240 MB/s. FileHandle.read(upToCount:) returns autoreleased Data: in a loop off the main thread
  without autoreleasepool nothing is freed until the task ends.
- WebKit loads no media for a page that isn't in a window (a tab behind reloaded: readyState 0 until shown).
- Simulator screenshots lag ~2 s, so a 2 s note ("Copied.") is usually gone from them: poll `{"status": 1}` instead.

- scenePhase passes through .inactive on the way IN from the background too: before 11-17 the tab shot logged "the app
  left the front" then (now "the app is coming to the front"). Report.log (report.json) isn't in the diagnostics Tim
  sends: anything needed to read his reports goes to Diagnostics.shared.log.

- iOS profiles (Simulator 26.3, 11-17): same top-level PayloadIdentifier = replace (all its clips remade, new
  SavedIdentifiers); a clip PayloadIdentifier/UUID shared across profiles = both icons stay (no dedupe, no error).
  Installed profiles: `…/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/
  ConfigurationProfiles` (PayloadManifest.plist, profile-*.stub). Install by hand: serve the .mobileconfig on
  127.0.0.1, `simctl openurl` it, Allow (312, 339), Close, launch Settings, Profile Downloaded (187, 295), Install ×3.
- In full screen, taps near the top never reached a SwiftUI Button or a UIKit UIControl (no touchDown at all), though
  `window.hitTest` found it; the page under it got them. A UITapGestureRecognizer on the window does get them
  (ExitTaps). The status bar eats its own touches: SE 0–20, 17 Pro 0–54 (statusBarManager's height).
- The clip page's check, as the last batches ran it: write the page with its script inline (clip-page's CLIP and CLIP_JS),
  load it in headless Chrome by CDP with the profile base64url after the #, read which of #ready/#none/#bad shows.

- Simulator runtime: iOS 26.3.1 (back 11-17 after going missing that afternoon; Xcode's SDK is 26.2, which builds
  and runs on it). If `simctl runtime list` is ever empty again, ask Tim before the ~8 GB `xcodebuild
  -downloadPlatform iOS`; actool needs a runtime even for a device build. Normal builds (`-scheme`, both SDKs) work.
- The chat stand-in reopens the last conversation without its query (`/chat/<id>`, so no `?history`): send
  `{"newchat": 1}` to load the chat home with the flags. Clearing `chatOffers` (PlistBuddy, app stopped) makes a
  chat-offers check test the page side alone.

- Recording what a transition shows: `simctl io <dev> recordVideo --codec=h264 --force f.mp4` (in the background;
  stop with `pkill -INT -f recordVideo`), then ffmpeg `select='between(t,a,b)'`, `tile`, `-fps_mode passthrough`: it
  writes a frame only on a change, so every frame is there. iOS's app snapshot vs the live app: open the same link
  with the app in front (no snapshot) to compare. Icon test without a real icon: `simctl openurl` of
  `trif://open?url=<site>&app=1` (a loopback site on another host name than the tab left in front).
- `simctl openurl` cuts URLs at about 2 KB (UIApplication.open doesn't).
- The app opening its own trif:// with UIApplication.open gets iOS's "Open in …?" prompt (and it can linger over a
  later screen): in-app checks call the handler (ContentView.openForCheck); `simctl openurl` has no prompt.
- iOS 26 has `x-safari-https://` but no `x-safari-http://`; Chrome as default browser needs the Files route.
- A Web Clip to a custom scheme needs FullScreen:true or it opens Safari and asks; TargetApplicationBundleIdentifier is
  ignored without MDM.
- wrangler's keep_names adds `__name()` into `Function.toString()`: page code there must be source strings; Workers have no `new Function`.
- `obscuredContentInsets` doesn't move contentOffset: set contentInset too and compensate (BarState.shift).
- The status bar strip gets no touches; a two-finger long press measures only the centre (a pinch passes): check each finger.
- The Simulator's Keychain needs entitlements (-34018 unsigned). llama.cpp's XCFramework has no Simulator slice.
- Background URLSession: a swiped-away app's downloads are cancelled with a reason, not an error: handle it; resumed
  downloads answer 206.
- llama.cpp's threads inherit the starting thread's QoS; 4 threads at user-initiated froze the SE. Free the model before
  exit on a Mac (Metal asserts otherwise).
- SE timings (Tim, 11-16, before the fix): model load ~7 s, prompt ~100–140 tok/s, writing 4–11 tok/s, a request 33–63 s;
  memory warnings during every request at ~1.85–1.96 GB left; WebKit pages get ended under that pressure.
- ChatGPT logged out: picture-only file inputs (a text file → "not a supported image"), `/uc/` conversations,
  li[data-message-role] messages, pauses mid-reply with no stop button.
- Swift type-checker timeouts in long SwiftUI modifier chains: split them (columnBase / columnLinks).
- Simulator Home Screen icon style: long-press empty space, then Edit at (344, 22) pt (y 15 misses: status strip),
  Customize; Default / Dark / Clear / Tinted, and Tinted's Light / Dark row at y 618. Screenshots lag ~2 s behind taps.
  The SE is left in Tinted · Light (as found). A reinstall refreshes the icon (no cache problem seen).
- The icon's light PNG drops alpha: ~3k seam pixels between rim and face render partly transparent in Chrome; their
  colour is the blend, so dropping alpha is right (don't composite onto black).
- `requestMediaPlaybackState` is the web process's, not the page's: a same-site tab that never played says
  "playing", and so does media WebKit paused itself (app in the background) or a page paused during that.
  Browser.playing confirms with the page (an unmuted <video>/<audio> playing, or an iframe). `.playing` alone lies.
- WebKit pauses an inline video with sound as the app goes to the background or the phone locks (pause event a few
  ms before didEnterBackground, then visibilitychange), and resumes it on return; Safari the same. A play() then
  (from the page or the app) is allowed and keeps going; <audio> isn't paused at all. Without our session category
  sound still went on (WebKit sets its own); UIBackgroundModes audio is the part that matters.
- Chrome's `new ClipboardEvent('paste', {clipboardData})` drops the clipboardData: tests make an Event and
  defineProperty its clipboardData (mobile/test/chat.test.js pasteInto). The stand-in's `?octane` pause used to skip a
  reply step (a crash when that step made the element): fixed 11-18.
- Simulator Paste: long-press the empty box, then Paste in the callout (`simctl pbcopy` first); inside a code block the
  long press only shows the loupe.
- zsh doesn't split `$FILES`: use an array for commit-by-path lists. Never `git add -N .` (it picks up shots/).
- Simulator toggles (SwiftUI Toggle) often ignore a quick tool tap: tap with duration 0.15. After `simctl ui
  appearance dark` a running app sometimes stays light (11-16): relaunch, or darken the stand-in page itself (panejs
  setting --bg/--fg) to check TRIF's tone logic.
- chat.js look: chatgpt.com's mobile page wraps its message box in display:contents boxes (zero size): composerRect
  takes the outermost ancestor with a size that holds no messages and no heading. Headings in a footer or form are
  allowed (ChatGPT's is), not ones with a link, logo or the service's name in them.
