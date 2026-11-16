'use strict';
// Where each browser looks for native messaging host manifests.
// Chromium reads <user data dir>/NativeMessagingHosts/<name>.json for per-user hosts; Firefox reads one
// folder for all profiles, and its manifests list extension IDs (allowed_extensions), not origins.
// Arc is the exception among Chromium browsers: its profiles are in Arc/User Data, but it reads per-user
// hosts from Google Chrome's folder (as of Arc 1.169; Bitwarden's integration relies on that too), so its
// manifest goes there, and into its own folder too, in case an Arc version reads that one.
// Each browser's `nativeDirs` are the folders setup writes its manifest to: the first is the one the browser
// reads, which doctor checks.
// Safari has no such manifests: its extension reaches the helper through the Safari bridge, which setup
// installs as a launchd agent (SAFARI_AGENT_LABEL). Every Mac has Safari, so it only counts as detected
// once that agent is installed (`trif setup --browser safari` installs it).
// Windows: browsers find native hosts through the registry instead (lib/win/registry.js): setup writes the
// manifests into %LOCALAPPDATA%\TRIF\NativeMessagingHosts\<browser> and points each browser's key there.
// A browser counts as detected when its user data folder exists, as elsewhere.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAC = {
  chrome: { label: 'Google Chrome', userData: 'Library/Application Support/Google/Chrome' },
  chromium: { label: 'Chromium', userData: 'Library/Application Support/Chromium' },
  brave: { label: 'Brave', userData: 'Library/Application Support/BraveSoftware/Brave-Browser' },
  edge: { label: 'Microsoft Edge', userData: 'Library/Application Support/Microsoft Edge' },
  arc: { label: 'Arc', userData: 'Library/Application Support/Arc/User Data', nativeDirs: ['Library/Application Support/Google/Chrome/NativeMessagingHosts', null] },
  firefox: { label: 'Firefox', userData: 'Library/Application Support/Firefox', nativeDirs: ['Library/Application Support/Mozilla/NativeMessagingHosts'], firefox: true },
  safari: { label: 'Safari', userData: 'Library/Safari', safari: true },
};

const LINUX = {
  chrome: { label: 'Google Chrome', userData: '.config/google-chrome' },
  chromium: { label: 'Chromium', userData: '.config/chromium' },
  brave: { label: 'Brave', userData: '.config/BraveSoftware/Brave-Browser' },
  edge: { label: 'Microsoft Edge', userData: '.config/microsoft-edge' },
  firefox: { label: 'Firefox', userData: '.mozilla/firefox', nativeDirs: ['.mozilla/native-messaging-hosts'], firefox: true },
};

// userData under %LOCALAPPDATA% (Firefox: %APPDATA%); regKeys: under HKCU\Software (registry.js), each
// followed by \NativeMessagingHosts\<host name>.
const WINDOWS = {
  chrome: { label: 'Google Chrome', local: 'Google\\Chrome\\User Data', regKeys: ['Google\\Chrome'] },
  chromium: { label: 'Chromium', local: 'Chromium\\User Data', regKeys: ['Chromium'] },
  // (Brave's own key, and Chrome's, which Brave is reported to read as well: unverified.)
  brave: { label: 'Brave', local: 'BraveSoftware\\Brave-Browser\\User Data', regKeys: ['BraveSoftware\\Brave-Browser', 'Google\\Chrome'] },
  edge: { label: 'Microsoft Edge', local: 'Microsoft\\Edge\\User Data', regKeys: ['Microsoft\\Edge'] },
  firefox: { label: 'Firefox', roaming: 'Mozilla\\Firefox', regKeys: ['Mozilla'], firefox: true },
};

