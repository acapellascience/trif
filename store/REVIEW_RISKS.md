# Chrome Web Store review risks: TRIF 0.2.0

What is likely to slow down or fail review, roughly most to least likely, with mitigations. An
unlisted item gets **the same review** as a public one. Unlisted only hides it from search.

## Expect a long, manual review

The permission set includes `userScripts`, `nativeMessaging`, `tabs`, `scripting` and `activeTab`. Host
access is optional: `optional_host_permissions: ["<all_urls>"]`, nothing required, so the install prompt
has no "all your data on all websites" line, and TRIF asks for each site (its domain and subdomains) when
the user turns TRIF on there (see §4). That's narrower than before (`<all_urls>` was required until this
change), but `userScripts` plus `nativeMessaging` is still broad, and the dashboard may still flag the
optional `<all_urls>` as a broad host permission. Plan for **several business days, up to
two or three weeks** for the first submission, possibly with a follow-up email asking for
clarification. Submit with **"Publish automatically after review" turned off** (deferred publishing)
so you control when beta testers get it.

---

## 1. "The extension does nothing without external software" (high)

On its own, without the helper, the extension shows a setup page and a side panel that says "helper
not connected". A reviewer who installs it and clicks around sees no function. This risks rejection
under the **minimum functionality** policy, or "couldn't verify functionality".

Mitigations:
- **Make the helper installable by a stranger before submitting.** Today the repo has no git remote
  and the npm package `timsrobot` isn't published (npm refused `trif` on 2026-11-05 as too close to other names). The
  setup page and listing say `npx timsrobot setup`, so that command must work for the reviewer.
  Either publish the npm package, or host a tarball or public repo and change the instructions.
- Say clearly in the **listing description** (already done in `listing.md`) that a separately
  installed helper and a coding agent are required.
- Fill in the dashboard's **Test instructions** field with the steps below. They include a path
  that **needs no AI account**, so the reviewer can see mods working with just the helper.
- Optional, strongly recommended: a 1–2 minute **unlisted YouTube screen recording** of install,
  helper setup, the "Allow User Scripts" switch, a side panel chat and the result. Link it in the test
  instructions and as the listing's promo video.

## 2. Remote code / userScripts misuse (high)

The MV3 policy bans remotely hosted code. Reviewers will ask where the scripts that `userScripts`
runs come from. Agent-written code delivered over native messaging is a new pattern and may confuse
them.

Mitigations:
- The remote-code answer in `listing.md` explains it: the scripts are user scripts the user's own
  local agent writes, saved as files the user owns, delivered from a local program. The developer
  has no way to push code. It's the same model as Tampermonkey or Violentmonkey.
- Keep it true. Never add a feature that downloads mods from a URL or catalogue, including "community
  mods", without revisiting this.
- **Known weak spot:** the extension also registers **its own bundled page helper** (`runtime.js`,
  script id `webmods-runtime`) through `userScripts`, not as a content script. A strict reviewer
  could call that using userScripts for extension code. It's packaged code, not remote, and the
  justification text mentions it. If review objects, move it to
  `chrome.scripting.registerContentScripts({ world: "MAIN", runAt: "document_start" })`. The
  recording set embedded in its code would then have to come from somewhere else, for example a
  second tiny registered script.
- `chrome.userScripts.execute` runs code the user's agent sends via the `trif run` command. Same
  argument: it's user-provided and local. The helper's socket is mode 0600, so only the user's own
  account can reach it.

## 3. The "Allow User Scripts" switch (medium-high)

Since Chrome 138 (the minimum the manifest allows), `userScripts` only works after the user turns on
**Allow User Scripts** on the extension's details page. A reviewer who skips the switch sees "user
scripts are off" errors and can't see mods run.

Mitigations:
- The setup page that opens on install already detects this and has an "Open TRIF’s Chrome settings"
  button. Put the switch as step 2 of the test instructions.
