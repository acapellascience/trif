'use strict';
// Claude Code adapter (tested with Claude Code 2.1.149). See docs/PROTOCOL.md "Agent adapters".

const fs = require('fs');
const path = require('path');
const { findExecutable, versionOf, relToWorkspace, oneLine, parseJsonLine, captureSync, isLoginFailure, loginError } = require('./util');
const { within, ignoresCase } = require('../pathcheck');

// What a side-panel run may do (runs.js runLimits gives the paths). Only the tools in TOOLS, then two layers:
//   - Claude Code's own tools, by permission rules passed on the command line (Claude Code 2.1.312
//     ignored `Bash(...)` allow rules from the workspace's .claude/settings.json in -p runs). Edits are
//     allowed under sites/ only (no --permission-mode acceptEdits, which allowed the whole workspace: its
//     state files steer TRIF), minus every existing folder of another site; reads, the whole
//     workspace (TRIF's private files are elsewhere: paths.js privateDir). In -p, anything else that
//     would need approval (reading outside the workspace) is denied. Grep and Glob have no rules of
//     their own: Claude Code applies the Read rules to them. A bare 'Grep' or 'Glob' allow rule would
//     let them search anywhere (0.2.0 had them: a run grepped the whole home folder), and they run
//     outside the sandbox below, which only wraps shell commands.
//   - Shell commands, only `trif`, `cd` and `ls`, run in Claude Code's sandbox (macOS Seatbelt), which
//     the system enforces whatever the command line says: no network and no sockets (so `trif`
//     reaches the helper only through the run's mailbox, which limits it to the run's site), the same
//     reads as Codex runs (nothing else in the home folder), and no writes to TRIF's state files or
//     other sites' folders. failIfUnavailable: no sandbox, no commands.
// No command that runs arbitrary code (not even `node --test`); `trif check` replaces `node --check`.
const ALLOWED_TOOLS = ['Read(./**)', 'Edit(./sites/**)', 'Bash(trif:*)', 'Bash(webmods:*)', 'Bash(cd:*)', 'Bash(ls:*)'];
// The only tools a run has at all (--tools; Write and Glob follow the Edit and Read rules). Not just
// denies: every Claude Code release adds tools (2.1.316 offered 22 in these runs: sub-agents, messages to
// the user's other Claude sessions, push notifications, background commands, claude.ai design sync...),
// and in -p a tool that needs no approval runs. tests/agent-tools.test.js checks the list a real run gets.
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];
// (No Read denies for TRIF's secrets and logs: since 0.2.0 they're in the private folder, outside the
// workspace, which a run's file tools can't read without approval and its sandbox denies.)
const DENIED_TOOLS = ['WebFetch', 'WebSearch'];
// The workspace's files that steer TRIF (or the agents): never written by a run's commands. (.shipped
// holds the versions of shipped mods a merge run reads: readable, never written.)
const STATE_FILES = ['held.json', 'preinstalled.json', 'origins.json', 'active-runs', 'trash', 'update.json', 'instructions.md',
  'AGENTS.md', 'TECHNIQUES.md', 'CLAUDE.md', '.claude', 'bin', 'app', '.shipped'];
