// ==WebMod==
// @name        E2E Boxed mod with phase-3 powers
// @match       *://127.0.0.1/powers3.html*
// @boxed
// @powers      media, go-to /e2e-goto-ok, click, write-drafts, read-drafts, mods
// @click       the counter: #pclick
// @click       a link on this page: #plink
// @click       the form's buttons: #fb3, #fr3, #lb3
// @click       a link to another site: #ext3
// @run-at      document-idle
// ==/WebMod==

// Phase-3 powers, declared (tests/e2e/scenario.js powers3Check): each outcome "ok: …" or "refused: …";
// a name ending "(refused)" must be refused.
const R = {};
const out = () => page.root.setAttr('data-trif-box-pw3', JSON.stringify(R));
const t = (name, fn) => { try { const v = fn(); R[name] = 'ok: ' + (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 160); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 220); } out(); };

// media: the page's own video
const v = page.find('#pmedia');
t('media: mute', () => { v.setMuted(true); return v.media.muted; });
t('media: volume', () => { v.setVolume(0.5); return v.media.volume; });
t('media: seek', () => { v.seek(0); return v.media.currentTime; });
t('media: pause', () => { v.pause(); return v.media.paused; });
t('media: play', () => typeof v.play());
t('media: on a heading (refused)', () => page.find('#title').pause());
t('media: a volume of 5 (refused)', () => v.setVolume(5));

// click: what the header names, and not what would submit, reset or leave the site
t('click: the counter', () => { page.find('#pclick').click(); return page.find('#pclick').text; });
t('click: a link on this page', () => { page.find('#plink').click(); return 'clicked'; });
t('click: a submit button (refused)', () => page.find('#fb3').click());
t('click: a reset button (refused)', () => page.find('#fr3').click());
t('click: a label for a submit button (refused)', () => page.find('#lb3').click());
t('click: a link to another site (refused)', () => page.find('#ext3').click());
t('click: a button the header doesn\'t name (refused)', () => page.find('#pbtn').click());

// go-to: refused for what the header doesn't name; the named page on the mod's own button (the check clicks it)
t('go-to: a page the header doesn\'t name (refused)', () => trif.goTo('/e2e-goto-not-named'));
t('go-to: a built address (refused)', () => trif.goTo('/e2e-goto-ok?carried=1'));
t('go-to: another site (refused)', () => trif.goTo('http://localhost:1/e2e-pw-leak-goto'));
t('go-to: a link to another site the page shows (refused)', () => trif.goTo(page.find('#ext3').attr('href')));
const go = page.create('button');
go.setAttr('id', 'trif-box-pw3-go');
go.setText('go');
go.on('click', () => trif.goTo('/e2e-goto-ok'));
page.body.append(go);

// mods: a channel to the other boxed mod (e2e-pw3b), through TRIF; sent until it answers
const ch = trif.channel('e2e');
let answered = false;
ch.on((msg, info) => { answered = true; R['mods: an answer'] = `ok: ${JSON.stringify(msg)} from ${info.from}`; out(); });
t('mods: a function in a message (refused)', () => ch.send({ f() {} }));
t('mods: an element in a message (refused)', () => ch.send({ el: page.find('#title') }));
let tries = 0;
const ask = () => { if (answered || ++tries > 30) return; ch.send({ hello: 'from a', n: 1 }); setTimeout(ask, 200); };
ask();

// write-drafts (a moment later, once every boxed mod on the page has started: see draftsOk in sandbox.js)
setTimeout(() => {
  t('write-drafts: a field', () => { page.find('#wd').setValue('rewritten'); return page.find('#wd').value; });
  t('write-drafts: a textarea', () => { page.find('#wta').setValue('rewritten two'); return page.find('#wta').value; });
  t('write-drafts: an editor', () => { page.find('#ed2').setText('rewritten draft'); return page.find('#ed2').text; });
  t('write-drafts: a password (refused)', () => page.find('#pw3').setValue('x'));
  t('write-drafts: a card field (refused)', () => page.find('#cc3').setValue('x'));
  t('write-drafts: a hidden field (refused)', () => page.find('#fh3').setValue('x'));
  t('write-drafts: a select (refused)', () => page.find('#sel3').setValue('b'));
  R.done = 'ok: done';
  out();
}, 600);