function windowsTable(homedir, env) {
  const { localAppData } = require('./paths');
  const local = localAppData({ env, homedir });
  const roaming = env.APPDATA && path.isAbsolute(env.APPDATA) ? env.APPDATA : path.join(homedir, 'AppData', 'Roaming');
  const split = (p) => p.split('\\');
  return Object.entries(WINDOWS).map(([key, b]) => {
    const userData = b.local ? path.join(local, ...split(b.local)) : path.join(roaming, ...split(b.roaming));
    return {
      key, label: b.label, userData, firefox: !!b.firefox, detected: fs.existsSync(userData),
      nativeDirs: [path.join(local, 'TRIF', 'NativeMessagingHosts', key)],
      regKeys: b.regKeys,
    };
  });
}

const ALL_KEYS = ['chrome', 'chromium', 'brave', 'edge', 'arc', 'firefox', 'safari'];

const SAFARI_AGENT_LABEL = 'com.timsrobot.trif.safari-bridge';
// Its label before 0.2.0: setup stops that agent and removes its file.
const LEGACY_SAFARI_AGENT_LABEL = 'dev.webmods.safari-bridge';
/** The Safari bridge's launchd agent file. */
function safariAgentPlist(homedir = os.homedir(), label = SAFARI_AGENT_LABEL) {
  return path.join(homedir, 'Library', 'LaunchAgents', `${label}.plist`);
}
function legacySafariAgentPlist(homedir = os.homedir()) {
  return safariAgentPlist(homedir, LEGACY_SAFARI_AGENT_LABEL);
}

/**
 * Whether launchd has the Safari bridge's agent from before 0.2.0 loaded (macOS; false where launchctl
 * isn't to be used: elsewhere, or TRIF_NO_LAUNCHCTL=1, as in tests).
 */
function legacySafariAgentLoaded({ env = process.env, run } = {}) {
  const { envVar } = require('./env');
  if (process.platform !== 'darwin' || envVar('NO_LAUNCHCTL', env)) return false;
  const { spawnSync } = require('child_process');
  run = run || ((args) => spawnSync('launchctl', args, { encoding: 'utf8' }));
  try { return run(['print', `gui/${process.getuid()}/${LEGACY_SAFARI_AGENT_LABEL}`]).status === 0; } catch { return false; }
}

/**
 * Every browser TRIF knows on `platform`: { key, label, userData, nativeDirs, firefox, detected } (Safari:
 * nativeDirs [] and `safari`). `nativeDirs`: see above (null in the table: the browser's own
 * <user data dir>/NativeMessagingHosts). A browser is detected when its user data folder is there, except
 * a Chromium one's holding only NativeMessagingHosts: that's what setup writes for another browser
 * (Chrome's, for Arc), not a sign the browser is installed. Windows: `regKeys` too (windowsTable).
 */
function browserTable(homedir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === 'win32') return windowsTable(homedir, env);
  const table = platform === 'darwin' ? MAC : LINUX;
  return Object.entries(table).map(([key, b]) => {
    const userData = path.join(homedir, b.userData);
    if (b.safari) return { key, label: b.label, userData, nativeDirs: [], safari: true, detected: fs.existsSync(safariAgentPlist(homedir)) || fs.existsSync(legacySafariAgentPlist(homedir)) };
    const own = path.join(userData, 'NativeMessagingHosts');
    const nativeDirs = (b.nativeDirs || [null]).map((d) => (d === null ? own : path.join(homedir, d)));
    return { key, label: b.label, userData, nativeDirs, firefox: !!b.firefox, detected: profileThere(userData, !b.firefox) };
  });
}

function profileThere(userData, chromium) {
  let names;
  try { names = fs.readdirSync(userData); } catch { return false; }
  return !chromium || !names.includes('NativeMessagingHosts') || names.some((f) => f !== 'NativeMessagingHosts' && f !== '.DS_Store');
}

/** The manifest files setup writes for browser `b` (from browserTable), the one it reads first. */
function manifestFiles(b) {
  const { HOST_NAME } = require('./paths');
  return b.nativeDirs.map((d) => path.join(d, `${HOST_NAME}.json`));
}

