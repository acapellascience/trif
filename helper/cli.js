#!/usr/bin/env node
'use strict';
// The `webmods` command. Talks to the helper (host.js) over $WEBMODS_HOME/helper.sock.
// Exit codes: 0 ok, 1 command error, 2 helper not running.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('./lib/paths');
const { request, streamRun, streamLogin, HelperError } = require('./lib/client');
const { ALL_SITES, scanMods, planModsMessage, isIgnoredName } = require('./lib/mods');
const { COMMANDS, mainHelp, commandHelp } = require('./lib/help');
const { loadHeld } = require('./lib/held');

// Inside a side-panel agent run (the helper set WEBMODS_RUN_TOKEN) these are the user's alone.
const NOT_IN_RUNS = new Set(['setup', 'agent', 'approve']);

// Output piped into something that stops reading early (`webmods tabs | head -1`) isn't an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const VALUE_FLAGS = new Set(['--tab', '--url', '-o', '--out', '--output', '--filter', '--limit', '-f', '--file',
  '--browser', '--home', '--native-dir', '--bin-dir', '--timeout', '--agent', '--session', '--model']);
const BOOL_FLAGS = new Set(['--json', '--hard', '--help', '-h', '--force', '--no-link', '--no-examples', '--copy', '--link']);
const ALIASES = { '--out': '-o', '--output': '-o', '--file': '-f', '-h': '--help' };

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
    } else if (BOOL_FLAGS.has(name)) {
      opts[name] = true;
    } else {
      throw new UsageError(`unknown option ${a} (see webmods help)`);
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
  if (!site || /[\s\\]/.test(site) || isIgnoredName(site)) throw new UsageError(`"${s}" doesn't look like a hostname`);
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
    if (!Number.isInteger(n)) throw new UsageError('--tab needs a numeric tab id (see webmods tabs)');
    a.tab = n;
  }
  if (opts['--url'] !== undefined) a.url = opts['--url'];
  return a;
}

function makeCtx(opts) {
  const ws = P.workspace(opts['--home']);
  const call = (cmd, args = {}, timeoutMs) => {
    const t = timeoutMs || (typeof args.timeout === 'number' ? args.timeout + 8000 : 40000);
    return request(ws.sock, cmd, args, t);
  };
  return { ws, opts, call, json: !!opts['--json'] };
}

