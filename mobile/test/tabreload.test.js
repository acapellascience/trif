'use strict';
// TabReloadRules.swift + Core.swift (which tabs load again when the mods change, and Request Desktop Website's per-site memory, Tim 11-18: the shared
// mobile/shared/core/tab-reload.js and desktop.js called through JavaScriptCore) built for the Mac with swiftc
// and run with mobile/test/tabreload-check/main.swift against tab-reload-cases.json and desktop-cases.json. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'TabReloadRules.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'tabreload-check', 'main.swift')];

test('TabReloadRules.swift: which tabs load again, and desktop websites', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-tabreload-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'tab-reload-cases.json'), path.join(CORE, 'desktop-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000, env: { ...process.env } });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith('µs')).join('\n'), 'tab reload: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
