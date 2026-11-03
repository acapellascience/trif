'use strict';
// The Windows steps of `trif setup` (lib/setup.js calls these where macOS and Linux write #!/bin/sh
// wrappers, link the CLI into /usr/local/bin, or show a folder in Finder):
//   - wrappers: trif-host.bat, trif.cmd and trif for Git Bash (launchers.js);
//   - native messaging: each browser's registry key pointing at its manifest file (registry.js);
//   - PATH: <home>\bin added to the user's PATH (userpath.js);
//   - the extension folder shown in an Explorer window, its path on the clipboard.
// Each step takes its runners as options, so tests can run it anywhere.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const launchers = require('./launchers');
const registry = require('./registry');
const { addToUserPath } = require('./userpath');
const { nativeRegKeys } = require('../browsers');
const { systemExe } = require('../platform');

/** Writes the three wrappers; `write(file, content)` is setup's writeIfChanged. */
function writeWrappers(ws, { nodePath, hostJs, cliJs, home, write }) {
  write(ws.hostWrapper, launchers.hostBatContent(nodePath, hostJs, home));
  write(ws.cliWrapper, launchers.cliCmdContent(nodePath, cliJs, home));
  write(ws.cliShWrapper, launchers.cliShContent(nodePath, cliJs, home));
}

/**
 * Points browser `t`'s registry key(s) at manifest `file`. The first key is the browser's own and is
 * always set; any after it is one the browser is also said to read (Brave reads Chrome's): set only
 * when it isn't already pointing at a TRIF manifest that exists (another browser's), so the two don't
 * fight over it. Returns {keys: [key], error}.
 */
function registerNativeHost(t, file, opts = {}) {
  const keys = nativeRegKeys(t, opts);
  const done = [];
  for (const [i, key] of keys.entries()) {
    if (i > 0) {
      const cur = registry.getDefault(key, opts).value;
      if (cur && isTrifManifest(cur, t.nativeDir) && fs.existsSync(cur)) continue;
    }
    const error = registry.setDefault(key, file, opts);
    if (error) return { keys: done, error: `couldn't write the registry key ${key}: ${error}` };
    done.push(key);
  }
  return { keys: done, error: null };
}

/** Whether `file` is one of TRIF's manifests (in the NativeMessagingHosts folder beside `nativeDir`). */
function isTrifManifest(file, nativeDir) {
  const root = path.dirname(nativeDir).toLowerCase();
  const f = String(file).toLowerCase();
  return f.startsWith(root + path.sep) && f.endsWith('.json');
}

/**
 * Doctor's registry check for browser `t` whose manifest is `file`: null when fine, else what's wrong.
 * The browser's own key must name `file`; a key it's also said to read must name a TRIF manifest.
 */
function checkNativeHost(t, file, opts = {}) {
  const keys = nativeRegKeys(t, opts);
  for (const [i, key] of keys.entries()) {
    const { value } = registry.getDefault(key, opts);
    if (i === 0) {
      if (!value) return `the registry key ${key} is missing, so ${t.label} can't find the helper`;
      if (value.toLowerCase() !== String(file).toLowerCase()) return `the registry key ${key} points at ${value}, not ${file}`;
    } else if (!value || !isTrifManifest(value, t.nativeDir)) {
      return `the registry key ${key} ${value ? `points at ${value}` : 'is missing'} (${t.label} may read that one too)`;
    }
  }
  return null;
}

/** Setup's PATH step: lines to say. `noLink`: leave the user's PATH alone (updates pass --no-link). */
function userPathStep(ws, { noLink = false, pathEnv = process.env.PATH, add = addToUserPath } = {}) {
  const dirs = String(pathEnv || '').split(';').filter(Boolean).map((d) => d.replace(/[\\/]+$/, '').toLowerCase());
  const here = dirs.includes(ws.bin.replace(/[\\/]+$/, '').toLowerCase());
  if (noLink) {
    return here ? [] : ['', `PATH          ${ws.bin} is not on your PATH (left alone: --no-link). Run setup without --no-link to add it.`];
  }
  const r = add(ws.bin);
  if (r.error) {
    return ['', `PATH          couldn't add ${ws.bin} to your PATH: ${r.error}`,
      '              Add it yourself: Settings → System → About → Advanced system settings → Environment Variables.'];
  }
  if (r.how === 'added') return [`PATH          added ${ws.bin} to your PATH (open a new terminal to use trif)`];
  return here ? [] : [`PATH          ${ws.bin} is on your PATH (open a new terminal to use trif)`];
}

/** Selects `dir` in an Explorer window and copies its path. Returns whether Explorer was started. */
function revealFolder(dir, { run = spawnSync, env = process.env } = {}) {
  // clip.exe reads UTF-16 when the text starts with a byte order mark (a path may have any letters).
  try { run(systemExe('clip.exe', env), [], { input: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(dir, 'utf16le')]), windowsHide: true, timeout: 5000 }); } catch { /* no clipboard */ }
  // explorer.exe /select,"<path>": its own argument syntax, so passed as written. (It exits 1 even when
  // it worked.)
  try {
    const explorer = path.win32.join(path.win32.dirname(systemExe('x', env)), '..', 'explorer.exe');
    const r = run(explorer, [`/select,"${dir}"`], { windowsVerbatimArguments: true, timeout: 10000 });
    return !r.error;
  } catch { return false; }
}

module.exports = { writeWrappers, registerNativeHost, checkNativeHost, isTrifManifest, userPathStep, revealFolder };
