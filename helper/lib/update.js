'use strict';
// Updates: checking the release feed and installing a newer TRIF into <home>/app.
//
// The feed is updates/latest.json in the GitHub repo named by package.json's "repository" (read from
// raw.githubusercontent.com), next to latest.json.sig: an Ed25519 signature of latest.json's exact bytes
// by the release key (release-key.js holds the public half). A feed that isn't signed by that key is
// refused, so taking over the repo or the GitHub account isn't enough to ship code to users.
//
//   { "version": "0.1.2", "published": "2026-11-02", "notes": "…",
//     "package": { "url": "https://github.com/…/releases/download/v0.1.2/trif-0.1.2.tgz", "sha256": "…", "size": 123 } }
//
// Installing downloads the package (checking its size and sha256 against the signed feed), unpacks it
// and runs its own `trif setup --copy`, which swaps it into <home>/app the same way a first install
// does. Only installs that run from <home>/app are updated: a git checkout updates with git.
//
// config.json: "autoUpdate": true installs updates without asking (off by default); "checkForUpdates":
// false stops checking altogether. State (last check, what's available, last install) is kept in
// <home>/update.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const P = require('./paths');
const { browserTable, browsersSetUp: setUpIn } = require('./browsers');
const { acquireInstallLock, LockBusy, LOCK_ENV } = require('./lock');

const CHECK_EVERY_MS = 20 * 60 * 60 * 1000; // a cached answer is good for this long
const FEED_MAX = 256 * 1024;
const PACKAGE_MAX = 50 * 1024 * 1024;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

class UpdateError extends Error {}

function packageJson(root = P.REPO_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return {}; }
}

