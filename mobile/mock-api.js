#!/usr/bin/env node
'use strict';
// A stand-in for the three APIs the iPhone app's More chat talks to (TrifProbe/PanelEngines.swift), for the
// Simulator and tests: never a real key, never a real service. The app with `-apibase http://localhost:8378` sends
// every engine here, under its own path:
//   /claude-api/v1/messages            Anthropic's Messages API, streamed (its server-sent events)
//   /openai-api/v1/responses           OpenAI's Responses API, streamed
//   /openrouter/api/v1/chat/completions OpenRouter's (OpenAI-compatible) chat completions, streamed
//   …/models                           each one's model list
// Only the fake key (FAKE_KEY) is taken; anything else gets the service's 401. Two more keys for what fails: NO_CREDITS
// (every reply a 402, as OpenRouter's "Insufficient credits"; Anthropic's and OpenAI's own words for theirs) and SILENT
// (the request taken, nothing ever sent back: the app's "still nothing back" note). A model with "missing" in its name: 404.
// OpenRouter's list is a trimmed copy of its real public one (mobile/test/openrouter-models.json, recorded 11-18, no key);
// /api/v1/models/user (the key's own list) is that list without xAI's and Meta's models, as an account's guardrail would. Each reply follows one script, so a
// whole tool loop can be watched: first read_page (h1), then try_mod with a style mod for the page in the first
// message, then the mod in a code block. A message saying "loop" keeps calling read_page, to see the 15-step cap; "no
// tools" (or a request without tools) answers at once; "slow" waits 1.5 s before each answer (to try Stop). What a reply needs back (Claude's thinking block and its
// signature, OpenAI's reasoning item) is checked on the next request, as the services do: missing, it's a 400.
//
//   node mobile/mock-api.js [port]     (8378 by default)

const http = require('http');

const FAKE_KEY = 'sk-test-not-a-real-key';
const NO_CREDITS = 'sk-test-no-credits';
const SILENT = 'sk-test-never-answers';
const KEYS = [FAKE_KEY, NO_CREDITS, SILENT];
const OPENROUTER = (() => { try { return require('./test/openrouter-models.json'); } catch { return null; } })();
const SIGNATURE = 'mock-signature-1';

function modFor(origin) {
  return `// ==WebMod==\n// @name        Quieter headings\n// @description Makes the main heading grey (from the mock API)\n// @match       ${origin}/*\n// @style\n// ==/WebMod==\n{\n  "css": "h1 { color: #777 !important }",\n  "hide": ["#siteNotice"]\n}\n`;
}
const originOf = (text) => ((String(text).match(/https?:\/\/[^\s/)]+/) || [])[0] || 'https://example.com');

/** What the script says next, from what's been said: { tool: [name, input] } or { text }. */
function next({ firstUser, results, hasTools }) {
  const origin = originOf(firstUser);
  if (!hasTools || /no tools/i.test(firstUser)) return { text: `Here is a mod:\n\n\`\`\`js\n${modFor(origin)}\`\`\`\n` };
  if (/loop/i.test(firstUser)) return { tool: ['read_page', { selector: `h${(results.length % 6) + 1}` }] };
  if (results.length === 0) return { tool: ['read_page', { selector: 'h1' }] };
  if (results.length === 1) return { tool: ['try_mod', { code: modFor(origin) }] };
  return { text: `I tried it on the page: the heading matched. Here it is:\n\n\`\`\`js\n${modFor(origin)}\`\`\`\n` };
}

const send = (res, events, slow = false) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  if (slow) { const t = events.slice(); events.length = 0; setTimeout(() => { events.push(...t); tick(); }, 1500); }
  let i = 0;
  const tick = () => {
    if (i >= events.length) { res.end(); return; }
    const [name, data] = events[i++];
    res.write(`${name ? `event: ${name}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    setTimeout(tick, 15);
  };
  if (!slow) tick();
};
const fail = (res, status, message, shape = 'openai') => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(shape === 'anthropic' ? { type: 'error', error: { type: 'invalid_request_error', message } } : { error: { message, type: 'invalid_request_error' } }));
};
const chunks = (text) => text.match(/[\s\S]{1,24}/g) || [];

