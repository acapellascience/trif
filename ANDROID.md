# TRIF on Android: what to build on

Research for Tim, 2026-11-17. Research only: no app code. Branch `landscape`.
The iPhone app it's compared against is on branch `ios-poc` (`mobile/browser-probe`, map in
`mobile/IOS-AGENT-NOTES.md`).

---

## 1. The recommendation

**Build TRIF for Android as its own app on Android's built-in web engine ("Android System WebView",
which is Chrome's engine), written in Kotlin. It should copy the iPhone app's design almost piece for
piece.** Keep GeckoView (Firefox's engine) as the fallback. Switch to it only if a one-day test shows
that people can't sign in to Google inside the app.

Why, in plain words:

1. **Android's web view gained the one thing it lacked, in May 2026.** Until this year it could only
   run scripts *inside the page's own world*, so the page could see and tamper with them. That ruled
   out a safe box for boxed mods. AndroidX WebKit 1.16 (stable 6 May 2026) added **separate script
   worlds and script injection into every frame at page start**. That is the same three-world setup
   the iPhone app uses:
   - TRIF's world, for style mods and TRIF itself;
   - the box world, with SES, for boxed mods;
   - the page's own world, for free mods.

   So the iPhone design carries over instead of being redesigned.
2. **Google keeps the engine up to date for us.** Android System WebView updates itself from the Play
   Store, like Chrome. With GeckoView, TRIF would carry its own copy of Firefox's engine. That adds about
   90 MB, and TRIF would have to ship a new release every time Firefox does (every four weeks, plus
   urgent security fixes) or leave people on a browser with known holes. That's a lot of upkeep for one
   person, and it gets harder once Android checks who made sideloaded apps.
3. **Most of the iPhone app's web code can be reused as-is.** That covers `chat.js`, `mods-page.js`,
   `panel-adapter.js` and everything `mobile/prepare.js` generates (mods.js, sandbox-runtime.js,
   page-bridge.js, the panel). Each file talks to the app through one call, and only that call changes.
   The Swift layer gets rewritten in Kotlin, but the iPhone notes are effectively its spec.

**The one thing that could change the answer is Google sign-in.** Google blocks signing in "inside
apps", and Android's web view tells sites which app it's in. (Since December 2025 it sends the app's
name on every request again.) Browsers built on this web view, DuckDuckGo's for one, do handle Google
sign-in. Whether TRIF can is the first thing to test (section 5). If it fails, GeckoView passes as
"Firefox". GeckoView also already runs the desktop extension's tab lock and response filtering
unchanged, so it's a real plan B, not a dead end.

What's ruled out:
- **Custom Tabs** can't change pages at all.
- **A Chromium fork** means building Chrome yourself: hours per build, more than 100 GB of disk, and
  monthly merges.
- **Running inside someone else's browser** (Firefox for Android, Edge, Quetta, Lemur and others) gives
  up the chat pane, the Home Screen icons and the phone link, and puts TRIF at the mercy of another
  company's add-on rules. Firefox for Android is the only one where desktop TRIF would mostly just work.
  It's worth a cheap "TRIF for Firefox on Android" later, as an extra, not as the product.

---

## 2. Comparison

✅ = works, ⚠️ = works with effort or with a gap, ❌ = no. (Details and sources in section 3.)

