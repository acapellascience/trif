'use strict';
// Where each browser looks for native messaging host manifests.
// Chromium reads <user data dir>/NativeMessagingHosts/<name>.json for per-user hosts; Firefox reads one
// folder for all profiles, and its manifests list extension IDs (allowed_extensions), not origins.
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
  arc: { label: 'Arc', userData: 'Library/Application Support/Arc/User Data' },
  firefox: { label: 'Firefox', userData: 'Library/Application Support/Firefox', nativeDir: 'Library/Application Support/Mozilla/NativeMessagingHosts', firefox: true },
  safari: { label: 'Safari', userData: 'Library/Safari', safari: true },
};

const LINUX = {
  chrome: { label: 'Google Chrome', userData: '.config/google-chrome' },
  chromium: { label: 'Chromium', userData: '.config/chromium' },
  brave: { label: 'Brave', userData: '.config/BraveSoftware/Brave-Browser' },
  edge: { label: 'Microsoft Edge', userData: '.config/microsoft-edge' },
  firefox: { label: 'Firefox', userData: '.mozilla/firefox', nativeDir: '.mozilla/native-messaging-hosts', firefox: true },
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

function browserTable(homedir = os.homedir(), platform = process.platform) {
  const table = platform === 'darwin' ? MAC : LINUX;
  return Object.entries(table).map(([key, b]) => {
    const userData = path.join(homedir, b.userData);
    const nativeDir = b.nativeDir ? path.join(homedir, b.nativeDir) : path.join(userData, 'NativeMessagingHosts');
    if (b.safari) return { key, label: b.label, userData, nativeDir: null, safari: true, detected: fs.existsSync(safariAgentPlist(homedir)) || fs.existsSync(legacySafariAgentPlist(homedir)) };
    return { key, label: b.label, userData, nativeDir, firefox: !!b.firefox, detected: fs.existsSync(userData) };
  });
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

module.exports = { browserTable, selectBrowsers, ALL_KEYS, SAFARI_AGENT_LABEL, LEGACY_SAFARI_AGENT_LABEL, safariAgentPlist, legacySafariAgentPlist, legacySafariAgentLoaded };
