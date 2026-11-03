'use strict';
// How the `trif` CLI reaches the helper on Windows: named pipes instead of Unix sockets.
//
// On macOS and Linux each helper listens on <home>/helper-<pid>.sock, and the first also on
// <home>/helper.sock (lib/helpers.js, host.js), each made 0600 so no other user can connect. Windows has
// no sockets in folders; Node listens on and connects to named pipes (\\.\pipe\<name>) with the same
// calls, so only naming, finding and choosing the default helper change:
//
//   - Each helper listens on ONE pipe with a random name, \\.\pipe\trif-<32 hex digits>. Pipe names are
//     one namespace for the whole computer, so a fixed name could be taken first by another user's
//     program, which would then receive the CLI's requests. A random one can't be taken in advance, and
//     Node creates the pipe as its first instance (FILE_FLAG_FIRST_PIPE_INSTANCE), so it can't be
//     shared either.
//   - It says where: <home>\helper-<pid>.pipe holds the pipe's name (like helper-<pid>.sock does by
//     existing). The workspace is in the user's profile folder, which other users can't read.
//   - The default helper (the CLI's, "primary") is the one named in <home>\helper.pipe, created with
//     O_EXCL by whichever helper gets there first; one whose pipe no longer answers is stale, and the
//     next helper replaces it. Its pipe is its own pipe: there's no second one.
//   - Pipes vanish with their process: there's nothing to clean up but the marker files.
// Who may connect: Node gives the pipe Windows' default security, under which only the user (with
// SYSTEM and administrators) may write to it; other users may only read, and the helper only ever
// answers what was written to it. So, as with a 0600 socket, only the user's own programs can send it
// commands. (Same-user programs can on every system: the side-panel runs that need keeping out don't
// exist on Windows yet, see platform.js panelRunsOff.)
//
// TRIF_PIPE_DIR (tests on macOS and Linux): make the "pipes" Unix sockets in that folder, named the same
// way, so these rules are tested with a real helper there. On Windows it's ignored.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { envVar } = require('../env');

const PIPE_PREFIX = '\\\\.\\pipe\\';
const PRIMARY_MARKER = 'helper.pipe';
const MARKER_RE = /^helper-(\d+)\.pipe$/;
const FRESH_MS = 2000; // a marker still being written (empty) isn't stale

function pipeDir({ env = process.env, platform = process.platform } = {}) {
  const d = platform === 'win32' ? null : envVar('PIPE_DIR', env);
  return d && path.isAbsolute(d) ? d : null;
}

/** Whether the CLI and helpers use pipes and marker files (Windows; or TRIF_PIPE_DIR in tests). */
function usesPipes(opts = {}) {
  return (opts.platform || process.platform) === 'win32' || !!pipeDir(opts);
}

/** A new random pipe name. */
function newPipeName(opts = {}) {
  const id = `trif-${crypto.randomBytes(16).toString('hex')}`;
  const dir = pipeDir(opts);
  return dir ? path.join(dir, `${id}.sock`) : `${PIPE_PREFIX}${id}`;
}

/** Whether `s` is a name newPipeName could have made: what a marker file may say, and nothing else. */
function isPipeName(s, opts = {}) {
  if (typeof s !== 'string') return false;
  const dir = pipeDir(opts);
  if (dir) return path.dirname(s) === dir && /^trif-[0-9a-f]{32}\.sock$/.test(path.basename(s));
  return /^\\\\\.\\pipe\\trif-[0-9a-f]{32}$/.test(s);
}

/** A name nothing listens on: the CLI's default when no helper said where it is (connecting fails). */
function nobodyName(opts = {}) {
  const dir = pipeDir(opts);
  return dir ? path.join(dir, 'trif-none.sock') : `${PIPE_PREFIX}trif-none`;
}

function primaryMarker(home) { return path.join(home, PRIMARY_MARKER); }
function ownMarker(home, pid = process.pid) { return path.join(home, `helper-${pid}.pipe`); }

/** The pipe named in a marker file, or null (none, unreadable, or not a name of ours). */
function readMarker(file, opts = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const name = text.trim();
  return isPipeName(name, opts) ? name : null;
}

function writeMarker(file, name, { exclusive = false } = {}) {
  fs.writeFileSync(file, `${name}\n`, { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}

/** The CLI's default: the primary helper's pipe, or a name nothing listens on. */
function defaultEndpoint(home, opts = {}) {
  return readMarker(primaryMarker(home), opts) || nobodyName(opts);
}

/** [{sock, pid, marker}] for every helper-<pid>.pipe in home naming a pipe (live or not), by pid. */
function listMarkers(home, opts = {}) {
  let names = [];
  try { names = fs.readdirSync(home); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = MARKER_RE.exec(n);
    if (!m) continue;
    const marker = path.join(home, n);
    const sock = readMarker(marker, opts);
    if (sock) out.push({ sock, pid: Number(m[1]), marker });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

/** Whether something answers on the pipe. */
function probe(name, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const s = net.connect(name);
    let settled = false;
    const done = (alive) => { if (settled) return; settled = true; s.destroy(); resolve(alive); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs).unref();
  });
}

function age(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; }
}

// Moves a stale primary marker aside and deletes it. If another helper replaced it between our look and
// the move (it broke the same stale marker first and made its own), puts that one back: false.
function breakStale(file, seenText) {
  const aside = `${file}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(file, aside); } catch (e) { return e.code === 'ENOENT'; }
  let moved = null;
  try { moved = fs.readFileSync(aside, 'utf8'); } catch { /* gone */ }
  if (moved !== null && moved !== seenText) {
    try { fs.linkSync(aside, file); } catch { /* a third helper made one: it's the primary */ }
    fs.rmSync(aside, { force: true });
    return false;
  }
  fs.rmSync(aside, { force: true });
  return true;
}

/**
 * Become the default helper with pipe `own`, unless a live one already is. Resolves 'primary', 'busy'
 * (another helper's pipe answers, or its marker is being written) or {error}.
 */
async function claimPrimary(home, own, { probeFn = probe, ...opts } = {}) {
  const file = primaryMarker(home);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeMarker(file, own, { exclusive: true });
      return 'primary';
    } catch (e) {
      if (e.code !== 'EEXIST') return { error: `can't write ${file}: ${e.message}` };
    }
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; } // gone meanwhile: try again
    const cur = isPipeName(text.trim(), opts) ? text.trim() : null;
    if (cur === own) return 'primary';
    if (cur && await probeFn(cur)) return 'busy';
    if (!cur && age(file) < FRESH_MS) return 'busy'; // another helper is writing it right now
    if (!breakStale(file, text)) return 'busy';
  }
  return 'busy';
}

/** The primary helper's pipe, as its marker says (null: none). */
function primaryPipe(home, opts = {}) { return readMarker(primaryMarker(home), opts); }

/** On shutdown: remove the primary marker if it's still ours, and our own marker. */
function release(home, own, pid = process.pid) {
  try { if (fs.readFileSync(primaryMarker(home), 'utf8').trim() === own) fs.unlinkSync(primaryMarker(home)); } catch { /* not ours, or gone */ }
  try { fs.unlinkSync(ownMarker(home, pid)); } catch { /* gone */ }
}

module.exports = {
  PIPE_PREFIX, PRIMARY_MARKER, usesPipes, pipeDir, newPipeName, isPipeName, nobodyName, primaryMarker, ownMarker, readMarker, writeMarker,
  defaultEndpoint, listMarkers, probe, claimPrimary, primaryPipe, release,
};
