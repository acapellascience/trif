'use strict';
// Mods a new workspace starts with, copied from the examples by `trif setup`, each switched on or off
// as listed, and the sites TRIF starts on for; and keeping those mods up to date. $TRIF_HOME/
// preinstalled.json = {offered: [ids], startOff: [ids], sitesOn: [sites], shipped: {id: record}}:
//  - offered: ids already offered, so one the user deleted doesn't come back with the next setup (and an
//    existing file, the user's own version, is never overwritten);
//  - startOff: ids setup copied that start off. The helper sends those mods with `startOff: true`, and
//    the extension switches each one off the first time it sees it (after that, its switch is the user's);
//  - sitesOn: sites setup offered. The helper sends them with every mods message, and each browser turns
//    each one on the first time it sees it (after that, the site's switch is the user's);
//  - shipped: what TRIF shipped of each mod the user has, so later versions can reach them (below).
//
// Updates. A shipped mod (an example whose header says `@source webmods`) gets fixes in later TRIF
// versions, and every setup (which is also how updates install) brings them to the user's copy, but
// never over the user's own changes. shipped[id] = {hash, version, pending?, declined?, replaced?, own?}
// (or {retired}, below):
//  - hash, version: the sha1 and @version of the shipped version the user's copy is based on (hash null
//    for a copy edited before TRIF kept this record: which version it started from isn't known). That
//    exact version is kept in <home>/.shipped/<site>/<mod>.js, the base for merging;
//  - pending {hash, version}: a newer version the user's edited copy didn't get, kept in
//    <home>/.shipped/<site>/<mod>.new.js until the user picks what to do in the side panel (or with
//    `trif mod-update`): use it, keep theirs, or have their agent merge the two (it proposes first, and
//    edits once the user agrees);
//  - declined: the hash of a version the user chose not to use ("Keep mine"); a later one is offered again;
//  - replaced {hash, version, pending, trashed, retired?}: how things were before "Use the new version",
//    so `trif restore` (the panel's Undo) can put the user's copy back and offer the update again (and
//    bring back the retired mods that went to the trash because of it: retired [{id, rec}]);
//  - own: the user had their own file under that name before TRIF offered the mod: never touched.
// A copy that is still exactly what was shipped is replaced with the new version silently. Workspaces set
// up before the record existed have none: there, a copy matching any version TRIF ever shipped
// (examples/shipped-history.json, from git) counts as unchanged.
//
// Retired mods. A shipped mod can be folded into another one (RETIRED: AI Banisher took in Hide AI Mode
// and Gemini Promo, Just Results took in Hide Sponsored Results). It's no longer offered to anyone, and
// retireShippedMods deals with the copies users have: an unchanged one goes to the trash once the mod it
// was folded into has the version that does its job, an edited one is left alone (setup says so once).
// shipped[id] = {retired: {into, trashed?, kept?}} from then on: never updated or offered again.
//
// <home>/.shipped starts with a dot, so the mod scanner never loads it; side-panel runs can read it (the
// merge needs to) but not write it: they may only write the mods folder.

const fs = require('fs');
const path = require('path');
const { parseHeader, sha1, isShippedSource } = require('./mods');
const trash = require('./trash');
const { envVar } = require('./env');

