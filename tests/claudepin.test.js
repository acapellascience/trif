'use strict';
// TRIF's own pinned Claude Code for runs in TRIF's full sandbox (helper/lib/claudepin.js): downloaded from
// a stand-in registry on this computer (fake tarballs; never the real binary here, CI's whole-box job
// installs the real pin), checked against the pinned sha512 before unpacking, only the binary kept, a
// folder complete or absent. And the pin file itself, and the release step that moves it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const cp = require('../helper/lib/claudepin');

const KEY = `${process.platform}-${process.arch}`;
const BIN = cp.binName();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-claudepin-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let n = 0;
const fresh = (name) => { const d = path.join(tmpRoot, `${name}-${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const sri = (buf) => `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`;

/** A .tgz of `files` ({rel: content | {link}}) under package/, as npm's platform packages are. */
function tarball(files) {
  const d = fresh('src');
  for (const [rel, c] of Object.entries(files)) {
    const p = path.join(d, 'package', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (typeof c === 'object' && c.link) fs.symlinkSync(c.link, p);
    else fs.writeFileSync(p, c, { mode: 0o755 });
  }
  const out = path.join(d, 'pkg.tgz');
  const r = spawnSync('tar', ['-czf', out, '-C', d, 'package']);
  assert.strictEqual(r.status, 0, String(r.stderr));
  return fs.readFileSync(out);
}

const PROGRAM = '#!/bin/sh\necho "2.1.999 (Claude Code)"\n';
const GOOD = tarball({ claude: PROGRAM, 'claude.exe': PROGRAM, 'LICENSE.md': 'licence', 'README.md': 'not kept' });

// The stand-in registry: path -> { body, status, truncate }
function registry(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const r = routes[req.url];
    if (!r) { res.writeHead(404); return res.end(); }
    if (r.redirect) { res.writeHead(302, { location: r.redirect }); return res.end(); }
    if (r.truncate) { res.writeHead(200, { 'content-length': r.body.length }); res.write(r.body.subarray(0, r.body.length >> 1)); return res.destroy(); }
    res.writeHead(r.status || 200, r.length ? { 'content-length': r.body.length } : {}); res.end(r.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)),
  })));
}

const pinsFor = (base, rel, integrity, extra = {}) => ({ version: '2.1.999', packages: { [KEY]: { name: 'x', tarball: base + rel, integrity } }, ...extra });
const leftovers = (home) => { try { return fs.readdirSync(cp.root(home)).filter((x) => x !== 'claude-code-2.1.999-' + KEY); } catch { return []; } };

test('the pin file: one version, every platform, npm sha512s, registry tarballs of that version', () => {
  const pins = cp.readPins();
  assert.match(pins.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(pins.macTeam, 'Q6L2SF6YDW');
  for (const key of cp.PLATFORMS) {
    const p = pins.packages[key];
    assert.ok(p, key);
    assert.strictEqual(p.name, `@anthropic-ai/claude-code-${key}`);
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.strictEqual(p.tarball, `https://registry.npmjs.org/@anthropic-ai/claude-code-${key}/-/claude-code-${key}-${pins.version}.tgz`);
  }
});

test('progress while it downloads: every caller hears it, the one download shared; the size the server gives', async () => {
  // (random bytes don't compress: a tarball of a few MB, so progress is told along the way, not only at the end)
  const BIG = tarball({ claude: PROGRAM + '#' + crypto.randomBytes(3 * 1024 * 1024).toString('base64'), 'LICENSE.md': 'licence' });
  const reg = await registry({ '/big.tgz': { body: BIG, length: true }, '/nolen.tgz': { body: BIG } });
  try {
    const home = fresh('home');
    const pins = pinsFor(reg.url, '/big.tgz', sri(BIG));
    const a = [];
    const b = [];
    const [x, y] = await Promise.all([cp.ensurePinned(home, { pins, onProgress: (got, total) => a.push([got, total]) }),
      cp.ensurePinned(home, { pins, onProgress: (got, total) => b.push([got, total]) })]);
    assert.strictEqual(x, y);
    assert.strictEqual(reg.hits.filter((h) => h === '/big.tgz').length, 1, 'one download');
    for (const calls of [a, b]) {
      assert.ok(calls.length >= 4, `told along the way: ${calls.length}`);
      assert.deepStrictEqual(calls.at(-1), [BIG.length, BIG.length], 'the last: all of it');
      assert.ok(calls.every(([got], i) => i === 0 || got >= calls[i - 1][0]), 'never backwards');
    }
    assert.strictEqual(cp.pinning(home, { pins }), false, 'not downloading any more');
    // (no size from the server: total 0)
    const home2 = fresh('home');
    const c = [];
    const p = cp.ensurePinned(home2, { pins: pinsFor(reg.url, '/nolen.tgz', sri(BIG)), onProgress: (got, total) => c.push([got, total]) });
    assert.strictEqual(cp.pinning(home2, { pins: pinsFor(reg.url, '/nolen.tgz', sri(BIG)) }), true, 'downloading');
    await p;
    assert.deepStrictEqual(c.at(-1), [BIG.length, 0]);
  } finally { await reg.close(); }
});

