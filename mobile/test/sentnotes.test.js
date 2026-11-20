'use strict';
// SentNotes.swift (Tim, 11-20: "is there a way to automatically pick up the fact that there's a new mod when the app
// restarts?"): the note kept at each send, until TRIF sees its reply end, built for the Mac with swiftc and run with
// mobile/test/sentnotes-check/main.swift: one per chat, cleared, a new chat's address followed, kept in its file across
// launches, over an hour old dropped, a broken file read as none. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'SentNotes.swift'), path.join(HERE, 'sentnotes-check', 'main.swift')];

test('SentNotes.swift: the notes of sends whose replies TRIF has not seen end', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-sentnotes-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try { out = execFileSync(bin, [dir], { encoding: 'utf8', timeout: 20000 }); } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'sent notes: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
