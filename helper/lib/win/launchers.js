'use strict';
// The wrappers setup writes into <home>\bin on Windows, in place of the #!/bin/sh ones:
//
//   trif-host.bat  what the native host manifests name. A manifest's "path" can't carry arguments, so it
//                  must be a program; browsers run a .bat through `cmd.exe /d /c` (Chrome adds the
//                  caller's origin and --parent-window=<id>, Firefox the manifest's path and the add-on's
//                  ID; host.js ignores its arguments). `@echo off` comes first: anything cmd.exe printed
//                  would land in the native messaging stream.
//   trif.cmd       the `trif` command for Command Prompt and PowerShell (both find .cmd through PATHEXT).
//                  No trif.ps1: PowerShell would prefer it, and its default execution policy refuses
//                  scripts.
//   trif           the same for Git Bash (Claude Code's shell on Windows), which doesn't look at PATHEXT:
//                  a #!/bin/sh script with the paths written C:/like/this. Command Prompt and PowerShell
//                  ignore a file without an extension.
//
// In a .bat/.cmd every path is in double quotes (Windows paths can't contain one) and % is doubled
// (cmd.exe expands %NAME% even inside quotes). Lines end in CRLF.
//
// Letters outside ASCII (C:\Users\Zoë, C:\Users\用户): cmd.exe reads a batch file in the console's code
// page, not UTF-8, so such a path written into the file as it is names nothing, and the helper wouldn't
// start for anyone whose profile folder has an accent in it. So paths are written so the file stays ASCII
// wherever it can:
//   - a path inside the workspace (the wrappers are in <home>\bin) is written from the wrapper's own
//     folder, "%~dp0..\app\helper\host.js": cmd.exe fills %~dp0 in itself, in Unicode. Always, accents or
//     not: a workspace that's moved keeps working too.
//   - another path with such letters, when it's inside the user's profile folder (Node from nvm, Volta or
//     fnm), is written from "%USERPROFILE%\…", which cmd.exe also fills in in Unicode.
//   - anything else with such letters (Node on another drive, in a folder with an accent) is written as
//     it is, after `chcp 65001` (UTF-8 for the lines after it). That needs a console, which a browser
//     gives its native hosts; best effort.

const path = require('path');

const ASCII = /^[\x20-\x7e]*$/;
const lower = (p) => String(p).toLowerCase();
function inside(p, dir) {
  const d = String(dir || '').replace(/[\\/]+$/, '');
  return !!d && [`${lower(d)}\\`, `${lower(d)}/`].some((x) => lower(p).startsWith(x));
}

/** A path for a .bat/.cmd line, quoted. */
function batQuote(p) {
  const s = String(p);
  if (s.includes('"') || /[\r\n]/.test(s)) throw new Error(`can't put ${JSON.stringify(s)} in a batch file`);
  return `"${s.replace(/%/g, '%%')}"`;
}

/**
 * `p` for a line of a wrapper in `binDir`: {text (quoted), ascii}. Inside the workspace (`binDir`'s parent):
 * from %~dp0. With letters outside ASCII and inside `profile`: from %USERPROFILE%. Else as it is.
 */
function batPath(p, { binDir = null, profile = null } = {}) {
  const s = String(p);
  if (s.includes('"') || /[\r\n]/.test(s)) throw new Error(`can't put ${JSON.stringify(s)} in a batch file`);
  const esc = (x) => x.replace(/%/g, '%%');
  const home = binDir ? path.win32.dirname(binDir) : null;
  if (home && inside(s, home)) {
    const rel = path.win32.relative(binDir, s);
    if (ASCII.test(rel)) return { text: `"%~dp0${esc(rel)}"`, ascii: true };
  }
  if (!ASCII.test(s) && profile && inside(s, profile)) {
    const rest = s.slice(String(profile).replace(/[\\/]+$/, '').length);
    if (ASCII.test(rest)) return { text: `"%USERPROFILE%${esc(rest)}"`, ascii: true };
  }
  return { text: `"${esc(s)}"`, ascii: ASCII.test(s) };
}

