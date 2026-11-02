'use strict';
// API keys for plain Claude Code and Codex runs (most people log in instead: `claude` then /login, or
// `codex login`, which keep the agent's credentials in its own files, which run sandboxes deny).
//
// Until 0.2.1 a key in config.json `env.ANTHROPIC_API_KEY` / `env.OPENAI_API_KEY` went into the agent's
// environment, where any same-user process can read it (sysctl KERN_PROCARGS2), the agent's own sandboxed
// commands included. Now the key lives in the system keyring (keyring.js; service "TRIF API key",
// account `anthropic` or `openai`), set with `trif agent key --set-key`, and never enters the agent's
// environment or argv: before each run the helper reads it and starts a key proxy for the run
// (keyproxy.js) on 127.0.0.1, which adds it to the agent's requests:
//   Claude Code  ANTHROPIC_BASE_URL = the proxy (its root; style 'anthropic': x-api-key), and
//                ANTHROPIC_API_KEY = a placeholder, so Claude Code sends API requests (the proxy replaces
//                it); a claude.ai login is set aside for these runs, as the key always did
//   Codex        a custom provider `trif-openai` whose base_url is the proxy (`/v1`, bearer), Responses
//                API, as for open models (agents/codex-oss.js): OPENAI_BASE_URL isn't enough, Codex
//                would still want the key itself
// keys found in config.json `env` move to the keyring (migrateKeys: setup, and every helper on start) and
// leave config.json. Without a keyring at all (Linux without secret-tool) a key left in config.json is
// still used, through the proxy too: config.json is in the private folder now, unreadable to runs.
// TRIF_ANTHROPIC_URL / TRIF_OPENAI_URL (tests) point the proxies at a stand-in.

const keyring = require('./keyring');
const { envVar } = require('./env');

const SERVICE = 'TRIF API key';

