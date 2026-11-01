'use strict';
// Help text for `webmods help` and `webmods help <command>`. Written for coding agents first:
// what each command does, its options, and short copy-pasteable examples.

const P = require('./paths');

const COMMANDS = {
  setup: {
    usage: 'webmods setup [--browser chrome|chromium|brave|edge|arc|firefox|all] [--home DIR] [--copy|--link] [--no-link] [--no-examples]',
    summary: 'install the workspace, native messaging host and CLI link (safe to re-run)',
    details: `First time: npx webmods setup   (needs Node 18 or newer).
Creates the workspace (sites/, screenshots/, bin/), installs the WebMods files the wrappers run,
refreshes AGENTS.md and CLAUDE.md there from those files, adds the example mods (Plain X, the Instagram ones),
switched off, the first time (once: never again after you delete one, never over your own file;
--no-examples skips them), writes bin/webmods-host
and bin/webmods wrappers with an absolute node path, writes the native messaging host manifest for each
browser (default: every browser whose profile folder exists) allowing every WebMods extension ID (plus
any in config.json "extensionIds"), and symlinks /usr/local/bin/webmods when that folder is writable.
Prints next steps, including the extension folder to load in Chrome.
Where the wrappers point:
  --copy     copy helper/, extension/ and examples/ into <home>/app and run that copy (the default
             unless run from a git checkout; npx's own folder is a cache npm may delete). Updates swap
             in a fresh copy only when the files changed.
  --link     run the files where they are, without copying (the default in a git checkout, for
             developing WebMods itself).
It also records this terminal's PATH in config.json (env.PATH) so the helper can find your coding
agent for the side panel, and writes .claude/settings.json (what Claude Code may do in the workspace).
Other options: --no-link skips the /usr/local/bin link; --native-dir DIR writes the manifest only to DIR;
--bin-dir DIR links the CLI there instead of /usr/local/bin.
Run it again after upgrading WebMods, moving the repo or upgrading Node.`,
    examples: ['npx webmods setup', 'webmods setup', 'webmods setup --browser brave', 'webmods setup --browser all', 'node helper/cli.js setup --copy'],
  },
  status: {
    usage: 'webmods status',
    summary: 'connection, "Allow User Scripts" switch, mods and whether each is registered or off',
    details: `Asks the helper and the extension how things stand. When several browsers are connected (each runs
its own helper), an "also" line lists the others; --browser <name|pid> picks one for any command.
If a mod you just saved is missing or
"not registered", check its header and run webmods doctor. "off" means the user switched the mod off
(side panel switch, or webmods disable): it isn't running, and its file is unchanged. "sites on" lists
the sites WebMods is on for; it's off everywhere else until the user turns a site on in the side panel,
and a mod for a site that's off shows as "waiting".`,
    examples: ['webmods status', 'webmods status --json'],
  },
  doctor: {
    usage: 'webmods doctor',
    summary: 'diagnose setup problems, printing a fix for each',
    details: `Checks Node, the workspace, the host wrapper, each browser's native host manifest, the CLI on
PATH, whether the helper is reachable, whether the extension said hello, the "Allow User Scripts"
switch, every mod file, and which coding agents the side panel can use (and whether Claude Code is
logged in). Exit code 1 if anything failed. Fix problems top-down.`,
    examples: ['webmods doctor'],
  },
  tabs: {
    usage: 'webmods tabs',
    summary: 'list open tabs: id, url, title (* marks active tabs)',
    details: 'Use the id with --tab, or select tabs with --url <substring>. Only tabs on sites WebMods is on for\nare listed (see webmods status); the user turns a site on in the side panel.',
    examples: ['webmods tabs'],
  },
  run: {
    usage: "webmods run [TAB] [--timeout MS] '<code>' | -f file.js | -",
    summary: 'run JavaScript in the page and print the result',
    details: `Runs in the page's own JavaScript world (same window as the site and its mods), inside an async
function, so await works. A single expression is returned automatically (REPL-style); for several
statements write a function body and use return. -f runs a file; - reads the code from stdin.
The result is printed as pretty JSON, or as-is if it's a string. DOM nodes come back as outerHTML
(first 2000 chars). Default timeout 10000 ms.`,
    examples: [
      "webmods run 'document.title'",
      "webmods run --url x.com 'document.querySelectorAll(\"article\").length'",
      "webmods run 'const a = [...document.links].map(l => l.href); return a.slice(0, 20)'",
      "webmods run 'await (await fetch(\"/api/me\")).json()'",
      'webmods run -f probe.js',
      "echo 'location.href' | webmods run -",
    ],
  },
  reload: {
    usage: 'webmods reload [TAB] [--hard]',
    summary: 'reload a tab and wait for it to finish loading (do this after editing a mod)',
    details: '--hard bypasses the cache.',
    examples: ['webmods reload', 'webmods reload --url example.com'],
  },
  open: {
    usage: 'webmods open <url>',
    summary: 'open a URL in a new background tab and wait for it to load; prints the tab id',
    details: 'https:// is added when the URL has no scheme.',
    examples: ['webmods open example.com'],
  },
  navigate: {
    usage: 'webmods navigate [TAB] <url>',
    summary: 'point an existing tab at a URL and wait for it to load',
    details: 'https:// is added when the URL has no scheme.',
    examples: ['webmods navigate --tab 123 https://example.com/settings'],
  },
  text: {
    usage: 'webmods text [TAB]',
    summary: "print the page's visible text (document.body.innerText, capped at 200 000 chars)",
    details: 'Cheaper than a screenshot when you only need to know what the page says.',
    examples: ['webmods text --url news.ycombinator.com | head -50'],
  },
  screenshot: {
    usage: 'webmods screenshot [TAB] [-o file.png]',
    summary: 'save a PNG of the visible part of the tab and print its path',
    details: `Default path: <workspace>/screenshots/<time>.png. Only works on a tab that's showing in its
window: WebMods never switches tabs (the user may be browsing, or other agents working). For a
background tab, use \`webmods text\` or \`webmods run\`. Open the printed file to look at it.`,
    examples: ['webmods screenshot', 'webmods screenshot --url x.com -o /tmp/x.png'],
  },
  record: {
    usage: 'webmods record <site> [on|off]',
    summary: "record a site's fetch/XHR traffic (from the next page load) so you can inspect it",
    details: `Turns the network recorder on (default) or off for a hostname and its subdomains. It takes effect
on the next page load, so reload afterwards. Then use webmods requests / webmods request.`,
    examples: ['webmods record x.com on && webmods reload --url x.com', 'webmods record x.com off'],
  },
  requests: {
    usage: 'webmods requests [TAB] [--filter <regex>] [--limit N]',
    summary: 'list recorded requests: index, method, status, type, size, url (newest last)',
    details: 'Needs webmods record <site> first. --limit defaults to 50.',
    examples: ['webmods requests --url x.com --filter graphql --limit 20'],
  },
  request: {
    usage: 'webmods request [TAB] <i> [-o file]',
    summary: 'show one recorded request (method, url, status, request body, response)',
    details: `<i> is the index from webmods requests. JSON bodies are pretty-printed. -o writes the response
body to a file (pretty-printed if JSON) and prints only the summary, which is handy for big
responses you want to grep.`,
    examples: ['webmods request --url x.com 12', 'webmods request 12 -o /tmp/timeline.json'],
  },
  errors: {
    usage: 'webmods errors [TAB]',
    summary: 'errors thrown by mods in that page (check after every reload)',
    examples: ['webmods errors --url example.com'],
  },
  logs: {
    usage: 'webmods logs [TAB]',
    summary: 'what mods logged with webmods.log(...) / .warn / .error in that page',
    examples: ['webmods logs'],
  },
  approve: {
    usage: 'webmods approve <site>/<mod>',
    summary: 'let a held mod run (one a side-panel agent wrote that matches other sites)',
    details: `A side-panel agent run is limited to the site it was started on. If it writes a mod whose @match
reaches other sites, that mod is held: it isn't registered until the user approves it, here or with the
Allow button in the side panel. webmods status and webmods mods show held mods and why. Editing the mod
yourself also releases it. Not available to agents inside a side-panel run.`,
    examples: ['webmods approve x.com/hide-reposts'],
  },
  check: {
    usage: 'webmods check <file|site/mod>',
    summary: 'check that a mod file parses (compiles it without running it)',
    details: 'Prints the syntax error and where it is, or "ok". Use it instead of node --check.',
    examples: ['webmods check sites/x.com/hide-reposts.js', 'webmods check x.com/hide-reposts'],
  },
  enable: {
    usage: 'webmods enable <site>/<mod> [--site HOST] [TAB]',
    summary: 'switch a mod back on (like its switch in the side panel)',
    details: `Mods can be switched off and on without touching their files: the side panel shows a switch per
mod, and these commands flip the same switch. The state lives in the extension, so the user sees it
change. If the mod runs on the tab (TAB, or the active tab) that tab is reloaded so the change shows;
otherwise it applies from the next page load. webmods status shows which mods are off.
--site switches a mod that runs on several sites on (or, with disable, off) on that site only, like
the side panel's switch on that site; a side-panel run can do this on its own site.
Only flip switches the user asked about.`,
    examples: ['webmods enable x.com/hide-reposts', 'webmods enable x.com/hide-reposts --tab 12',
      'webmods enable all-sites/dark-mode --site wikipedia.org'],
  },
  disable: {
    usage: 'webmods disable <site>/<mod> [--site HOST] [TAB]',
    summary: 'switch a mod off without deleting or editing it (like its switch in the side panel)',
    details: `The mod stops running (it is unregistered) but its file stays as it is; webmods enable turns it
back on. If the mod runs on the tab (TAB, or the active tab) that tab is reloaded so the change shows;
otherwise it applies from the next page load. Use this when the user asks to turn a mod off, rather
than deleting or renaming the file. With --site HOST, only on that site (see enable).`,
    examples: ['webmods disable x.com/hide-reposts', 'webmods disable example.com/dark-mode --url example.com',
      'webmods disable all-sites/dark-mode --site bank.com'],
  },
  delete: {
    usage: 'webmods delete <site>/<mod>',
    summary: 'delete a mod (it goes to the trash; webmods restore brings it back)',
    details: `Moves the mod's file to ~/.webmods/trash, where it stays for 30 days; the side panel's Delete does
the same. Works without the browser. Inside a side-panel run, only mods that stay on the run's site.
Ask the user before deleting a mod, and prefer webmods disable when they only want it off.`,
    examples: ['webmods delete x.com/hide-reposts'],
  },
  update: {
    usage: 'webmods update [--install] [--auto on|off]',
    summary: 'check for a newer WebMods, install it, or turn automatic updates on or off',
    details: `With no options, checks now and says whether a newer version is out, with what changed.
--install downloads and installs it (only for a copy setup installed in <home>/app; a git checkout updates
with git pull). Updates are signed: one that isn't signed by the WebMods release key is refused.
A running browser switches to the new version within a minute. The side panel shows the same notice,
with an Update button. --auto on installs updates by themselves when no chat is running (off by
default). The user's choice: don't change it, or install updates, unless they ask.`,
    examples: ['webmods update', 'webmods update --install', 'webmods update --auto on'],
  },
  report: {
    usage: 'webmods report [--open]',
    summary: 'print a problem report (versions, setup checks, recent errors) to send to the WebMods developer',
    details: `The same report as the side panel's "Report a problem": WebMods, browser, system and agent versions,
the doctor's warnings, and recent warnings and errors from the helper log, with the home folder, user
name, email addresses, query strings and token-like strings removed. Nothing is sent; it's printed.
--open opens the report form (webmods.dev/report) in the browser with it filled in, for the user to send.`,
    examples: ['webmods report', 'webmods report --open'],
  },
  restore: {
    usage: 'webmods restore [<site>/<mod>]',
    summary: 'bring a deleted mod back from the trash (no id: list the trash)',
    details: `Puts back the most recently deleted copy of the mod, switched on or off as it was. Fails if a mod
with that id exists again. With no id, lists what's in the trash, newest first.`,
    examples: ['webmods restore', 'webmods restore x.com/hide-reposts'],
  },
  mods: {
    usage: 'webmods mods',
    summary: 'list mods in the folder: id, matches, file (works without Chrome)',
    details: 'When Chrome is reachable, mods the user switched off are marked [off].',
    examples: ['webmods mods', 'webmods mods --json'],
  },
  new: {
    usage: 'webmods new <site> <mod>',
    summary: 'create sites/<site>/<mod>.js from a template and print its path',
    details: `<site> is a hostname (x.com, news.ycombinator.com); <mod> is a kebab-case name. The template has
the header plus helpers for injecting CSS and handling elements that appear later.`,
    examples: ['webmods new example.com hide-banner'],
  },
  'install-example': {
    usage: 'webmods install-example <site>/<mod> [--force]',
    summary: 'copy a ready-made example mod into the workspace',
    details: 'Run without an argument to list the available examples. --force overwrites an existing mod.',
    examples: ['webmods install-example x.com/plain-x'],
  },
  agent: {
    usage: 'webmods agent list | agent run [opts] "<prompt>" | agent login [--agent claude]',
    summary: 'list coding agents the side panel can use, run one like the side panel does, or log one in',
    details: `Options for agent run: --agent claude|codex, --tab ID, --url URL, --session ID, --model NAME.

agent list shows which agents the helper can find (Claude Code, Codex) and their versions; it
works without Chrome. agent run starts the agent headless in the workspace through the helper, exactly
like the side panel, and prints what it does as it goes: its replies, one line per tool call, then a
summary with the session id (pass it to --session to continue the conversation) and the mod files it
changed. Here --url is the page URL the user is looking at (not a tab selector); without --url the
helper asks Chrome for the URL of --tab, or of the active tab. Ctrl-C stops the agent.
--json prints one JSON event per line. Exit code 1 if the run failed.

agent login logs the agent in through the helper, like the side panel's Log in button (Claude Code
only; it runs \`claude auth login\`): it prints a sign-in URL, then reads the code that page shows
from stdin. Exit code 1 if it didn't end up logged in.`,
    examples: ['webmods agent list', 'webmods agent run --url https://x.com/home "hide the trending sidebar"',
      'webmods agent run --tab 12 --session 1b2c… "also hide Who to follow"', 'webmods agent login'],
  },
  help: {
    usage: 'webmods help [command]',
    summary: 'this help, or details and examples for one command',
    examples: ['webmods help run'],
  },
};

