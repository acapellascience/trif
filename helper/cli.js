#!/usr/bin/env node
'use strict';
// The `trif` command. Talks to the helper (host.js) over $TRIF_HOME/helper.sock.
// Exit codes: 0 ok, 1 command error, 2 helper not running.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { envVar } = require('./lib/env');
const P = require('./lib/paths');
const { request, streamRun, streamLogin, HelperError } = require('./lib/client');
const { ALL_SITES, scanMods, planMods, isIgnoredName, isShippedSource } = require('./lib/mods');
const { realish, isInside, badName } = require('./lib/pathcheck');
const { COMMANDS, mainHelp, commandHelp } = require('./lib/help');
const { loadHeld } = require('./lib/held');
const { pickHelper, listHelpers, describeHelper } = require('./lib/helpers');
const trash = require('./lib/trash');
const shipped = require('./lib/preinstalled');

// Inside a side-panel agent run (the helper set TRIF_RUN_TOKEN) these are the user's alone.
const NOT_IN_RUNS = new Set(['setup', 'agent', 'approve', 'reject', 'mod-update', 'undo']);

// Output piped into something that stops reading early (`trif tabs | head -1`) isn't an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const VALUE_FLAGS = new Set(['--tab', '--url', '-o', '--out', '--output', '--filter', '--limit', '-f', '--file',
  '--browser', '--home', '--native-dir', '--bin-dir', '--timeout', '--agent', '--session', '--model', '--site', '--auto',
  '--provider', '--base-url', '--key-env', '--selector', '--color', '--text', '--tolerance']);
const BOOL_FLAGS = new Set(['--json', '--hard', '--help', '-h', '--force', '--page', '--rules', '--sandboxed', '--style', '--boxed', '--no-link', '--examples', '--no-examples', '--copy', '--link', '--install', '--open',
  '--use-new', '--keep', '--merged', '--set-key', '--remove-key', '--scroll', '--full', '--verbose', '-v', '--no-wait']);
// Flags with a value that may be left out (`--examples` alone, or `--examples x.com,google.com`).
const OPTIONAL_VALUE_FLAGS = new Set(['--examples']);
const ALIASES = { '--out': '-o', '--output': '-o', '--file': '-f', '-h': '--help', '-v': '--verbose' };

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest || a === '-' || !a.startsWith('-') || /^-\d/.test(a)) { pos.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    let name = a;
    let value;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) { name = a.slice(0, eq); value = a.slice(eq + 1); }
    name = ALIASES[name] || name;
    if (VALUE_FLAGS.has(name) || VALUE_FLAGS.has(a)) {
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new UsageError(`${name} needs a value`);
        value = argv[++i];
      }
      opts[name] = value;
    } else if (OPTIONAL_VALUE_FLAGS.has(name)) {
      if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith('-')) value = argv[++i];
      opts[name] = value === undefined ? true : value;
    } else if (BOOL_FLAGS.has(name)) {
      opts[name] = true;
    } else {
      throw new UsageError(`unknown option ${a} (see trif help)`);
    }
  }
  return { opts, pos };
}

// ---------------------------------------------------------------- run helpers

const AsyncFunction = (async () => {}).constructor;

// REPL-style: if the code parses as a single expression it's returned automatically, otherwise it is
// a function body. We check with an async function so expressions using `await` count too.
function detectExpression(code) {
  const trimmed = String(code).replace(/[\s;]+$/, '');
  if (!trimmed.trim()) return { code: String(code), expression: false };
  try {
    // eslint-disable-next-line no-new
    new AsyncFunction('return (' + trimmed + '\n)');
    return { code: trimmed, expression: true };
  } catch {
    return { code: String(code), expression: false };
  }
}

function formatValue(value) {
  if (typeof value === 'string') {
    // Bare strings print as-is, except JSON objects/arrays (e.g. JSON.stringify(...) results, or an
    // extension that hands back the serialized string), which are pretty-printed.
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* not JSON */ }
    }
    return value;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value, null, 2);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------- formatting helpers

function out(s = '') { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function clock(t) {
  if (typeof t !== 'number') return '';
  const d = new Date(t);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}
function humanSize(n) {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}
function normalizeUrl(u) {
  if (!u) throw new UsageError('missing URL');
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return 'https://' + u;
}
function normalizeSite(s) {
  if (!s) throw new UsageError('missing <site>');
  let site = String(s).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(site)) {
    try { site = new URL(site).host; } catch { /* keep */ }
  }
  site = site.replace(/\/.*$/, '').toLowerCase();
  if (!site || /[\s\\]/.test(site) || isIgnoredName(site) || badName(site)) throw new UsageError(`"${s}" doesn't look like a hostname`);
  return site;
}
function prettyBody(text) {
  if (typeof text !== 'string') return text;
  const t = text.trim();
  if (!t || !(t.startsWith('{') || t.startsWith('['))) return text;
  try { return JSON.parse(t); } catch { return text; }
}
function titleCase(kebab) {
  return kebab.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------- command plumbing

function tabArgs(opts) {
  const a = {};
  if (opts['--tab'] !== undefined) {
    const n = Number(opts['--tab']);
    if (!Number.isInteger(n)) throw new UsageError('--tab needs a numeric tab id (see trif tabs)');
    a.tab = n;
  }
  if (opts['--url'] !== undefined) a.url = opts['--url'];
  return a;
}

/**
 * Which helper to talk to: `--browser <name|pid>` picks one of the connected browsers; inside an agent
 * run, the helper that started it (TRIF_SOCK); otherwise the default helper.sock (lib/helpers.js).
 */
async function resolveSock(ws, opts) {
  if (opts['--browser'] !== undefined) {
    if (envVar('RUN_TOKEN')) {
      throw new UsageError('--browser can\'t be used inside a side-panel agent run; it works on the browser it was started from');
    }
    return pickHelper(ws.home, opts['--browser']);
  }
  if (envVar('SOCK') && opts['--home'] === undefined) return envVar('SOCK');
  return ws.sock;
}

/**
 * A file the CLI reads (`write` false) or writes for its options (-f, -o, check). Inside a side-panel
 * agent run (TRIF_RUN_BOX) only the mods folder, and for writing the run's screenshots folder: the
 * run's sandbox enforces that too, and this says so plainly instead of "Operation not permitted".
 */
function optionPath(ctx, file, { write = false } = {}) {
  const resolved = path.resolve(String(file));
  if (!envVar('RUN_BOX')) return resolved;
  // Real paths, compared as the file system does (pathcheck.js: links, `..`, and case on macOS). For a
  // write, the folder is checked and the file itself must not be a link (written with O_NOFOLLOW below).
  const target = write ? path.join(realish(path.dirname(resolved)), path.basename(resolved)) : realish(resolved);
  const roots = [ctx.ws.modsDir, ...(write && envVar('RUN_SCREENSHOTS') ? [envVar('RUN_SCREENSHOTS')] : [])].map((r) => realish(r));
  if (!roots.some((r) => isInside(target, r))) {
    throw new UsageError(`inside a side-panel agent run, ${write ? 'files are written' : 'files are read'} only in ${roots.join(' or ')}`);
  }
  return target;
}

/** Write a file the CLI was told to (-o, screenshots): in a run, never through a link left in its place. */
function writeOptionFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!envVar('RUN_BOX')) { fs.writeFileSync(file, data); return; }
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
  try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
}

function makeCtx(opts) {
  const ws = P.workspace(opts['--home']);
  let sockP = null;
  const sock = () => sockP || (sockP = resolveSock(ws, opts));
  const call = async (cmd, args = {}, timeoutMs) => {
    const t = timeoutMs || (typeof args.timeout === 'number' ? args.timeout + 8000 : 40000);
    return request(await sock(), cmd, args, t);
  };
  return { ws, opts, call, sock, json: !!opts['--json'] };
}

function printJson(v) { out(JSON.stringify(v === undefined ? null : v, null, 2)); }

// What the side panel calls each group of mods (extension/lib.js modGroup), in a sentence.
// (the groups' stored names are rules, sandboxed and page; people know them as style, boxed and free mods)
const GROUP_NAMES = { rules: 'style mods', sandboxed: 'boxed mods', page: 'free mods' };

