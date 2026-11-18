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
  // (the app asks the paired computer, if any, for runs it kept for this iPhone: PanelChat.pickUpKept)
  libReady.then(() => app({ type: 'link.pickUp' })).catch(() => {});

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
  // A run the app took up that this page didn't start (My computer's, kept while the app was closed): its chat's
  // run from now on, unless that chat is busy with one of this page's. True when it took it.
  window.__trifPanelAdopt = async (runId, site, agent) => {
    await libReady;
    if (!site || runs.has(runId) || [...runs.values()].some((r) => r.site === site)) return false;
    runs.set(runId, { site, agent: agent || null, prompt: '', texts: 0, errored: false, stopping: false });
    // (a run still marked in the chat is one from before the app closed, which nothing follows any more)
    await updateChat(site, (c) => { c.run = { runId, startedAt: Date.now(), agent: agent || null }; });
    post({ type: 'statusChanged' });
    return true;
  };
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
      case 'agent.models': {
        const r = await app({ type: 'agent.models', agent: msg.agent, fresh: !!msg.fresh });
        // (OpenRouter's: the phone's own picker, below; the panel's select stays, hidden, for what it shows elsewhere)
        lists[msg.agent] = r;
        setTimeout(paintPicker, 0);
        return r;
      }
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
  // (a key saved or removed, a model ready: the panel lists its agents again, which it does each time Settings opens:
  // opened and closed again in one go (closed, then opened, while it shows), so the agent's line and the notice follow)
  async function afterKeys() {
    await paintKeys();
    const b = document.getElementById('settings-btn');
    if (b) { b.click(); b.click(); }
    post({ type: 'statusChanged' });
  }
  // ---- Settings: My computer (the phone link's engine): paired or not, and the way to its screen (pairing, Forget) --
  const linkBox = () => document.getElementById('phone-link');
  async function paintLink() {
    const box = linkBox();
    if (!box) return;
    let st;
    try { st = await app({ type: 'link.status' }); } catch (e) { return; }
    box.replaceChildren(el('p', 'sites-title', 'My computer'));
    const line = el('p', 'note', st.paired ? `Paired with ${st.name}. Its coding agent makes the mod.` : 'Your coding agent on your computer can make mods here. Pair this iPhone with TRIF on your computer first.');
    box.append(line, btn(st.paired ? 'My computer…' : 'Pair with my computer…', () => app({ type: 'link.open' }).catch(() => {})));
  }
  window.__trifPanelLinkChanged = () => { paintLink().then(afterKeys); return true; };

  // ---- The models that run on this iPhone (On this iPhone's): Settings' block, and a bar over the chat ------------
  // (11-16, Tim: a download he started showed him nothing he could see. Now: in Settings, each model with a real bar,
  // "{MB} of {MB}", its speed and time left, Pause and Cancel; over the chat, while On this iPhone is the chat's
  // agent and its model is on its way, the same in a slim bar, in place of the "isn't logged in" notice; and when it
  // ends, a note: ready, or why not. Looked at again each second while one is on its way (and whenever the app says
  // something changed), whether Settings is open or not.)
  let modelsTimer = null;
  let asking = null; // the model whose download is being asked about
  const startErrors = {}; // why a start was refused, by model, until the next try
  let lastModels = null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, onClick) => { const b = el('button', 'btn', text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const going = (m) => !m.hidden && (m.state === 'downloading' || m.state === 'checking');
  /** "{done} of {total} · {speed} · {left} left" */
  const numbers = (m) => [m.done && m.total ? `${m.done} of ${m.total}` : '', m.speed || '', m.left ? `${m.left} left` : ''].filter(Boolean).join(' · ');
  function bar(m) {
    const b = el('div', 'phone-bar');
    b.setAttribute('role', 'progressbar');
    b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', '100');
    const pct = Math.round((m.progress || 0) * 100);
    b.setAttribute('aria-valuenow', String(pct));
    b.setAttribute('aria-label', `${m.name}: ${pct}%`);
    const fill = el('span');
    fill.style.width = `${Math.max(2, pct)}%`;
    b.append(fill);
    return b;
  }
  async function act(msg) {
    delete startErrors[msg.model];
    try { await app(msg); } catch (e) { startErrors[msg.model] = String(e?.message ?? e); }
    refreshModels();
  }
  /** The state of a model's download, as words, and its buttons (Settings and the chat's bar alike). */
  function stateLine(m, line) {
    const say = (t) => line.append(el('span', 'model-state', t), ' ');
    if (m.state === 'downloading') {
      say(`Downloading… ${Math.round((m.progress || 0) * 100)}%`);
      line.append(btn('Pause', () => act({ type: 'local.pause', model: m.id })), ' ', btn('Cancel', () => act({ type: 'local.delete', model: m.id })));
    } else if (m.state === 'paused') {
      say(`Paused${m.why ? `: ${m.why}` : ''}`);
      line.append(btn('Resume', () => act({ type: 'local.download', model: m.id })), ' ', btn('Cancel', () => act({ type: 'local.delete', model: m.id })));
    } else if (m.state === 'checking') {
      say('Checking it…');
    } else if (m.state === 'failed') {
      say(`Couldn’t download it: ${m.why}.`);
      line.append(btn('Try again', () => act({ type: 'local.download', model: m.id })));
    }
  }
  function paintSettings(st) {
    const box = document.getElementById('phone-models');
    if (!box) return;
    box.replaceChildren(el('p', 'sites-title', 'Model on this iPhone'), el('p', 'note', st.memory));
    // (where it runs: the processor (smoother: the phone stays usable) or the graphics chip (faster, but the phone may
    // stutter while it works); 11-16, Tim's SE froze, so the processor is the default and the two can be compared)
    const runRow = el('label', 'field');
    runRow.append(el('span', null, 'Runs on'));
    const sel = document.createElement('select');
    sel.append(new Option('Processor (smoother)', 'cpu'), new Option('Graphics chip (faster, may stutter)', 'gpu'));
    sel.value = st.gpu ? 'gpu' : 'cpu';
    sel.addEventListener('change', () => { app({ type: 'local.gpu', on: sel.value === 'gpu' }).then(refreshModels, () => {}); });
    runRow.append(sel);
    box.append(runRow);
    const check = (text, on, type) => {
      const l = el('label', 'check phone-check');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!on;
      c.addEventListener('change', () => { app({ type, on: c.checked }).then(refreshModels, () => {}); });
      l.append(c, ' ', text);
      return l;
    };
    // (a 4 GB phone: the bigger model only when asked for; Tim, 11-16)
    if (st.smallPhone) box.append(check('Show bigger models (may be slow on this iPhone)', st.showBigger, 'local.bigger'));
    // (the 4B model: whole mods, boxed ones too, when picked; style mods as JSON otherwise)
    if (st.models.some((m) => m.id === 'qwen35-4b' && !m.hidden)) box.append(check('Qwen3.5 4B: boxed mods too (experimental)', st.boxed, 'local.boxed'));
    for (const m of st.models) {
      if (m.hidden) continue;
      const row = el('div', 'phone-model');
      row.dataset.model = m.id;
      row.append(el('p', 'model-name', `${m.name} · ${m.size}${m.suggested ? ' · suggested for this iPhone' : ''}`));
      row.append(el('p', 'note', m.fits ? m.note : `${m.note} This iPhone has too little memory for it.`));
      if (m.state === 'downloading' || m.state === 'paused') { row.append(bar(m)); const n = numbers(m); if (n) row.append(el('p', 'note model-numbers', n)); if (m.stalled) row.append(el('p', 'note', m.stalled)); }
      const line = el('p', 'actions');
      if (asking === m.id && m.state === 'none') {
        line.append(el('span', 'model-state', `Download ${m.size}? Best on Wi-Fi; it goes on in the background.`), ' ');
        line.append(btn('Download', () => { asking = null; act({ type: 'local.download', model: m.id }); }), ' ', btn('Cancel', () => { asking = null; refreshModels(); }));
      } else if (m.state === 'none') {
        if (m.fits) line.append(btn('Download', () => { asking = m.id; refreshModels(); }));
      } else if (m.state === 'ready') {
        line.append(el('span', 'model-state', '✓ On this iPhone'), ' ', btn('Delete', () => act({ type: 'local.delete', model: m.id })));
      } else stateLine(m, line);
      row.append(line);
      if (startErrors[m.id]) row.append(el('p', 'note error', `Couldn’t start it: ${startErrors[m.id]}`));
      else if (m.noteText && (m.noteKind === 'waiting' || m.noteAge < 30)) row.append(el('p', `note ${m.noteKind === 'failed' ? 'error' : ''}`, m.noteText));
      box.append(row);
    }
  }
  /** The chat's agent is On this iPhone (the line over the message box says so). */
  const onPhone = () => /^On this iPhone\b/.test(document.getElementById('using')?.textContent || '');
  function paintChatBar(st) {
    let top = document.getElementById('phone-download');
    if (!top) {
      top = el('section', 'phone-download');
      top.id = 'phone-download';
      top.hidden = true;
      document.querySelector('header.bar')?.after(top);
    }
    // (the model the chat will use: one on its way first, else the latest one to end, for its note)
    const m = st.models.find((x) => !x.hidden && (going(x) || x.state === 'paused')) || st.models.find((x) => x.noteText && x.noteAge < 12 && x.noteKind !== 'waiting');
    const show = !!m && onPhone();
    top.hidden = !show;
    document.body.classList.toggle('phone-downloading', show && (going(m) || m.state === 'paused'));
    if (!show) { top.replaceChildren(); return; }
    top.replaceChildren();
    if (going(m) || m.state === 'paused') {
      top.append(el('p', 'phone-download-title', `${m.state === 'checking' ? 'Checking' : m.state === 'paused' ? 'Paused:' : 'Downloading'} ${m.name} to this iPhone`), bar(m));
      const n = numbers(m);
      if (n) top.append(el('p', 'note model-numbers', n));
      if (m.stalled) top.append(el('p', 'note', m.stalled));
      else if (m.noteKind === 'waiting' && m.noteText) top.append(el('p', 'note', m.noteText));
      const line = el('p', 'actions');
      stateLine(m, line);
      top.append(line);
    } else {
      top.append(el('p', m.noteKind === 'failed' ? 'note error' : 'phone-download-title', m.noteText));
    }
  }
  async function refreshModels() {
    let st;
    try { st = await app({ type: 'local.models' }); } catch (e) { return; }
    const ready = st.models.filter((m) => m.state === 'ready').map((m) => m.id).join(',');
    const was = lastModels ? lastModels.models.filter((m) => m.state === 'ready').map((m) => m.id).join(',') : ready;
    lastModels = st;
    paintSettings(st);
    paintChatBar(st);
    // (a model ready or gone: the panel lists its agents again, so "isn't logged in" goes, or comes)
    if (was !== ready) afterKeys();
    clearTimeout(modelsTimer);
    if (st.models.some((m) => going(m) || (m.noteText && m.noteAge < 30))) modelsTimer = setTimeout(refreshModels, 1000);
  }
  window.__trifPanelModelsChanged = () => { refreshModels(); return true; };

  // ---- OpenRouter's models: a short list first (Tim, 11-18: "the Models list is endless") -------------------------
  // Recommended (the app's small table, OpenRouterModels.swift), Recent (the ones run), then All models behind a
  // search field, by maker, Auto at the top. Each with its price and context, small. A tap picks it through the
  // panel's own select (hidden here), so the panel saves it and shows it as ever. Only for OpenRouter: the other
  // engines keep the panel's select, and desktop's panel never has this file.
  const lists = {};
  let allOpen = false;
  let query = '';
  const OTHER = '__other__';
  function paintPicker() {
    const agent = document.getElementById('agent');
    const sel = document.getElementById('model');
    const row = document.getElementById('model-row');
    const list = lists.openrouter;
    let box = document.getElementById('phone-or');
    const on = !!(agent && sel && row && agent.value === 'openrouter' && list && list.phone);
    document.body.classList.toggle('phone-or-on', on);
    if (!on) { box?.remove(); row?.querySelector('.phone-or-current')?.remove(); return; }
    const byId = new Map((list.models || []).map((m) => [m.id, m]));
    const auto = list.phone.auto;
    const chosen = sel.value === '' ? auto : sel.value;
    let cur = row.querySelector('.phone-or-current');
    if (!cur) { cur = el('span', 'phone-or-current'); row.append(cur); }
    cur.textContent = chosen === OTHER ? 'Other…' : byId.get(chosen)?.name || chosen;
    if (!box) { box = el('div', 'phone-or'); box.id = 'phone-or'; row.after(box); }
    box.replaceChildren();
    const pick = (id) => {
      sel.value = id === auto ? '' : id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(paintPicker, 0);
    };
    const item = (m) => {
      const b = el('button', 'phone-or-row');
      b.type = 'button';
      b.dataset.model = m.id;
      b.setAttribute('aria-pressed', String(m.id === chosen));
      const top = el('span', 'phone-or-name', m.name);
      if (m.free) top.append(' ', el('span', 'phone-or-free', 'Free'));
      b.append(top);
      if (m.description) b.append(el('span', 'phone-or-line', m.description));
      b.addEventListener('click', () => pick(m.id));
      return b;
    };
    const section = (title, ids) => {
      const ms = ids.map((id) => byId.get(id)).filter(Boolean);
      if (!ms.length) return;
      box.append(el('p', 'phone-or-title', title), ...ms.map(item));
    };
    section('Recommended', list.phone.recommended || []);
    section('Recent', list.phone.recent || []);
    const total = (list.models || []).length;
    const toggle = btn(allOpen ? 'Hide all models' : `All models (${total})`, () => { allOpen = !allOpen; if (!allOpen) query = ''; paintPicker(); });
    toggle.classList.add('phone-or-all');
    toggle.setAttribute('aria-expanded', String(allOpen));
    box.append(toggle);
    if (!allOpen) return;
    const search = el('input');
    Object.assign(search, { type: 'search', id: 'phone-or-search', placeholder: 'Search models', autocomplete: 'off', spellcheck: false, value: query });
    search.setAttribute('aria-label', 'Search models');
    box.append(search);
    const results = el('div', 'phone-or-results');
    const fill = () => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (m) => { const t = `${m.name} ${m.id} ${m.maker || ''} ${m.free ? 'free' : ''}`.toLowerCase(); return words.every((w) => t.includes(w)); };
      results.replaceChildren();
      if (byId.get(auto) && hits(byId.get(auto))) results.append(item(byId.get(auto)));
      let n = 0;
      for (const g of list.phone.groups || []) {
        const ms = g.ids.map((id) => byId.get(id)).filter((m) => m && hits(m));
        if (!ms.length) continue;
        n += ms.length;
        results.append(el('p', 'phone-or-maker', g.maker), ...ms.map(item));
      }
      if (!n && words.length) results.append(el('p', 'note', 'No model matches.'));
    };
    fill();
    box.append(results);
    // (only the results change as the person types: the field and its keyboard stay)
    search.addEventListener('input', () => { query = search.value; fill(); });
  }

  // The quick ask's red note tapped (ClaudePane.quickOpen): More's Settings, at what needs doing there.
  window.__trifPanelShowSettings = (what) => {
    const settings = document.getElementById('settings');
    if (settings && settings.hidden) document.getElementById('settings-btn')?.click();
    const target = { model: 'model-row', key: 'phone-keys', iphone: 'phone-models', computer: 'phone-link' }[what];
    setTimeout(() => {
      let n = target && document.getElementById(target);
      // (no model row while robotless: the agent's, where one is picked)
      if (n && n.hidden) n = document.getElementById('agent')?.closest('label') || n;
      if (n) n.scrollIntoView({ block: 'start' });
      if (what === 'model') document.getElementById('phone-or')?.classList.add('phone-or-flash');
    }, 120);
    return !!settings;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const settings = document.getElementById('settings');
    const anchor = document.getElementById('model-note');
    if (!settings || !anchor) return;
    const link = document.createElement('div');
    link.id = 'phone-link';
    link.className = 'phone-keys';
    (document.getElementById('effort-row') || anchor).after(link);
    const box = document.createElement('div');
    box.id = 'phone-keys';
    box.className = 'phone-keys';
    link.after(box);
    const models = document.createElement('div');
    models.id = 'phone-models';
    models.className = 'phone-keys';
    box.after(models);
    paintLink();
    paintKeys();
    refreshModels();
    document.getElementById('agent')?.addEventListener('change', () => setTimeout(paintPicker, 0));
    // (Settings opened, the chat's agent changed: the models' state looked at again)
    document.getElementById('settings-btn')?.addEventListener('click', () => setTimeout(() => { refreshModels(); paintLink(); }, 50));
    new MutationObserver(() => { if (lastModels) paintChatBar(lastModels); }).observe(document.getElementById('using') || document.body, { childList: true, characterData: true, subtree: true });
  });
})();
