// Safari adapter, loaded before background.js in the Safari build (safari-background.js; see
// scripts/build-extension.js). Safari has no chrome.userScripts, its native messaging only reaches the
// extension's own Mac app, and it has no side panel, so this stands in for all three:
//
// - chrome.userScripts: scripts are kept here, in memory only (the mods' code is already in storage, as
//   `mods`, and Safari's storage gives out under heavy writing: a background Safari restarted gets them
//   again from its first sync, which a page committing meanwhile waits for), and put into each page as
//   it commits, with chrome.scripting, in the page's own world. Safari turns an
//   injected function into code by its source text (toString), so a function whose toString returns a
//   script's code runs that code, even on pages whose CSP forbids eval (x.com, instagram.com). That's
//   how Safari 27 behaves rather than a documented promise; tests/safari.test.js describes what it needs.
// - chrome.runtime.connectNative: a port over a WebSocket to the helper's Safari bridge
//   (helper/safari-bridge.js) on 127.0.0.1, which relays to an ordinary host.js. The bridge only takes
//   connections that bring its key, which the extension gets from its own Mac app (the one native
//   messaging partner Safari allows: safari/SafariWebExtensionHandler.swift).
// - The side panel: the toolbar button opens the panel page in a window of its own, following the tabs
//   of the window it was opened from.
//
// The stand-ins reach background.js as its `chrome` (bundledChrome, below), not by changing Safari's.

import { matchesPattern } from './lib.js';

export const BRIDGE_URL = 'ws://127.0.0.1:47615/';
const APP_ID = 'com.timsrobot.trif'; // Safari sends native messages to the extension's own app whatever this says
const LOG_URL = 'http://127.0.0.1:47615/log';
const STORE_KEY = 'safariUserScripts';

// Safari only shows the background's console in its developer tools, so warnings, errors and uncaught
// failures also go to the bridge, which writes them to its log (helper/safari-bridge.js).
const toBridge = (level, args) => {
  const text = args.map((a) => (a instanceof Error ? a.stack || String(a) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
  fetch(LOG_URL, { method: 'POST', body: `${level}: ${text}`.slice(0, 20000) }).catch(() => {});
};
for (const level of ['warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => { orig(...args); toBridge(level, args); };
}
self.addEventListener('error', (e) => toBridge('uncaught', [e.error || e.message]));
self.addEventListener('unhandledrejection', (e) => toBridge('unhandled rejection', [e.reason]));

// ---- chrome.userScripts --------------------------------------------------------------------------

let scripts = []; // registered, in registration order (the runtime first, as registered by syncUserScripts)
// The background's first sync after a start (background.js applyMods calls userScripts.markSynced): until
// then `scripts` is empty, so a page committing meanwhile waits for it (at most SYNC_WAIT_MS).
const SYNC_WAIT_MS = 5000;
let markSynced = () => {};
const synced = new Promise((r) => { markSynced = r; });
const firstSync = Promise.race([synced, new Promise((r) => { const t = setTimeout(r, SYNC_WAIT_MS); t?.unref?.(); })]);
// (Until 0.2.0 the scripts, code and all, were kept in storage too: that copy goes.)
try { chrome.storage.local.remove?.(STORE_KEY)?.catch?.(() => {}); } catch { /* storage unavailable */ }
const loaded = Promise.resolve();
const save = async () => {};
const copy = (v) => JSON.parse(JSON.stringify(v));
const codeOf = (s) => (s.js || []).map((j) => String(j.code ?? '')).join('\n;\n');

/** A function Safari will inject as `source` (it serializes injected functions with toString). */
export function asInjectable(source) {
  const f = function () {};
  f.toString = () => `function () {\n${source}\n}`;
  return f;
}

const userScripts = {
  async getScripts(filter) {
    await loaded;
    const ids = filter?.ids;
    return copy(scripts.filter((s) => !ids || ids.includes(s.id)));
  },
  async register(list) {
    await loaded;
    for (const s of list) {
      if (!s?.id) throw new Error('a script needs an id');
      if (scripts.some((x) => x.id === s.id) || list.filter((x) => x.id === s.id).length > 1) throw new Error(`Duplicate script ID '${s.id}'`);
    }
    scripts.push(...copy(list));
    await save();
  },
  async update(list) {
    await loaded;
    for (const s of list) {
      const i = scripts.findIndex((x) => x.id === s.id);
      if (i < 0) throw new Error(`Nonexistent script ID '${s.id}'`);
      scripts[i] = { ...scripts[i], ...copy(s) };
    }
    await save();
  },
  async unregister(filter) {
    await loaded;
    const ids = filter?.ids;
    scripts = ids ? scripts.filter((s) => !ids.includes(s.id)) : [];
    await save();
  },
  /** Like chrome.userScripts.execute: the code is one expression; its value (awaited) is the result. */
  async execute({ target, js }) {
    const code = codeOf({ js });
    return chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [0] }, world: 'MAIN', injectImmediately: true,
      func: asInjectable(`return (\n${code}\n);`),
    });
  },
  async configureWorld() {},
  /** Not in Chrome's API: the background has registered what should be (see `synced`). */
  markSynced() { markSynced(); },
};

const appliesTo = (s, url) => (s.matches || []).some((p) => matchesPattern(p, url))
  && !(s.excludeMatches || []).some((p) => matchesPattern(p, url));

