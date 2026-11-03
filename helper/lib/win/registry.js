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
 * reg.exe prints `    (Default)    REG_SZ    C:\...` (the "(Default)" word is translated, so it's
 * matched by the type instead).
 */
function getDefault(key, opts) {
  const r = reg(['query', key, '/ve'], opts);
  if (r.code !== 0) return { value: null, error: null };
  for (const line of String(r.out).split(/\r?\n/)) {
    const m = /^\s+\S.*?\s{2,}REG_(?:EXPAND_)?SZ(?:\s{2,}(.*))?$/.exec(line);
    if (m) return { value: (m[1] || '').trim() || null, error: null };
  }
  return { value: null, error: null };
}

/** Deletes the key (tests, and uninstalling by hand). Returns null, or why it failed. */
function deleteKey(key, opts) {
  const r = reg(['delete', key, '/f'], opts);
  return r.code === 0 ? null : complaint(r);
}

module.exports = { SOFTWARE, regBin, fullKey, reg, setDefault, getDefault, deleteKey };
