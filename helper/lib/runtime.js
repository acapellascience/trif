'use strict';
// TRIF's own Node (docs/NO-NODE.md): an official Node binary kept in <home>/runtime/node-v<ver>-<os>-<arch>/,
// so TRIF runs on a computer with no Node installed and doesn't break when the system's Node moves or is
// upgraded. Which version, and the SHA-256 of each platform's archive, are pinned in helper/runtime.json
// (from nodejs.org's SHASUMS256.txt), which ships inside the signed package: the update feed's signature
// covers the runtime too, so where the archive is downloaded from doesn't matter to its integrity.
//
// Only bin/node (node.exe on Windows) and LICENSE are kept from the archive. A folder is complete or
// absent: it's unpacked into a temporary folder beside it and renamed into place. Inside the workspace
// folder, which runs may read (runs.js runLimits makes node's folder readable), never in the private one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');

const { envVar, envName } = require('./env');

const PINS = require('../runtime.json');
const ARCHIVE_MAX = 80 * 1024 * 1024; // the largest archive (linux .tar.gz) is ~55 MB
const MARK = '.trif-runtime.json'; // in each runtime folder: what it was made from

class RuntimeError extends Error {}

/** 'darwin-arm64', 'linux-x64', 'win-x64'…, as nodejs.org names its archives; null for a platform it has none for. */
function platformKey(platform = process.platform, arch = process.arch, pins = PINS) {
  const os = platform === 'win32' ? 'win' : platform;
  const key = `${os}-${arch}`;
  return pins.archives && pins.archives[key] ? key : null;
}

function runtimeRoot(home) { return path.join(home, 'runtime'); }

function runtimeName(key, pins = PINS) { return `node-v${pins.version}-${key}`; }

function nodeIn(dir, platform = process.platform) {
  return platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node');
}

function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

/** The pinned runtime's node in <home>/runtime, or null when it isn't there (or this platform has none). */
function installedNode(home, { platform = process.platform, arch = process.arch, pins = PINS } = {}) {
  const key = platformKey(platform, arch, pins);
  if (!key) return null;
  const dir = path.join(runtimeRoot(home), runtimeName(key, pins));
  const node = nodeIn(dir, platform);
  return isExecutable(node) && fs.existsSync(path.join(dir, MARK)) ? node : null;
}

function hasXz() {
  try { return spawnSync('xz', ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0; } catch { return false; }
}

/** The archive to download: .tar.xz (smaller) where tar can unpack it, else .tar.gz; .zip on Windows. */
function pickArchive(key, { platform = process.platform, xz = null, pins = PINS } = {}) {
  const list = pins.archives[key] || [];
  const canXz = platform === 'darwin' || platform === 'win32' || (xz === null ? hasXz() : xz);
  return list.find((a) => canXz || !a.file.endsWith('.xz')) || null;
}

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 1024 * 1024, timeout: 120000, ...opts }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

/**
 * Make sure the pinned runtime is in <home>/runtime, downloading it if not. Resolves { node, version,
 * fetched } (fetched: whether it was downloaded now); throws RuntimeError, leaving nothing behind, when this
 * platform has no runtime, the download fails, or its checksum isn't the pinned one.
 */
