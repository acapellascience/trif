'use strict';
// Mod discovery and header parsing. Shared by host.js (pushes mods to the extension) and
// cli.js (`trif mods`, `status`, `doctor`), so both always agree on what a mod is.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_TO_EXTENSION } = require('./framing');
const { within, ignoresCase } = require('./pathcheck');

const RUN_AT = {
  'document-start': 'document_start',
  'document_start': 'document_start',
  'start': 'document_start',
  'document-end': 'document_end',
  'document_end': 'document_end',
  'end': 'document_end',
  'document-idle': 'document_idle',
  'document_idle': 'document_idle',
  'idle': 'document_idle',
};

// What a shipped mod's `@source` says: `webmods` (the ones shipped while TRIF was called WebMods) or `trif`.
const SHIPPED_SOURCES = new Set(['webmods', 'trif']);
function isShippedSource(source) { return SHIPPED_SOURCES.has(String(source || '').toLowerCase()); }

const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;
const HEADER_LINE = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*?))?\s*$/;

function isIgnoredName(name) {
  return name.startsWith('_') || name.startsWith('.');
}

// Parse the `// ==WebMod==` block. Returns raw header values plus warnings; defaults are applied
// by buildMod because they depend on the folder and file name.
function parseHeader(code) {
  const out = { hasHeader: false, name: null, description: null, matches: [], excludes: [], runAt: null, risk: null, source: null, version: null, rules: false, sandboxed: null, warnings: [] };
  const lines = String(code).replace(/^﻿/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => HEADER_START.test(l));
  if (start === -1) return out;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADER_END.test(lines[i])) { end = i; break; }
  }
  if (end === -1) {
    out.warnings.push('found "// ==WebMod==" but no closing "// ==/WebMod=="; header ignored');
    return out;
  }
  out.hasHeader = true;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(HEADER_LINE);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] || '').trim();
    switch (key) {
      case 'name':
        if (value) out.name = value;
        break;
      case 'description':
        out.description = value;
        break;
      case 'match':
        if (value) out.matches.push(value);
        break;
      case 'exclude':
      case 'exclude-match':
        if (value) out.excludes.push(value);
        break;
      case 'risk': {
        // `@risk <0|1|2> [what makes it that tier]`: see "Account safety" in AGENTS.md.
        const r = /^([0-2])\b\s*(.*)$/.exec(value);
        if (r) out.risk = { tier: Number(r[1]), why: r[2].replace(/^[(:\-–—\s]+|[)\s]+$/g, '') };
        else out.warnings.push(`@risk should start with 0, 1 or 2 (got "${value}")`);
        break;
      }
      // `@source webmods` (or `@source trif`: SHIPPED_SOURCES) and `@version <n>` mark a mod TRIF ships
      // (examples/; they say webmods, from before the rename, so users' copies still match), which setup keeps up
      // to date while the user's copy is unchanged (preinstalled.js). Anyone may write them; the updater
      // also checks the mod is one it shipped.
      case 'source':
        if (value) out.source = value.toLowerCase();
        break;
      case 'version':
        if (value) out.version = value;
        break;
      // `@rules`: a rules mod (lib/rules.js): data after the header, run by TRIF's own code
      case 'rules':
        out.rules = true;
        break;
      // `@sandboxed` (SPIKE, docs/SAFE-MODS.md): run in TRIF's own userScripts world, not the page's.
      // `@sandboxed csp-only` is the spike's measuring variant: the same kind of world, without TRIF's prelude.
      // `@sandboxed standin`: the default-deny design (docs/SAFE-MODS.md "Stand-in design", extension/standin.js).
      case 'sandboxed':
        out.sandboxed = value.toLowerCase() === 'csp-only' ? 'csp-only' : value.toLowerCase() === 'standin' ? 'standin' : 'yes';
        break;
      case 'run-at': {
        const mapped = RUN_AT[value.toLowerCase()];
        if (mapped) out.runAt = mapped;
        else out.warnings.push(`unknown @run-at "${value}"; using document-start`);
        break;
      }
      default:
        break; // unknown keys are ignored
    }
  }
  return out;
}

// The folder for mods with no single home site (every site, or several unrelated ones).
const ALL_SITES = 'all-sites';

