// ==WebMod==
// @name        E2E Widened powers, undeclared
// @match       *://127.0.0.1/wideb.html*
// @boxed
// @run-at      document-idle
// ==/WebMod==

// The widened box's powers, undeclared (tests/e2e/scenario.js wideBCheck): each one is refused.
const R = {};
const t = (name, fn) => {
  try { const v = fn(); if (v && typeof v.then === 'function') { R[name] = 'pending'; v.then((x) => { R[name] = 'ok: ' + String(x).slice(0, 80); page.root.setAttr('data-trif-box-pb-none', JSON.stringify(R)); }, (e) => { R[name] = 'refused: ' + String(e && e.message).slice(0, 140); page.root.setAttr('data-trif-box-pb-none', JSON.stringify(R)); }); } else R[name] = 'ok: ' + String(v).slice(0, 80); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 140); }
};
t('block-events', () => trif.block('keydown'));
t('page-events', () => trif.signal('e2e-wide-reset'));
t('site-storage', () => trif.storage('local'));
t('image-variants', () => trif.imageVariant(page.find('#pimg')));
t('edit-uploads', () => trif.onUpload(() => {}));
t('embeds', () => trif.embed(page.find('#yt')));
t('local-fonts', () => trif.localFonts());
t('preload', () => page.find('#lazy').loadSooner());
t('site-data: filterEmbedded', () => trif.filterEmbedded('#emb', (d) => d));
t('site-data: filterGlobal', () => trif.filterGlobal('e2eData', (d) => d));
t('media: the page\'s video\'s events', () => page.find('#vid').on('play', () => {}));
t('go-to: reload', () => trif.reload());
t('go-to: a query from a list', () => trif.goTo('/wideb.html?mods=red'));
t('rewrite-requests: nothing to call', () => { if (typeof trif.rewrite === 'undefined') throw new Error('absent'); return 'there'; });
page.root.setAttr('data-trif-box-pb-none', JSON.stringify(R));
