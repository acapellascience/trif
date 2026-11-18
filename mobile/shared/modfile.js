// A whole mod file on the iPhone (branch ios-poc): read the way the helper reads one (helper/lib/mods.js buildMod,
// bundled before this by prepare.js with the files it needs), named the way an import names one
// (helper/lib/share.js: its site from its @match, its name from the file's or its @name), what needs the user's
// OK worked out the way held.js does (a boxed mod's powers and their combinations, boxpowers.js; what TRIF's
// reading of a free mod's code finds, powers.js), and the code each world runs made ready. Ends by defining `api`.

const helperMods = require('./mods');
const boxPowers = require('./boxpowers');
const codePowers = require('./powers');
const lineDiff = require('./diff').lineDiff;

/** A Chrome-style match pattern (https://x.com/*, *://*.x.com/*, <all_urls>) as a test of an address. */
function matchesUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return (patterns || []).some((p) => {
    if (p === '<all_urls>') return /^https?:$/.test(u.protocol);
    const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
    if (!m) return false;
    if (m[1] !== '*' && u.protocol !== `${m[1]}:`) return false;
    if (m[1] === '*' && !/^https?:$/.test(u.protocol)) return false;
    const host = m[2];
    if (host !== '*') {
      if (host.startsWith('*.')) { const base = host.slice(2); if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false; }
      else if (u.hostname !== host) return false;
    }
    const path = new RegExp(`^${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return path.test(u.pathname + u.search);
  });
}
const appliesTo = (url, matches, excludes) => matchesUrl(url, matches) && !matchesUrl(url, excludes || []);

// (as helper/lib/share.js has them)
const SITE_RE = /^(?:all-sites|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;
const hostOfMatch = (m) => {
  if (m === '<all_urls>') return '*';
  const x = /^(?:\*|https?|file|ftp):\/\/([^/]+)\//.exec(String(m));
  if (!x) return null;
  return x[1].toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
};
const nameOf = (s) => String(s || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
// A mod file name the computer keeps as it is (helper/lib/phonelink/sync.js nameRefused's plain subset).
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
/** The mod's name from its file's: as it is if plain, else cleaned (nameOf). `site`: an import's, whose copies for the
 * phone are named `<site>-<name>.js` (also `phone~<site>-` and `www.<site>-`): that prefix goes. */
function fileName(file, site) {
  let b = String(file || '').split('/').pop().replace(/\.js$/i, '');
  if (!b) return '';
  if (site) {
    const lower = b.toLowerCase();
    for (const p of [`phone~${site}-`, `www.${site}-`, `${site}-`]) if (lower.startsWith(p) && b.length > p.length) { b = b.slice(p.length); break; }
  }
  return PLAIN_NAME.test(b) && !/\.$/.test(b) ? b : nameOf(b);
}
function stripShipped(text) {
  return String(text).split(/\r?\n/).filter((l) => !/^\s*\/\/\s*@(source|version)\b/i.test(l)).join('\n');
}

/** The site a mod is kept under: its @match's one host; for several, the page's if it's one of them, else the first; every site: all-sites. */
function siteFor(header, here) {
  const hosts = [...new Set(header.matches.map(hostOfMatch).filter(Boolean))];
  if (hosts.includes('*')) return 'all-sites';
  const ok = hosts.filter((x) => SITE_RE.test(x));
  const h = String(here || '').toLowerCase().replace(/^www\./, '');
  if (ok.length === 1) return ok[0];
  if (h && ok.includes(h)) return h;
  if (ok.length) return ok[0];
  return h && SITE_RE.test(h) ? h : null;
}

// (a line's hash, as held.js keeps them: a later version is asked about again only for a new or changed line)
const lineHash = (text) => require('crypto').createHash('sha1').update(String(text).trim()).digest('hex').slice(0, 16);

/** What needs the user's OK before the mod runs: [{key, fact, power?, lines?}], as held.js needsOf has it (no run scope here). */
function needsOf(mod) {
  if (mod.rules) return [];
  if (mod.sandboxed) return boxPowers.powerNeeds(mod).filter((n) => !n.soft).map((n) => ({ key: n.key, fact: n.fact, power: n.power }));
  const lines = String(mod.code || '').split('\n');
  const out = codePowers.powersOf(mod.code || '', { sites: codePowers.modSites(mod) })
    .map((p) => ({ key: p.key, fact: p.fact, lines: [...new Set((p.lines || []).map((n) => lineHash(lines[n - 1] || '')))] }));
  if (mod.risk && mod.risk.tier >= 2) out.push({ key: 'risk2', fact: 'says it changes what the site receives (risk 2)' });
  return out;
}

/** The needs not yet allowed: `allowed` is {key: [line hashes]} (allowed.json's shape for one mod). */
function waiting(needs, allowed) {
  const a = allowed || {};
  return (needs || []).filter((n) => !Object.prototype.hasOwnProperty.call(a, n.key) || (n.lines || []).some((l) => !(a[n.key] || []).includes(l)));
}

/** `allowed` with these needs added (Allow). */
function allow(needs, allowed) {
  const out = Object.assign({}, allowed || {});
  for (const n of needs || []) out[n.key] = [...new Set([...(out[n.key] || []), ...(n.lines || [])])];
  return out;
}

/**
 * A mod's text -> everything the app keeps and runs, or {error}. `file`: the file's name (an import), else the
 * mod is named by its @name; `site`: the site to keep it under, when known; `here`: the page's host (which of
 * several sites). `shipped`: keep @source/@version (only TRIF's own mods; an import or a chat never does).
 */
function readMod(text, { file = '', site = '', here = '', shipped = false } = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  if (!raw.trim()) return { error: 'the file is empty' };
  if (Buffer.byteLength(raw) > helperMods.MAX_MOD_BYTES) return { error: `the file is bigger than a mod can be (${helperMods.MAX_MOD_BYTES / 1024 / 1024} MB)` };
  const code = shipped ? raw : stripShipped(raw);
  let header;
  try { header = helperMods.parseHeader(code); } catch (e) { return { error: `this mod's header has a problem: ${(e && e.message) || e}` }; }
  if (!header.hasHeader) return { error: 'this file has no // ==WebMod== header, so it isn\'t a mod TRIF can read' };
  const s = site || siteFor(header, here);
  if (!s) return { error: 'its @match lines name no site' };
  // (a file keeps its name as the mod's, as the computer keeps sites/<site>/<name>.js: phone sync matches by it. An
  // import of the computer's copy for the phone, `<site>-<name>.js` (Send to iPhone, the iCloud folder, an export), is
  // <name> under <site>. Only a name the computer couldn't have is cleaned up. No file (a chat's, pasted): its @name.)
  const base = fileName(file, site ? '' : s) || nameOf(header.name) || 'mod';
  let mod;
  try { mod = helperMods.buildMod({ site: s, file: `${base}.js`, code }).mod; } catch (e) { return { error: `this mod's header has a problem: ${(e && e.message) || e}` }; }
  const tier = mod.rules ? 'style' : mod.sandboxed ? 'boxed' : 'free';
  const id = mod.id;
  const m = matchesUrl.toString();
  const guard = `if (!(${m})(location.href, ${JSON.stringify(mod.matches)}) || (${m})(location.href, ${JSON.stringify(mod.excludes || [])})) return;`;
  // (each world keeps the ids of the mods that started in it on this page: the Mods tab's "Running on this page")
  const ran = `(globalThis.__trifRan = globalThis.__trifRan || []).push(${JSON.stringify(id)});`;
  let script, world, at, styleScript = '';
  if (tier === 'style') {
    script = `(function () { ${guard}\n${ran}\n${mod.code}\n})();`;
    world = 'trif'; at = 'start';
  } else if (tier === 'boxed') {
    const grant = { powers: mod.powers || [], args: mod.powerArgs || {}, ...(mod.style ? { style: { css: String(mod.style.css || ''), values: mod.style.values || {} } } : {}) };
    script = `(function () { ${guard}\n` +
      'if (!globalThis.__trifSandbox) { if (typeof globalThis.__trifStartSandbox !== "function") return; globalThis.__trifStartSandbox(); }\n' +
      `${ran}\nglobalThis.__trifSandbox.run(${JSON.stringify(id)}, ${JSON.stringify(String(mod.code))}, ${JSON.stringify(grant)});\n})();`;
    // (one that filters the site's data starts with the page, as on desktop, so its filter is there before the
    // page's first requests; the others when the page has been read)
    world = 'box'; at = (mod.powers || []).includes('site-data') ? 'start' : 'end';
  } else {
    // (its errors kept on the page, for the chat and the Mods tab: Browser.modErrors, and told to the app's
    // Diagnostics, as its start is: freePageRuntime. A style section's values are its own `trif.style`, as on
    // desktop (extension/lib.js wrapModCode), on the line with `ran`: no line added before the code.)
    const values = styleValues(mod);
    const own = values ? ` const trif = (() => { const t = window.trif; return Object.freeze(Object.create(t && (typeof t === 'object' || typeof t === 'function') ? t : null, { style: { value: Object.freeze(${JSON.stringify(values)}), enumerable: true } })); })();` : '';
    const started = ` window.__trifFree && window.__trifFree.start(${JSON.stringify(id)});`;
    script = `(async function () { ${guard}\n${ran}${started}${own}\n${String(mod.code)}\n})().catch((e) => { (window.__trifModErrors = window.__trifModErrors || []).push(${JSON.stringify(id)} + ": " + ((e && e.message) || e)); window.__trifFree && window.__trifFree.error(${JSON.stringify(id)}, (e && e.message) || e); console.error("TRIF mod ${id}:", e); });\n//# sourceURL=trif://${id}.js`;
    world = 'page'; at = mod.runAt === 'document_start' ? 'start' : 'end';
    // (a style section's CSS: put on the page by TRIF itself, in TRIF's world at the page's start, where
    // style-mirror.js keeps it working on a page whose policy refuses inline styles; desktop puts it in a style
    // element of its own before the mod's code: extension/lib.js styleSectionCode)
    const css = mod.style && typeof mod.style.css === 'string' ? mod.style.css : '';
    if (css) styleScript = `(function () { ${guard}\n(${putStyle.toString()})(${JSON.stringify(id)}, ${JSON.stringify(css)});\n})();`;
  }
  return {
    id, site: s, name: mod.name, description: mod.description || '', tier, matches: mod.matches, excludes: mod.excludes || [],
    sites: s === 'all-sites' ? ['all-sites'] : codePowers.modSites(mod), runAt: mod.runAt, powers: mod.powers || [], powerArgs: mod.powerArgs || {},
    powerInfo: mod.sandboxed ? boxPowers.powerInfo(mod) : null, risk: mod.risk || null, hash: mod.hash,
    needs: needsOf(mod), code: code, script, world, at, styleScript,
  };
}

// ---- a free mod's style section, and its trif.log ------------------------------------------------------------

// (a style section's values as the code gets them, checked again as extension/lib.js styleOf does: a number, a
// colour, a word, true or false; null when the mod has no section)
const STYLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const STYLE_WORD = /^(?:[A-Za-z][A-Za-z0-9-]{0,39}|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8}))$/;
function styleValues(mod) {
  const st = mod && mod.style;
  if (!st || typeof st !== 'object' || Array.isArray(st)) return null;
  const values = {};
  const raw = st.values && typeof st.values === 'object' && !Array.isArray(st.values) ? st.values : {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (!STYLE_NAME.test(k)) continue;
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || (typeof v === 'string' && STYLE_WORD.test(v))) values[k] = v;
  }
  return values;
}

