'use strict';
// AppLinks.swift + Core.swift (the shared rule, mobile/shared/core/app-links.js, called through JavaScriptCore; links that aren't web pages, tel:, mailto:, maps:, an app's scheme, handed to iOS: Tim, 11-18) built
// for the Mac with swiftc and run with mobile/test/applinks-check/main.swift: which schemes stay, never leave or go to
// another app; a tap opens at once, a page's own try asks once a load and one at a time, a frame inside the page
// never asks; what counts as a tap; the question's words; the log keeps the scheme only. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CASES = path.join(HERE, '..', 'shared', 'core', 'app-links-cases.json');
const CORE_JS = path.join(HERE, '..', 'shared', 'gen', 'core.js');
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'AppLinks.swift'), path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'Core.swift'), path.join(HERE, 'applinks-check', 'main.swift')];

test('AppLinks.swift: kinds, tap or ask, once a load, words', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-applinks-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try { out = execFileSync(bin, [CASES, CORE_JS], { encoding: 'utf8', timeout: 20000 }); } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'app links: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
