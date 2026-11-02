#!/usr/bin/env node
'use strict';
// TRIF native messaging host. Chrome launches this when the extension calls
// chrome.runtime.connectNative('com.webmods.helper').
//
//  - stdin/stdout: native messaging with the extension (4-byte LE length + JSON). NOTHING else may
//    ever be written to stdout; logs go to $TRIF_HOME/helper.log.
//  - $TRIF_HOME/helper.sock: newline-delimited JSON for the `trif` CLI.
//  - watches $TRIF_HOME/sites and pushes {type:"mods"} to the extension on connect and on change.
//  - runs the user's coding agent for the side panel (agent.list / agent.start / agent.stop requests
//    from the extension or the CLI), sending progress as {type:"agentEvent", runId, event}; and logs
//    the agent in (agent.login / agent.loginCode / agent.loginCancel, events under the loginId).
//  - limits each agent run to its site: `trif` inside a run sends the run's token, and its page
//    commands go to the extension with args.scope; mods a run writes for other sites are held (held.js).
//  - checks for updates (lib/update.js) and tells the extension {type:"update", update}; installs them
//    when asked (or by itself with "autoUpdate"), then asks it to {type:"reload"} onto the new version.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { envVar } = require('./lib/env');
const { workspace, VERSION } = require('./lib/paths');
const { createLogger } = require('./lib/log');
const { encode, Decoder, MAX_TO_EXTENSION } = require('./lib/framing');
const { scanMods, planModsMessage, folderFingerprint, summarize } = require('./lib/mods');
const { Runs } = require('./lib/runs');
const { Logins } = require('./lib/logins');
const agents = require('./lib/agents');
const { updateHeld, approveHeld, heldFile } = require('./lib/held');
const { startOffIds, startSitesOn, pendingUpdates, useNewVersion, keepMine, mergeRequest, mergeSettled, restoreMod } = require('./lib/preinstalled');
const { readInstructions, writeInstructions, instructionsFile, MAX_LENGTH } = require('./lib/instructions');
const { ownSock, removeStaleSockets, codeStamp } = require('./lib/helpers');
const { loadOrigins, recordOrigins, activeRuns } = require('./lib/origins');
const { deleteMod, emptyTrash } = require('./lib/trash');
const { scopeFor } = require('./lib/scope');
const update = require('./lib/update');
const { buildReport, reportEmail, reportUrl } = require('./lib/report');

const ws = workspace();
// This helper's own socket (helper-<pid>.sock), served whether or not it also owns helper.sock; agent
// runs get it as TRIF_SOCK so their `trif` commands reach this browser (lib/helpers.js).
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

const GRACE_MS = Number(envVar('TIMEOUT_GRACE')) >= 0 && envVar('TIMEOUT_GRACE') !== undefined
  ? Number(envVar('TIMEOUT_GRACE')) : 5000;
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
  updates: {}, // mod id -> new shipped version waiting (see lib/preinstalled.js pendingUpdates)
  lastSignature: null,
  lastFingerprint: null,
  stdoutOpen: true,
  shuttingDown: false,
  installing: false, // an update is being installed
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

