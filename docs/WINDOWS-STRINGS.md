# Windows: strings awaiting Tim

Every text a person can read that the `windows` branch adds or changes, with where it shows, and after
them the existing texts that read wrong on Windows and were left alone. None is approved. (The extension
itself is unchanged on this branch: every text here comes from the helper, setup, the CLI or the README.) Text only
coding agents read (guides, the fence prototype's messages, test output) isn't here.

`<…>` is filled in when the text is shown.

## New: side-panel chats on Windows

Chats run with Claude Code and, since round 4 of the work, Codex (fenced: docs/WINDOWS.md). What a person can read about it:

| # | Text | Where |
|---|---|---|
| 1 | `<Agent> can’t be used from the panel on Windows yet` | `trif doctor`, an information line for an agent that's installed but that TRIF can't fence there (the open model), followed by its path in brackets (`helper/lib/platform.js` `panelRunsOff`) |
| 2 | `TRIF can’t keep <Agent>’s commands to the site you’re fixing on Windows yet. Use another coding agent here, or <Agent> in a terminal in <workspace>: mods it writes show up here as usual.` | the side panel, under the existing title "<Agent> isn’t available", when that agent is the one picked; Settings' agent list |
| 3 | `<Agent> can't be used from the panel on Windows yet: TRIF can't keep its commands to the site there. Use another coding agent, or <Agent> in a terminal in <workspace>` | the error if a chat with that agent is started anyway (`trif agent run --agent codex`) |
| 4 | `logging in from the panel isn't available on Windows yet: open a terminal in <workspace>, start your coding agent there and log in` | the error from the panel's Log in button and `trif agent login` on Windows |
| 5 | `the fence for chats from the panel can be built here (Windows' C# compiler)` | `trif doctor` on Windows, an ok line |
| 5b | `Windows' C# compiler (csc.exe, part of .NET Framework 4) isn't on this computer, so chats from the panel can't start: TRIF builds its fence for them with it` — fix: `turn on ".NET Framework 4.8 Advanced Services" in "Turn Windows features on or off"` | `trif doctor` on Windows, a warning |
| 5c | `couldn't prepare Claude Code's run: TRIF's fence for this run couldn't be made (<why>)` | the chat, when the fence can't be made (the first half is an existing text) |
| 5d | `couldn't prepare Claude Code's run: Windows' C# compiler (csc.exe, part of .NET Framework 4) isn't on this computer, so TRIF can't build its fence for agent runs` · `… couldn't build TRIF's fence for agent runs: <why>` | the chat, when the launcher can't be built |

(1–3 name the agent the message is about by its own name, as TRIF's messages about agents already do, and no other agent: 2 and 3 say "another coding agent". Now that Codex runs fenced, the open model is the only agent they're shown for, so `<Agent>` is always its name there, "Open model (via Codex)": "Open model (via Codex) can’t be used from the panel on Windows yet", "TRIF can’t keep Open model (via Codex)’s commands to the site…". They go altogether if the open model's runs get fenced. 5c and 5d start with an existing text that names the run's agent: "couldn't prepare Codex's run: …" in a chat with Codex.)

What the agent reads, not the user: the `trif` tool's description and the file tools' (`helper/mcp.js`), the
"There is no shell in this chat…" line added to a run's context on Windows (`helper/lib/agents/index.js`),
doctor's line inside a run ("the workspace … and its wrappers aren't checked"), and the words the file tools
use for a refusal (`helper/lib/win/fenced-files.js`). Not listed here.

## New: `trif setup` on Windows

| # | Text | Where |
|---|---|---|
| 6 | `CLI wrapper   <trif.cmd> -> <cli.js> (and trif for Git Bash)` | setup, with `--verbose` |
| 7 | `              registered: <registry key>, <registry key>` | setup, with `--verbose`, under each browser's native host line |
| 8 | `native host   <browser>: FAILED: couldn't write the registry key <key>: <reg.exe's words>` | setup, when a key can't be written |
| 9 | `PATH          added <~\.trif\bin> to your PATH (open a new terminal to use trif)` | setup |
| 10 | `PATH          <~\.trif\bin> is on your PATH (open a new terminal to use trif)` | setup, when it was added before but this terminal doesn't have it |
| 11 | `PATH          <~\.trif\bin> is not on your PATH (left alone: --no-link). Run setup without --no-link to add it.` | setup `--no-link` |
| 12 | `PATH          couldn't add <~\.trif\bin> to your PATH: <why>` / `              Add it yourself: Settings → System → About → Advanced system settings → Environment Variables.` | setup, when the Path can't be changed |
| 13 | `     open chrome://extensions and turn on "Developer mode" (top right), then drag the "extension"` / `     folder from the Explorer window that just opened onto that page. If dragging doesn't work,` / `     click "Load unpacked", click the address bar and paste the folder's path` / `     (it's on your clipboard): <folder>` | setup's next steps, step 1, on Windows (the Mac's says Finder and Cmd-Shift-G) |
| 14 | `Check everything with: "<full path to trif.cmd>" doctor` | setup's next steps when `trif` isn't on the Path yet (the Mac's says `~/.trif/bin/trif doctor`) |
| 14b | **changed** on Windows: `browsers      no browser profile folder found; installing for Google Chrome and Microsoft Edge anyway` (elsewhere still `… installing for Google Chrome anyway`) | setup, when no browser's profile folder is found: on Windows it now sets up Edge as well as Chrome (11-20, Edge in the tests) |

## New: `trif doctor` on Windows

| # | Text | Where |
|---|---|---|
| 15 | `` `trif` is not on your PATH `` — fix: `run: npx timsrobot setup (or: trif setup) (it adds <~\.trif\bin> to your PATH), then open a new terminal` | doctor, a warning |
| 16 | `helper isn't running (<helper.pipe> names a pipe nothing is listening on)` | doctor |
| 17 | `helper isn't running (no <helper.pipe>)` | doctor |
| 18 | `the registry key <key> is missing, so <browser> can't find the helper` | doctor, inside "<browser>: native host manifest <file>: …" |
| 19 | `the registry key <key> points at <value>, not <file>` | the same |
| 20 | `the registry key <key> is missing (<browser> may read that one too)` / `… points at <value> (<browser> may read that one too)` | the same, for Brave's second key |

## New: keys

| # | Text | Where |
|---|---|---|
| 21 | `Windows Credential Manager` | wherever the keyring is named: `trif agent key`, `trif agent open-model`, doctor ("an Anthropic API key is saved in Windows Credential Manager (not shown)…"), the panel's Settings |
| 22 | `couldn't read the key from Windows Credential Manager: <why>` · `couldn't check Windows Credential Manager: <why>` · `couldn't save the key in Windows Credential Manager: <why>` · `couldn't remove the key from Windows Credential Manager: <why>` | the same places, on failure |
| 23 | `that key is too long for Windows Credential Manager (2560 bytes at most)` | saving a key |
| 24 | **changed**: `… a system keyring to keep the API key in (the macOS Keychain, Windows Credential Manager, or a Secret Service on Linux)` (was: `(the macOS Keychain, or a Secret Service on Linux)`) | when there's no keyring at all (never on a Mac or Windows) |

## New and changed: README.md

| # | Text | Where |
|---|---|---|
| 25 | **changed**: `- A Mac (or Linux, or Windows 10/11: see [Windows](#windows)).` (was: `- A Mac (or Linux). Windows isn't supported yet.`) | What you need |
| 26 | a new section, `### Windows`: "TRIF's extension, helper and `trif` command work on Windows 10 and 11, in Chrome, Edge, Brave and Firefox: run `npx timsrobot setup` in a terminal (PowerShell or Command Prompt), then follow its next steps (the extension folder is `%USERPROFILE%\.trif\app\extension`). Setup adds `~\.trif\bin` to your PATH: open a new terminal afterwards to use `trif`. Chats from the side panel work with Claude Code and Codex. On Windows TRIF gives them no shell: they change mods with file tools and run TRIF's commands through a tool of TRIF's, inside a fence TRIF builds on your computer the first time (with the C# compiler that comes with Windows). Log in to your coding agent in a terminal first (`claude`, then `/login`; or `codex login`): logging in from the panel isn't there on Windows yet. Open models can't be used from the panel on Windows yet; in a terminal in `~\.trif` they work as anywhere. API keys you save with `trif agent key` go to Windows Credential Manager." | after Safari's section. (Changed in round 4, when Codex's chats were switched on: the three sentences from "Chats from the side panel" to "work as anywhere"; before, they were about Claude Code alone and said Codex couldn't be used from the panel.) |
| 27 | **changed**: `(on Linux, ~/.local/state/trif; on Windows, %LOCALAPPDATA%\TRIF, and the registry keys named com.webmods.helper under HKEY_CURRENT_USER\Software\…\NativeMessagingHosts);` | Uninstalling |

## Behaviour a person sees, without new words

- **"Open in editor"** (the code card's menu, `trif reveal --editor`) opens the mod in **Notepad** on
  Windows, not in the `.js` file's default app (Windows Script Host, which would run it). The label stays
  "Open in editor". If Tim would rather have Windows' "Open with" chooser, or a setting, that's a choice.
- **"Show in folder"** (already the non-Mac label) opens Explorer with the file selected.
- The **folder chooser** for exports is Windows' own folder browser, titled with the existing prompt
  (`Where should TRIF save “<mod>”?`).
- `trif reveal` prints `showed <file> in its folder` (the existing non-Mac wording).

## Existing texts that read wrong on Windows (not changed)

| Text | Where | What's off |
|---|---|---|
| `Already set up? Run ~/.trif/bin/trif doctor to see what's wrong.` | the setup page, when the helper isn't connected (`extension/onboarding.js`) | on Windows it's `%USERPROFILE%\.trif\bin\trif doctor` (or `trif doctor` in a new terminal) |
| `Applies from your next message, here and in Claude Code in ~/.trif.` | Settings, under the instructions box (`extension/sidepanel.html`, `sidepanel.js`) | `~/.trif` isn't how Windows writes it |
| `private folder (settings, logs, screenshots; ~/Library/Application Support/TRIF on a Mac …` and `symlinks /usr/local/bin/trif when that folder is writable`, `--no-link skips the /usr/local/bin link`, `--bin-dir DIR` | `trif help setup` (`helper/lib/help.js`) | Mac and Linux only; Windows' private folder and Path step aren't mentioned |
| `Default path: screenshots/<time>.png in TRIF's private folder (on a Mac, ~/Library/Application …` | `trif help screenshot` | no Windows path |
| `Codex isn't installed, or the helper can't find it. Install it (npm install -g @openai/codex), then run trif setup in the same terminal so the helper finds it.` and `… update it (brew upgrade codex, or npm install -g @openai/codex)` | the panel and doctor (`helper/lib/agents/codex.js`) | `brew` isn't on Windows |
| `No coding agent found: install Claude Code (https://claude.com/claude-code) or Codex, then run setup again.` | setup | fine on Windows; listed because it's the line a Windows user is likeliest to see first |
| `open chrome://extensions …`, `Turn on "Allow User Scripts": click "Open TRIF’s Chrome settings" on the TRIF tab Chrome opens, or "Details" on TRIF in chrome://extensions.`, doctor's `fix: open chrome://extensions/?id=…`, `reload TRIF on chrome://extensions` | setup's next steps, doctor, the helper's errors (`helper/lib/setup.js`, `doctor.js`, `host.js`) | in Edge it's `edge://extensions`, and Developer mode is in the left-hand column, not "top right". Edge takes `chrome://` addresses and opens its own page, so the steps still work; they just name Chrome |
| `Waiting for Chrome: drag the folder onto chrome://extensions…` | setup's wait, after `--browser chrome,edge` (`helper/lib/setupwait.js` names the first Chromium browser set up) | someone using Edge reads "Chrome"; the wait itself sees Edge's hello all the same |
| `beta/chrome/START HERE.txt`, `beta/firefox/START HERE.txt` | the beta zips | written for Terminal on a Mac ("Open Terminal and paste these two lines") |
