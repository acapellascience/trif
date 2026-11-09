'use strict';
// Summaries of what a run recorded: frame times (requestAnimationFrame), a Chrome trace (where the main
// thread's time went, by kind of work, and how busy the other threads were), a CPU profile (the hottest
// functions, the mods' by file and line).

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : NaN);
const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/** rAF timestamps (ms) → frame stats. */
function frameStats(ts) {
  const d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  const s = [...d].sort((a, b) => a - b);
  const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  return {
    frames: d.length, seconds: round(span / 1000, 2),
    fps: round(d.length && span ? (1000 * d.length) / span : NaN), // (frames shown over the window)
    fpsMedian: round(1000 / median(d)), // (from the typical frame)
    p50: round(pct(s, 50), 2), p95: round(pct(s, 95), 2), p99: round(pct(s, 99), 2), max: round(s[s.length - 1], 1),
    long50: d.filter((x) => x > 50).length, // frames over 50 ms
    over20: d.filter((x) => x > 20).length, // (a missed frame at 60 Hz)
    missed: Math.round(d.reduce((a, x) => a + Math.max(0, Math.round(x / (1000 / 60)) - 1), 0)), // 60 Hz frames skipped
  };
}

// Kinds of main-thread work, by trace event name (self time: an event's own time, its children's taken out)
const KIND = new Map(Object.entries({
  FunctionCall: 'script', EvaluateScript: 'script', 'v8.compile': 'compile', 'v8.compileModule': 'compile', 'V8.CompileCode': 'compile',
  'v8.parseOnBackground': 'compile', 'V8.ScriptCompiler': 'compile', 'v8.produceCache': 'compile', 'v8.deserializeOnBackground': 'compile',
  TimerFire: 'script', FireAnimationFrame: 'script', EventDispatch: 'script', 'v8.run': 'script', RunMicrotasks: 'script', 'v8.callFunction': 'script',
  FireIdleCallback: 'script', XHRReadyStateChange: 'script', XHRLoad: 'script', 'V8.Execute': 'script', 'v8.evaluateModule': 'script',
  'MutationObserver callback': 'script', 'BlinkScheduler_PerformMicrotaskCheckpoint': 'script', 'V8.HandleInterrupts': 'script',
  UpdateLayoutTree: 'style', RecalculateStyles: 'style', ParseAuthorStyleSheet: 'style', 'Document::updateStyleAndLayoutTree': 'style',
  'Blink.Style.Update': 'style', 'StyleEngine::UpdateActiveStyle': 'style', 'Document::UpdateStyle': 'style',
  Layout: 'layout', 'LocalFrameView::layout': 'layout', 'LayoutShift': 'layout', IntersectionObserverController: 'layout', ResizeObserverController: 'layout',
  UpdateLayerTree: 'prepaint', PrePaint: 'prepaint', 'LocalFrameView::RunPrePaintLifecyclePhase': 'prepaint',
  Paint: 'paint', PaintImage: 'paint', PaintSetup: 'paint', 'Decode Image': 'paint', 'Draw LazyPixelRef': 'paint', 'LocalFrameView::RunPaintLifecyclePhase': 'paint',
  'RasterImplementation::RasterCHROMIUM': 'canvas', 'CanvasResourceProvider::FlushCanvas': 'canvas', 'Canvas2DLayerBridge::FlushRecording': 'canvas',
  'CanvasRenderingContext2D::FinalizeFrame': 'canvas', 'CanvasResourceProvider::ProduceCanvasResource': 'canvas', 'Canvas2D.Flush': 'canvas',
  'HitTest': 'hittest',
  Layerize: 'composite', CompositeLayers: 'composite', Commit: 'composite', 'cc::LayerTreeHost::UpdateLayers': 'composite', UpdateLayer: 'composite', 'Animation': 'composite',
  MinorGC: 'gc', MajorGC: 'gc', 'BlinkGC.AtomicPhase': 'gc', 'BlinkGC.AtomicPauseMarkEpilogue': 'gc', 'V8.GCScavenger': 'gc', 'V8.GCCompactor': 'gc',
  'V8.GCFinalizeMC': 'gc', 'V8.GCIncrementalMarking': 'gc', 'V8.GC_MC_COMPLETE_SWEEPING': 'gc', 'V8.GCFinalizeMCReduceMemory': 'gc', 'BlinkGC.IncrementalMarkingStep': 'gc',
  'CppGC.IncrementalMark': 'gc', 'CppGC.AtomicMark': 'gc', 'CppGC.AtomicSweep': 'gc', 'V8.GCIncrementalMarkingStart': 'gc', 'V8.GCIncrementalMarkingFinalize': 'gc',
  'V8.GC_MC_BACKGROUND_MARKING': 'gc', 'V8.GCMinorMS': 'gc', 'V8.GC_SCAVENGER_SCAVENGE': 'gc', 'V8.GC_HEAP_EXTERNAL_PROLOGUE': 'gc', 'V8.GC_HEAP_EXTERNAL_EPILOGUE': 'gc',
  ParseHTML: 'loading', ResourceSendRequest: 'loading', ResourceReceiveResponse: 'loading', ResourceFinish: 'loading',
}));
const kindOf = (name) => KIND.get(name) || (/^V8\.GC|GC\b|^BlinkGC|^CppGC/.test(name) ? 'gc' : /^V8\.|^v8\./.test(name) ? 'script' : 'other');

