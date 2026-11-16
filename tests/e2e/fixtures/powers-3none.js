// ==WebMod==
// @name        E2E Boxed mod without powers, on the phase-3 page
// @match       *://127.0.0.1/powers3.html*
// @boxed
// @run-at      document-idle
// ==/WebMod==

// Phase-3 powers, undeclared (tests/e2e/scenario.js powers3Check): each must be "refused" or "absent".
const R = {};
const out = () => page.root.setAttr('data-trif-box-pw3none', JSON.stringify(R));
const t = (name, fn) => { try { const v = fn(); R[name] = v === null || v === undefined ? 'absent' : 'ok: ' + String(v).slice(0, 120); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 200); } out(); };
t('media: pause', () => page.find('#pmedia').pause());
t('media: mute', () => page.find('#pmedia').setMuted(true));
t('media: its state', () => page.find('#pmedia').media);
t('click: the counter', () => page.find('#pclick').click());
t('go-to: a page', () => trif.goTo('/e2e-goto-ok'));
t('go-to: a link the page shows', () => trif.goTo('/e2e-goto-shown'));
t('mods: a channel', () => trif.channel('e2e'));
t('write-drafts: a field', () => page.find('#wd').setValue('none was here'));
t('write-drafts: an editor', () => page.find('#ed2').setText('none was here'));
t('write-drafts: into an editor', () => page.find('#ed2').append(page.create('span')));
t('read-drafts: a field', () => page.find('#wd').value);
