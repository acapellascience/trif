'use strict';
// "Keep TRIF on there" (the panel's one-time question after the update that made sensitive hosts sites of
// their own, extension/background.js "sensitive sites on upgrade"): the parent's mods that reached the host
// are copied into its own folder, sites/<host>/, as separate mods (same file names; a name already there
// keeps both, the copy with a suffix), with what was allowed for each, what TRIF last let run and any hold
// carried over to the copy's id. From then on each copy is a mod of its own: an edit to one doesn't touch
// the other. The extension carries the switches over (it keeps those).

const fs = require('fs');
const path = require('path');
const { loadAllowed, allowedFile, seenFile, heldFile, loadHeld, saveHeld } = require('./held');
const { scopeFor } = require('./scope');

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const NAME_RE = /^[\w][\w.-]*$/;

class SplitError extends Error {}

function loadJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function saveJson(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
function ranFile(home, id) { const [site, ...rest] = String(id).split('/'); return path.join(home, '.ran', site, `${rest.join('/')}.js`); }

/** A free name in `dir` for `base` (base, base-2, base-3…), not one of `taken`. */
function freeBase(dir, base, taken) {
  if (!fs.existsSync(path.join(dir, `${base}.js`)) && !taken.has(base)) return base;
  let n = 2;
  while (fs.existsSync(path.join(dir, `${base}-${n}.js`)) || taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Copy the mods `ids` (each `<site>/<name>`, in a folder of the host's parent domain) into sites/<host>/.
 * Returns {host, copies: [{from, to}]}. Mods that aren't there are skipped.
 */
function splitSensitive(ws, host, ids) {
  const h = String(host || '').trim().toLowerCase();
  if (!HOST_RE.test(h) || scopeFor(h) === h) throw new SplitError(`"${host}" isn't a part of a site that can be a site of its own`);
  const parent = scopeFor(h);
  const dir = path.join(ws.modsDir, h);
  const copies = [];
  const taken = new Set();
  for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 200)) {
    const [site, ...rest] = id.split('/');
    const name = rest.join('/');
    // (only mods of the parent domain's own folders, not the host's, and never a path)
    if (!site || !NAME_RE.test(name) || name.includes('/') || scopeFor(site) !== parent || site === h || site.endsWith(`.${h}`)) continue;
    const src = path.join(ws.modsDir, site, `${name}.js`);
    let text;
    try {
      const st = fs.lstatSync(src);
      if (!st.isFile()) continue; // (a link isn't copied: mods.js doesn't read those either)
      text = fs.readFileSync(src);
    } catch { continue; }
    fs.mkdirSync(dir, { recursive: true });
    const base = freeBase(dir, name, taken);
    taken.add(base);
    const file = path.join(dir, `${base}.js`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    copies.push({ from: id, to: `${h}/${base}` });
  }
  if (copies.length) carryRecords(ws.home, copies);
  return { host: h, copies };
}

// What was allowed for each mod, the version TRIF last let run (and its text), and a hold: to the copy too.
function carryRecords(home, copies) {
  const allowed = loadAllowed(home);
  const seen = loadJson(seenFile(home));
  const held = loadHeld(home);
  let a = false, s = false, hd = false;
  for (const { from, to } of copies) {
    if (allowed[from]) { allowed[to] = JSON.parse(JSON.stringify(allowed[from])); a = true; }
    if (seen[from]) { seen[to] = JSON.parse(JSON.stringify(seen[from])); s = true; }
    if (held[from]) { held[to] = { ...JSON.parse(JSON.stringify(held[from])), site: to.split('/')[0] }; hd = true; }
    try {
      const ran = fs.readFileSync(ranFile(home, from));
      fs.mkdirSync(path.dirname(ranFile(home, to)), { recursive: true });
      fs.writeFileSync(ranFile(home, to), ran);
    } catch { /* none kept */ }
  }
  if (a) saveJson(allowedFile(home), allowed);
  if (s) saveJson(seenFile(home), seen);
  if (hd) saveHeld(home, held);
}

module.exports = { splitSensitive, SplitError };
