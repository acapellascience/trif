# TRIF on a phone: two probes

Two test apps that ask an iPhone what a TRIF for iOS could do. Neither is TRIF. Each one runs a list of
checks, lets you try the "point at it" idea by hand, and makes a report you send back.

| | Asks | Where it is |
|---|---|---|
| **Safari probe** | What could TRIF do as an extension to Safari on iPhone? | `safari-probe/` |
| **Browser probe** | What could TRIF do as its own browser app? | `browser-probe/` |

Nothing here has been run on a Mac or a phone. The Safari probe's code and every JavaScript check have been
run in Chromium (`TRIF_BROWSER_TESTS=1 node mobile/test/smoke.js`, in Chrome for Testing). The Swift has only been checked for syntax: expect to fix a
compile error or two in Xcode, and send them to me.

## What the answers decide

The same questions are put to both, so the reports can be read side by side.

| Question | Check | If yes | If no |
|---|---|---|---|
| Can code written later run in the page's own world? | Safari `main.written` | Free mods work in Safari on iPhone the way they do in Safari on Mac (the `toString` way in `extension/safari.js`). | No free mods in Safari on iPhone. Style mods only, unless the box works. |
| Does that survive a strict page? | the same, on `strict.html`, `trusted.html` and github.com | Free mods work on the sites people most want fixed. | They work only where the page allows `eval`: not x.com, not Instagram. |
| Can a world beside the page evaluate code? | Safari `own.eval`, `box.compartment`; browser `own.eval`, `box.compartment` | **The box works.** Boxed mods run on the phone. In Safari this would be the main tier. | No box there. Chromium says no for an extension's world, which is why TRIF uses a user-scripts world on desktop; Safari and WKWebView are the open question. |
| Does TRIF's sandbox runtime run as it is? | `box.start`, `box.run`, `box.confined`, `box.mod` | The desktop runtime ports unchanged. | The error text says what WebKit lacks. |
| What does locking down cost per page? | `box.start` detail (`lockdownMs`), browser `box.ses` (`loadMs`) | Under about 50 ms: load it on every page. | Load it only on sites that have a boxed mod. |
| Are hide rules in before the first paint? | `timing.start`, `timing.own`; the report's "loads" | No flash of the thing you hid. | A flash on every load. In Safari the fix is a content blocker; in the browser it's `blocker.works`. |
| Do selectors made by pointing last? | hide things, browse for a few days, read "a saved rule no longer found anything" | Point-and-hide stands by itself. | It needs TRIF's text-based rules (`@rules`) underneath, or it's a toy on sites with build-tool class names. |
| Can the page see or break TRIF's world? | `worlds.separate`, `worlds.clean` on `hostile.html` | The kit can be trusted on hostile pages. | Everything in that world has to be written as defensively as a free mod. |
| Can requests be blocked per tab or per site? | Safari `network`; browser `blocker.works` | A tab lock is possible if an agent ever runs on the phone. | Not needed for point-and-hide or mod links. |
| Can the extension's app half hold files and fetch? | Safari `native` | Mods and the catalogue can live in the app, shared with the extension. | The extension keeps everything in its own storage. |
| How often does Safari restart the background? | Safari `lifetime` | (information) | Design for a background that knows nothing when it wakes. It already has to on Mac. |
| Does Claude sign in inside an app's web view? | browser, by hand (below) | "Claude in a pane" is real. | The pane is dead; the route is the share sheet to the Claude app and a link back. |
| Does a link in Claude's reply reach the app? | browser, by hand | The loop closes with no server. | Fall back to copy and "Add a mod from the clipboard". |
| Is the phone's own model usable for this? | browser `ondevice`, and "Ask the phone's own model" | A free middle tier between pointing and Claude. | Skip it for now. |

## Before either: the test pages

`shared/pages/` has five pages with the same body (a sticky banner, a feed with a promoted post, a sidebar,
a cookie box, build-tool class names, a shadow root, a frame) and different rules:

