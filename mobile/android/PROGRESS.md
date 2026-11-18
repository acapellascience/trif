# TRIF for Android: progress

The real Android app on the system WebView (decision: branch android-probe's PROGRESS.md, 2026-11-18). One chunk of
work per round (a fresh agent each time); this file carries what's known between rounds. Branch `android`, worktree
`~/WebMods-worktrees/android`, based on `ios-poc` (merge origin/ios-poc in at the start of every round).

Scope (Tim, 11-18): **the foundation only**. The UI layer (quick ask, done banners, chats list, mic, robot cover, tab
pictures, the toolbar's fine details) waits until Tim says the iPhone app's UI has settled.

Sources: ANDROID.md (`git show origin/landscape:ANDROID.md`), the probe (`origin/android-probe`,
mobile/android-probe), mobile/IOS-AGENT-NOTES.md (the iPhone app's map and Tim's decisions), docs/IOS-APP-STRINGS.md
(wording), docs/MOBILE-BEHAVIOUR.md (the shared behaviour spec, once another loop writes it; not there on 11-18).

## Plan

- Kotlin, one `app` module, package `com.timsrobot.trif`, AGP 9.5.1 (built-in Kotlin), Gradle 9.9.1 wrapper,
  compileSdk/targetSdk 37, minSdk 29, androidx.webkit 1.18.0. **Plain Android Views, no Compose yet**: the
  foundation is WebViews and a WebView page (the Mods tab); Compose can be added later inside the same module
  (ComposeView) when the UI layer starts. Fewer dependencies, faster builds on the shared Mac.
- Shared web code is not copied into the repo: a Gradle task copies SES (`extension/vendor/ses.umd.min.js`),
  `mobile/shared/gen/*` and the iPhone app's `Web/` files into a generated assets folder at build time. Android
  differences go in small adapter scripts (mobile/android/app/src/main/js), not forks.
- Worlds: TRIF's = `getExecutionWorld(wv, "trif")`, the box = `"trif-box"`, free mods = page world. Messages via
  `addWebMessageListener` bound to a world (never `addJavascriptInterface`).
- mods.js (the iPhone's JavaScriptCore part): androidx.javascriptengine (JavaScriptSandbox) if it fits, else a
  hidden WebView. Decide in item 4.
- Local test pages: `mobile/shared/pages` served on the Mac (ports 8477/8478, not 8377), reached through
  `adb reverse` as 127.0.0.1/localhost (Android 17 + targetSdk 37 refuses 10.0.2.2). Cleartext to those two hosts
  is allowed in the **debug** build only (src/debug/res/xml/network_security_config.xml).

## Foundation checklist

1. [x] The project: Gradle wrapper, app module, debug build installs and opens on the emulator; unit tests run.
2. The browser
   - [x] tabs with their own back/forward, kept across launches (round 2; the tab list is plain rows, the cards are UI layer)
   - [x] address/search bar (a plain field wired to `Address.resolve`; its compact/centred look is UI layer)
   - [ ] real popup windows (onCreateWindow)
   - [ ] links to other apps (tapped → open; by itself → ask first, as iOS AppLinks)
   - [ ] minimum WebView version check (149+, `JS_INJECTION_IN_FRAME_AND_WORLD`; clear message otherwise)
   - [ ] default-browser role: http/https VIEW intent filters, a usable start page
3. [ ] Script worlds: TRIF's world + the box (SES + sandbox-runtime.js) at document start, all frames; page world
   for free mods; the iPhone's injected scripts (page-bridge.js, style-mirror.js, …) through an adapter
4. The mod engine
   - [ ] mod store (installed, on/off, holds and allowed, history, Recently deleted, as iPhone)
   - [ ] reading mods with mods.js (JavaScriptSandbox or hidden WebView)
   - [ ] @match matching
   - [ ] style sections, boxed and free mods running
   - [ ] holds waiting for Allow
5. [ ] Mods tab: shared mods.html / mods-page.js in a WebView, Android message adapter
6. Getting mods in
   - [ ] "Add this mod?" for a pasted mod, a .js file opened with/shared to the app
   - [ ] import of desktop exports
7. Tests
   - [ ] unit tests for Kotlin logic (ongoing, one per piece)
   - [ ] emulator tests, headless, with mobile/shared/pages: style mod, boxed mod, free mod's style section, held
     mod, popup sign-in stand-in, Mods tab shows/switches; screenshots in mobile/android/shots/ (not committed)

## Done this round (round 2, 2026-11-18)
- Merged origin/ios-poc. Tabs: `Browser.kt` (Tab + the tab list: new tab after the shown one, close, select, each tab
  its own WebView made when first shown), `SavedTabs.kt` (noBackupFilesDir/tabs.json + `TabOrder`), `BundleJson.kt`
  (WebView.saveState's bundle as plain JSON, never a marshalled Parcel; restore falls back to the address).
- Plain toolbar (‹ › + and the tab count) and a plain tab list; links opened with the app go into an empty tab, else a
  new one (onNewIntent). Words reuse iPhone's (STRINGS.md).
- Tests: 7 unit tests pass (Address + SavedTabs/TabOrder); `test/tabs.sh` on the emulator PASSES (link into empty tab,
  typed address, second link = new tab, tabs.json with the back/forward list, restart restores both, back/forward in
  the restored tab, close, +).

## Next step
Item 2, next part: real popup windows (onCreateWindow + `setSupportMultipleWindows`, the popup as its own WebView
over the tab, window.close closes it; a local sign-in-style stand-in page for the test), then links to other apps.

## Notes for next round
- Env: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`, SDK `~/Library/Android/sdk`
  (local.properties, not committed). AVD `trif-probe` (API 37.2 Play image, WebView 149). The probe's `emu.sh` is
  reused here as `mobile/android/emu.sh`.
- Build: `cd mobile/android && ./gradlew -q assembleDebug testDebugUnitTest`. Install: `adb install -r
  app/build/outputs/apk/debug/app-debug.apk`; open: `adb shell am start -n com.timsrobot.trif/.MainActivity`.
- Pages: `node mobile/serve.js 8477` (from the worktree root; it serves mobile/shared/pages) +
  `adb reverse tcp:8477 tcp:8477`. Type **localhost**:8477/…: a bare IP gets https:// (as on iPhone) and fails.
  The address field sits at about y=123 px on the 1080x2400 screen (`adb shell input tap 540 123`).
- Where the iPhone puts its scripts: Browser.swift `installScripts()` (~line 425: stallWatch, BackgroundPlay.watch,
  kit.js + start-own.js in TRIF's world, start-page.js in the page world) and Mods.swift `userScripts()` (~line 355:
  style-mirror.js first in each world with a mod, the free relay/page pair, SES + sandbox-runtime.js in the box,
  page-bridge.js with pairs, then each mod in its world). iPhone injects main frame only (`forMainFrameOnly: true`).
- CI (`tests`, the repo's npm test; nothing Android in it yet) fails on `android` exactly as on `ios-poc`
  (11-18: mobile/test/chat.test.js, smoke.js, webkit-check/style-demo.js, "the mobile probes"): inherited, not ours.
  Compare with `gh run list --branch ios-poc` before chasing a failure.
- `shots/` is gitignored. Gradle's SharedAssets task lists each source as its own input (a repo-root input overlaps
  the build folder and Gradle refuses it).
- Take the device lock before the emulator or a long Gradle build (the loop prompt has the script). Round 2 waited
  ~20 min for the iOS batch: start the build in the background and wait with a Monitor.
- Emulator tests: `mobile/android/test/*.sh` (uiautomator dump + adb; `tabs.sh` is the pattern: `expect` polls the
  address field, `tap` finds nodes by text/content-desc). Run with the emulator booted and `node mobile/serve.js 8477`.
- Every WebView is made in `Browser.makeWebView(tab)`: worlds, popups and mods hook in there.
- A WebView swapped into the page takes the focus from the field (else the field keeps focus and stops updating).

## For Tim
- Nothing needs you yet. One choice made for now: plain Android Views rather than Jetpack Compose for the
  foundation (smaller and faster to build); Compose can come in with the UI layer if you want it.
