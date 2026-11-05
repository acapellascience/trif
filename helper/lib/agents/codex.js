'use strict';
// OpenAI Codex CLI adapter (tested with Codex 0.166; needs 0.138+ for permission profiles).
//
//   codex exec --json --skip-git-repo-check --ignore-user-config --ignore-rules
//              -c approval_policy="never" -c default_permissions="trif-run" -c permissions={…}
//              [-m MODEL] [resume THREAD_ID] -        (the message on stdin)
//
// The run's limits (runs.js runLimits) are enforced by the operating system, not just asked for: a
// permission profile (macOS Seatbelt, Linux bubblewrap; Codex refuses to run a command it can't sandbox)
// lets the commands it runs
//   - read the workspace (all of it: nothing private is kept there), the TRIF code and node, and nothing
//     else in the home folder (no ~/.ssh, no Codex's own login), nor TRIF's private folder (settings,
//     logs, other runs' logs, other sites' screenshots: paths.js privateDir), wherever it is;
//   - write only the mods folder (every existing mod folder of another site read-only inside it), the
//     run's screenshots folder and its mailbox, so a run can't change other sites' mods or TRIF's own
//     files. A new folder for another site can still be created; mods in it are held until the user
//     approves them, like any out-of-scope mod;
//   - reach no network at all: `trif` talks to the helper through the run's mailbox (client.js), so
//     a run can't send what it read anywhere, nor reach the helper's sockets without its site limit;
//   - neither read nor write the system's temporary folders (/tmp, $TMPDIR: other programs' files,
//     every Claude Code session's scratch files in /tmp/claude-<uid>), which Codex's :workspace profile
//     makes writable: the commands get a temporary folder in the run's box instead (TMPDIR, and
//     TMPPREFIX for zsh's here-documents; macOS's bash 3.2 only uses /tmp for them, so those fail);
//   - nor read other users' folders and other volumes (runs.js deniedOutsideHome).
// And no Codex tools beyond its shell, apply_patch and view_image (both sandboxed: checked in Codex
// 0.166's source) and its sub-agents (which inherit the profile): web search off (on by default, even
// with no network, "cached" mode), and the features that reach outside the sandbox off (FEATURES_OFF).
// Codex has no tool allowlist like Claude Code's --tools: tests/agent-tools.test.js checks the tools a
// run gets.
// The user's own Codex config and rules files are ignored for these runs, since a sandbox_mode there would
// replace the profile and an "allow" rule could run commands outside it.
//
// JSONL events: {type:"thread.started", thread_id} | {type:"turn.started"} |
// {type:"item.started"|"item.updated"|"item.completed", item:{id, type, ...}} |
// {type:"turn.completed", usage} | {type:"turn.failed", error:{message}} | {type:"error", message}.
// Item types: agent_message {text}, reasoning {text}, command_execution {command, aggregated_output,
// exit_code, status}, file_change {changes:[{path, kind}]}, mcp_tool_call {server, tool},
// web_search {query}, todo_list, error {message}.

const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync, capture } = require('./util');

