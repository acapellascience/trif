'use strict';
// The fence for side-panel agent runs on Windows (docs/WINDOWS.md "The sandbox").
//
// On macOS and Linux a run's commands are confined by the agent's own sandbox, given TRIF's limits
// (runs.js runLimits). Claude Code has none on native Windows, and Codex's can't take TRIF's limits there
// without an administrator, so on Windows the fence is TRIF's own: an AppContainer made for each run.
// What runs inside it is only ever TRIF's own `trif` command (never a shell: none starts in one), started
// for the agent by helper/mcp.js, the `trif` tool the agent gets in place of a shell.
//
//   - trif-fence.exe (fence.cs beside this file) is the launcher: it makes the container, gives it its
//     entries on the run's folders, starts a program inside, and takes the entries out again. It's built on
//     the user's computer by the C# compiler Windows ships (.NET Framework 4's csc.exe), into
//     <home>\bin\trif-fence-<hash of its source>.exe: nothing compiled is shipped, so nothing needs
//     signing, and a new version of the source gets a new file (never replacing one that's running).
//   - A container has no capabilities but a made-up one and Windows' registryRead: no network of any kind
//     (the internet, name lookups, this computer's own servers), no pipe (the helper's included), and no
//     file or credential but those whose access list names the run or the made-up capability. It's the
//     less-privileged kind (lpac), which what Windows lets every packaged app read is closed to as well;
//     registryRead is what node needs to start in one (Winsock reads its settings).
//   - What names the run: its working folder (read), that folder's sites\ (read; folders may be made in
//     it; what's inside is the run's to change), each other site's folder there (read only, by an entry of
//     its own: Windows ignores deny entries that name an AppContainer), its mailbox and its screenshots
//     folder (write). What names the capability, for every run: TRIF's code (runs.js trifCode) and node.
//     The real workspace, the private folder and the rest of the home folder name neither.
//   - Node needs --preserve-symlinks --preserve-symlinks-main in there: without them it looks at every
//     folder on the way to a script, and may not look at C:\ (EPERM).
// All of this was tried from inside on windows-latest, as an administrator and as an ordinary user:
// tests/windows-fence/run.js, with this module's own spec.
//
// TRIF_FENCE_BIN (tests): a stand-in for trif-fence.exe; one ending in .js runs with this Node, so the
// tests of what's around the fence run on any system.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { envVar } = require('../env');

const SOURCE = path.join(__dirname, 'fence.cs');
const CAPABILITY = 'trif.run.code'; // what every run's container carries, for TRIF's code and node
const NODE_FLAGS = ['--preserve-symlinks', '--preserve-symlinks-main'];

