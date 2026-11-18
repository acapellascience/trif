'use strict';
// ModHolds.swift + Core.swift (the mod store's hold rules, the shared mobile/shared/core/mod-store.js called through
// JavaScriptCore; `waiting` a Swift twin, compared with the shared held) built for the Mac with swiftc and run with
// mobile/test/modstore-check/main.swift against mod-store-cases.json: what waits, Allow, what a change asks about, what the
// version before counts as allowed, which version runs while a change waits. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'Site.swift'), path.join(APP, 'ModHolds.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'modstore-check', 'main.swift')];

test('ModHolds.swift: what waits, Allow, a change judged, the version kept running', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-modstore-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'mod-store-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000 });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'mod store: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
