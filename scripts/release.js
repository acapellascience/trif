#!/usr/bin/env node
'use strict';
// Releasing TRIF. Run by the maintainer, on their Mac (the signing keys live in its keychain).
//
//   node scripts/release.js keygen            once: create the release signing key (Ed25519). The private
//                                             half goes into the keychain, the public half into
//                                             helper/lib/release-key.js (commit it).
//   node scripts/release.js 0.1.2 [--dry-run] [--skip-tests]
//   node scripts/release.js refresh-feed [--dry-run]
//                                             between releases: sign updates/latest.json again with
//                                             today's time, nothing else changed. Installs refuse a
//                                             feed signed more than 8 weeks ago (helper/lib/update.js),
//                                             so one is due when there's been no release for ~6 weeks.
//                                             Then commit and push updates/ on main. Signs the mods feed
//                                             (updates/mods.json) again too.
//   node scripts/release.js mods-feed [--dry-run] [--only <id,id>] [--min-trif <version>]
//                                             between releases: new versions of Tim's mods without a
//                                             release. Writes updates/mods.json (+ .sig, the release key)
//                                             with every shipped mod whose file at HEAD differs from the
//                                             last release's (its tag), each with its new @version (which
//                                             must be newer), sha256, size and the TRIF it needs (--min-trif,
//                                             else the last release), and the commit the helper fetches
//                                             the files at (helper/lib/modsfeed.js). Then asks before
//                                             committing and pushing it on main. An empty feed (nothing
//                                             changed, or --only of none) withdraws what an earlier one had.
//   node scripts/release.js refresh-runtime [<node version>] [--dry-run]
//                                             TRIF's own Node (helper/runtime.json, docs/NO-NODE.md): pins
//                                             that version (default: the newest of the pinned major line)
//                                             from nodejs.org's SHASUMS256.txt, every platform's archive and
//                                             SHA-256. Then commit helper/runtime.json; the next release
//                                             ships it (setup downloads the new Node beside the old one).
//                                             --dry-run writes dist/release/runtime/runtime.json instead.
//
// A release: checks everything first (clean main branch, a CHANGELOG.md section for the version and no
// "## Unreleased" one, keys, GitHub login, package.json's repository matching the git remote), bumps the version, refreshes examples/shipped-history.json, runs the tests, builds the
// Chrome and Firefox extensions and the npm package, has Mozilla sign the Firefox add-on (unlisted),
// makes the two beta zips and install.sh (scripts/install.sh filled in with the package's URL and SHA-256
// and the runtime pins: `curl -fsSL …/install.sh | sh` installs with no Node; install.ps1 likewise for
// Windows, `irm https://timsrobot.com/install.ps1 | iex`, which the site serves from site/src/install-windows.js,
// never from the release), and writes the update feeds: updates/latest.json (+ .sig, signed with the
// release key) for the helper, updates/firefox.json for Firefox, and updates/mods.json (+ .sig), the mods
// feed, empty: the release ships every mod as it is. Then it asks before publishing
// anything: a commit and tag, a GitHub release with the files, and the feeds (pushed last, once the files
// they point at exist). The release holds the signed add-on twice: trif-firefox-<version>.xpi for the
// Firefox feed, and trif-firefox.xpi, the name GitHub's releases/latest/download/ link (in the README and
// setup's next steps) needs to always get the newest.
//
// --dry-run does everything up to publishing, into dist/release/<version>, and changes no tracked file
// (no Mozilla signing, so no .xpi; feeds are signed only if the release key is there).
//
// Keychain entries (service names; add one with `security add-generic-password -s <name> -a "$USER" -w`,
// -w last, so security asks for the value and it's in no process's arguments):
//   trif-amo-issuer, trif-amo-secret   addons.mozilla.org API key and secret
//   trif-release-key                   the release signing key (made by `keygen`)
// Each is also found under its name from before 0.2.0, when TRIF was called WebMods (webmods-amo-issuer,
// webmods-amo-secret, webmods-release-key), so existing keychains keep working without renaming.
//
// No secret goes in a command's arguments or environment, which any process of the same user can read
// while the command runs (`ps`, sysctl KERN_PROCARGS2): keygen gives the key to `security -i` on its stdin;
// web-ext reads the addons.mozilla.org key and secret from the keychain itself (scripts/web-ext-amo.cjs,
// its config file), so they're not in its environment.
// TRIF_KEYCHAIN_BIN (tests): a stand-in for /usr/bin/security (tests/fake-keychain.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');
const { githubRepo, compareVersions, FIREFOX_XPI } = require('../helper/lib/update');
const { writeShippedHistory, OUT: SHIPPED_HISTORY } = require('./shipped-history');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KEY_SERVICE = 'trif-release-key';
const AMO_ISSUER = 'trif-amo-issuer';
const AMO_SECRET = 'trif-amo-secret';
// The names before 0.2.0.
const LEGACY_SERVICES = { [KEY_SERVICE]: 'webmods-release-key', [AMO_ISSUER]: 'webmods-amo-issuer', [AMO_SECRET]: 'webmods-amo-secret' };
const KEY_FILE = path.join(ROOT, 'helper', 'lib', 'release-key.js');

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function sh(file, args, opts = {}) {
  // With stdio 'inherit' there's no output to return (execFileSync gives null).
  return (execFileSync(file, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) ?? '').trim();
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, v) { fs.writeFileSync(file, JSON.stringify(v, null, 2) + '\n'); }

const securityBin = () => process.env.TRIF_KEYCHAIN_BIN || 'security';

/** A keychain item's value by its name, or else by its name before 0.2.0 (LEGACY_SERVICES); null if neither. */
function keychain(service) {
  const v = keychainItem(service);
  return v !== null || !LEGACY_SERVICES[service] ? v : keychainItem(LEGACY_SERVICES[service]);
}

