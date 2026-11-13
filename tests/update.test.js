'use strict';
// Updates (helper/lib/update.js): the signed feed, checking, installing into <home>/app; and the release
// script's feed writing (scripts/release.js), which has to produce what the helper accepts.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { tempDir, runCli, privDir } = require('./fake-extension');
const U = require('../helper/lib/update');
const { changelogSection, unreleasedSection, changelogSummary, unwrapMarkdown, summaryProblem, panelNotes, repoMismatch, remoteRepo, latestFeed, signBytes, firefoxFeed, xpiMatches, releaseAssets,
  refreshFeed, feedStaleOn, keychainItem, keychainWriteInput, saveKeychainItem, webExtSignArgs, webExtEnv } = require('../scripts/release');
const { makeFakeKeychain } = require('./fake-keychain');

const keys = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};

// A local "GitHub": serves files from a map, counts requests.
function serve(files) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const body = files[req.url];
    if (body === undefined) { res.writeHead(404); return res.end(); }
    if (typeof body === 'object' && body.redirect) { res.writeHead(302, { Location: body.redirect }); return res.end(); }
    res.writeHead(200);
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, hits, files, close: () => new Promise((r) => server.close(r)) });
  }));
}

// A workspace whose TRIF "runs from" <home>/app (so it can update), at version `version`.
function appWorkspace(version, config = {}) {
  const home = tempDir();
  const appDir = path.join(home, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'trif', version }));
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify(config));
  return { ws: { home, appDir, config }, root: appDir };
}

// A package tarball like `npm pack`'s, whose setup records how it was run (and whether the install lock
// was held for it). copy: whether its setup puts it into <home>/app; exit: its exit code; wait: ms it
// takes.
function fakePackage(version, { copy = true, exit = 0, wait = 0 } = {}) {
  const dir = tempDir();
  const pkg = path.join(dir, 'package');
  fs.mkdirSync(path.join(pkg, 'helper'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'trif', version }));
  fs.writeFileSync(path.join(pkg, 'helper', 'cli.js'), `
    const fs = require('fs'), path = require('path');
    const home = process.argv[process.argv.indexOf('--home') + 1];
    let lock = null;
    try { lock = fs.readFileSync(path.join(home, '.app.lock'), 'utf8').split('\\n')[1]; } catch {}
    fs.writeFileSync(path.join(home, 'setup-ran.json'), JSON.stringify({ argv: process.argv.slice(2), PATH: process.env.PATH,
      lockHeldForUs: !!lock && lock === process.env.TRIF_INSTALL_LOCK }));
    setTimeout(() => {
      if (${copy}) fs.cpSync(path.join(__dirname, '..'), path.join(home, 'app'), { recursive: true });
      console.log(${exit} ? 'Safari bridge FAILED to start it: launchctl said no' : 'setup done');
      process.exitCode = ${exit};
    }, ${wait});`);
  execFileSync('tar', ['-czf', 'trif.tgz', 'package'], { cwd: dir });
  return fs.readFileSync(path.join(dir, 'trif.tgz'));
}

function publish(server, k, { version, tgz, notes = 'Shiny.', tamper } = {}) {
  server.files['/pkg.tgz'] = tgz;
  const sha = crypto.createHash('sha256').update(tgz).digest('hex');
  const feed = latestFeed({ version, published: '2026-11-01', signed: new Date().toISOString(), notes, url: `${server.base}/pkg.tgz`, sha256: tamper === 'sha' ? '0'.repeat(64) : sha, size: tgz.length + (tamper === 'size' ? 1 : 0) });
  server.files['/latest.json'] = feed;
  server.files['/latest.json.sig'] = signBytes(feed, k.priv);
}

test('githubRepo reads package.json "repository" in its usual spellings', () => {
  for (const r of ['https://github.com/tim/trif', 'git+https://github.com/tim/trif.git', 'github:tim/trif', 'git@github.com:tim/trif.git', { type: 'git', url: 'https://github.com/tim/trif.git' }]) {
    assert.equal(U.githubRepo({ repository: r }), 'tim/trif', JSON.stringify(r));
  }
  assert.equal(U.githubRepo({}), null);
  assert.equal(U.githubRepo({ repository: 'https://gitlab.com/tim/trif' }), null);
  assert.equal(U.feedUrl({ config: {} }, { repository: 'github:tim/trif' }), 'https://raw.githubusercontent.com/tim/trif/main/updates/latest.json');
  assert.equal(U.feedUrl({ config: { updateFeed: 'https://example.com/f.json' } }, {}), 'https://example.com/f.json');
});

