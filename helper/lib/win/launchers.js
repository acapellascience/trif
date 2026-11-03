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

/** A path for a .bat/.cmd line, quoted. */
function batQuote(p) {
  const s = String(p);
  if (s.includes('"') || /[\r\n]/.test(s)) throw new Error(`can't put ${JSON.stringify(s)} in a batch file`);
  return `"${s.replace(/%/g, '%%')}"`;
}

function crlf(lines) { return `${lines.join('\r\n')}\r\n`; }

/** trif-host.bat: TRIF_HOME set when the workspace isn't the default one. */
function hostBatContent(nodePath, hostJs, home = null) {
  return crlf([
    '@echo off',
    ...(home ? [`set ${batQuote(`TRIF_HOME=${home}`)}`] : []),
    `${batQuote(nodePath)} ${batQuote(hostJs)} %*`,
  ]);
}

/** trif.cmd: an explicit TRIF_HOME wins, else the workspace this wrapper was installed for. */
function cliCmdContent(nodePath, cliJs, home = null) {
  return crlf([
    '@echo off',
    'setlocal',
    ...(home ? [`if not defined TRIF_HOME set ${batQuote(`TRIF_HOME=${home}`)}`] : []),
    `${batQuote(nodePath)} ${batQuote(cliJs)} %*`,
  ]);
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

/** {node, script, home} from a wrapper .bat/.cmd this file wrote, or null. */
function parseLauncher(text) {
  const lines = String(text).split(/\r?\n/);
  const un = (s) => s.replace(/%%/g, '%');
  let home = null;
  for (const l of lines) {
    const h = /^(?:if not defined TRIF_HOME )?set "TRIF_HOME=([^"]*)"$/.exec(l.trim());
    if (h) home = un(h[1]);
    const m = /^"([^"]+)"\s+"([^"]+)"\s+%\*$/.exec(l.trim());
    if (m) return { node: un(m[1]), script: un(m[2]), home };
  }
  return null;
}

module.exports = { batQuote, hostBatContent, cliCmdContent, cliShContent, parseLauncher, forwardSlashes };
