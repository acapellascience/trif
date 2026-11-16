// ==WebMod==
// @name        E2E Combo act
// @match       *://127.0.0.1/combo-dest.html*
// @boxed
// @powers      click, page-events combo-ping
// @click       the counter: #cc
// @run-at      document-idle
// ==/WebMod==

// The other half of the split pair (tests/e2e/scenario.js comboFixesCheck, review F3): it runs only on the
// page e2e-combo-go goes to. As it starts it clicks and signals; on the user's own click on #user, again.
// Reached by the other mod's go-to, the first two are refused; reached by the user, they work.
const R = {};
const out = () => page.root.setAttr('data-trif-box-ca', JSON.stringify(R));
const t = (name, fn) => { try { fn(); R[name] = 'ok'; } catch (e) { R[name] = `refused: ${String(e && e.message).slice(0, 400)}`; } };
t('as it starts: click', () => page.find('#cc').click());
t('as it starts: signal', () => trif.signal('combo-ping', { n: 1 }));
out();
page.find('#user').on('click', () => {
  t('after the user\'s click: click', () => page.find('#cc').click());
  t('after the user\'s click: signal', () => trif.signal('combo-ping', { n: 2 }));
  out();
});
