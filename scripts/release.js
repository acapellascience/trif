#!/usr/bin/env node
'use strict';
// Releasing TRIF. Run by the maintainer, on their Mac (the signing keys live in its keychain).
//
//   node scripts/release.js keygen            once: create the release signing key (Ed25519). The private
//                                             half goes into the keychain, the public half into
//                                             helper/lib/release-key.js (commit it).
//   node scripts/release.js 0.1.2 [--dry-run] [--skip-tests]
//
// A release: checks everything first (clean main branch, a CHANGELOG.md section for the version and no
// "## Unreleased" one, keys, GitHub login, package.json's repository matching the git remote), bumps the version, refreshes examples/shipped-history.json, runs the tests, builds the
// Chrome and Firefox extensions and the npm package, has Mozilla sign the Firefox add-on (unlisted),
// makes the two beta zips, and writes the update feeds: updates/latest.json (+ .sig, signed with the
// release key) for the helper, updates/firefox.json for Firefox. Then it asks before publishing
// anything: a commit and tag, a GitHub release with the files, and the feeds (pushed last, once the files
// they point at exist). The release holds the signed add-on twice: trif-firefox-<version>.xpi for the
// Firefox feed, and trif-firefox.xpi, the name GitHub's releases/latest/download/ link (in the README and
// setup's next steps) needs to always get the newest.
//
// --dry-run does everything up to publishing, into dist/release/<version>, and changes no tracked file
// (no Mozilla signing, so no .xpi; feeds are signed only if the release key is there).
//
// Keychain entries (service names; `security add-generic-password -s <name> -a "$USER" -w`):
//   trif-amo-issuer, trif-amo-secret   addons.mozilla.org API key and secret
//   trif-release-key                   the release signing key (made by `keygen`)
// Each is also found under its name from before 0.2.0, when TRIF was called WebMods (webmods-amo-issuer,
// webmods-amo-secret, webmods-release-key), so existing keychains keep working without renaming.

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

/** A keychain item's value by its name, or else by its name before 0.2.0 (LEGACY_SERVICES); null if neither. */
function keychain(service) {
  const v = keychainItem(service);
  return v !== null || !LEGACY_SERVICES[service] ? v : keychainItem(LEGACY_SERVICES[service]);
}

