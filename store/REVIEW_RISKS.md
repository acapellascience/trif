# Chrome Web Store review risks: TRIF 0.3.x, public listing

The reasoning behind the answers in `CHROMEWEBSTORE.md` (the copy-paste source): what is likely to slow down
or fail review, most likely first, what the listing says about it, and what to do if review objects. Updated
2026-11-15 for 0.3.0 (the first submission will be 0.3.1, with the store ID).

## Expect a long, manual review

`userScripts`, `nativeMessaging`, `tabs`, `scripting`, `declarativeNetRequest` and an optional `<all_urls>`
together put TRIF in the slowest queue. Plan for several business days, up to two or three weeks, for the
first submission, possibly with an email asking for clarification. Submit with deferred publishing (the
listing goes live when Tim publishes it), so the release whose setup points at the store can go out first.

---

## 1. "Couldn't verify functionality" / minimum functionality (high)

Without the helper the extension shows its setup page and a panel that says the helper isn't connected. A
reviewer who doesn't install the helper sees nothing work. Worse: **the helper runs on macOS and Linux only**,
and a reviewer on Windows or ChromeOS can't install it at all.

What the listing does:
- The description says what's needed: a Mac or Linux, the helper (`npx timsrobot setup`, Node 18+), an agent
  or Robotless mode.
- The test instructions have a path with **no AI account**: Tim's Google mods (Oppish is impossible to miss),
  Robotless mode, and a four-line `@style` mod for example.com typed in a terminal.
- They point at the live demo on timsrobot.com ("Try the demo"), which runs the real side panel's code with
  no install, for a reviewer who can't run the helper.

If review says it couldn't verify: reply with a 1 to 2 minute unlisted screen recording (install, setup,
"Allow User Scripts", Fix google.com, Oppish on; then a chat), and add it as the promo video.

**Must be true when submitting:** `npx timsrobot setup` installs a helper that accepts the store's ID. That's
0.3.1 on npm (step 2 of "Order of steps" in CHROMEWEBSTORE.md). With 0.3.0 the store's TRIF never connects:
the reviewer would see "The TRIF helper isn't connected" whatever they do.

## 2. Remote code and the userScripts policy (high)

MV3 bans remotely hosted code; userScripts is the exception for **user scripts**. Reviewers will ask where the
scripts TRIF runs come from. Three sources, and how the listing describes each:

