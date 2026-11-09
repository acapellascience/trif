'use strict';
// Held mods, and what the user has allowed each mod to do.
//
// What a mod can do is read from its code (powers.js: sends requests, acts for the user, loads from
// addresses it works out, navigates, names other sites, has code TRIF can't check), never from what its
// header says: whoever wrote the mod wrote the header too. Plus two things from the file itself: @match
// patterns outside the run's site (scope.js), and a header that says risk tier 2.
//
// - A mod a side-panel run wrote or changed is HELD (registered nowhere) while it can do something the
//   user hasn't allowed for it. The panel shows what TRIF found, separately from what the agent says
//   (its @risk reason and description), with Allow.
// - Allowing keeps what was found allowed for that mod: each power, and the lines of code that use it.
//   A run's later edit runs straight away unless it adds a power or adds or changes a line that uses one
//   (a run on the site of a mod that may already send can't quietly rewrite what it sends); edits
//   elsewhere in it (its CSS, its selectors) don't ask again. For the user's own edits the review goes by
//   power alone.
// - Mods the user already has, and mods written outside a side-panel run (the user's own terminal), are
//   never held, but one that can do something not yet allowed is marked for REVIEW: the panel shows the
//   same facts once, with "Looks right" (allows them) and the mod's switch. (Mods TRIF ships start from
//   what their shipped version can do: an unchanged one has nothing to review.)
//
// Files (the helper's, outside sites/: side-panel runs can't write them):
//   $TRIF_HOME/held.json     mod id -> {hash, site, scope, runId, at, reason, facts, needs, claim}
//   $TRIF_HOME/allowed.json  mod id -> {powers: [key], lines: {key: [sha1 of a line]}, at}   (keys as
//                            powers.js gives them, plus `match:<pattern>` and `risk2`)
// A held entry lasts while that version of the mod is there; an edit makes it be worked out again.
// (Before 0.3.0 an approved hold stayed in held.json marked `approved`: it becomes allowed powers.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modSnapshot, diffSnapshots } = require('./runs');
const { outOfScope } = require('./scope');
const { within, ignoresCase } = require('./pathcheck');
const { powersOf, modSites } = require('./powers');

// powersOf reads every mod's code on each sync; a big mod takes a few hundred ms, so by hash.
const cache = new Map();
function powersFor(mod) {
  const key = `${mod.hash}:${mod.id}`;
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear();
    cache.set(key, powersOf(mod.code || '', { sites: modSites(mod) }));
  }
  return cache.get(key);
}

/**
 * Everything the mod can do that needs allowing: [{key, fact}]. `scope`: a side-panel run's site, whose
 * mods may only match it (others are listed as match:<pattern>); null for the review of a mod the user
 * has (any @match is theirs to choose).
 */
const lineHash = (text) => crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
function hashLines(code, numbers) {
  const lines = String(code || '').split('\n');
  return [...new Set(numbers.map((n) => lineHash(lines[n - 1] || '')))];
}

function needsOf(mod, scope = null) {
  const out = powersFor(mod).map((p) => ({ key: p.key, fact: p.fact, lines: hashLines(mod.code, p.lines || []) }));
  if (scope) for (const pattern of outOfScope(mod, scope)) out.push({ key: `match:${pattern}`, fact: `runs on ${pattern}, outside ${scope}` });
  if (mod.risk && mod.risk.tier >= 2) out.push({ key: 'risk2', fact: 'says it changes what the site receives (risk 2)' });
  return out;
}