- `plain.html`: no policy.
- `strict.html`: a strict Content-Security-Policy, as a header.
- `heavy.html`, `heavy-strict.html` (not the same body): a page like x.com's timeline, to measure what the app adds
  to a heavy page: insertRule CSS, a virtualised list of up to 2000 cells, fetched JSON pages, counters changing;
  `#bench` scrolls it for 20 s and puts frame times and idle time in window.__bench (heavy.js).
- `trusted.html`: the same, plus Trusted Types.
- `hostile.html`: the page replaces `querySelector`, `JSON.stringify`, `Array.prototype.map` and others.
- `spa.html`: more posts arrive after a moment; "Explore" swaps the feed without a page load.

The browser probe carries them inside the app. The Safari probe needs them served:

```
node mobile/serve.js
```

It prints the address for the Simulator (`http://localhost:8377/`) and for a phone on the same Wi-Fi.

## The Safari probe

```
node mobile/safari-probe/build.js
```

On a Mac this puts the extension together, has Apple's converter wrap it in an iPhone app project
(`mobile/build/safari-app/`), and opens Xcode. Then:

1. In Xcode, pick your team under Signing & Capabilities for both targets (the app and its extension). If the
   bundle id is taken, run again with `TRIF_PROBE_BUNDLE_ID=your.own.id`.
2. Run it on a simulator first, then on your iPhone.
3. On the device: Settings → Apps → Safari → Extensions → TRIF Probe → on, and allow it on all websites.
   (Per-site permission is itself a finding: note how many taps it took and what Safari asked.)
4. In Safari, open a test page. Tap the puzzle-piece button → TRIF Probe.

In the popup:

- **Run the checks on this page.** About ten seconds. Do it on all five test pages, then on github.com and
  two or three sites you'd want to fix. Reload a page once before its first run (two checks need a load
  that happened after the extension was allowed).
- **Pick something to hide.** The popup closes; tap a thing on the page. A bar at the bottom names it and
  offers Hide this, Hide all like it, or Wider. Reload: it should stay hidden.
- **Copy this page's outline.** Puts a short outline of the page on the clipboard, and records whether
  Safari let it.
- **Open the full report** → Copy the report, and send it to me.

By hand, and worth a sentence each when you send the report:

- Open `http://…:8377/trif-install#hide=.cookie-consent` from another app (Messages, the Claude app). Does
  it open Safari, and does the report list it under mod links?
- Leave the phone alone for an hour with Safari in the background, then open the report: the background's
  start count and alarm count say how often Safari kept it alive.
- How does tapping to pick feel against a real site's own tap handling?

## The browser probe

Open `mobile/browser-probe/TrifProbe.xcodeproj`, pick your team, run. It needs iOS 17; the on-device model
check needs iOS 26 on a phone with Apple Intelligence (iPhone 15 Pro or later), or the Simulator on an Apple
silicon Mac that has it turned on.

It starts on the plain test page (afterwards, on the tabs it had). The address bar has reload (stop while
loading). The bar at the bottom, left to right: back, forward, **chat** (the chat, full screen), **Mods** (the robot;
its badge counts the site's mods waiting for an OK), **tabs** (the number open), and **⋯**: New tab, History,
Import…, the wand's items (outline, clipboard, the phone's model, forget), and **The probe** (Checks, Report,
the test pages and a few real sites). What each of tabs, history, Mods and Import does: "The browser probe as
an app", below.

- **Checks → Run the checks on this page.** About twenty seconds; the last two reload the page. Run on all
  five test pages, then on real sites.
- **Long-press anything** on a page. The app marks it and offers Hide this, All N like it, or Wider. Reload:
  it's hidden before the page draws, because the rules are part of the script WebKit runs first.
  Note what the long press fights with: text selection, the page's own long-press menus.
- **Wand → Ask the phone's own model.** Say what bothers you; the model gets the page outline and picks a
  part; the app marks it and you confirm.
