// ==WebMod==
// @name        Oppish
// @description opa lopittople whopimsopy
// @match       https://www.google.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     1
// @boxed
// ==/WebMod==

// Oppish: "op" goes before every vowel *sound* ("hello" → "hopellopo", "Google" → "Gopoogle").
const VOWELS = 'aeiou';
const SUFFIXES = ['ments', 'ment', 'ness', 'less', 'ful', 'ly', 's', 'd', ''];

const oppishWord = (w) => {
  const caps = w.length > 1 && w === w.toUpperCase();
  if (caps && w.length <= 4) return w;   // acronym
  const s = w.toLowerCase();
  const n = s.length;
  const isVowel = [];
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (c === 'y') isVowel[i] = i > 0 && !(i + 1 < n && VOWELS.includes(s[i + 1]));
    else isVowel[i] = VOWELS.includes(c) && !(c === 'u' && s[i - 1] === 'q');
  }
  const hasVowelBefore = (p) => isVowel.slice(0, p).some(Boolean);
  const skip = new Set();
  const extra = new Set();

  for (const suf of SUFFIXES) {
    if (!s.endsWith(suf)) continue;
    const e = n - suf.length - 1;
    if (e < 2 || s[e] !== 'e' || isVowel[e - 1]) continue;
    const before = s[e - 1], before2 = s.slice(e - 2, e);
    if (suf === 's' && ('sxzcg'.includes(before) || before2 === 'ch' || before2 === 'sh')) break;
    if (suf === 'd' && 'td'.includes(before)) break;
    if (before === 'l' && !isVowel[e - 2] && s[e - 2] !== 'l') {
      skip.add(e);
      extra.add(e - 1);
      break;
    }
    if (hasVowelBefore(e - 1)) skip.add(e);
    break;
  }

  let out = '';
  for (let i = 0; i < n; i++) {
    const startsSound = (isVowel[i] && !skip.has(i) && (i === 0 || !isVowel[i - 1])) || extra.has(i);
    if (!startsSound) out += w[i];
    else if (caps) out += 'OP' + w[i];
    else if (i === 0 && w[0] !== s[0]) out += 'Op' + s[0];
    else out += 'op' + w[i];
  }
  return out;
};
const oppish = (text) => text.replace(/[A-Za-z]+/g, oppishWord);

// Text: every text on the page as it appears or changes (TRIF leaves out scripts, styles, form text and
// what's typed in editors, as the original skipped them; each text once, again only if the page changes it).
trif.text('body', (t) => (/[A-Za-z]/.test(t) ? oppish(t) : t));

const doneAttr = new WeakMap();
// Skip non-button inputs, editable areas, scripts/styles, and our own logo.
const SKIP = 'script, style, noscript, textarea, input:not([type="submit"]):not([type="button"]):not([type="reset"]), [contenteditable], [data-trif-box-oppish-logo]';
const ATTRS = ['aria-label', 'alt', 'title', 'placeholder'];
const englishLabel = new WeakMap(); // (a button's aria-label before it was translated: its overlay's text)

const translateAttrs = (el) => {
  if (el.closest(SKIP)) return;
  let finished = doneAttr.get(el);
  if (!finished) {
    finished = new Set();
    doneAttr.set(el, finished);
  }
  for (const attr of ATTRS) {
    if (finished.has(attr)) continue;
    const val = el.attr(attr);
    if (!val || !/[A-Za-z]/.test(val)) {
      finished.add(attr);
      continue;
    }
    const out = oppish(val);
    finished.add(attr);
    if (attr === 'aria-label' && !englishLabel.has(el)) englishLabel.set(el, val);
    if (out !== val) { try { el.setAttr(attr, out); } catch (e) { /* (a placeholder on something that isn't a field) */ } }
  }
};

