'use strict';
// Tim's mods: the mods TRIF ships, copied from the examples into a workspace site by site, only for the
// sites the user chose (the setup page's checklist, Settings in the panel, the "Add Tim's mods for <site>"
// link on a site's panel, or `trif setup --examples [sites]`: nothing of Tim's is on disk before that),
// each switched on or off as listed, and turning TRIF on for the sites in SITES_ON among them; and keeping
// those mods up to date. $TRIF_HOME/preinstalled.json = {starter: {site: choice}, skipped: [ids],
// offered: [ids], startOff: [ids], sitesOn: [sites], shipped: {id: record}}:
//  - starter: the user's choice for each site Tim has mods for (its scope: google.com for the folder
//    www.google.com), 'added' or 'none' (absent: not chosen, like a site a later TRIF version brings mods
//    for, which Settings offers). An added site gets its mods, and every new one and every update a later
//    version brings for it; any other site gets nothing. A site with ids in `offered` counts as added: a
//    workspace set up before the choice existed (setup copied them all) keeps getting them as before;
//  - skipped: mods of an added site the user chose not to add (shipped.install with `ids`; the setup page
//    adds whole sites): never copied (no setup or update brings them), offered in Settings until added;
//  - readded: {id: stamp}, mods the user deleted and then got back from Settings ("Add the rest") or the
//    site's link: a fresh copy, which each browser switches on or off as listed once per stamp (a deleted
//    mod stays gone otherwise: no setup or update brings it back);
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
const { scopeFor } = require('./scope');

// on: switched on from the start; the rest wait for the user to switch them on.
const PREINSTALLED = [
  { id: 'www.google.com/hide-ai-in-results', on: true }, // AI Banisher
  { id: 'www.google.com/hide-extra-sections', on: true }, // Just Results
  { id: 'x.com/detox-timeline', on: true }, // (x.com/plain-x until 0.2.3: RETIRED, below)
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
  // Added in 0.2.3 (off, like any shipped mod an update brings).
  { id: 'x.com/follow-status', on: false },
  { id: 'x.com/space-shooter', on: false }, // X-Flyer
  { id: 'www.instagram.com/three-column-feed', on: false },
  // Added after 0.2.4: two for TRIF's own home page, timsrobot.com, whose demo's mods are the site's own
  // (site/demo/mods/): these two drive that demo (skip its game to sandbox mode with every mod listed; R
  // switches a random set on). Off, and TRIF starts off on timsrobot.com (not in SITES_ON).
  { id: 'timsrobot.com/skip-to-sandbox', on: false },
  { id: 'timsrobot.com/random-mods', on: false }, // R for Random
  // Added in 0.2.5 (off): people's own colours, read from codes in their profile pictures (Profile Styler on
  // profiles, Post Styler on posts and people cards), and Style Encoder to stamp yours into your picture.
  { id: 'x.com/profile-styler', on: false },
  { id: 'x.com/post-styler', on: false },
  { id: 'x.com/style-encoder', on: false },
  // (Rainbow Rave for Google, Amazon and Instagram waits for a later release: unreleased/sites/.)
];

// The order the side panel lists a site's shipped mods in until the user drags them into their own (display
// only: mods run in their usual order). By site, as the extension's scopeFor gives it; the helper sends it
// with every mods message (`defaultOrder`), and extension/lib.js orderMods puts mods it doesn't list after.
// (0.2.3: X's, in Tim's order. The other sites' few shipped mods list in the order they always did.)
const DEFAULT_ORDER = {
  'x.com': ['x.com/detox-timeline', 'x.com/follow-status', 'x.com/profile-styler', 'x.com/post-styler', 'x.com/style-encoder', 'x.com/space-shooter', 'x.com/rainbow-rave'],
};

