'use strict';
// The clean-machine test (docs/NO-NODE.md, step 8): TRIF on a computer with no Node. A scratch home folder
// and PATH=/usr/bin:/bin for everything TRIF runs; the real install.sh (filled in by release.js
// installScript) against a local server holding `npm pack` builds of this checkout and the real pinned
// Node archive (downloaded once from nodejs.org into a cache, checksum-checked); then the installed helper
// with a stand-in extension, real side-panel runs of the coding agents installed here (their sandboxes,
// a stand-in model) running `trif`, an update from a previous build (a signed feed, a test key), and
// `trif uninstall --all`. Never the real ~/.trif, keychain, browsers or LaunchAgents (TRIF_NO_LAUNCHCTL).
//
// Opt in with TRIF_CLEAN_MACHINE=1 (it downloads ~30 MB once and takes a minute or two). The cache:
// TRIF_TEST_NODE_CACHE, else <tmp>/trif-node-archives. Prints sizes and timings (# lines).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { FakeExtension, waitFor } = require('./fake-extension');
const { startFakeAnthropic } = require('./fake-anthropic-server');
const { startFakeModelServer } = require('./fake-model-server');
const { makeFakeKeychain } = require('./fake-keychain');
const R = require('../helper/lib/runtime');
const P = require('../helper/lib/paths');
const rel = require('../scripts/release');
const { findExecutable, versionOf } = require('../helper/lib/agents/util');

const REPO = path.join(__dirname, '..');
const KEY = R.platformKey();
const ON = process.env.TRIF_CLEAN_MACHINE === '1';
const skip = !ON ? 'opt in with TRIF_CLEAN_MACHINE=1' : !KEY || !['darwin', 'linux'].includes(process.platform) ? 'macOS and Linux only' : false;
const MAC = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
const NO_NODE_PATH = '/usr/bin:/bin';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
const du = (p) => { try { return Number(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split(/\s/)[0]) * 1024; } catch { return 0; } };
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

function agentBinary(name, dirs, tooOld) {
  const file = findExecutable(name, [...dirs, ...String(process.env.PATH || '').split(path.delimiter)]);
  if (!file) return null;
  const real = fs.realpathSync(file);
  // (a native binary only: one that is itself a node script can't run where there's no node)
  if (fs.readFileSync(real).subarray(0, 2).toString() === '#!') return null;
  const v = versionOf(real, { PATH: NO_NODE_PATH, HOME: process.env.HOME });
  return v && !tooOld(v) ? real : null;
}
const CLAUDE = MAC && ON && !process.env.TRIF_TEST_NO_REAL_CLAUDE ? agentBinary('claude', [path.join(os.homedir(), '.local', 'bin')], require('../helper/lib/agents/claude').tooOld) : null;
const CODEX = MAC && ON && !process.env.TRIF_TEST_NO_REAL_CODEX ? agentBinary('codex', ['/opt/homebrew/bin', '/usr/local/bin'], require('../helper/lib/agents/codex').tooOld) : null;

// A short scratch folder (socket paths are limited to ~104 bytes), in the user's own temporary folder on
// macOS, never under /tmp (denied to runs).
function scratch() {
  let base = os.tmpdir();
  if (process.platform === 'darwin') { try { base = spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).stdout.trim() || base; } catch { /* as is */ } }
  return fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(base), 'tcm-')));
}

// The archive install.sh picks for this computer, from the real pins, in the cache (downloaded if missing).
function nodeArchive() {
  const xz = process.platform === 'darwin' || spawnSync('/bin/sh', ['-c', 'command -v xz']).status === 0;
  const pin = R.PINS.archives[KEY].find((a) => xz || !a.file.endsWith('.tar.xz'));
  const dir = process.env.TRIF_TEST_NODE_CACHE || path.join(os.tmpdir(), 'trif-node-archives');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, pin.file);
  if (!fs.existsSync(file) || sha(file) !== pin.sha256) {
    execFileSync('curl', ['-fsSL', '--proto', '=https', '-o', `${file}.part`, `${R.PINS.base}${pin.file}`], { stdio: 'inherit', timeout: 300000 });
    fs.renameSync(`${file}.part`, file);
  }
  assert.strictEqual(sha(file), pin.sha256, `${file} isn't the pinned archive`);
  return { pin, file };
}

