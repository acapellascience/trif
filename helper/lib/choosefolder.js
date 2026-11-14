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
  if (platform === 'win32') {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      `$d.Description = '${String(prompt).replace(/'/g, "''")}'; $d.SelectedPath = '${String(start).replace(/'/g, "''")}'; ` +
      "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }";
    return ['powershell.exe', ['-NoProfile', '-STA', '-Command', ps]];
  }
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

module.exports = { chooseFolder, chooserCommand };
