'use strict';
// The wire side of a phone run (docs/PHONE-LINK.md sections 4 and 6): what a paired phone's session may ask
// about runs, and what is kept for a phone that went away.
//
//   run.start   → Runs.startRemote (remoterun.js): the site is made from the page address by the helper; the
//                 phone that asks is the session's (the paired key's), never a field of the message.
//   run.event   every event of the run, numbered from 1, to the phone's live session while it follows the run
//                 (the session that started it, or the one that last sent run.resume for it).
//   run.result  after `done`: the phone twin's files the run wrote or changed, and the ones it removed.
//   run.resume  the kept events after a number, then the result if the run is over, then live ones.
//   run.ack     the phone has the result: the kept run is deleted.
//   run.stop    stops a run of the phone's own.
//   tool.request / tool.result   the agent's `trif phone …` (Remote.tool): asked of the session that follows the
//                 run, answered by that same session within a minute, or the command fails and says why.
//
// Kept: each run's events and result, in memory and in <private>/phone-link/kept/<phone id>/<runId>.json (mode
// 600) until the phone acks it, 7 days at most after it ended; gone at once when the phone is removed (the
// store's 'change'), and a removed phone's run that is still going is stopped. The page copy and the screenshot
// are never kept: only what the agent said and the mods it wrote.
//
// A phone reaches only its own runs: every request is answered from the session's phone id, and another
// phone's run id is answered exactly as one that doesn't exist (`no-run`).
//
// Nothing here chooses a folder or a file from what a phone sends: the result is read from the run's own
// `done` (its changed files), and of those only the files of the run's own phone twin (stage.js ownTwin).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../paths');
const { remoteScope, toolRequest, writeToolShot, REMOTE_TOOLS, AWAY, SHOT_MAX } = require('./remoterun');
const { ownTwin } = require('../stage');
const { parseHeader } = require('../mods');
const { splitsOf } = require('../sitecombos');

const KEEP_MS = 7 * 24 * 3600 * 1000; // (a kept run, after it ended)
const MAX_EVENTS = 4000; // (kept per run; beyond it the oldest go, the run's end never)
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_KEPT = 20; // (runs kept per phone; one more and the oldest finished one goes)
const MAX_LIVE = 3; // (runs going at once for one phone)
const MOD_MAX = 1024 * 1024; // (one mod's code in a result)
const RESULT_MAX = 6 * 1024 * 1024; // (a result's code together: it must fit one 8 MB message)
const FLUSH_MS = 1000; // (events are written to the kept file this long after the first unwritten one)
const SESSIONS_PER_TWIN = 5;
const SESSIONS_FILE = 'sessions.json';
const TOOL_MS = 60 * 1000; // (how long the phone has to answer a tool.request)
const TOOL_TEXT_MAX = 200 * 1000; // (characters of a tool.result's text the agent is given)
const TOOLS_AT_ONCE = 4; // (tool requests waiting for one run's phone)

