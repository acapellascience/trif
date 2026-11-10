# TRIF: architecture and protocol

TRIF lets anyone customize websites with their own coding agent (Claude Code, Codex, Gemini CLI,
Cursor…). The agent writes **mods**: plain JavaScript files, one per customization, that run on a site
every time it loads. Mods keep working with no agent around.

Its name: Tim's Robot Internet Fixer, TRIF for short. It was called WebMods until 0.2.0 (see "Renamed
from WebMods" for what kept the old name, and why). Everything is plain Node (≥ 18) and plain browser JavaScript: **no npm
dependencies, no build step.**

## Pieces

```
 coding agent ──runs──▶ `trif` CLI ──unix socket──▶ helper (native host) ──native messaging──▶ extension ──▶ tabs
                         (helper/cli.js)   ~/.trif/helper.sock   (helper/host.js)                 (extension/)
 coding agent ──edits──▶ ~/.trif/sites/<site>/<mod>.js ◀──watches── helper ──pushes mods──▶ extension (chrome.userScripts)
```

1. **Extension** (`extension/`, Manifest V3, Chrome ≥ 135). Runs mods with `chrome.userScripts` in the
   page's MAIN world at `document_start`. Executes the CLI's page commands. Records what sites load when
   asked. Has an onboarding page for Chrome's "Allow User Scripts" switch.
2. **Helper** (`helper/`). One Node program with two entry points:
   - `host.js`: the native messaging host Chrome launches when the extension calls
     `chrome.runtime.connectNative('com.webmods.helper')`. It serves the CLI over a unix socket and
     watches the mods folder, pushing mods to the extension.
   - `cli.js`: the `trif` command agents (and people) run.
   - `trif setup` installs everything: workspace, native host manifest, wrapper script, CLI link.
     Strangers run it as `npx timsrobot setup` (npm package `timsrobot`, see "Native host installation").
3. **Workspace** (`~/.trif/`, overridable with env `TRIF_HOME`, or `WEBMODS_HOME` as it was called before 0.2.0). The agent's working directory:
   ```
   ~/.trif/
     AGENTS.md           how to build mods (copied from helper/workspace/AGENTS.md on setup; refreshed on every setup)
     CLAUDE.md           "@AGENTS.md" (Claude Code reads CLAUDE.md; the @ import pulls in AGENTS.md)
     sites/<site>/<mod>.js
     preinstalled.json   what setup offered and shipped (see "Updates to shipped mods")
     .shipped/<site>/    versions of the shipped mods kept for merging (<mod>.js, <mod>.new.js)
     helper.sock         the default helper's socket (exists while a browser is running with the extension)
     helper-<pid>.sock   each running helper's own socket (one helper per connected browser or Chrome profile)
   ```
   `<site>` is a hostname like `x.com` or `news.ycombinator.com`. `<mod>` is a kebab-case name (no
   `:`, no trailing dot or space, not a reserved device name such as `con`: `helper/lib/pathcheck.js`
   badName). Files whose name starts with `_` or `.` are ignored (scratch files, helpers).
   Side-panel runs may read the whole workspace, so nothing private is kept in it: see "The private folder".
