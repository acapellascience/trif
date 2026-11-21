'use strict';
// TRIF's own Claude Code for runs in TRIF's full sandbox (docs/WHOLE-BOX.md, WHOLE-BOX-PROGRESS.md step 1):
// a pinned, tested version, kept in <home>/runtime/claude-code-<ver>-<platform>/, never the user's own
// Claude Code (which keeps updating as usual; TRIF never touches it). The box's profile lists what Claude
// Code needs to start, so a new release can fail closed in it; runs use the version the box tests passed
// on, and moving the pin is a release step after they pass on the new one (`node claudepin.js pin <ver>`).
//
// Where from: the npm registry's per-platform package (@anthropic-ai/claude-code-<platform>, which the
// `@anthropic-ai/claude-code` package installs as an optional dependency): one native binary in it. Its
// sha512 (npm's `integrity`) is pinned in helper/claude-code.json, which ships inside the signed package,
// so the update feed's signature covers it too. Only the binary (and its licence) is kept; on macOS its
// code signature must also be Anthropic's (Developer ID team in the pins). A folder is complete or
// absent: it's unpacked beside it and renamed into place. Inside the workspace folder (readable to runs,
// as the binary must be), never the private one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { envVar, envName } = require('./env');

const PIN_FILE = path.join(__dirname, '..', 'claude-code.json');
const MARK = '.trif-claude-code.json';
const TARBALL_MAX = 400 * 1024 * 1024; // darwin-arm64 2.1.330 is 164 MB
const REGISTRY = 'https://registry.npmjs.org/';
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'];

class PinError extends Error {}

function readPins(file = PIN_FILE) {
  const pins = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pins || typeof pins.version !== 'string' || !pins.packages || typeof pins.packages !== 'object') throw new PinError(`${file} isn't a Claude Code pin file (version, packages)`);
  return pins;
}

/** The pins in use: TRIF_CLAUDE_CODE_PIN names another file (tests: fake tarballs on a local server). */
function pinsInUse(env = process.env) {
  const v = envVar('CLAUDE_CODE_PIN', env);
  if (!v) return readPins();
  try { return readPins(v); } catch (e) { throw new PinError(`${envName('CLAUDE_CODE_PIN')} names ${v}, which isn't a pin file: ${e.message}`); }
}

/** 'darwin-arm64', 'win32-x64'…, as npm names the platform packages; null when the pins have none for it. */
function platformKey(platform = process.platform, arch = process.arch, pins = null) {
  const key = `${platform}-${arch}`;
  return !pins || (pins.packages && pins.packages[key]) ? key : null;
}

function root(home) { return path.join(home, 'runtime'); }
function dirName(key, pins) { return `claude-code-${pins.version}-${key}`; }
function binName(platform = process.platform) { return platform === 'win32' ? 'claude.exe' : 'claude'; }

function isFile(p) { try { return fs.lstatSync(p).isFile(); } catch { return false; } }

/** The pinned Claude Code in <home>/runtime, or null when it isn't installed (or this platform has none). */
function installedPinned(home, { platform = process.platform, arch = process.arch, pins = null, env = process.env } = {}) {
  pins = pins || pinsInUse(env);
  const key = platformKey(platform, arch, pins);
  if (!key) return null;
  const dir = path.join(root(home), dirName(key, pins));
  const bin = path.join(dir, binName(platform));
  return isFile(bin) && isFile(path.join(dir, MARK)) ? { bin, dir, version: pins.version, key } : null;
}

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 1024 * 1024, timeout: 60000, ...opts }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

function allowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
}

/**
 * GET `url` into `file`, streamed (the tarball is large), hashing as it goes. Resolves the sha512 as npm
 * writes it ("sha512-<base64>"). https only (http to this computer: tests), at most maxBytes.
 */
