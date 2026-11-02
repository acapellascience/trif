# Tim's Robot Internet Fixer (TRIF)

Customize any website by asking your coding agent. Open the TRIF side panel in Chrome, say what you
want ("hide the trending sidebar", "only show people I follow"), and your agent writes a small mod that
runs every time that site loads. Mods are plain JavaScript files on your computer; switch each one off
and on from the side panel.

TRIF uses the coding agent you already have (Claude Code or Codex), on your own account.
TRIF collects nothing: the only thing that ever reaches its developer is a problem report you choose to send.

**Beta.** Expect rough edges, and please send feedback.

**It used to be called WebMods.** Version 0.2.0 renamed it; nothing else changed. Updating moves your mods
and settings from `~/.webmods` to `~/.trif` (and leaves `~/.webmods` as a link to it, so keep that link),
the command is now `trif` (`webmods` still works), and the extension, its settings and your switches stay
as they were.

## What you need

- A Mac (or Linux). Windows isn't supported yet.
- Google Chrome 138 or newer.
- Node 18 or newer: check with `node --version`, or install it from [nodejs.org](https://nodejs.org).
- A coding agent: [Claude Code](https://claude.com/claude-code) (you can log in from the side panel), or
  [Codex](https://github.com/openai/codex) 0.138 or newer (`brew install codex`, then `codex login` in a terminal).
  Pick one in the side panel's settings when you have both.

## Install

1. **Install the helper.** In a terminal:

   ```sh
   npx trif setup
   ```

   If you were sent a file (`trif-0.2.0.tgz`) instead, run this from the folder it's in:

   ```sh
   npx --yes --package ./trif-0.2.0.tgz trif setup
   ```

   This creates `~/.trif` (your mods live in `~/.trif/sites`) and connects it to Chrome. It's safe to
   run again.

2. **Add the extension to Chrome.** Open `chrome://extensions`, turn on **Developer mode** (top right),
   click **Load unpacked**, and choose `~/.trif/app/extension`. (On a Mac, press ⌘⇧. in the file picker
   to show hidden folders like `.trif`.)

3. **Allow it to run mods.** On `chrome://extensions`, click **Details** under TRIF and turn on
   **Allow User Scripts**.

4. **Restart Chrome.** Quit it completely (⌘Q) and open it again.

5. **Open the side panel.** Click the TRIF icon in the toolbar (pin it from the puzzle-piece menu). If
   it asks you to log in to Claude, click **Log in** and follow the steps.

### Firefox

TRIF also runs in Firefox 153 or newer. Open Firefox once before running `npx trif setup`, so setup
finds it (or run `npx trif setup --browser firefox`). Then open the signed `trif-firefox.xpi` you were
sent in Firefox to install the add-on, click the TRIF toolbar button to open the sidebar, and click
**Allow user scripts**. Restart Firefox if it was open during setup.

Chrome and Firefox can both be open: they share your mods, and each sidebar or side panel chat works
on its own browser. Switching a mod off is per browser.

### Safari (Mac, test builds)

TRIF runs in Safari 27.2 or newer on a Mac. Until it's signed by Apple it only runs on the Mac it was
built on, so for now this is for trying it out:

1. `node scripts/build-safari.js` (needs Xcode) makes `dist/safari-app/TRIF.app`. Open it once: it adds
   the TRIF extension to Safari.
2. `trif setup --browser safari` starts the Safari bridge, a small background program Safari's
   extension talks to (Safari can't start the helper itself the way Chrome does). It starts again whenever
   you log in.
3. In Safari: Settings → Advanced, tick "Show features for web developers"; Settings → Developer, tick
   "Allow unsigned extensions" (Safari turns this off whenever it quits); Settings → Extensions, tick
   TRIF and allow it on every website.
4. Click the TRIF toolbar button. Safari has no side panel, so the panel opens in a window of its own,
   following the tabs of the window you opened it from.

## Using it

- TRIF is off on every site until you turn it on there: the side panel shows "TRIF is off on <site>"
  and a "Fix this site" button that turns it on. Until then nothing from TRIF runs on the site or reads
  it, not even a mod for all sites, and agents (in the panel or a terminal) can't touch its tabs. The
  switch next to the site name turns it back off.
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

- **Google:** Hide AI in Results, Hide AI Mode and Gemini Promo, Results Only (no extra sections), Hide
  Sponsored Results.
- **X:** **Plain X**: Home is just the people you follow, newest first, with no ads or suggestions. It
  starts as plain as it gets (only original text posts from people who follow you back); the **Filters**
  menu turns each kind back on (reposts, quotes, replies, links, videos, images, non-mutuals…). It also hides the
  trends column, tidies post pages, and turns Explore into a plain search field. Punk Fonts *(off)* and
  Rainbow Rave *(off)*, for fun.
- **Amazon:** Simple Home (just a search box) and Simple Shopping (results show only picture, price and
  stars; no sponsored items, ads or recommendations).
- **Instagram:** Following-only feed (no suggested posts or ads), Hide reposts, Hide AI content, and
  Desaturate *(off)*: colours down to 35%.

## Updates

When a new version is out, the TRIF panel says so: click **Update** to install it, or **What's new**
to read what changed first. In Settings, **Install updates automatically** lets it update by itself when
no chat is running (it's off unless you turn it on). Firefox updates the add-on itself, like any other
add-on. From a terminal: `~/.trif/bin/trif update` (or `update --install`).

Updates are signed: TRIF installs only versions signed with its release key, so a copy from anywhere
else is refused.

## If something's wrong

```sh
~/.trif/bin/trif doctor
```

checks every piece and says how to fix what's broken. Common fixes:

- **"Helper isn't connected"**: quit Chrome completely and reopen it. If that doesn't help, run
  `npx trif setup` again, then restart Chrome.
- **Mods don't run**: make sure **Allow User Scripts** is on (step 3), then reload the page.
- **Claude Code isn't found**: install it, then run `npx trif setup` again in the same terminal.
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

Remove TRIF from `chrome://extensions`, then delete `~/.trif` (and `~/.webmods`, the link to it, if you
used TRIF when it was called WebMods). That folder holds your mods, so keep a copy of `~/.trif/sites` if
you want them later.

## Privacy

Your mods and chats stay on your computer. When you ask for a change, your coding agent reads the page
you're on, and sends what it reads to its provider (Anthropic for Claude Code, OpenAI for Codex) under that provider's
terms. See [store/PRIVACY.md](store/PRIVACY.md).

## For developers

How the pieces fit together, and the full CLI, are in [docs/PROTOCOL.md](docs/PROTOCOL.md). Run the tests
with `node --test --test-concurrency=2 --test-timeout=120000`.

Before a release, also run the end-to-end browser suite, which installs the npm package into a scratch
home and drives a throwaway Firefox (and Chrome for Testing) profile through setup, the panel, switches,
Plain X and real agent runs, saving screenshots:
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

It needs, on the releasing Mac: `gh auth login`; the addons.mozilla.org API key and secret in the
keychain as `trif-amo-issuer` and `trif-amo-secret`; and the release signing key, made once with
`node scripts/release.js keygen` (private half in the keychain as `trif-release-key`, public half in
`helper/lib/release-key.js`). Back the private key up: installs only accept updates signed with it.
(Keychain items under their WebMods-era names, `webmods-amo-issuer`, `webmods-amo-secret` and
`webmods-release-key`, are found too.)