const PHONE_ID = /^[0-9a-f]{16}$/;
const RUN_ID = /^r[0-9a-z]{6,40}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const word = (v, max) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, max) : '');
// (a tool's answer: lines and tabs stay, other control characters go)
const answerText = (v) => (typeof v === 'string' ? v.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ').slice(0, TOOL_TEXT_MAX) : '');

/** The phone's screenshot as it travels (base64 in the message) → a Buffer. Throws `bad-request`, `too-big`. */
function decodeShot(v) {
  if (typeof v !== 'string' || !v) throw fail('bad-request', 'the phone\'s screenshot isn\'t an image');
  if (v.length > Math.ceil(SHOT_MAX / 3) * 4) throw fail('too-big', `the phone's screenshot is over ${SHOT_MAX / 1024 / 1024} MB`);
  if (v.length % 4 !== 0 || !BASE64.test(v)) throw fail('bad-request', 'the phone\'s screenshot isn\'t an image');
  return Buffer.from(v, 'base64');
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * What a finished run leaves for the phone: {mods: [{id, name, code}], removed: [id]}, from the run's own
 * changed files (`done.changedFiles`: paths in the workspace), of which only its own phone twin's .js files
 * count. A mod too big to send is named without its code (`tooBig`). `ws`: {home, modsDir}.
 */
function resultOf(ws, scope, splits, changedFiles) {
  const mods = [];
  const removed = [];
  let total = 0;
  for (const f of Array.isArray(changedFiles) ? changedFiles : []) {
    const rel = typeof f === 'string' ? f : f && typeof f.path === 'string' ? f.path : '';
    if (!rel) continue;
    const parts = path.relative(ws.modsDir, path.resolve(ws.home, rel)).split(path.sep);
    if (parts.length !== 2 || !ownTwin(parts[0], scope, splits) || !/^[^._][^/\\]*\.js$/.test(parts[1])) continue;
    const id = `${parts[0]}/${parts[1].slice(0, -3)}`;
    const file = path.join(ws.modsDir, parts[0], parts[1]);
    let code = null;
    let big = false;
    try {
      if (!fs.lstatSync(path.join(ws.modsDir, parts[0])).isDirectory()) continue; // (a link where the twin was: not read)
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) continue;
        if (st.size > MOD_MAX || total + st.size > RESULT_MAX) big = true;
        else code = fs.readFileSync(fd, 'utf8');
      } finally { fs.closeSync(fd); }
    } catch (e) {
      if (e.code === 'ENOENT') removed.push(id);
      continue;
    }
    if (big) { mods.push({ id, name: parts[1].slice(0, -3), tooBig: true }); continue; }
    total += Buffer.byteLength(code, 'utf8');
    let name = null;
    try { name = parseHeader(code).name; } catch { /* the file's name then */ }
    mods.push({ id, name: name || parts[1].slice(0, -3), code });
  }
  return { mods, removed };
}

class Remote {
  /**
   * store, server: the phone link's Store and Server. runs: the helper's Runs (its onEvent must call
   * `remote.onEvent(runId, event)`: host.js). Options:
   *   home: the workspace (or getWorkspace: () => {home, private, modsDir}).   log: (line) => void.
   *   agent: () => {id, name, model} | null, the computer's default agent: `id` and `model` start the run,
   *     the whole of it is `hello`'s `agent` (for the phone to show).
   *   now, keepMs, flushMs, toolMs: for tests.
   */
  constructor(store, server, runs, opts = {}) {
    this.store = store;
    this.server = server;
    this.runs = runs;
    this.getWorkspace = typeof opts.getWorkspace === 'function' ? opts.getWorkspace : () => P.workspace(opts.home);
    this.log = typeof opts.log === 'function' ? opts.log : () => {};
    this.agent = typeof opts.agent === 'function' ? opts.agent : () => null;
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.keepMs = opts.keepMs || KEEP_MS;
    this.flushMs = opts.flushMs || FLUSH_MS;
    this.toolMs = opts.toolMs || TOOL_MS;
    this.tools = new Map(); // (tool.request id -> what waits for the phone's tool.result)
    this.records = new Map(); // runId -> record
    this.orphans = new Set(); // (run ids still going whose phone was removed: theirs no more, and never the panel's)
    this.started = false;
    this.onChange = () => { try { this._removed(); } catch (e) { this.log(`phone link: couldn't clear a removed phone's kept runs (${e.message})`); } };
  }

  /** Takes the run requests on the server, follows the store, reads what was kept. */
  start() {
    if (this.started) return this;
    this.started = true;
    this.server.helloMore = (session) => this.hello(session);
    this.server.handle('run.start', (session, msg) => this._start(session, msg));
    this.server.handle('run.stop', (session, msg) => this._stop(session, msg));
    this.server.handle('run.resume', (session, msg) => this._resume(session, msg));
    this.server.handle('run.ack', (session, msg) => this._ack(session, msg));
    this.server.handle('tool.result', (session, msg) => this._toolResult(session, msg));
    this.store.on('change', this.onChange);
    try { this._load(); } catch (e) { this.log(`phone link: couldn't read the kept runs (${e.message})`); }
    return this;
  }

