# WebMods: architecture and protocol

WebMods lets anyone customize websites with their own coding agent (Claude Code, Codex, Gemini CLI,
Cursor…). The agent writes **mods**: plain JavaScript files, one per customization, that run on a site
every time it loads. Mods keep working with no agent around.

Working name: WebMods. Everything is plain Node (≥ 18) and plain browser JavaScript: **no npm
dependencies, no build step.**

## Pieces

```
 coding agent ──runs──▶ `webmods` CLI ──unix socket──▶ helper (native host) ──native messaging──▶ extension ──▶ tabs
                         (helper/cli.js)   ~/.webmods/helper.sock   (helper/host.js)                 (extension/)
 coding agent ──edits──▶ ~/.webmods/sites/<site>/<mod>.js ◀──watches── helper ──pushes mods──▶ extension (chrome.userScripts)
```

1. **Extension** (`extension/`, Manifest V3, Chrome ≥ 135). Runs mods with `chrome.userScripts` in the
   page's MAIN world at `document_start`. Executes the CLI's page commands. Records what sites load when
   asked. Has an onboarding page for Chrome's "Allow User Scripts" switch.
2. **Helper** (`helper/`). One Node program with two entry points:
   - `host.js`: the native messaging host Chrome launches when the extension calls
     `chrome.runtime.connectNative('com.webmods.helper')`. It serves the CLI over a unix socket and
     watches the mods folder, pushing mods to the extension.
   - `cli.js`: the `webmods` command agents (and people) run.
   - `webmods setup` installs everything: workspace, native host manifest, wrapper script, CLI link.
     Strangers run it as `npx webmods setup` (npm package `webmods`, see "Native host installation").
3. **Workspace** (`~/.webmods/`, overridable with env `WEBMODS_HOME`). The agent's working directory:
   ```
   ~/.webmods/
     AGENTS.md           how to build mods (copied from helper/workspace/AGENTS.md on setup; refreshed on every setup)
     CLAUDE.md           "@AGENTS.md" (Claude Code reads CLAUDE.md; the @ import pulls in AGENTS.md)
     sites/<site>/<mod>.js
     helper.sock         the default helper's socket (exists while a browser is running with the extension)
     helper-<pid>.sock   each running helper's own socket (one helper per connected browser or Chrome profile)
     config.json         { "modsDir": "...optional override..." }
   ```
   `<site>` is a hostname like `x.com` or `news.ycombinator.com`. `<mod>` is a kebab-case name.
   Files whose name starts with `_` or `.` are ignored (scratch files, helpers).
4. **Examples** (`examples/sites/<site>/<mod>.js`): ready-made mods (Plain X first). Not installed
   automatically; `webmods install-example <site>/<mod>` copies one into the workspace.

## Extension identity

`extension/manifest.json` carries a fixed `"key"` so the unpacked extension always has the ID
**`iaablflfafmonebdomeikadolkgdbkhe`**. The native host manifest's `allowed_origins` lists every WebMods
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
// ==/WebMod==
```

- `@match` (repeatable): Chrome match patterns. **Default** when absent: `*://<site>/*` and
  `*://*.<site>/*`, where `<site>` is the mod's folder name; `*://*/*` in the `all-sites` folder
  (mods with no single home site; `webmods new all-sites <mod>` writes that `@match`).
