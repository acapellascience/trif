'use strict';
// Where things live: workspace, socket, log, repo files. Shared by host.js and cli.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar } = require('./env');

// The product: "Tim's Robot Internet Fixer", TRIF for short (called WebMods before 0.2.0).
const NAME = 'TRIF';
const FULL_NAME = "Tim's Robot Internet Fixer";
const CLI_NAME = 'trif';
// The command's name before 0.2.0, kept working as an alias (agents, people's habits, PATHs with the old
// wrapper in them).
const LEGACY_CLI_NAME = 'webmods';

// The native messaging host's name. Kept from before the rename: the extension connects to it by name,
// and Firefox updates the add-on on its own schedule, so an older add-on must still find the helper (and
// a newer one an older helper) by this name. Nobody sees it.
const HOST_NAME = 'com.webmods.helper';

// Every TRIF extension ID the native host must accept (its manifest's allowed_origins).
// The unpacked/dev build: fixed by the "key" in extension/manifest.json.
const DEV_EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
// >>> Chrome Web Store ID(s): unknown until the first upload. Add the listing's ID here once it exists,
// >>> then ship a release so `trif setup` writes it into every native host manifest.
const STORE_EXTENSION_IDS = [];
// Users can add more in config.json: { "extensionIds": ["<32 letters a-p>", ...] } (see extensionIds()).
// Firefox identifies the add-on by the ID in its manifest (scripts/build-extension.js firefox), and native
// host manifests for Firefox list it in allowed_extensions. (Both IDs date from before the rename and must
// never change: browsers would treat it as a different extension, losing its settings and updates.)
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

const HOME_DIR_NAME = '.trif';
const LEGACY_HOME_DIR_NAME = '.webmods'; // before 0.2.0; setup moves it to ~/.trif and leaves a link (migrate.js)

/** ~/.trif: where the workspace lives unless told otherwise. */
function defaultHome(homedir = os.homedir()) {
  return path.join(homedir, HOME_DIR_NAME);
}

/** ~/.webmods: the workspace's place before 0.2.0. */
function legacyHome(homedir = os.homedir()) {
  return path.join(homedir, LEGACY_HOME_DIR_NAME);
}

function existsNoFollow(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function isDirFollow(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * The default workspace as things are on disk: ~/.trif, unless only a ~/.webmods (a folder, or a link to
 * one) exists, i.e. a workspace from before 0.2.0 that setup hasn't moved yet (say, a git checkout whose
 * helper restarted onto new code before anyone ran setup): that one, so nothing goes missing.
 */
function currentDefaultHome(homedir = os.homedir()) {
  const home = defaultHome(homedir);
  if (existsNoFollow(home)) return home;
  const legacy = legacyHome(homedir);
  return isDirFollow(legacy) ? legacy : home;
}

// Precedence: explicit override (--home) > $TRIF_HOME (or $WEBMODS_HOME) > ~/.trif. An override naming
// ~/.webmods, the old default (an updater from before 0.2.0 passes it), means the default.
function resolveHome(override) {
  const h = override || envVar('HOME');
  if (!h) return currentDefaultHome();
  const resolved = path.resolve(expandHome(String(h)));
  return resolved === legacyHome() || resolved === defaultHome() ? currentDefaultHome() : resolved;
}

/** Whether `home` (resolved) is the default workspace, under either name. */
function isDefaultHome(home) {
  const resolved = path.resolve(expandHome(String(home)));
  return resolved === defaultHome() || resolved === legacyHome();
}

// ---------------------------------------------------------------- the private folder
//
// What the helper keeps that agent runs must never read: config.json (settings, and before 0.2.1 API
// keys), safari-token (the Safari bridge's key), helper.log, runs/ (run logs: the pages runs read) and
// screenshots/ (one folder per site; a run is given its own site's alone). Outside the workspace, which
// runs may read in full (docs/PROTOCOL.md "Run scope"), so no rule inside the workspace has to keep runs
// out of them. Until 0.2.1 they were in the workspace; migrate.js migratePrivate moves them.
//   macOS    ~/Library/Application Support/TRIF
//   Linux    $XDG_STATE_HOME/trif, or ~/.local/state/trif
//   a workspace elsewhere ($TRIF_HOME, --home): <workspace>-private beside it
//   $TRIF_PRIVATE overrides all of these (not inside the workspace, nor holding it).
const PRIVATE_FILES = ['config.json', 'safari-token', 'helper.log', 'helper.log.1', 'safari-bridge.err', 'runs', 'screenshots'];

function defaultPrivateDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', NAME);
  const state = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(homedir, '.local', 'state');
  return path.join(state, CLI_NAME);
}

