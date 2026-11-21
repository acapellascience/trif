#!/usr/bin/env node
'use strict';
// The `trif` tool for side-panel agent runs on Windows (docs/WINDOWS.md "The sandbox"), and on macOS in
// TRIF's full sandbox when an organization forces Claude Code's own sandbox on (docs/WHOLE-BOX.md step 7:
// Claude Code's sandbox can't start inside TRIF's box, so its Bash would fail every command).
//
// There a run's agent gets no shell (none can be fenced: helper/lib/win/fence.js). In its place it gets
// one tool, `trif`, served by this program over MCP (JSON-RPC on stdin and stdout, a line each): the agent
// gives a `trif` command's words, and this starts TRIF's own CLI with them inside the run's fence (an
// AppContainer), where it reaches the helper through the run's mailbox as `trif` does in any run, and
// answers with what it printed.
//
//   node mcp.js <config.json>      (the agent starts it; runs.js wrote the config in the run's own folder)
//   config: { launcher: {file, prefix}, spec, node, nodeFlags, cli, timeoutMs, files, env, cwd }
//
// With no `launcher` (macOS, TRIF's full sandbox): the agent, and so this program, is already inside
// TRIF's box (wholebox.js), and what this starts inherits it; the program is started as it is, with
// `env` (the run's TRIF_* variables) over this program's own environment, in `cwd` (the run's working folder).
//
// With `files` (the path of lib/win/fenced-files.js: for an agent with no file tools of its own that TRIF
// can hold to the run's folders, Codex), it offers file tools too: read_file, write_file, edit_file,
// list_files, search_files, view_image, each done by that program inside the fence as well.
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

// The file tools (config.files): what each is called, says and takes; `op` is fenced-files.js's.
const where = 'Paths are relative to your working folder (sites/x.com/hide-banner.js). You can read anything in it, and change files in your own site\'s folder under sites/ (and sites/all-sites/); other sites\' folders and the guides are read-only.';
const FILE_TOOLS = [
  { name: 'read_file', op: 'read', description: `Reads a text file. ${where} Long files come in parts: \`offset\` is the first line (from 1), \`limit\` how many.`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['path'] } },
  { name: 'write_file', op: 'write', description: `Writes a whole file, replacing it if it's there (folders are made as needed). ${where}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'The file\'s whole text.' } }, required: ['path', 'content'] } },
  { name: 'edit_file', op: 'edit', description: `Replaces one piece of text in a file with another. \`old\` must be in the file exactly once, as it is there (or pass \`all\`: true for every place). ${where}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, all: { type: 'boolean' } }, required: ['path', 'old', 'new'] } },
  { name: 'list_files', op: 'list', description: `Lists a folder (folders end in /). \`depth\`: how many levels below it to list too (1 by default). ${where}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer' } } } },
  { name: 'search_files', op: 'search', description: `Finds lines matching a regular expression in a file or under a folder: file:line: text. ${where}`,
    inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, ignoreCase: { type: 'boolean' } }, required: ['pattern'] } },
  { name: 'view_image', op: 'image', maxOutput: 8 * 1024 * 1024, description: 'Shows you a picture (.png, .jpg, .gif, .webp): a screenshot `trif screenshot` made, by the path it printed.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];
const FILES_NOTE = ' To look at and change files use read_file, write_file, edit_file, list_files and search_files; view_image shows you a screenshot.';

/** Does a file tool's work inside the fence: resolves the tool's answer. Never rejects. */
function runFileTool(config, tool, args, opts = {}) {
  return runFenced(config, [config.node, ...(config.nodeFlags || []), config.files], JSON.stringify({ op: tool.op, args: args && typeof args === 'object' ? args : {} }), { ...opts, maxOutput: tool.maxOutput }).then((r) => {
    let j = null;
    try { j = JSON.parse(r.stdout); } catch { /* below */ }
    if (j && j.ok && j.image && typeof j.image.data === 'string') return { content: [{ type: 'image', data: j.image.data, mimeType: String(j.image.mimeType) }], isError: false };
    if (j && typeof j.text === 'string') return { content: [{ type: 'text', text: j.text.length > MAX_OUTPUT ? `${j.text.slice(0, MAX_OUTPUT)}\n[… cut]` : j.text }], isError: !j.ok };
    return { content: [{ type: 'text', text: `couldn't ${tool.name.replace('_', ' the ')}: ${r.note || (r.stderr || r.stdout || `exit status ${r.code}`).trim().slice(0, 400)}` }], isError: true };
  });
}

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
function runTrif(config, input, opts = {}) {
  return runFenced(config, [config.node, ...(config.nodeFlags || []), config.cli, ...input.args], input.stdin, opts);
}

/** Starts `program` (a file and its arguments) inside the run's fence (or box), `stdin` on its standard input. */
function runFenced(config, program, stdin, { spawnFn = spawn, maxOutput = MAX_OUTPUT } = {}) {
  return new Promise((resolve) => {
    const l = config.launcher;
    const [file, argv] = l ? [l.file, [...(l.prefix || []), 'exec', config.spec, '--', ...program]] : [program[0], program.slice(1)];
    const env = l ? undefined : { ...process.env, ...(config.env && typeof config.env === 'object' ? config.env : {}) };
    let child;
    try { child = spawnFn(file, argv, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...(env ? { env } : {}), ...(!l && config.cwd ? { cwd: config.cwd } : {}) }); } catch (e) { resolve({ code: null, stdout: '', stderr: '', note: `couldn't start trif: ${e.message}` }); return; }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, note: '', ...r }); };
    const ms = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
    // (ending the launcher ends what it started: they're in one job)
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: null, note: `stopped after ${Math.round(ms / 1000)} s` }); }, ms);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < maxOutput) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < maxOutput) stderr += d; });
    child.on('error', (e) => finish({ code: null, note: `couldn't start trif: ${e.message}` }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => { /* it may exit before reading */ });
    child.stdin.end(typeof stdin === 'string' ? stdin : undefined);
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
    const fileTools = config.files ? FILE_TOOLS : [];
    if (m.method === 'tools/list') return answer(m.id, { tools: [{ ...TOOL, description: TOOL.description.replace(' To look at files use your own reading and searching tools: there is no `ls` or `cd`.', fileTools.length ? FILES_NOTE : ' To look at files use your own reading and searching tools: there is no `ls` or `cd`.') }, ...fileTools.map(({ op, ...t }) => t)] });
    if (m.method === 'tools/call') {
      const p = m.params || {};
      const fileTool = fileTools.find((t) => t.name === p.name);
      if (fileTool) return runFileTool(config, fileTool, p.arguments).then((r) => answer(m.id, r), (e) => answer(m.id, { content: [{ type: 'text', text: e.message }], isError: true }));
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
  for (const k of ['node', 'cli']) if (typeof c[k] !== 'string' || !c[k]) throw new Error(`the config has no ${k}`);
  // (no launcher: macOS's full sandbox, already in the box; else the fence's launcher and its spec)
  if (c.launcher !== undefined && (!c.launcher || typeof c.launcher.file !== 'string')) throw new Error('the config has no launcher');
  if (c.launcher && (typeof c.spec !== 'string' || !c.spec)) throw new Error('the config has no spec');
  return c;
}

if (require.main === module) {
  let config;
  try { config = readConfig(process.argv[2]); } catch (e) { process.stderr.write(`trif mcp: ${e.message}\n`); process.exit(2); }
  serve(config);
}

module.exports = { TOOL, FILE_TOOLS, inputProblem, runTrif, runFenced, runFileTool, toolResult, serve, readConfig, MAX_OUTPUT };