// on: switched on from the start; the rest wait for the user to switch them on.
const PREINSTALLED = [
  { id: 'www.google.com/hide-ai-in-results', on: true }, // AI Banisher
  { id: 'www.google.com/hide-extra-sections', on: true }, // Just Results
  { id: 'x.com/plain-x', on: true },
  { id: 'x.com/punk-fonts', on: false },
  { id: 'x.com/rainbow-rave', on: false },
  { id: 'amazon.com/simple-home', on: true },
  { id: 'amazon.com/simple-shopping', on: true },
  { id: 'www.instagram.com/desaturate', on: false },
  { id: 'www.instagram.com/following-only-feed', on: true },
  { id: 'www.instagram.com/hide-ai-content', on: true },
  { id: 'www.instagram.com/hide-reposts', on: true },
  // Added in 0.2.0: existing workspaces get it (off) with the setup that installs the update, since it
  // isn't in their `offered` list yet.
  { id: 'www.google.com/dvd-logo', on: false },
  // Added in 0.2.0, the same way: Rainbow Rave (X has had one since 0.1) for Google, Amazon and
  // Instagram, all off.
  { id: 'www.google.com/rainbow-rave', on: false },
  { id: 'amazon.com/rainbow-rave', on: false },
  { id: 'www.instagram.com/rainbow-rave', on: false },
  // Added in 0.2.0, the same way: the mods on TRIF's own home page, all off (and TRIF stays off on
  // timsrobot.com, not in SITES_ON, until the user turns it on there).
  { id: 'timsrobot.com/tagline', on: false },
  { id: 'timsrobot.com/robot', on: false },
  { id: 'timsrobot.com/jelly', on: false },
  { id: 'timsrobot.com/gravity', on: false },
  { id: 'timsrobot.com/neon', on: false },
  { id: 'timsrobot.com/stickers', on: false },
  { id: 'timsrobot.com/shooter', on: false },
  { id: 'timsrobot.com/fireworks', on: false },
  { id: 'timsrobot.com/checklist', on: false },
  { id: 'timsrobot.com/terminal', on: false },
  { id: 'timsrobot.com/led', on: false },
  { id: 'timsrobot.com/rave', on: false },
  { id: 'timsrobot.com/tilt', on: false },
];

// The order the side panel lists a site's shipped mods in until the user drags them into their own (display
// only: mods run in their usual order). By site, as the extension's scopeFor gives it; the helper sends it
// with every mods message (`defaultOrder`), and extension/lib.js orderMods puts mods it doesn't list after.
const DEFAULT_ORDER = {
  'timsrobot.com': PREINSTALLED.filter((p) => p.id.startsWith('timsrobot.com/')).map((p) => p.id),
};

// Shipped mods folded into another one (`into`, from its @version `since`), so no longer shipped
// (0.2.0: AI Banisher and Just Results). retireShippedMods, below, handles the copies users have.
const RETIRED = [
  { id: 'www.google.com/hide-ai-mode', into: 'www.google.com/hide-ai-in-results', since: '2' },
  { id: 'www.google.com/hide-sponsored', into: 'www.google.com/hide-extra-sections', since: '2' },
];

// TRIF is off on every site until the user turns it on there; it starts on for these, the sites the
// mods above are for.
const SITES_ON = ['google.com', 'x.com', 'amazon.com', 'instagram.com'];

const SHIPPED_DIR = '.shipped';

function file(home) { return path.join(home, 'preinstalled.json'); }

function load(home) {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(file(home), 'utf8')); } catch { /* none yet */ }
  const list = (x) => (Array.isArray(x) ? x.filter((id) => typeof id === 'string') : []);
  const shipped = {};
  const s = v && v.shipped;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    for (const [id, r] of Object.entries(s)) if (r && typeof r === 'object' && !Array.isArray(r)) shipped[id] = r;
  }
  return { offered: list(v && v.offered), startOff: list(v && v.startOff), sitesOn: list(v && v.sitesOn), shipped };
}

