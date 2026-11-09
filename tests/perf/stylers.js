#!/usr/bin/env node
'use strict';
// The X stylers' performance suite (opt-in: not part of `npm test`). See tests/perf/README.md ("Stylers").
//
//   node tests/perf/stylers.js [options]
//
// Profile Styler, Post Styler, Site Inherits Profile Style and Style Encoder, with the rest of your X mods
// (every .js in ~/.trif/sites/x.com not starting with _, read fresh every run), on a stand-in of X
// (lib/xpage.js ?pbs=1): your own profile (perf_me: header photo, picture, name, badge, handle, Edit profile,
// tabs, your posts), someone else's, and Home (posts by styled and unstyled authors, the sidebar's people).
// The profile pictures are the stand-in's, stamped with style codes by Style Encoder's own drawing code
// (lib/styles.js) and served as pbs.twimg.com by request interception; your saved style is put in
// localStorage as Profile Styler stores it. Each state is measured sitting still (idle) and scrolling.
//
// Options:
//   --states a,b       which states (default all; `--states list` lists them)
//   --windows a,b      idle, scroll (default both)
//   --variants a,b     ablations and fixes, each its own row (lib/styler-variants.js; fix:<name>, fixed;
//                      @dir: the mods in dir replace the ones of the same name)
//   --runs N           runs per state and variant (default 3; variants interleaved run by run)
//   --seconds S        each window's CPU and frame measurement (default 6), then a 3 s trace, a 3 s profile
//   --size laptop|desktop   1280×800 @2x (default) or 1440×900 @1x
//   --dir DIR          the mods (default ~/.trif/sites/x.com)
//   --no-trace, --no-profile
//   --selector-stats   also trace 3 s of each window with Chrome's CSS selector stats: the selectors the
//                      style recalcs spent their time on (summary.json: selectors)
//   --out DIR          results (default tests/perf/.work/stylers-<time>): results.jsonl, summary.md, summary.json
//   --shots DIR        a screenshot of each run's page once settled, in DIR
//   --look-at MS       with --shots, and only for looking: every animation stopped at MS ms (as if all began
//                      together), so two variants' screenshots compare pixel for pixel; nothing measured
//   --eval EXPR        evaluate EXPR in each run's page once settled, and log it (a check on what's shown)
//   --lock DIR         share the machine's test browser: take DIR (mkdir) before each browser, write an owner
//                      file in it, keep it a turn of --lock-minutes (9), then give it up for a minute
// Safety: as xflyer.js (one browser at a time, memguard.sh, nice, headless, --mute-audio, nothing resolves but
// x.com; pbs.twimg.com answered from disk, any other host refused).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sleep, run } = require('../e2e/lib/util');
const { Browser, waitForQuiet, setLock, takeLock, turnOver, releaseLock } = require('./lib/browser');
const { startXPage } = require('./lib/xpage');
const { frameStats, traceSummary, profileSummary, median, round } = require('./lib/analyze');
const { STYLES, stampPictures } = require('./lib/styles');
const { applyVariant, knownVariant } = require('./lib/styler-variants');
const X = require('./xflyer');

const XDIR = path.join(os.homedir(), '.trif', 'sites', 'x.com');
const SIZES = { desktop: { width: 1440, height: 900, dpr: 1 }, laptop: { width: 1280, height: 800, dpr: 2 } };
const STORE = 'trifProfileStyler.mine:perf_me';
const STATES = {
  'own-plain': { what: 'your profile, your saved style: colours, no rainbow', path: '/perf_me', mine: 'plain' },
  'own-rbg': { what: 'your profile, a rainbow background', path: '/perf_me', mine: 'rbg' },
  'own-allrb': { what: 'your profile, everything rainbow', path: '/perf_me', mine: 'allrb' },
  'own-panel': { what: 'your profile, everything rainbow, the Style profile panel open', path: '/perf_me', mine: 'allrb', panel: true },
  'own-plain-panel': { what: 'your profile, no rainbow, the panel open', path: '/perf_me', mine: 'plain', panel: true },
  other: { what: "@grace_h's profile (her picture: a rainbow background); yours everything rainbow", path: '/grace_h', mine: 'allrb' },
  home: { what: 'Home: posts by styled and unstyled authors, people cards; yours (inherited) everything rainbow', path: '/home', mine: 'allrb' },
  'home-plain': { what: 'Home, yours (inherited) no rainbow', path: '/home', mine: 'plain' },
};
const WINDOWS = ['idle', 'scroll'];

