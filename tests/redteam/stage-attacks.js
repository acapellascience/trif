#!/usr/bin/env node
'use strict';
// Red-team: the helper's OUT-OF-FENCE file readback/pushback on real NTFS.
//
// The AppContainer fence (fence.cs) is attacked from inside by tests/windows-fence/run.js. This attacks
// the other half: helper/lib/stage.js readPlain()/writePlain(). Those run OUTSIDE the fence, with the
// helper's full privilege, over files a run wrote into its copy (stage.sites). Stage.sync() calls them to
// push the run's mods to the live workspace. Their only defence against a run that plants a link, junction,
// hard link or a race is the code in stage.js itself -- there is no sandbox around the helper. The macOS/
// Linux unit tests can't exercise NTFS junctions, nNumberOfLinks, ADS or case-folding, so this does, on a
// windows-latest runner. A run's copy is simulated as `root`; a secret the run may NOT reach sits outside.
//
// Each attack is PASS (held), BREAK (escaped: a guarantee broke) or INFO. Exits 1 on any BREAK.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const { readPlain, writePlain } = require(path.join(REPO, 'helper', 'lib', 'stage'));
const { ignoresCase } = require(path.join(REPO, 'helper', 'lib', 'pathcheck'));

if (process.platform !== 'win32') { console.error('stage-attacks: Windows only (NTFS semantics)'); process.exit(2); }

const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
const SECRET = `SECRET-${rand(8)}`;
let broke = 0;
const rows = [];
function record(verdict, id, detail) {
  if (verdict === 'BREAK') broke++;
  rows.push(`  ${verdict.padEnd(5)} ${id}${detail ? `  -- ${detail}` : ''}`);
}
// An attack where getting bytes/content of SECRET, or a write landing outside, is the break.
function tryRead(id, root, rel, ci) {
  let out;
  try { out = readPlain(root, rel, ci); } catch (e) { record('PASS', id, `refused: ${e.message}`); return; }
  const text = out.buf.toString('latin1');
  if (text.includes(SECRET)) record('BREAK', id, 'the secret came back through the helper');
  else record('INFO', id, `read ${out.buf.length} bytes (no secret): ${JSON.stringify(text.slice(0, 40))}`);
}
function tryWrite(id, root, rel, ci, witnessOutside) {
  let threw = null;
  try { writePlain(root, rel, Buffer.from(`${SECRET}-planted`), ci); } catch (e) { threw = e.message; }
  let landed = false;
  try { landed = fs.readFileSync(witnessOutside, 'utf8').includes(`${SECRET}-planted`); } catch { /* not there */ }
  if (landed) record('BREAK', id, `the helper wrote outside the run's folder${threw ? ` (and threw: ${threw})` : ''}`);
  else record('PASS', id, threw ? `refused: ${threw}` : 'wrote, but inside the folder (no escape)');
}

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-redteam-')));
const ci = ignoresCase(base);
console.log(`scratch ${base}\nnode ${process.execPath} ${process.version}\ncase-insensitive volume: ${ci}`);

// What the run may NOT reach: a secret outside its copy, and a writable folder outside it.
const outside = path.join(base, 'outside');
fs.mkdirSync(outside, { recursive: true });
const secretFile = path.join(outside, 'secret.txt');
fs.writeFileSync(secretFile, `${SECRET} another file's bytes\n`);
const outWritable = path.join(base, 'elsewhere');
fs.mkdirSync(outWritable, { recursive: true });

// The run's own copy.
const root = path.join(base, 'copy');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'ok.js'), '// a plain file the run really wrote\n');

const canLink = (() => { try { const l = path.join(base, 'probe-sym'); fs.symlinkSync(secretFile, l, 'file'); fs.rmSync(l, { force: true }); return true; } catch { return false; } })();
console.log(`can create file symlinks here: ${canLink}\n`);

// 1) readPlain through a hard link to a secret outside the copy (same volume): nlink must catch it.
try {
  const hl = path.join(root, 'hardlink.js');
  fs.linkSync(secretFile, hl);
  tryRead('read via hard link to an outside file', root, 'hardlink.js', ci);
  fs.rmSync(hl, { force: true });
} catch (e) { record('INFO', 'read via hard link to an outside file', `couldn't plant: ${e.message}`); }

// 2) readPlain reached through a directory junction the run planted (no privilege needed to make one).
try {
  const j = path.join(root, 'subdir');
  fs.symlinkSync(outside, j, 'junction');
  tryRead('read through a directory junction', root, path.join('subdir', 'secret.txt'), ci);
  fs.rmSync(j, { recursive: true, force: true });
} catch (e) { record('INFO', 'read through a directory junction', `couldn't plant: ${e.message}`); }