/**
 * The browsers setup set up, from what it left (`table`: browserTable's): a manifest in one of a browser's
 * folders, or Safari's agent. A browser that isn't detected and whose manifests are all files another
 * browser set up also writes (Chrome's, after setup for Arc alone) isn't counted: they're the other's.
 */
function browsersSetUp(table) {
  const there = (b) => manifestFiles(b).filter((f) => fs.existsSync(f));
  const withManifest = table.filter((b) => (b.safari ? b.detected : there(b).length > 0));
  return withManifest.filter((b) => b.safari || b.detected
    || !there(b).every((f) => withManifest.some((o) => o !== b && o.detected && manifestFiles(o).includes(f))));
}

// Resolve `--browser` (undefined = detected ones) to a list of targets, or throw on a bad name.
function selectBrowsers(choice, homedir, platform, env) {
  const table = browserTable(homedir, platform, env);
  if (!choice) return table.filter((b) => b.detected);
  const wanted = String(choice).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (wanted.includes('all')) return table;
  const out = [];
  for (const w of wanted) {
    const b = table.find((t) => t.key === w);
    if (!b) {
      const known = table.map((t) => t.key).join(', ');
      throw new Error(`unknown browser "${w}" on this platform (known: ${known}, all)`);
    }
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- which browser this is

// The browser that started a helper is its parent process (the wrapper execs node, so nothing sits in
// between): Chrome, Firefox and the others start their native hosts themselves. Its executable names it,
// which tells apart the Chromium browsers the extension can't always tell from inside (Arc says it's Chrome,
// Vivaldi hides itself): on a Mac the outermost .app in its path ("/Applications/Brave Browser.app/Contents/
// MacOS/Brave Browser"), elsewhere the last folders of its path ("/opt/brave.com/brave/brave"). Order
// matters: "chromium" before "chrome" (Snap's Chromium runs .../chromium-browser/chrome).
const LAUNCHERS = [
  [/^(microsoft edge|microsoft-edge|msedge)\b/i, 'Edge', 'chromium'],
  [/^brave\b/i, 'Brave', 'chromium'],
  [/^opera gx\b/i, 'Opera GX', 'chromium'],
  [/^opera air\b/i, 'Opera Air', 'chromium'],
  [/^opera\b/i, 'Opera', 'chromium'],
  [/^vivaldi\b/i, 'Vivaldi', 'chromium'],
  [/^arc$/i, 'Arc', 'chromium'],
  [/^chromium\b/i, 'Chromium', 'chromium'],
  [/^(google chrome|google-chrome|chrome)\b/i, 'Chrome', 'chromium'], // (and Chrome for Testing, Beta, Canary)
  [/^librewolf\b/i, 'LibreWolf', 'firefox'],
  [/^waterfox\b/i, 'Waterfox', 'firefox'],
  [/^floorp\b/i, 'Floorp', 'firefox'],
  [/^zen\b/i, 'Zen', 'firefox'],
  [/^mullvad ?browser\b/i, 'Mullvad Browser', 'firefox'],
  [/^tor ?browser\b/i, 'Tor Browser', 'firefox'],
  [/^firefox\b/i, 'Firefox', 'firefox'], // (and Developer Edition, Nightly)
];
// The names a browser of each kind has when nothing more particular is known.
const PLAIN_NAMES = new Set(['Chrome', 'Chromium', 'Firefox']);

/** {name, family} for the browser whose executable is at `exe`, or null when it isn't one TRIF knows. */
function browserFromExecutable(exe, platform = process.platform) {
  if (typeof exe !== 'string' || !exe) return null;
  const parts = exe.split('/').filter(Boolean);
  let names;
  if (platform === 'darwin') {
    const app = parts.find((p) => /\.app$/i.test(p));
    if (!app) return null;
    names = [app.replace(/\.app$/i, '')];
  } else names = parts.slice(-3);
  for (const [re, name, family] of LAUNCHERS) if (names.some((n) => re.test(n))) return { name, family };
  return null;
}

/**
 * The executable of process `pid` (the helper's parent: the browser that started it), or null. `run`
 * (tests) stands in for `ps`.
 */
async function executableOf(pid, { platform = process.platform, run } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    if (platform === 'linux') return await fs.promises.readlink(`/proc/${pid}/exe`);
    run = run || ((args) => new Promise((resolve) => {
      require('child_process').execFile('ps', args, { timeout: 3000 }, (e, out) => resolve(e ? '' : String(out)));
    }));
    const out = String(await run(['-o', 'comm=', '-p', String(pid)])).trim();
    return out || null;
  } catch { return null; }
}

/**
 * The browser that started this helper: {name, family, exe}, or null (a terminal, the Safari bridge, a
 * test). TRIF_LAUNCHER, an executable's path, stands in for the parent's (tests).
 */
async function launchingBrowser({ pid = process.ppid, env = process.env, platform = process.platform, run } = {}) {
  const { envVar } = require('./env');
  const exe = envVar('LAUNCHER', env) || await executableOf(pid, { platform, run });
  const b = browserFromExecutable(exe, platform);
  return b ? { ...b, exe } : null;
}

/** 'chromium' | 'firefox' | 'safari' for an extension's hello (`family` since 0.3.1; before, the name told). */
function browserFamily(hello) {
  if (!hello || typeof hello !== 'object') return 'chromium';
  if (['chromium', 'firefox', 'safari'].includes(hello.family)) return hello.family;
  return hello.browser === 'Firefox' ? 'firefox' : hello.browser === 'Safari' ? 'safari' : 'chromium';
}

/**
 * The browser's name, from what its extension said (`hello`: {browser, family}) and what started the
 * helper (`launcher`: launchingBrowser's). The launcher's name wins over a plain one (Chrome, Chromium,
 * Firefox) and over Arc (the extension takes a browser without Chrome's side panel for Arc); a particular
 * name the extension found itself (Brave, Edge, Opera, Vivaldi, a Firefox fork) stays when the launcher
 * only knows the plain one. A launcher of another kind than the extension says is ignored.
 */
function reconcileBrowser(hello, launcher) {
  const said = hello && typeof hello.browser === 'string' && hello.browser ? hello.browser : 'Chrome';
  if (!launcher || launcher.family !== browserFamily(hello)) return said;
  if (PLAIN_NAMES.has(launcher.name) && !PLAIN_NAMES.has(said) && said !== 'Arc') return said;
  return launcher.name;
}

/**
 * A stable key for one browser's records (sitecombos' switches): its kind's old name (Chrome, Firefox,
 * Safari), so a browser TRIF names better than before (Brave, once "Chrome") keeps its entry.
 */
function browserKey(hello) {
  return { firefox: 'Firefox', safari: 'Safari' }[browserFamily(hello)] || 'Chrome';
}

/** "<name> <version>" for an extension's hello: its own version where it sent one (Opera's, not Chromium's). */
function browserLabel(hello, fallback = 'Chrome') {
  if (!hello) return fallback;
  const version = hello.browserVersion || hello.chrome || '';
  return `${hello.browser || fallback}${version ? ` ${version}` : ''}`;
}

/** A browser's registry keys for TRIF's native host (Windows), full: HKCU\Software\...\<host name>. */
function nativeRegKeys(b, opts = {}) {
  const { fullKey } = require('./win/registry');
  const { HOST_NAME } = require('./paths');
  return (b.regKeys || []).map((k) => fullKey(`${k}\\NativeMessagingHosts\\${HOST_NAME}`, opts));
}

module.exports = { nativeRegKeys, WINDOWS, browserFromExecutable, executableOf, launchingBrowser, browserFamily, reconcileBrowser, browserKey, browserLabel,
  browserTable, selectBrowsers, manifestFiles, browsersSetUp, ALL_KEYS, SAFARI_AGENT_LABEL, LEGACY_SAFARI_AGENT_LABEL, safariAgentPlist, legacySafariAgentPlist, legacySafariAgentLoaded };
