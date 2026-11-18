// The probe's script in the PAGE's own world (where free mods would run), at document start in every frame.
// It keeps the real JSON.stringify before hostile.js swaps it, records whether it ran before the page's first
// script, and on load reports what the page's world can see of the other two worlds. The listener it reports
// to (probePage) exists only for the probe; TRIF itself would have none in the page's world.
(() => {
  const stringify = JSON.stringify, bridge = globalThis.probePage, now = () => performance.now();
  const de = document.documentElement;
  const start = { t: Math.round(now() * 10) / 10, readyState: document.readyState, pageRan: !!(de && de.hasAttribute('data-page-ran')) };
  if (window !== top) { try { parent.postMessage({ trifProbeFrame: { world: 'page', href: location.href, start, listener: typeof bridge } }, '*'); } catch (e) { /* no parent */ } }
  // what each world in each frame said at its start (frames tell their parent; cross-origin ones too)
  const frameMsgs = [];
  addEventListener('message', (e) => { if (e.data && e.data.trifProbeFrame) frameMsgs.push(e.data.trifProbeFrame); });
  const report = () => {
    const seen = {
      lockdown: typeof globalThis.lockdown, Compartment: typeof globalThis.Compartment, harden: typeof globalThis.harden,
      sandbox: typeof globalThis.__trifSandbox, boxListener: typeof globalThis.trifBox, ownListener: typeof globalThis.trifOwn,
      ownMark: typeof globalThis.__trifOwnMark, arrayFrozen: Object.isFrozen(Array.prototype),
    };
    let boxCall = 'no listener here';
    if (seen.boxListener !== 'undefined') { try { globalThis.trifBox.postMessage('the page calling the box'); boxCall = 'posted'; } catch (e) { boxCall = `threw: ${e.message}`; } }
    const hidden = seen.lockdown === 'undefined' && seen.Compartment === 'undefined' && seen.sandbox === 'undefined' && seen.boxListener === 'undefined'
      && seen.ownListener === 'undefined' && seen.ownMark === 'undefined' && !seen.arrayFrozen;
    const checks = { 'B4.start': start.readyState === 'loading' && !start.pageRan, 'B3.pageSeesNoBox': hidden };
    let frames;
    if (window === top) {
      const byHref = {};
      for (const m of frameMsgs) (byHref[m.href] = byHref[m.href] || {})[m.world] = m.start.readyState === 'loading' && !m.start.pageRan && m.listener === 'object';
      const count = document.getElementsByTagName('iframe').length;
      frames = { iframes: count, reported: byHref };
      const hrefs = Object.keys(byHref);
      checks['B4.framesEveryWorld'] = count > 0 && hrefs.length >= count && hrefs.every((h) => byHref[h].page && byHref[h].own && byHref[h].box);
      if (hrefs.some((h) => !h.startsWith(location.origin))) checks['B4.crossOriginFrame'] = hrefs.filter((h) => !h.startsWith(location.origin)).every((h) => byHref[h].page && byHref[h].own && byHref[h].box);
    }
    const msg = { world: 'page', href: location.href, top: window === top, start, seen, boxCall, tampered: !!window.__probeTampered, frames, checks };
    try { bridge.postMessage(stringify(msg)); } catch (e) { /* no listener in this frame */ }
  };
  addEventListener('load', () => setTimeout(report, 300));
})();
