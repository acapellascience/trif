# Changelog

What's new in each WebMods release. The text under a version is what the side panel shows under
"What's new", so it's written for people using WebMods. `node scripts/release.js <version>` needs a section
here for the version it releases.

## Unreleased

- **Safari, for trying out.** WebMods runs in Safari 27.2 or newer on a Mac: mods, the panel (a window of
  its own, since Safari has no side panel) and agent chats. Until it's signed by Apple it only runs on
  the Mac it was built on; see the README.
- Plain X no longer flashes X's own tabs and narrow timeline for a moment when a page loads or you go
  back to Home.

## 0.1.1

- **Updates.** The WebMods panel tells you when a new version is out, and installs it with one click.
  You can let it install updates by itself (Settings, off unless you turn it on). In Firefox the add-on
  now updates itself, like any other add-on.
- **Report a problem** (in Settings) opens a report form at webmods.dev with your setup and recent errors
  filled in, without your name, email or full page addresses. Nothing is sent until you press Send.
- **Codex works**, as well as Claude Code. Pick it in Settings. A Codex chat can only change mods for the
  site it's about: your Mac enforces that, not just the instructions.
- The model picker shows the models your agent offers: for Codex, the ones your account can use.
- Chrome setup is easier: setup opens the extension's folder in Finder, ready to drag onto
  chrome://extensions, and Chrome no longer needs a restart.
- Plain X starts with every filter off, for the plainest timeline. Its logo follows X's light or dark
  theme, and menus on the search page no longer hide behind it.
- New commands for agents and terminals: `webmods update` and `webmods report`.

## 0.1.0

First beta: mods for Google, X, Amazon and Instagram, chat with your coding agent in the side panel,
per-site switches (WebMods is off on a site until you turn it on), a trash for deleted mods, Chrome and
Firefox.
