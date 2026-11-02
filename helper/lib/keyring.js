'use strict';
// API keys for hosted open models (agents/codex-oss.js), and for plain Claude Code and Codex runs
// (agentkeys.js: service "TRIF API key"), kept in the system keyring and nowhere else:
// not in config.json, not in an environment variable (a key exported in ~/.zshrc sits in the environment
// of every program started from a terminal, which any same-user process can read: macOS sysctl
// KERN_PROCARGS2, sandbox or not), not in the extension's storage.
//
// One item per hosted provider: service "TRIF open model key", account = the provider (`openrouter`, or
// `custom:<host>` for a custom server).
//
// macOS: the login Keychain, through /usr/bin/security.
//   read    security find-generic-password -s <service> -a <account> -w   (the key on stdout, to the helper)
//   check   the same without -w (attributes only: the key isn't decrypted)
//   write   security -i, with `add-generic-password -U -s … -a … -l … -X <key as hex>` on its STDIN, so the
//           key is in no process's argv (any same-user process can list those); hex, so no quoting.
//   delete  security delete-generic-password -s … -a …
// An item /usr/bin/security creates lists /usr/bin/security as allowed to read it, so reads don't ask.
// Linux: the Secret Service (GNOME Keyring, KWallet, KeePassXC…) through libsecret's `secret-tool`
// (`store` reads the key from stdin). No secret-tool: hosted open models can't be used (no file or
// environment fallback).
//
// TRIF_KEYCHAIN_BIN (tests): a stand-in for /usr/bin/security, or for secret-tool when its name says so.
// Nothing here logs, returns in an error, or puts in an argv the key itself.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { envVar } = require('./env');

const SERVICE = 'TRIF open model key';
// What a key may look like: API keys are [A-Za-z0-9_-]; a few more URL-safe characters are allowed, but
// no quotes, backslashes or spaces (it travels as hex or on stdin anyway, and must stay findable for
// redaction inside JSON, where a quote or backslash would be escaped). 8+ characters: redaction's minimum.
const KEY_RE = /^[A-Za-z0-9._~+/=:@%-]{8,4096}$/;
const ACCOUNT_RE = /^[A-Za-z0-9._:[\]-]{1,200}$/;
const NOT_FOUND = 44; // security's exit status for "The specified item could not be found"

const MAC_NAME = 'your Mac’s Keychain';
const LINUX_NAME = 'your keyring (Secret Service)';

/** Where keys go: {kind: 'security'|'secret-tool', bin, name} or null (no keyring). */
function backend({ env = process.env, platform = process.platform } = {}) {
  const forced = envVar('KEYCHAIN_BIN', env);
  if (forced) {
    if (!path.isAbsolute(forced)) return null;
    return /secret-tool/.test(path.basename(forced)) ? { kind: 'secret-tool', bin: forced, name: LINUX_NAME } : { kind: 'security', bin: forced, name: MAC_NAME };
  }
  if (platform === 'darwin') return { kind: 'security', bin: '/usr/bin/security', name: MAC_NAME };
  if (platform === 'linux') {
    for (const d of ['/usr/bin', '/usr/local/bin', '/bin']) {
      const f = path.join(d, 'secret-tool');
      try { fs.accessSync(f, fs.constants.X_OK); return { kind: 'secret-tool', bin: f, name: LINUX_NAME }; } catch { /* next */ }
    }
  }
  return null;
}

/** Why there's no keyring, in the user's terms. */
function noKeyring({ platform = process.platform, what = 'hosted open models need' } = {}) {
  return platform === 'linux'
    ? `${what} a keyring to keep the API key in: install libsecret's secret-tool (e.g. \`sudo apt install libsecret-tools\`) and a Secret Service such as GNOME Keyring or KeePassXC`
    : `${what} a system keyring to keep the API key in (the macOS Keychain, or a Secret Service on Linux)`;
}

/** Why `key` can't be stored ('' when it can). Never quotes the key. */
function keyProblem(key) {
  if (typeof key !== 'string' || !key.trim()) return 'no key given';
  if (!KEY_RE.test(key.trim())) return 'that doesn\'t look like an API key: it should be one line of letters, digits, - and _ (a few other symbols are fine: . ~ + / = : @ %), no spaces, 8 to 4096 characters';
  return '';
}

function checkAccount(account) {
  if (typeof account !== 'string' || !ACCOUNT_RE.test(account)) throw new Error('bad keyring account name');
}

// Runs the keyring tool: {code, stdout, stderr}; `input` goes to its stdin. Never rejects.
function run(bin, args, { input = null, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    // (A keyring that asks the user, e.g. a locked Keychain's password dialog, gets time to be answered.)
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ code: null, stdout: '', stderr: `no answer within ${Math.round(timeout / 1000)} s` }); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < 1 << 16) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1 << 16) stderr += d; });
    child.on('error', (e) => finish({ code: null, stdout: '', stderr: e.message }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
    child.stdin.on('error', () => { /* it may exit before reading */ });
    child.stdin.end(input === null ? undefined : input);
  });
}

