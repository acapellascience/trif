'use strict';
// CLI side of the unix socket: newline-delimited JSON {id, cmd, args} -> {id, ok, result|error}.

const net = require('net');

const NO_HELPER_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EACCES', 'EPERM', 'ENOTDIR']);

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
      sock.write(JSON.stringify({ id, cmd, args }) + '\n');
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
function streamRun(sockPath, args, { onStart = () => {}, onEvent = () => {}, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `c${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    let runId = null;
    let buf = '';
    const sock = net.connect(sockPath);
    const timer = setTimeout(() => {
      finish(new HelperError(`timed out after ${timeoutMs}ms waiting for the agent`, 'timeout'));
    }, timeoutMs);

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(value);
    }

    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify({ id, cmd: 'agent.start', args }) + '\n'));
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
        if (msg.id === id && !runId) {
          if (!msg.ok) { finish(new HelperError(String(msg.error ?? 'unknown error'), 'command')); return; }
          runId = msg.result && msg.result.runId;
          try { onStart(msg.result); } catch { /* ignore */ }
        } else if (msg.type === 'agentEvent' && runId && msg.runId === runId && msg.event) {
          try { onEvent(msg.event); } catch { /* ignore */ }
          if (msg.event.kind === 'done') { finish(null, msg.event); return; }
        }
      }
    });
    sock.on('error', (e) => {
      if (NO_HELPER_CODES.has(e.code)) finish(new HelperError(`helper not running (${e.code} on ${sockPath})`, 'no-helper'));
      else finish(new HelperError(`socket error: ${e.message}`, 'protocol'));
    });
    sock.on('close', () => {
      finish(new HelperError(runId
        ? 'the helper closed the connection before the agent finished (did Chrome quit?)'
        : 'the helper closed the connection before answering (did Chrome quit?)', 'protocol'));
    });
  });
}

module.exports = { request, streamRun, HelperError };
