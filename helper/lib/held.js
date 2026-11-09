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
//   A later edit runs straight away unless it adds a power or adds or changes a line that uses one (a
//   run on the site of a mod that may already send can't quietly rewrite what it sends); edits elsewhere
//   in it (its CSS, its selectors) don't ask again.
// - The same goes for a mod written any other way (the user's terminal agent, a file pasted or copied
//   in, a mod someone shared): new or changed, it waits while it can do something not allowed for it.
//   (A run's mod is also held for @match outside the run's site, or for saying risk 2.)
// - Mods the user had when this started keep running, but one that can do something not yet allowed is
//   marked for REVIEW: the panel shows the same facts once, with "Looks right" (allows them) and the
//   mod's switch. (Mods TRIF ships start from what their shipped version can do: an unchanged one, or an
//   update TRIF brings, has nothing to ask about.)
//
// Files (the helper's, outside sites/: side-panel runs can't write them):
//   $TRIF_HOME/held.json     mod id -> {hash, site, scope, runId, at, reason, facts, needs, claim}
//   $TRIF_HOME/allowed.json  mod id -> {powers: [key], lines: {key: [sha1 of a line]}, at}   (keys as
//                            powers.js gives them, plus `match:<pattern>` and `risk2`)
//   $TRIF_HOME/seen.json     mod id -> {hash, lines: {key: [line hash]}}: the version TRIF last let run, and
//                            its lines that use a power (a change is judged on what it adds to those)
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
function seenFile(home) { return path.join(home, 'seen.json'); }
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
// seen.json: mod id -> the hash of the version TRIF last let run; null before the first time
const loadSeen = (home) => (fs.existsSync(seenFile(home)) ? loadJson(seenFile(home)) : null);

