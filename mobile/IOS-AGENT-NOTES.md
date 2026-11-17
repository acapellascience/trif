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
  `mobile/browser-probe/shots/` (not committed), numbered on from the last (229 now): `NNN-se-what.png`.
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
  view (site, full screen, covers), iconcheck ("https://…/": a Home Screen icon from 11 in-app states, PASS/FAIL lines;
  regression check for the icon → full screen rule; cold launch / background still by `simctl openurl` + `view`),
  playcheck ("http://…": a page with a <video>/<audio>; ~75 s of PASS/FAIL: a playing background tab is kept past
  20 s and a memory warning, let go once paused; a same-page quiet tab is let go), playing (each tab: WebKit's state,
  the page's, kept or not; the audio session), tabjs + tab (JS in tab n's page, shown or not)…
  Real touches: the iOS Simulator tool (tap, swipe, touch2_path for the two-finger hold). Screenshots: `simctl io <dev> screenshot`.
- Logs: `Library/Application Support/report.json` (kinds: claude, panel, mods, icon, fullscreen…) and `diagnostics.json`
  (kinds: hang, local model, chats, chat, chat files, memory…) in the app's data container.
- Stand-in chat (where Claude/ChatGPT can't be signed in): `node mobile/serve.js` (8377), launch with
  `-chathome http://localhost:8377/chat.html`. Message words steer it: "two", "no mod", "file", "file and block",
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
  `-nobarshift`, `-pageletter`, `-noaudiosession` (iOS's default session), `-nobgresume` (leave WebKit's pause), `-publicflush` (the public cookie flush), `-bare` (no scripts in pages), `-go <url>`,
  `-open <url>`, `-import <path>`, `-autorun …`, `-shottest …`.

## Map

- TrifProbeApp.swift: the app's views (toolbar, bars, sheets, ⋯ menu, full screen note and exit button), `Model`, dev steps, BarState.
- Browser.swift: tabs' web views, navigation, mod offers (Add this mod?), hide/point, outline and chat context
  (pageForChat, feedbackForChat), screenshots, full screen state, ModDownloads (.js downloads to Add this mod?).
- Tabs.swift: Tab, tab pictures. History.swift: history. Import.swift: importing mod files. FolderWatch.swift: the watched
  iCloud folder and `trif://add` links. WebClip.swift: Home Screen icons (profile hand-off), `trif://open`.
- Mods.swift: ModStore (installed mods, holds, user scripts), ModReader (mods.js in JavaScriptCore). ModsPanel.swift + Web/mods.html,
  mods-page.js/css: the Mods tab.
- ClaudePane.swift: the robot view: ChatService, up to 3 ChatViews (Claude/ChatGPT pages), fills, reply watching,
  conversations' sites, projects, notifications, the switch Claude · ChatGPT · More. Web/chat.js: TRIF inside those pages
  (fill, send, done-detection, pickup, Add to TRIF, viewers).
- PanelChat.swift: More, the desktop side panel in a web view (trifpanel://), runs and tools. Web/panel-adapter.js: the
  panel's chrome.* and background stand-in, API keys and model blocks. Web/panel-phone.css: what the phone hides.
  PanelEngines.swift: Keychain keys, Anthropic / OpenAI Responses / OpenRouter streaming, the Simulator stand-in.
- LocalLlama.swift (llama.cpp wrapper), LocalPrompt.swift (guide, grammars, JSON → mod, repairs), LocalModels.swift
  (catalogue, downloads, LocalRunner, LocalConversation). mobile/local-model/: README, local-guide.txt, the research.
- Safety.swift: safe mode, AppDelegate (shortcut, notifications, background downloads' events). Diagnostics.swift:
  diagnostics log, hang watchdog (`Diagnostics.hangs`), cookie keeper. Report.swift: report.json. Pages.swift: test pages
  scheme. Checks.swift, OnDevice.swift: the probe's old checks.
- make-icon.js: the app icons (light, dark, tinted = Rec. 709 grayscale of the colour art, face black); run it with
  `TRIF_E2E_CHROME=<Chrome for Testing binary>` (the worktree has no tests/e2e/.browsers). make-project.rb: regenerates the project
  (sources globbed); the pbxproj is also edited by hand (ids `A1C10B0E5EB1C11B000000xx`).

## Tim's decisions

- Mods from a reply are picked up automatically (and Add to TRIF stays under each block). Instructions ask for code
  blocks, never attached files.
- No private APIs or tokens for the chat sites. The one private call kept: WebKit's `_flushCookiesToDisk`, with the
  public fallback behind `-publicflush`.
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
- Safe mode's banner (mods switched off) lives in the bars, so a tab in full screen (an icon launch) doesn't show it;
  only the Mods tab lists them. Icons made before `app=1` (early 11-16) open in TRIF view: re-add them.
- Background play never tried on a real phone (YouTube, Tim's mod, AirPods, calls). Lock screen in the Simulator:
  WebKit's Now Playing shows the page's mediaSession title, artist and progress (shot 229) but no play/pause
  buttons were visible; Control Center not checked. Media inside iframes isn't replayed (main frame only).
- Add this mod? shows sites, powers and the free warning but not the mod's facts ("names another site: …") that the
  approval card shows.

## Gotchas

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
- zsh doesn't split `$FILES`: use an array for commit-by-path lists.
