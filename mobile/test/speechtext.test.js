'use strict';
// SpeechText.swift (the microphone's words only ever grow: Tim, 11-18, "If you pause, it deletes the things you've
// said so far") + Core.swift (the shared mobile/shared/core/speech-text.js called through JavaScriptCore) built for
// the Mac with swiftc and run with mobile/test/speechtext-check/main.swift against speech-text-cases.json (the
// answers the Swift gave before the move): SpeechAnalyzer's volatile and final results, SFSpeechRecognizer's
// revisions, its fresh start after a pause (with or without a segment end, repeating what it said or not), a task
// ending by itself, committed words never shortened by any sequence of events, both through the shared rule and the
// Swift copy kept for when it can't answer; and a partial result's cost. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'SpeechText.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'speechtext-check', 'main.swift')];

test('SpeechText.swift: words kept across pauses, restarts and revisions', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-speechtext-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try {
      out = execFileSync(bin, [path.join(HERE, '..', 'shared', 'core', 'speech-text-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')], { encoding: 'utf8', timeout: 60000, env: { ...process.env } });
    } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith('µs')).join('\n'), 'speech text: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
