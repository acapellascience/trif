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
- [ ] C1 `shouldInterceptRequest` sees a fetch POST (method yes, body no), never the WebSocket
- [ ] C2 `<video>` keeps playing in the background under a `mediaPlayback` foreground service
- [ ] C3 `requestPinShortcut` puts an icon on the launcher that opens the site full screen

A. Sign-in (Tim runs it; agents never sign in)
- [x] A screen built: three user agents × five steps, PASS/FAIL buttons, log
- [x] `SIGN-IN-TEST.md` written
- [ ] Tim's results

Decision
- [ ] Written up as far as the results allow

## Done this round (round 1, 2026-11-17)
- Set up the SDK, one AVD (`trif-probe`, 2 GB RAM, 2 cores, headless) and a Gradle project (AGP 9.5.1, Gradle 9.9.1, androidx.webkit 1.18.0, compileSdk 37, Kotlin built in).
- Part B: `ProbeActivity` (mode box) + `js/*-start.js` (one script per world) + `serve.js` + `run-box.js`. All of B is done.
- Part A: `SignInActivity` (3 user agents x steps 1, 1b, 2-5, PASS/FAIL/back/clear cookies, files/signin.log), `signin.sh`, `SIGN-IN-TEST.md`. Built, not yet opened in a window.

## Results so far
**B (results/box.log; 5 pages + their frames, every world reports): all PASS except one expected finding.**
- B1 PASS: `lockdown()` runs in world "trif-box", and `new Compartment().evaluate("20 + 22")` = 42 on strict.html (no `unsafe-eval`) and trusted.html (Trusted Types). **The isolated world does not inherit the page's CSP for eval.** Boxed read, confinement (no document/window/fetch/XHR/listener inside) and a boxed mod writing to the page all pass.
- B2: a `<style>` element from TRIF's world is **blocked** by `style-src 'self'` (strict.html, trusted.html); it applies on pages without a policy. **Adopted stylesheets work on every page.** Same as iPhone: keep style-mirror.js / adoptedStyleSheets.
- B3 PASS: the page (including hostile.html) sees none of the box's globals, no `trifBox`/`trifOwn` listener, and an unfrozen `Array.prototype`; TRIF's world doesn't see the box's or the page's either; the box doesn't see the others.
- B4 PASS: all three worlds run at `readyState === "loading"` before the page's first inline script, in the top frame, the same-origin frame and a **cross-site** frame (127.0.0.1:8477 page, localhost:8478 frame), and each frame gets its own world's listener.
- B5: the box script is 434 KB (SES + runtime + probe). On the emulator: SES parse/load 3-6 ms, lockdown 5-11 ms, whole sandbox start 6-14 ms per page (first cold page up to ~150 ms in one run). No mid-range phone was used.
- WebView matters: the API 37.0 image's WebView 145 says `JS_INJECTION_IN_FRAME_AND_WORLD` is **not supported**; WebView **149.0.7827.5** (API 37.2 image) supports it, with DOCUMENT_START_SCRIPT, WEB_MESSAGE_LISTENER, USER_AGENT_METADATA, MULTI_PROFILE, PROXY_OVERRIDE.

**Sizes on disk:** SDK 10 GB in all: emulator 1.2 GB, platform-tools 37 MB, platform android-37.0 152 MB, build-tools 37.0.0 192 MB (+ 36.0.0 188 MB that AGP fetched itself), system image android-37.2 google_apis_playstore_ps16k arm64 **8.2 GB** (the 37.0 image, 2.6 GB, was removed). Debug APK 3.8 MB.

## Next step
Part C: (1) `shouldInterceptRequest` vs a fetch POST and a WebSocket (needs a tiny WebSocket on serve.js, no npm), (2) `<video>` in the background under a `mediaPlayback` foreground service, (3) `requestPinShortcut`. Screenshots with `adb exec-out screencap`. Then a quick headless smoke of SignInActivity (launch it, screencap, no sign-in) and the decision section.

## Notes for next round
- Env: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`, SDK `~/Library/Android/sdk`. Brew's `sdkmanager` needs `--sdk_root=$HOME/Library/Android/sdk`; brew's `avdmanager` ignores it, so the AVD config was written by hand (~/.android/avd/trif-probe.*).
- Run B: `./emu.sh start && ./gradlew -q assembleDebug && node run-box.js` (~1 min). `./emu.sh stop` at the end. First boot of a new image: `EMU_EXTRA=-wipe-data ./emu.sh start`.
- Port 8377 is the iOS agent's `mobile/serve.js`: the probe uses 8477/8478.
- **Pages must go through `adb reverse` (127.0.0.1 / localhost), not 10.0.2.2**: Android 17 with targetSdk 37 refuses local-network addresses (`ERR_LOCAL_NETWORK_PERMISSION_MISSING`). Cleartext is allowed for those two hosts in res/xml/network_security_config.xml. The first load through a fresh reverse can fail; ProbeActivity retries once.
- Reports from Chrome's error page are logged as `FAIL ... B0.loaded` so a page that didn't load can't pass.
- No `evaluateJavascript` per world exists in the API: each world's script reports itself through its own world's `addWebMessageListener`.

## For Tim
- Part A is ready when you are: `SIGN-IN-TEST.md` (one command, then tap). The emulator's WebView is 149, from the system image; it isn't updated through Play unless you sign in to the Play Store on it.
- Disk: the Mac has about 30 GB free; the API 37.2 Play image alone is 8.2 GB.