// (in TRIF's world, by itself: the section's CSS in a style element of its own, marked with the mod's id)
function putStyle(id, css) {
  const style = document.createElement('style');
  style.setAttribute('data-trif-style', id);
  style.textContent = css;
  const put = () => (document.head || document.documentElement).append(style);
  if (document.documentElement) put(); else document.addEventListener('readystatechange', put, { once: true });
}

/**
 * In the page's world, before any free mod (ModStore.userScripts, only where one may run): desktop's
 * window.trif.log/warn/error (extension/runtime.js; `expect` is a no-op here), each line told to TRIF's world
 * with the mod it's from (the script's trif://<id>.js in the call stack where an engine keeps sourceURL; WebKit's
 * stacks say only "user-script:N", so there: the free mod that started last on the page, desktop's fallback), and
 * `__trifFree`, which a free mod's wrapper tells when it starts and what it threw (WebKit gives a user script's
 * later errors, from an event or a timer, as "Script error." with no stack, so those can't be named and aren't
 * told). TRIF's world (freeRelay) caps them and hands them to the app's Diagnostics. Page code can call these as well (it's the page's world): what gets
 * through is capped there.
 */
function freePageRuntime() {
  if (window.top !== window || window.__trifFree) return;
  const nativeConsole = { log: console.log, warn: console.warn, error: console.error };
  const Ev = CustomEvent, dispatch = EventTarget.prototype.dispatchEvent, root = document, stringify = JSON.stringify;
  let current = null;
  const started = new Set();
  const modOf = (stack) => { const m = /trif:\/\/([^\s:)]+?)\.js/.exec(String(stack || '')); return m ? m[1] : null; };
  // (WebKit doesn't always start TRIF's world's scripts before the page's: lines wait, up to 60, until freeRelay says
  // it's there, answering this world's hello or as it starts)
  let ready = false;
  const waiting = [];
  const send = (detail) => { try { dispatch.call(root, new Ev('trif-free-mod', { detail })); } catch (e) { /* never throw into a mod */ } };
  const tell = (kind, mod, text) => {
    try {
      const detail = stringify({ kind, mod: mod || '', text: String(text).slice(0, 400), path: location.pathname });
      if (ready) send(detail); else if (waiting.length < 60) waiting.push(detail);
    } catch (e) { /* never throw into a mod */ }
  };
  root.addEventListener('trif-free-relay', () => { if (ready) return; ready = true; waiting.splice(0).forEach(send); });
  try { dispatch.call(root, new Ev('trif-free-hello')); } catch (e) { /* no relay yet */ }
  const show = (a) => { if (typeof a === 'string') return a; try { const s = stringify(a); return s === undefined ? String(a) : s; } catch (e) { return String(a); } };
  const logger = (level) => function (...args) {
    try {
      const mod = modOf(new Error().stack) || current;
      tell(level, mod, args.map(show).join(' '));
      nativeConsole[level].call(console, '[TRIF]', mod || '', ...args);
    } catch (e) { /* never throw into a mod */ }
  };
  if (!window.trif) window.trif = { log: logger('log'), warn: logger('warn'), error: logger('error'), expect: function () {} };
  if (!window.webmods) window.webmods = window.trif;
  Object.defineProperty(window, '__trifFree', {
    value: Object.freeze({
      start(id) { current = String(id); if (!started.has(current)) { started.add(current); tell('start', current, ''); } },
      error(id, message) { tell('error', String(id), message); },
    }),
  });
}

