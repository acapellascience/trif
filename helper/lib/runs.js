'use strict';
// Agent runs for the side panel (and `webmods agent run`): spawn the user's coding agent headless in
// the workspace, turn its stdout into normalized events, and always finish with exactly one `done`.
// See docs/PROTOCOL.md "Side panel and agent runs".

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const agents = require('./agents');
const { scopeFor } = require('./scope');

const RUN_TIMEOUT_MS = Number(process.env.WEBMODS_AGENT_TIMEOUT_MS) > 0 ? Number(process.env.WEBMODS_AGENT_TIMEOUT_MS) : 15 * 60 * 1000;
const KILL_GRACE_MS = Number(process.env.WEBMODS_AGENT_KILL_GRACE_MS) > 0 ? Number(process.env.WEBMODS_AGENT_KILL_GRACE_MS) : 3000;
const KEEP_RUN_LOGS = 50;
const STDERR_KEEP = 16 * 1024;
const MAX_SNAPSHOT_FILES = 5000;
// Finished runs still count for held mods this long (a last write can reach the folder watcher late).
const RECENT_MS = 10000;

// sha1 of every file under `dir` (relative to `base`), skipping dot-folders. Capped for sanity.
function snapshot(dir, base) {
  const out = new Map();
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_SNAPSHOT_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p); continue; }
      if (!e.isFile()) continue;
      try { out.set(path.relative(base, p), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')); } catch { /* vanished */ }
    }
  };
  walk(dir);
  return out;
}

function diffSnapshots(before, after) {
  const changed = new Set();
  for (const [f, h] of after) if (before.get(f) !== h) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  return [...changed].sort();
}

