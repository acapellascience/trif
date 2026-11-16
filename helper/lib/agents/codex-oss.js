'use strict';
// Open models through Codex (experimental): the codex adapter's run, its permission profile and its event
// parsing, but the model comes from a local server (Ollama, LM Studio) or a hosted OpenAI-compatible
// provider (OpenRouter, or any base URL) instead of OpenAI.
//
//   codex exec <codex.js flags, the same permission profile>
//              -c model_providers.trif-open={ name = "…", base_url = "…", wire_api = "responses" … }
//              -c model_provider="trif-open"
//              -c shell_environment_policy.exclude=[<API key patterns>] -m MODEL [resume THREAD_ID] -   (message on stdin)
//
// (base_url: the provider's, or for a provider with a key, the run's key proxy: see "The API key".)
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
// The API key (hosted: OpenRouter, a custom server): only in the system keyring (keyring.js: the macOS
// Keychain, item "TRIF open model key" / account `openrouter` or `custom:<host>`), set from the panel
// (agent.openModel.setKey) or `trif agent open-model --set-key`; never in config.json, an environment
// variable or the extension. Before each run the helper reads it into its own memory: Codex never gets it.
// Instead the helper starts a proxy for the run (keyproxy.js) on 127.0.0.1, which adds the key and
// forwards to the provider; Codex's base_url is that proxy. The proxy wants a token of the run's, which
// Codex reads from a file in the run's own folder (codex.js proxyAuth): not in its argv, unlike the address. (Anything in a process's
// environment or arguments is readable by any same-user process, sysctl KERN_PROCARGS2, sandbox or not:
// that's why the key is in neither Codex's nor, any more, the user's shell's.) The sandbox keeps the
// commands away from the Keychain (in the home folder, denied), config.json and the network (the proxy
// included). shell_environment_policy.exclude keeps API-key-looking variables a shell profile still
// exports out of the environment Codex gives them (it snapshots the user's login shell outside the
// sandbox). runs.js redacts the key from run logs.
//
// Settings: config.json `openModel` = {provider, model, baseUrl}, the defaults; agent.start's `openModel`
// (same shape) overrides them for one run, and agent.start's `model` beats both.

const codex = require('./codex');
const keyring = require('../keyring');
const { startKeyProxy } = require('../keyproxy');
const { oneLine } = require('./util');

// API key variables never given to this agent (index.js agentEnv gives none since 0.2.0; kept as a guard).
const PASSED_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

const PROVIDER_ID = 'trif-open';

