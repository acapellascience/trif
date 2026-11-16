'use strict';
// "Where should TRIF save …?": the system's own folder chooser, for exports (Tim, 11-14: export used to drop
// everything in Downloads without asking). Opened by the helper, so it works the same from any browser:
// macOS's (osascript, brought to the front), zenity or kdialog on Linux, Windows' folder browser. Resolves the
// folder chosen, or null when the user cancels. Where there's no chooser it resolves `fallback` (Downloads).
//
// Tests never see a window: TRIF_CHOOSE_FOLDER is the answer ("cancel" for a cancel), and where only
// TRIF_DOWNLOADS is set (the older tests), that folder is the answer.

const { execFile } = require('child_process');
const { envVar } = require('./env');

const LIMIT = 10 * 60 * 1000; // (a chooser left open: given up on after ten minutes, as a cancel)

/** The command that asks, by platform: [cmd, args], or null where TRIF knows none. */
function chooserCommand(prompt, start, platform = process.platform) {
  if (platform === 'darwin') {
    const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return ['osascript', ['-e', 'activate', '-e', `POSIX path of (choose folder with prompt ${q(prompt)} default location (POSIX file ${q(start)}))`]];
  }
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return ['zenity', ['--file-selection', '--directory', `--title=${prompt}`, `--filename=${start.replace(/\/?$/, '/')}`]];
  }
  // Windows: lib/win/choosefolder (chooseFolder below runs it: the prompt and the folder go in on stdin).
  if (platform === 'win32') return ['powershell.exe', []];
  return null;
}

/**
 * Asks where to save: the folder chosen (a path), or null for a cancel. `start`: where the chooser opens.
 * `fallback`: the answer where no chooser can be shown.
 */
function chooseFolder(prompt, { start, fallback = start, env = process.env, platform = process.platform } = {}) {
  const stub = envVar('CHOOSE_FOLDER', env);
  if (stub !== undefined) return Promise.resolve(stub === 'cancel' ? null : stub);
  if (envVar('DOWNLOADS', env) !== undefined) return Promise.resolve(envVar('DOWNLOADS', env));
  if (platform === 'win32') return windowsChooser(prompt, start, { env, fallback });
  const c = chooserCommand(prompt, start, platform);
  if (!c) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    execFile(c[0], c[1], { timeout: LIMIT, windowsHide: false }, (err, stdout) => {
      const out = String(stdout || '').trim().replace(/\/$/, '') || null;
      if (!err) return resolve(out);
      // (no chooser installed, e.g. Linux without zenity: the old way, Downloads; a cancel or a time-out: null)
      if (err.code === 'ENOENT') return resolve(fallback);
      return resolve(null);
    });
  });
}

// Windows' folder browser, from Windows PowerShell (win/powershell.js: its full path, the script constant
// and encoded). The prompt and the starting folder go in on stdin as one JSON line (in ASCII: powershell.js),
// and the answer comes back as UTF-8. The dialog
// gets a topmost owner, so it opens in front of the browser rather than behind it.
const WINDOWS_CHOOSER = `
$ErrorActionPreference = 'Stop'
$in = [Console]::In.ReadLine() | ConvertFrom-Json
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $in.prompt
$d.SelectedPath = $in.start
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Dispose()
`;
function windowsChooser(prompt, start, { env = process.env, fallback = start, run = require('./win/powershell').runPowerShell } = {}) {
  return run(WINDOWS_CHOOSER, { prompt: String(prompt), start: String(start) }, { env, timeout: LIMIT }).then((r) => {
    if (r.code === 0) return String(r.stdout || '').trim().replace(/[\\/]$/, '') || null; // (nothing: a cancel)
    // (PowerShell itself didn't start: the old way, Downloads; anything else, a time-out included: a cancel)
    return r.code === null && !/no answer within/.test(r.stderr) ? fallback : null;
  });
}

module.exports = { chooseFolder, chooserCommand, windowsChooser, WINDOWS_CHOOSER };
