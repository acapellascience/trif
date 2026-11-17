'use strict';
// Mod files the user downloads (docs/SKILL-HANDOFF.md, option a): when the user has switched it on (config.json
// "watchDownloads": true, the panel's Settings), the helper looks in their downloads folder for new .js files with
// a // ==WebMod== header, and the panel offers each one: "Add this mod?". Add runs the import a dropped file runs
// (share.js importMod): the mod arrives switched off, and held when its code can act.
//
// What it does and doesn't:
//   - Reads only: the folder's names, and a new .js file's text (at most a mod's size) and where it came from. It
//     never moves, renames, changes or deletes anything there; Add writes a copy into TRIF's sites folder.
//   - Only files that appear after it started, finished downloading (no .crdownload/.part beside them, the size
//     steady for a moment), named *.js, with the header. Anything else is ignored and never read.
//   - One offer at a time, at most PER_HOUR shown in an hour; the rest wait (QUEUE_MAX of them, the newest kept).
//     Each file is offered once: what the user did with it (added, not now) is kept in the private folder
//     (downloads.json), shared by the helpers of every browser the user has, so a second browser doesn't offer
//     it again. "Ignore files from <site>" is kept there too.
//   - Where it came from: the address the browser recorded on the file, where the system keeps one (macOS: the
//     file's "where from" (kMDItemWhereFroms), and the quarantine record's app name; Linux: user.xdg.origin.url /
//     user.xdg.referrer.url). Only the site's name is shown, never the whole address (it can carry tokens).
//   - macOS protects the Downloads folder: the first read may make the system ask, in the browser's name (the
//     helper is the browser's: "“Google Chrome” would like to access files in your Downloads folder"). That
//     happens when the user switches this on, as reading starts then. Refused, or asked before and refused, the
//     folder can't be read (EPERM): the status says so, and how to allow it. All reads are asynchronous, so the
//     helper never waits on the question.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const mods = require('./mods');
const { previewMod } = require('./preview');

const POLL_MS = 3000;
const SETTLE_MS = 1500;
const PER_HOUR = 4;
const QUEUE_MAX = 10;
const KEEP_MS = 60 * 24 * 3600 * 1000; // (what the user did with a file: kept two months)
const PARTIAL = /\.(crdownload|part|download|partial|tmp)$/i;

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

function run(cmd, args, { input = null, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024, encoding: 'buffer' }, (err, stdout) => resolve(err ? null : stdout));
    if (input !== null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

/** The site an address names: its host, for http(s) and for a blob: address made by an http(s) page. */
function hostOf(url) {
  try {
    let u = new URL(String(url));
    if (u.protocol === 'blob:') u = new URL(String(url).slice(5));
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : null;
  } catch { return null; }
}

/**
 * Where a downloaded file came from, as the system recorded it: {from: site or null, app: the program that saved
 * it, or null}. Never throws.
 */
async function originOf(file, { platform = process.platform, exec = run } = {}) {
  const out = { from: null, app: null };
  try {
    if (platform === 'darwin') {
      const hex = await exec('/usr/bin/xattr', ['-px', 'com.apple.metadata:kMDItemWhereFroms', file]);
      if (hex) {
        const bplist = Buffer.from(String(hex).replace(/\s+/g, ''), 'hex');
        const json = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: bplist });
        const list = json ? JSON.parse(String(json)) : [];
        // ([the download's address, the page it came from]: the page first, as a blob's own address is the page's)
        if (Array.isArray(list)) out.from = hostOf(list[1]) || hostOf(list[0]) || null;
      }
      const q = await exec('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file]);
      const app = q ? String(q).trim().split(';')[2] : '';
      if (app && /^[\w .()-]{1,60}$/.test(app)) out.app = app;
    } else if (platform === 'linux') {
      for (const attr of ['user.xdg.referrer.url', 'user.xdg.origin.url']) {
        const v = await exec('getfattr', ['--only-values', '--absolute-names', '-n', attr, file]);
        const h = v && hostOf(String(v).trim());
        if (h) { out.from = h; break; }
      }
    }
  } catch { /* nothing recorded, or not readable */ }
  return out;
}