| Source | What it is | Risk |
|---|---|---|
| Mods the user's agent writes | User scripts: written at the user's request, on the user's computer, by the user's own agent, saved as the user's files, delivered by a local program. Same model as Tampermonkey with scripts the user wrote. | Low: this is what the API is for. The new part (an AI writes them) is the user's tool, not the developer's. |
| Code the agent runs in a tab (`trif run`, `userScripts.execute`) | The user's agent's code, for the tab it works on, at the user's request; by default in TRIF's box world (no network, can't act); in the page's world only where the user's per-site setting allows it, with the tab locked first. | Low to medium: a reviewer may read "executes arbitrary code". Answer: user-provided, local, scoped to sites the user allowed. |
| **Tim's mods** (developer-written, shipped in the helper package on npm/GitHub, not in the extension) | Optional: none is added unless the user picks its site on the setup page; each starts off; updated ones start off again; they're files the user can read and edit. They come with helper updates (signed feed), not through the Web Store. | **Medium, the one to watch.** A strict reading: code by the developer, not in the package, run through userScripts, updated outside store review. The listing says so plainly rather than hiding it. |

If review objects to Tim's mods, in order of least change:
1. Explain the opt-in (none by default, chosen per site, start off, editable files) and that script managers
   routinely offer scripts from catalogues the user picks from. Often enough.
2. Ship Tim's mods **in the extension package** too (packaged code is reviewed with each version), and have the
   helper use the packaged copy for store installs: their fixes then wait for store review like any code.
3. Leave Tim's mods out of the setup page for the store's TRIF (a terminal command could still add them).

Other remote-code points, all answered in the justification:
- **SES and `'unsafe-eval'`:** boxed mods run through SES (vendored, sha256 pinned) in the `trif-sandbox` user
  script world, whose CSP (`configureWorld`) allows `'unsafe-eval'` for SES's evaluator and no network at all
  (`connect-src 'none'`). The extension's own pages keep MV3's default CSP. What SES evaluates are the mods,
  i.e. user scripts.
- **The page helper** (`runtime.js`, registered through userScripts as `webmods-runtime`) is packaged code,
  not remote; it records mods' errors and, where the user turned recording on, the page's requests. A strict
  reviewer could say userScripts is for user scripts only. If so, register it with
  `chrome.scripting.registerContentScripts({ world: 'MAIN', runAt: 'document_start' })` instead.
- Keep it true: never add a feature that fetches mods from a URL or a catalogue (for example "community
  mods") without revisiting this section and the policy.

## 3. The "Allow User Scripts" switch (medium)

Chrome 138+ (the manifest's minimum) runs user scripts only after the user flips **Allow User Scripts** on the
extension's details page. A reviewer who skips it sees "Mods are paused". The setup page's step has "Open
TRIF's Chrome settings" (it uses `chrome.runtime.id`, so the store ID works; the 0.2-era bug of a hard-coded
dev ID in `SETTINGS_URL` is fixed: lib.js uses `chrome.runtime.id`), and the test instructions make it step 2.
Chrome's own warning under the switch ("code which has not been reviewed by Google") is expected for every
user script manager.

## 4. Permissions (medium-low)

- **Host access is optional and per site.** 0.3.0 asks for one site (`*://*.<site>/*`) when the user clicks
  "Fix <site>", and gave up `<all_urls>` once for anyone who had it. The optional `<all_urls>` entry is only
  there because sites can't be listed in advance; the dashboard may still flag it as broad. The justification
  says how it's narrowed.
- **`tabs`** ("Read your browsing history"): the panel must know the current tab's site before TRIF has
  access to it, to offer "Fix <site>". Justified specifically.
- **`activeTab`**: screenshots only (captureVisibleTab needs it without all-site access).
- **`declarativeNetRequest`** ("Block content on any page"): block-only session rules for the tab lock. The
  description explains the install warning in plain words.
- **`unlimitedStorage`**: mods up to 16 MB cached locally. **`scripting`**: page text, mod errors, the tab
  lock's marker.
- Every permission in the manifest is used (checked against the code 2026-11-15); none is left over.

## 5. Privacy disclosures must match the code (medium)

- The policy is `store/PRIVACY.md`, published at https://timsrobot.com/privacy (built from that file by
  `site/build-pages.js`). Brought up to date for 0.3.0 on 2026-11-15: per-site access and blocked sites,
  per-site agent levels, history and trash, Tim's mods, dropped files, mod errors, robotless mode, the Web
  Store's own updates, and the two-TRIFs message (which stays inside the browser). **Deploy the site before
  submitting**; the URL must load.
- The extension makes no network requests itself. `grep -rn "fetch(" extension/` finds only: `explain.js`
  (its own packaged `explain.json`), `screenshot.js` (a data: URL of its own capture), `runtime.js` (wraps the
  page's own requests to record them when recording is on), `safari.js` (Safari's bridge to 127.0.0.1). Keep it
  that way, or update the disclosures.
- New in 0.3.1: `chrome.runtime.sendMessage(<other TRIF ID>)`: extension to extension, inside Chrome, only
  to the IDs the helper names; it says which sites each runs mods on. Disclosed in the policy's table.
- The data-use boxes are cautious (website content, web history, personal communications, user activity,
  authentication information) because of the optional request recorder and the agent. Over-declaring is safe;
  under-declaring is what gets rejected.

## 6. Single purpose (medium-low)

The extension also does tab automation for the agent (open, reload, screenshot, record requests), and a
reviewer might see "script manager + AI chat + browser automation" as several purposes. The single-purpose
statement frames everything as building and running the user's site mods, and the description doesn't
advertise general automation. Keep it that way.

**Copy windows** (`trif screenshot --copy`): only when TRIF has access to every site, which after 0.3.0 means
the user granted it in Chrome's settings themselves. The extension then opens an unfocused window at the edge
of the screen for a second to capture a background tab. A reviewer won't see it with per-site access.

## 7. AI agent safety (low-medium)

Prompt injection is the obvious question. What to say if asked (docs/SECURITY.md, docs/SECURITY-TIERS.md):
the side-panel agent runs in an OS sandbox with no network for its commands and can change only that site's
mods; its code runs in TRIF's box by default; JavaScript in the page itself locks the tab first
(declarativeNetRequest blocks every state-changing request); a mod that can post or send waits for the user's
OK; sensitive sites start blocked; per-site "Agent: Off / Look / Ask first / Run code".

## 8. Two TRIFs in one profile (new; low for review, high for users)

People moving from the unpacked TRIF install the store's alongside it. Chrome keeps each extension's storage,
site access and switches apart, so the store's starts empty: no sites on, every mod "new" and off. 0.3.1
handles it (extension/twins.js): each TRIF asks the other TRIF IDs the helper names, and the unpacked one stops
running mods on every site the store's runs mods on, so nothing runs twice and nothing stops before the store's
TRIF has it; both panels and `trif doctor` say to remove the unpacked one. An unpacked TRIF older than 0.3.1
can't answer; `trif doctor` then warns when both kinds are connected in one browser ("if they're in the same
profile"). Not handled: carrying switches and chats over (a possible follow-up: the store's TRIF could ask the
unpacked one for them over the same channel).