| | **System WebView + androidx.webkit** (recommended) | **GeckoView** (plan B) | **Chromium fork** | **Someone else's browser** (Firefox Android best case) | **Custom Tabs** |
|---|---|---|---|---|---|
| Mods at page start, in every frame | ✅ `addJavaScriptOnEvent`, all matching frames | ✅ the extension's own userScripts / content scripts | ✅ (you own the engine) | ✅ Firefox ≥ 138 has userScripts | ❌ no injection |
| Box world for boxed mods (SES) | ✅ named isolated world (1.16, May 2026). Eval under strict CSP is **unproven** | ✅ userScripts world, as on desktop Firefox | ✅ | ✅ Firefox; ⚠️ unknown in Chromium forks | ❌ |
| Chat pane shares sign-ins with tabs | ✅ one profile = one cookie jar | ✅ one runtime = one cookie jar | ✅ | ❌ no embedded pane | ❌ |
| Google sign-in inside the app | ⚠️ **the big unknown**: Google blocks "embedded" views; needs a test | ✅ likely: it looks like Firefox. Untested | ✅ (looks like Chrome) | ✅ it's a real browser | ✅ but cookies stay in Chrome |
| Background sound / video, PiP | ⚠️ yes, with our own media service and lock-screen controls | ✅ GeckoView has a media session API | ✅ | ✅ Firefox does it | — |
| Home Screen icons, full screen | ✅ pinned shortcuts: far simpler than iOS profiles | ✅ same | ✅ | ⚠️ the browser's own "Add to Home screen" | — |
| Tab lock (block writes and leaks) | ⚠️ requests yes; **WebSockets not seen**, so needs a second layer | ✅ desktop `tablock.js` (declarativeNetRequest) as-is | ✅ | ✅ in Firefox | ❌ |
| `site-data` power (filter responses) | ✅ in-page fetch/XHR wrapper, as on iPhone | ✅ `filterResponseData`, as on desktop Firefox | ✅ | ✅ Firefox | ❌ |
| Phone link (Bonjour + Noise) | ✅ NsdManager + Kotlin port of PhoneLink.swift | ✅ same (Kotlin side) | ✅ | ⚠️ extension can't do mDNS | ❌ |
| On-device model | ✅ llama.cpp via NDK | ✅ same | ✅ | ❌ | ❌ |
| App size (arm64) | ✅ ~15–30 MB | ❌ ~100 MB (GeckoView's arm64 library alone is 91.5 MB) | ❌ 100 MB+ | — | — |
| Engine security updates | ✅ Google, through Play | ❌ TRIF must ship each Firefox release | ❌ TRIF must merge Chromium monthly | ✅ the browser's maker | ✅ |
| Reuse from what exists | iPhone app's design + all its web files | Desktop extension + iPhone app's web files | Desktop extension | Desktop extension (no panel/helper) | — |
| Effort | Medium (port ~16k lines of Swift to Kotlin) | Medium-high (same Kotlin app + engine upkeep) | Very high | Low, but a lesser product | — |

---

## 3. The questions, one by one

### 3.1 Injection: page start, main world, all frames, strict pages

**System WebView.**
- `WebViewCompat.addDocumentStartJavaScript` (androidx.webkit 1.9, 2023) runs a script "in any frame
  whose origin matches" the rules you give, and "before any of the page's JavaScript code". It's
  main-world only.
- **New in 1.16.0 (stable 6 May 2026):** `addJavaScriptOnEvent(webview, script,
  INJECTION_EVENT_DOCUMENT_START, origins, world)`, plus `getExecutionWorld(webview, name)`. Scripts
  can now go into a **named isolated world** or the page's world (`PAGE_WORLD_NAME = ""`), and
  `addWebMessageListener` gained a `world` argument: "the script will only be able to call message
  listeners registered in the same execution world". The release notes put it plainly: inject
  "into isolated worlds to prevent collisions with existing page JavaScript".
- The feature flag is `WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD`. It's checked at run time, so
  very old or non-updating WebViews (devices without Google Play, some forks) fall back. Proposal: style
  mods only, plus "update Android System WebView".
- **iOS → Android mapping.** On iOS each mod is a `WKUserScript` in one of three worlds. On Android:
  - TRIF's world → `getExecutionWorld(wv, "trif")`;
  - the box → `getExecutionWorld(wv, "trif-box")`;
  - free mods → `PAGE_WORLD_NAME`.
- **Scripts are fixed per origin.** Origin rules are origins (`https://*.example.com`), not path
  patterns. Scripts are registered per WebView and only affect frames that start loading after the
  call. That matches iOS's "takes effect on the next load", so `@match` paths are filtered in JS (the
  generated `matchesUrl` already does this).
- **Strict CSP and Trusted Types.** Injected scripts aren't blocked by the page's `script-src`; they
  aren't page `<script>` tags. Free mods in the page world are subject to the page's Trusted Types, as
  on desktop (MAIN world) and iPhone. Two things are **not documented** and must be tested:
  - whether an isolated world inherits the page's CSP for `eval`/`new Function`, which SES compartments
    need (desktop Chrome sets its own world CSP with `userScripts.configureWorld` for exactly this);
  - whether a `<style>` element added from the isolated world is blocked by a strict `style-src`.

  The iPhone app's `style-mirror.js` already works around the second. Test pages for both exist:
  `mobile/shared/pages/strict.html`, `trusted.html`, `hostile.html`, `frame.html`.
- **Service workers.** Injection happens when a document is created, whether the page came from the
  network or a service worker's cache, so pages that use service workers still get mods. The service
  worker's own scope never sees our scripts (same as desktop).
- **Script size.** The page waits for document-start scripts ("should be kept as short as possible").
  SES plus the sandbox runtime is about 400 KB; the iPhone measured lockdown at under 50 ms. Load the box
  only on origins that have a boxed mod (the iPhone does the same), and time it on a mid-range phone in
  the probe.