function parseArgs(argv) {
  const o = { states: Object.keys(STATES), windows: WINDOWS, variants: ['none'], runs: 3, seconds: 6, size: 'laptop', dir: XDIR, trace: true, profile: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--states') o.states = val().split(',');
    else if (a === '--windows') o.windows = val().split(',');
    else if (a === '--variants') o.variants = val().split(',');
    else if (a === '--runs') o.runs = Number(val());
    else if (a === '--seconds') o.seconds = Number(val());
    else if (a === '--size') o.size = val();
    else if (a === '--dir') o.dir = path.resolve(val().replace(/^~(?=\/)/, os.homedir()));
    else if (a === '--no-trace') o.trace = false;
    else if (a === '--no-profile') o.profile = false;
    else if (a === '--selector-stats') o.selectorStats = true;
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--lock') o.lock = path.resolve(val());
    else if (a === '--shots') o.shots = path.resolve(val());
    else if (a === '--look-at') o.lookAt = Number(val());
    else if (a === '--eval') o.eval = val();
    else if (a === '--lock-minutes') o.lockMinutes = Number(val());
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 35).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
    else throw new Error(`unknown option ${a}`);
  }
  if (o.states[0] === 'list') { for (const [k, s] of Object.entries(STATES)) console.log(`${k.padEnd(16)} ${s.what}`); process.exit(0); }
  for (const s of o.states) if (!STATES[s]) throw new Error(`unknown state ${s} (--states list)`);
  for (const w of o.windows) if (!WINDOWS.includes(w)) throw new Error(`unknown window ${w}`);
  for (const v of o.variants) if (!knownVariant(v)) throw new Error(`unknown variant ${v}`);
  if (!SIZES[o.size]) throw new Error(`unknown size ${o.size}`);
  o.out ||= path.join(__dirname, '.work', `stylers-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  return o;
}

// ---- the mods: every .js in the folder not starting with _ (TRIF's rule), read fresh for every run
function readMods(dir, variant) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_') && !f.startsWith('.')).sort();
  let mods = files.map((f) => ({ ...X.readMod(path.join(dir, f), `x.com/${f.replace(/\.js$/, '')}`), base: f }));
  if (variant.startsWith('@')) { // (a folder of patched copies: each replaces the mod of the same name)
    const alt = path.resolve(variant.slice(1).replace(/^~(?=\/)/, os.homedir()));
    mods = mods.map((m) => (fs.existsSync(path.join(alt, m.base)) ? { ...X.readMod(path.join(alt, m.base), m.id), base: m.base, patched: true } : m));
    return mods;
  }
  return applyVariant(variant, mods).map((m) => (m.patched ? { ...m, sha1: crypto.createHash('sha1').update(m.code).digest('hex') } : m));
}

// ---- in the page, before any mod: TRIF's log stand-in, seeded randomness, your saved style; a frame clock
// only while scrolling (an always-on requestAnimationFrame loop would itself keep the page drawing)
function PREAMBLE(cfg) {
  let s = cfg.seed >>> 0 || 1;
  Math.random = function random() { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const P = window.__perf = { frames: [], logs: [], mods: {}, errors: [], counting: false };
  const queue = [];
  P.whenRoot = (fn) => { if (document.documentElement) fn(); else queue.push(fn); };
  if (!document.documentElement) {
    const mo = new MutationObserver(() => { if (!document.documentElement) return; mo.disconnect(); for (const fn of queue.splice(0)) { try { fn(); } catch (e) { console.error(e); } } });
    mo.observe(document, { childList: true });
  }
  try { if (window.top === window) for (const [k, v] of Object.entries(cfg.storage)) localStorage.setItem(k, v); } catch {}
  const say = (lvl) => (...a) => { P.logs.push([performance.now(), lvl, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')]); };
  window.trif = { log: say('log'), warn: say('warn') };
  window.__webmods = { errors: P.errors, current: null };
  const tick = (t) => { if (!P.counting) return; P.frames.push(t); requestAnimationFrame(tick); };
  P.startFrames = () => { if (P.counting) return; P.counting = true; P.frames = []; requestAnimationFrame(tick); };
  P.stopFrames = () => { P.counting = false; };
  // (localStorage writes, by key: the "cache rewritten often" check)
  const set = Storage.prototype.setItem;
  P.writes = {};
  Storage.prototype.setItem = function setItem(k, v) { P.writes[k] = (P.writes[k] || 0) + 1; return set.call(this, k, v); };
}

// ---- the browser's CPU time by process kind (ps: user + system, cumulative), for the whole tree under it
function procCpu(rootPid) {
  const r = run('/bin/ps', ['-Ao', 'pid=,ppid=,time=,command=']);
  const procs = r.stdout.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map(([, pid, ppid, t, cmd]) => ({ pid: +pid, ppid: +ppid, s: t.split(':').reduce((a, x) => a * 60 + Number(x), 0), cmd }));
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = {};
  for (const todo = [...(kids.get(rootPid) || [])]; todo.length;) {
    const p = todo.pop();
    todo.push(...(kids.get(p.pid) || []));
    if (!/Google Chrome for Testing/.test(p.cmd)) continue;
    const kind = /--type=renderer/.test(p.cmd) ? 'renderer' : /--type=gpu-process/.test(p.cmd) ? 'gpu' : /--type=/.test(p.cmd) ? 'utility' : 'browser';
    out[kind] = (out[kind] || 0) + p.s;
  }
  return out;
}
const cpuDelta = (a, z, secs) => {
  const o = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(z)])) o[k] = round(((z[k] || 0) - (a[k] || 0)) * 1000 / secs, 0);
  o.total = Object.values(o).reduce((x, y) => x + y, 0);
  return o;
};

// ---- the page: what's styled, what's animating (a check that the run measured what it says)
const PAGE_STATE = `JSON.stringify((() => {
  const html = document.documentElement, attrs = [...html.attributes].map((a) => a.name).filter((n) => n.startsWith('data-pst-'));
  const anims = document.getAnimations();
  const byName = {};
  for (const a of anims) { const n = a.animationName || a.constructor.name; byName[n] = (byName[n] || 0) + 1; }
  return { els: document.getElementsByTagName('*').length, rows: document.querySelectorAll('[data-testid=cellInnerDiv]').length,
    articles: document.querySelectorAll('article').length, styledPosts: document.querySelectorAll('[data-ps-u]').length, rainbowPosts: document.querySelectorAll('[data-ps-r]').length,
    cards: document.querySelectorAll('[data-testid=UserCell][data-ps-u]').length, on: attrs.filter((n) => /^data-pst-(on|inherit)$/.test(n)), rainbow: attrs.filter((n) => n.startsWith('data-pst-r-')).map((n) => n.slice(11)),
    toggle: !!document.getElementById('pst-toggle'), panel: !!document.getElementById('pst-panel'), state: document.querySelector('#pst-toggle .pst-state')?.dataset.state || null,
    animations: anims.length, pinned: anims.filter((a) => a.startTime === 0).length, byName, smil: document.querySelectorAll('animateTransform').length, emoji: document.querySelectorAll('[data-pst-emoji], [data-ps-emoji]').length,
    writes: window.__perf.writes, warn: window.__perf.logs.filter((l) => l[1] === 'warn').map((l) => l[2].slice(0, 120)).slice(0, 5) };
})())`;

async function wheel(b, stopAt) {
  while (Date.now() < stopAt) {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 420, deltaX: 0, deltaY: 100 }).catch(() => {});
    await sleep(150);
  }
}
function scroller(b) {
  let stop = false;
  const loop = (async () => { while (!stop) await wheel(b, Date.now() + 500); })();
  return { stop: async () => { stop = true; await loop; } };
}

// ---- which selectors the style recalcs spent their time on (Chrome's selector stats, as DevTools' "Enable
// CSS selector stats": 3 s traced with disabled-by-default-blink.debug), the top 25 by time
async function selectorStats(b) {
  await b.browserSend('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['disabled-by-default-blink.debug', 'devtools.timeline'], excludedCategories: ['*'] } });
  await sleep(3000);
  const done = new Promise((resolve) => { const off = b.cdp.on((m) => { if (m.method === 'Tracing.tracingComplete') { off(); resolve(m.params.stream); } }); });
  await b.browserSend('Tracing.end');
  const stream = await done, parts = [];
  for (;;) { const r = await b.browserSend('IO.read', { handle: stream, size: 4 << 20 }); parts.push(r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data); if (r.eof) break; }
  await b.browserSend('IO.close', { handle: stream });
  const j = JSON.parse(parts.join('')), events = Array.isArray(j) ? j : j.traceEvents;
  const by = new Map();
  let total = 0;
  for (const e of events) {
    const list = e.name === 'SelectorStats' && e.args?.selector_stats?.selector_timings;
    if (!list) continue;
    for (const t of list) {
      const k = t.selector.replace(/\s+/g, ' ').slice(0, 220), v = by.get(k) || { us: 0, attempts: 0, matches: 0 };
      const us = t['elapsed (us)'] ?? t.elapsed ?? 0; v.us += us; v.attempts += t.match_attempts; v.matches += t.match_count; total += us; by.set(k, v);
    }
  }
  return { msPerS: round(total / 1000 / 3, 1), top: [...by].sort((a, z) => z[1].us - a[1].us).slice(0, 25).map(([k, v]) => ({ sel: k, msPerS: round(v.us / 1000 / 3, 2), attemptsPerS: Math.round(v.attempts / 3), matchesPerS: Math.round(v.matches / 3) })) };
}

// ---- one run: a fresh browser on the stand-in, the mods injected, the state set up, then each window
async function session(ctx, { variant, stateName }) {
  const st = STATES[stateName];
  const mods = readMods(ctx.o.dir, variant);
  for (const m of mods) { // (Tim edits these: a file that changes mid-run is noted)
    const was = ctx.seen.get(m.id + (m.patched ? `|${variant}` : ''));
    if (was && was !== m.sha1) ctx.log(`  NOTE: ${m.base} changed (${was.slice(0, 8)} → ${m.sha1.slice(0, 8)}, ${m.mtime})`);
    ctx.seen.set(m.id + (m.patched ? `|${variant}` : ''), m.sha1);
  }
  await takeLock(ctx.log);
  await waitForQuiet(ctx.log);
  const b = await new Browser({ ...SIZES[ctx.o.size], workDir: ctx.work }).start();
  const rec = { variant, state: stateName, size: ctx.o.size, chrome: b.version, at: new Date().toISOString(), load: { before: X.busyElsewhere(b.profile) },
    mods: mods.map(({ id, file, sha1, mtime, bytes, patched }) => ({ id, file, sha1, mtime, bytes, patched: !!patched })), windows: {}, blocked: [] };
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable'); await b.send('Performance.enable', { timeDomain: 'timeTicks' });
    b.cdp.on((m) => { if (m.sessionId === b.sid && m.method === 'Runtime.exceptionThrown') (rec.exceptions ||= []).push(m.params.exceptionDetails.exception?.description?.slice(0, 200) || m.params.exceptionDetails.text); });
    // every request through the suite: x.com goes on (to the stand-in), pbs.twimg.com is answered from disk,
    // anything else is refused (and noted)
    await b.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    b.cdp.on((m) => {
      if (m.sessionId !== b.sid || m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      let host = '';
      try { host = new URL(request.url).hostname; } catch {}
      if (host === 'x.com') { b.send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
      const pic = host === 'pbs.twimg.com' && /\/profile_images\/\d+\/(av\d+|me)_\w+\.png$/.exec(new URL(request.url).pathname);
      if (pic && ctx.pics.files[pic[1]]) {
        (ctx.picReads ||= {})[stateName] = (ctx.picReads[stateName] || 0) + 1;
        b.send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: fs.readFileSync(ctx.pics.files[pic[1]]).toString('base64'),
          responseHeaders: [{ name: 'content-type', value: 'image/png' }, { name: 'access-control-allow-origin', value: '*' }, { name: 'cache-control', value: 'max-age=604800' }] }).catch(() => {});
        return;
      }
      rec.blocked.push(request.url.slice(0, 120));
      b.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    const storage = { [STORE]: JSON.stringify(STYLES[st.mine]),
      dmFeedOptions: JSON.stringify({ reposts: true, quotes: true, replies: true, conversations: true, long: true, links: true, videos: true, images: true, nonMutuals: true }) };
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${PREAMBLE.toString()})(${JSON.stringify({ seed: 12345, storage })});` });
    for (const src of await X.modScripts(mods)) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    await b.send('Page.navigate', { url: `https://x.com:${ctx.port}${st.path}?pbs=1&theme=dark` });
    for (let i = 0; i < 120; i++) { await sleep(250); if (await b.eval('!!window.__xLoaded && document.readyState === "complete"').catch(() => false)) break; }
    await sleep(2000); // (the pictures read, the styles applied)
    if (st.panel) {
      let r = null;
      for (let i = 0; i < 20 && !r; i++) { r = await b.eval('(() => { const t = document.getElementById("pst-toggle"); if (!t) return null; const r = t.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()'); if (!r) await sleep(250); }
      if (r) {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
        await sleep(300);
        await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 420 }); // (off the button: no hover)
      } else rec.panelMissing = true;
    }
    await sleep(2500); // (settled)
    rec.page = JSON.parse(await b.eval(PAGE_STATE));
    if (ctx.o.eval) { rec.evalResult = await b.eval(ctx.o.eval).catch((e) => `error: ${e.message}`); ctx.log(`    eval (${stateName} ${variant}): ${JSON.stringify(rec.evalResult).slice(0, 1500)}`); }
    if (ctx.o.shots) { // (a look at the page, for checking the stand-in and a fix's look)
      // (--look-at MS: every animation, CSS and SVG, stopped where it is MS ms after it began, as if all had
      // begun together: the same moment for any two variants, so their screenshots can be compared pixel for
      // pixel; not for the measurements, which come after it in a page left running)
      if (ctx.o.lookAt != null) {
        await b.eval(`(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ${ctx.o.lookAt}; }
          for (const svg of document.querySelectorAll('svg')) if (svg.querySelector('animate, animateTransform')) { svg.pauseAnimations(); svg.setCurrentTime(${ctx.o.lookAt} / 1000); } })()`);
        await b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
      }
      const { data } = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(ctx.o.shots, { recursive: true });
      fs.writeFileSync(path.join(ctx.o.shots, `${stateName}-${variant.replace(/[^\w.-]+/g, '_')}.png`), Buffer.from(data, 'base64'));
    }
    for (const wname of ctx.o.lookAt != null ? [] : ctx.o.windows) {
      const scroll = wname === 'scroll';
      const w = {};
      let drv = null;
      if (scroll) { await b.eval('__perf.startFrames()'); drv = scroller(b); await sleep(1000); }
      const m0 = await X.metrics(b), c0 = procCpu(b.proc.pid), t0 = Date.now(), f0 = await b.eval('performance.now()');
      await sleep(ctx.o.seconds * 1000);
      const m1 = await X.metrics(b), c1 = procCpu(b.proc.pid), secs = (Date.now() - t0) / 1000, f1 = await b.eval('performance.now()');
      w.cpu = cpuDelta(c0, c1, secs);
      w.metrics = X.metricsDelta(m0, m1);
      if (scroll) w.frames = frameStats(JSON.parse(await b.eval(`JSON.stringify(__perf.frames.filter((t) => t >= ${f0} && t <= ${f1}))`)));
      if (ctx.o.trace) {
        await X.traceStart(b); await sleep(3000);
        const { events, bytes } = await X.traceEnd(b);
        w.trace = traceSummary(events); w.traceMB = round(bytes / 1048576, 1);
        // (frames: the renderer's commits, and the GPU process's swaps; every event name with "frame" or
        // "swap" in it counted, per second, to see which this Chrome writes)
        const names = {};
        for (const e of events) if ((e.ph === 'X' || e.ph === 'B' || e.ph === 'b' || e.ph === 'I' || e.ph === 'i') && /frame|swap|commit|draw/i.test(e.name)) names[e.name] = (names[e.name] || 0) + 1;
        w.frameEvents = Object.fromEntries(Object.entries(names).map(([n, c]) => [n, round(c / w.trace.seconds, 1)]));
        w.drawnPerS = w.frameEvents['Display::FrameDisplayed'] ?? 0; // (frames the GPU process put on screen)
        w.mainFramesPerS = w.frameEvents.BeginMainThreadFrame ?? 0; // (frames the page's main thread worked on)
      }
      if (ctx.o.selectorStats) w.selectors = await selectorStats(b);
      if (ctx.o.profile) { await X.profileStart(b); await sleep(3000); w.profile = profileSummary(await X.profileStop(b)); }
      if (drv) { await drv.stop(); await b.eval('__perf.stopFrames()'); await sleep(500); }
      w.page = JSON.parse(await b.eval(PAGE_STATE));
      rec.windows[wname] = w;
    }
    rec.load.after = X.busyElsewhere(b.profile);
    rec.memory = X.treeRss(b.proc.pid);
    rec.errors = await b.eval('JSON.stringify(__perf.errors.map((e) => e.mod + ": " + e.message))').then(JSON.parse);
  } finally {
    await b.close();
    await turnOver();
  }
  return rec;
}

