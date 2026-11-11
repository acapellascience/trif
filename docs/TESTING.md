# Testing TRIF

Two suites:

- **Unit tests** (fast, no browser): `node --test --test-concurrency=2 --test-timeout=120000`. That's
  what `npm test` runs, and what `scripts/release.js` runs. `tests/upgrade.test.js` among them is a real
  upgrade without a browser: the v0.1.2 updater (from `git archive v0.1.2`, set up by its own setup in a
  scratch home) installs this checkout packed at the next version, with a test signing key; skipped
  without the tag.
- **End-to-end browser suite** (opt-in, real browsers): `node tests/e2e/run.js`. Run it before each
  release. It isn't part of `node --test`.

## The e2e suite

```sh
node tests/e2e/run.js [firefox|chrome|all] [--agent] [--codex] [--guidance] [--upgrade-from <old.tgz>]... [--skip-fresh]
                      [--work <dir>] [--out <dir>] [--headful] [--claude-model haiku] [--codex-model <m>]
```

Before a release, run it like this (about 2 minutes for Firefox; the agent runs cost a few cents):

```sh
node tests/e2e/run.js firefox --agent --codex \
  --upgrade-from dist/release/0.1.2/webmods-0.1.2.tgz --upgrade-from dist/release/0.1.1/webmods-0.1.1.tgz
```

(and `chrome` or `all` once Chrome for Testing is installed, see below). It prints PASS / FAIL / WARN per
check and a summary, and exits non-zero if anything failed. Screenshots of the key steps, the console
and helper logs, the TCC log and the agents' answers are in the results folder it prints (by default
`/tmp/trif-e2e-<uid>/results/<time>/`; `log.txt` has everything, `summary.txt` the summary). Look at
the screenshots: the suite checks behaviour, not looks.

### What each scenario does

Per browser, a **fresh** scenario, and an **upgrade** scenario per `--upgrade-from` tarball:

