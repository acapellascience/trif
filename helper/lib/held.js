'use strict';
// Held mods: mods a side-panel agent run wrote that match pages outside the run's scope (see
// scope.js), or that say they're risk tier 2 (they change what the site receives). $WEBMODS_HOME/held.json maps mod id -> {hash, site, scope, runId, reason, at, approved?}. A
// mod stays held while its hash is unchanged and it isn't approved; approving keeps the entry (marked
// approved) so the same version isn't held again, and any change to the file drops the entry.
// (Agents can't edit this file: side-panel runs may only write under sites/.)

const fs = require('fs');
const path = require('path');
const { snapshot, diffSnapshots } = require('./runs');
const { outOfScope } = require('./scope');

// Why a mod a run changed must wait for the user: it reaches other sites, or its header says it changes
// what the site receives (risk tier 2, see AGENTS.md "Account safety"). '' when it needn't.
function holdReason(mod, scope) {
  const outside = outOfScope(mod, scope);
  if (outside.length) return `it matches ${outside.join(', ')}, outside ${scope}`;
  if (mod.risk && mod.risk.tier >= 2) return `it changes what the site receives (risk ${mod.risk.tier}${mod.risk.why ? `: ${mod.risk.why}` : ''})`;
  return '';
}

function heldFile(home) { return path.join(home, 'held.json'); }

function loadHeld(home) {
  try {
    const v = JSON.parse(fs.readFileSync(heldFile(home), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function saveHeld(home, held) {
  const file = heldFile(home);
  if (!Object.keys(held).length) { try { fs.unlinkSync(file); } catch { /* none */ } return; }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(held, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * Update the held set for the current mods. `scopes` are the runs to check ({runId, site, scope,
 * before}: `before` is the runs.js snapshot taken when the run started). Mods those runs changed that
 * reach outside their scope get held; entries whose mod changed or vanished are dropped.
 * Returns the mods held now (mod id -> entry, approved ones left out).
 */
function updateHeld(ws, mods, scopes) {
  const held = loadHeld(ws.home);
  let changed = false;
  const live = scopes.filter((s) => s.before);
  if (live.length) {
    const now = snapshot(ws.modsDir, ws.home);
    for (const s of live) {
      const touched = new Set(diffSnapshots(s.before, now));
      for (const m of mods) {
        if (!touched.has(path.relative(ws.home, m.file))) continue;
        const reason = holdReason(m, s.scope);
        if (!reason || (held[m.id] && held[m.id].hash === m.hash)) continue;
        held[m.id] = { hash: m.hash, site: s.site, scope: s.scope, runId: s.runId, at: Date.now(), reason };
        changed = true;
      }
    }
  }
  for (const id of Object.keys(held)) {
    const m = mods.find((x) => x.id === id);
    if (!m || m.hash !== held[id].hash) { delete held[id]; changed = true; }
  }
  if (changed) saveHeld(ws.home, held);
  return Object.fromEntries(Object.entries(held).filter(([, h]) => !h.approved));
}

/** Release a held mod (the user approved it). Throws if it isn't held. */
function approveHeld(home, id) {
  const held = loadHeld(home);
  if (!held[id] || held[id].approved) throw new Error(`${id} isn't held`);
  held[id].approved = true;
  saveHeld(home, held);
}

module.exports = { loadHeld, saveHeld, updateHeld, approveHeld, heldFile, holdReason };