// Written whole and renamed into place: setup and the helpers (another browser's too) all write it.
function save(home, state) {
  const out = { offered: state.offered, startOff: state.startOff, sitesOn: state.sitesOn };
  if (Object.keys(state.shipped || {}).length) out.shipped = state.shipped;
  const tmp = `${file(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, file(home));
}

// ---------------------------------------------------------------- files

const split = (id) => { const i = id.indexOf('/'); return [id.slice(0, i), id.slice(i + 1)]; };
const modFile = (modsDir, id) => { const [site, mod] = split(id); return path.join(modsDir, site, `${mod}.js`); };
/** What was shipped before: the version the user's copy is based on (the merge base). */
const baseFile = (home, id) => { const [site, mod] = split(id); return path.join(home, SHIPPED_DIR, site, `${mod}.js`); };
/** The new version waiting for the user's choice. */
const newFile = (home, id) => { const [site, mod] = split(id); return path.join(home, SHIPPED_DIR, site, `${mod}.new.js`); };
// The base before "Use the new version", while that can still be undone.
const prevFile = (home, id) => { const [site, mod] = split(id); return path.join(home, SHIPPED_DIR, site, `${mod}.prev.js`); };

function readOrNull(f) { try { return fs.readFileSync(f); } catch { return null; } }
function removeFile(f) { try { fs.unlinkSync(f); } catch { /* none */ } }

// Through a temp file whose name starts with a dot (the scanner skips it), so a helper never loads half
// a mod.
function writeAtomic(dest, content) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, dest);
}

function moveFile(from, to) {
  if (!fs.existsSync(from)) { removeFile(to); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

/** The shipped version of a mod: {code, hash, version}, or null when it isn't there or not marked @source webmods. */
function readShipped(examplesDir, id) {
  const code = readOrNull(modFile(examplesDir, id));
  if (!code) return null;
  const header = parseHeader(code.toString('utf8'));
  if (!isShippedSource(header.source)) return null;
  return { code, hash: sha1(code), version: header.version };
}

/** examples/shipped-history.json next to the examples: {id: [sha1 of every version ever shipped]}. */
function loadHistory(examplesDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(examplesDir, '..', 'shipped-history.json'), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const shippedBefore = (history, id, hash) => Array.isArray(history[id]) && history[id].includes(hash);

// ---------------------------------------------------------------- setup

/**
 * Copy the PREINSTALLED mods not offered before into modsDir, and offer SITES_ON. Returns
 * {added: [ids copied], on: [those switched on], sites: [sites newly offered]}.
 */
function preinstallMods(home, modsDir, examplesDir, list = PREINSTALLED, sitesOn = SITES_ON) {
  const state = load(home);
  const history = loadHistory(examplesDir);
  const added = [];
  const on = [];
  let changed = false;
  for (const { id, on: startOn } of list) {
    if (state.offered.includes(id)) continue;
    const src = modFile(examplesDir, id);
    if (!fs.existsSync(src)) continue;
    const dest = modFile(modsDir, id);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      added.push(id);
      if (startOn) on.push(id); else state.startOff.push(id);
    } else {
      // The user's own mod under the same name: not ours to update, unless it's a copy of one we shipped.
      const mine = sha1(fs.readFileSync(dest));
      if (mine !== sha1(fs.readFileSync(src)) && !shippedBefore(history, id, mine)) state.shipped[id] = { own: true };
    }
    state.offered.push(id);
    changed = true;
  }
  const sites = sitesOn.filter((s) => !state.sitesOn.includes(s));
  if (sites.length) { state.sitesOn.push(...sites); changed = true; }
  if (changed) save(home, state);
  return { added, on, sites };
}

/**
 * Bring the shipped mods the user has up to date (see the top of this file). Run by every setup, after
 * preinstallMods. Returns {updated: [{id, version, from}], waiting: [{id, version}]}: copies replaced with
 * the new version, and edited copies with a new version waiting for the user (this time or before).
 */
function updateShippedMods(home, modsDir, examplesDir, list = PREINSTALLED) {
  const state = load(home);
  const history = loadHistory(examplesDir);
  const updated = [];
  const waiting = [];
  let changed = false;
  for (const { id } of list) {
    if (!state.offered.includes(id)) continue;
    const shipped = readShipped(examplesDir, id);
    const rec = state.shipped[id] || null;
    if (!shipped || (rec && rec.own)) continue;
    const mine = readOrNull(modFile(modsDir, id));
    if (!mine) continue; // deleted: it stays gone
    const mineHash = sha1(mine);
    const current = { hash: shipped.hash, version: shipped.version };
    let next;
    if (mineHash === shipped.hash) {
      // Already the shipped version (just copied, or the user got there). An undo of "Use the new
      // version" stays possible while nothing else changed.
      next = rec && rec.replaced && rec.hash === shipped.hash ? { ...current, replaced: rec.replaced } : current;
      if (!(readOrNull(baseFile(home, id)) || Buffer.alloc(0)).equals(shipped.code)) writeAtomic(baseFile(home, id), shipped.code);
      removeFile(newFile(home, id));
    } else if (rec && rec.hash === shipped.hash) {
      next = current; // the user's changes are on top of this version already (merged, or edited since)
    } else if (rec && rec.declined === shipped.hash) {
      continue; // the user kept theirs over this version
    } else if (rec && rec.hash ? mineHash === rec.hash : shippedBefore(history, id, mineHash)) {
      // Unchanged since it was shipped: the new version replaces it (its switch, kept by id, carries over).
      writeAtomic(modFile(modsDir, id), shipped.code);
      writeAtomic(baseFile(home, id), shipped.code);
      removeFile(newFile(home, id));
      next = current;
      updated.push({ id, version: shipped.version, from: rec ? rec.version || null : null });
    } else {
      // Edited: left alone, with the new version kept for the user to use or merge.
      next = { hash: rec ? rec.hash || null : null, version: rec ? rec.version || null : null, pending: current };
      if (!(readOrNull(newFile(home, id)) || Buffer.alloc(0)).equals(shipped.code)) writeAtomic(newFile(home, id), shipped.code);
      waiting.push({ id, version: shipped.version });
    }
    if (!next.replaced) removeFile(prevFile(home, id));
    if (JSON.stringify(next) !== JSON.stringify(rec)) { state.shipped[id] = next; changed = true; }
  }
  if (changed) save(home, state);
  return { updated, waiting };
}

// ---------------------------------------------------------------- retired mods

// '2' >= '2', '10' >= '2'; nothing (no version) is older than everything.
function versionAtLeast(v, min) {
  const a = String(v || '').split('.').map(Number);
  const b = String(min).split('.').map(Number);
  if (!v || a.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

/** The examples TRIF ships (setup and tests point TRIF_EXAMPLES_DIR elsewhere). */
function examplesDir() {
  return envVar('EXAMPLES_DIR') ? path.resolve(envVar('EXAMPLES_DIR')) : path.join(__dirname, '..', '..', 'examples', 'sites');
}

/**
 * The user's copies of shipped mods TRIF folded into another one (RETIRED). Run by every setup, after
 * updateShippedMods, and when the user takes the new version of the mod they were folded into
 * (useNewVersion, resolveMerge). For each one the user was offered:
 *  - still exactly as shipped (any version): moved to the trash, so it doesn't run beside the mod that
 *    now does its job, but only once the user has that mod at version `since` or later. Until then (they
 *    deleted it, have their own file under its name, or changed it and haven't taken the new version)
 *    the old copy is what does the job, so it stays. Each browser then switches the mod it went into on
 *    if either was on (the helper sends `absorbs`; extension/lib.js applyAbsorbed);
 *  - edited: never touched. It keeps running as it is, without updates, and setup says so (once);
 *  - deleted already: just recorded.
 * Returns {removed: [{id, into, was, name, trashed}], kept: [{id, into, was, name}]} (was: the @name of the
 * user's copy, name: of `into`'s).
 */
function retireShippedMods(ws, exDir = examplesDir(), retired = RETIRED) {
  const state = load(ws.home);
  const history = loadHistory(exDir);
  const removed = [];
  const kept = [];
  let changed = false;
  for (const { id, into, since } of retired) {
    const rec = state.shipped[id] || null;
    if (!state.offered.includes(id) || (rec && (rec.own || rec.retired))) continue;
    const target = readShipped(exDir, into);
    const name = (target && parseHeader(target.code.toString('utf8')).name) || into;
    const mine = readOrNull(modFile(ws.modsDir, id));
    const was = (mine && parseHeader(mine.toString('utf8')).name) || id;
    let next;
    if (!mine) {
      next = { retired: { into } };
    } else {
      const h = sha1(mine);
      const unchanged = shippedBefore(history, id, h) || (rec && (h === rec.hash || (rec.pending && h === rec.pending.hash)));
      if (!unchanged) {
        next = { retired: { into, kept: true } };
        kept.push({ id, into, was, name });
      } else {
        const t = state.shipped[into];
        if (!t || t.own || t.retired || !t.hash || !versionAtLeast(t.version, since) || !fs.existsSync(modFile(ws.modsDir, into))) continue;
        let trashed;
        try { trashed = trash.deleteMod(ws, id).trashed; } catch { continue; } // (not a plain file: left alone)
        next = { retired: { into, trashed: path.basename(trashed) } };
        removed.push({ id, into, was, name, trashed });
        // While "Use the new version" of `into` can be undone, the undo brings this back too.
        if (t.replaced) t.replaced = { ...t.replaced, retired: [...(t.replaced.retired || []), { id, rec }] };
      }
    }
    for (const f of [baseFile, newFile, prevFile]) removeFile(f(ws.home, id));
    state.shipped[id] = next;
    changed = true;
  }
  if (changed) save(ws.home, state);
  return { removed, kept };
}

// After the user took the new version of `id` (used or merged): retire what it took in, if anything.
function retireInto(ws, id) {
  if (!ws || !RETIRED.some((r) => r.into === id)) return;
  try { retireShippedMods(ws); } catch { /* setup tries again */ }
}

/**
 * The retired mods whose unchanged copy went to the trash, by the mod each went into: {into: [ids]}.
 * The helper sends them as that mod's `absorbs`, for the browsers to carry the switches over.
 */
function absorbedIds(home) {
  const out = {};
  for (const [id, rec] of Object.entries(load(home).shipped)) {
    const r = rec.retired;
    if (r && r.trashed && typeof r.into === 'string') (out[r.into] = out[r.into] || []).push(id);
  }
  return out;
}

// ---------------------------------------------------------------- the helper and the CLI

/**
 * The updates waiting for the user, for the given mods (mods.js Mod objects): {id: {version, from,
 * modified}}. `modified`: the user's copy differs from what was shipped before (else using the new
 * version loses nothing). A copy that already is the new version has nothing waiting.
 */
function pendingUpdates(home, mods) {
  const { shipped } = load(home);
  const out = {};
  for (const m of mods) {
    const rec = shipped[m.id];
    if (!rec || rec.own || rec.retired || !rec.pending) continue;
    const mine = sha1(m.code);
    if (mine === rec.pending.hash) continue;
    out[m.id] = { version: rec.pending.version || null, from: rec.version || null, modified: mine !== rec.hash };
  }
  return out;
}

function pendingRecord(state, id) {
  const rec = state.shipped[id];
  if (!rec || rec.own || rec.retired || !rec.pending) throw new trash.TrashError(`there's no new TRIF version of ${id} waiting`);
  return rec;
}