1. `npm pack` this checkout, unpack it, and run the package's own `helper/cli.js setup --copy --no-link
   --browser <b>` with `HOME` set to a scratch folder, so `~/.trif`, `~/.webmods` and the browsers'
   `NativeMessagingHosts` folders are all inside it.
   Upgrade: first the old release's setup (making `~/.webmods`), then a mod of the user's
   (`sites/127.0.0.1/e2e-user.js`) and an edit to a shipped one (`x.com/rainbow-rave`), then the new
   setup run the way a 0.1.x updater runs it (`--home ~/.webmods`). Checks the move to `~/.trif`, the
   link left behind, the user's mod, and that the edited shipped mod is kept with its new version
   waiting. If the old and new packages ship the same `rainbow-rave`, the harness gives the new package's
   copy the next `@version` (as the next release would) and says so in a note. When the old release
   shipped the mods 0.2.0 folded into others (`RETIRED`: `hide-ai-mode`, `hide-sponsored`), checks their
   unchanged copies went to the trash, and (step 2) that the browser carried their switches over
   (chrome.storage.local `absorbed`).
2. Start a throwaway browser profile with the extension, connected to the scratch helper only (see
   "Isolation"), check the setup page's checklist (the helper and the browser ticked, user scripts
   next), allow user scripts (it ticks that step itself; Tim's mods are next, a checklist by site with none
   on disk yet: it leaves X and Google ticked and clicks "Add these", and checks only theirs arrive and only
   those sites are on; upgrading, the step is ticked with every site it had), and check: `trif status` (the extension's hello, its browser),
   `trif doctor`, the shipped mods (`trif mods`, each starting off, the sites TRIF starts on for).
   There's no Site permissions step (TRIF asks for each site's permission when it's turned on there): the
   agent's login is next, and the sites setup turned on wait to be connected (fresh Firefox: all of them;
   Chrome's test build has its test hosts).
3. Against a local test site (`http://127.0.0.1:<port>`, `http://localhost:<port>`) with a mod the
   harness writes, and the panel opened as a window following the test window (`sidepanel.html?window=<id>`):
   - the site starts disconnected (fresh Firefox: nothing connected: the panel all grey, "TRIF
     is disconnected on 127.0.0.1" and Connect) or off ("The robot is off.", "Fix 127.0.0.1", and below it
     "Block on 127.0.0.1" and "Disconnect from 127.0.0.1" with their tooltips; no Disconnect when the browser
     gives every site); the mod doesn't run; the top bar only the status dot, the robot, grey and dim, the
     power button (to turn it on from there) and settings (blocked or disconnected: no power button); the
     button runs the mod;
   - the mod's switch in the panel off and on (page reloads, `trif status` agrees), `trif disable` /
     `trif enable` from the CLI (page and panel follow), the site switch off (nothing runs, page
     commands refused, the access kept) and on again; the same with the robot in the top bar (off like the
     power button, on from the gate like Fix, a little brighter under the mouse);
   - Firefox: Disconnect gives the access back (grey, `trif text` and `trif status` say disconnected),
     Connect asks (granted: prompts are off) and turns it on in one click; the same after the access is
     taken away as the browser's settings would (`permissions.remove`); then the update from a permissive
     0.2 (`siteMode` set, `<all_urls>` given, the add-on restarted): every site's access goes once, the
     sites keep their switches (x.com disconnected, 127.0.0.1, granted on its own, still connected), the
     panel's one-time note and its OK; then the suite's sites are given one by one, as Chrome's build has
     them;
   - "Block on 127.0.0.1": the mod stops, `trif text`, `screenshot` and `run` are refused with the block
     wording, the panel is red ("The robot is blocked on 127.0.0.1", Unblock), Settings lists it; Unblock
     leaves it off or disconnected, and its button turns it on again;
   - the panel follows tab switches and navigation; a mod for `localhost`, where TRIF stays off, never runs.
   - mods just over 1 MB in all (a 1 MB base64 mod and 0.4 MB of functions) go in parts and run; a change
     to the small one goes without the big one's code (`modsSame`), and the big one still runs; a mod over
     the 4 MB cap isn't sent, and `trif status` and `trif doctor` say why. Kept small on purpose: see "Big
     mods and memory" below for sets up to the 16 MB cap.
   - Chrome: TRIF's toolbar button opens the real side panel (no panel window, nothing remembered) and
     closes it. Then, as in Arc, with the side panel made not to open (the test build's `sidePanel.open`
     resolves and does nothing while `chrome.storage.local` `e2eNoSidePanel` is true): the click opens the
     panel in a window beside the test window, which follows that window's tabs (127.0.0.1, localhost,
     back), closes on the next click, opens at once on the one after (remembered), closes with its browser
     window (another window's, not the suite's own panel window); fresh, the click still gives `activeTab`
     (a screenshot of that tab refused before it, captured after). Last, with the side panel back while
     TRIF still remembers the window: the side panel shows, the window closes again, and it's forgotten.
   - `trif sweep --selector/--text/--color` on a page of repeated things (`/sweep.html`: regions, a sticky
     header, a shadow root, a same-origin frame, a CSS variable) finds the expected counts; `trif status
     --tab` lists the mods on that page. Screenshots, restrictive (fresh Chrome): of that tab while it's in
     the background, `--full` and `--copy` are refused with a hint and change nothing; the tab in front is
     refused until TRIF's toolbar button is clicked on it (`Extensions.triggerAction`, which gives
     `activeTab`), then captured. Fresh Firefox: the background capture is refused with the same hint.
     With access to every site from the start (upgrade scenarios): `trif screenshot` and `--full` of the
     background tab work (Firefox: the tab itself; Chrome: refused with a hint about `--copy`, then with
     `--copy`, a copy in a window of its own) and leave every window's active tab, the focused window and
     the window count as they were. Headless Chrome gets
     `--screen-info={0,0 2560x1440}`: its default 800x600 screen is smaller than the windows, which puts
     the copy window under the user's, where Chrome stops drawing it.
