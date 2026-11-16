// ==WebMod==
// @name        E2E Boxed mod with powers
// @match       *://127.0.0.1/sandbox.html*
// @boxed
// @powers      sound, controls, read-drafts
// @run-at      document-idle
// ==/WebMod==

// What each power gives when declared, and how each stays narrow (tests/e2e/scenario.js powersCheck).
// Positive outcomes start "ok", refused ones "refused"; the scenario checks which is which.
const R = {};
const t = (name, fn) => { try { const v = fn(); R[name] = v && typeof v.then === 'function' ? 'pending' : 'ok: ' + String(v).slice(0, 80); if (v && typeof v.then === 'function') v.then((x) => { R[name] = 'ok: ' + String(x).slice(0, 80); out(); }, (e) => { R[name] = 'refused: ' + String(e && e.message).slice(0, 140); out(); }); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 140); } };
const out = () => page.root.setAttr('data-trif-box-pw-all', JSON.stringify(R));
const WAV = '__WAV__';

// sound
const a = trif.audio();
t('sound: a tone', () => { a.tone({ frequency: 660, duration: 0.05, volume: 0.01 }); return a.state; });
t('sound: a graph', () => { const o = a.oscillator({ type: 'square', frequency: 220 }); const g = a.gain(0.01); o.connect(g); g.connect('out'); o.start(); o.stop(a.now + 0.05); g.param('gain').ramp(0, a.now + 0.05); return 'connected'; });
t('sound: a data: sound', () => a.play(WAV, { volume: 0.01 }).then((p) => p.duration > 0));
t('sound: an address (refused)', () => a.play('http://localhost:1/e2e-pw-leak.wav'));
t('sound: a page address (refused)', () => a.sound('/e2e-pw-leak.wav'));
t('sound: connect to something not its own (refused)', () => a.gain(1).connect({}));
t('sound: the microphone (refused)', () => navigator.mediaDevices.getUserMedia({ audio: true }));

// controls
const box = page.create('div');
box.setAttr('id', 'trif-box-pw-box');
const range = page.create('input');
t('controls: a slider', () => { range.setAttr('type', 'range'); range.setAttr('min', '0'); range.setAttr('max', '10'); range.setValue('7'); return range.value; });
t('controls: its type', () => page.create('input').attr('type') + '/' + page.create('input').attr('autocomplete'));
t('controls: a password box (refused)', () => page.create('input').setAttr('type', 'password'));
t('controls: autocomplete (refused)', () => page.create('input').setAttr('autocomplete', 'current-password'));
t('controls: a name (refused)', () => page.create('input').setAttr('name', 'q'));
t('controls: inside the page\'s form (refused)', () => { page.find('#f').append(page.create('input')); return 'put'; });
t('controls: a select', () => { const s = page.create('select'); for (const v of ['a', 'b']) { const o = page.create('option'); o.setAttr('value', v); o.setText(v.toUpperCase()); s.append(o); } s.setValue('b'); box.append(s); return s.value; });
t('controls: a checkbox', () => { const c = page.create('input'); c.setAttr('type', 'checkbox'); c.setChecked(true); box.append(c); return c.checked; });
box.append(range);
page.find('#box').after(box);

// read-drafts
t('read-drafts: a field\'s value', () => page.find('#fi').value);
t('read-drafts: an editor\'s text', () => page.find('#editor').text);
t('read-drafts: an editor\'s value', () => page.find('#editor').value);
t('read-drafts: a password (refused)', () => page.find('#pw').value);
t('read-drafts: a hidden field (refused)', () => page.find('#fh').value);
t('read-drafts: changing a field (refused)', () => page.find('#fi').setValue('x'));
const keys = [];
page.on('keydown', (e) => { keys.push(`${e.key}@${e.target ? (e.target.attr('id') || e.target.tag) : '-'}`); page.root.setAttr('data-trif-box-pw-keys', keys.join(',')); });
const typed = [];
page.on('input', (e) => { typed.push(`${e.data}@${e.target ? e.target.attr('id') : '-'}`); page.root.setAttr('data-trif-box-pw-typed', typed.join(',')); });
out();
