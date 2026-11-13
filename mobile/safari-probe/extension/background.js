// TRIF Probe's background: the checks, and a log of what happened on its own (how often Safari restarts this
// script, each page load's timing, mod links seen). One classic script, so it runs as Safari's non-persistent
// background page and as a Chromium service worker (mobile/test/smoke.js loads it there).
//
// A check answers 'yes', 'no', 'info' or 'error', with a line of detail. 'no' isn't a failure: several of
// these are open questions, and "Safari refuses this" is the finding.
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const APP_ID = 'application.id'; // Safari sends native messages to the extension's own app whatever this says
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms = 6000, what = 'no answer') => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} within ${ms} ms`)), ms))]);
const errText = (e) => String((e && e.message) || e).slice(0, 300);

// ---- storage ---------------------------------------------------------------------------------------
const get = async (key, fallback) => { const s = await api.storage.local.get(key); return s && s[key] !== undefined ? s[key] : fallback; };
const set = (key, value) => api.storage.local.set({ [key]: value });
let chain = Promise.resolve();
/** Adds to a stored list, newest last, at most `cap` kept (one at a time: two adds at once would lose one). */
const push = (key, item, cap = 60) => { chain = chain.then(async () => { const list = await get(key, []); list.push(item); await set(key, list.slice(-cap)); }).catch(() => {}); return chain; };

// ---- running code in a page ------------------------------------------------------------------------
const exec = async (tabId, world, func, args = []) => {
  const r = await withTimeout(api.scripting.executeScript({ target: { tabId }, world, func, args }));
  return r && r[0] ? r[0].result : undefined;
};
const execFile = (tabId, world, file) => withTimeout(api.scripting.executeScript({ target: { tabId }, world, files: [file] }), 10000);
/** A function Safari injects as `source`: it turns an injected function into code by its toString (extension/safari.js). */
const asInjectable = (source) => { const f = function () {}; f.toString = () => `function () {\n${source}\n}`; return f; };
/** What a page's world left in globalThis[key] (in-page work that takes time leaves its answer there). */
async function later(tabId, world, key, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await exec(tabId, world, (k) => { const x = globalThis[k]; return x === undefined ? null : x; }, [key]);
    if (v !== null && v !== undefined) return v;
    if (Date.now() > end) throw new Error('the page never answered');
    await sleep(150);
  }
}

// ---- the functions that go into pages (each stands alone: it's sent as its own text) ------------------
function pageEval(code) {
  const out = {};
  try { out.eval = String((0, eval)(code)); } catch (e) { out.eval = `refused: ${e.message}`; }
  try { out.Function = String(new Function(`return (${code});`)()); } catch (e) { out.Function = `refused: ${e.message}`; }
  return out;
}
function pageTags(fileUrl, key) {
  const root = document.documentElement;
  const out = {};
  const done = () => {
    out.inline = root.getAttribute('data-trif-probe-inline') === '1';
    out.blob = root.getAttribute('data-trif-probe-blob') === '1';
    out.file = root.getAttribute('data-trif-probe-file') === '1';
    for (const a of ['inline', 'blob', 'file']) root.removeAttribute(`data-trif-probe-${a}`);
    globalThis[key] = out;
  };
  const add = (set) => { const s = document.createElement('script'); set(s); (document.head || root).append(s); s.remove(); return s; };
  try { add((s) => { s.textContent = "document.documentElement.setAttribute('data-trif-probe-inline', '1');"; }); } catch (e) { out.inlineError = e.message; }
  let blobUrl = null;
  try {
    blobUrl = URL.createObjectURL(new Blob(["document.documentElement.setAttribute('data-trif-probe-blob', '1');"], { type: 'text/javascript' }));
    const s = document.createElement('script'); s.src = blobUrl; (document.head || root).append(s);
  } catch (e) { out.blobError = e.message; }
  try { const s = document.createElement('script'); s.src = fileUrl; (document.head || root).append(s); } catch (e) { out.fileError = e.message; }
  setTimeout(() => { if (blobUrl) URL.revokeObjectURL(blobUrl); done(); }, 1200);
}
function pageStyles() {
  const root = document.documentElement;
  const read = (name) => getComputedStyle(root).getPropertyValue(name).trim() === '1';
  const out = {};
  try {
    const st = document.createElement('style'); st.textContent = ':root { --trif-probe-tag: 1 }'; (document.head || root).append(st);
    out.styleElement = read('--trif-probe-tag'); st.remove();
  } catch (e) { out.styleElement = `error: ${e.message}`; }
  try {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(':root { --trif-probe-adopted: 1 }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    out.adoptedSheet = read('--trif-probe-adopted');
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  } catch (e) { out.adoptedSheet = `error: ${e.message}`; }
  try {
    const d = document.createElement('trif-probe-el'); d.setAttribute('style', '--trif-probe-attr: 1'); root.append(d);
    out.styleAttribute = getComputedStyle(d).getPropertyValue('--trif-probe-attr').trim() === '1';
    d.removeAttribute('style'); d.style.setProperty('--trif-probe-om', '1');
    out.styleObject = getComputedStyle(d).getPropertyValue('--trif-probe-om').trim() === '1';
    d.remove();
  } catch (e) { out.styleAttribute = `error: ${e.message}`; }
  out.inserted = read('--trif-probe-inserted');
  out.insertedAsUser = read('--trif-probe-user');
  return out;
}
function pageFetch(key, url) {
  globalThis[key] = undefined;
  fetch(url, { cache: 'no-store' }).then((r) => { globalThis[key] = `answered (${r.status})`; }, (e) => { globalThis[key] = `blocked (${e.message})`; });
}
function pageSesStart() {
  if (globalThis.__trifSandbox) return { started: true, already: true };
  try { globalThis.__trifStartSandbox(); } catch (e) { return { started: false, error: String((e && e.message) || e).slice(0, 400) }; }
  const s = globalThis.__trifSandbox;
  return s ? { started: true, lockdownMs: Math.round(s.stats.lockdownMs * 10) / 10 } : { started: false, error: 'the runtime ran and left nothing' };
}
function pageSesEvaluate(key, id, code) {
  globalThis[key] = undefined;
  try {
    Promise.resolve(globalThis.__trifSandbox.evaluate(id, code, true, { powers: ['page-data', 'read-drafts'], args: {} }))
      .then((v) => { globalThis[key] = String(v); }, (e) => { globalThis[key] = JSON.stringify({ ok: false, error: `evaluate failed: ${e && e.message}` }); });
  } catch (e) { globalThis[key] = JSON.stringify({ ok: false, error: `evaluate threw: ${e && e.message}` }); }
}

// ---- the checks ------------------------------------------------------------------------------------
const API_PATHS = ['userScripts', 'userScripts.execute', 'scripting.executeScript', 'scripting.insertCSS', 'scripting.registerContentScripts',
  'declarativeNetRequest.updateSessionRules', 'declarativeNetRequest.updateDynamicRules', 'webNavigation.onCommitted', 'webRequest',
  'runtime.sendNativeMessage', 'runtime.connectNative', 'sidePanel', 'storage.session', 'alarms', 'tabs.captureVisibleTab',
  'contextMenus', 'menus', 'commands', 'offscreen', 'permissions.request', 'action.openPopup', 'dom'];
const has = (p) => { try { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), api) !== undefined; } catch { return false; } };

const yes = (cond, detail) => ({ answer: cond ? 'yes' : 'no', detail });
const info = (detail) => ({ answer: 'info', detail });
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

const CHECKS = [
  ['env', 'Browser', 'What this is', async () => info({ userAgent: navigator.userAgent, manifest: api.runtime.getManifest().manifest_version, background: typeof window === 'undefined' ? 'service worker' : 'page' })],
  ['apis', 'Browser', 'Which extension APIs exist', async () => { const t = {}; for (const p of API_PATHS) t[p] = has(p); return info(t); }],
  ['permission', 'Browser', 'Allowed on this site', async (c) => yes(await api.permissions.contains({ origins: [`${c.origin}/*`] }), c.origin)],

  ['main.func', 'Running code', "A function of the extension's runs in the page's own world", async (c) => {
    const seen = await exec(c.tabId, 'MAIN', () => { globalThis.__trifProbeMain = 'set'; return typeof globalThis.__probePage; });
    const fromOwn = await exec(c.tabId, 'ISOLATED', () => typeof globalThis.__trifProbeMain);
    const again = await exec(c.tabId, 'MAIN', () => globalThis.__trifProbeMain);
    return yes(again === 'set' && fromOwn === 'undefined', `the page's own global: ${seen}; the mark, from the extension's world: ${fromOwn}; from the page's again: ${again}`);
  }],
  ['main.written', 'Running code', "Code written later runs in the page's world (a function whose toString is the code)", async (c) => {
    const r = await exec(c.tabId, 'MAIN', asInjectable('return "ran:" + (20 + 22);'));
    return yes(r === 'ran:42', `returned ${show(r)}`);
  }],
  ['own.written', 'Running code', "The same, in the extension's own world", async (c) => {
    const r = await exec(c.tabId, 'ISOLATED', asInjectable('return "ran:" + (20 + 22) + ":" + typeof globalThis.__trifKit;'));
    return yes(typeof r === 'string' && r.startsWith('ran:42'), `returned ${show(r)}`);
  }],
  ['main.eval', 'Running code', "eval and new Function in the page's world (the page's policy decides)", async (c) => {
    const r = await exec(c.tabId, 'MAIN', pageEval, ['20 + 22']);
    return yes(r && r.eval === '42' && r.Function === '42', r);
  }],
  ['own.eval', 'Running code', "eval and new Function in the extension's own world (what a box needs)", async (c) => {
    const r = await exec(c.tabId, 'ISOLATED', pageEval, ['20 + 22']);
    return yes(r && r.eval === '42' && r.Function === '42', r);
  }],
  ['tags', 'Running code', 'A <script> the extension adds runs in the page: written inline, from a blob, from the extension\'s file', async (c) => {
    await exec(c.tabId, 'ISOLATED', pageTags, [api.runtime.getURL('page-file.js'), '__trifProbeTags']);
    const r = await later(c.tabId, 'ISOLATED', '__trifProbeTags');
    return { answer: r.inline && r.blob && r.file ? 'yes' : r.inline || r.blob || r.file ? 'some' : 'no', detail: r };
  }],
  ['registered', 'Running code', 'A script registered while running reaches the next page load, in the page\'s world, at its start', async (c) => {
    if (!has('scripting.registerContentScripts')) return { answer: 'no', detail: 'no scripting.registerContentScripts' };
    const have = await api.scripting.getRegisteredContentScripts({ ids: ['trif-probe-dyn'] }).catch(() => []);
    if (!have.length) await api.scripting.registerContentScripts([{ id: 'trif-probe-dyn', js: ['dyn.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true }]);
    const r = await exec(c.tabId, 'MAIN', () => globalThis.__trifProbeDyn || null);
    if (!r) return { answer: have.length ? 'no' : 'info', detail: have.length ? 'registered before this page loaded, and it did not run here' : 'registered just now: reload the page and run the checks again' };
    return yes(true, r);
  }],
  ['frames', 'Running code', 'Frames are reached too', async (c) => {
    const r = await withTimeout(api.scripting.executeScript({ target: { tabId: c.tabId, allFrames: true }, world: 'ISOLATED', func: () => location.href.slice(0, 80) }));
    return { answer: r.length > 1 ? 'yes' : 'info', detail: `${r.length} frame(s): ${r.map((x) => x.result).join(', ')}` };
  }],

  ['styles', 'Styling', 'Ways to add a style rule, on this page', async (c) => {
    const target = { tabId: c.tabId };
    const tried = {};
    try { await api.scripting.insertCSS({ target, css: ':root { --trif-probe-inserted: 1 }' }); } catch (e) { tried.insertCSS = errText(e); }
    try { await api.scripting.insertCSS({ target, css: ':root { --trif-probe-user: 1 }', origin: 'USER' }); } catch (e) { tried.insertCSSUser = errText(e); }
    const r = await exec(c.tabId, 'ISOLATED', pageStyles);
    try { await api.scripting.removeCSS({ target, css: ':root { --trif-probe-inserted: 1 }' }); await api.scripting.removeCSS({ target, css: ':root { --trif-probe-user: 1 }', origin: 'USER' }); } catch (e) { tried.removeCSS = errText(e); }
    const ok = r && Object.values(r).every((v) => v === true);
    return { answer: ok ? 'yes' : 'some', detail: { ...r, ...tried } };
  }],
  ['kit', 'Styling', 'The picker\'s code is in the page, and can name what it sees', async (c) => {
    const r = await exec(c.tabId, 'ISOLATED', () => {
      const k = globalThis.__trifKit; if (!k) return null;
      const o = k.outline(6000);
      const first = document.querySelector('article, [role="dialog"], aside, nav, header');
      return { outlineChars: o.chars, outlineLines: o.lines, outlineTokens: o.tokens, cut: o.cut, sample: first ? k.describe(first) : null };
    });
    return yes(!!r, r || 'no __trifKit in the extension\'s world');
  }],

  ['timing.start', 'Timing', 'How early the extension\'s own script ran on this page, and when the hide rules were in', async (c) => {
    const r = await exec(c.tabId, 'ISOLATED', () => globalThis.__trifProbeStart || null);
    if (!r) return { answer: 'no', detail: 'the start script did not run on this page (reload it once the extension is allowed here)' };
    const before = r.start.readyState === 'loading' && !r.start.pageRan;
    return { answer: before ? 'yes' : 'no', detail: r };
  }],
  ['timing.committed', 'Timing', "How early code put in from the background reached the page's world (as a page commits)", async (c) => {
    const r = await exec(c.tabId, 'MAIN', () => globalThis.__trifProbeCommitted || null);
    if (!r) return { answer: 'no', detail: 'nothing arrived for this page load (reload and run again)' };
    return { answer: r.readyState === 'loading' && !r.pageRan ? 'yes' : 'no', detail: r };
  }],

  ['native', 'The app', 'A message to the extension\'s app and back', async () => {
    if (!has('runtime.sendNativeMessage')) return { answer: 'no', detail: 'no runtime.sendNativeMessage' };
    const out = {};
    for (const [name, size] of [['small', 16], ['100 KB', 100 * 1024], ['1 MB', 1024 * 1024]]) {
      const t0 = Date.now();
      try { const r = await withTimeout(api.runtime.sendNativeMessage(APP_ID, { command: 'ping', pad: 'x'.repeat(size) }), 5000); out[name] = { ms: Date.now() - t0, reply: show(r).slice(0, 300) }; } catch (e) { out[name] = { ms: Date.now() - t0, error: errText(e) }; }
      // (no app answering at all: the rest would only wait as long again)
      if (name === 'small' && out.small.error) return { answer: 'no', detail: out };
    }
    for (const command of ['info', 'write', 'fetch']) {
      const t0 = Date.now();
      try { const r = await withTimeout(api.runtime.sendNativeMessage(APP_ID, { command }), 12000); out[command] = { ms: Date.now() - t0, reply: show(r).slice(0, 600) }; } catch (e) { out[command] = { ms: Date.now() - t0, error: errText(e) }; }
    }
    return { answer: out.small.error ? 'no' : 'yes', detail: out };
  }],

  ['network', 'Network rules', 'A rule can block a request: for every tab, for this tab only, for this site only', async (c) => {
    if (!has('declarativeNetRequest.updateSessionRules')) return { answer: 'no', detail: 'no declarativeNetRequest.updateSessionRules' };
    const dnr = api.declarativeNetRequest;
    let n = 0;
    const ask = async () => {
      const key = `__trifProbeFetch${++n}`;
      await exec(c.tabId, 'MAIN', pageFetch, [key, `${c.origin}/trif-probe-canary?n=${Date.now()}-${n}`]);
      return later(c.tabId, 'MAIN', key, 6000).catch((e) => `no answer (${errText(e)})`);
    };
    const out = { 'no rule': await ask() };
    const variants = [['every tab', {}], ['this tab', { tabIds: [c.tabId] }], ['another tab (should not block)', { tabIds: [c.tabId + 1000] }], ['this site', { initiatorDomains: [c.host] }]];
    let id = 9100;
    for (const [name, extra] of variants) {
      id++;
      try {
        await dnr.updateSessionRules({ removeRuleIds: [id], addRules: [{ id, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'trif-probe-canary', ...extra } }] });
        await sleep(300);
        out[name] = await ask();
      } catch (e) { out[name] = `rule refused: ${errText(e)}`; }
      await dnr.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
    }
    await sleep(300);
    out['rules removed'] = await ask();
    const blocked = (v) => typeof v === 'string' && v.startsWith('blocked');
    const base = !blocked(out['no rule']);
    return { answer: !base ? 'info' : blocked(out['every tab']) ? (blocked(out['this tab']) && !blocked(out['another tab (should not block)']) ? 'yes' : 'some') : 'no', detail: out };
  }],

  ['storage', 'Storage', 'Storage: a megabyte in and out', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const t0 = Date.now(); await set('probeBig', big); const t1 = Date.now(); const back = await get('probeBig', ''); const t2 = Date.now();
    await api.storage.local.remove('probeBig');
    return yes(back.length === big.length, { writeMs: t1 - t0, readMs: t2 - t1, session: has('storage.session') });
  }],
  ['lifetime', 'Background', "How often Safari has restarted the extension's background", async () => {
    const starts = await get('bgStarts', []), alarms = await get('alarmFires', []);
    const gaps = alarms.slice(1).map((t, i) => Math.round((t - alarms[i]) / 1000));
    return info({ starts: starts.length, lastStarts: starts.slice(-5).map((t) => new Date(t).toISOString()), alarmFires: alarms.length, secondsBetweenAlarms: gaps.slice(-10) });
  }],

  // last: SES locks the language down for the extension's whole world on this page
  ['box.ses', 'The box', "SES loads in the extension's own world", async (c) => {
    await execFile(c.tabId, 'ISOLATED', 'gen/ses.umd.min.js');
    const r = await exec(c.tabId, 'ISOLATED', () => `${typeof lockdown}/${typeof Compartment}/${typeof harden}`);
    return yes(r === 'function/function/function' || r === 'function/function/undefined', `lockdown/Compartment/harden: ${r}`);
  }],
  ['box.start', 'The box', "TRIF's sandbox runtime starts there (it locks the language down)", async (c) => {
    await execFile(c.tabId, 'ISOLATED', 'gen/sandbox-runtime.js');
    const r = await exec(c.tabId, 'ISOLATED', pageSesStart);
    return yes(r && r.started, r);
  }],
  ['box.compartment', 'The box', 'A compartment evaluates code', async (c) => {
    const r = await exec(c.tabId, 'ISOLATED', () => { try { return String(new Compartment().evaluate('20 + 22')); } catch (e) { return `refused: ${e.message}`; } });
    return yes(r === '42', `returned ${show(r)}`);
  }],
  ['box.run', 'The box', 'A boxed run reads the page (trif run in the box)', async (c) => {
    await exec(c.tabId, 'ISOLATED', pageSesEvaluate, ['__trifProbeRun1', 'probe-1', '({ links: page.findAll("a").length, title: page.title })']);
    const env = JSON.parse(await later(c.tabId, 'ISOLATED', '__trifProbeRun1', 8000));
    return yes(env.ok === true, env.ok ? env.json : env.error);
  }],
  ['box.confined', 'The box', "Inside it there's no document, fetch or extension API", async (c) => {
    await exec(c.tabId, 'ISOLATED', pageSesEvaluate, ['__trifProbeRun2', 'probe-2', '[typeof document, typeof window, typeof fetch, typeof XMLHttpRequest, typeof chrome, typeof browser, typeof __trifSandbox, typeof __trifKit].join(",")']);
    const env = JSON.parse(await later(c.tabId, 'ISOLATED', '__trifProbeRun2', 8000));
    return yes(env.ok && JSON.parse(env.json).split(',').every((t) => t === 'undefined'), env.ok ? env.json : env.error);
  }],
  ['box.mod', 'The box', 'A boxed mod runs and changes the page', async (c) => {
    const source = 'const out = page.find("#out"); if (out) out.setText("a boxed mod wrote this"); trif.log("boxed mod ran", out ? "and wrote to #out" : "(no #out on this page)");';
    await exec(c.tabId, 'ISOLATED', (id, src) => { globalThis.__trifSandbox.run(id, src, { powers: [], args: {} }); }, ['probe.test/boxed', source]);
    await sleep(500);
    const r = await exec(c.tabId, 'ISOLATED', (id) => {
      const s = globalThis.__trifSandbox;
      const out = document.querySelector('#out');
      return { logs: s.logs.filter((l) => l.mod === id).map((l) => l.args.join(' ')), errors: s.errors.filter((e) => e.mod === id).map((e) => e.message), out: out ? out.textContent : null };
    }, ['probe.test/boxed']);
    return yes(r.logs.length > 0 && !r.errors.length, r);
  }],
];

async function runSuite(tabId) {
  const tab = await api.tabs.get(tabId);
  let u; try { u = new URL(tab.url); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) return { error: `This isn't a web page the checks can run on (${tab.url || 'no address: is the extension allowed on this site?'}).` };
  const ctx = { tabId, url: tab.url, origin: u.origin, host: u.hostname };
  const results = [];
  for (const [id, group, title, run] of CHECKS) {
    const t0 = Date.now();
    let r;
    try { r = await run(ctx); } catch (e) { r = { answer: 'error', detail: errText(e) }; }
    results.push({ id, group, title, answer: r.answer, detail: r.detail, ms: Date.now() - t0 });
  }
  const run = { at: new Date().toISOString(), url: tab.url, page: await exec(tabId, 'MAIN', () => globalThis.__probePage || null).catch(() => null), results };
  await push('runs', run, 20);
  return run;
}

// ---- what happens on its own -------------------------------------------------------------------------
push('bgStarts', Date.now(), 100);
if (api.alarms) {
  api.alarms.create('trif-probe-tick', { periodInMinutes: 1 });
  api.alarms.onAlarm.addListener((a) => { if (a.name === 'trif-probe-tick') push('alarmFires', Date.now(), 100); });
}

if (api.webNavigation) {
  // As a page commits: the earliest the background can put code into it (how extension/safari.js runs mods).
  api.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
    api.scripting.executeScript({
      target: { tabId: d.tabId, frameIds: [0] }, world: 'MAIN', injectImmediately: true,
      func: () => {
        if (globalThis.__trifProbeCommitted) return;
        const root = document.documentElement;
        globalThis.__trifProbeCommitted = { ms: Math.round(performance.now() * 10) / 10, readyState: document.readyState, pageRan: root ? root.getAttribute('data-page-ran') !== null : false, head: !!document.head, body: !!document.body, scripts: document.scripts.length };
      },
    }).catch(() => {});
  });
  api.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) push('historyChanges', { at: Date.now(), host: (() => { try { return new URL(d.url).hostname; } catch { return ''; } })() }, 40); });
}

async function saveRule(host, rule) {
  const all = await get('hideRules', {});
  all[host] = [...(all[host] || []).filter((r) => r.selector !== rule.selector), rule];
  await set('hideRules', all);
  await push('picks', { host, ...rule }, 60);
  return all[host];
}

api.runtime.onMessage.addListener((m, sender, respond) => {
  if (!m || typeof m.type !== 'string') return false;
  const reply = (p) => { Promise.resolve(p).then((v) => respond(v), (e) => respond({ error: errText(e) })); return true; };
  if (m.type === 'pageStart') return reply({ ok: true, at: Date.now() });
  if (m.type === 'loadLog') return reply(push('loads', { at: Date.now(), ...m.rec }, 80).then(() => ({ ok: true })));
  if (m.type === 'modLink') return reply(push('modLinks', { at: Date.now(), url: String(m.url).slice(0, 500), start: m.start }, 30).then(() => ({ ok: true })));
  if (m.type === 'runSuite') return reply(runSuite(m.tabId));
  if (m.type === 'saveRule') return reply(saveRule(String(m.host), m.rule));
  if (m.type === 'forgetRules') return reply(get('hideRules', {}).then((all) => { delete all[m.host]; return set('hideRules', all); }).then(() => ({ ok: true })));
  if (m.type === 'report') {
    return reply(Promise.all(['runs', 'loads', 'picks', 'modLinks', 'bgStarts', 'alarmFires', 'historyChanges', 'hideRules', 'popup'].map((k) => get(k, null)))
      .then(([runs, loads, picks, modLinks, bgStarts, alarmFires, historyChanges, hideRules, popup]) => ({
        probe: 'safari', made: new Date().toISOString(), userAgent: navigator.userAgent, runs, loads, picks, modLinks, bgStarts, alarmFires, historyChanges, hideRules, popup,
      })));
  }
  if (m.type === 'note') return reply(get('popup', {}).then((p) => set('popup', { ...p, [m.key]: m.value })).then(() => ({ ok: true })));
  if (m.type === 'clear') return reply(api.storage.local.clear().then(() => ({ ok: true })));
  return false;
});