function newRunId() {
  return 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function normalizeSite(site, url) {
  let s = typeof site === 'string' && site.trim() ? site.trim() : agents.hostOf(url);
  s = s.toLowerCase().replace(/^www\./, '');
  return s;
}

/**
 * new Runs({ getWorkspace: () => ws, logger, onEvent: (runId, event) => void })
 *   start(args) -> {runId}     args: {agent, model, site, url, tabId, prompt, sessionId}
 *   stop(runId) -> {stopped: true}
 *   list() -> [{runId, site, scope, agent, startedAt}]
 *   byToken(token) -> the live run whose agent was given this WEBMODS_RUN_TOKEN, or null
 *   scopes() -> [{runId, site, scope, before, startedAt}] for live and just-finished runs (held mods)
 *   stopAll() -> Promise (resolves once every agent process has exited, SIGKILLing stragglers)
 */
class Runs {
  constructor({ getWorkspace, logger, onEvent }) {
    this.getWorkspace = getWorkspace;
    this.logger = logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.onEvent = onEvent || (() => {});
    this.runs = new Map(); // runId -> run
    this.bySite = new Map(); // site -> runId
    this.recent = []; // [{runId, site, scope, before, startedAt, until}]
  }

  list() {
    return [...this.runs.values()].map((r) => ({ runId: r.id, site: r.site, scope: r.scope, agent: r.agent, startedAt: r.startedAt }));
  }

  byToken(token) {
    if (typeof token !== 'string' || !token) return null;
    for (const r of this.runs.values()) if (r.token === token && !r.finished) return r;
    return null;
  }

  scopes() {
    const now = Date.now();
    this.recent = this.recent.filter((r) => r.until > now);
    const live = [...this.runs.values()].map((r) => ({ runId: r.id, site: r.site, scope: r.scope, before: r.before || null, startedAt: r.startedAt }));
    return [...live, ...this.recent];
  }

  start(args = {}) {
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    if (!prompt.trim()) throw new Error('missing prompt');
    const site = normalizeSite(args.site, args.url);
    if (!site) throw new Error('missing site (pass the page URL)');
    if (this.bySite.has(site)) throw new Error(`already working on ${site}`);
    const ws = this.getWorkspace();
    const agentId = typeof args.agent === 'string' && args.agent ? args.agent : agents.listAgents(ws, { version: false }).default;
    const adapter = agents.getAdapter(agentId);
    if (!adapter) throw new Error(`unknown agent "${agentId}" (known: ${agents.ADAPTERS.map((a) => a.id).join(', ')})`);

    const run = {
      id: newRunId(),
      site,
      scope: scopeFor(site),
      // Given to the agent as WEBMODS_RUN_TOKEN; `webmods` sends it, and the helper scopes its requests.
      token: crypto.randomBytes(16).toString('hex'),
      agent: adapter.id,
      adapter,
      ws,
      url: typeof args.url === 'string' ? args.url : '',
      tabId: args.tabId === undefined || args.tabId === null || args.tabId === '' ? null : args.tabId,
      sessionId: typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : null,
      model: typeof args.model === 'string' && args.model.trim() ? args.model.trim() : null,
      prompt,
      startedAt: Date.now(),
      state: { workspace: ws.home },
      child: null,
      stdoutBuf: '',
      stderr: '',
      agentDone: null,
      lastSessionId: null,
      stopped: false,
      timedOut: false,
      finished: false, // _finish ran
      doneSent: false, // the final `done` went out; nothing follows it
      timers: [],
    };
    run.logFile = path.join(ws.home, 'runs', `${run.id}.jsonl`);
    run.lastSessionId = run.sessionId;
    this.runs.set(run.id, run);
    this.bySite.set(site, run.id);
    // Launch on the next tick so the caller can send {runId} before the first event.
    setImmediate(() => this._launch(run));
    return { runId: run.id };
  }

  stop(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`no running agent with id ${runId}`);
    run.stopped = true;
    this._kill(run);
    return { stopped: true };
  }

  stopAll(graceMs = 1500) {
    const live = [...this.runs.values()];
    if (!live.length) return Promise.resolve();
    return new Promise((resolve) => {
      for (const run of live) { run.stopped = true; run.shuttingDown = true; this._kill(run, graceMs); }
      const check = setInterval(() => {
        if (![...this.runs.values()].some((r) => live.includes(r))) { clearInterval(check); resolve(); }
      }, 25);
      setTimeout(() => { clearInterval(check); resolve(); }, graceMs + 500).unref();
    });
  }

  // ------------------------------------------------------------ internals

  _emit(run, event) {
    if (run.doneSent) return;
    if (event.kind === 'done') run.doneSent = true;
    try { this.onEvent(run.id, event); } catch (e) { this.logger.error(`agent event handler: ${e.message}`); }
  }

  _log(run, obj) {
    try { fs.appendFileSync(run.logFile, (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n'); } catch { /* ignore */ }
  }

  _prepareLogDir(ws) {
    const dir = path.join(ws.home, 'runs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    // Keep the last KEEP_RUN_LOGS - 1 (this run makes KEEP_RUN_LOGS).
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        .map((f) => { try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
      for (const { f } of files.slice(KEEP_RUN_LOGS - 1)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }

  _launch(run) {
    const { ws, adapter } = run;
    this._prepareLogDir(ws);
    this._log(run, { webmods: 'start', runId: run.id, agent: run.agent, site: run.site, url: run.url, tabId: run.tabId, sessionId: run.sessionId, model: run.model, prompt: run.prompt, time: run.startedAt });

    if (run.stopped) return this._finish(run, { code: null, signal: null }); // stopped before it started
    const env = { ...agents.agentEnv(ws), WEBMODS_RUN_TOKEN: run.token };
    const found = adapter.detect({ dirs: agents.searchDirs(ws), env, version: false });
    if (!found.available) {
      this._emit(run, { kind: 'error', message: adapter.missing });
      return this._finish(run, { code: null, signal: null });
    }

    const ctx = { url: run.url, tabId: run.tabId, scope: run.scope };
    let prompt = run.prompt;
    let context = null;
    if (adapter.systemPrompt) context = agents.contextText(ctx);
    else prompt = `${run.sessionId ? agents.reminderText(ctx) : agents.contextText(ctx)}\n\n${prompt}`;
    const { file, args } = adapter.command({ bin: found.path, prompt, sessionId: run.sessionId, model: run.model, context, workspace: ws.home });

    run.before = snapshot(ws.modsDir, ws.home);
    this.logger.info(`agent run ${run.id}: ${run.agent} for ${run.site}${run.sessionId ? ` (resume ${run.sessionId})` : ''}`);
    let child;
    try {
      child = spawn(file, args, { cwd: ws.home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      this._emit(run, { kind: 'error', message: `couldn't start ${adapter.name}: ${e.message}` });
      return this._finish(run, { code: null, signal: null });
    }
    run.child = child;
    child.on('error', (e) => {
      this._emit(run, { kind: 'error', message: `couldn't start ${adapter.name} (${found.path}): ${e.message}` });
      this._finish(run, { code: null, signal: null });
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      run.stdoutBuf += chunk;
      let nl;
      while ((nl = run.stdoutBuf.indexOf('\n')) !== -1) {
        const line = run.stdoutBuf.slice(0, nl);
        run.stdoutBuf = run.stdoutBuf.slice(nl + 1);
        this._onLine(run, line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      run.stderr = (run.stderr + chunk).slice(-STDERR_KEEP);
    });

    let exitInfo = null;
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      // Normally 'close' follows at once; if a grandchild keeps the pipes open, don't wait for it.
      run.timers.push(setTimeout(() => this._finish(run, exitInfo), 1000));
    });
    child.on('close', (code, signal) => this._finish(run, exitInfo || { code, signal }));

    run.timers.push(setTimeout(() => {
      run.timedOut = true;
      this._emit(run, { kind: 'error', message: `${adapter.name} was stopped after ${Math.round(RUN_TIMEOUT_MS / 60000) || 1} minutes` });
      this._kill(run);
    }, RUN_TIMEOUT_MS));
  }

  _onLine(run, line) {
    if (!line.trim() || run.doneSent) return;
    this._log(run, line);
    try {
      run.adapter.parse(line, (ev) => {
        if (!ev || typeof ev !== 'object') return;
        if (ev.kind === 'done') {
          run.agentDone = ev;
          if (ev.discardSession) run.lastSessionId = run.sessionId;
          else if (ev.sessionId) run.lastSessionId = ev.sessionId;
          return;
        }
        if (ev.kind === 'session' && ev.sessionId) run.lastSessionId = ev.sessionId;
        this._emit(run, ev);
      }, run.state);
    } catch (e) {
      this.logger.warn(`agent run ${run.id}: parse error: ${e.message}`);
    }
  }

  // Kill the agent's whole process group (it spawns shells for its tools): SIGTERM, then SIGKILL.
  _kill(run, graceMs = KILL_GRACE_MS) {
    const child = run.child;
    if (!child || run.finished || child.exitCode !== null || child.signalCode !== null) return;
    const sig = (s) => {
      try { process.kill(-child.pid, s); } catch { try { child.kill(s); } catch { /* gone */ } }
    };
    sig('SIGTERM');
    setTimeout(() => sig('SIGKILL'), graceMs).unref(); // the group may outlive its leader
  }

  _finish(run, { code, signal }) {
    if (run.finished) return;
    run.finished = true;
    for (const t of run.timers) clearTimeout(t);
    if (run.stdoutBuf.trim()) { const l = run.stdoutBuf; run.stdoutBuf = ''; this._onLine(run, l); }
    // Leftover processes of a finished run (backgrounded by a tool) go too.
    if (run.child && run.child.pid && !run.stopped) { try { process.kill(-run.child.pid, 'SIGTERM'); } catch { /* none */ } }

    let changedFiles = [];
    if (run.before) {
      try { changedFiles = diffSnapshots(run.before, snapshot(run.ws.modsDir, run.ws.home)); } catch { /* ignore */ }
    }
    const d = run.agentDone;
    let done;
    if (d) {
      done = { kind: 'done', ok: !!d.ok && !run.stopped && !run.timedOut, result: d.result ?? null, costUsd: d.costUsd ?? null, changedFiles, sessionId: (d.discardSession ? run.sessionId : d.sessionId || run.lastSessionId) || null };
    } else {
      if (!run.stopped && !run.timedOut && run.child) {
        const tail = run.stderr.trim().split('\n').slice(-12).join('\n').slice(-2000);
        const friendly = run.adapter.explainExit ? run.adapter.explainExit({ code, signal, stderr: run.stderr }) : null;
        const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
        this._emit(run, { kind: 'error', message: friendly || `${run.adapter.name} ${how} without finishing${tail ? `:\n${tail}` : ''}` });
      }
      done = { kind: 'done', ok: false, result: null, costUsd: null, changedFiles, sessionId: run.lastSessionId || null };
    }
    if (run.stopped && !run.shuttingDown) done.stopped = true;
    if (run.shuttingDown) this._emit(run, { kind: 'error', message: 'the helper shut down (Chrome closed?) before the agent finished' });
    this._emit(run, done);
    this._log(run, { webmods: 'done', ...done, exitCode: code, signal, stderrTail: run.stderr.slice(-4000), time: Date.now() });
    this.logger.info(`agent run ${run.id} done: ok=${done.ok} code=${code} signal=${signal} changed=${changedFiles.length}`);
    if (run.before) this.recent.push({ runId: run.id, site: run.site, scope: run.scope, before: run.before, startedAt: run.startedAt, until: Date.now() + RECENT_MS });
    this.runs.delete(run.id);
    if (this.bySite.get(run.site) === run.id) this.bySite.delete(run.site);
  }
}

module.exports = { Runs, snapshot, diffSnapshots, normalizeSite, RUN_TIMEOUT_MS };