// 3) readPlain through a file symlink the run planted.
if (canLink) {
  try {
    const sl = path.join(root, 'symlink.js');
    fs.symlinkSync(secretFile, sl, 'file');
    tryRead('read through a file symlink', root, 'symlink.js', ci);
    fs.rmSync(sl, { force: true });
  } catch (e) { record('INFO', 'read through a file symlink', `couldn't plant: ${e.message}`); }
} else record('INFO', 'read through a file symlink', 'file symlinks not creatable here');

// 4) writePlain where an intermediate folder is a junction pointing outside: must not write into the target.
try {
  const j = path.join(root, 'outdir');
  fs.symlinkSync(outWritable, j, 'junction');
  tryWrite('write through a directory junction', root, path.join('outdir', 'planted.js'), ci, path.join(outWritable, 'planted.js'));
  fs.rmSync(j, { recursive: true, force: true });
} catch (e) { record('INFO', 'write through a directory junction', `couldn't plant: ${e.message}`); }

// 5) writePlain onto a target that is already a file symlink to an outside file: must not write through it.
if (canLink) {
  try {
    const target = path.join(outWritable, 'via-symlink.txt');
    fs.writeFileSync(target, 'original-outside\n');
    const sl = path.join(root, 'target.js');
    fs.symlinkSync(target, sl, 'file');
    let threw = null;
    try { writePlain(root, 'target.js', Buffer.from(`${SECRET}-overwrite`), ci); } catch (e) { threw = e.message; }
    const changed = fs.readFileSync(target, 'utf8').includes(`${SECRET}-overwrite`);
    record(changed ? 'BREAK' : 'PASS', 'write onto a symlinked target', changed ? 'the outside file was overwritten through the symlink' : `held${threw ? `: ${threw}` : ''}`);
    fs.rmSync(sl, { force: true });
  } catch (e) { record('INFO', 'write onto a symlinked target', `couldn't plant: ${e.message}`); }
} else record('INFO', 'write onto a symlinked target', 'file symlinks not creatable here');

// 6) TOCTOU: while readPlain runs, swap the plain file it opened for a junction/hardlink to the secret,
//    many rounds, trying to beat the fstat<->lstat ino/dev recheck. A win returns the secret bytes.
(function race() {
  const rel = 'raced.js';
  const target = path.join(root, rel);
  const legit = Buffer.from('// legit content, repeated to widen the read window\n'.repeat(4096));
  let got = false;
  let swaps = 0;
  const rounds = 400;
  for (let i = 0; i < rounds && !got; i++) {
    try { fs.writeFileSync(target, legit); } catch { /* retry */ }
    // A racer thread is hard without workers here; do a best-effort interleave: delete+hardlink to secret
    // right before and after the read, so some iteration lands mid-call on a slow runner.
    let out = null;
    try {
      if (i % 2 === 0) { try { fs.rmSync(target, { force: true }); fs.linkSync(secretFile, target); swaps++; } catch { /* ignore */ } }
      out = readPlain(root, rel, ci);
    } catch { /* refused: good */ }
    if (out && out.buf.toString('latin1').includes(SECRET)) got = true;
    try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
  }
  record(got ? 'BREAK' : 'PASS', 'TOCTOU swap of the file being read (best-effort)', got ? 'the secret was read' : `held over ${rounds} rounds (${swaps} swaps)`);
})();

// 7) INFO: readPlain trusts its caller for containment -- a rel with .. resolves outside and plainUnder
//    (real === want) does NOT reject it. Callers (Stage.sync) derive rel from a walk, so no `..` reaches
//    here; documented as a hardening note, not a live break.
try {
  const r = readPlain(root, path.join('..', 'outside', 'secret.txt'), ci);
  record('INFO', 'readPlain with a ".." rel (caller-trust)', r.buf.toString('latin1').includes(SECRET) ? 'returned the outside secret: readPlain alone does not bound rel to root (callers must)' : 'returned bytes');
} catch (e) { record('INFO', 'readPlain with a ".." rel (caller-trust)', `refused: ${e.message}`); }

console.log('stage.js out-of-fence readback/pushback, attacked on NTFS:');
for (const r of rows) console.log(r);
console.log(`\n${broke ? `FAIL: ${broke} guarantee(s) broke` : 'all guarantees held'}`);
try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(broke ? 1 : 0);
