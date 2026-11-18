// The probe's script in the box world ("trif-box"), right after ses.umd.min.js and sandbox-runtime.js in the
// same document-start script: starts the sandbox (lockdown) at once and times it, evaluates in a compartment,
// then (once the body is there) runs a boxed read, a confinement check and a boxed mod, and reports.
(() => {
  const bridge = globalThis.trifBox, now = () => performance.now(), stringify = JSON.stringify;
  const de = document.documentElement;
  const start = { t: Math.round(now() * 10) / 10, readyState: document.readyState, pageRan: !!(de && de.hasAttribute('data-page-ran')) };
  if (window !== top) { try { parent.postMessage({ trifProbeFrame: { world: 'box', href: location.href, start, listener: typeof bridge } }, '*'); } catch (e) { /* no parent */ } }
  const r1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);
  const out = { sesLoadMs: r1(now() - globalThis.__trifT0) };
  try { const t0 = now(); globalThis.__trifStartSandbox(); out.startMs = r1(now() - t0); out.lockdownMs = r1(globalThis.__trifSandbox.stats.lockdownMs); } catch (e) { out.startError = String((e && e.message) || e).slice(0, 500); }
  try { out.compartment = String(new Compartment().evaluate('20 + 22')); } catch (e) { out.compartment = `refused: ${e.message}`; }
  out.frozen = Object.isFrozen(Array.prototype);
  const timeout = (ms) => new Promise((r) => setTimeout(() => r(stringify({ ok: false, error: `no answer in ${ms} ms` })), ms));
  const later = async () => {
    const s = globalThis.__trifSandbox;
    if (s) {
      try {
        const env = JSON.parse(await Promise.race([s.evaluate('probe-1', '({ links: page.findAll("a").length, title: page.title })', true, { powers: ['page-data', 'read-drafts'], args: {} }), timeout(8000)]));
        out.boxedRead = env.ok ? env.json : `error: ${env.error}`;
      } catch (e) { out.boxedRead = `threw: ${e.message}`; }
      try {
        const env = JSON.parse(await Promise.race([s.evaluate('probe-2', '[typeof document, typeof window, typeof fetch, typeof XMLHttpRequest, typeof trifBox, typeof __trifSandbox].join(",")', true, { powers: ['page-data'], args: {} }), timeout(8000)]));
        out.inside = env.ok ? JSON.parse(env.json) : `error: ${env.error}`;
      } catch (e) { out.inside = `threw: ${e.message}`; }
      const id = 'probe.test/boxed';
      s.run(id, 'const o = page.find("#out"); if (o) o.setText("a boxed mod wrote this"); trif.log("boxed mod ran");', { powers: [], args: {} });
      await new Promise((r) => setTimeout(r, 500));
      out.modLogs = s.logs.filter((l) => l.mod === id).length;
      out.modErrors = s.errors.filter((e) => e.mod === id).map((e) => e.message);
      const o = document.querySelector('#out');
      out.outText = o ? o.textContent : null;
    }
    out.seen = { pageMark: typeof globalThis.__probePage, ownMark: typeof globalThis.__trifOwnMark, ownListener: typeof globalThis.trifOwn, pageListener: typeof globalThis.probePage };
    const confined = Array.isArray(out.inside) || typeof out.inside === 'string' ? String(out.inside).split(',').every((t) => t === 'undefined') : false;
    const msg = { world: 'box', href: location.href, top: window === top, start, out,
      checks: { 'B4.start': start.readyState === 'loading' && !start.pageRan, 'B1.lockdown': !out.startError && typeof out.lockdownMs === 'number' && out.frozen,
        'B1.compartment': out.compartment === '42', 'B1.boxedRead': typeof out.boxedRead === 'string' && !/^(error|threw)/.test(out.boxedRead),
        'B1.confined': confined, 'B1.boxedMod': out.modLogs > 0 && !(out.modErrors || ['x']).length,
        'B3.boxSeesNoOther': out.seen.pageMark === 'undefined' && out.seen.ownMark === 'undefined' && out.seen.ownListener === 'undefined' && out.seen.pageListener === 'undefined' } };
    bridge.postMessage(stringify(msg));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => later()); else later();
})();
