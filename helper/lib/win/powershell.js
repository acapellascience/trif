'use strict';
// Running a PowerShell script from the helper on Windows (credman.js, userpath.js).
//
// - Always Windows PowerShell 5.1 by its full path (%SystemRoot%\System32\WindowsPowerShell\v1.0), which
//   every Windows 10/11 has: never whatever `powershell` or `pwsh` comes first on PATH.
// - The script travels as -EncodedCommand (base64 of UTF-16LE): no quoting rules to get wrong, and
//   execution policy doesn't apply to it (it does to .ps1 files, which the default policy refuses).
//   The script is always one of ours and constant: nothing the user typed, and never a secret.
// - Anything variable (a key, a folder) goes in on STDIN, one JSON line, never in argv or the
//   environment: any same-user process can read another's command line and environment.
// - windowsHide: the browser starts the helper without a console, and a console program started from it
//   would otherwise flash a window of its own.
//
// TRIF_POWERSHELL_BIN (tests): a stand-in; one ending in .js is run with this Node, so the same fake works
// on macOS and on Windows (where a .js or .cmd can't be spawned directly).

const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { envVar } = require('../env');

/** The PowerShell to use: {file, prefix} (prefix: arguments before ours, for a .js stand-in). */
function powershellBin({ env = process.env, bin = null } = {}) {
  const forced = bin || envVar('POWERSHELL_BIN', env);
  if (forced) return forced.endsWith('.js') ? { file: process.execPath, prefix: [forced] } : { file: forced, prefix: [] };
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return { file: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), prefix: [] };
}

function encode(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The arguments for running `script`: no profile, no prompts, no logo. */
function psArgs(script) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encode(script)];
}

/**
 * Runs `script` with `input` (an object, sent as one JSON line) on its stdin. Resolves
 * {code, stdout, stderr}; never rejects. A slow first run (Add-Type compiles C#) gets `timeout` ms.
 */
function runPowerShell(script, input, { env = process.env, bin = null, timeout = 60000, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const { file, prefix } = powershellBin({ env, bin });
    let child;
    try {
      // (Its own environment is the helper's: PowerShell needs SystemRoot, PSModulePath, TEMP...)
      child = spawnFn(file, [...prefix, ...psArgs(script)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: null, stdout: '', stderr: `no answer within ${Math.round(timeout / 1000)} s` }); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < 1 << 16) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1 << 16) stderr += d; });
    child.on('error', (e) => finish({ code: null, stdout: '', stderr: e.message }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
    child.stdin.on('error', () => { /* it may exit before reading */ });
    child.stdin.end(input === undefined ? undefined : `${JSON.stringify(input)}\n`);
  });
}

/** The same, synchronously (setup is synchronous): {code, stdout, stderr}. */
function runPowerShellSync(script, input, { env = process.env, bin = null, timeout = 60000, spawnSyncFn = spawnSync } = {}) {
  const { file, prefix } = powershellBin({ env, bin });
  try {
    const r = spawnSyncFn(file, [...prefix, ...psArgs(script)], {
      input: input === undefined ? '' : `${JSON.stringify(input)}\n`, encoding: 'utf8', timeout, windowsHide: true, env: process.env,
    });
    if (r.error) return { code: null, stdout: '', stderr: r.error.message };
    return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
  } catch (e) {
    return { code: null, stdout: '', stderr: e.message };
  }
}

// PowerShell's error records are long ("At line:1 char:...", "+ CategoryInfo ..."): the first line says it.
function psComplaint(r) {
  const lines = String(r.stderr || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(At line:|\+ |CategoryInfo|FullyQualifiedErrorId)/.test(l));
  return (lines[0] || (r.code === null ? 'couldn\'t run PowerShell' : `exit status ${r.code}`)).slice(0, 300);
}

module.exports = { powershellBin, psArgs, encode, runPowerShell, runPowerShellSync, psComplaint };
