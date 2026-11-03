// The homepage demo's stand-in for the TRIF extension, loaded before the real side panel's scripts (the
// Worker adds it to the extension's own sidepanel.html; see site/src/demo.js). It provides the chrome.*
// calls the panel makes and answers the panel's port messages the way extension/background.js does, from
// made-up state: the helper is connected, Claude Code is logged in, the tab shows timsrobot.com, the robot
// is on there, and the mods from the promo video are listed (all off at first).
//
// What really happens:
// - A mod switch (or the robot) reloads the page beside the panel with the mods that are on: the frame
//   (frame.js) loads /demo/home?mods=…, and the Worker adds only mods from its bundled list.
// - Chats are recordings: a recorded prompt (offered under "Recorded chats") replays that session, sped
//   up, then switches its mod on. Anything else gets a note saying this demo only replays recordings.
// Nothing leaves the page: no messages to a helper, no keys kept, no storage beyond this page's memory.
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
      later(() => onChanged.emit(changes, 'local'));
    },
    async clear() { await local.remove([...store.keys()]); },
  };

  // ---- the made-up state --------------------------------------------------------------------------

  const state = {
    sitesOn: [SITE],
    mods: DEMO.mods.map((m) => ({ ...m })), // listed (in the background's order: by file name)
    trash: new Map(),
    instructions: '',
    autoUpdate: false,
    openModel: { provider: 'ollama', model: '', baseUrl: '' },
    runs: new Map(),
    replayed: new Set(), // recorded chats played to the end
  };
  // Every mod starts off: the page beside the panel is the plain home page until a switch says otherwise.
  setNow({ disabled: Object.fromEntries(state.mods.map((m) => [m.id, true])) });

  const disabled = () => store.get('disabled') || {};
  const siteOn = () => state.sitesOn.includes(SITE);
  const findMod = (id) => state.mods.find((m) => m.id === id);
  const fileOf = (m) => `~/.trif/sites/${SITE}/${m.slug}.js`;

  /** Load the page beside the panel again, with the mods that run there now (frame.js does it). */
  function loadPage() {
    const mods = siteOn() ? state.mods.filter((m) => !disabled()[m.id]).map((m) => m.slug) : [];
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

  let runSeq = 0;
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
    if (recording) replay(run); else notLive(run);
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

  function replay(run) {
    const steps = run.recording.messages.slice(1);
    const at = schedule(steps);
    const total = at[at.length - 1] + 600;
    run.speedup = Math.max(2, Math.round((run.recording.secs * 1000) / total));
    ui.replaying(run);
    steps.forEach((m, i) => run.timers.push(later(() => {
      updateChat((c) => {
        if (c.run?.runId !== run.runId) return false;
        c.messages.push({ role: m.role, text: m.text, time: Date.now() });
      });
    }, at[i])));
    run.timers.push(later(() => finish(run, true), total));
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
    run.timers.forEach(clearTimeout);
    // The mod the recorded session made: on, as it was at the end of the session.
    if (ok && run.recording) {
      const off = { ...disabled() };
      for (const slug of run.recording.mods) delete off[`${SITE}/${slug}`];
      setNow({ disabled: off });
      state.replayed.add(run.recording.id);
      loadPage();
    }
    updateChat((c) => {
      if (c.run?.runId !== run.runId) return false;
      if (!ok) c.messages.push({ role: 'tool', text: 'stopped', time: Date.now() });
      c.last = { runId: run.runId, ok, time: Date.now(), changedFiles: [], costUsd: null };
      c.run = null;
    });
    broadcast({ type: 'agentEvent', runId: run.runId, event: { kind: 'done', ok, result: '', changedFiles: [], costUsd: null, sessionId: null } });
    broadcast({ type: 'statusChanged' });
    ui.finished(run);
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
        return openModel();
      }
      case 'agent.openModel.setKey': throw new Error(DEMO.words.noKeys); // and the key is dropped here, unread
      case 'agent.openModel.removeKey': return openModel();
      case 'instructions.get': return { text: state.instructions, file: '~/.trif/instructions.md', max: 4000 };
      case 'instructions.set': state.instructions = String(msg.text ?? '').trim().slice(0, 4000); return { text: state.instructions };
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
        loadPage();
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
        loadPage();
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
      case 'update.setAuto': state.autoUpdate = !!msg.on; return { auto: state.autoUpdate };
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

  // ---- "Recorded chats": the prompts the demo can replay, above the message box -------------------

  const ui = (() => {
    let box = null;
    let summary = null;
    let list = null;
    let busy = null; // the run being replayed
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const short = (s) => (s.length > 64 ? `${s.slice(0, 62).replace(/\s+\S*$/, '')}…` : s);
    const offered = () => DEMO.chats.filter((c) => !state.replayed.has(c.id) && c.after.every((a) => state.replayed.has(a)));

    function paint() {
      if (!box) return;
      const chats = offered();
      summary.textContent = busy ? DEMO.words.replaying.replace('{n}', busy.speedup)
        : chats.length ? DEMO.words.recorded : DEMO.words.allReplayed;
      list.replaceChildren(...chats.map((c) => {
        const b = el('button', 'chip', short(c.prompt));
        b.type = 'button';
        b.title = c.prompt;
        b.disabled = !!busy;
        b.addEventListener('click', () => choose(c));
        return b;
      }));
      if (!chats.length && !busy) list.append(el('p', 'demo-note', DEMO.words.allReplayedNote));
    }

    // Type the prompt into the real message box, then send it the way Enter would.
    async function choose(c) {
      const input = document.getElementById('input');
      const form = document.getElementById('composer');
      if (busy || !input || input.disabled) return;
      box.open = false;
      input.focus();
      const step = Math.max(1, Math.ceil(c.prompt.length / 45));
      for (let i = 0; i <= c.prompt.length; i += step) {
        input.value = c.prompt.slice(0, i);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(16);
      }
      input.value = c.prompt;
      form.requestSubmit();
    }

    function mount() {
      const form = document.getElementById('composer');
      if (!form || box) return;
      box = el('details', 'demo-replays');
      box.open = true;
      summary = el('summary');
      list = el('div', 'chips demo-chips');
      box.append(summary, list);
      form.before(box);
      paint();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();

    return {
      replaying(run) { busy = run; paint(); },
      finished(run) { if (busy === run) busy = null; paint(); },
    };
  })();
})(/*DEMO_DATA*/null);
