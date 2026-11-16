// ==WebMod==
// @name        E2E Sandbox fixes
// @match       *://127.0.0.1/fixes.html*
// @boxed
// @powers      block-events keydown, edit-uploads, site-data, site-storage local:e2e-fix-key
// @powers      image-variants x.com e2e-wide.png→e2e-wide.png?size=big
// @run-at      document-start
// ==/WebMod==

// The sandbox's fixes from converting the user's mods (tests/e2e/scenario.js sandboxFixesCheck), each by the
// bug's number: "ok: …" when it worked, "refused: …" when TRIF said no; a name ending "(refused)" must be
// refused. The page's side of each (keys, a picture attached, its requests, its rewrite) is read by the suite.
const R = {};
const L = {};
const out = () => { if (page.root) page.root.setAttr('data-trif-box-fx', JSON.stringify(R)); };
const late = () => { if (page.root) page.root.setAttr('data-trif-box-fx-late', JSON.stringify(L)); };
const show = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 160);
const t = (name, fn) => {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') { R[name] = 'pending'; v.then((x) => { R[name] = 'ok: ' + show(x); out(); }, (e) => { R[name] = 'refused: ' + String(e && e.message).slice(0, 200); out(); }); } else R[name] = 'ok: ' + show(v);
  } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 200); }
};

// ---- at the start: site-data (7)
t('7a an address shortened to one the site also sent', () => { trif.filterResponse('*/e2e-fix-urls', (d) => { d.long = 'https://127.0.0.1/watch?v=1'; return d; }); return 'filtering'; });
t('7b a filter that changes nothing', () => { trif.filterResponse('*/e2e-fix-raw', (d) => d); return 'filtering'; });
t('7c embedded JSON, the first mod', () => { trif.filterEmbedded('#emb2', (d) => ({ a: d.a.filter((x) => x !== 'x') })); return 'filtering'; });

(async () => {
  await trif.ready;
  t('2 arc and ellipse, anticlockwise', () => { const g = page.create('canvas').canvas(); g.beginPath(); g.arc(5, 5, 4, 0, 3, true); g.ellipse(5, 5, 4, 2, 0, 0, 3, false); g.stroke(); return 'drawn'; });
  t('2 arc with an object last (refused)', () => page.create('canvas').canvas().arc(5, 5, 4, 0, 3, {}));
  t('3 overscroll-behavior and scroll-behavior', () => { trif.css('html { overscroll-behavior: contain } body { scroll-behavior: auto }'); return 'added'; });
  t('3 behavior (refused)', () => trif.css('a { behavior: x }'));
  t('4 a blocked Space, its default prevented', () => { trif.block('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); L.space = 'blocked'; late(); return true; } return false; }); return 'blocking'; });
  t('5 a picture looked at, not changed', () => { trif.onUpload((cv, info) => { L.upload = `${info.width}x${info.height}`; late(); }); return 'listening'; });
  t('6 the page rewrites a node it wrapped', () => { trif.wrap('#w', /alpha/, () => { const e = page.create('i'); e.setAttr('class', 'trif-box-al'); e.setText('ALPHA'); return e; }); return 'wrapping'; });
  t('6 text for another mod to wrap', () => { trif.wrap('#w2', /one/, () => 'ONE marker'); return 'wrapping'; });
  t('8 another size from a host without CORS', () => new Promise((resolve, reject) => {
    const v = trif.imageVariant(page.find('#ximg'));
    v.on('load', () => resolve('loaded')); v.on('error', () => reject(new Error('it didn\'t load')));
  }));
  t('8 its pixels, from a host without CORS: the host says no (refused)', () => new Promise((resolve, reject) => {
    const v = trif.imageVariant(page.find('#ximg'), { pixels: true });
    v.on('load', () => resolve('loaded')); v.on('error', () => reject(new Error('it didn\'t load (no CORS there)')));
  }));
  t('9 the site\'s own name in its storage', () => { trif.storage('local').set('e2e-fix-key', 'see 127.0.0.1/robot'); return 'kept'; });
  t('9 another site\'s name in its storage (refused)', () => trif.storage('local').set('e2e-fix-key', 'see evil.example/robot'));
  t('10 CSS into a shadow root inside another', () => { trif.css('p { color: rgb(1, 2, 3) }', { shadow: 'x-inner' }); return 'added'; });
  out();
})();