const handlers = {
  async help(ctx, pos) {
    if (pos[0]) {
      const h = commandHelp(pos[0]);
      if (!h) throw new UsageError(`unknown command "${pos[0]}"`);
      out(h);
    } else {
      out(mainHelp(ctx.ws.home));
    }
  },

  async setup(ctx) {
    const { setup } = require('./lib/setup');
    if (ctx.opts['--copy'] && ctx.opts['--link']) throw new UsageError('use --copy or --link, not both');
    if (ctx.opts['--examples'] !== undefined && ctx.opts['--no-examples']) throw new UsageError('use --examples or --no-examples, not both');
    // --examples: Tim's mods for every site; --examples x.com,google.com: for those.
    let examples = ctx.opts['--examples'] === undefined ? false : ctx.opts['--examples'];
    if (typeof examples === 'string') {
      try { examples = require('./lib/preinstalled').resolveSites(examples); } catch (e) { throw new UsageError(e.message); }
      if (!examples.length) throw new UsageError('--examples needs sites, like --examples x.com,google.com (or nothing, for every site)');
    }
    const r = setup({
      home: ctx.opts['--home'],
      browser: ctx.opts['--browser'],
      nativeDir: ctx.opts['--native-dir'],
      binDir: ctx.opts['--bin-dir'],
      noLink: !!ctx.opts['--no-link'],
      examples,
      noExamples: !!ctx.opts['--no-examples'],
      verbose: !!ctx.opts['--verbose'],
      mode: ctx.opts['--copy'] ? 'copy' : ctx.opts['--link'] ? 'link' : undefined,
      // Only for a person at a terminal (not scripts, tests or --json).
      reveal: !!process.stdout.isTTY && !ctx.json,
    });
    // API keys left in config.json (before 0.2.0) move to the keyring (agentkeys.js; async, so here).
    if (r.ws && r.ws.home) {
      try {
        const k = await require('./lib/agentkeys').migrateKeys(r.ws.home);
        // (After the agents line, or else before the next steps.)
        const at = r.lines.findIndex((l) => l.startsWith('agents ') || l.startsWith('✓ Found '));
        const next = r.lines.indexOf('Next steps:');
        if (k.notes.length) r.lines.splice(at !== -1 ? at + 1 : next > 0 ? next - 1 : r.lines.length, 0, ...k.notes.map((n) => `API keys      ${n}`));
      } catch (e) { r.lines.push(`API keys      couldn't move them out of config.json: ${e.message}`); }
    }
    if (ctx.json) printJson({ ok: r.ok, home: r.ws.home, mode: r.mode, app: r.root, manifests: r.manifests, node: r.nodePath });
    else out(r.lines.join('\n'));
    if (!r.ok) process.exitCode = 1;
    // At a terminal, wait for the browser and say as each step gets done (lib/setupwait.js).
    if (r.ok && r.targets && process.stdout.isTTY && !ctx.json && !ctx.opts['--no-wait']) {
      const { waitForBrowser, probe } = require('./lib/setupwait');
      let stop = () => {};
      const onInt = () => stop();
      process.on('SIGINT', onInt);
      try {
        const res = await waitForBrowser({ targets: r.targets, print: out, probe: () => probe(r.ws.home), trif: r.trif, onStop: (fn) => { stop = fn; } });
        if (res === 'skipped') out('\nSkipped the wait: the steps above still work.');
      } finally {
        process.removeListener('SIGINT', onInt);
      }
    }
  },

  async doctor(ctx) {
    const { doctor, formatDoctor } = require('./lib/doctor');
    const r = await doctor({ home: ctx.opts['--home'], nativeDir: ctx.opts['--native-dir'] });
    if (ctx.json) printJson(r); else out(formatDoctor(r));
    if (!r.ok) process.exitCode = 1;
  },

  async status(ctx) {
    const info = await ctx.call('ping', {}, 5000);
    let st = null;
    let stErr = null;
    try {
      st = await ctx.call('status', { timeout: 5000, ...tabArgs(ctx.opts) });
    } catch (e) {
      if (e.kind === 'no-helper') throw e;
      stErr = e.message;
    }
    // Other connected browsers (each has its own helper); a run only sees its own.
    const others = envVar('RUN_TOKEN') ? [] : (await listHelpers(ctx.ws.home)).filter((h) => h.pid !== info.pid);
    if (ctx.json) return printJson({ helper: info, extension: st, error: stErr, otherBrowsers: others.map((h) => ({ pid: h.pid, sock: h.sock, extension: h.info.extension })) });
    const lines = [];
    lines.push(`helper        running (pid ${info.pid}, v${info.helper}${info.role && info.role !== 'primary' ? `, ${info.role}` : ''})`);
    const ext = st || info.extension;
    if (!ext) {
      lines.push('extension     connected, but it has not said hello yet');
    } else {
      const firefox = ext.browser === 'Firefox';
      lines.push(`extension     v${ext.version} on ${ext.browser || 'Chrome'} ${ext.chrome}`);
      lines.push(ext.userScripts
        ? 'user scripts  on'
        : firefox
          ? 'user scripts  OFF: mods can\'t run. Fix: click the TRIF toolbar button in Firefox, then "Allow user scripts"'
          : `user scripts  OFF: mods can't run. Fix: open chrome://extensions/?id=${P.EXTENSION_ID} and turn on "Allow User Scripts"`);
    }
    if (stErr) lines.push(`status        the extension didn't answer: ${stErr}`);
    if (others.length) lines.push(`also          ${others.map(describeHelper).join(', ')}; pick one with --browser <name|pid>`);
    const registered = new Map(((st && st.mods) || []).map((m) => [m.id, !!m.registered]));
    const off = new Set(((st && st.mods) || []).filter((m) => m.enabled === false).map((m) => m.id));
    // Mods TRIF ships switched off: off because of that, not because the user switched them off.
    const shipsOff = shipped.startOffIds(ctx.ws.home);
    const offSites = new Map(((st && st.mods) || []).filter((m) => m.offSites).map((m) => [m.id, m.offSites]));
    const sitesOff = new Set(((st && st.mods) || []).filter((m) => m.sitesOff).map((m) => m.id));
    // Off because new mods of their group start off here (the user's setting): id -> 'new' | 'update'.
    const newOff = new Map(((st && st.mods) || []).filter((m) => m.newOff).map((m) => [m.id, m.newOff]));
    const applyErrors = new Map((((info.modsApplied || {}).errors) || []).map((e) => [e.id, e.error]));
    const helperErrors = new Map((info.modErrors || []).map((e) => [e.id, e.error]));
    const held = info.held || {};
    const review = info.review || {};
    const updates = info.updates || {};
    const ids = [...new Set([...(info.mods || []), ...registered.keys()])].sort();
    if (st && st.groupsOff && Object.keys(st.groupsOff).length) {
      const name = GROUP_NAMES;
      lines.push(`GROUPS OFF    ${Object.entries(st.groupsOff).map(([site, gs]) => `${gs.map((g) => name[g] || g).join(' and ')} off on ${site}`).join('; ')} (the user's choice, in the side panel: those mods don't run there)`);
    }
    if (st && Array.isArray(st.startsOff) && st.startsOff.length) {
      const name = GROUP_NAMES;
      lines.push(`NEW MODS      new ${st.startsOff.map((g) => name[g] || g).join(' and ')} start off in this browser (the user's setting, in the side panel's Settings), except ones made in its side panel`);
    }
    if (st && st.sandbox === false) lines.push(`NO SANDBOX    ${st.browser || 'this browser'} can't run boxed mods: each waits for the user's OK (in the side panel) to run as a free mod instead`);
    // Sandboxed mods as the extension runs them: in TRIF's sandbox, or ('page') as page scripts
    const sandboxedAs = new Map(((st && st.mods) || []).filter((m) => m.sandboxed).map((m) => [m.id, m.sandboxed]));
    const sandboxHeld = new Map(((st && st.mods) || []).filter((m) => m.held && m.held.by === 'sandbox').map((m) => [m.id, m.held]));
    if (st && st.paused) lines.push('PAUSED        every mod is paused in this browser (the user\'s choice, in the side panel\'s Settings): nothing runs until they resume');
    lines.push(`mods          ${ids.length} in ${info.modsDir}`);
    for (const id of ids) {
      let s;
      if (helperErrors.has(id)) s = `NOT SENT: ${helperErrors.get(id)}`;
      else if (held[id]) s = `${(info.pending || []).includes(id) ? 'CHANGE WAITING (the version before runs meanwhile)' : 'HELD'}: it ${(held[id].facts || [held[id].reason]).join('; it ')} (trif approve ${id}, or trif reject ${id})`;
      else if (sandboxHeld.has(id)) s = `WAITING: ${sandboxHeld.get(id).facts[0]}; only the user can allow that, in the side panel`;
      else if (off.has(id)) s = newOff.has(id) ? `off (${newOff.get(id) === 'update' ? 'updated by TRIF' : 'new'}: waiting for the user to look at it)` : shipsOff.has(id) ? 'off (as TRIF ships it)' : 'off';
      else if (sitesOff.has(id)) s = 'waiting: TRIF is off on its site';
      else if (applyErrors.has(id)) s = `NOT REGISTERED: ${applyErrors.get(id)}`;
      else if (!st) s = '?';
      else if (!registered.has(id)) s = 'not known to the extension yet';
      else s = registered.get(id) ? 'registered' : 'NOT REGISTERED';
      if (sandboxedAs.has(id) && !sandboxHeld.has(id)) s += sandboxedAs.get(id) === 'page' ? ' (boxed mod, run as a free mod: the user allowed it, as this browser has no sandbox)' : ' (boxed)';
      if (offSites.has(id) && !off.has(id)) s += ` (off on ${offSites.get(id).join(', ')})`;
      if (updates[id]) s += `; ${updateText(updates[id])}`;
      if (review[id]) s += `; TO REVIEW: it ${review[id].facts.join('; it ')} (trif approve ${id} when that's fine)`;
      lines.push(`  ${pad(id, 40)} ${s}`);
    }
    for (const [id, err] of helperErrors) if (!ids.includes(id)) lines.push(`  ${pad(id, 40)} NOT SENT: ${err}`);
    if ([...off].some((id) => !shipsOff.has(id) && !newOff.has(id))) lines.push('              off = switched off by the user (trif enable <id> turns one back on)');
    if (newOff.size) lines.push('              off (new) = new mods of its kind start off in this browser (the user\'s setting); only the user switches it on, in the side panel or trif enable <id> in their terminal');
    if ([...off].some((id) => shipsOff.has(id))) lines.push('              off (as TRIF ships it) = a mod TRIF comes with, off until switched on (trif enable <id>)');
    if (Object.keys(held).length) lines.push('              HELD = new or changed, and it can do things the user hasn\'t allowed (TRIF read them from its code); not running until the user approves it');
    if (Object.keys(review).length) lines.push('              TO REVIEW = can do things the user hasn\'t seen yet (TRIF read them from its code); it runs meanwhile');
    if (Object.keys(updates).length) lines.push('              update available = TRIF has a new version of a mod it ships; see trif mod-update <id>');
    if (sitesOff.size) lines.push('              waiting = not running until the user turns TRIF on for the site, or connects it (side panel)');
    if (st && Array.isArray(st.sitesOn)) {
      lines.push(`sites on      ${st.sitesOn.length ? st.sitesOn.join(', ') : '(none)'}; TRIF is off everywhere else: no mods, no page commands`);
      // Permissive (every site by default) or restrictive (the user connects TRIF site by site), and TRIF's own
      // block list (extension/lib.js "site access"). Only the user changes either, in the side panel.
      if (st.siteMode) {
        lines.push(st.siteMode === 'permissive'
          ? 'site mode     permissive: access to every site by default; each site still follows its switch'
          : 'site mode     restrictive: TRIF is disconnected on every site the user hasn\'t connected (side panel on the site)');
      }
      if (Array.isArray(st.disconnected) && st.disconnected.length) {
        lines.push(`disconnected  ${st.disconnected.join(', ')}: on, but TRIF is disconnected there until the user connects it (side panel on the site)`);
      }
      if (Array.isArray(st.blockedSites) && st.blockedSites.length) {
        lines.push(`blocked       ${st.blockedSites.join(', ')}: blocked in TRIF; nothing from TRIF touches them (only the user unblocks them, in the side panel)`);
      }
    }
    if (st) lines.push(`recording     ${(st.recording || []).length ? st.recording.join(', ') : '(none)'}`);
    if (st && st.page) {
      lines.push(`this page     ${st.page.url} (tab ${st.page.tab})`);
      lines.push(st.page.mods.length ? `  ${st.page.mods.length} running here: ${st.page.mods.map((m) => m.id).join(', ')}` : '  no mods run here');
    } else if (st && (ctx.opts['--url'] !== undefined || ctx.opts['--tab'] !== undefined)) {
      lines.push('this page     (this version of the extension doesn\'t say which mods run on a page)');
    }
    out(lines.join('\n'));
  },

  async approve(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing mod id');
    // A held mod (a side-panel agent wrote it): allowed, and it runs. A mod to review (one the user has,
    // which can do things they haven't seen): what TRIF found in it is allowed, and it isn't asked about again.
    const id = modId(pos[0]);
    let r;
    try { r = await ctx.call('mod.approve', { id }, 10000); } catch (e) {
      if (!/isn't held/.test(e.message)) throw e;
      r = await ctx.call('mod.review', { id }, 10000);
      if (ctx.json) return printJson(r);
      return out(r.allowed.length ? `${r.id}: what it can do is allowed (${r.allowed.join(', ')})` : `${r.id}: nothing to allow`);
    }
    if (ctx.json) return printJson(r);
    out(`${r.id} approved: it runs from the next page load`);
  },

  async check(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing file');
    let file = pos[0];
    if (!fs.existsSync(file) && /^[^/\s]+\/[^/\s]+$/.test(file.replace(/\.js$/, ''))) file = path.join(ctx.ws.modsDir, `${file.replace(/\.js$/, '')}.js`);
    file = optionPath(ctx, file);
    const code = fs.readFileSync(file, 'utf8');
    const header = require('./lib/mods').parseHeader(code);
    if (header.rules && header.sandboxed) {
      const error = 'a mod is either a style mod (@style) or a boxed mod (@boxed), not both';
      if (ctx.json) printJson({ ok: false, error }); else out(`${path.resolve(file)}: ${error}`);
      process.exitCode = 1;
      return;
    }
    // A rules mod (lib/rules.js): its rules checked, nothing to compile; TRIF runs it with its own code
    if (header.rules) {
      try { require('./lib/rules').parseRules(code); } catch (e) {
        if (ctx.json) printJson({ ok: false, error: e.message }); else out(`${path.resolve(file)}: ${e.message}`);
        process.exitCode = 1;
        return;
      }
      if (ctx.json) return printJson({ ok: true, file: path.resolve(file), rules: true, powers: [] });
      out(`ok: ${path.resolve(file)} is a style mod and its rules check out`);
      return out('TRIF runs it with its own code: it can\'t send, click, load from elsewhere or run code, so it never waits for the user\'s OK.');
    }
    // Compiles without running anything (side-panel agents may not run code; this replaces node --check).
    // (a sandboxed mod's code is evaluated inside an async function: a top-level return or await is fine there)
    try { new vm.Script(header.sandboxed ? `(async function () {\n${code}\n})` : code, { filename: path.resolve(file), lineOffset: header.sandboxed ? -1 : 0 }); } catch (e) {
      const where = String(e.stack || '').split('\n').slice(0, 3).join('\n');
      if (ctx.json) printJson({ ok: false, error: e.message, where }); else out(`${where}`);
      process.exitCode = 1;
      return;
    }
    // A sandboxed mod (extension/sandbox.js): it never waits for the user's OK, as it can't act; what it uses
    // that the sandbox doesn't give it is listed (lib/sandboxlint.js), as it would fail there when it runs.
    if (header.sandboxed) {
      const lint = require('./lib/sandboxlint').sandboxLint(code);
      if (ctx.json) return printJson({ ok: true, file: path.resolve(file), sandboxed: true, powers: [], lint });
      out(`ok: ${path.resolve(file)} is a boxed mod and parses`);
      out('It runs in TRIF\'s sandbox, with only TRIF\'s API: it can\'t send, click, navigate or load anything, so it never waits for the user\'s OK.');
      if (!lint.length) return out('TRIF finds nothing in it that the sandbox would refuse.');
      const lines = code.split('\n');
      out('\nThe sandbox doesn\'t give it these, so they\'d fail when it runs (not a hold: rewrite them with the API, see "Boxed mods" in TECHNIQUES.md, or make it a free mod if it really needs them):');
      for (const l of lint) {
        out(`- ${l.what}: ${l.why}`);
        for (const n of l.lines.slice(0, 3)) out(`    line ${n}: ${lines[n - 1].trim().slice(0, 140)}`);
        if (l.lines.length > 3) out(`    (${l.lines.length - 3} more)`);
      }
      return;
    }
    // What TRIF reads in it (lib/powers.js): what would make it wait for the user's OK, line by line, and
    // how to write it so it doesn't, where that's possible. So an agent can check its own mod first.
    const { powersOf, modSites } = require('./lib/powers');
    const rel = path.relative(ctx.ws.modsDir, path.resolve(file)).split(path.sep);
    const id = rel.length === 2 ? `${rel[0]}/${rel[1].replace(/\.js$/, '')}` : path.basename(file, '.js');
    const powers = powersOf(code, { sites: modSites({ id, matches: header.matches }) });
    const lines = code.split('\n');
    if (ctx.json) return printJson({ ok: true, file: path.resolve(file), powers: powers.map(({ key, fact, found, lines: at }) => ({ key, fact, found, lines: at })) });
    out(`ok: ${path.resolve(file)} parses`);
    if (!powers.length) return out('TRIF finds nothing in it that waits for the user\'s OK.');
    out(`\nTRIF reads this in it, so it waits for the user's OK (unless they've allowed it before):`);
    for (const p of powers) {
      out(`- it ${p.fact}`);
      for (const n of p.lines.slice(0, 5)) out(`    line ${n}: ${lines[n - 1].trim().slice(0, 140)}`);
      if (p.lines.length > 5) out(`    (${p.lines.length - 5} more)`);
      for (const tip of checkTips(p)) out(`    how: ${tip}`);
    }
    out('\nIf the mod really needs it, keep it and tell the user what it does and why it waits. See "Writing mods TRIF can read" in TECHNIQUES.md.');
  },

  async enable(ctx, pos) { return switchMod(ctx, pos, true); },
  async disable(ctx, pos) { return switchMod(ctx, pos, false); },

  // Inside a run the helper does it (it knows the run's scope); otherwise the CLI moves the file itself,
  // so this works without the browser, and a running helper picks the change up like any other.
  async delete(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing mod id');
    const id = modId(pos[0]);
    const r = envVar('RUN_TOKEN') ? await ctx.call('mod.delete', { id }, 10000) : trash.deleteMod(ctx.ws, id);
    if (ctx.json) return printJson({ id: r.id, deleted: true });
    out(`deleted ${r.id}: it's in the trash for ${trash.TRASH_DAYS} days (trif restore ${r.id} brings it back)`);
  },

  // Updates work without the browser: the CLI checks and installs itself, and a running helper notices
  // the new version in <home>/app and reloads the extension onto it (host.js checkAppReplaced).
  async update(ctx) {
    const update = require('./lib/update');
    const inRun = !!envVar('RUN_TOKEN');
    if (ctx.opts['--auto'] !== undefined) {
      if (inRun) throw new UsageError("automatic updates can't be changed inside an agent run");
      const v = String(ctx.opts['--auto']).toLowerCase();
      if (!['on', 'off'].includes(v)) throw new UsageError('--auto takes on or off');
      update.setConfigKey(ctx.ws.home, 'autoUpdate', v === 'on' ? true : undefined);
      if (!ctx.json) out(`automatic updates ${v}`);
      ctx.ws = P.workspace(ctx.opts['--home']);
    }
    if (ctx.opts['--install']) {
      if (inRun) throw new UsageError("updates can't be installed inside an agent run");
      const r = await update.install(ctx.ws);
      if (ctx.json) return printJson({ updated: true, from: r.from, to: r.to, notes: r.notes, warning: r.warning });
      out(`updated TRIF ${r.from} -> ${r.to}. A running browser switches to it within a minute.`);
      if (r.warning) out(`warning: ${r.warning}\nRun \`trif setup\` to finish setting up, or \`trif doctor\` to see what's wrong.`);
      if (r.notes) out(`\n${r.notes}`);
      return;
    }
    const s = await update.check(ctx.ws, { force: true });
    if (ctx.json) return printJson(s);
    if (s.error) out(`TRIF ${s.current}: couldn't check for updates (${s.error})`);
    else if (s.available) {
      out(`TRIF ${s.latest} is available (you have ${s.current}).`);
      if (s.notes) out(`\n${s.notes}\n`);
      out(s.canInstall ? 'Install it with: trif update --install' : s.why);
    } else out(`TRIF ${s.current} is up to date.`);
    out(`Automatic updates: ${s.auto ? 'on (trif update --auto off)' : 'off (trif update --auto on)'}`);
  },

  // The same report as the side panel's "Report a problem", printed (--open: the report form, filled in):
  // with the browser's details when a helper is connected, else without them.
  async report(ctx) {
    let r;
    try {
      r = await ctx.call('report.build', {}, 30000);
    } catch {
      const { buildReport, reportEmail, reportUrl } = require('./lib/report');
      const { doctor } = require('./lib/doctor');
      const update = require('./lib/update');
      const agents = require('./lib/agents');
      const doc = await doctor({ home: ctx.opts['--home'] }).catch(() => null);
      const text = buildReport({ agents: agents.listAgents(ctx.ws).agents, update: update.summary(ctx.ws), doctor: doc, logFile: ctx.ws.log });
      r = { text: `${text}\n\n(The browser isn't connected, so its details are missing.)`, email: reportEmail(), url: reportUrl() };
    }
    if (ctx.opts['--open'] && r.url) {
      const { reportLink } = require('./lib/report');
      const link = reportLink(r.url, r.text);
      const { spawnSync } = require('child_process');
      const opened = spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [link], { stdio: 'ignore' }).status === 0;
      if (opened) return out(`Opened the report form (${r.url}) with these details filled in. Say what went wrong there and press Send.`);
    }
    if (ctx.json) return printJson(r);
    out(r.text);
    out('');
    if (r.url) out(`Send this, with what went wrong, with the form at ${r.url} (trif report --open fills it in)${r.email ? `, or email it to ${r.email}` : ''}.`);
    else out(`Send this, with what went wrong, to ${r.email || 'whoever gave you TRIF'}.`);
  },

  // A new version of a shipped mod the user changed (lib/preinstalled.js). Works without the browser;
  // a running helper sends the change on. The user's choice, so not inside a side-panel run.
  async 'mod-update'(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing mod id');
    const id = modId(pos[0]);
    const choices = ['--use-new', '--keep', '--merged'].filter((f) => ctx.opts[f]);
    if (choices.length > 1) throw new UsageError('pick one of --use-new, --keep and --merged');
    const { mods } = scanMods(ctx.ws.modsDir);
    const mod = mods.find((m) => m.id === id);
    const u = mod ? shipped.pendingUpdates(ctx.ws.home, [mod])[id] : null;
    if (!choices.length) {
      const rec = shipped.loadPreinstalled(ctx.ws.home).shipped[id];
      const files = rec && rec.pending ? {
        mine: mod ? mod.file : null, new: shipped.newFile(ctx.ws.home, id),
        base: rec.hash && fs.existsSync(shipped.baseFile(ctx.ws.home, id)) ? shipped.baseFile(ctx.ws.home, id) : null,
      } : null;
      if (ctx.json) return printJson({ id, update: u || null, files });
      if (!u) return out(`${id}: no new TRIF version waiting`);
      out(`${id}: ${updateText(u)}`);
      out(`  yours:            ${files.mine}`);
      out(`  the new version:  ${files.new}`);
      out(`  shipped before:   ${files.base || "(not kept: installed by a TRIF older than 0.1.2)"}`);
      out(`Use it (yours goes to the trash): trif mod-update ${id} --use-new`);
      out(`Keep yours (this version isn't offered again): trif mod-update ${id} --keep`);
      out(`Or merge the new version into yours (your agent can, from the files above), then: trif mod-update ${id} --merged`);
      return;
    }
    if (ctx.opts['--use-new']) {
      const r = shipped.useNewVersion(ctx.ws, id);
      if (ctx.json) return printJson({ id: r.id, choice: 'new', version: r.version, file: r.file, trashed: r.trashed });
      out(`${r.id} is now ${r.version ? `version ${r.version}` : 'the new version'}${r.trashed ? `; your copy is in the trash (trif restore ${r.id} brings it back)` : ''}`);
    } else if (ctx.opts['--keep']) {
      const r = shipped.keepMine(ctx.ws, id);
      if (ctx.json) return printJson({ id: r.id, choice: 'mine', version: r.version });
      out(`kept your ${r.id}; ${r.version ? `version ${r.version}` : 'this version'} won't be offered again (a later one will)`);
    } else {
      const rec = shipped.loadPreinstalled(ctx.ws.home).shipped[id];
      if (!rec || !rec.pending || !shipped.resolveMerge(ctx.ws.home, id, rec.pending.hash, ctx.ws)) throw new trash.TrashError(`there's no new TRIF version of ${id} waiting`);
      if (ctx.json) return printJson({ id, choice: 'merged', version: rec.pending.version || null });
      out(`${id}: marked as merged with ${rec.pending.version ? `version ${rec.pending.version}` : 'the new version'}`);
    }
  },

  async restore(ctx, pos) {
    if (!pos[0]) {
      const items = trash.listTrash(ctx.ws);
      if (ctx.json) return printJson({ trash: items });
      if (!items.length) return out('the trash is empty');
      for (const t of items) out(`${t.id}  deleted ${new Date(t.deletedAt).toLocaleString()}`);
      return;
    }
    const id = modId(pos[0]);
    const r = envVar('RUN_TOKEN') ? await ctx.call('mod.restore', { id }, 10000) : shipped.restoreMod(ctx.ws, id);
    if (ctx.json) return printJson({ id: r.id, restored: true, file: r.file });
    out(`restored ${r.id} (${r.file}); it's back on or off as it was before`);
  },

  async tabs(ctx) {
    const tabs = await ctx.call('tabs');
    if (ctx.json) return printJson(tabs);
    if (!Array.isArray(tabs) || !tabs.length) return out('(no tabs)');
    for (const t of tabs) {
      out(`${padL(t.id, 10)}${t.active ? '*' : ' '} ${t.title || '(untitled)'}\n${' '.repeat(12)}${t.url}`);
    }
  },

  async run(ctx, pos) {
    let code;
    if (ctx.opts['-f']) {
      const file = optionPath(ctx, ctx.opts['-f']);
      try { code = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`can't read ${ctx.opts['-f']}: ${e.message}`); }
    } else if (pos.length === 1 && pos[0] === '-') {
      code = await readStdin();
    } else if (pos.length) {
      code = pos.join(' ');
    } else {
      throw new UsageError("nothing to run: trif run '<code>' | -f file.js | -");
    }
    const det = detectExpression(code);
    const args = { code: det.code, expression: det.expression, ...tabArgs(ctx.opts) };
    if (ctx.opts['--timeout'] !== undefined) {
      const t = Number(ctx.opts['--timeout']);
      if (!(t > 0)) throw new UsageError('--timeout needs a number of milliseconds');
      args.timeout = t;
    }
    const callArgs = args.timeout ? args : { ...args, timeout: 10000 };
    const r = await ctx.call('run', callArgs);
    if (ctx.json) return printJson(r);
    out(formatValue(r && typeof r === 'object' && 'value' in r ? r.value : r));
  },

  async reload(ctx) {
    const r = await ctx.call('reload', { hard: !!ctx.opts['--hard'], ...tabArgs(ctx.opts) });
    if (ctx.json) return printJson(r);
    out(`reloaded ${r && r.url ? r.url : ''}`.trim());
  },

  async open(ctx, pos) {
    const r = await ctx.call('open', { to: normalizeUrl(pos[0]) });
    if (ctx.json) return printJson(r);
    out(`opened tab ${r && r.id}: ${r && r.url}`);
  },

  async reject(ctx, pos) {
    if (!pos[0]) throw new UsageError('usage: trif reject <site>/<mod>');
    const r = await ctx.call('mod.reject', { id: modId(pos[0]) }, 10000);
    if (ctx.json) return printJson(r);
    out(r.restored === 'removed' ? `${r.id}: it never ran, so it's in the trash now (trif restore ${r.id} brings it back)` : `${r.id}: the change wasn't allowed; the version before is back (the change is in trif history ${r.id})`);
  },

  async history(ctx, pos) {
    if (!pos[0]) throw new UsageError('usage: trif history <site>/<mod>');
    const id = modId(pos[0]);
    const historyLib = require('./lib/history');
    const r = { id, entries: historyLib.listHistory(ctx.ws, id).map((e) => ({ at: e.at, kind: e.kind })) }; // (works without the browser)
    if (ctx.json) return printJson(r);
    if (!r.entries.length) return out(`(no changes kept for ${r.id}: only side-panel runs' changes are, for 30 days)`);
    out(`${r.id}: what side-panel runs changed, newest first (trif undo ${r.id} puts back the newest)`);
    for (const e of r.entries) out(`  ${new Date(e.at).toLocaleString()}  ${e.kind === 'created' ? 'created by a run' : 'changed by a run (the version before is kept)'}`);
  },

  async undo(ctx, pos) {
    if (!pos[0]) throw new UsageError('usage: trif undo <site>/<mod>');
    const r = require('./lib/history').undoChange(ctx.ws, modId(pos[0])); // (works without the browser; the helper picks the change up)
    if (ctx.json) return printJson(r);
    out(r.restored === 'removed' ? `${r.id}: a run created it, so it's in the trash now (trif restore ${r.id} brings it back)` : `${r.id}: back to the version before ${new Date(r.at).toLocaleString()}; reload the page to see it (trif undo again goes back further)`);
  },

  async close(ctx) {
    if (ctx.opts['--tab'] === undefined && ctx.opts['--url'] === undefined) throw new UsageError('usage: trif close --tab <id> | --url <part of its address> [--force]');
    const r = await ctx.call('close', { ...(ctx.opts['--force'] ? { force: true } : {}), ...tabArgs(ctx.opts) });
    if (ctx.json) return printJson(r);
    out(`closed tab ${r && r.id}${r && r.url ? `: ${r.url}` : ''}`);
  },

  async navigate(ctx, pos) {
    const r = await ctx.call('navigate', { to: normalizeUrl(pos[0]), ...tabArgs(ctx.opts) });
    if (ctx.json) return printJson(r);
    out(`navigated to ${r && r.url}`);
  },

  async text(ctx) {
    const r = (await ctx.call('text', tabArgs(ctx.opts))) || {};
    if (ctx.json) return printJson(r);
    out(`# ${r.title || ''}\n# ${r.url || ''}\n\n${r.text || ''}`);
  },

  async sweep(ctx) {
    const { sweepArgs, formatSweep, SweepUsageError } = require('./lib/sweep');
    let args;
    try { args = sweepArgs(ctx.opts); } catch (e) { throw e instanceof SweepUsageError ? new UsageError(e.message) : e; }
    const r = await ctx.call('sweep', { ...args, ...tabArgs(ctx.opts) });
    if (ctx.json) return printJson(r);
    out(formatSweep(r));
  },

  async screenshot(ctx) {
    // --copy: a copy loaded in a window of its own (a tab that isn't showing, in Chrome) takes a page load or more.
    const r = await ctx.call('screenshot', { full: !!ctx.opts['--full'], copy: !!ctx.opts['--copy'], ...(ctx.opts['--force'] ? { force: true } : {}), timeout: 60000, ...tabArgs(ctx.opts) });
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec((r && r.dataUrl) || '');
    if (!m) throw new HelperError('the extension returned no image data', 'command');
    let file = ctx.opts['-o'];
    const runShots = envVar('RUN_SCREENSHOTS');
    // In a run, `-o name.png` is a name in the run's screenshots folder.
    if (file && envVar('RUN_BOX') && runShots && !path.isAbsolute(String(file))) file = path.join(runShots, String(file));
    if (!file) {
      // In a run, its own screenshots folder (it may not see other sites').
      const dir = envVar('RUN_SCREENSHOTS') || ctx.ws.screenshots;
      const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
      file = path.join(dir, `${stamp}.png`);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stamp}-${n}.png`);
    }
    try { file = optionPath(ctx, file, { write: true }); } catch (e) {
      if (!(e instanceof UsageError) || !envVar('RUN_BOX')) throw e;
      throw new UsageError(`inside a side-panel agent run, screenshots are saved in the run's screenshots folder${runShots ? ` (${runShots})` : ''} or the mods folder: leave out -o to save to the run's screenshots folder, or give just a file name (-o page.png)`);
    }
    writeOptionFile(file, Buffer.from(m[2], 'base64'));
    file = realFile(file);
    if (ctx.json) return printJson({ file, how: r.how || 'visible', full: !!r.full, note: r.note || null, ...(r.cut ? { cut: true } : {}), ...(r.stale ? { stale: true } : {}), ...(r.slices ? { slices: r.slices, viewport: r.viewport } : {}) });
    out(file);
    // On stderr, so $(trif screenshot) is still just the path; agents see it either way.
    if (r.note) process.stderr.write(`note: ${r.note}\n`);
  },

  async record(ctx, pos) {
    const site = normalizeSite(pos[0]);
    const mode = (pos[1] || 'on').toLowerCase();
    if (!['on', 'off'].includes(mode)) throw new UsageError('usage: trif record <site> [on|off]');
    const r = await ctx.call('record', { site, on: mode === 'on' });
    if (ctx.json) return printJson(r);
    const list = (r && r.recording) || [];
    out(`recording: ${list.length ? list.join(', ') : '(none)'}`);
    if (mode === 'on') out(`Takes effect on the next page load: trif reload --url ${site}`);
  },

  async requests(ctx) {
    const args = tabArgs(ctx.opts);
    if (ctx.opts['--filter'] !== undefined) args.filter = ctx.opts['--filter'];
    if (ctx.opts['--limit'] !== undefined) {
      const n = Number(ctx.opts['--limit']);
      if (!Number.isInteger(n) || n <= 0) throw new UsageError('--limit needs a positive integer');
      args.limit = n;
    }
    const r = await ctx.call('requests', args);
    if (ctx.json) return printJson(r);
    if (!Array.isArray(r) || !r.length) {
      return out('(no recorded requests; is recording on for this site? trif record <site> on, then reload)');
    }
    for (const q of r) {
      out(`${padL(q.i, 4)}  ${pad(q.method || '', 6)} ${padL(q.status ?? '', 3)}  ${pad(q.type || '', 5)} ${padL(humanSize(q.size), 7)}  ${q.url}`);
    }
  },

  async request(ctx, pos) {
    if (pos[0] === undefined) throw new UsageError('usage: trif request [TAB] <i> [-o file]');
    const i = Number(pos[0]);
    if (!Number.isInteger(i)) throw new UsageError('<i> must be the number shown by trif requests');
    const r = await ctx.call('request', { i, ...tabArgs(ctx.opts) });
    if (ctx.json && !ctx.opts['-o']) return printJson(r);
    const view = { ...r };
    if ('requestBody' in view) view.requestBody = prettyBody(view.requestBody);
    if (ctx.opts['-o']) {
      const body = prettyBody(r.responseText);
      const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n';
      const file = optionPath(ctx, ctx.opts['-o'], { write: true });
      writeOptionFile(file, text == null ? '' : text);
      delete view.responseText;
      view.responseFile = realFile(file);
      view.responseLength = typeof r.responseText === 'string' ? r.responseText.length : 0;
    } else if ('responseText' in view) {
      view.response = prettyBody(view.responseText);
      delete view.responseText;
    }
    printJson(view);
  },

  async errors(ctx) {
    const page = !!ctx.opts['--page'];
    const r = await ctx.call('errors', { ...(page ? { page: true } : {}), ...tabArgs(ctx.opts) });
    if (ctx.json) return printJson(r);
    if (page) {
      if (!Array.isArray(r) || !r.length) return out("(no errors from the page's own code in this tab; TRIF only sees them where a mod is on or recording is on)");
      for (const e of r) {
        out(`[${clock(e.time)}] ${e.message}${e.source ? `  (${e.source})` : ''}`);
        const stack = String(e.stack || '').split('\n').filter((l) => l.trim() && !l.includes(e.message)).slice(0, 8);
        for (const l of stack) out(`    ${l.trim()}`);
      }
      return;
    }
    if (!Array.isArray(r) || !r.length) return out('(no mod errors in this tab)');
    for (const e of r) {
      out(`[${clock(e.time)}] ${e.mod}: ${e.message}`);
      const stack = String(e.stack || '').split('\n').filter((l) => l.trim() && !l.includes(e.message)).slice(0, 8);
      for (const l of stack) out(`    ${l.trim()}`);
    }
  },

  async logs(ctx) {
    const r = await ctx.call('logs', tabArgs(ctx.opts));
    if (ctx.json) return printJson(r);
    if (!Array.isArray(r) || !r.length) return out('(no mod logs in this tab)');
    for (const l of r) {
      const args = Array.isArray(l.args) ? l.args.join(' ') : String(l.args ?? '');
      out(`[${clock(l.time)}] ${l.mod} ${l.level && l.level !== 'log' ? l.level + ': ' : ''}${args}`);
    }
  },

  async mods(ctx) {
    const { mods, problems, warnings } = scanMods(ctx.ws.modsDir);
    const plan = planMods(mods);
    const errors = [...problems, ...plan.errors];
    const { enabled, offSites, newOff } = await knownSwitches(ctx);
    const held = loadHeld(ctx.ws.home);
    const isHeld = (m) => held[m.id] && held[m.id].hash === m.hash;
    const updates = shipped.pendingUpdates(ctx.ws.home, mods);
    const shipsOff = shipped.startOffIds(ctx.ws.home); // off because TRIF ships them off, not the user's doing
    if (ctx.json) {
      return printJson({
        modsDir: ctx.ws.modsDir,
        mods: mods.map(({ code, ...m }) => ({
          ...m, ...(enabled.has(m.id) ? { enabled: enabled.get(m.id) } : {}), ...(offSites.has(m.id) ? { offSites: offSites.get(m.id) } : {}),
          ...(newOff.has(m.id) ? { newOff: newOff.get(m.id) } : {}),
          ...(isHeld(m) ? { held: held[m.id] } : {}), ...(updates[m.id] ? { update: updates[m.id] } : {}),
        })),
        errors,
        warnings,
      });
    }
    if (!mods.length && !errors.length) {
      out(`(no mods in ${ctx.ws.modsDir})`);
      out('Create one with: trif new <site> <mod>');
      return;
    }
    const errById = new Map(errors.map((e) => [e.id, e.error]));
    for (const m of mods) {
      out(m.id + (m.name !== path.basename(m.file, '.js') ? `  (${m.name})` : '') + (enabled.get(m.id) === false ? '  [off]' : ''));
      if (enabled.get(m.id) === false && newOff.has(m.id)) out(`  off: ${newOff.get(m.id) === 'update' ? 'TRIF updated it, and' : 'new, and'} new mods of its kind start off in this browser (the user's setting); not running until the user switches it on after looking at it (side panel, or trif enable ${m.id} in their terminal)`);
      else if (enabled.get(m.id) === false && shipsOff.has(m.id)) out(`  off, as TRIF ships it (not running; trif enable ${m.id} turns it on)`);
      else if (enabled.get(m.id) === false) out(`  switched off by the user (not running; trif enable ${m.id} turns it on)`);
      else if (offSites.has(m.id)) out(`  switched off by the user on ${offSites.get(m.id).join(', ')} (trif enable ${m.id} --site <site> turns it back on there)`);
      if (isHeld(m)) out(`  HELD: ${held[m.id].by === 'outside' ? 'new or changed since TRIF last let it run' : `a side-panel agent wrote it while working on ${held[m.id].site}`}, and TRIF found that it ${(held[m.id].facts || [held[m.id].reason]).join('; it ')}. Not running until the user approves it (trif approve ${m.id}).`);
      if (updates[m.id]) out(`  ${updateText(updates[m.id])}: trif mod-update ${m.id}`);
      if (m.description) out(`  ${m.description}`);
      if (m.rules) out('  kind: style mod (data TRIF runs; never waits for the user\'s OK)');
      else if (m.sandboxed) out('  kind: boxed mod (runs in TRIF\'s sandbox with only TRIF\'s API; never waits for the user\'s OK, except in a browser without the sandbox)');
      if (isShippedSource(m.source)) out(`  from TRIF${m.version ? `, version ${m.version}` : ''}`);
      out(`  matches: ${m.matches.join(' ')}`);
      if (m.risk) out(`  risk: ${m.risk.tier}${m.risk.why ? ` (${m.risk.why})` : ''}`);
      if (m.excludes.length) out(`  excludes: ${m.excludes.join(' ')}`);
      if (m.runAt !== 'document_start') out(`  run-at: ${m.runAt.replace('_', '-')}`);
      out(`  file: ${m.file}`);
      if (errById.has(m.id)) out(`  ERROR: ${errById.get(m.id)}`);
    }
    for (const p of problems) out(`${p.id}\n  ERROR: ${p.error}\n  file: ${p.file}`);
    for (const w of warnings) out(`warning: ${w.id}: ${w.warning}`);
  },

  async new(ctx, pos) {
    if (pos.length < 2) throw new UsageError('usage: trif new <site> <mod>');
    const site = normalizeSite(pos[0]);
    const mod = String(pos[1]).replace(/\.js$/, '');
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(mod) || badName(mod)) {
      throw new UsageError(`"${pos[1]}" isn't a good mod name: use kebab-case letters, digits and dashes (e.g. hide-sidebar)`);
    }
    const file = path.join(ctx.ws.modsDir, site, `${mod}.js`);
    if (fs.existsSync(file)) throw new HelperError(`${file} already exists`, 'command');
    // (--style and --boxed; --rules and --sandboxed, their names before, still work)
    const style = !!(ctx.opts['--style'] || ctx.opts['--rules']), boxed = !!(ctx.opts['--boxed'] || ctx.opts['--sandboxed']);
    if (style && boxed) throw new UsageError('--style or --boxed, not both');
    const tpl = fs.readFileSync(path.join(P.HELPER_DIR, 'templates', style ? 'rules.js' : boxed ? 'sandboxed.js' : 'mod.js'), 'utf8');
    let text = tpl;
    // all-sites mods run everywhere until the agent narrows the @match lines.
    if (site === ALL_SITES) text = text.replace(/^\/\/ @match .*\n(\/\/ @match .*\n)*/m, '// @match       *://*/*\n');
    text = text.replace(/\{\{site\}\}/g, site).replace(/\{\{mod\}\}/g, mod).replace(/\{\{name\}\}/g, titleCase(mod));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (ctx.json) return printJson({ id: `${site}/${mod}`, file: realFile(file) });
    out(realFile(file));
  },

  async agent(ctx, pos) {
    const sub = pos.shift() || 'list';
    if (sub === 'list') return agentList(ctx);
    if (sub === 'run') return agentRun(ctx, pos);
    if (sub === 'login') return agentLogin(ctx);
    if (sub === 'open-model') return agentOpenModel(ctx, pos);
    if (sub === 'key') return agentKeyCommand(ctx, pos);
    throw new UsageError(`unknown agent command "${sub}" (use: agent list | agent run | agent login | agent open-model | agent key)`);
  },

  async 'install-example'(ctx, pos) {
    const dir = P.examplesDir();
    const available = () => {
      const list = [];
      try {
        for (const site of fs.readdirSync(dir).sort()) {
          if (isIgnoredName(site)) continue;
          let names = [];
          try { names = fs.readdirSync(path.join(dir, site)); } catch { continue; }
          for (const n of names.sort()) if (n.endsWith('.js') && !isIgnoredName(n) && !n.endsWith('.test.js')) list.push(`${site}/${n.slice(0, -3)}`);
        }
      } catch { /* none */ }
      return list;
    };
    if (!pos[0]) {
      const list = available();
      if (ctx.json) return printJson(list);
      out(list.length ? `Available examples:\n${list.map((l) => '  ' + l).join('\n')}\n\nInstall one with: trif install-example <site>/<mod>` : `(no examples found in ${dir})`);
      return;
    }
    const m = /^([^/]+)\/([^/]+?)(\.js)?$/.exec(pos[0]);
    if (!m || badName(m[1]) || badName(m[2]) || isIgnoredName(m[1]) || isIgnoredName(m[2])) throw new UsageError('usage: trif install-example <site>/<mod>   (e.g. x.com/detox-timeline)');
    const [, site, mod] = m;
    const src = path.join(dir, site, `${mod}.js`);
    if (!fs.existsSync(src)) {
      const list = available();
      throw new HelperError(`no example ${site}/${mod}${list.length ? `; available: ${list.join(', ')}` : ` (looked in ${dir})`}`, 'command');
    }
    const dest = path.join(ctx.ws.modsDir, site, `${mod}.js`);
    if (fs.existsSync(dest) && !ctx.opts['--force']) {
      throw new HelperError(`${dest} already exists (use --force to overwrite it with the example)`, 'command');
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (ctx.json) return printJson({ id: `${site}/${mod}`, file: realFile(dest) });
    out(realFile(dest));
  },
};