  /** Writes what isn't written yet and lets go of the server and the store. (Runs go on: the helper's.) */
  stop() {
    if (!this.started) return;
    this.started = false;
    this.store.removeListener('change', this.onChange);
    for (const t of ['run.start', 'run.stop', 'run.resume', 'run.ack', 'tool.result']) this.server.handlers.delete(t);
    this.server.helloMore = () => ({});
    for (const p of [...this.tools.values()]) p.fail(fail('away', AWAY));
    for (const rec of this.records.values()) { if (rec.timer) this._write(rec); rec.session = null; }
  }

  /** More for the `hello` answer: the agent the computer would use, and this phone's kept runs. */
  hello(session) {
    this._prune();
    const mine = this._of(session.phone.id);
    return {
      agent: this._agent().shown,
      pending: mine.map((r) => ({ runId: r.runId, chat: r.chat, startedAt: r.startedAt, done: r.done, last: r.n })),
    };
  }

  /**
   * An event of a run, from the helper's Runs. True when the run is a phone's: the event went to the phone
   * (or was kept for it), and is not the side panel's to show.
   */
  onEvent(runId, event) {
    const rec = this.records.get(runId);
    if (!rec) {
      if (!this.orphans.has(runId)) return false;
      if (event && event.kind === 'done') this.orphans.delete(runId);
      return true;
    }
    if (rec.done || !event || typeof event !== 'object') return true;
    rec.n++;
    const item = { n: rec.n, event };
    rec.events.push(item);
    rec.bytes += (item.size = JSON.stringify(event).length);
    while (rec.events.length > 1 && (rec.events.length > MAX_EVENTS || rec.bytes > MAX_EVENT_BYTES)) rec.bytes -= rec.events.shift().size;
    if (event.kind === 'done') this._done(rec, event);
    else this._later(rec);
    this._send(rec, { t: 'run.event', runId, n: item.n, event });
    if (rec.done) this._sendResult(rec);
    return true;
  }

  /**
   * A `trif phone` command of a phone run's agent (remoterun.js remoteCommand; `run`: the helper's live run,
   * found by its token): asks the phone that follows the run and resolves with its answer, {text, file (the
   * screenshot it sent, in the run's screenshots folder) | null, error (the phone couldn't do it)}. Rejects,
   * in words for the agent, when the run isn't a phone's, when no session follows it (the app is closed or
   * asleep), when the phone goes away or the run ends meanwhile, and after a minute without an answer.
   */
  tool(run, cmd, args) {
    return new Promise((resolve, reject) => {
      const rec = run && run.remote ? this.records.get(run.id) : null;
      if (!rec || rec.done || rec.phone !== run.remote.phone.id || !REMOTE_TOOLS.has(cmd)) throw fail('not-remote', 'this isn\'t a run for a phone (any more)');
      const { tool, input } = toolRequest(run, cmd, args);
      const session = rec.session;
      if (!session || !session.open) { rec.session = null; throw fail('away', AWAY); }
      if ([...this.tools.values()].filter((p) => p.rec === rec).length >= TOOLS_AT_ONCE) throw fail('busy', 'the phone is still answering your earlier `trif phone` commands: wait for them');
      const id = `t${crypto.randomBytes(8).toString('hex')}`;
      const settle = (fn, v) => {
        if (!this.tools.delete(id)) return;
        clearTimeout(p.timer);
        session.removeListener('close', p.gone);
        fn(v);
      };
      const p = {
        rec, run, session,
        done: (v) => settle(resolve, v),
        fail: (e) => settle(reject, e),
        gone: () => p.fail(fail('away', `the phone went away before it answered: ${AWAY}`)),
        timer: setTimeout(() => p.fail(fail('timeout', `the phone didn't answer in ${Math.round(this.toolMs / 1000)} seconds (the page there may be busy, or the user put the phone down): try once more, then finish from what you have and say what you couldn't try`)), this.toolMs),
      };
      if (p.timer.unref) p.timer.unref();
      this.tools.set(id, p);
      session.once('close', p.gone);
      let sent = false;
      try { sent = session.send({ t: 'tool.request', id, runId: rec.runId, tool, input }); } catch (e) { p.fail(fail('too-big', `couldn't send that to the phone (${e.message})`)); return; }
      if (!sent) p.fail(fail('away', AWAY));
    });
  }