4. **Detox Timeline**: the real `examples/sites/x.com/detox-timeline.js` on `https://x.com:<port>/home`, served
   locally (the browser resolves x.com to 127.0.0.1 and accepts a self-signed certificate): a page that
   fetches and XHRs a saved `HomeLatestTimeline` response, as X does. Checks Detox Timeline keeps only the
   mutuals' plain posts and the cursor, rewrites the requests to Recent, and logs no mod errors. Then the
   panel on x.com lists the shipped mods (and, upgrading, offers the edited mod's new version). Then
   what's in the way, in colour, on the site's page, the gate and the landing page: the agent not logged
   in (yellow; not on the landing page), user scripts off (all red, "Mods are paused" above the login
   notice), and the helper not connected (its wrapper moved aside and the scratch helper stopped: red,
   but the mods' switches green, since mods still run; then put back and reconnected with Try again). Then
   the setup page all ticked ("TRIF is ready", Try it with the sites where a shipped mod is on) once the
   agent can run: an API key for Claude Code in the scratch keychain counts as logged in. Then (without
   `--agent`/`--codex`) an expired login, with a stand-in `claude` put first on the helper's PATH for the
   check: it says it's logged in and fails every run as Claude Code does when its login can't be
   refreshed; a panel chat must show the login notice and one plain "needs you to log in again" line (not
   the agent's error), with the message back in the box, and `trif agent run` must say how to log in. Then
   screenshots of the panel as narrow as a side panel: on x.com, on a gate (localhost) and on the landing
   page (no website: the big robot, only settings in the bar), each of the last two with settings open
   (they must open, list the agents and load the instructions). And the shipped Google mods, AI
   Banisher and Just Results, on stand-ins for Google's results and home pages
   (`https://www.google.com:<port>/search?q=trif` and `/`, in background tabs, with the parts of Google's
   markup they key on): what they hide is hidden, and the web results, the other tabs and the search
   box stay.
5. With `--agent`: real Claude Code runs (model haiku unless `--claude-model`): a panel chat (`/model`,
   then a request) that must write a mod under `sites/127.0.0.1/` that shows on the page; `trif agent
   run` asked which browser it's in (must name it); and asked to read TRIF's `config.json` in the private
   folder (the scratch home's `~/Library/Application Support/TRIF`, which holds a random canary; the helper,
   which runs with your real HOME for agent runs, is pointed at it with `TRIF_PRIVATE`) and list
   `~/Documents` (both must fail; the canary must not appear in the answer or the run's raw log). Without
   `--oss` the helper and CLI get a keyring tool that doesn't exist, so your real Keychain isn't asked
   about API keys. Upgrading, setup must have moved the private files out of the workspace. With `--codex`, the same with Codex (`trif agent run` for the mod).
   Then the macOS privacy (TCC) decisions made for the helper and the agents it started (they count as
   the helper's), and anything codex or rg asked, from `log show`; folder-level ones (Documents,
   Desktop, Downloads…) are a WARN, since those can put a dialog on screen.
   With `--guidance` (opt-in, a few cents with haiku; `--guidance-repeats N`): the same requests ("hide
   the promos, like the "Promoted · Deal 1" one", "make the blue stuff pink") on `/promos.html` (12 promos
   in several markups across the page, a shadow root and lazy-loaded ones; a brand blue in many places)
   with the AGENTS.md from `main` and the one in this checkout, a `trif agent run` each. No pass/fail:
   `guidance.json` and `guidance-*.txt` in the results have, per run, the promos and blue elements still
   visible afterwards, the posts still visible, the sweeps the agent ran, and its transcript.
6. Console warnings and errors from the extension (background, panel, setup page) and the pages; WARN
   and ERROR lines in the scratch `helper.log` (except the "user scripts aren't allowed" ones from
   before the harness allows them); and that your real native host manifests and `~/.trif` /
   `~/.webmods` configs are unchanged.

Agent runs need your real logins, which live in your real home folder, so with `--agent`/`--codex` the
browser (and the helper and agents it starts) gets your real `HOME`, with `TRIF_HOME` pointing at the
scratch workspace. Without them the helper's `HOME` is the scratch folder, so the panel says Claude Code
isn't logged in: expected. Runs' mailboxes then go in your real `~/Library/Caches/TRIF/boxes` (removed
when each run ends).

### Isolation

Nothing of your real setup is used: not your browser profiles, not `~/.trif`/`~/.webmods`, not the
native host manifests in `~/Library/Application Support/{Google/Chrome,Mozilla}/NativeMessagingHosts`.

- **Firefox** (`/Applications/Firefox.app`, or `TRIF_E2E_FIREFOX`): a new profile under the work folder,
  headless, driven over WebDriver BiDi. Firefox finds `~` from the system, not `$HOME`, so it would read
  your real NativeMessagingHosts folder (checked: its `XREUserNativeManifests` stays in your real home
  with `HOME` changed). So it starts with `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, and before the add-on is
  installed the harness replaces Firefox's native-manifest lookup, in the browser's own privileged
  context, with one that reads only the scratch home's folder. The add-on (`dist/firefox`, built from
  this checkout) is installed temporarily (`webExtension.install`) with a pinned internal UUID, and
  `extensions.webextOptionalPermissionPrompts` off so "Allow user scripts" on the setup page grants
  userScripts without a prompt. `network.dns.forceResolve` sends every host to 127.0.0.1.
- **Chrome** needs Chrome for Testing (branded Chrome 137+ ignores `--load-extension`): set
  `TRIF_E2E_CHROME` to its binary, or install it into `tests/e2e/.browsers` with
  `npx @puppeteer/browsers install chrome@stable --path tests/e2e/.browsers` (a large download).
  It runs with `--user-data-dir=<scratch HOME>/Library/Application Support/Google/Chrome`: Chrome reads
  per-user native host manifests from `<user data dir>/NativeMessagingHosts`, which is exactly where
  setup (with `HOME=<scratch>`) wrote it. The extension loads from the scratch `~/.trif/app/extension`;
  developer mode is pre-set in the profile's Preferences, and "Allow User Scripts" is turned on with
  `chrome.developerPrivate.updateExtensionConfiguration({userScriptsAccess: true})` in
  chrome://extensions, as its switch does. Driven over CDP. **Not yet run**: written against Chrome for
  Testing, but untested until it's installed.
- Leftover processes using the work folder are killed at the end.

### Site access

TRIF's sites are optional host permissions (docs/PROTOCOL.md "Site access"), granted only through the
browser's own prompt. **Firefox** runs the real manifest: with `extensions.webextOptionalPermissionPrompts`
off, `permissions.request` from a real click says yes without a prompt, so the suite goes through the
actual asking, granting and removing, and takes access away with `permissions.remove`. **Chrome** can't
answer its prompt from automation (no switch, CDP command or `developerPrivate` call grants an optional
host permission; checked in Chrome for Testing 156), so it loads a copy of the extension (in the scratch
home) whose manifest makes the suite's sites required host permissions: 127.0.0.1, x.com, google.com and
timsrobot.com, each with its subdomains. To TRIF that's a user who allowed those sites (`permissions.request`
for them says yes at once); localhost, amazon.com and instagram.com have no access. Upgrade scenarios give
TRIF `<all_urls>` from the start, as for a user who installed it when it was required (Chrome and Firefox
keep that grant when it moves to optional): Chrome's test build makes it required; Firefox asks for it from
a click right after installing (after TRIF's first start, so its one-time step that gives up every site
has run: that's checked in the fresh Firefox run instead), then restarts the add-on. Not covered by the suite: Chrome's prompt itself and saying no to it (unit tests
cover what TRIF does then), Firefox's `activeTab` screenshot after a toolbar click.

The Chrome test build also has `e2e-background.js` as its service worker: it imports `e2e-no-side-panel.js`
(the `e2eNoSidePanel` switch above) before `background.js`. Nothing else changes; the switch is off unless a
check turns it on.

Paths stay short (`--work` defaults to `/tmp/trif-e2e-<uid>`): the helper's unix sockets live in the
scratch home, and macOS allows about 104 bytes for a socket path.

### Big mods and memory

`node tests/e2e/measure-big-mods.js firefox|chrome --work <dir> --sizes 1,2,4,8,16 --mod-mb 4 [--kind code]
[--changes 8] [--over] [--reports] [--minimize]` (not part of the suite; see the top of the script). It
installs this checkout as the suite does, writes that many MB of mods for the test site (at most the 16 MB
cap), and prints the footprint of all the browser's processes after registering them, after page loads,
after changes in a row and after removing them; `--over` then writes mods over the caps, which the helper
must refuse. The numbers it gave are in docs/PROTOCOL.md, "How big mods can be".

A 48 MB set once took headless Firefox to 7.4 GB and the Mac ran out of memory, so: go up a size at a
time and stop if memory grows faster than the mods do; one browser at a time; a `--work` folder of its
own. The script kills the browser if all its processes together pass `--limit-mb` (2048 by default), but
it samples once a second, so also run it under something that kills a runaway process sooner.

### TRIF's own home page with the real extension

`node tests/e2e/homepage.js --work /tmp/trif-home` (a short `--work`: the helper's sockets live in it; add
`--out <dir>` for the screenshots, `--headful` to watch). It serves the home page, demo and all, from this
checkout over HTTPS as `timsrobot.com` (the site's Worker, as `site/dev.js` runs it; Chrome resolves the name
to 127.0.0.1 and takes the self-signed certificate), installs TRIF from this checkout into a scratch home
(`setup --copy`; TRIF ships no mods for timsrobot.com) and drives headless Chrome for Testing with the
same isolation as the suite. It checks the demo, and that with the real TRIF the home page is like any
other website:

- TRIF off for timsrobot.com: nothing marks the page; the demo's tab sits outside `<body>` in the top layer;
  the demo panel starts empty, with the first recorded prompt waiting; each demo mod runs once alone, and
  all 13 together; gravity, the shooter, tilting and the rave leave the tab where it was, as it was; Escape
  on the page is Gravity's (it doesn't close the panel), Escape on the panel's close button closes it.
- TRIF turned on for the site in the real side panel (Fix): still nothing marks the page, and the demo and
  its space shooter work as before (one ship).
- A mod of the visitor's own for timsrobot.com runs alongside the demo; nothing marks the page, nor other
  sites (127.0.0.1, localhost). The robot off again: their mod stops, the demo is still there.

Each mod's effect is found by something it leaves in the page (`PROBES` in the script); when a mod changes
what it leaves, update its probe.

### What stays manual

- **Safari.** safaridriver can't run extensions, and "Allow unsigned extensions" resets whenever Safari
  quits. Before a release that touches Safari, by hand:
  1. `node scripts/build-safari.js`, open `dist/safari-app/TRIF.app` once; `trif setup --browser safari`;
     Safari → Settings → Developer → Allow unsigned extensions; Settings → Extensions: TRIF on, every website.
  2. `trif doctor`: the Safari bridge is listening.
  3. Click the toolbar button: the panel window opens and follows the window's tabs.
  4. On a test page, enable TRIF from the panel; write a small mod (or ask the agent for one); it runs
     after reload; switch it off and on; switch the site off.
  5. x.com: Detox Timeline filters the timeline; the Filters menu works.
  6. Quit Safari, reopen: allow unsigned extensions again; the panel reconnects (the bridge kept running).
- **Detox Timeline on a real, logged-in timeline** (X changes its data; the suite uses a saved response), and
  the other shipped mods on the real Google, Amazon and Instagram.
- **Look and feel**: layout, dark mode, narrow panels. The screenshots help; a person decides.
- The Chrome Web Store / signed Firefox add-on install and update paths, and `trif update` from a
  real published feed.
