'use strict';
// Logging in to a coding agent from the side panel (and `trif agent login`): run the agent's own
// login command (claude: `claude auth login`) with stdin piped, report the sign-in URL it prints, pass
// on the code the user pastes back, and always finish with exactly one `done`. One login at a time.
// The code and the URL's query string (OAuth state, PKCE challenge) never reach helper.log.
// See docs/PROTOCOL.md "Side panel and agent runs".

const crypto = require('crypto');
const { envVar } = require('./env');
const { spawn } = require('child_process');
const agents = require('./agents');
const { killTree, panelRunsOff } = require('./platform');

const LOGIN_TIMEOUT_MS = Number(envVar('LOGIN_TIMEOUT_MS')) > 0 ? Number(envVar('LOGIN_TIMEOUT_MS')) : 10 * 60 * 1000;
const KILL_GRACE_MS = Number(envVar('AGENT_KILL_GRACE_MS')) > 0 ? Number(envVar('AGENT_KILL_GRACE_MS')) : 3000;
const MAX_CODE = 4096;
const NOTES_KEEP = 20;

function newLoginId() {
  return 'l' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(s) { return String(s).replace(ANSI, ''); }

// URLs keep scheme, host and path only; codes the user submitted are masked.
function redact(text, secrets = []) {
  let t = String(text).replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1?…');
  for (const s of secrets) if (s && s.length >= 3) t = t.split(s).join('[code]');
  return t;
}

/**
 * new Logins({ getWorkspace, logger, onEvent: (loginId, event) => void })
 *   start({agent}) -> {loginId}   (cancels a login already in progress)
 *   code(loginId, code) -> {sent: true}
 *   cancel(loginId) -> {cancelled: true}
 *   stopAll() -> Promise
 * Events: {kind:"login", url} | {kind:"text", text} | {kind:"error", message} | {kind:"done", ok, login:true[, cancelled]}
 */
class Logins {
  constructor({ getWorkspace, logger, onEvent, platform = process.platform }) {
    this.getWorkspace = getWorkspace;
    this.platform = platform;
    this.logger = logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.onEvent = onEvent || (() => {});
    this.current = null;
  }

  info() {
    return this.current ? { loginId: this.current.id, agent: this.current.agent, startedAt: this.current.startedAt } : null;
  }

  start(args = {}) {
    const ws = this.getWorkspace();
    // Logging in is for the panel's chats, which Windows doesn't have yet (platform.js panelRunsOff).
    const off = panelRunsOff(this.platform, ws.home);
    if (off) throw new Error(`${off.error} (log in there too)`);
    const agentId = typeof args.agent === 'string' && args.agent ? args.agent : agents.listAgents(ws, { version: false }).default;
    const adapter = agents.getAdapter(agentId);
    if (!adapter) throw new Error(`unknown agent "${agentId}" (known: ${agents.ADAPTERS.map((a) => a.id).join(', ')})`);
    if (!adapter.login) throw new Error(`${adapter.name} can't log in from the side panel: ${adapter.loginFix || 'log in from a terminal'}`);
    const env = agents.agentEnv(ws);
    const found = adapter.detect({ dirs: agents.searchDirs(ws), env, version: false });
    if (!found.available) throw new Error(adapter.missing);

    if (this.current) {
      this.logger.info(`agent login ${this.current.id}: replaced by a new login`);
      this._cancel(this.current);
    }
    const login = {
      id: newLoginId(),
      agent: adapter.id,
      adapter,
      ws,
      path: found.path,
      // BROWSER discourages the CLI from opening a second sign-in page (the panel opens one).
      env: { ...env, BROWSER: '/usr/bin/true' },
      startedAt: Date.now(),
      child: null,
      bufs: { stdout: '', stderr: '' },
      notes: [], // redacted text lines, for the error message
      codes: [], // submitted codes (to redact)
      urlSent: false,
      cancelled: false,
      timedOut: false,
      spawnError: null,
      finished: false,
      doneSent: false,
      timers: [],
    };
    this.current = login;
    setImmediate(() => this._launch(login)); // so the caller can answer {loginId} before the first event
    return { loginId: login.id };
  }

  code(loginId, code) {
    const login = this._get(loginId);
    const c = typeof code === 'string' ? code.trim() : '';
    if (!c) throw new Error('missing code');
    if (c.length > MAX_CODE || /[\r\n]/.test(c)) throw new Error("that doesn't look like a login code");
    const stdin = login.child && login.child.stdin;
    if (!stdin || !stdin.writable || login.finished) throw new Error("the login isn't waiting for a code");
    login.codes.push(c);
    stdin.write(c + '\n');
    this.logger.info(`agent login ${login.id}: code sent`);
    return { sent: true };
  }

  cancel(loginId) {
    this._cancel(this._get(loginId));
    return { cancelled: true };
  }

  stopAll(graceMs = 1500) {
    const login = this.current;
    if (!login) return Promise.resolve();
    this._cancel(login, graceMs);
    return new Promise((resolve) => {
      const check = setInterval(() => { if (login.doneSent) { clearInterval(check); resolve(); } }, 25);
      setTimeout(() => { clearInterval(check); resolve(); }, graceMs + 500).unref();
    });
  }

  // ------------------------------------------------------------ internals

  _get(loginId) {
    const login = this.current;
    if (!login || login.id !== loginId) throw new Error(`no login in progress with id ${loginId}`);
    return login;
  }

  _cancel(login, graceMs) {
    login.cancelled = true;
    if (this.current === login) this.current = null;
    if (!login.child) return; // not launched yet: _launch finishes it
    this._kill(login, graceMs);
  }

  _emit(login, event) {
    if (login.doneSent) return;
    if (event.kind === 'done') login.doneSent = true;
    try { this.onEvent(login.id, event); } catch (e) { this.logger.error(`login event handler: ${e.message}`); }
  }

  _launch(login) {
    const { adapter } = login;
    if (login.cancelled) return this._finish(login, { code: null, signal: null });
    const args = adapter.login.args;
    this.logger.info(`agent login ${login.id}: ${adapter.name} ${args.join(' ')} (${login.path})`);
    let child;
    try {
      child = spawn(login.path, args, { cwd: login.ws.home, env: login.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      login.spawnError = e;
      return this._finish(login, { code: null, signal: null });
    }
    login.child = child;
    child.on('error', (e) => {
      login.spawnError = e;
      this._finish(login, { code: null, signal: null });
    });
    child.stdin.on('error', () => { /* EPIPE once it has exited */ });
    for (const name of ['stdout', 'stderr']) {
      child[name].setEncoding('utf8');
      child[name].on('data', (chunk) => {
        login.bufs[name] += chunk;
        let m;
        while ((m = /\r?\n|\r/.exec(login.bufs[name]))) {
          const line = login.bufs[name].slice(0, m.index);
          login.bufs[name] = login.bufs[name].slice(m.index + m[0].length);
          this._onLine(login, line);
        }
        // The code prompt has no newline; anything else that long without one is noise.
        if (login.bufs[name].length > 16384) login.bufs[name] = login.bufs[name].slice(-4096);
      });
    }
    let exitInfo = null;
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      login.timers.push(setTimeout(() => this._finish(login, exitInfo), 1000));
    });
    child.on('close', (code, signal) => this._finish(login, exitInfo || { code, signal }));
    login.timers.push(setTimeout(() => {
      login.timedOut = true;
      this._emit(login, { kind: 'error', message: `The login was stopped after ${Math.round(LOGIN_TIMEOUT_MS / 60000) || 1} minutes: try again.` });
      if (this.current === login) this.current = null;
      this._kill(login);
    }, LOGIN_TIMEOUT_MS));
  }

  _onLine(login, raw) {
    const line = stripAnsi(raw).trim();
    if (!line || login.doneSent) return;
    let ev = null;
    try { ev = login.adapter.login.parseLine(line); } catch (e) { this.logger.warn(`agent login ${login.id}: parse error: ${e.message}`); }
    if (!ev) return;
    if (ev.kind === 'login' && typeof ev.url === 'string') {
      if (login.urlSent) return;
      login.urlSent = true;
      this.logger.info(`agent login ${login.id}: sign-in URL ${redact(ev.url)}`);
      this._emit(login, { kind: 'login', url: ev.url });
    } else if (ev.kind === 'text') {
      const text = redact(ev.text, login.codes);
      login.notes.push(text);
      if (login.notes.length > NOTES_KEEP) login.notes.shift();
      this._emit(login, { kind: 'text', text });
    }
  }

  _kill(login, graceMs = KILL_GRACE_MS) {
    const child = login.child;
    if (!child || login.finished || child.exitCode !== null || child.signalCode !== null) return;
    const sig = (s) => killTree(child, s, { platform: this.platform }); // (platform.js: Windows has no groups)
    sig('SIGTERM');
    setTimeout(() => sig('SIGKILL'), graceMs).unref();
  }

  async _finish(login, { code, signal }) {
    if (login.finished) return;
    login.finished = true;
    for (const t of login.timers) clearTimeout(t);
    for (const name of ['stdout', 'stderr']) {
      if (login.bufs[name].trim()) { const l = login.bufs[name]; login.bufs[name] = ''; this._onLine(login, l); }
    }
    if (login.child && login.child.pid && !login.cancelled) killTree({ pid: login.child.pid, kill() { /* gone */ } }, 'SIGTERM', { platform: this.platform });
    if (this.current === login) this.current = null;
    const { adapter } = login;
    agents.forgetLoginStatus(adapter.id);

    let ok = false;
    let message = null;
    if (login.cancelled || login.timedOut) {
      // cancelled: no error; timed out: already said so
    } else if (login.spawnError) {
      message = `couldn't start ${adapter.name} (${login.path}): ${login.spawnError.message}`;
    } else {
      // Exit code 0 isn't enough: ask the agent whether it's logged in now (this also refreshes agent.list).
      const st = await agents.loginStatus(adapter, login.ws, login.path, { fresh: true });
      ok = code === 0 && st.loggedIn === true;
      if (!ok) {
        const tail = login.notes.slice(-3).join('\n');
        if (code === 0) {
          message = st.loggedIn === false ? `${adapter.name} finished, but it still isn't logged in.` : `Couldn't check whether ${adapter.name} is logged in now.`;
        } else {
          message = `Logging in to ${adapter.name} failed${tail ? `: ${tail}` : ` (${signal ? `killed by ${signal}` : `exit code ${code}`})`}`;
        }
      }
    }
    if (message) this._emit(login, { kind: 'error', message: redact(message, login.codes) });
    const done = { kind: 'done', ok, login: true };
    if (login.cancelled) done.cancelled = true;
    this._emit(login, done);
    this.logger.info(`agent login ${login.id} done: ok=${ok} code=${code} signal=${signal}${login.cancelled ? ' (cancelled)' : ''}` +
      (!ok && login.notes.length ? `; output: ${login.notes.slice(-3).join(' | ')}` : ''));
  }
}

module.exports = { Logins, redact, stripAnsi, LOGIN_TIMEOUT_MS };
