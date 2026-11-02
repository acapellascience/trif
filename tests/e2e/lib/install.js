'use strict';
// Installing TRIF the way users get it, into a scratch home: `npm pack` this checkout, unpack it, and
// run the package's own `helper/cli.js setup --copy --no-link --browser <b>` with HOME pointed at the
// scratch home (so ~/.trif, ~/.webmods and the browsers' NativeMessagingHosts folders are all inside it).
// The upgrade path installs an older release's tarball first, the way a 0.1.x user has it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./util');

const REPO = path.resolve(__dirname, '..', '..', '..');

/** The environment for anything that should see the scratch home as ~ (setup, the CLI). */
function scratchEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, TRIF_NO_LAUNCHCTL: '1', ...extra };
  for (const k of Object.keys(env)) if (/^(TRIF|WEBMODS)_(HOME|SOCK|RUN_|INSTALL_LOCK|SAFARI_BRIDGE)/.test(k)) delete env[k];
  // No API keys from the terminal (TRIF reads open-model keys from the keyring only; agents get theirs
  // from config.json), so none sit in the scratch browser's and helper's environment.
  for (const k of Object.keys(env)) if (/_API_KEY$/i.test(k)) delete env[k];
  Object.assign(env, extra);
  return env;
}

/** npm pack this checkout into `dir`; returns the tarball's path. */
function packRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, npm_config_cache: path.join(dir, 'npm-cache'), npm_config_update_notifier: 'false' };
  const r = run('npm', ['pack', '--json', '--pack-destination', dir], { cwd: REPO, env, timeoutMs: 180000 });
  if (r.status !== 0) throw new Error(`npm pack failed: ${r.stderr || r.stdout}`);
  const info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  return path.join(dir, info[0].filename);
}

/** Unpacks a tarball into `dest` (fresh); returns the package folder. */
function unpack(tgz, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const r = run('/usr/bin/tar', ['xzf', tgz, '-C', dest]);
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  return path.join(dest, 'package');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Runs a package's setup against the scratch home. Returns {status, out, json}. */
function runSetup(pkg, home, args) {
  const r = run(process.execPath, [path.join(pkg, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', ...args], { env: scratchEnv(home), cwd: home, timeoutMs: 180000 });
  return { status: r.status, out: (r.stdout + r.stderr).trim() };
}

/** Which --browser an older package's setup understands (Firefox support came later than Chrome's). */
function oldBrowserArg(pkg, browser) {
  const table = path.join(pkg, 'helper', 'lib', 'browsers.js');
  const text = fs.existsSync(table) ? fs.readFileSync(table, 'utf8') : '';
  return browser === 'firefox' && !/firefox/.test(text) ? 'chrome' : browser;
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/**
 * Makes sure the new package ships a different version of `id` than the old one did, so the upgrade
 * offers it ("update available"). When the two are the same file, the new package's copy gets a
 * comment and the next @version (as the next release would), and its shipped-history entry is left
 * alone (the old copy's hash is in it, so an unedited copy would be updated in place). Returns a note.
 */
function ensureShippedUpdate(oldPkg, newPkg, id) {
  const rel = path.join('examples', 'sites', ...id.split('/')) + '.js';
  const oldText = fs.readFileSync(path.join(oldPkg, rel), 'utf8');
  const newFile = path.join(newPkg, rel);
  const newText = fs.readFileSync(newFile, 'utf8');
  if (oldText !== newText) return `${id} already differs between the two packages`;
  const m = /(\/\/\s*@version\s+)(\d+)/.exec(newText);
  const next = m ? Number(m[2]) + 1 : 2;
  const bumped = (m ? newText.replace(m[0], `${m[1]}${next}`) : newText.replace('// ==/WebMod==', `// @version     ${next}\n// ==/WebMod==`))
    + '\n// (e2e: a later version of this mod, made by the test harness)\n';
  fs.writeFileSync(newFile, bumped);
  return `${id} is the same in both packages, so the harness made the new package's copy version ${next} (as a later release would)`;
}

module.exports = { REPO, scratchEnv, packRepo, unpack, runSetup, oldBrowserArg, ensureShippedUpdate, readJson, sha1 };
