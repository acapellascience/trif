'use strict';
// OpenAI Codex CLI adapter. EXPERIMENTAL: written from the Codex docs (non-interactive mode) and
// codex-rs/exec/src/{cli.rs,exec_events.rs}, not tested against a real install.
//
//   codex exec --json --skip-git-repo-check --sandbox workspace-write
//              -c sandbox_workspace_write.network_access=true [-m MODEL] [resume THREAD_ID] PROMPT
//
// JSONL events: {type:"thread.started", thread_id} | {type:"turn.started"} |
// {type:"item.started"|"item.updated"|"item.completed", item:{id, type, ...}} |
// {type:"turn.completed", usage} | {type:"turn.failed", error:{message}} | {type:"error", message}.
// Item types: agent_message {text}, reasoning {text}, command_execution {command, aggregated_output,
// exit_code, status}, file_change {changes:[{path, kind}]}, mcp_tool_call {server, tool},
// web_search {query}, todo_list, error {message}.

const { spawnSync } = require('child_process');
const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine } = require('./util');

const NOT_LOGGED_IN = "Codex isn't logged in: run `codex login` in a terminal (or set OPENAI_API_KEY under \"env\" in the workspace's config.json)";
const AUTH_RE = /not logged in|unauthori[sz]ed|\b401\b|please (run )?`?codex login|missing (api key|credentials)/i;

const adapter = {
  id: 'codex',
  name: 'Codex',
  binary: 'codex',
  systemPrompt: false, // context is prepended to the prompt
  note: 'experimental',
  missing: "Codex isn't installed, or the helper can't find it. Install it (npm install -g @openai/codex), " +
    'then run `webmods setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'experimental; not found' };
    return { available: true, path: file, version: version ? versionOf(file, env) : null, note: 'experimental' };
  },

  command({ bin, prompt, sessionId, model }) {
    // Exec options go before the `resume` subcommand (valid whether or not clap marks them global).
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write',
      // `webmods` talks to the helper over a unix socket; the sandbox blocks that without network access.
      '-c', 'sandbox_workspace_write.network_access=true'];
    if (model) args.push('-m', model);
    if (sessionId) args.push('resume', sessionId);
    args.push(prompt);
    return { file: bin || adapter.binary, args };
  },

  parse(line, emit, state = {}) {
    const msg = parseJsonLine(line);
    if (!msg) return;
    state.seen = state.seen || new Set();
    switch (msg.type) {
      case 'thread.started':
        if (msg.thread_id) { state.sessionId = msg.thread_id; emit({ kind: 'session', sessionId: msg.thread_id }); }
        break;
      case 'item.started':
      case 'item.completed': {
        const item = msg.item && typeof msg.item === 'object' ? msg.item : null;
        if (!item) break;
        const done = msg.type === 'item.completed';
        if (item.type === 'agent_message') {
          if (done && typeof item.text === 'string' && item.text.trim()) { state.lastText = item.text; emit({ kind: 'text', text: item.text }); }
        } else if (item.type === 'error') {
          if (done && item.message) emit({ kind: 'error', message: friendly(item.message) });
        } else {
          const tool = toolEvent(item, state.workspace);
          // Show tools as soon as they start; don't repeat them on completion.
          // (File changes wait for completion: their paths are only final then.)
          if (tool && !(item.id && state.seen.has(item.id)) && (done || item.type !== 'file_change')) {
            if (item.id) state.seen.add(item.id);
            emit(tool);
          }
        }
        break;
      }
      case 'turn.completed':
        state.turns = (state.turns || 0) + 1;
        emit({ kind: 'done', ok: true, result: state.lastText || null, costUsd: null, sessionId: state.sessionId || null });
        break;
      case 'turn.failed': {
        const m = (msg.error && msg.error.message) || 'Codex failed';
        emit({ kind: 'error', message: friendly(m) });
        emit({ kind: 'done', ok: false, result: m, costUsd: null, sessionId: state.sessionId || null });
        break;
      }
      case 'error':
        if (msg.message) emit({ kind: 'error', message: friendly(msg.message) });
        break;
      default:
        break;
    }
  },

  explainExit({ stderr }) {
    return AUTH_RE.test(String(stderr || '')) ? NOT_LOGGED_IN : null;
  },

  // `codex login status` exits 0 when logged in (no tokens spent).
  loginStatus({ path: file, env, cwd }) {
    try {
      const r = spawnSync(file, ['login', 'status'], { env, cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (r.error) return { loggedIn: null, detail: '' };
      const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
      if (r.status === 0 && !/not logged in/i.test(text)) return { loggedIn: true, detail: oneLine(text, 80) };
      if (/not logged in/i.test(text) || r.status === 1) return { loggedIn: false, detail: oneLine(text, 80) };
    } catch { /* ignore */ }
    return { loggedIn: null, detail: '' };
  },
  loginFix: 'run `codex login` in a terminal',
};

function friendly(message) {
  return AUTH_RE.test(String(message)) ? NOT_LOGGED_IN : String(message);
}

function toolEvent(item, workspace) {
  switch (item.type) {
    case 'command_execution': return { kind: 'tool', name: 'Bash', summary: oneLine(item.command) };
    case 'file_change': {
      const paths = (Array.isArray(item.changes) ? item.changes : []).map((c) => relToWorkspace(c && c.path, workspace)).filter(Boolean);
      return { kind: 'tool', name: 'Edit', summary: oneLine(paths.join(', ')) };
    }
    case 'mcp_tool_call': return { kind: 'tool', name: `${item.server || 'mcp'}.${item.tool || 'tool'}`, summary: '' };
    case 'web_search': return { kind: 'tool', name: 'WebSearch', summary: oneLine(item.query) };
    default: return null; // reasoning, todo_list
  }
}

module.exports = adapter;
module.exports.NOT_LOGGED_IN = NOT_LOGGED_IN;