function readState(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { handled: v && typeof v.handled === 'object' && v.handled ? v.handled : {}, ignored: Array.isArray(v?.ignored) ? v.ignored.filter((s) => typeof s === 'string').slice(0, 200) : [] };
  } catch { return { handled: {}, ignored: [] }; }
}
function writeState(file, st, now) {
  const handled = Object.fromEntries(Object.entries(st.handled).filter(([, v]) => now - (v?.at || 0) < KEEP_MS));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ handled, ignored: st.ignored }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * A watcher over `dir`. `onChange(status)` when what the panel shows changes. `stateFile`: downloads.json in the
 * private folder. Returns {start, stop, status, take, done, ignore, poll (for tests)}.
 */
function createWatcher({ dir, stateFile, onChange = () => {}, log = () => {}, now = Date.now, origin = originOf, pollMs = POLL_MS, settleMs = SETTLE_MS, perHour = PER_HOUR, watchFs = true } = {}) {
  let on = false;
  let problem = null; // 'no-access' | 'missing' | other text
  let baseline = null; // names there when it started: never offered
  const seen = new Map(); // name -> {size, mtimeMs, since, done}
  const queue = [];
  let current = null;
  const shown = [];
  let timer = null;
  let watcher = null;
  let busy = false;

  const publicOffer = (o) => o && { id: o.id, file: o.name, from: o.from, app: o.app, name: o.preview.name, description: o.preview.description, kind: o.preview.kind, site: o.preview.site, can: o.preview.can, asks: o.preview.asks };
  const status = () => ({ on, state: !on ? 'off' : problem || (baseline ? 'watching' : 'starting'), folder: dir, offer: publicOffer(current), waiting: queue.length });
  const changed = () => { try { onChange(status()); } catch (e) { log('warn', `downloads: ${e.message}`); } };

  function pump() {
    if (current || !queue.length) return;
    const hourAgo = now() - 3600 * 1000;
    while (shown.length && shown[0] < hourAgo) shown.shift();
    if (shown.length >= perHour) return; // (the next poll after the hour comes round shows it)
    current = queue.shift();
    shown.push(now());
    changed();
  }

  async function consider(name) {
    const file = path.join(dir, name);
    let st;
    try { st = await fs.promises.lstat(file); } catch { seen.delete(name); return; }
    if (!st.isFile() || st.size === 0 || st.size > mods.MAX_MOD_BYTES) { if (st.isFile() && st.size > mods.MAX_MOD_BYTES) seen.set(name, { done: true }); return; }
    const was = seen.get(name);
    if (was && was.done) return;
    if (!was || was.size !== st.size || was.mtimeMs !== st.mtimeMs) { seen.set(name, { size: st.size, mtimeMs: st.mtimeMs, since: now() }); return; }
    if (now() - was.since < settleMs) return;
    was.done = true;
    const key = sha1(`${name}\n${st.size}\n${st.mtimeMs}`);
    const saved = readState(stateFile);
    if (saved.handled[key]) return;
    let text;
    try { text = await fs.promises.readFile(file, 'utf8'); } catch { return; }
    if (!/^\s*\/\/\s*==WebMod==\s*$/m.test(text)) return;
    let preview;
    try { preview = previewMod(text, { name }); } catch (e) { log('info', `downloads: ${name} isn't a mod TRIF can add (${e.message})`); return; }
    const from = await origin(file);
    if (from.from && saved.ignored.includes(from.from)) return;
    queue.push({ id: crypto.randomBytes(8).toString('hex'), key, name, file, sha1: sha1(text), size: st.size, preview, from: from.from, app: from.app, at: now() });
    while (queue.length > QUEUE_MAX) queue.shift();
    log('info', `downloads: ${name} is a mod${from.from ? ` from ${from.from}` : ''}: offering it`);
    changed();
  }

  async function poll() {
    if (!on || busy) return;
    busy = true;
    try {
      let names;
      try { names = await fs.promises.readdir(dir); } catch (e) {
        const p = e.code === 'EPERM' || e.code === 'EACCES' ? 'no-access' : e.code === 'ENOENT' ? 'missing' : e.message;
        if (p !== problem) { problem = p; log('warn', `downloads: can't read ${dir} (${e.code || e.message})`); changed(); }
        return;
      }
      if (problem) { problem = null; changed(); }
      // (added or put off in another browser's TRIF meanwhile: gone here too)
      if (current || queue.length) {
        const handled = readState(stateFile).handled;
        for (let i = queue.length - 1; i >= 0; i--) if (handled[queue[i].key]) queue.splice(i, 1);
        if (current && handled[current.key]) { current = null; changed(); }
      }
      if (!baseline) { baseline = new Set(names); changed(); return; }
      const here = new Set(names);
      for (const n of [...seen.keys()]) if (!here.has(n)) seen.delete(n);
      for (const name of names) {
        if (baseline.has(name) || name.startsWith('.') || !/\.js$/i.test(name) || PARTIAL.test(name)) continue;
        // (still downloading: Chrome's <name>.crdownload, Firefox's <name>.part, Safari's <name>.download)
        if (here.has(`${name}.part`) || here.has(`${name}.crdownload`) || here.has(`${name}.download`)) continue;
        await consider(name);
      }
      pump();
    } finally { busy = false; }
  }

  return {
    status,
    poll,
    async start() {
      if (on) return status();
      on = true; problem = null; baseline = null; seen.clear();
      changed();
      await poll();
      timer = setInterval(() => { poll().catch((e) => log('warn', `downloads: ${e.message}`)); }, pollMs);
      if (timer.unref) timer.unref();
      if (watchFs) try { watcher = fs.watch(dir, { persistent: false }, () => { poll().catch(() => {}); }); watcher.on('error', () => {}); } catch { watcher = null; }
      return status();
    },
    stop() {
      on = false; baseline = null; problem = null; queue.length = 0; current = null; seen.clear();
      if (timer) clearInterval(timer);
      timer = null;
      if (watcher) { try { watcher.close(); } catch { /* closed */ } }
      watcher = null;
      changed();
      return status();
    },
    /** The offer's file, read again: {text, name}, only if it's still what was offered. */
    async take(id) {
      if (!current || current.id !== String(id)) throw new Error('that offer is gone');
      const text = await fs.promises.readFile(current.file, 'utf8');
      if (sha1(text) !== current.sha1) throw new Error(`${current.name} changed since TRIF offered it`);
      return { text, name: current.name };
    },
    /** The user added it, or said not now: it isn't offered again; the next one comes. */
    done(id, how = 'dismissed') {
      if (!current || current.id !== String(id)) return status();
      const st = readState(stateFile);
      st.handled[current.key] = { at: now(), how: how === 'added' ? 'added' : 'dismissed' };
      try { writeState(stateFile, st, now()); } catch (e) { log('warn', `downloads: ${e.message}`); }
      current = null;
      changed();
      pump();
      return status();
    },
    /** Never offer files from the current offer's site again (that one included). */
    ignore(id) {
      if (!current || current.id !== String(id) || !current.from) return status();
      const st = readState(stateFile);
      if (!st.ignored.includes(current.from)) st.ignored.push(current.from);
      const from = current.from;
      st.handled[current.key] = { at: now(), how: 'ignored' };
      try { writeState(stateFile, st, now()); } catch (e) { log('warn', `downloads: ${e.message}`); }
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].from === from) queue.splice(i, 1);
      current = null;
      changed();
      pump();
      return status();
    },
  };
}

module.exports = { createWatcher, originOf, hostOf, PER_HOUR, QUEUE_MAX, POLL_MS };
