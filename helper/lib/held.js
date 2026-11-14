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
//   update TRIF brings, has nothing to ask about; an edit that reuses its lines doesn't ask either. One that
//   adds a power or a line using one, a site its URLs name, or a @match for a site the shipped version
//   doesn't run on while the mod can do something, waits: shippedSiteNeeds.)
// - A change to a mod's style section alone (lib/stylesection.js: CSS, hidden selectors, typed settings'
//   values, which TRIF applies itself; the code never gets the section's text) runs straight away: the
//   code is the version that last ran (codeOf). Only a run's change for another site waits, as a style
//   mod's would. A change to both is judged on its code; meanwhile the running version gets the new style
//   (host.js, stylesection.js restyle).
//
// Files (the helper's, outside sites/: side-panel runs can't write them):
//   $TRIF_HOME/held.json     mod id -> {hash, site, scope, runId, at, reason, facts, needs, claim}
//   $TRIF_HOME/allowed.json  mod id -> {powers: [key], lines: {key: [sha1 of a line]}, at}   (keys as
//                            powers.js gives them, plus `match:<pattern>` and `risk2`)
//   $TRIF_HOME/seen.json     mod id -> {hash, code?, lines: {key: [line hash]}}: the version TRIF last let run
//                            (`code`: its codeHash, for a mod with a style section), and its lines that use a
//                            power (a change is judged on what it adds to those)
//   $TRIF_HOME/.ran/<site>/<mod>.js  that version's text: while a change to the mod waits, it's what runs
//                            (lastRun), and "Don't allow" puts it back
// A held entry lasts while that version of the mod is there; an edit makes it be worked out again.
// (Before 0.3.0 an approved hold stayed in held.json marked `approved`: it becomes allowed powers.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modSnapshot, diffSnapshots } = require('./runs');
const { outOfScope } = require('./scope');
const { within, ignoresCase } = require('./pathcheck');
const { powersOf, modSites } = require('./powers');
const { isSoft } = require('./boxpowers');
const sites = require('./sitecombos');

