'use strict';
// ModOfferRules.swift + Core.swift (a chat's mod read for the chat's site, Tim 11-18; the coral "runs on another site"
// box, 11-17: the shared mobile/shared/core/mod-offer.js called through JavaScriptCore) built for the Mac with swiftc
// and run with mobile/test/modoffer-check/main.swift against mod-offer-cases.json. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'Site.swift'), path.join(APP, 'ModOfferRules.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'modoffer-check', 'main.swift')];

test('ModOfferRules.swift: where a chat\'s mod is read, the coral box', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-modoffer-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'mod-offer-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 20000, env: { ...process.env } });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith('µs')).join('\n'), 'mod offer: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
