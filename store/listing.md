# Chrome Web Store listing: TRIF

> Last updated: 2026-11-02 · Manifest version 0.2.0 · Visibility: **Unlisted** (private beta)

Copy-paste source for the Chrome Web Store Developer Dashboard. Every field below maps to a field in
the dashboard. The package comes from `node scripts/build-extension.js`, which writes
`dist/trif-extension-<version>.zip`.

Placeholders to fill in: `<CONTACT EMAIL>`, `<PRIVACY POLICY URL>`, `<SUPPORT URL>`, `<HELPER INSTALL URL>`.

---

## Store listing tab

**Name** (must match manifest `name`; max 75 chars)

```
TRIF
```

(Short for Tim's Robot Internet Fixer, which the descriptions spell out. It was called WebMods before 0.2.0;
the extension ID stays the same.)

**Short description** (max 132 chars; this is the manifest `description`, 89 chars)

```
Tim's Robot Internet Fixer: customize any website with mods written by your coding agent.
```

A longer alternative (114 chars). If you use it, put it in the manifest too so the two match:

```
Change how any website looks and works by asking your own coding agent (Claude Code, Codex) to write a mod for it.
```

**Detailed description** (plain text: the store strips markdown)

```
TRIF (Tim's Robot Internet Fixer) lets you change how websites look and behave by asking your own coding agent, such as Claude Code or OpenAI Codex, to write a "mod" for the site you're on.

Open the TRIF side panel on any page and describe what you want: "hide reposts", "make the text bigger", "remove the trending sidebar", "add a word count to this editor". Your agent, running on your own computer under your own account, writes a small script for that site. TRIF runs it every time the site loads, so the change sticks even when the agent isn't running.

FEATURES
• Chat with your coding agent in a side panel, next to the page you want to change
• Mods apply automatically every time you visit the site
• Switch any mod off and on from the side panel, without deleting it
• Mods are ordinary files in a folder on your computer (~/.trif/sites/), so you can read, edit, back up or delete them yourself
• Works with the coding agent you already use and pay for (Claude Code or Codex). There's no TRIF account
• Each site's chat keeps its own agent and model
• Your agent changes the whole kind of thing you mean, counts what's left, and tells you what it checked
• Your agent is walled in by your computer, not just told the rules: it can change mods only for the site you're on, can't read TRIF's settings or the rest of your files, and its commands have no internet access
• Mods that come with TRIF for Google, X, Amazon and Instagram, which get fixes with TRIF updates (yours are never overwritten)
• Open models (experimental): run your agent on a model on your own computer (Ollama, LM Studio) or from a provider like OpenRouter, through Codex

REQUIREMENTS (PRIVATE BETA)
• Chrome 138 or later on macOS or Linux
• The free TRIF helper, installed on your computer with one terminal command (instructions: <HELPER INSTALL URL>). The extension uses the helper to talk to your coding agent and to read your mods folder
• A coding agent: Claude Code or OpenAI Codex, logged in with your own account or with your own API key (kept in your computer's keychain)
• Chrome's "Allow User Scripts" switch turned on for TRIF. The setup page that opens after install walks you through it

HOW TO USE
1. Install the helper: run "npx trif setup" in a terminal (details: <HELPER INSTALL URL>).
2. On the setup page that opens, turn on "Allow User Scripts" for TRIF.
3. Go to any website and click the TRIF toolbar icon to open the side panel.
4. Describe the change you want. Your agent writes the mod and reloads the page to show it.
5. Don't like it? Ask for a tweak, switch the mod off, or start a new chat.

PRIVACY
TRIF collects nothing. The extension talks only to the helper on your own computer. The only thing that reaches the developer is a problem report, when you fill in the report form and press Send. When you ask your coding agent for a change, the agent can read the page you're on (its text, the address, and screenshots) so it can write the mod. It sends that to its own AI provider (for example Anthropic or OpenAI, or the open-model provider you picked; nobody, for a model on your own computer) under that provider's terms, the same as any other time you use the agent. Chats and settings are stored only on your computer. Full policy: <PRIVACY POLICY URL>

PERMISSIONS
• "Read and change all your data on all websites": mods can be written for any site you choose, and your agent needs to read the page you're asking about. Nothing runs on a site unless you or your agent created a mod for it.
• "Communicate with cooperating native applications": talks to the TRIF helper on your computer. It talks to nothing else.
• "Read your browsing history": the side panel shows the mods for the site in the current tab, and your agent can find the tab you're talking about by its address.

SUPPORT
Questions or bugs: <CONTACT EMAIL> or <SUPPORT URL>

Version 0.2.0: WebMods is now TRIF (Tim's Robot Internet Fixer). Agents finish the job more often, per-site agent and model, open models (experimental), API keys kept in the keychain, stronger walls around side-panel chats.
```

