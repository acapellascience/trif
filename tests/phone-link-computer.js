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

const seconds = Number((process.argv.find((a, i) => process.argv[i - 1] === '--seconds')) || 120);
const chain = makeFakeKeychain(path.join(home, 'keychain'));
const store = new Store(home, { env: { ...chain.env }, name: 'Stand-in Mac' });
const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, log: () => {} });
let remote = null;
const runs = new Runs({
  getWorkspace: () => P.workspace(home),
  logger: { info() {}, debug() {}, error() {}, warn() {} },
  onEvent: (runId, ev) => { remote.onEvent(runId, ev); },
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

const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await runs.stopAll(300);
    remote.stop();
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
  const qr = store.pairStart().qr;
  say({ port: await server.sync(), qr, home });
  setTimeout(stop, seconds * 1000).unref();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  let queue = Promise.resolve(); // (one line at a time, in order)
  readline.createInterface({ input: process.stdin }).on('line', (line) => { queue = queue.then(() => command(line)).catch((e) => say({ error: e.message })); });
  async function command(line) {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (cmd === 'pair') { const q = store.pairStart().qr; say({ qr: q, port: await server.sync() }); }
    else if (cmd === 'go') { go(arg); say({ go: arg }); }
    else if (cmd === 'list') say({ phones: store.list().map((p) => ({ id: p.id, name: p.name })) });
    else if (cmd === 'remove') { const all = store.list(); for (const p of all) store.remove(p.id); say({ removed: all.length }); }
    else if (cmd === 'kept') { const kept = {}; for (const [id, r] of remote.records) (kept[r.phone] = kept[r.phone] || []).push({ runId: id, done: !!r.done }); say({ kept }); }
    else if (cmd === 'quit') await stop();
  }
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); stop(); });
