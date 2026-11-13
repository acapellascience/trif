'use strict';
// A side-panel run's own copy of the workspace (docs/STAGING.md). The agent works in it (its working
// folder: the guides, `.shipped/`, and `sites/` with the mods it may change), and its sandbox lets it write
// only the copy's `sites/`, never the user's mods folder. The helper copies what the run changes there into
// the mods folder (push), and what changes in the mods folder meanwhile into the copy (pull: a mod the run
// deleted with `trif delete`, the user's own edit), as it happens, so the browser has each mod the moment
// it's saved. So which changes are the run's is a fact (`written`: what the helper copied in for it), not
// worked out afterwards from snapshots and a time window; and once the run has ended nothing in its copy
// is read again: a process it left behind writes nowhere.
//
//   sites/<own site>/...     every file, files/ included: the run's site's folders (and a sensitive site of
//                            its own's), and all-sites/. Changes go to the mods folder.
//   sites/<other site>/...   every file but files/, to read: the sandboxes make these folders read-only, and
//                            a change found in one anyway isn't copied.
//   sites/<new folder>/      a folder for another site the run makes (as today, its mods are held).
// Never copied either way: links, files with other names (hard links), names TRIF doesn't take
// (pathcheck.js), files agents read as instructions (CLAUDE.md, AGENTS.md, .claude/, .codex/...), files
// directly in sites/, and .git and node_modules folders.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scopeFor, scopeOf } = require('./scope');
const { within, ignoresCase, unsafeName, badName } = require('./pathcheck');

const ALL_SITES = 'all-sites';
// Files an agent reads as instructions for the folder they're in (runs.js instructionFiles).
const INSTRUCTION_NAME = /^(CLAUDE(\.local)?\.md|AGENTS(\.override)?\.md|GEMINI\.md|\.claude|\.codex|\.cursorrules|\.cursor)$/i;
// The workspace's files a run reads, copied into its working folder (`.claude/settings.json` is written:
// Claude Code's project settings, as `trif setup` writes them).
const DOCS = ['AGENTS.md', 'TECHNIQUES.md', 'BOXED.md', 'CLAUDE.md', 'instructions.md'];
const SKIP_DIR = /^(\.git|node_modules)$/;
const MAX_DEPTH = 6; // below sites/<site>/
const MAX_FILES = 20000;

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const statKey = (st) => `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;

/** Whether the folder `name` under sites/ is the run's own (its site, a part of it, or all-sites/). */
function ownFolder(name, scope, splits = []) {
  if (name === ALL_SITES) return true;
  return scopeOf(name, [...splits, ...(scope !== scopeFor(scope) ? [scope] : [])]) === scope;
}

// Why a path under sites/ (`parts`: its names) is never staged, or ''.
function nameRefused(parts) {
  if (parts.length < 2) return 'a file directly in sites/';
  if (parts.length > MAX_DEPTH + 1) return 'too deep';
  for (const p of parts) {
    if (unsafeName(p) || badName(p)) return `the name ${JSON.stringify(p.slice(0, 80))} isn't one TRIF takes`;
    if (INSTRUCTION_NAME.test(p)) return `${p} is a file agents read as instructions`;
  }
  return '';
}

/**
 * Every regular file under `root` (a plain folder), as rel -> fs.Stats, walking plain folders only (links,
 * and folders `skipDir(parts)` says, aren't followed). `want(parts)` decides for each file.
 */
function walk(root, { want = (parts) => !nameRefused(parts), skipDir = () => false } = {}) {
  const out = new Map();
  const go = (dir, parts) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      const here = [...parts, e.name];
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        // (not .git, nor node_modules below a site's folder: sites/node_modules/ is a site folder to the scanner)
        if (here.length <= MAX_DEPTH && !(SKIP_DIR.test(e.name) && (e.name === '.git' || here.length > 1)) && !INSTRUCTION_NAME.test(e.name) && !skipDir(here)) go(p, here);
        continue;
      }
      if (!e.isFile() || !want(here)) continue;
      const st = lstatOrNull(p);
      if (st && st.isFile()) out.set(here.join(path.sep), st);
    }
  };
  go(root, []);
  return out;
}

