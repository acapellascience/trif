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
  `mobile/browser-probe/shots/` (not committed), numbered on from the last (277 now): `NNN-se-what.png`.
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
  panego, offer/cancelOffer/addOffer, status, fullscreen, resethint, memwarn, bars, tabhosts, openurl, toolbar, approve,
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
  exitbutton (where full screen's exit button and its taps are),
  playing (each tab: WebKit's state,
  the page's, kept or not; the audio session), tabjs + tab (JS in tab n's page, shown or not)…
  Real touches: the iOS Simulator tool (tap, swipe, touch2_path for the two-finger hold). Screenshots: `simctl io <dev> screenshot`.
- Logs: `Library/Application Support/report.json` (kinds: claude, panel, mods, icon, fullscreen…) and `diagnostics.json`
  (kinds: hang, local model, chats, chat, chat files, memory…) in the app's data container.
- Stand-in chat (where Claude/ChatGPT can't be signed in): `node mobile/serve.js` (8377), launch with
  `-chathome http://localhost:8377/chat.html` (`?greet`: an empty-state heading and an Upgrade plan button, for TRIF's
  greeting and upsell hiding). A saved project (`chatProject.Claude` in the app's prefs plist) sends the chat to
  /project/… instead and drops the query: delete it with PlistBuddy (`Delete :chatProject.Claude`) while the app is stopped. Message words steer it: "two", "no mod", "file", "file and block",
  "viewer", "wait N". Query flags: `?gpt` (/c/ addresses), `?slow`, `?nostop`, `?draft`, `?gptpaste`, `?viewerroute`,
  `?octane` (ChatGPT's newer mobile page: li[data-message-role], data-message-complete, a 3 s pause, picture-only
  inputs), `?cm` (code as .cm-editor/.cm-line), `?slowload`. `/project/<id>` serves it as a project page.
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
- Generated files: `node mobile/prepare.js` (and `--check`, run by mobile/test/smoke.js): sandbox-runtime.js,
  browser-checks.json, mods.js, panel-kit.js, mod-guide.txt, page-bridge.js, RobotShape.swift, and the side panel folder
  `shared/gen/panel`. Never edit those by hand.
- Browser tests (headless Chrome, muted): `TRIF_BROWSER_TESTS=1 TRIF_E2E_CHROME="/Users/tim/WebMods/tests/e2e/.browsers/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node --test mobile/test/chat.test.js`
  (6 tests: fill, send, watch, pickup, viewers, ChatGPT's new page). One browser suite at a time; small payloads.
- Media checks: a range-serving static server is needed (WebKit asks for media in ranges; `python -m http.server`
  won't do). Make a silent clip with ffmpeg (`testsrc` + `anullsrc`, so nothing reaches the Mac's speakers: the
  Simulator plays to them) and serve it with a few lines of node; play by `pagejs` (`await v.play()` works: the app's
  JS counts as a gesture). App to the background: `simctl launch <dev> com.apple.Preferences`; back: `simctl launch`
  the app; lock: the iOS Simulator tool's LOCK button (HOME wakes / unlocks). Steps still answer in the background
  while something plays.
- Dev launch flags: `-chathome <url>`, `-apibase <loopback>`, `-modelbase <loopback>`, `-memorygb 4` (a 4 GB phone's
  choices), `-clipbase <url>`, `-noserver`, `-noopen` (Home Screen hand-off), `-exitrobot`, `-hang100` (log 100 ms hangs),
  `-nobarshift`, `-pageletter`, `-modsfirst` (the toolbar's order before 11-17), `-exitbelow` (the exit button's old
  spot), `-exity <pt>`, `-noaudiosession` (iOS's default session), `-nobgresume` (leave WebKit's pause), `-publicflush` (the public cookie flush), `-bare` (no scripts in pages), `-go <url>`,
  `-open <url>`, `-import <path>`, `-autorun …`, `-shottest …`, `-linkhost 127.0.0.1:<port>` (the phone link pairs there,
  not over Bonjour: a helper's store.js + server.js on loopback in a temp HOME; `simctl openurl` the code's text).

## Map

- TrifProbeApp.swift: the app's views (toolbar, bars, sheets, the ⋯ menu at the address bar's left (moreMenu), full
  screen note and exit button), `Model`, dev steps, BarState.
- Browser.swift: tabs' web views, navigation, mod offers (Add this mod?), hide/point, outline and chat context
  (pageForChat, feedbackForChat), screenshots, full screen state, ModDownloads (.js downloads to Add this mod?).
- Tabs.swift: Tab, tab pictures. History.swift: history. Import.swift: importing mod files. FolderWatch.swift: the watched
  iCloud folder and `trif://add` links. WebClip.swift: Home Screen icons (the sheet's look and name: IconLook,
  WebClipMaker.compose; profile hand-off; IconHandoffSteps, the steps shared with the list), `trif://open`.
  IconQueue.swift: the list of icons waiting (QueuedIcon, IconQueue, the batch profile, IconQueueView).
- Mods.swift: ModStore (installed mods, holds, user scripts), ModReader (mods.js in JavaScriptCore). ModsPanel.swift + Web/mods.html,
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
  the tab refreshes on PhoneSyncModel's changes.
  Test on the Mac: `node --test mobile/test/phonelink.test.js` (swiftc builds the four files with
  mobile/test/phonelink-check/main.swift; a stand-in computer from the phone-link worktree's helper/lib/phonelink
  and tests/, or TRIF_PHONE_LINK_LIB; 8 tests, about a minute; `check syncunit`: PhoneSync against a scripted computer;
  the last test: PhoneSync over the real link against the stand-in computer's sync session (`check remote`'s stdin
  `pset <id> <JSON>`, `pdel`, `files`, `sync`; a store in memory that holds what has `fetch(`)). The last one runs the real Store, Server, Runs and Remote with
  the stand-in agent (phone-link's `tests/phone-link-computer.js`, which is also the Simulator's computer: `node
  tests/phone-link-computer.js --seconds 600`, its first line `{port, qr}`, then stdin `go <word>`, `kept`, `remove`,
  `pair`, `quit`, and for sync `twin`, `write <rel> <JSON string>`, `delete <rel>`, `nudge`, `synced`, `held`;
  launch the app with `-linkhost 127.0.0.1:<port>`, pair with `simctl openurl` of its qr. Driving it from a shell:
  `mkfifo f; tail -f f | node tests/phone-link-computer.js --seconds 900 > log`, then `echo twin > f`. Its first
  look at held.js is at start, so what a sync brings later is judged).
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
  SHIPPED: back, forward, chat, [page / +] (centre, 4th of 7, exactly centred: SE 187.5, 17 Pro 201), tabs, Mods, A.
  BEFORE: back, forward, chat, [page / +], Mods, tabs, A. One line either way: `ContentView.tabsBeforeMods` (or launch
  with `-modsfirst`). (A first try put the tabs in the centre and the page where the tabs were: Tim said wrong, the swap
  he meant was tabs and Mods.)
- Full screen's exit button (Tim, 11-17, "can we move it up?"; glyph kept): beside the clock at the foot of the status
  bar: SE right of the clock (circle centre 250, 18), Dynamic Island phones between the clock and the island (17 Pro:
  117, 52). Its taps go to a window-level recognizer (ExitTaps), 40 × 44 from the bar's foot down.
- Add this mod? (Tim, 11-17, a stronger out-of-site warning approved): a coral "It runs on another site / other sites /
  every site" box first when the mod runs beyond the site it came from (the chat's site or the page it was pasted on;
  files and codes have none), and the approval card's findings ("TRIF found that this mod:", "Together, it …") above
  the buttons.
- The chat pages read as TRIF (Tim, 11-16): greeting with the robot in the service's greeting's place, pills "From
  TRIF: …" with the robot, upsell buttons hidden; never their branding, Log in, terms or safety lines. Cosmetic only.
- Panels and dialogs that can outgrow their space scroll. Short release notes. Wording changes only where Tim names them.

## Open and unverified

- Never run on a real phone: the local model after the freeze fix (Tim tests next: compare Runs on processor vs graphics
  chip; diagnostics lines have the numbers), real model downloads from Hugging Face, background download events.
- Logged-in Claude and ChatGPT: viewer markup, file cards, `/files/` routes, ChatGPT's logged-in markup (the "chat"
  diagnostics line says when a reply had code and nothing was picked up), project URLs and composers.
- API engines against real services: `fallbacks: "default"`, `include: reasoning.encrypted_content`; the Keychain in a
  sideloaded build.
- Exit button placement checked only on logged-out X and Instagram. Three chat pages' memory on the SE.
- Permission strings still await Tim.
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
- zsh doesn't split `$FILES`: use an array for commit-by-path lists. Never `git add -N .` (it picks up shots/).
- Simulator toggles (SwiftUI Toggle) often ignore a quick tool tap: tap with duration 0.15. After `simctl ui
  appearance dark` a running app sometimes stays light (11-16): relaunch, or darken the stand-in page itself (panejs
  setting --bg/--fg) to check TRIF's tone logic.
- chat.js look: chatgpt.com's mobile page wraps its message box in display:contents boxes (zero size): composerRect
  takes the outermost ancestor with a size that holds no messages and no heading. Headings in a footer or form are
  allowed (ChatGPT's is), not ones with a link, logo or the service's name in them.
