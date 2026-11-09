#!/usr/bin/env node
'use strict';
// X-Flyer's performance suite (opt-in: not part of `npm test`). See tests/perf/README.md.
//
//   node tests/perf/xflyer.js [mod.js ...] [options]
//
// Mods: the first is X-Flyer (default ~/.trif/sites/x.com/space-shooter.js, read fresh every run), the rest
// the X mods played alongside it (default: Detox Timeline, Follow status, Punk Fonts and Rainbow Rave from
// the same folder). Each state of the game is played with scripted keys for a fixed time on a stand-in of
// X's Home (lib/xpage.js) in headless Chrome for Testing, three runs, a fresh browser each, and measured:
// frame times (requestAnimationFrame), a Chrome trace (main thread by kind of work, style recalcs and the
// elements they touch, layout, paint, compositing, GC, the other threads), a CPU profile (the hottest
// functions, the mod's by line), Chrome's own counters, and long animation frames.
//
// Options:
//   --states a,b       which states (default all: see STATES; `--states list` lists them)
//   --sizes a,b        desktop (1440×900 @1x), laptop (1280×800 @2x) (default both)
//   --configs a,b      alone (X-Flyer only), all (with the other mods) (default both)
//   --variants a,b     ablations, each measured as its own row (default none: see lib/variants.js); @file is
//                      another copy of X-Flyer as a variant (a patched one: --variants none,@fixed.js)
//   --runs N           runs per measurement (default 3; transient states take the median of N plain runs
//                      and add one traced and one profiled run)
//   --seconds S        frame-timing window for steady states (default 6)
//   --no-trace, --no-profile   skip those (faster)
//   --mortal           let the ship die (by default it can't: see lib/variants.js IMMORTAL)
//   --leak MIN         instead: play MIN minutes on Home and sample the heap and the DOM (and the same
//                      with the game off, as the baseline)
//   --startup          instead: trace and profile page load, X-Flyer's start (Shift+S) and its first frames
//   --out DIR          results folder (default tests/perf/.work/<time>): results.jsonl, summary.md, summary.json
//   --label NAME       a name for this run's mods in the summary (default: the X-Flyer file's name)
//   --lock DIR         share the machine's test browser with others: take DIR (mkdir) before a browser
//                      starts, keep it for a turn of --lock-minutes (9), then give it up for a minute
//                      (or XFLYER_BROWSER_LOCK=DIR)
// Safety: one browser at a time, each under memguard.sh (killed past 1.5 GB a process, 4 GB in all) and
// `nice`; headless with --mute-audio always; waits while another Chrome for Testing is running.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sleep } = require('../e2e/lib/util');
const { startXPage } = require('./lib/xpage');
const { Browser, waitForQuiet, setLock, takeLock, turnOver, releaseLock } = require('./lib/browser');
const { frameStats, traceSummary, profileSummary, median, round } = require('./lib/analyze');
const { VARIANTS, applyVariant } = require('./lib/variants');

