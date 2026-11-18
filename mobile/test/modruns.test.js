'use strict';
// ModRuns.swift + ModHolds.swift + Site.swift + Core.swift (what runs: a mod's switch, the tiers off on a site, Pause
// all, @match; running / isOn / off / MatchPattern are Swift twins, the switches call the shared
// mobile/shared/core/mod-store.js through JavaScriptCore) built for the Mac with swiftc and run with
// mobile/test/modruns-check/main.swift against mod-runs-cases.json; the shared running is compared too. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CORE = path.join(HERE, '..', 'shared', 'core');
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = ['Site.swift', 'ModHolds.swift', 'ModRuns.swift', 'Core.swift'].map((f) => path.join(APP, f)).concat(path.join(HERE, 'modruns-check', 'main.swift'));

test('ModRuns.swift: what runs, @match, the switches', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-modruns-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(CORE, 'mod-runs-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'inherit'] });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim(), 'mod runs: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
