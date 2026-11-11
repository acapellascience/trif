'use strict';
// Sharing mods, and the files a user adds to a site (the panel's Export and Import, its drag and drop,
// `trif export` / `trif import` / `trif add` / `trif files`). The helper never takes a path from a message:
// a mod is found by its id (lib/reveal.js modFile), a site by its name, a file by a name it cleans; what
// it writes is always inside the sites folder or the downloads folder.
//
// Export: the mod's file, copied to ~/Downloads/<site>-<mod>.js (a number added if taken), or all of a
// site's mods into a folder there. Import: a mod's text: its header must parse, its site comes from its
// @match (or the user says), it's written to sites/<site>/<name>.js, never over a mod without the user's
// choice (a copy, or Replace, which keeps the old one in history), without @source / @version (an import
// can't pose as one of Tim's shipped mods), and recorded as imported (imported.json), so it's held and
// switched like any mod from outside. Files: sites/<site>/files/<name>, bytes only, at most 50 MB, never
// over another; the mod scanner reads sites/<site>/*.js only, so nothing in files/ is ever a mod.

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { envVar } = require('./env');
const { modFile, revealPath } = require('./reveal');
const history = require('./history');
const mods = require('./mods');

class ShareError extends Error {}
// (a site's files have no size limit of their own: they come in slices, checked against the free disk space)
const SLICE_MAX = 8 * 1024 * 1024;
const DISK_MARGIN = 64 * 1024 * 1024; // (what stays free after a file)
const IMPORTED = 'imported.json';
// (a host name, a single label too: localhost is a site TRIF can be on)
const SITE_RE = /^(?:all-sites|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;

/** Where exports go: ~/Downloads (TRIF_DOWNLOADS, for tests). */
function downloadsDir(env = process.env) { return envVar('DOWNLOADS', env) || path.join(os.homedir(), 'Downloads'); }

function checkSite(site) {
  const s = String(site || '').trim().toLowerCase().replace(/^www\./, '');
  if (!SITE_RE.test(s)) throw new ShareError(`"${String(site).slice(0, 80)}" isn't a site (a host name like x.com)`);
  return s;
}

/** A name that's free in `dir`: name, then "name 2", "name 3"… (before the extension). */
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let n = 1;
  let out = name;
  while (fs.existsSync(path.join(dir, out))) out = `${stem} ${++n}${ext}`;
  return out;
}

const writeAtomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

// ---- export

/** The mod's file, copied to the downloads folder (or `to`): {id, file}. */
function exportMod(ws, list, id, { to = null, env = process.env } = {}) {
  const src = modFile(ws.modsDir, list, id);
  const [site, mod] = String(id).trim().split('/');
  const dir = to ? path.resolve(String(to)) : downloadsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const name = freeName(dir, `${site}-${mod}.js`);
  fs.copyFileSync(src, path.join(dir, name));
  return { id: `${site}/${mod}`, file: path.join(dir, name) };
}

/** Every mod of a site, copied into a folder "<site> mods" in the downloads folder (or `to`): {site, dir, ids}. */
function exportSite(ws, list, site, { to = null, env = process.env } = {}) {
  const s = checkSite(site);
  const ids = (list || []).filter((m) => m.id.startsWith(`${s}/`) && m.id.split('/').length === 2).map((m) => m.id);
  if (!ids.length) throw new ShareError(`no mods for ${s}`);
  const parent = to ? path.resolve(String(to)) : downloadsDir(env);
  fs.mkdirSync(parent, { recursive: true });
  const dir = path.join(parent, freeName(parent, `${s} mods`));
  fs.mkdirSync(dir);
  for (const id of ids) fs.copyFileSync(modFile(ws.modsDir, list, id), path.join(dir, `${id.split('/')[1]}.js`));
  return { site: s, dir, ids };
}

// ---- import

const hostOfMatch = (m) => {
  if (m === '<all_urls>') return '*';
  const x = /^(?:\*|https?|file|ftp):\/\/([^/]+)\//.exec(String(m));
  if (!x) return null;
  return x[1].toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
};

/** The sites a mod's @match lines name: one is its site; none or several, the user says (`candidates`). */
function sitesOf(text) {
  const h = mods.parseHeader(text);
  const hosts = [...new Set(h.matches.map(hostOfMatch).filter(Boolean))];
  if (hosts.includes('*')) return { site: null, candidates: ['all-sites', ...hosts.filter((x) => x !== '*')] };
  const ok = hosts.filter((x) => SITE_RE.test(x));
  return ok.length === 1 ? { site: ok[0], candidates: ok } : { site: null, candidates: ok };
}

