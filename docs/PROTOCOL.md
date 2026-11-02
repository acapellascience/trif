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
     Strangers run it as `npx trif setup` (npm package `trif`, see "Native host installation").
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
     config.json         { "modsDir": "...optional override..." }
   ```
   `<site>` is a hostname like `x.com` or `news.ycombinator.com`. `<mod>` is a kebab-case name.
   Files whose name starts with `_` or `.` are ignored (scratch files, helpers).
4. **Examples** (`examples/sites/<site>/<mod>.js`): ready-made mods (Plain X first). Setup copies them
   into a new workspace (see "Native host installation") and later setups keep them up to date (see
   "Updates to shipped mods"); `trif install-example <site>/<mod>` copies one in by hand.

## Extension identity

`extension/manifest.json` carries a fixed `"key"` so the unpacked extension always has the ID
**`iaablflfafmonebdomeikadolkgdbkhe`**. The native host manifest's `allowed_origins` lists every TRIF
extension ID: this dev ID, the Chrome Web Store ID (unknown until the first upload; add it to
`STORE_EXTENSION_IDS` in `helper/lib/paths.js`), and any extra IDs in the workspace's `config.json`
`"extensionIds": [...]`. (The private key lives in `.keys/`, gitignored; it's only needed to pack a .crx.)

```
"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvrM00irPxw843QWA7797u9U1QLvK2M9cHdfoblqrEGec2aA++jHrJMdStaXa19U5R+K+aI8atnfwq4FLGDNid11AcgBavxUgtOGU7cXIXDX8MVdbfBVdMl4oMcfOVH1QJW6z0X5CzavJ5+F4HQj2dOQ8gMEBqjrB0k8rGD7G+93Tj7ewODVcYclNqZJUEfnGbz+TIbHh98F6KkwIvbJF3ng3Uh/6Qq7lXgPa6sGvRTIHGTJ0tD7xeJ7sWteE/3f8jzs6pKyYJyBqxoPYciim2LtzgxF+BHFe7c8CBFRflRTG0ofwblJwcRNhqMFYIwsxZes7QVd1c/ul/xdk2uOu9wIDAQAB"
```

## Mod files

A mod is a JavaScript file run as-is in the page's MAIN world (it shares `window` with the site, so it can
patch `fetch`/`XMLHttpRequest`, read React state, etc.). An optional header sets metadata:

```js
// ==WebMod==
// @name        Plain X
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
- Unknown keys are ignored. A file without a header is valid.

**Mod id** = `<site>/<mod>` (e.g. `x.com/plain-x`). The helper parses headers; the extension never parses.

**Links.** A mod file or site folder may be a symlink only to somewhere inside the mods folder (real
paths compared, `mods.js` listModFiles/readModFile). One whose real path is outside it is ignored with a
warning (`helper.log`, `trif mods`, `trif doctor`): a side-panel run can write its site's folder, so it
could otherwise plant `sites/x.com/a.js -> ~/.ssh/id_rsa` and have the helper, which runs unsandboxed,
read the target and send it to the extension. The file read is the one whose real path was checked (same
device and inode after opening), so swapping a link in between doesn't work either.

## Messages: helper ⇄ extension (native messaging)

Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON. Host→extension messages must
stay under 1 MB (the helper rejects bigger mods with an error logged to stderr, and the CLI reports it).
Extension→host frames may be up to 256 MB; a bigger length means the stream is out of step, so the host
logs it and exits (the extension reconnects to a fresh one) instead of misreading every later frame.

**helper → extension**

