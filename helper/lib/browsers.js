'use strict';
// Where each Chromium browser looks for native messaging host manifests.
// Chromium reads <user data dir>/NativeMessagingHosts/<name>.json for per-user hosts.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAC = {
  chrome: { label: 'Google Chrome', userData: 'Library/Application Support/Google/Chrome' },
  chromium: { label: 'Chromium', userData: 'Library/Application Support/Chromium' },
  brave: { label: 'Brave', userData: 'Library/Application Support/BraveSoftware/Brave-Browser' },
  edge: { label: 'Microsoft Edge', userData: 'Library/Application Support/Microsoft Edge' },
  arc: { label: 'Arc', userData: 'Library/Application Support/Arc/User Data' },
};

const LINUX = {
  chrome: { label: 'Google Chrome', userData: '.config/google-chrome' },
  chromium: { label: 'Chromium', userData: '.config/chromium' },
  brave: { label: 'Brave', userData: '.config/BraveSoftware/Brave-Browser' },
  edge: { label: 'Microsoft Edge', userData: '.config/microsoft-edge' },
};

const ALL_KEYS = ['chrome', 'chromium', 'brave', 'edge', 'arc'];

function browserTable(homedir = os.homedir(), platform = process.platform) {
  const table = platform === 'darwin' ? MAC : LINUX;
  return Object.entries(table).map(([key, b]) => {
    const userData = path.join(homedir, b.userData);
    return { key, label: b.label, userData, nativeDir: path.join(userData, 'NativeMessagingHosts'), detected: fs.existsSync(userData) };
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

module.exports = { browserTable, selectBrowsers, ALL_KEYS };