// `npm pack` of this checkout's package files (or `root`'s) at `version`, with `releaseKey` (a PEM) in place
// of the real one when given. Returns the .tgz path.
function pack(S, version, releaseKey, root = REPO) {
  const stage = path.join(S, `stage-${version}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const f of pkg.files) {
    fs.cpSync(path.join(root, f.replace(/\/$/, '')), path.join(stage, f.replace(/\/$/, '')), { recursive: true, filter: (p) => !p.split(path.sep).includes('node_modules') });
  }
  for (const f of ['README.md', 'LICENSE']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...pkg, version, scripts: {} }, null, 2));
  if (releaseKey) fs.writeFileSync(path.join(stage, 'helper', 'lib', 'release-key.js'), `'use strict';\nmodule.exports = ${JSON.stringify(releaseKey)};\n`);
  const out = path.join(S, 'files');
  const name = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }).trim().split('\n').pop();
  return path.join(out, name);
}

// A static file server in its own process (TRIF's commands run synchronously below).
function serve(dir) {
  const src = `const http=require('http'),fs=require('fs'),path=require('path');
    const s=http.createServer((q,r)=>{const f=path.join(${JSON.stringify(dir)},path.basename(q.url.split('?')[0]));
      fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200);r.end(d);}});});
    s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => child.stdout.once('data', (d) => resolve({ base: `http://127.0.0.1:${String(d).trim()}/`, stop: () => child.kill() })));
}

function run(file, args, env, { input = '', timeout = 300000 } = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(file, args, { env, input, encoding: 'utf8', timeout });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`, ms: ms(t0) };
}

// The same, without blocking this process (the stand-in extension in it has to answer the helper).
function runAsync(file, args, env, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `c${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id);
}
async function runAgent(ext, { agent, site, tabId, model }) {
  const r = await extRequest(ext, 'agent.start', { agent, site, url: `https://${site}/page`, tabId, prompt: 'probe', ...(model ? { model } : {}) });
  assert.equal(r.ok, true, r.error);
  const done = await ext.next((m) => m.type === 'agentEvent' && m.runId === r.result.runId && m.event.kind === 'done', { timeout: 150000 });
  return { done: done.event, events: ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === r.result.runId).map((m) => m.event) };
}
// Claude Code's tool results, in order.
function claudeResults(api) {
  const last = [...api.requests].reverse().find((r) => r.body && Array.isArray(r.body.messages) && r.body.stream);
  const out = [];
  for (const m of last ? last.body.messages : []) {
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (!c || c.type !== 'tool_result') continue;
      const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => (x && x.text) || '').join('\n') : JSON.stringify(c.content);
      out.push({ code: c.is_error ? 1 : 0, out: text });
    }
  }
  return out;
}
const FILE_TROUBLE = /\bEPERM\b|\bEACCES\b|\bENOENT\b|operation not permitted|permission denied|no such file|cannot find module|command not found/i;
const RUN_COMMANDS = (site) => ['trif status', 'trif tabs', `trif new ${site} probe --style`, `trif check ${site}/probe`, `trif verify ${site}/probe`, 'trif mods', 'trif doctor'];