function defaultMatches(site) {
  if (site === ALL_SITES) return ['*://*/*'];
  const host = String(site).toLowerCase().replace(/:\d+$/, '');
  // `*.<ip>` is not a meaningful (or valid) host pattern, so IPs only get the exact pattern.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return [`*://${host}/*`];
  return [`*://${host}/*`, `*://*.${host}/*`];
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// Build a protocol Mod object. Only the contract's fields go into `mod`; warnings ride alongside.
function buildMod({ site, file, code }) {
  const base = path.basename(file).replace(/\.js$/, '');
  const header = parseHeader(code);
  const meta = {
    id: `${site}/${base}`,
    site,
    file: path.resolve(file),
    name: header.name || base,
    description: header.description || '',
    matches: header.matches.length ? header.matches : defaultMatches(site),
    excludes: header.excludes,
    runAt: header.runAt || 'document_start',
    risk: header.risk, // {tier, why} or null when the header doesn't say
    source: header.source, // 'webmods' (or 'trif') for the mods TRIF ships, else what the header says, or null
    version: header.version, // the header's @version, or null
    ...(header.sandboxed ? { sandboxed: header.sandboxed } : {}), // (SPIKE: see `@sandboxed` above)
  };
  const hash = sha1(JSON.stringify([meta.id, meta.name, meta.description, meta.matches, meta.excludes, meta.runAt, meta.risk, header.rules, header.sandboxed]) + '\n' + code);
  if (header.rules) {
    // (what runs is TRIF's code with the checked rules; throws a RulesError for the scanner to report)
    const rules = require('./rules');
    return { mod: { ...meta, rules: true, text: code, code: rules.rulesCode(rules.parseRules(code), meta.id), hash }, warnings: header.warnings };
  }
  return { mod: { ...meta, code, hash }, warnings: header.warnings };
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// The system's real path (links resolved, and on macOS each component in its on-disk case), or null.
function realOrNull(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

// A run may write its site's folder, so it can plant a link there (sites/x.com/a.js -> ~/.ssh/id_rsa, or
// sites/evil -> ~/.ssh). The helper reads mods outside any sandbox, so an entry whose real path is outside
// the real mods folder is never a mod: it's skipped, with a warning (`skipped`). Links within the mods
// folder are fine.
const LINK_OUTSIDE = 'is a link to somewhere outside the mods folder; ignored';

// List candidate mod files: <modsDir>/<site>/<mod>.js, skipping names starting with _ or ., and entries
// whose real path isn't inside the real mods folder. `skipped` (an array) collects those: {id, file, warning}.
function listModFiles(modsDir, skipped = null) {
  const files = [];
  const root = realOrNull(modsDir);
  if (!root) return files;
  const ci = ignoresCase(root);
  const inside = (p) => !!p && within(p, root, { ci });
  const skip = (id, file) => { if (skipped) skipped.push({ id, file, warning: LINK_OUTSIDE }); };
  let sites;
  try { sites = fs.readdirSync(modsDir); } catch { return files; }
  for (const site of sites.sort()) {
    if (isIgnoredName(site)) continue;
    const siteDir = path.join(modsDir, site);
    const st = statSafe(siteDir);
    if (!st || !st.isDirectory()) continue;
    if (!inside(realOrNull(siteDir))) { skip(`${site}/`, siteDir); continue; }
    let names;
    try { names = fs.readdirSync(siteDir); } catch { continue; }
    for (const name of names.sort()) {
      if (isIgnoredName(name) || !name.endsWith('.js') || name === '.js') continue;
      const file = path.join(siteDir, name);
      const fst = statSafe(file);
      if (!fst || !fst.isFile()) continue;
      if (!inside(realOrNull(file))) { skip(`${site}/${name.slice(0, -3)}`, file); continue; }
      files.push({ site, file, mtimeMs: fst.mtimeMs, size: fst.size });
    }
  }
  return files;
}

/**
 * Read a mod file only if it really is inside the mods folder: the file opened is the one whose real path
 * was checked (same device and inode after opening), so swapping in a link between the check and the read
 * doesn't work either. Throws otherwise.
 */
function readModFile(modsDir, file) {
  const root = realOrNull(modsDir);
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const real = realOrNull(file);
    const rst = real ? statSafe(real) : null;
    if (!root || !real || !within(real, root, { ci: ignoresCase(root) }) || !rst || rst.ino !== st.ino || rst.dev !== st.dev) {
      throw new Error(LINK_OUTSIDE);
    }
    if (!st.isFile()) throw new Error('not a file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

// Cheap fingerprint of the folder (names + mtimes + sizes) for change polling.
function folderFingerprint(modsDir) {
  return listModFiles(modsDir).map((f) => `${f.file}:${f.mtimeMs}:${f.size}`).join('\n');
}

// Read and parse every mod. Returns { mods, problems: [{id, file, error}], warnings: [{id, file, warning}] }
// (links outside the mods folder are among the warnings).
function scanMods(modsDir) {
  const mods = [];
  const problems = [];
  const warnings = [];
  for (const { site, file } of listModFiles(modsDir, warnings)) {
    const id = `${site}/${path.basename(file, '.js')}`;
    let code;
    try {
      code = readModFile(modsDir, file);
    } catch (e) {
      if (e.message === LINK_OUTSIDE) warnings.push({ id, file, warning: LINK_OUTSIDE });
      else problems.push({ id, file, error: `can't read file: ${e.message}` });
      continue;
    }
    let built;
    try { built = buildMod({ site, file, code }); } catch (e) { problems.push({ id, file, error: e.message }); continue; }
    const { mod, warnings: w } = built;
    for (const warning of w) warnings.push({ id, file, warning });
    mods.push(mod);
  }
  return { mods, problems, warnings };
}

// How big mods may be. Chrome and Firefox take at most 1 MB per native message, so a set bigger than that
// goes in parts (modsParts below) to an extension that says it can take them (hello `features`). The caps
// leave room under what browsers handle well (docs/PROTOCOL.md "How big mods can be" has the numbers):
// with 16 MB and eight changes in a row, headless Firefox 159 peaked at 1.2-1.3 GB in all (Chrome 156 at
// 0.7), where a 48 MB set, before the extension stopped asking Firefox for every script's code on every
// message, took it to 7.4 GB. Each change still passes the changed mod through the browser several times,
// and Firefox frees those copies late, so the per-mod cap matters as much as the total.
const MAX_MOD_BYTES = 4 * 1024 * 1024;
const MAX_MODS_BYTES = 16 * 1024 * 1024;
// (Sizes rounded up, so one just over a cap never reads as the cap itself: "4.1 MB; up to 4 MB".)
const MB = (n) => `${Math.ceil(n / (1024 * 1024) * 10) / 10} MB`;

/**
 * The mods TRIF sends, within the caps: a mod over `perMod` bytes of code is rejected; if the rest are over
 * `total` together, the largest are left out until they fit. Returns { mods, errors: [{id, error, limit}] }
 * (`limit`: 'mod' or 'total', so `trif doctor` can say what to do).
 */
function planMods(mods, { perMod = MAX_MOD_BYTES, total = MAX_MODS_BYTES } = {}) {
  const errors = [];
  let kept = [];
  for (const m of mods) {
    const size = Buffer.byteLength(String(m.code ?? ''));
    if (size > perMod) errors.push({ id: m.id, limit: 'mod', error: `mod is ${MB(size)}; a mod can be up to ${MB(perMod)}, so it was not sent to the browser (keep sounds, pictures and other big data out of its code)` });
    else kept.push({ m, size });
  }
  let sum = kept.reduce((n, s) => n + s.size, 0);
  if (sum > total) {
    const dropped = new Set();
    for (const s of [...kept].sort((a, b) => b.size - a.size)) {
      if (sum <= total) break;
      dropped.add(s);
      sum -= s.size;
      errors.push({ id: s.m.id, limit: 'total', error: `all mods together are over ${MB(total)}, the most TRIF sends to the browser; this one (the largest, ${MB(s.size)}) was not sent` });
    }
    kept = kept.filter((s) => !dropped.has(s));
  }
  return { mods: kept.map((s) => s.m), errors };
}

/**
 * For an extension that can't take a set in parts (0.2.4 and older): the {type:"mods"} message must fit in one
 * 1 MB native message. Mods that are too big on their own are rejected; if the set as a whole is still too
 * big, the largest are dropped. `who` names the extension in the errors ("TRIF 0.2.4 in Chrome"), whose
 * `limit` is 'extension': updating the extension lifts it.
 */
function planModsMessage(mods, { limit = MAX_TO_EXTENSION - 4096, who = 'this version of the extension' } = {}) {
  const errors = [];
  const update = `${who} takes at most 1 MB of mods; update it to send more`;
  const sized = mods.map((m) => ({ m, size: Buffer.byteLength(JSON.stringify(m)) }));
  let kept = [];
  for (const s of sized) {
    if (s.size > limit - 64) {
      errors.push({ id: s.m.id, limit: 'extension', error: `mod is ${Math.ceil(s.size / 1024)} KB and ${update}, so it was not sent` });
    } else {
      kept.push(s);
    }
  }
  const overhead = Buffer.byteLength(JSON.stringify({ type: 'mods', mods: [] }));
  let total = kept.reduce((n, s) => n + s.size + 1, overhead);
  if (total > limit) {
    const bySize = [...kept].sort((a, b) => b.size - a.size);
    const dropped = new Set();
    for (const s of bySize) {
      if (total <= limit) break;
      dropped.add(s);
      total -= s.size + 1;
      errors.push({ id: s.m.id, limit: 'extension', error: `all mods together are over 1 MB and ${update}; this (largest) mod was not sent` });
    }
    kept = kept.filter((s) => !dropped.has(s));
  }
  return { mods: kept.map((s) => s.m), errors };
}

/**
 * A message's JSON text cut into {type:"modsPart", set, i, n, data} messages, each under `limit` bytes as
 * sent (the slices are JSON-escaped again inside a part, so quotes and backslashes count twice, and anything
 * past ASCII up to three times). The extension joins the `data` of parts 0..n-1 of one `set` and parses it.
 */
function modsParts(json, set, limit = MAX_TO_EXTENSION) {
  const budget = limit - 256; // room for the part's own fields
  const slices = [];
  for (let pos = 0; pos < json.length;) {
    let want = Math.min(json.length - pos, budget);
    for (;;) {
      let end = pos + want;
      // (Not between the halves of a surrogate pair: each half alone would be escaped as \uXXXX.)
      if (end < json.length && end > pos + 1 && /[\ud800-\udbff]/.test(json[end - 1])) end--;
      const slice = json.slice(pos, end);
      const size = Buffer.byteLength(JSON.stringify(slice));
      if (size <= budget) { slices.push(slice); pos = end; break; }
      want = Math.max(1, Math.floor(want * (budget / size) * 0.98));
    }
  }
  return slices.map((data, i) => ({ type: 'modsPart', set, i, n: slices.length, data }));
}

/**
 * The mods to send an extension that takes 'modsSame' (hello `features`): a mod it already has, the same
 * id and hash as in the last set sent to it (`had`: id -> hash), goes without its code, marked `same`; the
 * extension takes the code from the copy it has. So a change to one mod sends that mod's code, not every
 * mod's again: with big mods, each whole copy costs the browser memory it can be slow to give back.
 */
function withSame(mods, had) {
  if (!had) return mods;
  return mods.map((m) => (typeof m.hash === 'string' && had.get(m.id) === m.hash ? { ...m, code: undefined, same: true } : m));
}

/**
 * Mods renamed on disk between two scans: a mod's id is its site folder and file name, so a renamed file
 * is a new id while the old one is gone; the same code in the same site folder is the same mod. Returns
 * [{from, to}], each old id paired once. (extension/lib.js findRenames does the same with the mods the
 * extension last got.)
 */
function findRenames(prev, next) {
  const before = new Set(prev.map((m) => m.id));
  const now = new Set(next.map((m) => m.id));
  const gone = prev.filter((m) => !now.has(m.id));
  const out = [];
  for (const m of next) {
    if (!gone.length) break;
    if (before.has(m.id)) continue;
    const i = gone.findIndex((g) => g.site === m.site && g.code === m.code);
    if (i === -1) continue;
    out.push({ from: gone[i].id, to: m.id });
    gone.splice(i, 1);
  }
  return out;
}

// The metadata of a mod, without its code (for listings).
function summarize(mod) {
  const { code, ...rest } = mod;
  return { ...rest, size: Buffer.byteLength(code) };
}

module.exports = {
  SHIPPED_SOURCES, isShippedSource,
  RUN_AT, ALL_SITES, parseHeader, defaultMatches, buildMod, listModFiles, readModFile, folderFingerprint, scanMods, LINK_OUTSIDE,
  planMods, planModsMessage, modsParts, withSame, MAX_MOD_BYTES, MAX_MODS_BYTES, summarize, isIgnoredName, sha1, findRenames,
};
