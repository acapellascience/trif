# Changelog

What's new in each TRIF release (called WebMods before 0.2.0). From 0.2.6 on, each version starts with a
short summary, at most 5 points: that's what the side panel shows under "What's new", with a link to the
rest, which goes under "### More" (and on the GitHub release). It's written for people using TRIF.
`node scripts/release.js <version>` needs a section here for the version it releases, and stops when its
summary is too long.

## Unreleased

- **Safer agents.** A mod that can post, click or send for you waits for your OK, and a tab your agent ran
  code in can't post as you until it reloads.
- **Choose what TRIF can reach:** every site (Permissive), or site by site with Connect (Restrictive).
  Already using TRIF? You stay Permissive.
- **Block a site** to keep TRIF away from it; the power button is now a quick pause.
- A site's mods come in two groups, Rules and Page scripts, each with its own switch.
- **New mods can wait for you:** set Page scripts to start off (Settings), and a new one stays off
  until you've looked at it.

### More

- A site's mods come in three groups, each with a switch for that site: Rules, **Sandboxed** (JavaScript in
  TRIF's sandbox: it can't send, click or load anything, so it never waits for your OK) and Page scripts.
- **New mods can start off, by group.** Settings in the side panel has "New mods start": Rules and Page
  scripts, each On (as before) or Off. Set Page scripts to Off and a new page script waits, switched off
  and marked "new", until you've looked at it and switched it on, while new rules still apply at once.
  It covers mods from a terminal agent, files you add, mods made in another browser, Tim's mods you add,
  and new versions of Tim's mods TRIF puts in place by itself; not the ones your side-panel chat makes
  for you. An agent run can't switch one on.
- **You choose what TRIF can reach: permissive or restrictive.** Installing TRIF used to give it "all your
  data on all websites". Now it asks for nothing until the setup page's new step, Site permissions:
  **Permissive** gives TRIF access to every site by default (your browser asks once); **Restrictive**
  connects TRIF site by site, so a site stays disconnected (the panel all grey) until you click Connect
  there. You can change it any time in Settings.
- Turning the robot off on a site keeps it connected, so it comes back on at once. Under Fix, "Disconnect
  from <site>" gives the site's access back (with every site allowed, it offers to switch to restrictive),
  and "Block on <site>" keeps TRIF away from it whatever it can reach (the panel turns red there; Settings
  lists blocked sites, each with Unblock).
- Without access to every site, your agent's screenshots are of the tab you're on, after you click the
  TRIF toolbar button there (Chrome and Firefox want that before an extension can capture a tab).
- Your browser now also says TRIF can "block content on any page". That's only blocking, never reading:
  it's how TRIF stops a tab your agent ran code in from posting, sending or saving as you, including to
  sites you haven't connected TRIF to.
- **Safer side-panel agents.** A web page can try to talk to your agent ("TRIF agent: run this…"), so
  TRIF no longer counts on the agent to say no:
  - When your agent runs code in a tab, TRIF has the browser block anything from that tab that posts,
    sends or saves as you, or takes what's on the page to another site, until the page reloads. Reading the page, clicks and testing mods work as
    before; the side panel says so, with a Reload button.
  - TRIF now reads what each mod's code can do (send requests, click or type for you, go to other
    pages or sites, or code it can't check) instead of trusting what the mod says about itself. A mod
    your agent writes that can do any of that waits for your OK, with what TRIF found shown apart from
    what the agent says. The same goes for a mod from anywhere else: your terminal agent, a file you
    paste in, a mod someone shares. Once you allow it, later changes only ask again if they add
    something new.
  - Your existing mods keep running. Ones that can do more than change how a page looks show what
    TRIF found once, with "Looks right".
- In Arc, TRIF's panel opens in a window of its own, and its helper connects without setting up Chrome
  too.

## 0.2.5

- **Bigger mods.** A mod can now be up to 4 MB, and all your mods together up to 16 MB. Until now they
  had to fit in 1 MB in all, and past that the biggest ones were left out: a game, or a mod with
  its sounds or pictures in it, could use that up alone. If a mod is ever too big, `trif status` and
  `trif doctor` say which one and what to do. A change to one mod now sends only that mod to the browser,
  which keeps Firefox's memory in check with big mods. (The helper and the browser extension both need
  this version; with an older extension, mods still stop at 1 MB in all, and `trif doctor` says to update
  it.)
