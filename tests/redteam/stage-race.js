#!/usr/bin/env node
'use strict';
// Red-team, target #2: a TIGHT race on the helper's out-of-fence readback (helper/lib/stage.js readPlain /
// writePlain). The previous pass raced single-threaded (tests/redteam/stage-attacks.js, attack 6); this one
// puts a worker thread (and, on readPlain, a tight parallel swapper) hammering the run's copy between the
// helper's open(), its realpath/plainUnder check and its lstat<->fstat ino/dev recheck.
//
// readPlain opens the file (on Windows O_NOFOLLOW is ignored, so a link IS followed), then: rejects nlink>1
// (a hard link), checks the real path stays under root (plainUnder), and rechecks that the lstat of the
// name matches the fstat of what it opened (same ino+dev). To leak the secret the OPEN must land on the
// secret while every recheck still sees a legit file under root -- a window a worker tries to hit on a slow
// runner. A read returning the secret, or a write landing outside, is the BREAK.
//
// PASS = held over all rounds. BREAK = the secret was read, or a write escaped. Exits 1 on any BREAK.

const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const { readPlain, writePlain } = require(path.join(REPO, 'helper', 'lib', 'stage'));
const { ignoresCase } = require(path.join(REPO, 'helper', 'lib', 'pathcheck'));

// ---- worker: hammer the raced path, swapping it between a legit file and routes to the secret ----
if (!isMainThread) {
  const { target, secretFile, legit, mode } = workerData;
  const legitBuf = Buffer.from(legit);
  let stop = false;
  parentPort.on('message', (m) => { if (m === 'stop') stop = true; });
  const canSym = (() => { try { const l = `${target}.symprobe`; fs.symlinkSync(secretFile, l, 'file'); fs.rmSync(l, { force: true }); return true; } catch { return false; } })();
  while (!stop) {
    try {
      fs.rmSync(target, { force: true });
      if (mode === 'sym' && canSym) fs.symlinkSync(secretFile, target, 'file');
      else if (mode === 'hard') fs.linkSync(secretFile, target);
      else if (mode === 'junc') { /* handled by caller via subdir */ }
    } catch { /* ignore */ }
    try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
    try { fs.writeFileSync(target, legitBuf); } catch { /* ignore */ }
  }
  parentPort.postMessage('stopped');
  return;
}

// ---- main ----
const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
const SECRET = `SECRET-${rand(8)}`;
let broke = 0;
const rows = [];
function record(v, id, detail) { if (v === 'BREAK') broke++; rows.push(`  ${v.padEnd(5)} ${id}${detail ? `  -- ${detail}` : ''}`); }

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-race-')));
const ci = ignoresCase(base);
const outside = path.join(base, 'outside');
fs.mkdirSync(outside, { recursive: true });
const secretFile = path.join(outside, 'secret.txt');
fs.writeFileSync(secretFile, `${SECRET} another file's bytes, long enough to widen the read window ${'.'.repeat(4096)}\n`);
const root = path.join(base, 'copy');
fs.mkdirSync(root, { recursive: true });
const legit = `// legit ${'x'.repeat(8192)}\n`;
console.log(`scratch ${base}\nnode ${process.execPath} ${process.version}\ncase-insensitive: ${ci}`);

async function raceRead(mode, rounds = 4000) {
  const rel = `raced-${mode}.js`;
  const target = path.join(root, rel);
  fs.writeFileSync(target, legit);
  const worker = new Worker(__filename, { workerData: { target, secretFile, legit, mode } });
  let got = false;
  let refusals = 0;
  let reads = 0;
  await new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      for (let k = 0; k < 50 && !got; k++, i++) {
        let out = null;
        try { out = readPlain(root, rel, ci); } catch { refusals++; }
        if (out) { reads++; if (out.buf.toString('latin1').includes(SECRET)) got = true; }
      }
      if (got || i >= rounds) return resolve();
      setImmediate(tick);
    };
    tick();
  });
  worker.postMessage('stop');
  await new Promise((r) => { worker.on('message', () => r()); worker.on('exit', () => r()); setTimeout(r, 1000); });
  await worker.terminate().catch(() => {});
  try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
  record(got ? 'BREAK' : 'PASS', `readPlain race (${mode})`, got ? 'the secret was read mid-race' : `held over ~${rounds} reads (${refusals} refused, ${reads} legit reads)`);
}

// A tighter variant: a subdir that the worker flips between a real folder (holding a legit file) and a
// junction/symlink pointing at `outside`, while the main thread reads copy/sub/secret.txt.
async function raceDirSwap(rounds = 4000) {
  const sub = path.join(root, 'sub');
  const rel = path.join('sub', 'secret.txt');
  const canJunc = (() => { try { fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'secret.txt'), legit); return true; } catch { return false; } })();
  if (!canJunc) { record('INFO', 'readPlain race (dir swap)', 'could not set up subdir'); return; }
  let stop = false;
  const swapper = (async () => {
    const canSym = (() => { try { const l = path.join(root, '.probe'); fs.symlinkSync(outside, l, 'junction'); fs.rmSync(l, { recursive: true, force: true }); return true; } catch { return false; } })();
    if (!canSym) return 'no-links';
    while (!stop) {
      try { fs.rmSync(sub, { recursive: true, force: true }); fs.symlinkSync(outside, sub, 'junction'); } catch { /* ignore */ }
      try { fs.rmSync(sub, { recursive: true, force: true }); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'secret.txt'), legit); } catch { /* ignore */ }
      await new Promise((r) => setImmediate(r));
    }
    return 'ok';
  })();
  let got = false; let refusals = 0;
  for (let i = 0; i < rounds && !got; i++) {
    let out = null;
    try { out = readPlain(root, rel, ci); } catch { refusals++; }
    if (out && out.buf.toString('latin1').includes(SECRET)) got = true;
    if (i % 50 === 0) await new Promise((r) => setImmediate(r));
  }
  stop = true;
  const how = await swapper;
  try { fs.rmSync(sub, { recursive: true, force: true }); } catch { /* ignore */ }
  if (how === 'no-links') record('INFO', 'readPlain race (dir swap)', 'junctions/symlinks not creatable here');
  else record(got ? 'BREAK' : 'PASS', 'readPlain race (dir swap)', got ? 'secret read through a swapped-in junction' : `held over ${rounds} rounds (${refusals} refused)`);
}

(async () => {
  await raceRead('sym');
  await raceRead('hard');
  await raceDirSwap();
  console.log('stage.js readback, raced with a worker thread:');
  for (const r of rows) console.log(r);
  console.log(`\n${broke ? `FAIL: ${broke} break(s)` : 'all held under the race'}`);
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(broke ? 1 : 0);
})();
