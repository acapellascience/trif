'use strict';
// Agent runs for the side panel (and `trif agent run`): spawn the user's coding agent headless in
// the workspace, turn its stdout into normalized events, and always finish with exactly one `done`.
// See docs/PROTOCOL.md "Side panel and agent runs".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar } = require('./env');
const crypto = require('crypto');
const { spawn } = require('child_process');
const agents = require('./agents');
const { scopeFor } = require('./scope');
const { readInstructions, instructionsContext } = require('./instructions');
const { markRunActive, markRunEnded } = require('./origins');
const { listModFiles } = require('./mods');
const { redactSecrets } = require('./agents/util');
const { within, ignoresCase } = require('./pathcheck');
const { migratePrivate, privateLeftovers } = require('./migrate');

const RUN_TIMEOUT_MS = Number(envVar('AGENT_TIMEOUT_MS')) > 0 ? Number(envVar('AGENT_TIMEOUT_MS')) : 15 * 60 * 1000;
const KILL_GRACE_MS = Number(envVar('AGENT_KILL_GRACE_MS')) > 0 ? Number(envVar('AGENT_KILL_GRACE_MS')) : 3000;
const KEEP_RUN_LOGS = 50;
const STDERR_KEEP = 16 * 1024;
const MAX_SNAPSHOT_FILES = 5000;
// Finished runs still count for held mods this long (a last write can reach the folder watcher late).
const RECENT_MS = 10000;

const MAX_BOX_REQUEST = 8 * 1024 * 1024;
// Screenshots (the private folder's screenshots/, a folder per site) are kept this long.
const SCREENSHOT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Delete files older than SCREENSHOT_KEEP_MS in `root` and its folders (links aren't followed). */
function pruneScreenshots(root, now = Date.now()) {
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      try { if ((e.isFile() || e.isSymbolicLink()) && now - fs.lstatSync(p).mtimeMs > SCREENSHOT_KEEP_MS) fs.unlinkSync(p); } catch { /* gone */ }
    }
  };
  walk(root, 1);
}

/**
 * Where runs' mailboxes go: outside the workspace and the temp folder, which agents' sandboxes may write
 * by default, so a run can only write its own mailbox (opened for it alone), never another run's (whose
 * requests would carry that run's site). Inside the home folder's Library (or ~/.cache), which runs can't
 * read at all.
 */
function boxRoot() {
  if (envVar('BOX_ROOT')) return path.resolve(envVar('BOX_ROOT'));
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'TRIF', 'boxes')
    : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'trif', 'boxes');
}

// sha1 of every mod file the scanner loads (mods.js listModFiles: same folders, same symlink handling,
// no cap), relative to `base`. What held mods are decided on: a run can't put a mod where this doesn't look.
function modSnapshot(modsDir, base) {
  const out = new Map();
  for (const { file } of listModFiles(modsDir)) {
    try { out.set(path.relative(base, file), crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')); } catch { /* vanished */ }
  }
  return out;
}

// sha1 of every file under `dir` (relative to `base`), skipping dot-folders, for the `changedFiles` a run
// reports. Capped for sanity; held mods use modSnapshot.
function snapshot(dir, base) {
  const out = new Map();
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_SNAPSHOT_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p); continue; }
      if (!e.isFile()) continue;
      try { out.set(path.relative(base, p), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')); } catch { /* vanished */ }
    }
  };
  walk(dir);
  return out;
}

function diffSnapshots(before, after) {
  const changed = new Set();
  for (const [f, h] of after) if (before.get(f) !== h) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  return [...changed].sort();
}

// A session id or model name goes on the agent's command line as an option's value: one word, never
// something the CLI could read as an option of its own.
const WORD = /^[A-Za-z0-9][\w.:/@+[\]-]{0,199}$/;
function checkWord(v, what) {
  if (!WORD.test(v)) throw new Error(`bad ${what}: one word of letters, digits and . _ - : / @ + [ ], not starting with a symbol`);
  return v;
}

function newRunId() {
  return 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// The system's real path (links resolved; on macOS each component in its on-disk case, which sandboxes
// and the comparisons below need), else the path as given, resolved.
function realOrResolved(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

// What the helper keeps that runs may not read (settings, the Safari bridge's key, logs, other runs' logs,
// screenshots) is in the private folder (paths.js privateDir), outside the workspace, since 0.2.0.
const { PRIVATE_FILES } = require('./paths');

// ---------------------------------------------------------------- folders a run may write
//
// A folder a run may write can be deleted by that run and replaced with a link (macOS's sandbox allows it:
// the writable path itself is inside what's allowed). If the next run's limits came from the real path of
// that folder, they would follow the link: `rm -rf "$TRIF_RUN_SCREENSHOTS"; ln -s ~/.trif/bin "$_"` in one
// run, and the next run on the site could rewrite trif-host, which the browser starts outside any sandbox.
// So a writable folder's place is never taken from a realpath of something a run could have replaced:
//   - the run's screenshots folder (screenshotsFolder): a link or file in its place (or in its parent's,
//     `<private>/screenshots`) is removed, never followed, and the folder made again; its real path must
//     then be its parent's real path plus its name, or the run is refused; links inside it are removed.
//   - the mods folder (checkModsFolder): a run is refused when it's a link or not a folder, or when its real
//     path isn't the one `trif setup` recorded (config.json modsDirReal, in the private folder).
//   - the mailbox: made fresh for each run, without `recursive`, so it can't already be anything.
// Links a run leaves inside the mods folder (or the trash, where deleted mods go) don't widen the next
// run's limits either: sandboxes resolve them and check the real path, and Claude Code's own file tools,
// which run outside the sandbox, get deny rules for them (workspaceLinks).

const LINK_WALK_DEPTH = 4;
const LINK_WALK_MAX = 5000;

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

// `p` as a plain folder: a link (or file) in its place is removed without following it, and a missing
// folder made (not recursively: its parent must already be a folder).
function plainFolder(p) {
  let st = lstatOrNull(p);
  if (st && !st.isDirectory()) { fs.unlinkSync(p); st = null; }
  if (!st) fs.mkdirSync(p, { mode: 0o700 });
}

// Every link under `dir` (links aren't followed), a few levels down, at most LINK_WALK_MAX entries.
function linksUnder(dir, depth = LINK_WALK_DEPTH) {
  const out = [];
  let seen = 0;
  const walk = (d, level) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > LINK_WALK_MAX) return;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out.push(p);
      else if (e.isDirectory() && level < depth) walk(p, level + 1);
    }
  };
  walk(dir, 1);
  return out;
}

