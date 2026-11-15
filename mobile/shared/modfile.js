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
    world = 'box'; at = 'end';
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

/** The first mod file in a chat's reply: a ```js block holding ==WebMod==, or the text itself. */
function findMod(text) {
  const t = String(text);
  for (const x of t.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) if (/==WebMod==/.test(x[1])) return x[1];
  const at = t.search(/^\s*\/\/\s*==WebMod==/m);
  return at === -1 ? null : t.slice(at);
}

// (the probe's earlier name for readMod)
const parseMod = (text, opts) => readMod(text, opts);

const api = { readMod, parseMod, findMod, matchesUrl, appliesTo, needsOf, waiting, allow, lineDiff, nameOf, siteFor };
