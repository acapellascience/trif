'use strict';
// OpenAI Codex CLI adapter (tested with Codex 0.166; needs 0.138+ for permission profiles).
//
//   codex exec --json --skip-git-repo-check --ignore-user-config --ignore-rules
//              -c approval_policy="never" -c default_permissions="webmods-run" -c permissions={…}
//              [-m MODEL] [resume THREAD_ID] PROMPT
//
// The run's site is enforced by the operating system, not just asked for: a permission profile makes the
// workspace read-only except the mods folder and screenshots/, and makes every existing mod folder of
// another site read-only inside it, so a run can't change or delete other sites' mods (or WebMods' own
// files: held.json, config.json) whatever it's told; config.json, which may hold API keys, isn't even
// readable (as for Claude Code). A new folder for another site can still be created;
// mods in it are held until the user approves them, like any out-of-scope mod (macOS Seatbelt, Linux bubblewrap;
// Codex refuses to run a command it can't sandbox). The user's own Codex config and rules files are
// ignored for these runs, since a sandbox_mode there would replace the profile and an "allow" rule could
// run commands outside it. Network stays on: `webmods` reaches the helper over a unix socket.
//
// JSONL events: {type:"thread.started", thread_id} | {type:"turn.started"} |
// {type:"item.started"|"item.updated"|"item.completed", item:{id, type, ...}} |
// {type:"turn.completed", usage} | {type:"turn.failed", error:{message}} | {type:"error", message}.
// Item types: agent_message {text}, reasoning {text}, command_execution {command, aggregated_output,
// exit_code, status}, file_change {changes:[{path, kind}]}, mcp_tool_call {server, tool},
// web_search {query}, todo_list, error {message}.

const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync, capture } = require('./util');

const NOT_LOGGED_IN = "Codex isn't logged in: run `codex login` in a terminal (or set OPENAI_API_KEY under \"env\" in the workspace's config.json)";
const AUTH_RE = /not logged in|unauthori[sz]ed|\b401\b|please (run )?`?codex login|missing (api key|credentials)/i;

const PROFILE = 'webmods-run';
const MIN_VERSION = [0, 138, 0]; // permission profiles

const tomlKey = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string here

/**
 * The inline TOML table for -c permissions=…: the workspace read-only, `writable` folders writable,
 * `readOnly` folders inside them read-only again (the more specific path wins), `denied` unreadable.
 */
function permissionsToml(writable = [], readOnly = [], denied = []) {
  const fsRules = [`${tomlKey(':workspace_roots')} = { "." = "read" }`,
    ...writable.map((p) => `${tomlKey(p)} = "write"`), ...readOnly.map((p) => `${tomlKey(p)} = "read"`), ...denied.map((p) => `${tomlKey(p)} = "deny"`)];
  return `{ ${PROFILE} = { extends = ":workspace", filesystem = { ${fsRules.join(', ')} }, network = { enabled = true } } }`;
}

function tooOld(version) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version || ''));
  if (!m) return false; // unknown: let it try
  const v = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_VERSION[i]) return v[i] < MIN_VERSION[i];
  return false;
}

const adapter = {
  id: 'codex',
  name: 'Codex',
  binary: 'codex',
  systemPrompt: false, // context is prepended to the prompt
  note: '',
  missing: "Codex isn't installed, or the helper can't find it. Install it (npm install -g @openai/codex), " +
    'then run `webmods setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'not found' };
    const v = version ? versionOf(file, env) : null;
    if (tooOld(v)) return { available: false, path: file, version: v, note: `Codex ${v} is too old for WebMods (it needs ${MIN_VERSION.join('.')} or newer): update it (brew upgrade codex, or npm install -g @openai/codex)` };
    return { available: true, path: file, version: v, note: '' };
  },

  // The models this account can use: Codex's own catalog (`codex debug models`, fetched for the signed-in
  // account), the ones it lists in its picker, best first. Its first one is what it uses by default.
  async listModels({ path: file, env, cwd }) {
    // (The catalog includes each model's full instructions: tens of KB.)
    const r = await capture(file, ['debug', 'models'], { env, cwd, timeout: 20000, maxBytes: 8 * 1024 * 1024 });
    let catalog = null;
    try { catalog = JSON.parse(r.stdout); } catch { /* below */ }
    const list = Array.isArray(catalog?.models) ? catalog.models : null;
    if (!list) return { models: [], default: null, custom: true, error: `couldn't read Codex's model list${r.stderr ? `: ${oneLine(r.stderr).slice(0, 200)}` : ''}` };
    const models = list.filter((m) => m && typeof m.slug === 'string' && m.visibility === 'list')
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => ({ id: m.slug, name: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug, description: typeof m.description === 'string' ? m.description : '' }));
    return { models, default: models[0]?.id || null, custom: false, error: null };
  },

  // writable / readOnly / denied: absolute (real) paths; see permissionsToml.
  command({ bin, prompt, sessionId, model, writable = [], readOnly = [], denied = [] }) {
    // Exec options go before the `resume` subcommand (verified with Codex 0.166).
    const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '-c', 'approval_policy="never"', '-c', `default_permissions="${PROFILE}"`, '-c', `permissions=${permissionsToml(writable, readOnly, denied)}`];
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
  loginStatusArgs: ['login', 'status'],
  parseLoginStatus({ status, error, stdout, stderr }) {
    if (error) return { loggedIn: null, detail: '' };
    const text = `${stdout || ''}${stderr || ''}`.trim();
    if (status === 0 && !/not logged in/i.test(text)) return { loggedIn: true, detail: oneLine(text, 80) };
    if (/not logged in/i.test(text) || status === 1) return { loggedIn: false, detail: oneLine(text, 80) };
    return { loggedIn: null, detail: '' };
  },
  loginStatus({ path: file, env, cwd }) {
    return adapter.parseLoginStatus(captureSync(file, adapter.loginStatusArgs, { env, cwd }));
  },
  loginFix: 'run `codex login` in a terminal',
  // No side panel login: `codex login` finishes through a localhost callback server (port 1455) or a
  // device code, not a code pasted back on stdin, and it's untested here. The panel shows loginFix.
  login: null,
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
adapter.permissionsToml = permissionsToml;
adapter.tooOld = tooOld;
module.exports.NOT_LOGGED_IN = NOT_LOGGED_IN;