/** Rules like Read(./config.json) made absolute to the workspace (see runSettings `rel`). */
function absoluteRules(rules, workspace) {
  if (!workspace) return rules;
  return rules.map((r) => r.replace(/^(\w+)\(\.\/(.*)\)$/, (_, tool, p) => `${tool}(/${path.join(workspace, p)})`));
}

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
function runSettings({ workspace = '', readOnly = [], lockedDirs = [], denied = [], home, readable = [], privateDir, box, screenshots, skills = [], skillSecrets = [], skillLinks = [], workspaceLinks = [], systemTemp = [] } = {}) {
  // Absolute ("//" + path): a "./" rule follows the agent's current folder, so after `cd sites/x.com` it
  // would point somewhere else.
  const rel = (p) => `/${p}`;
  const inWorkspace = (p) => !!workspace && within(p, workspace, { ci: ignoresCase(workspace) });
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false, // no retrying a command outside it
      autoAllowBashIfSandboxed: false, // only the commands allowed above, sandbox or not
      filesystem: {
        // The whole home folder, then what the run may read inside it (the narrower path wins), rather
        // than each item in it: Claude Code looks inside every folder on these lists, and listing
        // Desktop, Documents and the like made macOS ask the user to allow that. The private folder by
        // name too (it can be outside the home folder), with the run's own screenshots folder inside it
        // allowed below.
        // And the system's temporary folders (runs.js runLimits systemTemp: /tmp, $TMPDIR), which hold
        // other programs' files and every Claude Code session's scratch files: Claude Code's sandbox let
        // a run's commands write into /tmp/claude-<uid> even with its own temporary folder moved (2.1.316).
        denyRead: home ? [...new Set([home, ...(privateDir ? [privateDir] : []), ...skillSecrets.map((x) => x.path), ...systemTemp])] : denied,
        allowRead: [...(home ? readable : []), box, screenshots].filter(Boolean),
        allowWrite: [box, screenshots].filter(Boolean), // (writing there needs saying too)
        denyWrite: [...(workspace ? STATE_FILES.map((f) => path.join(workspace, f)) : []), ...readOnly, ...systemTemp],
      },
      network: { allowedDomains: [], strictAllowlist: true }, // and no unix sockets (none allowed)
    },
    permissions: {
      // The user's skill folders (runs.js skillDirs), read only. ("//" starts an absolute path in a rule.)
      // Claude Code doesn't load user skills in these runs (--setting-sources project), so this only
      // matters when the agent is pointed at one.
      allow: [...skills.map((p) => `Read(/${p}/**)`), ...(screenshots ? [`Read(/${screenshots}/**)`] : [])],
      // The run's own screenshots folder (in the private folder, outside the workspace).
      // Denied: other sites' folders, by their path in the workspace and by their real path (a site folder
      // that is a link matches the Edit(//<workspace>/sites/**) allow by the first, whatever the second
      // is; a path in another case, /Users/x/.TRIF/sites/X.com, is refused too, checked with Claude Code
      // 2.1.316); inside the skill folders, what looks like a secret (runs.js skillSecrets) and links that
      // lead where the run may not read (Claude Code's Read tool isn't sandboxed and matches rules against
      // the path it's given).
      deny: [...new Set([...readOnly.filter(inWorkspace), ...lockedDirs.flatMap((d) => [d.literal, d.real])])].map((p) => `Edit(${rel(p)}/**)`).concat(
        ...skillSecrets.flatMap((x) => (x.dir ? [`Read(/${x.path})`, `Read(/${x.path}/**)`] : [`Read(/${x.path})`])),
        ...skillLinks.flatMap((p) => [`Read(/${p})`, `Read(/${p}/**)`]),
        // Links in the mods folder and the trash (left by an earlier run's commands: Codex can make them)
        // that lead out of the mods folder, or where the run may not read (runs.js workspaceLinks): the
        // Edit and Read allows above cover them by the path they're given.
        ...workspaceLinks.flatMap((l) => [...(l.edit ? [] : [`Edit(/${l.path})`, `Edit(/${l.path}/**)`]), ...(l.read ? [] : [`Read(/${l.path})`, `Read(/${l.path}/**)`])])),
    },
  };
}

// A run that failed for want of a login (util.js isLoginFailure): "Claude Code needs you to log in again."
// With a saved API key (state.apiKey) the run never used the login, so logging in wouldn't help: the
// agent's own words stay.
const loginFailed = (text, state) => !state.apiKey && isLoginFailure(text);

// With an Anthropic API key saved (agentkeys.js): the run's key proxy as ANTHROPIC_BASE_URL and a
// placeholder key; the real key never reaches Claude Code. Without one: Claude Code's own login.
async function prepare({ ws, logger }) {
  workspaceSettings(ws, logger);
  return (await require('../agentkeys').prepareAgentKey('claude', { ws, logger })) || {};
}

/**
 * The workspace's .claude/settings.json (which runs load: --setting-sources project) as `trif setup` writes
 * it now, rewritten when it isn't: a workspace set up by an older version (or a checkout's helper, which
 * no update re-sets up) could still allow more. 0.2.0's had bare Glob and Grep, which search anywhere.
 */
function workspaceSettings(ws, logger) {
  if (!ws || !ws.home) return;
  const dir = path.join(ws.home, '.claude');
  const file = path.join(dir, 'settings.json');
  const want = JSON.stringify({ permissions: { allow: ALLOWED_TOOLS, deny: DENIED_TOOLS } }, null, 2) + '\n';
  try {
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (st && st.isFile() && fs.readFileSync(file, 'utf8') === want) return;
    if (st && !st.isFile()) fs.rmSync(file, { recursive: true, force: true }); // never write through a link
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, want);
    if (logger) logger.info(`rewrote ${file} (it allowed what TRIF's runs no longer do)`);
  } catch (e) {
    if (logger) logger.warn(`couldn't check ${file}: ${e.message}`);
  }
}

