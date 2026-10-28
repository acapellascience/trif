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
3. **Workspace** (`~/.webmods/`, overridable with env `WEBMODS_HOME`). The agent's working directory:
   ```
   ~/.webmods/
     AGENTS.md           how to build mods (copied from helper/workspace/AGENTS.md on setup; refreshed on every setup)
     CLAUDE.md           "@AGENTS.md" (Claude Code reads CLAUDE.md; the @ import pulls in AGENTS.md)
     sites/<site>/<mod>.js
     helper.sock         the helper's socket (exists while Chrome is running with the extension)
     config.json         { "modsDir": "...optional override..." }
   ```
   `<site>` is a hostname like `x.com` or `news.ycombinator.com`. `<mod>` is a kebab-case name.
   Files whose name starts with `_` or `.` are ignored (scratch files, helpers).
4. **Examples** (`examples/sites/<site>/<mod>.js`): ready-made mods (Plain X first). Not installed
   automatically; `webmods install-example <site>/<mod>` copies one into the workspace.

## Extension identity

`extension/manifest.json` carries a fixed `"key"` so the unpacked extension always has the ID
**`iaablflfafmonebdomeikadolkgdbkhe`**. The native host manifest's `allowed_origins` is
`chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/`. (The private key lives in `.keys/`, gitignored;
it's only needed to pack a .crx.)

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
// ==/WebMod==
```

- `@match` (repeatable): Chrome match patterns. **Default** when absent: `*://<site>/*` and
  `*://*.<site>/*`, where `<site>` is the mod's folder name.
- `@exclude` (repeatable): exclude match patterns. Default none.
- `@run-at`: `document-start` (default), `document-end` or `document-idle`.
- `@name`: default is the file name without `.js`. `@description`: default empty.
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

`Mod = { id, site, file, name, description, matches:[…], excludes:[…], runAt:"document_start"|"document_end"|"document_idle", code, hash }`
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
| `status` | – | `{userScripts, chrome, version, mods:[{id, registered}], recording:[sites]}` |
| `tabs` | – | `[{id, windowId, active, url, title}]` (normal windows only) |
| `run` | `code`, `expression: bool`, `timeout` (ms, default 10000) + tab selector | `{value}`: the code's result, made JSON-safe in the page (see below), or an error `{ok:false, error:"<message + stack>"}` |
| `reload` | `hard: bool` + tab selector | `{url}` after the tab's `status` is `complete` (timeout 30 s) |
| `navigate` | `to` (URL) + tab selector | `{url}` after load completes |
| `open` | `to` (URL) | `{id, url}`: opens a new active tab, waits for load |
| `text` | tab selector | `{url, title, text}`: `document.body.innerText`, capped at 200 000 chars |
| `screenshot` | tab selector | `{dataUrl}` PNG of the visible area (the extension focuses the tab's window and activates the tab first). The CLI writes it to a file. |
| `record` | `site`, `on: bool` | `{recording:[sites]}`. Turns the network recorder on/off for a hostname (and its subdomains). Takes effect on the next page load. |
| `requests` | `filter` (regex string, matched against URL), `limit` (default 50) + tab selector | `[{i, method, url, status, type:"fetch"|"xhr", size, time}]`, newest last |
| `request` | `i` + tab selector | `{method, url, status, requestBody, responseText}` (bodies capped at 2 MB each) |
| `errors` | tab selector | `[{mod, message, stack, time}]`: errors thrown by mods in that page |
| `logs` | tab selector | `[{mod, level, args:[strings], time}]`: what mods logged with `webmods.log(...)` |

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

The extension registers one internal user script, id `webmods-runtime` (ids starting with `_` are reserved by Chrome), matching `<all_urls>`, MAIN
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
webmods setup [--browser chrome|chromium|brave|edge|arc|all]   install workspace, native host, CLI link
webmods status                     connection, user-scripts switch, mods and whether each is registered
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
webmods mods                        list mods from the folder (id, matches, file)
webmods new <site> <mod>            create sites/<site>/<mod>.js from a template, print its path
webmods install-example <site>/<mod>
webmods help [command]
```

`TAB` is `--tab <id>` or `--url <substring|/regex/>`. Exit code 0 on success, 1 on a command error,
2 when the helper isn't running (message: open Chrome; if Chrome is open, run `webmods doctor`). Output
is plain text for humans and agents: no colours when stdout isn't a TTY. `--json` makes any command print
the raw result as JSON.

## CLI ⇄ helper (unix socket)

Newline-delimited JSON on `~/.webmods/helper.sock` (mode 0600). Request `{id, cmd, args}` →
response `{id, ok, result|error}`. Helper-local commands (`mods`, `ping`) are answered by the helper;
everything else is forwarded to the extension. Requests time out after `args.timeout + 5000` ms (default 35 s).
If the socket file exists but nothing listens, the next host to start removes it. If a second host starts
(a second Chrome profile) while one is live, it logs that and serves only mod syncing for its profile.

## Native host installation (`webmods setup`)

- Wrapper: `~/.webmods/bin/webmods-host` = `#!/bin/sh\nexec "<absolute node path>" "<repo>/helper/host.js" "$@"`
  (Chrome launches hosts with a minimal PATH, so the node path is absolute).
- Manifest `com.webmods.helper.json` → `{ name, description, path: <wrapper>, type: "stdio", allowed_origins: ["chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/"] }`
  written to each selected browser's `NativeMessagingHosts` dir (macOS:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `…/Chromium/…`,
  `…/BraveSoftware/Brave-Browser/…`, `…/Microsoft Edge/…`; Linux: `~/.config/google-chrome/NativeMessagingHosts` etc.).
  Default: every one of those browsers whose parent folder exists.
- CLI link: `~/.webmods/bin/webmods` (shell wrapper like the host's), and it prints a line to add
  `~/.webmods/bin` to PATH if it isn't there. If `/usr/local/bin` is writable, it also symlinks
  `/usr/local/bin/webmods`.

## Repository layout

```
extension/   manifest.json, background.js (service worker), runtime.js (page runtime source),
             onboarding.html/.js, icons/
helper/      host.js, cli.js, lib/*.js, workspace/AGENTS.md, workspace/CLAUDE.md, templates/mod.js
examples/    sites/x.com/plain-x.js (+ tests)
tests/       node tests (node --test), incl. a fake extension for the helper and a chrome.* mock for the extension
docs/        PROTOCOL.md (this file)
```

Tests run with `node --test` (Node's built-in runner). No dependencies.