3b. **The private folder** (`helper/lib/paths.js` privateDir): what the helper keeps that agent runs must
   never read, outside the workspace. `~/Library/Application Support/TRIF/` on macOS,
   `$XDG_STATE_HOME/trif` (or `~/.local/state/trif`) on Linux, `<workspace>-private` beside a workspace
   set with `TRIF_HOME`/`--home`; `TRIF_PRIVATE` overrides it (ignored, with a warning, if it's inside the
   workspace or holds it). Made with mode 700.
   ```
   <private>/
     config.json         { "modsDir": "...", "env": {"PATH": ...}, "extensionIds": [...], "openModel": {...}, "autoUpdate": … }
     safari-token        the Safari bridge's key (see "Safari")
     helper.log(.1)      the helpers' log; safari-bridge.err, the bridge's stderr
     runs/<runId>.jsonl  run logs (the pages runs read)
     screenshots/        `trif screenshot`'s default folder; a side-panel run gets screenshots/<scope>/ alone
   ```
   Until 0.2.0 these were in the workspace, kept from runs by deny rules inside the folders runs may read.
   `migrate.js` migratePrivate moves them, once: setup runs it, every helper does when it starts, the Safari
   bridge too, and a run does when one reappears (an older helper still running writes its log where it
   used to), refusing to start if it can't. Only in the workspace: moved (copied and removed across
   volumes). In both: folders merged (what the private one lacks moves in), identical files dropped,
   logs and the key dropped from the workspace (the private copies win), a differing `config.json` (or
   anything else) kept in `<private>/from-workspace-<stamp>/`. An `old-webmods-<date>/` folder in the
   workspace (migrateHome's leftovers) can hold an old `config.json`, `runs/`…: those move to
   `<private>/old-webmods-<date>/`. What runs may read but never write stays in the workspace (`held.json`,
   `preinstalled.json`, `origins.json`, `active-runs/`, `update.json`, `trash/`, `.shipped/`,
   `instructions.md`): run sandboxes keep them read-only. `readConfig` still reads a workspace
   `config.json` until it's moved. `trif doctor` warns about anything private left in the workspace.
4. **Examples** (`examples/sites/<site>/<mod>.js`): ready-made mods (Detox Timeline, `x.com/detox-timeline`, first). Setup copies them
   into a new workspace (see "Native host installation") and later setups keep them up to date (see
   "Updates to shipped mods"); `trif install-example <site>/<mod>` copies one in by hand.

## Extension identity

`extension/manifest.json` carries a fixed `"key"` so the unpacked extension always has the ID
**`iaablflfafmonebdomeikadolkgdbkhe`**. The native host manifest's `allowed_origins` lists every TRIF
extension ID: this dev ID, the Chrome Web Store ID (unknown until the first upload; add it to
`STORE_EXTENSION_IDS` in `helper/lib/paths.js`), and any extra IDs in `config.json` (private folder)
`"extensionIds": [...]`. (The private key lives in `.keys/`, gitignored; it's only needed to pack a .crx.)

```
"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvrM00irPxw843QWA7797u9U1QLvK2M9cHdfoblqrEGec2aA++jHrJMdStaXa19U5R+K+aI8atnfwq4FLGDNid11AcgBavxUgtOGU7cXIXDX8MVdbfBVdMl4oMcfOVH1QJW6z0X5CzavJ5+F4HQj2dOQ8gMEBqjrB0k8rGD7G+93Tj7ewODVcYclNqZJUEfnGbz+TIbHh98F6KkwIvbJF3ng3Uh/6Qq7lXgPa6sGvRTIHGTJ0tD7xeJ7sWteE/3f8jzs6pKyYJyBqxoPYciim2LtzgxF+BHFe7c8CBFRflRTG0ofwblJwcRNhqMFYIwsxZes7QVd1c/ul/xdk2uOu9wIDAQAB"
```

## Mod files

A mod is a JavaScript file run as-is in the page's MAIN world (it shares `window` with the site, so it can
patch `fetch`/`XMLHttpRequest`, read React state, etc.), unless its header says `@rules` or `@sandboxed`
(below). An optional header sets metadata:

```js
// ==WebMod==
// @name        Detox Timeline
// @description Following-only, filtered X timeline
// @match       https://x.com/*
// @match       https://twitter.com/*
// @run-at      document-start
// @risk        1 hides ads and promoted posts
// @source      webmods
// @version     3
// ==/WebMod==
```

- `@match` (repeatable): Chrome match patterns. **Default** when absent: `*://<site>/*` and
  `*://*.<site>/*`, where `<site>` is the mod's folder name; `*://*/*` in the `all-sites` folder
  (mods with no single home site; `trif new all-sites <mod>` writes that `@match`).
- `@exclude` (repeatable): exclude match patterns. Default none.
- `@run-at`: `document-start` (default), `document-end` or `document-idle`.
- `@name`: default is the file name without `.js`. `@description`: default empty.
- `@risk`: `0`, `1` or `2`, then optionally why: how noticeable the mod is to the site (0 render-only,
  1 noticeable by the page's scripts, 2 changes what the site receives; defined in AGENTS.md "Account
  safety"). Parsed into `risk: {tier, why}` (null when absent; a malformed value is a warning). The side
  panel shows a badge for 1 and 2; a side-panel run's tier-2 mod is held (see "Run scope").
- `@source` and `@version`: `@source webmods` marks a mod TRIF ships (the examples); `@version` is
  its version (any text; the examples count 1, 2, 3…). Parsed into `source` (lowercased) and `version`
  (null when absent). The panel shows "Tim's mod, v3"; setup keeps such mods up to date (see
  "Updates to shipped mods").
- `@rules`: a rules mod: after the header, a JSON object of rules (css, hide, replace, filter) that
  TRIF's own code runs (helper/lib/rules.js; the Mod carries TRIF's code as `code`, the file as `text`,
  and `rules: true`).
- `@sandboxed`: a sandboxed mod: JavaScript that runs in TRIF's own userScripts world, inside a Secure
  EcmaScript Compartment whose global has only TRIF's API (`page`, `trif`, `console`, the timers, `Math`,
  `Date`) and the language; elements only as TRIF's stand-ins (extension/sandbox.js; docs/SAFE-MODS.md
  "Sandboxed: what's built"). The Mod carries `sandboxed: true`. `@rules` and `@sandboxed` together are an
  error (the mod isn't sent). See "Sandboxed mods" below.
- Unknown keys are ignored. A file without a header is valid.

**Mod id** = `<site>/<mod>` (e.g. `x.com/detox-timeline`). The helper parses headers; the extension never parses.

**Links.** A mod file or site folder may be a symlink only to somewhere inside the mods folder (real
paths compared, `mods.js` listModFiles/readModFile). One whose real path is outside it is ignored with a
warning (`helper.log`, `trif mods`, `trif doctor`): a side-panel run can write its site's folder, so it
could otherwise plant `sites/x.com/a.js -> ~/.ssh/id_rsa` and have the helper, which runs unsandboxed,
read the target and send it to the extension. The file read is the one whose real path was checked (same
device and inode after opening), so swapping a link in between doesn't work either.

## Messages: helper ⇄ extension (native messaging)

Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON. Chrome and Firefox refuse a
host→extension message over 1 MB, so a mods set bigger than that goes in parts (`modsPart`, below) to an
extension whose hello lists the `modsParts` feature; an extension without it (0.2.4 and older) gets at most
1 MB of mods, the largest left out with an error naming the extension's version (see "How big mods can be").
Extension→host frames may be up to 256 MB; a bigger length means the stream is out of step, so the host
logs it and exits (the extension reconnects to a fresh one) instead of misreading every later frame.

**helper → extension**

| message | meaning |
|---|---|
| `{type:"mods", mods:[Mod…], sitesOn:[site…], defaultOrder, starter}` | The full set of mods, and the sites setup said to start on (`preinstalled.json`; each browser turns each on once, see "Sites TRIF is on for"), and Tim's mods by site (`starter`, see "Preinstalled mods"). Sent on connect and after every change in the mods folder (debounced 150 ms). The extension makes `chrome.userScripts` match it exactly (register new, update changed, unregister missing). To an extension whose hello lists `modsSame`, a mod with the same id and hash as in the last set sent to it goes without `code`, marked `same: true`; the extension takes the code from the copy it has (`fillSameMods` in lib.js), or, if it hasn't one with that hash, applies nothing and sends `modsResend`. Every mod goes whole in the first set after each hello and after a `modsResend`. Over 1 MB it goes in parts, or (before the hello says the extension can take them) waits for the hello. |
| `{type:"modsPart", set, i, n, data}` | Part `i` of `n` (0-based, in order) of a `mods` message too big for one native message: `data` is a slice of its JSON text, each part under 1 MB as sent. `set` (`"<pid>-<k>"`) names the set. The extension joins the parts and applies the set only when the last is in, all at once, as if it had come whole (`ModsParts` in lib.js). A new set's first part, or a whole `mods` message, drops an unfinished one. A part missing, out of order or malformed, or joined text that doesn't parse, drops that set (the rest of its parts are ignored), logs an error and sends `modsResend`; the last whole set stays applied. |
| `{type:"request", id, cmd, args}` | A page command from the CLI (table below). The extension answers with a `response`. |
| `{type:"update", update:Summary}` | What the helper knows about updates (see "Updates"), after the extension's hello, after each check and while installing. The panel shows it. |
| `{type:"updated", from, to, notes}` | An update was installed. The extension keeps it in storage (`updated`) so the panel can say so after the reload. |
| `{type:"reload", reason}` | The extension should `chrome.runtime.reload()`: <home>/app now holds a newer version (installed by this helper, another browser's, or `trif setup`). Chrome reloads the unpacked extension from the new files; either browser starts the new helper on reconnect. |

`Mod = { id, site, file, name, description, matches:[…], excludes:[…], runAt:"document_start"|"document_end"|"document_idle", risk:{tier, why}|null, source, version, code, hash, held?, startOff?, origin?:{by, browser, live?}, update?:{version, from, modified}, absorbs?:[id…], readded?, autoUpdated?, rules?, text?, sandboxed?, pageFacts? }`
(`file` is the absolute path; `hash` is a sha1 of code+metadata so the extension can skip unchanged mods
(`sandboxed` is part of it only when set, so other mods' hashes are as before); `pageFacts`, on a sandboxed
mod: what its code could do as a page script (helper/lib/powers.js facts), for a browser without the sandbox;
`update`: a newer version of this shipped mod is waiting, see "Updates to shipped mods"; `autoUpdated`: a stamp
when TRIF itself replaced the user's unchanged copy of a shipped mod with a new version, kept while the copy is
that version (`preinstalled.json` `shipped.<id>.auto`, `autoUpdatedIds`), see "New mods start on or off".)

The extension keeps the mods it last had in `chrome.storage.local`, one per key: **`mod:<id>`** = the Mod,
and **`modIds`** = their ids in order, so it can apply them before the helper connects. Only the mods that
changed are written (0.2.4 and older kept them all in one key, `mods`, rewritten on every change; it's read
until the first write and then removed).

### How big mods can be

A mod can be up to **4 MB** of code, and all mods together up to **16 MB** (`MAX_MOD_BYTES` and
`MAX_MODS_BYTES` in helper/lib/mods.js). A mod over 4 MB isn't sent to the browser; if the rest are over
16 MB together, the largest are left out until they fit. Either way the helper logs an error naming the mod,
`trif status` shows it as NOT SENT with the reason, `trif mods` lists it under errors, and `trif doctor`
fails it with what to do (`limit` in the error: `mod`, `total`, or `extension` for an extension from before
sets could go in parts, which takes 1 MB in all).

Why those numbers (measured with tests/e2e/measure-big-mods.js, headless, on an M-series Mac with 16 GB;
memory is the footprint of all the browser's processes; Firefox's baseline is about 600 MB, Chrome's 440):

- A 48 MB set (33 mods, 49 parts) once took headless Firefox 159 to 7.4 GB and the Mac ran out of memory.
  Not the size itself: the extension checked the user scripts switch with `chrome.userScripts.getScripts()`
  for every message from the helper, and `trif status` and every sync called it too. That hands back every
  script with all its code, so each part of a set made a copy of the whole set, and Firefox's parent process
  collects such copies (strings and structured-clone buffers) late: with 2 MB of mods, 188 MB of strings and
  131 MB of structured-clone buffers sat in the parent, 2-3 times the 1 MB figures (+214 MB at the peak for
  1 MB, +417 MB for 2 MB). After "Minimize memory usage" in about:memory it was back to the baseline:
  garbage, not a leak, but made faster than Firefox frees it, and in proportion to parts × size. Now the
  switch is checked with `getScripts({ids: [an id never registered]})`, `trif status` and syncs go by what
  the last sync registered (`known` in syncUserScripts), a change sends only the changed mods' code
  (`modsSame`) and writes only those to storage.
- Now, with 16 MB (four 4 MB mods): registering them costs Firefox about +170 MB, a page load with them
  +200 MB; eight changes to a 4 MB mod in a row, 2.5 s apart, peak at 1.2 GB in all (parent process 550
  MB) and settle about 1.0-1.1 GB, back to the baseline once garbage is collected. 16 MB of code (functions,
  compiled on each page load) peaks at 1.3 GB. Chrome 156: 16 MB peaks at 640-660 MB in all, and changes
  in a row stay under 500 MB.
- Each change to a mod still passes its code through the browser several times (native messaging, the
  extension, storage, `userScripts.update`, every renderer), and Firefox frees those copies late, so the
  cost of a change grows with the mod's size: 4 MB a mod keeps that a few hundred MB at worst.

**extension → helper**

| message | meaning |
|---|---|
| `{type:"hello", version, userScripts: bool, chrome: "<version>", browser, installId, features:[…]}` | Sent on connect. `userScripts` is false when the "Allow User Scripts" switch is off. `features`: what this extension can do beyond 0.2.4's protocol, so the helper doesn't have to go by the version: `modsParts` (takes `modsPart`), `modsSame` (takes mods it has without their code). No `features` means 0.2.4 or older. |
| `{type:"modsResend", reason}` | A set in parts didn't arrive whole, or a mod sent as `same` wasn't there (`reason` says how). The helper logs it and sends the set again, every mod whole, once per set; if that fails too, the next change or reconnect sends it again (whole). |
| `{type:"response", id, ok:true, result}` / `{type:"response", id, ok:false, error:"message"}` | Answer to a request. |
| `{type:"modsApplied", registered:[ids], errors:[{id, error}]}` | After applying a `mods` message. |
| `{type:"log", level, message}` | Extension-side diagnostics; the helper writes them to `helper.log` (private folder). |

## Safari

Safari 27.2 has none of the three things the Chrome build relies on: `chrome.userScripts`, native
messaging to an arbitrary program (Safari's only reaches the extension's own Mac app), and the side panel.
`extension/safari.js` stands in for them, and the Safari build hands background.js its stand-ins as
`chrome` (Safari's own object can't be changed):

- **chrome.userScripts.** Registered scripts are kept in memory and in `chrome.storage.local`
  (`safariUserScripts`). On `webNavigation.onCommitted` (top frame only) the scripts whose `matches` /
  `excludeMatches` fit the URL and whose `runAt` is `document_start` are injected with
  `chrome.scripting.executeScript({world:"MAIN", injectImmediately:true})`, in registration order (so
  the runtime first), each in its own `try`, behind a per-document marker. `document_end` and
  `document_idle` scripts go in on `onDOMContentLoaded` and `onCompleted`. Safari serializes an injected
  function with `toString()`, so the injected function is one whose `toString` returns the code: that runs
  even on pages whose CSP forbids eval (checked on x.com and instagram.com in Safari 27.2). If the combined
  code fails to inject (a mod that doesn't parse), each script is injected on its own. `execute` (for
  `trif run`) injects `return (<code>);` the same way.
- **Native messaging.** `connectNative` returns a port over a WebSocket to `ws://127.0.0.1:47615/`, the
  Safari bridge (`helper/safari-bridge.js`), which relays JSON messages to a host.js in the usual frames.
  The bridge accepts only handshakes whose `Origin` is `safari-web-extension://…` (web pages can't set it)
  and that bring its key as `?token=`: the contents of `safari-token` in the private folder (64 hex characters, mode 600,
  made by `trif setup --browser safari`). A Safari extension's origin is random and changes, so the key
  is what tells TRIF from other extensions: the extension gets it with
  `runtime.sendNativeMessage(…, {type:"token"})` from its own Mac app (`safari/SafariWebExtensionHandler.swift`,
  whose sandbox may read just `~/Library/Application Support/TRIF/safari-token`, and for one more version
  the old `~/.trif/safari-token` and `~/.webmods/safari-token`, read in that order; entitlement in
  `safari/TRIF Extension.entitlements`), which no other extension can message. A TRIF.app from before
  0.2.0 only looks in `~/.trif`: after setup moves the key, install the app from the same version.
  Safari unloads the background page after about 30 s with nothing to do, closing the socket, so the host
  outlives the connection: its messages are queued (up to 2000) and delivered when the background
  reconnects, which it does with a fresh `hello`. A host with no connection for 30 minutes and no agent
  run in `<home>/active-runs` is stopped. `trif setup --browser safari` installs the bridge as a
  launchd agent (`~/Library/LaunchAgents/com.timsrobot.trif.safari-bridge.plist`, KeepAlive); `trif doctor`
  checks that it's listening. Setup restarts a loaded agent with `launchctl kickstart -k` (bootout and
  bootstrap only when the plist is new or changed). bootout returns before launchd has removed the
  service, so setup then waits (up to 5 s) until `launchctl print` no longer finds it, and retries a
  bootstrap that fails with `5: Input/output error` (5 tries, 1 s apart). Stopping the bridge stops its hosts and their
  children, so a setup run inside one (an update installed from Safari: the bridge gives its hosts
  `TRIF_SAFARI_BRIDGE`) leaves the launchctl commands to a detached shell that runs them 3 s later,
  after the update has finished. The background's warnings, errors and failures to start are POSTed to the
  bridge (`/log`, `/startup-error`) and written to `helper.log`, since Safari shows the background's
  console only in its developer tools.
- **The panel.** The toolbar button opens `sidepanel.html?window=<id>` in a window of its own; the panel
  follows the active tab of window `<id>` (and re-reads it when a page commits, since Safari can give a
  tab a new id when it goes to another site).

The build (`scripts/build-extension.js safari`) bundles the background into one classic script (Safari
doesn't run module workers) and makes it a non-persistent background page rather than a service worker.
`scripts/build-safari.js` wraps that in the Mac app Safari requires (Xcode project generated each time
with `safari-web-extension-converter`; app `com.timsrobot.trif`, extension `com.timsrobot.trif.extension`),
signed ad hoc unless given `--team`.

## Page commands (CLI → helper → extension)

Each request's `args` may contain a **tab selector**: `tab` (numeric tab id) or `url` (substring or
`/regex/` matched against tab URLs; first match in the last-focused window wins, then any window).
Without one, the target is the active tab of the last-focused normal window.

| cmd | args | result |
|---|---|---|
| `status` | optional tab selector | `{userScripts, chrome, version, mods:[{id, registered, enabled}], recording:[sites]}` (`enabled: false` = switched off, see below); with a tab selector also `page: {tab, url, mods:[{id, name, runAt}]}`, the mods that run on that tab's page |
| `tabs` | – | `[{id, windowId, active, url, title}]` (normal windows only) |
| `run` | `code`, `expression: bool`, `timeout` (ms, default 10000) + tab selector | `{value}`: the code's result, made JSON-safe in the page (see below), or an error `{ok:false, error:"<message + stack>"}` |
| `reload` | `hard: bool` + tab selector | `{url}` after the tab's `status` is `complete` (timeout 30 s) |
| `navigate` | `to` (URL) + tab selector | `{url}` after load completes |
| `open` | `to` (URL) | `{id, url}`: opens a new background tab (never takes focus), waits for load |
| `text` | tab selector | `{url, title, text}`: `document.body.innerText`, capped at 200 000 chars |
| `sweep` | `selector`, `text` (regex; `/re/flags`, else case-insensitive), `color` (any CSS colour), `tolerance` (0-255 per channel, default 2), `limit` (matches returned, default 200), `budget` (ms, default 4000), `scroll` (bool) + tab selector | Every instance of a kind of thing on the page, from `extension/sweep.js` run in the isolated world: `{url, query, target, scanned:{elements, roots, shadowRoots, closedShadowRoots, frames, ms}, partial, skipped:{crossOriginFrames, unreadableSheets}, total, summary:{visible, hidden, inViewport, fixed, sticky, inShadowRoots, inFrames, regions, props}, groups:[{signature, count, visible, regions, example}], matches:[{element, text, region, position, visible, inViewport, root, props?}], rules}`. Searches the document, shadow roots (closed ones through `chrome.dom.openOrClosedShadowRoot` / Firefox's `openOrClosedShadowRoot`) and same-origin frames. With `color`, `rules` lists the stylesheet rules and custom properties using it, and the rules using those (`var()`). `partial` says why it stopped early (time budget, 100 000 elements). |
| `screenshot` | `full: bool`, `copy: bool`, `timeout` (ms) + tab selector | `{dataUrl, how, note, full, cut?}` PNG (`extension/screenshot.js`). The extension never switches tabs or focuses windows, since agents may run while the user browses. `how`: `visible` (captureVisibleTab of a tab that's showing), `tab` (Firefox's `tabs.captureTab`: any tab in its exact state, `full` from its page rect, up to 12 000 px), `copy` (Chrome, a tab that isn't showing or `full`, only with `copy: true`, otherwise an error that names `trif screenshot --copy` and suggests sweep/text/run: a fresh copy of the tab's URL loaded, muted, in a new unfocused window the size of the tab's, against the right edge of the screen with 45% of it past the edge (Chrome doesn't draw covered windows, and refuses bounds less than half on screen; refused bounds fall back to the tab's window position), at the tab's scroll position, captured, and closed; `stale: true` when the copy's page was hidden anyway, so captures after a scroll may be old frames; `full` stitches up to 14 captures, hiding fixed and sticky elements after the first). `note` tells the agent what it got when that isn't simply the tab on screen. Safari: a tab that isn't showing is an error. Without `<all_urls>` (see "Site access"): only `visible`, of a tab the user clicked TRIF's toolbar button on (`activeTab`); anything else is an error saying so. Copy windows are listed in `chrome.storage.session` `probes` while open, and closed on the next start if the worker stopped mid-capture. The CLI writes the image to a file and the note to stderr. |
| `record` | `site`, `on: bool` | `{recording:[sites], site, changed}`. Turns the network recorder on/off for a hostname (and its subdomains). Takes effect on the next page load. `changed`: whether it was the other way before. Switching off is allowed on a site TRIF is off for. Recording a side-panel run switched on (changed, from its token) is switched off by the helper when that run's `done` goes out; recording that was already on, or that a terminal switched on, is left alone. |
| `requests` | `filter` (regex string, matched against URL), `limit` (default 50) + tab selector | `[{i, method, url, status, type:"fetch"|"xhr", size, time}]`, newest last |
| `request` | `i` + tab selector | `{method, url, status, requestBody, responseText}` (bodies capped at 2 MB each) |
| `errors` | tab selector | `[{mod, message, stack, time}]`: errors thrown by mods in that page |
| `logs` | tab selector | `[{mod, level, args:[strings], time}]`: what mods logged with `trif.log(...)` |
| `mod.enable` | `id`, `enabled: bool`, `wait: bool` + tab selector | `{id, enabled, reloaded}`: switches a mod on/off (below). `reloaded` = the tab id reloaded, or null |

### Sites TRIF is on for (`sitesOn`)

TRIF is off on every site until the user turns it on from the side panel there. The extension keeps
the sites in `chrome.storage.local` **`sitesOn`**: a sorted list of registrable domains (`scopeFor` in
`extension/lib.js`, mirroring `helper/lib/scope.js`; `x.com` covers `m.x.com`). It's the one place this
is enforced, for everyone:

- **Mods.** Each sync limits every mod to those sites (`limitToSites`): an `@match` with any host, or
  `<all_urls>`, becomes `*://<site>/<path>` and `*://*.<site>/<path>` for each site on; one for a host
  inside a site on is kept; others (and `file://`) go. A mod with nothing left isn't registered, and
  `status` gives it `sitesOff: true`. The runtime follows the registered mods, and `recording` only
  counts on sites that are on.
- **Page commands.** Every tab or URL a page command touches must be on a site that's on (the same check
  as run scope, for all requests, scoped or not): otherwise `TRIF is off on <site>: …`. `tabs` lists
  only tabs on sites that are on. `agent.start` is refused for a site that's off.
- **The switch.** The panel's `{type: "site.set", site, on, tab}` adds or removes the site's registrable
  domain, re-applies mods, reloads `tab` if an enabled mod applies to it, and (off) stops runs on the
  site. Mod switches (`disabled`, `offSites`) are untouched, so they're as they were when it's turned back
  on. `status` and the panel's status carry `sitesOn`.
- **Updating.** A profile without `sitesOn` (from before) starts with the sites of its switched-on mods
  (not all-sites ones) and the sites it has chats for (`sitesInUse`).

### Site access: permissive or restrictive

The manifest asks for no sites at install: `"optional_host_permissions": ["<all_urls>"]`, no
`host_permissions`. So the install prompt says nothing about websites ("site access" in `extension/lib.js`).

- **The mode**, per browser, chrome.storage.local **`siteMode`**: `permissive` (TRIF has `<all_urls>`: every
  site by default) or `restrictive` (TRIF asks per site); unset until chosen. It follows the grant
  (`siteModeOf`, kept in step on every `permissions.onAdded`/`onRemoved`): `<all_urls>` is permissive (an
  update from when it was required too), losing it is restrictive.
- **Choosing it.** The setup page's step "Site permissions", and Settings → Site permissions in the panel:
  "Permissive" ("access to every site by default") calls `permissions.request({origins: ["<all_urls>"]})`
  from the click; granted, permissive. Declined: restrictive (the setup page records it with
  `{type: "site.mode", mode: "restrictive"}` and says so under the ticked step; Settings says TRIF stays
  restrictive). "Restrictive" ("connect TRIF on a site-to-site basis") sends `site.mode` restrictive: no
  prompt; from permissive, every origin TRIF has is given back (`permissions.remove`), so every site is
  disconnected until it's connected again. Not in Safari.
- **A site's state** (`siteState`, the same words in the panel and in what agents are told, `siteRefusal`):
  - **on**: in `sitesOn`, with access. TRIF works there.
  - **off**: with access, not in `sitesOn` (the power button, the robot in the bar). Turning it on again
    doesn't ask the browser anything: a quick before and after. Agents get `TRIF is off on <site>: …`.
  - **disconnected** (restrictive): no access to the site, a first visit included, and the sites setup turns
    on (`sitesOn`) until they're connected. The panel is all grey: "TRIF is disconnected on <site>" and
    "Connect", which requests `*://*.<site>/*` (`siteOrigins`; just the address for an IP) from the click,
    before anything else (Chrome needs a user gesture; Firefox allows nothing awaited before it), then
    `site.set` on. Declined: "<Browser> didn’t get your OK, so TRIF stays disconnected on <site>." Agents
    get `TRIF is disconnected on <site>: … until the user connects it …`; `agent.start`, `TRIF is
    disconnected on <site>: connect it first`. `site.set` on checks the access again and refuses without it.
  - **blocked**: in TRIF's block list (below): the panel red, "The robot is blocked on <site>" and "Unblock".
- **The off screen's links**, under Fix, in both modes: "Block on <site>" (title and accessible description
  "Add to TRIF's block list": `site.block`, below) and "Disconnect from <site>" ("Disable browser
  permissions"; not in Safari). Restrictive: `{type: "site.disconnect", site, tab}`: out of `sitesOn`, runs
  stopped, `permissions.remove` of its origin, so disconnected (grey). Permissive: one site can't be taken
  out of `<all_urls>`, so a card opens in the panel (a `<dialog>`; × and Escape close it, doing nothing):
  "All-site access is on", "You'll have to allow TRIF again on other sites." and "Switch to restrictive
  mode", which sends `site.mode` restrictive: every site's access goes, and this site (and every other) is
  disconnected. `site.disconnect` itself refuses under `<all_urls>`.
- **The block list**, chrome.storage.local **`blockedSites`** (registrable domains, like `sitesOn`): TRIF's
  own way to keep off a site whatever access it has. `{type: "site.block", site, blocked: bool, tab}` from
  the panel only ("Block on <site>" on the off screen, "Unblock" on the red screen, an "Unblock" per site in Settings →
  Site permissions → Blocked sites). Blocking: out of `sitesOn`, runs stopped, the site's own origin given
  back (a no-op under `<all_urls>`), mods re-synced. Then nothing of TRIF's runs there or reads it:
  `<site> is blocked in TRIF: …` for page commands and screenshots, `<site> is blocked in TRIF` for
  `agent.start`, and `site.set` on is refused (`… unblock it first.`). Nothing in the CLI or the protocol
  changes the list (only the user, in the panel); `trif status` shows it.
- **Which sites count.** The sites TRIF works on are `sitesOn` ∩ access − `blockedSites` (`onSites()` in
  background.js), and everything (mods, the runtime, recording, page commands, `tabs`, the in-page guard,
  `agent.start`, `status`'s `sitesOff`) goes by them. `status` and the panel's status carry `sitesOn`,
  `siteMode`, `disconnected` (the sites on without access), `blockedSites` and `access` (`{all, allUrls,
  origins}`); the panel's status `siteAccess` (false in Safari). `trif status` prints `site mode`,
  `disconnected` and `blocked`.
- **Taken back** in the browser's settings: `permissions.onAdded`/`onRemoved` re-read the access (and the
  mode), re-sync the mods and stop runs on sites that lost it. The site stays in `sitesOn`, so connecting
  it brings it back as it was.
- **The browser's own blocked sites** (Chrome's "Don't allow extensions on these sites") don't show in
  `chrome.permissions`: `contains` still says yes there (checked in Chrome 156), so TRIF can't tell; the
  browser refuses TRIF's injections there.
- **Updating from `<all_urls>` required.** Chrome and Firefox keep a granted permission when an update moves
  it from required to optional (Chromium bounds the stored active permissions by required ∪ optional,
  `PermissionsManager::GetBoundedExtensionDesiredPermissions`; Firefox migrates them, its
  `test_ext_permissions_migrate.js`; checked in Chrome for Testing 156 by loading a build with
  `host_permissions: ["<all_urls>"]`, then the same profile with it optional: `permissions.getAll()` still
  has `<all_urls>`). So those users are permissive (Settings → Site permissions → Restrictive narrows it).
- **Safari** keeps `host_permissions: ["<all_urls>"]` (it asks per site itself, whatever the manifest
  says); TRIF has no mode there, doesn't ask or check, and no site is disconnected. The block list works there too
  (the off screen offers "Block on <site>").
- **Screenshots.** A site's own access isn't enough for `captureVisibleTab` (Chrome wants `<all_urls>` or
  `activeTab`) or Firefox's `captureTab` (`<all_urls>`, and only in pages loaded while TRIF had it: given
  later, the background gets it when Firefox starts again). So the manifest has `activeTab`, and in Chrome
  the toolbar button opens the side panel from `action.onClicked` (`sidePanel.open`, and `sidePanel.close`
  on the next click in that window: the panel says which window it's in with `{type: "panel.window",
  windowId}`) instead of `openPanelOnActionClick`, because only then does the click give TRIF `activeTab`
  on that tab (also where the panel opens in a window instead: see "The panel in a window"). Without `<all_urls>`, `screenshot` captures only the tab in front, after that click; a tab
  that isn't showing, `full` and `copy` are an error that says so (see `screenshot`).

### Mod switches (`mod.enable`)

Each mod can be switched off without touching its file. The switched-off set lives in the extension's
`chrome.storage.local` under **`disabled`** = `{"<mod id>": true}`, so it survives service-worker
restarts and helper reconnects: every sync (including each `mods` message from the helper) skips
switched-off mods and unregisters them if registered; switching one on registers it again. Switch state
(`disabled`, `offSites`, `sitesOn`, `recording`) is written to storage before it changes in memory: if the
write fails (a full quota), the switch fails with an error and nothing changes. Ids of
deleted mods may linger in the set (harmless, never shown); a re-created mod with the same id stays off.
After a switch, the target tab (selector, else the active tab) is reloaded if the mod's matches cover
it (`wait: true` waits for the load, like `reload`). If (un)registering fails, the previous state is
restored and the command fails. `status` (and the panel/setup page status) reports `enabled` per mod.
The side panel's "Mods on this site" list and the setup page show a switch per mod (`modswitch.js`,
`switch.css`); they send `{type: "mod.enable", id, enabled, tab}` to the background and follow
`storage.onChanged` for `disabled`, so a switch flipped by an agent or the CLI shows live.

**Per-site switches.** `mod.enable` takes an optional `site` (a hostname; `www.` and ports dropped): the
mod is switched on or off on that site and its subdomains only. Those sites live in
`chrome.storage.local` **`offSites`** = `{"<mod id>": ["twitter.com", …]}` and are added to the mod's
`excludeMatches` when it registers (`withOffSites` in lib.js; its hash changes, so it re-registers).
`switchSite` in lib.js decides the new state: off on the last site the mod names switches the whole
mod off (and clears its list); on on a site while the whole mod is off turns it on there only (its other
named sites go into the list; a mod matching any host comes on everywhere except the listed sites).
The whole-mod switch (no `site`) leaves the list alone. The reply adds `site`, `offSites` and
`modEnabled`; `status` reports `offSites` per mod when non-empty. A scoped run may switch any mod with
`site` inside its scope (`trif enable|disable <id> --site HOST`). In the side panel, a mod that
names several sites or any host (`isMultiSite`) gets a switch for the panel's site; the setup page
shows the whole-mod switch plus one per site (the named sites and any in `offSites`).

**Groups.** The side panel lists a site's mods in three groups, each with a switch: **Rules** (`@rules` mods,
run by TRIF's own code from their data), **Sandboxed** (`@sandboxed` mods, in TRIF's sandbox; in a browser
without it they're page scripts) and **Page scripts** (every other mod). A group switched off on a
site lives in `chrome.storage.local` **`groupsOff`** = `{"<site>": ["page"]}` (groups `rules`, `sandboxed`, `page`;
`normalizeGroupsOff` drops anything else, and empty sites). Like `offSites`, those sites go into
`excludeMatches` when a mod of that group registers (`offSitesFor` in lib.js merges them with the mod's own
`offSites`), so the browser keeps the mods off that site and its subdomains; a mod matching any host
follows it site by site. Each mod's own switches are untouched, and come back as they were when the group
is switched on again. The panel sends `{type: "mods.group", site, group, enabled, tab}` (`switchGroup`),
reloads the tab and greys the group's rows; `status` reports `groupsOff` when non-empty (`trif status`:
`GROUPS OFF`). Panel only: there's no CLI or agent command for it, so an agent run can't switch page
scripts back on for a site the user turned them off on.

**New mods start on or off.** For each group, the user chooses in Settings whether its new mods start on (the
default, as before; Sandboxed too) or off: `chrome.storage.local` **`startsOff`** = the groups set to start off (`["page"]`;
`normalizeStartsOff`). The panel sends `{type: "mods.startsOff", group, off}`; panel only, like the groups'
switches. It counts from then on: mods already there keep their switches. On each `mods` message
(`applyNewMods` in lib.js, after `applyStartOff` and `applyReadded`), a mod arrives when its id isn't in
**`seenMods`** (id → true, every mod this browser has seen; a browser without it, from before, takes all its
mods as seen), when its `readded` stamp is new, or when its `autoUpdated` stamp isn't the one in
**`autoUpdated`** (id → stamp). An arriving mod of a group set to start off is switched off (`disabled`) and
recorded in **`newOff`** = `{"<id>": "new"|"update"}`, unless it was made in this browser's own side panel
(`origin.by` is this install and `origin.live`: its file was written while that run was going, between the
run's start and its end; a file that only appeared in the moments after, which origins.js also counts for the
run, could be anyone's: the user asked for the run's, and the agent checks it running) or is held (it waits
for the user's OK anyway, and allowing it is looking at it). A renamed file keeps both. Switching the mod on
clears its `newOff`; from an agent run, `mod.enable` refuses to switch one on. `status` reports `startsOff`
when non-empty and `newOff` on such a mod while it's off (`trif status`: `NEW MODS`, `off (new)`).

**Sandboxed mods.** A Mod with `sandboxed: true` (header `@sandboxed`) never waits for the user's OK for
its code: the helper's holds (held.js) find nothing in it, as for a rules mod (a side-panel run's is still
held for an `@match` outside the run's site, or `@risk 2`). The extension:
- configures TRIF's world once per background start (`sandboxWorld` in background.js):
  `userScripts.configureWorld({worldId: "trif-sandbox", csp, messaging: true})`, the CSP from sandbox.js
  `SANDBOX_CSP` (`connect-src 'none'`, loads only from data:/blob: and, for images, the page's own site;
  'unsafe-eval' for SES's evaluator);
- registers, where any sandboxed mod runs, the world's runtime **`trif-sandbox-runtime`**
  (`sandboxRuntimeScript`: a timing stamp, `vendor/ses.umd.min.js` as a file, then sandbox.js
  `sandboxRuntimeCode`), `document_start`, `world: "USER_SCRIPT"`, `worldId: "trif-sandbox"`; it locks the
  language down once (`lockdown()`) and installs `__trifSandbox` in that world;
- registers each sandboxed mod in the same world, its code as a JSON string handed to `__trifSandbox.run`
  (or queued until the runtime is there, so registration order doesn't matter), which evaluates it in a
  Compartment of its own, inside an async function;
- keeps the mods' errors and logs in the world (`__trifSandbox.errors`, `.logs`, same shape as
  `window.__webmods`'s, plus `sandboxed: true`), which `errors` / `logs` read with
  `userScripts.execute({world: "USER_SCRIPT", worldId})` and merge with the page runtime's;
- keeps each mod's settings (`trif.settings`) in `chrome.storage.local` **`sandboxSettings`** =
  `{"<mod id>": {"<site>": {"<key>": "<JSON>"}}}`: the world's runtime asks with
  `runtime.sendMessage({trifSandbox: "settings.get"|"settings.save", mod, key, json?})`
  (`onUserScriptMessage`); the site is the one the browser says the sender's page is on (`scopeFor`), at
  most 64 KB per mod per site and 200 sites per mod. Mods never have `chrome`: the runtime takes
  `sendMessage` and deletes `chrome`/`browser` from the world before any mod runs.

A browser that can't host the world (Safari: its userScripts is TRIF's adapter, safari.js; or a
`configureWorld` that fails) holds every sandboxed mod in the extension (`sandboxFallback` in lib.js):
`held = {by: "sandbox", site, reason, facts, claim, hash}`, `unsandboxed: true`, so it isn't registered and
the panel shows it on hold, in the Page scripts group. Allow in the panel (`mod.approve` for such a mod is
answered by the extension, not the helper) stores **`unsandboxedOk`** = `{"<id>": "<hash>"}` and registers
it in the MAIN world as a page script with the same API (sandbox.js `sandboxPageCode`; its settings in the
page's localStorage under `trif.settings.<id>.<key>`); a new version waits again. Panel only. `status`
says `sandbox: false` there, and each sandboxed mod's `sandboxed` is `true` (in the world) or `"page"`.

**Renamed mod files.** A mod's id is its site folder and file name, so a file renamed on disk arrives as a
new id with the old one gone. When the new mod has the same code as a vanished one in the same site folder
(`findRenames`, against the mods the extension last had, which outlast restarts in storage), the extension
moves the old id's `disabled` and `offSites` entries and its place in `modOrder` to the new id and marks it
`startedOff` (`carryRenames`, `renameInOrder`), so it isn't switched off again as a new mod. The helper
does the same in `origins.json`. A file renamed and edited in one go is a new mod.

**Order in the side panel.** The panel's mods can be dragged (or moved with Alt+↑/↓) into any order, per
site: `chrome.storage.local` **`modOrder`** = `{"<site as scopeFor gives it>": ["<mod id>", …]}`, written
by the panel. Display only: mods register and run in the order they always do. Mods not in the list
come after the listed ones in the order the helper sends them; listed ids that aren't mods any more are
skipped (one restored from the trash takes its old place) and dropped the next time the order is saved;
an order that's just the helper's is removed (`orderMods`, `setModOrder` in lib.js). Until the user drags,
a site's shipped mods come in the order TRIF ships them in: every `mods` message carries
`defaultOrder` (same shape; helper/lib/preinstalled.js `DEFAULT_ORDER`, empty at the moment), which
the extension keeps in `chrome.storage.local` **`defaultOrder`**; the panel orders by it first, then by
the user's `modOrder`.

### `run` semantics

- The code runs in the page's MAIN world via `chrome.userScripts.execute` (`world:"MAIN"`,
  `injectImmediately:true`), which isn't subject to the page's CSP.
- The CLI decides `expression`: it tries `new Function("return (" + code + "\n)")` in Node; if that
  parses, `expression:true` (REPL-style: `document.title` just works), else the code is a function body
  (use `return`). Either way it runs inside an `async` function, so `await` works.
- The extension wraps it so the page returns a **string**: the result serialized with a JSON replacer that
  handles `undefined` → `null`, DOM nodes → `outerHTML` (first 2000 chars), Maps/Sets → arrays, cycles →
  `"[Circular]"`, functions → `"[Function name]"`, errors → `{name,message,stack}`. Total capped at
  1 000 000 chars (truncated with a note). The CLI prints the value as pretty JSON, or a bare string as-is.
- Timeout (default 10 s) → error `"timed out after Nms"`.

## The page runtime: `window.__webmods`

The extension registers one internal user script, id `webmods-runtime` (ids starting with `_` are reserved by Chrome), matching
the union of the registered mods' `@match` patterns plus `*://<site>/*` and `*://*.<site>/*` for each
recorded site (not every page: its globals would let any site detect TRIF users; with no mods on and
nothing recorded, nothing is registered; if the union is invalid, `<all_urls>`), MAIN
world, `document_start`, **registered before any mod** so it runs first. It defines:

```js
window.__webmods = {
  errors: [],          // {mod, message, stack, time}  (capped at 200)
  logs: [],            // {mod, level, args, time}      (capped at 500)
  requests: [],        // recorder entries, only when recording this site (capped at 300; bodies at 2 MB each, 32 MB in all)
  recording: bool,
};
window.trif = { log(...args), warn(...args), error(...args) };   // for mods; records with the current mod id
window.webmods = window.trif;   // its name before 0.2.0 (when TRIF was called WebMods): users' mods use it, so it stays
// (__webmods, __webmods_runs and the user script id webmods-runtime also keep their names from then: mods
// and older code may read them.)
```

Every mod is wrapped by the extension before registering:

```js
(() => { const __mod = "x.com/detox-timeline"; window.__webmods && (window.__webmods.current = __mod);
try { /* mod code */ } catch (e) { window.__webmods?.errors.push({mod: __mod, message: String(e?.message ?? e), stack: String(e?.stack ?? ""), time: Date.now()}); console.error("[TRIF]", __mod, e); }
})();
//# sourceURL=trif://x.com/detox-timeline.js
```

(Errors thrown later from a mod's event handlers or timers aren't caught by this wrapper; the runtime
also listens for `window` `error`/`unhandledrejection` events and attributes those whose stack mentions
`trif://<site>/<mod>.js` (or `webmods://`, the name before 0.2.0).)

**Recorder:** when the page's hostname is in the recording set, the runtime hooks `fetch` and
`XMLHttpRequest` (before the site's code runs) and stores each request: method, URL, status, request
body (strings only; else `"[binary]"`), response text (text-like content types only). A fetch response
is read from a clone through its stream, stopping (and cancelling the clone) after 2 MB, so a body that
streams on doesn't grow without end; `text/event-stream` isn't read at all. Bodies kept add up to at most
32 million characters across the entries; past that the oldest bodies are replaced by a note. The recording set
reaches the runtime because the extension re-registers `webmods-runtime` (ids starting with `_` are reserved by Chrome) with the set embedded in its
code whenever it changes (`const RECORDING = ["x.com"]`).

## CLI (`trif`)

```
trif setup [--browser chrome|chromium|brave|edge|arc|all] [--copy|--link]   install workspace, native host, CLI link
trif status [TAB]               connection, user-scripts switch, mods and whether each is registered (or off); with TAB, the mods running on that page
trif doctor                     diagnose setup problems, printing a fix for each
trif tabs
trif run [TAB] '<code>'         run JS in the page (REPL-style); `-f file.js` to run a file; `-` reads stdin
trif reload [TAB] [--hard]
trif open <url>
trif navigate [TAB] <url>
trif text [TAB]
trif sweep [TAB] --selector <css> | --color <colour> | --text <regex> [--scroll] [--tolerance N] [--limit N] [--timeout MS]
                                        every instance of a kind of thing: count, regions, kinds; --json for each match
trif screenshot [TAB] [--full] [--copy] [-o file.png]   default: <private>/screenshots/<time>.png; prints the path (a note on stderr when it's a copy)
trif record <site> [on|off]
trif requests [TAB] [--filter <regex>] [--limit N]
trif request [TAB] <i> [-o file]        prints JSON; response bodies that are JSON are pretty-printed
trif errors [TAB]
trif logs [TAB]
trif mods                        list mods from the folder (id, matches, file); [off] marks switched-off ones when Chrome is reachable
trif disable <site>/<mod> [TAB]  switch a mod off (mod.enable; reloads TAB/the active tab if the mod runs there)
trif enable <site>/<mod> [TAB]   switch it back on
trif approve <site>/<mod>        let a held mod run (see "Run scope"); refused inside an agent run
trif delete <site>/<mod>         move a mod to ~/.trif/trash (kept 30 days); inside a run, through the helper (mod.delete)
trif restore [<site>/<mod>]      put back the newest trashed copy of a mod; no id: list the trash
trif check <file|site/mod>       compile a mod without running it; prints the syntax error or "ok"
trif new <site> <mod>            create sites/<site>/<mod>.js from a template, print its path
trif install-example <site>/<mod>
trif mod-update <site>/<mod> [--use-new|--keep|--merged]   a shipped mod's new version (see "Updates to shipped mods"); refused inside an agent run
trif help [command]
```

`TAB` is `--tab <id>` or `--url <substring|/regex/>`. Exit code 0 on success, 1 on a command error,
2 when the helper isn't running (message: open Chrome; if Chrome is open, run `trif doctor`). Output
is plain text for humans and agents: no colours when stdout isn't a TTY. `--json` makes any command print
the raw result as JSON.

## CLI ⇄ helper (unix socket)

Newline-delimited JSON on `~/.trif/helper.sock` (mode 0600). Request `{id, cmd, args, token?}` →
response `{id, ok, result|error}`. Helper-local commands (`mods`, `ping`) are answered by the helper;
everything else is forwarded to the extension. Requests time out after `args.timeout + 5000` ms (default 35 s).
Agent commands (`agent.list`/`agent.start`/`agent.stop`) are helper-local too; after answering `agent.start` with `{runId}`, the helper streams `{type:"agentEvent", runId, event}` lines (no `id`) on that same connection until the `done` event.
`token` is the run token (see "Run scope"): the CLI sends `$TRIF_RUN_TOKEN` when it's set.
If the socket file exists but nothing listens, the next host to start removes it.

**Several browsers.** Each browser (or Chrome profile) that runs the extension starts its own host. Every
host serves its own socket, `helper-<pid>.sock`, and removes it on exit (a host starting up removes those
whose pid is dead). The first host also serves `helper.sock`; later ones log that they're secondary and
take over `helper.sock` when the first exits. Mod files are shared: every host watches the same folder.
Which socket the CLI uses:
- `--browser <name|pid>`: the host whose extension said hello with that browser name (`Chrome`,
  `Firefox`, case-insensitive) or that pid (`lib/helpers.js` pings each `helper-*.sock`). Two hosts for
  the same browser (two Chrome profiles) need the pid. Refused inside an agent run.
- Inside a side-panel agent run: no socket. The CLI writes to the run's mailbox (`$TRIF_RUN_BOX`, see
  "Run scope"), which the host that started the run serves, so a run started from Firefox's sidebar works
  on Firefox's tabs even while Chrome's host owns `helper.sock`.
- `$TRIF_SOCK`, when set: that socket.
- Otherwise `helper.sock`.
`trif status` and `trif doctor` list the other connected browsers.

**Mods made in another browser start off.** Each extension install has a random `installId` (in its
storage, sent in `hello`). A run marks itself in `<home>/active-runs/<runId>.json` (`{runId, by, browser,
site, pid}`; `endedAt` when done, honoured for 15 s). When a helper's scan first sees a new mod id, it
records in `<home>/origins.json` the run that made it (one on the mod's site first, else its own, else
any): `{"<id>": {by, browser, at}}`; with no run going (a terminal agent, a hand edit) the id has no
origin. Mods go to the extension with `origin: {by, browser}`, and an extension switches off a mod whose
`origin.by` isn't its own `installId` the first time it sees it (`startedOff`, as for preinstalled mods);
the panel tags it "from <browser>" while it's off.

## Native host installation (`trif setup`)

First install, for anyone with Node ≥ 18: **`npx timsrobot setup`**. The npm package `timsrobot` (root
`package.json`, `bin: trif → helper/cli.js`) ships `helper/`, `extension/`, `examples/` and this file.
Re-running setup is safe; run it again to update.

- **Where the wrappers point (install mode).**
  - `copy` (default when the package isn't a git checkout, i.e. `<package>/.git` doesn't exist, as
    with npx, whose folder is a cache npm may delete): setup copies `package.json`, `helper/`,
    `extension/` and `examples/` into `~/.trif/app/` and the wrappers run that copy. The copy goes to
    a temp sibling (`.app.new-<pid>`) and is then swapped in, so a failed copy leaves a working install
    alone; when `app/` already matches byte for byte, nothing is touched (a running helper keeps its files).
    Every install into `app/` (setup, an update, either browser's helper) holds `<home>/.app.lock`
    (`helper/lib/lock.js`: made with O_EXCL, holding the owner's pid and a token; taken over when that pid
    is dead or the lock is older than 15 minutes). A second install while one holds it is refused ("another
    TRIF install is in progress"). Leftover `.app.new-*`/`.app.old-*` folders are removed only when the
    pid in their name is dead.
    Running setup from the copy itself (`trif setup` through the wrapper) leaves it in place.
  - `link` (default in a git checkout, for developing TRIF): the wrappers run the checkout's files.
  - `--copy` / `--link` force either mode.
  AGENTS.md, CLAUDE.md, the mod template and the examples always come from the files the wrappers run.
- Preinstalled mods (Tim's mods): the examples listed in `PREINSTALLED` (helper/lib/preinstalled.js:
  Google, X, Amazon, Instagram and timsrobot.com mods, each marked on or off), copied into `sites/` only
  for the sites the user chooses, site by site (a site is its scope: google.com for www.google.com): the
  setup page's "Tim's mods" step (a checklist, the sites in `SITES_ON` ticked; "Add these" or "Start with
  none"), Settings in the panel, a site's own panel ("Add Tim's mods for <site>"), or `trif setup
  --examples [sites]` (`--no-examples`: none). The extension sends the panel's `shipped.install {sites,
  others?: 'none', tab?}` / `shipped.none` to the helper, which only the user can ask for (refused from an
  agent run, like `mod.approve`). Adding a site copies its mods and offers it if it's in `SITES_ON`
  (google.com, x.com, amazon.com, instagram.com). `~/.trif/preinstalled.json` =
  `{starter, skipped, offered, startOff, sitesOn}`: `starter` = `{"<site>": "added"|"none"}`, the user's
  choice (no entry: not chosen, like a site a later version brings mods for, which Settings offers); a
  site with ids in `offered` counts as added (a workspace from before 0.2.5, whose setup added every site); a single `"added"` or `"none"`, from development builds before 0.2.5, counts as that choice for every site).
  `skipped` = the ids of an added site's mods the user chose not to add (`shipped.install` with `ids`; the
  setup page adds whole sites): never copied, by any setup or update, until the user adds them. A mod the
  user deleted stays gone too (it's in `offered`); Settings shows both as not added ("Add the rest"), and
  adding the site brings them back fresh: `readded` = `{"<id>": stamp}`, sent on the mod as `readded`, and
  each browser switches it as `PREINSTALLED` lists it once per stamp (`applyReadded`; chrome.storage.local
  `readded`). Only added sites get new mods (off, as `PREINSTALLED` lists them) and updates. The mods message carries `starter`
  (`starterOffer`: `{chosen, sites: [{site, name, note, choice, suggested, mods: [{id, name, description,
  on, choice: "added"|"deleted"|"skipped"|null}]}]}`) for the setup page and the panel. `offered` keeps a later setup from bringing back one the user deleted
  (an existing file is never overwritten); `startOff` lists the copied ones that start off. The helper
  sends those mods with `startOff: true`; the extension switches each off (`disabled`) the first time it
  sees it and remembers that in chrome.storage.local `startedOff`, so afterwards the switch is the user's.
  Later setups update the copies (see "Updates to shipped mods"); `preinstalled.json` also holds `shipped`.
  `sitesOn` goes with every mods message; the extension turns each site on the first time it sees it
  and remembers that in `sitesOffered` (`applyStartSites`). `--no-examples` records none for the sites not
  chosen yet, and skips updates that time.
- Wrapper: `~/.trif/bin/trif-host` (and the same as `bin/webmods-host`, its name before 0.2.0, which
  manifests written then may name; likewise `bin/webmods` beside `bin/trif`) = `#!/bin/sh\nexec "<absolute node path>" "<app>/helper/host.js" "$@"`
  where `<app>` is `~/.trif/app` (copy) or the checkout (link)
  (Chrome launches hosts with a minimal PATH, so the node path is absolute).
- Manifest `com.webmods.helper.json` → `{ name, description, path: <wrapper>, type: "stdio", allowed_origins: [...] }`
  where `allowed_origins` is `chrome-extension://<id>/` for every TRIF extension ID (see "Extension
  identity"), written to each selected browser's `NativeMessagingHosts` dir (macOS:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `…/Chromium/…`,
  `…/BraveSoftware/Brave-Browser/…`, `…/Microsoft Edge/…`; Linux: `~/.config/google-chrome/NativeMessagingHosts` etc.).
  Arc reads Chrome's folder, not its own (`…/Arc/User Data/…`, as of Arc 1.169), so setup for Arc writes
  both, the same file in Chrome's as Chrome's own (`helper/lib/browsers.js` `nativeDirs`).
  Default: every one of those browsers whose parent folder exists (a Chromium one's holding only
  `NativeMessagingHosts`, as Chrome's after setup for Arc, doesn't count). `trif doctor` fails a manifest
  that is missing any of the IDs, and checks Arc's in Chrome's folder.
- CLI link: `~/.trif/bin/trif` (shell wrapper like the host's), and it prints a line to add
  `~/.trif/bin` to PATH if it isn't there. If `/usr/local/bin` is writable, it also symlinks
  `/usr/local/bin/trif`.
- PATH for agents: setup records the terminal's PATH in `config.json` (private folder) `env.PATH`, minus the folders npx
  adds for its own run.
- Extension: until the Chrome Web Store listing exists, users (beta testers) load it unpacked from
  `<app>/extension` (setup's "Next steps" print the folder). The listing will replace that step.
- Version: the root `package.json` is the single source; `helper/lib/paths.js` reads it and
  `extension/manifest.json`'s version must match (a test checks).

## Renamed from WebMods (0.2.0)

TRIF was WebMods until 0.2.0. What changed name: everything a person sees (the extension's name TRIF, its
description, the panel, setup and doctor output, docs), the command (`trif`; `webmods` is kept as an alias:
both wrappers are written, the npm package has both bins, and Claude runs may use either), the workspace
(`~/.trif`), the npm package (`timsrobot`), environment variables (`TRIF_*`; `WEBMODS_*` still read, see
`helper/lib/env.js`), the website (timsrobot.com; the Worker redirects webmods.dev there), release asset
names (`timsrobot-<version>.tgz` …), the in-page API (`window.trif`, with `window.webmods` the same object), the
Safari app (`TRIF.app`, bundle IDs `com.timsrobot.trif[.extension]`, a new extension to Safari), the Safari
bridge's launchd label (`com.timsrobot.trif.safari-bridge`; setup stops and removes
`dev.webmods.safari-bridge`), run mailboxes (`~/Library/Caches/TRIF/boxes`) and keychain names in
`scripts/release.js` (old names still found).

What kept its old name, because changing it would break existing installs or updates: the Chrome
extension key/ID and the Firefox add-on ID `webmods@webmods.ext` (browsers would see a new extension and
drop its settings and updates); the native host name `com.webmods.helper` (Firefox updates the add-on on
its own schedule, so add-on and helper versions mix for a while, and both must find each other by name;
nobody sees it); extension storage keys; the in-page globals `__webmods`, `__webmods_runs` and the user
script id `webmods-runtime`; the `// ==WebMod==` header; and `@source webmods` in the shipped mods (changing
their text would make every edited copy offer a "new version"; `@source trif` counts too).

**Moving the workspace** (`helper/lib/migrate.js`). Whenever setup sets up the default workspace (no
`--home`/`TRIF_HOME`, or one naming `~/.webmods` or `~/.trif`), it first moves `~/.webmods` to `~/.trif` with
one rename and makes `~/.webmods` a relative link to `.trif`. That covers the way 0.1.x installs get 0.2.0:
their updater runs the new version's `setup --copy --no-link --home ~/.webmods` from inside
`~/.webmods/.update-*`, holding `~/.webmods/.app.lock`. Through the link, the updater's tmp folder, the new
version's own files, the lock (it moved with the folder, and its token comes down as
`WEBMODS_INSTALL_LOCK`), `~/.webmods/app/package.json` (which the updater reads to see the new version
installed) and its state writes all still resolve. Chrome keeps loading an unpacked extension from
`~/.webmods/app/extension`, so the link has to stay (doctor warns when it's gone). Cases: a link to `~/.trif`
already: nothing; a link elsewhere (the user keeps the workspace somewhere else): `~/.trif` becomes a link
to the same place; both folders real: merged into `~/.trif`, which wins conflicts, `~/.webmods`' conflicting
copies kept in `~/.trif/old-webmods-<date>/`; another live process installing in `~/.webmods` (its lock):
skipped, try again. A workspace elsewhere (`TRIF_HOME`) isn't moved. Until setup has run, the default
workspace is `~/.webmods` if only that exists (a git checkout's helper restarting onto new code first).

Running helpers keep working through the link (their sockets moved with the folder). A 0.2.0 helper that
started on a folder that has since become a link exits when idle (host.js `homeMoved`), and an older one
sees its code change on disk (its `app/` now resolves to the new copy), so each browser starts a fresh
helper on `~/.trif`. Run sandboxes get real paths (`runLimits`), and the `~/.webmods` link is left out of
the denied home-folder entries, since a sandbox that resolves it would deny the workspace itself.

## Updates

`helper/lib/update.js`. Releases are made by `scripts/release.js`, which writes two feeds into `updates/`
on the main branch; both are read from raw.githubusercontent.com for the repo in package.json
`repository`:

- `updates/latest.json` (+ `latest.json.sig`) for the helper: `{version, published, notes, package:{url,
  sha256, size}}`, where `package.url` is the release's npm tarball on GitHub. The `.sig` is an Ed25519
  signature of latest.json's exact bytes by the release key; `helper/lib/release-key.js` holds the public
  half. A feed with a missing or wrong signature, a non-https package URL, or a download whose size or
  sha256 doesn't match is refused.
- `updates/firefox.json` for Firefox: its update manifest (`addons[id].updates[{version, update_link,
  update_hash}]`). The Firefox build's `browser_specific_settings.gecko.update_url` points at it, so
  Firefox updates the signed add-on itself.

The helper checks the feed a minute after it starts and every 6 hours, fetching it at most every 20 hours
(state in `<home>/update.json`), and sends the result as `{type:"update"}`. Installing (`update.install`,
or by itself when config.json `autoUpdate` is true and no run is going) downloads the tarball, verifies
it, unpacks it into `<home>/.update-*`, and runs the new version's `helper/cli.js setup --copy --no-link
--home <home> --browser <the browsers with a manifest now>` with the PATH setup recorded, which swaps it
into `<home>/app` like a first install. The whole install holds the install lock (see "Native host
installation"); the setup it runs gets the lock's token in `TRIF_INSTALL_LOCK`, so its copy goes ahead
under the parent's lock. If `<home>/app` holds the new version afterwards but setup exited non-zero (a
later step failed: a manifest, the Safari bridge), the update counts as installed: `lastInstalled` gets a
`warning` with setup's last lines, the helper logs it and `trif update --install` prints it. Then
`{type:"updated"}` and `{type:"reload"}`. Only installs
running from `<home>/app` update themselves; a git checkout says to use git. config.json
`checkForUpdates: false` stops the checks.

`Summary = {current, latest, available, notes, published, checkedAt, error, auto, checks, source,
canInstall, why, lastInstalled, installing}`.

Helper commands (from the extension, or the CLI over the socket; never from inside an agent run):
`update.check {force}` → Summary; `update.install` → `{from, to, notes}`; `update.setAuto {on}` → Summary;
`report.build {site, siteOn, mods:[{id, enabled, registered, error}]}` → `{text, email}`: the problem
report (`helper/lib/report.js`: versions, doctor warnings, recent log warnings folded together, scrubbed
of the home folder, user name, email addresses, query strings and token-like strings) → `{text, email,
url}`: `url` is package.json `bugs.url` (the report form, https://timsrobot.com/report), `email` its
`bugs.email`. The panel opens `url#r=<text>&s=<site>` in a tab: the form reads the report from after the
`#`, which browsers never send to a server, so nothing is sent until the person presses Send there
(`site/`, a Cloudflare Worker that emails it to the maintainer).

CLI: `trif update [--install] [--auto on|off]` works without the helper (a running helper notices the
new `<home>/app` within 30 s and asks the extension to reload); `trif report` asks the helper, or
builds a shorter report without it; `--open` opens the form with it filled in.

## Updates to shipped mods

`helper/lib/preinstalled.js`. The preinstalled mods get fixes in later TRIF versions (Detox Timeline when X
changes). Every setup, which is also how an update installs, brings them to the user's copy without ever
overwriting the user's own changes. Only examples whose header says `@source webmods` and that are in
`PREINSTALLED` are managed.

- **What was shipped.** `preinstalled.json` `shipped` = `{"<id>": {hash, version, pending?, declined?,
  replaced?, own?}}` (or `{retired}`, see "Retired mods"): `hash`/`version` are the sha1 and `@version` of the shipped version the user's copy
  is based on, and `<home>/.shipped/<site>/<mod>.js` keeps that exact file (the merge base). `hash` is
  null for a copy edited before the record existed (its starting point is unknown). `own: true`: the
  user had their own file under that name before it was offered; never touched.
- **Older workspaces** have no record. There, a copy whose sha1 is in `examples/shipped-history.json`
  (`{"<id>": [sha1 of every version git has of examples/sites/<id>.js]}`, written by
  `scripts/shipped-history.js`, which `scripts/release.js` runs for every release and commits with the
  version bump; it ships in `examples/`) counts as unchanged.
- **Each setup**, for each managed mod already offered:
  - the user's file is gone: left gone;
  - it is the new version already: recorded;
  - it is based on the new version already (`hash` equals it: merged, then edited): nothing to do;
  - the user declined this version (`declined`): nothing;
  - it is unchanged since shipped (its sha1 is `hash`, or with no record, in the history): replaced with
    the new version (written to a dot-named temp file and renamed), base updated. Switches are keyed by
    mod id in the extension, so they carry over;
  - otherwise (edited): untouched; `pending = {hash, version}` and the new version kept in
    `<home>/.shipped/<site>/<mod>.new.js`.
  Setup prints "updated to the new version: …" and "new version waiting, not installed because you
  changed these: …".
- **Telling the user.** Each mods message gives a mod with an update waiting `update: {version, from,
  modified}` (`modified`: the copy differs from the base, so using the new version loses changes; a copy
  that already is the new version has none). The helper's sync fingerprint includes
  `preinstalled.json`, so a setup elsewhere shows up within the poll interval. `trif mods`/`status` say
  "update available (you've changed it): version N". The side panel shows, on that mod, a notice with
  **Use the new version**, **Keep mine** and (when modified) **Merge with my agent**.
- **Helper command** `mod.update {id, choice: "new"|"mine"}` (extension or socket; refused inside a run,
  like `mod.approve`):
  - `new` → `{id, choice, version, trashed}`: the user's copy goes to the trash (trash.js), the new
    version takes its place and becomes the base; `replaced` remembers how things were. `mod.restore`
    (the panel's Undo, `trif restore`) while the file is still that new version puts the user's copy
    back and the update is pending again. The panel adds `{role:"mod", text:"x.js is now version 2 from
    TRIF; yours is in the trash.", undo: id}` to the chat.
  - `mine` → `{id, choice, version}`: `declined = <its hash>`, so it isn't offered again; a later version is.
- **Merging** takes two ordinary side-panel runs in one chat. The first is `agent.start` with `merge:
  "<id>"` (from the mod's own site: the scopes must match). The helper appends to the prompt where the
  three files are, relative to the workspace: the user's copy (`sites/…`, the only one to edit), the new
  version (`.shipped/…/<mod>.new.js`) and the base (`.shipped/…/<mod>.js`, or a note that it isn't known),
  and asks the agent not to change anything yet: explain in plain words what TRIF changed, what the user
  changed, and how it would merge them (what it brings in and keeps, conflicts and which side wins), then
  ask whether to go ahead and stop. The user's reply ("go ahead") is the next run in the chat, which
  edits the user's copy: keep the `@source` line, set the new `@version`. Same sandbox, scope and
  held-mod rules as any run: `.shipped` is readable (it isn't in `PRIVATE_FILES`) and not writable
  (outside the mods folder; Claude Code's sandbox also denies it).
  **Settling.** The helper remembers the proposal (in memory: mod id → its scope, the new version's hash
  and `@version`, and the sha1 of the user's copy then). After every run on that site that ends, it
  checks the user's copy: changed since the proposal *and* saying the new `@version` (when it has one)
  means merged, and the pending version becomes the base (if it's still the one waiting), before the
  mods go out again and `done` is relayed. The proposal run itself (nothing changed) and unrelated edits
  (old `@version`) leave it waiting; runs on other sites never settle it. If the update was used, kept
  or settled otherwise meanwhile, the proposal is dropped. After a helper restart, Merge proposes again.
  `trif mod-update <id> --merged` settles it after a merge in a terminal.
- **Retired mods.** A shipped mod can be folded into another one: `RETIRED` = `[{id, into, since}]`
  (0.2.0: `www.google.com/hide-ai-mode` into `hide-ai-in-results`, AI Banisher; `hide-sponsored` into
  `hide-extra-sections`, Just Results; both `since: "2"`). The merged mod keeps its id, so its switch,
  sites, edits and `offered` entry carry over and its new version arrives as any update does; the
  retired id leaves `PREINSTALLED` and `examples/` (its versions stay in `shipped-history.json`), so it's
  never offered again. `retireShippedMods` runs after the updates in every setup, and after
  `mod.update new` or a settled merge of an `into` mod. For each retired id the user was offered and
  doesn't own:
  - their copy is gone: `shipped[id] = {retired: {into}}`;
  - edited (its sha1 isn't a shipped version, `hash` or `pending.hash`): untouched, still running, no
    more updates: `{retired: {into, kept: true}}` (its pending update and `.shipped` files dropped).
    Setup says once: "<name> (<id>) is now part of <into's name>. You changed your copy, so it's left as
    it is: it keeps running, without updates. Delete it if <into's name> does what you need.";
  - unchanged: to the trash (trash.js), `{retired: {into, trashed: "<file>"}}`, but only when `into` is
    there, not `own`, with `hash` set and `version` ≥ `since` (an edited `into` with the merged version
    still waiting, or kept, needs the old copy to keep doing its part). Setup says "<name> is now part of
    <into's name>: the old copy is in the trash (trif restore <id> brings it back)". While "Use the new
    version" of `into` can be undone, its `replaced.retired = [{id, rec}]` lets `mod.restore` bring
    these back with their records.
  Each mods message gives `into` `absorbs: [ids trashed]`. The extension (`applyAbsorbed`), the first time
  it sees each such id and only if it isn't back in the mods, gives `into` the switch state "on if either
  was on": unchanged if the old one was off; the old one's `disabled`/`offSites` if only it was on; both
  on: off only on sites both were off on. It remembers that in chrome.storage.local `absorbed`, so after
  that the switch is the user's. A new workspace just gets the merged mods.

## Repository layout

```
extension/   manifest.json, background.js (service worker), runtime.js (page runtime source),
             onboarding.html/.js, icons/, safari.js + safari-background.js (Safari build only)
package.json the npm package `timsrobot` (version, bin, files allowlist)
helper/      host.js, cli.js, safari-bridge.js, lib/*.js, workspace/AGENTS.md, workspace/CLAUDE.md, templates/mod.js
examples/    sites/<site>/<mod>.js (the shipped mods), shipped-history.json (scripts/shipped-history.js)
tests/       node tests (node --test), incl. a fake extension for the helper and a chrome.* mock for the extension;
             tests/e2e/ the opt-in browser suite (docs/TESTING.md)
docs/        PROTOCOL.md (this file), TESTING.md
scripts/     build-extension.js (Chrome/Firefox/Safari builds), build-safari.js (the Safari Mac app),
             release.js (releases, see "Updates"), shipped-history.js, render-icon.js
beta/        START HERE.txt templates for the beta zips (Firefox, Chrome)
updates/     the update feeds, written by release.js (latest.json + .sig, firefox.json)
CHANGELOG.md what's new per version (the panel's "What's new")
site/        timsrobot.com, the report form (a Cloudflare Worker; site/README.md)
```

Tests run with `node --test` (Node's built-in runner). No dependencies.

## Side panel and agent runs (step 5)

The side panel lets people customize the site they're on by chatting: they type "hide reposts", the
helper starts **their own coding agent** headless in the workspace, and the panel streams what it does.
Nothing is hosted; the agent uses the user's own login/subscription.

### Extension

- `manifest.json`: add permission `sidePanel` and `"side_panel": {"default_path": "sidepanel.html"}`.
  Clicking the toolbar icon opens the side panel, and clicking it again closes it: `action.onClicked` calls
  `chrome.sidePanel.open`/`close` (`openPanelOnActionClick` is false), so the click gives TRIF `activeTab`
  for screenshots (see "Site access"). In browsers without Chrome's side panel, a panel window instead (below).
  The onboarding/status page stays, opened from the panel's "Setup" link, and automatically on first install.
- **The panel in a window.** Some Chromium browsers have `chrome.sidePanel` but not Chrome's side panel:
  Arc replaced Chrome's browser UI, where the side panel lives, so `sidePanel.open()` resolves and nothing
  shows (Chrome's own `open()` doesn't wait for the panel either). So a side panel posts `{type:
  "panel.window", windowId}` on its port as soon as it loads, and a click counts as having opened it only
  when that arrives. If it doesn't within 1 s (`PANEL_OPEN_WAIT_MS`), or `open()` fails, or there's no
  `chrome.sidePanel`, the background opens `sidepanel.html?window=<id>&fallback=1` in a popup window (an
  ordinary one if the browser makes no popups), 400 px wide and as tall as browser window `<id>`: beside its
  right edge when that screen has room, else over it, inside the screen. The background can't see screens,
  so the panel window reports its own (`screen.avail*`, kept in `chrome.storage.local` `panelScreens`, a few)
  and moves itself beside the window when it opened over it but there's room.
  - It follows window `<id>`'s active tab, not its own (`view.windowId`; tabs it opens go there too), and
    says so with `{type: "panel.window", windowId: <id>, own: <its window>}`. It closes when window `<id>`
    closes, and at once when that window isn't there (restored after a restart).
  - The next click in window `<id>` closes it, or brings it back when it's minimized or behind that window
    (it overlaps it, and the window was focused after it, not by the click itself: `panelWindowClick`; the
    background watches window focus only while there's a panel window). A click while one is being opened
    doesn't open another. One panel window per browser window, like side panels.
  - The browser is remembered (`chrome.storage.local` `panelInWindow: true`): later clicks open the window
    at once. They still call `sidePanel.open()` first, from the click; a side panel that says it's there
    within 10 s of a click that opened a window (`PANEL_LATE_MS`: a slow start in Chrome, or a browser that
    gained a side panel) closes that window and forgets `panelInWindow`. So nothing needs retrying.
  - Found by URL (`windows.getAll`, `panelWindowTarget`), so a restarted service worker still finds it.
  - The click is still what gives TRIF `activeTab` on the tab: a panel window changes nothing there.
  - Not in Safari (its panel window is `safari.js`'s) or Firefox (its sidebar).
- `sidepanel.html/.js/.css`: follows the active tab of its window.
  - **Header:** the current site (hostname without `www.`), a status dot (helper connected, user scripts
    on, agent available), a settings button.
  - **Mods on this site:** the mods whose matches cover the current tab (name, file name, on/off switch;
    see "Mod switches"), collapsed by default when there's a chat.
  - **Chat:** one conversation per site, persisted in `chrome.storage.local` under `chat:<site>` =
    `{sessionId, agent, messages: [{role: "user"|"assistant"|"tool"|"error"|"login"|"mod", text, time}]}`, at most 500
    messages, each message's text cut at 20 000 characters and the chat at about 1 MB (oldest messages
    dropped first; `capChat` in lib.js). The manifest asks for `unlimitedStorage`, so Chrome's 10 MB quota
    doesn't apply. A text box
    (Enter sends, Shift+Enter newline), Send / Stop, "New chat" (forgets the sessionId and messages).
    Assistant text renders as simple markdown (paragraphs, lists, `code`, code blocks, bold, links that
    open in a new tab), escaped first: never inject agent or page text as raw HTML. Tool events render
    as one compact line each ("ran trif reload --tab 12", "edited sites/x.com/hide-reposts.js").
    A run that failed for want of a login (its `done` has `error.kind: "login"`, see below) leaves one
    plain `login` line ("Claude Code needs you to log in again.") instead of an error, and none of the
    agent's own text about it; the panel shows its login notice, and the message that run was sent goes
    back in the text box (unless something was typed there meanwhile), to send again once logged in.
    While running: a working indicator, the Stop button.
  - **Slash commands.** The panel handles `/model [name|default]` (sets the model setting: each message
    is a new agent process, so the agent's own `/model` would last one message), `/clear` or `/new`
    (New chat) and `/help`, answering with a tool-style line (`chat.note`). Any other `/…` goes to the
    agent as the message; Claude Code runs its own commands in -p mode (`/compact`, `/context`, `/cost`…).
    The claude adapter turns compaction status lines into tool events ("compacting the conversation",
    "compacted the conversation"), skips the messages Claude Code replays after `compact_boundary`, and
    emits a command's `<local-command-stdout>` as text.
  - **Mod badges.** A mod's `risk` tier 1 shows "detectable", tier 2 "changes requests" (tooltip: what
    that means, plus the header's reason). A mod matching other sites too shows "N sites" or "all
    sites" (`modSites` in lib.js; tooltip lists them and says the switch is for this site only). The setup
    page groups mods by site: the folder (minus `www.`) if the mod runs there, else its one site, else
    "Several sites"; mods matching any host go under "Every site".
  - No reload prompt: the agent reloads the tab after each change (AGENTS.md), and switches reload it too.
  - **States:** helper not connected → short setup instructions (`npx timsrobot setup`, link to Setup page);
    user scripts off → button opening chrome://extensions/?id=…; agent missing → the error text from the
    helper (it includes the fix); agent not logged in (`loggedIn === false` in `agent.list`, or the chat's
    last line is a run's `login` line) → "Claude Code isn't logged in" with a **Log in** button (see
    "Logging in" below; agents with `canLogin: false` show `loginFix` instead). Send waits for the login,
    except when `loginExpired` (below): the agent's own check still says logged in then, so after
    logging in from a terminal, sending again is the only way to tell.
  - **Settings:** agent (from `agent.list`; only available ones selectable), optional model name (free
    text with suggestions opus / sonnet / haiku, empty = agent default), for this site's chat: each site
    chat has its own (see "Agent and model per site chat" below).
  - Light/dark via `prefers-color-scheme`; compact, clean, system font; fits a narrow panel (320 px+).
- Panel ⇄ background: `chrome.runtime.connect({name: "panel"})`. Panel → background:
  `{type: "agent.start", site, tabId, url, prompt, sessionId, agent, model}` (the panel sends no
  `openModel`; background.js would pass one on), `{type: "agent.stop", runId}`,
  `{type: "agent.openModel"}`, `{type: "agent.openModel.set", provider, model, baseUrl}`,
  `{type: "agent.openModel.setKey", key}`, `{type: "agent.openModel.removeKey"}`,
  `{type: "agent.list"}`, `{type: "agent.login", agent}`, `{type: "agent.loginCode", loginId, code}`,
  `{type: "agent.loginCancel", loginId}`, `{type: "status"}`, `{type: "mod.enable", id, enabled, tab}`,
  `{type: "mod.approve", id, tab}`, `{type: "mod.update", id, choice, site, tab}`, `{type: "mod.delete", id, site, tab}`, `{type: "mod.restore", id, site, tab}` (the tab is reloaded if the mod runs there; with `site`, the chat gets a `{role: "mod", text: "x.js was deleted.", undo: id}` line, marked `undone: true` once restored, and a "was restored (off, as before)" line), `{type: "shipped.install", ids or sites, others?, tab?}` and `{type: "shipped.none"}` (Tim's mods: the setup page, Settings, a site's panel; with `tab`, it reloads if one of the added mods runs there), `{type: "instructions.get"}`, `{type: "instructions.set", text}`, `{type: "chat.clear", site}`, `{type: "chat.note", site, text}`. Background forwards agent commands to the
  helper as native `request`s with the same cmd and relays every native `{type: "agentEvent", runId,
  event}` to all panel ports (panels ignore runs and logins they didn't start, by id).
  If the helper disconnects mid-run (or mid-login), the background sends the panel `{kind: "error"}` then
  `{kind: "done", ok: false}` (plus `login: true` for a login).

### Helper

New native request commands (answered with a normal `response`):

| cmd | args | result |
|---|---|---|
| `agent.list` | – | `{agents: [{id, name, path, available, version, note, loggedIn, loginExpired?, canLogin, loginFix}], default}` |
| `agent.start` | `agent, model?, site, url, tabId, prompt, sessionId?, merge?, openModel?` | `{runId}` right away; progress arrives as `agentEvent` messages. `merge`: a shipped mod's id, to merge its new version (see "Updates to shipped mods"). `openModel`: codex-oss only, this run's `{provider, model, baseUrl}` over the stored defaults (see "Open models") |
| `agent.stop` | `runId` | `{stopped: true}` (SIGTERM, SIGKILL after 3 s) |
| `agent.running` | – | `{runIds}`: the runs still going. In Safari the helper outlives the connection (the bridge keeps the host and queues its messages), so a chat's run survives a lost connection or a restarted background there instead of being marked interrupted; after reconnecting, the background finishes the ones that ended meanwhile (background.js `settleOrphans`) |
| `agent.login` | `agent?` | `{loginId}` right away; progress arrives as `agentEvent` messages with `runId` = the loginId |
| `agent.loginCode` | `loginId, code` | `{sent: true}` (writes the code and a newline to the login's stdin) |
| `agent.loginCancel` | `loginId` | `{cancelled: true}` |
| `mod.approve` | `id` | `{id, approved: true}`: releases a held mod, allowing what was found in it (see "Run scope"); also on the socket, not from a run |
| `mod.review` | `id` | `{id, allowed: [key]}`: "Looks right" on a mod to review: what TRIF found in it is allowed; not from a run |
| `mod.code` | `id` | `{id, code, truncated}`: the mod's code as the helper read it (the panel's Show code), capped at 200 000 characters |
| `mod.delete` | `id` | `{id, deleted: true}`: moves `sites/<site>/<mod>.js` to `trash/<site>/<mod>@<UTC stamp>.js` (entries older than 30 days are removed), then re-sends the mods; also on the socket, and from a run for mods inside its scope |
| `mod.restore` | `id` | `{id, restored: true, file}`: moves the newest trashed copy back (fails if the mod exists again, except to undo `mod.update` `new`); same rules as `mod.delete`. The extension keeps a deleted mod's switch state, so it comes back as it was |
| `mod.update` | `id, choice: "new"\|"mine"` | a shipped mod's new version: use it or keep the user's copy (see "Updates to shipped mods"); also on the socket, not from a run |
| `shipped.install` | `ids?` or `sites?`, `others?: "none"` | Tim's mods: `ids`, just these (ids from `PREINSTALLED`, anything else refused; a site chosen for the first time this way gets its other mods `skipped`), or every mod not on disk of these sites (left out or deleted before: added fresh) (scopes: x.com, google.com; all of them without either): copied in, TRIF offered on for the sites in `SITES_ON`; `others: "none"` records none for every site not chosen yet. `{added: [ids], sitesOn: [sites newly offered], starter}` (see "Preinstalled mods"); also on the socket, not from a run |
| `shipped.none` | – | none for every site not chosen yet ("Start with none"): `{starter}`; also on the socket, not from a run |
| `instructions.get` | | `{text, file, max}`: the user's standing instructions (`~/.trif/instructions.md`, `''` if none) |
| `instructions.set` | `text` | same; trimmed, at most 4000 characters, empty removes the file. Not from a run |
| `agent.openModel` | | `{openModel, configured, effective, providers, hasKey, key?}`: the open model's stored defaults (see "Open models"); for a hosted provider `key: {account, stored, keyring, error}` and `hasKey` (whether its API key is in the system keyring; never the key). Not from a run |
| `agent.openModel.set` | `provider?, model?, baseUrl?` | stores them in config.json `openModel` (merged; `''` clears a field; a new provider drops the old one's model and URL); same result. Not from a run |
| `agent.openModel.setKey` | `key` | saves the stored provider's API key in the system keyring (see "The key"); never echoed back, logged or stored anywhere else; errors don't contain it; same result as `agent.openModel`. Not from a run |
| `agent.openModel.removeKey` | | removes it from the keyring; same result. Not from a run |

`loggedIn` is `true` / `false`, or `null` when unknown or the agent isn't available (from the adapter's
`loginStatus`, which spends no tokens; cached 30 s per agent, forgotten when a login finishes). After a
run of that agent fails for want of a login (`done.error.kind === "login"`), `loggedIn` is `false` with
`loginExpired: true`, whatever the agent's own check says (Claude Code's `auth status` still says logged
in with an expired login it can't refresh), until a login from TRIF works or a later run of that agent
does (in the helper's memory: a restart forgets it). `canLogin`: whether `agent.login` works for it;
`loginFix`: the terminal instructions otherwise.

New helper → extension message: `{type: "agentEvent", runId, event}` where `event` is one of
(normalized across agents):

```
{kind: "session", sessionId}                       the agent's conversation id (for resuming)
{kind: "text", text}                               a block of assistant text
{kind: "tool", name, summary}                      a tool call, e.g. {name:"Bash", summary:"trif reload --tab 12"}
{kind: "error", message}                           something went wrong (agent missing, crashed…)
{kind: "error", reason: "login", agent, message}   the agent's login is gone, expired or refused: "<Agent> needs you to log in again."
{kind: "done", ok, result, costUsd, changedFiles, sessionId, error?}   always the last event of a run
{kind: "login", url}                               (logins) the sign-in page to open
{kind: "done", ok, login: true, cancelled?}        (logins) always the last event of a login
```

- `changedFiles`: paths relative to the workspace under `sites/` whose content changed during the run
  (snapshot hashes before and after).
- `error: {kind: "login", agent, message}` on a failed run's `done`: it failed for want of a login (an
  `error` event with `reason: "login"` came first). The adapters recognise it from the agent's own
  words, in one place (`helper/lib/agents/util.js` `LOGIN_FAILURES`, from Claude Code 2.1.319's and Codex
  0.166's messages: "Not logged in", "Please run /login", "OAuth session expired", "OAuth token revoked",
  "login reached its time limit", "Invalid API key", `authentication_error`, HTTP 401 / Unauthorized,
  "sign in again", "codex login", "missing api key"), in a failed run's result, error events or stderr,
  never in a reply that worked. Not "could not be refreshed" alone (Claude Code also says that when
  another of its processes holds the refresh lock, or the disk is full). Not with a saved API key (runs
  then use the key, not the login: the agent's own words stay), nor for `codex-oss`. Claude Code also
  says such an error as a reply: text in those words waits for the result line and is dropped when the
  run failed that way. The run's session is dropped too (`done.sessionId` is the one the run resumed),
  so the message sent again isn't in it twice. `trif agent run` prints the message and how to log in
  (`trif agent login --agent claude`, or the agent's `loginFix`).
- One run at a time per site; a second `agent.start` for a busy site fails with "already working on <site>".
  Runs are killed after 15 minutes. Raw agent output is kept in `runs/<runId>.jsonl` in the private folder
  (last 50 runs).
- **Finding agents.** Chrome starts the helper with a minimal PATH, so `trif setup` records the PATH
  of the terminal it ran in as `config.json` → `env.PATH`. The helper looks agents up in that PATH plus
  `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.npm-global/bin`. Spawned agents get
  `PATH = ~/.trif/bin : <recorded PATH> : <defaults>`, `HOME`, `USER`, `LANG`, `TERM=dumb`, cwd =
  the workspace, and **no** inherited `CLAUDE*`/`ANTHROPIC_*`/`CODEX_*` variables and never an API key:
  a key the user saved reaches the provider through the run's key proxy (see "API keys for Claude Code
  and Codex" and "Open models").
- **Nothing private on the command line.** Any same-user process can read another's argv (`ps`, sysctl
  KERN_PROCARGS2), an agent's sandboxed commands included. So the user's message goes to the agent on
  **stdin** (`claude -p` with no prompt argument; `codex exec … -`, `codex exec … resume <id> -`), and
  Claude Code's run settings and context go in files (`--settings <file>`, `--append-system-prompt-file
  <file>`) in `<box root>/<runId>.agent/` (mode 700, files 600), beside the run's mailbox rather than in
  it (the run's commands can write there), removed when the run ends. What's left in argv: flags, rules,
  paths, the model name and session id, which must be one word (`[A-Za-z0-9][\w.:/@+[\]-]*`, so neither
  can read as an option).
- **Logging in** (`agent.login`): spawns the adapter's login command (claude: `claude auth login`) with
  the same sanitized env as runs plus `BROWSER=/usr/bin/true` (the panel opens the page itself), cwd =
  the workspace, stdin piped. The first `https://` URL after `visit:` in its output becomes the `login`
  event; other output lines become `text` events. The panel opens the URL in a new tab (only https on
  claude.com, claude.ai, anthropic.com or their subdomains), the user signs in, and pastes the code the
  page shows into the panel → `agent.loginCode`. When the process exits, `done.ok` = exit code 0 **and**
  a fresh `loginStatus` says logged in; otherwise an `error` event explains (the CLI's last lines).
  One login at a time: a new `agent.login` cancels the one in progress. Killed after 10 minutes.
  The code and the URL's query string are never written to `helper.log` or `runs/` (URLs are logged as
  scheme + host + path, codes are masked as `[code]`). Codex has no side panel login (`codex login`
  finishes via a localhost callback or a device code, untested): `agent.login` fails with its `loginFix`.
  `trif agent login [--agent claude]` runs the same flow from a terminal (prints the URL, reads the
  code from stdin).
- **Context for the agent** (prepended to the first message of a session, or passed as an appended
  system prompt where the agent supports it): "You're running inside the TRIF side panel in the
  user's Chrome. They're looking at <url> (tab <tabId>): pass `--tab <tabId>` to trif commands. Follow
  AGENTS.md. Mods can be switched off and on with `trif disable/enable <site>/<mod>`; `trif status`
  shows which are on. Reply briefly in plain language; your replies appear in a narrow chat panel. You can't ask
  follow-up questions mid-task: if something's unclear, make a sensible choice or end your turn with a
  question." Later messages in the session get a one-line reminder of the current URL and tab id.

### Run scope

Agent runs read web pages, and a page can carry instructions aimed at the agent. So each run is limited
to one site, its **scope**: the registrable domain of the run's site (`en.wikipedia.org` →
`wikipedia.org`; `bbc.co.uk`, `user.github.io` and a few other suffixes are handled; no full Public
Suffix List). `helper/lib/scope.js` computes it; `extension/lib.js` mirrors the checks.

- **Mailbox.** A run reaches the helper only through its mailbox: a folder made for it alone,
  `~/Library/Caches/TRIF/boxes/<runId>/` (`~/.cache/trif/boxes/` on Linux; `runs.js` boxRoot),
  given to the agent as `TRIF_RUN_BOX`. Its sandbox (below) has no network and no sockets, so this is
  the only way. The CLI writes a request (one JSON line, as on the socket) to `<id>.tmp` and renames it to
  `<id>.req`; the helper watches the folder, takes the file (opened without following symlinks, regular
  files of at most 8 MB), and writes the answer as `<id>.res` (created fresh, then renamed into place).
  Whatever a request in the mailbox says, the helper handles it as the run's: it puts the run's token in.
  The mailbox is removed when the run ends; a helper starting a run removes mailboxes older than twice
  the run time limit (left by helpers that died).
- **Token.** `agent.start` makes a random token per run and gives the agent `TRIF_RUN_TOKEN`; the
  CLI sends it with every request. The helper answers a request with an unknown token (the run ended)
  with an error, refuses `agent.*`, `mod.approve`, `mod.update`, `shipped.*` and `instructions.*` from a run, and sets `args.scope` on everything
  else it forwards (overriding any `scope` the client sent; `args` must be a plain object). Requests on
  the socket without a token (the user's terminal, the user's own agent outside the panel) are not
  scoped: runs can't reach the socket. The helper answers `mod.delete` and `mod.restore` from a run
  itself, only for mods whose every `@match` is in scope. The CLI itself refuses `setup`, `agent`,
  `approve` and `mod-update` when the variable is set, and inside a run its own file options stay in the run's folders:
  `-f` and `check` read only the mods folder, `-o` writes only there or the run's screenshots folder
  (`$TRIF_RUN_SCREENSHOTS`, `<private>/screenshots/<scope>/`, also where screenshots go by default;
  `trif screenshot -o name.png` with a relative name saves there), never through a link left in its
  place (O_NOFOLLOW). The run can't read `config.json`, so the helper passes the mods folder as
  `TRIF_RUN_MODS_DIR` (a custom `modsDir` holds for the run's `trif` too). Screenshots older than 30
  days are deleted when a run starts. Paths are compared as the file system does
  (`helper/lib/pathcheck.js` isInside, also used for the mods folder and held mods): real paths from the
  system's realpath (links and `..` resolved; on macOS each component in its on-disk case), the nearest
  existing parent for a new file, a separator boundary, and case and Unicode normalization ignored on
  volumes that ignore them (APFS by default: `/Users/x/.TRIF/SITES/` is the workspace's `sites/`).
- **Extension.** With `args.scope`, page commands only act on tabs whose URL is http(s) on the scope or
  a subdomain (`tabs` lists only those; others fail with an error naming the scope); `open`/`navigate`
  only go to such URLs; `record` only for such sites; `mod.enable` only for mods whose every `@match` is
  in scope. The tab can navigate between that check and the injection, so the document is checked again
  from inside (`lib.js` pageGuard: the scope, and TRIF on there): `run`'s code starts with the check,
  and the other page commands (`text`, `sweep`, `requests`, `request`, `errors`, `logs`) inject it first,
  in the isolated world, where it marks the document, and only count their result if the mark is still
  there afterwards (the same document). `screenshot --copy` checks the copy's URL after it loads and
  before every capture (redirects, scripts), and refuses addresses that look like one-time links
  (`screenshot.js` oneTimeUrl: token-like query parameters, sign-in callbacks, confirm, reset and
  unsubscribe paths) unless `force`, since the copy loads the page again with the user's cookies.
  `sweep --scroll` scrolls the tab itself, so it's refused on the tab the user is looking at (active in
  the focused window) unless `force`.
- **Locked tabs.** Before a run's `run` command executes code in a tab, the extension locks the tab
  (extension/tablock.js; docs/SECURITY.md): declarativeNetRequest session rules (the plain permission: block
  rules need no host access, so they also cover sites TRIF has none for) block every POST, PUT,
  PATCH, DELETE and WebSocket from it, and pages, frames, fetches and XHR to other sites, until it shows a
  new document (a marker in the extension's isolated
  world tells documents apart). If the lock can't be set up, `run` fails and the code doesn't run. The
  panel's status has `lockedTabs: [{tabId, site, url, since}]`.
- **Held mods.** Whoever wrote a mod, it's held while it's new or changed since the helper last let
  it run (`~/.trif/seen.json`, mod id -> hash; the first time, every mod there is recorded as it is) and
  it can do something not allowed for it (`held: {…, by: "outside"}`, `runId: null`; `trif approve` or the
  panel's Allow releases it). For side-panel runs: the helper snapshots the mod files when a run starts (the same files the scanner loads:
  `mods.js` listModFiles: links within the mods folder followed, links out of it ignored, no cap). On every mods sync while a run is live (and for 10 s
  after it ends; a finished run's leftover processes get SIGTERM, then SIGKILL after 3 s, so nothing
  writes later), a mod that the run added or changed is **held** while it can do something not allowed
  for it: what TRIF reads in its code (`powers.js`: sends, acts, navigates, loads, another site, hidden
  code; see docs/SECURITY.md), an `@match` outside the scope (`<all_urls>`, a `*` host, another domain,
  `file://`), or an `@risk` of 2. Recorded in `~/.trif/held.json` (`{id: {hash, site, scope, runId, at,
  reason, facts, needs, lines, claim}}`) and sent to the extension with `held: {site, reason, facts,
  claim}` (facts: TRIF's words; claim: the mod's own @risk reason or description), which the extension
  doesn't register. The run's `done` event carries `held: [{id, reason, facts}]`; the panel says so in the
  chat and lists the mod (also when it doesn't apply to the tab) with TRIF's facts, the claim apart, Allow
  (`mod.approve`) and Show code (`mod.code`). Allowing records what was found in `~/.trif/allowed.json`
  (`{id: {powers: [key], lines: {key: [line hash]}, at}}`) and drops the hold; a run's later change is held
  only for a power or a line using one that isn't allowed. A held mod the run changes again is worked
  out again; one changed after its run ended (by the user) is released. Mods the user has that can do
  something not allowed are sent with `review: {facts, claim}` (not held; the panel's "Looks right" is
  `mod.review`). `trif status`/`mods` show held mods and mods to review. A change in another site's existing folder, which the
  run's limits make read-only, isn't held on the run's account (someone else made it), but only for the
  folders the agent's adapter says it protected (`command()` returns `locked`; none if it doesn't say).
- **Agent sandboxes.** The scope only holds if the agent can't reach the helper some other way or
  rewrite the rules, so both agents run under limits the operating system enforces (macOS Seatbelt;
  `runs.js` runLimits computes them, each adapter passes them on):
  - **Reads, allow-only:** the workspace as a whole (nothing private is in it: see "The private folder"),
    the TRIF code `trif` runs (`trifCode`: the package's `helper/`, `package.json` and `examples/`, not
    the whole package folder, which in a git checkout holds `.git`, keys and build output), node, and the
    user's skill folders, read only
    (`skillDirs`: `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills` and where each skill in them
    really is, links followed; not a link to the home folder or above, nor into a visible folder such as
    `~/Documents`); nothing else in the home folder (every item in it is denied, rather than the folder
    itself, which node and `mkdir -p` must be able to look at; inside folders on the way to something
    readable, such as `~/.codex` for its skills or `~/src` for a checkout's `~/src/trif/helper`, every
    other item: Codex's login stays unreadable; but not inside `~/Documents`, `~/Desktop`,
    `~/Downloads`, `~/Library` and the other folders macOS asks the user about before they're listed);
    and never the private folder, denied by name wherever it is, with the run's own screenshots folder
    (`<private>/screenshots/<scope>/`) reopened inside it, as its mailbox is inside the denied
    `~/Library`. Real paths compared as the volume does (case on APFS). Codex offers the
    skills it finds and its commands can now read them; Claude Code doesn't load user skills in these runs
    (`--setting-sources project`), so its file tools may read them (absolute `Read(//…)` rules) but it
    isn't told they exist. A skill that needs the network (`npx …@latest`) still can't run its tool. Inside the skill folders (a
    skill can keep a token or an `.env` file next to its scripts), `skillSecrets` denies, four levels
    down: dotfiles and dot-folders (`.git`, `.env`…), except Codex's built-in `.system`, and anything
    named `.env*`, `*.pem`, `*.key`, `credentials*`, `secrets*` or `token*` (any case): in Codex's
    profile, in Claude Code's sandbox (`denyRead`) and as `Read` deny rules for its file tools. A link
    inside a skill folder that leads where the run may not read (elsewhere in the home folder, the
    workspace's secrets, or nowhere) gets `Read` deny rules too: sandboxes follow links and deny the real
    path, but Claude Code's Read tool runs outside the sandbox and matches rules against the path it's
    given, which the skill folder's allow rule covers. The trade-off: a skill's own script that reads a
    `.env` beside it can't, in a run; a secret under some other name, deeper than four levels or past
    the first 5000 entries is still readable (skill folders are the user's own, but keep secrets out
    of them). These skill-folder denies are the only ones inside a readable folder.
    "Allow-only" is about the home folder. Outside it, a run reads as the system allows, except: other
    users' folders and other volumes (`deniedOutsideHome`: each item in `/Users` and `/Volumes`, or `/home`,
    `/media`, `/mnt` and `/run/media` on Linux, but the home folder, the way to what the run may read, and
    `/Volumes/Macintosh HD`, a link to `/`; Codex), the user's own folder beside `$TMPDIR` (its caches;
    Codex), and the system's temporary folders (below). The system's own folders stay readable.
  - **Writes:** the mods folder, with every existing folder of another site (`all-sites/` included)
    read-only inside it; the run's screenshots folder; its mailbox. Not `held.json`, `preinstalled.json`, `.shipped/`,
    `origins.json`, `active-runs/`, `update.json`, `trash/`, `history/`, `.ran/`, `seen.json`, `allowed.json`, `instructions.md`, `AGENTS.md`, `TECHNIQUES.md`, `CLAUDE.md`,
    `.claude/`, `bin/` or `app/`. A run's commands can still create a folder for another site; its mods are
    held like any out-of-scope mod.
  - **Temporary folders:** a run's own, never the system's (`/tmp` and `$TMPDIR` hold other programs'
    files, and `/tmp/claude-<uid>` every Claude Code session's scratch files and task output, some of which
    those sessions later run). Codex's `:workspace` profile makes both writable: the profile denies them
    (`":tmpdir"`, `":slash_tmp"`) and its commands get `TMPDIR` (and zsh's `TMPPREFIX`) in the mailbox's
    `tmp/` (`shell_environment_policy.set`; macOS's bash 3.2 writes here-documents to `/tmp` whatever
    `TMPDIR` says, so those fail). Claude Code's sandbox always lets its commands write its own temporary
    folder, `<CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>`, which it only uses when that path is at most 44
    bytes (2.1.316): runs get `CLAUDE_CODE_TMPDIR` and `TMPDIR` = `/tmp/trif-<the run id's last 8>` (made fresh,
    removed after; stale ones are swept with old mailboxes), and its sandbox denies reading and writing
    `/tmp/claude-<uid>` and `$TMPDIR` (`systemTemp`).
  - **Tools:** only what the limits above cover. Claude Code: `--tools Read,Edit,Write,Glob,Grep,Bash` (an
    allowlist: 2.1.316 otherwise offers 22 in these runs, among them sub-agents, messages to the user's other
    Claude sessions, push notifications, background commands and claude.ai design sync) and
    `--disable-slash-commands`; Glob and Grep follow the Read rules (no bare `Glob`/`Grep` allow rule: in
    0.2.0 they searched the whole home folder, outside the sandbox). Codex has no allowlist: web search off
    (`web_search="disabled"`: on by default, "cached", network or not) and the features that act outside
    the sandbox off (`codex.js` FEATURES_OFF: apps, plugins, browser and computer use, image generation,
    MCP installs for skills, hooks); its shell, `apply_patch` and `view_image` run in the sandbox and its
    sub-agents inherit the profile (Codex 0.166's source). `tests/agent-tools.test.js` checks the tools a
    run gets from the installed agents, without reaching a model.
  - **Writable folders a run replaced.** The sandbox lets a run delete a folder it may write and put a
    link in its place, so the next run's limits never come from the realpath of such a folder
    (`runs.js` screenshotsFolder, checkModsFolder): a link or file where the run's screenshots folder (or
    `<private>/screenshots`) should be is removed without following it and the folder made again, its
    real path must then be its parent's plus its name (or the run is refused), and links inside it are
    removed; a run is refused when the mods folder is a link or not a folder, or when its real path isn't
    the one `trif setup` recorded (`config.json` `modsDirReal: {path, real}`, for that `modsDir`); the
    mailbox is made fresh, not recursively. Another site's folder that is a link out of the mods folder
    is never made read-only (that would open where it leads, in Codex's profile), only denied to Claude
    Code's Edit tool; and links in the mods folder or the trash that lead out of the mods folder (or
    where the run may not read) get `Edit` (and `Read`) deny rules for Claude Code's file tools, which run
    outside the sandbox and match rules against the path they're given (`workspaceLinks`).
  - **Network:** none, and no unix sockets: not the helper's, not the Safari bridge's.

  Codex runs any command, all inside its permission profile (`codex.js` permissionsToml: `network =
  { enabled = false }`; the user's own Codex config and rules files aren't loaded, since a
  `sandbox_mode` there would replace the profile). Claude Code runs only `trif`, `cd` and `ls`, in its
  sandbox (`claude.js` runSettings, passed with `--settings`: `enabled`, `failIfUnavailable`,
  `allowUnsandboxedCommands: false`, the filesystem lists, `network: {allowedDomains: [],
  strictAllowlist: true}`; `denyRead` the home folder and the private folder, `allowRead` the readable
  folders, the mailbox and the run's screenshots folder); its own file tools follow permission rules:
  reads in the workspace (anything outside it needs approval, which `-p` denies), the run's screenshots
  folder and the skill folders (`Read(//…)` allows); edits only under `sites/` minus other sites' existing
  folders (deny rules by each folder's path in the workspace and by its real path, so a site folder that
  is a link is covered too; a path in another case, `/Users/x/.TRIF/sites/X.com/a.js`, is refused as
  well, checked with Claude Code 2.1.316). No `Read` deny rules for TRIF's files any more: they're
  outside the workspace. Verified on macOS with Codex 0.166 (`codex sandbox`) and Claude Code 2.1.312 /
  2.1.316 (real `-p` runs): each read and write above, another run's mailbox, the internet and the
  helper's socket are refused ("Operation not permitted", or Claude Code's own "blocked"/"haven't
  granted" for its tools); the run's own mods, screenshots and mailbox, and `trif`, work.
  `tests/agent-keys.test.js` (real Claude Code, a stand-in API, no tokens) and `tests/open-models.test.js`
  (real Codex, a stand-in model) check the private folder can't be read, and scan every process's
  argv and environment (KERN_PROCARGS2) during the run for the message and the key.

### Models (`agent.models`)

`agent.models {agent, fresh}` → `{agent, models:[{id, name, description}], default, custom, error, note}`:
what the side panel's model picker offers for that agent (cached per agent binary for a minute;
`fresh` skips the cache). Codex: its own catalog for the signed-in account (`codex debug models`),
the models it lists in its picker, ordered by priority; `default` is the first; `custom: false` (only
those). Claude Code has no command that lists an account's models, so: its aliases `fable`, `opus`,
`sonnet`, `haiku` (each the newest of its family), `custom: true` (the panel's "Other…" takes an exact
name), with a `note` saying so. The panel keeps the chosen model per agent (`models`, `{agentId: model}`;
an older single `settings.model` becomes Claude Code's) and passes it as `agent.start`'s `model`.

**Agent and model per site chat** (`extension/lib.js`). Each site's chat has its own agent and model, so
one panel can run Claude Code with Opus on one site while another runs Codex on another.
`chrome.storage.local` `sitePicks` = `{"<site>": {agent, models}}`, the same shape as `settings`, which is
the default for sites without a pick. Changing the agent or model in Settings (or `/model`) writes this
site's pick and also makes it the default, so a site seen for the first time starts with the last pick
made anywhere. A panel showing a site without a pick keeps the default it first saw for that site (in
memory), so a pick made in another panel doesn't change it; the site's pick is written when a run starts
there. New chat (+) keeps the site's pick. The setting from before 0.2.0 (one global `settings`) is the
default, so every site starts with it. `trif agent run` doesn't read any of this: it takes `--agent` and
`--model`, or uses the helper's default agent.

### Agent adapters (`helper/lib/agents/<id>.js`)

Each adapter: `detect(env) → {available, path, version, note}`, `command({prompt, sessionId, model,
context, workspace}) → {file, args}`, and `parse(line, emit)` turning one stdout line into events.
Login: `loginStatusArgs` + `parseLoginStatus({status, error, stdout, stderr}) → {loggedIn, detail}`
(`loginStatus()` runs it synchronously, for `trif doctor`), `loginFix`, and `login: {args,
parseLine(line) → {kind:"login", url} | {kind:"text", text} | null}` or `null` when the panel can't log it in.
The user's standing instructions (`instructions.md`) reach claude through the workspace's CLAUDE.md
(`@instructions.md`; adapter flag `readsInstructions`); other adapters get them appended to the context.

- **claude** (Claude Code 2.1.285+, tested with 2.1.312; older versions show as unavailable): `claude -p
  --output-format stream-json --verbose --permission-mode default --setting-sources project
  --strict-mcp-config --settings <run settings file> --tools Read,Edit,Write,Glob,Grep,Bash
  --disable-slash-commands --allowedTools Read(./**) "Edit(./sites/**)"
  Bash(trif:*) Bash(webmods:*) Bash(cd:*) Bash(ls:*) --disallowedTools WebFetch WebSearch
  --append-system-prompt-file <context file> [--resume <sessionId>] [--model <model>]`, with the message
  on stdin (the rules are made absolute to the workspace, `//<path>`). In -p anything that would need approval is denied, so edits happen only under
  `sites/`, and Grep and Glob, which follow the Read rules, only search the workspace (no bare `Grep`/`Glob`
  rules: they'd search anywhere, outside the sandbox); the run settings add its sandbox and the per-run denies (see "Run scope"). (2.1.312 ignored
  `Bash(...)` allow rules from the workspace's settings file in -p runs; `trif setup` writes the same
  lists to the workspace's `.claude/settings.json` for interactive sessions there, and the deny rules
  there apply to runs too. Its allow rules do as well, so each Claude run rewrites the file first when
  it isn't what setup writes now: 0.2.0's allowed bare `Glob` and `Grep`, and a checkout's helper is
  never set up again by an update.) Other Bash commands are denied. `--setting-sources project` keeps the user's own broader allow rules out;
  `--strict-mcp-config` keeps their MCP servers out. stream-json lines: `{type:"system", subtype:"init",
  session_id}` → session; `{type:"assistant", message:{content:[{type:"text", text} | {type:"tool_use",
  name, input}]}}` → text / tool (summary: Bash → `input.command`; Edit/Write/Read → `input.file_path`
  relative to the workspace); `{type:"result", is_error, result, total_cost_usd, session_id}` → done.
  A login failure in a failed result (or on stderr, without one) → the `login` error (see `done.error`).
- **codex** (OpenAI Codex CLI 0.138+; tested with 0.166): `codex exec --json --skip-git-repo-check
  --ignore-user-config --ignore-rules -c approval_policy="never" -c default_permissions="trif-run"
  -c permissions={…} -c shell_environment_policy.exclude=[…] -c shell_environment_policy.set={ TMPDIR, TMPPREFIX }
  -c web_search="disabled" -c features.<each of FEATURES_OFF>=false [-m MODEL] [resume THREAD_ID] -`, the message
  on stdin, the exec options before `resume`. JSONL
  events: thread.started (the session id), item.* (agent_message, command_execution, file_change…),
  turn.completed / turn.failed. Older versions show as unavailable, with an update hint. No side panel
  login (`codex login` in a terminal). Codex's Homebrew build ships a ripgrep (`rg`) that isn't
  notarized, so macOS may show an "rg Not Opened" dialog during runs: harmless (click Done), or clear it
  with `xattr -d com.apple.quarantine <codex dir>/codex-path/rg`.

- **codex-oss**, "Open model (via Codex)", experimental: the codex adapter (same binary, flags,
  permission profile and event parsing) with the model from somewhere else. See "Open models" below.
  Never the default agent (`agent.list` marks it `experimental: true`).

### Open models (`codex-oss`, experimental)

`helper/lib/agents/codex-oss.js`. Codex 0.166 talks to any server speaking OpenAI's **Responses API**
(`wire_api = "responses"`; the chat-completions wire API is gone from Codex). Ollama, LM Studio and
OpenRouter serve `/v1/responses`. Every source is one custom provider passed inline (runs use
`--ignore-user-config`):

```
codex exec <the codex flags and permission profile>
  -c model_providers.trif-open={ name = "OpenRouter (TRIF)", base_url = "http://127.0.0.1:<port>/<32 hex>/v1",
       wire_api = "responses", supports_websockets = false }
  -c model_provider="trif-open"
  -c shell_environment_policy.exclude=["*_API_KEY", "*_API_TOKEN", "*_ACCESS_TOKEN", "*_AUTH_TOKEN", "*_SECRET_KEY"]
  -m openai/gpt-oss-120b [resume THREAD_ID] -      (the message on stdin)
```

No `env_key`: with a key, `base_url` is the run's key proxy (see "The key"); without one, the provider's
own address. `shell_environment_policy.exclude`: Codex builds its commands' environment from a
snapshot of the user's login shell that it takes itself, outside the sandbox, so a key still exported
in `~/.zshrc` would otherwise reach them (seen with Codex 0.166 and a stand-in profile). TRIF's own key is
never there (it's in the keyring); these case-insensitive globs keep out the usual API key variables a
profile may still export (not `*TOKEN*`: `TRIF_RUN_TOKEN` must get through). Ollama and LM Studio servers add `stream_idle_timeout_ms = 900000` (a model can take minutes
to load), `request_max_retries = 1`, `stream_max_retries = 1`. Not `--oss --local-provider`: in Codex
0.166 `exec --oss` fails ("This chat uses ollama, but your current provider is openai") unless
`model_provider` is set as well, and it **pulls** a model that isn't installed (`POST /api/pull`, many GB,
mid-chat). (No `web_search` here: `codex.js` turns OpenAI's hosted tool off for every run, and other
providers don't have it.) Codex knows only OpenAI's models, so for an open model it neither compacts a long
chat nor limits the answer, and a long chat failed with "maximum context length": runs add
`-c model_context_window=<window>` and `-c model_auto_compact_token_limit=<40% of it, at least 8192>`, the
window from OpenRouter's public model list (`/api/v1/models` `context_length`, looked up once per helper),
else 65536.

- **Providers** (`PROVIDERS`): `ollama` (`http://127.0.0.1:11434/v1`, default model `gpt-oss:20b`),
  `lmstudio` (`http://127.0.0.1:1234/v1`, `openai/gpt-oss-20b`), `openrouter`
  (`https://openrouter.ai/api/v1`, a key required, `openai/gpt-oss-120b`), `custom` (a base URL, an
  optional key, no default model).
- **Settings.** config.json `openModel` = `{provider, model?, baseUrl?}`: the defaults, shared by the
  panel (`agent.openModel.set`) and `trif agent open-model`. config.json is unreadable to runs, and
  `agent.*` is refused from runs. Never a key (an old `keyEnv` is ignored, and dropped on the next save);
  `baseUrl` is http(s) without credentials. What a run uses (`resolve`): the defaults, then agent.start's
  `openModel` (same shape; another provider starts from that provider's defaults), then agent.start's
  `model`, then the provider's defaults. In the panel, the provider, its server address and key
  are global (config.json, the block `extension/openmodel.js` shows under the agent picker when
  codex-oss is chosen); only the model is per site chat, kept like any agent's
  (`sitePicks[site].models["codex-oss"]`, and `settings.models["codex-oss"]` as the default) and sent as
  agent.start's `model`. The panel sends no `openModel` (agent.start's and `agent.models`' `openModel`
  are for helper clients; background.js passes agent.start's on and drops `agent.models`'). Model picks
  name a provider's models, so when the provider changes they're all dropped and every chat falls back
  to the new provider's default: on a change in the panel, and when the panel next loads the settings
  after a change elsewhere (`trif agent open-model`; storage `ossProvider` is the provider they were made
  for).
- **Local, and keys over http.** `local` (Ollama, LM Studio) only counts at a loopback address
  (`localhost`, `127.*`, `[::1]`): an Ollama pointed at another computer still lists its models, but the
  panel doesn't say "nothing leaves it". A key is never sent over `http://` to another computer:
  `agent.openModel.setKey` refuses to save one for such a server, and a run with a saved key fails
  instead (https required).
- **The key: the system keyring, nowhere else.** One generic-password item per hosted provider in the
  login Keychain (`helper/lib/keyring.js`): service `TRIF open model key`, account `openrouter`, or
  `custom:<host[:port]>` for a custom server (its own key per server; local servers take none). Set from
  the panel (`agent.openModel.setKey`: a password field, sent once, emptied after; the panel only gets
  `hasKey`) or `trif agent open-model --set-key` (the key from stdin, or a no-echo prompt on a terminal;
  never from argv: an extra argument is refused, unechoed). Written with `/usr/bin/security -i` and
  `add-generic-password -U -s … -a … -l … -X <key as hex>` on its **stdin**, so the key is in no
  process's argv (any same-user process can list those) and needs no quoting; keys must match
  `[A-Za-z0-9._~+/=:@%-]{8,4096}` (no quotes or backslashes, so redaction finds them in JSON too). Read
  with `security find-generic-password -s … -a … -w` (stdout, to the helper), checked without `-w` (no
  decryption), removed with `delete-generic-password`. An item `/usr/bin/security` creates lists it as
  allowed to read it, so reads don't ask (verified: no dialog on the first read, ~20 ms). On Linux,
  libsecret's `secret-tool` (`store` reads the key from stdin; `lookup`, `clear`); without it hosted open
  models can't be used: no file or environment fallback. `TRIF_KEYCHAIN_BIN` replaces the tool (tests:
  a stand-in `security`, or `secret-tool` when its name says so). **Never an environment variable**: a
  key exported in `~/.zshrc` is in the initial environment of every program started from a terminal,
  and any same-user process can read those (`sysctl` KERN_PROCARGS2, sandbox or not; seen in a real
  run: a Claude Code session started from a terminal and three of its node children held it). `trif
  doctor` warns when a likely API key variable (`*_API_KEY`, `HF_TOKEN`…) is set in its environment,
  checking presence only. Before each run (`prepare`, awaited by runs.js before spawning) the helper
  reads the key afresh (no cache: a key just replaced or removed counts at once) into its memory.
  **The key never reaches Codex.** Anything in Codex's environment or argv is the agent's (KERN_PROCARGS2
  again). Instead, `prepare` starts a proxy for the run (`helper/lib/keyproxy.js`): an HTTP server on
  127.0.0.1, a random port, a random 128-bit path prefix, given to Codex as `base_url`; it adds
  `Authorization: Bearer <key>` and forwards to the provider, streaming answers (server-sent events)
  through as they come, with their status and headers (no CORS headers). It refuses anything outside the
  prefix, paths other than `/responses…` and `/models…`, methods other than GET and POST, a Host other
  than its own, and any request carrying `Origin`, `Sec-Fetch-Site` or `Sec-Fetch-Dest` (what browsers
  add to a page's fetches, form posts and image loads), so a web page can't spend the user's credit
  through it. It closes when the run ends. The key lives only in the Keychain and the helper's memory:
  never in an argv, a child's environment, a file or a log (runs.js still redacts it, `[redacted]`, from
  the run log, events and stderr tail). The commands can't use the proxy (no network in their sandbox,
  127.0.0.1 included) and can't read the Keychain: it's in the home folder, which the profile denies
  (verified with a real throwaway item and `codex sandbox` under TRIF's profile: `security
  find-generic-password` can't search it). Left open: an unsandboxed program running as the user can
  read the item with `/usr/bin/security` without a prompt (the item trusts that tool); the Keychain
  protects the key from sandboxed agent commands and from environment snooping, not from other software
  of the user's. (On Linux the bubblewrap sandbox would need checking for `/proc/<pid>/environ` and the
  Secret Service's D-Bus socket.)
  Planned hardening, once TRIF has an Apple Developer ID (stable code signing): a small signed key
  program (Swift) owns the item, stored so that only that program can read it (a Keychain ACL for its
  signature, or better, a data-protection keychain access group for the TRIF team, which other software
  can't read at all), and it makes the provider requests itself, so the key never leaves it, not even to
  the helper; other software could at most ask it to make requests. Without stable signing every rebuild
  is a new program and would prompt for Keychain access after each update, so this waits for the
  developer account. Requiring Touch ID for each read was considered and rejected (a prompt per run).
  Weighed against the rest: software already running as the user can usually do worse (keystrokes,
  browser cookies, the workspace), so this is defence in depth, not the main line.
- **Plain Codex and Claude Code** use the same keyring and the same kind of proxy for an API key: see
  "API keys for Claude Code and Codex" below.
- **Network.** The permission profile's `network = { enabled = false }` covers the commands Codex runs,
  not Codex's own model requests. Verified with Codex 0.166 (real `codex exec`, TRIF's profile, a
  stand-in Responses server on 127.0.0.1; `tests/open-models.test.js` last test, and a real OpenRouter
  run): the model requests arrive with the key (added by the proxy); the agent's `curl https://example.com` fails to resolve,
  its `curl` to the stand-in server's own port is refused, `cat config.json` and `~/.zshrc` are
  "Operation not permitted", writes to another site's folder are refused, its own site's folder and
  `trif` (through the mailbox) work, an API key variable a stand-in shell profile still exports is
  empty for them (the exclude globs), and a scan of every same-user
  process's arguments and environment (python3 ctypes, KERN_PROCARGS2) doesn't find the key.
- **Before a run** (`prepare`): OpenRouter with no key saved → "no OpenRouter API key yet" and the fix
  (the panel, or `--set-key`); a saved key for a custom server at `http://` on another computer → refused; an Ollama or LM
  Studio server with no model picked → the provider's default if installed, else the first installed
  recommended model, else the first installed (what `agent.models` reports as `default`); a local server
  that doesn't answer (`/api/tags` for Ollama, `/v1/models` otherwise, 3 s) → "Ollama isn't running";
  an Ollama model that isn't installed → "run `ollama pull <model>`". Codex isn't started in those cases.
- **Models** (`agent.models`, cached 5 s, keyed by provider): local → the server's installed models,
  recommended ones first (`gpt-oss:20b`, `gpt-oss:120b`, `qwen3-coder:30b`, `qwen3.6:27b`, `devstral`,
  `gemma4`, matched loosely so LM Studio's names count); OpenRouter → a short fixed list
  (`openai/gpt-oss-120b`, `qwen/qwen3-coder`, `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3`,
  `moonshotai/kimi-k2.7-code`), no network; custom → none. Always `custom: true` ("Other…"). `default` is
  the model a run with none picked would use (for a local server, as in `prepare` below).
- **Errors** are reworded for the provider (codex.js `parse` takes `state.friendly`): 401 → the key in
  `<VAR>` was refused; 402 → out of credit; Ollama's "not found, try pulling it" → `ollama pull`;
  connection refused → not running. Codex's "Model metadata for `<model>` not found" warning (every
  non-OpenAI model) is dropped.
- **Doctor**: with `openModel` set, a hosted provider's key saved in the keyring or missing (never the
  value: macOS checks without decrypting it), the local server reachable, the Ollama model installed,
  Codex new enough; without it, an info line. Always: a warning naming any likely API key variable set
  in its own environment (presence only), with the fix (remove the export from the shell profile).

### API keys for Claude Code and Codex

Most people log the agent in (`claude` then `/login`, `codex login`), which keeps its credentials in
its own files, which run sandboxes deny. For those who use an API key instead (`helper/lib/agentkeys.js`):

- **Kept in the keyring**, like open-model keys (`keyring.js`): service `TRIF API key`, account
  `anthropic` (Claude Code) or `openai` (Codex). `trif agent key [--agent claude|codex] [--set-key |
  --remove-key]` (stdin or a no-echo prompt, never argv; not from a run). No panel setting.
- **Never in the agent's environment or argv.** Until 0.2.0, config.json `env.ANTHROPIC_API_KEY` /
  `env.OPENAI_API_KEY` went into the agent's environment, readable by its commands (KERN_PROCARGS2).
  Now, before each run (the adapter's `prepare`), the helper reads the key and starts a key proxy for the
  run (`keyproxy.js`):
  - Claude Code: `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/<32 hex>` (style `anthropic`: the proxy
    adds `x-api-key`; paths `/v1/messages…`, `/v1/models…`) and `ANTHROPIC_API_KEY=<a placeholder>`, so
    Claude Code makes API requests, which the proxy fixes. As with a key before, an API key takes
    precedence over a claude.ai login (Claude Code says its claude.ai connectors are off).
  - Codex: a custom provider (`-c model_providers.trif-openai={ name = "OpenAI (TRIF)", base_url =
    "http://127.0.0.1:<port>/<32 hex>/v1", wire_api = "responses", supports_websockets = false }
    -c model_provider="trif-openai"`; bearer). (`OPENAI_BASE_URL` alone wouldn't do: Codex would still
    want the key.)
  The proxy, its refusals (browsers, other hosts, other paths) and its lifetime are as for open models;
  the key is redacted from run logs, events and stderr. `agent.list` and doctor count a saved key as
  logged in. Verified with a real Claude Code 2.1.316 against a stand-in API (`tests/agent-keys.test.js`).
- **Moving keys out of config.json** (`migrateKeys`, by setup and every helper when it starts): each
  key found there is saved in the keyring (unless one is already there: that one, set later, wins) and
  removed from config.json. Without any keyring (Linux without `secret-tool`) a key stays in config.json
  and is still sent through the proxy: config.json is in the private folder, unreadable to runs. Doctor:
  where each key is (never the key), and key-like entries in config.json `env` that nothing uses.
- **Limits.** The proxy's address (with its random path) is in Claude Code's environment and Codex's
  argv, so for the run's duration another same-user program could use it, but not the run's own
  commands (no network in their sandbox). Codex's `codex debug models` (the panel's model list) runs
  without the key (nothing gives it one), so with only an API key it may not list the account's models.

Security notes: page content reaches the agent, so prompt injection is possible. The agent is limited
to editing the workspace and running `trif` (which can still run JavaScript in the user's tabs);
AGENTS.md's safety rules forbid acting on page instructions and account-changing clicks.
