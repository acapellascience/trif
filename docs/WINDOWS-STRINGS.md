# Windows: strings awaiting Tim

Every text a person can read that the `windows` branch adds or changes, with where it shows, and after
them the existing texts that read wrong on Windows and were left alone. None is approved. (Every text here
comes from the helper, setup, the CLI or the README, but for the phone link's firewall note, 40, in the
extension.) Text only
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

## New: the phone link on Windows (11-23)

The phone link and phone sync are on on Windows, as on the Mac: Settings' **Connect a phone**, the phone
menu's **Sync with phone**. TRIF adds no firewall rule and asks for no administrator: Windows Defender
Firewall's own "Allow access?" for Node.js JavaScript Runtime comes up the first time the link listens (a
phone being connected, or one connected already). The announcer is TRIF's trif-dnssd.exe (Windows' DNS-SD
API), built like the fence.

| # | Text | Where |
|---|---|---|
| 40 | `Windows may ask whether Node.js can use the network: allow it on private networks, so your phone can reach this computer.` | Settings, under Connect a phone, while the code is on screen, on Windows only (`extension/phonelink.js` `TEXT.firewall`; also in docs/PHONE-LINK-STRINGS.md) |
| 41 | `phone link: Windows Firewall lets a phone reach this computer (Node.js is allowed on <private> networks)` | `trif doctor` on Windows while the link is on, an ok line (`helper/lib/win/firewall.js`) |
| 42 | `phone link: Windows Firewall blocks Node.js on this <private> network, so a phone can't reach this computer` — fix: `in Windows Security, Firewall & network protection, "Allow an app through firewall": tick Node.js JavaScript Runtime for Private (and make your home Wi-Fi a private network in Settings, Network & internet)` | the same, a warning (a Block rule: the prompt was cancelled, or Block chosen) |
| 43 | `phone link: Windows Firewall lets Node.js in on other networks, not this <public> one, so a phone can't reach this computer here` — fix: as 42 | the same, a warning |
| 44 | `phone link: Windows will ask whether Node.js can use the network the first time you connect a phone: allow it on private networks` | the same, an information line (no rule yet) |
| 45 | `phone link: this computer isn't on a network just now` · `phone link: couldn't read Windows Firewall's rules for Node.js (<why>)` | the same, information lines |
| 46 | `Windows' C# compiler (csc.exe, part of .NET Framework 4) isn't on this computer, so TRIF can't build its announcer` · `couldn't build TRIF's announcer: <why>` | the helper's log only (`phone link: can't announce, …`); the panel shows the existing `Your phone may not find this computer just now.` |

## New: no Node needed on Windows (drafts; docs/NO-NODE.md step 12)

Live on the branch, none approved. The install command and the texts around it, as the Mac's step-7 drafts in
`docs/NO-NODE-STRINGS.md` are; the Windows forms of the same sentences.

| # | Text | Where |
|---|---|---|
| 47 | `irm https://timsrobot.com/install.ps1 \| iex` | the install command on Windows (`extension/lib.js` `SETUP_COMMAND` when the browser says Windows; `helper/lib/paths.js` `WINDOWS_INSTALL_COMMAND`), inside the existing "Run `{SETUP_COMMAND}` in a terminal, then restart {browser}." lines: the panel's not-connected card and landing note, the setup page, the background's error. "in a terminal" stays (PowerShell is a terminal; the command only works there, not in Command Prompt) |
| 48 | `~\.trif\bin\trif.cmd setup` | Windows' `RESETUP_COMMAND`: "Install Claude Code, then run {it} from the same terminal." (panel) and "… Install one, then run {it} from the same terminal." (setup page). Named by its path because a terminal open since before setup doesn't have `~\.trif\bin` on its PATH yet; `.cmd` because the folder also holds `trif` for Git Bash, which PowerShell mustn't pick |
| 49 | README, Windows section: "In PowerShell, run:" + the command in a code block, then "then follow its next steps (the extension folder is `%USERPROFILE%\.trif\app\extension`). You don't need Node.js: this brings TRIF's own copy, kept in `~\.trif\runtime` and used only by TRIF. Already have Node 18 or newer? `npx timsrobot setup` does the same, in PowerShell or Command Prompt. Setup adds `~\.trif\bin` to your PATH: open a new terminal afterwards to use `trif`. `trif uninstall` takes TRIF off again (your mods and settings stay unless you add `--all`)." | `README.md` (replaces "run `npx timsrobot setup` in a terminal (PowerShell or Command Prompt), then follow its next steps …") |
| 50 | `Downloading Node <ver> for TRIF...` · `Downloading TRIF <version>...` · then setup's own output | install.ps1's progress (stderr), as install.sh's |
| 51 | each starts `TRIF install: `: `this installer is for Windows: on macOS or Linux, use install.sh` · `needs Windows' own tar.exe (Windows 10 1803 or newer)` · `there's no TRIF for Windows on <arch>` · `there's no TRIF for <win-arch>` · `refusing to download <url> (https only)` · `couldn't download <url>: <why>` · `the download of <file> doesn't match its pinned checksum (got <sha>); not using it` · `couldn't unpack <file>` · `the downloaded Node doesn't run on this computer (<what it said>)` · `couldn't unpack TRIF's package` · `TRIF's package has no helper in it` · `setup reported a problem (code <n>): see above.` | install.ps1's failures, in the PowerShell window (it never closes the window) |
| 52 | "Installs TRIF <version> on Windows 10 (1803 or newer) or 11, with no Node.js needed" + the two ways to run it (`irm <url> \| iex`, and `& ([scriptblock]::Create((irm <url>))) --browser edge` for setup's options) and what it does | install.ps1's header comment (anyone who opens the script before running it reads it) |
| 53 | `On Windows, in PowerShell: irm https://timsrobot.com/install.ps1 \| iex` (after the first line's parenthesis), and that command among the examples | `trif help setup` |
| 54 | `run: irm https://timsrobot.com/install.ps1 \| iex   (or: trif setup)` | doctor's fix for a broken install on Windows (not a git checkout); and `trif update`'s "…run \`<it>\` to install a copy that can update" there |
| 55 | `problem  couldn't take <bin> off your PATH (<why>); remove it in Settings → System → About → Advanced system settings → Environment Variables` · `problem  couldn't remove the registry key <key>: <why>` · with `--verbose`: `removed  <bin> (from your PATH)`, `removed  <key>`, `removed  <folder> (as this command ends)` | `trif uninstall` on Windows. (TRIF's own node.exe and trif.cmd are what the command runs from, so those folders, or with `--all` the whole workspace, go a moment after it ends, from a hidden Windows PowerShell; nothing is said about it beyond the verbose line) |

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
| `This computer’s name is too long for the code. Shorten it in System Settings, then try again.` | Settings, Connect a phone, when the computer's name is too long (`extension/phonelink.js` `tooLong`) | System Settings is the Mac's; on Windows it's Settings, System, About, Rename this PC |
| `beta/chrome/START HERE.txt`, `beta/firefox/START HERE.txt` | the beta zips | written for Terminal on a Mac ("Open Terminal and paste these two lines") |
| `Remove the TRIF extension from your browser too: chrome://extensions (Firefox: about:addons; Safari: delete TRIF.app).` | `trif uninstall`'s last line (no-node's) | on Windows there's no Safari, and Edge's page is `edge://extensions` (it opens `chrome://` too) |
| `Removed TRIF's helper, CLI and browser connections. Your mods (<home>) and settings (<private>) are still there…` | `trif uninstall` | fine on Windows; `<private>` is `%LOCALAPPDATA%\TRIF` there |
