#!/usr/bin/env node
'use strict';
// WebMods native messaging host. Chrome launches this when the extension calls
// chrome.runtime.connectNative('com.webmods.helper').
//
//  - stdin/stdout: native messaging with the extension (4-byte LE length + JSON). NOTHING else may
//    ever be written to stdout; logs go to $WEBMODS_HOME/helper.log.
//  - $WEBMODS_HOME/helper.sock: newline-delimited JSON for the `webmods` CLI.
//  - watches $WEBMODS_HOME/sites and pushes {type:"mods"} to the extension on connect and on change.
//  - runs the user's coding agent for the side panel (agent.list / agent.start / agent.stop requests
//    from the extension or the CLI), sending progress as {type:"agentEvent", runId, event}; and logs
//    the agent in (agent.login / agent.loginCode / agent.loginCancel, events under the loginId).
//  - limits each agent run to its site: `webmods` inside a run sends the run's token, and its page
//    commands go to the extension with args.scope; mods a run writes for other sites are held (held.js).

const fs = require('fs');
const net = require('net');
const path = require('path');
const { workspace, VERSION } = require('./lib/paths');
const { createLogger } = require('./lib/log');
const { encode, Decoder, MAX_TO_EXTENSION } = require('./lib/framing');
const { scanMods, planModsMessage, folderFingerprint, summarize } = require('./lib/mods');
const { Runs } = require('./lib/runs');
const { Logins } = require('./lib/logins');
const agents = require('./lib/agents');
const { updateHeld, approveHeld } = require('./lib/held');
const { startOffIds } = require('./lib/preinstalled');
const { readInstructions, writeInstructions, instructionsFile, MAX_LENGTH } = require('./lib/instructions');
const { ownSock, removeStaleSockets } = require('./lib/helpers');
const { loadOrigins, recordOrigins, activeRuns } = require('./lib/origins');
const { deleteMod, restoreMod, emptyTrash } = require('./lib/trash');

const ws = workspace();
// This helper's own socket (helper-<pid>.sock), served whether or not it also owns helper.sock; agent
// runs get it as WEBMODS_SOCK so their `webmods` commands reach this browser (lib/helpers.js).
ws.ownSock = ownSock(ws.home);
try { fs.mkdirSync(ws.home, { recursive: true }); } catch { /* logged below if it matters */ }
const logger = createLogger(ws.log, { stderr: true });

// Protect the native messaging channel: anything that tries to print goes to the log instead.
console.log = (...a) => logger.info(...a);
console.info = (...a) => logger.info(...a);
console.debug = (...a) => logger.debug(...a);
console.warn = (...a) => logger.warn(...a);
console.error = (...a) => logger.error(...a);
console.trace = (...a) => logger.debug(...a);

const GRACE_MS = Number(process.env.WEBMODS_TIMEOUT_GRACE) >= 0 && process.env.WEBMODS_TIMEOUT_GRACE !== undefined
  ? Number(process.env.WEBMODS_TIMEOUT_GRACE) : 5000;
const DEFAULT_TIMEOUT_MS = 30000 + GRACE_MS; // 35 s with the default grace
const DEBOUNCE_MS = 150;
const POLL_MS = 2000;
const SECONDARY_CHECK_MS = 500;

const state = {
  startedAt: Date.now(),
  role: 'starting', // 'primary' (serves the socket) | 'secondary' (mod sync only)
  hello: null,
  knownIds: null, // mod ids the last scan saw (null before the first): new ones get an origin
  helloAt: null,
  modsApplied: null,
  mods: [],
  modErrors: [],
  modWarnings: [],
  held: {}, // mod id -> held entry (see lib/held.js)
  lastSignature: null,
  lastFingerprint: null,
  stdoutOpen: true,
  shuttingDown: false,
};

logger.info(`host ${VERSION} starting (node ${process.version}, home ${ws.home}, mods ${ws.modsDir}, args ${JSON.stringify(process.argv.slice(2))})`);
if (ws.configError) logger.warn(ws.configError);

// ---------------------------------------------------------------- native messaging