/**
 * A Chrome trace's events → {mainMs: {kind: ms per second}, mainBusy, threads: {name: ms per second},
 * recalcs: {count, elements (all), maxElements, perSecond}, layouts: {...}, topEvents: [[name, ms/s]]}.
 * `window`: [startUs, endUs] in trace time (else all of it).
 */
function traceSummary(events, { window } = {}) {
  const threadNames = new Map(); // "pid:tid" → name
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== 'X' && e.ph !== 'B' && e.ph !== 'E') continue;
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  // the page's main thread: the renderer main thread with the most work
  let main = null, mainN = -1;
  for (const [k, list] of byThread) if (threadNames.get(k) === 'CrRendererMain' && list.length > mainN) { main = k; mainN = list.length; }
  const [w0, w1] = window || [Infinity, -Infinity];
  let lo = w0, hi = w1;
  if (!window) for (const list of byThread.values()) for (const e of list) { lo = Math.min(lo, e.ts); hi = Math.max(hi, e.ts + (e.dur || 0)); }
  const secs = Math.max(1e-6, (hi - lo) / 1e6);
  // complete events with durations, B/E paired, per thread, clipped to the window
  const spans = (list) => {
    const out = [], open = [];
    for (const e of [...list].sort((a, b) => a.ts - b.ts)) {
      if (e.ph === 'X') out.push({ name: e.name, ts: e.ts, end: e.ts + (e.dur || 0), args: e.args });
      else if (e.ph === 'B') open.push(e);
      else if (e.ph === 'E') { for (let i = open.length - 1; i >= 0; i--) if (open[i].name === e.name || !e.name) { const b = open.splice(i, 1)[0]; out.push({ name: b.name, ts: b.ts, end: e.ts, args: { ...b.args, ...e.args } }); break; } }
    }
    return out.filter((s) => s.end > lo && s.ts < hi).map((s) => ({ ...s, ts: Math.max(s.ts, lo), end: Math.min(s.end, hi) }))
      .sort((a, b) => a.ts - b.ts || b.end - a.end);
  };
  const selfTimes = (sp) => { // nesting by time: each span's own time, children's taken out
    const self = new Map(), stack = [];
    let top = 0;
    for (const s of sp) {
      while (stack.length && stack[stack.length - 1].end <= s.ts) stack.pop();
      const parent = stack[stack.length - 1];
      s.self = s.end - s.ts;
      if (parent) parent.self -= Math.min(s.end, parent.end) - s.ts; else top += s.end - s.ts;
      stack.push(s);
    }
    for (const s of sp) self.set(s.name, (self.get(s.name) || 0) + Math.max(0, s.self));
    return { self, top };
  };
  const out = { seconds: Math.round(secs * 100) / 100, mainMs: {}, mainBusy: 0, threads: {}, topEvents: [], recalcs: null, layouts: null };
  if (main) {
    const sp = spans(byThread.get(main));
    const { self, top } = selfTimes(sp);
    out.mainBusy = round(top / 1000 / secs);
    for (const [name, us] of self) { const k = kindOf(name); out.mainMs[k] = (out.mainMs[k] || 0) + us / 1000 / secs; }
    for (const k of Object.keys(out.mainMs)) out.mainMs[k] = round(out.mainMs[k], 2);
    out.topEvents = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, us]) => [n, round(us / 1000 / secs, 2)]);
    const recalcs = sp.filter((s) => s.name === 'UpdateLayoutTree' || s.name === 'RecalculateStyles');
    const els = recalcs.map((s) => s.args?.elementCount ?? s.args?.data?.elementCount ?? 0);
    out.recalcs = { perSecond: round(recalcs.length / secs), msPerSecond: round(recalcs.reduce((a, s) => a + (s.end - s.ts), 0) / 1000 / secs, 2),
      elementsPerSecond: Math.round(els.reduce((a, b) => a + b, 0) / secs), maxElements: Math.max(0, ...els), medianElements: median(els) };
    const lays = sp.filter((s) => s.name === 'Layout');
    const dirty = lays.map((s) => s.args?.beginData?.dirtyObjects ?? 0), totalObj = lays.map((s) => s.args?.beginData?.totalObjects ?? 0);
    out.layouts = { perSecond: round(lays.length / secs), msPerSecond: round(lays.reduce((a, s) => a + (s.end - s.ts), 0) / 1000 / secs, 2),
      medianDirty: median(dirty), maxTotal: Math.max(0, ...totalObj) };
    // forced (inside script) vs the frame's own style and layout
    const forced = sp.filter((s) => (s.name === 'UpdateLayoutTree' || s.name === 'Layout') && sp.some((p) => p !== s && (p.name === 'FunctionCall' || p.name === 'EvaluateScript' || p.name === 'TimerFire' || p.name === 'FireAnimationFrame') && p.ts <= s.ts && p.end >= s.end));
    out.forcedStyleLayoutMs = round(forced.reduce((a, s) => a + (s.end - s.ts), 0) / 1000 / secs, 2);
  }
  // other threads: busy time of their top-level events (ms per second), grouped by name
  for (const [k, list] of byThread) {
    if (k === main) continue;
    const name = (threadNames.get(k) || 'thread').replace(/\d+$/, '');
    if (!/Compositor|Viz|Gpu|GPU|Raster|TileWorker|ThreadPool|Audio|Chrome_ChildIOThread|CrBrowserMain|CrRendererMain|DedicatedWorker/.test(name)) continue;
    const { top, self } = selfTimes(spans(list));
    const key = k.split(':')[0] === main?.split(':')[0] ? `renderer:${name}` : name;
    out.threads[key] = round((out.threads[key] || 0) + top / 1000 / secs, 2);
    if (/Gpu|Viz|^Compositor$/.test(name)) (out.threadTop ||= {})[key] = [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, us]) => [n, round(us / 1000 / secs, 2)]);
  }
  // frames, as the compositor counted them
  const pres = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.ts >= lo && e.ts <= hi);
  if (pres.length) {
    const states = {};
    for (const e of pres) { const st = e.args?.chrome_frame_reporter?.state || 'unknown'; states[st] = (states[st] || 0) + 1; }
    out.pipeline = states;
  }
  return out;
}

