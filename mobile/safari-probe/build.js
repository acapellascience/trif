#!/usr/bin/env node
'use strict';
// Builds TRIF Probe's Safari extension.
//
//   node mobile/safari-probe/build.js            on a Mac: puts the extension together, has Apple's converter
//                                                wrap it in an iPhone app project, and opens it in Xcode
//   node mobile/safari-probe/build.js --no-open  the same, without opening Xcode
//   node mobile/safari-probe/build.js --chrome   only puts it together, as a Chromium extension (what
//                                                mobile/test/smoke.js loads); works anywhere
//
// Output: mobile/build/safari-extension (or chrome-extension), and on a Mac mobile/build/safari-app.
// TRIF_PROBE_BUNDLE_ID sets the app's bundle id (default com.timsrobot.trifprobe.safari).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const MOBILE = path.join(HERE, '..');
const ROOT = path.join(MOBILE, '..');
const BUILD = path.join(MOBILE, 'build');
const APP_NAME = 'TRIF Probe';
const fail = (m) => { console.error(m); process.exit(1); };

function assemble(target) {
  const out = path.join(BUILD, `${target}-extension`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(HERE, 'extension'), out, { recursive: true });
  const gen = path.join(out, 'gen');
  fs.mkdirSync(gen, { recursive: true });
  const runtime = path.join(MOBILE, 'shared', 'gen', 'sandbox-runtime.js');
  if (!fs.existsSync(runtime)) fail('mobile/shared/gen/sandbox-runtime.js is missing: run node mobile/prepare.js');
  fs.copyFileSync(path.join(MOBILE, 'shared', 'kit.js'), path.join(gen, 'kit.js'));
  fs.copyFileSync(runtime, path.join(gen, 'sandbox-runtime.js'));
  fs.copyFileSync(path.join(ROOT, 'extension', 'vendor', 'ses.umd.min.js'), path.join(gen, 'ses.umd.min.js'));
  if (target === 'chrome') {
    const file = path.join(out, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.background = { service_worker: 'background.js' };
    fs.writeFileSync(file, JSON.stringify(m, null, 2));
  }
  return out;
}

function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'build' || e.name.endsWith('.xcodeproj')) continue; const f = find(p, name); if (f) return f; } else if (e.name === name) return p;
  }
  return null;
}

function main() {
  if (process.argv.includes('--chrome')) { console.log(assemble('chrome')); return; }
  const ext = assemble('safari');
  if (process.platform !== 'darwin') { console.log(`Put together at ${path.relative(ROOT, ext)}. The app project needs a Mac with Xcode.`); return; }
  const out = path.join(BUILD, 'safari-app');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const bundle = process.env.TRIF_PROBE_BUNDLE_ID || 'com.timsrobot.trifprobe.safari';
  execFileSync('xcrun', ['safari-web-extension-converter', ext, '--project-location', out, '--app-name', APP_NAME,
    '--bundle-identifier', bundle, '--ios-only', '--swift', '--copy-resources', '--no-open', '--no-prompt', '--force'], { stdio: 'inherit' });
  // The converter names the app <bundle minus its last part>.<app name> ("com.timsrobot.trifprobe.TRIF-Probe")
  // but the extension <bundle>.Extension, and iOS won't build an app whose extension's id doesn't start with
  // the app's: make the app's id the one asked for.
  const pbx = find(out, 'project.pbxproj') || path.join(out, APP_NAME, `${APP_NAME}.xcodeproj`, 'project.pbxproj');
  const ids = fs.readFileSync(pbx, 'utf8').replace(/PRODUCT_BUNDLE_IDENTIFIER = ("?)([^";]+)\1;/g, (m, q, id) => (id.endsWith('.Extension') ? `PRODUCT_BUNDLE_IDENTIFIER = ${bundle}.Extension;` : `PRODUCT_BUNDLE_IDENTIFIER = ${bundle};`));
  fs.writeFileSync(pbx, ids);
  const handler = find(out, 'SafariWebExtensionHandler.swift');
  if (!handler) fail("the converter's project has no SafariWebExtensionHandler.swift to replace");
  fs.copyFileSync(path.join(HERE, 'SafariWebExtensionHandler.swift'), handler);
  const project = path.join(out, APP_NAME, `${APP_NAME}.xcodeproj`);
  if (!fs.existsSync(project)) fail(`the converter didn't make ${project}`);
  console.log(`\nThe project: ${path.relative(ROOT, project)}`);
  console.log('In Xcode: choose your team under Signing & Capabilities for both targets, pick a simulator or your iPhone, and Run.');
  console.log('Then on the device: Settings → Apps → Safari → Extensions → TRIF Probe → on, and "All Websites: Allow".');
  if (!process.argv.includes('--no-open')) execFileSync('open', [project]);
}

main();