The reviewer has only the store's TRIF, so it doesn't arise for them.

## 9. Version skew: the store's extension vs the helper (low for review, medium for users)

The helper updates from TRIF's signed feed when the user clicks Update; the store's extension updates when
Google approves the version, days later. So the store's extension is often a version **behind** the helper.
- The helper copes: everything newer is behind the extension's hello `features` (`modsParts`, `modsSame`,
  `boxRun`); a command the extension doesn't know answers "the extension is version X and doesn't know `cmd`
  yet", now with "Chrome updates it from the Chrome Web Store by itself". The panel and `trif doctor` say the
  extension is behind (host.js extensionBehind, doctor storeChecks), as for Firefox.
- **What doesn't cope:** a feature that needs both halves isn't there until the store catches up. Notably,
  Tim's mods update with the helper: a shipped mod that relies on a new box power or runtime feature breaks
  (or is refused by the older sandbox) on the store's extension until it updates. Rule for releases: a shipped
  mod may use a new extension feature only one release after that feature shipped, or the release waits to
  publish its feed until the store has approved the extension (`release.js refresh-feed` later).
- The other way round (an extension newer than the helper) happens when someone doesn't update the helper;
  new extension features that need a new helper must check its version (the update info's `current`) or
  degrade.

## 10. Trademarks (low)

Claude Code, Codex, Anthropic, OpenAI, Google, X, Amazon and Instagram are named in the description as
compatible agents or as sites Tim's mods are for (nominative use). None is in the name, icon or images; the
screenshots use a made-up site.

## 11. Packaging (low)

- `scripts/build-extension.js` removes the manifest's `key`; the store assigns its own ID, shown as soon as
  the draft exists. The release's `trif-chrome-<version>.zip` is already key-free.
- Every upload needs a higher version than the last. Root `package.json` and `extension/manifest.json` must
  match (a test checks it).
- The icon is the robot head (`scripts/render-icon.js` draws the PNGs and `store/icon.svg`).

## Before submitting

Load `dist/extension/` (from `node scripts/build-extension.js`) unpacked in a clean Chrome profile: it has no
`key`, so it gets a different ID, like the store's. The helper accepts it only once that ID is allowed: add it
to the private folder's `config.json` as `{"extensionIds": ["<id>"]}` and rerun `trif setup` (once the store
ID is in paths.js, a store install needs nothing). Then run the test instructions' steps 1 to 6. Check that
https://timsrobot.com/privacy and /support load.