/** opts.keychain: a keychain file instead of the default keychain search (a throwaway one, to try this). */
function keychainItem(service, { keychain: file = null } = {}) {
  const r = spawnSync(securityBin(), ['find-generic-password', '-s', service, '-w', ...(file ? [file] : [])], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const out = r.stdout.replace(/\n$/, '');
  // `security -w` prints a value with line breaks in it (the PEM key) as hex.
  if (/^([0-9a-f]{2})+$/i.test(out)) {
    const text = Buffer.from(out, 'hex').toString('utf8');
    if (text.startsWith('-----BEGIN')) return text;
  }
  return out;
}

/**
 * What `security -i` reads to save `value` as the item `service`/`account`: the command on its stdin, not
 * in argv; the value as hex (-X), so it needs no quoting and may have line breaks (the PEM key).
 */
function keychainWriteInput(service, account, value, { keychain: file = null } = {}) {
  for (const v of [service, account, file || '']) if (/["\\\n]/.test(v)) throw new Error(`can't pass ${JSON.stringify(v)} to security -i`);
  return `add-generic-password -U -s "${service}" -a "${account}" -X ${Buffer.from(value, 'utf8').toString('hex')}${file ? ` "${file}"` : ''}\n`;
}

/** Save `value` in the keychain (replacing one there), then read it back. Throws an Error that never holds it. */
function saveKeychainItem(service, value, { account = process.env.USER || 'trif', keychain: file = null } = {}) {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  const scrub = (t) => String(t || '').split(value).join('[the key]').split(hex).join('[the key]').trim();
  const r = spawnSync(securityBin(), ['-i'], { input: keychainWriteInput(service, account, value, { keychain: file }), encoding: 'utf8' });
  if (r.error) throw new Error(`couldn't run security: ${r.error.message}`);
  if (r.status !== 0) throw new Error(scrub(r.stderr) || `security exited with ${r.status}`);
  // (security -i can exit 0 when a command in it failed: what counts is that the item is there now)
  if (keychainItem(service, { keychain: file }) !== value) throw new Error(`${service} isn't in the keychain afterwards${r.stderr ? ` (${scrub(r.stderr)})` : ''}`);
}

// ---------------------------------------------------------------- pure parts (tested)

/** The text under "## <version>" in CHANGELOG.md, up to the next "## ", or null. */
function changelogSection(text, version) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

/**
 * The text under "## Unreleased" in CHANGELOG.md, or null. A release stops while there is any: it belongs
 * in the version's section (the panel shows that one), not left behind.
 */
function unreleasedSection(text) {
  return changelogSection(text, 'Unreleased');
}

// What the side panel shows under "What's new" is a version's short summary: the part of its section before
// the first "### " heading (the full notes, "### More", go on the GitHub release). The panel has little room,
// and an update's notes are drawn by the version people already have, so they're kept short: at most
// SUMMARY_ITEMS points and SUMMARY_BYTES, with a link to the full notes.
const SUMMARY_ITEMS = 5;
const SUMMARY_BYTES = 700;

/** A section's summary: its text before the first "### " heading, trimmed. */
function changelogSummary(section) {
  const lines = String(section || '').split('\n');
  const end = lines.findIndex((l) => /^### /.test(l));
  return (end === -1 ? lines : lines.slice(0, end)).join('\n').trim();
}

/**
 * Markdown with the file's line wrapping taken out: a line that goes on a paragraph or list item joins the
 * one before it (the panel keeps line breaks, so wrapped lines would stop halfway across it).
 */
function unwrapMarkdown(md) {
  const out = [];
  for (const line of String(md).split('\n')) {
    const starts = /^\s*$/.test(line) || /^\s*([-*+]|\d+\.)\s/.test(line) || /^#/.test(line) || /^\s*>/.test(line);
    if (!starts && out.length && !/^\s*$/.test(out[out.length - 1])) out[out.length - 1] += ' ' + line.trim();
    else out.push(line);
  }
  return out.join('\n');
}

/** Why a summary is too long for the panel, or null. */
function summaryProblem(summary, version) {
  if (!summary) return `the "## ${version}" section has no summary: start it with a few short points (what the side panel shows), then the rest under "### More"`;
  const items = summary.split('\n').filter((l) => /^\s*([-*+]|\d+\.)\s/.test(l)).length;
  const bytes = Buffer.byteLength(unwrapMarkdown(summary));
  if (items > SUMMARY_ITEMS || bytes > SUMMARY_BYTES) return `the "## ${version}" summary (before "### More") has ${items} points and ${bytes} bytes: keep it to ${SUMMARY_ITEMS} short points and ${SUMMARY_BYTES} bytes (the side panel shows it; the details go under "### More")`;
  return null;
}

/** What the side panel shows: the summary, unwrapped, then a link to the full notes. */
function panelNotes(section, { repo, version }) {
  return `${unwrapMarkdown(changelogSummary(section))}\n\n[All of what's new in ${version}](https://github.com/${repo}/releases/tag/v${version})`;
}

/** "owner/name" of a GitHub remote URL (https or ssh), or null. */
function remoteRepo(url) {
  const m = /^(?:(?:git\+)?https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Why package.json's repository and the git remote disagree (case aside: GitHub ignores it), or null.
 * Installs fetch updates from package.json's repository, and the release is pushed to the remote.
 */
function repoMismatch(pkgRepo, remoteUrl) {
  const remote = remoteRepo(remoteUrl);
  if (!pkgRepo || !remote || pkgRepo.toLowerCase() === remote.toLowerCase()) return null;
  return `package.json's repository is github.com/${pkgRepo}, but the git remote "origin" is github.com/${remote}. ` +
    `Installs fetch updates from package.json's. Rename the GitHub repo first (${remote} → ${pkgRepo}, in its Settings), ` +
    `check that the old raw.githubusercontent.com/${remote}/main/updates/… URLs redirect (installs from before the rename use them), ` +
    `then: git remote set-url origin https://github.com/${pkgRepo}.git`;
}

/**
 * latest.json's exact bytes for a release. `signed`: when it's signed (an ISO time; installs refuse a feed
 * signed more than 8 weeks ago, helper/lib/update.js feedTooOld; releases before 0.3.0 ignore it).
 */
function latestFeed({ version, published, signed, notes, url, sha256, size }) {
  return Buffer.from(JSON.stringify({ version, published, signed, notes, package: { url, sha256, size } }, null, 2) + '\n');
}

/**
 * updates/latest.json signed again at `now`: the same release, with a new `signed` time. Only a feed the
 * release key signed (`sig`, checked against `pub`) is re-signed. Returns {feed, sig} (bytes, text).
 */
function refreshFeed(bytes, sig, { pub, priv, now = new Date() }) {
  let ok = false;
  try { ok = crypto.verify(null, bytes, pub, Buffer.from(String(sig).trim(), 'base64')); } catch { ok = false; }
  if (!ok) throw new Error("updates/latest.json isn't signed by the release key (helper/lib/release-key.js): not signing it again");
  const f = JSON.parse(bytes.toString('utf8'));
  if (!f || !f.package) throw new Error('updates/latest.json has no package');
  const feed = latestFeed({ version: f.version, published: f.published, signed: now.toISOString(), notes: f.notes, url: f.package.url, sha256: f.package.sha256, size: f.package.size });
  return { feed, sig: signBytes(feed, priv) };
}

/** The day a feed signed at `signed` (ISO) stops being accepted (helper/lib/update.js FEED_MAX_AGE_MS). */
function feedStaleOn(signed) {
  return new Date(Date.parse(signed) + require('../helper/lib/update').FEED_MAX_AGE_MS).toISOString().slice(0, 10);
}

function signBytes(bytes, privateKeyPem) {
  return crypto.sign(null, bytes, privateKeyPem).toString('base64') + '\n';
}

/** updates/firefox.json with this version added (Firefox's update manifest format), newest last. */
function firefoxFeed(existing, { id, version, url, sha256 }) {
  const feed = existing && existing.addons ? existing : { addons: {} };
  const entry = feed.addons[id] || (feed.addons[id] = { updates: [] });
  entry.updates = entry.updates.filter((u) => u.version !== version);
  entry.updates.push({ version, update_link: url, update_hash: `sha256:${sha256}` });
  return feed;
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// ---------------------------------------------------------------- the mods feed (pure parts, tested)

/**
 * updates/mods.json's exact bytes (helper/lib/modsfeed.js reads it): `signed` (ISO; refused 8 weeks on, as
 * latest.json), `release` (the TRIF release the mods are compared with), `commit` (the files are fetched at
 * it), `mods` {id: {version, sha256, size, minTrif}}.
 */
function modsFeedBytes({ signed, release, commit, mods = {} }) {
  const sorted = Object.fromEntries(Object.keys(mods).sort().map((id) => [id, mods[id]]));
  return Buffer.from(JSON.stringify({ kind: require('../helper/lib/modsfeed').KIND, signed, release, commit, mods: sorted }, null, 2) + '\n');
}

/**
 * The mods feed's entries: every shipped mod (`list`, not `retired`) whose file at `commit` differs from the
 * one at `since` (the last release's tag). Returns {mods: {id: entry}, problems: [why], notes: [what]}:
 * a problem stops a real run (a changed mod whose @version isn't newer: installs compare versions); a note
 * is what's left out (a mod new since the release, which needs one; one not in `only`).
 */
function modsFeedEntries({ root = ROOT, commit, since, minTrif, only = null, list, retired = [] }) {
  const show = (ref, file) => {
    try { return execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; }
  };
  const { parseHeader, isShippedSource } = require('../helper/lib/mods');
  const { newer } = require('../helper/lib/modsfeed');
  const gone = new Set(retired.map((r) => r.id));
  const mods = {};
  const problems = [];
  const notes = [];
  for (const { id } of list) {
    if (gone.has(id)) continue;
    const file = `examples/sites/${id}.js`;
    const now = show(commit, file);
    if (!now) continue;
    const before = show(since, file);
    if (before && before.equals(now)) continue;
    const h = parseHeader(now.toString('utf8'));
    if (!isShippedSource(h.source)) { problems.push(`${id}: not marked @source webmods at ${commit.slice(0, 7)}`); continue; }
    if (!before) { notes.push(`${id}: new since ${since}, so it comes with the next release, not the mods feed`); continue; }
    const was = parseHeader(before.toString('utf8')).version;
    if (!newer(h.version, was)) { problems.push(`${id} changed since ${since}, but its @version (${h.version || 'none'}) isn't newer than that release's (${was || 'none'}): bump it`); continue; }
    if (only && !only.includes(id)) { notes.push(`${id}: version ${h.version} left out (--only)`); continue; }
    mods[id] = { version: String(h.version), sha256: crypto.createHash('sha256').update(now).digest('hex'), size: now.length, minTrif };
  }
  for (const id of only || []) if (!list.some((m) => m.id === id)) problems.push(`--only ${id}: not one of the mods TRIF ships`);
  return { mods, problems, notes };
}

/** updates/mods.json signed again at `now`, the same mods (refresh-feed). Returns {feed, sig}. */
function refreshModsFeed(bytes, sig, { pub, priv, now = new Date() }) {
  let f;
  try { require('../helper/lib/modsfeed').verifyModsFeed(bytes, sig, pub, { maxAge: Infinity }); f = JSON.parse(bytes.toString('utf8')); } catch (e) {
    throw new Error(`updates/mods.json isn't a mods feed signed by the release key (${e.message}): not signing it again`);
  }
  const feed = modsFeedBytes({ signed: now.toISOString(), release: f.release, commit: f.commit, mods: f.mods || {} });
  return { feed, sig: signBytes(feed, priv) };
}

// ---------------------------------------------------------------- keygen

function keygen(force) {
  if (keychain(KEY_SERVICE) && !force) {
    fail(`the keychain already has ${KEY_SERVICE}. A new key would stop existing installs from accepting updates; use --force only if the old one is lost or leaked.`);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  // (On security's stdin, never in its argv: saveKeychainItem)
  try { saveKeychainItem(KEY_SERVICE, priv); } catch (e) { fail(`couldn't save the key in the keychain: ${e.message}`); }
  const src = fs.readFileSync(KEY_FILE, 'utf8').replace(/module\.exports = [\s\S]*$/, `module.exports = ${JSON.stringify(pub)};\n`);
  fs.writeFileSync(KEY_FILE, src);
  const fp = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  console.log(`Release key created (fingerprint ${fp}).`);
  console.log(`  private: keychain item "${KEY_SERVICE}" (back it up somewhere safe: without it you can't ship updates to existing installs)`);
  console.log(`  public:  ${path.relative(ROOT, KEY_FILE)} (commit it; it ships in the next release)`);
}

// ---------------------------------------------------------------- refresh-feed

function refreshFeedCommand({ dryRun }) {
  const latestPath = path.join(ROOT, 'updates', 'latest.json');
  if (!fs.existsSync(latestPath) || !fs.existsSync(`${latestPath}.sig`)) fail('there is no updates/latest.json (+ .sig) to sign again: release first');
  const pub = require(KEY_FILE);
  if (!pub) fail('helper/lib/release-key.js has no public key');
  const priv = keychain(KEY_SERVICE);
  if (!priv && !dryRun) fail(`the keychain has no ${KEY_SERVICE} (or ${LEGACY_SERVICES[KEY_SERVICE]})`);
  const bytes = fs.readFileSync(latestPath);
  const sig = fs.readFileSync(`${latestPath}.sig`, 'utf8');
  let out;
  if (priv) {
    try { out = refreshFeed(bytes, sig, { pub, priv }); } catch (e) { fail(e.message); }
  } else {
    // (dry run without the key: the feed as it would be, unsigned)
    const f = JSON.parse(bytes.toString('utf8'));
    out = { feed: latestFeed({ ...f, ...f.package, signed: new Date().toISOString() }), sig: null };
    console.warn('release (dry run): no release key, so the feed is left unsigned');
  }
  const dir = dryRun ? path.join(DIST, 'release', 'refresh') : path.join(ROOT, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), out.feed);
  if (out.sig) fs.writeFileSync(path.join(dir, 'latest.json.sig'), out.sig);
  const { version, signed } = JSON.parse(out.feed.toString('utf8'));
  console.log(`${path.relative(ROOT, path.join(dir, 'latest.json'))}: TRIF ${version}, ${out.sig ? 'signed again' : 'with a new time, unsigned (no release key)'} (good until ${feedStaleOn(signed)}).`);
  // The mods feed expires the same way: signed again with it.
  const modsPath = path.join(ROOT, 'updates', 'mods.json');
  if (fs.existsSync(modsPath) && fs.existsSync(`${modsPath}.sig`)) {
    const mBytes = fs.readFileSync(modsPath);
    let m;
    if (priv) {
      try { m = refreshModsFeed(mBytes, fs.readFileSync(`${modsPath}.sig`, 'utf8'), { pub, priv }); } catch (e) { fail(e.message); }
    } else {
      const f = JSON.parse(mBytes.toString('utf8'));
      m = { feed: modsFeedBytes({ ...f, signed: new Date().toISOString() }), sig: null };
    }
    fs.writeFileSync(path.join(dir, 'mods.json'), m.feed);
    if (m.sig) fs.writeFileSync(path.join(dir, 'mods.json.sig'), m.sig);
    const n = Object.keys(JSON.parse(m.feed.toString('utf8')).mods || {}).length;
    console.log(`${path.relative(ROOT, path.join(dir, 'mods.json'))}: ${n} mod${n === 1 ? '' : 's'}, ${m.sig ? 'signed again' : 'unsigned (no release key)'}.`);
  }
  if (dryRun) console.log('Dry run: updates/ unchanged.');
  else console.log('Commit and push it on main: git add updates && git commit -m "Update feed signed again" && git push');
}

// ---------------------------------------------------------------- mods-feed

async function modsFeedCommand({ dryRun, only, minTrif }) {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const repo = githubRepo(pkg);
  const since = `v${pkg.version}`;
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { cwd: ROOT }).status !== 0) fail(`there's no tag ${since} (the last release) to compare the mods with`);
  const need = minTrif || pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(need)) fail(`--min-trif "${need}" isn't a version like 0.3.0`);
  if (compareVersions(need, pkg.version) > 0) console.warn(`release: --min-trif ${need} is newer than the last release (${pkg.version}): no install can use these until ${need} is out`);
  const problems = [];
  if (!repo) problems.push('package.json has no GitHub "repository"');
  const pub = require(KEY_FILE);
  const priv = keychain(KEY_SERVICE);
  let keyOk = false;
  if (!pub) problems.push('helper/lib/release-key.js has no public key (node scripts/release.js keygen)');
  else if (!priv) problems.push(`the keychain has no ${KEY_SERVICE} (or ${LEGACY_SERVICES[KEY_SERVICE]})`);
  else {
    const probe = Buffer.from('trif');
    try { keyOk = crypto.verify(null, probe, pub, crypto.sign(null, probe, priv)); } catch { keyOk = false; }
    if (!keyOk) problems.push(`the keychain's ${KEY_SERVICE} doesn't match helper/lib/release-key.js`);
  }
  // (the files are fetched at HEAD: what's there must be committed, and main is where installs read the feed)
  if (sh('git', ['status', '--porcelain', '--', 'examples', 'updates'])) problems.push('examples/ or updates/ has uncommitted changes: the feed points at the committed files');
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') problems.push('not on the main branch (installs read the feed from main)');
  const commit = sh('git', ['rev-parse', 'HEAD']);
  const { PREINSTALLED, RETIRED } = require('../helper/lib/preinstalled');
  const entries = modsFeedEntries({ commit, since, minTrif: need, only, list: PREINSTALLED, retired: RETIRED });
  problems.push(...entries.problems);
  if (problems.length && !dryRun) fail(`not ready:\n  - ${problems.join('\n  - ')}`);
  for (const p of problems) console.warn(`release (dry run, would stop a real run): ${p}`);
  for (const n of entries.notes) console.log(`  (${n})`);

  const signed = new Date().toISOString();
  const feed = modsFeedBytes({ signed, release: pkg.version, commit, mods: entries.mods });
  const dir = dryRun ? path.join(DIST, 'release', 'mods-feed') : path.join(ROOT, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const feedPath = path.join(dir, 'mods.json');
  fs.writeFileSync(feedPath, feed);
  if (keyOk) fs.writeFileSync(`${feedPath}.sig`, signBytes(feed, priv));
  else { fs.rmSync(`${feedPath}.sig`, { force: true }); console.warn('release (dry run): mods.json left unsigned (no release key)'); }
  const ids = Object.keys(entries.mods);
  console.log(`\n${path.relative(ROOT, feedPath)}: ${ids.length ? `${ids.length} mod${ids.length === 1 ? '' : 's'} newer than TRIF ${pkg.version}'s` : `no mods (installs drop what an earlier feed had)`}, at ${commit.slice(0, 7)}:`);
  for (const id of ids) console.log(`  ${id}  version ${entries.mods[id].version}, ${entries.mods[id].size} bytes, for TRIF ${entries.mods[id].minTrif} and later`);
  console.log(`Signed for ${signed}; installs accept it until ${feedStaleOn(signed)}.`);
  if (dryRun) { console.log('Dry run: updates/ unchanged.'); return; }

  const answer = await ask(`Publish the mods feed (${ids.length} mod${ids.length === 1 ? '' : 's'}) to github.com/${repo}, main? Installs pick it up within a day. Type "mods" to confirm: `);
  const files = ['updates/mods.json', 'updates/mods.json.sig'];
  if (answer !== 'mods') {
    for (const f of files) {
      if (spawnSync('git', ['ls-files', '--error-unmatch', f], { cwd: ROOT, stdio: 'ignore' }).status === 0) spawnSync('git', ['checkout', '--', f], { cwd: ROOT });
      else fs.rmSync(path.join(ROOT, f), { force: true });
    }
    fail('not published; updates/mods.json is as it was');
  }
  sh('git', ['add', '--', ...files]);
  sh('git', ['commit', '-m', ids.length ? `Mods feed: ${ids.map((id) => `${id} ${entries.mods[id].version}`).join(', ')}` : 'Mods feed: empty', '--', ...files]);
  sh('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  console.log(`\nPublished the mods feed. Installs of TRIF ${need} and later pick it up within a day.`);
}

// ---------------------------------------------------------------- release

// web-ext's config file for signing: it reads the addons.mozilla.org key and secret from the keychain.
const WEB_EXT_CONFIG = path.join(__dirname, 'web-ext-amo.cjs');

/** `web-ext sign`'s arguments: no key or secret in them (WEB_EXT_CONFIG reads those). */
function webExtSignArgs({ sourceDir, artifactsDir, amoBaseUrl = null }) {
  return ['sign', '--no-config-discovery', '--config', WEB_EXT_CONFIG, '--channel', 'unlisted', '--source-dir', sourceDir, '--artifacts-dir', artifactsDir,
    ...(amoBaseUrl ? ['--amo-base-url', amoBaseUrl] : [])];
}

/** web-ext's environment: this one without any WEB_EXT_API_* (a key or secret exported in the shell). */
function webExtEnv(env = process.env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (/^WEB_EXT_API_/i.test(k)) delete out[k];
  return out;
}

// TRIF's own Node (helper/runtime.json, helper/lib/runtime.js).
const RUNTIME_FILE = path.join(ROOT, 'helper', 'runtime.json');
const NODE_DIST = 'https://nodejs.org/dist/';
// nodejs.org's names for the platforms TRIF runs on, and the archives kept for each (first = preferred).
const RUNTIME_PLATFORMS = {
  'darwin-arm64': ['tar.xz', 'tar.gz'], 'darwin-x64': ['tar.xz', 'tar.gz'],
  'linux-x64': ['tar.xz', 'tar.gz'], 'linux-arm64': ['tar.xz', 'tar.gz'],
  'win-x64': ['zip'], 'win-arm64': ['zip'],
};

/** runtime.json for Node `version` (24.22.3) from that release's SHASUMS256.txt. Throws when a platform's archive is missing. */
function runtimePins(version, shasums, { dist = NODE_DIST } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" isn't a Node version like 24.22.3`);
  const sums = new Map();
  for (const line of String(shasums).split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
    if (m) sums.set(m[2], m[1]);
  }
  const base = `${dist}v${version}/`;
  const archives = {};
  for (const [key, exts] of Object.entries(RUNTIME_PLATFORMS)) {
    archives[key] = exts.map((ext) => {
      const file = `node-v${version}-${key}.${ext}`;
      if (!sums.has(file)) throw new Error(`SHASUMS256.txt for Node ${version} has no ${file}`);
      return { file, sha256: sums.get(file) };
    });
  }
  return {
    _: `TRIF's own Node (lib/runtime.js). Pins from ${base}SHASUMS256.txt; refreshed by release.js, never by hand.`,
    version, base, archives,
  };
}

/** What's wrong with runtime pins for a release (a platform or checksum missing), or null. */
function runtimePinsProblem(pins) {
  if (!pins || !/^\d+\.\d+\.\d+$/.test(pins.version || '') || !/^https:\/\//.test(pins.base || '')) return 'helper/runtime.json has no version or https base';
  for (const key of Object.keys(RUNTIME_PLATFORMS)) {
    const list = pins.archives && pins.archives[key];
    if (!Array.isArray(list) || !list.length) return `helper/runtime.json has no archive for ${key}`;
    for (const a of list) if (!/^[0-9a-f]{64}$/.test(a.sha256 || '') || !/^node-v[\w.-]+$/.test(a.file || '')) return `helper/runtime.json's ${key} entry ${a.file || '?'} isn't a file and SHA-256`;
  }
  return null;
}

/**
 * install.sh for a release: the template (scripts/install.sh) with the package's URL and SHA-256 and the
 * runtime pins (its unix platforms) written in. Throws on a value that can't go in the script as is.
 */
function installScript(template, { version, packageUrl, packageSha256, pins }) {
  const problem = runtimePinsProblem(pins);
  if (problem) throw new Error(problem);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`bad version ${version}`);
  if (!/^https:\/\/[\w.-]+\/[\w./%+-]+$/.test(packageUrl)) throw new Error(`install.sh: the package URL ${packageUrl} isn't a plain https URL`);
  if (!/^[0-9a-f]{64}$/.test(packageSha256)) throw new Error('install.sh: the package SHA-256 is not 64 hex digits');
  const rows = Object.entries(pins.archives).filter(([key]) => !key.startsWith('win-'))
    .flatMap(([key, list]) => list.filter((a) => /\.tar\.(xz|gz)$/.test(a.file)).map((a) => `${key} ${a.file} ${a.sha256}`));
  const values = { VERSION: version, PACKAGE_URL: packageUrl, PACKAGE_SHA256: packageSha256, NODE_VERSION: pins.version, NODE_BASE: pins.base, NODE_ARCHIVES: rows.join('\n') };
  const out = template.replace(/@@([A-Z0-9_]+)@@/g, (m, name) => {
    if (!(name in values)) throw new Error(`install.sh template: unknown ${m}`);
    return values[name];
  });
  return out;
}

/**
 * install.ps1 for a release (Windows): the template (scripts/install.ps1) with the package's URL and SHA-256
 * and the Windows runtime pins (.zip) written in, as installScript does install.sh's. Single-quoted
 * PowerShell strings, so only plain values go in (checked here).
 */
function installScriptWindows(template, { version, packageUrl, packageSha256, pins, nodeDist = NODE_DIST }) {
  const problem = runtimePinsProblem(pins);
  if (problem) throw new Error(problem);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`bad version ${version}`);
  if (!/^https:\/\/[\w.-]+\/[\w./%+-]+$/.test(packageUrl)) throw new Error(`install.ps1: the package URL ${packageUrl} isn't a plain https URL`);
  // (node.exe from nodejs.org's own release folder for the pinned version, as refresh-runtime pinned it)
  if (pins.base !== `${nodeDist}v${pins.version}/`) throw new Error(`install.ps1: the runtime's base ${pins.base} isn't ${nodeDist}v${pins.version}/`);
  if (!/^[0-9a-f]{64}$/.test(packageSha256)) throw new Error('install.ps1: the package SHA-256 is not 64 hex digits');
  const rows = Object.entries(pins.archives).filter(([key]) => key.startsWith('win-'))
    .flatMap(([key, list]) => list.filter((a) => /\.zip$/.test(a.file)).map((a) => `${key} ${a.file} ${a.sha256}`));
  if (!rows.length) throw new Error('install.ps1: helper/runtime.json has no Windows .zip');
  const values = { VERSION: version, PACKAGE_URL: packageUrl, PACKAGE_SHA256: packageSha256, NODE_VERSION: pins.version, NODE_BASE: pins.base, NODE_ARCHIVES: rows.join('\n') };
  return template.replace(/@@([A-Z0-9_]+)@@/g, (m, name) => {
    if (!(name in values)) throw new Error(`install.ps1 template: unknown ${m}`);
    return values[name];
  });
}

/**
 * site/src/install-windows.js for a release: `script` (installScriptWindows') as the module
 * timsrobot.com/install.ps1 serves (site/src/index.js installerWindows). Throws on a script with a
 * placeholder left or without its pins.
 */
function installModuleWindows(script, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`bad version ${version}`);
  if (!String(script).startsWith('# Installs TRIF ') || /@@[A-Z0-9_]+@@/.test(script)) throw new Error('install-windows.js: the script isn\'t a filled-in install.ps1');
  if (!/^ {2}\$PackageSha256 = '[0-9a-f]{64}'$/m.test(script)) throw new Error('install-windows.js: the script has no pinned package SHA-256');
  if (!/^win-(x64|arm64) node-v[\w.-]+\.zip [0-9a-f]{64}$/m.test(script)) throw new Error('install-windows.js: the script has no pinned node.exe .zip');
  return [
    `// Made by scripts/release.js (installModuleWindows) for TRIF ${version}, from scripts/install.ps1: don't edit here.`,
    '// timsrobot.com/install.ps1 serves it (site/src/index.js). Its package and TRIF\'s own node.exe .zip are pinned by',
    '// SHA-256 in the script, which checks both before it runs anything; it changes only with a commit and a deploy of the site.',
    `export const INSTALL_PS1_VERSION = ${JSON.stringify(version)};`,
    `export const INSTALL_PS1 = ${JSON.stringify(script)};`,
    '',
  ].join('\n');
}
const INSTALL_WINDOWS_MODULE = path.join(ROOT, 'site', 'src', 'install-windows.js');

/**
 * Whether the package as published (`url`) is the very file the installer pins (`sha256`): a few tries, since a
 * new release's download can take a moment to appear. Throws when it isn't, or can't be fetched.
 */
async function checkPublished(url, expected, { fetch = require('../helper/lib/update').fetchUrl, tries = 5, wait = 5000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const got = crypto.createHash('sha256').update(await fetch(url, { maxBytes: 60 * 1024 * 1024, timeoutMs: 120000 })).digest('hex');
      if (got !== expected) throw Object.assign(new Error(`${url} is ${got}, not the ${expected} the installer pins`), { final: true });
      return;
    } catch (e) {
      if (e.final) throw e;
      last = e;
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`couldn't fetch ${url} to check it: ${last && last.message}`);
}

/**
 * Whether the Windows runtime pins (helper/runtime.json's win-* .zip files) are what nodejs.org's
 * SHASUMS256.txt for that version says, fetched now (install.ps1 pins them). Throws on any difference.
 */
async function checkWindowsPins(pins, { fetch = require('../helper/lib/update').fetchUrl, dist = NODE_DIST } = {}) {
  const sums = new Map();
  for (const line of String(await fetch(`${dist}v${pins.version}/SHASUMS256.txt`, { maxBytes: 1024 * 1024, timeoutMs: 60000 })).split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
    if (m) sums.set(m[2], m[1]);
  }
  let n = 0;
  for (const [key, list] of Object.entries(pins.archives || {})) {
    if (!key.startsWith('win-')) continue;
    for (const a of list) {
      n++;
      if (sums.get(a.file) !== a.sha256) throw new Error(`helper/runtime.json pins ${a.file} as ${a.sha256}; nodejs.org's SHASUMS256.txt says ${sums.get(a.file) || 'nothing'}`);
    }
  }
  if (!n) throw new Error('helper/runtime.json has no Windows .zip');
}

/** The newest Node release of `major` in nodejs.org's index.json. */
function newestNode(index, major) {
  const vs = (Array.isArray(index) ? index : []).map((r) => String(r.version || '').replace(/^v/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && v.split('.')[0] === String(major));
  return vs.sort((a, b) => compareVersions(b, a))[0] || null;
}

async function refreshRuntimeCommand({ dryRun, version = null, dist = process.env.TRIF_NODE_DIST || NODE_DIST, fetch = require('../helper/lib/update').fetchUrl, runtimeFile = RUNTIME_FILE, outDir = path.join(DIST, 'release', 'runtime') }) {
  const current = readJson(runtimeFile);
  if (!version) {
    const major = current.version.split('.')[0];
    version = newestNode(JSON.parse(String(await fetch(`${dist}index.json`, { maxBytes: 8 * 1024 * 1024, timeoutMs: 60000 }))), major);
    if (!version) fail(`${dist}index.json lists no Node ${major} release`);
  }
  const shasums = await fetch(`${dist}v${version}/SHASUMS256.txt`, { maxBytes: 1024 * 1024, timeoutMs: 60000 });
  // (SHASUMS256.txt.sig, beside it, is GPG-signed by Node's releasers; not checked here: HTTPS to nodejs.org.)
  const pins = runtimePins(version, shasums, { dist });
  const text = JSON.stringify(pins, null, 2) + '\n';
  const file = dryRun ? path.join(outDir, 'runtime.json') : runtimeFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(current.version === version ? `Node ${version} is already the pinned one; pins rewritten from its SHASUMS256.txt` : `Node ${current.version} → ${version}`);
  console.log(dryRun ? `Dry run: wrote ${path.relative(ROOT, file)}; helper/runtime.json unchanged.` : 'Wrote helper/runtime.json: run the tests, then commit it.');
  return { file, pins };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function preflight(version, { dryRun }) {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const repo = githubRepo(pkg);
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" isn't a version like 0.1.2`);
  if (compareVersions(version, pkg.version) <= 0) fail(`${version} isn't newer than the current ${pkg.version}`);
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const notes = changelogSection(changelog, version);
  if (!notes) fail(`CHANGELOG.md has no "## ${version}" section`);

  // What a real release needs; a dry run only warns about them.
  const problems = [];
  if (unreleasedSection(changelog)) problems.push(`CHANGELOG.md still has a "## Unreleased" section: move what's in it into "## ${version}" (the panel shows that one) and delete it`);
  const tooLong = summaryProblem(changelogSummary(notes), version);
  if (tooLong) problems.push(tooLong);
  if (Buffer.byteLength(notes) > 3900) problems.push(`the "## ${version}" notes are ${Buffer.byteLength(notes)} bytes: keep them under 3900 (updaters before 0.2.0 cut them at 4000)`);
  if (!repo) problems.push('package.json has no GitHub "repository"');
  else {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
    const why = remote.status === 0 ? repoMismatch(repo, remote.stdout) : null;
    if (why) problems.push(why);
  }
  const pub = require(KEY_FILE);
  const priv = keychain(KEY_SERVICE);
  let keyOk = false;
  if (!pub) problems.push('helper/lib/release-key.js has no public key (node scripts/release.js keygen)');
  else if (!priv) problems.push(`the keychain has no ${KEY_SERVICE} (or ${LEGACY_SERVICES[KEY_SERVICE]})`);
  else {
    const probe = Buffer.from('trif');
    try { keyOk = crypto.verify(null, probe, pub, crypto.sign(null, probe, priv)); } catch { keyOk = false; }
    if (!keyOk) problems.push(`the keychain's ${KEY_SERVICE} doesn't match helper/lib/release-key.js`);
  }
  if (sh('git', ['status', '--porcelain'])) problems.push('the working tree has uncommitted changes');
  // main, or release-<version>: a release cut from an earlier commit than main (0.2.5: 0.2.4 plus a few
  // changes, while main moved on). Installs read the feeds from main, so on a release branch they go live
  // when the branch is merged into main, after this script.
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main' && branch !== `release-${version}`) problems.push(`not on the main branch (or release-${version})`);
  if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) problems.push("gh isn't logged in (gh auth login)");
  const pinsProblem = runtimePinsProblem(readJson(RUNTIME_FILE));
  if (pinsProblem) problems.push(`${pinsProblem} (node scripts/release.js refresh-runtime)`);
  for (const s of [AMO_ISSUER, AMO_SECRET]) if (!keychain(s)) problems.push(`the keychain has no ${s} (or ${LEGACY_SERVICES[s]})`);
  if (problems.length && !dryRun) fail(`not ready:\n  - ${problems.join('\n  - ')}`);
  for (const p of problems) console.warn(`release (dry run, would stop a real release): ${p}`);
  // Not checked here (it would need the network): README and listing say `npx timsrobot setup`, which only
  // works once `trif` is published on npm, by you. This script doesn't publish to npm.
  console.warn(`release: reminder: this doesn't publish to npm. \`npx ${pkg.name} setup\` needs "${pkg.name}" published there by you (npm view ${pkg.name}; npm publish ${'<'}the .tgz${'>'} after the release).`);
  return { pkg, repo, notes, priv: keyOk ? priv : null };
}

/**
 * The files to attach to the GitHub release. With a signed add-on (`xpi`), that's it and a copy named
 * FIREFOX_XPI, made here in `out`: every release has one by that name, so
 * releases/latest/download/trif-firefox.xpi is a link to the newest add-on that never changes. install.sh
 * likewise: releases/latest/download/install.sh is always the newest release's.
 */
// (Never install.ps1: the site serves it, site/src/install-windows.js.)
function releaseAssets(out, { tgz, chromeZip, xpi, zips, installSh = null }) {
  const latestXpi = xpi && path.join(out, FIREFOX_XPI);
  if (latestXpi) fs.copyFileSync(xpi, latestXpi);
  return [tgz, chromeZip, ...(xpi ? [xpi, latestXpi] : []), ...zips, ...(installSh ? [installSh] : [])];
}

function bump(version, dir = ROOT) {
  const pkgFile = path.join(dir, 'package.json');
  const pkg = readJson(pkgFile);
  pkg.version = version;
  writeJson(pkgFile, pkg);
  const manFile = path.join(dir, 'extension', 'manifest.json');
  const man = readJson(manFile);
  man.version = version;
  writeJson(manFile, man);
  const lockFile = path.join(dir, 'package-lock.json');
  if (fs.existsSync(lockFile)) {
    const lock = readJson(lockFile);
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    writeJson(lockFile, lock);
  }
  // (the README's install steps name the release they install)
  const readmeFile = path.join(dir, 'README.md');
  if (fs.existsSync(readmeFile)) {
    const before = fs.readFileSync(readmeFile, 'utf8');
    const after = before.replace(/timsrobot-\d+\.\d+\.\d+\.tgz/g, `timsrobot-${version}.tgz`)
      .replace(/(These steps install the latest release, \*\*)\d+\.\d+\.\d+(\*\*)/, `$1${version}$2`);
    if (after !== before) fs.writeFileSync(readmeFile, after);
  }
}

function betaZip(out, kind, version, files) {
  const name = `trif-beta-${kind}`;
  const stage = path.join(out, 'stage', name);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const readme = fs.readFileSync(path.join(ROOT, 'beta', kind, 'START HERE.txt'), 'utf8').replace(/\{\{VERSION\}\}/g, version);
  fs.writeFileSync(path.join(stage, 'START HERE.txt'), readme);
  for (const [from, to] of files) fs.copyFileSync(from, path.join(stage, to));
  const zip = path.join(out, `${name}-${version}.zip`);
  fs.rmSync(zip, { force: true });
  sh('ditto', ['-c', '-k', '--keepParent', stage, zip]);
  return zip;
}

/**
 * Whether a signed .xpi holds exactly the files in `dir` (Mozilla's signature files aside), so an earlier
 * run's signed add-on can be reused for the same build.
 */
function xpiMatches(xpi, dir) {
  const listDir = (d, base = d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listDir(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]));
  let names;
  try { names = execFileSync('unzip', ['-Z1', xpi], { encoding: 'utf8' }).split('\n').filter((n) => n && !n.endsWith('/') && !n.startsWith('META-INF/')); } catch { return false; }
  const files = listDir(dir);
  if (names.length !== files.length || !files.every((f) => names.includes(f))) return false;
  return files.every((f) => execFileSync('unzip', ['-p', xpi, f], { maxBuffer: 64 * 1024 * 1024 }).equals(fs.readFileSync(path.join(dir, f))));
}

async function release(version, { dryRun, skipTests }) {
  const { repo, notes, priv } = preflight(version, { dryRun });
  const out = path.join(DIST, 'release', version);
  // A fresh start, except for the Mozilla-signed add-on: Mozilla never signs the same version twice, so
  // losing it (a declined or failed run, then a re-run) would make this version unshippable for Firefox.
  const signedName = `trif-firefox-${version}.xpi`;
  if (fs.existsSync(out)) for (const f of fs.readdirSync(out)) if (f !== signedName) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Dry runs build from a copy, so no tracked file changes.
  let src = ROOT;
  if (dryRun) {
    src = path.join(out, 'src');
    // A git checkout of its own (some tests need one: setup links to a checkout, the upgrade test reads
    // the last release's tag), sharing this repo's objects without changing it, at this commit, with the
    // working tree's tracked files on top (a dry run tests what's here, committed or not).
    sh('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, src]);
    sh('git', ['checkout', '--quiet', '--detach', sh('git', ['rev-parse', 'HEAD'])], { cwd: src });
    for (const f of sh('git', ['ls-files']).split('\n').filter(Boolean)) {
      const from = path.join(ROOT, f);
      if (!fs.existsSync(from)) continue; // deleted here, not yet committed
      fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
      fs.cpSync(from, path.join(src, f), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(src, 'node_modules'));
  }
  bump(version, src);
  console.log(`version ${version}`);
  // Every version of the example mods this repo has held, so setup recognises users' unchanged copies of
  // any of them (see scripts/shipped-history.js). From the repo's git history, into what gets packed.
  if (writeShippedHistory(ROOT, src).changed) console.log(`${SHIPPED_HISTORY} brought up to date`);

  if (!skipTests) {
    console.log('running tests…');
    // (10 minutes per test file: agents.test.js runs real Claude Code, and can take over 2)
    const t = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=600000'], { cwd: src, stdio: 'inherit' });
    if (t.status !== 0) fail('tests failed');
  }
  for (const target of ['chrome', 'firefox']) sh(process.execPath, [path.join(src, 'scripts', 'build-extension.js'), target], { cwd: src });
  const builtDist = path.join(src, 'dist');
  const tgzName = sh('npm', ['pack', '--pack-destination', out], { cwd: src }).split('\n').pop();
  const tgz = path.join(out, tgzName);
  fs.copyFileSync(path.join(builtDist, `trif-extension-${version}.zip`), path.join(out, `trif-chrome-${version}.zip`));
  console.log(`built ${tgzName} and the Chrome and Firefox extensions`);

  let xpi = null;
  const earlier = path.join(out, signedName);
  if (!dryRun && fs.existsSync(earlier)) {
    if (!xpiMatches(earlier, path.join(builtDist, 'firefox'))) {
      fail(`${path.relative(ROOT, earlier)} (signed by Mozilla in an earlier run) doesn't match this build, and Mozilla won't sign ${version} again: release a new version`);
    }
    console.log(`reusing the Firefox add-on Mozilla signed in an earlier run (${path.relative(ROOT, earlier)})`);
    xpi = earlier;
  } else if (!dryRun) {
    console.log('asking Mozilla to sign the Firefox add-on (takes a few minutes)…');
    const amo = path.join(out, 'amo');
    const webExt = path.join(ROOT, 'node_modules', '.bin', 'web-ext');
    // (The key and secret: web-ext reads them from the keychain itself, through its config file, so
    // they're in neither its arguments nor its environment. webExtSignArgs.)
    const r = spawnSync(webExt, webExtSignArgs({ sourceDir: path.join(builtDist, 'firefox'), artifactsDir: amo }), {
      cwd: ROOT, stdio: 'inherit', env: webExtEnv(),
    });
    const signed = fs.existsSync(amo) ? fs.readdirSync(amo).filter((f) => f.endsWith('.xpi')) : [];
    if (r.status !== 0 || signed.length !== 1) fail('Firefox signing failed (see above)');
    xpi = path.join(out, `trif-firefox-${version}.xpi`);
    fs.renameSync(path.join(amo, signed[0]), xpi);
  }

  const zips = [betaZip(out, 'chrome', version, [[tgz, tgzName]])];
  if (xpi) zips.push(betaZip(out, 'firefox', version, [[tgz, tgzName], [xpi, FIREFOX_XPI]]));

  // Feeds, pointing at the release's files on GitHub.
  const base = `https://github.com/${repo || 'OWNER/trif'}/releases/download/v${version}`;
  const signed = new Date().toISOString();
  const published = signed.slice(0, 10);
  const feed = latestFeed({ version, published, signed, notes: panelNotes(notes, { repo, version }), url: `${base}/${tgzName}`, sha256: sha256(tgz), size: fs.statSync(tgz).size });
  const feedsDir = dryRun ? path.join(out, 'updates') : path.join(ROOT, 'updates');
  fs.mkdirSync(feedsDir, { recursive: true });
  const latestPath = path.join(feedsDir, 'latest.json');
  if (priv) {
    fs.writeFileSync(latestPath, feed);
    fs.writeFileSync(`${latestPath}.sig`, signBytes(feed, priv));
  } else {
    fs.writeFileSync(latestPath, feed);
    console.warn('release (dry run): latest.json left unsigned (no release key)');
  }
  // The mods feed, empty: this release ships every mod as it is (a mods feed from before would offer
  // versions it already has, or, to installs of an older TRIF, versions made for this one).
  const modsFeed = modsFeedBytes({ signed, release: version, commit: sh('git', ['rev-parse', 'HEAD']), mods: {} });
  fs.writeFileSync(path.join(feedsDir, 'mods.json'), modsFeed);
  if (priv) fs.writeFileSync(path.join(feedsDir, 'mods.json.sig'), signBytes(modsFeed, priv));
  if (xpi) {
    const ffPath = path.join(feedsDir, 'firefox.json');
    const existing = fs.existsSync(path.join(ROOT, 'updates', 'firefox.json')) ? readJson(path.join(ROOT, 'updates', 'firefox.json')) : null;
    writeJson(ffPath, firefoxFeed(existing, { id: require('../helper/lib/paths').FIREFOX_EXTENSION_ID, version, url: `${base}/trif-firefox-${version}.xpi`, sha256: sha256(xpi) }));
  }

  // install.sh: installs this release with no Node (TRIF's own, pinned in helper/runtime.json).
  const installSh = path.join(out, 'install.sh');
  fs.writeFileSync(installSh, installScript(fs.readFileSync(path.join(src, 'scripts', 'install.sh'), 'utf8'), {
    version, packageUrl: `${base}/${tgzName}`, packageSha256: sha256(tgz), pins: readJson(path.join(src, 'helper', 'runtime.json')),
  }), { mode: 0o755 });
  // install.ps1: the same for Windows (Windows PowerShell; TRIF's own node.exe). Not a release file either:
  // site/src/install-windows.js, written after the release once the published package is checked against its
  // pin (here, a copy to read). Its node.exe pins are checked against nodejs.org's SHASUMS256.txt first.
  const runtimePinsNow = readJson(path.join(src, 'helper', 'runtime.json'));
  await checkWindowsPins(runtimePinsNow, { dist: process.env.TRIF_NODE_DIST || NODE_DIST });
  const installPs1Text = installScriptWindows(fs.readFileSync(path.join(src, 'scripts', 'install.ps1'), 'utf8'), {
    version, packageUrl: `${base}/${tgzName}`, packageSha256: sha256(tgz), pins: runtimePinsNow,
  });
  fs.writeFileSync(path.join(out, 'install.ps1'), installPs1Text);
  const installWindowsJs = installModuleWindows(installPs1Text, version);
  fs.writeFileSync(path.join(out, 'install-windows.js'), installWindowsJs);

  const assets = releaseAssets(out, { tgz, chromeZip: path.join(out, `trif-chrome-${version}.zip`), xpi, zips, installSh });
  console.log(`\nReady in ${path.relative(ROOT, out)}:`);
  for (const a of assets) console.log(`  ${path.basename(a)}`);
  console.log(`\nWhat's new in ${version} (the side panel's summary):\n${panelNotes(notes, { repo, version })}\n`);
  console.log(`The feed is signed for ${signed}; installs accept it until ${feedStaleOn(signed)}.`);
  if (dryRun) {
    // The copy it built from holds the tests too; left there, `node --test` would find them.
    fs.rmSync(src, { recursive: true, force: true });
    console.log('Dry run: nothing published.');
    return;
  }

  const visibility = spawnSync('gh', ['repo', 'view', repo, '--json', 'visibility', '-q', '.visibility'], { encoding: 'utf8' }).stdout?.trim().toLowerCase();
  const who = visibility === 'public' ? 'Anyone can see it, and installs will pick it up.'
    : visibility === 'private' ? 'The repo is private: only you can see it, and installs can\'t fetch updates from it yet.'
      : '';
  const answer = await ask(`Publish TRIF ${version} to github.com/${repo}? ${who} Type ${version} to confirm: `);
  if (answer !== version) {
    sh('git', ['checkout', '--', 'package.json', 'extension/manifest.json', 'package-lock.json', SHIPPED_HISTORY]);
    spawnSync('git', ['checkout', '--', 'updates'], { cwd: ROOT }); // tracked feeds back as they were
    spawnSync('git', ['clean', '-fq', '--', 'updates'], { cwd: ROOT }); // a first release's new ones gone
    fail('not published; the version bump and feeds were rolled back (the built files are still in dist/release)');
  }
  sh('git', ['add', 'package.json', 'extension/manifest.json', 'package-lock.json', SHIPPED_HISTORY, 'README.md']); // (README: its install steps name the version)
  sh('git', ['commit', '-m', `Release ${version}`]);
  sh('git', ['tag', '-a', `v${version}`, '-m', `TRIF ${version}`]);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  sh('git', ['push', 'origin', branch, `v${version}`], { stdio: 'inherit' });
  const notesFile = path.join(out, 'notes.md');
  fs.writeFileSync(notesFile, notes + '\n');
  execFileSync('gh', ['release', 'create', `v${version}`, ...assets, '--repo', repo, '--title', `TRIF ${version}`, '--notes-file', notesFile], { cwd: ROOT, stdio: 'inherit' });
  // Windows' installer: the package as GitHub serves it must be the one install.ps1 pins, or nothing changes
  // on the site (the release stays; the feeds below still check every download themselves).
  let installerWindows = true;
  try { await checkPublished(`${base}/${tgzName}`, sha256(tgz)); } catch (e) {
    installerWindows = false;
    console.error(`\nThe published package doesn't check out, so site/src/install-windows.js is left as it was: ${e.message}`);
  }
  if (installerWindows) fs.writeFileSync(INSTALL_WINDOWS_MODULE, installWindowsJs);
  // The feeds go live last: by now the files they point at exist.
  sh('git', ['add', 'updates', ...(installerWindows ? [INSTALL_WINDOWS_MODULE] : [])]);
  sh('git', ['commit', '-m', installerWindows ? `Update feeds and the Windows installer for ${version}` : `Update feeds for ${version}`]);
  sh('git', ['push', 'origin', branch], { stdio: 'inherit' });
  if (installerWindows) console.log(`\nThe Windows installer for ${version} is in site/src/install-windows.js. It goes live when the site is deployed from this commit (cd site && npx wrangler deploy); until then timsrobot.com/install.ps1 installs the release it had.`);
  if (branch !== 'main') {
    console.log(`\nReleased TRIF ${version} from ${branch}. The feeds are committed there: installs see the update once ${branch} is merged into main and main is pushed.`);
    return;
  }
  console.log(`\nPublished TRIF ${version}. Installs pick it up within a day (the panel offers it; Firefox updates the add-on itself).`);
  console.log(`The feed is good until ${feedStaleOn(signed)}: release again before then, or run node scripts/release.js refresh-feed.`);
  console.log(`Beta zips for new testers: ${zips.map((z) => path.relative(ROOT, z)).join(', ')}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [cmd] = args.filter((a) => !a.startsWith('--'));
  if (!cmd) fail('usage: node scripts/release.js keygen | refresh-feed [--dry-run] | refresh-runtime [<node version>] [--dry-run] | mods-feed [--dry-run] [--only <id,id>] [--min-trif <version>] | <version> [--dry-run] [--skip-tests]');
  const value = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fail(`${flag} needs a value`); };
  if (cmd === 'keygen') keygen(flags.has('--force'));
  else if (cmd === 'refresh-feed') refreshFeedCommand({ dryRun: flags.has('--dry-run') });
  else if (cmd === 'refresh-runtime') {
    const version = args.filter((a) => !a.startsWith('--'))[1] || null;
    refreshRuntimeCommand({ dryRun: flags.has('--dry-run'), version }).catch((e) => fail(e.stack || e.message));
  }
  else if (cmd === 'mods-feed') {
    const only = value('--only');
    modsFeedCommand({ dryRun: flags.has('--dry-run'), only: only ? only.split(',').map((x) => x.trim()).filter(Boolean) : null, minTrif: value('--min-trif') }).catch((e) => fail(e.stack || e.message));
  }
  else release(cmd, { dryRun: flags.has('--dry-run'), skipTests: flags.has('--skip-tests') }).catch((e) => fail(e.stack || e.message));
}

module.exports = { runtimePins, runtimePinsProblem, installScript, installScriptWindows, installModuleWindows, INSTALL_WINDOWS_MODULE, checkPublished, checkWindowsPins, newestNode, refreshRuntimeCommand, RUNTIME_PLATFORMS, modsFeedBytes, modsFeedEntries, refreshModsFeed, AMO_ISSUER, AMO_SECRET, keychain, keychainItem, keychainWriteInput, saveKeychainItem, refreshFeed, feedStaleOn, webExtSignArgs, webExtEnv, WEB_EXT_CONFIG, changelogSection, unreleasedSection, changelogSummary, unwrapMarkdown, summaryProblem, panelNotes, remoteRepo, repoMismatch, latestFeed, signBytes, firefoxFeed, bump, xpiMatches, releaseAssets };
