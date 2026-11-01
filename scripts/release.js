#!/usr/bin/env node
'use strict';
// Releasing WebMods. Run by the maintainer, on their Mac (the signing keys live in its keychain).
//
//   node scripts/release.js keygen            once: create the release signing key (Ed25519). The private
//                                             half goes into the keychain, the public half into
//                                             helper/lib/release-key.js (commit it).
//   node scripts/release.js 0.1.2 [--dry-run] [--skip-tests]
//
// A release: checks everything first (clean main branch, a CHANGELOG.md section for the version, keys,
// GitHub login), bumps the version, runs the tests, builds the Chrome and Firefox extensions and the npm
// package, has Mozilla sign the Firefox add-on (unlisted), makes the two beta zips, and writes the update
// feeds: updates/latest.json (+ .sig, signed with the release key) for the helper, updates/firefox.json for
// Firefox. Then it asks before publishing anything: a commit and tag, a GitHub release with the files,
// and the feeds (pushed last, once the files they point at exist).
//
// --dry-run does everything up to publishing, into dist/release/<version>, and changes no tracked file
// (no Mozilla signing, so no .xpi; feeds are signed only if the release key is there).
//
// Keychain entries (service names; `security add-generic-password -s <name> -a "$USER" -w`):
//   webmods-amo-issuer, webmods-amo-secret   addons.mozilla.org API key and secret
//   webmods-release-key                      the release signing key (made by `keygen`)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');
const { githubRepo, compareVersions } = require('../helper/lib/update');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KEY_SERVICE = 'webmods-release-key';
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

function keychain(service) {
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
  const r = spawnSync('security', ['add-generic-password', '-U', '-s', KEY_SERVICE, '-a', process.env.USER || 'webmods', '-w', priv], { encoding: 'utf8' });
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
  const notes = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) fail(`CHANGELOG.md has no "## ${version}" section`);

  // What a real release needs; a dry run only warns about them.
  const problems = [];
  if (!repo) problems.push('package.json has no GitHub "repository"');
  const pub = require(KEY_FILE);
  const priv = keychain(KEY_SERVICE);
  let keyOk = false;
  if (!pub) problems.push('helper/lib/release-key.js has no public key (node scripts/release.js keygen)');
  else if (!priv) problems.push(`the keychain has no ${KEY_SERVICE}`);
  else {
    const probe = Buffer.from('webmods');
    try { keyOk = crypto.verify(null, probe, pub, crypto.sign(null, probe, priv)); } catch { keyOk = false; }
    if (!keyOk) problems.push(`the keychain's ${KEY_SERVICE} doesn't match helper/lib/release-key.js`);
  }
  if (sh('git', ['status', '--porcelain'])) problems.push('the working tree has uncommitted changes');
  if (sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') problems.push('not on the main branch');
  if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) problems.push("gh isn't logged in (gh auth login)");
  for (const s of ['webmods-amo-issuer', 'webmods-amo-secret']) if (!keychain(s)) problems.push(`the keychain has no ${s}`);
  if (problems.length && !dryRun) fail(`not ready:\n  - ${problems.join('\n  - ')}`);
  for (const p of problems) console.warn(`release (dry run, would stop a real release): ${p}`);
  return { pkg, repo, notes, priv: keyOk ? priv : null };
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
}

