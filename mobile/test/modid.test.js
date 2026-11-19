'use strict';
// ModID.swift + Core.swift (+ PhoneSync.swift for the sync key) built for the Mac with swiftc and run with
// mobile/test/modid-check/main.swift: stable mod ids and renames (docs/PHONE-SYNC.md 2a on branch phone-link, Tim
// 11-18). The text rules through the shared core against the desktop's cases (mod-id-cases.json), CryptoKit's part
// revisions, the Swift isId twin, and the app's decisions: which mod keeps an id in a folder, stamping, which installed
// mod an offered or imported one is (by id first, then by @name), a rename's file. macOS only. `TRIF_COST=1` prints a
// sync row's parts' cost.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'ModID.swift'), path.join(APP, 'Core.swift'), path.join(APP, 'PhoneSync.swift'), path.join(HERE, 'modid-check', 'main.swift')];

test('ModID.swift: ids, parts, stamping, the same mod, a rename\'s file', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-modid-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'mod-id-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000 });
    } catch (e) { out = `${e.stdout || ''}`; }
    if (process.env.TRIF_COST) process.stdout.write(out);
    assert.equal(out.trim().split('\n').filter((l) => !l.startsWith('cost:')).join('\n'), 'mod id: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
