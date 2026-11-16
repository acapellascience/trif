// ==WebMod==
// @name        E2E Sandbox fixes, the other mod
// @match       *://127.0.0.1/fixes.html*
// @boxed
// @powers      site-data
// @run-at      document-idle
// ==/WebMod==

// The second mod of tests/e2e/scenario.js sandboxFixesCheck: it starts after the first, so the page's embedded
// JSON the first filtered as it arrived is filtered again by this one (7c), and it wraps text the first mod's
// pieces brought in (6).
const R = {};
const t = (name, fn) => { try { R[name] = 'ok: ' + String(fn()); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 200); } };
t('7c embedded JSON, a mod that starts later', () => { trif.filterEmbedded('#emb2', (d) => ({ a: d.a.filter((x) => x !== 'y') })); return 'filtering'; });
t('6 another mod\'s pieces, wrapped', () => { trif.wrap('#w2', /marker/, () => { const b = page.create('b'); b.setAttr('class', 'trif-box-mk'); b.setText('M'); return b; }); return 'wrapping'; });
page.root.setAttr('data-trif-box-fxb', JSON.stringify(R));
