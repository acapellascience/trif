// The probe's script in TRIF's own world ("trif"), at document start in every frame: records whether it ran
// before the page's first script, then (once the body is there) adds a <style> and an adopted sheet, tries
// eval, and checks it sees neither the page's globals nor the box's.
(() => {
  const bridge = globalThis.trifOwn, now = () => performance.now();
  const de = document.documentElement;
  globalThis.__trifOwnMark = 1;
  const start = { t: Math.round(now() * 10) / 10, readyState: document.readyState, pageRan: !!(de && de.hasAttribute('data-page-ran')) };
  if (window !== top) { try { parent.postMessage({ trifProbeFrame: { world: 'own', href: location.href, start, listener: typeof bridge } }, '*'); } catch (e) { /* no parent */ } }
  const run = () => {
    const root = document.documentElement, read = (n) => getComputedStyle(root).getPropertyValue(n).trim() === '1';
    const out = {};
    try { const st = document.createElement('style'); st.textContent = ':root { --trif-probe-tag: 1 }'; (document.head || root).append(st); out.styleElement = read('--trif-probe-tag'); } catch (e) { out.styleElement = `error: ${e.message}`; }
    try { const sh = new CSSStyleSheet(); sh.replaceSync(':root { --trif-probe-adopted: 1 }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; out.adoptedSheet = read('--trif-probe-adopted'); } catch (e) { out.adoptedSheet = `error: ${e.message}`; }
    try { out.eval = String((0, eval)('20 + 22')); } catch (e) { out.eval = `refused: ${e.message}`; }
    try { out.Function = String(new Function('return 20 + 22')()); } catch (e) { out.Function = `refused: ${e.message}`; }
    const seen = { pageMark: typeof globalThis.__probePage, pageTampered: typeof globalThis.__probeTampered, lockdown: typeof globalThis.lockdown,
      sandbox: typeof globalThis.__trifSandbox, boxListener: typeof globalThis.trifBox, pageListener: typeof globalThis.probePage, arrayFrozen: Object.isFrozen(Array.prototype),
      mapWorks: String([1, 2].map((x) => x * 2)) === '2,4' };
    const msg = { world: 'own', href: location.href, top: window === top, start, out, seen,
      checks: { 'B4.start': start.readyState === 'loading' && !start.pageRan, 'B2.styleElement': out.styleElement === true, 'B2.adoptedSheet': out.adoptedSheet === true,
        'B3.ownSeesNoBoxOrPage': seen.pageMark === 'undefined' && seen.pageTampered === 'undefined' && seen.lockdown === 'undefined' && seen.sandbox === 'undefined'
          && seen.boxListener === 'undefined' && seen.pageListener === 'undefined' && !seen.arrayFrozen && seen.mapWorks } };
    bridge.postMessage(JSON.stringify(msg));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
