'use strict';
// ChatProjects.swift (Tim, 11-20: TRIF's chats in a "TRIF" project, set up in one tap): its rules built for the Mac with
// swiftc and run with mobile/test/chatprojects-check/main.swift: conversation and project addresses on both services,
// the first-use card asked once, the project made from TRIF's form noticed by its address, a kept project found gone.
// macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'ChatProjects.swift'), path.join(HERE, 'chatprojects-check', 'main.swift')];

test('ChatProjects.swift: TRIF chats in a project of their own', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-chatprojects-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try { out = execFileSync(bin, [], { encoding: 'utf8', timeout: 20000 }); } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'chat projects: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