const adapter = {
  id: 'claude',
  tools: TOOLS,
  workspaceSettings,
  allowedTools: ALLOWED_TOOLS,
  deniedTools: DENIED_TOOLS,
  name: 'Claude Code',
  binary: 'claude',
  systemPrompt: true, // context goes in --append-system-prompt on every run
  readsInstructions: true, // the workspace's CLAUDE.md imports instructions.md
  prepare,
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

  /**
   * The command for a run. Nothing private on the command line, which any same-user process can read
   * (`ps`, sysctl KERN_PROCARGS2; an agent's sandboxed commands included): the user's message goes on
   * stdin (`claude -p` reads it there when there's no prompt argument), and the run settings and the
   * context (system prompt: the page the user is on) go in files in `agentDir`, the run's own folder that
   * only the helper and Claude Code itself read (runs.js writes `files`, 0600, and removes them after).
   */
  command({ bin, prompt, sessionId, model, context, agentDir = '', ...limits }) {
    const file = (name) => path.join(agentDir || '.', name);
    const files = [{ path: file('settings.json'), content: JSON.stringify(runSettings(limits)) }];
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'default', '--setting-sources', 'project', '--strict-mcp-config',
      '--settings', file('settings.json'),
      '--tools', TOOLS.join(','), '--disable-slash-commands',
      '--allowedTools', ...absoluteRules(ALLOWED_TOOLS, limits.workspace),
      '--disallowedTools', ...absoluteRules(DENIED_TOOLS, limits.workspace)];
    if (context) {
      files.push({ path: file('context.md'), content: context });
      args.push('--append-system-prompt-file', file('context.md'));
    }
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    // Every other site's folder got its Edit deny rules (runSettings) and its sandbox denyWrite.
    // Claude Code's own temporary folder (its commands' sandbox may always write there): the run's own
    // (runs.js runLimits agentTmp), not /tmp/claude-<uid>, which every Claude Code session on the computer
    // shares (their scratch files and task output: a run's commands could write into them, 2.1.316).
    const env = limits.agentTmp ? { CLAUDE_CODE_TMPDIR: limits.agentTmp, TMPDIR: limits.agentTmp } : {};
    return { file: bin || adapter.binary, args, stdin: prompt, files, env, locked: (limits.lockedDirs || []).map((d) => d.rel) };
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
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          // A logged-out or expired login also "says" its error as a reply ("Failed to authenticate: OAuth
          // session expired…"), then again in the result line. Text in those words waits for the result:
          // dropped if the run failed for want of a login, shown as usual otherwise.
          if (loginFailed(c.text, state)) (state.heldText = state.heldText || []).push(c.text);
          else { flushHeld(emit, state); emit({ kind: 'text', text: c.text }); }
        } else if (c.type === 'tool_use') {
          flushHeld(emit, state);
          emit({ kind: 'tool', name: String(c.name || 'tool'), summary: toolSummary(c.name, c.input, state.workspace) });
        }
      }
    } else if (msg.type === 'result') {
      const text = typeof msg.result === 'string' ? msg.result : '';
      const ok = !msg.is_error && (!msg.subtype || msg.subtype === 'success');
      const loggedOut = !ok && loginFailed(text || (state.heldText || []).join('\n'), state);
      if (loggedOut) state.heldText = null;
      else flushHeld(emit, state);
      if (loggedOut) {
        emit(loginError(adapter.name));
      } else if (!ok) {
        emit({ kind: 'error', message: text || `Claude Code stopped (${msg.subtype || 'error'})` });
      }
      emit({
        kind: 'done',
        ok,
        result: text || null,
        costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
        sessionId: msg.session_id || null,
        // A logged-out run's session holds nothing but the message and the error: keep resuming the
        // previous one (runs.js handles this), so the message sent again after logging in isn't there twice.
        ...(loggedOut ? { discardSession: true } : {}),
      });
    }
  },

  // The process ended without a result line: a friendlier message than the raw stderr when we can.
  explainExit({ stderr, state = {} }) {
    const s = String(stderr || '');
    if (loginFailed(s, state)) return loginError(adapter.name);
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

// Text held back by parse (see the assistant case), shown after all: the run went on.
function flushHeld(emit, state) {
  const held = state.heldText;
  state.heldText = null;
  for (const text of held || []) emit({ kind: 'text', text });
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
module.exports.parseLoginLine = parseLoginLine;
module.exports.runSettings = runSettings;
module.exports.tooOld = tooOld;