**Category:** Developer Tools. Productivity would also fit, but mods are code and the beta audience
uses coding agents, so Developer Tools sets the right expectation and matches what reviewers see.

**Language:** English

---

## Privacy practices tab

### Single purpose

```
TRIF runs site customizations ("mods") that the user's own coding agent writes on the user's computer at the user's request, and provides a side panel for asking that agent to create or change them.
```

### Permission justifications

Write one field per permission. Every permission in `extension/manifest.json` is covered below.

**userScripts**
```
TRIF is a user script manager. Its mods are user scripts that the user's own coding agent (for example Claude Code) writes into a folder on the user's computer, at the user's request. The extension registers exactly those scripts so they run on the sites the user chose. It also registers one small page helper bundled with the extension that records mod errors and log messages so the agent can debug them. No script comes from the developer or from any server. The user can see, edit and delete every mod as a file on disk, switch each one off in the side panel, or turn the whole feature off with Chrome's "Allow User Scripts" switch.
```

**nativeMessaging**
```
The extension's only connection is to the TRIF helper, a local program the user installs on their own computer (native host "com.webmods.helper"). The helper sends the extension the mods from the user's mods folder, starts the user's coding agent when the user sends a message in the side panel, and relays the agent's page commands (read page text, reload, run a script) to the extension. No browsing data goes to the developer. (Separately, the helper checks GitHub for TRIF updates, and "Report a problem" opens a web form the user can choose to submit.)
```

**tabs** (see REVIEW_RISKS.md §4: possibly redundant with `<all_urls>`; drop this block if `tabs` is removed)
```
Needed to read tab URLs and titles. The side panel follows the active tab and shows the mods and the chat for that tab's site. The user's agent targets tabs by URL (for example "the x.com tab"), lists open tabs, opens a page in a background tab to test a mod, reloads a tab after changing a mod, and captures a screenshot of the visible tab so it can check its work. For a tab that isn't showing, only when the agent asks for a copy (trif screenshot --copy), the extension loads the same page in a window of its own, at the edge of the screen and not focused, captures it and closes it at once; it refuses addresses that look like one-time links, and only on sites the user turned TRIF on for.
```

**scripting**
```
Used to read a page's visible text and title for the user's agent, and to read the errors, logs and recorded requests that TRIF's page helper keeps for mods on that page, so the agent can debug the mod it is writing. This runs only on the tab the user is asking about, when the agent requests it.
```

**storage**
```
Stores, only on the user's device: the list of mods received from the local helper (so mods keep working before the helper connects), which mods the user switched off, the per-site chat history shown in the side panel, the user's agent and model settings, and which sites have request recording turned on. Nothing is synced.
```

**sidePanel**
```
The main interface is a side panel: the user chats with their coding agent about the page they are looking at and switches the site's mods on and off. Clicking the toolbar icon opens it.
```

**Host permission: `<all_urls>`**
```
Users can write mods for any website they choose, so TRIF can't know the sites in advance. Mods use the user-chosen match patterns from each mod file, and nothing runs on a site without a mod for it. The host permission is also needed when the user asks their agent about a page: to read its text, take a screenshot of the visible tab, reload it, and read mod errors there. Narrowing it to a fixed list of sites would make the extension unable to customize the site the user is on.
```

### Remote code

**Are you using remote code?** Choose **No, I am not using remote code**.

Justification, in case the dashboard asks or review questions it:

```
All of the extension's own JavaScript is in the package. It loads no scripts from a server, uses no eval of fetched content, and the extension makes no network requests at all.

The scripts it runs on web pages are user scripts, and it runs them only through Chrome's userScripts API, which exists for this purpose and which the user must turn on with Chrome's "Allow User Scripts" switch. These scripts are written by the user's own coding agent, running on the user's own computer under the user's own account, at the user's explicit request in the side panel. They are saved as files in a folder the user owns (~/.trif/sites/), and the extension receives them from a helper program on the same machine. The developer has no way to send mods to users: there is no script catalogue, and no server the extension contacts. (Updates to TRIF itself come through the Chrome Web Store like any extension's.) It is the same model as Tampermonkey: the user supplies the scripts, here written with their own AI coding tool.
```

