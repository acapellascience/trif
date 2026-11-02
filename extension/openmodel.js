// Side panel settings for "Open model (via Codex)" (experimental; helper/lib/agents/codex-oss.js): where
// the model comes from (Ollama, LM Studio, OpenRouter, a custom URL), the server address for a custom one,
// and, for hosted providers, the API key. Settings are stored by the helper in ~/.trif/config.json
// `openModel` (agent.openModel / agent.openModel.set), global (every site's chat, and the terminal's
// `trif agent run`); the model itself is picked per site chat in the panel's ordinary model picker. Model
// picks belong to a provider, so when the provider changes (here, or from the terminal: `ossProvider` in
// storage remembers the one they were made for) every stored codex-oss model pick is dropped
// (onProviderChange) and each chat falls back to the new provider's default.
//
// The API key: typed (pasted) into a password field and sent once to the helper
// (agent.openModel.setKey), which keeps it in the system keyring (the macOS Keychain) and never sends it
// back. It's in no storage here, no log and no message but that one; the field is emptied once it's sent,
// whatever the answer. The panel only learns whether a key is saved (`hasKey`).

const AGENT = 'codex-oss';
const $ = (sel) => document.querySelector(sel);

let request = null;
let onProviderChange = () => {};
let data = null; // agent.openModel result
let loading = false;
let busy = false; // saving or removing the key
let ui = null;

/** Wire the controls once. request: the panel's request(); onChange: after the provider changes. */
export function mountOpenModel({ request: req, onChange }) {
  request = req;
  onProviderChange = onChange || (() => {});
  ui = {
    box: $('#open-model'), provider: $('#om-provider'), urlRow: $('#om-url-row'), url: $('#om-url'),
    keyRow: $('#om-key-row'), key: $('#om-key'), keySave: $('#om-key-save'), keyRemove: $('#om-key-remove'), keyStatus: $('#om-key-status'),
    note: $('#om-note'),
  };
  if (!ui.box) return;
  ui.provider.addEventListener('change', () => save({ provider: ui.provider.value }, true));
  ui.url.addEventListener('change', () => save({ baseUrl: ui.url.value.trim() }));
  ui.keySave.addEventListener('click', () => saveKey());
  ui.key.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } });
  ui.key.addEventListener('input', () => paintKey());
  ui.keyRemove.addEventListener('click', () => removeKey());
}

async function load() {
  if (loading || !request) return;
  loading = true;
  try { data = await request({ type: 'agent.openModel' }); data.error = null; } catch (e) { data = { error: String(e?.message ?? e) }; }
  loading = false;
  paint();
  if (data?.openModel) await syncProvider(data.openModel.provider);
}

// The provider the stored model picks were made for. Another one now (changed here or in the terminal):
// the picks are dropped (they name the old provider's models).
// (Changed here: dropped whatever was remembered. Not remembered yet: nothing to compare with.)
async function syncProvider(provider, changedHere = false) {
  let was;
  try { was = (await chrome.storage.local.get('ossProvider')).ossProvider; } catch { return; }
  if (was === provider && !changedHere) return;
  await chrome.storage.local.set({ ossProvider: provider }).catch(() => {});
  if (changedHere || was !== undefined) await onProviderChange();
}

function showError(message) {
  ui.note.textContent = message;
  ui.note.classList.add('error');
  ui.note.hidden = false;
}

async function save(patch, providerChanged = false) {
  try {
    data = { ...(await request({ type: 'agent.openModel.set', ...patch })), error: null };
    paint();
    if (providerChanged) await syncProvider(data.openModel.provider, true);
  } catch (e) {
    showError(String(e?.message ?? e));
  }
}

// The key: sent once, then the field is emptied (on success or failure), so it's never kept here.
async function saveKey() {
  const key = ui.key.value.trim();
  if (!key || busy) return;
  ui.key.value = '';
  busy = true;
  paintKey('Saving…');
  try {
    data = { ...(await request({ type: 'agent.openModel.setKey', key })), error: null };
    busy = false;
    paint();
  } catch (e) {
    busy = false;
    paint();
    paintKey(`Couldn’t save the key: ${String(e?.message ?? e)}`, true);
  }
}

async function removeKey() {
  if (busy) return;
  busy = true;
  paintKey('Removing…');
  try {
    data = { ...(await request({ type: 'agent.openModel.removeKey' })), error: null };
    busy = false;
    paint();
  } catch (e) {
    busy = false;
    paint();
    paintKey(`Couldn’t remove the key: ${String(e?.message ?? e)}`, true);
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

// The key row's status line: whether a key is saved (or `message`: saving, removing, an error).
function paintKey(message, isError = false) {
  if (!ui?.box) return;
  if (ui.keyRow.hidden) { ui.keyStatus.hidden = true; return; }
  const k = data?.key;
  const stored = !!data?.hasKey;
  ui.keySave.disabled = busy || !ui.key.value.trim();
  ui.keyRemove.disabled = busy;
  ui.keyRemove.hidden = !stored;
  ui.key.placeholder = stored ? 'Paste a new key to replace it' : 'Paste your key';
  let text = message;
  let error = isError;
  if (!text) {
    if (k?.error) { text = k.error; error = true; }
    else if (stored) text = `Key saved in ${k?.keyring || 'the system keyring'}. TRIF adds it to the model requests itself: neither Codex nor your agent’s commands are given it.`;
    else if (data?.effective?.keyRequired) { text = `No key yet: paste your OpenRouter API key, then Save. It’s kept in ${k?.keyring || 'the system keyring'}, not in TRIF’s files.`; error = true; }
    else text = 'No key yet: fine if the server needs none.';
  }
  ui.keyStatus.textContent = text;
  ui.keyStatus.classList.toggle('error', error);
  ui.keyStatus.hidden = false;
}

function paint() {
  if (!ui?.box || ui.box.hidden) return;
  const om = data?.openModel;
  if (!om) {
    ui.note.textContent = data?.error ? `Couldn’t read the open model settings: ${data.error}` : '';
    ui.note.hidden = !data?.error;
    ui.keyRow.hidden = true;
    ui.keyStatus.hidden = true;
    return;
  }
  const providers = data.providers || [];
  if (document.activeElement !== ui.provider) {
    ui.provider.replaceChildren(...providers.map((p) => new Option(p.label, p.id)));
    ui.provider.value = om.provider;
  }
  // (`effective.local`: a local provider at a loopback address. Pointed at another computer, it isn't.)
  const local = !!data.effective?.local;
  ui.urlRow.hidden = om.provider !== 'custom';
  if (document.activeElement !== ui.url) ui.url.value = om.baseUrl || '';
  // A key for hosted providers only (OpenRouter; a custom server once its address is set: keys are per server).
  ui.keyRow.hidden = !data.effective?.keyAccount;
  paintKey();
  const problem = data.effective?.error || '';
  const note = problem || (local ? 'Runs on this computer: nothing leaves it. Small models are weaker at this than Claude Code or Codex.'
    : om.provider === 'custom' && !data.effective?.keyAccount ? 'Set the server address first; then you can save an API key for it (if it needs one).' : '');
  ui.note.textContent = `Experimental.${note ? ` ${note}` : ''}`;
  ui.note.classList.toggle('error', !!problem);
  ui.note.hidden = false;
}
