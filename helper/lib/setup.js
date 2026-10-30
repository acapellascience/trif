'use strict';
// `webmods setup`: workspace, app copy, wrappers, native host manifests, CLI link. Idempotent.
//
// Install modes (where the wrappers point):
//   link  the package itself (a git checkout: the maintainer's way of working)
//   copy  a self-contained copy in <home>/app (default when not a git checkout, e.g. `npx webmods setup`,
//         whose package lives in npm's cache, which npm may delete)

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');
const { selectBrowsers } = require('./browsers');
const { preinstallMods } = require('./preinstalled');

// Quote for a POSIX shell double-quoted string.
function shq(s) {
  return '"' + String(s).replace(/(["\\$`])/g, '\\$1') + '"';
}

function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

// Prefer a stable node path (e.g. /usr/local/bin/node or /opt/homebrew/bin/node) over a versioned
// Cellar path, as long as it is the same binary that is running now.
function pickNodePath() {
  const exec = process.execPath;
  let real;
  try { real = fs.realpathSync(exec); } catch { return exec; }
  const candidates = [
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'node')),
    '/usr/local/bin/node', '/opt/homebrew/bin/node',
  ];
  for (const c of candidates) {
    if (!path.isAbsolute(c) || !isExecutable(c)) continue;
    try { if (fs.realpathSync(c) === real) return c; } catch { /* ignore */ }
  }
  return exec;
}

function hostWrapperContent(nodePath, home, hostJs = P.HOST_JS) {
  const env = home !== P.defaultHome() ? `WEBMODS_HOME=${shq(home)}\nexport WEBMODS_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(hostJs)} "$@"\n`;
}

function cliWrapperContent(nodePath, home, cliJs = P.CLI_JS) {
  // Respect an explicit WEBMODS_HOME, else default to the home this wrapper was installed for.
  const env = home !== P.defaultHome() ? `: "\${WEBMODS_HOME:=${String(home).replace(/(["\\$`])/g, '\\$1')}}"\nexport WEBMODS_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(cliJs)} "$@"\n`;
}

function manifestFor(wrapperPath, origins = [P.EXTENSION_ORIGIN], { firefox = false } = {}) {
  return {
    name: P.HOST_NAME,
    description: 'WebMods helper: syncs mods and serves the webmods CLI',
    path: wrapperPath,
    type: 'stdio',
    ...(firefox ? { allowed_extensions: [P.FIREFOX_EXTENSION_ID] } : { allowed_origins: [...origins] }),
  };
}

// ---------------------------------------------------------------- app copy

// What the copy needs: the helper (host + CLI + AGENTS.md + template), the extension to load unpacked,
// the examples, and package.json (version, and it keeps helper/ CommonJS).
const COPY_ITEMS = ['package.json', 'helper', 'extension', 'examples'];
const REQUIRED_FILES = ['package.json', 'helper/host.js', 'helper/cli.js', 'extension/manifest.json'];
const SKIP_NAMES = new Set(['.DS_Store', 'node_modules', '.git']);

function chooseMode(mode, root = P.REPO_ROOT) {
  if (mode === 'copy' || mode === 'link') return mode;
  return P.isGitCheckout(root) ? 'link' : 'copy';
}

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function copyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
  } else if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (!SKIP_NAMES.has(name)) copyTree(path.join(src, name), path.join(dest, name));
    }
  } else if (st.isFile()) {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, st.mode & 0o777);
  }
}

// rel path -> 'dir' | 'link:<target>' | 'file:<mode>:<size>' for every entry under root/items.
function listTree(root, items) {
  const out = new Map();
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) out.set(rel, `link:${fs.readlinkSync(abs)}`);
    else if (st.isDirectory()) {
      out.set(rel, 'dir');
      for (const name of fs.readdirSync(abs)) if (!SKIP_NAMES.has(name)) walk(path.join(rel, name));
    } else if (st.isFile()) out.set(rel, `file:${st.mode & 0o777}:${st.size}`);
  };
  for (const item of items) walk(item);
  return out;
}

// True when dest already holds exactly what a copy from src would produce (so re-running setup doesn't
// pull files out from under a running helper).
function sameTree(src, dest, items = COPY_ITEMS) {
  const a = listTree(src, items);
  const b = listTree(dest, items);
  if (a.size !== b.size) return false;
  for (const [rel, kind] of a) {
    if (b.get(rel) !== kind) return false;
    if (kind.startsWith('file:') && !fs.readFileSync(path.join(src, rel)).equals(fs.readFileSync(path.join(dest, rel)))) return false;
  }
  return true;
}

