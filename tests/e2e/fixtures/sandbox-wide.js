// ==WebMod==
// @name        E2E Widened box
// @match       *://127.0.0.1/wide.html*
// @boxed
// @powers      sound
// @events      e2e-wide-signal
// @run-at      document-idle
// ==/WebMod==

// The widened box (WIDEN.md, class A: tests/e2e/scenario.js wideCheck): each row's new capability, and each
// row's hostile test. Outcomes go on the page as data: "ok: …" when it worked, "refused: …" when TRIF or the
// browser said no. A name ending "(refused)" must be refused, every other one ok; the scenario checks some
// values exactly, and, from outside, that the server saw nothing and the page noticed nothing.
const R = {};
const L = {}; // (what happens later, as the scenario acts on the page)
const out = () => page.root.setAttr('data-trif-box-w', JSON.stringify(R));
const late = () => page.root.setAttr('data-trif-box-w-late', JSON.stringify(L));
const show = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 120);
const t = (name, fn) => {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') {
      R[name] = 'pending';
      v.then((x) => { R[name] = 'ok: ' + show(x); out(); }, (e) => { R[name] = 'refused: ' + String(e && e.message).slice(0, 160); out(); });
    } else R[name] = 'ok: ' + show(v);
  } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 160); }
};
const absent = () => { throw new Error('absent'); };
const port = page.url.split('/')[2].split(':')[1];
const other = 'http://localhost:' + port;

// ---- A1–A5: sound
const a = trif.audio();
t('A1 a compressor, its reduction a number', () => { const c = a.compressor({ threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); c.connect('out'); return typeof c.reduction; });
t('A1 a compressor\'s setting as text (refused)', () => a.compressor({ threshold: '-24' }));
t('A1 a compressor\'s setting as an object with valueOf (refused)', () => a.compressor({ ratio: { valueOf() { return 4; } } }));
t('A1 a compressor\'s setting NaN (refused)', () => a.compressor({ knee: NaN }));
t('A1 a compressor\'s param set to a getter object (refused)', () => a.compressor().param('threshold').set({ get value() { return 1; } }));
t('A2 an oscillator into another\'s frequency (FM)', () => { const m = a.oscillator({ frequency: 5 }); const c = a.oscillator({ frequency: 220 }); const g = a.gain(0); m.connect(c.param('frequency')); c.connect(g); g.connect('out'); return 'connected'; });
t('A2 into a parameter of something not its own (refused)', () => a.oscillator().connect({ value: 1 }));
t('A3 a wave of its own', () => { const o = a.oscillator({ wave: { real: [0, 0, 0.5], imag: [0, 1, 0] } }); o.setWave(new Float32Array([0, 1]), new Float32Array([0, 0])); return 'set'; });
t('A3 a wave with NaN (refused)', () => a.oscillator({ wave: { real: [0, NaN], imag: [0, 1] } }));
t('A3 a wave of 5000 terms (refused)', () => a.oscillator().setWave(new Array(5000).fill(0), new Array(5000).fill(0)));
t('A3 a wave with a getter in it (refused)', () => { const re = [0, 1]; Object.defineProperty(re, 1, { get() { return 1; } }); return a.oscillator().setWave(re, [0, 0]); });
t('A3 a wave from an array-like (refused)', () => a.oscillator().setWave({ length: 2, 0: 0, 1: 1 }, [0, 0]));
t('A4 a buffer from numbers', () => { const b = a.buffer([[0, 0.5, -0.5, 0]], 8000, { loop: false }); b.connect('out'); return 'made'; });
t('A4 a buffer of 11 seconds (refused)', () => a.buffer([new Float32Array(8000 * 11)], 8000));
t('A4 a buffer at 1 MHz (refused)', () => a.buffer([[0, 1]], 1000000));
t('A4 an offline render of its own graph', () => a.render(0.1, (off) => { const o = off.oscillator({ frequency: 440 }); const g = off.gain(0.5); o.connect(g); g.connect('out'); o.start(); }, { rate: 22050 })
  .then((r) => `${r.length} ${r.rate} ${r.peak > 0.1} ${r.channels[0].length} ${Object.getPrototypeOf(r.channels[0]) === Float32Array.prototype}`));
t('A4 a render of an hour (refused)', () => a.render(3600, () => {}));
t('A4 a render with a node of the live context in it (refused)', () => a.render(0.05, (off) => { a.oscillator().connect(off.gain(1)); }));
t('A4 a render\'s node into the live context (refused)', () => a.render(0.05, (off) => { off.oscillator().connect(a.gain(1)); }));
// (the browser may hold a context suspended until the user does something: the answer within 2 s, or that)
const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('later'), 2000))]);
t('A5 latency as numbers, suspend and resume its own context', () => { const l = a.latency; return within(a.suspend()).then((s1) => { a.resume(); return `${typeof l.base} ${typeof l.output} ${s1}`; }); });