const PROVIDERS = {
  ollama: { name: 'Ollama', label: 'Ollama (on this computer)', local: true, baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'gpt-oss:20b' },
  lmstudio: { name: 'LM Studio', label: 'LM Studio (on this computer)', local: true, baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'openai/gpt-oss-20b' },
  openrouter: { name: 'OpenRouter', label: 'OpenRouter', local: false, keyRequired: true, baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-oss-120b' },
  custom: { name: 'the model server', label: 'Custom URL (OpenAI-compatible)', local: false, keyRequired: false, baseUrl: '', defaultModel: '' },
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

// How much the model can hold. Codex knows only OpenAI's models ("Model metadata for … not found"), so for an
// open model it never compacts a long chat, and the provider fills in a big answer size of its own: a long
// chat then fails with "maximum context length" (seen: 149K tokens in, 126K asked for out, 262K window).
// TRIF tells Codex the window (model_context_window) and has it compact the chat once it reaches
// COMPACT_SHARE of it (model_auto_compact_token_limit), leaving the rest for the answer. OpenRouter publishes
// each model's window; elsewhere, or when that list can't be had, DEFAULT_WINDOW.
const DEFAULT_WINDOW = 65536, COMPACT_SHARE = 0.4, MIN_COMPACT = 8192;
const windows = new Map(); // OpenRouter model id -> context length (this helper's lifetime)
async function contextWindow(om, { fetchImpl = globalThis.fetch } = {}) {
  if (om.provider !== 'openrouter') return DEFAULT_WINDOW;
  if (!windows.has(om.model)) {
    try {
      const list = await getJson('https://openrouter.ai/api/v1/models', { timeout: 4000, fetchImpl });
      for (const m of Array.isArray(list && list.data) ? list.data : []) {
        if (m && typeof m.id === 'string' && Number.isFinite(m.context_length) && m.context_length > 0) windows.set(m.id, m.context_length);
      }
    } catch { /* offline, or the list moved: the default */ }
  }
  return windows.get(om.model) || DEFAULT_WINDOW;
}

function cleanUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return '';
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return ''; // keys go in the keyring, not the URL
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}

function cleanModel(m) {
  if (typeof m !== 'string') return '';
  const t = m.trim();
  return t && t.length <= MAX_MODEL && !/[\s\0-\x1f]/.test(t) ? t : '';
}

/** Whether a server address is on this computer (the loopback interface). */
function isLoopback(u) {
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return false; }
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** For the agent: the model it is and who serves it (Codex's built-in instructions are written for OpenAI's). */
function modelNote(om) {
  let where = `served by ${om.name}`;
  if (om.local) where = `running on this computer in ${om.name}`;
  else if (om.provider === 'custom') { try { where = `served by ${new URL(om.baseUrl).host}`; } catch { /* as is */ } }
  return `(This chat's model is ${om.model}, ${where}. Codex CLI is only the program running it: its built-in instructions are written for OpenAI's models. Asked which model you are, that's the answer: ${om.model}.)`;
}

/** config.json's openModel, checked: {provider, model, baseUrl} ('' where unset). (An old `keyEnv` is ignored.) */
function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, c.provider) ? c.provider : 'ollama';
  return { provider, model: cleanModel(c.model), baseUrl: cleanUrl(c.baseUrl) };
}

/**
 * The keyring account holding a provider's key ('' when it takes none): `openrouter`, or `custom:<host>`
 * for a custom server (its host and port, so each server has its own key). Local servers: none.
 */
function keyAccount({ provider, baseUrl }) {
  if (provider === 'openrouter') return 'openrouter';
  if (provider !== 'custom' || !baseUrl) return '';
  try { return `custom:${new URL(baseUrl).host.toLowerCase()}`; } catch { return ''; }
}

/**
 * What a run uses: the stored defaults, then a run's own choice (same shape; a different provider starts
 * from that provider's defaults), then agent.start's `model`. Provider defaults fill the gaps.
 * {provider, name, local, server, model, modelChosen, baseUrl, keyAccount, keyRequired}; `error` when it
 * can't run (a custom provider with no URL, no model).
 *   local        the model runs on this computer: a local provider at a loopback address (an Ollama
 *                pointed elsewhere isn't local; the panel only says "nothing leaves it" when it is)
 *   server       an Ollama or LM Studio server (wherever it is): its installed models can be listed
 *   modelChosen  the model was picked (stored, the run's, or agent.start's), not the provider's default
 *   keyAccount   the keyring account its key would be under ('' for local servers); keyRequired: OpenRouter
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
  const chosen = cleanModel(model) || r.model;
  const baseUrl = r.baseUrl || p.baseUrl;
  const out = {
    provider: r.provider, name: p.name, local: p.local && isLoopback(baseUrl), server: p.local,
    model: chosen || p.defaultModel, modelChosen: !!chosen,
    baseUrl,
    keyAccount: keyAccount({ provider: r.provider, baseUrl }),
    keyRequired: !!p.keyRequired,
    error: null,
  };
  if (!out.baseUrl) out.error = 'no server address set for the open model: set one in the side panel’s Settings (or `trif agent open-model --base-url <url>`)';
  else if (!out.model) out.error = 'no model chosen for the open model: pick one in the side panel’s Settings (or `trif agent open-model --model <name>`)';
  return out;
}

/** Why a key can't be sent to this server ('' when it can): plain http to another computer would show it to the network. */
function insecureKey({ baseUrl }) {
  if (!baseUrl || isLoopback(baseUrl) || !/^http:/i.test(baseUrl)) return '';
  return 'the server address must start with https:// when an API key is sent: over http:// to another computer the key would cross the network readable';
}

