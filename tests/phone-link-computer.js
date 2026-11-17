#!/usr/bin/env node
'use strict';
// A stand-in computer for the iPhone app's side of the phone link (ios-poc's mobile/test/phonelink.test.js and
// the Simulator): the real Store, Server, Runs and Remote of helper/lib/phonelink in this process, a temp
// workspace (never ~/.trif), a fake keychain, the listener on 127.0.0.1 alone at a port the system picks, no
// Bonjour, and the stand-in agent (tests/phone-link-agent.js: no model, no paid call; its words WRITE,
// PHONE[args], PAUSE:<word>, SLEEP steer it). Not a test file itself.
//
//   node tests/phone-link-computer.js [--seconds 120]
//
// Prints one JSON line first: {port, qr, home}. Then a JSON line for each line it reads on stdin:
//   pair          a new code: {qr, port}
//   go <word>     lets a run waiting at PAUSE:<word> go on: {go}
//   list          the paired phones: {phones: [{id, name}]}
//   remove        removes every paired phone: {removed: n}
//   kept          the kept runs per phone: {kept: {<phone id>: [{runId, done}]}}
// Phone sync (helper/lib/phonelink/syncsession.js, attached as link.js attaches it; docs/PHONE-SYNC.md):
//   twin          every phone twin file: {twin: {<sites/-relative path>: text}}
//   write <rel> <JSON string>   writes a twin file as a desktop edit would (inside sites/phone~*/ only), then
//                 nudges the phone: {wrote: rel, nudged: n}
//   delete <rel>  deletes a twin file (into <home>/trash/, as the side panel's delete), then nudges: {deleted, nudged}
//   run <site> <words>  a desktop phone-view chat ("Edit for mobile", scope phone~<site>) with the stand-in agent
//                and those words (EDIT, say): {run: runId}; when it's done, the twin's change nudges the phone (as
//                host.js's syncMods does): {runDone: runId, ok, changedFiles, nudged}
//   nudge         sync.changed to every connected phone: {nudged: n}
//   synced        the last sync per phone (the Settings line's facts): {synced: {<phone id>: {...} | null}}
//   held          the held map's twin entries: {held: {<id>: {by, ...}}}
//   quit          stops (also after --seconds, and on SIGTERM / SIGINT); everything it made is deleted.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { standInAgent } = require('./phone-link-agent');
const { makeFakeKeychain } = require('./fake-keychain');

// Before runs.js is loaded: this process is the helper of a temp workspace.
const { home, go } = standInAgent('wm-plcomp-');

const P = require('../helper/lib/paths');
const { Runs } = require('../helper/lib/runs');
const { Store } = require('../helper/lib/phonelink/store');
const { Server } = require('../helper/lib/phonelink/server');
const { Remote } = require('../helper/lib/phonelink/remote');
const R = require('../helper/lib/phonelink/remoterun');
const { PhoneSync } = require('../helper/lib/phonelink/syncsession');
const held = require('../helper/lib/held');
const { scanMods } = require('../helper/lib/mods');

const seconds = Number((process.argv.find((a, i) => process.argv[i - 1] === '--seconds')) || 120);
const chain = makeFakeKeychain(path.join(home, 'keychain'));
const store = new Store(home, { env: { ...chain.env }, name: 'Stand-in Mac' });
const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, log: () => {} });
let remote = null;
const desktopRuns = new Set();
const runs = new Runs({
  getWorkspace: () => P.workspace(home),
  logger: { info() {}, debug() {}, error() {}, warn() {} },
  onEvent: (runId, ev) => {
    remote.onEvent(runId, ev);
    if (desktopRuns.has(runId) && ev.kind === 'done') {
      desktopRuns.delete(runId);
      // (the stage's last copy into the live twin is a moment after; then the nudge, as syncMods's)
      setTimeout(() => say({ runDone: runId, ok: ev.ok, changedFiles: ev.changedFiles, nudged: sync.changed() }), 1500);
    }
  },
  // (host.js onClientLine for a run's request: remoteRefusal, then remoteCommand with Remote.tool)
  onRequest: (run, line, respond) => {
    const req = JSON.parse(line);
    const answer = (o) => respond(JSON.stringify({ id: req.id, ...o }));
    const refused = R.remoteRefusal(run, req.cmd, req.args);
    if (refused) return answer({ ok: false, error: refused });
    const viaPhone = R.remoteCommand(run, req.cmd, req.args, (r, c, a) => remote.tool(r, c, a));
    if (viaPhone) { viaPhone.then((result) => answer({ ok: true, result }), (e) => answer({ ok: false, error: e.message })); return undefined; }
    return answer({ ok: false, error: 'the stand-in computer answers only `trif phone`' });
  },
});
remote = new Remote(store, server, runs, { home, log: () => {}, agent: () => ({ id: 'claude', name: 'Stand-in agent', model: null }) });
const sync = new PhoneSync(store, server, runs, { home, getWorkspace: () => P.workspace(home), log: () => {} });
const sites = path.join(home, 'sites');
// A path inside sites/phone~*/ (refused otherwise: this stand-in writes only where the sync may).
function twinPath(rel) {
  const p = path.resolve(sites, String(rel || ''));
  const r = path.relative(sites, p);
  if (!/^phone~[^/\\]+[/\\][^/\\]+\.js$/.test(r)) throw new Error(`not a phone twin file: ${rel}`);
  return p;
}
function twin() {
  const out = {};
  for (const d of fs.readdirSync(sites)) {
    if (!d.startsWith('phone~')) continue;
    for (const f of fs.readdirSync(path.join(sites, d))) if (f.endsWith('.js')) out[`${d}/${f}`] = fs.readFileSync(path.join(sites, d, f), 'utf8');
  }
  return out;
}

