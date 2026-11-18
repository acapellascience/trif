#!/usr/bin/env node
'use strict';
// Part B, by itself: serves the pages, installs the probe on the running (headless) emulator, runs the box
// checks and reads files/box.log back over adb. Writes results/box.log and prints a B1-B5 summary.
//
//   ./emu.sh start && ./gradlew -q assembleDebug && node run-box.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { start } = require('./serve.js');

const ADB = path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const PKG = 'com.timsrobot.trif.probe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const readLog = () => { try { return adb('exec-out', 'run-as', PKG, 'cat', 'files/box.log'); } catch { return ''; } };

(async () => {
  const servers = start();
  adb('reverse', 'tcp:8477', 'tcp:8477'); adb('reverse', 'tcp:8478', 'tcp:8478');
  adb("shell", "am", "force-stop", PKG);
  adb('install', '-r', path.join(__dirname, 'app/build/outputs/apk/debug/app-debug.apk'));
  try { adb('shell', 'run-as', PKG, 'rm', '-f', 'files/box.log'); } catch { /* first run */ }
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.ProbeActivity`, '--es', 'mode', 'box', '--es', 'base', 'http://127.0.0.1:8477/');
  const t0 = Date.now();
  let text = '';
  while (Date.now() - t0 < 180000) {
    await new Promise((r) => setTimeout(r, 2000));
    text = readLog();
    if (/^DONE$/m.test(text)) break;
  }
  servers.forEach((s) => s.close());
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results/box.log'), text);
  const lines = text.split('\n');
  const verdicts = lines.filter((l) => /^(PASS|FAIL) .* B\d\.\w+$/.test(l));
  const by = {};
  for (const l of verdicts) { const [v, ...rest] = l.split(' '); const key = rest[rest.length - 1].split('.')[0]; (by[key] = by[key] || { PASS: 0, FAIL: [] }); if (v === 'PASS') by[key].PASS++; else by[key].FAIL.push(rest.join(' ')); }
  for (const l of lines.filter((x) => /^INFO|^FAIL setup/.test(x))) console.log(l);
  for (const [k, v] of Object.entries(by)) console.log(`${v.FAIL.length ? 'FAIL' : 'PASS'} ${k}: ${v.PASS} passed${v.FAIL.length ? `, failed: ${v.FAIL.join('; ')}` : ''}`);
  const lock = lines.filter((l) => l.startsWith('DATA') && / box top /.test(l)).map((l) => { const o = JSON.parse(l.slice(l.indexOf('{'))); return `${l.split(' ')[1]} lockdown ${o.out.lockdownMs} ms, whole start ${o.out.startMs} ms, SES load ${o.out.sesLoadMs} ms`; });
  console.log(lock.join('\n'));
  if (!/^DONE$/m.test(text)) { console.log('the probe did not finish in 3 minutes'); process.exitCode = 1; }
})();