// ---- the summary: per variant, state and window, the median of the runs
function summarise(records) {
  const groups = new Map();
  for (const r of records) for (const [wname, w] of Object.entries(r.windows)) {
    const k = `${r.variant}|${r.state}|${wname}`;
    if (!groups.has(k)) groups.set(k, { variant: r.variant, state: r.state, window: wname, ws: [], loads: [], mods: r.mods });
    groups.get(k).ws.push(w); groups.get(k).loads.push(((r.load?.before?.otherCpu || 0) + (r.load?.after?.otherCpu || 0)) / 2);
  }
  const out = [];
  for (const g of groups.values()) {
    const med = (f) => round(median(g.ws.map(f).filter((x) => x != null)), 1);
    const tr = g.ws.filter((w) => w.trace), pr = g.ws.filter((w) => w.profile);
    const kinds = new Set(tr.flatMap((w) => Object.keys(w.trace.mainMs)));
    const main = Object.fromEntries([...kinds].map((k) => [k, round(median(tr.map((w) => w.trace.mainMs[k] || 0)), 1)]));
    const threads = new Set(tr.flatMap((w) => Object.keys(w.trace.threads)));
    const modFn = new Map();
    for (const w of pr) for (const f of w.profile.modTotal) { const k = `${f.fn} ${f.url}:${f.line}`; const e = modFn.get(k) || { self: 0, total: 0 }; e.self += f.ms / pr.length; e.total += f.total / pr.length; modFn.set(k, e); }
    const under = {};
    for (const w of pr) for (const [k, ms] of Object.entries(w.profile.underMod || {})) under[k] = round((under[k] || 0) + ms / pr.length, 2);
    const top = new Map();
    for (const w of tr) for (const [n, ms] of w.trace.topEvents) top.set(n, (top.get(n) || 0) + ms / tr.length);
    out.push({
      variant: g.variant, state: g.state, window: g.window, runs: g.ws.length,
      cpu: { total: med((w) => w.cpu.total), renderer: med((w) => w.cpu.renderer), gpu: med((w) => w.cpu.gpu), browser: med((w) => w.cpu.browser) },
      taskMsPerS: med((w) => w.metrics.taskMsPerS), scriptMsPerS: med((w) => w.metrics.scriptMsPerS), recalcMsPerS: med((w) => w.metrics.recalcMsPerS), layoutMsPerS: med((w) => w.metrics.layoutMsPerS),
      mainBusy: tr.length ? round(median(tr.map((w) => w.trace.mainBusy)), 1) : null, main,
      threads: Object.fromEntries([...threads].map((k) => [k, round(median(tr.map((w) => w.trace.threads[k] || 0)), 1)])),
      drawnPerS: med((w) => w.drawnPerS), mainFramesPerS: med((w) => w.mainFramesPerS),
      recalc: tr.length ? { perS: round(median(tr.map((w) => w.trace.recalcs?.perSecond)), 1), elementsPerS: round(median(tr.map((w) => w.trace.recalcs?.elementsPerSecond)), 0), medianElements: round(median(tr.map((w) => w.trace.recalcs?.medianElements)), 0) } : null,
      paintMs: tr.length ? round(median(tr.map((w) => (w.trace.mainMs.paint || 0) + (w.trace.mainMs.prepaint || 0))), 1) : null,
      fps: med((w) => w.frames?.fps), p95: med((w) => w.frames?.p95), p99: med((w) => w.frames?.p99), long50: med((w) => w.frames?.long50),
      animations: med((w) => w.page?.animations), byName: g.ws[0]?.page?.byName, els: med((w) => w.page?.els),
      otherCpu: round(median(g.loads), 0),
      topEvents: [...top].sort((a, z) => z[1] - a[1]).slice(0, 10).map(([n, ms]) => `${n} ${round(ms, 1)}`),
      gpuTop: tr[0]?.trace.threadTop || null,
      selectors: g.ws.find((w) => w.selectors)?.selectors || null,
      perMod: under,
      modFunctions: [...modFn].sort((a, z) => z[1].total - a[1].total).slice(0, 12).map(([k, e]) => `${k} total ${round(e.total, 2)} self ${round(e.self, 2)} ms/s`),
      mods: g.mods.filter((m) => /styler|inherit|encoder|rave/.test(m.id)).map((m) => `${m.id.slice(6)} ${m.sha1.slice(0, 8)}${m.patched ? '*' : ''}`),
    });
  }
  const order = Object.keys(STATES);
  out.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state) || WINDOWS.indexOf(a.window) - WINDOWS.indexOf(z.window) || a.variant.localeCompare(z.variant));
  return out;
}
const gpuMs = (s) => round((s.threads?.CrGpuMain || 0) + (s.threads?.VizCompositorThread || 0), 1);
const biggest = (s) => {
  const parts = Object.entries(s.main || {}).filter(([k]) => k !== 'other').sort((a, z) => z[1] - a[1]);
  const fn = s.modFunctions?.[0]?.replace(/ total ([\d.]+).*$/, ' ($1 ms/s)');
  return `${parts[0] ? `${parts[0][0]} ${parts[0][1]}` : ''}${fn ? `; ${fn}` : ''}`;
};
function table(summary) {
  const rows = ['| state | window | variant | CPU ms/s: all (renderer / GPU proc / browser) | main thread busy ms/s | of it: script / style / layout / paint / composite | GPU+viz threads ms/s | frames drawn/s (main-thread frames) | fps / p95 / p99 (scroll) | style recalcs/s (elements each) | animations | biggest cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const s of summary) {
    const m = s.main || {};
    rows.push(`| ${s.state} | ${s.window} | ${s.variant.startsWith('@') ? path.basename(s.variant) : s.variant} | ${s.cpu.total} (${s.cpu.renderer} / ${s.cpu.gpu} / ${s.cpu.browser}) | ${s.mainBusy ?? s.taskMsPerS} | ${round((m.script || 0) + (m.compile || 0), 1)} / ${m.style ?? 0} / ${m.layout ?? 0} / ${round((m.prepaint || 0) + (m.paint || 0), 1)} / ${m.composite ?? 0} | ${gpuMs(s)} | ${s.drawnPerS ?? ''} (${s.mainFramesPerS ?? ''}) | ${s.fps != null ? `${s.fps} / ${s.p95} / ${s.p99}` : ''} | ${s.recalc ? `${s.recalc.perS} (${s.recalc.medianElements})` : ''} | ${s.animations} | ${biggest(s)} |`);
  }
  return rows.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.lock) setLock(o.lock, o.lockMinutes);
  fs.mkdirSync(o.out, { recursive: true });
  const work = path.join(__dirname, '.work', 'stylers-cache');
  fs.mkdirSync(work, { recursive: true });
  const logFile = path.join(o.out, 'log.txt');
  const log = (s) => { console.log(s); fs.appendFileSync(logFile, `${s}\n`); };
  const srv = await startXPage(work, { seed: 1 });
  const ctx = { o, work, port: srv.port, log, seen: new Map() };
  { // the stamped pictures (made once per Style Encoder version, by its own code, in a browser of their own)
    await takeLock(log); await waitForQuiet(log);
    const b = await new Browser({ ...SIZES[o.size], workDir: work }).start();
    try { ctx.pics = await stampPictures(b, ctx.port, work, path.join(o.dir, 'style-encoder.js')); } finally { await b.close(); }
    log(`  pictures: ${ctx.pics.dir} (style-encoder.js ${ctx.pics.encoderSha1.slice(0, 8)})`);
  }
  const jsonl = path.join(o.out, 'results.jsonl');
  const records = [];
  log(`stylers perf → ${o.out}\n  mods: ${o.dir}\n  states: ${o.states.join(', ')}; windows: ${o.windows.join(', ')}; variants: ${o.variants.join(', ')}; ${o.runs} runs; ${o.size}`);
  try {
    for (const stateName of o.states) for (let i = 0; i < o.runs; i++) for (const variant of o.variants) {
      const t0 = Date.now();
      let r;
      try { r = await session(ctx, { variant, stateName }); } catch (e) { log(`  ${stateName} ${variant} #${i + 1}: FAILED ${e.stack || e.message}`); continue; }
      records.push(r);
      fs.appendFileSync(jsonl, `${JSON.stringify(r)}\n`);
      const pg = r.page;
      log(`  ${stateName} ${variant} #${i + 1} (${round((Date.now() - t0) / 1000, 0)}s) page: ${pg.els} els, ${pg.animations} anims, styled ${pg.styledPosts}/${pg.articles} (rainbow ${pg.rainbowPosts}), cards ${pg.cards}, on ${pg.on.join(',')}, r ${pg.rainbow.length}, panel ${pg.panel}, state ${pg.state} | ${Object.entries(r.windows).map(([wn, w]) => `${wn}: cpu ${w.cpu.total} (r ${w.cpu.renderer} g ${w.cpu.gpu}) main ${w.trace?.mainBusy} drawn ${w.drawnPerS}/s (main ${w.mainFramesPerS})${w.frames ? ` fps ${w.frames.fps} p95 ${w.frames.p95}` : ''}`).join(' | ')} | elsewhere ${r.load.before.otherCpu}%→${r.load.after?.otherCpu}%${r.blocked.length ? ` | BLOCKED ${r.blocked.length}: ${r.blocked.slice(0, 2).join(' ')}` : ''}${r.exceptions?.length || r.errors?.length ? ` | errors ${[...(r.errors || []), ...(r.exceptions || [])].slice(0, 2).join(' | ')}` : ''}`);
      const summary = summarise(records);
      fs.writeFileSync(path.join(o.out, 'summary.json'), JSON.stringify(summary, null, 1));
      fs.writeFileSync(path.join(o.out, 'summary.md'), `# X stylers perf (${o.size})\n\n${table(summary)}\n`);
    }
    log(`\n${table(summarise(records))}\n\nsummary: ${path.join(o.out, 'summary.md')}`);
  } finally {
    releaseLock();
    await srv.close();
  }
}

if (require.main === module) main().then(() => process.exit(0), (e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { STATES, summarise, table };