const decoder = new Decoder(onExtensionMessage, (e) => {
  logger.error('native messaging:', e.message);
  // After an oversize frame every later frame would be misread, so start over: the extension reconnects.
  if (e.fatal) shutdown('unreadable input from the extension', 1);
});
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
      sendUpdate();
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
  state.lastFingerprint = fingerprint();
  const { mods, problems, warnings } = scanMods(ws.modsDir);
  const plan = planModsMessage(mods);
  try { state.held = updateHeld(ws, mods, runs.scopes()); } catch (e) { logger.error(`held mods: ${e.message}`); }
  const origins = trackOrigins(mods);
  // Held mods still go to the extension (the panel lists them with an Allow button), marked so they aren't
  // registered. Preinstalled mods are marked startOff: the extension switches them off when it first sees them.
  const startOff = startOffIds(ws.home);
  // A newer version of a shipped mod the user changed (preinstalled.js): the panel offers it on the mod.
  let updates = {};
  try { updates = pendingUpdates(ws.home, mods); } catch (e) { logger.warn(`shipped mod updates: ${e.message}`); }
  state.updates = updates;
  const sent = plan.mods.map((m) => {
    const out = state.held[m.id] ? { ...m, held: { site: state.held[m.id].site, reason: state.held[m.id].reason } } : m;
    const o = origins[m.id];
    const withOrigin = o ? { ...out, origin: { by: o.by, browser: o.browser } } : out;
    const withUpdate = updates[m.id] ? { ...withOrigin, update: updates[m.id] } : withOrigin;
    return startOff.has(m.id) ? { ...withUpdate, startOff: true } : withUpdate;
  });
  // Sites TRIF starts on for (preinstalled.json): each browser turns each one on the first time it sees it.
  const sitesOn = startSitesOn(ws.home);
  const signature = sent.map((m) => `${m.id}:${m.hash}${m.held ? ':held' : ''}${m.startOff ? ':off' : ''}${m.origin ? `:${m.origin.by}` : ''}${m.update ? `:update ${JSON.stringify(m.update)}` : ''}`).join('|') +
    `|sites:${sitesOn.join(',')}`;
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
    sendToExtension({ type: 'mods', mods: sent, sitesOn });
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
// What a sync depends on: the mods folder, held.json (another browser's helper may hold or approve a
// mod; this one must send the change on too), and preinstalled.json (setup, or the user's choice in
// another browser, changes which shipped mods have a new version waiting).
function fingerprint() {
  const stamp = (f) => { try { const st = fs.statSync(f); return `${st.mtimeMs}:${st.size}`; } catch { return ''; } };
  return `${folderFingerprint(ws.modsDir)}\nheld ${stamp(heldFile(ws.home))}\npreinstalled ${stamp(path.join(ws.home, 'preinstalled.json'))}`;
}

function poll() {
  if (state.shuttingDown) return;
  ensureWatchers();
  const fp = fingerprint();
  if (fp !== state.lastFingerprint) scheduleSync('poll');
}

// ---------------------------------------------------------------- agent runs (side panel)

// config.json can change while Chrome runs (`trif setup` re-records PATH), so re-read it per run.
// The extension's install id rides along so runs mark themselves for the other browsers (lib/origins.js).
const runs = new Runs({
  getWorkspace: () => ({ ...workspace(ws.home), installId: state.hello?.installId || null, browser: state.hello?.browser || '' }),
  logger, onEvent: onAgentEvent, onRequest: onRunRequest,
});

/**
 * A request from a run's mailbox (runs.js _serveBox). It's the run's, whatever it says: the run's token
 * goes in, so it's limited to the run's site like any request carrying it. Answered once, through
 * `respond`, by a stand-in for the socket the rest of this file replies on.
 */
function onRunRequest(run, line, respond) {
  let req;
  try { req = JSON.parse(line); } catch { return respond(JSON.stringify({ id: null, ok: false, error: 'bad request JSON' })); }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return respond(JSON.stringify({ id: null, ok: false, error: 'bad request' }));
  const answer = { destroyed: false, writable: true, write(text) { if (this.destroyed) return; this.destroyed = true; this.writable = false; respond(text); } };
  onClientLine(answer, JSON.stringify({ ...req, token: run.token }));
}
const logins = new Logins({ getWorkspace: () => workspace(ws.home), logger, onEvent: onAgentEvent });
const runSubscribers = new Map(); // runId or loginId -> Set of CLI sockets that started it (see onClientLine)
const AGENT_COMMANDS = new Set(['agent.list', 'agent.start', 'agent.stop', 'agent.login', 'agent.loginCode', 'agent.loginCancel', 'mod.approve',
  'mod.update', 'instructions.get', 'instructions.set', 'agent.models', 'agent.openModel', 'agent.openModel.set', 'update.check', 'update.install', 'update.setAuto', 'report.build']);
