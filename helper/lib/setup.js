'use strict';
// `trif setup`: workspace (moving one from before 0.2.0 from ~/.webmods first: migrate.js), app copy,
// wrappers, native host manifests, CLI link. Idempotent.
//
// Install modes (where the wrappers point):
//   link  the package itself (a git checkout: the maintainer's way of working)
//   copy  a self-contained copy in <home>/app (default when not a git checkout, e.g. `npx trif setup`,
//         whose package lives in npm's cache, which npm may delete)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar } = require('./env');
const P = require('./paths');
const { selectBrowsers, SAFARI_AGENT_LABEL, LEGACY_SAFARI_AGENT_LABEL, safariAgentPlist, legacySafariAgentPlist, legacySafariAgentLoaded } = require('./browsers');
const { migrateHome, describeMigration, migratePrivate } = require('./migrate');
const { preinstallMods, updateShippedMods } = require('./preinstalled');
const { acquireInstallLock, pidAlive } = require('./lock');
const { firefoxAddonUrl } = require('./update');

// Quote for a POSIX shell double-quoted string.
function shq(s) {
  return '"' + String(s).replace(/(["\\$`])/g, '\\$1') + '"';
}

function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

// Prefer a stable node path (e.g. /usr/local/bin/node or /opt/homebrew/bin/node) over a versioned
// Cellar path, as long as it is the same binary that is running now.
function pickNodePath() {
  const exec = process.execPath;
  let real;
  try { real = fs.realpathSync(exec); } catch { return exec; }
  const candidates = [
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'node')),
    '/usr/local/bin/node', '/opt/homebrew/bin/node',
  ];
  for (const c of candidates) {
    if (!path.isAbsolute(c) || !isExecutable(c)) continue;
    try { if (fs.realpathSync(c) === real) return c; } catch { /* ignore */ }
  }
  return exec;
}

function hostWrapperContent(nodePath, home, hostJs = P.HOST_JS) {
  const env = !P.isDefaultHome(home) ? `TRIF_HOME=${shq(home)}\nexport TRIF_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(hostJs)} "$@"\n`;
}

function cliWrapperContent(nodePath, home, cliJs = P.CLI_JS) {
  // Respect an explicit TRIF_HOME, else default to the home this wrapper was installed for.
  const env = !P.isDefaultHome(home) ? `: "\${TRIF_HOME:=${String(home).replace(/(["\\$`])/g, '\\$1')}}"\nexport TRIF_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(cliJs)} "$@"\n`;
}

function manifestFor(wrapperPath, origins = [P.EXTENSION_ORIGIN], { firefox = false } = {}) {
  return {
    name: P.HOST_NAME,
    description: `${P.NAME} helper: syncs mods and serves the ${P.CLI_NAME} CLI`,
    path: wrapperPath,
    type: 'stdio',
    ...(firefox ? { allowed_extensions: [P.FIREFOX_EXTENSION_ID] } : { allowed_origins: [...origins] }),
  };
}

// ---------------------------------------------------------------- Safari bridge

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The launchd agent that keeps the Safari bridge (helper/safari-bridge.js) running while you're logged in. */
function safariAgentContent(nodePath, bridgeJs, home, errFile = path.join(P.privateDir(home), 'safari-bridge.err')) {
  const env = !P.isDefaultHome(home)
    ? `  <key>EnvironmentVariables</key>\n  <dict><key>TRIF_HOME</key><string>${xmlEscape(home)}</string></dict>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SAFARI_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xmlEscape(nodePath)}</string><string>${xmlEscape(bridgeJs)}</string></array>
${env}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>${xmlEscape(errFile)}</string>
</dict>
</plist>
`;
}

/**
 * (Re)start the Safari bridge's agent so it runs the current code. `changed`: whether the agent's file
 * was just written (a loaded agent with an unchanged file only needs restarting, `kickstart -k`; a new
 * or changed file is loaded afresh). Returns { error, later }: error is a message or null.
 *
 * Stopping the bridge stops everything launchd started with it, its hosts and their children included.
 * An update installed from Safari runs this inside such a host (safari-bridge.js gives its hosts
 * TRIF_SAFARI_BRIDGE, or WEBMODS_SAFARI_BRIDGE before 0.2.0), so doing it here would kill this setup and the update half way, leaving the
 * bridge stopped until the next login. There, the launchctl commands run a few seconds later from a
 * process of their own (detached, so launchd doesn't count it as the bridge's), after the update has
 * finished; `later` is true.
 *
 * The agent from before 0.2.0 (LEGACY_SAFARI_AGENT_LABEL) is stopped first if it's loaded: both bridges
 * want the same port.
 */
