'use strict';
// Claude Code adapter (tested with Claude Code 2.1.149). See docs/PROTOCOL.md "Agent adapters".

const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync } = require('./util');

const NOT_LOGGED_IN = "Claude Code isn't logged in: run `claude` in a terminal and log in (type /login)";

const adapter = {
  id: 'claude',
  name: 'Claude Code',
  binary: 'claude',
  systemPrompt: true, // context goes in --append-system-prompt on every run
  missing: "Claude Code isn't installed, or the helper can't find it. Install it (https://claude.com/claude-code), " +
    'then run `webmods setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'not found' };
    return { available: true, path: file, version: version ? versionOf(file, env) : null, note: '' };
  },

  command({ bin, prompt, sessionId, model, context }) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--strict-mcp-config'];
    if (context) args.push('--append-system-prompt', context);
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    return { file: bin || adapter.binary, args };
  },

  // One stdout line -> zero or more normalized events. `state` is per run ({workspace}).
  parse(line, emit, state = {}) {
    const msg = parseJsonLine(line);
    if (!msg) return;
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      emit({ kind: 'session', sessionId: msg.session_id });
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
