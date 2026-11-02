'use strict';
// Claude Code adapter (tested with Claude Code 2.1.149). See docs/PROTOCOL.md "Agent adapters".

const path = require('path');
const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync } = require('./util');

// What a side-panel run may do (runs.js runLimits gives the paths). Two layers:
//   - Claude Code's own tools, by permission rules passed on the command line (Claude Code 2.1.312
//     ignored `Bash(...)` allow rules from the workspace's .claude/settings.json in -p runs). Edits are
//     allowed under sites/ only (no --permission-mode acceptEdits, which allowed the whole workspace: its
//     state files steer TRIF), minus every existing folder of another site; reads, the whole
//     workspace but its secrets and other runs' traces. In -p, anything else that would need approval is
//     denied.
//   - Shell commands, only `trif`, `cd` and `ls`, run in Claude Code's sandbox (macOS Seatbelt), which
//     the system enforces whatever the command line says: no network and no sockets (so `trif`
//     reaches the helper only through the run's mailbox, which limits it to the run's site), the same
//     reads as Codex runs (nothing else in the home folder), and no writes to TRIF's state files or
//     other sites' folders. failIfUnavailable: no sandbox, no commands.
// No command that runs arbitrary code (not even `node --test`); `trif check` replaces `node --check`.
const ALLOWED_TOOLS = ['Read(./**)', 'Glob', 'Grep', 'Edit(./sites/**)', 'Bash(trif:*)', 'Bash(webmods:*)', 'Bash(cd:*)', 'Bash(ls:*)'];
// (Not Read(./runs/**): Claude Code also applies Read denies to the sandbox, where nothing can reopen
// them, so the run's own mailbox under runs/ would be lost. The sandbox keeps runs/ but the mailbox
// unreadable to commands; these cover Claude Code's own file tools.)
const DENIED_TOOLS = ['WebFetch', 'WebSearch', 'Read(./config.json)', 'Read(./safari-token)', 'Read(./helper.log*)', 'Read(./runs/*.jsonl)',
  'Read(./screenshots/*.png)'];
// The workspace's files that steer TRIF (or the agents): never written by a run's commands. (.shipped
// holds the versions of shipped mods a merge run reads: readable, never written.)
const STATE_FILES = ['held.json', 'preinstalled.json', 'origins.json', 'active-runs', 'trash', 'config.json', 'instructions.md',
  'AGENTS.md', 'CLAUDE.md', 'bin', 'app', 'safari-token', 'helper.log', 'helper.log.1', 'runs', '.shipped'];
const MIN_VERSION = [2, 1, 285]; // the sandbox settings used here, and --settings taking precedence over the workspace's

function tooOld(version) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  if (!m) return false; // unknown: let it try
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_VERSION[i]) return v[i] < MIN_VERSION[i];
  return false;
}

/**
 * The run's own rules (--settings): the sandbox for its shell commands, and per-run permission rules
 * (other sites' folders and screenshots). `limits` is runs.js runLimits.
 */
function runSettings({ workspace = '', readOnly = [], denied = [], home, readable = [], privateFiles = [], box, screenshots, otherScreenshots = [] } = {}) {
  const rel = (p) => `./${path.relative(workspace, p).split(path.sep).join('/')}`;
  const inWorkspace = (p) => !!workspace && p.startsWith(workspace + path.sep);
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false, // no retrying a command outside it
      autoAllowBashIfSandboxed: false, // only the commands allowed above, sandbox or not
      filesystem: {
        // The whole home folder, then what the run may read inside it (the narrower path wins), rather
        // than each item in it: Claude Code looks inside every folder on these lists, and listing
        // Desktop, Documents and the like made macOS ask the user to allow that.
        denyRead: home ? [home, ...privateFiles] : denied,
        allowRead: [...(home ? readable : []), box, screenshots].filter(Boolean),
        allowWrite: [box, screenshots].filter(Boolean), // (writing there needs saying too)
        denyWrite: [...(workspace ? STATE_FILES.map((f) => path.join(workspace, f)) : []), ...readOnly],
      },
      network: { allowedDomains: [], strictAllowlist: true }, // and no unix sockets (none allowed)
    },
    permissions: {
      deny: [...readOnly.filter(inWorkspace).map((p) => `Edit(${rel(p)}/**)`),
        ...otherScreenshots.filter(inWorkspace).map((p) => `Read(${rel(p)}/**)`)],
    },
  };
}

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
    'then run `trif setup` in the same terminal so the helper finds it.',

  detect({ dirs, env, version = true }) {
    const file = findExecutable(adapter.binary, dirs);
    if (!file) return { available: false, path: null, version: null, note: 'not found' };
    const v = version ? versionOf(file, env) : null;
    if (tooOld(v)) return { available: false, path: file, version: v, note: `Claude Code ${v} is too old for TRIF (it needs ${MIN_VERSION.join('.')} or newer to keep side-panel runs to their site): update it (claude update)` };
    return { available: true, path: file, version: v, note: '' };
  },

  // Claude Code has no command that lists the models an account can use, so: its aliases, each the
  // newest model of its family (what `claude --model` documents), and any exact name typed in.
  async listModels() {
    const models = [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]
      .map(([id, name]) => ({ id, name: `${name} (newest)`, description: '' }));
    return { models, default: null, custom: true, error: null,
      note: "Claude Code can't say which models your account has. Each name is the newest of its family; use Other for an exact model name." };
  },

  command({ bin, prompt, sessionId, model, context, ...limits }) {
    // The message goes last, after `--`: before it, one starting with "-" would be read as an option
    // (even --dangerously-skip-permissions).
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'default', '--setting-sources', 'project', '--strict-mcp-config',
      '--settings', JSON.stringify(runSettings(limits)),
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
module.exports.runSettings = runSettings;
module.exports.tooOld = tooOld;
