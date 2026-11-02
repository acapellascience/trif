'use strict';
// A stand-in for Anthropic's Messages API, the way Claude Code uses it: POST /v1/messages, streamed as
// server-sent events when asked (`stream: true`), JSON otherwise; GET /v1/models. Each streamed request
// takes the next step of a script: {say: "<text>"} answers with that text (ending the turn), {bash:
// "<command>"} with a call to the Bash tool, {tool: "<name>", input: {…}} with a call to any tool. Every request is kept in `requests` ({method, url, headers,
// body}), to check where a key goes. Never the real API.

const http = require('http');

function startFakeAnthropic({ script = [{ say: 'ok' }] } = {}) {
  const requests = [];
  let step = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const p = req.url.replace(/\?.*$/, '');
      if (req.method === 'GET' && p === '/v1/models') return send(200, { data: [{ id: 'claude-haiku-stand-in', type: 'model', display_name: 'Stand-in' }], has_more: false });
      if (req.method === 'POST' && p === '/v1/messages/count_tokens') return send(200, { input_tokens: 10 });
      if (req.method !== 'POST' || p !== '/v1/messages') return send(404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
      const model = (json && json.model) || 'claude-haiku-stand-in';
      const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      if (!json || !json.stream) {
        // Side requests (titles, topic checks): a short answer, not a script step.
        return send(200, { id: 'msg_side', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Stand-in' }], stop_reason: 'end_turn', stop_sequence: null, usage });
      }
      const s = script[Math.min(step++, script.length - 1)];
      const n = step;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
      if (s.bash !== undefined || s.tool !== undefined) {
        const [name, input] = s.tool !== undefined ? [s.tool, s.input || {}] : ['Bash', { command: s.bash, description: 'probe' }];
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name, input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: String(s.say) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
      }
      ev('message_stop', {});
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port, url: `http://127.0.0.1:${port}`, requests,
        // What the Bash tool calls returned so far (from the last request's messages).
        toolResults() {
          const last = [...requests].reverse().find((r) => r.body && Array.isArray(r.body.messages) && r.body.stream);
          if (!last) return [];
          const out = [];
          for (const m of last.body.messages) {
            for (const c of Array.isArray(m.content) ? m.content : []) {
              if (c && c.type === 'tool_result') out.push(typeof c.content === 'string' ? c.content : JSON.stringify(c.content));
            }
          }
          return out;
        },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startFakeAnthropic };