/**
 * Copy the package at srcRoot into appDir: into a temp sibling first, then swapped in, so a failed copy
 * leaves a working install alone. Returns { how: 'created'|'updated'|'unchanged'|'in-place' }; throws
 * (with appDir untouched) on failure.
 */
function installApp(srcRoot, appDir) {
  if (realOrResolved(srcRoot) === realOrResolved(appDir)) return { how: 'in-place' };
  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(srcRoot, f))) throw new Error(`${path.join(srcRoot, f)} is missing; nothing to copy from`);
  }
  if (fs.existsSync(appDir) && sameTree(srcRoot, appDir)) return { how: 'unchanged' };

  const parent = path.dirname(appDir);
  const base = path.basename(appDir);
  fs.mkdirSync(parent, { recursive: true });
  // Leftovers from an interrupted earlier run.
  for (const name of fs.readdirSync(parent)) {
    if (name.startsWith(`.${base}.new-`) || name.startsWith(`.${base}.old-`)) fs.rmSync(path.join(parent, name), { recursive: true, force: true });
  }
  const tmp = path.join(parent, `.${base}.new-${process.pid}`);
  try {
    fs.mkdirSync(tmp);
    for (const item of COPY_ITEMS) {
      const s = path.join(srcRoot, item);
      if (fs.existsSync(s)) copyTree(s, path.join(tmp, item));
    }
    for (const f of REQUIRED_FILES) if (!fs.existsSync(path.join(tmp, f))) throw new Error(`the copy is missing ${f}`);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }

  let old = null;
  if (fs.existsSync(appDir)) {
    old = path.join(parent, `.${base}.old-${process.pid}`);
    fs.renameSync(appDir, old);
  }
  try {
    fs.renameSync(tmp, appDir);
  } catch (e) {
    if (old) fs.renameSync(old, appDir);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  if (old) fs.rmSync(old, { recursive: true, force: true });
  return { how: old ? 'updated' : 'created' };
}

function writeIfChanged(file, content, mode) {
  let old = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (old !== content) fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
  return old === null ? 'created' : old === content ? 'unchanged' : 'updated';
}

function rcFileHint() {
  const shell = path.basename(process.env.SHELL || '');
  if (shell === 'zsh') return '~/.zshrc';
  if (shell === 'bash') return process.platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc';
  if (shell === 'fish') return null;
  return '~/.profile';
}

// Drop the folders npm/npx put on PATH for the duration of `npx webmods setup` (npm's cache, which it
// may delete, and its node-gyp shim): the helper and agents shouldn't keep using them.
function cleanPath(pathValue) {
  const sep = path.sep;
  return String(pathValue || '').split(path.delimiter).filter((d) => d
    && !d.includes(`${sep}_npx${sep}`)
    && !d.includes(`${sep}@npmcli${sep}run-script${sep}`)).join(path.delimiter);
}

// Merge config.json -> env.PATH = pathValue, keeping every other key. Leaves a broken file alone.
function recordPath(home, pathValue) {
  const file = path.join(home, 'config.json');
  let config = {};
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (text !== null && text.trim()) {
    try { config = JSON.parse(text); } catch (e) { return { error: `${file} is not valid JSON (${e.message}); left it alone` }; }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { error: `${file} is not a JSON object; left it alone` };
  }
  const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {};
  config.env = { ...env, PATH: pathValue };
  const how = writeIfChanged(file, JSON.stringify(config, null, 2) + '\n');
  return { error: null, how };
}

/**
 * opts: { home, browser, nativeDir, binDir, noLink, noExamples, mode: 'copy'|'link'|undefined (auto) }
 * Returns { ok, lines: [string], ws, manifests: [{browser, file}], nodePath, mode, root }
 */