// ---- A6–A8: the language's typed arrays, the browser's pure tools, the clock
t('A6 Float32Array and Float64Array', () => { const f = new Float32Array([1.5, 2]); const d = new Float64Array(2); d[0] = Math.PI; return `${f[0]} ${d[0].toFixed(2)}`; });
t('A6 Float32Array.prototype changed (refused)', () => { Float32Array.prototype.__trifEscape = 1; return 'set'; });
t('A6 typed arrays\' constructors changed (refused)', () => { Float64Array.from = () => 'mine'; return 'set'; });
t('A6 atob and btoa', () => `${atob('aGk=')} ${btoa('hi')}`);
t('A6 atob of something that isn\'t base64 (a plain error)', () => { try { atob('*'); } catch (e) { return Object.getPrototypeOf(e) === TypeError.prototype ? 'TypeError' : 'another kind: ' + Object.prototype.toString.call(e); } return 'no error'; });
t('A7 URL and URLSearchParams', () => { const u = new URL('/a?b=1&c=2', page.url); u.searchParams.delete('c'); return `${u.pathname} ${u.searchParams.get('b')} ${new URLSearchParams('x=y').get('x')}`; });
t('A7 URL.createObjectURL (refused)', () => URL.createObjectURL || absent());
t('A7 URL.revokeObjectURL (refused)', () => URL.revokeObjectURL || absent());
t('A7 URL.prototype changed (refused)', () => { Object.defineProperty(URL.prototype, 'href', { get() { return 'https://x/'; } }); return 'set'; });
t('A7 a URL object as a link to another site (refused)', () => { const l = page.create('a'); l.setAttr('href', new URL(other + '/e2e-wide-leak-href')); page.body.append(l); return 'set'; });
t('A7 Intl, TextEncoder, TextDecoder, structuredClone', () => `${new Intl.NumberFormat('en').format(1234.5)} ${new TextEncoder().encode('hé').length} ${new TextDecoder().decode(new Uint8Array([104, 105]))} ${structuredClone({ a: [1] }).a[0]}`);
t('A7 structuredClone of a function (refused)', () => structuredClone(() => 1));
t('A8 performance.now', () => typeof performance.now());
t('A8 performance.getEntries (refused)', () => performance.getEntries());
t('A8 performance.timeOrigin (refused)', () => performance.timeOrigin || absent());

