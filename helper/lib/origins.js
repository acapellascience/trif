'use strict';
// Which browser made each mod, so a mod made from one browser's side panel starts off in the others: the
// helper sends each mod's origin, and an extension switches off a mod made by another browser the first
// time it sees it (after that, its switch is the user's; see applyStartOff in extension/lib.js).
//
// <home>/origins.json = {"<mod id>": {by: <extension install id>, browser: "Firefox", at, live?}}. `live`: the
// mod's file was written while that run was in progress (not one of the late files counted for it in the
// moments after it ended, ENDED_GRACE_MS, which may be anyone's): only those count as the run's own where
// it matters that the user asked for them (a group whose new mods start off, extension/lib.js applyNewMods).
// Every helper attributes a mod id the moment its scan first sees it: to its own agent run if it has one
// going, else to another browser's run in progress (<home>/active-runs/<runId>.json, written when a run
// starts), else to nobody (a terminal agent or the user wrote it: on everywhere). Helpers agree because
// they read the same markers, whichever of them notices the new file first.

const fs = require('fs');
const path = require('path');
const { pidAlive } = require('./helpers');

const ORIGINS = 'origins.json';
const ACTIVE_DIR = 'active-runs';
// A run's files can reach another helper's scan a moment after the run ends (debounce, polling).
const ENDED_GRACE_MS = 15000;
const STALE_MS = 60 * 60 * 1000;

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function loadOrigins(home) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(home, ORIGINS), 'utf8'));
    const out = {};
    for (const [id, o] of Object.entries(v && typeof v === 'object' ? v : {})) {
      if (o && typeof o.by === 'string' && o.by) out[id] = { by: o.by, browser: typeof o.browser === 'string' ? o.browser : '', at: Number(o.at) || 0, ...(o.live === true ? { live: true } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

function activeFile(home, runId) { return path.join(home, ACTIVE_DIR, `${runId}.json`); }

/** Mark an agent run as in progress for the other helpers. info: {runId, by, browser, site}. */
function markRunActive(home, info) {
  fs.mkdirSync(path.join(home, ACTIVE_DIR), { recursive: true });
  writeJson(activeFile(home, info.runId), { ...info, pid: process.pid, startedAt: Date.now(), endedAt: null });
}

/** The run finished: its marker stays for ENDED_GRACE_MS, then goes on the next cleanup. */
function markRunEnded(home, runId) {
  const file = activeFile(home, runId);
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    writeJson(file, { ...m, endedAt: Date.now() });
  } catch { /* never marked */ }
}

/** Runs in progress (or just ended) in any helper. Removes markers of dead helpers and old runs. */
function activeRuns(home, { now = Date.now(), alive = pidAlive } = {}) {
  const dir = path.join(home, ACTIVE_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const file = path.join(dir, n);
    let m = null;
    try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* being written, or junk */ }
    if (!m || typeof m.by !== 'string') continue;
    const ended = typeof m.endedAt === 'number';
    const gone = (ended && now - m.endedAt > STALE_MS) || (!ended && !alive(m.pid)) || now - (m.startedAt || 0) > 24 * STALE_MS;
    if (gone) { try { fs.unlinkSync(file); } catch { /* raced */ } continue; }
    if (!ended || now - m.endedAt <= ENDED_GRACE_MS) out.push(m);
  }
  return out;
}

const bare = (site) => String(site || '').toLowerCase().replace(/^www\./, '');

/**
 * Attribute newly seen mod ids. runs: [{by, browser, site, own}] in progress; the helper's own runs
 * first. A run on the mod's site wins; else the helper's own run; else any other. No run: the id has no
 * origin (any old entry, e.g. from a deleted mod of the same name, is dropped). `writtenAt` (id -> the
 * file's mtime, ms): `live` when it was written between the run's start and its end (or it hasn't ended).
 * Returns true if origins.json changed.
 */
function recordOrigins(home, newIds, runs, now = Date.now(), writtenAt = {}) {
  if (!newIds.length) return false;
  const origins = loadOrigins(home);
  let changed = false;
  for (const id of newIds) {
    const site = bare(id.split('/')[0]);
    const run = runs.find((r) => bare(r.site) === site || site.endsWith(`.${bare(r.site)}`) || bare(r.site).endsWith(`.${site}`))
      || runs.find((r) => r.own) || runs[0];
    if (run) {
      const t = Number(writtenAt[id]);
      const live = Number.isFinite(t) && t >= (Number(run.startedAt) || 0) && (typeof run.endedAt !== 'number' || t <= run.endedAt);
      if (origins[id] && origins[id].by === run.by && !!origins[id].live === live) continue;
      origins[id] = { by: run.by, browser: run.browser || '', at: now, ...(live ? { live: true } : {}) };
      changed = true;
    } else if (origins[id]) {
      delete origins[id];
      changed = true;
    }
  }
  if (changed) writeJson(path.join(home, ORIGINS), origins);
  return changed;
}

/**
 * Mods renamed on disk (mods.js findRenames: [{from, to}]) are the same mods: each new id takes the old
 * one's origin (or none), so a mod made here doesn't become another browser's by being renamed during
 * its run. Returns true if origins.json changed.
 */
function renameOrigins(home, renames) {
  if (!renames.length) return false;
  const origins = loadOrigins(home);
  let changed = false;
  const was = renames.map(({ from }) => origins[from]);
  for (const { from } of renames) if (origins[from]) { delete origins[from]; changed = true; }
  renames.forEach(({ to }, i) => {
    if (was[i]) { origins[to] = was[i]; changed = true; } else if (origins[to]) { delete origins[to]; changed = true; }
  });
  if (changed) writeJson(path.join(home, ORIGINS), origins);
  return changed;
}

module.exports = { loadOrigins, recordOrigins, renameOrigins, markRunActive, markRunEnded, activeRuns, ENDED_GRACE_MS };
