'use strict';
// Help text for `trif help` and `trif help <command>`. Written for coding agents first:
// what each command does, its options, and short copy-pasteable examples.

const P = require('./paths');
const S = require('./preinstalled');

// The sites Tim has mods for, from PREINSTALLED ("Google, X, … and timsrobot.com"), and those TRIF doesn't
// turn on for when they're added.
const words = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const STARTER_SITES = words(S.starterSites().map(S.siteName));
const STARTER_OFF = S.starterSites().filter((s) => !S.SITES_ON.includes(s));

const COMMANDS = {
  setup: {
    usage: 'trif setup [--browser chrome|chromium|brave|edge|arc|firefox|safari|all] [--home DIR] [--copy|--link] [--no-link] [--examples [SITES]|--no-examples] [--verbose] [--no-wait]',
    summary: 'install the workspace, native messaging host and CLI link (safe to re-run)',
    details: `First time: npx timsrobot setup   (needs Node 18 or newer).
Creates the workspace (~/.trif, unless --home or TRIF_HOME says otherwise; a ~/.webmods from before 0.2.0,
when TRIF was called WebMods, is moved there first and left as a link to it) with sites/ and bin/, and the
private folder (settings, logs, screenshots; ~/Library/Application Support/TRIF on a Mac, moved out of the
workspace if an older TRIF kept them there), installs the TRIF files the wrappers run,
refreshes AGENTS.md and CLAUDE.md there from those files. Tim's mods (the mods TRIF ships, for
${STARTER_SITES}; each starts off) are added only for the sites you choose: on the
setup page in your browser (a checklist, site by site, or "Start with none"), later in Settings in the
panel or with the "Add Tim's mods" link on a site's panel, or here: --examples adds every site's,
--examples x.com,google.com those sites', --no-examples none. Adding a site's turns TRIF on for it${STARTER_OFF.length ? ` (not
${words(STARTER_OFF)})` : ''}. A site you added gets each new mod a later version brings for it, switched off (each
once: never again after you delete one, never over your own file), and setup updates the ones you
haven't changed (a changed one is offered the new version); a site you didn't add gets nothing. A
workspace from before 0.2.5 counts as having added every site it has mods for. It writes bin/trif-host
and bin/trif wrappers with an absolute node path (and the same as bin/webmods-host and bin/webmods, their
names before 0.2.0), writes the native messaging host manifest for each
browser (default: every browser whose profile folder exists) allowing every TRIF extension ID (plus
any in config.json "extensionIds"), and symlinks /usr/local/bin/trif when that folder is writable.
Prints a short summary, any problems, and the next steps, including the extension folder to load in
Chrome; --verbose (-v) prints every detail instead of the summary. At a terminal it then waits for the
browser and says as each step gets done (Ctrl-C or --no-wait skips that).
Where the wrappers point:
  --copy     copy helper/, extension/ and examples/ into <home>/app and run that copy (the default
             unless run from a git checkout; npx's own folder is a cache npm may delete). Updates swap
             in a fresh copy only when the files changed.
  --link     run the files where they are, without copying (the default in a git checkout, for
             developing TRIF itself).
It also records this terminal's PATH in config.json (env.PATH) so the helper can find your coding
agent for the side panel, and writes .claude/settings.json (what Claude Code may do in the workspace).
Other options: --no-link skips the /usr/local/bin link; --native-dir DIR writes the manifest only to DIR;
--bin-dir DIR links the CLI there instead of /usr/local/bin.
Run it again after upgrading TRIF, moving the repo or upgrading Node.`,
    examples: ['npx timsrobot setup', 'trif setup', 'trif setup --browser brave', 'trif setup --browser all', 'trif setup --examples x.com,google.com', 'node helper/cli.js setup --copy'],
  },
  status: {
    usage: 'trif status [TAB]',
    summary: 'connection, "Allow User Scripts" switch, mods and whether each is registered or off',
    details: `Asks the helper and the extension how things stand. When several browsers are connected (each runs
its own helper), an "also" line lists the others; --browser <name|pid> picks one for any command.
If a mod you just saved is missing or
"not registered", check its header and run trif doctor. "off" means the user switched the mod off
(side panel switch, or trif disable): it isn't running, and its file is unchanged. "sites on" lists
the sites TRIF is on for; it's off everywhere else until the user turns a site on in the side panel,
and a mod for a site that's off shows as "waiting".
With --url or --tab, also the mods that run on that tab's page: what a change there will meet.`,
    examples: ['trif status', 'trif status --url x.com', 'trif status --json'],
  },
  doctor: {
    usage: 'trif doctor',
    summary: 'diagnose setup problems, printing a fix for each',
    details: `Checks Node, the workspace, the host wrapper, each browser's native host manifest, the CLI on
PATH, whether the helper is reachable, whether the extension said hello, the "Allow User Scripts"
switch, every mod file, and which coding agents the side panel can use (and whether Claude Code is
logged in, or an API key is saved in the Keychain). It warns about API key variables set in this
terminal's environment (other programs, an agent's commands among them, can read them there: save the
key with trif agent key or trif agent open-model --set-key instead), TRIF's private files left in the
workspace, and the Safari bridge from before 0.2.0. For an open model (Settings, "Open model (via
Codex)"): Ollama or LM Studio running, the model installed, the key saved in the Keychain (never shown).
Exit code 1 if anything failed. Fix problems top-down.`,
    examples: ['trif doctor'],
  },
  tabs: {
    usage: 'trif tabs',
    summary: 'list open tabs: id, url, title (* marks active tabs)',
    details: 'Use the id with --tab, or select tabs with --url <substring>. Only tabs on sites TRIF is on for\nare listed (see trif status); the user turns a site on in the side panel.',
    examples: ['trif tabs'],
  },
  run: {
    usage: "trif run [TAB] [--box | --page] [--timeout MS] '<code>' | -f file.js | -",
    summary: 'run JavaScript on the page and print the result',
    details: `Inside an async function, so await works. A single expression is returned automatically
(REPL-style); for several statements write a function body and use return. -f runs a file; - reads the
code from stdin. The result is printed as pretty JSON, or as-is if it's a string. Default timeout 10000 ms.

Where it runs:
  --box   TRIF's box: the API a boxed mod has (page, trif: BOXED.md), plus what's typed in the page's
          fields (el.value) and the page's data behind an element (el.pageData('props.x')). It can read
          the page and change what it shows; it can't send, click, type or navigate. Nothing is paused and
          the user isn't asked. Elements come back as a short description (<button#id.class>).
  --page  the page's own JavaScript world (document, window, the site's own code and its mods'). From a
          chat, this pauses the site's posting in every tab until the tab reloads, and may ask the user
          first. DOM nodes come back as outerHTML (first 2000 chars).
In a chat (a side-panel run) the box is the default: use it for looking around, and --page only for what
needs the page's own code. From a terminal the page's world is the default.`,
    examples: [
      "trif run 'page.title'",
      "trif run 'page.findAll(\"article\").length'",
      "trif run 'page.findAll(\"a\").slice(0, 20).map((a) => a.attr(\"href\"))'",
      "trif run 'page.find(\"[data-testid=tweet]\").pageData(\"props\")'",
      "trif run --page 'document.title'",
      "trif run --page 'Object.keys(window).filter((k) => k.startsWith(\"__\"))'",
      'trif run -f probe.js',
      "echo 'page.url' | trif run -",
    ],
  },
  reload: {
    usage: 'trif reload [TAB] [--hard]',
    summary: 'reload a tab and wait for it to finish loading (do this after editing a mod)',
    details: '--hard bypasses the cache.',
    examples: ['trif reload', 'trif reload --url example.com'],
  },
  open: {
    usage: 'trif open <url>',
    summary: 'open a URL in a new background tab and wait for it to load; prints the tab id',
    details: 'https:// is added when the URL has no scheme.',
    examples: ['trif open example.com'],
  },
  reject: {
    usage: 'trif reject <site>/<mod>',
    summary: "don't allow a waiting change to a mod: the version before is put back (a mod that never ran goes to the trash); refused inside a run",
    examples: ['trif reject all-sites/dark-everywhere'],
  },
  history: {
    usage: 'trif history <site>/<mod>',
    summary: "what side-panel runs changed in a mod (kept 30 days), newest first",
    examples: ['trif history x.com/hide-reposts'],
  },
  export: {
    usage: 'trif export <site>/<mod> [--to <dir>]',
    summary: "copy a mod's file to ~/Downloads (or --to) as <site>-<mod>.js, to share it; refused inside a run",
    examples: ['trif export x.com/hide-reposts'],
  },
  import: {
    usage: 'trif import <file> [--site <site>] [--replace | --as-copy]',
    summary: "add a mod from a file: its site from its @match (or --site); never over a mod without --replace (which keeps the old one in history) or --as-copy; held like any mod from outside; refused inside a run",
    examples: ['trif import ~/Downloads/x.com-hide-reposts.js'],
  },
  files: {
    usage: 'trif files <site>',
    summary: "list the files the user added for a site (sites/<site>/files/): data for its mods, never run as one",
    examples: ['trif files x.com'],
  },
  add: {
    usage: 'trif add <file> --site <site>',
    summary: "add a file to a site's files (sites/<site>/files/, up to 50 MB, never over another); refused inside a run",
    examples: ['trif add ~/Music/ding.opus --site x.com'],
  },
  reveal: {
    usage: 'trif reveal <site>/<mod> [--editor]',
    summary: "show a mod's file in Finder (its folder elsewhere), or with --editor open it in the system's app for .js; refused inside a run",
    examples: ['trif reveal x.com/hide-reposts', 'trif reveal x.com/hide-reposts --editor'],
  },
  undo: {
    usage: 'trif undo <site>/<mod>',
    summary: "put back the version before a side-panel run's last change (a mod it created goes to the trash); refused inside a run",
    details: 'Each undo keeps what it replaced, so undoing can be undone the same way; trif history lists what is kept.',
    examples: ['trif undo x.com/hide-reposts'],
  },
  close: {
    usage: 'trif close --tab <id> | --url <part of its address> [--force]',
    summary: 'close a tab (one you opened with trif open); not the one the user is looking at, unless --force',
    details: 'Tabs a side-panel run opened with trif open are closed when the run ends anyway.',
    examples: ['trif close --tab 123'],
  },
  navigate: {
    usage: 'trif navigate [TAB] <url>',
    summary: 'point an existing tab at a URL and wait for it to load',
    details: 'https:// is added when the URL has no scheme.',
    examples: ['trif navigate --tab 123 https://example.com/settings'],
  },
  text: {
    usage: 'trif text [TAB]',
    summary: "print the page's visible text (document.body.innerText, capped at 200 000 chars)",
    details: 'Cheaper than a screenshot when you only need to know what the page says.',
    examples: ['trif text --url news.ycombinator.com | head -50'],
  },
  sweep: {
    usage: "trif sweep [TAB] (--selector <css> | --color <css colour> | --text <regex>) [--tolerance N] [--scroll [--force]] [--limit N] [--timeout MS]",
    summary: 'find every instance of a kind of thing on the page: count, where, what kinds',
    details: `For changing a class of things rather than the instances you noticed, and for checking that none
are left afterwards (run it before and after; compare the counts). It searches the whole page as it is now:
the document, shadow roots (closed ones too in Chrome and Firefox) and same-origin frames; cross-origin
frames are listed, not searched.
  --selector <css>   elements matching it
  --text <regex>     elements whose own text, aria-label, title, alt or placeholder matches (case-insensitive;
                     /re/flags for others). With --selector: matching elements whose text matches.
  --color <colour>   elements whose computed color, background (and gradients), border, outline, box-shadow,
                     text-shadow, text-decoration, SVG fill or stroke uses it, ::before/::after included
                     (inherited colours count where they're set); plus the stylesheet rules and CSS
                     variables that use it, and the rules using those variables. Any CSS colour: #1d9bf0,
                     rgb(29 155 240), blue. --tolerance N lets each of red, green and blue be off by N
                     (default 2). With --selector: only inside matching elements.
  --scroll           scroll to the bottom first (loading lazy content), then back where it was. It scrolls
                     the user's own tab, so it's refused on the tab they're looking at (add --force if
                     that's fine). Sites that load on scroll may not load in a tab that isn't showing.
Each match gets a region (the closest landmark or widget: main, nav, header, [role=dialog], [role=menu]…),
fixed or sticky, visible or hidden, in view or not. The report groups matches by kind (tag, role, test id,
readable classes) with an example each; --json has every match (up to --limit, default 200), with its
element, text and the properties that matched. Bounded: --timeout (default 4000 ms) stops early and says so.`,
    examples: [
      "trif sweep --url example.com --selector '[data-testid=promo], .promo'",
      "trif sweep --url x.com --color '#1d9bf0'",
      "trif sweep --url x.com --text '^(Promoted|Ad)$' --scroll",
      "trif sweep --url amazon.com --selector '[data-component-type=s-search-result]' --text Sponsored",
    ],
  },
  screenshot: {
    usage: 'trif screenshot [TAB] [--full] [--copy [--force]] [-o file.png]',
    summary: 'save a PNG of the tab and print its path',
    details: `Default path: screenshots/<time>.png in TRIF's private folder (on a Mac, ~/Library/Application
Support/TRIF; in a side-panel run, its site's folder there, $TRIF_RUN_SCREENSHOTS). Open the printed file
to look at it. -o FILE saves elsewhere; in a side-panel run, -o with just a name (-o page.png) saves in the
run's screenshots folder, and other places are refused (leave out -o).
TRIF never switches tabs or focuses windows (the user may be browsing, or other agents working), so:
  - a tab that's showing: captured as it is;
  - Firefox, a tab that isn't showing: captured as it is, in the background;
  - Chrome, a tab that isn't showing: an error, unless you pass --copy. With --copy, TRIF loads a fresh
    copy of the page, with the mods, in a window of its own that isn't focused (the size of the user's,
    at the tab's scroll position), captures it and closes it. The user sees that window at the right
    edge of the screen for a second or so (Chrome doesn't draw covered windows), and it's the page as it
    loads now, not the tab's exact state (open menus, typed text, content loaded since): a note on
    stderr says so. Check with trif sweep, text or run first; use --copy only when a visual check is
    truly needed. The copy loads the page again with the user's cookies (signed in as them), so an
    address that looks like a one-time link (a token, a sign-in callback, confirm, reset or unsubscribe)
    is refused unless you add --force; and if the copy ends up on a site the run may not touch, or one
    TRIF is off for, it's closed without a capture.
  - Safari: only a tab that's showing.
--full captures the whole page (up to 12000 px): Firefox from the tab itself; Chrome only with --copy,
stitched from several captures of the copy (fixed and sticky elements only at the top). --json prints
{file, how: visible|tab|copy, full, note}.`,
    examples: ['trif screenshot --url x.com', 'trif screenshot --url x.com --full -o x-full.png   # Firefox; Chrome needs --copy'],
  },
  record: {
    usage: 'trif record <site> [on|off]',
    summary: "record a site's fetch/XHR traffic (from the next page load) so you can inspect it",
    details: `Turns the network recorder on (default) or off for a hostname and its subdomains. It takes effect
on the next page load, so reload afterwards. Then use trif requests / trif request. Bodies are kept
up to 2 MB each (32 MB in all, oldest dropped first); event streams aren't read. Recording that a side-panel
chat switched on goes off when that chat's agent finishes.`,
    examples: ['trif record x.com on && trif reload --url x.com', 'trif record x.com off'],
  },
  requests: {
    usage: 'trif requests [TAB] [--filter <regex>] [--limit N]',
    summary: 'list recorded requests: index, method, status, type, size, url (newest last)',
    details: 'Needs trif record <site> first. --limit defaults to 50.',
    examples: ['trif requests --url x.com --filter graphql --limit 20'],
  },
  request: {
    usage: 'trif request [TAB] <i> [-o file]',
    summary: 'show one recorded request (method, url, status, request body, response)',
    details: `<i> is the index from trif requests. JSON bodies are pretty-printed. -o writes the response
body to a file (pretty-printed if JSON) and prints only the summary, which is handy for big
responses you want to grep.`,
    examples: ['trif request --url x.com 12', 'trif request 12 -o /tmp/timeline.json'],
  },
  errors: {
    usage: 'trif errors [TAB] [--page]',
    summary: 'errors thrown by mods in that page (check after every reload); --page: the page\'s own errors',
    details: "TRIF's runtime only runs on sites where a mod is on or recording is on, so elsewhere neither list has anything; reload after switching one on to catch errors from the page's start.",
    examples: ['trif errors --url example.com', 'trif errors --page'],
  },
  logs: {
    usage: 'trif logs [TAB]',
    summary: 'what mods logged with trif.log(...) / .warn / .error in that page',
    examples: ['trif logs'],
  },
  approve: {
    usage: 'trif approve <site>/<mod>',
    summary: 'let a held mod run (one a side-panel agent wrote that matches other sites)',
    details: `A side-panel agent run is limited to the site it was started on. If it writes a mod whose @match
reaches other sites, that mod is held: it isn't registered until the user approves it, here or with the
Allow button in the side panel. trif status and trif mods show held mods and why. Editing the mod
yourself also releases it. Not available to agents inside a side-panel run.`,
    examples: ['trif approve x.com/hide-reposts'],
  },
  check: {
    usage: 'trif check <file|site/mod>',
    summary: 'check that a mod parses, and what TRIF reads in it that would make it wait for the user\'s OK',
    details: 'Prints the syntax error and where it is, or "ok", then each thing TRIF reads in the code that would make the mod wait for the user\'s OK (sending, clicking for the user, loading from addresses it builds, code it can\'t read), the lines, and how to avoid it where there\'s a way. Use it instead of node --check. A style mod: its rules checked. A boxed mod (@boxed): it never waits; instead it lists what the sandbox wouldn\'t give it (window, document, fetch, real elements\' methods, ...), which would fail when it runs.',
    examples: ['trif check sites/x.com/hide-reposts.js', 'trif check x.com/hide-reposts'],
  },
  verify: {
    usage: 'trif verify <site>/<mod> [TAB]',
    summary: 'after saving a mod: check it, reload the tab, and say whether it runs there, with its errors and logs',
    details: 'One step for what you do after every save: trif check, a wait until the browser has the version you saved, trif reload, whether the mod runs on that page (or why not: held for the user\'s OK, switched off, its @match), then trif errors and trif logs for the tab. Then look at the page yourself (trif sweep, trif run, trif screenshot) for what you set out to change.',
    examples: ['trif verify x.com/hide-reposts --tab 12'],
  },
  enable: {
    usage: 'trif enable <site>/<mod> [--site HOST] [TAB]',
    summary: 'switch a mod back on (like its switch in the side panel)',
    details: `Mods can be switched off and on without touching their files: the side panel shows a switch per
mod, and these commands flip the same switch. The state lives in the extension, so the user sees it
change. If the mod runs on the tab (TAB, or the active tab) that tab is reloaded so the change shows;
otherwise it applies from the next page load. trif status shows which mods are off.
--site switches a mod that runs on several sites on (or, with disable, off) on that site only, like
the side panel's switch on that site; a side-panel run can do this on its own site.
Only flip switches the user asked about.`,
    examples: ['trif enable x.com/hide-reposts', 'trif enable x.com/hide-reposts --tab 12',
      'trif enable all-sites/dark-mode --site wikipedia.org'],
  },
  disable: {
    usage: 'trif disable <site>/<mod> [--site HOST] [TAB]',
    summary: 'switch a mod off without deleting or editing it (like its switch in the side panel)',
    details: `The mod stops running (it is unregistered) but its file stays as it is; trif enable turns it
back on. If the mod runs on the tab (TAB, or the active tab) that tab is reloaded so the change shows;
otherwise it applies from the next page load. Use this when the user asks to turn a mod off, rather
than deleting or renaming the file. With --site HOST, only on that site (see enable).`,
    examples: ['trif disable x.com/hide-reposts', 'trif disable example.com/dark-mode --url example.com',
      'trif disable all-sites/dark-mode --site bank.com'],
  },
  delete: {
    usage: 'trif delete <site>/<mod>',
    summary: 'delete a mod (it goes to the trash; trif restore brings it back)',
    details: `Moves the mod's file to ~/.trif/trash, where it stays for 30 days; the side panel's Delete does
the same. Works without the browser. Inside a side-panel run, only mods that stay on the run's site.
Ask the user before deleting a mod, and prefer trif disable when they only want it off.`,
    examples: ['trif delete x.com/hide-reposts'],
  },
  update: {
    usage: 'trif update [--install] [--auto on|off]',
    summary: 'check for a newer TRIF, install it, or turn automatic updates on or off',
    details: `With no options, checks now and says whether a newer version is out, with what changed.
--install downloads and installs it (only for a copy setup installed in <home>/app; a git checkout updates
with git pull). Updates are signed: one that isn't signed by the TRIF release key is refused.
A running browser switches to the new version within a minute. The side panel shows the same notice,
with an Update button. --auto on installs updates by themselves when no chat is running (off by
default). The user's choice: don't change it, or install updates, unless they ask.`,
    examples: ['trif update', 'trif update --install', 'trif update --auto on'],
  },
  report: {
    usage: 'trif report [--open]',
    summary: 'print a problem report (versions, setup checks, recent errors) to send to the TRIF developer',
    details: `The same report as the side panel's "Report a problem": TRIF, browser, system and agent versions,
the doctor's warnings, and recent warnings and errors from the helper log, with the home folder, user
name, email addresses, query strings and token-like strings removed. Nothing is sent; it's printed.
--open opens the report form (timsrobot.com/report) in the browser with it filled in, for the user to send.`,
    examples: ['trif report', 'trif report --open'],
  },
  restore: {
    usage: 'trif restore [<site>/<mod>]',
    summary: 'bring a deleted mod back from the trash (no id: list the trash)',
    details: `Puts back the most recently deleted copy of the mod, switched on or off as it was. Fails if a mod
with that id exists again, except right after trif mod-update --use-new (or the side panel's "Use the
new version"): then the user's copy comes back in place of the new version, which is offered again.
With no id, lists what's in the trash, newest first.`,
    examples: ['trif restore', 'trif restore x.com/hide-reposts'],
  },
  'mod-update': {
    usage: 'trif mod-update <site>/<mod> [--use-new | --keep | --merged]',
    summary: 'a new version of a shipped mod you changed: use it, keep yours, or mark it merged',
    details: `The mods TRIF ships (their header says @source webmods, from before the rename, or @source trif) get fixes with TRIF updates: setup
replaces a copy nobody changed. A copy that was changed is left alone, and the new version waits;
trif mods and trif status say "update available (you've changed it)", and the side panel offers
it on the mod. With no option, prints the three files: the user's copy, the new version, and what was
shipped before (what the user's copy started from), for merging.
  --use-new  the new version replaces the user's copy, which goes to the trash (trif restore brings it
             back, and offers the new version again)
  --keep     keep the user's copy; this version isn't offered again (a later one is)
  --merged   the new version has been merged into the user's copy (by hand or by an agent in the
             terminal): it isn't offered again, and becomes what later versions are merged against
The user's choice: not available inside a side-panel run (the panel's "Merge with my agent" starts a
chat in which the agent proposes the merge first and makes it once the user agrees; the update is settled
when the user's copy has the new @version).`,
    examples: ['trif mod-update x.com/detox-timeline', 'trif mod-update x.com/detox-timeline --use-new', 'trif mod-update x.com/detox-timeline --keep'],
  },
  mods: {
    usage: 'trif mods',
    summary: 'list mods in the folder: id, matches, file (works without Chrome)',
    details: `When Chrome is reachable, mods the user switched off are marked [off]. Mods TRIF ships say "from
TRIF, version N", and "update available" when a newer version is waiting (trif mod-update).`,
    examples: ['trif mods', 'trif mods --json'],
  },
  new: {
    usage: 'trif new <site> <mod> [--style | --boxed]',
    summary: 'create sites/<site>/<mod>.js from a template and print its path (--style: a style mod, data instead of code; --boxed: a boxed mod, JavaScript in TRIF\'s sandbox)',
    details: `<site> is a hostname (x.com, news.ycombinator.com); <mod> is a kebab-case name. The template has
the header plus helpers for injecting CSS and handling elements that appear later. --style makes a style
mod: CSS, things to hide, text to replace and items to filter, as data that TRIF's own code runs, so it
never waits for the user's OK (see "Style mods" in TECHNIQUES.md). --boxed makes a boxed mod: JavaScript
that runs in TRIF's sandbox with only TRIF's API (page, trif, element stand-ins, timers), so it never waits
for the user's OK either (see BOXED.md). Without either, a free mod: JavaScript in the
page with everything it has. Write the lowest that does the job: style, then boxed, then free. (--rules
and --sandboxed are the old names of --style and --boxed, and still work.)`,
    examples: ['trif new example.com hide-banner --style', 'trif new example.com bouncing-logo --boxed', 'trif new example.com hide-banner'],
  },
  'install-example': {
    usage: 'trif install-example <site>/<mod> [--force]',
    summary: 'copy a ready-made example mod into the workspace',
    details: 'Run without an argument to list the available examples. --force overwrites an existing mod.',
    examples: ['trif install-example x.com/detox-timeline'],
  },
  agent: {
    usage: 'trif agent list | agent run [opts] "<prompt>" | agent login [--agent claude] | agent open-model [opts] | agent key [opts]',
    summary: 'list coding agents the side panel can use, run one like the side panel does, or log one in',
    details: `Options for agent run: --agent claude|codex|codex-oss, --tab ID, --url URL, --session ID, --model NAME.

agent list shows which agents the helper can find (Claude Code, Codex) and their versions; it
works without Chrome. agent run starts the agent headless in the workspace through the helper, exactly
like the side panel, and prints what it does as it goes: its replies, one line per tool call, then a
summary with the session id (pass it to --session to continue the conversation) and the mod files it
changed. Here --url is the page URL the user is looking at (not a tab selector); without --url the
helper asks Chrome for the URL of --tab, or of the active tab. Ctrl-C stops the agent.
--json prints one JSON event per line. Exit code 1 if the run failed.

agent login logs the agent in through the helper, like the side panel's Log in button (Claude Code
only; it runs \`claude auth login\`): it prints a sign-in URL, then reads the code that page shows
from stdin. Exit code 1 if it didn't end up logged in.

agent open-model (experimental) shows or sets where the open-model agent (codex-oss: an open model run
through Codex) gets its model: --provider ollama|lmstudio|openrouter|custom, --model NAME, --base-url URL
(custom servers). Saved in config.json "openModel". --set-key saves the provider's API key in the system
keyring (the macOS Keychain; secret-tool on Linux), read from stdin or asked for without echo, never from
the command line; --remove-key removes it. Don't export API keys in your shell profile: every program
started from a terminal gets them, and other programs can read them.

agent key [--agent claude|codex] [--set-key | --remove-key] shows, saves or removes an API key for plain
Claude Code (Anthropic) or Codex (OpenAI) runs, for those who use one instead of logging the agent in.
Kept in the system keyring like open-model keys (stdin or a no-echo prompt, never the command line), and
sent by a proxy the helper runs for each chat: the agent never has it.`,
    examples: ['trif agent list', 'trif agent run --url https://x.com/home "hide the trending sidebar"',
      'trif agent run --tab 12 --session 1b2c… "also hide Who to follow"', 'trif agent login',
      'trif agent open-model --provider openrouter --model qwen/qwen3-coder', 'trif agent open-model --provider openrouter --set-key',
      'trif agent key --agent codex --set-key'],
  },
  explain: {
    usage: 'trif explain [TERM]',
    summary: 'what a word the side panel shows means: a tier, power, chip, tag, warning or agent level',
    details: `With no TERM, every term, by group. With one (its id or its label, case aside: read-drafts, Ask first,
@migrate, changes requests), its line (the sentence the panel, the approval card and trif status show),
its explanation (what the panel's "more" shows the user) and notes for you: when to use it, what's
refused, the narrower ways round. Two terms with one name (Off: an agent level and a face) both show;
agent-levels/off picks one. Works without the browser, and in side-panel runs.`,
    examples: ['trif explain', 'trif explain read-drafts', 'trif explain "Ask first"', 'trif explain agent-levels/off', 'trif explain sound --json'],
  },
  help: {
    usage: 'trif help [command]',
    summary: 'this help, or details and examples for one command',
    examples: ['trif help run'],
  },
};

