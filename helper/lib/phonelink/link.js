'use strict';
// The phone link as the helper holds it (docs/PHONE-LINK.md "The pieces"): host.js makes one Link and asks it
// everything; the Store, the Server, the Announcer and the Remote are made here.
//
//   - Only the helper that owns helper.sock owns the link (`start()`, called where host.js becomes primary;
//     `stop()` when it shuts down or finds helper.sock isn't its own any more). Any other helper has the store
//     alone: it can show the link, turn it on or off and remove a phone (the file, which the owner follows:
//     `refresh()`), but it has no listener, no announcer and no runs, and can't open a pairing window (the
//     window is in the owner's memory).
//   - Nothing listens here either: server.js binds only when the store says so (on, and a phone paired or a
//     window open). A new install has none of it.
//   - `command()` is the side panel's alone (host.js PANEL_COMMANDS: the extension's connection, never the
//     socket, never a run). What it answers has no key and no secret but the QR's text, which goes to the
//     panel that asked and nowhere else (not the log, not the `phoneLink` message).
//
//   - Phone sync (docs/PHONE-SYNC.md; syncsession.js) rides the owner's server: on for a paired phone (pairing is
//     the opt-in), and its sync.* handlers answer `off` once the user turns syncing off in Settings (`phone.sync`,
//     the store's `sync`, D11).
//
// TRIF_PHONE_LINK_HOST (tests): 127.0.0.1 or ::1, so a test's listener is never on the network. Anything else
// is not taken: the variable can only narrow where the listener is.

const { EventEmitter } = require('events');
const { Store } = require('./store');
const { Server } = require('./server');
const { Announcer } = require('./bonjour');
const { Remote } = require('./remote');
const { PhoneSync } = require('./syncsession');
const { deleteBase } = require('./sync');
const P = require('../paths');
const { envVar } = require('../env');

const COMMANDS = ['phone.status', 'phone.on', 'phone.off', 'phone.pair.start', 'phone.pair.stop', 'phone.remove', 'phone.sync'];
const LOOPBACK = new Set(['127.0.0.1', '::1']);

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

class Link extends EventEmitter {
  /**
   * home: the workspace. runs: the helper's Runs. version: TRIF's. log: (line) => void.
   * agent: () => {id, name, model} | null (the computer's default agent: remote.js).
   * getWorkspace: for remote.js and the sync. afterWrite: () => held map | null (syncsession.js: the helper looks
   * at the mods again after the sync wrote one). switches: the phone twins' switches in the browser, {get, set}
   * (syncsession.js; host.js keeps the extension's last report). env: the helper's (the keyring's stand-in and dns-sd's, in tests).
   * Emits 'change' when what `status()` says may have changed.
   */
  constructor({ home, runs, version, log, agent, getWorkspace, afterWrite, switches, env = process.env, name } = {}) {
    super();
    this.log = typeof log === 'function' ? log : () => {};
    this.env = env;
    this.store = new Store(home, { env, ...(name ? { name } : {}) });
    this.runs = runs;
    this.version = version;
    this.agent = agent;
    this.getWorkspace = getWorkspace;
    this.afterWrite = afterWrite;
    this.switches = switches;
    this.home = home;
    this.server = null;
    this.announcer = null;
    this.remote = null; // (kept after stop(): a phone run still ending is still not the panel's)
    this.sync = null;
    this.owner = false;
    this.seen = this._signature();
    this.changed = () => { this.seen = this._signature(); this.emit('change'); };
    this.store.on('change', this.changed);
  }

  /** What another helper would have to change in the file for this one to act on it. */
  _signature() {
    let s;
    try { s = this.store.read(); } catch { return ''; }
    return JSON.stringify([s.on, s.sync, s.publicKey, s.phones.map((p) => [p.id, p.name])]);
  }

  /** The file as another helper left it: when it changed, the store says so (the listener follows, the panel is told). */
  refresh() {
    if (this._signature() !== this.seen) this.store.emit('change');
  }

  /** This helper owns helper.sock: the listener (when the store says so), the announcer and the runs are its own now. */
  async start() {
    if (this.owner) return;
    this.owner = true;
    const host = envVar('PHONE_LINK_HOST', this.env);
    this.server = new Server(this.store, { version: this.version, log: this.log, ...(LOOPBACK.has(host) ? { host } : {}) });
    this.announcer = new Announcer(this.store, this.server, { env: this.env, log: this.log });
    this.remote = new Remote(this.store, this.server, this.runs, { home: this.home, getWorkspace: this.getWorkspace, log: this.log, agent: this.agent });
    this.remote.start();
    this.sync = new PhoneSync(this.store, this.server, this.runs, {
      home: this.home, getWorkspace: this.getWorkspace, log: this.log, afterWrite: this.afterWrite, switches: this.switches,
      enabled: () => { try { return this.store.read().sync !== false; } catch { return false; } },
    }).start();
    for (const ev of ['listening', 'stopped']) this.server.on(ev, () => this.emit('change'));
    this.announcer.on('change', () => this.emit('change'));
    const server = this.server;
    try { await server.start(); } catch (e) { this.log(`phone link: couldn't start (${e.message})`); }
    if (this.server === server) this.announcer.start(); // (not stopped meanwhile)
    this.emit('change');
  }