// ---- A9–A15: page facts, read only
t('A9 devicePixelRatio, visibilityState, a media query', () => `${typeof page.devicePixelRatio} ${page.visibilityState} ${page.matchMedia('(min-width: 1px)').matches}`);
t('A9 a media query\'s changes', () => { const off = page.matchMedia('(prefers-color-scheme: dark)').onChange(() => {}); off(); return 'listened'; });
t('A10 innerText', () => page.find('#title').innerText);
t('A10 an editor\'s innerText reads empty', () => JSON.stringify(page.find('#editor').innerText));
t('A10 an editor\'s piece\'s innerText reads empty', () => JSON.stringify(page.find('#ed-p').innerText));
t('A11 layout, read', () => `${page.find('#pimg').offsetWidth} ${page.find('#pimg').clientHeight} ${typeof page.root.scrollTop}`);
t('A11 scrollTop written (refused)', () => { page.root.scrollTop = 100; return 'set'; });
t('A12 SVG geometry', () => { const b = page.find('#prect').bbox(); return `${b.x},${b.y},${b.width},${b.height} ${page.find('#ppath').totalLength()} ${page.find('#ppath').pointAtLength(25).y} ${page.find('#prect').isPointInFill(15, 15)} ${page.find('#ppath').isPointInStroke(15, 20)}`; });
t('A12 SVG geometry inside an editor (refused)', () => page.find('#ed-rect').bbox());
t('A12 SVG geometry on an HTML element (refused)', () => page.find('#title').bbox());
t('A14 what\'s at a point: a stand-in', () => { const r = page.find('#pimg').rect(); const e = page.elementFromPoint(r.x + 2, r.y + 2); return e ? e.attr('id') : 'none'; });
t('A14 at a point in a shadow root: its host', () => { const r = page.find('#ohost').rect(); return page.elementFromPoint(r.x + 2, r.y + 2).attr('id'); });
t('A14 at a point in a frame: the frame', () => { const r = page.find('#frm').rect(); return page.elementsFromPoint(r.x + 5, r.y + 5)[0].tag; });
t('A14 into a frame from a point (refused)', () => { const r = page.find('#frm').rect(); return page.elementFromPoint(r.x + 5, r.y + 5).find('*') || absent(); });
t('A14 a point given as text (refused)', () => page.elementFromPoint('1', '1'));
t('A15 an inline style', () => page.find('#sprite').inlineStyle('width'));

// ---- A13, A27, A28: drawing
const cv = page.create('canvas');
cv.setAttr('id', 'trif-box-w-cv'); cv.setAttr('width', '8'); cv.setAttr('height', '8');
page.body.append(cv);
const g = cv.canvas();
t('A13 a text\'s metrics', () => { g.set({ font: '10px sans-serif' }); const m = g.measureText('Hg'); return `${typeof m.width} ${typeof m.actualBoundingBoxAscent} ${typeof m.fontBoundingBoxDescent}`; });
t('A27 a gradient, a filter, dashes', () => { const gr = g.linearGradient(0, 0, 8, 0); gr.addStop(0, 'rgb(10, 20, 30)'); gr.addStop(1, 'rgb(10, 20, 30)'); g.set({ fillStyle: gr, filter: 'blur(0px)' }); g.setLineDash([1, 2]); g.fillRect(0, 0, 8, 8); return [...g.getImageData(1, 1, 1, 1).data].join(','); });
t('A27 pixels back and forth', () => { const d = g.getImageData(0, 0, 2, 2); d.data[0] = 200; g.putImageData(d, 0, 0); return g.getImageData(0, 0, 1, 1).data[0]; });
t('A27 a data: picture of its canvas', () => { const u = g.toDataURL(); const im = page.create('img'); im.setAttr('src', u); im.setAttr('id', 'trif-box-w-png'); page.body.append(im); return u.slice(0, 22); });
t('A27 a filter with url() (refused)', () => g.set({ filter: 'url(' + other + '/e2e-wide-leak-filter#f)' }));
t('A27 a gradient stop that loads (refused)', () => g.linearGradient(0, 0, 1, 1).addStop(0, 'url(' + other + '/e2e-wide-leak-stop)'));
t('A27 drawing the page\'s canvas (refused)', () => g.drawImage(page.find('#pcv'), 0, 0));
t('A27 a pattern from the page\'s canvas (refused)', () => g.pattern(page.find('#pcv')));
t('A27 drawing from something that isn\'t a picture (refused)', () => g.drawImage(page.find('#title'), 0, 0));
t('A27 a type toDataURL doesn\'t make (refused)', () => g.toDataURL('text/html'));
t('A28 drawing a picture the page shows', () => { g.drawImage(page.find('#pimg'), 0, 0, 8, 8); return [...g.getImageData(4, 4, 1, 1).data].join(','); });