// What a shipped mod's own version can do (its base in <home>/.shipped/), so the user's edit of it is
// judged on what it adds. null when the mod isn't one TRIF shipped.
function shippedBaseline(home, mod) {
  if (!home || !mod.source || !['webmods', 'trif'].includes(mod.source)) return null;
  const [site, ...rest] = String(mod.id).split('/');
  const file = path.join(home, '.shipped', site, `${rest.join('/')}.js`);
  let code;
  try { code = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return powersOf(code, { sites: modSites(mod) }).map((p) => ({ key: p.key, lines: hashLines(code, p.lines) }));
}

// The text a hold or review shows: TRIF's own words, one fact per line.
function reasonOf(needs) {
  return needs.map((n) => n.fact).join('; ');
}

// What the agent says the mod does: shown as the agent's claim, apart from TRIF's facts.
function claimOf(mod) {
  const why = mod.risk && mod.risk.why ? mod.risk.why : '';
  return String(why || mod.description || '').slice(0, 300);
}

/** Why a run's mod must wait, or '' (TRIF's words). */
function holdReason(mod, scope, allowed = []) {
  const ok = new Set(allowed);
  return reasonOf(needsOf(mod, scope).filter((n) => !ok.has(n.key)));
}

function heldFile(home) { return path.join(home, 'held.json'); }
function allowedFile(home) { return path.join(home, 'allowed.json'); }

function loadJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function saveJson(file, obj) {
  if (!Object.keys(obj).length) { try { fs.unlinkSync(file); } catch { /* none */ } return; }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const loadHeld = (home) => loadJson(heldFile(home));
const saveHeld = (home, held) => saveJson(heldFile(home), held);
const loadAllowed = (home) => loadJson(allowedFile(home));

// What's allowed for a mod: {keys: Set, lines: Map key -> Set of line hashes}, from allowed.json and, for
// a mod TRIF ships, its shipped version.
function allowedFor(home, mod, allowed = loadAllowed(home)) {
  const a = allowed[mod.id] || {};
  const keys = new Set(Array.isArray(a.powers) ? a.powers : []);
  const lines = new Map(Object.entries(a.lines && typeof a.lines === 'object' ? a.lines : {}).map(([k, v]) => [k, new Set(Array.isArray(v) ? v : [])]));
  for (const b of shippedBaseline(home, mod) || []) {
    keys.add(b.key);
    if (!lines.has(b.key)) lines.set(b.key, new Set());
    for (const h of b.lines) lines.get(b.key).add(h);
  }
  return { keys, lines };
}
// A need is met by what's allowed: its power (and, `byLine`, every line that uses it)
function isAllowed(need, ok, byLine) {
  if (!ok.keys.has(need.key)) return false;
  if (!byLine || !need.lines || !need.lines.length) return true;
  const seen = ok.lines.get(need.key);
  return !!seen && need.lines.every((h) => seen.has(h));
}
// For the panel: say what's new about a power that was allowed before (a line using it changed)
function described(need, ok) {
  return ok.keys.has(need.key) ? { ...need, fact: `${need.fact}: a line that does this is new or changed` } : need;
}
/** Kept for callers that only want the keys. */
function allowedKeys(home, mod, allowed) { return allowedFor(home, mod, allowed).keys; }

/** Allow what was found for a mod (the user's Allow or "Looks right"): its powers, and their lines. */
function allowPowers(home, id, needs) {
  const all = loadAllowed(home);
  const a = all[id] || {};
  const had = new Set(Array.isArray(a.powers) ? a.powers : []);
  const lines = a.lines && typeof a.lines === 'object' ? { ...a.lines } : {};
  for (const n of needs) {
    const key = typeof n === 'string' ? n : n.key;
    had.add(key);
    if (typeof n !== 'string' && n.lines && n.lines.length) lines[key] = [...new Set([...(lines[key] || []), ...n.lines])];
  }
  all[id] = { powers: [...had].sort(), ...(Object.keys(lines).length ? { lines } : {}), at: Date.now() };
  saveJson(allowedFile(home), all);
}

/**
 * Update the held set for the current mods. `scopes` are the runs to check ({runId, site, scope,
 * before, locked}: `before` is the runs.js modSnapshot taken when the run started, `locked` the mods
 * folders it couldn't write). A mod those runs changed that can do something not allowed for it gets
 * held. A change in a folder the run couldn't write (another site's, which its sandbox makes read-only)
 * isn't the run's: another run, the user or another browser made it meanwhile, so it isn't held on this
 * run's account. A held mod that changes is worked out again while its run is going, else released (the
 * user or another run rewrote it); one that's gone is dropped.
 * Returns the mods held now (mod id -> entry).
 */
function updateHeld(ws, mods, scopes) {
  const held = loadHeld(ws.home);
  let changed = false;
  // (holds approved before allowed.json: their powers become allowed, for that mod)
  for (const [id, h] of Object.entries(held)) {
    if (!h.approved) continue;
    const m = mods.find((x) => x.id === id);
    if (m && m.hash === h.hash) allowPowers(ws.home, id, needsOf(m, h.scope));
    delete held[id];
    changed = true;
  }
  const allowed = loadAllowed(ws.home);
  const live = scopes.filter((s) => s.before);
  const entry = (m, s, needs) => ({
    hash: m.hash, site: s.site, scope: s.scope, runId: s.runId, at: Date.now(),
    reason: reasonOf(needs), facts: needs.map((n) => n.fact), needs: needs.map((n) => n.key),
    lines: Object.fromEntries(needs.filter((n) => n.lines && n.lines.length).map((n) => [n.key, n.lines])), claim: claimOf(m),
  });
  // a run's change: what it can do now, less what's allowed (by power and line)
  const runNeeds = (m, scope) => {
    const ok = allowedFor(ws.home, m, allowed);
    return needsOf(m, scope).filter((n) => !isAllowed(n, ok, true)).map((n) => described(n, ok));
  };
  for (const id of Object.keys(held)) {
    const m = mods.find((x) => x.id === id);
    if (!m) { delete held[id]; changed = true; continue; }
    if (m.hash === held[id].hash) continue;
    const run = live.find((s) => s.runId === held[id].runId);
    const needs = run ? runNeeds(m, held[id].scope) : [];
    if (needs.length) held[id] = entry(m, run, needs); else delete held[id];
    changed = true;
  }
  if (live.length) {
    const now = modSnapshot(ws.modsDir, ws.home);
    const ci = ignoresCase(ws.home); // (APFS: sites/X.com is sites/x.com)
    for (const s of live) {
      const touched = new Set(diffSnapshots(s.before, now));
      const locked = s.locked || [];
      for (const m of mods) {
        const rel = path.relative(ws.home, m.file);
        if (!touched.has(rel)) continue;
        if (locked.some((d) => within(rel, d, { ci, orEqual: true }))) continue;
        if (held[m.id] && held[m.id].hash === m.hash) continue;
        const needs = runNeeds(m, s.scope);
        if (!needs.length) continue;
        held[m.id] = entry(m, s, needs);
        changed = true;
      }
    }
  }
  if (changed) saveHeld(ws.home, held);
  return held;
}

/** Release a held mod: the user allowed what TRIF found in it. Throws if it isn't held. */
function approveHeld(home, id) {
  const held = loadHeld(home);
  if (!held[id] || held[id].approved) throw new Error(`${id} isn't held`);
  const lines = held[id].lines || {};
  allowPowers(home, id, (held[id].needs || []).map((key) => ({ key, lines: lines[key] || [] })));
  delete held[id];
  saveHeld(home, held);
}

/**
 * Mods to review: ones the user has (not held) that can do something not allowed for them yet.
 * id -> {facts, needs, claim}. (An @match outside the site isn't a review item: outside a run, matches
 * are the user's; nor a self-declared risk 2, which the panel's badge shows.)
 */
function reviewItems(home, mods, held = {}) {
  const allowed = loadAllowed(home);
  const out = {};
  for (const m of mods) {
    if (held[m.id]) continue;
    const ok = allowedFor(home, m, allowed);
    const needs = needsOf(m, null).filter((n) => !isAllowed(n, ok, false) && n.key !== 'risk2');
    if (needs.length) out[m.id] = { facts: needs.map((n) => n.fact), needs: needs.map((n) => n.key), claim: claimOf(m) };
  }
  return out;
}

/** "Looks right": the user has seen what the mod can do; those powers are allowed for it. */
function reviewMod(home, mod) {
  const needs = needsOf(mod, null).filter((n) => n.key !== 'risk2');
  allowPowers(home, mod.id, needs);
  return needs.map((n) => n.key);
}

module.exports = {
  loadHeld, saveHeld, updateHeld, approveHeld, heldFile, allowedFile, holdReason,
  needsOf, reviewItems, reviewMod, allowPowers, loadAllowed, powersFor, allowedKeys,
};
