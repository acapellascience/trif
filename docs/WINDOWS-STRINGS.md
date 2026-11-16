# Windows: strings awaiting Tim

Every text a person can read that the `windows` branch adds or changes, with where it shows, and after
them the existing texts that read wrong on Windows and were left alone. None is approved. Text only
coding agents read (guides, the fence prototype's messages, test output) isn't here.

`<…>` is filled in when the text is shown.

## New: side-panel chats are off on Windows

These all go when chats are fenced and switched on; until then they're what a Windows user sees.

| # | Text | Where |
|---|---|---|
| 1 | `Chats from the panel aren’t available on Windows yet` | the side panel: the notice's title, and the status dot's tooltip (`helper/lib/platform.js` `panelRunsOff`, shown by `extension/sidepanel.js`) |
| 2 | `Use your coding agent in a terminal instead: open one in <workspace> and ask it there. Mods it writes show up here as usual.` | the side panel: the notice's text |
| 3 | `chats from the panel aren't available on Windows yet: use your coding agent in a terminal, in <workspace>` | `trif agent run`'s error; the panel's error if a chat is started anyway |
| 4 | `… (log in there too)` added to 3 | logging in from the panel, `trif agent login` |
| 5 | `Chats from the panel aren’t available on Windows yet: use your coding agent in a terminal, in <workspace>` | `trif doctor`, an information line in place of the agent checks |

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
| 25 | **changed**: `- A Mac (or Linux, or Windows 10/11 without chats from the side panel yet: see [Windows](#windows)).` (was: `- A Mac (or Linux). Windows isn't supported yet.`) | What you need |
| 26 | a new section, `### Windows`: "TRIF's extension, helper and `trif` command work on Windows 10 and 11, in Chrome and Firefox: run `npx timsrobot setup` in a terminal (PowerShell or Command Prompt), then follow its next steps (the extension folder is `%USERPROFILE%\.trif\app\extension`). Setup adds `~\.trif\bin` to your PATH: open a new terminal afterwards to use `trif`. What's missing for now: **chats from the side panel**. TRIF only runs your coding agent from the panel where the agent's commands can be kept to the site you're fixing, and on Windows neither Claude Code nor Codex can do that for TRIF yet. Use your agent in a terminal instead: open one in `~\.trif`, start Claude Code or Codex there, and ask it to fix a site; it reads `AGENTS.md`, and the mods it writes show up in the panel as usual. API keys you save with `trif agent key` go to Windows Credential Manager." | after Safari's section. (It said `npx trif setup`: `trif` on npm is someone else's package, so that's fixed here to `npx timsrobot setup`.) |
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
| `Applies from your next message, here and in Claude Code in ~/.trif.` | Settings, under the instructions box (`extension/sidepanel.html`, `sidepanel.js`) | `~/.trif` isn't how Windows writes it; "here" isn't true while chats are off |
| `private folder (settings, logs, screenshots; ~/Library/Application Support/TRIF on a Mac …` and `symlinks /usr/local/bin/trif when that folder is writable`, `--no-link skips the /usr/local/bin link`, `--bin-dir DIR` | `trif help setup` (`helper/lib/help.js`) | Mac and Linux only; Windows' private folder and Path step aren't mentioned |
| `Default path: screenshots/<time>.png in TRIF's private folder (on a Mac, ~/Library/Application …` | `trif help screenshot` | no Windows path |
| `Codex isn't installed, or the helper can't find it. Install it (npm install -g @openai/codex), then run trif setup in the same terminal so the helper finds it.` and `… update it (brew upgrade codex, or npm install -g @openai/codex)` | the panel and doctor (`helper/lib/agents/codex.js`) | `brew` isn't on Windows |
| `No coding agent found: install Claude Code (https://claude.com/claude-code) or Codex, then run setup again.` | setup | fine on Windows; listed because it's the line a Windows user is likeliest to see first |
| `beta/chrome/START HERE.txt`, `beta/firefox/START HERE.txt` | the beta zips | written for Terminal on a Mac ("Open Terminal and paste these two lines") |