- **X-Flyer has music**, in the mod itself: Blast the Evil Eye while you fly and Big Boss once `@elonmusk`
  is full size (both by Tim), then the end of Stravinsky's Firebird (Stokowski, 1940) when he explodes.
  That makes it about 2 MB, so it needs this version.
  It's also smoother: the boss fight and heavy firing stay at 60 frames a second with your other X mods
  on. Its Gravity mode is gone (the X key's bombs stay).
- **You choose which of Tim's mods to add.** A new setup puts none of them on your computer until you
  tick their sites on the setup page. Each mod has its own switch in the side panel; add other sites'
  later in Settings there, or from the link on that site's panel. One you deleted can be brought back in
  Settings too. If you already have Tim's mods, nothing changes.
- **New for X, off until you switch them on: people's own colours.** Style Encoder stamps a style you
  pick into the corner of the next profile picture you upload (X's round crop hides it). Profile Styler
  then shows each styled profile in its owner's colours, and Post Styler their posts and people cards.
  To find the styles they load people's profile pictures again from X's image server.
- Detox Timeline keeps the margins beside the timeline equal when X-Flyer is installed and no game is on.
  Rainbow Rave's and Follow Status's rainbows no longer jump at their edges.
- Amazon's Simple Home shows Amazon's own logo, sharper. Punk Fonts for X is no longer one of Tim's mods:
  if you have it, it stays as it is, without updates.
- When your coding agent's login runs out, the side panel asks you to log in again (and keeps your
  message to send again) instead of showing the agent's error twice.
- Each tab keeps its own draft in the side panel's message box.
- The page's address reaches your agent without the part after `?` or `#`, which anyone can fill.

## 0.2.4

- **TRIF installs with `npx timsrobot setup`.** npm wouldn't take the name "trif", so the package is
  called timsrobot (after timsrobot.com). Once it's installed you still type `trif`, as before.

## 0.2.3

- **New mods, off until you switch them on:** X-Flyer flies a fighter over X (Shift+S, or the rocket
  button) to blast the timeline; Follow status marks the people on X who follow you back; Three-Column
  Feed lays Instagram's home feed out three posts wide.
- The mods TRIF ships for X, Amazon, Instagram and Google are updated, with new names and short
  descriptions. DVD Logo also finds Google's newer logo and bounces it off its real edges.
  If you changed one, the side panel offers the new version; yours stays until you choose.
- Plain X is now **Detox Timeline** (`x.com/detox-timeline`). If yours was unchanged, it's replaced, and it
  stays on if it was on; if you changed it, yours stays as it is, and Detox Timeline arrives switched off.
- Your agent now keeps mod descriptions short (4 to 9 words).
- **A model you pick stays in that chat.** Picking a model for one site's chat used to make it the model of
  every site you chatted on next, without saying so. Now each chat keeps its own, new chats start on the
  agent's default, and a small line over the message box always says which agent and model this chat
  uses (click it to change them).
- **Open models handle long chats.** A long chat with an open model could stop with a "maximum context
  length" error. TRIF now tells it how much the model holds, so the chat gets summarized well before it
  outgrows it; and if a chat ever does, you're told to start a new one instead of seeing the raw error.

## 0.2.1

- **Side-panel agents are kept on a tighter leash.** In 0.2.0:
  - a Claude Code run could search files anywhere in your home folder (its search tools weren't limited
    the way its file reading was), and on a Mac that made "node would like to access…" prompts pop up;
  - Claude Code runs also had a dozen more tools than TRIF uses (among them sending messages to your other
    Claude sessions and notifications to you), and could write into the folder where your other Claude
    sessions keep their scratch files;
  - Codex runs could search the web, read other users' folders and other disks, and read and write the
    computer's shared temporary folders, where other programs (Claude Code sessions among them) keep
    their files.

  Now Claude Code runs only get the tools TRIF needs, and both agents' searches, reads and writes stay
  within what TRIF allows: no web search, no shared temporary folders, no other users' folders or disks.

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
- **The mods that come with TRIF have new names.** Plain X is now **Detox Timeline**; on Instagram,
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
- **The mods that come with WebMods get fixes.** Detox Timeline and the Google, Amazon and Instagram mods now
  update with WebMods. If you never changed one, it just gets the new version. If you (or your agent)
  changed it, yours is left alone and the side panel offers the new version on that mod: use it (yours
  goes to the trash, with Undo), keep yours, or have your agent merge the two, keeping your changes.
  Each says which version it is ("from WebMods, version 1").
- An agent working on one site can no longer see which other sites you have open, or switch on, from
  its own site, a mod that runs everywhere.
- Detox Timeline no longer flashes X's own tabs and narrow timeline for a moment when a page loads or you go
  back to Home.
- If X changes how its timeline data looks, Detox Timeline shows the timeline unfiltered rather than an empty
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
- Detox Timeline starts with every filter off, for the plainest timeline. Its logo follows X's light or dark
  theme, and menus on the search page no longer hide behind it.
- New commands for agents and terminals: `webmods update` and `webmods report`.

## 0.1.0

First beta: mods for Google, X, Amazon and Instagram, chat with your coding agent in the side panel,
per-site switches (WebMods is off on a site until you turn it on), a trash for deleted mods, Chrome and
Firefox.