// ---- A16: animations
const box = page.create('div');
box.setAttr('id', 'trif-box-w-box');
box.style('width', '20px'); box.style('height', '20px'); box.style('overflow', 'hidden');
page.body.append(box);
t('A16 an animation of its own', () => { const an = box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 50000, easing: 'ease-in' }); an.pause(); an.setCurrentTime(25000); return `${an.playState} ${an.currentTime} ${an.mine}`; });
t('A16 keyframes with url() (refused)', () => box.animate([{ backgroundImage: 'url(' + other + '/e2e-wide-leak-anim)' }], 10));
t('A16 keyframes with image-set() (refused)', () => box.animate([{ maskImage: 'image-set("' + other + '/e2e-wide-leak-mask" 1x)' }], 10));
t('A16 keyframes with a data: url() (refused)', () => box.animate([{ backgroundImage: 'url(data:image/png;base64,AA==)' }], 10));
t('A16 the page\'s animation, read', () => { const an = page.find('#anim').animations()[0]; return `${an.playState} ${typeof an.currentTime} ${an.mine}`; });
t('A16 the page\'s animation paused (refused)', () => page.find('#anim').animations()[0].pause());
t('A16 the page\'s animation cancelled (refused)', () => page.find('#anim').animations()[0].cancel());
t('A16 the page\'s animation sped up (refused)', () => page.find('#anim').animations()[0].setPlaybackRate(100));

// ---- A17–A21: observing
t('A17 attribute changes', () => { trif.observe('#feed .item', (el, ch) => { if (ch) { L.attr = `${el.attr('id')}:${ch.attribute}`; late(); } }, { attributes: ['class'] }); return 'watching'; });
t('A17 attribute changes inside an editor', () => { trif.observe('#ed-p', (el, ch) => { if (ch) { L.editorAttr = 'heard'; late(); } }, { attributes: ['class'] }); return 'watching'; });
t('A17 the value attribute (refused)', () => trif.observe('input', () => {}, { attributes: ['value'] }));
t('A17 the VALUE attribute (refused)', () => trif.observe('input', () => {}, { attributes: ['VALUE'] }));
t('A18 its own sizes', () => { box.onResize((r) => { L.resized = r.width; late(); }); return 'watching'; });
t('A18 visibility', () => { page.find('#pimg').onVisible((v) => { L.visible = v.visible; late(); }, { threshold: [0, 1], rootMargin: '10px 0px' }); return 'watching'; });
t('A18 a margin that isn\'t one (refused)', () => page.find('#pimg').onVisible(() => {}, { rootMargin: 'url(x)' }));
t('A19 changes under an element', () => { trif.changes('#feed', (els) => { L.changed = els.map((e) => e.attr('id')).join(','); late(); }); return 'watching'; });
t('A19 changes inside an editor', () => { trif.changes('#editor', () => { L.editorChanged = 'heard'; late(); }); return 'watching'; });
t('A20 the address as it changes', () => { trif.onUrl((u) => { L.urls = (L.urls || []).concat(u.replace(/^.*\/wide\.html/, '')); late(); }); return 'watching'; });
t('A21 ready and loaded', () => Promise.all([trif.ready, trif.loaded]).then((x) => x.join(' ')));
t('A21 as the page goes', () => { page.on('pagehide', () => {}); return 'listening'; });
t('A21 beforeunload (refused)', () => page.on('beforeunload', () => {}));