const GROUPS = [
  ['Setup and diagnosis', ['setup', 'status', 'doctor', 'update', 'report']],
  ['Mod files (work without Chrome)', ['mods', 'new', 'check', 'delete', 'restore', 'history', 'undo', 'reveal', 'export', 'import', 'files', 'add', 'install-example', 'mod-update']],
  ['Switching mods off and on (need Chrome running with the extension)', ['disable', 'enable', 'approve', 'reject']],
  ['Pages (need Chrome running with the extension)', ['tabs', 'run', 'reload', 'verify', 'open', 'close', 'navigate', 'text', 'sweep', 'screenshot', 'record', 'requests', 'request', 'errors', 'logs']],
  ['Agent runs (what the side panel does)', ['agent']],
  ['', ['explain', 'help']],
];

function pad(s, n) { return s.length >= n - 1 ? s + '\n' + ' '.repeat(n + 2) : s + ' '.repeat(n - s.length); }

function shortUsage(name) {
  return COMMANDS[name].usage.replace(/^trif /, '');
}

function mainHelp(home) {
  const lines = [];
  lines.push(`trif ${P.VERSION}: customize websites with mods, small JavaScript files that run on a site every
time it loads, in the page itself (they can restyle, hide, add, or patch fetch/XHR).

A mod is a file: ${home}/sites/<site>/<mod>.js  (e.g. sites/x.com/hide-sidebar.js)
Save it and the TRIF extension picks it up immediately; reload the tab to see the effect.
Files starting with _ or . are ignored. Full guide: ${home}/AGENTS.md

Usage: trif <command> [options]   (\`webmods\` is the same command: its name before 0.2.0)`);
  for (const [title, names] of GROUPS) {
    lines.push('');
    if (title) lines.push(title + ':');
    for (const n of names) lines.push('  ' + pad(shortUsage(n), 44) + COMMANDS[n].summary);
  }
  lines.push(`
TAB picks the tab: --tab <id> (from trif tabs) or --url <substring|/regex/>.
Without one, commands use the active tab of the last-focused browser window.
--browser <name|pid> sends the command to another connected browser (e.g. --browser firefox; see
trif status). Without it: the browser that connected first, or, inside a side-panel run, the
browser the run was started from.
--json prints any command's raw result as JSON.

Exit codes: 0 ok, 1 the command failed, 2 the helper isn't running
(open your browser; if it's open, run trif doctor).

Typical loop:
  trif new example.com hide-banner        # prints the file path; edit it
  trif reload --url example.com           # mods apply on page load
  trif errors --url example.com           # did the mod throw?
  trif screenshot --url example.com       # look at the result (prints a PNG path)
  trif sweep --url example.com --selector '#banner'   # how many are left, and where
  trif run --url example.com 'document.querySelector("#banner")?.offsetHeight'

Exploring a site:
  trif text --url example.com | head -40
  trif run 'document.querySelector("main").outerHTML.slice(0, 3000)'
  trif record example.com on && trif reload --url example.com
  trif requests --url example.com --filter api && trif request --url example.com 3

trif help <command> shows details and examples for one command.`);
  return lines.join('\n');
}

function commandHelp(name) {
  const c = COMMANDS[name];
  if (!c) return null;
  const lines = [`Usage: ${c.usage}`, '', c.summary + '.'];
  if (c.details) lines.push('', c.details);
  if (/\[TAB\]/.test(c.usage)) lines.push('', 'TAB: --tab <id> or --url <substring|/regex/>; default is the active tab of the last-focused window.');
  if (c.examples && c.examples.length) {
    lines.push('', 'Examples:');
    for (const e of c.examples) lines.push('  ' + e);
  }
  return lines.join('\n');
}

module.exports = { COMMANDS, mainHelp, commandHelp };