async function ensureRuntime(home, { fetch = null, platform = process.platform, arch = process.arch, xz = null, pins = PINS, tar = 'tar', archiveFile = null } = {}) {
  const key = platformKey(platform, arch, pins);
  if (!key) throw new RuntimeError(`there's no TRIF runtime for ${platform}-${arch}`);
  const have = installedNode(home, { platform, arch, pins });
  if (have) return { node: have, version: pins.version, fetched: false };
  // An archive already downloaded (install.sh's, TRIF_RUNTIME_ARCHIVE): used when it's one of the pinned
  // files, still checked against its pin below; otherwise ignored and downloaded as usual.
  const local = archiveFile && (pins.archives[key] || []).find((a) => a.file === path.basename(archiveFile));
  const archive = local || pickArchive(key, { platform, xz, pins });
  if (!archive) throw new RuntimeError(`no archive of Node ${pins.version} that this computer can unpack`);
  fetch = local ? async () => fs.readFileSync(archiveFile) : fetch || require('./update').fetchUrl;

  const root = runtimeRoot(home);
  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, '.fetch-'));
  try {
    let data;
    try { data = await fetch(pins.base + archive.file, { maxBytes: ARCHIVE_MAX, timeoutMs: 300000 }); } catch (e) {
      throw new RuntimeError(local ? `couldn't read ${archiveFile}: ${e.message}` : `couldn't download Node ${pins.version}: ${e.message}`);
    }
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    if (sha !== archive.sha256) throw new RuntimeError(`the download of ${archive.file} doesn't match its pinned checksum; not using it`);
    const file = path.join(tmp, archive.file);
    fs.writeFileSync(file, data);
    const unpacked = path.join(tmp, 'x');
    fs.mkdirSync(unpacked);
    const r = await run(tar, ['-xf', file, '-C', unpacked]);
    if (r.code) throw new RuntimeError(`couldn't unpack ${archive.file}: ${r.out.trim().slice(-300)}`);
    const top = path.join(unpacked, archive.file.replace(/\.(tar\.xz|tar\.gz|zip)$/, ''));
    const from = nodeIn(top, platform);
    if (!isExecutable(from) && !(platform === 'win32' && fs.existsSync(from))) throw new RuntimeError(`${archive.file} has no node in it`);

    // Only node and its licence, in a folder of the final shape.
    const out = path.join(tmp, 'out');
    const to = nodeIn(out, platform);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    try { fs.renameSync(path.join(top, 'LICENSE'), path.join(out, 'LICENSE')); } catch { /* not in every archive */ }
    const v = await run(to, ['--version'], { timeout: 30000 });
    if (v.code || v.out.trim() !== `v${pins.version}`) throw new RuntimeError(`the downloaded Node doesn't run here (${v.out.trim().slice(-200) || `exit ${v.code}`})`);
    const nodeSha = crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex');
    fs.writeFileSync(path.join(out, MARK), JSON.stringify({ version: pins.version, archive: archive.file, archiveSha256: sha, nodeSha256: nodeSha, at: new Date().toISOString() }, null, 2) + '\n');

    const dest = path.join(root, runtimeName(key, pins));
    // (a half-made folder from before markers existed, or one someone emptied: replaced)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(out, dest);
    return { node: nodeIn(dest, platform), version: pins.version, fetched: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Remove runtimes other than the pinned one (an older pin, after setup has moved the wrappers and the
 * Safari agent onto the new one), and leftover temporary folders. Returns the names removed.
 */
function pruneRuntimes(home, { platform = process.platform, arch = process.arch, pins = PINS, keep = [] } = {}) {
  const key = platformKey(platform, arch, pins);
  const keepNames = new Set([...(Array.isArray(keep) ? keep : [keep]), key ? runtimeName(key, pins) : null].filter(Boolean));
  let names = [];
  try { names = fs.readdirSync(runtimeRoot(home)); } catch { return []; }
  const removed = [];
  for (const n of names) {
    if (keepNames.has(n) || !(/^node-v\d/.test(n) || n.startsWith('.fetch-'))) continue;
    // (Windows can't remove a node.exe that's running: that one goes at a later setup.)
    try { fs.rmSync(path.join(runtimeRoot(home), n), { recursive: true, force: true }); removed.push(n); } catch { /* in use */ }
  }
  return removed;
}

/** The runtime folders (node-v…) a file names, as a plist or wrapper does: kept by pruneRuntimes. */
function runtimesNamedIn(file) {
  let s = '';
  try { s = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return [...new Set(s.match(/node-v\d+\.\d+\.\d+-[a-z]+-[a-z0-9]+/g) || [])];
}

/**
 * Which pins setup uses, from TRIF_RUNTIME: unset, the real ones (helper/runtime.json); "off", none (setup
 * uses the node running it); a file, the pins in it (tests: a fake archive on a local server). Under the
 * test runner (NODE_TEST_CONTEXT) unset means off, so no test downloads the real runtime by accident.
 * Returns { pins, file } or { off: why }.
 */
function runtimeSetting(env = process.env) {
  const v = envVar('RUNTIME', env);
  if (v === undefined || v === '') return env.NODE_TEST_CONTEXT ? { off: 'under tests' } : { pins: PINS, file: null };
  if (v === 'off' || v === '0') return { off: `${envName('RUNTIME')}=${v}` };
  let pins;
  try { pins = JSON.parse(fs.readFileSync(v, 'utf8')); } catch (e) { throw new RuntimeError(`${envName('RUNTIME')} names ${v}, which isn't a pins file: ${e.message}`); }
  if (!pins || typeof pins.version !== 'string' || typeof pins.base !== 'string' || !pins.archives) throw new RuntimeError(`${v} isn't a pins file (version, base, archives)`);
  return { pins, file: path.resolve(v) };
}

/**
 * ensureRuntime for synchronous callers (setup): in a child node process, so setup stays synchronous.
 * Resolves to { node, version, fetched } or throws RuntimeError. timeoutMs bounds the whole download.
 */
function ensureRuntimeSync(home, { pinsFile = null, timeoutMs = 10 * 60 * 1000, env = process.env } = {}) {
  const r = spawnSync(process.execPath, [__filename, 'ensure', home, ...(pinsFile ? [pinsFile] : [])], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, NODE_TEST_CONTEXT: '' },
  });
  if (r.error && r.error.code === 'ETIMEDOUT') throw new RuntimeError(`the download took longer than ${Math.round(timeoutMs / 1000)} s`);
  let res = null;
  try { res = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { /* below */ }
  if (res && res.node) return res;
  throw new RuntimeError(res && res.error ? res.error : `the download stopped (${(r.stderr || '').trim().slice(-200) || (r.error ? r.error.message : `exit ${r.status}`)})`);
}

// `node runtime.js ensure <home> [pinsFile]`: ensureRuntimeSync's child. One JSON line on stdout.
if (require.main === module && process.argv[2] === 'ensure') {
  const [home, pinsFile] = process.argv.slice(3);
  let pins = PINS;
  try { if (pinsFile) pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8')); } catch (e) { pins = null; process.stdout.write(JSON.stringify({ error: `can't read ${pinsFile}: ${e.message}` }) + '\n'); process.exitCode = 1; }
  if (pins) ensureRuntime(home, { pins, archiveFile: envVar('RUNTIME_ARCHIVE') || null }).then(
    (r) => process.stdout.write(JSON.stringify(r) + '\n'),
    (e) => { process.stdout.write(JSON.stringify({ error: e.message }) + '\n'); process.exitCode = 1; },
  );
}

/** What the installed runtime folder says it was made from, or null. */
function runtimeInfo(home, opts = {}) {
  const node = installedNode(home, opts);
  if (!node) return null;
  const dir = (opts.platform || process.platform) === 'win32' ? path.dirname(node) : path.dirname(path.dirname(node));
  try { return { node, ...JSON.parse(fs.readFileSync(path.join(dir, MARK), 'utf8')) }; } catch { return null; }
}

/**
 * The runtime folder a node path lies in, { dir, name, version }, when it's <home>/runtime/node-v…/bin/node
 * (node.exe on Windows); else null (a system node).
 */
function runtimeOf(nodePath, home, { platform = process.platform } = {}) {
  if (!nodePath || !home) return null;
  const rel = path.relative(path.resolve(runtimeRoot(home)), path.resolve(nodePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const name = rel.split(/[\\/]/)[0];
  const m = name.match(/^node-v(\d+\.\d+\.\d+)-[a-z]+-[a-z0-9]+$/);
  if (!m) return null;
  const dir = path.join(runtimeRoot(home), name);
  if (path.resolve(nodeIn(dir, platform)) !== path.resolve(nodePath)) return null;
  return { dir, name, version: m[1] };
}

/**
 * For doctor: is the runtime a wrapper names whole and runnable? Reads its folder's mark, checks bin/node's
 * SHA-256 against what was recorded when it was unpacked, and runs `--version`. Returns null for a node
 * that isn't a TRIF runtime, else { dir, version, pinned (this build's pin), problem: null | string }.
 */
function checkRuntime(nodePath, home, { platform = process.platform, pins = PINS, runVersion = null } = {}) {
  const rt = runtimeOf(nodePath, home, { platform });
  if (!rt) return null;
  const out = { dir: rt.dir, version: rt.version, pinned: pins.version, problem: null };
  let mark = null;
  try { mark = JSON.parse(fs.readFileSync(path.join(rt.dir, MARK), 'utf8')); } catch { /* below */ }
  if (!mark || !mark.nodeSha256) { out.problem = `its record ${MARK} is missing`; return out; }
  let sha;
  try { sha = crypto.createHash('sha256').update(fs.readFileSync(nodePath)).digest('hex'); } catch (e) { out.problem = `its node can't be read (${e.code || e.message})`; return out; }
  if (sha !== mark.nodeSha256) { out.problem = 'its node has changed since it was downloaded'; return out; }
  const v = runVersion ? runVersion(nodePath) : String(spawnSync(nodePath, ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout || '').trim();
  if (v !== `v${rt.version}`) out.problem = `its node doesn't run (${v || 'no output'})`;
  return out;
}

module.exports = {
  runtimeOf, checkRuntime, MARK,
  PINS, RuntimeError, platformKey, runtimeRoot, runtimeName, nodeIn, installedNode, pickArchive, ensureRuntime, ensureRuntimeSync,
  pruneRuntimes, runtimesNamedIn, runtimeSetting, runtimeInfo,
};
