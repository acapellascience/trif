'use strict';
// Native messaging registration on Windows. Browsers there don't look in folders for native host
// manifests: each looks up a registry key named after the host, whose default value is the manifest
// file's full path. Per user (no admin needed), under HKEY_CURRENT_USER:
//   Chrome     HKCU\Software\Google\Chrome\NativeMessagingHosts\com.webmods.helper
//   Chromium   HKCU\Software\Chromium\NativeMessagingHosts\...
//   Edge       HKCU\Software\Microsoft\Edge\NativeMessagingHosts\...   (Edge also reads Chromium's and Chrome's)
//   Brave      HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\...   (unverified: Brave is
//              reported to read Chrome's key too, so setup writes both for it)
//   Firefox    HKCU\Software\Mozilla\NativeMessagingHosts\...
// (browsers.js has which keys each browser gets.) The manifests themselves are files setup writes as on
// the other systems, in %LOCALAPPDATA%\TRIF\NativeMessagingHosts\<browser>.
//
// Written and read with Windows' own reg.exe (%SystemRoot%\System32\reg.exe, never one from PATH): no
// native module, and nothing secret goes through it. Synchronous, like setup.
//
// TRIF_REG_ROOT (tests): the key that stands in for HKCU\Software, e.g. HKCU\Software\TRIF-test-1234, so a
// test on a real Windows computer never touches the browsers' real keys. TRIF_REG_BIN: a stand-in for
// reg.exe (one ending in .js runs with this Node).

const path = require('path');
const { spawnSync } = require('child_process');
const { envVar } = require('../env');

const SOFTWARE = 'HKCU\\Software';

function regBin({ env = process.env } = {}) {
  const forced = envVar('REG_BIN', env);
  if (forced) return forced.endsWith('.js') ? { file: process.execPath, prefix: [forced] } : { file: forced, prefix: [] };
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return { file: path.win32.join(root, 'System32', 'reg.exe'), prefix: [] };
}

/** The full key for `sub` (e.g. "Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper"). */
function fullKey(sub, { env = process.env } = {}) {
  const root = envVar('REG_ROOT', env);
  return `${root && /^HKCU\\Software\\[^\\]+/i.test(root) ? root.replace(/\\+$/, '') : SOFTWARE}\\${sub}`;
}

function reg(args, { env = process.env, run = spawnSync } = {}) {
  const { file, prefix } = regBin({ env });
  try {
    const r = run(file, [...prefix, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (r.error) return { code: null, out: r.error.message };
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  } catch (e) {
    return { code: null, out: e.message };
  }
}

function complaint(r) {
  return (String(r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || (r.code === null ? 'couldn\'t run reg.exe' : `reg.exe exited ${r.code}`)).replace(/^ERROR:\s*/, '').slice(0, 300);
}

/** Sets the key's default value to `value` (a string). Returns null, or why it failed. */
function setDefault(key, value, opts) {
  const r = reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], opts);
  return r.code === 0 ? null : complaint(r);
}

/**
 * The key's default value: {value, error}. value null when the key or its value isn't there.
 * Read from `reg.exe export`, which writes a file in UTF-16: what `reg.exe query` prints is in the
 * console's code page, where a path like C:\Users\Zoë\… comes out garbled (and letters the code page
 * doesn't have, as "?").
 */
function getDefault(key, opts) {
  const fs = require('fs');
  const os = require('os');
  const file = path.join(os.tmpdir(), `trif-reg-${process.pid}-${require('crypto').randomBytes(6).toString('hex')}.reg`);
  try {
    const r = reg(['export', key, file, '/y'], opts);
    if (r.code !== 0) return { value: null, error: null };
    let buf;
    try { buf = fs.readFileSync(file); } catch { return { value: null, error: null }; }
    return { value: exportedDefault(buf), error: null };
  } finally {
    try { fs.rmSync(file, { force: true }); } catch { /* left in the temp folder */ }
  }
}

/** The default value (`@="…"`) of the first key in an exported .reg file's bytes, or null. */
function exportedDefault(buf) {
  // (UTF-16LE with a byte order mark, as regedit version 5 files are; anything else, as UTF-8)
  const text = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? buf.slice(2).toString('utf16le') : buf.toString('utf8');
  let seenKey = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]$/.test(line)) { if (seenKey) break; seenKey = true; continue; }
    const m = /^@="((?:[^"\\]|\\.)*)"$/.exec(line);
    if (seenKey && m) return m[1].replace(/\\(.)/g, '$1') || null;
  }
  return null;
}

/** Deletes the key (tests, and uninstalling by hand). Returns null, or why it failed. */
function deleteKey(key, opts) {
  const r = reg(['delete', key, '/f'], opts);
  return r.code === 0 ? null : complaint(r);
}

module.exports = { SOFTWARE, regBin, fullKey, reg, setDefault, getDefault, exportedDefault, deleteKey };