const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await runs.stopAll(300);
    remote.stop();
    sync.stop();
    store.pairStop();
    await server.stop();
  } finally {
    for (const d of [home, `${home}-private`]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* left */ } }
    process.exit(0);
  }
}

(async () => {
  await store.setOn(true);
  await server.start();
  remote.start();
  sync.start();
  // (held.js's first look, as the helper's at its start: what's there is the user's, so what a sync brings from now
  // on is judged; a desktop mod so that the look is remembered)
  fs.mkdirSync(path.join(sites, 'other.example'), { recursive: true });
  fs.writeFileSync(path.join(sites, 'other.example', 'seed.js'), '// ==WebMod==\n// @name Seed\n// ==/WebMod==\n');
  held.updateHeld(P.workspace(home), scanMods(P.workspace(home).modsDir).mods, []);
  const qr = store.pairStart().qr;
  say({ port: await server.sync(), qr, home });
  setTimeout(stop, seconds * 1000).unref();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  let queue = Promise.resolve(); // (one line at a time, in order)
  readline.createInterface({ input: process.stdin }).on('line', (line) => { queue = queue.then(() => command(line)).catch((e) => say({ error: e.message })); });
  async function command(line) {
    const [cmd, arg] = line.trim().split(/\s+/);
    const rest = line.trim().split(/\s+/).slice(2).join(' ');
    if (cmd === 'pair') { const q = store.pairStart().qr; say({ qr: q, port: await server.sync() }); }
    else if (cmd === 'go') { go(arg); say({ go: arg }); }
    else if (cmd === 'list') say({ phones: store.list().map((p) => ({ id: p.id, name: p.name })) });
    else if (cmd === 'remove') { const all = store.list(); for (const p of all) store.remove(p.id); say({ removed: all.length }); }
    else if (cmd === 'kept') { const kept = {}; for (const [id, r] of remote.records) (kept[r.phone] = kept[r.phone] || []).push({ runId: id, done: !!r.done }); say({ kept }); }
    else if (cmd === 'twin') say({ twin: twin() });
    else if (cmd === 'write') {
      const p = twinPath(arg);
      const text = JSON.parse(rest);
      if (typeof text !== 'string') throw new Error('write <rel> <JSON string>');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
      say({ wrote: arg, nudged: sync.changed() });
    } else if (cmd === 'delete') {
      const p = twinPath(arg);
      const trash = path.join(home, 'trash', `${Date.now()}-${path.basename(path.dirname(p))}-${path.basename(p)}`);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(p, trash);
      say({ deleted: arg, nudged: sync.changed() });
    } else if (cmd === 'run') {
      const { runId } = runs.start({ agent: 'claude', site: arg, url: `https://${arg}/`, scope: `phone~${arg}`, phone: { device: 'iPhone SE', width: 375 }, prompt: rest });
      desktopRuns.add(runId);
      say({ run: runId });
    } else if (cmd === 'nudge') say({ nudged: sync.changed() });
    else if (cmd === 'synced') { const out = {}; for (const p of store.list()) out[p.id] = sync.status(p.id); say({ synced: out }); }
    else if (cmd === 'held') {
      const out = {};
      for (const [id, h] of Object.entries(held.loadHeld(P.workspace(home).home) || {})) if (id.startsWith('phone~')) out[id] = h;
      say({ held: out });
    } else if (cmd === 'quit') await stop();
  }
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); stop(); });