  // The phone's answer to a tool.request: taken only from the session it was sent to. Anything else (an id
  // this computer never made, another phone's, a second answer) is dropped without a word.
  _toolResult(session, msg) {
    const p = typeof msg.id === 'string' ? this.tools.get(msg.id) : null;
    if (!p || p.session !== session) return;
    let text = answerText(msg.text);
    let file = null;
    if (msg.shot !== undefined && msg.shot !== null) {
      try { file = writeToolShot(p.run, decodeShot(msg.shot)); } catch { file = null; }
      if (!file) text += `${text ? '\n' : ''}(the phone sent a screenshot that isn't a JPEG or a PNG: not saved)`;
    }
    p.done({ text, file, error: msg.error === true });
  }

  _toolsOver(rec, why) {
    for (const p of [...this.tools.values()]) { if (p.rec === rec) p.fail(fail('away', why)); }
  }

  // ------------------------------------------------------------ what a session asks

  _start(session, msg) {
    const phone = session.phone;
    this._prune();
    const ws = this.getWorkspace();
    const splits = splitsOf(ws.home);
    const { scope } = remoteScope(msg.url, splits); // (`bad-url`)
    if (this._of(phone.id).filter((r) => !r.done).length >= MAX_LIVE) throw fail('busy', 'this computer is already working on as many pages as it takes from one phone');
    const shot = msg.shot === undefined || msg.shot === null ? undefined : decodeShot(msg.shot);
    // A conversation to go on with: only one that a run of this phone's, in the same phone twin, ended with.
    const sessionId = typeof msg.session === 'string' && this._knows(phone.id, scope, msg.session) ? msg.session : null;
    const agent = this._agent();
    const width = Number.isInteger(msg.width) ? msg.width : (session.hello && session.hello.device.width) || undefined;
    let started;
    try {
      started = this.runs.startRemote({ phone, splits, sessionId, agent: agent.id, model: agent.model }, { url: msg.url, prompt: msg.prompt, page: msg.page, shot, width });
    } catch (e) {
      if (e && e.code) throw e;
      if (/^already working on /.test(e.message)) throw fail('busy', 'this computer is already working on that site');
      if (/^unknown agent /.test(e.message)) throw fail('no-agent', 'no coding agent is set up on this computer');
      throw fail('failed', e.message);
    }
    // (Runs.start launches on the next tick, so no event of the run comes before its record is here.)
    const rec = {
      v: 1, runId: started.runId, phone: phone.id, site: started.site, scope: started.scope, splits, chat: word(msg.chat, 80),
      pid: process.pid, startedAt: this.now(), endedAt: null, n: 0, done: false, sessionId: null, events: [], result: null,
      bytes: 0, timer: null, session,
    };
    this.records.set(rec.runId, rec);
    const mine = this._of(phone.id);
    for (const old of mine.filter((r) => r.done).slice(0, Math.max(0, mine.length - MAX_KEPT))) this._forget(old);
    this._write(rec);
    return { t: 'run.started', runId: rec.runId };
  }

  _stop(session, msg) {
    const rec = this._own(session, msg.runId);
    if (!rec.done) { try { this.runs.stop(rec.runId); } catch { /* it ended meanwhile */ } }
    return {};
  }

  // (Answers itself, so that the answer goes before the events it promises.)
  _resume(session, msg) {
    const rec = this._own(session, msg.runId);
    const after = Number.isInteger(msg.after) && msg.after > 0 ? msg.after : 0;
    const id = typeof msg.id === 'string' || Number.isInteger(msg.id) ? { id: msg.id } : {};
    rec.session = session;
    session.send({ t: 'ok', ...id, runId: rec.runId, first: rec.events.length ? rec.events[0].n : rec.n + 1, last: rec.n, done: rec.done });
    for (const item of rec.events) {
      if (item.n > after && !session.send({ t: 'run.event', runId: rec.runId, n: item.n, event: item.event })) return;
    }
    if (rec.done) this._sendResult(rec);
  }