// For `trif check`: how to write each kind of flagged thing so TRIF can read it, where there's a way that
// does the same job
function checkTips(p) {
  const tips = [];
  for (const f of p.found) {
    if (p.key === 'acts' && /dispatchEvent|Event/.test(f)) tips.push('to reach your own code, dispatch a CustomEvent named after the mod (new CustomEvent("my-mod-reset")) and listen for it, not a fake key press or click');
    else if (p.key === 'acts' && /click/.test(f)) tips.push('on your own button, call its handler directly; clicking the site\'s controls is acting for the user');
    else if (/createElement with a tag/.test(f)) tips.push('pass the tag as text: document.createElement("div"), one call per kind of element');
    else if (/setAttribute with a name/.test(f)) tips.push('name the attribute: el.setAttribute("aria-label", …), or set the property (el.title = …)');
    else if (/x\[…\] =/.test(f)) tips.push('x[k] = v: TRIF can\'t tell that from setting an element\'s src or href (which this mod\'s text mentions); keep data in a Map or use array methods (m.set(k, v), list.push(v), list.map(…)), or name the property');
    else if (/x\[…\]\(\)/.test(f)) tips.push('call the method by name (el.remove()), not through x[name]()');
    else if (/innerHTML with HTML built/.test(f)) tips.push('build the elements with createElement and set textContent, rather than HTML with values inside its tags');
    else if (/property name built|decod|spelled/.test(f)) tips.push('don\'t build names from pieces; for embedded data, Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) is read as data');
    else if (p.key === 'loads') tips.push('a fixed address (or data:/blob:) is fine; an address built at run time can carry what the mod reads to another site');
    else if (p.key.startsWith('site:')) tips.push('mods only use their own site, unless the user asked for something that lives elsewhere');
  }
  return [...new Set(tips)];
}

