// The robot view's More (branch ios-poc, Tim 11-16): the desktop side panel itself (mobile/shared/gen/panel, made by
// mobile/prepare.js from extension/sidepanel.html and the modules it imports, unchanged) in a web view of the app's
// (PanelChat.swift). This is the one thing added to it: what the panel gets on desktop from the extension's
// background (chrome.storage, chrome.tabs, its port) and, through it, from the helper (agent.list, agent.models,
// agent.start and the run's agentEvents), here from the app. A classic script, so it runs before the panel's modules.
//
// - chrome.storage.local: kept here, and in the app (each change saved there, a moment later: a file in
//   Application Support), so a site's chat (`chat:<site>`, as desktop's) is still there next time.
// - chrome.tabs: the one tab the app shows, as the panel's window's active tab; the app says when it changes.
// - The port: requests answered as background.js answers them, or by the app (window.webkit.messageHandlers.panel,
//   which answers each). A run's events come back from the app (window.__trifPanelEvent) and go into the chat as
//   background.js onAgentEvent puts them there, then to the panel as `agentEvent`s, so it shows them as on desktop.
// - API keys: a few lines of Settings the panel doesn't have (the engines' keys), added below. A key goes to the
//   app once, which keeps it in the Keychain; nothing here keeps it, and the app never sends it back.
//
// Words people see that the panel doesn't have are listed in docs/IOS-APP-STRINGS.md.
(function () {
  'use strict';
  const app = (msg) => window.webkit.messageHandlers.panel.postMessage(msg);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const event = () => {
    const fns = [];
    return { addListener: (f) => fns.push(f), removeListener: (f) => { const i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); }, hasListener: (f) => fns.includes(f), fire: (...a) => fns.slice().forEach((f) => { try { f(...a); } catch (e) { console.error('[TRIF] listener failed', e); } }) };
  };

  // ---- chrome.storage.local -------------------------------------------------------------------------------
  const store = (window.__trifPanelStore && typeof window.__trifPanelStore === 'object') ? window.__trifPanelStore : {};
  const changed = event();
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => app({ type: 'store', data: JSON.stringify(store) }).catch(() => {}), 300); };
  const pick = (keys) => {
    if (keys == null) return clone(store);
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) { const o = {}; for (const k of keys) if (k in store) o[k] = clone(store[k]); return o; }
    const o = {}; for (const [k, d] of Object.entries(keys)) o[k] = k in store ? clone(store[k]) : d; return o;
  };
  const local = {
    get: async (keys) => pick(keys),
    set: async (items) => {
      const changes = {};
      for (const [k, v] of Object.entries(items || {})) { changes[k] = { oldValue: clone(store[k]), newValue: clone(v) }; store[k] = clone(v); }
      saveSoon();
      setTimeout(() => changed.fire(changes, 'local'), 0);
    },
    remove: async (keys) => {
      const changes = {};
      for (const k of [].concat(keys)) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
      saveSoon();
      setTimeout(() => changed.fire(changes, 'local'), 0);
    },
  };

  // ---- chrome.tabs and chrome.windows: the app's shown tab -------------------------------------------------
  const WINDOW = 1;
  let tab = window.__trifPanelTab || { id: 1, url: '' };
  const asTab = () => ({ id: tab.id, url: tab.url, title: tab.title || '', active: true, windowId: WINDOW, status: 'complete' });
  const tabs = {
    onActivated: event(), onUpdated: event(), onRemoved: event(), onAttached: event(), onDetached: event(),
    query: async () => [asTab()],
    get: async () => asTab(),
    create: async ({ url } = {}) => { await app({ type: 'openTab', url: String(url || '') }); return asTab(); },
    update: async (id, props = {}) => { if (props.url) await app({ type: 'openTab', url: String(props.url) }); return asTab(); },
    reload: async () => { await app({ type: 'reloadTab' }); },
  };
  window.__trifPanelSetTab = (t) => {
    const other = t.id !== tab.id;
    tab = { id: t.id, url: t.url || '', title: t.title || '' };
    if (other) tabs.onActivated.fire({ tabId: tab.id, windowId: WINDOW });
    tabs.onUpdated.fire(tab.id, { url: tab.url, status: 'complete' }, asTab());
  };
  const windows = { getCurrent: async () => ({ id: WINDOW, focused: true }), get: async () => ({ id: WINDOW, focused: true }), update: async () => ({ id: WINDOW }), remove: async () => {}, onRemoved: event(), getAll: async () => [{ id: WINDOW }] };

  // ---- the background: its port, and what it answers ---------------------------------------------------------
  const ports = new Set();
  const post = (msg) => { for (const p of ports) p.onMessage.fire(clone(msg)); };
  let lib = null;
  const libReady = import('./lib.js').then((m) => { lib = m; });

  const runs = new Map(); // runId -> {site, agent, prompt, texts, errored, stopping}
  const chatKey = (site) => `chat:${site}`;
  const emptyChat = () => ({ sessionId: null, agent: null, messages: [], run: null, last: null });
  let chatQueue = Promise.resolve();
  /** chat:<site> read, changed by `fn` (false: leave it), and written back, one change at a time. */
  function updateChat(site, fn) {
    const p = chatQueue.then(async () => {
      const chat = (await local.get(chatKey(site)))[chatKey(site)] || emptyChat();
      if (fn(chat) === false) return;
      await local.set({ [chatKey(site)]: lib ? lib.capChat(chat) : chat });
    });
    chatQueue = p.catch(() => {});
    return p;
  }
  const toolLine = (name, summary) => (lib ? lib.toolLine(name, summary) : `${name} ${summary}`.trim());

  // (background.js onAgentEvent, for the kinds the app's runs send: their words as desktop's)
  async function onRunEvent(runId, ev) {
    post({ type: 'agentEvent', runId, event: ev });
    const run = runs.get(runId);
    if (!run || !ev || typeof ev !== 'object') return;
    if (ev.kind === 'done') runs.delete(runId);
    if (ev.kind === 'error') run.errored = true;
    if (ev.kind === 'text' && String(ev.text ?? '').trim()) run.texts++;
    const time = Date.now();
    await updateChat(run.site, (chat) => {
      if (chat.run?.runId !== runId) return false; // (cleared meanwhile)
      const push = (role, text) => chat.messages.push({ role, text: String(text), time });
      switch (ev.kind) {
        case 'session': if (ev.sessionId) { chat.sessionId = String(ev.sessionId); chat.agent = run.agent; } break;
        case 'text': if (String(ev.text ?? '').trim()) push('assistant', ev.text); else return false; break;
        case 'tool': push('tool', toolLine(ev.name, ev.summary)); break;
        case 'error': push('error', ev.message || 'Something went wrong.'); break;
        case 'done':
          if (ev.sessionId) { chat.sessionId = String(ev.sessionId); chat.agent = run.agent; }
          if (ev.ok && !run.texts && String(ev.result ?? '').trim()) push('assistant', ev.result);
          if (!ev.ok && !run.errored) { if (run.stopping) push('tool', 'stopped'); else push('error', String(ev.result ?? '').trim() || 'The agent stopped without finishing.'); }
          chat.last = { runId, ok: !!ev.ok, time, changedFiles: [], costUsd: null };
          chat.run = null;
          break;
        default: return false;
      }
    });
    if (ev.kind === 'done') post({ type: 'statusChanged' });
  }
  window.__trifPanelEvent = (runId, ev) => { onRunEvent(runId, ev).catch((e) => console.error('[TRIF] run event failed', e)); return true; };

  async function status() {
    await libReady;
    const site = lib.siteForUrl(tab.url || '');
    const scope = site ? lib.sensitiveSites({ list: null, hosts: [site] }).scopeOf(site) : null;
    const s = await app({ type: 'status' });
    return {
      ...s,
      helper: { connected: true }, userScripts: true, storageBroken: false,
      // (TRIF is on wherever the app goes: the app has no robot to turn off, and its mods are in the Mods tab)
      sitesOn: [scope, site].filter(Boolean), access: { all: true, allUrls: true, origins: ['<all_urls>'] }, blockedSites: [],
      mods: [], disabled: {}, offSites: {}, groupsOff: {}, lockedTabs: [], agentAsks: [], agentSites: {}, sensitiveSites: null,
      sensitive: { pending: [], splits: [] }, sensitiveBlocked: [], starter: null, update: null, paused: false, chatWait: false,
    };
  }

  async function startRun(msg) {
    await libReady;
    const site = String(msg.site || '');
    if (!site) throw new Error('missing site');
    const chat = (await local.get(chatKey(site)))[chatKey(site)] || emptyChat();
    if (chat.run) throw new Error(`already working on ${site}`);
    // (what the chat said before, for an engine that lost its session: the app was closed meanwhile)
    const said = chat.messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-20).map((m) => ({ role: m.role, text: String(m.text).slice(0, 8000) }));
    const { runId } = await app({ type: 'run.start', site, url: String(msg.url || tab.url || ''), prompt: String(msg.prompt || ''), sessionId: msg.sessionId || null, agent: msg.agent || null, model: msg.model || null, effort: msg.effort || null, said });
    runs.set(runId, { site, agent: msg.agent || null, prompt: msg.prompt, texts: 0, errored: false, stopping: false });
    await updateChat(site, (c) => {
      c.messages.push({ role: 'user', text: String(msg.prompt || ''), time: Date.now() });
      c.run = { runId, startedAt: Date.now(), agent: msg.agent || null };
    });
    app({ type: 'run.go', runId }).catch(() => {});
    return { runId };
  }

  async function clearChat(site) {
    for (const [id, r] of runs) if (r.site === site) { r.stopping = true; app({ type: 'run.stop', runId: id }).catch(() => {}); runs.delete(id); }
    await chatQueue;
    await local.remove(chatKey(site));
    return { cleared: true };
  }

  // What has nothing to do on the phone answers as if done (the panel asks for it as it starts).
  const QUIET = new Set(['panel.window', 'faces.scheme', 'siteAccess.noteSeen', 'update.dismiss', 'reconnect']);
  async function handle(msg) {
    switch (msg.type) {
      case 'status': return status();
      case 'agent.list': return app({ type: 'agent.list' });
      case 'agent.models': return app({ type: 'agent.models', agent: msg.agent, fresh: !!msg.fresh });
      case 'agent.start': return startRun(msg);
      case 'agent.stop': { const r = runs.get(msg.runId); if (r) r.stopping = true; return app({ type: 'run.stop', runId: msg.runId }); }
      case 'chat.clear': return clearChat(String(msg.site || ''));
      case 'chat.note': await updateChat(String(msg.site || ''), (c) => { c.messages.push({ role: 'tool', text: String(msg.text ?? ''), time: Date.now() }); }); return { noted: true };
      case 'instructions.get': return { text: '', file: '', max: 4000 };
      default:
        if (QUIET.has(msg.type)) return {};
        throw new Error('This isn’t in the iPhone app yet.');
    }
  }

  function connect() {
    const port = { name: 'panel', onMessage: event(), onDisconnect: event() };
    port.postMessage = (msg) => {
      const reqId = msg?.reqId;
      Promise.resolve().then(() => handle(msg)).then(
        (result) => { if (reqId) port.onMessage.fire({ type: 'reply', reqId, ok: true, result: clone(result) }); },
        (e) => { if (reqId) port.onMessage.fire({ type: 'reply', reqId, ok: false, error: String(e?.message ?? e) }); },
      );
    };
    port.disconnect = () => ports.delete(port);
    ports.add(port);
    return port;
  }

  window.chrome = {
    storage: { local, onChanged: changed },
    tabs, windows,
    runtime: {
      id: 'trif-iphone',
      // (as Safari's: the panel's words for a panel that isn't Chrome's side panel)
      getURL: (p) => (p ? new URL(p, location.href).href : 'safari-web-extension://trif-iphone/'),
      getManifest: () => ({ version: window.__trifPanelVersion || '0' }),
      connect, onMessage: event(), sendMessage: (msg) => handle(msg),
      lastError: undefined,
    },
    permissions: { request: async () => false, contains: async () => true, onAdded: event(), onRemoved: event() },
  };

  // ---- Settings: the engines' API keys (not in the panel: it has the open model's key only) -----------------
  // One row per engine that takes a key, under the agent: Saved (with Replace and Remove key), or a field and Save.
  const keysBox = () => document.getElementById('phone-keys');
  async function paintKeys() {
    const box = keysBox();
    if (!box) return;
    let keys;
    try { keys = (await app({ type: 'keys' })).keys || []; } catch (e) { return; }
    box.replaceChildren();
    const title = document.createElement('p');
    title.className = 'sites-title';
    title.textContent = 'API keys';
    box.append(title);
    for (const k of keys) box.append(keyRow(k));
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Each key is kept in this iPhone’s Keychain, only on this iPhone, and only sent to its own service.';
    box.append(note);
  }
  function keyRow(k) {
    const row = document.createElement('div');
    row.className = 'field phone-key';
    const label = document.createElement('span');
    label.textContent = k.name;
    const wrap = document.createElement('div');
    wrap.className = 'om-key';
    const btn = (text, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = text; b.addEventListener('click', onClick); return b; };
    const status = document.createElement('p');
    status.className = 'note';
    status.hidden = true;
    const say = (text, error) => { status.textContent = text; status.classList.toggle('error', !!error); status.hidden = !text; };
    const field = () => {
      const input = document.createElement('input');
      Object.assign(input, { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'Paste your key' });
      input.setAttribute('aria-label', `${k.name} API key`);
      const save = btn('Save', async () => {
        const key = input.value.trim();
        input.value = '';
        if (!key) return;
        save.disabled = true;
        say('Saving…');
        try { await app({ type: 'key.set', engine: k.id, key }); await afterKeys(); } catch (e) { save.disabled = false; say(`Couldn’t save the key: ${e?.message ?? e}`, true); }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
      wrap.replaceChildren(input, save);
      if (k.saved) wrap.append(btn('Cancel', () => paintKeys()));
    };
    if (k.saved) {
      const ok = document.createElement('span');
      ok.className = 'om-key-ok';
      ok.textContent = '✓ Saved';
      wrap.append(ok, btn('Replace', () => field()), btn('Remove key', async () => {
        say('Removing…');
        try { await app({ type: 'key.remove', engine: k.id }); await afterKeys(); } catch (e) { say(`Couldn’t remove the key: ${e?.message ?? e}`, true); }
      }));
    } else field();
    row.append(label, wrap);
    const out = document.createElement('div');
    out.append(row, status);
    if (k.where) { const w = document.createElement('p'); w.className = 'note'; w.textContent = k.where; out.append(w); }
    return out;
  }
  // (a key saved or removed: the panel lists its agents again, which it does each time Settings opens: closed and
  // opened again, so the agent's line and the notice follow at once)
  async function afterKeys() {
    await paintKeys();
    const b = document.getElementById('settings-btn');
    if (b && !document.getElementById('settings')?.hidden) { b.click(); b.click(); }
    post({ type: 'statusChanged' });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const settings = document.getElementById('settings');
    const anchor = document.getElementById('model-note');
    if (!settings || !anchor) return;
    const box = document.createElement('div');
    box.id = 'phone-keys';
    box.className = 'phone-keys';
    (document.getElementById('effort-row') || anchor).after(box);
    paintKeys();
  });
})();
