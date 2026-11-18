'use strict';
// Site.swift (the twin of mobile/shared/core/site.js) and QuickAskRules.swift + Core.swift (quick ask's rules, the shared
// mobile/shared/core/quick-ask.js called through JavaScriptCore: Tim, 11-18, a look-only mod added at once, Undo puts
// things back) built for the Mac with swiftc and run with mobile/test/quickask-check/main.swift against site-cases.json
// and quick-ask-cases.json: sites, a chat's site (phone~ twins), look-only, the pill's state, Undo's steps. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'Site.swift'), path.join(APP, 'QuickAskRules.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'quickask-check', 'main.swift')];

test('Site.swift and QuickAskRules.swift: sites, look-only, the pill, Undo', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-quickask-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'site-cases.json'), path.join(CORE, 'quick-ask-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000 });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'quick ask: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
