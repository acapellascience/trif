'use strict';
// The lock on installing into <home>/app. Several processes may install at once: each browser's helper
// (automatic updates), `trif update --install` and `trif setup`. Without a lock between them one
// could clear away another's half-made copy, or swap folders under it, and leave <home>/app half gone.
//
// The lock is <home>/.app.lock, created with O_EXCL so only one process can make it, holding the owner's
// pid and a random token. A lock whose pid has died (a crash, a killed helper) is stale and taken over;
// so is one older than LOCK_MAX_AGE_MS, in case the pid has since been reused. An update runs the new
// version's setup as a child process, which installs while its parent holds the lock: the parent passes
// its token down in TRIF_INSTALL_LOCK, and a process with the holder's token counts as holding it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { envVar } = require('./env');

const LOCK_MAX_AGE_MS = 15 * 60 * 1000; // an install takes a couple of minutes at most
const LOCK_FRESH_MS = 10 * 1000; // a lock file still being written (no pid yet) is not stale
const LOCK_ENV = 'TRIF_INSTALL_LOCK'; // (an updater from before 0.2.0 sets WEBMODS_INSTALL_LOCK: env.js)

class LockBusy extends Error {}

function lockPath(appDir) {
  return path.join(path.dirname(appDir), `.${path.basename(appDir)}.lock`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** { pid, token, ino, age } of the lock file, or null when there's none. */
function readLock(file) {
  try {
    const st = fs.statSync(file);
    const [pid, token] = fs.readFileSync(file, 'utf8').split('\n');
    return { pid: Number(pid), token: token || '', ino: st.ino, age: Date.now() - st.mtimeMs };
  } catch { return null; }
}

function isStale(l) {
  if (l.age > LOCK_MAX_AGE_MS) return true;
  if (Number.isInteger(l.pid) && l.pid > 0) return !pidAlive(l.pid);
  return l.age > LOCK_FRESH_MS;
}

// Moves the stale lock aside and deletes it. If another process replaced it between our look and the
// move (it broke the same stale lock first and made its own), puts that one back and reports busy.
function breakStale(file, seen) {
  const aside = `${file}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(file, aside); } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
  const moved = readLock(aside);
  if (moved && moved.ino !== seen.ino) {
    try { fs.linkSync(aside, file); } catch { /* a third process made one: it holds the lock */ }
    fs.rmSync(aside, { force: true });
    return false;
  }
  fs.rmSync(aside, { force: true });
  return true;
}

function busyError(l) {
  const e = new LockBusy(`another TRIF install is in progress${l && pidAlive(l.pid) ? ` (process ${l.pid})` : ''}; try again in a minute`);
  e.pid = l ? l.pid : null;
  return e;
}

/**
 * Takes the install lock for appDir. Returns { token, held: bool, release() } (held: a parent process
 * holds it for us, so release does nothing); throws LockBusy when a live process holds it.
 */
function acquireInstallLock(appDir, { env = process.env } = {}) {
  const file = lockPath(appDir);
  const inherited = envVar('INSTALL_LOCK', env);
  if (inherited) {
    const l = readLock(file);
    if (l && l.token === inherited && pidAlive(l.pid)) return { token: inherited, held: true, release() {} };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(12).toString('hex');
  for (let attempt = 0; attempt < 5; attempt++) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const l = readLock(file);
      if (l && !isStale(l)) throw busyError(l);
      if (l && !breakStale(file, l)) throw busyError(readLock(file));
      continue;
    }
    try { fs.writeSync(fd, `${process.pid}\n${token}\n`); } finally { fs.closeSync(fd); }
    return {
      token,
      held: false,
      release() {
        const l = readLock(file);
        if (l && l.token === token) fs.rmSync(file, { force: true });
      },
    };
  }
  throw busyError(readLock(file));
}

module.exports = { acquireInstallLock, lockPath, pidAlive, readLock, LockBusy, LOCK_ENV, LOCK_MAX_AGE_MS };
