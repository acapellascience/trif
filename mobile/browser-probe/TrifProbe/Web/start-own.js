// At the very start of every page, in TRIF's world (after kit.js). The app adds the call at the end, with
// the hide rules for every site as its argument: they're in the script itself, so nothing is waited for.
// It notes how early it ran, hides what the rules say, and a few seconds in tells the app how it went.
(function (RULES) {
  'use strict';
  if (window.top !== window) return;
  const root = () => document.documentElement;
  const snap = () => ({
    ms: Math.round(performance.now() * 10) / 10, readyState: document.readyState,
    pageRan: root() ? root().getAttribute('data-page-ran') !== null : false,
    head: !!document.head, body: !!document.body, scripts: document.scripts.length, elements: document.getElementsByTagName('*').length,
  });
  const selectors = RULES[location.hostname] || [];
  const rec = { host: location.hostname, start: snap(), applied: null, way: null, rules: selectors.length, paintMs: null, after: null };
  globalThis.__trifProbeStart = rec;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') rec.paintMs = Math.round(e.startTime * 10) / 10; })
      .observe({ type: 'paint', buffered: true });
  } catch (e) { /* no paint timing here */ }
  if (selectors.length && globalThis.__trifKit) { rec.way = globalThis.__trifKit.hide(selectors); rec.applied = snap(); }
  setTimeout(() => {
    rec.after = Object.assign(snap(), { matches: globalThis.__trifKit ? globalThis.__trifKit.matchesOf(selectors) : null });
    try { window.webkit.messageHandlers.trif.postMessage({ type: 'load', rec: JSON.stringify(rec) }); } catch (e) { /* no app listening */ }
  }, 3000);
})
