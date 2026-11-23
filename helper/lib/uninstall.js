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
// setup.js), so this stays in step with it; Windows (branch `windows`) adds its registry keys here.

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

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/**
 * opts: { home, all, homedir (where browsers and LaunchAgents are; default the home folder), nativeDir
 *         (only that folder's manifest, as setup --native-dir), binDir (default /usr/local/bin),
 *         launchAgentsDir, launchctl (false, or TRIF_NO_LAUNCHCTL=1: remove the agent's file only),
 *         isHelper (pid -> bool), env }
 * Resolves { ok, removed: [path], kept: [{path, why}], problems: [string], keys: [account], ws, modsOutside }.
 */
async function uninstall(opts = {}) {
  const env = opts.env || process.env;
  const homedir = opts.homedir || os.homedir();
  const ws = P.workspace(opts.home);
  const home = ws.home;
  const removed = [];
  const kept = [];
  const problems = [];
  const keys = [];
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
    else for (const b of browserTable(homedir)) for (const f of manifestFiles(b)) files.add(f);
    for (const f of files) {
      let m;
      try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
        if (e.code !== 'ENOENT') kept.push({ path: f, why: "it isn't one TRIF wrote" });
        continue;
      }
      if (inBin(m && m.path, ws)) rm(f, { recursive: false });
      else kept.push({ path: f, why: `it starts another TRIF (${m && m.path})` });
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

    // 3. The CLI link setup made (only a link to this workspace's wrapper).
    const binDir = opts.binDir ? path.resolve(opts.binDir) : '/usr/local/bin';
    for (const name of [P.CLI_NAME, P.LEGACY_CLI_NAME]) {
      const link = path.join(binDir, name);
      let target;
      try { target = fs.readlinkSync(link); } catch { continue; }
      if (![ws.cliWrapper, ws.legacyCliWrapper].includes(path.resolve(binDir, target)) && !inBin(path.resolve(binDir, target), ws)) continue;
      try { fs.unlinkSync(link); removed.push(link); } catch (e) {
        problems.push(`couldn't remove the link ${link} (${e.code === 'EACCES' || e.code === 'EPERM' ? `remove it with: sudo rm ${link}` : e.message})`);
      }
    }

    // 4. Running helpers stop (their browser would otherwise keep one running on files that are gone).
    const isHelper = opts.isHelper || isHelperProcess;
    const stopping = helperSockets(home).filter((h) => h.pid !== process.pid && pidAlive(h.pid) && isHelper(h.pid));
    for (const h of stopping) { try { process.kill(h.pid, 'SIGTERM'); } catch { /* gone */ } }
    for (let waited = 0; waited < 5000 && stopping.some((h) => pidAlive(h.pid)); waited += 100) sleepSync(100);

    // 5. --all: the API keys TRIF saved (read before the private folder, which names the open model's).
    if (opts.all) {
      const keyring = require('./keyring');
      const b = keyring.backend({ env });
      if (b && fs.existsSync(b.bin)) {
        const agentkeys = require('./agentkeys');
        for (const id of Object.keys(agentkeys.AGENT_KEYS)) {
          try { const r = await agentkeys.removeAgentKey(id, { env }); if (r.removed) keys.push(r.account); } catch (e) { problems.push(`couldn't remove the ${id} API key: ${e.message}`); }
        }
        try { const r = await require('./agents/codex-oss').removeKey(ws, { env }); if (r.removed) keys.push(r.account); } catch (e) { problems.push(`couldn't remove the open model's API key: ${e.message}`); }
      }
    }

    // 6. TRIF's own files in the workspace.
    rm(ws.bin);
    rm(ws.appDir);
    rm(R.runtimeRoot(home));
    let names = [];
    try { names = fs.readdirSync(home); } catch { /* gone */ }
    const base = path.basename(ws.appDir);
    for (const n of names) {
      if (n.startsWith(`.${base}.new-`) || n.startsWith(`.${base}.old-`) || n.startsWith('.update-') || /^helper(-\d+)?\.sock$/.test(n)) rm(path.join(home, n));
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
      rm(home);
    }
    return { ok: problems.length === 0, removed, kept, problems, keys, ws, modsOutside };
  } finally {
    try { lock.release(); } catch { /* the workspace is gone */ }
  }
}

module.exports = { uninstall, plistIsOurs, inBin };
