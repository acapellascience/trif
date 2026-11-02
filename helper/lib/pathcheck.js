'use strict';
// "Is this path inside that folder?" for checks that are security boundaries (a run's file options, the
// mods folder, the folders a run may read or write). Comparing strings isn't enough:
//   - links: sites/x.com/a.js can be a link to ~/.ssh/id_rsa, and sites/x.com/link/.. isn't sites/;
//   - case: APFS (the macOS default) and NTFS ignore case, so /Users/tim/.TRIF/Config.json is
//     ~/.trif/config.json, while a string check (or Node's fs.realpathSync, which keeps the case it was
//     given) says it's somewhere else.
// So both paths are made real first with the operating system's realpath (fs.realpathSync.native, which on
// macOS also gives each existing component the case it has on disk), and a path that doesn't exist yet is
// the real path of its nearest existing parent plus the rest. Then they're compared with a separator
// boundary (/a/bc isn't inside /a/b), ignoring case (and Unicode normalization) on volumes that do.

const fs = require('fs');
const path = require('path');

function nativeReal(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/**
 * The real path of `p` (relative to the current folder if it isn't absolute), as far as it exists: the
 * operating system resolves every link and `..` in the existing part; the rest is added on as written
 * (`..` in it is resolved by name: there's nothing on disk to follow).
 */
function realish(p) {
  const s = String(p);
  let cur = path.isAbsolute(s) ? s : `${process.cwd()}${path.sep}${s}`;
  const rest = [];
  for (let i = 0; i < 4096; i++) {
    const r = nativeReal(cur);
    if (r) return rest.length ? path.join(r, ...rest.reverse()) : r;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.push(path.basename(cur));
    cur = parent;
  }
  return path.resolve(s);
}

// Whether names on the volume holding `dir` (a real, existing path) ignore case: cached per device.
// Checked by looking up the last component with its letters' case swapped; when that can't say (no
// letters, or nothing to look at), macOS and Windows count as ignoring case.
const caseCache = new Map();
function platformIgnoresCase(platform = process.platform) { return platform === 'darwin' || platform === 'win32'; }
function ignoresCase(dir) {
  let cur = dir;
  for (let i = 0; i < 4096; i++) {
    let st = null;
    try { st = fs.statSync(cur); } catch { /* go up */ }
    if (st) {
      if (caseCache.has(st.dev)) return caseCache.get(st.dev);
      const base = path.basename(cur);
      const swapped = base.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
      let v;
      if (swapped === base || base === '') v = platformIgnoresCase();
      else {
        try { const s2 = fs.statSync(path.join(path.dirname(cur), swapped)); v = s2.dev === st.dev && s2.ino === st.ino; } catch { v = false; }
      }
      caseCache.set(st.dev, v);
      return v;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return platformIgnoresCase();
}

function fold(s, ci) { return ci ? s.normalize('NFC').toLowerCase() : s; }

/**
 * Whether `child` is inside `parent` (both already real, e.g. from realish), `ci` saying whether to ignore
 * case. `orEqual`: the folder itself counts.
 */
function within(child, parent, { ci = false, orEqual = false } = {}) {
  const c = fold(child, ci);
  const p = fold(parent, ci);
  if (c === p) return orEqual;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}

/**
 * Whether `child` is inside `parent`: real paths (links and `..` resolved by the system), a separator
 * boundary, case ignored where the parent's volume ignores it. `orEqual`: the folder itself counts.
 */
function isInside(child, parent, { orEqual = false } = {}) {
  const p = realish(parent);
  return within(realish(child), p, { ci: ignoresCase(p), orEqual });
}

/** Whether two paths name the same place (real paths, case as the volume treats it). */
function samePath(a, b) {
  const rb = realish(b);
  return within(realish(a), rb, { ci: ignoresCase(rb), orEqual: true });
}

// File and folder names a site or mod may not have: they mean something else to a file system (Windows'
// reserved device names; a trailing dot or space, which Windows drops; `:`, the old Mac path separator and
// Windows' stream marker), or go somewhere else (`..`, separators, control characters).
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** Why `name` can't be a site or mod folder/file name ('' when it can). */
function badName(name) {
  const s = String(name ?? '');
  if (!s) return 'empty';
  if (s === '.' || s === '..') return 'not a name';
  if (/[/\\:\0-\x1f\x7f]/.test(s)) return 'has a character file names can\'t have (/ \\ : or a control character)';
  if (/[. ]$/.test(s)) return 'ends with a dot or a space';
  if (/^\s/.test(s)) return 'starts with a space';
  if (RESERVED.test(s)) return 'is a reserved name';
  if (s.length > 200) return 'is too long';
  return '';
}

module.exports = { realish, ignoresCase, within, isInside, samePath, badName, platformIgnoresCase };