function crlf(lines) { return `${lines.join('\r\n')}\r\n`; }

const UTF8_LINE = 'chcp 65001 >nul 2>&1';

function batLines(nodePath, script, home, { binDir, profile, cli }) {
  const node = batPath(nodePath, { binDir, profile });
  const js = batPath(script, { binDir, profile });
  // (the workspace this wrapper is in, when it isn't the default one: its own folder's parent)
  const homeLine = home ? (binDir && lower(path.win32.dirname(binDir)) === lower(home) ? { text: '"TRIF_HOME=%~dp0.."', ascii: true } : { text: batQuote(`TRIF_HOME=${home}`), ascii: ASCII.test(home) }) : null;
  const ascii = node.ascii && js.ascii && (!homeLine || homeLine.ascii);
  return crlf([
    '@echo off',
    ...(cli ? ['setlocal'] : []),
    ...(ascii ? [] : [UTF8_LINE]),
    ...(homeLine ? [`${cli ? 'if not defined TRIF_HOME ' : ''}set ${homeLine.text}`] : []),
    `${node.text} ${js.text} %*`,
  ]);
}

/** trif-host.bat: TRIF_HOME set when the workspace isn't the default one. `where`: {binDir, profile}. */
function hostBatContent(nodePath, hostJs, home = null, where = {}) {
  return batLines(nodePath, hostJs, home, { ...where, cli: false });
}

/** trif.cmd: an explicit TRIF_HOME wins, else the workspace this wrapper was installed for. */
function cliCmdContent(nodePath, cliJs, home = null, where = {}) {
  return batLines(nodePath, cliJs, home, { ...where, cli: true });
}

/** C:\a\b -> C:/a/b (Git Bash accepts both, and a backslash in sh means something). */
function forwardSlashes(p) { return String(p).replace(/\\/g, '/'); }

// Quote for a POSIX shell double-quoted string.
function shq(s) { return '"' + String(s).replace(/(["\\$`])/g, '\\$1') + '"'; }

/** trif (no extension), for Git Bash. */
function cliShContent(nodePath, cliJs, home = null) {
  const env = home ? `: "\${TRIF_HOME:=${forwardSlashes(home).replace(/(["\\$`])/g, '\\$1')}}"\nexport TRIF_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(forwardSlashes(nodePath))} ${shq(forwardSlashes(cliJs))} "$@"\n`;
}

/**
 * {node, script, home} from a wrapper .bat/.cmd this file wrote, or null. `file`: the wrapper's own path
 * (for %~dp0); `profile`: the user's profile folder (for %USERPROFILE%).
 */
function parseLauncher(text, { file = null, profile = null } = {}) {
  const lines = String(text).split(/\r?\n/);
  const dp0 = file ? `${path.win32.dirname(file)}\\` : null;
  const un = (s) => {
    let p = s;
    let rel = false;
    if (p.startsWith('%~dp0')) { if (!dp0) return null; p = dp0 + p.slice(5); rel = true; }
    else if (p.startsWith('%USERPROFILE%')) { if (!profile) return null; p = String(profile).replace(/[\\/]+$/, '') + p.slice(13); }
    p = p.replace(/%%/g, '%');
    return rel ? path.win32.normalize(p) : p;
  };
  let home = null;
  for (const l of lines) {
    const h = /^(?:if not defined TRIF_HOME )?set "TRIF_HOME=([^"]*)"$/.exec(l.trim());
    if (h) home = un(h[1]);
    const m = /^"([^"]+)"\s+"([^"]+)"\s+%\*$/.exec(l.trim());
    if (m) { const node = un(m[1]); const script = un(m[2]); return node && script ? { node, script, home } : null; }
  }
  return null;
}

module.exports = { batQuote, batPath, UTF8_LINE, hostBatContent, cliCmdContent, cliShContent, parseLauncher, forwardSlashes };