function keychainItem(service) {
  const r = spawnSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const out = r.stdout.replace(/\n$/, '');
  // `security -w` prints a value with line breaks in it (the PEM key) as hex.
  if (/^([0-9a-f]{2})+$/i.test(out)) {
    const text = Buffer.from(out, 'hex').toString('utf8');
    if (text.startsWith('-----BEGIN')) return text;
  }
  return out;
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

/** latest.json's exact bytes for a release. */
function latestFeed({ version, published, notes, url, sha256, size }) {
  return Buffer.from(JSON.stringify({ version, published, notes, package: { url, sha256, size } }, null, 2) + '\n');
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

// ---------------------------------------------------------------- keygen

function keygen(force) {
  if (keychain(KEY_SERVICE) && !force) {
    fail(`the keychain already has ${KEY_SERVICE}. A new key would stop existing installs from accepting updates; use --force only if the old one is lost or leaked.`);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const r = spawnSync('security', ['add-generic-password', '-U', '-s', KEY_SERVICE, '-a', process.env.USER || 'trif', '-w', priv], { encoding: 'utf8' });
  if (r.status !== 0) fail(`couldn't save the key in the keychain: ${r.stderr.trim()}`);
  const src = fs.readFileSync(KEY_FILE, 'utf8').replace(/module\.exports = [\s\S]*$/, `module.exports = ${JSON.stringify(pub)};\n`);
  fs.writeFileSync(KEY_FILE, src);
  const fp = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  console.log(`Release key created (fingerprint ${fp}).`);
  console.log(`  private: keychain item "${KEY_SERVICE}" (back it up somewhere safe: without it you can't ship updates to existing installs)`);
  console.log(`  public:  ${path.relative(ROOT, KEY_FILE)} (commit it; it ships in the next release)`);
}

// ---------------------------------------------------------------- release

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
 * releases/latest/download/trif-firefox.xpi is a link to the newest add-on that never changes.
 */
function releaseAssets(out, { tgz, chromeZip, xpi, zips }) {
  const latestXpi = xpi && path.join(out, FIREFOX_XPI);
  if (latestXpi) fs.copyFileSync(xpi, latestXpi);
  return [tgz, chromeZip, ...(xpi ? [xpi, latestXpi] : []), ...zips];
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
    const r = spawnSync(webExt, ['sign', '--channel', 'unlisted', '--source-dir', path.join(builtDist, 'firefox'), '--artifacts-dir', amo], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEB_EXT_API_KEY: keychain(AMO_ISSUER), WEB_EXT_API_SECRET: keychain(AMO_SECRET) },
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
  const published = new Date().toISOString().slice(0, 10);
  const feed = latestFeed({ version, published, notes, url: `${base}/${tgzName}`, sha256: sha256(tgz), size: fs.statSync(tgz).size });
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
  if (xpi) {
    const ffPath = path.join(feedsDir, 'firefox.json');
    const existing = fs.existsSync(path.join(ROOT, 'updates', 'firefox.json')) ? readJson(path.join(ROOT, 'updates', 'firefox.json')) : null;
    writeJson(ffPath, firefoxFeed(existing, { id: require('../helper/lib/paths').FIREFOX_EXTENSION_ID, version, url: `${base}/trif-firefox-${version}.xpi`, sha256: sha256(xpi) }));
  }

  const assets = releaseAssets(out, { tgz, chromeZip: path.join(out, `trif-chrome-${version}.zip`), xpi, zips });
  console.log(`\nReady in ${path.relative(ROOT, out)}:`);
  for (const a of assets) console.log(`  ${path.basename(a)}`);
  console.log(`\nWhat's new in ${version}:\n${notes}\n`);
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
  sh('git', ['add', 'package.json', 'extension/manifest.json', 'package-lock.json', SHIPPED_HISTORY]);
  sh('git', ['commit', '-m', `Release ${version}`]);
  sh('git', ['tag', '-a', `v${version}`, '-m', `TRIF ${version}`]);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  sh('git', ['push', 'origin', branch, `v${version}`], { stdio: 'inherit' });
  const notesFile = path.join(out, 'notes.md');
  fs.writeFileSync(notesFile, notes + '\n');
  execFileSync('gh', ['release', 'create', `v${version}`, ...assets, '--repo', repo, '--title', `TRIF ${version}`, '--notes-file', notesFile], { cwd: ROOT, stdio: 'inherit' });
  // The feeds go live last: by now the files they point at exist.
  sh('git', ['add', 'updates']);
  sh('git', ['commit', '-m', `Update feeds for ${version}`]);
  sh('git', ['push', 'origin', branch], { stdio: 'inherit' });
  if (branch !== 'main') {
    console.log(`\nReleased TRIF ${version} from ${branch}. The feeds are committed there: installs see the update once ${branch} is merged into main and main is pushed.`);
    return;
  }
  console.log(`\nPublished TRIF ${version}. Installs pick it up within a day (the panel offers it; Firefox updates the add-on itself).`);
  console.log(`Beta zips for new testers: ${zips.map((z) => path.relative(ROOT, z)).join(', ')}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [cmd] = args.filter((a) => !a.startsWith('--'));
  if (!cmd) fail('usage: node scripts/release.js keygen | <version> [--dry-run] [--skip-tests]');
  if (cmd === 'keygen') keygen(flags.has('--force'));
  else release(cmd, { dryRun: flags.has('--dry-run'), skipTests: flags.has('--skip-tests') }).catch((e) => fail(e.stack || e.message));
}

module.exports = { changelogSection, unreleasedSection, remoteRepo, repoMismatch, latestFeed, signBytes, firefoxFeed, bump, xpiMatches, releaseAssets };