function loadSafariAgent(plist, { changed = true, env = process.env, run, runDetached } = {}) {
  const { spawnSync, spawn } = require('child_process');
  run = run || ((args) => spawnSync('launchctl', args, { encoding: 'utf8' }));
  runDetached = runDetached || ((script) => spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref());
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${SAFARI_AGENT_LABEL}`;
  const loaded = run(['print', target]).status === 0;
  const legacyTarget = `${domain}/${LEGACY_SAFARI_AGENT_LABEL}`;
  const legacy = run(['print', legacyTarget]).status === 0 ? [['bootout', legacyTarget]] : [];
  const steps = [...legacy, ...(loaded && !changed ? [['kickstart', '-k', target]]
    : [...(loaded ? [['bootout', target]] : []), ['bootstrap', domain, plist]])];
  if (envVar('SAFARI_BRIDGE', env)) {
    runDetached(`sleep 3; ${steps.map((a) => ['launchctl', ...a].map(shq).join(' ')).join('; ')}`);
    return { error: null, later: true };
  }
  for (const args of steps) {
    const r = run(args);
    if (r.status !== 0 && args[1] !== legacyTarget) return { error: (r.stderr || r.stdout || `launchctl ${args[0]} exited ${r.status}`).trim(), later: false };
  }
  return { error: null, later: false };
}

// ---------------------------------------------------------------- app copy

// What the copy needs: the helper (host + CLI + AGENTS.md + template), the extension to load unpacked,
// the examples, and package.json (version, and it keeps helper/ CommonJS).
const COPY_ITEMS = ['package.json', 'helper', 'extension', 'examples'];
const REQUIRED_FILES = ['package.json', 'helper/host.js', 'helper/cli.js', 'extension/manifest.json'];
const SKIP_NAMES = new Set(['.DS_Store', 'node_modules', '.git']);

function chooseMode(mode, root = P.REPO_ROOT) {
  if (mode === 'copy' || mode === 'link') return mode;
  return P.isGitCheckout(root) ? 'link' : 'copy';
}

// (The system's realpath: on macOS also each component's on-disk case, so two spellings compare equal.)
function realOrResolved(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

function copyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
  } else if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (!SKIP_NAMES.has(name)) copyTree(path.join(src, name), path.join(dest, name));
    }
  } else if (st.isFile()) {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, st.mode & 0o777);
  }
}

// rel path -> 'dir' | 'link:<target>' | 'file:<mode>:<size>' for every entry under root/items.
function listTree(root, items) {
  const out = new Map();
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) out.set(rel, `link:${fs.readlinkSync(abs)}`);
    else if (st.isDirectory()) {
      out.set(rel, 'dir');
      for (const name of fs.readdirSync(abs)) if (!SKIP_NAMES.has(name)) walk(path.join(rel, name));
    } else if (st.isFile()) out.set(rel, `file:${st.mode & 0o777}:${st.size}`);
  };
  for (const item of items) walk(item);
  return out;
}

// True when dest already holds exactly what a copy from src would produce (so re-running setup doesn't
// pull files out from under a running helper).
function sameTree(src, dest, items = COPY_ITEMS) {
  const a = listTree(src, items);
  const b = listTree(dest, items);
  if (a.size !== b.size) return false;
  for (const [rel, kind] of a) {
    if (b.get(rel) !== kind) return false;
    if (kind.startsWith('file:') && !fs.readFileSync(path.join(src, rel)).equals(fs.readFileSync(path.join(dest, rel)))) return false;
  }
  return true;
}

// The pid in a leftover's name (.app.new-<pid>, .app.old-<pid>), if that process is still running.
function leftoverOwnerAlive(name) {
  const m = /-(\d+)$/.exec(name);
  return !!m && pidAlive(Number(m[1]));
}

/**
 * Copy the package at srcRoot into appDir: into a temp sibling first, then swapped in, so a failed copy
 * leaves a working install alone. Holds the install lock (lock.js) throughout, so two installs never
 * swap at once. Returns { how: 'created'|'updated'|'unchanged'|'in-place' }; throws (with appDir
 * untouched) on failure, or LockBusy when another process is installing.
 */
function installApp(srcRoot, appDir) {
  if (realOrResolved(srcRoot) === realOrResolved(appDir)) return { how: 'in-place' };
  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(srcRoot, f))) throw new Error(`${path.join(srcRoot, f)} is missing; nothing to copy from`);
  }
  const lock = acquireInstallLock(appDir);
  try {
    return installAppLocked(srcRoot, appDir);
  } finally {
    lock.release();
  }
}

function installAppLocked(srcRoot, appDir) {
  if (fs.existsSync(appDir) && sameTree(srcRoot, appDir)) return { how: 'unchanged' };

  const parent = path.dirname(appDir);
  const base = path.basename(appDir);
  fs.mkdirSync(parent, { recursive: true });
  // Leftovers from an interrupted earlier run, unless the process that made them is still going (an
  // older TRIF, from before the lock, may be installing right now).
  for (const name of fs.readdirSync(parent)) {
    if ((name.startsWith(`.${base}.new-`) || name.startsWith(`.${base}.old-`)) && !leftoverOwnerAlive(name)) {
      fs.rmSync(path.join(parent, name), { recursive: true, force: true });
    }
  }
  const tmp = path.join(parent, `.${base}.new-${process.pid}`);
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); // ours, from an earlier setup in this process
    fs.mkdirSync(tmp);
    for (const item of COPY_ITEMS) {
      const s = path.join(srcRoot, item);
      if (fs.existsSync(s)) copyTree(s, path.join(tmp, item));
    }
    for (const f of REQUIRED_FILES) if (!fs.existsSync(path.join(tmp, f))) throw new Error(`the copy is missing ${f}`);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }

  let old = null;
  if (fs.existsSync(appDir)) {
    old = path.join(parent, `.${base}.old-${process.pid}`);
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(appDir, old);
  }
  try {
    fs.renameSync(tmp, appDir);
  } catch (e) {
    if (old) fs.renameSync(old, appDir);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  if (old) fs.rmSync(old, { recursive: true, force: true });
  return { how: old ? 'updated' : 'created' };
}

function writeIfChanged(file, content, mode) {
  let old = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (old !== content) fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
  return old === null ? 'created' : old === content ? 'unchanged' : 'updated';
}

function rcFileHint() {
  const shell = path.basename(process.env.SHELL || '');
  if (shell === 'zsh') return '~/.zshrc';
  if (shell === 'bash') return process.platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc';
  if (shell === 'fish') return null;
  return '~/.profile';
}

// Drop the folders npm/npx put on PATH for the duration of `npx trif setup` (npm's cache, which it
// may delete, and its node-gyp shim): the helper and agents shouldn't keep using them.
function cleanPath(pathValue) {
  const sep = path.sep;
  return String(pathValue || '').split(path.delimiter).filter((d) => d
    && !d.includes(`${sep}_npx${sep}`)
    && !d.includes(`${sep}@npmcli${sep}run-script${sep}`)).join(path.delimiter);
}

// Merge config.json -> env.PATH = pathValue, and modsDirReal = {path, real} for the mods folder `modsDir`
// (runs.js checkModsFolder: a run is refused if the mods folder later leads somewhere else; not recorded,
// and any old record dropped, when it's a link), keeping every other key. Leaves a broken file alone.
function recordPath(home, pathValue, modsDir = null) {
  const file = P.configFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let config = {};
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (text !== null && text.trim()) {
    try { config = JSON.parse(text); } catch (e) { return { error: `${file} is not valid JSON (${e.message}); left it alone` }; }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { error: `${file} is not a JSON object; left it alone` };
  }
  const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {};
  config.env = { ...env, PATH: pathValue };
  if (modsDir) {
    let st = null;
    try { st = fs.lstatSync(modsDir); } catch { /* none */ }
    if (st && st.isDirectory()) config.modsDirReal = { path: modsDir, real: fs.realpathSync.native(modsDir) };
    else delete config.modsDirReal;
  }
  const how = writeIfChanged(file, JSON.stringify(config, null, 2) + '\n');
  return { error: null, how };
}

/** Selects `dir` in a Finder window and copies its path (macOS only). Returns whether Finder showed it. */
function revealFolder(dir) {
  if (process.platform !== 'darwin') return false;
  const { spawnSync } = require('child_process');
  spawnSync('pbcopy', { input: dir });
  return spawnSync('open', ['-R', dir]).status === 0;
}

/**
 * opts: { home, browser, nativeDir, binDir, noLink, noExamples, mode: 'copy'|'link'|undefined (auto),
 *         reveal (show the extension folder in Finder for Chrome's Load unpacked),
 *         launchAgentsDir (where the Safari bridge's agent goes; default ~/Library/LaunchAgents),
 *         launchctl (false: write the agent but don't start it; also TRIF_NO_LAUNCHCTL=1) }
 * Returns { ok, lines: [string], ws, manifests: [{browser, file}], nodePath, mode, root, migration }
 */
/** A path as typed in a shell: ~/… under the home folder, quoted if it needs to be. */
function homeRelative(p) {
  const h = os.homedir();
  const rel = p.startsWith(h + path.sep) ? p.slice(h.length + 1) : null;
  if (rel !== null && /^[\w./-]+$/.test(rel)) return `~/${rel}`;
  return /^[\w./-]+$/.test(p) ? p : shq(p);
}

function setup(opts = {}) {
  const lines = [];
  const say = (s = '') => lines.push(s);
  // 0. A workspace from before 0.2.0 moves from ~/.webmods to ~/.trif (migrate.js), when setting up the
  // default one: no --home or TRIF_HOME, or one naming either of those (an older updater passes
  // --home ~/.webmods). A workspace somewhere else stays where it is.
  const asked = opts.home || envVar('HOME');
  let migration = null;
  if (!asked || P.isDefaultHome(asked)) {
    try { migration = migrateHome(); } catch (e) { migration = { how: 'skipped', notes: [], error: `couldn't move ${P.legacyHome()} to ${P.defaultHome()}: ${e.message}; still using ${P.legacyHome()}` }; }
    for (const l of describeMigration(migration)) say(l);
  }
  let ws = P.workspace(opts.home);
  const home = ws.home;
  let ok = true;

  // 0a. The Safari bridge from before 0.2.0 (dev.webmods.safari-bridge): it writes its errors into the
  // workspace and wants the same port as its replacement, so it's stopped now, before the private files
  // move (unless this setup runs inside one of its hosts, an update installed from Safari: stopping it
  // would stop this setup; loadSafariAgent stops it a few seconds later instead), and replaced below
  // whatever browsers this setup is for.
  const legacyPlist = opts.launchAgentsDir ? path.join(path.resolve(opts.launchAgentsDir), path.basename(legacySafariAgentPlist())) : legacySafariAgentPlist();
  const useLaunchctl = opts.launchctl !== false && !envVar('NO_LAUNCHCTL');
  const legacyLoaded = useLaunchctl && legacySafariAgentLoaded();
  const legacySafari = legacyLoaded || fs.existsSync(legacyPlist);
  if (legacyLoaded && !envVar('SAFARI_BRIDGE')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LEGACY_SAFARI_AGENT_LABEL}`], { encoding: 'utf8' });
    say(r.status === 0 ? `Safari bridge stopped the one from before 0.2.0 (${LEGACY_SAFARI_AGENT_LABEL})` : `Safari bridge couldn't stop the one from before 0.2.0 (${LEGACY_SAFARI_AGENT_LABEL}): ${(r.stderr || '').trim()}`);
  }

  // 0b. The helper's private files leave the workspace (0.2.0; migrate.js migratePrivate): runs may read
  // all of the workspace, never the private folder.
  const priv = migratePrivate(home, { privateDir: ws.private });
  for (const n of priv.notes) say(`private       ${n}`);
  for (const e of priv.errors) { ok = false; say(`private       FAILED: ${e}`); }
  if (priv.moved.length || priv.removed.length) ws = P.workspace(opts.home); // (config.json moved)
  if (ws.privateError) say(`private       warning: ${ws.privateError}`);

  // 1. Workspace
  for (const d of [home, ws.modsDir, ws.bin]) fs.mkdirSync(d, { recursive: true });
  try {
    if (fs.lstatSync(ws.modsDir).isSymbolicLink()) {
      say(`mods          warning: the mods folder ${ws.modsDir} is a link; side-panel agent runs won't start until it's a`);
      say('              folder (or "modsDir" in config.json names the folder itself)');
    }
  } catch { /* made above */ }
  fs.mkdirSync(ws.private, { recursive: true, mode: 0o700 });
  fs.mkdirSync(ws.screenshots, { recursive: true });
  say(`workspace     ${home}`);
  say(`private       ${ws.private} (settings, logs, screenshots: never readable by side-panel runs)`);

  // 2. App: what the wrappers run and where the extension is loaded from.
  const mode = chooseMode(opts.mode);
  let root = P.REPO_ROOT;
  if (mode === 'copy') {
    try {
      const { how } = installApp(P.REPO_ROOT, ws.appDir);
      say(`app           ${ws.appDir} (v${P.VERSION}, ${how === 'in-place' ? 'running from it' : `${how}, copied from ${P.REPO_ROOT}`})`);
      root = ws.appDir;
    } catch (e) {
      ok = false;
      if (fs.existsSync(path.join(ws.appDir, 'helper', 'host.js'))) {
        say(`app           FAILED to update ${ws.appDir}: ${e.message}; kept the existing copy`);
        root = ws.appDir;
      } else {
        say(`app           FAILED to copy TRIF into ${ws.appDir}: ${e.message}`);
        return { ok, lines, ws, manifests: [], nodePath: null, mode, root: null, migration };
      }
    }
  } else {
    say(`app           ${root} (linked: the wrappers run this folder)`);
    if (!P.isGitCheckout(root)) {
      say(`              warning: ${root} isn't a git checkout. If it goes away (npm deletes its npx cache),`);
      say('              TRIF stops working. Run setup without --link to install a copy instead.');
    }
    if (fs.existsSync(ws.appDir) && realOrResolved(ws.appDir) !== realOrResolved(root)) {
      say(`              (an earlier copy in ${ws.appDir} is no longer used; you can delete it)`);
    }
  }
  const helperDir = path.join(root, 'helper');
  const extensionDir = path.join(root, 'extension');

  const agentsSrc = path.join(helperDir, 'workspace', 'AGENTS.md');
  if (fs.existsSync(agentsSrc)) {
    fs.copyFileSync(agentsSrc, path.join(home, 'AGENTS.md'));
    say(`              AGENTS.md refreshed from ${agentsSrc}`);
  } else {
    say(`              AGENTS.md not found at ${agentsSrc}; skipped`);
  }
  if (!opts.noExamples) {
    const examplesDir = envVar('EXAMPLES_DIR') ? path.resolve(envVar('EXAMPLES_DIR')) : path.join(root, 'examples', 'sites');
    const { added, on, sites } = preinstallMods(home, ws.modsDir, examplesDir);
    const off = added.filter((id) => !on.includes(id));
    if (on.length) say(`mods          preinstalled, on: ${on.join(', ')}`);
    if (off.length) say(`mods          preinstalled, off until you switch them on in the side panel: ${off.join(', ')}`);
    if (sites.length) say(`sites         TRIF starts on for ${sites.join(', ')} (off everywhere else until you turn it on there)`);
    // Later versions of the shipped mods: unchanged copies are replaced, edited ones offered the new version.
    const vers = (m) => `${m.id}${m.version ? ` (version ${m.version})` : ''}`;
    try {
      const { updated, waiting } = updateShippedMods(home, ws.modsDir, examplesDir);
      if (updated.length) say(`mods          updated to the new version: ${updated.map(vers).join(', ')}`);
      if (waiting.length) {
        say(`mods          new version waiting, not installed because you changed these: ${waiting.map(vers).join(', ')}`);
        say('              (the side panel offers it on each: use it, keep yours, or merge them with your agent)');
      }
    } catch (e) {
      say(`mods          couldn't update the mods TRIF ships: ${e.message}`);
    }
  }
  const claudeSrc = path.join(helperDir, 'workspace', 'CLAUDE.md');
  const claude = fs.existsSync(claudeSrc) ? fs.readFileSync(claudeSrc, 'utf8') : '@AGENTS.md\n@instructions.md\n';
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), claude);

  // Side panel agent runs: Claude Code's permissions for the workspace (overwritten every time), and
  // this terminal's PATH, since Chrome starts the helper with a minimal one and agents live on PATH.
  const agents = require('./agents');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(agents.CLAUDE_SETTINGS, null, 2) + '\n');
  const rec = recordPath(home, cleanPath(process.env.PATH), ws.modsDir);
  if (rec.error) say(`              couldn't record PATH for agents: ${rec.error}`);
  const found = agents.listAgents(P.workspace(opts.home), { version: false }).agents;
  say(`agents        ${found.map((a) => (a.available ? `${a.id} (${a.path})` : `${a.id} not found`)).join(', ')}`);

  // 3. Wrappers
  const nodePath = pickNodePath();
  const hostJs = path.join(helperDir, 'host.js');
  const cliJs = path.join(helperDir, 'cli.js');
  writeIfChanged(ws.hostWrapper, hostWrapperContent(nodePath, home, hostJs), 0o755);
  writeIfChanged(ws.cliWrapper, cliWrapperContent(nodePath, home, cliJs), 0o755);
  // The same under the names from before 0.2.0: `webmods` stays an alias of `trif`, and a native host
  // manifest this setup doesn't rewrite (a browser it didn't select) may still name webmods-host.
  writeIfChanged(ws.legacyHostWrapper, hostWrapperContent(nodePath, home, hostJs), 0o755);
  writeIfChanged(ws.legacyCliWrapper, cliWrapperContent(nodePath, home, cliJs), 0o755);
  say(`host wrapper  ${ws.hostWrapper} -> ${hostJs} (node ${nodePath})`);
  say(`CLI wrapper   ${ws.cliWrapper} -> ${cliJs} (also as ${path.basename(ws.legacyCliWrapper)}, its old name)`);

  // 4. Native host manifests, accepting every TRIF extension ID.
  const { ids, invalid } = P.extensionIds(ws.config);
  say(`extension IDs ${ids.join(', ')}`);
  if (invalid.length) say(`              ignored config.json extensionIds entries that aren't extension IDs: ${invalid.map((x) => JSON.stringify(x)).join(', ')}`);
  let targets;
  if (opts.nativeDir) {
    targets = [{ key: 'custom', label: 'custom', nativeDir: path.resolve(opts.nativeDir) }];
  } else {
    targets = selectBrowsers(opts.browser);
    if (!targets.length) {
      say('browsers      no browser profile folder found; installing for Google Chrome anyway');
      targets = selectBrowsers('chrome');
    }
    if (legacySafari && !targets.some((t) => t.safari)) {
      say('browsers      also Safari: its bridge from before 0.2.0 was installed, and is replaced by the new one');
      targets.push(...selectBrowsers('safari'));
    }
  }
  const origins = P.extensionOrigins(ws.config);
  const manifests = [];
  for (const t of targets) {
    if (t.safari) {
      // The key the bridge asks of connections; TRIF's Safari app reads it from the private folder (its
      // sandbox allows that path, and until 0.2.0's app the old ones in ~/.trif and ~/.webmods) and hands
      // it to the extension.
      const tokenFile = ws.safariToken;
      if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, require('crypto').randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
      fs.chmodSync(tokenFile, 0o600);
      if (!P.isDefaultHome(home) || ws.private !== P.defaultPrivateDir()) {
        say(`              warning: Safari's TRIF app only looks for ${path.join(P.defaultPrivateDir(), 'safari-token')}, so Safari`);
        say(`              can't connect to a workspace elsewhere (${home})`);
      } else if (priv.moved.includes('safari-token')) {
        say('              the key moved: install TRIF.app from this version (older ones look for it in ~/.trif)');
      }
      const plist = opts.launchAgentsDir ? path.join(path.resolve(opts.launchAgentsDir), path.basename(safariAgentPlist())) : safariAgentPlist();
      const bridgeJs = path.join(helperDir, 'safari-bridge.js');
      try {
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        const how = writeIfChanged(plist, safariAgentContent(nodePath, bridgeJs, home, ws.safariBridgeErr));
        manifests.push({ browser: t.key, file: plist });
        say(`Safari bridge ${plist} -> ${bridgeJs} (${how})`);
        // The agent from before 0.2.0: loadSafariAgent stops it; its file goes now.
        if (fs.existsSync(legacyPlist)) { fs.rmSync(legacyPlist, { force: true }); say(`              removed ${legacyPlist} (its name before 0.2.0)`); }
        if (useLaunchctl) {
          const { error, later } = loadSafariAgent(plist, { changed: how !== 'unchanged' });
          if (error) { ok = false; say(`              FAILED to start it: ${error}`); }
          else if (later) say('              restarting in a few seconds, onto this version');
          else say('              running (it starts again whenever you log in)');
        }
      } catch (e) {
        ok = false;
        say(`Safari bridge FAILED to write ${plist}: ${e.message}`);
      }
      continue;
    }
    const file = path.join(t.nativeDir, `${P.HOST_NAME}.json`);
    const manifest = JSON.stringify(manifestFor(ws.hostWrapper, origins, { firefox: t.firefox }), null, 2) + '\n';
    try {
      fs.mkdirSync(t.nativeDir, { recursive: true });
      const how = writeIfChanged(file, manifest);
      manifests.push({ browser: t.key, file });
      say(`native host   ${t.label}: ${file} (${how})`);
    } catch (e) {
      ok = false;
      say(`native host   ${t.label}: FAILED to write ${file}: ${e.message}`);
    }
  }

  // 5. CLI link
  const binDir = opts.binDir ? path.resolve(opts.binDir) : '/usr/local/bin';
  const link = path.join(binDir, P.CLI_NAME);
  if (opts.noLink) {
    say('CLI link      skipped (--no-link)');
  } else {
    let lst = null;
    try { lst = fs.lstatSync(link); } catch { /* none */ }
    if (lst && !lst.isSymbolicLink()) {
      say(`CLI link      ${link} exists and is not a symlink; left it alone`);
    } else if (lst && fs.readlinkSync(link) === ws.cliWrapper) {
      say(`CLI link      ${link} -> ${ws.cliWrapper} (already)`);
    } else {
      try {
        fs.accessSync(binDir, fs.constants.W_OK);
        if (lst) fs.unlinkSync(link);
        fs.symlinkSync(ws.cliWrapper, link);
        say(`CLI link      ${link} -> ${ws.cliWrapper}`);
      } catch (e) {
        say(`CLI link      ${binDir} isn't writable; skipped (optional: sudo ln -sf ${shq(ws.cliWrapper)} ${link})`);
      }
    }
  }

  // 6. PATH
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).map((d) => path.resolve(d));
  const linked = (() => { try { return fs.readlinkSync(link) === ws.cliWrapper; } catch { return false; } })();
  const onPath = pathDirs.includes(path.resolve(ws.bin)) || (linked && pathDirs.includes(binDir));
  if (!onPath) {
    const rc = rcFileHint();
    say('');
    say(`PATH          ${ws.bin} is not on your PATH. Add it with:`);
    if (rc) say(`                echo 'export PATH="${ws.bin}:$PATH"' >> ${rc}   (then open a new terminal)`);
    else say(`                fish_add_path ${ws.bin}`);
  }

  // 7. Next steps (Firefox's or Safari's alone when it's the only browser set up). The `trif` commands in
  // them as they work from this terminal: plain `trif` only when it's on PATH (just said if it isn't).
  const trif = onPath ? P.CLI_NAME : homeRelative(ws.cliWrapper);
  // The last words: the panel first (where a newcomer starts), the terminal route as an aside.
  const sayThen = () => {
    say('  Then open any website, click the TRIF icon, and ask for a change.');
    say(`  (Or work with your coding agent in ${home}: it reads AGENTS.md there.)`);
  };
  say('');
  say('Next steps:');
  const safariSteps = (n) => [
    // (No download yet: TRIF.app is built from a checkout, scripts/build-safari.js.)
    `${n}. TRIF for Safari isn't a download yet: in a checkout of the TRIF repo, run`,
    '   node scripts/build-safari.js (needs Xcode), then open dist/safari-app/TRIF.app once: it adds the',
    '   TRIF extension to Safari.',
    `${n + 1}. Until TRIF is signed by Apple, let Safari run it: Safari → Settings → Advanced, tick "Show`,
    '   features for web developers"; then Settings → Developer, tick "Allow unsigned extensions" (Safari',
    '   turns this off whenever it quits, so tick it again after restarting Safari).',
    `${n + 2}. Safari → Settings → Extensions: tick TRIF, and allow it on every website.`,
    `${n + 3}. Click the TRIF toolbar button to open the panel (in Safari it's a window of its own).`,
  ];
  if (targets.every((t) => t.safari)) {
    for (const l of safariSteps(1)) say(`  ${l}`);
    say(`  5. Check everything with: ${trif} doctor`);
    sayThen();
    return { ok, lines, ws, manifests, nodePath, mode, root, migration };
  }
  // setup installs no add-on: Firefox only keeps signed ones, and Mozilla signs each release's. The
  // newest is on the latest GitHub release (scripts/release.js), from package.json's repository.
  const xpiUrl = firefoxAddonUrl();
  if (!targets.some((t) => !t.firefox && !t.safari)) {
    if (xpiUrl) {
      say('  1. Open this link in Firefox to install the TRIF add-on, and click Add:');
      say(`       ${xpiUrl}`);
      say('     (If Firefox downloads it instead, drag trif-firefox.xpi onto a Firefox window.)');
    } else {
      say('  1. Open the signed TRIF add-on (trif-firefox.xpi) in Firefox, e.g. drag it onto a Firefox');
      say('     window, and click Add.');
    }
    say('  2. On the TRIF tab Firefox opens, click "Allow user scripts", then Allow.');
    say('  3. If Firefox was already running before this setup, quit it completely and reopen it.');
    say(`  4. Check everything with: ${trif} doctor`);
    if (targets.some((t) => t.safari)) { say('  Safari:'); for (const l of safariSteps(1)) say(`    ${l}`); }
    sayThen();
    return { ok, lines, ws, manifests, nodePath, mode, root, migration };
  }
  // The extension folder is hidden (~/.trif) from Load unpacked's file picker, so on a Mac show it in
  // Finder, ready to drag onto chrome://extensions, and put its path on the clipboard for Cmd-Shift-G.
  const revealed = !!opts.reveal && revealFolder(extensionDir);
  say('  1. Install the extension. Until TRIF is on the Chrome Web Store, load it unpacked:');
  if (revealed) {
    say('     open chrome://extensions and turn on "Developer mode" (top right). Then drag the "extension"');
    say('     folder from the Finder window that just opened onto that page. (Or click "Load unpacked",');
    say(`     press Cmd-Shift-G and paste: the folder's path, ${extensionDir}, is on your clipboard.)`);
  } else {
    say('     open chrome://extensions, turn on "Developer mode" (top right), click "Load unpacked"');
    say(`     and choose ${extensionDir}`);
  }
  say(`     (its ID must be ${P.EXTENSION_ID}).${mode === 'copy' ? ' Keep that folder: Chrome runs the extension from it,' : ''}`);
  if (mode === 'copy') say('     and setup updates it in place. (A Web Store listing will replace this step later.)');
  say('  2. Turn on "Allow User Scripts": click "Open extension settings" on the TRIF tab Chrome opens,');
  say('     or "Details" on TRIF in chrome://extensions.');
  say(`  3. Check everything with: ${trif} doctor`);
  if (targets.some((t) => t.firefox)) {
    if (xpiUrl) {
      say('  Firefox: open this link in Firefox to install the TRIF add-on:');
      say(`       ${xpiUrl}`);
      say('     Then click "Allow user scripts" on the TRIF tab Firefox opens. Restart Firefox if it was');
      say('     running before this setup.');
    } else {
      say('  Firefox: open the signed TRIF add-on (.xpi) in Firefox to install it, then click "Allow user');
      say('     scripts" on the TRIF tab it opens. Restart Firefox if it was running before this setup.');
    }
  }
  if (targets.some((t) => t.safari)) { say('  Safari:'); for (const l of safariSteps(1)) say(`    ${l}`); }
  sayThen();

  return { ok, lines, ws, manifests, nodePath, mode, root, migration };
}

module.exports = {
  setup, recordPath, cleanPath, hostWrapperContent, cliWrapperContent, manifestFor, pickNodePath, shq, isExecutable,
  chooseMode, installApp, sameTree, COPY_ITEMS, safariAgentContent, loadSafariAgent,
};