function sendToExtension(msg) {
  if (!state.stdoutOpen) throw new Error('the extension is not connected (stdout closed)');
  const frame = encode(msg);
  if (frame.length - 4 > MAX_TO_EXTENSION) {
    throw new Error(`message is ${Math.ceil((frame.length - 4) / 1024)} KB; Chrome's native messaging limit is 1 MB`);
  }
  process.stdout.write(frame);
}

process.stdout.on('error', (e) => {
  state.stdoutOpen = false;
  logger.warn(`stdout error (${e.code || e.message}); Chrome went away`);
  shutdown('stdout closed');
});

const decoder = new Decoder(onExtensionMessage, (e) => logger.error('native messaging:', e.message));
process.stdin.on('data', (chunk) => decoder.push(chunk));
process.stdin.on('end', () => shutdown('stdin closed (Chrome disconnected)'));
process.stdin.on('close', () => shutdown('stdin closed (Chrome disconnected)'));
process.stdin.on('error', (e) => shutdown(`stdin error: ${e.message}`));

function onExtensionMessage(msg) {
  if (!msg || typeof msg !== 'object') return logger.warn('ignoring non-object message from extension');
  switch (msg.type) {
    case 'hello':
      state.hello = {
        version: msg.version ?? null, userScripts: !!msg.userScripts, chrome: msg.chrome ?? null, browser: msg.browser ?? 'Chrome',
        installId: typeof msg.installId === 'string' && msg.installId ? msg.installId : null,
      };
      state.helloAt = Date.now();
      logger.info(`hello from extension ${msg.version} on ${state.hello.browser} ${msg.chrome}; userScripts=${!!msg.userScripts}`);
      syncMods('hello', true);
      break;
    case 'response':
      onExtensionResponse(msg);
      break;
    case 'request':
      onExtensionRequest(msg);
      break;
    case 'modsApplied':
      state.modsApplied = {
        registered: Array.isArray(msg.registered) ? msg.registered : [],
        errors: Array.isArray(msg.errors) ? msg.errors : [],
        at: Date.now(),
      };
      logger.info(`extension registered ${state.modsApplied.registered.length} mod(s)`);
      for (const e of state.modsApplied.errors) logger.warn(`extension could not register ${e.id}: ${e.error}`);
      break;
    case 'log': {
      const level = ['error', 'warn', 'info', 'debug'].includes(msg.level) ? msg.level : 'info';
      logger.write(level, '[extension]', String(msg.message));
      break;
    }
    default:
      logger.warn(`unknown message type from extension: ${JSON.stringify(msg).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- mods folder

let debounceTimer = null;
let pollTimer = null;
const watchers = new Map(); // dir -> FSWatcher
let watchMode = null; // 'recursive' | 'per-dir'
let watchedDirIno = null;

function scheduleSync(reason) {
  if (state.shuttingDown) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncMods(reason, false), DEBOUNCE_MS);
}

function syncMods(reason, force) {
  if (state.shuttingDown) return;
  clearTimeout(debounceTimer);
  ensureWatchers();
  state.lastFingerprint = folderFingerprint(ws.modsDir);
  const { mods, problems, warnings } = scanMods(ws.modsDir);
  const plan = planModsMessage(mods);
  try { state.held = updateHeld(ws, mods, runs.scopes()); } catch (e) { logger.error(`held mods: ${e.message}`); }
  const origins = trackOrigins(mods);
  // Held mods still go to the extension (the panel lists them with an Allow button), marked so they aren't
  // registered. Preinstalled mods are marked startOff: the extension switches them off when it first sees them.
  const startOff = startOffIds(ws.home);
  const sent = plan.mods.map((m) => {
    const out = state.held[m.id] ? { ...m, held: { site: state.held[m.id].site, reason: state.held[m.id].reason } } : m;
    const o = origins[m.id];
    const withOrigin = o ? { ...out, origin: { by: o.by, browser: o.browser } } : out;
    return startOff.has(m.id) ? { ...withOrigin, startOff: true } : withOrigin;
  });
  const signature = sent.map((m) => `${m.id}:${m.hash}${m.held ? ':held' : ''}${m.startOff ? ':off' : ''}${m.origin ? `:${m.origin.by}` : ''}`).join('|');
  const errors = [...problems, ...plan.errors];
  const errorsChanged = JSON.stringify(errors) !== JSON.stringify(state.modErrors);
  state.mods = mods;
  state.modErrors = errors;
  state.modWarnings = warnings;
  if (errorsChanged) {
    for (const e of errors) logger.error(`mod ${e.id}: ${e.error}`);
    for (const w of warnings) logger.warn(`mod ${w.id}: ${w.warning}`);
  }
  if (!force && signature === state.lastSignature) return;
  state.lastSignature = signature;
  try {
    sendToExtension({ type: 'mods', mods: sent });
    const nHeld = sent.filter((m) => m.held).length;
    logger.info(`sent ${sent.length} mod(s) to the extension${nHeld ? ` (${nHeld} held)` : ''} (${reason})`);
  } catch (e) {
    logger.error(`could not send mods: ${e.message}`);
  }
}

/**
 * Attribute mod ids this scan sees for the first time (not on the first scan: those existed before this
 * helper started) to the agent run that made them, and return all origins (lib/origins.js).
 */
function trackOrigins(mods) {
  const ids = new Set(mods.map((m) => m.id));
  if (state.knownIds) {
    const fresh = [...ids].filter((id) => !state.knownIds.has(id));
    if (fresh.length) {
      // Every helper reads the same run markers (this one's runs included), so they all agree.
      const me = state.hello?.installId || null;
      let active = [];
      try { active = activeRuns(ws.home).map((r) => ({ ...r, own: !!me && r.by === me })); } catch (e) { logger.warn(`active runs: ${e.message}`); }
      active.sort((a, b) => Number(b.own) - Number(a.own));
      try {
        if (recordOrigins(ws.home, fresh, active)) logger.info(`recorded where ${fresh.join(', ')} came from`);
      } catch (e) { logger.error(`origins: ${e.message}`); }
    }
  }
  state.knownIds = ids;
  return loadOrigins(ws.home);
}

function closeWatchers() {
  for (const w of watchers.values()) { try { w.close(); } catch { /* ignore */ } }
  watchers.clear();
}

function addWatcher(dir, recursive) {
  const w = fs.watch(dir, { recursive }, () => scheduleSync('change'));
  w.on('error', (e) => {
    logger.warn(`watcher error on ${dir}: ${e.message}`);
    try { w.close(); } catch { /* ignore */ }
    watchers.delete(dir);
    scheduleSync('watcher error');
  });
  watchers.set(dir, w);
}

function ensureWatchers() {
  if (state.shuttingDown) return;
  let st = null;
  try { st = fs.statSync(ws.modsDir); } catch { /* missing */ }
  if (!st) {
    try {
      fs.mkdirSync(ws.modsDir, { recursive: true });
      st = fs.statSync(ws.modsDir);
      logger.info(`created mods folder ${ws.modsDir}`);
    } catch (e) {
      if (watchers.size) closeWatchers();
      return;
    }
  }
  // The folder was deleted and recreated: old watchers point at nothing.
  if (watchedDirIno !== null && watchedDirIno !== st.ino) closeWatchers();
  watchedDirIno = st.ino;

  if (watchMode !== 'per-dir' && !watchers.has(ws.modsDir)) {
    try {
      addWatcher(ws.modsDir, true);
      watchMode = 'recursive';
      return;
    } catch (e) {
      if (watchMode === 'recursive') { logger.warn(`could not watch ${ws.modsDir}: ${e.message}`); return; }
      watchMode = 'per-dir'; // recursive fs.watch unsupported (Linux on Node < 20)
      logger.info('recursive fs.watch unavailable; watching folders individually');
    }
  }
  if (watchMode === 'per-dir') {
    const wanted = new Set([ws.modsDir]);
    try {
      for (const d of fs.readdirSync(ws.modsDir, { withFileTypes: true })) {
        if (d.isDirectory()) wanted.add(path.join(ws.modsDir, d.name));
      }
    } catch { /* ignore */ }
    for (const [dir, w] of watchers) if (!wanted.has(dir)) { try { w.close(); } catch { /* ignore */ } watchers.delete(dir); }
    for (const dir of wanted) if (!watchers.has(dir)) { try { addWatcher(dir, false); } catch { /* ignore */ } }
  }
}

// Safety net for missed events (editors doing atomic renames, folders deleted out from under us).
function poll() {
  if (state.shuttingDown) return;
  ensureWatchers();
  const fp = folderFingerprint(ws.modsDir);
  if (fp !== state.lastFingerprint) scheduleSync('poll');
}

// ---------------------------------------------------------------- agent runs (side panel)

// config.json can change while Chrome runs (`webmods setup` re-records PATH), so re-read it per run.
// ownSock rides along so runs can give agents WEBMODS_SOCK (a fresh workspace() doesn't have it), and the
// extension's install id so runs mark themselves for the other browsers (lib/origins.js).
const runs = new Runs({
  getWorkspace: () => ({ ...workspace(ws.home), ownSock: ws.ownSock, installId: state.hello?.installId || null, browser: state.hello?.browser || '' }),
  logger, onEvent: onAgentEvent,
});
const logins = new Logins({ getWorkspace: () => workspace(ws.home), logger, onEvent: onAgentEvent });
const runSubscribers = new Map(); // runId or loginId -> Set of CLI sockets that started it (see onClientLine)
const AGENT_COMMANDS = new Set(['agent.list', 'agent.start', 'agent.stop', 'agent.login', 'agent.loginCode', 'agent.loginCancel', 'mod.approve',
  'instructions.get', 'instructions.set']);
// Helper-local too, but a run may use them (on mods inside its scope; see lib/trash.js).
const MOD_FILE_COMMANDS = new Set(['mod.delete', 'mod.restore']);

function onAgentEvent(runId, event) {
  // Before the run's last event goes out: hold what it wrote for other sites, and say so in `done`.
  if (event && event.kind === 'done' && String(runId).startsWith('r')) {
    syncMods('agent done', false);
    const held = Object.entries(state.held).filter(([, h]) => h.runId === runId).map(([id, h]) => ({ id, reason: h.reason }));
    if (held.length) event.held = held;
  }
  // A run that found the agent logged out: agent.list shouldn't keep saying it's logged in.
  if (event && event.kind === 'error' && /isn't logged in/.test(String(event.message))) agents.forgetLoginStatus();
  // Every run goes to the extension (panels ignore runs they didn't start).
  if (state.stdoutOpen) {
    try { sendToExtension({ type: 'agentEvent', runId, event }); } catch (e) { logger.warn(`could not send agent event: ${e.message}`); }
  }
  const subs = runSubscribers.get(runId);
  if (subs) for (const s of subs) reply(s, { type: 'agentEvent', runId, event });
  if (event.kind === 'done') runSubscribers.delete(runId);
}

// Helper-local agent commands, answered the same way for the extension and the CLI. Throws on error;
// agent.list returns a promise (it checks login status).
function agentCommand(cmd, args) {
  switch (cmd) {
    case 'agent.list': return agents.listAgentsWithLogin(workspace(ws.home));
    case 'agent.start': return runs.start(args);
    case 'agent.stop': return runs.stop(args.runId);
    case 'agent.login': return logins.start(args);
    case 'agent.loginCode': return logins.code(args.loginId, args.code);
    case 'mod.approve': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('missing mod id');
      approveHeld(ws.home, id);
      logger.info(`approved held mod ${id}`);
      syncMods('approve', false);
      return { id, approved: true };
    }
    case 'mod.delete': {
      const r = deleteMod(ws, args.id, { scope: args.scope });
      logger.info(`deleted mod ${r.id} (to ${r.trashed})`);
      syncMods('delete', false);
      return { id: r.id, deleted: true };
    }
    case 'mod.restore': {
      const r = restoreMod(ws, args.id, { scope: args.scope });
      logger.info(`restored mod ${r.id}`);
      syncMods('restore', false);
      return { id: r.id, restored: true, file: r.file };
    }
    case 'instructions.get': return { text: readInstructions(ws.home), file: instructionsFile(ws.home), max: MAX_LENGTH };
    case 'instructions.set': {
      const text = writeInstructions(ws.home, args.text);
      logger.info(text ? `instructions saved (${text.length} chars)` : 'instructions cleared');
      return { text, file: instructionsFile(ws.home), max: MAX_LENGTH };
    }
    default: return logins.cancel(args.loginId);
  }
}

// Run an agent command and call done(error, result): synchronously when the command is synchronous,
// so agent.start / agent.login are answered before their first event.
function runAgentCommand(cmd, args, done) {
  let result;
  try { result = agentCommand(cmd, args); } catch (e) { return done(e); }
  if (result && typeof result.then === 'function') result.then((r) => done(null, r), (e) => done(e));
  else done(null, result);
}

// The extension asks the helper things too (side panel): {type:"request", id, cmd, args} -> response.
function onExtensionRequest(msg) {
  const id = msg.id;
  const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
  const respond = (body) => {
    try { sendToExtension({ type: 'response', id, ...body }); } catch (e) { logger.warn(`could not answer extension request ${id}: ${e.message}`); }
  };
  if (!AGENT_COMMANDS.has(msg.cmd) && !MOD_FILE_COMMANDS.has(msg.cmd)) return respond({ ok: false, error: `unknown command "${msg.cmd}"` });
  runAgentCommand(msg.cmd, args, (e, result) => {
    if (e) {
      logger.warn(`${msg.cmd} failed: ${e.message}`);
      return respond({ ok: false, error: e.message });
    }
    respond({ ok: true, result: result === undefined ? null : result });
  });
}

// ---------------------------------------------------------------- unix socket for the CLI

let server = null;
let serverIno = null;
let ownServer = null;
let secondaryTimer = null;
let lastSecondaryProbe = 0;
const pending = new Map(); // extension request id -> { sock, clientId, timer, cmd }
let requestCounter = 0;

function probe(sockPath) {
  return new Promise((resolve) => {
    const s = net.connect(sockPath);
    const done = (alive) => { s.destroy(); resolve(alive); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 1000).unref();
  });
}

function listen(sockPath = ws.sock) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer(onClient);
    srv.once('error', reject);
    const oldMask = process.umask(0o177); // socket created as 0600
    try {
      srv.listen(sockPath, () => {
        srv.removeListener('error', reject);
        srv.on('error', (e) => logger.error(`socket server error: ${e.message}`));
        resolve(srv);
      });
    } finally {
      process.umask(oldMask);
    }
  });
}

// Returns 'primary', 'busy' (another live helper owns the socket) or 'error'.
async function becomePrimary() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (state.shuttingDown) return 'error';
    try {
      server = await listen();
      try { fs.chmodSync(ws.sock, 0o600); } catch { /* ignore */ }
      try { serverIno = fs.statSync(ws.sock).ino; } catch { serverIno = null; }
      state.role = 'primary';
      stopSecondaryChecks();
      logger.info(`serving CLI on ${ws.sock}`);
      return 'primary';
    } catch (e) {
      if (e.code !== 'EADDRINUSE') {
        logger.error(`can't listen on ${ws.sock}: ${e.message}` +
          (Buffer.byteLength(ws.sock) > 100 ? ' (the path is too long for a unix socket; use a shorter WEBMODS_HOME)' : ''));
        return 'error';
      }
      if (await probe(ws.sock)) return 'busy'; // someone live owns it
      logger.info(`removing stale socket ${ws.sock}`);
      try { fs.unlinkSync(ws.sock); } catch (u) {
        if (u.code !== 'ENOENT') { logger.error(`can't remove stale socket: ${u.message}`); return 'error'; }
      }
    }
  }
  return 'error';
}

