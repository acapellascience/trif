// The homepage demo's stand-in for the TRIF extension, loaded before the real side panel's scripts (the
// Worker adds it to the extension's own sidepanel.html; see site/src/demo.js). It provides the chrome.*
// calls the panel makes and answers the panel's port messages the way extension/background.js does, from
// made-up state: the helper is connected, Claude Code is logged in, the tab shows timsrobot.com, and the
// robot is on there. No mods at first (just the ones the page's address runs): each of the home page mods
// TRIF ships turns up in the list, on, once the recorded chat that made it has played, in TRIF's order.
//
// What really happens:
// - A mod switch (or the robot) reloads the home page the panel is docked to with the mods that are on
//   (tab.js loads /?mods=…, and the Worker adds only mods from its bundled list). The panel opens again
//   after the reload, and this picks up where it was from sessionStorage (the chat, the switches, settings,
//   a replay in progress).
// - Chats are recordings: the next recording's prompt waits in the message box (which can't be typed in),
//   and Send replays that session, sped up, then switches its mod on. (Anything else that reaches it gets
//   a note saying this demo only replays recordings.)
// Nothing leaves the page: no messages to a helper, no keys kept, nothing stored but this tab's
// sessionStorage.
//
// The Worker serves this as (function (DEMO) {…})(<the mod list, recorded chats and words>).