  _ack(session, msg) {
    const rec = this._mine(session, msg.runId);
    if (!rec) return {}; // (acked before, or never there: the same answer)
    if (!rec.done) throw fail('bad-request', 'that run is still working');
    this._forget(rec);
    return {};
  }

  // ------------------------------------------------------------ records

  _of(phoneId) {
    return [...this.records.values()].filter((r) => r.phone === phoneId).sort((a, b) => a.startedAt - b.startedAt);
  }

  _mine(session, runId) {
    const rec = typeof runId === 'string' ? this.records.get(runId) : null;
    return rec && rec.phone === session.phone.id ? rec : null;
  }

  _own(session, runId) {
    const rec = this._mine(session, runId);
    if (!rec) throw fail('no-run', 'this computer has no such run for this phone (any more)');
    return rec;
  }

  _agent() {
    let a = null;
    try { a = this.agent(); } catch { a = null; }
    if (!a || typeof a !== 'object') return { shown: null };
    const id = typeof a.id === 'string' && a.id ? a.id : undefined;
    const model = typeof a.model === 'string' && a.model ? a.model : undefined;
    return { id, model, shown: { name: word(a.name || id || '', 60), model: word(model || '', 80) || null } };
  }

  _done(rec, event) {
    rec.done = true;
    this._toolsOver(rec, 'the run ended before the phone answered');
    rec.endedAt = this.now();
    rec.sessionId = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : null;
    try { rec.result = resultOf(this.getWorkspace(), rec.scope, rec.splits, event.changedFiles); } catch (e) {
      this.log(`phone link: couldn't read run ${rec.runId}'s result (${e.message})`);
      rec.result = { mods: [], removed: [] };
    }
    if (rec.sessionId) this._remember(rec.phone, rec.scope, rec.sessionId);
    this._write(rec);
  }

  _send(rec, obj) {
    const s = rec.session;
    if (!s || !s.open) { rec.session = null; return false; }
    try { return s.send(obj); } catch { return false; }
  }

  _sendResult(rec) {
    const r = rec.result || { mods: [], removed: [] };
    this._send(rec, { t: 'run.result', runId: rec.runId, mods: r.mods, removed: r.removed });
  }

  // ------------------------------------------------------------ kept files

  _dir(phoneId) {
    return path.join(this.getWorkspace().private, 'phone-link', 'kept', ...(phoneId ? [phoneId] : []));
  }

  _later(rec) {
    if (rec.timer) return;
    rec.timer = setTimeout(() => this._write(rec), this.flushMs);
    if (rec.timer.unref) rec.timer.unref();
  }

