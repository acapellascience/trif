'use strict';
// A stand-in model server for open-model tests: speaks the OpenAI Responses API the way Codex uses it
// (POST /v1/responses, streamed as server-sent events) plus the model lists Ollama (/api/tags,
// /api/version) and LM Studio / OpenAI-compatible servers (/v1/models) serve. Each POST to /responses
// takes the next step of a script: {run: "<shell command>"} answers with a call to whichever shell tool
// Codex offered (exec_command, shell_command or shell), {say: "<text>"} with a message (ending the turn).
// Every request is kept in `requests` ({method, url, headers, body}).

const http = require('http');

function startFakeModelServer({ script = [{ say: 'ok' }], models = ['gpt-oss:20b'] } = {}) {
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
      if (req.url.endsWith('/api/version')) return send(200, { version: '0.13.6' });
      if (req.url.endsWith('/api/tags')) return send(200, { models: models.map((m) => ({ name: m, model: m })) });
      if (req.method === 'GET' && req.url.endsWith('/models')) return send(200, { object: 'list', data: models.map((m) => ({ id: m, object: 'model' })) });
      if (req.method !== 'POST' || !req.url.endsWith('/responses')) return send(404, { error: { message: 'not found' } });
      const s = script[Math.min(step++, script.length - 1)];
      const tools = (json && Array.isArray(json.tools) ? json.tools : []).map((t) => t && (t.name || t.type));
      const n = step;
      let item;
      if (s.run !== undefined) {
        const name = ['exec_command', 'shell_command', 'shell'].find((t) => tools.includes(t)) || 'shell';
        const args = name === 'exec_command' ? { cmd: s.run } : name === 'shell_command' ? { command: s.run } : { command: ['bash', '-lc', s.run] };
        item = { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name, arguments: JSON.stringify(args) };
      } else {
        item = { type: 'message', id: `msg_${n}`, role: 'assistant', content: [{ type: 'output_text', text: String(s.say) }] };
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('response.created', { response: { id: `resp_${n}` } });
      ev('response.output_item.added', { output_index: 0, item });
      ev('response.output_item.done', { output_index: 0, item });
      ev('response.completed', { response: { id: `resp_${n}`, usage: { input_tokens: 10, input_tokens_details: null, output_tokens: 5, output_tokens_details: null, total_tokens: 15 } } });
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port, url: `http://127.0.0.1:${port}`, requests,
        // The outputs Codex sent back for the tool calls so far (what each command printed).
        toolOutputs() {
          const last = [...requests].reverse().find((r) => r.body && Array.isArray(r.body.input));
          return last ? last.body.input.filter((i) => i && i.type === 'function_call_output').map((i) => String(i.output)) : [];
        },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startFakeModelServer };
