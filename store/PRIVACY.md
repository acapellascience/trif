# TRIF privacy policy

Last updated: November 4, 2026

Tim's Robot Internet Fixer (TRIF, called WebMods before version 0.2.0) is a browser extension (for
Chrome, Firefox and Safari) that runs website customizations ("mods") written by **your own coding
agent** (for example Claude Code or OpenAI Codex) on your own computer. This policy explains what the
extension does with your data. In short, **TRIF collects nothing.** The only thing that ever reaches
its developer, Tim Blais, is a problem report, and only when you fill in the report form and press Send.

## Who handles your data

There are three parties:

1. **The TRIF extension**, running in your browser.
2. **The TRIF helper**, a small program you install on your computer. The extension talks only
   to the helper, through the browser's "native messaging" channel (in Safari, a connection to the
   helper on your own computer, 127.0.0.1). Neither goes over the network.
3. **Your coding agent** (Claude Code, Codex…). It runs on your computer under your own account with
   its AI provider (for example Anthropic or OpenAI), or with a model you chose (see "Open models"
   below). The helper starts it when you send a message in the TRIF side panel.

The TRIF developer is none of these at run time. There is no TRIF account, analytics, telemetry,
automatic crash reporting, advertising or tracking of any kind. Neither the extension nor the helper
sends anything about you, your pages or your mods to the developer or anyone else on its own. Apart
from your agent's own traffic (below), the only network traffic TRIF causes is:

- **Updates.** The helper checks for a newer TRIF about once a day by downloading a small public file
  from GitHub (`raw.githubusercontent.com`), and downloads the new version from GitHub when you choose
  to install it. GitHub sees an ordinary download request (your IP address and "trif/<version>");
  nothing about your mods, pages or chats is sent. You can turn the checks off with `"checkForUpdates":
  false` in TRIF's `config.json` (`~/Library/Application Support/TRIF/config.json` on a Mac). In
  Firefox, the browser itself checks a similar public file on GitHub for new versions of the add-on, as
  it does for any add-on.
- **Pages you're already on.** In Chrome, a screenshot of a tab you're not looking at loads that page
  again (see the table below). Nothing goes anywhere the page wouldn't go by itself.
- **Problem reports, only when you send one.** "Report a problem" opens the report form at
  timsrobot.com/report with details from TRIF filled in: version numbers, setup checks, the mods for
  the site you're on, and recent errors, with your name, email addresses and full page addresses removed.
  You see exactly what's included and can leave it out. Nothing is sent until you press Send. Then the
  report, what you typed, the email address you give (if any) and your browser's name go to the
  developer by email. They're used only to fix problems and to reply to you, and kept until the problem
  is fixed and you've had a reply, then deleted; ask at privacy@timsrobot.com to have a report deleted
  sooner. To stop floods of reports, the form counts how many come from your IP address in a minute;
  the address isn't stored.

## What the extension handles, and why

| Data | When | Where it goes |
|---|---|---|
| **Your mods** (JavaScript files, with the sites each one runs on) | Always | Read from a folder on your computer (`~/.trif/sites/`) by the helper. The extension keeps a copy in the browser's local extension storage so mods work before the helper connects. |
| **Tab addresses and titles** | When the side panel is open, and when your agent asks | The side panel uses them to show the mods and chat for the current site. Your agent gets them when it lists tabs or targets one. |
| **Page content**: visible text, screenshots, the result of scripts the agent runs on the page, and errors or log messages from mods | Only when your agent asks, while working on a request from you, and only on sites you turned TRIF on for | Passed through the helper to your agent. Screenshots are saved in TRIF's private folder (below), one folder per site, and deleted after 30 days. In Firefox a screenshot can be of a tab you're not looking at. In Chrome, for a tab you're not looking at, your agent can ask for a copy of the page: TRIF loads the page again, with your cookies (so signed in as you), in a window of its own that shows for a moment at the edge of your screen, captures it and closes it; it refuses addresses that look like one-time links (sign-in, confirm, unsubscribe). |
| **Recorded network requests** (address, method, status, request body and response text) | Only on sites where you or your agent turn recording on. It's off by default. | Kept in the page's memory and cleared on every reload. Passed to your agent when it asks. These can include sensitive data such as login tokens, so turn recording on only where you need it. |
| **Your chat messages** in the side panel, and your agent's replies | When you use the side panel | Your messages go through the helper to your agent. The chat history for each site is saved in the browser's local extension storage. The helper keeps a record of each of the last 50 agent runs (what the agent saw and said) in its private folder. |
| **Settings**: chosen agent and model (for each site's chat), which mods you switched off, which sites TRIF is on for and which are being recorded | When you change them | The browser's local extension storage. The helper's own settings, including open-model choices (provider, model, server address; never the key), are in `config.json` in its private folder. |

TRIF doesn't use browser sync storage, cookies, or any remote storage.

**The private folder.** The helper keeps its settings, logs, agent run records and screenshots in
`~/Library/Application Support/TRIF` on a Mac (`~/.local/state/trif` on Linux), outside the folder your
agent works in. Side-panel agents can't read it.

## Your coding agent and its AI provider

When you ask your agent for a change, it reads the page it needs, which can include the text,
address and screenshots described above, and sends it to **its own AI provider** to do the work.
This is the same as any other time you use that agent, and it's covered by **that provider's terms
and privacy policy**, not by TRIF:

- Claude Code (Anthropic): https://www.anthropic.com/legal/privacy
- Codex (OpenAI): https://openai.com/policies/privacy-policy

The agent uses your own login, or an API key you saved. A saved key is kept in your Mac's Keychain (on
Linux, your keyring) and nowhere else: before each chat the helper reads it and adds it to the agent's
requests itself, through a small proxy on your computer that lasts only for that chat, so the agent and
its commands never get it, and it's kept out of TRIF's files and logs. Those requests, with whatever
page content your agent sends, then go from the helper to the provider: Anthropic or OpenAI. TRIF never
sees your login, and the TRIF developer receives no copy of anything.