### Data usage

Tick these boxes. They're honest and somewhat cautious: the extension itself sends nothing to the
developer. The disclosure covers what it *handles* and passes to the user's local helper and, from
there, to the AI agent the user chose.

| Data type | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | Not requested or collected. It can appear incidentally in page text the agent reads, which "Website content" covers. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes (cautious)** | The request recorder, which is off by default and turned on per site by the user or their agent, captures request bodies and response text on that site. These can contain tokens or passwords. It isn't collected for that purpose, but it can be handled. If you'd rather not tick it, accept a small risk of a disclosure mismatch. |
| Personal communications | **Yes** | Messages the user types in the side panel go to their own agent. Page text the agent reads can include emails or messages. |
| Location | No | |
| Web history | **Yes** | Tab URLs and titles are read to target tabs and show per-site mods, and they're passed to the user's agent. |
| User activity | **Yes** | The optional request recorder counts as network monitoring. Off by default, per site. |
| Website content | **Yes** | Page text, screenshots and recorded responses go to the user's agent so it can write mods. |

Certifications (tick all three; all true):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Data reaches the user's AI provider only because the user sends it through their own agent, to
  provide the extension's single purpose. The developer never receives it.)
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `<PRIVACY POLICY URL>`. Host `store/PRIVACY.md` publicly first, for example
on GitHub Pages or a public gist. The link must work when you submit.

---

## Distribution tab

- **Visibility:** Unlisted (only people with the link can find it).
- **Regions:** All regions.
- **Pricing:** Free.

---

## Graphics

| Asset | Size | Required? | Status |
|---|---|---|---|
| Store icon | 128×128 PNG | Required | `extension/icons/robot-128.png` (a robot head: dark squircle, green rim, two mint eyes), drawn by `node scripts/render-icon.js`, which also writes `store/icon.svg`. Google suggests 96×96 artwork with 16 px of transparent padding; this uses 112×112 with 8 px. |
| Screenshot 1 | 1280×800 (or 640×400) PNG/JPEG | Required (at least 1, up to 5) | To do |
| Screenshots 2–5 | 1280×800 | Recommended | To do |
| Small promo tile | 440×280 PNG/JPEG | Recommended (shown in some store surfaces) | To do |
| Marquee promo tile | 1400×560 PNG/JPEG | Optional (featuring only; not relevant for unlisted) | Skip |
| Promo video | YouTube URL | Optional | Optional: a 30–60 s screen recording is the most convincing thing for reviewers |

Screenshots to take (1280×800 browser window, real UI, no device mockups, no other companies' logos
in focus; use a neutral site or the extension's own pages):

1. **Side panel chat in action.** A page on the left; the side panel on the right with a request
   ("hide the sidebar"), the agent's short reply and tool lines ("edited sites/example.com/hide-sidebar.js").
2. **Before/after.** The same site before and after a mod.
3. **Mods on this site.** The side panel's mod list with on/off switches.
4. **Setup page.** `onboarding.html` with Helper connected, Allow User Scripts on, and the mods list.
5. (Optional) **The mods folder.** A code editor showing a mod file, to make "your mods are files you
   own" concrete.

Avoid showing third-party trademarks (X, YouTube) prominently in screenshots or the promo tile.

---

## Developer and support info

- **Publisher name:** (the developer account's display name)
- **Contact email:** `<CONTACT EMAIL>` (shown publicly; must be monitored, and you have to verify it in the dashboard)
- **Support URL:** `<SUPPORT URL>` (for example the repo's issues page)
- **Homepage URL:** optional

---

## Test instructions (dashboard: "Test instructions" field)

See `store/REVIEW_RISKS.md` § "Reviewer test instructions" for text ready to paste.

---

## Version history

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.1.0 | 2026-10-29 | First private beta (unlisted). | Draft |
| 0.2.0 | 2026-11-02 | Renamed TRIF; per-site agent and model; open models (experimental); keys in the keychain; screenshots of background tabs (copy window in Chrome); private folder for the helper's files. | Draft |