// powersOf reads every mod's code on each sync; a big mod takes a few hundred ms, so by hash.
const cache = new Map();
function powersFor(mod) {
  if (mod.rules) return []; // (a rules mod runs TRIF's own code, its rules only data: lib/rules.js)
  // (a sandboxed mod's code runs where it can't act: TRIF's world, with only TRIF's API (extension/sandbox.js).
  // A browser without that world holds it there, in the extension, until the user allows it as a page script.)
  // A boxed mod with powers (lib/boxpowers.js): what it asks for, which TRIF enforces; by name only, so an
  // update with the same powers doesn't ask again.
  if (mod.sandboxed) return require('./boxpowers').powerNeeds(mod);
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

// On a site whose "Agent on this site" is Off (the sensitive ones start there), a run may only make style and
// boxed mods: its agent can't see the page, and those can't send anything the user didn't allow. A free mod it
// writes there waits, with this as the reason (the agent sees it in `trif status`; AGENTS.md tells it to say
// so and stop). Only the user can let it run (Allow), change the level, or add the mod themselves.
const OFF_FREE = 'agent-off-free';
const offFreeFact = (site) => `is a free mod, and "Agent on this site" is Off for ${site || 'this site'}: there your agent may only make style mods and boxed mods`;

// A pattern that matches every site (<all_urls>, *://*/*, https://*/*).
const everywhere = (pattern) => pattern === '<all_urls>' || /^(\*|https?):\/\/\*(\/|$)/.test(String(pattern));
// A free mod that runs on every site, changed by a side-panel run: allowed for the version the user saw, not
// for good. A run works for one site; a free mod has everything each page has, and TRIF's reading of its code
// is a checkpoint, not a wall (docs/SECURITY.md), so "runs everywhere" allowed once would let any later run,
// on any site, change what runs on all of them without a word. Style and boxed mods don't ask again: they
// can't act, wherever they run. (As a "line" of the match: allowed.json keeps it with the key, isAllowed
// compares it.)
// (the code's version: a change to the mod's style section alone isn't a new one, lib/stylesection.js)
const versionLine = (mod) => `version:${String(codeOf(mod) || '').slice(0, 24)}`;
// The version of a mod's code: the file's hash, or for a mod with a style section the hash of the file without
// it (mods.js codeHash). A change that keeps it changed only the section: TRIF applies that itself, and the code
// gets only its typed values, so it runs without asking (updateHeld).
const codeOf = (mod) => (mod && (mod.codeHash || mod.hash)) || null;

function needsOf(mod, scope = null, agentLevel = null) {
  const out = powersFor(mod).map((p) => ({ key: p.key, fact: p.fact, lines: hashLines(mod.code, p.lines || []) }));
  if (agentLevel === 'off' && !mod.rules && !mod.sandboxed) out.unshift({ key: OFF_FREE, fact: offFreeFact(scope) });
  if (scope) {
    const free = !mod.rules && !mod.sandboxed;
    for (const pattern of outOfScope(mod, scope)) {
      out.push({ key: `match:${pattern}`, fact: `runs on ${pattern}, outside ${scope}`, ...(free && everywhere(pattern) ? { lines: [versionLine(mod)], version: true } : {}) });
    }
  }
  if (mod.risk && mod.risk.tier >= 2) out.push({ key: 'risk2', fact: 'says it changes what the site receives (risk 2)' });
  return out;
}

// The version TRIF shipped of a mod (its base in <home>/.shipped/, as a mod), or null when the mod isn't one
// TRIF shipped. A base only the mods feed brought (between releases) isn't a release's: the mod is judged
// against the version this TRIF's release shipped, so a feed version that can do more waits (modsfeed.js).
function shippedVersion(home, mod) {
  if (!home || !mod || !mod.source || !['webmods', 'trif'].includes(mod.source)) return null;
  const [site, ...rest] = String(mod.id).split('/');
  const file = path.join(home, '.shipped', site, `${rest.join('/')}.js`);
  let code;
  try { code = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { code = require('./modsfeed').releasedBaseline(home, mod.id, code); } catch { return null; }
  if (code === null) return null;
  try { return require('./mods').buildMod({ site, file, code }).mod; } catch { return null; }
}

// What a shipped mod's own version can do, so the user's edit of it is judged on what it adds: its powers and
// their lines, read with its own sites (an edit that adds a site doesn't widen what counts as the shipped
// version's own). null when the mod isn't one TRIF shipped.
function shippedBaseline(home, mod, shipped = shippedVersion(home, mod)) {
  if (!shipped) return null;
  return powersFor(shipped).map((p) => ({ key: p.key, lines: hashLines(shipped.code, p.lines || []) }));
}

// Where a pattern runs: its host without www., and whether it takes the host's subdomains too (*.x.com).
function patternHost(pattern) {
  const m = /^[^:]+:\/\/([^/]+)/.exec(String(pattern));
  if (!m || m[1] === '*') return null;
  const wild = m[1].startsWith('*.');
  return { host: m[1].replace(/^\*\./, '').replace(/^www\./, '').toLowerCase(), wild };
}
// The sites an edit of a shipped mod runs on that its shipped version never did (@match patterns for other
// hosts, or for every site), as needs: while it can do something, that's a change in what it does there
// (Tim's mod that may send on x.com, now on your bank's site). An edit within the shipped hosts (another
// path, www. or not) asks nothing.
function shippedSiteNeeds(mod, shipped) {
  if (!shipped || !powersFor(mod).some((p) => !isSoft(p.key))) return [];
  const base = (shipped.matches || []).map((p) => (everywhere(p) ? 'all' : patternHost(p)));
  if (base.includes('all')) return [];
  const covered = (pattern) => {
    const h = !everywhere(pattern) && patternHost(pattern);
    return !!h && base.some((b) => b && (b.wild ? h.host === b.host || h.host.endsWith(`.${b.host}`) : !h.wild && h.host === b.host));
  };
  return (mod.matches || []).filter((p) => !covered(p)).map((p) => ({ key: `match:${p}`, fact: `runs on ${p}, where Tim's version of this mod doesn't` }));
}

// The text a hold or review shows: TRIF's own words, one fact per line.
function reasonOf(needs) {
  return needs.map((n) => n.fact).filter(Boolean).join('; ');
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
function ranFile(home, id) { const [site, ...rest] = String(id).split('/'); return path.join(home, '.ran', site, `${rest.join('/')}.js`); }
function saveRan(home, m) {
  try {
    const f = ranFile(home, m.id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, m.text ?? m.code); // (a rules mod's own text, not the code TRIF makes of it)
    fs.renameSync(tmp, f);
  } catch { /* the waiting version just won't have the old one running beside it */ }
}
/** The text of the version of a mod TRIF last let run (seen.json's), or null. */
function lastRun(home, id) {
  const seen = loadSeen(home) || {};
  const want = typeof seen[id] === 'string' ? seen[id] : seen[id] && seen[id].hash;
  if (!want) return null;
  let code;
  try { code = fs.readFileSync(ranFile(home, id), 'utf8'); } catch { return null; }
  return code;
}
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
function allowedFor(home, mod, allowed = loadAllowed(home), seenVersion = null, shipped = shippedVersion(home, mod)) {
  const a = allowed[mod.id] || {};
  const keys = new Set(Array.isArray(a.powers) ? a.powers : []);
  const lines = new Map(Object.entries(a.lines && typeof a.lines === 'object' ? a.lines : {}).map(([k, v]) => [k, new Set(Array.isArray(v) ? v : [])]));
  // (and what the version TRIF last let run already did: a change is judged on what it adds)
  const before = [...(shippedBaseline(home, mod, shipped) || []),
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
  if (!ok.keys.has(need.key)) return need;
  // (a free mod for every site that a run changed: needsOf's versionLine)
  if (need.version) return { ...need, fact: `${need.fact}: your agent changed it since you allowed that` };
  return { ...need, fact: `${need.fact}: a line that does this is new or changed` };
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
 * `scopes` are the side-panel runs to check ({runId, site, scope, written} for a run with a working folder of
 * its own, stage.js: `written`, what the helper copied into the mods folder for it; or {before, locked}:
 * `before` the runs.js modSnapshot taken when the run started, `locked` the mods folders it couldn't write): a mod a live run
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
    if (m && m.hash === h.hash) allowPowers(ws.home, id, needsOf(m, h.scope, h.agentLevel || null));
    delete held[id];
    changed = true;
  }
  const allowed = loadAllowed(ws.home);
  const isOff = sites.offFn(ws.home); // (the boxed mods switched off in every browser: not in their sites' union)
  const splits = sites.splitsOf(ws.home); // (the sensitive sites of their own: each its own site's union)
  // (mods switched on since: worked out as if changed, so one that adds combinations its site hasn't approved
  // waits; off again, or nothing to ask, and they're done)
  const switched = sites.loadSwitched(ws.home);
  let switchedChanged = false;
  const doneSwitching = (id) => { if (switched[id]) { delete switched[id]; switchedChanged = true; } };
  let seen = loadSeen(ws.home);
  let seenChanged = false;
  // (the lines of every version that ran, kept together: an undo back to one of them isn't new)
  const record = (m) => {
    const was = seen && typeof seen[m.id] === 'object' && seen[m.id] && seen[m.id].lines ? seen[m.id].lines : {};
    const lines = { ...was };
    for (const n of needsOf(m, null)) if (n.lines && n.lines.length) lines[n.key] = [...new Set([...(lines[n.key] || []), ...n.lines])].slice(-2000);
    return { hash: m.hash, ...(m.codeHash ? { code: m.codeHash } : {}), lines };
  };
  const seenHash = (v) => (typeof v === 'string' ? v : v && v.hash);
  // (the code's version TRIF last let run, for a mod with a style section)
  const seenCode = (v) => (v && typeof v === 'object' && typeof v.code === 'string' ? v.code : null);
  // Which live run changed each mod, if one did (and could: not a folder it was locked out of)
  const byRun = new Map();
  const live = scopes.filter((s) => s.before || s.written);
  if (live.length) {
    const now = modSnapshot(ws.modsDir, ws.home);
    const ci = ignoresCase(ws.home); // (APFS: sites/X.com is sites/x.com)
    for (const s of live) {
      // (a run with a working folder of its own (stage.js): the mods the helper copied in for it, as long as
      // they're as it left them; else what changed since it started)
      const touched = s.written ? new Set([...s.written].filter(([rel, h]) => now.get(rel) === h).map(([rel]) => rel)) : new Set(diffSnapshots(s.before, now));
      // (a folder the run couldn't write: only while it's still a plain folder, never a link, whose files
      // are wherever it leads now)
      const locked = s.written ? [] : (s.locked || []).filter((d) => { try { return fs.lstatSync(path.join(ws.home, d)).isDirectory(); } catch { return false; } });
      for (const m of mods) {
        const rel = path.relative(ws.home, m.file);
        if (touched.has(rel) && !locked.some((d) => within(rel, d, { ci, orEqual: true }))) byRun.set(m.id, s);
      }
    }
  }
  if (seen === null) { // the first time: what's there is the user's, as it is
    // (but not a mod a live run just wrote: that one is judged like any change)
    seen = Object.fromEntries(mods.filter((m) => !byRun.has(m.id)).map((m) => [m.id, record(m)]));
    for (const m of mods) if (!byRun.has(m.id)) saveRan(ws.home, m);
    seenChanged = true;
  }
  for (const m of mods) {
    const same = held[m.id] && held[m.id].hash === m.hash; // (held as it is: waiting for the user, unless it's allowed now)
    const run = byRun.get(m.id) || (held[m.id] && live.find((s) => s.runId === held[m.id].runId)) || (same && held[m.id].scope ? { site: held[m.id].site, scope: held[m.id].scope, runId: held[m.id].runId, agentLevel: held[m.id].agentLevel || null } : null);
    if (switched[m.id] && isOff(m.id)) { doneSwitching(m.id); if (held[m.id] && held[m.id].by === 'switch') { delete held[m.id]; changed = true; } }
    const forced = !!switched[m.id];
    if (!run && !forced && seenHash(seen[m.id]) === m.hash) {
      if (typeof seen[m.id] === 'string') { seen[m.id] = record(m); seenChanged = true; saveRan(ws.home, m); } // (recorded before lines were)
      else if (!fs.existsSync(ranFile(ws.home, m.id))) saveRan(ws.home, m);
      if (held[m.id]) { delete held[m.id]; changed = true; }
      continue;
    }
    // Only its style section changed since the version TRIF last let run (lib/stylesection.js): the code is
    // that version's, so nothing it can do is new. It's judged as a style mod is: a run's change still waits
    // for running outside the run's site, unless that's allowed.
    const styleOnly = !forced && !!m.codeHash && seenCode(seen[m.id]) === m.codeHash;
    const shipped = shippedVersion(ws.home, m);
    const ok = allowedFor(ws.home, m, allowed, typeof seen[m.id] === 'object' ? seen[m.id] : null, shipped);
    let needs;
    if (styleOnly) {
      needs = needsOf(m, run ? run.scope : null, null).filter((n) => n.key.startsWith('match:')).map((n) => ({ key: n.key, fact: n.fact }))
        .filter((n) => !isAllowed(n, ok, true));
    } else {
      needs = needsOf(m, run ? run.scope : null, run ? run.agentLevel : null)
        .filter((n) => (run || n.key !== 'risk2') && !isAllowed(n, ok, true))
        .map((n) => described(n, ok));
      // (one of Tim's mods, changed to run on a site its shipped version doesn't, while it can do something)
      for (const n of shippedSiteNeeds(m, shipped)) if (!needs.some((x) => x.key === n.key) && !isAllowed(n, ok, true)) needs.push(n);
      // (and, where its powers add a holding power to what its site's boxed mods together are approved for, the
      // site's new union: sitecombos.js; approving it approves that for the site)
      needs = needs.concat(sites.siteNeeds(m, mods, { allowed, isOff, splits }));
    }
    // (a boxed mod's `controls` and `mods` are listed on a hold, but don't make one on their own)
    if (needs.length && needs.every((n) => isSoft(n.key))) needs = [];
    // (held as it is, for the same needs: as it was; a combination the site approved since, or another mod
    // switched on or off, changes what it waits for)
    if (needs.length && same && JSON.stringify(held[m.id].needs || []) === JSON.stringify(needs.map((n) => n.key))) continue;
    if (needs.length) {
      // (by 'switch': the very version that ran, switched on, adding what its site hasn't approved)
      const by = run ? 'agent' : forced && seenHash(seen[m.id]) === m.hash ? 'switch' : 'outside';
      held[m.id] = {
        hash: m.hash, ...(m.codeHash ? { codeHash: m.codeHash } : {}), site: run ? run.site : m.site, scope: run ? run.scope : null, runId: run ? run.runId : null, by, at: same ? held[m.id].at : Date.now(),
        ...(run && run.agentLevel === 'off' ? { agentLevel: 'off' } : {}),
        reason: reasonOf(needs), facts: needs.map((n) => n.fact), needs: needs.map((n) => n.key),
        lines: Object.fromEntries(needs.filter((n) => n.lines && n.lines.length).map((n) => [n.key, n.lines])), claim: claimOf(m),
        ...reachOf(needs),
      };
      changed = true;
    } else {
      doneSwitching(m.id);
      if (held[m.id]) { delete held[m.id]; changed = true; }
      if (seenHash(seen[m.id]) !== m.hash) { seen[m.id] = record(m); seenChanged = true; saveRan(ws.home, m); }
    }
  }
  const ids = new Set(mods.map((m) => m.id));
  for (const id of Object.keys(held)) if (!ids.has(id)) { delete held[id]; changed = true; }
  for (const id of Object.keys(seen)) if (!ids.has(id)) { delete seen[id]; seenChanged = true; try { fs.unlinkSync(ranFile(ws.home, id)); } catch { /* none */ } }
  for (const id of Object.keys(switched)) if (!ids.has(id)) doneSwitching(id);
  if (changed) saveHeld(ws.home, held);
  if (seenChanged) saveJson(seenFile(ws.home), seen);
  if (switchedChanged) { try { sites.saveSwitchedOn(ws.home, switched); } catch { /* next time */ } }
  return held;
}

// (the site's lists, for the panel and trif status: sitecombos.js reach)
function reachOf(needs) {
  const r = needs.filter((n) => n.reach).map((n) => n.reach);
  return r.length ? { reach: r } : {};
}

/**
 * Release a held mod: the user allowed what TRIF found in it. Throws if it isn't held, or (`hash`) if the
 * waiting version isn't the one the user looked at any more.
 */
function approveHeld(home, id, hash = null) {
  const held = loadHeld(home);
  if (!held[id] || held[id].approved) throw new Error(`${id} isn't held`);
  if (hash && held[id].hash !== hash) throw new Error(`${id} changed again since you looked at it: look at what's waiting now`);
  const lines = held[id].lines || {};
  allowPowers(home, id, (held[id].needs || []).map((key) => ({ key, lines: lines[key] || [] })));
  const seen = loadSeen(home) || {};
  seen[id] = { hash: held[id].hash, ...(held[id].codeHash ? { code: held[id].codeHash } : {}), lines: (seen[id] && typeof seen[id] === 'object' && seen[id].lines) || {} }; // (its lines are allowed now)
  saveJson(seenFile(home), seen);
  try { fs.unlinkSync(ranFile(home, id)); } catch { /* none */ } // (the next sync keeps the approved version's text)
  delete held[id];
  saveHeld(home, held);
}

/**
 * "Don't allow": the waiting version goes (kept in history/, so nothing is lost) and the version that last
 * ran is put back; a mod that never ran goes to the trash. Returns {id, restored: 'previous'|'removed'}.
 */
function rejectHeld(ws, id, hash = null) {
  const held = loadHeld(ws.home);
  if (!held[id]) throw new Error(`${id} isn't waiting for your OK`);
  if (hash && held[id].hash !== hash) throw new Error(`${id} changed again since you looked at it: look at what's waiting now`);
  const [site, ...rest] = String(id).split('/');
  const file = path.join(ws.modsDir, site, `${rest.join('/')}.js`);
  const before = lastRun(ws.home, id);
  const history = require('./history');
  let restored;
  if (before !== null) {
    try { history.writeEntry(ws, site, rest.join('/'), fs.readFileSync(file)); } catch { /* gone already */ }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, before);
    fs.renameSync(tmp, file);
    restored = 'previous';
  } else {
    require('./trash').deleteMod(ws, id);
    restored = 'removed';
  }
  delete held[id];
  saveHeld(ws.home, held);
  return { id, restored };
}

/**
 * Mods to review: ones the user has (not held) that can do something not allowed for them yet.
 * id -> {facts, needs, claim}. (An @match outside the site isn't a review item: outside a run, matches
 * are the user's; nor a self-declared risk 2, which the panel's badge shows.)
 */
function reviewItems(home, mods, held = {}) {
  const allowed = loadAllowed(home);
  const isOff = sites.offFn(home);
  const splits = sites.splitsOf(home);
  const mtime = new Map();
  const when = (m) => { if (!mtime.has(m.id)) { let t = 0; try { t = fs.statSync(m.file).mtimeMs; } catch { /* gone */ } mtime.set(m.id, t); } return mtime.get(m.id); };
  // (a site whose boxed mods' union has holding powers it hasn't approved, from before site approvals, and no
  // hold asks for it: the newest of its mods (not held) with one of them asks, once)
  const heldSites = new Set(Object.values(held).flatMap((h) => (h.needs || []).map((k) => (sites.parseKey(k) || {}).site).filter(Boolean)));
  const carried = new Map(); // mod id -> [site needs]
  const siteList = [...new Set(mods.filter((m) => m.sandboxed).flatMap((m) => sites.sitesOf(m, mods, splits)))];
  for (const site of siteList) {
    if (heldSites.has(site)) continue;
    const on = sites.siteMods(site, mods, isOff, null, splits).filter((m) => !held[m.id]);
    if (on.length < 2) continue;
    const before = sites.approvedUnion(allowed, site);
    const after = require('./combinations').POWERS.filter((p) => before.includes(p) || sites.unionOf(on).includes(p));
    const missing = sites.holding(after.filter((p) => !before.includes(p)), after);
    if (!missing.length) continue;
    const who = on.filter((m) => sites.comboOf(m).some((p) => missing.includes(p))).sort((a, b) => when(b) - when(a) || (b.id > a.id ? 1 : -1))[0];
    if (who) carried.set(who.id, [...(carried.get(who.id) || []), sites.siteNeed(site, before, after, sites.clickWordsOf(on))]);
  }
  const out = {};
  for (const m of mods) {
    if (held[m.id]) continue;
    const ok = allowedFor(home, m, allowed);
    const needs = needsOf(m, null).filter((n) => !isAllowed(n, ok, false) && n.key !== 'risk2').concat(carried.get(m.id) || []);
    if (needs.length && !needs.every((n) => isSoft(n.key))) out[m.id] = { facts: needs.map((n) => n.fact), needs: needs.map((n) => n.key), claim: claimOf(m), ...reachOf(needs) };
  }
  return out;
}

/**
 * "Looks right": the user has seen what the mod can do; those powers are allowed for it, and (`mods`: the mods
 * now) its sites' unions as they are now.
 */
function reviewMod(home, mod, mods = []) {
  const needs = needsOf(mod, null).filter((n) => n.key !== 'risk2')
    .concat(sites.siteNeeds(mod, mods, { allowed: loadAllowed(home), isOff: sites.offFn(home), approvedToo: true, splits: sites.splitsOf(home) }));
  allowPowers(home, mod.id, needs);
  return needs.map((n) => n.key);
}

/**
 * The holds to go by when updateHeld failed (a bug in TRIF, a state file it can't read): the ones there were,
 * and every mod that isn't the version TRIF last let run, held with that as the reason. Nothing new runs on
 * an error; what was running keeps running. In memory only: the next sync works it out again.
 */
function heldOnError(ws, mods, before, error) {
  const held = { ...(before || {}) };
  let seen = null;
  try { seen = loadSeen(ws.home); } catch { seen = null; }
  const hashOf = (v) => (typeof v === 'string' ? v : v && v.hash);
  const fact = 'couldn\'t be checked (something went wrong in TRIF), so it waits';
  for (const m of mods) {
    if (held[m.id] && held[m.id].hash === m.hash) continue;
    if (seen && hashOf(seen[m.id]) === m.hash) { delete held[m.id]; continue; }
    held[m.id] = { hash: m.hash, site: m.site, scope: null, runId: null, by: 'outside', at: Date.now(), reason: `${fact}: ${String(error && error.message ? error.message : error).slice(0, 200)}`, facts: [fact], needs: ['unchecked'], lines: {}, claim: claimOf(m) };
  }
  return held;
}

module.exports = {
  heldOnError, everywhere, codeOf, shippedVersion, shippedSiteNeeds,
  loadHeld, saveHeld, updateHeld, approveHeld, rejectHeld, lastRun, heldFile, allowedFile, seenFile, holdReason,
  needsOf, reviewItems, reviewMod, allowPowers, loadAllowed, powersFor, allowedKeys,
};
