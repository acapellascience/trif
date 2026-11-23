'use strict';
// `trif uninstall` (docs/NO-NODE.md): undoes what setup installed for workspace `home`: the native host
// manifests that point at its wrappers, the Safari bridge's launchd agent, the /usr/local/bin link, the
// running helpers, and <home>/bin, <home>/app (with an update's leftovers) and <home>/runtime (TRIF's own
// Node). The mods, the workspace's guides and the private folder (settings, paired phones, logs) stay, so a
// later setup picks up where this left off. --all also removes the API keys TRIF saved in the keyring, the
// private folder, the runs' mailboxes and the workspace itself (mods included; a mods folder configured
// outside it is left, and said).
// Only what belongs to this workspace goes: a manifest or Safari agent another workspace wrote (a git
// checkout's, say) stays, and is said. Setup's own files are found as setup writes them (browsers.js,
// setup.js), so this stays in step with it.
//
// Windows: the browsers' registry keys that name a manifest removed here go too, and <home>\bin comes off
// the user's PATH. A running program's file can't be deleted there, and this command is usually running on
// TRIF's own node.exe (<home>\runtime) through trif.cmd (<home>\bin; cmd.exe reads a batch file again after
// each command it runs, so deleting it under cmd.exe makes it say "The batch file cannot be found."):
// those folders (with --all, the workspace) are handed to a hidden Windows PowerShell that waits for this
// process to end, then deletes them (`removeLater`).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { browserTable, manifestFiles, safariAgentPlist, legacySafariAgentPlist, SAFARI_AGENT_LABEL, LEGACY_SAFARI_AGENT_LABEL } = require('./browsers');
const { helperSockets, pidAlive } = require('./helpers');
const { acquireInstallLock } = require('./lock');
const { envVar } = require('./env');
const R = require('./runtime');
const { boxRoot } = require('./runs');
const { isWindows, systemExe } = require('./platform');
// (now, not when it's used: by then <home>\app, where this code is, may be gone)
const { psArgs, psEnv, encode: encodePs } = require('./win/powershell');

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** Whether `file` (a wrapper path a manifest names) is in this workspace's bin folder. */
function inBin(file, ws) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const dirs = new Set([path.resolve(ws.bin), real(ws.bin)]);
  if (P.isDefaultHome(ws.home)) for (const h of [P.defaultHome(), P.legacyHome()]) dirs.add(path.join(h, 'bin'));
  return dirs.has(path.dirname(path.resolve(file))) || dirs.has(real(path.dirname(file)));
}

/** Whether a Safari agent file runs the bridge for this workspace: its TRIF_HOME, or none for the default. */
function plistHome(text) {
  const m = /<key>TRIF_HOME<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
}
function plistIsOurs(text, home) {
  const h = plistHome(text);
  return h === null ? P.isDefaultHome(home) : real(h) === real(home);
}

/** Whether process `pid` is a TRIF helper (host.js), not a process that has since taken its number. */
function isHelperProcess(pid) {
  const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 && /host\.js\b/.test(r.stdout);
}

