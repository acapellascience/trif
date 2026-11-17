'use strict';
// `trif setup` and TRIF's own Node (lib/setup.js chooseNode, lib/runtime.js, docs/NO-NODE.md): which node
// the wrappers name, downloading the runtime (from a local server, with fake pins: never nodejs.org),
// falling back to the node running setup, and pruning an older pin's runtime once nothing names it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile, spawn } = require('child_process');
const { runCli, tempDir } = require('./fake-extension');
const R = require('../helper/lib/runtime');
const { chooseNode } = require('../helper/lib/setup');
const { SAFARI_AGENT_LABEL } = require('../helper/lib/browsers');
const P = require('../helper/lib/paths');

const KEY = R.platformKey();

// A .tar.gz shaped like nodejs.org's whose bin/node answers --version as Node <version> and runs anything
// else with the node running these tests.
function fakeArchive(dir, version) {
  const name = `node-v${version}-${KEY}`;
  const top = path.join(dir, 'src', name);
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(top, 'bin', 'node'), `#!/bin/sh\nif [ "$1" = --version ]; then echo v${version}; exit 0; fi\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(top, 'LICENSE'), 'MIT\n');
  const file = `${name}.tar.gz`;
  execFileSync('tar', ['-czf', path.join(dir, file), '-C', path.join(dir, 'src'), name]);
  return { file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex') };
}

// A static file server in its own process (setup's download runs while the test process waits on it).
function serve(dir) {
  const src = `const http=require('http'),fs=require('fs'),path=require('path');
    const s=http.createServer((q,r)=>{const f=path.join(${JSON.stringify(dir)},path.basename(q.url));
      fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200);r.end(d);}});});
    s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => child.stdout.once('data', (d) => resolve({ base: `http://127.0.0.1:${String(d).trim()}/`, stop: () => child.kill() })));
}

function pinsFile(dir, version, base, archive) {
  const file = path.join(dir, `pins-${version}.json`);
  fs.writeFileSync(file, JSON.stringify({ version, base, archives: { [KEY]: [archive] } }));
  return file;
}

const wrapperNode = (home) => {
  const m = fs.readFileSync(path.join(home, 'bin', 'trif'), 'utf8').match(/exec "([^"]+)"/);
  return m && m[1];
};

