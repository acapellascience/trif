#!/usr/bin/env node
// Builds the extension packages from extension/ (runtime files only):
//   chrome (default): dist/extension/ and dist/trif-extension-<version>.zip for the Chrome Web Store,
//     with the manifest "key" stripped (the store assigns its own ID).
//   firefox: dist/firefox/ and dist/trif-firefox-<version>.zip, with the manifest rewritten for
//     Firefox (see firefoxManifest). Run it with `web-ext run -s dist/firefox`, or sign the zip on AMO.
//   safari: dist/safari/ and dist/trif-safari-<version>.zip, with the manifest rewritten for Safari
//     (see safariManifest). scripts/build-safari.js wraps it in the Mac app Safari needs.
//
// Usage: node scripts/build-extension.js [chrome|firefox|safari]
// No dependencies. The unpacked dev build (Load unpacked from extension/) is unaffected.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const TARGET = process.argv[2] || 'chrome';
const OUT = path.join(DIST, TARGET === 'chrome' ? 'extension' : TARGET);
// The Safari adapter (extension/safari.js) only goes in the Safari build.
const SAFARI_ONLY = ['safari.js', 'safari-background.js'];
const { FIREFOX_EXTENSION_ID } = require('../helper/lib/paths');
const { githubRepo } = require('../helper/lib/update');

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
 * from the setup page or the panel). The sites stay optional host permissions, as in Chrome: Firefox
 * lets the user take any host permission back anyway, and asks for them with permissions.request from
 * a click, as the panel does.
 */
function firefoxManifest(m, repo = githubRepo(readPackage())) {
  const f = { ...m };
  delete f.key;
  delete f.minimum_chrome_version;
  delete f.side_panel;
  f.background = { scripts: [m.background.service_worker], type: 'module' };
  f.permissions = m.permissions.filter((p) => p !== 'sidePanel' && p !== 'userScripts');
  f.optional_permissions = ['userScripts'];
  // Firefox shows this title above the sidebar.
  f.sidebar_action = {
    default_panel: m.side_panel.default_path, default_title: m.name, default_icon: m.action.default_icon,
    open_at_install: false,
  };
  f.browser_specific_settings = {
    gecko: { id: FIREFOX_EXTENSION_ID, strict_min_version: '153.0', data_collection_permissions: { required: ['none'] } },
  };
  // Self-distributed (signed, unlisted) builds update from the repo's feed, which scripts/release.js
  // writes. Firefox checks it about once a day; each version there must be signed by Mozilla.
  if (repo) f.browser_specific_settings.gecko.update_url = `https://raw.githubusercontent.com/${repo}/main/updates/firefox.json`;
  return f;
}

/**
 * The Chrome manifest rewritten for Safari: the Safari adapter loads before the background (it stands in
 * for chrome.userScripts and native messaging), mods go in with chrome.scripting as pages commit
 * (webNavigation), and there's no side panel (the toolbar button opens the panel in a window).
 */
function safariManifest(m) {
  const f = { ...m };
  delete f.key;
  delete f.minimum_chrome_version;
  delete f.side_panel;
  // A non-persistent background page rather than a service worker: Safari reports a worker that fails to
  // start without saying why, and a page can be inspected (Develop → Web Extension Background Content).
  // Still one classic script (bundleClassic).
  f.background = { scripts: ['safari-background.js'], persistent: false };
  // nativeMessaging stays: in Safari it reaches the extension's own app, which hands out the bridge's key.
  // (activeTab is for Chrome's and Firefox's screenshots without <all_urls>; Safari has <all_urls>.)
  f.permissions = [...m.permissions.filter((p) => !['sidePanel', 'userScripts', 'activeTab'].includes(p)), 'webNavigation'];
  // Safari keeps <all_urls> as a required host permission: Safari doesn't grant it at install anyway, it
  // asks the user per site itself (the toolbar button, or Settings → Extensions → Websites), which is the
  // per-site OK the other builds get from permissions.request. TRIF asking too would be a second question
  // for the same thing, so the panel doesn't ask there, and every site counts as allowed (lib.js
  // SITE_ACCESS): what Safari doesn't allow, it doesn't let TRIF touch either way.
  f.host_permissions = ['<all_urls>'];
  delete f.optional_host_permissions;
  return f;
}

/**
 * `entry` and the modules it imports, as one classic (non-module) script: Safari doesn't run module
 * service workers. Each module becomes a function run once, in import order, whose exported names are
 * what its importers destructure. Handles the forms this extension uses: `import { a, b as c } from
 * './x.js'`, `import './x.js'`, and `export` before function/class/const/let declarations.
 */