function stopSecondaryChecks() {
  clearInterval(secondaryTimer);
  secondaryTimer = null;
}

function startSecondaryChecks() {
  if (secondaryTimer) return;
  state.role = 'secondary';
  logger.info(`another helper is already serving ${ws.sock} (another browser or Chrome profile); this one serves ${ws.ownSock} for its own browser's agent runs and \`webmods --browser\``);
  let busy = false;
  secondaryTimer = setInterval(async () => {
    if (busy || state.shuttingDown) return;
    busy = true;
    try {
      const exists = fs.existsSync(ws.sock);
      const now = Date.now();
      // Take over when the other helper goes away (socket removed, or left stale by a crash).
      if (!exists || now - lastSecondaryProbe > 5000) {
        lastSecondaryProbe = now;
        if (!exists || !(await probe(ws.sock))) {
          if ((await becomePrimary()) === 'primary') logger.info('took over the CLI socket');
        }
      }
    } finally {
      busy = false;
    }
  }, SECONDARY_CHECK_MS);
}

function reply(sock, msg) {
  if (sock.destroyed || !sock.writable) return;
  try { sock.write(JSON.stringify(msg) + '\n'); } catch (e) { logger.warn(`reply failed: ${e.message}`); }
}

function onClient(sock) {
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) onClientLine(sock, line);
    }
  });
  sock.on('error', () => { /* client went away */ });
  sock.on('close', () => {
    for (const [id, p] of pending) {
      if (p.sock === sock) { clearTimeout(p.timer); pending.delete(id); }
    }
    for (const [runId, subs] of runSubscribers) {
      subs.delete(sock);
      if (!subs.size) runSubscribers.delete(runId);
    }
  });
}

