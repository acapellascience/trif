# Chrome Web Store listing: Tim's Robot Internet Fixer

> Last updated: 2026-11-15 · For version 0.3.x (manifest 0.3.0; the first upload will be 0.3.1, the release
> with the store ID in it) · Visibility: **Public**
>
> **The one copy-paste source for the Developer Dashboard.** Every block below is a dashboard field, in the
> dashboard's order. `store/REVIEW_RISKS.md` is the reasoning behind the answers (what review may object to,
> and what to do if it does); `store/PRIVACY.md` is the privacy policy (published at
> https://timsrobot.com/privacy from that file); `store/images/` has the screenshots and promo tile.
> Words people see here are Tim's to approve: docs/STORE-STRINGS.md lists them, old → new.

The package: `node scripts/build-extension.js` writes `dist/trif-extension-<version>.zip` (no `key`, so the
store gives it its own ID). The release's `trif-chrome-<version>.zip` is the same and also fine to upload.

---

## Package tab

Upload the zip. As soon as the draft exists the dashboard shows the item's **ID** (32 letters a-p): put it in
`helper/lib/paths.js` `STORE_EXTENSION_ID` (see "Order of steps" at the end).

## Store listing tab

**Name** (from the manifest; it must match `extension/manifest.json` `name`)

```
Tim's Robot Internet Fixer
```

**Summary** (the manifest's `description`, 62 characters; the dashboard shows it, it can't be typed there)

```
Customize any website with mods written by your coding agent.
```

**Description** (plain text: the store strips markdown)

```
Tim's Robot Internet Fixer (TRIF) lets you change how any website looks and works by asking your own coding agent. Open TRIF's side panel on a site, say what you want ("hide the trending sidebar", "only show people I follow", "make the text bigger"), and your agent writes a small mod for that site. TRIF runs it every time the site loads, so the change sticks, even when the agent isn't running.

TRIF works with the coding agent you already use and pay for: Claude Code or OpenAI Codex, on your own account, or an open model through Codex (experimental). There's no TRIF account, and TRIF collects nothing.

FEATURES
• Chat with your coding agent in a side panel, next to the page you want to change. It looks at the page, writes the mod, reloads the tab and tells you what it checked.
• Three kinds of mods. Style mods only change how a page looks. Boxed mods run in TRIF's box and can only do what you allow (play a sound, add a search box, sort what the site shows). Free mods can do anything the page can, and wait for your OK if TRIF finds they can post or send for you.
• TRIF asks for each site. It runs on no site until you turn it on there, and Chrome asks you for that one site. Sensitive sites, like email, banking and password managers, start blocked; block any other site to keep TRIF away.
• Your agent on each site: Off, Look, Ask first or Run code. Code it runs to look around stays in TRIF's box, where it can't send or act, and a tab it ran code in can't post as you until it reloads.
• Every mod has a switch, its code and its history, with Restore. Mods from outside your chat start off until you turn them on.
• Mods that break say so on their row, and your agent offers to fix them.
• Mods are plain files in a folder on your computer (~/.trif/sites): read them, edit them, back them up, export one to share it, or import one by dropping it on the panel.
• No agent? Robotless mode runs your mods without one.
• Tim's mods, if you want them: a few for Google, X, Amazon and Instagram (hide AI answers, a following-only feed, a quieter home page…). None is added until you pick its site, and each starts off.

WHAT YOU NEED
• A Mac or Linux computer (Windows isn't supported yet), with Chrome 138 or newer.
• The free TRIF helper, a small program on your computer that the extension talks to: run "npx timsrobot setup" in a terminal (it needs Node 18 or newer). It talks to your coding agent and reads your mods folder.
• A coding agent (Claude Code or Codex), unless you use Robotless mode.
• Chrome's "Allow User Scripts" switch turned on for TRIF. The setup page that opens after you install walks you through it.

HOW TO USE
1. Add TRIF to Chrome, then run "npx timsrobot setup" in a terminal.
2. On the setup page that opens, turn on "Allow User Scripts", and pick any of Tim's mods you want.
3. Go to a website, click the TRIF icon to open the side panel, and click "Fix <site>". Chrome asks to let TRIF on that site.
4. Say what you want changed. Your agent writes the mod and reloads the page to show it.
5. Don't like it? Ask for a tweak, switch the mod off, or undo the change.

PRIVACY
TRIF collects nothing. The extension talks only to the helper on your own computer. When you ask your agent for a change, it can read the page you're on (its text, address and screenshots) and sends what it needs to its own AI provider (Anthropic, OpenAI, or the open-model provider you chose; nobody, for a model on your computer), under that provider's terms, as it does whenever you use it. Chats and settings stay on your computer. The only thing that reaches the developer is a problem report, when you fill in the report form and press Send. The helper checks GitHub once a day for TRIF updates. Full policy: https://timsrobot.com/privacy

PERMISSIONS
• Websites: none when you install it. TRIF asks Chrome for one site at a time when you turn it on there; "Disconnect" gives a site back, and you can take access back in Chrome's settings.
• "Communicate with cooperating native applications": the TRIF helper on your computer. It talks to nothing else.
• "Read your browsing history": the side panel shows the mods and chat for the site in the current tab, and your agent finds the tab you mean by its address.
• "Block content on any page": only blocking, never reading. A tab your agent ran code in can't post, send or save as you until it reloads.

SUPPORT
https://timsrobot.com/support · Report a problem from the side panel, or email reports@timsrobot.com. Source code: https://github.com/acapellascience/trif

New in 0.3: three kinds of mods (style, boxed, free); TRIF asks for each site, and sensitive sites start blocked; safer agents; mods from outside your chat start off; every mod's code and history, with Restore; export and import.
```

(About 4,300 characters; the limit is 16,000. Claude Code and Codex are named as compatible agents,
nominative use, as before; no other company's name or logo is in the name, icon or images.)

**Category:** Developer Tools. (Productivity also fits; Developer Tools sets the right expectation: a terminal
and a coding agent are required, and it's what reviewers will judge the permissions against.)

**Language:** English

**Graphics** (files in `store/images/`, made by `node scripts/store-shots.js`; see its header):

| Field | File | Size |
|---|---|---|
| Store icon | `extension/icons/robot-128.png` | 128×128 |
| Screenshots (in this order) | `store/images/screenshot-1-chat.png`, `screenshot-2-mods.png`, `screenshot-3-site-access.png`, `screenshot-4-setup.png` | 1280×800 each |
| Small promo tile | `store/images/promo-small-440x280.png` | 440×280 |
| Marquee promo tile | none (only for featuring) | 1400×560 |
| Promo video | optional: a YouTube link, if Tim makes one (the best answer to "couldn't verify": REVIEW_RISKS §1) | |

**Official URL:** none (it needs a Search Console-verified site; optional).
**Homepage URL:** `https://timsrobot.com`
**Support URL:** `https://timsrobot.com/support`

---

## Privacy practices tab

### Single purpose

```
TRIF runs site customizations ("mods") that the user's own coding agent writes on the user's computer at the user's request, or that the user adds, and provides a side panel for asking the agent for them and switching them on and off.
```

### Permission justifications

One field per permission, every one in `extension/manifest.json`.

**userScripts**
```
TRIF is a user script manager: its mods are user scripts. They are written, at the user's request in the side panel, by the user's own coding agent running on the user's computer, or added by the user, and saved as files in a folder the user owns (~/.trif/sites). The extension registers those scripts for the sites the user turned TRIF on for, through the userScripts API and Chrome's "Allow User Scripts" switch, which the user turns on. Three kinds: style mods (no code: TRIF applies their CSS and hide/restyle rules), boxed mods (run in a separate user script world with its own CSP that allows no network connections, inside a sandbox from the extension package), and free mods (run in the page's world, and held for the user's OK when they can send or act). It also registers one small page helper from the package that records mods' errors so the user's agent can fix them, and runs code the user's agent sends for the tab it is working on (userScripts.execute), which goes into TRIF's sandboxed world unless the user's per-site setting allows more. The user can read, edit and delete every mod as a file, switch each one off in the side panel, block a site, or turn the whole feature off with Chrome's switch.
```

**storage**
```
Stores, only on the user's device (chrome.storage.local; nothing is synced): the mods received from the local helper (so they run before the helper connects), which mods and sites the user switched on or off or blocked, each site's chat with the user's agent, the user's settings (agent and model per site, what the agent may do on each site, powers allowed for boxed mods), mods' recent errors, and the site list another installed copy of TRIF reported (so the same mod doesn't run twice).
```

**unlimitedStorage**
```
Mods can be up to 4 MB each and 16 MB together (some carry their own sounds and pictures), and each site keeps its chat history. They are cached in chrome.storage.local so mods run as soon as Chrome starts, before the local helper connects; the default 10 MB quota would drop mods.
```

**tabs**
```
The side panel follows the active tab: it has to know which site the current tab is on, including sites TRIF isn't turned on for yet, to show that site's mods and chat and to offer turning TRIF on there. The user's agent finds tabs by address ("the x.com tab"), lists open tabs, opens a page in a background tab to test a mod, reloads a tab after changing a mod, and takes a screenshot to check its work. Page commands only reach tabs of sites the user turned TRIF on for (and only that chat's site, for a side-panel chat).
```

**nativeMessaging**
```
The extension's only connection is to the TRIF helper, a program the user installs on their own computer (native host "com.webmods.helper"). The helper reads the user's mods folder and sends the mods to the extension, starts the user's own coding agent when the user sends a message in the side panel, and relays the agent's page commands (read the page's text, reload, take a screenshot, run code in TRIF's sandbox) to the extension for the tab the agent works on. The extension makes no network requests itself.
```

**scripting**
```
Used to read a page's visible text and title for the user's agent, to read the errors and logs that TRIF's page helper keeps for mods, and, after the agent ran code in a tab, to mark that tab so TRIF can tell when it has reloaded and lift the block it put on it. Only on tabs of sites the user turned TRIF on for, when the agent working for the user asks.
```

**sidePanel**
```
TRIF's interface is a side panel: the user chats with their coding agent about the page they're looking at, and switches the site's mods on and off. Clicking the toolbar icon opens it.
```

**activeTab**
```
For screenshots: when the user clicks TRIF's toolbar button on a tab, the user's agent can capture that tab (captureVisibleTab) to check how a mod looks. TRIF asks for sites one at a time, and captureVisibleTab needs activeTab or access to every site; activeTab is the narrow one. Nothing else uses it.
```

**declarativeNetRequest**
```
Used only to block requests, never to read or redirect them. When the user's agent runs JavaScript in a page's own world, TRIF first adds session rules for that tab's site that block requests that change something (POST, PUT, PATCH, DELETE), WebSockets, and loads or navigations to sites the page hadn't already used, until the tab loads a new page, so nothing a web page tricks the agent into doing can post, send or save as the user. Block rules need no host access.
```

**Host permissions** (`optional_host_permissions: ["<all_urls>"]`; nothing at install)
```
TRIF requests no website access at install. Users write mods for websites they choose, so the sites can't be listed in advance. When the user clicks "Fix <site>" in the side panel on a site, the extension calls chrome.permissions.request for that one site (the domain and its subdomains, e.g. *://*.example.com/*), and Chrome asks the user. "Disconnect" removes it again (chrome.permissions.remove), and the user can take any site back in Chrome's settings, after which nothing from TRIF runs there. With access to a site, TRIF runs the user's mods there and, when the user asks their agent about that site, reads its text, reloads it and reads mod errors. Earlier versions required <all_urls>; 0.3.0 gave that up once for every user. Sites on a block list the user keeps (sensitive ones such as email, banking and password managers start on it) get nothing from TRIF whatever access it has.
```

### Remote code

**Are you using remote code?** **No, I am not using remote code.**

Justification (the dashboard asks for one only with Yes; keep it for a reviewer's question):

```
All of the extension's own code is in the package: it loads no script from a server, evaluates nothing it fetched, and makes no network requests.

The scripts it runs on web pages are user scripts, run only through Chrome's userScripts API, which the user must turn on with "Allow User Scripts". They are the user's: written at the user's request by the user's own coding agent, on the user's computer under the user's own account, or added by the user, and saved as files in a folder the user owns (~/.trif/sites). The extension gets them from a helper program on the same computer (native messaging); there is no script catalogue or server it contacts. Boxed mods are user scripts too: they run in a separate user script world, through a sandbox (SES, in the package) whose evaluator needs 'unsafe-eval' in that world's CSP only; the extension's own pages keep the default CSP.

The helper (installed separately, from npm and GitHub) also includes optional example mods by the developer ("Tim's mods", for Google, X, Amazon and Instagram). None is added unless the user picks its site on the setup page; each is then a file in the user's folder, starts switched off until the user turns it on, and an updated one starts off again. They never come through the extension or the Web Store.
```

### Data usage

Cautious, as before: the extension itself sends nothing to the developer, but it handles these and passes them
to the user's local helper and, from there, to the AI agent the user chose (off the device, to that provider).

| Data type | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | Not asked for. It can appear in page text the agent reads ("Website content" covers that). The report form is a page on timsrobot.com the user opens and sends themselves; the policy describes it. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes** | The request recorder (off by default, turned on per site by the user or their agent) captures request bodies and response text on that site, which can hold login tokens. Not collected for that, but handled. |
| Personal communications | **Yes** | Messages the user types in the side panel go to their own agent; page text the agent reads can include emails or messages. |
| Location | No | |
| Web history | **Yes** | Tab addresses and titles show the site's mods and chat, and go to the user's agent when it lists or picks tabs. |
| User activity | **Yes** | The optional request recorder counts as network monitoring. Off by default, per site. |
| Website content | **Yes** | Page text, screenshots and recorded responses go to the user's agent so it can write mods. |

Certifications (tick all three; all true):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Data reaches the user's AI provider only because the user sends it through their own agent, for the
  single purpose. The developer never receives it.)
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://timsrobot.com/privacy` (deploy the site first: it must load when you submit).

---

## Distribution tab

- **Visibility:** Public.
- **Publishing:** turn **off** "Publish automatically after review" (deferred publishing), so the listing goes
  live when Tim says, after the release whose setup points at it (see "Order of steps").
- **Regions:** All regions.
- **Pricing:** Free.
- **Mature content:** No.

## Account tab (developer account)

- **Publisher name:** the developer account's display name (for example "Tim Blais").
- **Contact email:** shown publicly; must be monitored and verified in the dashboard. Suggested:
  `reports@timsrobot.com` (already the support address) or `privacy@timsrobot.com`; check that the
  chosen one reaches Tim (Cloudflare Email Routing).
- **Trader / non-trader:** non-trader (free, no payments), unless Tim's situation says otherwise.

---

## Test instructions (dashboard: "Test instructions" field)

```
TRIF needs a small helper program on the computer (macOS or Linux, Node.js 18 or newer). Without it the extension only shows its setup page. The main path below needs no AI account and takes about 3 minutes. A live demo of the side panel (no install) is on https://timsrobot.com: "Try the demo" on the right edge.

1. Install the extension, then in a terminal: npx timsrobot setup
   (type y if npx asks to install the package). The "TRIF setup" tab ticks off "Install the helper".
2. On that tab, click "Open TRIF's Chrome settings" and turn on "Allow User Scripts". The step ticks itself off.
3. Under "Tim's mods", tick Google and click "Add these".
4. Open https://www.google.com and search for anything. Click the TRIF toolbar icon to open the side panel, then "Fix google.com" (Chrome asks to allow that site: Allow). The panel lists Tim's Google mods. Switch on "Oppish" (and "Just Results", if it's off); the page reloads with the results' text in Oppish (a word game) and without the extra sections.
5. No AI account is needed for this: in the panel's Settings (gear), choose "None (robotless)" as the agent. Mods keep running.
6. Your own mod, still without an AI account: in a terminal,
     mkdir -p ~/.trif/sites/example.com
     printf '%s\n' '// ==WebMod==' '// @style' '// ==/WebMod==' '{"css": "h1 { color: green !important; }"}' > ~/.trif/sites/example.com/green.js
   Open https://example.com, open the panel, click "Fix example.com". The mod is listed as new and off (mods from outside the chat start off): switch it on and the heading turns green.
7. Optional, with a Claude Code login (https://claude.com/claude-code): on example.com, type "make the background light yellow" in the panel. The agent writes a mod and reloads the page.

Nothing is sent to the developer; the extension talks only to the helper. Privacy policy: https://timsrobot.com/privacy
```

Before submitting, run steps 1 to 6 yourself on a clean Chrome profile with the **store build** (see
REVIEW_RISKS "Before submitting"); `trif check example.com/green` checks the example mod parses.

---

## Version history

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.1.0 | 2026-10-29 | First private beta (unlisted draft, never submitted). | Draft |
| 0.2.0 | 2026-11-02 | Renamed TRIF. (Draft, never submitted.) | Draft |
| 0.3.1 | | First public submission: 0.3.0 plus the store ID, install from the store, two TRIFs in one profile. | Not uploaded |

## Order of steps (the store ID is only known after the first upload)

1. Tim creates the item: upload the zip (any 0.3.x build) as a **draft**; copy its ID from the dashboard.
2. Put the ID in `helper/lib/paths.js` `STORE_EXTENSION_ID` (leave `STORE_LISTED = false`), on this branch;
   `npm test`; release **0.3.1** (helper on npm and the feed: its setup writes the ID into
   `allowed_origins`, so the store's TRIF can reach the helper, the reviewer's included).
3. Upload the 0.3.1 zip to the draft (the version must be higher than any upload before).
4. Deploy timsrobot.com (`node site/build-demo.js` first, then `npx wrangler deploy` in `site/`), so
   https://timsrobot.com/privacy and /support load.
5. Fill in the dashboard from this file and `store/images/`; submit, with deferred publishing.
6. After approval: publish the listing, then set `STORE_LISTED = true` in paths.js, release **0.3.2**
   (setup, doctor and the README's link point at the store), drop the README's "(Until the listing is
   public…)" sentence, and deploy the site again (its "Add to Chrome" button and /chrome follow paths.js).