/** "owner/repo" from package.json's repository (a GitHub URL or "github:owner/repo"), or null. */
function githubRepo(pkg = packageJson()) {
  const r = pkg.repository;
  const url = typeof r === 'string' ? r : r && typeof r.url === 'string' ? r.url : '';
  const m = /^(?:github:|(?:git\+)?https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// The signed Firefox add-on's name on every GitHub release, next to the versioned copy
// (trif-firefox-<version>.xpi) that updates/firefox.json points at. With the same name on each release,
// GitHub's releases/latest/download/ link always gets the newest one: setup prints it, the README links it.
const FIREFOX_XPI = 'trif-firefox.xpi';

/** Where to get the newest Firefox add-on: the GitHub repo's latest release, or null without a repo. */
function firefoxAddonUrl(pkg = packageJson()) {
  const repo = githubRepo(pkg);
  return repo ? `https://github.com/${repo}/releases/latest/download/${FIREFOX_XPI}` : null;
}

/** Where the feed is: config.json "updateFeed" (a URL to latest.json), else the GitHub repo's. */
function feedUrl(ws, pkg) {
  if (typeof ws.config?.updateFeed === 'string' && ws.config.updateFeed.trim()) return ws.config.updateFeed.trim();
  const repo = githubRepo(pkg);
  return repo ? `https://raw.githubusercontent.com/${repo}/main/updates/latest.json` : null;
}

function compareVersions(a, b) {
  const x = SEMVER.exec(String(a));
  const y = SEMVER.exec(String(b));
  if (!x || !y) throw new UpdateError(`can't compare versions "${a}" and "${b}"`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return Math.sign(d);
  }
  return 0;
}

// https only, except plain http to this machine (tests, a local mirror).
function allowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
}

/** GET a URL (following up to 5 redirects) into a Buffer of at most maxBytes. */
function fetchUrl(url, { maxBytes = FEED_MAX, timeoutMs = 20000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    if (!allowedUrl(url)) return reject(new UpdateError(`refusing to download ${url} (https only)`));
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': `trif/${P.VERSION}` }, timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new UpdateError(`too many redirects fetching ${url}`));
        return resolve(fetchUrl(new URL(res.headers.location, url).href, { maxBytes, timeoutMs, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new UpdateError(`${url} answered HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new UpdateError(`${url} is larger than ${maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new UpdateError(`timed out fetching ${url}`)));
    req.on('error', (e) => reject(e instanceof UpdateError ? e : new UpdateError(`couldn't fetch ${url}: ${e.message}`)));
  });
}

/** The feed, if `sig` (base64) is the release key's signature of `bytes`; throws otherwise. */
function verifyFeed(bytes, sig, publicKey) {
  if (!publicKey) throw new UpdateError("this build has no release key, so it can't verify updates");
  let ok = false;
  try { ok = crypto.verify(null, bytes, publicKey, Buffer.from(String(sig).trim(), 'base64')); } catch { ok = false; }
  if (!ok) throw new UpdateError('the update feed is not signed by the TRIF release key; ignoring it');
  let feed;
  try { feed = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new UpdateError(`the update feed isn't valid JSON: ${e.message}`); }
  const pkg = feed && feed.package;
  if (!SEMVER.test(String(feed?.version))) throw new UpdateError('the update feed has no valid version');
  if (!pkg || !allowedUrl(pkg.url) || !/^[0-9a-f]{64}$/.test(String(pkg.sha256)) || !(pkg.size > 0 && pkg.size <= PACKAGE_MAX)) {
    throw new UpdateError('the update feed has no valid package (url, sha256, size)');
  }
  return { version: feed.version, published: typeof feed.published === 'string' ? feed.published : null,
    notes: typeof feed.notes === 'string' ? feed.notes.slice(0, 4000) : '', package: { url: pkg.url, sha256: pkg.sha256, size: pkg.size } };
}

/** Fetch and verify the feed. opts.fetch replaces fetchUrl (tests). */
async function fetchFeed(url, { publicKey = require('./release-key'), fetch = fetchUrl } = {}) {
  const [bytes, sig] = await Promise.all([fetch(url), fetch(`${url}.sig`, { maxBytes: 1024 })]);
  return verifyFeed(bytes, sig.toString('utf8'), publicKey);
}

// ---------------------------------------------------------------- state and settings

function stateFile(home) { return path.join(home, 'update.json'); }

function readState(home) {
  try { const s = JSON.parse(fs.readFileSync(stateFile(home), 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}

function writeState(home, s) {
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${stateFile(home)}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(tmp, stateFile(home));
}

/** Set (or remove, with undefined) a top-level key in config.json, keeping everything else. */
function setConfigKey(home, key, value) {
  // (In the private folder since 0.2.0: paths.js configFile. readConfig still finds one left in the
  // workspace until it's moved, and this write would leave both: move it first.)
  const P = require('./paths');
  const legacy = path.join(home, 'config.json');
  if (fs.existsSync(legacy)) require('./migrate').migratePrivate(home);
  const file = P.configFile(home);
  let config = {};
  if (fs.existsSync(file)) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new UpdateError(`${file} isn't valid JSON (${e.message}); fix it first`); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new UpdateError(`${file} isn't a JSON object; fix it first`);
  }
  if (value === undefined) delete config[key]; else config[key] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function autoUpdateOn(ws) { return ws.config?.autoUpdate === true; }
function checksOn(ws) { return ws.config?.checkForUpdates !== false; }

// (The system's realpath: on macOS also each component's on-disk case, so two spellings compare equal.)
function realOrResolved(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

/** Whether this copy of TRIF can update itself, and if not, why. */
function installable(ws, root = P.REPO_ROOT) {
  if (realOrResolved(root) !== realOrResolved(ws.appDir)) {
    return { ok: false, why: P.isGitCheckout(root)
      ? `${P.FULL_NAME} is running from a git checkout (${root}), so it updates with git pull, not from here.`
      : `TRIF runs from ${root}, not ${ws.appDir}; run \`npx timsrobot setup\` to install a copy that can update` };
  }
  return { ok: true, why: null };
}

/**
 * What the panel and CLI show: { current, latest, available, notes, published, checkedAt, error, auto,
 * checks, canInstall, why, lastInstalled }.
 */
function summary(ws, s = readState(ws.home), root = P.REPO_ROOT) {
  const current = packageJson(root).version || P.VERSION;
  const latest = s.latest && SEMVER.test(String(s.latest.version)) ? s.latest : null;
  let available = false;
  try { available = !!latest && compareVersions(latest.version, current) > 0; } catch { available = false; }
  const inst = installable(ws, root);
  return {
    current, latest: latest ? latest.version : null, available, notes: available ? latest.notes || '' : '',
    published: available ? latest.published || null : null, checkedAt: s.checkedAt || null, error: s.error || null,
    auto: autoUpdateOn(ws), checks: checksOn(ws), source: feedUrl(ws, packageJson(root)) ? 'github' : null,
    canInstall: inst.ok, why: inst.why, lastInstalled: s.lastInstalled || null,
  };
}

/** Check the feed (at most every 20 hours unless force). Never throws: errors land in summary.error. */
async function check(ws, { force = false, now = Date.now(), root = P.REPO_ROOT, ...feedOpts } = {}) {
  const s = readState(ws.home);
  const url = feedUrl(ws, packageJson(root));
  if (!url) return summary(ws, { ...s, error: "this build doesn't say where its updates come from" }, root);
  if (!checksOn(ws) && !force) return summary(ws, s, root);
  if (!force && s.checkedAt && now - s.checkedAt < CHECK_EVERY_MS && !s.error) return summary(ws, s, root);
  try {
    const feed = await fetchFeed(url, feedOpts);
    s.latest = { version: feed.version, notes: feed.notes, published: feed.published };
    s.error = null;
  } catch (e) {
    // No feed there (nothing released yet, or the repo is still private): nothing to offer, not an error.
    s.error = /answered HTTP 404/.test(e.message) ? null : e.message;
    if (!s.error) s.latest = null;
  }
  s.checkedAt = now;
  writeState(ws.home, s);
  return summary(ws, s, root);
}

// Native host manifests (and the Safari bridge's agent) setup wrote before, so the update keeps the same
// browsers set up.
function browsersSetUp() {
  return setUpIn(browserTable()).map((b) => b.key);
}

function run(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000, ...opts }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`, error });
    });
  });
}

/**
 * Download, verify and install the feed's version. Resolves { from, to, notes, output, warning };
 * throws UpdateError (with <home>/app untouched) on failure, when there's nothing newer, or when another
 * process is installing (the install lock, lock.js, is held throughout). `warning` is set when the new
 * version went into <home>/app but its setup failed at a later step (a browser's manifest, the Safari
 * bridge): it's installed, and the setup output says what to fix.
 */
async function install(ws, { root = P.REPO_ROOT, fetch = fetchUrl, browsers = browsersSetUp(), node = process.execPath, ...feedOpts } = {}) {
  const inst = installable(ws, root);
  if (!inst.ok) throw new UpdateError(inst.why);
  const url = feedUrl(ws, packageJson(root));
  if (!url) throw new UpdateError("this build doesn't say where its updates come from");
  const feed = await fetchFeed(url, { fetch, ...feedOpts });

  let lock;
  try { lock = acquireInstallLock(ws.appDir); } catch (e) {
    if (e instanceof LockBusy) throw new UpdateError(e.message);
    throw e;
  }
  try {
    // Read after taking the lock: another helper may have just installed this very version.
    const from = packageJson(root).version || P.VERSION;
    if (compareVersions(feed.version, from) <= 0) throw new UpdateError(`TRIF ${from} is up to date`);
    return await installLocked(ws, { feed, from, fetch, browsers, node, lock });
  } finally {
    lock.release();
  }
}

async function installLocked(ws, { feed, from, fetch, browsers, node, lock }) {
  const tmp = fs.mkdtempSync(path.join(ws.home, '.update-'));
  try {
    const tgz = await fetch(feed.package.url, { maxBytes: PACKAGE_MAX, timeoutMs: 120000 });
    if (tgz.length !== feed.package.size) throw new UpdateError(`the download is ${tgz.length} bytes, not the ${feed.package.size} the feed says`);
    const sha = crypto.createHash('sha256').update(tgz).digest('hex');
    if (sha !== feed.package.sha256) throw new UpdateError("the download's checksum doesn't match the signed feed; not installing it");
    fs.writeFileSync(path.join(tmp, 'trif.tgz'), tgz);
    const untar = await run('tar', ['-xzf', 'trif.tgz'], { cwd: tmp });
    if (untar.code) throw new UpdateError(`couldn't unpack the update: ${untar.out.trim().slice(-400)}`);
    const pkgRoot = path.join(tmp, 'package');
    if (packageJson(pkgRoot).version !== feed.version) throw new UpdateError(`the package isn't version ${feed.version}`);

    // The new version's own setup: copies itself into <home>/app, refreshes AGENTS.md and the wrappers,
    // offers newly bundled mods. With the PATH the first setup recorded (the browser starts the helper
    // with a bare one), so agents are still found, and with our lock's token, so its copy goes ahead
    // under the lock this process holds.
    const args = [path.join(pkgRoot, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--home', ws.home];
    if (browsers.length) args.push('--browser', browsers.join(','));
    const recordedPath = typeof ws.config?.env?.PATH === 'string' && ws.config.env.PATH ? ws.config.env.PATH : process.env.PATH;
    const env = { ...process.env, PATH: recordedPath, TRIF_HOME: ws.home, [LOCK_ENV]: lock.token };
    const r = await run(node, args, { cwd: tmp, env });
    const tail = r.out.trim().split('\n').slice(-6).join('\n');
    // Setup exits 1 for any problem, including ones after the copy; what matters is whether <home>/app
    // now holds the new version.
    const swapped = installedVersion(ws) === feed.version;
    if (!swapped) throw new UpdateError(r.code ? `the new version's setup failed: ${tail}` : `the new version's setup didn't install it: ${tail}`);
    const warning = r.code ? `installed, but the new version's setup reported a problem: ${tail}` : null;

    const s = readState(ws.home);
    s.lastInstalled = { from, to: feed.version, notes: feed.notes, at: Date.now(), ...(warning ? { warning } : {}) };
    s.latest = { version: feed.version, notes: feed.notes, published: feed.published };
    s.error = null;
    writeState(ws.home, s);
    return { from, to: feed.version, notes: feed.notes, output: r.out, warning };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The version now installed in <home>/app (another helper, or `npx timsrobot setup`, may have updated it). */
function installedVersion(ws) {
  return packageJson(ws.appDir).version || null;
}

module.exports = {
  UpdateError, CHECK_EVERY_MS, githubRepo, FIREFOX_XPI, firefoxAddonUrl, feedUrl, compareVersions, allowedUrl, fetchUrl, verifyFeed, fetchFeed,
  readState, writeState, setConfigKey, autoUpdateOn, checksOn, installable, summary, check, install, installedVersion,
  browsersSetUp,
};