// What's allowed for a mod: {keys: Set, lines: Map key -> Set of line hashes}, from allowed.json and, for
// a mod TRIF ships, its shipped version.
function allowedFor(home, mod, allowed = loadAllowed(home), seenVersion = null) {
  const a = allowed[mod.id] || {};
  const keys = new Set(Array.isArray(a.powers) ? a.powers : []);
  const lines = new Map(Object.entries(a.lines && typeof a.lines === 'object' ? a.lines : {}).map(([k, v]) => [k, new Set(Array.isArray(v) ? v : [])]));
  // (and what the version TRIF last let run already did: a change is judged on what it adds)
  const before = [...(shippedBaseline(home, mod) || []),
    ...Object.entries(seenVersion && seenVersion.lines && typeof seenVersion.lines === 'object' ? seenVersion.lines : {}).map(([key, l]) => ({ key, lines: Array.isArray(l) ? l : [] }))];
  for (const b of before) {
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
 * Update the held set for the current mods. Every mod that is new or changed since TRIF last let it run
 * (seen.json) is worked out: if it can do something not allowed for it (by power and by line), it's held,
 * whoever wrote it; otherwise it's let run, and recorded as seen. Mods there when this started (the first
 * time, seen.json missing) are recorded as seen as they are: they keep running, and the panel asks the
 * user to review what they can do (reviewItems).
 * `scopes` are the side-panel runs to check ({runId, site, scope, before, locked}: `before` is the runs.js
 * modSnapshot taken when the run started, `locked` the mods folders it couldn't write): a mod a live run
 * changed is also held for matching outside the run's site, or for saying risk 2, and the hold names the
 * run. A change in a folder the run couldn't write (another site's) isn't the run's: it's judged like any
 * other change.
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
  let seen = loadSeen(ws.home);
  let seenChanged = false;
  // (the lines of every version that ran, kept together: an undo back to one of them isn't new)
  const record = (m) => {
    const was = seen && typeof seen[m.id] === 'object' && seen[m.id] && seen[m.id].lines ? seen[m.id].lines : {};
    const lines = { ...was };
    for (const n of needsOf(m, null)) if (n.lines.length) lines[n.key] = [...new Set([...(lines[n.key] || []), ...n.lines])].slice(-2000);
    return { hash: m.hash, lines };
  };
  const seenHash = (v) => (typeof v === 'string' ? v : v && v.hash);
  // Which live run changed each mod, if one did (and could: not a folder it was locked out of)
  const byRun = new Map();
  const live = scopes.filter((s) => s.before);
  if (live.length) {
    const now = modSnapshot(ws.modsDir, ws.home);
    const ci = ignoresCase(ws.home); // (APFS: sites/X.com is sites/x.com)
    for (const s of live) {
      const touched = new Set(diffSnapshots(s.before, now));
      const locked = s.locked || [];
      for (const m of mods) {
        const rel = path.relative(ws.home, m.file);
        if (touched.has(rel) && !locked.some((d) => within(rel, d, { ci, orEqual: true }))) byRun.set(m.id, s);
      }
    }
  }
  if (seen === null) { // the first time: what's there is the user's, as it is
    // (but not a mod a live run just wrote: that one is judged like any change)
    seen = Object.fromEntries(mods.filter((m) => !byRun.has(m.id)).map((m) => [m.id, record(m)]));
    seenChanged = true;
  }
  for (const m of mods) {
    const same = held[m.id] && held[m.id].hash === m.hash; // (held as it is: waiting for the user, unless it's allowed now)
    const run = byRun.get(m.id) || (held[m.id] && live.find((s) => s.runId === held[m.id].runId)) || (same && held[m.id].scope ? { site: held[m.id].site, scope: held[m.id].scope, runId: held[m.id].runId } : null);
    if (!run && seenHash(seen[m.id]) === m.hash) {
      if (typeof seen[m.id] === 'string') { seen[m.id] = record(m); seenChanged = true; } // (recorded before lines were)
      if (held[m.id]) { delete held[m.id]; changed = true; }
      continue;
    }
    const ok = allowedFor(ws.home, m, allowed, typeof seen[m.id] === 'object' ? seen[m.id] : null);
    const needs = needsOf(m, run ? run.scope : null)
      .filter((n) => (run || n.key !== 'risk2') && !isAllowed(n, ok, true))
      .map((n) => described(n, ok));
    if (needs.length && same) continue;
    if (needs.length) {
      held[m.id] = {
        hash: m.hash, site: run ? run.site : m.site, scope: run ? run.scope : null, runId: run ? run.runId : null, by: run ? 'agent' : 'outside', at: Date.now(),
        reason: reasonOf(needs), facts: needs.map((n) => n.fact), needs: needs.map((n) => n.key),
        lines: Object.fromEntries(needs.filter((n) => n.lines && n.lines.length).map((n) => [n.key, n.lines])), claim: claimOf(m),
      };
      changed = true;
    } else {
      if (held[m.id]) { delete held[m.id]; changed = true; }
      if (seenHash(seen[m.id]) !== m.hash) { seen[m.id] = record(m); seenChanged = true; }
    }
  }
  const ids = new Set(mods.map((m) => m.id));
  for (const id of Object.keys(held)) if (!ids.has(id)) { delete held[id]; changed = true; }
  for (const id of Object.keys(seen)) if (!ids.has(id)) { delete seen[id]; seenChanged = true; }
  if (changed) saveHeld(ws.home, held);
  if (seenChanged) saveJson(seenFile(ws.home), seen);
  return held;
}

/** Release a held mod: the user allowed what TRIF found in it. Throws if it isn't held. */
function approveHeld(home, id) {
  const held = loadHeld(home);
  if (!held[id] || held[id].approved) throw new Error(`${id} isn't held`);
  const lines = held[id].lines || {};
  allowPowers(home, id, (held[id].needs || []).map((key) => ({ key, lines: lines[key] || [] })));
  const seen = loadSeen(home) || {};
  seen[id] = { hash: held[id].hash }; // (its lines are allowed now; the next sync records them)
  saveJson(seenFile(home), seen);
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
  loadHeld, saveHeld, updateHeld, approveHeld, heldFile, allowedFile, seenFile, holdReason,
  needsOf, reviewItems, reviewMod, allowPowers, loadAllowed, powersFor, allowedKeys,
};
