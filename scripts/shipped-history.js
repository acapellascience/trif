#!/usr/bin/env node
'use strict';
// Writes examples/shipped-history.json: for every example mod, the sha1 of each version of its file the
// repository has ever held ({"x.com/plain-x": ["<sha1>", …]}, oldest first). Setup uses it to tell an
// unchanged copy of a shipped mod from one the user edited in workspaces that were set up before TRIF
// kept a record of what it shipped (helper/lib/preinstalled.js). scripts/release.js runs it for every
// release, so the list ships current; run it by hand after committing a change to an example:
//
//   node scripts/shipped-history.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = 'examples/sites';
const OUT = path.join('examples', 'shipped-history.json');

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** {id: [sha1…]} from the git history of `root` (committed versions only, oldest first). */
function shippedHistory(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  const files = git(['log', '--format=', '--name-only', '--', EXAMPLES]).toString('utf8').split('\n')
    .filter((f) => /^examples\/sites\/[^/]+\/[^/_.][^/]*\.js$/.test(f) && !f.endsWith('.test.js'));
  const history = {};
  for (const file of [...new Set(files)].sort()) {
    const id = file.slice(EXAMPLES.length + 1, -3);
    const hashes = [];
    for (const commit of git(['log', '--reverse', '--format=%H', '--', file]).toString('utf8').split('\n').filter(Boolean)) {
      let content;
      try { content = git(['show', `${commit}:${file}`]); } catch { continue; } // the commit that deleted it
      const h = sha1(content);
      if (!hashes.includes(h)) hashes.push(h);
    }
    if (hashes.length) history[id] = hashes;
  }
  return history;
}

/** Writes the history of `root` into `dest` (a release's copy of the repo, or the repo itself). */
function writeShippedHistory(root = ROOT, dest = root) {
  const file = path.join(dest, OUT);
  const text = JSON.stringify(shippedHistory(root), null, 2) + '\n';
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old !== text) fs.writeFileSync(file, text);
  return { file, changed: old !== text };
}

if (require.main === module) {
  const { file, changed } = writeShippedHistory();
  console.log(`${path.relative(ROOT, file)} ${changed ? 'updated' : 'already up to date'}`);
}

module.exports = { shippedHistory, writeShippedHistory, OUT };