const GROUPS = [
  ['Setup and diagnosis', ['setup', 'status', 'doctor', 'update', 'report']],
  ['Mod files (work without Chrome)', ['mods', 'new', 'check', 'delete', 'restore', 'install-example']],
  ['Switching mods off and on (need Chrome running with the extension)', ['disable', 'enable', 'approve']],
  ['Pages (need Chrome running with the extension)', ['tabs', 'run', 'reload', 'open', 'navigate', 'text', 'screenshot', 'record', 'requests', 'request', 'errors', 'logs']],
  ['Agent runs (what the side panel does)', ['agent']],
  ['', ['help']],
];

function pad(s, n) { return s.length >= n - 1 ? s + '\n' + ' '.repeat(n + 2) : s + ' '.repeat(n - s.length); }

function shortUsage(name) {
  return COMMANDS[name].usage.replace(/^webmods /, '');
}

function mainHelp(home) {
  const lines = [];
  lines.push(`webmods ${P.VERSION}: customize websites with mods, small JavaScript files that run on a site every
time it loads, in the page itself (they can restyle, hide, add, or patch fetch/XHR).

A mod is a file: ${home}/sites/<site>/<mod>.js  (e.g. sites/x.com/hide-sidebar.js)
Save it and the WebMods extension picks it up immediately; reload the tab to see the effect.
Files starting with _ or . are ignored. Full guide: ${home}/AGENTS.md

Usage: webmods <command> [options]`);
  for (const [title, names] of GROUPS) {
    lines.push('');
    if (title) lines.push(title + ':');
    for (const n of names) lines.push('  ' + pad(shortUsage(n), 44) + COMMANDS[n].summary);
  }
  lines.push(`
TAB picks the tab: --tab <id> (from webmods tabs) or --url <substring|/regex/>.
Without one, commands use the active tab of the last-focused browser window.
--browser <name|pid> sends the command to another connected browser (e.g. --browser firefox; see
webmods status). Without it: the browser that connected first, or, inside a side-panel run, the
browser the run was started from.
--json prints any command's raw result as JSON.

Exit codes: 0 ok, 1 the command failed, 2 the helper isn't running
(open your browser; if it's open, run webmods doctor).

Typical loop:
  webmods new example.com hide-banner        # prints the file path; edit it
  webmods reload --url example.com           # mods apply on page load
  webmods errors --url example.com           # did the mod throw?
  webmods screenshot --url example.com       # look at the result (prints a PNG path)
  webmods run --url example.com 'document.querySelector("#banner")?.offsetHeight'

Exploring a site:
  webmods text --url example.com | head -40
  webmods run 'document.querySelector("main").outerHTML.slice(0, 3000)'
  webmods record example.com on && webmods reload --url example.com
  webmods requests --url example.com --filter api && webmods request --url example.com 3

webmods help <command> shows details and examples for one command.`);
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
