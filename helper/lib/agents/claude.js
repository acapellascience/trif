'use strict';
// Claude Code adapter (tested with Claude Code 2.1.149). See docs/PROTOCOL.md "Agent adapters".

const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync } = require('./util');

// What side-panel runs may do besides editing the workspace (acceptEdits). Passed on the command line:
// Claude Code 2.1.312 ignored `Bash(...)` allow rules from the workspace's .claude/settings.json in -p runs.
// No command that runs arbitrary code (not even `node --test`): a run must not be able to reach the
// helper without its WEBMODS_RUN_TOKEN, which limits it to one site (see scope.js). `webmods check`
// replaces `node --check`.
const ALLOWED_TOOLS = ['Read(./**)', 'Glob', 'Grep', 'Bash(webmods:*)', 'Bash(cd:*)', 'Bash(ls:*)'];
// Edits are for mods: everything in the workspace outside sites/ is off limits (config.json can hold API
// keys, held.json is the user's approvals, instructions.md their standing instructions, .claude/ and bin/
// would widen what runs may do).
// (Not `Edit(./*)` for the top-level files: Claude Code 2.1.312 applied that to every file, sites/ too.)
const DENIED_TOOLS = ['WebFetch', 'WebSearch', 'Read(./config.json)', 'Edit(./config.json)', 'Edit(./held.json)',
  'Edit(./AGENTS.md)', 'Edit(./CLAUDE.md)', 'Edit(./instructions.md)', 'Edit(./.claude/**)', 'Edit(./bin/**)', 'Edit(./app/**)', 'Edit(./runs/**)'];

const NOT_LOGGED_IN = "Claude Code isn't logged in: run `claude` in a terminal and log in (type /login)";