function screenshotsName(scope) {
  const name = String(scope || '').replace(/[^a-z0-9.-]/gi, '_');
  return !name || /^\.+$/.test(name) ? 'site' : name;
}

/**
 * The run's screenshots folder, `<private>/screenshots/<scope>`, made safe to hand to the run as writable
 * (see above). Returns {dir, real}: its path and its real path. Throws when it can't be.
 */
function screenshotsFolder(ws, scope) {
  fs.mkdirSync(ws.private, { recursive: true, mode: 0o700 });
  plainFolder(ws.screenshots);
  const name = screenshotsName(scope);
  const dir = path.join(ws.screenshots, name);
  plainFolder(dir);
  const root = fs.realpathSync.native(ws.screenshots);
  const real = fs.realpathSync.native(dir);
  if (!within(real, path.join(root, name), { ci: ignoresCase(root), orEqual: true })) {
    throw new Error(`the run's screenshots folder ${dir} leads to ${real}, not into ${root}`);
  }
  // Links in it (left by an earlier run) would lead Claude Code's Read tool, allowed in this folder,
  // elsewhere. Only screenshots belong here.
  for (const l of linksUnder(real)) { try { fs.unlinkSync(l); } catch { /* gone */ } }
  return { dir, real };
}

/**
 * Throws unless the mods folder is a plain folder (made if missing) whose real path is the one `trif setup`
 * recorded for it, if it recorded one (config.json modsDirReal: {path, real}). Returns its real path.
 */
function checkModsFolder(ws) {
  const dir = ws.modsDir;
  let st = lstatOrNull(dir);
  if (!st) { fs.mkdirSync(dir, { recursive: true }); st = lstatOrNull(dir); }
  const fix = 'If you made it so, set "modsDir" in TRIF\'s config.json to the folder itself; otherwise remove it and run `trif setup` in a terminal.';
  if (st && st.isSymbolicLink()) {
    let to = '';
    try { to = ` (to ${fs.readlinkSync(dir)})`; } catch { /* ignore */ }
    throw new Error(`The mods folder ${dir} is a link${to}. Agent runs may write the mods folder, so TRIF won't start one through a link. ${fix}`);
  }
  if (!st || !st.isDirectory()) throw new Error(`The mods folder ${dir} isn't a folder. ${fix}`);
  const real = fs.realpathSync.native(dir);
  const rec = ws.config && ws.config.modsDirReal;
  if (rec && typeof rec === 'object' && rec.path === dir && typeof rec.real === 'string' && rec.real) {
    if (!within(real, rec.real, { ci: ignoresCase(real), orEqual: true }) || !within(rec.real, real, { ci: ignoresCase(real), orEqual: true })) {
      throw new Error(`The mods folder ${dir} now leads to ${real}, not ${rec.real} as when TRIF was set up. If you moved it, run \`trif setup\` in a terminal.`);
    }
  }
  return real;
}

/**
 * Links in the mods folder and the trash (deleted mods), which runs may read in full, and what each may
 * be used for by Claude Code's own file tools (outside the sandbox; they match rules against the path
 * they're given): [{path, read, edit}]. `edit` false when it leads out of the mods folder (or nowhere),
 * `read` false when it leads where the run may not read (`deniedTarget(realPath)`) or nowhere.
 */
function workspaceLinks(ws, realMods, deniedTarget) {
  const ci = ignoresCase(realMods);
  const out = [];
  const realHome = realOrResolved(ws.home);
  for (const [dir, literal] of [[realMods, realMods], [path.join(ws.home, 'trash'), path.join(realHome, 'trash')]]) {
    if (!lstatOrNull(dir)) continue;
    for (const l of linksUnder(dir)) {
      let target = null;
      try { target = fs.realpathSync.native(l); } catch { /* dangling */ }
      const p = path.join(literal, path.relative(dir, l));
      const edit = !!target && within(target, realMods, { ci });
      const read = !!target && !deniedTarget(target);
      if (!edit || !read) out.push({ path: p, read, edit });
    }
  }
  return out;
}

// The TRIF code a run's `trif` needs (helper/, and package.json for the version) and the examples
// (`trif install-example`): not the whole package folder, which in a git checkout holds .git, keys
// and build output.
const CODE_ITEMS = ['helper', 'package.json', 'examples'];
function trifCode(root = path.join(__dirname, '..', '..')) {
  return CODE_ITEMS.map((n) => path.join(root, n)).filter((p) => fs.existsSync(p)).map(realOrResolved);
}

// Where the user's agent skills live: Codex reads ~/.agents/skills (and ~/.codex/skills), Claude Code
// ~/.claude/skills. Each is often a link to a folder elsewhere (~/.claude/skills/x -> ~/.agents/skills/x).
const SKILL_FOLDERS = [['.agents', 'skills'], ['.codex', 'skills'], ['.claude', 'skills']];

/**
 * The user's skill folders, as real paths, for runs to read (never write): each skills folder, and where
 * each skill in it really is. Left out: a link that leads to the home folder itself, above it, or to the
 * root (it would open everything), and one into a visible folder of the home folder (~/Documents…), whose
 * other contents would have to be listed to deny them, which can make macOS ask the user.
 */
