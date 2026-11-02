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

module.exports = { isExecutableFile, findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync, capture, redactSecrets };