- Sources: [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat),
  [androidx.webkit releases](https://developer.android.com/jetpack/androidx/releases/webkit),
  [JavaScriptExecutionWorld](https://developer.android.com/reference/androidx/webkit/JavaScriptExecutionWorld),
  [WebViewFeature](https://developer.android.com/reference/androidx/webkit/WebViewFeature).

**GeckoView.**
- A GeckoView app can bundle TRIF's extension as a *built-in* extension (`installBuiltIn` /
  `ensureBuiltIn`, files under `resource://android/`). Built-in extensions get the full WebExtension
  surface plus privileged messaging to the app.
- From MDN's compatibility data, Firefox for Android has:
  - `userScripts` with `worldId` and `configureWorld`: 138+;
  - `userScripts.execute`: 153+ (mirrors desktop);
  - `declarativeNetRequest`, `webRequest` blocking, and `webRequest.filterResponseData` (StreamFilter);
  - **no** `sidebarAction`;
  - `runtime.connectNative` only in privileged GeckoView extensions.
- The current GeckoView is 160 (Mozilla Maven, 4 Nov 2026). Desktop TRIF already supports Firefox
  (`FIREFOX` paths in `extension/background.js`), so injection, the box and the tab lock would run
  as on desktop Firefox.
- Sources: [GeckoView: interacting with web content](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html),
  [MDN userScripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts),
  [browser-compat-data](https://github.com/mdn/browser-compat-data/tree/main/webextensions/api)
  (`userScripts.json`, `webRequest.json`, `runtime.json`, `sidebarAction.json`),
  [Mozilla Maven: GeckoView](https://maven.mozilla.org/maven2/org/mozilla/geckoview/).

**Chromium fork.** Anything is possible, since TRIF would own the engine. Chromium's own extension
system is not built for Android (only Chrome's "desktop Android" builds have started enabling it, per
2026 Chromium commits), so it's a lot of engine work.

**Someone else's browser.**
- **Firefox for Android** runs MV3 extensions with userScripts (138+), so desktop TRIF mostly works:
  - mods in all three tiers ✅, the tab lock ✅;
  - no side panel (no sidebar on Android);
  - no helper (no native messaging for normal extensions);
  - no embedded chat pane.

  Outside AMO, people install a signed unlisted XPI through a hidden menu: tap the logo five times,
  then "Install extension from file"
  ([Extension Workshop](https://extensionworkshop.com/documentation/publish/install-self-distributed/)).
- **Edge for Android** offers a short, curated list of extensions only, with "more coming"
  ([Chipp.in, 2026](https://chipp.in/software/android/microsoft-edge-for-android-more-extensions-now-available-but-one-group-is-missing-entirely/)).
  TRIF can't be installed there.
- **Kiwi** shut down in January 2025; its extension code went to Edge Canary
  ([Android Authority](https://www.androidauthority.com/kiwi-browser-shutting-down-3519510/)).
- **Quetta and Lemur** are Chromium forks that install Chrome Web Store extensions. Whether they
  support MV3 `userScripts` with `worldId` is unverified. They're small vendors, and TRIF would depend
  on them.
- **Chrome for Android** has no extensions on phones. Development builds for "desktop Android" have
  them ([Chrome Unboxed](https://chromeunboxed.com/a-development-version-of-chrome-for-android-now-supports-extensions/)).
- **Samsung Internet** only takes its own add-on catalogue.

**Custom Tabs.** No injection, no DOM access; the app only gets navigation events. Ruled out as a
mod host.

### 3.2 Where boxed (SES) code runs

| Option | Shares the page's DOM? | Page can reach it? | Verdict |
|---|---|---|---|
| **WebView isolated world** (`getExecutionWorld`) | Yes (like a content script) | No: separate globals, separate message listeners per world | **Use this.** Direct equivalent of iOS's `WKContentWorld` box and Chrome's USER_SCRIPT world. Open question: `eval` under strict CSP (probe). |
| Hidden WebView | No (another page) | No | Only if the isolated world can't eval: every DOM call would be an async round trip. Bad fit for TRIF's API. |
| `androidx.javascriptengine` (JavaScriptSandbox) | No DOM | No (separate process, V8 isolate) | Not for boxed mods. Good for what **JavaScriptCore does on iOS**: running `mods.js` (buildMod, reading headers, checks) natively without a page. Async, needs a recent WebView (`isSupported()`), one sandbox per app. [Docs](https://developer.android.com/develop/ui/views/layout/webapps/jsengine) |
| QuickJS (e.g. a Kotlin binding) | No DOM | No | A fallback for `mods.js` on devices where JavaScriptSandbox isn't supported. |
| GeckoView extension (userScripts world + background) | Yes | No | Same as desktop Firefox. |

**Don't use `addJavascriptInterface`.** It exposes Java to every frame. Google Play also lists "a
webview with added JavaScript Interface that loads untrusted web content" as abuse (see 3.9). Use
`addWebMessageListener` bound to TRIF's world, so the page itself can't post to it.

### 3.3 Sign-ins (critical)

**What Google blocks.** Since 30 September 2021, Google refuses OAuth sign-in ("Continue with Google"
on claude.ai or chatgpt.com) in embedded web views, and names Android WebView and WKWebView
([Google, 2021](https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html)).
It shows `disallowed_useragent`. Signing in to Google itself (for YouTube or Gmail in a tab) can show
"This browser or app may not be secure"
([Google help](https://support.google.com/accounts/answer/7675428)).

**What tells Google it's a web view**:
- **The user agent.** WebView's default has `; wv)` and `Version/4.0`. Changing it is one call
  (`WebSettings.setUserAgentString`). The iPhone app does the same thing: it appends Safari's suffix
  (`Browser.safariSuffix`).
- **The `X-Requested-With` header.** It carries the app's package name. Chrome planned to remove it
  in 2023, but **androidx.webkit 1.15.0 (Dec 2025) says the removal was cancelled and "the header
  will again be sent on all requests by default"**; the allow-list API is deprecated
  ([release notes](https://developer.android.com/jetpack/androidx/releases/webkit),
  [the 2023 plan](https://developer.chrome.com/blog/android-webview-header-privacy)). It was sent for
  years before 2023 too, and WebView-based browsers still worked with Google.
- **Other signals** Google doesn't publish.

**Evidence a WebView browser can do it.** DuckDuckGo's Android browser is built on System WebView.
Its help pages describe blocking third-party cookies through the WebView API "except when a Google
Single-Sign On (SSO) is in progress", which means Google SSO works there
([DuckDuckGo help](https://noai.duckduckgo.com/duckduckgo-help-pages/privacy/web-tracking-protections)).
That's indirect evidence, not a test of TRIF. **Unverified until the probe.**

**If Google refuses:**
- **Claude:** "Continue with email" always works. It sends a link, and if the link opens elsewhere
  (Chrome, on the same phone), claude.ai shows a **six-digit code** to type into the original page
  ([Claude support](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)).
  An account made with Google can use the same Gmail address by email.
- **ChatGPT:** email login, but some Google-made accounts have no password. Needs checking.
- **Google itself** (YouTube, Gmail in a tab): no fallback inside a WebView if Google refuses. That
  would decide it for GeckoView.

**Custom Tabs for the sign-in, then hand the cookies over? Not possible.** Custom Tabs use Chrome's
own cookie jar; the app can't read or write it
([Chromium Custom Tabs FAQ](https://chromium.googlesource.com/chromium/src/+/main/docs/security/custom-tabs-faq.md)).
Chrome's newer Auth Tab only returns a callback URL to **your own** OAuth client
([Auth Tab](https://developer.chrome.com/docs/android/custom-tabs/guide-auth-tab)). It can't sign the
app's web view in to claude.ai. Copying session cookies out of Chrome would need private access and
would break TRIF's own rule (no private routes or tokens of the chat sites). So the sign-in has to
happen in TRIF's own web view, as on iPhone.

**GeckoView.** It sends Firefox for Android's user agent and no app-name header. Firefox for Android
*is* GeckoView, so to Google a GeckoView app looks like Firefox. That's expected to pass, but no source
confirms it for third-party GeckoView apps. Google's policy wording covers "embedded" browsers in
general, so it **needs the same test**.

**Sharing cookies between the chat pane and tabs.**
- WebView: all WebViews in a `Profile` share one `CookieManager`, and the default profile is the
  whole app. So the chat pane shares cookies with the tabs, as on iPhone. `MULTI_PROFILE`
  (1.9) also allows separate jars (a private tab; a second account for one icon).
- GeckoView: one `GeckoRuntime` = one jar, and the same applies.
- Neither needs a "flush cookies" hack like iOS's `_flushCookiesToDisk`. On WebView,
  `CookieManager.flush()` is public.

### 3.4 Background sound and video, Picture-in-Picture

**WebView.**
- **Keeps playing:** a WebView keeps playing while the app is in the background, as long as the app
  doesn't call `WebView.onPause()` / `pauseTimers()` for that tab.
- **Staying alive:** Android will kill a background app unless it runs a **foreground service of
  type `mediaPlayback`** (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, Android 14+). That service has to start
  while the app is in front (Android 12+ blocks starting it from the background), so start it when a
  tab begins playing.
- **Lock-screen controls:** WebView has no system media session, unlike Chrome. TRIF builds one: a
  Media3 `MediaSession` whose player forwards play, pause and seek to the page through TRIF's world.
  It reads `navigator.mediaSession` metadata and `<video>`/`<audio>` state
  ([Media3 background playback](https://developer.android.com/media/media3/session/background-playback)).
  This is the Android version of iOS's `BackgroundPlay` plus the Now Playing info WebKit gave for free.
- **Pages that pause when hidden:** a page goes hidden when the activity stops, and YouTube pauses
  itself. As on iPhone, Tim's Background Play mod handles that, and TRIF respects a page that pauses
  itself.
- **Picture-in-Picture:** Activity-level PiP (`enterPictureInPictureMode`, with
  `setAutoEnterEnabled` on Android 12+) shrinks the whole activity. Show only the video's full-screen
  view (`WebChromeClient.onShowCustomView`) while in PiP
  ([PiP guide](https://developer.android.com/develop/ui/views/picture-in-picture)). The web's own
  Document PiP API isn't available in WebView. Feasible, but needs a prototype for the full-screen
  view plus PiP hand-off.

**GeckoView.** `MediaSession.Delegate` reports play/pause/metadata/position and full screen, and takes
commands, so lock-screen controls are wired more directly
([Javadoc](https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/MediaSession.Delegate.html)).
Firefox for Android does background play and PiP on GeckoView. Old bugs show Gecko pausing media in
the background in some cases. The app still needs the same foreground service.

**Play policy.** Play lists "Apps that access or use a service or API in a manner that violates its
terms of service" as abuse. Background YouTube play is a known source of Play rejections. Since mods
are the user's own, TRIF itself shouldn't advertise it (see 3.9).

### 3.5 Home Screen icons

Much easier than iOS: no profiles, no Web Clip page, no Settings detour.
- `ShortcutManagerCompat.requestPinShortcut(context, ShortcutInfoCompat, callback)` shows the
  system's "Add to Home screen" sheet and places an icon with TRIF's picture and name. It takes an
  adaptive-icon bitmap (`IconCompat.createWithAdaptiveBitmap`), so the TRIF rim-and-face design can be
  the icon itself
  ([ShortcutManagerCompat](https://developer.android.com/reference/androidx/core/content/pm/ShortcutManagerCompat)).
- The icon's intent opens a TRIF activity with `trif://open?url=…&app=1`, which goes straight to that
  site's tab in full screen (`WindowInsetsControllerCompat` hides the system bars). That's the same
  rule as iOS's `app=1`.
- **Caveats:**
  - Some launchers draw a small app badge on pinned shortcuts, and there's no API to remove it
    (launcher-dependent).
  - Each pin is one system sheet. "Add them all" becomes several confirmations in a row, not one
    profile.
  - Real installed web apps (WebAPKs) are only minted for Chrome.
  - Long-press shortcuts on TRIF's own icon (`setDynamicShortcuts`) are a free bonus.

### 3.6 Request interception: the tab lock and `site-data`

**WebView.**
- **What `shouldInterceptRequest` gives (per tab):**
  - It sees each request's URL, method and headers, and can answer it with its own response, for
    example to block it.
  - It **does not** expose request bodies (POST data), a long-standing limitation.
  - It isn't called for **WebSockets** (WebRTC isn't covered either). Confirm both in the probe.
- **Service workers:** requests made by a service worker go to the profile's
  `ServiceWorkerController` client with **no tab**. That's the same as desktop audit item TL-2:
  block writes from service workers for the locked site while a lock is on.
- **`site-data` (`trif.filterResponse`) needs nothing new.** The iPhone app already does it in the
  page (`mobile/shared/gen/page-bridge.js` wraps fetch/XHR in the page's world, only on matching
  pages), and that file works unchanged.
- **The tab lock's promise** ("nothing can post, send, save or carry what the page shows elsewhere";
  docs/TABLOCK-AUDIT.md) needs two layers on WebView:
  1. `shouldInterceptRequest` blocks write methods (POST/PUT/PATCH/DELETE) and cross-site loads for
     the locked tab. It's per WebView, so per tab.
  2. Things it doesn't see (WebSockets, and leaks from other tabs or workers) need a second layer.
     The candidate is androidx.webkit's `ProxyController.setProxyOverride`: route the app through a
     tiny in-app proxy while a lock is on, refusing connections to hosts other than the locked site's
     known ones. It's app-wide, so other tabs feel it during a lock.
     ([ProxyController](https://developer.android.com/reference/androidx/webkit/ProxyController).)
     Page-world wrappers on `WebSocket`/`RTCPeerConnection` would be a speed bump only.

  The iPhone app has no tab lock yet; it only matters when an agent's code runs in a phone tab (More,
  or My computer's tool requests). **Needs its own prototype before agent runs ship on Android.**

**GeckoView.** `declarativeNetRequest` (session rules, `tabIds`, initiator domains, methods),
`webRequest` blocking including `websocket`, and `filterResponseData` are all there. Desktop
`tablock.js`, which was audited and fixed in Chrome *and Firefox*, would run as-is. This is GeckoView's
clearest technical win.

### 3.7 Phone link

- **Discovery:** `NsdManager.discoverServices("_trif._tcp", PROTOCOL_DNS_SD)`, then resolve and read
  the TXT record `id` (`NsdServiceInfo.getAttributes()`).
- **Permission:** **Android 17 (API 37) blocks the local network by default** for apps that target
  it. They need the runtime permission `ACCESS_LOCAL_NETWORK` (in the Nearby devices group), and
  NsdManager counts as local-network access. There's a system picker that needs no permission, but
  it's for choosing one device
  ([local network permission](https://developer.android.com/privacy-and-security/local-network-permission)).
  Plan for one permission prompt, like iOS's Local Network question.
- **Noise (`Noise_IK_25519_ChaChaPoly_SHA256`, prologue "TRIF phone link 1"):** either
  - port `PhoneLink.swift`'s `NoiseInitiator` line for line onto standard primitives (X25519,
    ChaCha20-Poly1305, SHA-256, HMAC from Tink or BouncyCastle), checked against the same published
    vector its `selfTest()` uses; or
  - use [noise-java](https://github.com/rweather/noise-java), which implements that exact suite but is
    old.

  The port is probably simpler to trust, since the Swift one is already reviewed.
- **Storing the key (the Keychain equivalent):** keep the phone's X25519 private key encrypted by an
  AES-GCM key in the **Android Keystore** (hardware-backed, never leaves the device; StrongBox where
  present). Keep the file out of backups, which matches "this device only". JCA `XDH` key agreement is
  public from API 33
  ([KeyAgreement](https://developer.android.com/reference/javax/crypto/KeyAgreement)). Wrapping works on
  every version, so don't depend on Keystore-native X25519.
- **QR scanning:** CameraX plus a barcode library. ZXing keeps it free of Play Services (needed for
  F-Droid); ML Kit is smoother.

### 3.8 On-device model

- **llama.cpp builds for Android with the NDK** (an Android example lives in the repo). Backends:
  - **CPU** (arm64 dot-product / i8mm): the reliable path.
  - **Vulkan:** works, but results vary by GPU. A March 2026 issue shows it slower than the CPU on
    Adreno 740 with a small Qwen3.5 model
    ([#20603](https://github.com/ggml-org/llama.cpp/issues/20603)).
  - **OpenCL for Qualcomm Adreno:** upstreamed by Qualcomm
    ([write-up](https://proandroiddev.com/introducing-the-new-opencl-gpu-backend-in-llama-cpp-for-qualcomm-adreno-gpus-4093655d334c)).
  - **Hexagon NPU:** experimental.
- **NNAPI is deprecated since Android 15**, so don't build on it
  ([migration guide](https://developer.android.com/ndk/guides/neuralnetworks/migration-guide)).
- **What fits on mid-range phones** (6–8 GB, Snapdragon 7-series, Dimensity, Tensor, Exynos 13xx):
  the iPhone choices carry over. MiniCPM5-2B / Qwen3.5-2B at 4 GB (style JSON only), and Qwen3.5-4B
  at 6 GB or more. Expect writing speeds roughly like the SE's (single-digit to ~15 tokens/s on CPU).
  Community reports for 2–7B quantized models on Adreno phones are about 10–20 tokens/s with GPU
  offload. Measure with the `mobile/local-model` harness in the probe after the first.
- **Android-specific traps:**
  - Android kills background apps more readily, so a long request needs the app in front or a
    foreground service.
  - The WebView's renderer can be killed under memory pressure. **`onRenderProcessGone` must be
    handled**, or the whole app crashes with it.
- **Optional extra engine:** Gemini Nano through ML Kit's GenAI Prompt API on supported phones.
  Nothing to download, but only some flagships, and only while the app is in front
  ([ML Kit GenAI](https://developers.google.com/ml-kit/genai)). Worth a look later as "On this phone"
  without a download.

### 3.9 Distribution and policy

**Google Play**
([Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379)):
- *Allowed:* the ban on downloading executable code (dex, .so) "does not apply to code that runs in a
  virtual machine or an interpreter… (such as JavaScript in a webview or browser)". Mods are
  JavaScript in a web view, so they're fine. **Never download native code**: llama.cpp ships inside
  the APK, and only model *weights* (data) are downloaded.
- *But:* "interpreted languages (JavaScript…) loaded at run time… must not allow potential violations
  of Google Play policies". A reviewer could read AI-written mods as a way around policy.
- *And:* "Apps that access or use a service or API in a manner that violates its terms of service".
  Touchy spots:
  - the chat pane restyling claude.ai/chatgpt.com (hiding their upsells);
  - store screenshots of YouTube background play or ad-hiding mods.

  Present TRIF as a browser where *you* change pages, as Firefox with add-ons is presented.
  Restyling the chat pages is cosmetic, but **flag it to Tim**: it's the most likely thing a reviewer
  or the sites object to.
- *And:* no `addJavascriptInterface` in a view that loads untrusted pages (the policy names it).
  WebMessageListener in TRIF's world is the right tool.
- Foreground services need a declared type and a real use (mediaPlayback for playing media; downloads
  as user-initiated data transfer jobs).

**Developer verification (outside Play)**
([overview](https://developer.android.com/developer-verification),
[FAQ](https://developer.android.com/developer-verification/guides/faq),
[advanced flow](https://android-developers.googleblog.com/2026/03/android-developer-verification.html)):
- **What's enforced now:** since **30 Sept 2026**, certified Android 8+ devices in Brazil, Indonesia,
  Singapore and Thailand refuse apps from unregistered developers when installed from *participating
  stores*. Sideloads and other stores aren't covered yet.
- **2027:** it goes **global "for all apps on certified Android devices"**.
- **Registering:**
  - in the Android Developer Console: $25, government ID, and each package name and signing key
    registered;
  - or **free "limited distribution"** with no ID, but only up to **20 devices**;
  - existing Play apps (Play App Signing) are registered automatically.
- **Unregistered apps** then install only by **adb**, or after the user's **advanced flow**:
  1. turn on developer mode;
  2. confirm no one is coaching them;
  3. restart;
  4. wait **24 hours**;
  5. confirm with biometrics;
  6. allow for 7 days or indefinitely.

  Updates to unregistered apps fail if the flow is switched off.
- **What it means for TRIF:** register `com.timsrobot.trif…` (or whatever the package becomes) with a
  verified identity *before* 2027 even if TRIF never goes on Play. Then an APK from timsrobot.com
  installs normally. Keep the signing key safe: a lost key can't be re-registered.
- **F-Droid:** open-source apps can register too, including when F-Droid re-signs the APK with its
  own key; you add F-Droid's key fingerprint
  ([open-source registration](https://developer.android.com/developer-verification/guides/open-source-app-registration)).
  A WebView app builds on F-Droid easily, as long as it avoids Play Services (ZXing, not ML Kit). A
  GeckoView app on F-Droid has to build Gecko from source, which only a few big projects manage.

### 3.10 Build cost and reuse

**Language:** Kotlin, Jetpack Compose for the app's screens, the WebView inside an `AndroidView`.
Build with Gradle from the command line; testing goes in 3.11.

**Reused unchanged (or regenerated):**
- `mobile/shared/gen/*`: `mods.js`, `sandbox-runtime.js`, `page-bridge.js`, `panel-kit.js`,
  `mod-guide.txt`, `browser-checks.json`, the panel folder. Add an Android output to
  `mobile/prepare.js`.
- SES (`extension/vendor/ses.umd.min.js`).
- `mobile/shared/kit.js`, `modfile.js`.
- Test pages in `mobile/shared/pages`.

**Reused with a one-line bridge change:** each file reaches the app through exactly one
`webkit.messageHandlers.<name>.postMessage` call:
- `Web/chat.js` (916 lines): `trif`;
- `Web/mods-page.js` (1134): `app`;
- `Web/panel-adapter.js` (473): `panel`;
- `start-own.js`, `style-mirror.js`, `start-page.js`, `mods.html`, the CSS.

On Android that call becomes the WebMessageListener object in the same world. Replies go back with
`JavaScriptReplyProxy.postMessage` or `executeJavaScript` (1.16) instead of `evaluateJavaScript`. A
tiny shim can make both platforms use the same name, so these files stay shared, not forked.

**Rewritten in Kotlin:** the Swift side, about 16k lines in `mobile/browser-probe/TrifProbe`. Rough
equivalents:

| iOS | Android |
|---|---|
| Browser.swift, Tabs, History | WebView per tab, `Profile`, WebViewClient/WebChromeClient |
| Mods.swift, ModReader (JavaScriptCore) | `addJavaScriptOnEvent` per world; `mods.js` in JavaScriptSandbox or QuickJS |
| ClaudePane.swift | Up to 3 WebViews on the same profile |
| PanelChat.swift | Panel in a WebView with a `WebViewAssetLoader` for `trifpanel://` |
| PanelEngines.swift (Keychain keys) | Keystore-wrapped secrets |
| WebClip.swift + IconQueue.swift (~1.6k lines) | ~200 lines of `ShortcutManagerCompat` |
| PhoneLink*.swift, PhoneSync.swift | NsdManager, Kotlin Noise, OkHttp/raw sockets |
| LocalLlama/LocalModels | JNI to llama.cpp, WorkManager/DownloadManager |
| Safety, Diagnostics, Report | Same ideas |

The iPhone notes (`IOS-AGENT-NOTES.md`, `docs/IOS-APP-STRINGS.md`) are effectively the spec, and
the wording carries over.

**Rough size of the job:** a guess, not a measurement. One day for the probe (section 5). Then about
the iPhone app's own history again for the core: tabs, the three mod tiers, Mods tab, chat pane,
icons. After that, the phone link, local model and background play. GeckoView wouldn't shrink this
much: the Kotlin app is the bulk either way, and the iPhone app already reuses the extension's runtime
through `prepare.js`.

**Effort if Tim goes GeckoView instead:** the same Kotlin app. Plus the extension as a built-in
(adapt the side panel to a page in a GeckoSession or native UI, and replace `nativeMessaging` to the
helper with `connectNative` to the app). Plus wiring the `tabs` API delegates. Plus a monthly GeckoView
bump forever.

### 3.11 APK size and performance

- **GeckoView:** measured: the `geckoview-arm64-v8a` 160.0 AAR on Mozilla's Maven is **91.5 MB** (the
  all-ABI `geckoview` AAR is 245 MB). Mozilla's size bugs put Firefox for Android's arm64 APK near
  100 MB. **So yes, plan on roughly 90–110 MB for a GeckoView TRIF**, against about 15–30 MB for a
  WebView TRIF: app code, plus llama.cpp's .so (a few MB per backend), plus ~0.5 MB of JS.
- **WebView performance:**
  - It's Chromium, the engine sites are tested against on Android.
  - **All tabs share one renderer process per app**, so one crash takes every page down; handle
    `onRenderProcessGone`.
  - No site isolation between tabs, which is weaker against Spectre-class leaks than Chrome or
    Firefox. Acceptable for a browser of this kind, but worth knowing.
- **GeckoView performance:** multiple content processes (heavier at start, sturdier). Gecko's
  compatibility on Android is good but behind Chrome's on sites tuned for Chrome.
- **Memory:** 4 GB phones with several tabs, up to 3 chat pages and a 2B model will be tight on either
  engine, as the iPhone SE already shows. Keep the iPhone's rules: let background tabs go, at most 3
  chats, free the model.

**Practical note for building here:**
- The Android SDK, emulator and a system image take roughly 10–15 GB, and the Mac's disk was at 97%.
  Make room or use an external disk first.
- Run one emulator at a time, headless and muted (`-no-window -no-audio`), with modest RAM. This
  follows the standing rule after the Firefox test crashed the Mac: about a 1.5 GB watchdog and one
  browser suite at a time.

---

## 4. Risks

1. **Google sign-in in WebView** (high impact, unknown likelihood). If Google refuses both "Continue
   with Google" on the chat sites and Google's own sign-in, users lose YouTube/Gmail sign-in in TRIF.
   That would decide it for GeckoView. *Settled by the probe, day 1.* Even a pass can break later
   (Google tightens checks without notice), so keep plan B alive: keep the web files engine-neutral.
2. **The isolated world may not allow `eval` on strict-CSP pages.** If SES compartments can't evaluate
   in a named world on a page that forbids `unsafe-eval`, boxed mods fail exactly where they matter
   most. *Settled by the probe.* The fallback is an async box (hidden WebView) or GeckoView.
3. **New API, uneven support.** `JS_INJECTION_IN_FRAME_AND_WORLD` is six months old. Phones without
   updated WebView (no Google Play, some Chinese ROMs, Android Go) won't have it. The fallback is
   style mods only, plus "update Android System WebView".
4. **Tab lock gaps.** WebSockets (and WebRTC) aren't visible to `shouldInterceptRequest`. Agent runs
   on the phone shouldn't ship until the lock has a second layer (proxy) and an Android version of
   `docs/TABLOCK-AUDIT.md`'s tests.
5. **Play review.** AI-written code at run time, restyling claude.ai/chatgpt.com, and mods that touch
   YouTube/ads all invite "violates another service's terms" readings. Plan to ship from timsrobot.com
   first (registered developer, so normal installs after 2027), then try Play.
6. **Developer verification.** Global in 2027. If TRIF is unregistered, every user faces the 24-hour
   advanced flow. Register early; protect the key.
7. **Android 17's local-network permission** adds a prompt for the phone link. Explain it the way iOS
   explains Local Network.
8. **Background media is DIY on WebView** (service, media session, PiP). It's more code than iOS, but
   the path is known.
9. **Keeping two phone apps in step.** Every iPhone feature now has an Android twin. Sharing the web
   files and generating from `prepare.js` keeps most of TRIF in one place; the native halves will
   drift unless each feature's notes cover both.

---

## 5. First prototype (about a day): "TRIF Android probe"

The goal is to prove the two riskiest things, Google sign-in and the box world, before anything else
is built. It's a throwaway Kotlin app (`mobile/android-probe` on its own branch), one activity, one or
two WebViews, androidx.webkit 1.18, with PASS/FAIL lines to a log file like the iPhone probe's.

**A. Sign-in (needs a person: Tim types his own passwords; an agent never does).** It runs on the
emulator with a Google Play system image, or on Tim's Android phone if he has one and says so. Each
step is tried with three user agents:
- WebView's default;
- the default minus `; wv` and `Version/4.0` (what WebView browsers send);
- that plus matching client-hint metadata (`setUserAgentMetadata`).

The steps:
1. Sign in to Google directly (accounts.google.com → youtube.com, signed in).
2. claude.ai → Continue with Google.
3. chatgpt.com → Continue with Google.
4. claude.ai → Continue with email → the link opened in Chrome → the six-digit code typed into the
   probe.
5. A second WebView (the "chat pane") opened afterwards is already signed in (shared cookies).

PASS = signed in. Note what Google shows on failure (`disallowed_useragent` or "may not be secure").

**B. The box world (fully automatic, headless emulator).** Serve `mobile/shared/pages` (strict.html,
trusted.html, hostile.html, frame.html) from the Mac. For each page:
1. `addJavaScriptOnEvent(DOCUMENT_START, "*", world "trif-box")` with `ses.umd.min.js` +
   `sandbox-runtime.js`. Check that `lockdown()` runs, and that `new Compartment().evaluate("1+1")`
   works **on a page whose CSP has no `unsafe-eval`** and on the Trusted Types page.
2. In TRIF's world, insert a `<style>` on the strict page and check it applies.
3. The page's own script can't see the box's globals or call the box's message listener. hostile.html
   tries.
4. The scripts reach a cross-origin iframe (frame.html) and run before the page's first script.
5. Time lockdown (ms) on the emulator. On a mid-range phone too, if one is available.

**C. Quick checks if time is left:**
- `shouldInterceptRequest` sees a fetch POST (method yes, body no) but never the page's WebSocket
  (confirms the tab-lock gap).
- A `<video>` keeps playing with the app in the background under a `mediaPlayback` foreground
  service.
- `requestPinShortcut` puts an icon on the emulator's launcher that opens the site full screen.

**Decision after the day:**
- **A passes and B passes:** build on WebView as recommended.
- **A fails for Google's own sign-in:** run A on a bare GeckoView app (a second half-day). If GeckoView
  passes, build on GeckoView.
- **B fails (no eval in the world):** try the hidden-WebView box for a day before deciding. That path
  is slow, so it leans towards GeckoView too.