function printJson(v) { out(JSON.stringify(v === undefined ? null : v, null, 2)); }

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
    const r = setup({
      home: ctx.opts['--home'],
      browser: ctx.opts['--browser'],
      nativeDir: ctx.opts['--native-dir'],
      binDir: ctx.opts['--bin-dir'],
      noLink: !!ctx.opts['--no-link'],
      noExamples: !!ctx.opts['--no-examples'],
      mode: ctx.opts['--copy'] ? 'copy' : ctx.opts['--link'] ? 'link' : undefined,
    });
    if (ctx.json) printJson({ ok: r.ok, home: r.ws.home, mode: r.mode, app: r.root, manifests: r.manifests, node: r.nodePath });
    else out(r.lines.join('\n'));
    if (!r.ok) process.exitCode = 1;
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
      st = await ctx.call('status', { timeout: 5000 });
    } catch (e) {
      if (e.kind === 'no-helper') throw e;
      stErr = e.message;
    }
    if (ctx.json) return printJson({ helper: info, extension: st, error: stErr });
    const lines = [];
    lines.push(`helper        running (pid ${info.pid}, v${info.helper}${info.role && info.role !== 'primary' ? `, ${info.role}` : ''})`);
    const ext = st || info.extension;
    if (!ext) {
      lines.push('extension     connected, but it has not said hello yet');
    } else {
      lines.push(`extension     v${ext.version} on Chrome ${ext.chrome}`);
      lines.push(ext.userScripts
        ? 'user scripts  on'
        : `user scripts  OFF: mods can't run. Fix: open chrome://extensions/?id=${P.EXTENSION_ID} and turn on "Allow User Scripts"`);
    }
    if (stErr) lines.push(`status        the extension didn't answer: ${stErr}`);
    const registered = new Map(((st && st.mods) || []).map((m) => [m.id, !!m.registered]));
    const off = new Set(((st && st.mods) || []).filter((m) => m.enabled === false).map((m) => m.id));
    const applyErrors = new Map((((info.modsApplied || {}).errors) || []).map((e) => [e.id, e.error]));
    const helperErrors = new Map((info.modErrors || []).map((e) => [e.id, e.error]));
    const held = info.held || {};
    const ids = [...new Set([...(info.mods || []), ...registered.keys()])].sort();
    lines.push(`mods          ${ids.length} in ${info.modsDir}`);
    for (const id of ids) {
      let s;
      if (helperErrors.has(id)) s = `NOT SENT: ${helperErrors.get(id)}`;
      else if (held[id]) s = `HELD: ${held[id].reason} (webmods approve ${id})`;
      else if (off.has(id)) s = 'off';
      else if (applyErrors.has(id)) s = `NOT REGISTERED: ${applyErrors.get(id)}`;
      else if (!st) s = '?';
      else if (!registered.has(id)) s = 'not known to the extension yet';
      else s = registered.get(id) ? 'registered' : 'NOT REGISTERED';
      lines.push(`  ${pad(id, 40)} ${s}`);
    }
    for (const [id, err] of helperErrors) if (!ids.includes(id)) lines.push(`  ${pad(id, 40)} NOT SENT: ${err}`);
    if (off.size) lines.push(`              off = switched off by the user (webmods enable <id> turns one back on)`);
    if (Object.keys(held).length) lines.push('              HELD = written by a side-panel agent for another site; not running until the user approves it');
    if (st) lines.push(`recording     ${(st.recording || []).length ? st.recording.join(', ') : '(none)'}`);
    out(lines.join('\n'));
  },

  async approve(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing mod id');
    const r = await ctx.call('mod.approve', { id: modId(pos[0]) }, 10000);
    if (ctx.json) return printJson(r);
    out(`${r.id} approved: it runs from the next page load`);
  },

  async check(ctx, pos) {
    if (!pos[0]) throw new UsageError('missing file');
    let file = pos[0];
    if (!fs.existsSync(file) && /^[^/\s]+\/[^/\s]+$/.test(file.replace(/\.js$/, ''))) file = path.join(ctx.ws.modsDir, `${file.replace(/\.js$/, '')}.js`);
    const code = fs.readFileSync(file, 'utf8');
    // Compiles without running anything (side-panel agents may not run code; this replaces node --check).
    try { new vm.Script(code, { filename: path.resolve(file) }); } catch (e) {
      const where = String(e.stack || '').split('\n').slice(0, 3).join('\n');
      if (ctx.json) printJson({ ok: false, error: e.message, where }); else out(`${where}`);
      process.exitCode = 1;
      return;
    }
    if (ctx.json) printJson({ ok: true, file: path.resolve(file) }); else out(`ok: ${path.resolve(file)} parses`);
  },

  async enable(ctx, pos) { return switchMod(ctx, pos, true); },
  async disable(ctx, pos) { return switchMod(ctx, pos, false); },

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
      try { code = fs.readFileSync(ctx.opts['-f'], 'utf8'); } catch (e) { throw new UsageError(`can't read ${ctx.opts['-f']}: ${e.message}`); }
    } else if (pos.length === 1 && pos[0] === '-') {
      code = await readStdin();
    } else if (pos.length) {
      code = pos.join(' ');
    } else {
      throw new UsageError("nothing to run: webmods run '<code>' | -f file.js | -");
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

  async screenshot(ctx) {
    const r = await ctx.call('screenshot', tabArgs(ctx.opts));
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec((r && r.dataUrl) || '');
    if (!m) throw new HelperError('the extension returned no image data', 'command');
    let file = ctx.opts['-o'];
    if (!file) {
      const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
      file = path.join(ctx.ws.screenshots, `${stamp}.png`);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(ctx.ws.screenshots, `${stamp}-${n}.png`);
    }
    file = path.resolve(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    if (ctx.json) return printJson({ file });
    out(file);
  },

  async record(ctx, pos) {
    const site = normalizeSite(pos[0]);
    const mode = (pos[1] || 'on').toLowerCase();
    if (!['on', 'off'].includes(mode)) throw new UsageError('usage: webmods record <site> [on|off]');
    const r = await ctx.call('record', { site, on: mode === 'on' });
    if (ctx.json) return printJson(r);
    const list = (r && r.recording) || [];
    out(`recording: ${list.length ? list.join(', ') : '(none)'}`);
    if (mode === 'on') out(`Takes effect on the next page load: webmods reload --url ${site}`);
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
      return out('(no recorded requests; is recording on for this site? webmods record <site> on, then reload)');
    }
    for (const q of r) {
      out(`${padL(q.i, 4)}  ${pad(q.method || '', 6)} ${padL(q.status ?? '', 3)}  ${pad(q.type || '', 5)} ${padL(humanSize(q.size), 7)}  ${q.url}`);
    }
  },

  async request(ctx, pos) {
    if (pos[0] === undefined) throw new UsageError('usage: webmods request [TAB] <i> [-o file]');
    const i = Number(pos[0]);
    if (!Number.isInteger(i)) throw new UsageError('<i> must be the number shown by webmods requests');
    const r = await ctx.call('request', { i, ...tabArgs(ctx.opts) });
    if (ctx.json && !ctx.opts['-o']) return printJson(r);
    const view = { ...r };
    if ('requestBody' in view) view.requestBody = prettyBody(view.requestBody);
    if (ctx.opts['-o']) {
      const body = prettyBody(r.responseText);
      const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n';
      const file = path.resolve(ctx.opts['-o']);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text == null ? '' : text);
      delete view.responseText;
      view.responseFile = file;
      view.responseLength = typeof r.responseText === 'string' ? r.responseText.length : 0;
    } else if ('responseText' in view) {
      view.response = prettyBody(view.responseText);
      delete view.responseText;
    }
    printJson(view);
  },

  async errors(ctx) {
    const r = await ctx.call('errors', tabArgs(ctx.opts));
    if (ctx.json) return printJson(r);
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
    const plan = planModsMessage(mods);
    const errors = [...problems, ...plan.errors];
    const enabled = await knownEnabled(ctx);
    const held = loadHeld(ctx.ws.home);
    const isHeld = (m) => held[m.id] && held[m.id].hash === m.hash && !held[m.id].approved;
    if (ctx.json) {
      return printJson({
        modsDir: ctx.ws.modsDir,
        mods: mods.map(({ code, ...m }) => ({
          ...m, ...(enabled.has(m.id) ? { enabled: enabled.get(m.id) } : {}), ...(isHeld(m) ? { held: held[m.id] } : {}),
        })),
        errors,
        warnings,
      });
    }
    if (!mods.length && !errors.length) {
      out(`(no mods in ${ctx.ws.modsDir})`);
      out('Create one with: webmods new <site> <mod>');
      return;
    }
    const errById = new Map(errors.map((e) => [e.id, e.error]));
    for (const m of mods) {
      out(m.id + (m.name !== path.basename(m.file, '.js') ? `  (${m.name})` : '') + (enabled.get(m.id) === false ? '  [off]' : ''));
      if (enabled.get(m.id) === false) out(`  switched off by the user (not running; webmods enable ${m.id} turns it on)`);
      if (isHeld(m)) out(`  HELD: a side-panel agent wrote it while working on ${held[m.id].site}, but ${held[m.id].reason}. Not running until the user approves it (webmods approve ${m.id}).`);
      if (m.description) out(`  ${m.description}`);
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
    if (pos.length < 2) throw new UsageError('usage: webmods new <site> <mod>');
    const site = normalizeSite(pos[0]);
    const mod = String(pos[1]).replace(/\.js$/, '');
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(mod)) {
      throw new UsageError(`"${pos[1]}" isn't a good mod name: use kebab-case letters, digits and dashes (e.g. hide-sidebar)`);
    }
    const file = path.join(ctx.ws.modsDir, site, `${mod}.js`);
    if (fs.existsSync(file)) throw new HelperError(`${file} already exists`, 'command');
    const tpl = fs.readFileSync(path.join(P.HELPER_DIR, 'templates', 'mod.js'), 'utf8');
    let text = tpl;
    // all-sites mods run everywhere until the agent narrows the @match lines.
    if (site === ALL_SITES) text = text.replace(/^\/\/ @match .*\n(\/\/ @match .*\n)*/m, '// @match       *://*/*\n');
    text = text.replace(/\{\{site\}\}/g, site).replace(/\{\{mod\}\}/g, mod).replace(/\{\{name\}\}/g, titleCase(mod));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (ctx.json) return printJson({ id: `${site}/${mod}`, file });
    out(file);
  },

  async agent(ctx, pos) {
    const sub = pos.shift() || 'list';
    if (sub === 'list') return agentList(ctx);
    if (sub === 'run') return agentRun(ctx, pos);
    if (sub === 'login') return agentLogin(ctx);
    throw new UsageError(`unknown agent command "${sub}" (use: agent list | agent run | agent login)`);
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
      out(list.length ? `Available examples:\n${list.map((l) => '  ' + l).join('\n')}\n\nInstall one with: webmods install-example <site>/<mod>` : `(no examples found in ${dir})`);
      return;
    }
    const m = /^([^/]+)\/([^/]+?)(\.js)?$/.exec(pos[0]);
    if (!m) throw new UsageError('usage: webmods install-example <site>/<mod>   (e.g. x.com/plain-x)');
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
    if (ctx.json) return printJson({ id: `${site}/${mod}`, file: dest });
    out(dest);
  },
};