/**
 * "Use the new version": the user's copy goes to the trash (`trif restore` brings it back, and offers
 * the update again), the new version takes its place. Returns {id, file, trashed, version}.
 */
function useNewVersion(ws, id) {
  const { site, mod } = trash.parseId(id);
  id = `${site}/${mod}`;
  const state = load(ws.home);
  const rec = pendingRecord(state, id);
  const code = readOrNull(newFile(ws.home, id));
  if (!code) throw new trash.TrashError(`the new version of ${id} is missing (${newFile(ws.home, id)}); run trif setup to bring it back`);
  const dest = modFile(ws.modsDir, id);
  const trashed = fs.existsSync(dest) ? trash.deleteMod(ws, id).trashed : null;
  writeAtomic(dest, code);
  moveFile(baseFile(ws.home, id), prevFile(ws.home, id));
  writeAtomic(baseFile(ws.home, id), code);
  removeFile(newFile(ws.home, id));
  state.shipped[id] = { hash: rec.pending.hash, version: rec.pending.version || null };
  if (trashed) state.shipped[id].replaced = { hash: rec.hash || null, version: rec.version || null, pending: rec.pending, trashed: path.basename(trashed) };
  save(ws.home, state);
  retireInto(ws, id);
  return { id, file: dest, trashed, version: rec.pending.version || null };
}