test('a computer with no Node: install.sh, the helper, `trif` in sandboxed runs, an update, uninstall', { skip, timeout: 900000 }, async (t) => {
  const S = scratch();
  cleanups.push(() => fs.rmSync(S, { recursive: true, force: true }));
  const home = path.join(S, 'h');
  const ws = path.join(home, '.trif');
  const priv = P.defaultPrivateDir({ env: {}, homedir: home });
  const native = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts') : path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
  fs.mkdirSync(path.join(S, 'files'), { recursive: true });
  fs.mkdirSync(path.join(S, 'tmp'));
  fs.mkdirSync(home);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const OLD = '0.1.0';
  assert.ok(rel && require('../helper/lib/update').compareVersions(pkgVersion, OLD) > 0);

  // The builds and the server: the previous build trusts a test release key; this build is as shipped.
  const k = crypto.generateKeyPairSync('ed25519');
  const pub = k.publicKey.export({ type: 'spki', format: 'pem' });
  const oldTgz = pack(S, OLD, pub);
  const newTgz = pack(S, pkgVersion, null);
  const node = nodeArchive();
  fs.copyFileSync(node.file, path.join(S, 'files', node.pin.file));
  const srv = await serve(path.join(S, 'files'));
  cleanups.push(() => srv.stop());
  const script = rel.installScript(fs.readFileSync(path.join(REPO, 'scripts', 'install.sh'), 'utf8'), {
    version: OLD, packageUrl: `https://example.test/${path.basename(oldTgz)}`, packageSha256: sha(oldTgz), pins: R.PINS,
  }).replace(/^PACKAGE_URL=.*$/m, `PACKAGE_URL='${srv.base}${path.basename(oldTgz)}'`)
    .replace(/^NODE_BASE=.*$/m, `NODE_BASE='${srv.base}'`)
    .replace(/^NODE_ARCHIVES='\n[\s\S]*?\n'$/m, `NODE_ARCHIVES='\n${KEY} ${node.pin.file} ${node.pin.sha256}\n'`);

  // The computer: agents where they're installed (native binaries), a stand-in keychain, no node.
  const agentBin = path.join(S, 'agentbin');
  fs.mkdirSync(agentBin);
  if (CLAUDE) fs.symlinkSync(CLAUDE, path.join(agentBin, 'claude'));
  if (CODEX) fs.symlinkSync(CODEX, path.join(agentBin, 'codex'));
  const kc = makeFakeKeychain(path.join(home, 'Library', 'Keychains', 'trif-test'));
  const PATH = `${agentBin}:${NO_NODE_PATH}`;
  const env = {
    HOME: home, PATH, TRIF_HOME: ws, TRIF_DEFAULT_AGENT_DIRS: '', TRIF_UPDATE_DELAY: '2000000000', TRIF_NO_LAUNCHCTL: '1',
    TRIF_BOX_ROOT: path.join(home, 'Library', 'Caches', 'TRIF', 'boxes'), TRIF_CLAUDE_MANAGED_DIR: path.join(S, 'no-claude-managed'), ...kc.env,
  };
  assert.notStrictEqual(spawnSync('/bin/sh', ['-c', 'command -v node'], { env }).status, 0, 'no node on PATH');
  const trif = (args, opts) => run(path.join(ws, 'bin', P.CLI_NAME), args, env, opts);
  const browsers = process.platform === 'darwin' ? 'chrome,safari' : 'chrome';

  let runtimeNode;
  await t.test('install.sh, piped to sh: TRIF on its own Node, and nothing else', () => {
    const t0 = process.hrtime.bigint();
    const r = spawnSync('/bin/sh', ['-s', '--', '--browser', browsers, '--no-link', '--no-examples'], { env: { ...env, TMPDIR: path.join(S, 'tmp') }, input: script, encoding: 'utf8', timeout: 300000 });
    const out = `${r.stdout}${r.stderr}`;
    assert.strictEqual(r.status, 0, out);
    console.log(`# install.sh (local server, cached archive): ${ms(t0)} ms`);
    runtimeNode = R.installedNode(ws);
    assert.ok(runtimeNode && runtimeNode.startsWith(path.join(ws, 'runtime', `node-v${R.PINS.version}-${KEY}`)), `${runtimeNode}\n${out}`);
    assert.deepStrictEqual(fs.readdirSync(path.join(S, 'tmp')), [], "install.sh's temporary folder is gone");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'app', 'package.json'), 'utf8')).version, OLD);
    // Both wrappers, the manifest and the Safari bridge's agent name TRIF's own Node (and no other).
    for (const w of [P.CLI_NAME, `${P.CLI_NAME}-host`]) {
      const text = fs.readFileSync(path.join(ws, 'bin', w), 'utf8');
      assert.ok(text.includes(runtimeNode), `${w}:\n${text}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(native, `${P.HOST_NAME}.json`), 'utf8'));
    assert.strictEqual(manifest.path, path.join(ws, 'bin', `${P.CLI_NAME}-host`));
    if (process.platform === 'darwin') {
      const plists = fs.readdirSync(path.join(home, 'Library', 'LaunchAgents'));
      assert.strictEqual(plists.length, 1, plists.join());
      const plist = fs.readFileSync(path.join(home, 'Library', 'LaunchAgents', plists[0]), 'utf8');
      assert.ok(plist.includes(`<string>${runtimeNode}</string>`), plist);
    }
    console.log(`# on disk: runtime ${mb(du(path.join(ws, 'runtime')))}, app ${mb(du(path.join(ws, 'app')))}; package ${mb(fs.statSync(oldTgz).size)}`);
  });

  await t.test('trif on its own Node: help, doctor (the runtime line is ok), status', () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const v = trif(['help']);
      assert.strictEqual(v.code, 0, v.out);
      times.push(v.ms);
    }
    console.log(`# trif help on the runtime: ${times.join(', ')} ms`);
    const d = trif(['doctor']);
    assert.ok(d.out.includes(`TRIF's own Node v${R.PINS.version} (`), d.out);
    assert.doesNotMatch(d.out, /not its own|damaged/i, d.out);
    // (status, with no browser connected yet: says so, doesn't crash)
    assert.match(trif(['status']).out, /\w/);
  });

  await t.test('the helper, started as a browser starts it, and `trif` inside real sandboxed runs', { timeout: 400000 }, async (st) => {
    const anthropicScript = [];
    const anthropic = await startFakeAnthropic({ script: anthropicScript });
    cleanups.push(() => anthropic.close());
    const openaiScript = [];
    const openai = await startFakeModelServer({ script: openaiScript });
    cleanups.push(() => openai.close());
    if (CLAUDE) await require('../helper/lib/agentkeys').setAgentKey('claude', `sk-ant-fake-${crypto.randomBytes(8).toString('hex')}`, { env: kc.env });
    if (CODEX) await require('../helper/lib/agentkeys').setAgentKey('codex', `sk-fake-${crypto.randomBytes(8).toString('hex')}`, { env: kc.env });
    const ext = new FakeExtension({ home: ws, command: path.join(ws, 'bin', `${P.CLI_NAME}-host`), env: {
      ...env, TRIF_ANTHROPIC_URL: anthropic.url, TRIF_OPENAI_URL: `${openai.url}/v1`, TRIF_AGENT_TIMEOUT_MS: '140000', TRIF_AGENT_KILL_GRACE_MS: '400',
    } });
    cleanups.push(() => ext.close());
    const tabs = [{ id: 12, windowId: 1, active: true, url: 'https://example.com/page', title: 'Example' }, { id: 13, windowId: 1, active: false, url: 'https://example.org/page', title: 'Example org' }];
    ext.handlers = {
      tabs: () => tabs,
      status: () => ({ userScripts: true, chrome: '140.0.0.0', version: OLD, mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [] }),
      reload: (a) => ({ url: (tabs.find((x) => x.id === (a.tab ?? a.tabId)) || tabs[0]).url }),
      errors: () => [],
      logs: () => [],
    };
    const onMessage = ext._onMessage.bind(ext);
    ext._onMessage = (m) => {
      onMessage(m);
      if (m.type === 'mods' && Array.isArray(m.mods)) ext.send({ type: 'modsApplied', registered: m.mods.map((x) => x.id), errors: [] });
    };
    ext.hello({ version: OLD });
    await ext.waitForSocket(15000);
    // The helper is the runtime's node (the wrapper execs it), and answers.
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(ext.child.pid)], { encoding: 'utf8' }).trim();
    assert.ok(cmd.startsWith(runtimeNode), cmd);
    const tabsR = await runAsync(path.join(ws, 'bin', P.CLI_NAME), ['tabs'], env);
    assert.match(tabsR.out, /example\.com\/page/, tabsR.out);

    await st.test('Claude Code', { skip: CLAUDE ? false : 'needs Claude Code installed (a native binary), macOS' }, async () => {
      const commands = RUN_COMMANDS('example.com');
      anthropicScript.length = 0;
      anthropicScript.push(...commands.map((c) => ({ bash: c })), { say: 'Done.' });
      const { done, events } = await runAgent(ext, { agent: 'claude', site: 'example.com', tabId: 12 });
      const results = claudeResults(anthropic);
      const info = results.map((x, i) => `$ ${commands[i]}\n[${x.code}] ${x.out.slice(0, 800)}`).join('\n') + `\n${JSON.stringify(events).slice(0, 1500)}`;
      assert.equal(done.ok, true, info);
      assert.equal(results.length, commands.length, info);
      for (const x of results) { assert.equal(x.code, 0, info); assert.doesNotMatch(x.out, FILE_TROUBLE, info); }
      assert.match(results[3].out, /^ok: /m, info);
    });

    await st.test('Codex (and no node in its sandbox either)', { skip: CODEX ? false : 'needs Codex installed (a native binary), macOS' }, async () => {
      const commands = [...RUN_COMMANDS('example.org'), 'command -v node'];
      const wrap = (c) => `${c} 2>&1; echo "[exit=$?]"`;
      openaiScript.length = 0;
      openaiScript.push(...commands.map((c) => ({ run: wrap(c) })), { say: 'Done.' });
      const { done, events } = await runAgent(ext, { agent: 'codex', site: 'example.org', tabId: 13, model: 'stand-in' });
      const outs = openai.toolOutputs();
      const info = outs.map((o, i) => `$ ${commands[i]}\n${o.slice(0, 800)}`).join('\n') + `\n${JSON.stringify(events).slice(0, 1500)}`;
      assert.equal(done.ok, true, info);
      assert.equal(outs.length, commands.length, info);
      for (const o of outs.slice(0, -1)) { assert.match(o, /\[exit=0\]\s*$/, info); assert.doesNotMatch(o, FILE_TROUBLE, info); }
      assert.match(outs.at(-1), /\[exit=1\]\s*$/, `node isn't on the run's PATH:\n${info}`);
    });
    await ext.close();
  });

  await t.test('an update from the previous build: kept mods and settings, still on its own Node', async () => {
    // The user's things: a mod of their own and a setting.
    fs.mkdirSync(path.join(ws, 'sites', 'mine.test'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'sites', 'mine.test', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://mine.test/*\n// ==/WebMod==\n');
    const cfgFile = path.join(priv, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, updateFeed: `${srv.base}latest.json`, keepMe: 'yes' }));
    const feed = rel.latestFeed({ version: pkgVersion, published: '2026-11-17', signed: new Date().toISOString(), notes: 'Test build.', url: `${srv.base}${path.basename(newTgz)}`, sha256: sha(newTgz), size: fs.statSync(newTgz).size });
    fs.writeFileSync(path.join(S, 'files', 'latest.json'), feed);
    fs.writeFileSync(path.join(S, 'files', 'latest.json.sig'), rel.signBytes(feed, k.privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const u = trif(['update', '--install'], { timeout: 700000 });
    assert.strictEqual(u.code, 0, u.out);
    console.log(`# trif update --install (local server): ${u.ms} ms`);
    assert.match(u.out, new RegExp(`${OLD.replace(/\./g, '\\.')} -> ${pkgVersion.replace(/\./g, '\\.')}`), u.out);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'app', 'package.json'), 'utf8')).version, pkgVersion);
    assert.strictEqual(R.installedNode(ws), runtimeNode, 'the same runtime, not fetched again');
    assert.ok(fs.readFileSync(path.join(ws, 'bin', P.CLI_NAME), 'utf8').includes(runtimeNode));
    assert.ok(fs.existsSync(path.join(ws, 'sites', 'mine.test', 'keep.js')));
    assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).keepMe, 'yes');
    assert.strictEqual(trif(['help']).code, 0);
  });

  await t.test('trif uninstall --all --yes: nothing of TRIF left', async () => {
    const binDir = path.join(S, 'usrlocalbin');
    fs.mkdirSync(binDir);
    const u = trif(['uninstall', '--all', '--yes', '--bin-dir', binDir]);
    assert.strictEqual(u.code, 0, u.out);
    await waitFor(() => !fs.existsSync(ws), { timeout: 5000, message: 'the workspace removed' });
    assert.ok(!fs.existsSync(priv), 'the private folder removed');
    assert.deepStrictEqual(fs.existsSync(native) ? fs.readdirSync(native) : [], [], 'the browser connection removed');
    if (process.platform === 'darwin') assert.deepStrictEqual(fs.readdirSync(path.join(home, 'Library', 'LaunchAgents')), [], "the Safari bridge's agent removed");
    assert.deepStrictEqual(Object.keys(kc.items()).filter((x) => /trif|claude|codex/i.test(x)), [], 'the saved keys removed');
  });
});

