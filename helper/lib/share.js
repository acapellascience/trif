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
const os = require('os');
const path = require('path');
const { envVar } = require('./env');
const { modFile, revealPath } = require('./reveal');
const history = require('./history');
const mods = require('./mods');

class ShareError extends Error {}
const MAX_FILE = 50 * 1024 * 1024;
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
  if (buf.length > MAX_FILE) throw new ShareError(`${cleanFileName(name)} is ${(buf.length / 1024 / 1024).toFixed(1)} MB: a site's files can be up to ${MAX_FILE / 1024 / 1024} MB each`);
  const dir = filesDir(ws, site);
  fs.mkdirSync(dir, { recursive: true });
  const n = freeName(dir, cleanFileName(name));
  fs.writeFileSync(path.join(dir, n), buf, { flag: 'wx' });
  const s = checkSite(site);
  return { site: s, name: n, rel: `sites/${s}/files/${n}`, size: buf.length };
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

module.exports = { ShareError, MAX_FILE, downloadsDir, exportMod, exportSite, sitesOf, stripShipped, importMod, loadImported, addFile, listFiles, removeFile, revealFiles, cleanFileName };