| message | meaning |
|---|---|
| `{type:"mods", mods:[Mod…], sitesOn:[site…]}` | The full set of mods, and the sites setup said to start on (`preinstalled.json`; each browser turns each on once, see "Sites TRIF is on for"). Sent on connect and after every change in the mods folder (debounced 150 ms). The extension makes `chrome.userScripts` match it exactly (register new, update changed, unregister missing). |
| `{type:"request", id, cmd, args}` | A page command from the CLI (table below). The extension answers with a `response`. |
| `{type:"update", update:Summary}` | What the helper knows about updates (see "Updates"), after the extension's hello, after each check and while installing. The panel shows it. |
| `{type:"updated", from, to, notes}` | An update was installed. The extension keeps it in storage (`updated`) so the panel can say so after the reload. |
| `{type:"reload", reason}` | The extension should `chrome.runtime.reload()`: <home>/app now holds a newer version (installed by this helper, another browser's, or `trif setup`). Chrome reloads the unpacked extension from the new files; either browser starts the new helper on reconnect. |

`Mod = { id, site, file, name, description, matches:[…], excludes:[…], runAt:"document_start"|"document_end"|"document_idle", risk:{tier, why}|null, source, version, code, hash, held?, startOff?, origin?:{by, browser}, update?:{version, from, modified} }`
(`file` is the absolute path; `hash` is a sha1 of code+metadata so the extension can skip unchanged mods;
`update`: a newer version of this shipped mod is waiting, see "Updates to shipped mods".)

**extension → helper**

| message | meaning |
|---|---|
| `{type:"hello", version, userScripts: bool, chrome: "<version>"}` | Sent on connect. `userScripts` is false when the "Allow User Scripts" switch is off. |
| `{type:"response", id, ok:true, result}` / `{type:"response", id, ok:false, error:"message"}` | Answer to a request. |
| `{type:"modsApplied", registered:[ids], errors:[{id, error}]}` | After applying a `mods` message. |
| `{type:"log", level, message}` | Extension-side diagnostics; the helper writes them to `~/.trif/helper.log`. |

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
  and that bring its key as `?token=`: the contents of `<home>/safari-token` (64 hex characters, mode 600,
  made by `trif setup --browser safari`). A Safari extension's origin is random and changes, so the key
  is what tells TRIF from other extensions: the extension gets it with
  `runtime.sendNativeMessage(…, {type:"token"})` from its own Mac app (`safari/SafariWebExtensionHandler.swift`,
  whose sandbox may read just `~/.trif/safari-token`), which no other extension can message.
  Safari unloads the background page after about 30 s with nothing to do, closing the socket, so the host
  outlives the connection: its messages are queued (up to 2000) and delivered when the background
  reconnects, which it does with a fresh `hello`. A host with no connection for 30 minutes and no agent
  run in `<home>/active-runs` is stopped. `trif setup --browser safari` installs the bridge as a
  launchd agent (`~/Library/LaunchAgents/com.timsrobot.trif.safari-bridge.plist`, KeepAlive); `trif doctor`
  checks that it's listening. Setup restarts a loaded agent with `launchctl kickstart -k` (bootout and
  bootstrap only when the plist is new or changed). Stopping the bridge stops its hosts and their
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
| `status` | – | `{userScripts, chrome, version, mods:[{id, registered, enabled}], recording:[sites]}` (`enabled: false` = switched off, see below) |
| `tabs` | – | `[{id, windowId, active, url, title}]` (normal windows only) |
| `run` | `code`, `expression: bool`, `timeout` (ms, default 10000) + tab selector | `{value}`: the code's result, made JSON-safe in the page (see below), or an error `{ok:false, error:"<message + stack>"}` |
| `reload` | `hard: bool` + tab selector | `{url}` after the tab's `status` is `complete` (timeout 30 s) |
| `navigate` | `to` (URL) + tab selector | `{url}` after load completes |
| `open` | `to` (URL) | `{id, url}`: opens a new background tab (never takes focus), waits for load |
| `text` | tab selector | `{url, title, text}`: `document.body.innerText`, capped at 200 000 chars |
| `screenshot` | tab selector | `{dataUrl}` PNG of the visible area. Only for a tab that's showing in its (non-minimized) window; otherwise an error: the extension never switches tabs or focuses windows, since agents may run while the user browses. The CLI writes it to a file. |
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
(() => { const __mod = "x.com/plain-x"; window.__webmods && (window.__webmods.current = __mod);
try { /* mod code */ } catch (e) { window.__webmods?.errors.push({mod: __mod, message: String(e?.message ?? e), stack: String(e?.stack ?? ""), time: Date.now()}); console.error("[TRIF]", __mod, e); }
})();
//# sourceURL=trif://x.com/plain-x.js
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
trif status                     connection, user-scripts switch, mods and whether each is registered (or off)
trif doctor                     diagnose setup problems, printing a fix for each
trif tabs
trif run [TAB] '<code>'         run JS in the page (REPL-style); `-f file.js` to run a file; `-` reads stdin
trif reload [TAB] [--hard]
trif open <url>
trif navigate [TAB] <url>
trif text [TAB]
trif screenshot [TAB] [-o file.png]     default: ~/.trif/screenshots/<time>.png; prints the path
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

