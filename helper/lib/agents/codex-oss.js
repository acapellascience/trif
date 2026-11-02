'use strict';
// Open models through Codex (experimental): the codex adapter's run, its permission profile and its event
// parsing, but the model comes from a local server (Ollama, LM Studio) or a hosted OpenAI-compatible
// provider (OpenRouter, or any base URL) instead of OpenAI.
//
//   codex exec <codex.js flags, the same permission profile>
//              -c model_providers.trif-open={ name = "…", base_url = "…", wire_api = "responses"[, env_key = "NAME"] … }
//              -c model_provider="trif-open" -c web_search="disabled"
//              [-c shell_environment_policy.exclude=["NAME"]] -m MODEL [resume THREAD_ID] -- PROMPT
//
// One custom provider for every source, not `--oss --local-provider`: Codex 0.166's `exec --oss` fails
// ("This chat uses ollama, but your current provider is openai") unless model_provider is set too, and it
// pulls a model that isn't installed (many GB, mid-chat). Codex speaks only the Responses API to custom
// providers (`wire_api = "chat"` is gone); Ollama, LM Studio and OpenRouter all serve /v1/responses.
//
// The permission profile's `network = { enabled = false }` is for the commands Codex runs (its sandbox);
// Codex's own requests to the model server aren't sandboxed (verified with Codex 0.166 against a stand-in
// server on 127.0.0.1: the model requests arrive, the agent's own curl to the same server is refused).
//
// The API key (hosted): config.json holds only the NAME of the variable (`keyEnv`). Before each run the
// helper reads it from its own environment or the user's login shell (shellenv.js), gives it to Codex in
// Codex's environment only, and tells Codex not to pass it to the commands it runs
// (shell_environment_policy.exclude). The sandbox keeps those commands away from the shell profile files
// (they're in the home folder), from `ps -E` and from config.json. runs.js redacts the value from run logs.
//
// Settings: config.json `openModel` = {provider, model, baseUrl, keyEnv}, the defaults; agent.start's
// `openModel` (same shape) overrides them for one run, and agent.start's `model` beats both.

const codex = require('./codex');
const { lookupEnvVar, validName } = require('../shellenv');
const { oneLine } = require('./util');

const PROVIDER_ID = 'trif-open';

const PROVIDERS = {
  ollama: { name: 'Ollama', label: 'Ollama (on this computer)', local: true, baseUrl: 'http://127.0.0.1:11434/v1', keyEnv: '', defaultModel: 'gpt-oss:20b' },
  lmstudio: { name: 'LM Studio', label: 'LM Studio (on this computer)', local: true, baseUrl: 'http://127.0.0.1:1234/v1', keyEnv: '', defaultModel: 'openai/gpt-oss-20b' },
  openrouter: { name: 'OpenRouter', label: 'OpenRouter', local: false, baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', defaultModel: 'openai/gpt-oss-120b' },
  custom: { name: 'the model server', label: 'Custom URL (OpenAI-compatible)', local: false, baseUrl: '', keyEnv: '', defaultModel: '' },
};

// Local models worth trying first, if installed (matched loosely: "devstral" matches devstral:24b, and
// LM Studio's "qwen/qwen3-coder-30b-a3b" matches qwen3-coder:30b).
const RECOMMENDED_LOCAL = ['gpt-oss:20b', 'gpt-oss:120b', 'qwen3-coder:30b', 'qwen3.6:27b', 'devstral', 'gemma4'];

// OpenRouter: a short list (prices per million tokens in/out, November 2026), plus "Other…".
const OPENROUTER_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'gpt-oss-120b', description: 'OpenAI’s open model. Cheapest ($0.03 / $0.09 per M tokens).' },
  { id: 'qwen/qwen3-coder', name: 'Qwen3-Coder 480B', description: 'Strong at code ($0.30 / $1.00).' },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', description: '$0.04 / $0.50.' },
  { id: 'z-ai/glm-5.3', name: 'GLM-5.3', description: '$0.08 / $3.60.' },
  { id: 'moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code', description: '$0.60 / $3.50.' },
];

const MAX_MODEL = 200;

function cleanUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return '';
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return ''; // keys go in an environment variable, not the URL
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}