/** A CPU profile → hottest functions overall (self ms per second), and per mod script (with file lines). */
function profileSummary(profile, { lineOffset = 0, top = 20 } = {}) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const selfUs = new Map();
  for (let i = 0; i < profile.samples.length; i++) selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) || 0) + (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0));
  const secs = (profile.endTime - profile.startTime) / 1e6;
  const key = (cf) => `${cf.functionName || '(anonymous)'}|${cf.url}|${cf.lineNumber}`;
  const self = new Map(), total = new Map();
  for (const [id, us] of selfUs) {
    const n = nodes.get(id); if (!n) continue;
    const k = key(n.callFrame);
    self.set(k, (self.get(k) || 0) + us);
    // inclusive: once per distinct function up the stack
    const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)) {
      const pk = key(nodes.get(p).callFrame);
      if (seen.has(pk)) continue; seen.add(pk);
      total.set(pk, (total.get(pk) || 0) + us);
    }
  }
  const fmt = ([k, us]) => { const [fn, url, line] = k.split('|'); return { fn, url: url.replace(/^trif:\/\//, ''), line: url.startsWith('trif://') ? Number(line) + lineOffset : Number(line) + 1, ms: round(us / 1000 / secs, 2), total: round((total.get(k) || 0) / 1000 / secs, 2) }; };
  const sorted = [...self].sort((a, b) => b[1] - a[1]);
  const byUrl = {};
  for (const [k, us] of self) { const url = k.split('|')[1] || '(native/browser)'; byUrl[url] = (byUrl[url] || 0) + us / 1000 / secs; }
  for (const u of Object.keys(byUrl)) byUrl[u] = round(byUrl[u], 2);
  return {
    seconds: round(secs, 2), byUrl,
    top: sorted.slice(0, top).map(fmt),
    mod: sorted.filter(([k]) => k.includes('trif://')).slice(0, top).map(fmt),
    modTotal: [...total].filter(([k]) => k.includes('trif://')).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => fmt([k, self.get(k) || 0])),
  };
}

module.exports = { frameStats, traceSummary, profileSummary, median, round, pct };