- **Bug to fix before submitting:** `extension/lib.js` builds `SETTINGS_URL` from the hard-coded dev
  ID `iaablflfafmonebdomeikadolkgdbkhe`. The store build gets a different ID, so the side panel's
  "Allow User Scripts" button and the "user scripts are off" message would point at
  `chrome://extensions/?id=<wrong id>`. Use `chrome.runtime.id` at run time instead. The setup page
  (`onboarding.js`) already does this. This guide only lists the bug: its author was asked not to edit
  that file.
- Consider raising `minimum_chrome_version` to `"138"`. Then every user gets the same, documented
  switch instead of a Developer-mode requirement.

## 4. Permission scope: optional `<all_urls>`, `tabs`, `scripting`, `activeTab` (medium-low)

- Sites are asked for one at a time, from a click in the side panel (`chrome.permissions.request` for
  `*://<site>/*` and `*://*.<site>/*`), and given back with "Disconnect" (the power button's off keeps it,
  for a quick before and after). `<all_urls>` is requested only when the user picks "Allow TRIF on every
  site" (setup page or panel settings, with a line saying Chrome will say it can read and change all data
  on all websites), and "Limit TRIF to the sites it's on" gives it back. Say so if asked: mods can be for
  any site the user picks, hence the wide optional entry. A never list keeps TRIF off chosen sites.
  Users who installed while `<all_urls>` was required keep it (Chrome keeps a granted permission that
  moves to optional); that isn't something new users get.
- **`tabs` is needed now.** Without host access, Chrome hides `tab.url` and `tab.title` of sites TRIF
  isn't allowed on unless it has `tabs`, and the side panel must know the site of the current tab to offer turning TRIF on
  there; `trif tabs` and tab selection by URL need them too. It brings the "Read your browsing history"
  install warning; the justification in `listing.md` says why.
- `activeTab` (no install warning) is for screenshots: Chrome's `captureVisibleTab` wants `<all_urls>` or
  `activeTab`, a site's own access isn't enough. The toolbar button opens the side panel from
  `action.onClicked` so that its click grants it.
- `scripting` is used for page text and debugging reads. Its justification is specific. Keep it.

## 5. Privacy disclosures must match the code (medium)

- The privacy policy URL must be **live** when you submit. Host `store/PRIVACY.md` publicly first.
- The data-use boxes in `listing.md` are deliberately cautious: they include website content, web
  history, personal communications, user activity and authentication information, because of the
  optional request recorder. Under-declaring is what gets rejected; over-declaring is safe.
- The policy says page content goes to the user's AI provider through the user's own agent. Keep
  the listing's "Privacy" paragraph consistent with that wording.
- The extension makes no network requests itself, and a grep of `extension/` confirms it. The only
  `fetch` and `XMLHttpRequest` references are in `runtime.js`, which wraps the page's own requests
  to record them in page memory when recording is on. Keep it that way, or update the disclosures.

## 6. Single purpose (medium-low)

The extension also does tab automation for the agent: open, navigate, reload, screenshot, record
network requests.

