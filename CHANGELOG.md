# Changelog

What's new in each WebMods release. The text under a version is what the side panel shows under
"What's new", so it's written for people using WebMods. `node scripts/release.js <version>` needs a section
here for the version it releases.

## Unreleased

- **Safari, for trying out.** WebMods runs in Safari 27.2 or newer on a Mac: mods, the panel (a window of
  its own, since Safari has no side panel) and agent chats. Until it's signed by Apple it only runs on
  the Mac it was built on; see the README.
- **Side-panel agents are walled in by your Mac, not just told the rules.** A chat's agent (Claude Code
  or Codex) can only change mods for the site you're on, can't read anything outside the WebMods folder
  (no browser data, keys or documents), can't read your API keys, other chats' logs or other sites'
  screenshots, and has no internet access of its own, so a web page it reads can't talk it into
  sending your data anywhere. Claude Code 2.1.285 or newer is needed.
- An agent working on one site can no longer see which other sites you have open, or switch on, from
  its own site, a mod that runs everywhere.
- Plain X no longer flashes X's own tabs and narrow timeline for a moment when a page loads or you go
  back to Home.
- If X changes how its timeline data looks, Plain X shows the timeline unfiltered rather than an empty
  one, and some rarer X responses no longer break.
- Two browsers installing an update at the same moment no longer trip over each other, and installing an
  update from Safari no longer leaves WebMods stopped in Safari until you log in again.
- An update that installed but hit a problem afterwards (setting up a browser, say) says so, instead of
  saying the update failed.
- WebMods no longer runs out of browser storage when you have long or many chats; if saving does fail, a
  switch you flip stays as it was rather than looking off while mods keep running.
- Network recording an agent switches on goes off again when the agent finishes, and keeps less: at most
  2 MB per response and 32 MB in all, skipping live event streams.
- Big screenshots and other large messages between the browser and WebMods no longer slow the helper down.

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
