# TRIF for Android: progress

The real Android app on the system WebView (decision: branch android-probe's PROGRESS.md, 2026-11-18). One chunk of
work per round (a fresh agent each time); this file carries what's known between rounds. Branch `android`, worktree
`~/WebMods-worktrees/android`, based on `ios-poc` (merge origin/ios-poc in at the start of every round).

Scope (Tim, 11-18): **the foundation only**. The UI layer (quick ask, done banners, chats list, mic, robot cover, tab
pictures, the toolbar's fine details) waits until Tim says the iPhone app's UI has settled.

Sources: ANDROID.md (`git show origin/landscape:ANDROID.md`), the probe (`origin/android-probe`,
mobile/android-probe), mobile/IOS-AGENT-NOTES.md (the iPhone app's map and Tim's decisions), docs/IOS-APP-STRINGS.md
(wording), docs/MOBILE-BEHAVIOUR.md (the shared behaviour spec both phones follow; merged in from ios-poc in round 7),
mobile/shared/core → gen/core.js (`TrifCore`: shared rules such as the link policy; call those rather than port Swift).

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

FOUNDATION COMPLETE (round 15, 2026-11-18)

## Foundation checklist

1. [x] The project: Gradle wrapper, app module, debug build installs and opens on the emulator; unit tests run.
2. The browser
   - [x] tabs with their own back/forward, kept across launches (round 2; the tab list is plain rows, the cards are UI layer)
   - [x] address/search bar (a plain field wired to `Address.resolve`; its compact/centred look is UI layer)
   - [x] real popup windows (round 3: onCreateWindow → a new tab after the opener's, a real window with an opener;
     window.close goes back to the opener; only from a tap)
   - [x] links to other apps (round 4: tapped → to Android; by itself → the question, one a load; frames never;
     intent: read as Chrome does, BROWSABLE only, its fallback page when no app takes it)
   - [x] minimum WebView version check (round 5: `WebViewCheck` before any WebView; too old / none → a screen with
     the Play Store button instead of the browser)
   - [x] default-browser role (round 5: http/https VIEW filter with no host + APP_BROWSER; can hold
     android.app.role.BROWSER; links open in it; the start page = address bar + start words)
   - [x] what a WebView doesn't do by itself and WKWebView does (round 15, `PageAsks.kt` + Browser's chrome client):
     a page's camera / mic / location ask (TRIF's question per site, then Android's own permission ask the first
     time; kept per site for the launch), `<input type=file>` (the system picker), full screen (over everything, the
     bars hidden, Back leaves it), downloads (a .js ≤ 2 MB, also a page's blob:/data: file → Add this mod?; the rest
     let go, as iPhone's ModDownloads). test/pageasks.sh on shared/pages/asks.html
3. [x] Script worlds (round 6): TRIF's world + the box (SES + sandbox-runtime.js) at document start; page world
   for free mods; the iPhone's injected scripts (kit.js, start-own/start-page, style-mirror.js, page-bridge.js, the
   free pair) in iPhone's order through `Scripts.kt` + two adapter scripts (js/world-call.js, js/webkit-bridge.js)