// ---------------------------------------------------------------- mod switches

// "x.com/a", "sites/x.com/a.js", "~/.webmods/sites/x.com/a.js" → "x.com/a".
function modId(arg) {
  const s = String(arg || '').trim().replace(/\\/g, '/').replace(/\.js$/, '');
  const m = /(?:^|\/)sites\/([^/]+\/[^/]+)$/.exec(s);
  const id = m ? m[1] : s;
  if (!/^[^/\s]+\/[^/\s]+$/.test(id)) throw new UsageError(`"${arg}" isn't a mod id: use <site>/<mod>, e.g. x.com/hide-reposts (see webmods status)`);
  return id;
}

async function switchMod(ctx, pos, enabled) {
  if (!pos[0]) throw new UsageError('missing mod id');
  const id = modId(pos[0]);
  const r = await ctx.call('mod.enable', { id, enabled, wait: true, ...tabArgs(ctx.opts) });
  if (ctx.json) return printJson(r);
  const site = id.split('/')[0];
  out(`${id} is ${enabled ? 'on' : 'off'}`);
  if (r && r.reloaded != null) out(`reloaded tab ${r.reloaded}`);
  else out(`It applies from the next page load: reload open ${site} tabs to see it (webmods reload --url ${site}).`);
}

// When the extension can be asked: Map(mod id → enabled). Otherwise (no helper, no answer) empty.
async function knownEnabled(ctx) {
  try {
    const st = await ctx.call('status', { timeout: 2000 }, 3000);
    return new Map(((st && st.mods) || []).map((m) => [m.id, m.enabled !== false]));
  } catch {
    return new Map();
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
    out(`${pad(a.id, 8)}${pad(what, 26)}${extra}`);
  }
  if (!r.agents.some((a) => a.available)) {
    out('\nNo agent found. Install Claude Code (or Codex), then run `webmods setup` in that terminal so the helper can find it.');
  }
}

