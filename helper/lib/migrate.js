'use strict';
// Moving a workspace from before 0.2.0 (when TRIF was called WebMods) from ~/.webmods to ~/.trif.
//
// `trif setup` runs this first whenever it's setting up the default workspace, including when an older
// helper's updater runs it (that passes --home ~/.webmods, which paths.js resolveHome reads as the
// default). The whole folder moves with one rename, mods, settings, trash, runs, the app copy and all,
// and ~/.webmods becomes a link to ~/.trif, so every old path keeps working:
//   - the older helper running the update: its tmp folder, the new version's own code (unpacked inside
//     ~/.webmods/.update-…), the install lock (~/.webmods/.app.lock, held by that helper and passed down
//     to this setup) and the state it writes afterwards are all reached through the link;
//   - Chrome loads an unpacked extension from the path it was given (~/.webmods/app/extension);
//   - native host manifests and the Safari bridge's agent written before (setup rewrites them, but a
//     browser setup didn't select may keep one);
//   - PATHs and /usr/local/bin links with ~/.webmods/bin in them.
// Running helpers keep working through the link (their sockets moved with the folder); each notices its
// workspace became a link (host.js checkHomeMoved, or for an older helper, its code changing on disk) and
// exits when idle so the browser starts a fresh one on ~/.trif.
//
// Idempotent. Cases (L = ~/.webmods, T = ~/.trif):
//   L missing                     nothing to do (a new install)
//   L a link to T                 nothing to do (already moved)
//   L a link elsewhere (the user keeps the workspace somewhere else), T missing: T becomes a link to the
//                                 same place; L is left as it is
//   L a link elsewhere, T exists  both left alone; T is used (a warning says so)
//   L a dangling link             replaced with a link to T
//   L a folder, T missing         L renamed to T, then L made a link to T
//   L a folder, T exists          L merged into T: what T lacks moves in; files identical in both, and what
//                                 setup rewrites anyway (AGENTS.md, CLAUDE.md, .claude/, bin/, app/), are
//                                 dropped when T has them; anything else in both (a mod edited differently in each, say)
//                                 stays T's, and L's copy is kept in T/old-webmods-<date>/ for the user to
//                                 look at. Then L becomes a link to T.
//   L a file                      left alone (a warning says so)

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');
const { lockPath, readLock, pidAlive } = require('./lock');
const { envVar } = require('./env');

// Rewritten by every setup: not worth keeping a second copy of.
const SETUP_OWNED = new Set(['AGENTS.md', 'CLAUDE.md', '.claude', 'bin', 'app']);
// A marker in T: this workspace came from ~/.webmods, so the link matters (doctor warns if it goes).
const MARKER = '.moved-from-webmods';

function lstat(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

function stamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sameFile(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch { return false; }
}

// A helper's socket left by a process that's gone: helper.sock or helper-<pid>.sock.
function deadSocket(file, st) {
  if (!st.isSocket()) return false;
  const m = /^helper-(\d+)\.sock$/.exec(path.basename(file));
  return m ? !pidAlive(Number(m[1])) : false;
}

/**
 * Move what's in dir `from` into dir `to`, recursively, where `to` lacks it. What's left in `from`
 * afterwards is what conflicted. Returns { moved: n, conflicts: [relative paths] }.
 */
function mergeInto(from, to, rel = '', out = { moved: 0, conflicts: [] }) {
  let names;
  try { names = fs.readdirSync(from); } catch { return out; }
  for (const name of names) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    const r = rel ? path.join(rel, name) : name;
    const s = lstat(src);
    if (!s) continue;
    const d = lstat(dest);
    // (When `to` lacks one, it moves in below like anything else: a helper may be running from L's app/.)
    if (!rel && d && SETUP_OWNED.has(name)) { fs.rmSync(src, { recursive: true, force: true }); continue; }
    if (deadSocket(src, s)) { fs.rmSync(src, { force: true }); continue; }
    if (!d) {
      fs.renameSync(src, dest);
      out.moved++;
    } else if (s.isDirectory() && d.isDirectory()) {
      mergeInto(src, dest, r, out);
      try { fs.rmdirSync(src); } catch { /* not empty: conflicts left in it */ }
    } else if (s.isFile() && d.isFile() && sameFile(src, dest)) {
      fs.rmSync(src, { force: true });
    } else if (s.isSocket() || name.endsWith('.lock')) {
      fs.rmSync(src, { force: true }); // T's own (a live helper's socket, a lock) wins
    } else {
      out.conflicts.push(r);
    }
  }
  return out;
}

/** Whether `dir` (L) is empty, or holds only an empty tree of folders. */
function emptyTree(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return true; }
  return names.every((n) => {
    const s = lstat(path.join(dir, n));
    return s && s.isDirectory() && emptyTree(path.join(dir, n));
  });
}

/**
 * Make `link` a symlink to `target` (relative, ".trif"). If something made `link` again in the meantime (a
 * running helper recreating its home folder in the instant it was missing), merge that in and try again.
 */