test('installs the pinned binary: checksum first, only the binary and licence kept, a record, once', async () => {
  const reg = await registry({ '/good.tgz': { body: GOOD } });
  try {
    const home = fresh('home');
    const pins = pinsFor(reg.url, '/good.tgz', sri(GOOD));
    assert.strictEqual(cp.installedPinned(home, { pins }), null);
    // two at once: one download
    const [a, b] = await Promise.all([cp.ensurePinned(home, { pins }), cp.ensurePinned(home, { pins })]);
    assert.strictEqual(reg.hits.length, 1);
    assert.strictEqual(a.bin, b.bin);
    assert.ok(a.fetched);
    assert.strictEqual(a.bin, path.join(home, 'runtime', `claude-code-2.1.999-${KEY}`, BIN));
    assert.deepStrictEqual(fs.readdirSync(a.dir).sort(), ['.trif-claude-code.json', BIN, 'LICENSE.md'].sort());
    assert.strictEqual(fs.readFileSync(a.bin, 'utf8'), PROGRAM);
    if (process.platform !== 'win32') assert.ok(fs.statSync(a.bin).mode & 0o100, 'executable');
    const mark = JSON.parse(fs.readFileSync(path.join(a.dir, cp.MARK), 'utf8'));
    assert.strictEqual(mark.integrity, sri(GOOD));
    assert.deepStrictEqual(leftovers(home), []);
    // installed: no second download
    const again = await cp.ensurePinned(home, { pins });
    assert.strictEqual(again.fetched, false);
    assert.strictEqual(reg.hits.length, 1);
    assert.deepStrictEqual(cp.installedPinned(home, { pins }).bin, a.bin);
    assert.strictEqual((await cp.checkPinned(home, { pins })).problem, null);
    assert.strictEqual((await cp.checkPinned(home, { pins })).problem, null); // (remembered)
    // changed after it was unpacked, even with its old times put back: said so (runs.js won't start it)
    const before = fs.statSync(a.bin);
    fs.writeFileSync(a.bin, PROGRAM.replace('999', '998'));
    fs.utimesSync(a.bin, before.atime, before.mtime);
    assert.match((await cp.checkPinned(home, { pins })).problem, /changed since it was downloaded/);
    fs.writeFileSync(a.bin, PROGRAM);
    assert.strictEqual((await cp.checkPinned(home, { pins })).problem, null);
    fs.unlinkSync(path.join(a.dir, cp.MARK));
    assert.strictEqual(await cp.checkPinned(home, { pins }), null); // (no record: not installed)
  } finally { await reg.close(); }
});