// Helper-local too, but a run may use them (on mods inside its scope; see lib/trash.js).
const MOD_FILE_COMMANDS = new Set(['mod.delete', 'mod.restore']);

// Merges proposed in a side-panel chat (agent.start with `merge`): mod id -> {scope, hash, version,
// before} (preinstalled.js mergeRequest). The proposing run only explains and asks; the user's go-ahead
// is a later run in the same chat, which edits the file. So after every run on that site (runsOnScope),
// mergeSettled checks whether the user's copy now has the merge (changed since the proposal, with the
// new @version) and, if so, settles the update. In memory: after a helper restart, Merge proposes again.
const pendingMerges = new Map();
const mergeRunIds = new Map(); // runId -> the ids of pendingMerges that run may settle

function settleMerges(runId) {
  const ids = mergeRunIds.get(runId);
  mergeRunIds.delete(runId);
  for (const id of ids || []) {
    const m = pendingMerges.get(id);
    if (!m) continue;
    let r;
    try { r = mergeSettled(workspace(ws.home), id, m); } catch (e) { logger.warn(`couldn't check the merge of ${id}: ${e.message}`); continue; }
    if (r === 'merged') logger.info(`merged the new version of ${id} (run ${runId})`);
    if (r !== 'waiting') pendingMerges.delete(id);
  }
}

function onAgentEvent(runId, event) {
  // A run in a chat with a merge proposed may have done it: settle the update (before the mods go out
  // again below, so the panel's offer goes away with this run's done).
  if (event && event.kind === 'done' && mergeRunIds.has(runId)) settleMerges(runId);
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
  if (event.kind === 'done') { runSubscribers.delete(runId); stopRunRecording(runId); }
}

// The network recorder keeps whole request and response bodies (logins, API calls) for as long as it's
// on, so recording an agent run switches on (`trif record <site> on` from the run) goes off again
// when that run ends: runId -> sites it switched on. Recording the user switched on from a terminal is
// theirs to switch off.
const recordingByRun = new Map();

function noteRecording(runId, result) {
  const site = result && typeof result.site === 'string' ? result.site : null;
  if (!site || !Array.isArray(result.recording)) return;
  if (!result.recording.includes(site)) {
    for (const sites of recordingByRun.values()) sites.delete(site); // off, whoever switched it on
  } else if (runId && result.changed) {
    if (!recordingByRun.has(runId)) recordingByRun.set(runId, new Set());
    recordingByRun.get(runId).add(site);
  }
}

function stopRunRecording(runId) {
  const sites = recordingByRun.get(runId);
  recordingByRun.delete(runId);
  if (!sites) return;
  for (const site of sites) {
    if ([...recordingByRun.values()].some((other) => other.has(site))) continue; // another run still wants it
    logger.info(`recording on ${site} off: run ${runId} that switched it on has ended`);
    const extId = `h${++requestCounter}`;
    try { sendToExtension({ type: 'request', id: extId, cmd: 'record', args: { site, on: false } }); } catch (e) {
      logger.warn(`couldn't switch recording off on ${site}: ${e.message}`);
      continue;
    }
    const sink = { destroyed: false, writable: true, write(text) {
      const r = JSON.parse(text);
      if (!r.ok) logger.warn(`couldn't switch recording off on ${site}: ${r.error}`);
    } };
    pending.set(extId, { sock: sink, clientId: null, timer: setTimeout(() => pending.delete(extId), DEFAULT_TIMEOUT_MS), cmd: 'record', runId: null });
  }
}

