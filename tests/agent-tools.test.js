'use strict';
// The tools a side-panel run actually gets from the agents installed here (skipped when one isn't),
// read without reaching any model: Claude Code's init message (it prints it before its first request,
// sent here to a closed port), and Codex's `debug prompt-input` (its model-visible tool list, rendered
// locally). Every release of either adds tools, and a tool the sandbox doesn't cover is a way out of it
// (0.2.0: Claude Code's Grep searched the whole home folder). When this fails after an update, look at
// what each new tool can reach before adding it here: the run's limits must cover it, or turn it off
// (claude.js TOOLS, codex.js FEATURES_OFF).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const claude = require('../helper/lib/agents/claude');
const codex = require('../helper/lib/agents/codex');
const { findExecutable } = require('../helper/lib/agents/util');
const agents = require('../helper/lib/agents');
const { tempDir } = require('./fake-extension');

const dirs = () => [...new Set([...(process.env.PATH || '').split(path.delimiter), ...agents.defaultDirs()])].filter(Boolean);

// Reviewed with Codex 0.166 (see codex.js): its shell, apply_patch and view_image run in the sandbox,
// sub-agents inherit the run's profile, the MCP readers have no servers (--ignore-user-config), `exec`
// is a JavaScript isolate with no files or network that calls the others.
const CODEX_TOOLS = ['apply_patch', 'clock__curr_time', 'exec', 'exec_command', 'followup_task', 'interrupt_agent',
  'list_agents', 'list_mcp_resource_templates', 'list_mcp_resources', 'read_mcp_resource', 'request_user_input',
  'request_user_input_async', 'send_message', 'sleep', 'spawn_agent', 'view_image', 'wait', 'wait_agent', 'write_stdin'];

function fakeLimits() {
  const root = fs.realpathSync(tempDir());
  const ws = path.join(root, 'home', '.trif');
  fs.mkdirSync(path.join(ws, 'sites'), { recursive: true });
  const box = path.join(root, 'box');
  fs.mkdirSync(path.join(box, 'tmp'), { recursive: true });
  return { root, limits: { workspace: ws, home: path.join(root, 'home'), readable: [ws], writable: [path.join(ws, 'sites'), box], privateDir: path.join(root, 'private'), box, tmp: path.join(box, 'tmp'), screenshots: path.join(root, 'shots') } };
}

const claudeBin = findExecutable('claude', dirs());
test('claude: a run has exactly TRIF\'s tools', { skip: !claudeBin && 'Claude Code not installed' }, async () => {
  const { root, limits } = fakeLimits();
  const agentDir = path.join(root, 'agent');
  fs.mkdirSync(agentDir);
  const c = claude.command({ bin: claudeBin, prompt: 'hi', agentDir, ...limits });
  for (const f of c.files) fs.writeFileSync(f.path, f.content);
  const env = { HOME: os.homedir(), USER: os.userInfo().username, PATH: dirs().join(path.delimiter), TERM: 'dumb',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'placeholder' }; // a closed port: no model
  const tools = await new Promise((resolve, reject) => {
    const child = spawn(c.file, c.args, { cwd: limits.workspace, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no init message from Claude Code')); }, 60000);
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'system' && m.subtype === 'init') { clearTimeout(timer); child.kill('SIGKILL'); resolve(m.tools); return; }
      }
    });
    child.stdin.end('hi');
  });
  assert.deepEqual([...tools].sort(), [...claude.tools].sort());
});

const codexBin = findExecutable('codex', dirs());
test('codex: a run has only the reviewed tools, and no web search', { skip: !codexBin && 'Codex not installed' }, () => {
  const { root, limits } = fakeLimits();
  const c = codex.command({ bin: codexBin, prompt: 'hi', ...limits });
  const config = [];
  for (let i = 0; i < c.args.length; i++) if (c.args[i] === '-c') config.push('-c', c.args[i + 1]);
  // (A blank CODEX_HOME, as --ignore-user-config would: `debug prompt-input` doesn't take that flag.)
  const codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(codexHome);
  const r = spawnSync(c.file, ['debug', 'prompt-input', ...config, 'hi'], { cwd: limits.workspace, env: { ...process.env, CODEX_HOME: codexHome }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const input = JSON.parse(r.stdout);
  const names = new Set();
  for (const item of input.filter((x) => x.type === 'additional_tools')) {
    for (const ns of item.tools || []) {
      for (const t of ns.tools || [ns]) {
        names.add(t.name);
        // `exec` lists the tools it can call in its description.
        for (const m of String(t.description || '').matchAll(/^### `([\w]+)`/gm)) names.add(m[1]);
      }
    }
  }
  assert.deepEqual([...names].sort(), [...CODEX_TOOLS].sort());
  assert.ok(!/web_search/.test(r.stdout), 'no web search tool');
});