// Real buttons' labels (submit/reset/button inputs: "Google Search" etc.). Their value is what the form
// sends, which a boxed mod doesn't change: so the label is drawn over the button instead, in Oppish, and
// the button's own text made transparent. The form still sends Google's own value. The English label is
// the button's aria-label (Google gives its buttons one, the same as their value).
trif.css(`
  .trif-box-oppish-btn { position: absolute; display: flex; align-items: center; justify-content: center;
    pointer-events: none; white-space: nowrap; overflow: hidden; box-sizing: border-box; }
`);
const overlays = new WeakMap();
const placeOverlay = (inp, span) => {
  span.style('left', `${inp.offsetLeft}px`);
  span.style('top', `${inp.offsetTop}px`);
  span.style('width', `${inp.offsetWidth}px`);
  span.style('height', `${inp.offsetHeight}px`);
  for (const p of ['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'padding-left', 'padding-right']) span.style(p, inp.style(p));
};
const translateButtonValue = (el) => {
  if (el.tag !== 'input' || overlays.has(el)) return;
  const label = englishLabel.get(el) || el.attr('aria-label') || el.attr('title') || '';
  if (!label || !/[A-Za-z]/.test(label)) return;
  const span = page.create('span');
  span.classes.add('trif-box-oppish-btn');
  span.setAttr('aria-hidden', 'true');
  overlays.set(el, span);
  span.style('color', el.style('color'));
  el.style('color', 'transparent');
  span.setText(label);   // (trif.text above turns it into Oppish)
  el.after(span);
  placeOverlay(el, span);
  el.onResize(() => placeOverlay(el, span));
};

// Candidates only: translateLogo keeps just the real wordmarks (the home page logo, the small one on
// results pages inside #logo) and leaves icons such as the "G" home button alone.
const LOGO_SEL = 'svg[role="img"][aria-label*="Google" i], svg[role="img"][aria-label*="Gopoogople" i], #logo svg';

// The logo is rebuilt from Google's own letter shapes, so weight and curves match exactly. In the
// 272×92 logo (one path in dark mode, coloured paths in light mode) the letters sit at these x ranges
// (measured with isPointInFill, Nov 2026): clip = the slice that holds the letter, ink = its visible edges.
const GLYPHS = {
  G: { clip: [-1, 63.3], ink: [0, 61] },
  o: { clip: [63.3, 113.2], ink: [65.52, 110.97] },
  O: { clip: [113.2, 162], ink: [114.65, 160.1] },   // the second o (yellow in the colour logo)
  g: { clip: [162, 210.3], ink: [163.6, 206.87] },
  l: { clip: [210.3, 225.3], ink: [213.69, 222.91] },
  e: { clip: [225.3, 272], ink: [227.7, 269.6] },
};
const G_STEM = [198.07, 206.87, 25.77, 88.57]; // the g's straight stem: x0, x1, top, bottom (descender)
const G_HOOK_TOP = 63.94;                     // where the g's stem turns into its hook
const G_BOWL_BOTTOM = 69.8;                   // bottom of the g's bowl (just above where the hook passes)
// Gopoogople, with the gap before each letter (Google's own spacing: round-to-round ~4.5, round-to-stem ~5).
const WORD = [['G', 0], ['o', 4.5], ['p', 5], ['O', 4], ['o', 4.5], ['g', 3], ['O', 5], ['p', 5], ['l', 5.5], ['e', 5]];
const INK_Y = [6.98, 88.57];

const O_TOP = 24.2; // top of the first o, in 272×92 units

const viewBoxOf = (svg) => {
  const v = String(svg.attr('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  return v.length === 4 && !v.some(isNaN) ? { x: v[0], y: v[1], width: v[2], height: v[3] } : null;
};
const pathsOf = (art) => art.flatMap((n) => (n.tag === 'path' ? [n] : n.findAll('path')));
const inFill = (paths, x, y) => paths.find((p) => { try { return p.isPointInFill(x, y); } catch { return false; } }) || null;

// How this svg's drawing maps onto the 272×92 logo: native = d + k × unit. Other Google wordmarks (the
// small 92×30 one on results pages) are the same letters scaled, so find their six letters by scanning
// for ink. Anything that isn't a six-letter wordmark (the "G" home icon, doodles) gets null: left alone.
const fitOf = (svg, paths) => {
  const vb = viewBoxOf(svg);
  if (!vb || !vb.width || !vb.height || !paths.length) return null;
  if (vb.x === 0 && vb.y === 0 && vb.width === 272 && vb.height === 92) return { k: 1, dx: 0, dy: 0 };
  if (vb.width / vb.height < 2 || vb.width / vb.height > 5) return null; // not wordmark-shaped: skip the scan
  const sx = vb.width / 600, sy = vb.height / 150;
  const runs = [];
  let cur = null;
  for (let x = vb.x; x <= vb.x + vb.width; x += sx) {
    let any = false;
    for (let y = vb.y; y <= vb.y + vb.height && !any; y += sy) any = !!inFill(paths, x, y);
    if (!any) cur = null;
    else if (cur) cur[1] = x;
    else runs.push((cur = [x, x]));
  }
  if (runs.length !== 6) return null;
  const k = (runs[5][1] - runs[0][0]) / (GLYPHS.e.ink[1] - GLYPHS.G.ink[0]);
  const oMid = (runs[1][0] + runs[1][1]) / 2;
  let top = null;
  for (let y = vb.y; y <= vb.y + vb.height && top === null; y += sy / 4) if (inFill(paths, oMid, y)) top = y;
  if (top === null || !(k > 0)) return null;
  return { k, dx: runs[0][0] - GLYPHS.G.ink[0] * k, dy: top - O_TOP * k };
};

// A window onto the original drawing, in 272×92 units: a nested <svg> clips without needing ids; the inner
// <g> maps the drawing's own coordinates onto those units. (The drawing: TRIF's copies of Google's paths.)
const slice = (art, fit, x, y, w, h, dx) => {
  const s = page.createSvg('svg');
  for (const [k, v] of Object.entries({ x: x + dx, y, width: w, height: h, viewBox: `${x} ${y} ${w} ${h}` })) s.setAttr(k, String(v));
  const g = page.createSvg('g');
  if (fit.k !== 1 || fit.dx || fit.dy) g.setAttr('transform', `scale(${1 / fit.k}) translate(${-fit.dx} ${-fit.dy})`);
  for (const n of art) {
    const c = n.clone();
    if (!c) continue;
    if (c.attr('display') === 'none') c.setAttr('display', 'inline');
    g.append(c);
  }
  s.append(g);
  return s;
};

const fillOf = (p) => {
  const f = p ? p.attr('fill') : null;
  return f && f !== 'none' ? f : (p && p.style('fill')) || 'currentColor';
};

const buildGlyphLogo = (svg) => {
  const art = svg.findAll(':scope > path, :scope > g');
  const paths = pathsOf(art);
  const fit = fitOf(svg, paths);
  if (!fit) return false;
  const { k, dx, dy } = fit;
  const vb = viewBoxOf(svg);
  let cursor = 0;
  const parts = [];
  WORD.forEach(([ch, gap], i) => {
    if (i) cursor += gap;
    if (ch === 'p') {
      // p = the g mirrored, without its hook, on a straight stem down to the descender.
      const [gx0, gx1] = GLYPHS.g.ink;
      const w = gx1 - gx0;
      const p = page.createSvg('g');
      p.setAttr('transform', `translate(${cursor + gx1} 0) scale(-1 1)`);
      p.append(slice(art, fit, GLYPHS.g.clip[0], 0, G_STEM[1] - GLYPHS.g.clip[0], G_HOOK_TOP, 0));
      p.append(slice(art, fit, GLYPHS.g.clip[0], G_HOOK_TOP, G_STEM[0] - GLYPHS.g.clip[0], G_BOWL_BOTTOM - G_HOOK_TOP, 0));
      const stem = page.createSvg('rect');
      for (const [a, v] of Object.entries({ x: G_STEM[0], y: G_STEM[2], width: G_STEM[1] - G_STEM[0], height: G_STEM[3] - G_STEM[2], fill: stemFill })) stem.setAttr(a, String(v));
      p.append(stem);
      parts.push(p);
      cursor += w;
      return;
    }
    const { clip, ink } = GLYPHS[ch];
    parts.push(slice(art, fit, clip[0], 0, clip[1] - clip[0], 92, cursor - ink[0]));
    cursor += ink[1] - ink[0];
  });
  // How much longer the new word is, in viewBox units. The original widened the svg's viewBox to the right;
  // a boxed mod can't set the page's viewBox, so the svg's box is widened instead (its width, and
  // overflow visible): the drawing stays centred in it, and the word is drawn half the extra to the left.
  const extra = (cursor - GLYPHS.e.ink[1]) * k;
  const vbW = vb.width + extra;
  const shift = -extra / 2;
  const out = page.createSvg('g');
  out.setAttr('data-trif-box-oppish-text', '');
  out.setAttr('transform', `translate(${dx + shift} ${dy}) scale(${k})`);
  for (const p of parts) out.append(p);
  for (const n of art) n.style('display', 'none');
  const wAttr = parseFloat(svg.attr('width'));
  if (wAttr) svg.setAttr('width', String(Math.round((wAttr * vbW) / (vbW - extra))));
  svg.style('width', 'auto');
  svg.style('aspect-ratio', `${vbW} / ${vb.height}`);
  svg.style('overflow', 'visible');
  // For the DVD mod: where the ink is, in the svg's own viewBox units, so it can bounce edge to edge.
  svg.setAttr('data-trif-box-ink', [dx + shift, dy + INK_Y[0] * k, dx + cursor * k + shift, dy + INK_Y[1] * k].join(' '));
  svg.setAttr('data-trif-box-extra', String(extra)); // how much wider it got, in viewBox units (see fitHeader)
  svg.append(out);
  return true;
};
let stemFill = 'currentColor';

// Only Google wordmarks are rebuilt; an svg that isn't one (the "G" icon) is marked and left as it is.
const translateLogo = (svg) => {
  if (svg.attr('data-trif-box-oppish-logo') !== null || svg.closest('[data-trif-box-oppish-text]')) return; // ours, or a letter slice
  // (its drawing not there yet: next time)
  if (!svg.find('path')) return;
  svg.setAttr('data-trif-box-oppish-logo', 'skip');
  try {
    const art = svg.findAll(':scope > path, :scope > g');
    const paths = pathsOf(art);
    const fit = fitOf(svg, paths);
    if (fit) stemFill = fillOf(inFill(paths, fit.dx + fit.k * (G_STEM[0] + G_STEM[1]) / 2, fit.dy + fit.k * 40) || paths[0]);
    if (buildGlyphLogo(svg)) svg.setAttr('data-trif-box-oppish-logo', 'done');
  } catch (e) { trif.warn('oppish logo failed', String(e)); }
};

// Results pages: the small logo is absolutely positioned in the space left of the search box, which
// starts at a fixed margin. Pad the box's container by however much wider the logo got: the box gets
// shorter from the left, the logo (positioned against the padding edge) stays put. Only while the
// logo shows (narrow layouts hide it).
const fitHeader = () => {
  for (const svg of page.findAll('#logo svg[data-trif-box-extra]')) {
    let abs = svg.parent;
    while (abs && abs !== page.body && abs.style('position') !== 'absolute') abs = abs.parent;
    // (its offsetParent: the nearest positioned element above it)
    let box = abs ? abs.parent : null;
    while (box && box !== page.body && box.style('position') === 'static') box = box.parent;
    if (!box || box === page.body) continue;
    const r = svg.rect();
    const vb = viewBoxOf(svg);
    const shows = r.height > 0 && svg.style('visibility') === 'visible';
    const px = shows && vb && vb.height ? Math.ceil(parseFloat(svg.attr('data-trif-box-extra')) * (r.height / vb.height)) : 0;
    if (px > 0) box.style('padding-left', `${px}px`);
    else box.style('padding-left', null);
  }
};
page.on('resize', () => schedule());

const translate = () => {
  if (!page.body) return;
  for (const el of page.body.findAll(`[${ATTRS.join('], [')}]`)) translateAttrs(el);
  for (const el of page.body.findAll('input[type="submit"], input[type="button"], input[type="reset"]')) translateButtonValue(el);
  for (const svg of page.body.findAll(LOGO_SEL)) translateLogo(svg);
  fitHeader();
};

let queued = false;
const schedule = () => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    try { translate(); } catch (e) { trif.warn('oppish pass failed', String(e)); }
  }, 50);
};

trif.changes('body', schedule);
trif.ready.then(schedule);
if (page.body) translate();
