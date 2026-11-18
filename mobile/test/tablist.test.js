'use strict';
// TabListRules.swift + Site.swift + Core.swift (the tab list: the card it opens at and its robot badges, Tim 11-18: the shared
// mobile/shared/core/tab-list.js called through JavaScriptCore) built for the Mac with swiftc
// and run with mobile/test/tablist-check/main.swift against tab-list-cases.json. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'TabListRules.swift'), path.join(APP, 'Site.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'tablist-check', 'main.swift')];

test('TabListRules.swift: the card the tab list opens at, its badges', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-tablist-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'tab-list-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000, env: { ...process.env } });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith('µs')).join('\n'), 'tab list: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
