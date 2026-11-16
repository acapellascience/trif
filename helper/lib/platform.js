'use strict';
// What differs between macOS/Linux and Windows, outside the Windows modules in lib/win/ (registry.js,
// launchers.js, pipes.js, credman.js, userpath.js, powershell.js). Everything here does on macOS and Linux
// exactly what the code did before Windows support.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function isWindows(platform = process.platform) { return platform === 'win32'; }

// The agents whose side-panel runs TRIF can fence on Windows (docs/WINDOWS.md "The sandbox"): those it can
// start without a shell, with `trif` as a tool whose program runs in TRIF's own AppContainer
// (lib/win/fence.js, helper/mcp.js).
const WINDOWS_RUN_AGENTS = ['claude'];

/**
 * Side-panel agent runs of `agentId` (and `trif agent run`) where TRIF can't confine them: a message
 * saying so, or null where they're available.
 *
 * On macOS and Linux each run's commands are confined to its site by the agent's own sandbox (Claude
 * Code's, Codex's: docs/PROTOCOL.md "Run scope"). On Windows neither has one TRIF can use, so there a run
 * gets no shell at all and TRIF's own fence around the one program it can start (lib/win/fence.js). That's
 * built for the agents in WINDOWS_RUN_AGENTS; another agent's runs aren't started from the panel there.
 * (Without `agentId`: whether no agent at all can run from the panel, which is nowhere now.)
 */
function panelRunsOff(platform = process.platform, home = '~/.trif', agentId = null, name = null) {
  if (!isWindows(platform) || !agentId || WINDOWS_RUN_AGENTS.includes(agentId)) return null;
  const who = name || 'This agent';
  return {
    title: `${who} can’t be used from the panel on Windows yet`,
    text: `TRIF can’t keep ${who}’s commands to the site you’re fixing on Windows yet. Use Claude Code here, or ${who} in a terminal in ${home}: mods it writes show up here as usual.`,
    error: `${who} can't be used from the panel on Windows yet: TRIF can't keep its commands to the site there. Use Claude Code, or ${who} in a terminal in ${home}`,
  };
}

/** Logging an agent in from the panel on Windows: not yet (the sign-in is the agent's own, in a terminal). */
function panelLoginOff(platform = process.platform, home = '~/.trif') {
  if (!isWindows(platform)) return null;
  return { error: `logging in from the panel isn't available on Windows yet: open a terminal in ${home}, start your coding agent there and log in` };
}

// ---------------------------------------------------------------- starting a program that may be a .cmd
//
// npm installs `claude` and `codex` on Windows as claude.cmd and codex.cmd, batch files, which can't be
// started as programs (Node refuses since 18.20): they go through cmd.exe, whose command line has its own
// rules. Every argument is quoted the way a program reads it back (backslashes before a quote doubled),
// then every character cmd.exe gives a meaning to gets a caret, twice: once for cmd.exe reading the line,
// once for the batch file handing its arguments (%*) to the real program. So an argument arrives as it
// was given, whatever is in it; nothing in it is ever read as a command. (The same as the cross-spawn
// package does for npm's shims.)
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdQuote(arg) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"'); // backslashes before a quote: doubled, and the quote escaped
  a = a.replace(/(\\*)$/, '$1$1'); // backslashes at the end (before the closing quote): doubled
  a = `"${a}"`;
  return a.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/**
 * How to start `file` with `args`: {file, args, options} for child_process.spawn (and spawnSync).
 * Anywhere but Windows, and for a real program there (.exe), as given. A .cmd or .bat on Windows:
 * through %SystemRoot%\System32\cmd.exe, as above. `options` are to be merged into the caller's.
 */
function spawnable(file, args = [], { platform = process.platform, env = process.env } = {}) {
  if (!isWindows(platform) || !/\.(cmd|bat)$/i.test(String(file))) return { file, args, options: {} };
  if (/["\r\n]/.test(String(file)) || args.some((a) => /[\r\n\0]/.test(String(a)))) throw new Error('a line break or quote that can\'t be passed to a batch file');
  const line = [String(file).replace(CMD_META, '^$1'), ...args.map(cmdQuote)].join(' ');
  return { file: systemExe('cmd.exe', env), args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}

/**
 * Stop `child` and what it started. macOS/Linux: the agent was spawned in a process group of its own
 * (detached), so the signal goes to the group (-pid), else to the child alone. Windows has no process
 * groups or signals: `taskkill /T` ends the child and its children (forcefully, whatever the signal).
 */
function killTree(child, signal = 'SIGTERM', { platform = process.platform, run = spawnSync, env = process.env } = {}) {
  if (!child || !child.pid) return;
  if (isWindows(platform)) {
    try {
      run(systemExe('taskkill.exe', env), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    } catch { /* gone */ }
    try { child.kill(); } catch { /* gone */ }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } }
}

/** A program in %SystemRoot%\System32, by its full path (never one found on PATH). */
function systemExe(name, env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return path.win32.join(root, 'System32', name);
}

/**
 * Opens `url` in the default browser: `open` (macOS), `xdg-open` (Linux), Windows' rundll32 url handler
 * (not `cmd /c start`, whose quoting a URL with & in it breaks). Returns whether it started.
 */
function openUrl(url, { platform = process.platform, run = spawnSync, env = process.env } = {}) {
  if (isWindows(platform)) {
    const r = run(systemExe('rundll32.exe', env), ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true });
    return !r.error && r.status === 0;
  }
  return run(platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).status === 0;
}

/**
 * fs.renameSync, retried for a moment on Windows when a file in the way is open (an antivirus scan, the
 * search indexer, an Explorer window: EPERM, EBUSY, EACCES). Elsewhere a plain rename.
 */
function renameRetry(from, to, { platform = process.platform, tries = 20, delayMs = 100, rename = fs.renameSync } = {}) {
  if (!isWindows(platform)) return rename(from, to);
  for (let i = 0; ; i++) {
    try { return rename(from, to); } catch (e) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

/** The node program's file name: node.exe on Windows. */
function nodeExeName(platform = process.platform) { return isWindows(platform) ? 'node.exe' : 'node'; }

module.exports = { isWindows, panelRunsOff, panelLoginOff, WINDOWS_RUN_AGENTS, spawnable, cmdQuote, killTree, systemExe, openUrl, renameRetry, nodeExeName };