4. The mod engine
   - [x] mod store (round 7; round 11/12: holds and the change rules call the shared core, as iPhone's ModChanges: `Mod.kt` InstalledMod & co. under iPhone's JSON keys, `ModStore.kt` with every change
     iPhone's has: add/import/update + History, on/off per mod / per site / per tier, Pause all, Allow / Don't allow,
     edit + restore judged as changes, Recently deleted 30 days + Undo; `ModFiles` keeps it in files)
   - [x] reading mods with mods.js (round 8: `JsModReader`, mods.js in an androidx.javascriptengine JavaScriptSandbox
     isolate on the store thread; what it made of each mod kept in the mod's file, so a start needs no reader)
   - [x] @match matching (round 7: `MatchPattern` + `WebAddress`, as modfile.js matchesUrl; `ModStore.running/applies`;
     round 13: the shared core's what-runs rules, `ModRuns.kt` as iPhone's ModRuns.swift)
   - [x] style sections, boxed and free mods running (round 9: test/running.sh, all through the real reader, on
     strict.html; nothing needed fixing)
   - [x] holds waiting for Allow (round 9: a boxed mod with a power is held and doesn't run; Allow → it runs)
5. [x] Mods tab (round 10): the iPhone's mods.html / mods-page.js / panel-kit.js in a WebView of its own
   (`ModsPanel.kt`, served by WebViewAssetLoader at https://appassets.androidplatform.net/mods/), its messages through
   js/webkit-bridge.js as `webkit.messageHandlers.app`; state = `ModsState.kt` (iPhone's modsState); a changed plan
   loads the shown tab again when what runs there changed (`Browser.reloadIfStale`, iPhone's refreshIfStale)
6. Getting mods in
   - [x] a .js file opened with / shared to the app (round 11: imported as iPhone's importFiles, off at first; iPhone's
     words in a toast for now (the status strip is UI layer); the Mods tab opens; test/import.sh)
   - [x] "Add this mod?" for a pasted mod (round 12: SEND text/plain with ==WebMod== → `ModOffer.kt`, iPhone's
     ModOfferView's words in a plain full-screen dialog; other shared text opens as an address; test/offer.sh)
   - [x] import of desktop exports (round 13: `ModImport.kt`, iPhone's Import.swift: .js files and zips of them, zips
     in zips, picked with Import mod… (ACTION_OPEN_DOCUMENT, several) or opened with / shared to TRIF; Export and
     Export all mods for {site} to the share sheet through FileProvider). Not yet: a folder picked as a folder
     (ACTION_OPEN_DOCUMENT_TREE) and history exports (Android has no history yet)
7. Tests
   - [x] unit tests for Kotlin logic (one per piece; keep adding with each new piece)
   - [x] emulator tests, headless, with mobile/shared/pages: style mod (mods.sh), boxed mod, free mod's style
     section, held mod (running.sh), popup sign-in stand-in (popups.sh), the Mods tab lists / switches / deletes /
     restores (modstab.sh) all PASS; screenshots in mobile/android/shots/ (not committed). Round 14: `test/all.sh`
     runs them all (11 tests, ~7 min, ALL PASS)

## Done this round (round 16, 2026-11-18: one extra item, protected video)
- Protected (DRM) video, as Chrome on Android (Tim, through the coordinator: "follow what Chrome does"): Chrome's
  content setting is ALLOW by default on Android (content_settings_registry.cc), no question; per-site exceptions kept.
  So `PageAsks.Kind.PROTECTED` (RESOURCE_PROTECTED_MEDIA_ID) is granted with no question unless the site is switched
  off; the Mods tab's ⋯ "Protected content on {site}" (checked item) switches it, the tab reloads. Kept across launches
  in filesDir/page-asks.txt (`PageAsks.Kept(file)`; camera/mic/location still last for the launch).
- Tests: PageAsksTest (+2); test/protected.sh PASS (default allowed → "protected: ok" from Widevine on the emulator; off →
  NotSupportedError after the reload; kept after a relaunch; 127.0.0.1 unaffected; on again → ok); pageasks.sh PASS.
  asks.html has a Protected video button. Added to all.sh.

## Next step
FOUNDATION COMPLETE. The UI layer waits for Tim's word that the iPhone app's UI has settled. Optional small items
meanwhile, only if a round is asked for: a folder picked as a folder (ACTION_OPEN_DOCUMENT_TREE) for import; history
exports once Android keeps history.

## Notes for next round
- Protected video (round 16): `Browser.shownOrigin` / `protectedOn` / `setProtected`; logcat "page ask: <site>
  protected: allowed | off for this site | switched on|off". The emulator's Play image has Widevine: createMediaKeys
  succeeds when granted. Switching off takes effect on the reload (no WebView-wide cache got in the way).
- Page asks (round 15): `Browser.pageAsk` → `PageAsks.decide` (Refuse: tab not shown / TRIF behind / a question
  up; Known: answered this launch; Ask) → the AlertDialog → `fromAndroid` (asks Android only for what TRIF lacks;
  `Host.refusedForGood` → the "off for TRIF" toast). Logcat "page ask: <site> <kinds>: asked|Allow|Don't Allow|answered
  earlier…", "<site>: camera granted[, Android refused …]". MIDI is refused, as WebView's default; protected media:
  round 16.
- Downloads: "download: downloaded <name> (n characters): to Add this mod?" / "<name>: let go" / "couldn't download".
  http(s) fetched again with the WebView's cookies and user agent (HttpURLConnection, 2 MB cut); blob: read in TRIF's
  world (fetch works before the page revokes it); data: decoded. WebView passes no name for a blob's `download`
  attribute: a blob of JavaScript type counts as a mod file.
- Full screen: the page's view goes on the decor view, the content hidden from accessibility (uiautomator's
  `dump --compressed` shows only what TalkBack sees). File input: `params.createIntent()` (GET_CONTENT), PICK_PAGE_FILE.
- pageasks.sh: the emulator's GPS is slow to start; the test feeds `adb emu geo fix` every second and the page uses
  enableHighAccuracy (a low-accuracy ask timed out: no network location on the emulator). Android's dialog button:
  "While using the app". The file input's node is its "No file chosen" text.
- all.sh (round 14): `./test/all.sh [--no-build] [names…]`; per-test logs in $TMPDIR/trif-android-tests/<name>.txt;
  it clears logcat before each test. Take the device lock before it. Add each new emulator test to its default list.
- Offer box (round 14): `offerPlace` runs on the store thread (offerText computes `away` there, `ModOffer.show` takes
  it). `ModStore.coreAnswer(fullName, …)` is the general shared-rule call; `answer` prefixes "modStore.".
- What runs (round 13): `ModRuns.facts(m)` is what every shared rule reads of a mod (hold facts + on, sites, offSites,
  excludes); ModStore's `facts` is it. `WebAddress` (now in ModRuns.kt) drops an IPv6 host's brackets, as iPhone's URL
  does; its other cuts agree with iPhone's parts for canonical addresses (ModRunsTest.addressesAsIphoneCutsThem;
  Chromium hands WebView only canonical ones). The plan's `Scripts.Plan.runningOn` parses the address once.
- Import / export (round 13): `ModImport` is pure (take, unzip, write, exportSite, said; JVM-tested with real zips).
  MainActivity.importFiles reads each uri within the 64 MB budget, then `ModImport.take`. The picker result comes in
  `onActivityResult` (PICK_IMPORT; MainActivity is a plain Activity). Shared files: cache/export/<n>/ (cleared at the
  next export), FileProvider authority `com.timsrobot.trif.files` (androidx.core's, through androidx.webkit; no new
  dependency), res/xml/shared_files.xml. Logcat "share: <names>". The VIEW and SEND file filters now take
  application/zip too. The ModsPanel constructor takes `pickImport` and `share`.
- import.sh drives the page's own messages with `send '{ type: … }'` then `answer` (trif.panel runs sync code only, so
  the promise's answer goes into window.__r); reading the answer relaunches TRIF over the share sheet, so the sheet
  is checked (dumpsys topResumedActivity ~ chooser) before it. The picker itself isn't driven (DocumentsUI); its result
  goes through the same importFiles as VIEW.
- Change rules (round 12): `ModStore.answer()` tells "no answer" (`NONE`) from the rule's own null (`JSONObject.NULL`):
  reject's null means "delete it" (a mod that never ran). `pick(idx, list, new)` and `InstalledMod.take(fields, o)`
  mirror ModChanges.pick / InstalledMod.take. `waiting` is still the only Kotlin twin.
- Offer (round 12): `MainActivity.offerText` (readNamed with the shown site, cameFrom = Site.of(here)) → `ModOffer.show`
  (a Dialog, Theme_DeviceDefault_Light_NoActionBar) → `addOffered` (source "pasted"; iPhone's sheet uses "chat": same
  rules for a new mod). Logcat "offer: <id> <tier> from <site>[, <warning title>]", "offer: <id> declined", "said: …"
  (`say()` = the status strip's toast). Debug extra `trif.offer` (base64 text). Not ported: offer queues ("n of m mods
  in the reply": chat), chatOffers memory, the "Go to {site}" note. Tests share multi-line text with
  `adb shell "am start … --es android.intent.extra.TEXT '<text>'"` (no single quotes in it). A style mod's header needs
  `// @style` with the JSON after the header; `@powers click` + `@click …: selector` makes a held boxed mod.
- Shared core (round 11): `ModReader.core(name, argsJson)` runs `TrifCore.call` (gen/core.js, loaded into the
  reader's isolate after mods.js; JsModReader marks answers with \u0001 to tell them from a thrown message). JVM tests
  run the same file in Node (test/NodeCore.kt: one `node` process, found on PATH / NVM_BIN / ~/.nvm / Homebrew).
  Port further core rules the same way: Kotlin calls `core(…)` with iPhone's fallback for no answer.
- Playing (round 11): `Worlds.playing` = any frame's TRIF world said it plays (a media element playing, not muted);
  cleared at each main-frame onPageStarted. `Browser.put(plan, evenPlaying)` replaces the old `plan =` setter;
  MainActivity passes evenPlaying when `paused` changed. Debug extra `trif.pause` on|off → "pause: on|off".
  An emulator with -no-audio still plays <audio> (a tap starts it: mediaPlaybackRequiresUserGesture is on).
- Import (round 11): `MainActivity.importFiles` on the store thread; onCreate now queues the reader before
  `started()`, so a file in the launching intent finds it. Tests feed files through the media store
  (content://media/external/file/<id>; am grants -d only, so SEND tests pass the uri as -d too; am can't send
  SEND_MULTIPLE's uri list).
- Mods tab (round 10): `ModsPanel` is made on first use (MainActivity.showMods) and kept; `shown` gates asking the
  page; `pageChanged` (Browser.pageChanged, the shown tab started/finished) refreshes it. It doesn't ask the page while
  the tab is loading (calls to the page being replaced go unanswered: 2 s lost). Debug extra `trif.panel` = code run in
  the tab's page (shows it first) → logcat "panel: {ok, value}". The page's `import`/`export`/`exportSite` answer ok
  and do nothing yet (item 6). Not ported: closeIfDecided/holdFromChat (chat), safety (dismissOff, switchedOff),
  phone sync (sync, syncNow/Seen), hide rules (hidden, unhide), Send diagnostics, the toolbar's waiting count.
- Reload when mods change (round 10): each tab records at onPageStarted its url, `plan.signature(url)` and the ids
  that run (`loadedIds`, for the tab's nextLoad); `Browser.plan = …` and `select` reload the shown tab when the
  signature there changed. So `trif.addMod` now reloads the shown page by itself (tests still `open` again: harmless).
  A playing tab isn't reloaded (round 11, Worlds.playing).
- uiautomator: WebView content is in the dump (text="Outlined"; the panel's switches are class android.widget.Switch).
  Borderless Buttons are all caps unless `isAllCaps = false` (Mods, Done have it).
- running.sh (round 9) is the pattern for mod tests: `add` (trif.addMod, logs "add mod: <id> <tier> <world>
  runs|held"), `extra trif.allow <id>` ("allow: <id> runs|held"), `call box …` reads `__trifSandbox.logs` (a
  boxed mod's trif.log stays in the box, as on iPhone; only free mods' lines go to the app as "mod log").
  A click power needs its target in the header (`// @click the close button: button.banner-close`), else
  the reader refuses the mod. Mod ids are `localhost/<name-kebab>`.
- Threads (round 8): ModStore is touched only on MainActivity's `work` executor (`work.execute { mods.… }`); its
  onChange posts the plan to the main thread (`showPlan`). JsModReader throws on the main thread. Startup: if
  `mods.needsReading` is false the plan and tabs go at once (scripts kept); else `started()` waits for the reader
  (or 3 s). A debug `trif.testMods` plan (`testPlan`) wins over the store's for that launch.
- `am start` extras: a base64 mod of ~93 KB passes; ~400 KB silently doesn't start (adb/am limit). For big test
  mods, add a file route when item 6 brings the file intent.
- Logcat: "mod reader: sandbox N ms, mods.js M ms", then "mod reader: ready, K mods, T ms" (or "didn't start");
  "add mod: <id> <tier> <world> runs|held" or "add mod: error <why>".
- Mod store (round 7): pure and synchronous; methods that read (reread, reject, restore, saveEdit, readNamed) call
  the reader directly, so with a slow engine call them off the main thread (or give the reader a blocking call made
  off it). Files: filesDir/modstore/mods/<site__name>.json + order.json, mods-deleted.json, mods-settings.json
  (groupsOff, paused, the reader's version and free pair). Times are epoch ms. `script`/`styleScript` are kept
  (since round 8; iPhone doesn't): a mod without them is skipped in the plan until `reread()` with a reader. Signature hashes are Kotlin hashCodes (only
  compared within a launch, as iPhone's Hasher). Not ported: phone sync (syncTake/syncRemove), the move from
  UserDefaults, ModOfferView (UI, item 6), check()'s lint shape is whatever mods.js gives.
- Kotlin nests block comments: a `/*` inside a KDoc (e.g. a match pattern like `https://x.com/` + `*`) opens one and
  the file fails with "Unclosed comment". Keep patterns out of comments or break them.
- Scripts (round 6): `browser.plan = …` puts a plan's scripts into every live WebView (next load) and every new one.
  Assets by name: `browser.text("web/style-mirror.js")` (web/ = the iPhone app's Web/, gen/, shared/, js/ = ours,
  ses.umd.min.js). Not ported yet: iPhone's stallWatch, BackgroundPlay.watch, VideoResume.watch (Swift strings;
  they come with their features), the hide rules (start-own gets `{}`), `freeScripts` (from mods.js, item 4).
- Debug hooks (MainActivity.debug, debug builds only, base64 extras): `trif.testMods` = JSON
  [{id, script, world, at, style, off}] → the plan; `trif.call` = "world:code" (an async body; page world: sync
  only, evaluateJavascript) → logcat "call: <world> ok <value>" / "error <why>". worlds.sh shows the use.
- Measured: on Android a <style> TRIF's world (or the box) appends IS refused by the page's CSP (strict.html: both
  sheets null, 2 adopted sheets from style-mirror.js), so style-mirror.js matters here as on iPhone. Eval
  (AsyncFunction captured before SES) works in both of TRIF's worlds on a no-unsafe-eval page.
- A world's `call` goes through the page's last hello (world-call.js at its start): a call before the page's first
  script runs answers "nothing of TRIF's in that world", a stale one times out (5 s).
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
- Test flake (round 5): `adb install -r` while TRIF is in front makes Android 17's systemui (PackageUpdateActivity)
  relaunch it with its last intent, racing the test's own `am start` (a stale tab, a missed extra). Every test now
  force-stops TRIF and goes Home before installing; first launches use `am start -S`. Keep that in new tests.
- Android answers an https `query-activities` with the default browser alone: ask it after taking the role.
- A WebView swapped into the page takes the focus from the field (else the field keeps focus and stops updating).

## For Tim
- Round 16 (protected video, e.g. Netflix-style sites): now plays, as in Chrome on Android, which allows it by default
  with no question. Your draft question isn't used, since Chrome doesn't ask. Instead, each site can be switched off
  in the Mods tab's ⋯ menu: a checked item "Protected content on {site}" (Chrome's own label, a draft in STRINGS.md).
  Switching it off is kept across launches. When the UI layer starts, a site-settings place (Chrome's is page info →
  Site settings) may be a better home than the Mods tab's menu.
- Round 15: pages can now use the camera, microphone and location, pick files for upload buttons, go full screen, and
  a downloaded .js mod goes to "Add this mod?" (as on iPhone). New words, drafts in STRINGS.md: TRIF's own question
  before Android's permission ask, after the one iPhone's WebKit shows: "Allow “{site}” to use your camera?" (…your
  microphone? / …your camera and microphone? / …your current location?) with Don't Allow / Allow; and, when Android has
  turned TRIF down for good, a note such as "The camera is off for TRIF. To use it on pages, allow it in Android's
  Settings, under Apps, TRIF." The answer is kept per site until TRIF closes (Allow and Don't Allow), so a page can't
  ask over and over. Android's own dialog ("Allow TRIF to take pictures and record video?") is the system's; it comes
  once, the first time any site needs it. TRIF now lists camera, microphone and location permissions (Play shows them).
- Round 14: one script now runs every Android test on the emulator; all 11 pass. Nothing to see or decide, no new words.
  Before calling the foundation done I checked it against what the iPhone's web view does by itself, and found four
  things Android's needs added: choosing a file for a page's upload button, fullscreen video, a page asking for the
  camera, mic or location, and downloads (a downloaded .js mod goes to Add this mod?, as on iPhone). That's next round.
- Round 13: the Mods tab's ⋯ menu now has Import mod… and Export all mods for {site} (the iPhone's words), and Export in
  a mod's code view works: files go to Android's share sheet. A zip of mods (desktop's site export, zipped) imports
  like single files, so TRIF now offers itself for opening zip files too, as the iPhone app does. Under the hood, the
  mod switches and which mods run on a page now follow the shared rules. No new words, no new downloads.
- Round 12: TRIF now shows in Android's share sheet for text. Shared text with a whole mod in it gets "Add this mod?"
  (the iPhone's sheet and words, plain look for now); any other shared text opens as a page or a search, as Chrome does.
  No new words. Under the hood, adding, History, Recently deleted, Undo and Restore now follow the iPhone's shared rules.
- Round 11: nothing new to decide. Mod files opened with or shared to TRIF are imported with the iPhone's words
  (said in a small pop-up note for now; the iPhone's status strip comes with the UI layer). Mod changes no longer
  reload a page playing sound, as on iPhone. The "Can't run here on iPhone" line is left as you asked.
- Round 10 (the Mods tab): it's the iPhone's own Mods page, unchanged, in a sheet with Mods on {site}, ⋯ and Done.
  No new words (all iPhone's; STRINGS.md lists them). One shared line names iPhone: a free mod a page won't let start
  says "Can't run here on iPhone: this page didn't let it start." (mods-page.js, ios-poc's file, so I left it). Fine to
  make it "on this phone" in the shared page, or should Android pass its own word in?
- Round 9 (mods running): nothing to see or decide; no new words, no downloads. Boxed, free and style mods and
  holds all work on Android as on iPhone, tested on a strict page.
- Round 8 (the mod reader): nothing to see or decide; no new words, no new downloads beyond Google's Maven
  (androidx.javascriptengine). One storage difference from iPhone: Android keeps what the reader made of each mod
  in the mod's file, so the app opens without waiting about a second for the reader.
- Round 7 (the mod store): nothing to see or decide; no new words.
- WebView check (round 5): new screen, draft words in STRINGS.md ("TRIF needs a newer Android System WebView" …
  "Open the Play Store"). Shown only on phones whose WebView is older than 149 (or switched off).
- App links (round 4): the question is always the generic "Open this page in another app?" (Android can't name the
  app for certain, so never "in “Phone”"); the no-app note is a draft: "No app on this phone can open this link."
- Nothing needs you yet. One small difference from iPhone: when a page closes its own window (a sign-in window
  finishing), Android goes back to the tab that opened it; iPhone shows the tab in its place (often the same tab). One choice made for now: plain Android Views rather than Jetpack Compose for the
  foundation (smaller and faster to build); Compose can come in with the UI layer if you want it.