function download(url, file, { maxBytes = TARBALL_MAX, timeoutMs = 120000, redirects = 5, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!allowedUrl(url)) return reject(new PinError(`refusing to download ${url} (https only)`));
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': 'trif' }, timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new PinError(`too many redirects fetching ${url}`));
        return resolve(download(new URL(res.headers.location, url).href, file, { maxBytes, timeoutMs, redirects: redirects - 1, onProgress }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new PinError(`${url} answered HTTP ${res.statusCode}`)); }
      const hash = crypto.createHash('sha512');
      const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
      let size = 0;
      let failed = false;
      // (progress: bytes so far, and the size the server says, if it says one; at most every 256 KB)
      const total = Number(res.headers['content-length']) || 0;
      let told = 0;
      const tell = (force) => { if (onProgress && (force || size - told >= 262144)) { told = size; try { onProgress(size, total); } catch { /* a listener's problem */ } } };
      const fail = (e) => { if (failed) return; failed = true; req.destroy(); out.destroy(); reject(e); };
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) return fail(new PinError(`${url} is larger than ${maxBytes} bytes`));
        hash.update(c);
        tell(false);
      });
      res.on('error', (e) => fail(new PinError(`couldn't download ${url}: ${e.message}`)));
      res.on('aborted', () => fail(new PinError(`the download of ${url} stopped part way`)));
      out.on('error', (e) => fail(new PinError(`couldn't save ${url}: ${e.message}`)));
      out.on('finish', () => { if (!failed) { tell(true); resolve(`sha512-${hash.digest('base64')}`); } });
      res.pipe(out);
    });
    req.on('timeout', () => req.destroy(new PinError(`timed out fetching ${url}`)));
    req.on('error', (e) => reject(e instanceof PinError ? e : new PinError(`couldn't fetch ${url}: ${e.message}`)));
  });
}

/** macOS: is `bin` signed (valid, strict) by the Developer ID team `team`? Resolves null, or what's wrong. */
async function checkSignature(bin, team) {
  const v = await run('/usr/bin/codesign', ['--verify', '--strict', bin]);
  if (v.code) return `its code signature isn't valid (${v.out.trim().slice(-200) || `exit ${v.code}`})`;
  const d = await run('/usr/bin/codesign', ['-dv', bin]);
  const m = /^TeamIdentifier=(\S+)$/m.exec(d.out);
  if (!m || m[1] !== team) return `it isn't signed by Anthropic (team ${m ? m[1] : 'none'}, expected ${team})`;
  return null;
}

// Windows: Authenticode, read by Windows PowerShell's Get-AuthenticodeSignature (the file's path in the
// environment, not in the script). Its two lines: the status ("Valid" only when the chain and the file's
// hash check out) and the signer's subject, whose CN and O must both be `signer` ("Anthropic, PBC", seen on
// windows-latest for 2.1.330: DigiCert's code-signing CA).
const WIN_SIG_SCRIPT = '$s = Get-AuthenticodeSignature -LiteralPath $env:TRIF_SIGNED_FILE; [Console]::Out.WriteLine([string]$s.Status); [Console]::Out.WriteLine([string]$s.SignerCertificate.Subject)';

/** What's wrong with Get-AuthenticodeSignature's two lines for `signer`, or null. (Pure: tests.) */
function winSignatureProblem(out, signer) {
  const [status = '', subject = ''] = String(out || '').split(/\r?\n/).map((l) => l.trim());
  if (status !== 'Valid') return `its code signature isn't valid (${status || 'no answer'})`;
  const q = signer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (k) => new RegExp(`(^|, )${k}=(?:"${q}"|${q})(,|$)`).test(subject);
  if (!has('CN') || !has('O')) return `it isn't signed by ${signer} (${subject.slice(0, 120) || 'no signer'})`;
  return null;
}