// Helper-local agent commands, answered the same way for the extension and the CLI. Throws on error;
// agent.list returns a promise (it checks login status).
function agentCommand(cmd, args) {
  switch (cmd) {
    case 'agent.list': return agents.listAgentsWithLogin(workspace(ws.home));
    case 'agent.models': return agents.agentModels(workspace(ws.home), String(args.agent || ''), { fresh: !!args.fresh, openModel: args.openModel || null });
    // Open models (agents/codex-oss.js): the defaults in config.json, which runs can't read or change.
    case 'agent.openModel': return agents.getAdapter('codex-oss').settings(workspace(ws.home), { check: !!args.check });
    case 'agent.openModel.set': {
      const r = agents.getAdapter('codex-oss').saveSettings(ws.home, args);
      logger.info(`open model settings: ${r.provider}${r.model ? ` ${r.model}` : ''}${r.keyEnv ? ` (key in ${r.keyEnv})` : ''}`);
      return agents.getAdapter('codex-oss').settings(workspace(ws.home));
    }
    case 'agent.start': return startRun(args);
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
    case 'mod.update': {
      // The user's choice for a new version of a shipped mod they changed: 'new' (theirs goes to the
      // trash) or 'mine' (this version isn't offered again). Merging is a run: agent.start with `merge`.
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('missing mod id');
      if (args.choice !== 'new' && args.choice !== 'mine') throw new Error('choice must be "new" or "mine"');
      const r = args.choice === 'new' ? useNewVersion(ws, id) : keepMine(ws, id);
      logger.info(args.choice === 'new' ? `${r.id}: now the new version${r.trashed ? ` (the user's copy is in ${r.trashed})` : ''}` : `${r.id}: kept the user's copy over version ${r.version}`);
      syncMods('mod update', false);
      return args.choice === 'new' ? { id: r.id, choice: 'new', version: r.version, trashed: !!r.trashed } : { id: r.id, choice: 'mine', version: r.version };
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
    case 'update.check': return checkForUpdate(args.force !== false);
    case 'update.install': return installUpdate('asked');
    case 'update.setAuto': {
      update.setConfigKey(ws.home, 'autoUpdate', args.on ? true : undefined);
      logger.info(`automatic updates ${args.on ? 'on' : 'off'}`);
      const info = updateInfo();
      sendUpdate(info);
      if (args.on && info.available) maybeAutoInstall(info);
      return info;
    }
    case 'report.build': return report(args);
    default: return logins.cancel(args.loginId);
  }
}

/**
 * agent.start. With `merge: "<mod id>"`, the run merges the new version of that shipped mod into the
 * user's copy: the helper adds where the three versions are to the prompt, and a run that finishes
 * well settles the update (onAgentEvent). An ordinary run otherwise, with the same scope and rules.
 */
function startRun(args) {
  const site = typeof args.site === 'string' && args.site.trim() ? args.site.trim() : agents.hostOf(args.url);
  const scope = scopeFor(site);
  if (args.merge === undefined || args.merge === null || args.merge === '') {
    const r = runs.start(args);
    const ids = [...pendingMerges].filter(([, m]) => m.scope === scope).map(([id]) => id);
    if (ids.length) mergeRunIds.set(r.runId, ids);
    return r;
  }
  const id = String(args.merge).trim();
  if (scopeFor(id.split('/')[0]) !== scope) throw new Error(`${id} isn't a mod for ${scope || 'this site'}: merge it from its own site`);
  const m = mergeRequest(workspace(ws.home), id);
  const prompt = typeof args.prompt === 'string' && args.prompt.trim() ? `${args.prompt.trim()}\n\n${m.prompt}` : m.prompt;
  const r = runs.start({ ...args, prompt });
  pendingMerges.set(id, { scope, hash: m.hash, version: m.version, before: m.before });
  mergeRunIds.set(r.runId, [...pendingMerges].filter(([, x]) => x.scope === scope).map(([x]) => x));
  logger.info(`run ${r.runId} proposes a merge of the new version of ${id}`);
  return r;
}

// ---------------------------------------------------------------- updates (lib/update.js)

const UPDATE_FIRST_CHECK_MS = Number(envVar('UPDATE_DELAY')) >= 0 && envVar('UPDATE_DELAY') !== undefined
  ? Number(envVar('UPDATE_DELAY')) : 60000;
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000; // the feed itself is fetched at most every 20 hours
let updateTimers = [];

function updateInfo(summary = update.summary(workspace(ws.home))) {
  return { ...summary, installing: state.installing };
}

function sendUpdate(info = updateInfo()) {
  if (!state.stdoutOpen) return;
  try { sendToExtension({ type: 'update', update: info }); } catch (e) { logger.warn(`could not send update info: ${e.message}`); }
}

async function checkForUpdate(force) {
  const info = updateInfo(await update.check(workspace(ws.home), { force }));
  if (info.error) logger.warn(`update check: ${info.error}`);
  else if (info.available) logger.info(`update available: ${info.current} -> ${info.latest}`);
  sendUpdate(info);
  maybeAutoInstall(info);
  return info;
}

// With "autoUpdate" on, install when nothing is running (else on a later check).
function maybeAutoInstall(info) {
  if (!info.auto || !info.available || !info.canInstall || state.installing || runs.list().length) return;
  installUpdate('automatic').catch((e) => logger.warn(`automatic update failed: ${e.message}`));
}

async function installUpdate(why) {
  if (state.installing) throw new Error('an update is already being installed');
  if (runs.list().length) throw new Error("a chat is still running; update when it's done");
  state.installing = true;
  sendUpdate();
  try {
    logger.info(`installing update (${why})`);
    const r = await update.install(workspace(ws.home));
    logger.info(`updated ${r.from} -> ${r.to}`);
    if (r.warning) logger.warn(`update to ${r.to}: ${r.warning}`);
    // The extension reloads (Chrome's unpacked copy from the new files), which starts the new helper.
    if (state.stdoutOpen) {
      try { sendToExtension({ type: 'updated', from: r.from, to: r.to, notes: r.notes }); } catch { /* gone */ }
      setTimeout(() => reloadExtension(`updated to ${r.to}`), 300);
    }
    return { from: r.from, to: r.to, notes: r.notes };
  } finally {
    state.installing = false;
  }
}

function reloadExtension(reason) {
  if (!state.stdoutOpen) return;
  logger.info(`asking the extension to reload: ${reason}`);
  try { sendToExtension({ type: 'reload', reason }); } catch (e) { logger.warn(`could not ask the extension to reload: ${e.message}`); }
}

// Another helper (the other browser's) or `npx trif setup` replaced <home>/app under this one: this
// process is running old code, so reload onto the new version.
function checkAppReplaced() {
  checkCodeChanged();
  if (state.installing || state.shuttingDown || !update.installable(ws).ok) return;
  const now = update.installedVersion(ws);
  if (now && now !== VERSION && !runs.list().length) reloadExtension(`${ws.appDir} is now version ${now}`);
}

// This helper's code as it was when it started. When it changes on disk (a checkout being edited, or setup
// copying in a new version) and nothing is going on, exit, so the next helper runs the new code: Chrome
// and Firefox start one when the extension reconnects, and the Safari bridge on the next connection (it
// keeps a helper across Safari unloading the extension, so reloading the extension wouldn't do it).
const startedCode = codeStamp(__dirname);
// Likewise when the workspace this helper started on, a folder then, has become a link: setup moved it
// (~/.webmods to ~/.trif, lib/migrate.js). Everything still works through the link, but watching the mods
// folder by its old path may not, so the next helper starts on the new one.
const startedOnFolder = (() => { try { return !fs.lstatSync(ws.home).isSymbolicLink(); } catch { return false; } })();
function homeMoved() {
  if (!startedOnFolder) return false;
  try { return fs.lstatSync(ws.home).isSymbolicLink(); } catch { return false; }
}
function checkCodeChanged() {
  if (state.installing || state.shuttingDown || runs.list().length || logins.info() || pending.size) return;
  if (codeStamp(__dirname) > startedCode) shutdown("its code changed on disk; the next helper runs the new code");
  else if (homeMoved()) shutdown(`its workspace ${ws.home} moved (it's now a link); the next helper uses the new place`);
}

// ---------------------------------------------------------------- problem reports (lib/report.js)

function duration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

async function report(args) {
  const { doctor } = require('./lib/doctor');
  const w = workspace(ws.home);
  const [doc, agentList] = await Promise.all([
    doctor({ home: ws.home }).catch(() => null),
    agents.listAgentsWithLogin(w, { version: true }).catch(() => null),
  ]);
  const mods = Array.isArray(args.mods) ? args.mods.slice(0, 40) : [];
  const text = buildReport({
    description: typeof args.description === 'string' ? args.description.slice(0, 4000) : '',
    site: typeof args.site === 'string' ? args.site : '', siteOn: !!args.siteOn,
    browser: state.hello ? `${state.hello.browser} ${state.hello.chrome || ''}`.trim() : null,
    extensionVersion: state.hello?.version || null,
    helper: { role: state.role, connectedFor: state.helloAt ? duration(Date.now() - state.helloAt) : null },
    agents: agentList ? agentList.agents : null,
    update: update.summary(w),
    mods, doctor: doc, logFile: ws.log,
  });
  return { text, email: reportEmail(), url: reportUrl() };
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
          (Buffer.byteLength(ws.sock) > 100 ? ' (the path is too long for a unix socket; use a shorter TRIF_HOME)' : ''));
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
  logger.info(`another helper is already serving ${ws.sock} (another browser or Chrome profile); this one serves ${ws.ownSock} for its own browser's agent runs and \`trif --browser\``);
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
    updates: state.updates,
    login: logins.info(),
  };
}

function onClientLine(sock, line) {
  let req;
  try { req = JSON.parse(line); } catch (e) {
    return reply(sock, { id: null, ok: false, error: `bad request JSON: ${e.message}` });
  }
  const { id, cmd } = req || {};
  // A plain object: an array's `scope` (set below for runs) wouldn't survive being sent on.
  const args = req && req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? req.args : {};
  if (typeof cmd !== 'string' || !cmd) return reply(sock, { id, ok: false, error: 'missing cmd' });

  // From inside an agent run (`trif` sends the run's token): only page commands, limited to its site.
  let run = null;
  if (req.token !== undefined) {
    run = runs.byToken(req.token);
    if (!run) return reply(sock, { id, ok: false, error: 'this agent run has ended (or its token is wrong)' });
    if (AGENT_COMMANDS.has(cmd)) {
      return reply(sock, { id, ok: false, error: cmd === 'mod.approve'
        ? 'only the user can approve a held mod (in the side panel, or `trif approve` in their terminal)'
        : cmd === 'mod.update'
          ? 'only the user can choose what happens with a new version of a TRIF mod (in the side panel, or `trif mod-update` in their terminal)'
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
        mods: state.mods.map((m) => ({
          ...summarize(m), ...(state.held[m.id] ? { held: state.held[m.id] } : {}), ...(state.updates[m.id] ? { update: state.updates[m.id] } : {}),
        })),
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
  pending.set(extId, { sock, clientId: id, timer, cmd, runId: run ? run.id : null });
}

function onExtensionResponse(msg) {
  const p = pending.get(msg.id);
  if (!p) return logger.warn(`response for unknown or expired request ${msg.id}`);
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (p.cmd === 'record' && msg.ok) noteRecording(p.runId, msg.result);
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
  for (const t of updateTimers) clearTimeout(t);
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
  const updateCheck = () => checkForUpdate(false).catch((e) => logger.warn(`update check failed: ${e.message}`));
  updateTimers = [setTimeout(updateCheck, UPDATE_FIRST_CHECK_MS), setInterval(updateCheck, UPDATE_EVERY_MS), setInterval(checkAppReplaced, 30000)];
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
