// ==WebMod==
// @name        E2E Widened powers
// @match       *://127.0.0.1/wideb.html*
// @boxed
// @powers      block-events keydown click(#pb), page-events e2e-wide-reset, site-storage local:e2e-wide-key session:e2e-wide-s cookie:e2e_c
// @powers      rewrite-requests E2eOp variables.flag=false mode=quiet, image-variants 127.0.0.1 e2e-wide.png→e2e-wide.png?size=big
// @powers      embeds www.youtube.com/embed, local-fonts, preload, edit-uploads, site-data e2eData, media, go-to reload /wideb.html?mods=[red|blue]
// @migrate     localStorage e2e-old-setting
// @run-at      document-start
// ==/WebMod==

// The widened box's powers (WIDEN.md class B: tests/e2e/scenario.js wideBCheck): each new power, declared,
// and its narrowing. "ok: …" when it worked, "refused: …" when TRIF said no; a name ending "(refused)" must
// be refused. Some run at the start (the page's embedded data and data global, before its code reads them),
// the rest once the document is there. The first visit reloads the page once; the second records it all.
const R = {};
const L = {};
const out = () => { if (page.root) page.root.setAttr('data-trif-box-pb', JSON.stringify(R)); };
const late = () => { if (page.root) page.root.setAttr('data-trif-box-pb-late', JSON.stringify(L)); };
const show = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 160);
const t = (name, fn) => {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') { R[name] = 'pending'; v.then((x) => { R[name] = 'ok: ' + show(x); out(); }, (e) => { R[name] = 'refused: ' + String(e && e.message).slice(0, 160); out(); }); } else R[name] = 'ok: ' + show(v);
  } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 160); }
};

// ---- at the start: site-data's data global and embedded JSON (B5)
t('B5 a data global, filtered as the page sets it', () => { trif.filterGlobal('e2eData', (d) => { d.items = d.items.filter((x) => x !== 'drop'); return d; }); return 'filtering'; });
t('B5 a data global the header doesn\'t name (refused)', () => trif.filterGlobal('ytInitialData', (d) => d));
t('B5 the page\'s embedded JSON', () => { trif.filterEmbedded('#emb', (d) => ({ posts: d.posts.filter((p) => p.t !== 'drop') })); return 'filtering'; });
// ---- B4, B6: several documents behind a guard; an address with parameters taken out
t('B4 documents behind a guard', () => { trif.filterResponse('*/e2e-multi', (d) => { if (d.a) d.a = d.a.filter((x) => x !== 'drop'); if (d.b) d.b = []; return d; }); return 'filtering'; });
t('B6 an address with parameters taken out', () => { trif.filterResponse('*/e2e-urls', (d) => { d.u = 'https://127.0.0.1/watch?v=1'; return d; }); return 'filtering'; });
t('B6 an address with a parameter added: TRIF keeps what the site sent', () => { trif.filterResponse('*/e2e-urls', (d) => { d.w = 'https://127.0.0.1/watch?v=2&list=9'; return d; }); return 'filtering'; });
// (review F2: which parameters go is the mod's choice, so only on the page's own site; another site's address
// comes back exactly as the site sent it)
t('B6 another site\'s address with a parameter taken out: TRIF keeps what the site sent', () => { trif.filterResponse('*/e2e-urls', (d) => { d.x = 'https://www.youtube.com/watch?v=3'; return d; }); return 'filtering'; });