/**
 * The model a local server run uses when none was picked: the provider's default if installed, else the
 * first installed recommended model, else the first installed (orderLocal's first), else the default.
 */
function isInstalled(model, names) { return names.some((n) => n === model || n === `${model}:latest`); }
function localModel(om, names) {
  if (om.modelChosen || !Array.isArray(names) || !names.length || isInstalled(om.model, names)) return om.model;
  return orderLocal(names)[0].id;
}

const tomlStr = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string here

/**
 * The -c values that point Codex at the provider. `auth`: with a key proxy, the field that sends its token
 * (codex.js proxyAuth: the token is in a file of the run's, never in these values).
 */
function providerArgs(om, auth = null) {
  // No env_key: Codex never has the key (the run's key proxy adds it; see "The API key" above).
  const fields = [`name = ${tomlStr(`${om.name} (TRIF)`)}`, `base_url = ${tomlStr(om.proxyUrl || om.baseUrl)}`, 'wire_api = "responses"'];
  if (auth) fields.push(auth);
  // HTTPS only: Codex otherwise tries a WebSocket first, and a server without one (OpenRouter, Ollama)
  // costs a round of retries ("Reconnecting... n/5") before it falls back, sometimes minutes.
  fields.push('supports_websockets = false');
  // Local models can take minutes to load before the first token; and fail fast when nothing listens.
  if (om.server) fields.push('stream_idle_timeout_ms = 900000', 'request_max_retries = 1', 'stream_max_retries = 1');
  // (No web search: codex.js turns OpenAI's hosted tool off for every run; no other provider has it anyway.)
  const args = ['-c', `model_providers.${PROVIDER_ID}={ ${fields.join(', ')} }`, '-c', `model_provider="${PROVIDER_ID}"`];
  // How much it holds, and when to compact the chat (see DEFAULT_WINDOW)
  if (Number.isFinite(om.contextWindow) && om.contextWindow > 0) {
    args.push('-c', `model_context_window=${om.contextWindow}`,
      '-c', `model_auto_compact_token_limit=${Math.max(MIN_COMPACT, Math.floor(om.contextWindow * COMPACT_SHARE))}`);
  }
  // (shell_environment_policy.exclude, keeping API key variables a shell profile still exports from the
  // commands: codex.js adds it to every Codex run.)
  return args;
}
const { EXCLUDED_VARS } = codex;

function keyHelp(om) {
  return `paste your ${om.name} API key in the side panel’s Settings (it’s kept in ${keyringName()}), or run \`trif agent open-model --set-key\` in a terminal`;
}
function keyringName() { const b = keyring.backend(); return b ? b.name : 'the system keyring'; }

