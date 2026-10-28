'use strict';
// `webmods setup`: workspace, wrappers, native host manifests, CLI link. Idempotent.

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');
const { selectBrowsers } = require('./browsers');

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

function hostWrapperContent(nodePath, home) {
  const env = home !== P.defaultHome() ? `WEBMODS_HOME=${shq(home)}\nexport WEBMODS_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(P.HOST_JS)} "$@"\n`;
}

function cliWrapperContent(nodePath, home) {
  // Respect an explicit WEBMODS_HOME, else default to the home this wrapper was installed for.
  const env = home !== P.defaultHome() ? `: "\${WEBMODS_HOME:=${String(home).replace(/(["\\$`])/g, '\\$1')}}"\nexport WEBMODS_HOME\n` : '';
  return `#!/bin/sh\n${env}exec ${shq(nodePath)} ${shq(P.CLI_JS)} "$@"\n`;
}

function manifestFor(wrapperPath) {
  return {
    name: P.HOST_NAME,
    description: 'WebMods helper: syncs mods and serves the webmods CLI',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [P.EXTENSION_ORIGIN],
  };
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

/**
 * opts: { home, browser, nativeDir, binDir, noLink }
 * Returns { ok, lines: [string], ws, manifests: [{browser, file}] }
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

  const agentsSrc = path.join(P.HELPER_DIR, 'workspace', 'AGENTS.md');
  if (fs.existsSync(agentsSrc)) {
    fs.copyFileSync(agentsSrc, path.join(home, 'AGENTS.md'));
    say(`              AGENTS.md refreshed from ${agentsSrc}`);
  } else {
    say(`              AGENTS.md not found at ${agentsSrc}; skipped`);
  }
  const claudeSrc = path.join(P.HELPER_DIR, 'workspace', 'CLAUDE.md');
  const claude = fs.existsSync(claudeSrc) ? fs.readFileSync(claudeSrc, 'utf8') : '@AGENTS.md\n';
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), claude);

  // 2. Wrappers
  const nodePath = pickNodePath();
  writeIfChanged(ws.hostWrapper, hostWrapperContent(nodePath, home), 0o755);
  writeIfChanged(ws.cliWrapper, cliWrapperContent(nodePath, home), 0o755);
  say(`host wrapper  ${ws.hostWrapper} (node ${nodePath})`);
  say(`CLI wrapper   ${ws.cliWrapper}`);

  // 3. Native host manifests
  let targets;
  if (opts.nativeDir) {
    targets = [{ key: 'custom', label: 'custom', nativeDir: path.resolve(opts.nativeDir) }];
  } else {
    targets = selectBrowsers(opts.browser);
    if (!targets.length) {
      say('browsers      no Chromium browser profile folder found; installing for Google Chrome anyway');
      targets = selectBrowsers('chrome');
    }
  }
  const manifest = JSON.stringify(manifestFor(ws.hostWrapper), null, 2) + '\n';
  const manifests = [];
  for (const t of targets) {
    const file = path.join(t.nativeDir, `${P.HOST_NAME}.json`);
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

  // 4. CLI link
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

  // 5. PATH
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

  // 6. Next steps
  say('');
  say('Next steps:');
  say(`  1. Open chrome://extensions, turn on "Developer mode" (top right), click "Load unpacked"`);
  say(`     and choose ${path.join(P.REPO_ROOT, 'extension')}`);
  say(`     (its ID must be ${P.EXTENSION_ID}).`);
  say('  2. Click "Details" on the WebMods extension and turn on "Allow User Scripts".');
  say('  3. If Chrome was already running before this setup, quit it completely and reopen it.');
  say('  4. Check everything with: webmods doctor');
  say(`  Then ask your coding agent to work in ${home} (it reads AGENTS.md there).`);

  return { ok, lines, ws, manifests, nodePath };
}

module.exports = { setup, hostWrapperContent, cliWrapperContent, manifestFor, pickNodePath, shq, isExecutable };
