'use strict';
// Where things live: workspace, socket, log, repo files. Shared by host.js and cli.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_NAME = 'com.webmods.helper';
const EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const HELPER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(HELPER_DIR, '..');
const HOST_JS = path.join(HELPER_DIR, 'host.js');
const CLI_JS = path.join(HELPER_DIR, 'cli.js');

let VERSION = '0.0.0';
try { VERSION = require('../package.json').version || VERSION; } catch { /* ignore */ }

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function defaultHome() {
  return path.join(os.homedir(), '.webmods');
}

// Precedence: explicit override (--home) > $WEBMODS_HOME > ~/.webmods
function resolveHome(override) {
  const h = override || process.env.WEBMODS_HOME || defaultHome();
  return path.resolve(expandHome(String(h)));
}

function readConfig(home) {
  const file = path.join(home, 'config.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { config: {}, error: null }; }
  try {
    const config = JSON.parse(text);
    return { config: config && typeof config === 'object' ? config : {}, error: null };
  } catch (e) {
    return { config: {}, error: `${file} is not valid JSON: ${e.message}` };
  }
}

function workspace(homeOverride) {
  const home = resolveHome(homeOverride);
  const { config, error } = readConfig(home);
  let modsDir = path.join(home, 'sites');
  if (typeof config.modsDir === 'string' && config.modsDir.trim()) {
    modsDir = path.resolve(home, expandHome(config.modsDir.trim()));
  }
  return {
    home,
    modsDir,
    sock: path.join(home, 'helper.sock'),
    log: path.join(home, 'helper.log'),
    screenshots: path.join(home, 'screenshots'),
    bin: path.join(home, 'bin'),
    hostWrapper: path.join(home, 'bin', 'webmods-host'),
    cliWrapper: path.join(home, 'bin', 'webmods'),
    config,
    configError: error,
  };
}

function examplesDir() {
  return process.env.WEBMODS_EXAMPLES_DIR
    ? path.resolve(process.env.WEBMODS_EXAMPLES_DIR)
    : path.join(REPO_ROOT, 'examples', 'sites');
}

module.exports = {
  HOST_NAME, EXTENSION_ID, EXTENSION_ORIGIN, HELPER_DIR, REPO_ROOT, HOST_JS, CLI_JS, VERSION,
  expandHome, defaultHome, resolveHome, readConfig, workspace, examplesDir,
};
