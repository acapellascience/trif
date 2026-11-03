'use strict';
// `trif setup` on Windows puts <home>\bin (trif.cmd) on the user's PATH: the per-user Path value under
// HKCU\Environment, which every program started afterwards gets (Windows has no /usr/local/bin to link
// into, and no shell profile to tell the user to edit).
//
// Done in Windows PowerShell (powershell.js), the folder on its stdin:
//   - read the value raw (DoNotExpandEnvironmentNames), so entries like %USERPROFILE%\bin stay as written;
//   - add the folder at the end unless an entry already names it (ignoring case and a trailing \);
//   - write it back as REG_EXPAND_SZ, as Windows keeps it;
//   - then tell running programs the environment changed (WM_SETTINGCHANGE): .NET's
//     SetEnvironmentVariable broadcasts it, so setting and clearing a throwaway variable does that.
//     (Not `setx`, which cuts the value at 1024 characters; not SetEnvironmentVariable on Path itself,
//     which would store it expanded, as REG_SZ.)
// Terminals already open keep their old PATH: setup says to open a new one.
//
// The marker TRIF_USER_PATH in the script is what tests' PowerShell stand-in recognises it by.

const { runPowerShellSync, psComplaint } = require('./powershell');

const SCRIPT = `$ErrorActionPreference = 'Stop'
# TRIF_USER_PATH
try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  $dir = [string]$req.dir
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $old = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $norm = { param($p) ([Environment]::ExpandEnvironmentVariables($p)).TrimEnd('\\').ToLowerInvariant() }
  $want = & $norm $dir
  foreach ($e in ($old -split ';')) { if ($e -and ((& $norm $e) -eq $want)) { [Console]::Out.Write('already'); exit 0 } }
  if ($req.check) { [Console]::Out.Write('missing'); exit 0 }
  $new = if ($old.Trim(';')) { $old.TrimEnd(';') + ';' + $dir } else { $dir }
  $key.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $key.Close()
  [Environment]::SetEnvironmentVariable('TRIF_PATH_CHANGED', '1', 'User')
  [Environment]::SetEnvironmentVariable('TRIF_PATH_CHANGED', $null, 'User')
  [Console]::Out.Write('added'); exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message); exit 1
}
`;

/**
 * Adds `dir` to the user's PATH (check: only says whether it's there). Returns
 * {how: 'added'|'already'|'missing', error} (synchronously: setup is). Never throws.
 */
function addToUserPath(dir, { check = false, ...opts } = {}) {
  const r = runPowerShellSync(SCRIPT, { dir, check }, opts);
  const how = String(r.stdout || '').trim();
  if (r.code === 0 && ['added', 'already', 'missing'].includes(how)) return { how, error: null };
  return { how: null, error: psComplaint(r) };
}

module.exports = { SCRIPT, addToUserPath };