function helperInfo() {
  return {
    helper: VERSION,
    pid: process.pid,
    node: process.version,
    role: state.role,
    home: ws.home,
    sock: ws.ownSock,
    modsDir: ws.modsDir,
    startedAt: state.startedAt,
    connected: state.stdoutOpen,
    extension: state.hello ? { ...state.hello, at: state.helloAt } : null,
    mods: state.mods.map((m) => m.id),
    modErrors: state.modErrors,
    modWarnings: state.modWarnings,
    modsApplied: state.modsApplied,
    pending: pending.size,
    runs: runs.list(),
    held: state.held,
    login: logins.info(),
  };
}

function onClientLine(sock, line) {
  let req;
  try { req = JSON.parse(line); } catch (e) {
    return reply(sock, { id: null, ok: false, error: `bad request JSON: ${e.message}` });
  }
  const { id, cmd } = req || {};
  const args = req && req.args && typeof req.args === 'object' ? req.args : {};
  if (typeof cmd !== 'string' || !cmd) return reply(sock, { id, ok: false, error: 'missing cmd' });

  // From inside an agent run (`webmods` sends the run's token): only page commands, limited to its site.
  if (req.token !== undefined) {
    const run = runs.byToken(req.token);
    if (!run) return reply(sock, { id, ok: false, error: 'this agent run has ended (or its token is wrong)' });
    if (AGENT_COMMANDS.has(cmd)) {
      return reply(sock, { id, ok: false, error: cmd === 'mod.approve'
        ? 'only the user can approve a held mod (in the side panel, or `webmods approve` in their terminal)'
        : `"${cmd}" isn't available inside an agent run` });
    }
    args.scope = run.scope;
  }

  if (cmd === 'ping') return reply(sock, { id, ok: true, result: helperInfo() });
  if (cmd === 'mods') {
    return reply(sock, {
      id, ok: true,
      result: {
        modsDir: ws.modsDir, errors: state.modErrors, warnings: state.modWarnings,
        mods: state.mods.map((m) => (state.held[m.id] ? { ...summarize(m), held: state.held[m.id] } : summarize(m))),
      },
    });
  }

  // Agent commands are helper-local. Streaming: after answering agent.start with {runId} (or
  // agent.login with {loginId}), the same connection receives {type:"agentEvent", runId, event} lines
  // (no `id`; runId is the loginId for a login), ending with the event whose kind is "done". The client
  // may send more requests on the connection meanwhile (agent.loginCode) and closes it after "done".
  if (AGENT_COMMANDS.has(cmd) || MOD_FILE_COMMANDS.has(cmd)) {
    runAgentCommand(cmd, args, (e, result) => {
      if (e) return reply(sock, { id, ok: false, error: e.message });
      reply(sock, { id, ok: true, result: result === undefined ? null : result });
      const streamId = result && ((cmd === 'agent.start' && result.runId) || (cmd === 'agent.login' && result.loginId));
      if (streamId) {
        if (!runSubscribers.has(streamId)) runSubscribers.set(streamId, new Set());
        runSubscribers.get(streamId).add(sock);
      }
    });
    return;
  }

  // Everything else is a page command for the extension.
  const extId = `h${++requestCounter}`;
  const timeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout + GRACE_MS : DEFAULT_TIMEOUT_MS;
  try {
    sendToExtension({ type: 'request', id: extId, cmd, args });
  } catch (e) {
    return reply(sock, { id, ok: false, error: `could not send "${cmd}" to the extension: ${e.message}` });
  }
  const timer = setTimeout(() => {
    pending.delete(extId);
    logger.warn(`request ${extId} (${cmd}) timed out after ${timeoutMs}ms`);
    reply(sock, { id, ok: false, error: `timed out after ${timeoutMs}ms waiting for the extension to answer "${cmd}"` });
  }, timeoutMs);
  pending.set(extId, { sock, clientId: id, timer, cmd });
}

