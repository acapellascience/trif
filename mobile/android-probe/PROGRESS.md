# TRIF Android probe: progress

The throwaway prototype from ANDROID.md §5 (branch `landscape`). One round of work per agent; this file
carries what's known between rounds.

## Checklist (ANDROID.md §5)

Setup
- [x] SDK: platform-tools, emulator, one platform + build-tools, one arm64 Google Play image (sizes below)
- [x] One AVD (~2 GB RAM), runs headless
- [x] Gradle project (wrapper) builds; androidx.webkit current

B. The box world (automatic, headless)
- [x] B1 `lockdown()` runs in world "trif-box"; `new Compartment().evaluate()` works on strict.html (no `unsafe-eval`) and trusted.html (Trusted Types)
- [x] B2 (answer: no for `<style>` on strict pages; adopted sheets yes) a `<style>` inserted from TRIF's world applies on strict.html
- [x] B3 the page can't see the box's globals or call the box's message listener (hostile.html)
- [x] B4 scripts reach a cross-origin iframe and run before the page's first script
- [x] B5 lockdown time (ms) on the emulator

C. Quick checks
- [x] C1 `shouldInterceptRequest` sees a fetch POST (method yes, body no), never the WebSocket
- [x] C2 (answer: only with a WebView that keeps saying it's visible) `<video>` keeps playing in the background under a `mediaPlayback` foreground service
- [x] C3 `requestPinShortcut` puts an icon on the launcher that opens the site full screen

A. Sign-in (Tim runs it; agents never sign in)
- [x] A screen built: three user agents × five steps, PASS/FAIL buttons, log
- [x] `SIGN-IN-TEST.md` written
- [x] Tim's results (2026-11-18): **all PASS with the `default` WebView user agent** (Tim: "default is all passes"). Google itself, then YouTube signed in; Claude + Google and ChatGPT + Google once the probe supported popups (1dd3fd1: Continue with Google ends on `accounts.google.com/gsi/transform`, which hands the sign-in back to its opener window; with `setSupportMultipleWindows(false)` it sat blank). No `disallowed_useragent`, no "may not be secure". The other two user agents weren't needed.

Decision
- [x] **Final: build on WebView** (A, B and C pass)

## Done this round (round 2, 2026-11-17)
- Part C: `CheckActivity` (modes net / video / pin / site) + `MediaService` (mediaPlayback foreground service), pages `net.html` and `video.html`, and serve.js now has a POST echo, a hand-written WebSocket echo and a ranged `clip.mp4` (made locally with ffmpeg into build/, not committed). `run-c.js` drives all of C headless.
- All of C passes; C2 needed one change (below). Decision written up as far as B and C allow.
- Round 1: SDK, AVD, Gradle project, all of B, and part A's screen + SIGN-IN-TEST.md.

## Results so far
**B (results/box.log; 5 pages + their frames, every world reports): all PASS except one expected finding.**
- B1 PASS: `lockdown()` runs in world "trif-box", and `new Compartment().evaluate("20 + 22")` = 42 on strict.html (no `unsafe-eval`) and trusted.html (Trusted Types). **The isolated world does not inherit the page's CSP for eval.** Boxed read, confinement (no document/window/fetch/XHR/listener inside) and a boxed mod writing to the page all pass.
- B2: a `<style>` element from TRIF's world is **blocked** by `style-src 'self'` (strict.html, trusted.html); it applies on pages without a policy. **Adopted stylesheets work on every page.** Same as iPhone: keep style-mirror.js / adoptedStyleSheets.
- B3 PASS: the page (including hostile.html) sees none of the box's globals, no `trifBox`/`trifOwn` listener, and an unfrozen `Array.prototype`; TRIF's world doesn't see the box's or the page's either; the box doesn't see the others.
- B4 PASS: all three worlds run at `readyState === "loading"` before the page's first inline script, in the top frame, the same-origin frame and a **cross-site** frame (127.0.0.1:8477 page, localhost:8478 frame), and each frame gets its own world's listener.
- B5: the box script is 434 KB (SES + runtime + probe). On the emulator: SES parse/load 3-6 ms, lockdown 5-11 ms, whole sandbox start 6-14 ms per page (first cold page up to ~150 ms in one run). No mid-range phone was used.
- WebView matters: the API 37.0 image's WebView 145 says `JS_INJECTION_IN_FRAME_AND_WORLD` is **not supported**; WebView **149.0.7827.5** (API 37.2 image) supports it, with DOCUMENT_START_SCRIPT, WEB_MESSAGE_LISTENER, USER_AGENT_METADATA, MULTI_PROFILE, PROXY_OVERRIDE.

**C (results/c.log, results/*.png; `node run-c.js`, ~4.5 min): all PASS; the two FAIL lines in C2 are the plain-WebView controls that show why the trick is needed.**
- C1 PASS: `shouldInterceptRequest` sees the page's `fetch` POST (method POST, headers Accept/Content-Type/Origin/Referer/User-Agent/sec-ch-ua*) but `WebResourceRequest` has **no body at all** in the API; the server got the body. The page's WebSocket worked (echo) and `shouldInterceptRequest` **never saw it** (3 requests seen: the page, the POST, favicon). Confirms the tab-lock gap.
- C2: a plain WebView **pauses the `<video>` itself** the moment the app goes to the background (visibilitychange → hidden → pause), **with or without the foreground service** (0.5–1.3 s of 40 s played, in two runs each). With a WebView subclass whose `onWindowVisibilityChanged` always passes `VISIBLE`, the video plays the whole time: **100% with the foreground service, 99% without** (40 s in the background, no pause event; JS timers keep running). On this emulator the app wasn't frozen even without the service (`isFrozen=false` after 40 s), so the service's job (stopping the cached-app freezer and process kills on real phones) isn't shown here; TRIF should still run it while media plays. Side effect: with the trick the page always reads `visibilityState === "visible"`, so TRIF should switch it on only while media is playing.
- C3 PASS: `requestPinShortcut` shows Pixel Launcher's "Add to home screen" sheet (one tap; c3-1-dialog.png); the icon "Probe site" lands on home page 2 (c3-2-home-page2.png); tapping it opens CheckActivity on plain.html with `ACTION_VIEW`, system bars hidden, WebView 1080x2400 = the whole screen (c3-3-site.png).

**Sizes on disk:** SDK 10 GB in all: emulator 1.2 GB, platform-tools 37 MB, platform android-37.0 152 MB, build-tools 37.0.0 192 MB (+ 36.0.0 188 MB that AGP fetched itself), system image android-37.2 google_apis_playstore_ps16k arm64 **8.2 GB** (the 37.0 image, 2.6 GB, was removed). Debug APK 3.8 MB.

## Decision (final, 2026-11-18)
**Build TRIF for Android on the system WebView** (androidx.webkit), as ANDROID.md recommends, with the default user agent. Design rules from the probe: real popup windows (`onCreateWindow`, sign-in needs them); a minimum WebView version check (149+ for script worlds); background media via the always-visible WebView + mediaPlayback service; the tab lock can't see WebSockets or request bodies. GeckoView isn't needed.

### Before the final result
- **B passes** (the box world works: `lockdown()` and `Compartment` evaluate on strict-CSP and Trusted Types pages, the worlds are separate, frames are covered, lockdown ~5–11 ms). So the "B fails → hidden-WebView box" branch is off.
- **C passes**, with one design rule found: background media needs the always-visible WebView trick (+ the mediaPlayback service), and the WebSocket gap is real (tab-lock can't see WebSockets or request bodies through `shouldInterceptRequest`).
- **A is the open question.** If Tim's run passes Google's own sign-in with any of the three user agents: **build on WebView** (ANDROID.md's recommendation), with that user agent. If Google refuses in all three (`disallowed_useragent` / "may not be secure"): run A on a bare GeckoView app (the half-day in §5) before deciding.
- Caveat: WebView 149 only. The API 37.0 image's WebView 145 lacks `JS_INJECTION_IN_FRAME_AND_WORLD`, so TRIF on Android needs a minimum WebView version check (and a clear message on older ones).

## Next step
The probe is done (PROBE COMPLETE). Next is Tim's call: start the real Android app. Earlier: waiting on Tim's part A run (SIGN-IN-TEST.md). When his results are in: record them under A, tick the box, and finish the decision. If A fails for Google: a GeckoView sign-in probe (Maven Central `org.mozilla.geckoview`, one activity, the same steps) is the next chunk.

## Notes for next round
- Env: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`, SDK `~/Library/Android/sdk`. Brew's `sdkmanager` needs `--sdk_root=$HOME/Library/Android/sdk`; brew's `avdmanager` ignores it, so the AVD config was written by hand (~/.android/avd/trif-probe.*).
- Run B: `./emu.sh start && ./gradlew -q assembleDebug && node run-box.js` (~1 min). `./emu.sh stop` at the end. First boot of a new image: `EMU_EXTRA=-wipe-data ./emu.sh start`.
- Port 8377 is the iOS agent's `mobile/serve.js`: the probe uses 8477/8478.
- **Pages must go through `adb reverse` (127.0.0.1 / localhost), not 10.0.2.2**: Android 17 with targetSdk 37 refuses local-network addresses (`ERR_LOCAL_NETWORK_PERMISSION_MISSING`). Cleartext is allowed for those two hosts in res/xml/network_security_config.xml. The first load through a fresh reverse can fail; ProbeActivity retries once.
- Reports from Chrome's error page are logged as `FAIL ... B0.loaded` so a page that didn't load can't pass.
- No `evaluateJavascript` per world exists in the API: each world's script reports itself through its own world's `addWebMessageListener`.
- Run C: `./emu.sh start && ./gradlew -q assembleDebug && node run-c.js [c1,c2,c2keep,c3]` (all: ~4.5 min; c3 uninstalls and reinstalls the app to remove old pinned shortcuts). `build/clip.mp4` is made by ffmpeg (already on the Mac) if missing: see the command in run-c.js.
- `adb exec-out screencap` PNGs are >1 MB: `execFileSync` needs `maxBuffer`. Pixel Launcher puts pinned shortcuts on home page 2.
- SignInActivity hasn't been opened by an agent (it loads accounts.google.com on start, and agents stay off real sites here).

## For Tim
- Part A is ready when you are: `SIGN-IN-TEST.md` (one command, then tap). The emulator's WebView is 149, from the system image; it isn't updated through Play unless you sign in to the Play Store on it.
- B and C are done and pass; the only thing left is your sign-in run (part A). Its result decides WebView vs GeckoView.
- Found in C: background video needs a small WebView trick (it otherwise pauses itself when the app is in the background); the WebSocket gap in tab-lock is confirmed.
- Disk: the Mac has about 24 GB free now; the API 37.2 Play image alone is 8.2 GB. Once the probe is decided, `sdkmanager --uninstall "system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a"` gets it back.