**Copy windows (`trif screenshot --copy`).** (Only with access to every site, i.e. for users who installed
TRIF when `<all_urls>` was required: a new user's TRIF refuses `--copy`, see §4.) For a tab that isn't showing, Chrome can't capture it
without switching tabs, so when the agent asks for a copy the extension opens a new, unfocused window
at the edge of the screen (`chrome.windows.create`), loads the same URL there (with the user's cookies,
like any tab), captures it with `captureVisibleTab` and closes it, usually within a couple of seconds.
A reviewer watching may see a window flash at the screen's edge. It's never the default (the agent must
ask, and is told to prefer text checks), it only happens on sites the user turned TRIF on for and,
in a side-panel chat, on that chat's site (the final URL is checked before each capture), addresses
that look like one-time links (tokens, sign-in callbacks, confirm and unsubscribe links) are refused,
and a window left by a crash is closed on the next start. Say so if asked why the extension opens
windows. A reviewer might see "browser automation tool" plus "script manager" plus "AI chat"
as several purposes. The single-purpose statement in `listing.md` frames everything as building and
running the user's site mods. Keep the description focused on that and don't advertise general
automation.

## 7. AI agent safety (low-medium)

An agent that reads arbitrary pages and can run scripts in the user's tabs is a prompt-injection
surface, and reviewers increasingly ask about it. Mitigations already in the helper: the agent runs in an
operating-system sandbox (macOS Seatbelt) with no network for its commands, can change mods only for
the site it was started on, can't read TRIF's private folder (settings, logs, other sites' screenshots)
or the rest of the home folder, and its page commands only reach that site's tabs; WebFetch and
WebSearch are disallowed; AGENTS.md forbids acting on page instructions and account-changing clicks. Mention this briefly if asked. The privacy
policy also warns users.

## 8. Trademarks (low)

Naming "Claude Code", "Codex", "Anthropic" or "OpenAI" in the description as compatible tools is
normally acceptable nominative use. Keep them **out of the name, icon and promo images**, and don't
make X or YouTube logos the focus of screenshots.

## 9. Packaging details (low)

- The `key` field is removed by `scripts/build-extension.js`. The store assigns a **new extension ID**,
  shown in the dashboard as soon as the draft item is created, before review.
- The helper must accept that ID: add it to `STORE_EXTENSION_IDS` in `helper/lib/paths.js` (the slot
  is already there) and release the helper, so `trif setup` writes it into the native host
  manifest's `allowed_origins`. If you don't, the store-installed extension can't connect to the
  helper at all.
- Version: the root `package.json` and `extension/manifest.json` must match (a test checks this).
  Every later upload needs a higher version.
- The icon is a robot head: a dark squircle in a green rim with two mint eyes. Its shapes are numbers in
  `scripts/render-icon.js`, which draws the PNGs and `store/icon.svg`; run it after changing them.

---

## Reviewer test instructions (paste into the dashboard's "Test instructions" field)

Replace `<…>` first. Keep it under the field's character limit. If it's too long, link a public page
holding these steps.

```
TRIF runs site customizations ("mods") written by the user's own coding agent. It needs a small helper program on the computer (macOS or Linux, Node.js 18+). Without the helper, the extension only shows its setup page. The steps below take about 3 minutes, and the main path needs no AI account.

1. Install the extension, then install the helper in a terminal:
     npx timsrobot setup
   (or: <alternative install instructions / tarball URL>)
   Quit and reopen Chrome.
2. A "TRIF setup" page opens (or click the toolbar icon, then "Setup"). Turn on "Allow User Scripts": click "Open TRIF’s Chrome settings" and switch it on. The setup page ticks off "Install the helper" and "Allow user scripts".
3. Create a mod without any AI account. In a terminal:
     mkdir -p ~/.trif/sites/example.com
     printf '%s\n' "document.addEventListener('DOMContentLoaded', () => { document.querySelector('h1').textContent = 'Hello from TRIF'; });" > ~/.trif/sites/example.com/hello.js
4. Open https://example.com. The heading reads "Hello from TRIF". Click the TRIF toolbar icon: the side panel lists the "hello" mod for this site. Switch it off and the page reloads with the original heading.
5. Optional, needs a Claude Code login: install Claude Code (https://claude.com/claude-code), then in the side panel on example.com type "make the background light yellow". The agent writes a mod and reloads the page. If Claude Code isn't logged in, the panel shows a "Log in" button.

Demo video: <unlisted YouTube URL>
TRIF has no server and sends nothing to the developer. Privacy policy: <PRIVACY POLICY URL>
```

Before submitting, check steps 1–4 yourself on a clean Chrome profile with the **store build**. Load
`dist/extension/` unpacked: it has no `key`, so it gets a different ID, like the store version. The
helper won't connect until that ID is in `allowed_origins`. For local testing, add it to
`~/Library/Application Support/TRIF/config.json` as `{"extensionIds": ["<id>"]}` and rerun `trif setup`.
