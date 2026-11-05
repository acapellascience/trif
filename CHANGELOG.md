# Changelog

What's new in each TRIF release (called WebMods before 0.2.0). The text under a version is what the side
panel shows under "What's new", so it's written for people using TRIF. `node scripts/release.js <version>`
needs a section here for the version it releases.

## 0.2.1

- **Claude Code runs stay in your mods folder.** In 0.2.0, a side-panel run using Claude Code could search
  files anywhere in your home folder (its search tools weren't limited the way its file reading was), and
  on a Mac that made "node would like to access…" prompts pop up. Now its searches stay in `~/.trif`, like
  everything else it reads.

## 0.2.0

- **WebMods is now TRIF: Tim's Robot Internet Fixer**, with a new icon: the robot himself. Your mods,
  chats, switches and settings carry over. Their folder moved from `~/.webmods` to `~/.trif`
  (`~/.webmods` is now a link to it: please keep it). TRIF's own settings, logs and screenshots moved to
  `~/Library/Application Support/TRIF`, out of your agent's reach (screenshots now go after 30 days).
  The command is now `trif` (`webmods`
  still works), and mods can call `window.trif.log(...)` (`window.webmods` still works).
- **Using Safari?** Build and open the new TRIF.app (see the README), tick TRIF in Safari → Settings →
  Extensions and allow it on every website. Safari sees it as a new extension, so its chats, switches
  and sites start over. Then delete the old WebMods app.
- **Your agent finishes the job more often.** It changes the whole kind of thing you mean ("hide the
  promos" means every promo, on every page), counts what's left before saying it's done, and tells you
  what it checked. A new `trif sweep` finds every instance on a page in one go: by colour, element or
  words, inside widgets and frames too.
- **Screenshots of tabs you're not looking at.** In Firefox your agent can see any tab without TRIF
  switching to it. In Chrome it can open a copy of the page in a window that shows for a moment at the
  edge of your screen, and it says so.
- **Each site's chat keeps its own agent and model.**
- **Merge with my agent** (for a new version of a shipped mod you changed): your agent proposes the
  merge first, and makes it when you say go ahead.
- **Open models (experimental).** A third choice in Settings, "Open model (via Codex)": a model on your
  own computer (Ollama or LM Studio: nothing leaves it) or from a provider like OpenRouter with your own
  key, through Codex (no OpenAI account needed). The key is kept in your Mac's Keychain only. Small
  local models are much weaker at this than Claude Code or Codex. See the README.
- **API keys go in the Keychain.** If you use an API key instead of logging in, save it with
  `trif agent key --set-key` (`--agent codex` for an OpenAI key); one in TRIF's settings moves there by
  itself. TRIF adds it to your agent's requests, so neither the agent nor its commands get it. Don't keep
  API keys in your shell profile: other programs can read them there (`trif doctor` warns).
- **Stronger walls around side-panel chats.** What you type isn't on the agent's command line any more,
  where other programs could read it. Your agent can read your skill folders (read only), but never
  TRIF's settings, logs or other sites' screenshots, and one chat can't widen the next one's limits.
  `trif screenshot --copy` won't reload one-time links, and checks where the copy ends up.
- **The mods that come with TRIF have new names.** Plain X is now **Timeline Detox**; on Instagram,
  **Only Following** and **Hide AI**. On Google, four mods are now two: **AI Banisher** (no AI Overview,
  AI Mode or Gemini promo) and **Just Results** (no sponsored results or extra sections). Each is on if
  either of the two it replaces was. If you changed one of those, yours stays as it is.
- New shipped mod: **DVD Logo** for Google (off until you switch it on).
- The panel: "What should I fix on x.com?", a power button for the site, the robot with its eyes off
  where TRIF is off, and a mods list that scrolls on its own.
- **Safari:** no more garbled characters in the panel; a chat keeps going when Safari pauses TRIF; if
  Safari's storage stops working, TRIF says so and keeps going.
- **Firefox:** the panel says when the add-on is older than the rest of TRIF, and how to update it.

## 0.1.2

- **Safari, for trying out.** WebMods runs in Safari 27.2 or newer on a Mac: mods, the panel (a window of
  its own, since Safari has no side panel) and agent chats. Until it's signed by Apple it only runs on
  the Mac it was built on; see the README.
- **Side-panel agents are walled in by your Mac, not just told the rules.** A chat's agent (Claude Code
  or Codex) can only change mods for the site you're on, can't read anything outside the WebMods folder
  (no browser data, keys or documents), can't read your API keys, other chats' logs or other sites'
  screenshots, and has no internet access of its own, so a web page it reads can't talk it into
  sending your data anywhere. Claude Code 2.1.285 or newer is needed.
- **The mods that come with WebMods get fixes.** Plain X and the Google, Amazon and Instagram mods now
  update with WebMods. If you never changed one, it just gets the new version. If you (or your agent)
  changed it, yours is left alone and the side panel offers the new version on that mod: use it (yours
  goes to the trash, with Undo), keep yours, or have your agent merge the two, keeping your changes.
  Each says which version it is ("from WebMods, version 1").
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