function skillDirs(homedir = os.homedir()) {
  const home = realOrResolved(homedir);
  const ci = ignoresCase(home);
  const inside = (p, q) => within(p, q, { ci });
  const same = (p, q) => within(p, q, { ci, orEqual: true }) && within(q, p, { ci, orEqual: true });
  const hiddenOrOutside = (p) => !inside(p, home) || p.slice(home.length + 1).startsWith('.');
  const ok = (p) => p !== '/' && !same(p, home) && !inside(home, p) && hiddenOrOutside(p);
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const out = new Set();
  for (const parts of SKILL_FOLDERS) {
    const base = path.join(homedir, ...parts);
    if (!isDir(base)) continue;
    const realBase = realOrResolved(base);
    if (ok(realBase)) out.add(realBase);
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) {
      const p = path.join(base, n);
      if (!isDir(p)) continue;
      const r = realOrResolved(p);
      if (ok(r) && !inside(r, realBase)) out.add(r);
    }
  }
  const all = [...out];
  return all.filter((p) => !all.some((q) => inside(p, q))); // inside another one: covered
}

// Inside skill folders: what looks like a secret (a skill folder can hold a token or an .env file next to
// its scripts). Dotfiles and dot-folders, except Codex's built-in skills folder `.system`, and these names.
const SKILL_SECRET = /^\.env|\.pem$|\.key$|^credentials|^secrets|^token/i;
const SKILL_WALK_DEPTH = 4;
const SKILL_WALK_MAX = 5000;

/**
 * What a run mustn't read inside the readable skill folders (`skills`, real paths, from skillDirs):
 *   secrets  [{path, dir}]: dotfiles and dot-folders (but `.system`) and SKILL_SECRET names, a few levels
 *            down (SKILL_WALK_DEPTH; at most SKILL_WALK_MAX entries looked at): real paths, for the
 *            sandboxes and for Claude Code's Read rules
 *   links    links inside them that lead somewhere the run may not read (`deniedTarget(realPath)`), or
 *            nowhere: sandboxes follow links to the real path and deny it there, but Claude Code's own Read
 *            tool runs outside the sandbox and matches its rules against the path it's given, which a
 *            Read(//<skills>/**) allow covers. Links aren't followed by the walk.
 */
function skillSecrets(skills, deniedTarget = () => false) {
  const secrets = [];
  const links = [];
  let seen = 0;
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > SKILL_WALK_MAX) return;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        let target = null;
        try { target = fs.realpathSync.native(p); } catch { /* dangling */ }
        if (!target || deniedTarget(target)) links.push(p);
        continue;
      }
      const isDir = e.isDirectory();
      if ((e.name.startsWith('.') && !(isDir && e.name === '.system')) || SKILL_SECRET.test(e.name)) { secrets.push({ path: p, dir: isDir }); continue; }
      if (isDir && depth < SKILL_WALK_DEPTH) walk(p, depth + 1);
    }
  };
  for (const s of skills) walk(s, 1);
  return { secrets, links };
}

// Folders of the home folder that macOS asks the user about before a program may list them (privacy
// protections): never looked into here.
const PROTECTED = new Set(['desktop', 'documents', 'downloads', 'library', 'movies', 'music', 'pictures', 'public']);

/**
 * What in the home folder to deny so that only `readable` (and the way to it) can be read: each item in
 * the home folder, except those `readable` paths are in or lead through; inside folders that lead through
 * (~/.claude for ~/.claude/skills, ~/src for a TRIF checkout's ~/src/trif/helper), every other item, and so
 * on down. (Not inside ~/Documents and the other PROTECTED folders: listing them can make macOS ask the
 * user.) By where each item leads, too. Compared as the volume does (case, on macOS).
 */
function deniedInHome(home, readable) {
  const real = realOrResolved;
  const ci = ignoresCase(home);
  // A readable folder that is the home folder or holds it (node in ~/bin makes node's folder the home
  // folder) mustn't excuse anything: every item would count as readable and nothing would be denied.
  // The sandbox still denies the items listed here inside it (the more specific path wins).
  const inner = readable.filter((r) => !within(home, r, { ci, orEqual: true }));
  const covered = (p) => inner.some((r) => within(p, r, { ci, orEqual: true }));
  const onTheWay = (p) => inner.some((r) => within(r, p, { ci }));
  const out = [];
  const walk = (dir, depth) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; } // unreadable: nothing to list
    for (const n of names) {
      const p = path.join(dir, n);
      const rp = real(p);
      if (covered(p) || covered(rp)) continue;
      if (onTheWay(p) || onTheWay(rp)) { if (!(depth === 0 && PROTECTED.has(n.toLowerCase()))) walk(p, depth + 1); continue; }
      out.push(p);
    }
  };
  walk(home, 0);
  return out;
}

// Folders outside the home folder that hold other people's files or other disks: other users' home
// folders, other volumes (external drives, disk images, network shares).
const SHARED_ROOTS = process.platform === 'darwin' ? ['/Volumes', '/Users'] : ['/home', '/media', '/mnt', '/run/media'];

/**
 * macOS: the user's own folder beside the temporary one (/var/folders/xx/…/: C, the user's caches, X, 0),
 * whose temporary folder T the agents deny by their own means. Each item but T, as real paths.
 */
