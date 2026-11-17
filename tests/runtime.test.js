'use strict';
// TRIF's own Node (helper/lib/runtime.js, docs/NO-NODE.md): picking the archive, downloading it against
// its pinned checksum, unpacking only node into <home>/runtime, pruning old ones. With a fake archive
// whose "node" is a shell script; the real pins are checked for shape only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { tempDir } = require('./fake-extension');
const R = require('../helper/lib/runtime');

const VERSION = '24.22.3';
const KEY = 'darwin-arm64';

// A .tar.gz shaped like nodejs.org's: node-v<ver>-<key>/{bin/node, LICENSE, include/…}.
function fakeArchive({ prints = `v${VERSION}` } = {}) {
  const dir = tempDir('runtime-src-');
  const top = path.join(dir, `node-v${VERSION}-${KEY}`);
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(top, 'include', 'node'), { recursive: true });
  fs.writeFileSync(path.join(top, 'bin', 'node'), `#!/bin/sh\necho ${prints}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(top, 'LICENSE'), 'MIT\n');
  fs.writeFileSync(path.join(top, 'include', 'node', 'node.h'), '//\n');
  const file = path.join(dir, `node-v${VERSION}-${KEY}.tar.gz`);
  execFileSync('tar', ['-czf', file, '-C', dir, path.basename(top)]);
  const data = fs.readFileSync(file);
  return { data, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

const pinsFor = (sha256, extra = {}) => ({
  version: VERSION, base: 'https://nodejs.org/dist/v24.22.3/',
  archives: { [KEY]: [{ file: `node-v${VERSION}-${KEY}.tar.xz`, sha256: '0'.repeat(64) }, { file: `node-v${VERSION}-${KEY}.tar.gz`, sha256 }], ...extra },
});

// darwin unpacks .tar.xz; these tests feed a .tar.gz, so they say xz is missing and pretend to be Linux-like.
const opts = (pins, fetch) => ({ pins, fetch, platform: 'linux', arch: 'arm64', xz: false });
const linuxPins = (sha) => { const p = pinsFor(sha); p.archives = { 'linux-arm64': p.archives[KEY] }; return p; };

test('the real pins: one version, https from nodejs.org, every platform TRIF supports, sha256 each', () => {
  const p = R.PINS;
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(p.base, `https://nodejs.org/dist/v${p.version}/`);
  for (const k of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win-x64']) {
    assert.ok(p.archives[k] && p.archives[k].length, k);
    for (const a of p.archives[k]) {
      assert.ok(a.file.startsWith(`node-v${p.version}-${k}.`), a.file);
      assert.match(a.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test('platformKey and pickArchive: nodejs.org names; .tar.xz unless tar can\'t unpack it', () => {
  assert.strictEqual(R.platformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.strictEqual(R.platformKey('win32', 'x64'), 'win-x64');
  assert.strictEqual(R.platformKey('freebsd', 'x64'), null);
  assert.match(R.pickArchive('darwin-x64', { platform: 'darwin' }).file, /\.tar\.xz$/);
  assert.match(R.pickArchive('linux-x64', { platform: 'linux', xz: true }).file, /\.tar\.xz$/);
  assert.match(R.pickArchive('linux-x64', { platform: 'linux', xz: false }).file, /\.tar\.gz$/);
  assert.match(R.pickArchive('win-x64', { platform: 'win32' }).file, /\.zip$/);
  assert.strictEqual(R.nodeIn('/r', 'win32'), path.join('/r', 'node.exe'));
});

test('ensureRuntime downloads once, keeps only node and its licence, and records what it came from', async () => {
  const home = tempDir('runtime-home-');
  const { data, sha256 } = fakeArchive();
  const pins = linuxPins(sha256);
  // (the archive inside is named for darwin-arm64; rename the pin's file to match what's in the tarball)
  pins.archives['linux-arm64'] = [{ file: `node-v${VERSION}-${KEY}.tar.gz`, sha256 }];
  const urls = [];
  const fetch = async (url) => { urls.push(url); return data; };
  const r = await R.ensureRuntime(home, opts(pins, fetch));
  assert.strictEqual(r.fetched, true);
  assert.deepStrictEqual(urls, [`https://nodejs.org/dist/v24.22.3/node-v${VERSION}-${KEY}.tar.gz`]);
  const dir = path.join(home, 'runtime', `node-v${VERSION}-linux-arm64`);
  assert.strictEqual(r.node, path.join(dir, 'bin', 'node'));
  assert.strictEqual(execFileSync(r.node, ['--version'], { encoding: 'utf8' }).trim(), `v${VERSION}`);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['.trif-runtime.json', 'LICENSE', 'bin']);
  assert.deepStrictEqual(fs.readdirSync(path.join(home, 'runtime')), [`node-v${VERSION}-linux-arm64`]);
  const info = R.runtimeInfo(home, { platform: 'linux', arch: 'arm64', pins });
  assert.strictEqual(info.archiveSha256, sha256);
  assert.match(info.nodeSha256, /^[0-9a-f]{64}$/);

  const again = await R.ensureRuntime(home, opts(pins, async () => { throw new Error('no second download'); }));
  assert.deepStrictEqual(again, { node: r.node, version: VERSION, fetched: false });
});

test('ensureRuntime refuses a download that isn\'t the pinned one, a node that doesn\'t run, a failed fetch: nothing left behind', async () => {
  const { data, sha256 } = fakeArchive();
  const pins = linuxPins(sha256);
  pins.archives['linux-arm64'] = [{ file: `node-v${VERSION}-${KEY}.tar.gz`, sha256 }];

  const home1 = tempDir('runtime-home-');
  await assert.rejects(R.ensureRuntime(home1, opts(pins, async () => Buffer.concat([data, Buffer.from('x')]))), /pinned checksum/);
  assert.deepStrictEqual(fs.readdirSync(path.join(home1, 'runtime')), []);

  const home2 = tempDir('runtime-home-');
  await assert.rejects(R.ensureRuntime(home2, opts(pins, async () => { throw new Error('offline'); })), (e) => e instanceof R.RuntimeError && /offline/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(path.join(home2, 'runtime')), []);

  const bad = fakeArchive({ prints: 'v1.0.0' });
  const badPins = linuxPins(bad.sha256);
  badPins.archives['linux-arm64'] = [{ file: `node-v${VERSION}-${KEY}.tar.gz`, sha256: bad.sha256 }];
  const home3 = tempDir('runtime-home-');
  await assert.rejects(R.ensureRuntime(home3, opts(badPins, async () => bad.data)), /doesn't run here/);
  assert.deepStrictEqual(fs.readdirSync(path.join(home3, 'runtime')), []);

  await assert.rejects(R.ensureRuntime(home3, { pins, platform: 'freebsd', arch: 'x64' }), /no TRIF runtime for freebsd-x64/);
});

test('installedNode ignores a folder without its marker (half-made); pruneRuntimes keeps only the pinned one', () => {
  const home = tempDir('runtime-home-');
  const root = path.join(home, 'runtime');
  const pins = pinsFor('a'.repeat(64));
  const cur = path.join(root, `node-v${VERSION}-${KEY}`);
  fs.mkdirSync(path.join(cur, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(cur, 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  const o = { platform: 'darwin', arch: 'arm64', pins };
  assert.strictEqual(R.installedNode(home, o), null);
  fs.writeFileSync(path.join(cur, '.trif-runtime.json'), '{}');
  assert.strictEqual(R.installedNode(home, o), path.join(cur, 'bin', 'node'));

  fs.mkdirSync(path.join(root, `node-v22.1.0-${KEY}`));
  fs.mkdirSync(path.join(root, '.fetch-abc'));
  fs.mkdirSync(path.join(root, 'notes'));
  assert.deepStrictEqual(R.pruneRuntimes(home, o).sort(), ['.fetch-abc', `node-v22.1.0-${KEY}`]);
  assert.deepStrictEqual(fs.readdirSync(root).sort(), [`node-v${VERSION}-${KEY}`, 'notes']);
});

test('ensureRuntime with archiveFile (install.sh\'s download): used when it\'s a pinned file, still checked; otherwise downloaded', async () => {
  const { data, sha256 } = fakeArchive();
  const pins = linuxPins(sha256);
  pins.archives['linux-arm64'] = [{ file: `node-v${VERSION}-${KEY}.tar.gz`, sha256 }];
  const dir = tempDir('runtime-local-');
  const local = path.join(dir, `node-v${VERSION}-${KEY}.tar.gz`);
  fs.writeFileSync(local, data);
  const never = async () => { throw new Error('should not download'); };
  const r = await R.ensureRuntime(tempDir('runtime-home-'), { ...opts(pins, never), archiveFile: local });
  assert.strictEqual(r.fetched, true);
  assert.strictEqual(execFileSync(r.node, ['--version'], { encoding: 'utf8' }).trim(), `v${VERSION}`);

  const other = path.join(dir, 'node-v1.0.0-other.tar.gz');
  fs.writeFileSync(other, 'x');
  const urls = [];
  await R.ensureRuntime(tempDir('runtime-home-'), { ...opts(pins, async (u) => { urls.push(u); return data; }), archiveFile: other });
  assert.strictEqual(urls.length, 1);

  fs.writeFileSync(local, Buffer.concat([data, Buffer.from('x')]));
  await assert.rejects(R.ensureRuntime(tempDir('runtime-home-'), { ...opts(pins, never), archiveFile: local }), /pinned checksum/);
});
