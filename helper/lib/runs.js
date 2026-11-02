'use strict';
// Agent runs for the side panel (and `trif agent run`): spawn the user's coding agent headless in
// the workspace, turn its stdout into normalized events, and always finish with exactly one `done`.
// See docs/PROTOCOL.md "Side panel and agent runs".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar } = require('./env');
const crypto = require('crypto');
const { spawn } = require('child_process');
const agents = require('./agents');
const { scopeFor } = require('./scope');
const { readInstructions, instructionsContext } = require('./instructions');
const { markRunActive, markRunEnded } = require('./origins');
const { listModFiles } = require('./mods');

const RUN_TIMEOUT_MS = Number(envVar('AGENT_TIMEOUT_MS')) > 0 ? Number(envVar('AGENT_TIMEOUT_MS')) : 15 * 60 * 1000;
const KILL_GRACE_MS = Number(envVar('AGENT_KILL_GRACE_MS')) > 0 ? Number(envVar('AGENT_KILL_GRACE_MS')) : 3000;
const KEEP_RUN_LOGS = 50;
const STDERR_KEEP = 16 * 1024;
const MAX_SNAPSHOT_FILES = 5000;
// Finished runs still count for held mods this long (a last write can reach the folder watcher late).
const RECENT_MS = 10000;

const MAX_BOX_REQUEST = 8 * 1024 * 1024;

/**
 * Where runs' mailboxes go: outside the workspace and the temp folder, which agents' sandboxes may write
 * by default, so a run can only write its own mailbox (opened for it alone), never another run's (whose
 * requests would carry that run's site). Inside the home folder's Library (or ~/.cache), which runs can't
 * read at all.
 */
function boxRoot() {
  if (envVar('BOX_ROOT')) return path.resolve(envVar('BOX_ROOT'));
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'TRIF', 'boxes')
    : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'trif', 'boxes');
}

// sha1 of every mod file the scanner loads (mods.js listModFiles: same folders, same symlink handling,
// no cap), relative to `base`. What held mods are decided on: a run can't put a mod where this doesn't look.
function modSnapshot(modsDir, base) {
  const out = new Map();
  for (const { file } of listModFiles(modsDir)) {
    try { out.set(path.relative(base, file), crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')); } catch { /* vanished */ }
  }
  return out;
}

// sha1 of every file under `dir` (relative to `base`), skipping dot-folders, for the `changedFiles` a run
// reports. Capped for sanity; held mods use modSnapshot.
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

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// The workspace's files a run may not read: secrets (config.json can hold API keys; safari-token is
// the Safari bridge's key), and other runs' traces (their logs hold the pages they read; screenshots
// of other sites; helper.log).
const PRIVATE_FILES = ['config.json', 'safari-token', 'helper.log', 'helper.log.1', 'runs', 'screenshots'];

// Where the user's agent skills live: Codex reads ~/.agents/skills (and ~/.codex/skills), Claude Code
// ~/.claude/skills. Each is often a link to a folder elsewhere (~/.claude/skills/x -> ~/.agents/skills/x).
const SKILL_FOLDERS = [['.agents', 'skills'], ['.codex', 'skills'], ['.claude', 'skills']];

/**
 * The user's skill folders, as real paths, for runs to read (never write): each skills folder, and where
 * each skill in it really is. Left out: a link that leads to the home folder itself, above it, or to the
 * root (it would open everything), and one into a visible folder of the home folder (~/Documents…), whose
 * other contents would have to be listed to deny them, which can make macOS ask the user.
 */
function skillDirs(homedir = os.homedir()) {
  const home = realOrResolved(homedir);
  const hiddenOrOutside = (p) => !p.startsWith(home + path.sep) || p.slice(home.length + 1).startsWith('.');
  const ok = (p) => p !== '/' && p !== home && !home.startsWith(p + path.sep) && hiddenOrOutside(p);
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const out = new Set();
  for (const parts of SKILL_FOLDERS) {
    const base = path.join(homedir, ...parts);
    if (!isDir(base)) continue;
    const realBase = realOrResolved(base);
    if (ok(realBase)) out.add(realBase);
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) {
      const p = path.join(base, n);
      if (!isDir(p)) continue;
      const r = realOrResolved(p);
      if (ok(r) && !r.startsWith(realBase + path.sep)) out.add(r);
    }
  }
  const all = [...out];
  return all.filter((p) => !all.some((q) => p.startsWith(q + path.sep))); // inside another one: covered
}

/**
 * What in the home folder to deny so that only `readable` (and the way to it) can be read: each item in
 * the home folder, except those `readable` paths are in or lead through; inside hidden folders that lead
 * through (~/.claude for ~/.claude/skills), every other item, and so on down. (A visible folder on the way
 * isn't looked into, as before skills: listing ~/Documents and the like can make macOS ask the user.) By
 * where each item leads, too.
 */
function deniedInHome(home, readable) {
  const real = realOrResolved;
  const covered = (p) => readable.some((r) => p === r || p.startsWith(r + path.sep));
  const onTheWay = (p) => readable.some((r) => r.startsWith(p + path.sep));
  const out = [];
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; } // unreadable: nothing to list
    for (const n of names) {
      const p = path.join(dir, n);
      const rp = real(p);
      if (covered(p) || covered(rp)) continue;
      if (onTheWay(p) || onTheWay(rp)) { if (n.startsWith('.')) walk(p); continue; }
      out.push(p);
    }
  };
  walk(home);
  return out;
}

