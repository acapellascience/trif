'use strict';
// CLI side of the unix socket: newline-delimited JSON {id, cmd, args} -> {id, ok, result|error}.

const net = require('net');

const NO_HELPER_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EACCES', 'EPERM', 'ENOTDIR']);

// Inside a side-panel agent run the helper gives the agent WEBMODS_RUN_TOKEN; every request carries it,
// and the helper limits the run to its site (docs/PROTOCOL.md "Run scope").
function frame(id, cmd, args) {
  const msg = { id, cmd, args };
  if (process.env.WEBMODS_RUN_TOKEN) msg.token = process.env.WEBMODS_RUN_TOKEN;
  return JSON.stringify(msg) + '\n';
}

class HelperError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'no-helper' | 'command' | 'timeout' | 'protocol'
  }
}

function request(sockPath, cmd, args = {}, timeoutMs = 40000) {
  return new Promise((resolve, reject) => {
    const id = `c${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    let buf = '';
    const sock = net.connect(sockPath);
    const timer = setTimeout(() => {
      finish(new HelperError(`timed out after ${timeoutMs}ms waiting for the helper`, 'timeout'));
    }, timeoutMs);

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(value);
    }

    sock.setEncoding('utf8');
    sock.on('connect', () => {
      sock.write(frame(id, cmd, args));
    });
    sock.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) {
          finish(new HelperError(`bad response from helper: ${e.message}`, 'protocol'));
          return;
        }
        if (msg.id !== id) continue;
        if (msg.ok) finish(null, msg.result);
        else finish(new HelperError(String(msg.error ?? 'unknown error'), 'command'));
      }
    });
    sock.on('error', (e) => {
      if (NO_HELPER_CODES.has(e.code)) finish(new HelperError(`helper not running (${e.code} on ${sockPath})`, 'no-helper'));
      else finish(new HelperError(`socket error: ${e.message}`, 'protocol'));
    });
    sock.on('close', () => {
      finish(new HelperError('the helper closed the connection before answering (did Chrome quit?)', 'protocol'));
    });
  });
}

// agent.start with streaming: resolves the run's `done` event after calling onStart({runId}) and then
// onEvent(event) for each {type:"agentEvent", runId, event} line the helper sends on this connection.
function streamRun(sockPath, args, opts = {}) {
  return streamCommand(sockPath, 'agent.start', args, { ...opts, idKey: 'runId', what: 'the agent' });
}

// agent.login the same way (events are keyed by the loginId). onStart/onEvent get a second argument,
// send(cmd, args) -> Promise<result>, for requests on the same connection (agent.loginCode).
function streamLogin(sockPath, args, opts = {}) {
  return streamCommand(sockPath, 'agent.login', args, { timeoutMs: 11 * 60 * 1000, ...opts, idKey: 'loginId', what: 'the login' });
}

function streamCommand(sockPath, cmd, args, { onStart = () => {}, onEvent = () => {}, timeoutMs = 20 * 60 * 1000, idKey, what } = {}) {
  return new Promise((resolve, reject) => {
    const newId = () => `c${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const id = newId();
    let settled = false;
    let streamId = null;
    let buf = '';
    const asked = new Map(); // id -> {resolve, reject} for send()
    const sock = net.connect(sockPath);
    const timer = setTimeout(() => {
      finish(new HelperError(`timed out after ${timeoutMs}ms waiting for ${what}`, 'timeout'));
    }, timeoutMs);

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      for (const p of asked.values()) p.reject(new HelperError('the connection to the helper closed', 'protocol'));
      asked.clear();
      if (err) reject(err); else resolve(value);
    }

    function send(c, a = {}) {
      if (settled) return Promise.reject(new HelperError('the connection to the helper closed', 'protocol'));
      const rid = newId();
      return new Promise((res, rej) => {
        asked.set(rid, { resolve: res, reject: rej });
        sock.write(frame(rid, c, a));
      });
    }

    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(frame(id, cmd, args)));
    sock.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) {
          finish(new HelperError(`bad response from helper: ${e.message}`, 'protocol'));
          return;
        }
        if (msg.id === id && !streamId) {
          if (!msg.ok) { finish(new HelperError(String(msg.error ?? 'unknown error'), 'command')); return; }
          streamId = msg.result && msg.result[idKey];
          try { onStart(msg.result, send); } catch { /* ignore */ }
        } else if (msg.id && asked.has(msg.id)) {
          const p = asked.get(msg.id);
          asked.delete(msg.id);
          if (msg.ok) p.resolve(msg.result); else p.reject(new HelperError(String(msg.error ?? 'unknown error'), 'command'));
        } else if (msg.type === 'agentEvent' && streamId && msg.runId === streamId && msg.event) {
          try { onEvent(msg.event, send); } catch { /* ignore */ }
          if (msg.event.kind === 'done') { finish(null, msg.event); return; }
        }
      }
    });
    sock.on('error', (e) => {
      if (NO_HELPER_CODES.has(e.code)) finish(new HelperError(`helper not running (${e.code} on ${sockPath})`, 'no-helper'));
      else finish(new HelperError(`socket error: ${e.message}`, 'protocol'));
    });
    sock.on('close', () => {
      finish(new HelperError(streamId
        ? `the helper closed the connection before ${what} finished (did Chrome quit?)`
        : 'the helper closed the connection before answering (did Chrome quit?)', 'protocol'));
    });
  });
}

module.exports = { request, streamRun, streamLogin, HelperError };
