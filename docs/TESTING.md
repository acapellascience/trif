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
   (`sites/127.0.0.1/e2e-user.js`) and an edit to a shipped one (`x.com/punk-fonts`), then the new
   setup run the way a 0.1.x updater runs it (`--home ~/.webmods`). Checks the move to `~/.trif`, the
   link left behind, the user's mod, and that the edited shipped mod is kept with its new version
   waiting. If the old and new packages ship the same `punk-fonts`, the harness gives the new package's
   copy the next `@version` (as the next release would) and says so in a note.
2. Start a throwaway browser profile with the extension, connected to the scratch helper only (see
   "Isolation"), allow user scripts, and check: `trif status` (the extension's hello, its browser),
   `trif doctor`, the shipped mods (`trif mods`, which start on and off, the sites TRIF starts on for).
3. Against a local test site (`http://127.0.0.1:<port>`, `http://localhost:<port>`) with a mod the
   harness writes, and the panel opened as a window following the test window (`sidepanel.html?window=<id>`):
   - the site starts off: the mod doesn't run, the panel shows "The robot is off." and "Fix 127.0.0.1"
     (the top bar only the robot, grey and dim, and settings); clicking it runs the mod;
   - the mod's switch in the panel off and on (page reloads, `trif status` agrees), `trif disable` /
     `trif enable` from the CLI (page and panel follow), the site switch off (nothing runs, page
     commands refused) and on again; the same with the robot in the top bar (off like the power button,
     on from the gate like Fix, a little brighter under the mouse);
   - the panel follows tab switches and navigation; a mod for `localhost`, where TRIF stays off, never runs.
   - `trif sweep --selector/--text/--color` on a page of repeated things (`/sweep.html`: regions, a sticky
     header, a shadow root, a same-origin frame, a CSS variable) finds the expected counts; `trif status
     --tab` lists the mods on that page; `trif screenshot` and `--full` of that tab while it's in the
     background work (Firefox: the tab itself; Chrome: refused with a hint about `--copy`, then with
     `--copy`, a copy in a window of its own) and leave every window's active tab, the focused window
     and the window count as they were. Headless Chrome gets
     `--screen-info={0,0 2560x1440}`: its default 800x600 screen is smaller than the windows, which puts
     the copy window under the user's, where Chrome stops drawing it.
4. **Plain X**: the real `examples/sites/x.com/plain-x.js` on `https://x.com:<port>/home`, served
   locally (the browser resolves x.com to 127.0.0.1 and accepts a self-signed certificate): a page that
   fetches and XHRs a saved `HomeLatestTimeline` response, as X does. Checks Plain X keeps only the
   mutuals' plain posts and the cursor, rewrites the requests to Recent, and logs no mod errors. Then the
   panel on x.com lists the shipped mods (and, upgrading, offers the edited mod's new version). Then
   screenshots of the panel as narrow as a side panel: on x.com, on a gate (localhost) and on the landing
   page (no website: the big robot, only settings in the bar), each of the last two with settings open
   (they must open, list the agents and load the instructions).
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

Paths stay short (`--work` defaults to `/tmp/trif-e2e-<uid>`): the helper's unix sockets live in the
scratch home, and macOS allows about 104 bytes for a socket path.

### What stays manual

- **Safari.** safaridriver can't run extensions, and "Allow unsigned extensions" resets whenever Safari
  quits. Before a release that touches Safari, by hand:
  1. `node scripts/build-safari.js`, open `dist/safari-app/TRIF.app` once; `trif setup --browser safari`;
     Safari → Settings → Developer → Allow unsigned extensions; Settings → Extensions: TRIF on, every website.
  2. `trif doctor`: the Safari bridge is listening.
  3. Click the toolbar button: the panel window opens and follows the window's tabs.
  4. On a test page, enable TRIF from the panel; write a small mod (or ask the agent for one); it runs
     after reload; switch it off and on; switch the site off.
  5. x.com: Plain X filters the timeline; the Filters menu works.
  6. Quit Safari, reopen: allow unsigned extensions again; the panel reconnects (the bridge kept running).
- **Plain X on a real, logged-in timeline** (X changes its data; the suite uses a saved response), and
  the other shipped mods on the real Google, Amazon and Instagram.
- **Look and feel**: layout, dark mode, narrow panels. The screenshots help; a person decides.
- The Chrome Web Store / signed Firefox add-on install and update paths, and `trif update` from a
  real published feed.