// Shipped mods folded into another one (`into`, from its @version `since`), so no longer shipped
// (0.2.0: AI Banisher and Just Results). retireShippedMods, below, handles the copies users have.
const RETIRED = [
  { id: 'www.google.com/hide-ai-mode', into: 'www.google.com/hide-ai-in-results', since: '2' },
  { id: 'www.google.com/hide-sponsored', into: 'www.google.com/hide-extra-sections', since: '2' },
  // 0.2.3: a rename (no "X" in a shipped mod's file name). Detox Timeline arrives like any new shipped mod,
  // then the unchanged plain-x goes to the trash and each browser switches Detox Timeline on if plain-x
  // was (absorbs); an edited plain-x stays, as the user's own.
  { id: 'x.com/plain-x', into: 'x.com/detox-timeline', since: '1', renamed: true },
];

// TRIF is off on every site until the user turns it on there; it starts on for these, the sites the
// mods above are for.
const SITES_ON = ['google.com', 'x.com', 'amazon.com', 'instagram.com'];

// What the setup page and Settings call each site Tim has mods for (any other: the site itself).
const SITE_NAMES = { 'google.com': 'Google', 'x.com': 'X', 'amazon.com': 'Amazon', 'instagram.com': 'Instagram' };
// A few words after a site's name there, when the name alone doesn't say what its mods are for.
const SITE_NOTES = { 'timsrobot.com': 'for TRIF’s own demo' };

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
  const offered = list(v && v.offered);
  // The user's choice by site; a site with mods offered was added (by a setup before there was a choice, too).
  const starter = {};
  const c = v && v.starter;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    for (const [site, choice] of Object.entries(c)) if (choice === 'added' || choice === 'none') starter[site] = choice;
  } else if (c === 'added' || c === 'none') {
    // (one choice for every site: what development builds between 0.2.4 and 0.2.5 recorded)
    for (const site of starterSites()) starter[site] = c;
  }
  for (const id of offered) { const site = siteOf(id); if (site) starter[site] = 'added'; }
  const skipped = list(v && v.skipped).filter((id) => !offered.includes(id));
  const readded = {};
  if (v && v.readded && typeof v.readded === 'object' && !Array.isArray(v.readded)) {
    for (const [id, stamp] of Object.entries(v.readded)) if (typeof stamp === 'string') readded[id] = stamp;
  }
  return { starter, skipped, readded, offered, startOff: list(v && v.startOff), sitesOn: list(v && v.sitesOn), shipped };
}