/**
 * What a run may touch, for the agents' sandboxes, which macOS enforces (docs/PROTOCOL.md "Run scope"):
 *   readable  the workspace, the TRIF code `trif` runs, node, and the user's skill folders (skillDirs)
 *   writable  the mods folder, this run's screenshots folder, and its mailbox (`box`)
 *   readOnly  every existing mod folder of another site (all-sites/ included), inside the mods folder
 *   denied    everything else in the home folder, and the workspace's PRIVATE_FILES (the more
 *             specific path wins, so the run's own screenshots folder and mailbox stay writable). Each
 *             item in the home folder rather than the folder itself: node, and `mkdir -p`, look at
 *             every folder on a path, the home folder included.
 * No network at all: `trif` reaches the helper through the mailbox. Real paths, as sandboxes compare.
 */
function runLimits(ws, { scope, box, screenshots }) {
  const real = realOrResolved;
  const node = real(process.execPath);
  const home = real(os.homedir());
  const skills = skillDirs(os.homedir());
  const readable = [...new Set([real(ws.home), real(path.join(__dirname, '..', '..')), path.dirname(path.dirname(node)), ...skills])];
  const writable = [real(ws.modsDir), real(screenshots), real(box)];
  let names = [];
  try { names = fs.readdirSync(ws.modsDir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name); } catch { /* none yet */ }
  const otherSites = names.filter((n) => scopeFor(n) !== scope);
  const readOnly = otherSites.map((n) => real(path.join(ws.modsDir, n)));
  // (By where each leads, too: ~/.webmods is a link to the workspace, ~/.trif, since 0.2.0, and a rule
  // denying it would deny the workspace itself to a sandbox that follows links.)
  const inHome = deniedInHome(home, readable);
  const privateFiles = PRIVATE_FILES.map((f) => real(path.join(ws.home, f)));
  const denied = [...inHome, ...privateFiles];
  // Other sites' screenshot folders, for agents whose file tools take per-folder rules (Claude Code).
  let shots = [];
  try { shots = fs.readdirSync(ws.screenshots, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => real(path.join(ws.screenshots, d.name))); } catch { /* none */ }
  const otherScreenshots = shots.filter((p) => p !== real(screenshots));
  // The same read-only folders relative to the workspace, as modSnapshot names files: a change under them
  // can't be the run's doing (held.js).
  const locked = otherSites.map((n) => path.relative(ws.home, path.join(ws.modsDir, n)));
  return { readable, writable, readOnly, locked, denied, home, skills, privateFiles, workspace: real(ws.home), box: real(box), screenshots: real(screenshots), otherScreenshots };
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
 *   byToken(token) -> the live run whose agent was given this TRIF_RUN_TOKEN, or null
 *   scopes() -> [{runId, site, scope, before, locked, startedAt}] for live and just-finished runs (held
 *     mods; `locked`: the mods folders the run couldn't write, relative to the workspace)
 *   stopAll() -> Promise (resolves once every agent process has exited, SIGKILLing stragglers)
 */
class Runs {
  /**
   * onRequest(run, line, respond): a request from the run's mailbox (one JSON line, as on the socket);
   * respond(text) answers it. The host handles it as the run's, whatever the line says.
   */
  constructor({ getWorkspace, logger, onEvent, onRequest }) {
    this.getWorkspace = getWorkspace;
    this.logger = logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.onEvent = onEvent || (() => {});
    this.onRequest = onRequest || ((run, line, respond) => respond(JSON.stringify({ id: null, ok: false, error: 'no helper commands here' })));
    this.runs = new Map(); // runId -> run
    this.bySite = new Map(); // site -> runId
    this.recent = []; // [{runId, site, scope, before, locked, startedAt, until}]
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
    const live = [...this.runs.values()].map((r) => ({ runId: r.id, site: r.site, scope: r.scope, before: r.before || null, locked: r.locked || [], startedAt: r.startedAt }));
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
      // Given to the agent as TRIF_RUN_TOKEN; `trif` sends it, and the helper scopes its requests.
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
    // Mailboxes left by helpers that died mid-run (a live run's is younger than its time limit).
    try {
      for (const f of fs.readdirSync(boxRoot())) {
        const p = path.join(boxRoot(), f);
        try { if (Date.now() - fs.statSync(p).mtimeMs > 2 * RUN_TIMEOUT_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
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
    // The run's mailbox, its only way to the helper (its sandbox has no network), and its screenshots
    // folder (it may not see other sites' screenshots).
    run.box = path.join(boxRoot(), run.id);
    run.screenshots = path.join(ws.screenshots, run.scope.replace(/[^a-z0-9.-]/gi, '_') || 'site');
    try {
      fs.mkdirSync(boxRoot(), { recursive: true, mode: 0o700 });
      fs.mkdirSync(run.box, { mode: 0o700 });
      fs.mkdirSync(run.screenshots, { recursive: true });
    } catch (e) {
      this._emit(run, { kind: 'error', message: `couldn't prepare the run's folders: ${e.message}` });
      return this._finish(run, { code: null, signal: null });
    }
    this._serveBox(run);
    const env = { ...agents.agentEnv(ws), TRIF_RUN_TOKEN: run.token, TRIF_RUN_BOX: run.box, TRIF_RUN_SCREENSHOTS: run.screenshots };
    const found = adapter.detect({ dirs: agents.searchDirs(ws), env, version: false });
    if (!found.available) {
      this._emit(run, { kind: 'error', message: adapter.missing });
      return this._finish(run, { code: null, signal: null });
    }

    const ctx = { url: run.url, tabId: run.tabId, scope: run.scope, browser: ws.browser || '' };
    let prompt = run.prompt;
    let context = null;
    const extra = adapter.readsInstructions ? '' : instructionsContext(readInstructions(ws.home));
    if (adapter.systemPrompt) context = agents.contextText(ctx) + extra;
    else prompt = `${run.sessionId ? agents.reminderText(ctx) : agents.contextText(ctx) + extra}\n\n${prompt}`;
    try { fs.mkdirSync(ws.modsDir, { recursive: true }); } catch { /* reported by the agent */ }
    const limits = runLimits(ws, run);
    const { file, args } = adapter.command({ bin: found.path, prompt, sessionId: run.sessionId, model: run.model, context, workspace: ws.home, ...limits });

    run.before = modSnapshot(ws.modsDir, ws.home);
    run.locked = limits.locked;
    run.beforeFiles = snapshot(ws.modsDir, ws.home);
    // Tell the other browsers' helpers a run is going, so mods it creates start off there (lib/origins.js).
    if (ws.installId) {
      try { markRunActive(ws.home, { runId: run.id, by: ws.installId, browser: ws.browser || '', site: run.site }); run.marked = true; } catch (e) { this.logger.warn(`couldn't mark run ${run.id} active: ${e.message}`); }
    }
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

  // Answer requests from the run's mailbox (client.js boxRequest). The agent can write there, so files are
  // opened without following symlinks and answers are created fresh: a planted link can't make the helper
  // read or overwrite anything else.
  _serveBox(run) {
    const take = () => {
      if (run.finished) return;
      let names;
      try { names = fs.readdirSync(run.box); } catch { return; }
      for (const name of names) {
        if (!/^[\w.-]+\.req$/.test(name)) continue;
        const id = name.slice(0, -4);
        const file = path.join(run.box, name);
        let line;
        try {
          const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try {
            const st = fs.fstatSync(fd);
            if (!st.isFile() || st.size > MAX_BOX_REQUEST) throw new Error('not a request');
            line = fs.readFileSync(fd, 'utf8').trim();
          } finally { fs.closeSync(fd); }
        } catch { line = null; }
        try { fs.unlinkSync(file); } catch { continue; } // another pass took it
        const respond = (text) => {
          const tmp = path.join(run.box, `${id}.${crypto.randomBytes(4).toString('hex')}.part`);
          try {
            fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
            fs.renameSync(tmp, path.join(run.box, `${id}.res`));
          } catch (e) { this.logger.warn(`agent run ${run.id}: couldn't answer a request: ${e.message}`); }
        };
        if (line === null) { respond(JSON.stringify({ id: null, ok: false, error: 'unreadable request' })); continue; }
        try { this.onRequest(run, line, respond); } catch (e) { respond(JSON.stringify({ id: null, ok: false, error: e.message })); }
      }
    };
    try { run.boxWatcher = fs.watch(run.box, take); run.boxWatcher.on('error', () => {}); } catch { /* polling alone */ }
    run.timers.push(setInterval(take, 200));
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
    try { run.boxWatcher?.close(); } catch { /* ignore */ }
    if (run.box) setTimeout(() => { try { fs.rmSync(run.box, { recursive: true, force: true }); } catch { /* ignore */ } }, 2000).unref();
    // Leftover processes of a finished run (backgrounded by a tool) go too, by force after a moment: a
    // write landing after the held-mod window (RECENT_MS) would never be held.
    if (run.child && run.child.pid && !run.stopped) {
      const pid = run.child.pid;
      try { process.kill(-pid, 'SIGTERM'); } catch { /* none */ }
      setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, KILL_GRACE_MS).unref();
    }

    let changedFiles = [];
    if (run.beforeFiles) {
      try { changedFiles = diffSnapshots(run.beforeFiles, snapshot(run.ws.modsDir, run.ws.home)); } catch { /* ignore */ }
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
    if (run.marked) markRunEnded(run.ws.home, run.id);
    if (run.before) this.recent.push({ runId: run.id, site: run.site, scope: run.scope, before: run.before, locked: run.locked || [], startedAt: run.startedAt, until: Date.now() + RECENT_MS });
    this.runs.delete(run.id);
    if (this.bySite.get(run.site) === run.id) this.bySite.delete(run.site);
  }
}

module.exports = {
  runLimits, Runs, snapshot, modSnapshot, diffSnapshots, normalizeSite, boxRoot, RUN_TIMEOUT_MS, PRIVATE_FILES, skillDirs, deniedInHome };