const XDIR = path.join(os.homedir(), '.trif', 'sites', 'x.com');
const DEFAULT_WITH = ['detox-timeline.js', 'follow-status.js', 'punk-fonts.js', 'rainbow-rave.js'].map((f) => path.join(XDIR, f));
const GRAVITY = path.join(__dirname, '..', '..', 'site', 'demo', 'mods', 'gravity.js'); // (timsrobot.com's Gravity mode: see the gravity state)
const SIZES = { desktop: { width: 1440, height: 900, dpr: 1 }, laptop: { width: 1280, height: 800, dpr: 2 } };
const TRACE_CATEGORIES = ['-*', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'v8.execute', 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc', 'toplevel', 'cc', 'viz', 'gpu', 'benchmark'];

// ---- the states. path: where; drive: the keys held (weave: ← and → in turn; fire: space held; up: ↑ held,
// which on Home scrolls the timeline at you; dodge: ↑ and ↓ in turn too; steer: under the boss, firing);
// pre: played first, unmeasured. Steady states are measured for --seconds after a settle; transient ones
// from the moment a log line says it happened (trigger), for each window [from, to] seconds after it.
const STATES = {
  off: { what: 'game off (mods loaded, page idle)', path: '/home', start: false },
  fly: { what: 'flying, not firing', path: '/perf_profile', drive: { weave: true } },
  fire: { what: 'flying and firing: blasting words (and the avatars it wakes)', path: '/perf_profile', drive: { weave: true, fire: true } },
  'home-fire': { what: 'Home, upside-down timeline, firing', path: '/home', drive: { weave: true, fire: true } },
  'home-scroll': { what: 'Home, holding ↑: the timeline scrolls at you, firing', path: '/home', drive: { weave: true, fire: true, up: true } },
  chase: { what: 'avatars chasing the ship (woken first, then dodged)', path: '/perf_profile', pre: { ms: 5000, drive: { weave: true, fire: true } }, drive: { weave: true, dodge: true } },
  gravity: { what: 'Gravity mode (timsrobot.com\'s mod): pieces fall, space bombs', path: '/perf_profile', gravity: true, keys: ['g'], drive: { weave: true, fire: true } },
  boss: { what: '@elonmusk: growing to full size (Big Boss starts), then the fight', path: '/perf_profile?elon=4', drive: { steer: true, fire: true },
    trigger: /BOSS:/, windows: { 'boss-grow': [0, 3.5], 'boss-fight': [4, 10] } },
  gameover: { what: 'the last life lost: the big explosion, YOU DIED, the restart', path: '/perf_profile', drive: { weave: true, fire: true }, events: ['tss-test-die', 'tss-test-die', 'tss-test-die'], eventGap: 2200,
    trigger: /^last life lost/, windows: { gameover: [0, 4.5] } },
  explosion: { what: 'the boss explodes (Firebird starts), then the ending (on Home: the fighter rolls into the bird)', path: '/home?elon=1', events: ['tss-test-boss'], eventDelay: 0, drive: { steer: true, fire: true },
    trigger: /^boss down/, windows: { explosion: [0, 4], ending: [4, 10] } },
};
const ORDER = ['off', 'fly', 'fire', 'home-fire', 'home-scroll', 'chase', 'gravity', 'gameover', 'boss-grow', 'boss-fight', 'explosion', 'ending'];

// ---- arguments
function parseArgs(argv) {
  const o = { mods: [], states: null, sizes: ['desktop', 'laptop'], configs: ['alone', 'all'], variants: ['none'], runs: 3, seconds: 6, trace: true, profile: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--states') o.states = val().split(',');
    else if (a === '--sizes') o.sizes = val().split(',');
    else if (a === '--configs') o.configs = val().split(',');
    else if (a === '--variants') o.variants = val().split(',');
    else if (a === '--runs') o.runs = Number(val());
    else if (a === '--seconds') o.seconds = Number(val());
    else if (a === '--no-trace') o.trace = false;
    else if (a === '--mortal') o.mortal = true;
    else if (a === '--no-profile') o.profile = false;
    else if (a === '--leak') o.leak = Number(val());
    else if (a === '--startup') o.startup = true;
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--label') o.label = val();
    else if (a === '--lock') o.lock = path.resolve(val());
    else if (a === '--lock-minutes') o.lockMinutes = Number(val());
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 30).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.mods.push(path.resolve(a.replace(/^~(?=\/)/, os.homedir())));
  }
  if (o.states?.[0] === 'list') { for (const [k, s] of Object.entries(STATES)) console.log(`${k.padEnd(12)} ${s.what}${s.windows ? ` (windows: ${Object.keys(s.windows).join(', ')})` : ''}`); process.exit(0); }
  if (!o.mods.length) o.mods = [path.join(XDIR, 'space-shooter.js'), ...DEFAULT_WITH.filter((f) => fs.existsSync(f))];
  else if (o.mods.length === 1) o.mods.push(...DEFAULT_WITH.filter((f) => fs.existsSync(f)));
  for (const s of o.sizes) if (!SIZES[s]) throw new Error(`unknown size ${s}`);
  for (const v of o.variants) if (v !== 'none' && !v.startsWith('@') && !v.split('+').every((x) => VARIANTS[x])) throw new Error(`unknown variant ${v} (known: ${Object.keys(VARIANTS).join(', ')})`);
  const known = new Set([...Object.keys(STATES), ...ORDER]);
  for (const s of o.states || []) if (!known.has(s)) throw new Error(`unknown state ${s} (--states list)`);
  o.out ||= path.join(__dirname, '.work', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  o.label ||= path.basename(o.mods[0]);
  return o;
}

// ---- mods: read fresh for every run (so a run measures the file as it is then), in TRIF's order
const header = (code, key) => (new RegExp(`^//\\s*@${key}\\s+(.+)$`, 'm').exec(code.slice(0, 3000)) || [])[1]?.trim();
function readMod(file, id) {
  const code = fs.readFileSync(file, 'utf8'), st = fs.statSync(file);
  return { file, id, code, runAt: header(code, 'run-at') || 'document-start', name: header(code, 'name') || id,
    sha1: crypto.createHash('sha1').update(code).digest('hex'), mtime: st.mtime.toISOString(), bytes: st.size };
}
let wrapModCode = null; // TRIF's own wrapper (extension/lib.js), as the extension injects mods
async function modScripts(mods) {
  wrapModCode ||= (await import(path.join(__dirname, '..', '..', 'extension', 'lib.js'))).wrapModCode;
  return mods.map((m) => {
    const wrapped = wrapModCode(m.id, m.code), cut = wrapped.lastIndexOf('\n//# sourceURL=');
    // (timing marks on the wrapper's own first line and after it: the mod's lines stay where TRIF puts them)
    const id = JSON.stringify(m.id);
    // (CDP runs these as the window is made, before the page has an <html>: TRIF's document-start mods run once
    // it has one, so each waits for it, see whenRoot; document-idle ones wait for DOMContentLoaded too)
    const idle = /idle|end/.test(m.runAt);
    return `window.__perf.whenRoot(() => { const __run = () => { window.__perf.mods[${id}] = { start: performance.now() };${wrapped.slice(0, cut)}\n;window.__perf.mods[${id}].end = performance.now(); }; ${idle ? "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __run, { once: true }); else " : ''}__run();\n});${wrapped.slice(cut)}`;
  });
}

// ---- in the page, before any mod: seeded randomness (the same game every run), TRIF's log (window.trif,
// timed, and marked in the trace), a requestAnimationFrame clock, long animation frames, the ship's place
// (X-Flyer's own tss-ship event), and for the boss states where the boss is drawn (to steer under him).
function PREAMBLE(cfg) {
  let s = cfg.seed >>> 0 || 1;
  Math.random = function random() { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const P = window.__perf = { frames: [], logs: [], loaf: [], ship: null, boss: null, mods: {}, keyAt: [], firstShip: 0, deaths: 0, errors: [] };
  // document-start, as TRIF (and extensions) mean it: when the page's <html> exists, before anything in it
  const queue = [];
  P.whenRoot = (fn) => { if (document.documentElement) fn(); else queue.push(fn); };
  if (!document.documentElement) {
    const mo = new MutationObserver(() => { if (!document.documentElement) return; mo.disconnect(); for (const fn of queue.splice(0)) { try { fn(); } catch (e) { console.error(e); } } });
    mo.observe(document, { childList: true });
  }
  try { if (window.top === window) for (const [k, v] of Object.entries(cfg.storage)) localStorage.setItem(k, v); } catch {}
  const say = (lvl) => (...a) => {
    const t = performance.now(), text = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    P.logs.push([t, lvl, text]);
    try { performance.mark(`trif: ${text.slice(0, 80)}`); } catch {}
  };
  window.trif = { log: say('log'), warn: say('warn') };
  window.__webmods = { errors: P.errors, current: null };
  const tick = (t) => { P.frames.push(t); if (P.frames.length > 100000) P.frames.splice(0, 50000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.loaf.push({ t: e.startTime, dur: e.duration, block: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
          styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
          scripts: e.scripts.map((x) => ({ inv: x.invoker, src: x.sourceURL, fn: x.sourceFunctionName, dur: x.duration, forced: x.forcedStyleAndLayoutDuration })) });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
  addEventListener('tss-ship', (e) => { if (!P.firstShip) P.firstShip = performance.now(); P.ship = { x: e.detail.x, y: e.detail.y }; P.deaths = e.detail.deaths; });
  addEventListener('keydown', (e) => { if (e.key === 'S' && e.shiftKey) P.keyAt.push(e.timeStamp); }, true);
  if (cfg.bossImg) {
    const di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(img, ...a) {
      if (a.length === 4 && img instanceof HTMLImageElement && img.src.endsWith(cfg.bossImg) && a[2] > 100) P.boss = { x: a[0] + a[2] / 2, y: a[1] + a[3] / 2, size: a[2] };
      return di.call(this, img, ...a);
    };
  }
}

// ---- keys
const KEYS = {
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  ' ': [32, 'Space', ' '], S: [83, 'KeyS', 'S'], g: [71, 'KeyG', 'g'], x: [88, 'KeyX', 'x'], r: [82, 'KeyR', 'r'],
};
async function key(b, type, k, modifiers = 0) {
  const [vk, code, text] = KEYS[k];
  await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(type === 'keyDown' && text ? { text, unmodifiedText: text.toLowerCase() } : {}) });
}
const press = async (b, k, modifiers) => { await key(b, 'keyDown', k, modifiers); await sleep(30); await key(b, 'keyUp', k, modifiers); };

/** Holds keys in a pattern until stopped. → {stop()} */
function drive(b, d) {
  const held = new Set();
  let stopped = false;
  const set = async (k, on) => { if (on === held.has(k)) return; if (on) held.add(k); else held.delete(k); await key(b, on ? 'keyDown' : 'keyUp', k); };
  const loop = (async () => {
    const t0 = Date.now();
    while (!stopped) {
      const t = Date.now() - t0;
      try {
        if (d.steer) {
          const p = await b.eval('JSON.stringify([window.__perf.ship, window.__perf.boss])').then(JSON.parse);
          const ship = p[0], boss = p[1];
          const dx = boss && ship ? boss.x - ship.x : (Math.floor(t / 700) % 2 ? 1 : -1) * 100;
          await set('ArrowLeft', dx < -15); await set('ArrowRight', dx > 15);
        } else if (d.weave) {
          const right = Math.floor(t / 700) % 2 === 1;
          await set('ArrowLeft', !right); await set('ArrowRight', right);
        }
        if (d.dodge) { const down = Math.floor(t / 1100) % 2 === 1; await set('ArrowUp', !down); await set('ArrowDown', down); }
        if (d.up) await set('ArrowUp', true);
        if (d.fire) await set(' ', true);
      } catch { /* page busy: next time */ }
      await sleep(d.steer ? 60 : 50);
    }
    for (const k of [...held]) await set(k, false).catch(() => {});
  })();
  return { stop: async () => { stopped = true; await loop; } };
}

// ---- tracing and profiling
async function traceStart(b) {
  await b.browserSend('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: TRACE_CATEGORIES.filter((c) => c !== '-*'), excludedCategories: ['*'], recordMode: 'recordContinuously' }, bufferUsageReportingInterval: 1000 })
    .catch(() => b.browserSend('Tracing.start', { transferMode: 'ReturnAsStream', categories: TRACE_CATEGORIES.join(','), options: 'record-continuously' }));
}
async function traceEnd(b) {
  const done = new Promise((resolve) => { const off = b.cdp.on((m) => { if (m.method === 'Tracing.tracingComplete') { off(); resolve(m.params.stream); } }); });
  await b.browserSend('Tracing.end');
  const stream = await done;
  const parts = [];
  for (;;) {
    const r = await b.browserSend('IO.read', { handle: stream, size: 4 << 20 });
    parts.push(r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data);
    if (r.eof) break;
  }
  await b.browserSend('IO.close', { handle: stream });
  const text = parts.join('');
  const j = JSON.parse(text);
  return { events: Array.isArray(j) ? j : j.traceEvents, bytes: text.length };
}
const markTs = (events, re) => events.find((e) => e.cat?.includes('blink.user_timing') && re.test(e.name))?.ts;
async function profileStart(b) { await b.send('Profiler.enable'); await b.send('Profiler.setSamplingInterval', { interval: 250 }); await b.send('Profiler.start'); }
async function profileStop(b, lastSeconds) {
  const { profile } = await b.send('Profiler.stop');
  if (lastSeconds) { // (only the last part: the window)
    let t = profile.startTime;
    const cut = profile.endTime - lastSeconds * 1e6, keep = [], deltas = [];
    for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i]; if (t >= cut) { keep.push(profile.samples[i]); deltas.push(deltas.length ? profile.timeDeltas[i] : 0); } }
    profile.samples = keep; profile.timeDeltas = deltas; profile.startTime = Math.max(profile.startTime, cut);
  }
  return profile;
}
async function metrics(b) { const { metrics: m } = await b.send('Performance.getMetrics'); return Object.fromEntries(m.map((x) => [x.name, x.value])); }
const metricsDelta = (a, z) => {
  const s = Math.max(1e-6, z.Timestamp - a.Timestamp), per = (k) => round(((z[k] || 0) - (a[k] || 0)) / s, 2);
  return { recalcPerS: per('RecalcStyleCount'), recalcMsPerS: round(per('RecalcStyleDuration') * 1000, 1), layoutPerS: per('LayoutCount'), layoutMsPerS: round(per('LayoutDuration') * 1000, 1),
    scriptMsPerS: round(per('ScriptDuration') * 1000, 1), taskMsPerS: round(per('TaskDuration') * 1000, 1), heapMB: round(z.JSHeapUsedSize / 1048576, 1), nodes: z.Nodes, listeners: z.JSEventListeners };
};

// ---- one run: a fresh browser on the stand-in, the mods injected, the game played into a state
async function session(ctx, { size, config, variant, stateName, mode }) {
  const state = STATES[stateName];
  const alt = variant.startsWith('@') ? path.resolve(variant.slice(1).replace(/^~(?=\/)/, os.homedir())) : null;
  const flyer = readMod(alt || ctx.o.mods[0], 'x.com/space-shooter');
  const others = config === 'all' ? ctx.o.mods.slice(1).map((f) => readMod(f, `x.com/${path.basename(f, '.js')}`)) : [];
  const v = applyVariant(alt ? 'none' : variant, { flyer, others }, { mortal: ctx.o.mortal });
  const mods = [...v.others, ...(state.gravity ? [readMod(GRAVITY, 'x.com/gravity')] : []), v.flyer]
    .sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file))); // (TRIF: by name, all document-start here)
  await takeLock(ctx.log);
  await waitForQuiet(ctx.log);
  const b = await new Browser({ ...SIZES[size], workDir: ctx.work }).start();
  const rec = { size, config, variant, state: stateName, mode, chrome: b.version, load: { before: busyElsewhere(b.profile) }, mods: mods.map(({ id, file, sha1, mtime, bytes }) => ({ id, file, sha1, mtime, bytes })), windows: {} };
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable'); await b.send('Performance.enable', { timeDomain: 'timeTicks' });
    b.cdp.on((m) => { if (m.sessionId === b.sid && m.method === 'Runtime.exceptionThrown') (rec.exceptions ||= []).push(m.params.exceptionDetails.exception?.description?.slice(0, 200) || m.params.exceptionDetails.text); });
    const storage = { 'tssShooter.prefs': JSON.stringify({ music: true, sfx: true, ...v.prefs }),
      dmFeedOptions: JSON.stringify({ reposts: true, quotes: true, replies: true, conversations: true, long: true, links: true, videos: true, images: true, nonMutuals: true }) };
    const bossImg = state.trigger ? '/img/av16.jpg' : null; // (lib/xpage.js: @elonmusk's picture)
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${PREAMBLE.toString()})(${JSON.stringify({ seed: 12345, storage, bossImg })});` });
    for (const src of await modScripts(mods)) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    const q = v.page ? (state.path.includes('?') ? `&${v.page}` : `?${v.page}`) : '';
    if (mode === 'startup') { // (from a page of the same site, so the profiler's renderer is the page's)
      await b.send('Page.navigate', { url: `https://x.com:${ctx.port}/blank` });
      await sleep(1500);
      rec.fromBase64 = await b.eval('typeof Uint8Array.fromBase64 === "function"');
      await traceStart(b); await profileStart(b);
    }
    await b.send('Page.navigate', { url: `https://x.com:${ctx.port}${state.path}${q}` });
    for (let i = 0; i < 120; i++) { await sleep(250); if (await b.eval('!!window.__xLoaded && document.readyState === "complete"').catch(() => false)) break; }
    await sleep(1200); // (images, X-Flyer's first theme scan)
    const p = () => b.eval('JSON.stringify({ logs: __perf.logs, mods: __perf.mods, keyAt: __perf.keyAt, firstShip: __perf.firstShip, deaths: __perf.deaths, now: performance.now(), nodes: document.getElementsByTagName("*").length, words: document.getElementsByClassName("tss-w").length, rows: document.querySelectorAll("[data-testid=cellInnerDiv]").length })').then(JSON.parse);
    if (state.start !== false) {
      await press(b, 'S', 8); // Shift+S: the game starts (and, a real key press, the audio may)
      for (const k of state.keys || []) { await sleep(600); await press(b, k); }
      if (state.events) (async () => { await sleep(state.eventDelay ?? 2500); for (const ev of state.events) { await b.eval(`dispatchEvent(new Event(${JSON.stringify(ev)}))`).catch(() => {}); await sleep(state.eventGap || 0); } })();
    }
    let drv = null;
    if (state.pre) { drv = drive(b, state.pre.drive); await sleep(state.pre.ms); await drv.stop(); }
    if (state.drive) drv = drive(b, state.drive);
    const s0 = await p();
    rec.startup = {
      modExec: Object.fromEntries(Object.entries(s0.mods).map(([k, m]) => [k, round(m.end - m.start, 1)])),
      ready: round(s0.logs.find(([, , t]) => t.startsWith('space shooter ready'))?.[0], 1),
      keyToFirstFrame: s0.keyAt.length && s0.firstShip ? round(s0.firstShip - s0.keyAt[0], 1) : null,
      wrapped: s0.logs.find(([, , t]) => t.startsWith('space shooter on'))?.[2],
    };
    if (mode === 'startup') {
      await sleep(2500);
      const prof = await profileStop(b);
      const { events, bytes } = await traceEnd(b);
      rec.windows.startup = { trace: traceSummary(events), profile: profileSummary(prof), traceMB: round(bytes / 1048576, 1) };
      return rec;
    }
    if (!state.trigger) { // steady: settle, then frames, then a trace, then a profile, each its own window
      await sleep(state.start === false ? 500 : 2500);
      const w = {};
      const m0 = await metrics(b), f0 = (await p()).now;
      await sleep(ctx.o.seconds * 1000);
      const m1 = await metrics(b), s1 = await p();
      const frames = await b.eval(`JSON.stringify(__perf.frames.filter((t) => t >= ${f0} && t <= ${s1.now}))`).then(JSON.parse);
      w.frames = frameStats(frames);
      w.metrics = metricsDelta(m0, m1);
      w.loaf = loafSummary(await b.eval(`JSON.stringify(__perf.loaf.filter((e) => e.t >= ${f0} && e.t <= ${s1.now}))`).then(JSON.parse), (s1.now - f0) / 1000);
      w.page = { nodes: s1.nodes, words: s1.words, rows: s1.rows, deaths: s1.deaths, chasers: s1.logs.filter(([t, , x]) => t >= 0 && / chasing:| BOSS:/.test(x)).length };
      if (mode === 'trace' || (mode === 'full' && ctx.o.trace)) { await traceStart(b); await sleep(3000); const { events, bytes } = await traceEnd(b); w.trace = traceSummary(events); w.traceMB = round(bytes / 1048576, 1); }
      if (mode === 'profile' || (mode === 'full' && ctx.o.profile)) { await profileStart(b); await sleep(3000); w.profile = profileSummary(await profileStop(b)); }
      rec.windows[stateName] = w;
    } else { // transient: wait for the trigger, measure each window after it
      if (mode === 'trace') await traceStart(b);
      if (mode === 'profile') await profileStart(b);
      let T = null;
      for (let i = 0; i < 400 && T == null; i++) { await sleep(100); T = (await p()).logs.find(([, , x]) => state.trigger.test(x))?.[0] ?? null; }
      if (T == null) throw new Error(`${stateName}: never happened (waited 40 s for ${state.trigger})`);
      const ends = Object.values(state.windows).map(([, z]) => z);
      const mAt = {};
      for (const [name, [a, z]] of Object.entries(state.windows)) {
        const now = (await p()).now;
        if (now < T + a * 1000) await sleep(T + a * 1000 - now);
        mAt[name] = [await metrics(b)];
        if (mode === 'profile' && a > 0) await profileStart(b);
        const now2 = (await p()).now;
        await sleep(Math.max(0, T + z * 1000 - now2));
        mAt[name].push(await metrics(b));
        if (mode === 'profile') rec.windows[name] = { profile: profileSummary(await profileStop(b, z - a)) };
      }
      await sleep(200);
      const s1 = await p(), frames = await b.eval('JSON.stringify(__perf.frames)').then(JSON.parse), loaf = await b.eval('JSON.stringify(__perf.loaf)').then(JSON.parse);
      let trace = null;
      if (mode === 'trace') trace = await traceEnd(b);
      for (const [name, [a, z]] of Object.entries(state.windows)) {
        const w = rec.windows[name] ||= {};
        const from = T + a * 1000, to = T + z * 1000;
        w.frames = frameStats(frames.filter((t) => t >= from && t <= to));
        w.metrics = metricsDelta(...mAt[name]);
        w.loaf = loafSummary(loaf.filter((e) => e.t >= from && e.t <= to), z - a);
        w.page = { nodes: s1.nodes, words: s1.words, deaths: s1.deaths, chasers: s1.logs.filter(([, , x]) => / chasing:| BOSS:/.test(x)).length };
        if (trace) {
          const mt = markTs(trace.events, state.trigger.source.startsWith('^') ? new RegExp(`^trif: ${state.trigger.source.slice(1)}`) : new RegExp(`^trif: .*${state.trigger.source}`));
          if (mt) w.trace = traceSummary(trace.events, { window: [mt + a * 1e6, mt + z * 1e6] });
          w.traceMB = round(trace.bytes / 1048576, 1);
        }
      }
      rec.trigger = { at: round(T, 0), logs: s1.logs.filter(([t]) => t >= T - 2000 && t <= T + Math.max(...ends) * 1000).map(([t, , x]) => `${round((t - T) / 1000, 2)}s ${x.slice(0, 120)}`) };
    }
    if (drv) await drv.stop();
    rec.load.after = busyElsewhere(b.profile);
    rec.memory = treeRss(b.proc.pid); // (at the end of the run: MB, all the browser's processes and the biggest)
    rec.errors = await b.eval('JSON.stringify(__perf.errors.map((e) => e.mod + ": " + e.message))').then(JSON.parse);
    rec.warnings = (await p()).logs.filter(([, l]) => l === 'warn').map(([, , x]) => x.slice(0, 160)).slice(0, 10);
  } finally {
    await b.close();
    await turnOver();
  }
  return rec;
}