// Written whole and renamed into place: setup and the helpers (another browser's too) all write it.
function save(home, state) {
  const out = { ...(Object.keys(state.starter || {}).length ? { starter: state.starter } : {}), ...(state.skipped && state.skipped.length ? { skipped: state.skipped } : {}), ...(Object.keys(state.readded || {}).length ? { readded: state.readded } : {}), offered: state.offered, startOff: state.startOff, sitesOn: state.sitesOn };
  if (Object.keys(state.shipped || {}).length) out.shipped = state.shipped;
  const tmp = `${file(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, file(home));
}

// ---------------------------------------------------------------- files

const split = (id) => { const i = id.indexOf('/'); return [id.slice(0, i), id.slice(i + 1)]; };
const modFile = (modsDir, id) => { const [site, mod] = split(id); return path.join(modsDir, site, `${mod}.js`); };
/** The site a shipped mod is for, as the user chooses it: its folder's scope (www.google.com/x -> google.com). */
const siteOf = (id) => scopeFor(split(String(id))[0]);
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
 * Copy the PREINSTALLED mods not offered before into modsDir, for the sites the user added (`add`: sites
 * to add now, or 'all'; see starterSites), and offer the SITES_ON among those sites. `restore`: sites whose
 * offered mods the user deleted come back too, fresh (readded). Returns {added: [ids copied], on: [those
 * switched on], sites: [sites newly offered]}.
 */
function preinstallMods(home, modsDir, examplesDir, list = PREINSTALLED, sitesOn = SITES_ON, { add = null, restore = [] } = {}) {
  const state = load(home);
  const history = loadHistory(examplesDir);
  const added = [];
  const on = [];
  let changed = false;
  for (const site of add === 'all' ? starterSites(list, sitesOn) : add || []) {
    if (state.starter[site] !== 'added') { state.starter[site] = 'added'; changed = true; }
  }
  for (const { id, on: startOn } of list) {
    if (state.starter[siteOf(id)] !== 'added' || state.skipped.includes(id)) continue;
    if (state.offered.includes(id)) {
      // Deleted, and the user asked for it back: a fresh copy, switched as listed (each browser, once).
      const dest = modFile(modsDir, id);
      if (!restore.includes(siteOf(id)) || fs.existsSync(dest) || !fs.existsSync(modFile(examplesDir, id))) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // (its base first: the helper judges a new shipped mod against it, held.js)
      writeAtomic(baseFile(home, id), fs.readFileSync(modFile(examplesDir, id)));
      fs.copyFileSync(modFile(examplesDir, id), dest);
      added.push(id);
      if (startOn) on.push(id); else if (!state.startOff.includes(id)) state.startOff.push(id);
      const rec = state.shipped[id];
      if (rec && !rec.retired) delete state.shipped[id]; // (updateShippedMods records it afresh; never `own` now)
      state.readded[id] = new Date().toISOString();
      changed = true;
      continue;
    }
    const src = modFile(examplesDir, id);
    if (!fs.existsSync(src)) continue;
    const dest = modFile(modsDir, id);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // (its base first: the helper judges a new shipped mod against it, held.js)
      writeAtomic(baseFile(home, id), fs.readFileSync(src));
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
  const sites = sitesOn.filter((s) => state.starter[s] === 'added' && !state.sitesOn.includes(s));
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
      // (still the version TRIF put in place by itself: keep its stamp, for browsers that haven't seen it)
      if (rec && rec.auto && rec.hash === shipped.hash) next = { ...next, auto: rec.auto };
      if (!(readOrNull(baseFile(home, id)) || Buffer.alloc(0)).equals(shipped.code)) writeAtomic(baseFile(home, id), shipped.code);
      removeFile(newFile(home, id));
    } else if (rec && rec.hash === shipped.hash) {
      next = current; // the user's changes are on top of this version already (merged, or edited since)
    } else if (rec && rec.declined === shipped.hash) {
      continue; // the user kept theirs over this version
    } else if (rec && rec.hash ? mineHash === rec.hash : shippedBefore(history, id, mineHash)) {
      // Unchanged since it was shipped: the new version replaces it (its switch, kept by id, carries over).
      // (the base first: the helper judges a changed shipped mod against it, held.js)
      writeAtomic(baseFile(home, id), shipped.code);
      writeAtomic(modFile(modsDir, id), shipped.code);
      removeFile(newFile(home, id));
      // (stamped: a browser where new mods of its group start off switches it off, once; autoUpdatedIds)
      next = { ...current, auto: new Date().toISOString() };
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
  for (const { id, into, since, renamed } of retired) {
    const how = renamed ? { renamed: true } : {}; // (setup says "now called", not "now part of")
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
        kept.push({ id, into, was, name, ...how });
      } else {
        const t = state.shipped[into];
        if (!t || t.own || t.retired || !t.hash || !versionAtLeast(t.version, since) || !fs.existsSync(modFile(ws.modsDir, into))) continue;
        let trashed;
        try { trashed = trash.deleteMod(ws, id).trashed; } catch { continue; } // (not a plain file: left alone)
        next = { retired: { into, trashed: path.basename(trashed) } };
        removed.push({ id, into, was, name, trashed, ...how });
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

// ---------------------------------------------------------------- Tim's mods, site by site

/** The sites Tim has mods for: the ones TRIF starts on for first (SITES_ON's order), then the rest as listed. */
function starterSites(list = PREINSTALLED, sitesOn = SITES_ON) {
  const all = [...new Set(list.map((m) => siteOf(m.id)).filter(Boolean))];
  return [...sitesOn.filter((s) => all.includes(s)), ...all.filter((s) => !sitesOn.includes(s))];
}

const siteName = (site) => SITE_NAMES[site] || site;

/**
 * The sites named on the command line (`trif setup --examples x.com,google.com`): each as its scope, its
 * folder or its name ("x.com", "www.google.com", "Instagram"). Throws for one Tim has no mods for.
 */
function resolveSites(names, list = PREINSTALLED, sitesOn = SITES_ON) {
  const known = starterSites(list, sitesOn);
  const out = [];
  for (const raw of (Array.isArray(names) ? names : String(names || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean)) {
    const site = known.find((s) => s === scopeFor(raw) || siteName(s).toLowerCase() === raw);
    if (!site) throw new Error(`Tim has no mods for ${raw}: the sites are ${known.join(', ')}`);
    if (!out.includes(site)) out.push(site);
  }
  return out;
}

/** The user's choice by site, {site: 'added'|'none'}: only sites they chose (or have mods for). */
function starterChoices(home) { return load(home).starter; }

/**
 * "Start with none" (the setup page), the sites left unticked there (`only`), or `setup --no-examples`:
 * recorded as 'none' for each site not chosen yet, so nothing adds them later (the user still can).
 * Never undoes 'added'. Returns the choices.
 */
function chooseNoStarter(home, { only = null, list = PREINSTALLED, sitesOn = SITES_ON } = {}) {
  const state = load(home);
  let changed = false;
  for (const site of only || starterSites(list, sitesOn)) {
    if (!state.starter[site]) { state.starter[site] = 'none'; changed = true; }
  }
  if (changed) save(home, state);
  return state.starter;
}

/** The shipped mods named (ids, as PREINSTALLED lists them). Throws for one that isn't. */
function resolveIds(ids, list = PREINSTALLED) {
  const known = list.map((m) => m.id);
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : []).map((x) => String(x).trim())) {
    if (!known.includes(id)) throw new Error(`${id || '""'} isn't one of Tim's mods`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Add Tim's mods: what setup did for every site before there was a choice (the mods, their update records,
 * TRIF on for the site if it's in SITES_ON). `sites` (or 'all'): every mod of those sites not on disk, the
 * ones left out or deleted before too (the setup page, Settings' "Add the rest", a site's link). `ids`: just these mods (the setup page's ticked
 * ones); for a site not chosen before, its other mods are left out (`skipped`: never copied, offered in
 * Settings). `othersNone`: every site not chosen yet and not added now is recorded as 'none' (the setup
 * page's "Add these"). Returns preinstallMods' result.
 */
function installStarter(home, modsDir, examplesDir, sites = 'all', { ids = null, othersNone = false, list = PREINSTALLED, sitesOn = SITES_ON } = {}) {
  const mods = ids ? resolveIds(ids, list) : [];
  const whole = ids ? [] : sites === 'all' ? starterSites(list, sitesOn) : resolveSites(sites, list, sitesOn);
  const add = [...new Set([...whole, ...mods.map(siteOf)])];
  const state = load(home);
  const before = { ...state.starter };
  const skipped = new Set(state.skipped);
  for (const site of whole) for (const { id } of list) if (siteOf(id) === site) skipped.delete(id);
  for (const id of mods) skipped.delete(id);
  // A site chosen now for the first time, by its mods: the ones not ticked are left out.
  for (const site of add) {
    if (before[site] === 'added' || whole.includes(site)) continue;
    for (const { id } of list) if (siteOf(id) === site && !mods.includes(id) && !state.offered.includes(id)) skipped.add(id);
  }
  if ([...skipped].join() !== state.skipped.join()) { state.skipped = [...skipped]; save(home, state); }
  const r = preinstallMods(home, modsDir, examplesDir, list, sitesOn, { add, restore: whole });
  if (othersNone) chooseNoStarter(home, { only: starterSites(list, sitesOn).filter((s) => !add.includes(s)) });
  updateShippedMods(home, modsDir, examplesDir, list);
  return r;
}

// A shipped mod's @name and @description, from the start of its file (X-Flyer is megabytes), by the file's
// size and time: the helper asks for them with every mods message.
const headerCache = new Map();
function exampleHeader(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = headerCache.get(file);
  if (hit && hit.key === key) return hit.header;
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(Math.min(st.size, 16384)); text = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return null; }
  const h = parseHeader(text);
  const header = { name: h.name || null, description: h.description || '' };
  headerCache.set(file, { key, header });
  return header;
}

/**
 * What the setup page and Settings show: {chosen (the user chose for some site, or has Tim's mods: the
 * setup page's step is done), sites: [{site, name, note, choice ('added'|'none'|null), suggested (in SITES_ON:
 * ticked on the setup page, and TRIF turns on for it), mods: [{id, name, description, on, choice ('added':
 * on disk, 'deleted': added once and deleted since, 'skipped': left out, null)}]}]}, sites in
 * starterSites' order, each one's mods in DEFAULT_ORDER's (else as listed). Only mods whose example is there.
 */
function starterOffer(home, examplesDir, list = PREINSTALLED, sitesOn = SITES_ON, { modsDir = path.join(home, 'sites') } = {}) {
  const state = load(home);
  const choices = state.starter;
  const sites = [];
  for (const site of starterSites(list, sitesOn)) {
    const order = DEFAULT_ORDER[site] || [];
    const ids = list.map((m) => m.id).filter((id) => siteOf(id) === site)
      .sort((a, b) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
    const mods = [];
    for (const id of ids) {
      const h = exampleHeader(modFile(examplesDir, id));
      // added: on disk; deleted: offered once, gone since (Settings offers it back); skipped: left out.
      const choice = state.offered.includes(id) ? (fs.existsSync(modFile(modsDir, id)) ? 'added' : 'deleted') : state.skipped.includes(id) ? 'skipped' : null;
      if (h) mods.push({ id, name: h.name || id.split('/')[1], description: h.description, on: !!list.find((m) => m.id === id).on, choice });
    }
    if (mods.length) sites.push({ site, name: siteName(site), note: SITE_NOTES[site] || '', choice: choices[site] || null, suggested: sitesOn.includes(site), mods });
  }
  return { chosen: sites.some((s) => s.choice), sites };
}

/** The ids the extension should switch off when it first sees them. */
function startOffIds(home) { return new Set(load(home).startOff); }

/** The mods added again after being deleted: {id: stamp}; each browser switches each as listed once per stamp. */
function readdedIds(home) { return load(home).readded; }

/**
 * Shipped mods TRIF replaced with a new version by itself (the user hadn't changed theirs): id -> stamp,
 * while the copy is still that version. Sent with the mods as `autoUpdated`: a browser whose user set new
 * mods of that group to start off switches it off once (extension/lib.js applyNewMods). Not one the user
 * chose ("Use the new version"): they asked for that one.
 */
function autoUpdatedIds(home) {
  const out = {};
  for (const [id, r] of Object.entries(load(home).shipped)) if (typeof r.auto === 'string') out[id] = r.auto;
  return out;
}

/** The sites each browser should turn TRIF on for when it first sees them. */
function startSitesOn(home) { return load(home).sitesOn; }

module.exports = {
  PREINSTALLED, RETIRED, SITES_ON, SITE_NAMES, DEFAULT_ORDER, SHIPPED_DIR, preinstallMods, updateShippedMods, retireShippedMods, absorbedIds,
  starterSites, siteOf, siteName, resolveSites, resolveIds, readdedIds, autoUpdatedIds, starterChoices, chooseNoStarter, installStarter, starterOffer, examplesDir,
  startOffIds, startSitesOn, loadPreinstalled: load, pendingUpdates, useNewVersion, keepMine, mergeRequest, mergeSettled, resolveMerge, restoreMod, baseFile, newFile, loadHistory,
};