- `@exclude` (repeatable): exclude match patterns. Default none.
- `@run-at`: `document-start` (default), `document-end` or `document-idle`.
- `@name`: default is the file name without `.js`. `@description`: default empty.
- `@risk`: `0`, `1` or `2`, then optionally why: how noticeable the mod is to the site (0 render-only,
  1 noticeable by the page's scripts, 2 changes what the site receives; defined in AGENTS.md "Account
  safety"). Parsed into `risk: {tier, why}` (null when absent; a malformed value is a warning). The side
  panel shows a badge for 1 and 2; a side-panel run's tier-2 mod is held (see "Run scope").
- Unknown keys are ignored. A file without a header is valid.

**Mod id** = `<site>/<mod>` (e.g. `x.com/plain-x`). The helper parses headers; the extension never parses.

## Messages: helper ⇄ extension (native messaging)

Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON. Host→extension messages must
stay under 1 MB (the helper rejects bigger mods with an error logged to stderr, and the CLI reports it).

**helper → extension**

| message | meaning |
|---|---|
| `{type:"mods", mods:[Mod…]}` | The full set of mods. Sent on connect and after every change in the mods folder (debounced 150 ms). The extension makes `chrome.userScripts` match it exactly (register new, update changed, unregister missing). |
| `{type:"request", id, cmd, args}` | A page command from the CLI (table below). The extension answers with a `response`. |

`Mod = { id, site, file, name, description, matches:[…], excludes:[…], runAt:"document_start"|"document_end"|"document_idle", risk:{tier, why}|null, code, hash, held?, startOff?, origin?:{by, browser} }`
(`file` is the absolute path; `hash` is a sha1 of code+metadata so the extension can skip unchanged mods.)

**extension → helper**

| message | meaning |
|---|---|
| `{type:"hello", version, userScripts: bool, chrome: "<version>"}` | Sent on connect. `userScripts` is false when the "Allow User Scripts" switch is off. |
| `{type:"response", id, ok:true, result}` / `{type:"response", id, ok:false, error:"message"}` | Answer to a request. |
| `{type:"modsApplied", registered:[ids], errors:[{id, error}]}` | After applying a `mods` message. |
| `{type:"log", level, message}` | Extension-side diagnostics; the helper writes them to `~/.webmods/helper.log`. |

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
| `record` | `site`, `on: bool` | `{recording:[sites]}`. Turns the network recorder on/off for a hostname (and its subdomains). Takes effect on the next page load. |
| `requests` | `filter` (regex string, matched against URL), `limit` (default 50) + tab selector | `[{i, method, url, status, type:"fetch"|"xhr", size, time}]`, newest last |
| `request` | `i` + tab selector | `{method, url, status, requestBody, responseText}` (bodies capped at 2 MB each) |
| `errors` | tab selector | `[{mod, message, stack, time}]`: errors thrown by mods in that page |
| `logs` | tab selector | `[{mod, level, args:[strings], time}]`: what mods logged with `webmods.log(...)` |
| `mod.enable` | `id`, `enabled: bool`, `wait: bool` + tab selector | `{id, enabled, reloaded}`: switches a mod on/off (below). `reloaded` = the tab id reloaded, or null |

### Mod switches (`mod.enable`)

Each mod can be switched off without touching its file. The switched-off set lives in the extension's
`chrome.storage.local` under **`disabled`** = `{"<mod id>": true}`, so it survives service-worker
restarts and helper reconnects: every sync (including each `mods` message from the helper) skips
switched-off mods and unregisters them if registered; switching one on registers it again. Ids of
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
`site` inside its scope (`webmods enable|disable <id> --site HOST`). In the side panel, a mod that
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
recorded site (not every page: its globals would let any site detect WebMods users; with no mods on and
nothing recorded, nothing is registered; if the union is invalid, `<all_urls>`), MAIN
world, `document_start`, **registered before any mod** so it runs first. It defines:

```js
window.__webmods = {
  errors: [],          // {mod, message, stack, time}  (capped at 200)
  logs: [],            // {mod, level, args, time}      (capped at 500)
  requests: [],        // recorder entries, only when recording this site (capped at 300; bodies capped at 2 MB)
  recording: bool,
};
window.webmods = { log(...args), warn(...args), error(...args) };   // for mods; records with the current mod id
```

Every mod is wrapped by the extension before registering:

```js
(() => { const __mod = "x.com/plain-x"; window.__webmods && (window.__webmods.current = __mod);
try { /* mod code */ } catch (e) { window.__webmods?.errors.push({mod: __mod, message: String(e?.message ?? e), stack: String(e?.stack ?? ""), time: Date.now()}); console.error("[webmods]", __mod, e); }
})();
//# sourceURL=webmods://x.com/plain-x.js
```

(Errors thrown later from a mod's event handlers or timers aren't caught by this wrapper; the runtime
also listens for `window` `error`/`unhandledrejection` events and attributes those whose stack mentions
`webmods://<site>/<mod>.js`.)

**Recorder:** when the page's hostname is in the recording set, the runtime hooks `fetch` and
`XMLHttpRequest` (before the site's code runs) and stores each request: method, URL, status, request
body (strings only; else `"[binary]"`), response text (text-like content types only). The recording set
reaches the runtime because the extension re-registers `webmods-runtime` (ids starting with `_` are reserved by Chrome) with the set embedded in its
code whenever it changes (`const RECORDING = ["x.com"]`).

## CLI (`webmods`)

```
webmods setup [--browser chrome|chromium|brave|edge|arc|all] [--copy|--link]   install workspace, native host, CLI link
webmods status                     connection, user-scripts switch, mods and whether each is registered (or off)
webmods doctor                     diagnose setup problems, printing a fix for each
webmods tabs
webmods run [TAB] '<code>'         run JS in the page (REPL-style); `-f file.js` to run a file; `-` reads stdin
webmods reload [TAB] [--hard]
webmods open <url>
webmods navigate [TAB] <url>
webmods text [TAB]
webmods screenshot [TAB] [-o file.png]     default: ~/.webmods/screenshots/<time>.png; prints the path
webmods record <site> [on|off]
webmods requests [TAB] [--filter <regex>] [--limit N]
webmods request [TAB] <i> [-o file]        prints JSON; response bodies that are JSON are pretty-printed
webmods errors [TAB]
webmods logs [TAB]
webmods mods                        list mods from the folder (id, matches, file); [off] marks switched-off ones when Chrome is reachable
webmods disable <site>/<mod> [TAB]  switch a mod off (mod.enable; reloads TAB/the active tab if the mod runs there)
webmods enable <site>/<mod> [TAB]   switch it back on
webmods approve <site>/<mod>        let a held mod run (see "Run scope"); refused inside an agent run
webmods check <file|site/mod>       compile a mod without running it; prints the syntax error or "ok"
webmods new <site> <mod>            create sites/<site>/<mod>.js from a template, print its path
webmods install-example <site>/<mod>
webmods help [command]
```

`TAB` is `--tab <id>` or `--url <substring|/regex/>`. Exit code 0 on success, 1 on a command error,
2 when the helper isn't running (message: open Chrome; if Chrome is open, run `webmods doctor`). Output
is plain text for humans and agents: no colours when stdout isn't a TTY. `--json` makes any command print
the raw result as JSON.

## CLI ⇄ helper (unix socket)

Newline-delimited JSON on `~/.webmods/helper.sock` (mode 0600). Request `{id, cmd, args, token?}` →
response `{id, ok, result|error}`. Helper-local commands (`mods`, `ping`) are answered by the helper;
everything else is forwarded to the extension. Requests time out after `args.timeout + 5000` ms (default 35 s).
Agent commands (`agent.list`/`agent.start`/`agent.stop`) are helper-local too; after answering `agent.start` with `{runId}`, the helper streams `{type:"agentEvent", runId, event}` lines (no `id`) on that same connection until the `done` event.
`token` is the run token (see "Run scope"): the CLI sends `$WEBMODS_RUN_TOKEN` when it's set.
If the socket file exists but nothing listens, the next host to start removes it.

**Several browsers.** Each browser (or Chrome profile) that runs the extension starts its own host. Every
host serves its own socket, `helper-<pid>.sock`, and removes it on exit (a host starting up removes those
whose pid is dead). The first host also serves `helper.sock`; later ones log that they're secondary and
take over `helper.sock` when the first exits. Mod files are shared: every host watches the same folder.
Which socket the CLI uses:
- `--browser <name|pid>`: the host whose extension said hello with that browser name (`Chrome`,
  `Firefox`, case-insensitive) or that pid (`lib/helpers.js` pings each `helper-*.sock`). Two hosts for
  the same browser (two Chrome profiles) need the pid. Refused inside an agent run.
- Inside an agent run: `$WEBMODS_SOCK`, which the host that started the run sets to its own socket, so
  a run started from Firefox's sidebar works on Firefox's tabs even while Chrome's host owns `helper.sock`.
- Otherwise `helper.sock`.
`webmods status` and `webmods doctor` list the other connected browsers.

**Mods made in another browser start off.** Each extension install has a random `installId` (in its
storage, sent in `hello`). A run marks itself in `<home>/active-runs/<runId>.json` (`{runId, by, browser,
site, pid}`; `endedAt` when done, honoured for 15 s). When a helper's scan first sees a new mod id, it
records in `<home>/origins.json` the run that made it (one on the mod's site first, else its own, else
any): `{"<id>": {by, browser, at}}`; with no run going (a terminal agent, a hand edit) the id has no
origin. Mods go to the extension with `origin: {by, browser}`, and an extension switches off a mod whose
`origin.by` isn't its own `installId` the first time it sees it (`startedOff`, as for preinstalled mods);
the panel tags it "from <browser>" while it's off.

## Native host installation (`webmods setup`)

First install, for anyone with Node ≥ 18: **`npx webmods setup`**. The npm package `webmods` (root
`package.json`, `bin: webmods → helper/cli.js`) ships `helper/`, `extension/`, `examples/` and this file.
Re-running setup is safe; run it again to update.

- **Where the wrappers point (install mode).**
  - `copy` (default when the package isn't a git checkout, i.e. `<package>/.git` doesn't exist, as
    with npx, whose folder is a cache npm may delete): setup copies `package.json`, `helper/`,
    `extension/` and `examples/` into `~/.webmods/app/` and the wrappers run that copy. The copy goes to
    a temp sibling (`.app.new-<pid>`) and is then swapped in, so a failed copy leaves a working install
    alone; when `app/` already matches byte for byte, nothing is touched (a running helper keeps its files).
    Running setup from the copy itself (`webmods setup` through the wrapper) leaves it in place.
  - `link` (default in a git checkout, for developing WebMods): the wrappers run the checkout's files.
  - `--copy` / `--link` force either mode.
  AGENTS.md, CLAUDE.md, the mod template and the examples always come from the files the wrappers run.
- Preinstalled mods: setup copies the examples listed in `PREINSTALLED` (helper/lib/preinstalled.js:
  Plain X and the Instagram mods) into `sites/`, **switched off**. `~/.webmods/preinstalled.json` =
  `{offered, startOff}`: `offered` keeps a later setup from bringing back one the user deleted (an
  existing file is never overwritten); `startOff` lists the ones setup copied. The helper sends those
  mods with `startOff: true`; the extension switches each off (`disabled`) the first time it sees it and
  remembers that in chrome.storage.local `startedOff`, so afterwards the switch is the user's.
  `--no-examples` skips all this.
- Wrapper: `~/.webmods/bin/webmods-host` = `#!/bin/sh\nexec "<absolute node path>" "<app>/helper/host.js" "$@"`
  where `<app>` is `~/.webmods/app` (copy) or the checkout (link)
  (Chrome launches hosts with a minimal PATH, so the node path is absolute).
- Manifest `com.webmods.helper.json` → `{ name, description, path: <wrapper>, type: "stdio", allowed_origins: [...] }`
  where `allowed_origins` is `chrome-extension://<id>/` for every WebMods extension ID (see "Extension
  identity"), written to each selected browser's `NativeMessagingHosts` dir (macOS:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `…/Chromium/…`,
  `…/BraveSoftware/Brave-Browser/…`, `…/Microsoft Edge/…`; Linux: `~/.config/google-chrome/NativeMessagingHosts` etc.).
  Default: every one of those browsers whose parent folder exists. `webmods doctor` fails a manifest
  that is missing any of the IDs.
- CLI link: `~/.webmods/bin/webmods` (shell wrapper like the host's), and it prints a line to add
  `~/.webmods/bin` to PATH if it isn't there. If `/usr/local/bin` is writable, it also symlinks
  `/usr/local/bin/webmods`.
- PATH for agents: setup records the terminal's PATH in `config.json` `env.PATH`, minus the folders npx
  adds for its own run.
- Extension: until the Chrome Web Store listing exists, users (beta testers) load it unpacked from
  `<app>/extension` (setup's "Next steps" print the folder). The listing will replace that step.
- Version: the root `package.json` is the single source; `helper/lib/paths.js` reads it and
  `extension/manifest.json`'s version must match (a test checks).

## Repository layout

```
extension/   manifest.json, background.js (service worker), runtime.js (page runtime source),
             onboarding.html/.js, icons/
package.json the npm package `webmods` (version, bin, files allowlist)
helper/      host.js, cli.js, lib/*.js, workspace/AGENTS.md, workspace/CLAUDE.md, templates/mod.js
examples/    sites/x.com/plain-x.js (+ tests)
tests/       node tests (node --test), incl. a fake extension for the helper and a chrome.* mock for the extension
docs/        PROTOCOL.md (this file)
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
    `{sessionId, agent, messages: [{role: "user"|"assistant"|"tool"|"error", text, time}]}`. A text box
    (Enter sends, Shift+Enter newline), Send / Stop, "New chat" (forgets the sessionId and messages).
    Assistant text renders as simple markdown (paragraphs, lists, `code`, code blocks, bold, links that
    open in a new tab), escaped first: never inject agent or page text as raw HTML. Tool events render
    as one compact line each ("ran webmods reload --tab 12", "edited sites/x.com/hide-reposts.js").
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
  - **States:** helper not connected → short setup instructions (`npx webmods setup`, link to Setup page);
    user scripts off → button opening chrome://extensions/?id=…; agent missing → the error text from the
    helper (it includes the fix); agent not logged in (`loggedIn === false` in `agent.list`, or a run
    failed with the not-logged-in error) → "Claude Code isn't logged in" with a **Log in** button (see
    "Logging in" below; agents with `canLogin: false` show `loginFix` instead).
  - **Settings:** agent (from `agent.list`; only available ones selectable), optional model name (free
    text with suggestions opus / sonnet / haiku, empty = agent default). Stored in `chrome.storage.local` `settings`.
  - Light/dark via `prefers-color-scheme`; compact, clean, system font; fits a narrow panel (320 px+).
- Panel ⇄ background: `chrome.runtime.connect({name: "panel"})`. Panel → background:
  `{type: "agent.start", site, tabId, url, prompt, sessionId, agent, model}`, `{type: "agent.stop", runId}`,
  `{type: "agent.list"}`, `{type: "agent.login", agent}`, `{type: "agent.loginCode", loginId, code}`,
  `{type: "agent.loginCancel", loginId}`, `{type: "status"}`, `{type: "mod.enable", id, enabled, tab}`,
  `{type: "mod.approve", id, tab}`, `{type: "instructions.get"}`, `{type: "instructions.set", text}`, `{type: "chat.clear", site}`, `{type: "chat.note", site, text}`. Background forwards agent commands to the
  helper as native `request`s with the same cmd and relays every native `{type: "agentEvent", runId,
  event}` to all panel ports (panels ignore runs and logins they didn't start, by id).
  If the helper disconnects mid-run (or mid-login), the background sends the panel `{kind: "error"}` then
  `{kind: "done", ok: false}` (plus `login: true` for a login).

### Helper

New native request commands (answered with a normal `response`):

| cmd | args | result |
|---|---|---|
| `agent.list` | – | `{agents: [{id, name, path, available, version, note, loggedIn, canLogin, loginFix}], default}` |
| `agent.start` | `agent, model?, site, url, tabId, prompt, sessionId?` | `{runId}` right away; progress arrives as `agentEvent` messages |
| `agent.stop` | `runId` | `{stopped: true}` (SIGTERM, SIGKILL after 3 s) |
| `agent.login` | `agent?` | `{loginId}` right away; progress arrives as `agentEvent` messages with `runId` = the loginId |
| `agent.loginCode` | `loginId, code` | `{sent: true}` (writes the code and a newline to the login's stdin) |
| `agent.loginCancel` | `loginId` | `{cancelled: true}` |
| `mod.approve` | `id` | `{id, approved: true}`: releases a held mod (see "Run scope"); also on the socket, not from a run |
| `instructions.get` | | `{text, file, max}`: the user's standing instructions (`~/.webmods/instructions.md`, `''` if none) |
| `instructions.set` | `text` | same; trimmed, at most 4000 characters, empty removes the file. Not from a run |

`loggedIn` is `true` / `false`, or `null` when unknown or the agent isn't available (from the adapter's
`loginStatus`, which spends no tokens; cached 30 s per agent, forgotten when a login finishes or a run
reports "isn't logged in"). `canLogin`: whether `agent.login` works for it; `loginFix`: the terminal
instructions otherwise.

New helper → extension message: `{type: "agentEvent", runId, event}` where `event` is one of
(normalized across agents):

```
{kind: "session", sessionId}                       the agent's conversation id (for resuming)
{kind: "text", text}                               a block of assistant text
{kind: "tool", name, summary}                      a tool call, e.g. {name:"Bash", summary:"webmods reload --tab 12"}
{kind: "error", message}                           something went wrong (agent missing, not logged in, crashed…)
{kind: "done", ok, result, costUsd, changedFiles, sessionId}   always the last event of a run
{kind: "login", url}                               (logins) the sign-in page to open
{kind: "done", ok, login: true, cancelled?}        (logins) always the last event of a login
```

- `changedFiles`: paths relative to the workspace under `sites/` whose content changed during the run
  (snapshot hashes before and after).
- One run at a time per site; a second `agent.start` for a busy site fails with "already working on <site>".
  Runs are killed after 15 minutes. Raw agent output is kept in `~/.webmods/runs/<runId>.jsonl`
  (last 50 runs).
- **Finding agents.** Chrome starts the helper with a minimal PATH, so `webmods setup` records the PATH
  of the terminal it ran in as `config.json` → `env.PATH`. The helper looks agents up in that PATH plus
  `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.npm-global/bin`. Spawned agents get
  `PATH = ~/.webmods/bin : <recorded PATH> : <defaults>`, `HOME`, `USER`, `LANG`, `TERM=dumb`, cwd =
  the workspace, and **no** inherited `CLAUDE*`/`ANTHROPIC_*`/`CODEX_*` variables except
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` if the user set them in `config.json` → `env`.
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
  `webmods agent login [--agent claude]` runs the same flow from a terminal (prints the URL, reads the
  code from stdin).
- **Context for the agent** (prepended to the first message of a session, or passed as an appended
  system prompt where the agent supports it): "You're running inside the WebMods side panel in the
  user's Chrome. They're looking at <url> (tab <tabId>): pass `--tab <tabId>` to webmods commands. Follow
  AGENTS.md. Mods can be switched off and on with `webmods disable/enable <site>/<mod>`; `webmods status`
  shows which are on. Reply briefly in plain language; your replies appear in a narrow chat panel. You can't ask
  follow-up questions mid-task: if something's unclear, make a sensible choice or end your turn with a
  question." Later messages in the session get a one-line reminder of the current URL and tab id.

### Run scope

Agent runs read web pages, and a page can carry instructions aimed at the agent. So each run is limited
to one site, its **scope**: the registrable domain of the run's site (`en.wikipedia.org` →
`wikipedia.org`; `bbc.co.uk`, `user.github.io` and a few other suffixes are handled; no full Public
Suffix List). `helper/lib/scope.js` computes it; `extension/lib.js` mirrors the checks.

- **Token.** `agent.start` makes a random token per run and gives the agent `WEBMODS_RUN_TOKEN`; the
  CLI sends it with every request. The helper answers a request with an unknown token (the run ended)
  with an error, refuses `agent.*`, `mod.approve` and `instructions.*` from a run, and sets `args.scope` on everything
  else it forwards (overriding any `scope` the client sent). Requests without a token (the user's
  terminal, the user's own agent outside the panel) are not scoped. The CLI itself refuses `setup`,
  `agent` and `approve` when the variable is set.
- **Extension.** With `args.scope`, page commands only act on tabs whose URL is http(s) on the scope or
  a subdomain (`tabs` lists only those; others fail with an error naming the scope); `open`/`navigate`
  only go to such URLs; `record` only for such sites; `mod.enable` only for mods whose every `@match` is
  in scope.
- **Held mods.** The helper snapshots the mods folder when a run starts. On every mods sync while a run
  is live (and for 10 s after it ends), a mod that the run added or changed and that has an `@match`
  outside the scope (`<all_urls>`, a `*` host, another domain, `file://`), or whose `@risk` is 2, is **held**: recorded in
  `~/.webmods/held.json` (`{id: {hash, site, scope, runId, reason, at, approved?}}`) and sent to the
  extension with `held: {site, reason}`, which the extension doesn't register. The run's `done` event
  carries `held: [{id, reason}]`; the panel says so in the chat and lists the mod (also when it doesn't
  apply to the tab) with an Allow button (`mod.approve`). Approving marks the entry approved so that
  version isn't held again; any change to the file drops the entry (a later run's change is checked
  afresh). `webmods status`/`mods` show held mods.
- **Agent permissions.** The scope only holds if the agent can't reach the helper without the token or
  rewrite the rules: so Claude Code runs get no command that runs arbitrary code (no `node`), can't
  edit `held.json`, `config.json`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `bin/` or `app/` (verified
  with Claude Code 2.1.312), and can't read
  `config.json` (it may hold API keys). Codex runs use Codex's workspace-write sandbox, which can run
  any command in the workspace: the scope is advisory for Codex (still experimental).

### Agent adapters (`helper/lib/agents/<id>.js`)

Each adapter: `detect(env) → {available, path, version, note}`, `command({prompt, sessionId, model,
context, workspace}) → {file, args}`, and `parse(line, emit)` turning one stdout line into events.
Login: `loginStatusArgs` + `parseLoginStatus({status, error, stdout, stderr}) → {loggedIn, detail}`
(`loginStatus()` runs it synchronously, for `webmods doctor`), `loginFix`, and `login: {args,
parseLine(line) → {kind:"login", url} | {kind:"text", text} | null}` or `null` when the panel can't log it in.
The user's standing instructions (`instructions.md`) reach claude through the workspace's CLAUDE.md
(`@instructions.md`; adapter flag `readsInstructions`); other adapters get them appended to the context.

- **claude** (Claude Code ≥ 2.1, tested): `claude -p <prompt> --output-format stream-json --verbose
  --permission-mode acceptEdits --setting-sources project --strict-mcp-config --append-system-prompt <context>`
  plus `--resume <sessionId>` and `--model <model>` when given. `acceptEdits` lets it edit and write files
  inside the workspace (and denies writes outside it); with `dontAsk`, `Edit`/`Write` allow rules didn't
  allow writes at all (2.1.149). Everything else is passed as `--allowedTools Read(./**) Glob Grep
  Bash(webmods:*) Bash(cd:*) Bash(ls:*) --disallowedTools WebFetch WebSearch "Read(./config.json)"
  "Edit(./config.json)" "Edit(./held.json)" "Edit(./AGENTS.md)" "Edit(./CLAUDE.md)" "Edit(./instructions.md)" "Edit(./.claude/**)"
  "Edit(./bin/**)" "Edit(./app/**)" "Edit(./runs/**)"`: nothing that runs arbitrary code, and no edits
  to the files that control WebMods (see "Run scope"; `Edit(./*)` denied every file, sites/ included,
  in 2.1.312, so the files are listed) (2.1.312 ignored `Bash(...)` allow rules from the workspace's settings file in -p
  runs); `webmods setup` writes the same lists to the workspace's `.claude/settings.json` for interactive
  sessions there. Other Bash commands are denied. `--setting-sources project` keeps the user's own broader allow rules out;
  `--strict-mcp-config` keeps their MCP servers out. stream-json lines: `{type:"system", subtype:"init",
  session_id}` → session; `{type:"assistant", message:{content:[{type:"text", text} | {type:"tool_use",
  name, input}]}}` → text / tool (summary: Bash → `input.command`; Edit/Write/Read → `input.file_path`
  relative to the workspace); `{type:"result", is_error, result, total_cost_usd, session_id}` → done.
  "Not logged in" in the result → error "Claude Code isn't logged in: run `claude` in a terminal and log in
  (type /login)".
- **codex** (OpenAI Codex CLI, experimental, not installed here): `codex exec --json …` with resume by
  thread id; research the current CLI flags and JSONL event shapes from its docs; mark `note:
  "experimental"`.

Security notes: page content reaches the agent, so prompt injection is possible. The agent is limited
to editing the workspace and running `webmods` (which can still run JavaScript in the user's tabs);
AGENTS.md's safety rules forbid acting on page instructions and account-changing clicks.