/** "Keep mine": this new version isn't offered again (a later one is). Returns {id, version}. */
function keepMine(ws, id) {
  const { site, mod } = trash.parseId(id);
  id = `${site}/${mod}`;
  const state = load(ws.home);
  const rec = pendingRecord(state, id);
  const { pending, ...rest } = rec;
  state.shipped[id] = { ...rest, declined: pending.hash };
  removeFile(newFile(ws.home, id));
  save(ws.home, state);
  return { id, version: pending.version || null };
}

/**
 * What a side-panel run needs to merge the new version into the user's copy: {hash, version, before,
 * prompt}. The merge takes two runs in one chat: the first (this prompt) only explains both sides'
 * changes and proposes how to merge them, then waits; the user's next message ("go ahead") is the run
 * that edits the file. So the update can't be settled when this run ends: `before` (the sha1 of the
 * user's copy now), `hash` and `version` are for mergeSettled, which the helper checks after each run
 * in that chat. Paths in the prompt are relative to the workspace (the agent's working folder).
 */
function mergeRequest(ws, id) {
  const { site, mod } = trash.parseId(id);
  id = `${site}/${mod}`;
  const state = load(ws.home);
  const rec = pendingRecord(state, id);
  const mine = modFile(ws.modsDir, id);
  if (!fs.existsSync(mine)) throw new trash.TrashError(`there's no mod ${id} to merge into (no file ${mine})`);
  if (!fs.existsSync(newFile(ws.home, id))) throw new trash.TrashError(`the new version of ${id} is missing; run trif setup to bring it back`);
  const rel = (f) => path.relative(ws.home, f).split(path.sep).join('/');
  const base = rec.hash && fs.existsSync(baseFile(ws.home, id)) ? rel(baseFile(ws.home, id)) : null;
  const v = (x) => (x ? `version ${x}` : 'an earlier version');
  const newVersion = rec.pending.version || null;
  const lines = [
    `TRIF has a new version (${v(newVersion)}) of the mod ${id}, which it ships. The user changed their copy, so it wasn't replaced. The user wants to merge the two, but first wants to know what that would do.`,
    '',
    `- The user's copy (the only file to edit, later): ${rel(mine)}`,
    `- The new version from TRIF (read only): ${rel(newFile(ws.home, id))}`,
    base
      ? `- What TRIF shipped before (${v(rec.version)}), which the user's copy started from (read only): ${base}`
      : '- What TRIF shipped before, which the user started from, isn\'t available: tell the user\'s changes apart from TRIF\'s by what they do.',
    '',
    '**Don\'t change any file in this reply.** Read the files and ' + (base
      ? 'compare the old version with the user\'s copy to see what the user changed, and with the new version to see what TRIF changed.'
      : 'compare the user\'s copy with the new version.'),
    'Then tell the user, in plain words and briefly: what TRIF changed in the new version; what the user changed in theirs; and how you would merge them: what you\'d bring in, what you\'d keep, and any conflicts (where both changed the same thing) and which side you\'d keep there (by default the user\'s behaviour). End by asking whether to go ahead, and stop.',
    `Only when the user says to go ahead (in their next message), edit the user's copy as proposed (or as they ask instead): keep the \`// @source\` line, set \`// @version\` to ${newVersion ? `\`${newVersion}\`, the new version's` : 'the new version\'s'}, check the file parses (\`trif check\`), reload the tab, and tell the user in a few words what changed. TRIF marks the update merged once the user's copy has changed${newVersion ? ` and says \`@version ${newVersion}\`` : ''}: don't run \`trif mod-update\`, or ask the user to.`,
  ];
  return { hash: rec.pending.hash, version: newVersion, before: sha1(fs.readFileSync(mine)), prompt: lines.join('\n') };
}

