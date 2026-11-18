# iPhone app (TrifProbe): notes for the next agent

Branch `ios-poc`, worktree `~/WebMods-worktrees/ios-poc`. The app is `mobile/browser-probe` (Xcode project
`TrifProbe.xcodeproj`, bundle `com.timsrobot.trifprobe.browser`, display name "TRIF Probe"). mobile/README.md has the
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
  `mobile/browser-probe/shots/` (not committed), numbered on from the last (413 now): `NNN-se-what.png`.
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
  (the strip's ✕), quickexpand; speech (permissions, on-device or not), speechfile ("/path.wav": the recognizer on a
  recorded file, SFSpeechURLRecognitionRequest on device), micpress / micrelease; tabsfocus (the card the tab list last
  opened at, and the shown tab),
  playing (each tab: WebKit's state,
  the page's, kept or not; the audio session), tabjs + tab (JS in tab n's page, shown or not)…
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
  inputs), `?cm` (code as .cm-editor/.cm-line), `?slowload`, `?pasted` (a paste of several lines goes into the box as a
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
  zip `Payload/TrifProbe.app` to `~/Downloads/TrifProbe.ipa`, copy `TrifProbe.app.dSYM` to ~/Downloads, copy the .ipa to
  `~/Library/Mobile Documents/com~apple~CloudDocs/TRIF/TrifProbe.ipa`, report `dwarfdump --uuid`. Tim sideloads it with iloader.
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
- Links to other apps (AppLinks.swift's decisions) on the Mac: `node --test mobile/test/applinks.test.js` (swiftc with
  mobile/test/applinks-check/main.swift). Simulator pages for it: any small node server with tel:/mailto:/sms:/maps:/
  fb-messenger: links, a target=_blank one, a trif: one, `location = 'mailto:…'` on load and every 1.5 s, an
  `a.click()` on load, an iframe to fb:// (the batch's own lived in the scratchpad).
- What a chat may offer (ChatOffers.swift) on the Mac: `node --test mobile/test/chatoffers.test.js` (swiftc with
  mobile/test/chatoffers-check/main.swift; ~20 s).
- Media checks: a range-serving static server is needed (WebKit asks for media in ranges; `python -m http.server`
  won't do). Make a silent clip with ffmpeg (`testsrc` + `anullsrc`, so nothing reaches the Mac's speakers: the
  Simulator plays to them) and serve it with a few lines of node; play by `pagejs` (`await v.play()` works: the app's
  JS counts as a gesture). App to the background: `simctl launch <dev> com.apple.Preferences`; back: `simctl launch`
  the app; lock: the iOS Simulator tool's LOCK button (HOME wakes / unlocks). Steps still answer in the background
  while something plays.
- Dev launch flags: `-speechfile <wav>` (a recording stands in for the microphone in every hold or tap of it: fed to the
  same live request at once; `say -v Samantha -o x.wav --data-format=LEI16@16000 "…"`), `-talksilence <s>` (the tapped
  microphone's silence stop, 4 s; longer to try its taps), `-chathome <url>`, `-apibase <loopback>`, `-modelbase <loopback>`, `-memorygb 4` (a 4 GB phone's
  choices), `-clipbase <url>`, `-noserver`, `-noopen` (Home Screen hand-off), `-exitrobot`, `-hang100` (log 100 ms hangs),
  `-nobarshift`, `-stripheight <pt>` (the quick ask's strip, 270), `-pageletter`, `-tabsfirst` (tabs before Mods, as tried on 11-17), `-nocover` (no leaving cover, as before 11-18, to compare), `-exitbelow` (the exit button's old
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
- AppLinks.swift (Tim, 11-18; no UI in its top half, built for the Mac too): `AppLinks.kind` (web / stay (about, blob,
  data, trifprobe) / never (javascript, file) / own (trif, trifpanel, Info.plist's schemes) / other), `decide` (tapped →
  open; else ask once a load, one at a time, main frame, shown, app in front; else drop), `isTap`, `appName` (Apple's
  apps only), the words. `TouchClock` + `TouchWatch` (a do-nothing recognizer on every tab's, chat's and More's web
  view: when the finger was last on a page) and the long-press menu's open/close. Browser: `appLink(...)` (open /
  question by UIAlertController on the top controller / Diagnostics "app link" lines with the scheme only, a drop's line
  once a load), `askedLoads` cleared by each commit (`appLinkNewLoad`, the pane's didCommit too), `handToIOS`
  (UIApplication.open; false → the note). Called from decidePolicy (after mod links and the two-finger guard),
  createWebViewWith (no tab), Open in New Tab, the preview's commit, ClaudePane's decidePolicy/createWebViewWith,
  PanelChat's (taps only, never asks). The note shows over the chat too (ContentView.page's bottom overlay).
- QuickAsk.swift (Tim, 11-18): `QuickAsk` (request, service, site, key, state waitingSend/working/done/replied/card/
  undone/failed, `applied` for Undo; `lookOnly`), `SpeechInput.shared` (hold-to-talk: SFSpeechRecognizer,
  requiresOnDeviceRecognition, AVAudioEngine tap; the session .record/.measurement while held, then back to
  .playback/.moviePlayback), `QuickAskBox` (the box at the top of ChatListView), `QuickPill` (above the toolbar, in
  ContentView.notes), `QuickStripHeader`, `QuickStrip.height`. ClaudePane: `quick`, `strip`, `quickAsk` (Claude/
  ChatGPT: showFor + prepare/fillContext + the request as text + chat.js `armSend`; More: `quickMore` →
  PanelChat.quickSend), `quickDeliver` (offerFromChat(hold: true), look-only → Browser.addMod(quiet:), the rest
  offerHeld or the done banner), `quickUndo` (ModStore.undoAdd: the version before, or removed; not to Recently
  deleted), `cancelStrip` (chat.js `takeText`), `expandStrip`, `quickOpen`. handleDone's quick branch; "sent" moves
  waitingSend → working. ContentView: `ChatLayer` (the chat laid out full size; in strip mode clipped to its foot,
  sliding: `stripLayer`/`stripUp`), `ChatWebView.stripTop` (touches above the strip go to the tab). PanelChat:
  `quickSend` (TRIF's own panel: #input, #composer.requestSubmit(); waits for #site.title == the tab's address;
  `quickPending` marks the next run; refused if startRun never takes it), `Run.quick`, `offerRun` → `quickDone`.
- ChatOffers.swift (no UI; built for the Mac too): `ChatOfferMemory` (every code a chat offered, by a hash of the
  normalised code, with added/declined/dismissed; UserDefaults `chatOffers`, last 500, global), `ChatOfferJudge.skip`
  (installed as it is, queued, offered before, an installed mod's History, Recently deleted). Diagnostics kind
  `chat offers`: one line per hand-over (path auto/late/viewer/panel/computer, ids offered and skipped with why) and
  declined/dismissed.
- Tabs.swift: Tab, tab pictures (TabShots, PrivatePages), TabsView/TabCard. History.swift: history. Import.swift: importing mod files. FolderWatch.swift: the watched
  iCloud folder and `trif://add` links. WebClip.swift: Home Screen icons (the sheet's look and name: IconLook,
  WebClipMaker.compose; profile hand-off; IconHandoffSteps, the steps shared with the list), `trif://open`.
  IconQueue.swift: the list of icons waiting (QueuedIcon, IconQueue, the batch profile, IconQueueView).
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
- LeavingCover.swift (Tim, 11-18): the black cover with the robot as the app leaves in icon use (`reason`), a
  UIWindow at .alert + 1 put up in SceneDelegate.sceneDidEnterBackground (Safety.swift), taken off after
  sceneDidBecomeActive once PendingLink.url is taken and the shown tab is `drawn` (cap 0.8 s), 0.2 s fade.
  `iconLinkCame` from PendingLink.came and ContentView.openLinkNow. Its picture: Assets.xcassets/CoverRobot.imageset
  (`make-icon.js --cover`: robot-shaded.svg at 88 pt, @2x/@3x) on LaunchBlack.colorset, also Info.plist's UILaunchScreen
  (INFOPLIST_KEY_UILaunchScreen_Generation = NO in the pbxproj and make-project.rb).
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
- Full screen: per tab, remembered; the two-finger hold (0.6 s, each finger still) toggles it either way at once, with
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
  kind "cover": one line each time it's put up, with why. Robot size: COVER_PT 88 in make-icon.js (the 128 box; the
  robot ~70 pt), awaiting Tim's view (shots 383, 384).
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
  an ✕ beside it, "Listening, tap to stop") until the next tap (asked), the ✕ (nothing), 4 s with no new words (8 s
  before any; asked), 60 s (asked), the list closed or the app sent to the background (nothing). Longer is a hold, as
  before; slid 90 pt away and let go: nothing. SpeechInput: `tapMode`, `keepListening`, `cancel(why:)`, `ready`.
- The full chat opens with no keyboard (Tim, 11-18: "the keyboard flies up and it's disorienting"): chat.js fill never
  leaves the box focused: each paste/insert is `inBox` (focus with preventScroll, put, blur in the same turn; a box the
  person was already in keeps its focus). The strip too. Checked: Go to chat on the Claude and ChatGPT (`?octane`)
  stand-ins, the strip, a reply waiting: activeElement body, scrollY 0, a recording's frames show no keyboard bar
  (before: the Simulator's keyboard bar came up, shot 402).
- Panels and dialogs that can outgrow their space scroll. Short release notes. Wording changes only where Tim names them.

## Open and unverified

- Links to other apps (11-18): Simulator only (shots 389-400, 413). Checked: tapped tel:/mailto: (no app in the
  Simulator: the note), sms: (Messages opened), maps: target=_blank (Maps, no new tab), fb-messenger: (the note), a
  trif: link (not followed, a report line), `location = 'mailto:…'` on load and every 1.5 s (one question; Cancel →
  never again on that load), `a.click()` on load (asked, Open → the note), an iframe to fb:// (nothing), WebKit's menu
  Open and Open in New Tab (the note, no tab), the chat pane: a tapped link (the note over the chat) and a script's
  maps: (“Maps” question), full screen (the note). Not tried: a phone with real apps (Facebook's m. site bouncing to
  fb://, Messenger installed), VoiceOver or a keyboard activating a link (no finger: they get the question, not an
  open), a form a script submits to another app's scheme (counts as tapped only with a finger down recently), iPad.
- The robot's tap / hold to talk / the microphone's tap (11-18): Simulator only, with `-speechfile` (shots 401-411):
  tap → list; Go to chat filled; hold → pill → strip → Send → Done · Undo; slide-away cancel; not ready → list; the
  microphone's tap (stop square, ✕, the silence stop, the list closed, the app left), its hold and slide-away; a reply
  waiting (409). Never with a live microphone or on a phone: live speech may end itself (isFinal) during a long tap;
  the 0.45 s hold vs the toolbar sliding away with the page. The first tap on the microphone right as the list opened
  was missed once (the sheet still moving).

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
  Simulator would record the Mac's room: not done), the real claude.ai / chatgpt.com composers in the strip (their
  box is taller with tiles; `-stripheight` to tune; claude.ai's new-chat page may centre its box, then the strip
  shows the page's middle-bottom), the keyboard coming up in the strip (a tap into their box), a phone, iPad, the
  ChatGPT pane, My computer and API engines (same panel path, untested), a quick ask on a chat already writing a
  reply (its Send is the stop button: the ask waits in the box; chat.js's maybeSent skips while a watch runs).
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

## Gotchas

- Other-app links in the Simulator (26.3): tel: and mailto: have no app (UIApplication.open says false), sms: opens
  Messages, maps: Maps (both leave a "◀ TRIF Probe" back link). WebKit asks the policy for target=_blank BEFORE
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