// A path as the system knows it (links resolved, /tmp as /private/tmp): what `trif new` and the like print,
// because an agent's run rules are built from the workspace's real path, and a path through a link (a
// TRIF_HOME under /tmp, a home folder behind a link) would be refused by them.
function realFile(file) {
  try { return path.join(fs.realpathSync(path.dirname(file)), path.basename(file)); } catch { return file; }
}

// ---------------------------------------------------------------- mod switches

// "update available (you've changed it): version 3" for a pendingUpdates entry.
function updateText(u) {
  return `update available${u.modified ? " (you've changed it)" : ''}${u.version ? `: version ${u.version}` : ''}`;
}

// "x.com/a", "sites/x.com/a.js", "~/.trif/sites/x.com/a.js" → "x.com/a".
function modId(arg) {
  const s = String(arg || '').trim().replace(/\\/g, '/').replace(/\.js$/, '');
  const m = /(?:^|\/)sites\/([^/]+\/[^/]+)$/.exec(s);
  const id = m ? m[1] : s;
  if (!/^[^/\s]+\/[^/\s]+$/.test(id)) throw new UsageError(`"${arg}" isn't a mod id: use <site>/<mod>, e.g. x.com/hide-reposts (see trif status)`);
  return id;
}

async function switchMod(ctx, pos, enabled) {
  if (!pos[0]) throw new UsageError('missing mod id');
  const id = modId(pos[0]);
  const only = ctx.opts['--site'];
  if (only !== undefined && !String(only).trim()) throw new UsageError('--site needs a hostname, e.g. --site twitter.com');
  const r = await ctx.call('mod.enable', { id, enabled, wait: true, ...(only !== undefined ? { site: String(only).trim() } : {}), ...tabArgs(ctx.opts) });
  if (ctx.json) return printJson(r);
  const site = r && r.site ? r.site : id.split('/')[0];
  if (r && r.site) {
    out(`${id} is ${enabled ? 'on' : 'off'} on ${r.site}`);
    if (r.modEnabled === false) out('That was the last site it was on, so the whole mod is off now.');
    else if (r.offSites && r.offSites.length) out(`Off on: ${r.offSites.join(', ')}`);
  } else out(`${id} is ${enabled ? 'on' : 'off'}`);
  if (r && r.reloaded != null) out(`reloaded tab ${r.reloaded}`);
  else out(`It applies from the next page load: reload open ${site} tabs to see it (trif reload --url ${site}).`);
}

