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
 * (Chrome's, for Arc), not a sign the browser is installed.
 */
function browserTable(homedir = os.homedir(), platform = process.platform) {
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
function selectBrowsers(choice, homedir, platform) {
  const table = browserTable(homedir, platform);
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

module.exports = { browserTable, selectBrowsers, manifestFiles, browsersSetUp, ALL_KEYS, SAFARI_AGENT_LABEL, LEGACY_SAFARI_AGENT_LABEL, safariAgentPlist, legacySafariAgentPlist, legacySafariAgentLoaded };