// ---- A22–A25: events and focus on its own elements
const own = page.create('button');
own.setAttr('id', 'trif-box-w-stop'); own.setText('stop');
page.body.append(own);
own.on('click', (e) => { try { e.stopPropagation(); L.stopped = 'stopped'; } catch (err) { L.stopped = 'refused: ' + err.message; } late(); });
page.find('#pb').on('click', (e) => { try { e.stopPropagation(); L.pageStopped = 'stopped'; } catch (err) { L.pageStopped = 'refused'; } late(); });
const cap = page.create('div');
cap.setAttr('id', 'trif-box-w-cap'); cap.setText('capture'); cap.style('width', '60px'); cap.style('height', '20px');
page.body.append(cap);
cap.on('pointerdown', (e) => { try { cap.capturePointer(e.pointerId); L.captured = `captured ${e.button} ${e.buttons} ${typeof e.pointerId}`; } catch (err) { L.captured = 'refused: ' + err.message; } late(); });
t('A22 more events: fullscreenchange, animationstart, transitionrun', () => { page.on('fullscreenchange', () => {}); box.on('animationstart', () => {}); box.on('transitionrun', () => {}); return 'listening'; });
t('A22 drag and drop between its own elements', () => { cap.setAttr('draggable', 'true'); cap.on('dragstart', (e) => e.dataTransfer.setData('text/plain', 'x')); box.on('drop', (e) => e.dataTransfer.getData('text/plain')); return 'listening'; });
t('A22 drag events on the page\'s element (refused)', () => page.find('#feed').on('drop', () => {}));
t('A22 drag events on the window (refused)', () => page.on('drop', () => {}));
t('A23 pointer capture on the page\'s element (refused)', () => page.find('#pb').capturePointer(1));
t('A25 focus on its own element', () => { own.focus(); own.blur(); return 'focused'; });
t('A25 focus on the page\'s field (refused)', () => page.find('#fi').focus());
t('A25 focus in a loop (refused)', () => { for (let i = 0; i < 12; i++) { own.focus(); own.blur(); } return 'looped'; });

// ---- A26: SVG of its own, and copies
t('A26 an SVG of its own', () => {
  const s = page.createSvg('svg'); s.setAttr('viewBox', '0 0 10 10'); s.setAttr('width', '10'); s.setAttr('id', 'trif-box-w-svg');
  const defs = page.createSvg('defs'); const gr = page.createSvg('linearGradient'); gr.setAttr('id', 'trif-box-w-g');
  const st = page.createSvg('stop'); st.setAttr('offset', '0'); st.setAttr('stop-color', 'rgb(1, 2, 3)'); gr.append(st); defs.append(gr); s.append(defs);
  const p = page.createSvg('path'); p.setAttr('d', 'M0 0 L10 10'); p.setAttr('fill', 'url(#trif-box-w-g)'); p.setAttr('clip-path', 'url(#trif-box-w-g)'); s.append(p);
  page.body.append(s);
  return `${s.attr('viewBox')} ${p.attr('fill')}`;
});
for (const tag of ['foreignObject', 'script', 'image', 'a', 'animate', 'style', 'iframe']) t(`A26 <${tag}> in SVG (refused)`, () => page.createSvg(tag));
t('A26 a reference to the page\'s id (refused)', () => page.createSvg('rect').setAttr('fill', 'url(#pg)'));
t('A26 a use pointing at another file (refused)', () => page.createSvg('use').setAttr('href', other + '/e2e-wide-leak.svg#x'));
t('A26 a use pointing at a page id (refused)', () => page.createSvg('use').setAttr('href', '#pg'));
t('A26 an onload on SVG (refused)', () => page.createSvg('svg').setAttr('onload', '__hits.push(1)'));
t('A26 a style attribute on SVG (refused)', () => page.createSvg('rect').setAttr('style', 'fill: red'));
t('A26 a copy of the page\'s SVG keeps its ids, renamed', () => { const c = page.find('#psvg').clone(); page.body.append(c); return `${c.attr('id')} ${c.find('rect').attr('fill')} ${c.find('linearGradient').attr('id')}`; });