- **The chat** (Claude or ChatGPT, the switch at its top). Tap the bubble: the chat opens full screen over the
  tab, with the tab's data already in its message box (in a chat without TRIF's instructions yet: how mods are
  written, the page's outline and a screenshot, as TRIF instruction; in one that has them: the page now, the
  mods on it with their errors, as TRIF follow-up). Say what you want and send it yourself: the app goes back
  to the tab at once, and the bubble's dots move while the reply is written. When it's done, the app shows
  "Add this mod?" for each mod in the reply, over the tab; nothing is added without Add it. A reply with no
  mod in it puts a green mark on the bubble; tap it to read the reply. ‹ {site} at the chat's top goes back.
  Signing in (email, Google, Apple; a window the chat opens shows as a sheet) happens in the chat's own page.
  The toolbar stays under the open chat: the robot (the chat button) takes you back, as does ‹ {site}.
- **The bars follow the page** (iOS 26 and later; TrifProbeApp.swift BarState): scrolling down shrinks the
  address bar to the site's name and slides the toolbar away; scrolling up, the top of the page, a tap on the
  small bar or a new page load brings them back. The page lies under the bars and isn't resized while they
  move; WebKit is told what they cover (obscuredContentInsets) once they settle.
- **Report → Share the report**, and send it to me. It names the sites you ran it on and which addresses
  the chat went to (never what was typed or said there).

