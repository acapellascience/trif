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
   - [x] real popup windows (round 3: onCreateWindow → a new tab after the opener's, a real window with an opener;
     window.close goes back to the opener; only from a tap)
   - [x] links to other apps (round 4: tapped → to Android; by itself → the question, one a load; frames never;
     intent: read as Chrome does, BROWSABLE only, its fallback page when no app takes it)
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

## Done this round (round 4, 2026-11-18)
- Links to other apps, as iPhone's AppLinks: `AppLinks.kt` (kinds, decide, tap test, intent fallback; pure, 6 unit
  tests) + `TouchClock` (finger on the page, 1.5 s) and `Browser.takeLink/appLink/handOut`. Tapped = the WebView's
  `hasGesture()` and the finger just now. intent:/android-app: parsed with `Intent.parseUri`, CATEGORY_BROWSABLE,
  no component/selector component, no URI grants; a web intent with no package stays in TRIF; no app → its
  `S.browser_fallback_url` page, else a toast. A window opened for an app link: handed out, its empty tab closes.
- New shared stand-in page mobile/shared/pages/applinks.html. `test/applinks.sh` PASSES (tel: → the dialer; no app;
  intent fallback; target=_blank tel:; 7 s later → question, Cancel; on load: frame dropped, asked once, 2nd dropped);
  `popups.sh` and `tabs.sh` still PASS; 14 unit tests pass.

## Next step
Item 2, next part: the minimum WebView version check (149+, `WebViewFeature.isFeatureSupported(
JS_INJECTION_IN_FRAME_AND_WORLD)` / `WebViewCompat.getCurrentWebViewPackage`; a clear message otherwise, wording a
draft in STRINGS.md). Then the default-browser role (http/https VIEW filters, start page).

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
- Popups: test with two servers (`node mobile/serve.js 8477` and `… 8478`, both `adb reverse`d); signin.html opens
  127.0.0.1:<port+1>/signin-popup.html. A tap gives a page ~5 s to open a window (Chromium's transient activation),
  so "untapped" is tested with a window.open as the page loads. Third-party cookies are on for every WebView (the
  probe's passing Google sign-ins had them on). The opener link (`Tab.opener`) isn't kept across launches.
- App links log to logcat tag `TRIF` ("app link: tel: from a page, tapped: handed to Android": scheme only); tests
  grep `adb logcat -d -s TRIF`. uiautomator shows dialog buttons upper-case (CANCEL/OPEN) and `see` patterns are
  regexes (escape `?` as `[?]`). Text behind a dialog isn't in the dump. popups.sh needs both servers (8477, 8478).
- A WebView swapped into the page takes the focus from the field (else the field keeps focus and stops updating).

## For Tim
- App links (round 4): the question is always the generic "Open this page in another app?" (Android can't name the
  app for certain, so never "in “Phone”"); the no-app note is a draft: "No app on this phone can open this link."
- Nothing needs you yet. One small difference from iPhone: when a page closes its own window (a sign-in window
  finishing), Android goes back to the tab that opened it; iPhone shows the tab in its place (often the same tab). One choice made for now: plain Android Views rather than Jetpack Compose for the
  foundation (smaller and faster to build); Compose can come in with the UI layer if you want it.
