'use strict';
// What differs between macOS/Linux and Windows, outside the Windows modules in lib/win/ (registry.js,
// launchers.js, pipes.js, credman.js, userpath.js, powershell.js). Everything here does on macOS and Linux
// exactly what the code did before Windows support.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function isWindows(platform = process.platform) { return platform === 'win32'; }

/**
 * Side-panel agent runs (and `trif agent run`, and logging an agent in from the panel) where the
 * operating system can't confine them: a message saying so, or null where they're available.
 *
 * On macOS and Linux each run's commands are confined to its site by the agent's own sandbox (Claude
 * Code's, Codex's: docs/PROTOCOL.md "Run scope"), which is what keeps a page's text from steering the
 * agent at the rest of the user's files. On Windows neither has one TRIF can rely on yet (Claude Code
 * runs commands unsandboxed there; Codex's Windows sandbox needs a recent Windows 11), and TRIF never
 * runs an agent unconfined from the panel. Using an agent in a terminal, in the workspace, works as it
 * does anywhere: that's the user's own session, as it is on a Mac.
 */
function panelRunsOff(platform = process.platform, home = '~/.trif') {
  if (!isWindows(platform)) return null;
  return {
    title: 'Chats from the panel aren’t available on Windows yet',
    text: `Use your coding agent in a terminal instead: open one in ${home} and ask it there. Mods it writes show up here as usual.`,
    error: `chats from the panel aren't available on Windows yet: use your coding agent in a terminal, in ${home}`,
  };
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

module.exports = { isWindows, panelRunsOff, killTree, systemExe, openUrl, renameRetry, nodeExeName };
