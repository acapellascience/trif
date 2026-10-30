'use strict';
// Mod discovery and header parsing. Shared by host.js (pushes mods to the extension) and
// cli.js (`webmods mods`, `status`, `doctor`), so both always agree on what a mod is.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_TO_EXTENSION } = require('./framing');

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

const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;
const HEADER_LINE = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*?))?\s*$/;

function isIgnoredName(name) {
  return name.startsWith('_') || name.startsWith('.');
}

// Parse the `// ==WebMod==` block. Returns raw header values plus warnings; defaults are applied
// by buildMod because they depend on the folder and file name.
function parseHeader(code) {
  const out = { hasHeader: false, name: null, description: null, matches: [], excludes: [], runAt: null, risk: null, warnings: [] };
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

function defaultMatches(site) {
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
  };
  const hash = sha1(JSON.stringify([meta.id, meta.name, meta.description, meta.matches, meta.excludes, meta.runAt, meta.risk]) + '\n' + code);
  return { mod: { ...meta, code, hash }, warnings: header.warnings };
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// List candidate mod files: <modsDir>/<site>/<mod>.js, skipping names starting with _ or .
function listModFiles(modsDir) {
  const files = [];
  let sites;
  try { sites = fs.readdirSync(modsDir); } catch { return files; }
  for (const site of sites.sort()) {
    if (isIgnoredName(site)) continue;
    const siteDir = path.join(modsDir, site);
    const st = statSafe(siteDir);
    if (!st || !st.isDirectory()) continue;
    let names;
    try { names = fs.readdirSync(siteDir); } catch { continue; }
    for (const name of names.sort()) {
      if (isIgnoredName(name) || !name.endsWith('.js') || name === '.js') continue;
      const file = path.join(siteDir, name);
      const fst = statSafe(file);
      if (!fst || !fst.isFile()) continue;
      files.push({ site, file, mtimeMs: fst.mtimeMs, size: fst.size });
    }
  }
  return files;
}

// Cheap fingerprint of the folder (names + mtimes + sizes) for change polling.
function folderFingerprint(modsDir) {
  return listModFiles(modsDir).map((f) => `${f.file}:${f.mtimeMs}:${f.size}`).join('\n');
}

// Read and parse every mod. Returns { mods, problems: [{id, file, error}], warnings: [{id, file, warning}] }.
function scanMods(modsDir) {
  const mods = [];
  const problems = [];
  const warnings = [];
  for (const { site, file } of listModFiles(modsDir)) {
    const id = `${site}/${path.basename(file, '.js')}`;
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (e) {
      problems.push({ id, file, error: `can't read file: ${e.message}` });
      continue;
    }
    const { mod, warnings: w } = buildMod({ site, file, code });
    for (const warning of w) warnings.push({ id, file, warning });
    mods.push(mod);
  }
  return { mods, problems, warnings };
}

// Make the {type:"mods"} message fit Chrome's 1 MB host->extension limit. Mods that are too big on
// their own are rejected; if the set as a whole is still too big, the largest are dropped.
function planModsMessage(mods, limit = MAX_TO_EXTENSION - 4096) {
  const errors = [];
  const sized = mods.map((m) => ({ m, size: Buffer.byteLength(JSON.stringify(m)) }));
  let kept = [];
  for (const s of sized) {
    if (s.size > limit - 64) {
      errors.push({ id: s.m.id, error: `mod is ${Math.ceil(s.size / 1024)} KB; Chrome's native messaging limit is 1 MB, so it was not sent to the extension` });
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
      errors.push({ id: s.m.id, error: 'all mods together exceed Chrome\'s 1 MB native messaging limit; this (largest) mod was not sent to the extension' });
    }
    kept = kept.filter((s) => !dropped.has(s));
  }
  return { mods: kept.map((s) => s.m), errors };
}

// The metadata of a mod, without its code (for listings).
function summarize(mod) {
  const { code, ...rest } = mod;
  return { ...rest, size: Buffer.byteLength(code) };
}

module.exports = {
  RUN_AT, parseHeader, defaultMatches, buildMod, listModFiles, folderFingerprint, scanMods,
  planModsMessage, summarize, isIgnoredName, sha1,
};
