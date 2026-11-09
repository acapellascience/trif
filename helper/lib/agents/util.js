'use strict';
// Small helpers shared by the agent adapters: finding executables, asking for versions, summaries.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function isExecutableFile(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

// First `name` found in `dirs` (absolute directories, in order), or null.
function findExecutable(name, dirs) {
  for (const d of dirs) {
    if (!d || !path.isAbsolute(d)) continue;
    const p = path.join(d, name);
    if (isExecutableFile(p)) return p;
  }
  return null;
}

// `<file> --version`, cached by path + mtime so agent.list stays cheap. Never throws.
const versionCache = new Map();
function versionOf(file, env, args = ['--version']) {
  let key = file;
  try { key += ':' + fs.statSync(fs.realpathSync(file)).mtimeMs; } catch { /* ignore */ }
  if (versionCache.has(key)) return versionCache.get(key);
  let version = null;
  try {
    const r = spawnSync(file, args, { env, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
    const text = String(r.stdout || '').trim().split('\n')[0] || '';
    const m = /\d+\.\d+(?:\.\d+)?(?:[-+.\w]*)?/.exec(text);
    version = m ? m[0] : (text || null);
  } catch { /* ignore */ }
  versionCache.set(key, version);
  return version;
}

// Path relative to the workspace when it's inside it, else as given.
function relToWorkspace(p, workspace) {
  if (typeof p !== 'string' || !p) return '';
  if (!workspace || !path.isAbsolute(p)) return p;
  const rel = path.relative(workspace, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

function oneLine(s, max = 300) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function parseJsonLine(line) {
  const t = String(line).trim();
  if (!t || t[0] !== '{') return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

// Run a short command (stdin closed) and collect {status, error, stdout, stderr}. Never throws.
function captureSync(file, args, { env, cwd, timeout = 10000 } = {}) {
  try {
    const r = spawnSync(file, args, { env, cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: r.status, error: r.error || null, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
  } catch (e) {
    return { status: null, error: e, stdout: '', stderr: '' };
  }
}

// The same without blocking the helper (agent.list asks for login status often). Never rejects.
function capture(file, args, { env, cwd, timeout = 10000, maxBytes = 65536 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let error = null;
    let settled = false;
    let timer = null;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: error ? null : status, error, stdout, stderr });
    };
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ status: null, error: e, stdout, stderr });
      return;
    }
    timer = setTimeout(() => { error = new Error(`timed out after ${timeout}ms`); try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < maxBytes) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 65536) stderr += d; });
    child.on('error', (e) => { error = error || e; if (child.pid === undefined) finish(null); }); // couldn't start
    child.on('close', (code) => finish(code));
  });
}

/** `text` with every occurrence of each secret (8+ characters) replaced by [redacted]. */
function redactSecrets(text, secrets) {
  let s = String(text ?? '');
  for (const v of secrets || []) if (typeof v === 'string' && v.length >= 8) s = s.split(v).join('[redacted]');
  return s;
}

// What an agent says when a run fails because its login is gone, expired or refused: such a run shows
// as "log in again" (loginError) rather than as the agent's raw error. The wordings are Claude Code
// 2.1.319's and Codex 0.166's own (read from their binaries), plus the APIs' (Anthropic's
// `authentication_error`, HTTP 401). Only checked on a run that failed, never on a reply that worked.
// Not "could not be refreshed" on its own: Claude Code also says that when another of its processes
// holds the refresh lock or the disk is full, which logging in again doesn't fix.
const LOGIN_FAILURES = [
  /not logged in/i,                                     // Claude Code "Not logged in · Please run /login"; Codex
  /\brun \/login\b/i,                                    // Claude Code "Login expired · Please run /login", "OAuth token revoked · …"
  /OAuth session expired/i,                             // Claude Code "Failed to authenticate: OAuth session expired and could not be refreshed"
  /OAuth token (has been )?revoked/i,                   // Claude Code "Failed to authenticate: OAuth token revoked. Please log in again…"
  /login reached its time limit/i,                      // Claude Code (the login's own lifetime is over)
  /invalid api key/i,                                   // Claude Code "API Error: 401 Invalid API key · Please run /login"
  /\bauthentication_error\b/,                            // Anthropic API error type
  /\b(api error|status|http)\W{0,3}401\b|unauthori[sz]ed/i, // HTTP 401
  /\bsign in again\b/i,                                  // Codex "Your access token could not be refreshed… Please log out and sign in again."; Claude Code "Authentication required · Sign in again to continue"
  /please (run )?`?codex login/i,                       // Codex
  /missing (api key|credentials)/i,                     // Codex
];

function isLoginFailure(text) {
  const t = String(text ?? '');
  return !!t && LOGIN_FAILURES.some((re) => re.test(t));
}

/** The error event for a run that failed for want of a login. `reason: 'login'` lets runs.js and the panel tell it apart. */
function loginError(name) {
  return { kind: 'error', reason: 'login', message: `${name} needs you to log in again.` };
}

module.exports = { isExecutableFile, findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync, capture, redactSecrets,
  LOGIN_FAILURES, isLoginFailure, loginError };