function betaZip(out, kind, version, files) {
  const name = `webmods-beta-${kind}`;
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

async function release(version, { dryRun, skipTests }) {
  const { repo, notes, priv } = preflight(version, { dryRun });
  const out = path.join(DIST, 'release', version);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Dry runs build from a copy, so no tracked file changes.
  let src = ROOT;
  if (dryRun) {
    src = path.join(out, 'src');
    fs.mkdirSync(src);
    for (const item of ['package.json', 'package-lock.json', 'helper', 'extension', 'examples', 'docs', 'scripts', 'tests', 'README.md', 'LICENSE']) {
      if (fs.existsSync(path.join(ROOT, item))) fs.cpSync(path.join(ROOT, item), path.join(src, item), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(src, 'node_modules'));
  }
  bump(version, src);
  console.log(`version ${version}`);

  if (!skipTests) {
    console.log('running tests…');
    const t = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=120000'], { cwd: src, stdio: 'inherit' });
    if (t.status !== 0) fail('tests failed');
  }
  for (const target of ['chrome', 'firefox']) sh(process.execPath, [path.join(src, 'scripts', 'build-extension.js'), target], { cwd: src });
  const builtDist = path.join(src, 'dist');
  const tgzName = sh('npm', ['pack', '--pack-destination', out], { cwd: src }).split('\n').pop();
  const tgz = path.join(out, tgzName);
  fs.copyFileSync(path.join(builtDist, `webmods-extension-${version}.zip`), path.join(out, `webmods-chrome-${version}.zip`));
  console.log(`built ${tgzName} and the Chrome and Firefox extensions`);

  let xpi = null;
  if (!dryRun) {
    console.log('asking Mozilla to sign the Firefox add-on (takes a few minutes)…');
    const amo = path.join(out, 'amo');
    const webExt = path.join(ROOT, 'node_modules', '.bin', 'web-ext');
    const r = spawnSync(webExt, ['sign', '--channel', 'unlisted', '--source-dir', path.join(builtDist, 'firefox'), '--artifacts-dir', amo], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEB_EXT_API_KEY: keychain('webmods-amo-issuer'), WEB_EXT_API_SECRET: keychain('webmods-amo-secret') },
    });
    const signed = fs.existsSync(amo) ? fs.readdirSync(amo).filter((f) => f.endsWith('.xpi')) : [];
    if (r.status !== 0 || signed.length !== 1) fail('Firefox signing failed (see above)');
    xpi = path.join(out, `webmods-firefox-${version}.xpi`);
    fs.renameSync(path.join(amo, signed[0]), xpi);
  }

  const zips = [betaZip(out, 'chrome', version, [[tgz, tgzName]])];
  if (xpi) zips.push(betaZip(out, 'firefox', version, [[tgz, tgzName], [xpi, 'webmods-firefox.xpi']]));

  // Feeds, pointing at the release's files on GitHub.
  const base = `https://github.com/${repo || 'OWNER/webmods'}/releases/download/v${version}`;
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
    writeJson(ffPath, firefoxFeed(existing, { id: require('../helper/lib/paths').FIREFOX_EXTENSION_ID, version, url: `${base}/webmods-firefox-${version}.xpi`, sha256: sha256(xpi) }));
  }

  const assets = [tgz, path.join(out, `webmods-chrome-${version}.zip`), ...(xpi ? [xpi] : []), ...zips];
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
  const answer = await ask(`Publish WebMods ${version} to github.com/${repo}? ${who} Type ${version} to confirm: `);
  if (answer !== version) {
    sh('git', ['checkout', '--', 'package.json', 'extension/manifest.json', 'package-lock.json']);
    spawnSync('git', ['checkout', '--', 'updates'], { cwd: ROOT }); // tracked feeds back as they were
    spawnSync('git', ['clean', '-fq', '--', 'updates'], { cwd: ROOT }); // a first release's new ones gone
    fail('not published; the version bump and feeds were rolled back (the built files are still in dist/release)');
  }
  sh('git', ['add', 'package.json', 'extension/manifest.json', 'package-lock.json']);
  sh('git', ['commit', '-m', `Release ${version}`]);
  sh('git', ['tag', '-a', `v${version}`, '-m', `WebMods ${version}`]);
  sh('git', ['push', 'origin', 'main', `v${version}`], { stdio: 'inherit' });
  const notesFile = path.join(out, 'notes.md');
  fs.writeFileSync(notesFile, notes + '\n');
  execFileSync('gh', ['release', 'create', `v${version}`, ...assets, '--repo', repo, '--title', `WebMods ${version}`, '--notes-file', notesFile], { cwd: ROOT, stdio: 'inherit' });
  // The feeds go live last: by now the files they point at exist.
  sh('git', ['add', 'updates']);
  sh('git', ['commit', '-m', `Update feeds for ${version}`]);
  sh('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  console.log(`\nPublished WebMods ${version}. Installs pick it up within a day (the panel offers it; Firefox updates the add-on itself).`);
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

module.exports = { changelogSection, latestFeed, signBytes, firefoxFeed, bump };