// The upgrade (step 9): TRIF as people have it today, installed by `npx timsrobot setup` on the computer's
// own Node, updates to this build the way the panel's Update button does (the old updater runs the new
// setup on that Node); the new setup fetches TRIF's own Node and moves everything onto it. The old build is
// the last release (TRIF_UPGRADE_FROM: another git ref), packed with a test release key; this build is
// packed one patch version up. Skipped when the ref isn't in this clone.
const FROM = process.env.TRIF_UPGRADE_FROM || 'v0.3.0';
const hasFrom = spawnSync('git', ['rev-parse', '-q', '--verify', `${FROM}^{commit}`], { cwd: REPO }).status === 0;
// The phone link (branch phone-link, docs/PHONE-LINK.md), once it's in this checkout: the upgrade test then seeds
// its real state (a computer key in the keyring, a paired phone in phone-link.json) and, on TRIF's own Node, the
// stand-in phone (tests/phone-link-client.js) reconnects to the installed helper: X25519, ChaCha20-Poly1305 and
// a TCP listener (on 127.0.0.1 alone) on the runtime. Before it's merged, a stand-in file is kept instead.
const PHONE_LINK = fs.existsSync(path.join(REPO, 'helper', 'lib', 'phonelink', 'noise.js'));
test(`upgrade: a Node-based install (${FROM}) updates to this build and ends on TRIF's own Node, keeping everything`, { skip: skip || (!hasFrom && `no git ref ${FROM} here`), timeout: 600000 }, async (t) => {
  const S = scratch();
  cleanups.push(() => fs.rmSync(S, { recursive: true, force: true }));
  const home = path.join(S, 'h');
  const ws = path.join(home, '.trif');
  const priv = P.defaultPrivateDir({ env: {}, homedir: home });
  fs.mkdirSync(path.join(S, 'files'), { recursive: true });
  fs.mkdirSync(home);
  const src = path.join(S, 'from');
  fs.mkdirSync(src);
  execFileSync('/bin/sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', REPO, FROM, src]);
  const OLD = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
  const NEW = OLD.replace(/\d+$/, (n) => String(Number(n) + 1));
  assert.ok(require('../helper/lib/update').compareVersions(NEW, OLD) > 0);
  const k = crypto.generateKeyPairSync('ed25519');
  const oldTgz = pack(S, OLD, k.publicKey.export({ type: 'spki', format: 'pem' }), src);
  const newTgz = pack(S, NEW, null);
  const node = nodeArchive();
  fs.copyFileSync(node.file, path.join(S, 'files', node.pin.file));
  const srv = await serve(path.join(S, 'files'));
  cleanups.push(() => srv.stop());
  // (the real pins, served from here)
  const pinsFile = path.join(S, 'pins.json');
  fs.writeFileSync(pinsFile, JSON.stringify({ ...R.PINS, base: srv.base, archives: { [KEY]: [node.pin] } }));

  // The computer as it is today: Node on PATH (only node: a folder of its own).
  const sysBin = path.join(S, 'sysnode');
  fs.mkdirSync(sysBin);
  fs.symlinkSync(process.execPath, path.join(sysBin, 'node'));
  const kc = makeFakeKeychain(path.join(home, 'Library', 'Keychains', 'trif-test'));
  // (the phone link: never the real dns-sd, which would announce on the Wi-Fi; a listener on this computer alone)
  const dnsSd = path.join(S, 'dns-sd');
  fs.writeFileSync(dnsSd, '#!/bin/sh\nexec /bin/sleep 86400\n', { mode: 0o755 });
  const base = { HOME: home, TRIF_DEFAULT_AGENT_DIRS: '', TRIF_UPDATE_DELAY: '2000000000', TRIF_NO_LAUNCHCTL: '1', TRIF_BOX_ROOT: path.join(home, 'Library', 'Caches', 'TRIF', 'boxes'), TRIF_DNS_SD: dnsSd, TRIF_PHONE_LINK_HOST: '127.0.0.1', ...kc.env };
  const withNode = { ...base, PATH: `${sysBin}:${NO_NODE_PATH}`, TRIF_RUNTIME: pinsFile };
  const noNode = { ...base, PATH: NO_NODE_PATH };
  const browsers = process.platform === 'darwin' ? 'chrome,safari' : 'chrome';
  const native = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts') : path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
  const plistDir = path.join(home, 'Library', 'LaunchAgents');
  const plistText = () => fs.readdirSync(plistDir).map((f) => fs.readFileSync(path.join(plistDir, f), 'utf8')).join('\n');
  const cfgFile = path.join(priv, 'config.json');
  const phoneFile = path.join(priv, 'phone-link.json');
  const b64 = (buf) => Buffer.from(buf).toString('base64url');
  const noise = PHONE_LINK ? require('../helper/lib/phonelink/noise') : null;
  const computerKeys = noise && noise.generateKeyPair();
  const phoneKeys = noise && noise.generateKeyPair();
  const phone = !noise ? { v: 1, phones: [{ id: 'p1', name: "Tim's phone", key: 'AAAA', paired: '2026-11-15T10:00:00Z' }] }
    : { on: true, sync: true, publicKey: b64(computerKeys.publicKey), port: 0, phones: [{ id: noise.keyId(phoneKeys.publicKey), name: "Tim's phone", key: b64(phoneKeys.publicKey), pairedAt: '2026-11-15T10:00:00.000Z', lastSeen: '2026-11-15T10:00:00.000Z' }] };

  await t.test(`${FROM}, installed the way it is today: on the computer's Node`, () => {
    const pkgDir = path.join(S, 'npx');
    fs.mkdirSync(pkgDir);
    execFileSync('tar', ['-xzf', oldTgz, '-C', pkgDir]);
    const r = run(path.join(sysBin, 'node'), [path.join(pkgDir, 'package', 'helper', 'cli.js'), 'setup', '--copy', '--browser', browsers, '--no-link', '--no-examples'], withNode);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(R.installedNode(ws), null, 'no runtime yet');
    assert.doesNotMatch(fs.readFileSync(path.join(ws, 'bin', P.CLI_NAME), 'utf8'), /\/runtime\//);
    if (process.platform === 'darwin') assert.doesNotMatch(plistText(), /\/runtime\//);
    // The user's things: a mod, settings, a paired phone (phone-link's file and its key in the keyring), an API key.
    fs.mkdirSync(path.join(ws, 'sites', 'mine.test'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'sites', 'mine.test', 'keep.js'), '// ==WebMod==\n// @name Keep\n// @match https://mine.test/*\n// ==/WebMod==\n');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, updateFeed: `${srv.base}latest.json`, keepMe: 'yes' }));
    fs.writeFileSync(phoneFile, JSON.stringify(phone));
  });
  await require('../helper/lib/keyring').setKey('computer', noise ? b64(computerKeys.privateKey) : 'phone-private-key', { service: 'TRIF phone link', env: kc.env });
  await require('../helper/lib/agentkeys').setAgentKey('claude', 'sk-ant-fake-upgrade', { env: kc.env });
  const keysBefore = kc.items();

  await t.test(`the ${FROM} updater installs this build: TRIF's own Node fetched, wrappers and the Safari bridge on it`, () => {
    const feed = rel.latestFeed({ version: NEW, published: '2026-11-17', signed: new Date().toISOString(), notes: 'Test build.', url: `${srv.base}${path.basename(newTgz)}`, sha256: sha(newTgz), size: fs.statSync(newTgz).size });
    fs.writeFileSync(path.join(S, 'files', 'latest.json'), feed);
    fs.writeFileSync(path.join(S, 'files', 'latest.json.sig'), rel.signBytes(feed, k.privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const u = run(path.join(ws, 'bin', P.CLI_NAME), ['update', '--install'], withNode, { timeout: 300000 });
    assert.strictEqual(u.code, 0, u.out);
    console.log(`# upgrade from ${FROM} (old updater, runtime fetched from a local server): ${u.ms} ms`);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'app', 'package.json'), 'utf8')).version, NEW);
    const rt = R.installedNode(ws);
    assert.ok(rt && rt.startsWith(path.join(ws, 'runtime', `node-v${R.PINS.version}-${KEY}`)), `${rt}\n${u.out}`);
    for (const w of [P.CLI_NAME, `${P.CLI_NAME}-host`]) {
      const text = fs.readFileSync(path.join(ws, 'bin', w), 'utf8');
      assert.ok(text.includes(rt) && !text.includes(sysBin), `${w}:\n${text}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(native, `${P.HOST_NAME}.json`), 'utf8'));
    assert.strictEqual(manifest.path, path.join(ws, 'bin', `${P.CLI_NAME}-host`));
    if (process.platform === 'darwin') {
      assert.strictEqual(fs.readdirSync(plistDir).length, 1);
      assert.ok(plistText().includes(`<string>${rt}</string>`), plistText());
    }
  });

  await t.test('nothing lost: mods, settings, the paired phone, saved keys', () => {
    assert.ok(fs.existsSync(path.join(ws, 'sites', 'mine.test', 'keep.js')));
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.strictEqual(cfg.keepMe, 'yes');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(phoneFile, 'utf8')), phone);
    assert.deepStrictEqual(kc.items(), keysBefore);
  });

  await t.test('then the computer\'s Node goes away: trif, doctor and the helper still work', async () => {
    fs.rmSync(sysBin, { recursive: true });
    const trif = (args) => run(path.join(ws, 'bin', P.CLI_NAME), args, noNode);
    assert.strictEqual(trif(['help']).code, 0);
    const d = trif(['doctor']);
    assert.ok(d.out.includes(`TRIF's own Node v${R.PINS.version} (`), d.out);
    assert.doesNotMatch(d.out, /not its own|damaged|system Node/i, d.out);
    const ext = new FakeExtension({ home: ws, command: path.join(ws, 'bin', `${P.CLI_NAME}-host`), env: noNode });
    cleanups.push(() => ext.close());
    ext.handlers = { tabs: () => [{ id: 12, windowId: 1, active: true, url: 'https://example.com/page', title: 'Example' }] };
    ext.hello({ version: NEW });
    await ext.waitForSocket(15000);
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(ext.child.pid)], { encoding: 'utf8' }).trim();
    assert.ok(cmd.startsWith(R.installedNode(ws)), cmd);
    const tabsR = await runAsync(path.join(ws, 'bin', P.CLI_NAME), ['tabs'], noNode);
    assert.match(tabsR.out, /example\.com\/page/, tabsR.out);
    if (PHONE_LINK) {
      // The phone paired before the upgrade reaches the helper on TRIF's own Node with the keys it has.
      let asked = 0;
      const panel = async (cmd) => {
        const id = `p${++asked}`;
        ext.send({ type: 'request', id, cmd, args: {} });
        const r = await ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
        assert.ok(r.ok, r.error);
        return r.result;
      };
      let st = null;
      await waitFor(async () => { st = await panel('phone.status'); return st.listening && st.port; }, { timeout: 15000, message: 'the phone link listening' });
      assert.strictEqual(st.on, true);
      assert.deepStrictEqual(st.phones.map((p) => p.name), ["Tim's phone"]);
      const { PhoneClient } = require('./phone-link-client');
      const t0 = process.hrtime.bigint();
      const ph = await PhoneClient.connect({ port: st.port, computerKey: computerKeys.publicKey, keys: phoneKeys, name: "Tim's phone" });
      cleanups.push(() => ph.close());
      const hello = await ph.request({ t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } });
      assert.strictEqual(hello.t, 'hello', JSON.stringify(hello));
      console.log(`# phone link on TRIF's own Node: handshake + hello ${ms(t0)} ms`);
      await ph.close();
    }
    await ext.close();
  });
});
