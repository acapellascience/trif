// Side panel settings for "Open model (via Codex)" (experimental; helper/lib/agents/codex-oss.js): where
// the model comes from (Ollama, LM Studio, OpenRouter, a custom URL), the server address for a custom one,
// and the NAME of the environment variable holding the API key (never the key). They're stored by the
// helper in ~/.trif/config.json `openModel` (agent.openModel / agent.openModel.set), as defaults the
// terminal's `trif agent run` shares; the model itself is picked in the panel's ordinary model picker.
// A run can also carry its own choice (agent.start `openModel`, same shape), for per-chat choices.

const AGENT = 'codex-oss';
const $ = (sel) => document.querySelector(sel);

let request = null;
let onProviderChange = () => {};
let data = null; // agent.openModel result
let loading = false;
let ui = null;

/** Wire the controls once. request: the panel's request(); onChange: after the provider changes. */
export function mountOpenModel({ request: req, onChange }) {
  request = req;
  onProviderChange = onChange || (() => {});
  ui = { box: $('#open-model'), provider: $('#om-provider'), urlRow: $('#om-url-row'), url: $('#om-url'), keyRow: $('#om-key-row'), key: $('#om-key'), note: $('#om-note') };
  if (!ui.box) return;
  ui.provider.addEventListener('change', () => save({ provider: ui.provider.value }, true));
  ui.url.addEventListener('change', () => save({ baseUrl: ui.url.value.trim() }));
  ui.key.addEventListener('change', () => save({ keyEnv: ui.key.value.trim() }));
}

async function load() {
  if (loading || !request) return;
  loading = true;
  try { data = await request({ type: 'agent.openModel', check: true }); data.error = null; } catch (e) { data = { error: String(e?.message ?? e) }; }
  loading = false;
  paint();
}

async function save(patch, providerChanged = false) {
  try {
    data = { ...(await request({ type: 'agent.openModel.set', ...patch })), error: null };
    paint();
    if (providerChanged) onProviderChange();
    load(); // whether the key variable is found
  } catch (e) {
    ui.note.textContent = String(e?.message ?? e);
    ui.note.classList.add('error');
    ui.note.hidden = false;
  }
}

/** Show the block when the chosen agent is the open model (and the helper is connected). */
export function renderOpenModel(agentId, connected) {
  if (!ui?.box) return;
  ui.box.hidden = agentId !== AGENT || !connected;
  if (ui.box.hidden) return;
  if (!data) load();
  paint();
}

function paint() {
  if (!ui?.box || ui.box.hidden) return;
  const om = data?.openModel;
  if (!om) {
    ui.note.textContent = data?.error ? `Couldn’t read the open model settings: ${data.error}` : '';
    ui.note.hidden = !data?.error;
    return;
  }
  const providers = data.providers || [];
  if (document.activeElement !== ui.provider) {
    ui.provider.replaceChildren(...providers.map((p) => new Option(p.label, p.id)));
    ui.provider.value = om.provider;
  }
  const p = providers.find((x) => x.id === om.provider) || {};
  ui.urlRow.hidden = om.provider !== 'custom';
  if (document.activeElement !== ui.url) ui.url.value = om.baseUrl || '';
  ui.keyRow.hidden = !!p.local;
  ui.key.placeholder = p.keyEnv || 'none';
  if (document.activeElement !== ui.key) ui.key.value = om.keyEnv || '';
  const k = data.key;
  let note = p.local
    ? `Runs on this computer: nothing leaves it. Small models are weaker at this than Claude Code or Codex.`
    : k ? (k.found ? `${k.name} found (${k.source === 'helper' ? 'in the helper’s environment' : 'in your shell profile'}). Your agent’s commands can’t see it.`
      : `${k.name} isn’t set: add export ${k.name}=… to ~/.zshrc. Only its name is stored here.`)
      : 'No key variable: fine if the server needs none.';
  ui.note.textContent = `Experimental. ${note}`;
  ui.note.classList.toggle('error', !!(k && !k.found));
  ui.note.hidden = false;
}
