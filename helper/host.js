#!/usr/bin/env node
'use strict';
// WebMods native messaging host. Chrome launches this when the extension calls
// chrome.runtime.connectNative('com.webmods.helper').
//
//  - stdin/stdout: native messaging with the extension (4-byte LE length + JSON). NOTHING else may
//    ever be written to stdout; logs go to $WEBMODS_HOME/helper.log.
//  - $WEBMODS_HOME/helper.sock: newline-delimited JSON for the `webmods` CLI.
//  - watches $WEBMODS_HOME/sites and pushes {type:"mods"} to the extension on connect and on change.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { workspace, VERSION } = require('./lib/paths');
const { createLogger } = require('./lib/log');
const { encode, Decoder, MAX_TO_EXTENSION } = require('./lib/framing');
const { scanMods, planModsMessage, folderFingerprint, summarize } = require('./lib/mods');

const ws = workspace();
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
  helloAt: null,
  modsApplied: null,
  mods: [],
  modErrors: [],
  modWarnings: [],
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
      state.hello = { version: msg.version ?? null, userScripts: !!msg.userScripts, chrome: msg.chrome ?? null };
      state.helloAt = Date.now();
      logger.info(`hello from extension ${msg.version} on Chrome ${msg.chrome}; userScripts=${!!msg.userScripts}`);
      syncMods('hello', true);
      break;
    case 'response':
      onExtensionResponse(msg);
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
  const signature = plan.mods.map((m) => `${m.id}:${m.hash}`).join('|');
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
    sendToExtension({ type: 'mods', mods: plan.mods });
    logger.info(`sent ${plan.mods.length} mod(s) to the extension (${reason})`);
  } catch (e) {
    logger.error(`could not send mods: ${e.message}`);
  }
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

// ---------------------------------------------------------------- unix socket for the CLI

let server = null;
let serverIno = null;
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

function listen() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer(onClient);
    srv.once('error', reject);
    const oldMask = process.umask(0o177); // socket created as 0600
    try {
      srv.listen(ws.sock, () => {
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
  logger.info(`another helper is already serving ${ws.sock} (another Chrome profile?); this one only syncs mods for its profile`);
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
  });
}

function helperInfo() {
  return {
    helper: VERSION,
    pid: process.pid,
    node: process.version,
    role: state.role,
    home: ws.home,
    modsDir: ws.modsDir,
    startedAt: state.startedAt,
    connected: state.stdoutOpen,
    extension: state.hello ? { ...state.hello, at: state.helloAt } : null,
    mods: state.mods.map((m) => m.id),
    modErrors: state.modErrors,
    modWarnings: state.modWarnings,
    modsApplied: state.modsApplied,
    pending: pending.size,
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

  if (cmd === 'ping') return reply(sock, { id, ok: true, result: helperInfo() });
  if (cmd === 'mods') {
    return reply(sock, {
      id, ok: true,
      result: { modsDir: ws.modsDir, mods: state.mods.map(summarize), errors: state.modErrors, warnings: state.modWarnings },
    });
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
    reply(p.sock, { id: p.clientId, ok: false, error: 'Chrome disconnected from the helper before answering' });
  }
  pending.clear();
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    // Only remove the socket if it's still ours (a newer helper may have replaced it).
    try {
      if (serverIno === null || fs.statSync(ws.sock).ino === serverIno) fs.unlinkSync(ws.sock);
    } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 50);
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
  const role = await becomePrimary();
  if (role === 'busy' && !state.shuttingDown) startSecondaryChecks();
  else if (role === 'error') state.role = 'no-socket';
})();
