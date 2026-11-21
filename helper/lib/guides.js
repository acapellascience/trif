'use strict';
// The guides TRIF owns in the workspace (AGENTS.md, TECHNIQUES.md, BOXED.md, CLAUDE.md): copies of the
// helper's own helper/workspace/ files, which side-panel runs read (stage.js DOCS). `trif setup` writes
// them, and the helper keeps them in step with the copy of TRIF it is (at start, and before each run is
// staged), so a git checkout updated by `git checkout`, which never runs setup, doesn't leave its chats
// reading old guides. Only these files: instructions.md, the mods and the settings are the user's.
//
// A guide edited by hand is replaced, as setup always did (the user's notes belong in instructions.md);
// the helper says so in its log and keeps the replaced copy in the private folder (replaced-guides/).
// What it last wrote is remembered (guides.json in the private folder), to tell such an edit from a
// guide an older TRIF wrote.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GUIDES = ['AGENTS.md', 'TECHNIQUES.md', 'BOXED.md', 'CLAUDE.md'];
// (CLAUDE.md when the helper has none: Claude Code reads the two by reference)
const CLAUDE_FALLBACK = '@AGENTS.md\n@instructions.md\n';
const RECORD = 'guides.json';
const REPLACED = 'replaced-guides';

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const readOrNull = (file) => { try { return fs.readFileSync(file); } catch { return null; } };
const statKey = (file) => { try { const s = fs.statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return '-'; } };

/** [{name, text: Buffer}]: what the workspace's guides should be for the helper in helperDir. */
function wantedGuides(helperDir) {
  const out = [];
  for (const name of GUIDES) {
    let text = readOrNull(path.join(helperDir, 'workspace', name));
    if (text === null && name === 'CLAUDE.md') text = Buffer.from(CLAUDE_FALLBACK);
    if (text !== null) out.push({ name, text });
  }
  return out;
}

/** [{name, why: 'missing'|'out of date'}]: the workspace's guides that differ from helperDir's. */
function staleGuides(home, helperDir) {
  const stale = [];
  for (const { name, text } of wantedGuides(helperDir)) {
    const have = readOrNull(path.join(home, name));
    if (have === null) stale.push({ name, why: 'missing' });
    else if (!have.equals(text)) stale.push({ name, why: 'out of date' });
  }
  return stale;
}

function readRecord(privateDir) {
  if (!privateDir) return {};
  try {
    const r = JSON.parse(fs.readFileSync(path.join(privateDir, RECORD), 'utf8'));
    return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
  } catch { return {}; }
}

function writeRecord(privateDir, record) {
  if (!privateDir) return;
  try {
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    writeAtomic(path.join(privateDir, RECORD), JSON.stringify(record, null, 2) + '\n');
  } catch { /* next time: without it an edit is only reported as a refresh */ }
}

// (a temporary file renamed over the guide: a run being staged at that moment, or a second helper, never
// reads half of one)
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ }
    throw e;
  }
}

// What the last check found unchanged, per workspace: the helper's and the workspace's guides by
// inode+size+mtime. The same again skips reading them.
const checked = new Map();

/**
 * Brings the workspace's guides in step with helperDir's, writing only the ones that differ.
 * ws: {home, private}. opts.logger (info/warn) says what changed; opts.force skips the quick check.
 * Returns {written: [name], edited: [name], errors: [message]} (edited: replaced although changed
 * since TRIF last wrote it).
 */
function syncGuides(ws, helperDir, opts = {}) {
  const logger = opts.logger || { info() {}, warn() {} };
  const res = { written: [], edited: [], errors: [] };
  if (!ws || !ws.home || !helperDir) return res;
  const home = ws.home;
  const keyOf = () => GUIDES.map((n) => `${statKey(path.join(helperDir, 'workspace', n))}|${statKey(path.join(home, n))}`).join(';');
  const memo = `${home}\0${helperDir}`;
  if (!opts.force && checked.get(memo) === keyOf()) return res;
  if (!fs.existsSync(home)) return res; // (no workspace yet: setup makes it)
  const record = readRecord(ws.private);
  let recordChanged = false;
  for (const { name, text } of wantedGuides(helperDir)) {
    const file = path.join(home, name);
    const want = sha1(text);
    const have = readOrNull(file);
    if (have !== null && have.equals(text)) {
      if (record[name] !== want) { record[name] = want; recordChanged = true; }
      continue;
    }
    try {
      const st = (() => { try { return fs.lstatSync(file); } catch { return null; } })();
      if (st && !st.isFile()) { res.errors.push(`${name}: ${file} isn't a file; left as it is`); continue; }
      const edited = have !== null && record[name] && record[name] !== sha1(have);
      if (edited && ws.private) {
        try {
          fs.mkdirSync(path.join(ws.private, REPLACED), { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(ws.private, REPLACED, name), have);
        } catch { /* the log still says so */ }
      }
      writeAtomic(file, text);
      record[name] = want;
      recordChanged = true;
      res.written.push(name);
      if (edited) {
        res.edited.push(name);
        logger.warn(`guides: ${name} had been changed since TRIF last wrote it; replaced with ${path.join(helperDir, 'workspace', name)} `
          + `(TRIF's guides are always replaced; the changed copy is in ${path.join(ws.private, REPLACED, name)}, and your own notes belong in instructions.md)`);
      }
    } catch (e) {
      res.errors.push(`${name}: ${e.message}`);
    }
  }
  if (recordChanged) writeRecord(ws.private, record);
  if (res.written.length) logger.info(`guides: refreshed ${res.written.join(', ')} in ${home} from ${path.join(helperDir, 'workspace')}`);
  for (const e of res.errors) logger.warn(`guides: couldn't refresh ${e}`);
  if (!res.errors.length) checked.set(memo, keyOf());
  return res;
}

module.exports = { GUIDES, CLAUDE_FALLBACK, wantedGuides, staleGuides, syncGuides };