/** Errors in the user's terms (codex.js parse calls it through state.friendly). */
function friendlyFor(om) {
  return (message) => {
    const m = String(message);
    if (/Model metadata for .* not found/i.test(m)) return null; // Codex's warning for every non-OpenAI model
    // (the run's key proxy, not the provider: this Codex didn't send the run's token, keyproxy.js NO_TOKEN)
    if (/key proxy: this request doesn.t carry the run.s token/.test(m)) return 'This Codex didn’t send the run’s key-proxy token, so TRIF’s key proxy refused its request: update Codex (brew upgrade codex, or npm install -g @openai/codex), then try again';
    if (/\b401\b|unauthori[sz]ed|invalid api key|no auth/i.test(m)) {
      if (om.keyed) return `${om.name} refused the API key (401): check it, or make a new one and save it in Settings (or \`trif agent open-model --set-key\`)`;
      return om.keyAccount ? `${om.name} wants an API key (401): ${keyHelp(om)}` : `${om.name} wants an API key (401)`;
    }
    if (/\b402\b|insufficient (credits|balance|funds)|payment required/i.test(m)) return `${om.name} says the account is out of credit (402)`;
    if (/maximum context length|context[_ ]length[_ ]exceeded|context window|reduce the length of the (input|prompt)/i.test(m)) {
      return `This chat has grown longer than ${om.model} can hold. Start a new chat (the + button) and say what you were working on.`;
    }
    if (/not found, try pulling|model .*not found|\b404\b.*model|no such model/i.test(m)) {
      return om.provider === 'ollama' ? `${om.model} isn't installed in Ollama: run \`ollama pull ${om.model}\` in a terminal` : `${om.name} doesn't have the model ${om.model}: pick another in Settings (${oneLine(m, 160)})`;
    }
    if (/connection refused|error sending request|tcp connect|failed to connect|dns error|connect error/i.test(m)) {
      return om.server ? `${om.name} isn't running (nothing answers at ${om.baseUrl}): open the ${om.name} app${om.provider === 'ollama' ? ' (or run `ollama serve`)' : ' and start its server'}, then try again`
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
  PROVIDERS, RECOMMENDED_LOCAL, OPENROUTER_MODELS, EXCLUDED_VARS, normalize, resolve, keyAccount, modelNote, insecureKey, providerArgs, contextWindow, parseModelList, orderLocal, friendlyFor, installedModels, isLoopback, localModel,

  detect(opts) {
    const d = codex.detect(opts);
    return d.available || !d.path ? d : { ...d, note: d.note.replace(/^Codex/, 'Codex (needed for open models)') };
  },

  // The model picker: what's installed locally (recommended first), or a short list for OpenRouter. Never
  // the network for hosted providers. `custom: true` always: "Other…" takes any name.
  async listModels({ config, openModel, fetchImpl }) {
    // `default`: what a run with no model picked uses (resolve, and for a local server localModel).
    const om = resolve(config && config.openModel, openModel);
    const p = PROVIDERS[om.provider];
    if (om.provider === 'openrouter') return { models: OPENROUTER_MODELS, default: om.model || null, custom: true, error: null, note: '' };
    if (!om.server) return { models: [], default: om.model || null, custom: true, error: null, note: `Type the model name ${om.baseUrl || 'your server'} expects.` };
    const r = await installedModels(om, { fetchImpl });
    if (r.error) return { models: [], default: null, custom: true, error: `${p.name} isn't running at ${om.baseUrl} (${r.error}): open the ${p.name} app${om.provider === 'ollama' ? ', or run `ollama serve`' : ' and start its server'}`, note: '' };
    const models = orderLocal(r.names);
    const pull = om.provider === 'ollama' ? 'run `ollama pull gpt-oss:20b` (about 14 GB; needs 16 GB of memory free)' : 'download one in LM Studio (gpt-oss 20B is a good start)';
    return {
      models, default: models.length ? localModel(om, r.names) : null, custom: true, error: null,
      note: models.length ? (models[0].description ? '' : `None of the recommended models is installed (${RECOMMENDED_LOCAL.join(', ')}).`) : `No models installed in ${p.name} yet: ${pull}.`,
    };
  },
  modelsCacheKey({ config, openModel }) { return JSON.stringify(resolve(config && config.openModel, openModel)); },
  modelsCacheMs: 5000, // a model pulled a minute ago should show up

  /**
   * Before the run (runs.js, async): settle the provider and model, read the key from the keyring, and
   * check a local server is up and has the model (fast, clear errors instead of Codex's retries). Throws a
   * user-facing Error. Returns {env, unsetEnv, secrets, state, options, cleanup}: the key goes into no
   * environment; with a key, a proxy that adds it is started (keyproxy.js) and `cleanup` closes it
   * (runs.js calls it when the run ends); secrets are redacted from logs. The key is read afresh for every
   * run (a Keychain read takes milliseconds), so a key just replaced or removed counts at once. API keys
   * the user put in config.json for Claude Code and Codex (`unsetEnv`) aren't passed to this agent.
   */
  async prepare({ ws, model, openModel, env = process.env, fetchImpl, logger }) {
    const om = resolve(ws && ws.config && ws.config.openModel, openModel, model);
    if (om.error) throw new Error(om.error);
    const secrets = [];
    let key = null;
    if (om.keyAccount) {
      const k = await keyring.getKey(om.keyAccount, { env });
      if (k.error) throw new Error(`${k.error}${om.keyRequired ? '' : ` (for ${om.baseUrl})`}`);
      if (!k.value && om.keyRequired) throw new Error(`no ${om.name} API key yet: ${keyHelp(om)}`);
      if (k.value) {
        if (insecureKey(om)) throw new Error(insecureKey(om));
        key = k.value;
        secrets.push(key);
        om.keyed = true;
      }
    }
    if (om.server) {
      const r = await installedModels(om, { fetchImpl });
      if (r.error) throw new Error(friendlyFor(om)(`connection refused (${r.error})`));
      om.model = localModel(om, r.names); // (no model picked: one that's installed, as listModels offers)
      if (om.provider === 'ollama' && r.names.length && !isInstalled(om.model, r.names)) {
        throw new Error(friendlyFor(om)('model not found, try pulling it first'));
      }
    }
    let proxy = null;
    if (key) {
      let said = false;
      const onStatus = (status) => { if (status === 401 && !said && logger) { said = true; logger.warn(`open model: ${om.name} refused the API key (401)`); } };
      try { proxy = await startKeyProxy({ target: om.baseUrl, key, logger, onStatus, token: true }); } catch (e) { throw new Error(`couldn't start the key proxy for ${om.name}: ${e.message}`); }
    }
    om.contextWindow = await contextWindow(om, { fetchImpl });
    if (proxy) secrets.push(proxy.token); // (redacted from logs too)
    const forCodex = proxy ? { ...om, proxyUrl: proxy.url, proxyToken: proxy.token } : om;
    return {
      env: {}, unsetEnv: [...PASSED_KEYS], secrets,
      state: { friendly: friendlyFor(om), openModel: om, providerName: om.name },
      options: { openModel: forCodex },
      cleanup: proxy ? () => proxy.close() : null,
    };
  },

  // writable / readOnly / denied: as codex.js. openModel: from prepare (resolve()).
  // Each message starts with which model this is (modelNote): asked, open models said they were OpenAI's
  // ("I'm an OpenAI coding agent running inside Codex CLI"), from Codex's own instructions.
  command(opts) {
    const om = opts.openModel || resolve(null, null, opts.model);
    const auth = om.proxyToken ? codex.proxyAuth(opts.agentDir) : null;
    return codex.command({ ...opts, effort: undefined, prompt: `${modelNote(om)}\n\n${opts.prompt}`, model: om.model, config: providerArgs(om, auth), proxyToken: om.proxyToken || null });
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
  logout: null,
};

// API key variables a shell profile commonly exports (doctor warns when one is in the environment).
const KEY_VARS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'DEEPSEEK_API_KEY',
  'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'FIREWORKS_API_KEY', 'HF_TOKEN'];
/** Names of likely API key variables set in `env` (their values aren't looked at beyond being non-empty). */
function keyVarsIn(env) {
  return Object.keys(env || {}).filter((k) => (KEY_VARS.includes(k) || /_API_KEY$/i.test(k)) && typeof env[k] === 'string' && env[k] !== '').sort();
}
adapter.keyVarsIn = keyVarsIn;

/** Doctor's warning about API keys in the environment (null when there are none). Never reads more than presence. */
adapter.keyVarsCheck = function keyVarsCheck(env = process.env) {
  const vars = keyVarsIn(env);
  if (!vars.length) return null;
  const one = vars.length === 1;
  return {
    status: 'warn',
    title: `API key variable${one ? '' : 's'} set in this environment: ${vars.join(', ')}. Every program started from this terminal gets ${one ? 'it' : 'them'}, and other programs (an agent's sandboxed commands among them) can read ${one ? 'it' : 'them'}`,
    fix: `remove the export line${one ? '' : 's'} from your shell profile (~/.zshrc, ~/.zprofile, ~/.bash_profile…) and open a new terminal. Open models don't need ${one ? 'it' : 'them'}: paste the key in the side panel's Settings, or run trif agent open-model --set-key (kept in ${keyringName()})`,
  };
};

/** Whether the key for `om` is in the keyring: {account, stored, keyring, error}; null when it takes none. */
async function keyStatus(om, env) {
  if (!om.keyAccount) return null;
  const b = keyring.backend({ env });
  const h = await keyring.hasKey(om.keyAccount, { env });
  return { account: om.keyAccount, stored: h.stored, keyring: b ? b.name : null, error: h.error };
}

/** Doctor checks for the open model (async; never prints the key). [{status, title, fix?}] */
adapter.doctorChecks = async function doctorChecks(ws, { codexVersion, env = process.env, fetchImpl } = {}) {
  const out = [];
  const add = (status, title, fix) => out.push(fix ? { status, title, fix } : { status, title });
  const stored = ws.config && ws.config.openModel;
  if (!stored) { add('info', 'Open model (via Codex, experimental): not set up (optional; see README "Open models")'); return out; }
  const om = resolve(stored);
  const label = `Open model: ${PROVIDERS[om.provider].label}${om.model ? `, ${om.model}` : ''}`;
  if (om.error) { add('warn', `${label}: ${om.error}`); return out; }
  if (codexVersion && codex.tooOld(codexVersion)) add('warn', `${label}: Codex ${codexVersion} is too old`, 'brew upgrade codex');
  const k = await keyStatus(om, env);
  if (k) {
    const what = om.provider === 'openrouter' ? 'OpenRouter key' : `API key for ${new URL(om.baseUrl).host}`;
    if (k.error) add('warn', `${what}: ${k.error}`);
    else if (k.stored && insecureKey(om)) add('warn', `${what}: saved, but ${insecureKey(om)}`);
    else if (k.stored) add('ok', `${what}: saved in ${k.keyring} (not shown)`);
    else if (om.keyRequired) add('warn', `${what}: missing, so runs can't reach ${om.name}`, 'set it in the side panel\'s Settings, or with trif agent open-model --set-key');
    else add('info', `${what}: none saved (fine if ${om.baseUrl} needs none; set one in the side panel's Settings or with trif agent open-model --set-key)`);
  }
  if (om.server) {
    const r = await installedModels(om, { fetchImpl });
    const app = PROVIDERS[om.provider].name;
    if (!r.error) om.model = localModel(om, r.names);
    if (r.error) add('warn', `${label}: ${app} isn't reachable at ${om.baseUrl} (${r.error})`, om.provider === 'ollama' ? 'open the Ollama app, or run `ollama serve` (install: brew install ollama)' : 'open LM Studio and start its server (Developer tab, or `lms server start`)');
    else if (om.provider === 'ollama' && !isInstalled(om.model, r.names)) add('warn', `${label}: ${om.model} isn't installed in Ollama`, `ollama pull ${om.model}`);
    else add('ok', `${label}: ${app} is running${r.names.length ? ` (${r.names.length} model${r.names.length === 1 ? '' : 's'} installed)` : ''}`);
  }
  return out;
};

/**
 * agent.openModel: the stored defaults, the providers, and whether the provider's key is in the keyring
 * (`hasKey`, `key`: {account, stored, keyring, error}; never the key). `check` is accepted for older
 * callers: the keyring is always checked (it's cheap, and doesn't decrypt the key).
 */
adapter.settings = async function settings(ws, { env = process.env } = {}) {
  const stored = ws.config && ws.config.openModel;
  const openModel = normalize(stored);
  const effective = resolve(stored);
  const out = {
    openModel, configured: !!stored,
    effective: { provider: effective.provider, model: effective.model, baseUrl: effective.baseUrl, local: effective.local, keyAccount: effective.keyAccount, keyRequired: effective.keyRequired, error: effective.error },
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, local: p.local, baseUrl: p.baseUrl, keyRequired: !!p.keyRequired, defaultModel: p.defaultModel })),
    hasKey: false,
  };
  const k = effective.keyAccount ? await keyStatus(effective, env) : null;
  if (k) {
    out.key = k;
    out.hasKey = k.stored;
    if (k.stored && insecureKey(effective)) out.key.error = insecureKey(effective);
  }
  return out;
};

