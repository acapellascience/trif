'use strict';
// Agent registry: finding the user's coding agents, the environment they run in, and the context
// text the side panel gives them. See docs/PROTOCOL.md "Side panel and agent runs".

const os = require('os');
const path = require('path');

const ADAPTERS = [require('./claude'), require('./codex')];
const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

function getAdapter(id) { return BY_ID.get(id) || null; }

// Chrome starts the helper with a minimal PATH, so agents are looked up in the PATH `webmods setup`
// recorded (config.json -> env.PATH) plus these. WEBMODS_DEFAULT_AGENT_DIRS overrides them (tests).
function defaultDirs() {
  if (process.env.WEBMODS_DEFAULT_AGENT_DIRS !== undefined) {
    return process.env.WEBMODS_DEFAULT_AGENT_DIRS.split(path.delimiter).filter(Boolean);
  }
  const home = os.homedir();
  return [path.join(home, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.npm-global', 'bin')];
}

function recordedPath(ws) {
  const env = ws.config && ws.config.env && typeof ws.config.env === 'object' ? ws.config.env : {};
  return typeof env.PATH === 'string' ? env.PATH.split(path.delimiter).filter(Boolean) : [];
}

function uniq(list) { return [...new Set(list.filter((d) => d && path.isAbsolute(d)))]; }

// Where agents are searched for (without ~/.webmods/bin: that only holds webmods itself).
function searchDirs(ws) { return uniq([...recordedPath(ws), ...defaultDirs()]); }

// The environment spawned agents get: nothing inherited from the helper except the basics, so no
// CLAUDE*/ANTHROPIC_*/CODEX_* leak in from wherever Chrome was started. API keys only when the user
// put them in config.json -> env.
const PASSED_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
function agentEnv(ws) {
  const env = {
    PATH: uniq([ws.bin, ...recordedPath(ws), ...defaultDirs()]).join(path.delimiter),
    HOME: os.homedir(),
    TERM: 'dumb',
    WEBMODS_HOME: ws.home, // so `webmods` inside the agent talks to this workspace
  };
  for (const k of ['USER', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  if (!env.USER) { try { env.USER = os.userInfo().username; } catch { /* ignore */ } }
  const cfg = ws.config && ws.config.env && typeof ws.config.env === 'object' ? ws.config.env : {};
  for (const k of PASSED_KEYS) if (typeof cfg[k] === 'string' && cfg[k]) env[k] = cfg[k];
  return env;
}

function detect(adapter, ws, opts = {}) {
  const d = adapter.detect({ dirs: searchDirs(ws), env: agentEnv(ws), version: opts.version !== false });
  return { id: adapter.id, name: adapter.name, path: d.path, available: !!d.available, version: d.version || null, note: d.note || adapter.note || '' };
}

/** agent.list result: {agents: [{id, name, path, available, version, note}], default} */
function listAgents(ws, opts = {}) {
  const agents = ADAPTERS.map((a) => detect(a, ws, opts));
  const first = agents.find((a) => a.available);
  return { agents, default: first ? first.id : ADAPTERS[0].id };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Full context: appended system prompt (claude, every run) or prepended to a session's first message.
function contextText({ url, tabId }) {
  const where = url
    ? `They're looking at ${url}${tabId != null ? ` (tab ${tabId}): pass \`--tab ${tabId}\` to webmods commands` : ''}.`
    : "They didn't say which page they're on: run `webmods tabs` if you need it.";
  return "You're running inside the WebMods side panel in the user's Chrome. " + where +
    ' Follow AGENTS.md. Reply briefly in plain language; your replies appear in a narrow chat panel.' +
    " You can't ask follow-up questions mid-task: if something's unclear, make a sensible choice or end your turn with a question.";
}

// One-line reminder for later messages of a session (agents without a system prompt flag).
function reminderText({ url, tabId }) {
  if (!url) return '(WebMods side panel.)';
  return `(WebMods side panel: the user is now on ${url}${tabId != null ? `, tab ${tabId}: use --tab ${tabId}` : ''}.)`;
}

// Claude Code permissions for the workspace (written by `webmods setup`).
const CLAUDE_SETTINGS = {
  permissions: {
    allow: ['Read(./**)', 'Edit(./**)', 'Write(./**)', 'Glob', 'Grep', 'Bash(webmods *)',
      'Bash(node --test *)', 'Bash(node --check *)', 'Bash(ls *)'],
    deny: ['WebFetch', 'WebSearch'],
  },
};

module.exports = {
  ADAPTERS, getAdapter, defaultDirs, recordedPath, searchDirs, agentEnv, detect, listAgents,
  contextText, reminderText, hostOf, CLAUDE_SETTINGS, PASSED_KEYS,
};
