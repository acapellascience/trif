'use strict';
// ChatOffers.swift (what a chat may offer with Add this mod?: Tim, 11-17, "spurious asks to add old code") built for
// the Mac with swiftc and run with mobile/test/chatoffers-check/main.swift: code a chat offered before isn't offered
// again (added, declined, dismissed; across launches), nor an installed mod's current or earlier version, nor a
// mod's in Recently deleted; a new version is; normalised code; at most 500 remembered. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'ChatOffers.swift'), path.join(HERE, 'chatoffers-check', 'main.swift')];

test('ChatOffers.swift: re-offers held back, history and Recently deleted matched, a new version still offered', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-chatoffers-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try { out = execFileSync(bin, { encoding: 'utf8', timeout: 20000 }); } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'chat offers: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