function userTempSiblings(tmpdir = os.tmpdir()) {
  const t = realOrResolved(tmpdir);
  if (process.platform !== 'darwin' || !/^\/private\/var\/folders\//.test(t)) return [];
  const parent = path.dirname(t);
  try { return fs.readdirSync(parent).map((n) => path.join(parent, n)).filter((p) => p !== t); } catch { return []; }
}

/**
 * What to deny outside the home folder: each item in SHARED_ROOTS (real paths, as sandboxes compare),
 * except the home folder itself and what leads to it (deniedInHome handles it), what leads to
 * something the run may read, and the link to the startup disk (/Volumes/Macintosh HD -> /). The
 * system's temporary folders are denied by the agents' own means (codex.js :tmpdir, :slash_tmp);
 * the user's own folder beside $TMPDIR (userTempSiblings) is added here.
 */
function deniedOutsideHome(home, readable, roots = SHARED_ROOTS) {
  const ci = ignoresCase(home);
  const holds = (outer, p) => within(p, outer, { ci, orEqual: true });
  const out = [];
  for (const root of roots) {
    let names;
    try { names = fs.readdirSync(root); } catch { continue; } // not on this system
    for (const n of names) {
      const p = path.join(root, n);
      const rp = realOrResolved(p);
      if (rp === path.parse(rp).root) continue; // the startup disk
      if ([p, rp].some((x) => holds(x, home) || readable.some((r) => holds(x, r)))) continue;
      out.push(rp);
    }
  }
  return [...new Set([...out, ...userTempSiblings()])];
}

/**
 * What a run may touch, for the agents' sandboxes, which macOS enforces (docs/PROTOCOL.md "Run scope"):
 *   readable  the workspace, all of it (nothing private is kept there), the TRIF code `trif` runs
 *             (trifCode), node, and the user's skill folders (skillDirs)
 *   writable  the mods folder, this run's screenshots folder, and its mailbox (`box`)
 *   readOnly  every existing mod folder of another site (all-sites/ included), inside the mods folder
 *   denied    everything else in the home folder, the private folder (paths.js privateDir: settings,
 *             logs, other runs' logs, screenshots; denied by name too, wherever it is), and what looks
 *             like a secret inside the skill folders (skillSecrets). The run's own screenshots folder
 *             (in the private folder) and mailbox (in ~/Library/Caches) are allowed inside what's denied:
 *             the more specific path wins. Each item in the home folder rather than the folder itself:
 *             node, and `mkdir -p`, look at every folder on a path, the home folder included.
 * The only denies inside readable folders are the skill folders' secrets. No network at all: `trif`
 * reaches the helper through the mailbox. Real paths, as sandboxes compare.
 */
function runLimits(ws, { scope, box, screenshotsReal, modsReal }) {
  ws = withPrivatePaths(ws);
  const real = realOrResolved;
  const node = real(process.execPath);
  const home = real(os.homedir());
  const ci = ignoresCase(home);
  const skills = skillDirs(os.homedir());
  const privateDir = real(ws.private || require('./paths').privateDir(ws.home));
  const readable = [...new Set([real(ws.home), ...trifCode(), path.dirname(path.dirname(node)), ...skills])];
  // The writable folders as checked when the run's folders were made (screenshotsFolder, checkModsFolder,
  // the fresh mailbox): never a realpath of something a run could have replaced since.
  const mods = modsReal || checkModsFolder(ws);
  const shots = screenshotsReal || screenshotsFolder(ws, scope).real;
  const writable = [mods, shots, real(box)];
  let names = [];
  try { names = fs.readdirSync(mods, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name); } catch { /* none yet */ }
  const otherSites = names.filter((n) => scopeFor(n) !== scope);
  // Each such folder by its path in the workspace (`literal`, what Claude Code's file tools match rules
  // against: a site folder can be a link) and its real path (`real`, what sandboxes compare); `rel` names
  // it as modSnapshot names files.
  const lockedDirs = otherSites.map((n) => ({ rel: path.relative(ws.home, path.join(ws.modsDir, n)), literal: path.join(mods, n), real: real(path.join(mods, n)) }));
  // Read-only for the sandboxes: only those inside the mods folder. A site folder that is a link out of it
  // isn't a mod folder (mods.js ignores it), and making where it leads "read" would open it to the run
  // (in Codex's profile, a more specific path wins over the home folder's denies).
  const readOnly = lockedDirs.map((d) => d.real).filter((r) => within(r, mods, { ci: ignoresCase(mods) }));
  // (By where each leads, too: ~/.webmods is a link to the workspace, ~/.trif, since 0.2.0, and a rule
  // denying it would deny the workspace itself to a sandbox that follows links.)
  const inHome = deniedInHome(home, readable);
  // Inside the skill folders: secrets, and links to what the run may not read (skillSecrets).
  const under = (p, list) => list.some((r) => within(p, r, { ci, orEqual: true }));
  const deniedTarget = (t) => under(t, [privateDir]) || (within(t, home, { ci }) && (!under(t, readable) || under(t, inHome)));
  const { secrets, links } = skillSecrets(skills, deniedTarget);
  const skillDenied = secrets.map((x) => x.path);
  const denied = [...inHome, ...deniedOutsideHome(home, readable), privateDir, ...skillDenied];
  // The same read-only folders relative to the workspace, as modSnapshot names files: a change under them
  // can't be the run's doing (held.js). Only once the agent's adapter has protected each one: its
  // command() returns `locked`, the ones it did (runs.js uses that, not this).
  const locked = lockedDirs.map((d) => d.rel);
  // Links in the mods folder and the trash that lead out of it (or where the run may not read).
  const wsLinks = workspaceLinks(ws, mods, (t) => !within(t, shots, { ci, orEqual: true }) && deniedTarget(t));
  // The run's temporary folder (its commands'; Codex's own stays where it is), in its box: runs.js makes it.
  const tmp = path.join(real(box), 'tmp');
  // Claude Code's own (CLAUDE_CODE_TMPDIR), which its commands' sandbox may always write: one of the run's
  // own, short (Claude Code 2.1.316 falls back to the /tmp/claude-<uid> every session shares when
  // <it>/claude-<uid> is longer than 44 bytes), as the literal /tmp path it measures. runs.js makes it.
  const agentTmp = shortTmp(box);
  // The system's temporary folders the run may neither read nor write: every Claude Code session's
  // scratch files and task output (/tmp/claude-<uid>), and $TMPDIR. (codex.js denies /tmp and $TMPDIR
  // whole, by its own names; Claude Code's commands need /tmp for agentTmp.)
  const systemTemp = [...new Set([path.join(real('/tmp'), `claude-${typeof process.getuid === 'function' ? process.getuid() : 0}`), real(os.tmpdir())])]
    .filter((p) => !within(tmp, p, { ci, orEqual: true }) && !within(real(agentTmp), p, { ci, orEqual: true }));
  return { readable, writable, readOnly, locked, lockedDirs, denied, home, skills, skillSecrets: secrets, skillLinks: links, workspaceLinks: wsLinks, privateDir, workspace: real(ws.home), box: real(box), tmp, agentTmp, systemTemp, screenshots: shots, modsDir: mods };
}

/**
 * A run's short temporary folder for Claude Code itself (runLimits agentTmp): /tmp/trif-<the last 8 of the
 * run id>, its random end (newRunId: the start of it is the time, the same for runs started together).
 */
function shortTmp(box) {
  return path.join('/tmp', `trif-${path.basename(box).replace(/[^\w-]/g, '').slice(-8)}`);
}

/** ws with its private folder's paths (paths.js workspace has them; a hand-made ws may not). */
function withPrivatePaths(ws) {
  if (ws.private && ws.runs && ws.screenshots) return ws;
  const priv = ws.private || require('./paths').privateDir(ws.home);
  return { ...ws, private: priv, runs: ws.runs || path.join(priv, 'runs'), screenshots: ws.screenshots || path.join(priv, 'screenshots') };
}

function normalizeSite(site, url) {
  let s = typeof site === 'string' && site.trim() ? site.trim() : agents.hostOf(url);
  s = s.toLowerCase().replace(/^www\./, '');
  return s;
}

/**
 * new Runs({ getWorkspace: () => ws, logger, onEvent: (runId, event) => void })
 *   start(args) -> {runId}     args: {agent, model, site, url, tabId, prompt, sessionId}
 *   stop(runId) -> {stopped: true}
 *   list() -> [{runId, site, scope, agent, startedAt}]
 *   byToken(token) -> the live run whose agent was given this TRIF_RUN_TOKEN, or null
 *   scopes() -> [{runId, site, scope, before, locked, startedAt}] for live and just-finished runs (held
 *     mods; `locked`: the mods folders the run couldn't write, relative to the workspace)
 *   stopAll() -> Promise (resolves once every agent process has exited, SIGKILLing stragglers)
 */
class Runs {
  /**
   * onRequest(run, line, respond): a request from the run's mailbox (one JSON line, as on the socket);
   * respond(text) answers it. The host handles it as the run's, whatever the line says.
   */
  constructor({ getWorkspace, logger, onEvent, onRequest }) {
    this.getWorkspace = getWorkspace;
    this.logger = logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.onEvent = onEvent || (() => {});
    this.onRequest = onRequest || ((run, line, respond) => respond(JSON.stringify({ id: null, ok: false, error: 'no helper commands here' })));
    this.runs = new Map(); // runId -> run
    this.bySite = new Map(); // site -> runId
    this.recent = []; // [{runId, site, scope, before, locked, startedAt, until}]
  }

  list() {
    return [...this.runs.values()].map((r) => ({ runId: r.id, site: r.site, scope: r.scope, agent: r.agent, startedAt: r.startedAt }));
  }

  byToken(token) {
    if (typeof token !== 'string' || !token) return null;
    for (const r of this.runs.values()) if (r.token === token && !r.finished) return r;
    return null;
  }

  scopes() {
    const now = Date.now();
    this.recent = this.recent.filter((r) => r.until > now);
    const live = [...this.runs.values()].map((r) => ({ runId: r.id, site: r.site, scope: r.scope, before: r.before || null, locked: r.locked || [], startedAt: r.startedAt }));
    return [...live, ...this.recent];
  }

  start(args = {}) {
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    if (!prompt.trim()) throw new Error('missing prompt');
    const site = normalizeSite(args.site, args.url);
    if (!site) throw new Error('missing site (pass the page URL)');
    if (this.bySite.has(site)) throw new Error(`already working on ${site}`);
    const ws = withPrivatePaths(this.getWorkspace());
    // Runs may read the whole workspace, so nothing private may be in it: an older helper still running
    // can write its log there again. Move it out (migrate.js), or refuse.
    if (privateLeftovers(ws.home).length) {
      const m = migratePrivate(ws.home, { privateDir: ws.private });
      for (const n of m.notes) this.logger.info(n);
      const left = privateLeftovers(ws.home);
      if (left.length) throw new Error(`TRIF's private files are in the workspace, where agent runs could read them (${left.map((f) => path.relative(ws.home, f)).join(', ')}), and couldn't be moved${m.errors.length ? ` (${m.errors.join('; ')})` : ''}: run \`trif setup\` in a terminal`);
    }
    const agentId = typeof args.agent === 'string' && args.agent ? args.agent : agents.listAgents(ws, { version: false }).default;
    const adapter = agents.getAdapter(agentId);
    if (!adapter) throw new Error(`unknown agent "${agentId}" (known: ${agents.ADAPTERS.map((a) => a.id).join(', ')})`);

    const run = {
      id: newRunId(),
      site,
      scope: scopeFor(site),
      // Given to the agent as TRIF_RUN_TOKEN; `trif` sends it, and the helper scopes its requests.
      token: crypto.randomBytes(16).toString('hex'),
      agent: adapter.id,
      adapter,
      ws,
      url: typeof args.url === 'string' ? args.url : '',
      tabId: args.tabId === undefined || args.tabId === null || args.tabId === '' ? null : args.tabId,
      sessionId: typeof args.sessionId === 'string' && args.sessionId ? checkWord(args.sessionId, 'session id') : null,
      model: typeof args.model === 'string' && args.model.trim() ? checkWord(args.model.trim(), 'model name') : null,
      // codex-oss: this run's provider choice over config.json's (agents/codex-oss.js resolve).
      openModel: args.openModel && typeof args.openModel === 'object' && !Array.isArray(args.openModel) ? { ...args.openModel } : null,
      secrets: [], // values (API keys) kept out of the run's log and events
      prompt,
      startedAt: Date.now(),
      state: { workspace: ws.home },
      child: null,
      stdoutBuf: '',
      stderr: '',
      agentDone: null,
      lastSessionId: null,
      stopped: false,
      timedOut: false,
      finished: false, // _finish ran
      doneSent: false, // the final `done` went out; nothing follows it
      timers: [],
    };
    run.logFile = path.join(ws.runs, `${run.id}.jsonl`);
    run.lastSessionId = run.sessionId;
    this.runs.set(run.id, run);
    this.bySite.set(site, run.id);
    // Launch on the next tick so the caller can send {runId} before the first event.
    setImmediate(() => this._launch(run));
    return { runId: run.id };
  }

  stop(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`no running agent with id ${runId}`);
    run.stopped = true;
    this._kill(run);
    return { stopped: true };
  }

  stopAll(graceMs = 1500) {
    const live = [...this.runs.values()];
    if (!live.length) return Promise.resolve();
    return new Promise((resolve) => {
      for (const run of live) { run.stopped = true; run.shuttingDown = true; this._kill(run, graceMs); }
      const check = setInterval(() => {
        if (![...this.runs.values()].some((r) => live.includes(r))) { clearInterval(check); resolve(); }
      }, 25);
      setTimeout(() => { clearInterval(check); resolve(); }, graceMs + 500).unref();
    });
  }

  // ------------------------------------------------------------ internals

  _emit(run, event) {
    if (run.doneSent) return;
    if (run.secrets.length) { const t = JSON.stringify(event); const r = redactSecrets(t, run.secrets); if (r !== t) event = JSON.parse(r); }
    if (event.kind === 'done') run.doneSent = true;
    try { this.onEvent(run.id, event); } catch (e) { this.logger.error(`agent event handler: ${e.message}`); }
  }

  _log(run, obj) {
    const text = redactSecrets(typeof obj === 'string' ? obj : JSON.stringify(obj), run.secrets);
    try { fs.appendFileSync(run.logFile, text + '\n'); } catch { /* ignore */ }
  }

  _prepareLogDir(run) {
    const dir = path.dirname(run.logFile);
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
    // Mailboxes left by helpers that died mid-run (a live run's is younger than its time limit).
    try {
      for (const f of fs.readdirSync(boxRoot())) {
        const p = path.join(boxRoot(), f);
        try { if (Date.now() - fs.statSync(p).mtimeMs > 2 * RUN_TIMEOUT_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    // And their Claude Code temporary folders (runLimits agentTmp), only the user's own.
    try {
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      for (const f of fs.readdirSync('/tmp')) {
        if (!/^trif-[\w-]{1,8}$/.test(f)) continue;
        const p = path.join('/tmp', f);
        try {
          const st = fs.lstatSync(p);
          if (st.isDirectory() && (uid === null || st.uid === uid) && Date.now() - st.mtimeMs > 2 * RUN_TIMEOUT_MS) fs.rmSync(p, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    // Screenshots older than SCREENSHOT_KEEP_MS (store/PRIVACY.md says so), in every site's folder.
    pruneScreenshots(run.ws.screenshots);
    // Keep the last KEEP_RUN_LOGS - 1 (this run makes KEEP_RUN_LOGS).
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        .map((f) => { try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
      for (const { f } of files.slice(KEEP_RUN_LOGS - 1)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }

  _launch(run) {
    const { ws, adapter } = run;
    this._prepareLogDir(run);
    this._log(run, { webmods: 'start', runId: run.id, agent: run.agent, site: run.site, url: run.url, tabId: run.tabId, sessionId: run.sessionId, model: run.model, prompt: run.prompt, time: run.startedAt });

    if (run.stopped) return this._finish(run, { code: null, signal: null }); // stopped before it started
    // The run's mailbox, its only way to the helper (its sandbox has no network), and its screenshots
    // folder (it may not see other sites' screenshots).
    run.box = path.join(boxRoot(), run.id);
    try {
      // The mods folder first: a link there is a refusal the user should read as is.
      run.modsReal = checkModsFolder(ws);
    } catch (e) {
      this._emit(run, { kind: 'error', message: e.message });
      return this._finish(run, { code: null, signal: null });
    }
    try {
      fs.mkdirSync(boxRoot(), { recursive: true, mode: 0o700 });
      fs.mkdirSync(run.box, { mode: 0o700 }); // (fresh: not recursive, so it can't already be a link)
      fs.mkdirSync(path.join(run.box, 'tmp'), { mode: 0o700 }); // its temporary folder (runLimits tmp)
      // Claude Code's own (runLimits agentTmp; fresh, not recursive: never one someone left there, a link
      // included, nor another run's).
      fs.mkdirSync(shortTmp(run.box), { mode: 0o700 });
      run.agentTmp = shortTmp(run.box);
      const shots = screenshotsFolder(ws, run.scope);
      run.screenshots = shots.dir;
      run.screenshotsReal = shots.real;
    } catch (e) {
      this._emit(run, { kind: 'error', message: `couldn't prepare the run's folders: ${e.message}` });
      return this._finish(run, { code: null, signal: null });
    }
    this._serveBox(run);
    const env = { ...agents.agentEnv(ws), TRIF_RUN_TOKEN: run.token, TRIF_RUN_BOX: run.box, TRIF_RUN_SCREENSHOTS: run.screenshots, TRIF_RUN_MODS_DIR: ws.modsDir };
    const found = adapter.detect({ dirs: agents.searchDirs(ws), env, version: false });
    if (!found.available) {
      this._emit(run, { kind: 'error', message: adapter.missing });
      return this._finish(run, { code: null, signal: null });
    }
    // Adapters with something to settle first (codex-oss: the provider, its key, a local server; claude
    // and codex: a saved API key's proxy, agentkeys.js).
    if (adapter.prepare) {
      adapter.prepare({ ws, model: run.model, openModel: run.openModel, logger: this.logger }).then((prep) => {
        // (cleanup: what prepare started for the run, the key proxy; _finish calls it.)
        if (prep && typeof prep.cleanup === 'function') run.cleanup = prep.cleanup;
        if (run.stopped || run.finished) return this._finish(run, { code: null, signal: null });
        run.secrets = (prep && prep.secrets) || [];
        Object.assign(run.state, (prep && prep.state) || {});
        const om = run.state.openModel;
        if (om) this._log(run, { webmods: 'openModel', provider: om.provider, model: om.model, baseUrl: om.baseUrl, key: om.keyed ? 'keyring' : null, keyProxy: !!run.cleanup });
        const ak = run.state.apiKey;
        if (ak) this._log(run, { webmods: 'apiKey', account: ak.account, source: ak.source, keyProxy: !!run.cleanup });
        const runEnv = { ...env, ...((prep && prep.env) || {}) };
        for (const k of (prep && prep.unsetEnv) || []) delete runEnv[k];
        this._spawn(run, found, runEnv, (prep && prep.options) || {});
      }, (e) => {
        this._emit(run, { kind: 'error', message: e.message });
        this._finish(run, { code: null, signal: null });
      });
      return;
    }
    this._spawn(run, found, env, {});
  }

  _spawn(run, found, env, options) {
    const { ws, adapter } = run;

    const ctx = { url: run.url, tabId: run.tabId, scope: run.scope, browser: ws.browser || '' };
    let prompt = run.prompt;
    let context = null;
    const extra = adapter.readsInstructions ? '' : instructionsContext(readInstructions(ws.home));
    if (adapter.systemPrompt) context = agents.contextText(ctx) + extra;
    else prompt = `${run.sessionId ? agents.reminderText(ctx) : agents.contextText(ctx) + extra}\n\n${prompt}`;
    let limits;
    try { limits = runLimits(ws, run); } catch (e) {
      this._emit(run, { kind: 'error', message: e.message });
      return this._finish(run, { code: null, signal: null });
    }
    // The agent's own files (claude: its run settings and context), in a folder of the run's that only
    // the helper and the agent itself read: beside its mailbox, not in it (the run's commands may write
    // there), and not in the workspace. Removed when the run ends.
    run.agentDir = path.join(boxRoot(), `${run.id}.agent`);
    let cmd;
    try {
      fs.mkdirSync(run.agentDir, { mode: 0o700 });
      cmd = adapter.command({ bin: found.path, prompt, sessionId: run.sessionId, model: run.model, context, workspace: ws.home, agentDir: run.agentDir, ...limits, ...options });
      for (const f of cmd.files || []) fs.writeFileSync(f.path, f.content, { mode: 0o600, flag: 'wx' });
    } catch (e) {
      this._emit(run, { kind: 'error', message: `couldn't prepare ${adapter.name}'s run: ${e.message}` });
      return this._finish(run, { code: null, signal: null });
    }
    const { file, args, locked } = cmd;
    if (cmd.env) env = { ...env, ...cmd.env }; // (claude: its temporary folder)

    run.before = modSnapshot(ws.modsDir, ws.home);
    // Changes in these folders aren't held on this run's account (held.js): only the ones the adapter
    // says it kept the run out of; an adapter that doesn't say exempts none.
    run.locked = Array.isArray(locked) ? locked.filter((d) => limits.locked.includes(d)) : [];
    run.beforeFiles = snapshot(ws.modsDir, ws.home);
    // Tell the other browsers' helpers a run is going, so mods it creates start off there (lib/origins.js).
    if (ws.installId) {
      try { markRunActive(ws.home, { runId: run.id, by: ws.installId, browser: ws.browser || '', site: run.site }); run.marked = true; } catch (e) { this.logger.warn(`couldn't mark run ${run.id} active: ${e.message}`); }
    }
    this.logger.info(`agent run ${run.id}: ${run.agent} for ${run.site}${run.sessionId ? ` (resume ${run.sessionId})` : ''}`);
    let child;
    try {
      // The message on stdin (cmd.stdin), never in argv: other processes can read those.
      child = spawn(file, args, { cwd: ws.home, env, stdio: [typeof cmd.stdin === 'string' ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true });
      if (typeof cmd.stdin === 'string') { child.stdin.on('error', () => { /* it may exit first */ }); child.stdin.end(cmd.stdin); }
    } catch (e) {
      this._emit(run, { kind: 'error', message: `couldn't start ${adapter.name}: ${e.message}` });
      return this._finish(run, { code: null, signal: null });
    }
    run.child = child;
    child.on('error', (e) => {
      this._emit(run, { kind: 'error', message: `couldn't start ${adapter.name} (${found.path}): ${e.message}` });
      this._finish(run, { code: null, signal: null });
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      run.stdoutBuf += chunk;
      let nl;
      while ((nl = run.stdoutBuf.indexOf('\n')) !== -1) {
        const line = run.stdoutBuf.slice(0, nl);
        run.stdoutBuf = run.stdoutBuf.slice(nl + 1);
        this._onLine(run, line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      run.stderr = redactSecrets(run.stderr + chunk, run.secrets).slice(-STDERR_KEEP);
    });

    let exitInfo = null;
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      // Normally 'close' follows at once; if a grandchild keeps the pipes open, don't wait for it.
      run.timers.push(setTimeout(() => this._finish(run, exitInfo), 1000));
    });
    child.on('close', (code, signal) => this._finish(run, exitInfo || { code, signal }));

    run.timers.push(setTimeout(() => {
      run.timedOut = true;
      this._emit(run, { kind: 'error', message: `${adapter.name} was stopped after ${Math.round(RUN_TIMEOUT_MS / 60000) || 1} minutes` });
      this._kill(run);
    }, RUN_TIMEOUT_MS));
  }

  // Answer requests from the run's mailbox (client.js boxRequest). The agent can write there, so files are
  // opened without following symlinks and answers are created fresh: a planted link can't make the helper
  // read or overwrite anything else.
  _serveBox(run) {
    const take = () => {
      if (run.finished) return;
      let names;
      try { names = fs.readdirSync(run.box); } catch { return; }
      for (const name of names) {
        if (!/^[\w.-]+\.req$/.test(name)) continue;
        const id = name.slice(0, -4);
        const file = path.join(run.box, name);
        let line;
        try {
          const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try {
            const st = fs.fstatSync(fd);
            if (!st.isFile() || st.size > MAX_BOX_REQUEST) throw new Error('not a request');
            line = fs.readFileSync(fd, 'utf8').trim();
          } finally { fs.closeSync(fd); }
        } catch { line = null; }
        try { fs.unlinkSync(file); } catch { continue; } // another pass took it
        const respond = (text) => {
          const tmp = path.join(run.box, `${id}.${crypto.randomBytes(4).toString('hex')}.part`);
          try {
            fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
            fs.renameSync(tmp, path.join(run.box, `${id}.res`));
          } catch (e) { this.logger.warn(`agent run ${run.id}: couldn't answer a request: ${e.message}`); }
        };
        if (line === null) { respond(JSON.stringify({ id: null, ok: false, error: 'unreadable request' })); continue; }
        try { this.onRequest(run, line, respond); } catch (e) { respond(JSON.stringify({ id: null, ok: false, error: e.message })); }
      }
    };
    try { run.boxWatcher = fs.watch(run.box, take); run.boxWatcher.on('error', () => {}); } catch { /* polling alone */ }
    run.timers.push(setInterval(take, 200));
  }

  _onLine(run, line) {
    if (!line.trim() || run.doneSent) return;
    this._log(run, line);
    try {
      run.adapter.parse(line, (ev) => {
        if (!ev || typeof ev !== 'object') return;
        if (ev.kind === 'done') {
          run.agentDone = ev;
          if (ev.discardSession) run.lastSessionId = run.sessionId;
          else if (ev.sessionId) run.lastSessionId = ev.sessionId;
          return;
        }
        if (ev.kind === 'session' && ev.sessionId) run.lastSessionId = ev.sessionId;
        this._emit(run, ev);
      }, run.state);
    } catch (e) {
      this.logger.warn(`agent run ${run.id}: parse error: ${e.message}`);
    }
  }

  // Kill the agent's whole process group (it spawns shells for its tools): SIGTERM, then SIGKILL.
  _kill(run, graceMs = KILL_GRACE_MS) {
    const child = run.child;
    if (!child || run.finished || child.exitCode !== null || child.signalCode !== null) return;
    const sig = (s) => {
      try { process.kill(-child.pid, s); } catch { try { child.kill(s); } catch { /* gone */ } }
    };
    sig('SIGTERM');
    setTimeout(() => sig('SIGKILL'), graceMs).unref(); // the group may outlive its leader
  }

  _finish(run, { code, signal }) {
    if (run.finished) {
      // (prepare may settle after a stop already finished the run: close what it started.)
      if (run.cleanup) { const c = run.cleanup; run.cleanup = null; Promise.resolve().then(c).catch(() => {}); }
      return;
    }
    run.finished = true;
    for (const t of run.timers) clearTimeout(t);
    if (run.cleanup) { const c = run.cleanup; run.cleanup = null; Promise.resolve().then(c).catch((e) => this.logger.warn(`agent run ${run.id}: cleanup: ${e.message}`)); }
    if (run.stdoutBuf.trim()) { const l = run.stdoutBuf; run.stdoutBuf = ''; this._onLine(run, l); }
    try { run.boxWatcher?.close(); } catch { /* ignore */ }
    if (run.box) setTimeout(() => { try { fs.rmSync(run.box, { recursive: true, force: true }); } catch { /* ignore */ } }, 2000).unref();
    if (run.agentDir) { try { fs.rmSync(run.agentDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    if (run.agentTmp) { try { fs.rmSync(run.agentTmp, { recursive: true, force: true }); } catch { /* ignore */ } }
    // Leftover processes of a finished run (backgrounded by a tool) go too, by force after a moment: a
    // write landing after the held-mod window (RECENT_MS) would never be held.
    if (run.child && run.child.pid && !run.stopped) {
      const pid = run.child.pid;
      try { process.kill(-pid, 'SIGTERM'); } catch { /* none */ }
      setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, KILL_GRACE_MS).unref();
    }

    let changedFiles = [];
    if (run.beforeFiles) {
      try { changedFiles = diffSnapshots(run.beforeFiles, snapshot(run.ws.modsDir, run.ws.home)); } catch { /* ignore */ }
    }
    const d = run.agentDone;
    let done;
    if (d) {
      done = { kind: 'done', ok: !!d.ok && !run.stopped && !run.timedOut, result: d.result ?? null, costUsd: d.costUsd ?? null, changedFiles, sessionId: (d.discardSession ? run.sessionId : d.sessionId || run.lastSessionId) || null };
    } else {
      if (!run.stopped && !run.timedOut && run.child) {
        const tail = run.stderr.trim().split('\n').slice(-12).join('\n').slice(-2000);
        const friendly = run.adapter.explainExit ? run.adapter.explainExit({ code, signal, stderr: run.stderr, state: run.state }) : null;
        const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
        this._emit(run, { kind: 'error', message: friendly || `${run.adapter.name} ${how} without finishing${tail ? `:\n${tail}` : ''}` });
      }
      done = { kind: 'done', ok: false, result: null, costUsd: null, changedFiles, sessionId: run.lastSessionId || null };
    }
    if (run.stopped && !run.shuttingDown) done.stopped = true;
    if (run.shuttingDown) this._emit(run, { kind: 'error', message: 'the helper shut down (Chrome closed?) before the agent finished' });
    this._emit(run, done);
    this._log(run, { webmods: 'done', ...done, exitCode: code, signal, stderrTail: run.stderr.slice(-4000), time: Date.now() });
    this.logger.info(`agent run ${run.id} done: ok=${done.ok} code=${code} signal=${signal} changed=${changedFiles.length}`);
    if (run.marked) markRunEnded(run.ws.home, run.id);
    // Private files that reappeared in the workspace meanwhile (an older helper or bridge still running
    // writes its log where it used to) go back to the private folder now, not only before the next run.
    try {
      if (privateLeftovers(run.ws.home).length) {
        const m = migratePrivate(run.ws.home, { privateDir: run.ws.private });
        for (const n of [...m.notes, ...m.errors]) this.logger.warn(`after agent run ${run.id}: ${n}`);
      }
    } catch (e) { this.logger.warn(`after agent run ${run.id}: couldn't check for private files in the workspace: ${e.message}`); }
    if (run.before) this.recent.push({ runId: run.id, site: run.site, scope: run.scope, before: run.before, locked: run.locked || [], startedAt: run.startedAt, until: Date.now() + RECENT_MS });
    this.runs.delete(run.id);
    if (this.bySite.get(run.site) === run.id) this.bySite.delete(run.site);
  }
}

module.exports = {
  runLimits, Runs, snapshot, modSnapshot, diffSnapshots, normalizeSite, boxRoot, RUN_TIMEOUT_MS, PRIVATE_FILES, skillDirs, skillSecrets, deniedInHome, deniedOutsideHome, trifCode, withPrivatePaths,
  pruneScreenshots, screenshotsFolder, checkModsFolder, SCREENSHOT_KEEP_MS };