function windowsRoot(env = process.env) { return env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows'; }

/** Windows' own C# compiler, or null (it's part of .NET Framework 4, which every Windows 10 and 11 has). */
function cscPath({ env = process.env, exists = fs.existsSync } = {}) {
  const root = windowsRoot(env);
  return ['Framework64', 'Framework'].map((d) => path.win32.join(root, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find((f) => exists(f)) || null;
}

function sourceHash() { return crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').slice(0, 12); }

/** Where the launcher for this version of the source goes. */
function launcherFile(ws) { return path.join(ws.bin || path.join(ws.home, 'bin'), `trif-fence-${sourceHash()}.exe`); }

/**
 * The launcher, built if it isn't there: {file, prefix, error}. `prefix`: arguments before the launcher's
 * own (a .js stand-in). Synchronous (about two seconds, once per version).
 */
function launcher(ws, { env = process.env, run = spawnSync } = {}) {
  const forced = envVar('FENCE_BIN', env);
  if (forced) return forced.endsWith('.js') ? { file: process.execPath, prefix: [forced], error: null } : { file: forced, prefix: [], error: null };
  const exe = launcherFile(ws);
  if (fs.existsSync(exe)) return { file: exe, prefix: [], error: null };
  const csc = cscPath({ env });
  if (!csc) return { file: null, prefix: [], error: 'Windows\' C# compiler (csc.exe, part of .NET Framework 4) isn\'t on this computer, so TRIF can\'t build its fence for agent runs' };
  const tmp = `${exe}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp.exe`;
  try {
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    const r = run(csc, ['/nologo', '/o+', '/r:System.Web.Extensions.dll', `/out:${tmp}`, SOURCE], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (r.error || r.status !== 0 || !fs.existsSync(tmp)) return { file: null, prefix: [], error: `couldn't build TRIF's fence for agent runs: ${String((r.error && r.error.message) || r.stdout || r.stderr || `csc.exe exited ${r.status}`).trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400)}` };
    try { fs.renameSync(tmp, exe); } catch (e) { if (!fs.existsSync(exe)) throw e; } // (another helper built it meanwhile)
    // Older versions' launchers go (one that's running stays until next time).
    for (const n of fs.readdirSync(path.dirname(exe))) {
      if (/^trif-fence-[0-9a-f]{12}\.exe$/.test(n) && n !== path.basename(exe)) { try { fs.unlinkSync(path.join(path.dirname(exe), n)); } catch { /* in use */ } }
    }
    return { file: exe, prefix: [], error: null };
  } catch (e) {
    return { file: null, prefix: [], error: `couldn't build TRIF's fence for agent runs: ${e.message}` };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ }
  }
}

/** The container's name for a run: its SID is derived from it. */
function containerName(runId) { return `trif.run.${String(runId).replace(/[^\w.-]/g, '')}`; }

/**
 * The spec trif-fence.exe takes for a run (fence.cs has its fields). `limits`: runs.js runLimits (the run's
 * working folder as `workspace`, its `modsDir` (the copy's sites\), `lockedDirs`, `box`, `screenshots`);
 * `code`: TRIF's code (runs.js trifCode); `node`: this Node; `runEnv`: the TRIF_* variables the run's `trif`
 * needs. The environment is the whole of what the fenced program gets: nothing of the helper's or the
 * agent's own comes along.
 */
function specFor({ runId, limits, code = [], node = process.execPath, runEnv = {}, env = process.env }) {
  const root = windowsRoot(env);
  const sys32 = path.win32.join(root, 'System32');
  const tmp = limits.tmp || path.join(limits.box, 'tmp');
  const mods = limits.modsDir;
  const inMods = (p) => String(p).toLowerCase().startsWith(`${String(mods).toLowerCase()}${path.sep}`);
  return {
    name: containerName(runId),
    capability: CAPABILITY,
    lpac: true,
    capabilities: ['registryRead'],
    cwd: limits.workspace,
    env: {
      SystemRoot: root, SystemDrive: env.SystemDrive || root.slice(0, 2), windir: root, ComSpec: path.win32.join(sys32, 'cmd.exe'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: sys32, TEMP: tmp, TMP: tmp,
      // (names only: the fenced program can't open these folders. They make `trif` work out the same paths
      // as the helper does.)
      ...(env.USERPROFILE ? { USERPROFILE: env.USERPROFILE } : {}), ...(env.LOCALAPPDATA ? { LOCALAPPDATA: env.LOCALAPPDATA } : {}), ...(env.APPDATA ? { APPDATA: env.APPDATA } : {}),
      ...runEnv,
    },
    grant: [
      // every run: TRIF's code and node (a folder that isn't the user's to change, C:\Program Files, is
      // readable to every program already)
      ...code.map((p) => ({ path: p, rights: 'r', to: 'capability', optional: true })),
      { path: node, rights: 'r', to: 'capability', inherit: false, optional: true },
      // this run: its working folder to read; in sites\ it may make folders (a new site's), and what's
      // inside is its to change...
      { path: limits.workspace, rights: 'r' },
      { path: mods, rights: 'r+mkdir', inherit: false },
      { path: mods, rights: 'rw', inherit: 'only' },
      { path: limits.box, rights: 'rw' },
      ...(limits.screenshots ? [{ path: limits.screenshots, rights: 'rw' }] : []),
    ],
    // ...but for the folders of other sites that are there when it starts: read only
    readonly: (limits.lockedDirs || []).filter((d) => !d.link && inMods(d.real)).map((d) => d.real),
  };
}

function runLauncher(l, args, { timeout = 60000, run = spawnSync } = {}) {
  const r = run(l.file, [...l.prefix, ...args], { encoding: 'utf8', windowsHide: true, timeout });
  if (r.error) return r.error.message;
  if (r.status !== 0) return String(r.stderr || r.stdout || `exit status ${r.status}`).trim().split(/\r?\n/).pop().replace(/^trif-fence: /, '').slice(0, 400);
  return null;
}

/** Makes the run's container and its entries. Returns null, or why it couldn't. */
function prepare(l, specFile, opts) { return runLauncher(l, ['prepare', specFile], opts); }

/** Takes the run's entries out again and deletes its container. Returns null, or why it couldn't. */
function cleanup(l, specFile, opts) { return runLauncher(l, ['cleanup', specFile], opts); }

/** [file, args] that start `argv` (a program and its arguments) inside the spec's container. */
function execCommand(l, specFile, argv) { return [l.file, [...l.prefix, 'exec', specFile, '--', ...argv]]; }

module.exports = { SOURCE, CAPABILITY, NODE_FLAGS, cscPath, sourceHash, launcherFile, launcher, containerName, specFor, prepare, cleanup, execCommand };