/**
 * In TRIF's world (to the app: Browser's "trif" handler, "modlog"): what freePageRuntime tells, at most 40 lines a
 * page load, each up to 200 characters, a mod's start once. The page's world is untrusted: only the kind, the mod's
 * id, the address's path and the line passed go on, cut to size.
 */
function freeRelay() {
  if (window.top !== window || globalThis.__trifFreeRelay) return;
  globalThis.__trifFreeRelay = true;
  let n = 0;
  const seen = new Set();
  const cut = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
  document.addEventListener('trif-free-mod', (e) => {
    try {
      if (n >= 40 || typeof e.detail !== 'string' || e.detail.length > 2000) return;
      const d = JSON.parse(e.detail);
      if (!d || !['start', 'log', 'warn', 'error'].includes(d.kind)) return;
      const mod = cut(d.mod, 100);
      if (d.kind === 'start') { if (seen.has(mod)) return; seen.add(mod); }
      n++;
      const more = n === 40 ? ' (no more lines from this page load)' : '';
      window.webkit.messageHandlers.trif.postMessage({ type: 'modlog', kind: d.kind, mod, path: cut(d.path, 100), text: cut(d.text, 200) + more });
    } catch (err) { /* not one of ours */ }
  }, true);
  // (here: to the page's world's runtime, if it started first, and whenever it says hello)
  const here = () => { try { document.dispatchEvent(new CustomEvent('trif-free-relay')); } catch (err) { /* no page yet */ } };
  document.addEventListener('trif-free-hello', here, true);
  here();
}