async function checkSignatureWin(bin, signer) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // (no PSModulePath: one PowerShell 7 set, as a pwsh parent does, makes Windows PowerShell load 7's
  // Microsoft.PowerShell.Security, which fails, and the signature reads as nothing: seen on windows-latest)
  const env = { ...process.env, TRIF_SIGNED_FILE: bin };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PSMODULEPATH') delete env[k];
  const r = await new Promise((resolve) => {
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', WIN_SIG_SCRIPT], { env, timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
  if (r.code) return `its code signature couldn't be read (exit ${r.code}: ${r.stderr.trim().slice(0, 200)})`;
  const bad = winSignatureProblem(r.stdout, signer);
  return bad && r.stderr.trim() ? `${bad}; PowerShell said: ${r.stderr.trim().replace(/\s+/g, ' ').slice(0, 200)}` : bad;
}

const inFlight = new Map(); // dest folder -> { promise, listeners }: one download at a time per pin

/**
 * Make sure the pinned Claude Code is in <home>/runtime, downloading it if not. Resolves
 * { bin, dir, version, key, fetched }; throws PinError, leaving nothing behind, when this platform has no
 * pin, the download fails, its checksum isn't the pinned one, it has no binary, or (macOS, Windows) the
 * binary isn't Anthropic's. `onProgress(bytes, total)` (total 0 if unknown) as the tarball comes in: every caller's,
 * the one download shared (the setting's background download and a run's check may ask at once).
 */
function ensurePinned(home, opts = {}) {
  const pins = opts.pins || pinsInUse(opts.env || process.env);
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const key = platformKey(platform, arch, pins);
  if (!key) return Promise.reject(new PinError(`TRIF has no pinned Claude Code for ${platform}-${arch}`));
  const dest = path.join(root(home), dirName(key, pins));
  let job = inFlight.get(dest);
  if (!job) {
    const listeners = new Set();
    const onProgress = (got, total) => { for (const f of listeners) { try { f(got, total); } catch { /* a listener's problem */ } } };
    job = { listeners, promise: null };
    job.promise = ensureOnce(home, { ...opts, pins, platform, arch, key, dest, onProgress }).finally(() => inFlight.delete(dest));
    inFlight.set(dest, job);
  }
  if (typeof opts.onProgress === 'function') job.listeners.add(opts.onProgress);
  return job.promise;
}

/** Is the pinned Claude Code for `home` being downloaded now? */
function pinning(home, { platform = process.platform, arch = process.arch, pins = null, env = process.env } = {}) {
  pins = pins || pinsInUse(env);
  const key = platformKey(platform, arch, pins);
  return !!key && inFlight.has(path.join(root(home), dirName(key, pins)));
}

// (on Windows, the system's own tar.exe (bsdtar, in every Windows 10 1803+ and 11) by its full path: a `tar`
// earlier on PATH, such as Git's GNU tar, reads C:\… as a remote host)
const systemTar = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');

async function ensureOnce(home, { pins, platform, arch, key, dest, tar = systemTar(), onProgress = null }) {
  const have = installedPinned(home, { platform, arch, pins });
  if (have) return { ...have, fetched: false };
  const pkg = pins.packages[key];
  if (!pkg || typeof pkg.tarball !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(pkg.integrity || '')) throw new PinError(`the pin for ${key} has no tarball or sha512`);
  const binIn = `package/${pkg.bin || binName(platform)}`;

  fs.mkdirSync(root(home), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root(home), '.claude-fetch-'));
  try {
    const file = path.join(tmp, 'pkg.tgz');
    const got = await download(pkg.tarball, file, { onProgress });
    if (got !== pkg.integrity) throw new PinError(`the download of Claude Code ${pins.version} (${key}) doesn't match its pinned checksum; not using it`);
    const unpacked = path.join(tmp, 'x');
    fs.mkdirSync(unpacked);
    // Only the binary (and the licence, if there), by name: nothing else in the tarball is written.
    const r = await run(tar, ['-xzf', file, '-C', unpacked, binIn], { timeout: 300000 });
    if (r.code) throw new PinError(`couldn't unpack Claude Code ${pins.version}: ${r.out.trim().slice(-300)}`);
    await run(tar, ['-xzf', file, '-C', unpacked, 'package/LICENSE.md'], { timeout: 300000 });
    const from = path.join(unpacked, binIn);
    // (a link or anything but a plain file, however the tarball made it, is refused)
    if (!isFile(from)) throw new PinError(`the Claude Code ${pins.version} package has no program in it`);
    if (platform === 'darwin' && pins.macTeam) {
      const bad = await checkSignature(from, pins.macTeam);
      if (bad) throw new PinError(`not using the downloaded Claude Code ${pins.version}: ${bad}`);
    }
    if (platform === 'win32' && pins.winSigner) {
      const bad = await checkSignatureWin(from, pins.winSigner);
      if (bad) throw new PinError(`not using the downloaded Claude Code ${pins.version}: ${bad}`);
    }
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    const to = path.join(out, binName(platform));
    fs.renameSync(from, to);
    fs.chmodSync(to, 0o755);
    const lic = path.join(unpacked, 'package', 'LICENSE.md');
    if (isFile(lic)) fs.renameSync(lic, path.join(out, 'LICENSE.md'));
    const binSha256 = crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex');
    fs.writeFileSync(path.join(out, MARK), JSON.stringify({ version: pins.version, key, integrity: pkg.integrity, binSha256, at: new Date().toISOString() }, null, 2) + '\n');
    // (a half-made folder someone left, or emptied: replaced)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(out, dest);
    return { bin: path.join(dest, binName(platform)), dir: dest, version: pins.version, key, fetched: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
  });
}

// (the binary is 364 MB, 0.4 s to hash: streamed, so the helper isn't held up, and once per helper, then
// again only when it's a different file or has changed: its inode, size and change time, which no one
// can set back)
const verified = new Map(); // bin -> stamp + recorded sha
const stamp = (st) => `${st.dev}:${st.ino}:${st.size}:${st.ctimeMs}`;

/**
 * Is the installed pinned binary the one that was unpacked (its SHA-256 against the record)? Resolves
 * null when it isn't installed, else { bin, version, problem: null | string }. Before each boxed run.
 */