function runWrapper(home, args) {
  return new Promise((resolve) => execFile(path.join(home, 'bin', 'trif'), args, { env: { PATH: '/usr/bin:/bin', HOME: home, TRIF_HOME: home }, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` })));
}

test('chooseNode: the runtime for copies, the running node for git checkouts, --no-runtime, TRIF_RUNTIME=off and tests', () => {
  const home = tempDir('rt-choose-');
  const fetched = { node: '/x/runtime/node-v1.2.3-k/bin/node', version: '1.2.3', fetched: true };
  const never = () => { throw new Error('should not download'); };
  assert.deepStrictEqual([chooseNode(home, { mode: 'copy', want: false, env: {}, ensure: never }).how, chooseNode(home, { mode: 'copy', want: false, env: {}, ensure: never }).why], ['system', '--no-runtime']);
  assert.strictEqual(chooseNode(home, { mode: 'link', env: {}, ensure: never }).how, 'system');
  assert.strictEqual(chooseNode(home, { mode: 'copy', env: { TRIF_RUNTIME: 'off' }, ensure: never }).how, 'system');
  assert.strictEqual(chooseNode(home, { mode: 'copy', env: { NODE_TEST_CONTEXT: 'child' }, ensure: never }).why, 'under tests');
  // (No TRIF_RUNTIME and not under tests: the real pins, with the download stubbed.)
  const r = chooseNode(home, { mode: 'copy', env: {}, ensure: () => fetched });
  assert.deepStrictEqual([r.node, r.how, r.version, r.fetched, r.pins], [fetched.node, 'runtime', '1.2.3', true, R.PINS]);
  assert.strictEqual(chooseNode(home, { mode: 'link', want: true, env: {}, ensure: () => fetched }).how, 'runtime');
  const failed = chooseNode(home, { mode: 'copy', env: {}, ensure: () => { throw new R.RuntimeError('offline'); } });
  assert.deepStrictEqual([failed.how, failed.error], ['system', 'offline']);
  assert.strictEqual(failed.node, require('../helper/lib/setup').pickNodePath());
  const bad = chooseNode(home, { mode: 'copy', env: { TRIF_RUNTIME: path.join(home, 'nope.json') }, ensure: never });
  assert.strictEqual(bad.how, 'system');
  assert.match(bad.error, /isn't a pins file/);
});

test('runtimesNamedIn and pruneRuntimes keep: a runtime a plist still names stays', () => {
  const home = tempDir('rt-keep-');
  const root = R.runtimeRoot(home);
  for (const n of ['node-v1.0.0-darwin-arm64', 'node-v2.0.0-darwin-arm64', 'node-v3.0.0-darwin-arm64', '.fetch-abc', 'other']) fs.mkdirSync(path.join(root, n), { recursive: true });
  const plist = path.join(home, 'agent.plist');
  fs.writeFileSync(plist, `<string>${root}/node-v2.0.0-darwin-arm64/bin/node</string>`);
  assert.deepStrictEqual(R.runtimesNamedIn(plist), ['node-v2.0.0-darwin-arm64']);
  assert.deepStrictEqual(R.runtimesNamedIn(path.join(home, 'missing')), []);
  const pins = { version: '3.0.0', archives: { 'darwin-arm64': [{}] } };
  const removed = R.pruneRuntimes(home, { platform: 'darwin', arch: 'arm64', pins, keep: R.runtimesNamedIn(plist) });
  assert.deepStrictEqual(removed.sort(), ['.fetch-abc', 'node-v1.0.0-darwin-arm64']);
  assert.deepStrictEqual(fs.readdirSync(root).sort(), ['node-v2.0.0-darwin-arm64', 'node-v3.0.0-darwin-arm64', 'other']);
});

test('trif setup --copy: downloads the pinned runtime, the wrappers run on it, a new pin replaces it, a bad download falls back', { skip: !KEY || process.platform === 'win32' }, async () => {
  const dir = tempDir('rt-setup-');
  const home = path.join(dir, 'ws');
  const native = path.join(dir, 'native');
  const files = path.join(dir, 'files');
  fs.mkdirSync(files);
  const srv = await serve(files);
  try {
    const setup = (pins, extra = []) => runCli(['setup', '--copy', '--no-link', '--no-examples', '--native-dir', native, ...extra], { home, env: { TRIF_RUNTIME: pins }, timeout: 90000 });
    const a1 = fakeArchive(files, '24.0.1');

    // 1. First setup: downloads it; the wrappers name it and run on it.
    let r = await setup(pinsFile(dir, '24.0.1', srv.base, a1));
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /✓ Downloaded Node 24\.0\.1 for TRIF/);
    const node1 = path.join(home, 'runtime', `node-v24.0.1-${KEY}`, 'bin', 'node');
    assert.strictEqual(wrapperNode(home), node1);
    assert.ok(fs.readFileSync(path.join(home, 'bin', 'trif-host'), 'utf8').includes(node1));
    const v = await runWrapper(home, ['help']);
    assert.strictEqual(v.code, 0, v.out);
    assert.ok(v.out.startsWith(`trif ${P.VERSION}:`), v.out);
    assert.deepStrictEqual(fs.readdirSync(path.join(home, 'runtime')), [`node-v24.0.1-${KEY}`]);

    // 2. Again, with the server gone: nothing to download.
    srv.stop();
    r = await setup(pinsFile(dir, '24.0.1', srv.base, a1), ['--verbose']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`runtime +Node 24\\.0\\.1 for TRIF: ${node1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.doesNotMatch(r.stdout, /downloaded now/);

    // 3. A new pin while a Safari agent this setup doesn't rewrite still names the old one: both kept.
    const srv2 = await serve(files);
    try {
      const a2 = fakeArchive(files, '24.0.2');
      const plist = path.join(home, 'fakehome', 'Library', 'LaunchAgents', `${SAFARI_AGENT_LABEL}.plist`);
      fs.mkdirSync(path.dirname(plist), { recursive: true });
      fs.writeFileSync(plist, `<string>${node1}</string>`);
      const pins2 = pinsFile(dir, '24.0.2', srv2.base, a2);
      r = await setup(pins2);
      assert.strictEqual(r.code, 0, r.stdout + r.stderr);
      const node2 = path.join(home, 'runtime', `node-v24.0.2-${KEY}`, 'bin', 'node');
      assert.strictEqual(wrapperNode(home), node2);
      assert.strictEqual((await runWrapper(home, ['help'])).code, 0);
      assert.deepStrictEqual(fs.readdirSync(path.join(home, 'runtime')).sort(), [`node-v24.0.1-${KEY}`, `node-v24.0.2-${KEY}`]);

      // 4. Once nothing names it, the old one goes.
      fs.rmSync(plist);
      r = await setup(pins2);
      assert.strictEqual(r.code, 0, r.stdout + r.stderr);
      assert.deepStrictEqual(fs.readdirSync(path.join(home, 'runtime')), [`node-v24.0.2-${KEY}`]);

      // 5. A download that doesn't match its pin: setup still works, on the node running it, and says so.
      const home2 = path.join(dir, 'ws2');
      r = await runCli(['setup', '--copy', '--no-link', '--no-examples', '--native-dir', path.join(dir, 'native2')],
        { home: home2, env: { TRIF_RUNTIME: pinsFile(dir, '24.0.3', srv2.base, { ...a2, sha256: '0'.repeat(64) }) }, timeout: 90000 });
      assert.strictEqual(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /runtime +couldn't download TRIF's own Node \(the download of .* doesn't match its pinned checksum; not using it\); using .* for now, and trying again at the next update/);
      assert.ok(!wrapperNode(home2).includes(`${path.sep}runtime${path.sep}`), wrapperNode(home2));
      assert.deepStrictEqual(fs.readdirSync(path.join(home2, 'runtime')), []);
    } finally {
      srv2.stop();
    }
  } finally {
    srv.stop();
  }
});