Avoid asking the agent to work on pages that show information you don't want to send to your AI
provider, such as banking or medical records. The agent only reads pages while it is working on
something you asked for.

**Open models (experimental).** If you pick "Open model (via Codex)", your agent's requests go to the
model you chose: to **Ollama or LM Studio on your own computer**, in which case nothing leaves your
computer; or to **OpenRouter** or **another server you name** (a custom URL), with the key you saved
(kept and sent as above), under that provider's terms.

Web pages can contain text written to mislead AI agents ("prompt injection"). TRIF limits what
the agent can do, with walls your operating system enforces: it can change mods only for the site
you're on, run TRIF commands only on that site's tabs, read the TRIF folder and your agents' skill
folders (read only) but not TRIF's private folder or the rest of your home folder, and its commands get
no network access. But TRIF commands can run scripts in that site's tabs, so review what the agent does
on sensitive sites.

## Sharing and sale

The TRIF developer receives nothing except the problem reports you choose to send, and doesn't share
or sell them. Data reaches a third party (your AI provider) only when you send a request through your
own agent, and only for the purpose you asked for. Reports pass through Cloudflare, which hosts the
report form and delivers its email. It isn't used for advertising, profiling, or creditworthiness or lending.

## The website

timsrobot.com has no analytics, no tracking and no cookies. Its demo keeps its state only in your
browser (nothing is sent anywhere). Cloudflare, which hosts it, sees ordinary requests (your IP address, the pages you load)
as any web host does.

## The Windows waitlist (the website, not the extension)

The timsrobot.com website has a waitlist for the Windows version at timsrobot.com/windows. The extension
has nothing to do with it and never sends anything to it. If you join, the email address you enter and
the time go to the developer by email. The address is used only to tell you when TRIF is ready for
Windows, nothing else, and isn't shared or sold. Ask at privacy@timsrobot.com to be removed and it's
deleted. The form counts signups from your IP address the same way the report form does. Like reports, it passes through Cloudflare, which hosts the website and delivers its email.

## Keeping and deleting your data

Everything stays on your computer until you delete it:

- **Chat history:** use "New chat" in the side panel to clear a site's conversation.
- **Mods:** switch them off in the side panel, or delete the files in `~/.trif/sites/`.
- **Everything the extension stored:** remove the extension from your browser. That deletes its local
  storage and all registered mods.
- **Helper files** (`~/.trif/`, your mods; and the private folder, `~/Library/Application Support/TRIF/`
  on a Mac or `~/.local/state/trif/` on Linux: settings, logs, screenshots and the agent run records in
  `runs/`): delete those folders. Screenshots go by themselves after 30 days, run records after 50 runs.
- **API keys you saved:** `trif agent key --remove-key` (and `--agent codex`), `trif agent open-model
  --remove-key`, or delete "TRIF API key" and "TRIF open model key" in Keychain Access.
- **What your agent sent to its provider:** see that provider's controls (linked above).

## Children

TRIF isn't directed at children under 13 and doesn't knowingly handle their data.

## Changes

If what TRIF does with data changes, this policy will be updated and its date changed before the
new version is published. Any change that sends data somewhere new will be described in the release
notes.

## Contact

TRIF is made by Tim Blais. Questions about privacy, or requests to see or delete your data:
privacy@timsrobot.com
