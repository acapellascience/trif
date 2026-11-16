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
  const base = nameOf(file) || nameOf(header.name) || 'mod';
  let mod;
  try { mod = helperMods.buildMod({ site: s, file: `${base}.js`, code }).mod; } catch (e) { return { error: `this mod's header has a problem: ${(e && e.message) || e}` }; }
  const tier = mod.rules ? 'style' : mod.sandboxed ? 'boxed' : 'free';
  const id = mod.id;
  const m = matchesUrl.toString();
  const guard = `if (!(${m})(location.href, ${JSON.stringify(mod.matches)}) || (${m})(location.href, ${JSON.stringify(mod.excludes || [])})) return;`;
  // (each world keeps the ids of the mods that started in it on this page: the Mods tab's "Running on this page")
  const ran = `(globalThis.__trifRan = globalThis.__trifRan || []).push(${JSON.stringify(id)});`;
  let script, world, at;
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
    // (its errors kept on the page, for the chat and the Mods tab: Browser.modErrors)
    script = `(async function () { ${guard}\n${ran}\n${String(mod.code)}\n})().catch((e) => { (window.__trifModErrors = window.__trifModErrors || []).push(${JSON.stringify(id)} + ": " + ((e && e.message) || e)); console.error("TRIF mod ${id}:", e); });`;
    world = 'page'; at = mod.runAt === 'document_start' ? 'start' : 'end';
  }
  return {
    id, site: s, name: mod.name, description: mod.description || '', tier, matches: mod.matches, excludes: mod.excludes || [],
    sites: s === 'all-sites' ? ['all-sites'] : codePowers.modSites(mod), runAt: mod.runAt, powers: mod.powers || [], powerArgs: mod.powerArgs || {},
    powerInfo: mod.sandboxed ? boxPowers.powerInfo(mod) : null, risk: mod.risk || null, hash: mod.hash,
    needs: needsOf(mod), code: code, script, world, at,
  };
}

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

const api = { readMod, parseMod, findMod, checkMod, jsonErrorLine, matchesUrl, appliesTo, needsOf, waiting, allow, lineDiff, nameOf, siteFor };