// When the extension can be asked: {enabled: Map(mod id → enabled), offSites: Map(mod id → sites it's
// off on)}. Otherwise (no helper, no answer) both empty.
async function knownSwitches(ctx) {
  try {
    const st = await ctx.call('status', { timeout: 2000 }, 3000);
    const mods = (st && st.mods) || [];
    return {
      enabled: new Map(mods.map((m) => [m.id, m.enabled !== false])),
      offSites: new Map(mods.filter((m) => Array.isArray(m.offSites) && m.offSites.length).map((m) => [m.id, m.offSites])),
      newOff: new Map(mods.filter((m) => m.newOff).map((m) => [m.id, m.newOff])),
    };
  } catch {
    return { enabled: new Map(), offSites: new Map(), newOff: new Map() };
  }
}

// ---------------------------------------------------------------- agent commands

async function agentList(ctx) {
  let r;
  try {
    r = await ctx.call('agent.list', {}, 20000);
  } catch (e) {
    if (!(e instanceof HelperError && e.kind === 'no-helper')) throw e;
    r = require('./lib/agents').listAgents(ctx.ws); // same lookup the helper does
  }
  if (ctx.json) return printJson(r);
  for (const a of r.agents) {
    const what = a.available ? `${a.name}${a.version ? ' ' + a.version : ''}` : `${a.name}: not found`;
    const extra = [a.path, a.note, a.loggedIn === false ? 'not logged in' : '', a.id === r.default && a.available ? 'default' : ''].filter(Boolean).join('  ');
    out(`${pad(a.id, 11)}${pad(what, 30)}${extra}`);
  }
  if (!r.agents.some((a) => a.available)) {
    out('\nNo agent found. Install Claude Code (or Codex), then run `trif setup` in that terminal so the helper can find it.');
  }
}

