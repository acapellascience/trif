'use strict';
// install.sh (scripts/install.sh, filled in by scripts/release.js installScript) and `release.js
// refresh-runtime` (runtimePins), docs/NO-NODE.md. install.sh runs with no node on PATH, against a local
// server holding a fake Node archive and a fake package whose cli.js records how it was run: never
// nodejs.org, never a real setup (that's the clean-machine test's job).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { tempDir } = require('./fake-extension');
const R = require('../helper/lib/runtime');
const rel = require('../scripts/release');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install.sh'), 'utf8');
const KEY = R.platformKey();
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shasumsFor = (version) => Object.entries(rel.RUNTIME_PLATFORMS)
  .flatMap(([key, exts]) => exts.map((ext) => `${crypto.createHash('sha256').update(key + ext).digest('hex')}  node-v${version}-${key}.${ext}`))
  .concat([`${'a'.repeat(64)}  node-v${version}.tar.gz`, `${'b'.repeat(64)}  win-x64/node.exe`]).join('\n') + '\n';

test('runtimePins: every platform from SHASUMS256.txt, xz before gz; a missing archive or bad version throws', () => {
  const pins = rel.runtimePins('24.30.1', shasumsFor('24.30.1'));
  assert.strictEqual(pins.version, '24.30.1');
  assert.strictEqual(pins.base, 'https://nodejs.org/dist/v24.30.1/');
  assert.deepStrictEqual(Object.keys(pins.archives), Object.keys(rel.RUNTIME_PLATFORMS));
  assert.deepStrictEqual(pins.archives['linux-x64'].map((a) => a.file), ['node-v24.30.1-linux-x64.tar.xz', 'node-v24.30.1-linux-x64.tar.gz']);
  assert.strictEqual(pins.archives['win-x64'][0].sha256, crypto.createHash('sha256').update('win-x64zip').digest('hex'));
  assert.strictEqual(rel.runtimePinsProblem(pins), null);
  assert.throws(() => rel.runtimePins('24.30.1', shasumsFor('24.30.1').replace(/.*darwin-x64\.tar\.gz\n/, '')), /no node-v24\.30\.1-darwin-x64\.tar\.gz/);
  assert.throws(() => rel.runtimePins('v24', ''), /isn't a Node version/);
  // The pins in the repo are what refresh-runtime makes, and pass the release check.
  assert.strictEqual(rel.runtimePinsProblem(R.PINS), null);
  const broken = JSON.parse(JSON.stringify(R.PINS));
  delete broken.archives['linux-arm64'];
  assert.match(rel.runtimePinsProblem(broken), /no archive for linux-arm64/);
});

test('newestNode and refresh-runtime --dry-run: the newest of the pinned major, written outside the repo', async () => {
  const index = [{ version: 'v25.1.0' }, { version: 'v24.30.1' }, { version: 'v24.9.0' }, { version: 'v24.30.0' }, { version: 'junk' }];
  assert.strictEqual(rel.newestNode(index, 24), '24.30.1');
  assert.strictEqual(rel.newestNode(index, 26), null);
  const dir = tempDir('refresh-runtime-');
  const runtimeFile = path.join(dir, 'runtime.json');
  fs.writeFileSync(runtimeFile, JSON.stringify(R.PINS));
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return Buffer.from(url.endsWith('index.json') ? JSON.stringify(index) : shasumsFor('24.30.1'));
  };
  const log = console.log;
  console.log = () => {};
  let r;
  try { r = await rel.refreshRuntimeCommand({ dryRun: true, dist: 'https://example.test/dist/', fetch, runtimeFile, outDir: path.join(dir, 'out') }); } finally { console.log = log; }
  assert.deepStrictEqual(urls, ['https://example.test/dist/index.json', 'https://example.test/dist/v24.30.1/SHASUMS256.txt']);
  assert.strictEqual(r.file, path.join(dir, 'out', 'runtime.json'));
  assert.strictEqual(JSON.parse(fs.readFileSync(r.file, 'utf8')).base, 'https://example.test/dist/v24.30.1/');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(runtimeFile, 'utf8')), R.PINS); // untouched
});

const fill = (over = {}) => rel.installScript(TEMPLATE, {
  version: '0.4.0', packageUrl: 'https://github.com/acapellascience/trif/releases/download/v0.4.0/timsrobot-0.4.0.tgz',
  packageSha256: 'c'.repeat(64), pins: R.PINS, ...over,
});