function cleanModel(m) {
  if (typeof m !== 'string') return '';
  const t = m.trim();
  return t && t.length <= MAX_MODEL && !/[\s\0-\x1f]/.test(t) ? t : '';
}

/** config.json's openModel, checked: {provider, model, baseUrl, keyEnv} ('' where unset). */
function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, c.provider) ? c.provider : 'ollama';
  return { provider, model: cleanModel(c.model), baseUrl: cleanUrl(c.baseUrl), keyEnv: validName(c.keyEnv) ? c.keyEnv : '' };
}

/**
 * What a run uses: the stored defaults, then a run's own choice (same shape; a different provider starts
 * from that provider's defaults), then agent.start's `model`. Provider defaults fill the gaps.
 * {provider, name, local, model, baseUrl, keyEnv}; `error` when it can't run (a custom provider with no URL).
 */
function resolve(stored, override, model) {
  const s = normalize(stored);
  const o = override && typeof override === 'object' ? override : null;
  let r = s;
  if (o) {
    const n = normalize({ ...(o.provider && o.provider !== s.provider ? {} : s), ...o });
    r = n;
  }
  const p = PROVIDERS[r.provider];
  const out = {
    provider: r.provider, name: p.name, local: p.local,
    model: cleanModel(model) || r.model || p.defaultModel,
    baseUrl: r.baseUrl || p.baseUrl,
    keyEnv: r.keyEnv || p.keyEnv,
    error: null,
  };
  if (!out.baseUrl) out.error = 'no server address set for the open model: set one in the side panel’s Settings (or `trif agent open-model --base-url <url>`)';
  else if (!out.model) out.error = 'no model chosen for the open model: pick one in the side panel’s Settings (or `trif agent open-model --model <name>`)';
  return out;
}

const tomlStr = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string here

/** The -c values that point Codex at the provider. */
function providerArgs(om) {
  const fields = [`name = ${tomlStr(`${om.name} (TRIF)`)}`, `base_url = ${tomlStr(om.baseUrl)}`, 'wire_api = "responses"'];
  if (om.keyEnv) fields.push(`env_key = ${tomlStr(om.keyEnv)}`);
  // HTTPS only: Codex otherwise tries a WebSocket first, and a server without one (OpenRouter, Ollama)
  // costs a round of retries ("Reconnecting... n/5") before it falls back, sometimes minutes.
  fields.push('supports_websockets = false');
  // Local models can take minutes to load before the first token; and fail fast when nothing listens.
  if (om.local) fields.push('stream_idle_timeout_ms = 900000', 'request_max_retries = 1', 'stream_max_retries = 1');
  const args = ['-c', `model_providers.${PROVIDER_ID}={ ${fields.join(', ')} }`, '-c', `model_provider="${PROVIDER_ID}"`,
    // OpenAI's hosted web search tool: no other provider has it.
    '-c', 'web_search="disabled"'];
  if (om.keyEnv) args.push('-c', `shell_environment_policy.exclude=[${tomlStr(om.keyEnv)}]`);
  return args;
}

function keyHelp(om) {
  return `add \`export ${om.keyEnv}=<your key>\` to your shell profile (~/.zshrc), then try again`;
}

/** Errors in the user's terms (codex.js parse calls it through state.friendly). */
function friendlyFor(om) {
  return (message) => {
    const m = String(message);
    if (/Model metadata for .* not found/i.test(m)) return null; // Codex's warning for every non-OpenAI model
    if (/missing environment variable|env(ironment)? var.*not (set|found)/i.test(m) && om.keyEnv) return `${om.keyEnv} isn't set: ${keyHelp(om)}`;
    if (/\b401\b|unauthori[sz]ed|invalid api key|no auth/i.test(m)) {
      return om.keyEnv ? `${om.name} refused the key in ${om.keyEnv} (401): check it, or make a new one` : `${om.name} wants an API key (401): set the name of the variable holding it in Settings`;
    }
    if (/\b402\b|insufficient (credits|balance|funds)|payment required/i.test(m)) return `${om.name} says the account is out of credit (402)`;
    if (/not found, try pulling|model .*not found|\b404\b.*model|no such model/i.test(m)) {
      return om.provider === 'ollama' ? `${om.model} isn't installed in Ollama: run \`ollama pull ${om.model}\` in a terminal` : `${om.name} doesn't have the model ${om.model}: pick another in Settings (${oneLine(m, 160)})`;
    }
    if (/connection refused|error sending request|tcp connect|failed to connect|dns error|connect error/i.test(m)) {
      return om.local ? `${om.name} isn't running (nothing answers at ${om.baseUrl}): open the ${om.name} app${om.provider === 'ollama' ? ' (or run `ollama serve`)' : ' and start its server'}, then try again`
        : `couldn't reach ${om.baseUrl}: ${oneLine(m, 200)}`;
    }
    return m;
  };
}