test('refused, nothing left behind: wrong checksum, no binary, a link for the binary, a cut-off download, http elsewhere', async () => {
  const noBin = tarball({ 'README.md': 'x' });
  const link = tarball({ [BIN]: { link: '/etc/passwd' } });
  const reg = await registry({
    '/good.tgz': { body: GOOD }, '/nobin.tgz': { body: noBin }, '/link.tgz': { body: link },
    '/cut.tgz': { body: GOOD, truncate: true }, '/gone.tgz': { status: 404, body: '' },
    '/hop.tgz': { redirect: 'http://example.com/x.tgz' },
  });
  try {
    const cases = [
      ['/good.tgz', sri(Buffer.from('something else')), /doesn't match its pinned checksum/],
      ['/nobin.tgz', sri(noBin), /couldn't unpack|no program/],
      ['/link.tgz', sri(link), /no program in it/],
      ['/cut.tgz', sri(GOOD), /stopped part way|doesn't match|couldn't download|aborted|socket hang up/],
      ['/gone.tgz', sri(GOOD), /HTTP 404/],
      ['/hop.tgz', sri(GOOD), /https only/],
    ];
    for (const [rel, integrity, re] of cases) {
      const home = fresh('home');
      await assert.rejects(cp.ensurePinned(home, { pins: pinsFor(reg.url, rel, integrity) }), (e) => { assert.ok(e instanceof cp.PinError, `${rel}: ${e.stack}`); assert.match(e.message, re, rel); return true; });
      assert.deepStrictEqual(fs.readdirSync(cp.root(home)), [], `${rel}: nothing left in runtime/`);
      assert.strictEqual(cp.installedPinned(home, { pins: pinsFor(reg.url, rel, integrity) }), null);
    }
    // no pin for this platform; a pin without a sha512
    await assert.rejects(cp.ensurePinned(fresh('home'), { pins: { version: '2.1.999', packages: {} } }), /no pinned Claude Code for/);
    await assert.rejects(cp.ensurePinned(fresh('home'), { pins: pinsFor(reg.url, '/good.tgz', 'sha1-abc') }), /no tarball or sha512/);
  } finally { await reg.close(); }
});

test('download: https only, a size cap', async () => {
  const reg = await registry({ '/good.tgz': { body: GOOD } });
  try {
    const d = fresh('dl');
    await assert.rejects(cp.download('http://example.com/a.tgz', path.join(d, 'a')), /https only/);
    await assert.rejects(cp.download('file:///etc/passwd', path.join(d, 'b')), /https only/);
    await assert.rejects(cp.download(reg.url + '/good.tgz', path.join(d, 'c'), { maxBytes: 100 }), /larger than 100 bytes/);
    assert.strictEqual(await cp.download(reg.url + '/good.tgz', path.join(d, 'e')), sri(GOOD));
  } finally { await reg.close(); }
});

test('macOS: a binary not signed by the pinned team is refused', { skip: process.platform !== 'darwin' }, async () => {
  const reg = await registry({ '/good.tgz': { body: GOOD } });
  try {
    const home = fresh('home');
    await assert.rejects(cp.ensurePinned(home, { pins: pinsFor(reg.url, '/good.tgz', sri(GOOD), { macTeam: 'Q6L2SF6YDW' }) }), /code signature isn't valid|isn't signed by Anthropic/);
    assert.deepStrictEqual(fs.readdirSync(cp.root(home)), []);
  } finally { await reg.close(); }
});

test('prune: older pins and leftover downloads go, this pin and everything else stay', () => {
  const home = fresh('home');
  const pins = { version: '2.1.999', packages: { [KEY]: {} } };
  const r = cp.root(home);
  for (const d of [`claude-code-2.1.999-${KEY}`, `claude-code-2.1.300-${KEY}`, '.claude-fetch-abc', 'node-v24.22.3-darwin-arm64', 'other']) fs.mkdirSync(path.join(r, d), { recursive: true });
  assert.deepStrictEqual(cp.prunePinned(home, { pins }).sort(), ['.claude-fetch-abc', `claude-code-2.1.300-${KEY}`].sort());
  assert.deepStrictEqual(fs.readdirSync(r).sort(), [`claude-code-2.1.999-${KEY}`, 'node-v24.22.3-darwin-arm64', 'other'].sort());
});

test('the release step: pins from the registry, every platform at the same version', async () => {
  const meta = {};
  const deps = {};
  for (const key of cp.PLATFORMS) {
    const name = `@anthropic-ai/claude-code-${key}`;
    deps[name] = '2.1.400';
    meta[`R/${name.replace('/', '%2f')}/2.1.400`] = { version: '2.1.400', dist: { tarball: `https://registry.npmjs.org/${name}/-/x-2.1.400.tgz`, integrity: 'sha512-' + 'A'.repeat(86) + '==' } };
  }
  meta['R/@anthropic-ai%2fclaude-code/2.1.400'] = { version: '2.1.400', optionalDependencies: deps };
  const get = async (u) => { if (!meta[u]) throw new Error(`404 ${u}`); return JSON.parse(JSON.stringify(meta[u])); };
  const pins = await cp.makePins('2.1.400', { registry: 'R/', get });
  assert.strictEqual(pins.version, '2.1.400');
  assert.deepStrictEqual(Object.keys(pins.packages).sort(), [...cp.PLATFORMS].sort());
  // a platform package at another version, or missing: refused
  deps['@anthropic-ai/claude-code-win32-x64'] = '2.1.399';
  await assert.rejects(cp.makePins('2.1.400', { registry: 'R/', get }), /doesn't list @anthropic-ai\/claude-code-win32-x64@2\.1\.400/);
  deps['@anthropic-ai/claude-code-win32-x64'] = '2.1.400';
  meta['R/@anthropic-ai%2fclaude-code-linux-x64/2.1.400'].dist.integrity = 'sha1-x';
  await assert.rejects(cp.makePins('2.1.400', { registry: 'R/', get }), /no tarball or sha512/);
  await assert.rejects(cp.makePins('latest', { get }), /isn't a Claude Code version/);
});

test('TRIF_CLAUDE_CODE_PIN: another pin file (tests), or a clear error', () => {
  const f = path.join(fresh('pin'), 'pins.json');
  fs.writeFileSync(f, JSON.stringify({ version: '1.2.3', packages: {} }));
  assert.strictEqual(cp.pinsInUse({ TRIF_CLAUDE_CODE_PIN: f }).version, '1.2.3');
  assert.throws(() => cp.pinsInUse({ TRIF_CLAUDE_CODE_PIN: f + '.missing' }), /TRIF_CLAUDE_CODE_PIN names .* which isn't a pin file/);
  assert.strictEqual(cp.pinsInUse({}).version, cp.readPins().version);
});
