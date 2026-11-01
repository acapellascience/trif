#!/usr/bin/env node
// Builds WebMods for Safari: the Safari extension (scripts/build-extension.js safari) wrapped in the
// small Mac app Safari requires, as dist/safari-app/WebMods.app and dist/webmods-safari-<version>.zip.
//
// The Xcode project is generated each time with Apple's safari-web-extension-converter (so nothing
// generated is kept in the repo), then given WebMods' bundle IDs. Needs Xcode (not just the command
// line tools). Without --team the app is signed ad hoc: it runs on this Mac once Safari's "Allow
// unsigned extensions" is on. With --team <Apple developer team ID> Xcode signs it with that team.
//
// Usage: node scripts/build-safari.js [--team TEAMID] [--debug]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'safari-app');
const APP_NAME = 'WebMods';
const APP_ID = 'dev.webmods.app';
const EXTENSION_ID = `${APP_ID}.extension`;

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const team = arg('--team');
const configuration = process.argv.includes('--debug') ? 'Debug' : 'Release';

function fail(msg) {
  console.error(`build-safari: ${msg}`);
  process.exit(1);
}

function run(file, args, opts = {}) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    fail(`${path.basename(file)} ${args[0]} failed:\n${String(e.stdout || '').slice(-3000)}${String(e.stderr || '').slice(-3000)}`);
  }
}

/** The converter's project with WebMods' bundle IDs: the app's, and the extension's under it. */
function fixIdentifiers(projectDir) {
  const pbx = path.join(projectDir, `${APP_NAME}.xcodeproj`, 'project.pbxproj');
  const text = fs.readFileSync(pbx, 'utf8').replace(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
    (_, id) => `PRODUCT_BUNDLE_IDENTIFIER = ${/\.Extension$/.test(id) ? EXTENSION_ID : APP_ID};`);
  fs.writeFileSync(pbx, text);
  const vc = path.join(projectDir, APP_NAME, 'ViewController.swift');
  if (fs.existsSync(vc)) {
    fs.writeFileSync(vc, fs.readFileSync(vc, 'utf8').replace(/let extensionBundleIdentifier = "[^"]*"/, `let extensionBundleIdentifier = "${EXTENSION_ID}"`));
  }
}

function main() {
  if (process.platform !== 'darwin') fail('building for Safari needs a Mac with Xcode');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  run(process.execPath, [path.join(__dirname, 'build-extension.js'), 'safari'], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  run('xcrun', ['safari-web-extension-converter', path.join(DIST, 'safari'), '--project-location', OUT,
    '--app-name', APP_NAME, '--bundle-identifier', APP_ID, '--macos-only', '--swift', '--copy-resources',
    '--no-open', '--no-prompt', '--force']);
  const projectDir = path.join(OUT, APP_NAME);
  if (!fs.existsSync(path.join(projectDir, `${APP_NAME}.xcodeproj`))) fail(`the converter didn't make ${projectDir}/${APP_NAME}.xcodeproj`);
  fixIdentifiers(projectDir);

  const signing = team
    ? [`DEVELOPMENT_TEAM=${team}`, 'CODE_SIGN_STYLE=Automatic']
    : ['CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM='];
  run('xcodebuild', ['-project', path.join(projectDir, `${APP_NAME}.xcodeproj`), '-scheme', APP_NAME,
    '-configuration', configuration, '-derivedDataPath', path.join(OUT, 'build'),
    `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${version}`, 'ARCHS=arm64 x86_64', 'ONLY_ACTIVE_ARCH=NO',
    ...signing, 'build']);

  const built = path.join(OUT, 'build', 'Build', 'Products', configuration, `${APP_NAME}.app`);
  if (!fs.existsSync(built)) fail(`xcodebuild didn't make ${built}`);
  const app = path.join(OUT, `${APP_NAME}.app`);
  run('ditto', [built, app]);
  const zip = path.join(DIST, `webmods-safari-${version}.zip`);
  fs.rmSync(zip, { force: true });
  run('ditto', ['-c', '-k', '--keepParent', app, zip]);

  console.log(`Built ${path.relative(ROOT, app)} and ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB, ${team ? `signed for team ${team}` : 'signed ad hoc'})`);
  console.log(`Open ${path.relative(ROOT, app)} once to add the extension to Safari, then turn it on in Safari → Settings → Extensions.`);
  if (!team) console.log('Ad hoc builds need Safari → Settings → Developer → "Allow unsigned extensions" (off again whenever Safari quits).');
}

main();