(async () => {
  await trif.ready;
  const visits = await trif.settings('visits', { n: 0 });
  // ---- B9: reload, once; the second visit can't reload again at once
  if (visits.value.n === 0) {
    await visits.save({ n: 1 });
    try { await trif.reload(); } catch (e) { R['B9 reload'] = 'refused: ' + e.message; out(); }
    return;
  }
  R['B9 reload'] = 'ok: reloaded';
  t('B9 a reload again at once (refused)', () => trif.reload());
  // ---- B3 site-storage and @migrate
  const ls = trif.storage('local'), ss = trif.storage('session'), ck = trif.storage('cookie');
  t('B3 the site\'s key, read and changed', () => { const was = ls.get('e2e-wide-key'); ls.set('e2e-wide-key', 'v2'); return `${was} ${ls.get('e2e-wide-key')} ${ss.get('e2e-wide-s')} ${ck.get('e2e_c')}`; });
  t('B3 a key the header doesn\'t name (refused)', () => ls.get('e2e-other'));
  t('B3 a cookie the header doesn\'t name (refused)', () => ck.get('e2e_other'));
  t('B3 a cookie written (refused)', () => ck.set('e2e_c', 'x'));
  t('B3 an address written into the site\'s storage (refused)', () => ls.set('e2e-wide-key', '{"avatar":"https://evil.example/e2e-pw-leak"}'));
  t('B3 the keys it may see', () => ls.keys().join(','));
  t('B3 its old settings, brought over once', () => trif.settings('e2e-old-setting', {}).then((s) => JSON.stringify(s.value)));
  // ---- B1 block-events
  t('B1 keeping clicks on the page\'s button from it', () => { trif.block('click', () => { L.blockedClick = 'blocked'; late(); return true; }); return 'blocking'; });
  t('B1 keeping keys from it', () => { trif.block('keydown', (e) => { L.blockedKeys = (L.blockedKeys || '') + e.key; late(); return true; }); return 'blocking'; });
  t('B1 an event the header doesn\'t name (refused)', () => trif.block('mouseover'));
  t('B1 submit (refused)', () => trif.block('submit'));
  // ---- B2 page-events
  t('B2 a signal to the page\'s code', () => { trif.signal('e2e-wide-reset', { n: 1 }); return 'sent'; });
  t('B2 a signal the header doesn\'t name (refused)', () => trif.signal('e2e-wide-undeclared'));
  t('B2 a signal with an address in it (refused)', () => trif.signal('e2e-wide-reset', { url: 'https://evil.example/e2e-pw-leak' }));
  // ---- B10 image-variants
  t('B10 another size of the page\'s picture, pixels read', () => new Promise((resolve, reject) => {
    const v = trif.imageVariant(page.find('#pimg'));
    v.on('load', () => { try { const c = page.create('canvas'); c.setAttr('width', '2'); c.setAttr('height', '2'); const g = c.canvas(); g.drawImage(v, 0, 0, 2, 2); resolve(`${typeof g.getImageData(0, 0, 1, 1).data[3]}`); } catch (e) { reject(e); } });
    v.on('error', () => reject(new Error('the variant didn\'t load')));
  }));
  t('B10 a variant of something that isn\'t the page\'s picture (refused)', () => trif.imageVariant(page.find('#title')));
  t('B10 a variant of its own picture (refused)', () => trif.imageVariant(page.create('img')));
  // ---- B11 edit-uploads
  t('B11 pictures the user attaches, changed', () => { trif.onUpload((cv) => { const g = cv.canvas(); g.set({ fillStyle: 'rgb(255, 0, 0)' }); g.fillRect(0, 0, 4, 4); L.edited = 'edited'; late(); return cv; }); return 'listening'; });
  // ---- B12 media
  t('B12 the page\'s video\'s events', () => { page.find('#vid').on('play', () => {}); page.find('#vid').on('volumechange', () => { L.volume = 'heard'; late(); }); return 'listening'; });
  t('B12 a media event on something else (refused)', () => page.find('#title').on('play', () => {}));
  // ---- B13 embeds
  t('B13 a video the page links to: TRIF\'s button', () => { const b = trif.embed(page.find('#yt'), { label: 'Play here' }); b.setAttr('id', 'trif-box-pb-embed'); page.body.append(b); return b.text; });
  t('B13 a link that isn\'t a video (refused)', () => trif.embed(page.find('#shown-q')));
  t('B13 a link of its own (refused)', () => { const a = page.create('a'); a.setAttr('href', '#x'); return trif.embed(a); });
  // ---- B14 local-fonts (the browser asks first: without the user's click, it says no)
  t('B14 the installed fonts, or the browser\'s no', () => trif.localFonts().then((f) => `${f.length} fonts`, (e) => (/needs the local-fonts power/.test(e.message) ? Promise.reject(e) : `the browser: ${e.message.slice(0, 60)}`)));
  // ---- B15 preload
  t('B15 the page\'s lazy picture, sooner', () => { page.find('#lazy').loadSooner(); return 'asked'; });
  t('B15 its own picture (refused)', () => page.create('img').loadSooner());
  // ---- B6 the link rule; B8 the search box's options
  t('B6 a link the page shows, with a parameter taken out', () => { const a = page.create('a'); a.setAttr('href', '/wideb.html?a=1'); return a.attr('href'); });
  t('B6 a link the page shows, with a parameter added (refused)', () => page.create('a').setAttr('href', '/wideb.html?a=1&b=2&c=3'));
  t('B6 a link to another site the page shows, with a parameter taken out (refused)', () => page.create('a').setAttr('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  t('B6 the page\'s own link to another site, with a parameter taken out (refused)', () => page.find('#yt').setAttr('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  // ---- B9 go-to: a query from the header's list, in the app; not other values
  t('B9 a value not in the list (refused)', () => trif.goTo('/wideb.html?mods=evil'));
  t('B9 a value twice (refused)', () => trif.goTo('/wideb.html?mods=red,red'));
  t('B9 in the app, values from the list', () => { trif.goTo('/wideb.html?mods=red,blue', { inApp: true }); return page.url.replace(/^.*\/wideb\.html/, ''); });
  out();
  late();
})();
out();