function makeLink(link, target, to, notes) {
  const rel = path.relative(path.dirname(link), target) || '.';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.symlinkSync(rel, link);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const s = lstat(link);
      if (s && s.isSymbolicLink()) {
        if (realOrNull(link) === realOrNull(target)) return true;
        fs.unlinkSync(link);
      } else if (s && s.isDirectory()) {
        const { conflicts } = mergeInto(link, to);
        if (conflicts.length || !emptyTree(link)) {
          const keep = path.join(to, `old-webmods-${stamp()}-${attempt}`);
          fs.renameSync(link, keep);
          notes.push(`kept what was in ${link} and also in ${to} in ${keep}`);
        } else {
          fs.rmSync(link, { recursive: true, force: true });
        }
      } else {
        return false;
      }
    }
  }
  return false;
}

/**
 * A live process other than this one's updater holds ~/.webmods' install lock: an install is going on
 * in the old folder right now, so moving it would pull it out from under that install.
 */
function lockedByOther(legacy, env) {
  const l = readLock(lockPath(path.join(legacy, P.APP_DIR_NAME)));
  if (!l || !pidAlive(l.pid) || l.pid === process.pid) return null;
  if (envVar('INSTALL_LOCK', env) && l.token === envVar('INSTALL_LOCK', env)) return null; // our parent: the updater
  return l.pid;
}

/**
 * Move ~/.webmods to ~/.trif (see the top of this file). Returns
 * { how, from, to, notes: [string], error: string|null }, how being one of 'none', 'already', 'moved',
 * 'merged', 'linked' (T made a link to where L points), 'relinked' (a dangling L pointed at T),
 * 'skipped' (left alone; see error).
 */
function migrateHome({ homedir = os.homedir(), env = process.env } = {}) {
  const from = P.legacyHome(homedir);
  const to = P.defaultHome(homedir);
  const notes = [];
  const result = (how, error = null) => ({ how, from, to, notes, error });
  const L = lstat(from);
  if (!L) return result('none');
  const T = lstat(to);

  if (L.isSymbolicLink()) {
    const real = realOrNull(from);
    if (real && T && real === realOrNull(to)) return result('already');
    if (!real) {
      if (!T) return result('skipped', `${from} is a link to a folder that doesn't exist; left it alone`);
      fs.unlinkSync(from);
      makeLink(from, to, to, notes);
      return result('relinked');
    }
    if (!fs.statSync(from).isDirectory()) return result('skipped', `${from} doesn't lead to a folder; left it alone`);
    if (T) {
      return result('skipped', `${from} and ${to} are both there, and ${from} is a link to ${real}: using ${to}, and leaving ${from} alone`);
    }
    fs.symlinkSync(real, to);
    notes.push(`${to} now links to ${real}, where ${from} leads`);
    return result('linked');
  }

  if (!L.isDirectory()) return result('skipped', `${from} isn't a folder; left it alone`);
  const busy = lockedByOther(from, env);
  if (busy) return result('skipped', `another install is going on in ${from} (process ${busy}); run setup again when it's done`);

  if (!T) {
    fs.renameSync(from, to);
    try { fs.writeFileSync(path.join(to, MARKER), `${from}\n`); } catch { /* only for doctor */ }
    if (!makeLink(from, to, to, notes)) notes.push(`couldn't make ${from} a link to ${to}; old paths won't work`);
    return result('moved');
  }

  const toIsDir = (() => { try { return fs.statSync(to).isDirectory(); } catch { return false; } })();
  if (!toIsDir) return result('skipped', `${to} is there but isn't a folder, so ${from} can't move into it; still using ${from}`);
  const { moved, conflicts } = mergeInto(from, to);
  if (conflicts.length || !emptyTree(from)) {
    const keep = path.join(to, `old-webmods-${stamp()}`);
    fs.renameSync(from, keep);
    notes.push(`both ${from} and ${to} had ${conflicts.length === 1 ? 'this' : 'these'}: ${conflicts.slice(0, 8).join(', ')}${conflicts.length > 8 ? ', …' : ''}. Kept ${to}'s; ${from}'s ${conflicts.length === 1 ? 'is' : 'are'} in ${keep}`);
  } else {
    fs.rmSync(from, { recursive: true, force: true });
  }
  try { fs.writeFileSync(path.join(to, MARKER), `${from}\n`); } catch { /* only for doctor */ }
  if (!makeLink(from, to, to, notes)) notes.push(`couldn't make ${from} a link to ${to}; old paths won't work`);
  if (moved) notes.push(`moved ${moved} item${moved === 1 ? '' : 's'} from ${from} into ${to}`);
  return result('merged');
}

/** setup's lines for a migration result ([] when there was nothing to do). */
function describeMigration(m) {
  const lines = [];
  const say = (s) => lines.push(s);
  if (m.how === 'moved') say(`moved         ${m.from} -> ${m.to} (TRIF was called WebMods; ${m.from} now links here, so old paths keep working)`);
  else if (m.how === 'merged') say(`moved         ${m.from} into ${m.to}, which was already there (${m.from} now links here)`);
  else if (m.how === 'linked') say(`linked        ${m.to} -> where ${m.from} leads`);
  else if (m.how === 'relinked') say(`linked        ${m.from} -> ${m.to}`);
  else if (m.how === 'skipped') say(`moving        ${m.error}`);
  for (const n of m.notes) say(`              ${n}`);
  return lines;
}

module.exports = { migrateHome, describeMigration, mergeInto, MARKER, SETUP_OWNED };
