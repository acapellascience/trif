'use strict';
// Cross-mod approval (docs/SAFE-MODS.md "Combinations", "Across mods: the page-wide rules"). Boxed mods on a
// page see each other's elements (and with `mods`, talk), so the sandbox refuses an act while another boxed mod
// there has a power that makes a warned combination with it (extension/sandbox.js ACT_PARTNERS). Instead of a
// mod asking for powers it never uses to be let act (padding, which puts warnings on its hold for things it
// can't do), the user can approve the combination across the two mods:
//
// - Two boxed mods are peers when they share a site and both are on in a browser (switches.json, below). The
//   combinations across them are the warned ones (helper/lib/combinations.js) among their powers together that
//   neither has alone (@migrate counting as site-storage, as everywhere).
// - Each is a need keyed by the other mod and the powers, `power:with:<other id>:<a>+<b>[+<c>]`: a later version
//   of either that adds a power asks again only for the combinations that power makes; switching either off
//   needs nothing (the approval stays, for when it's on again).
// - A new or changed mod's hold carries them (held.js updateHeld); the other mod isn't asked again. Approved on
//   either side, a combination is approved for both (allowed.json, under the mod whose hold carried it). Two
//   mods the user already has (one switched on, say, or both from before this): the review asks, on the newer
//   of the two only.
// - The helper sends each boxed mod the approved combinations it's in (`crossOk`: "<a>+<b> <other id>"), and the
//   sandbox lets an act through beside another mod's power only when that pair, with that mod, is approved.

const fs = require('fs');
const path = require('path');
const combos = require('./combinations');
const { modSites } = require('./powers');

/** A boxed mod's powers as the combinations count them (@migrate reads the site's storage: site-storage). */
function comboOf(mod) {
  if (!mod || !mod.sandboxed) return [];
  const list = Array.isArray(mod.powers) ? mod.powers : [];
  const migrate = !!(mod.powerArgs && Array.isArray(mod.powerArgs.migrate) && mod.powerArgs.migrate.length);
  return combos.POWERS.filter((p) => list.includes(p) || (migrate && p === 'site-storage'));
}

