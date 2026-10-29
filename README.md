# WebMods

Customize any website by asking your coding agent. Open the WebMods side panel in Chrome, say what you
want ("hide the trending sidebar", "only show people I follow"), and your agent writes a small mod that
runs every time that site loads. Mods are plain JavaScript files on your computer; switch each one off
and on from the side panel.

WebMods uses the agent you already have (Claude Code today; Codex is experimental), on your own account.
Nothing goes to a WebMods server: there isn't one.

**Beta.** Expect rough edges, and please send feedback.

## What you need

- A Mac (or Linux). Windows isn't supported yet.
- Google Chrome 138 or newer.
- Node 18 or newer: check with `node --version`, or install it from [nodejs.org](https://nodejs.org).
- [Claude Code](https://claude.com/claude-code), installed. You can log in from the side panel.

## Install

1. **Install the helper.** In a terminal:

   ```sh
   npx webmods setup
   ```

   If you were sent a file (`webmods-0.1.0.tgz`) instead, run this from the folder it's in:

   ```sh
   npx --yes --package ./webmods-0.1.0.tgz webmods setup
   ```

   This creates `~/.webmods` (your mods live in `~/.webmods/sites`) and connects it to Chrome. It's safe to
   run again.

2. **Add the extension to Chrome.** Open `chrome://extensions`, turn on **Developer mode** (top right),
   click **Load unpacked**, and choose `~/.webmods/app/extension`. (On a Mac, press ⌘⇧. in the file picker
   to show hidden folders like `.webmods`.)

3. **Allow it to run mods.** On `chrome://extensions`, click **Details** under WebMods and turn on
   **Allow User Scripts**.

4. **Restart Chrome.** Quit it completely (⌘Q) and open it again.

5. **Open the side panel.** Click the WebMods icon in the toolbar (pin it from the puzzle-piece menu). If
   it asks you to log in to Claude, click **Log in** and follow the steps.

## Using it

- Go to a site, open the side panel, and describe the change you want. The agent looks at the page,
  writes a mod, and reloads the tab so you can see it. Keep chatting to adjust it.
- Each mod has a switch in the side panel, so you can turn it off without deleting it.
- A side-panel agent can only touch the site you opened it on. If it writes a mod that would also run on
  other sites, that mod waits for you to click **Allow**.

### Mods that come with it (switched off)

Turn these on with their switches in the side panel, on the site they're for:

- **Plain X** (x.com): Home is just the people you follow, newest first, with no ads or suggestions, and
  a **Filters** menu (reposts, quotes, replies, links, videos, images, non-mutuals…). It also hides the
  trends column, tidies post pages, and turns Explore into a plain search field.
- **Instagram:** Following-only feed (no suggested posts or ads), Hide reposts, Hide AI content, and
  Desaturate (colours down to 35%).

## If something's wrong

```sh
~/.webmods/bin/webmods doctor
```

checks every piece and says how to fix what's broken. Common fixes:

- **"Helper isn't connected"**: quit Chrome completely and reopen it. If that doesn't help, run
  `npx webmods setup` again, then restart Chrome.
- **Mods don't run**: make sure **Allow User Scripts** is on (step 3), then reload the page.
- **Claude Code isn't found**: install it, then run `npx webmods setup` again in the same terminal.

To use the `webmods` command directly (as your agent does), add it to your PATH:

```sh
echo 'export PATH="$HOME/.webmods/bin:$PATH"' >> ~/.zshrc
```

## Uninstall

Remove WebMods from `chrome://extensions`, then delete `~/.webmods`. That folder holds your mods, so keep
a copy of `~/.webmods/sites` if you want them later.

## Privacy

Your mods and chats stay on your computer. When you ask for a change, your coding agent reads the page
you're on, and sends what it reads to its provider (Anthropic for Claude Code) under that provider's
terms. See [store/PRIVACY.md](store/PRIVACY.md).

## For developers

How the pieces fit together, and the full CLI, are in [docs/PROTOCOL.md](docs/PROTOCOL.md). Run the tests
with `node --test`.