async function agentRun(ctx, pos) {
  let prompt;
  if (pos.length === 1 && pos[0] === '-') prompt = await readStdin();
  else prompt = pos.join(' ');
  if (!prompt.trim()) throw new UsageError('missing prompt: webmods agent run [--tab ID] [--url URL] "<what to change>"');
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
    if (!t) throw new UsageError(args.tabId !== undefined ? `no tab ${args.tabId} (see webmods tabs)` : 'no active tab found: pass --url <page URL>');
    args.url = t.url;
    args.tabId = t.id;
  }
  args.site = require('./lib/agents').hostOf(args.url);
  if (!args.site) throw new UsageError(`"${args.url}" doesn't look like a page URL`);

  let runId = null;
  let interrupts = 0;
  const onSigint = () => {
    if (++interrupts > 1 || !runId) process.exit(130);
    process.stderr.write('stopping the agent (Ctrl-C again to quit now)…\n');
    request(ctx.ws.sock, 'agent.stop', { runId }, 5000).catch(() => {});
  };
  process.on('SIGINT', onSigint);
  let done;
  try {
    done = await streamRun(ctx.ws.sock, args, {
      onStart: (r) => {
        runId = r.runId;
        if (ctx.json) out(JSON.stringify({ runId }));
      },
      onEvent: (ev) => {
        if (ctx.json) return out(JSON.stringify(ev));
        if (ev.kind === 'text') { out(String(ev.text).trim()); out(''); }
        else if (ev.kind === 'tool') out(`  [${ev.name}]${ev.summary ? ' ' + ev.summary : ''}`);
        else if (ev.kind === 'error') process.stderr.write(`error: ${ev.message}\n`);
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  if (!ctx.json) {
    const status = done.ok ? 'ok' : done.stopped ? 'stopped' : 'failed';
    out(`done: ${status}${typeof done.costUsd === 'number' ? ` ($${done.costUsd.toFixed(4)})` : ''}`);
    if (done.sessionId) out(`session: ${done.sessionId}   (continue: webmods agent run --session ${done.sessionId} --url ${args.url} "...")`);
    const files = Array.isArray(done.changedFiles) ? done.changedFiles : [];
    out(files.length ? `changed: ${files.join(', ')}` : 'changed: (no files)');
  }
  if (!done.ok) process.exitCode = 1;
}

// Log the agent in through the helper, like the side panel's "Log in" button: print the sign-in URL,
// read the code from stdin, send it, print the result.
async function agentLogin(ctx) {
  const args = {};
  if (ctx.opts['--agent']) args.agent = ctx.opts['--agent'];
  const lines = stdinLines();
  let loginId = null;
  let interrupts = 0;
  const onSigint = () => {
    if (++interrupts > 1 || !loginId) process.exit(130);
    process.stderr.write('\ncancelling the login (Ctrl-C again to quit now)…\n');
    request(ctx.ws.sock, 'agent.loginCancel', { loginId }, 5000).catch(() => {});
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
    done = await streamLogin(ctx.ws.sock, args, {
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

const NO_HELPER_MESSAGE = `webmods: the helper isn't running, so page commands can't reach Chrome.
Open Chrome (with the WebMods extension installed). If Chrome is already open, run: webmods doctor`;

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`webmods: ${e.message}\n`);
    return 1;
  }
  const { opts, pos } = parsed;
  let cmd = pos.shift();
  if (!cmd) cmd = 'help';
  if (opts['--help'] && cmd !== 'help') { pos.unshift(cmd); cmd = 'help'; }
  const handler = handlers[cmd];
  if (!handler || !COMMANDS[cmd]) {
    process.stderr.write(`webmods: unknown command "${cmd}". Run webmods help for the list.\n`);
    return 1;
  }
  if (process.env.WEBMODS_RUN_TOKEN && NOT_IN_RUNS.has(cmd)) {
    process.stderr.write(`webmods ${cmd}: not available inside a side-panel agent run (the user can run it in a terminal)\n`);
    return 1;
  }
  const ctx = makeCtx(opts);
  try {
    await handler(ctx, pos);
    return process.exitCode || 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`webmods ${cmd}: ${e.message}\n`);
      if (COMMANDS[cmd]) process.stderr.write(`usage: ${COMMANDS[cmd].usage}\n`);
      return 1;
    }
    if (e instanceof HelperError && e.kind === 'no-helper') {
      process.stderr.write(NO_HELPER_MESSAGE + '\n');
      return 2;
    }
    if (e instanceof HelperError) {
      if (ctx.json) printJson({ ok: false, error: e.message });
      process.stderr.write(`webmods ${cmd}: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`webmods ${cmd}: ${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

module.exports = { parseArgs, detectExpression, formatValue, normalizeSite, normalizeUrl, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