// The real path of `dir` is `root` + `rel` (no link on the way), compared as the volume does.
function plainUnder(root, rel, ci) {
  let real;
  try { real = fs.realpathSync.native(path.join(root, rel)); } catch { return false; }
  const want = path.join(root, rel);
  return within(real, want, { ci, orEqual: true }) && within(want, real, { ci, orEqual: true });
}

/**
 * A file's bytes, only if it's a plain file with one name, reached through plain folders from `root` (a
 * real path): opened without following a link, then its real path checked and matched to what was opened.
 * Throws otherwise. (The run can swap a folder of its copy for a link, or make a hard link there to a file
 * it may not read: the helper, which no sandbox limits, mustn't read through either.)
 */
function readPlain(root, rel, ci) {
  const file = path.join(root, rel);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('not a file');
    if (st.nlink > 1) throw new Error('a file with more than one name (a hard link)');
    if (!plainUnder(root, rel, ci)) throw new Error('reached through a link');
    const rst = lstatOrNull(file);
    if (!rst || rst.ino !== st.ino || rst.dev !== st.dev) throw new Error('changed while it was read');
    return { buf: fs.readFileSync(fd), st };
  } finally { fs.closeSync(fd); }
}

// Makes the folders of `rel` under `root` (real), each a plain folder: a link or a file on the way refuses.
function plainFolders(root, rel) {
  let dir = root;
  for (const p of rel.split(path.sep).slice(0, -1)) {
    dir = path.join(dir, p);
    const st = lstatOrNull(dir);
    if (!st) fs.mkdirSync(dir);
    else if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${path.relative(root, dir)} isn't a folder`);
  }
  return dir;
}