/**
 * After a run in a chat where a merge was proposed (`m`: mergeRequest's {hash, version, before}):
 * 'merged' when the user's copy has changed since the proposal and (when the new version has one) says
 * the new @version, which settles the update (resolveMerge); 'gone' when there's nothing to settle any
 * more (the update was used, kept or merged another way, or the file is gone); else 'waiting' (the
 * proposal run itself, or an unrelated change).
 */
function mergeSettled(ws, id, m) {
  const rec = load(ws.home).shipped[id];
  if (!rec || !rec.pending || rec.pending.hash !== m.hash) return 'gone';
  const now = readOrNull(modFile(ws.modsDir, id));
  if (!now) return 'gone';
  if (sha1(now) === m.before) return 'waiting';
  if (m.version && String(parseHeader(now.toString('utf8')).version || '') !== String(m.version)) return 'waiting';
  return resolveMerge(ws.home, id, m.hash, ws) ? 'merged' : 'gone';
}

/**
 * The merge is settled (mergeSettled, or `trif mod-update --merged` after a merge in a terminal): the new
 * version becomes the base, so it isn't offered again. Only if it's still the version waiting (`hash`).
 * With the workspace `ws`, the mods it took in are retired (retireShippedMods). Returns whether it was
 * resolved.
 */
function resolveMerge(home, id, hash, ws = null) {
  const state = load(home);
  const rec = state.shipped[id];
  if (!rec || !rec.pending || (hash && rec.pending.hash !== hash)) return false;
  moveFile(newFile(home, id), baseFile(home, id));
  state.shipped[id] = { hash: rec.pending.hash, version: rec.pending.version || null };
  removeFile(prevFile(home, id));
  save(home, state);
  retireInto(ws, id);
  return true;
}