const AGENT_KEYS = {
  claude: { account: 'anthropic', name: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', target: 'https://api.anthropic.com', style: 'anthropic', urlVar: 'ANTHROPIC_URL' },
  codex: { account: 'openai', name: 'OpenAI', envVar: 'OPENAI_API_KEY', target: 'https://api.openai.com/v1', style: 'bearer', urlVar: 'OPENAI_URL' },
};
// What Claude Code gets as ANTHROPIC_API_KEY: not a key (the proxy puts the real one in).
const PLACEHOLDER = 'trif-key-proxy-adds-the-key';
const CODEX_PROVIDER = 'trif-openai';

function spec(agentId) {
  const s = AGENT_KEYS[agentId];
  if (!s) throw new Error(`no API key setting for "${agentId}" (only ${Object.keys(AGENT_KEYS).join(', ')})`);
  return s;
}

function configEnv(config) {
  return config && config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {};
}

/**
 * The key a run of `agentId` uses: {value, source: 'keyring'|'config'|null, error}. The keyring first; a
 * key still in config.json only when there's no keyring to move it to, or moving it failed.
 */
async function agentKey(agentId, { config = {}, env = process.env } = {}) {
  const s = spec(agentId);
  const k = keyring.backend({ env }) ? await keyring.getKey(s.account, { service: SERVICE, env }) : { value: null, error: null };
  if (k.value) return { value: k.value, source: 'keyring', error: null };
  const c = configEnv(config)[s.envVar];
  if (typeof c === 'string' && c.trim()) return { value: c.trim(), source: 'config', error: k.error };
  return { value: null, source: null, error: k.error };
}

/** Whether `agentId` has a key (without reading it from the keyring): {stored, source, error}. */
async function hasAgentKey(agentId, { config = {}, env = process.env } = {}) {
  const s = spec(agentId);
  if (keyring.backend({ env })) {
    const h = await keyring.hasKey(s.account, { service: SERVICE, env });
    if (h.stored) return { stored: true, source: 'keyring', error: null };
    if (typeof configEnv(config)[s.envVar] === 'string' && configEnv(config)[s.envVar].trim()) return { stored: true, source: 'config', error: h.error };
    return { stored: false, source: null, error: h.error };
  }
  const c = configEnv(config)[s.envVar];
  return { stored: typeof c === 'string' && !!c.trim(), source: typeof c === 'string' && c.trim() ? 'config' : null, error: null };
}

async function setAgentKey(agentId, key, { env = process.env } = {}) {
  const s = spec(agentId);
  const problem = keyring.keyProblem(key);
  if (problem) throw new Error(problem);
  await keyring.setKey(s.account, key.trim(), { service: SERVICE, env });
  const b = keyring.backend({ env });
  return { account: s.account, keyring: b ? b.name : null };
}

async function removeAgentKey(agentId, { env = process.env } = {}) {
  const s = spec(agentId);
  const r = await keyring.removeKey(s.account, { service: SERVICE, env });
  return { account: s.account, removed: r.removed };
}

/**
 * Move API keys from config.json `env` (ANTHROPIC_API_KEY, OPENAI_API_KEY) into the keyring, then out of
 * config.json. A key already in the keyring wins (it was set later, with `trif agent key`). Returns
 * {moved: [names], left: [{name, why}], notes: [string]}; never the keys.
 */
async function migrateKeys(home, { env = process.env } = {}) {
  const P = require('./paths');
  const out = { moved: [], left: [], notes: [] };
  const { config, error } = P.readConfig(home);
  if (error) return out;
  const cenv = configEnv(config);
  const found = Object.values(AGENT_KEYS).filter((s) => typeof cenv[s.envVar] === 'string' && cenv[s.envVar].trim());
  if (!found.length) return out;
  const b = keyring.backend({ env });
  const drop = [];
  for (const s of found) {
    if (!b) { out.left.push({ name: s.envVar, why: keyring.noKeyring({ what: 'TRIF needs' }) }); continue; }
    const value = cenv[s.envVar].trim();
    try {
      const h = await keyring.hasKey(s.account, { service: SERVICE, env });
      if (h.error) throw new Error(h.error);
      if (!h.stored) {
        const problem = keyring.keyProblem(value);
        if (problem) throw new Error(problem);
        await keyring.setKey(s.account, value, { service: SERVICE, env });
      }
      drop.push(s.envVar);
      out.moved.push(s.envVar);
    } catch (e) {
      out.left.push({ name: s.envVar, why: String(e.message).split(value).join('[redacted]') });
    }
  }
  if (drop.length) {
    const next = { ...cenv };
    for (const n of drop) delete next[n];
    require('./update').setConfigKey(home, 'env', next);
    out.notes.push(`moved ${drop.join(' and ')} from config.json into ${b.name}: side-panel runs get ${drop.length === 1 ? 'it' : 'them'} through a key proxy, never in the agent's environment`);
  }
  for (const l of out.left) out.notes.push(`left ${l.name} in config.json (${l.why}); runs still use it through a key proxy`);
  return out;
}

/**
 * Before a run of plain Claude Code or Codex (runs.js calls the adapter's prepare): with a key, start the
 * run's key proxy and say how to point the agent at it. {env, secrets, options, cleanup, state} or null
 * (no key: the agent's own login).
 */
async function prepareAgentKey(agentId, { ws, env = process.env, logger = null } = {}) {
  const s = spec(agentId);
  const k = await agentKey(agentId, { config: ws && ws.config, env });
  if (!k.value) return null;
  const { startKeyProxy } = require('./keyproxy');
  const target = envVar(s.urlVar, env) || s.target;
  let said = false;
  const onStatus = (status) => { if (status === 401 && !said && logger) { said = true; logger.warn(`${s.name} refused the API key (401)`); } };
  let proxy;
  try { proxy = await startKeyProxy({ target, key: k.value, style: s.style, logger, onStatus }); } catch (e) { throw new Error(`couldn't start the key proxy for ${s.name}: ${e.message}`); }
  const prep = { env: {}, secrets: [k.value], options: {}, cleanup: () => proxy.close(), state: { apiKey: { account: s.account, source: k.source } } };
  if (agentId === 'claude') prep.env = { ANTHROPIC_BASE_URL: proxy.url, ANTHROPIC_API_KEY: PLACEHOLDER };
  else prep.options = { config: codexProviderArgs(proxy.url) };
  return prep;
}

const tomlStr = (v) => JSON.stringify(String(v));
/** The -c values that send a plain Codex run's requests through the key proxy. */
function codexProviderArgs(url) {
  return ['-c', `model_providers.${CODEX_PROVIDER}={ name = "OpenAI (TRIF)", base_url = ${tomlStr(url)}, wire_api = "responses", supports_websockets = false }`,
    '-c', `model_provider="${CODEX_PROVIDER}"`];
}

/** Doctor's lines for agent API keys ([{status, title, fix?}]); never the keys. */
async function doctorChecks(ws, { env = process.env } = {}) {
  const out = [];
  const cenv = configEnv(ws.config);
  for (const [id, s] of Object.entries(AGENT_KEYS)) {
    const h = await hasAgentKey(id, { config: ws.config, env });
    const who = id === 'claude' ? 'Claude Code' : 'Codex';
    if (h.source === 'keyring') out.push({ status: 'ok', title: `${who}: an ${s.name} API key is saved in ${keyring.backend({ env }).name} (not shown); runs send it through a key proxy, not the agent's environment` });
    else if (h.source === 'config') {
      out.push({ status: 'warn', title: `${who}: the ${s.name} API key is still in config.json (${s.envVar}), not ${keyring.backend({ env }) ? keyring.backend({ env }).name : 'a keyring'}${h.error ? ` (${h.error})` : ''}`,
        fix: keyring.backend({ env }) ? `run trif setup (it moves it), or trif agent key --agent ${id} --set-key and remove it from ${ws.configFile}` : keyring.noKeyring({ what: 'TRIF needs' }) });
    }
  }
  const stray = Object.keys(cenv).filter((k) => /(_API_KEY|_TOKEN|_SECRET)$/i.test(k) && !Object.values(AGENT_KEYS).some((s) => s.envVar === k) && typeof cenv[k] === 'string' && cenv[k]);
  if (stray.length) out.push({ status: 'info', title: `config.json env has ${stray.join(', ')}, which TRIF doesn't use (no agent gets it)`, fix: `remove ${stray.length === 1 ? 'it' : 'them'} from ${ws.configFile}` });
  return out;
}

module.exports = { SERVICE, AGENT_KEYS, PLACEHOLDER, CODEX_PROVIDER, agentKey, hasAgentKey, setAgentKey, removeAgentKey, migrateKeys, prepareAgentKey, codexProviderArgs, doctorChecks };