/** Windows: whether process `pid` is a node.exe (tasklist, by its full path). */
function isWindowsHelperProcess(pid, { env = process.env } = {}) {
  const r = spawnSync(systemExe('tasklist.exe', env), ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return r.status === 0 && /^"node\.exe",/im.test(String(r.stdout || ''));
}

// (A PowerShell single-quoted string: only ' needs doubling.)
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Windows: deletes `dirs` once process `pid` has ended (this one: its node.exe and the trif.cmd that started it
 * can't go while it runs), from a hidden Windows PowerShell (System32's: never one on PATH, nor
 * TRIF_POWERSHELL_BIN's stand-in) that outlives this process. Tries for a minute: a terminal whose current
 * folder is in one keeps it. The paths go in the script itself (-EncodedCommand, UTF-16): nothing secret.
 *
 * Started by a short-lived PowerShell's Start-Process, not spawned from here: Node puts the programs it starts
 * in a job that ends them when it exits, and a detached one has no console, which Windows PowerShell won't
 * start without (seen in a Windows 11 VM: neither ran). What Start-Process starts leaves that job (Node's
 * allows it) and gets a console with no window. Takes the second or two PowerShell takes to start.
 */
function removeLater(dirs, { pid = process.pid, env = process.env, run = spawnSync } = {}) {
  if (!dirs.length) return null;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Wait-Process -Id ${Number(pid)} -Timeout 600`,
    'Start-Sleep -Milliseconds 1500',
    `$dirs = @(${dirs.map(psq).join(', ')})`,
    'for ($i = 0; $i -lt 60; $i++) {',
    '  foreach ($d in $dirs) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }',
    '  if (-not ($dirs | Where-Object { Test-Path -LiteralPath $_ })) { break }',
    '  Start-Sleep -Seconds 1',
    '}',
  ].join('\n');
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  const ps = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // (the inner arguments as one string: base64 needs no quoting)
  const inner = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePs(script)].join(' ');
  const outer = `Start-Process -FilePath ${psq(ps)} -WindowStyle Hidden -WorkingDirectory ${psq(path.parse(dirs[0]).root)} -ArgumentList ${psq(inner)}`;
  const r = run(ps, psArgs(outer), { encoding: 'utf8', windowsHide: true, timeout: 60000, cwd: path.parse(dirs[0]).root, env: psEnv() });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(String(r.stderr || r.stdout || `exit ${r.status}`).trim().split(/\r?\n/)[0]);
  return true;
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/**
 * opts: { home, all, homedir (where browsers and LaunchAgents are; default the home folder), nativeDir
 *         (only that folder's manifest, as setup --native-dir), binDir (default /usr/local/bin),
 *         launchAgentsDir, launchctl (false, or TRIF_NO_LAUNCHCTL=1: remove the agent's file only),
 *         isHelper (pid -> bool), env,
 *         Windows: platform, regOpts ({env, run} for win/registry.js), userPath ({bin} for win/userpath.js,
 *         or false: leave the user's PATH alone), later (dirs -> deletes them after this process: removeLater) }
 * Resolves { ok, removed: [path], later: [path] (Windows: removed once this process ends), kept: [{path, why}],
 *   problems: [string], keys: [account], ws, modsOutside }.
 */
async function uninstall(opts = {}) {
  const env = opts.env || process.env;
  const homedir = opts.homedir || os.homedir();
  const platform = opts.platform || process.platform;
  const win = isWindows(platform);
  const ws = P.workspace(opts.home, { platform });
  const home = ws.home;
  const removed = [];
  const kept = [];
  const problems = [];
  const keys = [];
  const later = [];
  const rm = (p, { recursive = true } = {}) => {
    if (!exists(p)) return;
    try { fs.rmSync(p, { recursive, force: true }); removed.push(p); } catch (e) { problems.push(`couldn't remove ${p}: ${e.message}`); }
  };

  // Never a folder that isn't a TRIF workspace (a mistyped --home): one setup made has bin/ or AGENTS.md.
  if (!fs.existsSync(home)) throw new Error(`there's no TRIF workspace at ${home}`);
  if (!['bin', 'app', 'AGENTS.md', 'sites'].some((f) => exists(path.join(home, f)))) throw new Error(`${home} doesn't look like a TRIF workspace (no bin, app, sites or AGENTS.md in it); left it alone`);
  if ([homedir, os.homedir(), path.parse(home).root].some((d) => real(d) === real(home))) throw new Error(`${home} is your home folder, not a TRIF workspace; left it alone`);

  // Not while an update installs (it would put things back half way).
  const lock = acquireInstallLock(ws.appDir, { env });
  try {
    // 1. Browser connections first, so a browser can't start a helper again.
    const files = new Set();
    if (opts.nativeDir) files.add(path.join(path.resolve(opts.nativeDir), `${P.HOST_NAME}.json`));
    const table = opts.nativeDir ? [] : browserTable(homedir, platform, env);
    if (opts.nativeDir) files.add(path.join(path.resolve(opts.nativeDir), `${P.HOST_NAME}.json`));
    else for (const b of table) for (const f of manifestFiles(b)) files.add(f);
    const gone = new Set();
    for (const f of files) {
      let m;
      try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
        if (e.code !== 'ENOENT') kept.push({ path: f, why: "it isn't one TRIF wrote" });
        continue;
      }
      if (inBin(m && m.path, ws)) { rm(f, { recursive: false }); if (!exists(f)) gone.add(path.resolve(f).toLowerCase()); }
      else kept.push({ path: f, why: `it starts another TRIF (${m && m.path})` });
    }
    // Windows: each browser finds its manifest through a registry key (win/registry.js): a key naming a
    // manifest just removed goes; one naming another (another workspace's) stays.
    if (win && gone.size) {
      const registry = require('./win/registry');
      const { nativeRegKeys } = require('./browsers');
      const seen = new Set();
      for (const b of table) {
        for (const key of nativeRegKeys(b, opts.regOpts)) {
          if (seen.has(key.toLowerCase())) continue;
          seen.add(key.toLowerCase());
          const { value } = registry.getDefault(key, opts.regOpts);
          if (!value || !gone.has(path.resolve(value).toLowerCase())) continue;
          const error = registry.deleteKey(key, opts.regOpts);
          if (error) problems.push(`couldn't remove the registry key ${key}: ${error}`);
          else removed.push(key);
        }
      }
    }

    // 2. The Safari bridge (and its agent from before 0.2.0), stopped and removed.
    const useLaunchctl = process.platform === 'darwin' && opts.launchctl !== false && !envVar('NO_LAUNCHCTL', env);
    const agentsDir = opts.launchAgentsDir ? path.resolve(opts.launchAgentsDir) : path.dirname(safariAgentPlist(homedir));
    for (const [plist, label] of [[path.join(agentsDir, path.basename(safariAgentPlist(homedir))), SAFARI_AGENT_LABEL],
      [path.join(agentsDir, path.basename(legacySafariAgentPlist(homedir))), LEGACY_SAFARI_AGENT_LABEL]]) {
      let text;
      try { text = fs.readFileSync(plist, 'utf8'); } catch { continue; }
      if (!plistIsOurs(text, home)) { kept.push({ path: plist, why: `it runs Safari's bridge for another workspace (${plistHome(text) || P.defaultHome()})` }); continue; }
      if (useLaunchctl) {
        const target = `gui/${process.getuid()}/${label}`;
        if (spawnSync('launchctl', ['print', target]).status === 0) {
          spawnSync('launchctl', ['bootout', target]);
          for (let waited = 0; waited < 5000 && spawnSync('launchctl', ['print', target]).status === 0; waited += 200) sleepSync(200);
        }
      }
      rm(plist, { recursive: false });
    }

    // 3. The CLI link setup made (only a link to this workspace's wrapper). Windows: <home>\bin on the user's
    // PATH instead (win/userpath.js).
    const binDir = opts.binDir ? path.resolve(opts.binDir) : '/usr/local/bin';
    if (win && opts.userPath !== false) {
      const r = require('./win/userpath').removeFromUserPath(ws.bin, opts.userPath || {});
      if (r.error) problems.push(`couldn't take ${ws.bin} off your PATH (${r.error}); remove it in Settings → System → About → Advanced system settings → Environment Variables`);
      else if (r.how === 'removed') removed.push(`${ws.bin} (from your PATH)`);
    }
    for (const name of win ? [] : [P.CLI_NAME, P.LEGACY_CLI_NAME]) {
      const link = path.join(binDir, name);
      let target;
      try { target = fs.readlinkSync(link); } catch { continue; }
      if (![ws.cliWrapper, ws.legacyCliWrapper].includes(path.resolve(binDir, target)) && !inBin(path.resolve(binDir, target), ws)) continue;
      try { fs.unlinkSync(link); removed.push(link); } catch (e) {
        problems.push(`couldn't remove the link ${link} (${e.code === 'EACCES' || e.code === 'EPERM' ? `remove it with: sudo rm ${link}` : e.message})`);
      }
    }

    // 4. Running helpers stop (their browser would otherwise keep one running on files that are gone).
    // (Windows: the helper's markers name the pid; taskkill /T takes its programs with it, the phone link's
    // announcer among them.)
    const isHelper = opts.isHelper || (win ? (pid) => isWindowsHelperProcess(pid, { env }) : isHelperProcess);
    const stopping = helperSockets(home).filter((h) => h.pid !== process.pid && pidAlive(h.pid) && isHelper(h.pid));
    for (const h of stopping) {
      if (win && !opts.isHelper) spawnSync(systemExe('taskkill.exe', env), ['/PID', String(h.pid), '/T', '/F'], { windowsHide: true, timeout: 15000 });
      else { try { process.kill(h.pid, 'SIGTERM'); } catch { /* gone */ } }
    }
    for (let waited = 0; waited < 5000 && stopping.some((h) => pidAlive(h.pid)); waited += 100) sleepSync(100);

    // 5. --all: the API keys TRIF saved (read before the private folder, which names the open model's).
    if (opts.all) {
      const keyring = require('./keyring');
      const b = keyring.backend({ env });
      // (Windows' Credential Manager: bin null, System32's PowerShell)
      if (b && (b.bin === null || fs.existsSync(b.bin))) {
        const agentkeys = require('./agentkeys');
        for (const id of Object.keys(agentkeys.AGENT_KEYS)) {
          try { const r = await agentkeys.removeAgentKey(id, { env }); if (r.removed) keys.push(r.account); } catch (e) { problems.push(`couldn't remove the ${id} API key: ${e.message}`); }
        }
        try { const r = await require('./agents/codex-oss').removeKey(ws, { env }); if (r.removed) keys.push(r.account); } catch (e) { problems.push(`couldn't remove the open model's API key: ${e.message}`); }
      }
    }

    // 6. TRIF's own files in the workspace. (Windows: bin and the runtime once this process has ended; with
    // --all, the whole workspace then, below.)
    if (win) later.push(...[ws.bin, R.runtimeRoot(home)].filter(exists));
    else { rm(ws.bin); rm(R.runtimeRoot(home)); }
    rm(ws.appDir);
    let names = [];
    try { names = fs.readdirSync(home); } catch { /* gone */ }
    const base = path.basename(ws.appDir);
    for (const n of names) {
      if (n.startsWith(`.${base}.new-`) || n.startsWith(`.${base}.old-`) || n.startsWith('.update-') || /^helper(-\d+)?\.(sock|pipe)$/.test(n)) rm(path.join(home, n));
    }

    // 7. --all: everything else.
    let modsOutside = null;
    if (opts.all) {
      const inside = (p) => real(p) === real(home) || real(p).startsWith(real(home) + path.sep);
      if (!inside(ws.modsDir) && fs.existsSync(ws.modsDir)) { modsOutside = ws.modsDir; kept.push({ path: ws.modsDir, why: 'your mods folder is outside the workspace' }); }
      rm(ws.private);
      const boxes = boxRoot();
      rm(boxes);
      if (!envVar('BOX_ROOT', env)) { try { fs.rmdirSync(path.dirname(boxes)); removed.push(path.dirname(boxes)); } catch { /* not empty, or gone */ } }
      // ~/.webmods, the link to ~/.trif an upgrade from before 0.2.0 left.
      if (P.isDefaultHome(home)) {
        const legacy = P.legacyHome(homedir);
        try { if (fs.lstatSync(legacy).isSymbolicLink() && real(legacy) === real(home)) { fs.unlinkSync(legacy); removed.push(legacy); } } catch { /* none */ }
      }
      lock.release();
      if (win) { later.length = 0; later.push(home); } else rm(home);
    }
    if (later.length) {
      try { (opts.later || removeLater)(later, { env }); } catch (e) { problems.push(`couldn't hand ${later.join(', ')} over to be removed: ${e.message}`); }
    }
    return { ok: problems.length === 0, removed, later, kept, problems, keys, ws, modsOutside };
  } finally {
    try { lock.release(); } catch { /* the workspace is gone */ }
  }
}

module.exports = { uninstall, plistIsOurs, inBin, removeLater, isWindowsHelperProcess };