function onExtensionResponse(msg) {
  const p = pending.get(msg.id);
  if (!p) return logger.warn(`response for unknown or expired request ${msg.id}`);
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) reply(p.sock, { id: p.clientId, ok: true, result: msg.result === undefined ? null : msg.result });
  else reply(p.sock, { id: p.clientId, ok: false, error: String(msg.error ?? 'unknown error from extension') });
}

// ---------------------------------------------------------------- lifecycle

function shutdown(reason, code = 0) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logger.info(`shutting down: ${reason}`);
  clearTimeout(debounceTimer);
  clearInterval(pollTimer);
  stopSecondaryChecks();
  closeWatchers();
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    reply(p.sock, { id: p.clientId, ok: false, error: 'the browser disconnected from the helper before answering' });
  }
  pending.clear();
  // Agents die with the helper (SIGTERM, SIGKILL after a moment); their final events still go out.
  const agentsGone = Promise.all([runs.stopAll(), logins.stopAll()]);
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    // Only remove the socket if it's still ours (a newer helper may have replaced it).
    try {
      if (serverIno === null || fs.statSync(ws.sock).ino === serverIno) fs.unlinkSync(ws.sock);
    } catch { /* already gone */ }
  }
  if (ownServer) {
    try { ownServer.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(ws.ownSock); } catch { /* already gone */ }
  }
  agentsGone.then(() => setTimeout(() => process.exit(code), 50));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('uncaughtException', (e) => logger.error('uncaught exception:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => logger.error('unhandled rejection:', e && e.stack ? e.stack : e));

(async function main() {
  // Mods go out immediately on connect (and again after the extension's hello).
  syncMods('connect', true);
  pollTimer = setInterval(poll, POLL_MS);
  for (const s of removeStaleSockets(ws.home)) logger.info(`removed stale socket ${s}`);
  try { const n = emptyTrash(ws); if (n) logger.info(`emptied ${n} mod(s) from the trash (older than 30 days)`); } catch (e) { logger.warn(`could not empty the trash: ${e.message}`); }
  try {
    try { fs.unlinkSync(ws.ownSock); } catch { /* none */ }
    ownServer = await listen(ws.ownSock);
    fs.chmodSync(ws.ownSock, 0o600);
  } catch (e) {
    logger.error(`can't listen on ${ws.ownSock}: ${e.message}`);
  }
  const role = await becomePrimary();
  if (role === 'busy' && !state.shuttingDown) startSecondaryChecks();
  else if (role === 'error') state.role = 'no-socket';
})();
