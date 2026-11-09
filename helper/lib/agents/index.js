'use strict';
// Agent registry: finding the user's coding agents, the environment they run in, and the context
// text the side panel gives them. See docs/PROTOCOL.md "Side panel and agent runs".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { envVar, envName } = require('../env');
const { capture } = require('./util');

const ADAPTERS = [require('./claude'), require('./codex'), require('./codex-oss')];
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
// CLAUDE*/ANTHROPIC_*/CODEX_* leak in from wherever Chrome was started. Never an API key: one the user
// saved (agentkeys.js; config.json env before 0.2.0) reaches the provider through the run's key proxy.
const PASSED_KEYS = []; // (before 0.2.0: ANTHROPIC_API_KEY, OPENAI_API_KEY from config.json env)
function agentEnv(ws) {
  const env = {
    PATH: uniq([ws.bin, ...recordedPath(ws), ...defaultDirs()]).join(path.delimiter),
    HOME: os.homedir(),
    TERM: 'dumb',
    [envName('HOME')]: ws.home, // so `trif` inside the agent talks to this workspace
  };
  for (const k of ['USER', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  if (!env.USER) { try { env.USER = os.userInfo().username; } catch { /* ignore */ } }
  return env;
}

function detect(adapter, ws, opts = {}) {
  const d = adapter.detect({ dirs: searchDirs(ws), env: agentEnv(ws), version: opts.version !== false });
  return {
    id: adapter.id, name: adapter.name, path: d.path, available: !!d.available, version: d.version || null, note: d.note || adapter.note || '',
    canLogin: !!adapter.login, loginFix: adapter.loginFix || '',
    ...(adapter.experimental ? { experimental: true } : {}),
  };
}

/** {agents: [{id, name, path, available, version, note, canLogin, loginFix}], default} (no login check) */
function listAgents(ws, opts = {}) {
  const agents = ADAPTERS.map((a) => detect(a, ws, opts));
  const first = agents.find((a) => a.available && !a.experimental);
  return { agents, default: first ? first.id : ADAPTERS[0].id };
}

// Login status, cached per agent binary: the panel asks for agent.list often and the check spawns the
// agent. A login forgets the cache.
const LOGIN_CACHE_MS = 30000;
const loginCache = new Map(); // `${id}:${path}` -> {at, value} | {promise}

// Agents whose last run failed for want of a login (runs.js; util.js isLoginFailure). Their own check
// can still say logged in: Claude Code's `auth status` does with an expired login it can't refresh. So
// the run's failure wins, until a login from TRIF works or a later run of that agent does (or the helper
// restarts). In memory only.
const loginFailed = new Set();
function noteLoginFailed(id) {
  if (!id) return;
  loginFailed.add(id);
  forgetLoginStatus(id);
}
function noteLoginWorked(id) {
  if (id && loginFailed.delete(id)) forgetLoginStatus(id);
}

/**
 * Resolves {loggedIn: true|false|null, detail}. Never rejects. `fresh` skips the cache. A saved API key
 * (agentkeys.js) counts: runs use it whatever the agent's own login says.
 */
function loginStatus(adapter, ws, file, { fresh = false } = {}) {
  if (!adapter.loginStatusArgs || !file) return Promise.resolve({ loggedIn: null, detail: '' });
  // (`fresh`, after a login: what the agent says now.) `expired`: logged out by a run's failure.
  if (!fresh && loginFailed.has(adapter.id)) return Promise.resolve({ loggedIn: false, detail: 'its last run needed a login', expired: true });
  const key = `${adapter.id}:${file}`;
  const hit = loginCache.get(key);
  if (!fresh && hit && (hit.promise || Date.now() - hit.at < LOGIN_CACHE_MS)) return hit.promise || Promise.resolve(hit.value);
  const cwd = fs.existsSync(ws.home) ? ws.home : undefined;
  const keys = require('../agentkeys');
  const entry = {};
  entry.promise = (async () => {
    let value = null;
    if (keys.AGENT_KEYS[adapter.id]) {
      try {
        const h = await keys.hasAgentKey(adapter.id, { config: ws.config });
        if (h.stored) value = { loggedIn: true, detail: h.source === 'keyring' ? 'API key in the keyring' : 'API key in config.json' };
      } catch { /* the agent's own login, below */ }
    }
    if (!value) {
      const r = await capture(file, adapter.loginStatusArgs, { env: agentEnv(ws), cwd });
      try { value = adapter.parseLoginStatus(r); } catch { value = { loggedIn: null, detail: '' }; }
    }
    if (loginCache.get(key) === entry) loginCache.set(key, { at: Date.now(), value });
    return value;
  })();
  loginCache.set(key, entry);
  return entry.promise;
}

function forgetLoginStatus(id) {
  for (const k of [...loginCache.keys()]) if (!id || k.startsWith(`${id}:`)) loginCache.delete(k);
}

/**
 * agent.list result: listAgents plus `loggedIn` (true / false / null when unknown or not available), and
 * `loginExpired: true` when it's false because a run failed for want of a login (see noteLoginFailed).
 */
async function listAgentsWithLogin(ws, opts = {}) {
  const r = listAgents(ws, opts);
  await Promise.all(r.agents.map(async (a) => {
    const st = a.available ? await loginStatus(getAdapter(a.id), ws, a.path) : null;
    a.loggedIn = st ? st.loggedIn : null;
    if (st && st.expired) a.loginExpired = true;
  }));
  return r;
}

// The models an agent offers ({models: [{id, name, description}], default, custom, error, note}),
// cached per binary for a minute (Codex fetches its catalog over the network, and keeps its own cache).
// Short, because what an account offers changes (a new plan brings new models), and the panel asks
// again each time Settings opens or the agent changes.
const MODELS_CACHE_MS = 60 * 1000;
const modelsCache = new Map(); // `${id}:${path}` -> {at, value}

async function agentModels(ws, id, { fresh = false, openModel = null } = {}) {
  const adapter = getAdapter(id);
  if (!adapter) throw new Error(`unknown agent "${id}"`);
  const d = detect(adapter, ws, { version: false });
  if (!d.available) return { agent: id, models: [], default: null, custom: true, error: `${adapter.name} isn't available`, note: '' };
  // (codex-oss: what's offered depends on the provider chosen, and changes as models are pulled.)
  const key = `${id}:${d.path}${adapter.modelsCacheKey ? `:${adapter.modelsCacheKey({ config: ws.config, openModel })}` : ''}`;
  const hit = modelsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < (adapter.modelsCacheMs ?? MODELS_CACHE_MS)) return hit.value;
  let r;
  try { r = await adapter.listModels({ path: d.path, env: agentEnv(ws), cwd: ws.home, config: ws.config, openModel }); } catch (e) { r = { models: [], default: null, custom: true, error: e.message }; }
  const value = { agent: id, note: '', ...r };
  if (!value.error) modelsCache.set(key, { at: Date.now(), value });
  return value;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The page's address as the prompt says it: its origin and path only, quoted and capped. The rest (the
// query and fragment, ?q=… and #…) is the page's to fill: a link someone sends could put words meant for
// the agent there, and the prompt is the most trusted thing the agent reads. (The agent can still see the
// full address with trif tabs, as page content.)
function promptUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let path = u.pathname;
  try { path = decodeURI(path); } catch { /* keep it encoded */ }
  path = path.replace(/[^\w\-./~%@+:,;=!*'()$&\u00a0-\uffff]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '');
  if (path.length > 120) path = `${path.slice(0, 120)}…`;
  return JSON.stringify(`${u.origin}${path}`);
}

// Full context: appended system prompt (claude, every run) or prepended to a session's first message.
function contextText({ url, tabId, scope, browser }) {
  const shown = url ? promptUrl(url) : null;
  const where = shown
    ? `They're looking at ${shown}${tabId != null ? ` (tab ${Number(tabId)}): pass \`--tab ${Number(tabId)}\` to trif commands` : ''}.`
    : "They didn't say which page they're on: run `trif tabs` if you need it.";
  const limit = scope
    ? ` This run is limited to ${scope}: trif commands only work on its tabs, and a mod you write that matches other sites is held until the user approves it (see "Side-panel runs" in AGENTS.md). You can only change files in ${scope}'s folders under sites/ (start a mod with \`trif new ${scope} <name>\`); writes anywhere else are refused, so if one is, check the folder rather than giving up.`
    : '';
  // The browser whose panel started the run (its hello names it); "browser" when unknown, e.g. from a terminal.
  return `You're running inside the TRIF side panel in the user's ${browser || 'browser'}. ` + where + limit +
    ' Follow AGENTS.md. Mods can be switched off and on with `trif disable/enable <site>/<mod>`; `trif status` shows which are on.' +
    ' Reply briefly in plain language; your replies appear in a narrow chat panel.' +
    " You can't ask follow-up questions mid-task: if something's unclear, make a sensible choice or end your turn with a question.";
}

// One-line reminder for later messages of a session (agents without a system prompt flag).
function reminderText({ url, tabId }) {
  const shown = url ? promptUrl(url) : null;
  if (!shown) return '(TRIF side panel.)';
  return `(TRIF side panel: the user is now on ${shown}${tabId != null ? `, tab ${Number(tabId)}: use --tab ${Number(tabId)}` : ''}.)`;
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
  listAgentsWithLogin, loginStatus, forgetLoginStatus, noteLoginFailed, noteLoginWorked, LOGIN_CACHE_MS, agentModels, MODELS_CACHE_MS, contextText, reminderText, hostOf, CLAUDE_SETTINGS, PASSED_KEYS,
};
