'use strict';
// Renaming a mod (docs/PHONE-SYNC.md 2a, D17; Tim, 2026-11-18: "an edit-name ability when you go into the mod
// details"). The name is the header's @name; the file follows it (modid.js fileFor), and everything the helper keys by
// the mod's id moves with it, so the renamed mod is the same mod: what it was allowed, what last ran, a hold, its
// history. The browser's switches follow by its stable id (extension/lib.js findRenames), origins by host.js's scan.
//
//   renameMod(ws, {id, name}) -> {id, from, name, file, renamed}   the code card's Rename (and `trif rename`): the
//     @name line set, an @id line added if the mod has none, written at its new file, the old one removed. Only those
//     lines change, so nothing waits for an OK (held.js finds nothing new: the lines that use a power are the same).
//   moveKeys(ws, renames)   [{from, to}] mod ids: held.json, allowed.json, seen.json and its .ran/ copy, edits.json,
//     synced.json, switched-on.json, history/ entries. Idempotent: a key already moved (or never there) is left;
//     host.js calls it for every rename its scan sees (an agent's `mv`, a sync's move), before held.js judges.
//   moveFile(ws, from, toFile, text)   the file itself: the new one written whole (never over another), the old removed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = require('./modid');
const trash = require('./trash');

class RenameError extends Error {}

const parse = (id) => { const s = String(id || ''); const cut = s.indexOf('/'); return cut < 1 ? null : { site: s.slice(0, cut), mod: s.slice(cut + 1) }; };

function moveJsonKeys(file, renames) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  let changed = false;
  for (const { from, to } of renames) {
    if (!Object.prototype.hasOwnProperty.call(obj, from) || from === to) continue;
    if (!Object.prototype.hasOwnProperty.call(obj, to)) obj[to] = obj[from];
    delete obj[from];
    changed = true;
  }
  if (!changed) return false;
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return true;
}

function moveKeys(ws, renames) {
  const list = (renames || []).filter((r) => r && parse(r.from) && parse(r.to) && r.from !== r.to);
  if (!list.length) return 0;
  let n = 0;
  for (const f of ['held.json', 'allowed.json', 'seen.json', 'edits.json', 'synced.json', 'switched-on.json']) {
    try { if (moveJsonKeys(path.join(ws.home, f), list)) n++; } catch { /* the next look */ }
  }
  for (const { from, to } of list) {
    const a = parse(from);
    const b = parse(to);
    // (what last ran: while a change waits it's what runs, and "Don't allow" puts it back)
    const ranFrom = path.join(ws.home, '.ran', a.site, `${a.mod}.js`);
    const ranTo = path.join(ws.home, '.ran', b.site, `${b.mod}.js`);
    try { if (fs.existsSync(ranFrom) && !fs.existsSync(ranTo)) { fs.mkdirSync(path.dirname(ranTo), { recursive: true }); fs.renameSync(ranFrom, ranTo); n++; } } catch { /* kept */ }
    // (history: <site>/<mod>@<stamp>.js|.created|.source)
    const hFrom = path.join(ws.home, 'history', a.site);
    let names = [];
    try { names = fs.readdirSync(hFrom); } catch { /* none */ }
    for (const name of names) {
      if (!name.startsWith(`${a.mod}@`)) continue;
      const rest = name.slice(a.mod.length);
      if (!/^@\d{8}T\d{9}Z\.(js|created|source)$/.test(rest)) continue;
      const dir = path.join(ws.home, 'history', b.site);
      try { fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(path.join(dir, `${b.mod}${rest}`))) { fs.renameSync(path.join(hFrom, name), path.join(dir, `${b.mod}${rest}`)); n++; } } catch { /* kept */ }
    }
  }
  return n;
}

/** The mod's file `from` (a mod id) to `toFile` in the same folder, with `text`: written whole first (never over a file that's there), then the old one removed. */
function moveFile(ws, from, toFile, text) {
  const a = parse(from);
  const dir = path.join(ws.modsDir, a.site);
  const target = path.join(dir, toFile);
  const source = path.join(dir, `${a.mod}.js`);
  // (the same file: the name now, or only its capitals changing on a disk that ignores them)
  const ino = (p) => { try { return fs.statSync(p).ino; } catch { return null; } };
  const same = path.basename(target) === path.basename(source) || (ino(target) !== null && ino(target) === ino(source));
  const tmp = path.join(dir, `.rename-${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  try {
    if (same) { fs.renameSync(tmp, target); if (path.basename(target) !== path.basename(source) && fs.existsSync(source) && ino(source) !== ino(target)) fs.unlinkSync(source); }
    else {
      if (fs.existsSync(target)) throw new RenameError(`there's a mod at ${a.site}/${toFile} already`);
      fs.linkSync(tmp, target); // (never over a file that's there)
      fs.unlinkSync(tmp);
      fs.unlinkSync(source);
    }
  } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
  return `${a.site}/${toFile.replace(/\.js$/, '')}`;
}

/** The code card's Rename. See the top of this file. */
function renameMod(ws, { id, name }) {
  const why = M.checkName(name);
  if (why) throw new RenameError(why.charAt(0).toUpperCase() + why.slice(1));
  const f = parse(id);
  if (!f) throw new RenameError(`there's no mod ${id}`);
  const { site, mod } = trash.parseId(id);
  const dir = path.join(ws.modsDir, site);
  const file = path.join(dir, `${mod}.js`);
  let st;
  try { st = fs.lstatSync(file); } catch { throw new RenameError(`there's no mod ${site}/${mod}`); }
  if (!st.isFile()) throw new RenameError(`${site}/${mod} isn't a plain file: rename it where it is`);
  const current = fs.readFileSync(file, 'utf8');
  if (!M.readMeta(current).header) throw new RenameError(`${site}/${mod} has no ==WebMod== header to keep a name in`);
  const meta = M.readMeta(current);
  // (a copied file's id isn't its own: mods.js scanMods gives an id to the first file by name only)
  let uid = meta.uid;
  if (uid) {
    for (const other of fs.readdirSync(dir).sort()) {
      if (!other.endsWith('.js') || other === `${mod}.js` || other >= `${mod}.js`) continue;
      try { if (M.readMeta(fs.readFileSync(path.join(dir, other), 'utf8')).uid === uid) { uid = null; break; } } catch { /* unreadable */ }
    }
  }
  const text = M.withMeta(current, { name: name.trim(), uid: uid || M.newId() });
  const taken = fs.readdirSync(dir).filter((x) => x.endsWith('.js') && !x.startsWith('.') && !x.startsWith('_'));
  const toFile = M.fileFor(name, taken, `${mod}.js`);
  const to = `${site}/${toFile.replace(/\.js$/, '')}`;
  if (text === current && to === `${site}/${mod}`) return { id: to, from: id, name: name.trim(), file: toFile, renamed: false };
  if (to !== `${site}/${mod}`) moveKeys(ws, [{ from: `${site}/${mod}`, to }]);
  moveFile(ws, `${site}/${mod}`, toFile, text);
  return { id: to, from: `${site}/${mod}`, name: name.trim(), file: toFile, renamed: true };
}

module.exports = { renameMod, moveKeys, moveFile, RenameError };