// The tool's complaint, short, with any secret cut out (they don't echo their input, but just in case).
function complaint(r, secrets = []) {
  let s = String(r.stderr || '').trim().split('\n').filter(Boolean).pop() || (r.code === null ? 'couldn\'t run it' : `exit status ${r.code}`);
  for (const v of secrets) if (v) s = s.split(v).join('[redacted]');
  return s.slice(0, 300);
}

const LOOKUP = (kind, account, service) => (kind === 'security'
  ? ['find-generic-password', '-s', service, '-a', account]
  : ['lookup', 'service', service, 'account', account]);

/** The stored key: {value, error}; value null when there's none (error says why, if something failed). */
async function getKey(account, { service = SERVICE, ...opts } = {}) {
  checkAccount(account);
  const b = backend(opts);
  if (!b) return { value: null, error: noKeyring(opts) };
  const args = LOOKUP(b.kind, account, service);
  if (b.kind === 'security') args.push('-w');
  const r = await run(b.bin, args, opts);
  const value = r.stdout.replace(/\r?\n$/, '');
  if (r.code === 0 && value) return { value, error: null };
  if (b.kind === 'security' ? r.code === NOT_FOUND : r.code === 1 && !r.stderr.trim()) return { value: null, error: null };
  return { value: null, error: `couldn't read the key from ${b.name}: ${complaint(r)}` };
}

/** Whether a key is stored: {stored, error}. (macOS: without decrypting it.) */
async function hasKey(account, { service = SERVICE, ...opts } = {}) {
  checkAccount(account);
  const b = backend(opts);
  if (!b) return { stored: false, error: noKeyring(opts) };
  if (b.kind === 'secret-tool') { const k = await getKey(account, { service, ...opts }); return { stored: !!k.value, error: k.error }; }
  const r = await run(b.bin, LOOKUP(b.kind, account, service), opts);
  if (r.code === 0) return { stored: true, error: null };
  if (r.code === NOT_FOUND) return { stored: false, error: null };
  return { stored: false, error: `couldn't check ${b.name}: ${complaint(r)}` };
}

/** Store (or replace) the key. Throws a user-facing Error that never contains it. */
async function setKey(account, key, { service = SERVICE, ...opts } = {}) {
  checkAccount(account);
  const problem = keyProblem(key);
  if (problem) throw new Error(problem);
  const k = key.trim();
  const b = backend(opts);
  if (!b) throw new Error(noKeyring(opts));
  const label = `${service} (${account})`;
  let r;
  const hex = Buffer.from(k, 'utf8').toString('hex');
  if (b.kind === 'security') {
    // On stdin, never in argv. Every value is ours: the service and label have no quotes or backslashes,
    // the account matches ACCOUNT_RE, the key is hex.
    r = await run(b.bin, ['-i'], { ...opts, input: `add-generic-password -U -s "${service}" -a "${account}" -l "${label}" -X ${hex}\n` });
  } else {
    r = await run(b.bin, ['store', `--label=${label}`, 'service', service, 'account', account], { ...opts, input: k });
  }
  if (r.code !== 0) throw new Error(`couldn't save the key in ${b.name}: ${complaint(r, [k, hex])}`);
  const check = await hasKey(account, { service, ...opts });
  if (!check.stored) throw new Error(`couldn't save the key in ${b.name}: ${check.error || 'it isn\'t there afterwards'}`);
}

/** Remove the key: resolves {removed} (false: there was none). Throws on failure. */
async function removeKey(account, { service = SERVICE, ...opts } = {}) {
  checkAccount(account);
  const b = backend(opts);
  if (!b) throw new Error(noKeyring(opts));
  if (b.kind === 'secret-tool') {
    const had = await hasKey(account, { service, ...opts });
    const r = await run(b.bin, ['clear', 'service', service, 'account', account], opts);
    if (r.code !== 0 && had.stored) throw new Error(`couldn't remove the key from ${b.name}: ${complaint(r)}`);
    return { removed: had.stored };
  }
  const r = await run(b.bin, ['delete-generic-password', '-s', service, '-a', account], opts);
  if (r.code === 0) return { removed: true };
  if (r.code === NOT_FOUND) return { removed: false };
  throw new Error(`couldn't remove the key from ${b.name}: ${complaint(r)}`);
}

module.exports = { SERVICE, backend, noKeyring, keyProblem, getKey, hasKey, setKey, removeKey, KEY_RE, ACCOUNT_RE };
