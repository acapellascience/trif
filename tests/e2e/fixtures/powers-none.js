// ==WebMod==
// @name        E2E Boxed mod without powers
// @match       *://127.0.0.1/sandbox.html*
// @boxed
// @run-at      document-idle
// ==/WebMod==

// What the powers give, tried without declaring them (tests/e2e/scenario.js powersCheck): each must be
// refused, or come back empty.
const R = {};
const t = (name, fn) => { try { const v = fn(); R[name] = v === undefined || v === null || v === false || v === '' ? 'absent' : 'did: ' + String(v).slice(0, 80); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 140); } };
t('sound: trif.audio', () => { trif.audio(); return 'made'; });
t('controls: an input', () => { page.create('input'); return 'made'; });
t('controls: a select', () => { page.create('select'); return 'made'; });
t('read-drafts: a field\'s value', () => page.find('#fi').value);
t('read-drafts: an editor\'s text', () => page.find('#editor').text);
t('read-drafts: an editor\'s value', () => page.find('#editor').value);
page.root.setAttr('data-trif-box-pw-none', JSON.stringify(R));