(function (DEMO) {
  'use strict';

  const SITE = 'timsrobot.com';
  const REPO = 'https://github.com/acapellascience/trif';
  const EXTENSION_ID = 'iaablflfafmonebdomeikadolkgdbkhe';
  const TAB = { id: 7, windowId: 1, index: 0, active: true, status: 'complete', url: `https://${SITE}/`, title: "Tim's Robot Internet Fixer" };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const later = (fn, ms = 0) => setTimeout(fn, ms);

  function event() {
    const fns = new Set();
    return {
      addListener: (fn) => fns.add(fn),
      removeListener: (fn) => fns.delete(fn),
      hasListener: (fn) => fns.has(fn),
      emit: (...args) => { for (const fn of [...fns]) { try { fn(...args); } catch (e) { console.error(e); } } },
    };
  }

  // ---- the manifest: the real one, served next to the panel ---------------------------------------

  let manifest = { manifest_version: 3, name: "Tim's Robot Internet Fixer", version: '' };
  const manifestReady = fetch('manifest.json').then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m && typeof m.version === 'string') manifest = m; }, () => {});

  // ---- chrome.storage.local, in memory ------------------------------------------------------------

  const store = new Map();
  const onChanged = event();
  function setNow(obj) {
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      changes[k] = { oldValue: clone(store.get(k)), newValue: clone(v) };
      store.set(k, clone(v));
    }
    persist();
    later(() => onChanged.emit(changes, 'local'));
  }
  const local = {
    async get(keys) {
      const list = keys == null ? [...store.keys()] : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) {
        if (store.has(k)) out[k] = clone(store.get(k));
        else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
      }
      return out;
    },
    async set(obj) { setNow(obj); },
    async remove(keys) {
      const changes = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (!store.has(k)) continue;
        changes[k] = { oldValue: clone(store.get(k)) };
        store.delete(k);
      }
      persist();
      later(() => onChanged.emit(changes, 'local'));
    },
    async clear() { await local.remove([...store.keys()]); },
  };

  // ---- the made-up state --------------------------------------------------------------------------

  const state = {
    sitesOn: [SITE],
    mods: [], // listed (in the background's order: by file name)
    trash: new Map(),
    instructions: '',
    autoUpdate: false,
    openModel: { provider: 'ollama', model: '', baseUrl: '' },
    runs: new Map(),
    replayed: new Set(), // recorded chats played to the end
    active: null,        // the run going: {runId, chat (recording id, or null for the demo's note), step}
  };

  // ---- across the page's reloads: this tab's sessionStorage ---------------------------------------

  const SAVED = 'trif-demo-state';
  let restoring = true;
  function persist() {
    if (restoring) return;
    const out = {
      v: 1, store: Object.fromEntries(store), sitesOn: state.sitesOn, mods: state.mods.map((m) => m.slug), trash: [...state.trash.values()].map((m) => m.slug),
      instructions: state.instructions, autoUpdate: state.autoUpdate, openModel: state.openModel, replayed: [...state.replayed],
      active: state.active, runSeq,
    };
    try { sessionStorage.setItem(SAVED, JSON.stringify(out)); } catch { /* private window: lasts until the reload */ }
  }
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SAVED) || 'null'); } catch {}
  const bySlug = new Map(DEMO.mods.map((m) => [m.slug, m]));
  let runSeq = 0;
  if (saved?.v === 1) {
    for (const [k, v] of Object.entries(saved.store || {})) store.set(k, v);
    state.sitesOn = Array.isArray(saved.sitesOn) ? saved.sitesOn.filter((x) => x === SITE) : [SITE];
    state.mods = (saved.mods || []).filter((x) => bySlug.has(x)).map((x) => ({ ...bySlug.get(x) }));
    state.trash = new Map((saved.trash || []).filter((x) => bySlug.has(x)).map((x) => [bySlug.get(x).id, { ...bySlug.get(x) }]));
    state.instructions = String(saved.instructions || '');
    state.autoUpdate = !!saved.autoUpdate;
    if (saved.openModel?.provider) state.openModel = saved.openModel;
    state.replayed = new Set(saved.replayed || []);
    state.active = saved.active || null;
    runSeq = Number(saved.runSeq) || 0;
  } else {
    // First time: only the mods running on the page (its ?mods=), on.
    let running = new Set();
    try { running = new Set(new URLSearchParams(window.parent.location.search).get('mods')?.split(',') || []); } catch {}
    state.mods = DEMO.mods.filter((m) => running.has(m.slug)).map((m) => ({ ...m }));
    store.set('disabled', {});
  }
  // The panel lists the mods in the order TRIF ships them in until the visitor drags them (as the helper's
  // defaultOrder does for the real extension); the visitor's own order (modOrder) lives in `store`.
  store.set('defaultOrder', { [SITE]: (DEMO.order || []).slice() });
  restoring = false;
  persist();

  const disabled = () => store.get('disabled') || {};
  const siteOn = () => state.sitesOn.includes(SITE);
  const findMod = (id) => state.mods.find((m) => m.id === id);
  const fileOf = (m) => `~/.trif/sites/${SITE}/${m.slug}.js`;

  /** Load the page again with the mods that run there now (tab.js does it; this panel comes back after). */
  function loadPage() {
    const mods = siteOn() ? state.mods.filter((m) => !disabled()[m.id]).map((m) => m.slug) : [];
    persist();
    if (window.parent !== window) window.parent.postMessage({ type: 'trif-demo:load', mods }, location.origin);
  }

  async function status() {
    await manifestReady;
    const off = disabled();
    const v = manifest.version;
    return {
      helper: { connected: true, error: null },
      userScripts: true, settingsUrl: `chrome://extensions/?id=${EXTENSION_ID}`, version: v, chrome: '142.0.7444.60', browser: 'Chrome',
      recording: [], sitesOn: state.sitesOn.slice(),
      update: { current: v, latest: v, available: false, canInstall: true, auto: state.autoUpdate, source: 'npm', notes: '', installing: false, error: null },
      mods: state.mods.map((m) => ({
        id: m.id, name: m.name, description: m.description, site: SITE, file: fileOf(m), matches: m.matches, excludes: [],
        registered: siteOn() && !off[m.id], enabled: !off[m.id], error: null, held: null, risk: m.risk, from: null,
        source: null, version: null, update: null,
      })),
      runs: [...state.runs.keys()].map((runId) => ({ runId, site: SITE })),
    };
  }

  // ---- agents -------------------------------------------------------------------------------------

  const AGENTS = {
    agents: [
      { id: 'claude', name: 'Claude Code', path: '~/.local/bin/claude', available: true, version: '2.1.30', note: '', canLogin: true, loginFix: 'run `claude` in a terminal and log in (type /login)', loggedIn: true },
      { id: 'codex', name: 'Codex', path: '/opt/homebrew/bin/codex', available: true, version: '0.80.0', note: '', canLogin: true, loginFix: 'run `codex login` in a terminal', loggedIn: true },
      { id: 'codex-oss', name: 'Open model (via Codex)', path: '/opt/homebrew/bin/codex', available: true, version: '0.80.0', note: '', canLogin: false, loginFix: '', experimental: true, loggedIn: null },
    ],
    default: 'claude',
  };
  const PROVIDERS = [
    { id: 'ollama', label: 'Ollama (on this computer)', local: true, baseUrl: 'http://127.0.0.1:11434/v1', keyRequired: false, defaultModel: 'gpt-oss:20b' },
    { id: 'lmstudio', label: 'LM Studio (on this computer)', local: true, baseUrl: 'http://127.0.0.1:1234/v1', keyRequired: false, defaultModel: 'openai/gpt-oss-20b' },
    { id: 'openrouter', label: 'OpenRouter', local: false, baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true, defaultModel: 'openai/gpt-oss-120b' },
    { id: 'custom', label: 'Custom URL (OpenAI-compatible)', local: false, baseUrl: '', keyRequired: false, defaultModel: '' },
  ];

  function models(agent) {
    if (agent === 'claude') {
      return { agent, models: [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([id, name]) => ({ id, name: `${name} (newest)`, description: '' })),
        default: null, custom: true, error: null,
        note: "Claude Code can't say which models your account has. Each name is the newest of its family; use Other for an exact model name." };
    }
    if (agent === 'codex') return { agent, models: [], default: null, custom: true, error: null, note: DEMO.words.codexModels };
    if (agent === 'codex-oss') {
      const p = state.openModel.provider;
      if (p === 'openrouter') return { agent, models: [{ id: 'openai/gpt-oss-120b', name: 'gpt-oss-120b', description: '' }, { id: 'qwen/qwen3-coder', name: 'Qwen3-Coder 480B', description: '' }], default: 'openai/gpt-oss-120b', custom: true, error: null, note: '' };
      if (p === 'custom') return { agent, models: [], default: null, custom: true, error: null, note: `Type the model name ${state.openModel.baseUrl || 'your server'} expects.` };
      return { agent, models: [{ id: 'gpt-oss:20b', name: 'gpt-oss:20b', description: '' }, { id: 'qwen3-coder:30b', name: 'qwen3-coder:30b', description: '' }], default: 'gpt-oss:20b', custom: true, error: null, note: '' };
    }
    throw new Error(`unknown agent "${agent}"`);
  }

  function openModel() {
    const om = state.openModel;
    const p = PROVIDERS.find((x) => x.id === om.provider);
    const baseUrl = om.baseUrl || p.baseUrl;
    return {
      openModel: { ...om }, configured: true,
      effective: { provider: om.provider, model: om.model || p.defaultModel, baseUrl, local: p.local, keyAccount: om.provider === 'openrouter' || (om.provider === 'custom' && !!baseUrl) ? baseUrl : null, keyRequired: !!p.keyRequired, error: null },
      providers: PROVIDERS, hasKey: false,
      ...(om.provider === 'openrouter' || (om.provider === 'custom' && baseUrl) ? { key: { stored: false, keyring: 'the macOS Keychain' } } : {}),
    };
  }

  // ---- chats --------------------------------------------------------------------------------------

  const chatKey = `chat:${SITE}`;
  const emptyChat = () => ({ sessionId: null, agent: null, messages: [], run: null, last: null });
  /** Read the chat, let `fn` change it (false: leave it), write it back (at once: nothing awaits in between). */
  function updateChat(fn) {
    const chat = { ...emptyChat(), ...(clone(store.get(chatKey)) || {}) };
    if (!Array.isArray(chat.messages)) chat.messages = [];
    if (fn(chat) === false) return;
    setNow({ [chatKey]: chat });
  }

  async function startAgent(msg) {
    const prompt = String(msg.prompt ?? '').trim();
    if (!prompt) throw new Error('empty message');
    if (!siteOn()) throw new Error(`TRIF is off on ${SITE}: turn it on first`);
    if (store.get(chatKey)?.run) throw new Error(`already working on ${SITE}`);
    const runId = `demo-${++runSeq}`;
    const startedAt = Date.now();
    updateChat((c) => { c.messages.push({ role: 'user', text: prompt, time: startedAt }); c.run = { runId, startedAt }; c.last = null; });
    const recording = DEMO.chats.find((c) => c.prompt === prompt);
    const run = { runId, recording, timers: [] };
    state.runs.set(runId, run);
    state.active = { runId, chat: recording ? recording.id : null, step: 0 };
    if (recording) replay(run, 0); else notLive(run);
    broadcast({ type: 'statusChanged' });
    return { runId };
  }

  /** When each recorded message shows, in ms from the start: the session's rhythm, squeezed into seconds. */
  function schedule(steps) {
    const gaps = steps.map((m, i) => Math.max(0, m.t - (i ? steps[i - 1].t : 0)));
    const real = gaps.reduce((a, b) => a + b, 0) || 1;
    const floor = 420;
    const budget = Math.min(15000, 1500 + steps.length * 600);
    const spare = Math.max(0, budget - floor * steps.length);
    let t = 0;
    return gaps.map((g, i) => {
      t += floor + (spare * g) / real;
      if (steps[i].role === 'assistant' && i < steps.length - 1) t += 500; // a moment to read a progress line
      return Math.round(t);
    });
  }

  // From step `from` on (a replay picked up after the page reloaded starts where it was).
  function replay(run, from) {
    const steps = run.recording.messages.slice(1);
    const at = schedule(steps);
    const total = at[at.length - 1] + 600;
    const zero = from ? at[from - 1] : 0;
    run.speedup = Math.max(2, Math.round((run.recording.secs * 1000) / total));
    ui.replaying(run);
    steps.forEach((m, i) => {
      if (i < from) return;
      run.timers.push(later(() => {
        if (state.active?.runId === run.runId) state.active.step = i + 1;
        updateChat((c) => {
          if (c.run?.runId !== run.runId) return false;
          c.messages.push({ role: m.role, text: m.text, time: Date.now() });
        });
      }, at[i] - zero));
    });
    run.timers.push(later(() => finish(run, true), total - zero));
  }

  function notLive(run) {
    run.timers.push(later(() => {
      updateChat((c) => {
        if (c.run?.runId !== run.runId) return false;
        c.messages.push({ role: 'mod', text: DEMO.words.notLive, time: Date.now() });
      });
      finish(run, true);
    }, 700));
  }

  function finish(run, ok) {
    if (state.runs.get(run.runId) !== run) return;
    state.runs.delete(run.runId);
    state.active = null;
    run.timers.forEach(clearTimeout);
    updateChat((c) => {
      if (c.run?.runId !== run.runId) return false;
      if (!ok) c.messages.push({ role: 'tool', text: 'stopped', time: Date.now() });
      c.last = { runId: run.runId, ok, time: Date.now(), changedFiles: [], costUsd: null };
      c.run = null;
    });
    broadcast({ type: 'agentEvent', runId: run.runId, event: { kind: 'done', ok, result: '', changedFiles: [], costUsd: null, sessionId: null } });
    broadcast({ type: 'statusChanged' });
    ui.finished(run);
    // The mod the recorded session made: in the list (as the agent's new file would be), on, as it was at
    // the end of the session, and the page reloaded with it (after a moment, so the reply has been seen
    // arriving).
    if (ok && run.recording) {
      const off = { ...disabled() };
      for (const slug of run.recording.mods) {
        const m = bySlug.get(slug);
        if (!m) continue;
        delete off[m.id];
        state.trash.delete(m.id);
        if (!findMod(m.id)) state.mods.push({ ...m });
      }
      state.mods.sort((a, b) => a.slug.localeCompare(b.slug));
      setNow({ disabled: off });
      state.replayed.add(run.recording.id);
      later(loadPage, 1200);
    }
  }

  // A run that was going when the page reloaded (a switch flipped mid-replay): carry on from where it was.
  function resume() {
    const a = state.active;
    const chat = store.get(chatKey);
    if (!a || chat?.run?.runId !== a.runId) {
      state.active = null;
      if (chat?.run) updateChat((c) => { c.run = null; }); // nothing to carry on with
      return;
    }
    const recording = a.chat ? DEMO.chats.find((c) => c.id === a.chat) : null;
    const run = { runId: a.runId, recording, timers: [] };
    state.runs.set(a.runId, run);
    if (recording) replay(run, Math.min(a.step || 0, recording.messages.length - 1)); else notLive(run);
  }

  function stopRuns() {
    for (const run of [...state.runs.values()]) finish(run, false);
  }

  // ---- the panel's messages (extension/background.js onPanelMessage) -------------------------------

  async function handle(msg) {
    switch (msg?.type) {
      case 'status': return status();
      case 'reconnect': return { ok: true };
      case 'agent.list': return clone(AGENTS);
      case 'agent.models': return models(String(msg.agent ?? ''));
      case 'agent.openModel': return openModel();
      case 'agent.openModel.set': {
        if (msg.provider !== undefined) {
          if (!PROVIDERS.some((p) => p.id === msg.provider)) throw new Error(`unknown provider "${String(msg.provider).slice(0, 40)}"`);
          if (msg.provider !== state.openModel.provider) state.openModel = { provider: msg.provider, model: '', baseUrl: '' };
        }
        if (typeof msg.baseUrl === 'string') state.openModel.baseUrl = msg.baseUrl;
        if (typeof msg.model === 'string') state.openModel.model = msg.model;
        persist();
        return openModel();
      }
      case 'agent.openModel.setKey': throw new Error(DEMO.words.noKeys); // and the key is dropped here, unread
      case 'agent.openModel.removeKey': return openModel();
      case 'instructions.get': return { text: state.instructions, file: '~/.trif/instructions.md', max: 4000 };
      case 'instructions.set': state.instructions = String(msg.text ?? '').trim().slice(0, 4000); persist(); return { text: state.instructions };
      case 'agent.start': return startAgent(msg);
      case 'agent.stop': { const run = state.runs.get(msg.runId); if (run) finish(run, false); return { ok: true }; }
      case 'agent.login': throw new Error(DEMO.words.noLogin);
      case 'agent.loginCode': case 'agent.loginCancel': return { ok: true };
      case 'chat.clear': stopRuns(); await local.remove(chatKey); return { cleared: true };
      case 'chat.note': updateChat((c) => { c.messages.push({ role: 'tool', text: String(msg.text ?? ''), time: Date.now() }); }); return { ok: true };
      case 'site.set': {
        const on = msg.on !== false;
        await sleep(250);
        state.sitesOn = on ? [SITE] : [];
        if (!on) stopRuns();
        later(loadPage, 150);
        broadcast({ type: 'statusChanged' });
        return { site: SITE, on, sitesOn: state.sitesOn.slice() };
      }
      case 'mod.enable': {
        const m = findMod(msg.id);
        if (!m) throw new Error(`no mod ${msg.id}`);
        await sleep(150);
        const off = { ...disabled() };
        if (msg.enabled) delete off[m.id]; else off[m.id] = true;
        setNow({ disabled: off });
        later(loadPage, 150); // once the switch shows its new state
        broadcast({ type: 'statusChanged' });
        return { id: m.id, enabled: !!msg.enabled };
      }
      case 'mod.delete': {
        const i = state.mods.findIndex((m) => m.id === msg.id);
        if (i < 0) throw new Error(`no mod ${msg.id}`);
        const [m] = state.mods.splice(i, 1);
        state.trash.set(m.id, m);
        updateChat((c) => { c.messages.push({ role: 'mod', text: `${m.slug}.js was deleted.`, undo: m.id, time: Date.now() }); });
        loadPage();
        broadcast({ type: 'statusChanged' });
        return { id: m.id };
      }
      case 'mod.restore': {
        const m = state.trash.get(msg.id);
        if (!m) throw new Error(`${msg.id} isn't in the trash`);
        state.trash.delete(m.id);
        state.mods.push(m);
        state.mods.sort((a, b) => a.slug.localeCompare(b.slug));
        updateChat((c) => {
          const line = c.messages.findLast((x) => x.undo === m.id && !x.undone);
          if (line) line.undone = true;
          c.messages.push({ role: 'mod', text: `${m.slug}.js was restored (${disabled()[m.id] ? 'off' : 'on'}, as before).`, time: Date.now() });
        });
        loadPage();
        broadcast({ type: 'statusChanged' });
        return { id: m.id };
      }
      case 'mod.approve': case 'mod.update': throw new Error(DEMO.words.notHere);
      case 'update.check': await sleep(600); return { ok: true };
      case 'update.install': throw new Error(DEMO.words.notHere);
      case 'update.setAuto': state.autoUpdate = !!msg.on; persist(); return { auto: state.autoUpdate };
      case 'update.dismiss': await local.remove('updated'); return null;
      case 'report.build': return { text: '', url: `https://${SITE}/report` };
      default: throw new Error(`unknown message ${msg?.type}`);
    }
  }

  // ---- chrome.runtime ports -----------------------------------------------------------------------

  const ports = new Set();
  function broadcast(msg) { for (const p of ports) later(() => p.onMessage.emit(clone(msg))); }
  function connect(info = {}) {
    const port = {
      name: info.name || '', onMessage: event(), onDisconnect: event(),
      postMessage(raw) {
        const msg = clone(raw);
        const reply = (r) => { if (msg?.reqId !== undefined) later(() => port.onMessage.emit({ type: 'reply', reqId: msg.reqId, ...r }), 20); };
        Promise.resolve().then(() => handle(msg)).then(
          (result) => reply({ ok: true, result: result === undefined ? null : clone(result) }),
          (e) => reply({ ok: false, error: String(e?.message ?? e) }),
        );
      },
      disconnect() { ports.delete(port); },
    };
    ports.add(port);
    return port;
  }

  /** Links the panel opens in a new tab: the report form and the install guide; nothing else. */
  function openOutside(url) {
    const u = String(url || '');
    let to = null;
    if (u.startsWith(`https://${SITE}/report`)) to = '/report';
    else if (u.endsWith('onboarding.html')) to = `${REPO}#install`;
    else if (u.startsWith(`${REPO}`)) to = u;
    if (to) window.open(to, '_blank', 'noopener');
  }

  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      getManifest: () => clone(manifest),
      getURL: (p) => new URL(String(p || ''), location.href).href,
      connect, onMessage: event(), onConnect: event(),
      sendMessage: async () => undefined,
      lastError: undefined,
    },
    storage: { local, onChanged },
    tabs: {
      query: async (q = {}) => (q.url ? [] : [clone(TAB)]),
      get: async (id) => { if (id === TAB.id) return clone(TAB); throw new Error(`No tab with id: ${id}.`); },
      create: async ({ url } = {}) => { openOutside(url); return { id: 99, url }; },
      update: async () => clone(TAB),
      reload: async () => { loadPage(); },
      onActivated: event(), onUpdated: event(), onAttached: event(), onDetached: event(), onRemoved: event(),
    },
    windows: { getCurrent: async () => ({ id: TAB.windowId, focused: true }), update: async () => ({ id: TAB.windowId }) },
    permissions: { request: async () => true, contains: async () => true },
  };
  Object.defineProperty(window, 'chrome', { value: chrome, configurable: true, writable: true });

  // ---- The recorded chats, one at a time ----------------------------------------------------------
  // The next recording's prompt waits in the panel's own message box, which can't be typed in (on a
  // phone, typing would bring up the keyboard and zoom the page in), and Send replays it. One after
  // another, in the order the panel lists the mods (the visitor's own, if they've dragged them): each
  // recording by the last of its mods in that order, and only once the ones it follows on from have played.
  // Once they all have, the box is the visitor's to type in, and what they send gets the note saying what
  // the real TRIF would do with it.

  const ui = (() => {
    let busy = null; // the run being replayed
    let note = null; // "That's all the recordings…", once they have all played
    const offered = () => DEMO.chats.filter((c) => !state.replayed.has(c.id) && c.after.every((a) => state.replayed.has(a)));
    function next() {
      const own = store.get('modOrder');
      const order = (Array.isArray(own?.[SITE]) && own[SITE].length ? own[SITE] : DEMO.order || []).map((id) => String(id).split('/').pop());
      const rank = (c) => Math.max(...c.mods.map((slug) => { const i = order.indexOf(slug); return i < 0 ? order.length : i; }));
      return offered().map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i)[0]?.c || null;
    }

    // (the panel clears the box when it sends)
    function fill() {
      const input = document.getElementById('input');
      if (!input) return;
      const c = busy ? null : next();
      const free = !busy && !c; // every recording played: the box is theirs
      const was = !document.documentElement.classList.contains('demo-guided');
      document.documentElement.classList.toggle('demo-guided', !free);
      input.readOnly = !free;
      input.tabIndex = free ? 0 : -1;
      input.setAttribute('aria-label', free ? 'Message' : 'The next recorded prompt: Send replays it');
      if (!free) input.value = c ? c.prompt : '';
      else if (!was) input.value = ''; // (just freed: clear the box; after that, it keeps what they type)
      input.dispatchEvent(new Event('input', { bubbles: true })); // (the box grows to fit)
      note.hidden = !free;
    }

    function mount() {
      const form = document.getElementById('composer');
      const input = document.getElementById('input');
      if (!form || !input || note) return;
      try { if (window.parent !== window && window.parent.matchMedia('(max-width: 700px)').matches) document.documentElement.classList.add('demo-phone'); } catch {}
      input.rows = 3; // (where the box can't grow to fit its text: Safari)
      note = document.createElement('p');
      note.className = 'demo-note demo-done';
      note.textContent = DEMO.words.allReplayedNote;
      form.before(note);
      fill();
      later(resume);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();

    return {
      replaying(run) { busy = run; fill(); },
      finished(run) { if (busy === run) busy = null; fill(); },
    };
  })();
})(/*DEMO_DATA*/null);