// Model servers' own lists. Local only (127.0.0.1 or what the user set); 3 s limit.
async function getJson(url, { timeout = 3000, fetchImpl = globalThis.fetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'no answer' : (e.cause && e.cause.code) || e.message);
  } finally { clearTimeout(t); }
}

// Ollama's own API lives next to its OpenAI-compatible /v1.
const ollamaRoot = (baseUrl) => baseUrl.replace(/\/v1$/, '');

/** Parse /api/tags (Ollama) or /v1/models (LM Studio, OpenAI-compatible) into model names. */
function parseModelList(json) {
  if (json && Array.isArray(json.models)) return json.models.map((m) => m && (m.name || m.model)).filter((n) => typeof n === 'string' && n);
  if (json && Array.isArray(json.data)) return json.data.map((m) => m && m.id).filter((n) => typeof n === 'string' && n);
  return [];
}

const loose = (s) => String(s).toLowerCase().replace(/^.*\//, '').replace(/:latest$/, '').replace(/[^a-z0-9]/g, '');
function recommendedRank(name) {
  const k = loose(name);
  const i = RECOMMENDED_LOCAL.findIndex((r) => k.startsWith(loose(r)));
  return i === -1 ? Infinity : i;
}

/** Installed models, recommended ones first (in RECOMMENDED_LOCAL order), as agent.models entries. */
function orderLocal(names) {
  const uniq = [...new Set(names)];
  const rec = uniq.filter((n) => recommendedRank(n) !== Infinity).sort((a, b) => recommendedRank(a) - recommendedRank(b) || a.localeCompare(b));
  const rest = uniq.filter((n) => recommendedRank(n) === Infinity).sort((a, b) => a.localeCompare(b));
  return [...rec.map((n) => ({ id: n, name: n, description: 'Recommended' })), ...rest.map((n) => ({ id: n, name: n, description: '' }))];
}

/** Installed models on a local server: {names} or {error}. */
async function installedModels(om, opts = {}) {
  try {
    const json = om.provider === 'ollama' ? await getJson(`${ollamaRoot(om.baseUrl)}/api/tags`, opts) : await getJson(`${om.baseUrl}/models`, opts);
    return { names: parseModelList(json), error: null };
  } catch (e) {
    return { names: null, error: e.message };
  }
}

const adapter = {
  id: 'codex-oss',
  name: 'Open model (via Codex)',
  binary: 'codex',
  systemPrompt: false,
  experimental: true,
  note: '',
  missing: 'Open models run through Codex, which isn\'t installed or can\'t be found. Install it (brew install codex), ' +
    'then run `trif setup` in the same terminal so the helper finds it. (No OpenAI account needed for open models.)',
  PROVIDERS, RECOMMENDED_LOCAL, OPENROUTER_MODELS, normalize, resolve, providerArgs, parseModelList, orderLocal, friendlyFor, installedModels,

  detect(opts) {
    const d = codex.detect(opts);
    return d.available || !d.path ? d : { ...d, note: d.note.replace(/^Codex/, 'Codex (needed for open models)') };
  },

  // The model picker: what's installed locally (recommended first), or a short list for OpenRouter. Never
  // the network for hosted providers. `custom: true` always: "Other…" takes any name.
  async listModels({ config, openModel, fetchImpl }) {
    const om = resolve(config && config.openModel, openModel);
    const p = PROVIDERS[om.provider];
    if (om.provider === 'openrouter') return { models: OPENROUTER_MODELS, default: om.model || p.defaultModel, custom: true, error: null, note: '' };
    if (!p.local) return { models: [], default: om.model || null, custom: true, error: null, note: `Type the model name ${om.baseUrl || 'your server'} expects.` };
    const r = await installedModels(om, { fetchImpl });
    if (r.error) return { models: [], default: null, custom: true, error: `${p.name} isn't running at ${om.baseUrl} (${r.error}): open the ${p.name} app${om.provider === 'ollama' ? ', or run `ollama serve`' : ' and start its server'}`, note: '' };
    const models = orderLocal(r.names);
    const pull = om.provider === 'ollama' ? 'run `ollama pull gpt-oss:20b` (about 14 GB; needs 16 GB of memory free)' : 'download one in LM Studio (gpt-oss 20B is a good start)';
    return {
      models, default: models[0] ? models[0].id : null, custom: true, error: null,
      note: models.length ? (models[0].description ? '' : `None of the recommended models is installed (${RECOMMENDED_LOCAL.join(', ')}).`) : `No models installed in ${p.name} yet: ${pull}.`,
    };
  },
  modelsCacheKey({ config, openModel }) { return JSON.stringify(resolve(config && config.openModel, openModel)); },
  modelsCacheMs: 5000, // a model pulled a minute ago should show up

  /**
   * Before the run (runs.js, async): settle the provider and model, find the key, and check a local
   * server is up and has the model (fast, clear errors instead of Codex's retries). Throws a user-facing
   * Error. Returns {env, secrets, state, options}: env goes to Codex only; secrets are redacted from logs.
   */
  async prepare({ ws, model, openModel, env = process.env, lookup = lookupEnvVar, fetchImpl }) {
    const om = resolve(ws && ws.config && ws.config.openModel, openModel, model);
    if (om.error) throw new Error(om.error);
    const extraEnv = {};
    const secrets = [];
    if (om.keyEnv) {
      const k = await lookup(om.keyEnv, { env });
      if (!k.value) throw new Error(`${om.keyEnv} isn't set (${k.error || 'not found'}): ${keyHelp(om)}`);
      extraEnv[om.keyEnv] = k.value;
      secrets.push(k.value);
    }
    if (om.local) {
      const r = await installedModels(om, { fetchImpl });
      if (r.error) throw new Error(friendlyFor(om)(`connection refused (${r.error})`));
      if (om.provider === 'ollama' && r.names.length && !r.names.some((n) => n === om.model || n === `${om.model}:latest`)) {
        throw new Error(friendlyFor(om)('model not found, try pulling it first'));
      }
    }
    return { env: extraEnv, secrets, state: { friendly: friendlyFor(om), openModel: om, providerName: om.name }, options: { openModel: om } };
  },

  // writable / readOnly / denied: as codex.js. openModel: from prepare (resolve()).
  command(opts) {
    const om = opts.openModel || resolve(null, null, opts.model);
    const base = codex.command({ ...opts, model: om.model });
    const args = base.args;
    const at = args.length - (opts.sessionId ? 4 : 2) - (om.model ? 2 : 0); // before -m [resume id] -- prompt
    args.splice(at, 0, ...providerArgs(om));
    return { file: base.file, args, locked: base.locked };
  },

  parse(line, emit, state = {}) {
    codex.parse(line, (ev) => { if (!(ev.kind === 'error' && ev.message === null)) emit(ev); }, state);
  },

  explainExit({ stderr, state }) {
    const om = state && state.openModel;
    const last = String(stderr || '').trim().split('\n').filter((l) => !/^Reading additional input/.test(l)).pop() || '';
    if (!om || !last) return null;
    const f = friendlyFor(om)(last);
    return f && f !== last ? f : null;
  },

  // No OpenAI login involved: nothing to check or log in to.
  loginFix: '',
  login: null,
};

/** Doctor checks for the open model (async; never prints the key). [{status, title, fix?}] */
adapter.doctorChecks = async function doctorChecks(ws, { codexVersion, env = process.env, lookup = lookupEnvVar, fetchImpl } = {}) {
  const out = [];
  const add = (status, title, fix) => out.push(fix ? { status, title, fix } : { status, title });
  const stored = ws.config && ws.config.openModel;
  if (!stored) { add('info', 'Open model (via Codex, experimental): not set up (optional; see README "Open models")'); return out; }
  const om = resolve(stored);
  const label = `Open model: ${PROVIDERS[om.provider].label}${om.model ? `, ${om.model}` : ''}`;
  if (om.error) { add('warn', `${label}: ${om.error}`); return out; }
  if (codexVersion && codex.tooOld(codexVersion)) add('warn', `${label}: Codex ${codexVersion} is too old`, 'brew upgrade codex');
  if (om.keyEnv) {
    const k = await lookup(om.keyEnv, { env });
    if (k.value) add('ok', `${label}: ${om.keyEnv} is set (${k.source === 'helper' ? 'in this environment' : 'in your shell profile'}; not shown)`);
    else add('warn', `${label}: ${om.keyEnv} isn't set, so runs can't reach ${om.name}`, keyHelp(om));
  } else if (!om.local) {
    add('info', `${label}: no API key variable set (fine if ${om.baseUrl} needs none)`);
  }
  if (om.local) {
    const r = await installedModels(om, { fetchImpl });
    const app = PROVIDERS[om.provider].name;
    if (r.error) add('warn', `${label}: ${app} isn't reachable at ${om.baseUrl} (${r.error})`, om.provider === 'ollama' ? 'open the Ollama app, or run `ollama serve` (install: brew install ollama)' : 'open LM Studio and start its server (Developer tab, or `lms server start`)');
    else if (om.provider === 'ollama' && !r.names.some((n) => n === om.model || n === `${om.model}:latest`)) add('warn', `${label}: ${om.model} isn't installed in Ollama`, `ollama pull ${om.model}`);
    else add('ok', `${label}: ${app} is running${r.names.length ? ` (${r.names.length} model${r.names.length === 1 ? '' : 's'} installed)` : ''}`);
  }
  return out;
};

/** agent.openModel: the stored defaults, the providers, and (with `check`) whether the key is found. */
adapter.settings = async function settings(ws, { check = false, env = process.env, lookup = lookupEnvVar } = {}) {
  const stored = ws.config && ws.config.openModel;
  const openModel = normalize(stored);
  const effective = resolve(stored);
  const out = {
    openModel, configured: !!stored,
    effective: { provider: effective.provider, model: effective.model, baseUrl: effective.baseUrl, keyEnv: effective.keyEnv },
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, local: p.local, baseUrl: p.baseUrl, keyEnv: p.keyEnv, defaultModel: p.defaultModel })),
  };
  if (check && effective.keyEnv) {
    const k = await lookup(effective.keyEnv, { env });
    out.key = { name: effective.keyEnv, found: !!k.value, source: k.source, error: k.value ? null : k.error };
  }
  return out;
};

