'use strict';
// Shared helpers for the e2e suite: processes, waiting, and the results report.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns something truthy (returned), or throws after `timeoutMs` with `what`. */
async function waitFor(what, fn, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  let lastErr;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) { lastErr = e; }
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${lastErr ? ` (last error: ${lastErr.message})` : ''}${last !== undefined && last !== null && last !== false ? ` (last: ${JSON.stringify(last)})` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Runs a command to completion: {status, stdout, stderr}. */
function run(cmd, args, { env, cwd, timeoutMs = 120000, input } = {}) {
  const r = spawnSync(cmd, args, { env, cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', input, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

/** Runs a command asynchronously (so the event loop keeps going): {status, stdout, stderr}. */
function runAsync(cmd, args, { env, cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ status: null, stdout, stderr: stderr + e.message, error: e }); });
  });
}

/** Pids of processes whose command line contains `needle` (never this process). */
function pidsMatching(needle) {
  const r = run('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  const procs = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }; })
    .filter(Boolean);
  // Never this process or its ancestors (the shell that started the suite has the work dir in its command line).
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const mine = new Set();
  for (let p = process.pid; p && !mine.has(p); p = byPid.get(p)?.ppid) mine.add(p);
  return procs.filter((p) => !mine.has(p.pid) && p.command.includes(needle));
}

/** SIGTERM, then SIGKILL, every process whose command line contains `needle` (a path only our processes use). */
async function killMatching(needle) {
  let procs = pidsMatching(needle);
  for (const p of procs) { try { process.kill(p.pid, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 20 && procs.length; i++) {
    await sleep(250);
    procs = pidsMatching(needle);
  }
  for (const p of procs) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  return procs.length;
}

// ---- results

class Results {
  constructor(dir) {
    this.dir = dir;
    this.items = [];
    this.notes = [];
    this.group = '';
    fs.mkdirSync(dir, { recursive: true });
    this.logFile = path.join(dir, 'log.txt');
  }

  setGroup(name) {
    this.group = name;
    this.log(`\n=== ${name}`);
  }

  log(line) {
    fs.appendFileSync(this.logFile, line + '\n');
    if (process.env.TRIF_E2E_VERBOSE) console.log(line);
  }

  /** Records a check: status 'pass' | 'fail' | 'warn' | 'skip'. */
  record(name, status, detail = '') {
    const item = { group: this.group, name, status, detail: String(detail || '') };
    this.items.push(item);
    const mark = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP' }[status] || status;
    const line = `  ${mark.padEnd(4)} ${name}${item.detail ? ` — ${item.detail.split('\n')[0]}` : ''}`;
    console.log(line);
    this.log(line + (item.detail.includes('\n') ? `\n${item.detail.replace(/^/gm, '        ')}` : ''));
    return status === 'pass';
  }

  /** Runs `fn` as a check: passes when it returns (a string return is the detail), fails when it throws. */
  async check(name, fn) {
    // (TRIF_E2E_SKIP, a regular expression: checks whose names match are skipped, to try one change faster;
    // never for a run that counts)
    if (process.env.TRIF_E2E_SKIP && new RegExp(process.env.TRIF_E2E_SKIP).test(name)) return this.record(name, 'skip', 'TRIF_E2E_SKIP');
    const t = Date.now();
    try {
      const r = await fn();
      if (r && typeof r === 'object' && r.status) return this.record(name, r.status, r.detail);
      return this.record(name, 'pass', `${typeof r === 'string' ? r + ' ' : ''}(${((Date.now() - t) / 1000).toFixed(1)} s)`);
    } catch (e) {
      return this.record(name, 'fail', e && e.stack && process.env.TRIF_E2E_VERBOSE ? e.stack : (e && e.message) || String(e));
    }
  }

  note(text) {
    this.notes.push({ group: this.group, text });
    this.log(`  note: ${text}`);
  }

  file(name) { return path.join(this.dir, name); }

  summary() {
    const count = (s) => this.items.filter((i) => i.status === s).length;
    const lines = ['', '==== TRIF e2e summary', `results: ${this.dir}`];
    let group = null;
    for (const i of this.items) {
      if (i.group !== group) { group = i.group; lines.push(`[${group}]`); }
      lines.push(`  ${i.status.toUpperCase().padEnd(4)} ${i.name}${i.status !== 'pass' && i.detail ? ` — ${i.detail.split('\n')[0]}` : ''}`);
    }
    if (this.notes.length) {
      lines.push('notes:');
      for (const n of this.notes) lines.push(`  [${n.group}] ${n.text}`);
    }
    lines.push(`${count('pass')} passed, ${count('fail')} failed, ${count('warn')} warnings, ${count('skip')} skipped`);
    const text = lines.join('\n');
    fs.writeFileSync(path.join(this.dir, 'summary.txt'), text + '\n');
    fs.writeFileSync(path.join(this.dir, 'results.json'), JSON.stringify({ items: this.items, notes: this.notes }, null, 2) + '\n');
    return { text, failed: count('fail') };
  }
}

module.exports = { sleep, waitFor, freePort, run, runAsync, pidsMatching, killMatching, Results };