function bundleClassic(dir, entry) {
  const order = [];
  const sources = new Map();
  const IMPORT = /^import\s+(?:\{([^}]*)\}\s+from\s+)?'\.\/([\w.-]+\.js)';[^\n]*$/gm;
  const visit = (file) => {
    if (sources.has(file)) return;
    const code = fs.readFileSync(path.join(dir, file), 'utf8');
    sources.set(file, code);
    for (const m of code.matchAll(IMPORT)) visit(m[2]);
    order.push(file);
  };
  visit(entry);
  const v = (file) => `__module_${file.replace(/\W/g, '_')}`;
  const parts = order.map((file) => {
    const names = [];
    const body = sources.get(file)
      .replace(IMPORT, (_, list, from) => (list
        ? `const { ${list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ': ')).join(', ')} } = ${v(from)};`
        : ''))
      .replace(/^export\s+((?:async\s+)?function\*?|class|const|let)\s+([\w$]+)/gm, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
    if (/^export\b/m.test(body)) fail(`${file}: an export form the Safari bundle doesn't handle`);
    // A module that exports `bundledChrome` (extension/safari.js) changes what later modules see as `chrome`.
    return `// ---- ${file}\nconst ${v(file)} = ((chrome) => {\n${body}\nreturn { ${names.join(', ')} };\n})(__chrome);\n`
      + `if (${v(file)}.bundledChrome) __chrome = ${v(file)}.bundledChrome;`;
  });
  // A worker that fails to start leaves no console to read, and Safari stops it before anything it sent
  // gets out, so the error is caught (the worker stays up, doing nothing else) and sent to the helper's
  // Safari bridge, which logs it (helper/safari-bridge.js).
  // Safari reads a background page's script without a charset, as Latin-1, so everything past ASCII (the
  // ’ in "isn’t", →, …) would reach the panel garbled. It all goes in as \u escapes (the sources only have it
  // in strings, template literals, regular expressions and comments, where those mean the same).
  return asciiOnly(`// Built by scripts/build-extension.js from ${order.join(', ')}. Edit those, not this.
'use strict';
let __chrome = globalThis.chrome;
try {
${parts.join('\n\n')}
} catch (e) {
  console.error('[TRIF] the background failed to start:', e);
  fetch('http://127.0.0.1:47615/startup-error', { method: 'POST', body: String((e && e.stack) || e) }).catch(() => {});
}
`);
}

/** `code` with every character past ASCII written as a \uXXXX escape. */
function asciiOnly(code) {
  return code.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function readPackage() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { return {}; }
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

  // The sandbox's SES must be the npm file, unchanged (extension/sandbox.js SES_SHA256; vendor/README.txt).
  const ses = fs.readFileSync(path.join(SRC, 'vendor', 'ses.umd.min.js'));
  const sesHash = require('crypto').createHash('sha256').update(ses).digest('hex');
  const wantHash = (/SES_SHA256 = '([0-9a-f]{64})'/.exec(fs.readFileSync(path.join(SRC, 'sandbox.js'), 'utf8')) || [])[1];
  if (!wantHash || sesHash !== wantHash) fail(`extension/vendor/ses.umd.min.js isn't ses 2.3.0's file (sha256 ${sesHash}, want ${wantHash})`);

  fs.rmSync(OUT, { recursive: true, force: true });
  const skipped = [];
  copyDir(SRC, OUT, skipped);

  if (TARGET === 'firefox') manifest = firefoxManifest(manifest);
  else if (TARGET === 'safari') manifest = safariManifest(manifest);
  else if (TARGET === 'chrome') delete manifest.key; // the store rejects or ignores "key" and assigns its own ID
  else fail(`unknown target "${TARGET}" (use chrome, firefox or safari)`);
  if (TARGET !== 'safari') for (const f of SAFARI_ONLY) fs.rmSync(path.join(OUT, f), { force: true });
  if (TARGET === 'safari') fs.writeFileSync(path.join(OUT, 'safari-background.js'), bundleClassic(OUT, 'safari-background.js'));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const missing = manifestPaths(manifest).filter((p) => !fs.existsSync(path.join(OUT, p)));
  if (missing.length) fail(`manifest points at missing files: ${missing.join(', ')}`);
  if (!manifest.icons || !manifest.icons['128']) fail('manifest has no 128px icon (the store requires one)');

  const zipPath = path.join(DIST, `trif-${TARGET === 'chrome' ? 'extension' : TARGET}-${version}.zip`);
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
  else if (TARGET === 'firefox') console.log(`Firefox manifest, add-on ID ${FIREFOX_EXTENSION_ID}.`);
  else console.log('Safari manifest (Safari 27.2+).');
}

if (require.main === module) main();
module.exports = { asciiOnly, bundleClassic, safariManifest, firefoxManifest };