/** {dir, error}: the private folder for workspace `home` (error: why $TRIF_PRIVATE was ignored). */
function privateDirInfo(home, { env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const resolved = path.resolve(expandHome(String(home)));
  const fallback = isDefaultHome(resolved) ? defaultPrivateDir({ env, platform, homedir }) : `${resolved}-private`;
  const forced = envVar('PRIVATE', env);
  if (!forced) return { dir: fallback, error: null };
  const dir = path.resolve(expandHome(String(forced)));
  const { isInside } = require('./pathcheck');
  if (isInside(dir, resolved, { orEqual: true }) || isInside(resolved, dir, { orEqual: true })) {
    return { dir: fallback, error: `TRIF_PRIVATE (${dir}) is inside the workspace or holds it, so it was ignored: runs may read the workspace. Using ${fallback}` };
  }
  return { dir, error: null };
}

function privateDir(home, opts) { return privateDirInfo(home, opts).dir; }

function configFile(home) { return path.join(privateDir(home), 'config.json'); }

function readConfig(home) {
  let file = configFile(home);
  // (Before migratePrivate has run, e.g. a helper restarting onto new code: where it was until 0.2.1.)
  if (!fs.existsSync(file) && fs.existsSync(path.join(home, 'config.json'))) file = path.join(home, 'config.json');
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
  const priv = privateDirInfo(home);
  let modsDir = path.join(home, 'sites');
  if (typeof config.modsDir === 'string' && config.modsDir.trim()) {
    modsDir = path.resolve(home, expandHome(config.modsDir.trim()));
  }
  return {
    home,
    modsDir,
    sock: path.join(home, 'helper.sock'),
    // The private folder (see above) and what's in it.
    private: priv.dir,
    privateError: priv.error,
    configFile: path.join(priv.dir, 'config.json'),
    log: path.join(priv.dir, 'helper.log'),
    runs: path.join(priv.dir, 'runs'),
    screenshots: path.join(priv.dir, 'screenshots'),
    safariToken: path.join(priv.dir, 'safari-token'),
    safariBridgeErr: path.join(priv.dir, 'safari-bridge.err'),
    bin: path.join(home, 'bin'),
    hostWrapper: path.join(home, 'bin', `${CLI_NAME}-host`),
    cliWrapper: path.join(home, 'bin', CLI_NAME),
    // The same wrappers under their names from before 0.2.0: native host manifests and PATHs may still
    // point at them.
    legacyHostWrapper: path.join(home, 'bin', `${LEGACY_CLI_NAME}-host`),
    legacyCliWrapper: path.join(home, 'bin', LEGACY_CLI_NAME),
    appDir: path.join(home, APP_DIR_NAME),
    config,
    configError: error,
  };
}

function examplesDir() {
  return envVar('EXAMPLES_DIR')
    ? path.resolve(envVar('EXAMPLES_DIR'))
    : path.join(REPO_ROOT, 'examples', 'sites');
}

module.exports = {
  NAME, FULL_NAME, CLI_NAME, LEGACY_CLI_NAME, HOME_DIR_NAME, LEGACY_HOME_DIR_NAME, legacyHome, currentDefaultHome, isDefaultHome,
  HOST_NAME, DEV_EXTENSION_ID, FIREFOX_EXTENSION_ID, STORE_EXTENSION_IDS, EXTENSION_ID, EXTENSION_ORIGIN, HELPER_DIR, REPO_ROOT,
  HOST_JS, CLI_JS, APP_DIR_NAME, VERSION,
  expandHome, defaultHome, resolveHome, readConfig, workspace, examplesDir, isGitCheckout, extensionIds, extensionOrigins,
  PRIVATE_FILES, defaultPrivateDir, privateDir, privateDirInfo, configFile,
};
