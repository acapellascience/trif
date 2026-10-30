#!/usr/bin/env node
// Builds the extension packages from extension/ (runtime files only):
//   chrome (default): dist/extension/ and dist/webmods-extension-<version>.zip for the Chrome Web Store,
//     with the manifest "key" stripped (the store assigns its own ID).
//   firefox: dist/firefox/ and dist/webmods-firefox-<version>.zip, with the manifest rewritten for
//     Firefox (see firefoxManifest). Run it with `web-ext run -s dist/firefox`, or sign the zip on AMO.
//
// Usage: node scripts/build-extension.js [chrome|firefox]
// No dependencies. The unpacked dev build (Load unpacked from extension/) is unaffected.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const TARGET = process.argv[2] || 'chrome';
const OUT = path.join(DIST, TARGET === 'firefox' ? 'firefox' : 'extension');
const { FIREFOX_EXTENSION_ID } = require('../helper/lib/paths');

// Not needed at runtime. extension/package.json only exists so Node's test runner loads
// extension/*.js as ES modules (tests/extension.test.js imports them); Chrome never reads it.
const EXCLUDE_NAMES = new Set(['package.json', 'package-lock.json', 'node_modules', 'README.md', 'Thumbs.db']);
const EXCLUDE_PATTERNS = [/^\./, /\.test\.js$/, /\.spec\.js$/, /\.map$/, /~$/, /\.swp$/];
const excluded = (name) => EXCLUDE_NAMES.has(name) || EXCLUDE_PATTERNS.some((re) => re.test(name));

function fail(msg) {
  console.error(`build-extension: ${msg}`);
  process.exit(1);
}

function copyDir(from, to, skipped) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const rel = path.relative(SRC, src);
    if (excluded(entry.name)) { skipped.push(rel); continue; }
    if (entry.isSymbolicLink()) fail(`symlinks aren't allowed in the package: ${rel}`);
    if (entry.isDirectory()) copyDir(src, path.join(to, entry.name), skipped);
    else if (entry.isFile()) fs.copyFileSync(src, path.join(to, entry.name));
  }
}

/** Every file path the manifest points at, so a missing icon or page fails the build, not review. */
function manifestPaths(m) {
  const paths = [];
  const addIcons = (icons) => { if (icons && typeof icons === 'object') paths.push(...Object.values(icons)); };
  addIcons(m.icons);
  addIcons(m.action && m.action.default_icon);
  if (m.action && m.action.default_popup) paths.push(m.action.default_popup);
  if (m.background && m.background.service_worker) paths.push(m.background.service_worker);
  if (m.background && m.background.scripts) paths.push(...m.background.scripts);
  if (m.side_panel && m.side_panel.default_path) paths.push(m.side_panel.default_path);
  if (m.sidebar_action && m.sidebar_action.default_panel) paths.push(m.sidebar_action.default_panel);
  if (m.options_page) paths.push(m.options_page);
  if (m.options_ui && m.options_ui.page) paths.push(m.options_ui.page);
  for (const cs of m.content_scripts || []) paths.push(...(cs.js || []), ...(cs.css || []));
  return paths;
}

/**
 * The Chrome manifest rewritten for Firefox: a background page instead of a service worker, a sidebar
 * instead of the side panel, a fixed add-on ID (the helper's native manifest allows it by ID), and
 * userScripts as an optional permission, which is the only way Firefox grants it (the user allows it
 * from the setup page or the panel).
 */
function firefoxManifest(m) {
  const f = { ...m };
  delete f.key;
  delete f.minimum_chrome_version;
  delete f.side_panel;
  f.background = { scripts: [m.background.service_worker], type: 'module' };
  f.permissions = m.permissions.filter((p) => p !== 'sidePanel' && p !== 'userScripts');
  f.optional_permissions = ['userScripts'];
  f.sidebar_action = {
    default_panel: m.side_panel.default_path, default_title: m.name, default_icon: m.action.default_icon,
    open_at_install: false,
  };
  f.browser_specific_settings = {
    gecko: { id: FIREFOX_EXTENSION_ID, strict_min_version: '153.0', data_collection_permissions: { required: ['none'] } },
  };
  return f;
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  }).sort();
}

function main() {
  let manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  if (!/^\d+(\.\d+){0,3}$/.test(String(version))) fail(`manifest version "${version}" isn't a valid Chrome version`);
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (manifest.description && manifest.description.length > 132) fail('manifest description is over 132 characters');

  // The root package.json is the version's source of truth (see helper/lib/paths.js); warn on drift.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== version) {
      console.warn(`build-extension: warning: package.json version ${pkg.version} != manifest version ${version}`);
    }
  } catch { /* no root package.json: nothing to compare */ }

  fs.rmSync(OUT, { recursive: true, force: true });
  const skipped = [];
  copyDir(SRC, OUT, skipped);

  if (TARGET === 'firefox') manifest = firefoxManifest(manifest);
  else if (TARGET === 'chrome') delete manifest.key; // the store rejects or ignores "key" and assigns its own ID
  else fail(`unknown target "${TARGET}" (use chrome or firefox)`);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const missing = manifestPaths(manifest).filter((p) => !fs.existsSync(path.join(OUT, p)));
  if (missing.length) fail(`manifest points at missing files: ${missing.join(', ')}`);
  if (!manifest.icons || !manifest.icons['128']) fail('manifest has no 128px icon (the store requires one)');

  const zipPath = path.join(DIST, `webmods-${TARGET === 'firefox' ? 'firefox' : 'extension'}-${version}.zip`);
  fs.rmSync(zipPath, { force: true });
  try {
    // -X: no extra file attributes (uid/gid, macOS metadata); -r recursive; -q quiet.
    execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: OUT, stdio: 'inherit' });
  } catch (e) {
    fail(`zip failed (${e.message}). Is the \`zip\` command installed?`);
  }

  const files = listFiles(OUT);
  console.log(`Built ${path.relative(ROOT, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB, ${files.length} files)`);
  for (const f of files) console.log(`  ${f}`);
  if (skipped.length) console.log(`Left out: ${skipped.join(', ')}`);
  if (TARGET === 'chrome') console.log('Removed manifest "key" (the Chrome Web Store assigns the ID).');
  else console.log(`Firefox manifest, add-on ID ${FIREFOX_EXTENSION_ID}.`);
}

main();
