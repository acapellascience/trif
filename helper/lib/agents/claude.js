'use strict';
// Claude Code adapter (tested with Claude Code 2.1.149). See docs/PROTOCOL.md "Agent adapters".

const { spawnSync } = require('child_process');
const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine } = require('./util');

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
      '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config'];
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

  // Cheap login check without spending tokens: `claude auth status` prints JSON {loggedIn, authMethod}.
  loginStatus({ path: file, env, cwd }) {
    try {
      const r = spawnSync(file, ['auth', 'status', '--json'], { env, cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      const j = parseJsonLine(String(r.stdout || '').replace(/\n/g, ' '));
      if (j && typeof j.loggedIn === 'boolean') return { loggedIn: j.loggedIn, detail: j.authMethod || '' };
    } catch { /* fall through */ }
    return { loggedIn: null, detail: '' };
  },
  loginFix: 'run `claude` in a terminal and log in (type /login)',
};

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