// Open models through Codex (experimental; lib/agents/codex-oss.js): show or change the defaults in
// config.json `openModel` (written here directly: the helper reads config.json per run), and save or
// remove the provider's API key in the system keyring (lib/keyring.js). The key is read from stdin or a
// no-echo prompt, never from the command line (any same-user process can list arguments).
async function agentOpenModel(ctx, pos = []) {
  const oss = require('./lib/agents/codex-oss');
  if (ctx.opts['--key-env'] !== undefined) {
    throw new UsageError('--key-env is gone: TRIF no longer reads API keys from environment variables. Save the key in the keyring instead: trif agent open-model --set-key (it asks for it), then remove the export line from your shell profile');
  }
  if (pos.length) {
    // (Not echoed: it may be a key typed after --set-key.)
    throw new UsageError(`unexpected argument${pos.length === 1 ? '' : 's'} to agent open-model${ctx.opts['--set-key'] ? ': --set-key reads the key from stdin or asks for it; never put a key on the command line (if you just did, consider it seen by other programs and make a new one)' : ''}`);
  }
  if (ctx.opts['--set-key'] && ctx.opts['--remove-key']) throw new UsageError('--set-key or --remove-key, not both');
  const patch = {};
  if (ctx.opts['--provider'] !== undefined) patch.provider = String(ctx.opts['--provider']);
  if (ctx.opts['--model'] !== undefined) patch.model = String(ctx.opts['--model']);
  if (ctx.opts['--base-url'] !== undefined) patch.baseUrl = String(ctx.opts['--base-url']);
  if (Object.keys(patch).length) {
    try { oss.saveSettings(ctx.ws.home, patch); } catch (e) { throw new UsageError(e.message); }
  }
  if (ctx.opts['--set-key']) {
    const ws = P.workspace(ctx.ws.home);
    const om = oss.resolve(ws.config.openModel);
    if (!om.keyAccount) throw new UsageError(om.server ? `${om.name} runs without an API key: nothing to save` : 'set the custom server\'s address first (--base-url): its key is saved for that server');
    const key = process.stdin.isTTY ? await promptHidden(`${om.name} API key (not shown): `) : await readStdin();
    try { await oss.setKey(ws, key.trim()); } catch (e) { throw new UsageError(e.message); }
    if (!ctx.json) out(`Saved the ${om.name} API key in ${require('./lib/keyring').backend().name}.`);
  } else if (ctx.opts['--remove-key']) {
    try {
      const r = await oss.removeKey(P.workspace(ctx.ws.home));
      if (!ctx.json) out(r.removed ? 'Removed the API key.' : 'There was no API key saved.');
    } catch (e) { throw new UsageError(e.message); }
  }
  const s = await oss.settings(P.workspace(ctx.ws.home));
  if (ctx.json) return printJson(s);
  const e = s.effective;
  const p = s.providers.find((x) => x.id === e.provider);
  out(`provider  ${e.provider} (${p.label})${s.configured ? '' : '   (not set up yet: the defaults)'}`);
  out(`model     ${e.model || '(none: pick one with --model)'}`);
  out(`server    ${e.baseUrl || '(none: set one with --base-url)'}`);
  if (s.key) {
    const k = s.key;
    out(`API key   ${k.error ? `${k.stored ? 'saved, but ' : ''}${k.error}` : k.stored ? `saved in ${k.keyring} (not shown)`
      : e.keyRequired ? 'none yet: trif agent open-model --set-key' : 'none (fine if the server needs none; --set-key to save one)'}`);
  }
  out('\nUse it: pick "Open model (via Codex)" in the side panel\'s Settings, or trif agent run --agent codex-oss "…".');
  out('Change it: trif agent open-model --provider ollama|lmstudio|openrouter|custom [--model NAME] [--base-url URL] [--set-key | --remove-key]');
}