/**
 * agent.openModel.set / `trif agent open-model`: store the defaults in config.json `openModel` (merged with
 * what's there; '' clears a field). Throws on anything invalid. Never a key: only a variable's name.
 */
adapter.saveSettings = function saveSettings(home, input, { setConfigKey = require('../update').setConfigKey, readConfig = require('../paths').readConfig } = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const cur = normalize(readConfig(home).config.openModel);
  const next = { ...cur };
  if (i.provider !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, i.provider)) throw new Error(`unknown provider "${String(i.provider).slice(0, 40)}" (use: ${Object.keys(PROVIDERS).join(', ')})`);
    if (i.provider !== cur.provider) { next.model = ''; next.baseUrl = ''; next.keyEnv = ''; } // another provider's choices don't carry over
    next.provider = i.provider;
  }
  if (i.model !== undefined) {
    if (i.model !== '' && !cleanModel(i.model)) throw new Error('a model name is one word, at most 200 characters');
    next.model = cleanModel(i.model);
  }
  if (i.baseUrl !== undefined) {
    if (i.baseUrl !== '' && !cleanUrl(i.baseUrl)) throw new Error('the server address must be an http(s) URL without a user name or password, like https://example.com/v1');
    next.baseUrl = cleanUrl(i.baseUrl);
  }
  if (i.keyEnv !== undefined) {
    if (i.keyEnv !== '' && !validName(i.keyEnv)) throw new Error('give the NAME of the environment variable holding the key (like OPENROUTER_API_KEY), not the key');
    next.keyEnv = i.keyEnv;
  }
  const stored = { provider: next.provider };
  for (const k of ['model', 'baseUrl', 'keyEnv']) if (next[k]) stored[k] = next[k];
  setConfigKey(home, 'openModel', stored);
  return normalize(stored);
};

module.exports = adapter;
