# TRIF on Windows

Where Windows support stands on the `windows` branch, what was found on the way, and what's still to
decide. Nothing here is released: the branch isn't merged, and side-panel chats stay off on Windows until
Tim decides how they're fenced (see [The sandbox](#the-sandbox)).

Everything marked **seen** was seen passing on GitHub's `windows-latest` runners (Windows Server 2025,
build 26100; an administrator account, UAC off), not on a person's Windows 11 laptop. Nobody has yet used
this on a real Windows desktop: see [Not seen yet](#not-seen-yet).

- [What works](#what-works)
- [How it's tested](#how-its-tested)
- [The survey](#the-survey): every macOS assumption, the plan, the test
- [The sandbox](#the-sandbox): what a Mac guarantees, what Windows can, the prototype, the recommendation
- [Decisions for Tim](#decisions-for-tim)
- [What's left](#whats-left)

## What works

| | On Windows now | Seen |
|---|---|---|
| `npx timsrobot setup` | workspace `%USERPROFILE%\.trif`, the copy in `~\.trif\app`, wrappers, native host manifests, registry keys, `~\.trif\bin` on the user's Path | smoke test |
| Native messaging | Chrome, Chromium, Edge, Brave, Firefox keys under `HKCU\Software` | Chrome for Testing: browser check. Firefox, Edge, Brave: the keys are written and read back; see below for which were tried in a real browser |
| The helper | started by the browser through `trif-host.bat`; ends when the browser closes its end | browser check |
| The extension | loads unpacked, its service worker connects, hello with version and browser | browser check |
| `trif` CLI | `trif.cmd` (Command Prompt, PowerShell), `trif` (Git Bash); talks to the helper over a named pipe | smoke test, browser check |
| `trif doctor` | wrappers, manifests, registry keys, helper, extension | smoke test, browser check |
| API keys | Windows Credential Manager, never in argv or the environment | smoke test (a decision for Tim: [Keys](#keys-and-secrets)) |
| Updates | unpacked with System32's `tar.exe`; `~\.trif\app` swapped with retries | unit tests with stand-ins only |
| Mods | scanned, sent, held, switched, as elsewhere | unit tests |
| Chats from the panel, `trif agent run`, logging in from the panel | **off**: the panel and doctor say so | unit tests |

A profile folder with a space, letters outside ASCII and a `%` in it (`C:\Users\Zoë 用户 100%`) works
end to end: setup, the wrappers, the registry, the Path, a real browser starting the helper (**seen**).

## How it's tested

There's no Windows computer here, so everything runs on GitHub Actions (`.github/workflows/`):

- **`windows.yml`** (pushes to `windows`, and by hand), Node 18 and 22:
  - the unit tests. `tests/windows.test.js` runs Windows' own code paths (on any system, with stand-ins
    for reg.exe and PowerShell; on Windows with real named pipes). Tests that can't run on Windows yet are
    skipped one by one, each with its reason, from `tests/windows-skips.json`
    (`tests/on-windows.js`); a few files are still skipped whole (`tests/posix-only.js`).
  - **`tests/windows-smoke.js`**: a real setup in a scratch profile (real HKCU keys, the real user Path,
    real Credential Manager), the helper started the way Chrome starts it (`cmd.exe /d /c trif-host.bat`),
    `trif.cmd status` and `doctor` over the pipe, a key saved and read back, the helper ending with its
    stdin.
  - **`tests/windows-browser.js`** (Node 22): Chrome for Testing, headless, loads the unpacked extension
    setup copied; the extension's service worker calls `connectNative`; Chrome finds the manifest through
    the registry and runs `trif-host.bat`; `trif.cmd status` shows the extension's hello; a page command
    goes helper → extension → helper; the browser quits and the helper goes with it. Twice: a plain
    profile folder, and one with letters outside ASCII.
- **`windows-fence.yml`**: the sandbox prototype (`tests/windows-fence/`), below.
- **`test.yml`** (every push, macOS): the unit suite as before. One test there fails now and then on main
  too, on timing (`tests/clickjack-browser.test.js`, "a press: 6.00 ms on average"): not Windows' doing.

## The survey

For each assumption: what macOS (and Linux) does, what Windows does on this branch or the plan, and how
it's tested. "Phase 1" is the Windows work from 0.2.0 that this branch carried forward onto 0.3.

### Paths and the home folder

| Assumption | Windows | Test |
|---|---|---|
| The workspace is `~/.trif`; `os.homedir()` reads `HOME` | `%USERPROFILE%\.trif` (`os.homedir()` reads `USERPROFILE`); `~\` expands too | windows.test.js; smoke |
| The private folder (settings, logs, run logs, screenshots) is `~/Library/Application Support/TRIF` | `%LOCALAPPDATA%\TRIF` (per user, not roamed) | windows.test.js; smoke |
| Runs' mailboxes and working folders are in `~/Library/Caches/TRIF/boxes` | not built (no runs): `%LOCALAPPDATA%\TRIF\boxes` when they are; `runs.js boxRoot` still says `~/.cache` | none yet |
| `/tmp`, `$TMPDIR`, `/tmp/claude-<uid>` | not built (no runs): `runs.js runLimits`, `shortTmp` and `systemTemp` are macOS/Linux | none yet |
| `~/.webmods` (before 0.2.0), the link left behind | never existed on Windows: no legacy wrappers, nothing to move | windows.test.js |
| `path.sep` is `/` in messages and tests | the helper prints paths as Windows writes them; mod ids keep `/` (`x.com/detox-timeline`) | unit tests on Windows |
| `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` for finding agents | `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`, WinGet's links, Scoop's shims, pnpm's and Volta's folders; `.exe` before `.cmd` | windows.test.js |

### File modes, permissions, who can read what

| Assumption | Windows | Test |
|---|---|---|
| `0600`/`0700` keep other users out of the private folder, the sockets, the token files | modes do nothing on Windows. What keeps other users out is the profile folder's own access list (the user, SYSTEM, Administrators), which `%LOCALAPPDATA%` and `~\.trif` inherit. Nothing is checked or tightened by TRIF | not tested: a decision ([Keys](#keys-and-secrets)) |
| `chmod +x` makes a wrapper runnable | a `.bat`/`.cmd` runs by its name; doctor checks it's a file | windows.test.js |
| `O_NOFOLLOW` when the CLI writes a file (`trif screenshot -o`), in `stage.js` reads | the constant is missing on Windows (the flag is silently dropped). `stage.js` also checks the real path afterwards, which holds; `cli.js`'s write doesn't | **left**: matters once runs exist |
| `process.umask` before `listen` | no effect; pipes have their own security (below) | — |
| `process.getuid()` | not there on Windows: `runs.js` guards it; `browsers.js legacySafariAgentLoaded` is macOS only | unit tests |

### Links

| Assumption | Windows | Test |
|---|---|---|
| Symlinks need no privilege | making one needs Developer Mode or an administrator; **junctions** (folders) need nothing, and Node's `lstat` calls them symbolic links, so every "is it a link" check in `mods.js`, `runs.js`, `stage.js` sees them | fence probe: a junction made inside the fence can't be read through (**seen**) |
| Hard links: `st.nlink > 1` refused in `stage.js` | works the same on NTFS | fence probe: a hard link to a file the run can't read can't be made (**seen**) |
| `/usr/local/bin/trif` → the wrapper | no link: `~\.trif\bin` goes on the user's Path (`HKCU\Environment`, kept `REG_EXPAND_SZ`) | windows.test.js; smoke |
| Setup links to a git checkout (`--link`) | works: the wrappers name the checkout | windows.test.js |

### Case, odd names, encodings, line endings

| Assumption | Windows | Test |
|---|---|---|
| APFS ignores case; checked per volume | NTFS too; `pathcheck.js` also ignores the drive letter's case and the `\\?\` prefix | windows.test.js (real NTFS on the runner) |
| A path is one spelling | Windows has several for one file: 8.3 names (`C:\Users\RUNNER~1`), trailing dots and spaces, `file::$DATA` streams, device names (`CON`, `NUL`). `pathcheck.js winOddPath`: a path with any of those isn't inside anything; real paths come from `realpathSync.native`, which writes 8.3 names out in full (the JavaScript `realpathSync` doesn't: the test helpers had to change) | windows.test.js |
| Everything is UTF-8 | three places weren't, each **found and fixed here**: (1) `cmd.exe` reads a `.bat` in the console's code page, so the wrappers now name their files from `%~dp0` and stay ASCII; (2) `reg.exe query` prints in the console's code page, so values are read from a `reg.exe export` (UTF-16); (3) PowerShell reads its stdin in the console's code page, so what TRIF sends it is ASCII JSON with `\u` escapes | windows.test.js; smoke and browser check in `Zoë 用户 100%` (**seen**). On the runner a UTF-8 `.bat` happened to work as it was (its console is UTF-8); that's not so on a Western or Japanese Windows, hence (1) |
| LF line endings; shipped mods' sha1s recorded | `.gitattributes`: `* text=auto eol=lf`, so a checkout on Windows matches; a mod saved with CRLF by an editor parses (the header reader takes `\r\n`) | CI checks no CRLF after checkout |
| Mod and site folder names are anything a file system takes | Windows can't make a name with `< > : " / \ | ? *` or a control character; a site folder like `localhost:3000` can't exist there | hardening.test.js runs the names Windows can make |

### Native messaging

| Assumption | Windows | Test |
|---|---|---|
| A browser finds the host's manifest in a folder (`…/NativeMessagingHosts/`) | through the registry: `HKCU\Software\<browser>\NativeMessagingHosts\com.webmods.helper`, default value = the manifest's full path. Manifests go in `%LOCALAPPDATA%\TRIF\NativeMessagingHosts\<browser>\`. Written with System32's `reg.exe` | windows.test.js; smoke; browser check |
| Chrome | `Google\Chrome` | **seen** in Chrome for Testing 157 (which reads Chrome's or Chromium's key: setup writes both) |
| Edge | `Microsoft\Edge` (Edge also falls back to Chromium's and Chrome's) | key written and checked by doctor; in a real Edge: see the run linked in the report |
| Brave | its own `BraveSoftware\Brave-Browser`, and Chrome's when that's free (other software registers Brave under Chrome's key on Windows; no source says Brave reads its own) | as Edge |
| Firefox | `Mozilla` | key written and checked (**seen**); not yet in a real Firefox (the signed add-on is needed, or a temporary install) |
| Arc, Safari | not on Windows | — |
| The manifest's `path` is the wrapper | `trif-host.bat`; the browser runs it through `cmd.exe /d /s /c`, with the origin and `--parent-window=` as arguments (ignored). `@echo off` first: anything cmd printed would land in the stream | smoke; browser check |
| Which browser started the helper: the parent process (`ps`) | the parent is `cmd.exe`, and there's no `ps`: the name comes from the extension's own hello (Chrome and Edge and Brave name themselves) | **left**: read the grandparent through PowerShell if a browser needs telling apart |

### Starting programs

| Assumption | Windows | Test |
|---|---|---|
| `#!/bin/sh` wrappers, `exec node` | `trif-host.bat`, `trif.cmd`, and an extensionless `trif` sh script for Git Bash. No `.ps1` (the default execution policy refuses scripts) | windows.test.js; smoke |
| `spawn('claude')` runs a script | npm's `claude.cmd`/`codex.cmd` can't be spawned without a shell (Node refuses since 18.20). Agents are found by extension, `.exe` first; a `.cmd` has to go through `cmd.exe /d /s /c` with cmd's own quoting | **left** (no runs): `tests/windows-fence/agents.js` does it that way and it works (**seen**, Claude Code 2.1.325 and Codex 0.169 from npm) |
| Process groups (`detached`, `kill(-pid)`), `SIGTERM` then `SIGKILL` | `taskkill /PID <pid> /T /F` (`platform.js killTree`); a job object would be better (the fence prototype uses one: what a command leaves behind ends with it, **seen**) | windows.test.js |
| The helper ends on `SIGTERM`/`SIGHUP` | there are none: it ends when the browser closes its stdin | smoke; browser check |
| A console program started from the helper stays invisible | every spawn passes `windowsHide`; a miss flashes a console window | read through; not seen on a desktop |
| `tar`, `zip`, `unzip`, `ditto` on PATH | updates use `%SystemRoot%\System32\tar.exe` (Windows 10 1803+). `zip`/`ditto` are only in the build and release scripts | update tests (stand-ins) |
| Programs are found on PATH | Windows' own tools are always run by full path under `%SystemRoot%` (`reg.exe`, `powershell.exe`, `taskkill.exe`, `explorer.exe`, `notepad.exe`, `clip.exe`, `rundll32.exe`): never whatever comes first on the PATH the browser gave the helper | windows.test.js |

### The CLI and the helper

| Assumption | Windows | Test |
|---|---|---|
| Unix sockets `~/.trif/helper.sock`, `helper-<pid>.sock`, `0600` | named pipes. Each helper listens on `\\.\pipe\trif-<32 random hex>` and writes the name into `~\.trif\helper-<pid>.pipe`; the default helper is the one `helper.pipe` names (made with `O_EXCL`; a stale one replaced). Random names because pipe names are shared by every user of the computer; Node makes the pipe as its first instance with Windows' default security: only the user (and SYSTEM, Administrators) may write | windows.test.js (real pipes on Windows, two real helpers); smoke |
| A run's `trif` reaches the helper through its mailbox (files), never a socket | the same on Windows when runs exist. Until then: **any program of the user's can drive the helper through the pipe**, as on a Mac | fence probe: from inside the fence the pipe can't be opened (**seen**) |
| Lock files (`lock.js`: `wx`, the pid inside, `kill(pid, 0)`) | work the same | unit tests |
| A file can be renamed while open | not on Windows (antivirus, the indexer, an Explorer window): `renameRetry` for the app folder swap; `stage.js` and `update.js setConfigKey` rename without retries | **left**: retries wherever a rename replaces a file |

### Opening things

| Assumption | Windows | Test |
|---|---|---|
| `open <url>` | `rundll32 url.dll,FileProtocolHandler` (not `cmd /c start`: `&` in a URL) | windows.test.js |
| "Show in Finder": `open -R` | `explorer.exe /select,"<path>"` by full path, the path quoted Explorer's way | reveal.test.js; not seen on a desktop |
| "Open in editor": `open <file>` (the default app) | **Notepad, never the default app.** A `.js` file's default app on Windows is Windows Script Host: "Open in editor" would have *run the mod* on the computer, outside any browser. **Found and fixed here** | reveal.test.js |
| The folder chooser: `osascript` | Windows' folder browser from Windows PowerShell; the prompt on stdin, the answer back as UTF-8, in front of the browser | share.test.js with a stand-in; **not seen on a desktop** |
| `pbcopy` | `clip.exe` (UTF-16 with a byte order mark) | windows.test.js |
| Setup opens `chrome://extensions` in Chrome | not on Windows: setup shows the extension folder in Explorer and says what to do | windows.test.js |

### Keys and secrets

| Assumption | Windows | Test |
|---|---|---|
| The login Keychain through `/usr/bin/security` (the key on stdin as hex) | **Windows Credential Manager**: one generic credential per key (`TRIF API key/anthropic`), read and written through `CredReadW`/`CredWriteW` from a constant C# snippet in Windows PowerShell; the key goes in on stdin and comes back on stdout as hex, never in argv or the environment. 2560 bytes at most | windows.test.js (stand-in); smoke (the real one, **seen**) |
| Reading a Keychain item TRIF made doesn't ask | Credential Manager never asks: **any program running as the user can read any generic credential**. On a Mac another program reading TRIF's item gets a prompt. That's a weaker promise, and it's Windows' own: see [Decisions](#decisions-for-tim) | — |
| The key proxy on `127.0.0.1` adds the key; the agent never has it | the same code. What keeps a run's commands from the proxy on a Mac is "no network" in their sandbox: on Windows that's the fence's job | fence probe: no connection to `127.0.0.1` from inside (**seen**) |
| Other programs can read a process's argv and environment (`KERN_PROCARGS2`) | on Windows too (the command line with `PROCESS_QUERY_LIMITED_INFORMATION`, the environment by reading the process's memory). TRIF's rule stays: no secret in argv or the environment | fence probe: from inside the fence another program's command line can't be read (**seen**) |
| Release signing keys in the Keychain | release stays on the Mac | — |

### Login items, updates

| Assumption | Windows | Test |
|---|---|---|
| A LaunchAgent for the Safari bridge | Safari only: nothing on Windows. TRIF installs nothing that starts at login there | windows.test.js |
| Updates: download, check against the signed feed, unpack, swap `app`, run the new setup with `--no-link` | the same; `--no-link` leaves the user's Path alone | update tests (stand-ins); **left**: a real update on Windows from a real feed |
| The mods feed (0.3.1) | plain files and https: nothing Windows-specific found | modsfeed.test.js runs on Windows |

### The agents

| Assumption | Windows | Test |
|---|---|---|
| Claude Code's sandbox (Seatbelt) confines a run's commands | **Claude Code has no sandbox on native Windows** (its docs: "On native Windows, Claude Code runs commands unsandboxed"; with `failIfUnavailable`, which TRIF sets, it exits at startup) | see [The sandbox](#the-sandbox) |
| Codex's sandbox (Seatbelt) with TRIF's permission profile | Codex has three on Windows; **only the two that need something from the user can take TRIF's profile** | agents.js (**seen**); see [The sandbox](#the-sandbox) |
| Claude Code's managed settings: `/Library/Application Support/ClaudeCode`, MDM plists | Windows keeps them elsewhere (`C:\Program Files\ClaudeCode\managed-settings.json`, policies in the registry). `claude-managed.js` doesn't look there | **left**: before runs ship |
| Codex reads the key proxy's token with `/bin/cat` | no `/bin/cat`: `cmd.exe /d /c type`, or node | **left**: before runs ship |
| Logging in from the panel (`BROWSER=/usr/bin/true`) | off with runs | — |
| Path rules for Claude Code are `//` + a POSIX path | Windows paths in rules need their own spelling | agents.js explores it; **left** |

### The extension

Almost nothing in it knows the system. `IS_MAC` picks "Show in Finder" or "Show in folder". The panel
shows the helper's `runsOff` notice when the helper sends one. A few texts name Mac things and read wrong
on Windows (`~/.trif/bin/trif doctor` on the setup page): they're listed in `docs/WINDOWS-STRINGS.md`
and left as they are.

### The tests

- 60 test files. On Windows 19 were skipped whole (Phase 1); now their tests run except the ones named
  in `tests/windows-skips.json`, each with a reason. The numbers are in the report.
- The helpers had Unix in them: `tempDir` (now the native real path), the fake extension's sockets (now
  pipes on Windows), stand-ins written as `#!/bin/sh` scripts (the reveal stub is a `.js` now; the fake
  agents and the fake keychain still are: their tests stay skipped until runs exist).
- The real-browser unit tests (`tests/cdp-page.js`: `nice`, `ps`, `pkill`) start their browser on Windows
  now, without the memory watchdog (CI only).
- `tests/e2e` (the big suite) is macOS only: `ps`, `~/Library`, the TCC log, Firefox's and Chrome's Mac
  paths. `tests/windows-browser.js` is the Windows stand-in for its first steps. **Left**: the suite
  itself on Windows.

### The release scripts

`scripts/release.js` is a Mac program (the Keychain, `ditto`, `zip`, `security`) and stays one: releases
are made on Tim's Mac. What a release ships decides Windows, though:

- `package.json` `"os"` now lists `win32` (Phase 1). Once that's in a release, `npx timsrobot setup`
  runs on Windows. **Until Tim says so it shouldn't be merged.**
- The beta zips' `START HERE.txt` is written for Terminal on a Mac.
- `scripts/build-extension.js` needs `zip`; a Windows checkout can't build the Firefox add-on.