function setup(opts = {}) {
  const lines = [];
  const say = (s = '') => lines.push(s);
  const ws = P.workspace(opts.home);
  const home = ws.home;
  let ok = true;

  // 1. Workspace
  for (const d of [home, ws.modsDir, ws.screenshots, ws.bin]) fs.mkdirSync(d, { recursive: true });
  say(`workspace     ${home}`);

  // 2. App: what the wrappers run and where the extension is loaded from.
  const mode = chooseMode(opts.mode);
  let root = P.REPO_ROOT;
  if (mode === 'copy') {
    try {
      const { how } = installApp(P.REPO_ROOT, ws.appDir);
      say(`app           ${ws.appDir} (v${P.VERSION}, ${how === 'in-place' ? 'running from it' : `${how}, copied from ${P.REPO_ROOT}`})`);
      root = ws.appDir;
    } catch (e) {
      ok = false;
      if (fs.existsSync(path.join(ws.appDir, 'helper', 'host.js'))) {
        say(`app           FAILED to update ${ws.appDir}: ${e.message}; kept the existing copy`);
        root = ws.appDir;
      } else {
        say(`app           FAILED to copy WebMods into ${ws.appDir}: ${e.message}`);
        return { ok, lines, ws, manifests: [], nodePath: null, mode, root: null };
      }
    }
  } else {
    say(`app           ${root} (linked: the wrappers run this folder)`);
    if (!P.isGitCheckout(root)) {
      say(`              warning: ${root} isn't a git checkout. If it goes away (npm deletes its npx cache),`);
      say('              WebMods stops working. Run setup without --link to install a copy instead.');
    }
    if (fs.existsSync(ws.appDir) && realOrResolved(ws.appDir) !== realOrResolved(root)) {
      say(`              (an earlier copy in ${ws.appDir} is no longer used; you can delete it)`);
    }
  }
  const helperDir = path.join(root, 'helper');
  const extensionDir = path.join(root, 'extension');

  const agentsSrc = path.join(helperDir, 'workspace', 'AGENTS.md');
  if (fs.existsSync(agentsSrc)) {
    fs.copyFileSync(agentsSrc, path.join(home, 'AGENTS.md'));
    say(`              AGENTS.md refreshed from ${agentsSrc}`);
  } else {
    say(`              AGENTS.md not found at ${agentsSrc}; skipped`);
  }
  if (!opts.noExamples) {
    const examplesDir = process.env.WEBMODS_EXAMPLES_DIR ? path.resolve(process.env.WEBMODS_EXAMPLES_DIR) : path.join(root, 'examples', 'sites');
    const added = preinstallMods(home, ws.modsDir, examplesDir);
    if (added.length) say(`mods          preinstalled ${added.join(', ')}: switched off until you turn them on in the side panel`);
  }
  const claudeSrc = path.join(helperDir, 'workspace', 'CLAUDE.md');
  const claude = fs.existsSync(claudeSrc) ? fs.readFileSync(claudeSrc, 'utf8') : '@AGENTS.md\n@instructions.md\n';
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), claude);

  // Side panel agent runs: Claude Code's permissions for the workspace (overwritten every time), and
  // this terminal's PATH, since Chrome starts the helper with a minimal one and agents live on PATH.
  const agents = require('./agents');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(agents.CLAUDE_SETTINGS, null, 2) + '\n');
  const rec = recordPath(home, cleanPath(process.env.PATH));
  if (rec.error) say(`              couldn't record PATH for agents: ${rec.error}`);
  const found = agents.listAgents(P.workspace(opts.home), { version: false }).agents;
  say(`agents        ${found.map((a) => (a.available ? `${a.id} (${a.path})` : `${a.id} not found`)).join(', ')}`);

  // 3. Wrappers
  const nodePath = pickNodePath();
  const hostJs = path.join(helperDir, 'host.js');
  const cliJs = path.join(helperDir, 'cli.js');
  writeIfChanged(ws.hostWrapper, hostWrapperContent(nodePath, home, hostJs), 0o755);
  writeIfChanged(ws.cliWrapper, cliWrapperContent(nodePath, home, cliJs), 0o755);
  say(`host wrapper  ${ws.hostWrapper} -> ${hostJs} (node ${nodePath})`);
  say(`CLI wrapper   ${ws.cliWrapper} -> ${cliJs}`);

  // 4. Native host manifests, accepting every WebMods extension ID.
  const { ids, invalid } = P.extensionIds(ws.config);
  say(`extension IDs ${ids.join(', ')}`);
  if (invalid.length) say(`              ignored config.json extensionIds entries that aren't extension IDs: ${invalid.map((x) => JSON.stringify(x)).join(', ')}`);
  let targets;
  if (opts.nativeDir) {
    targets = [{ key: 'custom', label: 'custom', nativeDir: path.resolve(opts.nativeDir) }];
  } else {
    targets = selectBrowsers(opts.browser);
    if (!targets.length) {
      say('browsers      no browser profile folder found; installing for Google Chrome anyway');
      targets = selectBrowsers('chrome');
    }
  }
  const origins = P.extensionOrigins(ws.config);
  const manifests = [];
  for (const t of targets) {
    const file = path.join(t.nativeDir, `${P.HOST_NAME}.json`);
    const manifest = JSON.stringify(manifestFor(ws.hostWrapper, origins, { firefox: t.firefox }), null, 2) + '\n';
    try {
      fs.mkdirSync(t.nativeDir, { recursive: true });
      const how = writeIfChanged(file, manifest);
      manifests.push({ browser: t.key, file });
      say(`native host   ${t.label}: ${file} (${how})`);
    } catch (e) {
      ok = false;
      say(`native host   ${t.label}: FAILED to write ${file}: ${e.message}`);
    }
  }

  // 5. CLI link
  const binDir = opts.binDir ? path.resolve(opts.binDir) : '/usr/local/bin';
  const link = path.join(binDir, 'webmods');
  if (opts.noLink) {
    say('CLI link      skipped (--no-link)');
  } else {
    let lst = null;
    try { lst = fs.lstatSync(link); } catch { /* none */ }
    if (lst && !lst.isSymbolicLink()) {
      say(`CLI link      ${link} exists and is not a symlink; left it alone`);
    } else if (lst && fs.readlinkSync(link) === ws.cliWrapper) {
      say(`CLI link      ${link} -> ${ws.cliWrapper} (already)`);
    } else {
      try {
        fs.accessSync(binDir, fs.constants.W_OK);
        if (lst) fs.unlinkSync(link);
        fs.symlinkSync(ws.cliWrapper, link);
        say(`CLI link      ${link} -> ${ws.cliWrapper}`);
      } catch (e) {
        say(`CLI link      ${binDir} isn't writable; skipped (optional: sudo ln -sf ${shq(ws.cliWrapper)} ${link})`);
      }
    }
  }

  // 6. PATH
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).map((d) => path.resolve(d));
  const linked = (() => { try { return fs.readlinkSync(link) === ws.cliWrapper; } catch { return false; } })();
  const onPath = pathDirs.includes(path.resolve(ws.bin)) || (linked && pathDirs.includes(binDir));
  if (!onPath) {
    const rc = rcFileHint();
    say('');
    say(`PATH          ${ws.bin} is not on your PATH. Add it with:`);
    if (rc) say(`                echo 'export PATH="${ws.bin}:$PATH"' >> ${rc}   (then open a new terminal)`);
    else say(`                fish_add_path ${ws.bin}`);
  }

  // 7. Next steps
  say('');
  say('Next steps:');
  say('  1. Install the extension. Until WebMods is on the Chrome Web Store, load it unpacked:');
  say('     open chrome://extensions, turn on "Developer mode" (top right), click "Load unpacked"');
  say(`     and choose ${extensionDir}`);
  say(`     (its ID must be ${P.EXTENSION_ID}).${mode === 'copy' ? ' Keep that folder: Chrome runs the extension from it,' : ''}`);
  if (mode === 'copy') say('     and setup updates it in place. (A Web Store listing will replace this step later.)');
  say('  2. Click "Details" on the WebMods extension and turn on "Allow User Scripts".');
  say('  3. If Chrome was already running before this setup, quit it completely and reopen it.');
  say('  4. Check everything with: webmods doctor');
  if (targets.some((t) => t.firefox)) {
    say('  Firefox: open the signed WebMods add-on (.xpi) in Firefox to install it, then click the WebMods');
    say('     toolbar button and "Allow user scripts". Restart Firefox if it was running before this setup.');
  }
  say(`  Then ask your coding agent to work in ${home} (it reads AGENTS.md there).`);

  return { ok, lines, ws, manifests, nodePath, mode, root };
}

module.exports = {
  setup, recordPath, cleanPath, hostWrapperContent, cliWrapperContent, manifestFor, pickNodePath, shq, isExecutable,
  chooseMode, installApp, sameTree, COPY_ITEMS,
};
