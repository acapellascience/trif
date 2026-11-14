# "Agent on this site": the new strings (branch powers)

**Approved by Tim, 2026-11-10.**

Every user- and agent-facing string the per-site agent setting adds, exact (all approved: see above).

## How it works (decisions to check)

- Levels: **Off** (no reading, screenshots or code on the site's tabs; mods for it can still be written, and
  go through the holds), **Look** (reading and screenshots, no code), **Run code** (as before, with the tab
  lock). No choice yet is **Ask**: reading works, and the first `trif run` asks in the panel.
- Enforced in the extension's background (`agentGate` in background.js), before any command from the helper
  touches a tab: `run` needs Run code; `text`, `sweep`, `screenshot`, `requests`, `request`, `errors`,
  `logs`, `record` (on), `reload`, `navigate`, `open`, `close` and `status --tab` need Look. `navigate` and
  `open` are checked for where they go too. Commands that touch no page (mod files, switches, `status`)
  work at every level. `trif tabs` lists an Off site's tabs with only `https://<site>/` and no title.
- **Terminal agents get the same levels.** TRIF can't tell an agent in a terminal from the user typing
  `trif`, so a terminal is treated as an agent: the user raises the level in the panel for sites they want
  driven from a terminal. A `trif run` that needs Ask with no side panel open fails at once, saying where
  to allow it.
