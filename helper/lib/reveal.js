'use strict';
// "Show in Finder" / "Open in editor" for a mod (the panel's code viewer, `trif reveal`): the system's own
// file manager or default app, on the mod's file. The path is never taken from a message: it's the mod's
// own file from TRIF's scan (`sites/<site>/<mod>.js`, by its id), and anything that isn't exactly that, inside
// the sites folder, is refused. (TRIF_REVEAL_CMD, for tests: a command run instead, with what would have
// run as its arguments, so no Finder window opens on anyone's screen.)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { envVar } = require('./env');

/** The mod's file, checked: in the sites folder, where its id says. Throws for anything else. */
function modFile(modsDir, mods, id) {
  const want = String(id || '').trim();
  const m = (mods || []).find((x) => x.id === want);
  if (!m) throw new Error(`no mod ${want || '(no id)'}`);
  const parts = want.split('/');
  if (parts.length !== 2 || parts.some((p) => !p || p === '.' || p === '..' || /[\\/\0]/.test(p))) throw new Error(`"${want}" isn't a mod id TRIF opens files for`);
  const root = path.resolve(modsDir);
  const expected = path.join(root, parts[0], `${parts[1]}.js`);
  const file = path.resolve(String(m.file || ''));
  const rel = path.relative(root, file);
  if (file !== expected || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${want}'s file isn't where TRIF keeps mods (${path.join(parts[0], `${parts[1]}.js`)} in the sites folder), so TRIF won't open it`);
  if (!fs.existsSync(file)) throw new Error(`${want}'s file isn't there any more`);
  return file;
}

/** What opens it, by platform: `how` 'folder' (the file shown in its folder) or 'editor' (the default app). */
function revealCommand(file, how = 'folder', platform = process.platform) {
  const editor = how === 'editor';
  if (platform === 'darwin') return editor ? ['open', [file]] : ['open', ['-R', file]];
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return ['xdg-open', [editor ? file : path.dirname(file)]];
  if (platform === 'win32') return editor ? ['explorer.exe', [file]] : ['explorer.exe', [`/select,${file}`]];
  throw new Error(`TRIF doesn't know how to open folders on ${platform}`);
}

function launch(cmd, args, env) {
  const stub = envVar('REVEAL_CMD', env);
  const child = stub ? spawn(stub, [cmd, ...args], { detached: true, stdio: 'ignore' }) : spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => { /* (no xdg-open, say: nothing opens; the panel can't tell) */ });
  child.unref();
}

/** Opens it (detached: the helper doesn't wait for Finder). Returns what ran. */
function reveal(modsDir, mods, id, how = 'folder', { platform = process.platform, env = process.env } = {}) {
  const file = modFile(modsDir, mods, id);
  const [cmd, args] = revealCommand(file, how === 'editor' ? 'editor' : 'folder', platform);
  launch(cmd, args, env);
  return { id: String(id).trim(), how: how === 'editor' ? 'editor' : 'folder', file: path.relative(path.resolve(modsDir), file) };
}

/**
 * The same for a path the helper made itself (an export in the downloads folder, a site's files folder),
 * never one from a message: shown in its folder, or with `open`, a folder opened.
 */
function revealPath(p, how = 'folder', { open = false, platform = process.platform, env = process.env } = {}) {
  let cmd, args;
  if (open) [cmd, args] = platform === 'darwin' ? ['open', [p]] : platform === 'win32' ? ['explorer.exe', [p]] : ['xdg-open', [p]];
  else [cmd, args] = revealCommand(p, how, platform);
  launch(cmd, args, env);
  return { shown: p };
}

module.exports = { modFile, revealCommand, reveal, revealPath };