async function checkPinned(home, opts = {}) {
  const have = installedPinned(home, opts);
  if (!have) return null;
  const out = { bin: have.bin, version: have.version, problem: null };
  let mark = null;
  try { mark = JSON.parse(fs.readFileSync(path.join(have.dir, MARK), 'utf8')); } catch { /* below */ }
  if (!mark || !mark.binSha256) { out.problem = `its record ${MARK} is missing`; return out; }
  let st;
  try { st = fs.statSync(have.bin); } catch (e) { out.problem = `it can't be read (${e.code || e.message})`; return out; }
  if (verified.get(have.bin) === stamp(st) + mark.binSha256) return out;
  let sha;
  try { sha = await sha256File(have.bin); } catch (e) { out.problem = `it can't be read (${e.code || e.message})`; return out; }
  if (sha !== mark.binSha256) { verified.delete(have.bin); out.problem = 'it has changed since it was downloaded'; return out; }
  verified.set(have.bin, stamp(st) + mark.binSha256);
  return out;
}

/** Remove pinned Claude Codes other than this pin's (an older pin), and leftover downloads. Returns the names removed. */
function prunePinned(home, { platform = process.platform, arch = process.arch, pins = null, env = process.env } = {}) {
  pins = pins || pinsInUse(env);
  const key = platformKey(platform, arch, pins);
  const keep = key ? dirName(key, pins) : null;
  let names = [];
  try { names = fs.readdirSync(root(home)); } catch { return []; }
  const removed = [];
  for (const n of names) {
    if (n === keep || !(/^claude-code-\d/.test(n) || n.startsWith('.claude-fetch-'))) continue;
    try { fs.rmSync(path.join(root(home), n), { recursive: true, force: true }); removed.push(n); } catch { /* in use (Windows) */ }
  }
  return removed;
}

// ------------------------------------------------------------------ the release step: moving the pin

function getJson(url) {
  return require('./update').fetchUrl(url, { maxBytes: 8 * 1024 * 1024 }).then((b) => JSON.parse(b.toString('utf8')));
}

/**
 * The pin file's content for Claude Code `version`, from the registry: each platform package's tarball and
 * integrity, checked against the main package's optionalDependencies (all the same version). Release step,
 * after the box tests pass on that version.
 */
async function makePins(version, { registry = REGISTRY, platforms = PLATFORMS, macTeam = 'Q6L2SF6YDW', winSigner = 'Anthropic, PBC', get = getJson } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new PinError(`${version} isn't a Claude Code version (x.y.z)`);
  const main = await get(`${registry}@anthropic-ai%2fclaude-code/${version}`);
  const deps = main.optionalDependencies || {};
  const packages = {};
  for (const key of platforms) {
    const name = `@anthropic-ai/claude-code-${key}`;
    if (deps[name] !== version) throw new PinError(`Claude Code ${version} doesn't list ${name}@${version} (it has ${deps[name] || 'none'})`);
    const meta = await get(`${registry}${name.replace('/', '%2f')}/${version}`);
    const dist = meta.dist || {};
    if (meta.version !== version || !/^sha512-/.test(dist.integrity || '') || !/^https:\/\//.test(dist.tarball || '')) throw new PinError(`${name}@${version} has no tarball or sha512 in the registry`);
    // (the binary is package/claude, package/claude.exe on Windows: binName; a pin may name another with `bin`)
    packages[key] = { name, tarball: dist.tarball, integrity: dist.integrity };
  }
  return {
    _: "TRIF's own Claude Code for runs in TRIF's full sandbox (lib/claudepin.js). From the npm registry; moved by `node helper/lib/claudepin.js pin <version>` after the box tests pass on it, never by hand.",
    version, macTeam, winSigner, packages,
  };
}

if (require.main === module && process.argv[2] === 'pin') {
  const version = process.argv[3];
  const outFile = process.argv[4] || PIN_FILE;
  makePins(version, { registry: process.env.TRIF_NPM_REGISTRY || REGISTRY }).then((pins) => {
    fs.writeFileSync(outFile, JSON.stringify(pins, null, 2) + '\n');
    process.stdout.write(`pinned Claude Code ${version} in ${outFile}\n`);
  }, (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}

// `node claudepin.js ensure <home>`: install the pinned one (CI, and the setting's background download).
if (require.main === module && process.argv[2] === 'ensure') {
  ensurePinned(process.argv[3]).then((r) => process.stdout.write(JSON.stringify(r) + '\n'),
    (e) => { process.stdout.write(JSON.stringify({ error: e.message }) + '\n'); process.exitCode = 1; });
}

module.exports = {
  PIN_FILE, MARK, PLATFORMS, PinError, readPins, pinsInUse, platformKey, root, dirName, binName,
  installedPinned, ensurePinned, pinning, checkPinned, prunePinned, makePins, download, checkSignature, winSignatureProblem,
};