// How busy the machine is apart from this run's browser (the suite can't control other apps): the load
// average, and the CPU % of the busiest other processes (by name), so noisy runs can be told apart.
function busyElsewhere(ownProfile) {
  const r = require('../e2e/lib/util').run('/bin/ps', ['-Ao', '%cpu=,command=']);
  const others = r.stdout.split('\n').map((l) => /^\s*([\d.]+)\s+(.*)$/.exec(l)).filter(Boolean)
    .filter(([, , c]) => !c.includes(ownProfile) && !c.includes('xflyer.js'))
    .map(([, cpu, c]) => [Number(cpu), path.basename(c.split(/\s--?\w/)[0]).slice(0, 40)]);
  const by = {};
  for (const [cpu, name] of others) by[name] = (by[name] || 0) + cpu;
  const top = Object.entries(by).sort((a, z) => z[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} ${Math.round(c)}%`);
  return { loadavg: round(os.loadavg()[0], 1), otherCpu: Math.round(others.reduce((a, [c]) => a + c, 0)), top };
}

function loafSummary(list, secs) {
  if (!list.length) return { count: 0 };
  const bySrc = {};
  let forced = 0;
  for (const e of list) for (const s of e.scripts) {
    const k = `${(s.src || '').replace(/^trif:\/\//, '').replace(/^https:\/\/x\.com:\d+/, '')} ${s.fn || s.inv}`.trim();
    bySrc[k] = (bySrc[k] || 0) + s.dur; forced += s.forced || 0;
  }
  return { count: list.length, perSecond: round(list.length / secs, 2), maxMs: round(Math.max(...list.map((e) => e.dur)), 0),
    styleLayoutMs: round(list.reduce((a, e) => a + e.styleLayout, 0) / secs, 1), forcedMs: round(forced / secs, 1),
    top: Object.entries(bySrc).sort((a, z) => z[1] - a[1]).slice(0, 5).map(([k, ms]) => `${k} ${round(ms / secs, 1)}ms/s`) };
}

// ---- leaks: minutes of play on Home, sampled; then the same with the game off (the page's own growth)
async function leakRun(ctx, size, config, minutes) {
  const out = {};
  for (const game of [true, false]) {
    await takeLock(ctx.log);
    await waitForQuiet(ctx.log);
    const flyer = readMod(ctx.o.mods[0], 'x.com/space-shooter');
    const others = config === 'all' ? ctx.o.mods.slice(1).map((f) => readMod(f, `x.com/${path.basename(f, '.js')}`)) : [];
    const mods = [...others, flyer].sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)));
    const b = await new Browser({ ...SIZES[size], workDir: ctx.work }).start();
    const samples = [];
    try {
      await b.send('Page.enable'); await b.send('Runtime.enable'); await b.send('Performance.enable'); await b.send('HeapProfiler.enable');
      const storage = { 'tssShooter.prefs': JSON.stringify({ music: true, sfx: true }), dmFeedOptions: JSON.stringify({ reposts: true, quotes: true, replies: true, long: true, links: true, videos: true, images: true, nonMutuals: true, conversations: true }) };
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${PREAMBLE.toString()})(${JSON.stringify({ seed: 12345, storage })});` });
      for (const src of await modScripts(mods)) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
      await b.send('Page.navigate', { url: `https://x.com:${ctx.port}/home` });
      for (let i = 0; i < 120; i++) { await sleep(250); if (await b.eval('!!window.__xLoaded').catch(() => false)) break; }
      await sleep(1500);
      let drv = null, scroller = null;
      if (game) { await press(b, 'S', 8); await sleep(1500); drv = drive(b, { weave: true, fire: true, up: true }); }
      else scroller = setInterval(() => b.eval('scrollBy(0, 32)').catch(() => {}), 50); // (the same 650 px/s)
      const t0 = Date.now();
      while (Date.now() - t0 < minutes * 60000) {
        await b.send('HeapProfiler.collectGarbage');
        const m = await metrics(b);
        const page = await b.eval('JSON.stringify({ els: document.getElementsByTagName("*").length, words: document.getElementsByClassName("tss-w").length, canvases: document.getElementsByTagName("canvas").length, styles: document.getElementsByTagName("style").length, posts: window.__xPosts, scrollY: Math.round(scrollY), deaths: __perf.deaths })').then(JSON.parse);
        samples.push({ s: Math.round((Date.now() - t0) / 1000), heapMB: round(m.JSHeapUsedSize / 1048576, 2), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents, ...page, ...treeRss(b.proc.pid) });
        ctx.log(`    leak ${game ? 'game on' : 'game off'} ${JSON.stringify(samples[samples.length - 1])}`);
        // (every minute, R: the game's own reset, as a player does after a while)
        await sleep(15000);
      }
      if (drv) await drv.stop();
      if (scroller) clearInterval(scroller);
    } finally { await b.close(); await turnOver(); }
    const slope = (k) => { const n = samples.length, xs = samples.map((s) => s.s / 60), ys = samples.map((s) => s[k]); const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n; return round(xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0)), 2); };
    out[game ? 'gameOn' : 'gameOff'] = { samples, perMinute: { heapMB: slope('heapMB'), nodes: slope('nodes'), listeners: slope('listeners'), words: slope('words'), posts: slope('posts'), rssMB: slope('rssMB'), biggestMB: slope('biggestMB') } };
  }
  return out;
}

