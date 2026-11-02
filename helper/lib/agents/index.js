'use strict';
// Agent registry: finding the user's coding agents, the environment they run in, and the context
// text the side panel gives them. See docs/PROTOCOL.md "Side panel and agent runs".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar, envName } = require('../env');
const { capture } = require('./util');

const ADAPTERS = [require('./claude'), require('./codex')];
const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

function getAdapter(id) { return BY_ID.get(id) || null; }

// Chrome starts the helper with a minimal PATH, so agents are looked up in the PATH `trif setup`
// recorded (config.json -> env.PATH) plus these. TRIF_DEFAULT_AGENT_DIRS overrides them (tests).
function defaultDirs() {
  if (envVar('DEFAULT_AGENT_DIRS') !== undefined) {
    return envVar('DEFAULT_AGENT_DIRS').split(path.delimiter).filter(Boolean);
  }
  const home = os.homedir();
  return [path.join(home, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.npm-global', 'bin')];
}

function recordedPath(ws) {
  const env = ws.config && ws.config.env && typeof ws.config.env === 'object' ? ws.config.env : {};
  return typeof env.PATH === 'string' ? env.PATH.split(path.delimiter).filter(Boolean) : [];
}

function uniq(list) { return [...new Set(list.filter((d) => d && path.isAbsolute(d)))]; }

// Where agents are searched for (without ~/.trif/bin: that only holds trif itself).
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
    [envName('HOME')]: ws.home, // so `trif` inside the agent talks to this workspace
  };
  for (const k of ['USER', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  if (!env.USER) { try { env.USER = os.userInfo().username; } catch { /* ignore */ } }
  const cfg = ws.config && ws.config.env && typeof ws.config.env === 'object' ? ws.config.env : {};
  for (const k of PASSED_KEYS) if (typeof cfg[k] === 'string' && cfg[k]) env[k] = cfg[k];
  return env;
}

function detect(adapter, ws, opts = {}) {
  const d = adapter.detect({ dirs: searchDirs(ws), env: agentEnv(ws), version: opts.version !== false });
  return {
    id: adapter.id, name: adapter.name, path: d.path, available: !!d.available, version: d.version || null, note: d.note || adapter.note || '',
    canLogin: !!adapter.login, loginFix: adapter.loginFix || '',
  };
}

/** {agents: [{id, name, path, available, version, note, canLogin, loginFix}], default} (no login check) */
function listAgents(ws, opts = {}) {
  const agents = ADAPTERS.map((a) => detect(a, ws, opts));
  const first = agents.find((a) => a.available);
  return { agents, default: first ? first.id : ADAPTERS[0].id };
}

// Login status, cached per agent binary: the panel asks for agent.list often and the check spawns the
// agent. A login (or a run failing with "not logged in") forgets the cache.
const LOGIN_CACHE_MS = 30000;
const loginCache = new Map(); // `${id}:${path}` -> {at, value} | {promise}

/** Resolves {loggedIn: true|false|null, detail}. Never rejects. `fresh` skips the cache. */
function loginStatus(adapter, ws, file, { fresh = false } = {}) {
  if (!adapter.loginStatusArgs || !file) return Promise.resolve({ loggedIn: null, detail: '' });
  const key = `${adapter.id}:${file}`;
  const hit = loginCache.get(key);
  if (!fresh && hit && (hit.promise || Date.now() - hit.at < LOGIN_CACHE_MS)) return hit.promise || Promise.resolve(hit.value);
  const cwd = fs.existsSync(ws.home) ? ws.home : undefined;
  const entry = {};
  entry.promise = capture(file, adapter.loginStatusArgs, { env: agentEnv(ws), cwd }).then((r) => {
    let value;
    try { value = adapter.parseLoginStatus(r); } catch { value = { loggedIn: null, detail: '' }; }
    if (loginCache.get(key) === entry) loginCache.set(key, { at: Date.now(), value });
    return value;
  });
  loginCache.set(key, entry);
  return entry.promise;
}

function forgetLoginStatus(id) {
  for (const k of [...loginCache.keys()]) if (!id || k.startsWith(`${id}:`)) loginCache.delete(k);
}

/** agent.list result: listAgents plus `loggedIn` (true / false / null when unknown or not available). */
async function listAgentsWithLogin(ws, opts = {}) {
  const r = listAgents(ws, opts);
  await Promise.all(r.agents.map(async (a) => {
    a.loggedIn = a.available ? (await loginStatus(getAdapter(a.id), ws, a.path)).loggedIn : null;
  }));
  return r;
}

// The models an agent offers ({models: [{id, name, description}], default, custom, error, note}),
// cached per binary for half an hour: Codex fetches its catalog over the network.
const MODELS_CACHE_MS = 30 * 60 * 1000;
const modelsCache = new Map(); // `${id}:${path}` -> {at, value}

async function agentModels(ws, id, { fresh = false } = {}) {
  const adapter = getAdapter(id);
  if (!adapter) throw new Error(`unknown agent "${id}"`);
  const d = detect(adapter, ws, { version: false });
  if (!d.available) return { agent: id, models: [], default: null, custom: true, error: `${adapter.name} isn't available`, note: '' };
  const key = `${id}:${d.path}`;
  const hit = modelsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < MODELS_CACHE_MS) return hit.value;
  let r;
  try { r = await adapter.listModels({ path: d.path, env: agentEnv(ws), cwd: ws.home }); } catch (e) { r = { models: [], default: null, custom: true, error: e.message }; }
  const value = { agent: id, note: '', ...r };
  if (!value.error) modelsCache.set(key, { at: Date.now(), value });
  return value;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Full context: appended system prompt (claude, every run) or prepended to a session's first message.
function contextText({ url, tabId, scope, browser }) {
  const where = url
    ? `They're looking at ${url}${tabId != null ? ` (tab ${tabId}): pass \`--tab ${tabId}\` to trif commands` : ''}.`
    : "They didn't say which page they're on: run `trif tabs` if you need it.";
  const limit = scope
    ? ` This run is limited to ${scope}: trif commands only work on its tabs, and a mod you write that matches other sites is held until the user approves it (see "Side-panel runs" in AGENTS.md).`
    : '';
  // The browser whose panel started the run (its hello names it); "browser" when unknown, e.g. from a terminal.
  return `You're running inside the TRIF side panel in the user's ${browser || 'browser'}. ` + where + limit +
    ' Follow AGENTS.md. Mods can be switched off and on with `trif disable/enable <site>/<mod>`; `trif status` shows which are on.' +
    ' Reply briefly in plain language; your replies appear in a narrow chat panel.' +
    " You can't ask follow-up questions mid-task: if something's unclear, make a sensible choice or end your turn with a question.";
}

// One-line reminder for later messages of a session (agents without a system prompt flag).
function reminderText({ url, tabId }) {
  if (!url) return '(TRIF side panel.)';
  return `(TRIF side panel: the user is now on ${url}${tabId != null ? `, tab ${tabId}: use --tab ${tabId}` : ''}.)`;
}

// Claude Code permissions for the workspace (written by `trif setup`).
const CLAUDE_SETTINGS = {
  permissions: {
    // (The claude adapter also passes these as --allowedTools/--disallowedTools, which is what actually
    // takes effect in -p runs, plus its per-run sandbox; this file keeps interactive `claude` sessions in
    // the workspace consistent.)
    allow: getAdapter('claude').allowedTools,
    deny: getAdapter('claude').deniedTools,
  },
};

module.exports = {
  ADAPTERS, getAdapter, defaultDirs, recordedPath, searchDirs, agentEnv, detect, listAgents,
  listAgentsWithLogin, loginStatus, forgetLoginStatus, LOGIN_CACHE_MS, agentModels, contextText, reminderText, hostOf, CLAUDE_SETTINGS, PASSED_KEYS,
};