const NOT_LOGGED_IN = "Codex isn't logged in: run `codex login` in a terminal (or save an OpenAI API key: trif agent key --agent codex --set-key)";
const AUTH_RE = /not logged in|unauthori[sz]ed|\b401\b|please (run )?`?codex login|missing (api key|credentials)/i;

const PROFILE = 'trif-run';
// Codex builds its commands' environment from a snapshot of the user's login shell, taken by Codex itself
// (outside the sandbox), so a key still exported in ~/.zshrc would reach them that way (seen with Codex
// 0.166 and a stand-in profile). TRIF's own keys are never there (keyring); these case-insensitive globs
// keep out the usual API key variables a profile may still export. (Not *TOKEN*: TRIF_RUN_TOKEN must get
// through.)
const EXCLUDED_VARS = ['*_API_KEY', '*_API_TOKEN', '*_ACCESS_TOKEN', '*_AUTH_TOKEN', '*_SECRET_KEY'];
const MIN_VERSION = [0, 138, 0]; // permission profiles
// Features on by default in Codex 0.166 that act outside the sandbox: ChatGPT apps (connectors on the
// user's account), plugins, browser and computer use, image generation, MCP installs for skills, hooks.
// (Unknown feature names are ignored, so older versions take these too.)
const FEATURES_OFF = ['apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'in_app_browser', 'computer_use', 'in_app_local_automation', 'image_generation',
  'skill_mcp_dependency_install', 'hooks', 'tool_suggest'];

const tomlKey = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string here

/**
 * The inline TOML table for -c permissions=…: `denied` unreadable, `readable` read-only, `writable`
 * writable, `readOnly` read-only again inside those; the more specific path wins (so a readable workspace
 * inside a denied home folder is readable, and the run's own screenshots folder inside the denied private
 * folder is writable). No network.
 */
function permissionsToml({ readable = [], writable = [], readOnly = [], denied = [] } = {}) {
  const fsRules = [`${tomlKey(':workspace_roots')} = { "." = "read" }`, `${tomlKey(':tmpdir')} = "deny"`, `${tomlKey(':slash_tmp')} = "deny"`,
    ...denied.map((p) => `${tomlKey(p)} = "deny"`), ...readable.map((p) => `${tomlKey(p)} = "read"`),
    ...writable.map((p) => `${tomlKey(p)} = "write"`), ...readOnly.map((p) => `${tomlKey(p)} = "read"`)];
  return `{ ${PROFILE} = { extends = ":workspace", filesystem = { ${fsRules.join(', ')} }, network = { enabled = false } } }`;
}

// Codex streams from OpenAI over a WebSocket and, when that drops, retries and then switches to HTTPS,
// saying each step as an error event: "Reconnecting... 2/5 (stream disconnected before completion: …)",
// up to 5/5, then "Falling back from WebSockets to HTTPS transport." after which the turn goes on fine.
// (The transport can't be chosen for a run: the WebSocket feature flags are gone in 0.166, it's a setting
// of the model provider, and the built-in openai provider can't be overridden.) Those become one quiet
// line per run. A real failure still shows: a retry that gives up ends in a different error, or
// turn.failed.
const TRANSPORT_NOISE = /^\s*(Reconnecting\.\.\.|Falling back from WebSockets to HTTPS transport)/i;
function transportNoise(message, emit, state) {
  if (!TRANSPORT_NOISE.test(String(message || ''))) return false;
  if (!state.reconnecting) { state.reconnecting = true; emit({ kind: 'tool', name: `reconnecting to ${state.providerName || 'OpenAI'}…`, summary: '' }); }
  return true;
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
    'then run `trif setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'not found' };
    const v = version ? versionOf(file, env) : null;
    if (tooOld(v)) return { available: false, path: file, version: v, note: `Codex ${v} is too old for TRIF (it needs ${MIN_VERSION.join('.')} or newer): update it (brew upgrade codex, or npm install -g @openai/codex)` };
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

  // writable / readOnly / denied: absolute (real) paths; see permissionsToml. `config`: more -c pairs
  // (codex-oss: its provider; a plain run with an API key: the key proxy's provider, see keyProvider).
  command({ bin, prompt, sessionId, model, readable = [], writable = [], readOnly = [], denied = [], lockedDirs = [], tmp = '', config = [] }) {
    // Exec options go before the `resume` subcommand (verified with Codex 0.166).
    const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '-c', 'approval_policy="never"', '-c', `default_permissions="${PROFILE}"`, '-c', `permissions=${permissionsToml({ readable, writable, readOnly, denied })}`, ...config,
      '-c', `shell_environment_policy.exclude=[${EXCLUDED_VARS.map(tomlKey).join(', ')}]`,
      ...(tmp ? ['-c', `shell_environment_policy.set={ TMPDIR = ${tomlKey(tmp)}, TMPPREFIX = ${tomlKey(`${tmp}/zsh`)} }`] : []),
      '-c', 'web_search="disabled"', ...FEATURES_OFF.flatMap((f) => ['-c', `features.${f}=false`])];
    if (model) args.push('-m', model);
    if (sessionId) args.push('resume', sessionId);
    // The message on stdin (`-`), not in argv, which any same-user process can read (`ps`, sysctl
    // KERN_PROCARGS2; the agent's sandboxed commands included).
    args.push('-');
    // Other sites' folders the profile makes read-only (by real path: the sandbox follows links, its
    // patches included).
    // (A site folder that is a link out of the mods folder isn't made read-only, runs.js runLimits: it
    // isn't writable either, since the sandbox checks where it leads.)
    const writableHere = (p) => writable.some((w) => p === w || p.startsWith(w.endsWith('/') ? w : `${w}/`));
    return { file: bin || adapter.binary, args, stdin: prompt, locked: lockedDirs.filter((d) => readOnly.includes(d.real) || !writableHere(d.real)).map((d) => d.rel) };
  },

  parse(line, emit, state = {}) {
    const msg = parseJsonLine(line);
    if (!msg) return;
    state.seen = state.seen || new Set();
    const friendly = state.friendly || friendlyDefault; // codex-oss.js words errors for its providers
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
          if (done && item.message && !transportNoise(item.message, emit, state)) emit({ kind: 'error', message: friendly(item.message) });
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
        if (msg.message && !transportNoise(msg.message, emit, state)) emit({ kind: 'error', message: friendly(msg.message) });
        break;
      default:
        break;
    }
  },

  explainExit({ stderr }) {
    return AUTH_RE.test(String(stderr || '')) ? NOT_LOGGED_IN : null; // (codex-oss.js has its own)
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

function friendlyDefault(message) {
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

// With an OpenAI API key saved (agentkeys.js): the run's key proxy, as a provider of its own; the key
// never reaches Codex. Without one: Codex's own login.
adapter.prepare = async function prepare({ ws, logger }) {
  return (await require('../agentkeys').prepareAgentKey('codex', { ws, logger })) || {};
};

module.exports = adapter;
adapter.permissionsToml = permissionsToml;
adapter.EXCLUDED_VARS = EXCLUDED_VARS;
adapter.tooOld = tooOld;
module.exports.NOT_LOGGED_IN = NOT_LOGGED_IN;
