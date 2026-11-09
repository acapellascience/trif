'use strict';
// Mod history: what a side-panel run changed, so it can be undone. When a run starts, the helper keeps
// the mods' text (contentsSnapshot); when it ends, each mod the run changed gets its previous text kept as
// <home>/history/<site>/<mod>@<stamp>.js (a mod the run created gets an empty <mod>@<stamp>.created
// marker instead), like trash/. `trif undo` (and the chat's "Undo these changes") puts back the newest
// one and keeps what it replaced as a history entry of its own; entries older than HISTORY_DAYS go.
// history/ is the helper's: runs can't write it (they write sites/ only), and nothing in it runs.

const fs = require('fs');
const path = require('path');
const { listModFiles, isIgnoredName } = require('./mods');
const trash = require('./trash');

const HISTORY = 'history';
const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT = 64 * 1024 * 1024; // the most text a run's start keeps (all mods together are 16 MB at most)

function historyDir(ws) { return path.join(ws.home, HISTORY); }
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, '');
const timeOf = (stamp) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z/.exec(stamp);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : NaN;
};

/** Every mod file's text, by path relative to the workspace (what a run's end compares against). */
function contentsSnapshot(ws) {
  const out = new Map();
  let total = 0;
  for (const { file } of listModFiles(ws.modsDir)) {
    try {
      const b = fs.readFileSync(file);
      if (total + b.length > MAX_KEPT) break;
      total += b.length;
      out.set(path.relative(ws.home, file), b);
    } catch { /* vanished */ }
  }
  return out;
}

// sites/<site>/<mod>.js (relative to the workspace) -> {site, mod}, or null for anything else
function modOf(ws, rel) {
  const parts = rel.split(path.sep);
  if (parts.length !== 3 || path.join(parts[0]) !== path.relative(ws.home, ws.modsDir)) return null;
  if (!parts[2].endsWith('.js') || isIgnoredName(parts[1]) || isIgnoredName(parts[2])) return null;
  return { site: parts[1], mod: parts[2].slice(0, -3) };
}

function writeEntry(ws, site, mod, content, at = Date.now()) {
  const dir = path.join(historyDir(ws), site);
  fs.mkdirSync(dir, { recursive: true });
  // (two in the same millisecond: the later one a millisecond on)
  let t = at;
  const name = (ms) => path.join(dir, `${mod}@${stampOf(ms)}${content === null ? '.created' : '.js'}`);
  while (fs.existsSync(name(t)) || fs.existsSync(name(t).replace(/\.(js|created)$/, content === null ? '.js' : '.created'))) t++;
  fs.writeFileSync(name(t), content === null ? '' : content);
  return name(t);
}

/**
 * After a run: keep the previous text of each mod it changed (`changed`: paths relative to the workspace,
 * as runs.js diffSnapshots gives them). Returns the ids with a history entry now.
 */
function recordChanges(ws, before, changed) {
  const ids = [];
  for (const rel of changed) {
    const m = modOf(ws, rel);
    if (!m) continue;
    const prev = before.has(rel) ? before.get(rel) : null;
    // (a mod that's gone now was deleted, and the trash has it already)
    if (!fs.existsSync(path.join(ws.home, rel))) continue;
    writeEntry(ws, m.site, m.mod, prev);
    ids.push(`${m.site}/${m.mod}`);
  }
  prune(ws);
  return ids;
}

/** A mod's history, newest first: [{at, kind: 'version'|'created', file}]. */
function listHistory(ws, id) {
  const { site, mod } = trash.parseId(id);
  let names = [];
  try { names = fs.readdirSync(path.join(historyDir(ws), site)); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = /^(.+)@(\d{8}T\d{9}Z)\.(js|created)$/.exec(n);
    if (!m || m[1] !== mod) continue;
    out.push({ at: timeOf(m[2]), kind: m[3] === 'js' ? 'version' : 'created', file: path.join(historyDir(ws), site, n) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Undo the newest change to a mod: put back the text it had (keeping what it replaces as a new entry, so
 * an undo can be undone), or, if a run created it, move it to the trash. Returns {id, restored, at}.
 */
function undoChange(ws, id) {
  const { site, mod } = trash.parseId(id);
  const [last] = listHistory(ws, id);
  if (!last) throw new trash.TrashError(`${site}/${mod} has no changes to undo (only side-panel runs' changes are kept, for ${HISTORY_DAYS} days)`);
  const file = path.join(ws.modsDir, site, `${mod}.js`);
  if (last.kind === 'created') {
    if (fs.existsSync(file)) trash.deleteMod(ws, `${site}/${mod}`);
    fs.unlinkSync(last.file);
    return { id: `${site}/${mod}`, restored: 'removed', at: last.at };
  }
  const text = fs.readFileSync(last.file);
  const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  fs.unlinkSync(last.file);
  if (current) writeEntry(ws, site, mod, current); // (the undo, undoable)
  return { id: `${site}/${mod}`, restored: 'previous', at: last.at };
}

function prune(ws, now = Date.now()) {
  let sites = [];
  try { sites = fs.readdirSync(historyDir(ws)); } catch { return; }
  for (const site of sites) {
    let names = [];
    try { names = fs.readdirSync(path.join(historyDir(ws), site)); } catch { continue; }
    for (const n of names) {
      const m = /@(\d{8}T\d{9}Z)\.(js|created)$/.exec(n);
      if (m && now - timeOf(m[1]) > HISTORY_DAYS * DAY_MS) { try { fs.unlinkSync(path.join(historyDir(ws), site, n)); } catch { /* gone */ } }
    }
  }
}

module.exports = { contentsSnapshot, recordChanges, listHistory, undoChange, writeEntry, historyDir, HISTORY_DAYS };