// The browser's memory: resident size of all its processes, and of the biggest one (the page's renderer,
// usually: decoded audio and images live outside the JS heap), in MB.
function treeRss(rootPid) {
  const r = require('../e2e/lib/util').run('/bin/ps', ['-Ao', 'pid=,ppid=,rss=']);
  const procs = r.stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 3);
  const kids = new Map();
  for (const [pid, ppid] of procs) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
  const rss = new Map(procs.map(([pid, , kb]) => [pid, kb]));
  let all = 0, max = 0;
  for (const todo = [rootPid]; todo.length;) { const p = todo.pop(); const kb = rss.get(p) || 0; all += kb; max = Math.max(max, kb); todo.push(...(kids.get(p) || [])); }
  return { rssMB: Math.round(all / 1024), biggestMB: Math.round(max / 1024) };
}

// ---- the summary: per state, median of the runs
function summarise(records) {
  const groups = new Map();
  for (const r of records) for (const [wname, w] of Object.entries(r.windows)) {
    const k = `${r.size}|${r.config}|${r.variant}|${wname}`;
    if (!groups.has(k)) groups.set(k, { size: r.size, config: r.config, variant: r.variant, state: wname, frames: [], traces: [], profiles: [], metrics: [], loaf: [], page: [], loads: [], mems: [], sha1: r.mods.find((m) => m.id === 'x.com/space-shooter')?.sha1 });
    const g = groups.get(k);
    if (w.frames && (r.mode === 'full' || r.mode === 'plain')) { g.mems.push(r.memory?.rssMB); g.loads.push(((r.load?.before?.otherCpu || 0) + (r.load?.after?.otherCpu || 0)) / 2); g.frames.push(w.frames); g.metrics.push(w.metrics); g.loaf.push(w.loaf); g.page.push(w.page); }
    if (w.trace) g.traces.push(w.trace);
    if (w.profile) g.profiles.push(w.profile);
  }
  const out = [];
  for (const g of groups.values()) {
    const med = (list, f) => round(median(list.map(f)), 2);
    const kinds = {};
    for (const t of g.traces) for (const k of Object.keys(t.mainMs)) kinds[k] = 1;
    const main = Object.fromEntries(Object.keys(kinds).map((k) => [k, med(g.traces, (t) => t.mainMs[k] || 0)]));
    const threads = {};
    for (const t of g.traces) for (const k of Object.keys(t.threads)) threads[k] = 1;
    // the mod's hottest functions: mean self time across the profiled runs
    const fn = new Map();
    for (const p of g.profiles) for (const f of p.top) { const k = `${f.fn} ${f.url}:${f.line}`; fn.set(k, (fn.get(k) || 0) + f.ms / g.profiles.length); }
    const under = {};
    for (const p of g.profiles) for (const [k, ms] of Object.entries(p.underMod || {})) under[k] = round((under[k] || 0) + ms / g.profiles.length, 2);
    const modFn = new Map();
    for (const p of g.profiles) for (const f of p.modTotal) { const k = `${f.fn} ${f.url}:${f.line}`; const e = modFn.get(k) || { self: 0, total: 0 }; e.self += f.ms / g.profiles.length; e.total += f.total / g.profiles.length; modFn.set(k, e); }
    out.push({
      size: g.size, config: g.config, variant: g.variant, state: g.state, runs: g.frames.length, sha1: g.sha1,
      fps: med(g.frames, (f) => f.fps), fpsMedian: med(g.frames, (f) => f.fpsMedian), p95: med(g.frames, (f) => f.p95), p99: med(g.frames, (f) => f.p99),
      max: med(g.frames, (f) => f.max), long50: med(g.frames, (f) => f.long50), missed: med(g.frames, (f) => f.missed),
      metrics: g.metrics.length ? Object.fromEntries(Object.keys(g.metrics[0] || {}).map((k) => [k, med(g.metrics, (m) => m?.[k])])) : null,
      loafPerS: med(g.loaf, (l) => l?.perSecond || 0), loafTop: g.loaf.find((l) => l?.top)?.top,
      page: g.page[0], otherCpu: med(g.loads, (l) => l), memoryMB: med(g.mems, (m) => m), 
      main, mainBusy: med(g.traces, (t) => t.mainBusy), threads: Object.fromEntries(Object.keys(threads).map((k) => [k, med(g.traces, (t) => t.threads[k] || 0)])),
      recalc: g.traces.length ? { perS: med(g.traces, (t) => t.recalcs?.perSecond), msPerS: med(g.traces, (t) => t.recalcs?.msPerSecond), elementsPerS: med(g.traces, (t) => t.recalcs?.elementsPerSecond), maxElements: med(g.traces, (t) => t.recalcs?.maxElements), medianElements: med(g.traces, (t) => t.recalcs?.medianElements) } : null,
      layout: g.traces.length ? { perS: med(g.traces, (t) => t.layouts?.perSecond), msPerS: med(g.traces, (t) => t.layouts?.msPerSecond) } : null,
      forcedMs: med(g.traces, (t) => t.forcedStyleLayoutMs || 0),
      topEvents: g.traces[0]?.topEvents?.slice(0, 8),
      perMod: under, // (ms per second spent in each mod's code and whatever it called)
      topFunctions: [...fn].sort((a, z) => z[1] - a[1]).slice(0, 8).map(([k, ms]) => `${k} ${round(ms, 2)}ms/s`),
      modFunctions: [...modFn].sort((a, z) => z[1].total - a[1].total).slice(0, 12).map(([k, e]) => `${k} total ${round(e.total, 2)} self ${round(e.self, 2)} ms/s`),
    });
  }
  out.sort((a, z) => a.size.localeCompare(z.size) || a.config.localeCompare(z.config) || a.variant.localeCompare(z.variant) || ORDER.indexOf(a.state) - ORDER.indexOf(z.state));
  return out;
}
const biggest = (s) => {
  const parts = Object.entries(s.main || {}).filter(([k]) => k !== 'other').sort((a, z) => z[1] - a[1]);
  const top = parts[0] ? `${parts[0][0]} ${parts[0][1]} ms/s` : (s.metrics ? `script ${s.metrics.scriptMsPerS}, style ${s.metrics.recalcMsPerS}, layout ${s.metrics.layoutMsPerS} ms/s` : '');
  const fn = s.modFunctions?.[0]?.replace(/ total ([\d.]+).*$/, ' ($1 ms/s)');
  return `${top}${fn ? `; ${fn}` : ''}`;
};
function table(summary) {
  const rows = ['| size | mods | variant | state | fps | fps (median frame) | p95 ms | p99 ms | >50 ms | main thread busy ms/s | of it: script / canvas / hittest / style / layout / prepaint+paint / composite / gc | GPU main thread ms/s | style recalcs/s (elements) | biggest cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const s of summary) {
    const m = s.main || {};
    const mt = s.mainBusy != null && Object.keys(m).length ? `${round((m.script || 0) + (m.compile || 0), 1)} / ${m.canvas ?? 0} / ${m.hittest ?? 0} / ${m.style ?? 0} / ${m.layout ?? 0} / ${round((m.prepaint || 0) + (m.paint || 0), 1)} / ${m.composite ?? 0} / ${m.gc ?? 0}` : '';
    const busy = Object.keys(m).length ? round(Object.values(m).reduce((a, x) => a + x, 0), 0) : '';
    rows.push(`| ${s.size} | ${s.config} | ${s.variant.startsWith('@') ? path.basename(s.variant) : s.variant} | ${s.state} | ${s.fps} | ${s.fpsMedian} | ${s.p95} | ${s.p99} | ${s.long50} | ${busy} | ${mt} | ${s.threads?.CrGpuMain ?? ''} | ${s.recalc ? `${s.recalc.perS} (${s.recalc.medianElements}, max ${s.recalc.maxElements})` : ''} | ${biggest(s)} |`);
  }
  return rows.join('\n');
}