  _put(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  _write(rec) {
    clearTimeout(rec.timer);
    rec.timer = null;
    if (!this.records.has(rec.runId)) return;
    const { bytes, timer, session, events, ...kept } = rec;
    try { this._put(path.join(this._dir(rec.phone), `${rec.runId}.json`), { ...kept, events: events.map((i) => ({ n: i.n, event: i.event })) }); } catch (e) {
      this.log(`phone link: couldn't keep run ${rec.runId} for the phone (${e.code || e.message})`);
    }
  }

  _forget(rec) {
    this._toolsOver(rec, 'this run isn\'t the phone\'s any more');
    clearTimeout(rec.timer);
    rec.timer = null;
    rec.session = null;
    this.records.delete(rec.runId);
    try { fs.unlinkSync(path.join(this._dir(rec.phone), `${rec.runId}.json`)); } catch { /* not written, or gone */ }
  }

  _prune() {
    const now = this.now();
    for (const rec of [...this.records.values()]) {
      if (rec.done && (rec.endedAt || rec.startedAt) + this.keepMs < now) this._forget(rec);
    }
  }

  // The conversations a phone's runs ended with, by phone twin: what `session` in run.start may name.
  _sessions(phoneId) {
    try {
      const all = JSON.parse(fs.readFileSync(path.join(this._dir(phoneId), SESSIONS_FILE), 'utf8'));
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch { return {}; }
  }

  _knows(phoneId, scope, sessionId) {
    const list = this._sessions(phoneId)[scope];
    return Array.isArray(list) && list.includes(sessionId);
  }

  _remember(phoneId, scope, sessionId) {
    const all = this._sessions(phoneId);
    const list = (Array.isArray(all[scope]) ? all[scope] : []).filter((s) => s !== sessionId);
    delete all[scope];
    const next = { ...Object.fromEntries(Object.entries(all).slice(-49)), [scope]: [...list, sessionId].slice(-SESSIONS_PER_TWIN) };
    try { this._put(path.join(this._dir(phoneId), SESSIONS_FILE), next); } catch (e) {
      this.log(`phone link: couldn't keep the run's conversation for the phone (${e.code || e.message})`);
    }
  }

  /** The store changed: whatever is kept for a phone that isn't paired any more goes, and its runs stop. */
  _removed() {
    const paired = new Set(this.store.list().map((p) => p.id));
    for (const rec of [...this.records.values()]) {
      if (paired.has(rec.phone)) continue;
      if (!rec.done) {
        this.orphans.add(rec.runId);
        try { this.runs.stop(rec.runId); } catch { this.orphans.delete(rec.runId); }
      }
      this._forget(rec);
    }
    let names = [];
    try { names = fs.readdirSync(this._dir()); } catch { return; }
    for (const name of names) {
      if (!paired.has(name)) fs.rmSync(path.join(this._dir(), name), { recursive: true, force: true });
    }
  }

  /** What was kept before this helper started. A run that was still going when its helper went is ended here. */
  _load() {
    this._removed();
    const now = this.now();
    let phones = [];
    try { phones = fs.readdirSync(this._dir()); } catch { return; }
    for (const phoneId of phones) {
      if (!PHONE_ID.test(phoneId)) continue;
      let names = [];
      try { names = fs.readdirSync(this._dir(phoneId)); } catch { continue; }
      for (const name of names) {
        const file = path.join(this._dir(phoneId), name);
        if (name === SESSIONS_FILE) continue;
        const runId = name.endsWith('.json') ? name.slice(0, -5) : '';
        let rec = null;
        try { if (RUN_ID.test(runId)) rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { rec = null; }
        const good = rec && typeof rec === 'object' && rec.v === 1 && rec.runId === runId && rec.phone === phoneId && Array.isArray(rec.events)
          && typeof rec.scope === 'string' && Number.isFinite(rec.startedAt) && Number.isInteger(rec.n);
        if (!good || (rec.done && (rec.endedAt || rec.startedAt) + this.keepMs < now)) { try { fs.unlinkSync(file); } catch { /* left */ } continue; }
        if (this.records.has(runId)) continue;
        if (!rec.done && rec.pid !== process.pid && alive(rec.pid)) continue; // (another helper's, still going: not this one's to end)
        rec.events = rec.events.filter((i) => i && Number.isInteger(i.n) && i.event && typeof i.event === 'object').map((i) => ({ n: i.n, event: i.event, size: JSON.stringify(i.event).length }));
        rec.bytes = rec.events.reduce((sum, i) => sum + i.size, 0);
        rec.splits = Array.isArray(rec.splits) ? rec.splits.filter((s) => typeof s === 'string') : [];
        rec.chat = word(rec.chat, 80);
        rec.timer = null;
        rec.session = null;
        this.records.set(runId, rec);
        if (!rec.done) {
          // (agent-run wording, as runs.js says it when the helper shuts down with a run going)
          for (const event of [{ kind: 'error', message: 'TRIF on the computer stopped before the agent finished' }, { kind: 'done', ok: false, result: null, costUsd: null, changedFiles: [], sessionId: null }]) {
            rec.n++;
            rec.events.push({ n: rec.n, event, size: JSON.stringify(event).length });
          }
          rec.done = true;
          rec.endedAt = now;
          rec.result = { mods: [], removed: [] };
          this._write(rec);
        }
      }
    }
  }
}

module.exports = { Remote, resultOf, decodeShot, KEEP_MS, MAX_KEPT, MAX_LIVE, MAX_EVENTS };
