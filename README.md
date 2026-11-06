# Tim's Robot Internet Fixer (TRIF)

Customize any website by asking your coding agent. Open the TRIF side panel in Chrome (or Firefox, or
Safari), say what you want ("hide the trending sidebar", "only show people I follow"), and your agent
writes a small mod that runs every time that site loads. Mods are plain JavaScript files on your computer; switch each one off
and on from the side panel.

TRIF uses the coding agent you already have (Claude Code or Codex), on your own account, or an open model
through Codex (experimental: see [Open models](#open-models-experimental)).
TRIF collects nothing: the only thing that ever reaches its developer is a problem report you choose to send.

**Beta.** Expect rough edges, and please send feedback.

**It used to be called WebMods.** Version 0.2.0 renamed it and moved some things. Updating moves your
mods to `~/.trif` (and leaves `~/.webmods` as a link to it, so keep that link), and TRIF's own settings,
logs and screenshots to `~/Library/Application Support/TRIF`, where your agent can't read them. The
command is now `trif` (`webmods` still works). In Chrome and Firefox the extension, its settings and your
switches stay as they were; in Safari, install the new TRIF.app (see Safari below).

## What you need

- A Mac (or Linux). Windows isn't supported yet.
- Google Chrome 138 or newer (or Firefox 153, or Safari 27.2: see below).
- Node 18 or newer: check with `node --version`, or install it from [nodejs.org](https://nodejs.org).
- A coding agent: [Claude Code](https://claude.com/claude-code) (you can log in from the side panel), or
  [Codex](https://github.com/openai/codex) 0.138 or newer (`brew install codex`, then `codex login` in a terminal).
  Pick one in the side panel's settings when you have both (each site's chat keeps its own choice of
  agent and model). If you use an Anthropic or OpenAI API key instead of logging in, save it with `trif agent key --agent claude --set-key` (or `--agent codex`):
  it's kept in your Mac's Keychain, and TRIF adds it to the agent's requests itself, so neither the agent
  nor its commands ever get it. (A key you put in TRIF's `config.json` before moves there by itself.)
  - Or an open model, on your computer or from a provider like OpenRouter, through Codex
    (experimental): see [Open models](#open-models-experimental).

## Install

1. **Install the helper.** In a terminal:

   ```sh
   npx timsrobot setup
   ```

   If you were sent a file (`timsrobot-0.2.4.tgz`) instead, run this from the folder it's in:

   ```sh
   npx --yes --package ./timsrobot-0.2.4.tgz trif setup
   ```

   npx asks once whether to install the `trif` package: type `y`. This creates `~/.trif` (your mods
   live in `~/.trif/sites`) and connects it to Chrome. It's safe to run again. On a Mac it then shows the
   extension folder in Finder and opens `chrome://extensions` in Chrome, and waits, saying as each of
   the next steps gets done (Ctrl-C skips that).

2. **Add the extension to Chrome.** On `chrome://extensions`, turn on **Developer mode** (top right),
   then drag the `extension` folder from the Finder window onto the page. (Or click **Load unpacked**,
   press ⌘⇧G and paste: setup put the folder's path, `~/.trif/app/extension`, on your clipboard.)

3. **Allow it to run mods.** On the **TRIF setup** tab that opens, click **Open TRIF’s Chrome
   settings** and turn on **Allow User Scripts**. Then click **Allow these sites**, so TRIF can work on
   the sites its mods are for (Chrome asks you once, for all of them), or **Not now**.

4. **Open the side panel.** Click the TRIF icon in the toolbar (pin it from the puzzle-piece menu). If
   it asks you to log in to Claude, click **Log in** and follow the steps.

### Firefox

TRIF also runs in Firefox 153 or newer. Open Firefox once before running `npx timsrobot setup`, so setup
finds it (or run `npx timsrobot setup --browser firefox`). If Firefox was open during setup, quit it
completely and reopen it. Then open
[trif-firefox.xpi](https://github.com/acapellascience/trif/releases/latest/download/trif-firefox.xpi)
in Firefox and click **Add** to install the add-on (if Firefox downloads it instead, drag the file onto
a Firefox window). On the TRIF tab Firefox opens, click **Allow user scripts** (the TRIF sidebar, from
its toolbar button, offers it too).

Chrome and Firefox can both be open: they share your mods, and each sidebar or side panel chat works
on its own browser. Switching a mod off is per browser.

### Safari (Mac, test builds)

TRIF runs in Safari 27.2 or newer on a Mac. It isn't available as a download yet: you build it from a
checkout of this repo, and until it's signed by Apple it only runs on the Mac it was built on. So for now
this is for trying it out:

1. From a checkout of this repo, `node scripts/build-safari.js` (needs Xcode) makes
   `dist/safari-app/TRIF.app`. Open it once: it adds the TRIF extension to Safari.
2. `npx timsrobot setup --browser safari` starts the Safari bridge, a small background program
   Safari's extension talks to (Safari can't start the helper itself the way Chrome does). It starts again
   whenever you log in.
3. In Safari: Settings → Advanced, tick "Show features for web developers"; Settings → Developer, tick
   "Allow unsigned extensions" (Safari turns this off whenever it quits); Settings → Extensions, tick
   TRIF and allow it on every website.
4. Click the TRIF toolbar button. Safari has no side panel, so the panel opens in a window of its own,
   following the tabs of the window you opened it from.

**Upgrading from WebMods in Safari:** do steps 1 to 3 with the new TRIF.app (the old WebMods app looks for
TRIF's key in the old place, so it can't connect any more). Safari sees TRIF as a new extension, so its
chats, switches and sites start over (your mods are still in `~/.trif/sites`). Then untick WebMods in
Settings → Extensions and delete the old WebMods app.

## Using it

- TRIF is off on every site until you turn it on there: the side panel says "The robot is off."
  and a "Fix <site>" button that turns it on. Until then nothing from TRIF runs on the site or reads
  it, not even a mod for all sites, and agents (in the panel or a terminal) can't touch its tabs. The
  power button at the top of the panel turns it back off.
- Turning TRIF on for a site is also when your browser asks you to let TRIF read and change that site:
  TRIF asks for no websites when you install it, and turning a site off gives its access back. If you
  take a site away in the browser's extension settings, TRIF is off there again, and the panel shows
  "Allow TRIF on <site>". (Installed TRIF before this? It keeps the access to all sites it had.) Safari
  asks per site itself.
- Go to a site, open the side panel, and tell it what to fix. The agent looks at the page,
  writes a mod, and reloads the tab so you can see it. Keep chatting to adjust it.
- Each mod has a switch in the side panel, so you can turn it off without deleting it. Its trash icon
  deletes it, leaving a line in the chat with an Undo; deleted mods stay in `~/.trif/trash` for 30 days (`trif restore`
  brings one back). A mod can run on
  several sites (a badge says how many): its switch in the side panel is for the site you're on, and
  the Setup page has a switch for the whole mod and one for each site.
- To change every site at once (dark mode everywhere, say), just ask. The mod waits for your **Allow**,
  like any side-panel mod that reaches beyond the site you're on.
- A side-panel agent can only touch the site you opened it on. If it writes a mod that would also run on
  other sites, or one that changes what the site receives, that mod waits for you to click **Allow**.
- Some mods are easier for a site to notice than others. A badge says so: **detectable** (for example, it
  hides ads, so they never report being seen) or **changes requests** (the site could see unusual
  traffic). The agent tells you before it builds anything in the second group.
- Standing instructions for your agent ("talk like a caveman", "don't bring up detectability") go in
  the box in the side panel's settings (the gear). Every chat reads them, and so does Claude Code when
  you run it in `~/.trif`. They're saved in `~/.trif/instructions.md`.
- Commands: `/model sonnet` (or `opus`, `haiku`, `default`) switches the model, `/clear` starts a new
  chat, `/compact` shrinks a long conversation, `/context` shows how full it is, `/help` lists these.

### Mods that come with it

TRIF starts on for Google, X, Amazon and Instagram, with these mods. Each has a switch in the side
panel on its site; the ones marked *(off)* wait for you to switch them on.

- **Google:** AI Banisher (no AI Overview, AI Mode or Gemini promo), Just Results (no sponsored results
  or extra sections), and DVD Logo *(off)*: the logo on the home page bounces around like an old DVD
  screensaver.
- **X:** **Detox Timeline**: Home is just the people you follow, newest first, with no ads or suggestions. It
  starts as plain as it gets (only original text posts from people who follow you back); the **Filters**
  menu turns each kind back on (reposts, quotes, replies, links, videos, images, non-mutuals…). It also hides the
  trends column, tidies post pages, and turns Explore into a plain search field. Punk Fonts *(off)* and
  Rainbow Rave *(off)*, for fun.
- **Amazon:** Simple Home (just a search box) and Simple Shopping (results show only picture, price and
  stars; no sponsored items, ads or recommendations).
- **Instagram:** Only Following (no suggested posts or ads), Hide Reposts, Hide AI, and
  Desaturate *(off)*: colours down to 35%.

## Open models (experimental)

Instead of Claude Code or Codex's own models, a chat can run on an **open model**: one on your own
computer, or one from a provider like OpenRouter, with your own key. It runs through Codex, so you need
Codex installed (`brew install codex`), but not an OpenAI account. In the side panel's Settings, pick
**Open model (via Codex)** as the agent, then where the model comes from, then the model. (From a
terminal: `trif agent open-model --provider ollama|lmstudio|openrouter|custom --model <name>`, and
`trif agent run --agent codex-oss "…"`.) It works within the same walls as any chat: only the site
you're on, no internet for its commands.

Be warned: small local models are much weaker at this kind of work than Claude Code or Codex. They
misread pages, skip checks and give up early. The bigger hosted ones (Qwen3-Coder, GLM, DeepSeek, Kimi)
do better.

**On your computer, with Ollama.** Nothing leaves your computer.

1. Install Ollama: `brew install ollama` (then `ollama serve`), or the app from [ollama.com](https://ollama.com).
2. Get a model: `ollama pull gpt-oss:20b` (about 14 GB; it wants about 16 GB of free memory, so a Mac
   with 32 GB). Others worth trying, if you have room: `qwen3-coder:30b`, `gpt-oss:120b` (big),
   `devstral`, `gemma4`. The panel lists what you've installed, these first.
3. In Settings: Open model (via Codex) → From: Ollama → Model.

**On your computer, with LM Studio.** Download a model in [LM Studio](https://lmstudio.ai) (gpt-oss 20B
is a good start), start its server (Developer tab, or `lms server start`), then pick LM Studio in Settings.

**OpenRouter** (or another provider). Make a key at [openrouter.ai](https://openrouter.ai). In
Settings pick From: OpenRouter, paste the key in the **API key** field and click **Save**, then pick a
model (the cheapest, gpt-oss-120b, cost under half a cent per message in testing; Qwen3-Coder 480B about
5 cents). From a terminal: `trif agent open-model --provider openrouter --set-key` (it asks for the key
without showing it, or reads it from stdin; `--remove-key` removes it).

The key is kept in your Mac's **Keychain** (on Linux, your keyring, through `secret-tool`), and nowhere
else: not in TRIF's files, not in the extension. Before each chat the helper reads it and adds it to
Codex's requests itself, through a small proxy on your Mac that only lives for the chat, so neither Codex
nor your agent's commands ever get it, and it's kept out of TRIF's logs. The panel only ever shows
whether a key is saved.

**Don't export API keys in your shell profile** (`export OPENROUTER_API_KEY=…` in `~/.zshrc`). Every
program you start from a terminal then carries the key in its environment, and on a Mac any program of
yours can read other programs' environments, a chat agent's sandboxed commands included. If you had
one there for TRIF, save the key as above, delete the `export` line, and open new terminals (and restart
anything started from the old ones, Chrome included if you launched it from a terminal). `trif doctor`
warns when it sees such a variable. Keep a spending limit on the key anyway.

A **Custom URL** works for any server that speaks OpenAI's Responses API; once its address is set you
can save a key for it the same way (each server has its own), and with a key its address must be
`https://` unless it's on this computer.

`trif doctor` checks the setup: Ollama or LM Studio running, the model installed, the key saved in the
Keychain (without showing it).

## Updates

When a new version is out, the TRIF panel says so: click **Update** to install it, or **What's new**
to read what changed first. In Settings, **Install updates automatically** lets it update by itself when
no chat is running (it's off unless you turn it on). Firefox updates the add-on itself, like any other
add-on, about once a day; if the panel says the add-on is older than the rest of TRIF, open about:addons,
click the gear, then **Check for Updates**. From a terminal: `~/.trif/bin/trif update` (or
`update --install`).

Updates are signed: TRIF installs only versions signed with its release key, so a copy from anywhere
else is refused.

## If something's wrong

```sh
~/.trif/bin/trif doctor
```

checks every piece and says how to fix what's broken. Common fixes:

- **"Helper isn't connected"**: quit the browser completely and reopen it. If that doesn't help, run
  `npx timsrobot setup` again, then restart the browser.
- **Mods don't run**: make sure **Allow User Scripts** is on (step 3), then reload the page.
- **Claude Code isn't found**: install it, then run `npx timsrobot setup` again in the same terminal.
- **"rg" Not Opened** while Codex works: a search tool that ships with Codex hasn't been checked by
  Apple. It's harmless: click Done (Codex works without it).

Still stuck? **Report a problem** (in the panel's Settings, or on the "helper isn't connected" notice)
opens the report form at [timsrobot.com/report](https://timsrobot.com/report) with your setup and recent
errors filled in (no names, email addresses or full page addresses). Nothing is sent until you press
Send. `trif report --open` does the same from a terminal; the form also works on its own.

To use the `trif` command directly (as your agent does), add it to your PATH:

```sh
echo 'export PATH="$HOME/.trif/bin:$PATH"' >> ~/.zshrc
```

## Uninstall

Remove TRIF from `chrome://extensions` (Firefox: about:addons; Safari: delete TRIF.app). Remove the API
keys you saved from the Keychain first, while the command is still there: `~/.trif/bin/trif agent key
--remove-key` (and again with `--agent codex`), and `~/.trif/bin/trif agent open-model --remove-key`
(they're listed in Keychain Access as "TRIF API key" and "TRIF open model key"). Then delete:

- `~/.trif`, your mods and TRIF's files (keep a copy of `~/.trif/sites` if you want your mods later),
  and `~/.webmods`, the link to it, if you used TRIF when it was called WebMods;
- TRIF's private folder, with its settings, logs and screenshots: `~/Library/Application Support/TRIF`
  (on Linux, `~/.local/state/trif`);
- `~/Library/Caches/TRIF` (chats' mailboxes; on Linux `~/.cache/trif`);
- the file that lets each browser start TRIF's helper, `com.webmods.helper.json`: in
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` and, for Firefox,
  `~/Library/Application Support/Mozilla/NativeMessagingHosts` (for Chromium, Brave, Edge or Arc, in
  `NativeMessagingHosts` in that browser's folder in `~/Library/Application Support`; on Linux, in
  `~/.config/<browser>/NativeMessagingHosts` and `~/.mozilla/native-messaging-hosts`);
- `/usr/local/bin/trif`, if setup linked it there;
- if you used Safari, its bridge: `launchctl bootout gui/$(id -u)/com.timsrobot.trif.safari-bridge`, then
  delete `~/Library/LaunchAgents/com.timsrobot.trif.safari-bridge.plist`.

## Privacy

Your mods and chats stay on your computer. A chat's agent can read your mods folder, `~/.trif`, and your
agents' skill folders (read only), but not TRIF's settings, logs or other sites' screenshots, which are
kept apart, in `~/Library/Application Support/TRIF`. When you ask for a change, your coding agent reads the page
you're on, and sends what it reads to its provider (Anthropic for Claude Code, OpenAI for Codex, the provider
you picked for an open model; nobody for a model on your own computer) under that provider's
terms. See [store/PRIVACY.md](store/PRIVACY.md).

## For developers

How the pieces fit together, and the full CLI, are in [docs/PROTOCOL.md](docs/PROTOCOL.md). Run the tests
with `node --test --test-concurrency=2 --test-timeout=120000`.

Before a release, also run the end-to-end browser suite, which installs the npm package into a scratch
home and drives a throwaway Firefox (and Chrome for Testing) profile through setup, the panel, switches,
Detox Timeline and real agent runs, saving screenshots:
`node tests/e2e/run.js firefox --agent --codex --upgrade-from <previous release .tgz>`. It never touches
your real browsers, profiles or `~/.trif`. What it covers and what stays manual (Safari, a real X
timeline, look and feel): [docs/TESTING.md](docs/TESTING.md).

`node scripts/build-extension.js firefox` builds the Firefox add-on into `dist/firefox` (try it with
`npx web-ext run -s dist/firefox`). Firefox only keeps signed add-ons installed; sign it as unlisted with
`npx web-ext sign -s dist/firefox --channel unlisted` and your addons.mozilla.org API key.

### Trying the code in this checkout in each browser

With `trif setup` run from this checkout (it links the helper here), every browser's helper runs
this folder's code from its next start. The extension itself loads differently in each browser:

- **Chrome:** chrome://extensions, the reload button on TRIF (it's loaded unpacked from `extension/`).
- **Firefox:** `node scripts/build-extension.js firefox`, then about:debugging#/runtime/this-firefox →
  **Load Temporary Add-on…** → `dist/firefox/manifest.json`. It stands in for the installed TRIF
  (same add-on ID) until Firefox quits; build and load again after changes.
- **Safari:** `node scripts/build-safari.js`, open `dist/safari-app/TRIF.app` once, then Safari →
  Settings → Developer → **Allow unsigned extensions** (off again whenever Safari quits), and untick and
  tick TRIF in Settings → Extensions. `trif setup --browser safari` once, for its bridge.

### timsrobot.com

`site/` is the report form's website, a Cloudflare Worker: `node site/dev.js` runs it locally (reports
are printed instead of emailed); see [site/README.md](site/README.md) to deploy it.

### Releasing

`node scripts/release.js <version>` makes a release, after a `## <version>` section in
[CHANGELOG.md](CHANGELOG.md) (that text is what the panel shows as "What's new"). It checks everything,
bumps the version, runs the tests, builds both extensions and the npm package, has Mozilla sign the
Firefox add-on, makes the beta zips (from `beta/`), and writes the update feeds in `updates/`. Then it asks
before publishing: a tagged commit, a GitHub release with the files, and the feeds last. `--dry-run`
builds everything into `dist/release/<version>` and publishes nothing.

Two things it doesn't do, both yours: **rename the GitHub repo** from `acapellascience/WebMods` to
`acapellascience/trif` before releasing 0.2.0 (package.json points installs at the new name; the script
stops while the git remote and package.json disagree), then check that the old
`raw.githubusercontent.com/acapellascience/WebMods/main/updates/…` URLs redirect, since installs from
before the rename fetch updates there; and **publish `trif` on npm** (`npm publish` the release's .tgz),
which `npx timsrobot setup` above needs. The script also stops while CHANGELOG.md has a non-empty
"## Unreleased" section.

It needs, on the releasing Mac: `gh auth login`; the addons.mozilla.org API key and secret in the
keychain as `trif-amo-issuer` and `trif-amo-secret`; and the release signing key, made once with
`node scripts/release.js keygen` (private half in the keychain as `trif-release-key`, public half in
`helper/lib/release-key.js`). Back the private key up: installs only accept updates signed with it.
(Keychain items under their WebMods-era names, `webmods-amo-issuer`, `webmods-amo-secret` and
`webmods-release-key`, are found too.)