/** The two scripts above, as the app puts them in pages. */
const freePageScript = `(${freePageRuntime.toString()})();`;
const freeRelayScript = `(${freeRelay.toString()})();`;

// ---- checking an edit before it's saved (the code card's Edit: what `trif check` would say) -------------------

// Where a syntax error is: JavaScriptCore (the phone's engine) puts the line on the error; others don't, and then
// the error has no line. Each wrap adds lines of its own, so the offset is measured once with an error on a known line.
function errorLine(e) { return e && typeof e.line === 'number' ? e.line : null; }
const wrapAsync = (c) => `return (async function () {\n${c}\n})`;
let offsets = null;
function measure() {
  if (offsets) return offsets;
  const probe = (fn) => { try { fn(); } catch (e) { return e; } return null; };
  const js = probe(() => new Function(wrapAsync('\n\n;=')));
  const jl = errorLine(js);
  offsets = { js: jl === null ? null : jl - 3 };
  return offsets;
}

// The line of the first thing JSON.parse would stop at (JavaScriptCore's JSON errors say what, not where): a small
// reader that follows JSON's grammar and counts lines. null when it finds nothing wrong.
function jsonErrorLine(text) {
  const t = String(text);
  let i = 0;
  const fail = () => { throw new Error(String(t.slice(0, i).split('\n').length)); };
  const ws = () => { while (i < t.length && /\s/.test(t[i])) i++; };
  const lit = (w) => { if (t.startsWith(w, i)) i += w.length; else fail(); };
  const str = () => {
    i++;
    while (i < t.length && t[i] !== '"') {
      if (t[i] === '\n') fail();
      if (t[i] === '\\') { i++; if (!/["\\/bfnrtu]/.test(t[i] || '')) fail(); }
      i++;
    }
    if (t[i] !== '"') fail();
    i++;
  };
  const value = () => {
    ws();
    const c = t[i];
    if (c === '{') {
      i++; ws();
      if (t[i] === '}') { i++; return; }
      for (;;) { ws(); if (t[i] !== '"') fail(); str(); ws(); if (t[i] !== ':') fail(); i++; value(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === '}') { i++; return; } fail(); }
    }
    if (c === '[') {
      i++; ws();
      if (t[i] === ']') { i++; return; }
      for (;;) { value(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === ']') { i++; return; } fail(); }
    }
    if (c === '"') return str();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i));
    if (!m || !m[0]) fail();
    i += m[0].length;
  };
  try { value(); ws(); if (i < t.length) fail(); return null; } catch (e) { return Number(e.message) || null; }
}

// The header line an error is about: the @key it names, or the one a power's error comes from.
function headerLine(lines, message) {
  const m = String(message);
  const key = /@([\w-]+)/.exec(m);
  const want = key ? key[1] : /power/.test(m) ? 'powers' : /match/.test(m) ? 'match' : null;
  if (!want) return null;
  const i = lines.findIndex((l) => new RegExp(`^\\s*//\\s*@${want}\\b`, 'i').test(l));
  return i === -1 ? null : i + 1;
}

/**
 * An edit, checked as `trif check` checks a file (helper/cli.js check): its header, a style mod's rules and CSS, the
 * code's syntax, and for a boxed mod what the sandbox would refuse (sandboxlint.js). {ok, errors: [{line, message}],
 * lint: [{what, why, lines}], tier}. Nothing is kept: the app saves only an edit that's ok.
 */
function checkMod(text, opts = {}) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = raw.split('\n');
  const errors = [];
  let header;
  try { header = helperMods.parseHeader(raw); } catch (e) { errors.push({ line: null, message: String((e && e.message) || e) }); return { ok: false, errors, lint: [] }; }
  if (!header.hasHeader) return { ok: false, errors: [{ line: 1, message: 'this file has no // ==WebMod== header, so it isn\'t a mod TRIF can read' }], lint: [] };
  const end = lines.findIndex((l) => /^\s*\/\/\s*==\/WebMod==\s*$/i.test(l));
  const r = readMod(raw, opts);
  const tier = r.error ? (header.rules ? 'style' : header.sandboxed ? 'boxed' : 'free') : r.tier;
  if (r.error) {
    let line = headerLine(lines.slice(0, end + 1), r.error);
    // (a style mod's JSON: where JSON.parse stopped, in the file's lines; its comment lines kept as blank lines)
    if (header.rules && /valid JSON/.test(r.error)) {
      const body = lines.slice(end + 1).map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n').replace(/^(\s*)\(/, '$1 ').replace(/\)\s*;?\s*$/, '');
      const at = jsonErrorLine(body);
      if (at !== null) line = end + 1 + at;
    }
    // (a rule's problem names its key, "css" or "hide": the line where that key is)
    const plain = r.error.replace(/^this mod's header has a problem: /, '');
    const key = /^"([\w-]+)"/.exec(plain);
    if (line === null && key) { const i = lines.findIndex((l, n) => n > end && l.includes(`"${key[1]}"`)); if (i !== -1) line = i + 1; }
    // (readMod says "this mod's header has a problem" for everything buildMod refuses: only a header line is one)
    const inHeader = line !== null && line <= end + 1;
    errors.push({ line, message: inHeader ? r.error : plain });
    return { ok: false, errors, lint: [], tier };
  }
  if (tier === 'style') return { ok: true, errors, lint: [], tier };
  // (free and boxed mods run inside an async function: a top-level await or return is fine)
  try { new Function(wrapAsync(raw)); } catch (e) {
    const at = errorLine(e);
    const off = measure().js;
    errors.push({ line: at === null || off === null ? null : at - off, message: String((e && e.message) || e) });
    return { ok: false, errors, lint: [], tier };
  }
  const lint = tier === 'boxed' ? require('./sandboxlint').sandboxLint(raw, { powers: r.powers }) : [];
  return { ok: !lint.length, errors, lint, tier };
}

/** The first mod file in a chat's reply: a ```js block holding ==WebMod==, or the text itself. */
function findMod(text) {
  const t = String(text);
  for (const x of t.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) if (/==WebMod==/.test(x[1])) return x[1];
  const at = t.search(/^\s*\/\/\s*==WebMod==/m);
  return at === -1 ? null : t.slice(at);
}

// (the probe's earlier name for readMod)
const parseMod = (text, opts) => readMod(text, opts);

const api = { readMod, parseMod, findMod, checkMod, freePageScript, freeRelayScript, jsonErrorLine, matchesUrl, appliesTo, needsOf, waiting, allow, lineDiff, nameOf, siteFor };