The chat runs TRIF's script (TrifProbe/Web/chat.js) in a world of its own beside the chat's page: it fills the
message box, notices a send, watches whether a reply is still being written (Claude's stop button and its
streaming mark; ChatGPT's stop button; else the reply unchanged for six seconds) and reads the code blocks
written in the reply. It never presses Send and never reads the rest of the conversation. It reads only what the
page shows: no internal routes of claude.ai or chatgpt.com, no session token, no cookie (Tim, 11-16: nothing against
their terms). A .js file a reply attaches comes to TRIF only when the person taps it: a download the app catches
(ChatGPT's file links, and a viewer's own Download button), or, when the tap opens the chat's own viewer over the
conversation (Claude's file cards, 11-16), the code the viewer shows, read off the screen without its line numbers
(chat.js VIEWER, viewerCode: the viewer's markup isn't known signed in, so whatever covers the message box counts too,
as does an address with /files/, /artifacts/ or /canvas in it). A viewer that showed no mod's code is noted in the
diagnostics. The page's data goes into the message box only while a person could use it: shown, on the screen, with
nothing over it (no viewer, sheet or dialog); meanwhile the fill waits, as long as the viewer stays open and the chat is
shown, and goes in when it closes. The stand-in has such a card and viewer ("viewer" in a message; `?viewerroute`).

## The browser probe as an app (branch ios-poc, 11-15)

Built on the probe, toward something to use every day:

- **Tabs** (TrifProbe/Tabs.swift). Each tab is a web view of its own (its own back and forward), all made from
  one configuration, so every tab gets the same scripts, mods and sign-ins. The switcher shows each tab's
  picture; + opens one, × closes one; a link or page that opens a window opens a tab after its own. Tabs and
  their back/forward lists (WebKit's interactionState) are kept between launches. A new tab shows the sites
  visited lately under the address bar.
- **The chat follows the tab's site** (ClaudePane.follow). Each site (its domain) keeps its own conversation:
  switching tabs, or going to another site, brings that site's chat back, or a new one. Start over forgets
  the site's.
- **TRIF chats in a project** (ClaudePane: ChatService.project, openProjects, ProjectOffer; 11-16). ⋯ → Keep TRIF
  chats in a project… copies TRIF's instructions (the reply note plus the mod guide) and opens the service's
  projects; the person makes the project there. On a project's page the chat offers Use this project for TRIF
  chats, which keeps that URL (with whether the instructions were pasted in). New chats start there (no private
  APIs: just that page's composer); with the instructions in the project, the first message is the page alone,
  without the 16 KB guide. Project chats still show in Recents on both services (user reports, 11-16), so this
  groups them, it doesn't hide them. Unchecked on real logged-in pages: Claude's `/project/<id>` and ChatGPT's
  `/g/g-p-<id>-<name>/project` composers. The stand-in: serve.js answers `/project/<id>` with chat.html.
- **Each conversation belongs to one site** (ClaudePane.owner/setOwner, 11-16: an NYT tab got a follow-up in Tim's
  YouTube conversation). A conversation is recorded for the site it was started for; a site's chat reopens only a
  conversation recorded as its own (one kept before this, or another site's, gives a new chat, to the service's new-chat
  or project page); a follow-up goes only into a conversation that has TRIF's instructions and is this tab's site's;
  another site's conversation gets the whole instructions with "This is a different site: …". The chat shown while all
  three are busy gets nothing put in it. Each fill's line in the report says the conversation, its site and why
  instructions or a follow-up. More's sessions go on only for their own site. More → Claude and Ask Claude go the same way.
- **ChatGPT's newer mobile page** (seen logged out, 11-16): messages are li[data-message-role], a reply is done when its
  li has data-message-complete (it pauses while it searches, with no stop button, which ended the watch early), and its
  conversations are /uc/<id>; its file inputs take pictures only (a text file given to one said "The selected file is
  not a supported image.", which read as the screenshot failing): a file input is given only a file its accept takes,
  and where none takes text the instructions are typed in. Code blocks are read line by line (a code editor's lines
  too, .cm-editor/.cm-line); Add to TRIF hands over on the press itself. A reply with code but no mod read from it is
  noted in the diagnostics ("chat"). The stand-in has it: `?octane` (and `?cm` for editor lines).
- **More than one chat** (ClaudePane: ChatView, viewFor, release; 11-16, Tim approved). Up to three chat pages, each
  its own web view (sharing the sign-ins) with its own conversation, reply watcher and pending fill; all stay in the
  view tree (the shown one on top), so a reply goes on being written while another chat shows. The robot opens the
  shown tab's site's chat (on the chosen service), or a new one; a reply done in a chat that isn't showing still
  goes to Add this mod? (or a notification in the background). The top bar's list (two or more open) switches
  between them, marking the one writing. A fourth releases the least recently used chat that isn't writing (never
  a working one; its conversation is kept by address, so opening it again loads it); a memory warning releases every
  idle chat that isn't shown. Each is logged in the diagnostics ("chats") with the count and the memory left
  (os_proc_available_memory, 0 in the Simulator). The double-fill record, the viewer and fill rules, projects,
  reload and back are each chat's own. Dev steps: chats, showchat, memwarn.
- **More: the side panel's own chat, on an API key or this iPhone** (PanelChat.swift, PanelEngines.swift,
  Web/panel-adapter.js, Web/panel-phone.css; 11-16). The robot view's switch is Claude · ChatGPT · More. More is the
  desktop side panel itself: `node mobile/prepare.js` copies extension/sidepanel.html and every module it imports
  (followed from its imports, so a new one can't be missed) into mobile/shared/gen/panel, unchanged but for two lines
  in the page (the adapter and the phone's styles), and `--check` fails when they drift. The app serves it at
  trifpanel://panel/. The adapter is what the panel gets from the background and the helper on desktop: storage (kept
  in Application Support/panel-store.json), the shown tab as its window's active tab, and the requests (status,
  agent.list, agent.models, agent.start/stop, chat.clear, chat.note); a run's events go into `chat:<site>` as
  background.js onAgentEvent puts them there, so messages, tool lines, errors, Stop and New chat are the panel's own.
  The engines are its agents (On this iPhone, Claude API, OpenAI API, OpenRouter), each with the panel's model and
  effort pickers (the service's own model list once a key is saved; Other… takes any exact name). Missing a key, an
  engine is "logged out" with the panel's own notice. Keys: Settings → API keys (added by the adapter), kept in the
  Keychain on this device only (`WhenUnlockedThisDeviceOnly`, not synced), never sent back to the page, never logged,
  sent only to that engine's host over HTTPS. The APIs: Anthropic's Messages API (streamed; thinking blocks passed
  back as they came; prompt caching; server-side fallbacks on Opus 5.5, Sonnet 5.5, Fable 5.2), OpenAI's Responses
  API (streamed, `store: false`, reasoning items passed back), OpenRouter's chat completions. Tools against the tab
  the run started on: read_page, try_mod (style or boxed, TRIF's runtime, no powers, taken off by reloading the tab
  when another is tried or the run ends), screenshot (models that take pictures); their results go to the model
  marked as the website's data, not instructions; at most 15 steps. The mods in the replies go to Add this mod?.
  On this iPhone runs a small model on the phone itself (mobile/local-model/README.md: llama.cpp, the models, the
  research, a Mac harness); in the Simulator, where it can't run, a stand-in (a canned reply with a small style mod) too.
  Testing: `node mobile/mock-api.js 8379` and the app with `-apibase http://localhost:8379` (a loopback address only)
  and the key `sk-test-not-a-real-key`; never a real key. The mock follows a script (read_page, try_mod, the mod;
  "loop" for the step cap, "slow" to try Stop) and refuses a turn that lost its thinking block or reasoning item.
  In the Simulator the Keychain needs the app signed to run locally with an entitlements file (application-identifier
  and keychain-access-groups); unsigned it answers -34018. Unverified: real services, real keys, and the Keychain in
  a sideloaded build (the signing tool gives it its entitlements).
- **History** (History.swift). Every page any tab shows, newest first, by day; search, tap to open, long-press
  for a new tab, swipe to delete, Clear… (last hour, today, all). Kept in one file in Application Support, left
  out of backups; nothing sends it anywhere.
- **The Mods tab** (ModsPanel.swift, Web/mods.html, mods-page.js, mods-page.css). The desktop side panel's mods
  list for the shown tab's site, drawn with the panel's own sidepanel.css and switch.css and its shared code
  (shared/gen/panel-kit.js: icons, modlevel, explain with explain.json, modswitch, the robot). The tiers with
  their colours, counts, On / Off for the site and "i"; each row's light (started on this page), name, power
  icons (a tap says what each does, with Details), one tag (new, updated, on hold, change on hold, error),
  switch (a mod for several sites: its switch is the site's), description, </> and the bin (with Undo); the
  mods for other pages of the site folded into one line. The approval card and the code card (Details, Code,
  History with See differences and Restore, Copy, Export to the share sheet) are the panel's, in the mod's tier
  colour with the robot. Things hidden by long-pressing are listed under the mods.
- **Mods are read and held as on desktop** (shared/modfile.js over the helper's own files, bundled by
  prepare.js into shared/gen/mods.js). The id, hash, header, a boxed mod's powers and values and a style
  section are helper/lib/mods.js buildMod's. A mod waits, never running, while it needs something the user
  hasn't allowed (held.js): a boxed mod's powers (not the soft ones) and their combinations, or what TRIF's
  reading of a free mod's code found (powers.js), line by line. A new version that needs more: the version
  before keeps running ("change on hold") until Allow or Don't allow. Style mods run in TRIF's world, boxed
  mods in the box world with SES and TRIF's sandbox runtime, free mods in the page's own world (WebKit puts the
  script in before the page's own, whatever the page's policy: the probe's timing.page check). A free mod that
  should have started on a page and didn't says it can't run there on iPhone. The proof of concept's mods are
  read again into this, as allowed (each was added from its own Add this mod? sheet).
- **Editing a mod** (the code card's Code tab: Edit; mods-page.js, ModStore.saveEdit). A plain editor (no
  autocorrect, capitals or smart punctuation: curly quotes and dashes the keyboard makes are put back as typed),
  numbered lines, the system's undo plus Undo and Redo buttons, Cancel and Save. Save checks it first as `trif
  check` does (modfile.js checkMod: the header, a style mod's rules and CSS, the syntax, and for a boxed mod what
  the sandbox would refuse, sandboxlint.js) and saves nothing broken: it says what's wrong, with a tappable line.
  A saved edit is any change: the version before goes into History ("before you edited it"), and it's judged as
  held.js judges a change, the user's own edit included: a new power, a new line using one, a @match for another
  site (while the mod can do something there), or becoming a free mod waits for an OK while the version before
  keeps running; anything else runs at once. Undo right after Save puts the version before back (the edit stays
  in History). The mod's id and site stay as they are whatever the header says (desktop's: the file doesn't move
  when its header changes; a new @name is only its name).
- **Getting out of a mod that wrecks a page** (Safety.swift, 11-15). Safe mode: if the app quit while in front
  with mods running on a site, the next launch switches those off and says so (over the page and in the Mods
  tab), to switch back on one at a time. Pause all mods: the Mods tab's ⋯, or the app icon's long-press menu.
  A runaway page: each page's main thread is watched (Diagnostics.stallWatch: half a second of frames every five
  seconds); busy half the time or more for 40 seconds with mods on, or its process ended twice in three
  minutes, and the app offers to switch the site's mods off, naming the one changed most recently.
- **Diagnostics** (Diagnostics.swift; the Mods tab's ⋯ → Send diagnostics…): with times, the pages loaded and
  their mods, pages kept busy (how busy, the longest stall, element count), WebKit ending a page's process (the
  tab reloads it), memory warnings, the app's own main thread blocked over 500 ms (with what it was doing), a
  view redrawn 50 times in a second (an update loop), safe mode, mod errors, background tabs let go.
- **Background tabs let their pages go** after 20 seconds (and at once on a memory warning), keeping the
  address, back/forward list and picture; the page loads again when the tab is shown.
- **Storage**: mods in Application Support/mods (one file each, without the code made from it, at most ten
  earlier versions, written off the main thread), the report in report.json; both moved once from the settings.
- **Import** (Import.swift). Mods as desktop TRIF exports them (helper/lib/share.js: a mod's `<site>-<mod>.js`,
  a site's folder `<site> mods`, or either zipped, as AirDrop sends a folder) from Files (⋯ → Import…, or Import
  mod… in the Mods tab), or opened in the app from the share sheet or AirDrop (Info.plist's document types:
  .js, .zip, .json). Each is named and kept as desktop's import does (its site from its @match, its name from
  the file, no @source / @version), starts off, marked new (updated, when it replaces one: the one before is
  in its History), and waits for its OK like any mod from outside. Export and Export all mods for {site} go
  the other way, through the share sheet.

### Importing from other browsers: what's built, what's possible

| What | From | State |
|---|---|---|
| TRIF mods | desktop TRIF's Export / Export all mods for {site}, as files, a folder or a zip | **built** |
| History | Safari's Export Browsing Data (Mac: File → Export Browsing Data; iPhone, iOS 18.2+: Settings → Apps → Safari → Export): a zip or folder with History.json. Chrome: Google Takeout → Chrome → History.json | **built** (tried with files made to the published formats, not with a real export yet) |
| Desktop TRIF's per-site settings (which mods are off on which site, tiers off, sensitive and blocked sites, agent levels) | they live in the extension's own storage (and ~/.trif/switches.json, allowed.json); desktop has no export for them | **possible**: a desktop "Export settings" (one small JSON) and about fifty lines here. Needs a change on main, so it's Tim's call. Approvals (allowed.json) shouldn't come along: an imported mod is asked about again, as desktop asks |
| Bookmarks | every browser exports the same bookmarks HTML (Safari's export zip has Bookmarks.html) | **possible**, cheap to read; the app has no bookmarks to put them in yet |
| Userscripts and user styles | Tampermonkey / Violentmonkey / the Userscripts app export .user.js files or a zip; Stylus exports JSON | **possible**, a conversion (==UserScript== to ==WebMod== as a free mod; a user style's CSS to a style mod). Desktop doesn't take these either: Tim's call |
| Passwords | Safari's export has Passwords.csv, Chrome's is a CSV | **not to build**: sign-ins should come from iCloud Keychain or a password manager's AutoFill in the page (needs checking on a device) |
| Sign-ins, cookies, open tabs, extensions | — | **not possible**: another app's data isn't readable, Safari's export has no cookies (its extensions list is names only), iCloud Tabs aren't open to other apps. People sign in again; the app's one cookie store is shared by every tab and the chat |
| Being the default browser | — | needs the com.apple.developer.web-browser entitlement (Apple grants it on request) |

### Testing it in the Simulator without touching it

Development hooks (TrifProbeApp.swift): `-go <address>` and `-import <path,…>` at launch; and steps, one at a
time, for a headless Simulator: write the app's Documents/step.json, then
`xcrun simctl spawn <device> notifyutil -p com.trif.probe.step` (its answer in Documents/step-out.txt). Steps:
`{"sheet": "mods|tabs|history|chat|import|none"}`, `{"modsjs": "…"}` (in the Mods tab's page),
`{"pagejs": "…"}`, `{"go": "…"}`, `{"newtab": "…"}`, `{"select": n}`, `{"close": n}`, `{"back": 1}`,
`{"import": "path"}`, `{"offer": "a chat's reply"}`, `{"addOffer": 1}`, `{"cancelOffer": 1}`, `{"status": 1}`, and
for the chat `{"panego": "…"}`, `{"pane": 1}` (its scrolling and size), `{"panejs": "…"}`, `{"chat": 1}` (shown, what
it's doing, its address), `{"closechat": 1}`; `{"boxjs": "…"}` (in the boxed mods' world: `return JSON.stringify(globalThis.__trifSandbox.errors)`),
`{"approve": "<mod id>|*"}` (Allow on waiting mods); `{"sheet": "address"}` opens the address screen; `{"sheet": "icon"}`
the Add to Home Screen sheet; `{"tabhosts": 1}` lists the tabs' hosts (* on the one shown); `{"bars": "full|compact|state"}` moves the bars and
says where they and the page are (`-nobarshift` at launch: the page doesn't move with the bars, as before 11-16);
`{"openurl": "…"}` opens an address as the app opens one in another app; `-pageletter` at
launch shows the site's letter in the toolbar's page button instead of the page glyph. shared/pages/fixedbars.html
has a fixed header and an x.com-like fixed tab bar at the bottom, for the bars moving over a page. shared/pages/feed.html draws a feed from feed.json by fetch and by
XMLHttpRequest, for a boxed mod's site-data power (trif.filterResponse).

The chat can't be signed in to in the Simulator: `-chathome http://localhost:8377/chat.html` (with
`node mobile/serve.js`) gives it a stand-in (shared/pages/chat.html) with claude.ai's message box, send and stop
buttons and a reply written a few words at a time, with a mod in it ("two" in the message: two mods; "no mod": none).
Screenshots from 11-15 are in browser-probe/shots/ (not committed).

Mods that arrive by themselves (FolderWatch.swift; the phone half of desktop's Send to iPhone, docs/MOBILE-EDIT.md
section 8 on the mobile-edit branch): a folder picked once (⋯ → Watch a folder for mods…, a security-scoped bookmark),
looked through each time the app comes to the front: each .js file not offered before (by name, size and date) goes
to Add this mod?, one at a time; files iCloud hasn't brought down yet are asked for and offered next time; nothing
there is moved or changed. And `trif://add?v=1&name=<site>-<mod>.js&z=<raw deflate, base64url>[&h=<16 hex of
sha256>]` (a QR code's link): unpacked (256 KB at most), checked, offered the same way.

Full screen (Browser.setFullScreen, TrifProbeApp.swift FullScreenNote and FullScreenExit): a tab's page with no browser
chrome (no bars, no pull-down, no pointing at parts of the page), each tab's own (`fullScreenTabs`, by tab id). Two
fingers held still on the page for 0.6 s switch it either way, on any tab (a two-finger tap is too short; a pinch is
refused, as each finger must stay within 24 points of where it came down: the long press alone measures only their
centre; a tap the lifting fingers make is let go for 0.8 s); the ⋯ menu's Full screen does too. A note says which, at the
top in full screen; the first time, how to switch back. A small exit button at the top right, 60 points down so it's
below a site's own top bar (X's and Instagram's buttons are up there), bright for 3 s on entering and for a moment when
the page is scrolled back up or the app comes back, otherwise at 30%; ⋯ → Hide the full screen button takes it away.
`trif://open?url=…&app=1`, what Home Screen icons made from 11-16 open, starts that site's tab in full screen; each
icon's site keeps its own tab (`iconTabs`). A tapped link to another site, or a window the page opens, goes to a new tab
in TRIF view. (Development: `-exitrobot` draws the robot on the exit button instead; steps `fullscreen` and `resethint`.)

Home Screen icons (WebClip.swift): the ⋯ menu's Add to Home Screen makes a configuration profile with one Web Clip
(`trif://open?url=<site>`, full screen, identifier `com.timsrobot.trif.webclip.<site>` so adding a site again replaces
its icon) and hands it to Safari: first at timsrobot.com/clip, the profile in the address's # part (x-safari-https, so Safari
whatever the default browser is; the main repo's clip-page branch, `-clipbase https://localhost:8443` for a local copy),
used once that page answers; else from a server on 127.0.0.1 that stops once Safari has it; Files as the last way. Full screen on purpose: a
clip that isn't opens Safari and asks "Open in TRIF Probe?" every time; a full-screen one shows a blank screen for a
moment and opens the app with no question (Simulator, iOS 26.3). `TargetApplicationBundleIdentifier` is ignored in a
profile installed by hand. A `trif://open?url=` link goes to a tab already on that site, else a new tab; only http(s).

## What isn't probed, because it's known

- **A content blocker in Safari.** Hide rules compiled into a Safari content blocker apply before paint and
  need no per-site permission. It's a separate extension type, how every ad blocker on iPhone works, and the
  same engine the browser probe's `blocker` checks use.
- **Sync and the catalogue.** iCloud key-value and document storage, and fetching signed static files, are
  ordinary and need a paid developer account to try. Nothing to learn from a probe.
- **Being a real browser.** Default-browser status, passkeys in a web view and service workers on every site
  each need an entitlement Apple grants on request (`com.apple.developer.web-browser`). The browser probe's
  `page.features` check shows what pages get without it.
- **Apple's review.** Running code written after review is the rule every userscript manager on the App Store
  already lives under. Whether Apple accepts it for TRIF is a question for a submission, not a probe.

## For whoever changes this

```
node mobile/prepare.js          # remakes shared/gen/ (sandbox runtime, checks, the mod reader, the Mods tab's kit, the guide)
TRIF_BROWSER_TESTS=1 node mobile/test/smoke.js   # the Safari probe and the browser probe's JS checks, in Chrome for Testing
TRIF_BROWSER_TESTS=1 node mobile/test/chat.test.js   # the app's chat script against the stand-in chat: fill, send, the reply until done, its mods
TRIF_BROWSER_TESTS=1 node mobile/test/bridge.test.js   # the page side of site-data (gen/page-bridge.js): only where a mod matches, then filtered responses
ruby mobile/browser-probe/make-project.rb   # rewrites the Xcode project (gem install xcodeproj)
```

- `shared/kit.js` is the code both probes put beside a page: naming an element, hiding, the outline, the marker.
- `browser-probe/checks.js` holds the browser probe's JavaScript checks as functions; `prepare.js` turns them
  into `shared/gen/browser-checks.json`, which the app reads. `Checks.swift` has the ones that need the app.
- `shared/gen/sandbox-runtime.js` is TRIF's sandbox runtime wrapped so a probe can start it inside a `try`.
  Run `prepare.js` after `extension/sandbox.js` changes; the smoke test fails when it's stale.