// (whether two mods can be on one site: a site they both name, one under the other, or one runs everywhere)
const everywhere = (m) => String(m.id || '').split('/')[0] === 'all-sites' && !(m.matches || []).some((p) => /^[^:]+:\/\/[^*/]/.test(String(p)))
  || (m.matches || []).some((p) => /^[^:]+:\/\/\*\//.test(String(p)) || String(p) === '<all_urls>');
function sharesSite(a, b) {
  if (everywhere(a) || everywhere(b)) return true;
  const sa = modSites(a), sb = modSites(b);
  return sa.some((x) => sb.some((y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)));
}

/** The warned combinations across two mods' powers: of theirs together, those neither has alone. */
function crossWarnings(a, b) {
  const both = combos.POWERS.filter((p) => a.includes(p) || b.includes(p));
  return combos.warningsFor(both).filter((w) => { const ps = w.combo.split('+'); return !ps.every((p) => a.includes(p)) && !ps.every((p) => b.includes(p)); });
}

const keyFor = (other, combo) => `power:with:${other}:${combo}`;
/** {with, combo} from a cross need's key, or null. */
function parseKey(key) {
  const m = /^power:with:(.+):([a-z+-]+)$/.exec(String(key));
  return m ? { with: m[1], combo: m[2] } : null;
}
const keysOf = (allowed, id) => new Set(allowed && allowed[id] && Array.isArray(allowed[id].powers) ? allowed[id].powers : []);
/** Whether the combination across mods a and b was approved (on either side). */
function approved(allowed, a, b, combo) { return keysOf(allowed, a).has(keyFor(b, combo)) || keysOf(allowed, b).has(keyFor(a, combo)); }

// ---- which boxed mods are on: each browser's helper writes what's off there (modsApplied), in
// $TRIF_HOME/switches.json: {"<browser>": {at, known: [ids], off: [ids]}}. A mod is off when every browser that
// knows it has it off (switched off, its group or TRIF off on its site, paused); one no browser knows is on.
const SWITCHES_DAYS = 14;
const switchesFile = (home) => path.join(home, 'switches.json');
function loadSwitches(home) {
  try { const v = JSON.parse(fs.readFileSync(switchesFile(home), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
/** Records what's off in one browser (by its key); true when that changed what TRIF knows. */
function saveSwitches(home, browser, known, off) {
  const all = loadSwitches(home);
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (!v || now - Number(v.at) > SWITCHES_DAYS * 86400000) delete all[k];
  const entry = { known: [...new Set(known)].sort(), off: [...new Set(off)].sort() };
  const was = all[browser];
  const same = was && JSON.stringify(was.known) === JSON.stringify(entry.known) && JSON.stringify(was.off) === JSON.stringify(entry.off);
  all[browser] = { at: now, ...entry };
  try {
    const tmp = `${switchesFile(home)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
    fs.renameSync(tmp, switchesFile(home));
  } catch { return false; }
  return !same;
}
/** (id) => whether that mod is off in every browser that knows it. */
function offFn(home) {
  const all = Object.values(loadSwitches(home)).filter((v) => v && Array.isArray(v.known) && Array.isArray(v.off));
  return (id) => {
    const knows = all.filter((v) => v.known.includes(id));
    return knows.length > 0 && knows.every((v) => v.off.includes(id));
  };
}

/** The boxed mods a mod's combinations are counted with: others on a site of its, on, with powers. */
function peersOf(mod, mods, isOff = () => false) {
  if (!comboOf(mod).length) return [];
  return mods.filter((o) => o.id !== mod.id && o.sandboxed && !o.rules && comboOf(o).length && !isOff(o.id) && sharesSite(mod, o));
}

/**
 * A mod's combinations with its peers: [{key, fact, power: 'with', with, withName, combo, rank, soft, lines}],
 * the strongest first, by peer. `approvedToo`: those already approved as well (for "Looks right", which allows
 * them all again, harmlessly).
 */
function crossNeeds(mod, mods, { allowed = {}, isOff = () => false, approvedToo = false } = {}) {
  const mine = comboOf(mod);
  const out = [];
  for (const o of peersOf(mod, mods, isOff)) {
    for (const w of crossWarnings(mine, comboOf(o))) {
      if (!approvedToo && approved(allowed, mod.id, o.id, w.combo)) continue;
      out.push({ key: keyFor(o.id, w.combo), fact: w.fact, power: 'with', with: o.id, withName: o.name || o.id, combo: w.combo, rank: w.rank, soft: false, lines: [] });
    }
  }
  return out;
}

/** For the sandbox: the approved combinations a mod is in, with mods there now: ["<a>+<b> <other id>", …]. */
function approvedWith(mod, mods, allowed = {}) {
  if (!comboOf(mod).length) return [];
  const ids = new Set(mods.filter((o) => o.id !== mod.id && o.sandboxed).map((o) => o.id));
  const out = new Set();
  for (const k of keysOf(allowed, mod.id)) { const p = parseKey(k); if (p && ids.has(p.with)) out.add(`${p.combo} ${p.with}`); }
  for (const id of ids) for (const k of keysOf(allowed, id)) { const p = parseKey(k); if (p && p.with === mod.id) out.add(`${p.combo} ${id}`); }
  return [...out].sort();
}

/** {id: name} for the peers a list of needs names (a hold's words: "together with <name>, it …"). */
function namesFor(needs) {
  const out = {};
  for (const n of needs || []) if (n && n.power === 'with') out[n.with] = n.withName;
  return out;
}

module.exports = { comboOf, sharesSite, crossWarnings, keyFor, parseKey, approved, peersOf, crossNeeds, approvedWith, namesFor, loadSwitches, saveSwitches, offFn, switchesFile };