// ---- A29–A31: CSS
t('A29 CSS url() of a picture the page shows', () => { trif.css('#trif-box-w-box { background-image: url(/e2e-wide.png) }'); return 'added'; });
t('A29 CSS url() of a picture a page sheet uses', () => { box.style('border-image', 'url("/e2e-wide.png?sprite=1") 1'); return 'set'; });
t('A29 CSS url() of a new address on this site (refused)', () => trif.css('body { background: url(/e2e-wide-leak-css.png) }'));
t('A29 CSS url() of a shown picture with a query added (refused)', () => trif.css('body { background: url(/e2e-wide.png?leak=1) }'));
t('A29 CSS url() with an escape inside (refused)', () => trif.css('body { background: url("/e2e-wide\\2e png") }'));
t('A30 CSS into shadow roots, open and closed', () => { trif.css('p { color: rgb(4, 5, 6) !important }', { shadow: '#ohost, #chost, .host' }); return 'added'; });
t('A30 CSS into a shadow root that reads fields (refused)', () => trif.css('input[value^="a"] { color: red }', { shadow: '#ohost' }));
t('A30 CSS into a shadow root that loads (refused)', () => trif.css('p { background: url(' + other + '/e2e-wide-leak-shadow) }', { shadow: '#ohost' }));
t('A31 the page\'s style sheets, as copies', () => { const sh = page.styleSheets().find((x) => x.rules.some((r) => r.selector === '#sprite')); return sh.rules.find((r) => r.selector === '#sprite').text.includes('e2e-wide.png'); });
t('A31 a style sheet\'s copy changed (refused)', () => { page.styleSheets()[0].rules.push({}); return 'pushed'; });

// ---- A32–A36
t('A32 the page\'s text split into its own pieces', () => { trif.wrap('#words', /beta/, (m) => { const s = page.create('span'); s.setAttr('id', 'trif-box-w-beta'); s.setText(m.toUpperCase()); return s; }); return page.find('#trif-box-w-beta') ? page.find('#words').text : 'not wrapped'; });
t('A32 wrapping inside an editor does nothing', () => { trif.wrap('#editor', /secret/, () => 'X'); return page.find('#editor').text === '' ? 'untouched' : 'read'; });
t('A32 wrapping the page\'s title does nothing', () => { trif.wrap('title', /e2e/, () => 'X'); return 'untouched'; });
t('A32 a pattern that can hang (refused)', () => trif.wrap('#words', /(a+)+$/, () => 'x'));
t('A32 a look-alike pattern (refused)', () => trif.wrap('#words', { source: 'a', flags: '', [Symbol.toStringTag]: 'RegExp' }, () => 'x'));
t('A33 a page event named in the header', () => { page.on('e2e-wide-signal', (e) => { L.signal = JSON.stringify(e.detail); try { own.focus(); L.focusWhileTyping = 'focused'; } catch (err) { L.focusWhileTyping = 'refused: ' + err.message; } late(); }); return 'listening'; });
t('A33 a page event not in the header (refused)', () => page.on('e2e-wide-other', () => {}));
t('A33 TRIF\'s own events (refused)', () => page.on('trif:filter-request', () => {}));
t('A34 a placeholder on the page\'s fields', () => { page.find('#fi').setAttr('placeholder', 'new'); page.find('#ta').setAttr('placeholder', 'new t'); return 'set'; });
for (const [n, v] of [['value', 'x'], ['name', 'x'], ['formaction', other + '/e2e-wide-leak-fa'], ['type', 'hidden']]) t(`A34 ${n} on the page's field (refused)`, () => page.find('#fi').setAttr(n, v));
t('A35 bigger settings', () => trif.settings('big', {}).then((s) => s.save({ blob: 'x'.repeat(500 * 1024) })));
t('A35 settings past 1 MB (refused)', () => trif.settings('huge', {}).then((s) => s.save({ blob: 'x'.repeat(1100 * 1024) })));
t('A36 output, meter, dl, abbr, time', () => {
  const o = page.create('output'); o.setText('7'); o.setAttr('id', 'trif-box-w-out');
  const m = page.create('meter'); m.setAttr('min', '0'); m.setAttr('max', '1'); m.setAttr('value', '0.5');
  const dl = page.create('dl'); dl.append(page.create('dt'), page.create('dd'));
  const ab = page.create('abbr'); ab.setAttr('title', 'a title');
  const tm = page.create('time'); tm.setAttr('datetime', '2026-11-10');
  box.append(o, m, dl, ab, tm);
  return 'made';
});
t('A36 an output for the page\'s field (refused)', () => page.create('output').setAttr('for', 'fi'));
t('A36 an output in the page\'s form (refused)', () => page.find('#f').append(page.create('output')));
t('A36 an output with a form (refused)', () => page.create('output').setAttr('form', 'f'));

out();
late();
