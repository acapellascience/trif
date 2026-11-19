'use strict';
// ModEdits.swift + Core.swift (a chat's edit blocks for a mod, Tim 11-19; a shortened whole file caught: the shared
// mobile/shared/core/mod-edit.js called through JavaScriptCore) and ChatRefusal's words, built for the Mac with swiftc
// and run with mobile/test/modedit-check/main.swift. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'ModEdits.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'modedit-check', 'main.swift')];

test('ModEdits.swift: edit blocks resolved, refusals, a shortened file', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-modedit-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000, env: { ...process.env } });
    } catch (e) { out = `${e.stdout || ''}`; }
    console.log(`# ${out.trim().split('\n').filter((l) => l.endsWith(' ms')).join('; ')}`);
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith(' ms')).join('\n'), 'mod edit: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