/**
 * The code for one page and one run-at time: every matching script, in order, each in its own try so one
 * mod's error doesn't stop the rest (mods are already wrapped that way; the runtime isn't).
 * - It only runs on the origin it was matched for: the tab may have moved on to another site by the
 *   time the injection lands (executeScript targets the tab, not the document).
 * - The marker on `document` keeps a page restored from the back/forward cache from getting a second
 *   copy. `markFor` names it: the scripts injected one at a time (inject's fallback) each need their own.
 */
export function pageCode(list, url, runAt, markFor = runAt) {
  const parts = list.filter((s) => (s.runAt || 'document_idle') === runAt && appliesTo(s, url)).map(codeOf);
  if (!parts.length) return '';
  let origin = 'null';
  try { origin = new URL(url).origin; } catch {}
  const mark = JSON.stringify(`__webmods_${markFor}`);
  return `if (location.origin !== ${JSON.stringify(origin)} || document[${mark}]) return; document[${mark}] = true;\n`
    + parts.map((c) => `try {\n${c}\n} catch (e) { console.error('[TRIF]', e); }`).join('\n');
}

async function inject(runAt, { tabId, frameId, url }) {
  if (frameId !== 0) return;
  await firstSync;
  const code = pageCode(scripts, url, runAt);
  if (!code) return;
  const run = (source) => chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'MAIN', injectImmediately: true, func: asInjectable(source),
  });
  try {
    await run(code);
  } catch (e) {
    // One script that doesn't parse would stop them all, so try them one at a time.
    console.warn('[TRIF] injecting into', url, 'failed, retrying one script at a time:', e?.message ?? e);
    for (const s of scripts) {
      const one = pageCode([s], url, runAt, `${runAt}_${s.id}`);
      if (one) await run(one).catch((err) => console.error('[TRIF] script', s.id, 'failed on', url, err?.message ?? err));
    }
  }
}

chrome.webNavigation.onCommitted.addListener((d) => { inject('document_start', d); });
chrome.webNavigation.onDOMContentLoaded.addListener((d) => { inject('document_end', d); });
chrome.webNavigation.onCompleted.addListener((d) => { inject('document_idle', d); });

// ---- chrome.runtime.connectNative ----------------------------------------------------------------

function event() {
  const set = new Set();
  return { set, api: { addListener: (f) => set.add(f), removeListener: (f) => set.delete(f), hasListener: (f) => set.has(f) } };
}

let token = null; // the bridge's key, once the app has given it

/** The bridge's key, from the extension's app (which reads safari-token in TRIF's private folder). */
async function bridgeToken() {
  if (token) return token;
  const r = await chrome.runtime.sendNativeMessage(APP_ID, { type: 'token' });
  if (typeof r?.token !== 'string' || !r.token) throw new Error(r?.error || "TRIF's app didn't give the key for the helper");
  return (token = r.token);
}

/** A runtime.Port to the helper's Safari bridge. */
function bridgePort() {
  const message = event();
  const disconnect = event();
  const queue = [];
  let open = false;
  let closed = false;
  let ws = null;
  const gone = () => {
    if (closed) return;
    closed = true;
    for (const f of disconnect.set) f(port);
  };
  const port = {
    name: 'webmods-helper',
    onMessage: message.api,
    onDisconnect: disconnect.api,
    postMessage(msg) {
      if (closed) throw new Error('Attempting to use a disconnected port object');
      const s = JSON.stringify(msg);
      if (open) ws.send(s); else queue.push(s);
    },
    disconnect() { closed = true; try { ws?.close(); } catch {} },
  };
  bridgeToken().then((key) => {
    if (closed) return;
    ws = new WebSocket(`${BRIDGE_URL}?token=${encodeURIComponent(key)}`);
    ws.onopen = () => { open = true; for (const s of queue.splice(0)) ws.send(s); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const f of message.set) f(msg, port);
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (!open) token = null; gone(); }; // refused: maybe the key changed, so ask again
  }, (e) => {
    console.warn('[TRIF] no key for the helper:', e?.message ?? e);
    setTimeout(gone, 0);
  });
  return port;
}

// ---- the panel window ----------------------------------------------------------------------------

let panelWindow = null;
chrome.action.onClicked.addListener(async (tab) => {
  if (panelWindow !== null) {
    try { await chrome.windows.update(panelWindow, { focused: true }); return; } catch { panelWindow = null; }
  }
  const url = chrome.runtime.getURL(`sidepanel.html?window=${tab?.windowId ?? ''}`);
  const win = await chrome.windows.create({ url, type: 'popup', width: 440, height: 820 });
  panelWindow = win?.id ?? null;
});
chrome.windows.onRemoved.addListener((id) => { if (id === panelWindow) panelWindow = null; });

// ---- what the rest of the background sees as `chrome` -------------------------------------------

/**
 * Safari's own `chrome` with the stand-ins above in place of chrome.userScripts and
 * chrome.runtime.connectNative. Safari doesn't let extensions change its `chrome` object, so the Safari
 * bundle (scripts/build-extension.js) hands the modules after this one this copy instead.
 */
function adapt(real) {
  const own = (target, key) => { const v = target[key]; return typeof v === 'function' ? v.bind(target) : v; };
  const runtime = new Proxy(real.runtime, { get: (t, k) => (k === 'connectNative' ? bridgePort : own(t, k)) });
  return new Proxy(real, { get: (t, k) => (k === 'userScripts' ? userScripts : k === 'runtime' ? runtime : own(t, k)) });
}
export const bundledChrome = adapt(chrome);
