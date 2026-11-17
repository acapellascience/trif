'use strict';
// "Send to iPhone" (docs/MOBILE-EDIT.md "Send to phone"): a mod's file handed to the Mac's AirDrop, which the
// iPhone app already takes (its document types open a .js in TRIF, which asks "Add this mod?" and holds it like
// any mod from outside: mobile/browser-probe/TrifProbe/Import.swift on branch ios-poc). No server: the file goes
// from this Mac to the phone directly. The file is a copy, named as Export names it (<site>-<mod>.js, which the
// app reads its site from as desktop's import does), in a folder of its own under the temporary folder.
//
// AirDrop's own window is opened by a small JavaScript for Automation script (osascript, AppKit's
// NSSharingService), which says on stderr, a line at a time, what happened: `none` (no AirDrop on this Mac),
// `shown` (its window is up), `noshow` (it didn't open), then `shared`, `cancelled` or `failed`. The helper
// answers the panel as soon as the window is up or isn't: when it isn't, it shows the file in Finder instead,
// where Share → AirDrop sends it the same way. Elsewhere than macOS: the file in its folder.
//
// Tests never see a window: TRIF_AIRDROP is the script's answer ("shown", "none", "noshow"), and
// TRIF_PHONE_OUTBOX the folder.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { envVar } = require('./env');
const { modFile, revealPath } = require('./reveal');

const WAIT_MS = 8000; // (for AirDrop's window to be up, or not)

/** Where the copies go: a folder of TRIF's in the temporary folder (TRIF_PHONE_OUTBOX for tests). */
function outbox(env = process.env) {
  return envVar('PHONE_OUTBOX', env) || path.join(os.tmpdir(), 'trif-to-phone');
}

/** The mod's file copied for the phone: {id, file}. Copies from before an hour ago go. */
function copyForPhone(ws, list, id, { env = process.env, now = Date.now() } = {}) {
  const src = modFile(ws.modsDir, list, id);
  const [site, mod] = String(id).trim().split('/');
  const base = outbox(env);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d);
    try { if (now - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ }
  }
  const dir = path.join(base, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, `${site}-${mod}.js`);
  fs.copyFileSync(src, file);
  return { id: `${site}/${mod}`, file };
}

// The script: argv[0] is the file. (Its lines go to stderr: console.log's in osascript.)
const AIRDROP_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const say = (s) => console.log(s);
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  const items = $([$.NSURL.fileURLWithPath(argv[0])]);
  const svc = $.NSSharingService.sharingServiceNamed($.NSSharingServiceNameSendViaAirDrop);
  if (svc.isNil() || !svc.canPerformWithItems(items)) { say('none'); return; }
  let done = '';
  ObjC.registerSubclass({
    name: 'TrifAirDropDelegate', protocols: ['NSSharingServiceDelegate'],
    methods: {
      'sharingService:didShareItems:': { types: ['void', ['id', 'id']], implementation: function () { done = 'shared'; } },
      'sharingService:didFailToShareItems:error:': { types: ['void', ['id', 'id', 'id']], implementation: function (s, i, e) { done = e.code == 3072 ? 'cancelled' : 'failed'; } },
    },
  });
  svc.delegate = $.TrifAirDropDelegate.alloc.init;
  app.activateIgnoringOtherApps(true);
  svc.performWithItems(items);
  const tick = (s) => $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(s));
  for (let i = 0; i < 8 && !done && app.windows.count === 0; i++) tick(0.25);
  if (!done && app.windows.count === 0) { say('noshow'); return; }
  say('shown');
  const end = Date.now() + 10 * 60 * 1000;
  while (!done && Date.now() < end) tick(0.25);
  say(done || 'cancelled');
}
`;

/** [command, args] for AirDrop's window on `file` (macOS), or null. */
function airdropCommand(file, platform = process.platform) {
  return platform === 'darwin' ? ['osascript', ['-l', 'JavaScript', '-e', AIRDROP_JXA, file]] : null;
}

/**
 * Opens AirDrop with `file`. Resolves 'shown' (its window is up), 'none' (no AirDrop) or 'noshow' as soon as
 * that's known; `onDone(result)` later gets 'shared', 'cancelled' or 'failed' once the window closes.
 */
function airdrop(file, { env = process.env, platform = process.platform, onDone = () => {} } = {}) {
  const stub = envVar('AIRDROP', env);
  if (stub !== undefined) { if (stub === 'shown') setImmediate(() => onDone('shared')); return Promise.resolve(stub); }
  const c = airdropCommand(file, platform);
  if (!c) return Promise.resolve('none');
  return new Promise((resolve) => {
    let first = null;
    let buf = '';
    const child = spawn(c[0], c[1], { stdio: ['ignore', 'ignore', 'pipe'] });
    const answer = (v) => { if (first === null) { first = v; resolve(v); } };
    const timer = setTimeout(() => answer('noshow'), WAIT_MS);
    child.stderr.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (['none', 'noshow', 'shown'].includes(line)) { clearTimeout(timer); answer(line); } else if (['shared', 'cancelled', 'failed'].includes(line)) onDone(line);
      }
    });
    child.on('error', () => { clearTimeout(timer); answer('none'); });
    child.on('exit', () => { clearTimeout(timer); answer('noshow'); });
  });
}

/**
 * Send to iPhone: the copy, then AirDrop, else the copy shown in its folder. Resolves {id, file, how:
 * 'airdrop'|'folder'}.
 */
async function sendToPhone(ws, list, id, { env = process.env, platform = process.platform, logger = null } = {}) {
  const r = copyForPhone(ws, list, id, { env });
  const shown = await airdrop(r.file, { env, platform, onDone: (x) => logger?.info(`AirDrop of ${r.id}: ${x}`) });
  if (shown === 'shown') return { ...r, how: 'airdrop' };
  if (envVar('AIRDROP', env) === undefined) revealPath(r.file, 'folder');
  return { ...r, how: 'folder', ...(shown === 'none' ? { airdrop: false } : {}) };
}

module.exports = { outbox, copyForPhone, airdropCommand, airdrop, sendToPhone, AIRDROP_JXA };