/** The mod's text without the shipped-mod markers (@source, @version). */
function stripShipped(text) {
  return String(text).split(/\r?\n/).filter((l) => !/^\s*\/\/\s*@(source|version)\b/i.test(l)).join('\n');
}

const nameOf = (s) => String(s || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function loadImported(home) { try { const v = JSON.parse(fs.readFileSync(path.join(home, IMPORTED), 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
function markImported(home, id) { const v = loadImported(home); v[id] = { at: Date.now() }; writeAtomic(path.join(home, IMPORTED), `${JSON.stringify(v, null, 2)}\n`); }

/**
 * Import a mod's text. `name`: the file's name (or the mod's @name), `site`: the user's choice when its
 * @match doesn't say, `choice`: 'copy' or 'replace' when a mod of that name is there. Returns
 * {needsSite: [candidates]}, {exists: id, site, name}, or {id, file, replaced?}.
 */
function importMod(ws, { text, name = '', site = '', choice = '' } = {}) {
  const code = String(text ?? '');
  if (!code.trim()) throw new ShareError('the file is empty');
  if (Buffer.byteLength(code) > mods.MAX_MOD_BYTES) throw new ShareError(`the file is bigger than a mod can be (${mods.MAX_MOD_BYTES / 1024 / 1024} MB)`);
  const header = mods.parseHeader(code);
  if (!header.hasHeader) throw new ShareError('this file has no // ==WebMod== header, so it isn\'t a mod TRIF can read');
  let s = site ? checkSite(site) : null;
  if (!s) {
    const found = sitesOf(code);
    if (!found.site) return { needsSite: found.candidates };
    s = found.site;
  }
  let base = nameOf(name) || nameOf(header.name) || 'imported-mod';
  const dir = path.join(ws.modsDir, s);
  const clean = stripShipped(code);
  let file = path.join(dir, `${base}.js`);
  let replaced = false;
  if (fs.existsSync(file)) {
    if (choice === 'copy') {
      let n = 2;
      while (fs.existsSync(path.join(dir, `${base}-${n}.js`))) n++;
      base = `${base}-${n}`;
      file = path.join(dir, `${base}.js`);
    } else if (choice === 'replace') {
      history.writeEntry(ws, s, base, fs.readFileSync(file), Date.now(), 'import');
      replaced = true;
    } else return { exists: `${s}/${base}`, site: s, name: base };
  }
  // (the header must make a mod TRIF can run, as the scanner would build it)
  try { mods.buildMod({ site: s, file, code: clean }); } catch (e) { throw new ShareError(`this mod's header has a problem: ${e.message}`); }
  writeAtomic(file, clean);
  markImported(ws.home, `${s}/${base}`);
  return { id: `${s}/${base}`, file, ...(replaced ? { replaced: true } : {}) };
}

// ---- a site's files

const cleanFileName = (name) => {
  let n = String(name ?? '').split(/[\\/]/).pop().normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '');
  if (n.length > 120) { const ext = path.extname(n).slice(0, 12); n = n.slice(0, 120 - ext.length) + ext; }
  return n || 'file';
};
const filesDir = (ws, site) => path.join(ws.modsDir, checkSite(site), 'files');

/** Saves bytes as sites/<site>/files/<name> (a number added if taken): {site, name, rel, size}. */
function addFile(ws, { site, name, bytes }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const dir = filesDir(ws, site);
  fs.mkdirSync(dir, { recursive: true });
  const n = freeName(dir, cleanFileName(name));
  fs.writeFileSync(path.join(dir, n), buf, { flag: 'wx' });
  const s = checkSite(site);
  return { site: s, name: n, rel: `sites/${s}/files/${n}`, size: buf.length };
}

// A big file comes in slices: fileBegin checks there's room and opens a temp file in the site's files folder
// (a dot name: not listed, and the mod scanner reads only sites/<site>/*.js); fileSlice appends one, at the offset
// it says; fileEnd renames it into place, under a free name; fileAbort takes it away.
const uploads = new Map(); // id -> {site, name, size, tmp, written, at}
const UPLOAD_IDLE_MS = 10 * 60 * 1000;
const sizeWords = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
function freeSpace(dir, statfs = fs.statfsSync) {
  if (typeof statfs !== 'function') return Infinity;
  try { const s = statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
}
function dropIdleUploads(now = Date.now()) {
  for (const [id, u] of uploads) if (now - u.at > UPLOAD_IDLE_MS) { try { fs.unlinkSync(u.tmp); } catch { /* gone */ } uploads.delete(id); }
}
function fileBegin(ws, { site, name, size }, { statfs } = {}) {
  dropIdleUploads();
  const total = Number(size);
  if (!Number.isSafeInteger(total) || total < 0) throw new ShareError('that file has no size');
  const dir = filesDir(ws, site);
  fs.mkdirSync(dir, { recursive: true });
  const clean = cleanFileName(name);
  const free = freeSpace(dir, statfs === undefined ? fs.statfsSync : statfs);
  if (total + DISK_MARGIN > free) throw new ShareError(`${clean} is ${sizeWords(total)}, and there's only ${sizeWords(Math.max(0, free))} free on this disk`);
  const id = crypto.randomBytes(8).toString('hex');
  const tmp = path.join(dir, `.upload-${id}.tmp`);
  fs.writeFileSync(tmp, '', { flag: 'wx' });
  uploads.set(id, { site, name: clean, size: total, tmp, written: 0, at: Date.now() });
  return { id };
}
function fileSlice(ws, { id, offset, bytes }) {
  const u = uploads.get(String(id));
  if (!u) throw new ShareError('that upload has ended');
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length > SLICE_MAX) throw new ShareError('a slice is too big');
  if (Number(offset) !== u.written) throw new ShareError('a slice came out of order');
  if (u.written + buf.length > u.size) throw new ShareError('that file is bigger than it said');
  fs.appendFileSync(u.tmp, buf);
  u.written += buf.length;
  u.at = Date.now();
  return { written: u.written };
}
function fileEnd(ws, { id }) {
  const u = uploads.get(String(id));
  if (!u) throw new ShareError('that upload has ended');
  uploads.delete(String(id));
  if (u.written !== u.size) { try { fs.unlinkSync(u.tmp); } catch { /* gone */ } throw new ShareError(`${u.name} came only in part`); }
  const dir = path.dirname(u.tmp);
  const n = freeName(dir, u.name);
  fs.renameSync(u.tmp, path.join(dir, n));
  const s = checkSite(u.site);
  return { site: s, name: n, rel: `sites/${s}/files/${n}`, size: u.size };
}
function fileAbort(ws, { id }) {
  const u = uploads.get(String(id));
  if (u) { uploads.delete(String(id)); try { fs.unlinkSync(u.tmp); } catch { /* gone */ } }
  return { aborted: !!u };
}

/** A site's files: [{name, size, at}], newest first. */
function listFiles(ws, site) {
  const dir = filesDir(ws, site);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.')).map((n) => { const st = fs.statSync(path.join(dir, n)); return st.isFile() ? { name: n, size: st.size, at: st.mtimeMs } : null; })
    .filter(Boolean).sort((a, b) => b.at - a.at);
}

/** Removes a site's file (to the trash: trash/<site>/files/). */
function removeFile(ws, site, name) {
  const dir = filesDir(ws, site);
  const n = cleanFileName(name);
  const file = path.join(dir, n);
  if (n !== String(name) || !fs.existsSync(file)) throw new ShareError(`no file "${String(name).slice(0, 80)}" in ${checkSite(site)}'s files`);
  const to = path.join(ws.home, 'trash', checkSite(site), 'files');
  fs.mkdirSync(to, { recursive: true });
  fs.renameSync(file, path.join(to, freeName(to, n)));
  return { site: checkSite(site), name: n, removed: true };
}

/** Shows a site's files folder (made if it isn't there). */
function revealFiles(ws, site) {
  const dir = filesDir(ws, site);
  fs.mkdirSync(dir, { recursive: true });
  return revealPath(dir, 'folder', { open: true });
}

module.exports = { ShareError, SLICE_MAX, DISK_MARGIN, fileBegin, fileSlice, fileEnd, fileAbort, downloadsDir, exportMod, exportSite, sitesOf, stripShipped, importMod, loadImported, addFile, listFiles, removeFile, revealFiles, cleanFileName };