- **Ask waits 25 seconds** for the answer (the helper's and the CLI's timeouts stretch only while it's
  asking). **Just this once** covers that side-panel run (every `trif run` it makes on the site); from a
  terminal, that one command. **Always on this site** sets Run code; **Not here** sets Look. × or Esc closes
  the dialog without an answer (the command fails, saying the user didn't answer).
- Precedence: the user's choice for the exact site; then the sensitive list (Off); then the user's choice
  for a parent domain (google.com at Run code doesn't raise mail.google.com, which is on the list; it does
  raise maps.google.com); then Ask. Sites are host names without `www.`.
- The sensitive list (extension/agentsites.js `SENSITIVE_DEFAULT`): Gmail, Outlook/Live/Office, Yahoo
  Mail, Proton, iCloud; PayPal, the Stripe dashboard, Wise, Revolut, Monzo, N26, Chase, Wells Fargo, Citi,
  Capital One, Amex, Schwab, Fidelity, Vanguard, HSBC, Barclays, TD, RBC, BMO, CIBC, Tangerine, Desjardins,
  any host with "bank" in a label (`*bank*`) and the `.bank` domain; 1Password, Bitwarden, LastPass,
  Dashlane; Discord, WhatsApp Web; ChatGPT, OpenAI, Claude.ai. Editable in Settings (the user's list
  replaces TRIF's; "Use TRIF's list" brings it back).
- The agent sees its site's level in the side panel's context, in AGENTS.md ("Agent on this site"), and in
  every refused command.

## Panel: the header (before the move: see "Moved to the chat line")

- The control (a select beside the power button; label **Agent on this site**): **Agent: Ask** ·
  **Agent: Off** · **Agent: Look** · **Agent: Run code** (a panel narrower than 420px: **Ask** · **Off** ·
  **Look** · **Run code**)
- Its title: **Agent on {site}: it can read, and asks before it first runs code** · **…: it can't read, take
  screenshots or run code here** · **…: it can read and take screenshots, but not run code** · **…: it can
  read and run code (the tab locks while it does)**
- The line under the bar, for a site off by the sensitive list: **Your agent is off on {site}: it's {what}.
  Choose “Agent” above to let it look or run code here.** ({what}: **email**, **email and your Apple
  account**, **payments**, **banking**, **a password manager**, **your messages**, **your chats with
  another AI**, or the user's own words; without one: **on your list of sensitive sites**)

## Moved to the chat line (branch faces, 2026-11-11; **approved by Tim 2026-11-14**, AWAITING-STRINGS.md)

The control left the header. It's now the third part of the line over the message box, after the agent and
model ("Claude Code · Default model · Agent asks before running code ▾"), shown only where there's a chat
to have (the site connected and the robot on: not on the off, blocked or disconnected gates, nor on pages
with no site). A button opens a small menu (radio items; arrows, Home/End, Enter, Esc to close). Each level
has a small monochrome icon in the muted text colour; on a panel narrower than 420px only the icon shows,
its words as the tooltip.

| | Old (header) | New (the chat's line) |
|---|---|---|
| Off | **Agent: Off** (narrow **Off**) | eye crossed out, **Agent can’t see this site** |
| Look | **Agent: Look** (narrow **Look**) | eye, **Agent can look** |
| Ask | **Agent: Ask** (narrow **Ask**) | eye with a ?, **Agent asks before running code** |
| Run code | **Agent: Run code** (narrow **Run code**) | `</>`, **Agent can run code** |
| Label / title | **Agent on this site**; titles **Agent on {site}: it can read, and asks before it first runs code** (and the three others above) | the level's words (as above) |

The menu (new):
- Heading: **What your agent can do on {site}**
- **Off:** it can’t see or touch this site. (Was "Nothing"; renamed 2026-11-11 to match Settings.)
- **Look:** it can read the page and take screenshots.
- **Ask first:** it can look, and asks you before running code on the site.
- **Run code:** it can change the page live; posting is paused until the page reloads.
- Footer (muted): **Whatever you pick, a mod that can do more than change this page waits for your OK.**

The sensitive-site note left the header too: it's the first line in that site's chat, as TRIF's own note.
- Old (under the bar): **Your agent is off on {site}: it's {what}. Choose “Agent” above to let it look or run
  code here.**
- New (the chat's first line): **Your agent can’t see {site}: it’s {what}. Change it below.** ({what}: the
  same phrases as before; without one, **on your list of sensitive sites**)

Settings' **Agent on sites** list and the Ask card are unchanged.

## Panel: the Ask dialog

- Top line: **Your agent is asking**; the × is labelled **Close**
- Title: **Your agent wants to run code on {site}.**
- Text: **It can read everything you can see here.**
- Buttons: **Just this once** · **Always on this site** · **Not here**

## Panel: Settings

- **Agent on sites**; each row: {site}, a select **Off / Look / Run code**, and **Ask again** (title:
  **Forget this choice: the site goes back to asking (or off, if it's on the sensitive list)**)
- When none: **None chosen yet: an agent can read any site, and asks before it first runs code on one.**
- **Sensitive sites**; **Agents are off on these until you choose otherwise for a site. One per line: a site
  (and its subdomains), or a pattern like \*bank\*, then what it is after a colon.**
- Buttons: **Save** · **Use TRIF's list**; after them: **Saved.** / **TRIF's list again.**

## For the agent (command errors, AGENTS.md, the side panel's context)

- Off: **"Agent on this site" is Off for {site}{ (it's {what}, so it's off unless the user raises it)}: you
  can't read, screenshot or run code on its tabs. You can still write mods for it (they wait for the user's
  OK as usual); the user can change the setting in TRIF's side panel**
- Look: **the user has set "Agent on this site" to Look for {site}: you can read the page and take
  screenshots there, but not run code (trif run). Work from what you can read, or ask the user to set it to
  Run code in TRIF's side panel**
- Ask, no panel: **running code on {site} needs the user's OK first ("Agent on this site" is Ask there), and
  TRIF's side panel isn't open to ask them. Ask the user to open TRIF's side panel and set "Agent on this
  site" to Run code for {site}, then try again; meanwhile you can read the page (trif text, trif
  screenshot)**
- Not here: **the user chose Not here: "Agent on this site" is now Look for {site}, so you can read the page
  and take screenshots there, but not run code. Work from what you can read**
- No answer: **the user didn't answer TRIF's question (in the side panel) about running code on {site} in
  time; try again once they have, or work from reading the page (trif text, trif screenshot)**
- The side panel's context, one of: **"Agent on this site" is Off here (the user's setting): you can't
  read, screenshot or run code on its tabs, but you can still write mods for it, which wait for the user's
  OK as usual. Don't try trif text, trif screenshot or trif run here.** · **"Agent on this site" is Look
  here (the user's setting): you can read the page and take screenshots (trif text, trif screenshot, trif
  sweep), but not run code in it (trif run is refused).** · **"Agent on this site" is Ask here: you can
  read the page; the first time you run code (trif run), the user is asked in the panel, and the command
  waits for their answer.**
- AGENTS.md: the section "Agent on this site" (helper/workspace/AGENTS.md).
