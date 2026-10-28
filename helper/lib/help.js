'use strict';
// Help text for `webmods help` and `webmods help <command>`. Written for coding agents first:
// what each command does, its options, and short copy-pasteable examples.

const P = require('./paths');

const COMMANDS = {
  setup: {
    usage: 'webmods setup [--browser chrome|chromium|brave|edge|arc|all] [--home DIR]',
    summary: 'install the workspace, native messaging host and CLI link (safe to re-run)',
    details: `Creates the workspace (sites/, screenshots/, bin/), refreshes AGENTS.md and CLAUDE.md there (never
touches sites/), writes bin/webmods-host and bin/webmods wrappers with an absolute node path, writes
the native messaging host manifest for each browser (default: every browser whose profile folder
exists), and symlinks /usr/local/bin/webmods when that folder is writable. Prints next steps.
Run it again after moving the repo or upgrading Node.`,
    examples: ['webmods setup', 'webmods setup --browser brave', 'webmods setup --browser all'],
  },
  status: {
    usage: 'webmods status',
    summary: 'connection, "Allow User Scripts" switch, mods and whether each is registered',
    details: `Asks the helper and the extension how things stand. If a mod you just saved is missing or
"not registered", check its header and run webmods doctor.`,
    examples: ['webmods status', 'webmods status --json'],
  },
  doctor: {
    usage: 'webmods doctor',
    summary: 'diagnose setup problems, printing a fix for each',
    details: `Checks Node, the workspace, the host wrapper, each browser's native host manifest, the CLI on
PATH, whether the helper is reachable, whether the extension said hello, the "Allow User Scripts"
switch, and every mod file. Exit code 1 if anything failed. Fix problems top-down.`,
    examples: ['webmods doctor'],
  },
  tabs: {
    usage: 'webmods tabs',
    summary: 'list open tabs: id, url, title (* marks active tabs)',
    details: 'Use the id with --tab, or select tabs with --url <substring>.',
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
    summary: 'open a URL in a new active tab and wait for it to load; prints the tab id',
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
    details: `Default path: <workspace>/screenshots/<time>.png. The tab's window is focused and the tab
activated first. Open the printed file to look at it.`,
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
  mods: {
    usage: 'webmods mods',
    summary: 'list mods in the folder: id, matches, file (works without Chrome)',
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
  help: {
    usage: 'webmods help [command]',
    summary: 'this help, or details and examples for one command',
    examples: ['webmods help run'],
  },
};

const GROUPS = [
  ['Setup and diagnosis', ['setup', 'status', 'doctor']],
  ['Mod files (work without Chrome)', ['mods', 'new', 'install-example']],
  ['Pages (need Chrome running with the extension)', ['tabs', 'run', 'reload', 'open', 'navigate', 'text', 'screenshot', 'record', 'requests', 'request', 'errors', 'logs']],
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
Without one, commands use the active tab of the last-focused Chrome window.
--json prints any command's raw result as JSON.

Exit codes: 0 ok, 1 the command failed, 2 the helper isn't running
(open Chrome; if Chrome is open, run webmods doctor).

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
