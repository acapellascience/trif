'use strict';
// Deleting mods: `trif delete`, the side panel's Delete, and agents (which have `trif` but no rm).
// A deleted mod isn't erased but moved to <home>/trash/<site>/<mod>@<stamp>.js, so `trif restore`
// (or the panel's Undo) can bring it back; entries older than TRASH_DAYS are removed. Only mod files are
// ever touched. A run may delete or restore only mods that stay inside its scope, as with switches.
//
// The extension's switch state for a deleted mod stays, so a restored mod comes back on or off as it was.

const fs = require('fs');
const path = require('path');
const { buildMod, isIgnoredName, readModFile } = require('./mods');
const { outOfScope, scopeOf } = require('./scope');
const { badName } = require('./pathcheck');

const TRASH = 'trash';
const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

class TrashError extends Error {}

function trashDir(ws) { return path.join(ws.home, TRASH); }

/** Splits a mod id into {site, mod}, refusing anything that isn't a plain <site>/<mod>. */
function parseId(id) {
  const m = /^([^/\\\s]+)\/([^/\\\s]+?)(?:\.js)?$/.exec(String(id || '').trim());
  if (!m || [m[1], m[2]].some((p) => p === '..' || isIgnoredName(p) || badName(p))) {
    throw new TrashError(`"${id}" isn't a mod id: use <site>/<mod>, e.g. x.com/hide-reposts`);
  }
  return { site: m[1], mod: m[2] };
}

// 2026-10-30T13:58:02.123Z -> 20261030T135802123Z: sorts by time, safe in file names.
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, '');
const timeOf = (stamp) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : NaN;
};

function checkScope(site, file, scope, verb, splits = []) {
  if (!scope) return;
  // (a mod in another site's folder isn't this chat's, even when its @match is: sites/mail.google.com/ to a
  // google.com chat, where mail.google.com is a site of its own, scope.js scopeOf)
  if (scopeOf(site, [...splits, scope]) !== scope) {
    throw new TrashError(`this chat can only ${verb} mods of ${scope}; ${site}/${path.basename(file, '.js')} is another site's. Ask the user to do it from the side panel there or their terminal.`);
  }
  // (A link out of the mods folder, or the trash, isn't read: readModFile.)
  let code;
  try { code = readModFile(path.dirname(path.dirname(file)), file); } catch (e) { throw new TrashError(`${site}/${path.basename(file, '.js')}: ${e.message}`); }
  const mod = buildMod({ site, file, code }).mod;
  const outside = outOfScope(mod, scope);
  if (outside.length) {
    throw new TrashError(`this chat can only ${verb} mods that stay on ${scope}; ${mod.id} also runs on ${outside.join(', ')}. ` +
      'Ask the user to do it from the side panel or their terminal.');
  }
}

/** Every trashed mod, newest first: [{id, file, deletedAt}]. */
function listTrash(ws) {
  const out = [];
  let sites = [];
  try { sites = fs.readdirSync(trashDir(ws)); } catch { return out; }
  for (const site of sites) {
    let names = [];
    try { names = fs.readdirSync(path.join(trashDir(ws), site)); } catch { continue; }
    for (const name of names) {
      const m = /^(.+)@(\w+)\.js$/.exec(name);
      const deletedAt = m ? timeOf(m[2]) : NaN;
      if (!Number.isNaN(deletedAt)) out.push({ id: `${site}/${m[1]}`, file: path.join(trashDir(ws), site, name), deletedAt });
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Removes trash entries older than `days`. Returns how many went. */
function emptyTrash(ws, { days = TRASH_DAYS, now = Date.now() } = {}) {
  let removed = 0;
  for (const t of listTrash(ws)) {
    if (now - t.deletedAt <= days * DAY_MS) continue;
    try { fs.unlinkSync(t.file); removed++; } catch { /* gone already */ }
  }
  return removed;
}

/** Moves <modsDir>/<site>/<mod>.js to the trash. Returns {id, file, trashed}. */
function deleteMod(ws, id, { scope, splits = [], now = Date.now() } = {}) {
  const { site, mod } = parseId(id);
  const file = path.join(ws.modsDir, site, `${mod}.js`);
  let st = null;
  try { st = fs.lstatSync(file); } catch { /* missing */ }
  if (!st || !st.isFile()) throw new TrashError(`there's no mod ${site}/${mod} (no file ${file})`);
  checkScope(site, file, scope, 'delete', splits);
  const dir = path.join(trashDir(ws), site);
  fs.mkdirSync(dir, { recursive: true });
  let trashed = path.join(dir, `${mod}@${stampOf(now)}.js`);
  for (let n = 1; fs.existsSync(trashed); n++) trashed = path.join(dir, `${mod}@${stampOf(now + n)}.js`);
  fs.renameSync(file, trashed);
  emptyTrash(ws, { now });
  return { id: `${site}/${mod}`, file, trashed };
}

/** Puts the most recently deleted copy of a mod back. Returns {id, file}. */
function restoreMod(ws, id, { scope, splits = [] } = {}) {
  const { site, mod } = parseId(id);
  const entry = listTrash(ws).find((t) => t.id === `${site}/${mod}`);
  if (!entry) throw new TrashError(`${site}/${mod} isn't in the trash (trif restore lists what is)`);
  const file = path.join(ws.modsDir, site, `${mod}.js`);
  if (fs.existsSync(file)) throw new TrashError(`${site}/${mod} exists again (${file}): rename or delete it first`);
  checkScope(site, entry.file, scope, 'restore', splits);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.renameSync(entry.file, file);
  return { id: `${site}/${mod}`, file };
}

module.exports = { deleteMod, restoreMod, listTrash, emptyTrash, parseId, TrashError, TRASH_DAYS };