test('the Firefox add-on link is the latest release\'s trif-firefox.xpi, and the README links the same', () => {
  assert.equal(U.firefoxAddonUrl({ repository: 'github:tim/trif' }), 'https://github.com/tim/trif/releases/latest/download/trif-firefox.xpi');
  assert.equal(U.firefoxAddonUrl({}), null);
  // The README can't work it out from package.json, so it spells it out: it has to be this repo's.
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes(`(${U.firefoxAddonUrl()})`), `README.md links ${U.firefoxAddonUrl()}`);
});

test('release script: the signed add-on goes on the release twice, versioned and as trif-firefox.xpi', () => {
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wm-assets-'));
  try {
    const f = (name, body = name) => { fs.writeFileSync(path.join(out, name), body); return path.join(out, name); };
    const files = { tgz: f('trif-9.9.9.tgz'), chromeZip: f('trif-chrome-9.9.9.zip'), zips: [f('trif-beta-chrome-9.9.9.zip')] };
    const xpi = f('trif-firefox-9.9.9.xpi', 'signed');
    const names = releaseAssets(out, { ...files, xpi }).map((a) => path.basename(a));
    assert.deepEqual(names, ['trif-9.9.9.tgz', 'trif-chrome-9.9.9.zip', 'trif-firefox-9.9.9.xpi', U.FIREFOX_XPI, 'trif-beta-chrome-9.9.9.zip']);
    assert.equal(fs.readFileSync(path.join(out, U.FIREFOX_XPI), 'utf8'), 'signed');
    assert.ok(U.firefoxAddonUrl().endsWith(`/${U.FIREFOX_XPI}`), 'the link setup prints is that file');
    fs.rmSync(path.join(out, U.FIREFOX_XPI));
    assert.deepEqual(releaseAssets(out, { ...files, xpi: null }).map((a) => path.basename(a)), ['trif-9.9.9.tgz', 'trif-chrome-9.9.9.zip', 'trif-beta-chrome-9.9.9.zip']);
    assert.ok(!fs.existsSync(path.join(out, U.FIREFOX_XPI)), 'no add-on, no copy');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('compareVersions and allowedUrl', () => {
  assert.equal(U.compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(U.compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(U.compareVersions('0.2.0', '1.0.0'), -1);
  assert.throws(() => U.compareVersions('1.0', '1.0.0'), U.UpdateError);
  assert.ok(U.allowedUrl('https://github.com/x'));
  assert.ok(U.allowedUrl('http://127.0.0.1:9/x'));
  assert.ok(!U.allowedUrl('http://github.com/x'));
  assert.ok(!U.allowedUrl('file:///etc/passwd'));
});

test('verifyFeed accepts only the release key\'s signature and a complete feed', () => {
  const k = keys();
  const other = keys();
  const feed = latestFeed({ version: '0.2.0', published: '2026-11-01', signed: new Date().toISOString(), notes: 'n', url: 'https://github.com/a/b/x.tgz', sha256: 'a'.repeat(64), size: 10 });
  assert.equal(U.verifyFeed(feed, signBytes(feed, k.priv), k.pub).version, '0.2.0');
  assert.throws(() => U.verifyFeed(feed, signBytes(feed, other.priv), k.pub), /not signed by the TRIF release key/);
  const changed = Buffer.from(feed.toString().replace('0.2.0', '9.9.9'));
  assert.throws(() => U.verifyFeed(changed, signBytes(feed, k.priv), k.pub), /not signed/);
  assert.throws(() => U.verifyFeed(feed, 'garbage', k.pub), /not signed/);
  assert.throws(() => U.verifyFeed(feed, signBytes(feed, k.priv), null), /no release key/);
  const plainHttp = latestFeed({ version: '0.2.0', url: 'http://evil.example/x.tgz', sha256: 'a'.repeat(64), size: 10 });
  assert.throws(() => U.verifyFeed(plainHttp, signBytes(plainHttp, k.priv), k.pub), /no valid package/);
});

test('the feed expires 8 weeks after it was signed; one from before `signed` is dated by its published day', () => {
  const k = keys();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const pkg = { url: 'https://github.com/a/b/x.tgz', sha256: 'a'.repeat(64), size: 10 };
  const signedAt = Date.parse('2026-11-13T10:00:00.000Z');
  const feed = latestFeed({ version: '0.3.0', published: '2026-11-13', signed: new Date(signedAt).toISOString(), notes: 'n', ...pkg });
  const sig = signBytes(feed, k.priv);
  assert.equal(U.FEED_MAX_AGE_MS, 8 * WEEK);
  assert.equal(U.verifyFeed(feed, sig, k.pub, { now: signedAt + 8 * WEEK - 1000 }).signedAt, signedAt);
  assert.throws(() => U.verifyFeed(feed, sig, k.pub, { now: signedAt + 8 * WEEK + 1000 }),
    /^Error: the update feed is from 2026-11-13, more than 8 weeks ago, so it may be an old copy that hides a newer version; not using it$/);
  // The signature still counts first: an old feed with a wrong one says so.
  assert.throws(() => U.verifyFeed(feed, signBytes(feed, keys().priv), k.pub, { now: signedAt + 9 * WEEK }), /not signed/);
  // `signed` is the one that counts (refreshed between releases: published stays the release day).
  const refreshed = latestFeed({ version: '0.3.0', published: '2026-08-01', signed: new Date(signedAt).toISOString(), notes: 'n', ...pkg });
  assert.equal(U.verifyFeed(refreshed, signBytes(refreshed, k.priv), k.pub, { now: signedAt + WEEK }).version, '0.3.0');
  // Feeds from before 0.3.0 (no `signed`; every one has `published`, which is signed too): dated by that.
  const before = Buffer.from(JSON.stringify({ version: '0.2.7', published: '2026-11-12', notes: 'n', package: pkg }, null, 2) + '\n');
  const at = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(U.verifyFeed(before, signBytes(before, k.priv), k.pub, { now: at + 3 * WEEK }).version, '0.2.7');
  assert.throws(() => U.verifyFeed(before, signBytes(before, k.priv), k.pub, { now: at + 8 * WEEK + 1000 }), /from 2026-11-12, more than 8 weeks ago/);
  // The live feed from before the change (0.2.7's, in this repo) is one of those, and isn't refused today.
  assert.ok(U.feedSignedAt(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'updates', 'latest.json'), 'utf8'))) > Date.parse('2026-11-01'));
  // No date at all (no release has made one): refused; a `signed` that isn't a time falls back to published.
  const undated = Buffer.from(JSON.stringify({ version: '0.2.7', notes: 'n', package: pkg }));
  assert.throws(() => U.verifyFeed(undated, signBytes(undated, k.priv), k.pub), /the update feed has no date/);
  assert.equal(U.feedSignedAt({ signed: 'soon', published: '2026-11-12' }), at);
  assert.equal(U.feedSignedAt({ signed: 12, published: 'yesterday' }), null);
});

test('check and install: a feed signed more than 8 weeks ago is an error, and nothing is installed from it', async () => {
  const k = keys();
  const server = await serve({});
  try {
    const { ws, root } = appWorkspace('0.1.0', {});
    ws.config.updateFeed = `${server.base}/latest.json`;
    const tgz = fakePackage('0.2.0');
    publish(server, k, { version: '0.2.0', tgz });
    const signedAt = Date.parse(JSON.parse(server.files['/latest.json']).signed);
    const later = signedAt + U.FEED_MAX_AGE_MS + 60000;
    let s = await U.check(ws, { root, publicKey: k.pub, now: later });
    assert.deepStrictEqual([s.available, s.latest], [false, null]);
    assert.match(s.error, /more than 8 weeks ago, so it may be an old copy that hides a newer version/);
    // (an error isn't cached: the next check asks again, and a fresh feed is taken)
    s = await U.check(ws, { root, publicKey: k.pub, now: signedAt + 1000 });
    assert.deepStrictEqual([s.available, s.latest, s.error], [true, '0.2.0', null]);
    // install judges the feed it fetches now (opts.now: tests)
    await assert.rejects(U.install(ws, { root, publicKey: k.pub, browsers: [], now: later }), /more than 8 weeks ago/);
    assert.equal(U.installedVersion(ws), '0.1.0');
    assert.equal(fs.existsSync(path.join(ws.home, 'setup-ran.json')), false);
  } finally { await server.close(); }
});

test('release script: refresh-feed signs the same feed again with a new time, and only a feed the release key signed', () => {
  const k = keys();
  const signed = '2026-11-13T10:00:00.000Z';
  const feed = latestFeed({ version: '0.3.0', published: '2026-11-13', signed, notes: '- n', url: 'https://github.com/a/b/x.tgz', sha256: 'a'.repeat(64), size: 10 });
  assert.deepStrictEqual(Object.keys(JSON.parse(feed)), ['version', 'published', 'signed', 'notes', 'package']);
  const now = new Date('2026-12-30T08:00:00.000Z');
  const out = refreshFeed(feed, signBytes(feed, k.priv), { pub: k.pub, priv: k.priv, now });
  const f = JSON.parse(out.feed);
  assert.equal(f.signed, now.toISOString());
  assert.deepStrictEqual({ ...f, signed }, JSON.parse(feed), 'nothing else changed');
  assert.equal(U.verifyFeed(out.feed, out.sig, k.pub, { now: now.getTime() + 7 * 24 * 3600e3 }).version, '0.3.0');
  assert.throws(() => refreshFeed(feed, signBytes(feed, keys().priv), { pub: k.pub, priv: k.priv, now }), /isn't signed by the release key/);
  assert.equal(feedStaleOn(signed), '2027-01-08');
  // The release writes `signed` into the feed it signs.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
  assert.match(src, /latestFeed\(\{ version, published, signed, notes:/);
});

test('release script: secrets go to security and web-ext in no argv or environment', async () => {
  const dir = tempDir();
  const kc = makeFakeKeychain(path.join(dir, 'kc'));
  const prev = process.env.TRIF_KEYCHAIN_BIN;
  process.env.TRIF_KEYCHAIN_BIN = kc.bin;
  try {
    // keygen's write: `security -i` with the command on stdin; the key (a PEM, with line breaks) as hex.
    const pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    saveKeychainItem('trif-test-release-key', pem, { account: 'tester' });
    assert.deepStrictEqual(kc.argv(), [['-i'], ['find-generic-password', '-s', 'trif-test-release-key', '-w']]);
    assert.ok(!kc.argvText().includes(Buffer.from(pem).toString('hex')) && !kc.argvText().includes('PRIVATE KEY'));
    assert.equal(keychainItem('trif-test-release-key'), pem);
    assert.match(keychainWriteInput('s', 'a', 'v', { keychain: '/k/x.keychain-db' }), /^add-generic-password -U -s "s" -a "a" -X 76 "\/k\/x\.keychain-db"\n$/);
    assert.throws(() => keychainWriteInput('s"; delete-keychain', 'a', 'v'), /can't pass/);
    // keygen uses it: no `add-generic-password … -w <key>` in an argv any more.
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
    assert.ok(!/\[\s*'add-generic-password'/.test(src) && /saveKeychainItem\(KEY_SERVICE, priv\)/.test(src));

    // Signing: web-ext reads the addons.mozilla.org key and secret from the keychain itself (its config
    // file, scripts/web-ext-amo.cjs). Against a stand-in AMO: its first request carries a JWT made with them.
    const ISSUER = 'user:123:45';
    const SECRET = 'fake-amo-secret-0123456789';
    execFileSync(kc.bin, ['-i'], { input: keychainWriteInput('trif-amo-issuer', 'x', ISSUER) + keychainWriteInput('trif-amo-secret', 'x', SECRET) });
    const seen = [];
    const amo = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization }); req.resume(); res.writeHead(500, { 'content-type': 'application/json' }); res.end('{}'); });
    await new Promise((r) => amo.listen(0, '127.0.0.1', r));
    const ext = path.join(dir, 'ext');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 't', version: '1.0', browser_specific_settings: { gecko: { id: 't@example.com' } } }));
    const args = webExtSignArgs({ sourceDir: ext, artifactsDir: path.join(dir, 'amo'), amoBaseUrl: `http://127.0.0.1:${amo.address().port}/api/v5/` });
    const env = webExtEnv({ ...process.env, WEB_EXT_API_KEY: 'from-a-shell', WEB_EXT_API_SECRET: 'from-a-shell', NO_UPDATE_NOTIFIER: '1' });
    assert.equal(env.WEB_EXT_API_KEY, undefined);
    assert.equal(env.WEB_EXT_API_SECRET, undefined);
    const webExt = path.join(__dirname, '..', 'node_modules', '.bin', 'web-ext');
    const r = await new Promise((resolve) => {
      const p = require('child_process').spawn(webExt, args, { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const t = setTimeout(() => p.kill(), 60000);
      p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
    });
    amo.close();
    assert.ok(seen.length >= 1, r.out.slice(-1500));
    const [h, payload, mac] = seen[0].auth.replace(/^JWT /, '').split('.');
    assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, ISSUER);
    assert.equal(crypto.createHmac('sha256', SECRET).update(`${h}.${payload}`).digest('base64url'), mac);
    for (const v of [ISSUER, SECRET]) {
      assert.ok(!args.join(' ').includes(v) && !JSON.stringify(env).includes(v), 'not in web-ext\'s argv or environment');
      assert.ok(!kc.argvText().includes(v) && !kc.argvText().includes(Buffer.from(v).toString('hex')), 'nor in security\'s');
    }
    assert.ok(kc.argv().some((a) => a.join(' ') === 'find-generic-password -s trif-amo-issuer -w'), 'web-ext asked the keychain by name');
  } finally {
    if (prev === undefined) delete process.env.TRIF_KEYCHAIN_BIN; else process.env.TRIF_KEYCHAIN_BIN = prev;
  }
});

test('check: fetches and caches the feed, reports what\'s new, records errors', async () => {
  const k = keys();
  const server = await serve({});
  try {
    const { ws, root } = appWorkspace('0.1.0', {});
    ws.config.updateFeed = `${server.base}/latest.json`;
    publish(server, k, { version: '0.2.0', tgz: Buffer.from('x') });
    let s = await U.check(ws, { root, publicKey: k.pub, now: 1000 });
    assert.deepStrictEqual([s.current, s.latest, s.available, s.notes, s.canInstall, s.auto, s.error], ['0.1.0', '0.2.0', true, 'Shiny.', true, false, null]);
    const n = server.hits.length;
    s = await U.check(ws, { root, publicKey: k.pub, now: 2000 });
    assert.equal(server.hits.length, n, 'a fresh answer is reused');
    s = await U.check(ws, { root, publicKey: k.pub, now: 2000, force: true });
    assert.ok(server.hits.length > n, 'force checks again');

    // An unsigned (or wrongly signed) feed is an error, and nothing is offered.
    server.files['/latest.json.sig'] = signBytes(server.files['/latest.json'], keys().priv);
    fs.rmSync(path.join(ws.home, 'update.json'));
    s = await U.check(ws, { root, publicKey: k.pub, force: true });
    assert.equal(s.available, false);
    assert.match(s.error, /not signed/);

    // No feed at all (nothing released yet, or a private repo): quietly nothing.
    delete server.files['/latest.json'];
    s = await U.check(ws, { root, publicKey: k.pub, force: true });
    assert.deepStrictEqual([s.available, s.latest, s.error], [false, null, null]);

    // Turned off: no request unless forced.
    ws.config.checkForUpdates = false;
    const before = server.hits.length;
    await U.check(ws, { root, publicKey: k.pub, now: 9e12 });
    assert.equal(server.hits.length, before);
  } finally { await server.close(); }
});

test('install: downloads, checks and runs the new version\'s setup with the recorded PATH', async () => {
  const k = keys();
  const server = await serve({});
  try {
    const { ws, root } = appWorkspace('0.1.0', { env: { PATH: '/recorded/bin:/usr/bin:/bin' } });
    ws.config.updateFeed = `${server.base}/latest.json`;
    const tgz = fakePackage('0.2.0');
    // Served through a redirect, like GitHub's release downloads.
    publish(server, k, { version: '0.2.0', tgz });
    const feed = JSON.parse(server.files['/latest.json']);
    server.files['/dl.tgz'] = { redirect: '/pkg.tgz' };
    feed.package.url = `${server.base}/dl.tgz`;
    const bytes = Buffer.from(JSON.stringify(feed));
    server.files['/latest.json'] = bytes;
    server.files['/latest.json.sig'] = signBytes(bytes, k.priv);

    const r = await U.install(ws, { root, publicKey: k.pub, browsers: ['firefox'] });
    assert.deepStrictEqual([r.from, r.to, r.notes], ['0.1.0', '0.2.0', 'Shiny.']);
    const ran = JSON.parse(fs.readFileSync(path.join(ws.home, 'setup-ran.json'), 'utf8'));
    assert.deepStrictEqual(ran.argv.slice(0, 2), ['setup', '--copy']);
    assert.ok(ran.argv.includes('--no-link'));
    assert.deepStrictEqual(ran.argv.slice(ran.argv.indexOf('--browser'), ran.argv.indexOf('--browser') + 2), ['--browser', 'firefox']);
    assert.equal(ran.PATH, '/recorded/bin:/usr/bin:/bin');
    assert.equal(ran.lockHeldForUs, true, 'setup ran under the install lock, with its token');
    assert.equal(fs.existsSync(path.join(ws.home, '.app.lock')), false, 'lock released');
    assert.equal(r.warning, null);
    assert.equal(U.installedVersion(ws), '0.2.0');
    assert.equal(U.readState(ws.home).lastInstalled.to, '0.2.0');
    assert.deepStrictEqual(fs.readdirSync(ws.home).filter((f) => f.startsWith('.update-')), [], 'temp folder removed');

    // Now up to date.
    await assert.rejects(U.install(ws, { root, publicKey: k.pub, browsers: [] }), /is up to date/);
  } finally { await server.close(); }
});

test('install refuses a download that doesn\'t match the signed feed, and copies it can\'t update', async () => {
  const k = keys();
  const server = await serve({});
  try {
    for (const tamper of ['sha', 'size']) {
      const { ws, root } = appWorkspace('0.1.0');
      ws.config.updateFeed = `${server.base}/latest.json`;
      publish(server, k, { version: '0.2.0', tgz: fakePackage('0.2.0'), tamper });
      await assert.rejects(U.install(ws, { root, publicKey: k.pub, browsers: [] }), tamper === 'sha' ? /checksum doesn't match/ : /bytes, not the/);
      assert.ok(!fs.existsSync(path.join(ws.home, 'setup-ran.json')), 'nothing ran');
      assert.equal(U.installedVersion(ws), '0.1.0');
    }
    // A package whose version isn't the feed's.
    const { ws, root } = appWorkspace('0.1.0');
    ws.config.updateFeed = `${server.base}/latest.json`;
    publish(server, k, { version: '0.3.0', tgz: fakePackage('0.2.0') });
    await assert.rejects(U.install(ws, { root, publicKey: k.pub, browsers: [] }), /isn't version 0.3.0/);

    // Running from somewhere other than <home>/app (a git checkout here): never touched.
    const other = appWorkspace('0.1.0');
    const repo = path.resolve(__dirname, '..');
    assert.match(U.installable(other.ws, repo).why, /git checkout/);
    await assert.rejects(U.install(other.ws, { root: repo, publicKey: k.pub }), /git pull/);
  } finally { await server.close(); }
});

test('install: a setup that fails after swapping the app in counts as installed, with a warning', async () => {
  const k = keys();
  const server = await serve({});
  try {
    const { ws, root } = appWorkspace('0.1.0');
    ws.config.updateFeed = `${server.base}/latest.json`;
    publish(server, k, { version: '0.2.0', tgz: fakePackage('0.2.0', { exit: 1 }) });
    const r = await U.install(ws, { root, publicKey: k.pub, browsers: [] });
    assert.equal(r.to, '0.2.0');
    assert.match(r.warning, /installed, but .*launchctl said no/s);
    const last = U.readState(ws.home).lastInstalled;
    assert.equal(last.to, '0.2.0');
    assert.match(last.warning, /launchctl said no/);

    // One that fails before the swap is a failed update, as before.
    const other = appWorkspace('0.1.0');
    other.ws.config.updateFeed = `${server.base}/latest.json`;
    publish(server, k, { version: '0.2.0', tgz: fakePackage('0.2.0', { exit: 1, copy: false }) });
    await assert.rejects(U.install(other.ws, { root: other.root, publicKey: k.pub, browsers: [] }), /setup failed/);
    assert.equal(U.installedVersion(other.ws), '0.1.0');
    assert.equal(U.readState(other.ws.home).lastInstalled, undefined);
  } finally { await server.close(); }
});

test('install: two at once (two browsers\' helpers) install once; the other is told it\'s in progress', async () => {
  const k = keys();
  const server = await serve({});
  try {
    const { ws, root } = appWorkspace('0.1.0');
    ws.config.updateFeed = `${server.base}/latest.json`;
    publish(server, k, { version: '0.2.0', tgz: fakePackage('0.2.0', { wait: 300 }) });
    const results = await Promise.allSettled([
      U.install(ws, { root, publicKey: k.pub, browsers: [] }),
      U.install(ws, { root, publicKey: k.pub, browsers: [] }),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
    assert.match(results.find((x) => x.status === 'rejected').reason.message, /another TRIF install is in progress|is up to date/);
    assert.equal(U.installedVersion(ws), '0.2.0');
    assert.equal(fs.existsSync(path.join(ws.home, '.app.lock')), false);
  } finally { await server.close(); }
});

test('setConfigKey keeps the rest of config.json; autoUpdate starts off', () => {
  const home = tempDir();
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: '/x' }, modsDir: 'm' }));
  assert.equal(U.autoUpdateOn({ config: {} }), false);
  U.setConfigKey(home, 'autoUpdate', true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')), { env: { PATH: '/x' }, modsDir: 'm', autoUpdate: true });
  U.setConfigKey(home, 'autoUpdate', undefined);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')), { env: { PATH: '/x' }, modsDir: 'm' });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), '{oops');
  assert.throws(() => U.setConfigKey(home, 'autoUpdate', true), /isn't valid JSON/);
});

test('release script: an earlier run\'s signed add-on is reused only if it holds exactly this build', () => {
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wm-xpi-'));
  try {
    const dir = path.join(root, 'firefox');
    fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{"version":"9.9.9"}');
    fs.writeFileSync(path.join(dir, 'icons', 'a.png'), 'png');
    fs.mkdirSync(path.join(root, 'META-INF'));
    fs.writeFileSync(path.join(root, 'META-INF', 'mozilla.rsa'), 'signature');
    const xpi = path.join(root, 'signed.xpi');
    execFileSync('zip', ['-q', '-r', xpi, '.'], { cwd: dir });
    execFileSync('zip', ['-q', '-r', xpi, 'META-INF'], { cwd: root });
    assert.equal(xpiMatches(xpi, dir), true, "Mozilla's signature files don't count");
    fs.writeFileSync(path.join(dir, 'icons', 'a.png'), 'changed');
    assert.equal(xpiMatches(xpi, dir), false);
    fs.writeFileSync(path.join(dir, 'icons', 'a.png'), 'png');
    fs.writeFileSync(path.join(dir, 'new.js'), '1');
    assert.equal(xpiMatches(xpi, dir), false);
    assert.equal(xpiMatches(path.join(root, 'missing.xpi'), dir), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('release script: changelog sections and feeds the helper and Firefox accept', () => {
  const log = '# Changelog\n\nintro\n\n## 0.1.2\n\n- one\n- two\n\n## 0.1.1\n\n- older\n';
  assert.equal(changelogSection(log, '0.1.2'), '- one\n- two');
  assert.equal(changelogSection(log, '0.1.1'), '- older');
  assert.equal(changelogSection(log, '0.1.3'), null);
  assert.equal(changelogSection(log, '0.1.'), null);
  const real = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  assert.ok(changelogSection(real, version), `CHANGELOG.md has a section for the current version ${version}`);
  // An "## Unreleased" section collects what's new between releases; release.js stops while it has any
  // (it goes into the version's section). Every section is short enough for a 0.1.x updater, which cuts
  // the notes at 4000 characters, Unreleased included (it becomes one).
  assert.equal(unreleasedSection('# C\n\n## Unreleased\n\n- new\n\n## 0.1.2\n\n- x\n'), '- new');
  assert.equal(unreleasedSection('# C\n\n## Unreleased\n\n## 0.1.2\n\n- x\n'), null, 'an empty one is fine');
  assert.ok((unreleasedSection(real) || '').length < 3900, 'the Unreleased notes are too long');
  for (const v of [...real.matchAll(/^## (\d+\.\d+\.\d+)/gm)].map((m) => m[1])) assert.ok(changelogSection(real, v).length < 3900, `${v}'s notes are too long`);
  // The panel's "What's new" is a version's short summary (before "### More"), unwrapped, with a link to the
  // rest; a release stops when the summary is too long. Unreleased has to pass, since it becomes the next one.
  assert.equal(changelogSummary('- a\n- b\n\n### More\n\n- c'), '- a\n- b');
  assert.equal(changelogSummary('- a'), '- a');
  assert.equal(unwrapMarkdown('- **One.** a long\n  point\n- two\n\npara\ngoes on'), '- **One.** a long point\n- two\n\npara goes on');
  assert.equal(summaryProblem('- a\n- b', '0.2.6'), null);
  assert.match(summaryProblem('- 1\n- 2\n- 3\n- 4\n- 5\n- 6', '0.2.6'), /6 points/);
  assert.match(summaryProblem(`- ${'x'.repeat(800)}`, '0.2.6'), /800|bytes/);
  assert.match(summaryProblem('', '0.2.6'), /no summary/);
  assert.equal(panelNotes('- a\n  b\n\n### More\n\n- c', { repo: 'o/r', version: '0.2.6' }), '- a b\n\n[All of what\'s new in 0.2.6](https://github.com/o/r/releases/tag/v0.2.6)');
  assert.equal(summaryProblem(changelogSummary(unreleasedSection(real) || '- (nothing yet)'), 'Unreleased'), null, 'the Unreleased summary is too long for the panel');
  // package.json's repository against the git remote.
  assert.equal(remoteRepo('https://github.com/acapellascience/WebMods.git'), 'acapellascience/WebMods');
  assert.equal(remoteRepo('git@github.com:acapellascience/trif.git'), 'acapellascience/trif');
  assert.match(repoMismatch('acapellascience/trif', 'https://github.com/acapellascience/WebMods.git'), /Rename the GitHub repo first \(acapellascience\/WebMods → acapellascience\/trif/);
  assert.equal(repoMismatch('acapellascience/trif', 'git@github.com:acapellascience/Trif.git'), null);

  const k = keys();
  const feed = latestFeed({ version: '0.1.2', published: '2026-11-01', signed: new Date().toISOString(), notes: '- one', url: 'https://github.com/a/b/releases/download/v0.1.2/trif-0.1.2.tgz', sha256: 'b'.repeat(64), size: 5 });
  assert.equal(U.verifyFeed(feed, signBytes(feed, k.priv), k.pub).notes, '- one');

  let ff = firefoxFeed(null, { id: 'webmods@webmods.ext', version: '0.1.1', url: 'https://x/1.xpi', sha256: 'c'.repeat(64) });
  ff = firefoxFeed(ff, { id: 'webmods@webmods.ext', version: '0.1.2', url: 'https://x/2.xpi', sha256: 'd'.repeat(64) });
  ff = firefoxFeed(ff, { id: 'webmods@webmods.ext', version: '0.1.2', url: 'https://x/2b.xpi', sha256: 'e'.repeat(64) });
  assert.deepStrictEqual(ff.addons['webmods@webmods.ext'].updates.map((u) => [u.version, u.update_link, u.update_hash.slice(0, 8)]),
    [['0.1.1', 'https://x/1.xpi', 'sha256:c'], ['0.1.2', 'https://x/2b.xpi', 'sha256:e']]);
});

test('trif update reports a failed check; --auto writes config.json', async () => {
  const home = tempDir();
  // Nothing listens there: the check fails without going to GitHub.
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ updateFeed: 'http://127.0.0.1:9/latest.json' }));
  let r = await runCli(['update'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /couldn't check for updates/);
  assert.match(r.stdout, /Automatic updates: off/);
  r = await runCli(['update', '--auto', 'on'], { home });
  assert.match(r.stdout, /automatic updates on/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).autoUpdate, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).updateFeed, 'http://127.0.0.1:9/latest.json', 'the rest of config.json is kept');
  r = await runCli(['update', '--auto', 'maybe'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--auto takes on or off/);
  r = await runCli(['update', '--install'], { home, env: { TRIF_RUN_TOKEN: 'x' } });
  assert.match(r.stderr, /can't be installed inside an agent run/);
});