First install, for anyone with Node ≥ 18: **`npx trif setup`**. The npm package `trif` (root
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
- Preinstalled mods: setup copies the examples listed in `PREINSTALLED` (helper/lib/preinstalled.js:
  Google, X, Amazon and Instagram mods, each marked on or off) into `sites/`, and offers `SITES_ON`
  (google.com, x.com, amazon.com, instagram.com). `~/.trif/preinstalled.json` =
  `{offered, startOff, sitesOn}`: `offered` keeps a later setup from bringing back one the user deleted
  (an existing file is never overwritten); `startOff` lists the copied ones that start off. The helper
  sends those mods with `startOff: true`; the extension switches each off (`disabled`) the first time it
  sees it and remembers that in chrome.storage.local `startedOff`, so afterwards the switch is the user's.
  Later setups update the copies (see "Updates to shipped mods"); `preinstalled.json` also holds `shipped`.
  `sitesOn` goes with every mods message; the extension turns each site on the first time it sees it
  and remembers that in `sitesOffered` (`applyStartSites`). `--no-examples` skips all this.
- Wrapper: `~/.trif/bin/trif-host` (and the same as `bin/webmods-host`, its name before 0.2.0, which
  manifests written then may name; likewise `bin/webmods` beside `bin/trif`) = `#!/bin/sh\nexec "<absolute node path>" "<app>/helper/host.js" "$@"`
  where `<app>` is `~/.trif/app` (copy) or the checkout (link)
  (Chrome launches hosts with a minimal PATH, so the node path is absolute).
- Manifest `com.webmods.helper.json` → `{ name, description, path: <wrapper>, type: "stdio", allowed_origins: [...] }`
  where `allowed_origins` is `chrome-extension://<id>/` for every TRIF extension ID (see "Extension
  identity"), written to each selected browser's `NativeMessagingHosts` dir (macOS:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `…/Chromium/…`,
  `…/BraveSoftware/Brave-Browser/…`, `…/Microsoft Edge/…`; Linux: `~/.config/google-chrome/NativeMessagingHosts` etc.).
  Default: every one of those browsers whose parent folder exists. `trif doctor` fails a manifest
  that is missing any of the IDs.
- CLI link: `~/.trif/bin/trif` (shell wrapper like the host's), and it prints a line to add
  `~/.trif/bin` to PATH if it isn't there. If `/usr/local/bin` is writable, it also symlinks
  `/usr/local/bin/trif`.
- PATH for agents: setup records the terminal's PATH in `config.json` `env.PATH`, minus the folders npx
  adds for its own run.
- Extension: until the Chrome Web Store listing exists, users (beta testers) load it unpacked from
  `<app>/extension` (setup's "Next steps" print the folder). The listing will replace that step.
- Version: the root `package.json` is the single source; `helper/lib/paths.js` reads it and
  `extension/manifest.json`'s version must match (a test checks).

## Renamed from WebMods (0.2.0)

TRIF was WebMods until 0.2.0. What changed name: everything a person sees (the extension's name TRIF, its
description, the panel, setup and doctor output, docs), the command (`trif`; `webmods` is kept as an alias:
both wrappers are written, the npm package has both bins, and Claude runs may use either), the workspace
(`~/.trif`), the npm package (`trif`), environment variables (`TRIF_*`; `WEBMODS_*` still read, see
`helper/lib/env.js`), the website (timsrobot.com; the Worker redirects webmods.dev there), release asset
names (`trif-<version>.tgz` …), the in-page API (`window.trif`, with `window.webmods` the same object), the
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

`helper/lib/preinstalled.js`. The preinstalled mods get fixes in later TRIF versions (Plain X when X
changes). Every setup, which is also how an update installs, brings them to the user's copy without ever
overwriting the user's own changes. Only examples whose header says `@source webmods` and that are in
`PREINSTALLED` are managed.

- **What was shipped.** `preinstalled.json` `shipped` = `{"<id>": {hash, version, pending?, declined?,
  replaced?, own?}}`: `hash`/`version` are the sha1 and `@version` of the shipped version the user's copy
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

## Repository layout

```
extension/   manifest.json, background.js (service worker), runtime.js (page runtime source),
             onboarding.html/.js, icons/, safari.js + safari-background.js (Safari build only)
package.json the npm package `trif` (version, bin, files allowlist)
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
  Clicking the toolbar icon opens the side panel (`chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})`).
  The onboarding/status page stays, opened from the panel's "Setup" link, and automatically on first install.
- `sidepanel.html/.js/.css`: follows the active tab of its window.
  - **Header:** the current site (hostname without `www.`), a status dot (helper connected, user scripts
    on, agent available), a settings button.
  - **Mods on this site:** the mods whose matches cover the current tab (name, file name, on/off switch;
    see "Mod switches"), collapsed by default when there's a chat.
  - **Chat:** one conversation per site, persisted in `chrome.storage.local` under `chat:<site>` =
    `{sessionId, agent, messages: [{role: "user"|"assistant"|"tool"|"error", text, time}]}`, at most 500
    messages, each message's text cut at 20 000 characters and the chat at about 1 MB (oldest messages
    dropped first; `capChat` in lib.js). The manifest asks for `unlimitedStorage`, so Chrome's 10 MB quota
    doesn't apply. A text box
    (Enter sends, Shift+Enter newline), Send / Stop, "New chat" (forgets the sessionId and messages).
    Assistant text renders as simple markdown (paragraphs, lists, `code`, code blocks, bold, links that
    open in a new tab), escaped first: never inject agent or page text as raw HTML. Tool events render
    as one compact line each ("ran trif reload --tab 12", "edited sites/x.com/hide-reposts.js").
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
  - **States:** helper not connected → short setup instructions (`npx trif setup`, link to Setup page);
    user scripts off → button opening chrome://extensions/?id=…; agent missing → the error text from the
    helper (it includes the fix); agent not logged in (`loggedIn === false` in `agent.list`, or a run
    failed with the not-logged-in error) → "Claude Code isn't logged in" with a **Log in** button (see
    "Logging in" below; agents with `canLogin: false` show `loginFix` instead).
  - **Settings:** agent (from `agent.list`; only available ones selectable), optional model name (free
    text with suggestions opus / sonnet / haiku, empty = agent default), for this site's chat: each site
    chat has its own (see "Agent and model per site chat" below).
  - Light/dark via `prefers-color-scheme`; compact, clean, system font; fits a narrow panel (320 px+).
- Panel ⇄ background: `chrome.runtime.connect({name: "panel"})`. Panel → background:
  `{type: "agent.start", site, tabId, url, prompt, sessionId, agent, model, openModel?}`, `{type: "agent.stop", runId}`,
  `{type: "agent.openModel", check}`, `{type: "agent.openModel.set", provider, model, baseUrl, keyEnv}`,
  `{type: "agent.list"}`, `{type: "agent.login", agent}`, `{type: "agent.loginCode", loginId, code}`,
  `{type: "agent.loginCancel", loginId}`, `{type: "status"}`, `{type: "mod.enable", id, enabled, tab}`,
  `{type: "mod.approve", id, tab}`, `{type: "mod.update", id, choice, site, tab}`, `{type: "mod.delete", id, site, tab}`, `{type: "mod.restore", id, site, tab}` (the tab is reloaded if the mod runs there; with `site`, the chat gets a `{role: "mod", text: "x.js was deleted.", undo: id}` line, marked `undone: true` once restored, and a "was restored (off, as before)" line), `{type: "instructions.get"}`, `{type: "instructions.set", text}`, `{type: "chat.clear", site}`, `{type: "chat.note", site, text}`. Background forwards agent commands to the
  helper as native `request`s with the same cmd and relays every native `{type: "agentEvent", runId,
  event}` to all panel ports (panels ignore runs and logins they didn't start, by id).
  If the helper disconnects mid-run (or mid-login), the background sends the panel `{kind: "error"}` then
  `{kind: "done", ok: false}` (plus `login: true` for a login).

### Helper

New native request commands (answered with a normal `response`):

| cmd | args | result |
|---|---|---|
| `agent.list` | – | `{agents: [{id, name, path, available, version, note, loggedIn, canLogin, loginFix}], default}` |
| `agent.start` | `agent, model?, site, url, tabId, prompt, sessionId?, merge?, openModel?` | `{runId}` right away; progress arrives as `agentEvent` messages. `merge`: a shipped mod's id, to merge its new version (see "Updates to shipped mods"). `openModel`: codex-oss only, this run's `{provider, model, baseUrl, keyEnv}` over the stored defaults (see "Open models") |
| `agent.stop` | `runId` | `{stopped: true}` (SIGTERM, SIGKILL after 3 s) |
| `agent.login` | `agent?` | `{loginId}` right away; progress arrives as `agentEvent` messages with `runId` = the loginId |
| `agent.loginCode` | `loginId, code` | `{sent: true}` (writes the code and a newline to the login's stdin) |
| `agent.loginCancel` | `loginId` | `{cancelled: true}` |
| `mod.approve` | `id` | `{id, approved: true}`: releases a held mod (see "Run scope"); also on the socket, not from a run |
| `mod.delete` | `id` | `{id, deleted: true}`: moves `sites/<site>/<mod>.js` to `trash/<site>/<mod>@<UTC stamp>.js` (entries older than 30 days are removed), then re-sends the mods; also on the socket, and from a run for mods inside its scope |
| `mod.restore` | `id` | `{id, restored: true, file}`: moves the newest trashed copy back (fails if the mod exists again, except to undo `mod.update` `new`); same rules as `mod.delete`. The extension keeps a deleted mod's switch state, so it comes back as it was |
| `mod.update` | `id, choice: "new"\|"mine"` | a shipped mod's new version: use it or keep the user's copy (see "Updates to shipped mods"); also on the socket, not from a run |
| `instructions.get` | | `{text, file, max}`: the user's standing instructions (`~/.trif/instructions.md`, `''` if none) |
| `instructions.set` | `text` | same; trimmed, at most 4000 characters, empty removes the file. Not from a run |
| `agent.openModel` | `check?` | `{openModel, configured, effective, providers, key?}`: the open model's stored defaults (see "Open models"); with `check`, `key: {name, found, source, error}` (never the value). Not from a run |
| `agent.openModel.set` | `provider?, model?, baseUrl?, keyEnv?` | stores them in config.json `openModel` (merged; `''` clears a field; a new provider drops the old one's model, URL and key name); same result. Not from a run |

`loggedIn` is `true` / `false`, or `null` when unknown or the agent isn't available (from the adapter's
`loginStatus`, which spends no tokens; cached 30 s per agent, forgotten when a login finishes or a run
reports "isn't logged in"). `canLogin`: whether `agent.login` works for it; `loginFix`: the terminal
instructions otherwise.

New helper → extension message: `{type: "agentEvent", runId, event}` where `event` is one of
(normalized across agents):

```
{kind: "session", sessionId}                       the agent's conversation id (for resuming)
{kind: "text", text}                               a block of assistant text
{kind: "tool", name, summary}                      a tool call, e.g. {name:"Bash", summary:"trif reload --tab 12"}
{kind: "error", message}                           something went wrong (agent missing, not logged in, crashed…)
{kind: "done", ok, result, costUsd, changedFiles, sessionId}   always the last event of a run
{kind: "login", url}                               (logins) the sign-in page to open
{kind: "done", ok, login: true, cancelled?}        (logins) always the last event of a login
```

- `changedFiles`: paths relative to the workspace under `sites/` whose content changed during the run
  (snapshot hashes before and after).
- One run at a time per site; a second `agent.start` for a busy site fails with "already working on <site>".
  Runs are killed after 15 minutes. Raw agent output is kept in `~/.trif/runs/<runId>.jsonl`
  (last 50 runs).
- **Finding agents.** Chrome starts the helper with a minimal PATH, so `trif setup` records the PATH
  of the terminal it ran in as `config.json` → `env.PATH`. The helper looks agents up in that PATH plus
  `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.npm-global/bin`. Spawned agents get
  `PATH = ~/.trif/bin : <recorded PATH> : <defaults>`, `HOME`, `USER`, `LANG`, `TERM=dumb`, cwd =
  the workspace, and **no** inherited `CLAUDE*`/`ANTHROPIC_*`/`CODEX_*` variables except
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` if the user set them in `config.json` → `env`. An open-model run
  (codex-oss) also gets its provider's key variable, read at run time (see "Open models").
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
  with an error, refuses `agent.*`, `mod.approve`, `mod.update` and `instructions.*` from a run, and sets `args.scope` on everything
  else it forwards (overriding any `scope` the client sent; `args` must be a plain object). Requests on
  the socket without a token (the user's terminal, the user's own agent outside the panel) are not
  scoped: runs can't reach the socket. The helper answers `mod.delete` and `mod.restore` from a run
  itself, only for mods whose every `@match` is in scope. The CLI itself refuses `setup`, `agent`,
  `approve` and `mod-update` when the variable is set, and inside a run its own file options stay in the run's folders:
  `-f` and `check` read only the mods folder, `-o` writes only there or the run's screenshots folder
  (`$TRIF_RUN_SCREENSHOTS`, `screenshots/<scope>/`, also where screenshots go by default).
- **Extension.** With `args.scope`, page commands only act on tabs whose URL is http(s) on the scope or
  a subdomain (`tabs` lists only those; others fail with an error naming the scope); `open`/`navigate`
  only go to such URLs; `record` only for such sites; `mod.enable` only for mods whose every `@match` is
  in scope.
- **Held mods.** The helper snapshots the mod files when a run starts (the same files the scanner loads:
  `mods.js` listModFiles: links within the mods folder followed, links out of it ignored, no cap). On every mods sync while a run is live (and for 10 s
  after it ends; a finished run's leftover processes get SIGTERM, then SIGKILL after 3 s, so nothing
  writes later), a mod that the run added or changed and that has an `@match`
  outside the scope (`<all_urls>`, a `*` host, another domain, `file://`), or whose `@risk` is 2, is **held**: recorded in
  `~/.trif/held.json` (`{id: {hash, site, scope, runId, reason, at, approved?}}`) and sent to the
  extension with `held: {site, reason}`, which the extension doesn't register. The run's `done` event
  carries `held: [{id, reason}]`; the panel says so in the chat and lists the mod (also when it doesn't
  apply to the tab) with an Allow button (`mod.approve`). Approving marks the entry approved so that
  version isn't held again; any change to the file drops the entry (a later run's change is checked
  afresh). `trif status`/`mods` show held mods. A change in another site's existing folder, which the
  run's limits make read-only, isn't held on the run's account (someone else made it), but only for the
  folders the agent's adapter says it protected (`command()` returns `locked`; none if it doesn't say).