  /** The helper is going: no announcement and no new run from now on (runs that are going end first: stop()). */
  closing() {
    if (!this.owner) return;
    if (this.announcer) this.announcer.stop();
    if (this.server) this.server.handlers.delete('run.start');
  }

  /** Not the owner any more (shutting down, or helper.sock is another helper's): nothing listens, nothing announces. */
  async stop() {
    if (!this.owner) return;
    this.owner = false;
    const { server, announcer, remote, sync } = this;
    this.server = null;
    this.sync = null;
    if (sync) sync.stop();
    this.announcer = null;
    this.store.pairStop();
    if (remote) remote.stop();
    if (announcer) announcer.stop();
    if (server) { try { await server.stop(); } catch { /* closed anyway */ } }
    this.emit('change');
  }

  /**
   * A phone twin changed on this computer (host.js syncMods, not for the sync's own writes): each connected phone
   * is nudged to sync. Nothing when syncing is off or this helper doesn't own the link.
   */
  syncChanged() {
    return this.owner && this.sync ? this.sync.changed() : 0;
  }

  /** A run's event: true when the run is a phone's (then it isn't the extension's to see). */
  onEvent(runId, event) {
    return this.remote ? this.remote.onEvent(runId, event) : false;
  }

  /** `trif phone …` of a phone run (remoterun.js remoteCommand), or null in a helper without the link. */
  get tool() {
    return this.owner && this.remote ? (run, cmd, args) => this.remote.tool(run, cmd, args) : null;
  }

  /**
   * For the panel: the store's status (no key, no secret), and
   *   here: this helper owns the link (else another browser's does: pairing is done from there)
   *   listening: a listener is up              announce: null | 'unsupported' | 'missing' | 'failing'
   *   sync: the switch (D11); each phone's `synced`: what its last sync did, since this helper started, or null
   *     ({at, fromPhone, toPhone, waiting, conflicts: [name], skipped}: syncsession.js status)
   */
  status() {
    const a = this.announcer ? this.announcer.status() : null;
    const st = this.store.status();
    const synced = (id) => { const r = this.sync ? this.sync.status(id) : null; return r ? { ...r } : null; };
    return { ...st, phones: st.phones.map((p) => ({ ...p, synced: synced(p.id) })), here: this.owner, listening: !!(this.server && this.server.address()), announce: a ? a.error : null };
  }

  /** A `phone.*` command from the side panel. Resolves what the panel is answered. */
  async command(cmd, args = {}) {
    switch (cmd) {
      case 'phone.status': return this.status();
      case 'phone.on':
      case 'phone.off': {
        const r = await this.store.setOn(cmd === 'phone.on');
        this.log(`phone link: turned ${r.on ? 'on' : 'off'} in the side panel${r.created ? ' (a new key for this computer)' : ''}`);
        if (this.server) await this.server.sync();
        return this.status();
      }
      case 'phone.pair.start': {
        if (!this.owner) throw fail('elsewhere', 'another browser\'s TRIF has the phone link just now: connect the phone from that browser');
        const { qr, expires } = this.store.pairStart(); // (throws while the link is off)
        const port = await this.server.sync();
        if (!port) { this.store.pairStop(); throw fail('no-listener', 'this computer couldn\'t open a port for the phone to reach'); }
        this.log('phone link: a phone may pair for the next 5 minutes');
        return { qr, expires, ...this.status() };
      }
      case 'phone.pair.stop':
        this.store.pairStop();
        if (this.server) await this.server.sync();
        return this.status();
      case 'phone.remove': {
        const removed = this.store.remove(typeof args.id === 'string' ? args.id : '');
        if (removed) {
          this.log(`phone link: removed the phone ${removed.id}`);
          // (its sync base goes with it: pairing again starts from none, PHONE-SYNC.md section 3)
          try { deleteBase((this.getWorkspace ? this.getWorkspace() : P.workspace(this.home)).private, removed.id); } catch (e) { this.log(`phone sync: couldn't delete a removed phone's base (${e.code || e.message})`); }
        }
        if (this.server) await this.server.sync();
        return { removed, ...this.status() };
      }
      case 'phone.sync': {
        const on = this.store.setSync(args.on !== false);
        this.log(`phone sync: turned ${on ? 'on' : 'off'} in the side panel`);
        if (!on && this.sync) this.sync.syncs.clear(); // (a sync going on ends: its next sync.* is answered off)
        return this.status();
      }
      default: throw new Error(`unknown command "${cmd}"`);
    }
  }
}

module.exports = { Link, COMMANDS };