test('installScript: every value written in, unix archives only, valid sh; refuses values that can\'t go in as is', () => {
  const s = fill();
  assert.doesNotMatch(s, /@@/);
  assert.match(s, /^TRIF_VERSION='0\.4\.0'$/m);
  assert.match(s, /^PACKAGE_SHA256='c{64}'$/m);
  assert.match(s, new RegExp(`^NODE_BASE='${R.PINS.base}'$`, 'm'));
  for (const a of R.PINS.archives['darwin-arm64']) assert.ok(s.includes(`darwin-arm64 ${a.file} ${a.sha256}`));
  assert.doesNotMatch(s, /^win-|\.zip /m);
  const file = path.join(tempDir('install-sh-'), 'install.sh');
  fs.writeFileSync(file, s);
  execFileSync('/bin/sh', ['-n', file]);
  if (fs.existsSync('/bin/dash')) execFileSync('/bin/dash', ['-n', file]);
  assert.throws(() => fill({ packageUrl: "https://x.test/a'b.tgz" }), /plain https URL/);
  assert.throws(() => fill({ packageUrl: 'http://x.test/a.tgz' }), /plain https URL/);
  assert.throws(() => fill({ packageSha256: 'abc' }), /64 hex/);
  assert.throws(() => fill({ pins: { ...R.PINS, archives: {} } }), /no archive for/);
  assert.throws(() => rel.installScript(`${TEMPLATE}@@OTHER@@`, { version: '0.4.0', packageUrl: 'https://x.test/a.tgz', packageSha256: 'c'.repeat(64), pins: R.PINS }), /unknown @@OTHER@@/);
});

// A static file server in its own process.
function serve(dir) {
  const src = `const http=require('http'),fs=require('fs'),path=require('path');
    const s=http.createServer((q,r)=>{const f=path.join(${JSON.stringify(dir)},path.basename(q.url));
      fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200);r.end(d);}});});
    s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => child.stdout.once('data', (d) => resolve({ base: `http://127.0.0.1:${String(d).trim()}/`, stop: () => child.kill() })));
}