- **Agent sandboxes.** The scope only holds if the agent can't reach the helper some other way or
  rewrite the rules, so both agents run under limits the operating system enforces (macOS Seatbelt;
  `runs.js` runLimits computes them, each adapter passes them on):
  - **Reads:** the workspace, the TRIF code `trif` runs, node, and the user's skill folders, read only
    (`skillDirs`: `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills` and where each skill in them
    really is, links followed; not a link to the home folder or above, nor into a visible folder such as
    `~/Documents`); nothing else in the home folder (every item in it is denied, rather than the folder
    itself, which node and `mkdir -p` must be able to look at; inside hidden folders on the way to a skill
    folder, such as `~/.codex`, every other item: Codex's login stays unreadable). Codex offers the
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
    of them). In the workspace, not `config.json` (API keys), `safari-token`, `helper.log`, `runs/`
    (other runs' logs hold the pages they read) or `screenshots/` (other sites'), except the run's own
    screenshots folder and mailbox.
  - **Writes:** the mods folder, with every existing folder of another site (`all-sites/` included)
    read-only inside it; the run's screenshots folder; its mailbox. Not `held.json`, `preinstalled.json`, `.shipped/`,
    `origins.json`, `active-runs/`, `trash/`, `instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/`,
    `bin/`, `app/` or `runs/`. A run can still create a folder for another site; its mods are held like
    any out-of-scope mod.
  - **Network:** none, and no unix sockets: not the helper's, not the Safari bridge's.

  Codex runs any command, all inside its permission profile (`codex.js` permissionsToml: `network =
  { enabled = false }`; the user's own Codex config and rules files aren't loaded, since a
  `sandbox_mode` there would replace the profile). Claude Code runs only `trif`, `cd` and `ls`, in its
  sandbox (`claude.js` runSettings, passed with `--settings`: `enabled`, `failIfUnavailable`,
  `allowUnsandboxedCommands: false`, the filesystem lists, `network: {allowedDomains: [],
  strictAllowlist: true}`); its own file tools follow permission rules: edits only under `sites/` minus
  other sites' existing folders (deny rules by each folder's path in the workspace and by its real path,
  so a site folder that is a link is covered too), no reads of the secrets, logs or other sites' screenshots. Claude Code
  applies a `Read`/`Edit` deny rule to its sandbox too, where nothing can reopen it, so those rules don't
  cover `runs/` (the sandbox does). Verified on macOS with Codex 0.166 (`codex sandbox`) and Claude Code
  2.1.312 (a real `-p` run): each read and write above, another run's mailbox, the internet and the
  helper's socket are refused ("Operation not permitted"); the run's own mods, screenshots and
  mailbox, and `trif`, work.

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
  --strict-mcp-config --settings <run settings> --allowedTools Read(./**) Glob Grep "Edit(./sites/**)"
  Bash(webmods:*) Bash(cd:*) Bash(ls:*) --disallowedTools WebFetch WebSearch "Read(./config.json)"
  "Read(./safari-token)" "Read(./helper.log*)" "Read(./runs/*.jsonl)" "Read(./screenshots/*.png)"
  --append-system-prompt <context> [--resume <sessionId>] [--model <model>] -- <prompt>`, the message
  last, after `--`. In -p anything that would need approval is denied, so edits happen only under
  `sites/`; the run settings add its sandbox and the per-run denies (see "Run scope"). (2.1.312 ignored
  `Bash(...)` allow rules from the workspace's settings file in -p runs; `trif setup` writes the same
  lists to the workspace's `.claude/settings.json` for interactive sessions there, and the deny rules
  there apply to runs too.) Other Bash commands are denied. `--setting-sources project` keeps the user's own broader allow rules out;
  `--strict-mcp-config` keeps their MCP servers out. stream-json lines: `{type:"system", subtype:"init",
  session_id}` → session; `{type:"assistant", message:{content:[{type:"text", text} | {type:"tool_use",
  name, input}]}}` → text / tool (summary: Bash → `input.command`; Edit/Write/Read → `input.file_path`
  relative to the workspace); `{type:"result", is_error, result, total_cost_usd, session_id}` → done.
  "Not logged in" in the result → error "Claude Code isn't logged in: run `claude` in a terminal and log in
  (type /login)".
- **codex** (OpenAI Codex CLI 0.138+; tested with 0.166): `codex exec --json --skip-git-repo-check
  --ignore-user-config --ignore-rules -c approval_policy="never" -c default_permissions="trif-run"
  -c permissions={…} [-m MODEL] [resume THREAD_ID] -- PROMPT`, the exec options before `resume`. JSONL
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
  -c model_providers.trif-open={ name = "OpenRouter (TRIF)", base_url = "https://openrouter.ai/api/v1",
       wire_api = "responses", env_key = "OPENROUTER_API_KEY" }
  -c model_provider="trif-open" -c web_search="disabled"
  -c shell_environment_policy.exclude=["OPENROUTER_API_KEY"]
  -m openai/gpt-oss-120b [resume THREAD_ID] -- PROMPT
```

Local providers have no `env_key`, and add `stream_idle_timeout_ms = 900000` (a model can take minutes
to load), `request_max_retries = 1`, `stream_max_retries = 1`. Not `--oss --local-provider`: in Codex
0.166 `exec --oss` fails ("This chat uses ollama, but your current provider is openai") unless
`model_provider` is set as well, and it **pulls** a model that isn't installed (`POST /api/pull`, many GB,
mid-chat). `web_search` is OpenAI's hosted tool; other providers don't have it.

- **Providers** (`PROVIDERS`): `ollama` (`http://127.0.0.1:11434/v1`, default model `gpt-oss:20b`),
  `lmstudio` (`http://127.0.0.1:1234/v1`, `openai/gpt-oss-20b`), `openrouter`
  (`https://openrouter.ai/api/v1`, key in `OPENROUTER_API_KEY`, `openai/gpt-oss-120b`), `custom` (a base
  URL, optional key variable, no default model).
- **Settings.** config.json `openModel` = `{provider, model?, baseUrl?, keyEnv?}`: the defaults, shared
  by the panel (`agent.openModel.set`) and `trif agent open-model`. config.json is unreadable to runs, and
  `agent.*` is refused from runs. `keyEnv` is a variable NAME (`^[A-Za-z_][A-Za-z0-9_]*$`), never a key;
  `baseUrl` is http(s) without credentials. What a run uses (`resolve`): the defaults, then agent.start's
  `openModel` (same shape; another provider starts from that provider's defaults), then agent.start's
  `model`, then the provider's defaults. The panel's model picker keeps the model like any agent's
  (`settings.models["codex-oss"]`); the provider block (`extension/openmodel.js`) shows under the agent
  picker when codex-oss is chosen. For per-chat agent choices, a chat's selection is `{agent: "codex-oss",
  model, openModel: {provider, baseUrl, keyEnv}}`, passed as agent.start's `agent`, `model` and
  `openModel` (and `agent.models {agent, openModel}` lists that provider's models).
- **The key.** Chrome starts the helper without the user's shell profile, so before each run
  (`prepare`, awaited by runs.js before spawning) the helper looks the variable up (`shellenv.js`): its
  own environment first, then the user's login shell, interactive so `~/.zshrc` is read:
  `<shell from the user database> -l -i -c "printf <begin>; /usr/bin/printenv NAME; printf <end>"`, with
  HOME/USER/PATH only, stdin closed, a 10 s limit, random markers to skip what the profile prints. Found
  values stay in the helper's memory for 10 minutes; nothing is written anywhere. The value goes into
  Codex's environment only (Codex sends it as `Authorization: Bearer`), `shell_environment_policy.exclude`
  keeps it out of the commands Codex runs, and runs.js redacts it (`[redacted]`) from the run log, its
  events and the stderr tail. The commands can't get it another way: the shell profiles are in the home
  folder (denied), `ps -E` is refused by the sandbox, config.json holds only the name. (On Linux the
  bubblewrap sandbox would need checking for `/proc/<codex pid>/environ`.)
- **Network.** The permission profile's `network = { enabled = false }` covers the commands Codex runs,
  not Codex's own model requests. Verified with Codex 0.166 (real `codex exec`, TRIF's profile, a
  stand-in Responses server on 127.0.0.1; `tests/open-models.test.js` last test, and a real OpenRouter
  run): the model requests arrive with the key; the agent's `curl https://example.com` fails to resolve,
  its `curl` to the stand-in server's own port is refused, `cat config.json` and `~/.zshrc` are
  "Operation not permitted", writes to another site's folder are refused, its own site's folder and
  `trif` (through the mailbox) work, and `$OPENROUTER_API_KEY` is empty.
- **Before a run** (`prepare`): no key found → error naming the variable and the fix; a local server
  that doesn't answer (`/api/tags` for Ollama, `/v1/models` otherwise, 3 s) → "Ollama isn't running";
  an Ollama model that isn't installed → "run `ollama pull <model>`". Codex isn't started in those cases.
- **Models** (`agent.models`, cached 5 s, keyed by provider): local → the server's installed models,
  recommended ones first (`gpt-oss:20b`, `gpt-oss:120b`, `qwen3-coder:30b`, `qwen3.6:27b`, `devstral`,
  `gemma4`, matched loosely so LM Studio's names count); OpenRouter → a short fixed list
  (`openai/gpt-oss-120b`, `qwen/qwen3-coder`, `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3`,
  `moonshotai/kimi-k2.7-code`), no network; custom → none. Always `custom: true` ("Other…").
- **Errors** are reworded for the provider (codex.js `parse` takes `state.friendly`): 401 → the key in
  `<VAR>` was refused; 402 → out of credit; Ollama's "not found, try pulling it" → `ollama pull`;
  connection refused → not running. Codex's "Model metadata for `<model>` not found" warning (every
  non-OpenAI model) is dropped.
- **Doctor**: with `openModel` set, the key variable found (where, never the value), the local server
  reachable, the Ollama model installed, Codex new enough; without it, an info line.

Security notes: page content reaches the agent, so prompt injection is possible. The agent is limited
to editing the workspace and running `trif` (which can still run JavaScript in the user's tabs);
AGENTS.md's safety rules forbid acting on page instructions and account-changing clicks.