// ---- main
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.lock || process.env.XFLYER_BROWSER_LOCK) setLock(o.lock || process.env.XFLYER_BROWSER_LOCK, o.lockMinutes);
  fs.mkdirSync(o.out, { recursive: true });
  const work = path.join(__dirname, '.work');
  fs.mkdirSync(work, { recursive: true });
  const logFile = path.join(o.out, 'log.txt');
  const log = (s) => { console.log(s); fs.appendFileSync(logFile, `${s}\n`); };
  const srv = await startXPage(work);
  const ctx = { o, work, port: srv.port, log };
  const jsonl = path.join(o.out, 'results.jsonl');
  const records = [];
  log(`X-Flyer perf: ${o.mods.map((m) => m.replace(os.homedir(), '~')).join(', ')} → ${o.out}`);
  try {
    if (o.leak) {
      for (const size of o.sizes.slice(0, 1)) for (const config of o.configs) {
        log(`leak: ${size} ${config}, ${o.leak} min each`);
        const r = await leakRun(ctx, size, config, o.leak);
        fs.appendFileSync(jsonl, `${JSON.stringify({ leak: true, size, config, ...r, mods: o.mods })}\n`);
        log(`  per minute, game on: ${JSON.stringify(r.gameOn.perMinute)}; game off: ${JSON.stringify(r.gameOff.perMinute)}`);
      }
      return;
    }
    if (o.startup) {
      for (const size of o.sizes) for (const config of o.configs) for (let run = 0; run < o.runs; run++) for (const variant of o.variants) {
        const r = await session(ctx, { size, config, variant, stateName: 'fly', mode: 'startup' });
        fs.appendFileSync(jsonl, `${JSON.stringify(r)}\n`);
        const w = r.windows.startup, secs = w.profile.seconds;
        // (the profile's functions in ms over the whole window: page load, Shift+S, the first frames)
        log(`startup ${size} ${config} ${variant.startsWith('@') ? path.basename(variant) : variant} #${run + 1}: ${JSON.stringify(r.startup)} | longest task ${w.trace.longestTaskMs} ms | mod functions (ms) ${w.profile.modTotal.slice(0, 8).map((f) => `${f.fn}:${f.line} ${round(f.total * secs, 0)}`).join(', ')}`);
      }
      return;
    }
    const wanted = o.states || ORDER;
    const stateNames = Object.keys(STATES).filter((k) => wanted.includes(k) || (STATES[k].windows && Object.keys(STATES[k].windows).some((w) => wanted.includes(w))));
    // (variants interleaved run by run, A B A B…, so a machine that gets busier or quieter part way through
    // affects them alike)
    for (const size of o.sizes) for (const config of o.configs) for (const stateName of stateNames) {
      const transient = !!STATES[stateName].trigger;
      const modes = transient ? [...Array(o.runs).fill('plain'), ...(o.trace ? ['trace'] : []), ...(o.profile ? ['profile'] : [])] : Array(o.runs).fill('full');
      for (const [i, mode] of modes.entries()) for (const variant of o.variants) {
        const t0 = Date.now();
        let r;
        try { r = await session(ctx, { size, config, variant, stateName, mode }); } catch (e) {
          log(`  ${size} ${config} ${variant} ${stateName} #${i + 1} (${mode}) FAILED: ${e.message}`);
          continue;
        }
        records.push(r);
        fs.appendFileSync(jsonl, `${JSON.stringify(r)}\n`);
        for (const [wn, w] of Object.entries(r.windows)) {
          if (o.states && !wanted.includes(wn) && !wanted.includes(stateName)) continue;
          log(`  ${size} ${config} ${variant.startsWith('@') ? path.basename(variant) : variant} ${wn} #${i + 1} (${mode}, ${round((Date.now() - t0) / 1000, 0)}s): ${w.frames ? `${w.frames.fps} fps, p95 ${w.frames.p95} ms, >50ms ${w.frames.long50}` : ''}${w.trace ? ` | main ${JSON.stringify(w.trace.mainMs)}` : ''}${w.profile ? ` | ${w.profile.modTotal.slice(0, 4).map((f) => `${f.fn}:${f.line} ${f.total}`).join(', ')}` : ''}${w.page ? ` | ${JSON.stringify(w.page)}` : ''} | elsewhere ${r.load?.before?.otherCpu}%→${r.load?.after?.otherCpu}% (${r.load?.before?.top?.[0] || ''})`);
        }
        if (r.errors?.length || r.exceptions?.length) log(`    errors: ${[...(r.errors || []), ...(r.exceptions || [])].slice(0, 3).join(' | ')}`);
      }
      const summary = summarise(records);
      fs.writeFileSync(path.join(o.out, 'summary.json'), JSON.stringify(summary, null, 1));
      fs.writeFileSync(path.join(o.out, 'summary.md'), `# X-Flyer perf: ${o.label}\n\n${o.mods.map((m) => `- ${m.replace(os.homedir(), '~')}`).join('\n')}\n\n${table(summary)}\n`);
    }
    log(`\n${table(summarise(records))}\n\nsummary: ${path.join(o.out, 'summary.md')} (details: summary.json, every run: results.jsonl)`);
  } finally {
    releaseLock();
    await srv.close();
  }
}

// (exit when done: a stray timer from a browser that's gone mustn't keep the next queued run waiting)
if (require.main === module) main().then(() => process.exit(0), (e) => { console.error(e.stack || e.message); process.exit(1); });
// (for one-off scripts: the page set up as a run sets it up, keys, the driver)
async function _prepare(b, { flyer, others = [], storage = {}, seed = 12345, bossImg = null }) {
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const mods = [...others.map((f) => readMod(f, `x.com/${path.basename(f, '.js')}`)), readMod(flyer, 'x.com/space-shooter')];
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${PREAMBLE.toString()})(${JSON.stringify({ seed, storage, bossImg })});` });
  for (const src of await modScripts(mods)) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
}
module.exports = { STATES, summarise, table, _prepare, _press: press, _drive: drive };