// `cat install.sh | sh -s -- <args>`, as `curl … | sh` runs it, with no node on PATH.
function pipeToSh(script, args, env) {
  return new Promise((resolve) => {
    const c = spawn('/bin/sh', ['-s', '--', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
    c.stdin.end(script);
  });
}

test('install.sh piped to sh, no node on PATH: checks both downloads, runs setup --copy on the downloaded Node with its archive, args passed on, stdin not the script, temp folder gone', { skip: !KEY || process.platform === 'win32' }, async () => {
  const dir = tempDir('install-run-');
  const files = path.join(dir, 'files');
  fs.mkdirSync(files);
  const version = '24.0.9';
  // The Node archive, named for this computer's platform: a "node" that says it's v<version>, else runs
  // what it's given with the node running these tests (by its full path: there's none on PATH).
  const name = `node-v${version}-${KEY}`;
  fs.mkdirSync(path.join(dir, 'src', name, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', name, 'bin', 'node'), `#!/bin/sh\nif [ "$1" = --version ]; then echo v${version}; exit 0; fi\nFAKE_NODE="$0" exec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const archive = `${name}.tar.gz`;
  execFileSync('tar', ['-czf', path.join(files, archive), '-C', path.join(dir, 'src'), name]);
  // The package: npm pack's shape (package/…), its cli.js writes down how it was run.
  const record = path.join(dir, 'ran.json');
  fs.mkdirSync(path.join(dir, 'pkg', 'package', 'helper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'package', 'helper', 'cli.js'), `const fs=require('fs');
    fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), node: process.env.FAKE_NODE,
      archive: process.env.TRIF_RUNTIME_ARCHIVE, archiveThere: fs.existsSync(process.env.TRIF_RUNTIME_ARCHIVE || '/nope'),
      stdin: fs.readFileSync(0, 'utf8'), home: process.env.TRIF_HOME }));`);
  execFileSync('tar', ['-czf', path.join(files, 'trif.tgz'), '-C', path.join(dir, 'pkg'), 'package']);

  const srv = await serve(files);
  try {
    const pins = { version, base: srv.base, archives: { [KEY]: [{ file: archive, sha256: sha(path.join(files, archive)) }] } };
    // (installScript wants every platform and https; fill with the real pins, then point it at the local server)
    const real = fill({ packageSha256: sha(path.join(files, 'trif.tgz')) });
    const script = real.replace(/^PACKAGE_URL=.*$/m, `PACKAGE_URL='${srv.base}trif.tgz'`)
      .replace(/^NODE_VERSION=.*$/m, `NODE_VERSION='${version}'`).replace(/^NODE_BASE=.*$/m, `NODE_BASE='${pins.base}'`)
      .replace(/^NODE_ARCHIVES='\n[\s\S]*?\n'$/m, `NODE_ARCHIVES='\n${KEY} ${archive} ${pins.archives[KEY][0].sha256}\n'`);
    const tmp = path.join(dir, 'tmp');
    fs.mkdirSync(tmp);
    const env = { PATH: '/usr/bin:/bin', HOME: dir, TMPDIR: tmp, TRIF_HOME: path.join(dir, 'ws') };
    assert.throws(() => execFileSync('/bin/sh', ['-c', 'command -v node'], { env }), 'no node on this PATH');

    const r = await pipeToSh(script, ['--browser', 'brave'], env);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`Downloading Node ${version} for TRIF…`));
    const ran = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.deepStrictEqual(ran.args, ['setup', '--copy', '--browser', 'brave']);
    assert.ok(ran.node && ran.node.startsWith(tmp) && ran.node.endsWith(path.join(name, 'bin', 'node')), ran.node);
    assert.strictEqual(path.basename(ran.archive), archive);
    assert.strictEqual(ran.archiveThere, true);
    assert.strictEqual(ran.stdin, '');
    assert.strictEqual(ran.home, env.TRIF_HOME);
    assert.deepStrictEqual(fs.readdirSync(tmp), [], 'its temporary folder is removed');

    // A package that isn't the pinned one: stops before running anything.
    fs.rmSync(record);
    const bad = await pipeToSh(script.replace(/^PACKAGE_SHA256=.*$/m, `PACKAGE_SHA256='${'0'.repeat(64)}'`), [], env);
    assert.notStrictEqual(bad.code, 0);
    assert.match(bad.out, /TRIF install: the download of trif\.tgz doesn't match its pinned checksum/);
    assert.strictEqual(fs.existsSync(record), false);
    // A Node archive that isn't: the same.
    const badNode = await pipeToSh(script.replace(new RegExp(`${archive} [0-9a-f]{64}`), `${archive} ${'1'.repeat(64)}`), [], env);
    assert.match(badNode.out, new RegExp(`the download of ${archive.replace(/\./g, '\\.')} doesn't match`));
    assert.strictEqual(fs.existsSync(record), false);
    // Not https (and not this computer): refused.
    const plain = await pipeToSh(script.replace(/^PACKAGE_URL=.*$/m, "PACKAGE_URL='http://example.test/trif.tgz'"), [], env);
    assert.match(plain.out, /refusing to download http:\/\/example\.test\/trif\.tgz \(https only\)/);
    assert.deepStrictEqual(fs.readdirSync(tmp), []);
  } finally {
    srv.stop();
  }
});

test('the front door: one install command, the same in the extension, the CLI and the README; the site serves its path', async () => {
  const P = require('../helper/lib/paths');
  const lib = await import('../extension/lib.js');
  assert.strictEqual(P.INSTALL_COMMAND, 'curl -fsSL https://timsrobot.com/install.sh | sh');
  assert.strictEqual(lib.INSTALL_URL, P.INSTALL_URL);
  if (!lib.SAFARI) assert.strictEqual(lib.SETUP_COMMAND, P.INSTALL_COMMAND);
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes('```sh\n   ' + P.INSTALL_COMMAND + '\n   ```'), 'README install step 1 shows it');
  assert.doesNotMatch(readme, /^- Node 18 or newer/m, 'Node is no longer a requirement');
  const site = fs.readFileSync(path.join(__dirname, '..', 'site', 'src', 'index.js'), 'utf8');
  assert.ok(site.includes(`pathname === '${new URL(P.INSTALL_URL).pathname}'`), 'timsrobot.com redirects that path');
  const { COMMANDS } = require('../helper/lib/help');
  assert.match(COMMANDS.setup.details, /^First time: curl -fsSL https:\/\/timsrobot\.com\/install\.sh \| sh /);
  assert.ok(COMMANDS.setup.examples.includes(P.INSTALL_COMMAND));
});