// ---- Anthropic -----------------------------------------------------------------------------------------------
function anthropic(body, res, log) {
  const msgs = body.messages || [];
  const firstUser = (msgs[0]?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const results = msgs.flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? m.content.filter((c) => c.type === 'tool_result') : []));
  for (const m of msgs.filter((x) => x.role === 'assistant')) {
    const th = (m.content || []).find((c) => c.type === 'thinking');
    if (!th || th.signature !== SIGNATURE) return fail(res, 400, 'messages: an assistant turn lost its thinking block or signature', 'anthropic');
    for (const t of (m.content || []).filter((c) => c.type === 'tool_use')) {
      if (!results.some((r) => r.tool_use_id === t.id)) return fail(res, 400, `tool_use ${t.id} has no tool_result`, 'anthropic');
    }
  }
  log.push({ api: 'anthropic', model: body.model, effort: body.output_config?.effort, tools: (body.tools || []).map((t) => t.name), results: results.length, images: JSON.stringify(msgs).split('"type":"image"').length - 1 });
  const step = next({ firstUser, results, hasTools: (body.tools || []).length > 0 });
  const ev = [['message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 1200 + results.length * 300, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: SIGNATURE } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }]];
  if (step.text) {
    ev.push(['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }]);
    for (const c of chunks(step.text)) ev.push(['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: 1 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 80 } }]);
  } else {
    const [name, input] = step.tool;
    ev.push(['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `toolu_${results.length + 1}`, name, input: {} } }]);
    for (const c of chunks(JSON.stringify(input))) ev.push(['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: c } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: 1 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } }]);
  }
  ev.push(['message_stop', { type: 'message_stop' }]);
  send(res, ev, /slow/i.test(firstUser));
}

// ---- OpenAI Responses ----------------------------------------------------------------------------------------
function responses(body, res, log) {
  const input = body.input || [];
  const firstUser = (input.find((x) => x.role === 'user')?.content || []).filter((c) => c.type === 'input_text').map((c) => c.text).join('\n');
  const results = input.filter((x) => x.type === 'function_call_output');
  const calls = input.filter((x) => x.type === 'function_call');
  if (calls.length && input.filter((x) => x.type === 'reasoning' && x.encrypted_content === 'mock-encrypted').length < calls.length) return fail(res, 400, 'a function call came back without its reasoning item');
  for (const c of calls) if (!results.some((r) => r.call_id === c.call_id)) return fail(res, 400, `No tool output found for function call ${c.call_id}.`);
  log.push({ api: 'responses', model: body.model, effort: body.reasoning?.effort, tools: (body.tools || []).map((t) => t.name), results: results.length, store: body.store, images: JSON.stringify(input).split('"input_image"').length - 1 });
  const step = next({ firstUser, results, hasTools: (body.tools || []).length > 0 });
  const ev = [[null, { type: 'response.created', response: { id: 'resp_mock' } }],
    [null, { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: `rs_${results.length}`, summary: [], encrypted_content: 'mock-encrypted' } }]];
  if (step.text) {
    for (const c of chunks(step.text)) ev.push([null, { type: 'response.output_text.delta', delta: c }]);
    ev.push([null, { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: `msg_${results.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: step.text, annotations: [] }] } }]);
  } else {
    const [name, args] = step.tool;
    ev.push([null, { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: `fc_${results.length}`, call_id: `call_${results.length + 1}`, name, arguments: JSON.stringify(args), status: 'completed' } }]);
  }
  ev.push([null, { type: 'response.completed', response: { id: 'resp_mock', usage: { input_tokens: 1300 + results.length * 300, output_tokens: 60 } } }]);
  send(res, ev);
}

// ---- OpenRouter chat completions -----------------------------------------------------------------------------
function completions(body, res, log) {
  const msgs = body.messages || [];
  const user = msgs.find((m) => m.role === 'user');
  const firstUser = Array.isArray(user?.content) ? user.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : String(user?.content || '');
  const results = msgs.filter((m) => m.role === 'tool');
  for (const m of msgs.filter((x) => x.role === 'assistant')) for (const t of m.tool_calls || []) if (!results.some((r) => r.tool_call_id === t.id)) return fail(res, 400, `tool call ${t.id} has no result`);
  if (msgs[0]?.role !== 'system') return fail(res, 400, 'expected the system message first');
  log.push({ api: 'openrouter', model: body.model, provider: body.provider, tools: (body.tools || []).map((t) => t.function?.name), results: results.length, images: JSON.stringify(msgs).split('"image_url"').length - 1 });
  const step = next({ firstUser, results, hasTools: (body.tools || []).length > 0 });
  const ev = [];
  const chunk = (delta, finish = null) => [null, { id: 'gen-mock', choices: [{ index: 0, delta, finish_reason: finish }] }];
  if (step.text) {
    for (const c of chunks(step.text)) ev.push(chunk({ content: c }));
    ev.push(chunk({}, 'stop'));
  } else {
    const [name, args] = step.tool;
    const a = JSON.stringify(args);
    ev.push(chunk({ tool_calls: [{ index: 0, id: `call_${results.length + 1}`, type: 'function', function: { name, arguments: '' } }] }));
    for (const c of chunks(a)) ev.push(chunk({ tool_calls: [{ index: 0, function: { arguments: c } }] }));
    ev.push(chunk({}, 'tool_calls'));
  }
  ev.push([null, { id: 'gen-mock', choices: [], usage: { prompt_tokens: 1100 + results.length * 300, completion_tokens: 50 } }], [null, '[DONE]']);
  send(res, ev);
}

const MODELS = {
  'claude-api': { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] },
  'openai-api': { data: [{ id: 'gpt-5' }, { id: 'gpt-5-codex' }, { id: 'gpt-realtime' }, { id: 'text-embedding-3-small' }] },
  openrouter: { data: [{ id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } },
    { id: 'qwen/qwen3-coder', name: 'Qwen: Qwen3 Coder', supported_parameters: ['tools'], architecture: { input_modalities: ['text'] } },
    { id: 'some/no-tools', name: 'No tools', supported_parameters: [], architecture: { input_modalities: ['text'] } }] },
};

function handler(log = []) {
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, engine, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    // (the model downloads' stand-in: 40 MB of a fixed pattern for any /models/<file>, about 8 MB a second (MOCK_MODEL_MS=125: 2), with
    // ranges so a paused download resumes; its SHA-256 isn't the real model's, so the app's check refuses it)
    if (engine === 'models' && req.method === 'GET') {
      const size = 40 * 1024 * 1024;
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      const from = m ? Number(m[1]) : 0;
      res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size - from, 'Accept-Ranges': 'bytes', ETag: '"mock-model-1"', ...(m ? { 'Content-Range': `bytes ${from}-${size - 1}/${size}` } : {}) });
      let at = from;
      const chunk = Buffer.alloc(256 * 1024, 7);
      const pump = () => {
        if (res.destroyed) return;
        if (at >= size) { res.end(); return; }
        const n = Math.min(chunk.length, size - at);
        res.write(chunk.subarray(0, n));
        at += n;
        setTimeout(pump, Number(process.env.MOCK_MODEL_MS || 30));
      };
      pump();
      return;
    }
    if (url.pathname === '/log') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(log)); return; }
    const key = engine === 'claude-api' ? req.headers['x-api-key'] : String(req.headers.authorization || '').replace(/^Bearer /, '');
    const shape = engine === 'claude-api' ? 'anthropic' : 'openai';
    if (engine === 'claude-api' && req.headers['anthropic-version'] !== '2026-10-21') return fail(res, 400, 'anthropic-version header missing or not 2026-10-21', shape);
    if (engine === 'openrouter' && /\/models\/user$/.test(path) && req.method === 'GET') {
      if (!KEYS.includes(key)) return fail(res, 401, 'No auth credentials found', shape);
      const list = OPENROUTER || MODELS.openrouter;
      const mine = list.data.filter((m) => !/^~?(x-ai|meta-llama)\//.test(m.id));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: mine, total_count: mine.length, links: { next: null } }));
      return;
    }
    if (/\/models$/.test(path) && req.method === 'GET') {
      if (engine !== 'openrouter' && !KEYS.includes(key)) return fail(res, 401, 'invalid x-api-key', shape);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(engine === 'openrouter' ? OPENROUTER || MODELS.openrouter : MODELS[engine] || { data: [] }));
      return;
    }
    if (!KEYS.includes(key)) return fail(res, 401, engine === 'claude-api' ? 'invalid x-api-key' : engine === 'openrouter' ? 'No auth credentials found' : 'Incorrect API key provided.', shape);
    if (key === NO_CREDITS) {
      return engine === 'openrouter' ? fail(res, 402, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', shape)
        : engine === 'claude-api' ? fail(res, 400, 'Your credit balance is too low to access the Anthropic API.', shape)
          : fail(res, 429, 'You exceeded your current quota, please check your plan and billing details.', shape);
    }
    if (key === SILENT) { log.push({ api: engine, silent: true }); req.resume(); return; } // (never answered)
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return fail(res, 400, 'not JSON', shape); }
      if (!body.stream) return fail(res, 400, 'the app always streams', shape);
      if (/missing/.test(String(body.model || ''))) return fail(res, 404, engine === 'openrouter' ? `No endpoints found for ${body.model}.` : `model: ${body.model}`, shape);
      if (engine === 'claude-api' && path === '/v1/messages') return anthropic(body, res, log);
      if (engine === 'openai-api' && path === '/v1/responses') return responses(body, res, log);
      if (engine === 'openrouter' && path === '/api/v1/chat/completions') return completions(body, res, log);
      fail(res, 404, `no ${url.pathname}`, shape);
    });
  };
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8378);
  http.createServer(handler()).listen(port, '127.0.0.1', () => console.log(`mock APIs on http://localhost:${port} (key: ${FAKE_KEY})`));
}
module.exports = { handler, FAKE_KEY, NO_CREDITS, SILENT, modFor };