/**
 * agent.openModel.set / `trif agent open-model`: store the defaults in config.json `openModel` (merged with
 * what's there; '' clears a field). Throws on anything invalid. Never a key (see setKey).
 */
adapter.saveSettings = function saveSettings(home, input, { setConfigKey = require('../update').setConfigKey, readConfig = require('../paths').readConfig } = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const cur = normalize(readConfig(home).config.openModel);
  const next = { ...cur };
  if (i.provider !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, i.provider)) throw new Error(`unknown provider "${String(i.provider).slice(0, 40)}" (use: ${Object.keys(PROVIDERS).join(', ')})`);
    if (i.provider !== cur.provider) { next.model = ''; next.baseUrl = ''; } // another provider's choices don't carry over
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
  const stored = { provider: next.provider };
  for (const k of ['model', 'baseUrl']) if (next[k]) stored[k] = next[k];
  setConfigKey(home, 'openModel', stored);
  return normalize(stored);
};

/**
 * agent.openModel.setKey / `trif agent open-model --set-key`: save the API key for the stored provider
 * (and, for a custom one, its server) in the keyring. The key is never echoed back, logged or written
 * anywhere else; errors don't contain it. Resolves {account, keyring}.
 */
adapter.setKey = async function setKey(ws, key, { env = process.env } = {}) {
  const om = resolve(ws.config && ws.config.openModel);
  if (!om.keyAccount) {
    throw new Error(om.server ? `${om.name} runs without an API key: there's nothing to save`
      : 'set the custom server\'s address first: its key is saved for that server');
  }
  if (insecureKey(om)) throw new Error(insecureKey(om));
  const problem = keyring.keyProblem(key);
  if (problem) throw new Error(problem);
  await keyring.setKey(om.keyAccount, key, { env });
  const b = keyring.backend({ env });
  return { account: om.keyAccount, keyring: b ? b.name : null };
};

// The same Codex, so an organization's Codex requirements can replace TRIF's permission profile here too:
// stopped, or gone on with the user's consent for this agent (its own: `codex-oss`), as codex.js.
adapter.settingsName = codex.settingsName;
adapter.sandboxOverridden = codex.sandboxOverridden;
adapter.orgBlocked = codex.orgBlocked;
// (No "personal Codex login" in its messages: open models don't use one.)
Object.assign(adapter, codex.orgMessages({ personal: false }));

/**
 * agent.openModel.removeKey / `--remove-key`: forget the stored provider's key. Resolves {account, removed}.
 * A provider without keys (a local server) has none to forget: {account: null, removed: false}, not an
 * error (the README's uninstall steps run it whatever the provider).
 */
adapter.removeKey = async function removeKey(ws, { env = process.env } = {}) {
  const om = resolve(ws.config && ws.config.openModel);
  if (!om.keyAccount) return { account: null, removed: false };
  const r = await keyring.removeKey(om.keyAccount, { env });
  return { account: om.keyAccount, removed: r.removed };
};

module.exports = adapter;
