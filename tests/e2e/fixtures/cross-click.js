// ==WebMod==
// @name        E2E Cross click
// @match       *://127.0.0.1/cross.html*
// @boxed
// @powers      click
// @click       the counter: #cc
// @run-at      document-idle
// ==/WebMod==

// Cross-mod approval (tests/e2e/scenario.js crossModCheck): it asks only for what it uses (click), never keys to
// be let act beside the other mod. A moment after it starts (the other mod is in play by then) it clicks the page's
// counter, and signals when it has page-events.
const R = {};
const t = (name, fn) => { try { fn(); R[name] = 'ok'; } catch (e) { R[name] = `refused: ${String(e && e.message).slice(0, 500)}`; } };
setTimeout(() => {
  t('click', () => page.find('#cc').click());
  if (trif.signal) t('signal', () => trif.signal('cm-ping', { n: 1 }));
  page.root.setAttr('data-trif-box-cm', JSON.stringify(R));
}, 600);
