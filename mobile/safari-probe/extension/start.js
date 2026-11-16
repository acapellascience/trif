// At the very start of every page, in the extension's own world (after gen/kit.js). It notes how early that
// was, then does what a TRIF for Safari would do on each load: read the hide rules for this site from
// storage and apply them. What matters is whether that lands before the page first paints.
(() => {
  'use strict';
  if (window.top !== window) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const root = () => document.documentElement;
  const snap = () => ({
    ms: Math.round(performance.now() * 10) / 10, readyState: document.readyState,
    pageRan: root() ? root().getAttribute('data-page-ran') !== null : false,
    head: !!document.head, body: !!document.body, scripts: document.scripts.length, elements: document.getElementsByTagName('*').length,
  });
  const rec = { host: location.hostname, start: snap(), storage: null, background: null, applied: null, way: null, rules: 0, paintMs: null, after: null };
  globalThis.__trifProbeStart = rec;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') rec.paintMs = Math.round(e.startTime * 10) / 10; })
      .observe({ type: 'paint', buffered: true });
  } catch { /* no paint timing here */ }
  let selectors = [];
  const apply = () => {
    if (!selectors.length || !globalThis.__trifKit) return;
    rec.way = globalThis.__trifKit.hide(selectors);
    rec.applied = rec.applied || snap();
  };
  globalThis.__trifProbeRules = (list) => { selectors = list; apply(); };
  Promise.resolve(api.storage.local.get('hideRules')).then((s) => {
    rec.storage = snap();
    selectors = (((s && s.hideRules) || {})[location.hostname] || []).map((r) => r.selector);
    rec.rules = selectors.length;
    apply();
  }, (e) => { rec.storage = { error: String(e && e.message) }; });
  Promise.resolve(api.runtime.sendMessage({ type: 'pageStart' })).then(() => { rec.background = snap(); }, (e) => { rec.background = { error: String(e && e.message) }; });
  if (/\/trif-install$/.test(location.pathname)) api.runtime.sendMessage({ type: 'modLink', url: location.href, start: rec.start }).catch(() => {});
  // a few seconds in: do the saved rules still find anything, and did hiding beat the first paint
  setTimeout(() => {
    rec.after = { ...snap(), matches: globalThis.__trifKit ? globalThis.__trifKit.matchesOf(selectors) : null };
    api.runtime.sendMessage({ type: 'loadLog', rec }).catch(() => {});
  }, 3000);
})();
