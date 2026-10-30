'use strict';
// Where things live: workspace, socket, log, repo files. Shared by host.js and cli.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_NAME = 'com.webmods.helper';

// Every WebMods extension ID the native host must accept (its manifest's allowed_origins).
// The unpacked/dev build: fixed by the "key" in extension/manifest.json.
const DEV_EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
// >>> Chrome Web Store ID(s): unknown until the first upload. Add the listing's ID here once it exists,
// >>> then ship a release so `webmods setup` writes it into every native host manifest.
const STORE_EXTENSION_IDS = [];
// Users can add more in config.json: { "extensionIds": ["<32 letters a-p>", ...] } (see extensionIds()).
// Firefox identifies the add-on by the ID in its manifest (scripts/build-extension.js firefox), and native
// host manifests for Firefox list it in allowed_extensions.
const FIREFOX_EXTENSION_ID = 'webmods@webmods.ext';
const EXTENSION_ID = DEV_EXTENSION_ID; // the one the docs and fix messages point at
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;

const HELPER_DIR = path.resolve(__dirname, '..');
// The package root: a git checkout, npm's install folder, or the copy setup makes in <home>/app.
const REPO_ROOT = path.resolve(HELPER_DIR, '..');
const HOST_JS = path.join(HELPER_DIR, 'host.js');
const CLI_JS = path.join(HELPER_DIR, 'cli.js');
const APP_DIR_NAME = 'app'; // <home>/app: setup's self-contained copy when not run from a git checkout

// Single source of truth for the version: the root package.json (extension/manifest.json must match;
// a test checks it).
let VERSION = '0.0.0';
try { VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || VERSION; } catch { /* ignore */ }

// Developers work in a git checkout; setup links to it instead of copying.
function isGitCheckout(root = REPO_ROOT) {
  return fs.existsSync(path.join(root, '.git'));
}

const EXTENSION_ID_RE = /^[a-p]{32}$/;

/** { ids, invalid }: built-in IDs first, then valid config.json `extensionIds`, deduplicated. */
function extensionIds(config = {}) {
  const ids = [DEV_EXTENSION_ID, ...STORE_EXTENSION_IDS];
  const invalid = [];
  const extra = config && config.extensionIds;
  if (extra !== undefined && !Array.isArray(extra)) invalid.push(extra);
  for (const id of Array.isArray(extra) ? extra : []) {
    const s = typeof id === 'string' ? id.trim() : id;
    if (typeof s !== 'string' || !EXTENSION_ID_RE.test(s)) invalid.push(id);
    else ids.push(s);
  }
  return { ids: [...new Set(ids)], invalid };
}

function extensionOrigins(config = {}) {
  return extensionIds(config).ids.map((id) => `chrome-extension://${id}/`);
}

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
    appDir: path.join(home, APP_DIR_NAME),
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
  HOST_NAME, DEV_EXTENSION_ID, FIREFOX_EXTENSION_ID, STORE_EXTENSION_IDS, EXTENSION_ID, EXTENSION_ORIGIN, HELPER_DIR, REPO_ROOT,
  HOST_JS, CLI_JS, APP_DIR_NAME, VERSION,
  expandHome, defaultHome, resolveHome, readConfig, workspace, examplesDir, isGitCheckout, extensionIds, extensionOrigins,
};