/** Writes `buf` as `root`/`rel` (a new file, then renamed into place), never through a link. */
function writePlain(root, rel, buf, ci) {
  const dir = plainFolders(root, rel);
  const target = path.join(root, rel);
  const st = lstatOrNull(target);
  if (st && !st.isFile()) throw new Error('not a file there');
  const tmp = path.join(dir, `.trif-stage-${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, buf, { flag: 'wx', mode: 0o644 });
  // (the folder swapped for a link meanwhile: the new file isn't where it should be)
  if (!plainUnder(root, path.dirname(rel) === '.' ? '' : path.dirname(rel), ci)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw new Error('reached through a link'); }
  fs.renameSync(tmp, target);
}

function removePlain(root, rel, ci) {
  const st = lstatOrNull(path.join(root, rel));
  if (!st) return;
  if (!st.isFile() && !st.isSymbolicLink()) throw new Error('not a file');
  if (!plainUnder(root, path.dirname(rel) === '.' ? '' : path.dirname(rel), ci)) throw new Error('reached through a link');
  fs.unlinkSync(path.join(root, rel));
}

function copyTree(from, to) {
  for (const [rel] of walk(from)) {
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, rel), dest, fs.constants.COPYFILE_FICLONE);
  }
}

class Stage {
  /**
   * ws: the workspace; dir: the run's working folder (made here, fresh); scope, splits: the run's;
   * liveReal: the mods folder's real path (runs.js checkModsFolder); settings: the text of the copy's
   * .claude/settings.json.
   */
  constructor({ ws, dir, scope, splits = [], liveReal, settings = null, logger = null }) {
    this.ws = ws;
    this.scope = scope;
    this.splits = splits;
    this.logger = logger || { info() {}, warn() {} };
    this.settings = settings;
    this.dirPath = dir;
    this.liveReal = liveReal;
    this.closed = false;
    this.entries = new Map(); // rel (under sites/) -> {s, l}: the copy's and the mods folder's sha1 at the last sync (null: no file)
    this.cache = { s: new Map(), l: new Map() }; // rel -> {key, hash}
    this.otherAtStart = new Set(); // other sites' folders there when the run started: read-only
    this.newFolders = new Set(); // folders for other sites this run made
    this.created = new Set(); // rels this run made (none in the mods folder when it wrote them)
    this.written = new Map(); // path relative to the workspace (as held.js names mods) -> sha1 the run put there
    this.touched = new Set(); // paths relative to the workspace the run changed (pushes, and its trif delete/restore)
    this.refused = new Map(); // rel -> why (said once in the log)
  }

  /** Makes the working folder and copies what the run may read and change into it. */
  create() {
    fs.mkdirSync(this.dirPath, { mode: 0o700 }); // (fresh: not recursive, so it can't already be anything)
    this.dir = fs.realpathSync.native(this.dirPath);
    this.ci = ignoresCase(this.dir);
    this.liveCi = ignoresCase(this.liveReal);
    this.sites = path.join(this.dir, 'sites');
    fs.mkdirSync(this.sites);
    for (const name of DOCS) {
      const from = path.join(this.ws.home, name);
      const st = lstatOrNull(from);
      if (st && st.isFile()) fs.copyFileSync(from, path.join(this.dir, name), fs.constants.COPYFILE_FICLONE);
    }
    if (this.settings !== null) {
      fs.mkdirSync(path.join(this.dir, '.claude'));
      fs.writeFileSync(path.join(this.dir, '.claude', 'settings.json'), this.settings);
    }
    const shipped = path.join(this.ws.home, '.shipped');
    const sst = lstatOrNull(shipped);
    if (sst && sst.isDirectory()) copyTree(shipped, path.join(this.dir, '.shipped'));
    let names = [];
    try { names = fs.readdirSync(this.liveReal, { withFileTypes: true }); } catch { /* none yet */ }
    for (const d of names) {
      if (!d.isDirectory() || nameRefused([d.name, 'x'])) continue;
      fs.mkdirSync(path.join(this.sites, d.name)); // (every site folder, an empty one too)
      if (!ownFolder(d.name, this.scope, this.splits)) this.otherAtStart.add(d.name);
    }
    for (const [rel, st] of this._walkLive()) {
      let buf;
      try { buf = this._readLive(rel, st); } catch { continue; }
      plainFolders(this.sites, rel);
      fs.writeFileSync(path.join(this.sites, rel), buf, { flag: 'wx', mode: 0o644 });
      const h = sha1(buf);
      const cst = lstatOrNull(path.join(this.sites, rel));
      if (cst) this.cache.s.set(rel, { key: statKey(cst), hash: h });
      this.entries.set(rel, { s: h, l: h });
    }
    return this;
  }

  /** The workspace-relative path held.js and history.js name `rel` (under sites/) by. */
  homeRel(rel) { return path.relative(this.ws.home, path.join(this.ws.modsDir, rel)); }

  // The mods folder's files this copy follows: every site folder there but another site's files/, and
  // another site's folder that wasn't there when the run started (unless the run made it).
  _walkLive() {
    return walk(this.liveReal, {
      skipDir: (parts) => {
        const site = parts[0];
        if (parts.length === 1) {
          if (nameRefused([site, 'x'])) return true;
          return !(ownFolder(site, this.scope, this.splits) || this.otherAtStart.has(site) || this.newFolders.has(site));
        }
        return parts.length === 2 && parts[1] === 'files' && !ownFolder(site, this.scope, this.splits) && !this.newFolders.has(site);
      },
    });
  }

  _walkStage() {
    // (files TRIF won't copy are found too, so that their refusal is logged)
    return walk(this.sites, {
      want: () => true,
      skipDir: (parts) => parts.length === 2 && parts[1] === 'files' && this.otherAtStart.has(parts[0]),
    });
  }

  _readLive(rel, st) {
    const fd = fs.openSync(path.join(this.liveReal, rel), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const fst = fs.fstatSync(fd);
      if (!fst.isFile() || (st && (fst.ino !== st.ino || fst.dev !== st.dev))) throw new Error('changed');
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  }

  // sha1 of each file found, by its stat (read again only when that changes). which: 's' (the copy) or 'l'.
  // One that can't be read is in `out.failed` (taken as unchanged: never as deleted).
  _hashes(which, found) {
    const cache = this.cache[which];
    const out = new Map();
    out.failed = new Set();
    for (const [rel, st] of found) {
      const key = statKey(st);
      const hit = cache.get(rel);
      if (hit && hit.key === key) { out.set(rel, hit.hash); continue; }
      try {
        const buf = which === 's' ? readPlain(this.sites, rel, this.ci).buf : this._readLive(rel, st);
        const hash = sha1(buf);
        cache.set(rel, { key, hash });
        out.set(rel, hash);
      } catch (e) {
        out.failed.add(rel);
        if (which === 's') this._refuse(rel, e.message);
      }
    }
    for (const rel of cache.keys()) if (!found.has(rel)) cache.delete(rel);
    return out;
  }

  _refuse(rel, why) {
    if (this.refused.get(rel) === why) return;
    this.refused.set(rel, why);
    this.logger.warn(`run copy ${path.basename(this.dir || this.dirPath)}: sites/${rel.split(path.sep).join('/')} not copied to the mods folder: ${why}`);
  }

  // Why the run's change to `rel` isn't copied to the mods folder, or ''.
  _pushRefused(rel) {
    const parts = rel.split(path.sep);
    const why = nameRefused(parts);
    if (why) return why;
    const site = parts[0];
    if (ownFolder(site, this.scope, this.splits) || this.newFolders.has(site)) return '';
    if (this.otherAtStart.has(site)) return `${site} is another site's folder`;
    const st = lstatOrNull(path.join(this.liveReal, site));
    if (st) return `${site} is another site's folder`; // (made meanwhile, not by this run)
    return '';
  }

  /**
   * Copies the run's changes to the mods folder, and the mods folder's to the copy. `touch`: count what
   * comes from the mods folder as the run's doing too (its own `trif delete` or `trif restore`, done by the
   * helper). Returns {pushed, pulled, refused}: paths relative to the workspace.
   */
  sync({ touch = false } = {}) {
    const res = { pushed: [], pulled: [], refused: [] };
    if (this.closed || !this.dir) return res;
    const stageNow = this._hashes('s', this._walkStage());
    const liveFound = this._walkLive();
    const liveNow = this._hashes('l', liveFound);
    const rels = new Set([...this.entries.keys(), ...stageNow.keys(), ...liveNow.keys()]);
    for (const rel of [...rels].sort()) {
      const e = this.entries.get(rel) || { s: null, l: null };
      const s = stageNow.has(rel) ? stageNow.get(rel) : stageNow.failed.has(rel) ? e.s : null;
      const l = liveNow.has(rel) ? liveNow.get(rel) : liveNow.failed.has(rel) ? e.l : null;
      if (s !== e.s) {
        if (s === l) { this._set(rel, s, l); continue; }
        const why = this._pushRefused(rel);
        if (why) {
          this._refuse(rel, why);
          res.refused.push(this.homeRel(rel));
          // (a file it may not delete: back in its copy)
          if (s === null && l !== null) { if (this._pull(rel, l)) this._set(rel, l, l); } else this._set(rel, s, l);
          continue;
        }
        try {
          if (s === null) this._deleteLive(rel, l);
          else this._writeLive(rel, s, l !== e.l ? l : undefined);
        } catch (err) {
          this._refuse(rel, err.message);
          res.refused.push(this.homeRel(rel));
          // (a mod it may not delete, trif delete's rule: back in its copy; anything else is tried again)
          if (s === null && l !== null && err.trash) { if (this._pull(rel, l)) this._set(rel, l, l); }
          continue;
        }
        this.refused.delete(rel);
        const site = rel.split(path.sep)[0];
        if (!ownFolder(site, this.scope, this.splits) && !this.otherAtStart.has(site)) this.newFolders.add(site);
        const hr = this.homeRel(rel);
        if (s === null) { this.written.delete(hr); this.created.delete(rel); } else { this.written.set(hr, s); if (l === null) this.created.add(rel); }
        this.touched.add(hr);
        res.pushed.push(hr);
        this._set(rel, s, s);
      } else if (l !== e.l) {
        // Changed in the mods folder (the user, the helper for this run, another browser), not in the copy
        // since the last sync: the copy follows. (Only the folders it follows: _walkLive.)
        // (couldn't: tried again at the next sync)
        if (this._pull(rel, l)) {
          res.pulled.push(this.homeRel(rel));
          if (touch) this.touched.add(this.homeRel(rel));
          this._set(rel, l, l);
        }
      }
    }
    return res;
  }

  _set(rel, s, l) {
    if (s === null && l === null) this.entries.delete(rel);
    else this.entries.set(rel, { s, l });
  }

  // The run's version of `rel` into the mods folder. `theirs`: the mods folder's version changed since the
  // last sync (someone else's edit): kept in history before it's replaced.
  _writeLive(rel, hash, theirs) {
    const { buf } = readPlain(this.sites, rel, this.ci);
    if (sha1(buf) !== hash) throw new Error('changed again while it was copied (copied at the next sync)');
    const m = this._modOf(rel);
    if (theirs !== undefined && theirs !== null && m) {
      try { require('./history').writeEntry(this.ws, m.site, m.mod, fs.readFileSync(path.join(this.liveReal, rel)), Date.now(), 'chat'); } catch { /* not kept */ }
    }
    writePlain(this.liveReal, rel, buf, this.liveCi);
    const st = lstatOrNull(path.join(this.liveReal, rel));
    if (st) this.cache.l.set(rel, { key: statKey(st), hash });
  }

  // The run deleted `rel` in its copy: a mod goes to the trash (as `trif delete`: only one that stays on
  // the run's site, unless this run made it), any other file to trash/<site>/files/ (one the run made: gone).
  _deleteLive(rel, l) {
    if (l === null) return;
    const trash = require('./trash');
    const m = this._modOf(rel);
    const mine = this.created.has(rel);
    if (m) {
      try {
        trash.deleteMod(this.ws, `${m.site}/${m.mod}`, mine ? {} : { scope: this.scope, splits: this.splits });
      } catch (e) { throw Object.assign(new Error(e.message), { trash: e instanceof trash.TrashError }); }
    } else if (mine) {
      removePlain(this.liveReal, rel, this.liveCi);
    } else {
      const parts = rel.split(path.sep);
      const to = path.join(this.ws.home, 'trash', parts[0], 'files');
      fs.mkdirSync(to, { recursive: true });
      const base = parts.slice(parts[1] === 'files' && parts.length > 2 ? 2 : 1).join('_');
      let name = base;
      for (let n = 2; fs.existsSync(path.join(to, name)); n++) name = `${n}-${base}`;
      if (!plainUnder(this.liveReal, path.dirname(rel), this.liveCi)) throw new Error('reached through a link');
      fs.renameSync(path.join(this.liveReal, rel), path.join(to, name));
    }
    this.cache.l.delete(rel);
  }

  // The mods folder's version of `rel` (null: none) into the copy. False when it couldn't be.
  _pull(rel, l) {
    try {
      if (l === null) removePlain(this.sites, rel, this.ci);
      else {
        const buf = this._readLive(rel);
        writePlain(this.sites, rel, buf, this.ci);
        const st = lstatOrNull(path.join(this.sites, rel));
        if (st) this.cache.s.set(rel, { key: statKey(st), hash: sha1(buf) });
      }
      return true;
    } catch (e) {
      this.logger.warn(`run copy ${path.basename(this.dir)}: couldn't bring sites/${rel.split(path.sep).join('/')} into the run's copy: ${e.message}`);
      return false;
    }
  }

  _modOf(rel) {
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || !parts[1].endsWith('.js') || parts[1] === '.js' || /^[_.]/.test(parts[0]) || /^[_.]/.test(parts[1])) return null;
    return { site: parts[0], mod: parts[1].slice(0, -3) };
  }

  /** No more syncs; the copy is removed. What a process of the run writes there from now on goes nowhere. */
  close() {
    this.closed = true;
    try { fs.rmSync(this.dirPath, { recursive: true, force: true }); } catch { /* the sweep of old boxes takes it */ }
  }
}

module.exports = { Stage, ownFolder, nameRefused, readPlain, writePlain, INSTRUCTION_NAME, ALL_SITES, DOCS };