// An API key for plain Claude Code or Codex runs (lib/agentkeys.js), for people who use one instead of
// logging the agent in: saved in the keyring, sent by the run's key proxy, never in the agent's
// environment. Like open-model keys: from stdin or a no-echo prompt, never the command line.
async function agentKeyCommand(ctx, pos = []) {
  const keys = require('./lib/agentkeys');
  if (pos.length) throw new UsageError(`unexpected argument${pos.length === 1 ? '' : 's'} to agent key${ctx.opts['--set-key'] ? ': --set-key reads the key from stdin or asks for it; never put a key on the command line (if you just did, consider it seen by other programs and make a new one)' : ''}`);
  if (ctx.opts['--set-key'] && ctx.opts['--remove-key']) throw new UsageError('--set-key or --remove-key, not both');
  const id = ctx.opts['--agent'] ? String(ctx.opts['--agent']) : 'claude';
  if (!keys.AGENT_KEYS[id]) throw new UsageError(`--agent takes ${Object.keys(keys.AGENT_KEYS).join(' or ')} (open models: trif agent open-model --set-key)`);
  const s = keys.AGENT_KEYS[id];
  if (ctx.opts['--set-key']) {
    const key = process.stdin.isTTY ? await promptHidden(`${s.name} API key (not shown): `) : await readStdin();
    try { await keys.setAgentKey(id, key); } catch (e) { throw new UsageError(e.message); }
    if (!ctx.json) out(`Saved the ${s.name} API key in ${require('./lib/keyring').backend().name}.`);
  } else if (ctx.opts['--remove-key']) {
    try {
      const r = await keys.removeAgentKey(id);
      if (!ctx.json) out(r.removed ? `Removed the ${s.name} API key.` : `There was no ${s.name} API key saved.`);
    } catch (e) { throw new UsageError(e.message); }
  }
  const ws = P.workspace(ctx.ws.home);
  const h = await keys.hasAgentKey(id, { config: ws.config });
  if (ctx.json) return printJson({ agent: id, account: s.account, stored: h.stored, source: h.source, error: h.error });
  const kr = require('./lib/keyring').backend();
  out(`${id === 'claude' ? 'Claude Code' : 'Codex'}: ${h.source === 'keyring' ? `an ${s.name} API key is saved in ${kr.name} (not shown); side-panel runs send it through a key proxy`
    : h.source === 'config' ? `an ${s.name} API key is in config.json (${s.envVar}); run trif setup to move it to ${kr ? kr.name : 'a keyring'}`
      : `no ${s.name} API key saved: runs use ${id === 'claude' ? 'Claude Code' : 'Codex'}'s own login${h.error ? ` (${h.error})` : ''}`}`);
  if (h.source !== 'keyring') out(`Save one (most people log in instead): trif agent key --agent ${id} --set-key`);
}

// A line typed at the terminal without echoing it (the API key). Ctrl-C or Ctrl-D cancels.
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let buf = '';
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (err) reject(err); else resolve(buf);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003' || ch === '\u0004') return done(new UsageError('cancelled'));
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function agentRun(ctx, pos) {
  let prompt;
  if (pos.length === 1 && pos[0] === '-') prompt = await readStdin();
  else prompt = pos.join(' ');
  if (!prompt.trim()) throw new UsageError('missing prompt: trif agent run [--tab ID] [--url URL] "<what to change>"');
  const args = { prompt };
  if (ctx.opts['--agent']) args.agent = ctx.opts['--agent'];
  if (ctx.opts['--model']) args.model = ctx.opts['--model'];
  if (ctx.opts['--session']) args.sessionId = ctx.opts['--session'];
  if (ctx.opts['--tab'] !== undefined) args.tabId = tabArgs(ctx.opts).tab;
  if (ctx.opts['--url'] !== undefined) {
    args.url = normalizeUrl(ctx.opts['--url']);
  } else {
    // No URL: ask Chrome which page that is (the given tab, or the active one).
    let tabs;
    try { tabs = await ctx.call('tabs', { timeout: 5000 }); } catch (e) {
      if (e.kind === 'no-helper') throw e;
      throw new UsageError(`pass --url <page URL> (couldn't ask Chrome for the current tab: ${e.message})`);
    }
    const t = (Array.isArray(tabs) ? tabs : []).find((x) => (args.tabId !== undefined ? x.id === args.tabId : x.active));
    if (!t) throw new UsageError(args.tabId !== undefined ? `no tab ${args.tabId} (see trif tabs)` : 'no active tab found: pass --url <page URL>');
    args.url = t.url;
    args.tabId = t.id;
  }
  args.site = require('./lib/agents').hostOf(args.url);
  if (!args.site) throw new UsageError(`"${args.url}" doesn't look like a page URL`);

  const sock = await ctx.sock();
  let runId = null;
  let interrupts = 0;
  const onSigint = () => {
    if (++interrupts > 1 || !runId) process.exit(130);
    process.stderr.write('stopping the agent (Ctrl-C again to quit now)…\n');
    request(sock, 'agent.stop', { runId }, 5000).catch(() => {});
  };
  process.on('SIGINT', onSigint);
  let done;
  try {
    done = await streamRun(sock, args, {
      onStart: (r) => {
        runId = r.runId;
        if (ctx.json) out(JSON.stringify({ runId }));
      },
      onEvent: (ev) => {
        if (ctx.json) return out(JSON.stringify(ev));
        if (ev.kind === 'text') { out(String(ev.text).trim()); out(''); }
        else if (ev.kind === 'tool') out(`  [${ev.name}]${ev.summary ? ' ' + ev.summary : ''}`);
        else if (ev.kind === 'error') process.stderr.write(`error: ${ev.reason === 'login' ? loginHelp(ev) : ev.message}\n`);
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  if (!ctx.json) {
    const status = done.ok ? 'ok' : done.stopped ? 'stopped' : 'failed';
    out(`done: ${status}${typeof done.costUsd === 'number' ? ` ($${done.costUsd.toFixed(4)})` : ''}`);
    if (done.sessionId) out(`session: ${done.sessionId}   (continue: trif agent run --session ${done.sessionId} --url ${args.url} "...")`);
    const files = Array.isArray(done.changedFiles) ? done.changedFiles : [];
    out(files.length ? `changed: ${files.join(', ')}` : 'changed: (no files)');
  }
  if (!done.ok) process.exitCode = 1;
}

// A run that failed for want of a login (its error event has reason "login"): how to log in from here.
function loginHelp(ev) {
  const a = require('./lib/agents').getAdapter(String(ev.agent || ''));
  if (!a) return ev.message;
  if (a.login) return `${ev.message} Run \`trif agent login --agent ${a.id}\`${a.loginFix ? `, or ${a.loginFix}` : ''}.`;
  return `${ev.message}${a.loginFix ? ` To log in, ${a.loginFix}.` : ''}`;
}

// Log the agent in through the helper, like the side panel's "Log in" button: print the sign-in URL,
// read the code from stdin, send it, print the result.
async function agentLogin(ctx) {
  const args = {};
  if (ctx.opts['--agent']) args.agent = ctx.opts['--agent'];
  const lines = stdinLines();
  const sock = await ctx.sock();
  let loginId = null;
  let interrupts = 0;
  const onSigint = () => {
    if (++interrupts > 1 || !loginId) process.exit(130);
    process.stderr.write('\ncancelling the login (Ctrl-C again to quit now)…\n');
    request(sock, 'agent.loginCancel', { loginId }, 5000).catch(() => {});
  };
  const askCode = async (send) => {
    const code = await lines.next();
    if (code === null || !code.trim()) {
      process.stderr.write('\nno code given: cancelling the login\n');
      send('agent.loginCancel', { loginId }).catch(() => {});
      return;
    }
    if (!ctx.json) out('Checking…');
    send('agent.loginCode', { loginId, code: code.trim() }).catch((e) => process.stderr.write(`error: ${e.message}\n`));
  };
  process.on('SIGINT', onSigint);
  let done;
  try {
    done = await streamLogin(sock, args, {
      onStart: (r) => {
        loginId = r.loginId;
        if (ctx.json) out(JSON.stringify({ loginId }));
      },
      onEvent: (ev, send) => {
        if (ctx.json) out(JSON.stringify(ev));
        if (ev.kind === 'login') {
          if (!ctx.json) {
            out('Open this page in your browser and sign in:\n');
            out(`  ${ev.url}\n`);
            process.stdout.write('Then paste the code it shows here: ');
          }
          askCode(send);
        } else if (ev.kind === 'error') {
          process.stderr.write(`error: ${ev.message}\n`);
        }
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
    lines.close();
  }
  if (!ctx.json) out(done.ok ? 'Logged in.' : done.cancelled ? 'Login cancelled.' : 'Not logged in.');
  if (!done.ok) process.exitCode = 1;
}

// stdin one line at a time: next() resolves a line, or null at the end.
function stdinLines() {
  const queue = [];
  const waiters = [];
  let buf = '';
  let ended = false;
  const push = (line) => { const w = waiters.shift(); if (w) w(line); else queue.push(line); };
  const end = () => {
    if (ended) return;
    if (buf) push(buf);
    buf = '';
    ended = true;
    while (waiters.length) waiters.shift()(null);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      push(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
    }
  });
  process.stdin.on('end', end);
  process.stdin.on('error', end);
  return {
    next: () => (queue.length ? Promise.resolve(queue.shift()) : ended ? Promise.resolve(null) : new Promise((r) => waiters.push(r))),
    close: () => { try { process.stdin.destroy(); } catch { /* ignore */ } },
  };
}

const NO_HELPER_MESSAGE = `trif: the helper isn't running, so page commands can't reach Chrome.
Open Chrome (with the TRIF extension installed). If Chrome is already open, run: trif doctor`;

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`trif: ${e.message}\n`);
    return 1;
  }
  const { opts, pos } = parsed;
  let cmd = pos.shift();
  if (!cmd) cmd = 'help';
  if (opts['--help'] && cmd !== 'help') { pos.unshift(cmd); cmd = 'help'; }
  const handler = handlers[cmd];
  if (!handler || !COMMANDS[cmd]) {
    process.stderr.write(`trif: unknown command "${cmd}". Run trif help for the list.\n`);
    return 1;
  }
  if (envVar('RUN_TOKEN') && NOT_IN_RUNS.has(cmd)) {
    process.stderr.write(`trif ${cmd}: not available inside a side-panel agent run (the user can run it in a terminal)\n`);
    return 1;
  }
  const ctx = makeCtx(opts);
  try {
    await handler(ctx, pos);
    return process.exitCode || 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`trif ${cmd}: ${e.message}\n`);
      if (COMMANDS[cmd]) process.stderr.write(`usage: ${COMMANDS[cmd].usage}\n`);
      return 1;
    }
    if (e instanceof HelperError && e.kind === 'no-helper') {
      // Inside a side-panel run the helper is reached through the run's mailbox: gone means the run ended.
      process.stderr.write((envVar('RUN_BOX') ? `trif: ${e.message}` : NO_HELPER_MESSAGE) + '\n');
      return 2;
    }
    if (e instanceof HelperError || e instanceof trash.TrashError) {
      if (ctx.json) printJson({ ok: false, error: e.message });
      process.stderr.write(`trif ${cmd}: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`trif ${cmd}: ${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

module.exports = { parseArgs, detectExpression, formatValue, normalizeSite, normalizeUrl, main, optionPath };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