/**
 * trash.restoreMod, plus the undo of "Use the new version": when the mod is still the new version that
 * replaced the user's copy, that copy comes back in its place and the new version is offered again.
 * Returns trash.restoreMod's {id, file}.
 */
function restoreMod(ws, id, opts = {}) {
  const { site, mod } = trash.parseId(id);
  id = `${site}/${mod}`;
  const state = load(ws.home);
  const rec = state.shipped[id];
  const dest = modFile(ws.modsDir, id);
  const now = readOrNull(dest);
  const entry = trash.listTrash(ws).find((t) => t.id === id);
  if (!rec || !rec.replaced || !now || sha1(now) !== rec.hash || !entry || path.basename(entry.file) !== rec.replaced.trashed) {
    return trash.restoreMod(ws, id, opts);
  }
  // The new version is kept in .shipped, so moving it aside loses nothing; it comes back if the restore fails.
  const aside = path.join(path.dirname(dest), `.${mod}.js.${process.pid}.aside`);
  fs.renameSync(dest, aside);
  let r;
  try { r = trash.restoreMod(ws, id, opts); } catch (e) { fs.renameSync(aside, dest); throw e; }
  removeFile(aside);
  const { replaced } = rec;
  moveFile(baseFile(ws.home, id), newFile(ws.home, id));
  moveFile(prevFile(ws.home, id), baseFile(ws.home, id));
  state.shipped[id] = { hash: replaced.hash || null, version: replaced.version || null, pending: replaced.pending };
  // The retired mods that went to the trash because of the new version come back, with their records.
  for (const { id: rid, rec: before } of Array.isArray(replaced.retired) ? replaced.retired : []) {
    const was = state.shipped[rid];
    if (!was || !was.retired || !was.retired.trashed) continue;
    const t = trash.listTrash(ws).find((e) => e.id === rid); // (restoreMod brings back the newest)
    if (!t || path.basename(t.file) !== was.retired.trashed || fs.existsSync(modFile(ws.modsDir, rid))) continue;
    try { trash.restoreMod(ws, rid); } catch { continue; }
    if (before) state.shipped[rid] = before; else delete state.shipped[rid];
  }
  save(ws.home, state);
  return r;
}

/** The ids the extension should switch off when it first sees them. */
function startOffIds(home) { return new Set(load(home).startOff); }

/** The sites each browser should turn TRIF on for when it first sees them. */
function startSitesOn(home) { return load(home).sitesOn; }

module.exports = {
  PREINSTALLED, RETIRED, SITES_ON, DEFAULT_ORDER, SHIPPED_DIR, preinstallMods, updateShippedMods, retireShippedMods, absorbedIds,
  startOffIds, startSitesOn, loadPreinstalled: load, pendingUpdates, useNewVersion, keepMine, mergeRequest, mergeSettled, resolveMerge, restoreMod, baseFile, newFile, loadHistory,
};
