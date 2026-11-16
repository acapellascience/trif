#!/usr/bin/env node
'use strict';
// The `trif` tool for side-panel agent runs on Windows (docs/WINDOWS.md "The sandbox").
//
// There a run's agent gets no shell (none can be fenced: helper/lib/win/fence.js). In its place it gets
// one tool, `trif`, served by this program over MCP (JSON-RPC on stdin and stdout, a line each): the agent
// gives a `trif` command's words, and this starts TRIF's own CLI with them inside the run's fence (an
// AppContainer), where it reaches the helper through the run's mailbox as `trif` does in any run, and
// answers with what it printed.
//
//   node mcp.js <config.json>      (the agent starts it; runs.js wrote the config in the run's own folder)
//   config: { launcher: {file, prefix}, spec, node, nodeFlags, cli, timeoutMs }
//
// This program itself is outside the fence (the agent starts it, and the agent is). It reads no file but
// its config, opens no network, and does one thing: start the launcher with the run's spec and the words
// it was given, each word one argument, with no shell anywhere to read them as anything else.

const fs = require('fs');
const { spawn } = require('child_process');

const MAX_ARGS = 256;
const MAX_INPUT = 8 * 1024 * 1024; // the words and the standard input together
const MAX_OUTPUT = 512 * 1024; // of what the command printed, each of stdout and stderr
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const TOOL = {
  name: 'trif',
  description: 'Runs a TRIF command: the `trif` of AGENTS.md. There is no shell in this chat, so wherever the guides say to run '
    + '`trif <words>`, call this tool with those words as `args`, one item per word: `trif check sites/x.com/a.js` is '
    + '{"args": ["check", "sites/x.com/a.js"]}, and `trif run --tab 12 \'document.title\'` is {"args": ["run", "--tab", "12", "document.title"]} '
    + '(an item is one argument as it is: no quotes around it, no pipes, no redirection). `stdin` is the text for a command '
    + 'that reads standard input (`trif run -`). The answer is what the command printed. To look at files use your own '
    + 'reading and searching tools: there is no `ls` or `cd`.',
  inputSchema: {
    type: 'object',
    properties: {
      args: { type: 'array', items: { type: 'string' }, description: 'The words after `trif`, one per item.' },
      stdin: { type: 'string', description: 'Text for the command\'s standard input, if it reads any.' },
    },
    required: ['args'],
  },
};

/** Why `input` can't be run (a string), or null. */
function inputProblem(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.args)) return '`args` must be a list of words, e.g. {"args": ["status"]}';
  if (input.args.length > MAX_ARGS) return `too many words (${MAX_ARGS} at most)`;
  let size = 0;
  for (const a of input.args) {
    if (typeof a !== 'string') return 'every item of `args` must be text';
    if (a.includes('\0')) return 'an item of `args` has a character that can\'t be passed to a program';
    size += a.length;
  }
  if (input.stdin !== undefined && typeof input.stdin !== 'string') return '`stdin` must be text';
  if (size + (input.stdin ? input.stdin.length : 0) > MAX_INPUT) return 'too much to pass to one command';
  return null;
}

/** Runs `trif <args>` inside the fence: resolves {code, stdout, stderr, note}. Never rejects. */
function runTrif(config, input, { spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const l = config.launcher;
    const argv = [...(l.prefix || []), 'exec', config.spec, '--', config.node, ...(config.nodeFlags || []), config.cli, ...input.args];
    let child;
    try { child = spawnFn(l.file, argv, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { resolve({ code: null, stdout: '', stderr: '', note: `couldn't start trif: ${e.message}` }); return; }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, note: '', ...r }); };
    const ms = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
    // (ending the launcher ends what it started: they're in one job)
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: null, note: `stopped after ${Math.round(ms / 1000)} s` }); }, ms);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on('error', (e) => finish({ code: null, note: `couldn't start trif: ${e.message}` }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => { /* it may exit before reading */ });
    child.stdin.end(typeof input.stdin === 'string' ? input.stdin : undefined);
  });
}

/** The tool's answer for a finished command, as MCP wants it. */
function toolResult(r) {
  const cut = (s) => (s.length >= MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n[…more than ${MAX_OUTPUT / 1024} KB: cut]` : s);
  const parts = [cut(r.stdout).replace(/\s+$/, ''), cut(r.stderr).replace(/\s+$/, '')].filter(Boolean);
  if (r.note) parts.push(`trif: ${r.note}`);
  else if (r.code !== 0) parts.push(`(exit status ${r.code})`);
  return { content: [{ type: 'text', text: parts.join('\n') || '(no output)' }], isError: !!r.note || r.code !== 0 };
}

/** Serves MCP on `input`/`output` (streams) for `config`. Returns nothing; ends when `input` does. */
function serve(config, { input = process.stdin, output = process.stdout, run = runTrif } = {}) {
  const send = (m) => { try { output.write(`${JSON.stringify(m)}\n`); } catch { /* the agent is gone */ } };
  const answer = (id, result) => send({ jsonrpc: '2.0', id, result });
  const refuse = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const handle = (m) => {
    if (!m || typeof m !== 'object' || typeof m.method !== 'string') return;
    const hasId = m.id !== undefined && m.id !== null;
    if (m.method === 'initialize') {
      return answer(m.id, { protocolVersion: (m.params && typeof m.params.protocolVersion === 'string' && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'trif', version: String(config.version || '0') } });
    }
    if (m.method === 'ping') return answer(m.id, {});
    if (m.method === 'tools/list') return answer(m.id, { tools: [TOOL] });
    if (m.method === 'tools/call') {
      const p = m.params || {};
      if (p.name !== TOOL.name) return refuse(m.id, -32602, `no tool called ${String(p.name).slice(0, 60)}`);
      const problem = inputProblem(p.arguments);
      if (problem) return answer(m.id, { content: [{ type: 'text', text: `trif: ${problem}` }], isError: true });
      return run(config, p.arguments).then((r) => answer(m.id, toolResult(r)), (e) => answer(m.id, { content: [{ type: 'text', text: `trif: ${e.message}` }], isError: true }));
    }
    if (hasId) refuse(m.id, -32601, `no method ${m.method.slice(0, 60)}`); // (notifications get no answer)
  };
  let buf = '';
  input.setEncoding('utf8');
  input.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { refuse(null, -32700, 'not JSON'); continue; }
      try { handle(m); } catch (e) { if (m && m.id !== undefined) refuse(m.id, -32603, e.message); }
    }
  });
}

function readConfig(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['spec', 'node', 'cli']) if (typeof c[k] !== 'string' || !c[k]) throw new Error(`the config has no ${k}`);
  if (!c.launcher || typeof c.launcher.file !== 'string') throw new Error('the config has no launcher');
  return c;
}

if (require.main === module) {
  let config;
  try { config = readConfig(process.argv[2]); } catch (e) { process.stderr.write(`trif mcp: ${e.message}\n`); process.exit(2); }
  serve(config);
}

module.exports = { TOOL, inputProblem, runTrif, toolResult, serve, readConfig, MAX_OUTPUT };