const adapter = {
  id: 'claude',
  allowedTools: ALLOWED_TOOLS,
  deniedTools: DENIED_TOOLS,
  name: 'Claude Code',
  binary: 'claude',
  systemPrompt: true, // context goes in --append-system-prompt on every run
  readsInstructions: true, // the workspace's CLAUDE.md imports instructions.md
  missing: "Claude Code isn't installed, or the helper can't find it. Install it (https://claude.com/claude-code), " +
    'then run `webmods setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'not found' };
    return { available: true, path: file, version: version ? versionOf(file, env) : null, note: '' };
  },

  // Claude Code has no command that lists the models an account can use, so: its aliases, each the
  // newest model of its family (what `claude --model` documents), and any exact name typed in.
  async listModels() {
    const models = [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]
      .map(([id, name]) => ({ id, name: `${name} (newest)`, description: '' }));
    return { models, default: null, custom: true, error: null,
      note: "Claude Code can't say which models your account has. Each name is the newest of its family; use Other for an exact model name." };
  },

  command({ bin, prompt, sessionId, model, context }) {
    // The message goes last, after `--`: before it, one starting with "-" would be read as an option
    // (even --dangerously-skip-permissions).
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--strict-mcp-config',
      '--allowedTools', ...ALLOWED_TOOLS, '--disallowedTools', ...DENIED_TOOLS];
    if (context) args.push('--append-system-prompt', context);
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    args.push('--', prompt);
    return { file: bin || adapter.binary, args };
  },

  // One stdout line -> zero or more normalized events. `state` is per run ({workspace}).
  parse(line, emit, state = {}) {
    const msg = parseJsonLine(line);
    if (!msg) return;
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      emit({ kind: 'session', sessionId: msg.session_id });
    } else if (msg.type === 'system' && msg.subtype === 'status') {
      // `/compact` (or an automatic compaction): say so, since its result text is empty.
      if (msg.status === 'compacting') emit({ kind: 'tool', name: 'compacting the conversation', summary: '' });
      else if (msg.compact_result === 'success') emit({ kind: 'tool', name: 'compacted the conversation', summary: '' });
      else if (msg.compact_result) emit({ kind: 'error', message: `Couldn't compact the conversation (${msg.compact_result})` });
    } else if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      // After compacting, Claude Code replays the messages it kept (old replies, already in the chat)
      // until the command's own output; don't show them twice.
      state.replaying = true;
    } else if (msg.type === 'user' && msg.message) {
      // A slash command's output (`/context`, `/cost`…) comes back as <local-command-stdout>.
      const text = typeof msg.message.content === 'string' ? msg.message.content : '';
      const out = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text);
      if (out) {
        state.replaying = false;
        const said = out[1].trim();
        if (said && !/^Compacted\b/.test(said)) emit({ kind: 'text', text: said });
      }
    } else if (state.replaying) {
      // (replayed messages: see compact_boundary)
    } else if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
      for (const c of msg.message.content) {
        if (!c || typeof c !== 'object') continue;
        // (A logged-out CLI also "says" the login message; the result line turns it into an error.)
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim() && !isLoginMessage(c.text)) emit({ kind: 'text', text: c.text });
        else if (c.type === 'tool_use') emit({ kind: 'tool', name: String(c.name || 'tool'), summary: toolSummary(c.name, c.input, state.workspace) });
      }
    } else if (msg.type === 'result') {
      const text = typeof msg.result === 'string' ? msg.result : '';
      let ok = !msg.is_error && (!msg.subtype || msg.subtype === 'success');
      const loggedOut = isLoginMessage(text);
      if (loggedOut) {
        ok = false;
        emit({ kind: 'error', message: NOT_LOGGED_IN });
      } else if (!ok) {
        emit({ kind: 'error', message: text || `Claude Code stopped (${msg.subtype || 'error'})` });
      }
      emit({
        kind: 'done',
        ok,
        result: text || null,
        costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
        sessionId: msg.session_id || null,
        // A logged-out run's session is empty: keep resuming the previous one (runs.js handles this).
        ...(loggedOut ? { discardSession: true } : {}),
      });
    }
  },

  // The process ended without a result line: a friendlier message than the raw stderr when we can.
  explainExit({ stderr }) {
    const s = String(stderr || '');
    if (/not logged in|please run \/login|invalid api key/i.test(s)) return NOT_LOGGED_IN;
    if (/no conversation found/i.test(s)) return "Claude Code couldn't resume this conversation (it may have been deleted): start a new chat.";
    return null;
  },

  // Cheap login check without spending tokens: `claude auth status --json` prints {loggedIn, authMethod}.
  loginStatusArgs: ['auth', 'status', '--json'],
  parseLoginStatus({ stdout }) {
    const j = parseJsonLine(String(stdout || '').replace(/\n/g, ' '));
    if (j && typeof j.loggedIn === 'boolean') return { loggedIn: j.loggedIn, detail: j.authMethod || '' };
    return { loggedIn: null, detail: '' };
  },
  loginStatus({ path: file, env, cwd }) {
    return adapter.parseLoginStatus(captureSync(file, adapter.loginStatusArgs, { env, cwd }));
  },
  loginFix: 'run `claude` in a terminal and log in (type /login)',

  // Logging in from the side panel. Without a TTY, `claude auth login` (2.1.149) prints
  //   Opening browser to sign in…
  //   If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&…
  //   Paste code here if prompted >
  // and waits for the code (shown by the redirect page) on stdin.
  login: {
    args: ['auth', 'login'],
    parseLine: parseLoginLine,
  },
};

// One line of `claude auth login` output -> {kind:"login", url} | {kind:"text", text} | null (skip).
function parseLoginLine(line) {
  // (The prompt has no newline, so whatever the CLI prints next can share its line.)
  const t = String(line).replace(/^\s*paste code here[^>]*>/i, '').trim();
  if (!t || /^opening browser/i.test(t)) return null;
  const m = /\bvisit:\s*(https:\/\/\S+)/i.exec(t);
  if (m) return { kind: 'login', url: m[1] };
  return { kind: 'text', text: t };
}

function isLoginMessage(text) {
  return /not logged in|please run \/login/i.test(String(text));
}

function toolSummary(name, input, workspace) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Bash': return oneLine(i.command);
    case 'Edit': case 'MultiEdit': case 'Write': case 'Read': case 'NotebookEdit':
      return oneLine(relToWorkspace(i.file_path || i.notebook_path, workspace));
    case 'Glob': case 'Grep': return oneLine(i.pattern);
    case 'WebFetch': return oneLine(i.url);
    case 'WebSearch': return oneLine(i.query);
    case 'TodoWrite': return '';
    default: return oneLine(i.description || i.command || i.file_path || i.path || '');
  }
}

module.exports = adapter;
module.exports.toolSummary = toolSummary;
module.exports.NOT_LOGGED_IN = NOT_LOGGED_IN;
module.exports.parseLoginLine = parseLoginLine;
