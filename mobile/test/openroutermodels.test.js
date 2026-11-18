'use strict';
// OpenRouter's models as More's picker shows them (Tim, 11-18: "the Models list is endless"): the iPhone app's
// OpenRouterModels.swift (swiftc with mobile/test/openroutermodels-check/main.swift) on a trimmed copy of OpenRouter's
// real public list (mobile/test/openrouter-models.json, recorded 11-18) and on made-up rows for each rule: what's fit
// for writing mods, the Recommended picks, Recent, the makers' groups, and the price and context line.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const LIST = path.join(HERE, 'openrouter-models.json');

let bin;
function build() {
  if (bin) return bin;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-openroutermodels-check-'));
  bin = path.join(dir, 'check');
  execFileSync('xcrun', ['swiftc', path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'OpenRouterModels.swift'), path.join(HERE, 'openroutermodels-check', 'main.swift'), '-o', bin],
    { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
  return bin;
}
const run = (file, today, used = []) => JSON.parse(execFileSync(build(), [file, today, used.join(',')], { encoding: 'utf8' }));
const mac = { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 };

const row = (id, o = {}) => ({
  id, name: o.name || `Maker: ${id}`, created: o.created || 1, context_length: o.context ?? 200000,
  top_provider: { context_length: o.top === undefined ? o.context ?? 200000 : o.top },
  pricing: { prompt: o.in ?? '0.000003', completion: o.out ?? '0.000015' },
  supported_parameters: o.params || ['tools', 'tool_choice'],
  architecture: { input_modalities: o.inputs || ['text'], output_modalities: o.outputs || ['text'] },
  endpoints: o.endpoints || ['/api/v1/chat/completions', '/api/v1/responses'],
  expiration_date: o.expires ?? null, ...(o.alias ? { alias_target: { name: o.alias, slug: 'x/y' } } : {}),
});

test('the recorded list: fit models, the short list, the groups', mac, () => {
  const r = run(LIST, '2026-11-18', ['qwen/qwen3.7-plus', 'anthropic/claude-haiku-5.5', '~anthropic/claude-sonnet-latest', 'gone/model']);
  const all = require(LIST).data;
  assert.ok(r.fit.length > 60 && r.fit.length < all.length, `${r.fit.length} of ${all.length} fit`);
  // (batch-only rows, no tools, small context)
  assert.equal(r.unfit['anthropic/claude-opus-5.5:batch'], 'not on chat completions');
  assert.equal(r.unfit['meta-llama/llama-3.2-1b-instruct'], 'no tools');
  assert.equal(r.unfit['openai/gpt-3.5-turbo-0613'], 'context under 32K');
  assert.ok(!r.fit.some((id) => id.endsWith(':batch')));
  // Recommended: the table's order, every row present in this list
  assert.deepEqual(r.recommended, ['~anthropic/claude-opus-latest', '~anthropic/claude-sonnet-latest', '~openai/gpt-astra-latest',
    '~google/gemini-pro-latest', '~google/gemini-flash-latest', '~deepseek/deepseek-flash-latest', 'cohere/north-mini-code:free']);
  assert.equal(r.names['~anthropic/claude-opus-latest'], 'Claude Opus Latest (Claude Opus 5.5)');
  assert.equal(r.names['cohere/north-mini-code:free'], 'North Mini Code', 'a free model\'s "(free)" is left to the Free mark');
  // Recent: used ones the list has, not already in Recommended, newest first
  assert.deepEqual(r.recent.filter((id) => r.fit.includes(id)), r.recent);
  assert.ok(!r.recent.includes('~anthropic/claude-sonnet-latest') && !r.recent.includes('gone/model'));
  assert.equal(r.recent[0], r.fit.includes('qwen/qwen3.7-plus') ? 'qwen/qwen3.7-plus' : 'anthropic/claude-haiku-5.5');
  // the groups: the known makers first, in order; Auto not in them
  const makers = r.groups.map((g) => g.maker);
  assert.deepEqual(makers.slice(0, 4), ['Anthropic', 'OpenAI', 'Google', 'Meta']);
  assert.ok(makers.indexOf('DeepSeek') < makers.indexOf('xAI') && makers.indexOf('xAI') < makers.indexOf('Cohere'));
  assert.ok(!r.groups.some((g) => g.ids.includes('openrouter/auto')));
  const anthropic = r.groups[0].ids;
  assert.ok(anthropic[0].startsWith('~'), 'aliases first');
  // every fit model in exactly one group (Auto aside)
  const grouped = r.groups.flatMap((g) => g.ids);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.equal(grouped.length, r.fit.filter((id) => id !== 'openrouter/auto').length);
  // lines
  assert.equal(r.lines['~anthropic/claude-opus-latest'], '$4 in, $20 out per million tokens · 1M context');
  assert.equal(r.lines['cohere/north-mini-code:free'], 'Free · 256K context');
  assert.equal(r.lines['openrouter/auto'], 'Price varies · 2M context');
  assert.ok(r.free.includes('cohere/north-mini-code:free') && !r.free.includes('openrouter/auto'));
});

test('each rule on made-up rows', mac, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-openrouter-rows-'));
  const file = path.join(dir, 'rows.json');
  const rows = [
    row('a/ok'), row('a/no-tools', { params: ['temperature'] }), row('a/batch:batch', { endpoints: ['/api/v1/batches'] }),
    row('a/no-endpoints-field'), row('a/pictures-out', { outputs: ['image'] }), row('a/small', { context: 16000 }),
    row('a/top-small', { context: 1000000, top: 24000 }), row('a/router', { top: null, context: 128000 }),
    row('a/expired', { expires: '2026-11-17' }), row('a/expires-today', { expires: '2026-11-18' }), row('a/ok'),
    row('b/free-old:free', { in: '0', out: '0', created: 5 }), row('b/free-new:free', { in: '0', out: '0', created: 9 }),
    row('openrouter/free', { in: '0', out: '0', created: 99 }), row('c/cheap', { in: '0.00000004', out: '0.00000015' }),
    row('~anthropic/claude-opus-latest', { name: 'Anthropic: Claude Opus Latest', alias: 'Anthropic: Claude Opus 9' }),
    row('anthropic/claude-sonnet-5.5', { name: 'Anthropic: Claude Sonnet 5.5', created: 3 }),
    row('zz/thing', { name: 'Zed Labs: Thing' }),
  ];
  delete rows[3].endpoints;
  fs.writeFileSync(file, JSON.stringify({ data: rows }));
  const r = run(file, '2026-11-18', ['c/cheap', 'a/ok', 'openrouter/auto', 'c/cheap']);
  assert.deepEqual(r.unfit, {
    'a/no-tools': 'no tools', 'a/batch:batch': 'not on chat completions', 'a/pictures-out': 'no text out', 'a/small': 'context under 32K',
    'a/top-small': 'context under 32K', 'a/expired': 'expired',
  });
  assert.ok(r.fit.includes('a/no-endpoints-field') && r.fit.includes('a/router') && r.fit.includes('a/expires-today'));
  assert.equal(r.fit.filter((id) => id === 'a/ok').length, 1);
  // (Opus by its alias, Sonnet by its fallback, the newest free model that isn't a router)
  assert.deepEqual(r.recommended, ['~anthropic/claude-opus-latest', 'anthropic/claude-sonnet-5.5', 'b/free-new:free']);
  assert.deepEqual(r.recent, ['c/cheap', 'a/ok']);
  assert.equal(r.names['~anthropic/claude-opus-latest'], 'Claude Opus Latest (Claude Opus 9)');
  assert.equal(r.lines['c/cheap'], '$0.04 in, $0.15 out per million tokens · 200K context');
  assert.equal(r.lines['a/router'], '$3 in, $15 out per million tokens · 128K context');
  const makers = r.groups.map((g) => g.maker);
  assert.deepEqual(makers, ['Anthropic', 'OpenRouter', 'Maker', 'Zed Labs']);
});
